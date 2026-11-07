# WP-07 — Private Document Registry, Links, Preview and Checklist

**Status:** Implemented as a locally verified MVP vertical slice. NOT approved for public/VPS deployment.
**Product:** وثيقة / Wathiqa Import Management.
**Branch:** feature/import-management-mvp
**Date:** 2026-11-07
**Authority:** docs/source/Wathiqa-MVP-Plan.md, section "الخطوة 7 — رفع المستندات وربطها", and architecture decisions L3-02, L3-03, L3-06 and L3-07. New implementation does NOT alter the old Template/Document editor database.

## Delivered journeys

1. Tenant Admin or Staff opens a Purchase Order and uploads a PDF, JPG or PNG (25 MB hard limit) from the Arabic drag-and-drop form.
2. The upload validates the filename extension AND first bytes, writes a random opaque filename into a private volume outside the app tree, computes SHA-256 and creates tenant-bound metadata and target links in PostgreSQL. Original display filenames are sanitized.
3. Each link selects exactly one target type: Order, Shipment/Bill of Lading or one Container. One file can be linked to many Containers via multiple rows, **without writing multiple physical copies**.
4. A document of type BillOfLading cannot span different Purchase Orders OR different B/L records under the same Order. It can link to its actual B/L plus several Containers belonging to that B/L. Database composite FKs enforce tenant ownership independently of API validations.
5. Listing documents on an Order includes documents linked directly and through its Shipments/Containers. A Container list includes only its own directly linked documents. Both list and links are scoped to the authenticated tenant and support server pagination.
6. Tenant members download or preview their own documents through authenticated endpoints; no public static files or storage keys are exposed. PDF preview uses the browser's native viewer on a same-origin authenticated URL; JPG and PNG use the same protected preview route. Inline PDF was visually confirmed after removing a redundant iframe/CSP sandbox attribute that blocked Chromium's native viewer. Security response headers still include nosniff, private no-store, cross-origin-resource-policy, X-Frame-Options SAMEORIGIN and CSP default-src none, object-src none, frame-ancestors self.
7. Users can add an extra scoped link without re-uploading or remove a single link without removing the other links. Soft-delete hides all links and blocks further downloads; physical data is retained pending an approved retention policy. The action is audited.
8. SHA-256 warns about a previously uploaded duplicate *inside the same tenant*. A second independent upload currently creates a separate physical blob; do not misdescribe this as cross-upload content deduplication.
9. Tenant Admin configures opt-in required documents by target and stage. Default: no mandatory types. A current requirement can be not_applicable, not_required, missing, satisfied or waived. Staff can read the checklist but cannot configure rules or approve/revoke exceptions.
10. An Admin-only waiver requires a meaningful recorded reason, the actor and timestamp. Revocation is non-destructive; changing a rule's required flag revokes active waivers so a later re-enable cannot silently restore an old exception. Removing a link/document makes an unmet requirement missing again.

## API surface

| Method | Route | Role |
|---|---|---|
| POST | /api/documents | TenantMember + CSRF; multipart file/type/notes + OrderId or ShipmentId or containerIds |
| GET | /api/documents?orderId=... (or shipmentId / containerId) | TenantMember |
| GET | /api/documents/{id} | TenantMember |
| GET | /api/documents/{id}/content | TenantMember; attachment, authenticated |
| GET | /api/documents/{id}/preview | TenantMember; inline authenticated PDF/JPG/PNG |
| POST | /api/documents/{id}/links | TenantMember + CSRF, scoped target |
| DELETE | /api/document-links/{id} | TenantMember + CSRF, soft-unlink |
| DELETE | /api/documents/{id} | TenantMember + CSRF, soft-delete |
| GET | /api/document-requirements | TenantMember |
| GET | /api/document-requirements/checklist?orderId=... | TenantMember |
| PUT | /api/document-requirements | TenantAdmin + CSRF |
| POST | /api/document-requirements/{id}/waivers | TenantAdmin + CSRF, reason |
| DELETE | /api/document-waivers/{id} | TenantAdmin + CSRF |

All protected endpoints use the existing ASP.NET Core 10 Identity session/CSRF middleware. Tenant identifiers derive from authenticated identity, never upload fields or body.

## Source files

