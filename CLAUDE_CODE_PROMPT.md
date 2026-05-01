# necogoode.com — Claude Code Overnight Build Prompt

**Target:** Static personal portfolio site, deployed to Azure Static Web Apps, mapped to necogoode.com via GoDaddy DNS, with an Alpha Vantage-backed live ticker page.

**Mode:** Run dangerously. Overnight unattended build. Neco wakes up with the site built, locally verified, pushed to GitHub, and deployed to Azure Static Web Apps with a working `*.azurestaticapps.net` URL. Custom domain DNS records will be printed in `docs/MORNING-CHECKLIST.md` for manual GoDaddy update.

**Project root:** `C:\Claude\NecoGoodedotcom\`

**Reference designs:** Three HTML mockups are saved separately in your `/mnt/user-data/outputs/necogoode-v3/` and `/mnt/user-data/outputs/necogoode-v4/` and `/mnt/user-data/outputs/necogoode-v2/` folders. The user will copy them into `C:\Claude\NecoGoodedotcom\docs\reference\` before kickoff. They are: `O-ide.html` (TechTour homepage), `H-workshop.html` (BusTour homepage), `L-trading-floor.html` (the /floor page). The splash door reference is in `/mnt/user-data/outputs/necogoode-final/00-splash-door.html`.

---

## PASTE EVERYTHING BELOW THIS LINE INTO CLAUDE CODE

---

You are building **necogoode.com**, a personal portfolio site for Renneco "Neco" Goode. Follow these instructions precisely.

## Code Integrity Rules (non-negotiable)

- All code factually accurate, syntactically valid, copy-paste ready
- No placeholders unless explicitly marked `YOUR_X_HERE`
- Comment critical steps
- Label uncertain areas `// (Unverified)` or `// (Environment-Specific)`
- Never guess variable names, paths, or endpoint structures
- Build every UI element as a small reusable component — no duplicated JSX

## Project Location & Structure

