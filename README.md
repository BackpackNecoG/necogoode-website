# necogoode.com

Personal portfolio for Renneco "Neco" Goode. Three-route experience:

- **`/`** — Splash door: pick Technical Tour or Business Tour
- **`/TechTour`** — IDE-themed homepage; deep-dives at `/TechTour/creations/:slug`
- **`/BusTour`** — Workshop-themed homepage; story pages at `/BusTour/creations/:slug`
- **`/floor`** — Trading Floor with watchlist of all five creations + live Alpha Vantage ticker
- **`/demo/:slug`** — Shared demo page (V1 placeholder; V2 multi-tenant flow)

## Stack

- **Frontend:** Vite + React 18 + TypeScript + React Router v6 + Tailwind CSS
- **Backend:** Azure Functions (Node 20) — Alpha Vantage proxy + daily-counter
- **Hosting:** Azure Static Web Apps (free tier, custom domain `necogoode.com`)

## Local development

```bash
# Frontend (port 5173)
cd web
npm install
npm run dev

# Backend (port 7071) — separate terminal, requires Azure Functions Core Tools v4
cd api
npm install
func start
```

Set the Alpha Vantage API key for local backend by copying `api/local.settings.json.example` to `api/local.settings.json` and pasting your key.

## Five creations

| Ticker | Name | Status |
|---|---|---|
| GDGM | GoodeGame | live |
| SLIFT | SoloLift | live (real users) |
| VWPA | VibingWithPrimitiveAI | live |
| BSA | Byte-Sized Adventures | in-production |
| PIP | Primitive Infrastructure Protocol | strategic / patent-stage |

Source of truth: `web/src/data/creations.ts`. Both TechTour and BusTour read from this file.

## Deploy

See `docs/MORNING-CHECKLIST.md` for the deployment runbook.
