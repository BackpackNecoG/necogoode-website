# PMOFlow R13: close the R12 review findings

**Input:**
- `market-review/r12/CONSOLIDATED-R12.md`: ranked fixes #1–#15 in §3.
- The four reviewer files next to it, which hold the exact repro steps.

**Bar:** the same fixed bar as R10–R12. It doesn't move. New findings go to `R14-BACKLOG.md`.

**Unchanged:** Rule #1, positioning, and the banned words.

**Method (kept from R12):** each item gets a failing test written first from the reviewer's repro. Then fix the code.

## Streams

Each stream owns whole files. The engine has a single owner. Item numbers below refer to CONSOLIDATED-R12 §3.

### K1: Engine, testing ledger and governance (the engine owner)

**Files:**
- engine + web copy, `engine.test.js`
- `pages/release.js`, `pages/testing.js`, `css/release.css`
- `api/pmoflow/index.js`, seed, `pmoflow-ai.js`, `api.test.js`
- `e2e-release.js`, `e2e-consistency.js`, `GOLDEN-NUMBERS.md`

**Items:**
- **#1 engine side:** departments become workspace data, `workspace.departments = [{ id, name, approvers: [personId] }]`. The seeded six become ordinary editable entries. Routing reads from this data. Publish the shape early.
- **#2:** one testing ledger.
  - The report counts the latest result per test.
  - Each total is defined once and used everywhere.
  - The coverage summary equals the matrix.
  - Launch shows one phrase and one number.
  - The approver page shows who passed each test.
- **#3:** close the separation-of-duties loopholes.
  - Self-assignment across departments.
  - The person who assigned a test can't pass it.
  - A deadline-breach plan change needs the sponsor (or the project's default approver). The requester never approves it, and a person with two roles counts once.
  - One approval-readiness rule, enforced server-side for both views.
- **#4 engine:** ownership. Unowned work is never attributed to the PM anywhere in the engine's outputs (`who`, the report's asks, the launch list, step cards). Don't show "On track" while most tasks are unowned: add the reason "N tasks need an owner".
- **#5:** held, out-of-order or unverified inbound statuses don't move the forecast or EV.
- **#6:** planned value from the baseline. Knock-on moves update dates. Scope cost raises EAC. No expected cost without rates.
- **#7 engine:** make sure the uniqueness test, shared-account and near-duplicate checks reach `generateTests` and profile outputs. Strengthen name masking.
- **#11:** reports.
  - Exact-time "since last report".
  - No present-day leakage into past ranges.
  - Mark stale approvals.
  - An override counts as an exception.
  - Correct counts.
- **#12 engine:** `personQueue` includes re-approvals and held inbound items.
- **#13:** the launch-day card reads from the gate.

### K2: Import, process pages, departments UI

**Files:**
- import + web copy, `import.test.js`
- `pages/{importsop,process,processes,data,step}.js`, `css/design.css`, `e2e-design.js`

**Items:**
- **#1 UI:** an "Add a department" control in the approver panel, which writes through K1's shape.
- **#8:** identity merge (Role (Name) and Name are one actor). A from "signs off/approves", C and I from phrases. The matrix includes Wait steps.
- **#9:** parser.
  - An unnumbered "if…approves" line becomes a choice and an approval, and is counted.
  - Compound lines are split.
  - Check/screen lines become steps.
  - More data fields are extracted.
  - "Teams involved" lists teams only and equals the panel.
- **#10:** removing a step reopens the owning team's approval and creates a "tell" task.
- **#14:** all import entry points work, errors are shown, the Visio page name is kept, and folded elements are disclosed.

### K3: PMO pages, plan changes, Home

**Files:**
- `pages/{home,project,projects,portfolio,dashboard,changes}.js`
- change module + routes, `change.test.js`
- `css/{pmo,change}.css`, `e2e-pmo.js`, `e2e-change.js`, lint

**Items:**
- **#4 UI:** render "Needs an owner" everywhere. The task Edit dialog defaults the owner to blank.
- **#3 plan-change routing:** the sponsor approves a deadline breach, the requester is never an approver, and one person counts once across linked projects.
- **#11 UI:** an inverted date range shows a message.
- **#12:** Home "Waiting for you" shows re-approvals and held Jira items.
- **#13:** holiday due dates are refused in Change the plan.
- **#15:** phone polish on these pages.

### K4: Admin, sync, buyer site

**Files:**
- `pmoflow-routes-admin.js`, `pages/admin.js`, `admin.test.js`, `e2e-admin.js`
- sync module + copies, `pmoflow-routes-connect.js`, `pages/connections.js`, `sync.test.js`, `e2e-connect.js`
- `web/public/pmoflow/**`, `e2e-buyer.js`

**Items:**
- **#1 Admin:** a Departments tab. Create, rename and remove departments, set approvers, and assign people. Invites include a department.
- **#5 sync side:**
  - flag held and out-of-order items for the owner (the queue entry comes from K1);
  - the JSON and CSV verify messages show the key source the same way.
- **Buyer site:** add "PMOFlow manages the change to a process, not each run of it" to the compare page, with honest wording.

## Shared rules

- **Ports:** K1 8931, K2 8932, K3 8933, K4 8934.
- **Never use `pkill -f`.** Never print the `.conn` file.
- **Engine ownership:** only K1 edits the engine. K1 publishes "Appendix: R13 engine API" early.
- **Before finishing:**
  - all unit suites, lint and your e2e suites pass;
  - check screenshots at 1366 and 390.
- **Don't commit.** Report in ≤300 words with any cross-stream asks.

## Appendix: R13 engine API (K1, published early; shapes are stable, items marked *landing* are being filled in)

`E` = `api/shared/pmoflow-engine.js` (web copy `app/engine.js`, byte-identical). Render these; never count locally.

### #1 Departments are workspace data

**Stored:** the workspace settings doc, `docs.workspace` entry id `'settings'` (the same doc as `roles`/`invites`/`anchors`):

```js
settings.departments = [{ id: 'dept-procurement', name: 'Procurement', approvers: ['rv'] }, ...]
```
- `id`: `dept-<slug of the name at creation>`; never changes on rename. `name`: unique (case-insensitive, trimmed, 1–60 chars).
- `approvers`: person ids who approve this department's part of a project. May be empty (then the department's members are eligible, as before).
- **Membership stays `person.bu = <department name>`.** A rename must rewrite `person.bu`, every `process.teamDepartments` value and every `project.approvers` key: use `E.departmentEdit` below, which returns all the patches.
- **Seed:** the six existing departments (Accounts Payable, Compliance, IT, PMO, Procurement, Treasury) are ordinary entries; approvers are the department heads (AP `nb`, Compliance `do`, IT `sk`, Procurement `rv`, Treasury `gw`; PMO none).
- **Old sandboxes** with no `departments` array: the engine derives the list from `person.bu` (as R12), `configured: false`.
- **K4 heads-up:** `routes-admin.settingsOf()` currently rebuilds the settings doc from `roles/invites/anchors` only. Any admin write must keep `departments` (spread the stored doc first), or a role change wipes them.

