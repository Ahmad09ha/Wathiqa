using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Wathiqa.ImportApi;

/// <summary>
/// Automatically upgrade ONLY the Import database, before Kestrel accepts
/// requests. No accounts, roles, subscription plans or passwords are seeded.
/// </summary>
public static class ImportStartupMigrations
{
    public static async Task ApplyAsync(
        IServiceProvider services, IConfiguration configuration,
        IHostEnvironment environment, CancellationToken cancellationToken)
    {
        // Dokploy/production deploys migrate automatically. Development stays
        // on its existing explicit local-migration workflow by default.
        // Operators may opt out to run a reviewed manual migration first.
        var option = Environment.GetEnvironmentVariable("WATHIQA_IMPORT_AUTO_MIGRATE");
        var enabled = option?.Trim().ToLowerInvariant() switch
        {
            null or "" => !environment.IsDevelopment(),
            "true" => true,
            "false" => false,
            _ => throw new InvalidOperationException(
                "WATHIQA_IMPORT_AUTO_MIGRATE must be true or false.")
        };

        var logger = services.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Wathiqa.Import.SchemaStartup");

        if (!enabled && environment.IsDevelopment() && string.IsNullOrWhiteSpace(option))
        {
            logger.LogInformation("Import schema startup migration skipped (Development).");
            return;
        }

        var connection = configuration.GetConnectionString("ImportDatabase")
            ?? throw new InvalidOperationException("ImportDatabase connection missing.");
        var database = new NpgsqlConnectionStringBuilder(connection).Database ?? "";

        // Import owns a dedicated PostgreSQL database. Never migrate the
        // document editor, an unknown DB or production under Development.
        if (environment.IsDevelopment() && database != "wathiqa_import_dev" ||
            !environment.IsDevelopment() && database != "wathiqa_import")
            throw new InvalidOperationException(
                "Import schema startup refused: unexpected environment/database combination.");

        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ImportDb>();
        try
        {
            // An EF model change without a checked-in migration would serve
            // an outdated schema even if the migration history is current.
            if (db.Database.HasPendingModelChanges())
                throw new InvalidOperationException(
                    "Import API model differs from the latest EF migration snapshot.");

            var pending = (await db.Database.GetPendingMigrationsAsync(cancellationToken))
                .ToArray();
            if (!enabled)
            {
                if (pending.Length > 0)
                    throw new InvalidOperationException(
                        "Import schema is outdated and automatic migration is disabled. " +
                        "Apply the pending migrations with the operator CLI before starting the API.");
                logger.LogInformation("Import schema is current; auto-migration disabled by operator.");
                return;
            }

            logger.LogInformation(
                "Import schema startup check: {Count} pending migration(s).",
                pending.Length);
            if (pending.Length > 0)
            {
                // EF Core 10 / Npgsql's migration lock serializes concurrent
                // attempts across app replicas. Do NOT wrap in an outer
                // transaction; EF manages its own lock and transactions.
                logger.LogInformation(
                    "Applying Import schema migrations before opening HTTP listener.");
                await db.Database.MigrateAsync(cancellationToken);
            }

            var remaining = (await db.Database.GetPendingMigrationsAsync(cancellationToken))
                .ToArray();
            if (remaining.Length > 0)
                throw new InvalidOperationException(
                    "Import schema startup check failed: migrations remain pending.");

            logger.LogInformation(
                "Import schema is current. Pending at startup: {Count}.",
                pending.Length);
        }
        catch (Exception ex)
        {
            logger.LogCritical(ex,
                "Import schema migration/check failed. Refusing to open HTTP listener.");
            throw;
        }
    }
}
