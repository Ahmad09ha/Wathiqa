using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Wathiqa.ImportApi;

public sealed record ManualPlanCreateInput(string? Code, string? Name,
    int? DurationMonths, string? Reason, int MaxTrackedBills = 0);
public sealed record ManualPlanActiveInput(bool IsActive, string? Reason);
public sealed record ManualSubscriptionAssignInput(Guid PlanId, int Revision, string? Reason);
public sealed record ManualSubscriptionActionInput(int Revision, string? Reason);

/// <summary>
/// Price-free, human-operated subscriptions. NO invoice, payment, receipt,
/// transaction, checkout, gateway, or money fields are owned by this module.
/// Merchant purchase-order finance is a completely different tenant domain.
/// </summary>
public static class ManualSubscriptionsApi
{
    public static void Map(WebApplication app)
    {
        var group = app.MapGroup("/api/platform")
            .RequireAuthorization(PlatformSecurity.Policy);
        group.MapGet("/plans", ListPlans);
        group.MapPost("/plans", CreatePlan);
        group.MapPost("/plans/{planId:guid}/active", ChangePlanActive);
        group.MapGet("/subscriptions", ListSubscriptions);
        group.MapGet("/tenants/{tenantId:guid}/subscription", GetTenantSubscription);
        group.MapPost("/tenants/{tenantId:guid}/subscription/assign", Assign);
        group.MapPost("/tenants/{tenantId:guid}/subscription/renew", Renew);
        group.MapPost("/tenants/{tenantId:guid}/subscription/end", End);
    }

