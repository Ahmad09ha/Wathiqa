using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Wathiqa.ImportApi;

static void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAIL: " + name);
    Console.WriteLine("PASS: " + name);
}

const string sample = """
{
  "id": 123456, "status": "SAILING", "booking_number": "MEDUQY000000",
  "container_number": "MSCU1234567", "container_count": 2,
  "carrier": { "scac": "MSCU", "name": "MSC" },
  "route": {
    "port_of_loading": {
      "location": {"code":"CNSHA","name":"SHANGHAI"},
      "date_of_loading":"2026-11-01T12:00:00+08:00",
      "date_of_loading_initial":"2026-10-30T12:00:00+08:00"
    },
    "port_of_discharge": {
      "location": {"code":"TRISK","name":"ISKENDERUN"},
      "date_of_discharge":"2026-12-15T12:00:00+03:00",
      "date_of_discharge_initial":"2026-12-12T12:00:00+03:00",
      "date_of_discharge_predicted":"2026-12-14T12:00:00+03:00"
    },
    "ts_count": 1, "transit_time": 44, "transit_percentage": 55,
    "co2_emission": 8.7
  },
  "containers": [
    {"number":"MSCU1234567","status":"SAILING","size":40,"type":"HC","movements":[
      {"event":"LOAD","status":"ACT","location":{"name":"SHANGHAI"},
       "vessel":{"name":"MSC TEST","imo":1234567},"voyage":"X22",
       "timestamp":"2026-11-01T12:00:00+08:00"},
      {"event":"DEPA","status":"ACT","location":{"name":"SHANGHAI"},
       "vessel":{"name":"MSC TEST","imo":1234567},"voyage":"X22",
       "timestamp":"2026-11-03T12:00:00+08:00"},
      {"event":"ARRV","status":"EST","location":{"name":"ISKENDERUN"},
       "vessel":{"name":"MSC TEST","imo":1234567},"voyage":"X22",
       "timestamp":"2026-12-14T12:00:00+03:00"}
    ]},
    {"number":"OOCU4935001","status":"GATE_IN","size":20,"type":"GP","movements":[]}
  ],
  "updated_at":"2026-11-20 09:00:00","checked_at":"2026-11-21 10:30:00",
  "tokens":{"map":"00000000-0000-0000-0000-000000000001"}
}
""";

using var doc = JsonDocument.Parse(sample);
var snap = ShipsGoV2Client.ParseSnapshot(doc.RootElement);
Check(snap.Status == "SAILING", "V2 status");
Check(snap.CarrierCode == "MSCU" && snap.CarrierName == "MSC", "carrier SCAC and name");
Check(snap.PortOfLoading == "SHANGHAI" && snap.PortOfDischarge == "ISKENDERUN", "origin/destination");
Check(snap.Etd == "2026-11-01" && snap.Eta == "2026-12-15" &&
      snap.EtaInitial == "2026-12-12" && snap.EtaPredicted == "2026-12-14",
      "departure, ETA initial and predicted");
Check(snap.ActualArrival is null, "estimated ARRV is not actual arrival");
Check(snap.Vessel == "MSC TEST" && snap.Voyage == "X22", "latest vessel/voyage");
Check(snap.TransitPercentage == 55 && snap.TransshipmentCount == 1 && snap.Co2Tons == 8.7,
      "trip KPIs");
Check(snap.ContainerCount == 2 && snap.Containers?.Count == 2 &&
      snap.Containers[0].Status == "SAILING", "container details");
Check(snap.Events.Count == 3 && snap.Events[0].EventCode == "ARRV" &&
      !snap.Events[0].Actual, "event timeline and estimated flag");
Check(snap.MapUrl == "https://map.shipsgo.com/ocean/shipments/123456?token=00000000-0000-0000-0000-000000000001",
      "official map link");
Check(ShipsGoV2Client.IsV2Id("v2:123456") && !ShipsGoV2Client.IsV2Id("123456"),
      "V1/V2 provider ID differentiation");

using var empty = JsonDocument.Parse("""{"id":123,"status":"NEW","containers":[],"route":null}""");
var pending = ShipsGoV2Client.ParseSnapshot(empty.RootElement);
Check(pending.Events.Count == 0 && pending.Eta is null && pending.PortOfLoading is null,
      "new shipment may have missing data");