Create `C:\Claude\NecoGoodedotcom\` with this structure:

```
C:\Claude\NecoGoodedotcom\
├── api\                            # Azure Functions backend (Node.js)
│   ├── alphavantage\               # ticker proxy + daily counter
│   │   ├── function.json
│   │   └── index.js
│   ├── alphavantage-status\        # GET remaining-calls counter
│   │   ├── function.json
│   │   └── index.js
│   ├── host.json
│   ├── package.json
│   └── local.settings.json         # gitignored
├── web\                            # Vite + React + TS frontend
│   ├── src\
│   │   ├── components\
│   │   │   ├── ui\                 # primitives: Button, Card, Tag, etc.
│   │   │   └── domain\             # CreationCard, StackChip, etc.
│   │   ├── routes\
│   │   │   ├── Splash.tsx          # / route
│   │   │   ├── TechTour.tsx        # /TechTour homepage (IDE)
│   │   │   ├── BusTour.tsx         # /BusTour homepage (Workshop)
│   │   │   ├── TechCreation.tsx    # /TechTour/creations/:slug
│   │   │   ├── BusCreation.tsx     # /BusTour/creations/:slug
│   │   │   ├── Demo.tsx            # /demo/:slug shared by both branches
│   │   │   └── Floor.tsx           # /floor (Trading Floor + ticker)
│   │   ├── data\
│   │   │   └── creations.ts        # single source of truth for project content
│   │   ├── styles\
│   │   │   └── theme.css
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── public\
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
├── docs\
│   ├── reference\                  # original HTML mockups (provided)
│   │   ├── 00-splash-door.html
│   │   ├── O-ide.html
│   │   ├── H-workshop.html
│   │   └── L-trading-floor.html
│   ├── MORNING-CHECKLIST.md        # Neco reads this on wake
│   ├── ARCHITECTURE.md
│   ├── HANDOFF.md
│   └── VALIDATION.md
├── infra\
│   └── deploy.bicep                # Azure infra-as-code
├── .github\
│   └── workflows\
│       └── azure-static-web-apps.yml
├── .gitignore
├── README.md
└── staticwebapp.config.json        # routing rules for Azure
```

## Tech Stack (locked)

**Frontend:**
- React 18 + Vite + TypeScript
- React Router v6
- Tailwind CSS (configured to support all three direction palettes via CSS custom properties)
- Google Fonts: Fraunces, JetBrains Mono, Inter, Caveat (for Workshop hand-lettered accents)
- Cookie-based path persistence (no auth needed for V1)
- All routes pre-rendered or client-side; no SSR

**Backend (Azure Functions, Node.js 20):**
- Two HTTP-triggered functions:
  - `alphavantage` — POST `{symbol}` → proxies to Alpha Vantage GLOBAL_QUOTE endpoint, decrements daily counter
  - `alphavantage-status` — GET → returns `{callsRemaining, dailyLimit, attribution}`
- Daily counter persists in Azure Table Storage (or a simple in-memory + restart-resilient JSON blob)
- Daily counter resets at midnight UTC
- Free tier limit: **25 calls/day** (Alpha Vantage free tier as of 2026)

**Hosting:**
- Azure Static Web Apps (free tier supports custom domains + Azure Functions)
- Custom domain: `necogoode.com` (DNS managed at GoDaddy by Neco manually)
- Resource group: `rg-necogoode-prod`
- Region: `Central US` (matches Neco's preference per memory)
- Subscription: paid, on tenant `backpackapprentice.onmicrosoft.com`, account `necog@backpackapprentice.onmicrosoft.com`

## Authentication & Secrets

**Alpha Vantage API key handling — CRITICAL EXECUTE EXACTLY:**

1. Read the key from `C:\Claude\NecoGoodedotcom\Alphavantage.txt` (already exists, placed there by Neco before kickoff)
2. Store it as an Azure Static Web App application setting named `ALPHAVANTAGE_KEY` via `az staticwebapp appsettings set`
3. Verify the setting was successfully applied by listing app settings and confirming `ALPHAVANTAGE_KEY` exists (do NOT print the value to logs)
4. **Only after verified successful upload to Azure**, delete `C:\Claude\NecoGoodedotcom\Alphavantage.txt` from the local filesystem
5. Never commit the key to git, never print it to terminal logs, never echo it

The backend function reads `process.env.ALPHAVANTAGE_KEY` at request time. Frontend never sees the key — it calls `/api/alphavantage` which proxies the request.

**Azure auth:** Run `az login` interactively before unattended phase begins (Neco will do this). Then proceed unattended.

## The Five Creations (data)

Single source of truth at `web/src/data/creations.ts`. Each creation has both a TechTour and BusTour version of the description, plus shared metadata.

```typescript
export type Creation = {
  slug: string;            // url-friendly
  ticker: string;          // GDGM, SLIFT, VWPA, BSA, PIP
  name: string;
  status: 'live' | 'in-production' | 'strategic';
  // TechTour content
  tech: {
    tagline: string;       // one-line for tech audience
    summary: string;       // 2-3 paragraphs, technical
    stack: string[];       // chips
    decisions: { title: string; body: string }[];  // architecture decisions
    repo?: string;         // github url if public
  };
  // BusTour content
  bus: {
    tagline: string;       // one-line for non-technical audience
    story: string;         // 2-3 paragraphs, narrative
    why: string;           // why I built it
    forWhom: string;       // who it's for
  };
  // Shared
  liveUrl?: string;        // production url if applicable
  demoUrl?: string;        // /demo/:slug path
  metrics?: {              // optional, for /floor
    label: string;
    value: string;
    trend: 'up' | 'flat' | 'down' | 'in-progress';
  }[];
};
```

Seed with these five (Neco will refine copy later — use these placeholders that are factually accurate based on what's known):

1. **GoodeGame (GDGM)** — invitation-only golf community. Tech: .NET 10 + React + Postgres + Azure. Status: live.
2. **SoloLift (SLIFT)** — production SaaS with real users. Status: live, real users. Tech: SaaS multi-tenant, Azure.
3. **VibingWithPrimitiveAI (VWPA)** — public-facing platform for the PrimitiveAI brand. Tech: .NET + React + Azure. Status: live.
4. **Byte-Sized Adventures (BSA)** — animated educational series for children featuring family-modeled characters. Status: in-production.
5. **PIP (PIP)** — Primitive Infrastructure Protocol. Status: strategic / patent-stage.

## Routing & Page Structure

| Route | Component | Reference |
|---|---|---|
| `/` | Splash door | `docs/reference/00-splash-door.html` |
| `/TechTour` | IDE-style homepage | `docs/reference/O-ide.html` |
| `/TechTour/creations/:slug` | Technical creation page | New, see template below |
| `/BusTour` | Workshop-style homepage | `docs/reference/H-workshop.html` |
| `/BusTour/creations/:slug` | Business creation page | New, see template below |
| `/demo/:slug` | Shared demo page | New, see template below |
| `/floor` | Trading Floor with live ticker | `docs/reference/L-trading-floor.html` + Alpha Vantage integration |

**Splash door persistence:** Cookie `ng_path` records choice. Returning visitors with cookie set still see the splash unless explicitly bypassed (do NOT auto-redirect — visitors should be able to take the other path).

**Cross-tour navigation:** From `/TechTour/creations/:slug` there's a small link "View this creation in Business Tour →" and vice versa. Both link to `/demo/:slug` for the shared demo.

## Page Templates

### TechCreation page (`/TechTour/creations/:slug`)

- Maintains IDE aesthetic from O-ide.html
- File-tree breadcrumb at top
- Main content area is the creation's tech writeup styled like a markdown file with syntax highlighting
- Right sidebar: stack chips, architecture decisions as collapsible cards, link to live URL
- Bottom: "Open this creation's pipeline" linking back to `/floor` filtered to that ticker

### BusCreation page (`/BusTour/creations/:slug`)

- Maintains Workshop aesthetic from H-workshop.html
- Hero with the creation's "name + tagline" big and serif
- Story-form prose, generously spaced, Fraunces serif, no jargon
- Pull-quotes pulled from the `bus.why` field
- Photo placeholders (Neco will add screenshots later)
- Bottom: "Take the technical tour of this creation →"

### Demo page (`/demo/:slug`)

- Shared between branches
- For V1 this is a "coming soon" page with: project name, status badge, link to live URL if exists, screenshot placeholders, and a "what you'd be able to do here" preview list
- Architecture for V2 (don't build now, just leave a `// TODO V2:` comment block) is the multi-tenant demo flow with seeded data

