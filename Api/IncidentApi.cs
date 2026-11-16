using System.Text.Json;

namespace KraaLink;

public static class IncidentApi
{
    public static void Map(WebApplication app)
    {
        app.MapPost("/api/incidents", async (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var body = await Api.BodyAsync(ctx);
            var employmentId = body.Str("employmentId");
            var emp = db.Row("SELECT * FROM employments WHERE id = @id", new { id = employmentId })
                      ?? throw ApiException.NotFound("Employment not found.");
            if (emp.S("farmer_id") != farmer.Id) throw ApiException.Forbidden("You can only file an incident on your own employment.");
            var description = body.Str("description");
            if (description.Length < 15) throw ApiException.Bad("Describe what happened in a little more detail.");

            var evidence = body.StrList("evidence");
            var workerId = emp.S("worker_id")!;
            var id = Ids.New("inc");

            db.Begin();
            try
            {
                var fileIds = new List<string>();
                foreach (var dataUrl in evidence.Take(5))
                {
                    var saved = Storage.SaveDataUrl(db, dataUrl, "evidence", farmer.Id);
                    fileIds.Add(saved.S("id")!);
                }

                db.Exec(@"INSERT INTO incidents (id, employment_id, reporter_id, worker_id, description, occurred_on,
                            value_nad, evidence_paths, police_case_no, status, worker_notified_at, created_at)
                          VALUES (@id,@e,@r,@w,@d,@o,@v,@ev,@police,'under_review',@now,@now)",
                    new
                    {
                        id, e = employmentId, r = farmer.Id, w = workerId, d = description,
                        o = body.StrOrNull("occurredOn"), v = body.Num("valueNad"), ev = Passport.JsonList(fileIds),
                        police = body.StrOrNull("policeCaseNo"), now = Ts.Now()
                    });

                Notify.Send(db, workerId, "A farmer filed an incident — your right to respond",
                    $"{farmer.Name} filed an incident: \"{description}\". You have " +
                    Settings.Int(db, "incident_worker_response_days", 7) +
                    " days to respond by text or voice note. Your side is kept and a reviewer sees both sides before any decision. " +
                    "If there is no evidence attached, other farmers do not see this.",
                    db.Str("SELECT language_code FROM users WHERE id = @id", new { id = workerId }) ?? "en",
                    new { incidentId = id, action = "respond_incident" });

                Audit.Log(db, ctx, "incident.filed", "incident", id, "incidents",
                    details: $"Evidence files={fileIds.Count}; worker notified immediately; no evidence content in audit");

                db.Commit();
                return Results.Json(new
                {
                    id,
                    status = "under_review",
                    visibleToFarmers = fileIds.Count > 0,
                    note = fileIds.Count > 0
                        ? "The incident is visible to other farmers only because evidence is attached and the worker was notified."
                        : "Without evidence this incident is not visible to other farmers."
                }, statusCode: 201);
            }
            catch
            {
                db.Dispose();
                throw;
            }
        });

