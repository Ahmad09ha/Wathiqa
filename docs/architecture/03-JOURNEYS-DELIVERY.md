# وثيقة — Journeys, Requirements & Delivery Plan (TARGET)

**Status:** Identity/Companies/Orders/Logistics/Private Documents, WP-05 finance and WP-08 reports implemented and verified **locally**. P-02/B and P-03/A approved; VPS/staging release and WP-10 merchant acceptance remain blocked.  
**Sources:** `Wathiqa-MVP-Plan.md` + `01-DECISIONS.md` + `02-MVP-BLUEPRINT.md`.  
**As-is:** The legacy document editor source/database are preserved but blocked behind Production Next.js import-only paths. The new API implements tenant-authenticated J-01..J-13 and J-15..J-17 as tested local slices, including user-recorded transfer ledger, refunds, correction and Admin closure with visible financial exceptions. Actual bank verification is not implemented. Local backup/restore is verified, independent encrypted off-host VPS recovery and WP-10 acceptance remain open.

## User journeys and acceptance tests

| Journey | Actor / goal | Critical outcome | Negative/retry variant |
|---|---|---|---|
| J-01 Onboarding | Trusted operator creates Tenant and first Admin; Admin invites Staff | No public tenant creation, invite expires and cannot be reused | Invalid invite, cross-tenant email identity, role escalation |
| J-02 Authentication | User signs in/out and visits Arabic workspace | Session tied to single Tenant, all business routes protected | Bad password, expired session, CSRF, permission revoked |
| J-03 Company CRUD | Staff creates supplier, broker, shipping line | Company visible only in same tenant | Tenant B requests A's Company by ID -> 404 |
| J-04 Create PO | Staff enters order, 2 order lines incl. TON pricing | Unique PO number, correct quantities and totals in one transaction | Two users create simultaneously; malformed quantity; supplier outside tenant |
| J-05 Planned payment | Admin or Staff+permission adds advance and balance with due dates | Due amounts visible; no money counted as paid yet | Staff lacking permission POST -> 403 |
| J-06 Transfer split | Staff+permission records two transfers of 30k and 50k against an 80k balance | Remaining and PaidAmount correct; proof attached; immutable audit | Double-submit same idempotency key; accidental cross-order schedule allocation |
| J-07 Overdue | Staff opens overdue list day after due date | Overdue true if outstanding scheduled amount past due, regardless of prior write | Midnight without new write; partially allocated schedule |
| J-08 Shipment split | Staff creates one PO with two B/L, each with separate containers | Every B/L belongs to exactly one PO | Try linking a B/L to another PO, or reparenting after financial/shipping facts |
| J-09 Container progress | Staff moves 1/3 to Delivered | Order displays DeliveredCount 1/3, partial arrival | Concurrent changes; invalid/duplicate container number warning |
| J-10 Upload B/L | Staff uploads one file linked to B/L and two containers | Blob stored once, multiple scoped links and preview/download | Executable masquerading as PDF, oversized file, tenant B ID probe |
| J-11 Customs | Staff updates broker, declaration and release state per Shipment | Multiple B/L retain separate statuses and document lists | Staff attempts linking broker from another Tenant |
| J-12 Missing docs | Tenant Admin sets a required PackingList for Shipment; Staff attaches it | Missing becomes satisfied; explicit waiver distinct | Replaced/soft-deleted document makes requirement missing again |
| J-13 Filters | Staff filters "delivered but unpaid" and "at sea" | Server paging, URL filters, per-currency summaries | Currency-mixed totals refused; 10 orders with varied combinations |
| J-14 Restore | Operator restores DB, private files and session-key data from backup | Critical records and file previews recovered consistently | Missing blob, expired keys, incomplete backup detected |
| J-15 Historical correction | Authorized actor corrects settled payment | Audit preserves original and correction, totals recompute | No permission, duplicate correction, transaction failed halfway |
| J-16 Payment discrepancy | Admin or Staff+CanManagePayments records 105,000 USD for a 100,000 USD order | Actual 105k preserved; commercial settlement 100k; unresolved discrepancy 5k on original order only; due 0; warning visible | Retry cannot duplicate a transfer; cross-order/tenant allocations rejected |
| J-17 Reconcile order variance | Authorized finance user corrects mistaken transfer entry or proves expense paid from remittance for same order | Audited correction or same-order expense allocation reduces discrepancy; commercial order amount unchanged | Freight expense due to different payee cannot automatically consume remittance sent to supplier |

