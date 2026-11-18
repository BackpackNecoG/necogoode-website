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
