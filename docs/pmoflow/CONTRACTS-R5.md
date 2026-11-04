# PMOFlow — Round 5 delta (round-4 reviews)

Theme: **trust**, through roles, real evidence and release orchestration. Plus versions and planning conflicts, test execution, PMO financials, and bug fixes.

## Roles and permissions (server-enforced where marked [S])
- **Process editors** = `process.owner` + `process.resources`. Everyone else gets read-only, with "Ask <owner> for edit access" (UI). [S] The API rejects process PUTs from non-editors with 403, except when the server itself does a go-live/rollback promotion.
- **Data element:** spec, sensitivity and confirm-live belong to the owner. A new element's owner defaults to **the creator** (`store.state.me`), not the step owner.
- **Project:**
  - `owner` = PM, and `releaseManager` (defaults to the owner).
  - Only the PM edits the plan and cutover. [S] The API rejects project PUTs that change `cutover`, `releaseManager` or `processes` from anyone but the owner.
  - **Only the release manager** can go live or roll back. [S] Go-live and rollback return 403 otherwise.
  - The release manager can't be counted as a BU approver (separation of duties).
- **"Start a project"** asks for **Project manager** and **Release manager** (people selects).

## Evidence that can't be faked
- **Confirm live** requires one of these:
  - (a) a latest **profile with zero blocking drift issues** (any issue except "column with no spec");
  - (b) a **connection check**: POST `/ws/:ws/check/:dataId` (simulated in-tenant probe) returns `{ok, at, detail}` and is stored as `dataElement.check`, and it must be ok;
  - (c) an evidence link plus a note, which the gate shows as weaker ("attested").
  - Stored as `liveEvidence: {type, ref, at, by}`.
  - Engine: `effectiveAvail` is `live` only with confirmation **and** evidence. The data-live check lists attested ones as a **warn**.
- **Test results:**
  - A UAT **script** pass requires evidence (text or link) unless the run's `source` is `'ci'`.
  - A bulk "Mark selected as passed" needs one evidence note applied to each.
  - Coverage requires **every spec field** of each element to have at least one case. Custom-only coverage doesn't count.
- **Sign-off sections:**
  - BUs of step owners plus BUs named in `touches`, **including the trigger's touches**.
  - A touched BU with **no person** in it fails `bu-signoff` with "No approver in <BU>: assign one".
  - Seed adds a person in HR (`hr`: "Grace Lin", "HR Business Partner", bu "HR") only if HR is used.
- **Staleness:** cutover edits (`project.cutoverUpdatedAt`) after an approval make **all** approvals stale.

## Release orchestration (API + UI)
- **Go-live body** `{actor, simulateFailure?: bool}`.
- **Server order:**
  1. Re-check the gate.
  2. Enforce go/no-go: every cutover task with `gonogo: true` must have an `owner` and `done: true` ("Go/no-go confirmed").
  3. Run the pipeline (simulated):
     - **On failure:** write `release {status: 'failed', kind: 'golive'}`, with no promotion, SOP publish or grant expiry, and notify only the release manager. Return 200 with `{release, failed: true}`.
     - **On success:** promote, publish, expire grants and notify.
- **Rollback** undoes the side effects: restores versions, re-publishes the previous SOP version, and records them.
- **Cutover check (engine):** at least one task; every go/no-go task has an owner.

## Versions and planning
- **Process drafts:** "Save version" stores a named snapshot in `process.drafts: [{id, name, at, by, asis, tobe}]` (max 10).
  - "Compare" any two of current / drafts / released, using `E().diffVersions(a, b)`, which has the same output shape as diffProcess.
  - "Undo last change" restores the previous snapshot kept in memory for the session.
- **BPMN import on a process page** offers "Import as a new version of this process": names are matched to keep data tags, sub-steps and owners. It reports **dropped elements** (unsupported types or unconnected nodes) before confirming.
- **Deleting a step that has work** warns, and offers to move the work to another step or delete it.
- **Planning engine:**
  - `E().scheduleConflicts(docs, projectId)` → `[{workId, dep, type, detail}]`, where a successor's planned start/finish violates its dependency.
  - `E().autoSchedule(docs, projectId, workIds?)` → proposed `{workId: {start, due}}` that resolves conflicts, keeps durations and uses business days.
  - The timeline shows conflict markers plus an "Auto-schedule" button with a preview.
  - Dependencies may point to **other projects' work items**, shown as "external".
- **Status colors:** an item whose forecast causes a downstream slip gets the badge "Causing slip" (red). Every RAG pill shows its reason ("1 late item"). A project with zero work is "Not planned" (grey), never Green.

## Testing
- **End-to-end scenarios:** `E().generateScenarios(docs, projectId)` gives one scenario per path through each linked to-be process (branches expanded, loops once). Each scenario's steps reference the process steps. They're saved in `project.uatScenarios` and recorded like scripts.
- **Environments:** `dev | sit | uat | prod-verify`. JUnit import asks for the environment.
  - `<skipped/>` → outcome `not-run`. It's counted and shown as "skipped", never dropped silently.
- **Tester execution:** in a cycle, only its assigned testers can record results. Per-tester progress = results they recorded.
- **Case ids** display as `TC<n>` (per element, stable sort by creation) everywhere.

## PMO
- **Project:** `program?: string` and `budget?: {planned}`. Work cost = `effortDays × person.dayRate` (default 800).
- **Portfolio:**
  - group by program;
  - financials (planned budget vs forecast cost vs actual cost of done work);
  - a project **burndown** (remaining effort over time, from `doneAt`; ideal line from start to target);
  - sprint burndown in the Sprints view.
- **Status report email draft:** recipients are project resources as `first.last@northwind.example` (fictional). The "not yet live" count = every element that isn't effectively live (missing + examples + pending).

## Bugs to fix (from reviews)
- Data element step counts disagree: as-is usage is counted in one place but not another. Count both, and label them.
- Generated "longest observed length (9)" case expects reject even though the spec allows 9. Expectation must follow the spec.
- "N of ? rows" → use the profile's row count.
- Duplicate humanized pattern keys: merge counts after humanizing.
- A stale "Switch 'Viewing as'" hint shows after sign-off.
- A runbook task owner is lost in the go-live dialog.
- Swimlanes clip at 1280: lanes container scrolls inside the canvas; minimum lane width 220.
- The trigger title is prefilled with the literal "What starts this process?". It should be a placeholder, not a value.
- The side panel repeats on every project view: in non-Map views, comments and history collapse into one "Activity" toggle.
- On mobile, the process map starts about 600 px down: collapse KPIs and controls into a summary row on screens 640 px wide or narrower.
- **SOP parser:** must handle the reviewers' exact phrasings: "If approved, … ; otherwise the manager approves …" (otherwise → No branch), "return to step 1" / "go back to step 1" (→ `goto` the step-1 node), and full-name owners ("Ana Ruiz"). Sub-steps are never truncated.
- Kickoff touches count in "Touches across operations".
