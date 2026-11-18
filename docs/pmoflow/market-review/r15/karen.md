# R15 re-review: Karen (Ops Director, 220-person distributor, search)

## Verdict
- **Demo:** yes, booked; about 15 minutes from Word doc to gated approvals with no training.
- **Pilot:** likely, $2,500.
- **Year 1:** $1,620 (Team, 3 editors) or $2,340 (Business).
- **Blockers:**
  - The Azure template, with no written "we run the setup with you on one call".
  - SOC 2 is not done.
  - Solo vendor.
  - No recurring per-vendor runs.
  - **"On track" next to 11 blockers.**
- **What would tip it:** an honest status pill, owner labels that match the map, a written setup-call promise, and a roadmap date for per-vendor runs.

## Scorecard (PMOFlow)
C1 A-/A · C2 A/A ONLY · C3 B/B · C4 B/B+ · C5 B-/B GAP · C6 B/B GAP · C7 C/C GAP · C8 B/B+ · C9 B-/B- GAP · C10 B/C · C11 B/C · C12 A-/B+ · C13 A-/B · C14 B/B · C15 C/C GAP · C16 C/B GAP · C17 B-/B · C18 C/C GAP · C19 A in the demo / C in production · C20 B-/B GAP · C21 recurring runs N/O GAP

## Re-tests
- PM attribution: PARTIAL. "Finish the work (13 need an owner)" still showed TA before owners were set.
- Add-department dialog: FIXED.
- **Map vs plan owner: NOT FIXED.** Plan cards for the changed steps 2 and 5 show "Maya Chen"; the map says Purchasing and AP.
- Weekly blockers: FIXED (11/0/11 = header; per-run items excluded).
- Per-vendor data: PARTIAL. "Routing number", "Account number" and "Vendor legal name" are still setup tasks. Duplicate COI: FIXED.
- "AP verifies" step: FIXED (own-line case). "Train…" Who: FIXED. Nav Launch: FIXED.
- "Choose owners": FIXED (a real picker). New cost: 13 separate dropdowns with no bulk "all Purchasing tasks → Rosa".
- Approval text: PARTIAL. "Waiting on 14: …" still adds unlike things.
- Teams involved counts: NOT FIXED.

## New findings
- The New project process dropdown defaults to the sample, not the process just created.
- The import never asks "do you already have these?", so 9 "not checked yet" items silently become 9 setup tasks and 9 blockers.
- Expected cost of $34,850 once owners were set. It's explained honestly but looks large.

## Disagreements
1. A green "On track" pill next to "11 blocking" (header, Home, Portfolio), while ERP with 1 blocking is "Behind on effort".
2. "13 late or blocked" next to 0 late + 11 blocking.
3. Report ASKS "unassigned: Vendor request…" while Newly assigned and Work say Rosa.
4. "Choose owners for 7 tasks" while the picker lists 4.
5. Home "11 not available yet" vs the process page's 9 not checked + 2 not available.
6. "Procurement team: 8 of 13", while Rosa owns 6.
7. "Routing number" is a setup task while "Routing numbers" is collected each run.
8. Owner labels: plan says Maya, map says Purchasing/AP.
9. Teams-involved step counts.

## Top 5
1. The status pill reflects blockers; fix the late-or-blocked arithmetic.
2. Plan cards show the step's doer, the same everywhere.
3. Import asks "Do you already have these?"; per-vendor fields classified consistently.
4. New project defaults to the process just made; bulk owner assignment by team.
5. Report asks use current owners; teams-involved counts match the map; split "Waiting on 14" into lines.
