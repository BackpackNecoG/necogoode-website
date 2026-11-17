# PMOFlow R10: trustworthy numbers, a buyer path, and deal features

**Inputs:**
- `market-review/CONSOLIDATED.md`: 2 search buyers and 2 expert evaluators. 0 of 4 would sign today.
- **Founder decisions (Nov 17):**
  - Stay on necogoode.com.
  - Name stays "PMOFlow" for now.
  - A pricing page and costing must exist. Stripe comes later.
  - Fix the open bugs.
  - Add the features needed to book a deal.

**Rule #1 still governs:** ease for non-technical users.

**Positioning (founder ruling, Nov 17, supersedes the earlier "overlay" line).** PMOFlow is a complete platform for operational change, whether a team starts fresh or arrives with existing tools.
- **Lead with the outcome, not the stack.** Use: *"Whether you bring your existing tools or start fresh with us, PMOFlow does the heavy lifting for your operations."*
- **Integrations are an on-ramp, never a dependency.** "Keep using Jira/ADO/Planner. PMOFlow syncs with them" is an option, never the premise.
- **Never say:** "overlay", "sits on top of", "requires", "add-on to", or "replace".
- **Never imply anyone has to rip anything out.** Say "No migration project. Connect what you have, or don't."
- **Stay honest about scope.** It is the platform for process change: map → plan → track → test → approve → launch. Don't claim general PPM features we don't have (timesheets, report builder). Don't add them either.

## Lessons applied (why R1–R9 cycled)

- **Streams are organised by job, not by page layer.** Each stream owns whole files. Shared logic lives in the engine, which only S1 edits. New logic goes in new UMD modules.
- **The acceptance bar is fixed before building** (see the end of this document). The same four reviewer personas re-run with the same scorecard. New findings go to a backlog and do not move the bar.

## Streams and file ownership

**Nobody edits files outside their own list.** If you need a change in someone else's file, put it in your report.

**Lead owns:**
- `app/main.js` (routes and nav), `store.js`, `ui.js`, `styles.css`, `index.html`;
- `web/public/staticwebapp.config.json`;
- `api/pmoflow/index.js`. The route-module hook already exists, see below.

**Route-module hook.** `api/pmoflow/index.js` loads `api/shared/pmoflow-routes-{buyer,connect,admin}.js` if they exist. Each module exports `async handle({ method, seg, body, req, store, send, fail, clientIpHash, dayInput, clientToday })` and returns `true` when it handled the request. `seg` is the path after `/api/pmoflow/`, split on `/`. Use a distinct first segment per module:
- `buyer/...` for S3;
- `workspaces/:ws/connections...` for S4;
- `workspaces/:ws/admin...` for S5.

To read workspace docs, use the same `store` functions that `index.js` uses. Read `index.js` to see how a workspace's docs are loaded and saved, and how history is written.

**New pages need routes.** Each new SPA page is `app/pages/<name>.js` and exports what the other pages export (see `pages/home.js`). The lead adds the route and nav entry: list the route you need in your report and the lead wires it. To test before that, temporarily add your route in a local copy only. Better: the lead pre-wires these routes now:
- `/connections` → `pages/connections.js`
- `/admin` → `pages/admin.js`

### S1: Numbers you can trust (the engine plus the PMO, launch and testing pages)

**Owns:**
- `api/shared/pmoflow-engine.js` (plus its byte-identical web copy) and `tests/pmoflow/engine.test.js`;
- `app/pages/{home,project,projects,portfolio,dashboard,release,testing}.js`;
- `css/{pmo,release}.css`;
- `tests/pmoflow/{e2e-pmo,e2e-release,e2e-consistency}.js`, `lint-no-local-counting.js`;
- `api/shared/pmoflow-seed.js`, `api/shared/pmoflow-ai.js`, `tests/pmoflow/api.test.js`.

**Process: write the worked example first.** Before any code, write `docs/pmoflow/GOLDEN-NUMBERS.md`. It gives the expected value of every number on every screen for Vendor Onboarding Modernization and ERP Upgrade Readiness at seed day 0. The e2e then asserts exactly those values.

