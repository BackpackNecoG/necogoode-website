# Expert 1: Enterprise PMO tooling lead

**Compared against:** Smartsheet, monday, Planner Premium/Project, ServiceNow SPM.

## Verdict

- **Category:** business-process transformation delivery. It overlays the PMO stack rather than replacing it.
- **Moat:** the process-delta chain (diff → tasks → data readiness → tests → scoped approvals → runbook → time-boxed access). No competitor chains these. Defensibility is moderate: the data model is the moat once customer processes accumulate inside it.
- **Demo:** YES. He'd want to see:
  - a real SOP taken through to live;
  - SSO and audit export;
  - Jira/ServiceNow sync;
  - EV fixed;
  - a security pack;
  - a reference customer.
- **Contract:** a pilot of $25–60k/yr for 50–150 seats, with free approver seats. That holds only if it's positioned as an overlay that syncs to Jira/ServiceNow. Pitched as a PPM replacement, he passes.

## Scorecard (capability / ease)

| Category | Capability | Ease | Flag |
|---|---|---|---|
| C1 | B | A | ONLY |
| C2 | A | A | ONLY |
| C3 | B | B | ONLY |
| C4 | C | A | ONLY |
| C5 | C | A | GAP |
| C6 | B | A | PARITY |
| C7 | C | B | GAP |
| C8 | A | A | PARITY |
| C9 | C | B | GAP |
| C10 | B | A | PARITY |
| C11 | B | A | PARITY (vs ServiceNow) |
| C12 | A | A | PARITY |
| C13 | A | A | ONLY |
| C14 | A | B | ONLY |
| C15 | C | B | GAP |
| C16 | C | B | PARITY (numbers contradict) |
| C17 | B | B | PARITY |
| C18 | F | | GAP |
| C19 | A | A | PARITY |
| C20 | F | | GAP |
| C21 Intake/demand | F | | GAP |
| C22 Timesheets | D | | GAP |
| C23 Automation rules | F | | GAP |
| C24 Templates | F | | GAP |
| C25 Report builder | F | | GAP |
| C26 Integrations (Jira/ServiceNow/ERP/HRIS) | F | | GAP |

Notes on specific grades:
- **C4:** the plan came back as one vague task owned by the role "Employee".
- **C5:** no critical path is visible, and there's no what-if or holiday calendar.
- **C7:** the 14-day workload view only.
- **C9:** dashboards are fixed and can't be configured.

## Bugs

1. **Change counts disagree.** The home card reads "10 steps · 11 changing" while the process shows 4 new + 6 changed.
2. **ERP status vs EV.** ERP shows "On track", but Advanced shows SPI/CPI 0.00 and EAC $5k against a $9k budget; spend is $1,406 with 0 of 2 tasks done.
3. **EV doesn't reconcile.** "54% done" doesn't match CPI 1.06 × actual cost.
4. **Testing contradicts itself.** "Done 2 of 2" sits next to "Add tests for 1 new…".
5. **No holiday calendar.** The launch window lands on Dec 25, and business days include Thanksgiving.
6. **Late counts look inconsistent.** Simple says "5 late" while Advanced says "1 past due + 4 will finish after due". Executives will misread this; show the split in Simple.
7. **A new Expense project (no information defined) is inconsistent:**
   - it shows "Information available ✓" and "1 of 7 done" before any plan exists;
   - it asks AP to approve with 0 of 1 tasks done;
   - its one task is owned by "Employee", a role rather than a person.
8. **Paste summary miscounts steps.** It says "6 steps · 1 choice", but the cards are numbered 1–5 plus a branch.
9. **"+2 more on the Work tab"** points to items that aren't tasks (an approval and a test).
10. **Risk register is stale.** It says "not started" while the step is in progress.

## Test-harness note

The sandbox is keyed on the client IP. A random x-forwarded-for value per context gives a fresh sandbox each time, which explains Karen's "process vanished". That's not a product bug.
