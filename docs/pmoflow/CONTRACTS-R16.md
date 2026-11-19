# PMOFlow R16: close the R15 review findings

**Input:**
- `market-review/r15/CONSOLIDATED-R15.md` §3.
- The four reviewer files in `market-review/r15/`, which hold the repros.

**Bar:** fixed. **Rule #1** (ease for non-technical users), positioning and banned words are unchanged.

**Method:** failing test first from the reviewer's repro, then the fix.

## Already landed by the lead (R16 base)
- **Status:** work held up by missing information is "Waiting on information" (amber), never "On track". This supersedes the R9 §1 ruling.
- **Typed roles:** `parseWho`: a typed role is the doer, and the process owner is never filled in behind it.
- **Header unit:** the late-or-blocked count reads "N tasks late or held up".
- **Refused passes:** on Testing, a pass the rules refuse is still sent, so the server refuses it and logs "Refused: …".
- **Nav:** links remember the current project (`sessionStorage['pmoflow.currentProject']`).

## Streams

### N1: Engine, testing, governance, server (engine owner)
**Files:** the engine and its copy, `engine.test.js`, `pages/release.js`, `pages/testing.js`, `css/release.css`, `api/pmoflow/index.js`, seed, `pmoflow-ai.js`, `api.test.js`, `e2e-release.js`, `e2e-consistency.js`, `GOLDEN-NUMBERS.md`.

1. **Identity binding (PMO top 1).** When the request carries an SWA principal (`x-ms-client-principal`, i.e. hosted sign-in):
   - The actor must be the person mapped to that principal; anything else is refused with 403 and logged.
   - A step-up must be stamped within the last 10 minutes of server time, and the server records `stepUpAt`. A stale or future stamp is refused.
   - In the open demo (no principal) keep the "Viewing as" switcher, but still refuse step-ups older than 10 minutes or in the future.
   - Write this down honestly for N4's security page.
2. **Append-only time entries (PMO).**
   - Hours can't be removed or reduced by a plain save. Corrections are reversing entries ("−3 h on Nov 17, reason").
   - History shows hours and dollars.
   - Past-period reports never change after the fact.
3. **Report preview never logs (regression).** Only "send" or "export" writes reportLog and forecastLog.
4. **Department moves and approvers (Jordan):**
   - A move out of a department, or removal as approver, revokes eligibility for that part.
   - Approvals the person gave on parts not yet launched reopen (with the reason).
   - "Approves: X" is never shown for a person no longer in the department.
   - A blocked joiner sees why ("You joined Compliance after its testing started").
5. **No phantom parts.** A part with nothing to sign (e.g. PMO after a PM hand-over) never appears on Launch, never asks for approval, and an approval of it never counts.
6. **Launch owner change** is a plan change with approval.
   - Hand-over and launch-owner approvals never route to an Admin who became Admin or joined the team after the project started; fall back to another Admin.
7. **Guard more edits through Change the plan:**
   - a launch window past the deadline or on a day off;
   - effort or cost changes that push expected cost over budget (or over tolerance);
   - an added dependency moves the dependent's start (or is refused if that breaks the deadline).
8. **Jira hold:** clearing a hold shows the same open-predecessor warning as the PM confirm. Clearing it with an open predecessor keeps it out of EV.
9. **Tests from rules and data (BPM, fourth round):**
   - Boundary cases at every threshold, at the value and just over (e.g. $75,000 / $75,000.01; risk 65/66), attached to the gateway scripts.
   - Profile warnings generate cases for shared bank accounts, uniqueness and near-duplicates, with the right count (7 in 3 groups for the fixture). This includes unchanged fields that feed a changed decision.
   - Min/max are never taken from the sample unless documented. A rule never rejects valid values seen in the sample.
   - The masked example matches the rule (length 6 → "XX9999").
   - No "leading zero observed" claim unless it's true.
10. **Counts:**
    - Admin › Project sponsors' "Approves now" = the change routing (E.deadlineApprover).
    - The report's from→to equals the forecast log.
    - Past-range "Overall" concerns and cost are as of the period end.
    - A within-tolerance change says "no approval needed", not "approved".
    - Unconfirmed counts clear on confirm.
    - The variance never shows done before start.
    - A knock-on History line only for tasks that actually wait on the moved work.
    - Late wording: "1 business day past due; expected to finish 6 business days late".
    - The post-launch approvals panel and summary agree.
    - The Try-it-out record dialog shows the same results as the card.
    - Override reasons are not listed under "Changed after an approval".

