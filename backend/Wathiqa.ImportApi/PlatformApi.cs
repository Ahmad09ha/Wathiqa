using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

public sealed record PlatformLoginInput(string? Email, string? Password);
public sealed record PlatformTenantCreateInput(string? Name, string? Slug,
    string? AdminEmail, string? AccessMode, DateTime? AccessExpiresAtUtc, string? Reason);
public sealed record PlatformTenantActiveInput(bool IsActive, int Revision, string? Reason);
public sealed record PlatformTenantAccessInput(string? AccessMode,
    DateTime? AccessExpiresAtUtc, int Revision, string? Reason);
public sealed record PlatformUserActiveInput(bool IsActive, string? Reason);

/// <summary>Separate, deny-by-default platform management boundary.</summary>
public static class PlatformApi
{
    public static void Map(WebApplication app)
    {
        app.MapPost("/api/platform/auth/login", Login)
            .AllowAnonymous().RequireRateLimiting("auth");
        var area = app.MapGroup("/api/platform")
            .RequireAuthorization(PlatformSecurity.Policy);
        area.MapGet("/auth/me", async (ClaimsPrincipal principal, ImportDb db) =>
        {
            var id = PlatformSecurity.OperatorId(principal);
            var actor = await db.PlatformOperators.AsNoTracking().SingleAsync(x => x.Id == id);
            return Results.Ok(new { actor.Id, actor.Email, actor.DisplayName, Role = PlatformSecurity.Role });
        });
        area.MapPost("/auth/logout", async (HttpContext context) =>
        {
            await context.SignOutAsync(PlatformSecurity.Scheme);
            return Results.NoContent();
        });
        area.MapGet("/overview", Overview);
        area.MapGet("/tenants", ListTenants);
        area.MapGet("/tenants/{tenantId:guid}", TenantDetails);
        area.MapGet("/tenants/{tenantId:guid}/users", TenantUsers);
        area.MapGet("/users", ListUsers);
        area.MapPost("/tenants", CreateTenant);
        area.MapPost("/tenants/{tenantId:guid}/active", ChangeTenantActive);
        area.MapPost("/tenants/{tenantId:guid}/access", ChangeTenantAccess);
        area.MapPost("/tenants/{tenantId:guid}/users/{userId:guid}/active", ChangeUserActive);
        area.MapGet("/audits", Audits);
    }

    private static async Task<IResult> Login(PlatformLoginInput input, ImportDb db,
        IPasswordHasher<PlatformOperator> hasher, HttpContext context)
    {
        var email = input.Email?.Trim().ToLowerInvariant() ?? "";
        if (email.Length is < 5 or > 254 || input.Password is null ||
            input.Password.Length is < 1 or > 256) return Results.Unauthorized();

        await using var tx = await db.Database.BeginTransactionAsync();
        var actor = await db.PlatformOperators.FromSqlInterpolated(
            $"SELECT * FROM \"PlatformOperators\" WHERE \"Email\"={email} FOR UPDATE")
            .SingleOrDefaultAsync();
        if (actor is null || !actor.IsActive || actor.Role != PlatformSecurity.Role)
            return Results.Unauthorized();
        var now = DateTime.UtcNow;
        if (actor.LockoutUntilUtc > now) return Results.Unauthorized();

        var valid = hasher.VerifyHashedPassword(actor, actor.PasswordHash, input.Password);
        if (valid == PasswordVerificationResult.Failed)
        {
            actor.FailedSignInCount++;
            if (actor.FailedSignInCount >= 6)
            {
                actor.FailedSignInCount = 0;
                actor.LockoutUntilUtc = now.AddMinutes(15);
                Audit(db, actor.Id, null, null, "SuperAdminLockout", "Invalid login attempts",
                    null, new { actor.LockoutUntilUtc });
            }
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Results.Unauthorized();
        }
        actor.FailedSignInCount = 0;
        actor.LockoutUntilUtc = null;
        actor.LastSignInAtUtc = now;
        if (valid == PasswordVerificationResult.SuccessRehashNeeded)
            actor.PasswordHash = hasher.HashPassword(actor, input.Password);
        await db.SaveChangesAsync();
        await tx.CommitAsync();

        await context.SignInAsync(PlatformSecurity.Scheme,
            PlatformSecurity.Principal(actor), new AuthenticationProperties { IsPersistent = false });
        context.Response.Headers.CacheControl = "no-store";
        return Results.Ok(new { role = PlatformSecurity.Role, actor.DisplayName });
    }

