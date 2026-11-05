# R9 queue: findings from the round 8 reviews (build f1dc8b5)

Rule #1 still governs: ease of use for non-technical people.

## Usability panel (gating)

**Summary:**
- **Building:** passes. T1 B to A-, T2 B to A, T7 A-/A.
- **Status and approvals:** fail. T3 C to D, T4 C to D, T5 D/F.
- **Others:** T6 C to B, T8 B-/B+, T9 C to B.

**Root cause:** panels still compute their own counts instead of reading `projectTruth`.

**Status and counts (one source):**
1. **Blocking:** the headline, the WHAT'S BLOCKING box, "Who needs to act" and UP NEXT disagree. Use one ranked "who needs to act" list from the truth, shared everywhere.
2. **Lateness:** the header says "1 late", the report says "1 past due + 6 running late", and the map shows Late or Running late. Use one late count. "On track" only when nothing is late; otherwise "Running late".
3. **Approvals:** in the seed, no part is ready to approve, and every waiting card shows "…" and can't be clicked.
   - Seed one BU part as ready to approve, plus a department-head persona.
   - Waiting cards open the part page.
   - Part test counts disagree ("9 tests none run" vs "waiting on 4"; "5 business tests passed" vs "1 of 1"). Use one count.
4. **Data owners drift:** the data owner defaults to the step owner and is consistent across map, project and import. Pasted information gets an owner, never "—".
5. **"Start a project" shown with no changes:** hide it, or show "Change a Future step first".
6. **"Waiting for you" incomplete and the badge wrong:** the list must include every open item for the person (e.g. Priya's "Practice review with Compliance"), and the badge equals the listed count.
7. **Testing contradicts itself:** "3 of 22 passed" vs "Next: create the tests" vs "0 of 2 have tests". The Launch page shows "Tests passed: Create the tests". Use one phrasing: "Add tests for 2 new pieces of information".
8. **Paste import:**
   - "If OK, forwards to X": the No branch ends the process by default.
   - A "Role (Name)" pattern sets the owner.
   - The step count must equal the parsed steps (5, not 6).
9. **Progress counts:** the report "5 steps left", the Launch page "6 things left" and Steps to Launch "1 OF 7" disagree, and "10 steps · 11 changed" is shown. All must add up from the truth.
10. **Phone:**
    - The sticky header takes about 155 of 844 px. Collapse the nav into a menu.
    - "Viewing as" is truncated.
    - Move the Advanced toggle into the menu.

**Small items:**
- The "or a choice…" link looks crossed out.
- The empty "What starts it?" card.
- Step-dialog help reads "We have it" in Today but "Not available yet" in Future (flips).
- The launch window shows an ISO date and falls on a Saturday: use the friendly format and a business day.

**Jargon to remove or rename in Simple mode:**
- Rules-based / deterministic rules → hide, or "Written from project facts".
- Regenerate → "Refresh".
- Forecast cost.
- "connected" → "available".
- defect → "problem".
- system test / Business sign-off test / Try-out test / UAT folder / UAT of… / dev run → "Build check" / "Business check".
- Revoke → "Remove access".
- Audit log → "History".
- Final yes/no check.
- Sub-step.
- "Doesn't go back".
- WAIT · 2.
- "◆ / ⫴".
- BPMN 2.0 (Advanced only).

**Grammar:** quote task names in sentences ("“Set up the bank details form” is late"), "1 needs fixing", "Finish “X”".

## Concept-aware review
See CONTRACTS-R9.md §13 (pillars: Map A-, Ease B, Data A-, Drill A, Status C, Views B+, Gate C, Access B+, Testing D+, AI C, Standalone B+, CX B-).

## Blind buyer (Jira comparison)

**Grades (PMOFlow / Atlassian):**

| Phase | PMOFlow | Atlassian |
|---|---|---|
| SOP | B | C+ |
| Data | B+ | D |
| Diff | A- | D |
| Plan | B- | C |
| Tracking | **C+** | B+ |
| Impact | B | C- |
| Rollout | B+ | C+ |
| Test | **C+** | A- |
| PMO | B- | B |

**Top 8 gaps, and what A would need:**
1. One source of truth for tests, launch steps and blockers.
2. Earned value: no EV until work is done; SPI agrees with the status label.
3. Business-day calendar everywhere: no weekend due dates or forecasts; one unit for "days behind".
4. Suggested plans are levelled to capacity before they are shown (not late on day 0).
5. The step performer role → task owner (not the PM).
6. The parser keeps each condition on its own step; systems named become information.
7. Scale features: many projects, permissions, SSO, Jira/ERP integration (roadmap; out of PoC scope, so mention it in the UI only).
8. Escape closes dialogs; the 390 header is compact.

**Bugs, with repro steps:**
- **B1. Parser crosses steps.** "3. If finance access, Controller reviews…" and "5. Facilities collects laptop; if not returned within 5 days, notify Legal": step 3's No branch becomes "Returned, notify Legal" and step 5 loses its condition.
- **B2. Import name defaults to the first step's text** ("1. Clerk receives request."). Derive a name instead (e.g. "Request handling" from the first verb's noun) or leave it blank with a prompt.
- **B3. Test counts disagree:**
  - Simple says "0 of 2 have tests" while /data/D2 lists 4 tests.
  - "Try it out: 3 of 4 passed" vs Dev 6/10 in Advanced.
  - Home says "waiting on 4 tests" vs the report's "3 of 22".
  - Procurement's tests needed go from 4 to 8 after an unrelated task is completed.
- **B4. Launch steps left:** the report says 5, the Launch page says 6 (1 of 7).
- **B5. EV:** ERP Upgrade has 0/2 done but EV $2,700 and SPI 2.75. VOM shows "On track" with SPI 0.87.
- **B6. Weekend dates:**
  - ERP expected Sun Nov 22.
  - A fix due Sun Nov 8.
  - A seed task starts Sat Nov 7.
- **B7. An accepted plan is late immediately:** the dialog says "done by about Nov 16", then the Work tab shows "Delaying others / Running late", expected Nov 19.
- **B8. Completion date stored in UTC:** ticked Nov 4 at 9:50 PM CT, /data/D2 shows "Done Nov 3". Use `today` (local) for done dates.
- **B9. Mixed units:** "late by 1 day … 8 days behind plan". Business days everywhere.
- **B10. Hard-coded BU:** a new project's launch step reads "Choose who approves Procurement's part" when the process has no Procurement.
- **B11. Step owners lost:** Manager/Clerk → Maya Chen in the new plan.
- **B12. Data page contradicts itself:**
  - "Samples on file 0" vs "A made-up sample extract is on file".
  - The rule list is duplicated: "Required · Unique · Required, unique per vendor".
- **B13. A defect shown as "Settle the open question…"** in the report's Asks.
- **B14. Information marked "We have it" while an open defect is on it:** an open defect should keep it "Not available yet" ("has a problem").
- **B15. Escape doesn't close dialogs.**