**Fix:**
1. **One change count.** Use `diffSummary` everywhere: `{added, changed, removed}`. Removed steps count. Every screen shows the same phrase, e.g. "5 new · 6 changed · 1 removed", taken from one engine function. Screens currently in conflict: home card, process header, new-project dialog, What changed tags.
2. **Earned value reconciles.**
   - EV = budget × % of the budgeted work that is done, using the same % the tile shows.
   - SPI and CPI are blank ("—") until work has started **and** actual cost > 0.
   - EAC is blank when CPI is undefined.
   - A project with SPI < 0.9 can never read "On track". The Simple label stays driven by lateness, but add "Behind on effort" to the reasons.
   - Test that the tile's % equals EV ÷ budget.
3. **Holiday calendar.**
   - US federal holidays for the current and next two years, computed rather than hard-coded per year, plus a per-workspace `holidays[]` the admin can edit (S5 builds that UI and reads it from the engine).
   - `addBusinessDays` and every business-day count skip holidays.
   - The launch window refuses a holiday or weekend.
   - Re-date the seed so no launch lands on a holiday.
   - Dashboard "Upcoming launches" uses the same launch date as the Launch page.
4. **Testing has one truth.** The banner, step cards, gate and coverage all read `projectTruth.testing`. "Done" requires every changed data element to have tests **and** all of them passed. Coverage uses one denominator everywhere. Never show "—" beside a failing ✕.
5. **"Late" shows the split in Simple:** "5 late (1 past due, 4 will finish after their due date)". Use the same text in the report.
6. **Suggested plans are real plans.**
   - At least one task per changed or new step.
   - A task per missing data element.
   - "Train the people who do the changed steps" and "Tell affected teams" tasks.
   - A task for each removed step ("Retire …").
   - Owners are **people**: the step owner if one exists, otherwise the project manager, with the role in the note. Never a bare role like "Employee".
   - Dependencies are respected, so a task never starts before its prerequisite finishes. This needs an engine test.
   - The new-project state before a plan exists shows "No plan yet", never "Information available ✓" or "1 of 7 done".
   - No approval request is sent until the part's work is done.
7. **Small items:**
   - "+N more" links go to the right place, with non-task items linked to their own pages.
   - Grammar: "1 test that hasn't run", "Late · 0 past due" (no "Late0").
   - The risk register's "not started" text is derived from the live task state.
   - Data page "check sample" opens the right data element (the page belongs to S2; S1 fixes the testing-side focus param).
8. **Fix the date-dependent api test.** "R8 dates: seed offsets" fails when a seed date lands on a weekend. Make the test compute expectations with the same business-day normaliser.

### S2: Process import and rigor (the BA side)

**Owns:**
- `app/pages/{process,step,data,processes,importsop}.js`;
- `css/design.css`;
- `tests/pmoflow/e2e-design.js`;
- a new UMD module `api/shared/pmoflow-import.js` (copied byte-identical to `web/public/concepts/pmoflow/app/import.js`, loaded by the lead in `index.html`), plus `tests/pmoflow/import.test.js`.

**Import parsing moves here.** Move or replace the SOP rules parser into `pmoflow-import.js`, and have the API (`pmoflow-ai.js` `sopRules`) call it. That one line in `pmoflow-ai.js` is the only S1-owned edit S2 may make; coordinate in the report.

**Fix:**
1. **Paste parser, sentence-level:**
   - Each numbered or bulleted line is **one** step.
   - Sub-clauses ("usually by email, sometimes fax") stay in that step's note.
   - Never create a role from a verb phrase. A role comes only from a known role noun or a `Role (Name)` pattern.
   - No truncation, no word mangling ("co-approve" stays "co-approve").
   - The step count and the description recompute after edits and deletes.
   - Map numbering includes Wait and Message nodes.
   - Teams parsed from the text populate "Teams involved".
   - Pasted data starts as **"Not checked yet"**, never "Connected".
   - Test on the reviewers' SOPs, written into `import.test.js` as fixtures: vendor onboarding (9 lines), offboarding with "if not returned within 5 days, notify Legal", and a co-approve example.
