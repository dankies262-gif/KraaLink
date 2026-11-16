namespace KraaLink;

public static class VetApi
{
    private const string Disclaimer =
        "This guidance is information, not a diagnosis. It does not replace a vet. Never give medicine or a dose without professional advice.";

    public static void Map(WebApplication app)
    {
        app.MapGet("/api/vetbot/conditions", (HttpContext ctx, Db db) =>
        {
            var species = ctx.Q("species", "");
            var rows = db.Rows(@"SELECT * FROM vet_conditions WHERE review_status = 'approved'
                                 AND (@s = '' OR species LIKE @species) ORDER BY is_notifiable DESC, name_en",
                new { s = species, species = "%" + species + "%" });
            var symptoms = rows.SelectMany(r => r.List("symptoms")).Distinct().OrderBy(s => s).ToList();
            return Results.Json(new
            {
                conditions = rows.Select(r => new
                {
                    id = r.S("id"),
                    name = r.S("name_en"),
                    species = r.S("species"),
                    symptoms = r.List("symptoms"),
                    notifiable = r.B("is_notifiable"),
                    approvedBy = r.S("approved_by"),
                    approvedAt = r.S("approved_at")
                }),
                symptoms,
                languages = Geo.Languages.Select(l => new { code = l.Code, name = l.Name })
            });
        });

        app.MapPost("/api/vetbot/sessions", async (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx);
            var body = await Api.BodyAsync(ctx);
            var species = body.Str("species", false, "Cattle");
            var chosen = body.StrList("symptoms");
            var language = body.Str("language", false, user.Lang);
            var note = body.StrOrNull("symptomsText");
            if (chosen.Count == 0 && string.IsNullOrWhiteSpace(note))
                throw ApiException.Bad("Choose at least one symptom.");

            var rows = db.Rows(@"SELECT * FROM vet_conditions WHERE review_status = 'approved'
                                 AND (species LIKE @sp OR species = @exact) ORDER BY is_notifiable DESC",
                new { sp = "%" + species + "%", exact = species });

            Dictionary<string, object?>? best = null;
            var bestScore = 0;
            foreach (var row in rows)
            {
                var score = row.List("symptoms").Count(chosen.Contains);
                if (score > bestScore)
                {
                    best = row;
                    bestScore = score;
                }
            }

            var region = body.StrOrNull("regionCode")
                         ?? db.Str("SELECT region_code FROM farmers WHERE user_id = @id", new { id = user.Id })
                         ?? db.Str("SELECT region_code FROM workers WHERE user_id = @id", new { id = user.Id });
            var vets = Vets(db, region);
            var isNotifiable = best is not null && best.B("is_notifiable");

            var sessionId = Ids.New("vs");
            db.Exec(@"INSERT INTO vet_sessions (id, farmer_id, condition_id, language_code, symptoms_text, escalated, created_at)
                      VALUES (@id,@f,@c,@l,@t,@e,@now)",
                new
                {
                    id = sessionId, f = user.Id, c = best?.S("id"), l = language,
                    t = note ?? string.Join(", ", chosen), e = isNotifiable ? 1 : 0, now = Ts.Now()
                });
            Audit.Log(db, ctx, "vetbot.session", "vet_session", sessionId, "vet_sessions",
                details: "Triage session logged for vet review; escalated=" + isNotifiable);

            if (best is null)
            {
                return Results.Json(new
                {
                    sessionId,
                    matched = false,
                    title = "No exact match in the reviewed knowledge base",
                    advice = "Watch the animal, keep water available and contact the nearest vet or animal health technician if the animal gets worse.",
                    notifiable = false,
                    disclaimer = Disclaimer,
                    vets,
                    escalation = (object?)null,
                    language
                });
            }

            return Results.Json(new
            {
                sessionId,
                matched = true,
                conditionId = best.S("id"),
                title = best.S("name_en"),
                advice = best.S("advice"),
                notifiable = isNotifiable,
                approvedBy = best.S("approved_by"),
                disclaimer = Disclaimer,
                vets,
                escalation = isNotifiable
                    ? new
                    {
                        title = "Suspected notifiable disease",
                        steps = new[]
                        {
                            "Isolate the animals now. Keep people and other animals away.",
                            "Do not move, sell or slaughter the animals.",
                            "Contact the nearest State Veterinary office immediately.",
                            "Tell them what you saw and follow their instructions."
                        },
                        phone = vets.FirstOrDefault()?.GetType().GetProperty("phone")?.GetValue(vets.FirstOrDefault())?.ToString()
                    }
                    : null,
                language
            });
        });