### Floor page (`/floor`)

The Trading Floor from L-trading-floor.html, with these specific working features:

**Top ticker tape** — animated CSS scroll, shows status of all five creations (static for V1)

**Center watchlist table** — five creations as rows. Each row shows ticker, name, stack/metric, activity (latest commit-like message, can be hardcoded for V1), trend, status. Clickable to TechCreation page.

**Bottom-right command prompt** — wired to Alpha Vantage:
- User types a stock symbol (e.g., `AAPL`, `MSFT`)
- Frontend POSTs to `/api/alphavantage` with `{symbol}`
- Backend calls Alpha Vantage GLOBAL_QUOTE, returns `{symbol, price, change, percentChange, latestTradingDay, callsRemaining}`
- Result displays inline below the prompt as a new "ticker entry" in the same visual style as the watchlist
- On error or zero remaining calls, display the appropriate message in the prompt area
- **Counter widget** above the prompt: "Alpha Vantage Free Tier · X / 25 calls remaining today"
  - Hover state shows tooltip: "Powered by Alpha Vantage's free tier API. Limit resets at midnight UTC. We attribute all financial data to Alpha Vantage. https://www.alphavantage.co/"
  - When `callsRemaining === 0`, the input is disabled with placeholder text "Daily Alpha Vantage limit reached — resets at midnight UTC"

**Attribution footer on /floor:** Small text "Financial data provided by Alpha Vantage (free tier). Site projects shown above are owned by Renneco Goode."

## Backend: Alpha Vantage Functions

### `api/alphavantage/index.js`

