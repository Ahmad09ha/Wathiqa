using System.Data.Common;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;

namespace Wathiqa.ImportApi;

/// <summary>
/// Transient, request-local counters. Never persisted to any database or file.
/// </summary>
public sealed class RequestSqlMetrics
{
    public const string ItemKey = "__WathiqaConsoleSqlMetrics";
    private int _count;
    private int _failed;
    private long _elapsedTicks;

    public int Count => Volatile.Read(ref _count);
    public int Failed => Volatile.Read(ref _failed);
    public double TotalMilliseconds =>
        TimeSpan.FromTicks(Interlocked.Read(ref _elapsedTicks)).TotalMilliseconds;

    public void Record(TimeSpan duration, bool failed)
    {
        Interlocked.Increment(ref _count);
        if (failed) Interlocked.Increment(ref _failed);
        Interlocked.Add(ref _elapsedTicks, duration.Ticks);
    }
}

/// <summary>
/// Writes a structured summary of EVERY HTTP request to the existing console logger.
/// Only a route template is logged: never the URL query string, real path values,
/// cookies, authorization headers or request/response body.
/// </summary>
public sealed class ConsoleRequestLoggingMiddleware(
    RequestDelegate next, ILogger<ConsoleRequestLoggingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var metrics = new RequestSqlMetrics();
        context.Items[RequestSqlMetrics.ItemKey] = metrics;
        var clock = Stopwatch.StartNew();
        var failed = false;
        try
        {
            await next(context);
        }
        catch
        {
            failed = true;
            throw;
        }
        finally
        {
            clock.Stop();
            var endpoint = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText
                ?? "[unmatched-route]";
            // Endpoint templates contain placeholders rather than customer IDs.
            var statusCode = failed ? StatusCodes.Status500InternalServerError :
                context.Response.StatusCode;
            logger.LogInformation(
                "HTTP_REQUEST_COMPLETE TraceId={TraceId} Method={Method} Endpoint={Endpoint} " +
                "StatusCode={StatusCode} DurationMs={DurationMs:F1} SqlCount={SqlCount} " +
                "SqlFailed={SqlFailed} SqlDurationMs={SqlDurationMs:F1}",
                context.TraceIdentifier, context.Request.Method, endpoint,
                statusCode, clock.Elapsed.TotalMilliseconds, metrics.Count,
                metrics.Failed, metrics.TotalMilliseconds);
        }
    }
}

/// <summary>
/// EF Core command-level logs to the console ONLY. Does not print parameter
/// values, literal string/numeric values, HTTP credentials or exception details.
/// Covers reads, writes, stored procedures, and failed operations.
/// Uses HttpContextAccessor to connect each command to its incoming HTTP request.
/// </summary>
public sealed class ConsoleSqlCommandInterceptor(
    ILogger<ConsoleSqlCommandInterceptor> logger,
    IHttpContextAccessor httpContextAccessor) : DbCommandInterceptor
{
    public override DbDataReader ReaderExecuted(DbCommand command,
        CommandExecutedEventData eventData, DbDataReader result)
    {
        Record(command, eventData, false, null);
        return result;
    }

    public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command,
        CommandExecutedEventData eventData, DbDataReader result,
        CancellationToken cancellationToken = default)
    {
        Record(command, eventData, false, null);
        return new ValueTask<DbDataReader>(result);
    }

    public override int NonQueryExecuted(DbCommand command,
        CommandExecutedEventData eventData, int result)
    {
        Record(command, eventData, false, result);
        return result;
    }

    public override ValueTask<int> NonQueryExecutedAsync(DbCommand command,
        CommandExecutedEventData eventData, int result,
        CancellationToken cancellationToken = default)
    {
        Record(command, eventData, false, result);
        return new ValueTask<int>(result);
    }

    public override object? ScalarExecuted(DbCommand command,
        CommandExecutedEventData eventData, object? result)
    {
        Record(command, eventData, false, null);
        return result;
    }

    public override ValueTask<object?> ScalarExecutedAsync(DbCommand command,
        CommandExecutedEventData eventData, object? result,
        CancellationToken cancellationToken = default)
    {
        Record(command, eventData, false, null);
        return new ValueTask<object?>(result);
    }

    public override void CommandFailed(DbCommand command, CommandErrorEventData eventData)
    {
        Record(command, eventData, true, null, eventData.Exception);
    }

    public override Task CommandFailedAsync(DbCommand command, CommandErrorEventData eventData,
        CancellationToken cancellationToken = default)
    {
        Record(command, eventData, true, null, eventData.Exception);
        return Task.CompletedTask;
    }

    private void Record(DbCommand command, CommandEndEventData eventData,
        bool failed, int? affectedRows, Exception? exception = null)
    {
        var http = httpContextAccessor.HttpContext;
        var metrics = http?.Items[RequestSqlMetrics.ItemKey] as RequestSqlMetrics;
        metrics?.Record(eventData.Duration, failed);

        var traceId = http?.TraceIdentifier ?? "background";
        var sql = SqlConsoleRedactor.Sanitize(command.CommandText);
        var operation = SqlConsoleRedactor.Operation(sql);
        var purpose = SqlConsoleRedactor.Purpose(operation);
        // Never log exception.Message or provider parameters: these can contain
        // credentials, bank details, document names and other customer data.
        var outcome = failed ? "FAILED" : "OK";
        if (failed)
            logger.LogWarning(
                "SQL_COMMAND TraceId={TraceId} CommandId={CommandId} Operation={Operation} Purpose={Purpose} " +
                "Outcome={Outcome} DurationMs={DurationMs:F1} ErrorType={ErrorType} " +
                "SqlState={SqlState} Sql={Sql}",
                traceId, eventData.CommandId, operation, purpose, outcome,
                eventData.Duration.TotalMilliseconds, exception?.GetType().Name ?? "Unknown",
                (exception as PostgresException)?.SqlState ?? "-", sql);
        else
            logger.LogInformation(
                "SQL_COMMAND TraceId={TraceId} CommandId={CommandId} Operation={Operation} Purpose={Purpose} " +
                "Outcome={Outcome} DurationMs={DurationMs:F1} AffectedRows={AffectedRows} Sql={Sql}",
                traceId, eventData.CommandId, operation, purpose, outcome,
                eventData.Duration.TotalMilliseconds, affectedRows, sql);
    }
}

