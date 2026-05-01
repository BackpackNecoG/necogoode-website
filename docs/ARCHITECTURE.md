# Architecture — necogoode.com

## High-level

```
visitor browser
      │
      ▼
Azure Static Web Apps  ──────────────┐
  • web/dist (React SPA)             │
  • staticwebapp.config.json         │
                                     │
  /api/*  ─►  Azure Functions (Node) │
              api/alphavantage       │
              api/alphavantage-status│
                  │                  │
                  └─► alphavantage.co│ (free tier, 25 calls/day)
                                     │
GoDaddy DNS  →  necogoode.com  ──────┘
  TXT (apex validation), A (apex), CNAME www → swa hostname
```

## Frontend

- **Framework:** Vite + React 18 + TypeScript + React Router v6 + Tailwind CSS
- **Routes:**
  - `/` — Splash (cookie-based path persistence)
  - `/TechTour` — IDE-themed homepage
  - `/TechTour/creations/:slug` — Tech deep-dive
  - `/BusTour` — Workshop-themed homepage (horizontal scroll)
  - `/BusTour/creations/:slug` — Story page
  - `/demo/:slug` — Shared placeholder, V2 multi-tenant flow
  - `/floor` — Trading Terminal with live ticker
  - `*` — 404
- **Theme:** all three palettes are CSS custom properties in `web/src/styles/theme.css`. Each route applies its scope class via `useRouteScope()`.
- **Data:** single source of truth in `web/src/data/creations.ts`. Both tours and the floor read from this file — no duplication.

### Component layering

```
routes/
  ├── Splash.tsx
  ├── TechTour.tsx ────────────► components/domain/ide/{IdeChrome,FileExplorer,EditorPane,TerminalPane,StatusBar}
  ├── TechCreation.tsx ────────► (same)
  ├── BusTour.tsx ─────────────► components/domain/workshop/{WorkshopCard, visuals}
  ├── BusCreation.tsx
  ├── Demo.tsx
  ├── Floor.tsx ───────────────► components/domain/floor/{TickerTape,Watchlist,AlphaVantageWidget}
  └── NotFound.tsx
                                 components/ui/{Button,Card,Tag,Chip,Heading,Section,Input,Tooltip}
                                 lib/{useRouteScope,cookies,alphavantage}
```

Lego principle: pages compose domain components; domain components compose UI primitives. No raw `<button>` styling outside `ui/Button.tsx`. No duplicate creation copy outside `data/creations.ts`.

## Backend

- **Runtime:** Azure Functions Node 20 in `api/`
- **Endpoints:**
  - `POST /api/alphavantage  { symbol }` → proxy + counter decrement
  - `GET  /api/alphavantage-status` → counter snapshot, no decrement
- **Shared module:** `api/shared/counter.js` — counter logic imported by both functions (no duplication).
- **Counter implementation:** in-memory, keyed by UTC day. Resets at midnight UTC. **Known limitation: drifts under SWA scale-out.** See HANDOFF.md V2 TODO #1.

### Request flow (ticker entry)

```
user types AAPL
  │
  ▼
AlphaVantageWidget.tsx (POST /api/alphavantage)
  │
  ▼  Vite dev proxy → 7071 (local)  /  SWA gateway → Functions runtime (prod)
  │
  ▼
api/alphavantage/index.js
  ├── validate symbol regex
  ├── counter.getRemaining() → if 0, return 429
  ├── fetch alphavantage.co GLOBAL_QUOTE
  ├── counter.incrementCounter()
  └── return { symbol, price, change, percentChange, latestTradingDay, callsRemaining }
  │
  ▼
AlphaVantageWidget renders QuoteRow + updates counter widget
```

## Secrets

- **Alpha Vantage key:**
  - Source of truth: Azure Static Web App application setting `ALPHAVANTAGE_KEY` (set via `az staticwebapp appsettings set`).
  - Backend reads `process.env.ALPHAVANTAGE_KEY` at request time.
  - Frontend never sees the key — every quote goes through the proxy.
  - Local dev: `api/local.settings.json` (`.gitignored`) holds the same key for `func start`.
  - Original local file `AlphaVantage.txt` is `.gitignored` and **must be deleted after the Azure app setting is verified** (per spec).

## Hosting + CI

- **Azure Static Web Apps** — free tier, custom domain, integrated Functions runtime.
- **GitHub Actions** workflow at `.github/workflows/azure-static-web-apps.yml` triggers on push to `main`.
- **Auto-provisioned secret:** `AZURE_STATIC_WEB_APPS_API_TOKEN` is added to the GitHub repo by `az staticwebapp create --source`.

## Why these choices

- **SWA over App Service** — free tier is genuinely free for a personal site, custom domain + SSL out of the box, integrated Functions runtime so we don't need a separate App Service Plan.
- **Cookie-based splash persistence (no auto-redirect)** — visitor should always be able to take the other path. Cookie remembers the last choice for analytics post-V1.
- **In-memory counter for V1** — Azure Table Storage adds a dependency for what amounts to a UI nicety; the upstream Alpha Vantage limit enforces hard cutoff regardless. V2 will migrate.
- **Vite + Tailwind** — SoloLift's recent re-do is React + Tailwind; consistency lowers cognitive switching cost.
- **`.NET 10` claimed in stack copy** — that's accurate per Neco's stack across SoloLift and GoodeGame; necogoode.com itself is Node + React only because it's a static site.
