using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Wathiqa.ImportApi;

public sealed record SaveTenantPortRequest(string? Name, string? Country = null);

/// <summary>
/// Tenant-scoped port directory. Historical orders keep their port-name
/// snapshots: catalogue edits/deletes never rewrite recorded contracts.
/// </summary>
public static class TenantPortsApi
{
    public static void Map(WebApplication app)
    {
        var group = app.MapGroup("/api/ports").RequireAuthorization("TenantMember");

        // Includes port names from previous orders, without copying them to
        // the directory or changing historical business data.
        group.MapGet("/", async (ImportDb db, CancellationToken ct) =>
        {
            var saved = await db.Ports.AsNoTracking().OrderBy(p => p.Name)
                .Select(p => new { p.Id, p.Name, p.Country, p.CreatedAtUtc })
                .ToListAsync(ct);
            var loading = await db.Orders.AsNoTracking()
                .Where(o => o.LoadingPort != "")
                .Select(o => o.LoadingPort).Distinct().ToListAsync(ct);
            var discharge = await db.Orders.AsNoTracking()
                .Where(o => o.DischargePort != "")
                .Select(o => o.DischargePort).Distinct().ToListAsync(ct);

            var known = new HashSet<string>(
                saved.Select(p => NormalizeKey(p.Name)), StringComparer.Ordinal);
            var history = loading.Concat(discharge)
                .Select(n => n.Trim())
                .Where(n => n.Length is >= 2 and <= 160 && !n.Contains('\0'))
                .Where(n => known.Add(NormalizeKey(n)))
                .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                .Select(n => new { Id = (Guid?)null, Name = n, Country = "",
                    Source = "History", CreatedAtUtc = (DateTime?)null })
                .ToArray();
            var catalog = saved.Select(p => new { Id = (Guid?)p.Id, p.Name, p.Country,
                Source = "Catalog", CreatedAtUtc = (DateTime?)p.CreatedAtUtc });
            return Results.Ok(catalog.Concat(history));
        });

        group.MapPost("/", async (SaveTenantPortRequest body, ImportDb db,
            ClaimsPrincipal principal, CancellationToken ct) =>
        {
            if (!TryNormalize(body, out var name, out var country))
                return Results.BadRequest(new { error = "invalid_port_details" });
            var tenantId = CurrentTenant.Id(principal);
            var key = NormalizeKey(name);
            if (await db.Ports.AnyAsync(p => p.NormalizedName == key, ct))
                return Results.Conflict(new { error = "port_already_exists" });
            var port = new TenantPort { TenantId = tenantId, Name = name,
                NormalizedName = key, Country = country };
            db.Ports.Add(port);
            db.PortAudits.Add(Audit(port, CurrentTenant.UserId(principal), "Created"));
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException ex) when (IsDuplicate(ex))
            {
                return Results.Conflict(new { error = "port_already_exists" });
            }
            return Results.Created($"/api/ports/{port.Id}", Detail(port));
        });

        group.MapPut("/{id:guid}", async (Guid id, SaveTenantPortRequest body,
            ImportDb db, ClaimsPrincipal principal, CancellationToken ct) =>
        {
            if (!TryNormalize(body, out var name, out var country))
                return Results.BadRequest(new { error = "invalid_port_details" });
            var port = await db.Ports.SingleOrDefaultAsync(p => p.Id == id, ct);
            if (port is null) return Results.NotFound();
            var key = NormalizeKey(name);
            if (await db.Ports.AnyAsync(p => p.Id != id && p.NormalizedName == key, ct))
                return Results.Conflict(new { error = "port_already_exists" });
            port.Name = name; port.NormalizedName = key; port.Country = country;
            db.PortAudits.Add(Audit(port, CurrentTenant.UserId(principal), "Updated"));
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException ex) when (IsDuplicate(ex))
            {
                return Results.Conflict(new { error = "port_already_exists" });
            }
            return Results.Ok(Detail(port));
        });

        group.MapDelete("/{id:guid}", async (Guid id, ImportDb db,
            ClaimsPrincipal principal, CancellationToken ct) =>
        {
            var port = await db.Ports.SingleOrDefaultAsync(p => p.Id == id, ct);
            if (port is null) return Results.NotFound();
            port.IsDeleted = true;
            db.PortAudits.Add(Audit(port, CurrentTenant.UserId(principal), "Deleted"));
            await db.SaveChangesAsync(ct);
            // Existing Orders keep the original literal name.
            return Results.NoContent();
        });
    }

    private static bool TryNormalize(SaveTenantPortRequest body, out string name,
        out string country)
    {
        name = (body.Name ?? "").Trim();
        country = (body.Country ?? "").Trim();
        return name.Length is >= 2 and <= 160 &&
            country.Length <= 100 && !name.Contains('\0') &&
            !country.Contains('\0');
    }

    private static string NormalizeKey(string name) => name.Trim().ToUpperInvariant();
    private static bool IsDuplicate(DbUpdateException ex) =>
        ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };
    private static TenantPortAudit Audit(TenantPort port, Guid actorId, string action) => new()
    {
        TenantId = port.TenantId, PortId = port.Id, ActorId = actorId,
        Action = action, NameSnapshot = port.Name
    };
    private static object Detail(TenantPort port) => new
    {
        port.Id, port.Name, port.Country, Source = "Catalog", port.CreatedAtUtc
    };
}
