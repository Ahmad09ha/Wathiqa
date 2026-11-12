using Microsoft.EntityFrameworkCore;

namespace Wathiqa.ImportApi;

// Single read model for details, schedules and financial reporting. Values
// derive from durable money events, NEVER from a client-provided status.
public sealed class PaymentSnapshot
{
    public required PurchaseOrder Order { get; init; }
    public required List<PaymentSchedule> Schedules { get; init; }
    public required List<PaymentTransfer> Transfers { get; init; }
    public required List<PaymentAllocation> Allocations { get; init; }
    public required List<OrderExpense> Expenses { get; init; }
    public required List<PaymentReturn> Returns { get; init; }

    public static async Task<PaymentSnapshot> LoadAsync(ImportDb db, PurchaseOrder order)
    {
        var id=order.Id;
        return new PaymentSnapshot {
            Order=order,
            Schedules=await db.PaymentSchedules.AsNoTracking().Where(x=>x.OrderId==id)
                .OrderBy(x=>x.DueDate).ThenBy(x=>x.CreatedAtUtc).ThenBy(x=>x.Id).ToListAsync(),
            Transfers=await db.PaymentTransfers.AsNoTracking().Where(x=>x.OrderId==id)
                .OrderBy(x=>x.CreatedAtUtc).ThenBy(x=>x.Id).ToListAsync(),
            Allocations=await db.PaymentAllocations.AsNoTracking().Where(x=>x.OrderId==id).ToListAsync(),
            Expenses=await db.OrderExpenses.AsNoTracking().Where(x=>x.OrderId==id)
                .OrderBy(x=>x.CreatedAtUtc).ThenBy(x=>x.Id).ToListAsync(),
            Returns=await db.PaymentReturns.AsNoTracking().Where(x=>x.OrderId==id)
                .OrderBy(x=>x.CreatedAtUtc).ThenBy(x=>x.Id).ToListAsync()
        };
    }

    private List<PaymentTransfer> Active => Transfers.Where(x=>x.State=="Active").ToList();
    public decimal GrossOutgoing => Active.Sum(x=>x.Amount);
    public decimal Returned => Returns.Where(x=>Transfers.Any(t=>t.Id==x.TransferId && t.State=="Active"))
        .Sum(x=>x.Amount);
    public decimal GrossActiveTransferred => GrossOutgoing-Returned;
    public decimal AppliedCommercial => Allocations.Where(x=>x.Kind=="Commercial"&&
        Transfers.Any(t=>t.Id==x.TransferId&&t.State=="Active")).Sum(x=>x.Amount);
    public decimal AppliedExpenses => Allocations.Where(x=>x.Kind=="Expense"&&
        Transfers.Any(t=>t.Id==x.TransferId&&t.State=="Active")).Sum(x=>x.Amount);
    public decimal RecordedOrderExpenses => Expenses.Sum(x=>x.Amount);
    public decimal CommercialRemainingDue => Math.Max(0,Order.TotalAmount-AppliedCommercial);
    public decimal UnresolvedDifference => GrossActiveTransferred-AppliedCommercial-AppliedExpenses;
    public string PaymentStatus => AppliedCommercial<=0?"Unpaid":
        CommercialRemainingDue>0?"PartiallyPaid":"Paid";

    public decimal TransferReturned(Guid transfer) => Returns.Where(x=>x.TransferId==transfer).Sum(x=>x.Amount);
    public decimal TransferAllocated(Guid transfer) => Allocations.Where(x=>x.TransferId==transfer).Sum(x=>x.Amount);
    public decimal TransferAvailable(Guid transfer)
    {
        var item=Transfers.Single(x=>x.Id==transfer);
        return item.Amount-TransferReturned(transfer)-TransferAllocated(transfer);
    }
    public decimal ExpenseAllocated(Guid expense) => Allocations.Where(x=>x.ExpenseId==expense&&
        Transfers.Any(t=>t.Id==x.TransferId&&t.State=="Active")).Sum(x=>x.Amount);