    private static async Task<IResult> Overview(ImportDb db)
    {
        var now = DateTime.UtcNow;
        var totalTenants = await db.Tenants.CountAsync();
        var suspended = await db.Tenants.CountAsync(x => !x.IsActive);
        var expired = await db.Tenants.CountAsync(x => x.IsActive &&
            x.AccessExpiresAtUtc != null && x.AccessExpiresAtUtc <= now);
        var active = totalTenants - suspended - expired;
        var accounts = await db.Users.CountAsync();
        return Results.Ok(new { totalTenants, active, suspended, expired, accounts });
    }

    private static async Task<IResult> ListTenants(ImportDb db, string? q, string? status,
        int? page, int? pageSize)
    {
        if (!PageOk(page, pageSize)) return Results.BadRequest(new { error = "invalid_pagination" });
        var term = q?.Trim() ?? "";
        if (term.Length > 120) return Results.BadRequest(new { error = "invalid_filter" });
        if (!string.IsNullOrEmpty(status) && status is not ("active" or "suspended" or "expired"))
            return Results.BadRequest(new { error = "invalid_filter" });
        var now = DateTime.UtcNow;
        var query = db.Tenants.AsNoTracking().AsQueryable();
        if (term.Length > 0) query = query.Where(x =>
            EF.Functions.ILike(x.Name, "%" + term + "%") ||
            EF.Functions.ILike(x.Slug, "%" + term + "%"));
        query = status switch
        {
            "active" => query.Where(x => x.IsActive &&
                (x.AccessExpiresAtUtc == null || x.AccessExpiresAtUtc > now)),
            "suspended" => query.Where(x => !x.IsActive),
            "expired" => query.Where(x => x.IsActive && x.AccessExpiresAtUtc <= now),
            _ => query
        };
        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(x => x.CreatedAtUtc).ThenBy(x => x.Id)
            .Skip(((page ?? 1) - 1) * (pageSize ?? 20)).Take(pageSize ?? 20)
            .Select(x => new
            {
                x.Id, x.Name, x.Slug, x.IsActive, x.AccessExpiresAtUtc, x.CreatedAtUtc,
                x.PlatformRevision,
                UserCount = db.Users.Count(u => u.TenantId == x.Id)
            }).ToListAsync();
        return Results.Ok(new { page = page ?? 1, pageSize = pageSize ?? 20, total, items = rows });
    }

    private static async Task<IResult> TenantDetails(Guid tenantId, ImportDb db)
    {
        var tenant = await db.Tenants.AsNoTracking().Where(x => x.Id == tenantId)
            .Select(x => new
            {
                x.Id, x.Slug, x.Name, x.IsActive, x.AccessExpiresAtUtc, x.CreatedAtUtc,
                x.PlatformRevision, UserCount = db.Users.Count(u => u.TenantId == x.Id)
            }).SingleOrDefaultAsync();
        return tenant is null ? Results.NotFound() : Results.Ok(tenant);
    }

