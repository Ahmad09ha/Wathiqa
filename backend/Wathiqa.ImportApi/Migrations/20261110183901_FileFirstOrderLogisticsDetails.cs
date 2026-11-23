using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wathiqa.ImportApi.Migrations
{
    /// <inheritdoc />
    public partial class FileFirstOrderLogisticsDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Consignee",
                table: "Shipments",
                type: "character varying(180)",
                maxLength: 180,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "NotifyParty",
                table: "Shipments",
                type: "character varying(180)",
                maxLength: 180,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateOnly>(
                name: "OriginalReceivedDate",
                table: "Shipments",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PackageCount",
                table: "Shipments",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PalletCount",
                table: "Shipments",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ShippedOnBoardDate",
                table: "Shipments",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Shipper",
                table: "Shipments",
                type: "character varying(180)",
                maxLength: 180,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "BankOrExchangeName",
                table: "PaymentTransfers",
                type: "character varying(180)",
                maxLength: 180,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateOnly>(
                name: "ContractDate",
                table: "Orders",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContractNumber",
                table: "Orders",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ProformaInvoiceNumber",
                table: "Orders",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Brand",
                table: "OrderItems",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<decimal>(
                name: "AdditionalFees",
                table: "CustomsClearances",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "BrokerFees",
                table: "CustomsClearances",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ChargesCurrency",
                table: "CustomsClearances",
                type: "character varying(3)",
                maxLength: 3,
                nullable: false,
                defaultValue: "USD");

            migrationBuilder.AddColumn<decimal>(
                name: "CustomsDutyAmount",
                table: "CustomsClearances",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CustomsValue",
                table: "CustomsClearances",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "DeliveredToWarehouseDate",
                table: "CustomsClearances",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DemurrageFees",
                table: "CustomsClearances",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DetentionFees",
                table: "CustomsClearances",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DutyRatePercent",
                table: "CustomsClearances",
                type: "numeric(7,4)",
                precision: 7,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "InlandTransportFees",
                table: "CustomsClearances",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "TaxAmount",
                table: "CustomsClearances",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            // The previous Arabic editor called SupplierRef the proforma
            // invoice number. Carry forward existing values without removing
            // the historical supplier reference or rewriting order totals.
            migrationBuilder.Sql("""
                UPDATE "Orders"
                SET "ProformaInvoiceNumber" = "SupplierRef"
                WHERE "SupplierRef" <> '' AND "ProformaInvoiceNumber" = '';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Consignee",
                table: "Shipments");

            migrationBuilder.DropColumn(
                name: "NotifyParty",
                table: "Shipments");

            migrationBuilder.DropColumn(
                name: "OriginalReceivedDate",
                table: "Shipments");

            migrationBuilder.DropColumn(
                name: "PackageCount",
                table: "Shipments");

            migrationBuilder.DropColumn(
                name: "PalletCount",
                table: "Shipments");

            migrationBuilder.DropColumn(
                name: "ShippedOnBoardDate",
                table: "Shipments");

            migrationBuilder.DropColumn(
                name: "Shipper",
                table: "Shipments");

            migrationBuilder.DropColumn(
                name: "BankOrExchangeName",
                table: "PaymentTransfers");

            migrationBuilder.DropColumn(
                name: "ContractDate",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ContractNumber",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ProformaInvoiceNumber",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "Brand",
                table: "OrderItems");

            migrationBuilder.DropColumn(
                name: "AdditionalFees",
                table: "CustomsClearances");

            migrationBuilder.DropColumn(
                name: "BrokerFees",
                table: "CustomsClearances");

            migrationBuilder.DropColumn(
                name: "ChargesCurrency",
                table: "CustomsClearances");

            migrationBuilder.DropColumn(
                name: "CustomsDutyAmount",
                table: "CustomsClearances");

            migrationBuilder.DropColumn(
                name: "CustomsValue",
                table: "CustomsClearances");

            migrationBuilder.DropColumn(
                name: "DeliveredToWarehouseDate",
                table: "CustomsClearances");

            migrationBuilder.DropColumn(
                name: "DemurrageFees",
                table: "CustomsClearances");

            migrationBuilder.DropColumn(
                name: "DetentionFees",
                table: "CustomsClearances");

            migrationBuilder.DropColumn(
                name: "DutyRatePercent",
                table: "CustomsClearances");

            migrationBuilder.DropColumn(
                name: "InlandTransportFees",
                table: "CustomsClearances");

            migrationBuilder.DropColumn(
                name: "TaxAmount",
                table: "CustomsClearances");
        }
    }
}