```javascript
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const DAILY_LIMIT = 25;
const COUNTER_KEY = 'av_counter';

// Simple counter using Azure Table Storage or fallback to in-memory
// (Neco: for V1, in-memory is fine because Static Web Apps Functions are short-lived;
//  V2 should migrate to Table Storage for cross-instance accuracy. Mark as // TODO V2.)
let counterCache = { date: null, used: 0 };

function getTodayKey() {
  return new Date().toISOString().substring(0, 10); // YYYY-MM-DD UTC
}

function getRemaining() {
  const today = getTodayKey();
  if (counterCache.date !== today) {
    counterCache = { date: today, used: 0 };
  }
  return DAILY_LIMIT - counterCache.used;
}

function incrementCounter() {
  const today = getTodayKey();
  if (counterCache.date !== today) {
    counterCache = { date: today, used: 0 };
  }
  counterCache.used += 1;
}

module.exports = async function (context, req) {
  const symbol = (req.body && req.body.symbol || '').toUpperCase().trim();

  if (!symbol || !/^[A-Z.]{1,10}$/.test(symbol)) {
    context.res = { status: 400, body: { error: 'Invalid symbol' } };
    return;
  }

  if (getRemaining() <= 0) {
    context.res = {
      status: 429,
      body: {
        error: 'Daily Alpha Vantage limit reached',
        callsRemaining: 0,
        dailyLimit: DAILY_LIMIT,
      },
    };
    return;
  }

  const key = process.env.ALPHAVANTAGE_KEY;
  if (!key) {
    context.res = { status: 500, body: { error: 'API key not configured' } };
    return;
  }

  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
    const resp = await fetch(url);
    const data = await resp.json();

    incrementCounter();

    const quote = data['Global Quote'] || {};
    if (!quote['01. symbol']) {
      context.res = {
        status: 404,
        body: {
          error: `No quote found for ${symbol}`,
          callsRemaining: getRemaining(),
        },
      };
      return;
    }

    context.res = {
      status: 200,
      body: {
        symbol: quote['01. symbol'],
        price: parseFloat(quote['05. price']),
        change: parseFloat(quote['09. change']),
        percentChange: quote['10. change percent'],
        latestTradingDay: quote['07. latest trading day'],
        callsRemaining: getRemaining(),
        dailyLimit: DAILY_LIMIT,
        attribution: 'Alpha Vantage (free tier)',
      },
    };
  } catch (err) {
    context.log.error('Alpha Vantage fetch failed', err);
    context.res = { status: 502, body: { error: 'Upstream API error' } };
  }
};
```

### `api/alphavantage-status/index.js`

```javascript
// Returns the remaining-calls counter without spending a call.
// Imports the counter logic from a shared module; for V1 it's fine to duplicate.
module.exports = async function (context, req) {
  // Same counter logic as above. Extract to shared util if time permits.
  context.res = {
    status: 200,
    body: {
      callsRemaining: /* read from same counter source */ 25,
      dailyLimit: 25,
      attribution: 'Alpha Vantage (free tier)',
      attributionUrl: 'https://www.alphavantage.co/',
    },
  };
};
```

**On page load, /floor calls `/api/alphavantage-status` once to populate the counter widget.** Every successful POST to `/api/alphavantage` returns the updated `callsRemaining` so the widget can be updated client-side without another status call.

## Design System

CSS custom properties in `web/src/styles/theme.css` covering all three palettes:

```css
:root {
  /* TechTour (IDE — Catppuccin-inspired) */
  --tech-bg: #1E1E2E;
  --tech-bg-soft: #181825;
  --tech-line: #313244;
  --tech-text: #CDD6F4;
  --tech-text-soft: #A6ADC8;
  --tech-accent: #89B4FA;
  --tech-keyword: #CBA6F7;
  --tech-string: #A6E3A1;
  --tech-comment: #6C7086;

  /* BusTour (Workshop — wood + paper) */
  --bus-wood-deep: #3E2A14;
  --bus-wood: #6B4226;
  --bus-paper: #FBF5E4;
  --bus-paper-warm: #F2EBDB;
  --bus-ink: #2A1F12;
  --bus-rust: #B05A2C;
  --bus-brass: #B8893C;

  /* Floor (Trading Floor — Bloomberg) */
  --floor-bg: #0E0F11;
  --floor-bg-soft: #16181B;
  --floor-line: #2C3036;
  --floor-text: #E8E6E0;
  --floor-amber: #F2B450;
  --floor-gain: #6FCF97;
  --floor-loss: #E07060;

  /* Splash (shared) */
  --splash-bg: #0A0B0F;
  --splash-tech: #5EEAD4;
  --splash-bus: #FBBF77;
}
```