    private static async Task<IResult> TenantUsers(Guid tenantId, ImportDb db,
        int? page, int? pageSize)
    {
        if (!PageOk(page, pageSize)) return Results.BadRequest(new { error = "invalid_pagination" });
        if (!await db.Tenants.AnyAsync(x => x.Id == tenantId)) return Results.NotFound();
        var adminRoleId = await db.Roles.Where(x => x.NormalizedName == "ADMIN")
            .Select(x => (Guid?)x.Id).SingleOrDefaultAsync();
        var users = db.Users.AsNoTracking().Where(u => u.TenantId == tenantId);
        var total = await users.CountAsync();
        var rows = await users.OrderBy(x => x.Email).ThenBy(x => x.Id)
            .Skip(((page ?? 1) - 1) * (pageSize ?? 20)).Take(pageSize ?? 20)
            .Select(x => new
            {
                x.Id, x.Email, x.DisplayName, x.IsActive, x.CanManagePayments, x.CreatedAtUtc,
                Role = db.UserRoles.Any(ur => ur.UserId == x.Id && ur.RoleId == adminRoleId)
                    ? "Admin" : "Staff"
            }).ToListAsync();
        return Results.Ok(new { page = page ?? 1, pageSize = pageSize ?? 20, total, items = rows });
    }

    private static async Task<IResult> ListUsers(ImportDb db, string? q, Guid? tenantId,
        int? page, int? pageSize)
    {
        if (!PageOk(page, pageSize)) return Results.BadRequest(new { error = "invalid_pagination" });
        var term = q?.Trim() ?? "";
        if (term.Length > 120) return Results.BadRequest(new { error = "invalid_filter" });
        var query = db.Users.AsNoTracking().AsQueryable();
        if (tenantId.HasValue) query = query.Where(x => x.TenantId == tenantId);
        if (term.Length > 0) query = query.Where(x =>
            EF.Functions.ILike(x.DisplayName, "%" + term + "%") ||
            EF.Functions.ILike(x.Email!, "%" + term + "%"));
        var adminRoleId = await db.Roles.Where(x => x.NormalizedName == "ADMIN")
            .Select(x => (Guid?)x.Id).SingleOrDefaultAsync();
        var total = await query.CountAsync();
        var rows = await query.OrderBy(x => x.Email).ThenBy(x => x.Id)
            .Skip(((page ?? 1) - 1) * (pageSize ?? 20)).Take(pageSize ?? 20)
            .Select(x => new { x.Id, x.Email, x.DisplayName, x.IsActive, x.CreatedAtUtc,
                x.TenantId, TenantName = x.Tenant.Name,
                x.CanManagePayments,
                Role = db.UserRoles.Any(ur => ur.UserId == x.Id && ur.RoleId == adminRoleId)
                    ? "Admin" : "Staff" }).ToListAsync();
        return Results.Ok(new { page = page ?? 1, pageSize = pageSize ?? 20, total, items = rows });
    }

