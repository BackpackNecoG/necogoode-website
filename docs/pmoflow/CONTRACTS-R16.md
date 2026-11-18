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
