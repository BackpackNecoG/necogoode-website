# PMOFlow — Round 8: ONE TRUTH, NO MAKE-WORK (all three R7 reviews converge)

**All three reviewers agree.** The remaining problem isn't missing features. The app's own messages contradict each other, and it creates work nobody needs.

**R7 usability panel:**
| Task | Grade |
|---|---|
| Approve | A-/B+ |
| Blocker (phone) | A- |
| Future | B+/A- |
| Mark done (phone) | A- |
| Map | B/B- (C on phone) |
| Import | B-/B |
| Testing | B-/C |
| On track? | **C** |
| New project + plan | **C-/D** |

**Concept reviewer:**
| Pillar | Grade |
|---|---|
| Ease | C+ |
| Data and blockers | B |
| Status | B- |
| Testing | C+ |
| CX | B- |
| Drill | A- |
| Views | A- |
| Access | A- |
| Standalone | A- |

**Blind buyer:**
| Phase | Grade |
|---|---|
| Plan | C+ |
| Tracking | C |
| PMO | C+ |
| Diff | A- |
| Data | B+ |
| Rollout | B+ |
| Test | B |

## 1. Information that exists today is available (the #1 fix from all three)
- **Simple mode has two states:** **"We have it"** (the default for anything added on Today, and for anything in the Future that was already on Today) and **"Not available yet"** (the user ticks it; the default only for information that's *new* in Future and doesn't exist today).
- **Engine:**
  - `effectiveAvail` treats information that appears on any Today step (`asis`) as `live` **unless explicitly marked missing**.
  - The owner-confirmation/evidence requirement applies **only** to information the project is *changing*: missing → fixed by a resolver, or new in Future.
  - **When the information owner marks its fix task done, that counts as their confirmation** (`liveConfirmed` auto-set, with evidence "Fix completed by <owner>"). A separate owner who isn't the task owner still gets one "Confirm" tap.
- **Confirm several at once:** a "Confirm all" list for an owner, with one note.
- In Simple, the words "connected", "waiting for confirmation" and "sample only" are not shown. Advanced may show the detailed state.
- **New information's owner defaults to the step's owner** (or role), not to whoever mapped it.

## 2. One truth for every number, date and label
- **Engine `projectTruth(docs, prj, today) -> {...}`** is the single source of the following. Every page, the status report, the CSV, the dashboard and the portfolio must read these values from it and never recompute:
  - forecast finish
  - target
  - days of buffer (**business days**, one unit everywhere)
  - late count
  - running-late count
  - blockers list (the same list everywhere)
  - status label and sentence
  - launch steps
  - testing summary
  - cost: planned, actual (= logged hours × rate), forecast-at-completion
  - EV (SPI/CPI/EAC, **where EAC is the one cost forecast**)
  - burndown status
- **Status rules:**
  - **At risk** only when the forecast misses the deadline or there's an unplanned blocker.
  - "On track, some tasks running late" otherwise.
  - **"All work is done" / "Nothing needs attention" can never appear while blockers exist.**
  - SPI and burndown must agree in direction, or burndown shows only on Sprints.
- **Dates:**
  - "Today" is the user's local date everywhere: the client sends `today` on every API call, and the server uses it for display dates and for releases and approvals.
  - Timestamps are rendered in the browser's local time.
  - Something due today is **not** late.
  - Done dates are shown identically on the board, step page and timeline.
- **Consistency e2e** (new, `tests/pmoflow/e2e-consistency.js`, owned by stream P): for each seeded project, read the forecast, late count, blockers, status label and costs from header, home card, portfolio row, status report and CSV, and assert they're equal.

## 3. No make-work in plans
- **suggestWorkFromDiff / first plan:**
  - Tasks only for **changed or new** Future steps, and for information marked **Not available yet**.
  - Never tasks for unchanged steps or for information "We have it".
  - Wait/message nodes create no build tasks.
  - Tasks are spread across the **people who own the steps**, with sensible effort (default 3 business days), sequenced toward the deadline. A new plan is never late on day one.
- **One plan screen everywhere:** the simple "Here's a first plan: N tasks. Accept · Adjust" card. "Adjust" opens the detailed editor (Advanced vocabulary allowed there). The old "Suggest a plan" dialog is replaced by the same card.

