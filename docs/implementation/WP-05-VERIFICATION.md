# WP-05 — Payment Ledger, Same-Order Reconciliation, P-02/P-03 Order Lifecycle

**Date:** 2026-11-07  
**Branch:** `feature/import-management-mvp`  
**Status:** `LOCALLY VERIFIED MVP SLICE / PRODUCTION RELEASE BLOCKED`. This is a tested application recording system, **not** bank connectivity, independent verification of wire receipt, or a release authorization.  
**Approved authority:** `../architecture/01-DECISIONS.md` (P-01-R1, P-02 option B, P-03 option A), `../architecture/04-ORDER-DISCREPANCY-ACCEPTANCE.md`.

## 1. What changed

### Durable, order-owned Postgres ledger

- **EF migration:** `20261107154919_PaymentsAndOrderClosure`, added to the independent ImportDb after a verified, gitignored `pg_dump -Fc` checkpoint. Applied only to local `wathiqa_import_dev` via `scripts/Apply-ImportMigrations.ps1`; no VPS/legacy editor database was changed.
- **Entities:** `PaymentSchedule`, `PaymentTransfer`, `PaymentAllocation`, `OrderExpense`, `PaymentReturn`, `PaymentAudit`. All records carry `TenantId` + `OrderId`; money rows are tied with tenant-aware composite foreign keys to their exact Order, original transfer and expense. `decimal(18,2)`, positive amount constraints and unique actor-scoped idempotency keys supplement API validation.
- **Financial calculation:** `PaymentSnapshot` derives amount actually settled for goods, amount allocated to documented expenses, net active transfers (gross outgoing less actual bank returns), unallocated discrepancy and goods balance. It enforces:

  `GrossActiveTransferred = AppliedCommercial + AppliedExpenses + UnresolvedDifference`

  with `AppliedCommercial <= CommercialAmount`, `UnresolvedDifference >= 0`, and no expense/transfer over-allocation. It does not sum different currencies. Never turn the excess into supplier credit.
- **Serialized writes:** every financial mutation starts a PostgreSQL transaction and locks the origin Order's row (`FOR UPDATE`) before validating expected Order revision, document/beneficiary ownership, balance and idempotency. The DB commits the ledger rows, audit and incremented Order revision together.
- **Evidence:** a `PaymentProof` document must be linked directly to the same Order before recording/correcting a transfer or recording a bank return. Expenses require a private document linked directly to the same Order. A documented third-party broker expense remains unpaid when the recorded transfer beneficiary is the yarn supplier. Payment-used proof documents cannot be removed/unlinked; the delete paths take the same Order lock to avoid a concurrent delete/transfer race.

### P-03 / option A — approved correction

- For an **incorrect ledger entry**, `POST .../payment-transfers/{transferId}/correct` **voids the old recorded row without deleting it** and atomically inserts a new, linked active replacement with a mandatory reason, actor, timestamp, old/new evidence and audit. Financial totals count active records only.
- If a remittance **really happened** and money was subsequently returned by a bank, `POST .../{transferId}/returns` inserts a **separate bank return event** with own proof/reference/reason; it does not falsify the original remittance.
- A correction is **blocked** if the old transfer has a real bank return or verified expense allocation. Bank returns can currently use only **unallocated portions**; unwinding a payment already applied to goods/expenses is deliberately not implemented until an independently reviewed reversal workflow exists. Never claim the current screen supports arbitrarily reversing settled balances.

### P-02 / option B — approved close/cancel

- A Tenant **Admin** (not Staff, even with `CanManagePayments`) may close a Draft administratively with a mandatory reason. The Order moves to `Closed` with `ClosedWithExceptions=true`, closure metadata and an `OrderAudit` event. Outstanding goods, difference, overdue plans, shipping/customs and missing documents **remain visible**.
- `Cancel` is permitted only for an unissued Draft without schedules/transfers/expenses/shipments/linked documents. It keeps the Order row with status `Cancelled` and audit, rather than deleting financial history. Any Order with actual money or operational records returns 409, requiring separate safe handling.
- Active commercial fields become protected from editing/deletion when financial records exist. Finance operations on administratively closed Orders still work so legitimate outstanding settlements can be recorded later. Cancelled Orders accept no new planned/actual transfer or expense.

