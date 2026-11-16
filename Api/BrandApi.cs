using System.Security;

namespace KraaLink;

/// <summary>
/// Livestock Brand & Trade Tracker. Blind matching is enforced here: a finder only ever
/// receives a case reference and a status, never an owner identifier (SRS FR-BRD-07..12).
/// </summary>
public static class BrandApi
{
    private static readonly string[] ClaimDocTypes =
        { "brand_certificate", "registration_card", "tag_record", "namlits_record", "other" };

    private static readonly string[] RequiredClaimDocTypes =
        { "brand_certificate", "registration_card", "tag_record" };

    public static void Map(WebApplication app)
    {
        // ---------------------------------------------------------------- brands
        app.MapPost("/api/brands", async (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var body = await Api.BodyAsync(ctx);
            var mark = body.Str("brandMarkText");
            if (mark.Length < 2) throw ApiException.Bad("Enter the brand mark as it appears on the animal.");
            var normalized = Codes.NormalizeMark(mark);
            if (normalized.Length == 0) throw ApiException.Bad("A brand mark needs at least one letter or number.");
            var area = body.Str("brandArea", false, "communal");
            if (area is not ("commercial" or "communal")) throw ApiException.Bad("Choose commercial or communal.");
            var region = body.StrOrNull("regionCode");
            if (region is not null && !Geo.KnownRegion(region)) throw ApiException.Bad("Choose a valid region.");

            var id = Ids.New("brd");
            db.Begin();
            try
            {
                string? photoId = null;
                string? certId = null;
                if (body.StrOrNull("photo") is { } photo)
                    photoId = Storage.SaveDataUrl(db, photo, "brand_photo", farmer.Id).S("id");
                if (body.StrOrNull("certificate") is { } cert)
                    certId = Storage.SaveDataUrl(db, cert, "brand_cert", farmer.Id).S("id");

                db.Exec(@"INSERT INTO stock_brands (id, owner_id, brand_mark_text, brand_normalized,
                            brand_registration_no, brand_area, region_code, photo_path, cert_path, status, created_at)
                          VALUES (@id,@o,@mark,@norm,@regno,@area,@region,@photo,@cert,'pending',@now)",
                    new
                    {
                        id, o = farmer.Id, mark, norm = normalized,
                        regno = body.StrOrNull("brandRegistrationNo"), area, region,
                        photo = photoId, cert = certId, now = Ts.Now()
                    });

                Notify.Staff(db, "reviewer", "New brand waiting for verification",
                    $"{farmer.Name} registered brand mark {mark}. Check the certificate or registration number before verifying it.",
                    new { brandId = id });
                Notify.Send(db, farmer.Id, "Brand submitted for verification",
                    $"Your brand {mark} is pending. A verified brand lets found animals match back to you without exposing your name to the finder.",
                    farmer.Lang, new { brandId = id });
                Audit.Log(db, ctx, "brand.created", "stock_brand", id, "stock_brands",
                    details: "Status pending; certificate " + (certId is null ? "not supplied" : "supplied"));
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
                status = "pending",
                message = "Submitted. A reviewer checks the brand certificate or registration number before it can match found animals."
            }, statusCode: 201);
        });

        app.MapGet("/api/brands/mine", (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var brands = db.Rows("SELECT * FROM stock_brands WHERE owner_id = @o ORDER BY created_at DESC",
                new { o = farmer.Id });
            return Results.Json(brands.Select(b =>
            {
                var id = b.S("id")!;
                var tags = db.Rows(
                    "SELECT * FROM livestock_tags WHERE brand_id = @b ORDER BY created_at DESC", new { b = id });
                return new
                {
                    id,
                    brandMarkText = b.S("brand_mark_text"),
                    brandNormalized = b.S("brand_normalized"),
                    registrationNo = b.S("brand_registration_no"),
                    area = b.S("brand_area"),
                    regionCode = b.S("region_code"),
                    regionName = Geo.RegionName(b.S("region_code")),
                    status = b.S("status"),
                    verifiedAt = b.S("verified_at"),
                    photoUrl = Url(b.S("photo_path")),
                    certificateUrl = Url(b.S("cert_path")),
                    tags = tags.Select(TagView).ToList(),
                    createdAt = b.S("created_at")
                };
            }));
        });

        app.MapGet("/api/admin/brands", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var status = ctx.Q("status", "pending");
            var rows = db.Rows(@"SELECT b.*, u.full_name AS owner_name, u.phone_e164 AS owner_phone
                                 FROM stock_brands b JOIN users u ON u.id = b.owner_id
                                 WHERE (@s = 'all' OR b.status = @s)
                                 ORDER BY b.created_at ASC", new { s = status });
            return Results.Json(rows.Select(b => new
            {
                id = b.S("id"),
                brandMarkText = b.S("brand_mark_text"),
                brandNormalized = b.S("brand_normalized"),
                registrationNo = b.S("brand_registration_no"),
                area = b.S("brand_area"),
                regionName = Geo.RegionName(b.S("region_code")),
                status = b.S("status"),
                ownerName = b.S("owner_name"),
                ownerPhone = b.S("owner_phone"),
                photoUrl = Url(b.S("photo_path")),
                certificateUrl = Url(b.S("cert_path")),
                verifiedAt = b.S("verified_at"),
                createdAt = b.S("created_at")
            }));
        });

        app.MapPost("/api/admin/brands/{id}/verification", async (HttpContext ctx, Db db, string id) =>
        {
            var reviewer = Auth.Require(ctx, "reviewer", "admin");
            var brand = db.Row("SELECT * FROM stock_brands WHERE id = @id", new { id })
                        ?? throw ApiException.NotFound("Brand not found.");
            if (brand.S("status") != "pending")
                throw ApiException.Conflict("This brand has already been decided.");
            var body = await Api.BodyAsync(ctx);
            var decision = body.Str("decision");
            if (decision is not ("verify" or "reject")) throw ApiException.Bad("Choose verify or reject.");
            var reason = body.Str("reason", false, decision == "verify"
                ? "Certificate or registration number checked against the declared brand."
                : "Documents did not support the declared brand.");
            if (decision == "verify" && string.IsNullOrWhiteSpace(brand.S("brand_registration_no"))
                                      && string.IsNullOrWhiteSpace(brand.S("cert_path")))
                throw ApiException.Bad("A brand needs a registration number or a certificate before it can be verified.");

            db.Begin();
            try
            {
                db.Exec(@"UPDATE stock_brands SET status = @s, verified_by = @by, verified_at = @now
                          WHERE id = @id",
                    new
                    {
                        s = decision == "verify" ? "verified" : "rejected", by = reviewer.Id,
                        now = Ts.Now(), id
                    });

                if (decision == "verify")
                {
                    Matching.RecheckOpenReports(db);
                    Notify.Send(db, brand.S("owner_id")!, "Your brand is verified",
                        $"Brand {brand.S("brand_mark_text")} is now verified. Found animals carrying it can be matched back to you without your name being shown to the finder.",
                        "en", new { brandId = id });
                }
                else
                {
                    Notify.Send(db, brand.S("owner_id")!, "Your brand was not verified",
                        $"A reviewer did not verify brand {brand.S("brand_mark_text")}: {reason} You can submit better documents.",
                        "en", new { brandId = id });
                }

                Audit.Log(db, ctx, "brand.verified", "stock_brand", id, "stock_brands",
                    new { status = "pending" }, new { status = decision == "verify" ? "verified" : "rejected", reason },
                    "status,verified_by,verified_at", "Reviewer " + reviewer.Name);
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new { ok = true, status = decision == "verify" ? "verified" : "rejected" });
        });

        // ---------------------------------------------------------------- ear tags
        app.MapPost("/api/tags", async (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var body = await Api.BodyAsync(ctx);
            var number = body.Str("tagNumber");
            var normalized = Codes.NormalizeMark(number);
            if (normalized.Length < 3) throw ApiException.Bad("Enter the full ear-tag number.");
            var species = body.Str("species", false, "Cattle");
            if (!Geo.Species.Contains(species)) throw ApiException.Bad("Choose a valid species.");
            var brandId = body.StrOrNull("brandId");
            if (brandId is not null)
            {
                var brand = db.Row("SELECT * FROM stock_brands WHERE id = @id", new { id = brandId })
                            ?? throw ApiException.NotFound("Brand not found.");
                if (brand.S("owner_id") != farmer.Id) throw ApiException.Forbidden("That brand belongs to another owner.");
            }

            var existing = db.Row(
                @"SELECT id, owner_id, status FROM livestock_tags
                  WHERE tag_normalized = @n AND status IN ('live','missing','stolen') LIMIT 1", new { n = normalized });
            var existingConflict = db.Exists(
                @"SELECT 1 FROM livestock_tags WHERE tag_normalized = @n AND status = 'conflict' AND owner_id = @o",
                new { n = normalized, o = farmer.Id });
            if (existing is not null && existing.S("owner_id") == farmer.Id)
                throw ApiException.Conflict("You already registered tag " + number + ".");
            if (existingConflict)
                throw ApiException.Conflict("This tag is already waiting for a reviewer's decision.");

            var id = Ids.New("tag");
            var conflict = existing is not null;
            db.Begin();
            try
            {
                string? cardId = null;
                if (body.StrOrNull("card") is { } card)
                    cardId = Storage.SaveDataUrl(db, card, "tag_card", farmer.Id).S("id");

                db.Exec(@"INSERT INTO livestock_tags (id, owner_id, brand_id, tag_number, tag_normalized, species,
                            herd_name, namlits_registered, card_path, status, created_at)
                          VALUES (@id,@o,@b,@n,@norm,@s,@herd,@am,@card,@status,@now)",
                    new
                    {
                        id, o = farmer.Id, b = brandId, n = number, norm = normalized, s = species,
                        herd = body.StrOrNull("herdName"), am = body.Bool("namlitsRegistered") ? 1 : 0,
                        card = cardId, status = conflict ? "conflict" : "live", now = Ts.Now()
                    });

                if (conflict)
                {
                    Notify.Staff(db, "reviewer", "Tag conflict needs a decision",
                        $"Tag {number} is already registered live to another owner. The second registration from {farmer.Name} was refused and routed to you.",
                        new { tagId = id });
                    Notify.Send(db, farmer.Id, "Tag registration refused",
                        $"Tag {number} is already registered to a live owner. Your registration was refused and sent to a reviewer to check for a mistake or theft.",
                        farmer.Lang, new { tagId = id });
                }
                else
                {
                    Notify.Send(db, farmer.Id, "Ear tag registered",
                        $"Tag {number} is now on your register. If animals carrying it go missing, report them so marketplace listings are held automatically.",
                        farmer.Lang, new { tagId = id });
                }

                Audit.Log(db, ctx, conflict ? "tag.conflict_routed" : "tag.created", "livestock_tag", id, "livestock_tags",
                    details: conflict ? "Second live registration refused; routed to reviewer" : "Registered live tag");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            if (conflict)
                throw ApiException.Conflict(
                    "Tag " + number + " is already registered to a live owner. Your registration was refused and routed to a reviewer.");

            return Results.Json(new { id, tagNumber = number, status = "live" }, statusCode: 201);
        });

        app.MapGet("/api/tags/mine", (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var rows = db.Rows(@"SELECT t.*, b.brand_mark_text FROM livestock_tags t
                                 LEFT JOIN stock_brands b ON b.id = t.brand_id
                                 WHERE t.owner_id = @o ORDER BY t.created_at DESC", new { o = farmer.Id });
            var openMissing = db.Rows(
                "SELECT id, tag_numbers FROM missing_reports WHERE owner_id = @o AND status = 'open'",
                new { o = farmer.Id });
            return Results.Json(rows.Select(t =>
            {
                var view = TagView(t);
                var normalized = t.S("tag_normalized") ?? "";
                var report = openMissing.FirstOrDefault(r =>
                    Matching.ParseTags(r.S("tag_numbers")).Contains(normalized));
                return new
                {
                    view,
                    brandMark = t.S("brand_mark_text"),
                    missingReportId = report is null ? null : report.S("id")
                };
            }));
        });

        app.MapGet("/api/tags/{id}/history", (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.Require(ctx);
            var tag = db.Row("SELECT * FROM livestock_tags WHERE id = @id", new { id })
                      ?? throw ApiException.NotFound("Tag not found.");
            if (tag.S("owner_id") != user.Id && !user.IsReviewer) throw ApiException.Forbidden();
            var normalized = tag.S("tag_normalized") ?? Codes.NormalizeMark(tag.S("tag_number"));

            var transfers = db.Rows(@"SELECT tr.*, ti.species, ti.qty FROM livestock_transfer_items ti
                                      JOIN livestock_transfers tr ON tr.id = ti.transfer_id
                                      WHERE ti.tag_id = @id ORDER BY tr.created_at DESC", new { id });
            var missing = db.Rows("SELECT * FROM missing_reports WHERE owner_id = @o ORDER BY created_at DESC",
                    new { o = tag.S("owner_id") })
                .Where(r => Matching.ParseTags(r.S("tag_numbers")).Contains(normalized))
                .Select(r => new { id = r.S("id"), status = r.S("status"), createdAt = r.S("created_at") })
                .ToList();

            return Results.Json(new
            {
                tag = TagView(tag),
                transfers = transfers.Select(t => new
                {
                    id = t.S("id"),
                    sellerId = t.S("seller_id"),
                    buyerId = t.S("buyer_id"),
                    status = t.S("status"),
                    movementPermitNo = t.S("movement_permit_no"),
                    species = t.S("species"),
                    qty = t.I("qty"),
                    createdAt = t.S("created_at")
                }),
                missingReports = missing
            });
        });

        app.MapGet("/api/admin/tag-conflicts", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var rows = db.Rows(@"SELECT t.*, u.full_name AS claimant_name, u.phone_e164 AS claimant_phone
                                 FROM livestock_tags t JOIN users u ON u.id = t.owner_id
                                 WHERE t.status = 'conflict' ORDER BY t.created_at ASC");
            return Results.Json(rows.Select(t =>
            {
                var live = db.Row(
                    @"SELECT t.*, u.full_name AS owner_name, u.phone_e164 AS owner_phone FROM livestock_tags t
                      JOIN users u ON u.id = t.owner_id
                      WHERE t.tag_normalized = @n AND t.status IN ('live','missing','stolen') AND t.id <> @id LIMIT 1",
                    new { n = t.S("tag_normalized"), id = t.S("id") });
                return new
                {
                    id = t.S("id"),
                    tagNumber = t.S("tag_number"),
                    claimantName = t.S("claimant_name"),
                    claimantPhone = t.S("claimant_phone"),
                    createdAt = t.S("created_at"),
                    liveOwner = live is null ? null : new
                    {
                        tagId = live.S("id"),
                        ownerName = live.S("owner_name"),
                        ownerPhone = live.S("owner_phone"),
                        status = live.S("status")
                    }
                };
            }));
        });

        app.MapPost("/api/admin/tag-conflicts/{id}/resolve", async (HttpContext ctx, Db db, string id) =>
        {
            var reviewer = Auth.Require(ctx, "reviewer", "admin");
            var conflict = db.Row("SELECT * FROM livestock_tags WHERE id = @id AND status = 'conflict'", new { id })
                           ?? throw ApiException.NotFound("Open tag conflict not found.");
            var body = await Api.BodyAsync(ctx);
            var decision = body.Str("decision");
            if (decision is not ("retain_owner" or "accept_new"))
                throw ApiException.Bad("Choose retain_owner or accept_new.");
            var reason = body.Str("reason", false, decision == "retain_owner"
                ? "Existing registered owner confirmed."
                : "Reviewer accepted the second registration after checking documents.");

            var existing = db.Row(
                @"SELECT * FROM livestock_tags WHERE tag_normalized = @n AND status IN ('live','missing','stolen')
                  AND id <> @id LIMIT 1",
                new { n = conflict.S("tag_normalized"), id });
            if (existing is null) throw ApiException.Conflict("The original live tag is no longer active. Refresh the queue.");

            db.Begin();
            try
            {
                if (decision == "retain_owner")
                {
                    db.Exec("UPDATE livestock_tags SET status = 'retired' WHERE id = @id", new { id });
                }
                else
                {
                    db.Exec("UPDATE livestock_tags SET status = 'retired' WHERE id = @id", new { id = existing.S("id") });
                    db.Exec("UPDATE livestock_tags SET status = 'live' WHERE id = @id", new { id });
                }

                Notify.Send(db, conflict.S("owner_id")!, decision == "retain_owner"
                        ? "Tag conflict decided in your favour"
                        : "Tag ownership transferred by a reviewer",
                    decision == "retain_owner"
                        ? $"Your registration of tag {conflict.S("tag_number")} was refused because the tag is registered to another live owner. Reason: {reason}"
                        : $"A reviewer transferred tag {conflict.S("tag_number")} to you after checking the documents. Reason: {reason}",
                    "en", new { tagId = id });
                Notify.Send(db, existing.S("owner_id")!, decision == "retain_owner"
                        ? "Tag remains yours"
                        : "Tag removed from your register",
                    decision == "retain_owner"
                        ? $"Tag {conflict.S("tag_number")} stays on your register. A second registration was refused. Reason: {reason}"
                        : $"Tag {conflict.S("tag_number")} was transferred to another owner by a reviewer. Reason: {reason}",
                    "en", new { tagId = existing.S("id") });

                Audit.Log(db, ctx, "tag_conflict.resolved", "livestock_tag", id, "livestock_tags",
                    new { conflictStatus = "conflict", liveTagId = existing.S("id") },
                    new { decision, reason }, "status", "Reviewer " + reviewer.Name);
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new { ok = true, decision });
        });

        // ---------------------------------------------------------------- found reports
        app.MapPost("/api/found-reports", async (HttpContext ctx, Db db) =>
        {
            var finder = Auth.Require(ctx);
            var body = await Api.BodyAsync(ctx);
            var brandText = body.StrOrNull("brandText");
            var tags = body.StrList("tagNumbers");
            var photo = body.StrOrNull("photo");
            if (string.IsNullOrWhiteSpace(brandText) && tags.Count == 0 && photo is null)
                throw ApiException.Bad("Record a brand mark, a tag number or a photo of the animals.");
            var species = body.Str("species", false, "Cattle");
            if (!Geo.Species.Contains(species)) throw ApiException.Bad("Choose a valid species.");
            var qty = body.Int("qty", 1);
            if (qty <= 0) throw ApiException.Bad("Enter how many animals were found.");
            var location = body.Str("locationText");

            var limit = Settings.Int(db, "brand_lookup_daily_limit", 20);
            var used = db.Int(
                "SELECT COUNT(*) FROM brand_lookups WHERE user_id = @u AND created_at > @since",
                new { u = finder.Id, since = Ts.HoursFromNow(-24) });
            if (used >= limit)
            {
                db.Begin();
                try
                {
                    Notify.Staff(db, "reviewer", "Daily lookup limit exceeded",
                        $"{finder.Name} reached {used} brand/tag lookups in 24 hours. Further lookups are refused and the account is flagged.",
                        new { userId = finder.Id, used, limit });
                    Audit.Log(db, ctx, "lookup.limit_exceeded", "user", finder.Id, "brand_lookups",
                        details: $"{used} lookups in 24 hours; limit {limit}");
                    db.Commit();
                }
                catch
                {
                    db.Dispose();
                    throw;
                }
                throw new ApiException(429, "Daily lookup limit reached",
                    "You have made " + used + " lookups today. Further lookups are refused and reviewers have been notified.");
            }

            var id = Ids.New("fnd");
            var caseRef = UniqueCaseRef(db);
            db.Begin();
            try
            {
                string? photoId = null;
                if (photo is not null)
                    photoId = Storage.SaveDataUrl(db, photo, "found_photo", finder.Id).S("id");

                var noMatchDays = Settings.Int(db, "found_report_no_match_days", 30);
                db.Exec(@"INSERT INTO found_reports (id, case_ref, finder_id, photo_path, brand_text, tag_numbers,
                            species, qty, location_text, lat, lng, status, expires_at, created_at)
                          VALUES (@id,@ref,@f,@p,@brand,@tags,@s,@q,@loc,@lat,@lng,'open',@exp,@now)",
                    new
                    {
                        id, @ref = caseRef, f = finder.Id, p = photoId, brand = brandText,
                        tags = Passport.JsonList(tags), s = species, q = qty, loc = location,
                        lat = body.Num("lat"), lng = body.Num("lng"),
                        exp = Ts.DaysFromNow(noMatchDays), now = Ts.Now()
                    });

                var match = Matching.FindOwner(db, brandText, tags);
                if (match is not null)
                {
                    db.Exec(@"UPDATE found_reports SET status = 'match_found', matched_owner_id = @o,
                                matched_brand_id = @b, matched_missing_id = @m WHERE id = @id",
                        new { o = match.OwnerId, b = match.BrandId, m = match.MissingId, id });
                    if (match.MissingId is not null)
                        db.Exec("UPDATE missing_reports SET status = 'matched' WHERE id = @id", new { id = match.MissingId });
                    var fresh = db.Row("SELECT * FROM found_reports WHERE id = @id", new { id })!;
                    Matching.NotifyMatch(db, fresh, match);
                }

                db.Exec(@"INSERT INTO brand_lookups (id, user_id, query_type, query_value, matched, found_report_id,
                            client_ip, created_at)
                          VALUES (@id,@u,'found_report',@q,@matched,@report,@ip,@now)",
                    new
                    {
                        id = Ids.New("bl"), u = finder.Id, q = Q(brandText, tags),
                        matched = match is null ? 0 : 1, report = id, ip = ctx.RequestIp(), now = Ts.Now()
                    });

                Audit.Log(db, ctx, "found_report.created", "found_report", id, "found_reports",
                    details: match is null
                        ? "No match at creation; report kept open for automatic re-check"
                        : "Blind match recorded; finder received a case reference only");
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
                caseRef,
                status = "logged",
                message = "Report logged. Your case reference is " + caseRef + ". " +
                          "No owner details are shared with you. If a registered brand or tag matches, the owner is alerted and a reviewer checks any claim."
            }, statusCode: 201);
        });

        app.MapGet("/api/found-reports/mine", (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx);
            var rows = db.Rows("SELECT * FROM found_reports WHERE finder_id = @f ORDER BY created_at DESC",
                new { f = user.Id });
            return Results.Json(rows.Select(r => FinderView(db, r, user)));
        });

        app.MapGet("/api/found-reports/matched-to-me", (HttpContext ctx, Db db) =>
        {
            var owner = Auth.Require(ctx, "farmer");
            var rows = db.Rows(
                @"SELECT * FROM found_reports WHERE matched_owner_id = @o AND status <> 'expired'
                  ORDER BY created_at DESC", new { o = owner.Id });
            return Results.Json(rows.Select(r =>
            {
                var claim = db.Row(
                    @"SELECT id, status, decision_reason, handover_method, handover_at, handover_place
                      FROM ownership_claims WHERE found_report_id = @r AND claimant_id = @c
                      ORDER BY created_at DESC LIMIT 1",
                    new { r = r.S("id"), c = owner.Id });
                return new
                {
                    view = FinderView(db, r, owner),
                    canClaim = r.S("status") is "match_found" or "claim_pending",
                    claim = claim is null ? null : new
                    {
                        id = claim.S("id"),
                        status = claim.S("status"),
                        reason = claim.S("decision_reason"),
                        handoverMethod = claim.S("handover_method"),
                        handoverAt = claim.S("handover_at"),
                        handoverPlace = claim.S("handover_place")
                    }
                };
            }));
        });

        app.MapGet("/api/found-reports/{caseRef}", (HttpContext ctx, Db db, string caseRef) =>
        {
            var user = Auth.Require(ctx);
            var report = ByRef(db, caseRef);
            var isFinder = report.S("finder_id") == user.Id;
            var isOwner = report.S("matched_owner_id") == user.Id;
            var claim = db.Row("SELECT * FROM ownership_claims WHERE found_report_id = @r AND claimant_id = @c LIMIT 1",
                new { r = report.S("id"), c = user.Id });
            if (!isFinder && !isOwner && claim is null && !user.IsReviewer)
                throw ApiException.Forbidden("This report is private to the finder, the matched owner and reviewers.");

            var view = FinderView(db, report, user);
            return Results.Json(new
            {
                view,
                viewer = isFinder ? "finder" : isOwner ? "owner" : claim is not null ? "claimant" : "reviewer",
                claim = claim is null ? null : new
                {
                    id = claim.S("id"),
                    status = claim.S("status"),
                    statement = claim.S("statement"),
                    reason = claim.S("decision_reason"),
                    handoverMethod = claim.S("handover_method"),
                    handoverAt = claim.S("handover_at"),
                    handoverPlace = claim.S("handover_place")
                }
            });
        });

        app.MapPost("/api/found-reports/{caseRef}/claims", async (HttpContext ctx, Db db, string caseRef) =>
        {
            var owner = Auth.Require(ctx, "farmer");
            var report = ByRef(db, caseRef);
            if (report.S("matched_owner_id") != owner.Id)
                throw ApiException.Forbidden("Only the owner identified by the blind match can claim these animals.");
            if (report.S("status") is "claim_approved" or "handover_arranged" or "closed")
                throw ApiException.Conflict("This report already has an approved claim.");
            if (db.Exists("SELECT 1 FROM ownership_claims WHERE found_report_id = @r AND claimant_id = @c AND status = 'pending'",
                    new { r = report.S("id"), c = owner.Id }))
                throw ApiException.Conflict("Your claim is already waiting for a reviewer.");

            var body = await Api.BodyAsync(ctx);
            var statement = body.Str("statement");
            if (statement.Length < 20) throw ApiException.Bad("Explain how you prove ownership.");
            var docs = body.Arr("documents");
            if (docs.Count == 0)
                throw ApiException.Bad("Attach a brand certificate, registration card or tag record.");
            var typed = docs.Select(d => new
            {
                docType = d.Str("docType"),
                image = d.StrOrNull("image"),
                fileId = d.StrOrNull("fileId")
            }).ToList();
            if (typed.Any(d => !ClaimDocTypes.Contains(d.docType)))
                throw ApiException.Bad("Choose a supported document type.");
            if (!typed.Any(d => RequiredClaimDocTypes.Contains(d.docType)))
                throw ApiException.Bad("A brand certificate, registration card or tag record is required.");
            if (typed.Any(d => d.image is null && d.fileId is null))
                throw ApiException.Bad("Every document needs an attached image or PDF.");

            var id = Ids.New("claim");
            db.Begin();
            try
            {
                db.Exec(@"INSERT INTO ownership_claims (id, found_report_id, claimant_id, statement, status, created_at)
                          VALUES (@id,@r,@c,@s,'pending',@now)",
                    new { id, r = report.S("id"), c = owner.Id, s = statement, now = Ts.Now() });

                foreach (var doc in typed)
                {
                    var fileId = doc.fileId;
                    if (fileId is null)
                    {
                        var saved = Storage.SaveDataUrl(db, doc.image, "ownership_doc", owner.Id);
                        fileId = saved.S("id");
                    }
                    else
                    {
                        var file = Storage.ById(db, fileId);
                        if (Convert.ToString(file["owner_id"]) != owner.Id)
                            throw ApiException.Forbidden("A document belongs to another account.");
                    }

                    db.Exec(@"INSERT INTO ownership_documents (id, claim_id, doc_type, file_path, review_status,
                                uploaded_by, created_at)
                              VALUES (@id,@claim,@type,@file,'pending',@by,@now)",
                        new
                        {
                            id = Ids.New("doc"), claim = id, type = doc.docType, file = fileId,
                            by = owner.Id, now = Ts.Now()
                        });
                }

                db.Exec("UPDATE found_reports SET status = 'claim_pending' WHERE id = @id", new { id = report.S("id") });
                Notify.Staff(db, "reviewer", "Ownership claim needs a decision",
                    $"{owner.Name} claimed the animals in {report.S("case_ref")}. Check the documents against the brand and tag register. The finder never sees the owner.",
                    new { claimId = id, caseRef = report.S("case_ref") });
                Notify.Send(db, owner.Id, "Your ownership claim was received",
                    $"Your claim on {report.S("case_ref")} is with a reviewer. Keep the original documents. Ownership is only confirmed after review.",
                    owner.Lang, new { claimId = id, caseRef = report.S("case_ref") });
                Notify.Send(db, report.S("finder_id")!, "A claim was submitted for " + report.S("case_ref"),
                    "A person has claimed the animals you found. A reviewer is checking the documents. " +
                    "No owner contact details are shared with you. Handover is arranged through the police or the State Veterinary office.",
                    "en", new { caseRef = report.S("case_ref") });

                Audit.Log(db, ctx, "ownership_claim.created", "ownership_claim", id, "ownership_claims",
                    details: "Documents: " + string.Join(",", typed.Select(d => d.docType)));
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
                status = "pending",
                message = "Claim submitted. A reviewer checks the documents. The finder receives status only, never your details."
            }, statusCode: 201);
        });

        app.MapGet("/api/claims/mine", (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx, "farmer");
            var rows = db.Rows(@"SELECT c.*, f.case_ref, f.species, f.qty, f.location_text, f.status AS report_status
                                 FROM ownership_claims c JOIN found_reports f ON f.id = c.found_report_id
                                 WHERE c.claimant_id = @c ORDER BY c.created_at DESC", new { c = user.Id });
            return Results.Json(rows.Select(c => new
            {
                id = c.S("id"),
                caseRef = c.S("case_ref"),
                species = c.S("species"),
                qty = c.I("qty"),
                locationText = c.S("location_text"),
                status = c.S("status"),
                reportStatus = c.S("report_status"),
                reason = c.S("decision_reason"),
                handoverMethod = c.S("handover_method"),
                handoverAt = c.S("handover_at"),
                handoverPlace = c.S("handover_place"),
                createdAt = c.S("created_at")
            }));
        });

        app.MapPost("/api/claims/{id}/handover", async (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.Require(ctx);
            var claim = db.Row("SELECT * FROM ownership_claims WHERE id = @id", new { id })
                        ?? throw ApiException.NotFound("Claim not found.");
            if (claim.S("status") != "approved")
                throw ApiException.Conflict("A handover can only be arranged after a claim is approved.");
            if (claim.S("claimant_id") != user.Id && !user.IsReviewer) throw ApiException.Forbidden();

            var body = await Api.BodyAsync(ctx);
            var method = body.Str("method");
            if (method is not ("police_station" or "state_vet_office" or "direct_with_consent"))
                throw ApiException.Bad("Choose police_station, state_vet_office or direct_with_consent.");
            if (method == "direct_with_consent" && !body.Bool("bothPartiesConsent"))
                throw ApiException.Bad("Direct handover needs the consent of both parties. Otherwise use the police or State Veterinary office.");
            var place = body.Str("place", false, method == "police_station"
                ? "Nearest Namibian Police station"
                : method == "state_vet_office" ? "State Veterinary office" : "Agreed public place");
            var at = body.Str("at", false, Ts.DaysFromNow(3));

            var report = db.Row("SELECT * FROM found_reports WHERE id = @r", new { r = claim.S("found_report_id") })
                         ?? throw ApiException.NotFound("Found report not found.");

            db.Begin();
            try
            {
                db.Exec(@"UPDATE ownership_claims SET handover_method = @m, handover_at = @at, handover_place = @p
                          WHERE id = @id", new { m = method, at, p = place, id });
                db.Exec("UPDATE found_reports SET status = 'handover_arranged' WHERE id = @id",
                    new { id = claim.S("found_report_id") });

                var methodLabel = method switch
                {
                    "police_station" => "at a Namibian Police station",
                    "state_vet_office" => "at the State Veterinary office",
                    _ => "directly, with the consent of both parties"
                };
                Notify.Send(db, claim.S("claimant_id")!, "Handover arranged for " + report.S("case_ref"),
                    $"Handover will take place {methodLabel} at {place} on {Ts.DateOnly(at)}. Bring the original documents. " +
                    "Never pay a reward under pressure; report extortion to the police.",
                    "en", new { claimId = id, caseRef = report.S("case_ref") });
                Notify.Send(db, report.S("finder_id")!, "Handover arranged for " + report.S("case_ref"),
                    $"A reviewer approved the ownership claim. The handover will take place {methodLabel} at {place} on {Ts.DateOnly(at)}. " +
                    "The police or State Veterinary office can hold the animals until then.",
                    "en", new { caseRef = report.S("case_ref") });

                Audit.Log(db, ctx, "claim.handover_arranged", "ownership_claim", id, "ownership_claims",
                    new { status = "approved" }, new { handover_method = method, handover_place = place, handover_at = at },
                    "handover_method,handover_at,handover_place");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new { ok = true, status = "handover_arranged", method, place, at });
        });

        // ---------------------------------------------------------------- missing animals
        app.MapPost("/api/missing-reports", async (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var body = await Api.BodyAsync(ctx);
            var tags = body.StrList("tagNumbers");
            if (tags.Count == 0) throw ApiException.Bad("Add the ear-tag numbers of the missing animals.");
            var species = body.Str("species", false, "Cattle");
            if (!Geo.Species.Contains(species)) throw ApiException.Bad("Choose a valid species.");
            var qty = body.Int("qty", tags.Count);
            var brandId = body.StrOrNull("brandId");
            if (brandId is not null && !db.Exists("SELECT 1 FROM stock_brands WHERE id = @id AND owner_id = @o",
                    new { id = brandId, o = farmer.Id }))
                throw ApiException.Forbidden("That brand belongs to another owner.");

            var id = Ids.New("miss");
            db.Begin();
            try
            {
                db.Exec(@"INSERT INTO missing_reports (id, owner_id, brand_id, tag_numbers, species, qty,
                            last_seen_place, last_seen_at, police_case_no, status, created_at)
                          VALUES (@id,@o,@b,@tags,@s,@q,@place,@seen,@police,'open',@now)",
                    new
                    {
                        id, o = farmer.Id, b = brandId, tags = Passport.JsonList(tags), s = species, q = qty,
                        place = body.StrOrNull("lastSeenPlace"), seen = body.StrOrNull("lastSeenAt"),
                        police = body.StrOrNull("policeCaseNo"), now = Ts.Now()
                    });

                foreach (var tag in tags)
                {
                    var normalized = Codes.NormalizeMark(tag);
                    db.Exec(@"UPDATE livestock_tags SET status = 'missing'
                              WHERE owner_id = @o AND tag_normalized = @n AND status = 'live'",
                        new { o = farmer.Id, n = normalized });
                }

                Matching.RecheckOpenReports(db);

                Notify.Staff(db, "reviewer", "Missing livestock reported",
                    $"{farmer.Name} reported {qty} {species} missing. Tags: {string.Join(", ", tags)}. " +
                    "Any marketplace listing carrying these tags is held automatically.",
                    new { missingReportId = id });
                Notify.Send(db, farmer.Id, "Missing livestock report opened",
                    "Your report is open. If anyone logs a found animal with your brand or tags, you are alerted. " +
                    "You will never receive the finder's details, and the finder never receives yours.",
                    farmer.Lang, new { missingReportId = id });
                Audit.Log(db, ctx, "missing_report.created", "missing_report", id, "missing_reports",
                    details: "Tags: " + string.Join(",", tags));
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new { id, status = "open", tags }, statusCode: 201);
        });

        app.MapGet("/api/missing-reports/mine", (HttpContext ctx, Db db) =>
        {
            var farmer = Auth.Require(ctx, "farmer");
            var rows = db.Rows("SELECT * FROM missing_reports WHERE owner_id = @o ORDER BY created_at DESC",
                new { o = farmer.Id });
            return Results.Json(rows.Select(r => new
            {
                id = r.S("id"),
                tags = Matching.ParseTags(r.S("tag_numbers")),
                species = r.S("species"),
                qty = r.I("qty"),
                lastSeenPlace = r.S("last_seen_place"),
                lastSeenAt = r.S("last_seen_at"),
                policeCaseNo = r.S("police_case_no"),
                status = r.S("status"),
                createdAt = r.S("created_at")
            }));
        });

        // ---------------------------------------------------------------- transfers
        app.MapPost("/api/transfers", async (HttpContext ctx, Db db) =>
        {
            var seller = Auth.Require(ctx, "farmer");
            var body = await Api.BodyAsync(ctx);
            var tagNumbers = body.StrList("tagNumbers");
            if (tagNumbers.Count == 0) throw ApiException.Bad("Add the ear-tag numbers being sold.");
            var buyer = body.StrOrNull("buyerId") is { } buyerId
                ? db.Row("SELECT * FROM users WHERE id = @id", new { id = buyerId })
                : db.Row("SELECT * FROM users WHERE phone_e164 = @p",
                    new { p = AuthApi.NormalizePhone(body.StrOrNull("buyerPhone") ?? "") ?? "" });
            if (buyer is null) throw ApiException.NotFound("No buyer account found for that phone number. Ask the buyer to register first.");
            if (buyer.S("id") == seller.Id) throw ApiException.Bad("You cannot transfer animals to yourself.");
            var buyerRole = buyer.S("role");
            if (buyerRole is not ("farmer" or "worker")) throw ApiException.Bad("The buyer must have a KraaLink account.");
            var listingId = body.StrOrNull("listingId");
            if (listingId is not null && !db.Exists("SELECT 1 FROM listings WHERE id = @id AND farmer_id = @o",
                    new { id = listingId, o = seller.Id }))
                throw ApiException.Forbidden("That listing belongs to another seller.");

            var tagRows = new List<Dictionary<string, object?>>();
            foreach (var number in tagNumbers)
            {
                var normalized = Codes.NormalizeMark(number);
                var tag = db.Row(
                    @"SELECT * FROM livestock_tags WHERE tag_normalized = @n AND status IN ('live','missing')
                      LIMIT 1", new { n = normalized })
                          ?? throw ApiException.NotFound("Tag " + number + " is not on any live register.");
                if (tag.S("owner_id") != seller.Id)
                    throw ApiException.Forbidden("Tag " + number + " is registered to another owner.");
                tagRows.Add(tag);
            }

            var id = Ids.New("trf");
            db.Begin();
            try
            {
                db.Exec(@"INSERT INTO livestock_transfers (id, seller_id, buyer_id, listing_id, movement_permit_no,
                            status, seller_confirmed_at, created_at)
                          VALUES (@id,@s,@b,@l,@permit,'pending_buyer',@now,@now)",
                    new
                    {
                        id, s = seller.Id, b = buyer.S("id"), l = listingId,
                        permit = body.StrOrNull("movementPermitNo"), now = Ts.Now()
                    });
                foreach (var tag in tagRows)
                    db.Exec(@"INSERT INTO livestock_transfer_items (id, transfer_id, tag_id, species, qty)
                              VALUES (@id,@tr,@tag,@s,1)",
                        new { id = Ids.New("tri"), tr = id, tag = tag.S("id"), s = tag.S("species") });

                Notify.Send(db, buyer.S("id")!, "Livestock transfer waiting for you",
                    $"{seller.Name} recorded a transfer of {tagRows.Count} animal(s) to you. Tags: {string.Join(", ", tagNumbers)}. " +
                    "Confirm only after the animals and tags are in front of you.",
                    buyer.S("language_code") ?? "en", new { transferId = id }, "whatsapp");
                Audit.Log(db, ctx, "transfer.created", "livestock_transfer", id, "livestock_transfers",
                    details: "Tags: " + string.Join(",", tagNumbers) + "; seller confirmed");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new { id, status = "pending_buyer", message = "Buyer notified on WhatsApp." }, statusCode: 201);
        });

        app.MapGet("/api/transfers/mine", (HttpContext ctx, Db db) =>
        {
            var user = Auth.Require(ctx, "farmer", "worker");
            var rows = db.Rows(@"SELECT t.*,
                                        su.full_name AS seller_name, bu.full_name AS buyer_name
                                 FROM livestock_transfers t
                                 JOIN users su ON su.id = t.seller_id
                                 JOIN users bu ON bu.id = t.buyer_id
                                 WHERE t.seller_id = @u OR t.buyer_id = @u
                                 ORDER BY t.created_at DESC", new { u = user.Id });
            return Results.Json(rows.Select(t =>
            {
                var items = db.Rows(@"SELECT ti.*, lt.tag_number FROM livestock_transfer_items ti
                                      LEFT JOIN livestock_tags lt ON lt.id = ti.tag_id
                                      WHERE ti.transfer_id = @id", new { id = t.S("id") });
                return new
                {
                    id = t.S("id"),
                    sellerName = t.S("seller_name"),
                    buyerName = t.S("buyer_name"),
                    status = t.S("status"),
                    movementPermitNo = t.S("movement_permit_no"),
                    sellerConfirmedAt = t.S("seller_confirmed_at"),
                    buyerConfirmedAt = t.S("buyer_confirmed_at"),
                    canConfirm = t.S("status") == "pending_buyer" && t.S("buyer_id") == user.Id
                                 || t.S("status") == "pending_seller" && t.S("seller_id") == user.Id,
                    items = items.Select(i => new
                    {
                        tagNumber = i.S("tag_number"), species = i.S("species"), qty = i.I("qty")
                    }),
                    createdAt = t.S("created_at")
                };
            }));
        });

        app.MapPost("/api/transfers/{id}/confirm", (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.Require(ctx, "farmer", "worker");
            var transfer = db.Row("SELECT * FROM livestock_transfers WHERE id = @id", new { id })
                           ?? throw ApiException.NotFound("Transfer not found.");
            if (transfer.S("status") is "confirmed" or "cancelled")
                throw ApiException.Conflict("This transfer is already " + transfer.S("status") + ".");

            var isSeller = transfer.S("seller_id") == user.Id;
            var isBuyer = transfer.S("buyer_id") == user.Id;
            if (!isSeller && !isBuyer) throw ApiException.Forbidden();

            db.Begin();
            try
            {
                if (isSeller)
                    db.Exec("UPDATE livestock_transfers SET seller_confirmed_at = COALESCE(seller_confirmed_at, @now), " +
                            "status = CASE WHEN buyer_confirmed_at IS NOT NULL THEN 'confirmed' ELSE 'pending_buyer' END WHERE id = @id",
                        new { now = Ts.Now(), id });
                else
                    db.Exec("UPDATE livestock_transfers SET buyer_confirmed_at = COALESCE(buyer_confirmed_at, @now), " +
                            "status = CASE WHEN seller_confirmed_at IS NOT NULL THEN 'confirmed' ELSE 'pending_seller' END WHERE id = @id",
                        new { now = Ts.Now(), id });

                var fresh = db.Row("SELECT * FROM livestock_transfers WHERE id = @id", new { id })!;
                if (fresh.S("status") == "confirmed")
                {
                    foreach (var item in db.Rows("SELECT * FROM livestock_transfer_items WHERE transfer_id = @id", new { id }))
                        db.Exec("UPDATE livestock_tags SET owner_id = @b, status = 'live' WHERE id = @t",
                            new { b = fresh.S("buyer_id"), t = item.S("tag_id") });
                    db.Exec("UPDATE listings SET status = 'sold' WHERE id = @l",
                        new { l = fresh.S("listing_id") });

                    Notify.Send(db, fresh.S("seller_id")!, "Transfer confirmed",
                        "Both parties confirmed. The tag register now shows the buyer as owner. Keep the signed transfer record.",
                        "en", new { transferId = id });
                    Notify.Send(db, fresh.S("buyer_id")!, "Transfer confirmed",
                        "Both parties confirmed. The animals and their tags are now on your register.",
                        "en", new { transferId = id });
                }

                Audit.Log(db, ctx, "transfer.confirmed_by_party", "livestock_transfer", id, "livestock_transfers",
                    new { status = transfer.S("status") }, new { status = fresh.S("status") },
                    "status,seller_confirmed_at,buyer_confirmed_at");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new { ok = true, status = db.Str("SELECT status FROM livestock_transfers WHERE id = @id", new { id }) });
        });

        app.MapPost("/api/transfers/{id}/cancel", async (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.Require(ctx, "farmer", "worker");
            var transfer = db.Row("SELECT * FROM livestock_transfers WHERE id = @id", new { id })
                           ?? throw ApiException.NotFound("Transfer not found.");
            if (transfer.S("seller_id") != user.Id && transfer.S("buyer_id") != user.Id) throw ApiException.Forbidden();
            if (transfer.S("status") == "confirmed") throw ApiException.Conflict("A confirmed transfer cannot be cancelled.");
            var body = await Api.BodyAsync(ctx);
            var reason = body.Str("reason", false, "Cancelled by a party.");
            db.Exec("UPDATE livestock_transfers SET status = 'cancelled' WHERE id = @id", new { id });
            Notify.Send(db, transfer.S("seller_id")!, "Transfer cancelled", reason, "en", new { transferId = id });
            Notify.Send(db, transfer.S("buyer_id")!, "Transfer cancelled", reason, "en", new { transferId = id });
            Audit.Log(db, ctx, "transfer.cancelled", "livestock_transfer", id, "livestock_transfers",
                new { status = transfer.S("status") }, new { status = "cancelled" }, "status", reason);
            return Results.Json(new { ok = true, status = "cancelled" });
        });

        // ---------------------------------------------------------------- reviewer views
        app.MapGet("/api/admin/found-reports", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var status = ctx.Q("status", "all");
            var rows = db.Rows(@"SELECT f.*, u.full_name AS finder_name, u.phone_e164 AS finder_phone
                                 FROM found_reports f LEFT JOIN users u ON u.id = f.finder_id
                                 WHERE (@s = 'all' OR f.status = @s)
                                 ORDER BY f.created_at DESC", new { s = status });
            return Results.Json(rows.Select(r => new
            {
                id = r.S("id"),
                caseRef = r.S("case_ref"),
                finderName = r.S("finder_name"),
                finderPhone = r.S("finder_phone"),
                brandText = r.S("brand_text"),
                tags = Matching.ParseTags(r.S("tag_numbers")),
                species = r.S("species"),
                qty = r.I("qty"),
                locationText = r.S("location_text"),
                status = r.S("status"),
                matchedOwnerName = r.S("matched_owner_id") is { } oid
                    ? db.Str("SELECT full_name FROM users WHERE id = @id", new { id = oid })
                    : null,
                photoUrl = Url(r.S("photo_path")),
                expiresAt = r.S("expires_at"),
                createdAt = r.S("created_at")
            }));
        });

        app.MapGet("/api/admin/claims", (HttpContext ctx, Db db) =>
        {
            Auth.Require(ctx, "reviewer", "admin");
            var status = ctx.Q("status", "pending");
            var rows = db.Rows(@"SELECT c.*, f.case_ref, f.status AS report_status, f.species, f.qty,
                                        f.location_text, u.full_name AS claimant_name,
                                        u.phone_e164 AS claimant_phone
                                 FROM ownership_claims c
                                 JOIN found_reports f ON f.id = c.found_report_id
                                 JOIN users u ON u.id = c.claimant_id
                                 WHERE (@s = 'all' OR c.status = @s)
                                 ORDER BY c.created_at ASC", new { s = status });
            return Results.Json(rows.Select(c =>
            {
                var docs = db.Rows("SELECT * FROM ownership_documents WHERE claim_id = @id", new { id = c.S("id") });
                return new
                {
                    id = c.S("id"),
                    caseRef = c.S("case_ref"),
                    reportStatus = c.S("report_status"),
                    claimantName = c.S("claimant_name"),
                    claimantPhone = c.S("claimant_phone"),
                    statement = c.S("statement"),
                    species = c.S("species"),
                    qty = c.I("qty"),
                    locationText = c.S("location_text"),
                    status = c.S("status"),
                    reason = c.S("decision_reason"),
                    handoverMethod = c.S("handover_method"),
                    handoverAt = c.S("handover_at"),
                    handoverPlace = c.S("handover_place"),
                    documents = docs.Select(d => new
                    {
                        id = d.S("id"),
                        docType = d.S("doc_type"),
                        reviewStatus = d.S("review_status"),
                        url = Url(d.S("file_path")),
                        createdAt = d.S("created_at")
                    }),
                    createdAt = c.S("created_at")
                };
            }));
        });

        app.MapPost("/api/admin/claims/{id}/decision", async (HttpContext ctx, Db db, string id) =>
        {
            var reviewer = Auth.Require(ctx, "reviewer", "admin");
            var claim = db.Row("SELECT * FROM ownership_claims WHERE id = @id", new { id })
                        ?? throw ApiException.NotFound("Claim not found.");
            if (claim.S("status") != "pending") throw ApiException.Conflict("This claim has already been decided.");
            var body = await Api.BodyAsync(ctx);
            var decision = body.Str("decision");
            if (decision is not ("approve" or "reject")) throw ApiException.Bad("Choose approve or reject.");
            var reason = body.Str("reason");
            var report = db.Row("SELECT * FROM found_reports WHERE id = @r", new { r = claim.S("found_report_id") })!;
            var docs = db.Int("SELECT COUNT(*) FROM ownership_documents WHERE claim_id = @id", new { id });
            if (decision == "approve" && docs == 0)
                throw ApiException.Bad("A claim cannot be approved without at least one supporting document.");
            if (db.Exists("SELECT 1 FROM ownership_claims WHERE found_report_id = @r AND status = 'approved' AND id <> @id",
                    new { r = claim.S("found_report_id"), id }))
                throw ApiException.Conflict("Another claim on this report is already approved.");

            db.Begin();
            try
            {
                if (decision == "approve")
                {
                    db.Exec(@"UPDATE ownership_claims SET status = 'approved', reviewed_by = @by, decision_reason = @r,
                                decided_at = @now WHERE id = @id",
                        new { by = reviewer.Id, r = reason, now = Ts.Now(), id });
                    db.Exec(@"UPDATE ownership_documents SET review_status = 'accepted' WHERE claim_id = @id", new { id });
                    db.Exec("UPDATE found_reports SET status = 'claim_approved' WHERE id = @id",
                        new { id = claim.S("found_report_id") });

                    var others = db.Rows(
                        "SELECT * FROM ownership_claims WHERE found_report_id = @r AND status = 'pending' AND id <> @id",
                        new { r = claim.S("found_report_id"), id });
                    foreach (var other in others)
                    {
                        db.Exec(@"UPDATE ownership_claims SET status = 'rejected', reviewed_by = @by,
                                    decision_reason = @reason, decided_at = @now WHERE id = @id",
                            new
                            {
                                by = reviewer.Id, reason = "Another claim on this report was approved first.",
                                now = Ts.Now(), id = other.S("id")
                            });
                        Notify.Send(db, other.S("claimant_id")!, "Ownership claim not approved",
                            "Another claim on " + report.S("case_ref") + " was approved first. If you believe this is wrong, contact a reviewer with your original documents.",
                            "en", new { caseRef = report.S("case_ref") });
                    }

                    Notify.Send(db, claim.S("claimant_id")!, "Ownership claim approved — arrange handover",
                        $"Your claim on {report.S("case_ref")} was approved. Arrange the handover through the police, the State Veterinary office, " +
                        "or directly only if both parties consent. Bring the original documents.",
                        "en", new { claimId = id, caseRef = report.S("case_ref") });
                    if (report.S("finder_id") is { } finder)
                        Notify.Send(db, finder, "Claim approved for " + report.S("case_ref"),
                            "A reviewer approved the ownership claim. You will be told the handover arrangements. " +
                            "No owner contact details are shared with you, and you are not obliged to hand the animals over outside the agreed process.",
                            "en", new { caseRef = report.S("case_ref") });
                }
                else
                {
                    db.Exec(@"UPDATE ownership_claims SET status = 'rejected', reviewed_by = @by,
                                decision_reason = @r, decided_at = @now WHERE id = @id",
                        new { by = reviewer.Id, r = reason, now = Ts.Now(), id });
                    db.Exec("UPDATE ownership_documents SET review_status = 'rejected' WHERE claim_id = @id", new { id });
                    var stillPending = db.Exists(
                        "SELECT 1 FROM ownership_claims WHERE found_report_id = @r AND status = 'pending'",
                        new { r = claim.S("found_report_id") });
                    db.Exec("UPDATE found_reports SET status = @s WHERE id = @id",
                        new { s = stillPending ? "claim_pending" : "match_found", id = claim.S("found_report_id") });
                    Notify.Send(db, claim.S("claimant_id")!, "Ownership claim not approved",
                        "A reviewer did not approve your claim: " + reason + " You can contact a reviewer with better documents. " +
                        "The finder is not told your details.",
                        "en", new { claimId = id, caseRef = report.S("case_ref") });
                }

                Audit.Log(db, ctx, "claim.decided", "ownership_claim", id, "ownership_claims",
                    new { status = "pending" }, new { status = decision == "approve" ? "approved" : "rejected", reason },
                    "status,reviewed_by,decided_at,decision_reason");
                db.Commit();
            }
            catch
            {
                db.Dispose();
                throw;
            }

            return Results.Json(new { ok = true, status = decision == "approve" ? "approved" : "rejected" });
        });
    }

    // -------------------------------------------------------------------- helpers
    private static Dictionary<string, object?> ByRef(Db db, string caseRef) =>
        db.Row("SELECT * FROM found_reports WHERE id = @id OR case_ref = @id", new { id = caseRef })
        ?? throw ApiException.NotFound("No found report has that reference.");

    private static object FinderView(Db db, Dictionary<string, object?> r, UserCtx user)
    {
        var isReviewer = user.IsReviewer;
        return new
        {
            id = r.S("id"),
            caseRef = r.S("case_ref"),
            finderId = isReviewer ? r.S("finder_id") : null,
            photoUrl = Url(r.S("photo_path")),
            brandText = r.S("brand_text"),
            tagNumbers = Matching.ParseTags(r.S("tag_numbers")),
            species = r.S("species"),
            qty = r.I("qty"),
            locationText = r.S("location_text"),
            status = r.S("status"),
            matched = r.S("matched_owner_id") is not null,
            expiresAt = r.S("expires_at"),
            createdAt = r.S("created_at"),
            note = "Owner details are never shown to the finder. A match is a lead, not proof of ownership."
        };
    }

    private static object TagView(Dictionary<string, object?> t) => new
    {
        id = t.S("id"),
        tagNumber = t.S("tag_number"),
        species = t.S("species"),
        herdName = t.S("herd_name"),
        namlitsRegistered = t.B("namlits_registered"),
        status = t.S("status"),
        brandId = t.S("brand_id"),
        cardUrl = Url(t.S("card_path")),
        createdAt = t.S("created_at")
    };

    private static string? Url(string? fileId) => string.IsNullOrEmpty(fileId) ? null : Storage.Url(fileId, 15);

    private static string UniqueCaseRef(Db db)
    {
        for (var i = 0; i < 40; i++)
        {
            var candidate = Codes.CaseRef();
            if (!db.Exists("SELECT 1 FROM found_reports WHERE case_ref = @c", new { c = candidate })) return candidate;
        }
        throw new ApiException(500, "Could not allocate a case reference", "Try again.");
    }

    private static string Q(string? brand, List<string> tags) =>
        string.Join(" / ", new[] { brand ?? "" }.Concat(tags).Where(v => !string.IsNullOrWhiteSpace(v)));
}
