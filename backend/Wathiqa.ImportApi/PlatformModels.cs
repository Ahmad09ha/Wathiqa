using Microsoft.AspNetCore.Identity;

namespace Wathiqa.ImportApi;

/// <summary>
/// Separate identity root. Not an ImportUser, has no TenantId, and is never
/// treated as a merchant Admin. Only the platform cookie authenticates it.
/// </summary>
public sealed class PlatformOperator
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = "SuperAdmin";
    public bool IsActive { get; set; } = true;
    public string SecurityStamp { get; set; } = Guid.NewGuid().ToString("N");
    public int FailedSignInCount { get; set; }
    public DateTime? LockoutUntilUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? LastSignInAtUtc { get; set; }
}

/// <summary>Immutable application-level evidence for privileged changes.</summary>
public sealed class PlatformAudit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OperatorId { get; set; }
    public Guid? TenantId { get; set; }
    public Guid? TargetUserId { get; set; }
    public string Action { get; set; } = "";
    public string Reason { get; set; } = "";
    public string BeforeJson { get; set; } = "";
    public string AfterJson { get; set; } = "";
    public DateTime OccurredAtUtc { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Price-free subscription catalogue. The lifetime is immutable: a changed
/// offering is represented by a new plan, preserving historical semantics.
/// Null duration means unlimited access, NOT a payment or renewal condition.
/// </summary>
public sealed class PlatformSubscriptionPlan
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public int? DurationMonths { get; set; }
    // Maximum distinct B/Ls activated per assigned/renewed subscription cycle.
    public int MaxTrackedBills { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// One currently assigned manual subscription per tenant. The authoritative
/// authorization deadline remains Tenant.AccessExpiresAtUtc, updated in the
/// same transaction as this record and the platform audit.
/// </summary>
public sealed class TenantSubscription
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;
    public Guid PlanId { get; set; }
    public PlatformSubscriptionPlan Plan { get; set; } = null!;
    public DateTime StartedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? ExpiresAtUtc { get; set; }
    public DateTime? EndedAtUtc { get; set; }
    public DateTime LastChangedAtUtc { get; set; } = DateTime.UtcNow;
    public Guid TrackingCycleId { get; set; } = Guid.NewGuid();
}

/// <summary>
/// Durable per-B/L tracking activation ledger. Rows are never deleted on
/// failures with an ambiguous provider outcome, preventing paid POST replays.
/// </summary>
public sealed class SubscriptionTrackingUsage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid TrackingCycleId { get; set; }
    public Guid ShipmentId { get; set; }
    public string BlNumber { get; set; } = "";
    public string ProviderRequestId { get; set; } = "";
    public string State { get; set; } = "Reserved";
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}