### N2: Import, process pages, data pages
**Files:** import and its copy, `import.test.js`, `pages/{importsop,process,processes,data,step}.js`, `css/design.css`, `e2e-design.js`. Fixtures: `tests/pmoflow/fixtures/r15-*`, `/tmp/e2w/`.

1. **"Do you already have these?" (Karen).**
   - At import and save, list each new piece of information with three choices: "We have it", "Collected each run", or "Not yet".
   - Default per-vendor fields (routing or account number, legal name, tax ID, bank account) to "Collected each run", and classify them consistently ("Routing number" = "Routing numbers").
   - Outputs a step produces (e.g. "Credit limit", which the ERP sets) are "produced by step N", not collected.
2. **Approvers:**
   - People invited or named on the process page carry to Launch (one approver list, with N1 #4).
   - The process page's "N have nobody to approve" equals Launch.
   - The RACI A comes from sign-off and approval steps (the Controller is A on the threshold step).
3. **Import fidelity:**
   - VSDX nested "(Controller (Sam Wu))" is read as role Controller with Sam Wu named.
   - BPMN takes the participant/process name, and creates information from data objects and associations.
4. **Counts:**
   - Teams-involved step counts equal the map.
   - The "New + changed" header counts changed choices.
   - The risk-score threshold change is listed as a threshold change.
   - The profile line doesn't flip between "1 empty" and "9 don't match" (with N1 #9).
   - The data page never says "the sample matches the rules" beside a warning.

### N3: PMO pages, plan changes, Home
**Files:** `pages/{home,project,projects,portfolio,dashboard,changes}.js`, the change module and routes, `change.test.js`, `css/{pmo,change}.css`, `e2e-pmo.js`, `e2e-change.js`, lint.

1. **Karen's setup:**
   - New project defaults to the most recently created or edited process, and the dropdown shows each process's change counts.
   - Bulk owner assignment: "Give all Purchasing tasks to Rosa" in the owner picker.
   - "Choose owners for N tasks" equals the picker's list.
2. **Report:**
   - ASKS use current owners.
   - Team counts equal what each person owns.
   - "Waiting on 14: …" becomes separate lines by kind (tasks, information, tests).
3. **Render N1:**
   - the launch-owner plan change;
   - append-only hours (a "Correct hours" reversing entry with a reason);
   - report send vs preview;
   - the Jira hold warning;
   - the new guards.
4. **Portfolio:**
   - "Changes since the saved plan" defaults to the Kickoff baseline.
   - "1 done, not confirmed" clears on confirm.
5. **Project tabs:** at least 32px tall at 390.
6. **Self-assign:** warn when assigning a test to yourself: "You won't be able to pass it yourself."

### N4: Admin, sync, buyer site
**Files:** `pmoflow-routes-admin.js`, `pages/admin.js`, `admin.test.js`, `e2e-admin.js`, the sync module and its copies, `pmoflow-routes-connect.js`, `pages/connections.js`, `sync.test.js`, `e2e-connect.js`, `web/public/pmoflow/**`, `e2e-buyer.js`.

1. **Departments tab:**
   - Never shows "Approves: X" for someone no longer in the department.
   - A move out revokes approver status, through the same confirm flow.
2. **Project sponsors card:** "Approves now" uses E.deadlineApprover.
3. **History:** the "hours entries" line shows hours and dollars (render N1 #2).
4. **Security page:** describe N1 #1 identity binding exactly as built: hosted sign-in binds actions to the signed-in person, and step-ups expire after 10 minutes. Nothing more. Follow the existing rules: no invented certifications or dates, no banned words.
5. **Sync:** clearing a held Jira item routes through N1 #8's warning.

## Shared rules
- **Ports:** N1 8961, N2 8962, N3 8963, N4 8964.
- **Never use `pkill -f`.** Never print the `.conn` file.
- **Engine ownership:** only N1 edits the engine. N1 publishes "Appendix: R16 engine API" early.
- **Before finishing:**
  - all unit suites, lint and your e2e suites pass (run e2e-admin alone; run e2e-buyer with a fresh `PMO_TEST_IP`);
  - check screenshots at 1366 and 390.
- **Don't commit.** Report in ≤300 words with any cross-stream asks. Never weaken a test; explain any changed assertion.

## Appendix: R16 engine API (N1, published early; shapes are stable, items marked *landing* are being filled in)

All functions are on the shared engine (`E()` in the browser, `require('api/shared/pmoflow-engine.js')` on the server). Existing shapes are unchanged unless listed here.

### 1. Identity binding and fresh step-ups (PMO top 1)
- `E.STEP_UP_MAX_MINUTES = 10`.
- `E.stepUpProblem(stamp, nowIso)` → `null | {kind: 'missing'|'stale'|'future', text}`. `stamp` is an ISO time (or `{at}`). Stale = older than 10 minutes; future = more than 1 minute ahead of the server clock. Text: "The extra sign-in check was more than 10 minutes ago. Do it again."
- `E.personForPrincipal(docs, principal)` → person id or `null`. `principal` is the decoded `x-ms-client-principal` (`{userId, userDetails, identityProvider}`). It matches `person.principalId` against `userId`, or `person.email` against `userDetails` (case-insensitive).
- **Server (index.js, before any route module):**
  - With an `x-ms-client-principal` header on a workspace write: the body's `actor` must be that person, or the write is refused with 403 "You're signed in as X, so you can't act as Y." and logged as "Refused: …". A missing actor is filled in with the signed-in person. A principal linked to nobody is refused with 403.
  - Without a principal (the open demo): the "Viewing as" switcher keeps working, unchanged.
  - Every write that carries a step-up (`body.stepUp` as an object, or `data.stepUp` on an approval or test-run doc) is checked with `stepUpProblem` against server time. The stamp is `stepUp.at`, else `data.stepUpAt`, else `data.at`. A stale or future stamp is refused with 403 and logged.
  - The server records `stepUpAt` (its own clock). Approval and test-run docs keep `stepUp: true` plus `stepUpAt`. Route bodies get `stepUp: {method: 'simulated-mfa', at: <server time>}`.
  - **N3/N4:** send `stepUp: {method: 'simulated-mfa', at: new Date().toISOString()}` right after the check, as today. Release.js and testing.js send `stepUpAt` on approvals and runs.

### 2. Append-only hours (PMO)
- `E.timeEntryProblem(prevTime, nextTime)` → `null | {text}`. A plain save may add entries. It may not remove or change an entry already stored, or lower its hours. Text: "Logged hours can't be removed or changed. Use “Correct hours” to add a reversing entry with a reason."
- `E.reverseEntry(entry, hours, reason, by, today)` → `{hours: -h, date: today, reason, reverses: <entry key>, by, correction: true}`. Here `h ≤` what is left on that entry, and a reason is required.
- `E.hoursTotals(docs, w)` → `{hours, dollars, text: '25 hours ($3,125)'}`, net of corrections.
- `E.timeEntryText(t)` names a correction: "−3 hours on Nov 17 (correction: “double-logged”)".
- **Server:** refuses (409) a workItem save that breaks `timeEntryProblem`. The History line is "hours logged: …; now 25 hours ($3,125)" or "hours corrected: −3 hours …; now 25 hours ($3,125)".
- **Past periods:** `periodReport` counts only entries logged (`at`) by the period end. A later correction or backdated entry never changes a past period.

### 3. Report preview never logs
- **Server:** `reportLog` and `forecastLog` get an entry only when the project PUT body carries `report: {action: 'send'|'export', preset}`. A client `reportLog` value is ignored, and so is `lastReportAt`, which the server sets on send or export. Opening or previewing a report writes nothing.
- **N3:** call `store.save` with `report: {action}` only from Send or Export (*landing*: the exact store call is in the N1 report).

### 4. Department moves and approvers (Jordan)
- `departmentEdit({kind: 'assign'})` also removes the person from the old department's named approvers (and `approverSince`).
- `departments()` and `departmentApprovers()` list as approvers only people still in that department. "Approves: X" is never shown for someone who moved out.
- An approval stops counting when its approver is no longer eligible for that part: moved out, or removed as approver. This applies to projects not yet launched. `readiness(...).checks['bu-signoff'].reopened = [{bu, person, reason}]`. Reason: "Sam Keller moved out of IT, so their approval no longer counts".
- `E.approverStatus(docs, prj, bu, personId)` → `{eligible, rule, text}`, for example "You joined Compliance after its testing started, so you can't approve its part. Ask Dave Ortiz." The server refusal and Launch both use this text.

### 5. No phantom parts
- `E.partHasWork(docs, prj, bu)` → boolean: a changed step, choice, removed step or launch task. Parts without work never appear in `readiness`, `buReady`, or `approvalAsks`, and an approval of one never counts.

### 6. Launch owner change and hand-over routing
- **Server:** once a project has work, a plain edit of `project.releaseManager` is refused with 409 "Use “Change the plan” to hand the launch owner role to X, so the sponsor can approve it." The plan-change edit is `{type: 'project', field: 'releaseManager', from, to}`. **N3:** add the kind; the apply path writes it.
- `E.projectStartedAt(docs, prj)`. `E.deadlineApprover` skips an Admin whose Admin role (`settings.roleSince`) or membership (`person.buSince`/`createdAt`) is newer than the project's start, and falls back to another Admin.

### 7. Guards through Change the plan (landed)
- `E.launchWindowGuard(docs, prj, window)` → `null | {kind: 'day-off'|'after-deadline', date, text}`. The server refuses a plain `cutover.window` edit: on a day off it returns 400 ("The launch window can’t be on Fri Dec 25, Christmas Day. Pick a business day."), and past the deadline it returns 409 ("Use “Change the plan” to move the launch past the Dec 30 deadline …").
- `E.costBreach(before, after, prj, today)` looks at both the expected cost (EAC) and the bottom-up estimate. It returns `{before, after, pct, overBudget, budget, measure, alreadyOver?, text}` when a measure rises 5% or more, or goes over the planned budget. The server refuses an effort or `cost` edit of an existing task in a project with a saved plan (409 "Use “Change the plan” to change this effort|cost …"). New tasks are not checked here.
- `E.dependencyShift(docs, w, nextDeps, today)` → `{moved: false}` or `{moved: true, start, due, after, text}`. A new finish-to-start dependency moves an idle task's start to the business day after the predecessor's expected finish, and keeps its length. Work in progress keeps its start. The server applies the move, and the deadline guard then refuses it (409) if the deadline breaks.

### 8. Jira hold (landed)
- `E.holdClearWarning(docs, w)` returns the same text as `unconfirmedDone(...).confirmText` (`''` when nothing is open). The sync's `clearHold` already calls it. A cleared hold is `doneBy` the owner with no `confirmedBy`, so with an open predecessor it stays unconfirmed and out of EV.

### 9. Tests from rules and data (BPM, landed)
- `E.gatewayConditions(g)` → `[{subject, op, amount, money}]`. It reads every condition of a choice from `g.threshold` and from its title. The wording sets the operator ("or less" is ≤), and a compound choice gives one entry per condition. **N2:** the import gives "$50,000 or less" `op: '<'`. It should be `'<='`. The engine corrects it from the title.
- `E.gatewayBoundaries(g)` → `[{subject, value, input, path, where: 'at'|'over'|'under', text}]`. Examples: "Requested limit $75,000.00 (with the other conditions met): takes the “Yes” path" and "… $75,000.01 … “No”"; a score gives 65 → Yes and 66 → No.
- Gateway business check scripts carry `boundaries` and one `{action: 'Enter …', boundary: true, input}` step per value that leads down that path. `when` reads "The outcome is "No" (try Requested limit $75,000.01 … and Risk score 66)".
- `thresholdCases` covers every condition. It works with fields from the profile, or with the item's own name when it has no fields. `generateProjectTests` includes these cases on every path.
- `changedInformation` reason `'decision'`: unchanged information that feeds a new or changed choice is tested (`E.feedsChangedChoice(docs, p, d)`).
- `generateProjectTests` adds `{dataId, cases, signalsOnly: true}` entries. They hold only the warning cases (shared bank, duplicate, near-duplicate, unique) for unchanged information that has a sample.
- `specFromProfile` never sets min or max from the sample. The range is kept as `observedMin`/`observedMax` (`observedMinLen`/`observedMaxLen`). The one exception is a code whose every value has the same length: it gets `length` and the rule "Every value in the sample is 6 characters".
- Near-duplicates drop dots ("L.L.C." = "LLC"), so the fixture gives 7 records in 3 groups.
- "Leading zero" is a generated case (`origin: 'spec'`) and is never "also observed in the extract".
- `maskValue('NW1001')` = `XX9999`: a code keeps its letter count. Names stay `Xxxx`.

### 10. Counts (landed)
- `lateInfo(...).text`: "1 business day past due; expected to finish 6 business days late", or "Expected to finish 6 business days late". It adds `pastDueDays`. The report uses the same words. **N3:** Home and Work read `text` as-is.
- `baselineVariance` rows add `plannedStart` and `start`. `start` is never after `forecast` for done work. **N3:** render `start`.
- Report plan-change line: "… (within tolerance, so no approval needed)" when the change was applied with nobody deciding it.
- Past ranges: `overall.forecastFinish` (and `schedule`) equal the change line's "to". That value is the forecast-log entry inside the window, else the forecast as of the period end.
- Areas of concern: "3 of the 4 tasks late or held up", in the header's unit.
- Launch (N1): the post-launch panel names the launch record's approvers. Override reasons get their own list, never under "Changed after an approval". A reopened part says why.
- Testing (N1): the record dialog shows each row's last result in its own phase.
- **N3 ask:** knock-on History lines. `withKnockOn` also tags tasks that only finish later (`fa > fb`) with `knock: true` ("it waits on the moved work"). Tag only the tasks reachable from the edited tasks through dependencies.
- **N4 ask:** Admin › Project sponsors "Approves now" = `E.deadlineApprover(docs, prj, null).person`.

### Also (N1 server)
- History keeps 300 characters. `serverSummary` shortens the change list, never the person's note. This fixes the flaky "R6 history: resize summarised".
- Approvals of a part with nothing to sign are refused (`buReady.needed === false`).
- **N4 ask:** `writeDeptEdit` should keep `departments[].approverRemoved` (the engine's `departmentEdit` returns it) and the person patch's `leftDepartments`. Without them, a move recorded only by N4's `withRevoke` reopens approvals only through the `buSince` rule.

### N2 follow-ups (N1, landed)
1. `diffProcess(...).changes[gatewayId]` lists every condition of a choice, using `E.gatewayConditions`, which reads the title and threshold the same way as `PMOImport.thresholdsOf`:
   - A changed condition: "Threshold for risk score: at most 60 → at most 65".
   - An added or removed condition: "Threshold added for X: …" / "Threshold removed for X: …".
   - A single money threshold keeps "Threshold over $250,000 → over $300,000".
   - The imported inclusive ops `'<='` and `'>='` are read as "at most" and "at least".
2. `teamRouting` uses Launch's own list (`partApprovers`) when a project that is not live uses the process. So chosen approvers count, and the PM and launch owner never do. A draft with no project keeps the department rule.
3. `partApprovers(...)` adds `invited: [emails]` and `invitedText` ("Invited: x@… (can approve once they join)"). Its `text` ends with that sentence when nobody can approve yet. `E.departmentInvites(docs, bu)` returns `[{email, role, at}]`. Launch's "Nobody can approve" hint shows it.
4. `profileLines` always counts empty values, with or without rules. It treats a score as 0–100, never the sample's range, so a line no longer flips between "1 is empty" and "9 don't match" when tests are added.

### N3 follow-ups (N1, landed)
- Launch part cards show "Waiting on:" with one line per kind (tasks, information, tests to pass, tests to add), never one added-up total. `data-part-waiting` still carries `waitingOn`.
- A release.js save that the server sends to Change the plan (409) opens N3's `offerChangePlan(..., body)`. Any other refusal shows the server's words.
- Testing's tester pickers show `SELF_TEST_WARN`. The case, script and scenario dialogs use `bindSelfTest`, and the inline and bulk pickers show a toast as they save.
- Engine: the no-hours check on a Done (`unconfirmedDone`, `earnedValue` doneNoHours) uses net hours, so a correction that brings a task to 0 hours counts as no hours.
