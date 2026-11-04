# PMOFlow v3 — Build Contracts (source of truth for all builder agents)

Showroom app at `https://www.necogoode.com/concepts/pmoflow/`. Fictional **Northwind Traders** data only. Never use any real company, person or client name.

## 0. Ground rules
- **No build step.** The frontend is plain ES modules plus one UMD script, served as static files from `web/public/concepts/pmoflow/`. No npm deps in the browser. No third-party scripts, fonts, CDNs or analytics; system font stack only.
- **The API is Azure Functions (Node 20, v3 programming model: `function.json` + `index.js`)** in `api/`. Zero npm deps. Use `api/shared/tables.js` (`insert`, `upsert`, `query`) plus a delete helper you add to `api/shared/pmoflow-store.js`.
- **Every table name starts with `pmoflow`. Every entity carries `app: 'pmoflow'`.**
- **Do not touch any file outside the paths assigned to your stream**, except as listed under "shared files". If you need a change in a shared file, write it in your final report instead of editing.
- **Escape all user-entered text when rendering:** use `esc()` from `ui.js`, never raw `innerHTML` interpolation of user text.
- **"Today" is real time** (`new Date()`). Seed dates are generated relative to seed time, so the demo never goes stale.

## 1. File layout
```
web/public/concepts/pmoflow/
  index.html            shell (lead)            – loads app/engine.js (classic script) then app/main.js (module)
  app/engine.js         UMD engine (stream E)   – MUST be byte-identical to api/shared/pmoflow-engine.js
  app/main.js           boot + router (lead)
  app/store.js          state/adapter/actions (lead)
  app/ui.js             shared UI helpers, modal, drawer, comments/history panel (lead)
  app/styles.css        all CSS (lead creates; streams may APPEND sections under a `/* == <stream> == */` header)
  app/pages/home.js            (stream P)
  app/pages/process.js         (stream D)  map/as-is/to-be/diff/lanes + editor
  app/pages/step.js            (stream D)
  app/pages/data.js            (stream D)  data element detail + spec editor + profile view
  app/pages/project.js         (stream P)  map/timeline/work items
  app/pages/portfolio.js       (stream P)  portfolio, workload, risks, baselines, status report
  app/pages/release.js         (stream R)  grants, readiness gate, approvals, go-live, pipeline log
  app/pages/testing.js         (stream R)  profiler, spec drift, test cases, runs, discovered reqs
  app/pages/importsop.js       (stream R)  AI SOP import → draft process
api/
  pmoflow/function.json, pmoflow/index.js    (stream A)  route `pmoflow/{*path}`
  shared/pmoflow-store.js                     (stream A)  table persistence (adapter boundary)
  shared/pmoflow-seed.js                      (stream A)  seed generator (relative dates)
  shared/pmoflow-engine.js                    (stream E)  canonical engine
  shared/pmoflow-ai.js                        (stream A)  Azure OpenAI calls with deterministic fallback
tests/pmoflow/                                 each stream adds its own tests (node --test)
```

## 2. Data model (documents)
Each workspace holds documents `{type, id, data}`. The `data` shapes follow. All ids are strings. Dates are `YYYY-MM-DD`. People are ids into `people`.

- **person** `{id, name, role, color, bu}`. `bu` is a business unit such as "Procurement", "Compliance", "Treasury", "Accounts Payable", "IT".
- **dataElement** `{id, name, owner, source, avail: 'live'|'example'|'missing', note, fields:[{name, format, rule, type?: 'text'|'digits'|'number'|'date'|'currency'|'list', min?, max?, length?, pattern?, required?: bool, values?: []}], samples:[string], sampleCsv?: string (synthetic sample extract, header row plus about 40 rows of fake values, used by the profiler demo), discovered:[{text, fromRun, at}]}`
- **process** `{id, name, desc, owner, resources:[personId], version: number, asis: Node[], tobe: Node[], released: [{version, at, by, asis: Node[]}]}`
  - Node: `{id, type: 'trigger'|'step'|'decision'|'end', title, owner?, data?: [dataId], touches?: [string], subs?: [{title, data:[dataId]}], from?: asisNodeId, branches?: [{label, nodes: Node[]}]}`
  - `diff` is not stored. The engine computes it from `from`, and from title/data/owner differences against the as-is node.