try
{
    using var bad = JsonDocument.Parse("""{"status":"SAILING"}""");
    _ = ShipsGoV2Client.ParseSnapshot(bad.RootElement);
    throw new Exception("FAIL: invalid ID accepted");
}
catch (TrackingProviderException) { Console.WriteLine("PASS: reject malformed shipment"); }

var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
{
    ["OceanTracking:ShipsGoWebhookSecret"] = "SUPER_LONG_AND_SECURE_SECRET_KEY"
}).Build();
var client = new ShipsGoV2Client(config, new TestEnvironment(),
    NullLogger<ShipsGoV2Client>.Instance, new Microsoft.AspNetCore.Http.HttpContextAccessor());
var bytes = Encoding.UTF8.GetBytes("""{"message":"You shall not pass!"}""");
Check(client.VerifyWebhook(bytes, "9527e0c9463e6f5b01a0af50aecb4658ff50c6b25d3efa8e5c8dea7e4b763772"),
      "official ShipsGo webhook HMAC-SHA256 test vector");
Check(!client.VerifyWebhook(bytes, new string('0', 64)), "invalid signature rejected");
bytes[0] ^= 1;
Check(!client.VerifyWebhook(bytes, "9527e0c9463e6f5b01a0af50aecb4658ff50c6b25d3efa8e5c8dea7e4b763772"),
      "tampered body rejected");

var sql = SqlConsoleRedactor.Sanitize(
    "SELECT * FROM \"Payments\" WHERE \"Email\"='private@example.com' " +
    "AND \"Total\"=15894.27 AND \"TenantId\"=@__tenantId_0 -- password secret");
Check(sql.Contains("SELECT * FROM \"Payments\"") &&
      !sql.Contains("private@example.com") && !sql.Contains("15894.27") &&
      !sql.Contains("password secret") && sql.Contains("@__tenantId_0"),
      "SQL logger prints query structure but masks literals, numbers and comments");
Check(SqlConsoleRedactor.Operation(sql) == "SELECT", "query operation classification");
Check(SqlConsoleRedactor.Purpose(SqlConsoleRedactor.Operation(sql)) == "READ_RECORDS" &&
      SqlConsoleRedactor.Purpose("UPDATE") == "UPDATE_RECORDS",
      "query purpose explanation");
var sqlSecrets = SqlConsoleRedactor.Sanitize(
    "DO $function$ BEGIN RAISE NOTICE 'TOP_SECRET'; END $function$; " +
    "SELECT 'alpha''beta', E'secret\\'value', $$hiddenkey$$");
Check(!sqlSecrets.Contains("TOP_SECRET") && !sqlSecrets.Contains("alpha") &&
      !sqlSecrets.Contains("hiddenkey"), "SQL log hides dollar-quoted and escaped literals");
var requestContext = new DefaultHttpContext();
requestContext.TraceIdentifier = "test-trace";
requestContext.Request.Method = "POST";
requestContext.Request.Path = "/api/orders/DO_NOT_PRINT/tracking";
requestContext.Request.QueryString = new QueryString("?api_key=VERY_SECRET");
requestContext.SetEndpoint(new RouteEndpoint(_ => Task.CompletedTask,
    RoutePatternFactory.Parse("/api/orders/{id}/tracking"), 0, null, "tracking"));
var requestLogs = new RecordingLogger<ConsoleRequestLoggingMiddleware>();
var middleware = new ConsoleRequestLoggingMiddleware(ctx =>
{
    ((RequestSqlMetrics)ctx.Items[RequestSqlMetrics.ItemKey]!).Record(
        TimeSpan.FromMilliseconds(4), false);
    ctx.Response.StatusCode = 200;
    return Task.CompletedTask;
}, requestLogs);
await middleware.InvokeAsync(requestContext);
var requestSummary = requestLogs.Lines.Single();
Check(requestSummary.Contains("test-trace") &&
      requestSummary.Contains("/api/orders/{id}/tracking") &&
      requestSummary.Contains("SqlCount=1") && requestSummary.Contains("StatusCode=200") &&
      !requestSummary.Contains("DO_NOT_PRINT") && !requestSummary.Contains("VERY_SECRET"),
      "HTTP logger prints route template/SQL summary without customer values or tokens");

