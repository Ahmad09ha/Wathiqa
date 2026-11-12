# Wathiqa — File-first order entry & ocean tracking (2026-11-10)

## Scope delivered

- Existing manual order flow is retained at `/import/orders/new`.
- New file-first flow: `/import/orders/from-file` (and saved orders at `/import/orders/{id}?mode=file`).
- Two-pane Arabic workflow: left private PDF/JPG/PNG reference preview, right five tabs: order information, payments, B/L, customs, tracking. Requires creating an order before financial or logistics writes. The source document is uploaded through the **existing** authenticated, tenant-scoped, CSRF-protected private Document API and malware scanning gate; never stored as a public blob.
- Tabs 1–4 reuse existing, audited order/payment/logistics/document services and now extend their schema: order PI number, contract number/date, material brand; B/L shipper/consignee/notify party, on-board/original-received dates, package/pallet count; customs currency, declared value, duty rate, duties, taxes, broker/inland transport and demurrage/detention fees, warehouse delivery date; and payment method ExchangeOffice + bank/exchange name. Existing supplier directory stores company country and contacts. Do not automatically add customs estimates to the financial ledger. Currency conversion / independent per-transfer FX rates are NOT implemented or silently implied. Existing order totals and balances follow their previously approved server-side rules.
- Tab 5: `GET/POST /api/shipments/{shipmentId}/tracking`, `POST /api/tracking/{id}/refresh`. Register **CT** (container) or **BL** (must match the chosen shipment B/L), optional shipping line SCAC; snapshots are cached per tenant in PostgreSQL, with a 30-minute rate/cost guard. Return provider status, ETD/ETA, arrival, vessel/voyage, AIS position and event timeline where provided; no fake provider data. External OpenStreetMap marker/embedded map uses last received coordinates only. Overdue ETA warning requires provider ETA past today without confirmed arrival and is not a definitive customs or delivery assertion.

## SeaRates configuration

SeaRates v3 endpoint: `GET https://tracking.searates.com/tracking` (query `api_key`, `number`, `type=CT|BL`, optional `sealine`, `route=true`, `ais=true`). This integration is server-only: configure the secret in a secure server environment variable, **never** in frontend, repository, or logs:

```powershell
$env:OceanTracking__SeaRatesApiKey = "SET_VIA_SECURE_SECRET_MANAGER"
```

For ASP.NET Core's configuration hierarchy the environment variable double underscore maps to `OceanTracking:SeaRatesApiKey`. Without a key, reference registration and cached state work but live refresh returns 503 `tracking_not_configured`. No provider key was available during development, so **live provider behavior has not been E2E verified**. Confirm subscription coverage, AIS entitlement, rate limits and billing before setting the key.

References are scoped to the same tenant and shipment. Do not use provider status to automatically overwrite the authoritative order/BL/customs/payment status: provider data and manual logistics are separate facts. The provider may not report vessel location or events for all carriers. Webhooks are not implemented until verified provider webhook signing and delivery contract exist. Scheduled polling, auto alerts and push notifications are not implemented.

## Migration

Migrations are `20261110183000_ShipmentTrackingReferences.cs` (manual migration, verified against EF snapshot) and `20261110183901_FileFirstOrderLogisticsDetails.cs` (EF-generated, with designer and snapshot). Both were applied ONLY to isolated local development DB `wathiqa_import_dev` after a verified private backup in `.local/backups`. Existing Order.SupplierRef was copied into the new ProformaInvoiceNumber for historical rows because the previous Arabic UI labeled it as PI. Do not apply these migrations to production without separate backup, rollout and smoke tests.

