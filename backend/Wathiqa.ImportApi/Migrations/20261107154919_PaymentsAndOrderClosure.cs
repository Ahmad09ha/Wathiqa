using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wathiqa.ImportApi.Migrations
{
    /// <inheritdoc />
    public partial class PaymentsAndOrderClosure : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ClosedAtUtc",
                table: "Orders",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ClosedById",
                table: "Orders",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ClosedWithExceptions",
                table: "Orders",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ClosureReason",
                table: "Orders",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "OrderExpenses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    PayeeCompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    PayeeSnapshot = table.Column<string>(type: "character varying(180)", maxLength: 180, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Category = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    EvidenceDocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderExpenses", x => x.Id);
                    table.UniqueConstraint("AK_OrderExpenses_TenantId_OrderId_Id", x => new { x.TenantId, x.OrderId, x.Id });
                    table.CheckConstraint("CK_OrderExpense_Positive", "\"Amount\" > 0");
                    table.ForeignKey(
                        name: "FK_OrderExpenses_Companies_TenantId_PayeeCompanyId",
                        columns: x => new { x.TenantId, x.PayeeCompanyId },
                        principalTable: "Companies",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OrderExpenses_Orders_TenantId_OrderId",
                        columns: x => new { x.TenantId, x.OrderId },
                        principalTable: "Orders",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OrderExpenses_StoredDocuments_TenantId_EvidenceDocumentId",
                        columns: x => new { x.TenantId, x.EvidenceDocumentId },
                        principalTable: "StoredDocuments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PaymentAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    BeforeJson = table.Column<string>(type: "text", nullable: false),
                    AfterJson = table.Column<string>(type: "text", nullable: false),
                    OccurredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentAudits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PaymentAudits_Orders_TenantId_OrderId",
                        columns: x => new { x.TenantId, x.OrderId },
                        principalTable: "Orders",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PaymentSchedules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(25)", maxLength: 25, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentSchedules", x => x.Id);
                    table.UniqueConstraint("AK_PaymentSchedules_TenantId_OrderId_Id", x => new { x.TenantId, x.OrderId, x.Id });
                    table.CheckConstraint("CK_PaymentSchedule_Positive", "\"Amount\" > 0");
                    table.ForeignKey(
                        name: "FK_PaymentSchedules_Orders_TenantId_OrderId",
                        columns: x => new { x.TenantId, x.OrderId },
                        principalTable: "Orders",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PaymentTransfers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    BeneficiaryCompanyId = table.Column<Guid>(type: "uuid", nullable: false),
                    BeneficiarySnapshot = table.Column<string>(type: "character varying(180)", maxLength: 180, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TransferDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Method = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Reference = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    ProofDocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    State = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: false),
                    ReplacesTransferId = table.Column<Guid>(type: "uuid", nullable: true),
                    VoidReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    VoidedById = table.Column<Guid>(type: "uuid", nullable: true),
                    VoidedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentTransfers", x => x.Id);
                    table.UniqueConstraint("AK_PaymentTransfers_TenantId_OrderId_Id", x => new { x.TenantId, x.OrderId, x.Id });
                    table.CheckConstraint("CK_PaymentTransfer_Positive", "\"Amount\" > 0");
                    table.CheckConstraint("CK_PaymentTransfer_State", "\"State\" IN ('Active','Voided')");
                    table.ForeignKey(
                        name: "FK_PaymentTransfers_Companies_TenantId_BeneficiaryCompanyId",
                        columns: x => new { x.TenantId, x.BeneficiaryCompanyId },
                        principalTable: "Companies",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentTransfers_Orders_TenantId_OrderId",
                        columns: x => new { x.TenantId, x.OrderId },
                        principalTable: "Orders",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentTransfers_PaymentTransfers_TenantId_OrderId_Replaces~",
                        columns: x => new { x.TenantId, x.OrderId, x.ReplacesTransferId },
                        principalTable: "PaymentTransfers",
                        principalColumns: new[] { "TenantId", "OrderId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentTransfers_StoredDocuments_TenantId_ProofDocumentId",
                        columns: x => new { x.TenantId, x.ProofDocumentId },
                        principalTable: "StoredDocuments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PaymentAllocations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    TransferId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExpenseId = table.Column<Guid>(type: "uuid", nullable: true),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentAllocations", x => x.Id);
                    table.CheckConstraint("CK_PaymentAllocation_Kind", "(\"Kind\" = 'Commercial' AND \"ExpenseId\" IS NULL) OR (\"Kind\" = 'Expense' AND \"ExpenseId\" IS NOT NULL)");
                    table.CheckConstraint("CK_PaymentAllocation_Positive", "\"Amount\" > 0");
                    table.ForeignKey(
                        name: "FK_PaymentAllocations_OrderExpenses_TenantId_OrderId_ExpenseId",
                        columns: x => new { x.TenantId, x.OrderId, x.ExpenseId },
                        principalTable: "OrderExpenses",
                        principalColumns: new[] { "TenantId", "OrderId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentAllocations_PaymentTransfers_TenantId_OrderId_Transf~",
                        columns: x => new { x.TenantId, x.OrderId, x.TransferId },
                        principalTable: "PaymentTransfers",
                        principalColumns: new[] { "TenantId", "OrderId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PaymentReturns",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    TransferId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    ReturnDate = table.Column<DateOnly>(type: "date", nullable: false),
                    BankReference = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    ProofDocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentReturns", x => x.Id);
                    table.CheckConstraint("CK_PaymentReturn_Positive", "\"Amount\" > 0");
                    table.ForeignKey(
                        name: "FK_PaymentReturns_PaymentTransfers_TenantId_OrderId_TransferId",
                        columns: x => new { x.TenantId, x.OrderId, x.TransferId },
                        principalTable: "PaymentTransfers",
                        principalColumns: new[] { "TenantId", "OrderId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentReturns_StoredDocuments_TenantId_ProofDocumentId",
                        columns: x => new { x.TenantId, x.ProofDocumentId },
                        principalTable: "StoredDocuments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OrderExpenses_TenantId_CreatedById_IdempotencyKey",
                table: "OrderExpenses",
                columns: new[] { "TenantId", "CreatedById", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrderExpenses_TenantId_EvidenceDocumentId",
                table: "OrderExpenses",
                columns: new[] { "TenantId", "EvidenceDocumentId" });

            migrationBuilder.CreateIndex(
                name: "IX_OrderExpenses_TenantId_OrderId",
                table: "OrderExpenses",
                columns: new[] { "TenantId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_OrderExpenses_TenantId_PayeeCompanyId",
                table: "OrderExpenses",
                columns: new[] { "TenantId", "PayeeCompanyId" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentAllocations_TenantId_CreatedById_IdempotencyKey",
                table: "PaymentAllocations",
                columns: new[] { "TenantId", "CreatedById", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentAllocations_TenantId_OrderId_ExpenseId",
                table: "PaymentAllocations",
                columns: new[] { "TenantId", "OrderId", "ExpenseId" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentAllocations_TenantId_OrderId_TransferId",
                table: "PaymentAllocations",
                columns: new[] { "TenantId", "OrderId", "TransferId" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentAudits_TenantId_OrderId_OccurredAtUtc",
                table: "PaymentAudits",
                columns: new[] { "TenantId", "OrderId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentReturns_TenantId_CreatedById_IdempotencyKey",
                table: "PaymentReturns",
                columns: new[] { "TenantId", "CreatedById", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentReturns_TenantId_OrderId_TransferId",
                table: "PaymentReturns",
                columns: new[] { "TenantId", "OrderId", "TransferId" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentReturns_TenantId_ProofDocumentId",
                table: "PaymentReturns",
                columns: new[] { "TenantId", "ProofDocumentId" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentSchedules_TenantId_CreatedById_IdempotencyKey",
                table: "PaymentSchedules",
                columns: new[] { "TenantId", "CreatedById", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentSchedules_TenantId_OrderId_DueDate",
                table: "PaymentSchedules",
                columns: new[] { "TenantId", "OrderId", "DueDate" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentTransfers_TenantId_BeneficiaryCompanyId",
                table: "PaymentTransfers",
                columns: new[] { "TenantId", "BeneficiaryCompanyId" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentTransfers_TenantId_CreatedById_IdempotencyKey",
                table: "PaymentTransfers",
                columns: new[] { "TenantId", "CreatedById", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentTransfers_TenantId_OrderId_ReplacesTransferId",
                table: "PaymentTransfers",
                columns: new[] { "TenantId", "OrderId", "ReplacesTransferId" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentTransfers_TenantId_OrderId_State",
                table: "PaymentTransfers",
                columns: new[] { "TenantId", "OrderId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentTransfers_TenantId_ProofDocumentId",
                table: "PaymentTransfers",
                columns: new[] { "TenantId", "ProofDocumentId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PaymentAllocations");

            migrationBuilder.DropTable(
                name: "PaymentAudits");

            migrationBuilder.DropTable(
                name: "PaymentReturns");

            migrationBuilder.DropTable(
                name: "PaymentSchedules");

            migrationBuilder.DropTable(
                name: "OrderExpenses");

            migrationBuilder.DropTable(
                name: "PaymentTransfers");

            migrationBuilder.DropColumn(
                name: "ClosedAtUtc",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ClosedById",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ClosedWithExceptions",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ClosureReason",
                table: "Orders");
        }
    }
}
