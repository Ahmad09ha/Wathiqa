# Wathiqa UX refresh — Sidebar and purchase orders (2026-11-21)

## Scope and goals

This is the first implemented phase of the Arabic RTL UX modernization inspired
by the owner's shadcn/ui reference screenshots. It builds on the existing ENGTex
navy / turquoise color system without altering backend behavior or permissions.

The source implementation deliberately keeps the **Wathiqa** product identity
and existing API, import, payment, and tracking contracts. No database migration,
ShipsGo change, or Dokploy environment-variable change is required.

## Shared merchant layout

Files: `frontend/src/components/ImportShell.tsx` and
`frontend/src/app/import/experience.css`.

- Existing routes are grouped into **مساحة العمل**, **العمليات**, **الإدارة**
  (the latter only when allowed), plus the unchanged coming-soon report notice.
  No non-existent settings page or unsupported links are fabricated.
- Desktop sidebar width is 272px, collapsible to an 82px icon rail. The choice
  persists via `localStorage["wathiqa.import.sidebar.compact"]`; storage
  failures do not prevent navigation. Collapsed links retain labels, tooltips,
  `aria-current`, and their permission checks.
- Brand stays top; a single, clearer account card, access expiry indication,
  and logout button remain near the bottom.
- At widths <=790px, the sidebar is an off-canvas, **full-width menu** (up to
  300px), independently of the user's desktop collapse setting. Overlay and
  Escape close it. Keyboard focus moves into the menu, cycles through visible
  links/buttons, and returns to the menu trigger on close. Background scrolling
  is locked only while the drawer is open; resizing to desktop closes the drawer.
- The common breadcrumb is now a link to `/import` and headings have
  more usable spacing and contrast.
- `experience.css` is imported after the existing per-page and brand styles
  to keep the older document editor and the independently authenticated
  SuperAdmin UI untouched.

## Purchase orders

File: `frontend/src/app/import/orders/page.tsx`.

- Added four cards: total **matching** orders (from `data.total`), plus
  at-sea/port, in-clearance, and delivered counts **on the current page only**.
  Each card explicitly shows its scope, because summing the first 25 orders
  cannot accurately describe the full paginated result.
- The first row of filters contains search, supplier, and arrival status.
  Currency, customs, payment, overdue, purchase-order status, dates, and
  sorting are still available under an accessible, toggleable advanced panel.
- Saved URL filters continue to populate the fields; pre-existing advanced
  parameters cause the advanced panel to open initially. Apply, reset, and
  quick-filter links retain the existing query-string semantics.
- Quick filters are reversible and receive clearer icons and active states.
- The results table retains original order links, status fields, source finance
  values, secondary document link, draft-delete controls and confirmation.
  Existing mobile order cards and horizontal table scroll remain.
- `canManagePayments` still controls who can create orders, and the existing
  tenant section permissions still control route navigation.

## Verification

Commands completed locally:

```powershell
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Web.ps1
node scripts/Browser-Orders-UX-Test.mjs
node scripts/Browser-Orders-UX-Test.mjs --staff
```

`Browser-Orders-UX-Test.mjs` launches a separate headless Edge/Chrome profile
and **mocks only the frontend's import API traffic**. It does not log in with
real credentials, write database records, or query ShipsGo. It verifies
navigation permissions, correct non-destructive page summaries, full-width
filter layout, advanced controls, collapse persistence, and 390px mobile
overflow and keyboard drawer behavior. Admin and staff runs passed.

Generated QA screenshots are in gitignored `.local/`:
`wathiqa-ux-orders-desktop.jpg`, `wathiqa-ux-orders-compact.jpg`,
`wathiqa-ux-orders-mobile.jpg` and `wathiqa-ux-sidebar-mobile.jpg`
(and `ux-staff-` variants).

## Release / caveats

The mock API smoke is not a real authenticated end-to-end backend test.
Verify the orders list with actual merchant and staff accounts and ensure
summary counts, filters, drafts, documents and payments behave correctly
before production promotion. No schema or secret changes are needed.
Publish via the current reviewed feature branch and the existing Dokploy
Compose service; do not recreate the PostgreSQL or private-document volumes.

Next recommended work: refine order-details forms, dialogs, operational
tracking screens and the SuperAdmin shell using the same shadcn-style
components and accessibility patterns.
