using System.Threading.RateLimiting;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography.X509Certificates;
using System.Net;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Wathiqa.ImportApi;

var builder = WebApplication.CreateBuilder(args);
var connection = builder.Configuration.GetConnectionString("ImportDatabase");
if (string.IsNullOrWhiteSpace(connection))
    throw new InvalidOperationException("ConnectionStrings:ImportDatabase is required. Never use the old document-editor database.");
var databaseName = new NpgsqlConnectionStringBuilder(connection).Database;
if (databaseName is "hussam_templates" or "wathiqa_docs")
    throw new InvalidOperationException("The import API must never connect to the old editor database.");

// Same-origin Next.js reverse proxy terminates HTTPS before forwarding to
// Kestrel. Never trust X-Forwarded-Proto or X-Forwarded-For from arbitrary
// clients. Forwarding requires an explicit, audited list of immediate
// proxy IP addresses in production, and supports exactly one trusted hop.
if (!builder.Environment.IsDevelopment())
{
    var configured = builder.Configuration["ReverseProxy:KnownProxies"];
    if (string.IsNullOrWhiteSpace(configured))
        throw new InvalidOperationException(
            "ReverseProxy:KnownProxies is required outside Development.");
    var proxies = configured.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
    if (proxies.Length is < 1 or > 8)
        throw new InvalidOperationException("ReverseProxy:KnownProxies must contain 1-8 explicit IP addresses.");
    var parsed = new List<IPAddress>();
    foreach (var proxy in proxies)
    {
        if (!IPAddress.TryParse(proxy, out var address))
            throw new InvalidOperationException(
                "ReverseProxy:KnownProxies accepts only numeric IP addresses, not network wildcards or hostnames.");
        parsed.Add(address);
    }
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedFor;
        options.ForwardLimit = 1;
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
        foreach (var proxy in parsed) options.KnownProxies.Add(proxy);
    });
}

// ASP.NET Core cookies and CSRF tokens rely on the Data Protection key ring.
// In containers the default ephemeral key ring can log everyone out on
// restart; force an explicitly mounted persistent private volume outside
// the app tree for every non-development environment.
var keyPath = builder.Configuration["DataProtection:KeysPath"];
if (string.IsNullOrWhiteSpace(keyPath) && !builder.Environment.IsDevelopment())
    throw new InvalidOperationException(
        "DataProtection:KeysPath is required outside Development and must be a persistent private volume.");
