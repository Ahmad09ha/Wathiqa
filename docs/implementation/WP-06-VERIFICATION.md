# WP-06 — Logistics, B/L, Containers and Customs

Date: 2026-11-07
Branch: feature/import-management-mvp
Status: Local vertical slice implemented and verified; NOT production-ready or deployed. WP-07 private Documents were subsequently implemented (see WP-07-VERIFICATION.md).

## Approved product boundary

Hussam's MVP plan plus the approved decisions define:
- Exactly one Purchase Order owns each Bill of Lading (B/L); a Purchase Order can own several B/L. B/L never spans two Orders.
- Each Container has one B/L; a B/L has zero or one CustomsClearance.
- Actual arrival is tracked by Container (1 of 3 Delivered is partial, never "all delivered").
- Customs status is authoritative for each B/L; the Order roll-up is a summary.
- Staff can handle logistics, but priced Order or financial changes are protected by CanManagePayments.

## Backend implementation

Models: ImportShipment, ImportContainer, ImportCustomsClearance, ImportLogisticsAudit.
EF migration: ShipmentsContainersCustoms; only in separate local import DB, not the legacy editor DB.

Shipment API:
- GET/POST /api/orders/{id}/shipments
- GET/PUT /api/shipments/{id}
- B/L identity unique per active Tenant, one immutable parent OrderId, B/L type, original status, shipping line, vessel, voyage, ports, ETD/ETA, Free Time, secure tracking URL and concurrency Revision.
- Tenant-bound ShippingLine company reference and append-only audit.

Container API:
- GET/POST /api/shipments/{id}/containers
- PUT/DELETE /api/containers/{id}; delete permitted for Planned status only.
- ISO 6346 check digit validated on SERVER, invalid digit requires explicit acknowledgment; malformed number rejected. Three owner letters + U + six-digit serial + digit. No silent change to digits.
- KG weights, size 20/40/40HC, seals, dates and forward-only Planned -> AtSea -> AtPort -> Delivered.
- Containers scoped to B/L with composite Tenant foreign key. Duplicate active number per B/L rejected. Concurrency protection via Revision; changes audited.

Customs API:
- GET/PUT /api/shipments/{id}/clearance (one record per B/L).
- Broker must be a tenant-owned Company of Broker type. Per-B/L statuses NotStarted, MissingDocs, UnderInspection, FeesPaid and Released. Released requires release date; chronological validation and audit.

Derived Order fields:
- After a logistics write, server recalculates ContainerCount, DeliveredContainerCount, ArrivalStatus and ClearanceStatus within the same PostgreSQL transaction.
- All-delivered vs partially-delivered is determined by actual Container rows, not client-submitted flags.
- Mixed released and pending clearances display Partial. Deletion of an Order with active B/L is prohibited.
- Logistics writes increment Order.Revision to guard concurrent modifications.

## Arabic UI

The Order detail page now includes ImportLogisticsPanel:
- Create and browse B/L linked only to that Order.
- Add and update Containers; warn for invalid check digit and require explicit acknowledgment.
- Update container actual shipping and delivery stages with dates.
- Save per-B/L customs status, declaration and broker.
- Mobile responsive. Priced-order fields retain Staff read-only behavior without CanManagePayments; logistics uses TenantMember.
- Editing existing B/L metadata through UI is not yet implemented (backend PUT endpoint exists).

## Test evidence

- dotnet build backend/Wathiqa.ImportApi: PASS, 0 errors/warnings.
- EF Core migration applied to wathiqa_import_dev with no legacy DB changes.
- node scripts/Test-ImportLogistics.mjs: 42/42 PASS with live HTTP and two merchant sessions. Checked foreign Tenant relationships, B/L per Order, duplicate B/L, ISO checksum and acknowledgment, duplicate Container, chronology, forward status, exact 1/3 delivered, mixed customs statuses, and cross-Tenant data denial.
- scripts/Cleanup-ImportLogisticsQa.ps1 applied to 2 local QA runs, then dry-run found 0 remaining matching QA rows. Scripts refuse non-QA tenants and non-import databases.
- Browser QA scripts/Browser-Logistics-Test.mjs: **11/11 PASS with exit code 0** on local Edge. Real merchant login, Order detail, B/L creation and subsequent metadata edit, ISO 6346 positive warning feedback, Container creation, transitions Planned -> AtSea -> AtPort -> Delivered with dates, 1/1 B/L rollup, per-B/L MissingDocs customs update, and mobile no-horizontal-page-overflow check.
- Next.js production build: **PASS with exit-code marker 0** in gitignored .local/import-frontend-build-exit.txt, including all new Order/logistics routes; frontend TypeScript check (npm run lint): PASS.
- Desktop and mobile screenshots visually reviewed: .local/wathiqa-logistics-desktop.png and .local/wathiqa-logistics-mobile.png. Mobile table scroll is nested, not whole-page overflow. Transient toast notifications appear in the screenshots as expected.
- All WP06-generated QA Orders, Shipments, Containers, audits and Companies from repeated test attempts were deleted by a tightly scoped local-only cleanup; final dry run reported zero QA matches. No production, user or legacy data touched.
- Final integrated regressions: WP-04 Orders 25/25, WP-01 tenant/security 31/31, Orders browser 9/9, Import workspace browser 12/12, proxy session 3/3, legacy API 13/13, legacy RTL 16/16, legacy editor browser 9/9 and legacy advanced browser 8/8. Each runner returned exit code 0.
- Whole solution .NET build: PASS, 0 warnings and errors after stopping the legacy API to release its Windows DLL lock. EF Core migration pending-model check: no pending model changes. Site and two APIs restarted and tested HTTP 200.

## Blockers and exclusions

- P-01-R1 stays approved: excess remittance never becomes credit for another Order.
- P-02 order close/cancel and P-03 settled-transfer corrections still require explicit Level 3 decisions; no related write endpoints were built.
- Private B/L/PDF uploads and document links were delivered **after** this WP-06 slice, by WP-07. See WP-07-VERIFICATION.md for the separate implemented capability, tests and production blockers.
- No real Payments, expense reconciliation or transfer correction (WP-05).
- No global shipment directory, ETA notifications or reports (WP-08).
- Shipment cancellation/deletion and retroactive Delivered -> AtSea correction need an explicit audited workflow.
- POST idempotency, production keys, HTTPS/proxy setup, off-host backup/restore and retiring the unauthenticated legacy root are still required before VPS.

## Local commands

Project: D:\Works\PrivateWorks\Hussam

- powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Apply-ImportMigrations.ps1
- powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ImportApi.ps1
- node scripts/Test-ImportLogistics.mjs
- powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Cleanup-ImportLogisticsQa.ps1 (dry-run)
- powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Cleanup-ImportLogisticsQa.ps1 -Apply (only tagged local QA records)
- http://localhost:3000/import/login -> open Purchase Order -> Logistics section

No Git commit/push or remote deployment attempted.

## Standards reference
BIC official checker: https://www.bic-code.org/check-digit-calculator/
Container structure: https://www.bic-code.org/identification-number/
