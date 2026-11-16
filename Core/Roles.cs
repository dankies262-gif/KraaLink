namespace KraaLink;

/// <summary>
/// Roles a person may choose at sign-up. Each option maps to one of the
/// permission roles the API understands, while the chosen title is kept so
/// people can describe their work in their own words.
/// </summary>
public static class Roles
{
    public sealed record Option(string Code, string Label, string BaseRole, string Description, bool InviteOnly = false);

    public static readonly Option[] Signup =
    {
        new("worker", "Farm worker", "worker",
            "Build a WorkerLink Passport with a face photo and ID, then decide who may see it."),
        new("farmer", "Farmer / livestock owner", "farmer",
            "Hire with consent, register brands and ear tags, sell livestock and use VetBot."),
        new("seller", "Farm produce seller", "farmer",
            "Sell eggs, vegetables, maize, milk and other farm produce to buyers across Namibia."),
        new("buyer", "Buyer / trader", "finder",
            "Browse livestock and farm produce, contact sellers and report animals you find."),
        new("finder", "Community member", "finder",
            "Report found livestock anonymously and help reunite animals with their owners."),
        new("transporter", "Transporter", "finder",
            "Move livestock and produce between farms, auctions and markets."),
        new("vet", "Veterinary professional", "finder",
            "Use the vet directory and keep an eye on notifiable disease guidance."),
        new("agent", "Field agent", "agent",
            "Register workers in person. Staff accounts are created by an administrator.", true),
        new("verifier", "Community verifier", "verifier",
            "Confirm a worker's identity in the community. Invite only.", true),
        new("reviewer", "Reviewer", "reviewer",
            "Review passports, claims and listings. Invite only.", true),
        new("admin", "Administrator", "admin",
            "Run the platform and its rules. Invite only.", true)
    };

    public static Option? Find(string? code) =>
        Signup.FirstOrDefault(o => string.Equals(o.Code, code, StringComparison.OrdinalIgnoreCase));

    public static bool IsInviteOnlyBase(string baseRole) => baseRole is "agent" or "verifier" or "reviewer" or "admin";
}
