# R12 re-review: Jordan (PMO Coordinator at a benefits administrator, came in from search)

## Verdict
- **Demo:** yes.
- **Pilot:** yes, the $2.5k pilot.
- **Contract:** Business, about 5 editors, $3.9k/yr.
- **Note:** PMOFlow did not come up in Jordan's searches, even for its exact tagline. Organic search isn't working yet.

## Scorecard (capability / ease)

| Category | Grade | Flag |
|---|---|---|
| C1 | B/B | |
| C2 | A/A | ONLY |
| C3 | A/B | ONLY |
| C4 | A/A | ONLY |
| C5 | B/B | |
| C6 | B/B | |
| C7 | C/B | |
| C8 | A/A | ONLY |
| C9 | B/B | |
| C10 | **A/B** | ONLY (was B-) |
| C11 | B/C | |
| C12 | B/B | |
| C13 | **A/B** | ONLY |
| C14 | A/B | ONLY |
| C15 | C/B | |
| C16 | C/C | |
| C17 | C/C | |
| C18 | D/C | |
| C19 | B/B | |
| C20 | C/B | |

## Re-tests
- **Fixed:**
  - Approver identity is consistent across views.
  - Seeded sign-offs come from department heads, and refusals name who must approve instead.
  - The override is findable and requires two people, with both reasons logged.
  - The access table now shows real statuses.
  - The cross-project knock-on is logged in the other project and moves its date.
  - Phone layout: no horizontal scroll. Some secondary text is 8–10px, some labels are cut off, and some tap targets are under 32px.
- **Partly fixed: the self-assign loophole.** Passing other people's tests directly is refused. But Ana (AP) can go to advanced tools and assign the four Compliance tests to herself without any refusal, then pass them with step-up. Dave's approval page doesn't show that AP passed Compliance's tests.
- **Plan change past tolerance:** step-up now works, but the requesting PM approves his own change, and also approves for the affected ERP project because he's its PM too.
- **Test counts still disagree.**

## Mismatches
1. **Report vs History vs Testing.** The report says "18 passed, 1 failed (3 runs)"; History shows 2 runs; Testing shows 7/8 try-out and 9/26 business. Re-passing 4 tests raised the report to 22 while Testing stayed at 9/26. The report sums runs instead of using each test's latest result.
2. **Total business tests.** The business total says 26; advanced tools show 14 + 18 = 32. The matrix shows "Vendor legal name 0/2" and "Approver matrix 0/4", but the dialog lists 8.
3. **Approvals.** Launch says "1 of 5 teams approved"; the report says Procurement and Compliance approved, and doesn't flag that Procurement must approve again.
4. **Launch history** says "0 exceptions" for an override launch: outside the window, with a step still open.
5. **Approval page** says "9 of 9 marked at once with one note" after 4 tests were re-recorded individually.
6. **Launch dialog** says "Approved again after changes: 1 change", but both Compliance and IT re-approved.
7. **Launch progress.** Basic says "6 steps left"; Advanced and phone say "9 checks not passed". It also says "Tests Blocking 18" against 16 not run + 1.
8. **Verify messages.** CSV verify mentions the development key; JSON verify doesn't.

## Other
- Weekly report and custom range are good. A From date after the To date is silently swapped.
- Connections and the simulated Jira are good.
- **Import entry points:** Visio works from the "Map a process" dialog, but the process name comes through blank. The /import page link and the Processes "Import Visio or BPMN" button did nothing and showed no error (may be headless-only; Unverified).
