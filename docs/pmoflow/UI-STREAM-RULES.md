# Rules shared by UI streams D, P, R

1. **Read first:** `docs/pmoflow/CONTRACTS.md` (all of it), `web/public/concepts/pmoflow/app/{store.js, ui.js, main.js, styles.css}`, and `web/public/concepts/pmoflow/v2.html`.
   - v2 is the **owner-approved visual language**: cards, vertical map, nodes, chips, badges, KPI tiles, timeline. Reuse its classes from `styles.css`. Don't restyle the base.
   - Your own CSS goes **only** in your stream file: `app/css/design.css` (D), `app/css/pmo.css` (P), `app/css/release.css` (R).
2. **Page modules** export `render(params) -> html` and `bind(root, params)`.
   - Use `store` for all data. Writes go through `store.save` / `store.remove`, with a human-readable `summary` (it appears in history).
   - Escape all user text with `esc()`. Engine functions come from `E()` (`window.PMOEngine`) using the contract names.
   - Never assume a doc exists. Render a friendly empty state.
3. **Detail pages** include `activityCard(ref)` (comments + history) and call `bindActivity(root)` in `bind`.
4. **Persona:** actions are attributed to `store.state.me`. Permission-gated actions (approvals, grant approval) check the persona and explain who can act when disabled.
5. **Mobile:** at 390 px wide there must be no horizontal page overflow. Wide tables go in `.tbl-wrap`. Grids collapse.
6. **Concurrency:** streams A (API) and E (engine) are being built at the same time as you.
   - Write your code against the contract first.
   - Before testing, wait until both `api/pmoflow/index.js` and `api/shared/pmoflow-engine.js` exist **and** `node --test tests/pmoflow/engine.test.js` passes. Poll with `sleep 60` loops, up to 45 minutes.
   - If something in their output contradicts the contract, adapt on your side when it's trivial. Otherwise list it in your report. Don't edit their files.
7. **Testing:** run `PMOFLOW_STORAGE_FILE=~/.pmoflow-storage.conn node tests/pmoflow/devserver.js <yourPort>` in the background. Never print that file's contents.
   - Write `tests/pmoflow/e2e-<stream>.js` (Playwright via `require('playwright')`; `chromium.launch()` needs no options). It must:
     - use a fresh context, so you get a fresh sandbox workspace;
     - visit every page you own;
     - perform every create/edit/delete flow you built;
     - reload and assert persistence;
     - check the history panel shows the change;
     - assert zero `pageerror` and zero console errors;
     - assert `document.documentElement.scrollWidth <= innerWidth + 1` at 1440 and at 390;
     - save screenshots to `/tmp/pmo-<stream>/`.
   - Look at the screenshots yourself with the Read tool, and fix visual problems (clutter, overflow, unreadable layouts) before finishing.
8. **Don't** edit files outside your list, git commit or push, or use any real company, client or person name (fictional Northwind only).
9. **Final report, under 250 words:** pages and flows built, e2e result (counts), known gaps, and requests to the lead.
