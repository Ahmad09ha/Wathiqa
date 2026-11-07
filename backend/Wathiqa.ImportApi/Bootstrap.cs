using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Wathiqa.ImportApi;

public static class Bootstrap
{
    // Local operator-only CLI; there is intentionally no tenant-creation HTTP API.
    // Configure environment variables in the calling process. Never log passwords.
    public static async Task RunAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ImportDb>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ImportUser>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var cs = new NpgsqlConnectionStringBuilder(config.GetConnectionString("ImportDatabase"));
        if (cs.Database is "hussam_templates" or "wathiqa_docs")
            throw new InvalidOperationException("Refusing bootstrap against old template database.");
        if (!await db.Database.CanConnectAsync())
            throw new InvalidOperationException("Import database connection failed.");

        await db.Database.MigrateAsync();
        foreach (var name in new[] { "Admin", "Staff" })
        {
            if (!await roles.RoleExistsAsync(name))
            {
                var result = await roles.CreateAsync(new IdentityRole<Guid>(name));
                if (!result.Succeeded) throw new InvalidOperationException("Role creation failed.");
            }
        }

        var slug = (Environment.GetEnvironmentVariable("WATHIQA_TENANT_SLUG") ?? "").Trim().ToLowerInvariant();
        var tenantName = (Environment.GetEnvironmentVariable("WATHIQA_TENANT_NAME") ?? "").Trim();
        var email = (Environment.GetEnvironmentVariable("WATHIQA_ADMIN_EMAIL") ?? "").Trim();
        var password = Environment.GetEnvironmentVariable("WATHIQA_ADMIN_PASSWORD") ?? "";
        if (slug.Length is < 3 or > 80 || !System.Text.RegularExpressions.Regex.IsMatch(slug, "^[a-z0-9][a-z0-9-]*$"))
            throw new InvalidOperationException("Provide a valid WATHIQA_TENANT_SLUG.");
        if (tenantName.Length is < 2 or > 180)
            throw new InvalidOperationException("Provide WATHIQA_TENANT_NAME (2-180 chars).");
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            throw new InvalidOperationException("Provide WATHIQA_ADMIN_EMAIL and WATHIQA_ADMIN_PASSWORD as environment variables.");

        if (await db.Tenants.AnyAsync(t => t.Slug == slug))
            throw new InvalidOperationException("Tenant already exists; bootstrap does not edit existing users.");
        if (await users.FindByEmailAsync(email) is not null)
            throw new InvalidOperationException("This email is already in use.");

        await using var tx = await db.Database.BeginTransactionAsync();
        var tenant = new Tenant { Slug = slug, Name = tenantName };
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var user = new ImportUser
        {
            TenantId = tenant.Id, Email = email, UserName = email,
            DisplayName = tenantName + " Admin", EmailConfirmed = true
        };
        var createResult = await users.CreateAsync(user, password);
        if (!createResult.Succeeded)
            throw new InvalidOperationException("Cannot create admin: "
                + string.Join("; ", createResult.Errors.Select(x => x.Code)));
        var addRole = await users.AddToRoleAsync(user, "Admin");
        if (!addRole.Succeeded) throw new InvalidOperationException("Cannot grant Admin role.");
        await tx.CommitAsync();
        Console.WriteLine($"BOOTSTRAP_COMPLETE Tenant={slug} Admin={email} (password not logged)");
    }
}
