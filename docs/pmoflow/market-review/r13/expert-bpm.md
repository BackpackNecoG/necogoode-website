# R13 re-review: BPM/BA expert (build expert2-r13, port 8998)

## Verdict
- **Demo:** yes. "The only tool I've used that goes paste SOP → to-be diff → generated plan → data tests → department sign-off → launch with an undo plan."
- **Paid pilot:** yes, $2,500. Then about 8 editors on Business at $65, which is about $6.2k a year.
- **Contract:** not yet.

## Scorecard (PMOFlow capability/ease)
C1 A-/A PARITY · C2 A-/A ONLY · C3 B/B ONLY · C4 B/A ONLY · C5 C+/B GAP · C6 B+/B · C7 C/B GAP · C8 B-/A · C9 B-/B · C10 B/B · C11 B-/B · C12 B/C · C13 B+/B ONLY · C14 B/B ONLY · C15 C+/B GAP · C16 C/C GAP · C17 C/C GAP · C18 C/C GAP (SCIM planned, sole builder) · C19 A/A · C20 B/B · C21 mining/simulation N/O GAP · C22 recurring runs N/O GAP

## Re-test of R12 items
1. Departments: FIXED (inline modal, auto-mapped).
2. Uniqueness test: FIXED (TC12). But TC7 accepts the same NW1234, which contradicts it with no setup note.
3. Shared bank account / near-duplicates: PARTIAL.
   - The profile undercounts: "2 records" vs 4; "4 duplicates" vs 6.
   - The customer account number gets the shared-bank wording.
   - **No generated tests.**
4. "Controller (Sam Wu)": FIXED in paste, lanes and RACI. REGRESSED in BPMN import: the lane became its own team and the approver was unmapped.
5. RACI: FIXED (A/C/I, CFO column, CSV).
6. Advanced approval: enabled button, then the code is entered, then it fails silently. The message appears only in the console: "Not ready for your approval yet…".
7. Test numbers: still disagree.
8. Teams Involved: FIXED.
9. Re-approval from→to: done in the plan-change impact; missing on the launch card "Changed after approval".

## Contradictions
**Testing page:**
- "Try out the 38 tests" vs "0 of 42 passed".
- "0/38" vs "Business check 0/42".
- Advanced "All 5 spec fields covered" vs "9 of 9 have tests".
- "ALL COVERED" while 8 of 9 have only a generic user-origin case.

**Project page:**
- 9 blockers show "Maya Chen: Finish 'Make Account number available'". The data page says Nobody, and Change the plan says "Needs an owner: Sales rep". Home lists them for Maya.
- "9 blocking · holds up 27 tasks" in a 13-task project.
- Report "11 late or blocked" vs header "1 late, 9 blocking".

**Other surfaces:**
- Launch (Simple): "9 pieces not available" vs process page "1 not available, 8 not checked".
- Change the plan: "within tolerance, 8 days to spare", but after applying, a knocked-on task is past due and the impact screen never warned. The moved task's new owner is told "back on schedule".
- Map owners for steps 3/7 (AR Specialist/Controller) vs the project and UAT S1/S2 (Maya Chen).
- Profile: Simple "risk_score: 9 don't match" vs Advanced "Profile matches the documented spec".

## Other defects
- Parser: the auto-approve Yes branch flows into Controller approval (E2E 1 has 9 steps).
- A 5-column sample on one row put all 30 cases under "Credit report". Samples need splitting per item.
- requested_limit is typed as text (TC19 "Abcdef" accepted); "abc" and 101 are not flagged.
- TC29 rejects a shape seen in 8 of 10 rows.
- VSDX: "(Sales rep)" is not extracted as the role.
- New information owner defaults to Maya Chen instead of "whoever does the step".
- The masking note claims "first/last character kept"; the examples don't show it.

## Top 5
1. One test/coverage counter on every surface.
2. Profile warnings become generated cases; fix the undercounts; split multi-column samples.
3. Never attribute unowned tasks to the PM; Home, header, data page and Change the plan agree.
4. Advanced approval: disable the button with a reason; never fail after the code is entered.
5. Parser branch targets; "Role (Name)" in BPMN/VSDX; from→to on re-approval; numeric inference for amount/score fields.
