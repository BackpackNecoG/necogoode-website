# PMOFlow market review: consolidated scorecard (build 9800403, Nov 17 2026)

## Reviewers

| ID | Reviewer | Came via | Compared against |
|---|---|---|---|
| K | Karen, Director of Ops (220-person distributor) | Search | Smartsheet, Process Street, SweetProcess |
| J | Jordan, PMO Coordinator (900-person benefits administrator) | Search | Smartsheet, monday, Planner/Project, Nintex Promapp |
| P | Enterprise PMO tooling lead | Expert | Smartsheet, monday, Planner/Project, ServiceNow SPM |
| B | BPM / BA practice lead | Expert | SAP Signavio, Nintex Promapp, Lucid Process Agent, Jira + Xray |

**How to read the grades.** Grades are A–F. **Cap** is how complete and deep the capability is. **Ease** is how easy it is for a non-technical user. **Consensus** is the middle of the four reviewers' grades.

Competitor grades mostly come from the reviewers' prior experience or from vendor sites. None of the competitor products were used in this session.

**Flags:**
- **ONLY:** none of the compared competitors offers it.
- **LEAD:** competitors offer it, but PMOFlow grades higher.
- **PARITY:** roughly equal.
- **GAP:** a competitor offers it and PMOFlow is missing it or weaker.

## 1. Category scorecard: PMOFlow (Cap / Ease)

| # | Category | K | J | P | B | **Consensus Cap / Ease** | Best competitor (Cap) | Flag |
|---|---|---|---|---|---|---|---|---|
| C1 | Process authoring | B / B+ | B / A- | B / A | B / A | **B / A-** | Signavio, Lucid, Promapp A | PARITY |
| C2 | As-is → to-be diff | A- / B | A / A | A / A | A / A | **A / A** | Signavio B | **ONLY / LEAD** |
| C3 | Data requirements | B+ / C | A- / B | B / B | A / B | **A- / B** | Signavio C | **ONLY** |
| C4 | Process → plan | B / B | B- / A | C / A | B / A | **B- / A** | ServiceNow C | **ONLY** |
| C5 | Scheduling / forecast | B / A- | B+ / A | C / A | C / B | **C+ / A-** | MS Project A | GAP |
| C6 | Views | C+ / B | B- / A | B / A | B / B | **B- / B+** | Smartsheet, monday A | GAP (board hidden in Advanced) |
| C7 | Resource / capacity | C / B | B- / A | C / B | C / B | **C / B** | ServiceNow A | GAP |
| C8 | Status / AI summary | A- / A | A / A | A / A | B / A | **A- / A** | ServiceNow, Smartsheet B | **LEAD** |
| C9 | Portfolio / dashboards | B / A- | B+ / A | C / B | B / B | **B- / B+** | Smartsheet, ServiceNow A | GAP (not configurable) |
| C10 | Cross-project impact | B+ / A | A- / A | B / A | A / B | **A- / A** | ServiceNow B | **ONLY / LEAD** |
| C11 | Testing / UAT | B+ / B- | B / B- | B / A | B / B | **B / B** | Xray A | LEAD vs PPM tools, GAP vs Xray |
| C12 | Department approvals / gates | B+ / B+ | A / A | A / A | A / A | **A / A** | Process Street A-, others B | **LEAD** |
| C13 | Launch / rollout | B+ / B | A- / A- | A / A | B / B | **A- / B+** | ServiceNow C | **ONLY** |
| C14 | Time-boxed data access | B / – | A- / B | A / B | B / A | **B+ / B+** | none | **ONLY** |
| C15 | Collaboration | C+ / B | C+ / B | C / B | B / A | **C+ / B** | Smartsheet, monday A | GAP (no Teams, Outlook or email) |
| C16 | Financials / EV | C+ / A- | B / B | C / B | B / B | **C+ / B** | ServiceNow A | PARITY on paper; the numbers contradict each other |
| C17 | Mobile | B / B+ | A- / A | B / B | B / B | **B / B+** | monday A | PARITY |
| C18 | Enterprise readiness | F | D | F | F | **F** | all competitors A | **GAP: blocks a contract** |
| C19 | Time to first value | B / B | A- / A | A / A | A / A | **A- / A** | monday, Lucid A | **LEAD** |
| C20 | Trust / buying path | F / F | F / F | F | F | **F** | all competitors A | **GAP: blocks a demo** |

## 2. Capabilities competitors have that PMOFlow does not (all GAP)

| Capability | Raised by | Who has it | Relevance |
|---|---|---|---|
| Two-way sync with Jira, Azure DevOps and ServiceNow, plus an API | P, B | All PPM and ALM tools | **Required for a pilot**: both experts would pass without it |
| Microsoft 365: Teams/Outlook notifications, Entra sign-on, Visio import | J, B, K | Planner, Smartsheet, monday, Promapp | High: most buyers already own M365 |
| Visio, Lucid and Signavio import; BPMN data objects; role-based lanes | J, B | Promapp, Signavio, Lucid | High for BA-led buyers |
| Request intake / demand scoring | J, P | ServiceNow, Smartsheet, monday | Medium |
| Templates (ERP cutover, onboarding and so on) | P | All | Medium, cheap |
| Automation rules | P | All | Medium |
| Configurable dashboards / report builder | P | Smartsheet, ServiceNow | Medium |
| RACI per step | B | Signavio, Promapp | Medium, cheap |
| Governed process repository, review cycles, employee process portal, controls/risks on steps | B | Signavio, Promapp | Medium; opens compliance budget |
| Running each instance of a process as an enforced checklist | K | Process Street | Medium: a different product (process execution) |
| SOP training and quizzes | K | SweetProcess, Trainual | Low: different market |
| Timesheets | P | ServiceNow, monday, Project | Low: PPM parity |
| Process mining, simulation, variants | B | Celonis, Signavio | Low: enterprise BPM tier |

