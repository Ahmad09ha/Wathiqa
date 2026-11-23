using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

public static class PlatformSecurity
{
    public const string Scheme = "Wathiqa.Platform";
    public const string Policy = "PlatformSuperAdmin";
    public const string Role = "SuperAdmin";

    public static Guid OperatorId(ClaimsPrincipal principal)
    {
        if (!Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
            || id == Guid.Empty || !principal.IsInRole(Role)
            || principal.FindFirstValue("platform_control") != "true")
            throw new UnauthorizedAccessException("No valid platform SuperAdmin identity.");
        return id;
    }

    public static async Task ValidateSession(CookieValidatePrincipalContext context)
    {
        var userId = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var stamp = context.Principal?.FindFirstValue("platform_stamp");
        var principal = context.Principal;
        if (!Guid.TryParse(userId, out var id) || id == Guid.Empty ||
            string.IsNullOrWhiteSpace(stamp) || principal?.FindFirstValue("platform_control") != "true" ||
            !principal.IsInRole(Role))
        {
            await Reject();
            return;
        }
        var db = context.HttpContext.RequestServices.GetRequiredService<ImportDb>();
        if (!await db.PlatformOperators.AsNoTracking().AnyAsync(p =>
            p.Id == id && p.IsActive && p.Role == Role && p.SecurityStamp == stamp))
            await Reject();

        async Task Reject()
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(Scheme);
        }
    }

    public static ClaimsPrincipal Principal(PlatformOperator actor)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, actor.Id.ToString("D")),
            new Claim(ClaimTypes.Name, actor.Email),
            new Claim(ClaimTypes.Role, Role),
            new Claim("platform_control", "true"),
            new Claim("platform_stamp", actor.SecurityStamp)
        };
        return new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme));
    }
}