## 2. Implemented APIs

All routes are under `/api/orders/{orderId}` and enforce cookie + CSRF for writes:

| Route | Access | Purpose |
|---|---|---|
| `GET /finances` | TenantMember | Truthful derived amounts, schedules, transfers, expenses, bank returns and unresolved discrepancy |
| `GET /payment-audits?page=&pageSize=` | TenantMember | Paginated audit of payments/allocations/corrections/refunds |
| `POST /payment-schedules` | CanManagePayments | Planned due amount; **not** a bank transfer |
| `POST /payment-transfers` | CanManagePayments | Actual remittance entered with same-Order proof, beneficiary and scoped idempotency key |
| `POST /expenses` | CanManagePayments | Same-order cost with documented payee; initially unpaid |
| `POST /expenses/{expenseId}/allocations` | CanManagePayments | Amount supported by the SAME Order's transfer to the SAME payee |
| `POST /payment-transfers/{transferId}/correct` | CanManagePayments | Void erroneous ledger entry + linked active replacement |
| `POST /payment-transfers/{transferId}/returns` | CanManagePayments | Distinct proven bank return from unallocated transfer portion |
| `POST /close` | TenantAdmin | Audited admin exception close retaining financial truth |
| `POST /cancel` | TenantAdmin | Only genuinely empty Draft; 409 if money/logistics/documents exist |

`GET /api/orders` and `GET /api/orders/{id}` now show derived `PaidAmount`, `RemainingAmount`, `PaymentStatus`, `IsPaymentOverdue` (UTC), `UnresolvedDifference` and closure metadata. Server-side `payment=Paid|PartiallyPaid|Unpaid|Outstanding`, `overdue=true|false` and `status=Draft|Closed|Cancelled` filters use **recorded** financial facts. Grouped summaries are separated by currency and computed before pagination. `arrival=Delivered&payment=Outstanding` answers delivered-but-not-fully-paid.

## 3. Arabic Next.js UI

- `/import/orders/{id}` now contains an **actual ledger section**: an aligned money table (not decorative summary-count cards), explicit Arabic warning **«فرق محاسبي غير مسوّى»** showing the Order-only discrepancy, schedules, real transfers, costs, returns and the current paid-goods/remaining goods balance.
- Authorized users may record schedules, proof-linked remittances, expenses, evidence-matched allocations, incorrect-ledger corrections and actual refunds. Admin-only exceptional closing/cancelling show mandatory-reason forms. Staff without `CanManagePayments` see a read-only financial report.
- UI actions use unique idempotency keys that stay stable across transport-error retries of the same form payload. Changing fields resets the logical operation key. Proof picker uses private Order documents from WP-07, not an arbitrary document ID. Missing proof prompts the user to upload it in the existing Documents panel.
- `/import/orders` now offers real payment/overdue/status filters and per-currency paid/remaining amounts, including unresolved warning and Admin-closed status. No fictitious payment is created for a scheduled-only Order.

## 4. Actual local acceptance tests — observed 2026-11-07

