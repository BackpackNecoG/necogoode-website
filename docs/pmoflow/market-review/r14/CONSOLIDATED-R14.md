# PMOFlow R14 market re-review: consolidated (build 77461a2)

## 1. Outcomes

| Reviewer | Demo | Paid pilot | Contract | Year-1 after pilot |
|---|---|---|---|---|
| Karen (ops director, search) | Yes (booked) | Likely ($2,500) | Not yet | $1,620–$2,340 |
| Jordan (PMO coordinator, search) | Yes | **Yes** (was likely) | Not yet | $6,240 |
| PMO director (expert) | Yes | Yes | Not yet | $23,400 |
| BPM/BA expert | Yes | Yes, non-financial process only | Not yet | ~$6,200 |

Demo 4/4 and pilot 4/4 for the fourth round. **Contract 0/4 for the fourth round.**

## 2. Fixed and confirmed by reviewers
- Server-written audit history; ownership checks; refused writes labelled.
- The deadline can't move outside Change the plan (task edit, API, Jira sync, rebaseline).
- PM self-sponsor and self-approval closed.
- Unconfirmed Done stays out of EV.
- Phantom cost gone ("Cost unknown: set rates").
- Test counts agree (Jordan: 9/26 everywhere).
- Report and Launch agree; override launches show a badge and the exceptions.
- No day-off due dates.
- PM attribution of unowned work gone from headlines, reports and Home.
- "Role (Name)" handled everywhere; step numbers stable.
- Inline department approvers; early approval request fixed.

## 3. What still fails the bar (code), by theme

Count = reviewers who hit it.

1. **One owner and approver truth (3):**
   - Project plan cards and UAT scripts show the process owner (Maya) instead of the step's doer (Karen, BPM).
   - Departments says one approver while Launch says another (Jordan, BPM).
   - Tom still appears on unowned launch steps (Karen). Lead fixed this in the engine (R15 base).
2. **Governance holes (2):**
   - Role changes, including to Admin, are one click (Jordan).
   - The PM role can be handed over by a plain edit, and the sponsor is computed rather than stored (PMO, Jordan).
   - A recent joiner approved via "Choose who approves" (Jordan). Lead fixed this in the engine (R15 base).
   - Passing a self-assigned test in SIT (Jordan).
   - Effort, start and dependency edits skip the deadline guard (PMO).
   - The forecast log can be rewritten; a Jira reopen overwrites the completion date (PMO).
3. **Schedule integrity (2):**
   - The knock-on flat shift breaks finish-to-start dependencies, moves the starts of in-progress tasks, and leaves tasks late after approval while the impact screen said they wouldn't be.
   - A 10-day shift moves the start 11 days (Jordan).
4. **Branch semantics (BPM):**
   - The paste parser sends the Yes path into review.
   - No "end here" option.
   - Stop nodes are ignored in E2E tests.
   - "Loop back" labels on skip-aheads.
   - A threshold change isn't routed to the decision's owners.
   - Changed choices show no "was → now".
   - Unchanged parts' approvals reopen.
5. **Profile → tests (BPM, third round):**
   - Duplicate, shared-bank and uniqueness warnings never become tests.
   - The data page says "all match".
   - The bank spec rejects leading zeros.
   - Columns aren't fully mapped.
   - The majority shape is rejected.
   - No threshold boundary cases.
6. **Per-run data and blockers (Karen):**
   - Routing, tax ID, bank account and credit limit should be per-run data.
   - Raised − resolved ≠ open.
   - "Collected each run" items are counted as blockers.
   - The duplicate COI is still in the preview.
   - "X verifies…" isn't split into its own step.
7. **Counts:**
   - "late or blocked" ≠ late + blocking (BPM).
   - Past ranges show today's cost and concerns (PMO).
   - "19 open issues" vs 9/26 (PMO).
   - "Launched 89%" next to "4/4" (Jordan).
   - Plus the remaining disagreements in each file.
8. **Refused attempts missing from History on route modules (Jordan).** Lead fixed this (R15 base).
9. **Phone:** Launch and Testing tap targets under 32px (Jordan, third round).
10. **Small UI:**
    - The Add-department dialog stays open after a successful add.
    - The Launch nav opens the sample project.
    - "Choose owners" has no picker.
    - "Each team can approve its part at any time" contradicts the readiness rule.

## 4. Non-code blockers (unchanged; these now decide the contract)
- No SOC 2 or pen test (targets Q3/Q1 2027).
- Solo vendor.
- SCIM planned.
- Development signing key in the demo.
- The Team plan's Azure deploy (Karen; founder decision pending on a hosted Team plan).
- No recurring per-vendor runs (Karen's weekly job; deliberately excluded).
- No ServiceNow integration (PMO).

## 5. Read
Code quality is no longer what stands between these buyers and a pilot: every reviewer would pilot. What stands between a pilot and a contract is mostly section 4, plus the governance and schedule items in section 3. R15 targets section 3. Section 4 needs founder decisions.