        app.MapGet("/api/vet-directory", (HttpContext ctx, Db db) =>
        {
            var region = ctx.Q("region", "");
            var rows = db.Rows(@"SELECT * FROM vet_directory WHERE (@r = '' OR region_code = @r)
                                 ORDER BY region_code, name", new { r = region });
            return Results.Json(rows.Select(v => new
            {
                id = v.S("id"),
                name = v.S("name"),
                type = v.S("vet_type"),
                regionCode = v.S("region_code"),
                regionName = Geo.RegionName(v.S("region_code")),
                town = v.S("town"),
                phone = v.S("phone_e164"),
                demo = true
            }));
        });

        app.MapGet("/api/herds", (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var herds = db.Rows("SELECT * FROM herds WHERE farmer_id = @f ORDER BY created_at", new { f = farmer.Id });
            return Results.Json(herds.Select(h => new
            {
                id = h.S("id"),
                species = h.S("species"),
                headCount = h.I("head_count"),
                schedules = db.Rows("SELECT * FROM vaccination_schedules WHERE herd_id = @id ORDER BY next_due", new { id = h.S("id") })
                    .Select(s => new
                    {
                        id = s.S("id"),
                        vaccine = s.S("vaccine"),
                        lastDone = s.S("last_done"),
                        nextDue = s.S("next_due"),
                        reminderSentAt = s.S("reminder_sent_at"),
                        dueSoon = string.CompareOrdinal(s.S("next_due"), DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd")) <= 0
                    })
            }));
        });

        app.MapPost("/api/herds", async (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var body = await Api.BodyAsync(ctx);
            var species = body.Str("species");
            var head = body.Int("headCount");
            if (head <= 0) throw ApiException.Bad("Enter the number of animals.");
            var id = Ids.New("herd");
            db.Exec("INSERT INTO herds (id, farmer_id, species, head_count, created_at) VALUES (@id,@f,@s,@h,@now)",
                new { id, f = farmer.Id, s = species, h = head, now = Ts.Now() });
            Audit.Log(db, ctx, "herd.created", "herd", id, "herds", details: species + " " + head);
            return Results.Json(new { id, species, headCount = head }, statusCode: 201);
        });

        app.MapPost("/api/herds/{id}/vaccinations", async (HttpContext ctx, Db db, string id) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var herd = db.Row("SELECT * FROM herds WHERE id = @id", new { id })
                       ?? throw ApiException.NotFound("Herd not found.");
            if (herd.S("farmer_id") != farmer.Id) throw ApiException.Forbidden();
            var body = await Api.BodyAsync(ctx);
            var vaccine = body.Str("vaccine");
            var nextDue = body.Str("nextDue");
            if (!DateTime.TryParse(nextDue, out _)) throw ApiException.Bad("Enter the next due date.");
            var sid = Ids.New("vac");
            db.Exec(@"INSERT INTO vaccination_schedules (id, herd_id, vaccine, last_done, next_due, created_at)
                      VALUES (@id,@h,@v,@last,@next,@now)",
                new
                {
                    id = sid, h = id, v = vaccine, last = body.StrOrNull("lastDone"), next = nextDue, now = Ts.Now()
                });
            Audit.Log(db, ctx, "vaccination.created", "vaccination", sid, "vaccination_schedules", details: vaccine);
            return Results.Json(new { id = sid }, statusCode: 201);
        });

        app.MapGet("/api/admin/vet-conditions", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var rows = db.Rows("SELECT * FROM vet_conditions ORDER BY review_status, created_at DESC");
            return Results.Json(rows.Select(r => new
            {
                id = r.S("id"), name = r.S("name_en"), species = r.S("species"),
                symptoms = r.List("symptoms"), advice = r.S("advice"), notifiable = r.B("is_notifiable"),
                reviewStatus = r.S("review_status"), approvedBy = r.S("approved_by"),
                approvedAt = r.S("approved_at"), createdAt = r.S("created_at")
            }));
        });

        app.MapPost("/api/admin/vet-conditions", async (HttpContext ctx, Db db) =>
        {
            var reviewer = Auth.Require(ctx, "reviewer", "admin");
            var body = await Api.BodyAsync(ctx);
            var id = Ids.New("vc");
            db.Exec(@"INSERT INTO vet_conditions (id, name_en, translations, species, symptoms, advice, is_notifiable,
                        review_status, created_by, created_at)
                      VALUES (@id,@n,'{}',@s,@sym,@a,@not,'pending',@by,@now)",
                new
                {
                    id, n = body.Str("name"), s = body.Str("species"),
                    sym = Passport.JsonList(body.StrList("symptoms")), a = body.Str("advice"),
                    not = body.Bool("notifiable"), by = reviewer.Id, now = Ts.Now()
                });
            Audit.Log(db, ctx, "vet_content.created", "vet_condition", id, "vet_conditions",
                details: "Created in pending vet review; never shown as approved");
            return Results.Json(new { id, reviewStatus = "pending" }, statusCode: 201);
        });

        app.MapPost("/api/admin/vet-conditions/{id}/approve", async (HttpContext ctx, Db db, string id) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var condition = db.Row("SELECT * FROM vet_conditions WHERE id = @id", new { id })
                            ?? throw ApiException.NotFound("Content not found.");
            if (condition.S("review_status") == "approved") throw ApiException.Conflict("Already approved.");
            var body = await Api.BodyAsync(ctx);
            var vetName = body.Str("vetName");
            if (vetName.Length < 3) throw ApiException.Bad("Name the registered vet or animal health technician who approved the content.");
            db.Exec(@"UPDATE vet_conditions SET review_status = 'approved', approved_by = @by, approved_at = @now
                      WHERE id = @id", new { by = vetName, now = Ts.Now(), id });
            Audit.Log(db, ctx, "vet_content.approved", "vet_condition", id, "vet_conditions",
                new { review_status = condition.S("review_status") },
                new { review_status = "approved", approved_by = vetName }, "review_status,approved_by,approved_at");
            return Results.Json(new { ok = true, reviewStatus = "approved" });
        });
    }

    private static List<Dictionary<string, object?>> Vets(Db db, string? region)
    {
        var rows = db.Rows("SELECT * FROM vet_directory WHERE region_code = @r ORDER BY name", new { r = region });
        if (rows.Count == 0) rows = db.Rows("SELECT * FROM vet_directory ORDER BY name LIMIT 3");
        return rows.Select(v => new Dictionary<string, object?>
        {
            ["name"] = v.S("name"),
            ["type"] = v.S("vet_type"),
            ["region"] = Geo.RegionName(v.S("region_code")),
            ["town"] = v.S("town"),
            ["phone"] = v.S("phone_e164")
        }).ToList();
    }
}
