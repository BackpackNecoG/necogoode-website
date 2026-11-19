# R16 re-review: Karen (Ops Director, 220-person distributor, search)

She used her OWN data throughout: Word doc to launch-ready in about 25 minutes with no training. No attacks.

## Verdict
- **Demo:** yes.
- **Pilot:** likely, $2,500.
- **Year 1:** $1,620–2,340.
- **Blockers:**
  - Approvers see "No steps" on the page they sign.
  - The role-to-department gap: her AP lead can't confirm her own work.
  - SOC 2.
  - Solo vendor.
  - No recurring per-vendor runs (15 vendors a month).
- **What would tip it:** fix the first two, plus a roadmap date for per-vendor runs.

## Scorecard (PMOFlow)
**C1 A/A** · C2 A/A · **C3 B+/B** · **C4 A-/A-** · C5 B/B GAP · C6 B/B GAP · C7 C+/C GAP · **C8 B+/A-** · C9 B/B GAP · C10 B/C · **C11 B+/C+** · C12 B/B- · C13 A-/B · C14 B/B · C15 C/C GAP · C16 C/B GAP · C17 not tested · C18 C/C GAP · C19 A in the demo / C in production · **C20 B/B** · C21 recurring runs N/O GAP

## Re-tests (own data)
- FIXED:
  - "Do you already have these?" asked at import.
  - New project defaults to her process.
  - Bulk owner by team.
  - The owner count matches the picker.
  - Report asks use current owners.
  - Teams-involved counts.
  - "Waiting on" lines.
  - "On track" with blockers.
  - Weekly blockers.
  - The setup promise on pricing.
- PARTIAL:
  - "Finish the work (3 need an owner)" still shows the TA avatar.
  - Per-vendor data: bank letter and remit-to default to "We have it", and after saving the only choice is a "We have it" switch.
- NOT FIXED:
  - **Plan card doer:** now "—" where the map says Purchasing/AP.
  - SOC 2; recurring runs.

## New defects (all own data)
1. **The approver page shows nothing to approve:** "No steps", "uses no information", next to a prefilled "1 changed step reviewed… 5 of 5 available". "Not tested… W-9, COI, Bank letter" contradicts the changed step 2.
2. **The "AP" role isn't linked to the Accounts Payable department.** Ana (AP lead) and Nina (Head of AP) are told "Only AP can confirm"; Maya (Procurement) can confirm.
3. **The test dialog lets Rosa tick a pass she isn't allowed.** It only refuses after the 6-digit check. The BA then passed it.
4. **Launch step order:** "Each team approved" sits before "Launch-day plan", and saving the launch-day plan sent Procurement back for re-approval.
5. **The header drops missing information:** "On track · 0 blocking" while Launch says information isn't available and nobody is named.
6. The 6-digit field ignores pasted text, silently.
7. The step 4 choice says "go back to Step 10" (a later step).
8. The import draft is lost on reload, with no warning.

## Disagreements (own data)
1. The header says "2 tasks late or held up" while Work shows all 5 on track or due soon.
2. The approval page says "No steps" vs the note's "1 changed step reviewed".
3. The final report says 1 raised / 0 resolved while the header shows 0 blocking.
4. The report says "Ready for business sign-off" after both teams approved.
5. The plan says "Procurement and Accounts Payable" while the map says "Purchasing and AP".
6. Plan card "—" vs the map's roles.
7. Expected cost $10,700 with no hours logged and everything done.

## Top 5
1. The approve page shows the approver's changed steps and information.
2. Link procedure role names to the department picked at import; owning, confirming and testing follow that link.
3. Plan cards show the step's doer.
4. "Collected each run" stays choosable after saving; bank letter and remit-to default to it.
5. The launch-day plan comes before approvals, or naming a team in the launch plan doesn't reopen its approval; the report's resolved count and testing label update.
