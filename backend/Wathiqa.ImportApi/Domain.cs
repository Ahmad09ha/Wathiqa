using Microsoft.AspNetCore.Identity;

namespace Wathiqa.ImportApi;

public sealed class Tenant
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    // Null means no automatic expiry. Non-null is a durable, absolute UTC
    // entitlement deadline: redeployments and logins must never renew it.
    public DateTime? AccessExpiresAtUtc { get; set; }
    // Platform-only optimistic revision. Tenant business actions do not edit it.
    public int PlatformRevision { get; set; } = 1;
}

public sealed class ImportUser : IdentityUser<Guid>
{
    public Guid TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;
    public string DisplayName { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public bool CanManagePayments { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class TenantInvitation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;
    public Guid CreatedById { get; set; }
    public string Email { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public string Role { get; set; } = "Staff";
    public DateTime ExpiresAtUtc { get; set; }
    public DateTime? UsedAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class TenantCompany
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;
    public string Name { get; set; } = "";
    public string Type { get; set; } = "Supplier";
    // Non-financial trading-party profile. Supplier banking instructions
    // are intentionally excluded until their read/write trust policy exists.
    public string NameEn { get; set; } = "";
    public string Country { get; set; } = "";
    public string City { get; set; } = "";
    public string Address { get; set; } = "";
    public string ContactName { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Email { get; set; } = "";
    public string TaxNo { get; set; } = "";
    public string DefaultCurrency { get; set; } = "";
    public string Notes { get; set; } = "";
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
}

public sealed class SecurityAudit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid ActorId { get; set; }
    public Guid TargetUserId { get; set; }
    public string Action { get; set; } = "";
    public string PreviousValue { get; set; } = "";
    public string NewValue { get; set; } = "";
    public DateTime OccurredAtUtc { get; set; } = DateTime.UtcNow;
}
