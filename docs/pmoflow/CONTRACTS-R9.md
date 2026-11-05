# PMOFlow round 9: one truth, enforced

**Why this round.** Round 8 built `projectTruth`, but several screens still count for themselves:
- home, process map, step page, portfolio;
- "Waiting for you";
- the testing panels;
- the approval cards;
- the Launch page.

Both round 8 reviews independently name this as the one thing that keeps PMOFlow from an A.

**Round 8 grades:**
- **Usability:** T3 blocking C/D, T4 on track C/D, T5 approve D/F. Building tasks are B to A.
- **Blind buyer:** Tracking C+ and Test C+. The rest are B to A-; Diff A-, Data B+, Rollout B+.
- Details are in `R9-QUEUE.md`.

**Rule #1 still governs.** A manager must be able to answer "is it on track, what's blocking, who acts" in **one glance**, with every screen saying the same thing.

## 1. One vocabulary for "late" (engine E, every page)

**Simple mode has exactly one notion: a task is _late_.** A task is late when it is not done and either of these is true:
- its due date is before today, or
- its forecast finish is after its due date.

In Advanced, the breakdown may say "past due" or "will finish after its due date". In Simple, everything says "late".

**Project status labels:**

| Label | Colour | When |
|---|---|---|
| **On track** | green | nothing is late, there are no unplanned blockers, and the forecast is on or before the deadline |
| **Some tasks late** | amber | there are late tasks, but the forecast is still on or before the deadline. (Lead ruling: a *planned* blocker alone stays **On track**, and the sentence names it: "X is not available yet; work is planned to get it".) |
| **Will miss the deadline** | red | the forecast is after the deadline, or there is an unplanned blocker. Advanced may keep the label "At risk". |

The words "On track" never appear when anything is late.

**Status sentence.** It always states the forecast and the deadline, then the late count and the first name to act. For example:

> "Expected Nov 25, 14 business days before the Dec 15 deadline. 7 tasks are late; first: “Set up the bank details form” (Leo Park)."

**`projectTruth` additions:**
- `late` (one list) and `lateCount`.
- `pastDueCount` and `finishAfterDueCount` (Advanced breakdown).
- `who`: **one ranked list** of `{person, what, why, href}`, ranked as follows:
  1. unplanned blockers;
  2. past due;
  3. late items delaying others;
  4. other late items;
  5. approvals ready;
  6. tests to run.

  The project header, the "What's blocking" box, "Who needs to act", Up next, the report "Asks", the home card and the step page all render from `who` (top N). A separate "What's blocking" box is allowed only as a filtered view of `who` (`why === 'blocker'`).
- `stepsLeft`: **one number**, equal to `launchSteps.filter(s => !s.done).length`. The report, the Launch page and the checklist all use it. "Not ready to launch: N steps left" must equal the checklist's undone count.

## 2. One personal queue (engine E, page P)

- **New engine function** `personQueue(docs, person, today) -> [{kind, projectId, id, title, due, late, href, oneTap}]`. It lists every open item for that person:
  - work items (late, or due within 10 business days);
  - fix tasks;
  - confirmations;
  - approvals that are ready;
  - tests assigned to them;
  - UAT practice reviews.

  It is sorted by the `who` rank.
- The Home "Waiting for you" list renders **exactly** this list. The badge equals `list.length`. The header bell uses the same count.

## 3. Business-day calendar everywhere (engine E, seed A)

- **Due dates, forecasts, start dates and launch windows never land on Saturday or Sunday.** The forecast rolls forward to Monday. Seed dates are normalised.
- **"Days behind" or "late by" is always in business days**, and labelled "business days" or "work days". Calendar-day arithmetic is never shown.
- **Done dates use the client `today` (local).** No `new Date().toISOString()` slice on the server for a done date (bug B8).
- **The launch window** shows as "Mon Nov 16, 8:00–10:00 AM", never as an ISO date.

