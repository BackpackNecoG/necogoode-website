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
