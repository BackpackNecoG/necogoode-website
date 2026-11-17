# PMOFlow golden numbers (R10, stream S1)

This is the worked example. It gives the value of every number on every screen for two seeded projects on the day the sandbox is made (seed day 0):
- **Vendor Onboarding Modernization** (`vendor-modernization`);
- **ERP Upgrade Readiness** (`erp-upgrade-readiness`).

`tests/pmoflow/e2e-consistency.js` asserts these values on the screens, exactly as written here. An engine test (`R10 golden numbers`) asserts the same values against `E().projectTruth` and the other functions named below.

## How to read this

- **Counts, money, percentages and labels don't depend on the seed day.** Every seeded date is a business-day offset from the seed day, counted with the engine's calendar (weekends and US federal holidays skipped), so the gap between any two seeded dates is always the same. These values are asserted literally on any business day.
- **Calendar dates do depend on the seed day.** They are written below as business-day offsets ("seed + 29 bd"), followed by the value when the seed day is the reference day, **Tue Nov 17 2026**.
- **A seed day that falls on a weekend or holiday** shifts planned value by up to one day. SPI and the buffer can then differ by about 0.01 and 1 day. The e2e checks the seed day: on a weekend or holiday it asserts those two values against the engine instead of the literals.
- **"bd"** means business days.
- **Simple** is the default mode. **Advanced** is the "Advanced tools" view.

## Shared definitions (one function each)

| Number | Single source | Rule |
|---|---|---|
| Change count | `changeSummary(process or project)` | `{added, changed, removed, text}`. New, changed and removed nodes all count, including waits, messages, calls to other processes and choices. `text` is the one phrase every screen shows, e.g. "5 new · 6 changed · 1 removed". |
| % done | `projectTruth.pctDone` (= `earnedValue.pct`) | The share of the budgeted work that is done, so EV = budget × pctDone. The tile shows `round(pctDone × 100)`. |
| SPI / CPI / EAC | `projectTruth.ev` | SPI and CPI show "—" until some work has started (a task is done, or has progress logged, so EV > 0) **and** actual cost > 0. EAC shows "—" whenever CPI is blank. |
| Expected cost | `projectTruth.cost.forecast` | EAC once CPI exists. Before that, the bottom-up estimate (`forecastBasis: 'estimate'`). |
| Late | `projectTruth.lateCount` + `lateText` | "5 late (1 past due, 4 will finish after their due date)". Simple, Advanced and the status report use the same text. |
| Status label | `projectTruth.label` | When SPI < 0.9, the reasons include "Behind on effort: N% of the work planned by today is done", and a project that would otherwise be green reads "Behind on effort", never "On track". |
| Testing | `projectTruth.testing` | `needTests` = information the project changes. `haveTests` = the pieces of it that have cases **and** a case for every rule field. Total = cases + business-check scripts. Both stage tiles use that one denominator. |
| Launch date | `projectTruth.launch` (`launchDate`) | The launch window's day when one is set, otherwise the deadline. Shown the same way on the Launch page and on the dashboard's "Upcoming launches". A window on a weekend or holiday is refused. |
| Business days | `addBusinessDays`, `businessDaysBetween`, `isBusinessDay` | These skip weekends, the US federal holidays (observed dates), and the workspace's own `calendar` doc. |

## Vendor Onboarding Modernization

### Dates

| Value | Offset | On Nov 17 2026 |
|---|---|---|
| Deadline (`project.target`) | seed + 29 bd | **Wed Dec 30** |
| Launch window (`launch.date`, source `window`) | deadline − 1 bd | **Tue Dec 29**, 7:30–10:00 AM |
| Expected finish (`forecastFinish`) | seed + 15 bd | **Wed Dec 9** |
| Buffer | — | **14 business days** to spare |
| "Set up the bank details form" was due | seed − 1 bd | Mon Nov 16 |

None of these dates is a weekend or a holiday. The launch window has `problem: null`.

