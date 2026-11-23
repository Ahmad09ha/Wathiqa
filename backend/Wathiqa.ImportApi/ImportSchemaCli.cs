using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Wathiqa.ImportApi;

/// <summary>
/// Operator-only schema management. It deliberately never seeds accounts,
/// rotates credentials or runs during normal HTTP API startup.
/// </summary>
public static class ImportSchemaCli
{
    public static async Task<int> RunAsync(IServiceProvider services, bool migrate)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ImportDb>();
        var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var env = scope.ServiceProvider.GetRequiredService<IHostEnvironment>();
        var connectionString = config.GetConnectionString("ImportDatabase")
            ?? throw new InvalidOperationException("Import database connection is missing.");
        var database = new NpgsqlConnectionStringBuilder(connectionString).Database ?? "";

        // Never operate on the legacy document-editor database or an arbitrary
        // instance. Production and dev Import databases have separate names.
        if (database is not ("wathiqa_import" or "wathiqa_import_dev"))
            throw new InvalidOperationException("Schema maintenance is restricted to Wathiqa Import databases.");
        if (!env.IsDevelopment() && database != "wathiqa_import")
            throw new InvalidOperationException("Non-development schema maintenance requires the production Import database.");
        if (!await db.Database.CanConnectAsync())
            throw new InvalidOperationException("Unable to connect to the Import database.");

        var pending = (await db.Database.GetPendingMigrationsAsync()).ToArray();
        Console.WriteLine("IMPORT_SCHEMA_DATABASE=" + database);
        Console.WriteLine("IMPORT_PENDING_MIGRATION_COUNT=" + pending.Length);
        foreach (var migration in pending)
            Console.WriteLine("IMPORT_PENDING_MIGRATION=" + migration);

        var trackedBillsColumn = await db.Database.SqlQueryRaw<int>(
            @"SELECT COUNT(*)::integer AS ""Value"" FROM information_schema.columns
              WHERE table_schema = current_schema()
              AND table_name = 'PlatformSubscriptionPlans'
              AND column_name = 'MaxTrackedBills'").SingleAsync();
        Console.WriteLine("IMPORT_TRACKING_PLAN_COLUMN_PRESENT=" + (trackedBillsColumn == 1));

        if (!migrate)
        {
            Console.WriteLine("IMPORT_SCHEMA_STATUS_READ_ONLY=true");
            return 0;
        }

        // Requiring a deliberate explicit target and a verified backup
        // acknowledgment prevents accidental one-shot production mutations.
        var target = Environment.GetEnvironmentVariable("WATHIQA_MIGRATION_TARGET_DB") ?? "";
        if (!string.Equals(target, database, StringComparison.Ordinal))
        {
            Console.Error.WriteLine(
                "Migration blocked: WATHIQA_MIGRATION_TARGET_DB must equal the Import database name.");
            return 2;
        }
        if (!env.IsDevelopment() &&
            !string.Equals(Environment.GetEnvironmentVariable("WATHIQA_MIGRATION_BACKUP_VERIFIED"),
                "yes", StringComparison.Ordinal))
        {
            Console.Error.WriteLine(
                "Migration blocked: verify a recoverable backup, then set WATHIQA_MIGRATION_BACKUP_VERIFIED=yes.");
            return 2;
        }
        if (pending.Length == 0)
        {
            Console.WriteLine("IMPORT_SCHEMA_MIGRATION_NOOP=true");
            return 0;
        }

        await db.Database.MigrateAsync();
        var stillPending = (await db.Database.GetPendingMigrationsAsync()).ToArray();
        if (stillPending.Length != 0)
            throw new InvalidOperationException("Import migrations did not fully apply.");
        Console.WriteLine("IMPORT_SCHEMA_MIGRATION_APPLIED=" + pending.Length);
        return 0;
    }
}
