# PMOFlow R15: close the R14 review findings

**Input:**
- `market-review/r14/CONSOLIDATED-R14.md` §3.
- The four reviewer files in `market-review/r14/`, which hold the exact repros.

**Bar:** fixed and unchanged. **Rule #1** (ease for non-technical users), positioning and banned words are unchanged.

**Method:** failing test first from the reviewer's repro, then the fix.

## Already landed by the lead (R15 base)
- **Launch "Information available":** never shows the PM for unowned information. The step has `noOwner`.
- **Chosen approvers:** `project.approvers[bu]` ("Choose who approves") is held to `grantTooRecent`, so a recent joiner chosen that way is neither eligible nor an override co-signer (engine test).
- **Route-module refusals:** a 403 or 409 from a route module on a workspace write is logged as `action: 'refused'` (api test).

## Streams

### M1: Engine, testing, governance, server (engine owner)
**Files:** the engine and its copy, `engine.test.js`, `pages/release.js`, `pages/testing.js`, `css/release.css`, `api/pmoflow/index.js`, seed, `pmoflow-ai.js`, `api.test.js`, `e2e-release.js`, `e2e-consistency.js`, `GOLDEN-NUMBERS.md`.

1. **One owner truth.**
   - The doer of a project task created from a step is the step's owner or role, never the process owner. This applies to suggested plans, project step cards and UAT scripts S1/S2 (Karen 5, BPM disagreements 5 and 8).
   - A data owner follows its step when the step moves.
2. **One approver truth.**
   - Departments, the process page and Launch use one eligibility list.
   - A named department approver is eligible (BPM: Ana named for AR, but Launch said nobody can approve). Jordan's disagreement 1 is the other direction.
3. **Stored sponsor and PM.**
   - `project.sponsor` is the only sponsor; it is never computed. The API and UI report the same value.
   - Changing `project.owner` (the PM) is refused on a plain edit and goes through a plan change for the sponsor.
   - With no sponsor set, deadline changes route to an Admin who is not the requester.
4. **Deadline/forecast guard on every edit:**
   - effort, start and dependency edits;
   - a start after the due date, or on a day off, is refused;
   - effort changes that raise expected cost go through Change the plan when tolerance is exceeded.
