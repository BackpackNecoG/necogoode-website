# R15 re-review: Enterprise PMO director (port 8997)

## Verdict
- **Demo:** yes. His two R14 blockers, sponsor governance and dependency-correct re-planning, "now work end to end".
- **Paid pilot:** yes, $2,500.
- **Year 1:** Business, 30 editors = **$23,400**, next to Jira.
- **Contract:** not yet.
- **Blockers:**
  - Owners can delete logged hours.
  - The actor and step-up are asserted by the client.
  - Previewing a report counts as sending it.
  - SCIM and SOC 2.
- **What would tip it:** a hosted Entra tenant that rejects a forged actor or a stale step-up; append-only time entries; a pen-test letter.

## Scorecard (PMOFlow)
C1 B/A · C2 A/A · C3 A/B · C4 A/A · **C5 B/A (was C)** · C6 B/A · C7 C/B GAP · C8 B/A · C9 B/A · C10 A/A · C11 A/B · **C12 A-/A** · C13 A/A · C14 A/A · C15 C/B GAP · C16 C/B GAP · C17 not tested · **C18 C-/C** · C19 A/A · **C20 B-/B** · C21 timesheets N/O · C22 integrations D+/B · C23 levelling N/O

## Re-tests
1. Unconfirmed Done: PARTIAL. The PM confirm warns about open predecessors. But an owner clears a Jira hold with one tick and no warning, so it counts as done while its predecessor is open.
2. Rebaseline: FIXED.
3. Scope cost: NOT FIXED. An effort edit of 4→5 days is a plain edit; only the deadline is guarded, not the budget.
4. Test counts: FIXED.
5. PM self-approval: FIXED.
6. Home duplicates: none.
7. **Since last report: REGRESSED.** Opening the report preview writes reportLog and forecastLog entries.
8. Past range: PARTIAL. Areas of concern and expected cost ($61,647 vs $43,334 today) aren't as of the period end.
9. **Knock-on: FIXED.** FS dependencies respected, in-progress start kept, lateness cleared, cross-project approver added.
10. Launch window: NOT FIXED. It can be set to Dec 25 through the API, or to Jan 15 (after the Dec 31 deadline), with no plan change.
11. Holiday start: FIXED.

## Bypasses
- FIXED: PM hand-over, stored sponsor, deadline/budget, effort past the deadline, start after due, editing others' tasks, Jira due date.
- PARTIAL: adding a dependency inside the deadline doesn't move the dependent's start.
- NEW: the launch window can move past the deadline.

## Audit
- FIXED: forecast and report logs are server-only; doneAt kept through a Jira reopen; hour flags.
- **NEW: an owner can delete logged hours through the API.** 28 hours became 3, spent fell $23,669→$20,544, "$847 over" flipped to "−$4,666", and past-period reports changed. History just says "6 hours entries removed", with no totals.
- NOT FIXED: the client sends the actor and the step-up (a stamp of 2020-01-01 was accepted). (Unverified whether hosted Entra binds them.)

## Disagreements
1. Opening the report preview counts as sending a report.
2. Admin › Project sponsors says ERP "Approves now: Nobody yet" while the change screen and API say Maya.
3. "0 late · 1 blocking · 5 late or blocked" on cards.
4. The "This week" and "Last 2 weeks" from→to don't match the forecast log entries.
5. Portfolio "Changes since the saved plan" defaults to the latest automatic snapshot (0 days) instead of Kickoff (+23).
6. History says W12 moved as a knock-on, but W12 has no dependency.
7. The report calls a within-tolerance change "approved" with no approver named.
8. As of Nov 6, concerns about "3 of the 4 late or blocked" sit next to "Nothing late at period end"; "Expected Dec 4" vs "not tracked".
9. After the owner confirmed W7, the portfolio still says "1 done, not confirmed"; the variance shows done before start.

## Top 5
1. Bind the actor and step-up to the server session; the server checks that the step-up is fresh.
2. Append-only time entries: reversing entries, with hours and dollars in History.
3. Log a report only when sent or exported, never on preview.
4. Effort and cost over budget, and launch windows past the deadline or on holidays, go through Change the plan.
5. Variance defaults to the Kickoff baseline; a warning when an owner clears a Jira hold; disagreements 2–9.