## 4. Plans that are feasible and owned (engine E)

- **`suggestWorkFromDiff` owners:** each task is owned by the step's owner. If the step only has a role, the task gets `ownerRole`, and Simple shows the role ("Clerk"), never the PM, as a fallback. The PM is used only if the step has neither (bug B11).
- **Accepting a plan never produces late tasks on day 0.**
  - The plan is levelled to people's capacity **before** it is shown.
  - Each due date equals its forecast finish plus a buffer of at least 0.
  - The "done by about X" date in the dialog **equals** `projectTruth.forecastFinish` after Accept (bug B7).
  - If the plan cannot fit the deadline, the dialog says so before Accept: "This plan needs until Dec 20, past your Dec 15 deadline."
- **"Start a project from this Future"** is only enabled when the diff has at least one change. Otherwise it is disabled, with the hint "Change a Future step first".
- **New-project launch steps** derive team names from the process's actual teams (bug B10). Nothing is hard-coded to "Procurement".

## 5. Earned value that holds up (engine E)

- **EV = Σ(budget of tasks done)**, using percent-complete only for tasks with logged progress. A task with 0 done and no progress earns 0 (bug B5).
- **SPI is shown only once PV > 0 and at least one task has started.**
- **In Advanced, when SPI < 0.95 and the label is "On track",** the status shows "Behind plan on effort (SPI 0.87)". This is an Advanced-only note; the Simple label is driven by §1.

## 6. Testing: one count (engine E, page R)

**`projectTruth.testing` is the only source.** It has these fields:

| Field | What it holds |
|---|---|
| `needTests` | information the project changes |
| `haveTests` | information that has at least one test |
| `total` | number of tests |
| `passed` | tests that passed |
| `failed` | tests that failed |
| `notRun` | tests not yet run |
| `stage` | `'create'` \| `'tryout'` \| `'business'` \| `'done'` |
| `next` | one plain sentence |
| `perBU` | `{bu: {total, passed, failed, notRun}}` |

**Rules:**
- **Only one "next" message.** Every screen shows the same sentence:
  - "Add tests for 2 new pieces of information" when `stage === 'create'`;
  - "Run the 19 tests that haven't run" when `stage === 'tryout'`;
  - "Fix 1 problem, then re-run its test" when a test has failed;
  - "Ready for business sign-off".
- **"Tests passed" on the Launch step** uses the same sentence. A step label never reads "Create the tests" (bug B3).
- **Per-BU counts depend only on the information and steps that BU owns.** Completing an unrelated task must not change another BU's test count. An engine unit test enforces this.
- **Open problems block "We have it".** Information with an open defect shows "Has a problem" (amber) in Simple and counts as not ready, even if its fix task is done (bug B14).
- **The report's "Asks"** show a defect as "Fix the problem: …" (bug B13).

## 7. Approvals you can actually do (seed A, pages R and P)

- **The seed contains one part that is ready for approval.** Compliance on Vendor Onboarding Modernization has all its items done and its tests passed. The approver is a seeded department-head person, available in "Viewing as" (e.g. "Dave Ortiz, Head of Compliance"). The rest stay "not ready".
- **Waiting cards are clickable.** They open the part page, which shows "Not ready for your approval yet: waiting on …", with the list taken from `buReady`.
- **One count per part.** "Waiting on N" = `perBU.notRun + perBU.failed + open items`. "Tests for this part" uses the same `perBU` numbers.
- **The extra sign-in check stays,** but in Simple it is a single field labelled "Enter the 6-digit code from your phone". The demo note stays.

## 8. Data owners and the data page (engine E, page D)

- **The owner of new information defaults to the owner (or role) of the step** where it is added, on the map, in import and in the project. It is never "—" and never the person who mapped it (finishes round 8 §1).
- **The data page is consistent:**
  - the sample count equals the samples shown;
  - "made-up sample" counts as a sample, labelled "Practice sample";
  - rules are deduplicated (bug B12).

