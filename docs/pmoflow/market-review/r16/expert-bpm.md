# R16 re-review: BPM/BA expert (port 8998)

He used his OWN inputs end to end: paste → Future edits ($75k/65, $250k→$200k→$150k) → plan → profile → 26 tests → three approvals → re-approval → launch v1→v2. No attacks.

## Verdict
- **Demo:** yes. "Goes beyond what Promapp or Signavio give a BA on day one."
- **Paid pilot:** yes, $2,500.
- **Expansion:** about $6.2k/yr.
- **Contract:** not yet.
- **Blockers:**
  - Stale evidence after a rule change.
  - Approvers can't see their diff.
  - The duplicate/shared-bank control is untested.
  - SCIM.

## Scorecard (PMOFlow)
**C1 A/A** · C2 A-/A · C3 B/B · C4 A-/A · C5 C/B GAP · C6 B+/B · C7 C/B GAP · C8 B-/A · C9 B-/B GAP · C10 B/B · **C11 B/B** · **C12 B/B- (down: stale evidence)** · C13 B+/B · C14 B/B · C15 C+/B GAP · C16 C/C · C17 C/C · C18 C/C GAP · C19 A/A · C20 B/B · C21–23 N/O

## Re-tests (own data unless marked)
- FIXED:
  - VSDX nested role;
  - RACI (A, I, CSV);
  - one-press tests;
  - teams involved;
  - re-approval scope;
  - boundary tests (75000.00/.01, 65/66, 200000.00/.01 in S2/S4);
  - no sample min/max;
  - risk threshold listed;
  - credit limit "Made by step 9";
  - BPMN name and information;
  - duplicates 7 in 3;
  - warning vs "matches rules".
- PARTIAL:
  - invitees still "Needs someone to approve" on Launch;
  - shared bank / duplicates counted right but still no tests;
  - New project dropdown shows "(1 new)" without the changed choices.
- NOT FIXED:
  - uniqueness test (Account number "not counted" though it feeds the new duplicate-check step);
  - late-or-blocked card [sample].

## New defects (own data)
- **CRITICAL: a threshold change after testing does not invalidate the evidence.**
  - $200k→$150k after 26/26 passed: the cases and S4 still test $200,000.
  - Testing still shows 26/26 ✓.
  - The routing task stayed done with the old name.
  - v2 launched on stale evidence.
- **Approvers sign blind:** "No steps / uses no information" for AR, Controller and Credit.
- A dead-end "Approve again" link in advanced view.
- The duplicate control is never tested: the data feeding the new step is excluded as "not changed".
- A silent save failure: the tester list offers an Approver, whose 403 shows only in the console.
- The launch-day-plan re-approval rule is inconsistent; the re-approval reason gets overwritten.
- The training task names only AR, though Controller and Credit routing changed.
- requested_limit "$260,000" is not flagged.
- Import defaults differ: paste says "Collected each run", BPMN says "We have it".

## Disagreements (own data unless marked)
1. The Launch confirm dialog's "APPROVED BY" is blank vs history NB, RV, GW.
2. "Finish the work ✓" vs advanced "Blocking · 5" (unconfirmed).
3. RACI "Made by step 9" vs the Future map's "step 10".
4. The Controller step says "Team: Credit" vs "Controller · 1 step".
5. "Add tests for 3 new pieces" vs "3 change" (none new).
6. "Run the business check" is assigned to Tom, who gets a 403 when recording it.
7. ERP card late or held up. [sample]

## Top 5
1. A rule change after a pass invalidates the affected tests, regenerates boundaries, reopens and renames routing tasks, and blocks launch.
2. Each approver sees the real was→now diff for their part, including new steps.
3. Test scope includes data feeding new or changed steps; uniqueness, shared-bank and duplicate warnings become tests.
4. Invitees count at Launch; the tester list excludes roles that can't record; save errors show on screen.
5. Count integrity (APPROVED BY, finish vs blocking, step numbers, team label, dropdown counts).
