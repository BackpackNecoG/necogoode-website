# Jordan (PMO Coordinator, benefits administrator, came from search): R11 re-review

## Verdict

- **Demo:** yes.
- **Pilot:** $2.5k, yes.
- **Contract:** not yet. Expected size is about 8 editors on Business, $6,240/yr, roughly $8.7k in year one including the pilot.
- **What tips it:**
  - auditor-grade separation-of-duties evidence;
  - the pen-test letter;
  - Planner sync.

## Scorecard (capability / ease)

| Category | Grade | Flag |
|---|---|---|
| C1 | B/B | |
| C2 | A/A | ONLY |
| C3 | A/B | ONLY |
| C4 | A/A | ONLY |
| C5 | B/A | |
| C6 | C/B | GAP |
| C7 | C/C | GAP |
| C8 | A-/A | ONLY |
| C9 | B/B | |
| C10 | B-/B | ONLY, with a defect |
| C11 | B-/B | ONLY |
| C12 | B/A | ONLY |
| C13 | B/B | ONLY |
| C14 | A-/B | ONLY |
| C15 | C/B | GAP |
| C16 | B-/B | |
| C17 | C/C | GAP |
| C18 | D/C | GAP |
| C19 | B/A | |
| C20 | C/B | GAP: solo founder |

## Mismatches

1. **Procurement approver.** The status report says "approved by Rosa Vega". Launch history and Admin History say "Maya Chen Procurement sign-off". Maya owns steps there.
2. **IT sign-off.** Admin History shows "Dev Kumar IT sign-off on access review", but Dev owns the Access Review process, and the security page claims step owners can't approve. The seeded history contradicts the rule.
3. **Test counts after a bulk pass.** Testing shows "25 of 26 passed · 1 needs fixing". The audit line says "25 of 32 run, 0 failed".
4. **Report vs Testing.** The report says "TESTS 14 passed, 1 failed (2 runs)". Testing says "9 of 26". "Try it out" and "Business check" always show identical counts.
5. **Access table, desktop vs phone.** On desktop, every row's STATUS is "Closed" while the header says "2 open". The phone shows "1 OPEN · 1 WAITING".
6. **Access approver.** Step 7 says Tom must approve the access request. The row says "Waiting for Leo Park".
7. **Expiry.** History says expired Nov 12 6 PM. The ENDS column says Nov 13.
8. **Cross-project knock-on.** A change moved an ERP task, and ERP became "Some tasks late". But ERP's Plan changes log shows 0, its PM was never asked, and its expected date didn't move.
9. **ERP money.** CPI is 0.00 and "spent with nothing finished", yet expected cost is $6,406, $2,594 under budget.
10. **Unlabelled weighting.** "89%" sits beside "3/4 done"; the weighting isn't explained.
11. **Approval page vocabulary.** Compliance uses "time limit" and "problems". Treasury uses "SLA" and "Open defects".
12. **Phone spacing.** Text runs together: "Late1 will finish…", "Blockingholds up 5 tasks".
13. **Estimator.** 0 or a negative number gives 1 editor silently. 30 editors on Team still shows a price even though Team caps at 25.

## Worked

- **Status report presets.** Accurate, and they reconcile. There is no custom from/to range in Simple.
- **Change the plan.** Excellent:
  - cross-project knock-on;
  - reopened approvals;
  - two-person approval;
  - CSV export.
- **Approver lockout.** Non-approvers get no Approve button.
- **Audit verify.** Caught a one-word edit.
- **Visio import.** Branches came through.

## Failures

- **Bulk pass.** Ana (AP) passed 16 tests, including Compliance's sanctions and due-diligence tests. There was no refusal and no step-up. "Assigned to no one" means anyone can pass it. Fix: restrict passing a part's tests to that department's people and assignees, and require step-up for bulk.
- **Plan-change approval.** No step-up.
- **Launch override.** The two-person override flow wasn't discoverable. "Launch now" is just disabled.
- **Visio.** Start and End shapes became steps (6 vs 4). "Role: task" text didn't map to owners.
- **Phone access table.** It hides status, ends and actions behind a horizontal scroll with no cue.
- **Sandbox lockout.** After about 6 fresh contexts with no cookies, there was a 10-minute burst lockout.