2. **Demo-data isolation.**
   - A visitor's imported or new process never links to existing seed data elements or people by name.
   - New data elements are created fresh in the visitor's process.
   - Owners come only from the visitor's text or the visitor's choice.
   - Write a test proving that importing "bank details" does not attach "Bank remittance details / Leo Park".
3. **Visio import (.vsdx).**
   - A `.vsdx` is a zip of XML. Parse its shapes, connectors and swimlanes into steps, links and lanes.
   - Support flowchart shapes: process, decision, start/end. Swimlanes become roles.
   - Show the same preview as BPMN import.
   - Test it with a small `.vsdx` fixture you generate in the test, using a zip library already available or a minimal zip writer.
4. **BPMN rigor:**
   - Data objects and data stores import as step data elements and export as BPMN data objects (not only vendor extensions).
   - Lanes export by **role** (with the person as a property).
   - Durations export as business-day text in an extension plus an ISO duration.
   - The preview labels a parallel gateway "runs at the same time", not "1 choice".
5. **RACI per step.**
   - Responsible is the existing owner. Accountable, Consulted and Informed are optional people or roles.
   - Edit them in the step editor under a collapsed "Who else is involved (optional)" section, keeping Rule #1.
   - Show them in the step drawer and the BPMN export.
6. **Process templates.** "Start from a template" offers 6 common processes as fictional, generic, editable maps: Vendor onboarding, Employee onboarding, Employee offboarding, Invoice approval, Purchase request, Customer refund. Each has steps, owners as roles, and data elements.
7. **Board lock labels.** The board is drawn by project.js (S1). S2 reports the root cause if it is in shared data. S1 fixes it.

### S3: Buyer and trust layer (product site on necogoode.com)

**Owns:**
- `web/public/pmoflow/**`, a new static multi-page site: plain HTML/CSS, no framework, fast, accessible, responsive;
- `api/shared/pmoflow-routes-buyer.js`;
- `tests/pmoflow/e2e-buyer.js`.

**Pages:**
- **`/pmoflow/`, the product page.**
  - Value line: "Your process map is the project plan."
  - The overlay positioning: "Works on top of Jira, Azure DevOps and Microsoft 365".
  - The 6 differentiators from the review, written plainly:
    1. what changed;
    2. information each step needs;
    3. plan from the change;
    4. department sign-off on just their part;
    5. tests from real data;
    6. launch with an undo plan.
  - Screenshots of the live app. Take them with Playwright from the dev server, save under `web/public/pmoflow/img/`, and view each one before using it.
  - A "Try the live demo" link to `/concepts/pmoflow/`.
  - "Book a demo" CTAs.
  - "Who's behind it": Neco Goode, with a link to necogoode.com, written factually from the site's existing about content. Read `web/src` for it, and never use anything about the founder's employer.
  - FAQ.
- **`/pmoflow/pricing`.**
  - All prices come from **one config file**, `web/public/pmoflow/pricing.json`, so the founder can change them. They are **draft** values, from the reviewers' bands:

    | Plan | Price | Includes |
    |---|---|---|
    | Free viewers and approvers | always free | |
    | Team | $45 per editor/month, billed annually | up to 25 editors; core features |
    | Business | $65 per editor/month, billed annually | adds SSO, Jira/ADO sync, Teams/Outlook, audit export, holiday calendars |
    | Enterprise | custom | SCIM, data residency, dedicated support |
    | Pilot | $7,500 for 90 days | credited to the first year |

  - Include a cost estimator: editors × plan, showing annual cost and the note "approvers are free".
  - "Book a demo" and "Start a pilot" CTAs.
  - The page itself must not say "draft". The founder knows these are drafts.
- **`/pmoflow/security`, security and data handling.**
  - State facts only, and be honest about what exists versus what is on the roadmap. Base it on `claude/pmoflow-security-architecture.md` in the Project; the lead pastes the key points into `docs/pmoflow/SECURITY-FACTS.md` for you.
  - Cover: the display-layer model ("your data and keys stay in your tenant"), project-scoped time-boxed access, sign-in with Microsoft Entra ID, roles, audit export, encryption, hosting on Azure, AI data handling, and a SOC 2 roadmap (planned, not certified).
  - Never claim a certification that doesn't exist.
