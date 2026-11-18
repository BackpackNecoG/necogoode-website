# PMOFlow R11: Close the R10 review findings (integrity, separation of duties, import fidelity, trust)

**Input:** `market-review/r10/CONSOLIDATED-R10.md`, plus the four reviewer files next to it. They hold the exact repro steps; read the ones your items come from.

**The acceptance bar is unchanged from R10.** It doesn't move. This round targets its failed criteria:
- no contradictions between screens;
- C20 ≥ B;
- C18 ≥ C+.

New findings go to `R12-BACKLOG.md`.

**Rule #1 still governs.** Positioning is "bring your tools or start fresh". The banned-word list from R10 still applies.

## Streams (organised by job; each stream owns whole files and nobody edits files outside their list)

### G1: Governance integrity (the engine owner)

**Files:**
- `api/shared/pmoflow-engine.js` (+ web copy), `engine.test.js`
- `pages/testing.js`, `pages/release.js`, `css/release.css`, `e2e-release.js`
- `api/pmoflow/index.js`: permissions only (the lead has handed this file to you for R11)
- `api/shared/pmoflow-seed.js`, `api/shared/pmoflow-ai.js`, `api.test.js`
- `e2e-consistency.js`, `GOLDEN-NUMBERS.md`

**Tasks:**

1. **One `testingTruth`.**
   - Every one of these reads only it: Simple Testing, Advanced Testing, the coverage matrix, the launch gate ("Tests passed"), the Launch page per-team "waiting on N", the approver page, the status report, Home "run the N tests", and the audit summary strings.
   - Coverage includes **data-element coverage**: an element with 0 cases is "not covered". The matrix and the summary use one denominator.
   - Recording one phase never changes the other phase's counts.
   - A test linked to an open problem can't be "passed" until the problem is fixed.
   - The approver page's "N of N" includes coverage gaps, and says so plainly.
   - Fix the "passed passed" wording.
   - Extend `e2e-consistency` to assert every one of the screens above.
2. **Separation of duties, enforced server-side and shown in the UI.**
   - **Bulk pass:** the person can only pass tests assigned to them, or unassigned ones.
   - **Recording vs approving:** whoever recorded results for a team's tests can't approve that team's part.
   - **Step owners:** a step owner can't approve the part containing their own steps.
   - **Launch overrides** (window, open launch-day steps) need a second person: PM plus sponsor/approver, both with step-up.
   - **Admin role** grants no exemption.
   - The Admin security tab must state exactly what is enforced. Unit-test every rule against the API.
3. **Launch screen consistency.**
   - "N steps left" equals the FAIL/WARN rows.
   - "Ready to launch" is only shown when the button is enabled. Otherwise say why: "Ready except: launch window opens Mon Dec 7".
   - A launch window on a weekend, holiday or workspace day off is flagged on Launch, Dashboard and status, never shown as "On track".
   - Access grants: dates are local (not UTC). Duration never exceeds the stated maximum. "Open" vs "waiting for approval" counts are consistent across Launch, the gate and History.
4. **Plan sanity (`suggestWorkFromDiff` / `planFit`).**
   - Cap task length at 10 business days by default, splitting longer work.
   - Never offer a plan that is late on arrival without a clear warning and an option, e.g. "This needs until Mar 4, past your Jan 19 deadline. Accept anyway / Adjust".
   - Role-only steps get a named person when exactly one person in the workspace has that role. Otherwise the task is unassigned with the role shown ("Needs an owner: Credit Analyst"), never the PM by default.
   - "Tell affected teams" uses the process's actual teams.
5. **Lateness and status consistency.**
   - One "late by N business days" per task, used on the Work tab and in the report.
   - "was due" only for past dates.
   - "0 blocking" vs "holds up 2": define blocking once and use it in the header, report and risk register.
   - The risk register's task state is live.
6. **Earned value.**
   - Show 0.00 when actual cost > 0 and EV = 0, flagged "Spent with nothing finished".
   - One EAC method across projects: BAC/CPI when CPI is defined, else max(bottom-up, spent + remaining estimate). Never below spent.
   - Warn when work is marked Done (including via Jira) with 0 hours logged.
7. **Sprints.** Holiday-aware working days and capacity.
8. **Seed.**
   - Dave Ortiz (and any approve-only persona) is an **Approver** role, a free seat.
   - Make sure the demo shows the "approvers are free" pitch.
   - The decision node is not counted as a step change in `changeSummary`. Count steps, waits, messages and subprocesses only, so "10 steps · 4 new · 6 changed" can't exceed the step count.
