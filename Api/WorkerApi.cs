using System.Globalization;
using System.Security;
using QRCoder;

namespace KraaLink;

public static class WorkerApi
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/workers", (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx, "agent", "verifier", "reviewer", "admin");
            var q = ctx.Q("q", "");
            var level = ctx.Q("level", "");
            var rows = db.Rows(@"SELECT w.*, u.phone_e164, u.language_code FROM workers w
                                 JOIN users u ON u.id = w.user_id
                                 WHERE (@q = '' OR w.full_name LIKE @like OR w.short_code LIKE @like)
                                   AND (@level = '' OR w.verification_level = @lvl)
                                 ORDER BY w.created_at DESC LIMIT 100",
                new { q, like = "%" + q + "%", level, lvl = int.TryParse(level, out var l) ? l : -1 });
            Audit.Log(db, ctx, "workers.list", "worker_list", null, details: "Staff opened the worker register");
            return Results.Json(rows.Select(w => new
            {
                id = w.S("user_id"),
                name = w.S("full_name"),
                shortCode = w.S("short_code"),
                verificationLevel = w.I("verification_level"),
                levelLabel = Passport.LevelLabel(w.I("verification_level")),
                village = w.S("home_village"),
                regionCode = w.S("region_code"),
                regionName = Geo.RegionName(w.S("region_code")),
                phone = user.Role == "reviewer" || user.Role == "admin" ? w.S("phone_e164") : null,
                faceUrl = string.IsNullOrEmpty(w.S("face_path")) ? null : Storage.Url(w.S("face_path")!, 10),
                recordStatus = Passport.RecordStatus(db, w.S("user_id")!),
                createdAt = w.S("created_at")
            }));
        });

        app.MapGet("/api/workers/{id}", (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.Require(ctx);
            if (user.Role != "worker" && !user.IsStaff)
                throw ApiException.Forbidden("Workers control who sees their passport.");
            if (user.Role == "worker" && user.Id != id)
                throw ApiException.Forbidden("You can only open your own passport.");

            var w = Passport.Worker(db, id) ?? throw ApiException.NotFound("Worker not found.");
            var isSelf = user.Id == id;
            var idNumber = Crypto.Decrypt(w.S("id_doc_number_encrypted"));
            var kin = db.Rows("SELECT * FROM next_of_kin WHERE worker_id = @id ORDER BY created_at", new { id });
            var refs = db.Rows("SELECT * FROM worker_references WHERE worker_id = @id ORDER BY created_at", new { id });
            var events = db.Rows(@"SELECT v.*, u.full_name AS agent_name FROM verification_events v
                                   LEFT JOIN users u ON u.id = COALESCE(v.agent_id, v.verifier_id)
                                   WHERE v.worker_id = @id ORDER BY v.created_at DESC", new { id });
            var employments = Passport.LastEmployers(db, id, 10);
            var consents = db.Rows(@"SELECT c.*, u.full_name AS farmer_name FROM consents c
                                     JOIN users u ON u.id = c.farmer_id
                                     WHERE c.worker_id = @id ORDER BY c.requested_at DESC LIMIT 20", new { id });

            if (!isSelf)
                Audit.Log(db, ctx, "worker.profile_view", "worker", id, "workers",
                    details: "Staff viewed worker profile; ID number not returned in clear");

            return Results.Json(new
            {
                id = w.S("user_id"),
                name = w.S("full_name"),
                shortCode = w.S("short_code"),
                dob = w.S("dob"),
                idDocType = w.S("id_doc_type"),
                idDocNumber = isSelf ? idNumber : MaskId(idNumber),
                idDocUrl = string.IsNullOrEmpty(w.S("id_doc_path")) ? null : Storage.Url(w.S("id_doc_path")!, 10),
                faceUrl = string.IsNullOrEmpty(w.S("face_path")) ? null : Storage.Url(w.S("face_path")!, 10),
                village = w.S("home_village"),
                constituency = w.S("constituency"),
                regionCode = w.S("region_code"),
                regionName = Geo.RegionName(w.S("region_code")),
                otherPhone = w.S("other_phone"),
                verificationLevel = w.I("verification_level"),
                levelLabel = Passport.LevelLabel(w.I("verification_level")),
                recordStatus = Passport.RecordStatus(db, id),
                consentVersion = w.S("consent_version"),
                consentAt = w.S("consent_at"),
                skills = w.List("skills_json"),
                languages = w.List("languages_json"),
                kin = kin.Select(k => new
                {
                    id = k.S("id"), name = k.S("name"), relationship = k.S("relationship"),
                    phone = k.S("phone_e164"), village = k.S("village")
                }),
                references = refs.Select(r => new
                {
                    id = r.S("id"), name = r.S("name"), role = r.S("ref_role"), phone = r.S("phone_e164")
                }),
                verificationHistory = events.Select(e => new
                {
                    id = e.S("id"), level = e.I("level"), levelLabel = Passport.LevelLabel(e.I("level")),
                    method = e.S("method"), by = e.S("agent_name"), note = e.S("note"), createdAt = e.S("created_at")
                }),
                employments,
                consents = consents.Select(c => new
                {
                    id = c.S("id"), farmer = c.S("farmer_name"), status = c.S("status"), purpose = c.S("purpose"),
                    requestedAt = c.S("requested_at"), expiresAt = c.S("expires_at")
                })
            });
        });

        app.MapPost("/api/workers/otp", async (HttpContext ctx, Db db, AppInfo info) =>
        {
            Auth.Require(ctx, "agent");
            var body = await Api.BodyAsync(ctx);
            var phone = AuthApi.NormalizePhone(body.Str("phone"))
                        ?? throw ApiException.Bad("Enter the worker's phone number such as +264 81 123 4567.");
            if (db.Exists("SELECT 1 FROM users WHERE phone_e164 = @p", new { p = phone }))
                throw ApiException.Conflict("A user already exists for this phone number.");

            var recent = db.Int("SELECT COUNT(*) FROM otps WHERE phone_e164 = @p AND purpose = 'worker_registration' AND created_at > @w",
                new { p = phone, w = Ts.HoursFromNow(-0.25) });
            if (recent >= 5)
                throw new ApiException(429, "Too many requests", "Wait 15 minutes before requesting another code.");

            var code = Codes.Otp();
            db.Exec(@"INSERT INTO otps (id, phone_e164, code, purpose, expires_at, created_at)
                      VALUES (@id,@p,@c,'worker_registration',@e,@n)",
                new
                {
                    id = Ids.New("otp"), p = phone, c = code,
                    e = Ts.HoursFromNow(0.1667), n = Ts.Now()
                });
            Audit.Log(db, ctx, "worker.registration_otp", "auth", MaskPhone(phone),
                details: "One-time code sent to the worker's phone for in-person registration");

            return Results.Json(new
            {
                sent = true,
                channel = "SMS / WhatsApp (simulated in this demo)",
                demoCode = info.DemoMode ? code : null,
                expiresInMinutes = 10
            });
        });

        app.MapPost("/api/workers", async (HttpContext ctx, Db db) =>
        {
            var agent = Auth.Require(ctx, "agent");
            var body = await Api.BodyAsync(ctx);

            var phone = AuthApi.NormalizePhone(body.Str("phone"))
                        ?? throw ApiException.Bad("Enter a valid phone number.");
            if (db.Exists("SELECT 1 FROM users WHERE phone_e164 = @p", new { p = phone }))
                throw ApiException.Conflict("A user already exists for this phone number.");

            var otpCode = body.StrOrNull("otpCode")
                          ?? throw ApiException.Bad("Send a one-time code to the worker's phone first.");
            var otp = db.Row(@"SELECT * FROM otps WHERE phone_e164 = @p AND purpose = 'worker_registration'
                               AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1", new { p = phone })
                      ?? throw ApiException.Bad("No code is waiting for this phone. Send a new code first.");
            if (Ts.IsPast(otp.S("expires_at")))
                throw new ApiException(401, "Code expired", "Send a new code to the worker's phone.");
            if (otp.I("attempts") >= 5)
                throw new ApiException(429, "Too many attempts", "Send a new code to the worker's phone.");
            if (!string.Equals(otp.S("code"), otpCode, StringComparison.Ordinal))
            {
                db.Exec("UPDATE otps SET attempts = attempts + 1 WHERE id = @id", new { id = otp.S("id") });
                throw new ApiException(401, "Code not valid", "Check the code with the worker and try again.");
            }

            var name = body.Str("fullName");
            if (name.Length < 3) throw ApiException.Bad("Enter the worker's full name.");
            var language = body.Str("language", false, "en");
            if (!Geo.KnownLanguage(language)) throw ApiException.Bad("Choose a supported language.");
            var faceImage = body.StrOrNull("faceImage") ?? throw ApiException.Bad("Capture the worker's face photo.");
            var idImage = body.StrOrNull("idDocImage") ?? throw ApiException.Bad("Upload the ID document photo.");
            var idType = body.Str("idDocType");
            if (idType is not ("namibian_id" or "angolan_passport" or "angolan_id" or "birth_certificate"))
                throw ApiException.Bad("Choose a valid ID document type.");
            var idNumber = body.Str("idDocNumber", false, "");
            if (idNumber.Length < 3) throw ApiException.Bad("Enter the ID or passport number exactly as printed.");
            var dob = body.Str("dob", false, "");
            if (!DateTime.TryParseExact(dob, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out var dobDate)
                || dobDate > DateTime.UtcNow.AddYears(-16))
                throw ApiException.Bad("Enter the worker's date of birth. Workers must be at least 16.");
            var region = body.Str("regionCode");
            if (!Geo.KnownRegion(region)) throw ApiException.Bad("Choose the home region.");
            var village = body.Str("village", false, "");
            if (village.Length < 2) throw ApiException.Bad("Enter the worker's home village.");
            var constituency = body.Str("constituency", false, "");
            if (constituency.Length < 2)
                throw ApiException.Bad("Enter the constituency or commune for the home area.");
            if (!body.Bool("consentAccepted"))
                throw ApiException.Bad("The worker must give consent before registration.");

            var kin = body.Arr("nextOfKin");
            if (kin.Count < 2) throw ApiException.Bad("Add two next-of-kin contacts.");
            foreach (var k in kin)
            {
                var kinPhone = AuthApi.NormalizePhone(k.Str("phone")) ?? k.Str("phone");
                if (k.Str("name").Length < 2 || k.Str("relationship").Length < 2 || kinPhone.Trim().Length < 6)
                    throw ApiException.Bad("Each next-of-kin contact needs a name, relationship and phone number.");
            }
            var refs = body.Arr("references");
            if (refs.Count < 1) throw ApiException.Bad("Add at least one reference person.");
            foreach (var r in refs)
            {
                var refPhone = AuthApi.NormalizePhone(r.Str("phone")) ?? r.Str("phone");
                if (r.Str("name").Length < 2 || refPhone.Trim().Length < 6)
                    throw ApiException.Bad("Each reference person needs a name and phone number.");
            }

            var userId = Ids.New("usr");
            db.Begin();
            try
            {
                var face = Storage.SaveDataUrl(db, faceImage, "face", userId);
                var idDoc = Storage.SaveDataUrl(db, idImage, "id_doc", userId);
                var code = UniqueCode(db);

                db.Exec(@"INSERT INTO users (id, role, phone_e164, full_name, language_code, face_path, last_seen_at, created_at)
                          VALUES (@id,'worker',@phone,@name,@lang,@face,@now,@now)",
                    new { id = userId, phone, name, lang = language, face = face.S("id"), now = Ts.Now() });

                db.Exec(@"INSERT INTO workers (user_id, short_code, full_name, dob, id_doc_type, id_doc_number_encrypted,
                            id_doc_path, face_path, other_phone, home_village, constituency, region_code,
                            verification_level, consent_version, consent_at, skills_json, languages_json,
                            last_seen_at, created_at)
                          VALUES (@id,@code,@name,@dob,@type,@num,@iddoc,@face,@other,@village,@const,@region,1,
                            @cv,@ca,@skills,@langs,@now,@now)",
                    new
                    {
                        id = userId, code, name, dob, type = idType, num = Crypto.Encrypt(idNumber),
                        iddoc = idDoc.S("id"), face = face.S("id"), other = body.StrOrNull("otherPhone"),
                        village, @const = constituency, region,
                        cv = body.Str("consentVersion", false, "consent-v1"), ca = Ts.Now(),
                        skills = Passport.JsonList(body.StrList("skills")),
                        langs = Passport.JsonList(body.StrList("languages")), now = Ts.Now()
                    });

                foreach (var k in kin)
                {
                    db.Exec(@"INSERT INTO next_of_kin (id, worker_id, name, relationship, phone_e164, village,
                                listing_confirmed_by_agent, created_at)
                              VALUES (@id,@w,@n,@r,@p,@v,1,@now)",
                        new
                        {
                            id = Ids.New("kin"), w = userId, n = k.Str("name"), r = k.Str("relationship"),
                            p = AuthApi.NormalizePhone(k.Str("phone")) ?? k.Str("phone"),
                            v = k.StrOrNull("village"), now = Ts.Now()
                        });
                }
                foreach (var r in refs)
                {
                    db.Exec(@"INSERT INTO worker_references (id, worker_id, name, ref_role, phone_e164, created_at)
                              VALUES (@id,@w,@n,@r,@p,@now)",
                        new
                        {
                            id = Ids.New("ref"), w = userId, n = r.Str("name"), r = r.StrOrNull("role"),
                            p = AuthApi.NormalizePhone(r.Str("phone")) ?? r.Str("phone"), now = Ts.Now()
                        });
                }

                db.Exec(@"INSERT INTO verification_events (id, worker_id, level, method, agent_id, note, created_at)
                          VALUES (@id,@w,0,'phone_otp',@a,'Worker phone confirmed by one-time code during agent registration',@now)",
                    new { id = Ids.New("ver"), w = userId, a = agent.Id, now = Ts.Now() });
                db.Exec(@"INSERT INTO verification_events (id, worker_id, level, method, agent_id, note, created_at)
                          VALUES (@id,@w,1,'id_and_face',@a,'Agent captured face photo and ID document',@now)",
                    new { id = Ids.New("ver"), w = userId, a = agent.Id, now = Ts.Now() });

                db.Exec("UPDATE otps SET consumed_at = @now WHERE id = @id",
                    new { now = Ts.Now(), id = otp.S("id") });

                Notify.Send(db, userId, "Your WorkerLink Passport is ready",
                    $"Your passport is documented (L1). Short code: {code}. A verifier can raise it to L2 in person.",
                    language);
                Audit.Log(db, ctx, "worker.registered_by_agent", "worker", userId, "workers",
                    details: "Agent-assisted registration; worker phone confirmed by OTP; face and ID captured; ID number encrypted");
                db.Commit();

                return Results.Json(new { workerId = userId, shortCode = code, verificationLevel = 1 }, statusCode: 201);
            }
            catch
            {
                db.Dispose();
                throw;
            }
        });

        app.MapPost("/api/workers/{id}/verifications", async (HttpContext ctx, Db db, string id) =>
        {
            var actor = Auth.Require(ctx, "agent", "verifier", "reviewer", "admin");
            var worker = Passport.Worker(db, id) ?? throw ApiException.NotFound("Worker not found.");
            var body = await Api.BodyAsync(ctx);
            var level = body.Int("level");
            if (level is < 0 or > 2) throw ApiException.Bad("Level must be 0, 1 or 2.");

            if (level >= 1 && (string.IsNullOrEmpty(worker.S("face_path")) || string.IsNullOrEmpty(worker.S("id_doc_path"))))
                throw ApiException.Bad("L1 needs a face photo and an ID document photo on file.");
            if (level == 2)
            {
                var verifier = body.Str("verifierName", false, "");
                if (verifier.Length < 3)
                    throw ApiException.Bad("L2 needs the verifier's name (headman, church leader or agent who met the worker).");
            }
            if (level > worker.I("verification_level") + 1)
                throw ApiException.Bad("Raise the level one step at a time.");

            var method = body.Str("method", false, level == 2 ? "in_person" : "document_check");
            var note = body.Str("note", false, level == 2
                ? "Met in person; village and next of kin confirmed by phone."
                : "Documents checked.");

            db.Begin();
            try
            {
                db.Exec("UPDATE workers SET verification_level = @l WHERE user_id = @id",
                    new { l = level, id });
                db.Exec(@"INSERT INTO verification_events (id, worker_id, level, method, agent_id, verifier_id, note, created_at)
                          VALUES (@id,@w,@l,@m,@a,@v,@n,@now)",
                    new
                    {
                        id = Ids.New("ver"), w = id, l = level, m = method,
                        a = actor.Role == "agent" ? actor.Id : null,
                        v = actor.Role == "verifier" || actor.Role == "reviewer" || actor.Role == "admin"
                            ? actor.Id : body.StrOrNull("verifierId"),
                        n = note + (body.StrOrNull("verifierName") is { } vn ? " Verifier: " + vn : ""),
                        now = Ts.Now()
                    });
                Notify.Send(db, id, "Your passport level changed to L" + level,
                    level == 2
                        ? "Your WorkerLink Passport is now community verified (L2). The Verified badge appears on your card."
                        : $"Your passport is now L{level}. You decide who may view it.",
                    db.Str("SELECT language_code FROM users WHERE id = @id", new { id }) ?? "en");
                Audit.Log(db, ctx, "worker.verification_level_changed", "worker", id, "workers",
                    new { verification_level = worker.I("verification_level") },
                    new { verification_level = level }, "verification_level", "Method: " + method);
                db.Commit();
                return Results.Json(new { ok = true, verificationLevel = level, levelLabel = Passport.LevelLabel(level) });
            }
            catch
            {
                db.Dispose();
                throw;
            }
        });

        app.MapGet("/api/workers/{id}/qrcard", (HttpContext ctx, Db db, string id) =>
        {
            var code = db.Str("SELECT short_code FROM workers WHERE user_id = @id", new { id });
            if (code is null) throw ApiException.NotFound("Worker not found.");
            var url = $"{ctx.Request.Scheme}://{ctx.Request.Host}/#/check?code={code}";
            using var gen = new QRCodeGenerator();
            using var data = gen.CreateQrCode(url, QRCodeGenerator.ECCLevel.Q);
            var png = new PngByteQRCode(data).GetGraphic(12);
            return Results.File(png, "image/png", $"kraalink-{code}.png");
        });

        app.MapGet("/api/workers/{id}/card", (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.Require(ctx);
            if (user.Id != id && !user.IsStaff)
                throw ApiException.Forbidden("This card belongs to the worker.");
            var w = Passport.Worker(db, id) ?? throw ApiException.NotFound("Worker not found.");
            var code = w.S("short_code")!;
            var face = string.IsNullOrEmpty(w.S("face_path")) ? null : Storage.Url(w.S("face_path")!, 10);
            var qr = $"/api/workers/{id}/qrcard";
            var level = w.I("verification_level");
            var html = $@"<!doctype html><html><head><meta charset='utf-8'><title>WorkerLink card {Esc(code)}</title>
<style>
body{{margin:0;background:#e8e4d6;font-family:Segoe UI,Arial,sans-serif;display:grid;place-items:center;min-height:100vh}}
.card{{width:520px;background:#0b3d24;color:#fff;border-radius:22px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.25)}}
.top{{display:flex;justify-content:space-between;align-items:center;padding:22px 26px;border-bottom:1px solid rgba(255,255,255,.18)}}
.brand{{font-family:Georgia,serif;font-size:26px;letter-spacing:.5px}}.brand span{{color:#f2a03d}}
.body{{display:flex;gap:20px;padding:26px}}
img.face{{width:118px;height:140px;object-fit:cover;border-radius:14px;border:3px solid rgba(255,255,255,.5);background:#14532d}}
.name{{font-size:24px;font-weight:700;margin:0 0 4px}}.meta{{font-size:13px;color:#cfe6d7;margin:3px 0}}
.code{{font-family:Consolas,monospace;font-size:26px;letter-spacing:3px;color:#f2a03d;margin-top:12px}}
.qr{{background:#fff;padding:8px;border-radius:12px;width:110px;height:110px;margin-left:auto}}
.foot{{padding:16px 26px 22px;font-size:11px;color:#b9d6c3;line-height:1.5}}
.badge{{display:inline-block;background:{(level >= 2 ? "#2e9e5b" : "#8a6d1f")};padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;margin-top:8px}}
@media print{{body{{background:#fff}}.card{{box-shadow:none}}}}
</style></head><body><div class='card'>
<div class='top'><div class='brand'>Kraa<span>Link</span></div><div style='font-size:12px;color:#b9d6c3'>WorkerLink Passport</div></div>
<div class='body'><div>{(face is null ? "<div style='width:118px;height:140px;border-radius:14px;background:#14532d;display:grid;place-items:center;font-size:40px'>" + Esc(w.S("full_name")![..1]) + "</div>" : $"<img class='face' src='{face}' alt='Worker face photo'>")}</div>
<div style='flex:1'><p class='name'>{Esc(w.S("full_name"))}</p>
<p class='meta'>{Esc(w.S("home_village"))} · {Esc(Geo.RegionName(w.S("region_code")))}</p>
<p class='meta'>Passport {Esc(Passport.LevelLabel(level))}</p>
<div class='badge'>{(level >= 2 ? "VERIFIED" : "NOT YET VERIFIED")}</div>
<div class='code'>{Esc(code)}</div></div>
<div><img class='qr' src='{qr}' alt='QR code for {Esc(code)}'></div></div>
<div class='foot'>Scan the QR or enter the short code in KraaLink. The worker must approve every hiring check. Next-of-kin contacts and ID documents are never shown to a farmer. This card is not a national identity document.</div>
</div></body></html>";
            return Results.Content(html, "text/html; charset=utf-8");
        });
    }

    private static string UniqueCode(Db db)
    {
        for (var i = 0; i < 30; i++)
        {
            var code = Codes.ShortCode();
            if (!db.Exists("SELECT 1 FROM workers WHERE UPPER(short_code) = @c", new { c = code })) return code;
        }
        throw new ApiException(500, "Could not allocate a code", "Try again.");
    }

    private static string MaskId(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "—";
        return value.Length <= 4 ? "••••" : new string('•', value.Length - 4) + value[^4..];
    }

    private static string MaskPhone(string value) =>
        value.Length <= 4 ? "••••" : new string('•', value.Length - 4) + value[^4..];

    private static string Esc(string? value) => SecurityElement.Escape(value ?? "") ?? "";
}
