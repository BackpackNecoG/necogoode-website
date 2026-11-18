# R15 re-review: Jordan Reyes (PMO Coordinator, Crestline Benefits)

## Verdict
- **Demo:** yes. His R14 blockers are fixed: two-person step-up role changes, the joiner rule on approvals and co-signs, and no self-pass anywhere.
- **Paid pilot:** yes, $2,500, on the benefits enrollment change.
- **Contract:** not yet ($6,240/yr).
- **Blockers:**
  - Pen test and SOC 2 are planned only.
  - Development key.
  - SCIM.
  - **A moved-out approver keeps signing.**
  - **The launch owner changes in one click.**
  - **A phantom PMO approval.**
  - **Refusals still missing from History.**
- **What tips it:** moves revoke approver rights and stale approvals; launch-owner changes need approval; refused attempts are logged; a pen-test letter.

## Scorecard (PMOFlow)
C1 B/B · C2 A/A · C3 A/B · C4 A/B · C5 B/B GAP · C6 B/B GAP · C7 C/C GAP · C8 A/A · C9 B/B GAP · C10 A/B · **C11 B/B (was B/C)** · C12 B/B · C13 A/B · C14 A/B · C15 C/B GAP · **C16 B/B** · **C17 B/B (was C/D)** · C18 D/C GAP · C19 B/A · C20 C/B GAP · C21 native app N/O

## Re-tests
1. Self-pass: FIXED in every environment. Self-assigning still succeeds with no warning.
2. Role change and moves: FIXED (second Admin and step-up; joiners blocked). **NEW:** Sam moved *out* of IT still re-approved IT and co-signed the override, and Departments still says "IT approves: Sam Keller".
3. PM hand-over: FIXED (needs approval). **NEW:**
   - It was routed to Ana, an Admin for about 20 minutes who is on the team.
   - The new PM changed the Launch owner in one click.
4–7. FIXED.
8. Import: works.
9. **Phone: FIXED** (Launch 4/114, Testing 4/108 under 32px). Project tabs are still 30px.
10. Weekly report: FIXED.
11. Audit verify: PASS. **Refused self-passes are absent from History: NOT FIXED.**

## Disagreements
1. **Phantom PMO part** after a PM hand-over:
   - Launch shows a PMO part with "Approver chosen: Maya".
   - The PMO page says there's nothing to sign.
   - The report asks Maya to approve.
   - Maya approved it and it counted.
2. After the override launch: the summary says "Approved by Dave and Sam"; the panel says "1 approved before launch".
3. The Try it out record dialog lists Bank TC1–3 as Not run vs "7 of 8 passed" vs Compliance "3 pass 1 fail".
4. "Everything is done…" directly above "Ready except: the launch window opens…".
5. Late wording: Home "Late by 4 business days · due Dec 4"; the report "late by 6 business days (was due Nov 17)".
6. Override reasons listed under "CHANGED AFTER AN APPROVAL".

## Top 5
1. A move out of a department revokes approver status and reopens that person's approvals; fix IT "Approves: Sam" with no members.
2. No phantom PMO part after a hand-over; never count an approval of an empty part.
3. A launch-owner change is a plan change; don't route hand-over approvals to Admins who just joined.
4. Write refused attempts (self-pass, scripted disabled actions) to History.
5. The Try-it-out dialog and the post-launch approvals panel match; tell a blocked joiner why.
