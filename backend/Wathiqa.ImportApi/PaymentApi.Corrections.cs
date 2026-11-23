using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

public sealed record CorrectTransferInput(decimal Amount,DateOnly TransferDate,
    string? Method,string? Reference,Guid ProofDocumentId,string? Reason,
    Guid IdempotencyKey,int? Revision,string? BankOrExchangeName=null);
public sealed record ReturnTransferInput(decimal Amount,DateOnly ReturnDate,
    string? BankReference,Guid ProofDocumentId,string? Reason,
    Guid IdempotencyKey,int? Revision);
public sealed record CloseOrderInput(string? Reason,int? Revision);

public static partial class PaymentApi
{
    private static partial void MapCorrections(RouteGroupBuilder group)
    {
        group.MapPost("/{orderId:guid}/payment-transfers/{transferId:guid}/correct",CorrectTransfer)
            .RequireAuthorization("CanManagePayments");
        group.MapPost("/{orderId:guid}/payment-transfers/{transferId:guid}/returns",ReturnTransfer)
            .RequireAuthorization("CanManagePayments");
        group.MapPost("/{orderId:guid}/close",CloseWithException)
            .RequireAuthorization("TenantAdmin");
        group.MapPost("/{orderId:guid}/cancel",CancelSafeDraft)
            .RequireAuthorization("TenantAdmin");
    }

    private static async Task<IResult> CorrectTransfer(Guid orderId,Guid transferId,
        CorrectTransferInput input,ImportDb db,ClaimsPrincipal user,IWebHostEnvironment env)
    {
        var reason=input.Reason?.Trim()??"";
        var method=input.Method?.Trim()??"";
        var reference=input.Reference?.Trim()??"";
        if(!PaymentWriteRules.AmountOk(input.Amount)||!PaymentWriteRules.DateOk(input.TransferDate)||
            !PaymentWriteRules.ReasonOk(reason)||
            method is not ("BankTransfer" or "LC" or "Cash" or "Other" or "ExchangeOffice")||
            !PaymentWriteRules.TextOk(reference)||
            !PaymentWriteRules.TextOk(input.BankOrExchangeName??"",180)||
            !PaymentWriteRules.IdempotencyOk(input.IdempotencyKey))
            return PaymentWriteRules.Error("invalid_transfer_correction");
        var tenant=CurrentTenant.Id(user);var actor=CurrentTenant.UserId(user);
        var hash=input.BankOrExchangeName is null
            ?PaymentWriteRules.Hash(new{orderId,transferId,input.Amount,input.TransferDate,
                method,reference,input.ProofDocumentId,reason})
            :PaymentWriteRules.Hash(new{orderId,transferId,input.Amount,input.TransferDate,
                method,reference,input.ProofDocumentId,reason,
                BankOrExchangeName=input.BankOrExchangeName.Trim()});
        await using var transaction=await db.Database.BeginTransactionAsync();
        var order=await PaymentWriteRules.LockOrder(db,tenant,orderId);
        if(order is null)return Results.NotFound();
        var previous=await db.PaymentTransfers.AsNoTracking().SingleOrDefaultAsync(t=>
            t.CreatedById==actor&&t.IdempotencyKey==input.IdempotencyKey);
        if(previous is not null)return previous.OrderId==orderId&&
            previous.ReplacesTransferId==transferId&&previous.RequestHash==hash
            ?Results.Ok(new{previous.Id,previous.Amount,replayed=true,revision=order.Revision})
            :PaymentWriteRules.Conflict("idempotency_key_reused");
        if(PaymentWriteRules.CheckRevision(order,input.Revision) is { } error)return error;
        var old=await db.PaymentTransfers.SingleOrDefaultAsync(x=>x.Id==transferId&&x.OrderId==orderId);
        if(old is null)return Results.NotFound();
        if(old.State!="Active")return PaymentWriteRules.Conflict("transfer_already_voided");
        var snapshot=await PaymentSnapshot.LoadAsync(db,order);
        snapshot.AssertInvariants();
        if(snapshot.TransferReturned(old.Id)>0 ||
            snapshot.Allocations.Any(a=>a.TransferId==old.Id&&a.Kind=="Expense"))
            return PaymentWriteRules.Conflict("transfer_correction_requires_reconciliation");
        if(!await PaymentWriteRules.ProofBelongsToOrder(db,orderId,input.ProofDocumentId,true,env))
            return PaymentWriteRules.Error("payment_proof_not_linked_to_order");
        var oldCommercial=snapshot.Allocations.Where(x=>x.TransferId==old.Id&&x.Kind=="Commercial")
            .Sum(x=>x.Amount);
        var otherCommercial=snapshot.AppliedCommercial-oldCommercial;
        var newCommercial=old.BeneficiaryCompanyId==order.SupplierId?
            Math.Min(input.Amount,Math.Max(0,order.TotalAmount-otherCommercial)):0m;
        old.State="Voided";old.VoidReason=reason;old.VoidedAtUtc=DateTime.UtcNow;old.VoidedById=actor;
        var replacement=new PaymentTransfer{
            TenantId=tenant,OrderId=orderId,Amount=input.Amount,
            BeneficiaryCompanyId=old.BeneficiaryCompanyId,BeneficiarySnapshot=old.BeneficiarySnapshot,
            TransferDate=input.TransferDate,Method=method,Reference=reference,
            BankOrExchangeName=input.BankOrExchangeName is null
                ? old.BankOrExchangeName : input.BankOrExchangeName.Trim(),
            ProofDocumentId=input.ProofDocumentId,ReplacesTransferId=old.Id,
            IdempotencyKey=input.IdempotencyKey,RequestHash=hash,CreatedById=actor
        };
        db.PaymentTransfers.Add(replacement);
        if(newCommercial>0)db.PaymentAllocations.Add(new PaymentAllocation{
            TenantId=tenant,OrderId=orderId,TransferId=replacement.Id,Kind="Commercial",
            Amount=newCommercial,IdempotencyKey=Guid.NewGuid(),RequestHash=hash,CreatedById=actor
        });
        PaymentWriteRules.BumpOrder(order,user);
        PaymentWriteRules.Audit(db,order,user,"TransferVoidReplace",replacement.Id,reason,
            new{old.Id,old.Amount,old.ProofDocumentId,old.Reference,old.TransferDate},
            new{replacement.Id,replacement.Amount,replacement.ProofDocumentId,
                replacement.Reference,replacement.TransferDate,newCommercial});
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Created($"/api/orders/{orderId}/finances",new{
            replacement.Id,replacement.Amount,replacement.ReplacesTransferId,
            revision=order.Revision});
    }

