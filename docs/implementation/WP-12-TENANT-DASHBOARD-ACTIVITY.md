# WP-12 — Merchant Dashboard & Tenant Activity Timeline

Status: implemented locally, integrated tests and browser verification recorded below.
Branch: feature/import-management-mvp. No push/merge, staging release or VPS deployment is implied.

## Intent and surface

The first authenticated merchant page, \`/import\`, now shows a detailed, Arabic RTL management dashboard with:
- Order and commercial-payment summaries, separated by currency
- Shipping bills, ISO containers, customs states and free-time/ETA risk indicators
- ShipsGo subscription entitlements, reference counts, documents, companies and team
- A two-series 14-day trend for newly created orders and containers
- A unified, newest-first, tenant-scoped activity timeline across existing audit sources

It is not the platform SuperAdmin dashboard. It reuses the existing ImportShell and TenantMember authentication. The UI never calculates financial authority or tenant membership from client-provided IDs.

## API contracts

\`GET /api/dashboard/overview?days=30\`
- \`days\`: 0 (lifetime), 7, 30, 90, 365; 30 default.
- All headline totals are **lifetime current-state** counts, as explicitly shown in the UI.
- \`newInPeriod\` fields use \`days\`, as do the activity filters; the 14-day trend is deliberately fixed to the last 14 calendar days.
- Returns grouped domain sections \`orders\`, \`financial\`, \`shipping\`, \`containers\`, \`customs\`, \`documents\`, \`companies\`, \`team\`, \`tracking\`, \`trend\`, with \`asOfUtc\`.
- Commercial ordered/settled/remaining amounts and transfer/expense figures are grouped by **currency**. Never sum USD and EUR into a fictional portfolio total.
- Net transferred = active transfers minus recorded returns; unresolved transferred = net transferred minus existing financial allocations. Commercial remaining is a distinct concept. Customs declaration fees are NOT assumed paid bank transfers.
- ETA/free-time indicators use stored shipment/container dates and are advisory; they do not claim a live provider status if ShipsGo has not synchronized.
- Empty tenants produce zero-state metric objects and a 14-day series of zeros, not exceptions.

\`GET /api/dashboard/activity?days=30&category=all&page=1&pageSize=20\`
- Same period convention; category one of \`all\`, \`orders\`, \`finance\`, \`logistics\`, \`documents\`, \`companies\`, \`tracking\`, \`security\`, \`subscription\`.
- Pages bounded to 1..100000 and sizes 1..50; server does \`COUNT\`, ordered \`OFFSET/LIMIT\`, then batch-resolves actor/subject names within the same tenant.
- Orders, payments, shipping/customs, documents and team-security actions reuse their existing append-only audit records. Tracking includes reference registration and its most recent successful synchronization. Older companies with no audit still display the known creation timestamp as a legacy event.
- New company Create/Update/Delete mutations write to \`CompanyAudits\` in the SAME EF SaveChanges transaction as the business change, with actor ID, timestamp, company ID, name/type snapshot. The feed reads the name snapshot stored at each event, so later company renaming never rewrites earlier entries. No contact, tax or banking details are duplicated.
- Historical synthetic company creation is suppressed when a real \`Created\` audit exists, to prevent double counting. Deleted companies may still be named from tenant-scoped, soft-deleted records.
- For Admin, security and subscription events are included. For Staff, the API rejects explicit \`security\`/\`subscription\` filters with 403 and excludes those categories even from \`all\`. This is enforced server-side, not merely hidden in the UI.

The activity feed reflects **events the system actually recorded**, not a claim of complete retroactive history. Historical company edits/deletions, every past ShipsGo refresh, logins and actions that were not audited cannot be reconstructed faithfully from current rows. The UI discloses this limitation.

## Security & invariants

- Both routes require the pre-existing \`TenantMember\` policy, with database global tenant filters on all tenant-backed sources.
- PlatformAudit (a platform-wide table) is explicitly restricted by tenant ID for the merchant Admin view. Deleted item labels are resolved only after checking tenant ID.
- Cross-tenant actor names and object references are never resolved. No audit JSON body, credentials, personal contact details or document contents are returned in timeline cards.
- The new CompanyAudits table has tenant key, indexes for chronological and company lookups, tenant filter and a tenant FK.
- Invalid category, period and pagination return 400. Requests without a tenant session return 401.
- The API performs aggregates and paginated audit queries server-side, not a full download to the browser.

## Migration

\`20261112155822_TenantCompanyActivityAudit\` creates \`CompanyAudits\` and indexes.
It is additive and has been applied ONLY to \`wathiqa_import_dev\` on local loopback PostgreSQL. No backfill invents historical actor identity. EF Core migration/model drift verification passed.

## Verification (2026-11-12)

- \`node scripts/Test-ImportDashboard.mjs\` — **16/16 PASS**: anonymous denial, two merchant sessions, currency isolation, scoped activity, filters, periods, deterministic paging, invalid input rejection.
- \`node scripts/Test-DashboardCompanyAudit.mjs\` — **5/5 PASS**: create, edit and soft-delete a uniquely tagged test company; exactly three matching events with correct actor; no cross-tenant leak. Guarded cleanup dry-run/apply/dry-run returned zero matching QA company and audit rows.
- \`node scripts/Test-DashboardNewTenant.mjs\` — **7/7 PASS**: newly provisioned empty merchant, Admin and invited Staff, zero-state aggregates, Staff denial of security/subscription activity including \`all\`, Admin access to own subscription events. The disposable tenant was removed with existing guarded platform cleanup.
- \`node scripts/Browser-Dashboard-Test.mjs\` — **8/8 PASS** after final UI stale-state hardening and latest backend rebuild; end-to-end login, rendered cards, financial currencies, timeline actor/subject, filters, page navigation, mobile 390px and tablet no horizontal overflow. The final browser rerun passed after those changes.
- Existing \`Test-ImportOrders.mjs\` **25/25 PASS** and \`Test-ImportLogistics.mjs\` **64/64 PASS** after adding company auditing; logistics QA cleanup confirmed zero remaining fixture rows.
- \`Test-ImportDocuments.mjs\` passed earlier assertions but reached a pre-existing document-requirement rule in the persistent demo tenant and safely refused to overwrite it. It was stopped; no user rule was modified. All uniquely tagged QA documents/companies/orders from that run were subsequently cleaned with the existing guard. This is a test-fixture baseline prerequisite, not proof of a dashboard/API regression.
- Latest .NET 10 build and Next.js production build compiled. TypeScript validation passed; the final browser rerun passed, with local API and web health checks.

## Release / handoff

1. Apply the additive EF migration through the controlled staging migration pipeline after a verified backup.
2. Deploy matching API and Next.js build together, with ordinary tenant auth and migration sequencing.
3. Smoke-test Admin + Staff login, currency totals, event filtering/paging and responsive layout in staging.
4. On high-volume merchants monitor dashboard latency and SQL query plans; add specific indexes if a measured bottleneck emerges.
5. No external provider call, billing, production credentials or deployment is needed for this dashboard.
6. Do not claim all possible historical events are complete; improve each domain's audit instrumentation when the product requires additional action classes.
