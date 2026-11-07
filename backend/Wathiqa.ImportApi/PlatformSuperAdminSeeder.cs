using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

/// <summary>One-shot, operator-only CLI. No web endpoint creates operators.</summary>
public static class PlatformSuperAdminSeeder
{
    public static async Task RunAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ImportDb>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<PlatformOperator>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        var email = (Environment.GetEnvironmentVariable("WATHIQA_SUPERADMIN_EMAIL") ?? "")
            .Trim().ToLowerInvariant();
        var password = Environment.GetEnvironmentVariable("WATHIQA_SUPERADMIN_PASSWORD") ?? "";
        var name = (Environment.GetEnvironmentVariable("WATHIQA_SUPERADMIN_DISPLAY_NAME") ?? "SuperAdmin").Trim();
        if (email.Length is < 5 or > 254 || !new EmailAddressAttribute().IsValid(email))
            throw new InvalidOperationException("WATHIQA_SUPERADMIN_EMAIL must contain a valid email address.");
        if (password.Length is < 16 or > 256 ||
            !password.Any(char.IsUpper) || !password.Any(char.IsLower) ||
            !password.Any(char.IsDigit) || !password.Any(c => !char.IsLetterOrDigit(c)))
            throw new InvalidOperationException("WATHIQA_SUPERADMIN_PASSWORD must be 16-256 chars with mixed character classes.");
        if (name.Length is < 2 or > 160)
            throw new InvalidOperationException("Invalid SuperAdmin display name.");

        await db.Database.MigrateAsync();
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(577208406217304624)");
        // A freshly initialized database may not have any merchant roles yet.
        // Platform identity remains distinct even though the onboarding invite
        // creates a merchant Admin after it is accepted.
        foreach (var merchantRole in new[] { "Admin", "Staff" })
            if (!await roles.RoleExistsAsync(merchantRole))
            {
                var added = await roles.CreateAsync(new IdentityRole<Guid>(merchantRole));
                if (!added.Succeeded) throw new InvalidOperationException("Merchant role provisioning failed.");
            }
        var existing = await db.PlatformOperators.SingleOrDefaultAsync(p => p.Email == email);
        if (existing is not null)
        {
            if (existing.Role != PlatformSecurity.Role || !existing.IsActive)
                throw new InvalidOperationException("Existing platform operator is not an active SuperAdmin. Refusing silent reset.");
            Console.WriteLine("WATHIQA_SUPERADMIN_EXISTS_UNCHANGED=true");
            await tx.CommitAsync();
            return;
        }
        if (await db.Users.AnyAsync(u => u.NormalizedEmail == email.ToUpperInvariant()))
            throw new InvalidOperationException("SuperAdmin email must not belong to a tenant user.");
        // One Platform Owner only until an explicitly reviewed recovery and
        // operator-provisioning workflow exists. No public registration.
        if (await db.PlatformOperators.AnyAsync())
            throw new InvalidOperationException("A platform operator already exists; manual reviewed recovery required.");
        var actor = new PlatformOperator { Email = email, DisplayName = name };
        actor.PasswordHash = hasher.HashPassword(actor, password);
        db.PlatformOperators.Add(actor);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        Console.WriteLine("WATHIQA_SUPERADMIN_CREATED=true (password never logged)");
    }
}
