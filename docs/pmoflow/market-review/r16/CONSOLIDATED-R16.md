# PMOFlow R16 market re-review: consolidated (build 7683c02)

This is the first round with tagged findings: **[own data]** (what a pilot would hit), **[sample data]** (fix the seed, not the product), and **[deliberate attack]** (contract or security readiness).

## 1. Outcomes

| Reviewer | Own pilot built | Demo | Paid pilot | Contract | Year 1 |
|---|---|---|---|---|---|
| Karen | Vendor onboarding, ~25 min, launch-ready | Yes | Likely | Not yet | $1,620–2,340 |
| Jordan | Benefits enrollment change, ~40 min | Yes | Yes | Not yet | $6,240 |
| PMO director | Contractor laptop provisioning | Yes | Yes | Not yet | $23,400 |
| BPM/BA | Credit-limit process, launched v1→v2 | Yes | Yes | Not yet | ~$6,200 |

**Where findings came from:**
- Almost every pilot-relevant finding is [own data].
- [sample data] findings were few (late-or-blocked card wording, one past-range line, one forecast-log date).
- Only the PMO director attempted [deliberate attack].

## 2. Own-data findings: what a pilot would hit (R17 scope)

Count = number of reviewers who hit it independently.

1. **Approvers sign a blank page (3: Karen, Jordan, BPM).** "What changed in your part: No steps." The lead fixed the cause in release.js (role-owned steps now map to the department via teamDepartments). It still needs the was→now detail and information, and a test.
2. **Procedure roles aren't linked to departments (3: Karen, Jordan, PMO).**
   - The AP lead can't confirm her own work.
   - Roles are parsed as teams.
   - Plan cards show "—".
   - Adjust shows "Maya Chen" in the owner box of unowned tasks.
   - Import puts the "(Name)" in the title and maps people to the wrong department.
3. **Stale evidence after a rule change (BPM, critical).**
   - A threshold change after passing doesn't invalidate the tests or reopen and rename the routing tasks.
   - Launch proceeds.
4. **Test scope and data controls (BPM, fifth round).**
   - Data feeding new or changed steps is excluded.
   - Uniqueness, shared-bank and duplicate warnings still make no tests.
   - "$260,000" isn't flagged.
5. **Separation of duties gaps (Jordan, Karen, BPM).**
   - A step's builder can pass its tests.
   - A move out doesn't reopen the person's prior sign-offs.
   - The test dialog lets someone tick a pass they can't give; the refusal comes only after step-up.
   - The tester list offers Approvers; their save fails silently.
   - Tom is assigned a business check he can't record.
6. **Hours and budget (PMO).**
   - Deleting a task deletes its hours.
   - "+ Add work item" adds cost with no plan change.
   - A suggested plan over budget or capacity gets no warning.
   - A knock-on that pushes another project past its deadline doesn't ask that project's sponsor.
   - A dependency added inside the deadline doesn't knock on further.
   - One expected-cost method.
7. **Launch flow (Karen, BPM):** saving the launch-day plan reopens approvals inconsistently, and the step order invites this.
8. **Counts and labels:**
   - "Finish the work ✓" while tasks are done-not-confirmed (3 reviewers).
   - UTC dates in History (2).
   - "late or held up" vs the Work tab.
   - APPROVED BY blank.
   - Step 9 vs 10.
   - "Team: Credit" vs Controller.
   - Raw ids in History.
   - Spent −$500 this week.
   - Report "resolved" and testing label going stale.
9. **Small UX:**
   - The import draft is lost on reload (2).
   - Pasting the 6-digit code fails silently.
   - "Go back to" a later step.
   - "Collected each run" can't be chosen after saving; bank letter and remit-to default.
   - A pending second-Admin confirm isn't in Waiting for you.
   - An empty department has no path.
   - No overlap warning on project create.
   - Invitees aren't counted at Launch.

## 3. Sample-data findings
Late-or-blocked card wording on ERP, one past-range concerns line, and the "Dec 7 vs Dec 8" forecast log. These are handled by the **seed rebuild** (R17, sequenced after the streams), not engine code.

## 4. Deliberate-attack findings (contract and security readiness, tracked, not R17 scope)
All found by the PMO director through the open demo API:
- forged actor and self-made step-up;
- anonymous delete (**closed by the lead in the R17 base**: deletes must name a workspace person, and refusals are logged);
- hours in someone else's name;
- a false `today`;
- Done backdated before the start;
- another sandbox readable by its ID.

The hosted sign-in binding (R16) is designed to close the identity items. It is **Unverified** against a real Entra tenant. These need a hosted-tenant test before any contract.

## 5. Non-code blockers (unchanged)
- SOC 2 or pen test.
- Solo vendor.
- SCIM.
- The Team plan's Azure deploy.
- Recurring per-vendor runs (Karen: 15 vendors a month).
