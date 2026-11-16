using System.Text.Json;

namespace KraaLink;

public static class EmploymentApi
{
    public static void Map(WebApplication app)
    {
        app.MapPost("/api/employments", async (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var body = await Api.BodyAsync(ctx);
            var code = body.Str("code").ToUpperInvariant();
            var worker = Passport.WorkerByCode(db, code)
                         ?? throw ApiException.NotFound("No worker has that short code.");
            if (worker.I("verification_level") < 1)
                throw ApiException.Conflict("A worker can only be checked in at L1 or above.");
            if (!Passport.HasGrantedConsent(db, worker.S("user_id")!, farmer.Id))
                throw ApiException.Conflict("Complete a hiring check and get the worker's approval before check-in.");

            var existing = db.Exists(@"SELECT 1 FROM employments WHERE worker_id = @w AND farmer_id = @f
                                       AND status IN ('pending_checkin','open','pending_checkout','disputed')",
                new { w = worker.S("user_id"), f = farmer.Id });
            if (existing) throw ApiException.Conflict("This worker already has a live employment record with you.");

            var id = Ids.New("emp");
            var jobTitle = body.Str("jobTitle", false, "Farm worker");
            db.Begin();
            try
            {
                db.Exec(@"INSERT INTO employments (id, worker_id, farmer_id, status, job_title, created_at)
                          VALUES (@id,@w,@f,'pending_checkin',@j,@now)",
                    new { id, w = worker.S("user_id"), f = farmer.Id, j = jobTitle, now = Ts.Now() });
                db.Exec(@"INSERT INTO employment_events (id, employment_id, type, actor_id, payload, created_at)
                          VALUES (@id,@e,'check_in_requested',@a,@p,@now)",
                    new
                    {
                        id = Ids.New("evt"), e = id, a = farmer.Id,
                        p = JsonSerializer.Serialize(new { jobTitle, note = "Check-in recorded by farmer; waiting for worker confirmation" }),
                        now = Ts.Now()
                    });
                Notify.Send(db, worker.S("user_id")!, "Confirm your check-in",
                    $"{farmer.Name} recorded a check-in for '{jobTitle}'. Confirm in KraaLink to open the employment record. " +
                    "Only after you confirm does the job appear in your history.",
                    db.Str("SELECT language_code FROM users WHERE id = @id", new { id = worker.S("user_id") }) ?? "en",
                    new { employmentId = id, action = "confirm_checkin" });
                Audit.Log(db, ctx, "employment.check_in_recorded", "employment", id, "employments",
                    details: "Farmer recorded check-in; awaiting worker confirmation");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }
            return Results.Json(new { id, status = "pending_checkin" }, statusCode: 201);
        });

        app.MapGet("/api/employments/mine", (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx, "worker", "farmer");
            var rows = user.Role == "worker"
                ? db.Rows(@"SELECT e.*, u.full_name AS counterpart, COALESCE(f.farm_name,'') AS farm_name
                            FROM employments e JOIN users u ON u.id = e.farmer_id
                            LEFT JOIN farmers f ON f.user_id = e.farmer_id
                            WHERE e.worker_id = @u ORDER BY COALESCE(e.started_at, e.created_at) DESC", new { u = user.Id })
                : db.Rows(@"SELECT e.*, u.full_name AS counterpart, w.short_code AS short_code,
                                   w.verification_level AS verification_level
                            FROM employments e JOIN workers w ON w.user_id = e.worker_id
                            JOIN users u ON u.id = e.worker_id
                            WHERE e.farmer_id = @u ORDER BY COALESCE(e.started_at, e.created_at) DESC", new { u = user.Id });

            return Results.Json(rows.Select(e => new
            {
                id = e.S("id"),
                workerId = e.S("worker_id"),
                farmerId = e.S("farmer_id"),
                counterpart = e.S("counterpart"),
                farmName = e.S("farm_name"),
                shortCode = e.S("short_code"),
                jobTitle = e.S("job_title"),
                status = e.S("status"),
                startedAt = e.S("started_at"),
                endedAt = e.S("ended_at"),
                endReason = e.S("end_reason"),
                endLabel = e.S("no_checkout_at") is not null ? "No check-out recorded" : Passport.EndReasonLabel(e.S("end_reason")),
                noCheckout = e.S("no_checkout_at") is not null,
                wagesPaid = e.S("wages_paid") is null ? (bool?)null : e.I("wages_paid") == 1,
                createdAt = e.S("created_at")
            }));
        });

        app.MapGet("/api/employments/{id}", (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.Require(ctx);
            var emp = db.Row("SELECT * FROM employments WHERE id = @id", new { id })
                      ?? throw ApiException.NotFound("Employment not found.");
            var isParticipant = emp.S("worker_id") == user.Id || emp.S("farmer_id") == user.Id;
            if (!isParticipant && user.Role is not ("reviewer" or "admin"))
                throw ApiException.Forbidden();

            var worker = db.Row("SELECT w.*, u.full_name AS worker_name FROM workers w JOIN users u ON u.id = w.user_id WHERE w.user_id = @id",
                new { id = emp.S("worker_id") })!;
            var farmerName = db.Str("SELECT full_name FROM users WHERE id = @id", new { id = emp.S("farmer_id") });
            var farmName = db.Str("SELECT farm_name FROM farmers WHERE user_id = @id", new { id = emp.S("farmer_id") });
            var events = db.Rows(@"SELECT e.*, u.full_name AS actor_name FROM employment_events e
                                   LEFT JOIN users u ON u.id = e.actor_id
                                   WHERE e.employment_id = @id ORDER BY e.created_at", new { id });
            var incidents = db.Rows("SELECT id, status, description, created_at FROM incidents WHERE employment_id = @id ORDER BY created_at DESC", new { id });
            var nextOfKin = db.Int("SELECT COUNT(*) FROM next_of_kin_requests WHERE employment_id = @id", new { id });

            var unreachableHours = Settings.Int(db, "kin_unreachable_hours", 48);
            var lastSeen = Ts.Parse(worker.S("last_seen_at")) ?? Ts.Parse(worker.S("created_at"));
            var unreachable = lastSeen is not null && (DateTime.UtcNow - lastSeen.Value).TotalHours >= unreachableHours;

            return Results.Json(new
            {
                id = emp.S("id"),
                workerId = emp.S("worker_id"),
                workerName = worker.S("worker_name"),
                shortCode = worker.S("short_code"),
                verificationLevel = worker.I("verification_level"),
                farmerId = emp.S("farmer_id"),
                farmerName,
                farmName,
                jobTitle = emp.S("job_title"),
                status = emp.S("status"),
                startedAt = emp.S("started_at"),
                endedAt = emp.S("ended_at"),
                endReason = emp.S("end_reason"),
                endLabel = emp.S("no_checkout_at") is not null ? "No check-out recorded" : Passport.EndReasonLabel(emp.S("end_reason")),
                noCheckout = emp.S("no_checkout_at") is not null,
                leftReportedAt = emp.S("left_reported_at"),
                wagesPaid = emp.S("wages_paid") is null ? (bool?)null : emp.I("wages_paid") == 1,
                createdAt = emp.S("created_at"),
                events = events.Select(e => new
                {
                    id = e.S("id"), type = e.S("type"), actor = e.S("actor_name"),
                    payload = e.S("payload"), createdAt = e.S("created_at")
                }),
                incidents,
                canRequestKin = user.Id == emp.S("farmer_id") && emp.S("status") == "open" && unreachable,
                workerUnreachableHours = lastSeen is null ? 0 : (int)(DateTime.UtcNow - lastSeen.Value).TotalHours,
                kinRequestCount = nextOfKin
            });
        });

        app.MapPost("/api/employments/{id}/confirm-checkin", (HttpContext ctx, Db db, string id) =>
        {
            var worker = Auth.Require(ctx, "worker");
            var emp = db.Row("SELECT * FROM employments WHERE id = @id", new { id })
                      ?? throw ApiException.NotFound("Employment not found.");
            if (emp.S("worker_id") != worker.Id) throw ApiException.Forbidden();
            if (emp.S("status") != "pending_checkin") throw ApiException.Conflict("There is no check-in waiting for you.");

            db.Begin();
            try
            {
                db.Exec("UPDATE employments SET status = 'open', started_at = @now WHERE id = @id",
                    new { now = Ts.Now(), id });
                db.Exec(@"INSERT INTO employment_events (id, employment_id, type, actor_id, payload, created_at)
                          VALUES (@id,@e,'check_in_confirmed',@a,@p,@now)",
                    new
                    {
                        id = Ids.New("evt"), e = id, a = worker.Id,
                        p = JsonSerializer.Serialize(new { note = "Worker confirmed check-in" }), now = Ts.Now()
                    });
                Notify.Send(db, emp.S("farmer_id")!, "Check-in confirmed",
                    $"{worker.Name} confirmed the check-in. The employment record is now open.", "en",
                    new { employmentId = id, action = "employment" });
                Audit.Log(db, ctx, "employment.check_in_confirmed", "employment", id, "employments",
                    new { status = "pending_checkin" }, new { status = "open" }, "status");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }
            return Results.Json(new { ok = true, status = "open" });
        });

        app.MapPost("/api/employments/{id}/checkout", async (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.Require(ctx, "worker", "farmer");
            var emp = db.Row("SELECT * FROM employments WHERE id = @id", new { id })
                      ?? throw ApiException.NotFound("Employment not found.");
            if (emp.S("worker_id") != user.Id && emp.S("farmer_id") != user.Id) throw ApiException.Forbidden();
            if (emp.S("status") != "open") throw ApiException.Conflict("This employment is not open.");

            var body = await Api.BodyAsync(ctx);
            var reason = body.Str("reason", false, "contract_ended");
            if (reason is not ("contract_ended" or "resigned" or "dismissed" or "other"))
                throw ApiException.Bad("Choose a valid end reason.");
            var wagesPaid = body.Bool("wagesPaid", true);

            db.Begin();
            try
            {
                db.Exec("UPDATE employments SET status = 'pending_checkout' WHERE id = @id", new { id });
                db.Exec(@"INSERT INTO employment_events (id, employment_id, type, actor_id, payload, created_at)
                          VALUES (@id,@e,'check_out',@a,@p,@now)",
                    new
                    {
                        id = Ids.New("evt"), e = id, a = user.Id,
                        p = JsonSerializer.Serialize(new { reason, wagesPaid }), now = Ts.Now()
                    });
                var other = user.Id == emp.S("worker_id") ? emp.S("farmer_id") : emp.S("worker_id");
                Notify.Send(db, other!, "Check-out needs your confirmation",
                    $"{user.Name} recorded a check-out with reason '{Passport.EndReasonLabel(reason)}'. " +
                    "Confirm or dispute it in KraaLink. If you dispute it, a reviewer will see both sides.",
                    "en", new { employmentId = id, action = "respond_checkout" });
                Audit.Log(db, ctx, "employment.check_out_recorded", "employment", id, "employments",
                    details: "Reason=" + reason + "; awaiting other party confirmation");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }
            return Results.Json(new { ok = true, status = "pending_checkout" });
        });

        app.MapPost("/api/employments/{id}/checkout/respond", async (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.Require(ctx, "worker", "farmer");
            var emp = db.Row("SELECT * FROM employments WHERE id = @id", new { id })
                      ?? throw ApiException.NotFound("Employment not found.");
            if (emp.S("worker_id") != user.Id && emp.S("farmer_id") != user.Id) throw ApiException.Forbidden();
            if (emp.S("status") != "pending_checkout") throw ApiException.Conflict("There is no check-out to answer.");

            var body = await Api.BodyAsync(ctx);
            var confirm = body.Bool("confirm");
            var checkoutEvent = db.Row(@"SELECT * FROM employment_events WHERE employment_id = @id AND type = 'check_out'
                                         ORDER BY created_at DESC LIMIT 1", new { id })
                                ?? throw ApiException.Conflict("The check-out record is missing.");
            var initiator = checkoutEvent.S("actor_id");
            if (initiator == user.Id) throw ApiException.Conflict("The other party must confirm this check-out.");

            string reason = "other";
            bool wagesPaid = true;
            try
            {
                using var doc = JsonDocument.Parse(checkoutEvent.S("payload") ?? "{}");
                if (doc.RootElement.TryGetProperty("reason", out var r)) reason = r.GetString() ?? "other";
                if (doc.RootElement.TryGetProperty("wagesPaid", out var w)) wagesPaid = w.ValueKind == JsonValueKind.True;
            }
            catch { }

            db.Begin();
            try
            {
                if (confirm)
                {
                    var now = Ts.Now();
                    db.Exec(@"UPDATE employments SET status = 'closed', ended_at = @now, end_reason = @r, wages_paid = @w
                              WHERE id = @id", new { now, r = reason, w = wagesPaid ? 1 : 0, id });
                    db.Exec(@"INSERT INTO employment_events (id, employment_id, type, actor_id, payload, created_at)
                              VALUES (@id,@e,'check_out_confirmed',@a,@p,@now)",
                        new
                        {
                            id = Ids.New("evt"), e = id, a = user.Id,
                            p = JsonSerializer.Serialize(new { note = "Check-out confirmed" }), now
                        });
                    Notify.Send(db, initiator!, "Check-out confirmed — employment closed",
                        $"The employment record is closed with reason '{Passport.EndReasonLabel(reason)}'. Wages reported " +
                        (wagesPaid ? "paid in full." : "as NOT paid in full; this is visible to reviewers."),
                        "en", new { employmentId = id, action = "employment" });
                    Audit.Log(db, ctx, "employment.check_out_confirmed", "employment", id, "employments",
                        new { status = "pending_checkout" },
                        new { status = "closed", end_reason = reason, wages_paid = wagesPaid }, "status,end_reason,wages_paid");
                }
                else
                {
                    db.Exec("UPDATE employments SET status = 'disputed' WHERE id = @id", new { id });
                    db.Exec(@"INSERT INTO employment_events (id, employment_id, type, actor_id, payload, created_at)
                              VALUES (@id,@e,'check_out_disputed',@a,@p,@now)",
                        new
                        {
                            id = Ids.New("evt"), e = id, a = user.Id,
                            p = JsonSerializer.Serialize(new { note = "Check-out disputed; sent to review" }),
                            now = Ts.Now()
                        });
                    Notify.Staff(db, "reviewer", "Check-out disputed",
                        "A check-out was disputed. Both sides are kept; review the record and the employment events.",
                        new { employmentId = id });
                    Audit.Log(db, ctx, "employment.check_out_disputed", "employment", id, "employments",
                        new { status = "pending_checkout" }, new { status = "disputed" }, "status");
                }
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }
            return Results.Json(new { ok = true, status = confirm ? "closed" : "disputed" });
        });

        app.MapPost("/api/employments/{id}/report-left", (HttpContext ctx, Db db, string id) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var emp = db.Row("SELECT * FROM employments WHERE id = @id", new { id })
                      ?? throw ApiException.NotFound("Employment not found.");
            if (emp.S("farmer_id") != farmer.Id) throw ApiException.Forbidden();
            if (emp.S("status") != "open") throw ApiException.Conflict("Only an open employment can be reported.");

            var days = Settings.Int(db, "no_checkout_days", 7);
            db.Begin();
            try
            {
                db.Exec("UPDATE employments SET left_reported_at = @now WHERE id = @id", new { now = Ts.Now(), id });
                db.Exec(@"INSERT INTO employment_events (id, employment_id, type, actor_id, payload, created_at)
                          VALUES (@id,@e,'left_reported',@a,@p,@now)",
                    new
                    {
                        id = Ids.New("evt"), e = id, a = farmer.Id,
                        p = JsonSerializer.Serialize(new { note = "Farmer reported the job ended; no check-out recorded yet", neutral = true }),
                        now = Ts.Now()
                    });
                Notify.Send(db, emp.S("worker_id")!, "A job was reported as ended",
                    "The farmer says the job has ended but no check-out has been recorded. This is a neutral note, not an accusation. " +
                    $"If no check-out is recorded in {days} days the system will add 'No check-out recorded' and you can reply. " +
                    "You may add your check-out now.",
                    "en", new { employmentId = id, action = "worker_checkout" });
                Audit.Log(db, ctx, "employment.left_reported", "employment", id, "employments",
                    details: "Neutral report; worker notified; no accusation label applied");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }
            return Results.Json(new { ok = true, note = "No accusation is applied. The worker is notified and can reply." });
        });

        app.MapPost("/api/employments/{id}/no-checkout-response", async (HttpContext ctx, Db db, string id) =>
        {
            var worker = Auth.Require(ctx, "worker");
            var emp = db.Row("SELECT * FROM employments WHERE id = @id", new { id })
                      ?? throw ApiException.NotFound("Employment not found.");
            if (emp.S("worker_id") != worker.Id) throw ApiException.Forbidden();
            var body = await Api.BodyAsync(ctx);
            var response = body.Str("response");
            db.Exec(@"INSERT INTO employment_events (id, employment_id, type, actor_id, payload, created_at)
                      VALUES (@id,@e,'no_checkout_response',@a,@p,@now)",
                new
                {
                    id = Ids.New("evt"), e = id, a = worker.Id,
                    p = JsonSerializer.Serialize(new { response }), now = Ts.Now()
                });
            Notify.Send(db, emp.S("farmer_id")!, "Worker replied to the no check-out note",
                $"{worker.Name} added a reply: {response}", "en", new { employmentId = id });
            Audit.Log(db, ctx, "employment.no_checkout_response", "employment", id, "employments",
                details: "Worker added their side");
            return Results.Json(new { ok = true });
        });

        app.MapPost("/api/employments/{id}/next-of-kin-requests", async (HttpContext ctx, Db db, string id) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var emp = db.Row("SELECT * FROM employments WHERE id = @id", new { id })
                      ?? throw ApiException.NotFound("Employment not found.");
            if (emp.S("farmer_id") != farmer.Id) throw ApiException.Forbidden();
            if (emp.S("status") != "open") throw ApiException.Conflict("Next-of-kin contact is only possible while the employment is open.");

            var worker = Passport.Worker(db, emp.S("worker_id")!)!;
            var hours = Settings.Int(db, "kin_unreachable_hours", 48);
            var lastSeen = Ts.Parse(worker.S("last_seen_at")) ?? Ts.Parse(worker.S("created_at"));
            if (lastSeen is null || (DateTime.UtcNow - lastSeen.Value).TotalHours < hours)
                throw ApiException.Conflict($"Next-of-kin contact needs {hours} hours without contact with the worker. Last activity: {Ts.Human(worker.S("last_seen_at"))}.");

            var body = await Api.BodyAsync(ctx);
            var reason = body.Str("reason", false, "Worker has been unreachable while the employment is open.");

            db.Begin();
            try
            {
                db.Exec(@"INSERT INTO next_of_kin_requests (id, employment_id, farmer_id, worker_id, reason, client_ip, created_at)
                          VALUES (@id,@e,@f,@w,@r,@ip,@now)",
                    new { id = Ids.New("nok"), e = id, f = farmer.Id, w = emp.S("worker_id"), r = reason, ip = ctx.RequestIp(), now = Ts.Now() });
                db.Exec(@"INSERT INTO employment_events (id, employment_id, type, actor_id, payload, created_at)
                          VALUES (@id,@e,'next_of_kin_revealed',@a,@p,@now)",
                    new
                    {
                        id = Ids.New("evt"), e = id, a = farmer.Id,
                        p = JsonSerializer.Serialize(new { reason, rule = hours + "h unreachable" }), now = Ts.Now()
                    });
                db.Exec(@"INSERT INTO access_log (id, viewer_id, viewer_role, worker_id, consent_id, purpose, fields_viewed,
                            client_ip, request_id, created_at)
                          VALUES (@id,@v,'farmer',@w,NULL,'Next-of-kin contact after 48h unreachable','next_of_kin',@ip,@rid,@now)",
                    new
                    {
                        id = Ids.New("acc"), v = farmer.Id, w = emp.S("worker_id"), ip = ctx.RequestIp(),
                        rid = ctx.TraceIdentifier, now = Ts.Now()
                    });
                Audit.Log(db, ctx, "next_of_kin.revealed", "worker", emp.S("worker_id"), "access_log",
                    details: "48h rule met; reveal logged with reason");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            var kin = db.Rows("SELECT name, relationship, phone_e164, village FROM next_of_kin WHERE worker_id = @w",
                new { w = emp.S("worker_id") });
            foreach (var k in kin)
            {
                Notify.Send(db, farmer.Id, "Next-of-kin contact: " + k.S("name"),
                    $"You asked to contact {k.S("name")} ({k.S("relationship")}) at {k.S("phone_e164")} because the worker has been unreachable " +
                    $"{hours} hours while the employment is open. Tell them why you are calling. This reveal is logged.",
                    "en", new { employmentId = id }, "system");
            }
            return Results.Json(new
            {
                ok = true,
                kin = kin.Select(k => new { name = k.S("name"), relationship = k.S("relationship"), phone = k.S("phone_e164"), village = k.S("village") }),
                note = "The next of kin must be told why they are being called. This reveal is traceable to you and the time."
            });
        });
    }
}
