# PMOFlow — Round 6 delta (round-5 reviews)

## Grade context
**Blind buyer, R5:**
| Phase | Grade |
|---|---|
| Authoring | B- |
| Data | A- |
| Diff | B+ |
| Plan | B- |
| Tracking | B |
| Impact | B+ |
| Rollout | A- |
| Test | B+ |
| PMO | B- |

**Concept reviewer, R5:**
| Pillar | Grade |
|---|---|
| Data on map | A |
| Hero | A- |
| Drill | A- |
| Access | A- |
| Standalone | A- |
| Gate | B+ |
| Views | B+ |
| AI | B+ |
| Testing | B |
| Learning | B |
| Status | B |
| CX | B |

**Exit target:** every grade ≥ A-, with at most 2 at B+.

## 1. Gate trust and the approver experience (concept #1)
- **Audit ordering is strictly chronological and truthful.** Event timestamps must reflect the real order: approval → pipeline started → pipeline succeeded → promotion → SOP publish → grants expired → notifications.
  - The API stamps each with an increasing timestamp (+1 ms per step).
  - A failed go-live writes exactly **one** failure event.
- **One staleness truth.** The `exceptions` check and `bu-signoff` must agree.
  - Cutover edits after sign-off appear in `exceptions` too ("Cutover plan changed after IT sign-off").
  - The `exceptions` check is computed from the same staleness function that drives re-approval.
- **BU approver view** at `/release/:prj?bu=<BU>`, plus a "Review my section" button for the persona's BU. One screen showing only that BU's:
  - steps, with diff and status;
  - data elements and their evidence (probe, profile, attested);
  - test results for those steps and data;
  - open defects;
  - changes since their last sign-off.
  - Approve/Reject requires an **attestation note** (required, stored on the approval) plus step-up. The main Release page links each BU card to it.
- **Release page density:** the checklist collapses to one line per check, plus "Show detail". Plain-language labels throughout (no SIT, go/no-go or CP jargon without a tooltip).
- **Rollback runs a pipeline** (simulated, with the same success/failure handling). Audit order: rollback approved → pipeline → restore → re-publish.
- **Runbook:** each task has `{owner, plannedStart, durationMins, done, gonogo}`. All tasks with `gonogo` must be done; the gate shows an overdue runbook task as a warning.
- **Hypercare:** after go-live, a "Hypercare" card (days remaining, owner) where incidents can be logged (`project.incidents [{id, title, severity, at, by, status}]`). An open sev-1 incident shows "Consider rollback".
- **The grant time box starts at approval.** A requested grant shows "30 days from approval", not a countdown.

## 2. Status meaning that doesn't overstate risk (concept #2)
- **Project RAG** (engine `projectHealth(docs, prj, today) -> {rag, reasons[]}`):
  - **Red** only if the forecast finish is after the target, or a blocking gate issue has no plan (unplanned missing data).
  - **Amber** if any item is late but the finish still meets the target, or buffer is under 5 business days.
  - **Green** otherwise.
  - Every surface uses it: project header, home, portfolio and status report.
- **Step status combines work and data.** A step whose work is done but whose data isn't effectively live shows "Built · awaiting live data" (amber), never green Done. The drill-down shows late as red, consistent with the map.
- **"Causing slip" and "On track" can't co-exist.** One schedule badge per item, by priority: late > causing slip > slipping > due soon > on track.

## 3. Process → plan (blind #3, plan B-)
- **suggestWorkFromDiff:**
  - Adds **flow-order dependencies**: work on step N depends on the nearest preceding step's work in map order (finish-to-start), plus the data resolver deps.
  - Dates are spread from today toward the project **target**: effort-based business days with buffer, never all on the same day, never on weekends.
  - "Can start now" items start today.
- **Default new-project target** = the next business day ≥ today + 60 calendar days.
- **criticalPath** includes the full predecessor chain (not just the last item).

## 4. Tracking (blind #5, B → A-)
- **Timeline:**
  - Bars resize (drag the right edge to change due; owner/PM only).
  - Keyboard: with a bar focused, ←/→ moves it 1 day and Shift+←/→ resizes.
  - **Auto-schedule keeps durations exactly** and never moves items that have no conflict. A successor starts the business day **after** its predecessor finishes (finish-to-start).
