namespace Wathiqa.ImportApi;

// WP-05: all money belongs to ONE Tenant + Order + currency (Order.Currency).
// Historic transfers and allocations are never hard-deleted or reused as
// supplier-wide credit. Void-and-replace is distinct from real bank returns.
public sealed class PaymentSchedule
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public PurchaseOrder Order { get; set; } = null!;
    public string Kind { get; set; } = "Advance";
    public decimal Amount { get; set; }
    public DateOnly DueDate { get; set; }
    public string Notes { get; set; } = "";
    public Guid IdempotencyKey { get; set; }
    public string RequestHash { get; set; } = "";
    public Guid CreatedById { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class PaymentTransfer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public PurchaseOrder Order { get; set; } = null!;
    public Guid BeneficiaryCompanyId { get; set; }
    public TenantCompany BeneficiaryCompany { get; set; } = null!;
    public string BeneficiarySnapshot { get; set; } = "";
    public decimal Amount { get; set; }
    public DateOnly TransferDate { get; set; }
    public string Method { get; set; } = "BankTransfer";
    public string Reference { get; set; } = "";
    public string BankOrExchangeName { get; set; } = "";
    public Guid ProofDocumentId { get; set; }
    public StoredDocument ProofDocument { get; set; } = null!;
    public Guid IdempotencyKey { get; set; }
    public string RequestHash { get; set; } = "";
    public string State { get; set; } = "Active";
    public Guid? ReplacesTransferId { get; set; }
    public PaymentTransfer? ReplacesTransfer { get; set; }
    public string? VoidReason { get; set; }
    public Guid? VoidedById { get; set; }
    public DateTime? VoidedAtUtc { get; set; }
    public Guid CreatedById { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class OrderExpense
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public PurchaseOrder Order { get; set; } = null!;
    public Guid PayeeCompanyId { get; set; }
    public TenantCompany PayeeCompany { get; set; } = null!;
    public string PayeeSnapshot { get; set; } = "";
    public decimal Amount { get; set; }
    public string Category { get; set; } = "Other";
    public string Description { get; set; } = "";
    public Guid EvidenceDocumentId { get; set; }
    public StoredDocument EvidenceDocument { get; set; } = null!;
    public Guid IdempotencyKey { get; set; }
    public string RequestHash { get; set; } = "";
    public Guid CreatedById { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class PaymentAllocation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public PaymentTransfer Transfer { get; set; } = null!;
    public Guid TransferId { get; set; }
    public Guid? ExpenseId { get; set; }
    public OrderExpense? Expense { get; set; }
    // Commercial allocation has no ExpenseId; expense allocation MUST have one.
    public string Kind { get; set; } = "Commercial";
    public decimal Amount { get; set; }
    public Guid IdempotencyKey { get; set; }
    public string RequestHash { get; set; } = "";
    public Guid CreatedById { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class PaymentReturn
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public Guid TransferId { get; set; }
    public PaymentTransfer Transfer { get; set; } = null!;
    public decimal Amount { get; set; }
    public DateOnly ReturnDate { get; set; }
    public string BankReference { get; set; } = "";
    public string Reason { get; set; } = "";
    public Guid ProofDocumentId { get; set; }
    public StoredDocument ProofDocument { get; set; } = null!;
    public Guid IdempotencyKey { get; set; }
    public string RequestHash { get; set; } = "";
    public Guid CreatedById { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class PaymentAudit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public PurchaseOrder Order { get; set; } = null!;
    public Guid ActorId { get; set; }
    public string Action { get; set; } = "";
    public Guid EntityId { get; set; }
    public string Reason { get; set; } = "";
    public string BeforeJson { get; set; } = "";
    public string AfterJson { get; set; } = "";
    public DateTime OccurredAtUtc { get; set; } = DateTime.UtcNow;
}
