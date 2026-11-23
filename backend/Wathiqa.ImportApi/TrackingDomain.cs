using System.Text.Json;

namespace Wathiqa.ImportApi;

/// <summary>
/// Per-tenant link to a tracking provider. A shipment (B/L) may have many
/// containers and many tracking references. Data stays informational; it
/// never directly mutates purchasing, customs or financial status.
/// </summary>
public sealed class ShipmentTrackingReference
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid ShipmentId { get; set; }
    public ImportShipment Shipment { get; set; } = null!;
    public string ReferenceType { get; set; } = "BL";
    public string ReferenceNumber { get; set; } = "";
    public string CarrierCode { get; set; } = "";
    public string ProviderStatus { get; set; } = "NotSynced";
    public string SnapshotJson { get; set; } = "{}";
    public DateTime? LastSyncedAtUtc { get; set; }
    public DateTime? LastAttemptAtUtc { get; set; }
    public string LastErrorCode { get; set; } = "";
    public Guid CreatedById { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public Guid UpdatedById { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed record TrackingEvent(
    string ContainerNumber, string Description, string EventCode,
    string Location, string Date, bool Actual, string Vessel, string Voyage);

public sealed record TrackedContainer(
    string Number, string Status, int? Size, string? Type,
    IReadOnlyList<TrackingEvent> Events);

public sealed record TrackingSnapshot(
    string Status, string CarrierName, string CarrierCode, string Vessel,
    string Voyage, string? Etd, string? Eta, string? ActualArrival,
    double? Latitude, double? Longitude, string? PositionUpdatedAt,
    string? ProviderUpdatedAt, IReadOnlyList<TrackingEvent> Events,
    string? BookingNumber = null, string? ContainerNumber = null,
    string? PortOfLoading = null, string? PortOfLoadingCode = null,
    string? PortOfDischarge = null, string? PortOfDischargeCode = null,
    string? EtdInitial = null, string? EtaInitial = null, string? EtaPredicted = null,
    int? TransitTimeDays = null, int? TransitPercentage = null,
    int? TransshipmentCount = null, double? Co2Tons = null,
    int? ContainerCount = null, string? ProviderCheckedAt = null,
    string? MapUrl = null, IReadOnlyList<TrackedContainer>? Containers = null);
