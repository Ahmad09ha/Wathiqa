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

        // This is the only unsigned-session write route exempt from CSRF.
        // Every request must instead prove possession of the separate webhook
        // secret using ShipsGo's HMAC-SHA256 signature of the exact raw bytes.
        app.MapPost("/api/tracking/provider-webhook", async (
            HttpContext http, ImportDb db, ShipsGoV2Client v2, CancellationToken ct) =>
        {
            if (!v2.HasWebhookSecret) return Results.NotFound();
            if (http.Request.ContentLength is > 4_000_000)
                return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            using var bytes = new MemoryStream();
            var buffer = new byte[16384];
            int read;
            while ((read = await http.Request.Body.ReadAsync(buffer, ct)) > 0)
            {
                if (bytes.Length + read > 4_000_000)
                    return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
                bytes.Write(buffer, 0, read);
            }
            if (!v2.VerifyWebhook(bytes.ToArray(),
                    http.Request.Headers["X-Shipsgo-Webhook-Signature"].ToString()))
                return Results.Unauthorized();
            JsonDocument payload;
            try { payload = JsonDocument.Parse(bytes.ToArray()); }
            catch (JsonException) { return Bad("tracking_provider_invalid_response"); }
            using (payload)
            {
                var root = payload.RootElement;
                if (!root.TryGetProperty("event", out var evt) ||
                    !evt.TryGetProperty("name", out var name) ||
                    name.GetString() != "OCEAN.SHIPMENTS.SHIPMENT_UPDATED" ||
                    http.Request.Headers["X-Shipsgo-Webhook-Name"].ToString() !=
                        "OCEAN.SHIPMENTS.SHIPMENT_UPDATED" ||
                    !root.TryGetProperty("shipment", out var shipment) ||
                    !shipment.TryGetProperty("id", out var id) ||
                    !id.TryGetInt64(out var numericId) || numericId <= 0)
                    return Bad("tracking_provider_invalid_response");

                TrackingSnapshot snapshot;
                try { snapshot = ShipsGoV2Client.ParseSnapshot(shipment); }
                catch (TrackingProviderException) { return Bad("tracking_provider_invalid_response"); }
                var providerId = "v2:" + numericId;
                // No cross-tenant lookups are exposed to the caller. The HMAC
                // authenticated notification may update only paid, known IDs.
                var usages = await db.SubscriptionTrackingUsages.IgnoreQueryFilters()
                    .AsNoTracking().Where(x => x.ProviderRequestId == providerId)
                    .Select(x => new { x.TenantId, x.ShipmentId }).Distinct().ToListAsync(ct);
                if (usages.Count == 0) return Results.Ok(new { accepted = true });
                foreach (var link in usages)
                {
                    var refs = await db.TrackingReferences.IgnoreQueryFilters()
                        .Where(x => x.TenantId == link.TenantId &&
                            x.ShipmentId == link.ShipmentId).ToListAsync(ct);
                    foreach (var item in refs)
                    {
                        TrackingSnapshot? previous = null;
                        try { previous = JsonSerializer.Deserialize<TrackingSnapshot>(item.SnapshotJson); }
                        catch (JsonException) { /* Replace invalid cached snapshot. */ }
                        if (DateTimeOffset.TryParse(previous?.ProviderUpdatedAt,
                                out var oldAt) && DateTimeOffset.TryParse(
                                snapshot.ProviderUpdatedAt, out var newAt) && newAt <= oldAt)
                            continue;
                        // Keep the last known map point when webhook has no
                        // geojson; voyage details must not erase location data.
                        var updated = snapshot with {
                            Latitude = previous?.Latitude,
                            Longitude = previous?.Longitude,
                            PositionUpdatedAt = previous?.PositionUpdatedAt,
                            MapWaypoints = previous?.MapWaypoints,
                            MapSegments = previous?.MapSegments
                        };
                        item.SnapshotJson = JsonSerializer.Serialize(updated);
                        item.ProviderStatus = updated.Status[..Math.Min(updated.Status.Length, 60)];
                        item.LastSyncedAtUtc = DateTime.UtcNow;
                        item.LastErrorCode = "";
                        item.UpdatedAtUtc = DateTime.UtcNow;
                    }
                }
                await db.SaveChangesAsync(ct);
                return Results.Ok(new { accepted = true });
            }
        }).AllowAnonymous();

        tracking.MapGet("/carriers", async (ShipsGoV2Client v2, CancellationToken ct) =>
        {
            if (!v2.IsConfigured)
                return Results.Json(new { error = "tracking_v2_not_configured" },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            try { return Results.Ok(await v2.ListCarriersAsync(ct)); }
            catch (TrackingProviderException ex)
            { return Results.Json(new { error = ex.Code }, statusCode: 502); }
        });

        shipments.MapGet("/{shipmentId:guid}/tracking", async (
            Guid shipmentId, ImportDb db, ShipsGoTrackingClient client, ShipsGoV2Client v2) =>
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
                configured = client.IsConfigured || v2.IsConfigured,
                v2Configured = v2.IsConfigured,
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
                 !Regex.IsMatch(carrier, "^[A-Za-z0-9][A-Za-z0-9 .&_-]{1,79}$")))
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

        tracking.MapPost("/{id:guid}/reconcile", async (
            Guid id, ImportDb db, ShipsGoV2Client v2, CancellationToken ct) =>
        {
            if (!v2.IsConfigured)
                return Results.Json(new { error = "tracking_v2_not_configured" },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            var item = await db.TrackingReferences.SingleOrDefaultAsync(x => x.Id == id, ct);
            if (item is null) return Results.NotFound();
            var usage = await db.SubscriptionTrackingUsages
                .Where(x => x.ShipmentId == item.ShipmentId && x.ProviderRequestId == "" &&
                    (x.State == "NeedsReview" || x.State == "Reserved"))
                .OrderByDescending(x => x.CreatedAtUtc).FirstOrDefaultAsync(ct);
            if (usage is null)
                return Results.Conflict(new { error = "tracking_reconciliation_not_needed" });
            var refs = await db.TrackingReferences.AsNoTracking()
                .Where(x => x.ShipmentId == item.ShipmentId).ToListAsync(ct);
            var containers = refs.Where(x => x.ReferenceType == "CT")
                .Select(x => x.ReferenceNumber).Distinct().ToArray();
            try
            {
                var recovered = await v2.FindExistingAsync(item.ShipmentId,
                    usage.BlNumber, containers, ct);
                if (recovered is null)
                    return Results.Conflict(new { error = "tracking_reconciliation_not_found" });
                usage.ProviderRequestId = recovered;
                usage.State = "Active";
                item.LastAttemptAtUtc = null;
                item.LastErrorCode = "";
                item.UpdatedAtUtc = DateTime.UtcNow;
                await db.SaveChangesAsync(ct);
                return Results.Ok(Info(item));
            }
            catch (TrackingProviderException ex)
            {
                return Results.Json(new { error = ex.Code }, statusCode: 502);
            }
        });

        tracking.MapPost("/{id:guid}/refresh", async (
            Guid id, ImportDb db, ShipsGoTrackingClient client, ShipsGoV2Client v2,
            System.Security.Claims.ClaimsPrincipal principal, CancellationToken ct) =>
        {
            var item = await db.TrackingReferences.SingleOrDefaultAsync(x => x.Id == id, ct);
            if (item is null) return Results.NotFound();
            if (!client.IsConfigured && !v2.IsConfigured)
                return Results.Json(new { error = "tracking_not_configured" },
                    statusCode: StatusCodes.Status503ServiceUnavailable);

            var now = DateTime.UtcNow;
            // Already activated shipments only need free/read-only GETs. Their
            // first response may be NEW before ShipsGo has processed the B/L.
            // Keep a 60-second GET throttle without delaying updates 30 minutes.
            if (item.LastSyncedAtUtc > now - TimeSpan.FromMinutes(1))
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
                // This also covers an activated provider ID reused from a
                // previous subscription cycle: no new paid POST is required.
                var existingReadOnlyTracking = usage is { ProviderRequestId.Length: > 0 };
                var allowedSince = now -
                    (existingReadOnlyTracking ? TimeSpan.FromMinutes(1) : RefreshInterval);
                // Reserve the rate-limit slot in the SAME transaction as
                // tracking quota; a 429 must never leave an orphan paid slot.
                var claimed = await db.TrackingReferences
                    .Where(x => x.Id == id &&
                        (x.LastAttemptAtUtc == null ||
                         x.LastAttemptAtUtc < allowedSince))
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
                    // Only V2 may create new paid registrations. Legacy V1.2
                    // remains read-only for previously paid provider IDs.
                    if (!v2.IsConfigured)
                        throw new TrackingProviderException("tracking_v2_not_configured", true);
                    if (item.CarrierCode.Length > 0 &&
                        !System.Text.RegularExpressions.Regex.IsMatch(
                            item.CarrierCode.ToUpperInvariant(), "^(SG_)?[A-Z0-9]{4}$"))
                        throw new TrackingProviderException("tracking_invalid_carrier", true);
                    var registered = await v2.RegisterAsync(
                        item.ReferenceType == "CT" ? "" : usage.BlNumber,
                        item.ReferenceType == "CT" ? item.ReferenceNumber : null,
                        item.CarrierCode.ToUpperInvariant(), item.ShipmentId, ct);
                    usage.ProviderRequestId = registered;
                    usage.State = "Active";
                    await db.SaveChangesAsync(ct);
                }
                var snapshot = ShipsGoV2Client.IsV2Id(usage.ProviderRequestId)
                    ? await v2.FetchAsync(usage.ProviderRequestId, ct)
                    : await client.FetchAsync(usage.ProviderRequestId, ct);
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
                    {
                        db.SubscriptionTrackingUsages.Remove(usage);
                        // Definitively rejected requests cannot consume credits;
                        // allow retry as soon as credentials/data are corrected.
                        item.LastAttemptAtUtc = null;
                        db.Entry(item).Property(x => x.LastAttemptAtUtc).IsModified = true;
                    }
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
