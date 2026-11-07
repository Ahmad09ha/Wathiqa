namespace Wathiqa.ImportApi;

// WP-07: one immutable private blob, with any number of tenant-scoped links.
// StoredDocument is independent of the legacy editor's Document table.
public sealed class StoredDocument
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Type { get; set; } = "Other";
    public string OriginalFileName { get; set; } = "";
    public string StorageKey { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long SizeBytes { get; set; }
    public string Sha256 { get; set; } = "";
    // Old unverified blobs migrate as Unscanned and cannot be downloaded in
    // Production. New production uploads must be Clean before becoming live.
    public string ScanStatus { get; set; } = "Unscanned";
    public string Notes { get; set; } = "";
    public Guid UploadedById { get; set; }
    public DateTime UploadedAtUtc { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAtUtc { get; set; }
    public Guid? DeletedById { get; set; }
    public List<StoredDocumentLink> Links { get; set; } = [];
}
public sealed class StoredDocumentLink
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid DocumentId { get; set; }
    public StoredDocument Document { get; set; } = null!;
    public Guid? OrderId { get; set; }
    public PurchaseOrder? Order { get; set; }
    public Guid? ShipmentId { get; set; }
    public ImportShipment? Shipment { get; set; }
    public Guid? ContainerId { get; set; }
    public ImportContainer? Container { get; set; }
    public Guid LinkedById { get; set; }
    public DateTime LinkedAtUtc { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
    public Guid? UnlinkedById { get; set; }
    public DateTime? UnlinkedAtUtc { get; set; }
}
public sealed class StoredDocumentAudit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid ActorId { get; set; }
    public DateTime OccurredAtUtc { get; set; } = DateTime.UtcNow;
    public string Action { get; set; } = "";
    public string DetailsJson { get; set; } = "";
}
// Rules are opt-in by Admin; no assumed globally required file types.
public sealed class DocumentRequirementRule
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string TargetType { get; set; } = "Shipment";
    public string Stage { get; set; } = "Any";
    public string DocumentType { get; set; } = "BillOfLading";
    public bool IsRequired { get; set; }
    public Guid UpdatedById { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
public sealed class DocumentRequirementWaiver
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid RequirementId { get; set; }
    public DocumentRequirementRule Requirement { get; set; } = null!;
    public Guid? OrderId { get; set; }
    public PurchaseOrder? Order { get; set; }
    public Guid? ShipmentId { get; set; }
    public ImportShipment? Shipment { get; set; }
    public Guid? ContainerId { get; set; }
    public ImportContainer? Container { get; set; }
    public string Reason { get; set; } = "";
    public Guid ApprovedById { get; set; }
    public DateTime ApprovedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? RevokedAtUtc { get; set; }
    public Guid? RevokedById { get; set; }
}