9. **Jira inbound dependency check.** When a Jira/ADO "Done" arrives for a task whose predecessors are open, accept it but flag it in the sync log and on the task: "Finished before the work it depends on". G1 adds the engine helper. G4 renders it on Connections.

### G2: Import fidelity, process pages and RACI

**Files:**
- `api/shared/pmoflow-import.js` (+ web copy), `import.test.js`
- `pages/{importsop,process,processes,data,step}.js`, `css/design.css`, `e2e-design.js`

**Tasks:**

1. **The parser never drops a numbered or bulleted line.**
   - Show "9 lines → 9 steps".
   - Lines with unusual numbering ("6 - …", "6)", "Step 6:") are steps.
   - Add a fixture for each reviewer SOP: Karen's 9-line vendor procedure, the expert's 12-line credit-limit SOP, Jordan's examples.
2. **Branch semantics.**
   - "Otherwise…" or "If not…" is the **else branch** of the preceding choice, not a step.
   - The reject branch **ends** by default ("Stop: request rejected").
   - SLA escalation ("if not approved within 2 days, escalate to CFO") is a **timer on the step** (boundary timer in BPMN), not a choice.
3. **Roles.**
   - Detect a role at the start of a sentence ("Buyer gets…", "Credit/Finance reviews…") and "Role (Name)" anywhere in a line.
   - Strip leading articles ("The Credit Manager" → "Credit Manager").
   - Never invent junk information items. "Known number" from "vendor's known number" should be the information "Vendor phone number", or leave it out.
   - Expand the systems dictionary to about 60 common ones (ERP/CRM/HR/finance/ITSM: Workiva, Dun & Bradstreet, Coupa, Ariba, Concur, Workday, NetSuite, SAP, Oracle, Dynamics, QuickBooks, Salesforce, HubSpot, ServiceNow, Zendesk, DocuSign, Adobe Sign, SharePoint, Teams, Outlook, Excel, …). Systems never become data names.
4. **Owner consistency.**
   - The information owner shown in the preview is what gets saved. Default it to the step's owner or role, not the importer.
   - Process page and project page show the same step owner.
   - "Things to check" counts recompute live and agree ("N steps need someone").
5. **Status labels.** One label per state. "Not checked yet" and "Not available yet" are different states and must never both describe the same item. Use the engine's `availLabel` everywhere.
6. **Processes list.** It shows the saved step and information counts immediately after save, not only after Future is opened.
7. **BPMN.** Import boundary timer events and keep them on round-trip. Don't drop them.
8. **RACI.**
   - In Advanced, label the section "RACI: who else is involved".
   - Add a **RACI matrix** view (steps × people/roles, R/A/C/I cells, editable) as a process view tab in Advanced.
   - Export it as CSV.
   - Put RACI in the BPMN export as `potentialOwner` + an extension.
   - Show R/A/C/I on the step page.
   - Re-approval reasons say **what** changed ("Treasury must approve again: 'Capture banking details' owner changed").
9. **Discoverability.**
   - "Paste a procedure" page offers "or import a Visio / BPMN file".
   - Visio-imported processes take the page name, not the file name.
10. **Profiling.** Uniqueness and cross-row rules: detect duplicates for "Unique per vendor". Show every spec rule the tests use (lengths) on the data page.

### G3: PMO pages (project, home, portfolio, dashboard)

**Files:**
- `pages/{home,project,projects,portfolio,dashboard,changes}.js`, `css/{pmo,change}.css`
- `e2e-pmo.js`, `e2e-change.js`, `lint-no-local-counting.js`

**Tasks:**

1. Render G1's new truths (lateness, blocking, testing, EV flags, plan sanity warning) wherever these pages show them. Never count locally.
2. **Suggested plan dialog.**
   - Show G1's late-on-arrival warning.
   - Don't lose the suggestion if the user navigates away: keep it as a draft on the project until accepted or dismissed.
3. **Timeline.**
   - Axis labels never overlap on multi-month spans: adaptive ticks (weeks → months).
   - "Retire the old step" shows the removed step's name, not "Unknown step".
4. **Sprints view.** Holiday-aware days and capacity, from G1.
5. **Dashboard workload** lists the same people as Portfolio workload.
6. **Enter key.** Enter inside an information chip input never submits and closes the step editor. That editor belongs to G2, so tell G2 if the handler is there. Check `ui.js` modal Enter handling and report it to the lead.