**Read:** `E.departments(docs)` → `[{ id, name, approvers: [personId], approverNames: [string], people: [{ id, name }], configured }]`, sorted by name. This is the one list for the approver panel pick list, Admin's Departments tab and invites.

**Write helper (pure):** `E.departmentEdit(docs, op)` → `{ ok, error, departments, people: [{ id, bu }], processes: [{ id, teamDepartments }], projects: [{ id, approvers }] }`. Only the changed docs are listed; the caller saves each.
- `op = { kind: 'add', name, approvers? }`
- `op = { kind: 'rename', id, name }`
- `op = { kind: 'remove', id }`: refused (`ok: false`, error text) while people are still in it; otherwise its `teamDepartments` values become `null` ("Choose who approves for …") and its `project.approvers` keys are dropped.
- `op = { kind: 'approvers', id, approvers: [personId] }`
- `op = { kind: 'assign', personId, id | null }`: sets `person.bu` (null clears).
- Errors are plain sentences: "Name a department.", "A department called Credit already exists.", "Move the 2 people in Credit to another department first."

**Server route (K1, `api/pmoflow/index.js`):** `POST /ws/:ws/departments` `{ op, actor }` with the same `op` as above. Admins and Editors may `add`; `rename`, `remove`, `approvers` and `assign` are Admin only (403 with the standard "Only an Admin…" sentence). It writes the settings doc and the returned person/process/project patches, then appends one audit event ("Added the Credit department", …). Returns `{ ok: true, departments }`. K2's "Add a department" (approver panel) and K4's Admin tab both call this route.

