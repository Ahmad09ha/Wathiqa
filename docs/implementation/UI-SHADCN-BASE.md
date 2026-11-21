# Wathiqa shadcn/ui — initial integration (2026-11-21)

## Scope

Wathiqa retains its Arabic RTL interface, IBM Plex Sans Arabic font, Next.js 16,
React 19, existing custom CSS, and all merchant/platform APIs. This change
introduces the official shadcn/ui **source-component approach** into the existing
frontend; it is not a full visual redesign or an authorization/business-rule change.

The following are now present:

- `frontend/components.json` — shadcn CLI metadata, with `rtl: true` and
  the existing `@/* -> src/*` import alias.
- Tailwind CSS v4 and PostCSS plugin. `src/app/shadcn.css` defines Wathiqa's
  neutral/green semantic color tokens. **Tailwind Preflight is intentionally
  excluded** to avoid resetting existing forms, tables and the legacy editor.
- Source-owned components in `src/components/ui/`: `button`, `card`,
  `input`, `badge`, plus `src/lib/utils.ts` (`cn`).
- First consumers: merchant and SuperAdmin login inputs/buttons, shared password
  inputs, import-tracking controls, dashboard KPI cards/panels, and the platform
  role badge. Existing Arabic labels, handlers, session separation, tracking
  quota and tenant security checks remain unchanged.

The existing global CSS uses `--muted` and `--accent` for unrelated legacy
semantics. shadcn's accent and muted tokens deliberately use `--wui-accent`
and `--wui-muted` to avoid overriding those legacy variables.

## Follow-on adoption

Convert remaining merchant and platform screens incrementally. Prefer adding
source components in `src/components/ui` and replacing a small set of controls
per PR, rather than removing `import.css`, `platform.css`, `dashboard.css`
or the editor CSS wholesale. Keep Arabic RTL alignment and native LTR input
direction for emails, amounts, identifiers, and container/B/L references.

Check responsive 390px mobile layouts, keyboard/focus behavior, table overflow,
file upload and PDF preview, permissions and financially consequential dialogs
before deploying a converted page.

## Verification / build

```powershell
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
```

Manually verify `/import/login`, `/platform/login`, `/import`,
`/import/orders/from-file` (especially tracking B/L controls), and the
SuperAdmin overview in Arabic RTL. API integration tests and live ShipsGo
activations are separate; do not spend a provider credit merely to test UI.

The change does not require a database migration, API secret change or new
Dokploy environment variable. The existing Compose web build installs
dependencies from `frontend/package-lock.json`. Promotion to the VPS remains
an explicit deployment decision; a passing static build does not prove browser
acceptance in production.
