using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wathiqa.ImportApi.Migrations
{
    /// <inheritdoc />
    public partial class ShipmentsContainersCustoms : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Shipments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    BlNumber = table.Column<string>(type: "character varying(90)", maxLength: 90, nullable: false),
                    BlType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    BlOriginalStatus = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    ShippingLineId = table.Column<Guid>(type: "uuid", nullable: true),
                    ShippingLineSnapshot = table.Column<string>(type: "character varying(180)", maxLength: 180, nullable: true),
                    Vessel = table.Column<string>(type: "character varying(140)", maxLength: 140, nullable: false),
                    Voyage = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    PortOfLoading = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    PortOfDischarge = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Etd = table.Column<DateOnly>(type: "date", nullable: true),
                    Eta = table.Column<DateOnly>(type: "date", nullable: true),
                    FreeTimeDays = table.Column<int>(type: "integer", nullable: false),
                    TrackingUrl = table.Column<string>(type: "character varying(600)", maxLength: 600, nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Shipments", x => x.Id);
                    table.UniqueConstraint("AK_Shipments_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_Shipments_Companies_TenantId_ShippingLineId",
                        columns: x => new { x.TenantId, x.ShippingLineId },
                        principalTable: "Companies",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Shipments_Orders_TenantId_OrderId",
                        columns: x => new { x.TenantId, x.OrderId },
                        principalTable: "Orders",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Containers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ShipmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(11)", maxLength: 11, nullable: false),
                    Size = table.Column<string>(type: "character varying(6)", maxLength: 6, nullable: false),
                    SealNumber = table.Column<string>(type: "character varying(90)", maxLength: 90, nullable: false),
                    GrossWeightKg = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: true),
                    NetWeightKg = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CheckDigitValid = table.Column<bool>(type: "boolean", nullable: false),
                    InvalidDigitAcknowledged = table.Column<bool>(type: "boolean", nullable: false),
                    ArrivedAtPortDate = table.Column<DateOnly>(type: "date", nullable: true),
                    DeliveredDate = table.Column<DateOnly>(type: "date", nullable: true),
                    FreeTimeEndDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Containers", x => x.Id);
                    table.UniqueConstraint("AK_Containers_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_Container_GrossWeight", "\"GrossWeightKg\" IS NULL OR \"GrossWeightKg\" >= 0");
                    table.CheckConstraint("CK_Container_NetWeight", "\"NetWeightKg\" IS NULL OR \"NetWeightKg\" >= 0");
                    table.ForeignKey(
                        name: "FK_Containers_Shipments_TenantId_ShipmentId",
                        columns: x => new { x.TenantId, x.ShipmentId },
                        principalTable: "Shipments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CustomsClearances",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ShipmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    BrokerId = table.Column<Guid>(type: "uuid", nullable: true),
                    BrokerSnapshot = table.Column<string>(type: "character varying(180)", maxLength: 180, nullable: true),
                    DeclarationNumber = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    SubmittedDate = table.Column<DateOnly>(type: "date", nullable: true),
                    ReleasedDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Notes = table.Column<string>(type: "character varying(3000)", maxLength: 3000, nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomsClearances", x => x.Id);
                    table.UniqueConstraint("AK_CustomsClearances_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_CustomsClearances_Companies_TenantId_BrokerId",
                        columns: x => new { x.TenantId, x.BrokerId },
                        principalTable: "Companies",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CustomsClearances_Shipments_TenantId_ShipmentId",
                        columns: x => new { x.TenantId, x.ShipmentId },
                        principalTable: "Shipments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "LogisticsAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    ShipmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntityType = table.Column<string>(type: "character varying(25)", maxLength: 25, nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    BeforeJson = table.Column<string>(type: "text", nullable: false),
                    AfterJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LogisticsAudits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LogisticsAudits_Orders_TenantId_OrderId",
                        columns: x => new { x.TenantId, x.OrderId },
                        principalTable: "Orders",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_LogisticsAudits_Shipments_TenantId_ShipmentId",
                        columns: x => new { x.TenantId, x.ShipmentId },
                        principalTable: "Shipments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Containers_TenantId_ShipmentId_Number",
                table: "Containers",
                columns: new[] { "TenantId", "ShipmentId", "Number" },
                unique: true,
                filter: "\"IsDeleted\" = false");

            migrationBuilder.CreateIndex(
                name: "IX_CustomsClearances_TenantId_BrokerId",
                table: "CustomsClearances",
                columns: new[] { "TenantId", "BrokerId" });

            migrationBuilder.CreateIndex(
                name: "IX_CustomsClearances_TenantId_ShipmentId",
                table: "CustomsClearances",
                columns: new[] { "TenantId", "ShipmentId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LogisticsAudits_TenantId_OrderId_OccurredAtUtc",
                table: "LogisticsAudits",
                columns: new[] { "TenantId", "OrderId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_LogisticsAudits_TenantId_ShipmentId_OccurredAtUtc",
                table: "LogisticsAudits",
                columns: new[] { "TenantId", "ShipmentId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_TenantId_BlNumber",
                table: "Shipments",
                columns: new[] { "TenantId", "BlNumber" },
                unique: true,
                filter: "\"IsDeleted\" = false");

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_TenantId_OrderId",
                table: "Shipments",
                columns: new[] { "TenantId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_TenantId_ShippingLineId",
                table: "Shipments",
                columns: new[] { "TenantId", "ShippingLineId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Containers");

            migrationBuilder.DropTable(
                name: "CustomsClearances");

            migrationBuilder.DropTable(
                name: "LogisticsAudits");

            migrationBuilder.DropTable(
                name: "Shipments");
        }
    }
}
