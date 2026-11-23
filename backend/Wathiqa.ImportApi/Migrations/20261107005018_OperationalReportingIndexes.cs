using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wathiqa.ImportApi.Migrations
{
    /// <inheritdoc />
    public partial class OperationalReportingIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Orders_TenantId_ArrivalStatus_OrderDate",
                table: "Orders",
                columns: new[] { "TenantId", "ArrivalStatus", "OrderDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Orders_TenantId_ClearanceStatus_OrderDate",
                table: "Orders",
                columns: new[] { "TenantId", "ClearanceStatus", "OrderDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Containers_TenantId_Status_FreeTimeEndDate",
                table: "Containers",
                columns: new[] { "TenantId", "Status", "FreeTimeEndDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Orders_TenantId_ArrivalStatus_OrderDate",
                table: "Orders");

            migrationBuilder.DropIndex(
                name: "IX_Orders_TenantId_ClearanceStatus_OrderDate",
                table: "Orders");

            migrationBuilder.DropIndex(
                name: "IX_Containers_TenantId_Status_FreeTimeEndDate",
                table: "Containers");
        }
    }
}
