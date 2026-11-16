namespace KraaLink;

/// <summary>Oversight, configuration and the append-only logs (SRS FR-ADM, FR-AUD, FR-POL).</summary>
public static class AdminApi
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/admin/overview", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var metrics = Metrics(db);
            var queues = new object[]
            {
                new { key = "verification", label = "Passport verification", count = Scalar(db,
                    @"SELECT COUNT(*) FROM workers WHERE verification_level < 2
                      AND face_path IS NOT NULL AND id_doc_path IS NOT NULL"), href = "#/admin/verification" },
                new { key = "brands", label = "Brands pending", count = Scalar(db,
                    "SELECT COUNT(*) FROM stock_brands WHERE status = 'pending'"), href = "#/admin/brands" },
                new { key = "claims", label = "Ownership claims", count = Scalar(db,
                    "SELECT COUNT(*) FROM ownership_claims WHERE status = 'pending'"), href = "#/admin/claims" },
                new { key = "incidents", label = "Open incidents", count = Scalar(db,
                    "SELECT COUNT(*) FROM incidents WHERE status IN ('under_review','worker_responded')"),
                    href = "#/admin/incidents" },
                new { key = "listings", label = "Held listings", count = Scalar(db,
                    "SELECT COUNT(*) FROM listings WHERE status = 'held'"), href = "#/admin/listings" },
                new { key = "found", label = "Found reports open", count = Scalar(db,
                    "SELECT COUNT(*) FROM found_reports WHERE status IN ('open','match_found','claim_pending')"),
                    href = "#/admin/found" },
                new { key = "police", label = "Police requests", count = Scalar(db,
                    "SELECT COUNT(*) FROM police_requests WHERE status = 'pending'"), href = "#/admin/police" },
                new { key = "tags", label = "Tag conflicts", count = Scalar(db,
                    "SELECT COUNT(*) FROM livestock_tags WHERE status = 'conflict'"), href = "#/admin/tags" },
                new { key = "consents", label = "Consents waiting", count = Scalar(db,
                    "SELECT COUNT(*) FROM consents WHERE status = 'pending'"), href = "#/admin/consents" }
            };

            var recentAudit = db.Rows(@"SELECT a.*, u.full_name AS actor_name FROM audit_log a
                                        LEFT JOIN users u ON u.id = a.actor_id
                                        ORDER BY a.created_at DESC LIMIT 8")
                .Select(AuditView).ToList();

            return Results.Json(new
            {
                metrics,
                queues,
                recentAudit,
                generatedAt = Ts.Now()
            });
        });

        app.MapGet("/api/admin/metrics", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            return Results.Json(new
            {
                label = "Demo environment metrics. Pilot targets are in SRS section 2.8.",
                metrics = Metrics(db),
                generatedAt = Ts.Now()
            });
        });

        app.MapGet("/api/admin/queues/verification", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "verifier", "reviewer", "admin");
            var rows = db.Rows(@"SELECT w.*, u.phone_e164, u.created_at AS joined_at
                                 FROM workers w JOIN users u ON u.id = w.user_id
                                 WHERE w.verification_level < 2
                                 ORDER BY w.verification_level DESC, w.created_at ASC LIMIT 100");
            return Results.Json(rows.Select(w => new
            {
                id = w.S("user_id"),
                name = w.S("full_name"),
                shortCode = w.S("short_code"),
                verificationLevel = w.I("verification_level"),
                levelLabel = Passport.LevelLabel(w.I("verification_level")),
                village = w.S("home_village"),
                regionName = Geo.RegionName(w.S("region_code")),
                phone = w.S("phone_e164"),
                hasFace = !string.IsNullOrEmpty(w.S("face_path")),
                hasIdDoc = !string.IsNullOrEmpty(w.S("id_doc_path")),
                faceUrl = Url(w.S("face_path")),
                idDocUrl = Url(w.S("id_doc_path")),
                recordStatus = Passport.RecordStatus(db, w.S("user_id")!),
                createdAt = w.S("created_at")
            }));
        });

        app.MapGet("/api/admin/audit-log", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "admin");
            var action = ctx.Q("action", "");
            var objectType = ctx.Q("object", "");
            var table = ctx.Q("table", "");
            var recordId = ctx.Q("recordId", "");
            var actorId = ctx.Q("actorId", "");
            var q = ctx.Q("q", "");
            var rows = db.Rows(@"SELECT a.*, u.full_name AS actor_name FROM audit_log a
                                 LEFT JOIN users u ON u.id = a.actor_id
                                 WHERE (@action = '' OR a.action LIKE @aLike)
                                   AND (@object = '' OR a.object_type = @object)
                                   AND (@table = '' OR a.table_name = @table)
                                   AND (@record = '' OR a.record_id = @record)
                                   AND (@actor = '' OR a.actor_id = @actor)
                                   AND (@q = '' OR a.action LIKE @qLike OR a.object_type LIKE @qLike
                                        OR a.details LIKE @qLike OR a.record_id LIKE @qLike)
                                 ORDER BY a.created_at DESC LIMIT 300",
                new
                {
                    action, aLike = action + "%", @object = objectType, table, record = recordId,
                    actor = actorId, q, qLike = "%" + q + "%"
                });
            return Results.Json(rows.Select(AuditView));
        });

        app.MapGet("/api/admin/access-log", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var workerId = ctx.Q("workerId", "");
            var viewerId = ctx.Q("viewerId", "");
            var purpose = ctx.Q("purpose", "");
            var rows = db.Rows(@"SELECT a.*, wu.full_name AS worker_name, w.short_code,
                                        vu.full_name AS viewer_name
                                 FROM access_log a
                                 LEFT JOIN users wu ON wu.id = a.worker_id
                                 LEFT JOIN workers w ON w.user_id = a.worker_id
                                 LEFT JOIN users vu ON vu.id = a.viewer_id
                                 WHERE (@worker = '' OR a.worker_id = @worker)
                                   AND (@viewer = '' OR a.viewer_id = @viewer)
                                   AND (@purpose = '' OR a.purpose LIKE @pLike)
                                 ORDER BY a.created_at DESC LIMIT 300",
                new { worker = workerId, viewer = viewerId, purpose, pLike = "%" + purpose + "%" });
            return Results.Json(rows.Select(a => new
            {
                id = a.S("id"),
                viewerId = a.S("viewer_id"),
                viewerName = a.S("viewer_name"),
                viewerRole = a.S("viewer_role"),
                workerId = a.S("worker_id"),
                workerName = a.S("worker_name"),
                shortCode = a.S("short_code"),
                consentId = a.S("consent_id"),
                purpose = a.S("purpose"),
                fieldsViewed = a.S("fields_viewed"),
                clientIp = a.S("client_ip"),
                createdAt = a.S("created_at")
            }));
        });

        app.MapGet("/api/admin/settings", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            return Results.Json(SettingsList(db));
        });

        app.MapPut("/api/admin/settings", async (HttpContext ctx, Db db) =>
        {
            var admin = Auth.Require(ctx, "admin");
            var body = await Api.BodyAsync(ctx);
            var updates = new Dictionary<string, string>(StringComparer.Ordinal);

            if (body.Obj("settings") is { } nested)
            {
                foreach (var prop in nested.EnumerateObject())
                    updates[prop.Name] = prop.Value.ValueKind == System.Text.Json.JsonValueKind.String
                        ? prop.Value.GetString() ?? ""
                        : prop.Value.ToString();
            }
            else if (body.StrOrNull("key") is { } key)
            {
                updates[key] = body.Str("value");
            }

            if (updates.Count == 0) throw ApiException.Bad("Send at least one setting to change.");

            var current = db.Rows("SELECT setting_key, setting_value FROM app_settings")
                .ToDictionary(r => r.S("setting_key")!, r => r.S("setting_value") ?? "", StringComparer.Ordinal);
            foreach (var (settingKey, value) in updates)
            {
                if (!current.TryGetValue(settingKey, out var oldValue))
                    throw ApiException.Bad("Unknown setting: " + settingKey + ".");
                if (string.IsNullOrWhiteSpace(value)) throw ApiException.Bad("Setting " + settingKey + " cannot be empty.");
                if (int.TryParse(oldValue, out _) && (!int.TryParse(value, out var number) || number < 0))
                    throw ApiException.Bad("Setting " + settingKey + " must be a whole number of zero or more.");
            }

            db.Begin();
            try
            {
                foreach (var (settingKey, value) in updates)
                    db.Exec("UPDATE app_settings SET setting_value = @value WHERE setting_key = @key",
                        new { value, key = settingKey });

                Audit.Log(db, ctx, "settings.updated", "app_settings", null, "app_settings",
                    updates.ToDictionary(u => u.Key, u => current[u.Key]), updates,
                    string.Join(",", updates.Keys), "Admin changed configurable rules");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new { ok = true, updated = updates, settings = SettingsList(db) });
        });

        // ------------------------------------------------------------- police requests
        app.MapGet("/api/admin/police-requests", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var status = ctx.Q("status", "all");
            var rows = db.Rows(@"SELECT p.*, w.full_name AS worker_name, w.short_code,
                                        u.full_name AS decided_by_name
                                 FROM police_requests p
                                 LEFT JOIN workers w ON w.user_id = p.worker_id
                                 LEFT JOIN users u ON u.id = p.approved_by
                                 WHERE (@s = 'all' OR p.status = @s)
                                 ORDER BY p.created_at DESC", new { s = status });
            return Results.Json(rows.Select(p => new
            {
                id = p.S("id"),
                requesterName = p.S("requester_name"),
                caseNo = p.S("case_no"),
                workerId = p.S("worker_id"),
                workerName = p.S("worker_name"),
                shortCode = p.S("short_code"),
                justification = p.S("justification"),
                status = p.S("status"),
                approvedBy = p.S("decided_by_name"),
                decidedAt = p.S("decided_at"),
                createdAt = p.S("created_at"),
                canOpenPassport = p.S("status") == "approved"
            }));
        });

        app.MapPost("/api/admin/police-requests", async (HttpContext ctx, Db db) =>
        {
            var staff = Auth.Require(ctx, "reviewer", "admin");
            var body = await Api.BodyAsync(ctx);
            var requesterName = body.Str("requesterName");
            var caseNo = body.Str("caseNo");
            var justification = body.Str("justification");
            if (caseNo.Length < 4) throw ApiException.Bad("Enter the police case number.");
            if (justification.Length < 10) throw ApiException.Bad("Record why the request is justified.");

            var worker = body.StrOrNull("workerCode") is { } code
                ? Passport.WorkerByCode(db, code)
                : body.StrOrNull("workerId") is { } workerId ? Passport.Worker(db, workerId) : null;
            if (worker is null) throw ApiException.NotFound("Worker not found for this request.");

            var id = Ids.New("pol");
            db.Begin();
            try
            {
                db.Exec(@"INSERT INTO police_requests (id, requester_name, case_no, worker_id, justification,
                            status, created_at)
                          VALUES (@id,@name,@case,@worker,@why,'pending',@now)",
                    new
                    {
                        id, name = requesterName, @case = caseNo, worker = worker.S("user_id"),
                        why = justification, now = Ts.Now()
                    });
                Notify.Staff(db, "admin", "Police access request waiting",
                    $"{requesterName} asked for worker {worker.S("short_code")} under case {caseNo}. An admin must approve before anything is shown, and the view is logged.",
                    new { policeRequestId = id });
                Audit.Log(db, ctx, "police_request.created", "police_request", id, "police_requests",
                    details: $"Case {caseNo}; logged by {staff.Name}; pending admin approval");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new { id, status = "pending" }, statusCode: 201);
        });

        app.MapPost("/api/admin/police-requests/{id}/decision", async (HttpContext ctx, Db db, string id) =>
        {
            var admin = Auth.Require(ctx, "admin");
            var request = db.Row("SELECT * FROM police_requests WHERE id = @id", new { id })
                          ?? throw ApiException.NotFound("Police request not found.");
            if (request.S("status") != "pending") throw ApiException.Conflict("This request has already been decided.");
            var body = await Api.BodyAsync(ctx);
            var decision = body.Str("decision");
            if (decision is not ("approve" or "reject")) throw ApiException.Bad("Choose approve or reject.");
            var reason = body.Str("reason", false, "");

            db.Begin();
            try
            {
                db.Exec(@"UPDATE police_requests SET status = @s, approved_by = @by, decided_at = @now
                          WHERE id = @id",
                    new { s = decision == "approve" ? "approved" : "rejected", by = admin.Id, now = Ts.Now(), id });
                Audit.Log(db, ctx, "police_request.decided", "police_request", id, "police_requests",
                    new { status = "pending" }, new { status = decision == "approve" ? "approved" : "rejected", reason },
                    "status,approved_by,decided_at", "Case " + request.S("case_no"));
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new { ok = true, status = decision == "approve" ? "approved" : "rejected" });
        });

        app.MapGet("/api/admin/police-requests/{id}/passport", (HttpContext ctx, Db db, string id) =>
        {
            var admin = Auth.Require(ctx, "admin");
            var request = db.Row("SELECT * FROM police_requests WHERE id = @id", new { id })
                          ?? throw ApiException.NotFound("Police request not found.");
            if (request.S("status") != "approved")
                throw ApiException.Forbidden("Only an approved police request can open this view.");
            var worker = Passport.Worker(db, request.S("worker_id")!)
                         ?? throw ApiException.NotFound("Worker not found.");

            var fields = "name,dob,id_doc_type,masked_id,photo,home_village,region,verification_level,employments";
            db.Exec(@"INSERT INTO access_log (id, viewer_id, viewer_role, worker_id, consent_id, purpose,
                        fields_viewed, client_ip, request_id, created_at)
                      VALUES (@id,@viewer,@role,@worker,NULL,@purpose,@fields,@ip,@rid,@now)",
                new
                {
                    id = Ids.New("acc"), viewer = admin.Id, role = admin.Role,
                    worker = worker.S("user_id"), purpose = "Police request " + request.S("case_no"),
                    fields, ip = ctx.RequestIp(), rid = ctx.TraceIdentifier, now = Ts.Now()
                });
            Audit.Log(db, ctx, "police_request.passport_viewed", "worker", worker.S("user_id"), "access_log",
                details: "Approved police request " + request.S("case_no") + "; access logged; ID number masked");

            var idNumber = Crypto.Decrypt(worker.S("id_doc_number_encrypted"));
            return Results.Json(new
            {
                request = new
                {
                    id = request.S("id"),
                    requesterName = request.S("requester_name"),
                    caseNo = request.S("case_no"),
                    justification = request.S("justification"),
                    approvedBy = db.Str("SELECT full_name FROM users WHERE id = @id", new { id = request.S("approved_by") }),
                    decidedAt = request.S("decided_at")
                },
                worker = new
                {
                    id = worker.S("user_id"),
                    name = worker.S("full_name"),
                    shortCode = worker.S("short_code"),
                    dob = worker.S("dob"),
                    idDocType = worker.S("id_doc_type"),
                    idDocNumberMasked = Mask(idNumber),
                    faceUrl = Url(worker.S("face_path")),
                    village = worker.S("home_village"),
                    constituency = worker.S("constituency"),
                    regionName = Geo.RegionName(worker.S("region_code")),
                    verificationLevel = worker.I("verification_level"),
                    levelLabel = Passport.LevelLabel(worker.I("verification_level")),
                    recordStatus = Passport.RecordStatus(db, worker.S("user_id")!)
                },
                employments = Passport.LastEmployers(db, worker.S("user_id")!, 10),
                note = "Next-of-kin contacts and ID document images are not included. This view is in the access log."
            });
        });

        // ------------------------------------------------------------- outbox and users
        app.MapGet("/api/admin/outbox", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var userId = ctx.Q("userId", "");
            var q = ctx.Q("q", "");
            var channel = ctx.Q("channel", "");
            var rows = db.Rows(@"SELECT n.*, u.full_name AS user_name, u.role, u.phone_e164
                                 FROM notifications n JOIN users u ON u.id = n.user_id
                                 WHERE (@user = '' OR n.user_id = @user)
                                   AND (@channel = '' OR n.channel = @channel)
                                   AND (@q = '' OR n.title LIKE @like OR n.body LIKE @like OR u.full_name LIKE @like)
                                 ORDER BY n.created_at DESC LIMIT 200",
                new { user = userId, channel, q, like = "%" + q + "%" });
            return Results.Json(new
            {
                label = "WhatsApp simulator. In production this adapter calls the WhatsApp Cloud API.",
                messages = rows.Select(n => new
                {
                    id = n.S("id"),
                    userId = n.S("user_id"),
                    userName = n.S("user_name"),
                    role = n.S("role"),
                    phone = n.S("phone_e164"),
                    channel = n.S("channel"),
                    direction = n.S("direction"),
                    language = n.S("language_code"),
                    title = n.S("title"),
                    body = n.S("body"),
                    readAt = n.S("read_at"),
                    createdAt = n.S("created_at")
                })
            });
        });

        app.MapGet("/api/admin/users", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var role = ctx.Q("role", "");
            var q = ctx.Q("q", "");
            var rows = db.Rows(@"SELECT u.*, w.short_code, w.verification_level, f.farm_name
                                 FROM users u
                                 LEFT JOIN workers w ON w.user_id = u.id
                                 LEFT JOIN farmers f ON f.user_id = u.id
                                 WHERE (@role = '' OR u.role = @role)
                                   AND (@q = '' OR u.full_name LIKE @like OR u.phone_e164 LIKE @like)
                                 ORDER BY u.created_at DESC LIMIT 200",
                new { role, q, like = "%" + q + "%" });
            return Results.Json(rows.Select(u => new
            {
                id = u.S("id"),
                role = u.S("role"),
                name = u.S("full_name"),
                phone = u.S("phone_e164"),
                language = u.S("language_code"),
                shortCode = u.S("short_code"),
                verificationLevel = u.S("verification_level") is null ? (int?)null : u.I("verification_level"),
                farmName = u.S("farm_name"),
                faceUrl = Url(u.S("face_path")),
                createdAt = u.S("created_at")
            }));
        });

        app.MapPost("/api/admin/users/{id}/role", async (HttpContext ctx, Db db, string id) =>
        {
            var admin = Auth.Require(ctx, "admin");
            var body = await Api.BodyAsync(ctx);
            var role = body.Str("role");
            if (role is not ("worker" or "farmer" or "finder" or "agent" or "verifier" or "reviewer" or "admin"))
                throw ApiException.Bad("Choose a valid role.");

            var user = db.Row("SELECT * FROM users WHERE id = @id", new { id })
                       ?? throw ApiException.NotFound("Account not found.");
            if (user.S("id") == admin.Id)
                throw ApiException.Bad("You cannot change your own role. Ask another administrator.");
            var oldRole = user.S("role")!;
            if (oldRole == role) return Results.Json(new { ok = true, role, unchanged = true });
            if (oldRole == "admin" && db.Int("SELECT COUNT(*) FROM users WHERE role = 'admin'") <= 1)
                throw ApiException.Conflict("At least one administrator must remain.");
            if (role == "worker" && !db.Exists("SELECT 1 FROM workers WHERE user_id = @id", new { id }))
                throw ApiException.Bad("This account has no WorkerLink Passport. Register the worker first, then assign the worker role.");

            var title = role switch
            {
                "worker" => "Farm worker",
                "farmer" => "Farmer / livestock owner",
                "finder" => "Community member",
                "agent" => "Field agent",
                "verifier" => "Community verifier",
                "reviewer" => "Reviewer",
                _ => "Administrator"
            };

            db.Begin();
            try
            {
                db.Exec("UPDATE users SET role = @role, role_title = @title WHERE id = @id",
                    new { role, title, id });
                if (role is "agent" or "verifier" or "reviewer" or "admin")
                {
                    if (db.Exists("SELECT 1 FROM staff WHERE user_id = @id", new { id }))
                        db.Exec("UPDATE staff SET staff_role = @role WHERE user_id = @id", new { role, id });
                    else
                        db.Exec("INSERT INTO staff (user_id, staff_role, title, created_at) VALUES (@id,@role,@title,@now)",
                            new { id, role, title, now = Ts.Now() });
                }
                else
                {
                    db.Exec("DELETE FROM staff WHERE user_id = @id", new { id });
                }

                Notify.Send(db, id, "Your KraaLink role changed",
                    "An administrator changed your account role to " + title + ". Sign in again if the portal does not update.",
                    user.S("language_code") ?? "en", null, "system");
                Audit.Log(db, ctx, "user.role_changed", "user", id, "users",
                    new { role = oldRole }, new { role }, "role", "Administrator changed the account role");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new { ok = true, role, roleTitle = title });
        });
    }

    // ------------------------------------------------------------------ helpers
    private static Dictionary<string, object?> Metrics(Db db)
    {
        long C(string sql) => db.Long(sql);
        var accessViews = C("SELECT COUNT(*) FROM access_log");
        var consentsGranted = C("SELECT COUNT(*) FROM consents WHERE status = 'granted'");
        var consentsPending = C("SELECT COUNT(*) FROM consents WHERE status = 'pending'");
        var workers = C("SELECT COUNT(*) FROM workers");
        var level1 = C("SELECT COUNT(*) FROM workers WHERE verification_level = 1");
        var level2 = C("SELECT COUNT(*) FROM workers WHERE verification_level = 2");
        var foundOpen = C("SELECT COUNT(*) FROM found_reports WHERE status IN ('open','match_found','claim_pending')");
        var foundMatched = C("SELECT COUNT(*) FROM found_reports WHERE matched_owner_id IS NOT NULL");
        var lookups24 = C("SELECT COUNT(*) FROM brand_lookups WHERE created_at > '" + Ts.HoursFromNow(-24) + "'");
        var notifications24 = C("SELECT COUNT(*) FROM notifications WHERE created_at > '" + Ts.HoursFromNow(-24) + "'");

        return new Dictionary<string, object?>
        {
            ["workers"] = workers,
            ["workersL1"] = level1,
            ["workersL2"] = level2,
            ["farmers"] = C("SELECT COUNT(*) FROM farmers"),
            ["finders"] = C("SELECT COUNT(*) FROM users WHERE role = 'finder'"),
            ["consentsGranted"] = consentsGranted,
            ["consentsPending"] = consentsPending,
            ["hiringChecks"] = C("SELECT COUNT(*) FROM consents"),
            ["accessViews"] = accessViews,
            ["openIncidents"] = C("SELECT COUNT(*) FROM incidents WHERE status IN ('under_review','worker_responded')"),
            ["incidentsFiled"] = C("SELECT COUNT(*) FROM incidents"),
            ["activeListings"] = C("SELECT COUNT(*) FROM listings WHERE status = 'active'"),
            ["heldListings"] = C("SELECT COUNT(*) FROM listings WHERE status = 'held'"),
            ["foundOpen"] = foundOpen,
            ["foundMatched"] = foundMatched,
            ["claimsPending"] = C("SELECT COUNT(*) FROM ownership_claims WHERE status = 'pending'"),
            ["claimsApproved"] = C("SELECT COUNT(*) FROM ownership_claims WHERE status = 'approved'"),
            ["missingOpen"] = C("SELECT COUNT(*) FROM missing_reports WHERE status = 'open'"),
            ["policePending"] = C("SELECT COUNT(*) FROM police_requests WHERE status = 'pending'"),
            ["tagConflicts"] = C("SELECT COUNT(*) FROM livestock_tags WHERE status = 'conflict'"),
            ["lookups24h"] = lookups24,
            ["notifications24h"] = notifications24,
            ["auditRows"] = C("SELECT COUNT(*) FROM audit_log"),
            ["openEmployments"] = C("SELECT COUNT(*) FROM employments WHERE status = 'open'")
        };
    }

    private static long Scalar(Db db, string sql) => db.Long(sql);

    private static object AuditView(Dictionary<string, object?> a) => new
    {
        id = a.S("id"),
        createdAt = a.S("created_at"),
        actorId = a.S("actor_id"),
        actorName = a.S("actor_name"),
        actorRole = a.S("actor_role"),
        action = a.S("action"),
        objectType = a.S("object_type"),
        table = a.S("table_name"),
        recordId = a.S("record_id"),
        oldData = a.S("old_data"),
        newData = a.S("new_data"),
        changedFields = a.S("changed_fields"),
        details = a.S("details"),
        requestId = a.S("request_id"),
        clientIp = a.S("client_ip"),
        source = a.S("source")
    };

    private static List<object> SettingsList(Db db) =>
        db.Rows("SELECT * FROM app_settings ORDER BY setting_key")
            .Select(s => (object)new
            {
                key = s.S("setting_key"),
                value = s.S("setting_value"),
                description = s.S("description")
            }).ToList();

    private static string? Url(string? fileId) => string.IsNullOrEmpty(fileId) ? null : Storage.Url(fileId, 10);

    private static string Mask(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "—";
        return value.Length <= 4 ? "••••" : new string('•', value.Length - 4) + value[^4..];
    }
}
