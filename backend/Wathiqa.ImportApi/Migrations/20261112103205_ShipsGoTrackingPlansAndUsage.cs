using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wathiqa.ImportApi.Migrations
{
    /// <inheritdoc />
    public partial class ShipsGoTrackingPlansAndUsage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "TrackingCycleId",
                table: "TenantSubscriptions",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            // Preserve existing subscriptions without sharing a zero-valued
            // tracking cycle between historical and future renewal periods.
            migrationBuilder.Sql(
                "UPDATE \"TenantSubscriptions\" SET \"TrackingCycleId\"=gen_random_uuid() " +
                "WHERE \"TrackingCycleId\"='00000000-0000-0000-0000-000000000000'");

            migrationBuilder.AddColumn<int>(
                name: "MaxTrackedBills",
                table: "PlatformSubscriptionPlans",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "SubscriptionTrackingUsages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    TrackingCycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    ShipmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    BlNumber = table.Column<string>(type: "character varying(90)", maxLength: 90, nullable: false),
                    ProviderRequestId = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    State = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SubscriptionTrackingUsages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SubscriptionTrackingUsages_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_PlatformPlan_TrackedBills",
                table: "PlatformSubscriptionPlans",
                sql: "\"MaxTrackedBills\" BETWEEN 0 AND 100000");

            migrationBuilder.CreateIndex(
                name: "IX_SubscriptionTrackingUsages_TenantId_ShipmentId",
                table: "SubscriptionTrackingUsages",
                columns: new[] { "TenantId", "ShipmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_SubscriptionTrackingUsages_TenantId_TrackingCycleId_Shipmen~",
                table: "SubscriptionTrackingUsages",
                columns: new[] { "TenantId", "TrackingCycleId", "ShipmentId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SubscriptionTrackingUsages");

            migrationBuilder.DropCheckConstraint(
                name: "CK_PlatformPlan_TrackedBills",
                table: "PlatformSubscriptionPlans");

            migrationBuilder.DropColumn(
                name: "TrackingCycleId",
                table: "TenantSubscriptions");

            migrationBuilder.DropColumn(
                name: "MaxTrackedBills",
                table: "PlatformSubscriptionPlans");
        }
    }
}
