# WP-13 — Tenant-owned purchase-order reference data

Status: implemented and locally verified. Branch: feature/import-management-mvp. Not yet pushed or deployed.

## User journey

When opening /import/orders/from-file (also the ordinary new/edit purchase-order form):

- Supplier is required and Customer optional. Both use the existing TenantCompany records and their typed Supplier/Customer identities. The + button saves a new record into the current tenant's company directory, selects the newly created ID, and retains the in-progress order and selected source PDF/image.
- Loading port and discharge/arrival port are both chosen from the tenant's reusable port directory. Each has a + action to create and select a new saved port in place. Orders continue to persist the port's name as a string snapshot, not a new FK, so legacy order/update/import contracts remain unchanged.
- Choices include distinct port strings already in this tenant's existing Orders. An old port is labeled as historical, can be selected, and can be promoted into the saved directory by the manager. This never modifies historical orders or silently imports their contents.
- Tenant-specific management tab: /import/reference-data (بيانات طلبات الشراء) with Supplier, Customer and Port tabs, search, create, edit and delete. Existing comprehensive /import/companies remains available for optional company contact/tax information.
- Simplified company edits in the new tab preserve all existing optional fields rather than clearing company contact/profile data.

## Ownership and security

- Existing Company API GET/POST/PUT/DELETE /api/companies remain protected by TenantMember and EF TenantId global filters. Order API checks SupplierId/CustomerId belong to the logged-in tenant and match their types.
- New port API: GET /api/ports returns catalog entries (source Catalog and ID) plus historic suggestions (source History and null ID); POST /api/ports creates, PUT /api/ports/{id} edits and DELETE /api/ports/{id} soft-deletes. These endpoints require TenantMember and existing CSRF protection. Foreign-tenant IDs return 404.
- TenantPorts includes TenantId, Name, NormalizedName, Country, IsDeleted and CreatedAtUtc. A partial unique index on (TenantId, NormalizedName) for active rows prevents duplicate ports within a tenant but allows identical port names across different tenants. Soft-deleted names may be reused.
- TenantPortAudits records Create/Update/Delete atomically with the port write, retaining actor and name at the time of the action. The Merchant Dashboard timeline includes the new ports category with the same tenant isolation.
- Port changes do not rewrite historical order snapshots; deleting a port may leave it visible as a historic suggestion if it appears on a prior active order.
- Historical order port choices come from SQL DISTINCT queries on tenant-filtered Orders; they are only saved into the new port directory on explicit user action.

## Migration

20261113230608_TenantPortReferenceDirectory creates TenantPorts and TenantPortAudits with unique/lookup indexes. Orders, Companies, Users and subscriptions remain unchanged. A local database checkpoint was captured before applying this migration to wathiqa_import_dev.

Production requires deliberate controlled EF migration (see the existing Dokploy release runbook). A Git push is not a production schema update. Do not run a seeder instead or change existing customer data.

## Local verification (2026-11-14)

- .NET 10 Backend Build: 0 errors and warnings.
- TypeScript lint (tsc --noEmit): PASS.
- Optimized Next.js production build: PASS and includes /import/reference-data.
- scripts/Test-TenantReferences.mjs: 12/12 PASS (anonymous denial; two tenant sessions; independent identical names; foreign PUT/DELETE denial; unique name; validation; rename isolation; legacy suggestions; audit actor/names; soft-delete and re-create).
- scripts/Browser-TenantReferences-Test.mjs: 11/11 PASS (login; three tabs; saved/historical port directory; four file-order choices; inline port creation and auto-select; manager visibility and delete; inline supplier field; mobile 390px overflow).
- scripts/Test-ImportDashboard.mjs: 16/16 PASS, including new ports activity filters.
- scripts/Test-ImportOrders.mjs: 25/25 PASS, including original supplier tenant checks and purchase-order contract.
- All temporary port QA entries and their audit rows were cleaned with guarded local scripts, verified as zero matching rows.
- Browser screenshots remain gitignored under .local/reference-manager-desktop.png, .local/reference-from-file-desktop.png and .local/reference-manager-mobile.png.

## Explicit exclusions

- Source file preview remains manual data entry. OCR / AI extraction from uploaded invoices/contracts is not part of this change.
- No backfill or migration changes old port snapshot values.
- Basic Name/Country company management remains separate from the full company profile screen.
- No VPS deployment or production migration was performed.
