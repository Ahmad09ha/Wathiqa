using Microsoft.EntityFrameworkCore;
using System.Net.Mail;

namespace Wathiqa.ImportApi;

public sealed record SaveCompanyRequest(
    string Name, string Type, string? NameEn = null, string? Country = null,
    string? City = null, string? Address = null, string? ContactName = null,
    string? Phone = null, string? Email = null, string? TaxNo = null,
    string? DefaultCurrency = null, string? Notes = null);

public static class CompanyApi
{
    private static readonly string[] AllowedTypes = ["Supplier", "Customer", "Broker", "ShippingLine", "Forwarder", "Other"];

    public static void Map(WebApplication app)
    {
        var group = app.MapGroup("/api/companies").RequireAuthorization("TenantMember");

        group.MapGet("/", async (ImportDb db) =>
            Results.Ok((await db.Companies.AsNoTracking()
                .OrderBy(x => x.Name).ToListAsync()).Select(Detail)));

        // New paged directory contract. Retain the existing unpaged GET / for
        // current Purchase Order supplier/customer dropdown consumers.
        group.MapGet("/search", async (
            ImportDb db, string? search, string? type, int? page, int? pageSize) =>
        {
            var currentPage = page ?? 1;
            var take = pageSize ?? 20;
            if (currentPage is < 1 or > 100000 || take is < 1 or > 100 ||
                search?.Length > 120 || type?.Length > 30)
                return Results.BadRequest(new { error = "invalid_filter" });
            var filterType = "";
            if (!string.IsNullOrWhiteSpace(type))
            {
                filterType = AllowedTypes.FirstOrDefault(x =>
                    x.Equals(type.Trim(), StringComparison.OrdinalIgnoreCase)) ?? "";
                if (filterType.Length == 0)
                    return Results.BadRequest(new { error = "invalid_filter" });
            }
            var query = db.Companies.AsNoTracking().AsQueryable();
            if (filterType.Length > 0) query = query.Where(c => c.Type == filterType);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.Trim().ToLowerInvariant();
                query = query.Where(c => c.Name.ToLower().Contains(term) ||
                    c.NameEn.ToLower().Contains(term) ||
                    c.ContactName.ToLower().Contains(term));
            }
            var total = await query.CountAsync();
            var companies = await query.OrderBy(c => c.Name).ThenBy(c => c.Id)
                .Skip((currentPage - 1) * take).Take(take).ToListAsync();
            return Results.Ok(new { page = currentPage, pageSize = take,
                total, items = companies.Select(Detail).ToArray() });
        });

