# PMOFlow R14: close the R13 review findings

**Input:**
- `market-review/r13/` reviewer files (karen, expert-pmo, expert-bpm; jordan when it lands) hold the exact repro steps.
- `market-review/r13/CONSOLIDATED-R13.md`.

**Bar:** the same fixed bar as R10–R13. It doesn't move.

**Unchanged:** Rule #1 (ease of use for non-technical users), positioning, and the banned words.

**Method:** each item gets a failing test written first from the reviewer's repro. Then fix the code.

## Already landed by the lead (R14 base, not yet deployed)
- **Who list:** unowned work is never attributed to the PM or the data owner. Who rows for unowned work read "Needs an owner: <role>" (engine `who`; test "R13: who never attributes unowned work…").
- **Advanced approval:** the list view uses the same readiness rule as Simple and the section view. `decide()` checks readiness before asking for the 6-digit code and shows save errors on screen.
- **Audit:** the server writes the history sentence from the actual field diff (`changeText`/`serverSummary` in index.js). The client's sentence is kept only as a quoted note. Test: "R13: the history sentence is server-written…".

## Streams

Each stream owns whole files. The engine has one owner (L1). Item ids are from the reviewer files.

### L1: Engine, testing ledger, governance, API integrity (the engine owner)

**Files:**
- engine + web copy, `engine.test.js`
- `pages/release.js`, `pages/testing.js`, `css/release.css`
- `api/pmoflow/index.js`, seed, `pmoflow-ai.js`, `api.test.js`
- `e2e-release.js`, `e2e-consistency.js`, `GOLDEN-NUMBERS.md`

**Items:**
1. **Audit integrity (PMO-A1..A3).**
   - The server enforces task ownership on workItem writes. Only the owner, the PM, the release manager or an admin may change a task's fields or hours; others get 403.
   - A refused write must never appear in History. Find the path that logged the refused $90,000 budget edit.
   - Hours entries carry server time, and a backdated entry is labelled as such.
2. **Deadline guard everywhere (PMO-S1..S3).**
   - Any workItem write that moves the forecast finish past the project deadline is refused with 409 "Use Change the plan…". This covers task Edit, the API and sync.
   - The PM can't make himself sponsor: changing the sponsor needs an admin or the current sponsor.
   - Rebaselining ("Save plan") on a project with a baseline goes through Change the plan.
3. **Earned value (PMO-1).** A Done with an open predecessor, or with 0 hours on a task that has an estimate, stays out of EV and the forecast until someone other than the doer confirms it. Show it in Home and the who list.
4. **Knock-on re-dating (PMO-9).**
   - An applied plan change re-dates the knock-on tasks' due dates.
   - The impact screen warns about any task that will end up past due.
   - No "back on schedule" ask when due equals expected.
5. **Holiday due dates (PMO-11).** The server refuses a due date on a non-business day, with a message naming the day.
6. **One testing counter (BPM-1).**
   - Every surface reads one ledger: the header, Try it out, Business check, Advanced spec coverage, the matrix, Launch, Portfolio and the report. No more 38/42, "All 5" vs "9 of 9", or "9 passed, 1 failed (now 7 of 8)".
   - "ALL COVERED" only counts item-specific cases.
7. **One blocker counter (BPM, Karen 7).**
   - "holds up N tasks" counts distinct tasks within the project.
   - The report's "late or blocked" equals the header.
   - Weekly "Blockers raised" counts blockers created in the period.
   - Launch's "not available" equals the process page (not available vs not checked).
8. **Profile becomes tests (BPM-2).**
   - Near-duplicate names and shared bank accounts generate test cases, with correct counts.
   - Shared-bank wording only on bank fields.
   - A multi-column sample uploaded on one item is split per information item.
   - Numeric inference for amount and score fields.
   - No case contradicts the majority shape. Say why TC7/TC12 differ, or remove the contradiction.
