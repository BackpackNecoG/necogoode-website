# PMOFlow v3 — Round 2 contract delta (additive to CONTRACTS.md)

This round is driven by an independent grader. These rules apply on top of the original contract; where they conflict, these win.

## Data model additions
- **workItem**
  - `doneAt?: YYYY-MM-DD` is the actual finish date. Set it when status becomes `done`, clear it otherwise.
  - `effortDays?: number` (default 1).
  - `updatedAt?: ISO`, set on every save.
  - `kind` may now be `'defect'`. Defect items have `testRef?: {runId, caseId|scriptId}`.
- **person:** `capacity?: number`, in days per week (default 4).
- **process:** `updatedAt?: ISO`, set on every save.
- **Process nodes:**
  - **Node type `parallel`** (all branches run). It has `branches` like `decision`.
  - **A decision branch may carry `goto?: nodeId`**, meaning "loop back to that node" (rendered as a return arrow label). Any node that has `branches` is a gateway; the engine treats `decision` and `parallel` the same for traversal.
  - **Step nodes may carry** `sla?: string` (e.g. "2 business days"), `system?: string` and `durationHrs?: number`.
- **dataElement**
  - `discovered[]` items gain `resolved?: {by, at, note}`.
  - `sensitivity?: 'public'|'internal'|'confidential'|'pii'`.
- **risk:** `workItems?: [workId]`.
- **project**
  - `cutover?: {window, rollbackOwner, rollbackPlan, hypercareDays, hypercareOwner, comms}`.
  - `uatScripts?: [{id, pid, step, title, given, when, then, data:[dataId]}]`, which can be edited.
- **testRun.results[]** may hold `{scriptId, outcome, note, evidence?: url-or-text, defectId?}` in addition to case results.
- **release:** gains `kind: 'golive'|'rollback'`, plus `exceptions: [{ref, summary, by, at}]`, populated by the server.
- **approval:** add `snapshotAt: ISO` (the time of approval). An approval is **stale** if any work item or process in that BU's section has `updatedAt > approval.at`.

## Engine additions and changes (canonical file `api/shared/pmoflow-engine.js`, copied byte-identically to the web copy)
- **forecastAll:** done items use `doneAt || due`.
- **projectStats.finish:** if all work is done, `max(doneAt)`; otherwise the max forecast of open items. Add `actualFinish` when all work is done.
- **baselineVariance:** variance = (`doneAt` or forecast) − baseline due. Also return `projectSlipDays` = project finish − max baseline due. That is the headline number, never a sum.
- **readiness:**
  - **`bu-signoff`:** fails when a BU's latest approval is stale. Detail: "re-approval needed: <items changed>".
  - **`exceptions`:** still lists the changes, but stale ones now block through `bu-signoff`.
  - **New `discovered-resolved`:** blocking; every discovered requirement on project data must be resolved.
  - **New `process-valid`:** blocking.
    - Every to-be step has an owner.
    - No gateway has all branches empty.
    - Every `goto` target exists.
  - **New `cutover-plan`:** blocking; `project.cutover` has `rollbackOwner`, `rollbackPlan` and `hypercareOwner`.
  - **`tests-passed`:**
    - The latest dev run has zero fails.
    - The latest UAT run covers every data case and every UAT script, with zero fails and zero blocked.
    - No open defect work items.
- **diffProcess:**
  - New gateways are `new`.
  - Changes to sub-steps, sla or system count as `changed`, with readable change text.
- **specDrift:** match fields to columns by normalized tokens (lower case, strip punctuation and parenthetical text, `tax id (ein)` ↔ `tax_id`, `routing number` ↔ `routing_number`) or by `field.column`.
- **generateUatScripts(docs, projectId) -> [{id, pid, step, title, given, when, then, data}]:** one script per new/changed to-be step plus one per gateway branch. Ids are deterministic, e.g. `uat-<pid>-<step>[-<branch>]`.
- **workload(docs, today) -> per person:** `{person, open, late, dueNext7, effortNext14, capacityNext14, overloaded: effortNext14 > capacityNext14}`. Capacity defaults to 4 days per week.
- **impactOfData:** unchanged; name matching isn't the engine's job.

## API additions (stream A)
- **POST `/ws/:ws/rollback/:projectId`:** body `{actor}`. Allowed only when the project is `live`.
  - Restores each process's as-is to the previous released version and decrements the version.
  - Writes `release {kind: 'rollback'}`, sets the project status to `active`, and appends events.
- **Go-live:**
  - Fills `release.exceptions` from the engine's exceptions items.
  - Records `kind: 'golive'`.
  - Stores the pre-release as-is in `released`, which already happens. **v1 must remain viewable.**
- **AI status report (rules and AI):** never output internal ids. Map them to names and titles.
- **SOP import, rules parser:**
  - Skip title, purpose, scope, owner and revision lines.
  - Nest lettered or indented sub-items (`a.`, `i.`, `-` under a numbered step) as `subs` of the previous step.
  - Detect conditions (`if`, `when … exceeds`, `over $`, `greater than`, `approval required`) → emit `{type: 'decision', title, branches: [{label: 'Yes', nodes: [...]}, {label: 'No', nodes: []}]}`, wrapping the conditional step.
  - Link data only on a strong match: the full element name, or a word-boundary match with ≥2 shared significant tokens **and** the same domain. Otherwise propose `newData: [{name, reason}]`.
  - Owners link only on a full name or BU match.
- **Put doc:** the server stamps `updatedAt` on workItem and process docs if the client didn't.
