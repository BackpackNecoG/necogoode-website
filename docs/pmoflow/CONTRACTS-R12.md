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

## Appendix: R12 engine API (H1, published early; shapes are stable, items marked *landing* are being filled in)

`E` = `api/shared/pmoflow-engine.js` (web copy `app/engine.js`, byte-identical). Render these; never count locally.

### #1 Department routing (H2 builds the UI on this; H3 reads `projectTruth.routing`)

**Stored on the process:** `process.teamDepartments = { [team: string]: string | null }`.
- Key: a team as found on the steps (keep the spelling the import found: "Purchasing", "Credit", "AP", or a role with no team word such as "Buyer/Vendor").
- Value: the approving department (a `person.bu` value, e.g. "Accounts Payable"), or `null` = not chosen yet. **There is no default.** Keys match case-insensitively.
- Save it with the process (`store.save('process', …)`); the engine reads it from the process doc only.

**Which teams a step has:** `E.stepTeams(docs, process, step)` → `[team]`.
- A step with `ownerRole` is done by that role. Its team is the team word inside the role ("Purchasing mgr" → "Purchasing", "Credit dept" → "Credit", "AP clerk" → "AP"); a role with no team word is its own key ("Buyer/Vendor"). **`step.owner` is ignored when `ownerRole` is set**: the process owner written there by "Who does it" is never the step's team or owner.
- A step owned by a person (no `ownerRole`) has that person's `bu`.
- Plus every `touches` entry that is a team (a team word, a department name, or a key of `teamDepartments`). Systems such as "Email" are ignored.

**Team → department:** `E.departmentFor(docs, process, team)` → `string | null`. The mapping value if the key exists; else the department whose name (or abbreviation: AP, AR, HR, IT) equals the team; else `null`.

**Seeding at import:** `E.seedTeamDepartments(docs, nodes)` → `{ team: department | null }` for every team found on `nodes` (a Future map). Teams whose name is a department get it; every other team gets `null`. H2 calls this once at import and saves the result on the process.

**For the import and process pages:** `E.teamRouting(docs, process)` → `{ teams: [{ team, department, explicit, steps: [{ id, title }], text }], unmapped: [team], departments: [{ name, people: [{ id, name }] }], text }`.
- `teams[i].text` is "Purchasing → Procurement" or **"Choose who approves for Purchasing"**.
- `departments` is the pick list (every `person.bu`, sorted).
- `text` is "4 teams · 1 needs an approving department" or "All 4 teams have an approving department".

**Approvals (`readiness` bu-signoff, `approvalsOf`, `projectTruth.approvals`):** a changed step's departments = `departmentFor` of each of its `stepTeams`. A changed step whose team has no department adds an **unrouted** entry, and the bu-signoff check fails until it is chosen.
- `projectTruth.routing` = `{ unmapped: [{ pid, process, team, steps: [{ id, title }], text: "Choose who approves for Purchasing" }], text }`.
- `bu-signoff` gains `unrouted` (same array). Its detail leads with the "Choose who approves for …" sentences.
- The "Tell affected teams" task's `teams` lists departments (and unmapped team names as they are), never the process owner's department by default.

**Re-approval:** reopens only the departments whose own steps changed. Approvals saved from R12 carry a `v:` part in `approval.fingerprint` (from `E.sectionFingerprint`), so `stale[i].details[j].label` reads **"“Pay the vendor” time limit 2 business days → 1 business day"**, owner "Ana Ruiz → AP clerk", name "“X” → “Y”". `ref` no longer contains internal ids in any `label`/`text`.

### #6 Ownership: `E.stepDoer(docs, step)` → `{ owner: personId | null, role: string | null, text }`
- Role steps resolve to the one person whose title equals the role, else `owner: null`, `text: "Needs an owner: <role>"`. Never the PM, never the process owner.
- `E.ownerText(docs, workItem)` → person name, or "Needs an owner: <role>" (or "Needs an owner"). `who`, the period report, Home and the portfolio use it; an unowned task never appears under a person's name.

### #4 Who can pass a test: `E.canPassTest(docs, prj, testId, personId)` → `null | { rule: 'assignee' | 'department', text }`
- Allowed: the test's assignee; or, for an unassigned test, people in the department that owns the test's part (`E.testDepartments(docs, prj, testId)` → `[dept]`). A test owned by no department may be passed by anyone eligible to record.
- Server: PUT `testRun` refuses a pass with 403 when `canPassTest` names a rule; a run with more than one pass (bulk) needs `stepUp: true`. PUT `changeRequest` approval needs `stepUp: true` (403 otherwise).

### #10 Launch-day plan: `E.launchPlanCheck(docs, prj)` → `{ ok, problems: [{ taskId, task, at, why: 'day-off' | 'outside-window', text }], text }`
- Every not-done task's `plannedStart` must fall on a business day, on the window's day, between its start and end (and end by the window's end). `projectTruth.launchPlan` is the same object. The `cutover-plan` gate check fails while `ok` is false (`planProblems` on the check); it is a gate failure, not something the override skips. (Landed.)
- Override wording: `launchOverrideStatus().signoffs[i].label` and `E.overrideRoleLabel(docs, prj, person)` → "project manager" | "sponsor" (only `project.sponsor`) | "approver". The override panel now also shows on the Simple Launch page (launch owner) and as a "Launch early?" card for signers.

### #7 / #9 Counts (landed)
- `projectTruth.launchChecks` = `{ total, passed, notPassed, failing, text: "9 checks not passed" }`. One phrase: "checks". Portfolio, report and Launch use `text`.
- Report week labels always read "Week of Mon … – Fri …" (even when the project started mid-week). "Since last report" counts a report sent earlier today. A plan change applied this evening (tomorrow's UTC date) is in a window that ends today.
- `earnedValue` uses the **locked baseline** budget: the latest `project.baselines[i].budget` (`ev.bacSource: 'baseline' | 'current' | 'estimate'`). **H3: when saving a baseline, store `budget: project.budget.planned` on it.** With CPI = 0, EAC = spent + budgeted value of the work still to do (AC + BAC − EV), so never under budget.
- `projectTruth.cost.show` is false unless the project has a budget, a task owner with a day rate, or logged hours (role-only tasks priced at the default rate never show an expected cost).
- Access: `E.grantApproverOf(docs, grant)` (the information owner; the PM when the owner asked). `grantView` may be called docs-first (`eng()` style) and then adds `approver`, `approverName`, and `text: "Waiting for Leo Park"`. The Launch step "Launch" names the access approvers while requests wait.
- `E.ownerText(docs, workItem)`; `who` rows for unowned tasks carry `needsOwner: true`, `role`, `name: "Needs an owner: <role>"`.
- `defectState`: a defect with `status: 'review'` (inbound Jira/ADO Done) is `fixed`, awaiting a passing retest (H4 ask).

### #11 Profiling (landed; counts and row numbers only, never values)
- `profileCsv` columns may carry `whitespace: { count, firstRow }`, `nearDuplicates: { groups, records, rows }`, `sharedAccount: { accounts, records, rows, text }` (account/IBAN columns).
- `profileLines` names them. `generateTests` never makes an observed shape whose real values pass the rules a "reject" test, and turns a duplicate warning on an id/tax/account/unique field into a uniqueness test (`context: { duplicateOf: 'another record' }`).
