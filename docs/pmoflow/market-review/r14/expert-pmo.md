# R14 re-review: Enterprise PMO director (port 8997)

## Verdict
- **Demo:** yes.
- **Paid pilot:** yes, $2,500.
- **Year 1:** Business, 30 editors = **$23,400**, alongside Jira.
- **Contract:** not yet.
- **Blockers:**
  - SCIM planned.
  - The sponsor isn't a fixed role the PM can't change.
  - Knock-on re-dating breaks finish-to-start dependencies.
  - No ServiceNow integration (the compare page omits ServiceNow, though the demo form lists it).
- **What would tip it:** a named sponsor locked from the PM, dependency-correct re-scheduling, and a SOC 2 timeline.
- **Pricing note:** $65/editor is 2–4× Jira or Smartsheet per seat. It's defensible because approvers are free and it sits next to those tools.

## Scorecard (PMOFlow)
C1 B/A ONLY · C2 A/A · C3 A/B · C4 A/A · C5 C/B GAP · C6 B/A · C7 C/B GAP · **C8 B+/A** · C9 B/A · C10 A/A · C11 A/B · **C12 B/A (was C)** · C13 A/A · C14 A/A · C15 C/B GAP · **C16 C+/B** · C17 not tested · **C18 D+/C** · C19 A/A · C20 C/B GAP · C21 timesheets N/O · C22 integrations D+/B · C23 levelling N/O

## Re-tests
1. Unconfirmed Done and EV: FIXED. Leftover: the PM confirms in one click with no warning that the predecessor is still open.
2. Rebaseline: FIXED (API add/edit/delete return 409).
3. Scope cost: works. But an effort edit (5→6 days, +$1,078) is a plain task edit with no plan change.
4. Test counts: PARTIAL. Testing shows "19 open issues" vs the report's 9 of 26.
5. PM self-approval: FIXED.
6. Home duplicates: none.
7. Since last report: FIXED.
8. Past range: PARTIAL. "Overall (as of Nov 6)" shows today's cost and today's concerns while also saying "nothing late at period end".
9. **Knock-on: PARTIAL.**
   - A flat shift puts W7 due Jan 4, before its predecessor W6 (Jan 5).
   - W7, W8 and W10 are still late after approval, although the impact screen says they won't be.
   - Starts of in-progress tasks were moved.
10. Christmas launch step: not re-tested.
11. Day-off due dates: FIXED. A start date on a holiday is still accepted.

## Bypasses
- FIXED: owner due date past the deadline, PM self-sponsor, PM rebaseline, Jira due-date sync.
- **NEW:**
  - The PM role can be handed over with a plain edit. Tom set the PM to Maya (the sponsor); her deadline change then routed to Ana as "sponsor". The sponsor is computed, not stored.
  - Effort, start and dependency edits skip the deadline guard (effort 40 days, start after due, a new dependency).

## Audit
- FIXED: server-written history; ownership 403 logged "Refused"; refused changes labelled.
- Backdating is flagged. Future-dated hours, 40 hours in one day, and hours before the task's start are all accepted.
- Still open:
  - The forecast log can be rewritten through the API; History only says "3 items → 3 items".
  - A Jira Done→reopen→Done round trip overwrites the original completion date.
  - The client sends the actor and the step-up check (Unverified whether hosted sign-in binds them).

## Disagreements
1. Plan-change entries the system wrote today are marked "Older entry: worded by the person".
2. "Expected finish moved (Dec 7 → Dec 10)" vs "(Dec 8 → Dec 10)"; it was already Dec 10 at the last report.
3. The impact screen says knock-ons "don't show as late"; the Work tab shows 3 late.
4. "Try it out · tests passed · 1 failed".
5. The Jira connect message says "5 dependency links"; the plan has 6.
6. The report lists W7 under STARTED while it is Not started.
7. The API says sponsor "none"; the UI names Maya.
8. Seed data: 28 hours logged in one day; grant G3 approved before it was requested.

## Top 5
1. Sponsor becomes a stored field the PM can't touch; changing the PM is a plan change.
2. Re-plan by real scheduling: respect FS dependencies, keep in-progress starts, clear knock-on lateness.
3. Effort, start and dependency edits go through the deadline guard; reject a start after the due date.
4. Lock the forecast log and completion dates on the server; flag future-dated hours and impossible hours per day.
5. Fix the 8 disagreements; compute "as of" past sections at the period end.