### G4: Trust, platform and buying path

**Files:**
- `api/shared/pmoflow-routes-admin.js`, `pages/admin.js`, `css/admin.css`, `admin.test.js`, `e2e-admin.js`
- `api/shared/pmoflow-routes-connect.js`, `pages/connections.js`, `pmoflow-sync.js` (+ copies), `sync.test.js`, `e2e-connect.js`
- `api/shared/pmoflow-store.js` (sandbox creation only)
- `web/public/pmoflow/**`, `e2e-buyer.js`

**Tasks:**

1. **Audit integrity.**
   - Make the chain **keyed**: HMAC-SHA256 of the head, keyed per workspace with a server secret from app setting `PMOFLOW_AUDIT_KEY`, falling back to a dev key derived from the storage connection.
   - Exports carry the signed head and entry count.
   - "Verify" fails on: a deleted tail (count/anchor mismatch), a re-hashed forgery (bad signature), an edited entry.
   - Chain **at write time** if feasible without a lock problem, using an optimistic retry on a per-workspace head row. Otherwise keep export-time chaining, but state exactly what is and isn't guaranteed.
   - Update the security page and Admin wording so they **never overclaim**.
2. **Sandbox limits.**
   - Raise the per-network daily cap to 50.
   - Allow returning visitors to keep their sandbox via a cookie (`pmoflow_ws`, HttpOnly, SameSite=Lax, 30 days), in addition to localStorage.
   - Keep a stricter per-network **burst** limit (10 per 10 minutes) for abuse.
   - One clear message: "This network has started a lot of demos today. Try again tomorrow, or book a guided demo."
   - Tests for each limit.
3. **Seats.** Admin shows the correct plan name and limits. Approvers count as free.
4. **Connections.**
   - Fix the sync counters ("N changes sent" equals the log; "changed issues since last sync" is correct).
   - Render G1's "finished before the work it depends on" flag.
5. **Buyer site:**
   - "What does the Team plan need from IT?" Plain answer, from SECURITY-FACTS:
     - Team runs hosted with no Azure install.
     - The in-tenant API / relay is for Business when you want data and keys in your tenant or tool sync.

     **Verify this against the actual architecture docs before writing. If it's not true, write what is true.**
   - **Vendor continuity:** state the facts only.
     - The customer's data stays in their tenant.
     - Export is available anytime (CSV/JSON/BPMN).
     - Source code escrow is "available for Business and Enterprise on request". That is a founder decision, so wrap it in `<!--FOUNDER-CONFIRM-->` and keep it **out of the published page** until confirmed.
   - **SOC 2 / pen test:** keep "planned". Do **not** invent dates. Add a "Request our security packet" link (to the demo form with topic=security).
   - **Pricing estimator:** fixed "0 editors → 1 editor" mismatch (min 1, and the input shows 1).
   - **Pilot price:** leave pricing.json as is. **Founder decision pending.**

## Shared rules

- **Reading:** read `AGENT-ONBOARDING.md`, `UI-STREAM-RULES.md`, this file, then `CONSOLIDATED-R10.md`, plus the reviewer files for your items.
- **Ports:** G1 8901, G2 8902, G3 8903, G4 8904.
- **Dev server:** start with `nohup env PMOFLOW_STORAGE_FILE=/home/claude/.pmoflow-storage.conn node tests/pmoflow/devserver.js <port> > /tmp/dev<port>.log 2>&1 &`. Stop with `fuser -k <port>/tcp`.
- **Never use `pkill -f`.** Never print the `.conn` file.
- **One fixed `x-forwarded-for` per test run.** G4 is raising the sandbox limits; until then, keep each test run to 3 sandboxes or fewer per IP.
- **The engine has a single owner (G1).** Other streams publish engine requests in their report or read G1's "Appendix: R11 engine API" at the end of this file.
- **Before you finish, run:**
  - all unit suites: engine, api, import, sync, relay, admin, change;
  - lint;
  - your e2e suites.
- **Look at screenshots at 1366 and 390.**
- **Don't commit.** Report in ≤300 words, including exact asks for the lead.

## Appendix: R11 engine API (G1, published; shapes are stable)

`E` = `api/shared/pmoflow-engine.js` (web copy `app/engine.js`, byte-identical). Everything below is also on `projectTruth(docs, prj, today)`. **Render these; never count locally.**

