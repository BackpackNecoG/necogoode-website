# PMOFlow R10 re-review: consolidated against the fixed acceptance bar

**Build:** 5510548. **Reviewers:** the same four personas as `../CONSOLIDATED.md`. Detail is in `karen.md`, `jordan.md`, `expert-pmo.md` and `expert-bpm.md`.

## 1. Fixed bar (set before R10): result

| Criterion | Result |
|---|---|
| All §4 bugs gone, and no contradictions between screens | **FAIL.** The earlier bugs are fixed, but every reviewer found new contradictions outside the consistency suite's coverage (testing counts, coverage, launch steps left, owners, seats) |
| C20 Trust/buying path ≥ B for all four | **FAIL.** Karen D, Jordan C, BPM expert C+, PMO expert B (all were F) |
| C18 Enterprise readiness ≥ C+ | **FAIL.** D, D, D+, C. Blockers: no SOC 2, pen test, SCIM or vendor-continuity answer |
| Both search buyers book a demo | **PASS.** Karen: yes, cautiously. Jordan: yes. Before: no, no |
| Both experts confirm a pilot path | **PASS.** Both would run a paid pilot |
| No consensus Ease grade drops | **PARTIAL.** C5 drops for Karen (an 8-month suggested task); C17 drops for the PMO expert (D/D: responsive only, no app) |

## 2. Demo and deal

| Reviewer | Book a demo? | Deal |
|---|---|---|
| Karen | **Yes** (was No) | $7.5k pilot within her own authority, then Team for 3–5 editors (≈ $1.6–2.7k/yr) |
| Jordan | **Yes** (was Not yet) | Not yet a contract: 8 editors on Business ($6.2k/yr), with the VP comparing it to Planner. Wants the pilot at $2–3k |
| PMO expert | **Yes** | Paid pilot, yes. Contract not yet; 8–12 editors ≈ $6.2–9.4k/yr. "Companion to Jira/ADO" wins in the enterprise |
| BPM expert | **Yes** | Paid pilot, yes. 8–12 editors ≈ $6–9k/yr, below Signavio's floor |

**Net: 4 of 4 would book a demo (was 2 of 4). 3 of 4 would run a paid pilot. 0 of 4 would sign a full contract yet.**

## 3. Consensus scorecard: PMOFlow capability / ease (R9 market review → R10)

| # | Category | Before | **R10** | Flag |
|---|---|---|---|---|
| C1 | Process authoring | B / A- | **B / B+** | PARITY (BPM tools stronger on RACI and boundary events) |
| C2 | As-is → to-be diff | A / A | **A- / A** | ONLY |
| C3 | Data requirements | A- / B | **A- / B+** | ONLY |
| C4 | Process → plan | B- / A | **B+ / A** (Karen C: absurd plan on her import) | ONLY |
| C5 | Scheduling / forecast | C+ / A- | **B / B** | PARITY to GAP |
| C6 | Views | B- / B+ | **B- / B** | GAP |
| C7 | Resource / capacity | C / B | **C / B** | GAP |
| C8 | Status / AI summary | A- / A | **A- / A** | LEAD |
| C9 | Portfolio / dashboards | B- / B+ | **B / A-** | PARITY |
| C10 | Cross-project impact | A- / A | **B+ / A** | ONLY |
| C11 | Testing / UAT | B / B | **B / B-** (counts disagree) | ONLY vs PPM; PARITY vs Xray |
| C12 | Approvals / gates | A / A | **A- / A** (separation-of-duties gaps) | ONLY |
| C13 | Launch / rollout | A- / B+ | **A- / A-** | ONLY |
| C14 | Time-boxed access | B+ / B+ | **A- / A-** | ONLY |
| C15 | Collaboration | C+ / B | **C+ / B** | GAP |
| C16 | Financials | C+ / B | **C+ / B** (EV edge cases) | PARITY |
| C17 | Mobile | B / B+ | **C+ / B** (no native app) | GAP |
| C18 | Enterprise readiness | **F** | **D+** | GAP: blocks contract |
| C19 | Time to first value | A- / A | **A- / A** | LEAD |
| C20 | Trust / buying path | **F** | **C+ / B** | GAP: improving |
| new | Intake forms | N/O | N/O | GAP (3 of 4 reviewers) |
| new | Automation rules | N/O | N/O | GAP (3 of 4) |
| new | RACI matrix, process portal, review cycles | partial | not found by the BPM expert | GAP |
| new | Recurring checklist runs ("we onboard vendors weekly") | N/O | N/O | GAP (Karen) |

