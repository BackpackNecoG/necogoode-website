# R11 re-review: Karen (Ops Director, 220-person distributor, arrived from search)

## Verdict
- **Demo:** yes, but low intent to buy quickly.
- **Likely deal:** a $2.5k pilot, possibly followed by Team with 2–3 editors at $1,080–1,620/yr.

## Scorecard (capability / ease)

| ID | Grade | Flag |
|---|---|---|
| C1 | B / A | PARITY |
| C2 | A / A | ONLY |
| C3 | B- / B | ONLY |
| C4 | B / A | ONLY |
| C5 | B / A | PARITY. Was D/C |
| C6 | C+ / B | GAP |
| C7 | C / B | GAP |
| C8 | B+ / A | ONLY |
| C9 | B / B | PARITY |
| C10 | B / B | ONLY |
| C11 | B | ONLY |
| C12 | B / B | PARITY |
| C13 | B / B | ONLY |
| C14 | B | ONLY |
| C15 | C / B | GAP |
| C16 | D / C | GAP |
| C17 | not seen | |
| C18 | D | GAP |
| C19 | A in the demo / C in real use (Azure setup) | |
| C20 | C (solo founder) | GAP |
| C21 recurring runbook execution | N/O | GAP: Tallyfy and Process Street do this |

## Mismatches (repro: paste → save → edit Future → Start project → Accept the plan)

1. **Unowned tasks.** The preview said "Needs an owner: Buyer/Vendor". After Accept, the Work tab shows the owner as "—", while the headline, "who acts", the report Asks, the portfolio and "Waiting for you" all say Maya Chen. Accept silently gives these tasks to the PM.
2. **Step owners differ between screens.** The map shows Buyer/Vendor; the project's process panel shows Maya. Renaming a step changed its information owner to Maya in Future.
3. **"Teams involved: AP · 2 steps"**, but AP owns 3. Step 9 has no team badge.
4. **Wrong team gets the approval.** The procedure's teams are Purchasing/Credit/AP/Treasury, but approvals and the "Tell" step say "Procurement". AP, Credit and Treasury are never asked.
5. **Contradictory counts in the report.** The concern line says "2 of the 5 late or blocked", while the same report says 0 late and 4 blocking.
6. **Portfolio tiles contradict ERP status.** ERP is labelled "Behind on effort" with 0 late, but is counted as "Some tasks late". It also says "Behind on effort" while expected 25 business days early.
7. **Week start differs.** The project report's week is Tue Nov 17–Fri; the portfolio's is Mon Nov 16–Fri.
8. **Timeline bar missing** for "Tell affected teams".
9. **"Expected cost $21,300"** appears with no rates entered.
10. **"9 tasks for 4 people"**, where 3 of the 4 "people" are unfilled roles. That contradicts "owners are people, not roles".

## Import
- 9 lines → 9 steps, with no line dropped. It found D&B, the ERP and SharePoint.
- **Missed inline roles** ("Purchasing mgr", "Credit dept").
- **"if spend over $25k Karen approves too"** became a plain step, not a choice or approval.
- **Missed documents** (COI, vendor master, bank details).

## Buying blockers
- **The Team plan needs her Azure admin to deploy into their subscription**, so IT becomes a gatekeeper. She wants a hosted Team tier with no Azure, or a plain statement that IT is needed.
- Sign-in with Microsoft only comes with Business ($65).
- No SOC 2 until 2027, and the vendor is a solo founder.
- No per-vendor recurring runs.