### Testing: `testingTruth(docs, prj, today)` = `projectTruth(...).testing`
- `{ passed, total, failed, waitingForFix, failedOnly, blocked, notRun, count: "9 of 26 tests passed", next, sentence, stage, done, needTests, haveTests, stages, perBU, coverage, status, phases, heldBy }`
- **Each phase keeps its own latest result.** `stages[0]` is Try it out: dev/sit/system runs, cases only. `stages[1]` is Business sign-off: uat runs, all tests. Each stage has `{ key, label, total, passed, failed, blocked, notRun, run, done }`. Recording one phase never changes the other phase.
- **A test counts as passed** when its latest business check passed, it has no Try-it-out fail, and it isn't held. It is **held** while an open problem linked to it (`workItem.testRef`) isn't fixed: defect state new, triaged or in progress. A held test is never passed, in any phase. It counts in `failed` ("needs fixing"), and `waitingForFix` gives the number. `failed` = `failedOnly` + `waitingForFix`. `notRun` = `total − passed − failed`, so blocked tests count as not run.
- **`coverage`** = `{ denominator: 'information this project changes', needTests, haveTests, gaps, notCovered: [dataId], elements: [{ dataId, name, cases, fields, fieldsCovered, uncoveredFields, covered, state: 'covered' | 'no-cases' | 'fields-missing' }], scriptGaps: [{ pid, step, title }], notChanged: [{ dataId, name, cases }], text }`.
  - An element with 0 cases is not covered.
  - `gaps` = elements not covered + changed steps without a script. The matrix header shows "N not covered" = `gaps`.
  - `notChanged` lists information that needs no tests. Show it, but never count it.
- **`perBU[bu]`** = `{ total, passed, failed, blocked, notRun, gaps, gapCount, checks, text, notChanged, notChangedText }`.
  - `text` is the approver page's line, with coverage gaps included, e.g. "0 of 12 checks done: 0 of 11 tests passed, and 1 piece of information has no tests yet (Bank remittance details: Bank name and Account number)". With no gaps it reads "9 of 9 tests passed". The words "passed together" must never repeat "passed".
  - `notChangedText` reads "Not tested because this project does not change them: …".
- **`status[testId]`** is `'passed' | 'failed' | 'fix' | 'blocked' | 'notRun'`. **`phases.system[testId]`** and **`phases.uat[testId]`** give the raw latest outcome.
- **`runAuditText(docs, prj, runDoc)`** gives the audit line for a recorded run, e.g. "Recorded the business check for X: 13 results (12 passed, 1 failed). Business check now 21 of 26 tests passed."
- The gate check `tests-passed` is built from the same facts: `passed`, `total` and `coverage` match exactly, plus `held` and `scriptGaps`.

### Separation of duties
- **`approvalBar(docs, prj, bu, personId)`** returns `null`, or `{ rule: 'project-manager' | 'launch-owner' | 'step-owner' | 'recorded-tests', text }`.
  - Nobody approves a part they do steps in, or recorded **any** test result for.
  - The Admin role is no exemption.
- `approvals[i].blockedBy` = `{ rule: 'separation-of-duties', reason, person, people, text, fix, suggestion }`.
- `bu-signoff.sectionStatus[i]` gains `stepOwners`, `recorders` and `barred: [{ person, rule, text }]`.
- **Launch overrides:**
  - `launchGuard(docs, prj, now)` takes `now` as the person's local wall time, "YYYY-MM-DDTHH:MM". It returns `{ ok, why, codes: ['window', 'tasks'], windowOpens, openTasks, text: "Ready except: the launch window opens Tue Dec 29, 7:30 AM; …" }`.
  - `launchOverrideStatus(docs, prj, now)` returns `{ needed, ok, overridden, signoffs: [{ role, by, name, at, reason }], missing: ['pm', 'sponsor'], text }`.
  - `overrideSignerRole(docs, prj, personId)` returns `'pm' | 'sponsor' | null`. A sponsor is `project.sponsor`, else anyone eligible to approve a part. It is never the PM or the launch owner.
  - A sign-off is an `approval` doc: `{ kind: 'launch-override', projectId, role, approver, decision: 'approved', stepUp: true, reason, at }`. It has no `bu`, and it never counts as a team's approval.