## Business invariants

- **I-01 tenant:** no user can read/write/link a row or blob belonging to a different tenant; tenant comes from authenticated identity, never request body.
- **I-02 billing:** each recorded transfer has one owning Order and one currency; no accidental cross-currency sum. Amounts stay `decimal`, not floating point.
- **I-03 planning:** payment plans don't count as PaidAmount. Only active transfers do; allocations may not exceed their own transaction or linked schedule.
- **I-04 roles:** Staff can read financial data; cannot change financial records unless `CanManagePayments` policy succeeds at API.
- **I-05 refs:** shipment has one Order, container has one Shipment, clearance has one Shipment. FK and tenant consistency must hold.
- **I-06 order totals:** server derives line totals and aggregates, not client-submitted totals; status fields are read-only in public APIs.
- **I-07 time:** overdue is based on due date **and unpaid allocation** at current tenant day, not stale cached state.
- **I-08 docs:** one blob can have multiple legal links; target rows and file must share Tenant; private storage key never exposed.
- **I-09 audit:** every money transaction insertion, correction or void has traceable actor/time/old-new change; historical audit entries are append-only.
- **I-10 missing docs:** "missing" only if requirement exists, applies at the present stage, has no valid matching link, and has no approved waiver.
- **I-11 safety:** revoked user/permission takes effect server-side; session is not a permanently trusted role cache.
- **I-12 migration:** old user-provided templates/documents are neither deleted nor inferred into new commercial entities.
- **I-13 discrepancy (P-01-R1):** gross remittance = applied commercial settlement + verified same-order expense settlement + unresolved difference. Every allocation shares TenantId, OrderId, and currency with its originating payment; no supplier-wide transferable credit exists.
- **I-14 expense evidence:** OrderExpense belongs to exactly one order and does not change its original commercial item totals. An expense is not marked paid simply because it was entered: the payment beneficiary and settlement evidence must support an allocation.

## Traceability to acceptance targets (the five original business questions)

| MVP question | Journeys | Architecture | Evidence required |
|---|---|---|---|
| Remaining money per supplier/currency | J-04,J-05,J-06,J-07,J-13 | Orders, Schedules, Transactions, Allocations, SQL grouped summaries | 5 real POs + manual reconciliation per currency |
| Delivered but not fully paid | J-06,J-08,J-09,J-13 | Derived Payment/Arrival statuses, filters | Correct filter with 1/3 Delivered, unpaid balances |
| Which containers are at sea | J-08,J-09,J-13 | Container state, parent shipments, tenant filter | Compare list to known containers |
| B/L and missing documents | J-10,J-12 | Document registry + links + requirements | One B/L linked to two containers, missing list updates after upload |
| Customs progress per shipment | J-08,J-11 | Shipment + 0..1 CustomsClearance | Two B/L at different clearance stages |

## Work packages (implemented slices and remaining plan)

| WP | Objective | Dependencies | Ready/done criteria |
|---|---|---|---|
| WP-00 | Archive old editor, branch isolation, plan safe migration; assess .NET 10 transition | decisions L3-01 | Old template DB backed up; fresh target dev DB created; builds pass |
| WP-01 | ASP.NET Identity, Tenant isolation, Admin/Staff, CanManagePayments, session/CSRF | WP-00,L3-02,FIN | Tenant A/B tests fail closed; Staff financial GET succeeds, POST denied |
| WP-02 | EF Migrations, BaseEntity, tenant-aware FKs, audit/numbering foundations | WP-01 | Fresh DB migrate + upgrade migrate without losing records; no EnsureCreated |
| WP-03 | Companies CRUD and role-aware screens | WP-02 | Own-tenant CRUD pass; cross-tenant FK rejected |
| WP-04 | Orders + Items + numbering + initial list | WP-03 | PO computed totals, TON conversion, two concurrent PO numbers distinct |
| WP-05 | Payment schedules, transfers, same-order expenses and discrepancy reconciliation | WP-04, P-01-R1, P-02/B and P-03/A **approved** | Locally verified 91/91 API and 7/7 browser, production validation pending |
| WP-06 | Shipments, Containers, arrival calculator, customs records | WP-04 | B/L->single PO enforced, 1/3 delivered, mixed customs states visible |
| WP-07 | Private document store, links, PDF preview, checklist/waiver | WP-06 | B/L file linked to two containers, another tenant cannot retrieve |
| WP-08 | Filters and dashboard per currency, document gaps, shipment state | WP-05,06,07 | Five business questions answered against seeded realistic dataset |
| WP-09 | End-to-end security, backup/restore, VPS release readiness | WP-01..08; order-close policy P-02 before closure | No high-risk isolation gaps, HTTPS, CSRF, persistent volumes, restore rehearsal |
| WP-10 | Pilot five real orders + merchant acceptance | WP-09 | Questions answered without Excel, no hidden blocker or critical defect |

