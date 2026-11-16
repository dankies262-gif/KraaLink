using System.Security.Cryptography;
using System.Text;

namespace KraaLink;

public static class Crypto
{
    private static byte[] _key = SHA256.HashData(Encoding.UTF8.GetBytes("kraalink-demo-field-encryption-key"));

    public static void Configure(string? configuredKey)
    {
        if (string.IsNullOrWhiteSpace(configuredKey)) return;
        _key = SHA256.HashData(Encoding.UTF8.GetBytes(configuredKey));
    }

    // Field-level encryption for ID numbers (FR-REG-08). AES-GCM, versioned envelope.
    public static string Encrypt(string plain)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plainBytes = Encoding.UTF8.GetBytes(plain);
        var cipher = new byte[plainBytes.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(_key, 16);
        aes.Encrypt(nonce, plainBytes, cipher, tag);
        return "v1:" + Convert.ToBase64String(nonce.Concat(tag).Concat(cipher).ToArray());
    }

    public static string? Decrypt(string? envelope)
    {
        if (string.IsNullOrWhiteSpace(envelope) || !envelope.StartsWith("v1:")) return null;
        try
        {
            var all = Convert.FromBase64String(envelope[3..]);
            var nonce = all[..12];
            var tag = all[12..28];
            var cipher = all[28..];
            var plain = new byte[cipher.Length];
            using var aes = new AesGcm(_key, 16);
            aes.Decrypt(nonce, cipher, tag, plain);
            return Encoding.UTF8.GetString(plain);
        }
        catch
        {
            return null;
        }
    }
}

public static class Storage
{
    public static string Root { get; set; } = "";
    private const long MaxBytes = 8 * 1024 * 1024;
    private static string _signKey = "kraalink-demo-file-signing-key";

    public static void ConfigureSigning(string? key)
    {
        if (!string.IsNullOrWhiteSpace(key)) _signKey = key;
    }

    private static string Sign(string value)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_signKey));
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(value)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    // Short-lived signed URL (SRS NFR-05). Files are never served from a public folder.
    public static string Url(string fileId, int minutes = 30)
    {
        var exp = DateTimeOffset.UtcNow.AddMinutes(minutes).ToUnixTimeSeconds();
        return $"/api/files/{fileId}?exp={exp}&sig={Sign(fileId + "|" + exp)}";
    }

    public static bool VerifyUrl(string fileId, string? exp, string? sig)
    {
        if (string.IsNullOrWhiteSpace(exp) || string.IsNullOrWhiteSpace(sig)) return false;
        if (!long.TryParse(exp, out var expUnix) || expUnix < DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return false;
        var expected = Sign(fileId + "|" + exp);
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(sig));
    }

    private static readonly Dictionary<string, string> MimeExt = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/jpeg"] = ".jpg",
        ["image/png"] = ".png",
        ["image/webp"] = ".webp",
        ["application/pdf"] = ".pdf"
    };

    public static Dictionary<string, object?> SaveDataUrl(
        Db db, string? dataUrl, string kind, string ownerId, bool isPublic = false)
    {
        if (string.IsNullOrWhiteSpace(dataUrl))
            throw ApiException.Bad("A file is required.");
        var comma = dataUrl.IndexOf(',');
        if (comma < 0 || !dataUrl.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            throw ApiException.Bad("The uploaded file is not a valid data URL.");
        var header = dataUrl[5..comma];
        if (!header.EndsWith(";base64", StringComparison.OrdinalIgnoreCase))
            throw ApiException.Bad("The uploaded file must be base64 encoded.");
        var mime = header[..header.IndexOf(';')].ToLowerInvariant();
        if (!MimeExt.TryGetValue(mime, out var ext))
            throw ApiException.Bad("Only JPEG, PNG, WebP images and PDF documents are accepted.");

        byte[] bytes;
        try { bytes = Convert.FromBase64String(dataUrl[(comma + 1)..]); }
        catch { throw ApiException.Bad("The uploaded file is not valid base64."); }
        if (bytes.Length == 0) throw ApiException.Bad("The uploaded file is empty.");
        if (bytes.Length > MaxBytes) throw ApiException.Bad("The file is larger than 8 MB.");

        return SaveBytes(db, bytes, kind, ownerId, mime, ext, isPublic);
    }

    public static Dictionary<string, object?> SaveBytes(
        Db db, byte[] bytes, string kind, string ownerId, string mime, string ext, bool isPublic = false)
    {
        var id = Ids.New("file");
        var folder = Path.Combine(Root, kind);
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, id + ext);
        File.WriteAllBytes(path, bytes);
        var createdAt = Ts.Now();
        db.Exec(
            @"INSERT INTO files (id, kind, owner_id, path, mime, bytes, is_public, created_at)
              VALUES (@id, @kind, @owner_id, @path, @mime, @bytes, @is_public, @created_at)",
            new
            {
                id, kind, owner_id = ownerId, path, mime, bytes = bytes.Length,
                is_public = isPublic ? 1 : 0, created_at = createdAt
            });
        return new Dictionary<string, object?>
        {
            ["id"] = id, ["kind"] = kind, ["mime"] = mime, ["bytes"] = bytes.Length, ["created_at"] = createdAt
        };
    }

    public static Dictionary<string, object?> ById(Db db, string id) =>
        db.Row("SELECT * FROM files WHERE id = @id", new { id }) ?? throw ApiException.NotFound("File not found.");

    public static bool CanAccess(UserCtx? user, Dictionary<string, object?> file)
    {
        if (Convert.ToInt64(file["is_public"]) == 1) return true;
        if (user is null) return false;
        if (Convert.ToString(file["owner_id"]) == user.Id) return true;
        if (user.IsReviewer) return true;
        var kind = Convert.ToString(file["kind"]);
        if (kind is "face" or "id_doc" && user.Role is "agent" or "verifier") return true;
        return false;
    }

    public static string FolderFor(string kind) => Path.Combine(Root, kind);
}