## 9. SOP import (page D, engine E if the parser lives there)

- **Each condition attaches to its own step** (bug B1). A clause like "if not returned within 5 days, notify Legal" belongs to the step it is written in.
- **"If OK, forwards to X":**
  - **Yes** → X;
  - **No** → **ends the process** ("Stop: request rejected"), unless the text says otherwise.
- **`Role (Name)`** → the owner is that person, if they exist; otherwise the role is kept and the name is put in the note.
- **The step count shown equals the number of parsed steps.**
- **The process name** is derived ("Employee offboarding" from the title line, or from "Procedure: X"). It is never the first step text (bug B2). If nothing can be derived, the name is left empty and focused.
- **System nouns** (ServiceNow, HRIS, ERP) become `system` on the step.

## 10. Phone and chrome (lead: main.js, styles.css, index.html, ui.js)

- **Phone header (≤ 600px):**
  - one row: logo, page title, ☰ menu, bell;
  - the menu holds the nav, "Viewing as" and the Advanced switch;
  - header height at most 56px.
- **Desktop:** the Advanced switch moves into a small "⚙ View" menu next to "Viewing as" (it stays reachable in one click).
- **Escape closes every modal and drawer** (bug B15). Focus returns to the trigger.

## 11. Simple-mode jargon (all streams own their pages)

**Replace these in Simple:**

| Current | Simple-mode text |
|---|---|
| "Rules-based", "deterministic rules" | "Written from the project's facts" |
| Regenerate | Refresh |
| Forecast cost | Expected cost |
| connected | available |
| defect | problem |
| system test / Try-out test | "Try it out" |
| Business sign-off test / UAT | "Business check" |
| UAT folder | Business check scripts |
| dev run | test run |
| Revoke | Remove access |
| Audit log | History |
| Sub-step | Detail step |
| "Doesn't go back" | "Ends here" |
| "WAIT · 2" | "Wait up to 2 days" |

- The glyphs ◆ and ⫴ appear only with a text label.
- BPMN appears in Advanced only.

**Grammar:**
- Task titles inside sentences are always quoted: “X”.
- Pluralise correctly ("1 needs fixing").
- "Finish X" becomes "Finish “X”".

**Small items:**
- The "or a choice…" link must not look struck through.
- The empty "What starts it?" card shows an example placeholder ("e.g. A vendor sends a request").
- The step-dialog availability help text is identical in Today and Future, apart from the default.
- Simple mode never shows the same item in two lists with different states.

## 12. Enforcement (stream P owns the e2e; E owns the unit tests)

**`e2e-consistency.js` is extended.** For every seeded project, plus a newly created project after Accept, it reads the following from:
- the project header, home card, "Waiting for you", step page, process map badges, portfolio row, Launch page, Testing page, approval cards, status report and CSV.

It asserts that these are equal:
- **late count:** the map badges with "Late" equal `lateCount`;
- **status label;**
- **first name in `who`;**
- **steps left;**
- **tests: total, passed and next;**
- **per-BU counts;**
- **forecast and deadline;**
- **queue length equals the badge.**

**It also asserts:**
- no weekend dates appear anywhere in the rendered text;
- "On track" never appears together with a late count above 0;
- a freshly accepted plan has 0 late tasks.

**Unit tests (E):**
- EV is 0 for untouched tasks;
- per-BU test isolation;
- business-day forecast rolling;
- personQueue completeness;
- parser bugs B1 and B2;
- owner carry-through.

**No-local-counting lint (P):** a test that greps `app/pages/*.js` for local late or blocker computations (`String(x.due) < today`, `sched === 'late'` counts). It fails unless the line is inside an allow-listed render of `projectTruth` or `personQueue` output.

## Streams

