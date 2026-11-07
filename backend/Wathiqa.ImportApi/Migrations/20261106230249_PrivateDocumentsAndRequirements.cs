using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wathiqa.ImportApi.Migrations
{
    /// <inheritdoc />
    public partial class PrivateDocumentsAndRequirements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DocumentRequirementRules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    TargetType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Stage = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    DocumentType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    IsRequired = table.Column<bool>(type: "boolean", nullable: false),
                    UpdatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DocumentRequirementRules", x => x.Id);
                    table.UniqueConstraint("AK_DocumentRequirementRules_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_DocumentRequirementRules_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StoredDocuments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    OriginalFileName = table.Column<string>(type: "character varying(180)", maxLength: 180, nullable: false),
                    StorageKey = table.Column<string>(type: "character varying(130)", maxLength: 130, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(45)", maxLength: 45, nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Notes = table.Column<string>(type: "character varying(1500)", maxLength: 1500, nullable: false),
                    UploadedById = table.Column<Guid>(type: "uuid", nullable: false),
                    UploadedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    DeletedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeletedById = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoredDocuments", x => x.Id);
                    table.UniqueConstraint("AK_StoredDocuments_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_StoredDoc_Size", "\"SizeBytes\" > 0 AND \"SizeBytes\" <= 26214400");
                    table.ForeignKey(
                        name: "FK_StoredDocuments_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DocumentRequirementWaivers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequirementId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    ShipmentId = table.Column<Guid>(type: "uuid", nullable: true),
                    ContainerId = table.Column<Guid>(type: "uuid", nullable: true),
                    Reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    ApprovedById = table.Column<Guid>(type: "uuid", nullable: false),
                    ApprovedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RevokedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedById = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DocumentRequirementWaivers", x => x.Id);
                    table.CheckConstraint("CK_DocumentWaiver_ExactlyOneTarget", "(CASE WHEN \"OrderId\" IS NULL THEN 0 ELSE 1 END + CASE WHEN \"ShipmentId\" IS NULL THEN 0 ELSE 1 END + CASE WHEN \"ContainerId\" IS NULL THEN 0 ELSE 1 END) = 1");
                    table.ForeignKey(
                        name: "FK_DocumentRequirementWaivers_Containers_TenantId_ContainerId",
                        columns: x => new { x.TenantId, x.ContainerId },
                        principalTable: "Containers",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DocumentRequirementWaivers_DocumentRequirementRules_TenantI~",
                        columns: x => new { x.TenantId, x.RequirementId },
                        principalTable: "DocumentRequirementRules",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DocumentRequirementWaivers_Orders_TenantId_OrderId",
                        columns: x => new { x.TenantId, x.OrderId },
                        principalTable: "Orders",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DocumentRequirementWaivers_Shipments_TenantId_ShipmentId",
                        columns: x => new { x.TenantId, x.ShipmentId },
                        principalTable: "Shipments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StoredDocumentAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    DetailsJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoredDocumentAudits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StoredDocumentAudits_StoredDocuments_TenantId_DocumentId",
                        columns: x => new { x.TenantId, x.DocumentId },
                        principalTable: "StoredDocuments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StoredDocumentLinks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: true),
                    ShipmentId = table.Column<Guid>(type: "uuid", nullable: true),
                    ContainerId = table.Column<Guid>(type: "uuid", nullable: true),
                    LinkedById = table.Column<Guid>(type: "uuid", nullable: false),
                    LinkedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    UnlinkedById = table.Column<Guid>(type: "uuid", nullable: true),
                    UnlinkedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoredDocumentLinks", x => x.Id);
                    table.UniqueConstraint("AK_StoredDocumentLinks_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_StoredDocumentLink_ExactlyOneTarget", "(CASE WHEN \"OrderId\" IS NULL THEN 0 ELSE 1 END + CASE WHEN \"ShipmentId\" IS NULL THEN 0 ELSE 1 END + CASE WHEN \"ContainerId\" IS NULL THEN 0 ELSE 1 END) = 1");
                    table.ForeignKey(
                        name: "FK_StoredDocumentLinks_Containers_TenantId_ContainerId",
                        columns: x => new { x.TenantId, x.ContainerId },
                        principalTable: "Containers",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StoredDocumentLinks_Orders_TenantId_OrderId",
                        columns: x => new { x.TenantId, x.OrderId },
                        principalTable: "Orders",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StoredDocumentLinks_Shipments_TenantId_ShipmentId",
                        columns: x => new { x.TenantId, x.ShipmentId },
                        principalTable: "Shipments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StoredDocumentLinks_StoredDocuments_TenantId_DocumentId",
                        columns: x => new { x.TenantId, x.DocumentId },
                        principalTable: "StoredDocuments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DocumentRequirementRules_TenantId_TargetType_Stage_Document~",
                table: "DocumentRequirementRules",
                columns: new[] { "TenantId", "TargetType", "Stage", "DocumentType" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DocumentRequirementWaivers_TenantId_ContainerId",
                table: "DocumentRequirementWaivers",
                columns: new[] { "TenantId", "ContainerId" });

            migrationBuilder.CreateIndex(
                name: "IX_DocumentRequirementWaivers_TenantId_OrderId",
                table: "DocumentRequirementWaivers",
                columns: new[] { "TenantId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_DocumentRequirementWaivers_TenantId_RequirementId_Container~",
                table: "DocumentRequirementWaivers",
                columns: new[] { "TenantId", "RequirementId", "ContainerId" },
                unique: true,
                filter: "\"ContainerId\" IS NOT NULL AND \"RevokedAtUtc\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentRequirementWaivers_TenantId_RequirementId_OrderId",
                table: "DocumentRequirementWaivers",
                columns: new[] { "TenantId", "RequirementId", "OrderId" },
                unique: true,
                filter: "\"OrderId\" IS NOT NULL AND \"RevokedAtUtc\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentRequirementWaivers_TenantId_RequirementId_ShipmentId",
                table: "DocumentRequirementWaivers",
                columns: new[] { "TenantId", "RequirementId", "ShipmentId" },
                unique: true,
                filter: "\"ShipmentId\" IS NOT NULL AND \"RevokedAtUtc\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentRequirementWaivers_TenantId_ShipmentId",
                table: "DocumentRequirementWaivers",
                columns: new[] { "TenantId", "ShipmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_StoredDocumentAudits_TenantId_DocumentId_OccurredAtUtc",
                table: "StoredDocumentAudits",
                columns: new[] { "TenantId", "DocumentId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_StoredDocumentLinks_TenantId_ContainerId",
                table: "StoredDocumentLinks",
                columns: new[] { "TenantId", "ContainerId" });

            migrationBuilder.CreateIndex(
                name: "IX_StoredDocumentLinks_TenantId_DocumentId_ContainerId",
                table: "StoredDocumentLinks",
                columns: new[] { "TenantId", "DocumentId", "ContainerId" },
                unique: true,
                filter: "\"ContainerId\" IS NOT NULL AND \"IsDeleted\" = false");

            migrationBuilder.CreateIndex(
                name: "IX_StoredDocumentLinks_TenantId_DocumentId_OrderId",
                table: "StoredDocumentLinks",
                columns: new[] { "TenantId", "DocumentId", "OrderId" },
                unique: true,
                filter: "\"OrderId\" IS NOT NULL AND \"IsDeleted\" = false");

            migrationBuilder.CreateIndex(
                name: "IX_StoredDocumentLinks_TenantId_DocumentId_ShipmentId",
                table: "StoredDocumentLinks",
                columns: new[] { "TenantId", "DocumentId", "ShipmentId" },
                unique: true,
                filter: "\"ShipmentId\" IS NOT NULL AND \"IsDeleted\" = false");

            migrationBuilder.CreateIndex(
                name: "IX_StoredDocumentLinks_TenantId_OrderId",
                table: "StoredDocumentLinks",
                columns: new[] { "TenantId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_StoredDocumentLinks_TenantId_ShipmentId",
                table: "StoredDocumentLinks",
                columns: new[] { "TenantId", "ShipmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_StoredDocuments_TenantId_Sha256",
                table: "StoredDocuments",
                columns: new[] { "TenantId", "Sha256" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DocumentRequirementWaivers");

            migrationBuilder.DropTable(
                name: "StoredDocumentAudits");

            migrationBuilder.DropTable(
                name: "StoredDocumentLinks");

            migrationBuilder.DropTable(
                name: "DocumentRequirementRules");

            migrationBuilder.DropTable(
                name: "StoredDocuments");
        }
    }
}
