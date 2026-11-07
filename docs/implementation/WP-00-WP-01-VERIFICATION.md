# Wathiqa — WP-00 / WP-01 Implementation Evidence

**As of:** 2026-11-06
**Branch:** feature/import-management-mvp (uncommitted, not pushed)
**Release readiness:** LOCAL DEVELOPMENT ONLY, NOT DEPLOYED

## Verified WP-00 — preserve old business

The original document editor, code and PostgreSQL data are preserved, on the legacy development database and ports 3000/5088. scripts/Archive-Legacy.ps1 produced a PostgreSQL dump under gitignored .local/backups/, then restored it into a disposable database and verified matching row counts: 2 Templates and 2 Documents. This is a **local**, not an off-host, backup.

scripts/Initialize-ImportDatabase.ps1 created a separate wathiqa_import_dev PostgreSQL database and dedicated account. Nothing was migrated from legacy Templates/Documents into Orders. The new API is a separate project backend/Wathiqa.ImportApi targeting net10.0; the old API remains available until an approved cutover.

## Verified WP-01 — identity / tenant isolation first slice

The new ASP.NET Core API runs locally at http://127.0.0.1:5089, with Next.js same-origin proxy at /import-api.

- ASP.NET Core Identity: hashed passwords, strong password rules, lockout, secure cookie settings (HttpOnly, SameSite Strict, Secure in production).
- CSRF: all unsafe API methods protected by a request token from GET /api/auth/csrf; client sends X-Wathiqa-CSRF.
- Single Tenant per user, Admin/Staff roles, CanManagePayments permission. Staff may view finances when the financial APIs exist, but only Admin or Staff+permission may write; every protected request checks the CURRENT role/permission and active account/tenant in the database.
- CLI-only tenant Admin bootstrap. No public self-registering merchant endpoint.
- Staff invitations: random one-time token stored only as SHA-256 hash, expiring in 48 hours. Admin can issue invitation and employee can accept it with their own password.
- Tenant-owned Companies/Parties basic CRUD with query filters by the trusted authenticated tenant. Cross-tenant identifiers are not exposed.
- Admin-only user list, permission grant/revoke and account enable/disable, audited.
- Development-only payment authorization diagnostic route; **no real payments functionality is implemented**.
- EF Core 10 InitialImportSecurity migration applied only to new database; no EnsureCreated on the new database.
- Arabic Next.js routes: /import/login, /import/join, /import, /import/companies, /import/team.
- This is a transitional feature path: the old root editor is NOT intended to be a second permanent business.

## Tests (actual local results)

- .NET Import API build: PASS, 0 errors / 0 warnings.
- NuGet vulnerability scan: no known vulnerable packages reported after resolving patched System.Security.Cryptography.Pkcs 10.0.13.
- EF Core initial migration: successfully applied to wathiqa_import_dev.
- scripts/Test-ImportIsolation.ps1: **25/25 PASS** (two tenants, anonymous 401, CSRF 400, tenant B cannot read/update/delete A, one-time invite, Staff read rights, live permission grant/revoke, deactivated account denied).
- scripts/Test-ImportWebProxy.ps1: **3/3 PASS** (session cookie via Next.js same-origin proxy, tenant-scoped data, logout).
- scripts/Browser-Import-Test.mjs: **12/12 PASS** real Chrome (login, join form, dashboard, right sidebar, company CRUD, team UI, mobile drawer, logout).
- Frontend TypeScript check and Next.js optimized production build: PASS for all new routes.
- Legacy browser regression re-run individually with clean process exits: Arabic RTL suite **16/16 PASS**, editor smoke suite **9/9 PASS**, advanced UI suite **8/8 PASS**.
- Visual QA images stored locally: .local/wathiqa-import-dashboard.png and .local/wathiqa-import-mobile.png.

## Local operator steps

From D:\Works\PrivateWorks\Hussam:

1. dotnet build backend/Wathiqa.ImportApi/Wathiqa.ImportApi.csproj
2. powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-ImportDatabase.ps1
3. powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Bootstrap-ImportDemo.ps1
4. powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ImportApi.ps1
5. powershell.exe -NoProfile -ExecutionPolicy Bypass -File start.ps1
6. Open http://localhost:3000/import/login

The local demo includes demo-a and demo-b tenants. Demo credentials are in the gitignored .local/import-demo-accounts.json. Never upload that file, show its contents publicly, or use demo credentials in production.

Run the above three test scripts; stop the new backend only with scripts/Stop-ImportApi.ps1.

## Remaining gaps, without claiming implementation

- WP-02: business entities, tenant-aware composite relationships, audit foundation and fresh/upgrade migration tests.
- WP-03: Companies domain beyond basic CRUD (business references, duplicate policies and editing).
- WP-04: purchase orders, line items, per-tenant numbering and pricing; not implemented.
- WP-05: planned and actual payments, same-order-only discrepancy (P-01-R1), expenses and audit; not implemented. Product decision P-03 is still required for settled-payment correction mechanics.
- WP-06+: B/L, containers, customs, document storage/checklists, reports; not implemented.
- Production: needs trusted reverse proxy configuration, key-ring persistence, off-host backups and restore rehearsal, invitation delivery policy, hardened rate limits, monitoring, migrations/deploy strategy and legacy-editor cutover.
- The old editor remains **unauthenticated** and must NEVER be exposed to the internet during transition. No VPS deployment or Git push has been performed.

Microsoft advisory GHSA-846f-f764-76mx identifies 10.0.13 as a patched version of System.Security.Cryptography.Pkcs; keep the .NET runtime and all packages patched as well.