- **`/pmoflow/demo`, book a demo.**
  - A form: name, work email, company, role, team size, tools used today (checkboxes: Jira, Azure DevOps, ServiceNow, Planner/Project, Smartsheet, monday, Visio, Signavio, other), what they want to fix, and preferred times.
  - POST to `/api/pmoflow/buyer/demo-request`. Store it in a **new table `pmoflowleads`** in the same storage account, with every entity carrying `app:'pmoflow'`.
  - Validate input, rate-limit 10 per IP hash per day, and add a honeypot field.
  - Show a confirmation page with "what happens next" and an .ics "hold" file the visitor can download.
  - Provide `GET /api/pmoflow/buyer/leads?key=…` for the founder. It needs a `PMOFLOW_ADMIN_KEY` app setting; if that setting is unset, the endpoint returns 404. The lead sets it.
  - Never email from the API in this round; the founder reads the leads list.
- **`/pmoflow/compare`, "PMOFlow and the tools you already own".**
  - An honest table of what PMOFlow adds on top of Jira, Planner, Smartsheet and Signavio, and what it deliberately doesn't do.
- **SEO:**
  - Product pages are **indexable**: title, description, OpenGraph, canonical URLs, `sitemap.xml` entries and JSON-LD `SoftwareApplication`.
  - The demo app stays noindex.
- **App changes:** the app footer's "Concept demo" becomes "Live demo · fictional Northwind data · [About PMOFlow]", linking to `/pmoflow/`. The footer belongs to the lead's `index.html`, so the lead does this. The app header gets a small "Book a demo" link (lead).

### S4: Overlay integrations (Jira / Azure DevOps two-way, Teams / Outlook)

**Owns:**
- `app/pages/connections.js`, `css/connect.css`;
- `api/shared/pmoflow-routes-connect.js`;
- a new UMD `api/shared/pmoflow-sync.js`, copied byte-identical to `app/sync.js`;
- `integrations/relay/**`, a new reference relay;
- `tests/pmoflow/{sync.test.js, relay.test.js, e2e-connect.js}`.

**Design: the security architecture, unchanged.** The customer's keys never leave their tenant. PMOFlow never stores a Jira or ADO token.

**Relay (`integrations/relay/`).** This is a customer-deployed Azure Function relay. It holds tokens in the customer's Key Vault and executes signed sync intents.
- Write a real Node implementation with:
  - Jira Cloud REST v3 adapters: create/update issue, transition, read changes since a cursor;
  - Azure DevOps REST adapters: work items via JSON Patch, WIQL changes since;
  - Teams: an Adaptive Card through a Workflows webhook URL;
  - Outlook: Microsoft Graph `sendMail`.
- **Unit-test it with mocked HTTP; no real network.**
- Include a README and a Bicep/ARM template for one-click deployment into the customer's subscription.
- Intents are HMAC-signed with a per-project rotating secret, carry a nonce, have a 5-minute expiry and are refused if replayed. This matches the security doc.

**Sync engine (`pmoflow-sync.js`, pure logic):**
- Field mapping between PMOFlow work items and Jira issues / ADO work items.
- Two-way rules:
  - Title, description and status sync both ways.
  - **Due dates and dependencies are owned by PMOFlow.**
  - Assignee maps by email.
  - Conflicts: last change wins per field, logged.
- Computes outbound intents from a change set, and applies inbound changes to PMOFlow docs.
- Thorough unit tests.

**Connections page (`/connections`)**, where admins connect a project to Jira or ADO:
- Choose tool, site/org and project key.
- Field mapping preview with defaults.
- Status mapping.
- Sync direction per field.
- "Send notifications to": Teams channel webhook and/or Outlook recipients, choosing which events: late task, approval needed, test failed, launch done.

**Demo mode.** In the demo, a **simulated** Jira/ADO lives in the workspace, clearly labelled "Simulated Jira (demo)". Syncing shows the work items appearing there. Changing a status "in Jira" (a button in the simulator) flows back into PMOFlow and updates the project status through the engine. A sync log shows each intent and its result. Notifications show a delivered-message preview (a Teams card render and an email render) instead of sending.

