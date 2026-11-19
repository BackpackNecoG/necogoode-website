# R16 re-review: Jordan Reyes (PMO Coordinator, Crestline Benefits)

He used his OWN benefits enrollment-change process and project. Every finding is tagged; no deliberate attacks were tried.

## Verdict
- **Demo:** yes. The chain worked on his own process in about 40 minutes, and the R15 controls hold.
- **Paid pilot:** yes, $2,500.
- **Contract:** not yet ($6,240/yr).
- **Blockers:**
  - A builder can pass UAT on their own work.
  - Stale approvals survive a department move.
  - Approval pages show "No steps".
  - Pen test and SOC 2.
  - SCIM.

## Scorecard (PMOFlow)
C1 B/B · C2 A/A · C3 B/B · C4 A/B · C5 B/B GAP · C6 B/B GAP · C7 C/C GAP · C8 A/A · C9 B/B GAP · C10 A/B · C11 B/B · C12 B/B · C13 A/B · C14 A/B · C15 C/B GAP · C16 B/B · C17 B/B · C18 D/C GAP · C19 B/A · C20 C/B GAP · C21 native app N/O

## Re-tests
1. **Self-pass: [own data].** Dev owned the build tasks for two steps and passed their UAT business checks himself. *(Lead note: the R15 rule blocks passing a test you ASSIGNED to yourself; "the builder can't pass tests on their own work" is a new separation-of-duties requirement, not a regression. Still a real pilot blocker.)*
2. **Move out: PARTIAL [own data].**
   - Fixed: second Admin, phone code, logging; the Departments label is gone.
   - Not fixed: Sam's IT approval from before the move still counts on Launch, while the checklist says "Choose who approves IT".
   - The pending move doesn't appear in the second Admin's Waiting for you or notifications.
3. PM hand-over: FIXED [own].
4. Launch-owner change: FIXED [own].
5. Phantom PMO part: FIXED [own].
6. Refusals in History: FIXED [own]. The logged reason differs from the on-screen reason.
7. Blocked joiner told why: FIXED [own].
8. Phone: FIXED [own].
9. Late wording: not reproduced [sample].
10. Audit verify: PASS [own].

## New defects (all own data)
- The parser missed "Carrier Integration Engineer" as the doer, turned roles into teams, dropped member ID and dependent SSN, and loses a pasted draft on reload.
- Adjust plan shows "Maya Chen" in the owner box of tasks marked "Needs an owner".
- Approval pages say "WHAT CHANGED IN YOUR PART: No steps" for teams that own changed or new steps.
- A brand-new department with no members has no way to get its tests passed.
- No overlap warning when a second project is created on the same process (it only appears once both have plans).

## Disagreements
1. IT: Launch says "1 of 2 approved (Sam)" while the checklist and report say "Choose who approves IT" [own; the same pattern shows in a sample project].
2. Member Services approver: a pop-up says Sam will approve, while the part page says nobody can and the checklist says choose [own].
3. Run dates show UTC (Nov 19) instead of local time (Nov 18, 10 PM) [own].
4. Environment "sit" is called a "Dev run" in History [own].
5. The checklist names Ana for the launch-day plan, but only the PM can edit it [own].
6. "Finish the work ✓" shows while 7 tasks are done-not-confirmed [own].

## Top 5
1. A step's build-task owner can't pass that step's tests; the approval page shows who did the work.
2. A move out reopens that person's sign-offs; Launch, the checklist and the report agree.
3. Each team's approval page shows its changed steps and information; roles map to departments at parse time.
4. Pending second-Admin confirmations go in Waiting for you; empty departments get a clear path.
5. Local time, consistent environment labels, and an overlap warning when a project is created.