**Routing:** the department names come from `E.departments(docs)`. With a configured list, the built-in six names are no longer assumed: a team routes to a department only through `process.teamDepartments` or a department of the same name (or abbreviation AP/AR/HR/IT). `E.teamRouting(docs, proc).departments` is now `E.departments(docs)` (same `{ name, people }` plus `id`, `approvers`).

**Who may approve a part:** the department's `approvers` when that list is non-empty; otherwise its members. Plus `project.approvers[dept]`. Minus the PM, the launch owner, and anyone barred (does steps in the part, recorded or **assigned** its tests).

### #2 One testing ledger (landed)
- `projectTruth.testing` adds `cases`, `scripts` (total = cases + scripts; only information the project changes). Advanced KPIs, the trace strip and the coverage matrix read it; unchanged information is "Not counted".
- `readiness` check `tests-passed.count` = tests not passed (total − passed): the gate row's number.
- `testing.perBU[bu]` adds `tests: [{ id, kind, label, status, passedBy, passedByName, passedByDept, otherDept, passedAt }]`, `passedByText`, `otherDeptPasses` (approver page: who passed each test).
- `periodReport(...).testsRun` = `{ runs, tests, passed, failed, blocked, stages: { system, uat }, ledger, text }`: each test's latest result per stage; `ledger` (today's stage counts) only when the window ends today.
- Launch Simple and Advanced headline: `projectTruth.stepsLeft` ("6 steps left").

### #3 Separation of duties (landed, server-enforced)
- `E.canAssignTest(docs, prj, testId, actor)` → `null | { rule: 'department', text }`: the PM or someone in a department whose part the test covers. Server stamps `assignedBy` on `testCase` (and on `project.uatScripts[i]`).
- `E.canPassTest` adds `rule: 'assigner'`: whoever assigned a test can't pass it.
- PUT `approval` (approved, no `kind`) is refused with `buReady(...).sentence` while the part is not ready: one rule for Simple and Advanced.

### #4 Ownership (landed)
- `projectTruth.unowned` = open task ids with no real owner. Reason "N tasks need an owner"; label **"Tasks need owners"** (amber) when most open tasks are unowned. One `who` row `{ why: 'owner', person: null, name: 'Needs an owner', what: 'Choose owners for N tasks', ref: 'owners:<prj>', items }`. The "Finish the work" launch step names real owners only, action "N tasks still open (M need an owner)".

### #5 / #12 Held inbound items and the queue (landed)
- `E.isHeld(w)`: `status !== 'done'` and `w.syncHold`. A held item earns no new EV (`syncHold.progress` if K4 records it, else a 100% from the tool counts 0); a held defect fix never releases its held test.
- `who` row `{ why: 'hold', ref: 'hold:<id>', person: syncHold.confirmBy | null }`, "Confirm “<task>” finished in <tool>"; with no confirmer, "Needs an owner".
- `personQueue` adds `{ kind: 'syncHold', id, title, tool, key, reason }` for `confirmBy`, and re-approvals `{ kind: 'approval', reapproval: true, title: "Approve X's part again" }` even before the part is ready.

### #6 EV (landed)
- Planned value runs on the latest **saved** baseline's dates (`baselines[]` without `auto`); work added since is valued at its own cost on top of BAC. `workItem.cost` = a fixed cost (licence, fee) that adds to the task's cost.
- No budget, no hours, and an unpriced open task (no owner with a day rate, no fixed cost): `cost.forecast/estimate = null`, `cost.show = false`.

### #10 Removed steps (landed)
- A removed Today step's team is an approving section (`sectionBus`) and is in the plan's "Tell affected teams". Tasks with `tag: 'tell-removed'` and `teams` already tell those teams; the plan's tell task skips them.

### #11 Reports (landed)
- `reportLog[i].at` / `lastReportAt` with a time: "since last report" counts timestamped facts after it (`window.since`); day-only facts from the next business day. **K3: write `at: new Date().toISOString()` on the report log entry and `lastReportAt`.**
- A past range undoes plan changes applied after it (their `snapshots.before`).
- `approvalsGiven[i]` adds `again`, `stale`, `text`. `projectTruth.reapprovals` / `reapprovalsText` ("Compliance and IT approved again after changes"). An override launch adds a `release:<id>` exception.

### #13 Launch-day card (landed)
- `E.launchDayCard(docs, prj, today)` → `{ ready, label, text, steps: [{ taskId, task, done, problem, text }] }`; "Ready" only when the gate's `cutover-plan` passes.
