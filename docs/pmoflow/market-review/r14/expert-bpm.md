# R14 re-review: BPM/BA expert (port 8998)

## Verdict
- **Demo:** yes.
- **Paid pilot:** yes, but only on a non-financial process.
- **Expansion:** about 8 editors, ~$6.2k/yr.
- **Contract:** not yet.
- **Blockers:**
  - A rejected credit request reaches "update limit".
  - A threshold change skips Credit and Controller sign-off.
  - Profile warnings produce no tests.
  - The bank-account test rejects real routing numbers.
  - Single builder; SCIM planned.
- **What would tip it:** correct branch semantics, and approvals driven by the changed decision rule.

## Scorecard (PMOFlow)
C1 B+/A · C2 B+/A PARITY (Signavio compares revisions) · C3 B-/B ONLY · C4 B+/A ONLY · C5 C/B GAP · C6 B+/B · C7 C/B GAP · C8 B-/A · C9 B-/B GAP · C10 B/B ONLY · **C11 C+/B GAP (vs Xray)** · C12 B/B- · C13 B+/B ONLY · C14 B/B ONLY · C15 C+/B GAP · C16 C/C · C17 C/C · C18 C/C · C19 A/A ONLY · C20 B/B · C21 mining N/O · C22 recurring runs N/O · C23 AI interview capture N/O (Lucid Process Agent)

## Re-test
1. Departments: PARTIAL. The named AR approver (Ana) is rejected on Launch: "nobody who can approve belongs to Accounts Receivable", while the process page says "Approves: Ana Ruiz".
2. Uniqueness test: NOT FIXED (no duplicate test for the account number).
3. Shared bank / near-duplicates: PARTIAL.
   - The bank count is now exact (4 accounts on 9 records).
   - Names show 5 where there are 7.
   - No tests generated.
   - The data page says "all match the rules".
   - The bank spec uses the account-number shape and rejects a leading zero (021000021).
4. Role (Name): FIXED (VSDX nested parentheses: minor).
5. RACI: PARTIAL. Only R is filled; the Controller is not A over $250k.
6. Advanced approval: FIXED. The header still says "Each team can approve its part at any time."
7. Test numbers: PARTIAL. The first "Add tests" press gave 4 of 9; a second press was needed for 9 of 9.
8. Teams Involved: FIXED.
9. Re-approval from→to: FIXED. But IT's approval reopened with no IT steps changed.

## R13 contradictions
- FIXED: 38 vs 42; Maya on blockers; "holds up 27".
- PARTIAL: ALL COVERED (now a "basic only" banner); Change the plan.
- NOT FIXED: "All 5 spec fields" vs "9 of 9" (now explained); map owners vs project/scripts; late or blocked total; risk_score profile.

## Other defects
- **Paste parser:** the auto-approve Yes branch still flows into Credit Manager review. The choice editor has only continue/go back, no "end here". BPMN handles this correctly.
- **Split:** risk_score stayed under Customer name.
- **Numeric inference:** FIXED for requested_limit. Missing: boundary cases ($75k, $250k, $260k) and risk 101.
- **TC29:** still rejects the majority shape.
- **Owner default:** FIXED. But a data owner doesn't follow when its step moves.

## New defects
- A rejected request still reaches "Update the credit limit" in E2E 1, despite the Stop node.
- A skip-ahead is labelled "↩ Loop back"; script S4 says "returns".
- A changed choice shows no "before" threshold; "1 changed" vs 2 in the diff.
- **Control gap:** a threshold change is never routed to Credit or Controller approval.
- Step 9 lost its verb: "Update the credit limit in the ERP and the customer".
- An unconfirmed Done counts toward "All project work is finished".
- "2 steps left cover the 1 check".

## Disagreements
1. Header: 0 late, 9 blocking, "10 late or blocked".
2. AR approver: process page vs Launch.
3. Bank account: Testing warns; the data page says all match.
4. Names: Testing "5 duplicates"; the data page says all match.
5. Steps 2/4 owners: AR Specialist on the map, Maya on the project and in S1/S2.
6. After the first Add tests: the card says "1 test ✓ Ready" vs "4 of 9".
7. Advanced "All 5 spec fields" vs simple "9 of 9".
8. Plan suggestion "Needs an owner: AR Specialist" vs project cards "Maya Chen".

## Top 5
1. Branch semantics: "end here" / "skip to step N"; Stop nodes respected in E2E tests and paths; correct loop labels.
2. Profile warnings become tests (duplicates, shared bank, uniqueness); every CSV column mapped; no spec from another field's shape; never reject the majority shape.
3. Changed choices route approval to the owners of the choice and the steps after it; "was → now" on choices; reopen only parts that actually changed.
4. One owner and approver truth (map role, project cards, scripts, data owner, Launch).
5. Schedule integrity: knock-ons keep their dependencies and durations; late + blocking = "late or blocked"; unconfirmed Done is not done.
