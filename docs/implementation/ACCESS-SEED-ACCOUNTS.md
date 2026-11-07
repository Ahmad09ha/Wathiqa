# Wathiqa — 3-Month Trial + Unlimited Admin Seed (Local and VPS)

**Implementation status:** Implemented and tested locally on .NET 10 + Identity + PostgreSQL.
**Production status:** Ready for *controlled provisioning* of a new ImportDatabase when deployed; no VPS deployment or production database write has happened here.
**Scope:** Two independent Tenant workspaces, each with one Admin. This is intentionally not a global backdoor or a hard-coded username/password pair.

## What is created

| Tenant slug | Who | Role | Access window |
|---|---|---|---|
| trial-access | Email supplied via WATHIQA_TRIAL_EMAIL | Admin | Exactly 3 **calendar** months from the tenant's initial creation timestamp (UTC); persisted in PostgreSQL |
| unlimited-access | Email supplied via WATHIQA_UNLIMITED_EMAIL | Admin | No automatic account/subscription expiration: AccessExpiresAtUtc = NULL |

These accounts have separate TenantIds and cannot view each other's records.
Other existing tenants and legacy documents remain unaffected.
"Unlimited" does **not** override passwords, manual suspension, security policy or the normal 8-hour web session lifetime. It only means the tenant's entitlement does not have a date limit.

### Trial enforcement

- Tenant.AccessExpiresAtUtc is a nullable timestamp with time zone, added through migration TenantAccessExpiration.
- The trial is created as UtcNow.AddMonths(3) **only once** in the tenant creation transaction.
- On existing tenant re-seed: verify matching admin/entitlement type; NEVER change password, tenant ID or expiration. If an unrelated account occupies the reserved slug/email, fail loudly rather than overwriting.
- Correct credentials for an expired trial return HTTP 403 + account_expired (Arabic localized login toast); incorrect passwords continue to return 401 without account enumeration.
- Every authenticated request validates the user's Identity security stamp and then tenant+user live state/entitlement; expired existing cookies are rejected immediately. TenantMember/TenantAdmin/CanManagePayments policies also recheck tenant expiration.
- A pending staff invitation cannot be accepted after the tenant expires.
- No background job or scheduler needed for closing accounts: the server compares UTC now with saved expiry on each relevant authentication/authorization operation.

## Local developer seed (already applied)

Working directory: D:\Works\PrivateWorks\Hussam

1. Stop Import API before rebuilding: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Stop-ImportApi.ps1
2. Build .NET 10 import API: dotnet build backend/Wathiqa.ImportApi/Wathiqa.ImportApi.csproj
3. Apply migrations: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Apply-ImportMigrations.ps1
4. Seed/re-run safely: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Seed-ImportAccessAccounts.ps1
5. Start API: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ImportApi.ps1
6. Browser login: http://localhost:3000/import/login

Local emails:
- trial-admin@wathiqa.invalid
- unlimited-admin@wathiqa.invalid

The local seed script generates cryptographically random, distinct strong passwords once and saves them **only** in the gitignored local file:
D:\Works\PrivateWorks\Hussam\.local\import-access-accounts.json

Open the local file in Rider/Windows Explorer to retrieve the passwords. Do not add the file to Git or paste production credentials into documentation/CI logs.

## VPS / Dokploy provisioning (when the user deploys)

The code and EF migration ship with the Git branch, but **pushing code alone does not populate an unrelated VPS database**. Provision the new VPS ImportDatabase with these environment variables / deployment secrets:

| Deployment env var | Value |
|---|---|
| ConnectionStrings__ImportDatabase | VPS PostgreSQL connection string to the NEW Import Database (not the legacy template DB) |
| ASPNETCORE_ENVIRONMENT | Production |
| WATHIQA_SEED_ACCESS_ACCOUNTS | true (enable for first start only) |
| WATHIQA_TRIAL_EMAIL | The desired real trial administrator email |
| WATHIQA_TRIAL_PASSWORD | A unique strong production secret (minimum existing Identity password rules) |
| WATHIQA_UNLIMITED_EMAIL | The desired real permanent administrator email, distinct from trial |
| WATHIQA_UNLIMITED_PASSWORD | A DIFFERENT strong production secret |
| Documents__PrivateRoot | Persistent absolute non-public path for WP-07; required in Production for file operations |

1. Set these variables in the VPS **Import API service**, using secret management / Dokploy secrets where supported. Do NOT put production passwords in source control, a Docker image or a public .env file.
2. Start the Import API with the code from this branch. **Only while WATHIQA_SEED_ACCESS_ACCOUNTS=true**, startup runs EF Migrate() on the configured ImportDatabase, then upserts exactly two reserved accounts using ASP.NET Core Identity password hashes, dedicated tenant rows and Admin roles.
3. Confirm startup shows SEED_ACCESS_CREATED=trial-access, SEED_ACCESS_CREATED=unlimited-access, then SEED_ACCESS_COMPLETE=2 (no passwords logged). Test both sign-ins over HTTPS, check /api/auth/me and AccessExpiresAtUtc.
4. For subsequent restarts **unset WATHIQA_SEED_ACCESS_ACCOUNTS** and remove bootstrap password secrets from the running configuration. The database rows persist on a properly persistent PostgreSQL volume. The trial countdown continues from the original creation time, NOT from each deployment.
5. If the seed flag must be re-enabled later: use the same email values for the same reserved tenants. Seeder detects existing accounts and does not replace their password hashes or expiration. A collision or changed email fails rather than silently modifying identities.
6. If you prefer a one-time deployment job, with the same four account credential env vars plus the DB connection, run: dotnet Wathiqa.ImportApi.dll --seed-access-accounts . This exits after seeding and does not start the HTTP server; then start the Import API normally without the seed flag.