| Stream | Owns | Round 9 work |
|---|---|---|
| **E** engine | `api/shared/pmoflow-engine.js` (copy byte-identical to web) and `engine.test.js` | §1–6, §8 owner default, §9 parser if it is in the engine, unit tests. **Lands first; publish the API names in this doc's appendix.** |
| **A** API, seed, AI | `api/pmoflow/index.js`, `pmoflow-seed.js`, `pmoflow-ai.js`, `pmoflow-store.js`, `api.test.js` | §3 server done dates use `today`; seed weekend normalisation, ready-to-approve Compliance part, the department-head person, a cross-project conflict kept; AI prompt and fallback use the §1 sentence and the `who` list. |
| **D** design pages | `process.js`, `step.js`, `data.js`, `processes.js`, `importsop.js`, `css/design.css`, `e2e-design.js` | Map and step badges from truth; §4 Start-project gating; §8; §9; §11 for its pages. |
| **P** PMO pages | `home.js`, `project.js`, `projects.js`, `portfolio.js`, `dashboard.js`, `css/pmo.css`, `e2e-pmo.js`, `e2e-consistency.js` | §1 `who` rendering, §2 Waiting for you, §5 Advanced note, §12 consistency plus lint, §11 for its pages. |
| **R** release and testing | `release.js`, `testing.js`, `css/release.css`, `e2e-release.js` | §6, §7, §3 launch-window format, §11 for its pages. |
| **Lead** | `store.js`, `ui.js`, `main.js`, `styles.css`, `index.html` | §10, then the full regression, deploy and reviews. |

## 13. Concept-review additions (round 8 concept reviewer)

**Pillar grades:**

| Pillar | Grade |
|---|---|
| Map | A- |
| Ease | B |
| Data | A- |
| Drill | A |
| **Status** | **C** |
| Views | B+ |
| **Gate** | **C** |
| Access | B+ |
| **Testing** | **D+** |
| **AI** | **C** |
| Standalone | B+ |
| CX | B- |

**Gate deadlock (R, engine E; the highest priority after §1):**
- **Repro:** a project where only one team's step changes gets approved. Launch then says "Waiting for Procurement", but Procurement's page says "doesn't need to approve anything", so Launch is disabled. The underlying cause is the "two different people" rule.
- **The launch gate and the approver pages must read one function:** `buReady` / `projectTruth.approvals` = `[{bu, needed, ready, approved, approver, blockedBy}]`.
- **A team that "doesn't need to approve" is never a gate condition.**
- **When the separation-of-duties rule blocks**, Simple shows it plainly with the fix: "Tom recorded these tests, so someone else in Procurement must approve. Choose who: [person picker]". It must never be a silent dead end.
- **After launch, the approvals list shows every team that approved** (it must not drop IT).

**Launch can't jump the gate (R):** "Launch now" is disabled before the launch window or while launch-day steps aren't done. Advanced keeps an "Override with reason" action, which is logged.

**Data-driven tests (E §6, R):**
- **Generated tests must come from the uploaded sample's actual values and their problems:**
  - one "should be accepted" test per distinct valid pattern seen;
  - one "should be rejected" test per problem found: blank, wrong length, bad characters;
  - edge characters seen (apostrophe, accent) become "should be accepted" tests unless a rule forbids them.
- **The profile line must flag what the rules reject.** For example, "E-77" with an ID rule of `E\d{5}` means a "1 doesn't match the pattern" line.
- **Never invent vendor names** for fields whose sample is about people.
- **A test is linked to the sample row it came from** (Advanced shows "from sample row 2").

**Testing page (R):**
- A step can never show "Done" while it has 0 tests, or while not all of its tests have passed.
- The header and the steps read `projectTruth.testing`.

**Status report (A and E):**
- **Dependencies must be real:**
  - "waiting on X" only for real dependency edges;
  - never for tasks that merely run in parallel.
- **"Expected cost" appears only when a budget or rates exist.** Otherwise the cost line is omitted in Simple.
- **Steps left = `stepsLeft`.**