- **project** `{id, name, desc, owner, resources, target, processes:[processId], status: 'active'|'live', baselines: [{id, at, label, items:{workId:{start, due}}}]}`
- **workItem** `{id, projectId, pid, step, title, owner, status: 'idle'|'prog'|'done', start, due, deps:[workId], resolves?: dataId, kind?: 'build'|'access'|'test'|'other'}`
- **grant** `{id, projectId, dataId, env: 'dev'|'uat', access: 'read'|'write', reason, requestedBy, status: 'requested'|'approved'|'active'|'expired'|'revoked'|'denied', approvedBy?, expires, log:[{at, by, action}]}`
- **approval** `{id, projectId, bu, approver, decision: 'approved'|'rejected', at, stepUp: true, note}`. Each business unit in the project signs off its own section. A section is the steps owned by people in that BU.
- **release** `{id, projectId, at, by, approvers:[personId], actions:[{type: 'pipeline'|'sop-publish'|'notify', target, status: 'simulated-ok', detail}], exceptions:[...], snapshot:{processId: version}}`
- **profile** `{id, dataId, at, rows, columns:[{name, nulls, distinct, minLen, maxLen, min?, max?, charClasses:[], specials:[], patterns:[{pattern, count}], examples:[masked]}]}`. Statistics only, never raw values.
- **testCase** `{id, dataId, field, kind: 'valid'|'boundary'|'invalid'|'edge'|'custom', input, expect: 'accept'|'reject', origin: 'spec'|'profile'|'user', note}`
- **testRun** `{id, projectId, env: 'dev'|'uat', at, by, results:[{caseId, outcome: 'pass'|'fail'|'blocked', note}]}`
- **comment** `{id, ref: 'type:id', author, text, at, mentions:[personId]}`
- **notification** `{id, to, text, ref, at, read: false}`
- **risk** `{id, projectId, title, impact: 'low'|'med'|'high', likelihood: 'low'|'med'|'high', owner, mitigation, status: 'open'|'closed'}`

**Event** (append-only history): `{at, actor, action: 'create'|'update'|'delete'|'approve'|'golive'|..., ref: 'type:id', summary}`

## 3. HTTP API (stream A) — all JSON, base `/api/pmoflow`
| Method | Path | Behaviour |
|---|---|---|
| POST | `/workspaces` | Create a sandbox cloned from the seed. Returns `{id}`. Limit: 5 per IP per day (hash the IP; never store it raw). |
| GET | `/ws/:ws/state` | Returns `{docs: {type: [{id, data}]}, people, today}`. 404 if expired or unknown. Expiry is 30 days after creation. |
| PUT | `/ws/:ws/doc/:type/:id` | Body `{data, actor, summary}`. Upsert, then append an event. Max 48 KB per doc. Validate `type` against the allowlist. |
| DELETE | `/ws/:ws/doc/:type/:id` | Body `{actor, summary}`. Delete, then append an event. |
| GET | `/ws/:ws/events?ref=type:id&limit=100` | Newest first. |
| POST | `/ws/:ws/profile/:dataId` | Body `{csv}` (max 2 MB, max 50k rows). Server computes statistics only, stores a `profile` doc, returns it. Raw values are never stored or logged. |
| POST | `/ws/:ws/ai/:kind` | `kind` ∈ `status-report`, `sop-import`, `suggest-work`. Body per kind. Uses Azure OpenAI (`AZURE_OPENAI_ENDPOINT/KEY/DEPLOYMENT/API_VERSION`) with facts only. If AI is unavailable, returns a deterministic fallback with `source: 'rules'`. |
| POST | `/ws/:ws/golive/:projectId` | Body `{actor}`. The server re-evaluates readiness with the engine and refuses (409 + reasons) unless the gate passes. On pass: promotes each linked process's to-be to as-is (version+1, pushes to `released`), expires all grants, sets the project status to `live`, writes a `release` doc with simulated actions, and appends events. |
| POST | `/ws/:ws/reset` | Re-seed this workspace. |

**Error shape:** `{error, reasons?}`. Rate limit: 120 writes per minute per workspace (in-memory, best effort).

