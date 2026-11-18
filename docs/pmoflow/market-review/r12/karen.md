# R12 re-review: Karen (Ops Director, 220-person distributor, from search)

## Verdict
- **Demo:** yes.
- **Pilot:** only if 3 blockers are fixed:
  - custom departments;
  - unowned work never shown as the PM's;
  - a Team plan with no Azure deploy.
- **Deal if it closes:** Business, about 8 editors, roughly $6.2k/yr.

## Scorecard (capability / ease)

| ID | Grade | Flag |
|---|---|---|
| C1 | B/A | |
| C2 | A/A | ONLY |
| C3 | B-/B | ONLY |
| C4 | B/B | ONLY |
| C5 | C+/B | |
| C6 | B/B | |
| C7 | C/B | |
| C8 | B-/A | |
| C9 | B/B | |
| C10 | B/C | |
| C11 | B | |
| C12 | **C+/B** | GAP: fixed department list |
| C13 | B/B | |
| C14 | B | |
| C15 | C/B | |
| C16 | D/D | |
| C17 | n/a | |
| C18 | D/C | |
| C19 | B/A in the demo, D/D in reality (Azure deploy) | |
| C20 | C/B | |
| C21 | custom department list: N/O | GAP |

## Findings
- **One line was not turned into a step.** She pasted 9 lines; the screen said "8 lines → 8 steps". The unnumbered line "if spend over $25k Karen approves too" was attached to step 7 as a note. It became neither a choice nor an approval.
- **Inline roles.** Fixed: "Purchasing mgr" and "Credit dept", plus COI, bank letter and vendor master. Still wrong:
  - a compound line ("Vendor sends…; Treasury calls…") was not split, so Treasury was lost;
  - "Check ofac/sanctions list" became a piece of information.
- **Department list is fixed** (AP/Compliance/IT/PMO/Procurement/Treasury). She can't add Purchasing, Credit or Operations. Nothing is chosen automatically any more, which is good.
- **Unowned tasks regressed after Accept.** The Work tab says "Needs an owner: Buyer". But the header "who acts", Home "Waiting for you 8", the report's Asks, the launch checklist and step cards 4 and 7 all show Maya (the PM). The Edit dialog preselects Maya, so pressing Save assigns her.
- **The status report says "On track"** with 7 blocking and 11 of 13 tasks unowned. It shows "Expected cost $30,000" with no budget or rates entered.
- **A plan task runs across Christmas** ("Train the people" Dec 24–31). Holiday calendars are a Business-plan feature.
- **Removing AP's bank-letter double-check** doesn't ask AP to approve or tell AP. That's the wrong default for a financial control.

## Mismatches
1. 9 lines pasted vs "8 lines → 8 steps".
2. "Teams involved" shows 5; "Who approves" shows 6, then 7 (Buyer and Operations are missing from "Teams involved").
3. "What changed" shows 2 NEW; the picker shows "1 new · 1 changed · 1 removed".
4. The header shows 0 late and 7 blocking; the report says "3 of the 8 late or blocked"; who-acts shows 8.
5. The owner shows "Needs an owner" on the Work tab but Maya everywhere else.
6. "Bank details" is owned by "AP Supervisor", a removed step, while its plan task is owned by "Treasury analyst".
7. Home: "10 steps · 4 new · 6 changed · 1 removed" (the parts don't add up to the headline).

## Buying path
The Team plan still needs "your Azure admin runs our template". Her IT team is two people, so this stalls the deal.