### Status and schedule (Home card, project header, projects list, portfolio, status report)

- **Label:** Some tasks late (amber).
- **Sentence:** "Expected Dec 9, 14 business days before the Dec 30 deadline. 5 tasks are late; first: “Set up the bank details form” (Leo Park)."
- **Tasks:** **7 of 13** done (6 open).
- **% done:** **48%**. EV 23,258.28 ÷ budget 48,000 = 0.4845.
- **Late:** **5 late (1 past due, 4 will finish after their due date)**. Simple and Advanced show the same split.
- **Blocking:** **0**. Bank remittance details has planned work (W6), so it is not an unplanned blocker.
- **Reasons, in order:**
  1. "5 tasks late (1 past due, 4 will finish after their due date), but the finish still meets the deadline"
  2. "Behind on effort: 80% of the work planned by today is done"
  3. "Bank remittance details is not available yet; work is planned to get it"
- **Who needs to act (7):**
  1. Leo Park: Finish “Set up the bank details form” (was due Nov 16)
  2. Dev Kumar: Get “Save new vendors in the ERP automatically” back on schedule
  3. Leo Park: Fix the problem: “The bank details form accepts a blank account holder”
  4. Dev Kumar: Get “Check bank accounts with a small test deposit” back on schedule
  5. Ana Ruiz: Get “Check the payment account when matching invoices” back on schedule
  6. Dave Ortiz: Approve Compliance's part
  7. Tom Alvarez: Add tests for 1 new piece of information

  The header card shows 5 rows. "+2 more" opens the last two in place, and each links to its own page (the approval to the Launch page, the tests to Testing).

### Money (Advanced header, dashboard Earned value, portfolio)

| Value | Amount |
|---|---|
| Budget (BAC) | $48,000 |
| Planned value (PV) | $28,913.91 |
| Earned value (EV) | $23,258.28 |
| Spent (AC) | $23,668.75 |
| SPI | **0.80** |
| CPI | **0.98** |
| EAC = Expected cost | **$48,847.12**, over budget by $847.12 |
| Bottom-up estimate | $45,300 |

### What changes

| Scope | Phrase |
|---|---|
| Vendor Onboarding (Home process card, new-project dialog) | **5 new · 6 changed · 1 removed** (10 steps in the Future map) |
| Invoice Approval | **2 new · 3 changed** (4 steps) |
| The project (both processes) | **7 new · 9 changed · 1 removed** |

The removed step is the Today step "Print and file the bank letter".

### Testing (Testing page, Launch page, project checklist)

- **Big number:** **12 of 26** tests passed (1 failed, 13 not run).
- **Information that needs tests:** 2. **Has tests:** **1 of 2**. Bank remittance details has no cases for "Bank name" and "Account number".
- **Next:** "Add tests for 1 new piece of information". The step "Add tests" is **not** done.
- **Stages:** Try it out **7/8** (1 failed). Business sign-off **9/26**. Advanced coverage tiles show the same two numbers.
- **Per team:**

  | Team | Passed | Total | Failed | Not run |
  |---|---|---|---|---|
  | Accounts Payable | 3 | 7 | 1 | 3 |
  | Compliance | 9 | 9 | 0 | 0 |
  | IT | 0 | 4 | 0 | 4 |
  | Procurement | 1 | 4 | 0 | 3 |
  | Treasury | 3 | 11 | 1 | 7 |

- **Go-live check:** "tests not passed yet". It never reads "Tests passed" next to ✕.

### Steps to launch: 1 of 7 done, 6 left

1. ✓ Plan the work.
2. Finish the work: 6 tasks still open.
3. Information available: 1 piece of information is not available yet (Bank remittance details); 1 new requirement found during the work needs a decision.
4. Tests passed: "Add tests for 1 new piece of information".
5. Each team approved its part: "Waiting for Compliance to approve its part. Accounts Payable, IT and Treasury approve their parts once the work on them is done. Procurement must approve again after changes."
6. Launch-day plan ready: not done (no undo plan yet).
7. Launch: "Close the open temporary data access requests".

