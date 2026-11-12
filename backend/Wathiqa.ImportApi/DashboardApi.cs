using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

// Read-only tenant dashboard. All aggregates are computed server-side from
// authoritative scoped tables. Money is NEVER aggregated across currencies.
public static class DashboardApi
{
    private sealed class ActivityRow
    {
        public Guid Id { get; set; }
        public DateTime AtUtc { get; set; }
        public Guid ActorId { get; set; }
        public string Category { get; set; } = "";
        public string Action { get; set; } = "";
        public Guid? OrderId { get; set; }
        public Guid? ShipmentId { get; set; }
        public Guid? TargetId { get; set; }
    }

    public static void Map(WebApplication app)
    {
        var group = app.MapGroup("/api/dashboard")
            .RequireAuthorization("TenantMember");
        group.MapGet("/overview", Overview);
        group.MapGet("/activity", Activity);
    }

    private static bool PeriodValid(int? days) =>
        days is null or 0 or 7 or 30 or 90 or 365;

    private static async Task<IResult> Overview(
        ImportDb db, ClaimsPrincipal principal, int? days, CancellationToken ct)
    {
        if (!PeriodValid(days))
            return Results.BadRequest(new { error = "invalid_filter" });

        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);
        var since = days is > 0 ? now.AddDays(-days.Value) : DateTime.MinValue;
        var tenant = CurrentTenant.Id(principal);

        var orders = db.Orders.AsNoTracking();
        var orderStats = await orders.GroupBy(_ => 1).Select(g => new
        {
            Total = g.Count(),
            Draft = g.Count(o => o.Status == "Draft"),
            Active = g.Count(o => o.Status != "Draft" &&
                                    o.Status != "Closed" && o.Status != "Cancelled"),
            Closed = g.Count(o => o.Status == "Closed"),
            ClosedWithExceptions = g.Count(o => o.ClosedWithExceptions),
            Cancelled = g.Count(o => o.Status == "Cancelled"),
            Unpaid = g.Count(o => o.PaymentStatus == "Unpaid"),
            PartiallyPaid = g.Count(o => o.PaymentStatus == "PartiallyPaid"),
            Paid = g.Count(o => o.PaymentStatus == "Paid"),
            NewInPeriod = g.Count(o => o.CreatedAtUtc >= since),
            QuantityKg = g.Sum(o => o.Items.Sum(i => (decimal?)i.QuantityKg)) ?? 0m
        }).SingleOrDefaultAsync(ct);

        var currencies = await orders
            .GroupBy(o => o.Currency)
            .Select(g => new
            {
                Currency = g.Key,
                Orders = g.Count(),
                Ordered = g.Sum(o => o.TotalAmount),
                CommercialPaid = g.Sum(o => o.PaidAmount),
                Remaining = g.Sum(o => o.TotalAmount > o.PaidAmount ?
                    o.TotalAmount - o.PaidAmount : 0m)
            })
            .OrderBy(x => x.Currency).ToListAsync(ct);

        var transfers = await db.PaymentTransfers.AsNoTracking()
            .Where(t => t.State == "Active")
            .GroupBy(t => t.Order.Currency)
            .Select(g => new { Currency = g.Key, Amount = g.Sum(t => t.Amount),
                Count = g.Count() }).ToListAsync(ct);
        var returns = await db.PaymentReturns.AsNoTracking()
            .GroupBy(r => r.Transfer.Order.Currency)
            .Select(g => new { Currency = g.Key, Amount = g.Sum(r => r.Amount),
                Count = g.Count() }).ToListAsync(ct);
        var expenses = await db.OrderExpenses.AsNoTracking()
            .GroupBy(e => e.Order.Currency)
            .Select(g => new { Currency = g.Key, Amount = g.Sum(e => e.Amount),
                Count = g.Count() }).ToListAsync(ct);
        var allocations = await db.PaymentAllocations.AsNoTracking()
            .Where(x => x.Transfer.State == "Active")
            .GroupBy(x => x.Transfer.Order.Currency)
            .Select(g => new { Currency = g.Key, Amount = g.Sum(x => x.Amount) })
            .ToListAsync(ct);
        var currencyKeys = currencies.Select(x => x.Currency)
            .Concat(transfers.Select(x => x.Currency))
            .Concat(returns.Select(x => x.Currency))
            .Concat(expenses.Select(x => x.Currency))
            .Distinct().OrderBy(x => x).ToArray();
        var byCurrency = currencyKeys.Select(currency =>
        {
            var order = currencies.FirstOrDefault(x => x.Currency == currency);
            var paid = transfers.FirstOrDefault(x => x.Currency == currency);
            var returned = returns.FirstOrDefault(x => x.Currency == currency);
            var expense = expenses.FirstOrDefault(x => x.Currency == currency);
            var allocated = allocations.FirstOrDefault(x => x.Currency == currency);
            var netTransferred = (paid?.Amount ?? 0m) - (returned?.Amount ?? 0m);
            return new
            {
                Currency = currency,
                Orders = order?.Orders ?? 0,
                Ordered = order?.Ordered ?? 0m,
                CommercialPaid = order?.CommercialPaid ?? 0m,
                Remaining = order?.Remaining ?? 0m,
                NetTransferred = netTransferred,
                RecordedExpenses = expense?.Amount ?? 0m,
                UnresolvedTransfers = netTransferred - (allocated?.Amount ?? 0m)
            };
        }).ToArray();

