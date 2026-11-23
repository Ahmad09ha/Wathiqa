# WP-14 - Granular tenant Staff permissions

Status: implemented and locally verified on 2026-11-14. Branch: feature/import-management-mvp. Not deployed.

## Scope

Tenant Admin can grant/revoke per Staff account which sidebar pages and file-order tabs are visible.
Admin retains implicit full access. Existing CanManagePayments is a separate financial-write gate.
Every request is checked by the server against the live tenant/user record; no cached permission claim can preserve revoked access.

## Permission catalog

| Area | Keys |
| --- | --- |
| Main sidebar | nav.dashboard, nav.orders, nav.reference, nav.operations, nav.companies |
| From-file tabs | tab.info, tab.payments, tab.bl, tab.customs, tab.tracking |
| Documents | documents.view, documents.upload |

## Persistence and APIs

- Nullable AspNetUsers.AccessPermissionsJson stores explicit JSON allow-list; null retains the historical Staff access. Empty list revokes all business pages. Invalid JSON denies access.
- PUT /api/users/{id}/visibility is TenantAdmin-only, refuses foreign-tenant IDs and Admin targets, validates every key and duplicates, logs SecurityAudit StaffVisibility with before/after.
- GET /api/auth/me and GET /api/users return effective rights. No login refresh needed after Admin changes.
- Existing TenantMember authorization checks current rights per request; unknown new Staff endpoints deny by default.
- Minimal GET /api/companies/options returns only ID, name and type for order selectors when company directory visibility is disabled.
- POST /api/companies/quick accepts only Supplier/Customer, so order entry cannot create arbitrary business entity types.
- B/L and customs have separate permissions; shipment list returns only needed context when one of those permissions is absent.
- All tenant filters, CSRF rules and independent financial-write authorization remain active.

## UX

- Team page shows a permission editor grouped by main navigation, order-from-file tabs and documents.
- Sidebar and order tabs hide revoked features; direct page visits show a permissions notice.
- Document upload/link/delete controls disappear for staff allowed only document reading.
- Dependencies: nav.orders enables access to order tabs; documents.view enables document content; tab.payments alone does not permit writing financial records.

## Boundaries

- Visibility controls are page/tab-level, not redaction of every shared purchase-order field. Order-list totals and common order header context remain accessible to staff granted nav.orders and at least one order tab.
- Legacy staff are not abruptly locked out. A merchant Admin may explicitly revoke all rights per employee.
- Platform SuperAdmin and the legacy document-editor product are out of scope.
- The migration only adds a nullable user column and expands SecurityAudit text lengths; no accounts, roles, passwords or existing orders are reset.

## Verification and release

- Added migration 20261114102534_TenantGranularStaffPermissions: nullable staff allow-list and wider SecurityAudit before/after columns, applied to the isolated local Import database after a DB checkpoint; no changes to real production accounts.
- .NET 10 backend build: 0 errors / 0 warnings. TypeScript compiler / lint: PASS. Next.js optimized production build: PASS.
- scripts/Test-TenantGranularPermissions.mjs: 37/37 PASS, including legacy visibility, live session revocation, foreign-tenant 404, invalid rights, Admin immutability, separate financial write permission, restricted company selector, Docs/B/L/customs/tracking 403, security audit, and full revoke.
- scripts/Browser-TenantGranularPermissions.mjs: 7/7 PASS (Admin team screen, twelve toggles, draft cancel, five file tabs, 390px mobile screen).
- scripts/Test-ImportDashboard.mjs: 16/16 PASS; scripts/Test-ImportOrders.mjs: 25/25 PASS; scripts/Test-ImportLogistics.mjs: 64/64 PASS. Existing payments suite printed 91 successful assertions but its runner timed out after reporting, so do not count its process exit as confirmed success.
- Disposable QA merchants/users and their security audits were removed via guarded cleanup. Logistics QA data was removed separately. Browser screenshots stay gitignored under .local.
- Production deployment is not performed as part of this implementation. Review backups before the next approved Dokploy deployment, where Import auto-migration applies the additive migration.