## 4. Trust-breakers to fix (R11, ranked by how many reviewers hit them)

1. **Testing counts disagree (4 of 4).**
   - Simple vs Advanced vs gate vs Launch vs approver page vs report.
   - Coverage "7/7" vs matrix "5 uncovered".
   - "53 of 53 passed" while 1 problem is still open.
   - Recording one phase changed both phases.
   - Approver page says "9 of 9 passed passed together" while some information has 0 cases.
   - **Needs one `testingTruth`** that includes data-element coverage, and every screen and the e2e must read from it.
2. **Separation of duties not enforced (3 of 4).**
   - An Admin bulk-passed other people's tests and a test with an open problem.
   - A step owner can approve their own department's part.
   - The launch owner can override the window and open launch-day steps alone.
   - Admin says "two-person rule ON NOW".
3. **Paste import fidelity (3 of 4).**
   - Silently dropped a numbered line.
   - "Otherwise" becomes a step instead of an else-branch.
   - The reject branch continues instead of ending.
   - Misses roles at the start of a sentence and "Role (Name)" mid-line.
   - Leading articles are kept.
   - Systems dictionary is too small.
   - SLA is not modelled as a timer.
   - Information owner flips to the importer on save.
   - "Things to check" counts go stale.
   - Processes list shows "0 steps" until Future is opened.
4. **Suggested-plan sanity (Karen).** An 8-month task; a plan that is late on arrival can be accepted without warning; role-only steps get the PM instead of a person; the "Tell" task names the wrong team.
5. **Other screen mismatches (3 of 4).**
   - Launch "N steps left" vs the PASS/FAIL list.
   - "Ready to launch" while the button is locked.
   - "0 blocking" vs the report's "holds up 2".
   - Two different lateness numbers for the same task.
   - "was due" on a future date.
   - UTC vs local dates on access grants.
   - A grant at 33 days against "30 at most".
   - "Not checked yet" vs "Not available yet".
   - Decision node counted in changes but not steps.
   - Jira change counts.
   - Seats: "Team plan" shown under Business.
6. **Holidays in sprints and launch day (PMO expert).** Sprint capacity isn't pro-rated. A launch on a day off isn't flagged on the Launch page or the Dashboard.
7. **Earned value hygiene (PMO expert).**
   - Show 0.00 when actual cost is above 0.
   - Use one expected-cost method.
   - Warn when work is Done with 0 hours logged.
8. **Audit chain claim is false (PMO expert).** It is unkeyed, so a full re-hash forgery or a deleted tail passes. Add a keyed or signed head and check the anchors, or soften the claim.
9. **Demo sandbox limit (4 of 4).**
   - The per-network limit of 5 a day locks out a shared office NAT.
   - A fresh browser creates a new sandbox each time.
   - The error message contradicts itself.
10. **Demo seats.** Dave, the approver, is seeded as a paid Editor, which undercuts "approvers are free".

## 5. Buying path asks

- A plain "what Team needs from IT" (no Azure install for Team?).
- A dated SOC 2 Type I and pen-test plan.
- A vendor-continuity answer (second engineer / source escrow).
- Reference customers.
- **Pilot price.** All three pilot-minded reviewers would buy one, but $7.5k is more than a year of seats for 8 editors. Jordan suggests $2–3k. Founder decision.

## 6. Positioning check (founder ruling: "bring your tools or start fresh")

The reviewers confirm both paths:
- **Enterprise PMO:** "companion to Jira/ADO" wins.
- **Mid-market ops without Jira (Karen):** standalone wins.

The current copy serves both. Keep it.

**Market note (reviewer research; Unverified by the lead):** Microsoft ended Planner Plan 5 sales on May 1, 2026 and retired Project Online on Sep 30, 2026. That is an opening for a Microsoft-tenant-native tool.
