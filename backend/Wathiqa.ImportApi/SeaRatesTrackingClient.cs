using System.Globalization;
using System.Net;
using System.Text.Json;

namespace Wathiqa.ImportApi;

public sealed class TrackingProviderException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

/// <summary>
/// Narrow, replaceable SeaRates v3 integration. The API key never crosses the
/// server boundary. No user-supplied URL is ever fetched.
/// </summary>
public sealed class SeaRatesTrackingClient(IConfiguration configuration)
{
    private static readonly HttpClient Client = new()
    {
        Timeout = TimeSpan.FromSeconds(25)
    };

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(configuration["OceanTracking:SeaRatesApiKey"]);

    public async Task<TrackingSnapshot> FetchAsync(
        string type, string number, string carrier, CancellationToken ct)
    {
        var apiKey = configuration["OceanTracking:SeaRatesApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new TrackingProviderException("tracking_not_configured");

        // All parameters are validated by the endpoint. No untrusted base URL
        // or open redirect is allowed.
        var query = "api_key=" + Uri.EscapeDataString(apiKey)
            + "&number=" + Uri.EscapeDataString(number)
            + "&type=" + Uri.EscapeDataString(type)
            + "&route=true&ais=true";
        if (carrier.Length > 0)
            query += "&sealine=" + Uri.EscapeDataString(carrier);

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get,
                "https://tracking.searates.com/tracking?" + query);
            using var response = await Client.SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, ct);

            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                throw new TrackingProviderException("tracking_provider_auth_failed");
            if ((int)response.StatusCode == 429)
                throw new TrackingProviderException("tracking_provider_rate_limited");
            if (!response.IsSuccessStatusCode)
                throw new TrackingProviderException("tracking_provider_unavailable");
            if (response.Content.Headers.ContentLength is > 4_000_000)
                throw new TrackingProviderException("tracking_provider_invalid_response");

            await using var body = await response.Content.ReadAsStreamAsync(ct);
            using var bounded = new MemoryStream();
            var bytes = new byte[16 * 1024];
            int read;
            while ((read = await body.ReadAsync(bytes, ct)) > 0)
            {
                if (bounded.Length + read > 4_000_000)
                    throw new TrackingProviderException("tracking_provider_invalid_response");
                bounded.Write(bytes, 0, read);
            }
            bounded.Position = 0;
            using var json = await JsonDocument.ParseAsync(bounded,
                new JsonDocumentOptions { MaxDepth = 32 }, ct);
            var root = json.RootElement;
            if (String(root, "status") != "success" ||
                !TryObject(root, "data", out var data))
                throw new TrackingProviderException("tracking_provider_no_data");

            TryObject(data, "metadata", out var metadata);
            TryObject(data, "route", out var route);
            TryObject(data, "route_data", out var routeData);
            TryObject(routeData, "ais", out var ais);
            TryObject(ais, "data", out var aisData);
            TryObject(aisData, "last_vessel_position", out var position);
            TryObject(aisData, "vessel", out var aisVessel);
            TryObject(aisData, "departure_port", out var aisDeparture);
            TryObject(aisData, "arrival_port", out var aisArrival);
            TryObject(route, "pol", out var pol);
            TryObject(route, "pod", out var pod);

            var locationNames = new Dictionary<int, string>();
            if (TryArray(data, "locations", out var locations))
                foreach (var location in locations.EnumerateArray())
                    if (Integer(location, "id") is { } id)
                        locationNames[id] = String(location, "name");

            var vesselNames = new Dictionary<int, string>();
            if (TryArray(data, "vessels", out var vessels))
                foreach (var vessel in vessels.EnumerateArray())
                    if (Integer(vessel, "id") is { } id)
                        vesselNames[id] = String(vessel, "name");

