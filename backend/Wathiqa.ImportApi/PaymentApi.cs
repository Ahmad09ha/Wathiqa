using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

public sealed record CreateScheduleInput(string? Kind,decimal Amount,DateOnly DueDate,
    string? Notes,Guid IdempotencyKey,int? Revision);
public sealed record CreateTransferInput(decimal Amount,Guid BeneficiaryCompanyId,
    DateOnly TransferDate,string? Method,string? Reference,Guid ProofDocumentId,
    Guid IdempotencyKey,int? Revision);
public sealed record CreateExpenseInput(decimal Amount,Guid PayeeCompanyId,string? Category,
    string? Description,Guid EvidenceDocumentId,Guid IdempotencyKey,int? Revision);
public sealed record AllocateExpenseInput(Guid TransferId,decimal Amount,
    Guid IdempotencyKey,int? Revision);

public static partial class PaymentApi
{
    public static void Map(WebApplication app)
    {
        var group=app.MapGroup("/api/orders").RequireAuthorization("TenantMember");
        group.MapGet("/{orderId:guid}/finances",Read);
        group.MapGet("/{orderId:guid}/payment-audits",ReadAudits);
        group.MapPost("/{orderId:guid}/payment-schedules",CreateSchedule)
            .RequireAuthorization("CanManagePayments");
        group.MapPost("/{orderId:guid}/payment-transfers",CreateTransfer)
            .RequireAuthorization("CanManagePayments");
        group.MapPost("/{orderId:guid}/expenses",CreateExpense)
            .RequireAuthorization("CanManagePayments");
        group.MapPost("/{orderId:guid}/expenses/{expenseId:guid}/allocations",AllocateExpense)
            .RequireAuthorization("CanManagePayments");
        MapCorrections(group);
    }

    private static async Task<IResult> Read(Guid orderId,ImportDb db)
    {
        var order=await db.Orders.AsNoTracking().SingleOrDefaultAsync(x=>x.Id==orderId);
        if(order is null)return Results.NotFound();
        var snapshot=await PaymentSnapshot.LoadAsync(db,order);
        return Results.Ok(snapshot.Detail(DateOnly.FromDateTime(DateTime.UtcNow)));
    }

    private static async Task<IResult> ReadAudits(Guid orderId,ImportDb db,int? page,int? pageSize)
    {
        var number=page??1;var take=pageSize??25;
        if(number is <1 or >100000 || take is <1 or >100)
            return PaymentWriteRules.Error("invalid_pagination");
        if(!await db.Orders.AnyAsync(x=>x.Id==orderId))return Results.NotFound();
        var query=db.PaymentAudits.AsNoTracking().Where(x=>x.OrderId==orderId);
        var total=await query.CountAsync();
        var entries=await query.OrderByDescending(x=>x.OccurredAtUtc).ThenByDescending(x=>x.Id)
            .Skip((number-1)*take).Take(take)
            .Select(x=>new{x.Id,x.Action,x.ActorId,x.EntityId,x.Reason,
                x.BeforeJson,x.AfterJson,x.OccurredAtUtc}).ToListAsync();
        return Results.Ok(new{page=number,pageSize=take,total,items=entries});
    }

