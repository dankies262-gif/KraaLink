using System.Globalization;
using System.Reflection;
using Microsoft.Data.Sqlite;

namespace KraaLink;

public static class Ts
{
    public const string Format = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    public static string Now() => DateTime.UtcNow.ToString(Format, CultureInfo.InvariantCulture);

    public static string HoursFromNow(double hours) =>
        DateTime.UtcNow.AddHours(hours).ToString(Format, CultureInfo.InvariantCulture);

    public static string DaysFromNow(double days) =>
        DateTime.UtcNow.AddDays(days).ToString(Format, CultureInfo.InvariantCulture);

    public static DateTime? Parse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return DateTime.TryParse(value, CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var dt) ? dt : null;
    }

    public static string DateOnly(string? value) => value is null ? "" : (value.Length >= 10 ? value[..10] : value);

    public static bool IsPast(string? value) => Parse(value) is { } dt && dt < DateTime.UtcNow;

    public static string Human(string? value)
    {
        var dt = Parse(value);
        return dt is null ? "" : dt.Value.ToString("dd MMM yyyy, HH:mm", CultureInfo.InvariantCulture) + " UTC";
    }
}

public sealed class Db : IDisposable
{
    private readonly SqliteConnection _c;
    private SqliteTransaction? _tx;

    public Db(string databasePath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(databasePath)!);
        _c = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            ForeignKeys = true,
            Pooling = true
        }.ToString());
        _c.Open();
        using var pragma = _c.CreateCommand();
        pragma.CommandText = "PRAGMA foreign_keys=ON;";
        pragma.ExecuteNonQuery();
    }

    public void Begin()
    {
        _tx ??= _c.BeginTransaction();
    }

    public void Commit()
    {
        _tx?.Commit();
        _tx?.Dispose();
        _tx = null;
    }

    public int Exec(string sql, object? args = null)
    {
        using var cmd = Command(sql, args);
        return cmd.ExecuteNonQuery();
    }

    public List<Dictionary<string, object?>> Rows(string sql, object? args = null)
    {
        using var cmd = Command(sql, args);
        using var reader = cmd.ExecuteReader();
        var list = new List<Dictionary<string, object?>>();
        while (reader.Read())
        {
            var row = new Dictionary<string, object?>(StringComparer.Ordinal);
            for (var i = 0; i < reader.FieldCount; i++)
                row[reader.GetName(i)] = reader.GetValue(i) is DBNull ? null : reader.GetValue(i);
            list.Add(row);
        }
        return list;
    }

    public Dictionary<string, object?>? Row(string sql, object? args = null) =>
        Rows(sql, args).FirstOrDefault();

    public object? Scalar(string sql, object? args = null)
    {
        using var cmd = Command(sql, args);
        var value = cmd.ExecuteScalar();
        return value is DBNull ? null : value;
    }

    public long Long(string sql, object? args = null) =>
        Convert.ToInt64(Scalar(sql, args) ?? 0L, CultureInfo.InvariantCulture);

    public int Int(string sql, object? args = null) => (int)Long(sql, args);

    public string? Str(string sql, object? args = null)
    {
        var value = Scalar(sql, args);
        return value is null ? null : Convert.ToString(value, CultureInfo.InvariantCulture);
    }

    public double Dbl(string sql, object? args = null) =>
        Convert.ToDouble(Scalar(sql, args) ?? 0d, CultureInfo.InvariantCulture);

    public bool Exists(string sql, object? args = null) => Scalar(sql, args) is not null;

    public bool HasColumn(string table, string column) =>
        Rows("PRAGMA table_info(" + table + ")")
            .Any(r => string.Equals(r.S("name"), column, StringComparison.OrdinalIgnoreCase));

    public void EnsureColumn(string table, string column, string definition)
    {
        if (!HasColumn(table, column))
            Exec($"ALTER TABLE {table} ADD COLUMN {column} {definition}");
    }

    private SqliteCommand Command(string sql, object? args)
    {
        var cmd = _c.CreateCommand();
        cmd.CommandText = sql;
        cmd.Transaction = _tx;
        if (args is not null)
        {
            foreach (var prop in args.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
                cmd.Parameters.AddWithValue("@" + prop.Name, Normalize(prop.GetValue(args)));
        }
        return cmd;
    }

    private static object Normalize(object? value) => value switch
    {
        null => DBNull.Value,
        bool b => b ? 1 : 0,
        DateTime dt => dt.ToUniversalTime().ToString(Ts.Format, CultureInfo.InvariantCulture),
        Guid g => g.ToString(),
        _ => value
    };

    public void Dispose()
    {
        _tx?.Rollback();
        _tx?.Dispose();
        _c.Dispose();
    }
}

public static class RowExt
{
    public static string? S(this Dictionary<string, object?> row, string key) =>
        row.TryGetValue(key, out var v) && v is not null ? Convert.ToString(v, CultureInfo.InvariantCulture) : null;

    public static int I(this Dictionary<string, object?> row, string key) =>
        row.TryGetValue(key, out var v) && v is not null ? Convert.ToInt32(v, CultureInfo.InvariantCulture) : 0;

    public static long L(this Dictionary<string, object?> row, string key) =>
        row.TryGetValue(key, out var v) && v is not null ? Convert.ToInt64(v, CultureInfo.InvariantCulture) : 0L;

    public static double D(this Dictionary<string, object?> row, string key) =>
        row.TryGetValue(key, out var v) && v is not null ? Convert.ToDouble(v, CultureInfo.InvariantCulture) : 0d;

    public static bool B(this Dictionary<string, object?> row, string key) => I(row, key) != 0;

    public static List<string> List(this Dictionary<string, object?> row, string key)
    {
        var raw = row.S(key);
        if (string.IsNullOrWhiteSpace(raw)) return new List<string>();
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(raw);
            return doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Array
                ? doc.RootElement.EnumerateArray().Where(e => e.ValueKind == System.Text.Json.JsonValueKind.String)
                    .Select(e => e.GetString()!).ToList()
                : new List<string>();
        }
        catch
        {
            return new List<string>();
        }
    }
}

public static class Ids
{
    public static string New(string prefix) => prefix + "_" + global::System.Guid.NewGuid().ToString("N")[..20];
}

public static class Codes
{
    // No look-alike characters (FR-REG-05)
    private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static readonly Random Rng = new();

    public static string ShortCode()
    {
        lock (Rng)
            return new string(Enumerable.Range(0, 6).Select(_ => Alphabet[Rng.Next(Alphabet.Length)]).ToArray());
    }

    public static string CaseRef() => "KL-FND-" + ShortCode()[..4];

    public static string Otp() => Random.Shared.Next(100000, 999999).ToString();

    public static string NormalizeMark(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return "";
        return new string(input.ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
    }
}
