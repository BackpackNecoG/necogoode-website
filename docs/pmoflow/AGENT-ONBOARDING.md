# Onboarding for PMOFlow builder agents (read fully)

- **Repo:** /home/claude/necogoode-website. Read `docs/pmoflow/` in this order:
  1. `CONCEPT-BRIEF.md`
  2. `UI-STREAM-RULES.md` (follow it)
  3. `CONTRACTS.md`
  4. `CONTRACTS-R2.md`
  5. `CONTRACTS-R3.md`
  6. `CONTRACTS-R4.md`, `CONTRACTS-R5.md`, `CONTRACTS-R6.md` , `CONTRACTS-R7.md`, `CONTRACTS-R8.md` (R8 is the current round: ONE TRUTH, NO MAKE-WORK; Rule #1 still governs)

  Later deltas win over earlier ones.
- **Shared client code (lead-owned):** `web/public/concepts/pmoflow/app/{store.js, ui.js, main.js, styles.css}`. Read them; don't edit them. If you need a change, put it in your report.
- **Storage connection:** the file is `/home/claude/.pmoflow-storage.conn`. Use the full path, because HOME is `/root`. **Never print it.**
- **Dev server:** `nohup env PMOFLOW_STORAGE_FILE=/home/claude/.pmoflow-storage.conn node tests/pmoflow/devserver.js <port> > /tmp/dev<port>.log 2>&1 &`
  - Stop it with `fuser -k <port>/tcp`. **Never use `pkill -f`**: it kills other agents' servers and shells.
- **Playwright:** `require('playwright')`; `chromium.launch()` takes no options. Use a fresh context with a random `x-forwarded-for: 198.51.100.<n>` header, because sandbox creation is rate-limited per IP.
- **The engine is shared:** `api/shared/pmoflow-engine.js` must stay byte-identical to `web/public/concepts/pmoflow/app/engine.js`.
- **Before UI testing,** wait until `node --test tests/pmoflow/engine.test.js tests/pmoflow/api.test.js` passes **and** the round's new engine functions exist. Poll with `sleep 60`, for up to 45 minutes.
- **Rules:**
  - No git commits.
  - Edit only the files your stream owns.
  - Fictional Northwind data only.
  - Zero console errors.
  - No horizontal overflow at 390 px.
  - Read your screenshots and fix what looks wrong.
