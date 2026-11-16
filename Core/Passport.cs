using System.Text.Json;

namespace KraaLink;

public static class Passport
{
    public static string LevelLabel(int level) => level switch
    {
        2 => "L2 · Community verified",
        1 => "L1 · Documented",
        _ => "L0 · Self-declared"
    };

    public static string LevelShort(int level) => "L" + level;

    public static string EndReasonLabel(string? reason) => reason switch
    {
        "contract_ended" => "Contract ended",
        "resigned" => "Resigned",
        "dismissed" => "Dismissed",
        "other" => "Other",
        _ => "Still employed"
    };

    /// <summary>Neutral record status. A missed scan never becomes an accusation (SRS 8.7, AC-06).</summary>
    public static string RecordStatus(Db db, string workerId)
    {
        var suspended = false;
        var warning = false;
        var underReview = false;

        foreach (var incident in db.Rows("SELECT * FROM incidents WHERE worker_id = @w", new { w = workerId }))
        {
            var status = incident.S("status");
            if (status == "suspended_police") suspended = true;
            if (status == "verified_warning" && !Ts.IsPast(incident.S("expires_at"))) warning = true;
            if (status is "under_review" or "worker_responded")
            {
                var evidence = incident.List("evidence_paths");
                if (evidence.Count > 0 && incident.S("worker_notified_at") is not null) underReview = true;
            }
        }

        if (suspended) return "Suspended - Police Case Open";
        if (warning) return "Verified With Warning";
        if (underReview) return "Incident Under Review";
        return "Good Record";
    }

    public static List<Dictionary<string, object?>> LastEmployers(Db db, string workerId, int take = 3)
    {
        var rows = db.Rows(
            @"SELECT e.id, e.job_title, e.status, e.started_at, e.ended_at, e.end_reason, e.no_checkout_at,
                     COALESCE(f.farm_name, u.full_name) AS employer_name, u.full_name AS farmer_name
              FROM employments e
              JOIN users u ON u.id = e.farmer_id
              LEFT JOIN farmers f ON f.user_id = e.farmer_id
              WHERE e.worker_id = @w AND e.status <> 'pending_checkin'
              ORDER BY COALESCE(e.started_at, e.created_at) DESC
              LIMIT @take", new { w = workerId, take });

        return rows.Select(r => new Dictionary<string, object?>
        {
            ["employmentId"] = r.S("id"),
            ["employer"] = r.S("employer_name"),
            ["jobTitle"] = r.S("job_title"),
            ["startedAt"] = r.S("started_at"),
            ["endedAt"] = r.S("ended_at"),
            ["endLabel"] = r.S("no_checkout_at") is not null
                ? "No check-out recorded"
                : EndReasonLabel(r.S("end_reason")),
            ["status"] = r.S("status") == "open" ? "Current employment" : "Completed"
        }).ToList();
    }

    public static Dictionary<string, object?> PassportView(Db db, Dictionary<string, object?> worker, string? consentId)
    {
        var level = worker.I("verification_level");
        return new Dictionary<string, object?>
        {
            ["workerId"] = worker.S("user_id"),
            ["name"] = worker.S("full_name"),
            ["homeVillage"] = worker.S("home_village"),
            ["constituency"] = worker.S("constituency"),
            ["regionCode"] = worker.S("region_code"),
            ["verificationLevel"] = level,
            ["levelLabel"] = LevelLabel(level),
            ["verified"] = level >= 2,
            ["photoUrl"] = string.IsNullOrEmpty(worker.S("face_path")) || consentId is null
                ? null
                : Storage.Url(worker.S("face_path")!, 5),
            ["recordStatus"] = RecordStatus(db, worker.S("user_id")!),
            ["lastEmployers"] = LastEmployers(db, worker.S("user_id")!),
            ["note"] = "Next-of-kin contacts and ID documents are never shown in a hiring check."
        };
    }

    public static Dictionary<string, object?>? Worker(Db db, string id) =>
        db.Row("SELECT * FROM workers WHERE user_id = @id", new { id });

    public static Dictionary<string, object?>? WorkerByCode(Db db, string code) =>
        db.Row("SELECT * FROM workers WHERE UPPER(short_code) = UPPER(@code)", new { code });

    public static bool HasGrantedConsent(Db db, string workerId, string farmerId) =>
        db.Exists(@"SELECT 1 FROM consents WHERE worker_id = @w AND farmer_id = @f
                    AND status = 'granted' AND expires_at > @now",
            new { w = workerId, f = farmerId, now = Ts.Now() });

    public static object Me(Db db, UserCtx user)
    {
        var row = db.Row("SELECT * FROM users WHERE id = @id", new { id = user.Id })
                  ?? throw ApiException.NotFound("Account not found.");
        var faceId = row.S("face_path");
        if (string.IsNullOrEmpty(faceId))
            faceId = db.Str("SELECT face_path FROM workers WHERE user_id = @id", new { id = user.Id });
        var hasFace = !string.IsNullOrEmpty(faceId);
        object? worker = null;
        if (user.Role == "worker" && Worker(db, user.Id) is { } w)
        {
            worker = new
            {
                shortCode = w.S("short_code"),
                verificationLevel = w.I("verification_level"),
                levelLabel = LevelLabel(w.I("verification_level")),
                recordStatus = RecordStatus(db, user.Id),
                homeVillage = w.S("home_village"),
                regionCode = w.S("region_code"),
                qrUrl = "/api/workers/" + user.Id + "/qrcard",
                cardUrl = "/api/workers/" + user.Id + "/card"
            };
        }
        object? farmer = db.Row("SELECT * FROM farmers WHERE user_id = @id", new { id = user.Id }) is { } f
            ? new { farmName = f.S("farm_name"), regionCode = f.S("region_code") }
            : null;

        return new
        {
            id = user.Id,
            role = user.Role,
            roleTitle = row.S("role_title"),
            name = row.S("full_name"),
            phone = row.S("phone_e164"),
            language = row.S("language_code"),
            faceUrl = hasFace ? Storage.Url(faceId!, 120) : null,
            createdAt = row.S("created_at"),
            worker,
            farmer
        };
    }

    public static string JsonList(IEnumerable<string> values) =>
        JsonSerializer.Serialize(values.Where(v => !string.IsNullOrWhiteSpace(v)).ToList());
}