## 4. Engine API (stream E) — `PMOEngine` (UMD; browser global `window.PMOEngine`, Node `require`)
All functions are pure, take the plain `docs` object (same shape as `/state.docs`) plus a `today` string, and never mutate input.
- `flatSteps(nodes) -> Node[]` (steps only, branches included)
- `diffProcess(process) -> {nodes: {[tobeId]: 'new'|'changed'|'same'}, removed: [asisNode], changes: {[tobeId]: [string]}}`
- `forecastAll(docs, today) -> {[workId]: {forecast, sched: 'ok'|'soon'|'late'|'slip'|'done', slipDays, cause?: dataId|workId}}`
- `stepState(docs, projectId, pid, stepId, today) -> {items, status: 'none'|'idle'|'prog'|'done', done, due, forecast, next, sched, blockers: [dataId]}`
- `dataReady(docs, dataId) -> bool` (live, or a `resolves` work item that's done)
- `dependents(docs, workId) -> [workId]` (transitive)
- `impactOfData(docs, dataId) -> [{pid, stepId}]`
- `projectStats(docs, projectId, today) -> {total, done, pct, late, slip, blocked, finish, target, onTrack}`
- `readiness(docs, projectId, today) -> {pass: bool, checks: [{id, label, pass, detail, items?:[]}]}`. Checks: `work-done`, `data-live`, `tests-passed` (latest dev and UAT runs: zero fail; every case run at least once in UAT), `grants-closed` (no active or approved grants remain besides expiring on go-live; requested ones are rejected), `bu-signoff` (every BU with steps in a linked process has an approved approval with `stepUp`), `two-person` (≥2 distinct approvers), `exceptions` (work items edited after their BU approval are listed; this is a warning only, not a failure).
- `profileCsv(csvText, {maxRows}) -> profile columns` (statistics + masked examples; masking keeps the first and last char, replaces digits with 9 and letters with x/X, keeps punctuation)
- `specDrift(dataElement, profile) -> [{field, issue, detail}]`
- `generateTests(dataElement, profile?) -> testCase[]` without ids. Boundary/invalid from the spec, edge cases from the profile: specials, max length, leading zeros, unicode, empty.
- `workload(docs, projectId?, today) -> [{person, open, late, dueNext7}]`
- `baselineVariance(docs, projectId, baselineId, today) -> [{workId, plannedDue, forecast, varianceDays}]`
- `suggestWorkFromDiff(docs, projectId) -> [{pid, step, title, kind, resolves?}]` (rules-based: one per new/changed step without work; one resolver per missing data element without a resolver)

## 5. Client store (lead) — `app/store.js` exports
- `store.state` → `{ws, docs, people, today, me}`. `me` is the current persona id, chosen in the header.
- `store.load()`, `store.save(type, id, data, summary)`, `store.remove(type, id, summary)`, `store.events(ref)`, `store.api(path, body)` (POST helper), `store.newId(prefix)`, `store.subscribe(fn)`, `store.notify(toIds, text, ref)`.
- `store.get(type, id)`, `store.list(type, filterFn?)`.
- When `/api` is unreachable, the store falls back to an in-memory copy of a seed fetched from `/api/...`. If that also fails, it shows a banner. Pages must not assume network success.

## 6. UI helpers (lead) — `app/ui.js` exports
`esc, fmt, days, av(personId), personChip(id), badge(text, cls), chip(html, cls), dataDot(dataId), modal({title, body, actions}) -> Promise<{action, form}>, drawer(html), commentsPanel(ref) -> html + bind, historyPanel(ref) -> html, toast(text), link(path), go(path), formValues(root), stepUp(actionLabel) -> Promise<bool>` (simulated MFA dialog, clearly labelled "Simulated step-up: in production this is Microsoft Entra MFA").

## 7. Page module contract
Every page module exports `render(params) -> string` (HTML) and optional `bind(root, params)` for listeners. The router re-renders on store change. Routes:
```
/                       home.js
/process/:pid           process.js   (?mode=asis|tobe|diff|lanes|edit)
/process/:pid/step/:sid step.js
/data/:did              data.js
/project/:prj           project.js   (?mode=map|timeline|work)
/portfolio              portfolio.js
/release/:prj           release.js
/testing/:prj           testing.js
/import                 importsop.js
/new                    process.js (creates a new process, then redirects to edit mode)
```

## 8. Done means
- Every page renders with zero console errors on desktop (1440) and phone (390), with no horizontal page overflow.
- Every create/edit/delete persists through the API, shows up in the history panel, and survives a page reload.
- The stream's own `node --test` tests pass.
