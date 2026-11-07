using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Wathiqa.ImportApi;

public enum TenantPermission { Member, Admin, ManagePayments }
public sealed record TenantRequirement(TenantPermission Permission) : IAuthorizationRequirement;

public static class TenantAccess
{
    public static bool Allowed(Tenant tenant, DateTime nowUtc) =>
        tenant.IsActive &&
        (tenant.AccessExpiresAtUtc is null || tenant.AccessExpiresAtUtc.Value > nowUtc);
}

// Live user + tenant + role/permission verification on EVERY protected request.
// Cached role/permission claims cannot grant access after revocation.
public sealed class TenantAccessHandler(ImportDb db, UserManager<ImportUser> users)
    : AuthorizationHandler<TenantRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, TenantRequirement requirement)
    {
        var idText = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        var tenantText = context.User.FindFirstValue("tenant_id");
        if (!Guid.TryParse(idText, out var userId) || !Guid.TryParse(tenantText, out var tenantId))
            return;

        var user = await db.Users.AsNoTracking().Include(u => u.Tenant)
            .SingleOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);
        if (user is null || !user.IsActive || !TenantAccess.Allowed(user.Tenant, DateTime.UtcNow)) return;

        var authorized = requirement.Permission switch
        {
            TenantPermission.Member => true,
            TenantPermission.Admin => await users.IsInRoleAsync(user, "Admin"),
            TenantPermission.ManagePayments => user.CanManagePayments || await users.IsInRoleAsync(user, "Admin"),
            _ => false
        };
        if (authorized) context.Succeed(requirement);
    }
}

public sealed class TenantClaimsFactory(
    UserManager<ImportUser> userManager,
    RoleManager<IdentityRole<Guid>> roleManager,
    IOptions<IdentityOptions> options)
    : UserClaimsPrincipalFactory<ImportUser, IdentityRole<Guid>>(userManager, roleManager, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(ImportUser user)
    {
        var claims = await base.GenerateClaimsAsync(user);
        claims.AddClaim(new Claim("tenant_id", user.TenantId.ToString("D")));
        return claims;
    }
}

public static class CurrentTenant
{
    public static Guid Id(ClaimsPrincipal principal)
    {
        if (!Guid.TryParse(principal.FindFirstValue("tenant_id"), out var tenantId) || tenantId == Guid.Empty)
            throw new UnauthorizedAccessException("No authenticated tenant");
        return tenantId;
    }
    public static Guid UserId(ClaimsPrincipal principal)
    {
        if (!Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id))
            throw new UnauthorizedAccessException("No authenticated user");
        return id;
    }
}
