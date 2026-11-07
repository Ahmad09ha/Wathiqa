using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Wathiqa.ImportApi;

/// <summary>
/// Opt-in idempotent two-tenant provisioning. Safe to re-run against a
/// migrated database, never resets passwords or extends a trial.
/// No secrets, default credentials, or public tenant registration endpoint.
/// </summary>
public static class AccessAccountSeeder
{
    private const long AdvisoryLockKey = 577208406217304622L;

    private sealed record SeedTenant(
        string Slug, string Name, string Email, string Password,
        string DisplayName, bool IsTrial);

    public static async Task RunAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var provider = scope.ServiceProvider;
        var db = provider.GetRequiredService<ImportDb>();
        var users = provider.GetRequiredService<UserManager<ImportUser>>();
        var roles = provider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        var config = provider.GetRequiredService<IConfiguration>();
        var connection = config.GetConnectionString("ImportDatabase");
        if (string.IsNullOrWhiteSpace(connection))
            throw new InvalidOperationException("Missing ImportDatabase connection.");
        var database = new NpgsqlConnectionStringBuilder(connection).Database;
        if (string.IsNullOrEmpty(database) || database is "hussam_templates" or "wathiqa_docs")
            throw new InvalidOperationException("Refusing access seed on the legacy editor database.");

        // Deployment requires its own credentials; no fallback passwords or
        // production reuse of the local development demo account passwords.
        var accounts = new[]
        {
            new SeedTenant(
                "trial-access", "وثيقة — مساحة تجريبية", Read("WATHIQA_TRIAL_EMAIL"),
                Read("WATHIQA_TRIAL_PASSWORD"), "Trial Admin", true),
            new SeedTenant(
                "unlimited-access", "وثيقة — مساحة دائمة", Read("WATHIQA_UNLIMITED_EMAIL"),
                Read("WATHIQA_UNLIMITED_PASSWORD"), "Unlimited Admin", false)
        };
        if (accounts[0].Email.Equals(accounts[1].Email, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Seed accounts must have distinct emails.");
        if (accounts[0].Password == accounts[1].Password)
            throw new InvalidOperationException("Seed accounts must use different strong passwords.");

        await db.Database.MigrateAsync();
        await using var transaction = await db.Database.BeginTransactionAsync();

        // Prevent two deploying instances from creating the same tenants at
        // once. Normal startup does NOT run this seeder unless opted in.
        await db.Database.ExecuteSqlRawAsync($"SELECT pg_advisory_xact_lock({AdvisoryLockKey})");
        if (!await roles.RoleExistsAsync("Admin"))
        {
            var result = await roles.CreateAsync(new IdentityRole<Guid>("Admin"));
            Ensure(result, "Admin role");
        }
        if (!await roles.RoleExistsAsync("Staff"))
        {
            var result = await roles.CreateAsync(new IdentityRole<Guid>("Staff"));
            Ensure(result, "Staff role");
        }

        foreach (var account in accounts)
        {
            var existing = await db.Tenants.SingleOrDefaultAsync(t => t.Slug == account.Slug);
            if (existing is not null)
            {
                var admin = await users.FindByEmailAsync(account.Email);
                if (admin is null || admin.TenantId != existing.Id ||
                    !await users.IsInRoleAsync(admin, "Admin") ||
                    existing.AccessExpiresAtUtc.HasValue != account.IsTrial)
                    throw new InvalidOperationException(
                        $"Seed collision/mismatch for '{account.Slug}'; refusing to overwrite an existing tenant.");
                // Both the password hash AND original expiration remain unchanged.
                Console.WriteLine($"SEED_ACCESS_EXISTS={account.Slug} (unchanged)");
                continue;
            }
            if (await users.FindByEmailAsync(account.Email) is not null)
                throw new InvalidOperationException($"Seed email collision for '{account.Slug}'.");

            var createdUtc = DateTime.UtcNow;
            var tenant = new Tenant
            {
                Slug = account.Slug,
                Name = account.Name,
                CreatedAtUtc = createdUtc,
                AccessExpiresAtUtc = account.IsTrial ? createdUtc.AddMonths(3) : null
            };
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var adminUser = new ImportUser
            {
                TenantId = tenant.Id,
                UserName = account.Email,
                Email = account.Email,
                DisplayName = account.DisplayName,
                EmailConfirmed = true,
                CreatedAtUtc = createdUtc
            };
            Ensure(await users.CreateAsync(adminUser, account.Password), "Account creation");
            Ensure(await users.AddToRoleAsync(adminUser, "Admin"), "Account Admin role");

            Console.WriteLine($"SEED_ACCESS_CREATED={account.Slug} expires=" +
                (tenant.AccessExpiresAtUtc?.ToString("O") ?? "never"));
        }

        await transaction.CommitAsync();
        Console.WriteLine("SEED_ACCESS_COMPLETE=2 tenant-scoped Admin accounts (no passwords logged)");
    }

    private static string Read(string name)
    {
        var raw = Environment.GetEnvironmentVariable(name) ?? "";
        // Normalize email addresses, but NEVER silently mutate a password
        // coming from a secret store (spaces may be intentional).
        var value = name.EndsWith("_EMAIL", StringComparison.Ordinal)
            ? raw.Trim() : raw;
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException($"Set required secret/config variable '{name}'.");
        if (name.EndsWith("_EMAIL", StringComparison.Ordinal))
        {
            if (value.Length > 254 || !new EmailAddressAttribute().IsValid(value))
                throw new InvalidOperationException($"Invalid email in '{name}'.");
            return value.ToLowerInvariant();
        }
        if (value.Length < 12 || value.Length > 256)
            throw new InvalidOperationException($"Password from '{name}' must be 12-256 characters.");
        return value;
    }

    private static void Ensure(IdentityResult result, string operation)
    {
        if (!result.Succeeded)
            throw new InvalidOperationException(operation + " failed: " +
                string.Join(", ", result.Errors.Select(e => e.Code)));
    }
}
