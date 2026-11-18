# PMOFlow R12: Close the R11 review findings

**Input:** `market-review/r11/CONSOLIDATED-R11.md`. §3 lists the 13 ranked fixes. The four reviewer files in that folder hold the exact repro steps.

**Bar:** the same fixed bar as R10/R11; it does not move. New findings go to `R13-BACKLOG.md`.

**Rules:** Rule #1 (ease for non-technical users), the positioning, and the banned words from R10 all still apply.

## Streams

The engine has a single owner. Every stream owns whole files. Each item number refers to CONSOLIDATED-R11 §3.

### H1: Governance and numbers (the engine owner)

**Files:**
- `api/shared/pmoflow-engine.js` and its web copy, `engine.test.js`
- `pages/release.js`, `pages/testing.js`, `css/release.css`
- `api/pmoflow/index.js`, `pmoflow-seed.js`, `pmoflow-ai.js`, `api.test.js`
- `e2e-release.js`, `e2e-consistency.js`, `GOLDEN-NUMBERS.md`

**Items:**
- **#1, engine side: department routing.**
  - Approvals come from an explicit `teams → approving department` mapping on the process.
  - Teams found at import seed the mapping (H2 builds the UI). There is **no default team**, ever. An unmapped team shows "Choose who approves for <team>".
  - Re-approval reopens **only** the departments whose own steps changed, with a from→to reason.
- **#2: truthful approver identity.**
  - Re-seed the history so every recorded sign-off obeys separation of duties.
  - The card, the History view and the report show the same approver.
- **#4: who can pass a test.**
  - Passing a test is restricted to the test's assignee, or people in the department that owns the test's section.
  - Bulk pass and plan-change approval need step-up, and the server enforces both.
- **#5: one testing count model.**
  - Simple "Try it out" shows its own stage.
  - The run header, report, gate, Launch, coverage summary, matrix and approver "not changed" list (taken from the diff) all agree.
  - The UAT denominator includes generated cases.
- **#6, engine side: ownership.**
  - Never fall back to the PM.
  - `who`, the report, Home and the portfolio show "Needs an owner: <role>" for unowned tasks.
  - The step owner is identical on the map and the project.
- **#7, engine and these pages: counts and labels.**
  - Launch counts: one phrase and one number (checks).
  - Report week Mon–Fri.
  - The period report includes plan changes applied in the period.
  - "Since last report" works.
  - One lateness number.
  - "Behind on effort" is never counted as late.
  - EAC sanity.
  - No expected cost without rates.
  - Access: status, the 30-day cap, the approver (the information owner), and local dates.
  - Override signer roles.
  - "Not checked yet" wording everywhere.
  - No internal IDs in text.
- **#9:** earned value against the locked baseline.
- **#10: launch-day plan validation.**
  - Every step falls inside the window and on a business day.
  - The override appears in the summary, and its path is discoverable.
- **#11, engine side: profiling.**
  - Catch a shared bank account across records, near-duplicate names, and whitespace.
  - Never mark observed valid shapes as reject.
  - Generate uniqueness tests from duplicate warnings.

### H2: Import and process pages

**Files:**
- `api/shared/pmoflow-import.js` and its web copy, `import.test.js`
- `pages/{importsop,process,processes,data,step}.js`, `css/design.css`, `e2e-design.js`

**Items:**
- **#1, UI side.** Show and edit the team → approving department mapping at import and on the process, with no default.
- **#8: parser.**
  - SLA timer goes on the actor's step.
  - A threshold branch ("under $50k") skips review.
  - "if over $X, Y approves too" becomes an approval or choice.
  - Inline roles ("Purchasing mgr", "Credit dept").
  - Documents named in the text become information.
  - Pre-fill A/C/I in RACI from the text ("Sam Wu signs off").
  - VSDX: Start/End are not steps, no duplicate connector listing, and decisions are choices.
- **#7, process pages.** Home step count after save (with the lead's help if Home needs it); Today-tab counters make sense.
- **#12.** The first Save click after typing an owner works.

### H3: PMO pages and plan changes

**Files:**
- `pages/{home,project,projects,portfolio,dashboard,changes}.js`
- `api/shared/pmoflow-change.js` and its web copy, `api/shared/pmoflow-routes-change.js`, `change.test.js`
- `css/{pmo,change}.css`, `e2e-pmo.js`, `e2e-change.js`, lint

**Items:**
- Render H1's truths on these pages: #6, #7.
- **#13: cross-project change.** A knock-on into another project records a linked entry in that project's change log and adds that project's PM as an approver.
- **#12 on these pages:**
  - Custom report date range in Simple too (a small "Custom…" chip).
  - Phone spacing ("Late1", "Blockingholds").

### H4: Trust, sync and buying path

**Files:**
- `api/shared/pmoflow-sync.js` and its copies, `pmoflow-routes-connect.js`, `pages/connections.js`, `sync.test.js`, `e2e-connect.js`
- `pmoflow-routes-admin.js`, `pages/admin.js`, `admin.test.js`, `e2e-admin.js`
- `pmoflow-store.js` (limits only)
- `web/public/pmoflow/**`, `e2e-buyer.js`

**Items:**
- **#3: sync guardrails.**
  - Inbound changes may move work-item status only.
  - Never close defects, mark information available, or touch approvals or tests from sync.
  - Side effects are logged with the external actor ("Jira: jane@contoso"), never the PM.
  - "Finished before the work it depends on" stays flagged.
- **#2, audit.**
  - Actor identity (id and name) is inside the hash.
  - CSV exports are verifiable in the app, with the head and count in a footer row.
  - The export shows the key source, which reads "production key" when `PMOFLOW_AUDIT_KEY` is set.
- **#12:**
  - One rate-limit message, with no contradictory times.
  - Pricing estimator: minimum 1, and Team is capped at 25 with a nudge to Business.
- **Phone access table:** no hidden columns, using stacked rows at 390. `release.js` is H1's file, so give H1 the exact CSS/markup ask.

## Shared rules (unchanged from R11)

- **Ports:** H1 8921, H2 8922, H3 8923, H4 8924.
- **Never use `pkill -f`.** Never print the `.conn` file.
- **The engine has one owner (H1).** H1 publishes "Appendix: R12 engine API" at the end of this file early.
- **Before finishing:**
  - all unit suites and lint pass;
  - your e2e suites pass;
  - you have looked at screenshots at 1366 and 390.
- **Don't commit.** Report in ≤300 words, with exact cross-stream asks.
