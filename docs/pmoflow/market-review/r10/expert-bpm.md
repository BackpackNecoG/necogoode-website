# R10 re-review: BPM/BA practice lead (compared with Signavio, Promapp, Lucid Process Agent, Jira+Xray)

## Verdict
- **Book a demo:** YES.
- **Contract:** YES to a paid pilot ($7.5k, 90 days). Year one would be about 8–12 editors on Business, roughly $6–9k ARR, which is below Signavio's floor.

## Scorecard (capability / ease)

| ID | Area | Grade | Flag |
|---|---|---|---|
| C1 | Authoring | B/B | GAP: RACI not found, boundary events dropped |
| C2 | Diff | A-/A | |
| C3 | Data | A-/A | ONLY |
| C4 | Plan | B+/A | ONLY |
| C5 | Schedule | B/B | |
| C6 | Views | B/B | |
| C7 | Capacity | C/C | |
| C8 | Status | B+/A | ONLY |
| C9 | Portfolio | B/B | |
| C10 | Impact | B/B | ONLY |
| C11 | Testing | B/B | PARITY with Xray |
| C12 | Approvals | A-/A | ONLY |
| C13 | Launch | B+/B | ONLY |
| C14 | Access | B/B | ONLY |
| C15 | Collaboration | C+/B | GAP |
| C16 | Financials | B-/B | |
| C18 | Enterprise | D+ | GAP |
| C19 | Time to value | A-/A | |
| C20 | Trust | **C+/B** | GAP; was F |
| C21 | Process mining / simulation | N/O | deliberate |
| C22 | RACI matrix + process portal and review cycles | N/O | GAP |

## Verified improvements
- Visio import: no dropped elements, lanes become roles.
- BPMN export:
  - lanes as roles;
  - real dataObjects;
  - ISO timers;
  - messageFlow;
  - lossless round-trip.
- No demo-data leakage.
- The diff is strong.
- Profiling: masked statistics plus ABA-valid test cases.
- Department-scoped re-approval works.
- Jira sync works both ways.
- The Admin page is honest.

## Paste parser (12-line credit-limit SOP)

Problems found:
- Leading articles are kept ("The Credit Manager").
- "Otherwise, the Credit Analyst…" becomes a step titled "Otherwise…" with no role. It should be the else branch.
- "Controller (Sam Wu)" mid-line gets no role.
- Workiva and Dun & Bradstreet aren't recognised as systems. The data name becomes "Bradstreet report".
- **The reject branch defaults to "carry on to the next step".** It should end the process.
- The 2-day escalation becomes a choice instead of a timer.

## Governance issues
- Third-party BPMN import drops boundary timer events, though it says so honestly.
- **RACI wasn't found anywhere** in the UI or the export. Either it's hard to find or it's broken; check what S2 shipped.
- The reset reason for re-approval doesn't say what changed.
- **The step owner (Priya) can approve her own Compliance part.**
- The launch owner can override the launch window and the unfinished launch-day step alone, with no second person.
- Profiling missed a duplicate account number across vendors, even though the rule is "Unique per vendor".

## Mismatches
1. **Launch:** "Not ready: 6 steps left" vs "1 PASS · 1 WARN · 8 FAIL". On Access Review, "2 steps left" vs "9 PASS · 1 FAIL".
2. **Access Review:** the header says "Ready to launch… owner can launch", but the button is locked.
3. **Coverage:** "All 7 spec fields covered 7/7" vs the matrix showing "5 UNCOVERED" with 13 fields lacking cases. The go-live check drops coverage.
4. **Paste screen:** "7 steps do not say who" vs "4 steps need someone".
5. **Processes list after paste and save:** shows "0 steps / None added yet" until Future is opened. The process page shows 12 steps.
6. **Data owner:** the preview says Credit Analyst/Sales Rep; after save, Maya owns all 5.
7. **Admin:** "Team plan allows up to 25" while the plan shows Business.
8. **Access:**
   - Vendor shows "2 OPEN" while one is still waiting for approval.
   - The access gate is "Blocking·2" on Vendor but "Done" on Access Review with 1 open.
   - A grant shows 33 days against a stated maximum of 30.
9. **Untested count:** "41 tests that haven't run" vs "38 never run in UAT".
10. **Jira:** "18 changes sent" vs 19 in the log, and "13 changed issues since last sync" after one edit.
11. **Account number:** the data page says "text, masked", but the tests say "Wrong type for digits" and use a hidden "min length 4".
12. **Vendor card:** "10 steps · 5 new · 6 changed". The choice node is counted as a change.

## Top 5 changes
1. **Count and gate integrity:** coverage, steps left, Ready vs locked.
2. **RACI and separation of duties:** RACI per step plus BPMN `potentialOwner`; owners can't approve their own part; two-person override.
3. **Parser fidelity:**
   - "Otherwise" as the else branch;
   - reject ends the process;
   - articles stripped;
   - "Role (Name)" recognised anywhere in a line;
   - a systems dictionary;
   - SLA as a boundary timer;
   - import boundary events.
4. **Enterprise trust:** a SOC 2 Type I date, a pen test, SAML/Okta, a vendor-continuity plan.
5. **Profiling depth:** uniqueness and cross-field rules; show every spec rule (lengths) on the data page.
