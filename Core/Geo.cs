namespace KraaLink;

public static class Geo
{
    public static readonly (string Code, string Name)[] Regions =
    {
        ("OS", "Oshana"), ("OM", "Omusati"), ("OH", "Ohangwena"), ("OT", "Oshikoto"),
        ("KU", "Kunene"), ("KH", "Khomas"), ("ER", "Erongo"), ("HA", "Hardap"),
        ("KA", "//Karas"), ("KE", "Kavango East"), ("KW", "Kavango West"), ("ZE", "Zambezi"),
        ("OD", "Otjozondjupa"), ("OK", "Omaheke")
    };

    public static readonly (string Code, string Name)[] Languages =
    {
        ("en", "English"), ("osh", "Oshiwambo"), ("af", "Afrikaans"),
        ("her", "Otjiherero"), ("pt", "Portuguese")
    };

    public static readonly string[] Species = { "Cattle", "Goats", "Sheep", "Pigs", "Donkeys", "Horses" };

    public static readonly string[] ProduceCategories =
    {
        "Eggs & poultry", "Fresh vegetables", "Fruit", "Grains & maize", "Dairy & milk",
        "Meat & biltong", "Honey & preserves", "Livestock feed", "Other farm produce"
    };

    public static readonly string[] ProduceUnits =
    {
        "each", "dozen", "kg", "crate", "bag (50 kg)", "litre", "bunch", "box", "head"
    };

    public static string RegionName(string? code) =>
        Regions.FirstOrDefault(r => r.Code == code).Name ?? code ?? "";

    public static bool KnownRegion(string? code) => Regions.Any(r => r.Code == code);
    public static bool KnownLanguage(string? code) => Languages.Any(l => l.Code == code);
}
