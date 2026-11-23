using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

// Read-only operational tracking for active tenant.
// Financial settlement is intentionally excluded until WP-05 exists.
public static class OperationsApi
{
    public static void Map(WebApplication app)
    {
        var group = app.MapGroup("/api/operations").RequireAuthorization("TenantMember");

        group.MapGet("/containers", async (
            ImportDb db, string? status, string? search, Guid? orderId,
            int? freeTimeWindowDays, int? page, int? pageSize) =>
        {
            var currentPage = page ?? 1;
            var take = pageSize ?? 25;
            if (currentPage is < 1 or > 100000 || take is < 1 or > 100)
                return Results.BadRequest(new { error = "invalid_pagination" });
            if (search?.Length > 120 || (status is { Length: > 0 } &&
                status is not ("Planned" or "AtSea" or "AtPort" or "Delivered")))
                return Results.BadRequest(new { error = "invalid_filter" });
            if (freeTimeWindowDays is < 0 or > 90)
                return Results.BadRequest(new { error = "invalid_filter" });
            if (orderId == Guid.Empty)
                return Results.BadRequest(new { error = "invalid_filter" });

            var query = db.Containers.AsNoTracking().AsQueryable();
            if (orderId.HasValue)
                query = query.Where(c => c.Shipment.OrderId == orderId.Value);
            if (!string.IsNullOrWhiteSpace(status))
                query = query.Where(c => c.Status == status);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.Trim();
                query = query.Where(c => c.Number.Contains(term) ||
                    c.Shipment.BlNumber.Contains(term) ||
                    c.Shipment.Order.Number.Contains(term));
            }

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            if (freeTimeWindowDays.HasValue)
            {
                var cutoff = today.AddDays(freeTimeWindowDays.Value);
                query = query.Where(c => c.Status != "Delivered" &&
                    c.FreeTimeEndDate != null && c.FreeTimeEndDate <= cutoff);
            }
            var total = await query.CountAsync();
            var sorted = freeTimeWindowDays.HasValue
                ? query.OrderBy(c => c.FreeTimeEndDate).ThenBy(c => c.Id)
                : query.OrderByDescending(c => c.CreatedAtUtc).ThenBy(c => c.Id);
            var items = await sorted.Skip((currentPage - 1) * take).Take(take)
                .Select(c => new
                {
                    c.Id, c.Number, c.Size, c.Status, c.FreeTimeEndDate,
                    c.ArrivedAtPortDate, c.DeliveredDate,
                    c.ShipmentId, c.Shipment.BlNumber, c.Shipment.Eta,
                    OrderId = c.Shipment.OrderId,
                    OrderNumber = c.Shipment.Order.Number,
                    Supplier = c.Shipment.Order.SupplierNameSnapshot
                }).ToListAsync();
            return Results.Ok(new
            {
                page = currentPage, pageSize = take, total, items,
                asOfUtcDate = today
            });
        });

