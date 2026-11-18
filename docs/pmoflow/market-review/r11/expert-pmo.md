# Expert 1 (Director of Enterprise PMO): R11 re-review

## Verdict

- **Demo:** yes.
- **Pilot:** paid pilot, $2.5k, yes.
- **Contract:** not yet.
- **Likely deal:** Business, 15 editors × $65, about $11.7k/yr, with 60 free approvers. That beats 75 Smartsheet seats at about $17k.
- **Pitch:** a companion to Jira/ADO wins. It only works once sync can't bypass the gates.

## Scorecard (capability / ease)

| Category | Grade | Note |
|---|---|---|
| C1 | B/A | ONLY |
| C2 | A/A | ONLY |
| C3 | B/B | ONLY |
| C4 | A-/A | ONLY |
| C5 | B/A | |
| C6 | B/A | PARITY |
| C7 | B-/A | |
| C8 | A-/A | |
| C9 | B/A | |
| C10 | B+/A | ONLY |
| C11 | B/C | |
| C12 | A-/B | |
| C13 | B+/B | ONLY |
| C14 | B/B | ONLY |
| C15 | C+/B | |
| C16 | B/B | |
| C17 | C | not tested |
| C18 | D/C | |
| C19 | A/A | |
| C20 | C/B | |
| C21 Integration ecosystem | D/C | GAP |
| C22 Timesheets | N/O | |
| C23 Report builder | N/O | |

Market note: Project Online was retired on Sep 30, 2026, which leaves PMOs without timesheets or portfolio tooling. That's an opening.

## Re-tests

- **Fixed**
  - EV shows 0.00 and "Spent with nothing finished", and there is one EAC.
  - Sprint holidays.
  - Launch window: holidays and weekends are refused, and a two-person override with step-up works.
  - Audit chain: an HMAC head catches edits, re-hashes, tail deletes, middle delete plus re-hash, and head removal.
- **Partly fixed**
  - The approver page's "not tested because not changed" list is wrong: it excludes Vendor master and Approver matrix, which the diff shows changed.
  - Office NAT: the 11th new visitor in about 10 minutes is blocked, and the message contradicts itself.
- **Not fixed: testing counts disagree across screens**
  - Simple "Try it out" shows the same line as Business check (9/26).
  - Advanced shows 7/8.
  - The run header shows 9/32.
  - The report shows 14 passed, 1 failed.
  - Coverage: "1 of 2 have tests" vs a list of 4 tests, the gate names 2 fields, and the matrix shows 6 uncovered.
- **Residual**
  - Audit: `actorName` isn't in the hash, so an edit to it verifies. The CSV can't be verified. The local export says "development key" (expected locally, because production has `PMOFLOW_AUDIT_KEY`; verify on live).
  - A launch-day step can be set on Christmas or outside the window and still show "Ready". The summary doesn't mention the override.
  - EV uses the current budget, not the baseline: a budget change moved CPI and SPI instantly. ERP shows CPI 0 but an expected cost under budget.

## New and serious: Jira sync bypasses governance

Moving issues to Done in the simulated Jira caused all of this:
- closed a defect without going through fixed/verified, while its test is still failed;
- marked Bank remittance details "Confirmed live, no evidence", which passed the information gate;
- moved the project to "On track", with EAC dropping from $48.8k to $39.6k;
- recorded the audit entries under Tom.

## Mismatches

1. The bank form shows late by 6 business days in Work/Home/risk register, but late by 1 in the report's Risks.
2. Testing counts (above).
3. Vendor legal name: Simple says "not tested"; Advanced shows "2 cases pass".
4. **Approver identity**
   - Procurement: the card says Rosa, History says Maya.
   - IT: the card says Sam, History says Dev.
   - Rosa and Sam never appear in the audit trail.
5. **Access request**
   - Launch says Tom, the table says "Waiting for Leo", and it's in neither person's queue.
   - Rules: Simple says Tom decides; Advanced says Leo.
6. Access STATUS is "Closed" on every row while the header shows "2 open" or "1 open · 1 waiting".
7. A grant shows 33 days on a page that says "30 at most".
8. Launch says Nov 17 at 11:10 PM CT; Portfolio says "Live since Nov 18" (UTC).
9. The weekly report says "No plan changes this week" right after an applied change, yet shows the new budget.
10. "Since last report" says since Nov 13, while History shows a report on Nov 17.
11. Dave is labelled "signed as sponsor" on the override, but he's an approver.
12. Workload shows Leo "1 late" while the Work tab marks 2 late.