**Important:** A clean VPS database creates fresh seed accounts with **independent production credentials**, not the local .local passwords. If a full local ImportDatabase SQL dump is deliberately migrated to VPS, it carries existing account hashes and original expiration dates. Never use trial/dev credentials as production credentials.

### VPS acceptance

SQL inspection (as an authorized DB operator; do not expose credentials):
SELECT "Slug", "CreatedAtUtc", "AccessExpiresAtUtc" FROM "Tenants"
WHERE "Slug" IN ('trial-access','unlimited-access');

Trial expiry must be populated; unlimited expiry must be NULL.
Test cross-tenant ID access returns 404 and expired login/old cookie cannot use protected endpoints.
Production HTTPS/secure cookies, restricted DB permissions, backups/restore, upload malware scanning and legacy editor retirement are **separate release blockers**; this seed is not proof that the whole site is ready for public Internet.

## Local verification

- C# build and EF migration applied to isolated wathiqa_import_dev.
- Second seed invocation reports SEED_ACCESS_EXISTS (no reset).
- node scripts/Test-ImportAccessAccounts.mjs : tests trial+permanent login, own TenantIds, persisted expiry, authenticated profile, protected data, expired login with correct/wrong password, cookie invalidation after simulated expiry, permanent unaffected, exact restore of the trial deadline. The script directly mutates ONLY local wathiqa_import_dev in a guarded SQL execution; do not run against production.
- Browser UI shows "تجريبي · ينتهي ..." or "حساب دائم · بدون انتهاء" in the tenant sidebar.
- Existing Role/Staff/CSRF/Tenant and other module tests must remain green.

### Verification record — 2026-11-07

- Real local DB values after creation: `trial-access` created at **2026-11-07 02:55:52 +03**, persisted expiry **2027-02-07 02:55:52 +03**; `unlimited-access.AccessExpiresAtUtc` is PostgreSQL `NULL`. Date in the Arabic UI is formatted in the **browser's local timezone**, tooltip includes time; the backend compares absolute UTC instants.
- `Seed-ImportAccessAccounts.ps1` executed successfully, then safely repeated: `SEED_ACCESS_EXISTS` for both tenants, without changing the original trial cutoff or password hashes.
- `Test-AccessSeed-AutoStartup.ps1`: PASS for opt-in automatic initialization on a separate test port; both existing tenants reused, server health OK. No VPS used.
- `Test-ImportAccessAccounts.mjs`: **18/18 PASS**, including expiring an **already signed-in** cookie, new expired login rejection, bad-password privacy, unaffected unlimited session, and exact trial timestamp restoration.
- `Browser-AccessSeed-Test.mjs`: **4/4 PASS** with actual seeded passwords supplied from gitignored local file; confirmed expiry/permanent labels in sidebar and no mobile overflow. Screenshots: `.local/wathiqa-access-trial.png` and `.local/wathiqa-access-unlimited.png`.
- Existing identity permission regression: **35/35 PASS**. Deliberate compatibility check: a manually disabled Staff account still gets **403** from its existing permission policy, whereas an expired subscription invalidates an existing session and yields **401**.
- Other regressions after adding expiry: **Orders API 25/25**, **Logistics API 42/42**, **Documents API 81/81**, **Import browser 12/12**. QA documents/logistics/order fixtures were cleaned with only the repository's guarded local QA cleanup scripts.
- `dotnet build Wathiqa.slnx`: 0 errors, 0 warnings; EF reports no pending model changes after TenantAccessExpiration migration. `npm run lint` and optimized `npm run build`: both PASS. `git check-ignore .local/import-access-accounts.json`: verified secret file excluded.

**Scope caveat:** This guarantees safe automatic provisioning **when the VPS environment flag and four secret values are configured**; uploading/pushing source files alone does NOT create accounts in a different external database. A real VPS deployment/provisioning has not been performed.

## Decisions and limits

- This is **tenant-level** expiration rather than Admin-user-only expiration, so Staff invited under the trial tenant cannot continue using it after the trial expires.
- No self-service upgrade, payment/subscription engine, billing, license management or unbounded account reset endpoint is created.
- Account expiration by 3 calendar months is the requested business policy; an owner-controlled future upgrade/extension operation would be a separate audited feature.
- No automatic clock sync logic: the VPS should maintain correct UTC system time.
- No admin password visible over an API. Local secrets file is ignored and production secrets must be injected securely.