        var lateSchedules = await db.PaymentSchedules.AsNoTracking()
            .Where(x => x.DueDate < today)
            .GroupBy(x => x.OrderId)
            .Select(g => new
            {
                OrderId = g.Key,
                Due = g.Sum(x => x.Amount),
                CommercialPaid = g.Max(x => x.Order.PaidAmount)
            }).CountAsync(x => x.Due > x.CommercialPaid, ct);

        var shipments = db.Shipments.AsNoTracking();
        var billStats = await shipments.GroupBy(_ => 1).Select(g => new
        {
            Total = g.Count(),
            NewInPeriod = g.Count(s => s.CreatedAtUtc >= since),
            OriginalNotReceived = g.Count(s => s.BlOriginalStatus != "Received"),
            EtaOverdue = g.Count(s => s.Eta != null && s.Eta < today &&
                !s.Containers.Any(c => c.Status == "AtPort" || c.Status == "Delivered")),
            EtaNextSevenDays = g.Count(s => s.Eta != null && s.Eta >= today &&
                s.Eta <= today.AddDays(7)),
            WithContainers = g.Count(s => s.Containers.Any())
        }).SingleOrDefaultAsync(ct);

        var containers = db.Containers.AsNoTracking();
        var containerStats = await containers.GroupBy(_ => 1).Select(g => new
        {
            Total = g.Count(),
            Planned = g.Count(c => c.Status == "Planned"),
            AtSea = g.Count(c => c.Status == "AtSea"),
            AtPort = g.Count(c => c.Status == "AtPort"),
            Delivered = g.Count(c => c.Status == "Delivered"),
            NewInPeriod = g.Count(c => c.CreatedAtUtc >= since),
            FreeTimeOverdue = g.Count(c => c.Status != "Delivered" &&
                c.FreeTimeEndDate != null && c.FreeTimeEndDate < today),
            FreeTimeCritical = g.Count(c => c.Status != "Delivered" &&
                c.FreeTimeEndDate != null && c.FreeTimeEndDate >= today &&
                c.FreeTimeEndDate <= today.AddDays(3))
        }).SingleOrDefaultAsync(ct);

        var clearances = await db.CustomsClearances.AsNoTracking()
            .GroupBy(_ => 1).Select(g => new
            {
                Total = g.Count(),
                Released = g.Count(c => c.Status == "Released"),
                Processing = g.Count(c => c.Status != "Released" && c.Status != "NotStarted"),
                Awaiting = g.Count(c => c.Status == "NotStarted"),
                NewInPeriod = g.Count(c => c.UpdatedAtUtc >= since)
            }).SingleOrDefaultAsync(ct);