Each route applies its own palette via a wrapper class.

## Build Order (execute sequentially, run dangerously)

1. **Scaffold:** Create folder structure, `.gitignore` (must exclude `Alphavantage.txt`, `local.settings.json`, `node_modules`, `dist`, `.env*`)
2. **Frontend scaffold:** Vite + React + TypeScript + React Router v6 + Tailwind, configured. Verify `npm run dev` succeeds locally on port 5173.
3. **Backend scaffold:** Azure Functions Core Tools project in `api/`, two functions stubbed. Verify `func start` succeeds locally on port 7071.
4. **Theme system:** Create `theme.css` with all three palettes, import in `main.tsx`, set up route-wrapper classes that scope the active palette.
5. **Reusable components:** Build all UI primitives (Button, Card, Tag, Chip, Modal, Input, Section, Heading) — each in its own file, used everywhere else.
6. **Splash door route (`/`):** Port `docs/reference/00-splash-door.html` to React. Cookie persistence on click. Verify visually matches reference.
7. **TechTour homepage (`/TechTour`):** Port `docs/reference/O-ide.html` to React. File tree links to `/TechTour/creations/:slug`. Terminal at bottom is decorative for V1. Verify visually matches reference.
8. **BusTour homepage (`/BusTour`):** Port `docs/reference/H-workshop.html` to React. Each creation card links to `/BusTour/creations/:slug`. Horizontal scroll behavior preserved. Verify visually matches reference.
9. **Creations data (`web/src/data/creations.ts`):** Seed with the five creations using factually-accurate placeholders.
10. **TechCreation page (`/TechTour/creations/:slug`):** Built per template above. Reads from `creations.ts`. Cross-tour link present.
11. **BusCreation page (`/BusTour/creations/:slug`):** Built per template above.
12. **Demo page (`/demo/:slug`):** V1 placeholder per template. `// TODO V2:` block for multi-tenant demo flow.
13. **Floor page (`/floor`):** Port `docs/reference/L-trading-floor.html` to React. Watchlist rows clickable to TechCreation pages. Ticker prompt wired to backend.
14. **Backend Alpha Vantage function:** Implement per spec above. Counter logic shared between `alphavantage` and `alphavantage-status`. `// TODO V2: migrate counter to Azure Table Storage` comment included.
15. **Local end-to-end smoke test:** Run frontend on 5173, backend on 7071, verify:
    - Splash → TechTour → creation → demo flow works
    - Splash → BusTour → creation → demo flow works
    - /floor loads, counter widget shows "25 / 25", typing AAPL fetches a quote, counter decrements
    - Hover state on counter shows attribution tooltip
    - Cross-tour links work
    - 404 page exists for unknown routes
16. **`staticwebapp.config.json`:** Configure routing so `/TechTour/*` and `/BusTour/*` and `/demo/*` and `/floor` all fall back to `index.html` for client-side routing. API routes go to `/api/*`.
17. **`.github/workflows/azure-static-web-apps.yml`:** GitHub Actions workflow for Azure Static Web Apps deployment, triggered on push to main.
18. **Git init + initial commit:** clean tree, descriptive commit messages broken into logical units (scaffold, splash, techtour, bustour, creations, floor, alphavantage, deploy-config).
19. **Push to GitHub:** Create new public repo `necogoode/portfolio` (or `necogoode/necogoode-website` — whichever is available) under Neco's account, push main branch.
20. **Azure deployment:** Use Azure CLI to:
    - Create resource group `rg-necogoode-prod` in `Central US`
    - Create Static Web App `swa-necogoode-prod` linked to the GitHub repo (this auto-configures the GitHub Actions workflow)
    - Wait for first deployment to complete
    - Read `Alphavantage.txt`, set `ALPHAVANTAGE_KEY` app setting via `az staticwebapp appsettings set`
    - Verify the setting is present
    - **Delete `C:\Claude\NecoGoodedotcom\Alphavantage.txt` from local filesystem ONLY after successful verification**
    - Print the `*.azurestaticapps.net` URL to `docs/MORNING-CHECKLIST.md`
