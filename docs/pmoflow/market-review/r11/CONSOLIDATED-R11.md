# PMOFlow R11 re-review: consolidated against the fixed acceptance bar

**Build:** 956c095. **Reviewers:** the same four personas. Full detail is in `karen.md`, `jordan.md`, `expert-pmo.md` and `expert-bpm.md` alongside this file.

## 1. Fixed bar (unchanged since R10)

| Criterion | R10 | **R11** |
|---|---|---|
| No contradictions between screens | FAIL | **FAIL.** Fewer, but every reviewer still found some: testing counts, approver identity in history, access status, owners of unowned tasks, launch counts |
| C20 Trust/buying path ≥ B for all four | D / C / C+ / B | **C / C / B / C.** Still FAIL. The BPM expert reached B because a published $2.5k pilot beats contact-sales; the solo-founder concern holds the others at C |
| C18 Enterprise readiness ≥ C+ | D / D / D+ / C | **D / D / D+ / D.** FAIL: no SOC 2 or pen test before 2027, no SCIM, IT must deploy into Azure even on Team |
| Both search buyers book a demo | PASS | **PASS** |
| Both experts confirm a pilot path | PASS | **PASS.** All four would run the $2.5k pilot |
| No consensus Ease drop | PARTIAL | **PASS.** C5 recovered (Karen D/C → B/A). Ease held or rose elsewhere |

## 2. Deal picture

| Reviewer | Demo | Pilot ($2.5k) | Contract | Size if it converts |
|---|---|---|---|---|
| Karen | Yes (low urgency) | Possibly | Not yet | Team, 2–3 editors, ≈ $1.1–1.6k/yr |
| Jordan | Yes | Yes | Not yet | Business, 8 editors, ≈ $6.2k/yr |
| BPM expert | Yes | Yes | Not yet | Business, about 8 editors, ≈ $6.2k/yr |
| PMO expert | Yes | Yes | Not yet | Business, 15 editors plus 60 free approvers, ≈ $11.7k/yr |

**Net: 4 of 4 demo, 4 of 4 pilot (was 3 of 4), 0 of 4 contract.**

The contract blockers are now almost entirely **trust and enterprise**: no SOC 2 or pen test before 2027, solo founder, IT must deploy to Azure, no reference customer. The product blockers that remain are below.

## 3. Ranked fixes for R12 (by how many reviewers hit them, then severity)

1. **Approval routing to the wrong department (3 of 4).**
   - Karen's process had Purchasing, Credit, AP and Treasury teams; only "Procurement" was asked to approve. The BPM expert's Credit/AR/Sales process routed its only approval to Procurement. The "Tell affected teams" message names Procurement in both.
   - **Map step teams to approving departments explicitly, shown at import and editable. Never use a default team.**
   - An AP-only edit also reopens Procurement's approval. **Reopen only the departments whose section changed, and say from→to.**
2. **Audit and approver identity are not truthful (2 of 4).**
   - Status cards say Rosa/Sam approved; History says Maya/Dev, who own steps.
   - The seeded history still contains sign-offs that the rule forbids.
   - `actorName` is not part of the hash.
   - CSV exports can't be verified.
   - **Re-seed history so it obeys separation of duties, record the real approver, hash actor identity, and verify CSV.**
3. **Jira/ADO sync bypasses governance (PMO expert, severe).**
   - An inbound "Done" closed a defect while its test was still failing, marked information live with no evidence, flipped status to On track and cut the expected cost.
   - **Inbound status may move work items only. Defects, information availability and approvals never change from sync. The external actor is logged.**
4. **Tests anyone can pass (Jordan).** An AP lead bulk-passed Compliance's sanctions tests because they were "assigned to no one". **Restrict passing a test to people in that test's department or its assignee. Require step-up for bulk passes and for approving a plan change.**
5. **Testing counts still disagree (4 of 4).**
   - Simple "Try it out" shows the same line as Business check. Advanced shows 7/8. The run header says 9/32. The report says 14/1.
   - Coverage summary vs matrix vs gate.
   - UAT denominator doesn't move after generating cases.
   - Approver "not changed" list contradicts the diff.
   - Launch says "Blocking 12" vs Testing 0/9.
6. **Ownership falls back to the project manager (3 of 4).**
   - "Needs an owner" tasks show on every screen as Maya's, while the Work tab shows "—".
   - Changed steps go to the PM instead of role → person.
   - Step owners differ between the map and the project.
7. **Other count/label disagreements:**
   - Home "0 steps" vs 12.
   - Portfolio "6 launch steps left" vs Launch "9 checks not passed".
   - "Steps" vs "checks" wording.
   - Report week Tue vs Mon.
   - Weekly report misses the plan change it just showed.
   - "Since last report" date.
   - Lateness 6 vs 1.
   - Workload 1 vs 2 late.
   - "Behind on effort" counted as "late" while expected early.
   - ERP CPI 0 with expected cost under budget.
   - Expected cost $21,300 shown with no rates.
   - Access status "Closed" vs "2 open", plus desktop vs phone.
   - Access approver Tom vs Leo.
   - 33 days vs 30 max.
   - UTC vs local launch date.
   - Dave labelled "sponsor".
   - "Not checked yet" vs "not available yet".
   - Internal IDs leak ("section:…#s:…").
   - Phone spacing ("Late1", "Blockingholds").
8. **Parser control flow (BPM expert, Karen).**
   - SLA timer attached to the wrong step.
   - "Under $50k" branch doesn't skip manager review.
   - "If spend over $25k X approves too" not modelled as an approval.
   - Inline roles ("Purchasing mgr", "Credit dept") missed.
   - Documents named in text missed.
   - A, C and I in RACI never pre-filled.
   - VSDX: Start/End become steps, duplicate connectors listed, a decision becomes parallel.
9. **EV against baseline (PMO expert).** A budget change moved CPI/SPI instantly. EAC when CPI = 0 must be ≥ spent and use the remaining estimate.
10. **Launch-day plan.** A step can be set on Christmas or outside the window and still show "Ready". The override isn't in the summary. Make the two-person override discoverable.
11. **Profiling depth.**
    - Shared bank account across vendors (fraud flag), near-duplicate names and whitespace aren't caught.
    - Observed valid shapes are marked "reject".
    - No uniqueness test is generated from a duplicate warning.
12. **UX papercuts:**
    - The first Save click is swallowed after typing an owner.
    - The pricing estimator accepts 0, negative numbers, and 30 on Team.
    - The rate-limit message contradicts itself.
    - The phone access table hides columns.
    - No custom date range for reports in Simple.
13. **Cross-project change.** A knock-on moved a task in ERP, but ERP's change log is empty and its PM wasn't asked.

## 4. Founder decisions raised by the reviewers

- **Team plan hosting (3 of 4):** "IT must deploy into our Azure" makes IT a gatekeeper even for the $45 Team plan. See the recommendation in the chat summary.
- **Planner sync (Jordan, PMO expert):** M365 shops already pay for Planner, and Project Online was retired on Sep 30, 2026 (reviewer research).
- **Recurring process runs (Karen, twice):** run each vendor onboarding as its own tracked checklist. It's a different product motion (process execution).
- **Reference customer:** every reviewer asked for one.

## 5. Positioning

The enterprise PMO expert holds firm on "companion to Jira/ADO", but only once sync can't bypass the gates. The BPM expert compares PMOFlow against Signavio, Promapp and Lucid and says it "beats them on the cases I care about". Karen, a mid-market buyer without Jira, is standalone. The "bring your tools or start fresh" positioning still fits all three.
