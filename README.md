# وثيقة | Wathiqa — Document Template Studio

**وثيقة** (Wathiqa) is a local-first Arabic document-template workspace: import files, build reusable templates, create independent editable documents and export structured Excel files.

**Stack:** .NET 9 Minimal API · EF Core 9 · PostgreSQL 18 · Next.js 16.4.2 · React 19 · Tiptap 3.32 · Lenis 1.3 · ClosedXML.

## Open the working app

- **Frontend:** http://localhost:3000
- **Backend and database health:** http://127.0.0.1:5088/api/health
- **PostgreSQL:** 127.0.0.1:55432, project-owned local cluster. New installations create `wathiqa_docs` / `wathiqa_dev`; existing installations keep their earlier database/account and records intact.

Both app processes have been launched on the user's development machine. To restart after reboot or manually:

```powershell
cd D:\Works\PrivateWorks\Hussam
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

This starts the project-specific PostgreSQL cluster (if needed), .NET API and the built Next.js frontend. To stop them, use `.\stop.ps1` (pass `-StopDatabase` if you also want to stop the dedicated local PostgreSQL server).

The original Windows working-folder name is intentionally unchanged for Rider compatibility; project, solution, UI, npm package and GitHub repository identity are now **Wathiqa**. The existing local database is preserved to avoid losing previous templates/documents.

**Do not use Docker Compose and the local PostgreSQL initializer simultaneously** unless you intentionally configure different database ports. The successful local setup uses the Windows PostgreSQL 18 installation on port 55432.

## First-time dependency setup

- .NET 9 SDK, Node.js 22+, npm, PostgreSQL 18 Windows binaries
- From project root: `dotnet restore Wathiqa.slnx`
- Then: `dotnet build Wathiqa.slnx`
- From `frontend`: `npm ci` followed by `npm run build`

The local initializer creates a dedicated database directory under `.local/pgdata` and a randomly generated credential in `.local/pg-password.txt`, both excluded by `.gitignore`. Do not share this local secret. App connection settings are passed to the API process in its environment by `scripts/Start-Backend.ps1`.

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

- **No authentication or user/tenant authorization.** Run on localhost only. Do not expose the API to public Internet or add confidential customer contracts before implementing account isolation and access control.
- **Imported PDF/DOCX layout is not recreated faithfully.** Label extraction is heuristic, may omit legal clauses or table grid structure, and scanned PDFs need a separate OCR service.
- **Excel export is content-to-worksheet, not pixel-perfect reconstruction** of the imported PDF or a replacement for a Word/PDF contract preview.
- Two built-in templates are editable starter structures with placeholders. They are **not verbatim legally approved copies** of the original SEDAR contracts; verify the final legal terms against the PDFs.
- Development EF Core setup uses `EnsureCreated`, not migrations. A migration plan is required before production releases.
- No audit history, account ownership, malware scanning, or production deployment/monitoring is implemented.
- No automatic autosave; click Save explicitly. Concurrency protection applies to document revisions, not simultaneous edits to templates.
- Actual user-uploaded contract PDFs have **not yet been run through the import endpoint** in this session; the validated import fixtures were generated PDF/DOCX files.

## Source map

- `backend/Hussam.Api/Program.cs` — APIs and file import/export
- `backend/Hussam.Api/Models.cs` — EF Core tables
- `backend/Hussam.Api/ContentTools.cs` — Tiptap JSON normalization and extraction
- `backend/Hussam.Api/Seed.cs` — starter template data
- `frontend/src/app/page.tsx` — workspace
- `frontend/src/app/editor/[kind]/[id]/page.tsx` — document/template editing
- `frontend/src/components/DocumentEditor.tsx` — Tiptap controls
- `scripts/` — local startup and integration/browser smoke tests