        // Missing documents mean ONLY rules explicitly configured as required
        // by that tenant's Admin, applicable to the target's current stage,
        // with neither a live directly scoped link nor a live waiver.
        group.MapGet("/document-gaps", async (
            ImportDb db, IWebHostEnvironment environment,
            Guid? orderId, int? page, int? pageSize) =>
        {
            var currentPage = page ?? 1;
            var take = pageSize ?? 25;
            if (currentPage is < 1 or > 100000 || take is < 1 or > 100)
                return Results.BadRequest(new { error = "invalid_pagination" });
            if (orderId == Guid.Empty)
                return Results.BadRequest(new { error = "invalid_filter" });
            if (orderId.HasValue && !await db.Orders.AnyAsync(o => o.Id == orderId.Value))
                return Results.NotFound();

            var orders = db.Orders.AsNoTracking().AsQueryable();
            if (orderId.HasValue)
                orders = orders.Where(o => o.Id == orderId.Value);
            var rules = db.DocumentRequirementRules.AsNoTracking()
                .Where(r => r.IsRequired);
            var mayUseDevelopmentUploads = environment.IsDevelopment();

            var orderGaps =
                from o in orders
                from rule in rules.Where(r => r.TargetType == "Order" &&
                    (r.Stage == "Any" || r.Stage == o.ArrivalStatus))
                where !db.StoredDocumentLinks.Any(l => l.OrderId == o.Id &&
                    l.Document.Type == rule.DocumentType &&
                    (mayUseDevelopmentUploads || l.Document.ScanStatus == "Clean"))
                    && !db.DocumentRequirementWaivers.Any(w => w.OrderId == o.Id &&
                        w.RequirementId == rule.Id && w.RevokedAtUtc == null)
                select new
                {
                    OrderId = o.Id, OrderNumber = o.Number,
                    TargetId = o.Id, TargetType = "Order",
                    TargetLabel = o.Number, Stage = o.ArrivalStatus,
                    rule.DocumentType, RequirementId = rule.Id
                };

            // Shipment stage uses the SAME precedence as the checklist:
            // all delivered > partially delivered > at port > at sea > planned.
            var shipmentRows =
                from s in db.Shipments.AsNoTracking()
                where !orderId.HasValue || s.OrderId == orderId.Value
                select new
                {
                    s.Id, s.OrderId, OrderNumber = s.Order.Number, s.BlNumber,
                    Stage = !db.Containers.Any(c => c.ShipmentId == s.Id) ? "Planned" :
                        !db.Containers.Any(c => c.ShipmentId == s.Id && c.Status != "Delivered") ? "Delivered" :
                        db.Containers.Any(c => c.ShipmentId == s.Id && c.Status == "Delivered") ? "PartiallyDelivered" :
                        db.Containers.Any(c => c.ShipmentId == s.Id && c.Status == "AtPort") ? "AtPort" :
                        db.Containers.Any(c => c.ShipmentId == s.Id && c.Status == "AtSea") ? "AtSea" : "Planned"
                };
            var shipmentGaps =
                from s in shipmentRows
                from rule in rules.Where(r => r.TargetType == "Shipment" &&
                    (r.Stage == "Any" || r.Stage == s.Stage))
                where !db.StoredDocumentLinks.Any(l => l.ShipmentId == s.Id &&
                    l.Document.Type == rule.DocumentType &&
                    (mayUseDevelopmentUploads || l.Document.ScanStatus == "Clean"))
                    && !db.DocumentRequirementWaivers.Any(w => w.ShipmentId == s.Id &&
                        w.RequirementId == rule.Id && w.RevokedAtUtc == null)
                select new
                {
                    OrderId = s.OrderId, s.OrderNumber,
                    TargetId = s.Id, TargetType = "Shipment",
                    TargetLabel = s.BlNumber, s.Stage,
                    rule.DocumentType, RequirementId = rule.Id
                };

            var containerGaps =
                from c in db.Containers.AsNoTracking()
                where !orderId.HasValue || c.Shipment.OrderId == orderId.Value
                from rule in rules.Where(r => r.TargetType == "Container" &&
                    (r.Stage == "Any" || r.Stage == c.Status))
                where !db.StoredDocumentLinks.Any(l => l.ContainerId == c.Id &&
                    l.Document.Type == rule.DocumentType &&
                    (mayUseDevelopmentUploads || l.Document.ScanStatus == "Clean"))
                    && !db.DocumentRequirementWaivers.Any(w => w.ContainerId == c.Id &&
                        w.RequirementId == rule.Id && w.RevokedAtUtc == null)
                select new
                {
                    OrderId = c.Shipment.OrderId,
                    OrderNumber = c.Shipment.Order.Number,
                    TargetId = c.Id, TargetType = "Container",
                    TargetLabel = c.Number, Stage = c.Status,
                    rule.DocumentType, RequirementId = rule.Id
                };

            var missing = orderGaps.Concat(shipmentGaps).Concat(containerGaps);
            var total = await missing.CountAsync();
            var items = await missing
                .OrderBy(x => x.OrderNumber)
                .ThenBy(x => x.TargetType)
                .ThenBy(x => x.TargetLabel)
                .ThenBy(x => x.DocumentType)
                .ThenBy(x => x.RequirementId)
                .Skip((currentPage - 1) * take).Take(take)
                .ToListAsync();
            return Results.Ok(new
            {
                page = currentPage, pageSize = take, total, items,
                definition = "Admin-defined required documents without valid direct links or waivers"
            });
        });
    }
}