    private static async Task<IResult> CreateSchedule(Guid orderId,CreateScheduleInput input,
        ImportDb db,ClaimsPrincipal user)
    {
        var kind=input.Kind?.Trim()??"";
        var notes=input.Notes?.Trim()??"";
        if(kind is not ("Advance" or "Balance" or "Other") ||
           !PaymentWriteRules.AmountOk(input.Amount) ||
           !PaymentWriteRules.DateOk(input.DueDate) ||
           !PaymentWriteRules.TextOk(notes,500) ||
           !PaymentWriteRules.IdempotencyOk(input.IdempotencyKey))
            return PaymentWriteRules.Error("invalid_payment_schedule");
        var tenant=CurrentTenant.Id(user);var actor=CurrentTenant.UserId(user);
        var hash=PaymentWriteRules.Hash(new{orderId,kind,input.Amount,input.DueDate,notes});
        await using var transaction=await db.Database.BeginTransactionAsync();
        var order=await PaymentWriteRules.LockOrder(db,tenant,orderId);
        if(order is null)return Results.NotFound();
        var existing=await db.PaymentSchedules.AsNoTracking().SingleOrDefaultAsync(x=>
            x.CreatedById==actor && x.IdempotencyKey==input.IdempotencyKey);
        if(existing is not null)return existing.OrderId==orderId&&existing.RequestHash==hash
            ?Results.Ok(new{existing.Id,existing.Amount,existing.Kind,existing.DueDate,
                existing.Notes,revision=order.Revision,replayed=true})
            :PaymentWriteRules.Conflict("idempotency_key_reused");
        if(PaymentWriteRules.CheckRevision(order,input.Revision) is { } error)return error;
        if(order.Status=="Cancelled")return PaymentWriteRules.Conflict("order_cancelled");
        var planned=await db.PaymentSchedules.Where(x=>x.OrderId==orderId).SumAsync(x=>(decimal?)x.Amount)??0m;
        if(input.Amount>order.TotalAmount-planned)
            return PaymentWriteRules.Conflict("schedule_exceeds_commercial_amount");
        var row=new PaymentSchedule{TenantId=tenant,OrderId=orderId,Amount=input.Amount,
            Kind=kind,DueDate=input.DueDate,Notes=notes,CreatedById=actor,
            IdempotencyKey=input.IdempotencyKey,RequestHash=hash};
        db.PaymentSchedules.Add(row);
        PaymentWriteRules.BumpOrder(order,user);
        PaymentWriteRules.Audit(db,order,user,"ScheduleCreated",row.Id,"",null,
            new{row.Amount,row.Kind,row.DueDate,row.Notes});
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Created($"/api/orders/{orderId}/finances",
            new{row.Id,row.Amount,row.Kind,row.DueDate,row.Notes,revision=order.Revision});
    }

    private static async Task<IResult> CreateTransfer(Guid orderId,CreateTransferInput input,
        ImportDb db,ClaimsPrincipal user,IWebHostEnvironment env)
    {
        var method=input.Method?.Trim()??"";
        var reference=input.Reference?.Trim()??"";
        if(!PaymentWriteRules.AmountOk(input.Amount)||!PaymentWriteRules.DateOk(input.TransferDate)||
           method is not ("BankTransfer" or "LC" or "Cash" or "Other") ||
           !PaymentWriteRules.TextOk(reference)||input.BeneficiaryCompanyId==Guid.Empty||
           !PaymentWriteRules.IdempotencyOk(input.IdempotencyKey))
            return PaymentWriteRules.Error("invalid_transfer");
        var tenant=CurrentTenant.Id(user);var actor=CurrentTenant.UserId(user);
        var hash=PaymentWriteRules.Hash(new{orderId,input.Amount,input.BeneficiaryCompanyId,
            input.TransferDate,method,reference,input.ProofDocumentId});
        await using var transaction=await db.Database.BeginTransactionAsync();
        var order=await PaymentWriteRules.LockOrder(db,tenant,orderId);
        if(order is null)return Results.NotFound();
        var previous=await db.PaymentTransfers.AsNoTracking().SingleOrDefaultAsync(x=>
            x.CreatedById==actor&&x.IdempotencyKey==input.IdempotencyKey);
        if(previous is not null)return previous.OrderId==orderId&&previous.RequestHash==hash
            ?Results.Ok(new{previous.Id,previous.Amount,previous.State,revision=order.Revision,replayed=true})
            :PaymentWriteRules.Conflict("idempotency_key_reused");
        if(PaymentWriteRules.CheckRevision(order,input.Revision) is { } error)return error;
        if(order.Status=="Cancelled")return PaymentWriteRules.Conflict("order_cancelled");
        var beneficiary=await PaymentWriteRules.Beneficiary(db,input.BeneficiaryCompanyId);
        if(beneficiary is null)return PaymentWriteRules.Error("payment_beneficiary_unavailable");
        if(!await PaymentWriteRules.ProofBelongsToOrder(db,orderId,input.ProofDocumentId,true,env))
            return PaymentWriteRules.Error("payment_proof_not_linked_to_order");
        var snapshot=await PaymentSnapshot.LoadAsync(db,order);
        snapshot.AssertInvariants();
        var transfer=new PaymentTransfer{TenantId=tenant,OrderId=orderId,
            BeneficiaryCompanyId=input.BeneficiaryCompanyId,BeneficiarySnapshot=beneficiary,
            Amount=input.Amount,TransferDate=input.TransferDate,Method=method,
            Reference=reference,ProofDocumentId=input.ProofDocumentId,
            IdempotencyKey=input.IdempotencyKey,RequestHash=hash,CreatedById=actor};
        db.PaymentTransfers.Add(transfer);
        var commercial=input.BeneficiaryCompanyId==order.SupplierId?
            Math.Min(input.Amount,snapshot.CommercialRemainingDue):0m;
        if(commercial>0)db.PaymentAllocations.Add(new PaymentAllocation{
            TenantId=tenant,OrderId=orderId,TransferId=transfer.Id,Kind="Commercial",
            Amount=commercial,CreatedById=actor,
            // Commercial auto-allocations have stable internal IDs but are not
            // separately retried or publicly editable.
            IdempotencyKey=Guid.NewGuid(),RequestHash=hash
        });
        PaymentWriteRules.BumpOrder(order,user);
        PaymentWriteRules.Audit(db,order,user,"TransferRecorded",transfer.Id,"",null,
            new{transfer.Amount,transfer.BeneficiaryCompanyId,transfer.ProofDocumentId,commercial});
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Created($"/api/orders/{orderId}/finances",new{
            transfer.Id,transfer.Amount,transfer.BeneficiaryCompanyId,commercial,
            revision=order.Revision});
    }

