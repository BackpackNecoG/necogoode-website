# PMOFlow golden numbers (R10, stream S1; updated for R11 by G1)

This is the worked example. It gives the value of every number on every screen for two seeded projects on the day the sandbox is made (seed day 0):
- **Vendor Onboarding Modernization** (`vendor-modernization`);
- **ERP Upgrade Readiness** (`erp-upgrade-readiness`).

`tests/pmoflow/e2e-consistency.js` asserts these values on the screens, exactly as written here. An engine test (`R11 golden numbers`) asserts the same values against `E().projectTruth` and the other functions named below.

**R11 changes (G1):** blocking has one definition (`projectTruth.blocking`), so both projects show **1 blocking**; change counts count steps only (never choices); ERP's earned value shows 0.00 with "Spent with nothing finished" and reads "Behind on effort"; a test held by an open problem never counts as passed (Vendor Onboarding **9 of 26**); approver cards count coverage gaps (`perBU.checks`); every team has an eligible approver who does none of its steps and recorded none of its tests (its department head, an Approver on a free seat).

## How to read this

- **Counts, money, percentages and labels don't depend on the seed day.** Every seeded date is a business-day offset from the seed day, counted with the engine's calendar (weekends and US federal holidays skipped), so the gap between any two seeded dates is always the same. These values are asserted literally on any business day.
- **Calendar dates do depend on the seed day.** They are written below as business-day offsets ("seed + 29 bd"), followed by the value when the seed day is the reference day, **Tue Nov 17 2026**.
- **A seed day that falls on a weekend or holiday** shifts planned value by up to one day. SPI and the buffer can then differ by about 0.01 and 1 day. The e2e checks the seed day: on a weekend or holiday it asserts those two values against the engine instead of the literals.
- **"bd"** means business days.
- **Simple** is the default mode. **Advanced** is the "Advanced tools" view.

## Shared definitions (one function each)

| Number | Single source | Rule |
|---|---|---|
| Change count | `changeSummary(process or project)` | `{added, changed, removed, steps, text}`. R11: only steps count (steps, waits, messages, calls to other processes), never choices (decision or parallel gateways). `text` is the one phrase every screen shows, e.g. "4 new · 6 changed · 1 removed". |
| % done | `projectTruth.pctDone` (= `earnedValue.pct`) | The share of the budgeted work that is done, so EV = budget × pctDone. The tile shows `round(pctDone × 100)`. |
| SPI / CPI / EAC | `projectTruth.ev` | R11: with spent > 0 and EV = 0, SPI and CPI are **0.00** (not "—") and `evFlags` includes "Spent with nothing finished". With nothing spent and nothing earned they show "—". |
| Expected cost | `projectTruth.cost.forecast` | R11 one EAC method: BAC / CPI when CPI > 0 (`eacMethod: 'cpi'`), otherwise max(bottom-up, spent + remaining estimate) (`eacMethod: 'bottom-up'`). Never below spent. |
| Blocking | `projectTruth.blocking` | R11 one definition: information the Future steps need that is not available yet **and** holds up at least one open task, planned or not. `count` is the number on every screen; each item is one `who` row with why `blocker` (a planned item's row is its open fix task's action), so the "What's blocking" box is a view of `who`. |
| Approver card tests | `projectTruth.testing.perBU[bu]` | R11: the card shows `passed/checks`, where `checks` = tests + coverage gaps; `text` says so in words. |
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
- **Blocking:** **1** ("1 blocking (holds up 5 tasks)"). Bank remittance details is not available and holds up 5 open tasks; its fix (W6) is planned, so the label stays amber, but it is blocking (R11 one definition).
- **Reasons, in order:**
  1. "5 tasks late (1 past due, 4 will finish after their due date), but the finish still meets the deadline"
  2. "Behind on effort: 80% of the work planned by today is done"
  3. "Bank remittance details is not available yet; work is planned to get it"
- **Who needs to act (7):**
  1. Leo Park: Finish “Set up the bank details form” (was due Nov 16). This is the blocker row (why `blocker`) for Bank remittance details; the "What's blocking" box shows it with "Bank remittance details holds up 5 tasks; work is planned to get it".
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
| Vendor Onboarding (Home process card, new-project dialog) | **4 new · 6 changed · 1 removed** (10 steps in the Future map; the new "Risk tier?" choice is not counted) |
| Invoice Approval | **1 new · 3 changed** (4 steps; the new parallel "Approve and prepare payment in parallel" is not counted) |
| The project (both processes) | **5 new · 9 changed · 1 removed** |

The removed step is the Today step "Print and file the bank letter".

### Testing (Testing page, Launch page, project checklist)

