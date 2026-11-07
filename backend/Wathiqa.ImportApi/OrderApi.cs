using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Wathiqa.ImportApi;

public static class OrderApi
{
    public static void Map(WebApplication app)
    {
        var group = app.MapGroup("/api/orders").RequireAuthorization("TenantMember");

        group.MapGet("/", async (
            ImportDb db, int? page, int? pageSize, string? search, string? q,
            Guid? supplierId, string? currency, string? status,
            string? payment, string? arrival, string? clearance, bool? overdue,
            string? from, string? to, string? sort) =>
        {
            var pageNumber = page ?? 1;
            var take = pageSize ?? 25;
            if (pageNumber is < 1 or > 100000 || take is < 1 or > 100)
                return Results.BadRequest(new { error = "invalid_pagination" });
            if (search?.Length > 160 || q?.Length > 160 || currency?.Length > 3 ||
                status?.Length > 30 || sort?.Length > 20 || (search is not null && q is not null))
                return Results.BadRequest(new { error = "invalid_filter" });

            if(payment is { Length:>0 } &&
               payment is not ("Paid" or "PartiallyPaid" or "Unpaid" or "Outstanding"))
                return Results.BadRequest(new{error="invalid_filter"});
            if (status is not null && status is not ("Draft" or "Closed" or "Cancelled"))
                return Results.BadRequest(new { error = "invalid_filter" });
            if (arrival is { Length: > 0 } &&
                arrival is not ("NotShipped" or "Planned" or "AtSea" or "AtPort" or
                    "PartiallyDelivered" or "Delivered"))
                return Results.BadRequest(new { error = "invalid_filter" });
            if (clearance is { Length: > 0 } &&
                clearance is not ("NotStarted" or "InProgress" or "Partial" or "Released"))
                return Results.BadRequest(new { error = "invalid_filter" });
            if (sort is { Length: > 0 } &&
                sort is not ("newest" or "oldest" or "totalAsc" or "totalDesc" or "eta"))
                return Results.BadRequest(new { error = "invalid_filter" });
            DateOnly? fromDate = null, toDate = null;
            if (from is not null)
            {
                if (!DateOnly.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                        DateTimeStyles.None, out var parsedFrom) ||
                    parsedFrom.Year is < 2000 or > 2100)
                    return Results.BadRequest(new { error = "invalid_filter_date" });
                fromDate = parsedFrom;
            }
            if (to is not null)
            {
                if (!DateOnly.TryParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                        DateTimeStyles.None, out var parsedTo) ||
                    parsedTo.Year is < 2000 or > 2100)
                    return Results.BadRequest(new { error = "invalid_filter_date" });
                toDate = parsedTo;
            }
            if (fromDate.HasValue && toDate.HasValue && fromDate > toDate)
                return Results.BadRequest(new { error = "invalid_filter_date_range" });

            var query = db.Orders.AsNoTracking().AsQueryable();
            if (supplierId.HasValue) query = query.Where(x => x.SupplierId == supplierId.Value);
            if (!string.IsNullOrWhiteSpace(currency))
            {
                var currencyFilter = currency.Trim().ToUpperInvariant();
                query = query.Where(x => x.Currency == currencyFilter);
            }
            if (!string.IsNullOrWhiteSpace(status))
            {
                var statusFilter = status.Trim();
                query = query.Where(x => x.Status == statusFilter);
            }
            if (!string.IsNullOrWhiteSpace(arrival))
            {
                var selected = arrival.Trim();
                query = query.Where(x => x.ArrivalStatus == selected);
            }
            if (!string.IsNullOrWhiteSpace(clearance))
            {
                var selected = clearance.Trim();
                query = query.Where(x => x.ClearanceStatus == selected);
            }
            if (fromDate.HasValue) query = query.Where(x => x.OrderDate >= fromDate.Value);
            if (toDate.HasValue) query = query.Where(x => x.OrderDate <= toDate.Value);
            var queryText = q ?? search;
            if (!string.IsNullOrWhiteSpace(queryText))
            {
                var searchFilter = queryText.Trim();
                query = query.Where(x => x.Number.Contains(searchFilter)
                    || x.SupplierRef.Contains(searchFilter)
                    || x.SupplierNameSnapshot.Contains(searchFilter));
            }
            // All payment facts below are derived in SQL from ACTIVE supplier
            // commercial allocations, not from planned dates, stale Order
            // columns or gross wire amounts (which may include discrepancies).
            var today=DateOnly.FromDateTime(DateTime.UtcNow);
            var financial=query.Select(o=>new {
                Order=o,
                Paid=db.PaymentAllocations.Where(a=>a.OrderId==o.Id&&
                    a.Kind=="Commercial"&&a.Transfer.State=="Active")
                    .Sum(a=>(decimal?)a.Amount)??0m,
                Due=db.PaymentSchedules.Where(s=>s.OrderId==o.Id&&s.DueDate<today)
                    .Sum(s=>(decimal?)s.Amount)??0m,
                Gross=(db.PaymentTransfers.Where(t=>t.OrderId==o.Id&&t.State=="Active")
                    .Sum(t=>(decimal?)t.Amount)??0m)-
                    (db.PaymentReturns.Where(r=>r.OrderId==o.Id&&r.Transfer.State=="Active")
                    .Sum(r=>(decimal?)r.Amount)??0m),
                ExpensesApplied=db.PaymentAllocations.Where(a=>a.OrderId==o.Id&&
                    a.Kind=="Expense"&&a.Transfer.State=="Active")
                    .Sum(a=>(decimal?)a.Amount)??0m
            });
            if(payment=="Paid")financial=financial.Where(x=>x.Paid>=x.Order.TotalAmount);
            if(payment=="Unpaid")financial=financial.Where(x=>x.Paid<=0);
            if(payment=="PartiallyPaid")financial=financial.Where(x=>
                x.Paid>0&&x.Paid<x.Order.TotalAmount);
            if(payment=="Outstanding")financial=financial.Where(x=>x.Paid<x.Order.TotalAmount);
            if(overdue.HasValue)financial=financial.Where(x=>(x.Due>x.Paid)==overdue.Value);
            var count=await financial.CountAsync();
            // Group all matched records BEFORE paging. Never mix USD/EUR/etc.
            var grouped=await financial.GroupBy(x=>x.Order.Currency)
                .Select(g=>new{Currency=g.Key,OrderCount=g.Count(),
                    TotalAmount=g.Sum(x=>x.Order.TotalAmount),PaidAmount=g.Sum(x=>x.Paid)})
                .OrderBy(x=>x.Currency).ToListAsync();
            var summaries=grouped.Select(x=>new{x.Currency,x.OrderCount,x.TotalAmount,
                x.PaidAmount,RemainingAmount=x.TotalAmount-x.PaidAmount}).ToArray();
            var ordered = sort switch
            {
                "oldest" => financial.OrderBy(x => x.Order.OrderDate).ThenBy(x => x.Order.Id),
                "totalAsc" => financial.OrderBy(x => x.Order.TotalAmount).ThenBy(x => x.Order.Id),
                "totalDesc" => financial.OrderByDescending(x => x.Order.TotalAmount).ThenBy(x => x.Order.Id),
                "eta" => financial.OrderBy(x => db.Shipments
                    .Where(s => s.OrderId == x.Order.Id && s.Eta != null)
                    .Min(s => s.Eta)).ThenBy(x => x.Order.Id),
                _ => financial.OrderByDescending(x => x.Order.OrderDate)
                    .ThenByDescending(x => x.Order.CreatedAtUtc).ThenBy(x => x.Order.Id)
            };
            var records = await ordered
                .Skip((pageNumber - 1) * take).Take(take)
                .Select(v => new
                {
                    x=v.Order,
                    v.Paid,v.Due,v.Gross,v.ExpensesApplied
                })
                .Select(v=>new
                {
                    x=v.x,
                    v.Paid,v.Due,v.Gross,v.ExpensesApplied
                })
                .Select(v => new
                {
                    v.x.Id, v.x.Number, v.x.OrderDate, v.x.SupplierId,
                    v.x.SupplierNameSnapshot,v.x.SupplierRef,v.x.Currency,v.x.TotalAmount,
                    PaidAmount=v.Paid,RemainingAmount=v.x.TotalAmount-v.Paid,
                    PaymentStatus=v.Paid<=0?"Unpaid":v.Paid>=v.x.TotalAmount?"Paid":"PartiallyPaid",
                    IsPaymentOverdue=v.Due>v.Paid,
                    UnresolvedDifference=v.Gross-v.Paid-v.ExpensesApplied,
                    v.x.ArrivalStatus,v.x.ClearanceStatus,
                    v.x.ContainerCount,v.x.DeliveredContainerCount,v.x.Status,
                    v.x.ClosedWithExceptions,v.x.Revision,v.x.UpdatedAtUtc,
                    ItemCount=v.x.Items.Count,
                    QuantityKg=v.x.Items.Sum(i=>i.QuantityKg),
                    Eta=db.Shipments.Where(s=>s.OrderId==v.x.Id&&s.Eta!=null).Min(s=>s.Eta)
                }).ToListAsync();
            return Results.Ok(new
            {
                page = pageNumber, pageSize = take, total = count, items = records,
                summaries,
                financialsAvailable = true
            });
        });

        group.MapGet("/{id:guid}", async (Guid id, ImportDb db) =>
        {
            var order = await db.Orders.AsNoTracking().Include(x => x.Items)
                .SingleOrDefaultAsync(x => x.Id == id);
            if(order is null)return Results.NotFound();
            var finance=await PaymentSnapshot.LoadAsync(db,order);
            finance.AssertInvariants();
            return Results.Ok(Detail(order,finance));
        });

        group.MapPost("/", async (SaveOrderRequest body, ImportDb db,
            System.Security.Claims.ClaimsPrincipal principal) =>
        {
            ValidatedOrderDraft input;
            try { input = OrderDraftCalculator.Validate(body); }
            catch (OrderValidationException ex)
            {
                return Results.BadRequest(new { error = ex.Code });
            }
            var tenantId = CurrentTenant.Id(principal);
            var actorId = CurrentTenant.UserId(principal);
            var parties = await LookupParties(db, body.SupplierId, body.CustomerId);
            if (parties is null) return Results.BadRequest(new { error = "supplier_or_customer_unavailable" });

            await using var transaction = await db.Database.BeginTransactionAsync();
            var nextNumber = await AllocateOrderNumber(db, tenantId, input.OrderDate.Year);
            var now = DateTime.UtcNow;
            var order = new PurchaseOrder
            {
                TenantId = tenantId,
                NumberYear = input.OrderDate.Year,
                Number = $"PO-{input.OrderDate.Year}-{nextNumber:D4}",
                SupplierId = body.SupplierId,
                SupplierNameSnapshot = parties.Value.Supplier,
                CustomerId = body.CustomerId,
                CustomerNameSnapshot = parties.Value.Customer,
                SupplierRef = input.SupplierRef, OrderDate = input.OrderDate,
                Incoterm = input.Incoterm, LoadingPort = input.LoadingPort,
                DischargePort = input.DischargePort, Currency = input.Currency,
                Notes = input.Notes, TotalAmount = input.TotalAmount,
                CreatedById = actorId, UpdatedById = actorId,
                CreatedAtUtc = now, UpdatedAtUtc = now,
                Items = input.Items.Select((item, index) =>
                    CreateLine(item, tenantId, actorId, now, index + 1)).ToList()
            };
            db.Orders.Add(order);
            db.OrderAudits.Add(new OrderAudit
            {
                TenantId = tenantId, OrderId = order.Id,
                ActorId = actorId, Action = "Created", NewRevision = 1,
                AfterJson = JsonSerializer.Serialize(Detail(order)),
                OccurredAtUtc = now
            });
            try
            {
                await db.SaveChangesAsync();
                await transaction.CommitAsync();
                return Results.Created($"/api/orders/{order.Id}", Detail(order));
            }
            catch (DbUpdateException)
            {
                return Results.Conflict(new { error = "order_creation_conflict" });
            }
        }).RequireAuthorization("CanManagePayments");

        group.MapPut("/{id:guid}", async (
            Guid id, SaveOrderRequest body, ImportDb db,
            System.Security.Claims.ClaimsPrincipal principal) =>
        {
            if (body.Revision is null or < 1)
                return Results.BadRequest(new { error = "revision_required" });
            ValidatedOrderDraft input;
            try { input = OrderDraftCalculator.Validate(body); }
            catch (OrderValidationException ex)
            {
                return Results.BadRequest(new { error = ex.Code });
            }
            var order = await db.Orders.Include(x => x.Items).SingleOrDefaultAsync(x => x.Id == id);
            if (order is null) return Results.NotFound();
            if (order.Status != "Draft")
                return Results.Conflict(new { error = "only_draft_orders_editable" });
            // No silent change to commercial amount, supplier or currency after
            // real financial history exists; use audited finance correction.
            if(await db.PaymentSchedules.AnyAsync(x=>x.OrderId==id)||
               await db.PaymentTransfers.AnyAsync(x=>x.OrderId==id)||
               await db.OrderExpenses.AnyAsync(x=>x.OrderId==id))
                return Results.Conflict(new{error="order_has_financial_records"});
            // Keep numbering invariant: PO-{year}-{sequence}. Changing an order
            // to another calendar year would invalidate its permanent number.
            if (input.OrderDate.Year != order.NumberYear)
                return Results.Conflict(new { error = "order_number_year_immutable" });
            if (order.Revision != body.Revision)
                return Results.Conflict(new { error = "stale_order_revision", currentRevision = order.Revision });
            var parties = await LookupParties(db, body.SupplierId, body.CustomerId);
            if (parties is null) return Results.BadRequest(new { error = "supplier_or_customer_unavailable" });

            // Existing line IDs must belong to this very order; never permit
            // attaching another order's item via a client-provided Guid.
            var current = order.Items.ToDictionary(x => x.Id);
            if (input.Items.Any(x => x.Id.HasValue && !current.ContainsKey(x.Id.Value)))
                return Results.BadRequest(new { error = "foreign_order_item" });
            var before = JsonSerializer.Serialize(Detail(order));
            var actorId = CurrentTenant.UserId(principal);
            var now = DateTime.UtcNow;
            order.SupplierId = body.SupplierId;
            order.SupplierNameSnapshot = parties.Value.Supplier;
            order.CustomerId = body.CustomerId;
            order.CustomerNameSnapshot = parties.Value.Customer;
            order.SupplierRef = input.SupplierRef;
            order.OrderDate = input.OrderDate;
            order.Incoterm = input.Incoterm;
            order.LoadingPort = input.LoadingPort;
            order.DischargePort = input.DischargePort;
            order.Currency = input.Currency;
            order.Notes = input.Notes;
            order.TotalAmount = input.TotalAmount;
            order.UpdatedAtUtc = now;
            order.UpdatedById = actorId;
            order.Revision++;

            var retained = new HashSet<Guid>();
            for (var i = 0; i < input.Items.Count; i++)
            {
                var item = input.Items[i];
                if (item.Id.HasValue)
                {
                    var existing = current[item.Id.Value];
                    ApplyLine(existing, item, i + 1, actorId, now);
                    retained.Add(existing.Id);
                }
                else
                {
                    var created = CreateLine(item, order.TenantId, actorId, now, i + 1);
                    created.OrderId = order.Id;
                    order.Items.Add(created);
                    // Newly generated GUIDs already have a value. When attached
                    // through a tracked parent collection EF can classify the
                    // child as an existing row. Explicit Added state is required.
                    db.OrderItems.Add(created);
                }
            }
            foreach (var existing in current.Values.Where(x => !retained.Contains(x.Id)))
            {
                order.Items.Remove(existing);
                db.OrderItems.Remove(existing);
            }
            db.OrderAudits.Add(new OrderAudit
            {
                TenantId = order.TenantId, OrderId = order.Id,
                ActorId = actorId, Action = "Updated",
                PreviousRevision = body.Revision.Value, NewRevision = order.Revision,
                BeforeJson = before, AfterJson = JsonSerializer.Serialize(Detail(order)),
                OccurredAtUtc = now
            });
            try
            {
                await db.SaveChangesAsync();
                return Results.Ok(Detail(order));
            }
            catch (DbUpdateConcurrencyException)
            {
                return Results.Conflict(new { error = "stale_order_revision" });
            }
            catch (DbUpdateException)
            {
                return Results.Conflict(new { error = "order_update_conflict" });
            }
        }).RequireAuthorization("CanManagePayments");

        // Draft-only soft deletion. Confirm/close/cancel workflow remains blocked
        // pending the approved-business P-02 workshop.
        group.MapDelete("/{id:guid}", async (
            Guid id, int? revision, ImportDb db,
            System.Security.Claims.ClaimsPrincipal principal) =>
        {
            if (revision is null or < 1)
                return Results.BadRequest(new { error = "revision_required" });
            var order = await db.Orders.Include(x => x.Items)
                .SingleOrDefaultAsync(x => x.Id == id);
            if (order is null) return Results.NotFound();
            if (order.Status != "Draft")
                return Results.Conflict(new { error = "only_draft_orders_deletable" });
            if (await db.Shipments.AnyAsync(x => x.OrderId == id))
                return Results.Conflict(new { error = "order_has_shipments" });
            if (await db.StoredDocumentLinks.AnyAsync(x => x.OrderId == id))
                return Results.Conflict(new { error = "order_has_documents" });
            if(await db.PaymentSchedules.AnyAsync(x=>x.OrderId==id)||
               await db.PaymentTransfers.AnyAsync(x=>x.OrderId==id)||
               await db.OrderExpenses.AnyAsync(x=>x.OrderId==id))
                return Results.Conflict(new{error="order_has_financial_records"});
            if (order.Revision != revision.Value)
                return Results.Conflict(new { error = "stale_order_revision" });
            var now = DateTime.UtcNow;
            var before = JsonSerializer.Serialize(Detail(order));
            order.Revision++;
            order.IsDeleted = true;
            order.UpdatedAtUtc = now;
            order.UpdatedById = CurrentTenant.UserId(principal);
            db.OrderAudits.Add(new OrderAudit
            {
                TenantId = order.TenantId, OrderId = order.Id, Action = "DraftDeleted",
                ActorId = CurrentTenant.UserId(principal),
                PreviousRevision = revision.Value, NewRevision = order.Revision,
                BeforeJson = before, AfterJson = JsonSerializer.Serialize(Detail(order)),
                OccurredAtUtc = now
            });
            try
            {
                await db.SaveChangesAsync();
                return Results.NoContent();
            }
            catch (DbUpdateConcurrencyException)
            {
                return Results.Conflict(new { error = "stale_order_revision" });
            }
        }).RequireAuthorization("CanManagePayments");
    }

    private static async Task<(string Supplier, string? Customer)?> LookupParties(
        ImportDb db, Guid supplierId, Guid? customerId)
    {
        var supplier = await db.Companies.AsNoTracking()
            .Where(x => x.Id == supplierId && x.Type == "Supplier")
            .Select(x => x.Name).SingleOrDefaultAsync();
        if (supplier is null) return null;
        string? customer = null;
        if (customerId.HasValue)
        {
            customer = await db.Companies.AsNoTracking()
                .Where(x => x.Id == customerId.Value && x.Type == "Customer")
                .Select(x => x.Name).SingleOrDefaultAsync();
            if (customer is null) return null;
        }
        return (supplier, customer);
    }

    private static PurchaseOrderItem CreateLine(
        ValidatedOrderItem line, Guid tenantId, Guid actorId, DateTime now, int position)
    {
        var item = new PurchaseOrderItem
        {
            TenantId = tenantId, CreatedById = actorId, CreatedAtUtc = now
        };
        ApplyLine(item, line, position, actorId, now);
        return item;
    }

    private static void ApplyLine(
        PurchaseOrderItem item, ValidatedOrderItem line, int position,
        Guid actorId, DateTime now)
    {
        item.Position = position;
        item.ProductType = line.ProductType;
        item.Denier = line.Denier;
        item.Luster = line.Luster;
        item.Grade = line.Grade;
        item.ColorType = line.ColorType;
        item.QuantityKg = line.QuantityKg;
        item.UnitPrice = line.UnitPrice;
        item.PriceUnit = line.PriceUnit;
        item.LineTotal = line.LineTotal;
        item.HsCode = line.HsCode;
        item.UpdatedAtUtc = now;
        item.UpdatedById = actorId;
    }

    private static object Detail(PurchaseOrder x,PaymentSnapshot? finance=null) => new
    {
        x.Id, x.TenantId, x.Number, x.NumberYear, x.SupplierId,
        x.SupplierNameSnapshot, x.CustomerId, x.CustomerNameSnapshot,
        x.SupplierRef, x.OrderDate, x.Incoterm, x.LoadingPort,
        x.DischargePort, x.Currency, x.Notes, x.TotalAmount,
        PaidAmount = finance?.AppliedCommercial, RemainingAmount = finance?.CommercialRemainingDue,
        PaymentStatus = finance?.PaymentStatus, FinancialsAvailable = finance is not null,
        x.ArrivalStatus, x.ClearanceStatus, x.Status,
        x.ClosureReason,x.ClosedWithExceptions,x.ClosedAtUtc,x.ClosedById,
        x.ContainerCount, x.DeliveredContainerCount, x.Revision,
        x.CreatedAtUtc, x.CreatedById, x.UpdatedAtUtc, x.UpdatedById,
        Items = x.Items.OrderBy(i => i.Position).Select(i => new
        {
            i.Id, i.Position, i.ProductType, i.Denier, i.Luster, i.Grade,
            i.ColorType, i.QuantityKg, i.UnitPrice, i.PriceUnit,
            i.LineTotal, i.HsCode
        }).ToArray()
    };

    // Unique (TenantId,Year) UPSERT takes an exclusive row lock until the
    // surrounding DB transaction commits. This serializes concurrent numbering
    // and rolls the counter back if the order or its line insert fails.
    private static async Task<int> AllocateOrderNumber(
        ImportDb db, Guid tenantId, int year)
    {
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction();
        command.CommandText = """
            INSERT INTO "OrderNumberSequences" ("TenantId","Year","LastNumber")
            VALUES (@tenant, @year, 1)
            ON CONFLICT ("TenantId","Year")
            DO UPDATE SET "LastNumber" = "OrderNumberSequences"."LastNumber" + 1
            RETURNING "LastNumber";
            """;
        var tenantParam = command.CreateParameter();
        tenantParam.ParameterName = "tenant";
        tenantParam.DbType = DbType.Guid;
        tenantParam.Value = tenantId;
        command.Parameters.Add(tenantParam);
        var yearParam = command.CreateParameter();
        yearParam.ParameterName = "year";
        yearParam.DbType = DbType.Int32;
        yearParam.Value = year;
        command.Parameters.Add(yearParam);
        var result = await command.ExecuteScalarAsync();
        return Convert.ToInt32(result);
    }
}
