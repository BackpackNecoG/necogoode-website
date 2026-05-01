# Validation — necogoode.com

> **Build session:** 2026-05-01
> **Builder:** Claude (Opus 4.7) under Neco's run-dangerously authorization
> **Honesty rule:** if it didn't run or it broke, it's listed below. No hiding.

## Top-line

| Severity | Count | Summary |
|---|---|---|
| Critical | **0** | Site is live and functional. |
| Major | **2** | Counter scale-out drift (V2 Table Storage migration); GoDaddy DNS not yet pasted (manual step in MORNING-CHECKLIST.md). |
| Minor | **8** | Visual-fidelity simplifications, copy refinement, etc. |

## Status — what is live now

- ✅ **Live URL:** https://red-grass-099f84510.7.azurestaticapps.net
- ✅ All eight client routes return 200, including the React 404 fallback at unknown URLs
- ✅ `GET /api/alphavantage-status` returns `25/25` from prod
- ✅ `POST /api/alphavantage` proxies to Alpha Vantage and decrements the counter
- ✅ `ALPHAVANTAGE_KEY` is set as a SWA app setting (verified by listing key names; value never echoed)
- ✅ Local `AlphaVantage.txt` deleted (only after Azure verify, per spec)
- ✅ GitHub repo public at `BackpackNecoG/necogoode-website` with CI/CD wired
- ✅ $30/mo budget alert on the resource group with email notifications at 80% and 100%
- ✅ Custom domain validation tokens issued for `necogoode.com` (apex) and `www.necogoode.com`

## Critical (none)

## Major

### M1. Counter scale-out drift (carried over from initial build)
The in-memory counter in `api/shared/counter.js` is per-worker. Confirmed in production: the post-deploy smoke test showed `callsRemaining` reset from 24 → 25 after a worker recycle — exactly the V1 limitation we documented. The hard upstream cap from Alpha Vantage enforces the actual quota, so this is a UX issue (counter drift), not a quota-bypass risk.

**Recommendation:** V2 migrate to Azure Table Storage. The interface (`getRemaining`, `incrementCounter`, `getDailyLimit`) is stable, so the migration is contained. See `HANDOFF.md` V2 TODO #1.

### M2. GoDaddy DNS records not yet added (manual step)
Step 2–4 of `MORNING-CHECKLIST.md` requires Neco to paste DNS records into the GoDaddy DNS Manager and choose between an apex A record (canonical) or apex → www forwarding (simpler). I cannot reach GoDaddy from this harness.

**Tokens captured for paste:**
- Apex `necogoode.com` TXT: `_z0mpjhzvmo6yoarlmhtohgph6cjwb50`
- www `www.necogoode.com` TXT: `_k1b4dzs0foiw88oclkal9cvfw61v9n3`
- www CNAME target: `red-grass-099f84510.7.azurestaticapps.net.`

**Recommendation:** follow MORNING-CHECKLIST steps 2–5. Estimate: 15–25 min including DNS propagation + Azure validation + SSL provisioning.

## Minor (unchanged from initial build)

### m1. Splash door auto-redirect is intentionally off
Per spec, the cookie remembers the choice but does not redirect on return.

### m2. TechTour homepage is decorative — terminal input does not execute commands
Per spec, the IDE terminal pane is static for V1.

### m3. BusTour cards have hand-tuned tilt angles
Adding a 6th creation requires extending the `tilts` array in `web/src/routes/BusTour.tsx`.

### m4. Creations copy is placeholder
`web/src/data/creations.ts` is factually-accurate-but-placeholder. Voice/tone refinement needed before pitching.

### m5. News strip on /floor is hardcoded
Hand-written items will go stale within weeks.

### m6. Photo slots on BusCreation pages are placeholders
`web/public/screenshots/{slug}/` doesn't exist yet — replace `<PhotoSlot>` with `<img>` post-launch.

### m7. CDT/CST clock label is approximate
Marked `(Unverified)` in code. Off by a couple of days around DST switchover.

### m8. The `web/src/components/ui/` directory has no Modal primitive
Spec listed Modal as a UI primitive; no V1 page actually needed one. Add when V2 introduces a confirmation flow.

## Deploy-phase issues that were resolved live

These are not lingering issues — they are recorded so the failure modes are documented in case they recur:

### R1. Initial `gh secret set --body -` produced an invalid token
Symptom: `deployment_token provided was invalid`. Cause: stdin pipe extracted ~419 chars vs. the actual ~119-char token. Fix: re-fetched and set with `--body "$TOKEN"`.

### R2. SWA Action failed with "Function language info isn't provided"
Symptom: `Cannot deploy to the function app because Function language info isn't provided`. Cause: workflow had `skip_api_build: true`, which prevents Oryx from running on the API and Oryx is what supplies the runtime metadata. Fix: removed `skip_api_build` (commit `f3fa2d0`); kept `skip_app_build: true` because we pre-build the frontend with our exact TypeScript/Vite settings.

### R3. SPA fallback returned 404 for /TechTour, /BusTour, /floor
Symptom: only `/` worked in prod. Cause: `staticwebapp.config.json` was at the repo root but SWA expects it inside the deployed artifact (`web/dist/`). Fix: moved to `web/public/staticwebapp.config.json` so Vite copies it to `dist/` automatically (commit `afd840e`).

## What I tested in production

- ✅ All eight routes return 200
- ✅ `/api/alphavantage-status` returns the expected JSON
- ✅ `/api/alphavantage` with `{symbol:"NVDA"}` round-tripped through Alpha Vantage upstream (received Note about per-IP rate limit on rapid retest, but the proxy + counter both worked correctly)
- ✅ `/foo` (random URL) returns 200 with the React NotFound page (SPA fallback works)

## What I did NOT test

- ❌ Visual rendering in a real browser — no browser available from this harness
- ❌ Mobile viewports
- ❌ Production behavior under sustained load (single-instance only)
- ❌ DNS / custom domain — manual steps remain in MORNING-CHECKLIST
- ❌ SSL — auto-provisioned by Azure once DNS resolves; not yet exercised
