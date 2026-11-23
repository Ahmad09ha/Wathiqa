# وثيقة | Wathiqa — Import Management Migration Workspace

## Start here — تشغيل وثيقة محلياً لأول مرة

**للمطوّر الجديد:** اتّبع [دليل التشغيل المحلي بالعربي (Windows)](docs/LOCAL-SETUP-AR.md) خطوة بخطوة. يشمل تثبيت المتطلبات، تنزيل الفرع الصحيح، إنشاء PostgreSQL المنفصل، تطبيق EF Migrations، إنشاء حسابات Admin وSuperAdmin محلياً، تشغيل الخدمات، وحلول الأخطاء الشائعة. **لا تحتاج ملفات أسرار من جهاز مطوّر آخر**؛ السكريبتات تنشئ كلمات مرور محلية جديدة وتحفظها خارج Git.

بعد إكمال التجهيز الأول، شغّل المشروع الحالي من جذر المستودع:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-ImportApi.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Web.ps1
```

- التاجر: http://localhost:3000/import/login
- مدير المنصة SuperAdmin: http://localhost:3000/platform/login
- Health: http://127.0.0.1:5089/api/health

> مهم: ملف `start.ps1` القديم يشغّل أيضاً واجهة/Backend محرّر المستندات القديم على `5088`. **لا تستخدمه كطريقة تشغيل المنتج الجديد**. التفاصيل الكاملة في الدليل أعلاه.

**Current product direction:** وثيقة is a multi-tenant yarn import management system. The authenticated .NET 10 API and Arabic workspace preserve legacy editor source/data separately. **Orders, B/L, containers, customs, private documents, scheduled dues, evidence-linked transfer ledger, same-order expense allocations, refunds, correction/closure controls and operational/financial reports** have locally verified MVP slices. **PA-01 + PA-02** add an independent Arabic `SuperAdmin` control plane, merchant/user administration, and **fully manual subscriptions** (plan names/durations, assignment, renewal, termination and audits; 76 API + 16 browser checks). By explicit owner decision, there is **NO payment capability of any kind for Wathiqa subscriptions:** no price, payment entry, invoice, gateway or billing ledger, and no automatic renewal. The existing merchant payment ledger is a separate import-order workflow; a transfer recorded by a merchant is **not independently bank-confirmed**. The optimized **Next.js 16.4.5** Production build blocks old editor/API web routes; the old backend must **never** be exposed on VPS. Local DB/blob/key/finance/manual-subscription restore passed, but actual Docker build, real AV scan, HTTPS, encrypted off-host recovery, staging, owner credential recovery/MFA and merchant acceptance remain **publication blockers**. See [PA-01 platform](docs/implementation/PA-01-VERIFICATION.md), [PA-02 subscriptions](docs/implementation/PA-02-MANUAL-SUBSCRIPTIONS-VERIFICATION.md), [WP-05 finance](docs/implementation/WP-05-VERIFICATION.md), [WP-09 security](docs/implementation/WP-09-VERIFICATION.md), [VPS runbook](deploy/import/RELEASE-RUNBOOK.md), and [approved decisions](docs/architecture/01-DECISIONS.md).

**New local import workspace:** http://localhost:3000/import/login (requires Import API at 127.0.0.1:5089). On a fresh clone, provision your own trial/unlimited tenant accounts with `scripts/Seed-ImportAccessAccounts.ps1`; their generated credentials are in gitignored `.local/import-access-accounts.json` (see [local setup](docs/LOCAL-SETUP-AR.md)). `.local/import-demo-accounts.json` exists only when separate demo/QA fixtures are created.

**Independent local Platform SuperAdmin console:** http://localhost:3000/platform/login. The operator login is `local-superadmin@wathiqa.invalid` and its random password is in **gitignored** `.local/platform-superadmin-account.json`, never in source control. Platform and merchant cookies/roles are independent. `/platform/plans` and `/platform/subscriptions` manage manually granted access **without payment or billing**. See [PA-02 verification](docs/implementation/PA-02-MANUAL-SUBSCRIPTIONS-VERIFICATION.md).

**Access-seeded Admin accounts:** Two separate merchant workspaces now exist locally: `trial-admin@wathiqa.invalid` (3 calendar months from initial seed) and `unlimited-admin@wathiqa.invalid` (no automatic expiration). Passwords are random and stored ONLY in gitignored `.local/import-access-accounts.json`. Their tenant-level expiration is enforced by Identity login, cookies and authorization. New VPS databases can provision the same account types via an opt-in, environment-secret-backed one-time seed; **no VPS database has been modified yet**. Instructions: [Access Seed / VPS provisioning](docs/implementation/ACCESS-SEED-ACCOUNTS.md).

**Legacy editor:** The section marked "توثيق تاريخي" below documents the earlier document-template product, retained for archival/development compatibility. Its root and `/editor` routes are **blocked in the Production Next.js build**; the root redirects to `/import`. This is intentional and must not be bypassed in public deployment.

**Legacy API stack:** .NET 9 Minimal API · EF Core 9 · PostgreSQL 18 · React 19 · Tiptap · Lenis · ClosedXML. **New stack:** .NET 10 · Identity · EF Core 10 · PostgreSQL 18 · Next.js 16.4.5 (authenticated import and separate SuperAdmin platform routes).

## توثيق تاريخي — محرّر القوالب والمستندات القديم

الأقسام التالية توثّق المنتج السابق (‎Legacy Editor / .NET 9). **ليست خطوات تشغيل Wathiqa Import + SuperAdmin الحالية.** شغّل المشروع الجديد فقط من خلال [دليل التشغيل المحلي](docs/LOCAL-SETUP-AR.md)؛ ولا تنشر محرّر الوثائق القديم أو API الخاص به.

## Workflow

1. Open **وثيقة** and choose a starter template, **قالب جديد** or **استيراد ملف** (PDF, DOCX, XLSX).
2. Click **تعديل** to edit a template, including label names, text, table content, and block order.
3. Click **استخدام القالب** to create a new **independent document** based on the template.
4. Edit the document, add or remove rows/columns, insert a new table or move top-level blocks up and down.
5. Click **حفظ التعديلات**, and reopen the document from **المستندات المحفوظة**.
6. Click **تصدير Excel** to download an .xlsx workbook based on the saved content.

## Supported behaviors

- Template and document CRUD in PostgreSQL; editor JSON stored as JSONB.
- Multiple independent documents per template; removing a template does not remove its documents.
- Optimistic concurrency control for document save (revision + HTTP 409 on stale edits).
- Formatting: headings, bold, italic, alignment, lists, tables, row/column operations, block movement, undo/redo.
- Extraction: PDF and DOCX *candidate field labels* with empty values, XLSX first-row headings.
- Excel export: paragraphs into rows; table cells into spreadsheet columns.
- Two *editable starter structures* based on the two SEDAR Sales Contract examples.

## Verification performed

See `VERIFICATION.md` for evidence. Successful checks include:
- API build (0 errors, 0 warnings)
- Next.js production build and TypeScript check
- Local PostgreSQL startup and backend health
- 13 API integration checks covering create/edit/copy/save/revision/export/reimport/delete
- 2 import checks using generated valid PDF/DOCX fixtures
- 9 Chrome browser checks including initial save state, Tiptap edit, table insertion, persistence and reopen
- 8 more Chrome checks covering UI-driven template creation, PDF upload, block reorder and table row/column operations
- 1 API-restart persistence check (stored document remains intact)
- 8 negative/edge cases (upload limits, invalid formats, deletion isolation)
- 3 checks of actual XLSX content, six-column table output and Chinese Unicode text
- 3 bilingual PDF import checks (Chinese/English labels and field-value stripping)
- 16 Arabic UX/browser checks (Wathiqa browser title/icon, RTL, fixed sidebar, Lenis anchors, toast behavior, mobile drawer, card layout)

**Total: 63/63 local automated smoke checks passed.** A complete stop/restart of the
dedicated PostgreSQL cluster, API and frontend was also tested successfully.

Rerun them when the app is started:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Smoke-Test.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\Import-Smoke-Test.ps1
node .\scripts\Browser-Smoke-Test.mjs
powershell -ExecutionPolicy Bypass -File .\scripts\Persistence-Smoke-Test.ps1
```