if (!string.IsNullOrWhiteSpace(keyPath))
{
    if (!Path.IsPathFullyQualified(keyPath))
        throw new InvalidOperationException("DataProtection:KeysPath must be an absolute path.");
    var fullKeyPath = Path.GetFullPath(keyPath);
    var appPath = Path.GetFullPath(builder.Environment.ContentRootPath)
        .TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    if (fullKeyPath.StartsWith(appPath, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("DataProtection:KeysPath cannot be inside the app directory.");
    Directory.CreateDirectory(fullKeyPath);
    var dataProtection = builder.Services.AddDataProtection()
        .SetApplicationName("Wathiqa.Import")
        .PersistKeysToFileSystem(new DirectoryInfo(fullKeyPath));
    if (!builder.Environment.IsDevelopment())
    {
        // When key persistence is customized ASP.NET Core does NOT encrypt
        // keys at rest automatically. Require a separate, protected PFX
        // certificate in every public/non-development deployment.
        var certificatePath = builder.Configuration["DataProtection:CertificatePath"];
        var certificatePassword = builder.Configuration["DataProtection:CertificatePassword"];
        if (string.IsNullOrWhiteSpace(certificatePath) ||
            string.IsNullOrEmpty(certificatePassword))
            throw new InvalidOperationException(
                "DataProtection:CertificatePath and DataProtection:CertificatePassword are required outside Development.");
        if (!Path.IsPathFullyQualified(certificatePath) || !File.Exists(certificatePath))
            throw new InvalidOperationException(
                "DataProtection:CertificatePath must point to an existing absolute PFX file.");
        var fullCertificatePath = Path.GetFullPath(certificatePath);
        if (fullCertificatePath.StartsWith(appPath,StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "DataProtection:CertificatePath cannot be inside the app directory.");
        var certificate = X509CertificateLoader.LoadPkcs12FromFile(
            fullCertificatePath,certificatePassword,X509KeyStorageFlags.EphemeralKeySet);
        if (!certificate.HasPrivateKey)
            throw new InvalidOperationException(
                "DataProtection certificate must contain the private encryption key.");
        dataProtection.ProtectKeysWithCertificate(certificate);
    }
}

builder.Services.AddHttpContextAccessor();
builder.Services.AddDbContext<ImportDb>(options => options.UseNpgsql(connection));
builder.Services.AddSingleton<IUploadThreatScanner,ClamAvUploadThreatScanner>();
builder.Services.AddSingleton<IPrivateDocumentStore,PrivateDocumentStore>();
builder.Services.AddSingleton<SeaRatesTrackingClient>();
builder.Services.Configure<FormOptions>(options=>{
    options.MultipartBodyLengthLimit=PrivateDocumentStore.MaxRequestBytes;
    options.MemoryBufferThreshold=64*1024;
    options.ValueLengthLimit=4096;
    options.ValueCountLimit=100;
});
builder.Services.AddIdentityCore<ImportUser>(options =>
    {
        options.Password.RequiredLength = 12;
        options.Password.RequireDigit = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireNonAlphanumeric = true;
        options.User.RequireUniqueEmail = true;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        options.Lockout.MaxFailedAccessAttempts = 6;
        options.SignIn.RequireConfirmedEmail = false; // manually trusted invitations only
    })
    .AddRoles<IdentityRole<Guid>>()
    .AddSignInManager()
    .AddClaimsPrincipalFactory<TenantClaimsFactory>()
    .AddEntityFrameworkStores<ImportDb>()
    .AddDefaultTokenProviders();
builder.Services.AddScoped<IPasswordHasher<PlatformOperator>, PasswordHasher<PlatformOperator>>();

builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme)
    .AddIdentityCookies();
builder.Services.AddAuthentication()
    .AddCookie(PlatformSecurity.Scheme, options =>
    {
        options.Cookie.Name = builder.Environment.IsDevelopment()
            ? "wathiqa.platform.session" : "__Secure-wathiqa.platform.session";
        // Browser calls go through /import-api; a merchant's APIs never need
        // or receive a platform identity. In production use HTTPS-only.
        options.Cookie.Path = "/import-api/api/platform";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        options.ExpireTimeSpan = TimeSpan.FromHours(4);
        options.SlidingExpiration = false;
        options.Events.OnValidatePrincipal = PlatformSecurity.ValidateSession;
        options.Events.OnRedirectToLogin = ctx =>
        {
            ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = ctx =>
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });
builder.Services.Configure<SecurityStampValidatorOptions>(o => o.ValidationInterval = TimeSpan.Zero);
builder.Services.Configure<CookieAuthenticationOptions>(IdentityConstants.ApplicationScheme, options =>
{
    options.Cookie.Name = builder.Environment.IsDevelopment()
        ? "wathiqa.import.session" : "__Host-wathiqa.import.session";
    options.Cookie.Path = "/";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    options.ExpireTimeSpan = TimeSpan.FromHours(8);
    options.SlidingExpiration = false;
    options.Events.OnValidatePrincipal = async ctx =>
    {
        // Keep Identity's security-stamp validation active on every request.
        await SecurityStampValidator.ValidatePrincipalAsync(ctx);
        if (ctx.Principal?.Identity?.IsAuthenticated != true) return;
        var principal = ctx.Principal;
        if (!Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) ||
            !Guid.TryParse(principal.FindFirstValue("tenant_id"), out var tenantId))
        {
            ctx.RejectPrincipal();
            await ctx.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
            return;
        }
        // A pre-expiration cookie must NOT outlive the saved entitlement.
        var db = ctx.HttpContext.RequestServices.GetRequiredService<ImportDb>();
        var now = DateTime.UtcNow;
        var allowed = await db.Users.AsNoTracking().AnyAsync(u =>
            u.Id == userId && u.TenantId == tenantId && u.IsActive && u.Tenant.IsActive &&
            (u.Tenant.AccessExpiresAtUtc == null || u.Tenant.AccessExpiresAtUtc > now));
        if (!allowed)
        {
            ctx.RejectPrincipal();
            await ctx.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
        }
    };
    options.Events.OnRedirectToLogin = ctx =>
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    };
    options.Events.OnRedirectToAccessDenied = ctx =>
    {
        ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    };
});
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser().Build())
    .AddPolicy("TenantMember", policy => policy.RequireAuthenticatedUser()
        .AddRequirements(new TenantRequirement(TenantPermission.Member)))
    .AddPolicy("TenantAdmin", policy => policy.RequireAuthenticatedUser()
        .AddRequirements(new TenantRequirement(TenantPermission.Admin)))
    .AddPolicy("CanManagePayments", policy => policy.RequireAuthenticatedUser()
        .AddRequirements(new TenantRequirement(TenantPermission.ManagePayments)))
    .AddPolicy(PlatformSecurity.Policy, policy => policy
        .AddAuthenticationSchemes(PlatformSecurity.Scheme)
        .RequireAuthenticatedUser()
        .RequireRole(PlatformSecurity.Role)
        .RequireClaim("platform_control", "true"));
