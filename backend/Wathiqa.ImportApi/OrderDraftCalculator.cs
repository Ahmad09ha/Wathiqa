using System.Diagnostics.CodeAnalysis;

namespace Wathiqa.ImportApi;

public sealed record SaveOrderItemRequest(
    Guid? Id, string? ProductType, string? Denier, string? Luster, string? Grade,
    string? ColorType, decimal Quantity, string? QuantityUnit,
    decimal UnitPrice, string? PriceUnit, string? HsCode);

public sealed record SaveOrderRequest(
    Guid SupplierId, Guid? CustomerId, string? SupplierRef,
    DateOnly OrderDate, string? Incoterm, string? LoadingPort,
    string? DischargePort, string? Currency, string? Notes,
    IReadOnlyList<SaveOrderItemRequest>? Items, int? Revision);

public sealed record ValidatedOrderItem(
    Guid? Id, string ProductType, string Denier, string Luster, string Grade,
    string ColorType, decimal QuantityKg, decimal UnitPrice,
    string PriceUnit, decimal LineTotal, string HsCode);

public sealed record ValidatedOrderDraft(
    string SupplierRef, DateOnly OrderDate, string Incoterm, string LoadingPort,
    string DischargePort, string Currency, string Notes,
    IReadOnlyList<ValidatedOrderItem> Items, decimal TotalAmount);

public sealed class OrderValidationException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

// Pure function used by the API and executable contract tests.
// All calculations are in base currency, no float/double, and KG persisted.
public static class OrderDraftCalculator
{
    private static readonly HashSet<string> Incoterms =
        ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
    // The MVP uses 2-decimal currencies, no exchange-rate feature yet.
    private static readonly HashSet<string> Currencies = ["USD", "EUR", "CNY", "TRY"];

    public static ValidatedOrderDraft Validate(SaveOrderRequest request)
    {
        if (request.SupplierId == Guid.Empty) Invalid("supplier_required");
        if (request.CustomerId == Guid.Empty) Invalid("invalid_customer");
        if (request.OrderDate.Year is < 2000 or > 2100) Invalid("invalid_order_date");
        var term = (request.Incoterm ?? "").Trim().ToUpperInvariant();
        if (!Incoterms.Contains(term)) Invalid("invalid_incoterm");
        var currency = (request.Currency ?? "").Trim().ToUpperInvariant();
        if (!Currencies.Contains(currency)) Invalid("unsupported_currency");
        var supplierRef = Clean(request.SupplierRef, 120, "invalid_supplier_ref");
        var loading = Clean(request.LoadingPort, 160, "invalid_loading_port");
        var discharge = Clean(request.DischargePort, 160, "invalid_discharge_port");
        var notes = Clean(request.Notes, 3000, "invalid_notes");
        if (request.Items is not { Count: > 0 and <= 100 })
            Invalid("invalid_order_items");

        var seenIds = new HashSet<Guid>();
        var lines = new List<ValidatedOrderItem>(request.Items.Count);
        decimal total = 0m;
        foreach (var input in request.Items)
        {
            if (input is null) Invalid("invalid_order_item");
            if (input.Id == Guid.Empty) Invalid("invalid_order_item_id");
            if (input.Id.HasValue && !seenIds.Add(input.Id.Value)) Invalid("duplicate_order_item_id");
            var product = Clean(input.ProductType, 80, "invalid_product_type");
            if (string.IsNullOrWhiteSpace(product)) Invalid("product_type_required");
            var denier = Clean(input.Denier, 80, "invalid_denier");
            var luster = Clean(input.Luster, 80, "invalid_luster");
            var grade = Clean(input.Grade, 80, "invalid_grade");
            var color = Clean(input.ColorType, 100, "invalid_color_type");
            var hsCode = Clean(input.HsCode, 30, "invalid_hs_code");
            var quantityUnit = (input.QuantityUnit ?? "").Trim().ToUpperInvariant();
            var priceUnit = (input.PriceUnit ?? "").Trim().ToUpperInvariant();
            if (quantityUnit is not ("KG" or "TON") || priceUnit is not ("KG" or "TON"))
                Invalid("invalid_quantity_or_price_unit");
            if (input.Quantity <= 0m || input.UnitPrice <= 0m)
                Invalid("quantity_and_price_must_be_positive");
            if (input.Quantity > 100_000_000m || input.UnitPrice > 10_000_000m)
                Invalid("order_amount_too_large");
            if (input.UnitPrice != decimal.Round(input.UnitPrice, 4))
                Invalid("unit_price_precision");
            decimal kg, line;
            try
            {
                kg = quantityUnit == "TON" ? checked(input.Quantity * 1000m) : input.Quantity;
                if (kg != decimal.Round(kg, 3, MidpointRounding.AwayFromZero))
                    Invalid("quantity_precision");
                var amount = priceUnit == "TON"
                    ? checked((kg / 1000m) * input.UnitPrice)
                    : checked(kg * input.UnitPrice);
                line = decimal.Round(amount, 2, MidpointRounding.AwayFromZero);
                if (line <= 0) Invalid("line_amount_too_small");
                total = checked(total + line);
                if (total > 1_000_000_000_000m) Invalid("order_amount_too_large");
            }
            catch (OverflowException)
            {
                throw new OrderValidationException("order_amount_too_large");
            }
            lines.Add(new ValidatedOrderItem(input.Id, product, denier, luster, grade,
                color, kg, input.UnitPrice, priceUnit, line, hsCode));
        }
        return new ValidatedOrderDraft(supplierRef, request.OrderDate, term, loading,
            discharge, currency, notes, lines, total);
    }

    private static string Clean(string? input, int length, string error)
    {
        var clean = (input ?? "").Trim();
        if (clean.Length > length || clean.Contains('\0'))
            throw new OrderValidationException(error);
        return clean;
    }

    [DoesNotReturn]
    private static void Invalid(string code) => throw new OrderValidationException(code);
}
