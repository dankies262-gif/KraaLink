namespace KraaLink;

public static class FileApi
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/files/{id}", (HttpContext ctx, Db db, string id) =>
        {
            var user = Auth.From(ctx);
            var file = Storage.ById(db, id);
            var signed = Storage.VerifyUrl(id, ctx.Q("exp"), ctx.Q("sig"));
            if (!signed && !Storage.CanAccess(user, file))
                throw user is null ? ApiException.Unauthorized() : ApiException.Forbidden("This file is private.");

            var path = Path.GetFullPath(file.S("path")!);
            var root = Path.GetFullPath(Storage.Root);
            if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
                throw ApiException.NotFound("File not available.");
            if (user is not null && user.IsStaff && Convert.ToInt64(file["is_public"]) == 0 && Convert.ToString(file["owner_id"]) != user.Id)
            {
                Audit.Log(db, ctx, "file.view", "file", id, "files", details: "Staff viewed " + file.S("kind"));
            }

            var download = ctx.Q("download") == "1";
            var name = file.S("kind") + "-" + id[^6..] + (file.S("mime") == "application/pdf" ? ".pdf" : "");
            return Results.File(path, file.S("mime")!, download ? name : null, enableRangeProcessing: true);
        });
    }
}
