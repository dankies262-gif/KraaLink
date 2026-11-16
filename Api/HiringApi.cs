namespace KraaLink;

public static class HiringApi
{
    private const string PassportFields = "photo,name,home_village,verification_level,last_3_employers,record_status";

    public static void Map(WebApplication app)
    {
        app.MapGet("/api/worker-check/{code}", (Db db, string code) =>
        {
            var worker = Passport.WorkerByCode(db, code.Trim().ToUpperInvariant());
            if (worker is null)
            {
                return Results.Json(new
                {
                    found = false,
                    canRequest = false,
                    message = "No worker uses that short code yet. A field agent must register the worker in person first."
                });
            }

            var level = worker.I("verification_level");
            return Results.Json(new
            {
                found = true,
                verificationLevel = level,
                levelLabel = Passport.LevelLabel(level),
                verified = level >= 2,
                canRequest = level >= 1,
                message = level < 1
                    ? "This passport is not documented yet. A field agent must capture the worker's face and ID in person."
                    : "A hiring check needs the worker's approval. Nothing is shown before that."
            });
        });

        app.MapPost("/api/hiring-checks/otp", async (HttpContext ctx, Db db, AppInfo info) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var body = await Api.BodyAsync(ctx);
            var code = body.Str("code").Trim().ToUpperInvariant();
            var worker = Passport.WorkerByCode(db, code)
                         ?? throw ApiException.NotFound("No worker has that short code. Check the card or ask a field agent to register them.");
            if (worker.I("verification_level") < 1)
                throw ApiException.Conflict("This worker is not yet documented (L1). A field agent can complete the registration first.");

            var workerId = worker.S("user_id")!;
            var phone = db.Str("SELECT phone_e164 FROM users WHERE id = @id", new { id = workerId })
                        ?? throw ApiException.NotFound("Worker phone not found.");
            var recent = db.Int(@"SELECT COUNT(*) FROM otps WHERE phone_e164 = @p AND purpose = 'hiring_consent'
                                 AND created_at > @w", new { p = phone, w = Ts.HoursFromNow(-0.25) });
            if (recent >= 5)
                throw new ApiException(429, "Too many requests", "Wait 15 minutes before requesting another code.");

            var otpCode = Codes.Otp();
            db.Exec(@"INSERT INTO otps (id, phone_e164, code, purpose, expires_at, created_at)
                      VALUES (@id,@p,@c,'hiring_consent',@e,@n)",
                new
                {
                    id = Ids.New("otp"), p = phone, c = otpCode,
                    e = Ts.HoursFromNow(0.1667), n = Ts.Now()
                });

            var farmerPlace = db.Str("SELECT farm_name FROM farmers WHERE user_id = @id", new { id = farmer.Id })
                              ?? "a farm";
            var lang = db.Str("SELECT language_code FROM users WHERE id = @id", new { id = workerId }) ?? "en";
            Notify.Send(db, workerId, "Approve a hiring check with a code",
                $"{farmer.Name} ({farmerPlace}) asks to see your WorkerLink Passport for a hiring check. " +
                $"If you agree, give them this code: {otpCode}. It expires in 10 minutes. " +
                "They will see your photo, name, village, level, last three employers and record status for 24 hours. " +
                "If you did not expect this, ignore it. You can revoke sharing later in KraaLink.",
                lang, new { action = "hiring_otp" }, "sms");

            Audit.Log(db, ctx, "hiring_check.otp_sent", "consent", null, "otps",
                details: "Approval code sent to the worker's phone; no passport fields returned");
            return Results.Json(new
            {
                sent = true,
                channel = "SMS / WhatsApp (simulated in this demo)",
                demoCode = info.DemoMode ? otpCode : null,
                expiresInMinutes = 10,
                message = "Ask the worker to read you the code only if they agree."
            });
        });

        app.MapPost("/api/hiring-checks", async (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var body = await Api.BodyAsync(ctx);
            var code = body.Str("code").Trim().ToUpperInvariant();
            var purpose = body.Str("purpose", false, "Pre-employment hiring check").Trim();
            if (purpose.Length is < 5 or > 160)
                throw ApiException.Bad("Describe the purpose of the check in 160 characters or fewer.");

            var worker = Passport.WorkerByCode(db, code)
                         ?? throw ApiException.NotFound("No worker has that short code. Check the card or ask a field agent to register them.");
            if (worker.I("verification_level") < 1)
                throw ApiException.Conflict("This worker is not yet documented (L1). A field agent can complete the registration first.");

            var workerId = worker.S("user_id")!;
            var otpCode = body.StrOrNull("otpCode");
            var window = Settings.Int(db, "consent_window_hours", 24);
            var now = Ts.Now();

            var existing = db.Row(@"SELECT * FROM consents WHERE worker_id = @w AND farmer_id = @f AND status = 'pending'
                                    ORDER BY requested_at DESC LIMIT 1",
                new { w = workerId, f = farmer.Id });
            if (existing is not null && otpCode is null)
            {
                return Results.Json(new
                {
                    id = existing.S("id"), status = existing.S("status"),
                    message = "A request is already waiting for the worker's decision."
                }, statusCode: 202);
            }

            var otp = otpCode is null ? null : VerifyHiringOtp(db, workerId, otpCode);
            var farmerPlace = db.Str("SELECT farm_name FROM farmers WHERE user_id = @id", new { id = farmer.Id })
                              ?? "a farmer";
            var workerLang = db.Str("SELECT language_code FROM users WHERE id = @id", new { id = workerId }) ?? "en";

            if (existing is not null)
            {
                var existingId = existing.S("id")!;
                db.Begin();
                try
                {
                    db.Exec(@"UPDATE consents SET status = 'granted', granted_at = @now, expires_at = @exp
                              WHERE id = @id", new { now, exp = Ts.HoursFromNow(window), id = existingId });
                    if (otp is not null)
                        db.Exec("UPDATE otps SET consumed_at = @now WHERE id = @id", new { now, id = otp.S("id") });
                    Notify.Send(db, workerId, "Hiring check approved with your phone code",
                        $"{farmer.Name} ({farmerPlace}) used the approval code you gave them. Your photo, name, village, level, last three employers and record status are visible to them for {window} hours. You can revoke sharing in KraaLink at any time.",
                        workerLang, new { consentId = existingId, action = "respond_consent" }, "whatsapp");
                    Audit.Log(db, ctx, "consent.granted", "consent", existingId, "consents",
                        new { status = "pending" }, new { status = "granted", channel = "worker_otp" }, "status",
                        "Worker approved a waiting request with a one-time phone code");
                    db.Commit();
                }
                catch
                {
                    db.Dispose();
                    throw;
                }

                return Results.Json(new
                {
                    id = existingId,
                    status = "granted",
                    message = $"The worker's phone code confirmed consent. You can open the passport for the next {window} hours. The view is logged."
                });
            }

            var id = Ids.New("con");
            db.Begin();
            try
            {
                if (otp is not null)
                {
                    db.Exec(@"INSERT INTO consents (id, worker_id, farmer_id, status, purpose, window_hours,
                                requested_at, granted_at, expires_at)
                              VALUES (@id,@w,@f,'granted',@p,@h,@now,@now,@exp)",
                        new { id, w = workerId, f = farmer.Id, p = purpose, h = window, now, exp = Ts.HoursFromNow(window) });
                    db.Exec("UPDATE otps SET consumed_at = @now WHERE id = @id", new { now, id = otp.S("id") });
                    Notify.Send(db, workerId, "Hiring check approved with your phone code",
                        $"{farmer.Name} ({farmerPlace}) used the approval code you gave them. Your photo, name, village, level, last three employers and record status are visible to them for {window} hours. You can revoke sharing in KraaLink at any time.",
                        workerLang, new { consentId = id, action = "respond_consent" }, "whatsapp");
                    Audit.Log(db, ctx, "consent.granted", "consent", id, "consents",
                        new { status = "none" }, new { status = "granted", channel = "worker_otp" }, "status",
                        "Worker approved a hiring check with a one-time phone code; no code retained");
                }
                else
                {
                    db.Exec(@"INSERT INTO consents (id, worker_id, farmer_id, status, purpose, window_hours, requested_at)
                              VALUES (@id,@w,@f,'pending',@p,@h,@now)",
                        new { id, w = workerId, f = farmer.Id, p = purpose, h = window, now });

                    Notify.Send(db, workerId, "Hiring check request from " + farmer.Name,
                        $"{farmer.Name} ({farmerPlace}) asks to see your WorkerLink Passport for: {purpose}. " +
                        $"If you approve, they will see your photo, name, village, level, last three employers and record status for {window} hours. " +
                        "They will never see your next-of-kin contacts or ID documents. Reply in KraaLink to approve or deny.",
                        workerLang, new { consentId = id, action = "respond_consent" }, "whatsapp");

                    Audit.Log(db, ctx, "hiring_check.created", "consent", id, "consents",
                        details: "Farmer requested consent; no worker fields returned until approval");
                }
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new
            {
                id,
                status = otp is null ? "pending" : "granted",
                message = otp is null
                    ? "The worker has been asked on WhatsApp. You will see nothing until they approve — this is their decision."
                    : $"The worker's phone code confirmed consent. You can open the passport for the next {window} hours. The view is logged."
            }, statusCode: 201);
        });

        app.MapGet("/api/hiring-checks/mine", (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var rows = db.Rows(@"SELECT c.*, w.full_name AS worker_name, w.short_code, w.verification_level
                                 FROM consents c JOIN workers w ON w.user_id = c.worker_id
                                 WHERE c.farmer_id = @f ORDER BY c.requested_at DESC LIMIT 50", new { f = farmer.Id });
            foreach (var row in rows)
            {
                if (row.S("status") == "granted" && Ts.IsPast(row.S("expires_at")))
                {
                    db.Exec("UPDATE consents SET status = 'expired' WHERE id = @id", new { id = row.S("id") });
                    row["status"] = "expired";
                }
            }
            return Results.Json(rows.Select(c => new
            {
                id = c.S("id"),
                status = c.S("status"),
                purpose = c.S("purpose"),
                requestedAt = c.S("requested_at"),
                grantedAt = c.S("granted_at"),
                expiresAt = c.S("expires_at"),
                workerName = c.S("status") is "granted" or "expired" or "revoked" ? c.S("worker_name") : null,
                shortCode = c.S("short_code"),
                verificationLevel = c.I("verification_level"),
                canView = c.S("status") == "granted" && !Ts.IsPast(c.S("expires_at"))
            }));
        });

        app.MapGet("/api/hiring-checks/{id}", (HttpContext ctx, Db db, string id) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var consent = db.Row("SELECT * FROM consents WHERE id = @id", new { id })
                          ?? throw ApiException.NotFound("Hiring check not found.");
            if (consent.S("farmer_id") != farmer.Id) throw ApiException.Forbidden();

            if (consent.S("status") == "granted" && Ts.IsPast(consent.S("expires_at")))
            {
                db.Exec("UPDATE consents SET status = 'expired' WHERE id = @id", new { id });
                consent["status"] = "expired";
            }

            return Results.Json(new
            {
                id = consent.S("id"),
                status = consent.S("status"),
                purpose = consent.S("purpose"),
                requestedAt = consent.S("requested_at"),
                grantedAt = consent.S("granted_at"),
                expiresAt = consent.S("expires_at"),
                canView = consent.S("status") == "granted" && !Ts.IsPast(consent.S("expires_at")),
                message = consent.S("status") switch
                {
                    "pending" => "Waiting for the worker to approve. You cannot see the passport yet.",
                    "denied" => "The worker declined this request. No record data is available.",
                    "revoked" => "The worker revoked sharing. No data is returned.",
                    "expired" => "This consent has expired. Start a new hiring check.",
                    _ => "Consent granted within the time window."
                }
            });
        });

        app.MapGet("/api/hiring-checks/{id}/passport", (HttpContext ctx, Db db, string id) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var consent = db.Row("SELECT * FROM consents WHERE id = @id", new { id })
                          ?? throw ApiException.NotFound("Hiring check not found.");
            if (consent.S("farmer_id") != farmer.Id) throw ApiException.Forbidden("This is not your hiring check.");
            if (consent.S("status") != "granted")
                throw ApiException.Forbidden("The worker has not approved this request, so no passport data is shown.");
            if (Ts.IsPast(consent.S("expires_at")))
            {
                db.Exec("UPDATE consents SET status = 'expired' WHERE id = @id", new { id });
                throw ApiException.Forbidden("This consent has expired.");
            }

            var worker = Passport.Worker(db, consent.S("worker_id")!)
                         ?? throw ApiException.NotFound("Worker not found.");
            var view = Passport.PassportView(db, worker, consent.S("id"));
            Audit.Access(db, ctx, farmer, consent.S("worker_id")!, consent.S("id")!, consent.S("purpose")!, PassportFields);
            Audit.Log(db, ctx, "passport.viewed", "worker", consent.S("worker_id"), "access_log",
                details: "Consented hiring check; fields=" + PassportFields);

            return Results.Json(new
            {
                passport = view,
                consent = new { id = consent.S("id"), purpose = consent.S("purpose"), expiresAt = consent.S("expires_at") }
            });
        });

