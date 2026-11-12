using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

public sealed record RegisterTrackingRequest(
    string? ReferenceType, string? ReferenceNumber, string? CarrierCode);

public static class TrackingApi
{
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(30);

    public static void Map(WebApplication app)
    {
        var shipments = app.MapGroup("/api/shipments")
            .RequireAuthorization("TenantMember");
        var tracking = app.MapGroup("/api/tracking")
            .RequireAuthorization("TenantMember");

        shipments.MapGet("/{shipmentId:guid}/tracking", async (
            Guid shipmentId, ImportDb db, SeaRatesTrackingClient client) =>
        {
            if (!await db.Shipments.AnyAsync(x => x.Id == shipmentId))
                return Results.NotFound();

            var records = await db.TrackingReferences.AsNoTracking()
                .Where(x => x.ShipmentId == shipmentId)
                .OrderBy(x => x.CreatedAtUtc).ToListAsync();
            return Results.Ok(new
            {
                configured = client.IsConfigured,
                records = records.Select(Info)
            });
        });

        shipments.MapPost("/{shipmentId:guid}/tracking", async (
            Guid shipmentId, RegisterTrackingRequest body, ImportDb db,
            System.Security.Claims.ClaimsPrincipal principal) =>
        {
            var shipment = await db.Shipments.SingleOrDefaultAsync(x => x.Id == shipmentId);
            if (shipment is null) return Results.NotFound();
            var kind = (body.ReferenceType ?? "").Trim().ToUpperInvariant();
            if (kind is not ("CT" or "BL"))
                return Bad("tracking_invalid_type");
            var number = (body.ReferenceNumber ?? "").Trim().Replace(" ", "")
                .ToUpperInvariant();
            if (number.Length is < 3 or > 90 ||
                !Regex.IsMatch(number, "^[A-Z0-9/_-]+$"))
                return Bad("tracking_invalid_number");
            if (kind == "CT" &&
                !Regex.IsMatch(number, "^[A-Z]{3}U[0-9]{7}$"))
                return Bad("tracking_invalid_container");
            if (kind == "BL" &&
                !string.Equals(number, shipment.BlNumber, StringComparison.OrdinalIgnoreCase))
                return Bad("tracking_bl_must_match_shipment");
            if (kind == "CT" &&
                !await db.Containers.AnyAsync(x => x.ShipmentId == shipmentId &&
                    x.Number == number))
                return Bad("tracking_container_not_in_shipment");

            var carrier = (body.CarrierCode ?? "").Trim().ToUpperInvariant();
            if (carrier.Length > 0 &&
                !Regex.IsMatch(carrier, "^[A-Z0-9]{2,12}$"))
                return Bad("tracking_invalid_carrier");

            var existing = await db.TrackingReferences.SingleOrDefaultAsync(x =>
                x.ShipmentId == shipmentId && x.ReferenceType == kind &&
                x.ReferenceNumber == number);
            if (existing is not null)
            {
                // Carrier can be corrected without making a paid provider call.
                if (existing.CarrierCode != carrier)
                {
                    existing.CarrierCode = carrier;
                    existing.UpdatedAtUtc = DateTime.UtcNow;
                    existing.UpdatedById = CurrentTenant.UserId(principal);
                    await db.SaveChangesAsync();
                }
                return Results.Ok(Info(existing));
            }
            if (await db.TrackingReferences.CountAsync(x => x.ShipmentId == shipmentId) >= 100)
                return Bad("tracking_reference_limit");
            var actor = CurrentTenant.UserId(principal);
            var item = new ShipmentTrackingReference
            {
                TenantId = CurrentTenant.Id(principal),
                ShipmentId = shipmentId,
                ReferenceType = kind,
                ReferenceNumber = number,
                CarrierCode = carrier,
                CreatedById = actor,
                UpdatedById = actor
            };
            db.TrackingReferences.Add(item);
            try
            {
                await db.SaveChangesAsync();
                return Results.Created($"/api/tracking/{item.Id}", Info(item));
            }
            catch (DbUpdateException)
            {
                // The unique key also protects concurrent repeated registration.
                return Results.Conflict(new { error = "tracking_reference_conflict" });
            }
        });

        tracking.MapPost("/{id:guid}/refresh", async (
            Guid id, ImportDb db, SeaRatesTrackingClient client,
            System.Security.Claims.ClaimsPrincipal principal, CancellationToken ct) =>
        {
            var item = await db.TrackingReferences.SingleOrDefaultAsync(x => x.Id == id, ct);
            if (item is null) return Results.NotFound();
            if (!client.IsConfigured)
                return Results.Json(new { error = "tracking_not_configured" },
                    statusCode: StatusCodes.Status503ServiceUnavailable);

            var now = DateTime.UtcNow;
            if (item.LastSyncedAtUtc > now - RefreshInterval)
                return Results.Ok(Info(item));

            // Atomic reservation: two browsers cannot trigger simultaneous
            // chargeable provider calls for the same tracking reference.
            var claimed = await db.TrackingReferences
                .Where(x => x.Id == id &&
                    (x.LastAttemptAtUtc == null ||
                     x.LastAttemptAtUtc < now - RefreshInterval))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(x => x.LastAttemptAtUtc, now), ct);
            if (claimed == 0)
                return Results.Json(new { error = "tracking_refresh_too_soon" },
                    statusCode: StatusCodes.Status429TooManyRequests);

            item.LastAttemptAtUtc = now;
            try
            {
                var snapshot = await client.FetchAsync(item.ReferenceType,
                    item.ReferenceNumber, item.CarrierCode, ct);
                item.SnapshotJson = JsonSerializer.Serialize(snapshot);
                item.ProviderStatus = snapshot.Status.Length == 0
                    ? "Unknown" : snapshot.Status[..Math.Min(snapshot.Status.Length, 60)];
                item.LastSyncedAtUtc = DateTime.UtcNow;
                item.LastErrorCode = "";
                item.UpdatedAtUtc = DateTime.UtcNow;
                item.UpdatedById = CurrentTenant.UserId(principal);
                await db.SaveChangesAsync(ct);
                return Results.Ok(Info(item));
            }
            catch (TrackingProviderException ex)
            {
                item.LastErrorCode = ex.Code;
                item.UpdatedAtUtc = DateTime.UtcNow;
                item.UpdatedById = CurrentTenant.UserId(principal);
                await db.SaveChangesAsync(ct);
                return Results.Json(new { error = ex.Code },
                    statusCode: StatusCodes.Status502BadGateway);
            }
        });
    }

    private static IResult Bad(string error) => Results.BadRequest(new { error });

    private static object Info(ShipmentTrackingReference x)
    {
        TrackingSnapshot? snapshot = null;
        if (x.LastSyncedAtUtc.HasValue)
        {
            try { snapshot = JsonSerializer.Deserialize<TrackingSnapshot>(x.SnapshotJson); }
            catch (JsonException) { /* Keep corrupt legacy snapshots unavailable. */ }
        }
        return new
        {
            x.Id, x.ShipmentId, x.ReferenceType, x.ReferenceNumber, x.CarrierCode,
            x.ProviderStatus, x.LastSyncedAtUtc, x.LastAttemptAtUtc,
            x.LastErrorCode, Snapshot = snapshot
        };
    }
}
