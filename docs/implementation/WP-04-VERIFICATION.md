# WP-04 — Purchase Orders: Implementation and Verification

**Date:** 2026-11-06
**Branch:** feature/import-management-mvp
**Product:** وثيقة / Wathiqa, yarn import management
**Status:** Local draft-order vertical slice implemented and verified. NOT production-ready; no push, commit or VPS deployment.

**Later modules:** WP-06 Logistics and WP-07 private Documents were implemented subsequently. Refer to WP-06-VERIFICATION.md and WP-07-VERIFICATION.md for current progress; the exclusions below describe the original WP-04 slice.

## Implemented capability

The new ASP.NET Core 10 API now stores tenant-owned PurchaseOrder and PurchaseOrderItem records independently of the old Template/Document editor database. Supplier and optional Customer are tenant-scoped foreign keys, with preserved party-name snapshots. The PostgreSQL PurchaseOrdersAndNumbering EF migration was applied only to wathiqa_import_dev.

Purchase-order numbering is PO-YYYY-NNNN. It is generated inside the same transaction as the order using a row-locked PostgreSQL UPSERT counter per TenantId and Year. The order's NumberYear is immutable after creation, even if a draft's date changes.

Each line holds ProductType, Denier, Luster, Grade, ColorType, HS code, QuantityKg, UnitPrice, PriceUnit and LineTotal. Input quantities accept KG and TON, but storage is always KG. Pricing can be per KG or TON. All calculations are server-side decimal arithmetic with two-decimal line rounding AwayFromZero. No frontend-supplied TotalAmount is trusted.

Only Draft creation, reading, updating, listing/filtering and soft deletion exist. Mutations use an optimistic-concurrency Revision. An order cannot reuse another order's item ID, and a tenant cannot link to another tenant's Supplier. Updates and deletion record OrderAudit with actor, timestamps, revisions and before/after snapshots.

**Permission invariant:** TenantMember (including Staff) may READ priced orders. Admin or Staff with CanManagePayments is required for order POST, PUT and DELETE. That approval is enforced by server authorization on every write, independent of the UI. Staff without the permission sees a read-only form and cannot open its create/delete affordances. This follows the user's previously approved Staff price/financial edit policy.

## New API contracts

| Method | Path | Access | Behavior |
|---|---|---|---|
| GET | /api/orders | TenantMember | Paged list; supplier, currency, search, status filters |
| GET | /api/orders/{id} | TenantMember | Own-tenant detail plus lines; cross-tenant returns 404 |
| POST | /api/orders | CanManagePayments | Atomic draft creation, PO numbering, lines and audit |
| PUT | /api/orders/{id} | CanManagePayments | Draft-only update with required Revision |
| DELETE | /api/orders/{id}?revision=N | CanManagePayments | Draft-only soft deletion with required Revision |

No endpoint directly changes actual PaidAmount, PaymentStatus or manually posts a remittance. These are held for WP-05.

## Frontend

The Arabic Next.js import workspace now includes:
- /import/orders — filterable purchase-order list, no summary count cards, per-record actions.
- /import/orders/new — supplier, optional customer, PO date, supplier reference, Incoterm, currency, ports, notes and multiple priced yarn lines.
- /import/orders/[id] — view and edit a draft with server-calculated total and revision.
- Responsive small-screen per-order records instead of crammed table columns; desktop retains a conventional table.
- Arabic toasts, validation feedback, deletion confirmation and read-only UX for Staff without CanManagePayments.

## Verified local evidence

1. API build: PASS, zero errors and warnings.
2. scripts/Test-ImportOrders.mjs: 25/25 PASS against a real PostgreSQL database and live HTTP API. Includes $3,000 mixed KG/TON calculation, rounding 1.005 to 1.01, six concurrent unique consecutive PO numbers, independent tenant counters, cross-tenant reads/writes and supplier FK rejection, invalid quantities, revision conflicts, line hijack rejection, paging and soft-delete.
3. scripts/Test-ImportIsolation.ps1: 31/31 PASS. Ordinary Staff reads order prices, but receives 403 for creating/updating/deleting priced orders; granting CanManagePayments immediately permits access, and revocation immediately restores denial for the existing session. Existing login, CSRF, invitation and tenant-isolation checks remain passing.
4. frontend npm run lint: PASS (TypeScript).
5. Optimized Next.js production build: PASS. A background build wrote exit code 0 into the gitignored local marker .local/import-frontend-build-exit.txt. The log contains generated routes for /import/orders, /import/orders/new and /import/orders/[id].
6. Browser-Orders-Test.mjs: **9/9 PASS with exit code 0** after fixing runner process lifecycle. Repeated successfully after the new Logistics module was integrated. Verified login, $3,000 two-item draft, edit, list, mobile overflow and deletion.
7. Desktop/mobile screenshots at .local/wathiqa-orders-editor-desktop.png and .local/wathiqa-orders-list-mobile.png have been reviewed. The new mobile order-record layout replaced cramped desktop table cells.
8. QA-only fixture cleanup was performed on demo-a: five disposable browser QA draft orders and five QA suppliers were soft-deleted. Subsequent dry-run found zero remaining QA records.
9. Local HTTP health probes returned 200 for both old and new APIs, login, orders, companies and the Next.js proxy after restarting the fresh frontend build.

## Limits and unfinished work

- Financial difference decision P-01-R1 remains: extra remittance must stay on the original Order as an unresolved discrepancy, never a transferable supplier-wide credit.
- P-02 (order closure/cancellation with outstanding money/shipment) and P-03 (audited correction of a confirmed bank transfer) remain open Level 3 decisions. No confirmation/closing/settlement route was invented.
- WP-05 Payments/Expenses/Reconciliation, WP-06 Shipments/Bill of Lading/Containers, WP-07 documents and WP-08 reporting are NOT implemented in this slice.
- POST order creation has no scoped idempotency key yet. A network timeout after a successful create could lead to a duplicate draft if blindly retried. Add idempotent creation before production.
- The old template editor remains unauthenticated on the root route, for local compatibility ONLY. Do not expose the combined app publicly before security and legacy cutover.
- Still requires production HTTPS/proxy hardening, persisted Data Protection keys, off-host backups, CI integration jobs, secure invitation delivery and operational monitoring.

## Reproduce

From D:\Works\PrivateWorks\Hussam:

- Run scripts/Initialize-LocalPostgres.ps1 if the local DB is stopped.
- Run scripts/Start-ImportApi.ps1 and start.ps1.
- Browse to http://localhost:3000/import/login and open /import/orders.
- Run node scripts/Test-ImportOrders.mjs.
- Run powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Test-ImportIsolation.ps1.
- Run frontend npm run lint.
- Stop the web before running scripts/Build-ImportFrontend.ps1, then read the exit marker in .local.
- scripts/Cleanup-ImportOrderQa.mjs is dry-run by default and --apply soft-deletes only Browser Orders QA demo-a fixtures.

No Git commit/push or remote deployment was attempted.