## 3. Would they book a demo, and would it close?

| Reviewer | Book a demo? | Would the demo become a contract? | Realistic deal |
|---|---|---|---|
| Karen | **No.** There is nothing to book: no company, price, button or security page, and "concept" is printed on the page | Not this quarter | $3–6k/yr pilot, at most 10 users |
| Jordan | **Not yet**, same reason. Jordan would click with a vendor identity, price, SSO/security page and Visio import | Unlikely within 6 months (the VP asks "why not Planner?") | $15–35k/yr, about 40 users |
| PMO expert | **Yes**: "nobody chains these together" | **Pilot** only as an overlay that syncs to Jira/ServiceNow; pass if pitched as a PPM replacement | $25–60k/yr pilot, 50–150 seats, free approvers |
| BPM expert | **Yes**: "the chain is real and tightly integrated" | **Pilot** only on top of the existing stack | $15–40k/yr, 25–75 users, $40–70 per editor/mo, free viewers |

**Net result: 0 of 4 would sign today.**
- The two experts would book a demo and conditionally pilot.
- The two buyers who came from search like the product but cannot buy it.
- The same blockers appear in all four reviews:
  - unknown vendor;
  - no single sign-on or SOC 2;
  - no integration with the tools they already own.

## 4. Bugs found (trust-breakers)

1. **Change counts disagree.** Four screens show different numbers ("11 changing", 4+6, 5+6, 5 NEW), and removed steps are never counted. (P, B)
2. **Earned value contradicts itself.** ERP shows "On track" with SPI and CPI of 0.00. "54% done" doesn't reconcile with CPI. (P, B)
3. **No holiday calendar.** The launch window is on Dec 25, and Thanksgiving and Christmas count as business days. The dashboard says Dec 28. (J, P, B)
4. **Testing contradicts itself.** "Done 2 of 2" sits beside "Add tests for 1 new…". "Tests passed —" appears beside a failing ✕. Coverage reads 9/32 in one place and 9/26 in another. (J, P, B)
5. **Demo data leaks into a user's own imported process.** Bank details "owned by Leo Park" appear in it. (K) **Serious.**
6. **Accepted plans are weak.** A suggested plan can be a single vague task owned by a role ("Employee"). An accepted plan can conflict with itself (a start before its prerequisite) while still saying "On track". (J, P, B)
7. **Paste parser errors.** It splits or drops clauses, writes "coes-approve", and creates roles called "Enter the vendor". The step count is off, and pasted data shows as "Connected" with no source. (K, J, P, B)
8. **Simple-mode "5 late" hides the split** of "1 past due + 4 forecast late". Executives will misread it. (K, P)
9. **Small errors:**
   - board lock labels are cross-wired;
   - the "check sample" link opens the wrong data element;
   - "+2 more on Work tab" points to items that aren't tasks;
   - a new project shows "Information available ✓" with no information defined;
   - grammar ("1 test that haven't run", "Late0 past due").
10. **Not a bug:** Karen's "process vanished" was caused by the test harness. Each browser context used a new IP, so it got a fresh sandbox.

## 5. Where to go next (ranked by impact on winning a contract)

1. **Fix the trust-breakers in §4.** All four reviewers hit at least one. A skeptical evaluator stops trusting the tool after one contradictory number. This is engineering only, with no founder decision needed.
2. **Build a buying and trust layer.**
   - A product page above the sandbox: value line, short video, who is behind it, pricing with free approver seats, and "Book a demo".
   - A security and data-handling page.
   - Remove "concept" and `noindex`.

   Raised by all four reviewers. **Needs founder decisions:** company name and entity, the price, and whether this lives on necogoode.com or its own domain.
3. **Position as an overlay, not a replacement.**
   - Build two-way Jira and Azure DevOps sync first, then ServiceNow, for tasks and test results.
   - Add Teams and Outlook notifications.

   Both experts make this the line between a pilot and a pass. It matches the original "virtual display layer" intent.
4. **Enterprise baseline:**
   - Entra ID / Okta single sign-on;
   - real roles instead of the persona switcher;
   - an exportable audit log;
   - a published SOC 2 roadmap.

   Blocks every contract.
5. **Process-side rigor for BA-led buyers:**
   - Visio and BPMN data-object import;
   - role-based lanes;
   - RACI per step;
   - stronger, person-assigned suggested plans;
   - starter templates.
6. **Later, by segment:**
   - request intake and configurable dashboards (PMO buyers);
   - governed repository, review cycles and process portal (compliance budget).

**Deliberately not recommended:** timesheets, a report builder, process mining or simulation, or running SOPs as checklists. Each pulls toward becoming a full PPM or BPM suite. Both experts said a PPM-replacement pitch is an automatic pass.
