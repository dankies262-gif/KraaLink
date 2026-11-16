namespace KraaLink;

public sealed class LifecycleService : BackgroundService
{
    private readonly string _dbPath;
    private readonly ILogger<LifecycleService> _log;

    public LifecycleService(string dbPath, ILogger<LifecycleService> log)
    {
        _dbPath = dbPath;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var db = new Db(_dbPath);
                Tick(db);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Lifecycle tick failed");
            }
            await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken);
        }
    }

    private static void Tick(Db db)
    {
        var now = DateTime.UtcNow;

        // FR-HC-08: consents past expiry become expired.
        foreach (var consent in db.Rows("SELECT id, expires_at FROM consents WHERE status = 'granted'"))
        {
            if (!Ts.IsPast(consent.S("expires_at"))) continue;
            db.Exec("UPDATE consents SET status = 'expired' WHERE id = @id", new { id = consent.S("id") });
            Audit.Log(db, null, "consent.expired", "consent", consent.S("id"), "consents", actorRole: "system");
        }

        // FR-EMP-03: neutral 'No check-out recorded' after the configured days. Never an accusation.
        var noCheckoutDays = Settings.Int(db, "no_checkout_days", 7);
        foreach (var emp in db.Rows(@"SELECT * FROM employments
                                      WHERE status IN ('open','disputed') AND left_reported_at IS NOT NULL AND no_checkout_at IS NULL"))
        {
            var reported = Ts.Parse(emp.S("left_reported_at"));
            if (reported is null || (now - reported.Value).TotalDays < noCheckoutDays) continue;
            db.Exec("UPDATE employments SET no_checkout_at = @now WHERE id = @id",
                new { now = Ts.Now(), id = emp.S("id") });
            db.Exec(@"INSERT INTO employment_events (id, employment_id, type, actor_id, payload, created_at)
                      VALUES (@id,@e,'no_checkout_recorded',NULL,@p,@c)",
                new
                {
                    id = Ids.New("evt"), e = emp.S("id"),
                    p = "{\"label\":\"No check-out recorded\",\"neutral\":true}", c = Ts.Now()
                });
            Notify.Send(db, emp.S("worker_id")!, "No check-out recorded on a job",
                "A farmer reported that the job ended but no check-out was recorded. This is a neutral note, not an accusation. " +
                "Open KraaLink to add your side or ask for a check-out. No negative label has been applied.",
                "en", new { employmentId = emp.S("id"), action = "respond_no_checkout" });
            Audit.Log(db, null, "employment.no_checkout_recorded", "employment", emp.S("id"), "employments", actorRole: "system");
        }

        // FR-INC-05: an under-review incident with no reviewer action is removed from view after 30 days.
        var autoRemoveDays = Settings.Int(db, "incident_auto_remove_days", 30);
        foreach (var inc in db.Rows("SELECT id, created_at FROM incidents WHERE status IN ('under_review','worker_responded')"))
        {
            var created = Ts.Parse(inc.S("created_at"));
            if (created is null || (now - created.Value).TotalDays < autoRemoveDays) continue;
            db.Exec("UPDATE incidents SET status = 'expired' WHERE id = @id", new { id = inc.S("id") });
            Audit.Log(db, null, "incident.auto_expired", "incident", inc.S("id"), "incidents", actorRole: "system");
        }

        // FR-BRD-10: unmatched found reports stay open for 30 days and are re-checked on every tick.
        var noMatchDays = Settings.Int(db, "found_report_no_match_days", 30);
        foreach (var report in db.Rows("SELECT id, finder_id, case_ref, expires_at FROM found_reports WHERE status = 'open'"))
        {
            if (!Ts.IsPast(report.S("expires_at"))) continue;
            db.Exec("UPDATE found_reports SET status = 'expired' WHERE id = @id", new { id = report.S("id") });
            if (report.S("finder_id") is { } finder)
                Notify.Send(db, finder, "Found report " + report.S("case_ref") + " closed",
                    "No registered brand or tag matched this report within the open window. The report is now closed. " +
                    "If the animals are still with you, contact the police or State Veterinary office.", "en",
                    new { caseRef = report.S("case_ref") });
            Audit.Log(db, null, "found_report.expired", "found_report", report.S("id"), "found_reports", actorRole: "system");
        }
        Matching.RecheckOpenReports(db);

        // FR-BRD-25: reviewer reminder when an alerted owner has not replied for 7 days.
        var ownerReplyDays = Settings.Int(db, "found_report_owner_response_days", 7);
        foreach (var report in db.Rows("SELECT * FROM found_reports WHERE status = 'match_found' AND matched_owner_id IS NOT NULL"))
        {
            var created = Ts.Parse(report.S("created_at"));
            if (created is null || (now - created.Value).TotalDays < ownerReplyDays) continue;
            var caseRef = report.S("case_ref")!;
            var already = db.Exists(
                "SELECT 1 FROM notifications WHERE user_id = 'usr_reviewer' AND title LIKE @t",
                new { t = "%" + caseRef + "%" });
            if (already) continue;
            Notify.Send(db, "usr_reviewer", "Owner reply overdue — " + caseRef,
                "The alerted owner has not submitted a claim 7 days after the match. Follow up before the case expires.",
                "en", new { caseRef, foundReportId = report.S("id") }, "system");
        }

        // Vaccination reminders (FR-VET-05).
        foreach (var schedule in db.Rows(@"SELECT v.*, h.farmer_id FROM vaccination_schedules v
                                           JOIN herds h ON h.id = v.herd_id
                                           WHERE v.reminder_sent_at IS NULL")
                     .Where(r => string.CompareOrdinal(r.S("next_due"), now.ToString("yyyy-MM-dd")) <= 0))
        {
            db.Exec("UPDATE vaccination_schedules SET reminder_sent_at = @now WHERE id = @id",
                new { now = Ts.Now(), id = schedule.S("id") });
            Notify.Send(db, schedule.S("farmer_id")!, "Vaccination due: " + schedule.S("vaccine"),
                $"A vaccination in your herd calendar is due on {schedule.S("next_due")}. Book the vet or animal health technician in time.",
                "en", new { scheduleId = schedule.S("id"), action = "vaccinations" });
        }
    }
}
