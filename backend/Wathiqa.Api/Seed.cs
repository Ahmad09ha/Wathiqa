using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;

namespace Wathiqa.Api;

public static class Seed
{
    private static JsonObject P(string text, bool heading = false) => new()
    {
        ["type"] = heading ? "heading" : "paragraph",
        ["attrs"] = heading ? new JsonObject { ["level"] = 2 } : null,
        ["content"] = string.IsNullOrEmpty(text)
            ? new JsonArray()
            : new JsonArray(new JsonObject { ["type"] = "text", ["text"] = text })
    };
    private static JsonObject Cell(string text, bool heading = false) => new()
    {
        ["type"] = heading ? "tableHeader" : "tableCell",
        ["content"] = new JsonArray(P(text))
    };
    private static JsonObject Table()
    {
        var rows = new JsonArray();
        string[][] cells =
        [
            ["NO.", "SIZE", "DESCRIPTION", "UNIT PRICE", "QUANTITY", "AMOUNT"],
            ["[NO.]", "[SIZE]", "[DESCRIPTION]", "[UNIT PRICE]", "[QUANTITY]", "[AMOUNT]"],
            ["", "TOTAL", "", "", "[TOTAL QUANTITY]", "[TOTAL AMOUNT]"]
        ];
        foreach (var (row, index) in cells.Select((r,i) => (r,i)))
            rows.Add(new JsonObject { ["type"] = "tableRow", ["content"] = new JsonArray(row.Select(s => (JsonNode?)Cell(s,index == 0)).ToArray()) });
        return new JsonObject { ["type"] = "table", ["content"] = rows };
    }
    public static string Contract()
    {
        var content = new List<JsonNode?>
        {
            P("销售合同 SALES CONTRACT",true),
            P("合同编号 SALES CONTRACT NO.: [CONTRACT NUMBER]"),
            P("签订日期 DATE: [DATE]"),
            P("卖方 SELLER: [SELLER]"),
            P("注册地址 ADD: [SELLER ADDRESS]"),
            P("买方 BUYER: [BUYER]"),
            P("注册地址 ADD: [BUYER ADDRESS]"),
            P("THE BUYER UNDERTAKES TO PURCHASE THE FOLLOWING PRODUCTS FROM THE SELLER, AND THE SELLER AGREES TO SUPPLY THE PRODUCTS TO THE BUYER ON THE FOLLOWING TERMS:"),
            P("1. 产品名称 NAME OF PRODUCT: [PRODUCT NAME]"),
            P("2. 产品信息 DETAILS:",true),
            Table(),
        };
        var terms = new[]
        {
            "3. 价格条款 PRICE TERM: [PRICE TERM]",
            "4. 付款方式 PAYMENT TERM: [PAYMENT TERM]",
            "5. 原产国 COUNTRY OF ORIGIN: [COUNTRY]",
            "6. 生产商 MANUFACTURER: [MANUFACTURER]",
            "7. 包装 PACKING: [PACKING]",
            "8. 出运时间 SHIPMENT TIME: [SHIPMENT TIME]",
            "9. 起运港 PORT OF LOADING: [PORT OF LOADING]",
            "10. 目的港 PORT OF DESTINATION: [DESTINATION]",
            "11. PARTIAL SHIPMENT IS ALLOWED. TRANSHIPMENT IS ALLOWED.",
            "12. QUALITY OBJECTIONS: [TERMS]",
            "13. DOCUMENTS SUBMISSION: [TERMS]",
            "14. TOLERANCE: [TOLERANCE]",
            "15. 卖方银行账户信息 SELLER'S BANK INFO: [BANK INFORMATION]",
            "16. 所需单据 DOCUMENTS REQUIRED: [REQUIRED DOCUMENTS]",
            "17. DELIVERY OBLIGATIONS: [LEGAL TEXT]",
            "18. 不可抗力 FORCE MAJEURE: [LEGAL TEXT]",
            "19. 仲裁 ARBITRATION: [LEGAL TEXT]",
            "20. 所有权保留 RETENTION OF TITLE: [LEGAL TEXT]",
            "21. 其他条款 OTHER TERMS: [LEGAL TEXT]",
            "FOR THE SELLER                                     FOR THE BUYER"
        };
        content.AddRange(terms.Select(x => (JsonNode?)P(x)));
        return new JsonObject { ["type"] = "doc", ["content"] = new JsonArray(content.ToArray()) }.ToJsonString();
    }
    public static async Task Init(WorkspaceDb db)
    {
        await db.Database.EnsureCreatedAsync();
        // Repair only structurally invalid text nodes in previously generated starter
        // templates, preserving all other text and any edits the user has made.
        var starters = await db.Templates.Where(t => t.SourceFormat == "starter").ToListAsync();
        foreach (var template in starters)
        {
            if (template.ContentJson.Contains("\"text\":\"\"") || template.ContentJson.Contains("\"text\": \"\""))
                template.ContentJson = ContentTools.RemoveEmptyTextNodes(template.ContentJson);
        }
        if (await db.Templates.AnyAsync())
        {
            await db.SaveChangesAsync();
            return;
        }
        db.Templates.Add(new Template { Name = "Sales Contract · September 2026", Description = "Based on XFM26093001PR (20% TT / 80% DP, 50-day shipment). Placeholder values; review legal text.", SourceFormat = "starter", ContentJson = Contract() });
        db.Templates.Add(new Template { Name = "Sales Contract · October 2026", Description = "Based on XFM26102201PR (20% TT / 80% TT, 40-day shipment). Placeholder values; review legal text.", SourceFormat = "starter", ContentJson = Contract() });
        await db.SaveChangesAsync();
    }
}