        app.MapGet("/api/consents/mine", (HttpContext ctx, Db db) =>
        {
            var worker = Auth.Require(ctx, "worker");
            var rows = db.Rows(@"SELECT c.*, u.full_name AS farmer_name, COALESCE(f.farm_name, '') AS farm_name,
                                        u.phone_e164 AS farmer_phone
                                 FROM consents c JOIN users u ON u.id = c.farmer_id
                                 LEFT JOIN farmers f ON f.user_id = c.farmer_id
                                 WHERE c.worker_id = @w ORDER BY c.requested_at DESC LIMIT 50", new { w = worker.Id });
            foreach (var row in rows)
            {
                if (row.S("status") == "granted" && Ts.IsPast(row.S("expires_at")))
                {
                    db.Exec("UPDATE consents SET status = 'expired' WHERE id = @id", new { id = row.S("id") });
                    row["status"] = "expired";
                }
            }
            return Results.Json(rows.Select(c => new
            {
                id = c.S("id"),
                status = c.S("status"),
                purpose = c.S("purpose"),
                farmerName = c.S("farmer_name"),
                farmName = c.S("farm_name"),
                requestedAt = c.S("requested_at"),
                grantedAt = c.S("granted_at"),
                expiresAt = c.S("expires_at"),
                windowHours = c.I("window_hours"),
                mayApprove = c.S("status") == "pending"
            }));
        });

        app.MapPost("/api/consents/{id}/respond", async (HttpContext ctx, Db db, string id) =>
        {
            var worker = Auth.Require(ctx, "worker");
            var consent = db.Row("SELECT * FROM consents WHERE id = @id", new { id })
                          ?? throw ApiException.NotFound("Request not found.");
            if (consent.S("worker_id") != worker.Id) throw ApiException.Forbidden();
            if (consent.S("status") != "pending")
                throw ApiException.Conflict("This request has already been decided.");

            var body = await Api.BodyAsync(ctx);
            var approve = body.Bool("approve");
            var now = Ts.Now();

            db.Begin();
            try
            {
                if (approve)
                {
                    var window = Settings.Int(db, "consent_window_hours", 24);
                    db.Exec(@"UPDATE consents SET status = 'granted', granted_at = @now, expires_at = @exp
                              WHERE id = @id", new { now, exp = Ts.HoursFromNow(window), id });
                }
                else
                {
                    db.Exec("UPDATE consents SET status = 'denied', denied_at = @now WHERE id = @id", new { now, id });
                }

                var farmerLang = db.Str("SELECT language_code FROM users WHERE id = @id",
                    new { id = consent.S("farmer_id") }) ?? "en";
                Notify.Send(db, consent.S("farmer_id")!, approve ? "Hiring check approved" : "Hiring check declined",
                    approve
                        ? $"{worker.Name} approved your hiring check. Open it in KraaLink to see only the agreed fields. This view is logged."
                        : $"{worker.Name} declined your hiring check. No passport data is available.",
                    farmerLang, new { consentId = id, action = "hiring" });

                Audit.Log(db, ctx, approve ? "consent.granted" : "consent.denied", "consent", id, "consents",
                    new { status = "pending" }, new { status = approve ? "granted" : "denied" }, "status");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new { ok = true, status = approve ? "granted" : "denied" });
        });

        app.MapPost("/api/consents/{id}/revoke", (HttpContext ctx, Db db, string id) =>
        {
            var worker = Auth.Require(ctx, "worker");
            var consent = db.Row("SELECT * FROM consents WHERE id = @id", new { id })
                          ?? throw ApiException.NotFound("Consent not found.");
            if (consent.S("worker_id") != worker.Id) throw ApiException.Forbidden();
            if (consent.S("status") is not ("granted" or "pending"))
                throw ApiException.Conflict("There is nothing to revoke.");

            db.Exec("UPDATE consents SET status = 'revoked', revoked_at = @now WHERE id = @id",
                new { now = Ts.Now(), id });
            Notify.Send(db, consent.S("farmer_id")!, "Hiring check revoked",
                $"{worker.Name} revoked sharing. New checks return no data. Past employment facts stay under the retention schedule.",
                "en", new { consentId = id });
            Audit.Log(db, ctx, "consent.revoked", "consent", id, "consents",
                new { status = consent.S("status") }, new { status = "revoked" }, "status");
            return Results.Json(new { ok = true, status = "revoked" });
        });
    }

    private static Dictionary<string, object?> VerifyHiringOtp(Db db, string workerId, string otpCode)
    {
        var phone = db.Str("SELECT phone_e164 FROM users WHERE id = @id", new { id = workerId })
                    ?? throw ApiException.NotFound("Worker phone not found.");
        var otp = db.Row(@"SELECT * FROM otps WHERE phone_e164 = @p AND purpose = 'hiring_consent'
                           AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1", new { p = phone })
                  ?? throw ApiException.Bad("No approval code is waiting for this worker. Send a new code first.");
        if (Ts.IsPast(otp.S("expires_at")))
            throw new ApiException(401, "Code expired", "Send a new approval code to the worker's phone.");
        if (otp.I("attempts") >= 5)
            throw new ApiException(429, "Too many attempts", "Send a new approval code to the worker's phone.");
        if (!string.Equals(otp.S("code"), otpCode, StringComparison.Ordinal))
        {
            db.Exec("UPDATE otps SET attempts = attempts + 1 WHERE id = @id", new { id = otp.S("id") });
            throw new ApiException(401, "Code not valid", "Enter the code the worker reads to you. Do not guess.");
        }
        return otp;
    }
}
