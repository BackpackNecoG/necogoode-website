# R10 re-review: Karen (Ops Director, 220-person distributor; arrived from search)

**Verdict:** would book a demo, cautiously. Likely deal is the $7.5k pilot, which she can approve herself, then the Team plan with 3–5 editors (about $1.6–2.7k/yr). Before R10 she would not have booked.

## Scorecard (capability / ease)

| Area | PMOFlow (cap / ease) | Vs. competitors |
|---|---|---|
| C1 Process authoring | B / B | PARITY |
| C2 As-is → to-be diff | A / A | ONLY |
| C3 Data requirements | B / B | ONLY |
| C4 Process → plan | C / B | ONLY |
| C5 Scheduling / forecast | **D / C** | GAP: 8-month task, plan late on arrival |
| C6 Views | C / C | GAP |
| C7 Resource / capacity | C / B | GAP |
| C8 Status / AI summary | A / A | ONLY |
| C9 Portfolio / dashboards | B / A | PARITY |
| C10 Cross-project impact | B / A | ONLY |
| C11 Testing / UAT | B / C | ONLY |
| C12 Approvals / gates | B / B | PARITY |
| C13 Launch / rollout | B / B | ONLY |
| C14 Time-boxed access | B / B | ONLY |
| C15 Collaboration | C / B | GAP |
| C16 Financials | C / C | GAP |
| C17 Mobile | C / B | GAP |
| C18 Enterprise readiness | D / C | GAP |
| C19 Time to first value | B / B | PARITY |
| C20 Trust / buying path | **D / C** | GAP (was F) |
| C21 Recurring checklist runs | N/O | GAP: Process Street |
| C22 Forms / intake | N/O | GAP |
| C23 Automations | N/O | GAP |

## Bugs (reproduced on her own pasted procedure)

1. **The importer silently dropped step 6** ("AP enters vendor in the ERP (vendor master)") and reported "found 8 steps". It also created junk information ("Known number") and missed "bank details".
2. **Roles at the start of a sentence are missed** ("Buyer gets…", "Credit/Finance reviews…").
3. **"Things to check" goes stale.** It still says "5 steps do not say who does them" after owners were filled in.
4. **Information owner flips on save.** The import preview shows "whoever does the step", but after saving all 6 items are owned by Maya Chen (the importer). The step owner also differs between the process page (Credit/Finance) and the project page (Maya).
5. **Contradictory information status.** The same item reads "Not available yet" in "Steps waiting for information" and "Not checked yet" in the Information panel.
6. **Wrong team on plan tasks.** The import found Purchasing, AP, Credit and Finance, but the plan's "Tell" task says "Teams: Procurement".
7. **Plan sanity.** "Make Known number available" runs Dec 16 – Aug 23 (8 months). The project then expects Sep 24, 173 business days after the deadline, and the dialog allowed accepting a plan that is late on arrival.
8. **"Late · was due Aug 23"** is shown for a date in the future.
9. **Seed project disagrees with itself.** It shows "0 blocking", while the report and risk register say the bank form "holds up" 2 tasks (High×High).
10. **"Retire the old step"** shows "Unknown step" on the timeline.
11. **Demo-limit message contradicts itself:** "Try again tomorrow" and "Try again in a minute" in one message.
12. **Enter in the information chip saves and closes the whole step editor.**
13. **Timeline axis labels overlap** on multi-month spans.

## Sandbox limit (product issue)

The limit is 5 sandboxes per IP per day, plus a sandbox per browser. A company behind one office IP would get locked out. It should key on a cookie, raise the per-IP limit, and give one clear message.

## Buying path she still needs

- What the Team plan needs from IT (no Azure install?).
- A SOC 2 date.
- A customer quote.
- An answer to "we onboard vendors every week": recurring checklist runs.
