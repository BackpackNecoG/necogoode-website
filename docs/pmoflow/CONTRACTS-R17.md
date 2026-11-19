# PMOFlow R17: close the R16 [own data] findings, then rebuild the seed

**Input:** `market-review/r16/CONSOLIDATED-R16.md` §2 and the four reviewer files.

**Scope rule (founder ruling, Nov 18):**
- Only [own data] findings are in scope.
- [sample data] findings are handled by the seed rebuild (stream P5), never by engine code.
- [deliberate attack] findings are tracked, not built this round.
- No compatibility code for old seeded states.
- No new features beyond the findings.

**Bar:** fixed. Rule #1 (ease for non-technical users) is unchanged.

**Method:** failing test first from the reviewer's repro, then the fix.

## Already landed by the lead (R17 base)
- **release.js `buSections`:** a step done by a role belongs to the department that role maps to (engine `stepTeams` + `departmentFor`), so that department's approval page lists it.
- **Doc DELETE:** must name a person in the workspace, otherwise 403 and logged as refused (api test).

## Streams P1–P4 (in parallel), then P5 (after P1–P4 merge)

### P1: Engine, testing, governance, server (engine owner)
**Files:** the engine and its copy, `engine.test.js`, `pages/release.js`, `pages/testing.js`, `css/release.css`, `api/pmoflow/index.js`, `pmoflow-ai.js`, `api.test.js`, `e2e-release.js`, `e2e-consistency.js`.

1. **Approval page shows the real change.** Each team's page lists its new and changed steps with was→now details, and the information its steps use. Never "No steps" when the part exists. Add a test reproducing Karen's paste ("AP" role → Accounts Payable).
2. **One role→department link (engine).** A step done by a role resolves to its department through `teamDepartments` for:
   - confirming information ("Only AP can confirm" must accept anyone in Accounts Payable);
   - data ownership;
   - test-pass rights;
   - the plan card doer (show the role, never "—").
3. **Stale evidence (BPM critical).** When a choice's threshold or label changes after tests passed:
   - The affected boundary cases and gateway scripts are regenerated, and their results are cleared.
   - Routing tasks named for the old value reopen and are renamed.
   - Launch is blocked until they pass again.
4. **Test scope.**
   - Data that feeds a new or changed step is in scope even if the project doesn't change the data itself.
   - Uniqueness (when the rule says Unique), shared-bank and near-duplicate warnings generate cases.
   - Amount fields flag values above the process's highest threshold only if the rule says so. Otherwise, "$260,000" must at least be parsed as a number and checked against the rule's max.
5. **Separation of duties.**
   - The owner of a step's build task can't pass that step's tests (any environment).
   - A move out of a department reopens that person's sign-offs on parts not yet launched.
   - Test dialogs disable a pass the person can't give and say why, before any step-up.
   - Tester lists exclude people who can't record.
   - Every save error shows on screen.
   - Never assign a business check to someone who can't record it (Tom).
6. **Launch flow.** One rule for which launch-day-plan edits reopen approvals: only edits that change a team's own launch-day tasks reopen that team. The re-approval reason is kept, not overwritten. List "Launch-day plan" before "Each team approved".
7. **Counts:**
   - "Finish the work" is ✓ only when done tasks are confirmed.
   - History and report dates use the workspace time zone (send `tzOffsetMinutes`; never show the UTC date).
   - The header's late-or-held-up count must match the Work tab's rows.
   - APPROVED BY lists the approvers.
   - No raw ids or field names in History.
   - A correction is reported in the period of the original entry.
   - The report's resolved count and testing label update.
   - Step numbers agree between the RACI and the map; one team label per step.
8. **Invitees** count at Launch ("Invited: email (can approve once they join)") consistently with the process page.

### P2: Import, process pages, data pages
**Files:** import and its copy, `import.test.js`, `pages/{importsop,process,processes,data,step}.js`, `css/design.css`, `e2e-design.js`.

1. **Parser:**
   - Roles ("Carrier Integration Engineer", "Help Desk") are roles, not new teams. Map them to departments with the existing department picker.
   - "(Sam Keller)" is removed from the title and becomes the named person.
   - Information words like "member ID", "dependent SSN" and "asset tag" are picked up.
2. **Import draft survives reload** (local draft with a "Restore your draft?" prompt). The 6-digit code field accepts pasted text (this lives in shared ui; coordinate if needed).
3. **"Collected each run"** can be chosen after saving (on the information edit form). Bank letter and remit-to default to "Collected each run". Paste and BPMN use the same defaults.
4. **Choice target labels:** a later step reads "Skips to step N", never "go back".
5. **New project dropdown** counts changed choices too.