- **Custom statuses:** `project.statuses` (ordered list; defaults Not started / In progress / In review / Done; each maps to `idle|prog|done` for the engine). The board columns follow them.
- **Custom fields:** `project.fields [{key, label, type: text|number|select, options}]`, editable on work items, filterable, and shown as optional board card tags.
- **Capacity leveling:** `E().levelResources(docs, prj, today)` proposes shifts so no person exceeds capacity per week. Shown as a preview → apply.
- **What-if scenarios:** "Scenario" mode clones the current dates into `project.scenarios [{id, name, dates}]`. You can drag freely in a scenario, then compare finish and cost against the plan, and apply or discard. Nothing in the live plan changes until you apply.

## 5. Authoring (blind #1, B- → A-) within the vertical-map vision
- **New node types:**
  - **subprocess** (calls another process; drill opens it; shows its step count);
  - **wait/timer** (e.g. "Wait 2 business days for vendor response");
  - **message** (send/receive to an external party, e.g. "Notify vendor").
  - BPMN mapping: callActivity, intermediateCatchEvent with timerEventDefinition, and intermediateThrow/CatchEvent with messageEventDefinition.
- **BPMN round-trip keeps PMOFlow data in `extensionElements`** (namespace `pmoflow`): data ids/names, sla, system, touches, sub-steps. Import reads them back. Round trips are lossless (e2e asserts it).
- **Pools:** an optional "External parties" pool. Message nodes connect to it in the BPMN export (messageFlow).
- **SOP import:**
  - Never leaves "()" in a title.
  - Only proposes data that is a noun phrase of a document, record or field (not "Receiving clerk records").
  - Every proposed element it says it created shows up in the process's data requirements.
- **Version label updates** after import as a new version (header and KPIs agree with `diffSummary`).
- **Swimlanes:** no clipping at 1280. The lanes container scrolls (`overflow-x: auto`), with a minimum lane width of 220.

## 6. Cross-process impact (blind #6)
**Step-level impact view** on the step page: every other process and project step that shares data with this step, every project with open work on it, and the conflict status. Plus an "Impact" tab on the process page that rolls this up.

## 7. Testing (blind B+ → A-; concept B)
- **Generation is one-shot and complete.** One press generates everything (no batching), and the count updates immediately.
  - Values are tailored per field type: addresses look like addresses, ids like ids, no emoji in non-name fields.
  - No junk like "1-2-3456789" for an EIN: special-character cases only for free-text fields.
- **Drift wording** compares like with like: "has 9 digits; the spec requires 10 characters" → use the spec's unit. Also flag duplicates in fields marked unique (`field.unique`).
- **Traceability headline:** "UAT 28/28" must sit next to field coverage ("18 spec fields without a case"). The gate already requires every field to be covered; the testing header shows both.
- **JUnit import:** a preview/mapping step lists each testcase → matched case/script (or "unmatched"), with a dropdown to map it manually before importing.
- **Defects:** fields `severity (1–4)`, `priority`, `env`, `repro`, plus a lifecycle **new → triaged → in progress → fixed → verified (by passing retest) → closed**. A passing retest moves the defect to "verified" automatically and offers close.
- **Testers:** the default assignee for generated scripts/cases is the step owner, or the data owner.
- **Record run:** "Mark selected as passed" with nothing selected shows an inline hint immediately.

## 8. PMO (blind B- → A-)
- **Time logging:** `workItem.time [{by, date, hours, note}]`. Actual cost = Σ hours × dayRate/8.
- **Earned value** (`E().earnedValue(docs, prj, today)`): PV, EV, AC, SPI, CPI and EAC, using budget and effort. Shown on the portfolio and project.
- **Configurable dashboard** `/dashboard`: the user picks widgets (RAG, burndown, EV, workload, risks, top blockers, upcoming go-lives) and the layout is saved in `localStorage` (try/catch). Program roll-ups group by `project.program`.
- **Exports:** CSV of work items and of the portfolio; the status report prints to PDF (print stylesheet).
- **Right rail depends on the view:**
  - Map: blockers, up next, legend.
  - Timeline: conflicts, critical path.
  - Board / Sprints: sprint stats; burndown only on Sprints (one burndown).
  - Work: filters summary.
  - "Activity" (comments and history) collapses into one toggle on every view.

## 9. Small fixes
- Step modal "Create and tag": inline **owner** (default me) and **source** fields.
- Confirm-live source edits update the probe target and header.
- Duplicate failed-go-live audit entries (covered in §1).
