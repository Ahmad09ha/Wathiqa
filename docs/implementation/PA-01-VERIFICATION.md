# PA-01 — SuperAdmin Platform Control Plane (Wathiqa)

**Decision:** APPROVED: Option A (independent platform identity), user explicitly requires role **`SuperAdmin`** (2026-11-07).
**Implementation:** LOCAL MVP SLICE VERIFIED; production deployment, MFA and owner recovery NOT VERIFIED.
**Branch:** `feature/import-management-mvp`; repository commit/push status must be verified separately before any deployment.

## Boundary and behavior

- `PlatformOperator` is a **separate database identity**, not an `ImportUser`. No `TenantId` or membership in tenant `AspNetRoles`. One explicitly provisioned platform account has the `SuperAdmin` role. A database check constraint prevents other platform roles until designed.
- Separate ASP.NET named cookie scheme `Wathiqa.Platform`, role/claim enforcement, HttpOnly + SameSite Strict + HTTPS-only Secure cookies in Production, 4h non-sliding expiry, restrictive `/import-api/api/platform` cookie path, and **live database security-stamp/active-state revalidation on each request**. No shared tenant role or bypass of EF merchant filters.
- Existing merchant APIs continue to require **merchant Identity cookies** and tenant policies. SuperAdmin **cannot** read purchase Orders, Documents, supplier banking or merchant Payments; the platform API exposes tenant metadata, user-directory metadata, access states and privileged operation audits only.
- Login uses ASP.NET `PasswordHasher`, a 15-minute lockout after 6 consecutive failures, CSRF header for all writes, and the existing auth rate limiter. No public SuperAdmin signup/role assignment/impersonation.
- One-time `--seed-superadmin` CLI reads strong credentials from protected environment/secret files; it never resets an existing operator password. Local-only `scripts/Seed-LocalPlatformSuperAdmin.ps1` stores a unique cryptographically random login in gitignored `.local/platform-superadmin-account.json` and prints **no password**.
- Existing `Tenant` gets additive `PlatformRevision=1` for optimistic concurrency; both row locks and revision checks protect merchant suspend/re-activate and entitlement changes. Existing merchants keep original access-expiry dates untouched. Suspended tenants immediately fail the existing merchant-session validation, including sessions issued before suspension.
- Platform onboarding creates a Tenant with an **explicit** expiration-date or Unlimited choice and issues one-time 48-hour `Admin` invitation; the invited human sets their own password. Tenant Admin-created invitations remain **Staff only** even if the request payload tries to forge a role. No cross-tenant credit or automatically charged subscription is created.
- Every privileged write records a `PlatformAudit` (actor, target tenant/user, before/after, UTC time and required reason) inside the same DB transaction. No platform endpoint permits modification/deletion of audit rows, or silently deleting an order/tenant/user history. The last active merchant Admin cannot be disabled.
- Platform UI: `/platform/login`, `/platform`, `/platform/tenants`, `/platform/tenants/[id]`, `/platform/users`, `/platform/audits`. Arabic RTL and mobile, separate from `/import`, with server-side paging/search and one-time initial-admin token handling.

## Database and verification

- **Migration:** `20261107180215_PlatformSuperAdminControlPlane` creates `PlatformOperators`, `PlatformAudits`, and adds `Tenant.PlatformRevision` using **defaultValue: 1** so old tenants satisfy its database check constraint. The first migration attempt used an old Debug DLL and failed safely/transactionally; after rebuilding with the fixed default, local migration applied successfully. A local import-only `pg_dump` checkpoint was captured before the migration.
- `dotnet build backend/Wathiqa.ImportApi/Wathiqa.ImportApi.csproj --no-restore`: **PASS**, zero errors/warnings.
- `npm.cmd --prefix frontend run lint`: **PASS**.
- `scripts/Build-ImportFrontend.ps1`: **PASS** optimized Production build with Next.js 16.4.5.
- `node scripts/Test-PlatformSuperAdmin.mjs`: **76/76 PASS**, now includes PA-02 manual subscription lifecycle and concurrency; previously 45 PA-01 checks. Real local PostgreSQL + authenticated API: tenant Admin cannot elevate, platform cookie cannot read merchant APIs, missing CSRF rejected, 48h invitation and single-use token, role-forgery ignored, suspension/revocation, Staff lifecycle and audit.
- `node scripts/Browser-PlatformSuperAdmin-Test.mjs`: **16/16 PASS**, now includes PA-02 catalogue and subscription UI; real Edge/Chrome through optimized Production Next.js proxy: SuperAdmin login/logout, responsive RTL navigation, account directory/audit, no horizontal overflow, server-enforced merchant-data denial, and screenshots in `.local/wathiqa-platform-*.png`.
- `node scripts/Test-ImportPublicSurface.mjs`: **18/18 PASS**; production proxy allows platform and merchant pages (including price-free plans/subscriptions) while denying unauthenticated platform APIs, fake route prefixes and legacy editor routes.
- `bash deploy/import/validate-compose-structure.sh` and release Bash syntax checks: **PASS (static only)**. Deployment Compose includes protected SuperAdmin secret files and a distinct one-shot seed procedure.
- Platform QA tenants generated in tests are explicitly tagged `PA_QA_<12 hex>`; `scripts/Cleanup-PlatformSuperAdminQa.ps1 -FixturePath ...` has a default dry run and **refuses cleanup if any merchant business data exists**. It never touches normal users or the platform owner's operator identity.

## Deliberate limits and release blockers

1. **PA-02 now approved and implemented locally.** Plain plan names/durations and manual-only subscriptions control `AccessExpiresAtUtc`, with audit and no automatic renewals. Owner **explicitly prohibits all subscription payments**; no price, charge, receipt, invoice or billing gateway. Refer to the separate PA-02 verification document.
2. **Single platform owner** is the first reviewed trust model; independent SuperAdmin credential reset/recovery, MFA/WebAuthn and operator delegation/role lifecycle require additional security decisions/testing before public Production operations. Do not expose platform admin publicly based on local test passes alone.
3. Platform operators have no merchant impersonation, support content access or tenant business data downloads; any future support access requires explicit user approval, scope/consent/expiry/audit and separate negative tests.
4. Real Docker/Dokploy image boot, trusted HTTPS proxy, secure cookies and off-host disaster recovery remain the previously documented VPS gates; this new privileged capability adds stronger monitoring and credential recovery requirements.
5. WP-10 merchant pilot acceptance remains separate. No Git push, no remote deployment and no real customer mutation was performed in PA-02.

**Local verification login:** `http://127.0.0.1:3000/platform/login`. Local credentials are under `.local/platform-superadmin-account.json` (gitignored; do not copy into Production).