    private static async Task<IResult> ReturnTransfer(Guid orderId,Guid transferId,
        ReturnTransferInput input,ImportDb db,ClaimsPrincipal user,IWebHostEnvironment env)
    {
        var reason=input.Reason?.Trim()??"";
        var reference=input.BankReference?.Trim()??"";
        if(!PaymentWriteRules.AmountOk(input.Amount)||!PaymentWriteRules.DateOk(input.ReturnDate)||
           !PaymentWriteRules.ReasonOk(reason)||!PaymentWriteRules.TextOk(reference)||
           !PaymentWriteRules.IdempotencyOk(input.IdempotencyKey))
            return PaymentWriteRules.Error("invalid_bank_return");
        var tenant=CurrentTenant.Id(user);var actor=CurrentTenant.UserId(user);
        var hash=PaymentWriteRules.Hash(new{orderId,transferId,input.Amount,input.ReturnDate,
            reference,input.ProofDocumentId,reason});
        await using var transaction=await db.Database.BeginTransactionAsync();
        var order=await PaymentWriteRules.LockOrder(db,tenant,orderId);
        if(order is null)return Results.NotFound();
        var previous=await db.PaymentReturns.AsNoTracking().SingleOrDefaultAsync(x=>
            x.CreatedById==actor&&x.IdempotencyKey==input.IdempotencyKey);
        if(previous is not null)return previous.OrderId==orderId&&previous.TransferId==transferId&&
            previous.RequestHash==hash?Results.Ok(new{previous.Id,previous.Amount,
                replayed=true,revision=order.Revision}):PaymentWriteRules.Conflict("idempotency_key_reused");
        if(PaymentWriteRules.CheckRevision(order,input.Revision) is { } error)return error;
        var old=await db.PaymentTransfers.SingleOrDefaultAsync(t=>t.Id==transferId&&t.OrderId==orderId);
        if(old is null)return Results.NotFound();
        if(old.State!="Active")return PaymentWriteRules.Conflict("transfer_not_active");
        if(input.ReturnDate<old.TransferDate)return PaymentWriteRules.Error("return_before_original_transfer");
        if(!await PaymentWriteRules.ProofBelongsToOrder(db,orderId,input.ProofDocumentId,true,env))
            return PaymentWriteRules.Error("payment_proof_not_linked_to_order");
        var snapshot=await PaymentSnapshot.LoadAsync(db,order);
        snapshot.AssertInvariants();
        // Do not silently reopen settled goods or expenses. A real refund of
        // money already allocated requires a separate explicit accounting flow.
        if(input.Amount>snapshot.TransferAvailable(transferId))
            return PaymentWriteRules.Conflict("return_exceeds_unallocated_transfer");
        var row=new PaymentReturn{TenantId=tenant,OrderId=orderId,TransferId=transferId,
            Amount=input.Amount,ReturnDate=input.ReturnDate,BankReference=reference,
            ProofDocumentId=input.ProofDocumentId,Reason=reason,CreatedById=actor,
            IdempotencyKey=input.IdempotencyKey,RequestHash=hash};
        db.PaymentReturns.Add(row);
        PaymentWriteRules.BumpOrder(order,user);
        PaymentWriteRules.Audit(db,order,user,"BankReturnRecorded",row.Id,reason,null,
            new{row.TransferId,row.Amount,row.ReturnDate,row.ProofDocumentId});
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Created($"/api/orders/{orderId}/finances",
            new{row.Id,row.Amount,row.TransferId,revision=order.Revision});
    }