        group.MapGet("/{id:guid}", async (Guid id, ImportDb db) =>
            await db.Companies.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id)
                is { } company ? Results.Ok(Detail(company)) : Results.NotFound());

        group.MapPost("/", async (
            SaveCompanyRequest body, ImportDb db,
            System.Security.Claims.ClaimsPrincipal principal) =>
        {
            if (!TryNormalize(body, out var normalized))
                return Results.BadRequest(new { error = "invalid_company_details" });
            var tenantId = CurrentTenant.Id(principal);
            var company = new TenantCompany { TenantId = tenantId };
            Apply(company, normalized!);
            db.Companies.Add(company);
            db.CompanyAudits.Add(Audit(company, CurrentTenant.UserId(principal), "Created"));
            await db.SaveChangesAsync();
            return Results.Created($"/api/companies/{company.Id}",
                Detail(company));
        });

        group.MapPut("/{id:guid}", async (Guid id, SaveCompanyRequest body, ImportDb db,
            System.Security.Claims.ClaimsPrincipal principal) =>
        {
            if (!TryNormalize(body, out var normalized))
                return Results.BadRequest(new { error = "invalid_company_details" });
            var company = await db.Companies.SingleOrDefaultAsync(x => x.Id == id);
            if (company is null) return Results.NotFound(); // including foreign-tenant ID
            if (company.Type != normalized!.Type && await HasActiveReferences(db, id))
                return Results.Conflict(new { error = "company_in_use" });
            Apply(company, normalized!);
            db.CompanyAudits.Add(Audit(company, CurrentTenant.UserId(principal), "Updated"));
            await db.SaveChangesAsync();
            return Results.Ok(Detail(company));
        });

        group.MapDelete("/{id:guid}", async (Guid id, ImportDb db,
            System.Security.Claims.ClaimsPrincipal principal) =>
        {
            var company = await db.Companies.SingleOrDefaultAsync(x => x.Id == id);
            if (company is null) return Results.NotFound();
            // A soft-deleted trading party must not disappear from active
            // Purchase Orders, B/L shipping lines or customs declarations.
            if (await HasActiveReferences(db, id))
                return Results.Conflict(new { error = "company_in_use" });
            company.IsDeleted = true;
            db.CompanyAudits.Add(Audit(company, CurrentTenant.UserId(principal), "Deleted"));
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private static TenantCompanyAudit Audit(TenantCompany company, Guid actorId,
        string action) => new()
    {
        TenantId = company.TenantId, CompanyId = company.Id,
        ActorId = actorId, Action = action,
        NameSnapshot = company.Name, TypeSnapshot = company.Type
    };

    private static async Task<bool> HasActiveReferences(ImportDb db, Guid companyId) =>
        await db.Orders.AnyAsync(o => o.SupplierId == companyId || o.CustomerId == companyId) ||
        await db.Shipments.AnyAsync(s => s.ShippingLineId == companyId) ||
        await db.CustomsClearances.AnyAsync(c => c.BrokerId == companyId) ||
        await db.PaymentTransfers.AnyAsync(t => t.BeneficiaryCompanyId == companyId) ||
        await db.OrderExpenses.AnyAsync(e => e.PayeeCompanyId == companyId);

    private static object Detail(TenantCompany company) => new
    {
        company.Id, company.Name, company.Type, company.NameEn,
        company.Country, company.City, company.Address, company.ContactName,
        company.Phone, company.Email, company.TaxNo, company.DefaultCurrency,
        company.Notes, company.CreatedAtUtc
    };

    private static void Apply(TenantCompany company, SaveCompanyRequest input)
    {
        company.Name = input.Name;
        company.Type = input.Type;
        company.NameEn = input.NameEn!;
        company.Country = input.Country!;
        company.City = input.City!;
        company.Address = input.Address!;
        company.ContactName = input.ContactName!;
        company.Phone = input.Phone!;
        company.Email = input.Email!;
        company.TaxNo = input.TaxNo!;
        company.DefaultCurrency = input.DefaultCurrency!;
        company.Notes = input.Notes!;
    }

    private static bool TryNormalize(SaveCompanyRequest body, out SaveCompanyRequest? normalized)
    {
        static string Clean(string? value) => (value ?? "").Trim();
        var name = Clean(body.Name);
        var type = AllowedTypes.FirstOrDefault(x => x.Equals(body.Type, StringComparison.OrdinalIgnoreCase)) ?? "";
        normalized = body with
        {
            Name = name, Type = type, NameEn = Clean(body.NameEn), Country = Clean(body.Country),
            City = Clean(body.City), Address = Clean(body.Address),
            ContactName = Clean(body.ContactName), Phone = Clean(body.Phone),
            Email = Clean(body.Email), TaxNo = Clean(body.TaxNo),
            DefaultCurrency = Clean(body.DefaultCurrency).ToUpperInvariant(),
            Notes = Clean(body.Notes)
        };
        if (name.Length is < 2 or > 180 || type.Length == 0 ||
            normalized.NameEn!.Length > 180 || normalized.Country!.Length > 100 ||
            normalized.City!.Length > 100 || normalized.Address!.Length > 500 ||
            normalized.ContactName!.Length > 160 || normalized.Phone!.Length > 45 ||
            normalized.Email!.Length > 254 || normalized.TaxNo!.Length > 80 ||
            normalized.Notes!.Length > 2000 ||
            (normalized.DefaultCurrency!.Length > 0 && normalized.DefaultCurrency is not ("USD" or "EUR")))
            return false;
        if (normalized.Email.Length > 0 &&
            (!MailAddress.TryCreate(normalized.Email, out var email) ||
             !string.Equals(email.Address, normalized.Email, StringComparison.OrdinalIgnoreCase)))
            return false;
        // Avoid persisting NULs that cannot round-trip safely to PostgreSQL.
        return !new[] { name, normalized.NameEn, normalized.Country, normalized.City,
            normalized.Address, normalized.ContactName, normalized.Phone, normalized.Email,
            normalized.TaxNo, normalized.DefaultCurrency, normalized.Notes }
            .Any(x => x!.Contains('\0'));
    }
}
