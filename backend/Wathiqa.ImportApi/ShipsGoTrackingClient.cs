using System.Globalization;
using System.Net;
using System.Text.Json;

namespace Wathiqa.ImportApi;

public sealed class TrackingProviderException(string code, bool definitive = false)
    : Exception(code)
{
    public string Code { get; } = code;
    // A definitely rejected paid POST may be retried. Network/timeout/unknown
    // results are NOT safe to replay, because ShipsGo may have charged a credit.
    public bool Definitive { get; } = definitive;
}

/// <summary>
/// ShipsGo ocean API v1.2 integration with a fixed trusted host.
/// One paid activation per MBL, followed exclusively by free voyage GETs.
/// Provider credentials are server-only and never included in error output.
/// </summary>
public sealed class ShipsGoTrackingClient(IConfiguration configuration, IHostEnvironment environment)
{
    private static readonly HttpClient Client = new()
    {
        Timeout = TimeSpan.FromSeconds(25)
    };
    private const string ProductionRoot = "https://shipsgo.com/api/v1.2/ContainerService/";
    private string Root
    {
        get
        {
            // Deterministic provider-contract testing without real credits.
            // NEVER allow an arbitrary external endpoint outside Development.
            var test = configuration["OceanTracking:ShipsGoTestBaseUrl"];
            if (environment.IsDevelopment() && Uri.TryCreate(test,UriKind.Absolute,out var uri) &&
                uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback)
                return uri.AbsoluteUri.TrimEnd('/') + "/";
            return ProductionRoot;
        }
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(configuration["OceanTracking:ShipsGoApiKey"]);

    public async Task<string> RegisterBillAsync(string masterBill, string carrier,
        CancellationToken cancellationToken)
    {
        var key = Key();
        var form = new Dictionary<string, string>
        {
            ["authCode"] = key, ["blContainersRef"] = masterBill,
            ["shippingLine"] = carrier.Length > 0 ? carrier : "OTHERS",
            ["containerNumber"] = ""
        };
        using var body = new FormUrlEncodedContent(form);
        using var message = new HttpRequestMessage(HttpMethod.Post,
            Root + "PostContainerInfoWithBl") { Content = body };
        using var response = await Send(message, cancellationToken);
        var json = await ReadJson(response, cancellationToken);

        // The v1.2 API documents an integer requestId in its successful POST.
        // Accept only explicit positive integer IDs; never treat an opaque
        // success message as confirmation or issue another chargeable POST.
        if (json.ValueKind == JsonValueKind.Number &&
            json.TryGetInt64(out var integerId) && integerId > 0)
            return integerId.ToString(CultureInfo.InvariantCulture);
        if (json.ValueKind == JsonValueKind.String &&
            long.TryParse(json.GetString(), out var numericText) && numericText > 0)
            return numericText.ToString(CultureInfo.InvariantCulture);
        foreach (var field in new[] { "requestId", "RequestId", "requestID", "id" })
        {
            var value = Property(json, field);
            if (value.ValueKind == JsonValueKind.Number &&
                value.TryGetInt64(out var id) && id > 0)
                return id.ToString(CultureInfo.InvariantCulture);
            if (value.ValueKind == JsonValueKind.String &&
                long.TryParse(value.GetString(), out var parsed) && parsed > 0)
                return parsed.ToString(CultureInfo.InvariantCulture);
        }
        throw new TrackingProviderException("tracking_provider_ambiguous_registration");
    }

    public async Task<TrackingSnapshot> FetchAsync(string requestId,
        CancellationToken cancellationToken)
    {
        if (!long.TryParse(requestId, out var id) || id <= 0)
            throw new TrackingProviderException("tracking_provider_invalid_response");
        var url = Root + "GetContainerInfo/?authCode=" + Uri.EscapeDataString(Key()) +
                  "&requestId=" + id.ToString(CultureInfo.InvariantCulture) +
                  "&mapPoint=true";
        using var message = new HttpRequestMessage(HttpMethod.Get, url);
        using var response = await Send(message, cancellationToken);
        var root = await ReadJson(response, cancellationToken);
        if (root.ValueKind == JsonValueKind.Array)
            root = root.GetArrayLength() > 0 ? root[0] : default;
        if (root.ValueKind != JsonValueKind.Object)
            throw new TrackingProviderException("tracking_provider_no_data");
        var status = Text(root,"Status","status");
        if (status.Length == 0 && Property(root,"Containers").ValueKind == JsonValueKind.Undefined)
            throw new TrackingProviderException("tracking_provider_no_data");
        var position = Property(root, "MapPoint", "mapPoint", "Position", "position");
        if (position.ValueKind == JsonValueKind.Array && position.GetArrayLength() > 0)
            position = position[0];
        var latitude = Coordinate(position,"Latitude","latitude","lat");
        var longitude = Coordinate(position,"Longitude","longitude","lng","lon");
        if (latitude is < -90 or > 90 || longitude is < -180 or > 180)
        { latitude = null; longitude = null; }
        var containers = Property(root,"Containers","containers");
        var events = new List<TrackingEvent>();
        if (containers.ValueKind == JsonValueKind.Array)
            foreach (var container in containers.EnumerateArray())
            {
                var number = Text(container,"ContainerNumber","container_number","number");
                var movements = Property(container,"Movements","movements","Events","events");
                if (movements.ValueKind != JsonValueKind.Array) continue;
                foreach (var movement in movements.EnumerateArray())
                {
                    if (events.Count >= 200) break;
                    var location = Property(movement,"Location","location");
                    events.Add(new TrackingEvent(number,
                        Text(movement,"Description","description","Status","status","event"),
                        Text(movement,"StatusCode","status_code","EventCode","event_code","event"),
                        location.ValueKind == JsonValueKind.Object
                            ? Text(location,"Name","name") : Text(movement,"Location","location"),
                        Text(movement,"Date","date","timestamp"),
                        Flag(movement,"IsActual","actual"),
                        Text(movement,"Vessel","vessel"),
                        Text(movement,"Voyage","voyage")));
                }
            }
        return new TrackingSnapshot(
            status,Text(root,"ShippingLine","shippingLine","carrier","carrier_name"),
            Text(root,"ShippingLineCode","shippingLineCode"),
            Text(root,"Vessel","vessel","VesselName"),
            Text(root,"Voyage","voyage"),
            Date(root,"DateOfLoading","date_of_loading","ETD","etd"),
            Date(root,"DateOfDischarge","date_of_discharge","ETA","eta"),
            Date(root,"DateOfDischargeActual","actual_arrival","ActualArrival"),
            latitude,longitude,
            Text(root,"PositionUpdatedAt","position_updated_at"),
            Text(root,"UpdatedAt","updated_at"),
            events.OrderByDescending(e=>e.Date,StringComparer.Ordinal).ToArray());
    }

    private string Key() =>
        configuration["OceanTracking:ShipsGoApiKey"] is { Length: > 0 } key &&
        !string.IsNullOrWhiteSpace(key)
          ? key : throw new TrackingProviderException("tracking_not_configured",true);

    private static async Task<HttpResponseMessage> Send(HttpRequestMessage message,
        CancellationToken ct)
    {
        try
        {
            var response = await Client.SendAsync(message,
                HttpCompletionOption.ResponseHeadersRead,ct);
            if (response.IsSuccessStatusCode) return response;
            var code = response.StatusCode switch
            {
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden =>
                    "tracking_provider_auth_failed",
                HttpStatusCode.PaymentRequired => "tracking_provider_no_credits",
                HttpStatusCode.TooManyRequests => "tracking_provider_rate_limited",
                HttpStatusCode.BadRequest or HttpStatusCode.UnprocessableEntity =>
                    "tracking_provider_invalid_reference",
                _ => "tracking_provider_unavailable"
            };
            var definite = response.StatusCode is HttpStatusCode.BadRequest
                or HttpStatusCode.UnprocessableEntity or HttpStatusCode.Unauthorized
                or HttpStatusCode.Forbidden or HttpStatusCode.PaymentRequired;
            response.Dispose();
            throw new TrackingProviderException(code,definite);
        }
        catch (TrackingProviderException) { throw; }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { throw new TrackingProviderException("tracking_provider_timeout"); }
        catch (HttpRequestException)
        { throw new TrackingProviderException("tracking_provider_unavailable"); }
    }

    private static async Task<JsonElement> ReadJson(HttpResponseMessage response,CancellationToken ct)
    {
        if (response.Content.Headers.ContentLength is > 4_000_000)
            throw new TrackingProviderException("tracking_provider_invalid_response");
        try
        {
            await using var input = await response.Content.ReadAsStreamAsync(ct);
            using var bounded = new MemoryStream();
            var buffer = new byte[16384];
            int count;
            while ((count = await input.ReadAsync(buffer,ct)) > 0)
            {
                if (bounded.Length + count > 4_000_000)
                    throw new TrackingProviderException("tracking_provider_invalid_response");
                bounded.Write(buffer,0,count);
            }
            bounded.Position = 0;
            using var document = await JsonDocument.ParseAsync(bounded,
                new JsonDocumentOptions{MaxDepth=32},ct);
            return document.RootElement.Clone();
        }
        catch (JsonException) { throw new TrackingProviderException("tracking_provider_invalid_response"); }
    }

    private static JsonElement Property(JsonElement obj,params string[] keys)
    {
        if(obj.ValueKind != JsonValueKind.Object)return default;
        foreach (var k in keys)
            if(obj.TryGetProperty(k,out var prop))return prop;
        return default;
    }
    private static string Text(JsonElement obj,params string[] keys)
    {
        var v=Property(obj,keys);
        return (v.ValueKind==JsonValueKind.String?v.GetString() ?? "":
            v.ValueKind==JsonValueKind.Number?v.ToString():"")[..Math.Min(
            v.ValueKind==JsonValueKind.String?v.GetString()?.Length ?? 0:
            v.ValueKind==JsonValueKind.Number?v.ToString().Length:0,250)];
    }
    private static string? Date(JsonElement obj,params string[] keys)
    {
        var input=Text(obj,keys);
        return input.Length>=10 && DateOnly.TryParse(input[..10],
            CultureInfo.InvariantCulture,DateTimeStyles.None,out var d)
            ?d.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture):null;
    }
    private static bool Flag(JsonElement obj,params string[] keys) =>
        Property(obj,keys).ValueKind==JsonValueKind.True;
    private static double? Coordinate(JsonElement obj,params string[] keys)
    {
        var value=Property(obj,keys);
        if(value.ValueKind==JsonValueKind.Number && value.TryGetDouble(out var n) &&
            double.IsFinite(n))return n;
        if(value.ValueKind==JsonValueKind.String && double.TryParse(value.GetString(),
            NumberStyles.Float,CultureInfo.InvariantCulture,out var s) && double.IsFinite(s))
            return s;
        return null;
    }
}
