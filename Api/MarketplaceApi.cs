namespace KraaLink;

public static class MarketplaceApi
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/listings", (HttpContext ctx, Db db) =>
        {
            var species = ctx.Q("species", "");
            var region = ctx.Q("region", "");
            var kind = ctx.Q("kind", "");
            var category = ctx.Q("category", "");
            var q = ctx.Q("q", "");
            var rows = db.Rows(@"SELECT l.*, u.full_name AS seller_name, u.phone_e164 AS seller_phone
                                 FROM listings l JOIN users u ON u.id = l.farmer_id
                                 WHERE l.status = 'active'
                                   AND (@kind = '' OR COALESCE(l.listing_kind,'livestock') = @kind)
                                   AND (@species = '' OR l.species = @species)
                                   AND (@category = '' OR l.category = @category)
                                   AND (@region = '' OR l.region_code = @region)
                                   AND (@q = '' OR l.village LIKE @like OR l.brand_text LIKE @like
                                        OR l.species LIKE @like OR l.category LIKE @like)
                                 ORDER BY l.created_at DESC LIMIT 60",
                new { species, region, kind, category, q, like = "%" + q + "%" });
            return Results.Json(rows.Select(ListingView));
        });

        app.MapGet("/api/listings/mine", (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var rows = db.Rows("SELECT * FROM listings WHERE farmer_id = @f ORDER BY created_at DESC", new { f = farmer.Id });
            return Results.Json(rows.Select(l =>
            {
                var view = ListingView(l);
                return new
                {
                    view, status = l.S("status"), holdReason = l.S("hold_reason"),
                    reports = db.Int("SELECT COUNT(*) FROM listing_reports WHERE listing_id = @id AND status = 'open'", new { id = l.S("id") })
                };
            }));
        });

        app.MapGet("/api/listings/{id}", (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.From(ctx);
            var l = db.Row(@"SELECT l.*, u.full_name AS seller_name, u.phone_e164 AS seller_phone
                             FROM listings l JOIN users u ON u.id = l.farmer_id WHERE l.id = @id", new { id })
                    ?? throw ApiException.NotFound("Listing not found.");
            var canSeeHeld = user is not null && (user.Id == l.S("farmer_id") || user.IsReviewer);
            if (l.S("status") != "active" && !canSeeHeld) throw ApiException.NotFound("Listing not found.");
            var reports = canSeeHeld
                ? db.Rows("SELECT reason, status, created_at FROM listing_reports WHERE listing_id = @id", new { id })
                    .Select(r => new { reason = r.S("reason"), status = r.S("status"), createdAt = r.S("created_at") }).ToList<object>()
                : new List<object>();
            return Results.Json(new
            {
                listing = ListingView(l),
                status = l.S("status"),
                holdReason = canSeeHeld ? l.S("hold_reason") : null,
                reports
            });
        });

        app.MapPost("/api/listings", async (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var body = await Api.BodyAsync(ctx);
            var kind = body.Str("kind", false, "livestock");
            if (kind is not ("livestock" or "produce"))
                throw ApiException.Bad("Choose livestock or farm produce.");
            var species = body.Str("species").Trim();
            string? category = null;
            string? unit = null;
            if (kind == "livestock")
            {
                if (!Geo.Species.Contains(species)) throw ApiException.Bad("Choose a valid species.");
            }
            else
            {
                if (species.Length is < 2 or > 60) throw ApiException.Bad("Give the product a name of 2–60 characters.");
                category = body.Str("category");
                if (!Geo.ProduceCategories.Contains(category)) throw ApiException.Bad("Choose a produce category.");
                unit = body.Str("unit");
                if (!Geo.ProduceUnits.Contains(unit)) throw ApiException.Bad("Choose the unit you sell in.");
            }
            var qty = body.Int("qty");
            if (qty <= 0) throw ApiException.Bad(kind == "produce" ? "Enter how much you have available." : "Enter the number of animals.");
            var price = body.Num("priceNad");
            if (price <= 0) throw ApiException.Bad("Enter an asking price in Namibian dollars.");
            var region = body.Str("regionCode");
            if (!Geo.KnownRegion(region)) throw ApiException.Bad("Choose a region.");
            var tags = body.StrList("tagNumbers");
            var brand = body.StrOrNull("brandText");

            var id = Ids.New("lst");
            db.Begin();
            try
            {
                string? photoId = null;
                if (body.StrOrNull("photo") is { } photo)
                {
                    var saved = Storage.SaveDataUrl(db, photo, "listing_photo", farmer.Id, isPublic: true);
                    photoId = saved.S("id");
                }

                string? heldReason = null;
                var held = kind == "livestock" && Matching.IsHeldByAnotherOwner(db, farmer.Id, tags, out heldReason);
                var reason = held ? heldReason : null;
                db.Exec(@"INSERT INTO listings (id, farmer_id, species, qty, age_text, sex, price_nad, region_code,
                            village, photo_path, brand_text, tag_numbers, status, hold_reason, created_at,
                            listing_kind, category, unit)
                          VALUES (@id,@f,@s,@q,@age,@sex,@p,@region,@village,@photo,@brand,@tags,@status,@reason,@now,
                            @kind,@category,@unit)",
                    new
                    {
                        id, f = farmer.Id, s = species, q = qty, age = body.StrOrNull("ageText"),
                        sex = body.StrOrNull("sex"), p = price, region, village = body.StrOrNull("village"),
                        photo = photoId, brand, tags = Passport.JsonList(tags),
                        status = held ? "held" : "active", reason, now = Ts.Now(),
                        kind, category, unit
                    });

                if (held)
                {
                    Notify.Staff(db, "reviewer", "Listing held: tag belongs to another owner",
                        "A new listing carries an ear tag reported missing, stolen or registered to another farmer. It is hidden from buyers until you decide.",
                        new { listingId = id });
                    Notify.Send(db, farmer.Id, "Your listing was held for review",
                        reason + " It is not visible to buyers while a reviewer checks it. If this tag belongs to you, check your tag register.",
                        farmer.Lang);
                }
                else
                {
                    Notify.Staff(db, "reviewer", "New marketplace listing",
                        kind == "produce"
                            ? $"{farmer.Name} listed {qty} {unit} of {species}."
                            : $"{farmer.Name} listed {qty} {species}.", new { listingId = id });
                }

                Audit.Log(db, ctx, "listing.created", "listing", id, "listings",
                    details: held ? "Held: " + reason : "Published to buyers");
                db.Commit();
                return Results.Json(new
                {
                    id, status = held ? "held" : "active",
                    held,
                    message = held
                        ? "Held for reviewer check. " + reason
                        : "Published. Buyers can contact you through WhatsApp."
                }, statusCode: 201);
            }
            catch
            {
                db.Dispose();
                throw;
            }
        });

        app.MapPost("/api/listings/{id}/reports", async (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.Require(ctx);
            var listing = db.Row("SELECT * FROM listings WHERE id = @id", new { id })
                          ?? throw ApiException.NotFound("Listing not found.");
            if (listing.S("farmer_id") == user.Id) throw ApiException.Bad("You cannot report your own listing.");
            var body = await Api.BodyAsync(ctx);
            var reason = body.Str("reason");
            if (reason.Length < 8) throw ApiException.Bad("Say why this listing looks suspicious.");

            db.Begin();
            try
            {
                db.Exec(@"INSERT INTO listing_reports (id, listing_id, reporter_id, reason, status, created_at)
                          VALUES (@id,@l,@r,@reason,'open',@now)",
                    new { id = Ids.New("lrep"), l = id, r = user.Id, reason, now = Ts.Now() });
                Notify.Staff(db, "reviewer", "Suspicious listing reported",
                    "A user reported a listing. Check the tag numbers, the seller and the missing-livestock register.",
                    new { listingId = id });
                Audit.Log(db, ctx, "listing.reported", "listing", id, "listing_reports",
                    details: "Reason stored; reporter kept on file");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }
            return Results.Json(new { ok = true, message = "Report sent to reviewers. Thank you." }, statusCode: 201);
        });

        app.MapGet("/api/price-board", (Db db) =>
        {
            var active = db.Rows(@"SELECT species, region_code, price_nad FROM listings
                                   WHERE status = 'active' AND COALESCE(listing_kind, 'livestock') = 'livestock'");
            var board = active.GroupBy(l => l.S("species") ?? "Other").Select(g =>
            {
                var prices = g.Select(x => x.D("price_nad")).OrderBy(x => x).ToList();
                var median = prices.Count == 0 ? 0 :
                    prices.Count % 2 == 1 ? prices[prices.Count / 2] :
                    (prices[prices.Count / 2 - 1] + prices[prices.Count / 2]) / 2;
                return new
                {
                    species = g.Key,
                    listings = prices.Count,
                    medianNad = Math.Round(median, 2),
                    minNad = prices.Count > 0 ? prices.Min() : 0,
                    maxNad = prices.Count > 0 ? prices.Max() : 0
                };
            }).OrderBy(x => x.species).ToList();

            var references = db.Rows("SELECT * FROM price_reference ORDER BY week_of DESC, species").Select(r => new
            {
                id = r.S("id"),
                species = r.S("species"),
                priceType = r.S("price_type"),
                valueNad = r.D("value_nad"),
                unit = r.S("unit"),
                source = r.S("source"),
                weekOf = r.S("week_of"),
                indicative = true
            });

            return Results.Json(new
            {
                label = "Indicative only. Asking prices from live listings are not auction or abattoir prices.",
                board,
                references
            });
        });

        app.MapPost("/api/admin/price-reference", async (HttpContext ctx, Db db) =>
        {
            var reviewer = Auth.Require(ctx, "reviewer", "admin");
            var body = await Api.BodyAsync(ctx);
            var species = body.Str("species");
            var value = body.Num("valueNad");
            if (value <= 0) throw ApiException.Bad("Enter a price.");
            db.Exec(@"INSERT INTO price_reference (id, species, price_type, value_nad, unit, source, week_of, created_by, created_at)
                      VALUES (@id,@s,@t,@v,@unit,@src,@week,@by,@now)",
                new
                {
                    id = Ids.New("pr"), s = species, t = body.Str("priceType", false, "auction"), v = value,
                    unit = body.Str("unit", false, "per head"), src = body.Str("source"),
                    week = body.Str("weekOf", false, DateTime.UtcNow.ToString("yyyy-MM-dd")),
                    by = reviewer.Id, now = Ts.Now()
                });
            Audit.Log(db, ctx, "price_reference.created", "price_reference", null, "price_reference",
                details: $"{species} {value} NAD");
            return Results.Json(new { ok = true }, statusCode: 201);
        });

        app.MapGet("/api/admin/listings", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var status = ctx.Q("status", "held");
            var rows = db.Rows(@"SELECT l.*, u.full_name AS seller_name, u.phone_e164 AS seller_phone
                                 FROM listings l JOIN users u ON u.id = l.farmer_id
                                 WHERE (@s = 'all' OR l.status = @s)
                                 ORDER BY l.created_at DESC", new { s = status });
            return Results.Json(rows.Select(l =>
            {
                var view = ListingView(l);
                var reports = db.Rows("SELECT reason, created_at FROM listing_reports WHERE listing_id = @id AND status = 'open'",
                    new { id = l.S("id") });
                return new
                {
                    view, status = l.S("status"), holdReason = l.S("hold_reason"),
                    reports = reports.Select(r => new { reason = r.S("reason"), createdAt = r.S("created_at") })
                };
            }));
        });

        app.MapPost("/api/admin/listings/{id}/moderate", async (HttpContext ctx, Db db, string id) =>
        {
            var reviewer = Auth.Require(ctx, "reviewer", "admin");
            var listing = db.Row("SELECT * FROM listings WHERE id = @id", new { id })
                          ?? throw ApiException.NotFound("Listing not found.");
            var body = await Api.BodyAsync(ctx);
            var action = body.Str("action");
            if (action is not ("clear" or "remove")) throw ApiException.Bad("Choose clear or remove.");
            var reason = body.Str("reason", false, action == "clear" ? "Checked and cleared by reviewer." : "Removed by reviewer.");

            db.Begin();
            try
            {
                db.Exec("UPDATE listings SET status = @s, hold_reason = @r WHERE id = @id",
                    new { s = action == "clear" ? "active" : "removed", r = action == "clear" ? null : reason, id });
                db.Exec("UPDATE listing_reports SET status = @s WHERE listing_id = @id AND status = 'open'",
                    new { s = action == "clear" ? "cleared" : "removed", id });
                Notify.Send(db, listing.S("farmer_id")!, action == "clear" ? "Listing cleared" : "Listing removed",
                    action == "clear"
                        ? "A reviewer cleared your listing. It is visible to buyers again."
                        : "A reviewer removed your listing: " + reason,
                    "en", new { listingId = id });
                Audit.Log(db, ctx, "listing.moderated", "listing", id, "listings",
                    new { status = listing.S("status") },
                    new { status = action == "clear" ? "active" : "removed" }, "status,hold_reason", reason);
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }
            return Results.Json(new { ok = true, status = action == "clear" ? "active" : "removed" });
        });
    }

    private static object ListingView(Dictionary<string, object?> l) => new
    {
        id = l.S("id"),
        farmerId = l.S("farmer_id"),
        sellerName = l.S("seller_name"),
        kind = l.S("listing_kind") ?? "livestock",
        category = l.S("category"),
        unit = l.S("unit"),
        species = l.S("species"),
        qty = l.I("qty"),
        ageText = l.S("age_text"),
        sex = l.S("sex"),
        priceNad = l.D("price_nad"),
        regionCode = l.S("region_code"),
        regionName = Geo.RegionName(l.S("region_code")),
        village = l.S("village"),
        photoUrl = string.IsNullOrEmpty(l.S("photo_path")) ? null : "/api/files/" + l.S("photo_path"),
        brandText = l.S("brand_text"),
        tagNumbers = l.List("tag_numbers"),
        whatsapp = l.S("seller_phone") is { } phone
            ? "https://wa.me/" + new string(phone.Where(char.IsDigit).ToArray())
            : null,
        status = l.S("status"),
        createdAt = l.S("created_at")
    };
}
