using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Wathiqa.ImportApi.Migrations
{
    /// <inheritdoc />
    public partial class TenantGranularStaffPermissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "PreviousValue",
                table: "SecurityAudits",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100);

            migrationBuilder.AlterColumn<string>(
                name: "NewValue",
                table: "SecurityAudits",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100);

            migrationBuilder.AddColumn<string>(
                name: "AccessPermissionsJson",
                table: "AspNetUsers",
                type: "character varying(1200)",
                maxLength: 1200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AccessPermissionsJson",
                table: "AspNetUsers");

            migrationBuilder.AlterColumn<string>(
                name: "PreviousValue",
                table: "SecurityAudits",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000);

            migrationBuilder.AlterColumn<string>(
                name: "NewValue",
                table: "SecurityAudits",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(1000)",
                oldMaxLength: 1000);
        }
    }
}
