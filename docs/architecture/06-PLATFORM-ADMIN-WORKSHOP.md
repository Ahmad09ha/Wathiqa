# Wathiqa Platform Administration — Pivotal Decision Workshop

**State:** PA-01 APPROVED and LOCALLY VERIFIED: independent platform identity with the **`SuperAdmin`** role. PA-02 APPROVED: manual-only subscription administration, explicitly no payment capability of any kind. No production deployment.
**Date:** 2026-11-07. **Related:** `01-DECISIONS.md` (L3-02, AS-01), `backend/Wathiqa.ImportApi/Domain.cs`, `TenantSecurity.cs`, `AuthApi.cs`, and `frontend/src/app/import/team/page.tsx`.

## 1. User goal and known implementation

**Target:** The owner of Wathiqa wants a platform-wide dashboard to manage merchants, their subscriptions, users, and other operational controls, independent from any individual merchant's import workspace.

**Verified current state:**

- A `Tenant` represents one merchant; it has `Id`, `Slug`, `Name`, `IsActive`, `CreatedAtUtc`, `AccessExpiresAtUtc`.
- `ImportUser` is **always** attached to exactly one `TenantId`. Ordinary `Admin` and `Staff` are **tenant roles**. `TenantAdmin` endpoints manage *only their own* staff/invitations/payment permissions.
- The ASP.NET Identity application cookie contains `tenant_id`; the tenant requirement handler checks live user+tenant+role/expiry. EF global filters protect business tables by `TenantId`.
- Trial vs unlimited is currently an **entitlement expiration** on `Tenant`. Two local seed tenants are trial for 3 calendar months and unlimited. There are **no verified `Plan`, `Subscription`, `PlatformOperator`, platform billing/invoice, or platform renewal-history entities**.
- The Next.js production proxy currently exposes `/import` and `/import-api` only. No platform console route is exposed.

The new dashboard cannot safely reuse a merchant `Admin` account as a global superuser by bypassing tenant checks. It needs an explicit platform trust boundary and a user decision before writing privileged API code.

## 2. Pivotal decision PA-01: platform scope and data visibility

### Option A — separate Wathiqa Platform Control Plane (**recommended**)

- Platform Operators are separate identities/authorization policies from merchant users and `TenantAdmin`. Separate platform session authentication and route namespace (`/platform/*`, `/api/platform/*`), default deny, no tenant ID from browser as authority.
- Only platform-management data: merchant profile, subscription state, user directory and lifecycle, quotas, audit, safe support operations. Existing merchant workspace and business data remain tenant-only.
- A Platform Operator may suspend/reinstate a tenant, invite/resend/disable authorized accounts with audit and safeguards; **cannot read orders, PDFs, bank evidence or act as a merchant without a separate, explicitly approved support-access workflow**.
- No password viewing or silent impersonation; bounded operator roles and step-up verification for disruptive actions.
- Benefits: clear trust boundaries, lower cross-tenant breach risk, easier future staff delegation. Cost: additional auth/session/DB policies and tests.

### Option B — extend a merchant `Admin` into a cross-tenant superuser (**not recommended**)

- Reuse the current session and add a flag to bypass normal `TenantId` filtering.
- Less code initially, but major risk: one authorization/query mistake could reveal other merchants' orders, documents or money. Session/caching/Identity and tenant-filter assumptions become harder to reason about and test.

**Decision PA-01 (approved 2026-11-07):** Option A, with the **`SuperAdmin`** permission/role, explicitly named by the owner. It is not the merchant `Admin` role. Do not grant cross-tenant access to merchant Orders, private documents, banking facts or impersonation. If future support staff need such access, require a separate authorized time-bound/audited support-access decision.

## 3. Pivotal decision PA-02: subscription management without any payment system

The option descriptions below are a **historical workshop record**. The owner selected manual subscriptions with **no payment whatsoever**; billing options and any price/receipt/ledger work are **superseded, not future backlog**.

### Option 1 — operator-managed access and subscriptions (**recommended first slice**)

- Manage Plans and merchant subscriptions **without pretending to charge money**: Trial, time-limited paid entitlement, Unlimited, and temporary suspension/grace states only if explicitly approved.
- Operator records a subscription activation/renewal/expiry with reason, who did it, UTC timestamps and history. The live tenant authorization checks the entitled state; current three-month and unlimited seeded tenants retain their original entitlement dates (no silent reset).
- If off-platform payments must be tracked, record them in a **platform billing ledger**, entirely separate from the merchant's purchase-order transfer ledger. Invoice creation/collection semantics must be specified first.
- Benefits: works for manual onboarding and selling subscriptions before payment-gateway selection; avoids invented receipts. Cost: manual operations and reconciliation.

### Option 2 — automated checkout, gateway, invoices and renewals immediately