5. **Tests you assigned yourself:** can't be passed in any environment (SIT too).
6. **Server-owned history fields:**
   - The forecast log is server-written only.
   - `doneAt` keeps the first completion date (a Jira reopen and re-Done doesn't overwrite it).
   - Flag future-dated hours and more than 24 hours per person per day.
7. **Profile → tests (BPM, third round):**
   - Near-duplicate, shared-bank and uniqueness warnings generate cases.
   - The data page never says "all match" while a warning stands.
   - Specs are never taken from another field's shape; routing and bank numbers allow a leading zero.
   - Never reject the majority shape.
   - Boundary cases at every threshold in the process (for example $75k, $250k, and just over).
   - Every CSV column maps to its matching item.
   - The first "Add tests" makes all tests.
8. **Unconfirmed Done is not done:**
   - "All project work is finished" waits for it.
   - The confirmer sees open predecessors before confirming.
9. **Counts:**
   - late or blocked = |late ∪ blocking|, shown with its parts.
   - Past-range "Overall" computes cost and concerns as of the period end.
   - Testing "open issues" uses the ledger's terms.
   - Post-launch: no "89%", no red approvals panel, and no "COMPLETE ✓" under "Overridden" without explanation.
   - "Try it out · tests passed · 1 failed" grammar.
   - "2 steps left cover the 1 check".
10. **Per-run data (Karen 1):**
    - Per-vendor fields (routing numbers, tax ID, bank account, credit limit) can be marked "Collected each run" and make no setup tasks.
    - Per-run items are never blockers.
    - Weekly raised − resolved = open.
11. **Re-approval scope:** only parts with changed steps, data or choices reopen (BPM: IT reopened with nothing changed).
12. **Launch copy:** remove "Each team can approve its part at any time".
13. **Phone:** tap targets of at least 32px on Launch and Testing (Jordan, third round).

### M2: Import, process pages, data pages
**Files:** import and its copy, `import.test.js`, `pages/{importsop,process,processes,data,step}.js`, `css/design.css`, `e2e-design.js`.

1. **Branch semantics (BPM top 1):**
   - The paste parser ends a path at "approve automatically / stop / reject" lines instead of flowing into the next step.
   - The choice editor offers "end here" and "skip to step N".
   - Skip-aheads are labelled "Skips to"; "Loop back" is only used for real loops.
   - Step 9 keeps its verb ("Notify the sales rep and the customer").
2. **Changed choices:**
   - The diff shows "was → now" for thresholds and labels.
   - The process card's "changed" count equals the diff.
   - Changed choices route approval to the departments that own the choice's step and the steps after it (Credit, Controller). Coordinate the engine side with M1 through the appendix.
3. **Per-run data (Karen):**
   - The import preview marks per-vendor fields as "Collected each run".
   - The duplicate "Certificate of insurance coi" is gone.
   - "X verifies…" clauses become their own step for X.
4. **Small UI:**
   - The Add-department dialog closes after a successful add.
   - Every CSV column maps to its matching item on the data page (with M1 #7).
   - The RACI fills A, C and I from approvals and notifications (the Controller is A over $250k).
5. **E2E paths:** respect Stop nodes (a rejected request never reaches "Update the credit limit"). This applies wherever paths are built in M2's files; ask M1 if it's in the engine.

### M3: PMO pages, plan changes, Home
**Files:** `pages/{home,project,projects,portfolio,dashboard,changes}.js`, the change module and routes, `change.test.js`, `css/{pmo,change}.css`, `e2e-pmo.js`, `e2e-change.js`, lint.

1. **Re-plan by real scheduling (PMO top 2):**
   - A knock-on keeps finish-to-start dependencies and durations.
   - In-progress tasks keep their starts.
   - After approval, no task that the impact screen said wouldn't be late shows as late.
   - A 10-business-day shift moves the start and the due date by exactly 10 business days.
2. **Render M1's stored sponsor and PM-change flow.**
3. **Owners:**
   - "Choose owners for N tasks" opens an owner picker.
   - Merge it with the per-task "Needs an owner" rows.
4. **Launch nav:** opens the current project.
5. **Plan-change History:** entries written by the system are never labelled "Older entry: worded by the person". Coordinate with M4 on labels.
6. **Report:**
   - Re-approvals and pending department approvals appear in asks, and their people are on the email list.
   - The finish-move from→to equals the last report's forecast.
   - Never list a Not started task under STARTED.

### M4: Admin, sync, buyer site
**Files:** `pmoflow-routes-admin.js`, `pages/admin.js`, `admin.test.js`, `e2e-admin.js`, the sync module and its copies, `pmoflow-routes-connect.js`, `pages/connections.js`, `sync.test.js`, `e2e-connect.js`, `web/public/pmoflow/**`, `e2e-buyer.js`.

1. **Role changes** (especially to Admin) use the same two-person, step-up flow as department moves, with the same one-Admin rule. History is server-written.
2. **Export labels:** entries written by the system today are never labelled "Older entry". The labels must agree with M3's.
3. **Sync:**
   - A Jira Done→reopen→Done round trip never overwrites the first completion date (with M1 #6).
   - The "N dependency links" count matches the plan.
4. **Buyer site:**
   - The compare page states honestly that there is no ServiceNow integration yet.
   - The pilot copy says plainly "we run the setup with you on one call" only if that matches what the pilot page already promises. Never invent terms.

## Shared rules
- **Ports:** M1 8951, M2 8952, M3 8953, M4 8954.
- **Never use `pkill -f`.** Never print the `.conn` file.
- **Engine ownership:** only M1 edits the engine. M1 publishes "Appendix: R15 engine API" early.
- **Before finishing:**
  - all unit suites, lint and your e2e suites pass (run e2e-admin alone);
  - check screenshots at 1366 and 390.
- **Don't commit.** Report in ≤300 words with any cross-stream asks.

## Appendix: R15 engine API (M1; all landed)

All functions are on the shared engine (`E()` in the browser, `require('api/shared/pmoflow-engine.js')` on the server). Existing shapes are unchanged unless listed here.

### 1. One owner truth (Karen 5, BPM 5/8)
- `E.stepTaskOwner(docs, pid, stepId)` → `{owner: personId|null, ownerRole: string|null, text}`: the doer of a task made from a step. The step's role first (the one person with that title, else nobody: "Needs an owner: AR Specialist"), then the step's named owner. **Never** the process owner or the PM. **M3 ask:** `normalizeSuggestions` in project.js must not fall back to `step.owner || j.owner || me` for a suggestion with no owner; keep it unowned (`owner: null`, `ownerRole` from the suggestion) or use `E.stepTaskOwner`.
- The server enforces it too: a new workItem created from a step (`pid` + `step`) whose `owner` is that step's raw `owner` (or the process owner) while the step is done by a role is saved with `owner: null, ownerRole: <role>` (or the role's one holder).
- UAT scripts (`generateUatScripts`) name the step's doer (`stepDoer`): "AR Specialist: …", never the process owner.
- A data owner follows its step: information whose owner was the step's doer (default owner) follows when that step's owner/role changes (server, on process save). `E.dataOwnersToFollow(docsBefore, docsAfter)` → `[{dataId, from, to, owner|ownerRole}]`.

### 2. One approver truth (BPM 1, Jordan 1)
- `E.partApprovers(docs, prj, bu)` → `{bu, eligible:[ids], names:[..], source:'named'|'members'|'chosen'|'none', notEligible:[{person, name, rule, text}], text:'Ana Ruiz can approve' | 'Nobody can approve the AR part yet'}`. The ONE list: the department's named approvers when it has any, else its members; plus the project's chosen approver; minus the PM, launch owner, recent joiners and separation-of-duties bars. Departments, the process page and Launch all read it (Launch's `eligibleFor` now does).
- `E.departmentApprovers(docs, bu)` → `{ids, names, source:'named'|'members'|'none', text:'Approves: Ana Ruiz'}`: the same rule without a project (process page, Departments).

### 3. Stored sponsor and PM (PMO, Jordan)
- `E.sponsorOf(docs, prj)` → `project.sponsor` when it names a person who is not the PM, else `null`. Never computed from the process owner or department. **M3 ask:** replace `C.sponsorOf`'s fallbacks with this (the API and UI then report the same value).
- `E.adminsOf(docs)` → admin person ids.
- `E.deadlineApprover(docs, prj, requester)` → `{person, role:'sponsor'|'admin'|null, text}`: the sponsor when set and not the requester; else an Admin who is not the requester (nor the PM when the PM asked); else `{person:null, text:'Nobody besides … can approve this change. Set the sponsor …'}`. **M3 ask:** route deadline/budget/PM changes with it.
- Server (doc API): once the project has work, a plain edit of `project.owner` (the PM) is refused 409 `"Use “Change the plan” to hand the project manager role to <name>, so the sponsor can approve it."`. M3's "Hand over the project manager role" plan-change kind applies it (edit `{type:'project', field:'owner', from, to}`), approved via `E.deadlineApprover` (sponsor, else an Admin who did not ask). M4's sync accepts sponsor OR Admin when no sponsor is set.

### 4. Deadline / forecast guard on every task edit (PMO)
- The forecast now respects effort: an open task can't finish before `start + effortDays` business days (basis `{kind:'effort'}`). So a 40-day effort edit moves the finish and hits the deadline guard (409) like a due-date move.
- `E.startDateProblem(w, docs)` → `null | {kind:'after-due'|'day-off', text}`; the server refuses (400) a start after the due date or on a day off.
- `E.costBreach(docsBefore, docsAfter, projectId, today)` → `null | {before, after, pct, text}` when expected cost rises ≥ 5% (`COST_TOLERANCE_PCT`); the server refuses such an effort edit (409 "Use “Change the plan” …").

### 5. Self-assigned tests (Jordan)
- `E.canPassTest(docs, prj, testId, personId, {env})`: whoever assigned a test can't pass it in ANY environment (Try it out too); the server enforces it for every env.

### 6. Server-owned history fields (PMO)
- `project.forecastLog` and `project.reportLog` are written by the server only; a client value is ignored. The server appends `{date, finish, at}` (finish = `projectTruth.forecastFinish`) when a report is recorded.
- `E.keepFirstDone(prev, next)` → next with `firstDoneAt` (server-owned) kept and `doneAt` = the first completion date on a re-Done. The doc API applies it; **M4 ask:** call it in the sync apply path too.
- Hours: the server stamps `future: true` (dated after today), `overDay: true` (that person has more than 24 hours that day across tasks), `beforeStart: true`. `E.timeEntryText(t)` names them: "8 hours on Nov 30 (logged Nov 18, future date)".

### 7. Profile → tests (BPM)
- Generated cases cover duplicate / shared-bank / uniqueness warnings (`signal`), routing/bank numbers keep leading zeros, specs never come from another field's shape, a majority shape is never rejected, every CSV column maps to its item, and the first "Add tests" makes all tests.
- `E.dataProfileStatus(docs, dataId)` → `{allMatch, warnings:[{column, kind, text}], text}`: the data page never says "all match" while a warning stands. **M2:** render `text`.
- `E.thresholdCases(docs, dataId)` → `[{dataId, field, kind:'boundary', input, expect:'accept', origin:'spec', threshold: gatewayId, note:'At the threshold $250,000 for “Requested limit over $250,000?”: takes the “No” path'}]`: at every amount threshold of the processes using the item and just past it. `generateProjectTests` and Testing's "Add tests" include them. A compound threshold (`threshold.compound`) is never simply inverted on its No path.
- `generateTests` keeps every warning case (`signal`: `duplicate`, `shared-account`, `near-duplicate`, `unique`), threshold cases and the leading-zero case even under the 6-per-field cap. Valid values use the field's own most common observed shape; `fieldSpec(...).unique` (rule "unique" or `unique: true`) makes a uniqueness test; an identifier whose sample values are all different gets one too; a routing/account/tax number is digits (leading zero valid); a score is 0–100; the majority shape is never "should be rejected".
- `splitSampleColumns` matches against all information used by the processes that use the item (not only the same steps).
- Testing's "Add tests" makes every test in one press (two passes; one failing item never stops the rest).

### 8. Unconfirmed Done (BPM, PMO)
- The "All project work is finished" launch check waits for unconfirmed Done items (`items` lists them).
- `readiness` check `work-done` adds `unconfirmed: [ids]` (also in `items`).
- `E.unconfirmedDone(...).open` (open predecessors `[{id, title, owner}]`) and `.confirmText` ("It depends on “W6”, which is still open. Confirm “W7” is done anyway?"). **M3 ask:** show `confirmText` in the Confirm dialog before saving `confirmedBy`.

### 9. Counts
- `projectTruth.lateOrBlocked = {count, ids, late, heldUp, held, both, blocking, parts, text}`; count = late + held − both; text "10 tasks late or blocked: 0 late tasks and 10 tasks held up by 9 blocking pieces of information". **M3:** show `text` next to "N blocking" so the units agree.
- Past ranges: `periodReport.overall.budget` and `.concerns` are as of the period end (`overall.costAsOf`, `overall.concernsAsOf` labels).
- `projectTruth.testing.openIssues = {count, notPassed, problems, failed, notRun, text:'17 of 26 tests not passed yet · 1 problem open'}`: the one "open issues" number.
- `projectTruth.pctDone` is 100 once launched (`pctEarned` keeps the EV share). Launch's post-launch approvals panel and launch-day card say what happened (no red 0/0, no "complete" with steps open).
- Launch: "6 steps left before launch. 9 of the 10 checks below are not passed yet." `buReady` waiting text: "information not available yet: X; 1 test to pass; tests to add for X".
- Reports: `periodReport.started` lists only tasks that have started; "since last report" compares with the snapshot saved on the window's first day (`<= from`); `projectTruth.approvalAsks(…)` / `E.approvalAsks(docs, prj, today)` → `[{person, name, bu, reapproval, what, reason}]` (re-approvals, and parts ready to approve): the status report adds them to its asks and their people to `recipients`.

### 10. Per-run data (Karen 1)
- `dataElement.perRun: true` ("Collected each run") items make no setup tasks, are never blockers, and are left out of the weekly raised/resolved/open. Only information that was ever not available is "raised". `periodReport.blockersCarriedIn` and `.blockersText` ("6 blockers open at the end (6 raised, 0 resolved)"): open = carried in + raised − resolved.

### 11. Re-approval scope and changed choices (BPM)
- A changed choice (gateway: title, threshold, branch labels, targets) involves the departments of the step that makes the choice (the step before it) and of the steps in its branches. `diffProcess(...).changes[gatewayId]` now includes `"Threshold over $250,000 → over $300,000"` when `gateway.threshold` changed.
- A part reopens only when its steps, information or choices changed (or a test it approved was edited/removed, or a test failed after approval); a no-op task save or added tests never reopen it.

### 12. Also
- Forecast basis `effort` explains itself: "“X” starts Nov 20 and needs 40 business days of effort → Jan 19".
- Scenarios: an `end` node stops the path ("The process stops here"); a forward `goto` is "Skip to “X”" (never "loop back once"); scripts say "The flow skips to …". `diffProcess` lists forward jumps as "Skips added: …" and only real loops as "Loop-backs".
- UAT scripts, scenarios and the "Train" task name the step's doer; outside parties (Vendor, Customer…) are told, never trained.
- Launch and Testing render inside `.rl-page` (display: contents); on a phone every control there is ≥ 32px.
