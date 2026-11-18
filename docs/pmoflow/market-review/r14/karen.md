# R14 re-review: Karen (Ops Director, 220-person distributor, search)

## Verdict
- **Demo:** yes. She booked one through the local form in under a minute, and went from Word doc to map, diff, plan and gated approvals in about 15 minutes.
- **Pilot:** $2,500, likely.
- **Year 1:** Team with 3 editors at $1,620, or Business at $2,340.
- **Blockers:**
  - The Team plan's Azure template.
  - No SOC 2 or pen test yet.
  - Solo vendor.
  - No recurring per-vendor runs.
  - Blocker counts that contradict "We have it".
- **What would tip it:** a written "we run the Azure setup with you on one call", clean blocker numbers, and a roadmap date for per-vendor runs.

## Scorecard (PMOFlow capability/ease)
C1 A-/A · C2 A/A ONLY · C3 B/B ONLY · C4 B/B+ ONLY · C5 B-/B GAP · C6 B/B GAP · C7 C/C GAP · C8 B/A · C9 B/B GAP · C10 B/C ONLY · C11 B/C ONLY · **C12 A-/B+ ONLY** · **C13 A-/B ONLY** · C14 B/B ONLY · C15 C/C GAP · C16 C/B GAP · **C17 B-/B (was C)** · C18 C/C GAP · C19 A in the demo / C in production · **C20 B-/B (was C+)** · C21 recurring runs N/O GAP

## Re-test of R13 items
1. PM attribution: FIXED, with leftovers.
   - The "Choose owners for 8 tasks" row and 6 per-task rows both appear.
   - Launch and Steps-to-launch still show Tom's avatar on "Finish the work (8 need an owner)" and "Information available".
2. Phantom cost: FIXED ("Cost unknown: set rates").
3. New-department approver: FIXED (invite by email; honest "2 have nobody to approve"). **New bug:** after "Add department" the dialog stays open, blanked, with the error "Name a department.".
4. Step numbers: FIXED.
5. Map vs plan owner: NOT FIXED. Project plan cards for changed steps 2 and 4 show "Maya Chen"; the map and step page show Vendor and AP. Unchanged steps show "—".
6. Portfolio header vs row: FIXED.
7. Weekly blockers: PARTIAL. 9 raised, 0 resolved, 6 open. W-9, COI and Bank letter are counted even though they're "Collected each run".
8. Early AP approval: FIXED.
9. Per-vendor data: PARTIAL.
   - W-9, COI and Bank letter: no tasks.
   - Routing numbers, W-9 tax ID, Vendor bank account and Credit limit still became "Make … available" tasks.
   - The COI is duplicated in the preview ("Certificate of insurance coi").

## New findings
- "AP verifies the bank letter by calling the bank" became a note under a Vendor step, not an AP step.
- "Train the people…" task says "Who: Vendor (role)".
- Nav "Launch" opens the sample project, not the current one.
- "Choose owners for 8 tasks" only adds ?owner=none; the screen doesn't visibly change and there's no owner picker.
- Clumsy approval text: "Waiting on 5: 2 tasks…, Routing numbers, 1 test to pass and Routing numbers to get tests".

## Disagreements
1. Weekly: raised 9, resolved 0, open 6; header "6 blocking".
2. W-9/COI/Bank letter: the report says "not available yet"; the step and process say "We have it / Collected each run".
3. Step owners: plan card "Maya Chen" vs map Vendor/AP.
4. Launch "Information available" Who: Tom vs tasks "Needs an owner".
5. Teams involved: "Purchasing · 5 steps, Operations · 3 steps" vs the map (Purchasing on 4, Operations on 1–2).

## Top 5
1. Blockers and the weekly table agree with "We have it / Collected each run" (raised − resolved = open). Per-vendor fields (routing, tax ID, bank account, credit limit) become per-run data with no setup tasks.
2. One owner label everywhere: plan cards show the step's doer.
3. Fix the Add-department dialog re-opening after a successful add.
4. Split "X verifies…" clauses into their own steps; drop the duplicate COI.
5. No Tom avatar on unowned launch steps. Merge "Choose owners" with the per-task rows and make it open an owner picker.
