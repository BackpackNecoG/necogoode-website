# Expert 2 (BPM/BA practice lead): R12 re-review

## Verdict
- Demo: yes.
- Paid pilot: yes, $2.5k.
- Contract: not yet. If it converts, roughly $7.8k/yr for 10 editors on Business.

## Scorecard (capability / ease)

| Category | Grade | Flag |
|---|---|---|
| C1 | B+/B | |
| C2 | A-/A | ONLY |
| C3 | B/B | ONLY |
| C4 | B/B | ONLY |
| C5 | B/B | |
| C6 | B/B | GAP (no BPMN canvas) |
| C7 | C+/B | |
| C8 | B+/A | ONLY |
| C9 | B/B | |
| C10 | B/B | ONLY |
| C11 | B-/C | |
| C12 | B/B | |
| C13 | B+/B | ONLY |
| C14 | A-/B | ONLY |
| C15 | C+/B | GAP |
| C16 | C/C | |
| C17 | not tested | |
| C18 | **C** (was D+) | |
| C19 | A/A | ONLY |
| C20 | **B/B** | ONLY vs. competitors' sales-led buying |
| C21 | Process mining: N/O | |
| C22 | Repository / governance: C | GAP |

## Fixed

- No department is pre-selected.
- An AP-only edit reopens only AP, and the reason shows from→to.
- The timer lands on the right step, both on paste and on BPMN import.
- The under-$50k branch now skips the Credit Manager.
- The Save click works the first time.
- Observed valid values are no longer rejected.
- Timers appear consistently in the diff.
- VSDX import: start/end become events, the decision becomes a choice, no duplicate connectors.
- Home, Processes and diff agree on 4 new · 6 changed · 1 removed.
- No internal IDs are visible.

## Still failing

1. **Departments are a fixed list** (AP, Compliance, IT, PMO, Procurement, Treasury). There is no way to add Sales, Credit, AR or Controller, so a credit process can only be routed to a wrong department. Admin invites have no department field either. (Karen hit the same problem.)
2. **No uniqueness test is generated.** The profile flags "2 of 12 account numbers repeat… spec says unique", but Generate produced 21 cases and none checks duplicates. *H1 claimed this was done: verify the page/generator wiring.*
3. **No cross-vendor checks.** A shared bank account across vendors and near-duplicate names (Acme Supply Inc vs ACME Supply Inc.; Fabrikam Metals vs Fabrikam Metal Works) aren't caught on the page. *H1 claimed the engine handles this: verify the wiring.*
4. **"Controller (Sam Wu)" and "Sam Wu signs off" become two actors,** with separate lanes and RACI columns.
5. **RACI only fills R.** "Signs off" becomes R, not A, and no A, C or I appears anywhere. The matrix shows 9 rows for 10 steps (Wait is omitted).
6. **The two views apply different approval-readiness rules.** Simple says Procurement is "Not ready… waiting on 3 tests". Advanced let Nina approve AP with 0 of 28 tests passed, and let Rosa approve with 1 of 4.

## Other findings

- The work-item re-approval reason has no from→to.
- Procurement's reasons list shows "Vendor Onboarding (process edited)" after an AP-only edit. Cosmetic.
- BPMN import says "Dropped 0", but "Escalate to CFO" was folded into a timer. That should be disclosed.
- The start event defaults to "Process starts".
- Data extraction missed requested limit, payment history and risk score.
- Masked examples keep word shapes plus first and last letters, which is weak masking for names (Unverified).

## Mismatches

1. Testing headline says "9 of 47" while the advanced view shows 35 cases + 18 scripts = 53.
2. The gate says "All 7 spec fields covered" while the matrix shows 5 UNCOVERED with 10 fields missing.
3. Launch: simple shows "6 steps left", advanced shows "9 checks not passed".
4. Approval cards disagree between simple and advanced: "Not ready" vs "approve again", and "Ready" vs "Waiting".
5. Teams Involved disagrees with the approver panel:
   - credit: 3 vs 4 (Controller is missing);
   - vendor: 8 (systems such as Email/Teams, Contract repository and Risk are listed as teams) vs 5.
6. Launch shows AP 28 and Treasury 32 tests, while Testing shows 47 in total.
7. "Who acts" lists 2 people on Home and 3 on Portfolio.
