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

### One testing counter (BPM-1) (landed)
- `projectTruth.testing` is the ONE ledger: `total` (= `cases + scripts`), `passed`, `failed`, `notRun`, `count` ("9 of 26 tests passed"), `status` (every ledger test id), `ledgerText` ("26 tests: 8 information checks and 18 step checks. Try it out runs the 8 information checks; the business check runs all 26.").
- `stages[]`: `{key:'system', label:'Try it out', unit:'information check', scope}` counts the information checks only; `{key:'uat', unit:'test'}` counts all. Show Try it out as "7 of 8 information checks passed" (never "tests"), so it never reads as a second total. `next` now says "Try out the N information checks".
- The report's stage lines count only ledger tests (cases on information the project doesn't change no longer leak in: "Try it out: 3 passed, 1 failed (now 7 of 8 passed)").
- `coverage.allCovered` is true only when no gaps AND no piece has only the basic presence test; `coverage.genericOnly` (ids), `coverage.genericText`; `coverage.elements[].genericOnly/specific`.
- Testing page (L1): the run row counts ledger tests only (9/26, never 9/32); the matrix badge says "N with a basic test only" instead of "all covered".

### One blocker counter (BPM, Karen 7) (landed)
- `projectTruth.blocking.holdsUp` = DISTINCT open tasks held (within the project); `blocking.text` "9 blocking (holds up 9 tasks)".
- `blocking.items[].heldIds` (distinct task ids). `projectTruth.lateOrBlocked` → `{count, ids, late, heldUp, text:'7 tasks late or blocked (5 late, 2 held up by missing information)'}`: the header's ONE "late or blocked" number; the report's areas of concern use the same set (`overall.lateOrBlocked`).
- `periodReport.blockersRaised`: information is dated `unavailableSince`, else `createdAt` (the server now stamps new information and risks), else when the first task it holds up was planned.
- `E.infoStateCounts(docs, projectId)` → `{have, notAvailable, notChecked, sampleOnly, waiting, problem, total, text:'1 not available, 8 not checked'}`: the one split the process page (L2) and Launch both show.

### Reports (PMO-7/8, list 5/6) (landed)
- The server stamps exact times on tasks: `createdTs`, `assignedTs`, `startedTs`, `doneTs`. "Since last report" compares them with the report's exact time.
- **L3 ask:** send `tzOffsetMinutes: new Date().getTimezoneOffset()` in the `/ai/status-report` body. `window.note` then reads "Since the last report on Tue Nov 17 at 2:59 AM." Without it the note has no clock time (never UTC). `window.sinceAt` is the ISO time for local formatting; `E.fmtStamp(iso, tzOffsetMinutes)`.
- A past range: `overall.asOf = {date, past:true, label:'as of Fri Nov 13'}` and the overall label/sentence/schedule/late are computed as of the period end. The headline/risks/asks stay today's: the report body has `asOf: 'as of today'` and the headline ends "(as of today)". `overall.asOf.label` is 'as of today' for a window ending today. Render both labels.
- "late by N business days" in the report = `projectTruth.lateness[id].days` (the Work tab's number).
- A plan change in the report: `planChanges[].shiftDays` = its impact's finish before → after (`finishBefore`, `finishAfter`); when a saved forecast predates the period, the slip text says how much the change made: "…16 business days later this week (Dec 7 → Dec 30): 14 business days from the plan change “X” (Dec 9 → Dec 30), 2 business days from work running late".
- The email list (`recipients`) includes everyone with an ask (`who`), not only the project team.

### Approvals (Karen 8, BPM-9) (landed)
- A part's work now includes its "Retire the old step" tasks and "tell-removed" tasks, so its approval is not ready (and nobody is asked) until they are done.
- `approvals[].changedAfter: [{ref, text}]` e.g. "“Capture banking details” due Nov 20 → Dec 3, owner Leo Park → Ana Ruiz"; step changes also name the information and teams involved, from → to. The approval fingerprint now carries the part's task values (`;w:`), so approvals saved from R14 on can say from → to. The Launch card renders it (L1).

### Plan-change knock-on (PMO-9) — engine side landed; **L3 ask:** wire it in the change module
- `E.knockOnRedates(docsAfter, projectId, today, {exclude:[ids]})` → change edits `[{type:'workItem', id, op:'set', field:'due', from, to, label, auto:true}]` for open tasks whose expected finish lands after their due date after the change. Applying them re-dates knock-on due dates.
- `E.pastDueWarnings(docsAfter, projectId, today)` → `[{workId, title, due, forecast, text}]` for the impact screen.
- The `who` list no longer says "back on schedule" for a task whose expected finish equals its due date: "Finish “X” by Dec 22: other work waits for it".
- **L3 ask:** in `C.buildChange`/`C.impact`, add `E.knockOnRedates(after, projectId, today, {exclude: edited ids})` as auto edits (shown as "moves due Nov 27 → Dec 17", applied with the change), and show `E.pastDueWarnings(afterWithRedates, projectId, today)` on the impact screen.

### Also landed (L1)
- **L3 asks 1–4:** the sentence and the `info` who row name the fix task's owner or "Needs an owner: <role>" (never the data owner/PM); `personQueue` lists a held item once; a Done the PM marked goes to the launch owner, sponsor, then an Admin (never the doer); `AVAIL_LABELS.live.label` is "Available" (the Testing and Launch pages now say Available too).
- **Profile → tests (BPM-2):** `profileCsv` columns add `duplicateRecords` (records sharing a value). `sharedAccount.text`: "2 account numbers are each on more than one record (4 records in all): …"; only on bank accounts (never "customer account number"). Generated cases carry `signal: 'shared-account'|'duplicate'|'near-duplicate'` and `setup` ("Setup: first save a record with this value, then enter it on a second record." — why it differs from the valid case). Amount/limit/score fields typed text are numbers (`fieldSpec(...).inferred`; a score is 0–100). A shape most rows have is never "should be rejected". `E.splitSampleColumns(docs, dataId, names)`; the profile route splits a multi-column sample per information item (response `split: [{dataId, name, columns}]`). **L2 ask:** show `split` ("2 columns went to Vendor master record") after an upload.
- **Jordan A:** department changes are dated (`person.buSince`, `department.approverSince`); `E.grantTooRecent(docs, project, bu, personId)`. A person moved in or named approver after the part was in flight (its project's first test result, or the part's first approval) can't pass its tests (`canPassTest` rule `'recent-move'`) and is not an eligible approver. **L4:** your two-person route calls `departmentEdit` at apply time, which stamps that time; pass `at` if you want the proposal time instead.
- **Jordan B:** every refused doc write (400/403/409) appends a History event `action:'refused'`, summary "Refused: change to work item “X” (due Nov 20 → Jan 5) — <reason>". **L4:** the audit export/verify should accept action `refused`.
- **Jordan C:** a launch with an override records one release exception per overridden condition (`exceptions[].override: true`); the Launch summary shows an Override badge, lists every overridden condition, and shows "Launch-day plan is ready" as a warning when a launch-day step was open.
- **Jordan D:** Launch's checks card explains "The 6 steps left cover the 9 checks not passed below" (`projectTruth.launchChecks`). **L3 ask:** Portfolio should say the same pair (`stepsLeft` + `launchChecks.text`).
- **History:** the server's diff skips server stamps (`…At`, `…Ts`, `doneBy`); hours read "hours logged: 3 hours on Oct 1 (logged Nov 18, backdated) by Dev Kumar".
