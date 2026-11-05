# PMOFlow — Round 7: SIMPLICITY (usability panel is gating)

**Rule #1 (founder):** a non-technical user can easily achieve X. If a task is hard or complex, the build is wrong.
- **Nothing is deleted.** Power moves behind **"More options"** / an **Advanced** toggle that the user turns on, saved per browser in `localStorage` (try/catch) as `pmoflow.advanced`.
- The default experience is **Simple**.

## Usability panel, round 6 (the baseline to beat)
| Task | Grade |
|---|---|
| Import SOP | B |
| Find blocker (desktop) | B |
| Map a process | C |
| Start project/plan | C |
| Mark done (phone) | C |
| Future version | D |
| On track? | D |
| Testing done? | D |
| Blocker on phone | D |
| Approve my part | **F** |

**Target:** every task A- or better.

## 1. Home = "what needs me" + three big choices (stream P)
- **Greeting:** "Hi <first name>." A **"Waiting for you"** list sits at the top. Each item is completable **in one tap, on home**:
  - **Approve my department's part:** opens the BU approver view directly in a modal or page (§3).
  - **Mark done:** your open work items due within 7 days or late, with a one-tap ✓ that sets done and `doneAt`.
  - **Data you own that needs confirming:** "Confirm it's connected", which opens the data page's confirm flow.
  - **Access requests to approve.**
  - **Mentions.**
- **Below it, three big cards** with one sentence each: **Paste a procedure you already have** (→ `/import`, the fastest path) · **Check on a project** · **Map a process from scratch**.
- Projects are listed first, then processes. Cards are labelled **Project** / **Process**, with distinct icons. Fix the badge overlapping the title.
- Remove the marketing pitch paragraph.

## 2. Plain language everywhere (all UI streams)
Apply this glossary to labels, buttons, headings and helper text. The underlying data stays the same.

| Current term | New term |
|---|---|
| As-is / To-be / Diff | **Today / Future / What changed** |
| Fork to-be from as-is | (automatic, see §4) |
| Swimlanes | By person |
| Impact | Who's affected |
| SLA | Time limit |
| Touches | Teams involved |
| Gateway / decision / parallel | Choice / At the same time |
| Kickoff / trigger | What starts it |
| Data element | **Information** |
| Live / Examples only / Missing / Pending confirm | **Connected / Sample only / Not available yet / Waiting for confirmation** |
| Baseline | Saved plan |
| Cutover / Runbook | Launch-day plan |
| Go/no-go | Final yes/no check |
| Hypercare | Support after launch |
| UAT / SIT / Dev | Business testing / System testing / Build testing |
| Spec fields | Rules to test |
| Profile | Check sample data |
| Scenarios | End-to-end tests |
| Step-up MFA | Extra sign-in check |
| Attestation note | What you checked |
| Access grants | Temporary data access |
| Release manager | Launch owner |
| Resolver | Fix |
| Slipping / Causing slip | Running late / Delaying others |
| Amber | **At risk** |
| Red | **Off track** |
| Green | **On track** |

- Hidden in Simple mode: BPMN, SPI/CPI/EAC/earned value, parser notes, "top-level nodes", "in-tenant", rules engine wording.
- Tooltips may keep the professional term in brackets ("Business testing (UAT)").

## 3. Approvers can always approve their part (streams E + R)
- **The engine separates "my section approved" from "gate passes".**
  - `bu-signoff` counts an approval any time.
  - It's still **stale** if the section changes afterwards.
  - The gate needs all checks; sign-off is no longer locked behind them. **Remove the lock** (`signoffOpen` becomes informational).
  - The approver sees "Your part is approved. The launch still needs: <plain list>".
- **One-screen approver view** (already built, `?bu=`). In Simple mode it shows only:
  - their steps (what changed, in plain words);
  - their information status;
  - their test result in one line;
  - a **big Approve button**;
  - a "What you checked" box with a sensible default suggestion ("I reviewed the changes to <steps> and the test results");
  - the extra sign-in check.
- **Reachable from home** (§1) and from the notification.

## 4. Mapping a process in minutes (stream D)
- **Step dialog, Simple:** three fields:
  - **Step name**;
  - **Who does it**: a person **or a free-text role** ("Employee", "Manager"). Store `ownerRole` when it isn't a person, and show it on the card;
  - **What information it needs**: type to add, with chips. New information defaults to **"Connected (we have this today)"** on the Today map, and to "Not available yet" only when added on Future.
  - Everything else (time limit, system, duration, teams involved, sub-steps) goes under **More options**.
