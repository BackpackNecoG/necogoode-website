# R15 re-review: BPM/BA expert (port 8998)

## Verdict
- **Demo:** yes. "Paste-to-map with correct end, stop and skip paths, plus threshold diffs that drive approval routing and plan tasks, is now better than what Promapp or Signavio give a BA on day one."
- **Paid pilot:** yes, $2,500. A financial process is now acceptable (in R14 it was non-financial only).
- **Expansion:** about 8 editors, ~$6.2k/yr.
- **Contract:** not yet.
- **Blockers:**
  - No boundary tests for changed decision rules.
  - Profile warnings produce no tests.
  - The process page and Launch disagree on approvers.
  - RACI has no A.
  - SCIM planned.

## Scorecard (PMOFlow)
**C1 A-/A** · **C2 A-/A** · C3 B/B ONLY · **C4 A-/A ONLY** · C5 C/B GAP · C6 B+/B · C7 C/B GAP · C8 B-/A · C9 B-/B GAP · C10 B/B ONLY · **C11 B-/B (was C+)** GAP vs Xray · **C12 B+/B (was B/B-)** · C13 B+/B ONLY · C14 B/B ONLY · C15 C+/B GAP · C16 C/C · C17 C/C · C18 C/C GAP · C19 A/A ONLY · C20 B/B · C21 mining N/O · C22 recurring runs N/O · C23 AI interview N/O

## Re-test
1. Departments: PARTIAL. Ana is accepted on Launch, but people invited on the process page never reach Launch ("Needs someone to approve").
2. Uniqueness test: NOT FIXED. account_number has 0 tests ("this project does not change it").
3. Shared bank / near-duplicates: PARTIAL.
   - The bank warning is exact, and the leading zero is OK.
   - Names show "5 in 2 groups" vs 7 in 3.
   - No tests generated.
4. Role (Name): FIXED for paste and BPMN. VSDX nested "(Controller (Sam Wu))" shows "nobody yet", which is worse.
5. RACI: NOT FIXED. Only R; no A for the Controller.
6. Advanced header wording: FIXED.
7. Test numbers: FIXED (one press).
8. Teams involved: FIXED.
9. Re-approval scope: PARTIAL (not reproduced).

Carry-overs:
- Late-or-blocked total: NOT FIXED.
- risk_score split: FIXED.
- Map owners vs plan: FIXED ("Needs an owner: Sales rep").

R14 defects:
- FIXED: auto-approve ends; End here / Skip to; E2E 2 stops at the rejection; S4 wording; "was → now"; the step 9 verb; steps vs checks; **control gap closed** (Launch requires AR, Controller and Credit after the threshold change; a plan task to configure routing).
- PARTIAL: the risk-score 60→65 change isn't listed as a threshold change.
- NOT FIXED:
  - No boundary tests ($75,000 / $75,000.01, risk 65/66, $200,000 / $200,000.01); gateway scripts are generic.
  - The min/max come from the sample (risk 30), so 29 is rejected and "9 of 9 don't match".

## Disagreements
1. The process page says "4 have nobody to approve" while Launch shows Ana, Grant and Priya.
2. The header says "0+0 New + changed" while What changed shows 2 changed choices.
3. Home ERP card: "0 late · 1 blocking · 2 late or blocked".
4. Risk profile before Add tests: "1 empty"; after: "9 don't match".
5. The bank page shows a shared-account warning next to "The sample matches the rules".
6. Account number: length 6 and "2 capital letters, 4 digits", but the masked example is "XXXX9999".
7. Requested limit test claims a "leading zero" observed; there is none.
8. Duplicates: 5 vs 7.

## New defects
- "Credit limit", which the ERP produces, is labelled "Collected from the customer each time".
- BPMN import ignores the participant name (blank process name) and creates no information.
- The New project dropdown shows no change counts for the new process.

## Top 5
1. Boundary tests for changed thresholds, attached to the gateway scripts; no min/max taken from the sample.
2. Profile warnings become tests (shared bank, uniqueness, correct duplicate count), even for unchanged fields that feed a changed decision.
3. One approver truth: process-page approvers and invitees carry to Launch; RACI A from sign-off steps.
4. Count integrity: late-or-blocked, the "0+0" header, the risk profile flip, the masked-example length.
5. Import fidelity: BPMN name and information, VSDX nested role, outputs vs collected information.