**Raw IDs never shown (all pages):** history and diff values resolve person ids to names. Use "(none)" → "Nobody". A raw id such as "dk" is a defect.

**Testing "Show advanced tools" (R):** it stays local to the page; it must not flip the global Advanced mode.

**Step editor availability (D):** use a positive "We have it" switch, on by default for Today. Ticking "Not available yet" must not read as inverted.

**Teams vs systems (D, R):** "Teams involved" lists teams only. Systems get their own "Systems touched" line.

**Launch-day plan form (R):**
- The default runbook step is prefilled.
- The undo owner defaults to the PM.
- The step row is not cramped on desktop or at 390px.

**Access card (R):** the duration on the card shows what was asked for ("7 days"). It must not show a maximum such as "up to 30 days".

**"10 steps · 11 changing" (D):** use "10 steps · 6 changed · 5 information changes", or another phrasing where the counts make sense.

## Lead changes landed (§10): read this before your phone e2e

**Header markup:**
- `index.html` header is: `#brand`, `#menuBtn` (☰ Menu, phone only), `#topmenu` (contains `#nav`, `.who` with `#persona` and `#viewmenu` details → `#adv`), `#bell`.
- **Desktop (>640px):** looks as before. `#adv` now sits inside the closed `<details id="viewmenu">` ("⚙ View"). `isChecked('#adv')` still works. To click it, open `#viewmenu summary` first, or use `store.setAdvanced`.

**Phone (≤640px):**
- The header is 56px: brand, Menu, bell.
- `#nav`, `#persona` and `#viewmenu` are hidden until `#menuBtn` is clicked (`header.top.open`).
- Phone e2e that select a persona or read nav links must click `#menuBtn` first.
- Clicking a nav link closes the menu.

**Escape:**
- Escape is now global (in `ui.js`). It closes the top-most `.overlay` modal, else the `.drawer`, else the open menu.
- Focus returns to the trigger.

**Extra sign-in check:** the field label is "Enter the 6-digit code from your phone".

## Appendix: R9 engine API (stream E)

`PMOEngine` / `require('api/shared/pmoflow-engine.js')`. Paths in `href` are app paths: wrap them with `link()`.

**`projectTruth(docs, prj, today)`** is the one source. New and changed fields:

| Field | What it holds |
|---|---|
| `late`, `lateCount` | §1 one late list: open tasks past due **or** forecast after due |
| `pastDue`, `pastDueCount`, `finishAfterDue`, `finishAfterDueCount` | Advanced breakdown (`runningLate*` = deprecated alias of `finishAfterDue*`) |
| `label` | `On track` \| `Some tasks late` \| `Will miss the deadline` \| `Not planned`; `labelAdvanced` uses `At risk` for red |
| `sentence` | "Expected Nov 25, 14 business days before the Dec 15 deadline. 5 tasks are late; first: “Set up the bank details form” (Leo Park)." |
| `who` | ranked `[{person, name, what, why, href, ref, rank, action}]`; `why` ∈ `plan, blocker, past-due, deadline, delaying, late, info, problem, approval, test` (rank in that order). `action` = `what` (R8 alias). "What's blocking" = `who.filter(x => x.why === 'blocker')` |
| `stepsLeft` | `launchSteps.filter(s => !s.done).length` |
| `testing` | `{needTests, haveTests, total, passed, failed, notRun, stage, next, perBU: {bu: {total, passed, failed, notRun}}, problems, done, count, sentence, stages, nextAction: {key, label: next}}`. `stage` ∈ `create, tryout, business, done`; `next` is the one sentence (also the Launch "Tests passed" action) |
| `approvals` | `[{bu, needed, ready, approved, stale, approver, approverName, eligible, suggestion, blockedBy, waiting, waitingOn, sentence}]`; `blockedBy` = `null` or `{rule: 'separation-of-duties' \| 'no-approver', person, text, fix, suggestion}`. After launch: every team that approved |
| `advancedNote` | "Behind plan on effort (SPI 0.87)" or `null` (Advanced only) |
| `cost.show` | `false` when there is no budget and no person rates (omit "Expected cost" in Simple) |
| `ev.SPI` | `null` until PV > 0 and a task has started (done, logged progress or logged hours); EV counts only done work and logged progress |

