# Expert 1: Enterprise PMO director, R12 re-review

## Verdict
- **Demo:** yes.
- **Paid pilot:** yes, $2.5k.
- **Contract:** about 25 editors on Business, roughly $19.5k/yr, with approvers free.
- **Pitch:** "Already using Jira? Keep the boards, add PMOFlow as the governance layer." He says "start fresh" loses for his org.

## Scorecard (capability / ease)

| ID | Area | Grade | Note |
|---|---|---|---|
| C1 | | B/A | ONLY |
| C2 | | A/A | ONLY |
| C3 | | A/B | ONLY |
| C4 | | B/A | ONLY |
| C5 | | C/B | GAP |
| C6 | | B/B | GAP |
| C7 | | C/B | GAP |
| C8 | | B/A | |
| C9 | | B/A | |
| C10 | | B/A | ONLY |
| C11 | Testing | C/B | counts still disagree |
| C12 | Approvals | **A/A** | ONLY |
| C13 | | B/A | ONLY |
| C14 | | A/A | ONLY |
| C15 | | B/B | |
| C16 | | C/B | |
| C17 | | B/B | |
| C18 | | D/C | |
| C19 | | A/A | |
| C20 | | C/B | |
| C21 | Timesheets / report builder | N/O | |
| C22 | API / marketplace | D/D | GAP |
| C23 | ITSM change/CAB link | N/O | GAP |

## Re-tests
- **Fixed:**
  - Audit forgery: all 11 attacks rejected, including actorName edits in JSON and CSV.
  - Approver identity.
  - Access dates and cap.
  - Weekly report now includes plan changes.
  - Budget raise no longer moves CPI.
- **Partly fixed:**
  - Jira "Done" on the defect and on the info-making task is now held In review. But an out-of-order Done (VOM-8, predecessor open) still moved EAC $48.8k→$37.0k, CPI to 1.30, SPI to 1.06, late from 5 to 1, and the finish date earlier. The warning only appears in the sync log and the Work view.
  - EV: planned value follows current dates, so pushing a due date out *raised* SPI while the project became "Will miss the deadline". A scope change that "adds licence cost" didn't raise EAC.
  - Christmas launch-day step: the gate blocks it, but the card says "COMPLETE ✓ Ready… in order".
- **Not fixed:**
  - **Test counts.** Testing says 9/26 passed and 16 not run. The matrix has 32 items (9 passed, 23 not run). The report says 18 passed, 1 failed, 3 runs. Simple says "1 of 2 have tests"; the gate says "2 fields lack a case"; the matrix shows 6 uncovered.
  - **"Since last report"** compares by day, not by exact time, and re-lists items already reported.

## New governance gaps
- **PM self-approved a deadline-breaking slip,** both as PM and as PM of the affected project, and it applied instantly. A budget change, by contrast, needed the sponsor. A deadline slip should need the sponsor too, and the same person must not count twice.
- **Rosa's Procurement approval was invalidated,** but her Home says "Nothing waiting". Re-approvals don't reach the approver's Home.
- **Leo isn't asked on his Home to confirm the Jira items held "In review".**

## Mismatches
1. Test counts (above).
2. Launch-day card says "COMPLETE Ready" while the gate shows Blocking (Christmas).
3. Finish slip for the same change: impact says Dec 4→Jan 4 (+19), weekly report says Dec 7→Jan 4 (18), since-last says Dec 8→Jan 4 (17). The session started at Dec 10.
4. "Since last report" re-lists already-reported changes and says the finish moved 17 days.
5. **Past custom range leaks today's knowledge:** for Nov 2–13 it shows "Expected finish Dec 7" while listing late tasks expected Jan.
6. Plan-change impact says knock-on tasks "move", but afterwards their due dates are unchanged and show "Late by 18 business days".
7. Task counts per step differ between the project map (2/2, 0/3) and the department reviews (1/1, 0/2).
8. Treasury review shows "Information added: Vendor master, Certificate of insurance"; the diff shows only Vendor master.
9. Procurement shows "changed after approval… Nov 17, 11:00 AM", but there's no matching History entry.
10. Report says "Procurement approved by Rosa"; Launch says re-approval is needed.
11. Launch-day editor pre-selects Tom as undo owner with 10 days support, while the page says "Not set".
12. VOM-6 is "In review" in the sync log but "not started" in the launch gate.
13. Simple says "6 steps left"; Advanced says "9 checks not passed".
14. A Dec 25 due date was accepted through Change the plan, despite "skip every day off".

## Top 5
1. Held or out-of-order inbound Jira statuses don't move the forecast or EV until dependencies are met and the item is verified.
2. Planned value from the baseline. Knock-on moves update due dates. Scope cost raises EAC.
3. One testing ledger for every screen and report.
4. Route a deadline slip to the sponsor, block double-role self-approval, and put re-approvals on Home.
5. Report periods: exact timestamps, and no current-state leakage into past ranges. The launch card reads from the gate. Reject holiday due dates.
