# WP-11: ShipsGo ocean tracking, subscription quotas and direct merchant onboarding
Verified locally 2026-11-12. This document supersedes the old SeaRates provider section in WP-10.

## Provider integration
- Uses ShipsGo Ocean ContainerService v1.2 per official documentation: https://shipsgo.com/pdfs/api-documentation-v1.2.pdf and https://shipsgo.com/ocean/container-tracking-api.
- One paid activation POST to https://shipsgo.com/api/v1.2/ContainerService/PostContainerInfoWithBl with form-encoded authCode, shippingLine and blContainersRef. Successful POST returns a positive integer request ID.
- Later updates use GET https://shipsgo.com/api/v1.2/ContainerService/GetContainerInfo/ with authCode, requestId and mapPoint=true; snapshots are cached per tenant in PostgreSQL.
- Set ASP.NET Core server-only environment variable OceanTracking__ShipsGoApiKey in the deployment secret manager. Remove the old SeaRates key. Do not expose API credentials in frontend URLs or logs.
- In Development only, OceanTracking__ShipsGoTestBaseUrl can target a loopback HTTP mock. In production, the configured host remains fixed to ShipsGo.
- Provider responses are bounded to 4MB, parsed defensively, and given a 25s HTTP timeout. Provider availability does not change official order, customs or payment records.

## Per-subscription B/L quota
- Each newly created PlatformSubscriptionPlan has immutable MaxTrackedBills in range 0..100000. Zero disables direct tracking. Existing plans migrated with zero; create and explicitly assign a new tracking-enabled plan to opt in.
- TenantSubscription.TrackingCycleId changes when a plan is assigned or renewed. Counting is per subscription cycle.
- SubscriptionTrackingUsages persists one unique ledger row per (TenantId, TrackingCycleId, ShipmentId). Since ShipmentId represents the Master B/L, all its containers share ONE quota slot and one ShipsGo provider request ID.
- Row locks on the subscription and a unique database constraint prevent simultaneous requests from exceeding the plan's quota. Tracking reference registration is free and remains possible without a plan; quota is checked just before the paid provider POST.
- A confirmed provider request ID is saved before fetching voyage data and reused for all subsequent GETs and across renewals of the same B/L where applicable.
- Before activation, correcting a shipment B/L number also relinks its unactivated tracking reference. After a provider activation has been reserved, the B/L number cannot be silently changed: tracking_bl_change_requires_reconciliation (409). Shipment editing and activation lock the same PostgreSQL shipment row, preventing a wrong B/L from being assigned to a paid provider request.
- Unknown/timeout results of the paid POST are marked NeedsReview and never automatically retried, avoiding possible duplicate ShipsGo credits. Confirmed rejects may release their slot. Operations must reconcile NeedsReview with ShipsGo manually.
- Historical tracking snapshots remain stored through provider outages, plan changes and renewals, but user access follows existing tenant subscription authorization.
- Webhooks, signed provider callbacks, automatic polling, push alerts, and real ShipsGo credit-account synchronization remain out of scope.

## Direct merchant Admin account
- SuperAdmin creates a merchant by entering company name, slug, Admin email and initial password. Server validates the password using ASP.NET Identity, provisions ImportUser under new Tenant, assigns normal Admin role, and commits transaction atomically.
- A stored Identity password hash is used; neither plaintext password nor token appears in server responses, audit records or persistent frontend storage. Frontend shows the password from transient component state one time for copying to the merchant via a secure channel, then allows hiding it.
- Merchant can log in immediately at /import/login. Existing platform/merchant cookie separation remains in force.
- Legacy API callers that omit AdminPassword still receive a 48-hour initial Admin invitation for backward compatibility. The new UI always uses direct account creation.
- This does not introduce a password-change flow. Consider mandatory password rotation as a future security improvement rather than assuming it is implemented.

## Database migration
- 20261112103205_ShipsGoTrackingPlansAndUsage adds tracking plan cap, unique subscription cycle identifiers and per-B/L usage ledger, with constraints. Existing active subscriptions get unique random cycle IDs.
- 20261112104108_ShipsGoCarrierNameExpansion expands ShipmentTrackingReferences.CarrierCode from 12 to 80 characters to support ShipsGo shipping-line names. It is a widening alteration only.
- Both migrations were applied to isolated loopback PostgreSQL database wathiqa_import_dev, and EF reported no model drift. Do NOT run local scripts against the VPS or production DB.

## Verification
- 38/38 real HTTP/DB assertions passed in scripts/Test-ShipsGoQuota.mjs against local .NET 10, PostgreSQL and a loopback mock ShipsGo provider.
- Covered direct Admin password validation, login, account belonging to the correct tenant, one-B/L plan creation and assignment, both B/L and child-container references, exactly one paid POST for a B/L plus container, quota denial for another B/L, successful post-renewal activation, cross-tenant denial and password secrecy in audit/API.
- The enhanced test also verifies B/L correction before paid activation, automatic relinking of the unactivated reference, and refusal to rename an activated B/L.
- Mock provider initially saw zero activation POSTs, one after the first B/L, still one after the child container and quota denial, and two after renewed subscription activation for second B/L.
- scripts/Cleanup-ShipsGoQuotaQa.ps1 guarded dry-run found exactly two test B/Ls and two usage rows; applying cleanup removed tagged business records and the exclusively tagged test merchant/plan using the existing platform cleanup helper.
- These checks DO NOT establish successful calls to the real ShipsGo provider. A genuine provider key, approved credit balance, correct carrier spelling and actual voyage sample must be tested separately in staging.

## Deployment and rollback
- Apply DB migrations and secure secret configuration only through the managed rollout after backup. Verify API and UI compatibility, then configure/assign new plans.
- Existing plans default to MaxTrackedBills 0 to prevent accidental vendor charges.
- On provider timeout after a chargeable POST, investigate NeedsReview with ShipsGo before any resubmission.
- No deployment to VPS is implied by local tests or git push.
