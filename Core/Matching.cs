using System.Text.Json;

namespace KraaLink;

public sealed record OwnerMatch(string OwnerId, string? BrandId, string? MissingId, string? MatchedTag);

public static class Matching
{
    /// <summary>
    /// Blind owner matching. Returns owner identifiers for the API only; the finder never sees them.
    /// SRS FR-BRD-07..11 and AT-11.
    /// </summary>
    public static OwnerMatch? FindOwner(Db db, string? brandText, IEnumerable<string> tags)
    {
        string? brandId = null;
        string? ownerId = null;
        string? matchedTag = null;

        var normalizedBrand = Codes.NormalizeMark(brandText);
        if (normalizedBrand.Length > 0)
        {
            var brand = db.Row(
                "SELECT id, owner_id FROM stock_brands WHERE brand_normalized = @n AND status = 'verified' LIMIT 1",
                new { n = normalizedBrand });
            if (brand is not null)
            {
                brandId = brand.S("id");
                ownerId = brand.S("owner_id");
            }
        }

        foreach (var tag in tags.Select(Codes.NormalizeMark).Where(t => t.Length > 0).Distinct())
        {
            var row = db.Row(
                @"SELECT id, owner_id, status FROM livestock_tags
                  WHERE tag_normalized = @n AND status IN ('live','missing','stolen') LIMIT 1", new { n = tag });
            if (row is null) continue;
            ownerId = row.S("owner_id");
            matchedTag = tag;
            break;
        }

        string? missingId = null;
        foreach (var report in db.Rows("SELECT id, owner_id, tag_numbers FROM missing_reports WHERE status = 'open'"))
        {
            var reportTags = ParseTags(report.S("tag_numbers"));
            var hit = tags.Select(Codes.NormalizeMark)
                .FirstOrDefault(t => t.Length > 0 && reportTags.Contains(t));
            if (hit is null) continue;
            missingId = report.S("id");
            ownerId = report.S("owner_id");
            matchedTag = hit;
            break;
        }

        return ownerId is null ? null : new OwnerMatch(ownerId, brandId, missingId, matchedTag);
    }

    public static List<string> ParseTags(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<string>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.ValueKind == JsonValueKind.Array
                ? doc.RootElement.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String)
                    .Select(e => Codes.NormalizeMark(e.GetString())).Where(t => t.Length > 0).ToList()
                : new List<string>();
        }
        catch
        {
            return new List<string>();
        }
    }

    public static void NotifyMatch(Db db, Dictionary<string, object?> report, OwnerMatch match)
    {
        var caseRef = report.S("case_ref") ?? "your report";
        var ownerLang = db.Str("SELECT language_code FROM users WHERE id = @id", new { id = match.OwnerId }) ?? "en";
        var where = report.S("location_text") ?? "the reported location";
        var qty = report.I("qty");
        var species = report.S("species") ?? "animals";

        Notify.Send(db, match.OwnerId,
            "Animals found — possible match " + caseRef,
            $"{qty} {species} were reported found near {where}. A brand or tag matching your register was recorded. " +
            "This is a lead only: ownership is not yet verified. Open KraaLink to submit a claim with your brand certificate, " +
            "registration card or NamLITS record. The finder's identity stays private until a claim is approved.",
            ownerLang,
            new { caseRef, foundReportId = report.S("id"), action = "claim_ownership" });

        Notify.Staff(db, "reviewer", "Blind match needs monitoring — " + caseRef,
            "A found report matched a verified owner. The owner has been alerted and cannot see the finder. No owner detail was sent to the finder.",
            new { caseRef, foundReportId = report.S("id") });
    }

    public static bool IsHeldByAnotherOwner(Db db, string sellerId, IEnumerable<string> tags, out string reason)
    {
        reason = "";
        foreach (var tag in tags)
        {
            var normalized = Codes.NormalizeMark(tag);
            if (normalized.Length == 0) continue;
            var row = db.Row(
                @"SELECT t.status, t.owner_id, u.full_name FROM livestock_tags t JOIN users u ON u.id = t.owner_id
                  WHERE t.tag_normalized = @n AND t.status IN ('live','missing','stolen') LIMIT 1", new { n = normalized });
            if (row is not null && row.S("owner_id") != sellerId)
            {
                reason = row.S("status") == "stolen"
                    ? $"Tag {tag} is reported stolen by another owner. Held for reviewer check."
                    : row.S("status") == "missing"
                        ? $"Tag {tag} is reported missing by another owner. Held for reviewer check."
                        : $"Tag {tag} is registered to another owner. Held for reviewer check.";
                return true;
            }

            foreach (var report in db.Rows("SELECT owner_id, status, tag_numbers, id FROM missing_reports WHERE status = 'open'"))
            {
                if (report.S("owner_id") == sellerId) continue;
                if (!ParseTags(report.S("tag_numbers")).Contains(normalized)) continue;
                reason = $"Tag {tag} appears in another owner's open missing-livestock report. Held for reviewer check.";
                return true;
            }
        }
        return false;
    }

    public static void RecheckOpenReports(Db db)
    {
        foreach (var report in db.Rows(
                     "SELECT * FROM found_reports WHERE status = 'open' AND matched_owner_id IS NULL"))
        {
            var match = FindOwner(db, report.S("brand_text"), ParseTags(report.S("tag_numbers")));
            if (match is null) continue;
            db.Exec(@"UPDATE found_reports SET status = 'match_found', matched_owner_id = @o,
                        matched_brand_id = @b, matched_missing_id = @m WHERE id = @id",
                new { o = match.OwnerId, b = match.BrandId, m = match.MissingId, id = report.S("id") });
            if (match.MissingId is not null)
                db.Exec("UPDATE missing_reports SET status = 'matched' WHERE id = @id", new { id = match.MissingId });

            var fresh = db.Row("SELECT * FROM found_reports WHERE id = @id", new { id = report.S("id") })!;
            NotifyMatch(db, fresh, match);
            if (report.S("finder_id") is { } finder)
            {
                Notify.Send(db, finder, "Your found report " + report.S("case_ref") + " now has a match",
                    "The report has been re-checked and a registered brand or tag now matches. The owner has been alerted. " +
                    "Ownership is not yet verified. You will be told when a reviewer has checked the claim.",
                    "en", new { caseRef = report.S("case_ref") });
            }
            Audit.Log(db, null, "found_report.rematch", "found_report", report.S("id"), "found_reports",
                details: "Open report matched after a new verified brand or tag appeared", actorRole: "system");
        }
    }
}