- **Big number:** **9 of 26** tests passed (1 needs fixing, 16 not run). Business sign-off passed 9; the held test (linked to the open bank-form problem) never counts as passed.
- **Information that needs tests:** 2. **Has tests:** **1 of 2**. Bank remittance details has no cases for "Bank name" and "Account number".
- **Next:** "Add tests for 1 new piece of information". The step "Add tests" is **not** done.
- **Stages:** Try it out **7/8** (1 failed). Business sign-off **9/26**. Advanced coverage tiles show the same two numbers.
- **Per team:**

  | Team | Passed | Total | Failed | Not run |
  |---|---|---|---|---|
  | Accounts Payable | 0 | 7 | 1 | 6 |
  | Compliance | 9 | 9 | 0 | 0 |
  | IT | 0 | 4 | 0 | 4 |
  | Procurement | 1 | 4 | 0 | 3 |
  | Treasury | 0 | 11 | 1 | 10 |

  Approver cards (`passed/checks`, coverage gaps included): Accounts Payable **0/8**, Compliance **9/9**, IT **0/4**, Procurement **1/4**, Treasury **0/12** ("0 of 12 checks done: 0 of 11 tests passed, and 1 piece of information has no tests yet (Bank remittance details: Bank name and Account number)").

- **Go-live check:** "tests not passed yet". It never reads "Tests passed" next to ✕.

### Steps to launch: 1 of 7 done, 6 left

1. ✓ Plan the work.
2. Finish the work: 6 tasks still open.
3. Information available: 1 piece of information is not available yet (Bank remittance details); 1 new requirement found during the work needs a decision.
4. Tests passed: "Add tests for 1 new piece of information".
5. Each team approved its part: "Waiting for Compliance to approve its part. Accounts Payable, IT and Treasury approve their parts once the work on them is done. Procurement must approve again after changes."
6. Launch-day plan ready: not done (no undo plan yet).
7. Launch: "Approve or decline the 1 access request waiting for approval" (R11: only waiting requests block).

**Approvals:** only Compliance is ready, so only Compliance's approver (Dave Ortiz) is asked. The other parts are not asked until their work is done. Procurement was approved by Rosa Vega (Head of Procurement) and is stale after a change to W1.

**Who may approve (R11 separation of duties):** nobody approves a part they do steps in or recorded tests for, and never the PM or launch owner. Each team's eligible approver is its department head, an Approver (free seat): Accounts Payable **Nina Brooks**, Compliance **Dave Ortiz**, IT **Sam Keller**, Procurement **Rosa Vega**, Treasury **Grant Wu**. The seeded Access Review IT approval is Sam Keller's.

## ERP Upgrade Readiness

### Dates

