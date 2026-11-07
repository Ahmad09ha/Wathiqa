# WP-09 — Security, Private Upload Scanning and Restore Readiness

**Date:** 2026-11-07  
**Status:** Meaningful local security and restore slices verified; **VPS release BLOCKED**. No deployment, remote encrypted backup, actual real ClamAV signature scan, or merchant production acceptance was performed.  
**Branch:** `feature/import-management-mvp` (working tree contains prior uncommitted and untracked changes; nothing pushed).

## Tested local mechanisms

1. **Scanner and private upload:** `ClamAvUploadThreatScanner` invokes a configured absolute executable without shell expansion. The new `PrivateDocumentStore` writes a private random `.pending` file, checks size and header, scans **before** making the file visible, and removes pending/final orphans on scanner failure. Production rejects missing scanner configuration. `ScanStatus=Clean` is required for accepted Production reads/checklists.
2. **Production startup guards:** `ReverseProxy:KnownProxies`, persistent private document and Data Protection paths, a separate PFX with private key/password and a configured AV executable are required outside Development. Forwarded headers trust only explicit proxy IPs (one hop). Public API paths reject plain HTTP when not forwarded securely; `/api/health` is a restricted-health exception at the API layer and must remain private at the network boundary.
3. **Cookie keyring:** Production Data Protection files are encrypted using X.509. A negative test catches missing/invalid certificate; a positive test checks XML encryptedSecret, EncryptedData and EncryptedXmlDecryptor, following ASP.NET's actual key storage format. The script works on Windows PowerShell 5.1 and PowerShell 7.
4. **Production frontend cutover guard:** `frontend/src/proxy.ts` redirects `/` to `/import` and allows only the tenant import workspace/API, the new **separately authenticated** `/platform` SuperAdmin pages/API and required Next.js assets. Backend platform APIs return 401 without a SuperAdmin cookie. Old `/editor/...`, `/api/...` and legacy paths return a non-cacheable 404 in optimized Production Next.js; old source/database were **not deleted**. This guard protects Next.js ingress only. Do **not** expose the separate, unauthenticated legacy .NET API (`5088`) on VPS.
5. **Local restore rehearsal:** `Test-BackupRestore-Import.ps1` dumps the separate Import DB and private documents/DP key XML into disposable local staging and restores into random `wathiqa_restore_qa_*` DB. It validates every DB-referenced blob SHA-256 and the six WP-05 finance table row counts, with nonempty transfer/allocation/return/expense/audit fixtures. This is **local only**, not independent off-host disaster recovery.
6. **Prepared VPS scripts and container bundle:** `deploy/import/compose.yml` uses separate `web`, `api`, private PostgreSQL 18, ClamAV signature updater and operator-only backup. `scripts/vps/backup-import.sh` archives encrypted off-host DB, documents, DP keys **and the matching PFX certificate** via restic. `restore-rehearsal.sh` checks a separately recovered PFX password and decrypts the recovered key. These scripts have **not** run in actual VPS Docker or independently recovered off-host storage.

## Reproducible verification (2026-11-07)