21. **Custom domain prep:**
    - Run `az staticwebapp hostname add --hostname necogoode.com` and capture the TXT validation record + the CNAME target
    - Run `az staticwebapp hostname add --hostname www.necogoode.com` and capture records
    - Write the exact GoDaddy DNS records Neco needs to add to `docs/MORNING-CHECKLIST.md`
    - DO NOT bind the hostname yet — that fails until DNS resolves
22. **Spending guardrail:** Set a $30/month budget alert on the resource group at 80% and 100% via `az consumption budget create`. If that command isn't available in the user's Azure CLI version, document the manual portal step in the morning checklist.
23. **Documentation:**
    - `docs/MORNING-CHECKLIST.md` — exact steps Neco does on wake (verify Azure URL works, paste DNS records into GoDaddy, run hostname bind command, verify SSL provisions, smoke test)
    - `docs/ARCHITECTURE.md` — high-level architecture, data flow, decisions
    - `docs/HANDOFF.md` — known gaps, V2 TODOs, where to harden
    - `docs/VALIDATION.md` — honest self-assessment in the format Neco uses for SoloLift overnight builds: critical/major/minor findings, count each, no hiding problems
24. **Final smoke test:** From `docs/MORNING-CHECKLIST.md`, attempt to execute every step except the GoDaddy/manual ones. Confirm Azure URL returns 200 on `/`, `/TechTour`, `/BusTour`, `/floor`. Confirm `/api/alphavantage-status` returns 200 with counter info.

## What NOT To Do

- Do not skip the local smoke test before deploying
- Do not commit `Alphavantage.txt` (it should already be in `.gitignore`, but verify)
- Do not echo the Alpha Vantage key to console anywhere
- Do not bind the custom hostname before DNS resolves (it will fail and require backout)
- Do not invent stack details about the five creations beyond what's specified — use generic-but-truthful placeholders Neco can refine
- Do not introduce features outside this spec (no blog, no newsletter, no contact form backend, no auth)

## Morning Checklist Output Format

`docs/MORNING-CHECKLIST.md` must contain, exactly:

```markdown
# Morning Checklist — necogoode.com

## 1. Verify Azure deployment is live
URL: https://<actual-swa-url>.azurestaticapps.net

Open and confirm:
- [ ] Splash door loads at /
- [ ] /TechTour loads
- [ ] /BusTour loads
- [ ] /floor loads, counter shows X / 25
- [ ] Type AAPL into ticker, see real quote, counter decrements

## 2. Add GoDaddy DNS records
Log into GoDaddy DNS Manager for necogoode.com, add:

[exact records here, one per line, copy-paste ready]

Wait 5–15 minutes for DNS propagation. Verify with:
```
nslookup necogoode.com
```

## 3. Bind custom domain in Azure
Once DNS resolves:
```
az staticwebapp hostname set --name swa-necogoode-prod --hostname necogoode.com
az staticwebapp hostname set --name swa-necogoode-prod --hostname www.necogoode.com
```

## 4. Verify SSL certificate provisions
Azure auto-provisions Let's Encrypt SSL. Wait ~5 minutes. Verify:
- [ ] https://necogoode.com loads with green lock
- [ ] https://www.necogoode.com loads

## 5. Set hard spending cap (optional, recommended)
[link to Azure portal location]
```

## First Action

Before writing any code, respond with:

1. Confirmation that you have read and understood this entire prompt
2. The exact subscription ID you will use after `az account list`
3. Any ambiguities you want resolved before starting
4. The estimated runtime in minutes for the unattended build phase

Then begin scaffolding. Run dangerously per Neco's standing instruction. Neco is logging off and will return in the morning to the morning checklist.
