namespace Wathiqa.ImportApi;

// WP-06: one Bill of Lading belongs to exactly one purchase order.
// No free-standing shipment or cross-order B/L sharing.
public sealed class ImportShipment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public PurchaseOrder Order { get; set; } = null!;
    public string BlNumber { get; set; } = "";
    public string BlType { get; set; } = "Original";
    public string BlOriginalStatus { get; set; } = "NotReceived";
    public Guid? ShippingLineId { get; set; }
    public TenantCompany? ShippingLine { get; set; }
    public string? ShippingLineSnapshot { get; set; }
    public string Vessel { get; set; } = "";
    public string Voyage { get; set; } = "";
    public string Shipper { get; set; } = "";
    public string Consignee { get; set; } = "";
    public string NotifyParty { get; set; } = "";
    public DateOnly? ShippedOnBoardDate { get; set; }
    public DateOnly? OriginalReceivedDate { get; set; }
    public int? PackageCount { get; set; }
    public int? PalletCount { get; set; }
    public string PortOfLoading { get; set; } = "";
    public string PortOfDischarge { get; set; } = "";
    public DateOnly? Etd { get; set; }
    public DateOnly? Eta { get; set; }
    public int FreeTimeDays { get; set; }
    public string TrackingUrl { get; set; } = "";
    public int Revision { get; set; } = 1;
    public bool IsDeleted { get; set; }
    public Guid CreatedById { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public Guid UpdatedById { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public List<ImportContainer> Containers { get; set; } = [];
    public ImportCustomsClearance? Clearance { get; set; }
}

public sealed class ImportContainer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid ShipmentId { get; set; }
    public ImportShipment Shipment { get; set; } = null!;
    public string Number { get; set; } = "";
    public string Size { get; set; } = "40";
    public string SealNumber { get; set; } = "";
    public decimal? GrossWeightKg { get; set; }
    public decimal? NetWeightKg { get; set; }
    public string Status { get; set; } = "Planned";
    public bool CheckDigitValid { get; set; }
    public bool InvalidDigitAcknowledged { get; set; }
    public DateOnly? ArrivedAtPortDate { get; set; }
    public DateOnly? DeliveredDate { get; set; }
    public DateOnly? FreeTimeEndDate { get; set; }
    public int Revision { get; set; } = 1;
    public bool IsDeleted { get; set; }
    public Guid CreatedById { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public Guid UpdatedById { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class ImportCustomsClearance
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid ShipmentId { get; set; }
    public ImportShipment Shipment { get; set; } = null!;
    public Guid? BrokerId { get; set; }
    public TenantCompany? Broker { get; set; }
    public string? BrokerSnapshot { get; set; }
    public string DeclarationNumber { get; set; } = "";
    public DateOnly? SubmittedDate { get; set; }
    public DateOnly? ReleasedDate { get; set; }
    public string Status { get; set; } = "NotStarted";
    public string Notes { get; set; } = "";
    // Customs amounts are informational declarations in ChargesCurrency.
    // They are NOT posted to the audited order payment/expense ledger.
    public string ChargesCurrency { get; set; } = "USD";
    public decimal? CustomsValue { get; set; }
    public decimal? DutyRatePercent { get; set; }
    public decimal? CustomsDutyAmount { get; set; }
    public decimal? TaxAmount { get; set; }
    public decimal? AdditionalFees { get; set; }
    public decimal? BrokerFees { get; set; }
    public decimal? InlandTransportFees { get; set; }
    public decimal? DemurrageFees { get; set; }
    public decimal? DetentionFees { get; set; }
    public DateOnly? DeliveredToWarehouseDate { get; set; }
    public int Revision { get; set; } = 1;
    public Guid CreatedById { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public Guid UpdatedById { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class ImportLogisticsAudit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid OrderId { get; set; }
    public Guid ShipmentId { get; set; }
    public string EntityType { get; set; } = "";
    public Guid EntityId { get; set; }
    public string Action { get; set; } = "";
    public Guid ActorId { get; set; }
    public DateTime OccurredAtUtc { get; set; } = DateTime.UtcNow;
    public string BeforeJson { get; set; } = "";
    public string AfterJson { get; set; } = "";
}
