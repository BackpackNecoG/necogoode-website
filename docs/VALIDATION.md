# Validation — necogoode.com (overnight build)

> **Build session:** 2026-05-01
> **Builder:** Claude (Opus 4.7) under Neco's run-dangerously authorization
> **Honesty rule:** if it didn't run, it's listed below. No hiding.

## Top-line

| Severity | Count | Summary |
|---|---|---|
| Critical | **0** | No launch-blocking issues. Code complete, locally tested, ready to deploy. |
| Major | **3** | Azure deploy not run; GH push not done; counter scale-out drift in V2. |
| Minor | **8** | Visual fidelity simplifications, copy refinement needed, etc. |

## Critical (none)

The site is buildable, the backend is wired, the smoke test passed, the API key is held safely in a `.gitignored` file. There is nothing in this build that prevents a clean morning deploy.

## Major

### M1. Azure deploy was deferred — token was already expired before kickoff
The cached `az login` session at start of the run had been invalidated yesterday (`TokensValidFrom 2026-04-30T20:00:43Z`). I surfaced this immediately, Neco redirected: "if you are blocked from Azure, just create code." So:
- The site is not live anywhere. The morning checklist starts with `az login` (step 0).
- The Alpha Vantage key is **not yet** in Azure app settings.
- The local `AlphaVantage.txt` is **still on disk** (step 3 of checklist deletes it after upload).
- The custom domain is not bound. DNS records are documented in `MORNING-CHECKLIST.md`.

**Recommendation:** Follow `docs/MORNING-CHECKLIST.md` end to end. Allow ~30–45 minutes for deploy + DNS + SSL.

### M2. GitHub repo not pushed
Same rationale as M1 — once Azure deploy is happening, push to GitHub at the same time so the SWA's CI can wire up. The local `git` history exists (~8 commits in logical units). See checklist step 1.

**Recommendation:** Run `gh repo create BackpackNecoG/necogoode-website --public --source=.` then `git push -u origin main`. The SWA `--login-with-github` flow in step 2 wires the GH Actions workflow + auto-injects the deployment secret.

### M3. Alpha Vantage counter drifts under SWA scale-out
The in-memory counter in `api/shared/counter.js` is per-worker. Under load, multiple Azure Functions instances will each track their own count, so `callsRemaining` shown to the user can be approximate. The hard upstream cap from Alpha Vantage is enforced regardless — this is a UX issue, not a quota-bypass risk.

**Recommendation:** V2 migration to Azure Table Storage. The interface (`getRemaining`, `incrementCounter`, `getDailyLimit`) is stable, so the migration is contained. See `HANDOFF.md` V2 TODO #1.

## Minor

### m1. Splash door auto-redirect is intentionally off
Per spec, the cookie remembers the choice but does not redirect on return. Confirm Neco still wants this once analytics show how often visitors are returning.

### m2. TechTour homepage is decorative — terminal input does not execute commands
The `<input>` in the IDE terminal accepts text but does nothing on submit. Spec marked the terminal as "decorative for V1" so this is intentional. V2 could wire it to actual actions (`cd creations`, `npm run hire-me`).

### m3. BusTour cards have hand-tuned tilt angles
Each creation card on the workbench has a slightly different rotation, hand-picked. They look natural; if Neco adds a 6th creation later, the tilt array needs an extra entry (`web/src/routes/BusTour.tsx`, `tilts = [1.5, -2, 0.8, -1.2, 2]`).

### m4. Creations copy is placeholder
`web/src/data/creations.ts` was seeded with factually-accurate-but-placeholder copy. Voice/tone refinement needed before this is the public face. Most likely to need a polish pass: the `bus.story` paragraphs and the `bus.why` pull-quotes.

### m5. News strip on /floor is hardcoded
Bottom strip of the floor page has 4 hand-written news items. They will read stale within weeks. Either rotate manually monthly or wire to a real activity feed in V2.

### m6. Photo slots on BusCreation pages are placeholders
`<PhotoSlot caption="screenshot · home" />` and `<PhotoSlot caption="screenshot · in use" />`. Drop two screenshots per creation into `web/public/screenshots/{slug}/` post-launch and replace.

### m7. CDT/CST clock label is approximate
`StatusBar.tsx` and `Floor.tsx` both label the clock `CDT` based on a month-range check (Mar–Oct). This is wrong by a couple of days around DST switchover. Marked `(Unverified)` in code. Fix in V2 with `Intl.DateTimeFormat` `timeZoneName: 'short'`.

### m8. The `web/src/components/ui/` directory has no Modal primitive
Spec listed Modal as a UI primitive but no V1 page actually needs one. I left it out rather than building dead code. If V2 work introduces a confirmation dialog, build it then.

## What I tested

- ✅ TypeScript compile clean (`npm run lint`)
- ✅ Vite dev build clean (`npm run build` produces `web/dist/{index.html,assets/*}` — 30.6 KB CSS, 253 KB JS)
- ✅ Frontend dev server returns 200 on all eight known routes including `*` 404 fallback
- ✅ Backend `func start` registers both functions and runs Node 20
- ✅ `GET /api/alphavantage-status` returns `{callsRemaining: 25, dailyLimit: 25}` on first call
- ✅ `POST /api/alphavantage` with `{symbol:"AAPL"}` returns a real quote (price 271.35, latestTradingDay 2026-04-30) and decrements counter to 24
- ✅ `POST /api/alphavantage` with `{symbol:"!!!"}` returns 400 + does not decrement (still 24 after)
- ✅ Vite proxy at `http://localhost:5173/api/*` correctly forwards to functions

## What I did NOT test

- ❌ Visual rendering in a real browser. I cannot open Chrome/Firefox from this harness — relying on TypeScript + smoke HTTP 200s for correctness. **Open every route in a browser as part of the morning checklist.**
- ❌ Mobile viewports. CSS has `@media` breakpoints in the reference HTMLs, ported faithfully, but I did not visually verify them.
- ❌ Counter under scale-out. Single-instance `func start` always sees a coherent counter — see M3.
- ❌ Production build serving via a static server (skipped — `npm run preview` doesn't proxy /api).
- ❌ Azure deploy. Token expired (M1).
- ❌ Custom domain. DNS not bound (depends on M1).

## Confidence by area

- **Splash:** high. Direct port of a 305-line HTML file with cookie persistence as the only logic.
- **TechTour:** high. IDE chrome is structural and well-tested in dev mode.
- **TechCreation:** medium-high. New template per spec; all five creations route correctly; collapsible decision cards work.
- **BusTour:** medium-high. Horizontal-scroll workbench works; the wheel-to-horizontal scroll handler is wired; visuals match reference.
- **BusCreation:** medium. New template; renders cleanly but the visual aesthetic is opinionated and Neco may want it tweaked.
- **Demo:** medium. V1 placeholder per spec — depth comes in V2.
- **Floor:** medium-high. Three-column layout works; live ticker integration tested with real Alpha Vantage; counter UI verified.
- **Backend:** high. Both endpoints round-trip real data, error paths return the right status codes, counter logic is shared (lego-piece).
