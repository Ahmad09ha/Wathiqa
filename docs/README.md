# Wathiqa Import Management — Design & Implementation

Status: **WP-00 through WP-08 import-management MVP locally verified. PA-01 separate `SuperAdmin` platform console and PA-02 no-payment manual subscriptions are implemented and locally verified: 76 platform API / 16 platform browser / 18 public-route tests. Merchant operations regression and 15 merchant browser journeys passed. Local independent DB/blob/key restore validated manual plan/subscription rows. The owner explicitly prohibited any subscription payment, invoice, price or billing system; it is not planned. Docker/VPS/real ClamAV/off-host restore, MFA/recovery and WP-10 real merchant acceptance remain NOT verified; PRODUCTION RELEASE BLOCKED.** (2026-11-07)

This documentation captures the change from the old editable-document-template business to the new yarn-import operations business.

## Source order and files

1. **Approved user decisions** — [01-DECISIONS.md](architecture/01-DECISIONS.md): the signed-off Level 3 directions and explicit still-open product policies.
2. **Target architecture** — [02-MVP-BLUEPRINT.md](architecture/02-MVP-BLUEPRINT.md): components, data ownership, API, security, payments, documents, failure cases.
3. **Journeys and staged plan** — [03-JOURNEYS-DELIVERY.md](architecture/03-JOURNEYS-DELIVERY.md): invariants, verification criteria, work packages and dependency order.
4. **Order discrepancy acceptance contract** — [04-ORDER-DISCREPANCY-ACCEPTANCE.md](architecture/04-ORDER-DISCREPANCY-ACCEPTANCE.md): 100k/105k example, same-order-only reconciliation, expense evidence, security and negative cases.
5. **Source business plan** — [Wathiqa-MVP-Plan.md](source/Wathiqa-MVP-Plan.md): extracted text of Hussam's supplied Markdown plan as a baseline reference; later user decisions explicitly override conflicting proposals.
6. **Current verified implementation** — [WP-00-WP-01-VERIFICATION.md](implementation/WP-00-WP-01-VERIFICATION.md): code, runtime, local test evidence, limitations and next gate.
7. **WP-04 Purchase Orders implementation** — [WP-04-VERIFICATION.md](implementation/WP-04-VERIFICATION.md): actual models, authorization, KG/TON pricing, numbering, local evidence and remaining production gaps.
8. **WP-06 Logistics implementation** — [WP-06-VERIFICATION.md](implementation/WP-06-VERIFICATION.md): B/L per Order, containers, ISO 6346 validation, mixed customs, tenant security, tests and limits.
9. **WP-07 Private Documents implementation** — [WP-07-VERIFICATION.md](implementation/WP-07-VERIFICATION.md): private upload/download, one blob/many legal links, tenant access, PDF preview, Admin requirements/waivers and production security blockers.
10. **Trial/Unlimited account seed** — [ACCESS-SEED-ACCOUNTS.md](implementation/ACCESS-SEED-ACCOUNTS.md): two independent tenant Admin accounts, durable UTC entitlement expiry, secure password provisioning, local acceptance tests and Dokploy/VPS bootstrap guide.
11. **WP-08 operational + financial reports** — [WP-08-PROGRESS.md](implementation/WP-08-PROGRESS.md): operational filters, per-currency paid/outstanding/overdue reports, document gaps and live browser evidence.
12. **WP-09 local hardening** — [WP-09-VERIFICATION.md](implementation/WP-09-VERIFICATION.md): AV fail-closed integration, Production guards, legacy route gate, nonempty DB/blob/key restore and remaining release prerequisites.
13. **WP-03 commercial party profile** — [WP-03-COMPANY-PROFILE.md](implementation/WP-03-COMPANY-PROFILE.md): nonfinancial metadata, additive migration, safe reference handling, local integration/browser tests and remaining gaps.
14. **P-02/P-03 approved decisions** — [05-WP05-PIVOTAL-WORKSHOP.md](architecture/05-WP05-PIVOTAL-WORKSHOP.md): approved Admin exception close (B) and ledger void/replacement (A).
15. **WP-05 payment ledger** — [WP-05-VERIFICATION.md](implementation/WP-05-VERIFICATION.md): scoped transfers/expenses/returns, same-order 5,000 discrepancy, concurrency/tenant/permission verification.
16. **Staging release operations** — [Import release runbook](../deploy/import/RELEASE-RUNBOOK.md): Docker/Dokploy deployment architecture, secrets, ClamAV, HTTPS, encrypted backup and restore gates. Prepared, not executed.
17. **PA-01 and PA-02 approval** — [Platform Admin workshop](architecture/06-PLATFORM-ADMIN-WORKSHOP.md): separate `SuperAdmin` identity and explicit manual-only subscriptions with **no payments at all**.
18. **PA-01 implementation and verification** — [PA-01-VERIFICATION.md](implementation/PA-01-VERIFICATION.md): separate login/session, merchant access metadata, tenant creation/Admin invitation and account lifecycle.
19. **PA-02 verified manual subscriptions** — [PA-02-MANUAL-SUBSCRIPTIONS-VERIFICATION.md](implementation/PA-02-MANUAL-SUBSCRIPTIONS-VERIFICATION.md): plan catalogue, subscription assign/renew/end, 76 authenticated platform API + 16 browser tests, concurrency, no-payment invariant, local staged restore and release limits.

