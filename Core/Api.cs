using System.Text.Json;

namespace KraaLink;

public sealed class ApiException : Exception
{
    public int Status { get; }
    public string Title { get; }

    public ApiException(int status, string title, string detail) : base(detail)
    {
        Status = status;
        Title = title;
    }

    public static ApiException Bad(string detail) => new(400, "Invalid request", detail);
    public static ApiException Unauthorized(string detail = "Sign in to continue.") => new(401, "Not signed in", detail);
    public static ApiException Forbidden(string detail = "You do not have access to this action.") => new(403, "Not allowed", detail);
    public static ApiException NotFound(string detail = "The record was not found.") => new(404, "Not found", detail);
    public static ApiException Conflict(string detail) => new(409, "Conflict", detail);
}

public static class Api
{
    public static async Task<JsonElement> BodyAsync(HttpContext ctx)
    {
        if (!ctx.Request.HasJsonContentType())
            throw ApiException.Bad("Send a JSON body.");
        using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
        return doc.RootElement.Clone();
    }

    public static string Str(this JsonElement e, string name, bool required = true, string? fallback = null)
    {
        if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String)
        {
            var v = p.GetString();
            if (!string.IsNullOrWhiteSpace(v)) return v.Trim();
        }
        if (required) throw ApiException.Bad($"'{name}' is required.");
        return fallback ?? "";
    }

    public static string? StrOrNull(this JsonElement e, string name)
    {
        if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String)
        {
            var v = p.GetString();
            return string.IsNullOrWhiteSpace(v) ? null : v.Trim();
        }
        return null;
    }

    public static int Int(this JsonElement e, string name, int fallback = 0)
    {
        if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var p))
        {
            if (p.ValueKind == JsonValueKind.Number && p.TryGetInt32(out var i)) return i;
            if (p.ValueKind == JsonValueKind.String && int.TryParse(p.GetString(), out var s)) return s;
        }
        return fallback;
    }

    public static double Num(this JsonElement e, string name, double fallback = 0)
    {
        if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var p))
        {
            if (p.ValueKind == JsonValueKind.Number && p.TryGetDouble(out var d)) return d;
            if (p.ValueKind == JsonValueKind.String && double.TryParse(p.GetString(), out var s)) return s;
        }
        return fallback;
    }

    public static bool Bool(this JsonElement e, string name, bool fallback = false)
    {
        if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var p))
        {
            if (p.ValueKind is JsonValueKind.True or JsonValueKind.False) return p.GetBoolean();
            if (p.ValueKind == JsonValueKind.Number) return p.GetInt32() != 0;
        }
        return fallback;
    }

    public static JsonElement? Obj(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Object
            ? p
            : null;

    public static List<JsonElement> Arr(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Array
            ? p.EnumerateArray().Select(x => x.Clone()).ToList()
            : new List<JsonElement>();

    public static List<string> StrList(this JsonElement e, string name) =>
        Arr(e, name).Where(x => x.ValueKind == JsonValueKind.String)
            .Select(x => x.GetString()!.Trim())
            .Where(x => x.Length > 0)
            .ToList();

    public static string? Q(this HttpContext ctx, string name) =>
        ctx.Request.Query.TryGetValue(name, out var v) && !string.IsNullOrWhiteSpace(v)
            ? v.ToString().Trim()
            : null;

    public static string Q(this HttpContext ctx, string name, string fallback) => Q(ctx, name) ?? fallback;

    public static IResult Json(object? value, int status = 200) => Results.Json(value, statusCode: status);

    public static IResult NoContent() => Results.NoContent();

    public static string RequestIp(this HttpContext ctx) =>
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    public static IEnumerable<Dictionary<string, object?>> Page(this HttpContext ctx, IEnumerable<Dictionary<string, object?>> rows)
    {
        var take = int.TryParse(ctx.Q("take"), out var t) ? Math.Clamp(t, 1, 200) : 100;
        var skip = int.TryParse(ctx.Q("skip"), out var s) ? Math.Max(s, 0) : 0;
        return rows.Skip(skip).Take(take);
    }
}