**New functions:**
- `personQueue(docs, person, today)` → `[{kind, projectId, projectName, id, title, due, late, href, oneTap, why, rank, what}]`, sorted by `who` rank. `kind` ∈ `work, fix, problem, practice, approval, test, information, confirm, action`. `oneTap` = `{action: 'done'|'confirm', label}` or `null`. Home badge and bell = `list.length`.
- `suggestWorkFromDiff(docs, projectId, today)`: tasks carry `owner` (the step owner), or `owner: null` + `ownerRole` (show the role); the PM only when the step has neither. Levelled per person; each `due` ≥ its forecast once accepted.
- `planToWork(projectId, suggestions)` → the exact work items Accept must store.
- `planFit(docs, projectId, today, suggestions?)` → `{forecastFinish, deadline, fits, lateCount, message}`. `forecastFinish` equals `projectTruth.forecastFinish` after accepting `planToWork(...)`. Message: "Done by about Dec 1, 10 business days before your Dec 15 deadline." or "This plan needs until Dec 20, past your Dec 15 deadline."
- `waitingOn(docs, workId)` → `[{id, title, owner, kind: 'dependency'|'information', dataId?}]`: real edges only (report "waiting on X").
- `dataOwner(docs, dataId)` → `{person, role, name}`; `defaultDataOwner(step)` → `{owner}` or `{ownerRole}` for new information on a step.
- `displayValue(docs, value)`: a person or information id becomes a name; empty or `(none)` becomes "Nobody". `namesFor(docs)` → `{person(id), data(id)}`.
- `diffProcess(process, docs)` and `diffVersions(a, b, docs)`: with `docs`, change text uses names ("Owner Maya Chen → Nobody", "Information added: …").
- Calendar: `isBusinessDay(d)`, `toBusinessDay(d)` (weekend → Monday), `fmtDay(d)` ("Nov 16"), `fmtDayLong(d)` ("Mon Nov 16").

**Changed behaviour:**
- `forecastAll` results add `late` (boolean) and `pastDueDays`; `slipDays` is now business days; weekend due dates count as the next Monday; no forecast lands on a weekend.
- `scheduleBadge` → `{key, label, advancedLabel, late, holdsUp}`. `label` is `Late` for both past due (`key: 'late'`) and finishing after due (`key: 'slipping'`). Count the "Late" badges and you get `lateCount`.
- `projectStats.late` = `lateCount`; `.slip` = finishing after due; `.pastDue` added.
- `availLabel` / `effectiveAvail`: information with an open problem (defect with `dataId`, or from its test case, or the only information on its step) is `state: 'problem'` → "Has a problem" (amber), never "We have it". Readiness `data-live` lists it under `problems`.
- `buReady(docs, prj, bu)` adds `needed` and `waitingOn` (= tests not passed + open tasks + information). A team that doesn't need to approve returns `needed: false`.
- Readiness gate: no changed teams → no approvals needed; with one changed team, its single approval passes the two-person rule. A person who recorded every test result of a part can't approve it (`sectionStatus[].sodBlockedBy`), and that part then needs an approver chosen.
- `profileCsv(csv, {dataElement | fields})` checks real values against the rules: `col.check = {rejected, firstRow, blank, wrongLength, badChars, pattern}`, `patterns[].row` / `.valid`, `col.nullRow`. `profileLines` adds "1 doesn't match the pattern". Generated profile tests carry `sampleRow` ("from sample row 2"). Person fields (employee, manager, …) never get vendor names.
- `projectSummary`, `testingSummary` and `launchSteps` return the matching parts of `projectTruth`.
