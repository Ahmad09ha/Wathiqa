# WP-05 / P-01-R1 — Order-only payment discrepancy: acceptance contract

**Status:** Target behavior, not implemented. **Approved by product owner:** 2026-11-06.  
**Supersedes:** prior P-01 supplier-credit model and former P-01A credit-transfer question.  
**Depends on:** Auth/Tenant and `CanManagePayments`, Orders/OrderItems, PaymentSchedule, PaymentTransaction, OrderExpense, OrderPaymentReconciliation, audit.

## What this feature is for

A trader must see a payment mismatch on **the same purchase order** where it occurred. This is a reconciliation flag, **not an available supplier credit** and not permission to transfer funds to another purchase order.

### Displayed amounts (per Order and currency)

| Field | Meaning |
|---|---|
| `CommercialAmount` | Original goods value derived from order items |
| `GrossActiveTransferred` | Total verified active remittances recorded for this order |
| `AppliedCommercial` | Amount of those remittances actually allocated to goods settlement |
| `RecordedOrderExpenses` | Approved additional costs recorded on this order, whether paid or unpaid |
| `AppliedExpenses` | Portion of verified actual payment properly allocated to approved same-order expenses |
| `UnresolvedDifference` | Gross active remittances - AppliedCommercial - AppliedExpenses; must be >= 0 |
| `CommercialRemainingDue` | max(0, CommercialAmount - AppliedCommercial) |

**Invariant:** `GrossActiveTransferred = AppliedCommercial + AppliedExpenses + UnresolvedDifference` for a single `TenantId + OrderId + Currency`. Allocations must be unique and nonnegative. An expense can be recorded even when not yet paid; it is **not** subtracted from the discrepancy until a valid payment allocation is supported by payee/evidence.

## Acceptance scenarios

### Scenario A — initial discrepancy

- Given a goods order for **100,000 USD** and recorded bank remittance of **105,000 USD** to the supplier
- When the payment is recorded with bank proof
- Then `AppliedCommercial=100,000`, `CommercialRemainingDue=0`, `UnresolvedDifference=5,000`
- And the order shows an Arabic warning: **"فرق محاسبي غير مسوّى: 5,000 USD"**
- And no balance is made available to another Order or to a supplier-wide wallet.

### Scenario B — entry error correction

- Given Scenario A, but the entered payment amount 105,000 is wrong and the **actual** bank proof shows only 100,000
- When an authorized user completes a reasoned, auditable correction
- Then the corrected active gross payment is 100,000 and `UnresolvedDifference=0`
- And the previous entered value, actor, timestamp, reason and related evidence remain in audit.
- **Important:** If the bank really sent 105,000, a user must not simply change the recorded value to hide 5,000; the real extra money remains unaccounted until legitimate settlement.

### Scenario C — supported cost on this purchase order

- Given Scenario A and a genuine **5,000 USD additional expense** belonging to the **same order**
- When the expense has the required document and the payment beneficiary/settlement evidence proves that the corresponding remittance paid this expense
- Then `RecordedOrderExpenses=5,000`, `AppliedExpenses=5,000`, `UnresolvedDifference=0`
- And `CommercialAmount` stays 100,000 while a separate cost view may show total order costs of 105,000.

### Scenario D — unrelated payee is **not** automatically settled

- Given Scenario A and a new **5,000 USD customs/freight expense** owed to a third-party broker
- But the extra **5,000 USD bank transfer went to the yarn supplier**, not the broker
- When the user records the expense without evidence of a legitimate intermediary settlement
- Then the new expense remains **unpaid** and the `UnresolvedDifference` stays **5,000**
- And the UI explains that entering an expense does not prove its payment.

### Scenario E — partial reconciliation

- Given Scenario A, with **3,000 USD** valid same-order expense settlement
- Then `UnresolvedDifference=2,000`, with no missing original transfer and no double count.

### Scenario F — permissions and isolation

- `Admin` may record payment, expense allocation, correction according to policy.
- `Staff + CanManagePayments` may record/reconcile; ordinary `Staff` may **view** all amounts but write actions return **403**.
- Any read/write/link attempt using another `TenantId` or **different `OrderId`** is rejected, even when the supplier is the same.
- A valid foreign UUID must not reveal another tenant's record; return a non-disclosing 404 for lookup.

### Scenario G — retries and concurrency

- Repeating the same transfer submission with the same scoped idempotency key returns the original result, not another transfer/discrepancy.
- Concurrent allocations and changes cannot exceed original transaction or expense amount; a revision conflict is detected and reported.

## UI affordances (target)

In Order financial detail, show: goods value, actual remittances, goods settled, recorded expenses, expenses proven paid, difference pending review, and commercial balance. Keep the unresolved difference visible in an accessible warning until resolved. Include **"مراجعة الفرق"** to open the reconciliation workflow. Allow an authorized user to record an actual correction with reason or attach a documented order expense and allocate payment if evidence matches.

Do not label the discrepancy `Credit`, `SupplierCredit`, `Available Balance` or hide it after merely entering an expense.

## Engineering verification (not yet executed)

- Unit: all scenarios above, zero/negative amounts, precision by currency, payment schedule partial allocation.
- DB integration: same-order composite FK enforcement, tenant isolation, expense/transfer payee validation, idempotency, atomic transaction and conflict tests, immutable audit.
- Browser: Arabic warning text, number formatting, correction flow, lack of cross-order transfer UI, Staff read-only behavior.
- Financial reporting: `GrossActiveTransferred` and goods settlement separately, no aggregation of distinct currencies.

**Still open Level 3:** P-03 defines exactly whether an already confirmed bank payment is corrected through an immutable void-and-replace operation or a restricted versioned correction. P-02 controls order closure/cancellation with unresolved differences. This contract must not silently choose either rule.