/// <summary>
/// ShipsGo HTTP request diagnostics. Logs only the provider and endpoint path
/// template, NOT URLs with query parameters (V1.2 includes authCode in its URL),
/// request/response JSON, headers, tokens or customer reference numbers.
/// </summary>
public static class ProviderHttpConsoleLog
{
    public static async Task<HttpResponseMessage> SendAsync(
        HttpClient client, HttpRequestMessage request, CancellationToken ct,
        ILogger logger, IHttpContextAccessor accessor, string provider,
        bool enabled = true)
    {
        if (!enabled)
            return await client.SendAsync(request,
                HttpCompletionOption.ResponseHeadersRead, ct);
        var path = request.RequestUri?.AbsolutePath ?? "[unknown]";
        path = Regex.Replace(path, @"/shipments/[0-9]+(?=/|$)",
            "/shipments/{shipment_id}", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var traceId = accessor.HttpContext?.TraceIdentifier ?? "background";
        var stopwatch = Stopwatch.StartNew();
        logger.LogInformation(
            "OUTBOUND_HTTP_START TraceId={TraceId} Provider={Provider} Method={Method} Endpoint={Endpoint}",
            traceId, provider, request.Method.Method, path);
        try
        {
            var response = await client.SendAsync(request,
                HttpCompletionOption.ResponseHeadersRead, ct);
            stopwatch.Stop();
            logger.LogInformation(
                "OUTBOUND_HTTP TraceId={TraceId} Provider={Provider} Method={Method} " +
                "Endpoint={Endpoint} StatusCode={StatusCode} DurationMs={DurationMs:F1} Outcome={Outcome}",
                traceId, provider, request.Method.Method, path,
                (int)response.StatusCode, stopwatch.Elapsed.TotalMilliseconds,
                response.IsSuccessStatusCode ? "OK" : "HTTP_ERROR");
            return response;
        }
        catch (Exception exception)
        {
            stopwatch.Stop();
            // Safe exception TYPE only. Error messages may carry request URLs.
            logger.LogWarning(
                "OUTBOUND_HTTP TraceId={TraceId} Provider={Provider} Method={Method} " +
                "Endpoint={Endpoint} StatusCode={StatusCode} DurationMs={DurationMs:F1} " +
                "Outcome={Outcome} ErrorType={ErrorType}",
                traceId, provider, request.Method.Method, path, 0,
                stopwatch.Elapsed.TotalMilliseconds, "NETWORK_ERROR",
                exception.GetType().Name);
            throw;
        }
    }
}

/// <summary>
/// Display-only SQL for diagnostics, NOT executable SQL. Mask user data while
/// keeping SQL verbs, column names, joins, predicates and parameter placeholders.
/// </summary>
public static class SqlConsoleRedactor
{
    private const int MaxSqlCharacters = 7000;

