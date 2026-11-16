using KraaLink;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 12 * 1024 * 1024);

var contentRoot = builder.Environment.ContentRootPath;
var dataDir = Environment.GetEnvironmentVariable("KRAALINK_DATA")
              ?? Path.Combine(contentRoot, "App_Data");
Directory.CreateDirectory(dataDir);
var dbPath = Environment.GetEnvironmentVariable("KRAALINK_DB")
             ?? Path.Combine(dataDir, "kraalink.db");
var storageRoot = Environment.GetEnvironmentVariable("KRAALINK_STORAGE")
                  ?? Path.Combine(contentRoot, "storage");
Directory.CreateDirectory(storageRoot);
Storage.Root = storageRoot;

var signingKey = Environment.GetEnvironmentVariable("KRAALINK_JWT_KEY")
                 ?? builder.Configuration["KraaLink:JwtKey"];
Auth.Configure(signingKey);
Storage.ConfigureSigning(signingKey);
Crypto.Configure(Environment.GetEnvironmentVariable("KRAALINK_ENC_KEY")
                 ?? builder.Configuration["KraaLink:EncKey"]);

var demoMode = !string.Equals(Environment.GetEnvironmentVariable("KRAALINK_DEMO"), "false",
    StringComparison.OrdinalIgnoreCase);

builder.Services.AddSingleton(new AppInfo(dbPath, demoMode));
builder.Services.AddScoped(_ => new Db(dbPath));
builder.Services.AddHostedService(sp => new LifecycleService(dbPath, sp.GetRequiredService<ILogger<LifecycleService>>()));

var app = builder.Build();

Migrations.Apply(dbPath, contentRoot);
using (var seedDb = new Db(dbPath))
{
    Seed.Ensure(seedDb, contentRoot);
}

app.Use(async (ctx, next) =>
{
    try
    {
        Auth.UseToken(ctx);
        await next();
    }
    catch (ApiException ex)
    {
        if (ctx.Response.HasStarted) return;
        ctx.Response.Clear();
        ctx.Response.StatusCode = ex.Status;
        await ctx.Response.WriteAsJsonAsync(new
        {
            title = ex.Title,
            status = ex.Status,
            detail = ex.Message,
            traceId = ctx.TraceIdentifier
        });
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Unhandled request error");
        if (ctx.Response.HasStarted) return;
        ctx.Response.Clear();
        ctx.Response.StatusCode = 500;
        await ctx.Response.WriteAsJsonAsync(new
        {
            title = "Something went wrong",
            status = 500,
            detail = demoMode ? ex.Message : "The request could not be completed.",
            traceId = ctx.TraceIdentifier
        });
    }
});

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Json(new { status = "ok", time = Ts.Now() }));

app.MapGet("/api/config", (HttpContext ctx) =>
{
    var db = ctx.RequestServices.GetRequiredService<Db>();
    return Results.Json(new
    {
        demoMode,
        appName = "KraaLink",
        languages = Geo.Languages.Select(l => new { code = l.Code, name = l.Name }),
        regions = Geo.Regions.Select(r => new { code = r.Code, name = r.Name }),
        species = Geo.Species,
        produceCategories = Geo.ProduceCategories,
        produceUnits = Geo.ProduceUnits,
        signupRoles = Roles.Signup.Select(r => new
        {
            code = r.Code, label = r.Label, baseRole = r.BaseRole,
            description = r.Description, inviteOnly = r.InviteOnly
        }),
        settings = db.Rows("SELECT setting_key, setting_value, description FROM app_settings ORDER BY setting_key")
            .ToDictionary(r => r.S("setting_key")!, r => new { value = r.S("setting_value"), description = r.S("description") })
    });
});

AuthApi.Map(app);
MeApi.Map(app);
FileApi.Map(app);
WorkerApi.Map(app);
HiringApi.Map(app);
EmploymentApi.Map(app);
IncidentApi.Map(app);
MarketplaceApi.Map(app);
VetApi.Map(app);
BrandApi.Map(app);
AdminApi.Map(app);

app.MapFallback("/api/{**path}", () => Results.Json(new
{
    title = "Not found",
    status = 404,
    detail = "The requested API endpoint does not exist."
}, statusCode: 404));

app.Run();

public sealed record AppInfo(string DbPath, bool DemoMode);

public static class Migrations
{
    public static void Apply(string dbPath, string contentRoot)
    {
        var dir = Path.Combine(contentRoot, "db", "migrations");
        if (!Directory.Exists(dir))
            throw new DirectoryNotFoundException("Migration folder not found: " + dir);

        using var db = new Db(dbPath);
        foreach (var file in Directory.GetFiles(dir, "*.sql").OrderBy(f => f, StringComparer.Ordinal))
        {
            var sql = File.ReadAllText(file);
            db.Exec(sql);
        }

        // Columns added after the first schema release. SQLite has no
        // "ADD COLUMN IF NOT EXISTS", so these run only when missing.
        db.EnsureColumn("users", "role_title", "TEXT");
        db.EnsureColumn("listings", "listing_kind", "TEXT NOT NULL DEFAULT 'livestock'");
        db.EnsureColumn("listings", "category", "TEXT");
        db.EnsureColumn("listings", "unit", "TEXT");
    }
}