**Approvals:** only Compliance is ready, so only Compliance's approver (Dave Ortiz) is asked. The other parts are not asked until their work is done.

## ERP Upgrade Readiness

### Dates

| Value | Offset | On Nov 17 2026 |
|---|---|---|
| Deadline | seed + 41 bd | **Tue Jan 19 2027** (Christmas, New Year's Day and MLK Day skipped) |
| Launch date (`launch.date`, source `deadline`; no launch window yet) | — | **Jan 19** on the Launch page and the dashboard |
| Expected finish | seed + 16 bd | **Thu Dec 10** |
| Buffer | — | **25 business days** |

### Status and schedule

- **Label:** On track (green).
- **Sentence:** "Expected Dec 10, 25 business days before the Jan 19 deadline. Bank remittance details is not available yet; work is planned to get it (Leo Park)."
- **Tasks:** **0 of 2** done. **% done: 0%.**
- **Late:** **0**. `lateText` is "Nothing late". The facts line reads "0 late".
- **Blocking:** **0**.
- **Reasons:**
  1. "On track: 25 business days of buffer"
  2. "Bank remittance details is not available yet; work is planned to get it"
- **Who needs to act (2):**
  1. Leo Park: Get Bank remittance details ready
  2. Tom Alvarez: Add tests for 1 new piece of information

### Money

| Value | Amount |
|---|---|
| Budget | $9,000 |
| PV | $415.38 |
| EV | **$0** (nothing done, no progress logged) |
| Spent (AC) | $1,406.25, hours logged on the in-progress task |
| SPI | **—** (work has not started) |
| CPI | **—** |
| EAC | **—** |
| Expected cost | **$5,000**, the bottom-up estimate |

This replaces the R9 contradiction of "On track" next to SPI 0.00 and CPI 0.00.

### What changes

**5 new · 6 changed · 1 removed** (Vendor Onboarding).

### Testing

- **0 of 20** tests passed (20 not run). Has tests: **1 of 2**.
- **Next:** "Add tests for 1 new piece of information".
- **Stages:** Try it out **0/8**, Business sign-off **0/20**.

### Steps to launch: 1 of 7 done, 6 left

- Approvals: "Accounts Payable, Compliance, IT, Procurement and Treasury approve their parts once the work on them is done." Nobody is asked yet.

## Other screens

- **Home process cards:**
  - Vendor Onboarding: "10 steps · 5 new · 6 changed · 1 removed · 🔒 1 not available yet".
  - Invoice Approval: "4 steps · 2 new · 3 changed".
  - Quarterly Access Review: "3 changed".
  - Expense Reimbursement: "1 changed".
- **Dashboard, Upcoming launches** (sorted by launch date):
  1. Quarterly Access Review Automation, launch day seed + 7 bd (**Fri Nov 27**).
  2. Vendor Onboarding Modernization, launch day **Dec 29**.
  3. ERP Upgrade Readiness, deadline (no launch day set) **Jan 19**.
- **Holiday calendar** (`holidays(docs, {today})`): 33 federal holidays for 2026–2028, plus the workspace's own. Thanksgiving is Nov 26 2026 and Christmas is Dec 25 2026.
- **A new project from Expense Reimbursement** (before Accept): the Steps to launch card shows **"No plan yet"**. It never shows "1 of 7 done" or "Information available ✓".

  The suggested plan:
  1. "Implement changes: Submit receipts in the expense app", owned by **Tom Alvarez**. The note says the step is done by the role "Employee".
  2. "Tell affected teams about the change" (Tom Alvarez, 1 day).
  3. "Train the people who do the changed steps" (Tom Alvarez). It starts after task 1 finishes.

  No task is owned by a bare role, and no task starts before its prerequisite finishes.
