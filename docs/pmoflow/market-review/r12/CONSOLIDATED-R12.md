# PMOFlow R12 re-review: consolidated against the fixed acceptance bar

- **Build:** ae88a8d.
- **Reviewers:** the same four personas.
- **Details:** `karen.md`, `jordan.md`, `expert-pmo.md` and `expert-bpm.md` in this folder.

## 1. Fixed bar (unchanged)

| Criterion | R10 | R11 | **R12** |
|---|---|---|---|
| No contradictions between screens | FAIL | FAIL | **FAIL.** Fewer each round. The rest cluster in **testing counts**: report sums runs; 26 vs 32; coverage "7/7" vs matrix; launch "6 steps" vs "9 checks" |
| C20 Trust/buying path ≥ B for all four | D/C/C+/B | C/C/B/C | **C / C / B / C.** FAIL: solo founder, no reference, no SOC 2 or pen test until 2027 |
| C18 Enterprise readiness ≥ C+ | D/D/D+/C | D/D/D+/D | **D / D / C / D.** FAIL: same reasons, plus the Team plan needs an Azure deploy |
| Both search buyers book a demo | PASS | PASS | **PASS** |
| Both experts confirm a pilot path | PASS | PASS | **PASS** |
| No consensus Ease drop | PARTIAL | PASS | **PASS** |

**The remaining failures are mostly not code.** C18 and C20 are held down by:
- vendor size;
- SOC 2 and pen-test timing;
- no customer references;
- the Team plan's IT/Azure requirement.

Code can still move "no contradictions", plus a part of C18: SCIM, and keeping the Team plan free of any Azure deploy.

## 2. Deal picture

| Reviewer | Demo | Pilot $2.5k | Contract size |
|---|---|---|---|
| Karen | Yes | Only if custom departments ship, unowned work isn't shown as the PM's, and the Team plan needs no Azure | Business, ~8 editors, ≈ $6.2k/yr |
| Jordan | Yes | Yes | Business, ~5 editors, ≈ $3.9k/yr |
| PMO expert | Yes | Yes | Business, ~25 editors, ≈ **$19.5k/yr** |
| BPM expert | Yes | Yes | Business, ~10 editors, ≈ $7.8k/yr |

**Confirmed fixed by the reviewers this round:**
- Audit forgery: all 11 attacks were rejected.
- Approver identity matches across screens.
- Re-approval is scoped to the department and shows from→to.
- Sync holds a defect or info-making task "In review" instead of closing it.
- The cross-project knock-on is logged and approved.
- Parser control flow: timer placement, the threshold skip, and VSDX.
- The two-person override can be found.
- The access table is correct.

## 3. Ranked R13 fixes

1. **Configurable departments (Karen, BPM expert: top blocker for both).**
   - Customers define their own departments (Purchasing, Credit, AR, Sales, Operations, Controller…).
   - An "Add a department" control lives inside the approver panel.
   - Departments have named approvers, and Admin assigns people to departments.
2. **One testing ledger (all 4).**
   - The report counts each test's **latest** result, not the sum of runs.
   - One total everywhere: 26 vs 32, 47 vs 53, the Launch per-team totals, and the "Tests blocking 18" gate number.
   - The coverage summary equals the matrix.
   - Simple and Advanced launch use one phrase and one number.
   - Show **who passed each test** on the approver page.
3. **Separation-of-duties loopholes (Jordan, PMO expert).**
   - Self-assignment across departments: only that department or the PM can assign a test, and the person who assigned a test can't pass it.
   - A plan change past tolerance (deadline breach) needs the **sponsor**, never the requesting PM. A person holding two approver roles counts once.
   - Simple and Advanced must apply **the same approval-readiness rule**. In Advanced, approving with 0 of 28 tests passed was possible.
4. **Unowned work shown as the PM's (Karen: regressed).**
   - After Accept, the header, Home, the report's asks, the launch list and step cards still show Maya.
   - The Edit dialog preselects Maya.
   - "On track" is shown while most tasks are unowned.
5. **Inbound sync still bends forecast and EV (PMO expert).** An out-of-order Done (predecessor still open) cut EAC by $11.8k and pulled the finish date in. Held, out-of-order or unverified inbound statuses must not move the forecast or EV.
6. **EV (PMO expert).**
   - Planned value comes from the baseline. Today a slip *raises* SPI.
   - Knock-on moves must update dates.
   - A scope change that adds cost must raise EAC.
   - No expected cost when there are no rates ($30k showed with nothing entered).
7. **Profiling and fraud checks (BPM expert).** The engine reportedly has these, so check that the page and the generator use them:
   - a generated uniqueness test from duplicate warnings;
   - a cross-vendor shared bank account;
   - near-duplicate names;
   - name masking that hides more than first and last letters.
8. **Identity and RACI (BPM expert).**
   - "Controller (Sam Wu)" and "Sam Wu" are one actor.
   - "signs off" and "approves" map to **A**; consulted/informed phrases map to C and I.
   - The matrix includes Wait steps.
9. **Parser (Karen, BPM expert).**
   - An unnumbered "if … X approves too" line becomes a choice plus an approval, never a note. "N lines → N steps" counts it.
   - Compound lines ("Vendor sends…; Treasury calls…") split into owned steps.
   - "Check OFAC/sanctions list" is a step, not information.
   - Fields like "requested limit", "payment history" and "risk score" are extracted.
   - "Teams involved" lists teams only, not systems, and matches the approver panel.
10. **Removing a control step** (Karen) needs the owning team's approval and a "tell the team" notice.
11. **Reports (PMO expert, Jordan).**
    - "Since last report" uses exact timestamps.
    - A past custom range never leaks today's forecast.
    - Approvals that have gone stale are marked.
    - An override launch counts as an exception.
    - An inverted date range shows a message.
    - Approval and re-approval counts are correct.
12. **Re-approvals and held Jira items** appear on the approver's or owner's Home ("Waiting for you").
13. **Launch-day card** reads from the gate (a Christmas step must not say "Ready"). Holiday due dates are refused in Change the plan.
14. **Import entry points (Jordan).**
    - All three work: Map a process, /import, and the Processes button.
    - Errors are shown.
    - The Visio page name is kept.
    - Disclose folded elements (the "Escalate to CFO" task folded into the timer).
15. **Phone polish.** Minimum 11px secondary text, no truncated check labels, tap targets ≥ 40px.

## 4. Founder decisions (raised again, still open)

- **Team plan hosting:** raised by 3 of 4 reviewers. Recommendation: offer a hosted Team plan.
- **Planner sync:** recommended for the roadmap.
- **Recurring checklist runs:** Karen. Recommended: say "not for running a process each week" on the compare page.
- **Reference customer and pen-test timing:** these are now the top non-code blockers in every review.
- **Search visibility (Jordan):** PMOFlow didn't come up even for its exact tagline. The product pages were only indexed in R10, so this is expected to take time.

## 5. Positioning

The PMO expert: "Already using Jira? Keep the boards and add PMOFlow as the governance layer." Start-fresh loses for his organisation.

Karen (mid-market) and Jordan are fine with standalone.

The current "bring your tools or start fresh" copy serves both.
