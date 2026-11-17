# Jordan (PMO Coordinator, 900-person benefits administrator, came from search): R10 re-review

## Verdict
- **Book a demo?** YES. Nothing else on the market turns Visio maps into a plan, sign-offs, UAT and a launch with an undo path.
- **Contract?** Not yet. The deal would be 8 editors on Business at $6,240/yr, compared against Planner at $0 extra.

## Scorecard (capability / ease)

| ID | Area | Grade | Flag |
|---|---|---|---|
| C1 | Process authoring | B/B | ONLY |
| C2 | As-is → to-be diff | A/A | ONLY |
| C3 | Data requirements | A/A | ONLY |
| C4 | Process → plan | A/A | ONLY |
| C5 | Scheduling / forecast | B/A | GAP |
| C6 | Views | C/B | GAP |
| C7 | Resource / capacity | C/B | GAP |
| C8 | Status / AI summaries | A/A | PARITY |
| C9 | Portfolio / dashboards | B/A | PARITY |
| C10 | Cross-project impact | A/A | ONLY |
| C11 | Testing / UAT | B/B | ONLY |
| C12 | Approvals / gates | B/A | ONLY |
| C13 | Launch / rollout | A/A | ONLY |
| C14 | Time-boxed access | A/A | ONLY |
| C15 | Collaboration | C/B | GAP |
| C16 | Financials | C/C | GAP |
| C17 | Mobile | B/B | GAP |
| C18 | Enterprise readiness | D/C | GAP |
| C19 | Time to first value | A/A | PARITY |
| C20 | Trust / buying path | **C/B** (was F) | GAP |
| C21 | Automation rules | N/O | GAP |
| C22 | Intake forms | N/O | GAP |
| C23 | Integration breadth | D/B | GAP |

## Trust-breaker: the two-person rule isn't enforced
- Maya (BA, Admin role) bulk-passed all 53 business-check tests with one note. That included tests assigned to Priya and Leo, and the test whose fix is still open.
- She then re-approved Procurement's part.
- The Admin security tab says the two-person rule is "ON NOW".
- **Fix:**
  - Whoever recorded the tests can't approve that part.
  - Bulk pass only covers the tests assigned to you.
  - A test can't pass while its problem is still open.

## Mismatches
1. Admin seats show "Team plan allows up to 25" while the plan reads Business.
2. After a bulk pass the screen shows "53 of 53 passed" next to "Fix 1 problem, then re-run" and "1 OPEN". The audit entry says "verified → verified".
3. Audit says "53 of 59 run, 0 failed" while the UI total is 53.
4. Recording only Business check also changed the Try-it-out phase to 53/53.
5. One grant shows "closed Nov 13" on Launch but "expired Nov 12 6 PM" in History (UTC vs local).
6. The risk register says the bank form is "not started" while the plan says "In progress".
7. The sandbox-limit message contradicts itself.
8. The pricing estimator shows "1 editor × $65" when the input is 0.
9. The demo has 7 paid Editors, including Dave, who only approves. It doesn't show the "approvers are free" pitch.

## Also
- **Dependencies:** a Jira "Done" on VOM-10 was accepted while its predecessors were still open, with no warning.
- **Pilot pricing:** $7,500 is more than a full year of Business for 8 editors. Reprice to about $2–3k, or offer 90 days free on one process.
- **Visio import is hard to find:** it isn't on "Paste a procedure", which is the page Home sends you to.
- **Imported Visio names:** the process is named after the file, not the page name.
- **Suggested plan:** it is lost if you leave without pressing Accept.
- **Proof for the VP:**
  - a SOC 2 or pen-test timeline;
  - a backup plan if the sole developer is unavailable;
  - references.
