using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wathiqa.ImportApi.Migrations;

[DbContext(typeof(ImportDb))]
[Migration("20261110183000_ShipmentTrackingReferences")]
public sealed class ShipmentTrackingReferences : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "ShipmentTrackingReferences",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                ShipmentId = table.Column<Guid>(type: "uuid", nullable: false),
                ReferenceType = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                ReferenceNumber = table.Column<string>(type: "character varying(90)", maxLength: 90, nullable: false),
                CarrierCode = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                ProviderStatus = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                SnapshotJson = table.Column<string>(type: "jsonb", nullable: false),
                LastSyncedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                LastAttemptAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                LastErrorCode = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                UpdatedById = table.Column<Guid>(type: "uuid", nullable: false),
                UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ShipmentTrackingReferences", x => x.Id);
                table.UniqueConstraint("AK_ShipmentTrackingReferences_TenantId_Id", x => new { x.TenantId, x.Id });
                table.ForeignKey(
                    name: "FK_ShipmentTrackingReferences_Shipments_TenantId_ShipmentId",
                    columns: x => new { x.TenantId, x.ShipmentId },
                    principalTable: "Shipments",
                    principalColumns: new[] { "TenantId", "Id" },
                    onDelete: ReferentialAction.Restrict);
            });
        migrationBuilder.CreateIndex(
            name: "IX_ShipmentTrackingReferences_TenantId_ShipmentId_ReferenceType_ReferenceNumber",
            table: "ShipmentTrackingReferences",
            columns: new[] { "TenantId", "ShipmentId", "ReferenceType", "ReferenceNumber" },
            unique: true);
        migrationBuilder.CreateIndex(
            name: "IX_ShipmentTrackingReferences_TenantId_LastSyncedAtUtc",
            table: "ShipmentTrackingReferences",
            columns: new[] { "TenantId", "LastSyncedAtUtc" });
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropTable(name: "ShipmentTrackingReferences");
}