    private static async Task<IResult> CloseWithException(Guid orderId,CloseOrderInput input,
        ImportDb db,ClaimsPrincipal user)
    {
        if(!PaymentWriteRules.ReasonOk(input.Reason))
            return PaymentWriteRules.Error("closure_reason_required");
        var reason=input.Reason!.Trim();
        await using var transaction=await db.Database.BeginTransactionAsync();
        var order=await PaymentWriteRules.LockOrder(db,CurrentTenant.Id(user),orderId);
        if(order is null)return Results.NotFound();
        if(PaymentWriteRules.CheckRevision(order,input.Revision) is { } error)return error;
        if(order.Status!="Draft")return PaymentWriteRules.Conflict("order_cannot_close");
        var snapshot=await PaymentSnapshot.LoadAsync(db,order);
        snapshot.AssertInvariants();
        // The close is explicitly administrative, not financial settlement;
        // all transfers, balances, shipment facts and document gaps survive.
        var before=new{order.Status,order.Revision,snapshot.CommercialRemainingDue,
            snapshot.UnresolvedDifference,order.ArrivalStatus,order.ClearanceStatus};
        order.Status="Closed";
        order.ClosedWithExceptions=true;
        order.ClosureReason=reason;
        order.ClosedAtUtc=DateTime.UtcNow;
        order.ClosedById=CurrentTenant.UserId(user);
        PaymentWriteRules.BumpOrder(order,user);
        db.OrderAudits.Add(new OrderAudit{TenantId=order.TenantId,OrderId=order.Id,
            ActorId=CurrentTenant.UserId(user),Action="ClosedException",
            PreviousRevision=input.Revision!.Value,NewRevision=order.Revision,
            BeforeJson=System.Text.Json.JsonSerializer.Serialize(before),
            AfterJson=System.Text.Json.JsonSerializer.Serialize(new{order.Status,
                order.ClosureReason,order.ClosedWithExceptions}),OccurredAtUtc=DateTime.UtcNow});
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Ok(new{order.Id,order.Status,order.ClosedWithExceptions,
            order.ClosureReason,order.ClosedAtUtc,order.Revision});
    }

    private static async Task<IResult> CancelSafeDraft(Guid orderId,CloseOrderInput input,
        ImportDb db,ClaimsPrincipal user)
    {
        if(!PaymentWriteRules.ReasonOk(input.Reason))
            return PaymentWriteRules.Error("closure_reason_required");
        await using var transaction=await db.Database.BeginTransactionAsync();
        var order=await PaymentWriteRules.LockOrder(db,CurrentTenant.Id(user),orderId);
        if(order is null)return Results.NotFound();
        if(PaymentWriteRules.CheckRevision(order,input.Revision) is { } error)return error;
        if(order.Status!="Draft")return PaymentWriteRules.Conflict("order_cannot_cancel");
        var hasFinancialFacts=await db.PaymentSchedules.AnyAsync(x=>x.OrderId==orderId)||
            await db.PaymentTransfers.AnyAsync(x=>x.OrderId==orderId)||
            await db.OrderExpenses.AnyAsync(x=>x.OrderId==orderId);
        if(hasFinancialFacts||await db.Shipments.AnyAsync(x=>x.OrderId==orderId)||
            await db.StoredDocumentLinks.AnyAsync(x=>x.OrderId==orderId))
            return PaymentWriteRules.Conflict("order_cancellation_requires_settlement");
        var oldRevision=order.Revision;
        order.Status="Cancelled";
        order.ClosureReason=input.Reason!.Trim();
        order.ClosedById=CurrentTenant.UserId(user);
        order.ClosedAtUtc=DateTime.UtcNow;
        PaymentWriteRules.BumpOrder(order,user);
        db.OrderAudits.Add(new OrderAudit{TenantId=order.TenantId,OrderId=order.Id,
            ActorId=CurrentTenant.UserId(user),Action="Cancelled",
            PreviousRevision=oldRevision,NewRevision=order.Revision,
            BeforeJson="\"Draft\"",
            AfterJson=System.Text.Json.JsonSerializer.Serialize(new{order.Status,order.ClosureReason}),
            OccurredAtUtc=DateTime.UtcNow});
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Ok(new{order.Id,order.Status,order.Revision});
    }
}