## 4. Testing that makes sense
- **Two stages in Simple:** **"Try it out" (system test)** and **"Business sign-off test"**. Build testing and test IDs (TC1), "expect accept/reject" and coverage language are Advanced only.
- **One number:** "6 of 34 tests passed" (from `projectTruth`). "Create the tests" is a single button that generates for **all** information in one press (no skipped items), with a sanity filter:
  - values must match the field's type (no "Net 30" for a photo, no "Aab" for Yes/No);
  - bad values seen in samples become **"should be rejected"** tests, never accepted;
  - at most about 6 tests per field by default.
- **Tests are needed only for information the project changes** (new, fixed or rule changes). Unchanged "We have it" information needs no tests.
- **UAT scripts are runnable without "adopting".** Generated scripts are live by default, and editing saves them.
- **Any run counts** toward its stage. A "System testing" run satisfies "Try it out"; there's no separate build gate in Simple.
- **Profile results show in Simple** as one plain line per column ("Tax ID: 40 values, 1 is too short").
- "Check sample data" is Done only when a sample was actually checked.
- **Masking hides all digits** of identifier-like fields (no first/last digit).

## 5. Approvals that happen once
- **Request approval when the evidence is ready:**
  - Home's "Approve my part" appears only once that BU's own items (its steps' work, its information, its tests) are complete.
  - Before that, the approver view says "Not ready for your approval yet: waiting on X" (approving early stays possible in Advanced, with a warning that it may need redoing).
- **Teams whose part didn't change don't need to approve** (no section, unless they own launch-plan tasks).
- **Staleness is precise:** a test result only stales the BU whose information/steps that test covers.
- **Prefilled "What you checked"** is built from facts ("3 changed steps reviewed; 12 of 12 tests passed"), never boilerplate.

## 6. SOP import that never invents
- **Actors:**
  - a team or role ("Procurement", "Compliance analyst") → `ownerRole` with that text;
  - a full person name → that person;
  - never the current user.
- **Step titles:** the action only ("Create purchase order"). The actor is stripped out, and long sentences are shortened.
- **Extract:**
  - SLA phrases ("within 2 business days") → time limit;
  - system names (ERP, …) → system;
  - "Owner: X" lines → owner;
  - "otherwise skip to step N" → goto;
  - "Wait for …" → wait node;
  - money thresholds → decision (Yes = the conditional action, No = continue);
  - information nouns (amount, cost centre, budget code, quotes) → information.
- **Save flow:** "Save as how it works today" opens **Today**; the Future is created on first open.

## 7. Phone
- **Process page:** the map comes first, side panels collapse below it, and branch cards fit within 390px (no clipping).
- **Add step:** on a phone, the "Add step" button behaves like Enter (stays open); a separate "Done adding".
- **Mark done** shows a toast with **Undo**.
- **Header:** "Viewing as" isn't cut off, the Advanced toggle has a visible label (icon plus "Advanced"), and all nav tabs are reachable.

## 8. Remaining queued bugs (R8-QUEUE.md plus this round's reviews)
- **BPMN re-import:** matches tasks by PMOFlow id in `extensionElements` first, so renames keep their work.
- **Rate-limit (429) page:** one clear message, never blank.
- **Navigation and naming:**
  - breadcrumbs, titles and nav use the same words;
  - "Projects" nav opens a **projects list**;
  - "Check on a project" goes to that list.
- **Wording and display:**
  - no tooltip double periods;
  - defect due dates on business days;
  - leveling explains overloads it couldn't resolve;
  - "Off track" badge never duplicated;
  - launch dialog typo "nothing changes and changes nothing";
  - truncated next-step button text wraps.
- **Permissions:** only the support owner, PM or launch owner can resolve hypercare incidents.
- **Ownership:** a "Records Clerk" role set on the map shows the same everywhere (plan, launch).
- **Risks:** a risk whose linked work is all done shows "Likely resolved: close it?" in the register.
- **Sidebar:** "Sample only" grouping keeps steps with mixed states (Advanced).
- **Conflicts:** cross-project conflict detection is demonstrated in the seed (two projects touching one step) and visible in Simple as one line: "Another project is also changing this step".
- **"Generate the missing tests"** works (or is replaced by the single "Create the tests").
- **Engine wording:** "Speed up X" → "Get X back on schedule"; no "slipping"/"target" in Simple-facing text; the seed description has no "To-be".
- **Data page:** `?confirm=1` opens the confirm flow.