| Value | Offset | On Nov 17 2026 |
|---|---|---|
| Deadline | seed + 41 bd | **Tue Jan 19 2027** (Christmas, New Year's Day and MLK Day skipped) |
| Launch date (`launch.date`, source `deadline`; no launch window yet) | — | **Jan 19** on the Launch page and the dashboard |
| Expected finish | seed + 16 bd | **Thu Dec 10** |
| Buffer | — | **25 business days** |

### Status and schedule

- **Label:** **Behind on effort** (SPI 0.00 < 0.9, so never "On track").
- **Sentence:** "Expected Dec 10, 25 business days before the Jan 19 deadline. Bank remittance details is not available yet; work is planned to get it (Leo Park)."
- **Tasks:** **0 of 2** done. **% done: 0%.**
- **Late:** **0**. `lateText` is "Nothing late". The facts line reads "0 late".
- **Blocking:** **1** ("1 blocking (holds up 2 tasks)").
- **Reasons:**
  1. "Behind on effort: 0% of the work planned by today is done"
  2. "Bank remittance details is not available yet; work is planned to get it"
- **Who needs to act (2):**
  1. Leo Park: Get Bank remittance details ready (the blocker row; its fix task belongs to the other project)
  2. Tom Alvarez: Add tests for 1 new piece of information

### Money

| Value | Amount |
|---|---|
| Budget | $9,000 |
| PV | $415.38 |
| EV | **$0** (nothing done, no progress logged) |
| Spent (AC) | $1,406.25, hours logged on the in-progress task |
| SPI | **0.00** (spent with nothing finished) |
| CPI | **0.00** |
| EAC | **$6,406.25** (`eacMethod: 'bottom-up'`): max(bottom-up $5,000, spent $1,406.25 + remaining $5,000) |
| Expected cost | **$6,406** |
| Flag | "Spent with nothing finished" |

The label reads "Behind on effort", never "On track" beside SPI 0.00.

### What changes

**4 new · 6 changed · 1 removed** (Vendor Onboarding).

### Testing

- **0 of 20** tests passed (20 not run). Has tests: **1 of 2**.
- **Next:** "Add tests for 1 new piece of information".
- **Stages:** Try it out **0/8**, Business sign-off **0/20**.

### Steps to launch: 1 of 7 done, 6 left

- Approvals: "Accounts Payable, Compliance, IT, Procurement and Treasury approve their parts once the work on them is done." Nobody is asked yet.

## Other screens

- **Home process cards:**
  - Vendor Onboarding: "10 steps · 4 new · 6 changed · 1 removed · 🔒 1 not available yet".
  - Invoice Approval: "4 steps · 1 new · 3 changed".
  - Quarterly Access Review: "3 changed".
  - Expense Reimbursement: "1 changed".
- **Dashboard, Upcoming launches** (sorted by launch date):
  1. Quarterly Access Review Automation, launch day seed + 7 bd (**Fri Nov 27**).
  2. Vendor Onboarding Modernization, launch day **Dec 29**.
  3. ERP Upgrade Readiness, deadline (no launch day set) **Jan 19**.
- **Holiday calendar** (`holidays(docs, {today})`): 33 federal holidays for 2026–2028, plus the workspace's own. Thanksgiving is Nov 26 2026 and Christmas is Dec 25 2026.
- **A new project from Expense Reimbursement** (before Accept): the Steps to launch card shows **"No plan yet"**. It never shows "1 of 7 done" or "Information available ✓".

  The suggested plan:
  1. "Implement changes: Submit receipts in the expense app": **no owner** (`ownerRole: 'Employee'`), note "Needs an owner: Employee." (R11: nobody's title is Employee, so it is never given to the PM).
  2. "Tell affected teams about the change" (the project's PM, 1 day), `teams: ['Employee']`.
  3. "Train the people who do the changed steps" (the project's PM). It starts after task 1 finishes.

  No task starts before its prerequisite finishes.

## Status report with a time window (R10.1, stream R)

`E().periodReport(docs, projectId, {preset} | {from, to}, today, {events})`, Vendor Onboarding Modernization, seed day **Tue Nov 17 2026**. Weeks run Mon–Fri; the window ends today at the latest. Asserted by the engine test `R10.1 golden period values`. The e2e compares the screen with the engine on the real day, because "this week" depends on the weekday.

The seed carries dated facts for this (business-day offsets): task `createdAt`/`assignedAt` (kickoff −21 bd; the problem W12 −1 bd; W11 reassigned −5 bd), risk `openedAt`/`closedAt`, `unavailableSince` on Bank remittance details (−21 bd), and two weekly report snapshots (`reportLog`, `forecastLog` at −6 bd and −2 bd, expected finish seed + 12 bd and + 13 bd). None of them changes a number above.

| | This week | Last week |
|---|---|---|
| Window | Week of Mon Nov 16 – Fri Nov 20 (so far: Nov 16–17) | Week of Mon Nov 9 – Fri Nov 13 (4 business days; Veterans Day) |
| Completed | **0** ("Nothing completed this week") | **3**: Connect the screening service, Send the "vendor is ready" messages, Make the extra-checks list |
| Newly assigned | 1: the bank-form problem (Leo Park) | 1: Send each invoice to the right approver (Dev Kumar) |
| Started | 2: the bank-form problem, Save new vendors in the ERP | 0 |
| Blockers raised | 1: the bank-form problem | 0 |
| Blockers resolved | 0 | 1: Sanctions screening result available (Tue Nov 10) |
| Still open at the end | Bank remittance details (open 21 bd, work planned); the bank-form problem (open 1 bd) | Bank remittance details (open 19 bd) |
| Behind at the end | **5 late (1 past due, 4 will finish after their due date)**, the same list and text as the project screen | 4 late (4 will finish after their due date), as the docs stood on Nov 13 |
| Tests | 14 passed, 1 failed (2 runs) | 4 passed, 0 failed (1 run) |
| Approvals | Procurement (Rosa Vega) | none |
| Risks | opened: Business testing overlaps the quarter-end close | closed: Screening vendor contract held up in legal review |
| Spent | $4,350 | $2,468.75 |
| Expected finish | Dec 7 → Dec 9: moved 2 bd later | Dec 4 → Dec 7: moved 1 bd later |
| Compare | 0 done this week vs 3 the week before | 3 done last week vs 2 the week before |

**Overall** (projectTruth today): label "Some tasks late"; "Expected Dec 9, 14 business days before the Dec 30 deadline"; "Higher budget need expected: expected cost $48,847 against the $48,000 budget ($847 over)". **Common areas of concern:** "Banking (risk area): 4 of the 5 late or blocked tasks", "The “Capture banking details” step: 3 of the 5 late or blocked tasks", "IT team: 2 of the 5 late or blocked tasks".

**Since last report** = Mon Nov 16 – Tue Nov 17 (last report Fri Nov 13). Email subject: "Vendor Onboarding Modernization: status, week of Nov 16".
