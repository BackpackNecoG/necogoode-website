# R14 re-review: Jordan Reyes (PMO Coordinator, Crestline Benefits)

## Verdict
- **Demo:** yes.
- **Paid pilot:** yes, $2,500.
- **Contract:** not yet. It would be Business, 8 editors, $6,240/yr.
- **Blockers:**
  - Pen test and SOC 2 are only targets.
  - Development signing key.
  - SCIM planned.
  - **One-click Admin promotion.**
  - **Recent joiners approving in-flight parts.**
- **What tips it:**
  - Two-person, step-up role changes.
  - The joiner rule applied to approvals and override co-signs.
  - Denied attempts logged.
  - A pen-test letter.

## Scorecard (PMOFlow capability/ease)
C1 B/B · C2 A/A ONLY · C3 A/B · C4 A/B · C5 B/B GAP · C6 B/B GAP · C7 C/C GAP · C8 A/A ONLY · C9 B/B GAP · C10 A/B ONLY · C11 B/C · C12 B/B PARITY+ · C13 A/B ONLY · C14 A/B ONLY · C15 C/B GAP · C16 B/B PARITY · C17 C/D GAP · C18 D GAP · C19 B/A · C20 C/B GAP · C21 native app N/O · C22 mining N/O

## Re-tests
1. **Self-assignment: PARTIAL.** Refusals now show on screen. But self-assigning still succeeds, and Ana **passed her own self-assigned tests in Try it out (SIT)**; only the business check blocks it.
2. **Department move: PARTIAL.** Moves now need two Admins, and recent joiners are refused UAT passes. **NEW HOLES:**
   - A role change (Editor→Admin) is one click with no step-up.
   - Ana approved Compliance 9 minutes after joining and co-signed the launch override. Departments says "Approves: Dave Ortiz", but Launch says "Ana Ruiz, Dave Ortiz can approve". *(Lead: the project's "Choose who approves" pick skipped the recent-move rule. Fixed in the engine with a test, shipping in R15.)*
3. **PM self-sponsor: FIXED.** Caveat: Tom handed the PM role to Priya in Settings with no approval (it is logged).
4. Deadline locked: FIXED.
5. Test counts: FIXED (9/26 everywhere).
6. Report vs Launch: FIXED ("6 steps left cover the 9 checks").
7. Override summary: FIXED (OVERRIDE badge, "2 exceptions").
8. Import: not re-tested.
9. **Phone: NOT FIXED.** Launch has 94/105 controls under 32px; Testing has 52/91.
10. Weekly report: PARTIAL. Re-approvals and pending department approvals aren't asks; the email list is project resources only.
11. Audit: export and verify pass. **Refused actions are still absent from History: NOT FIXED** (on the paths he tried).

## Disagreements
1. Who approves Compliance: Departments vs Launch (see above).
2. Recent joiners: Testing refuses them; Approvals and the override accept them.
3. The override screen says "signed as approver", while the payload role is "sponsor".
4. After an override launch:
   - Portfolio shows "Launched 89%" next to "4/4 done".
   - "Launch-day plan COMPLETE ✓" sits under "! Overridden".
   - Approvals show a red "0/0, Two different people ✕".
5. A shift of 10 business days moved the start by 11 (Nov 9→Nov 24) and the due date by 10.
6. The "Record what happened" dialog lists all 26 as Not run, while the card says 9 of 26 passed.

## Top 5
1. Role changes become two-person with step-up; the joiner rule applies to approvals and override co-signs.
2. Record refused attempts in History.
3. Block passing a self-assigned test in every environment, or block self-assignment.
4. One approver list across Departments and Launch; fix the post-launch panels and the 89%.
5. Phone tap targets on Launch and Testing; pending approvals in the weekly asks and email list.
