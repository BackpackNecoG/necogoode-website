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