    private static async Task<IResult> ListPlans(ImportDb db)
    {
        try
        {
            var plans = await db.PlatformSubscriptionPlans.AsNoTracking()
                .OrderByDescending(x => x.IsActive).ThenBy(x => x.CreatedAtUtc)
                .ThenBy(x => x.Code)
                .Select(x => new
                {
                    x.Id, x.Code, x.Name, x.DurationMonths, x.MaxTrackedBills,
                    x.IsActive, x.CreatedAtUtc,
                    TenantCount = db.TenantSubscriptions.Count(s => s.PlanId == x.Id && s.EndedAtUtc == null)
                }).ToListAsync();
            return Results.Ok(plans);
        }
        catch (PostgresException ex) when (
            ex.SqlState == PostgresErrorCodes.UndefinedColumn &&
            ex.MessageText.Contains("MaxTrackedBills", StringComparison.Ordinal))
        {
            // An old production database must be upgraded, never silently
            // shown as an empty plan catalogue or initialized from the UI.
            return Results.Json(new { error = "platform_schema_upgrade_required" },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    private static async Task<IResult> CreatePlan(ManualPlanCreateInput input,
        ImportDb db, ClaimsPrincipal principal)
    {
        var code = input.Code?.Trim().ToLowerInvariant() ?? "";
        var name = input.Name?.Trim() ?? "";
        if (code.Length is < 3 or > 48 ||
            !Regex.IsMatch(code, "^[a-z0-9][a-z0-9-]*$") ||
            name.Length is < 2 or > 120 ||
            input.DurationMonths is not null and not (>= 1 and <= 36) ||
            input.MaxTrackedBills is < 0 or > 100000 ||
            !ReasonOk(input.Reason))
            return Results.BadRequest(new { error = "invalid_manual_plan" });
        if (await db.PlatformSubscriptionPlans.AnyAsync(x => x.Code == code))
            return Results.Conflict(new { error = "manual_plan_code_taken" });

        var plan = new PlatformSubscriptionPlan
        {
            Code = code, Name = name, DurationMonths = input.DurationMonths,
            MaxTrackedBills = input.MaxTrackedBills
        };
        db.PlatformSubscriptionPlans.Add(plan);
        Audit(db, principal, null, "ManualPlanCreated", input.Reason!, null,
            new { plan.Id, plan.Code, plan.Name, plan.DurationMonths,
                plan.MaxTrackedBills, plan.IsActive });
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException
            { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Results.Conflict(new { error = "manual_plan_code_taken" });
        }
        return Results.Created($"/api/platform/plans/{plan.Id}",
            new { plan.Id, plan.Code, plan.Name, plan.DurationMonths,
                plan.MaxTrackedBills, plan.IsActive });
    }

    private static async Task<IResult> ChangePlanActive(Guid planId,
        ManualPlanActiveInput input, ImportDb db, ClaimsPrincipal principal)
    {
        if (!ReasonOk(input.Reason)) return Results.BadRequest(new { error = "reason_required" });
        await using var tx = await db.Database.BeginTransactionAsync();
        var plan = await db.PlatformSubscriptionPlans.FromSqlInterpolated(
            $"SELECT * FROM \"PlatformSubscriptionPlans\" WHERE \"Id\"={planId} FOR UPDATE")
            .SingleOrDefaultAsync();
        if (plan is null) return Results.NotFound();
        if (plan.IsActive == input.IsActive)
            return Results.Conflict(new { error = "manual_plan_unchanged" });
        var before = new { plan.IsActive };
        plan.IsActive = input.IsActive;
        Audit(db, principal, null, "ManualPlanActiveChanged", input.Reason!, before,
            new { plan.Id, plan.Code, plan.IsActive });
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Results.Ok(new { plan.Id, plan.IsActive });
    }

    private static async Task<IResult> ListSubscriptions(ImportDb db, string? q,
        int? page, int? pageSize)
    {
        if (!PageOk(page, pageSize)) return Results.BadRequest(new { error = "invalid_pagination" });
        var term = q?.Trim() ?? "";
        if (term.Length > 120) return Results.BadRequest(new { error = "invalid_filter" });
        var tenants = db.Tenants.AsNoTracking();
        if (term.Length > 0) tenants = tenants.Where(t =>
            EF.Functions.ILike(t.Name, "%" + term + "%") ||
            EF.Functions.ILike(t.Slug, "%" + term + "%"));
        var total = await tenants.CountAsync();
        var rows = await tenants.OrderByDescending(x => x.CreatedAtUtc).ThenBy(x => x.Id)
            .Skip(((page ?? 1) - 1) * (pageSize ?? 20)).Take(pageSize ?? 20)
            .Select(t => new
            {
                t.Id, t.Name, t.Slug, t.IsActive, t.AccessExpiresAtUtc,
                t.PlatformRevision
            }).ToListAsync();
        var ids = rows.Select(x => x.Id).ToArray();
        var subs = await db.TenantSubscriptions.AsNoTracking()
            .Where(s => ids.Contains(s.TenantId))
            .Select(s => new
            {
                s.TenantId, s.PlanId, PlanName = s.Plan.Name,
                PlanCode = s.Plan.Code, s.Plan.DurationMonths, s.Plan.MaxTrackedBills,
                s.StartedAtUtc, s.ExpiresAtUtc, s.EndedAtUtc, s.LastChangedAtUtc
            }).ToDictionaryAsync(x => x.TenantId);
        var items = rows.Select(t =>
        {
            subs.TryGetValue(t.Id, out var sub);
            return new
            {
                TenantId = t.Id, TenantName = t.Name, TenantSlug = t.Slug,
                t.IsActive, t.PlatformRevision, t.AccessExpiresAtUtc,
                HasSubscription = sub is not null,
                PlanId = sub?.PlanId, PlanName = sub?.PlanName,
                PlanCode = sub?.PlanCode, DurationMonths = sub?.DurationMonths,
                MaxTrackedBills = sub?.MaxTrackedBills,
                StartedAtUtc = sub?.StartedAtUtc, EndedAtUtc = sub?.EndedAtUtc,
                LastChangedAtUtc = sub?.LastChangedAtUtc
            };
        }).ToList();
        return Results.Ok(new { page = page ?? 1, pageSize = pageSize ?? 20, total, items });
    }

    private static async Task<IResult> GetTenantSubscription(Guid tenantId, ImportDb db)
    {
        var tenant = await db.Tenants.AsNoTracking().Where(t => t.Id == tenantId)
            .Select(t => new
            {
                t.Id, t.Name, t.IsActive, t.AccessExpiresAtUtc, t.PlatformRevision
            }).SingleOrDefaultAsync();
        if (tenant is null) return Results.NotFound();
        var subscription = await db.TenantSubscriptions.AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new
            {
                s.Id, s.PlanId, PlanName = s.Plan.Name,
                PlanCode = s.Plan.Code, s.Plan.DurationMonths, s.Plan.MaxTrackedBills,
                s.StartedAtUtc, s.ExpiresAtUtc, s.EndedAtUtc, s.LastChangedAtUtc
            }).SingleOrDefaultAsync();
        return Results.Ok(new
        {
            TenantId = tenant.Id, TenantName = tenant.Name, tenant.IsActive,
            tenant.AccessExpiresAtUtc, tenant.PlatformRevision,
            HasSubscription = subscription is not null,
            Subscription = subscription
        });
    }

    private static async Task<IResult> Assign(Guid tenantId,
        ManualSubscriptionAssignInput input, ImportDb db, ClaimsPrincipal principal)
    {
        if (input.PlanId == Guid.Empty || !ReasonOk(input.Reason))
            return Results.BadRequest(new { error = "invalid_manual_subscription" });
        await using var tx = await db.Database.BeginTransactionAsync();
        var tenant = await LockTenant(db, tenantId);
        if (tenant is null) return Results.NotFound();
        if (tenant.PlatformRevision != input.Revision)
            return Results.Conflict(new { error = "stale_platform_revision" });
        // Hold a shared row lock through assignment so concurrent plan
        // deactivation cannot slip between the availability check and commit.
        var plan = await LockPlanForRead(db, input.PlanId);
        if (plan is null || !plan.IsActive)
            return Results.BadRequest(new { error = "manual_plan_unavailable" });
        var existing = await db.TenantSubscriptions.SingleOrDefaultAsync(s => s.TenantId == tenantId);
        if (existing is { EndedAtUtc: null } && existing.PlanId == input.PlanId)
            return Results.Conflict(new { error = "manual_subscription_same_plan" });
        var before = Snapshot(tenant, existing);
        var now = DateTime.UtcNow;
        var expiry = plan.DurationMonths.HasValue ? now.AddMonths(plan.DurationMonths.Value) : (DateTime?)null;
        if (existing is null)
        {
            existing = new TenantSubscription { TenantId = tenantId };
            db.TenantSubscriptions.Add(existing);
        }
        existing.PlanId = plan.Id;
        existing.TrackingCycleId = Guid.NewGuid();
        existing.StartedAtUtc = now;
        existing.ExpiresAtUtc = expiry;
        existing.EndedAtUtc = null;
        existing.LastChangedAtUtc = now;
        tenant.AccessExpiresAtUtc = expiry;
        tenant.PlatformRevision++;
        Audit(db, principal, tenantId, "ManualSubscriptionAssigned", input.Reason!, before,
            new { PlanId = plan.Id, plan.Code, plan.Name, plan.DurationMonths,
                plan.MaxTrackedBills,
                existing.StartedAtUtc, existing.ExpiresAtUtc, existing.EndedAtUtc,
                tenant.PlatformRevision });
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Results.Ok(new
        {
            TenantId = tenant.Id, PlanId = plan.Id, plan.Name, existing.StartedAtUtc,
            existing.ExpiresAtUtc, existing.EndedAtUtc, tenant.PlatformRevision
        });
    }

    private static async Task<IResult> Renew(Guid tenantId,
        ManualSubscriptionActionInput input, ImportDb db, ClaimsPrincipal principal)
    {
        if (!ReasonOk(input.Reason)) return Results.BadRequest(new { error = "reason_required" });
        await using var tx = await db.Database.BeginTransactionAsync();
        var tenant = await LockTenant(db, tenantId);
        if (tenant is null) return Results.NotFound();
        if (tenant.PlatformRevision != input.Revision)
            return Results.Conflict(new { error = "stale_platform_revision" });
        var current = await db.TenantSubscriptions
            .SingleOrDefaultAsync(s => s.TenantId == tenantId);
        if (current is null || current.EndedAtUtc is not null)
            return Results.Conflict(new { error = "manual_subscription_not_renewable" });
        var plan = await LockPlanForRead(db, current.PlanId);
        if (plan is null || !plan.IsActive || plan.DurationMonths is null)
            return Results.Conflict(new { error = "manual_subscription_not_renewable" });
        var before = Snapshot(tenant, current);
        var now = DateTime.UtcNow;
        var start = current.ExpiresAtUtc > now ? current.ExpiresAtUtc.Value : now;
        var expiry = start.AddMonths(plan.DurationMonths.Value);
        current.ExpiresAtUtc = expiry;
        current.TrackingCycleId = Guid.NewGuid();
        current.LastChangedAtUtc = now;
        tenant.AccessExpiresAtUtc = expiry;
        tenant.PlatformRevision++;
        Audit(db, principal, tenantId, "ManualSubscriptionRenewed", input.Reason!, before,
            new { current.PlanId, current.ExpiresAtUtc, current.LastChangedAtUtc, tenant.PlatformRevision });
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Results.Ok(new { TenantId = tenant.Id, current.PlanId,
            current.ExpiresAtUtc, tenant.PlatformRevision });
    }

    private static async Task<IResult> End(Guid tenantId,
        ManualSubscriptionActionInput input, ImportDb db, ClaimsPrincipal principal)
    {
        if (!ReasonOk(input.Reason)) return Results.BadRequest(new { error = "reason_required" });
        await using var tx = await db.Database.BeginTransactionAsync();
        var tenant = await LockTenant(db, tenantId);
        if (tenant is null) return Results.NotFound();
        if (tenant.PlatformRevision != input.Revision)
            return Results.Conflict(new { error = "stale_platform_revision" });
        var current = await db.TenantSubscriptions.SingleOrDefaultAsync(s => s.TenantId == tenantId);
        if (current is null || current.EndedAtUtc is not null)
            return Results.Conflict(new { error = "manual_subscription_already_ended" });
        var before = Snapshot(tenant, current);
        var now = DateTime.UtcNow;
        current.EndedAtUtc = now;
        current.ExpiresAtUtc = now;
        current.LastChangedAtUtc = now;
        tenant.AccessExpiresAtUtc = now;
        tenant.PlatformRevision++;
        Audit(db, principal, tenantId, "ManualSubscriptionEnded", input.Reason!, before,
            new { current.PlanId, current.ExpiresAtUtc, current.EndedAtUtc, tenant.PlatformRevision });
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Results.Ok(new { TenantId = tenant.Id, current.EndedAtUtc,
            tenant.AccessExpiresAtUtc, tenant.PlatformRevision });
    }

    private static object Snapshot(Tenant tenant, TenantSubscription? sub) =>
        new { tenant.AccessExpiresAtUtc, tenant.PlatformRevision,
            PlanId = sub?.PlanId, sub?.StartedAtUtc, sub?.ExpiresAtUtc, sub?.EndedAtUtc };

    private static Task<Tenant?> LockTenant(ImportDb db, Guid tenantId) =>
        db.Tenants.FromSqlInterpolated(
            $"SELECT * FROM \"Tenants\" WHERE \"Id\"={tenantId} FOR UPDATE")
            .SingleOrDefaultAsync();

    private static Task<PlatformSubscriptionPlan?> LockPlanForRead(ImportDb db, Guid planId) =>
        db.PlatformSubscriptionPlans.FromSqlInterpolated(
            $"SELECT * FROM \"PlatformSubscriptionPlans\" WHERE \"Id\"={planId} FOR SHARE")
            .AsNoTracking().SingleOrDefaultAsync();

    private static bool ReasonOk(string? value) => value?.Trim().Length is >= 8 and <= 1000;
    private static bool PageOk(int? page, int? size) =>
        (page ?? 1) is >= 1 and <= 100000 && (size ?? 20) is >= 1 and <= 100;

    private static void Audit(ImportDb db, ClaimsPrincipal principal, Guid? tenantId,
        string action, string reason, object? before, object after)
    {
        db.PlatformAudits.Add(new PlatformAudit
        {
            OperatorId = PlatformSecurity.OperatorId(principal),
            TenantId = tenantId, Action = action, Reason = reason.Trim(),
            BeforeJson = JsonSerializer.Serialize(before),
            AfterJson = JsonSerializer.Serialize(after)
        });
    }
}
