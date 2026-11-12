using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Wathiqa.ImportApi;

public sealed class ImportDb(DbContextOptions<ImportDb> options, IHttpContextAccessor accessor)
    : IdentityDbContext<ImportUser, IdentityRole<Guid>, Guid>(options)
{
    private readonly IHttpContextAccessor _accessor = accessor;

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<TenantInvitation> TenantInvitations => Set<TenantInvitation>();
    public DbSet<TenantCompany> Companies => Set<TenantCompany>();
    public DbSet<SecurityAudit> SecurityAudits => Set<SecurityAudit>();
    public DbSet<PurchaseOrder> Orders => Set<PurchaseOrder>();
    public DbSet<PurchaseOrderItem> OrderItems => Set<PurchaseOrderItem>();
    public DbSet<OrderNumberSequence> OrderNumberSequences => Set<OrderNumberSequence>();
    public DbSet<OrderAudit> OrderAudits => Set<OrderAudit>();
    public DbSet<ImportShipment> Shipments => Set<ImportShipment>();
    public DbSet<ImportContainer> Containers => Set<ImportContainer>();
    public DbSet<ImportCustomsClearance> CustomsClearances => Set<ImportCustomsClearance>();
    public DbSet<ImportLogisticsAudit> LogisticsAudits => Set<ImportLogisticsAudit>();
    public DbSet<ShipmentTrackingReference> TrackingReferences => Set<ShipmentTrackingReference>();
    public DbSet<StoredDocument> StoredDocuments => Set<StoredDocument>();
    public DbSet<StoredDocumentLink> StoredDocumentLinks => Set<StoredDocumentLink>();
    public DbSet<StoredDocumentAudit> StoredDocumentAudits => Set<StoredDocumentAudit>();
    public DbSet<DocumentRequirementRule> DocumentRequirementRules => Set<DocumentRequirementRule>();
    public DbSet<DocumentRequirementWaiver> DocumentRequirementWaivers => Set<DocumentRequirementWaiver>();
    public DbSet<PaymentSchedule> PaymentSchedules => Set<PaymentSchedule>();
    public DbSet<PaymentTransfer> PaymentTransfers => Set<PaymentTransfer>();
    public DbSet<PaymentAllocation> PaymentAllocations => Set<PaymentAllocation>();
    public DbSet<OrderExpense> OrderExpenses => Set<OrderExpense>();
    public DbSet<PaymentReturn> PaymentReturns => Set<PaymentReturn>();
    public DbSet<PaymentAudit> PaymentAudits => Set<PaymentAudit>();
    public DbSet<PlatformOperator> PlatformOperators => Set<PlatformOperator>();
    public DbSet<PlatformAudit> PlatformAudits => Set<PlatformAudit>();
    public DbSet<PlatformSubscriptionPlan> PlatformSubscriptionPlans => Set<PlatformSubscriptionPlan>();
    public DbSet<TenantSubscription> TenantSubscriptions => Set<TenantSubscription>();

    // Fail closed in requests without an authenticated tenant.
    public Guid CurrentTenantId
    {
        get
        {
            var claim = _accessor.HttpContext?.User.FindFirstValue("tenant_id");
            return Guid.TryParse(claim, out var id) ? id : Guid.Empty;
        }
    }

    protected override void OnModelCreating(ModelBuilder model)
    {
        base.OnModelCreating(model);
        model.Entity<PlatformOperator>(e =>
        {
            e.ToTable("PlatformOperators");
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.DisplayName).HasMaxLength(160);
            e.Property(x => x.PasswordHash).HasMaxLength(1024);
            e.Property(x => x.SecurityStamp).HasMaxLength(64);
            e.Property(x => x.Role).HasMaxLength(30);
            e.ToTable(t => t.HasCheckConstraint("CK_Platform_OnlySuperAdmin", "\"Role\" = 'SuperAdmin'"));
        });
        model.Entity<PlatformAudit>(e =>
        {
            e.ToTable("PlatformAudits");
            e.HasIndex(x => new { x.TenantId, x.OccurredAtUtc });
            e.HasIndex(x => new { x.OperatorId, x.OccurredAtUtc });
            e.Property(x => x.Action).HasMaxLength(100);
            e.Property(x => x.Reason).HasMaxLength(1000);
            e.HasOne<PlatformOperator>().WithMany().HasForeignKey(x => x.OperatorId)
                .OnDelete(DeleteBehavior.Restrict);
            // No FK to a tenant: audit survives lifecycle and cannot cascade.
        });
        model.Entity<PlatformSubscriptionPlan>(e =>
        {
            e.ToTable("PlatformSubscriptionPlans", t => t.HasCheckConstraint(
                "CK_PlatformPlan_Months", "\"DurationMonths\" IS NULL OR (\"DurationMonths\" BETWEEN 1 AND 36)"));
            e.HasIndex(x => x.Code).IsUnique();
            e.Property(x => x.Code).HasMaxLength(48);
            e.Property(x => x.Name).HasMaxLength(120);
        });
        model.Entity<TenantSubscription>(e =>
        {
            e.ToTable("TenantSubscriptions");
            e.HasIndex(x => x.TenantId).IsUnique();
            e.HasIndex(x => x.PlanId);
            e.HasOne(x => x.Tenant).WithMany().HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Plan).WithMany().HasForeignKey(x => x.PlanId)
                .OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<Tenant>(e =>
        {
            e.HasIndex(x => x.Slug).IsUnique();
            e.Property(x => x.Slug).HasMaxLength(80);
            e.Property(x => x.Name).HasMaxLength(180);
            e.Property(x => x.PlatformRevision).IsConcurrencyToken();
            e.ToTable(t => t.HasCheckConstraint("CK_Tenant_PlatformRevision", "\"PlatformRevision\" >= 1"));
        });
        model.Entity<ImportUser>(e =>
        {
            e.HasOne(x => x.Tenant).WithMany().HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.TenantId);
            e.Property(x => x.DisplayName).HasMaxLength(160);
        });
        model.Entity<TenantCompany>(e =>
        {
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.Type, x.Name });
            e.Property(x => x.Name).HasMaxLength(180);
            e.Property(x => x.Type).HasMaxLength(30);
            e.Property(x => x.NameEn).HasMaxLength(180);
            e.Property(x => x.Country).HasMaxLength(100);
            e.Property(x => x.City).HasMaxLength(100);
            e.Property(x => x.Address).HasMaxLength(500);
            e.Property(x => x.ContactName).HasMaxLength(160);
            e.Property(x => x.Phone).HasMaxLength(45);
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.TaxNo).HasMaxLength(80);
            e.Property(x => x.DefaultCurrency).HasMaxLength(3);
            e.Property(x => x.Notes).HasMaxLength(2000);
            e.HasOne(x => x.Tenant).WithMany().HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId && !x.IsDeleted);
        });
        model.Entity<TenantInvitation>(e =>
        {
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => new { x.TenantId, x.Email });
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.TokenHash).HasMaxLength(64);
            e.Property(x => x.Role).HasMaxLength(20);
            e.HasOne(x => x.Tenant).WithMany().HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<SecurityAudit>(e =>
        {
            e.HasIndex(x => new { x.TenantId, x.OccurredAtUtc });
            e.Property(x => x.Action).HasMaxLength(90);
            e.Property(x => x.PreviousValue).HasMaxLength(100);
            e.Property(x => x.NewValue).HasMaxLength(100);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        model.Entity<PurchaseOrder>(e =>
        {
            e.ToTable("Orders", t =>
            {
                t.HasCheckConstraint("CK_Order_TotalNonNegative", "\"TotalAmount\" >= 0");
                t.HasCheckConstraint("CK_Order_RevisionPositive", "\"Revision\" >= 1");
            });
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.Number }).IsUnique();
            e.HasIndex(x => new { x.TenantId, x.OrderDate, x.Id });
            e.HasIndex(x => new { x.TenantId, x.SupplierId, x.OrderDate });
            e.HasIndex(x => new { x.TenantId, x.ArrivalStatus, x.OrderDate });
            e.HasIndex(x => new { x.TenantId, x.ClearanceStatus, x.OrderDate });
            e.Property(x => x.Number).HasMaxLength(35);
            e.Property(x => x.SupplierNameSnapshot).HasMaxLength(180);
            e.Property(x => x.CustomerNameSnapshot).HasMaxLength(180);
            e.Property(x => x.SupplierRef).HasMaxLength(120);
            e.Property(x => x.ProformaInvoiceNumber).HasMaxLength(120);
            e.Property(x => x.ContractNumber).HasMaxLength(120);
            e.Property(x => x.Incoterm).HasMaxLength(8);
            e.Property(x => x.LoadingPort).HasMaxLength(160);
            e.Property(x => x.DischargePort).HasMaxLength(160);
            e.Property(x => x.Currency).HasMaxLength(3);
            e.Property(x => x.Notes).HasMaxLength(3000);
            e.Property(x => x.TotalAmount).HasPrecision(18, 2);
            e.Property(x => x.PaidAmount).HasPrecision(18, 2);
            e.Property(x => x.PaymentStatus).HasMaxLength(25);
            e.Property(x => x.ArrivalStatus).HasMaxLength(25);
            e.Property(x => x.ClearanceStatus).HasMaxLength(25);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.ClosureReason).HasMaxLength(1000);
            e.Property(x => x.Revision).IsConcurrencyToken();
            e.HasOne(x => x.Tenant).WithMany().HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Supplier).WithMany()
                .HasForeignKey(x => new { x.TenantId, x.SupplierId })
                .HasPrincipalKey(x => new { x.TenantId, x.Id })
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Customer).WithMany()
                .HasForeignKey(x => new { x.TenantId, x.CustomerId })
                .HasPrincipalKey(x => new { x.TenantId, x.Id })
                .OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId && !x.IsDeleted);
        });
        model.Entity<PurchaseOrderItem>(e =>
        {
            e.ToTable("OrderItems", t =>
            {
                t.HasCheckConstraint("CK_OrderItem_QuantityPositive", "\"QuantityKg\" > 0");
                t.HasCheckConstraint("CK_OrderItem_UnitPricePositive", "\"UnitPrice\" > 0");
                t.HasCheckConstraint("CK_OrderItem_TotalNonNegative", "\"LineTotal\" >= 0");
                t.HasCheckConstraint("CK_OrderItem_PriceUnit", "\"PriceUnit\" IN ('KG','TON')");
            });
            e.HasIndex(x => new { x.TenantId, x.OrderId, x.Position });
            e.Property(x => x.ProductType).HasMaxLength(80);
            e.Property(x => x.Brand).HasMaxLength(100);
            e.Property(x => x.Denier).HasMaxLength(80);
            e.Property(x => x.Luster).HasMaxLength(80);
            e.Property(x => x.Grade).HasMaxLength(80);
            e.Property(x => x.ColorType).HasMaxLength(100);
            e.Property(x => x.HsCode).HasMaxLength(30);
            e.Property(x => x.PriceUnit).HasMaxLength(3);
            e.Property(x => x.QuantityKg).HasPrecision(18, 3);
            e.Property(x => x.UnitPrice).HasPrecision(18, 4);
            e.Property(x => x.LineTotal).HasPrecision(18, 2);
            e.HasOne(x => x.Order).WithMany(x => x.Items)
                .HasForeignKey(x => new { x.TenantId, x.OrderId })
                .HasPrincipalKey(x => new { x.TenantId, x.Id })
                .OnDelete(DeleteBehavior.Cascade);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId && !x.Order.IsDeleted);
        });
        model.Entity<OrderNumberSequence>(e =>
        {
            e.HasKey(x => new { x.TenantId, x.Year });
            e.ToTable("OrderNumberSequences", t => t.HasCheckConstraint(
                "CK_OrderNumberSequence_LastNumberPositive", "\"LastNumber\" >= 1"));
            e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<OrderAudit>(e =>
        {
            e.HasIndex(x => new { x.TenantId, x.OrderId, x.OccurredAtUtc });
            e.Property(x => x.Action).HasMaxLength(25);
            e.HasOne<PurchaseOrder>().WithMany()
                .HasForeignKey(x => new { x.TenantId, x.OrderId })
                .HasPrincipalKey(x => new { x.TenantId, x.Id })
                .OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        model.Entity<ImportShipment>(e =>
        {
            e.ToTable("Shipments");
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.OrderId });
            e.HasIndex(x => new { x.TenantId, x.BlNumber }).IsUnique()
                .HasFilter("\"IsDeleted\" = false");
            e.Property(x => x.BlNumber).HasMaxLength(90);
            e.Property(x => x.BlType).HasMaxLength(20);
            e.Property(x => x.BlOriginalStatus).HasMaxLength(30);
            e.Property(x => x.ShippingLineSnapshot).HasMaxLength(180);
            e.Property(x => x.Vessel).HasMaxLength(140);
            e.Property(x => x.Voyage).HasMaxLength(80);
            e.Property(x => x.Shipper).HasMaxLength(180);
            e.Property(x => x.Consignee).HasMaxLength(180);
            e.Property(x => x.NotifyParty).HasMaxLength(180);
            e.Property(x => x.PortOfLoading).HasMaxLength(160);
            e.Property(x => x.PortOfDischarge).HasMaxLength(160);
            e.Property(x => x.TrackingUrl).HasMaxLength(600);
            e.Property(x => x.Revision).IsConcurrencyToken();
            e.HasOne(x => x.Order).WithMany()
                .HasForeignKey(x => new { x.TenantId, x.OrderId })
                .HasPrincipalKey(x => new { x.TenantId, x.Id })
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.ShippingLine).WithMany()
                .HasForeignKey(x => new { x.TenantId, x.ShippingLineId })
                .HasPrincipalKey(x => new { x.TenantId, x.Id })
                .OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId && !x.IsDeleted && !x.Order.IsDeleted);
        });
        model.Entity<ShipmentTrackingReference>(e =>
        {
            e.ToTable("ShipmentTrackingReferences");
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.ShipmentId, x.ReferenceType, x.ReferenceNumber }).IsUnique();
            e.HasIndex(x => new { x.TenantId, x.LastSyncedAtUtc });
            e.Property(x => x.ReferenceType).HasMaxLength(2);
            e.Property(x => x.ReferenceNumber).HasMaxLength(90);
            e.Property(x => x.CarrierCode).HasMaxLength(12);
            e.Property(x => x.ProviderStatus).HasMaxLength(60);
            e.Property(x => x.LastErrorCode).HasMaxLength(80);
            e.Property(x => x.SnapshotJson).HasColumnType("jsonb");
            e.HasOne(x => x.Shipment).WithMany()
                .HasForeignKey(x => new { x.TenantId, x.ShipmentId })
                .HasPrincipalKey(x => new { x.TenantId, x.Id })
                .OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId &&
                !x.Shipment.IsDeleted && !x.Shipment.Order.IsDeleted);
        });
        model.Entity<ImportContainer>(e =>
        {
            e.ToTable("Containers", t =>
            {
                t.HasCheckConstraint("CK_Container_GrossWeight", "\"GrossWeightKg\" IS NULL OR \"GrossWeightKg\" >= 0");
                t.HasCheckConstraint("CK_Container_NetWeight", "\"NetWeightKg\" IS NULL OR \"NetWeightKg\" >= 0");
            });
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.ShipmentId, x.Number }).IsUnique()
                .HasFilter("\"IsDeleted\" = false");
            e.HasIndex(x => new { x.TenantId, x.Status, x.FreeTimeEndDate });
            e.Property(x => x.Number).HasMaxLength(11);
            e.Property(x => x.Size).HasMaxLength(6);
            e.Property(x => x.SealNumber).HasMaxLength(90);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.GrossWeightKg).HasPrecision(18, 3);
            e.Property(x => x.NetWeightKg).HasPrecision(18, 3);
            e.Property(x => x.Revision).IsConcurrencyToken();
            e.HasOne(x => x.Shipment).WithMany(x => x.Containers)
                .HasForeignKey(x => new { x.TenantId, x.ShipmentId })
                .HasPrincipalKey(x => new { x.TenantId, x.Id })
                .OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId && !x.IsDeleted && !x.Shipment.IsDeleted && !x.Shipment.Order.IsDeleted);
        });
        model.Entity<ImportCustomsClearance>(e =>
        {
            e.ToTable("CustomsClearances");
            e.HasAlternateKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.ShipmentId }).IsUnique();
            e.Property(x => x.DeclarationNumber).HasMaxLength(120);
            e.Property(x => x.BrokerSnapshot).HasMaxLength(180);
            e.Property(x => x.Status).HasMaxLength(30);
            e.Property(x => x.Notes).HasMaxLength(3000);
            e.Property(x => x.ChargesCurrency).HasMaxLength(3);
            e.Property(x => x.CustomsValue).HasPrecision(18,2);
            e.Property(x => x.DutyRatePercent).HasPrecision(7,4);
            e.Property(x => x.CustomsDutyAmount).HasPrecision(18,2);
            e.Property(x => x.TaxAmount).HasPrecision(18,2);
            e.Property(x => x.AdditionalFees).HasPrecision(18,2);
            e.Property(x => x.BrokerFees).HasPrecision(18,2);
            e.Property(x => x.InlandTransportFees).HasPrecision(18,2);
            e.Property(x => x.DemurrageFees).HasPrecision(18,2);
            e.Property(x => x.DetentionFees).HasPrecision(18,2);
            e.Property(x => x.Revision).IsConcurrencyToken();
            e.HasOne(x => x.Shipment).WithOne(x => x.Clearance)
                .HasForeignKey<ImportCustomsClearance>(x => new { x.TenantId, x.ShipmentId })
                .HasPrincipalKey<ImportShipment>(x => new { x.TenantId, x.Id })
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Broker).WithMany()
                .HasForeignKey(x => new { x.TenantId, x.BrokerId })
                .HasPrincipalKey(x => new { x.TenantId, x.Id })
                .OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId && !x.Shipment.IsDeleted && !x.Shipment.Order.IsDeleted);
        });
        model.Entity<ImportLogisticsAudit>(e =>
        {
            e.ToTable("LogisticsAudits");
            e.HasIndex(x => new { x.TenantId, x.OrderId, x.OccurredAtUtc });
            e.HasIndex(x => new { x.TenantId, x.ShipmentId, x.OccurredAtUtc });
            e.Property(x => x.EntityType).HasMaxLength(25);
            e.Property(x => x.Action).HasMaxLength(30);
            e.HasOne<PurchaseOrder>().WithMany()
                .HasForeignKey(x => new { x.TenantId, x.OrderId })
                .HasPrincipalKey(x => new { x.TenantId, x.Id })
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ImportShipment>().WithMany()
                .HasForeignKey(x => new { x.TenantId, x.ShipmentId })
                .HasPrincipalKey(x => new { x.TenantId, x.Id })
                .OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        model.Entity<StoredDocument>(e =>
        {
            e.ToTable("StoredDocuments",t=>t.HasCheckConstraint("CK_StoredDoc_Size", "\"SizeBytes\" > 0 AND \"SizeBytes\" <= 26214400"));
            e.HasAlternateKey(x=>new{x.TenantId,x.Id});
            e.HasIndex(x=>new{x.TenantId,x.Sha256});
            e.Property(x=>x.Type).HasMaxLength(40);
            e.Property(x=>x.OriginalFileName).HasMaxLength(180);
            e.Property(x=>x.StorageKey).HasMaxLength(130);
            e.Property(x=>x.ContentType).HasMaxLength(45);
            e.Property(x=>x.Sha256).HasMaxLength(64);
            e.Property(x=>x.ScanStatus).HasMaxLength(30).HasDefaultValue("Unscanned");
            e.Property(x=>x.Notes).HasMaxLength(1500);
            e.HasOne<Tenant>().WithMany().HasForeignKey(x=>x.TenantId).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x=>x.TenantId==CurrentTenantId&&!x.IsDeleted);
        });
        model.Entity<StoredDocumentLink>(e =>
        {
            e.ToTable("StoredDocumentLinks",t=>t.HasCheckConstraint("CK_StoredDocumentLink_ExactlyOneTarget",
                "(CASE WHEN \"OrderId\" IS NULL THEN 0 ELSE 1 END + CASE WHEN \"ShipmentId\" IS NULL THEN 0 ELSE 1 END + CASE WHEN \"ContainerId\" IS NULL THEN 0 ELSE 1 END) = 1"));
            e.HasAlternateKey(x=>new{x.TenantId,x.Id});
            e.HasIndex(x=>new{x.TenantId,x.DocumentId,x.OrderId}).IsUnique()
                .HasFilter("\"OrderId\" IS NOT NULL AND \"IsDeleted\" = false");
            e.HasIndex(x=>new{x.TenantId,x.DocumentId,x.ShipmentId}).IsUnique()
                .HasFilter("\"ShipmentId\" IS NOT NULL AND \"IsDeleted\" = false");
            e.HasIndex(x=>new{x.TenantId,x.DocumentId,x.ContainerId}).IsUnique()
                .HasFilter("\"ContainerId\" IS NOT NULL AND \"IsDeleted\" = false");
            e.HasOne(x=>x.Document).WithMany(x=>x.Links)
                .HasForeignKey(x=>new{x.TenantId,x.DocumentId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.Order).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.OrderId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.Shipment).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.ShipmentId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.Container).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.ContainerId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x=>x.TenantId==CurrentTenantId&&!x.IsDeleted&&!x.Document.IsDeleted);
        });
        model.Entity<StoredDocumentAudit>(e =>
        {
            e.ToTable("StoredDocumentAudits");
            e.HasIndex(x=>new{x.TenantId,x.DocumentId,x.OccurredAtUtc});
            e.Property(x=>x.Action).HasMaxLength(40);
            e.HasOne<StoredDocument>().WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.DocumentId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x=>x.TenantId==CurrentTenantId);
        });
        model.Entity<DocumentRequirementRule>(e =>
        {
            e.ToTable("DocumentRequirementRules");
            e.HasAlternateKey(x=>new{x.TenantId,x.Id});
            e.HasIndex(x=>new{x.TenantId,x.TargetType,x.Stage,x.DocumentType}).IsUnique();
            e.Property(x=>x.TargetType).HasMaxLength(20);
            e.Property(x=>x.Stage).HasMaxLength(30);
            e.Property(x=>x.DocumentType).HasMaxLength(40);
            e.HasOne<Tenant>().WithMany().HasForeignKey(x=>x.TenantId).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x=>x.TenantId==CurrentTenantId);
        });
        model.Entity<DocumentRequirementWaiver>(e =>
        {
            e.ToTable("DocumentRequirementWaivers",t=>t.HasCheckConstraint("CK_DocumentWaiver_ExactlyOneTarget",
                "(CASE WHEN \"OrderId\" IS NULL THEN 0 ELSE 1 END + CASE WHEN \"ShipmentId\" IS NULL THEN 0 ELSE 1 END + CASE WHEN \"ContainerId\" IS NULL THEN 0 ELSE 1 END) = 1"));
            e.Property(x=>x.Reason).HasMaxLength(1000);
            e.HasIndex(x=>new{x.TenantId,x.RequirementId,x.OrderId}).IsUnique()
                .HasFilter("\"OrderId\" IS NOT NULL AND \"RevokedAtUtc\" IS NULL");
            e.HasIndex(x=>new{x.TenantId,x.RequirementId,x.ShipmentId}).IsUnique()
                .HasFilter("\"ShipmentId\" IS NOT NULL AND \"RevokedAtUtc\" IS NULL");
            e.HasIndex(x=>new{x.TenantId,x.RequirementId,x.ContainerId}).IsUnique()
                .HasFilter("\"ContainerId\" IS NOT NULL AND \"RevokedAtUtc\" IS NULL");
            e.HasOne(x=>x.Requirement).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.RequirementId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.Order).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.OrderId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.Shipment).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.ShipmentId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.Container).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.ContainerId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x=>x.TenantId==CurrentTenantId);
        });
        model.Entity<PaymentSchedule>(e =>
        {
            e.ToTable("PaymentSchedules",t=>t.HasCheckConstraint("CK_PaymentSchedule_Positive", "\"Amount\" > 0"));
            e.HasAlternateKey(x=>new{x.TenantId,x.OrderId,x.Id});
            e.HasIndex(x=>new{x.TenantId,x.OrderId,x.DueDate});
            e.HasIndex(x=>new{x.TenantId,x.CreatedById,x.IdempotencyKey}).IsUnique();
            e.Property(x=>x.Amount).HasPrecision(18,2);
            e.Property(x=>x.RequestHash).HasMaxLength(64);
            e.Property(x=>x.Kind).HasMaxLength(25);
            e.Property(x=>x.Notes).HasMaxLength(500);
            e.HasOne(x=>x.Order).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.OrderId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x=>x.TenantId==CurrentTenantId&&!x.Order.IsDeleted);
        });
        model.Entity<PaymentTransfer>(e =>
        {
            e.ToTable("PaymentTransfers",t=>
            {
                t.HasCheckConstraint("CK_PaymentTransfer_Positive","\"Amount\" > 0");
                t.HasCheckConstraint("CK_PaymentTransfer_State","\"State\" IN ('Active','Voided')");
            });
            e.HasAlternateKey(x=>new{x.TenantId,x.OrderId,x.Id});
            e.HasIndex(x=>new{x.TenantId,x.CreatedById,x.IdempotencyKey}).IsUnique();
            e.HasIndex(x=>new{x.TenantId,x.OrderId,x.State});
            e.Property(x=>x.Amount).HasPrecision(18,2);
            e.Property(x=>x.State).HasMaxLength(15);
            e.Property(x=>x.Method).HasMaxLength(30);
            e.Property(x=>x.Reference).HasMaxLength(160);
            e.Property(x=>x.BankOrExchangeName).HasMaxLength(180);
            e.Property(x=>x.BeneficiarySnapshot).HasMaxLength(180);
            e.Property(x=>x.VoidReason).HasMaxLength(1000);
            e.Property(x=>x.RequestHash).HasMaxLength(64);
            e.HasOne(x=>x.Order).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.OrderId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.BeneficiaryCompany).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.BeneficiaryCompanyId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.ProofDocument).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.ProofDocumentId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.ReplacesTransfer).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.OrderId,x.ReplacesTransferId})
                .HasPrincipalKey(x=>new{x.TenantId,x.OrderId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x=>x.TenantId==CurrentTenantId&&!x.Order.IsDeleted);
        });
        model.Entity<OrderExpense>(e =>
        {
            e.ToTable("OrderExpenses",t=>t.HasCheckConstraint("CK_OrderExpense_Positive","\"Amount\" > 0"));
            e.HasAlternateKey(x=>new{x.TenantId,x.OrderId,x.Id});
            e.HasIndex(x=>new{x.TenantId,x.OrderId});
            e.HasIndex(x=>new{x.TenantId,x.CreatedById,x.IdempotencyKey}).IsUnique();
            e.Property(x=>x.Amount).HasPrecision(18,2);
            e.Property(x=>x.RequestHash).HasMaxLength(64);
            e.Property(x=>x.Category).HasMaxLength(40);
            e.Property(x=>x.Description).HasMaxLength(500);
            e.Property(x=>x.PayeeSnapshot).HasMaxLength(180);
            e.HasOne(x=>x.Order).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.OrderId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.PayeeCompany).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.PayeeCompanyId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.EvidenceDocument).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.EvidenceDocumentId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x=>x.TenantId==CurrentTenantId&&!x.Order.IsDeleted);
        });
        model.Entity<PaymentAllocation>(e =>
        {
            e.ToTable("PaymentAllocations",t=>
            {
                t.HasCheckConstraint("CK_PaymentAllocation_Positive","\"Amount\" > 0");
                t.HasCheckConstraint("CK_PaymentAllocation_Kind", "(\"Kind\" = 'Commercial' AND \"ExpenseId\" IS NULL) OR (\"Kind\" = 'Expense' AND \"ExpenseId\" IS NOT NULL)");
            });
            e.HasIndex(x=>new{x.TenantId,x.OrderId,x.TransferId});
            e.HasIndex(x=>new{x.TenantId,x.CreatedById,x.IdempotencyKey}).IsUnique();
            e.Property(x=>x.Amount).HasPrecision(18,2);
            e.Property(x=>x.RequestHash).HasMaxLength(64);
            e.Property(x=>x.Kind).HasMaxLength(20);
            e.HasOne(x=>x.Transfer).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.OrderId,x.TransferId})
                .HasPrincipalKey(x=>new{x.TenantId,x.OrderId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.Expense).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.OrderId,x.ExpenseId})
                .HasPrincipalKey(x=>new{x.TenantId,x.OrderId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x=>x.TenantId==CurrentTenantId&&!x.Transfer.Order.IsDeleted);
        });
        model.Entity<PaymentReturn>(e =>
        {
            e.ToTable("PaymentReturns",t=>t.HasCheckConstraint("CK_PaymentReturn_Positive","\"Amount\" > 0"));
            e.HasIndex(x=>new{x.TenantId,x.CreatedById,x.IdempotencyKey}).IsUnique();
            e.HasIndex(x=>new{x.TenantId,x.OrderId,x.TransferId});
            e.Property(x=>x.Amount).HasPrecision(18,2);
            e.Property(x=>x.BankReference).HasMaxLength(160);
            e.Property(x=>x.Reason).HasMaxLength(1000);
            e.Property(x=>x.RequestHash).HasMaxLength(64);
            e.HasOne(x=>x.Transfer).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.OrderId,x.TransferId})
                .HasPrincipalKey(x=>new{x.TenantId,x.OrderId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x=>x.ProofDocument).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.ProofDocumentId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x=>x.TenantId==CurrentTenantId&&!x.Transfer.Order.IsDeleted);
        });
        model.Entity<PaymentAudit>(e=>
        {
            e.ToTable("PaymentAudits");
            e.HasIndex(x=>new{x.TenantId,x.OrderId,x.OccurredAtUtc});
            e.Property(x=>x.Action).HasMaxLength(40);
            e.Property(x=>x.Reason).HasMaxLength(1000);
            e.HasOne(x=>x.Order).WithMany()
                .HasForeignKey(x=>new{x.TenantId,x.OrderId})
                .HasPrincipalKey(x=>new{x.TenantId,x.Id}).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x=>x.TenantId==CurrentTenantId&&!x.Order.IsDeleted);
        });
    }
}

public sealed class ImportDbFactory : IDesignTimeDbContextFactory<ImportDb>
{
    public ImportDb CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("ConnectionStrings__ImportDatabase")
            ?? "Host=127.0.0.1;Database=wathiqa_import_dev;Username=design_only";
        var builder = new DbContextOptionsBuilder<ImportDb>().UseNpgsql(connection);
        return new ImportDb(builder.Options, new HttpContextAccessor());
    }
}
