# PMOFlow v3 — Round 3 delta (two independent reviews)

## Principle: the data element is the single source of truth
- **Effective state** comes from `E().effectiveAvail(docs, dataId)`:
  - `'live'` if `avail === 'live'`, or its resolver work item is done;
  - otherwise `'example'` or `'missing'`.
- **Every view uses this:** map cards, step drill-down, project map, blockers panel, gate, status report and home.
- **On the map/project (red):** "Waiting on <data>" appears only for steps with open work whose data is effectively **missing**.
- **Examples-only data:** amber "Needs a live source before go-live". It isn't a red blocker on the map, but it fails the gate's `data-live` check.
- **"No resolution plan"** shows only for missing or example elements with no resolver. Suggest-work proposes resolvers for both.
- **Go-live (API):** sets `avail: 'live'` on every data element whose resolver is done, writing a summary event.
- **After release:** when `project.status === 'live'`, `readiness()` returns `{released: true, releasedAt, pass: true, checks: <as evaluated at release>}`. The UI shows a "Released vN on <date>" summary, not a failing checklist. Promotion updates must never make approvals stale. Staleness only counts changes made **before** go-live, and only on a project that isn't live.

## Engine (`E`) additions
- `effectiveAvail(docs, dataId)`.
- `diffSummary(process) -> {new, changed, removed, same}`. Gateways count as nodes in new/changed. **Every count shown anywhere uses this.**
- `criticalPath(docs, projectId, today) -> [workId]`: the longest forecast chain to the project finish.
- **readiness:**
  - Each check is `{status: 'pass'|'fail'|'warn'}` as well as `pass`.
  - Summary counts `{pass, fail, warn}`. Warnings are never counted as passing.
  - `two-person` counts **approved, non-stale** approvals only. It must match what the sign-off panel shows.
  - Detail strings are plain English with names, never raw keys or ids. Example: "Rollback owner, rollback plan and hypercare owner are not set."
- **tests-passed:**
  - Use the latest run **per env**.
  - "Failing" counts only that latest run's results.
  - Any project data element with zero test cases fails coverage.
- **generateTests:**
  - Cover **every** spec field.
  - Add special-character cases (apostrophe, accent, ampersand, emoji, leading/trailing spaces) for text fields.
  - Add cross-field rules when a rule mentions another field (e.g. "Must match legal name").
  - Routing-number fields (name includes "routing") produce **ABA-checksum-valid** valid cases and a checksum-invalid case.
- **specDrift messages:** plain English, e.g. "1 of 40 routing numbers has 8 digits; the spec says 9." Never `undefined` (use the profile's row count).
- **Pattern humanization:** `humanPattern('9{8}') -> '8 digits'`, `'Aa{5} Aa{6}' -> 'two capitalized words'`. The UI uses it.
- **suggestWorkFromDiff:**
  - Order by map order.
  - Each suggestion gets `owner` (the step owner, or the data owner for resolvers), `effortDays` (default 2), `start`/`due` chained after the previous suggestion and after the resolver it needs, and `deps`.

## API
- Go-live sets data elements live (above), stores the evaluated `checks` on the release, and doesn't stamp approvals stale.
- **Status report** (rules and AI facts):
  - Red/amber/green uses the portfolio rule: red if any late item or forecast after target; amber if slipping or under 7 days of buffer; green otherwise.
  - The headline must agree with it.
  - Risks whose linked work items are all done are reported as "likely mitigated, confirm and close".
- **Event summaries** use names, never ids (grant events name the data element; test runs say "UAT run, Nov 4").
- **SOP rules parser:**
  - `otherwise` / `else` / `if not` → the **No** branch.
  - "at the same time", "in parallel", "simultaneously" → a `parallel` gateway.
  - A step with an inline condition ("Manager approves. If over $5,000, Finance Director also approves.") keeps the main step, followed by a decision whose **Yes** branch holds the conditional action (Finance Director approves).
  - Role aliases: "AP clerk" → Accounts Payable BU, "treasury analyst" → Treasury, etc.
  - Known systems ("ERP", "Concur", "NetSuite", "Workday", "SharePoint", "Teams", "Outlook", "DocuSign", "Salesforce") → `step.system`.
  - The trigger is the SOP's stated start event, or "Process starts". Never a truncated copy of step 1.

## UI (cross-stream)
- **Separation of duties:** a grant's requester can't approve it. If the data owner is the requester, the project owner approves.
- Only the project owner can create work from suggestions.
- **"Resolves" select:** only data used by this project's processes.
- Deleting in edit mode requires confirmation. Read-only views (released versions) show no edit controls.
- Icon-only controls have `aria-label`s.
