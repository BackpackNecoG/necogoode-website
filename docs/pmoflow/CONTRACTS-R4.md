# PMOFlow — Round 4 delta (from the final R3 reviews)

Principle from the founder: **boards, sprints and saved filters are views of the same data** (status, due, owner, effort). They're not a separate system. A due date is a due date.

## Gate evidence independence (engine + UI)
- **Data element confirmation.** A data element gains `liveConfirmedBy?: personId`, `liveConfirmedAt?` and `liveSource?`.
  - `effectiveAvail` returns `'live'` only if `avail === 'live'` (seeded live elements count as confirmed) **or** the data owner has confirmed (`liveConfirmedBy === owner` and `liveSource` is set).
  - A finished resolver alone gives the new state **`'pending'`** ("Fix done, awaiting owner confirmation"), which renders amber.
  - The `data-live` check fails on `pending`, with the item "awaiting <owner> to confirm".
  - Go-live (API) no longer flips data to live by itself.
- **BU sign-off sections** = the BUs of to-be step owners **plus** any BU whose name, case-insensitive, appears in a step's `touches` tags.
- **The project owner is excluded:** their approvals don't count toward `bu-signoff` or `two-person`, and the UI says so.
- **`readiness().signoffOpen`** = every non-signoff check passes (except warnings). The UI locks sign-off buttons until it's true ("Sign-off opens when the other checks pass"). Existing approvals are kept.
- **`exceptions`** include process edits (process `updatedAt` after the BU approval, for steps in that BU's section), with names.

## Work generation and forecasting (engine)
- **Dependencies** can be strings or objects `{id, type: 'FS'|'SS'|'FF', lag: days}`. A string means FS with lag 0.
  - FS: start after the dep finishes plus lag.
  - SS: start after the dep starts plus lag.
  - FF: finish after the dep finishes plus lag.
- **Implicit data blocker:** an open item on a step whose data is effectively `missing`/`pending` can't finish before that data's resolver forecast plus its own duration. `cause` = the data id.
- **Duration** = `effortDays` if set, else business days between start and due.
  - **Bug fix:** an idle item with a past start date forecasts `max(due, today + duration)`. Moving the due date later must not keep an old slip.
- **Business days:** generated dates and forecasts skip Saturday and Sunday (`addBusinessDays`).
- **`explainForecast(docs, workId, today) -> [{text}]`:** a human chain, e.g. "Waits for ERP vendor write integration (forecast Nov 23) → +3 business days effort → Nov 26".
- **`suggestWorkFromDiff`:**
  - Covers new/changed steps **and gateways**, plus resolvers for every non-live element used by any to-be step in the project's processes.
  - Dependencies come from data: each step item depends on the resolvers of that step's non-live data. Steps don't chain on each other just because of map order.
  - Business-day dates start today (or at a resolver's finish), with owners and `effortDays`.
  - Suggestion `deps` use suggestion keys or existing ids, as R3 had it.
- **`sprints(project, today) -> [{id, name, start, end}]`:** uses `project.sprints` if present, else auto-builds two-week sprints from the earliest work start to the finish. **`sprintOf(project, item)`** = the explicit `item.sprintId` or the sprint containing the due date.
- **Test generation:** profile-derived cases have `origin: 'profile'` and synthetic inputs that reproduce **observed** shapes (an 8-digit routing number, apostrophe/accent names, blanks, the maximum observed length). Never raw values.
- **`generateUatScripts`:** multi-step scripts, `steps: [{action, expected}]`, one per sub-step (falling back to the step title). Expected results use names, never ids.
- **Test coverage:** each case or script's outcome in an env = its latest result across **all** runs in that env, so partial CI imports carry earlier passes forward. Runs are filtered by `projectId`.

## API
- Report wording:
  - "late by N day(s)" uses days past due; the slip is reported separately.
  - Plurals are correct.
- SOP parser:
  - "otherwise …" / "else …" go to the **No** branch.
  - "resubmit"/"return to step N" → `goto` the referenced step.
  - Sub-steps are never truncated.
  - Owner match is by role alias or BU, never a default person; if there's no match, leave it blank.
- Seed:
  - `liveConfirmedBy`/`liveSource` on live elements.
  - BU names in some `touches` tags.
  - Access-review must still be able to pass the gate end to end under the R4 rules, with the owner confirmations already there.

## UI additions
- **Project views:** Map | Timeline | **Board** | **Sprints** | Work.
  - **Board:** columns Not started / In progress / Done. Cards show owner, due/forecast, data blockers and a risk badge. Drag a card to another column to change status (with permissions, `doneAt` and `updatedAt` handled). There's a keyboard alternative.
  - **Sprints:** one column per sprint, with effort against the sprint capacity of the people assigned. Dragging an item into a sprint sets `sprintId` and moves its due date to within that sprint (keeping its duration).
- **Shared filter bar** on Board, Sprints, Timeline and Work: owner, status, process/step, data, late/slipping, search.
  - Named saved views go in `project.views`.
- **Work item modal:** dependency type and lag.
- **"Why this date?"** popover from `explainForecast`.
- **Other project-page items:**
  - Red/amber/green pill in the header.
  - A "Report" button that generates the status report there, with Print/PDF (print stylesheet) and an Email draft (mailto).
  - A cross-project conflict banner when another active project changes the same step or data element.
- **Process index** page `/processes`, which the nav "Process" opens. A plain-language spec builder for SMEs (Format: digits / letters / text / date / money / email / phone / list, plus length and required). The regex lives under "Advanced".
- **Data page "Confirm live":** data owner only; requires a source and shows the latest profile if any.
- **Loop-backs** drawn as a curved return arrow on the map.
- **Testing:**
  - Tester assignment on scripts and cases.
  - Planned test cycles (name, env, dates, testers).
  - A passing retest offers to close linked defects.
  - JUnit matches by id **or** title, and case and script ids are visible.
  - Custom cases on elements without a spec.
  - The test history is per project.
- **Cutover runbook:** sequenced tasks (step, owner, planned time, go/no-go check), plus rollback fields.
- **Pipeline status:** simulated `queued → running → succeeded`, with a "Simulate failure" option that marks the release failed and offers rollback.
- Dialogs never lose input on a validation error.
- History panels refresh immediately after any action.
