# R13 re-review: Enterprise PMO director (build expert1-r13, port 8997)

## Verdict
- **Demo:** yes. These have no equivalent in his stack: diff → plan → tests → department sign-off → launch with undo; cross-project knock-on; time-boxed data access.
- **Paid pilot:** yes, $2,500 for 90 days. Then Business at $65 × 30 editors = **$23,400/yr**.
- **Contract:** not yet.
- **Winning pitch in his org:** "Already using Jira? Keep your workflow." Engineers won't leave Jira; "run everything in PMOFlow" loses to tools they already own.

## Scorecard (PMOFlow capability/ease)
C1 B/A ONLY · C2 A/A ONLY · C3 A/B ONLY · C4 A/A ONLY · C5 C/B GAP · C6 B/A · C7 C/B GAP · C8 B/A · C9 B/A · C10 A/A ONLY · C11 A/B ONLY · **C12 C/A GAP (integrity)** · C13 A/A ONLY · C14 A/A ONLY · C15 C/B GAP · C16 C/B GAP · C17 not tested · **C18 D/C** · C19 A/A · C20 C/B · C21 timesheets/report builder N/O (deliberate) · C22 integrations D/B

## Re-test of R12 items
1. Out-of-order Jira Done is held. But a manual Done in the Work tab with an open predecessor and 0 hours still moves EAC/CPI/SPI: $48,847→$41,318, CPI 0.98→1.16.
2. Slips no longer raise SPI. But the PM's "Save plan" rebaselines without approval: SPI 0.97→1.17 on a project that will miss its deadline.
3. Scope cost raises EAC: fixed (+$6,216; possibly understated vs $750/day × 10 = $7,500, Inference).
4. Test counts: mostly fixed. Portfolio "9 checks not passed" vs 17.
5. PM self-approval: fixed.
6. Home items: fixed (one duplicate "Confirm…" row).
7. **Since last report: not fixed.** A 2:59 report followed by a Done at 3:01 still shows "Nothing completed".
8. Past custom range: the period section is honest, but the headline, Overall, Risks and Asks are today's state with no "as of" label.
9. **Knock-on tasks: not fixed.** After an approved re-plan, W7, W8 and W10 are still "late by 22–23 business days".
10. Christmas launch step: fixed.
11. **A holiday due date (Dec 25) saves** and shows "On track".

## Sponsor bypasses that still work
- A task owner edits their own due date past the deadline. No plan change is created and the sponsor is not told; the late flag clears.
- The PM can make himself sponsor.
- The PM rebaselines with no approval.

## Audit-forgery findings (SEVERE)
- **The history text comes from the client and is hashed as-is:**
  - A Done was logged as "Comment added".
  - A due date moved past the deadline was logged as "Fixed typo".
  - The chain still shows intact.
- **The server doesn't enforce task ownership.** Ana, an editor but not the owner, added 40 backdated hours to Dev's task through the API; it was logged as "Viewed".
- **A refused change is still logged.** A $90,000 budget edit was rejected, yet History shows "$48,000 → $90,000".
- **Held:** approver-role 403, server timestamps, no writable history type.

## Disagreements
1. Late by 6 business days (Work tab) vs 1 (status report).
2. Portfolio "9 checks not passed" vs Launch 17 vs Testing 9/26.
3. "In review 0" while 3 rows say In review.
4. The impact screen says "Tom (its project manager) approves too", but it routes to Maya only.
5. "Dec 8 → Jan 7" when the forecast was Dec 10.
6. The report shows UTC (08:59); History shows local time (2:59 AM).
7. A pending plan change still says "finish stays Dec 10".
8. Dec 25 due date, expected Dec 28, labelled "On track".
9. A "back on schedule" ask for a task due Dec 22 / expected Dec 22.
10. "available" (simple) vs "connected" (advanced).
11. "9 passed, 1 failed (now 7 of 8)".
12. History shows a budget change that never happened.

## Top 5
1. The server builds the history text from the actual diff; it enforces owner and role permissions on every field, including hours.
2. Any edit that pushes the finish past the deadline goes through Change the plan (task Edit, API, Jira sync, rebaseline). The PM can't pick the sponsor.
3. An approved re-plan re-dates knock-on due dates. No due dates on days off.
4. A Done with an open predecessor or 0 hours stays out of EV until a non-doer confirms it.
5. Reports: "since last" by timestamp; past ranges computed as of the period end or labelled "as of today"; the 12 disagreements fixed.
