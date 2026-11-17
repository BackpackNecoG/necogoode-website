# Expert 1: Enterprise PMO director. R10 re-review

Compared against Jira Premium + Plans, Smartsheet, monday, MS Project P3, ServiceNow SPM and Planview.

## Verdict
- **Demo:** YES.
- **Pilot:** paid pilot, yes. Not yet a contract.
- **If it converts:** 8–12 editors on Business, $6.2k–$9.4k a year, which is under his approval threshold.
- **Pitch that wins:** a companion to Jira/ADO for enterprise. Standalone works only for mid-market ops teams that don't use Jira.

## Scorecard (capability / ease)

| ID | Area | PMOFlow | Flag |
|---|---|---|---|
| C1 | | B+/A- | ONLY |
| C2 | | A-/A | ONLY |
| C3 | | B+/B | ONLY |
| C4 | | A-/A | ONLY |
| C5 | | B/B+ | PARITY |
| C6 | | B/B | GAP |
| C7 | | C+/B | GAP |
| C8 | | B+/A | PARITY |
| C9 | | B/B+ | PARITY |
| C10 | | B+/A- | ONLY |
| C11 | Testing | B/C | ONLY (counts disagree) |
| C12 | | A-/A | ONLY |
| C13 | | A-/A- | ONLY |
| C14 | | A-/A | ONLY |
| C15 | | C+/B | GAP |
| C16 | | B-/B | PARITY |
| C17 | Mobile | D/D | GAP (responsive only, no app) |
| C18 | | C/C | GAP |
| C19 | | A-/A | PARITY |
| C20 | | B/B+ | GAP (was F) |
| C21 | Timesheets / report builder | N/O | by design |
| C22 | Intake | N/O | GAP |
| C23 | Automations / marketplace | D | GAP |

## Mismatches
1. **Testing counts appear in 5 places and disagree:**
   - Simple shows "12 of 26 passed · 13 not run" for both phases;
   - Advanced shows 7/8 build, 9/26 business and 17 never run;
   - the gate shows "Blocking · 18";
   - Launch shows "waiting on 3".
2. **Coverage:** Simple says "1 of 2 have tests", but the Advanced matrix shows "6 UNCOVERED" (4 elements with 0 cases).
3. **Dave's approver page says "9 of 9 tests passed passed together"** (word doubled). Meanwhile Certificate of insurance and Vendor risk tier have 0 cases, and Vendor legal name is 0/2 in business.
4. **Bank form lateness:** the Work tab says "6 business days late"; the report says "late by 1 business day".
5. **Sprints ignore holidays:** "Nov 16–27 · 10 working days" includes Thanksgiving, and Dec 14–25 includes Christmas. Capacity isn't pro-rated.
6. **Launch on a day off:** with Dec 29 added as a day off, the Launch page shows no warning and the Dashboard still says "On track". The calendar page claims a launch can't be set on a day off.
7. **ERP earned value:**
   - With PV $386, EV $0 and $1,406 spent, SPI and CPI show "—" while status is "On track". They should be 0.00 and flagged.
   - Two methods are used for the cost estimate at completion (EAC): Vendor uses BAC/CPI ($48,847), ERP uses bottom-up ($5,000). The ERP figure ignores its $9k budget and the money already spent.
8. **Seats:** "Team plan up to 25" is shown next to "Business". Dave counts as a paid editor, leaving 0 approvers.
9. **Smaller mismatches:**
   - the decision node is counted in changes but not in steps;
   - the Dashboard workload omits Dave;
   - Jira shows "13 changed issues" when only 1 changed.

## Break tests
- **EV arithmetic reproduces.** But marking a task Done in Jira with 0 hours logged raised CPI from 0.98 to 1.17 and cut EAC by $7.9k, with no warning.
- **Holiday recompute is consistent everywhere** except sprints and launch day.
- **The audit chain recomputes:**
  - it catches an edited entry;
  - it misses a deleted last entry, even though the file carries an n=26 anchor;
  - it misses a fully re-hashed forgery, because the chain is unkeyed. The "verified as complete" claim is false. Fix: a keyed or signed head, and check the anchors in the file.
- **Works:**
  - the two-person rule for the PM;
  - step-up confirmation and invalidation;
  - Jira two-way status;
  - the paste parser's choices, time limits and systems;
  - demo booking (201, .ics file).

## Market note (reviewer research; unverified by lead)
- Microsoft stopped selling Planner Plan 5 on May 1, 2026, and retired Project Online on Sep 30, 2026. That opens room for a tool that runs natively in the Microsoft tenant.

## Top 5 changes
1. One testing-count engine feeding Simple, Advanced, the gate, the approver page and the report.
2. Pen test, a SOC 2 Type I date, and SCIM.
3. Apply holidays to sprints and capacity, and flag or block launch on a day off.
4. EV hygiene: 0.00 instead of "—", one EAC method, and a warning for Done with 0 hours.
5. Keyed audit head plus anchor checks. Raise the per-network sandbox limit, or use a cookie.