### P3: PMO pages, plan changes, Home
**Files:** `pages/{home,project,projects,portfolio,dashboard,changes}.js`, the change module and routes, `change.test.js`, `css/{pmo,change}.css`, `e2e-pmo.js`, `e2e-change.js`, lint.

1. **Hours and work:**
   - A task with logged hours can't be deleted, only cancelled (hours stay).
   - "+ Add work item" on a baselined project goes through Change the plan when it pushes cost over tolerance.
2. **Budget and capacity warnings** when accepting a suggested plan or approving a knock-on: "This plan is $3,750 over the $12,000 budget" and "Dev has 20.6 days of work in 8 working days".
3. **Cross-project knock-on:** when a knock-on pushes another project past its deadline, that project's sponsor approves.
4. **An added dependency knocks on** its dependents.
5. **Adjust plan:** an unowned task's owner box is empty ("Needs an owner"), never "Maya Chen".
6. **Waiting for you:** includes pending second-Admin confirmations.
7. **Overlap warning** when creating a second project on the same process.
8. **One expected-cost method** shown in Settings, Portfolio and the guards (with P1 for the engine).

### P4: Admin and departments
**Files:** `pmoflow-routes-admin.js`, `pages/admin.js`, `admin.test.js`, `e2e-admin.js`.

