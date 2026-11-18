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
