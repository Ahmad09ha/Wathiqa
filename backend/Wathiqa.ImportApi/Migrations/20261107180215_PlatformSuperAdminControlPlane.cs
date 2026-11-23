using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wathiqa.ImportApi.Migrations
{
    /// <inheritdoc />
    public partial class PlatformSuperAdminControlPlane : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PlatformRevision",
                table: "Tenants",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.CreateTable(
                name: "PlatformOperators",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    PasswordHash = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    Role = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SecurityStamp = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    FailedSignInCount = table.Column<int>(type: "integer", nullable: false),
                    LockoutUntilUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSignInAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlatformOperators", x => x.Id);
                    table.CheckConstraint("CK_Platform_OnlySuperAdmin", "\"Role\" = 'SuperAdmin'");
                });

            migrationBuilder.CreateTable(
                name: "PlatformAudits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OperatorId = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: true),
                    TargetUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Action = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    BeforeJson = table.Column<string>(type: "text", nullable: false),
                    AfterJson = table.Column<string>(type: "text", nullable: false),
                    OccurredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlatformAudits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PlatformAudits_PlatformOperators_OperatorId",
                        column: x => x.OperatorId,
                        principalTable: "PlatformOperators",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Tenant_PlatformRevision",
                table: "Tenants",
                sql: "\"PlatformRevision\" >= 1");

            migrationBuilder.CreateIndex(
                name: "IX_PlatformAudits_OperatorId_OccurredAtUtc",
                table: "PlatformAudits",
                columns: new[] { "OperatorId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_PlatformAudits_TenantId_OccurredAtUtc",
                table: "PlatformAudits",
                columns: new[] { "TenantId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_PlatformOperators_Email",
                table: "PlatformOperators",
                column: "Email",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PlatformAudits");

            migrationBuilder.DropTable(
                name: "PlatformOperators");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Tenant_PlatformRevision",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "PlatformRevision",
                table: "Tenants");
        }
    }
}
