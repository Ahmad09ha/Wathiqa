# WP-03 — Commercial Party Directory (Non-financial Extension)

**Date:** 2026-11-07  
**Branch:** `feature/import-management-mvp`  
**Status:** Non-financial contact-profile and paged-directory vertical slice **VERIFIED LOCALLY**. Bank-instruction authorization, realistic high-volume performance and release validation remain deferred; no public release claimed.

## Purpose / ownership

The Wathiqa import workspace must register the real trading parties used on Purchase Orders, B/L shipping records and customs clearance. A company is owned by exactly one Tenant. We extended the existing company aggregate/API, rather than creating a second directory or changing approved tenant boundaries.

## Implemented

- Existing `Name` + `Type` contract retained and backwards compatible for current selectors/clients.
- Optional profile fields: `NameEn`, `Country`, `City`, `Address`, `ContactName`, `Phone`, `Email`, `TaxNo`, `DefaultCurrency` (blank/USD/EUR) and `Notes`. All fields validate maximum lengths; invalid email/currency rejected with 400. Empty legacy fields safely use `""`.
- GET list, GET by ID, POST and PUT round-trip the new fields, under the existing authenticated tenant filter. Foreign-tenant IDs remain non-disclosing 404.
- `GET /api/companies/search?search=&type=&page=&pageSize=` adds server-side name/English-name/contact search, company-type filter, validated pagination (pageSize 1–100), total count and deterministic ordering. The existing unpaged `GET /api/companies` remains unchanged to protect current Order dropdown consumers. Arabic directory uses this new contract, with a short input debounce and previous/next paging. A newly saved company is located by name automatically.
- A linked company **cannot be soft-deleted or have its type changed** while referenced by an active Purchase Order (Supplier/Customer), Shipment shipping line, or Customs broker. API returns `409 company_in_use`. Its contact information can still be updated; order supplier-name snapshots remain unchanged as originally designed. This protects historical business references from being hidden by company soft-delete.
- Arabic RTL company form now supports create, edit, contact fields and existing soft-delete confirmation; browser QA deletes only a row created by that QA run, not the first merchant row.
- Bank name/IBAN/SWIFT deliberately **not** added; real banking instructions need a reviewed sensitive-data visibility/update policy and an appropriate audit trail. The directory fields do not record verified bank details.

## Schema, migration and rollback safety

- `backend/Wathiqa.ImportApi/Migrations/20261107144549_CompanyContactProfile.cs`: **additive** PostgreSQL migration, ten new bounded, non-null columns with safe empty-string defaults; no existing data/foreign keys deleted.
- Before application, `scripts/Backup-ImportDevelopment.ps1` created a verified custom-format database checkpoint under the gitignored `.local/backups/import-dev-20261107-144634.dump` with SHA-256 printed locally. This is a development checkpoint, **not** an off-host disaster recovery backup.
- Applied using `scripts/Apply-ImportMigrations.ps1` against only `wathiqa_import_dev` after rebuilding the new API. A second migration update reported `No migrations were applied. The database is already up to date.` No legacy database schema or VPS database was touched.
- Rollback of this migration would **drop** the ten profile columns and their data; prefer a compatible forward fix and reviewed backup/restore, not an automatic blind downgrade after real merchant use.

## Verified journeys

- `dotnet build backend/Wathiqa.ImportApi/Wathiqa.ImportApi.csproj --no-restore -v quiet`: **0 errors, 0 warnings**.
- `npm.cmd --prefix frontend run lint`: **PASS**; optimized Next.js Production build PASS with `.local/import-frontend-build-exit.txt=0`.
- `node scripts/Test-ImportOperations.mjs`: **70/70 PASS**, exit 0. Includes initial name/type-only creation, expanded field PUT/GET persistence, server search across two pages, type filter, invalid paging/type input, two-tenant isolation, trimming/currency normalization, invalid email/currency, cross-tenant GET/PUT 404, linked company DELETE/type-change 409, preserved reference and WP-08 nonfinancial regression checks.
- `node scripts/Browser-Import-Test.mjs`: **15/15 PASS**. Includes actual browser create/edit, persisted contact value on re-opening, server-side type filter, safe targeted QA deletion, Arabic login, mobile navigation and logout.
- `node scripts/Browser-Operations-Test.mjs`: **8/8 PASS**; `node scripts/Test-ImportPublicSurface.mjs`: **12/12 PASS** after the same optimized build.
- `scripts/Cleanup-ImportDocumentsQa.ps1 -Apply` completed; final dry-run returned **0 active matches** for all `WP07_QA_*` test fixtures. Only dedicated QA data was deleted.

## Remaining work / risks

- `GET /api/companies` still returns the existing full tenant-scoped array for Order supplier/customer selectors (backward compatibility). The dedicated directory UI now uses the new paged API; migrate select/autocomplete consumers to suitable paging/search only if actual directory volume makes the old endpoint impractical.
- Concurrent create-of-reference versus delete/type-change is not yet load-tested under row locks; do not claim this is a formally race-free database invariant. Domain checks and negative tests are a practical MVP improvement only.
- Company profile authorization is tenant-member based, not separate field-level privacy. Do not add bank-account fields under the same read contract.
- Real cross-tenant acceptance, volume/load checks and VPS deployment remain follow-up verification.
