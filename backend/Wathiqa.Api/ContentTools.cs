using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Wathiqa.Api;

public static class ContentTools
{
    public static string Empty() => "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}";
    public static string FromLines(IEnumerable<string> lines)
    {
        var nodes = new List<JsonNode?>();
        foreach (var line in lines.Where(x => !string.IsNullOrWhiteSpace(x)).Take(1500))
        {
            if (line.Contains('\t'))
            {
                var cells = line.Split('\t').Take(30).Select(value => (JsonNode?)new JsonObject
                {
                    ["type"] = "tableHeader",
                    ["content"] = new JsonArray(new JsonObject
                    {
                        ["type"] = "paragraph",
                        ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = value.Trim() })
                    })
                }).ToArray();
                nodes.Add(new JsonObject
                {
                    ["type"] = "table",
                    ["content"] = new JsonArray(new JsonObject { ["type"] = "tableRow", ["content"] = new JsonArray(cells) })
                });
            }
            else nodes.Add(new JsonObject
            {
                ["type"] = "paragraph",
                ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = line.Trim() })
            });
        }
        return RemoveEmptyTextNodes(new JsonObject { ["type"] = "doc", ["content"] = new JsonArray(nodes.ToArray()) }.ToJsonString());
    }
    public static string RemoveEmptyTextNodes(string json)
    {
        var document = JsonNode.Parse(json) ?? throw new BadHttpRequestException("Invalid content", 400);
        static void Visit(JsonNode? node)
        {
            if (node is JsonArray array)
            {
                for (var i = array.Count - 1; i >= 0; i--)
                {
                    if (array[i] is JsonObject text
                        && text["type"]?.ToString() == "text"
                        && text["text"]?.ToString() == "")
                        array.RemoveAt(i);
                    else Visit(array[i]);
                }
            }
            else if (node is JsonObject obj)
                foreach (var item in obj.ToList()) Visit(item.Value);
        }
        Visit(document);
        return document.ToJsonString();
    }
    public static string FromLabels(IEnumerable<string> lines)
    {
        var result = new List<string>();
        foreach (var raw in lines.Take(5000))
        {
            var line = Regex.Replace(raw.Trim(), @"\s+", " ");
            if (line.Length < 3) continue;
            // Recognize section labels such as "3.价格条款 PRICE TERM:" and leave values blank.
            var colon = line.IndexOf(':');
            if (colon < 0) colon = line.IndexOf('：');
            if (colon > 0 && colon < 105)
            {
                var label = line[..(colon + 1)].Trim();
                if (label.Length >= 3 && !result.Contains(label + " [VALUE]"))
                    result.Add(label + " [VALUE]");
            }
            else if (Regex.IsMatch(line, @"^(NO\.|SIZE|DESCRIPTION|UNIT PRICE|QUANTITY|AMOUNT|DATE|SELLER|BUYER)\b", RegexOptions.IgnoreCase)
                     && line.Length < 120)
            {
                result.Add(line);
            }
        }
        return FromLines(result.Count > 0 ? result : lines.Take(80));
    }
    public static IEnumerable<string> Lines(string json)
    {
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.TryGetProperty("content", out var content))
            foreach (var block in content.EnumerateArray())
            {
                if (block.TryGetProperty("type", out var kind) && kind.GetString() == "table")
                {
                    if (block.TryGetProperty("content", out var rows))
                        foreach (var row in rows.EnumerateArray())
                        {
                            var cells = new List<string>();
                            if (row.TryGetProperty("content", out var cols))
                                foreach (var cell in cols.EnumerateArray()) cells.Add(ReadText(cell));
                            yield return string.Join("\t", cells);
                        }
                }
                else yield return ReadText(block);
            }
    }
    public static string ReadText(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object) return "";
        var text = element.TryGetProperty("text", out var val) ? val.GetString() ?? "" : "";
        if (element.TryGetProperty("content", out var children) && children.ValueKind == JsonValueKind.Array)
            text += string.Join("", children.EnumerateArray().Select(ReadText));
        return text;
    }
    public static string Validate(JsonElement content)
    {
        if (content.ValueKind != JsonValueKind.Object || !content.TryGetProperty("type", out var type) || type.GetString() != "doc"
            || !content.TryGetProperty("content", out var nodes) || nodes.ValueKind != JsonValueKind.Array)
            throw new BadHttpRequestException("Content must be a Tiptap doc with a content array.", 400);
        var json = content.GetRawText();
        if (json.Length > 2_000_000) throw new BadHttpRequestException("Document too large.", 413);
        return RemoveEmptyTextNodes(json);
    }
    public static string SafeName(string input) => Regex.Replace(input, @"[^a-zA-Z0-9_-]+", "-").Trim('-') is { Length: > 0 } s ? s : "document";
}
