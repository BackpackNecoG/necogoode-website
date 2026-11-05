# Round 8 queue: blind buyer round 6 findings, plus anything the R7 reviews add
**Blind R6 grades:**

| Phase | Grade |
|---|---|
| Authoring | B- |
| Data | A- |
| Diff | B+ |
| Plan | B |
| Tracking | B- |
| Impact | B- |
| Rollout | A- |
| Test | B |
| PMO | B- |

## Bugs (must fix)
1. **Time zone:** use the user's local date everywhere. The lead fixed the client's "today" in `store.js` (`localToday`). Remaining:
   - pages that call `new Date().toISOString().slice(0,10)` directly;
   - the API's `releasedAt` display;
   - CSV filenames;
   - "due today" must not be "Late".
2. **One cost model:** actual cost = time logged × rate everywhere (portfolio CSV, header, EV AC). The header's forecast cost and EAC must reconcile, or show only one.
3. Empty step titles are rejected (inline error).
4. Step count KPIs reconcile with `diffSummary` after inserting nodes. A new process from an SOP shows no false "changed" count (to-be == as-is at creation).
5. **SOP parser:**
   - "Owner: X" lines become the step owner/role, not a step;
   - "otherwise skip to step N" becomes a `goto`, not a step;
   - "Wait for …" becomes a wait node.
6. **BPMN re-import:** match tasks by the PMOFlow id in `extensionElements` first, then by name, so renames keep their work.
7. **Rate-limit page:** one clear message, never blank.
8. **Naming consistency:** breadcrumbs, page titles and nav all use the same words (Home, Launch, …).
9. Remove the tooltip double period.
10. Defect due dates fall on business days.
11. Only the support owner, PM or launch owner can resolve hypercare incidents.
12. One buffer unit ("business days") everywhere.
13. Leveling explains any overload it couldn't resolve.
14. Suggest-work skips wait/message nodes (no Build items for Wait).

## Gaps toward A (blind)
- Portfolio-wide dependency graph (an Advanced view).
- Epics/story points/velocity (an Advanced view over the same data).
- Exportable traceability report.
- Incidents linked to defects/work.
- `.docx` SOP upload (read in the browser).

## From R7 stream reports
- **Today-map information** shows "Waiting for confirmation" because the engine requires proof. Design decision: on the **Today** map, information is descriptive. Show "We have this today" (neutral), and reserve Connected/Waiting for the Future map and the launch check.
- **Engine wording:** "Speed up <title>" → "Get <title> back on schedule"; Advanced health reasons still say "slipping"/"target".
- The data page should open its confirm flow from `?confirm=1` (home deep link).
- The seed description still says "To-be design".
