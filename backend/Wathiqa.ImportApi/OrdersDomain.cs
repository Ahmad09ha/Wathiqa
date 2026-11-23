namespace Wathiqa.ImportApi;

// Separate relational business tables; NOT part of legacy Template/Document JSON.
public sealed class PurchaseOrder
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;
    public string Number { get; set; } = "";
    public int NumberYear { get; set; }
    public Guid SupplierId { get; set; }
    public TenantCompany Supplier { get; set; } = null!;
    public string SupplierNameSnapshot { get; set; } = "";
    public Guid? CustomerId { get; set; }
    public TenantCompany? Customer { get; set; }
    public string? CustomerNameSnapshot { get; set; }
    public string SupplierRef { get; set; } = "";
    public string ProformaInvoiceNumber { get; set; } = "";
    public string ContractNumber { get; set; } = "";
    public DateOnly? ContractDate { get; set; }
    public DateOnly OrderDate { get; set; }
    public string Incoterm { get; set; } = "FOB";
    public string LoadingPort { get; set; } = "";
    public string DischargePort { get; set; } = "";
    public string Currency { get; set; } = "USD";
    public string Notes { get; set; } = "";
    public decimal TotalAmount { get; set; }
    public decimal PaidAmount { get; set; }
    public string PaymentStatus { get; set; } = "Unpaid";
    public string ArrivalStatus { get; set; } = "NotShipped";
    public string ClearanceStatus { get; set; } = "NotStarted";
    public string Status { get; set; } = "Draft";
    public string? ClosureReason { get; set; }
    public Guid? ClosedById { get; set; }
    public DateTime? ClosedAtUtc { get; set; }
    public bool ClosedWithExceptions { get; set; }
    public int ContainerCount { get; set; }
    public int DeliveredContainerCount { get; set; }
    public int Revision { get; set; } = 1;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public Guid CreatedById { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public Guid UpdatedById { get; set; }
    public bool IsDeleted { get; set; }
    public List<PurchaseOrderItem> Items { get; set; } = [];
}

public sealed class PurchaseOrderItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public PurchaseOrder Order { get; set; } = null!;
    public int Position { get; set; }
    public string ProductType { get; set; } = "";
    public string Brand { get; set; } = "";
    public string Denier { get; set; } = "";
    public string Luster { get; set; } = "";
    public string Grade { get; set; } = "";
    public string ColorType { get; set; } = "";
    public decimal QuantityKg { get; set; }
    public decimal UnitPrice { get; set; }
    public string PriceUnit { get; set; } = "KG";
    public decimal LineTotal { get; set; }
    public string HsCode { get; set; } = "";
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public Guid CreatedById { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public Guid UpdatedById { get; set; }
}

public sealed class OrderNumberSequence
{
    public Guid TenantId { get; set; }
    public int Year { get; set; }
    public int LastNumber { get; set; }
}

public sealed class OrderAudit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public string Action { get; set; } = "";
    public Guid ActorId { get; set; }
    public DateTime OccurredAtUtc { get; set; } = DateTime.UtcNow;
    public int PreviousRevision { get; set; }
    public int NewRevision { get; set; }
    public string BeforeJson { get; set; } = "";
    public string AfterJson { get; set; } = "";
}