    public (decimal Covered, decimal Uncovered, bool Overdue) ScheduleBalance(PaymentSchedule schedule, DateOnly today)
    {
        var paid=AppliedCommercial;
        foreach(var candidate in Schedules)
        {
            var portion=Math.Min(Math.Max(0,paid),candidate.Amount);
            if(candidate.Id==schedule.Id)
                return(portion,schedule.Amount-portion,schedule.DueDate<today && portion<schedule.Amount);
            paid=Math.Max(0,paid-portion);
        }
        throw new InvalidOperationException("Payment schedule does not belong to the snapshot.");
    }
    public bool Overdue(DateOnly today)=>Schedules.Any(x=>ScheduleBalance(x,today).Overdue);

    public void AssertInvariants()
    {
        if(GrossActiveTransferred<0 || AppliedCommercial<0 || AppliedExpenses<0 ||
           AppliedCommercial>Order.TotalAmount || UnresolvedDifference<0 ||
           Schedules.Sum(x=>x.Amount)>Order.TotalAmount)
            throw new InvalidOperationException("Financial conservation violated for a single Order.");
        foreach(var transfer in Transfers)
        {
            if(TransferReturned(transfer.Id)<0 || TransferAvailable(transfer.Id)<0)
                throw new InvalidOperationException("A transfer was over-allocated or over-returned.");
            if(transfer.State=="Voided" && TransferReturned(transfer.Id)>0)
                throw new InvalidOperationException("A voided transfer has a bank return.");
            if(transfer.BeneficiaryCompanyId!=Order.SupplierId &&
                Allocations.Any(a=>a.TransferId==transfer.Id && a.Kind=="Commercial"))
                throw new InvalidOperationException("Third-party payment cannot settle supplier goods.");
        }
        foreach(var expense in Expenses)
            if(ExpenseAllocated(expense.Id)>expense.Amount)
                throw new InvalidOperationException("Expense settlement exceeds documented expense.");
    }

    public object Detail(DateOnly today)
    {
        AssertInvariants();
        return new {
            OrderId=Order.Id,Order.Number,Order.Currency,CommercialAmount=Order.TotalAmount,
            Order.Status,Order.Revision,Order.ClosedWithExceptions,Order.ClosureReason,Order.ClosedAtUtc,
            GrossOutgoing,ActualReturns=Returned,GrossActiveTransferred,
            AppliedCommercial,RecordedOrderExpenses,AppliedExpenses,UnresolvedDifference,
            CommercialRemainingDue,PaymentStatus,IsPaymentOverdue=Overdue(today),
            AsOfUtcDate=today,
            Schedules=Schedules.Select(s=>{
                var state=ScheduleBalance(s,today);
                return (object)new {s.Id,s.Kind,s.Amount,s.DueDate,s.Notes,
                    Covered=state.Covered,Remaining=state.Uncovered,IsOverdue=state.Overdue};
            }).ToArray(),
            Transfers=Transfers.Select(t=>new{t.Id,t.Amount,t.BeneficiaryCompanyId,
                t.BeneficiarySnapshot,t.TransferDate,t.Method,t.Reference,
                t.BankOrExchangeName,t.ProofDocumentId,
                t.State,t.ReplacesTransferId,t.VoidReason,t.VoidedAtUtc,t.CreatedAtUtc,
                Returned=TransferReturned(t.Id),
                CommercialApplied=Allocations.Where(x=>x.TransferId==t.Id && x.Kind=="Commercial").Sum(x=>x.Amount),
                ExpenseApplied=Allocations.Where(x=>x.TransferId==t.Id && x.Kind=="Expense").Sum(x=>x.Amount),
                Available= t.State=="Active"?TransferAvailable(t.Id):0m
            }).ToArray(),
            Expenses=Expenses.Select(e=>new{e.Id,e.Amount,e.Category,e.Description,e.PayeeCompanyId,
                e.PayeeSnapshot,e.EvidenceDocumentId,e.CreatedAtUtc,
                Applied=ExpenseAllocated(e.Id),Remaining=e.Amount-ExpenseAllocated(e.Id)}).ToArray(),
            Returns=Returns.Select(r=>new{r.Id,r.TransferId,r.Amount,r.ReturnDate,
                r.BankReference,r.Reason,r.ProofDocumentId,r.CreatedAtUtc}).ToArray()
        };
    }
}