        var documents = await db.StoredDocuments.AsNoTracking().GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                NewInPeriod = g.Count(d => d.UploadedAtUtc >= since),
                Unscanned = g.Count(d => d.ScanStatus != "Clean"),
                TotalBytes = g.Sum(d => d.SizeBytes)
            }).SingleOrDefaultAsync(ct);

        var companies = await db.Companies.AsNoTracking().GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Suppliers = g.Count(c => c.Type == "Supplier"),
                Brokers = g.Count(c => c.Type == "Broker"),
                ShippingLines = g.Count(c => c.Type == "ShippingLine"),
                NewInPeriod = g.Count(c => c.CreatedAtUtc >= since)
            }).SingleOrDefaultAsync(ct);

        var staff = await db.Users.AsNoTracking().Where(u => u.TenantId == tenant)
            .GroupBy(_ => 1).Select(g => new
            {
                Total = g.Count(), Active = g.Count(u => u.IsActive),
                Inactive = g.Count(u => !u.IsActive)
            }).SingleOrDefaultAsync(ct);
        var invitations = await db.TenantInvitations.AsNoTracking().CountAsync(
            x => x.TenantId == tenant && x.UsedAtUtc == null && x.ExpiresAtUtc > now, ct);
        var activeSubscription = await db.TenantSubscriptions.AsNoTracking()
            .Where(s => s.TenantId == tenant && s.EndedAtUtc == null)
            .Select(s => new
            {
                s.TrackingCycleId, s.Plan.MaxTrackedBills, PlanName = s.Plan.Name,
                s.ExpiresAtUtc
            }).SingleOrDefaultAsync(ct);
        var quotaUsed = activeSubscription is null ? 0 :
            await db.SubscriptionTrackingUsages.CountAsync(x =>
                x.TrackingCycleId == activeSubscription.TrackingCycleId, ct);
        var track = await db.TrackingReferences.AsNoTracking().GroupBy(_ => 1)
            .Select(g => new
            {
                References = g.Count(),
                Synced = g.Count(x => x.LastSyncedAtUtc != null),
                Errors = g.Count(x => x.LastErrorCode != ""),
                NewInPeriod = g.Count(x => x.CreatedAtUtc >= since)
            }).SingleOrDefaultAsync(ct);

        var trendSince = today.AddDays(-13);
        var trendOrders = await orders.Where(o => o.CreatedAtUtc >=
                trendSince.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc))
            .GroupBy(o => o.CreatedAtUtc.Date)
            .Select(g => new { Date = g.Key, Count = g.Count() }).ToListAsync(ct);
        var trendContainers = await containers.Where(c => c.CreatedAtUtc >=
                trendSince.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc))
            .GroupBy(c => c.CreatedAtUtc.Date)
            .Select(g => new { Date = g.Key, Count = g.Count() }).ToListAsync(ct);
        var chart = Enumerable.Range(0, 14).Select(index =>
        {
            var date = trendSince.AddDays(index);
            var key = date.ToDateTime(TimeOnly.MinValue);
            return new
            {
                Date = date.ToString("yyyy-MM-dd"),
                Orders = trendOrders.FirstOrDefault(x => x.Date == key)?.Count ?? 0,
                Containers = trendContainers.FirstOrDefault(x => x.Date == key)?.Count ?? 0
            };
        }).ToArray();

        return Results.Ok(new
        {
            AsOfUtc = now, PeriodDays = days ?? 30,
            Orders = orderStats ?? new {
                Total = 0, Draft = 0, Active = 0, Closed = 0,
                ClosedWithExceptions = 0, Cancelled = 0, Unpaid = 0,
                PartiallyPaid = 0, Paid = 0, NewInPeriod = 0,
                QuantityKg = 0m
            },
            Financial = new
            {
                Currencies = byCurrency,
                OverdueOrders = lateSchedules,
                ActiveTransfers = transfers.Sum(x => x.Count),
                RecordedExpenses = expenses.Sum(x => x.Count),
                Returns = returns.Sum(x => x.Count)
            },
            Shipping = billStats ?? new {
                Total = 0, NewInPeriod = 0, OriginalNotReceived = 0,
                EtaOverdue = 0, EtaNextSevenDays = 0, WithContainers = 0
            },
            Containers = containerStats ?? new {
                Total = 0, Planned = 0, AtSea = 0, AtPort = 0,
                Delivered = 0, NewInPeriod = 0, FreeTimeOverdue = 0,
                FreeTimeCritical = 0
            },
            Customs = clearances ?? new {
                Total = 0, Released = 0, Processing = 0,
                Awaiting = 0, NewInPeriod = 0
            },
            Documents = documents ?? new {
                Total = 0, NewInPeriod = 0, Unscanned = 0, TotalBytes = 0L
            },
            Companies = companies ?? new {
                Total = 0, Suppliers = 0, Brokers = 0, ShippingLines = 0,
                NewInPeriod = 0
            },
            Team = new { Total = staff?.Total ?? 0, Active = staff?.Active ?? 0,
                Inactive = staff?.Inactive ?? 0, PendingInvitations = invitations },
            Tracking = new
            {
                PlanName = activeSubscription?.PlanName,
                Limit = activeSubscription?.MaxTrackedBills ?? 0,
                Used = quotaUsed,
                Remaining = Math.Max(0, (activeSubscription?.MaxTrackedBills ?? 0) - quotaUsed),
                References = track?.References ?? 0,
                Synced = track?.Synced ?? 0,
                Errors = track?.Errors ?? 0,
                NewInPeriod = track?.NewInPeriod ?? 0
            },
            Trend = chart
        });
    }

    private static IQueryable<ActivityRow> Events(ImportDb db, bool administrator)
    {
        var orders = db.OrderAudits.AsNoTracking().Select(x => new ActivityRow
        {
            Id = x.Id, AtUtc = x.OccurredAtUtc, ActorId = x.ActorId,
            Category = "orders", Action = x.Action,
            OrderId = x.OrderId, ShipmentId = (Guid?)null, TargetId = x.OrderId
        });
        var payments = db.PaymentAudits.AsNoTracking().Select(x => new ActivityRow
        {
            Id = x.Id, AtUtc = x.OccurredAtUtc, ActorId = x.ActorId,
            Category = "finance", Action = x.Action,
            OrderId = x.OrderId, ShipmentId = (Guid?)null, TargetId = x.EntityId
        });
        var logistics = db.LogisticsAudits.AsNoTracking().Select(x => new ActivityRow
        {
            Id = x.Id, AtUtc = x.OccurredAtUtc, ActorId = x.ActorId,
            Category = "logistics", Action = x.EntityType + ":" + x.Action,
            OrderId = x.OrderId, ShipmentId = x.ShipmentId, TargetId = x.EntityId
        });
        var docs = db.StoredDocumentAudits.AsNoTracking().Select(x => new ActivityRow
        {
            Id = x.Id, AtUtc = x.OccurredAtUtc, ActorId = x.ActorId,
            Category = "documents", Action = x.Action,
            OrderId = (Guid?)null, ShipmentId = (Guid?)null, TargetId = x.DocumentId
        });
        // Older companies predate the audit ledger. Include their known
        // creation timestamps once, but don't duplicate new audited creates.
        var companies = db.Companies.AsNoTracking()
            .Where(x => !db.CompanyAudits.Any(a =>
                a.CompanyId == x.Id && a.Action == "Created"))
            .Select(x => new ActivityRow
        {
            Id = x.Id, AtUtc = x.CreatedAtUtc, ActorId = Guid.Empty,
            Category = "companies", Action = "LegacyCreated",
            OrderId = (Guid?)null, ShipmentId = (Guid?)null, TargetId = x.Id
        });
        var companyHistory = db.CompanyAudits.AsNoTracking().Select(x => new ActivityRow
        {
            Id = x.Id, AtUtc = x.OccurredAtUtc, ActorId = x.ActorId,
            Category = "companies", Action = x.Action,
            OrderId = (Guid?)null, ShipmentId = (Guid?)null, TargetId = x.CompanyId
        });
        var trackingRegistered = db.TrackingReferences.AsNoTracking().Select(x => new ActivityRow
        {
            Id = x.Id, AtUtc = x.CreatedAtUtc, ActorId = x.CreatedById,
            Category = "tracking", Action = "Registered",
            OrderId = (Guid?)null, ShipmentId = x.ShipmentId, TargetId = x.Id
        });
        var trackingSynced = db.TrackingReferences.AsNoTracking()
            .Where(x => x.LastSyncedAtUtc != null)
            .Select(x => new ActivityRow
            {
                Id = x.Id, AtUtc = x.LastSyncedAtUtc!.Value,
                ActorId = x.UpdatedById, Category = "tracking",
                Action = "LastSynced", OrderId = (Guid?)null, ShipmentId = x.ShipmentId,
                TargetId = x.Id
            });
        var all = orders.Concat(payments).Concat(logistics).Concat(docs)
            .Concat(companies).Concat(companyHistory)
            .Concat(trackingRegistered).Concat(trackingSynced);
        if (!administrator) return all;
        var security = db.SecurityAudits.AsNoTracking().Select(x => new ActivityRow
        {
            Id = x.Id, AtUtc = x.OccurredAtUtc, ActorId = x.ActorId,
            Category = "security", Action = x.Action,
            OrderId = (Guid?)null, ShipmentId = (Guid?)null, TargetId = x.TargetUserId
        });
        var platform = db.PlatformAudits.AsNoTracking()
            .Where(x => x.TenantId == db.CurrentTenantId)
            .Select(x => new ActivityRow
            {
                Id = x.Id, AtUtc = x.OccurredAtUtc,
                ActorId = Guid.Empty, Category = "subscription",
                Action = x.Action, OrderId = (Guid?)null, ShipmentId = (Guid?)null,
                TargetId = x.TenantId
            });
        return all.Concat(security).Concat(platform);
    }

    private static async Task<IResult> Activity(
        ImportDb db, ClaimsPrincipal principal, string? category, int? days,
        int? page, int? pageSize, CancellationToken ct)
    {
        var currentPage = page ?? 1;
        var take = pageSize ?? 20;
        var filter = category?.Trim().ToLowerInvariant() ?? "all";
        var allowed = new[] { "all", "orders", "finance", "logistics",
            "documents", "companies", "tracking", "security", "subscription" };
        if (currentPage is < 1 or > 100000 || take is < 1 or > 50 ||
            !PeriodValid(days) || !allowed.Contains(filter))
            return Results.BadRequest(new { error = "invalid_filter" });
        var tenant = CurrentTenant.Id(principal);
        var administrator = principal.IsInRole("Admin");
        if (!administrator && filter is "security" or "subscription")
            return Results.StatusCode(StatusCodes.Status403Forbidden);

        var query = Events(db, administrator);
        if (filter != "all") query = query.Where(e => e.Category == filter);
        if (days is > 0)
        {
            var cutoff = DateTime.UtcNow.AddDays(-days.Value);
            query = query.Where(e => e.AtUtc >= cutoff);
        }
        var total = await query.CountAsync(ct);
        var rows = await query.OrderByDescending(e => e.AtUtc)
            .ThenByDescending(e => e.Id)
            .Skip((currentPage - 1) * take).Take(take).ToListAsync(ct);

        var actorIds = rows.Where(x => x.ActorId != Guid.Empty)
            .Select(x => x.ActorId).Distinct().ToArray();
        var actors = await db.Users.AsNoTracking().Where(x =>
                x.TenantId == tenant && actorIds.Contains(x.Id))
            .Select(x => new { x.Id, x.DisplayName })
            .ToDictionaryAsync(x => x.Id, x => x.DisplayName, ct);
        var orderIds = rows.Where(x => x.OrderId.HasValue)
            .Select(x => x.OrderId!.Value).Distinct().ToArray();
        var orderNames = await db.Orders.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenant && orderIds.Contains(x.Id))
            .Select(x => new { x.Id, x.Number })
            .ToDictionaryAsync(x => x.Id, x => x.Number, ct);
        var shipmentIds = rows.Where(x => x.ShipmentId.HasValue)
            .Select(x => x.ShipmentId!.Value).Distinct().ToArray();
        var shipmentNames = await db.Shipments.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenant && shipmentIds.Contains(x.Id))
            .Select(x => new { x.Id, x.OrderId, x.BlNumber })
            .ToDictionaryAsync(x => x.Id, ct);
        var docIds = rows.Where(x => x.Category == "documents" && x.TargetId.HasValue)
            .Select(x => x.TargetId!.Value).Distinct().ToArray();
        var docNames = await db.StoredDocuments.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenant && docIds.Contains(x.Id))
            .Select(x => new { x.Id, x.OriginalFileName })
            .ToDictionaryAsync(x => x.Id, x => x.OriginalFileName, ct);
        var companyIds = rows.Where(x => x.Category == "companies" && x.TargetId.HasValue)
            .Select(x => x.TargetId!.Value).Distinct().ToArray();
        var companyNames = await db.Companies.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenant && companyIds.Contains(x.Id))
            .Select(x => new { x.Id, x.Name })
            .ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        // A renamed/deleted company must keep the display name as it was at
        // each audited action, not silently rewrite old timeline entries.
        var companyAuditIds = rows.Where(x => x.Category == "companies" &&
                x.Action != "LegacyCreated")
            .Select(x => x.Id).Distinct().ToArray();
        var companyAuditNames = await db.CompanyAudits.AsNoTracking()
            .Where(x => companyAuditIds.Contains(x.Id))
            .Select(x => new { x.Id, x.NameSnapshot })
            .ToDictionaryAsync(x => x.Id, x => x.NameSnapshot, ct);
        var items = rows.Select(x =>
        {
            var orderId = x.OrderId;
            if (!orderId.HasValue && x.ShipmentId.HasValue &&
                shipmentNames.TryGetValue(x.ShipmentId.Value, out var shipment))
                orderId = shipment.OrderId;
            string? label = null;
            if (x.Category == "documents" && x.TargetId.HasValue)
                docNames.TryGetValue(x.TargetId.Value, out label);
            else if (x.Category == "companies" && x.Action != "LegacyCreated")
                companyAuditNames.TryGetValue(x.Id, out label);
            else if (x.Category == "companies" && x.TargetId.HasValue)
                companyNames.TryGetValue(x.TargetId.Value, out label);
            else if (x.ShipmentId.HasValue &&
                shipmentNames.TryGetValue(x.ShipmentId.Value, out var bill))
                label = bill.BlNumber;
            else if (orderId.HasValue)
                orderNames.TryGetValue(orderId.Value, out label);
            var actor = x.ActorId == Guid.Empty ?
                (x.Category == "subscription" ? "إدارة المنصة" :
                 x.Category == "companies" ? "المنفذ غير مسجّل (بيانات سابقة)" : "النظام") :
                actors.GetValueOrDefault(x.ActorId, "عضو سابق في الفريق");
            var description = $"{Title(x.Category, x.Action)}";
            return new
            {
                Id = $"{x.Category}:{x.Action}:{x.Id}",
                x.Category, x.Action,
                Title = description,
                Actor = actor,
                OccurredAtUtc = x.AtUtc,
                Subject = label,
                OrderId = orderId,
                Url = x.Category switch
                {
                    "companies" => "/import/companies",
                    "security" => administrator ? "/import/team" : null,
                    "subscription" => "/import",
                    _ => orderId.HasValue
                        ? "/import/orders/" + orderId.Value +
                          (x.Category is "logistics" or "tracking" or "documents"
                            ? "?mode=file" : "")
                        : "/import/operations"
                }
            };
        }).ToArray();
        return Results.Ok(new { page = currentPage, pageSize = take,
            total, items, hasMore = (long)currentPage * take < total });
    }

    private static string Title(string category, string action) =>
        (category, action) switch
        {
            ("orders", "Created") => "إنشاء طلب شراء",
            ("orders", "Updated") => "تعديل طلب شراء",
            ("orders", "DraftDeleted") => "حذف مسودة طلب",
            ("finance", "ScheduleCreated") => "إضافة استحقاق مالي",
            ("finance", "TransferRecorded") => "تسجيل حوالة مالية",
            ("finance", "ExpenseRecorded") => "إضافة مصروف",
            ("finance", "ExpenseSettled") => "تسوية مصروف",
            ("finance", "ClosedException") => "إغلاق طلب مع فرق محاسبي",
            ("finance", "Cancelled") => "إلغاء طلب شراء",
            ("finance", "TransferVoided") => "إلغاء حوالة",
            ("finance", "TransferReplaced") => "تصحيح حوالة",
            ("finance", "ReturnRecorded") => "تسجيل استرداد",
            ("logistics", "Shipment:Created") => "إضافة بوليصة شحن",
            ("logistics", "Shipment:Updated") => "تحديث بوليصة شحن",
            ("logistics", "Container:Created") => "إضافة حاوية",
            ("logistics", "Container:Updated") => "تحديث حالة حاوية",
            ("logistics", "Container:DraftDeleted") => "حذف مسودة حاوية",
            ("logistics", "Customs:Created") => "فتح ملف تخليص جمركي",
            ("logistics", "Customs:Updated") => "تحديث التخليص الجمركي",
            ("documents", "Uploaded") => "رفع مستند",
            ("documents", "Linked") => "ربط مستند بعملية",
            ("documents", "Unlinked") => "إلغاء ربط مستند",
            ("documents", "SoftDeleted") => "حذف مستند",
            ("companies", "Created") => "إضافة جهة تجارية",
            ("companies", "LegacyCreated") => "إضافة جهة تجارية (سجل سابق)",
            ("companies", "Updated") => "تعديل بيانات جهة تجارية",
            ("companies", "Deleted") => "حذف جهة تجارية",
            ("tracking", "Registered") => "تسجيل مرجع تتبع",
            ("tracking", "LastSynced") => "آخر تحديث للتتبع",
            ("security", "CanManagePayments") => "تعديل صلاحيات الدفوعات",
            ("security", "UserActive") => "تغيير حالة حساب موظف",
            _ => category switch
            {
                "orders" => "نشاط على طلبات الشراء",
                "finance" => "عملية مالية موثّقة",
                "logistics" => "تحديث موثّق في الشحن",
                "documents" => "نشاط على المستندات",
                "security" => "تغيير في صلاحيات الفريق",
                "subscription" => "تحديث في الاشتراك",
                "tracking" => "نشاط التتبع",
                "companies" => "نشاط الجهات التجارية",
                _ => "نشاط داخل الشركة"
            }
        };
}