### Launch, access and status
- **`grantCounts(docs, prj, today)`** returns `{ waiting, open, closed, blocking, ids, text }`.
  - Waiting means requested. Only waiting requests block the gate.
  - Open means approved or active. Open grants close at launch.
  - `projectTruth.grants` is the same object.
- **`grantView(grant, today, tzOffsetMinutes)`** returns `{ state, label, from, to, days, maxDays: 30, overMax, closedOn, text }`. Dates are local.
- **`projectTruth.launchFlag`**: a launch window on a weekend, holiday or workspace day off. It reads "Launch day Tue Dec 29, … is a day off: pick a business day". It is the first reason, and the label is never "On track".
- **`projectTruth.blocking`** = `{ count, holdsUp, unplanned, items: [{ dataId, name, planned, held, text }], text: "1 blocking (holds up 5 tasks)" }`.
  - **The one definition:** information the Future steps need that isn't available yet AND holds up at least one open task.
  - Use it in the header, the report and the risk register.
- **`projectTruth.lateness[workId]`** = `lateInfo(...)` = `{ late, days, text: "Late by 6 business days", dueText: "was due Nov 16" | "due Nov 23", due, forecast, pastDue }`.
  - `days` is business days from the due date to the expected finish. It is the ONE lateness number.
  - "was due" is used only for past dates.

### Earned value (`projectTruth.ev`, `evFlags`, `cost.method`)
- With spent > 0 and EV = 0, SPI and CPI are **0** (not null), and `flags` includes `{ key: 'spent-nothing-finished', text: 'Spent with nothing finished' }`.
- **One EAC method:**
  - `BAC / CPI` when CPI > 0 (`eacMethod: 'cpi'`);
  - otherwise `max(bottom-up, spent + remaining estimate)` (`eacMethod: 'bottom-up'`).
  - It is never below spent.
- `doneNoHours: [workId]` and the flag `{ key: 'done-no-hours', items, text }` cover work marked Done (including via Jira) with 0 hours.

### Plans and sprints
- **`suggestWorkFromDiff`:**
  - No task spans more than 10 business days. A later forecast moves the start; it never stretches the task. Longer effort is split into "(part k of n)".
  - Role-only steps go to the one person whose title equals the role. Otherwise `owner: null`, `ownerRole`, note "Needs an owner: Credit Analyst.". The task is never given to the PM.
  - The "tell" task has `teams: [...]`, taken from the changed steps' owners' teams, roles and known `touches`.
- **`planFit(...)`** adds:
  - `warning: null | { key: 'late-on-arrival', daysLate, text: "This needs until Mar 4, past your Jan 19 deadline (N business days late).", options: [{ key: 'accept', label: 'Accept anyway' }, { key: 'adjust', label: 'Adjust' }] }`;
  - `unassigned: [{ key, title, role, text }]`;
  - `longestTaskDays`, `maxTaskDays`.
- **`sprintCalendar(docs, prj, today)`** returns `[{ id, name, start, end, workingDays, daysOff: [{ date, name }], capacity: { total, people: [{ id, name, days }] }, text: "Nov 16 – Nov 27 · 9 working days (Thanksgiving Day off)" }]`. Capacity is `person.capacity × workingDays / 5`.

### Jira dependency flag and change counts
- **`doneBeforeDeps(docs, workId)`** returns `{ flag, open: [{ id, title }], text: "Finished before the work it depends on (… is still open)" }`.
  - Call it after an inbound Done. Log `text` in the sync log, and show it on the task.
  - G4 renders it on Connections. G3 renders it on the task.
- **`changeSummary`** counts steps only (steps, waits, messages, subprocesses), never choices. It adds `steps`. The seeded Vendor Onboarding is now "4 new · 6 changed · 1 removed" (10 steps).

### Server-side rules (`api/pmoflow/index.js`, all unit-tested in `api.test.js`)
- **PUT `testRun`:**
  - `by` must be the actor.
  - A **pass** is refused with 403 for a test assigned to someone else, or for a test held by an open problem.
- **PUT `approval` (team part):**
  - `approver` must be the actor, and the decision needs `stepUp: true`.
  - It is refused with 403 when `approvalBar` names a rule.
- **PUT `approval` with `kind: 'launch-override'`:** refused unless the actor is the signer and holds that `role`, with step-up.
- **POST `golive`:**
  - When `launchGuard(now = body.localNow)` isn't ok, it needs `launchOverrideStatus.ok`. That means two different people, both with step-up.
  - The Admin role is never an exemption.
