# Invitation acceptance / account activation regression — 2026-11-12

## Scope
Existing Import Management Staff onboarding flow:
`POST /api/users/invitations` (Tenant Admin) → `/import/join` → `POST /api/auth/invitations/accept` (anonymous + CSRF) → `/import/login`.

## Verified findings
1. The API correctly exposes ASP.NET Identity validation error **codes** in the `details` array when it rejects a password. The frontend previously ignored this array and always displayed the ambiguous `invalid_user_or_password` message, even for specific violations (e.g. missing uppercase or non-alphanumeric character). The original user's exact failed payload / deployment log was **not available**, so it is **not established** that this was their only cause.
2. Invitation tokens are 32 random bytes encoded as a 43-character Base64Url token, valid for 48 hours and one redemption. Copying from a message can add spaces or zero-width formatting characters. Client and server now strip only whitespace/invisible formatting; the server still validates exact ASCII Base64Url structure, hashes the normalized token, and claims it atomically.
3. Antiforgery tokens can be stale when browser cookies change. The Join page now retries only a `csrf_invalid` rejection **once**, obtaining a new CSRF token. The middleware verifies CSRF *before* the invitation handler and any database write; no other errors are retried, and a consumed invitation cannot be replayed.
4. Client-side password checks now show missing requirements before submission: at least 12 characters, an uppercase letter, lowercase letter, digit, and symbol. The Identity server validation remains authoritative and unchanged.

## Test evidence
- `node scripts/Browser-Invitation-Test.mjs`: **7/7 PASS** against real local PostgreSQL, .NET 10 Import API and the rebuilt Next.js app.
  - Tenant Admin creates a disposable `.invalid` staff invitation
  - Backend returns individual validation errors for weak password
  - Real browser shows missing password rules without consuming token
  - Invalid CSRF cookie provokes a 400; Join page refreshes CSRF and succeeds on the single safe retry
  - Copy-pasted invitation with embedded whitespace is accepted
  - Invited user signs in as Staff and sees only the inviting tenant
  - Consumed token cannot be used again
- `npm run lint` completed; Next.js optimized production build compiled and generated `/import/join` / `/import/login`.
- QA cleanup: `scripts/Cleanup-InvitationQa.ps1` dry-run → `-Apply` → dry-run returned **0 matching QA users and 0 QA invitations** in `wathiqa_import_dev`. Cleanup is guarded to the demo-a tenant and the `invite-qa-<hex>@wathiqa.invalid` namespace.
- No real account, production database, or VPS was mutated. No push or merge was performed.

## Operational notes
- The invitation creation endpoint returns the token one time to the Admin. It does **not** send email itself; distributing the code is an external workflow.
- Keep tokens out of logs, screenshots, public links and committed fixtures.
- For a specific live user failure, inspect the HTTP status and safe error code (not the password or the token), and check whether the invite is expired/used, the tenant expired, an email already exists, rate limiting is active, or CSRF failed.
- Production is not fixed until these source changes have passed staging verification and been deployed through the agreed release process.
