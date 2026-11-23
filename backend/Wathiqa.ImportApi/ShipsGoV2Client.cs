using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Wathiqa.ImportApi;

/// <summary>
/// ShipsGo Ocean V2. New paid activations use V2 only. Legacy V1.2 request IDs
/// remain distinguishable (unprefixed) so previously-paid shipments are not re-POSTed.
/// Never send the token in a URL or expose it in an exception.
/// </summary>
public sealed class ShipsGoV2Client(IConfiguration configuration, IHostEnvironment environment,
    ILogger<ShipsGoV2Client> logger, IHttpContextAccessor requestContext)
{
    private static readonly HttpClient Http = new(new HttpClientHandler { AllowAutoRedirect = false })
    { Timeout = TimeSpan.FromSeconds(25) };
    private const string ProductionRoot = "https://api.shipsgo.com/v2/";
    private readonly SemaphoreSlim carrierLock = new(1, 1);
    private IReadOnlyList<ShipsGoCarrier>? cachedCarriers;
    private DateTime cacheExpiresUtc;

    private string Root
    {
        get
        {
            var test = configuration["OceanTracking:ShipsGoV2TestBaseUrl"];
            if (environment.IsDevelopment() && Uri.TryCreate(test, UriKind.Absolute, out var uri) &&
                uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback)
                return uri.AbsoluteUri.TrimEnd('/') + "/";
            return ProductionRoot;
        }
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuration["OceanTracking:ShipsGoV2Token"]);
    public bool HasWebhookSecret => !string.IsNullOrWhiteSpace(configuration["OceanTracking:ShipsGoWebhookSecret"]);

    public static bool IsV2Id(string id) =>
        id.StartsWith("v2:", StringComparison.Ordinal) &&
        long.TryParse(id.AsSpan(3), NumberStyles.None, CultureInfo.InvariantCulture, out var number) &&
        number > 0;

    public static string UnwrapId(string id) =>
        IsV2Id(id) ? id[3..] : throw new TrackingProviderException("tracking_provider_invalid_response");

    public async Task<IReadOnlyList<ShipsGoCarrier>> ListCarriersAsync(CancellationToken ct)
    {
        if (cachedCarriers is not null && cacheExpiresUtc > DateTime.UtcNow) return cachedCarriers;
        await carrierLock.WaitAsync(ct);
        try
        {
            if (cachedCarriers is not null && cacheExpiresUtc > DateTime.UtcNow) return cachedCarriers;
            var carriers = new List<ShipsGoCarrier>();
            // A bounded list: max 10 pages. Never use provider-supplied URLs.
            for (var skip = 0; skip < 1000; skip += 100)
            {
                using var json = await GetAsync("ocean/carriers?take=100&skip=" + skip, ct);
                var root = json.RootElement;
                EnsureSuccess(root);
                var items = Prop(root, "carriers");
                if (items.ValueKind != JsonValueKind.Array)
                    throw new TrackingProviderException("tracking_provider_invalid_response");
                foreach (var item in items.EnumerateArray())
                {
                    var scac = Str(item, "scac");
                    var name = Str(item, "name");
                    if (Regex.IsMatch(scac, "^(SG_)?[A-Z0-9]{4}$") && name.Length > 0 &&
                        Str(item, "status") == "ACTIVE")
                        carriers.Add(new ShipsGoCarrier(scac, name));
                }
                if (Prop(Prop(root, "meta"), "more").ValueKind != JsonValueKind.True) break;
            }
            cachedCarriers = carriers.DistinctBy(x => x.Scac).OrderBy(x => x.Name).ToArray();
            cacheExpiresUtc = DateTime.UtcNow.AddHours(6);
            return cachedCarriers;
        }
        finally { carrierLock.Release(); }
    }

    /// <summary>
    /// Reconcile an ambiguous paid create with a free, read-only lookup.
    /// Requires exact Wathiqa reference PLUS the original B/L or container.
    /// Never guesses from an arbitrary provider shipment or issues another POST.
    /// </summary>
    public async Task<string?> FindExistingAsync(Guid shipmentId, string bl,
        IReadOnlyCollection<string> containers, CancellationToken ct)
    {
        var reference = "WATHIQA-" + shipmentId.ToString("N");
        var filter = Uri.EscapeDataString("eq:" + reference);
        using var document = await GetAsync("ocean/shipments?take=100&skip=0&filters%5Breference%5D=" + filter, ct);
        var root = document.RootElement;
        EnsureSuccess(root);
        var items = Prop(root, "shipments");
        if (items.ValueKind != JsonValueKind.Array)
            throw new TrackingProviderException("tracking_provider_invalid_response");
        if (Prop(Prop(root, "meta"), "more").ValueKind == JsonValueKind.True)
            throw new TrackingProviderException("tracking_provider_ambiguous_registration");
        var matches = new List<string>();
        foreach (var item in items.EnumerateArray())
        {
            if (Str(item, "reference") != reference) continue;
            var billMatches = bl.Length > 0 &&
                Str(item, "booking_number").Equals(bl, StringComparison.OrdinalIgnoreCase);
            var containerMatches = containers.Any(number =>
                number.Equals(Str(item, "container_number"), StringComparison.OrdinalIgnoreCase));
            if (!billMatches && !containerMatches) continue;
            var numeric = Prop(item, "id");
            if (numeric.ValueKind == JsonValueKind.Number &&
                numeric.TryGetInt64(out var id) && id > 0)
                matches.Add("v2:" + id.ToString(CultureInfo.InvariantCulture));
        }
        var distinct = matches.Distinct(StringComparer.Ordinal).ToArray();
        return distinct.Length switch
        {
            0 => null,
            1 => distinct[0],
            _ => throw new TrackingProviderException("tracking_provider_ambiguous_registration")
        };
    }

    public async Task<string> RegisterAsync(string bl, string? container, string carrier,
        Guid shipmentId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(bl) && string.IsNullOrWhiteSpace(container))
            throw new TrackingProviderException("tracking_provider_invalid_reference", true);
        if (bl.Length > 0 && !Regex.IsMatch(bl, "^[A-Za-z0-9/-]+$"))
            throw new TrackingProviderException("tracking_provider_invalid_reference", true);
        if (!string.IsNullOrWhiteSpace(container) &&
            !Regex.IsMatch(container, "^[A-Z]{4}[0-9]{7}$"))
            throw new TrackingProviderException("tracking_provider_invalid_reference", true);
        if (carrier.Length > 0)
        {
            if (!Regex.IsMatch(carrier, "^(SG_)?[A-Z0-9]{4}$"))
                throw new TrackingProviderException("tracking_invalid_carrier", true);
            // Validate the SCAC against ShipsGo, before spending a credit.
            IReadOnlyList<ShipsGoCarrier> supported;
            try { supported = await ListCarriersAsync(ct); }
            catch (TrackingProviderException ex)
            {
                // Carrier lookup is a free GET BEFORE any paid POST. Never
                // mark this failed preflight as an ambiguous paid activation.
                throw new TrackingProviderException(ex.Code, true);
            }
            if (!supported.Any(c => c.Scac == carrier))
                throw new TrackingProviderException("tracking_invalid_carrier", true);
        }

        var payload = new Dictionary<string, object?>
        {
            ["reference"] = "WATHIQA-" + shipmentId.ToString("N"),
            ["booking_number"] = string.IsNullOrWhiteSpace(bl) ? null : bl,
            ["container_number"] = string.IsNullOrWhiteSpace(container) ? null : container,
            ["carrier"] = carrier.Length == 0 ? null : carrier
        };
        using var request = NewRequest(HttpMethod.Post, "ocean/shipments");
        request.Content = JsonContent.Create(payload);
        using var response = await SendAsync(request, ct, allowDuplicate: true);
        using var document = await ParseAsync(response, ct);
        var root = document.RootElement;
        var msg = Str(root, "message");
        if (response.StatusCode == HttpStatusCode.Conflict && msg != "ALREADY_EXISTS")
            throw new TrackingProviderException("tracking_provider_invalid_reference", true);
        if (response.IsSuccessStatusCode && msg != "SUCCESS")
            throw new TrackingProviderException("tracking_provider_ambiguous_registration");
        var shipment = Prop(root, "shipment");
        // Never bind a paid Wathiqa B/L to a different provider reference,
        // even if the provider returned HTTP 200 or a duplicate 409.
        if (Str(shipment, "reference") != (string)payload["reference"]! ||
            (bl.Length > 0 && !Str(shipment, "booking_number")
                .Equals(bl, StringComparison.OrdinalIgnoreCase)) ||
            (!string.IsNullOrWhiteSpace(container) &&
             !Str(shipment, "container_number")
                .Equals(container, StringComparison.OrdinalIgnoreCase)))
            throw new TrackingProviderException("tracking_provider_ambiguous_registration");
        var id = Prop(shipment, "id");
        if (id.ValueKind != JsonValueKind.Number || !id.TryGetInt64(out var numericId) || numericId <= 0)
            throw new TrackingProviderException("tracking_provider_ambiguous_registration");
        return "v2:" + numericId.ToString(CultureInfo.InvariantCulture);
    }

    public async Task<TrackingSnapshot> FetchAsync(string providerId, CancellationToken ct)
    {
        var id = UnwrapId(providerId);
        using var document = await GetAsync("ocean/shipments/" + id, ct);
        EnsureSuccess(document.RootElement);
        var shipment = Prop(document.RootElement, "shipment");
        var actualId = Prop(shipment, "id");
        if (actualId.ValueKind != JsonValueKind.Number ||
            !actualId.TryGetInt64(out var received) ||
            received.ToString(CultureInfo.InvariantCulture) != id)
            throw new TrackingProviderException("tracking_provider_invalid_response");
        var snapshot = ParseSnapshot(shipment);
        // This distinguishes "ShipsGo returned NEW" from "Wathiqa failed
        // to parse an already available voyage". No reference/credentials logged.
        logger.LogInformation(
            "SHIPSGO_V2_SNAPSHOT Status={Status} ContainerCount={ContainerCount} " +
            "ParsedContainers={ParsedContainers} MovementCount={MovementCount} " +
            "HasRoute={HasRoute} ProviderUpdatedAtPresent={ProviderUpdatedAtPresent}",
            snapshot.Status, snapshot.ContainerCount, snapshot.Containers?.Count ?? 0,
            snapshot.Events.Count, snapshot.PortOfLoading is not null ||
            snapshot.PortOfDischarge is not null, snapshot.ProviderUpdatedAt is not null);
        // Geographic route is additional data, never a prerequisite for core tracking.
        try
        {
            using var geo = await GetAsync("ocean/shipments/" + id + "/geojson", ct);
            if (Str(geo.RootElement, "message") == "SUCCESS")
            {
                var (position, waypoints, segments) = ParseGeoJson(Prop(geo.RootElement, "geojson"));
                snapshot = snapshot with {
                    Latitude = position?.Latitude, Longitude = position?.Longitude,
                    PositionUpdatedAt = position is null ? null :
                        snapshot.ProviderUpdatedAt ?? snapshot.ProviderCheckedAt,
                    MapWaypoints = waypoints, MapSegments = segments
                };
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (TrackingProviderException) { /* GeoJSON may be unavailable; retain voyage. */ }
        return snapshot;
    }

    public bool VerifyWebhook(ReadOnlySpan<byte> raw, string signature)
    {
        var secret = configuration["OceanTracking:ShipsGoWebhookSecret"];
        if (string.IsNullOrWhiteSpace(secret) || !Regex.IsMatch(signature, "^[0-9a-fA-F]{64}$"))
            return false;
        var expected = System.Security.Cryptography.HMACSHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(secret), raw);
        return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            expected, Convert.FromHexString(signature));
    }

    public static TrackingSnapshot ParseSnapshot(JsonElement shipment)
    {
        if (shipment.ValueKind != JsonValueKind.Object)
            throw new TrackingProviderException("tracking_provider_invalid_response");
        var id = Prop(shipment, "id");
        if (id.ValueKind != JsonValueKind.Number || !id.TryGetInt64(out var numericId) || numericId <= 0)
            throw new TrackingProviderException("tracking_provider_invalid_response");
        var status = Str(shipment, "status");
        if (status.Length == 0)
            throw new TrackingProviderException("tracking_provider_invalid_response");
        var route = Prop(shipment, "route");
        var pol = Prop(route, "port_of_loading");
        var pod = Prop(route, "port_of_discharge");
        var polLoc = Prop(pol, "location");
        var podLoc = Prop(pod, "location");
        var events = new List<TrackingEvent>();
        var containers = new List<TrackedContainer>();
        var providerContainers = Prop(shipment, "containers");
        if (providerContainers.ValueKind == JsonValueKind.Array)
        {
            foreach (var c in providerContainers.EnumerateArray().Take(100))
            {
                var number = Str(c, "number");
                var movementEvents = new List<TrackingEvent>();
                var movements = Prop(c, "movements");
                if (movements.ValueKind == JsonValueKind.Array)
                    foreach (var m in movements.EnumerateArray().Take(200))
                    {
                        var code = Str(m, "event");
                        var actual = Str(m, "status") == "ACT";
                        var ev = new TrackingEvent(number, MovementName(code), code,
                            Str(Prop(m, "location"), "name"), Str(m, "timestamp"), actual,
                            Str(Prop(m, "vessel"), "name"), Str(m, "voyage"));
                        movementEvents.Add(ev);
                        if (events.Count < 500) events.Add(ev);
                    }
                containers.Add(new TrackedContainer(number, Str(c, "status"),
                    Int(c, "size"), NullableStr(c, "type"), movementEvents));
            }
        }
        var ordered = events.OrderByDescending(x => x.Date, StringComparer.Ordinal).ToArray();
        var latestVessel = ordered.FirstOrDefault(x => x.Actual && x.Vessel.Length > 0) ??
                           ordered.FirstOrDefault(x => x.Vessel.Length > 0);
        var actualAtDestination = ordered.FirstOrDefault(x => x.EventCode == "ARRV" && x.Actual &&
            Str(podLoc, "name").Equals(x.Location, StringComparison.OrdinalIgnoreCase));
        var carrier = Prop(shipment, "carrier");
        var tokens = Prop(shipment, "tokens");
        var mapToken = Str(tokens, "map");
        var mapUrl = Guid.TryParse(mapToken, out _) ?
            "https://map.shipsgo.com/ocean/shipments/" + numericId +
            "?token=" + Uri.EscapeDataString(mapToken) : null;
        return new TrackingSnapshot(
            status, Str(carrier, "name"), Str(carrier, "scac"),
            latestVessel?.Vessel ?? "", latestVessel?.Voyage ?? "",
            Day(pol, "date_of_loading"), Day(pod, "date_of_discharge"),
            actualAtDestination is null ? null : Day(actualAtDestination.Date),
            null, null, null, NullableStr(shipment, "updated_at"), ordered,
            NullableStr(shipment, "booking_number"), NullableStr(shipment, "container_number"),
            NullableStr(polLoc, "name"), NullableStr(polLoc, "code"),
            NullableStr(podLoc, "name"), NullableStr(podLoc, "code"),
            Day(pol, "date_of_loading_initial"), Day(pod, "date_of_discharge_initial"),
            Day(pod, "date_of_discharge_predicted"),
            Int(route, "transit_time"), Int(route, "transit_percentage"),
            Int(route, "ts_count"), Double(route, "co2_emission"),
            Int(shipment, "container_count"), NullableStr(shipment, "checked_at"),
            mapUrl, containers);
    }

    private static string MovementName(string code) => code switch
    {
        "EMSH" => "Empty to shipper", "GTIN" => "Gate in", "LOAD" => "Loaded",
        "DEPA" => "Departed", "ARRV" => "Arrived", "DISC" => "Discharged",
        "GTOT" => "Gate out", "EMRT" => "Empty returned", _ => code
    };

    public static (TrackingMapCoordinate? Position,
        IReadOnlyList<TrackingMapWaypoint> Waypoints,
        IReadOnlyList<TrackingMapSegment> Segments) ParseGeoJson(JsonElement geo)
    {
        var features = Prop(geo, "features");
        var waypoints = new List<TrackingMapWaypoint>();
        var segments = new List<TrackingMapSegment>();
        TrackingMapCoordinate? position = null;
        if (features.ValueKind != JsonValueKind.Array)
            return (position, waypoints, segments);
        var totalCoordinates = 0;
        foreach (var f in features.EnumerateArray().Take(100))
        {
            var properties = Prop(f, "properties");
            var geometry = Prop(f, "geometry");
            var status = Str(properties, "status").ToUpperInvariant();
            if (status is not ("CURRENT" or "PAST" or "FUTURE"))
                continue;
            var kind = Str(geometry, "type");
            if (kind == "Point")
            {
                var point = ParseCoordinate(Prop(geometry, "coordinates"));
                if (point is null) continue;
                var name = NullableStr(Prop(properties, "location"), "name");
                waypoints.Add(new TrackingMapWaypoint(point.Latitude, point.Longitude, status, name));
                if (status == "CURRENT") position = point;
            }
            else if (kind == "LineString")
            {
                var coordinates = Prop(geometry, "coordinates");
                if (coordinates.ValueKind != JsonValueKind.Array) continue;
                var route = new List<TrackingMapCoordinate>();
                foreach (var candidate in coordinates.EnumerateArray())
                {
                    if (totalCoordinates >= 3000 || route.Count >= 500) break;
                    var point = ParseCoordinate(candidate);
                    if (point is null) continue;
                    route.Add(point);
                    totalCoordinates++;
                }
                if (route.Count > 1)
                    segments.Add(new TrackingMapSegment(status, route));
                if (status == "CURRENT")
                    position = ParseCoordinate(Prop(Prop(properties, "current"), "coordinates"));
            }
        }
        return (position, waypoints, segments);
    }

    private static TrackingMapCoordinate? ParseCoordinate(JsonElement coordinates)
    {
        if (coordinates.ValueKind != JsonValueKind.Array || coordinates.GetArrayLength() < 2 ||
            coordinates[0].ValueKind != JsonValueKind.Number ||
            coordinates[1].ValueKind != JsonValueKind.Number ||
            !coordinates[0].TryGetDouble(out var longitude) ||
            !coordinates[1].TryGetDouble(out var latitude) ||
            !double.IsFinite(latitude) || !double.IsFinite(longitude) ||
            latitude is < -90 or > 90 || longitude is < -180 or > 180)
            return null;
        return new TrackingMapCoordinate(latitude, longitude);
    }

    private static JsonElement Prop(JsonElement json, string name) =>
        json.ValueKind == JsonValueKind.Object && json.TryGetProperty(name, out var value)
            ? value : default;
    private static string Str(JsonElement json, string field) =>
        Prop(json, field).ValueKind == JsonValueKind.String ?
            (Prop(json, field).GetString() ?? "")[..Math.Min(250, Prop(json, field).GetString()!.Length)] : "";
    private static string? NullableStr(JsonElement json, string field)
    { var s = Str(json, field); return s.Length == 0 ? null : s; }
    private static int? Int(JsonElement json, string field) =>
        Prop(json, field).ValueKind == JsonValueKind.Number && Prop(json, field).TryGetInt32(out var n) ? n : null;
    private static double? Double(JsonElement json, string field) =>
        Prop(json, field).ValueKind == JsonValueKind.Number && Prop(json, field).TryGetDouble(out var n) && double.IsFinite(n) ? n : null;
    private static string? Day(JsonElement json, string field) => Day(Str(json, field));
    private static string? Day(string value) => value.Length >= 10 &&
        DateOnly.TryParseExact(value[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.None, out var d) ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null;

    private HttpRequestMessage NewRequest(HttpMethod method, string path)
    {
        var token = configuration["OceanTracking:ShipsGoV2Token"];
        if (string.IsNullOrWhiteSpace(token))
            throw new TrackingProviderException("tracking_v2_not_configured", true);
        var request = new HttpRequestMessage(method, Root + path);
        request.Headers.TryAddWithoutValidation("X-Shipsgo-User-Token", token.Trim());
        request.Headers.Accept.ParseAdd("application/json");
        return request;
    }

    private async Task<JsonDocument> GetAsync(string path, CancellationToken ct)
    {
        using var request = NewRequest(HttpMethod.Get, path);
        using var response = await SendAsync(request, ct);
        var json = await ParseAsync(response, ct);
        return json;
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
        CancellationToken ct, bool allowDuplicate = false)
    {
        try
        {
            var response = await ProviderHttpConsoleLog.SendAsync(Http, request, ct,
                logger, requestContext, "ShipsGoV2",
                configuration.GetValue("Diagnostics:ConsoleDetailed", true));
            if (response.IsSuccessStatusCode ||
                (allowDuplicate && response.StatusCode == HttpStatusCode.Conflict)) return response;
            var code = response.StatusCode switch
            {
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "tracking_provider_auth_failed",
                HttpStatusCode.PaymentRequired => "tracking_provider_no_credits",
                HttpStatusCode.NotFound => "tracking_provider_no_data",
                HttpStatusCode.TooManyRequests => "tracking_provider_rate_limited",
                HttpStatusCode.BadRequest or HttpStatusCode.UnprocessableEntity =>
                    "tracking_provider_invalid_reference",
                _ => "tracking_provider_unavailable"
            };
            var definitive = response.StatusCode is HttpStatusCode.Unauthorized or
                HttpStatusCode.Forbidden or HttpStatusCode.PaymentRequired or
                HttpStatusCode.BadRequest or HttpStatusCode.UnprocessableEntity or
                HttpStatusCode.NotFound;
            response.Dispose();
            throw new TrackingProviderException(code, definitive);
        }
        catch (TrackingProviderException) { throw; }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { throw new TrackingProviderException("tracking_provider_timeout"); }
        catch (HttpRequestException)
        { throw new TrackingProviderException("tracking_provider_unavailable"); }
    }

    private static async Task<JsonDocument> ParseAsync(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.Content.Headers.ContentLength is > 4_000_000)
            throw new TrackingProviderException("tracking_provider_invalid_response");
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var buffer = new MemoryStream();
            var bytes = new byte[16384];
            int count;
            while ((count = await stream.ReadAsync(bytes, ct)) > 0)
            {
                if (buffer.Length + count > 4_000_000)
                    throw new TrackingProviderException("tracking_provider_invalid_response");
                buffer.Write(bytes, 0, count);
            }
            buffer.Position = 0;
            return await JsonDocument.ParseAsync(buffer,
                new JsonDocumentOptions { MaxDepth = 40 }, ct);
        }
        catch (JsonException)
        { throw new TrackingProviderException("tracking_provider_invalid_response"); }
    }

    private static void EnsureSuccess(JsonElement root)
    {
        if (Str(root, "message") != "SUCCESS")
            throw new TrackingProviderException("tracking_provider_invalid_response");
    }
}
public sealed record ShipsGoCarrier(string Scac, string Name);
