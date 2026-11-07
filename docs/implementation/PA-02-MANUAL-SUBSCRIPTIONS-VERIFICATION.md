# PA-02 — Manual Subscriptions / NO PAYMENTS

**Owner decision:** APPROVED 2026-11-07. Subscription access is administered **manually** by the independent `SuperAdmin`. **No electronic payments, no manual payment entries, no platform invoices, no transaction/receipt/price/currency/billing data, no automatic renewal, and no future payment-provider milestone unless the owner explicitly changes the decision.**

**Status:** Implemented, migrated and verified **locally**; production deployment remains BLOCKED by PA-01 security and WP-10/VPS gates. No production customer was modified. There was no push or deploy as part of this slice.

## Scope and invariants

- `PlatformSubscriptionPlan` stores `Code` (immutable unique), `Name`, `DurationMonths` (1–36 or null = unlimited), `IsActive`, creation time. There is **no price, payment or money schema**; no external provider.
- `TenantSubscription` stores the latest manually assigned plan, start, deadline, optional manual end and update time, exactly one current record per Tenant. Each transition has an immutable privileged `PlatformAudit` containing actor, reason, date and before/after values. The current subscription row is updated for plan changes; historical actions are preserved in `PlatformAudits` rather than a separate immutable period table.
- `Tenant.AccessExpiresAtUtc` continues to be the **single existing authorization deadline** used by the tenant login/cookie/request policies; the subscription record and deadline change in **one database transaction**. `Tenant.IsActive` stays an independent administrative suspension switch.
- Existing 3-month and unlimited seeded merchants retain their original `AccessExpiresAtUtc` values and **have no invented plan assigned**. The UI labels these as pre-existing access; only explicit SuperAdmin assignment moves them onto managed subscriptions.
- New assignment **intentionally starts a new period now** (or unlimited), replacing the old deadline. A fixed-month renewal extends from the later of current expiry or now. Ending marks the subscription ended and expires access immediately, without deleting merchants, user accounts, documents or existing import-order accounting.
- No renewal for unlimited plans; disabled plans cannot be newly assigned or renewed, but already granted tenant access is not retroactively revoked. The last Admin guard and `SuperAdmin` separation are preserved.
- A tenant-row `FOR UPDATE` lock plus `PlatformRevision` check rejects stale and competing writes, including duplicate renewal retries; a plan-row `FOR SHARE` lock coordinates assignment/renewal with concurrent plan disable. All privileged endpoints require `PlatformSuperAdmin` policy and existing CSRF controls.
- Once a subscription is managed, the old `/api/platform/tenants/{id}/access` direct-deadline endpoint rejects attempts to bypass the subscription lifecycle.
- Merchant `PaymentTransfer`, `OrderExpense`, `PaymentAllocation` and related trading-accounting features are **unrelated**: they remain tenant-scoped and unchanged. The prohibition concerns payments **for Wathiqa subscriptions**, not the import business domain.

## Backend and UI

- Migration `20261107184753_PlatformManualSubscriptions`: new `PlatformSubscriptionPlans` and `TenantSubscriptions` tables, uniqueness and FK restrictions, positive bounded month-duration check. Existing `Tenants`, Orders and stored documents are untouched.
- `ManualSubscriptionsApi.cs`: `GET /api/platform/plans`, `POST /api/platform/plans`, `POST /api/platform/plans/{id}/active`; `GET /api/platform/subscriptions`, `GET /api/platform/tenants/{id}/subscription`, and `POST .../subscription/{assign|renew|end}`. Search/pagination for merchant subscriptions are server-controlled; every mutation includes an auditable reason.
- Arabic RTL `/platform/plans` for catalogue creation/deactivation, `/platform/subscriptions` for directory/statuses, and subscription controls inside `/platform/tenants/[id]` for assignment, renewal and deliberate end. No payment form, receipt capture or invoice menu.
- SuperAdmin login remains `/platform/login`. Password is in the **gitignored** local `.local/platform-superadmin-account.json` for development only and is never written to repo or web pages.

## Local verification (2026-11-07)

| Gate | Evidence | Result |
|---|---|---|
| Pre-migration checkpoint | `scripts/Backup-ImportDevelopment.ps1` verified PG dump checksum | PASS |
| Migration discipline | Rebuilt Debug DLL after generating migration, `dotnet-ef migrations has-pending-model-changes` | PASS (no drift) |
| Migration execution | `scripts/Apply-ImportMigrations.ps1`, `wathiqa_import_dev` ONLY | PASS |
| API build | `dotnet build ... --no-restore -c Release -v quiet` | PASS, 0 errors/warnings |
| TypeScript | `npm.cmd --prefix frontend run lint` | PASS |
| Next.js optimized build | `scripts/Build-ImportFrontend.ps1`, durable `.local/import-frontend-build-exit.txt` | PASS (exit 0, new routes visible) |
| Platform authenticated API + PA-02 lifecycle | `node scripts/Test-PlatformSuperAdmin.mjs` | **76/76 PASS** |
| Platform real Edge/Chrome Production browser | `node scripts/Browser-PlatformSuperAdmin-Test.mjs` | **16/16 PASS** |
| Production route guard | `node scripts/Test-ImportPublicSurface.mjs` | **18/18 PASS** |
| Merchant operations API | `node scripts/Test-ImportOperations.mjs` | PASS (exit 0) |
| Merchant existing browser journeys | `node scripts/Browser-Import-Test.mjs` | **15/15 PASS** |
| Existing purchase-order financial tests | `node scripts/Test-Payments.mjs` | PASS (exit 0) |
| Independent staged local restore | `scripts/Test-BackupRestore-Import.ps1` | PASS, `PA02_MANUAL_SUBSCRIPTIONS_RESTORE=VERIFIED` |

**PA-02 negative scenarios covered:** non-SuperAdmin denied; invalid month/name/reason and duplicate plan; unavailable plan; direct legacy entitlement override blocked; duplicate assignment and stale revision rejected; two simultaneous renewals result in one success/one conflict; plan deactivation blocks future renewals without cutting existing access; unlimited has no renewal; explicit switch to unlimited; manual termination revokes a pre-existing merchant cookie; double termination conflicts; explicit reactivation restores merchant login; audit preserves actions and reasons; API/plan UI have no monetary fields.

**Restore evidence:** in a random non-production restore database, source/restore count hashes matched, including 2 QA plans and 1 QA subscription, 8 private document blobs, database references, 1 protected data-key file, and financial/audit tables. This is a local rehearsal only, **not** an encrypted off-host VPS restore.

**QA cleanup:** `scripts/Cleanup-PlatformSuperAdminQa.ps1` now guards the exact `PA_QA_...` merchant and its namespaced test plans, refuses to clean any merchant business records or plans referenced by other merchants, and defaults to dry run. The PA-02 QA tenant/plans and generated finance QA fixtures were cleaned after testing, with the real local `SuperAdmin` and seeded merchant accounts preserved.

## Deferred / not attempted

- No payment/billing components are planned under the approved scope. Reconsidering them requires a new owner decision; nothing is silently treated as paid or confirmed.
- No separate immutable subscription-period table or grace period in v1; per-change audit remains authoritative. Plan names/durations are stable once created; new offerings get new plans.
- Full public production authorization hardening remains blocked on platform owner MFA/recovery, Docker/Dokploy images/HTTPS/trusted proxy, genuine antivirus, monitoring, off-host backup/restore, and merchant acceptance. No VPS/production migration was performed.
- Implementation and database tests were performed **locally** on branch `feature/import-management-mvp`; commit/push status must be verified from Git, and no deployment or public staging rollout was performed.