    private static async Task<IResult> CreateTenant(PlatformTenantCreateInput input,
        ImportDb db, ClaimsPrincipal principal)
    {
        var name = input.Name?.Trim() ?? "";
        var slug = input.Slug?.Trim().ToLowerInvariant() ?? "";
        var email = input.AdminEmail?.Trim().ToLowerInvariant() ?? "";
        if (name.Length is < 2 or > 180 || slug.Length is < 3 or > 80 ||
            !Regex.IsMatch(slug, "^[a-z0-9][a-z0-9-]*$") ||
            email.Length is < 5 or > 254 || !new EmailAddressAttribute().IsValid(email) ||
            !ReasonOk(input.Reason) || !ValidEntitlement(input.AccessMode, input.AccessExpiresAtUtc))
            return Results.BadRequest(new { error = "invalid_tenant_onboarding" });
        if (await db.Users.AnyAsync(x => x.NormalizedEmail == email.ToUpperInvariant()) ||
            await db.PlatformOperators.AnyAsync(x => x.Email == email))
            return Results.Conflict(new { error = "email_already_registered" });

        await using var tx = await db.Database.BeginTransactionAsync();
        if (await db.Tenants.AnyAsync(x => x.Slug == slug))
            return Results.Conflict(new { error = "tenant_slug_taken" });
        var tenant = new Tenant { Name = name, Slug = slug,
            AccessExpiresAtUtc = input.AccessMode == "Unlimited" ? null : input.AccessExpiresAtUtc };
        db.Tenants.Add(tenant);
        var inviteToken = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        db.TenantInvitations.Add(new TenantInvitation
        {
            TenantId = tenant.Id, Email = email, Role = "Admin",
            CreatedById = PlatformSecurity.OperatorId(principal),
            TokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(inviteToken))),
            ExpiresAtUtc = DateTime.UtcNow.AddHours(48)
        });
        Audit(db, PlatformSecurity.OperatorId(principal), tenant.Id, null, "TenantCreated",
            input.Reason!.Trim(), null,
            new { tenant.Name, tenant.Slug, tenant.AccessExpiresAtUtc, InitialAdminEmail = email });
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Results.Created($"/api/platform/tenants/{tenant.Id}", new
        {
            tenant.Id, tenant.Name, tenant.Slug, tenant.PlatformRevision,
            invitationToken = inviteToken,
            invitationExpiresAtUtc = DateTime.UtcNow.AddHours(48)
        });
    }

    private static async Task<IResult> ChangeTenantActive(Guid tenantId,
        PlatformTenantActiveInput input, ImportDb db, ClaimsPrincipal principal)
    {
        if (!ReasonOk(input.Reason)) return Results.BadRequest(new { error = "reason_required" });
        await using var tx = await db.Database.BeginTransactionAsync();
        var tenant = await LockTenant(db, tenantId);
        if (tenant is null) return Results.NotFound();
        if (tenant.PlatformRevision != input.Revision)
            return Results.Conflict(new { error = "stale_platform_revision" });
        if (tenant.IsActive == input.IsActive)
            return Results.Conflict(new { error = "no_status_change" });
        var before = new { tenant.IsActive, tenant.AccessExpiresAtUtc };
        tenant.IsActive = input.IsActive;
        tenant.PlatformRevision++;
        Audit(db, PlatformSecurity.OperatorId(principal), tenantId, null, "TenantActiveChanged",
            input.Reason!.Trim(), before, new { tenant.IsActive, tenant.AccessExpiresAtUtc });
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Results.Ok(new { tenant.Id, tenant.IsActive, tenant.PlatformRevision });
    }

    private static async Task<IResult> ChangeTenantAccess(Guid tenantId,
        PlatformTenantAccessInput input, ImportDb db, ClaimsPrincipal principal)
    {
        if (!ReasonOk(input.Reason) ||
            !ValidEntitlement(input.AccessMode, input.AccessExpiresAtUtc))
            return Results.BadRequest(new { error = "invalid_access_change" });
        await using var tx = await db.Database.BeginTransactionAsync();
        var tenant = await LockTenant(db, tenantId);
        if (tenant is null) return Results.NotFound();
        if (tenant.PlatformRevision != input.Revision)
            return Results.Conflict(new { error = "stale_platform_revision" });
        if (await db.TenantSubscriptions.AnyAsync(s => s.TenantId == tenantId))
            return Results.Conflict(new { error = "subscription_managed" });
        var until = input.AccessMode == "Unlimited" ? (DateTime?)null : input.AccessExpiresAtUtc;
        if (tenant.AccessExpiresAtUtc == until)
            return Results.Conflict(new { error = "no_access_change" });
        var before = new { tenant.AccessExpiresAtUtc };
        tenant.AccessExpiresAtUtc = until;
        tenant.PlatformRevision++;
        Audit(db, PlatformSecurity.OperatorId(principal), tenantId, null, "TenantAccessChanged",
            input.Reason!.Trim(), before, new { tenant.AccessExpiresAtUtc });
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Results.Ok(new { tenant.Id, tenant.AccessExpiresAtUtc, tenant.PlatformRevision });
    }

    private static async Task<IResult> ChangeUserActive(Guid tenantId, Guid userId,
        PlatformUserActiveInput input, ImportDb db, ClaimsPrincipal principal)
    {
        if (!ReasonOk(input.Reason)) return Results.BadRequest(new { error = "reason_required" });
        await using var tx = await db.Database.BeginTransactionAsync();
        if (await LockTenant(db, tenantId) is null) return Results.NotFound();
        var user = await db.Users.SingleOrDefaultAsync(x => x.Id == userId && x.TenantId == tenantId);
        if (user is null) return Results.NotFound();
        if (user.IsActive == input.IsActive)
            return Results.Conflict(new { error = "no_status_change" });
        if (!input.IsActive)
        {
            var adminId = await db.Roles.Where(x => x.NormalizedName == "ADMIN")
                .Select(x => (Guid?)x.Id).SingleOrDefaultAsync();
            if (adminId.HasValue && await db.UserRoles.AnyAsync(x =>
                x.UserId == userId && x.RoleId == adminId.Value))
            {
                var admins = await db.Users.CountAsync(u => u.TenantId == tenantId && u.IsActive &&
                    db.UserRoles.Any(ur => ur.UserId == u.Id && ur.RoleId == adminId.Value));
                if (admins <= 1) return Results.Conflict(new { error = "cannot_disable_last_tenant_admin" });
            }
        }
        var before = new { user.IsActive };
        user.IsActive = input.IsActive;
        Audit(db, PlatformSecurity.OperatorId(principal), tenantId, userId, "TenantUserActiveChanged",
            input.Reason!.Trim(), before, new { user.IsActive });
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Results.Ok(new { user.Id, user.IsActive });
    }

    private static async Task<IResult> Audits(ImportDb db, Guid? tenantId,
        int? page, int? pageSize)
    {
        if (!PageOk(page, pageSize)) return Results.BadRequest(new { error = "invalid_pagination" });
        var query = db.PlatformAudits.AsNoTracking();
        if (tenantId.HasValue) query = query.Where(x => x.TenantId == tenantId);
        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(x => x.OccurredAtUtc).ThenByDescending(x => x.Id)
            .Skip(((page ?? 1) - 1) * (pageSize ?? 25)).Take(pageSize ?? 25)
            .Select(x => new { x.Id, x.OperatorId, x.TenantId, x.TargetUserId,
                x.Action, x.Reason, x.BeforeJson, x.AfterJson, x.OccurredAtUtc }).ToListAsync();
        return Results.Ok(new { page = page ?? 1, pageSize = pageSize ?? 25, total, items = rows });
    }

    private static Task<Tenant?> LockTenant(ImportDb db, Guid id) =>
        db.Tenants.FromSqlInterpolated(
            $"SELECT * FROM \"Tenants\" WHERE \"Id\"={id} FOR UPDATE")
            .SingleOrDefaultAsync();

    private static bool PageOk(int? page, int? take) =>
        (page ?? 1) is >= 1 and <= 100000 && (take ?? 20) is >= 1 and <= 100;

    private static bool ReasonOk(string? value) =>
        value?.Trim().Length is >= 8 and <= 1000;

    private static bool ValidEntitlement(string? mode, DateTime? until) =>
        mode == "Unlimited" && until is null ||
        mode == "Expires" && until.HasValue && until.Value.Kind == DateTimeKind.Utc &&
        until.Value > DateTime.UtcNow && until.Value < DateTime.UtcNow.AddYears(50);

    private static void Audit(ImportDb db, Guid operatorId, Guid? tenantId,
        Guid? userId, string action, string reason, object? before, object? after)
    {
        db.PlatformAudits.Add(new PlatformAudit
        {
            OperatorId = operatorId, TenantId = tenantId, TargetUserId = userId,
            Action = action, Reason = reason,
            BeforeJson = JsonSerializer.Serialize(before),
            AfterJson = JsonSerializer.Serialize(after)
        });
    }
}