### Vertical sequencing
- WP-05 and WP-06 can progress independently after WP-04.
- Start with a single deployable modular monolith; do not introduce Kafka, RabbitMQ, distributed workers or generic workflow engines for this MVP.
- Automated tests start alongside each WP, not postponed to WP-09. WP-09 is the final integrated security, restore and production-hardening gate.

## Required test architecture (design only)

- Unit: line pricing (kg/ton), PaymentStatus, overdue boundary, allocation cap, 105k/100k same-order discrepancy, verified expense allocation, arrival counts, clearance roll-up, container check digit, missing-document rule.
- Integration with PostgreSQL: tenant filters, composite FKs, query-filter bypass probes, concurrent PO numbering, transfer idempotency/rollback, discrepancy conservation equation, rejection of cross-order allocations, expense-payee evidence, migrations, soft-delete history.
- Auth/security: unauthorized => 401, permission denied => 403, cross-tenant lookups => non-revealing 404; invitation replay/expiry and CSRF attempts.
- Document: magic bytes, size, storage path traversal, 2+ links to one blob, owner checks, failed uploads, corrupted/missing blob recovery.
- UI/browser: Arabic login/invite, access control for financial actions, error toasts, create PO lines, record payments, attach B/L, container state, filters/URL back button.
- Operational: restart with persistent files/Data Protection keys, verify database backup + blob backup and full restore in isolated environment.
- Real-business acceptance: minimum five POs, one partial shipment, one multi-container shipment, one staged transfer, one overdue plan, one customs split.

## Decision horizon / blockers

- **Ready to implement without more Level 3 decisions:** WP-00 (non-destructive branch/backup plan), WP-01 (Auth+Tenant), WP-02 (migrations), WP-03 (companies), WP-04 (initial orders with draft/confirmed lifecycle constraints).
- **P-01-R1 approved:** excess payment stays as a discrepancy on the original Order until audited correction or documented same-order expense settlement; supplier credit transfers and P-01A are cancelled. **Needs workshop before affected implementation:** P-03 exact financial correction mechanics and P-02 closure/cancellation semantics.
- These open decisions must not be silently resolved by the architect in an implementation PR.

## Visibility review (as of 2026-11-06)

- **Derived:** Modular monolith boundaries, tenant-aware FKs, idempotency, no stale overdue flag, requirement waivers and reconciliation workflow.
- **Reused:** Arabic layout/RTL, brand, toast, Lenis, scoped API/EF/PostgreSQL, local dev scripts and testing approach.
- **Preserved:** Current `main` code/data, existing `Template/Document` until verified archival/retirement.
- **Deferred:** AI PDF extraction, OCR, Landed Cost, notifications, cross-currency payments and saved views.
- **Verified local slices:** Identity login, CSRF, two-tenant isolation, Staff invitation/revocation, Companies CRUD and Arabic workspace (WP-00-WP-01-VERIFICATION.md). WP-04 draft Orders/Items and tenant pricing/numbering (25 API checks), WP-06 B/L/Containers/Customs (42 API and 11 browser checks), and WP-07 private Document upload/links, secured PDF preview and Admin-defined requirements/waivers are implemented and locally verified (see WP-07-VERIFICATION.md). Staff policy grants/revocations are server-checked. Actual payments, public release, off-host backups/restore and order closure remain unimplemented.
