# R11 re-review: BPM/BA practice lead (compared with Signavio, Promapp and Lucid)

## Verdict
- **Demo:** yes.
- **Pilot:** paid pilot of $2.5k, yes.
- **Contract:** not yet. Likely about 8 editors on Business, roughly $6.2k/yr.

## Scorecard (capability / ease)

| Category | Grade | Flag |
|---|---|---|
| C1 | B/B | PARITY |
| C2 | A-/A | ONLY |
| C3 | B+/B | ONLY |
| C4 | B/B | ONLY |
| C5 | B-/B | |
| C6 | B/B | PARITY: RACI found |
| C7 | C/C | |
| C8 | B/A | |
| C9 | B-/B | |
| C10 | C/C | GAP |
| C11 | B/B | ONLY |
| C12 | B-/B | |
| C13 | B/B | ONLY |
| C14 | B/B | ONLY |
| C15 | C+/B | GAP |
| C16 | C+/B | |
| C17 | C/C | |
| C18 | D+/C | GAP |
| C19 | A-/A | |
| C20 | **B/A** (was F → C+) | PARITY: the published $2.5k pilot beats competitors' contact-sales |
| C21 Process mining | N/O | GAP |
| C22 Governance repository / review cycles | D/C | GAP |

## Re-test of last round's 13 findings
- **Fixed (9):**
  - articles;
  - "Otherwise" handled as the else branch;
  - reject ends the flow;
  - Role (Name) mid-line;
  - Workiva/D&B;
  - BPMN boundary timers kept on import;
  - RACI found, under Advanced;
  - a step owner can't approve their own part;
  - the re-approval reason says what changed. It still lacks from→to.
- **SLA timer:** now a timer, but on the wrong step. It is attached to "Notify the Sales Rep" (the reject branch), not "Approve or reject". The export has the same error.
- **RACI:** A, C and I are never pre-filled from the text ("Sam Wu signs off").
- **Coverage summary vs matrix:** still disagrees.
  - Credit: "All 0 spec fields covered" next to "3 UNCOVERED".
  - Vendor: "2 fields without a case", while the panel lists 3 more.
- **Duplicates:** a duplicate Tax ID is caught. Not caught:
  - a shared bank account across 3 vendors (fraud flag);
  - near-duplicate names;
  - whitespace.

## New defects
1. **Approval routing to the wrong department.** A Credit/AR/Sales process routes its only approval to Procurement (Rosa Vega), and the "Tell affected teams" task says Procurement. This is the same problem Karen hit with Purchasing/Credit/AP/Treasury. **Team → department mapping is broken.**
2. **Re-approval is too broad.** An AP-only edit also sends Procurement back ("process edited"), contradicting "only that department approves again".
3. **Parser control flow.** The "under $50k → Approve it" Yes branch continues into the Credit Manager's "Approve or reject" instead of skipping it.
4. **First Save click is swallowed** after typing in an owner box. Repro: paste → type an owner → Save; nothing happens until the second click.
5. **Profiling-derived tests:**
   - TC17/18 reject the observed valid shapes ("ABC", "Aabcdefghij").
   - No uniqueness test is generated from the duplicate warning.
6. **Plan owners fall back to the PM** (Maya) instead of mapping role → person. Example: MuleSoft went to Maya, not Dev.
7. **Internal IDs leak into the UI:** "section:Accounts Payable#s:vendor-onboarding/s4".
8. **Diff treats timers inconsistently.** Step 2 shows "time limit none → 1 business day", but step 6 (escalation added) only shows "same step, new way of working".
9. **VSDX import:**
   - Connectors without a "Dynamic connector" master are listed twice as "not connected".
   - The decision "Eligible?" becomes a parallel step.
10. **The rate-limit message contradicts itself** ("10 minutes… a minute").

## Counts that disagree
- Home tile shows "0 steps"; the Processes list shows 12 (after paste and save).
- Portfolio says "6 launch steps left". Launch says "9 checks not passed (1 pass · 1 warn · 8 fail)". There are 4 launch-day steps.
- The report says "6 steps left"; Launch says "6 checks".
- Launch says "Tests passed… Blocking · 12"; Testing shows 0/9 UAT scripts.
- After generating 22 cases, the header says 36 data cases, but "UAT 9/26" doesn't change.
- **Unowned tasks.** The plan dialog says "3 tasks need an owner", but the report says "Maya: Finish…" and the map shows "—".
- **"Not checked yet" vs "3 not available yet":** the process and the report describe the same items differently.
- **Today tab.** Header counters read "0 Future steps · 0/0 information" while the panel shows 3 items.