| Verification | Observed result | Scope |
|---|---|---|
| `scripts/Test-ScannerPipeline.ps1` | **17/17 PASS**, `WP09_SCANNER_EXIT_CONTRACT=PASS`, QA cleanup PASS | Fake scanner implementing clamscan exit 0/1/2; proves integration/fail-closed behavior, **not real malware detection** |
| `scripts/Test-ProductionGuards.ps1` | **9 production guard assertions PASS**, `WP09_PRODUCTION_SECURITY_GUARDS=PASS` | Isolated port 5097, disposable PFX, HTTPS proxy behavior and X.509 key encryption |
| `scripts/Test-BackupRestore-Import.ps1` | `WP09_BACKUP_RESTORE_REHEARSAL=PASS` | Local random DB with equal source/restore counts for all finance, operator and subscription tables; 8/8 DB-referenced blobs SHA-256 verified and 1 DP key XML. Actual separate PFX/session decryption still required on staging |
| `scripts/Test-ImportPublicSurface.mjs` | **18/18 PASS**, optimized Next.js Production build | Public root, merchant/platform login and manual plan/subscription routes, platform and tenant API 401, legacy editor/API 404, static assets and old Next data route guard |
| `scripts/Test-PlatformSuperAdmin.mjs` / `scripts/Browser-PlatformSuperAdmin-Test.mjs` | **76/76 authenticated platform API + 16/16 real-browser PASS** | Independent SuperAdmin Identity, tenant boundaries, CSRF, plan lifecycle, concurrent manual renewal, immediate access revocation, audit and mobile RTL |
| `scripts/Test-BackupRestore-Import.ps1` after PA-01/PA-02 fixtures | `PA01_PLATFORM_OPERATOR_AND_AUDIT_RESTORE=VERIFIED`; `PA02_MANUAL_SUBSCRIPTIONS_RESTORE=VERIFIED` | Independent restored database verified 1 platform operator, audited changes, 2 QA plans and 1 QA subscription alongside merchant finance and private documents; fixtures were safely cleaned afterwards |
| `scripts/Test-ImportOperations.mjs` / browser | **70/70 API, 8/8 browser PASS** | Current WP-08 non-financial journeys, WP-03 profile/search/paging guards and tenant isolation; see WP-08-PROGRESS |
| Frontend build / TypeScript | `.local/import-frontend-build-exit.txt` = `0` and `npm run lint` PASS | Upgraded and pinned Next.js **16.4.5**, optimized Production build includes import-only Proxy |
| API release build | `dotnet build ... -c Release --no-restore` PASS | .NET 10, 0 warnings/0 errors |
| Dependencies | npm production audit 0; NuGet vulnerable list none | Current feed scan, not a guarantee against unknown threats |
| Container bundle validation | `bash -n` + `deploy/import/validate-compose-structure.sh` PASS | Static YAML/boundaries only; **Docker unavailable on Windows, images NOT built/booted** |

The active workspace has locally running services; no production data, old editor database, or remote host was modified. The temporary `WP07_QA_*` test records were removed using only guarded cleanup scripts.

## Explicit blockers for real VPS release

- Configure and test **real, updated ClamAV** (`clamscan`, virus-definition updates and actual EICAR test under a controlled environment) instead of the simulated exit-code process. Scanner timeout/error must fail closed under Linux container permissions and volume mounts.
- Deploy **only** the new authenticated Import API and import-only frontend. Ensure the legacy backend isn't publicly mapped, old editor routes stay blocked, database port is internal, and loopback/test ports are never internet-exposed.
- Wire `IMPORT_API_INTERNAL_URL` at the correct **Next.js build/configuration** phase to the internal Import API destination. The current localhost fallback is for Windows development, **not** a valid cross-container VPS address. Verify same-origin cookies/CSRF end to end over real HTTPS.
- Mount durable private document storage, Data Protection key directory, protected certificate and protected secret material in Dokploy; lock down permissions; test an actual restart with uninterrupted authenticated sessions and document previews.
- Initialize encrypted **off-host** restic repository, schedule backups with alerting/retention, then restore a real snapshot into an **independent staging environment** and verify actual database, documents and usable encrypted keys. One local filesystem restore is not a VPS disaster recovery proof.
- The encrypted ASP.NET key ring **also depends on its X.509 PFX**. The prepared restic script now archives the PFX along with key XML, but deliberately **does not** archive its recovery password in the same restic snapshot. Store that password in a separately recoverable protected secret manager, rehearse PFX decryption and test cookie continuity in independent staging.
- Confirm migrations, seed-account secrets, **SuperAdmin MFA/owner recovery**, platform vs tenant cookie isolation, access expiry, CSRF, auth rate limiting, concurrent writes, and CI on exact deployable image. A security/incident plan, monitoring and pilot acceptance are still needed.
- Financial WP-05 ledger and P-02/B / P-03/A behavior are locally implemented/verified (91 API + 7 browser). Their **real bank verification, production integration and full five-order WP-10 merchant acceptance are not complete**. The system must not be presented as ready for publication merely because local tests pass.

## Sources used to challenge assumptions

- [Microsoft — ASP.NET Core Data Protection key storage format](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/implementation/key-storage-format?view=aspnetcore-10.0): encryptedSecret stores a decryptor type; X.509 typically records `EncryptedXmlDecryptor`, not the encryptor class name.
- [Microsoft — Key encryption at rest](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/implementation/key-encryption-at-rest?view=aspnetcore-10.0): explicit key persistence needs explicit encryption for Production.
- [Next.js 16 — Proxy file convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy): Production request gate is server-side, but never substitutes for backend authorization.
- [OWASP — File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): validated extension/MIME/header plus AV scanning and private storage are defense in depth, not a proof that every accepted file is harmless.

**Final status for this WP:** `PARTIALLY VERIFIED / RELEASE BLOCKED`. Do not push/deploy based on this document alone.
