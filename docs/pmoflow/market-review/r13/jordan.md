# R13 re-review: Jordan Reyes (PMO Coordinator, Crestline Benefits, arrived from search)

## Verdict
- **Demo:** yes.
- **Paid pilot:** likely, $2,500 on one benefits-enrollment change.
- **Contract:** not yet. It would be Business, 8 editors × $65 × 12 = $6,240/yr, approvers free.
- **Blockers:**
  - No SOC 2 or pen test.
  - A development signing key, and fingerprints computed at view time.
  - SCIM is only planned.
  - The admin department-move hole.
- **What would tip it:** two-person, step-up department and approver changes that apply only to future approvals, plus a pen-test letter.
- **Search note:** "PMOFlow necogoode process map PMO" did not surface the product.

## Scorecard (PMOFlow capability/ease)
C1 B/B · C2 A/A ONLY · C3 A/B ONLY · C4 A/B ONLY · C5 B/B GAP · C6 B/B GAP · C7 C/C GAP · C8 A/A ONLY · C9 B/B GAP · C10 A/B ONLY · C11 B/C · C12 B/B · C13 B/B ONLY · C14 A/B ONLY · C15 C/B GAP · C16 C/B GAP · C17 C/C GAP · C18 D/N-O GAP · C19 B/A · C20 C/B GAP · C21 native mobile N/O GAP · C22 mining/repository N/O GAP (by design)

## Re-tests
1. **Self-assignment: mostly closed.**
   - Assigning a Sanctions test to herself got a 403, but **with no on-screen message**.
   - Ana could still self-assign IT tests; she then couldn't pass them.
   - **NEW HOLE:** Admin Maya moved Ana into Compliance in one click. Ana then passed all 4 Sanctions tests and became an eligible Compliance approver.
2. **PM self-approval: closed.** Tom naming himself sponsor in Settings is silently ignored.
3. **Deadline in Settings: locked.**
4. **Test counts: partly fixed.**
5. **Report vs Launch: fixed.**
6. **Launch history: partly fixed.** "1 exception", but the summary is all green.
7. **Import: fixed.**
8. **Phone: better.** Launch has 93/125 controls under 32px; Testing has 51/119.

## Extras
- The weekly report is strong, but Dave Ortiz has an ask and isn't on the email list.
- The audit chain verifies, and a tampered file gives "Chain broken at entry 6". But fingerprints are computed when viewed or exported, and refused actions (403s) don't appear in History.

## Disagreements
1. Launch says "6 steps left" while 9 checks are red or amber; Portfolio says "9 checks not passed".
2. Run row "9/32 cases + scripts" vs header "9/26"; report "9 passed, 1 failed (now 7 of 8)".
3. "Tom (its project manager) approves too", but only Maya approves; the label stays on the applied record.
4. Sponsor shows as Tom in Settings and History, Maya in the change, and Tom as "project manager; sponsor" in People affected.
5. Departments "Approves: Dave Ortiz, Maya Chen" vs Launch "switch to Ana Ruiz, Dave Ortiz".
6. An override launch with 0/1 launch-day steps done shows "10 PASS", including "Launch-day plan is ready". History says "1 exception" for two overrides.
7. Visio "Dropped elements 0", but the decision "Documents complete?" disappeared (3 steps, 0 choices).
8. Report "17 business days (Dec 7 → Dec 31)" vs plan change "+14 (Dec 10 → Dec 31)".
9. Knock-on rows "Nov 27 → Dec 17" vs task list Nov 17–23; forecast and planned dates unlabelled.
10. A pending ERP change still says "Dec 11 → Feb 3" after a knock-on moved ERP to Dec 24.
11. Settings shows expected cost $48,847 vs $48,000 budget with no warning.

## Top 5
1. Department and approver changes become a two-person, step-up action; a recent move grants no rights on in-flight parts.
2. Refusals shown on screen; denied attempts recorded in History.
3. The launch summary shows an Override badge and lists every overridden condition; never "launch-day plan ready" with an open step.
4. One count across screens (steps left vs checks, 26 vs 32, "approves too").
5. Phone tap targets on Launch and Testing; the PM can't be picked as his own sponsor.
