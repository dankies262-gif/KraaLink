using System.Text.Json;

namespace KraaLink;

public static class Audit
{
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    public static void Log(
        Db db,
        HttpContext? ctx,
        string action,
        string objectType,
        string? recordId = null,
        string? table = null,
        object? oldData = null,
        object? newData = null,
        string? changedFields = null,
        string? details = null,
        string actorId = "",
        string actorRole = "")
    {
        var user = ctx is null ? null : Auth.From(ctx);
        db.Exec(
            @"INSERT INTO audit_log (id, created_at, actor_id, actor_role, action, object_type, table_name,
                    record_id, old_data, new_data, changed_fields, details, request_id, client_ip, source)
              VALUES (@id, @created_at, @actor_id, @actor_role, @action, @object_type, @table_name,
                    @record_id, @old_data, @new_data, @changed_fields, @details, @request_id, @client_ip, 'api')",
            new
            {
                id = Ids.New("aud"),
                created_at = Ts.Now(),
                actor_id = user?.Id ?? (string.IsNullOrEmpty(actorId) ? null : actorId),
                actor_role = user?.Role ?? (string.IsNullOrEmpty(actorRole) ? "public" : actorRole),
                action,
                object_type = objectType,
                table_name = table,
                record_id = recordId,
                old_data = oldData is null ? null : JsonSerializer.Serialize(oldData, JsonOpts),
                new_data = newData is null ? null : JsonSerializer.Serialize(newData, JsonOpts),
                changed_fields = changedFields,
                details,
                request_id = ctx?.TraceIdentifier,
                client_ip = ctx?.RequestIp()
            });
    }

    // Business access log for passport views (FR-HC-06 / FR-EMP-06)
    public static void Access(
        Db db, HttpContext ctx, UserCtx viewer, string workerId, string? consentId,
        string purpose, string fields, string? targetKind = "worker")
    {
        db.Exec(
            @"INSERT INTO access_log (id, viewer_id, viewer_role, worker_id, consent_id, purpose,
                    fields_viewed, client_ip, request_id, created_at)
              VALUES (@id, @viewer_id, @viewer_role, @worker_id, @consent_id, @purpose,
                    @fields_viewed, @client_ip, @request_id, @created_at)",
            new
            {
                id = Ids.New("acc"),
                viewer_id = viewer.Id,
                viewer_role = viewer.Role,
                worker_id = workerId,
                consent_id = consentId,
                purpose,
                fields_viewed = fields,
                client_ip = ctx.RequestIp(),
                request_id = ctx.TraceIdentifier,
                created_at = Ts.Now()
            });
    }
}

public static class Settings
{
    public static string Str(Db db, string key, string fallback) =>
        db.Str("SELECT setting_value FROM app_settings WHERE setting_key = @k", new { k = key }) ?? fallback;

    public static int Int(Db db, string key, int fallback) =>
        int.TryParse(Str(db, key, fallback.ToString()), out var value) ? value : fallback;
}

public static class Notify
{
    // In production this adapter calls the WhatsApp Cloud API. In the demo every message
    // is written to the in-app WhatsApp simulator so the flow can be shown end to end.
    public static void Send(Db db, string userId, string title, string body,
        string lang = "en", object? meta = null, string channel = "whatsapp")
    {
        db.Exec(
            @"INSERT INTO notifications (id, user_id, channel, direction, language_code, title, body, meta_json, created_at)
              VALUES (@id, @user_id, @channel, 'out', @language_code, @title, @body, @meta_json, @created_at)",
            new
            {
                id = Ids.New("msg"),
                user_id = userId,
                channel,
                language_code = lang,
                title,
                body,
                meta_json = meta is null ? null : JsonSerializer.Serialize(meta),
                created_at = Ts.Now()
            });
    }

    public static void Staff(Db db, string role, string title, string body, object? meta = null)
    {
        foreach (var user in db.Rows("SELECT id, language_code FROM users WHERE role = @r", new { r = role }))
            Send(db, (string)user["id"]!, title, body, (string?)user["language_code"] ?? "en", meta, "system");
    }
}