9. **Cost (Karen 2).** No expected cost without rates: "Cost unknown: set rates". Never red "over budget" from default rates.
10. **Reports (PMO-7/8, list 1/5/6/7/11).**
    - "Since last report" works by exact timestamp.
    - Past ranges compute the headline as of the period end, or label it "as of today".
    - One time zone (the viewer's) everywhere.
    - "late by N business days" matches between the Work tab and the report.
11. **Approval request timing (Karen 8).** The approval request goes out when the part's work is done, not before.
12. **Re-approval card (BPM-9).** "Changed after approval" shows from→to.

### L2: Import, process pages, data pages

**Files:**
- import + web copy, `import.test.js`
- `pages/{importsop,process,processes,data,step}.js`, `css/design.css`, `e2e-design.js`

**Items:**
1. **Parser (BPM-5):**
   - Choice branch targets: the auto-approve Yes branch must not flow into the Controller approval.
   - "Role (Name)" normalised in BPMN lanes and VSDX shape text.
   - Step numbers stable between preview and save (Karen 4).
2. **Owners (Karen 5, BPM):**
   - The map owner equals the plan owner for the same step.
   - New information defaults its owner to "whoever does the step", never the PM.
3. **Per-vendor data (Karen 9):** COI and "COI certificate of insurance" are one item. Per-run documents (W-9, COI) are marked "collected each run", not turned into "Make X available" project tasks owned by "Vendor".
4. **Departments (Karen 3):**
   - A new department gets an inline approver (pick a person or invite by email).
   - The process page and Launch agree on whether a part can be approved.
5. **Masking:** the note matches the examples ("first and last character kept" only if true).

### L3: PMO pages, plan changes, Home

**Files:**
- `pages/{home,project,projects,portfolio,dashboard,changes}.js`
- change module + routes, `change.test.js`
- `css/{pmo,change}.css`, `e2e-pmo.js`, `e2e-change.js`, lint

**Items:**
1. **Render the engine's "Needs an owner".** No count, headline or Home item may name the PM for unowned work: header, Portfolio, Home "Waiting for you", data page, Change the plan.
2. **Disagreement list (PMO list 2/3/4/7/9/10):**
   - Portfolio "1 with late tasks" vs "0 late" (Karen 6).
   - "In review 0" while 3 rows are In review.
   - The impact screen's approver text equals the routing.
   - A pending change's "finish stays" refreshes.
   - "available" vs "connected" use one word.
   - Home has no duplicate "Confirm…" row.
3. **UI for L1 items 2/4/5/9:**
   - The task Edit dialog explains the deadline refusal and offers Change the plan.
   - The sponsor field is locked for the PM.
   - "Save plan" routes to Change the plan once a baseline exists.
   - The due-date picker marks days off.
   - "Cost unknown: set rates".

### L4: Admin, sync, buyer site

**Files:**
- `pmoflow-routes-admin.js`, `pages/admin.js`, `admin.test.js`, `e2e-admin.js`
- sync module + copies, `pmoflow-routes-connect.js`, `pages/connections.js`, `sync.test.js`, `e2e-connect.js`
- `web/public/pmoflow/**`, `e2e-buyer.js`

**Items:**
1. **Sync:** an inbound due-date change that would breach the deadline is held as a plan change request. It never moves dates silently.
2. **Admin:**
   - Changing a project's sponsor needs an admin.
   - The audit export verifies against the new server-written summaries. Old events still verify.
3. **Buyer site:**
   - Lead the PMO-buyer path with "Already using Jira or Azure DevOps? Keep your workflow." This is within the founder's positioning; no banned words.
   - Security page: say the history text is written by the server from the actual change.

## Shared rules
- **Ports:** L1 8941, L2 8942, L3 8943, L4 8944.
- **Never use `pkill -f`.** Never print the `.conn` file.
- **Engine ownership:** only L1 edits the engine. L1 publishes "Appendix: R14 engine API" early in this file.
- **Before finishing:**
  - all unit suites, lint and your e2e suites pass (run e2e-admin alone);
  - check screenshots at 1366 and 390.
- **Don't commit.** Report in ≤300 words with any cross-stream asks.

## Appendix: R14 engine API (L1, published early; shapes are stable, items marked *landing* are being filled in)

All new functions are on the shared engine (`E()` in the browser, `require('api/shared/pmoflow-engine.js')` on the server). Existing shapes are unchanged unless listed here.

### Server refusals (API, every caller: task Edit, the doc API, sync). Show `error` as-is; it is plain words.
- **403 task ownership:** a workItem's fields or hours may be changed only by its owner, the project manager, the launch owner (releaseManager) or an Admin. An unowned task may be picked up (owner set to yourself) by any Editor. Message: "Only <owner> (the task owner), <PM> (the project manager) or an Admin can change “<title>”."
- **409 deadline guard:** a workItem write that moves the project's expected finish past its deadline (or further past it) is refused: `{error: 'Use “Change the plan” to …', reasons:[…], deadline:{finishBefore, finishAfter, target}}`. Engine: `E.deadlineBreach(docsBefore, docsAfter, projectId, today)` → `null | {finishBefore, finishAfter, target, text}` (L4 sync uses it to hold an inbound date as a plan change request).
- **400 day off:** a due date on a weekend, US holiday or workspace day off. Engine: `E.dueDateProblem(date, docs)` → `null | {date, day:'Fri Dec 25', name:'Christmas Day', suggestion:'2026-12-24', text:'Fri Dec 25 is Christmas Day, a day off. Pick a working day, such as Thu Dec 24.'}`. The due-date picker marks days off with `E.isBusinessDay(d, docs)` / `E.holidays(docs)`.
- **403 sponsor:** changing a project's sponsor needs an Admin or the current sponsor; nobody can make the project manager the sponsor. First-time setting (no sponsor yet) is allowed to anyone who may edit the project, except to the PM.
- **409 rebaseline:** once a project has a saved plan (`project.baselines` non-empty), "Save plan" (any change to `baselines` through the doc API) is refused: "Use “Change the plan” to save a new plan, so the sponsor can approve it." Plan changes still write their own automatic before/after records.
- **History:** a refused write is never logged; a write that changes no field logs nothing; the client's note is dropped when it claims a change ("A → B") the server diff does not show.
- **Hours:** each new `workItem.time[]` entry is stamped by the server: `at` (server ISO time) and `backdated: true` when its `date` is before the person's today. `E.timeEntryText(t)` → "8 hours on Nov 10 (logged Nov 18, backdated)".

### Done that needs a second person (PMO-1)
- `E.unconfirmedDone(docs, workItemOrId)` → `{flag, reasons:['open-predecessor'|'no-hours'], text, doer}`. A Done with an open predecessor, or with 0 hours on a task with an estimate (`effortDays`), is *unconfirmed* until someone other than the doer sets `confirmedBy` (server stamps `confirmedAt`; the doer is `doneBy`, else the owner). The server refuses `confirmedBy === doer`.
- Unconfirmed Done earns nothing (EV, % done, CPI/SPI/EAC) and its dependents are forecast as if it were still open.
- `projectTruth.unconfirmed` → `{count, items:[{workId, title, doer, doerName, reasons, text}], text:'2 tasks marked Done need someone else to confirm them'}`.
- `who` rows: `why: 'confirm'` (rank 44), `what: 'Confirm “<title>” is done'`, person = the project manager (or the launch owner when the PM is the doer), `workId`, `reason` (plain text).

### Cost unknown (Karen 2)
- `projectTruth.cost` adds `unknown: bool`, `unknownText: 'Cost unknown: set rates'`, `unpriced: n` (open tasks with no owner rate and no fixed cost). When `unknown`: `forecast`, `estimate`, `remaining`, `variance` are `null` and `overBudget` is `false`; `planned` (budget) still shows. Never red "over budget" from default rates. `projectFinancials` follows the same rule.

### One testing counter (BPM-1) *landing*
- `projectTruth.testing` is the ONE ledger. Every surface reads: `total` (= `cases + scripts`), `passed`, `failed`, `notRun`, `stages[]` (`{key:'system'|'uat', label, total, passed, failed, notRun}`; both stages use the same `total`), `count` ("9 of 26 tests passed"), `coverage.text`.
- `coverage.allCovered` is true only when every changed piece of information has an item-specific case for every rule field (a generic user-origin case does not count); `coverage.specificGaps` lists pieces covered only by generic cases.
- `E.testingLine(truth)` → one sentence for headers, Portfolio and the report, e.g. "9 of 26 tests passed (17 not passed yet: 1 failed, 16 not run)".

### One blocker counter (BPM, Karen 7) *landing*
- `projectTruth.blocking.holdsUp` = DISTINCT open tasks held (within the project); `blocking.text` "9 blocking (holds up 9 tasks)".
- `periodReport(...).headline.lateOrBlocked` = header's `lateCount` + `blocking.count` taken from the same projectTruth; `weekly.blockersRaised` = blockers whose information became not available in the period.
- `E.infoStateCounts(docs, projectId)` → `{notAvailable, notChecked, sampleOnly, have}`: the one split the process page and Launch both show.

### Reports (PMO-7/8) *landing*
- `lastReportStamp(project)` is an exact ISO timestamp; "since last report" compares event times, not days.
- A past range's headline is computed `asOf` the period end; `report.asOf` = `{date, label}` ("as of Fri Nov 13" or "as of today").
- Time stamps in the report are formatted with the viewer's offset (`opts.tzOffsetMinutes`); `E.fmtStamp(iso, tzOffsetMinutes)`.
- "late by N business days" in the report is `projectTruth.lateness[id].days` (same as the Work tab).

### Approvals (Karen 8, BPM-9) *landing*
- A part's approval request waits until its work is done: `approvalsOf` items carry `ready:false, waitingFor:{count, titles}` while any of the part's tasks is open.
- `approvalsOf` items carry `changedAfter: [{what, from, to}]` when the part changed after its approval ("Step 4 owner: AP clerk → AP lead").

### Plan-change knock-on (PMO-9) — engine side; L3 wires it in the change module
- `E.knockOnRedates(docsAfter, projectId, today, {exclude:[ids]})` → change edits `[{type:'workItem', id, op:'set', field:'due', from, to, label, auto:true}]` for open tasks whose expected finish lands after their due date after the change. Applying them re-dates knock-on due dates.
- `E.pastDueWarnings(docsAfter, projectId, today)` → `[{workId, title, due, forecast, text}]` for the impact screen.
- The `who` list no longer says "back on schedule" for a task whose expected finish equals its due date.
