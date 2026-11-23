using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wathiqa.ImportApi.Migrations
{
    /// <inheritdoc />
    public partial class PurchaseOrdersAndNumbering : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Companies_TenantId_Id",
                table: "Companies");

            migrationBuilder.AddUniqueConstraint(
                name: "AK_Companies_TenantId_Id",
                table: "Companies",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateTable(
                name: "OrderNumberSequences",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: false),
                    LastNumber = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderNumberSequences", x => new { x.TenantId, x.Year });
                    table.CheckConstraint("CK_OrderNumberSequence_LastNumberPositive", "\"LastNumber\" >= 1");
                    table.ForeignKey(
                        name: "FK_OrderNumberSequences_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Orders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "character varying(35)", maxLength: 35, nullable: false),
                    NumberYear = table.Column<int>(type: "integer", nullable: false),
                    SupplierId = table.Column<Guid>(type: "uuid", nullable: false),
                    SupplierNameSnapshot = table.Column<string>(type: "character varying(180)", maxLength: 180, nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: true),
                    CustomerNameSnapshot = table.Column<string>(type: "character varying(180)", maxLength: 180, nullable: true),
                    SupplierRef = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    OrderDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Incoterm = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    LoadingPort = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    DischargePort = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    Notes = table.Column<string>(type: "character varying(3000)", maxLength: 3000, nullable: false),
                    TotalAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PaidAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PaymentStatus = table.Column<string>(type: "character varying(25)", maxLength: 25, nullable: false),
                    ArrivalStatus = table.Column<string>(type: "character varying(25)", maxLength: 25, nullable: false),
                    ClearanceStatus = table.Column<string>(type: "character varying(25)", maxLength: 25, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ContainerCount = table.Column<int>(type: "integer", nullable: false),
                    DeliveredContainerCount = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Orders", x => x.Id);
                    table.UniqueConstraint("AK_Orders_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_Order_RevisionPositive", "\"Revision\" >= 1");
                    table.CheckConstraint("CK_Order_TotalNonNegative", "\"TotalAmount\" >= 0");
                    table.ForeignKey(
                        name: "FK_Orders_Companies_TenantId_CustomerId",
                        columns: x => new { x.TenantId, x.CustomerId },
                        principalTable: "Companies",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Orders_Companies_TenantId_SupplierId",
                        columns: x => new { x.TenantId, x.SupplierId },
                        principalTable: "Companies",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Orders_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OrderAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "character varying(25)", maxLength: 25, nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PreviousRevision = table.Column<int>(type: "integer", nullable: false),
                    NewRevision = table.Column<int>(type: "integer", nullable: false),
                    BeforeJson = table.Column<string>(type: "text", nullable: false),
                    AfterJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderAudits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OrderAudits_Orders_TenantId_OrderId",
                        columns: x => new { x.TenantId, x.OrderId },
                        principalTable: "Orders",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OrderItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    ProductType = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Denier = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Luster = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Grade = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ColorType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    QuantityKg = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false),
                    PriceUnit = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    LineTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    HsCode = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedById = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderItems", x => x.Id);
                    table.CheckConstraint("CK_OrderItem_PriceUnit", "\"PriceUnit\" IN ('KG','TON')");
                    table.CheckConstraint("CK_OrderItem_QuantityPositive", "\"QuantityKg\" > 0");
                    table.CheckConstraint("CK_OrderItem_TotalNonNegative", "\"LineTotal\" >= 0");
                    table.CheckConstraint("CK_OrderItem_UnitPricePositive", "\"UnitPrice\" > 0");
                    table.ForeignKey(
                        name: "FK_OrderItems_Orders_TenantId_OrderId",
                        columns: x => new { x.TenantId, x.OrderId },
                        principalTable: "Orders",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OrderAudits_TenantId_OrderId_OccurredAtUtc",
                table: "OrderAudits",
                columns: new[] { "TenantId", "OrderId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_OrderItems_TenantId_OrderId_Position",
                table: "OrderItems",
                columns: new[] { "TenantId", "OrderId", "Position" });

            migrationBuilder.CreateIndex(
                name: "IX_Orders_TenantId_CustomerId",
                table: "Orders",
                columns: new[] { "TenantId", "CustomerId" });

            migrationBuilder.CreateIndex(
                name: "IX_Orders_TenantId_Number",
                table: "Orders",
                columns: new[] { "TenantId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Orders_TenantId_OrderDate_Id",
                table: "Orders",
                columns: new[] { "TenantId", "OrderDate", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Orders_TenantId_SupplierId_OrderDate",
                table: "Orders",
                columns: new[] { "TenantId", "SupplierId", "OrderDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OrderAudits");

            migrationBuilder.DropTable(
                name: "OrderItems");

            migrationBuilder.DropTable(
                name: "OrderNumberSequences");

            migrationBuilder.DropTable(
                name: "Orders");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_Companies_TenantId_Id",
                table: "Companies");

            migrationBuilder.CreateIndex(
                name: "IX_Companies_TenantId_Id",
                table: "Companies",
                columns: new[] { "TenantId", "Id" },
                unique: true);
        }
    }
}
