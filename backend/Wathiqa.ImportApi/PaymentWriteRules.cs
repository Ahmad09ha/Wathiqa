using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

// This helper is intentionally domain-specific. Every financial write locks
// the same Order row in PostgreSQL. The short transaction serializes all
// mutations affecting its conservation equation and prevents oversettlement.
public static class PaymentWriteRules
{
    public static bool AmountOk(decimal amount) => amount>0 && amount<=1_000_000_000_000m &&
        decimal.Round(amount,2,MidpointRounding.AwayFromZero)==amount;
    public static bool DateOk(DateOnly date)=>date.Year is >=2000 and <=2100;
    public static bool TextOk(string? text,int max=160) => text is not null &&
        text.Trim().Length<=max && !text.Contains('\0');
    public static bool ReasonOk(string? reason) => reason is not null &&
        reason.Trim().Length is >=8 and <=1000 && !reason.Contains('\0');
    public static bool IdempotencyOk(Guid key)=>key!=Guid.Empty;

    public static string Hash(object input) => Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(input)))).ToLowerInvariant();

    public static async Task<PurchaseOrder?> LockOrder(ImportDb db,Guid tenant,Guid order)
    {
        // Unlike the usual EF filtered query, this explicit SQL includes BOTH
        // the actor's tenant and not-deleted guard before obtaining FOR UPDATE.
        // IgnoreQueryFilters is safe only here because manual scoping is strict.
        var rows=await db.Orders.FromSqlInterpolated($"""
            SELECT * FROM "Orders" WHERE "Id" = {order}
               AND "TenantId" = {tenant} AND "IsDeleted" = false
            FOR UPDATE
            """).IgnoreQueryFilters().AsTracking().ToListAsync();
        return rows.SingleOrDefault();
    }
    public static IResult? CheckRevision(PurchaseOrder order,int? expected) =>
        expected is null or <1?Results.BadRequest(new{error="revision_required"}):
        order.Revision!=expected?Results.Conflict(new{error="stale_order_revision",currentRevision=order.Revision}):null;

    public static async Task<string?> Beneficiary(ImportDb db,Guid companyId)=>
        await db.Companies.AsNoTracking().Where(x=>x.Id==companyId)
            .Select(x=>x.Name).SingleOrDefaultAsync();

    public static async Task<bool> ProofBelongsToOrder(ImportDb db,Guid orderId,
        Guid documentId,bool requirePaymentProof,IWebHostEnvironment environment)
    {
        if(documentId==Guid.Empty)return false;
        return await db.StoredDocuments.AsNoTracking().AnyAsync(d=>d.Id==documentId &&
            (!requirePaymentProof || d.Type=="PaymentProof") &&
            (environment.IsDevelopment() || d.ScanStatus=="Clean") &&
            db.StoredDocumentLinks.Any(l=>l.DocumentId==d.Id&&l.OrderId==orderId));
    }

    public static void BumpOrder(PurchaseOrder order,ClaimsPrincipal user)
    {
        order.Revision++;
        order.UpdatedById=CurrentTenant.UserId(user);
        order.UpdatedAtUtc=DateTime.UtcNow;
    }
    public static void Audit(ImportDb db,PurchaseOrder order,ClaimsPrincipal user,
        string action,Guid entityId,string reason,object? before,object? after)
    {
        db.PaymentAudits.Add(new PaymentAudit {
            TenantId=order.TenantId,OrderId=order.Id,ActorId=CurrentTenant.UserId(user),
            Action=action,EntityId=entityId,Reason=reason,
            BeforeJson=before is null?"":JsonSerializer.Serialize(before),
            AfterJson=after is null?"":JsonSerializer.Serialize(after),OccurredAtUtc=DateTime.UtcNow
        });
    }
    public static IResult Error(string code)=>Results.BadRequest(new{error=code});
    public static IResult Conflict(string code)=>Results.Conflict(new{error=code});
}
