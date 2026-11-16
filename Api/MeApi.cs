namespace KraaLink;

public static class MeApi
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/me", (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx);
            return Results.Json(Passport.Me(db, user));
        });

        app.MapPatch("/api/me", async (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx);
            var body = await Api.BodyAsync(ctx);
            var name = body.StrOrNull("name");
            var language = body.StrOrNull("language");
            if (name is { Length: < 3 }) throw ApiException.Bad("Enter your full name.");
            if (language is not null && !Geo.KnownLanguage(language)) throw ApiException.Bad("Unsupported language.");

            var old = db.Row("SELECT full_name, language_code FROM users WHERE id = @id", new { id = user.Id });
            db.Exec(@"UPDATE users SET full_name = COALESCE(@name, full_name), language_code = COALESCE(@lang, language_code)
                      WHERE id = @id", new { name, lang = language, id = user.Id });
            if (user.Role == "worker" && name is not null)
                db.Exec("UPDATE workers SET full_name = @name WHERE user_id = @id", new { name, id = user.Id });

            var updated = db.Row("SELECT id, role, phone_e164, full_name, language_code FROM users WHERE id = @id",
                new { id = user.Id })!;
            Audit.Log(db, ctx, "profile.updated", "user", user.Id, "users", old,
                new { full_name = updated.S("full_name"), language_code = updated.S("language_code") },
                "full_name,language_code");
            return Results.Json(Passport.Me(db,
                new UserCtx(user.Id, user.Role, updated.S("full_name")!, updated.S("phone_e164")!,
                    updated.S("language_code") ?? "en")));
        });

        app.MapGet("/api/me/face", (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx);
            var fileId = db.Str("SELECT face_path FROM users WHERE id = @id", new { id = user.Id });
            if (string.IsNullOrEmpty(fileId))
                fileId = db.Str("SELECT face_path FROM workers WHERE user_id = @id", new { id = user.Id });
            if (string.IsNullOrEmpty(fileId)) throw ApiException.NotFound("No face photo on this account.");
            var file = Storage.ById(db, fileId);
            if (!File.Exists(file.S("path"))) throw ApiException.NotFound("The photo is not available.");
            return Results.File(file.S("path")!, file.S("mime")!, enableRangeProcessing: true);
        });

        app.MapPatch("/api/me/face", async (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx);
            var body = await Api.BodyAsync(ctx);
            var image = body.StrOrNull("faceImage") ?? throw ApiException.Bad("Capture a face photo.");
            var oldFace = db.Str("SELECT face_path FROM users WHERE id = @id", new { id = user.Id });
            db.Begin();
            try
            {
                var file = Storage.SaveDataUrl(db, image, "face", user.Id);
                var fileId = file.S("id");
                db.Exec("UPDATE users SET face_path = @file WHERE id = @id", new { file = fileId, id = user.Id });
                if (user.Role == "worker")
                    db.Exec("UPDATE workers SET face_path = @file WHERE user_id = @id", new { file = fileId, id = user.Id });
                Audit.Log(db, ctx, "profile.face_updated", "user", user.Id, "users",
                    new { face_path = oldFace }, new { face_path = fileId }, "face_path",
                    "Face photo replaced by the account holder; previous file retained for audit");
                db.Commit();
                return Results.Json(new { ok = true, faceUrl = Storage.Url(fileId!, 10) });
            }
            catch
            {
                db.Dispose();
                throw;
            }
        });

        app.MapGet("/api/me/notifications", (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx);
            var rows = db.Rows(@"SELECT id, channel, direction, language_code, title, body, meta_json, read_at, created_at
                                 FROM notifications WHERE user_id = @u ORDER BY created_at DESC LIMIT 80",
                new { u = user.Id });
            return Results.Json(rows.Select(NotificationView));
        });

        app.MapPost("/api/me/notifications/read", async (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx);
            var body = await Api.BodyAsync(ctx);
            var id = body.StrOrNull("id");
            if (id is null)
                db.Exec("UPDATE notifications SET read_at = @now WHERE user_id = @u AND read_at IS NULL",
                    new { now = Ts.Now(), u = user.Id });
            else
                db.Exec("UPDATE notifications SET read_at = @now WHERE id = @id AND user_id = @u",
                    new { now = Ts.Now(), id, u = user.Id });
            return Results.Json(new { ok = true });
        });

        app.MapGet("/api/dashboard", (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx);
            var cards = new List<object>();
            var actions = new List<object>();

            if (user.Role == "worker")
            {
                var worker = Passport.Worker(db, user.Id);
                var pending = db.Int("SELECT COUNT(*) FROM consents WHERE worker_id = @u AND status = 'pending'", new { u = user.Id });
                var open = db.Int("SELECT COUNT(*) FROM employments WHERE worker_id = @u AND status IN ('open','pending_checkin','pending_checkout','disputed')", new { u = user.Id });
                var mustReply = db.Int(@"SELECT COUNT(*) FROM incidents WHERE worker_id = @u
                                         AND status IN ('under_review','worker_responded') AND worker_response IS NULL", new { u = user.Id });
                cards.Add(Card("Verification", worker is null ? "—" : Passport.LevelShort(worker.I("verification_level")), worker is null ? "" : Passport.LevelLabel(worker.I("verification_level")), "passport"));
                cards.Add(Card("Record status", worker is null ? "—" : Passport.RecordStatus(db, user.Id), "Shown to farmers with your consent", "passport"));
                cards.Add(Card("Consent requests", pending.ToString(), pending == 1 ? "Waiting for your decision" : "Waiting for your decision", "consents"));
                cards.Add(Card("Open jobs", open.ToString(), "Check-ins and closed-out records", "employment"));
                cards.Add(Card("Incidents to answer", mustReply.ToString(), "Your right to respond", "incidents"));
                if (pending > 0) actions.Add(new { title = "A farmer is waiting for your consent", body = "You decide what they may see, for 24 hours.", route = "consents" });
            }
            else if (user.Role == "farmer")
            {
                var active = db.Int("SELECT COUNT(*) FROM listings WHERE farmer_id = @u AND status = 'active'", new { u = user.Id });
                var held = db.Int("SELECT COUNT(*) FROM listings WHERE farmer_id = @u AND status = 'held'", new { u = user.Id });
                var open = db.Int("SELECT COUNT(*) FROM employments WHERE farmer_id = @u AND status IN ('open','pending_checkin','pending_checkout','disputed')", new { u = user.Id });
                var claims = db.Int("SELECT COUNT(*) FROM ownership_claims WHERE claimant_id = @u AND status = 'pending'", new { u = user.Id });
                cards.Add(Card("Active listings", active.ToString(), "Visible to buyers", "marketplace"));
                cards.Add(Card("Held listings", held.ToString(), "Awaiting reviewer check", "marketplace"));
                cards.Add(Card("Employment records", open.ToString(), "Check-in and check-out", "employment"));
                cards.Add(Card("Ownership claims", claims.ToString(), "Matched found reports", "brand"));
                actions.Add(new { title = "Run a hiring check", body = "Enter a worker's short code. The worker must approve before you see anything.", route = "hiring" });
                actions.Add(new { title = "Report found livestock", body = "A blind match can alert the owner without exposing you.", route = "found" });
            }
            else if (user.Role == "agent")
            {
                var regs = db.Int("SELECT COUNT(*) FROM workers WHERE created_at > @w", new { w = Ts.DaysFromNow(-30) });
                var l0 = db.Int("SELECT COUNT(*) FROM workers WHERE verification_level = 0");
                var l1 = db.Int("SELECT COUNT(*) FROM workers WHERE verification_level = 1");
                cards.Add(Card("Workers registered (30 days)", regs.ToString(), "Agent-assisted sign-ups", "workers"));
                cards.Add(Card("At L0", l0.ToString(), "Face and ID still needed", "workers"));
                cards.Add(Card("At L1", l1.ToString(), "Ready for in-person L2 check", "workers"));
                actions.Add(new { title = "Register a worker", body = "Capture the face photo and ID document in the field.", route = "register-worker" });
            }
            else if (user.IsReviewer)
            {
                cards.Add(Card("Verification queue", db.Long("SELECT COUNT(*) FROM workers WHERE verification_level < 2").ToString(), "Workers below L2", "admin"));
                cards.Add(Card("Claims to review", db.Long("SELECT COUNT(*) FROM ownership_claims WHERE status = 'pending'").ToString(), "Document checks", "admin"));
                cards.Add(Card("Brand checks", db.Long("SELECT COUNT(*) FROM stock_brands WHERE status = 'pending'").ToString(), "Certificates", "admin"));
                cards.Add(Card("Held listings", db.Long("SELECT COUNT(*) FROM listings WHERE status = 'held'").ToString(), "Suspected stolen stock", "admin"));
                cards.Add(Card("Incidents under review", db.Long("SELECT COUNT(*) FROM incidents WHERE status IN ('under_review','worker_responded')").ToString(), "Worker response + evidence", "admin"));
                actions.Add(new { title = "Work the queues", body = "Verification, claims, brands, listings and incidents.", route = "admin" });
            }
            else
            {
                var reports = db.Int("SELECT COUNT(*) FROM found_reports WHERE finder_id = @u", new { u = user.Id });
                var matches = db.Int("SELECT COUNT(*) FROM found_reports WHERE finder_id = @u AND matched_owner_id IS NOT NULL", new { u = user.Id });
                cards.Add(Card("Found reports", reports.ToString(), "Your reports", "found"));
                cards.Add(Card("Matches found", matches.ToString(), "Owner alerted, not yet verified", "found"));
                actions.Add(new { title = "Report found livestock", body = "Send a photo, brand or ear-tag number. Your identity stays hidden.", route = "found" });
            }

            var activity = db.Rows(@"SELECT id, channel, direction, language_code, title, body, meta_json, read_at, created_at
                                     FROM notifications WHERE user_id = @u ORDER BY created_at DESC LIMIT 6",
                new { u = user.Id }).Select(NotificationView).ToList();

            return Results.Json(new { cards, actions, activity });
        });
    }

    private static object Card(string label, string value, string hint, string route) =>
        new { label, value, hint, route };

    public static object NotificationView(Dictionary<string, object?> r) => new
    {
        id = r.S("id"),
        channel = r.S("channel"),
        direction = r.S("direction"),
        language = r.S("language_code"),
        title = r.S("title"),
        body = r.S("body"),
        meta = r.S("meta_json"),
        readAt = r.S("read_at"),
        createdAt = r.S("created_at")
    };
}