All smoke scripts clean up their own temporary document/template records.

The repository and package names are now Wathiqa. See `GITHUB_SETUP.md` for safe first-time GitHub connection instructions and the included CI workflow.

To rerun the full set in one command (note: includes restarting the local API):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Run-Smoke-Tests.ps1
```

## Material limitations — not production-ready

- **The legacy editor/API has no authentication or tenant isolation.** The new Production Next.js route gate denies its web paths, but the old backend on port 5088 must still be isolated; public deployment remains blocked until a complete end-to-end staging audit.
- **Imported PDF/DOCX layout is not recreated faithfully.** Label extraction is heuristic, may omit legal clauses or table grid structure, and scanned PDFs need a separate OCR service.
- **Excel export is content-to-worksheet, not pixel-perfect reconstruction** of the imported PDF or a replacement for a Word/PDF contract preview.
- Two built-in templates are editable starter structures with placeholders. They are **not verbatim legally approved copies** of the original SEDAR contracts; verify the final legal terms against the PDFs.
- The **legacy editor** uses `EnsureCreated`. The new import database uses EF Core Migrations. Do not mix their schemas.
- No audit history, account ownership, malware scanning, or production deployment/monitoring is implemented.
- No automatic autosave; click Save explicitly. Concurrency protection applies to document revisions, not simultaneous edits to templates.
- Actual user-uploaded contract PDFs have **not yet been run through the import endpoint** in this session; the validated import fixtures were generated PDF/DOCX files.

## Source map

- `backend/Wathiqa.Api/Program.cs` — legacy APIs and file import/export
- `backend/Wathiqa.Api/Models.cs` — legacy EF Core tables
- `backend/Wathiqa.Api/ContentTools.cs` — legacy Tiptap JSON normalization and extraction
- `backend/Wathiqa.Api/Seed.cs` — legacy starter template data
- `backend/Wathiqa.ImportApi/` — .NET 10 Identity/tenant, parties, Orders, logistics, private documents, payment ledger and P-02/P-03 admin/finance workflows with migrations
- `frontend/src/app/import/` — new Arabic import management workspace
- `frontend/src/app/page.tsx` — workspace
- `frontend/src/app/editor/[kind]/[id]/page.tsx` — document/template editing
- `frontend/src/components/DocumentEditor.tsx` — Tiptap controls
- `scripts/` — local startup and integration/browser smoke tests
