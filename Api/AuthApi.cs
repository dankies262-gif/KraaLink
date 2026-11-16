namespace KraaLink;

public static class AuthApi
{
    public static void Map(WebApplication app)
    {
        app.MapPost("/api/auth/otp/request", async (HttpContext ctx, Db db, AppInfo info) =>
        {
            var body = await Api.BodyAsync(ctx);
            var phone = NormalizePhone(body.Str("phone"))
                        ?? throw ApiException.Bad("Enter a phone number such as +264 81 123 4567.");

            var window = Ts.HoursFromNow(-0.25);
            var recent = db.Int("SELECT COUNT(*) FROM otps WHERE phone_e164 = @p AND created_at > @w",
                new { p = phone, w = window });
            if (recent >= 5)
                throw new ApiException(429, "Too many requests", "Wait 15 minutes before requesting another code.");

            var code = Codes.Otp();
            db.Exec(@"INSERT INTO otps (id, phone_e164, code, purpose, expires_at, created_at)
                      VALUES (@id,@p,@c,'login',@e,@n)",
                new
                {
                    id = Ids.New("otp"), p = phone, c = code,
                    e = Ts.HoursFromNow(0.1667), n = Ts.Now()
                });

            var user = db.Row("SELECT * FROM users WHERE phone_e164 = @p", new { p = phone });
            if (user is not null)
            {
                Notify.Send(db, user.S("id")!, "Your KraaLink sign-in code",
                    $"Your one-time code is {code}. It expires in 10 minutes. KraaLink will never ask you to share this code.",
                    user.S("language_code") ?? "en", null, "whatsapp");
            }

            Audit.Log(db, ctx, "auth.otp_requested", "auth", Mask(phone), details: "One-time code requested");
            return Results.Json(new
            {
                sent = true,
                channel = "WhatsApp (simulated in this demo)",
                demoCode = info.DemoMode ? code : null,
                expiresInMinutes = 10
            });
        });

        app.MapPost("/api/auth/otp/verify", async (HttpContext ctx, Db db, AppInfo info) =>
        {
            var body = await Api.BodyAsync(ctx);
            var phone = NormalizePhone(body.Str("phone"))
                        ?? throw ApiException.Bad("Enter a valid phone number.");
            var code = body.Str("code");

            var otp = db.Row(@"SELECT * FROM otps WHERE phone_e164 = @p AND consumed_at IS NULL
                               ORDER BY created_at DESC LIMIT 1", new { p = phone })
                      ?? throw new ApiException(401, "Code not valid", "Request a new code.");

            if (Ts.IsPast(otp.S("expires_at")))
                throw new ApiException(401, "Code expired", "Request a new code.");
            if (otp.I("attempts") >= 5)
                throw new ApiException(429, "Too many attempts", "Request a new code.");

            if (!string.Equals(otp.S("code"), code, StringComparison.Ordinal))
            {
                db.Exec("UPDATE otps SET attempts = attempts + 1 WHERE id = @id", new { id = otp.S("id") });
                throw new ApiException(401, "Code not valid", "Check the code and try again.");
            }

            db.Exec("UPDATE otps SET consumed_at = @now WHERE id = @id",
                new { now = Ts.Now(), id = otp.S("id") });

            var user = db.Row("SELECT * FROM users WHERE phone_e164 = @p", new { p = phone });
            if (user is null)
            {
                return Results.Json(new
                {
                    needsSignup = true,
                    signupToken = Auth.SignupToken(phone),
                    phone
                });
            }

            return Issue(db, ctx, user);
        });

        app.MapPost("/api/auth/signup", async (HttpContext ctx, Db db, AppInfo info) =>
        {
            var body = await Api.BodyAsync(ctx);
            var phone = Auth.ReadSignupPhone(body.Str("signupToken"))
                        ?? throw new ApiException(401, "Sign-up session expired", "Verify your phone number again.");

            if (db.Exists("SELECT 1 FROM users WHERE phone_e164 = @p", new { p = phone }))
                throw ApiException.Conflict("An account already exists for this number. Sign in instead.");

            var chosen = Roles.Find(body.StrOrNull("roleChoice"));
            if (chosen is { InviteOnly: true })
                throw ApiException.Bad("That role is created by an administrator. Choose another role or ask KraaLink for an invitation.");
            var role = chosen?.BaseRole ?? body.Str("role");
            if (role is not ("worker" or "farmer" or "finder"))
                throw ApiException.Bad("Choose a role from the list, or describe your role.");

            var roleTitle = (body.StrOrNull("roleTitle") ?? chosen?.Label ?? "").Trim();
            if (roleTitle.Length == 0) roleTitle = chosen?.Label ?? role switch
            {
                "worker" => "Farm worker",
                "farmer" => "Farmer / livestock owner",
                _ => "Community member"
            };
            if (roleTitle.Length is < 2 or > 60)
                throw ApiException.Bad("Describe your role in 60 characters or fewer.");

            var fullName = body.Str("fullName");
            if (fullName.Length < 3) throw ApiException.Bad("Enter your full name.");
            var language = body.Str("language", false, "en");
            if (!Geo.KnownLanguage(language)) throw ApiException.Bad("Choose a supported language.");

            var userId = Ids.New("usr");
            var faceImage = body.StrOrNull("faceImage");
            if (role == "worker" && faceImage is null)
                throw ApiException.Bad("A face photo is required to open a WorkerLink Passport.");
            if (faceImage is not null && !faceImage.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
                throw ApiException.Bad("The face photo must be an image captured by the camera.");

            db.Begin();
            try
            {
                string? faceId = null;
                if (faceImage is not null)
                {
                    var saved = Storage.SaveDataUrl(db, faceImage, "face", userId);
                    faceId = saved.S("id");
                }

                db.Exec(@"INSERT INTO users (id, role, role_title, phone_e164, full_name, language_code, face_path, last_seen_at, created_at)
                          VALUES (@id,@role,@title,@phone,@name,@lang,@face,@now,@now)",
                    new
                    {
                        id = userId, role, title = roleTitle, phone, name = fullName,
                        lang = language, face = faceId, now = Ts.Now()
                    });

                if (role == "worker")
                {
                    var worker = body.Obj("worker") ?? throw ApiException.Bad("Worker details are missing.");
                    var dob = worker.Str("dob");
                    if (!DateTime.TryParseExact(dob, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                            System.Globalization.DateTimeStyles.None, out var dobDate)
                        || dobDate > DateTime.UtcNow.AddYears(-16))
                        throw ApiException.Bad("Enter a valid date of birth. Workers must be at least 16.");

                    var idType = worker.Str("idDocType");
                    if (idType is not ("namibian_id" or "angolan_passport" or "angolan_id" or "birth_certificate"))
                        throw ApiException.Bad("Choose a valid ID document type.");
                    var idNumber = worker.Str("idDocNumber");
                    var idImage = worker.StrOrNull("idDocImage")
                                  ?? throw ApiException.Bad("A photo of the ID document is required for L1.");
                    var village = worker.Str("village");
                    var region = worker.Str("regionCode");
                    if (!Geo.KnownRegion(region)) throw ApiException.Bad("Choose your home region.");
                    var constituency = worker.Str("constituency", false, "");
                    if (constituency.Length < 2)
                        throw ApiException.Bad("Enter your constituency, or your commune if you live in Angola.");

                    var kin = worker.Arr("nextOfKin");
                    if (kin.Count < 2) throw ApiException.Bad("Add two next-of-kin contacts.");
                    var refs = worker.Arr("references");
                    if (refs.Count < 1) throw ApiException.Bad("Add at least one reference person.");
                    if (!worker.Bool("consentAccepted"))
                        throw ApiException.Bad("The worker must give consent before registration.");

                    var idSaved = Storage.SaveDataUrl(db, idImage, "id_doc", userId);
                    var code = UniqueShortCode(db);

                    db.Exec(@"INSERT INTO workers (user_id, short_code, full_name, dob, id_doc_type,
                                id_doc_number_encrypted, id_doc_path, face_path, other_phone, home_village,
                                constituency, region_code, verification_level, consent_version, consent_at,
                                skills_json, languages_json, last_seen_at, created_at)
                              VALUES (@id,@code,@name,@dob,@type,@num,@iddoc,@face,@other,@village,@const,
                                @region,1,@cv,@ca,@skills,@langs,@now,@now)",
                        new
                        {
                            id = userId, code, name = fullName, dob, type = idType,
                            num = Crypto.Encrypt(idNumber), iddoc = idSaved.S("id"), face = faceId,
                            other = worker.StrOrNull("otherPhone"), village,
                            @const = constituency, region,
                            cv = worker.Str("consentVersion", false, "consent-v1"), ca = Ts.Now(),
                            skills = Passport.JsonList(worker.StrList("skills")),
                            langs = Passport.JsonList(worker.StrList("languages")), now = Ts.Now()
                        });

                    foreach (var k in kin)
                    {
                        db.Exec(@"INSERT INTO next_of_kin (id, worker_id, name, relationship, phone_e164, village,
                                    listing_confirmed_by_agent, created_at)
                                  VALUES (@id,@w,@n,@r,@p,@v,0,@now)",
                            new
                            {
                                id = Ids.New("kin"), w = userId, n = k.Str("name"), r = k.Str("relationship"),
                                p = NormalizePhone(k.Str("phone")) ?? k.Str("phone"),
                                v = k.StrOrNull("village"), now = Ts.Now()
                            });
                    }

                    foreach (var r in refs)
                    {
                        db.Exec(@"INSERT INTO worker_references (id, worker_id, name, ref_role, phone_e164, created_at)
                                  VALUES (@id,@w,@n,@r,@p,@now)",
                            new
                            {
                                id = Ids.New("ref"), w = userId, n = r.Str("name"),
                                r = r.StrOrNull("role"), p = NormalizePhone(r.Str("phone")) ?? r.Str("phone"),
                                now = Ts.Now()
                            });
                    }

                    db.Exec(@"INSERT INTO verification_events (id, worker_id, level, method, note, created_at)
                              VALUES (@id,@w,0,'phone_otp','Self-declared at sign-up',@now)",
                        new { id = Ids.New("ver"), w = userId, now = Ts.Now() });
                    db.Exec(@"INSERT INTO verification_events (id, worker_id, level, method, note, created_at)
                              VALUES (@id,@w,1,'id_and_face_upload','Face photo and ID document uploaded at sign-up',@now)",
                        new { id = Ids.New("ver"), w = userId, now = Ts.Now() });

                    Notify.Send(db, userId, "WorkerLink Passport created at L1",
                        "Your passport is documented (L1). A reviewer or field agent can raise it to L2 after an in-person check. " +
                        "Your short code is " + code + ". Keep it on your card.", language);
                    Notify.Staff(db, "reviewer", "New worker registration awaiting spot-check",
                        $"{fullName} registered at L1 with a face photo and ID document.", new { workerId = userId });
                }

                if (role == "farmer")
                {
                    var farmer = body.Obj("farmer") ?? throw ApiException.Bad("Farm details are missing.");
                    var region = farmer.Str("regionCode");
                    if (!Geo.KnownRegion(region)) throw ApiException.Bad("Choose your farm region.");
                    db.Exec(@"INSERT INTO farmers (user_id, farm_name, region_code, dismissed_reports_count, created_at)
                              VALUES (@id,@farm,@region,0,@now)",
                        new
                        {
                            id = userId, farm = farmer.Str("farmName", false, fullName), region, now = Ts.Now()
                        });
                    Notify.Send(db, userId, "Welcome to KraaLink",
                        "Your farmer account is ready. Run a hiring check with a worker short code, list livestock, or report found animals.",
                        language);
                }

                if (role == "finder")
                {
                    db.Exec(@"INSERT INTO farmers (user_id, farm_name, region_code, dismissed_reports_count, created_at)
                              VALUES (@id,'Community reporter',NULL,0,@now)", new { id = userId, now = Ts.Now() });
                    Notify.Send(db, userId, "Welcome to KraaLink",
                        "You can report found livestock anonymously. The owner is alerted, but your identity stays hidden until a claim is approved.",
                        language);
                }

                Audit.Log(db, ctx, "auth.signup", "user", userId,
                    details: $"role={role}; title={roleTitle}; faceCaptured={(faceId is not null)}; no ID value recorded");

                var userRow = db.Row("SELECT * FROM users WHERE id = @id", new { id = userId })!;
                var issued = Issue(db, ctx, userRow, commit: true);
                db.Commit();
                return issued;
            }
            catch
            {
                db.Dispose();
                throw;
            }
        });

        app.MapGet("/api/auth/demo-accounts", (Db db, AppInfo info) =>
        {
            if (!info.DemoMode) return Results.Json(Array.Empty<object>());
            var rows = db.Rows(@"SELECT u.id, u.role, u.phone_e164, u.full_name, u.language_code, w.short_code
                                 FROM users u LEFT JOIN workers w ON w.user_id = u.id
                                 WHERE u.id IN ('usr_maria','usr_johannes','usr_agent','usr_reviewer','usr_admin','usr_tomas','usr_petrus')
                                 ORDER BY CASE u.role WHEN 'worker' THEN 1 WHEN 'farmer' THEN 2 WHEN 'finder' THEN 3
                                          WHEN 'agent' THEN 4 WHEN 'reviewer' THEN 5 ELSE 6 END");
            return Results.Json(rows.Select(r => new
            {
                phone = r.S("phone_e164"),
                role = r.S("role"),
                name = r.S("full_name"),
                shortCode = r.S("short_code"),
                language = r.S("language_code"),
                label = r.S("role") switch
                {
                    "worker" => "Worker passport (L2)",
                    "farmer" => "Farmer · employs a worker",
                    "finder" => "Community finder",
                    "agent" => "Field agent",
                    "reviewer" => "Reviewer",
                    _ => "Administrator"
                }
            }));
        });

        app.MapPost("/api/auth/demo", async (HttpContext ctx, Db db, AppInfo info) =>
        {
            if (!info.DemoMode) throw ApiException.NotFound();
            var body = await Api.BodyAsync(ctx);
            var user = db.Row("SELECT * FROM users WHERE phone_e164 = @p",
                new { p = body.Str("phone") }) ?? throw ApiException.NotFound("Demo account not found.");
            return Issue(db, ctx, user);
        });
    }

    private static IResult Issue(Db db, HttpContext ctx, Dictionary<string, object?> user, bool commit = false)
    {
        var userCtx = new UserCtx(
            user.S("id")!, user.S("role")!, user.S("full_name")!, user.S("phone_e164")!,
            user.S("language_code") ?? "en");
        var now = Ts.Now();
        db.Exec("UPDATE users SET last_seen_at = @now WHERE id = @id", new { now, id = userCtx.Id });
        db.Exec("UPDATE workers SET last_seen_at = @now WHERE user_id = @id", new { now, id = userCtx.Id });
        if (!commit) Audit.Log(db, ctx, "auth.login", "user", userCtx.Id, details: "OTP verified");
        return Results.Json(new
        {
            token = Auth.Token(userCtx),
            user = Passport.Me(db, userCtx)
        });
    }

    private static string UniqueShortCode(Db db)
    {
        for (var i = 0; i < 30; i++)
        {
            var code = Codes.ShortCode();
            if (!db.Exists("SELECT 1 FROM workers WHERE UPPER(short_code) = @c", new { c = code })) return code;
        }
        throw new ApiException(500, "Could not allocate a code", "Try again.");
    }

    public static string? NormalizePhone(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var digits = new string(input.Where(char.IsDigit).ToArray());
        if (input.TrimStart().StartsWith('+')) return digits.Length is >= 8 and <= 15 ? "+" + digits : null;
        if (digits.StartsWith("264") && digits.Length is >= 11 and <= 13) return "+" + digits;
        if (digits.StartsWith('0') && digits.Length == 10) return "+264" + digits[1..];
        return null;
    }

    private static string Mask(string phone) => "…" + phone[^4..];
}
