# وثيقة | Wathiqa — Verification and release assessment — 2026-11-05

## Status

**LOCAL MVP RUNNING AND TESTED; NOT PRODUCTION READY.**

### Build
- .NET 9 API: **PASS**, 0 errors and 0 warnings after package restore and starter-node repair.
- TypeScript: **PASS** (`npm run lint` runs `tsc --noEmit`).
- Next.js 16.4.2 optimized production build: **PASS** after removing a generated Tailwind Turbopack loader that was not used.

### Runtime
- Dedicated PostgreSQL 18 instance created under `.local/pgdata`, bound to 127.0.0.1:55432: **PASS**.
- Backend http://127.0.0.1:5088/api/health: **PASS**.
- Two starter template records persisted in PostgreSQL: **PASS**.
- Frontend http://localhost:3000: **PASS**, HTTP 200, browser hydration reads API.
- CORS from http://localhost:3000 to the API: **PASS**.

### Integration tests
- `scripts/Smoke-Test.ps1`: **13/13 PASS**:
  health, starter templates, template create, template edit/reload, independent document create,
  revisioned save, isolation from source template, stale HTTP 409 rejection,
  XLSX ZIP signature, XLSX worksheet presence, XLSX reimport, persisted editable JSON, cleanup.
- `scripts/Import-Smoke-Test.ps1`: **2/2 PASS**:
  generated text PDF → field label extraction → DB; generated minimal DOCX → extraction → DB.
- `scripts/Browser-Smoke-Test.mjs`: **9/9 PASS** using headless Chrome CDP:
  gallery hydration, two template cards, copy via Use button, rich content load,
  keyboard editing/dirty state, Save persistence/source isolation, insert table + save,
  reopen saved edit.
- `scripts/Persistence-Smoke-Test.ps1`: **1/1 PASS**:
  persisted document is still present with the same revision after stopping and restarting the API.
- `scripts/Edge-Smoke-Test.ps1`: **8/8 PASS**: invalid extension, corrupt file,
  zero bytes, upload over 10MB, blank name, invalid content schema, retained documents after
  template deletion, export of retained documents.
- `scripts/Browser-Advanced-Test.mjs`: **8/8 PASS**: blank template creation and editing
  from the browser, independent copy, saved-document listing, PDF import through file picker,
  block reordering, table row and column addition.
- `scripts/Excel-Content-Test.ps1`: **3/3 PASS**: exported workbook contains contract text,
  Chinese Unicode strings and separate spreadsheet table columns through column F.
- `scripts/Bilingual-Pdf-Test.ps1`: **3/3 PASS**: Chrome-generated PDF fixture preserves
  Chinese and English label text, with example field values removed.

- `scripts/Browser-Arabic-UX-Test.mjs`: **16/16 PASS**: Wathiqa brand/browser title and favicon, Arabic lang/RTL, fixed sidebar
  on the right during long-page scrolling, Lenis root and anchors, Arabic animated error
  toast and close, Arabic deletion dialog, card button containment, and mobile drawer.

**Total: 63/63 checks passed** on the local development setup. The aggregate
`scripts/Run-Smoke-Tests.ps1` runs these groups sequentially.

**Cold restart: PASS.** `stop.ps1 -StopDatabase` stopped the dedicated database and
both application processes. `start.ps1` started the three services again;
`/api/health` returned `{"status":"ok","database":"connected"}` and the
frontend returned HTTP 200.

### Defects found and fixed
1. NuGet/npm package fetching and cached registry metadata; restored packages and locked dependencies.
2. Generated frontend config referenced missing `@tailwindcss/turbopack`; removed unused loader.
3. Starter template contained empty Tiptap text nodes (invalid ProseMirror JSON); fixed seed generation,
   normalized imported/saved content, repaired existing starter records without replacing their other content.
4. Template export now places table cells in spreadsheet columns instead of flattening them into one cell.
5. Sidebar navigation links corrected to scroll to Templates / Documents sections.
6. Removed insecure hard-coded database connection fallback; startup now requires configured local credentials.
7. Startup checks now identify occupied ports and verify both services respond successfully;
   database health reflects actual database connectivity.
8. Introduced a native Arabic/RTL visual system, right-side viewport-fixed sidebar,
   official Lenis React integration, Arabic error messages and animated toast feedback,
   and a confirmation dialog that replaces the browser's native delete prompt.
9. Renamed the product to Wathiqa (وثيقة): solution/project/namespace, frontend package,
   browser metadata, sidebar identity, icon and repository setup. Preserved the existing
   PostgreSQL data, role and database names for backward compatibility.

## Open risks and future work
- No sign-in / roles / tenant boundary; never expose on public network.
- No EF Core migrations/production secrets management.
- PDF/DOCX import uses heuristic labels and loses original formatting; scanned PDFs require OCR.
- Export is structured XLSX content, not a pixel-identical contract.
- No comprehensive visual regression across screen sizes.
- No automated tests against the two original uploaded SEDAR PDFs; only generated PDF/DOCX fixtures were imported.
- No security or load test, no production deployment.

## Re-run sequence

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
dotnet build backend/Hussam.Api/Hussam.Api.csproj --no-restore
cd frontend; npm run lint; npm run build; cd ..
powershell -ExecutionPolicy Bypass -File .\scripts\Smoke-Test.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\Import-Smoke-Test.ps1
node .\scripts\Browser-Smoke-Test.mjs
powershell -ExecutionPolicy Bypass -File .\scripts\Persistence-Smoke-Test.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\Edge-Smoke-Test.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\Excel-Content-Test.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\Bilingual-Pdf-Test.ps1
node .\scripts\Browser-Advanced-Test.mjs
```

Or run all groups with `powershell -ExecutionPolicy Bypass -File .\scripts\Run-Smoke-Tests.ps1`.

The local database credentials are private and excluded from source control.