- Connected Rider now has **.NET SDK 10.0.404**, valid for repo `global.json` roll-forward. API builds with 0 errors and 0 warnings; `dotnet ef migrations has-pending-model-changes` reports no model drift.
- `node scripts/Test-ImportLogistics.mjs`: **64/64** authenticated real-PostgreSQL tests passed, including same-tenant/cross-tenant tracking registration, matching B/L and container ownership, idempotent registration, missing provider key fail-closed, new order/shipper/customs fields and invalid negatives. Tagged QA rows removed after guarded dry-run.
- `node scripts/Browser-Orders-Test.mjs`: **20/20** combined manual order and file-first browser checks passed. `node scripts/Browser-FileFirstTracking-Test.mjs`: **8/8** file-first browser smoke checks passed (five tabs, file physically left, real PDF blob preview, required-order message, fields, 390px mobile).
- `node scripts/Browser-Logistics-Test.mjs`: **11/11** real browser checks passed after synchronizing test clicks to completed API writes (not changing production behavior). Confirmed B/L metadata edit, container progression, customs status and mobile layout. Its tagged QA records were removed after dry-run.
- `npm run lint` and `npm run build` succeeded in frontend; new route ` /import/orders/from-file ` is built. The local API answered its health check, and web route responded HTTP 200.
- Pending evidence: live SeaRates request with a configured provider key, actual provider positions/events, webhook subscriptions, background alerts, and staging/production deployment verification. Do not infer these from tests without a provider key.

## Operational limitations

- No OCR/AI extraction: intentional first phase, user manually transcribes from source file.
- Private upload accepts PDF/JPEG/PNG up to 25 MiB; not Word/Excel. Adding these requires signed-content validation, AV-safe preview conversion and permission review.
- B/L/customs are logically **shipment-level** and can have multiple child containers; this preserves approved architecture. Do not silently convert them to container-level ownership.
- ETA is a forecast, not a verified arrival; sea tracking is an optional dependency. Avoid high-frequency refresh which consumes paid API quota.
- No OCR/AI, no real FX rate conversion, no verified provider webhooks or automatic background alerts. Explicit deployment/real-provider authorization still required. No Git push or VPS deployment performed.
- Production readiness remains blocked by the project-wide deployment/security gates listed in `README.md`.

## 2026-11-12 integrated acceptance addendum

This addendum supersedes the earlier WP-10 browser evidence and pending-file-upload line above.

- 20/20 PASS: Browser-Orders-Test.mjs now covers manual order creation/edit, file-first private PDF selection, upload through same-origin Next.js proxy, document ownership metadata, HTTP 200 protected PDF preview, reopening the same saved PDF, tabs 2-5, and targeted soft-deletion of only the disposable test document/order/supplier.
- 8/8 PASS: Browser-FileFirstTracking-Test.mjs verifies five tabs, left-hand PDF preview, and mobile no-overflow.
- 7/7 PASS: Browser-Payments-Test.mjs completes the real UI accounting journey using the latest temporary QA fixture, including unresolved 5,000, expense allocation, exceptional close, and returned balance.
- 91/91 PASS: Test-Payments.mjs financial API and tenant/permission/idempotency cases on the isolated local PostgreSQL database.
- 64/64 PASS: Test-ImportLogistics.mjs validates tenant isolation, tracking reference ownership, B/L/customs fields, new/old client compatibility, invalid data and missing tracking provider behavior.
- 11/11 PASS: Browser-Logistics-Test.mjs from the prior integrated verification run.
- A separate temporary same-origin Node probe verified PDF upload 201, document list 200, private preview 200, and targeted QA document soft deletion 204. Its source and logs live only in gitignored .local.
- The previous save-and-reopen browser evidence gap is CLOSED. No OCR or live tracking provider call was implied. PostgreSQL, .NET API and Next.js were started locally, without touching VPS/production data.
- No push, merge, or VPS publication has been made. The provider credential, webhook authenticity contract, recurring alerts, multi-currency FX accounting, and staging deployment remain outside verified scope.
- The new WP05 financial QA fixture was cleaned with the guarded Run-scoped dry-run/apply workflow. A subsequent dry-run returned 0 matching Orders and 0 matching Documents; only the isolated local QA fixture was targeted.

- File-first creation is intentionally a two-step write: the Order is saved first, then the PDF is attached through the private document API. If the attachment fails, the Order remains saved and the UI reports the failure so the operator can re-upload. Do not describe this process as an atomic cross-service transaction.