**Rule #1.** Connecting is a 3-step wizard with plain language and sensible defaults. Advanced field mapping stays collapsed.

### S5: Enterprise basics (sign-in, roles, audit, admin)

**Owns:**
- `app/pages/admin.js`, `css/admin.css`;
- `api/shared/pmoflow-routes-admin.js`;
- `tests/pmoflow/{admin.test.js, e2e-admin.js}`.

**Build:**
1. **Sign in with Microsoft (optional).**
   - Use Azure Static Web Apps' built-in `aad` provider (`/.auth/login/aad`, `/.auth/me`). In the app, "Sign in with Microsoft" sits in the ☰ / View menu. Once signed in, the header shows the real name.
   - In the **demo**, signing in only labels the session; the workspace stays the sandbox. Anonymous use must keep working unchanged.
   - Write the exact `staticwebapp.config.json` changes the lead must make in your report, and keep them **minimal**: no route may require auth, or it breaks the demo. Locally, `/.auth/me` doesn't exist, so handle a 404 gracefully.
2. **Roles and users (`/admin` → People).**
   - Roles: Admin, Editor, Approver, Viewer. Approvers and viewers are free seats.
   - Show the editor seat count against the plan, reading `pricing.json` if present.
   - Invite by email (stored, no email sent).
   - Change a role.
   - Role enforcement goes through the existing server-side role checks (R5). Find them in `index.js` and the store and reuse them; report any change `index.js` needs.
3. **Audit log.**
   - `/admin` → History lists every change in the workspace, from existing history, filterable by person, item and date.
   - Export as CSV and JSON.
   - Entries are **hash-chained**: each entry stores the SHA-256 of the previous entry and its own content. The export includes a "Verify" result that recomputes the chain. Write this in your route module over the existing history store.