    private static async Task<IResult> CreateExpense(Guid orderId,CreateExpenseInput input,
        ImportDb db,ClaimsPrincipal user,IWebHostEnvironment env)
    {
        var category=input.Category?.Trim()??"";
        var description=input.Description?.Trim()??"";
        if(!PaymentWriteRules.AmountOk(input.Amount)||
           category is not ("Freight" or "Customs" or "Insurance" or "Other")||
           !PaymentWriteRules.ReasonOk(description)||input.PayeeCompanyId==Guid.Empty||
           !PaymentWriteRules.IdempotencyOk(input.IdempotencyKey))
            return PaymentWriteRules.Error("invalid_order_expense");
        var tenant=CurrentTenant.Id(user);var actor=CurrentTenant.UserId(user);
        var hash=PaymentWriteRules.Hash(new{orderId,input.Amount,input.PayeeCompanyId,
            category,description,input.EvidenceDocumentId});
        await using var transaction=await db.Database.BeginTransactionAsync();
        var order=await PaymentWriteRules.LockOrder(db,tenant,orderId);
        if(order is null)return Results.NotFound();
        var previous=await db.OrderExpenses.AsNoTracking().SingleOrDefaultAsync(x=>
            x.CreatedById==actor&&x.IdempotencyKey==input.IdempotencyKey);
        if(previous is not null)return previous.OrderId==orderId&&previous.RequestHash==hash
            ?Results.Ok(new{previous.Id,previous.Amount,revision=order.Revision,replayed=true})
            :PaymentWriteRules.Conflict("idempotency_key_reused");
        if(PaymentWriteRules.CheckRevision(order,input.Revision) is { } error)return error;
        if(order.Status=="Cancelled")return PaymentWriteRules.Conflict("order_cancelled");
        var payee=await PaymentWriteRules.Beneficiary(db,input.PayeeCompanyId);
        if(payee is null)return PaymentWriteRules.Error("payment_beneficiary_unavailable");
        if(!await PaymentWriteRules.ProofBelongsToOrder(db,orderId,input.EvidenceDocumentId,false,env))
            return PaymentWriteRules.Error("expense_evidence_not_linked_to_order");
        var expense=new OrderExpense{TenantId=tenant,OrderId=orderId,
            PayeeCompanyId=input.PayeeCompanyId,PayeeSnapshot=payee,
            Amount=input.Amount,Category=category,Description=description,
            EvidenceDocumentId=input.EvidenceDocumentId,CreatedById=actor,
            IdempotencyKey=input.IdempotencyKey,RequestHash=hash};
        db.OrderExpenses.Add(expense);
        PaymentWriteRules.BumpOrder(order,user);
        PaymentWriteRules.Audit(db,order,user,"ExpenseRecorded",expense.Id,description,null,
            new{expense.Amount,expense.PayeeCompanyId,expense.EvidenceDocumentId});
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Created($"/api/orders/{orderId}/finances",
            new{expense.Id,expense.Amount,revision=order.Revision});
    }

