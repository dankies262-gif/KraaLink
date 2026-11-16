using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace KraaLink;

public sealed record UserCtx(string Id, string Role, string Name, string Phone, string Lang)
{
    public bool IsStaff => Role is "reviewer" or "admin" or "agent" or "verifier";
    public bool IsReviewer => Role is "reviewer" or "admin";
}

public static class Auth
{
    private static string _key = "kraalink-demo-hs256-key-change-in-production-2026";

    public static void Configure(string? key)
    {
        if (!string.IsNullOrWhiteSpace(key)) _key = key;
    }

    private static string B64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] FromB64Url(string value)
    {
        var s = value.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s.PadRight(s.Length + (4 - s.Length % 4) % 4, '='));
    }

    private static string SignPart(string data)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_key));
        return B64Url(hmac.ComputeHash(Encoding.UTF8.GetBytes(data)));
    }

    private static string Create(Dictionary<string, object?> payload)
    {
        var header = B64Url(Encoding.UTF8.GetBytes("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"));
        var body = B64Url(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));
        var data = header + "." + body;
        return data + "." + SignPart(data);
    }

    private static Dictionary<string, JsonElement>? Read(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var parts = token.Split('.');
        if (parts.Length != 3) return null;
        var expected = SignPart(parts[0] + "." + parts[1]);
        if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(parts[2])))
            return null;
        try
        {
            using var doc = JsonDocument.Parse(FromB64Url(parts[1]));
            var dict = doc.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone());
            if (dict.TryGetValue("exp", out var exp) && exp.GetInt64() < DateTimeOffset.UtcNow.ToUnixTimeSeconds())
                return null;
            return dict;
        }
        catch
        {
            return null;
        }
    }

    public static string Token(UserCtx user, int hours = 12) => Create(new()
    {
        ["sub"] = user.Id,
        ["role"] = user.Role,
        ["name"] = user.Name,
        ["phone"] = user.Phone,
        ["lang"] = user.Lang,
        ["iat"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
        ["exp"] = DateTimeOffset.UtcNow.AddHours(hours).ToUnixTimeSeconds()
    });

    public static string SignupToken(string phone) => Create(new()
    {
        ["sub"] = phone,
        ["role"] = "signup",
        ["iat"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
        ["exp"] = DateTimeOffset.UtcNow.AddMinutes(30).ToUnixTimeSeconds()
    });

    public static string? ReadSignupPhone(string? token)
    {
        var payload = Read(token);
        return payload is not null
               && payload.TryGetValue("role", out var role) && role.GetString() == "signup"
               && payload.TryGetValue("sub", out var sub)
            ? sub.GetString()
            : null;
    }

    public static UserCtx? From(HttpContext ctx) =>
        ctx.Items.TryGetValue("user", out var value) ? value as UserCtx : null;

    public static UserCtx Require(HttpContext ctx, params string[] roles)
    {
        var user = From(ctx) ?? throw ApiException.Unauthorized();
        if (roles.Length > 0 && !roles.Contains(user.Role))
            throw ApiException.Forbidden("This action is for: " + string.Join(", ", roles) + ".");
        return user;
    }

    public static void UseToken(HttpContext ctx)
    {
        var header = ctx.Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return;
        var payload = Read(header[7..].Trim());
        if (payload is null) return;
        if (!payload.TryGetValue("sub", out var sub) || !payload.TryGetValue("role", out var role)) return;
        var roleName = role.GetString() ?? "";
        if (roleName == "signup") return;
        ctx.Items["user"] = new UserCtx(
            sub.GetString() ?? "",
            roleName,
            payload.TryGetValue("name", out var n) ? n.GetString() ?? "" : "",
            payload.TryGetValue("phone", out var p) ? p.GetString() ?? "" : "",
            payload.TryGetValue("lang", out var l) ? l.GetString() ?? "en" : "en");
    }
}