## Implementation boundary

The old Template/Document code and database remain intact, but the optimized Production Next.js server redirects `/` to `/import` and 404-blocks legacy editor/API routes. The unauthenticated old .NET API on port 5088 must **never** be deployed publicly. Import API port 5089 uses .NET 10, Identity, Tenant filters and EF Migrations with the isolated `wathiqa_import_dev` DB. Arabic merchant routes include `/import`, `/import/login`, `/import/join`, `/import/companies`, `/import/team`, `/import/orders`, `/import/orders/[id]` and `/import/operations`. A **separate** `SuperAdmin` session and protected platform API serve `/platform/login`, `/platform`, `/platform/tenants`, `/platform/plans`, `/platform/subscriptions`, `/platform/users` and `/platform/audits`. PA-02 subscriptions are manually assigned, renewed or ended, with no price, invoice, collection or payment. No platform operator can read tenant Orders/Documents/Payments by default. Purchase Orders may remain Draft, be Closed administratively with outstanding liabilities visible, or be safely Cancelled. Merchant import-payment transfers are **user-recorded, proof-linked ledger events**, NOT bank-verified transfers, and have no connection to Wathiqa subscriptions. Production release is blocked pending actual VPS gates and merchant acceptance.

The new branch `feature/import-management-mvp` keeps the older `main` intact. Do not push/change main or migrate/cut over without a verified implementation and migration/rollback sequence.

## Next safe engineering slices

Next: **No PA-02 payments or billing**—the user explicitly rejected them. Run WP-10 acceptance with five anonymized real Orders, validate performance and unsupported financial reversals, then stage Docker images on Hostinger/Dokploy. VPS gates: real ClamAV EICAR scan, TLS/trusted proxy, protected secrets, off-host encrypted restic snapshots and independent restore of DB/documents/keys/PFX, **SuperAdmin credential recovery/MFA**, monitoring, and never deploying the legacy API. Do not use QA results to claim customer acceptance or production safety.

## Still open Level 3

- P-01-R1 approved (supersedes P-01): excess payment stays as a visible discrepancy on the originating Order and is reconciled only by an audited correction or a supported same-order expense settlement. Supplier-wide credit and P-01A are cancelled.
- P-02 **APPROVED option B:** Admin documented exception close retains all liabilities; cancellation never destroys bank facts.
- P-03 **APPROVED option A:** void erroneous ledger row + linked replacement; real bank return is a separate event. General reversal of previously allocated money is not implemented.
- PA-01 **APPROVED option A with role `SuperAdmin`:** completely separate identity and cookie; tenant Admin never becomes global admin. Platform does not view private trade data.
- PA-02 **APPROVED and locally VERIFIED:** plan labels and time limits, manual assignment/renewal/end only, audit and immediate entitlement enforcement. **No payment system of any kind**, no prices, invoices, gateways or billing ledger; existing expiry remains the sole live authorization deadline.

See the approved decision register, WP-05 local evidence and staging release runbook. Approval of domain decisions is separate from deployment authorization.