4. **Holiday calendar admin.** `/admin` → Calendar lists the computed holidays (from S1's engine) plus custom ones. Add or remove days. This writes the workspace `holidays[]` that the engine reads.
5. **Security settings page (`/admin` → Security).** It explains, in plain language, what is enforced now versus what comes with the Business plan, and links to `/pmoflow/security`.

## Shared rules (all streams)

- **Read first, in this order:**
  1. `docs/pmoflow/AGENT-ONBOARDING.md`
  2. `UI-STREAM-RULES.md`
  3. this file
  4. `market-review/CONSOLIDATED.md`
- **Dev servers:** `nohup env PMOFLOW_STORAGE_FILE=/home/claude/.pmoflow-storage.conn node tests/pmoflow/devserver.js <your port> > /tmp/dev<port>.log 2>&1 &`.
  - Ports: S1 8841, S2 8842, S3 8843, S4 8844, S5 8845.
  - Stop with `fuser -k <port>/tcp`. **Never use `pkill -f`.** Never print the `.conn` file.
  - In Playwright, use **one fixed** `x-forwarded-for` per test run. The sandbox is keyed on it, and a new IP means a new sandbox.
- **Data:** fictional Northwind data only. No real company or person names, apart from Neco Goode on the "who's behind it" section.
- **Copy:** plain language in Simple mode.
- **Don't commit.** Report back in 300 words or fewer: what changed, test counts, and what the lead must do (routes, config, cross-stream asks).

## Fixed acceptance bar (decided before building; it doesn't move)

The same 4 reviewer personas re-run against the deployed build, using the same 20+ category scorecard.

**Pass when:**
- every §4 bug in CONSOLIDATED is gone, and the reviewers find no number contradictions;
- C20 (Trust / buying path) is at least B for all four reviewers, and C18 (Enterprise readiness) is at least C+;
- both search buyers say **yes** to booking a demo, and both experts confirm a pilot path ("overlay that syncs to Jira/ADO" is demonstrable);
- no category's consensus Ease grade drops versus `CONSOLIDATED.md`.

New findings go to `R11-BACKLOG.md`. They are not exit criteria.

## Appendix: R10 engine API (published by S1)

All functions are on `window.PMOEngine` (web) and `require('api/shared/pmoflow-engine.js')` (API). Dates are `YYYY-MM-DD`.

### Holiday calendar (§3) — S5 reads and writes this

**Storage.** A new doc type `calendar` (added to `DOC_TYPES` in `pmoflow-seed.js`, so the generic `PUT/DELETE /ws/:ws/doc/calendar/:id` works). One doc per workspace, id **`workspace`**, seeded as `{ id: 'workspace', holidays: [] }`:

```js
{ id: 'workspace', holidays: [
  { date: '2026-12-24', name: 'Christmas Eve' },   // a custom day off
  { date: '2026-10-12', off: true },               // the workspace WORKS this federal holiday (removes it)
] }
```
Save it with `store.save('calendar', 'workspace', {...}, 'Added Christmas Eve to the holiday calendar')`.

**Functions.**
- `federalHolidays(year) -> [{date, name, source: 'federal'}]` — the 11 US federal holidays, observed dates (Sat → Fri before, Sun → Mon after), computed for any year.
- `holidays(docs, {today?, fromYear?, years = 3}) -> [{date, name, source: 'federal'|'custom', weekday, worked?}]` — every holiday for the current and next two years (from `today`'s year). Federal days the workspace works carry `worked: true`. This is the list the Calendar admin page shows.
- `isHoliday(date, docs?)`, `holidayName(date, docs?) -> string|null`.
- `isBusinessDay(date, docs?)` — false on weekends and holidays.
- `addBusinessDays(date, n)`, `businessDaysBetween(a, b)`, `toBusinessDay(date)` — all skip weekends **and** holidays. `addBusinessDays(d, 0)` rolls a weekend/holiday forward.
- `syncCalendar(docs)` — selects a workspace's calendar. Every engine function that takes `docs` does this itself; call it only before a bare `addBusinessDays` on a different workspace's docs.

### Change counts (§1)
- `diffSummary(process)` now also returns `added` (= `new`): `{added, new, changed, removed, same}`. Gateways, waits and messages count; removed Today steps count.
- `changeSummary(processOrProject, docs?) -> {added, changed, removed, text}` — `text` is the one phrase every screen shows, e.g. `"5 new · 6 changed · 1 removed"` (`''` when nothing changes). For a project it sums its linked processes.

### Work items (for S4)
- Status changes go through the normal doc save of `workItem` (`status: 'idle'|'prog'|'done'`, `doneAt` when done). The engine derives every count from the docs; nothing else needs updating.

### Earned value, status and late split (§2, §5)
- `earnedValue(...)` adds `pctDone` (0–1), `pct` (rounded %) and `started`. `SPI`/`CPI` are `null` until work has started (EV > 0) **and** AC > 0; `EAC` is `null` when `CPI` is. Show `null` as "—".
- `projectFinancials(...).forecastBasis`: `'eac'` or `'estimate'` (the cost forecast falls back to the bottom-up estimate).
- `projectTruth` adds: `pctDone` (the "% done" tile), `lateText` ("5 late (1 past due, 4 will finish after their due date)"), `behindEffort`, `noPlan` (show "No plan yet"), `launch` (`{date, source: 'window'|'deadline', problem}`).
- `projectStats(...).pct` is now the same `pctDone`; the task-count share is `taskPct`.
- SPI < 0.9 adds the reason "Behind on effort: N% of the work planned by today is done"; a project that would be green reads label "Behind on effort" (rag amber).
- `lateText(truthLike)` formats the split for any `{lateCount, pastDueCount, finishAfterDueCount}`.

### Launch date (§3)
- `launchDate(docs, prj) -> {date, source, problem}` — the one launch date (window day, else deadline). `checkLaunchWindow(date, docs?) -> null | "Fri Dec 25, Christmas Day"`. The `cutover-plan` readiness check fails when the window is on a weekend/holiday.

### Testing (§4)
- `projectTruth.testing.haveTests` counts changed information with cases **and** a case for every rule field. Coverage tiles read `testing.stages` (`system`, `uat`), whose `uat.total` equals `testing.total`.

### Suggested plans (§6)
- `suggestWorkFromDiff` items may carry `tag: 'retire'|'train'|'tell'`, `retires` (the removed Today step id, with `step: null`), and `note` (e.g. the step's role). Owners are always people (`ownerRole` is no longer returned). `planToWork` copies `note`, `tag`, `retires`.
