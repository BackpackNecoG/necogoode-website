# PMOFlow R15 market re-review: consolidated (build 1df25)

## 1. Outcomes

| Reviewer | Demo | Paid pilot | Contract | Year-1 after pilot |
|---|---|---|---|---|
| Karen (ops director, search) | Yes (booked) | Likely ($2,500) | Not yet | $1,620–$2,340 |
| Jordan (PMO coordinator, search) | Yes | Yes | Not yet | $6,240 |
| PMO director (expert) | Yes | Yes | Not yet | $23,400 |
| BPM/BA expert | Yes | Yes, **now on a financial process** | Not yet | ~$6,200 |

Demo 4/4 and pilot 4/4 (Karen is still "likely") for the fifth round. **Contract 0/4.**

## 2. Grade movement
- **PMO expert:**
  - Scheduling C → **B/A**. Dependency-correct re-planning works.
  - Approvals → **A-/A**.
  - Buying path → B-/B.
- **BPM expert:**
  - Process authoring, the diff and the plan → A-.
  - Approvals → B+/B.
  - Testing C+ → B-.
  - The "control gap" is closed: a threshold change routes to Credit and the Controller.
- **Jordan:**
  - Mobile C/D → **B/B** (Launch 4/114 controls under 32px).
  - Testing → B/B.
  - Financials → B/B.

## 3. Still failing the bar (code)

Already fixed by the lead after the review, shipping in R16:
- "On track" next to blockers now reads "Waiting on information".
- A typed role no longer fills in the process owner behind it (Karen's "Maya" on plan cards).
- The "late or blocked" unit now reads "tasks late or held up".
- Refused self-passes are sent to the server so they're logged.

**A. Identity and integrity (PMO, Jordan):**
- The actor and step-up are asserted by the client, and a step-up stamped 2020 was accepted.
- Owners can delete logged hours, which rewrites the past.
- Opening the report preview logs it as a report (**regression**).

**B. Governance edges (Jordan, PMO):**
- A move out of a department doesn't revoke approver status or reopen that person's approvals.
- A phantom PMO part appears after a PM hand-over.
- The launch owner changes in one click.
- Hand-over approvals route to an Admin who just joined.
- A blocked joiner isn't told why.
- The launch window can move past the deadline or onto a holiday.
- Effort or cost over budget isn't guarded.
- An added dependency doesn't move the dependent's start.
- An owner clears a Jira hold with no warning.

**C. Tests from data and rules (BPM, fourth round):**
- No boundary tests for (changed) thresholds.
- Profile warnings (shared bank, uniqueness, duplicate count) don't become tests.
- The min/max is taken from the sample.
- Approvers invited on the process page don't reach Launch.
- The RACI has no A.
- VSDX nested roles; the BPMN name and information.
- Outputs are marked "collected".

**D. Karen's setup ease:**
- The import should ask "do you already have these?".
- Bulk owner assignment by team.
- New project defaults to the process just made.
- Consistent per-vendor classification.
- Teams-involved counts.
- Report asks use current owners.
- "Waiting on 14" is split into lines.

**E. Counts and labels (every reviewer):** see each file's disagreement list.

## 4. Non-code blockers (unchanged)
- No SOC 2 or pen test.
- Solo vendor.
- SCIM planned.
- Development signing key.
- The Team plan's Azure deploy.
- No recurring runs.

These now decide the contract. The founder has been asked to decide on a hosted Team plan, an earlier pen test, and recurring runs.