- Requires explicit gateway, jurisdiction/tax rules, currencies, invoices, refunds, webhook idempotency, dunning, chargebacks, grace/suspension and a security/merchant-finance decision workshop.
- Higher initial scope and third-party dependence; cannot assume it from the word "subscriptions".

**Decision PA-02 (approved 2026-11-07):** Manual subscriptions ONLY, operated by `SuperAdmin`. **Do not build a payment feature at all**: no online payment, manual payment recording, charges, invoices, receipts, prices, billing ledger or payment providers. Plain plan labels/durations, manual assignment/renewal/termination and audit are in scope. Existing merchant accounting/payment-transfer workflows for purchase orders are separate and must be preserved. Revisit billing only if the owner explicitly requests a new decision.

**Safe initial subscription semantics (derived engineering rules):** Fixed-month or unlimited plans without prices; a new manual assignment starts a fresh period explicitly, renewal of a fixed-duration plan extends from the later of current expiration or current UTC time (never twice under one tenant revision), and termination immediately expires access without deleting business data. No automatic renewal and no background charging. Previously seeded 3-month/unlimited access remains untouched until a SuperAdmin explicitly assigns a plan. Inherited access is shown transparently rather than silently converted to a subscription. A plan definition is immutable after creation, can be deactivated for new assignments, and historical changes are kept via platform audit.

## 4. First-release navigation and limits

1. **Overview:** operational health and merchant/subscription counts based on authoritative data, without fictional revenue.
2. **Merchants / Tenants:** search, detailed profile, state, creation, activation/suspension with reason, entitlement history.
3. **Users:** tenant-filtered directory of real users and account activity; controlled invite, enable/disable and guarded admin-account recovery (no passwords displayed).
4. **Plans:** only names, stable technical codes, 1–36 month durations or Unlimited, availability for new assignments and controlled renewal. No prices or quotas have been added.
5. **Subscriptions:** assign/renew/end a subscription, view UTC expiration, history and manual adjustments. Never silently overwrite the old expiry or unlimited entitlement.
6. **Platform audits:** actor, target tenant, before/after, timestamp and reason for privilege/entitlement changes; protected from alteration.
7. **System and support:** health indicators and safe operational diagnostics, **not** direct cross-tenant business-data browsing.

## 5. Non-negotiable verification requirements (if Option A is chosen)

- An ordinary tenant `Admin` MUST NOT authenticate to `/platform` or call `/api/platform/*` even if they guess route IDs or edit browser state.
- Platform operators MUST NOT silently access merchant Orders, documents, bank evidence or merchant payment allocations.
- Every tenant activation/expiry/user permission write must be audited, concurrency protected, idempotent or conflict-safe, and evaluated server-side on the next request.
- Repeated renewal/retry cannot extend an entitlement twice. Reject stale state; preserve trial start/expiry history and seed contracts.
- Platform operator removal/suspension must revoke access immediately; no operator token/cookie reuse for merchant auth.
- Prevent last-platform-owner lockout and ensure recovery procedures are documented and verified before live deployment.
- Reject cross-tenant IDOR and client-supplied tenant-context escalation. Add negative tests with two merchants and two operators at different privilege levels.
- **No platform billing ledger is authorized.** The existing merchant purchase-order trade ledger remains tenant-scoped and untouched. Never invent platform revenue or receipts.

## 6. Suggested work packages (after explicit decisions)

| WP | Contents | Gate |
|---|---|---|
| PA-00 | Approve platform authority & commercial subscription model; exact permissions and pricing semantics | Owner decision |
| PA-01 | Platform identity/auth/permissions + safe creation of initial owner + audits + negative tenant-isolation tests | Security verification |
| PA-02 | Merchant directory, user lifecycle, suspension/activation and safe audit | API/integration tests |
| PA-03 | Plans, subscriptions, renewals/expiration, no double extension and existing trial migration compatibility | DB/API/invariant tests |
| PA-04 | Separate Arabic RTL platform UI, server-side pagination/search and role-appropriate actions | Browser + responsive tests |
| PA-05 | Production security, backups, monitoring and merchant pilot | Release gate, no assumption of deploy |

### References

- OWASP Multi Tenant Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

**Implementation status (2026-11-07):** `PlatformOperator`, `PlatformAudit`, tenant `PlatformRevision`, migrations `PlatformSuperAdminControlPlane` and `PlatformManualSubscriptions`, explicit one-shot `--seed-superadmin` CLI, independent `Wathiqa.Platform` cookie/role, `/api/platform` protected routes and Arabic `/platform` console. Price-free plans and tenant subscriptions are implemented locally with assignment/renewal/termination, revision concurrency and audits; 76 API + 16 real browser scenarios verified. Local password file stays gitignored. **No platform price, invoice, collection, gateway, platform ledger or support impersonation exists.** Production not approved. See `docs/implementation/PA-01-VERIFICATION.md` and `PA-02-MANUAL-SUBSCRIPTIONS-VERIFICATION.md`.
