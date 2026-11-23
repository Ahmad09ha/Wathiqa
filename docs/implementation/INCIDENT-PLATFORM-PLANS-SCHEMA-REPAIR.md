# Incident: Platform plans fail to load after ShipsGo schema release

## Symptom and current verification

- Public URL: `https://wathiqa.engtexyarn.com/platform/plans`.
- The browser reports "تعذّر تحميل الباقات" and shows the generic server-error message.
- On 2026-11-14, unauthenticated public checks returned HTTP 200 for `/import-api/api/health` and HTTP 401 for `/import-api/api/platform/plans` (expected without SuperAdmin session). These do **not** test the authenticated SELECT or prove database migration status.
- The source query in `ManualSubscriptionsApi.ListPlans` selects `PlatformSubscriptionPlans.MaxTrackedBills` introduced by EF migration `20261112103205_ShipsGoTrackingPlansAndUsage`.
- At the time of the incident, API startup did not run `db.Database.MigrateAsync()`. This was superseded by automatic migrations on non-Development API startup; see `deploy/import/RELEASE-RUNBOOK.md`.
- **Leading hypothesis:** the production PostgreSQL schema is older than the deployed API and lacks the new column. A definitive diagnosis requires privileged database migration history or server exception logs, neither of which is available through the currently connected Rider workspace. Do not mistake public API health for schema readiness.

## Application fix

- `GET /api/platform/plans` now returns a meaningful HTTP 503 with `error: platform_schema_upgrade_required` **only** when PostgreSQL reports undefined column `MaxTrackedBills`. Other exceptions still surface as server failures rather than being hidden.
- The Arabic plans screen shows the actionable error and a retry control. It does **not** display "no plans yet" following a failed request.
- `ImportSchemaCli` introduces two separate operator-only CLI commands. Neither is an HTTP endpoint, and neither seeds merchants, edits subscriptions or rotates a SuperAdmin password:
  - `--import-schema-status`: read-only list of pending migrations plus presence check for `MaxTrackedBills`.
  - `--migrate-import-schema`: applies EF migrations with explicit target database acknowledgement and production-backup acknowledgement. Current production API startup also auto-applies pending migrations.
- Production schema maintenance is restricted to `wathiqa_import`; development maintenance is restricted to a local `wathiqa_import_dev` connection. The command refuses the legacy editor databases.

## Historical manual remediation on the existing Dokploy stack

Current default: ordinary API deployment auto-applies pending migrations before accepting HTTP traffic. The manual steps below remain an explicit opt-out and incident recovery alternative.

The following must be performed **on the VPS or Dokploy host**, using the **same Compose project, PostgreSQL volume, and API image** as the running production instance. Never create a second stack and never run commands against a local dev database when repairing production.

1. Confirm the currently running API's deployment revision and inspect its logs for PostgreSQL error `42703` or `column ... MaxTrackedBills does not exist`. If another error is present, investigate that instead.
2. Create and verify a restorable database backup/snapshot (independent production recovery gate). Do not overwrite or clear the persistent PostgreSQL volume.
3. Deploy the updated API image **without deleting, resetting, or reseeding any accounts**. Use the matching repository release and Compose project.
4. In the existing Dokploy Compose project directory and with the correct project name/env file, run the read-only schema command:

   ```bash
   docker compose --env-file deploy/import/.env -f deploy/import/compose.yml \
     -p YOUR_EXISTING_DOKPLOY_COMPOSE_PROJECT run --rm --no-deps api --import-schema-status
   ```

   Verify the target database is exactly `wathiqa_import`. If the expected migration is pending, verify that **all** other pending migration IDs are understood and safe to apply in deployment order.
5. **Only after a verified backup and explicit review** of pending migrations, run:

   ```bash
   docker compose --env-file deploy/import/.env -f deploy/import/compose.yml \
     -p YOUR_EXISTING_DOKPLOY_COMPOSE_PROJECT run --rm --no-deps \
     -e WATHIQA_MIGRATION_TARGET_DB=wathiqa_import \
     -e WATHIQA_MIGRATION_BACKUP_VERIFIED=yes \
     api --migrate-import-schema
   ```

   Never substitute `--seed-superadmin` / `--seed-access-accounts` for schema maintenance. Do not modify secrets, user roles, subscription rows, or existing passwords.
6. Run `--import-schema-status` again, ensure `IMPORT_PENDING_MIGRATION_COUNT=0` and `IMPORT_TRACKING_PLAN_COLUMN_PRESENT=True`. Restart only the API service if required to activate the new revision, without changing DB volumes or Data Protection keys.
7. With a SuperAdmin session, refresh `/platform/plans`: it must load an empty list with no error if no plans exist, or show existing plans and limits if any exist. Test creating a harmless plan only if a business-approved QA plan/cleanup procedure is available. Check adjacent `/platform/subscriptions` and merchant dashboard.

### If the CLI is not yet deployed

The new commands do not exist in older images. Do not run them against an image that is still on the previous revision. Redeploy the API code in the reviewed release, then follow the steps above. A one-off EF migration can alternatively be executed by an experienced operator using a matching tooling image and verified production backup; **never** manually add just the one PostgreSQL column, because that would desynchronize EF's migration history and omit the tracking usage tables/cycle metadata.

## Evidence and limitations

- This repository task cannot prove the live error is `42703` without production logs or authenticated SQL access. Fixing source control does not apply the migration to the VPS.
- The CLI targets only Import and avoids seeding. The flow is idempotent when no migrations are pending.
- The production operation must be performed by an authorized VPS/Dokploy operator. Don't mark incident resolved until the actual signed-in plans request succeeds on the live domain.

## Verified in isolated local development (2026-11-14)

- Read-only schema CLI reported `IMPORT_PENDING_MIGRATION_COUNT=0` and `IMPORT_TRACKING_PLAN_COLUMN_PRESENT=True` against `wathiqa_import_dev`.
- Migration CLI without an explicit target refused with process exit code **2**. With `WATHIQA_MIGRATION_TARGET_DB=wathiqa_import_dev` it completed successfully as `IMPORT_SCHEMA_MIGRATION_NOOP=true`, without creating accounts or modifying schema.
- .NET 10 Import API build completed with 0 errors and 0 warnings; TypeScript check passed; Next.js optimized build compiled and generated `/platform/plans`.
- `node scripts/Test-PlatformSuperAdmin.mjs` passed **76/76** authenticated tenant/platform/subscription regressions, and its tagged merchant/plan fixtures were removed by guarded cleanup.
- The public production health check alone cannot verify the plans SELECT. No live VPS DB migration has been executed by this work.