| Command/observation | Result |
|---|---|
| `dotnet build backend/Wathiqa.ImportApi/Wathiqa.ImportApi.csproj --no-restore -v quiet` | **PASS: 0 warnings, 0 errors** after finance + evidence locking |
| `scripts/Apply-ImportMigrations.ps1` | **PASS** on dedicated local DB only; additive finance migration applied |
| `node scripts/Test-Payments.mjs` | **91/91 PASS**, authenticated API and real local PostgreSQL: 100k/105k case, 3k expense, 2k return, void/replacement, idempotency replays, overpayments, tenants, closed order, overdue filters, Staff permission grant/revoke, concurrent writers and proof-delete race |
| `node scripts/Browser-Payments-Test.mjs .local/documents-qa-fixtures-WP07_QA_4ba1b2302.json` | **7/7 PASS** with actual Chrome/Edge, from Arabic 5,000 discrepancy to 3,000 same-payee allocation, Admin close with 2,000 still due, distinct 2,000 return and cleared discrepancy; no mobile horizontal page overflow |
| `node scripts/Test-ImportOperations.mjs` | **70/70 PASS** for Orders/Operations/Companies, with financial filters and truthful unpaid/zero booked payments |
| `node scripts/Browser-Operations-Test.mjs <scoped WP07_QA fixture>` | **8/8 PASS** for operational tables, URL filters, missing documents and mobile |
| `node scripts/Browser-Import-Test.mjs` | **15/15 PASS** for Arabic identity, Companies, responsive navigation |
| `node scripts/Test-ImportPublicSurface.mjs` | **12/12 PASS**, old editor API routes still blocked by optimized Next.js Production Proxy |
| `npm.cmd --prefix frontend run lint` and optimized Next.js **16.4.5** build | **PASS** after security upgrade, 2026-11-07. Production route guard regression 12/12; real import browser 15/15 |

Local screenshots are under `.local/wathiqa-wp05-*.png` including the 5,000 and 2,000 warnings, settled ledger and mobile view. `.local` is gitignored. The API tests create *only* tagged `WP07_QA_*` fixtures. `scripts/Cleanup-ImportDocumentsQa.ps1 -Apply` deletes their finance rows in FK-safe order before documents/Orders; inspect dry-run first, never target real merchant data.

## 5. Important limitations / release blockers

1. **No bank connectivity or payment confirmation service.** «Actual transfer» means a user recorded a transfer and uploaded same-Order proof, NOT that Wathiqa independently validated a bank statement or verified its beneficiary with a bank. This is an internal bookkeeping MVP, not a payments processor.
2. **No general reversal of already allocated funds**; a 2k actual refund of *unallocated discrepancy* works, but a return of already-settled goods/expenses needs a separate accounting adjustment engine and approval before implementation. Correction after expense allocation/return is deliberately blocked.
3. **No explicit PaymentSchedule-to-Transfer distribution UI.** Due coverage is calculated oldest-due-first (FIFO) from commercial allocations, and overdue is based on **UTC calendar day**. This supports initial reporting but cannot represent a merchant-chosen non-FIFO settlement of individual due plans. Implement per-schedule allocation before claiming arbitrary schedule accounting.
4. **Financial edits and material evidence are operationally protected**, but high-volume performance, external merchant approval, cross-browser manual UX, isolated full backup/restore of new finance records, and adversarial fuzz/load tests remain open. There is currently no independent reconciliation with bank provider references, import statements, anti-fraud checks or accounting-system export.
5. **Currency:** all allocations stay in `Order.Currency`. No multi-currency FX, conversions, creditor-wallet or cross-Order credit. Live report indices are present, but traffic/load tuning is not yet proven.
6. **VPS/Production remains blocked** under WP-09: real updated ClamAV, isolated legacy API, HTTPS/proxy, secrets/cookie key PFX recovery, encrypted off-host restic backup plus restore in independent staging, persistent document volumes and deployment-level tenancy tests. Do not mark an application production-ready on the basis of local tests.

**Disposition:** WP-05 approved core accounting rules implemented and locally verified, WP-08 financial reports integrated and exercised, P-02/P-03 accepted and reflected in code. Post-upgrade 91/91 financial API, 7/7 browser, 70/70 operations and 8/8 operations browser regression passed. Local DB/finance/8-blob restore passed. Production remains BLOCKED on actual Docker/Dokploy image start, real AV signatures, trusted HTTPS, encrypted off-host recovery, merchant acceptance and safe release commit. No Git push, main merge, external deployment or real-client migration performed.
