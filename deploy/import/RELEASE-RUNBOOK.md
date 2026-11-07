# Wathiqa Import — Dokploy Release Runbook

**Status:** PREPARED FOR STAGING. Production GO is **BLOCKED** until every live gate below is verified. The old root `docker-compose.yml` serves the legacy editor; **do not deploy it**.

## Approved stack
- `deploy/import/compose.yml`: `web` is the **only** Dokploy HTTPS-routed service (port 3000); `api` and PostgreSQL 18 are private. No old unauthenticated editor backend.
- `web`: Next.js 16.4.5 and import-only production Proxy. `api`: .NET 10, private Documents, X.509-encrypted persistent Data Protection keys, trusted proxy `WATHIQA_WEB_IP` only.
- ClamAV definitions update in separate container and mount read-only into API `clamscan`. `backup` is one-shot `ops` job: remote restic snapshot of PostgreSQL+private blobs+DP XML+matching PFX.

## Preflight on VPS (secrets stay OUTSIDE repository)
1. Install Dokploy and confirm `dokploy-network`. Select `WATHIQA_PRIVATE_SUBNET` that **does not overlap** Docker/VPN/VPS networks; reserve unique `WATHIQA_WEB_IP` in it. Never wildcard trusted forwarded proxies.
2. Copy `deploy/import/.env.example` to gitignored `deploy/import/.env` on VPS. Set real non-overlapping subnet, static web IP, off-host `RESTIC_REPOSITORY`, absolute `WATHIQA_PRIVATE_ROOT`, `WATHIQA_SECRETS_ROOT`.
3. Pre-create private `documents`, `keys`, `backup_tmp` subfolders. The API runs as UID/GID 1654; only that UID may read/write documents and keys. Secrets root: owner-only directory 0700 and files 0600.
4. Secret files: `import_db_password`, `import_dp_certificate.pfx`, `import_dp_password`, `import_restic_password`, `import_trial_email`, `import_trial_password`, `import_unlimited_email`, `import_unlimited_password`, **`import_superadmin_email`, `import_superadmin_password`**, `import_s3_access_key`, `import_s3_secret_key`. Choose independent high-entropy secrets; DB password >=24 URL-safe chars (A-Z,a-z,0-9,._~-), SuperAdmin password >=16 chars with upper/lower/digit/special. **Never** reuse development/demo accounts or put secret files in git.
5. Preserve PFX private key/password separately. Restic archives PFX, but NOT its password. Without both XML keys + decryptable PFX, session recovery is not proven. Decide actual off-host S3-compatible bucket, backup schedule, retention and alerts.
6. Run `bash deploy/import/release-preflight.sh`, then `docker compose --env-file deploy/import/.env -f deploy/import/compose.yml --profile ops config --quiet`. These are static checks; inspect resulting internal/public port exposure. The Windows developer currently has no Docker, so **actual image build remains a staging gate**.

## Staging execution
1. Run `docker compose --env-file deploy/import/.env -f deploy/import/compose.yml build --pull`.
2. Start `postgres` and `clamav-signatures`. Confirm PG health, signatures actually updated and private mounts persist.
3. Perform one-shot `docker compose --env-file deploy/import/.env -f deploy/import/compose.yml run --rm api --seed-access-accounts`. This applies Import migrations and creates the trial (three months) and unlimited **merchant Admin** tenants from secret files. Then perform a separate **one-shot** `docker compose --env-file deploy/import/.env -f deploy/import/compose.yml run --rm api --seed-superadmin` using different, protected credentials to create the **platform-only `SuperAdmin`**. Repeated seed MUST NOT reset either password or entitlement; confirm database name `wathiqa_import` (NOT legacy database). Never create platform credentials via public registration or insert them into a merchant `Admin` role.
4. Bring up `api` and `web`; bind ONLY `web` to Dokploy HTTPS domain, internal port 3000. Check Traefik HTTPS -> Next.js -> internal API; if `https_required`, correct the actual forwarded-proxy chain, **never disable HTTPS enforcement**. `/import/login` and `/platform/login` have distinct authentication cookies and privileges.
5. Execute `WATHIQA_PUBLIC_BASE_URL=https://real-domain bash deploy/import/smoke-public.sh`: both login pages 200, unauthenticated finance and platform management 401, old editor/API 404, Secure cookies. Then verify tenant and platform signed-in sessions remain isolated, CSRF, Staff permissions, restarts and persistence.
6. Validate `clamscan` on staging using the harmless EICAR test signature; check rejection of infected input, acceptance of clean PDF, and fail-closed errors. Simulated Windows scanner tests do NOT count.
7. Initialize encrypted restic **only once** if repository is empty; then manually run `docker compose --env-file deploy/import/.env -f deploy/import/compose.yml --profile ops run --rm backup`. Schedule backups and alerts; no automatic retention/pruning is configured. Check remote snapshot visibility.
8. On an **independent staging host**, run `scripts/vps/restore-rehearsal.sh` with explicit snapshot ID/acknowledgment, protected PFX recovery password, staging PostgreSQL credentials, and original backup path values for source location verification. Check restored DB, all document SHA-256, XML keys, decryptable PFX; start a restored staging API to prove protected cookie continuity.
9. Run 5 anonymized REAL import orders against staging and answer the agreed five business questions (supplier balances by currency, delivered-unpaid, at-sea containers, missing B/L/docs, customs status). Also verify SuperAdmin cannot open any merchant bank evidence or Orders, and tenant Admin cannot reach platform routes. Obtain owner/merchant acceptance, monitoring alerts, **independent platform owner credential recovery/rotation procedure**, rollback/forward-fix procedure and release commit SHA before any live production launch.

## Invariants and stop rules
- Never transfer the 5,000 overpayment to a different Order. Approved P-03/A = audited void and linked replacement; real return = separate event. Approved P-02/B = Admin exception close with outstanding money still visible.
- Never blindly downgrade the WP-05 ledger migration; that risks losing payment history. Never restore an older database over a live DB that has accepted newer transfers.
- If ClamAV, persistent keys, real HTTPS, encrypted off-host recovery, or merchant pilot fails, **NO-GO**. Do not publish because local API/browser tests are green.
