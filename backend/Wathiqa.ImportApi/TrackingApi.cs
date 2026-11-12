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
            Guid shipmentId, ImportDb db, ShipsGoTrackingClient client) =>
        {
            if (!await db.Shipments.AnyAsync(x => x.Id == shipmentId))
                return Results.NotFound();

            var records = await db.TrackingReferences.AsNoTracking()
                .Where(x => x.ShipmentId == shipmentId)
                .OrderBy(x => x.CreatedAtUtc).ToListAsync();
            var tenantId = db.CurrentTenantId;
            var subscription = await db.TenantSubscriptions.AsNoTracking()
                .Where(x => x.TenantId == tenantId && x.EndedAtUtc == null)
                .Select(x => new { x.TrackingCycleId, x.Plan.MaxTrackedBills })
                .SingleOrDefaultAsync();
            var usage = subscription is null ? 0 : await db.SubscriptionTrackingUsages
                .CountAsync(x => x.TrackingCycleId == subscription.TrackingCycleId);
            return Results.Ok(new
            {
                configured = client.IsConfigured,
                quota = new { limit = subscription?.MaxTrackedBills ?? 0,
                    used = usage, remaining = Math.Max(0,(subscription?.MaxTrackedBills ?? 0)-usage) },
                provider = "ShipsGo",
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

            var carrier = (body.CarrierCode ?? "").Trim();
            if (carrier.Length > 0 &&
                (carrier.Length > 80 ||
                 !Regex.IsMatch(carrier, "^[A-Za-z0-9][A-Za-z0-9 .&-]{1,79}$")))
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
            Guid id, ImportDb db, ShipsGoTrackingClient client,
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

            var tenantId = CurrentTenant.Id(principal);
            SubscriptionTrackingUsage? usage;
            var freshActivation = false;
            var newUsage = false;
            // Lock the subscription row before counting/reserving a chargeable
            // slot. All tabs/containers under one B/L share this single ledger.
            await using (var tx = await db.Database.BeginTransactionAsync(ct))
            {
                var subscription = await db.TenantSubscriptions.FromSqlInterpolated(
                    $"SELECT * FROM \"TenantSubscriptions\" WHERE \"TenantId\"={tenantId} FOR UPDATE")
                    .SingleOrDefaultAsync(ct);
                if (subscription is null || subscription.EndedAtUtc is not null)
                    return Results.Json(new { error = "tracking_subscription_required" },
                        statusCode: StatusCodes.Status403Forbidden);
                var limit = await db.PlatformSubscriptionPlans
                    .Where(p => p.Id == subscription.PlanId)
                    .Select(p => p.MaxTrackedBills).SingleAsync(ct);
                if (limit <= 0)
                    return Results.Json(new { error = "tracking_quota_disabled" },
                        statusCode: StatusCodes.Status403Forbidden);
                usage = await db.SubscriptionTrackingUsages.SingleOrDefaultAsync(x =>
                    x.TrackingCycleId == subscription.TrackingCycleId &&
                    x.ShipmentId == item.ShipmentId,ct);
                if (usage is { ProviderRequestId.Length: 0 })
                    return Results.Conflict(new { error = "tracking_activation_pending_review" });
                if (usage is null)
                {
                    newUsage = true;
                    var count = await db.SubscriptionTrackingUsages.CountAsync(x =>
                        x.TrackingCycleId == subscription.TrackingCycleId,ct);
                    if (count >= limit)
                        return Results.Json(new { error = "tracking_quota_exceeded" },
                            statusCode: StatusCodes.Status403Forbidden);
                    // A shipment edit locks this same row. Taking the lock
                    // prevents changing the B/L between quota reservation
                    // and the first chargeable provider POST.
                    var lockedShipment = await db.Shipments.FromSqlInterpolated(
                        $"SELECT * FROM \"Shipments\" WHERE \"Id\"={item.ShipmentId} FOR UPDATE")
                        .SingleAsync(ct);
                    var bl = lockedShipment.BlNumber;
                    // Reusing a previously paid ShipsGo tracking avoids a
                    // second provider POST when the subscription renews.
                    var old = await db.SubscriptionTrackingUsages.AsNoTracking()
                        .Where(x => x.ShipmentId == item.ShipmentId &&
                            x.BlNumber == bl && x.ProviderRequestId != "")
                        .OrderByDescending(x => x.CreatedAtUtc).FirstOrDefaultAsync(ct);
                    usage = new SubscriptionTrackingUsage {
                        TenantId = tenantId, ShipmentId = item.ShipmentId,
                        TrackingCycleId = subscription.TrackingCycleId,
                        BlNumber = bl,
                        ProviderRequestId = old?.ProviderRequestId ?? "",
                        State = old is null ? "Reserved" : "Active"
                    };
                    freshActivation = old is null;
                }
                // Reserve the rate-limit slot in the SAME transaction as
                // tracking quota; a 429 must never leave an orphan paid slot.
                var claimed = await db.TrackingReferences
                    .Where(x => x.Id == id &&
                        (x.LastAttemptAtUtc == null ||
                         x.LastAttemptAtUtc < now - RefreshInterval))
                    .ExecuteUpdateAsync(s=>s.SetProperty(x=>x.LastAttemptAtUtc,now),ct);
                if (claimed == 0)
                    return Results.Json(new { error = "tracking_refresh_too_soon" },
                        statusCode: StatusCodes.Status429TooManyRequests);
                if (newUsage)
                {
                    db.SubscriptionTrackingUsages.Add(usage);
                    await db.SaveChangesAsync(ct);
                }
                await tx.CommitAsync(ct);
            }

            // Reserved with no provider ID may already have consumed a credit.
            // It must NOT be replayed after a crash/timeout/ambiguous response.
            item.LastAttemptAtUtc = now;
            try
            {
                if (freshActivation)
                {
                    var registered = await client.RegisterBillAsync(
                        usage.BlNumber, item.CarrierCode,ct);
                    usage.ProviderRequestId = registered;
                    usage.State = "Active";
                    await db.SaveChangesAsync(ct);
                }
                var snapshot = await client.FetchAsync(usage.ProviderRequestId, ct);
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
                if (freshActivation && usage.ProviderRequestId.Length == 0)
                {
                    if (ex.Definitive)
                        db.SubscriptionTrackingUsages.Remove(usage);
                    else
                        usage.State = "NeedsReview";
                }
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