    public static string Purpose(string operation) => operation switch
    {
        "SELECT" => "READ_RECORDS",
        "INSERT" => "CREATE_RECORDS",
        "UPDATE" => "UPDATE_RECORDS",
        "DELETE" => "DELETE_RECORDS",
        "WITH" => "CTE_QUERY",
        "MERGE" => "MERGE_RECORDS",
        "CALL" => "CALL_PROCEDURE",
        "CREATE" or "ALTER" or "DROP" => "SCHEMA_CHANGE",
        "SET" => "SESSION_SETTING",
        _ => "OTHER_COMMAND"
    };

    public static string Operation(string sanitizedSql)
    {
        var trimmed = sanitizedSql.TrimStart();
        foreach (var verb in new[] { "SELECT", "INSERT", "UPDATE", "DELETE",
                     "WITH", "MERGE", "CALL", "CREATE", "ALTER", "DROP", "SET" })
            if (trimmed.StartsWith(verb + " ", StringComparison.OrdinalIgnoreCase) ||
                trimmed.Equals(verb, StringComparison.OrdinalIgnoreCase))
                return verb;
        return "OTHER";
    }

    public static string Sanitize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "[empty]";
        var result = new StringBuilder(Math.Min(raw.Length, MaxSqlCharacters));
        for (var i = 0; i < raw.Length && result.Length < MaxSqlCharacters;)
        {
            char ch = raw[i];

            if (ch == '-' && i + 1 < raw.Length && raw[i + 1] == '-')
            {
                i += 2;
                while (i < raw.Length && raw[i] != '\n') i++;
                AppendSpace(result);
                continue;
            }
            if (ch == '/' && i + 1 < raw.Length && raw[i + 1] == '*')
            {
                // PostgreSQL supports nested block comments.
                i += 2;
                var depth = 1;
                while (i < raw.Length && depth > 0)
                {
                    if (i + 1 < raw.Length && raw[i] == '/' && raw[i + 1] == '*')
                    { depth++; i += 2; }
                    else if (i + 1 < raw.Length && raw[i] == '*' && raw[i + 1] == '/')
                    { depth--; i += 2; }
                    else i++;
                }
                AppendSpace(result);
                continue;
            }
            if (ch == '\'')
            {
                result.Append("[literal]");
                i++;
                while (i < raw.Length)
                {
                    if (raw[i] == '\\' && i + 1 < raw.Length)
                    { i += 2; continue; }
                    if (raw[i] == '\'')
                    {
                        i++;
                        if (i < raw.Length && raw[i] == '\'')
                        { i++; continue; }
                        break;
                    }
                    i++;
                }
                continue;
            }
            if (ch == '$')
            {
                // Dollar quoted PostgreSQL literals ($$secret$$ / $tag$secret$tag$).
                var end = raw.IndexOf('$', i + 1);
                var validTag = end == i + 1 ||
                    end > i + 1 && (char.IsLetter(raw[i + 1]) || raw[i + 1] == '_');
                if (validTag)
                    for (var k = i + 2; k < end; k++)
                        if (!char.IsLetterOrDigit(raw[k]) && raw[k] != '_')
                        { validTag = false; break; }
                if (end > i && end - i <= 65 &&
                    validTag)
                {
                    var tag = raw.Substring(i, end - i + 1);
                    var close = raw.IndexOf(tag, end + 1, StringComparison.Ordinal);
                    if (close >= 0)
                    {
                        result.Append("[literal]");
                        i = close + tag.Length;
                        continue;
                    }
                    // Unclosed dollar literal is not safe to display.
                    result.Append("[redacted-unclosed]");
                    break;
                }
            }
            if (char.IsDigit(ch) && (i == 0 ||
                !char.IsLetterOrDigit(raw[i - 1]) && raw[i - 1] != '_' &&
                raw[i - 1] != '$' && raw[i - 1] != '@'))
            {
                var start = i;
                while (i < raw.Length && (char.IsLetterOrDigit(raw[i]) ||
                    raw[i] is '.' or '_' or '+' or '-')) i++;
                // Parameter markers ($1, @p0) were excluded above.
                if (i == start) i++;
                result.Append("[number]");
                continue;
            }
            if (char.IsWhiteSpace(ch))
            {
                AppendSpace(result);
                i++;
                continue;
            }
            result.Append(ch);
            i++;
        }
        if (result.Length >= MaxSqlCharacters)
            return result.ToString(0, MaxSqlCharacters) + " [truncated]";
        return result.ToString().Trim();
    }

    private static void AppendSpace(StringBuilder output)
    {
        if (output.Length > 0 && output[^1] != ' ') output.Append(' ');
    }
}