- **Future version is automatic:** the first time a user opens **Future**, it's created from Today (no fork button or confirm). Tabs: **Today · Future · What changed** (By person and Who's affected live under More options). A one-line hint on Future: "Change steps to show how it should work. We'll highlight what changed."
- **Process header (Simple):** name, one-line description, the tabs, and a **"⋯ More"** menu holding Version, Compare, BPMN import/export, Undo and Save version.
- **Quick-add:** pressing Enter in the step name adds the step and opens the next one ("keep typing to add steps").
- **"What starts it"** is a placeholder, never a literal value.

## 5. "Are we on track?" in one sentence (streams E + P)
- **Engine `projectSummary(docs, prj, today) -> {sentence, rag, label: 'On track'|'At risk'|'Off track'|'Not planned', who: [{person, action}]}`.**
  - One plain, non-contradictory sentence. Example: "Expected Nov 26, about 3 weeks before the Dec 16 deadline. Bank details are late and holding up 3 steps (Leo Park)."
  - **The label is consistent with the sentence.** At risk = "finishes on time but something needs attention"; the sentence must say what.
- **Project header (Simple):** name, the summary sentence plus label, the **"What's blocking"** card (top 3, with who acts), and view tabs **Plan (map) · Timeline · Work**.
  - Board and Sprints only under More options / Advanced.
  - SPI, CPI and EAC only in Advanced.
  - Buttons the persona can't use are hidden, not greyed.
- **Phone:** the "What's blocking" card and "Up next" render **above** the map.
- **Mark done:** on the project, each of my items has a ✓ that's easy to reach on a phone. Deep links from home scroll to and highlight the item.
- **New project form, Simple:** Name, From which process, Deadline (default from `defaultTarget`). The PM and launch owner default to me. Everything else goes under More options. **After creating, run "Suggest a plan" automatically** and show it for one-click accept ("Here's a first plan: 6 tasks. Accept · Adjust").
- **The status report uses the same sentence.**

## 6. "Is testing finished?" in one line (streams E + R)
- **Engine `testingSummary(docs, prj) -> {done: bool, sentence, nextAction}`.** Example: "Not yet: 2 business tests haven't been run and 3 rules have no test. Next: generate the missing tests."
- **The testing page (Simple) leads with that sentence** and one primary button for the next action. The coverage matrix, cycles, JUnit, scenarios and defect lifecycle sit under More options. Build testing is hidden unless Advanced is on.

## 7. Release page (Simple) (stream R)
- **Leads with one sentence:** "Ready to launch" / "Not ready: 3 things left", with the plain list and who needs to act, each with a one-tap action where possible.
- Launch-day plan, temporary data access, audit log and support after launch are collapsible sections, all closed by default except what blocks launch.

## 8. Global (lead)
- An **Advanced toggle** in the "Viewing as" area ("Show advanced tools"). The store exposes `store.advanced` (boolean) and `store.setAdvanced(v)`. Pages read it.
- Nav labels: Home · Processes · Projects · Launch · Testing · Portfolio. The Dashboard shows only in Advanced.

## 9. Concept review (round 6) additions
- **Ship-blocker, the PMO deadlock:** a business unit section with no eligible approver must never dead-end.
  - The section card offers **"Choose who approves this part"**: a person picker (anyone except the PM and the launch owner), stored in `project.approvers {bu: personId}`. The engine counts that person as eligible.
  - If the only BU member is the PM, the default suggestion is the process owner.
- **Re-approval scope:** only BU sections whose own steps, data or tests changed go stale. Cutover/launch-plan changes make stale only the sections whose runbook tasks they own, plus the launch owner's own check. Never all sections for one owner change.
- **The project's next steps are visible from day one:** a **"Steps to launch"** checklist on the project side panel (Simple) and on home, using the same readiness checks in plain words, showing what's done and what's next, with who acts.
- **Profile → rules in one click:** after checking sample data on information with no rules, offer "Use these columns as the rules to test", which creates the spec fields from the profile columns. Observed min/max become boundary tests.
- **Consistent state labels:** one engine function `availLabel(docs, dataId) -> {key, label, tone}` used on every page: Connected / Sample only / Not available yet / Waiting for confirmation.
- **Test evidence the approver can trust:** the approver view shows "33 business tests passed by Priya on Nov 4: evidence: <first note>…", and flags a bulk pass with one shared note as "passed together".
- **Small fixes:**
  - "Generate test cases" with no rules says "Add rules first (or use your sample data)", not "all already exist".
  - Home card badge overlap.
  - SPI/CPI never show in Simple.
  - Report dates use the client's today.
  - Suggest-work help text matches the actual dependency behaviour.
  - Phone header Advanced toggle has an aria-label.