            var events = new List<TrackingEvent>();
            string? actualArrival = null;
            string providerVessel = String(aisVessel, "name");
            string providerVoyage = String(GetObject(aisData, "last_event"), "voyage");
            if (TryArray(data, "containers", out var containers))
                foreach (var container in containers.EnumerateArray())
                {
                    var containerNumber = String(container, "number");
                    if (!TryArray(container, "events", out var rows)) continue;
                    foreach (var item in rows.EnumerateArray())
                    {
                        if (events.Count >= 200) break;
                        var code = String(item, "event_code");
                        var date = String(item, "date");
                        var actual = Boolean(item, "actual");
                        var vesselId = Integer(item, "vessel");
                        var vessel = vesselId.HasValue &&
                                     vesselNames.TryGetValue(vesselId.Value, out var name)
                            ? name : "";
                        var placeId = Integer(item, "location");
                        var location = placeId.HasValue &&
                                       locationNames.TryGetValue(placeId.Value, out var place)
                            ? place : "";
                        var voyage = String(item, "voyage");
                        if (vessel.Length > 0 && providerVessel.Length == 0)
                        {
                            providerVessel = vessel;
                            providerVoyage = voyage;
                        }
                        if (actual && code == "ARRI" &&
                            placeId == Integer(pod, "location"))
                            actualArrival = Day(date);
                        events.Add(new TrackingEvent(containerNumber,
                            String(item, "description"), code, location,
                            date, actual, vessel, voyage));
                    }
                }

            // An observed POD arrival is distinct from a provider's predicted ETA.
            var eta = Day(String(pod, "date")) ?? Day(String(aisArrival, "date"));
            var etd = Day(String(pol, "date")) ?? Day(String(aisDeparture, "date"));
            if (Boolean(pod, "actual"))
                actualArrival ??= Day(String(pod, "date"));

            var lat = Number(position, "lat");
            var lng = Number(position, "lng");
            if (lat is < -90 or > 90 || lng is < -180 or > 180)
            {
                lat = null;
                lng = null;
            }

            return new TrackingSnapshot(
                String(metadata, "status"),
                String(metadata, "sealine_name"),
                String(metadata, "sealine"),
                providerVessel,
                providerVoyage,
                etd, eta, actualArrival,
                lat, lng,
                String(position, "updated_at"),
                String(metadata, "updated_at"),
                events.OrderByDescending(x => x.Date, StringComparer.Ordinal).ToArray());
        }
        catch (TrackingProviderException) { throw; }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new TrackingProviderException("tracking_provider_timeout");
        }
        catch (HttpRequestException)
        {
            throw new TrackingProviderException("tracking_provider_unavailable");
        }
        catch (JsonException)
        {
            throw new TrackingProviderException("tracking_provider_invalid_response");
        }
    }

    private static bool TryObject(JsonElement source, string key, out JsonElement result)
    {
        if (source.ValueKind == JsonValueKind.Object &&
            source.TryGetProperty(key, out result) &&
            result.ValueKind == JsonValueKind.Object)
            return true;
        result = default;
        return false;
    }

    private static JsonElement GetObject(JsonElement source, string key)
    {
        TryObject(source, key, out var result);
        return result;
    }

    private static bool TryArray(JsonElement source, string key, out JsonElement result)
    {
        if (source.ValueKind == JsonValueKind.Object &&
            source.TryGetProperty(key, out result) &&
            result.ValueKind == JsonValueKind.Array)
            return true;
        result = default;
        return false;
    }

    private static string String(JsonElement source, string key) =>
        source.ValueKind == JsonValueKind.Object &&
        source.TryGetProperty(key, out var result) &&
        result.ValueKind == JsonValueKind.String
            ? (result.GetString() ?? "")[..Math.Min(result.GetString()?.Length ?? 0, 250)]
            : "";

    private static int? Integer(JsonElement source, string key) =>
        source.ValueKind == JsonValueKind.Object &&
        source.TryGetProperty(key, out var value) &&
        value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var n) ? n : null;

    private static bool Boolean(JsonElement source, string key) =>
        source.ValueKind == JsonValueKind.Object &&
        source.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.True;

    private static double? Number(JsonElement source, string key) =>
        source.ValueKind == JsonValueKind.Object &&
        source.TryGetProperty(key, out var value) &&
        value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var d) &&
        double.IsFinite(d) ? d : null;

    private static string? Day(string date) =>
        date.Length >= 10 &&
        DateOnly.TryParseExact(date[..10], "yyyy-MM-dd",
            CultureInfo.InvariantCulture, DateTimeStyles.None, out var value)
            ? value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null;
}
