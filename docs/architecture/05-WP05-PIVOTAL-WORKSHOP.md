# Wathiqa — WP-05 / WP-09 Financial Decision Workshop (P-02 + P-03)

**Prepared:** 2026-11-07  
**Decision status:** `APPROVED 2026-11-07` — user explicitly accepted both recommendations after the workshop.  
**Authority:** `01-DECISIONS.md` P-01-R1 (approved), L3-04/L3-05 (approved); `04-ORDER-DISCREPANCY-ACCEPTANCE.md`; original source plan. This workshop does not change signed-off financial semantics or implement any payment feature.

## Non-negotiable previously approved invariants

- Every PaymentSchedule (planned due) is distinct from a real PaymentTransaction (bank/remittance event). An expected due date is not proof that money was sent.
- Staff can see financial data, but only Tenant Admin or `Staff + CanManagePayments` may record/change financial entries; all writes require tenant-scoped audit.
- Transfers, expenses and allocations are permanently owned by **one Order and Tenant**; multiple orders can never share a remittance balance.
- Example: `Order O-1 Total=100,000 USD`, `Actual remittance=105,000 USD`. Initially `CommercialSettled=100,000 USD`, `UnresolvedDifference=5,000 USD`, `RemainingCommercialDue=0`. The additional 5,000 remains visibly and exclusively attached to **O-1**, not a supplier-wide credit nor payment on O-2. An actual expense on O-1 consumes the difference only with evidence of the correct beneficiary/payment or a legally documented settlement.
- No record may disappear silently. Financial status and overdue state derive from actual facts, not a manually adjustable status field.

## P-03 — How do we correct an already recorded/confirmed transfer?

**Scenario:** An authorized user entered a wire of 105,000 but the bank statement actually shows 100,000. Another scenario: the bank really sent 105,000 and later refunded 5,000. These are **different financial events** and cannot be treated as the same edit.

### Option A — Void incorrect record + new corrected record (RECOMMENDED)

For a clerical error: mark the original *application-record* as voided with mandatory reason, actor, timestamp and link to a newly entered replacement. Original evidence and amount survive in the immutable history, but only active/valid records affect current totals. Apply idempotency/concurrency protections; do not allow cross-order swaps. For a **real bank refund/reversal**, record a distinct linked reversal/return event; voiding the historical entry alone would incorrectly deny that money moved.

**Strength:** Auditability and easier reconciliation/incident investigation; no stealth edits to past facts. **Cost:** Additional user steps, replacement/reversal state machine, clearer UI explanations and more tests. Bank evidence should still be verified before accepting a reversal, and historical financial reports must label voided entries.

### Option B — Edit the confirmed row in place + before/after audit

Allow an authorized user to update amount/reference with mandatory reason and append an audit record containing original and new values.

**Strength:** Faster operational editing and simpler frontend. **Cost:** Harder to prove the original historical truth, tricky retries/concurrency, audit reconstruction and bank matching. A mere field edit is still insufficient to represent a real refund. **Not recommended** for financial history.

**Decision:** `P-03 = A (void + linked replacement; real bank refund as distinct event)`, approved 2026-11-07. Option B is rejected.

## P-02 — Can an Order be closed while money/shipment/customs remain outstanding?

**Scenario:** A 100,000 USD PO has 20,000 unpaid, one of two containers is still at sea, and a required B/L document is missing.

### Option A — Strict closure block

Reject `Close` until unpaid obligations are resolved, all required/waived documents are in order, and the shipment/customs business criteria are satisfied.

**Strength:** Clear operational safety and clean states. **Cost:** Long-running or disputed orders may become impossible to close administratively; teams can need a separate exception/process anyway.

### Option B — Admin-only documented exception (RECOMMENDED)

Allow a tenant Admin to close administratively with an explicit exception reason and audit, **without** making outstanding payment, shipment, customs, document gaps or the same-order discrepancy disappear. The UI and reports must explicitly label the order `Closed with outstanding exceptions` (not financially settled); operational financial and overdue filters continue to include its unresolved obligations when applicable. Non-Admin cannot bypass the normal closure prerequisites. Cancellation also must not erase real bank transactions: ordinary cancellation is limited to safe draft/no-bank-fact cases; cancellation after remittance requires an approved financial settlement/compensation procedure and separate audited authority.

**Strength:** Practical for real disputes and supplier delays while keeping financial truth visible. **Cost:** More sophisticated UI/status rules, explicit operational exception register, careful report semantics and acceptance tests so that closing never conceals liabilities.

**Decision:** `P-02 = B (Admin-only documented exception with permanently visible unsettled facts)`, approved 2026-11-07. Cancellation cannot erase actual remittances and requires a separate audited money disposition when bank facts exist. Option A is rejected as the only policy.

## Consequence / delivery gate

Both choices are now authorized for controlled WP-05 implementation. Follow schema -> API -> real PostgreSQL integration/security/concurrency tests -> Arabic frontend -> end-to-end journey verification. `01-DECISIONS.md` is authoritative. Financial implementation and production readiness remain **unverified** until tests prove otherwise. No VPS release until WP-09 gates are independently satisfied.
