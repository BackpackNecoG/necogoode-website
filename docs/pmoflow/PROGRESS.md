# PMOFlow — Iteration Progress Log (resume point)

**How to resume:**
- Read this file, then `AGENT-ONBOARDING.md`, then the latest `CONTRACTS-R<n>.md`.
- The loop is: **build round → regression (all suites) → deploy → two independent reviews (concept-aware + blind buyer vs Jira) → write the next delta → repeat.**
- **Exit when:** every blind-buyer phase is ≥ A- with at most 2 at B+, **and** every concept pillar is ≥ A- with at most 2 at B+.
- Don't stop between rounds unless a decision genuinely needs the founder.

**Founder rulings that shape the loop:**
- Boards, sprints, timeline and map are all views of the same work data. Add views freely; never fork the data.
- Hosted display layer; the customer's data and keys stay in their tenant.
- Report progress to the founder as agents complete and as cycles start, stop or enter review.

## Cycle log
| Round | Built | Tests at end | Deployed | Reviews |
|---|---|---|---|---|
| 1 | API, engine, design/PMO/release UI | 26 unit, 234 e2e | yes | Blind: C+…B+; 11 bugs |
| 2 | Actuals, stale approvals, cutover/rollback, UAT scripts, defects, BPMN export, versions, permissions | 39 unit, 352 e2e | 16171aa | Blind: data A-, rollout B+, test C+, tracking C+. Concept: drill-down A-, project view A-, standalone C, CX C+ |
| 3 | Data single source of truth, new project, released-state gate, BPMN import/lanes, Gantt drag/deps/critical path, step UAT, coverage matrix, retest, JUnit, separation of duties | 54 unit, 511 e2e | d4d3d65 | Blind: authoring B-, data A-, plan C+, tracking C, rollout B+, test C+, PMO B-. Concept: map A, drill A, most A-; testing C+; gate-evidence trust weak |
| 4 | Board/sprint/filter views, owner-confirmed data, independent sign-off, dependency types, explainable forecasts, runbook, pipeline status, test cycles, process index, spec builder | (see git f436e6c) | yes | Reviews fed into R5 (see `CONTRACTS-R5.md` "Bugs to fix") |
| 5 | Roles (server-enforced), evidence that can't be faked, release orchestration (go/no-go, failure path), drafts and compare, schedule conflicts and auto-schedule, end-to-end scenarios, environments, tester execution, financials, burndown, bug list | 841 e2e (421 design, 293 PMO, 127 release) plus unit/API | dd48103 (16:31) | **Interrupted 18:00 before results arrived. Re-run required.** |
| 5-review | Concept-aware plus blind buyer re-run on dd48103 | | | in progress |
