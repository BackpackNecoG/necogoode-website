# Handoff — necogoode.com

This is the gap list. Things that were intentionally deferred, things that need post-launch attention, and the V2 work that was scoped out of V1.

## V2 TODOs (intentional deferrals)

### 1. Migrate the Alpha Vantage counter to Azure Table Storage
**File:** `api/shared/counter.js`
**Why:** in-memory counter resets on Azure Functions worker cold start, and under scale-out each instance has its own counter. The displayed `callsRemaining` is approximate. The upstream Alpha Vantage rate limit enforces the hard cap regardless, so it's a UX issue, not a billing risk.
**How:** swap the in-memory `counterCache` for a Table Storage row keyed by today's UTC date. The interface (`getRemaining`, `incrementCounter`, `getDailyLimit`) stays stable; only the implementation changes.

### 2. Build the multi-tenant interactive demos
**Files:** `web/src/routes/Demo.tsx` (placeholder lives here, search for `// TODO V2:`)
**Why:** scoped out of V1. Each upstream creation needs multi-tenancy retrofit so a visitor can poke around a sandboxed demo tenant.
**How:** seed each upstream creation with a `demo` tenant; add a guided-tour overlay component; auto-tear-down after 24h.

### 3. Real screenshots in BusCreation pages
**Files:** `web/src/routes/BusCreation.tsx` — `<PhotoSlot>` placeholders
**Why:** I don't have access to take screenshots of the live products.
**How:** capture two screenshots per creation (home + in-use) at 1600×1200 webp, drop into `web/public/screenshots/{slug}/`, swap the `<PhotoSlot>` for `<img>`.

### 4. Animated "Mr. Goode brain-opening" homepage
**Why:** spec V2. Wait until Byte-Sized Adventures pipeline is ready — the same pipeline produces the Mr. Goode character.

### 5. Hover-hotspots on demo pages
**Why:** spec V2. Pairs with the multi-tenant demo flow.

## Visual fidelity gaps from the reference HTMLs

The React port preserves the **structure and palette** of each reference HTML faithfully but I did not pixel-match every micro-detail. Notable simplifications:

- **Splash door:** ported in full. Cookie persistence works; auto-redirect is intentionally **not** implemented per spec.
- **TechTour homepage:** the syntax-highlighted README content is hand-recreated as JSX `<span>` tokens. The `class="line-active"` highlight only applies to one specific line in the reference; in the React port it's applied to the same line (line 9).
- **TechCreation pages:** the IDE chrome is reused but the markdown content is generated from `creations.ts`, not hand-authored. The terminal pane on these pages shows a deterministic git-log of architecture decisions instead of the homepage's static text.
- **BusTour homepage:** workshop layout matches. Each creation's hand-styled visual (globe / dashboard / wheel / characters / blueprint) is recreated as a React component in `components/domain/workshop/visuals.tsx`.
- **BusCreation pages:** new template per spec; uses the same paper aesthetic but is a single-column long-form story page (the reference HTML did not include this layout).
- **Floor page:** ticker tape is static for V1 (spec said "static for V1"). Watchlist rows clickable. Ticker prompt wired to backend. News strip is hardcoded — those are placeholder stories and Neco should refresh them periodically.

## Things to refresh post-launch

- `web/src/data/creations.ts` — copy was hand-written as a factually-accurate placeholder. Neco should refine voice/tone before showing this to anyone he's actually pitching.
- `web/src/components/domain/floor/TickerTape.tsx` — the ticker headlines are placeholders.
- `web/src/routes/Floor.tsx` — the news-strip items are placeholders. Wire to a real activity feed in V2 (or just rotate the strings monthly).

## Operational reminders

- **Add an `email forwarding rule` for `hello@necogoode.com`** at GoDaddy or Microsoft 365 once the domain is bound. The Floor page advertises this address.
- **Linkedin URL** uses `/in/necogoode` per the reference; if Neco's LinkedIn handle is different, update `Floor.tsx` and `BusTour.tsx`.
- **GitHub URL** uses `@BackpackNecoG` (the actual handle); if Neco wants to register `@necogoode` and migrate, update both.

## Things I deliberately did NOT do

- **Did not push to GitHub.** Per Neco's mid-build redirect ("if you are blocked from Azure, just create code"), the local repo is committed but never pushed. See `MORNING-CHECKLIST.md` step 1.
- **Did not deploy to Azure.** Token was expired. See `MORNING-CHECKLIST.md` step 0.
- **Did not delete `AlphaVantage.txt`.** Spec mandates deletion only AFTER successful upload to Azure app settings. The file lives on at `C:\Claude\NecoGoodedotcom\AlphaVantage.txt` and is `.gitignored`. Step 3 of the checklist deletes it.
- **Did not add a contact form backend.** Per spec V2 deferral. `mailto:hello@necogoode.com` is the V1 fallback.
- **Did not bind the custom hostname.** Spec mandates this only after DNS resolves. See checklist step 5–6.

## Files Neco may want to inspect first

- `web/src/data/creations.ts` — copy review
- `docs/VALIDATION.md` — honest self-assessment with critical/major/minor counts
- `web/src/routes/Floor.tsx` — only V1 page with real backend dependency