if (Environment.GetEnvironmentVariable("SHIPSGO_V2_HTTP_TEST") == "1")
{
    var httpConfig = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
    {
        ["OceanTracking:ShipsGoV2Token"] = "qa-v2-only",
        ["OceanTracking:ShipsGoV2TestBaseUrl"] = "http://127.0.0.1:5098/"
    }).Build();
    var httpClient = new ShipsGoV2Client(httpConfig, new TestEnvironment(),
        NullLogger<ShipsGoV2Client>.Instance, new Microsoft.AspNetCore.Http.HttpContextAccessor());
    var carriers = await httpClient.ListCarriersAsync(CancellationToken.None);
    Check(carriers.Count == 2 && carriers.Any(c => c.Scac == "SG_AKKN") &&
          !carriers.Any(c => c.Scac == "NSAU"), "HTTP carrier lookup and active filtering");
    var guid = Guid.NewGuid();
    var registered = await httpClient.RegisterAsync("MEDUQY000000", null, "MSCU", guid,
        CancellationToken.None);
    Check(registered == "v2:123456", "POST sends correct V2 JSON and token header");
    var duplicate = await httpClient.RegisterAsync("MEDUQY000000", null, "MSCU", guid,
        CancellationToken.None);
    Check(duplicate == registered, "409 ALREADY_EXISTS safely reuses paid shipment ID");
    var recovered = await httpClient.FindExistingAsync(guid,"MEDUQY000000",
        Array.Empty<string>(),CancellationToken.None);
    Check(recovered == registered, "read-only exact-reference reconciliation");
    var notFound = await httpClient.FindExistingAsync(Guid.NewGuid(), "MEDUQY000000",
        Array.Empty<string>(), CancellationToken.None);
    Check(notFound is null, "unmatched recovery never assumes an ID");
    var ctRegistered = await httpClient.RegisterAsync("", "MSCU1234567", "MSCU",
        Guid.NewGuid(), CancellationToken.None);
    Check(ctRegistered == "v2:123456", "container-only tracking registration over HTTP");
    var fetched = await httpClient.FetchAsync(registered, CancellationToken.None);
    Check(fetched.Status == "SAILING" && fetched.Events.Count == 1 &&
          fetched.Latitude == 35.9 && fetched.Longitude == 36.4,
          "GET shipment + GET current GeoJSON position");
    var rejected = false;
    try
    {
        await httpClient.RegisterAsync("INVALID_B_L", null, "MSCU",
            Guid.NewGuid(), CancellationToken.None);
    }
    catch (TrackingProviderException ex) { rejected = ex.Definitive; }
    Check(rejected, "invalid booking number rejected before paid POST");
    var outgoingLogs = new RecordingLogger<ShipsGoV2Client>();
    using var outgoingClient = new HttpClient();
    using var outgoingRequest = new HttpRequestMessage(HttpMethod.Get,
        "http://127.0.0.1:5098/ocean/shipments/123456?authCode=DONT_LOG_ME");
    outgoingRequest.Headers.Accept.ParseAdd("application/json");
    outgoingRequest.Headers.Add("X-Shipsgo-User-Token", "qa-v2-only");
    using var outgoingResponse = await ProviderHttpConsoleLog.SendAsync(outgoingClient,
        outgoingRequest, CancellationToken.None, outgoingLogs, new HttpContextAccessor(),
        "ShipsGoV2");
    Check(outgoingResponse.IsSuccessStatusCode &&
          outgoingLogs.Lines.Count == 2 &&
          outgoingLogs.Lines.All(x => x.Contains("/ocean/shipments/{shipment_id}")) &&
          outgoingLogs.Lines.All(x => !x.Contains("DONT_LOG_ME")) &&
          outgoingLogs.Lines.All(x => !x.Contains("qa-v2-only")),
          "outbound HTTP logger masks shipment identifiers, URL secrets and auth token");
}
Console.WriteLine("SHIPSGO_V2_CONTRACT_TESTS_PASS");

sealed class TestEnvironment : IHostEnvironment
{
    public string EnvironmentName { get; set; } = Environments.Development;
    public string ApplicationName { get; set; } = "ShipsGoV2ContractTests";
    public string ContentRootPath { get; set; } = ".";
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
}

sealed class RecordingLogger<T> : ILogger<T>
{
    public List<string> Lines { get; } = [];
    public IDisposable BeginScope<TState>(TState state) where TState : notnull =>
        EmptyScope.Instance;
    public bool IsEnabled(LogLevel logLevel) => true;
    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state,
        Exception? exception, Func<TState, Exception?, string> formatter) =>
        Lines.Add(formatter(state, exception));
    private sealed class EmptyScope : IDisposable
    {
        public static readonly EmptyScope Instance = new();
        public void Dispose() { }
    }
}
