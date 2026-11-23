# Wathiqa UI redesign — ENGTex navy / turquoise

Status: source implementation complete on `feature/import-management-mvp` (2026-11-21).
This is a UI-only change, not a production deployment or business-logic change.

## Brand reference

The owner provided an ENGTex yarn/circuit logo image. Its principal visual colors
are approximately:

| Design token | Value | Usage |
| --- | --- | --- |
| Logo navy | `#0A285A` | Sidebar, titles, admin login hero, icon |
| Logo turquoise | `#089AAA` | Decorative accents, charts, highlights |
| Accessible action teal | `#067F92` | Small white-text buttons and active tabs |
| Action hover teal | `#055F73` | Hover states |
| Cool white | `#F4F8FC` | Page backgrounds |
| Ink navy | `#102E50` | Main text |
| Soft border | `#DAE6F0` | Card/input/table borders |

ENGTex was used as a **color reference**; the product stays branded **وثيقة**.
The company logo file was not copied into the product or Git repository.

## Architecture and coverage

- `frontend/src/app/engtex-theme.css`: one responsive shared theme for the
  merchant and independently authenticated SuperAdmin interfaces.
- `frontend/src/app/shadcn.css`: matching shadcn/UI semantic colors and
  sidebar tokens; Tailwind Preflight remains disabled to protect legacy/editor CSS.
- `frontend/src/app/globals.css`: shared Wathiqa CSS tokens and focus colors.
- `frontend/src/app/import/import.css`: remapped green-tinted styles to navy
  and cyan throughout orders, companies, reference data, team, file-first entry,
  payments, shipping, customs, tracking, and document controls.
- `frontend/src/app/import/dashboard.css`: remapped merchant dashboard,
  charts, metrics, audit feed, money tables, warning accents.
- `frontend/src/app/platform/platform.css`: remapped all platform pages,
  including tenant/user/plan/subscription/admin audit tables and forms.
- Import and Platform route layouts load the shared theme **after** their own
  CSS, without changing route names or data contracts.
- `BrandMark.tsx` and `app/icon.svg` retain the Wathiqa paper symbol
  with a two-tone turquoise highlight and navy icon background.
- Shared components use shadcn-style Button, Card, Badge in both shells,
  critical confirmation dialogs, dashboards, and status tags. Retained
  native inputs and tables use the same styling system via scoped CSS.
- Wathiqa's Arabic `lang="ar"`, `dir="rtl"`, IBM Plex Arabic typography,
  LTR order and container identifiers, and mobile drawer behavior remain.

## Safety and accessibility

- Error/destructive states remain red; overdue/financial warnings stay amber.
  Those semantics must not be recolored into ordinary turquoise.
- #067F92 action teal is deliberately darker than the logo's #089AAA so
  small white labels have a contrast ratio greater than 4.5:1.
- No login/logout, role, tenant isolation, subscription, payment, document,
  CSRF, tracking quota, ShipsGo secret, API, DB migration or Docker file was
  modified. This is *not* a rollout of the source ENGTex image.
- Existing HTML/React business screens were **not** all individually rewritten
  with shadcn components; the complete active visual layer uses consistent
  tokens, while the existing behaviors remain intact.

## Verification

Frontend commands executed locally:
```powershell
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
```

Real headless Edge browser checked the merchant and SuperAdmin login pages
at 1440x900 desktop and 390x844 mobile. Both pages rendered, showed live
shadcn button slots, and had no horizontal overflow. QA images are saved in
gitignored `.local/brand-import-desktop.jpg`,
`.local/brand-platform-desktop.jpg`, `.local/brand-import-mobile.jpg`,
`.local/brand-platform-mobile.jpg`.

Authenticated merchant/SuperAdmin browser journeys, financial flows, and
real ShipsGo activations were **not** rerun as part of this design change.
Review them on staging before production. This branch should deploy only
through the approved Dokploy Compose service, without recreating database
volumes or changing backend secrets. No migrations are needed for this change.
