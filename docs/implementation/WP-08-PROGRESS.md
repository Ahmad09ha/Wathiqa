# WP-08 — Operational Read Models and Arabic Reporting (Local Verification)

**Date:** 2026-11-07  
**Status:** Operational and financial-report MVP slices **VERIFIED LOCALLY**; real merchant pilot/performance and production verification **PENDING**.  
**Authority:** `../architecture/01-DECISIONS.md`, `../architecture/03-JOURNEYS-DELIVERY.md`.

## Implemented and usable

- `GET /api/orders` supports scoped, server-paged search, supplier, currency, date, arrival/clearance, and approved sort keys. Commercial totals are grouped **separately by currency across all matching rows, before paging**.
- The list and detail derive `PaidAmount`, `RemainingAmount`, `UnresolvedDifference` and payment/overdue status from WP-05 persisted **active allocations, real user-recorded transfers, refunds and due schedules**. `payment=Paid|PartiallyPaid|Unpaid|Outstanding`, `overdue` and administrative order status filters run on the server. No planned schedule counts as paid; no currency conversion or cross-order credit.
- `GET /api/operations/containers` supports AtSea and other container states, order context, search and free-time windows. Delivered containers are excluded from free-time alerts. Date cutoff currently uses **UTC**, with that limitation disclosed in the UI.
- `GET /api/operations/document-gaps` evaluates only tenant-Admin-created required-document rules, direct active links, live document scan state (Production requires Clean) and active waivers. No implicit mandatory document policy is assumed.
- `/import/orders` and `/import/operations` provide Arabic RTL lists, shareable URL filters, per-currency paid/outstanding and financial warnings, paging, document gaps, free-time alerts and responsive mobile layouts; no decorative summary-count dashboards.
- Every business query depends on the authenticated tenant's EF query filters; cross-tenant isolation is checked with independent logins and foreign IDs.

## Evidence from the actual local environment

- Started the existing local PostgreSQL 18 cluster on `127.0.0.1:55432` and the .NET 10 Import API on `127.0.0.1:5089`, connected to **only** `wathiqa_import_dev`.
- `node scripts/Test-ImportOperations.mjs`: **70/70 PASS** with current WP-05 financial reporting. Cases include currency grouping before pagination, real zero paid for unpaid Orders, two-tenant search, server-paged company directory, partial arrival, AtSea/Free Time, stage-specific document gaps, upload, waiver/revoke, authorization and invalid filters.
- `node scripts/Test-Payments.mjs`: **91/91 PASS** on real local PostgreSQL, including paid/outstanding/overdue filters and Admin-closed orders retaining visible commercial liabilities. `node scripts/Browser-Payments-Test.mjs <scoped fixture>`: **7/7 PASS** (same-order 5,000 excess, 3,000 verified expense, 2,000 actual return, mobile).
- `node scripts/Browser-Operations-Test.mjs <dedicated fixture>`: **8/8 PASS**, exit 0 using real Edge/Chromium. Covers Arabic sign-in, URL filters, actual operational rows, document gap changes, mobile Orders cards and no horizontal page overflow. Screenshots saved locally as `.local/wathiqa-wp08-*.png`.
- Test fixtures were scoped by `WP07_QA_*`; the guarded `scripts/Cleanup-ImportDocumentsQa.ps1 -Apply` completed with exit 0. Do not treat QA data as real merchant orders.

## Unfinished / must not misrepresent

- Transfers are **bookkeeping records supplied by a user with a linked document**, not independently bank-verified transactions. A real bank provider statement reconciliation is not implemented. General reversal of already allocated funds and non-FIFO due-date allocation remain explicitly limited in WP-05.
- Per-tenant report timezone (today uses UTC), broader merchant acceptance with five real anonymized orders, performance at Production volume and public HTTPS staging integration still require verification.
- Approved P-02/B and P-03/A are implemented locally; P-01-R1 same-order-only discrepancy invariant remains mandatory.

**Disposition:** `LOCALLY VERIFIED MVP / PRODUCTION BLOCKED`. WP-08 operational + financial views are verified against local DB/API/browser fixtures, NOT a completed WP-10 merchant or VPS release.