    private static async Task<IResult> AllocateExpense(Guid orderId,Guid expenseId,
        AllocateExpenseInput input,ImportDb db,ClaimsPrincipal user)
    {
        if(!PaymentWriteRules.AmountOk(input.Amount)||input.TransferId==Guid.Empty||
           !PaymentWriteRules.IdempotencyOk(input.IdempotencyKey))
            return PaymentWriteRules.Error("invalid_payment_allocation");
        var tenant=CurrentTenant.Id(user);var actor=CurrentTenant.UserId(user);
        var hash=PaymentWriteRules.Hash(new{orderId,expenseId,input.TransferId,input.Amount});
        await using var transaction=await db.Database.BeginTransactionAsync();
        var order=await PaymentWriteRules.LockOrder(db,tenant,orderId);
        if(order is null)return Results.NotFound();
        var previous=await db.PaymentAllocations.AsNoTracking().SingleOrDefaultAsync(x=>
            x.CreatedById==actor&&x.IdempotencyKey==input.IdempotencyKey);
        if(previous is not null)return previous.OrderId==orderId&&previous.RequestHash==hash &&
            previous.Kind=="Expense"?Results.Ok(new{previous.Id,previous.Amount,
                revision=order.Revision,replayed=true}):PaymentWriteRules.Conflict("idempotency_key_reused");
        if(PaymentWriteRules.CheckRevision(order,input.Revision) is { } error)return error;
        var expense=await db.OrderExpenses.SingleOrDefaultAsync(x=>x.OrderId==orderId&&x.Id==expenseId);
        var transfer=await db.PaymentTransfers.SingleOrDefaultAsync(x=>x.OrderId==orderId&&x.Id==input.TransferId);
        if(expense is null||transfer is null)return Results.NotFound();
        if(transfer.State!="Active")return PaymentWriteRules.Conflict("transfer_not_active");
        if(expense.PayeeCompanyId!=transfer.BeneficiaryCompanyId)
            return PaymentWriteRules.Conflict("expense_payee_mismatch");
        var snapshot=await PaymentSnapshot.LoadAsync(db,order);
        snapshot.AssertInvariants();
        if(input.Amount>snapshot.TransferAvailable(transfer.Id)||
           input.Amount>expense.Amount-snapshot.ExpenseAllocated(expense.Id))
            return PaymentWriteRules.Conflict("allocation_exceeds_available");
        var allocation=new PaymentAllocation{TenantId=tenant,OrderId=orderId,
            TransferId=transfer.Id,ExpenseId=expense.Id,Kind="Expense",Amount=input.Amount,
            CreatedById=actor,IdempotencyKey=input.IdempotencyKey,RequestHash=hash};
        db.PaymentAllocations.Add(allocation);
        PaymentWriteRules.BumpOrder(order,user);
        PaymentWriteRules.Audit(db,order,user,"ExpenseSettled",allocation.Id,
            "Documented same-order payment and same beneficiary",
            null,new{allocation.Amount,allocation.TransferId,allocation.ExpenseId});
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Created($"/api/orders/{orderId}/finances",
            new{allocation.Id,allocation.Amount,revision=order.Revision});
    }

    private static partial void MapCorrections(RouteGroupBuilder group);
}
