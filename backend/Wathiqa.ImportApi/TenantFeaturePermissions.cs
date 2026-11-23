using System.Text.Json;

namespace Wathiqa.ImportApi;

/// <summary>
/// Per-user, tenant-owned visibility. Null means pre-rollout legacy Staff:
/// retain the prior access until their tenant Admin customizes it.
/// A non-null JSON list is an EXPLICIT allow-list (including an empty list).
/// Live DB values are read by TenantAccessHandler on every protected request.
/// </summary>
public static class TenantFeaturePermissions
{
    public const string RequestRightsKey = "wathiqa.import.request-rights";
    public const string Dashboard = "nav.dashboard";
    public const string Orders = "nav.orders";
    public const string References = "nav.reference";
    public const string Operations = "nav.operations";
    public const string Companies = "nav.companies";
    public const string Info = "tab.info";
    public const string Payments = "tab.payments";
    public const string BillOfLading = "tab.bl";
    public const string Customs = "tab.customs";
    public const string Tracking = "tab.tracking";
    public const string DocumentView = "documents.view";
    public const string DocumentUpload = "documents.upload";

    public static readonly string[] All =
    [
        Dashboard, Orders, References, Operations, Companies,
        Info, Payments, BillOfLading, Customs, Tracking,
        DocumentView, DocumentUpload
    ];

    private static readonly HashSet<string> Recognized =
        new(All, StringComparer.Ordinal);

    public static string[] Effective(ImportUser user, bool admin)
    {
        if (admin || user.AccessPermissionsJson is null) return All.ToArray();
        try
        {
            var data = JsonSerializer.Deserialize<string[]>(user.AccessPermissionsJson);
            if (data is null || data.Any(x => x is null || !Recognized.Contains(x)))
                return [];
            return data.Distinct(StringComparer.Ordinal).ToArray();
        }
        catch (JsonException)
        {
            // Invalid stored JSON must never grant broad access.
            return [];
        }
    }

    public static bool IsValid(IReadOnlyList<string>? requested)
    {
        if (requested is null || requested.Count > All.Length) return false;
        var unique = new HashSet<string>(StringComparer.Ordinal);
        return requested.All(x => x is not null && Recognized.Contains(x) &&
                                  unique.Add(x));
    }

    public static string Serialize(IReadOnlyList<string> requested) =>
        JsonSerializer.Serialize(requested.OrderBy(x => x, StringComparer.Ordinal));

    // Populated only by the server-side authorization handler, never by
    // headers, body fields or cached claims.
    public static bool GrantedToRequest(HttpContext http, string key) =>
        http.Items.TryGetValue(RequestRightsKey, out var value) &&
        value is string[] rights && rights.Contains(key, StringComparer.Ordinal);

    /// <summary>
    /// Every tenant-protected API endpoint is classified centrally. Unknown
    /// endpoints default to denied for Staff, never to a permissive fallback.
    /// Implicit Admin access is checked by the authorization handler itself.
    /// </summary>
    public static bool RequestAllowed(ImportUser user, HttpContext? http)
    {
        if (http is null) return false;
        var permitted = new HashSet<string>(Effective(user, false), StringComparer.Ordinal);
        bool Has(string key) => permitted.Contains(key);
        bool Order(string tab) => Has(Orders) && Has(tab);
        bool AnyOrderTab() => Has(Info) || Has(Payments) || Has(BillOfLading) ||
                              Has(Customs) || Has(Tracking);
        var path = (http.Request.Path.Value ?? "").TrimEnd('/').ToLowerInvariant();
        var method = http.Request.Method.ToUpperInvariant();
        var read = method is "GET" or "HEAD";

        // Session and staff-profile operations have their own TenantAdmin,
        // authentication, and CSRF policies. Never expose other business data.
        if (path is "/api/auth/me" or "/api/auth/logout") return true;
        if (path.StartsWith("/api/users/", StringComparison.Ordinal) ||
            path == "/api/users") return false; // Admin policy is separate.
        if (path.StartsWith("/api/_diagnostics/", StringComparison.Ordinal))
            return false;

        if (path.StartsWith("/api/dashboard/", StringComparison.Ordinal))
            return Has(Dashboard);

        if (path == "/api/orders")
            return read ? Has(Orders) : Order(Info);
        if (path.StartsWith("/api/orders/", StringComparison.Ordinal))
        {
            var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (segments.Length == 3) // GET/PUT/DELETE /api/orders/{id}
                return read ? Has(Orders) && AnyOrderTab() : Order(Info);
            if (segments.Length < 4) return false;
            var sub = segments[3];
            if (sub is "shipments")
                return read ? Has(Orders) &&
                    (Has(BillOfLading) || Has(Customs) || Has(DocumentView))
                    : Order(BillOfLading);
            if (sub is "finances" or "payment-audits" or "payment-schedules" or
                "payment-transfers" or "expenses") return Order(Payments);
            if (sub is "close" or "cancel") return Order(Info) && Has(Payments);
            return false;
        }

        if (path.StartsWith("/api/shipments/", StringComparison.Ordinal))
        {
            var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var sub = segments.Length >= 4 ? segments[3] : "";
            if (sub == "tracking") return Order(Tracking);
            if (sub == "clearance") return Order(Customs);
            // Shipment details include B/L and containers; dedicated customs
            // endpoint above covers customs-only operations.
            if (sub == "containers" || segments.Length == 3) return Order(BillOfLading);
            return false;
        }
        if (path.StartsWith("/api/containers/", StringComparison.Ordinal))
            return Order(BillOfLading);
        if (path.StartsWith("/api/tracking/", StringComparison.Ordinal))
            return Order(Tracking);

        if (path == "/api/companies/options")
            return read && (Has(Companies) || Has(References) || Has(Orders));
        if (path == "/api/companies/quick")
            return method == "POST" && Order(Info);
        if (path == "/api/companies" ||
            path.StartsWith("/api/companies/", StringComparison.Ordinal))
            return Has(Companies) || Has(References);
        if (path == "/api/ports" ||
            path.StartsWith("/api/ports/", StringComparison.Ordinal))
            return Has(References) || Order(Info);

        if (path == "/api/documents" ||
            path.StartsWith("/api/documents/", StringComparison.Ordinal) ||
            path.StartsWith("/api/document-links/", StringComparison.Ordinal))
            return read ? Has(DocumentView) : Has(DocumentUpload);
        if (path == "/api/document-requirements" ||
            path.StartsWith("/api/document-requirements/", StringComparison.Ordinal) ||
            path.StartsWith("/api/document-waivers/", StringComparison.Ordinal))
            return read ? Has(DocumentView) : Has(DocumentUpload);

        if (path.StartsWith("/api/operations/", StringComparison.Ordinal))
            return Has(Operations);

        // Future tenant endpoints must be consciously mapped to a right.
        return false;
    }
}