builder.Services.AddScoped<IAuthorizationHandler, TenantAccessHandler>();

builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-Wathiqa-CSRF";
    options.Cookie.Name = "wathiqa.import.antiforgery";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddFixedWindowLimiter("auth", policy =>
    {
        policy.PermitLimit = 15;
        policy.Window = TimeSpan.FromMinutes(1);
        policy.QueueLimit = 0;
        policy.AutoReplenishment = true;
    });
});

var app = builder.Build();
// Force validation of private volume and AV configuration at startup, not
// at the first uploaded file. Non-development deployments fail closed.
_ = app.Services.GetRequiredService<IPrivateDocumentStore>();
if (!app.Environment.IsDevelopment())
{
    app.UseForwardedHeaders();
    app.Use(async (context, next) =>
    {
        // Internal liveness probes may use plain HTTP; all browser-facing
        // paths require the original HTTPS scheme. Without correctly
        // configured trusted forwarding, fail closed with 400 instead of
        // leaking insecure auth/CSRF cookies or raising a 500.
        if (!context.Request.IsHttps &&
            !context.Request.Path.Equals("/api/health", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(new { error = "https_required" });
            return;
        }
        await next();
    });
}
if (args.Contains("--bootstrap", StringComparer.OrdinalIgnoreCase))
{
    await Bootstrap.RunAsync(app.Services);
    return;
}
var seedAccessCli = args.Contains("--seed-access-accounts", StringComparer.OrdinalIgnoreCase);
if (seedAccessCli || string.Equals(
    Environment.GetEnvironmentVariable("WATHIQA_SEED_ACCESS_ACCOUNTS"),
    "true", StringComparison.OrdinalIgnoreCase))
{
    await AccessAccountSeeder.RunAsync(app.Services);
    if (seedAccessCli) return;
}
if (args.Contains("--seed-superadmin", StringComparer.OrdinalIgnoreCase))
{
    await PlatformSuperAdminSeeder.RunAsync(app.Services);
    return;
}
app.UseAuthentication();

// Cross-site request forgery protection also covers JSON, PUT and DELETE.
// A token is issued by GET /api/auth/csrf; unsafe calls pass it by header.
// Don't exempt a write endpoint even if it currently has no user session.
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api")
        && !HttpMethods.IsGet(context.Request.Method)
        && !HttpMethods.IsHead(context.Request.Method)
        && !HttpMethods.IsOptions(context.Request.Method))
    {
        var antiforgery = context.RequestServices.GetRequiredService<IAntiforgery>();
        try
        {
            await antiforgery.ValidateRequestAsync(context);
        }
        catch (AntiforgeryValidationException)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(new
            {
                error = "csrf_invalid",
                message = "رمز أمان الجلسة غير صالح. حدّث الصفحة وأعد المحاولة."
            });
            return;
        }
    }
    await next();
});
app.UseRateLimiter();
app.UseAuthorization();

app.MapGet("/api/health", async (ImportDb db) =>
    await db.Database.CanConnectAsync()
        ? Results.Ok(new { status = "ok", database = "connected", product = "Wathiqa Import" })
        : Results.Problem("Database is unavailable.", statusCode: 503))
    .AllowAnonymous();

app.MapGet("/api/auth/csrf", (HttpContext context, IAntiforgery antiforgery) =>
{
    var token = antiforgery.GetAndStoreTokens(context);
    context.Response.Headers.CacheControl = "no-store";
    return Results.Ok(new { token = token.RequestToken });
}).AllowAnonymous();

AuthApi.Map(app);
PlatformApi.Map(app);
ManualSubscriptionsApi.Map(app);
CompanyApi.Map(app);
OrderApi.Map(app);
PaymentApi.Map(app);
LogisticsApi.Map(app);
TrackingApi.Map(app);
DocumentsApi.Map(app);
OperationsApi.Map(app);

app.MapGet("/", () => Results.Redirect("/api/health")).AllowAnonymous();
await app.RunAsync();

// Integration tests can reference Program with WebApplicationFactory.
public partial class Program;
