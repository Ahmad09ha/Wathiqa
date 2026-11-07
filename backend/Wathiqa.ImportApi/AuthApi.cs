using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.WebUtilities;

namespace Wathiqa.ImportApi;

public sealed record LoginRequest(string Email, string Password);
public sealed record InviteRequest(string Email);
public sealed record AcceptInvitationRequest(string Token, string DisplayName, string Password);
public sealed record UpdatePaymentPermissionRequest(bool CanManagePayments);
public sealed record UpdateUserActiveRequest(bool IsActive);

public static class AuthApi
{
    public static void Map(WebApplication app)
    {
        app.MapPost("/api/auth/login", async (
            LoginRequest body, UserManager<ImportUser> users,
            SignInManager<ImportUser> signIn, ImportDb db) =>
        {
            var email = body.Email?.Trim() ?? "";
            if (email.Length is < 3 or > 254 || body.Password is null) return Results.Unauthorized();
            var user = await users.FindByEmailAsync(email);
            if (user is null || !user.IsActive) return Results.Unauthorized();
            // Only disclose the expiry after verifying credentials; otherwise
            // an attacker could enumerate trial accounts from email alone.
            var attempt = await signIn.CheckPasswordSignInAsync(user, body.Password, lockoutOnFailure: true);
            if (!attempt.Succeeded) return Results.Unauthorized();
            var tenant = await db.Tenants.AsNoTracking().SingleOrDefaultAsync(x => x.Id == user.TenantId);
            if (tenant is null || !tenant.IsActive) return Results.Unauthorized();
            if (!TenantAccess.Allowed(tenant, DateTime.UtcNow))
                return Results.Json(new { error = "account_expired" }, statusCode: StatusCodes.Status403Forbidden);
            await signIn.SignInAsync(user, isPersistent: false);
            return Results.Ok(new { message = "تم تسجيل الدخول." });
        }).AllowAnonymous().RequireRateLimiting("auth");

        app.MapPost("/api/auth/logout", async (SignInManager<ImportUser> signIn) =>
        {
            await signIn.SignOutAsync();
            return Results.NoContent();
        }).RequireAuthorization();

        app.MapGet("/api/auth/me", async (
            System.Security.Claims.ClaimsPrincipal principal,
            ImportDb db, UserManager<ImportUser> users) =>
        {
            var tenantId = CurrentTenant.Id(principal);
            var userId = CurrentTenant.UserId(principal);
            var user = await db.Users.AsNoTracking().SingleAsync(x => x.Id == userId && x.TenantId == tenantId);
            var tenant = await db.Tenants.AsNoTracking().SingleAsync(x => x.Id == tenantId);
            var admin = await users.IsInRoleAsync(user, "Admin");
            return Results.Ok(new
            {
                user.Id, user.Email, user.DisplayName, TenantId = tenantId,
                tenant.Name, tenant.Slug, Role = admin ? "Admin" : "Staff",
                CanManagePayments = admin || user.CanManagePayments,
                tenant.AccessExpiresAtUtc
            });
        }).RequireAuthorization("TenantMember");

        app.MapGet("/api/users", async (
            System.Security.Claims.ClaimsPrincipal principal, ImportDb db,
            UserManager<ImportUser> users) =>
        {
            var tenantId = CurrentTenant.Id(principal);
            var members = await db.Users.AsNoTracking().Where(x => x.TenantId == tenantId)
                .OrderBy(x => x.Email).ToListAsync();
            var output = new List<object>();
            foreach (var user in members)
            {
                var isAdmin = await users.IsInRoleAsync(user, "Admin");
                output.Add(new { user.Id, user.Email, user.DisplayName, user.IsActive,
                    Role = isAdmin ? "Admin" : "Staff",
                    CanManagePayments = isAdmin || user.CanManagePayments });
            }
            return Results.Ok(output);
        }).RequireAuthorization("TenantAdmin");

        app.MapPost("/api/users/invitations", async (
            InviteRequest body, System.Security.Claims.ClaimsPrincipal principal,
            ImportDb db, UserManager<ImportUser> users) =>
        {
            var email = body.Email?.Trim().ToLowerInvariant() ?? "";
            if (email.Length is < 3 or > 254 || !email.Contains('@'))
                return Results.BadRequest(new { error = "invalid_email" });
            if (await users.FindByEmailAsync(email) is not null)
                return Results.Conflict(new { error = "email_already_registered" });
            var tenantId = CurrentTenant.Id(principal);
            var pending = await db.TenantInvitations
                .AnyAsync(x => x.TenantId == tenantId && x.Email == email
                    && x.UsedAtUtc == null && x.ExpiresAtUtc > DateTime.UtcNow);
            if (pending) return Results.Conflict(new { error = "invitation_already_pending" });

            var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
            var invite = new TenantInvitation
            {
                TenantId = tenantId, CreatedById = CurrentTenant.UserId(principal),
                Email = email, TokenHash = Hash(token),
                ExpiresAtUtc = DateTime.UtcNow.AddHours(48)
            };
            db.TenantInvitations.Add(invite);
            await db.SaveChangesAsync();
            return Results.Ok(new
            {
                message = "تم إنشاء الدعوة. يظهر الرمز لمرة واحدة فقط؛ شاركه عبر قناة آمنة.",
                token, invite.ExpiresAtUtc
            });
        }).RequireAuthorization("TenantAdmin");

        app.MapPost("/api/auth/invitations/accept", async (
            AcceptInvitationRequest body, ImportDb db, UserManager<ImportUser> users) =>
        {
            if (string.IsNullOrWhiteSpace(body.Token) || body.Token.Length > 256)
                return Results.BadRequest(new { error = "invalid_invitation" });
            var name = body.DisplayName?.Trim() ?? "";
            if (name.Length is < 2 or > 160)
                return Results.BadRequest(new { error = "invalid_display_name" });
            var digest = Hash(body.Token);
            var now = DateTime.UtcNow;
            await using var transaction = await db.Database.BeginTransactionAsync();
            // Atomic claim prevents a second use under concurrent requests.
            var claimed = await db.TenantInvitations
                .Where(x => x.TokenHash == digest && x.UsedAtUtc == null && x.ExpiresAtUtc > now)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.UsedAtUtc, now));
            if (claimed != 1) return Results.BadRequest(new { error = "invalid_or_expired_invitation" });
            var invite = await db.TenantInvitations.AsNoTracking()
                .SingleAsync(x => x.TokenHash == digest);
            if (!await db.Tenants.AnyAsync(t => t.Id == invite.TenantId && t.IsActive &&
                (t.AccessExpiresAtUtc == null || t.AccessExpiresAtUtc > now)))
                return Results.BadRequest(new { error = "invalid_invitation" });
            var user = new ImportUser
            {
                TenantId = invite.TenantId, UserName = invite.Email,
                Email = invite.Email, DisplayName = name, EmailConfirmed = true
            };
            var created = await users.CreateAsync(user, body.Password ?? "");
            if (!created.Succeeded)
                return Results.BadRequest(new
                {
                    error = "invalid_user_or_password",
                    details = created.Errors.Select(e => e.Code).ToArray()
                });
            var roleResult = await users.AddToRoleAsync(user, "Staff");
            if (!roleResult.Succeeded) throw new InvalidOperationException("Staff role setup failed.");
            await transaction.CommitAsync();
            return Results.Created("/api/auth/me", new { message = "تم إنشاء حساب الموظف.", user.Id });
        }).AllowAnonymous().RequireRateLimiting("auth");

        app.MapPut("/api/users/{id:guid}/payment-permission", async (
            Guid id, UpdatePaymentPermissionRequest body,
            System.Security.Claims.ClaimsPrincipal principal,
            ImportDb db, UserManager<ImportUser> users) =>
        {
            var tenantId = CurrentTenant.Id(principal);
            var user = await db.Users.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId);
            if (user is null) return Results.NotFound();
            if (await users.IsInRoleAsync(user, "Admin"))
                return Results.BadRequest(new { error = "admin_permission_is_implicit" });
            var prior = user.CanManagePayments;
            user.CanManagePayments = body.CanManagePayments;
            if (prior != body.CanManagePayments)
            {
                db.SecurityAudits.Add(new SecurityAudit
                {
                    TenantId = tenantId, ActorId = CurrentTenant.UserId(principal),
                    TargetUserId = id, Action = "CanManagePayments",
                    PreviousValue = prior.ToString(), NewValue = body.CanManagePayments.ToString()
                });
            }
            await db.SaveChangesAsync();
            return Results.Ok(new { user.Id, user.CanManagePayments });
        }).RequireAuthorization("TenantAdmin");

        app.MapPut("/api/users/{id:guid}/active", async (
            Guid id, UpdateUserActiveRequest body,
            System.Security.Claims.ClaimsPrincipal principal, ImportDb db) =>
        {
            var tenantId = CurrentTenant.Id(principal);
            var actorId = CurrentTenant.UserId(principal);
            var user = await db.Users.SingleOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId);
            if (user is null) return Results.NotFound();
            if (user.Id == actorId) return Results.BadRequest(new { error = "cannot_deactivate_self" });
            if (user.IsActive != body.IsActive)
            {
                db.SecurityAudits.Add(new SecurityAudit
                {
                    TenantId = tenantId, ActorId = actorId,
                    TargetUserId = id, Action = "UserActive",
                    PreviousValue = user.IsActive.ToString(), NewValue = body.IsActive.ToString()
                });
                user.IsActive = body.IsActive;
                await db.SaveChangesAsync();
            }
            return Results.Ok(new { user.Id, user.IsActive });
        }).RequireAuthorization("TenantAdmin");

        // Non-mutating diagnostic, only in local development. NOT a payment API.
        if (app.Environment.IsDevelopment())
            app.MapPost("/api/_diagnostics/verify-payment-permission", () => Results.NoContent())
                .RequireAuthorization("CanManagePayments");
    }

    private static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