        app.MapGet("/api/incidents/mine", (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx, "worker", "farmer");
            var rows = user.Role == "worker"
                ? db.Rows(@"SELECT i.*, u.full_name AS reporter_name, COALESCE(f.farm_name,'') AS farm_name
                            FROM incidents i JOIN users u ON u.id = i.reporter_id
                            LEFT JOIN farmers f ON f.user_id = i.reporter_id
                            WHERE i.worker_id = @u ORDER BY i.created_at DESC", new { u = user.Id })
                : db.Rows(@"SELECT i.*, u.full_name AS worker_name, w.short_code AS short_code
                            FROM incidents i JOIN users u ON u.id = i.worker_id
                            JOIN workers w ON w.user_id = i.worker_id
                            WHERE i.reporter_id = @u ORDER BY i.created_at DESC", new { u = user.Id });

            return Results.Json(rows.Select(i => View(db, i, user)));
        });

        app.MapGet("/api/incidents/{id}", (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.Require(ctx);
            var inc = db.Row("SELECT * FROM incidents WHERE id = @id", new { id })
                      ?? throw ApiException.NotFound("Incident not found.");
            if (user.Role is not ("reviewer" or "admin") && inc.S("worker_id") != user.Id && inc.S("reporter_id") != user.Id)
                throw ApiException.Forbidden();
            return Results.Json(View(db, inc, user));
        });

        app.MapPost("/api/incidents/{id}/response", async (HttpContext ctx, Db db, string id) =>
        {
            var worker = Auth.Require(ctx, "worker");
            var inc = db.Row("SELECT * FROM incidents WHERE id = @id", new { id })
                      ?? throw ApiException.NotFound("Incident not found.");
            if (inc.S("worker_id") != worker.Id) throw ApiException.Forbidden();
            if (inc.S("status") is not ("under_review" or "worker_responded"))
                throw ApiException.Conflict("This incident is no longer open for a response.");

            var days = Settings.Int(db, "incident_worker_response_days", 7);
            var created = Ts.Parse(inc.S("created_at"));
            if (created is not null && (DateTime.UtcNow - created.Value).TotalDays > days)
                throw ApiException.Conflict("The response window has closed. Contact a reviewer if you need to add information.");

            var body = await Api.BodyAsync(ctx);
            var response = body.Str("response");
            if (response.Length < 5) throw ApiException.Bad("Write your response.");

            db.Exec(@"UPDATE incidents SET worker_response = @r, responded_at = @now, status = 'worker_responded'
                      WHERE id = @id", new { r = response, now = Ts.Now(), id });
            Notify.Send(db, inc.S("reporter_id")!, "The worker responded to your incident",
                $"{worker.Name} added a response. A reviewer will see both sides before deciding.", "en",
                new { incidentId = id });
            Audit.Log(db, ctx, "incident.worker_responded", "incident", id, "incidents",
                new { status = inc.S("status") }, new { status = "worker_responded" }, "status,worker_response");
            return Results.Json(new { ok = true, status = "worker_responded" });
        });

        app.MapPost("/api/incidents/{id}/decision", async (HttpContext ctx, Db db, string id) =>
        {
            var reviewer = Auth.Require(ctx, "reviewer", "admin");
            var inc = db.Row("SELECT * FROM incidents WHERE id = @id", new { id })
                      ?? throw ApiException.NotFound("Incident not found.");
            if (inc.S("status") is not ("under_review" or "worker_responded"))
                throw ApiException.Conflict("Only an open incident can be decided.");

            var body = await Api.BodyAsync(ctx);
            var outcome = body.Str("outcome");
            var reason = body.Str("reason");
            if (outcome is not ("dismissed" or "verified_warning" or "suspended_police"))
                throw ApiException.Bad("Choose dismissed, verified_warning or suspended_police.");
            var policeCase = body.StrOrNull("policeCaseNo") ?? inc.S("police_case_no");
            if (outcome == "suspended_police" && string.IsNullOrWhiteSpace(policeCase))
                throw ApiException.Bad("Suspended - Police Case Open needs a police case number.");

            var now = Ts.Now();
            string? expiresAt = null;
            if (outcome == "verified_warning")
                expiresAt = DateTime.UtcNow.AddMonths(Settings.Int(db, "warning_expiry_months", 24)).ToString(Ts.Format);
            if (outcome == "suspended_police")
                expiresAt = Ts.DaysFromNow(Settings.Int(db, "police_case_review_days", 30));

            db.Begin();
            try
            {
                db.Exec(@"UPDATE incidents SET status = @s, decision = @d, decided_by = @by, decided_at = @now,
                            expires_at = @exp, police_case_no = COALESCE(@police, police_case_no)
                          WHERE id = @id",
                    new
                    {
                        s = outcome, d = reason, by = reviewer.Id, now, exp = expiresAt,
                        police = policeCase, id
                    });

                Notify.Send(db, inc.S("worker_id")!, "Incident decision",
                    outcome switch
                    {
                        "dismissed" => "The incident against you was dismissed. It is hidden from farmers and kept internally only to detect abuse.",
                        "verified_warning" => "The incident was verified with a warning. It shows on your record status until " + Ts.DateOnly(expiresAt) + ". You can still add information.",
                        _ => "Your record status is now 'Suspended - Police Case Open' because case number " + policeCase + " exists. This is reviewed monthly and removed if the case is withdrawn or closed without charge."
                    },
                    db.Str("SELECT language_code FROM users WHERE id = @id", new { id = inc.S("worker_id") }) ?? "en",
                    new { incidentId = id, action = "incidents" });

                Notify.Send(db, inc.S("reporter_id")!, "Incident decision recorded",
                    "A reviewer recorded the outcome: " + outcome.Replace('_', ' ') + ". Reason: " + reason,
                    "en", new { incidentId = id });

                if (outcome == "dismissed")
                {
                    db.Exec("UPDATE farmers SET dismissed_reports_count = dismissed_reports_count + 1 WHERE user_id = @id",
                        new { id = inc.S("reporter_id") });
                    var count = db.Int("SELECT dismissed_reports_count FROM farmers WHERE user_id = @id",
                        new { id = inc.S("reporter_id") });
                    var threshold = Settings.Int(db, "repeat_dismissed_threshold", 3);
                    if (count >= threshold)
                        Notify.Staff(db, "reviewer", "Repeat dismissed reports",
                            $"A farmer now has {count} dismissed reports (threshold {threshold}). Review for abuse before other reports are taken at face value.",
                            new { farmerId = inc.S("reporter_id") });
                }

                Audit.Log(db, ctx, "incident.decided", "incident", id, "incidents",
                    new { status = inc.S("status") },
                    new { status = outcome, decision = reason, expires_at = expiresAt, police_case_no = policeCase },
                    "status,decision,decided_by,decided_at,expires_at,police_case_no");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }
            return Results.Json(new { ok = true, status = outcome, expiresAt });
        });

        app.MapGet("/api/admin/queues/incidents", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var rows = db.Rows(@"SELECT i.*, w.full_name AS worker_name, w.short_code AS short_code,
                                        u.full_name AS reporter_name, e.job_title, e.status AS employment_status
                                 FROM incidents i JOIN workers w ON w.user_id = i.worker_id
                                 JOIN users u ON u.id = i.reporter_id
                                 JOIN employments e ON e.id = i.employment_id
                                 WHERE i.status IN ('under_review','worker_responded')
                                 ORDER BY i.created_at ASC");
            return Results.Json(rows.Select(i => View(db, i, new UserCtx("", "reviewer", "", "", "en"))));
        });
    }

    private static object View(Db db, Dictionary<string, object?> i, UserCtx user)
    {
        var evidence = i.List("evidence_paths");
        var created = Ts.Parse(i.S("created_at"));
        var responseDays = Settings.Int(db, "incident_worker_response_days", 7);
        var canRespond = user.Id == i.S("worker_id") && i.S("status") is "under_review" or "worker_responded"
                         && created is not null && (DateTime.UtcNow - created.Value).TotalDays <= responseDays;
        var visible = evidence.Count > 0 && i.S("worker_notified_at") is not null
                      && i.S("status") is "under_review" or "worker_responded";
        var show = user.IsReviewer || user.Id == i.S("worker_id") || user.Id == i.S("reporter_id") || visible;

        return new
        {
            id = i.S("id"),
            employmentId = i.S("employment_id"),
            workerId = i.S("worker_id"),
            workerName = i.S("worker_name"),
            shortCode = i.S("short_code"),
            reporterName = i.S("reporter_name"),
            description = show ? i.S("description") : null,
            occurredOn = i.S("occurred_on"),
            valueNad = i.S("value_nad") is null ? (double?)null : i.D("value_nad"),
            evidenceCount = evidence.Count,
            evidenceUrls = show ? evidence.Select(f => Storage.Url(f, 10)).ToList() : new List<string>(),
            policeCaseNo = i.S("police_case_no"),
            status = i.S("status"),
            workerNotifiedAt = i.S("worker_notified_at"),
            workerResponse = show ? i.S("worker_response") : null,
            respondedAt = i.S("responded_at"),
            decision = i.S("decision"),
            decidedAt = i.S("decided_at"),
            expiresAt = i.S("expires_at"),
            visibleToFarmers = visible,
            canRespond,
            responseDueAt = created?.AddDays(responseDays).ToString(Ts.Format),
            createdAt = i.S("created_at")
        };
    }
}