1. **Empty department path:** a department with no members shows "Add someone to Member Services so its tests can be passed", with an add-person control.
2. **Pending moves:** a move out that reopens sign-offs (P1 #5) says so in the pending card.

### P5: Seed rebuild (after P1–P4 merge, alone)
**Files:** the seed module, `GOLDEN-NUMBERS.md`, any test that reads golden numbers.

- Regenerate the Northwind sample by running the product's own actions under today's rules (the API or store calls in order), so it can't hold forbidden states:
  - no 28-hour days;
  - grants approved after they're requested;
  - stored sponsors;
  - no pre-R14 history.
- Keep it small: three projects.
- Re-baseline the golden numbers once, documenting each changed number.
- Remove compatibility branches that existed only for old seeded states, where tests show they are unused.

## Shared rules
- **Ports:** P1 8971, P2 8972, P3 8973, P4 8974, P5 8975.
- **Never use `pkill -f`.** Never print the `.conn` file.
- **Engine ownership:** only P1 edits the engine. P1 publishes "Appendix: R17 engine API" early.
- **Before finishing:**
  - all unit suites, lint and your e2e suites pass (run e2e-admin alone; run e2e-buyer with a fresh `PMO_TEST_IP`);
  - check screenshots at 1366 and 390.
- **Don't commit.** Report in ≤300 words. Never weaken a test; explain any changed assertion.

## Appendix: R17 engine API (P1; landed)

All functions are on the shared engine (`E()` in the browser, `require('api/shared/pmoflow-engine.js')` on the server). Existing shapes are unchanged unless listed here.

### 1. The approval page (landed)
- `E.partChanges(docs, prj, bu)` → `{bu, steps, same, choices, information, text}`. It uses the gate's own rule (`sectionBus`), so a part the gate asks to approve is never empty.
  - `steps: [{pid, process, id, title, status: 'new'|'changed'|'removed', doer, changes: ['Title "a" → "b"', 'Owner Maya Chen → AP', …]}]`
  - `choices: [{pid, id, title, status, changes}]`
  - `same: [{pid, id, title}]`
  - `information: [{id, name, why: 'changed'|'used'}]` (what the part's new and changed steps use)
  - `text`, for example "1 new step, 1 changed step"
- release.js's approver page renders it (`data-bu-step`, `data-bu-step-status`, `data-bu-choice`, `data-bu-data`).

### 2. One role → department link (landed)
- `E.roleDepartment(docs, proc, role)` → department name or `null`. Order: teamDepartments for the whole role, then its team words, then a department of the same name ("AP" → Accounts Payable).
- `E.roleHolders(docs, role, proc?)` → `[personId]`: people with that title plus everyone in the role's department.
- `E.canConfirmInformation(docs, dataId, personId)` → `null` or `{text, people}`. Example text: "Only someone in Accounts Payable (AP) can confirm Bank letter."
- `E.dataOwner(...)` adds `department` and `people`.
- `E.stepDoerLabel(docs, pid, stepOrId)` → `{owner, role, department, text}`. `text` is the person, else the role, else "Needs an owner"; never "—".
- `canPassTest` matches departments with `sameTeam`.
- `roleTeams` matches a known department or mapped team name that contains a space ("IT Security") as a whole, before splitting it into team words.
- `teamRouting(...).teams[].role === true` marks a job title a step is done by that no step tags, that no department is named after, and that has no team word ("Carrier Integration Engineer"). The sentence counts teams and roles separately: "All 3 teams and 1 role have an approving department".
- **P2 ask:** `data.js` `canEdit` should use `canConfirmInformation(...) === null` and show its `text`. Read `teamRouting(...).teams[].role` instead of the local `roleRowsOf`.
- **P3 ask:** the Plan map card (`project.js` `nodeHTML`, today `pname(n.owner)`) should show `stepDoerLabel(docs, pid, n).text`.

### 3. Stale evidence after a rule change (landed)
- `E.ruleChangeEffects(before, after, at)` → `[{pid, process, gateway, title, from, to, what, cases: {put, remove}, projects: [{projectId, resets, uatScripts|null, tasks: [{id, from, to, reopened, patch}], text}], text}]`.
- `E.ruleChangeWrites(docs, effects, at)` → `[{type, id, data|null}]`.
- On a process save, the server applies these writes and logs each project's `text`. Example: "The choice “Requested limit over $150,000?” changed (over $200,000 → over $150,000): 2 boundary tests and 2 business check scripts were regenerated and must pass again; “Route requests over $200,000 to the Controller” reopened as “Route requests over $150,000 to the Controller”."
- `project.evidenceResets: [{at, gateway, pid, text, tests, tasks}]`, plus `resetAt` on regenerated cases and scripts. A result recorded before the reset never counts (`testFacts`, `latestOutcomes`). The tests-passed check's detail starts with the reset text. Launch stays blocked through the tests and work checks; there is no separate check.

### 4. Test scope (landed)
- `changedInformation` reason `'step'`: information that feeds a NEW step, or that a changed step uses and didn't use before.
- A case with a `signal` (Unique, shared bank, near-duplicate) on information the project uses always counts in the ledger.
- `profileCsv`: an amount column with money-formatted values reads "$260,000" as 260000 (`min`/`max`), and counts values that aren't numbers (`nonNumeric`). `specDrift` flags them. `E.withThresholdMax(docs, de)`: a field whose rule mentions the threshold gets the process's highest threshold as its max. Without that, only the rule's own max applies.
- `testing.next` wording: "Add tests for N pieces of information" (the word "new" is gone).

### 5. Separation of duties (landed)
- `canPassTest` adds `rule: 'builder'`: the owner (or finisher) of a build task on the script's step can't pass it, in any environment, even if it is assigned to them. The server enforces this in every environment.
- `E.testRecorders(docs, prj, testId, opts)` → `[personId]`. testing.js tester lists use it.
- A move out reopens the approval even when only `bu`/`buSince` changed and an older settings doc still names the person.
- `who`'s business-check row goes to someone who can record the first test not yet passed. It never goes to someone who can't (Tom).

### 6. Launch flow (landed)
- The part fingerprint ignores task `order`.
- Launch steps order: plan, work, information, tests, **launch-plan**, approvals, launch. release.js lists "Launch-day plan" before "Approvals" and never adds "Launch-day plan edited" to another team's reasons.

### 7. Counts (landed)
- The "Finish the work" step needs every Done confirmed. It returns `unconfirmed`. Action example: "2 finished tasks need someone else to confirm they are done".
- `periodReport` dates timestamps in `range.tzOffsetMinutes`. A correction counts in its original entry's period.
- A blocker is resolved on the day of its evidence, check or finished fix task.
- When every team has approved, `testing.next` reads "Tests passed and every team approved its part".
- `E.stepNumbers(docs, pid, version?)` → `{stepId: n}` and `E.stepTeamLabel(docs, pid, step)`. **P2 ask:** use these for RACI/map numbers and the step's team label.
- **P3 ask:** Work rows in `projectTruth(...).lateOrBlocked.ids` show "Held up" so that they match the header.
- History: internal fields are hidden, dependency edits name the tasks, and ids that resolve to nothing read "a removed item".

### 8. Invitees (landed)
- `teamRouting` rows, Launch part cards and the approvals launch step all say "Invited: email (can approve once they join)".

### P3 follow-ups (landed)
- `status: 'cancelled'`: `list()` leaves cancelled tasks out, so they are never open, late, forecast, estimated, earned or blocking. Their logged hours stay in `ev.AC` and in the expected cost.
- One expected-cost method: `ev.eacMethod` is always `'bottom-up'`. `EAC = max(AC, estimate, AC + remaining estimate)`. CPI is an index only.
- `costBreach` reads that same number. An unpriced task is priced at the default rate for the warning, which says "(estimated: …)" and sets `estimated: true`.
- `personQueue` adds `{kind: 'adminConfirm', id, title: 'Confirm: <text>', href: '/admin', by, byName, at, change}` for each Admin who may confirm a pending department or role change.
- Server 409s with "Use “Change the plan” …":
  - a NEW task on a project with a saved plan that breaches the cost tolerance;
  - a dependency that moves a task other open tasks wait on. The body includes `knockOn: [ids]` and `shift`.