- backend/Wathiqa.ImportApi/DocumentsDomain.cs — metadata, links, audit, requirements, waivers.
- backend/Wathiqa.ImportApi/PrivateDocumentStore.cs — private file store, signature checking, streaming, SHA, safe opaque paths.
- backend/Wathiqa.ImportApi/DocumentsApi.cs — upload, tenant-scoped list/preview/download, links and soft-delete.
- backend/Wathiqa.ImportApi/DocumentRequirementsApi.cs — Admin policies, checklist/waiver lifecycle.
- backend/Wathiqa.ImportApi/ImportDb.cs and Program.cs — tenant-aware composite FKs, constraints, indexes, app configuration.
- backend/Wathiqa.ImportApi/Migrations/*PrivateDocumentsAndRequirements* — isolated EF migration.
- frontend/src/lib/documentsApi.ts and frontend/src/components/ImportDocumentsPanel.tsx — Arabic document UI within Order detail.
- frontend/src/components/ImportOrderEditor.tsx; frontend/src/lib/importApi.ts; frontend/src/app/import/import.css.
- scripts/Test-ImportDocuments.mjs; scripts/Browser-Documents-Test.mjs; scripts/Cleanup-ImportDocumentsQa.ps1.

## Verified local evidence

- Import API and whole-solution dotnet build: PASS, **0 errors/0 warnings**.
- EF Core PrivateDocumentsAndRequirements migration applied to wathiqa_import_dev on port 55432; pending-model check reported **no pending changes**. Old editor DB unaffected.
- Private document integration runner: **81/81 PASS with exit code 0**, live HTTP/PostgreSQL with two merchant accounts. Includes fake .exe-as-PDF rejection, incorrect MIME/extension, >25 MB file rejection, missing CSRF token, cross-tenant checks, one PDF to two Containers, B/L-specific cross-shipment/cross-Order prohibition, SHA duplicate detection, authenticated preview/download headers, Admin checklist states, waiver revocation including disable/re-enable, and direct-Order deletion protection. Durable local run log: .local/wp07-api-last-run.log.
- scripts/Browser-Documents-Test.mjs: **9/9 PASS**, including real browser multipart file selection, one B/L PDF to two Containers, per-B/L relink without a second upload, protected PDF GET, Admin checklist and mobile width. Screenshot .local/wathiqa-documents-pdf-preview.png visually confirms actual rendered PDF page after allowing enough time for browser's native viewer to initialize.
- Scripts/Test-ImportIsolation.ps1: **35/35 PASS**, including Admin-only required document policy and waiver/override actions.
- Next.js build and npm run lint: PASS after WP-07 UI; browser QA screenshots .local/wathiqa-documents-desktop.png and .local/wathiqa-documents-mobile.png reviewed.
- Complete local regression set after WP-07: **Orders API 25/25**, **Logistics API 42/42**, **Identity/Tenant/Staff authorization 35/35**, **Orders browser 9/9**, **Logistics browser 11/11**, **Import workspace browser 12/12**, **same-origin proxy 3/3**, **legacy editor API 13/13**, **legacy RTL 16/16**, **legacy editor browser 9/9**, **legacy advanced editor browser 8/8**, and **Documents API 81/81 + browser 9/9**. All these test runners returned exit code 0; **273 passing assertions across the suites**, counting checks rather than unique business journeys.
- Scripts/Cleanup-ImportDocumentsQa.ps1 uses dedicated QA IDs, both demo tenants and ONLY wathiqa_import_dev with explicit DB verification; cleans temporary DB fixtures and private QA blobs. Targeted QA cleanup has been applied and final dry-run found **0 matching document fixtures**; similarly **0 matching logistics fixtures** and 0 remaining browser-order QA. Real merchant files and old editor remain untouched.

## Accepted implementation shape and explicit release blockers

- Public production deployment is **BLOCKED**: no malware/AV scanner or safe quarantine on uploads yet. Magic bytes are a minimum, NOT proof of a clean or structurally valid PDF/JPG/PNG. Implement scanning and fail-closed status before public upload is allowed.
- Files on development Windows are stored beneath the current account's LocalApplicationData/Wathiqa/ImportPrivateFiles (outside repository). VPS MUST set Documents__PrivateRoot to a dedicated, private, persistent absolute mounted volume outside app and wwwroot. No root with filesystem default guessed in production.
- No tested backup/restore covering database + blobs + Data Protection keys yet. Add off-host backups and restore rehearsal before production. Missing blob read returns 503, not silent success.
- No physical purge/retention schedule was approved. Soft-deleted files remain on disk pending legal/business policy; do not mistake soft-delete for secure erase.
- No automatic malware cleaning, PDF OCR, extraction or LLM outsourcing; no user files sent to a third-party AI service.
- PaymentProof is currently only an Order-level attachment, NOT a record of a settled payment; WP-05 ledger and bank proof linkage do not exist.
- Document requirements are opt-in by tenant Admin. There is no global default missing-document policy. Stage-specific policy may need further merchant acceptance before production.
- Upload quotas, storage accounting, data retention, create idempotency, attachment-level fine-grained roles, and operational monitoring still need production hardening.
- The unauthenticated legacy editor still exists at the same frontend root; **do not expose the current combined site to the Internet** before an approved cutover/security isolation.
- P-02 (close/cancel unsettled Orders) and P-03 (confirmed transfer corrections) remain open Level 3 decisions. No financial/closure paths were invented or changed in this work.

## Reproduce on the user's development machine

From D:\Works\PrivateWorks\Hussam:

- Start import API: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ImportApi.ps1
- Start local app: powershell.exe -NoProfile -ExecutionPolicy Bypass -File start.ps1
- Browse http://localhost:3000/import/login -> Orders -> open an Order -> Documents.
- dotnet build Wathiqa.slnx --no-restore (stop running legacy and new APIs first if DLL is locked).
- powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Apply-ImportMigrations.ps1
- node scripts/Test-ImportDocuments.mjs
- node scripts/Browser-Documents-Test.mjs
- powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Cleanup-ImportDocumentsQa.ps1 (dry-run)
- powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Cleanup-ImportDocumentsQa.ps1 -Apply (ONLY generated local QA fixtures)
- cd frontend; npm run lint
- Stop web before building: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Build-ImportFrontend.ps1. Its gitignored .local/import-frontend-build-exit.txt must be 0 before claiming successful release build.

**No Git commit, push, public deployment, backup restoration or legacy cutover has been performed.**

## Reference basis

- Hussam source: docs/source/Wathiqa-MVP-Plan.md, section 7, plus approved docs/architecture/01-DECISIONS.md.
- OWASP file upload security: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- Microsoft ASP.NET Core upload considerations: https://learn.microsoft.com/en-us/aspnet/core/mvc/models/file-uploads
- MDN native PDF embedding: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#embedding_pdfs
