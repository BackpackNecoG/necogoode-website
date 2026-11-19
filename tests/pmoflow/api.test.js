/* PMOFlow API tests (stream A). Run: node --test tests/pmoflow/api.test.js
   Uses real Azure Table storage when a connection file exists (PMOFLOW_STORAGE_FILE, ~/.pmoflow-storage.conn,
   or /home/claude/.pmoflow-storage.conn); otherwise the store's in-memory backend.
   The connection string is never printed. Every workspace created here is deleted in after(). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

const connFile = [process.env.PMOFLOW_STORAGE_FILE && process.env.PMOFLOW_STORAGE_FILE.replace(/^~/, os.homedir()),
  path.join(os.homedir(), '.pmoflow-storage.conn'), '/home/claude/.pmoflow-storage.conn'].filter(Boolean).find(f => fs.existsSync(f));
if (connFile && !process.env.EMCEE_STORAGE_CONNECTION) process.env.EMCEE_STORAGE_CONNECTION = fs.readFileSync(connFile, 'utf8').trim();
/* force the AI fallback path */
['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_API_VERSION'].forEach(k => delete process.env[k]);

const API = path.join(__dirname, '../../api');
const fn = require(path.join(API, 'pmoflow/index.js'));
const store = require(path.join(API, 'shared/pmoflow-store.js'));
const { seed, DOC_TYPES, bizDay } = require(path.join(API, 'shared/pmoflow-seed.js'));
const ai = require(path.join(API, 'shared/pmoflow-ai.js'));
let engine = null;
try { engine = require(path.join(API, 'shared/pmoflow-engine.js')); } catch (e) { engine = null; }

const created = [];   /* [wsId, ipHash] for cleanup */
const rnd = () => Math.random().toString(36).slice(2, 10);
const testIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function call(method, p, body, query, ip) {
  const ctx = { res: null, log: Object.assign(() => {}, { error() {}, warn() {}, info() {} }) };
  await fn(ctx, { method, url: '/api/pmoflow/' + p, headers: { 'x-forwarded-for': ip || '127.0.0.1' }, params: { path: p }, query: query || {}, body });
  return ctx.res;
}
async function newWs() {
  const hash = 'test-' + rnd();
  const ws = await store.createWorkspace(hash, { id: 'tsta' + rnd() + rnd() });   /* stream-A prefix; cleanup deletes only ids tracked in `created` */
  created.push([ws.id, hash]);
  return ws.id;
}
const state = async ws => (await call('GET', `ws/${ws}/state`)).body;
const find = (st, type, id) => (st.docs[type] || []).find(d => d.id === id);
/* R17 #4 (P1): information that feeds a new or changed step is now tested, so the seed's Compliance part also needs tests on
   Certificate of insurance (D3) and Vendor risk tier (D8) before it is ready. These helpers add them (cases from the
   engine, passed by Priya in the business check) so the approval tests keep testing approvals. P5 ask: bake these into the
   rebuilt seed and drop the helpers. */
function r17ScopeCases(docs) {
  return engine.generateProjectTests(docs, 'vendor-modernization').filter(x => x.dataId === 'D3' || x.dataId === 'D8')
    .flatMap(x => x.cases.map((c, i) => Object.assign({ id: 'r17' + x.dataId + '-' + i }, c)));
}
function r17ReadyComplianceDocs(docs) {
  const cs = r17ScopeCases(docs);
  cs.forEach(c => docs.testCase.push({ id: c.id, data: c }));
  docs.testRun.push({ id: 'r17cmp', data: { id: 'r17cmp', projectId: 'vendor-modernization', env: 'uat', at: new Date(Date.now() - 120000).toISOString(), by: 'ps', stepUp: true, results: cs.map(c => ({ caseId: c.id, outcome: 'pass' })) } });
  return docs;
}
async function r17ReadyCompliance(ws) {
  const cs = r17ScopeCases((await state(ws)).docs);
  for (const c of cs) { const r = await call('PUT', `ws/${ws}/doc/testCase/${c.id}`, { actor: 'ps', data: c }); if (r.status !== 200) throw new Error('r17 case: ' + JSON.stringify(r.body)); }
  const r = await call('PUT', `ws/${ws}/doc/testRun/r17cmp`, { actor: 'ps', data: { id: 'r17cmp', projectId: 'vendor-modernization', env: 'uat', at: new Date(Date.now() - 120000).toISOString(), by: 'ps', stepUp: true, results: cs.map(c => ({ caseId: c.id, outcome: 'pass' })) } });
  if (r.status !== 200) throw new Error('r17 run: ' + JSON.stringify(r.body));
}

test.after(async () => {
  for (const [id, hash] of created) await store.deleteWorkspace(id, hash).catch(() => {});
});

test('backend in use', () => {
  assert.ok(['table', 'memory'].includes(store._backend()));
  if (connFile) assert.equal(store._backend(), 'table');
});

test('POST /workspaces creates a workspace; state has every doc type and people', async () => {
  const ip = testIp();
  const r = await call('POST', 'workspaces', {}, {}, ip);
  assert.equal(r.status, 201);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.body.id, /^[a-z0-9]{12,32}$/);
  created.push([r.body.id, fn._internal.clientIpHash({ headers: { 'x-forwarded-for': ip } })]);
  const s = await call('GET', `ws/${r.body.id}/state`);
  assert.equal(s.status, 200);
  assert.equal(s.headers['cache-control'], 'no-store');
  for (const t of DOC_TYPES) assert.ok(Array.isArray(s.body.docs[t]), 'missing type ' + t);
  assert.equal(s.body.people.length, 11);   /* R9 §7: + Dave Ortiz, Head of Compliance; R11 §2: + the AP, IT, Procurement and Treasury heads */
  assert.ok(s.body.people.every(p => p.bu));
  assert.equal(s.body.today, new Date().toISOString().slice(0, 10));
  assert.equal(s.body.docs.dataElement.length, 8);
  assert.equal(s.body.docs.process.length, 4);   /* R7: + Expense Reimbursement (no project) */
  assert.equal(s.body.docs.workItem.length, 19);   /* R8: + the ERP Upgrade Readiness project's 2 tasks */
});

test('workspace creation: a burst guard per network (R11: daily cap raised for shared offices)', async () => {
  const ip = testIp();
  const hash = fn._internal.clientIpHash({ headers: { 'x-forwarded-for': ip } });
  for (let i = 0; i < store.BURST_MAX; i++) {
    const r = await call('POST', 'workspaces', {}, {}, ip);
    assert.equal(r.status, 201);
    created.push([r.body.id, hash]);
  }
  const r = await call('POST', 'workspaces', {}, {}, ip);
  assert.equal(r.status, 429);
  /* R11: one plain message, nothing else, and never two contradictory retry times */
  assert.deepEqual(Object.keys(r.body), ['error']);
  assert.ok(!(/tomorrow/.test(r.body.error) && /minute/.test(r.body.error)), r.body.error);
});

test('IP is hashed, never raw', () => {
  const h = fn._internal.clientIpHash({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } });
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.equal(h, fn._internal.clientIpHash({ headers: { 'x-forwarded-for': '203.0.113.9:4431' } }));
  assert.ok(!h.includes('203'));
});

test('PUT/DELETE doc persist and append events (newest first)', async () => {
  const ws = await newWs();
  const item = { projectId: 'vendor-modernization', pid: 'vendor-onboarding', step: 's5', title: 'Link contract to vendor ID', owner: 'mc',
    status: 'idle', start: '2026-11-20', due: '2026-11-25', deps: [], kind: 'build' };
  let r = await call('PUT', `ws/${ws}/doc/workItem/W99`, { data: item, actor: 'ta', summary: 'Added W99' });
  assert.equal(r.status, 200);
  assert.equal(r.body.event.action, 'create');
  r = await call('PUT', `ws/${ws}/doc/workItem/W99`, { data: Object.assign({}, item, { status: 'prog' }), actor: 'mc', summary: 'Started W99' });
  assert.equal(r.body.event.action, 'update');
  let st = await state(ws);
  assert.equal(find(st, 'workItem', 'W99').data.status, 'prog');
  assert.equal(find(st, 'workItem', 'W99').data.id, 'W99');
  /* update a seeded doc and delete another */
  const w6 = find(st, 'workItem', 'W6').data;
  await call('PUT', `ws/${ws}/doc/workItem/W6`, { data: Object.assign({}, w6, { status: 'prog' }), actor: 'lp' });
  r = await call('DELETE', `ws/${ws}/doc/workItem/W11`, { actor: 'ta', summary: 'Removed W11' });
  assert.equal(r.status, 200);
  st = await state(ws);
  assert.equal(find(st, 'workItem', 'W6').data.status, 'prog');
  assert.equal(find(st, 'workItem', 'W11'), undefined);
  assert.equal(st.docs.workItem.length, 19); /* 19 seeded - W11 + W99 */

  r = await call('GET', `ws/${ws}/events`, null, { ref: 'workItem:W99' });
  assert.equal(r.status, 200);
  assert.equal(r.body.events.length, 2);
  /* R3: ids in client summaries are replaced by names */
  /* R13: the server writes what changed; the client's sentence is only a quoted note after it */
  assert.equal(r.body.events[0].summary, 'Updated work item "Link contract to vendor ID": status Not started → In progress (note: “Started Link contract to vendor ID”)');
  assert.equal(r.body.events[1].summary, 'Created work item "Link contract to vendor ID" (note: “Added Link contract to vendor ID”)');
  r = await call('GET', `ws/${ws}/events`, null, { limit: '200' });
  assert.ok(r.body.events.length >= 14, 'seeded history plus new events');
  for (let i = 1; i < r.body.events.length; i++) assert.ok(r.body.events[i - 1].at >= r.body.events[i].at, 'newest first');
  assert.equal(r.body.events[0].ref, 'workItem:W11');
  r = await call('GET', `ws/${ws}/events`, null, { limit: '3' });
  assert.equal(r.body.events.length, 3);
});

test('validation errors use {error} and the right status codes', async () => {
  const ws = await newWs();
  const cases = [
    [['GET', 'ws/BAD-ID/state'], 400],
    [['GET', 'ws/short/state'], 400],
    [['GET', 'ws/zzzzzzzzzzzzzzzzzzzz/state'], 404],
    [['PUT', `ws/${ws}/doc/secret/x1`, { data: {} }], 400],
    [['PUT', `ws/${ws}/doc/workItem/bad%20id`, { data: {} }], 400],
    [['PUT', `ws/${ws}/doc/workItem/${'x'.repeat(65)}`, { data: {} }], 400],
    [['PUT', `ws/${ws}/doc/workItem/W1`, { data: [1, 2] }], 400],
    [['PUT', `ws/${ws}/doc/workItem/W1`, '{not json'], 400],
    [['PUT', `ws/${ws}/doc/workItem/W1`, { data: { blob: 'x'.repeat(49 * 1024) } }], 413],
    [['GET', `ws/${ws}/events`, null, { ref: "x' or 1 eq 1" }], 400],
    [['GET', `ws/${ws}/events`, null, { limit: '0' }], 400],
    [['POST', `ws/${ws}/ai/write-poem`, {}], 400],
    [['POST', `ws/${ws}/ai/status-report`, {}], 400],
    [['POST', `ws/${ws}/ai/status-report`, { projectId: 'nope' }], 404],
    [['POST', `ws/${ws}/ai/sop-import`, { text: 'x'.repeat(20001) }], 413],
    [['POST', `ws/${ws}/profile/D2`, {}], 400],
    [['POST', `ws/${ws}/profile/D99`, { csv: 'a,b\n1,2\n' }], 404],
    [['POST', `ws/${ws}/profile/D2`, { csv: 'a\n' + 'x'.repeat(2 * 1024 * 1024) }], 413],
    [['POST', `ws/${ws}/golive/nope`, {}], engine ? 404 : 503],
    [['GET', `ws/${ws}/nothing`], 405],
    [['GET', 'elsewhere'], 404],
  ];
  for (const [[m, p, b, q], status] of cases) {
    const r = await call(m, p, b, q);
    assert.equal(r.status, status, `${m} ${p} -> ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(typeof r.body.error, 'string');
    assert.equal(r.headers['cache-control'], 'no-store');
  }
});

test('R11 profile keeps the duplicates count (no values): a repeated account number is flagged against "unique per vendor"', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const de = find(st, 'dataElement', 'D2').data;
  const rows = engine.parseCsv(de.sampleCsv);
  const ai = rows[0].indexOf('account_number');
  assert.ok(ai >= 0 && rows.length > 3);
  rows[2][ai] = rows[1][ai];                               /* one vendor's account number repeated */
  const csv = rows.map(r => r.map(v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(',')).join('\n') + '\n';
  const r = await call('POST', `ws/${ws}/profile/D2`, { csv, actor: 'mc' });
  assert.equal(r.status, 200);
  const prof = find(await state(ws), 'profile', 'profile-D2').data;
  const col = prof.columns.find(c => c.name === 'account_number');
  assert.equal(col.duplicates, 1);
  assert.ok(!JSON.stringify(prof).includes(rows[1][ai]), 'the repeated value itself is never stored');
  const drift = engine.specDrift(de, prof);
  const dup = drift.find(x => x.issue === 'duplicates');
  assert.ok(dup && dup.field === 'Account number', JSON.stringify(drift));
  assert.match(dup.detail, /must be unique/);
  /* the clean seeded sample has no duplicates, so nothing is flagged */
  const r0 = await call('POST', `ws/${ws}/profile/D2`, { csv: de.sampleCsv, actor: 'mc' });
  assert.equal(r0.status, 200);
  assert.ok(!engine.specDrift(de, find(await state(ws), 'profile', 'profile-D2').data).some(x => x.issue === 'duplicates'));
});

test('profile stores statistics only (no raw CSV value survives)', async () => {
  const ws = await newWs();
  const st = await state(ws);
  for (const did of ['D1', 'D2']) {
    const csv = find(st, 'dataElement', did).data.sampleCsv;
    const r = await call('POST', `ws/${ws}/profile/${did}`, { csv, actor: 'mc' });
    assert.equal(r.status, 200);
    assert.equal(r.body.rows, 40);
    assert.equal(r.body.columns.length, 4);
    const stored = find(await state(ws), 'profile', 'profile-' + did);
    assert.ok(stored, 'profile doc stored');
    const json = JSON.stringify(stored.data);
    const cells = engine ? engine.parseCsv(csv).slice(1).flat() : csv.split('\n').slice(1).join(',').split(',');
    const raw = cells.filter(v => v && v.length >= 5);
    assert.ok(raw.length > 100);
    for (const v of raw) assert.ok(!json.includes(v), 'raw value leaked into profile');
    for (const c of stored.data.columns) assert.deepEqual(Object.keys(c).filter(k => !['name', 'nulls', 'distinct', 'minLen', 'maxLen', 'min', 'max', 'charClasses', 'specials', 'patterns', 'examples', 'duplicates', 'duplicateRecords'].includes(k)), []);
  }
  const prof = find(await state(ws), 'profile', 'profile-D2').data;
  const routing = prof.columns.find(c => c.name === 'routing_number');
  assert.equal(routing.minLen, 8);                       /* dropped leading zero is visible as a statistic */
  assert.equal(prof.columns.find(c => c.name === 'account_holder').nulls, 1);
  const ev = await call('GET', `ws/${ws}/events`, null, { ref: 'dataElement:D2' });
  assert.equal(ev.body.events[0].action, 'profile');
});

test('AI endpoints fall back to rules when Azure OpenAI is not configured', async () => {
  assert.equal(ai.configured(), false);
  const ws = await newWs();
  let r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization', actor: 'ta' });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'rules');
  assert.equal(typeof r.body.headline, 'string');
  assert.ok(r.body.headline.includes('Vendor Onboarding Modernization'));
  for (const k of ['highlights', 'risks', 'asks']) assert.ok(Array.isArray(r.body[k]));
  assert.ok(r.body.asks.some(a => a.includes('Bank remittance details')), 'missing bank data is an ask');

  const sop = 'Vendor Onboarding SOP:\n1. Maya Chen emails the vendor for the W-9 and vendor legal name\n2. Compliance SME checks sanctions\n' +
    '3. Leo Park collects bank remittance details\n4. Ana Ruiz keys the vendor into the ERP\n5. Dev environment refresh';
  r = await call('POST', `ws/${ws}/ai/sop-import`, { text: sop });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'rules');
  assert.equal(r.body.nodes[0].type, 'trigger');
  const steps = r.body.nodes.slice(1);
  assert.equal(steps.length, 5);
  /* R10 (S2 demo-data isolation): a visitor's import never links to the demo's people or information by name. Names stay
     as written (ownerRole); no seeded data element is attached. */
  assert.ok(!steps[0].owner); assert.equal(steps[0].ownerRole, 'Maya Chen');
  assert.ok(!(steps[0].data || []).includes('D1'));
  assert.ok(!steps[1].owner); assert.deepEqual([steps[1].ownerRole, steps[1].title], ['Compliance SME', 'Check sanctions']);
  assert.ok(!steps[2].owner); assert.ok(!(steps[2].data || []).includes('D2'), 'bank details never attach the demo element');
  assert.ok(!steps[4].owner && !steps[4].ownerRole, '"Dev environment" must not map to a person');
  assert.equal(typeof r.body.notes, 'string');

  r = await call('POST', `ws/${ws}/ai/suggest-work`, { projectId: 'vendor-modernization' });
  if (engine) {
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'rules');
    assert.ok(Array.isArray(r.body.items));
  } else assert.equal(r.status, 503);
});

test('reset restores the seed and clears overrides and events', async () => {
  const ws = await newWs();
  await call('DELETE', `ws/${ws}/doc/risk/R1`, { actor: 'ta' });
  await call('PUT', `ws/${ws}/doc/risk/R9`, { data: { projectId: 'vendor-modernization', title: 'New risk', impact: 'low', likelihood: 'low', owner: 'ta', mitigation: '', status: 'open' }, actor: 'ta' });
  let st = await state(ws);
  assert.ok(!find(st, 'risk', 'R1') && find(st, 'risk', 'R9'));
  const r = await call('POST', `ws/${ws}/reset`, { actor: 'ta' });
  assert.equal(r.status, 200);
  st = await state(ws);
  assert.ok(find(st, 'risk', 'R1') && !find(st, 'risk', 'R9'));
  assert.deepEqual(st.docs, seed(new Date().toISOString()).docs);
  const ev = await call('GET', `ws/${ws}/events`, null, { limit: '500' });
  assert.equal(ev.body.events.filter(e => !e.seeded).length, 1);
  assert.equal(ev.body.events[0].action, 'reset');
});

test('expiry: 30 days after creation (unit)', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  assert.equal(store.EXPIRY_DAYS, 30);
  assert.equal(store.isExpired('2026-11-04T00:00:00Z', now), false);
  assert.equal(store.isExpired('2026-10-06T12:00:01Z', now), false);
  assert.equal(store.isExpired('2026-10-05T11:59:59Z', now), true);
  assert.equal(store.isExpired('not a date', now), true);
});

test('seed: relative dates, edge-case CSVs, fictional data', () => {
  const s = seed('2027-03-10');
  const w = id => s.docs.workItem.find(d => d.id === id).data;
  assert.equal(w('W6').due, '2027-03-09');
  assert.equal(w('W6').status, 'idle');
  assert.equal(w('W6').resolves, 'D2');
  assert.equal(w('W2').resolves, 'D5');
  assert.equal(w('W1').start, '2027-02-10');   // R10: -27 calendar days = 19 business days back (Presidents' Day skipped)
  assert.equal(s.docs.project.find(d => d.id === 'vendor-modernization').data.target, '2027-04-20');
  const d2 = s.docs.dataElement.find(d => d.id === 'D2').data;
  const rn = d2.fields.find(f => f.name === 'Routing number');
  assert.equal(rn.length, 9); assert.equal(rn.required, true);
  assert.equal(d2.sampleCsv.trim().split('\n').length, 41);
  const d1csv = s.docs.dataElement.find(d => d.id === 'D1').data.sampleCsv;
  for (const needle of ["O'Brien", 'Zoë', ' & ', '-Jones']) assert.ok(d1csv.includes(needle), needle);
  assert.ok(d2.sampleCsv.split('\n').some(l => /,\d{8},/.test(l)), '8-digit routing edge case');
  const vo = s.docs.process.find(d => d.id === 'vendor-onboarding').data;
  assert.equal(vo.tobe.find(n => n.id === 's4').from, 'a4');
  assert.ok(vo.tobe.some(n => n.type === 'decision'));
  assert.equal(vo.version, 1); assert.deepEqual(vo.released, []);
  assert.equal(s.docs.release.length, 0);
  assert.ok(s.events.length >= 10);
  assert.ok(s.events.every(e => e.at < '2027-03-10'), 'seeded history is in the past');
  assert.deepEqual(seed('2027-03-10'), s, 'deterministic');
  /* R2 fields */
  assert.ok(s.docs.person.every(d => d.data.capacity > 0));
  assert.ok(s.docs.workItem.every(d => d.data.effortDays > 0));
  assert.ok(s.docs.workItem.filter(d => d.data.status === 'done').every(d => d.data.doneAt));
  assert.ok(s.docs.workItem.filter(d => d.data.status !== 'done').every(d => !d.data.doneAt));
  assert.equal(d2.sensitivity, 'pii');
  assert.equal(s.docs.dataElement.find(d => d.id === 'D1').data.sensitivity, 'confidential');
  assert.equal(d2.discovered.filter(x => !x.resolved).length, 1);
  const ia = s.docs.process.find(d => d.id === 'invoice-approval').data;
  assert.equal(ia.tobe.find(n => n.type === 'parallel').branches.length, 2);
  assert.ok(ia.tobe.some(n => n.sla && n.system));
  assert.ok(s.docs.project.find(d => d.id === 'access-review-automation').data.cutover.rollbackOwner);
  /* R6: vendor-modernization has a runbook but no rollback plan yet, so the cutover check stays open */
  const vmc = s.docs.project.find(d => d.id === 'vendor-modernization').data.cutover;
  assert.ok(vmc.tasks.length >= 3 && !vmc.rollbackOwner && !vmc.rollbackPlan);
  assert.ok(s.docs.risk.every(d => Array.isArray(d.data.workItems) && d.data.workItems.length));
  assert.ok(s.docs.approval.every(d => d.data.snapshotAt));
});

const allIds = docs => new Set(Object.values(docs).flat().map(d => d.id).filter(id => id.length >= 2));
/* R4: the cutover check needs at least one runbook task; the seed leaves it for the user to add. */
/* R5: the seed keeps no runbook by design. Add one task with an owner and a confirmed go/no-go step (as the PM),
   then re-take IT's sign-off: the cutover edit (cutoverUpdatedAt) makes every earlier approval stale. */
async function addRunbook(ws, opts) {
  opts = opts || {};
  const st = await state(ws);
  const pr = st.docs.project.find(d => d.id === 'access-review-automation').data;
  /* R11: no launch window here (the launch guard has its own tests), and IT's part is approved by Maya Chen
     (Dev Kumar does IT's steps and recorded its tests, so he can't approve it) */
  const r = await call('PUT', `ws/${ws}/doc/project/access-review-automation`, { actor: 'ta', data: Object.assign({}, pr, { approvers: Object.assign({}, pr.approvers, { IT: 'mc' }), cutover: Object.assign({}, pr.cutover, {
    window: '', tasks: [{ id: 'CT1', order: 1, task: 'Enable automated campaign', owner: 'owner' in opts ? opts.owner : 'dk', planned: '08:00', gonogo: true, done: opts.done !== false }] }) }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const at = new Date(Date.now() + 1000).toISOString();
  const a = await call('PUT', `ws/${ws}/doc/approval/AP8`, { actor: 'mc', data: { projectId: 'access-review-automation', bu: 'IT', approver: 'mc', decision: 'approved', at, snapshotAt: at, stepUp: true, note: 'Re-approved after runbook' } });
  assert.equal(a.status, 200, JSON.stringify(a.body));
}

function assertNoIds(value, docs, where) {
  const ids = allIds(docs);
  const text = JSON.stringify(value);
  for (const id of ids) {
    const re = new RegExp('(?<![\\w-])' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
    assert.ok(!re.test(text), `${where}: internal id "${id}" leaked`);
  }
}

test('go-live: refused with 409 + reasons; passes end to end; keeps v1; rollback restores it', { skip: !engine && 'pmoflow-engine.js not present' }, async () => {
  const ws = await newWs();
  let r = await call('POST', `ws/${ws}/golive/vendor-modernization`, { actor: 'ta' });
  assert.equal(r.status, 409);
  assert.ok(Array.isArray(r.body.reasons) && r.body.reasons.length >= 3);
  assert.ok(r.body.reasons.some(x => /cutover/i.test(x)), 'missing cutover plan is a gate item');
  r = await call('POST', `ws/${ws}/rollback/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 409, 'rollback only when live');

  await addRunbook(ws);
  let st = await state(ws);
  const v1 = find(st, 'process', 'access-review').data;
  /* access-review: finish A4, then Compliance signs off (A4's edit makes any older Compliance approval stale) */
  const a4 = find(st, 'workItem', 'A4').data;
  await call('PUT', `ws/${ws}/doc/workItem/A4`, { data: Object.assign({}, a4, { status: 'done', doneAt: st.today, time: [{ by: 'ps', date: st.today, hours: 4 }] /* R15 #8: hours logged, so the Done needs no second person */ }), actor: 'ps' });
  st = await state(ws);
  assert.equal(engine.readiness(st.docs, 'access-review-automation', st.today).pass, false);
  await call('PUT', `ws/${ws}/doc/approval/AP9`, { actor: 'do', data: { projectId: 'access-review-automation', bu: 'Compliance', approver: 'do',
    decision: 'approved', at: new Date(Date.now() + 1000).toISOString(), snapshotAt: new Date(Date.now() + 1000).toISOString(), stepUp: true, note: 'ok' } });
  st = await state(ws);
  const gate = engine.readiness(st.docs, 'access-review-automation', st.today);
  assert.equal(gate.pass, true, JSON.stringify(gate.checks.filter(c => !c.pass)));
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.release.kind, 'golive');
  assert.ok(Array.isArray(r.body.release.exceptions));
  st = await state(ws);
  let proc = find(st, 'process', 'access-review').data;
  assert.equal(proc.version, 2);
  assert.equal(proc.released.length, 1);
  assert.equal(proc.released[0].version, 1, 'v1 stays viewable');
  assert.deepEqual(proc.released[0].asis, v1.asis);
  assert.equal(proc.asis.find(n => n.id === 'r1').title, 'Pull entitlements automatically');
  assert.ok(Object.values(engine.diffProcess(proc).nodes).every(v => v === 'same'));
  assert.equal(find(st, 'grant', 'G4').data.status, 'expired');
  assert.equal(find(st, 'project', 'access-review-automation').data.status, 'live');
  const rel = st.docs.release[0].data;
  assert.deepEqual(rel.snapshot, { 'access-review': 2 });
  assert.deepEqual(rel.actions.map(a => a.type), ['pipeline', 'sop-publish', 'notify']);
  assert.ok(rel.actions[0].detail.includes('/dispatches\n'));
  assert.ok(rel.approvers.length >= 2);
  let ev = await call('GET', `ws/${ws}/events`, null, { ref: 'project:access-review-automation' });
  assert.equal(ev.body.events[0].action, 'golive');
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 409);

  /* rollback */
  r = await call('POST', `ws/${ws}/rollback/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.release.kind, 'rollback');
  st = await state(ws);
  proc = find(st, 'process', 'access-review').data;
  assert.equal(proc.version, 1);
  assert.deepEqual(proc.asis, v1.asis);
  assert.deepEqual(proc.tobe, v1.tobe, 'designed to-be restored');
  assert.ok(proc.released.some(x => x.version === 2 && x.rolledBack), 'rolled-back v2 stays viewable');
  assert.equal(find(st, 'project', 'access-review-automation').data.status, 'active');
  assert.equal(st.docs.release.filter(d => d.data.kind === 'rollback').length, 1);
  ev = await call('GET', `ws/${ws}/events`, null, { ref: 'project:access-review-automation' });
  assert.equal(ev.body.events[0].action, 'rollback');
  r = await call('POST', `ws/${ws}/rollback/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 409);
});

test('release exceptions use names, never raw ids', () => {
  const docs = seed('2026-11-04').docs;
  const ex = fn._internal.releaseExceptions(docs, { id: 'exceptions', items: ['W1', { ref: 'process:vendor-onboarding' }] });
  assert.equal(ex.length, 2);
  for (const e of ex) for (const k of ['ref', 'summary', 'by', 'at']) assert.ok(k in e, k);
  assert.ok(ex[0].summary.includes('Open W-9 and insurance uploads in the vendor portal'));
  assert.equal(ex[0].by, 'Maya Chen');
  assert.ok(ex[1].summary.includes('Vendor Onboarding'));
  assertNoIds(ex.map(e => [e.summary, e.by]), docs, 'exceptions');
});

test('status report never prints internal ids (rules path, incl. client-made ids)', async () => {
  const ws = await newWs();
  /* ids shaped like the grader's: store.newId('de') / ('wi') */
  await call('PUT', `ws/${ws}/doc/dataElement/de-mw2d6hl3in5m`, { actor: 'mc', data: { name: 'Payment run calendar', owner: 'lp', source: 'Treasury', avail: 'missing',
    note: 'Blocks wi-mw2d7k1abc', fields: [], samples: [], discovered: [{ text: 'Needs de-mw2d6hl3in5m holiday list', fromRun: 'TR1', at: '2026-11-03' }] } });
  await call('PUT', `ws/${ws}/doc/workItem/wi-mw2d7k1abc`, { actor: 'ta', data: { projectId: 'vendor-modernization', pid: 'invoice-approval', step: 'i3',
    title: 'Publish payment calendar', owner: 'lp', status: 'idle', start: '2026-10-01', due: '2026-10-05', deps: ['W6'], resolves: 'de-mw2d6hl3in5m', kind: 'build' } });
  let st = await state(ws);
  const p = find(st, 'process', 'invoice-approval').data;
  p.tobe.find(n => n.id === 'i3').data.push('de-mw2d6hl3in5m');
  await call('PUT', `ws/${ws}/doc/process/invoice-approval`, { actor: 'ar', data: p });
  st = await state(ws);
  const r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization' });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'rules');
  /* R9: the asks are the who list; the blocker shows as its resolver task (or by name when no task covers it) */
  assert.ok(r.body.asks.some(a => a.includes('Payment run calendar') || a.includes('“Publish payment calendar”')), JSON.stringify(r.body.asks));
  assert.ok(r.body.risks.some(a => a.includes('Publish payment calendar')));
  assertNoIds({ headline: r.body.headline, summary: r.body.summary, highlights: r.body.highlights, risks: r.body.risks, asks: r.body.asks }, st.docs, 'report');
  assertNoIds(r.body.facts, st.docs, 'facts');
});

test('put doc stamps updatedAt on workItem and process docs only', async () => {
  const ws = await newWs();
  let st = await state(ws);
  const w = find(st, 'workItem', 'W4').data;
  const before = Date.now();
  await call('PUT', `ws/${ws}/doc/workItem/W4`, { actor: 'ps', data: Object.assign({}, w, { status: 'prog' }) });
  st = await state(ws);
  const t1 = find(st, 'workItem', 'W4').data.updatedAt;
  assert.ok(Date.parse(t1) >= before - 5);
  /* R14 PMO-A2: a client echoing the stored value back unchanged changes nothing: no stamp, no history */
  await new Promise(res => setTimeout(res, 5));
  const echo = await call('PUT', `ws/${ws}/doc/workItem/W4`, { actor: 'ps', data: find(st, 'workItem', 'W4').data });
  assert.equal(echo.body.unchanged, true);
  st = await state(ws);
  assert.equal(find(st, 'workItem', 'W4').data.updatedAt, t1);
  /* an echoed updatedAt with a real change -> server re-stamps */
  await call('PUT', `ws/${ws}/doc/workItem/W4`, { actor: 'ps', data: Object.assign({}, find(st, 'workItem', 'W4').data, { note: 'touched' }) });
  st = await state(ws);
  assert.ok(find(st, 'workItem', 'W4').data.updatedAt > t1);
  /* client-supplied fresh value is kept */
  await call('PUT', `ws/${ws}/doc/workItem/W4`, { actor: 'ps', data: Object.assign({}, w, { updatedAt: '2030-01-01T00:00:00.000Z' }) });
  st = await state(ws);
  assert.equal(find(st, 'workItem', 'W4').data.updatedAt, '2030-01-01T00:00:00.000Z');
  await call('PUT', `ws/${ws}/doc/process/access-review`, { actor: 'dk', data: Object.assign({}, find(st, 'process', 'access-review').data, { desc: 'touched' }) });
  await call('PUT', `ws/${ws}/doc/risk/R4`, { actor: 'dk', data: find(st, 'risk', 'R4').data });
  st = await state(ws);
  assert.ok(find(st, 'process', 'access-review').data.updatedAt);
  assert.equal(find(st, 'risk', 'R4').data.updatedAt, undefined);
});

test('SOP import rules parser (grader cases 5 and 6)', () => {
  const docs = seed('2026-11-04').docs;
  const sop = [
    'Employee Expense Reimbursement SOP',
    'Purpose: Reimburse employees for approved business expenses.',
    'Scope: All staff in the US.',
    'Owner: Finance Operations',
    'Revision: 3.1 (2026-09-01)',
    '',
    '1. Employee submits the expense report with receipts',
    '   a. Attach itemized receipts',
    '   b. Code each line to a cost center',
    '2. Manager reviews the report',
    '3. If the total is over $5,000, the Finance Director approves',
    "4. Accounts Payable pulls the employee's bank details from Workday",
    '5. Leo Park schedules payment in the next run',
    '   - Confirm the payment file totals',
  ].join('\n');
  const r = ai.sopRules(sop, docs);
  assert.deepEqual(r.nodes[0], { id: 'k', type: 'trigger', title: 'Process starts' });
  const rs = r.nodes.slice(1);
  const titles = rs.map(n => n.title);
  assert.equal(rs.length, 5, JSON.stringify(titles));
  assert.ok(!titles.some(t => /reimbursement sop|purpose|scope|revision|owner:/i.test(t)), 'title/purpose/scope/owner/revision skipped');
  assert.deepEqual(rs[0].subs.map(x => x.title), ['Attach itemized receipts', 'Code each line to a cost center'], 'lettered items nest');
  const dec = rs[2];
  assert.equal(dec.type, 'decision');
  assert.match(dec.title, /\$5,000\?$/);
  assert.deepEqual(dec.branches.map(b => b.label), ['Yes', 'No']);
  /* R8: the title is the action only; the actor becomes ownerRole */
  assert.deepEqual([dec.branches[0].nodes[0].title, dec.branches[0].nodes[0].ownerRole], ['Approve', 'Finance Director']);
  assert.deepEqual(dec.branches[1].nodes, []);
  const bank = rs[3];
  assert.equal(bank.data, undefined, 'employee bank details must not link to vendor Bank remittance details');
  assert.deepEqual([bank.owner, bank.ownerRole, bank.system, bank.title], [undefined, 'Accounts Payable', 'Workday', "Pull the employee's bank details"], 'a team is a role, never a guessed person');
  assert.ok(r.newData.some(x => x.name === 'Employee bank details' && /Bank remittance details/.test(x.reason)));
  assert.equal(rs[4].owner, 'lp', 'full-name match');
  assert.equal(rs[4].subs[0].title, 'Confirm the payment file totals');
  assert.equal(rs[1].owner, undefined, '"Manager" is neither a full name nor a BU');
  assert.deepEqual([rs[0].title, rs[0].ownerRole], ['Submit the expense report with receipts', 'Employee']);
  /* strong matches still link */
  const ok = ai.sopRules('1. Leo Park records the vendor bank remittance details\n2. Vendor uploads the certificate of insurance', docs);
  const oks = ok.nodes.slice(1);
  assert.deepEqual(oks[0].data, ['D2']);
  assert.deepEqual(oks[1].data, ['D3']);
  /* other condition phrasings */
  const c = ai.sopRules('1. Approval required for new vendors over $10,000\n2. Pay the invoice when the amount exceeds the PO\n3. File the receipt', docs);
  const cs = c.nodes.slice(1);
  assert.deepEqual(cs.map(n => n.type), ['decision', 'decision', 'step']);
  assert.equal(cs[1].branches[0].nodes[0].title, 'Pay the invoice');
  assert.ok(c.newData.some(x => x.name === 'Amount') && c.newData.some(x => x.name === 'Invoice') && c.newData.some(x => x.name === 'Receipts'), 'information nouns');
});

/* ------------------------------ Round 3 ------------------------------ */
const hasR3Engine = !!(engine && typeof engine.effectiveAvail === 'function');

const isR4Engine = () => !!(engine && typeof engine.sprints === 'function');

test('R4 go-live: never flips data live; owner confirmation is what counts; checks stored; no stale approvals', { skip: !hasR3Engine && 'engine without effectiveAvail' }, async () => {
  const ws = await newWs();
  await addRunbook(ws);
  let st = await state(ws);
  /* R8: D7 explicitly marked Not available yet, fixed by A1 whose owner (Priya) is not the data owner (Dev), so Dev still confirms.
     Keep A1's old updatedAt so IT's approval stays fresh. */
  const d7 = Object.assign({}, find(st, 'dataElement', 'D7').data, { avail: 'missing' });
  delete d7.liveConfirmedBy; delete d7.liveConfirmedAt; delete d7.liveSource; delete d7.liveEvidence; delete d7.check;
  await call('PUT', `ws/${ws}/doc/dataElement/D7`, { actor: 'dk', data: d7 });
  await call('PUT', `ws/${ws}/doc/workItem/A1`, { actor: 'dk', data: Object.assign({}, find(st, 'workItem', 'A1').data, { resolves: 'D7', owner: 'ps', updatedAt: '2020-01-01T00:00:00.000Z' }) });
  const a4 = find(st, 'workItem', 'A4').data;
  await call('PUT', `ws/${ws}/doc/workItem/A4`, { actor: 'ps', data: Object.assign({}, a4, { status: 'done', doneAt: st.today, time: [{ by: 'ps', date: st.today, hours: 4 }] /* R15 #8: hours logged, so the Done needs no second person */ }) });
  st = await state(ws);
  if (isR4Engine()) {
    assert.equal(engine.effectiveAvail(st.docs, 'D7'), 'pending', 'a finished fix awaits the owner');
    const r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta' });
    assert.equal(r.status, 409);
    assert.ok(r.body.reasons.some(x => /Approver matrix/.test(x)), JSON.stringify(r.body.reasons));
  }
  /* the data owner confirms the live source */
  /* the data owner runs the connection check (the fix is done, so it passes) and confirms with it as evidence */
  const ck = await call('POST', `ws/${ws}/check/D7`, { actor: 'dk' });
  assert.equal(ck.body.ok, true, ck.body.detail);
  st = await state(ws);
  await call('PUT', `ws/${ws}/doc/dataElement/D7`, { actor: 'dk', data: Object.assign({}, find(st, 'dataElement', 'D7').data, { liveConfirmedBy: 'dk', liveConfirmedAt: new Date().toISOString(), liveSource: 'HR directory nightly sync', liveEvidence: { type: 'check', ref: 'check', at: ck.body.at, by: 'dk' } }) });
  st = await state(ws);
  assert.equal(engine.effectiveAvail(st.docs, 'D7'), 'live');
  /* R13 #3: Compliance approves once its part is ready (its information is now live) */
  const at = new Date(Date.now() + 1000).toISOString();
  const ap9 = await call('PUT', `ws/${ws}/doc/approval/AP9`, { actor: 'do', data: { projectId: 'access-review-automation', bu: 'Compliance', approver: 'do', decision: 'approved', at, snapshotAt: at, stepUp: true, note: 'ok' } });
  assert.equal(ap9.status, 200, JSON.stringify(ap9.body));
  st = await state(ws);
  const gate = engine.readiness(st.docs, 'access-review-automation', st.today);
  assert.equal(gate.pass, true, JSON.stringify(gate.checks.filter(c => !c.pass)));
  const r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.release.checks) && r.body.release.checks.length >= 6);
  assert.ok(r.body.release.checks.every(c => c.id === 'exceptions' || c.pass));
  st = await state(ws);
  assert.equal(find(st, 'dataElement', 'D7').data.avail, 'missing', 'go-live does not flip data to live');
  assert.equal(find(st, 'process', 'access-review').data.updatedAt, undefined, 'promotion is not stamped as an edit');
  assert.equal(engine.readiness(st.docs, 'access-review-automation', st.today).pass, true);
  const ev = (await call('GET', `ws/${ws}/events`, null, { ref: 'dataElement:D7' })).body.events;
  assert.ok(!ev.some(e => /set live at go-live/.test(e.summary)));
});

test('R3/R6 status report: RAG agrees with the headline; risk reconciliation', async () => {
  const ws = await newWs();
  let r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization' });
  /* R9 §1: a late item whose finish still meets the deadline (and no unplanned blocker) is amber; the label is the engine's */
  assert.ok(r.body.facts.atRisk.some(x => x.daysPastDue > 0), 'seed has a late item');
  assert.ok(r.body.facts.stats.finish <= r.body.facts.project.target, 'finish meets target');
  assert.equal(r.body.rag, 'amber');
  assert.equal(r.body.facts.rag.status, 'amber');
  const amberLabel = engine && engine.projectTruth ? engine.projectTruth((await state(ws)).docs, 'vendor-modernization', (await state(ws)).today).label : r.body.label;
  assert.equal(r.body.label, amberLabel);
  assert.ok(!/^On track/.test(r.body.label) || /late/.test(r.body.label), 'never a bare "On track" while a task is late');
  assert.ok(r.body.headline.startsWith(amberLabel + ': '));
  r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'access-review-automation' });
  assert.equal(r.body.rag, 'green');
  assert.match(r.body.headline, /^On track: /);
  let st = await state(ws);
  const proj = find(st, 'project', 'access-review-automation').data;
  const finish = r.body.facts.stats.finish;
  /* R8: "At risk" only when the forecast misses the deadline */
  const before = new Date(Date.parse(finish + 'T12:00:00Z') - 2 * 86400000).toISOString().slice(0, 10);
  /* R13: a planned project's deadline moves only through an approved plan change, so write it the way an applied change does */
  await store.putDoc(ws, 'project', 'access-review-automation', Object.assign({}, proj, { target: before }));
  r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'access-review-automation' });
  assert.equal(r.body.rag, 'red');
  assert.match(r.body.headline, /^(At risk|Will miss the deadline): /);
  /* risk reconciliation: R6 links A1 (done in the seed): an open risk whose linked work is all done is "likely resolved" */
  r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'access-review-automation' });
  const rk = r.body.facts.risks.find(x => x.title.startsWith('The identity platform'));
  assert.equal(rk.likelyMitigated, true);
  assert.ok(r.body.risks.some(x => x.startsWith('Likely resolved: The identity platform') && /close it\?$/.test(x)));
  /* R9 §7: the screening risk was closed when Compliance finished its part, so it is not reported */
  r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization' });
  assert.ok(!r.body.facts.risks.some(x => x.title.startsWith('Screening vendor contract')));
});

test('R3 AI path: a headline that contradicts the RAG is corrected (mocked Azure OpenAI)', async () => {
  const ws = await newWs();
  const saved = global.fetch;
  Object.assign(process.env, { AZURE_OPENAI_ENDPOINT: 'https://example.invalid', AZURE_OPENAI_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'd' });
  let sentBody = null;
  try {
    const st = await state(ws);   /* load state before mocking fetch (storage uses fetch too) */
    global.fetch = async (url, opts) => { sentBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      headline: 'Green: everything on track (W6 fine)', summary: 'All good with D2.', highlights: ['W1 done'], risks: [], asks: [] }) } }] }) }; };
    const r = await ai.run('status-report', { projectId: 'vendor-modernization' }, st.docs, st.today);
    assert.equal(r.body.source, 'ai');
    assert.notEqual(r.body.rag, 'green');
    assert.equal(r.body.rag, r.body.facts.rag.status);
    assert.ok(r.body.headline.startsWith(r.body.label + ': ') && !/green|everything on track/i.test(r.body.headline), r.body.headline);
    assert.ok(r.body.summary.startsWith(r.body.sentence), 'the summary leads with the one sentence');
    assert.ok(!r.body.summary.includes('D2') && !r.body.highlights[0].includes('W1'), 'ids scrubbed from AI output');
    assert.ok(sentBody.messages[0].content.includes(`"${r.body.label}:"`));
    assertNoIds(JSON.parse(sentBody.messages[1].content), st.docs, 'facts sent to the model');
  } finally {
    global.fetch = saved;
    ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_DEPLOYMENT'].forEach(k => delete process.env[k]);
  }
});

test('R3 event summaries use names, never ids', async () => {
  const ws = await newWs();
  let st = await state(ws);
  await call('PUT', `ws/${ws}/doc/grant/G2`, { actor: 'lp', data: Object.assign({}, find(st, 'grant', 'G2').data, { status: 'approved', approvedBy: 'lp', approvedAt: new Date().toISOString(), expires: st.today }) });
  await call('PUT', `ws/${ws}/doc/testRun/TR7`, { actor: 'ps', data: { projectId: 'vendor-modernization', env: 'uat', at: '2026-11-04T15:00:00.000Z', by: 'ps', results: [] } });
  await call('PUT', `ws/${ws}/doc/workItem/W5`, { actor: 'ps', summary: 'Moved W5 after W4 and D8 review', data: find(st, 'workItem', 'W5').data });
  await call('DELETE', `ws/${ws}/doc/risk/R3`, { actor: 'ta' });
  const ev = (await call('GET', `ws/${ws}/events`, null, { limit: '500' })).body.events;
  const s = ref => ev.find(e => e.ref === ref).summary;
  assert.match(s('grant:G2'), /^Updated UAT read access to Bank remittance details: status Requested → Approved; approved by none → [A-Z][a-z]+ [A-Z]/);
  assert.ok(!/\blp\b|approved at/.test(s('grant:G2')), 'names, never ids; no server timestamps as changes');
  assert.equal(s('testRun:TR7'), 'Created UAT run, Nov 4');
  /* R14 PMO-A2: a save that changes nothing is not logged at all */
  assert.ok(!ev.some(e => e.ref === 'workItem:W5' && /Moved|no field changed/.test(e.summary)));
  assert.equal(s('risk:R3'), 'Deleted risk "Business testing overlaps the quarter-end close"');
  st = await state(ws);
  assertNoIds(ev.map(e => e.summary), st.docs, 'event summaries (incl. seeded)');
  assertNoIds(st.docs.notification.map(n => n.data.text).concat(st.docs.comment.map(c => c.data.text)), st.docs, 'seeded notification/comment text');
  assert.equal(find(st, 'notification', 'N2').data.to, 'lp');
});

test('R3 SOP rules parser: reviewer repro, else->No, parallel, role aliases, systems, trigger', () => {
  const docs = seed('2026-11-04').docs;
  /* reviewer repro */
  let r = ai.sopRules('1. Employee submits the expense report\n2. Manager reviews and approves. If over $5,000, Finance Director must also approve.\n3. AP clerk pays the expense', docs);
  let n = r.nodes;
  assert.deepEqual(n.map(x => x.type), ['trigger', 'step', 'step', 'decision', 'step']);
  assert.deepEqual([n[2].title, n[2].ownerRole], ['Review and approve', 'Manager'], 'main step stays top level; actor stripped');
  assert.equal(n[3].title, 'Amount over $5,000?');
  assert.deepEqual(n[3].branches[0].nodes.map(x => [x.title, x.ownerRole]), [['Approve', 'Finance Director']], 'conditional action is kept');
  assert.deepEqual(n[3].branches[1].nodes, []);
  assert.deepEqual([n[4].owner, n[4].ownerRole], [undefined, 'AP clerk'], 'R8: a role stays a role (no guessed person)');
  assert.deepEqual(n[0], { id: 'k', type: 'trigger', title: 'Process starts' }, 'no stated start: generic trigger, not step 1');
  /* else -> No, stated trigger, systems, aliases, parallel */
  r = ai.sopRules([
    'Invoice Approval SOP',
    'The process starts when an invoice arrives in the AP inbox.',
    '1. AP clerk keys the invoice into NetSuite',
    '2. If the PO matches, the treasury analyst schedules payment. Otherwise, the AP clerk emails the requester.',
    '3. At the same time, Compliance screens the vendor and IT archives the invoice in SharePoint',
    '4. Leo Park releases the payment run',
    '5. Simultaneously, the compliance officer files the evidence in Teams',
    '6. If the amount is over $10,000, the controller approves',
    '7. Else, close the request in DocuSign',
  ].join('\n'), docs);
  n = r.nodes;
  assert.deepEqual(n[0], { id: 'k', type: 'trigger', title: 'An invoice arrives in the AP inbox' });
  assert.equal(n[1].system, 'NetSuite');
  assert.deepEqual([n[1].title, n[1].ownerRole], ['Key the invoice', 'AP clerk']);
  assert.equal(n[2].type, 'decision');
  assert.equal(n[2].branches[0].nodes[0].ownerRole, 'Treasury analyst');
  assert.deepEqual([n[2].branches[1].nodes[0].title, n[2].branches[1].nodes[0].ownerRole], ['Email the requester', 'AP clerk'], 'otherwise -> No');
  assert.equal(n[3].type, 'parallel');
  assert.deepEqual(n[3].branches.map(b => b.nodes[0].ownerRole), ['Compliance', 'IT']);
  assert.deepEqual(n[3].branches.map(b => b.label), ['Compliance', 'IT']);
  assert.equal(n[3].branches[1].nodes[0].system, 'SharePoint');
  assert.equal(n[3].branches[1].nodes[0].title, 'Archive the invoice');
  assert.equal(n[4].type, 'parallel', 'single-clause "simultaneously" pairs with the previous step');
  assert.deepEqual(n[4].branches.map(b => b.nodes[0].owner || b.nodes[0].ownerRole), ['lp', 'Compliance officer']);
  assert.equal(n[4].branches[1].nodes[0].system, 'Teams');
  assert.equal(n[5].type, 'decision');
  assert.equal(n[5].title, 'Amount over $10,000?');
  assert.equal(n[5].branches[1].nodes[0].system, 'DocuSign', 'else -> No of the preceding decision');
  assert.ok(!n.some(x => x.title === 'Invoice Approval SOP'));
  /* "In parallel:" with lettered branches */
  r = ai.sopRules('1. Vendor signs the contract\n2. In parallel:\n   a. Treasury sets up the bank account\n   b. Procurement activates the contract', docs);
  assert.equal(r.nodes[2].type, 'parallel');
  assert.deepEqual(r.nodes[2].branches.map(b => b.label), ['Treasury', 'Procurement']);
});

/* ------------------------------ Round 4 ------------------------------ */
test('R4/R9 report wording: late-by is business days past due, one word "late", quoted titles, correct plurals', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization' });
  const all = [r.body.headline, r.body.summary, ...r.body.highlights, ...r.body.risks, ...r.body.asks].join('\n');
  assert.ok(!/\(s\)/.test(all), 'no "(s)" placeholders');
  assert.ok(!/\b1 days\b|\b1 items\b|\b1 work items\b|\b1 business days\b|\b(?:[02-9]|\d{2,}) (business )?day\b/.test(all), 'plurals agree with counts');
  /* R16 N1 #10 (Jordan 5): "past due" is now part of the one lateness wording ("1 business day past due; expected to
     finish 6 business days late"); other synonyms stay banned */
  assert.ok(!/running late|behind plan/i.test(all), 'R9 §1: no other words for late');
  assert.ok(!/past due/i.test(all.replace(/\b\d+ business days? past due\b/g, '')), '"past due" only in the one lateness wording');
  assert.ok(!/\b\d+ days?\b/.test(all.replace(/\b\d+ business days?\b/g, '').replace(/Support after launch:[^\n]*/g, '')), 'R9 §3: lateness is in business days');
  const w6 = r.body.risks.find(x => x.startsWith('“Set up the bank details form”'));
  assert.ok(w6, 'task titles are quoted “X”');
  const w6due = find(st, 'workItem', 'W6').data.due;
  /* R14 (PMO list 5): "late by N" is the Work tab's one lateness number (projectTruth.lateness), not just the days past due */
  const lateBy = engine ? engine.projectTruth(st.docs, 'vendor-modernization', st.today).lateness.W6.days : null;
  if (lateBy != null) assert.ok(w6.includes(`expected to finish ${lateBy} business day${lateBy === 1 ? '' : 's'} late`), w6);
  void w6due;
  /* R9 §13: "waiting on" only along a real dependency edge */
  const docs = st.docs, wt = id => find(st, 'workItem', id).data;
  r.body.risks.filter(x => /waiting on/.test(x)).forEach(x => {
    const m = /^“([^”]+)”.*waiting on “([^”]+)”/.exec(x);
    assert.ok(m, x);
    const w = docs.workItem.map(d => d.data).find(y => y.title === m[1]), dep = docs.workItem.map(d => d.data).find(y => y.title === m[2]);
    assert.ok((w.deps || []).map(d => (typeof d === 'string' ? d : d.id)).includes(dep.id), 'a real dependency: ' + x);
  });
  assert.ok(wt('W11').deps.length === 0 && !r.body.risks.some(x => x.startsWith('“Send each invoice to the right approver by amount”') && /waiting on/.test(x)), 'a parallel task is never "waiting on"');
});

test('R4 SOP parser: otherwise/else -> No, resubmit and return-to-step -> goto, no truncation, no default owner', () => {
  const docs = seed('2026-11-04').docs;
  const longSub = 'Attach every itemized receipt, including scanned paper receipts from travel and the hotel folio for overnight stays abroad';
  const r = ai.sopRules([
    '1. Employee submits the expense report with all itemized receipts attached and coded to the right cost center for the month',
    '   a. ' + longSub,
    '2. Manager reviews the report. If approved, AP clerk pays it. Otherwise, the employee corrects it and resubmits.',
    '3. If the receipts are missing, return to step 1',
    '4. If the amount is over $500, return to step 6',
    '5. Treasury releases payment',
    '6. If the bank rejects the payment, go back to step 5. Else, AP clerk closes the claim.',
    '7. Supervisor signs off',
  ].join('\n'), docs);
  const n = r.nodes;
  const ids = [];
  const walk = ns => ns.forEach(x => { ids.push(x.id); (x.branches || []).forEach(b => walk(b.nodes)); });
  walk(n);
  assert.equal(new Set(ids).size, ids.length, 'unique node ids');
  assert.ok(ids.every(Boolean));
  /* R8: a long sentence is shortened at a clause boundary; the full sentence is kept as the step's note (never "…") */
  assert.equal(n[1].title, 'Submit the expense report with all itemized receipts attached');
  assert.equal(n[1].note, 'Employee submits the expense report with all itemized receipts attached and coded to the right cost center for the month');
  assert.equal(n[1].ownerRole, 'Employee');
  assert.equal(n[1].subs[0].title, longSub, 'sub-steps are never truncated');
  assert.ok(!JSON.stringify(n).includes('…'));
  const approve = n[3];
  assert.equal(approve.type, 'decision');
  assert.deepEqual([approve.branches[1].nodes[0].title, approve.branches[1].nodes[0].ownerRole], ['Correct it and resubmit', 'Employee'], 'otherwise -> No');
  assert.equal(approve.branches[1].goto, n[1].id, 'resubmit loops back to the submission step');
  assert.equal(n[4].branches[0].goto, n[1].id, 'return to step 1');
  assert.deepEqual(n[4].branches[0].nodes, []);
  assert.equal(n[5].branches[0].goto, n[7].id, 'forward reference to step 6 resolves');
  assert.equal(n[7].branches[0].goto, n[6].id, 'go back to step 5');
  assert.equal(n[7].branches[1].nodes[0].title, 'Close the claim', 'else -> No');
  assert.deepEqual([n[7].branches[1].nodes[0].owner, n[7].branches[1].nodes[0].ownerRole], [undefined, 'AP clerk']);
  assert.equal(n[8].title, 'Sign off');
  assert.equal(n[8].owner, undefined, 'no match -> no owner (never a default person)');
  assert.equal(n[8].ownerRole, 'Supervisor');
  assert.equal(n[2].owner, undefined, '"Manager" is not a role alias or BU');
  if (engine && engine.readiness) {
    /* the parsed flow is a valid process for the engine's process-valid rule (gotos resolve) */
    const ok = (nodes) => nodes.every(x => !x.branches || x.branches.every(b => !b.goto || ids.includes(b.goto)));
    assert.ok(ok(n));
  }
});

test('R4 seed: owner confirmations, BU touches, sprints', () => {
  const s = seed('2026-11-04');
  const live = s.docs.dataElement.map(d => d.data).filter(d => d.avail === 'live');
  assert.ok(live.length >= 3);
  for (const d of live) { assert.equal(d.liveConfirmedBy, d.owner); assert.ok(d.liveSource && d.liveConfirmedAt); }
  for (const d of s.docs.dataElement.map(x => x.data).filter(x => x.avail !== 'live')) assert.equal(d.liveConfirmedBy, undefined);
  const bus = new Set(s.people.map(p => p.bu));
  const people = Object.fromEntries(s.people.map(p => [p.id, p]));
  const touchesOtherBu = s.docs.process.flatMap(p => p.data.tobe).filter(n => n.owner && (n.touches || []).some(t => bus.has(t) && t !== people[n.owner].bu));
  assert.ok(touchesOtherBu.length >= 2, 'some steps touch another BU');
  const vm = s.docs.project.find(d => d.id === 'vendor-modernization').data;
  assert.equal(vm.sprints.length, 6);
  assert.ok(vm.sprints.every(sp => new Date(sp.start + 'T12:00:00Z').getUTCDay() === 1 && new Date(sp.end + 'T12:00:00Z').getUTCDay() === 5));
  assert.equal(s.docs.project.find(d => d.id === 'access-review-automation').data.sprints, undefined, 'auto-built sprints there');
  assert.equal(s.docs.notification.find(d => d.id === 'N2').data.to, 'lp');
});

/* ------------------------------ Round 5 ------------------------------ */
/* Bring access-review to a passing gate: runbook (confirmed go/no-go), A4 done, fresh IT + Compliance sign-offs. */
async function readyAccessReview(ws, runbookOpts) {
  await addRunbook(ws, runbookOpts);
  const st = await state(ws);
  await call('PUT', `ws/${ws}/doc/workItem/A4`, { actor: 'ps', data: Object.assign({}, find(st, 'workItem', 'A4').data, { status: 'done', doneAt: st.today, time: [{ by: 'ps', date: st.today, hours: 4 }] /* R15 #8: hours logged, so the Done needs no second person */ }) });
  const at = new Date(Date.now() + 1500).toISOString();
  await call('PUT', `ws/${ws}/doc/approval/AP9`, { actor: 'do', data: { projectId: 'access-review-automation', bu: 'Compliance', approver: 'do', decision: 'approved', at, snapshotAt: at, stepUp: true, note: 'ok' } });
  return state(ws);
}

test('R5 [S] permissions: process editors, PM-only project fields, release manager only', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const vo = find(st, 'process', 'vendor-onboarding').data;
  let r = await call('PUT', `ws/${ws}/doc/process/vendor-onboarding`, { actor: 'ta', data: Object.assign({}, vo, { desc: 'edited' }) });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /Ask Maya Chen for edit access/);
  r = await call('PUT', `ws/${ws}/doc/process/vendor-onboarding`, { actor: 'lp', data: Object.assign({}, vo, { desc: 'edited by a resource' }) });
  assert.equal(r.status, 200);
  r = await call('DELETE', `ws/${ws}/doc/process/vendor-onboarding`, { actor: 'ta' });
  assert.equal(r.status, 403);
  r = await call('PUT', `ws/${ws}/doc/process/new-proc`, { actor: 'ta', data: { name: 'New', owner: 'ta', resources: ['ta'], version: 1, asis: [], tobe: [], released: [] } });
  assert.equal(r.status, 200, 'creator who owns a new process may save it');

  const vm = find(st, 'project', 'vendor-modernization').data;
  for (const [k, v] of [['cutover', { rollbackOwner: 'mc' }], ['releaseManager', 'mc'], ['processes', ['vendor-onboarding']]]) {
    r = await call('PUT', `ws/${ws}/doc/project/vendor-modernization`, { actor: 'mc', data: Object.assign({}, vm, { [k]: v }) });
    assert.equal(r.status, 403, k);
    assert.match(r.body.error, /Only the project manager \(Tom Alvarez\)/);
  }
  r = await call('PUT', `ws/${ws}/doc/project/vendor-modernization`, { actor: 'mc', data: Object.assign({}, vm, { desc: 'Clarified scope' }) });
  assert.equal(r.status, 200, 'other fields stay editable');
  r = await call('PUT', `ws/${ws}/doc/project/vendor-modernization`, { actor: 'ta', data: Object.assign({}, vm, { desc: 'Clarified scope', cutover: { rollbackOwner: 'dk' } }) });
  assert.equal(r.status, 200);
  assert.ok(r.body.doc.data.cutoverUpdatedAt, 'cutover edits are stamped');
  const stamp = r.body.doc.data.cutoverUpdatedAt;
  r = await call('PUT', `ws/${ws}/doc/project/vendor-modernization`, { actor: 'ta', data: Object.assign({}, r.body.doc.data, { desc: 'no cutover change' }) });
  assert.equal(r.body.doc.data.cutoverUpdatedAt, stamp, 'unchanged cutover keeps its stamp');

  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'dk' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /Only the release manager \(Tom Alvarez\)/);
  r = await call('POST', `ws/${ws}/rollback/access-review-automation`, { actor: 'ps' });
  assert.equal(r.status, 403);
});

test('R5 connection check: simulated probe stored on the data element', async () => {
  const ws = await newWs();
  let r = await call('POST', `ws/${ws}/check/D4`, { actor: 'ar' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(r.body.at && /ERP vendor API/.test(r.body.detail));
  r = await call('POST', `ws/${ws}/check/D2`, { actor: 'lp' });
  assert.equal(r.body.ok, false, 'missing data fails the probe');
  await call('PUT', `ws/${ws}/doc/dataElement/D99`, { actor: 'mc', data: { name: 'Shipping terms', owner: 'mc', source: '', avail: 'example', fields: [], samples: [], discovered: [] } });
  r = await call('POST', `ws/${ws}/check/D99`, { actor: 'mc' });
  assert.equal(r.body.ok, false);
  assert.match(r.body.detail, /No source/);
  assert.equal((await call('POST', `ws/${ws}/check/D404`, {})).status, 404);
  const st = await state(ws);
  assert.equal(find(st, 'dataElement', 'D4').data.check.ok, true);
  assert.equal(find(st, 'dataElement', 'D2').data.check.ok, false);
  const ev = (await call('GET', `ws/${ws}/events`, null, { ref: 'dataElement:D4' })).body.events;
  assert.equal(ev[0].summary, 'Connection check for Vendor master record: ok');
});

test('R5 release orchestration: gate -> go/no-go -> pipeline failure has no side effects -> success -> rollback undoes', { skip: !engine && 'no engine' }, async () => {
  const ws = await newWs();
  /* go/no-go task not confirmed: refused after the gate */
  let st = await readyAccessReview(ws, { done: false });
  let r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.ok(r.body.reasons.some(x => /Go\/no-go task "Enable automated campaign" is not confirmed/.test(x)), JSON.stringify(r.body.reasons));
  st = await readyAccessReview(ws);
  const gate = engine.readiness(st.docs, 'access-review-automation', st.today);
  assert.equal(gate.pass, true, JSON.stringify(gate.checks.filter(c => !c.pass)));

  /* simulated pipeline failure */
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta', simulateFailure: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.failed, true);
  assert.equal(r.body.release.status, 'failed');
  assert.equal(r.body.release.kind, 'golive');
  st = await state(ws);
  assert.equal(find(st, 'process', 'access-review').data.version, 1, 'no promotion');
  assert.equal(find(st, 'grant', 'G4').data.status, 'active', 'no grant expiry');
  assert.equal(find(st, 'project', 'access-review-automation').data.status, 'active');
  assert.ok(!r.body.release.actions.some(a => a.type === 'sop-publish'), 'no SOP publish');
  const notes = st.docs.notification.map(d => d.data).filter(n => n.ref === 'release:' + r.body.release.id);
  assert.deepEqual(notes.map(n => n.to), ['ta'], 'only the release manager is notified');

  /* success */
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.release.status, 'succeeded');
  const goliveId = r.body.release.id;
  st = await state(ws);
  assert.equal(find(st, 'process', 'access-review').data.version, 2);
  assert.equal(find(st, 'grant', 'G4').data.status, 'expired');

  /* rollback undoes the side effects and records them */
  r = await call('POST', `ws/${ws}/rollback/access-review-automation`, { actor: 'ta', reason: 'Campaign emails misrouted' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rb = r.body.release;
  assert.equal(rb.undoes, goliveId);
  assert.ok(rb.undone.some(u => u.type === 'process-version' && u.from === 2 && u.to === 1));
  assert.ok(rb.undone.some(u => u.type === 'sop-publish' && u.to === 1));
  assert.ok(rb.actions.some(a => a.type === 'sop-publish' && /v1/.test(a.target)));
  st = await state(ws);
  assert.equal(find(st, 'process', 'access-review').data.version, 1);
  assert.equal(find(st, 'release', goliveId).data.rolledBackBy, rb.id);
});

test('R5 status report: not-yet-live count and email recipients', async () => {
  const ws = await newWs();
  await r17ReadyCompliance(ws);   // R17 #4: Compliance's two newly in-scope pieces get their tests
  const r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization' });
  const st = await state(ws);
  const notLive = r.body.facts.notLive.length;
  if (engine && engine.effectiveAvail) {
    const used = new Set(st.docs.process.filter(p => ['vendor-onboarding', 'invoice-approval'].includes(p.id))
      .flatMap(p => engine.flatSteps(p.data.tobe)).flatMap(n => (n.data || []).concat((n.subs || []).flatMap(x => x.data || []))));
    assert.equal(notLive, [...used].filter(id => engine.effectiveAvail(st.docs, id) !== 'live').length);
  }
  /* R8/R9: only the genuinely missing information (bank details) is Not available yet; Compliance's screening result is live */
  assert.deepEqual(r.body.facts.notLive.map(x => x.name).sort(), ['Bank remittance details']);
  assert.ok(r.body.summary.includes(`${notLive} ${notLive === 1 ? 'piece of information is' : 'pieces of information are'} not available yet`));
  assert.ok(!/connected|sample only|waiting for confirmation/i.test(r.body.summary + r.body.asks.join(' ')), 'Simple words only');
  assert.deepEqual(r.body.recipients.map(x => x.email), ['tom.alvarez@northwind.example', 'maya.chen@northwind.example', 'priya.shah@northwind.example',
    'leo.park@northwind.example', 'ana.ruiz@northwind.example', 'dev.kumar@northwind.example', 'dave.ortiz@northwind.example',
    /* R15 (Jordan): an approver asked to approve (again) in the report (Rosa Vega, Procurement) is on the list */
    'rosa.vega@northwind.example']);
  /* R14 (Jordan E): everyone with an ask is on the list (Dave Ortiz approves Compliance's part) */
  assert.ok(r.body.asks.some(a => /^Dave Ortiz:/.test(a)), r.body.asks.join(' | '));
});

test("R5 SOP parser: reviewers' exact phrasings", () => {
  const docs = seed('2026-11-04').docs;
  const r = ai.sopRules([
    '1. Ana Ruiz receives the invoice and enters it in the ERP',
    '2. Manager reviews the invoice. If approved, Ana Ruiz schedules the payment for the next pay run; otherwise the manager approves an exception or returns it to the vendor with comments',
    '3. If the PO does not match, go back to step 1',
    '4. If the vendor disputes the amount, return to step 1',
    '5. Leo Park releases payment',
  ].join('\n'), docs);
  const n = r.nodes;
  assert.equal(n[1].owner, 'ar', 'full-name owner');
  assert.equal(n[1].system, 'ERP');
  assert.equal(n[1].title, 'Receive the invoice and enter it');
  assert.deepEqual([n[2].title, n[2].ownerRole], ['Review the invoice', 'Manager']);
  assert.equal(n[3].type, 'decision');
  assert.equal(n[3].title, 'Approved?');
  assert.deepEqual(n[3].branches[0].nodes.map(x => [x.title, x.owner]), [['Schedule the payment for the next pay run', 'ar']]);
  assert.deepEqual(n[3].branches[1].nodes.map(x => [x.title, x.ownerRole]), [['Approve an exception or return it to the vendor with comments', 'Manager']], 'otherwise -> No');
  assert.equal(n[4].branches[0].goto, n[1].id, 'go back to step 1');
  assert.equal(n[5].branches[0].goto, n[1].id, 'return to step 1');
  assert.equal(n[6].owner, 'lp');
  /* ", otherwise" (comma) is also a No branch */
  const c = ai.sopRules('1. If approved, Ana Ruiz pays the invoice, otherwise the manager approves the exception', docs);
  assert.equal(c.nodes[1].branches[1].nodes[0].title, 'Approve the exception');
});

test('R5 seed: release manager, day rates, program and budget, evidence on live data, no HR unless touched', () => {
  const s = seed('2026-11-04');
  for (const p of s.docs.project.map(d => d.data)) {
    assert.equal(p.releaseManager, p.owner);
    assert.ok(p.program && p.budget && p.budget.planned > 0);
  }
  assert.ok(s.people.every(p => p.dayRate > 0));
  for (const d of s.docs.dataElement.map(x => x.data).filter(x => x.avail === 'live')) {
    assert.equal(d.liveEvidence.type, 'check');
    assert.equal(d.check.ok, true);
    assert.equal(d.liveEvidence.by, d.owner);
  }
  const touchesHR = JSON.stringify(s.docs.process).includes('"HR"');
  assert.equal(s.people.some(p => p.bu === 'HR'), touchesHR);
  const ar = s.docs.project.find(d => d.id === 'access-review-automation').data;
  assert.equal((ar.cutover.tasks || []).length, 0, 'seed keeps no runbook by design');
  const d7 = s.docs.dataElement.find(d => d.id === 'D7').data;
  const covered = new Set(s.docs.testCase.map(d => d.data).filter(c => c.dataId === 'D7').map(c => c.field));
  assert.ok(d7.fields.every(f => covered.has(f.name)), 'every D7 spec field has a case');
});

test('R5 runbook ticks: task owner may confirm own task without staling approvals; others may not', async () => {
  const ws = await newWs();
  let st = await state(ws);
  const pr = find(st, 'project', 'access-review-automation').data;
  const tasks = [{ id: 'CT1', order: 1, task: 'Enable automated campaign', owner: 'dk', planned: '08:00', gonogo: true, done: false },
    { id: 'CT2', order: 2, task: 'Confirm manager list', owner: 'ps', planned: '08:30', gonogo: true, done: false }];
  let r = await call('PUT', `ws/${ws}/doc/project/access-review-automation`, { actor: 'ta', data: Object.assign({}, pr, { cutover: Object.assign({}, pr.cutover, { tasks }) }) });
  assert.equal(r.status, 200);
  const stamp = r.body.doc.data.cutoverUpdatedAt;
  assert.ok(stamp);
  const tick = (base, id, by) => Object.assign({}, base, { cutover: Object.assign({}, base.cutover, {
    tasks: base.cutover.tasks.map(t => (t.id === id ? Object.assign({}, t, { done: true, doneAt: new Date().toISOString(), doneBy: by }) : t)) }) });
  /* Priya ticks her own task: allowed, no stamp */
  r = await call('PUT', `ws/${ws}/doc/project/access-review-automation`, { actor: 'ps', data: tick(r.body.doc.data, 'CT2', 'ps') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.doc.data.cutoverUpdatedAt, stamp, 'a tick is not a cutover edit');
  const afterTick = r.body.doc.data;
  /* Priya ticks Dev's task: refused */
  r = await call('PUT', `ws/${ws}/doc/project/access-review-automation`, { actor: 'ps', data: tick(afterTick, 'CT1', 'ps') });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /Dev Kumar/);
  /* Priya edits task text: PM-only */
  const edited = Object.assign({}, afterTick, { cutover: Object.assign({}, afterTick.cutover, { tasks: afterTick.cutover.tasks.map(t => (t.id === 'CT2' ? Object.assign({}, t, { task: 'Changed' }) : t)) }) });
  r = await call('PUT', `ws/${ws}/doc/project/access-review-automation`, { actor: 'ps', data: edited });
  assert.equal(r.status, 403);
  /* the PM edits the text: stamped */
  await new Promise(res => setTimeout(res, 5));
  r = await call('PUT', `ws/${ws}/doc/project/access-review-automation`, { actor: 'ta', data: edited });
  assert.equal(r.status, 200);
  assert.ok(r.body.doc.data.cutoverUpdatedAt > stamp);
});

/* ------------------------------ Round 6 ------------------------------ */
const since = async (ws, at) => (await call('GET', `ws/${ws}/events`, null, { limit: '500' })).body.events.filter(e => e.at >= at).reverse();
const strictlyIncreasing = evs => evs.every((e, i) => i === 0 || evs[i - 1].at < e.at);

test('R6 audit order: go-live events are truthful and strictly chronological; a failed go-live writes one failure event', { skip: !engine && 'no engine' }, async () => {
  const ws = await newWs();
  await readyAccessReview(ws);
  /* failure first */
  let r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta', simulateFailure: true, stepUp: { at: new Date().toISOString() } });
  assert.equal(r.status, 200);
  assert.equal(r.body.failed, true);
  assert.equal(r.body.release.stepUp.by, 'ta');
  let evs = await since(ws, r.body.release.at);
  assert.deepEqual(evs.map(e => e.action), ['golive-approved', 'pipeline-started', 'golive-failed', 'notify']);
  assert.ok(strictlyIncreasing(evs), JSON.stringify(evs.map(e => e.at)));
  assert.equal(evs.filter(e => /fail/i.test(e.action) || /failed/i.test(e.summary) && e.action !== 'notify').length, 1, 'exactly one failure event');
  assert.equal(Date.parse(evs[1].at) - Date.parse(evs[0].at), 1, '+1 ms per step');
  /* success */
  await new Promise(res => setTimeout(res, 5));
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  evs = await since(ws, r.body.release.at);
  assert.deepEqual(evs.map(e => e.action), ['golive-approved', 'pipeline-started', 'pipeline-succeeded', 'release', 'golive', 'sop-publish', 'expire', 'notify'],
    'approval -> pipeline started -> pipeline result -> promotion -> SOP publish -> grants expired -> notifications');
  assert.ok(strictlyIncreasing(evs));
  evs.forEach((e, i) => { if (i) assert.equal(Date.parse(e.at) - Date.parse(evs[i - 1].at), 1); });
  assert.equal(evs[6].ref, 'grant:G4');
  assert.match(evs[0].summary, /approved by Tom Alvarez \(step-up verified\)/);
  assertNoIds(evs.map(e => e.summary), (await state(ws)).docs, 'audit summaries');
  /* the events endpoint (newest first) is exactly the reverse */
  const newest = (await call('GET', `ws/${ws}/events`, null, { limit: '8' })).body.events;
  assert.deepEqual(newest.map(e => e.action), evs.map(e => e.action).reverse());
  const st = await state(ws);
  assert.equal(find(st, 'project', 'access-review-automation').data.liveAt, evs[4].at);
});

test('R6 rollback runs a simulated pipeline: a failed rollback restores nothing; success is ordered', { skip: !engine && 'no engine' }, async () => {
  const ws = await newWs();
  await readyAccessReview(ws);
  let r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const goliveId = r.body.release.id;
  await new Promise(res => setTimeout(res, 5));
  /* failed rollback */
  r = await call('POST', `ws/${ws}/rollback/access-review-automation`, { actor: 'ta', reason: 'Reminder emails duplicated', simulateFailure: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.failed, true);
  assert.equal(r.body.release.kind, 'rollback');
  assert.equal(r.body.release.status, 'failed');
  assert.equal(r.body.release.actions[0].status, 'simulated-failed');
  let evs = await since(ws, r.body.release.at);
  assert.deepEqual(evs.map(e => e.action), ['rollback-approved', 'pipeline-started', 'rollback-failed', 'notify']);
  assert.ok(strictlyIncreasing(evs));
  let st = await state(ws);
  assert.equal(find(st, 'process', 'access-review').data.version, 2, 'nothing restored');
  assert.equal(find(st, 'project', 'access-review-automation').data.status, 'live', 'still live');
  assert.equal(find(st, 'release', goliveId).data.rolledBackBy, undefined);
  assert.deepEqual(st.docs.notification.map(d => d.data).filter(n => n.ref === 'release:' + r.body.release.id).map(n => n.to), ['ta']);
  /* successful rollback */
  await new Promise(res => setTimeout(res, 5));
  r = await call('POST', `ws/${ws}/rollback/access-review-automation`, { actor: 'ta', reason: 'Reminder emails duplicated' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.release.status, 'succeeded');
  assert.equal(r.body.release.actions[0].type, 'pipeline');
  evs = await since(ws, r.body.release.at);
  assert.deepEqual(evs.map(e => e.action), ['rollback-approved', 'pipeline-started', 'pipeline-succeeded', 'rollback', 'sop-publish', 'rollback', 'notify'],
    'rollback approved -> pipeline -> restore -> re-publish -> notifications');
  assert.equal(evs[3].ref, 'process:access-review');
  assert.equal(evs[5].ref, 'project:access-review-automation');
  assert.ok(strictlyIncreasing(evs));
  st = await state(ws);
  assert.equal(find(st, 'process', 'access-review').data.version, 1);
  assert.equal(find(st, 'release', goliveId).data.rolledBackBy, r.body.release.id);
});

test('R6 status report: projectHealth RAG, earned value, hypercare incidents', { skip: !engine && 'no engine' }, async () => {
  const ws = await newWs();
  let st = await state(ws);
  let r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization' });
  if (typeof engine.projectTruth === 'function') {
    const t = engine.projectTruth(st.docs, 'vendor-modernization', st.today);
    assert.equal(r.body.rag, t.rag);
    assert.deepEqual(r.body.facts.rag.reasons, t.reasons);
    assert.equal(r.body.facts.rag.source, 'projectTruth');
  }
  const ev = r.body.facts.earnedValue;
  assert.ok(ev && typeof ev.spi === 'number' && typeof ev.cpi === 'number' && ev.ac > 0, JSON.stringify(ev));
  if (typeof engine.earnedValue === 'function') {
    const e = engine.earnedValue(st.docs, 'vendor-modernization', st.today);
    const k = Object.keys(e).find(x => x.toLowerCase() === 'spi');
    assert.equal(ev.spi, Math.round(e[k] * 100) / 100);
  }
  /* R7: earned value only in the advanced appendix */
  assert.ok(!/SPI|CPI/.test(r.body.summary + r.body.highlights.join(' ')) && r.body.appendix === undefined);
  r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization', advanced: true });
  assert.ok(r.body.appendix.some(x => /\(SPI\) \d+\.\d\d, cost performance \(CPI\) \d+\.\d\d/.test(x)), JSON.stringify(r.body.appendix));
  assert.equal(r.body.facts.hypercare, null, 'no hypercare before go-live');
  /* live: hypercare days and incidents; an open sev-1 means "consider rollback" */
  await readyAccessReview(ws);
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  st = await state(ws);
  const proj = find(st, 'project', 'access-review-automation').data;
  const incidents = [{ id: 'I1', title: 'Removal job revoked a manager by mistake', severity: 1, at: new Date().toISOString(), by: 'ps', status: 'open' },
    { id: 'I2', title: 'Reminder email typo', severity: 4, at: new Date().toISOString(), by: 'dk', status: 'closed' }];
  const put = await call('PUT', `ws/${ws}/doc/project/access-review-automation`, { actor: 'ta', data: Object.assign({}, proj, { incidents }) });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'access-review-automation' });
  const hc = r.body.facts.hypercare;
  assert.equal(hc.owner, 'Priya Shah');
  assert.equal(hc.days, 10);
  assert.equal(hc.daysRemaining, 10);
  assert.deepEqual(hc.open.map(i => i.title), ['Removal job revoked a manager by mistake'], 'closed incidents are not open');
  assert.equal(hc.considerRollback, true);
  assert.ok(r.body.risks.some(x => /Serious problem "Removal job revoked a manager by mistake" is still open: consider rolling back/.test(x)), JSON.stringify(r.body.risks));
  assert.ok(r.body.asks.some(x => /roll back/.test(x)));
  assert.match(r.body.summary, /Support after launch: 10 days left, led by Priya Shah; 1 open problem\./);
});

test('R6 SOP parser: no "()" titles; only document/record/field phrases are proposed, each with a stable key', () => {
  const docs = seed('2026-11-04').docs;
  const sop = [
    '1. Receiving clerk records the delivery in the ERP',
    '2. Finance approves the payment (if over $5,000)',
    '3. AP clerk attaches the W-9 () and the bank statement',
    '4. Keep a record of deliveries for the audit',
    '5. Employee submits the expense report with receipts',
    '6. Clerk enters the PO number and the employee ID (see policy',
    '7. Manager reports the variance to Treasury',
  ].join('\n');
  const r = ai.sopRules(sop, docs);
  const all = [];
  const walk = ns => ns.forEach(n => { all.push(n); (n.subs || []).forEach(x => all.push(x)); (n.branches || []).forEach(b => walk(b.nodes)); });
  walk(r.nodes);
  for (const n of all) {
    assert.ok(!/\(\s*\)/.test(n.title), `empty parentheses in "${n.title}"`);
    assert.equal((n.title.match(/\(/g) || []).length, (n.title.match(/\)/g) || []).length, `unbalanced parentheses in "${n.title}"`);
  }
  assert.ok(all.some(n => n.title === 'Approve the payment' && n.ownerRole === 'Finance'));
  assert.ok(all.some(n => n.title === 'Amount over $5,000?'));
  const names = r.newData.map(x => x.name);
  assert.deepEqual(names.sort(), ['Bank statement', 'Employee ID', 'Expense report', 'PO number', 'Receipts', 'Record of deliveries'].sort(), JSON.stringify(names));
  assert.ok(!names.some(x => /clerk|records the|manager|reports the/i.test(x)), 'no role phrases');
  /* stable keys; every proposal names the steps that need it, and those steps carry {key, name} */
  const ids = new Set(all.filter(n => n.id).map(n => n.id));
  for (const p of r.newData) {
    assert.match(p.key, /^nd-[a-z0-9-]+$/);
    assert.ok(p.steps.length && p.steps.every(id => ids.has(id)), p.name);
    for (const id of p.steps) assert.ok(all.find(n => n.id === id).newData.some(x => x.key === p.key && x.name === p.name));
  }
  assert.equal(new Set(r.newData.map(x => x.key)).size, r.newData.length);
  assert.deepEqual(ai.sopRules(sop, docs).newData.map(x => x.key), r.newData.map(x => x.key), 'deterministic keys');
  /* the employee-vs-vendor cross-domain proposal keeps its document phrase */
  const e = ai.sopRules("1. Accounts Payable pulls the employee's bank details from Workday", docs);
  assert.deepEqual(e.newData.map(x => [x.key, x.name]), [['nd-employee-bank-details', 'Employee bank details']]);
});

test('R6 SOP AI path: model proposals are filtered to document phrases and keyed (mocked Azure OpenAI)', async () => {
  const docs = seed('2026-11-04').docs;
  const saved = global.fetch;
  Object.assign(process.env, { AZURE_OPENAI_ENDPOINT: 'https://example.invalid', AZURE_OPENAI_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'd' });
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      nodes: [{ type: 'trigger', title: 'Delivery arrives' }, { id: 'x1', type: 'step', title: 'Receiving clerk records the delivery ()', newData: ['Delivery receipt', 'Receiving clerk records'] }],
      newData: [{ name: 'Receiving clerk records', reason: 'r' }, { name: 'Delivery receipt', reason: 'r' }, { name: 'Bank remittance details', reason: 'exists' }] }) } }] }) });
    const r = await ai.run('sop-import', { text: '1. Receiving clerk records the delivery' }, docs, '2026-11-04');
    assert.equal(r.body.source, 'ai');
    assert.deepEqual(r.body.newData.map(x => [x.key, x.name, x.steps]), [['nd-delivery-receipt', 'Delivery receipt', ['x1']]]);
    assert.deepEqual([r.body.nodes[1].title, r.body.nodes[1].ownerRole], ['Record the delivery', 'Receiving clerk'], 'R8: the actor is stripped from model titles too');
    assert.deepEqual(r.body.nodes[1].newData, [{ key: 'nd-delivery-receipt', name: 'Delivery receipt' }]);
  } finally {
    global.fetch = saved;
    ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_DEPLOYMENT'].forEach(k => delete process.env[k]);
  }
});

test('R6 seed: statuses, custom field, time, budget/program, day rates, new node types, unique fields, defects, runbook', () => {
  const s = seed('2026-11-04');
  const prj = id => s.docs.project.find(d => d.id === id).data;
  const vm = prj('vendor-modernization'), ar = prj('access-review-automation');
  for (const p of [vm, ar]) {
    assert.deepEqual(p.statuses.map(x => x.name), ['Not started', 'In progress', 'In review', 'Done']);
    assert.ok(p.statuses.every(x => ['idle', 'prog', 'done'].includes(x.maps)));
    assert.ok(p.budget.planned > 0 && p.program);
  }
  assert.deepEqual(vm.fields, [{ key: 'riskArea', label: 'Risk area', type: 'select', options: ['Compliance', 'Banking', 'Integration', 'Process'] }]);
  assert.equal(ar.fields, undefined);
  const work = s.docs.workItem.map(d => d.data);
  assert.ok(work.filter(w => w.projectId === 'vendor-modernization').every(w => vm.fields[0].options.includes(w.custom.riskArea)));
  const logged = work.filter(w => ['done', 'prog'].includes(w.status));
  assert.ok(logged.length >= 8 && logged.every(w => w.time.length && w.time.every(t => t.by && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.hours > 0 && t.hours <= 8)));
  assert.ok(logged.every(w => w.time.every(t => t.date >= w.start && t.date < '2026-11-04' && ![0, 6].includes(new Date(t.date + 'T12:00:00Z').getUTCDay()))));
  assert.ok(work.filter(w => w.status === 'idle').every(w => !w.time));
  assert.ok(s.people.every(p => p.dayRate > 0));
  /* new node types in vendor-onboarding's to-be */
  const vo = s.docs.process.find(d => d.id === 'vendor-onboarding').data;
  const sp = vo.tobe.find(n => n.type === 'subprocess');
  assert.ok(sp && s.docs.process.some(d => d.id === sp.calls) && sp.calls === 'invoice-approval' && sp.owner);
  const wait = vo.tobe.find(n => n.type === 'wait');
  assert.equal(wait.title, 'Wait up to 2 business days for vendor documents');
  const msg = vo.tobe.find(n => n.type === 'message');
  assert.deepEqual([msg.title, msg.direction, msg.party], ['Notify vendor of activation', 'send', 'Vendor']);
  assert.ok([sp, wait, msg].every(n => n.owner));
  /* unique fields */
  const field = (did, name) => s.docs.dataElement.find(d => d.id === did).data.fields.find(f => f.name === name);
  assert.equal(field('D1', 'Tax ID (EIN)').unique, true);
  assert.equal(field('D2', 'Account number').unique, true);
  /* defects */
  const defects = work.filter(w => w.kind === 'defect');
  assert.ok(defects.length >= 2);
  for (const d of defects) {
    assert.ok([1, 2, 3, 4].includes(d.severity) && d.priority && ['dev', 'sit', 'uat', 'prod-verify'].includes(d.env) && d.repro.length > 20);
    assert.ok(['new', 'triaged', 'in progress', 'fixed', 'verified', 'closed'].includes(d.defectStatus));
  }
  assert.ok(defects.some(d => d.status !== 'done' && d.testRef && d.testRef.caseId === 'TC4'));
  /* runbook */
  assert.ok(vm.cutover.tasks.length >= 3);
  assert.ok(vm.cutover.tasks.every(t => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t.plannedStart) && t.durationMins > 0 && t.owner && t.done === false));
  assert.ok(vm.cutover.tasks.some(t => t.gonogo));
  /* grants: the time box starts at approval */
  const g = id => s.docs.grant.find(d => d.id === id).data;
  assert.equal(g('G2').status, 'requested');
  assert.equal(g('G2').expires, undefined, 'no countdown on a requested grant');
  for (const x of s.docs.grant.map(d => d.data).filter(x => x.approvedAt)) assert.equal(fn._internal.grantExpiryError(Object.assign({}, x, { status: 'active' })), null, x.id);
  assert.ok(JSON.stringify(s.docs).length < 400000);
});

test('R6 grants: the API never starts a countdown on requested grants; approved expiry is at most 30 days from approval', { skip: !engine && 'no engine' }, async () => {
  const ws = await newWs();
  let st = await state(ws);
  const g2 = find(st, 'grant', 'G2').data;
  const now = new Date().toISOString();
  const plus = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  /* approve without an expiry: refused */
  let r = await call('PUT', `ws/${ws}/doc/grant/G2`, { actor: 'lp', data: Object.assign({}, g2, { status: 'active', approvedBy: 'lp', approvedAt: now }) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /30 days from approval/);
  /* 31 days after approval: refused; 30: accepted */
  r = await call('PUT', `ws/${ws}/doc/grant/G2`, { actor: 'lp', data: Object.assign({}, g2, { status: 'active', approvedBy: 'lp', approvedAt: now, expires: plus(31) }) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /at most 30 days after approval/);
  /* approval time from the log when approvedAt is missing */
  r = await call('PUT', `ws/${ws}/doc/grant/G2`, { actor: 'lp', data: Object.assign({}, g2, { status: 'active', approvedBy: 'lp', expires: plus(29),
    log: g2.log.concat([{ at: new Date(Date.now() - 5 * 86400000).toISOString(), by: 'lp', action: 'approved (step-up verified); access active' }]) }) });
  assert.equal(r.status, 400, 'log approval 5 days ago + 29 days > 30');
  r = await call('PUT', `ws/${ws}/doc/grant/G2`, { actor: 'lp', data: Object.assign({}, g2, { status: 'active', approvedBy: 'lp', approvedAt: now, expires: plus(30) }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  /* a new requested grant is stored as sent: no expiry invented */
  r = await call('PUT', `ws/${ws}/doc/grant/G9`, { actor: 'dk', data: { projectId: 'access-review-automation', dataId: 'D7', env: 'uat', access: 'read', reason: 'UAT', requestedBy: 'dk', status: 'requested', log: [] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.doc.data.expires, undefined);
  /* the gate refuses go-live while a request is open (it never ages into access) */
  await readyAccessReview(ws);
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 409);
  st = await state(ws);
  assert.equal(find(st, 'grant', 'G9').data.expires, undefined);
});

/* ================================ Round 7: SIMPLICITY ================================ */
const R7_JARGON = /\b(SPI|CPI|EAC|earned value|slip\w*|amber|UAT|SIT|go\/no-go|hypercare|Red|Green)\b/i;
const reportText = b => [b.headline, b.summary, ...b.highlights, ...b.risks, ...b.asks].join('\n');
const shiftDay = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

test('R7 status report: leads with projectSummary sentence + label, plain words only, advanced appendix, client today', { skip: !engine && 'no engine' }, async () => {
  const ws = await newWs();
  const st = await state(ws);
  for (const prj of ['vendor-modernization', 'access-review-automation']) {
    const r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: prj, today: st.today });
    assert.equal(r.status, 200);
    if (typeof engine.projectSummary === 'function') {
      const s = engine.projectSummary(st.docs, prj, st.today);
      assert.equal(r.body.label, s.label);
      assert.equal(r.body.sentence, s.sentence);
      assert.equal(r.body.facts.summary.source, 'projectTruth');
    }
    assert.ok(['On track', 'Some tasks late', 'Will miss the deadline', 'On track, some tasks running late', 'At risk', 'Not planned'].includes(r.body.label), r.body.label);
    assert.ok(!/Rules-based|deterministic/i.test(r.body.sourceLabel) && r.body.sourceLabel === 'Written from the project\'s facts', 'R9 §11: Simple label');
    assert.ok(r.body.headline.startsWith(r.body.label + ': '), r.body.headline);
    assert.ok(r.body.summary.startsWith(r.body.sentence), 'summary leads with the one sentence');
    assert.ok(!R7_JARGON.test(reportText(r.body)), 'no jargon in the default report: ' + (reportText(r.body).match(R7_JARGON) || [])[0]);
    assert.equal(r.body.appendix, undefined);
    assert.equal(r.body.date, st.today);
  }
  /* advanced: earned value and testing terms live in an appendix only */
  let r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization', advanced: true });
  assert.ok(Array.isArray(r.body.appendix) && r.body.appendix.some(x => /SPI/.test(x) && /EAC/.test(x)), JSON.stringify(r.body.appendix));
  assert.ok(r.body.appendix.some(x => /UAT/.test(x)), 'testing jargon allowed in the appendix');
  assert.ok(!R7_JARGON.test(reportText(r.body)), 'the body stays plain even in advanced');
  /* the client's today dates the report (no skew); a date far from the server's is ignored */
  const yday = shiftDay(st.today, -1);
  r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization', today: yday });
  assert.equal(r.body.date, yday);
  assert.equal(r.body.facts.today, yday);
  r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization', today: shiftDay(st.today, -30) });
  assert.equal(r.body.date, st.today);
  r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization', today: 'not-a-date' });
  assert.equal(r.body.date, st.today);
  assert.equal(fn._internal.clientToday({ today: '2026-02-30' }, '2026-03-01'), '2026-03-01');
});

test('R7 AI status report: plain-language prompt; jargon from the model is translated or dropped (mocked Azure OpenAI)', async () => {
  const ws = await newWs();
  const saved = global.fetch;
  Object.assign(process.env, { AZURE_OPENAI_ENDPOINT: 'https://example.invalid', AZURE_OPENAI_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'd' });
  let sent = null;
  try {
    const st = await state(ws);
    global.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      headline: 'Bank capture is late', summary: 'Work is moving. UAT starts next week.',
      highlights: ['3 tasks done', 'SPI is 0.8 and CPI is 1.1'], risks: ['Bank capture is slipping'], asks: ['Leo Park: finish bank capture'] }) } }] }) }; };
    let r = await ai.run('status-report', { projectId: 'vendor-modernization' }, st.docs, st.today);
    assert.equal(r.body.source, 'ai');
    const sys = sent.messages[0].content, facts = JSON.parse(sent.messages[1].content);
    assert.match(sys, /8th-grade reading level/);
    assert.match(sys, /non-technical reader/);
    assert.ok(sys.includes(r.body.sentence), 'the model is told to lead with the sentence');
    assert.equal(facts.earnedValue, undefined, 'no earned value sent by default');
    assert.ok(!JSON.stringify(facts).includes('"slip'), 'no slip wording sent by default');
    assert.equal(r.body.headline, `${r.body.label}: Bank capture is late`);
    assert.ok(r.body.summary.startsWith(r.body.sentence));
    assert.match(r.body.summary, /business testing starts next week/);
    /* R9: the counts, launch steps, testing and cost lines are the truth's, word for word; the model's are not used */
    const rules = ai.statusRules(ai.statusFacts(st.docs, 'vendor-modernization', st.today, engine));
    assert.deepEqual(r.body.highlights, rules.highlights, 'highlights come from the truth (an SPI/CPI line is dropped)');
    assert.deepEqual(r.body.asks, rules.asks, 'asks are the ranked who list');
    assert.deepEqual(r.body.risks, ['Bank capture is late'], 'R9 §1: one word, late');
    assert.equal(r.body.sourceLabel, 'Generated by AI');
    assert.match(sys, /waiting on/);
    assert.match(sys, /stepsLeft/);
    assert.match(sys, /testing\.next/);
    assert.ok(Array.isArray(facts.summary.who) && facts.stepsLeft != null && facts.testing.next, 'the model gets who, stepsLeft and testing.next');
    assert.ok(!R7_JARGON.test(reportText(r.body)));
    assert.equal(r.body.date, st.today);
    r = await ai.run('status-report', { projectId: 'vendor-modernization', advanced: true }, st.docs, st.today);
    assert.ok(r.body.highlights.some(x => /SPI/.test(x)) && Array.isArray(r.body.appendix), 'advanced keeps earned value');
  } finally {
    global.fetch = saved;
    ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_DEPLOYMENT'].forEach(k => delete process.env[k]);
  }
});

test('R7 approvals: saving an approval is never blocked by other failing checks; go-live still re-checks the gate', { skip: !engine && 'no engine' }, async () => {
  const ws = await newWs();
  await r17ReadyCompliance(ws);   // R17 #4: Compliance's two newly in-scope pieces get their tests
  let st = await state(ws);
  assert.equal(engine.readiness(st.docs, 'vendor-modernization', st.today).pass, false);
  const at = new Date().toISOString();
  /* R11 §2: Dave (Approver, does no Compliance steps, recorded no tests) approves Compliance's part */
  const r = await call('PUT', `ws/${ws}/doc/approval/AP-r7`, { actor: 'do', data: { projectId: 'vendor-modernization', bu: 'Compliance', approver: 'do',
    decision: 'approved', at, snapshotAt: at, stepUp: true, note: 'I reviewed the changes to screening and the test results' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  st = await state(ws);
  const bu = engine.readiness(st.docs, 'vendor-modernization', st.today).checks.find(c => c.id === 'bu-signoff');
  assert.ok(bu.sectionStatus.find(x => x.bu === 'Compliance').approved, 'the Compliance part counts as approved while other checks fail');
  const g = await call('POST', `ws/${ws}/golive/vendor-modernization`, { actor: 'ta' });
  assert.equal(g.status, 409);
  assert.ok(g.body.reasons.length > 0);
});

test('R7 project.approvers: the chosen approver may not be the PM or the launch owner (400); valid choices save', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const vm = find(st, 'project', 'vendor-modernization').data;
  const put = (approvers, extra) => call('PUT', `ws/${ws}/doc/project/vendor-modernization`, { actor: 'ta', data: Object.assign({}, vm, extra || {}, { approvers }) });
  let r = await put({ PMO: 'ta' });
  assert.equal(r.status, 400); assert.match(r.body.error, /Tom Alvarez is the project manager/);
  r = await put({ PMO: 'lp' }, { releaseManager: 'lp' });
  assert.equal(r.status, 400); assert.match(r.body.error, /Leo Park is the launch owner/);
  r = await put({ PMO: 'nobody' });
  assert.equal(r.status, 400); assert.match(r.body.error, /Choose a person/);
  r = await put(['mc']);
  assert.equal(r.status, 400);
  r = await put({ PMO: 'ps', Treasury: '' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  /* an unchanged choice never blocks other edits (the engine ignores it if it becomes ineligible) */
  const now = find(await state(ws), 'project', 'vendor-modernization').data;
  /* R16 N1 #6: the launch owner now changes only through "Change the plan" (409 on a plain save); the unchanged choice
     still never blocks another edit, and approversError still ignores a choice that became ineligible */
  r = await call('PUT', `ws/${ws}/doc/project/vendor-modernization`, { actor: 'ta', data: Object.assign({}, now, { releaseManager: 'ps' }) });
  assert.equal(r.status, 409, JSON.stringify(r.body)); assert.match(r.body.error, /Use “Change the plan” to hand the launch owner role to Priya Shah/);
  r = await call('PUT', `ws/${ws}/doc/project/vendor-modernization`, { actor: 'ta', data: Object.assign({}, now, { desc: 'Scope clarified (unchanged approver choice)' }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(fn._internal.approversError({ owner: 'ta', releaseManager: 'ps', approvers: { PMO: 'ps' } }, { owner: 'ta', releaseManager: 'ps', approvers: { PMO: 'ps' } }, st.docs), null, 'an unchanged choice that became ineligible never blocks');
  assert.equal(fn._internal.approversError(null, { owner: 'ta', approvers: { PMO: 'mc' } }, st.docs), null);
});

test('R7 SOP rules parser: unknown roles become ownerRole; notes are short and plain', () => {
  const docs = seed('2026-11-04').docs;
  const r = ai.sopRules('Expense claims\n1. Employee submits the expense report with receipts.\n2. Manager approves the expense report. If over $5,000, the Finance Director must also approve.\n' +
    '3. AP clerk pays it in the next payment run.\n4. Send the confirmation email.\n5. Employee bank details are checked by Leo Park.', docs);
  const steps = r.nodes.filter(n => n.type === 'step');
  const by = t => r.nodes.concat(r.nodes.flatMap(n => (n.branches || []).flatMap(b => b.nodes))).find(n => n.title && n.title.startsWith(t));
  assert.equal(by('Submit the expense').ownerRole, 'Employee');
  assert.equal(by('Submit the expense').owner, undefined);
  assert.equal(by('Approve the expense').ownerRole, 'Manager');
  assert.equal(r.nodes.find(n => n.type === 'decision').branches[0].nodes[0].ownerRole, 'Finance Director', 'R8: the role text as written');
  assert.equal(by('Pay it').owner, undefined, 'R8: a role is never turned into a guessed person');
  assert.equal(by('Pay it').ownerRole, 'AP clerk');
  assert.equal(by('Send the confirmation').ownerRole, undefined, 'a step that starts with a verb names no role');
  assert.equal(by('Employee bank details').owner, 'lp');
  assert.equal(by('Employee bank details').ownerRole, undefined);
  assert.ok(steps.length >= 4);
  assert.ok(!/node|gateway|trigger|top-level|alias/i.test(r.notes), r.notes);
  assert.ok(r.notes.length <= 220, 'notes stay short: ' + r.notes.length);
  assert.match(r.notes, /^Found \d+ steps/);
  assert.match(r.notes, /Employee, Manager, Finance Director, AP clerk are teams or roles/);
  /* AI path: ownerRole survives sanitising when no supplied person matches */
  const clean = ai._sanitizeSop({ nodes: [{ type: 'trigger', title: 'Claim made' }, { type: 'step', title: 'Approve claim', ownerRole: 'Line manager' },
    { type: 'step', title: 'Pay claim', owner: 'lp', ownerRole: 'Treasury' }] }, docs);
  assert.equal(clean.nodes[1].ownerRole, 'Line manager');
  assert.deepEqual([clean.nodes[2].owner, clean.nodes[2].ownerRole], ['lp', undefined]);
  assert.ok(!/node/i.test(clean.notes));
});

test('R7 seed: a role-owned step in a process with no project; the PMO section has an eligible approver', () => {
  const s = seed('2026-11-04');
  const projects = s.docs.project.map(d => d.data);
  const linked = new Set(projects.flatMap(p => p.processes));
  const free = s.docs.process.map(d => d.data).filter(p => !linked.has(p.id));
  assert.ok(free.length >= 1, 'a process with no project');
  const roleSteps = free.flatMap(p => p.tobe.filter(n => n.type === 'step' && !n.owner && n.ownerRole));
  assert.deepEqual(roleSteps.map(n => n.ownerRole), ['Employee']);
  for (const p of s.docs.process.map(d => d.data)) for (const n of p.tobe.concat(p.asis)) {
    if (n.type === 'step') assert.ok(n.owner || n.ownerRole, `${p.name} / ${n.title} has an owner or a role`);
  }
  const vm = projects.find(p => p.id === 'vendor-modernization');
  for (const [bu, pid] of Object.entries(vm.approvers || {})) {
    assert.ok(s.people.some(p => p.id === pid), bu);
    assert.ok(![vm.owner, vm.releaseManager].includes(pid), `${bu} approver is not the PM or launch owner`);
  }
  assert.equal(vm.approvers.PMO, 'mc', 'the process owner approves the PMO part');
  assert.ok(!JSON.stringify(s).match(/Witherite|Filevine|Acumatica/i));
});

/* ------------------------------ Round 8 ------------------------------ */
test('R8 SOP rules parser: actors, action-only titles, SLA, system, Owner: lines, skip-to goto, wait, money decision, information', () => {
  const docs = seed('2026-11-04').docs;
  const r = ai.sopRules([
    'Purchase request SOP',
    'Owner: Finance Operations',
    '1. Requester submits the purchase request',
    '2. Collect three quotes',
    '3. Procurement creates a PO within 2 business days in the ERP',
    'Owner: Records Clerk',
    '4. If the amount is over $5,000 the Finance Director approves; otherwise skip to step 5',
    '5. Wait for the weekly payment run',
    '6. Compliance analyst checks the cost centre and budget code',
    '7. Leo Park releases the payment',
  ].join('\n'), docs);
  const n = r.nodes;
  assert.deepEqual(n.map(x => x.type), ['trigger', 'step', 'step', 'step', 'decision', 'wait', 'step', 'step'], JSON.stringify(n.map(x => x.title)));
  /* the document owner line before any step is not a step and not an owner */
  assert.ok(!n.some(x => /finance operations/i.test(x.title || '') || x.ownerRole === 'Finance Operations'));
  assert.deepEqual([n[1].title, n[1].ownerRole, n[1].owner], ['Submit the purchase request', 'Requester', undefined]);
  /* "Collect three quotes": already an action, nobody named, quotes are information */
  assert.deepEqual([n[2].title, n[2].owner, n[2].ownerRole], ['Collect three quotes', undefined, undefined]);
  assert.ok(n[2].newData.some(x => x.name === 'Quotes'));
  /* "Procurement creates a PO within 2 business days in the ERP" + "Owner: Records Clerk" */
  const po = n[3];
  assert.equal(po.title, 'Create a PO');
  assert.equal(po.sla, '2 business days');
  assert.equal(po.system, 'ERP');
  assert.deepEqual([po.owner, po.ownerRole], [undefined, 'Records Clerk'], 'an "Owner:" line names who does the step');
  assert.ok(po.newData.some(x => x.name === 'Purchase order'));
  assert.ok(!/procurement|within|business days|ERP/i.test(po.title), 'actor, SLA and system are stripped from the title');
  /* money threshold -> decision: Yes = conditional action, No = continue / skip to step 5 */
  const dec = n[4];
  assert.equal(dec.title, 'Amount over $5,000?');
  assert.deepEqual(dec.branches.map(b => b.label), ['Yes', 'No']);
  assert.deepEqual(dec.branches[0].nodes.map(x => [x.title, x.ownerRole]), [['Approve', 'Finance Director']]);
  assert.deepEqual(dec.branches[1].nodes, [], 'no invented step on the No path');
  assert.equal(dec.branches[1].goto, n[5].id, 'otherwise skip to step 5 -> goto');
  assert.ok(dec.branches[0].nodes[0].newData.some(x => x.name === 'Amount'), 'the amount the decision reads is information');
  /* "Wait for the weekly payment run" -> a wait node */
  assert.deepEqual([n[5].type, n[5].title, n[5].wait], ['wait', 'Wait for the weekly payment run', 'the weekly payment run']);
  /* role text kept as written; information nouns */
  assert.deepEqual([n[6].title, n[6].ownerRole], ['Check the cost centre and budget code', 'Compliance analyst']);
  assert.ok(['Cost centre', 'Budget code'].every(x => n[6].newData.some(y => y.name === x)));
  /* a full person name links that person */
  assert.deepEqual([n[7].title, n[7].owner, n[7].ownerRole], ['Release the payment', 'lp', undefined]);
  /* nothing invented: every proposed name appears in the SOP text */
  const text = 'purchase request quotes po purchase order amount cost centre budget code'.toLowerCase();
  for (const p of r.newData) assert.ok(p.name === 'Purchase order' ? true : text.includes(p.name.toLowerCase()), p.name);
  /* never the current user: no step is assigned to anyone not named */
  const owners = [];
  const walk = ns => ns.forEach(x => { if (x.owner) owners.push(x.owner); (x.branches || []).forEach(b => walk(b.nodes)); });
  walk(n);
  assert.deepEqual(owners, ['lp']);
  /* an inline "Owner:" and a long sentence */
  const r2 = ai.sopRules('1. Accounts Payable files the receipt within one business day. Owner: Ana Ruiz\n' +
    '2. Treasury reconciles the bank statement against the payment file, including every reversal, so that the month can close on time', docs);
  assert.deepEqual([r2.nodes[1].title, r2.nodes[1].owner, r2.nodes[1].ownerRole, r2.nodes[1].sla], ['File the receipt', 'ar', undefined, '1 business day']);
  assert.ok(r2.nodes[2].title.length <= 70 && /^Reconcile the bank statement/.test(r2.nodes[2].title), r2.nodes[2].title);
  assert.match(r2.nodes[2].note, /so that the month can close on time$/, 'the full sentence is kept as the note');
});

test('R8 SOP AI path: actors are stripped from model titles; wait nodes and SLA survive (mocked Azure OpenAI)', async () => {
  const docs = seed('2026-11-04').docs;
  const saved = global.fetch;
  Object.assign(process.env, { AZURE_OPENAI_ENDPOINT: 'https://example.invalid', AZURE_OPENAI_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'd' });
  let prompt = '';
  try {
    global.fetch = async (u, o) => { prompt = JSON.parse(o.body).messages[0].content; return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      nodes: [{ type: 'trigger', title: 'Request raised' }, { id: 'a', type: 'step', title: 'Procurement creates a PO', sla: '2 business days', system: 'ERP' },
        { id: 'b', type: 'wait', title: 'Wait for the weekly payment run', wait: 'the weekly payment run' },
        { id: 'c', type: 'step', title: 'Leo Park releases the payment', owner: 'ar' }],
      newData: [{ name: 'Quotes', reason: 'Mentioned' }] }) } }] }) }; };
    const r = await ai.run('sop-import', { text: '1. Procurement creates a PO\n2. Wait for the weekly payment run\n3. Leo Park releases the payment' }, docs, '2026-11-04');
    assert.equal(r.body.source, 'ai');
    const n = r.body.nodes;
    assert.deepEqual([n[1].title, n[1].ownerRole, n[1].sla, n[1].system], ['Create a PO', 'Procurement', '2 business days', 'ERP']);
    assert.deepEqual([n[2].type, n[2].wait], ['wait', 'the weekly payment run']);
    assert.deepEqual([n[3].title, n[3].owner], ['Release the payment', 'lp'], 'the named person wins over a wrong model owner');
    assert.deepEqual(r.body.newData.map(x => x.name), ['Quotes']);
    assert.match(prompt, /title is the action only/);
    assert.match(prompt, /never use the current user/);
  } finally {
    global.fetch = saved;
    ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_DEPLOYMENT'].forEach(k => delete process.env[k]);
  }
});

test('R8 dates: the client today dates the sandbox, state, releases, approvals and reports (within 2 days of the server)', { skip: !engine && 'no engine' }, async () => {
  const server = new Date().toISOString().slice(0, 10);
  const yday = shiftDay(server, -1);
  /* a new sandbox is seeded from the visitor's own today */
  const ip = testIp();
  let r = await call('POST', 'workspaces', { today: yday }, {}, ip);
  assert.equal(r.status, 201);
  created.push([r.body.id, fn._internal.clientIpHash({ headers: { 'x-forwarded-for': ip } })]);
  const ws = r.body.id;
  assert.equal((await store.getWorkspace(ws)).seedDate, yday);
  let st = (await call('GET', `ws/${ws}/state`, null, { today: yday })).body;
  assert.equal(st.today, yday);
  /* R10 §8: the expectation uses the seed's own business-day normaliser (a weekend or holiday rolls to the next business day) */
  assert.equal(find(st, 'project', 'vendor-modernization').data.target, bizDay(yday, 41), 'seed offsets run from the client today');
  /* R10: +41 calendar days = 29 business days, Thanksgiving and Christmas skipped, so the gap never depends on the day */
  assert.equal(bizDay('2026-11-17', 41), '2026-12-30');
  assert.equal(engine.businessDaysBetween('2026-11-17', bizDay('2026-11-17', 41)), 29);
  assert.equal(engine.businessDaysBetween('2027-03-10', bizDay('2027-03-10', 41)), 29);
  assert.equal((await call('GET', `ws/${ws}/state`, null, { today: shiftDay(server, -9) })).body.today, server, 'a far-off date is ignored');
  /* approvals carry the approver's date; the ISO timestamp is untouched */
  const at = new Date().toISOString();
  /* R13 #3: a part is approved only when it is ready (Compliance still has an open task here; IT is ready) */
  r = await call('PUT', `ws/${ws}/doc/approval/AP7`, { actor: 'sk', today: yday, data: { projectId: 'access-review-automation', bu: 'IT', approver: 'sk', decision: 'approved', at, snapshotAt: at, stepUp: true, note: 'ok' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.doc.data.date, yday);
  assert.equal(r.body.doc.data.at, at);
  /* the status report and the go-live release use the client date */
  r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'access-review-automation', today: yday });
  assert.equal(r.body.date, yday);
  await readyAccessReview(ws);
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta', today: yday });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.release.date, yday);
  assert.equal(r.body.project.liveDate, yday);
  assert.ok(isFinite(Date.parse(r.body.release.at)) && /T.*Z$/.test(r.body.release.at), 'timestamps stay ISO');
  /* dayInput: body first, then the query string */
  assert.deepEqual(fn._internal.dayInput({ query: { today: '2026-11-03' } }, {}), { today: '2026-11-03' });
  assert.deepEqual(fn._internal.dayInput({ query: { today: '2026-11-03' } }, { today: '2026-11-04' }), { today: '2026-11-04' });
});

test('R8 status report: one truth with the engine (sentence, label, numbers, blockers); never "All work is done" with blockers', { skip: !(engine && engine.projectTruth) && 'engine without projectTruth' }, async () => {
  const ws = await newWs();
  let st = await state(ws);
  for (const prj of ['vendor-modernization', 'access-review-automation', 'erp-upgrade-readiness']) {
    const t = engine.projectTruth(st.docs, prj, st.today);
    const r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: prj, today: st.today });
    assert.equal(r.status, 200);
    const b = r.body;
    assert.equal(b.label, t.label);
    assert.equal(b.rag, t.rag);
    assert.equal(b.sentence, t.sentence);
    assert.ok(b.summary.startsWith(t.sentence));
    assert.ok(b.headline.startsWith(t.label + ': '));
    const f = b.facts;
    assert.deepEqual([f.stats.total, f.stats.done, f.stats.late, f.stats.runningLate, f.stats.finish, f.stats.target],
      [t.tasks.total, t.tasks.done, t.lateCount, t.runningLateCount, t.forecastFinish, t.target]);
    assert.deepEqual(f.blockers.map(x => x.name), t.blockers.map(x => x.name), 'the same blockers list');
    assert.deepEqual(f.truth.blockers, t.blockers.map(x => x.name));
    assert.equal(f.truth.bufferDays, t.bufferDays);
    assert.equal(f.truth.bufferUnit, 'business days');
    assert.deepEqual(f.truth.cost, t.cost);
    assert.equal(f.earnedValue.eac, Math.round(t.cost.forecast), 'EAC is the one cost forecast');
    /* R9 §1: one late list (past due, or will finish after its due date) */
    assert.equal(f.atRisk.length, new Set(t.late.concat(t.runningLate || [])).size);
    if (t.pastDueCount != null) assert.equal(f.atRisk.filter(x => x.daysPastDue > 0).length, t.pastDueCount);
    assert.ok(b.highlights.includes(`Testing: ${t.testing.next || t.testing.sentence}`), 'the one testing sentence (R9 §6 testing.next)');
    const left = t.stepsLeft != null ? t.stepsLeft : t.launchSteps.filter(x => !x.done).length;
    assert.ok(b.highlights.includes(left ? `Not ready to launch: ${left} step${left === 1 ? '' : 's'} left` : 'Ready to launch'), 'R9 §1 stepsLeft');
    /* R9 §1: the asks are the ranked who list, in order */
    (t.who || []).slice(0, 8).forEach((w, i) => assert.ok(b.asks[i].startsWith((w.name || '') + ': '), `ask ${i} is who[${i}]: ${b.asks[i]}`));
    assert.ok(b.highlights.some(x => x.startsWith(`${t.tasks.done} of `)));
    if (t.blockers.length) assert.ok(b.summary.includes(`${t.blockers.length} ${t.blockers.length === 1 ? 'piece of information is' : 'pieces of information are'} not available yet`));
    assert.ok(!/connected|sample only|waiting for confirmation/i.test(reportText(b)), 'Simple words only');
  }
  /* finish every vendor-modernization task, but the bank form task no longer gets the Bank remittance details (still Not available yet) */
  for (const w of st.docs.workItem.map(x => x.data).filter(x => x.projectId === 'vendor-modernization' && x.status !== 'done')) {
    const data = Object.assign({}, w, { status: 'done', doneAt: st.today });
    if (w.id === 'W6') delete data.resolves;
    await call('PUT', `ws/${ws}/doc/workItem/${w.id}`, { actor: w.owner, data });
  }
  st = await state(ws);
  const t = engine.projectTruth(st.docs, 'vendor-modernization', st.today);
  assert.equal(t.tasks.open, 0);
  assert.ok(t.blockers.length >= 1, 'a blocker remains');
  const r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: 'vendor-modernization', today: st.today });
  assert.ok(!/all work is done|nothing needs attention/i.test(reportText(r.body)), reportText(r.body));
  assert.deepEqual(r.body.facts.blockers.map(x => x.name), t.blockers.map(x => x.name));
  assert.ok(r.body.asks.some(x => /Bank remittance details/.test(x)), 'the blocker is an ask');
  /* risks whose linked work is all done read "Likely resolved" */
  assert.ok(r.body.risks.some(x => /^Likely resolved: /.test(x) && /close it\?$/.test(x)));
});

test('R8 seed: plain task titles, no "To-be", only missing information is Not available yet, a second project on a vendor step, likely-resolved risks', () => {
  const s = seed('2026-11-04');
  const docs = s.docs;
  const all = JSON.stringify(docs) + JSON.stringify(s.events);
  assert.ok(!/to-be/i.test(docs.process.map(p => p.data.desc).join(' ') + docs.project.map(p => p.data.desc).join(' ')), 'no "To-be" in descriptions');
  assert.ok(!/Stand up structured|Go\/no-go call|Smoke test|\bUAT:|Defect:|integration\b|automation"|EDD/.test(docs.workItem.map(w => w.data.title).join('|') + JSON.stringify(docs.project.map(p => p.data.cutover))), 'plain task titles');
  const W = id => docs.workItem.find(w => w.id === id).data.title;
  assert.equal(W('W6'), 'Set up the bank details form');
  const vt = docs.project.find(p => p.id === 'vendor-modernization').data.cutover.tasks;
  assert.deepEqual(vt.filter(x => x.gonogo).map(x => x.task), ['Final check with Treasury and Compliance', 'Try-out test: set up one test vendor from start to finish']);
  assert.ok(!all.includes('Stand up structured bank capture'), 'old titles gone from comments, notifications and events');
  /* information that exists today is "We have it"; only bank details are Not available yet (R9: Compliance finished the screening result) */
  assert.deepEqual(docs.dataElement.filter(d => d.data.avail !== 'live').map(d => d.id).sort(), ['D2']);
  if (engine && engine.effectiveAvail) assert.deepEqual(docs.dataElement.filter(d => engine.effectiveAvail(docs, d.id) !== 'live').map(d => d.id).sort(), ['D2']);
  for (const d of docs.dataElement.map(x => x.data).filter(x => x.avail === 'live')) assert.ok(d.liveConfirmedBy === d.owner && d.check && d.check.ok, d.name);
  /* a second active project with open work on a Vendor Onboarding step that vendor-modernization is also changing */
  const erp = docs.project.find(p => p.id === 'erp-upgrade-readiness').data;
  assert.equal(erp.status, 'active');
  assert.deepEqual(erp.processes, ['vendor-onboarding']);
  const open = prj => new Set(docs.workItem.map(w => w.data).filter(w => w.projectId === prj && w.status !== 'done' && w.pid === 'vendor-onboarding').map(w => w.step));
  const shared = [...open('erp-upgrade-readiness')].filter(x => open('vendor-modernization').has(x));
  assert.deepEqual(shared, ['s4'], 'both projects change "Create vendor master record"');
  assert.ok(erp.target > '2026-11-04' && ![0, 6].includes(new Date(erp.target + 'T12:00:00Z').getUTCDay()), 'deadline on a business day');
  assert.ok(erp.budget.planned > 0 && erp.program && erp.statuses.length === 4 && erp.releaseManager === 'ta');
  /* risks whose linked work is all done */
  const done = new Set(docs.workItem.map(w => w.data).filter(w => w.status === 'done').map(w => w.id));
  const resolved = docs.risk.map(r => r.data).filter(r => r.status === 'open' && r.workItems.length && r.workItems.every(id => done.has(id)));
  assert.deepEqual(resolved.map(r => r.projectId).sort(), ['access-review-automation', 'vendor-modernization']);
  if (engine && engine.projectTruth) {
    const t = engine.projectTruth(docs, 'erp-upgrade-readiness', '2026-11-04');
    assert.ok(t.forecastFinish <= t.target, 'the new project is not late on day one');
    assert.equal(t.lateCount, 0);
  }
  assert.ok(!all.match(/Witherite|Filevine|Acumatica/i));
});

/* ================================ Round 9: ONE TRUTH, ENFORCED ================================ */
const dow = d => new Date(String(d).slice(0, 10) + 'T12:00:00Z').getUTCDay();

test('R9 §3 seed: no seeded date lands on a Saturday or Sunday, whatever day the sandbox is made', () => {
  for (let i = 0; i < 14; i++) {
    const day = shiftDay('2026-11-01', i);
    const s = seed(day);
    const bad = [];
    const walk = (o, path) => {
      if (typeof o === 'string') { const m = /^(\d{4}-\d{2}-\d{2})(?:$|T|\s)/.exec(o); if (m && [0, 6].includes(dow(m[1]))) bad.push(path + '=' + o); }
      else if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], path + '.' + k);
    };
    walk(s.docs, 'docs'); walk(s.events, 'events');
    assert.deepEqual(bad, [], 'weekend dates in the seed made on ' + day);
    /* the story holds on every day: the bank form is late, future work is ahead of today, done work is done by its due date */
    const w = id => s.docs.workItem.find(x => x.id === id).data;
    assert.ok(w('W6').due < day && w('W6').status === 'idle', 'the bank details form is late on ' + day);
    s.docs.workItem.map(x => x.data).forEach(x => {
      assert.ok(x.start <= x.due, x.id + ' starts by its due date');
      if (x.doneAt) assert.ok(x.doneAt < day && x.doneAt >= x.start, x.id + ' done in the past, after it started');
    });
  }
});

test('R9 §7 seed: Compliance is ready to approve on Vendor Onboarding Modernization; its approver is Dave Ortiz, not the tester', { skip: !(engine && engine.buReady) && 'engine without buReady' }, () => {
  for (const day of ['2026-11-04', '2026-11-07', '2026-11-09']) {
    const docs = seed(day).docs;
    r17ReadyComplianceDocs(docs);   // R17 #4: Compliance's two newly in-scope pieces get their tests (P5: bake into the seed)
    const dave = docs.person.find(p => p.id === 'do');
    assert.deepEqual([dave.data.name, dave.data.role, dave.data.bu], ['Dave Ortiz', 'Head of Compliance', 'Compliance'], 'a selectable department head');
    const vm = docs.project.find(p => p.id === 'vendor-modernization').data;
    assert.equal(vm.approvers.Compliance, 'do');
    const r = engine.buReady(docs, 'vendor-modernization', 'Compliance');
    assert.ok(r.ready, 'Compliance is ready on ' + day + ': ' + r.sentence);
    assert.ok(r.tests.total > 0 && r.tests.passed === r.tests.total, 'its tests exist and passed');
    /* every test of its part was recorded by someone other than its approver */
    const scope = new Set(['TC11', 'TC12', 'TC13', 'uat-vendor-onboarding-s2', 'uat-vendor-onboarding-s2a']);
    const recorders = new Set(docs.testRun.map(x => x.data).filter(x => x.projectId === 'vendor-modernization' && (x.results || []).some(y => scope.has(y.caseId || y.scriptId))).map(x => x.by));
    assert.ok(recorders.size && !recorders.has('do'), 'tests recorded by ' + [...recorders].join(', '));
    /* no open item on its part */
    const open = docs.workItem.map(x => x.data).filter(x => x.projectId === 'vendor-modernization' && x.pid === 'vendor-onboarding' && ['s2', 's2a'].includes(x.step) && x.status !== 'done');
    assert.deepEqual(open, []);
    if (engine.effectiveAvail) assert.equal(engine.effectiveAvail(docs, 'D5'), 'live');
    /* the other parts stay not ready */
    const gate = engine.readiness(docs, 'vendor-modernization', day).checks.find(c => c.id === 'bu-signoff');
    gate.sections.filter(b => b !== 'Compliance').forEach(b => assert.equal(engine.buReady(docs, 'vendor-modernization', b).ready, false, b + ' stays not ready'));
    assert.ok(gate.eligible.Compliance.includes('do'), 'Dave may approve the Compliance part');
    /* the cross-project conflict stays */
    if (engine.stepConflict) assert.ok(engine.stepConflict(docs, 'vendor-modernization', 'vendor-onboarding', 's4').conflict);
    /* projectTruth gives every project a sensible status */
    if (engine.projectTruth) docs.project.forEach(p => {
      const t = engine.projectTruth(docs, p.id, day);
      assert.ok(t && t.label && t.label !== 'Not planned' && t.sentence, p.id + ': ' + (t && t.label));
      if (t.lateCount > 0) assert.ok(!/^On track$/.test(t.label), p.id + ': never "On track" with late tasks');
    });
  }
});

test('R9 §3 (bug B8): a done date is the client\'s today, never the server\'s UTC date', async () => {
  const ws = await newWs();
  let st = await state(ws);
  const yday = shiftDay(st.today, -1);   /* a client still on the previous local day (evening in the Americas) */
  /* R14 PMO-A1: each task is changed by its own owner */
  const put = (id, patch) => call('PUT', `ws/${ws}/doc/workItem/${id}`, { actor: find(st, 'workItem', id).data.owner, today: yday, data: Object.assign({}, find(st, 'workItem', id).data, patch) });
  let r = await put('W7', { status: 'done', doneAt: undefined });
  assert.equal(r.body.doc.data.doneAt, yday, 'missing doneAt -> the client today');
  r = await put('W11', { status: 'done', doneAt: new Date().toISOString() });
  assert.equal(r.body.doc.data.doneAt, yday, 'a UTC timestamp -> the client today');
  r = await put('W3', { status: 'prog', doneAt: undefined });
  r = await put('W8', { status: 'done', doneAt: st.today });
  assert.equal(r.body.doc.data.doneAt, yday, 'a UTC date ahead of the client is clamped to the client today');
  const earlier = shiftDay(yday, -3);
  r = await put('W10', { status: 'done', doneAt: earlier });
  assert.equal(r.body.doc.data.doneAt, earlier, 'a real earlier finish date is kept');
  st = await state(ws);
  r = await call('PUT', `ws/${ws}/doc/workItem/W7`, { actor: 'dk', today: st.today, data: Object.assign({}, find(st, 'workItem', 'W7').data, { doneAt: undefined, note: 'edited' }) });
  assert.equal(r.body.doc.data.doneAt, yday, 're-saving a done task keeps its done date');
  r = await call('PUT', `ws/${ws}/doc/workItem/W7`, { actor: 'dk', today: yday, data: Object.assign({}, find(st, 'workItem', 'W7').data, { status: 'idle' }) });
  assert.equal(r.body.doc.data.status, 'idle');
});

test('R9 §1/§13 report: cost line only with a budget or rates; Simple label; quoted titles in the fallback sentence', async () => {
  const base = seed('2026-11-04').docs;
  const clone = () => JSON.parse(JSON.stringify(base));
  const costy = b => b.highlights.filter(x => /\$|cost|budget/i.test(x));
  let docs = clone();
  let r = await ai.run('status-report', { projectId: 'vendor-modernization' }, docs, '2026-11-04');
  assert.equal(costy(r.body).length, 1, 'budget -> one cost line');
  assert.equal(r.body.sourceLabel, 'Written from the project\'s facts');
  r = await ai.run('status-report', { projectId: 'vendor-modernization', advanced: true }, docs, '2026-11-04');
  assert.equal(r.body.sourceLabel, 'Rules-based', 'Advanced may keep the technical label');
  docs = clone(); docs.project.forEach(p => { delete p.data.budget; });
  r = await ai.run('status-report', { projectId: 'vendor-modernization' }, docs, '2026-11-04');
  assert.deepEqual(costy(r.body).map(x => x.replace(/\$[\d,]+/, '$N')), ['Expected cost $N'], 'rates only -> "Expected cost"');
  docs.person.forEach(p => { delete p.data.dayRate; });
  r = await ai.run('status-report', { projectId: 'vendor-modernization' }, docs, '2026-11-04');
  assert.deepEqual(costy(r.body), [], 'no budget and no rates -> no cost line');
  /* without an engine sentence, the rules sentence names the late count and quotes the first task */
  const facts = { project: { name: 'P', target: '2026-12-15', status: 'active' }, today: '2026-11-04', rag: { status: 'amber' }, stats: { total: 2, done: 0, finish: '2026-11-25' },
    atRisk: [{ title: 'Set up the bank details form', owner: 'Leo Park', due: '2026-11-03', daysPastDue: 1 }] };
  facts.summary = { sentence: 'Expected Nov 25, 2026. 1 task is late; first: “Set up the bank details form” (Leo Park).', label: 'Some tasks late', rag: 'amber', source: 'rules' };
  const out = ai.statusRules(facts);
  assert.ok(out.risks[0].startsWith('“Set up the bank details form” (Leo Park) is 1 business day past due'), out.risks[0]);   /* R16 N1 #10 wording */
  assert.ok(!/Rules-based/.test(JSON.stringify(out)));
});

/* ---------------- R10.1 stream R: the status report with a time window ---------------- */
test('R10.1 status report: {preset} or {from, to}; "Overall" + "This period"; plain empty sections; no invented purpose', async () => {
  const day = '2026-11-17';
  const docs = seed(day).docs;
  let r = await ai.run('status-report', { projectId: 'vendor-modernization', preset: 'this-week' }, docs, day);
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.window.label, 'Week of Mon Nov 16 – Fri Nov 20');
  assert.equal(b.periodHeading, 'This period (Mon Nov 16 – Fri Nov 20, so far)');
  const sec = Object.fromEntries(b.sections.map(s => [s.key, s]));
  assert.deepEqual([sec.completed.items, sec.completed.empty], [[], 'Nothing completed this week']);
  assert.equal(sec.behind.items[0], '5 late (1 past due, 4 will finish after their due date)');
  /* R13 #2: each test's latest result per stage, with the stage's current count (one ledger) */
  // R17 #4: 4 more seeded cases are in scope (26 → 30 business, 8 → 12 Try it out)
  assert.deepEqual(sec.tests.items, ['Business check: 9 tests passed (now 9 of 30 passed). Try it out: 3 passed, 1 failed (now 7 of 12 passed). Latest result of each test, from 2 test runs.']);
  assert.ok(b.sections.every(s => s.items.length || s.empty || ['spend', 'schedule'].includes(s.key)), 'never an empty heading');
  assert.equal(b.overall.needsPurpose, false);
  // R17 (P3 ask): one bottom-up expected-cost method (spent + still to do), so the seed is within its budget
  assert.match(b.overall.budget, /^Within budget: expected cost \$47,019 against the \$48,000 budget$/);
  assert.equal(b.overall.concerns.length, 3);
  assert.equal(b.period.behindAtEnd.length, b.facts.truth.lateCount, 'the period "behind" list equals the late count the screens show');
  // a custom range and last week
  r = await ai.run('status-report', { projectId: 'vendor-modernization', from: '2026-11-09', to: '2026-11-13' }, docs, day);
  assert.deepEqual([r.body.window.preset, r.body.window.from, r.body.window.to], ['custom', '2026-11-09', '2026-11-13']);
  assert.equal(r.body.sections.find(s => s.key === 'completed').items.length, 3);
  // a project with no description or purpose: the report asks for one and never makes one up
  const noDesc = seed(day).docs;
  delete noDesc.project.find(p => p.id === 'erp-upgrade-readiness').data.desc;
  r = await ai.run('status-report', { projectId: 'erp-upgrade-readiness', preset: 'last-week' }, noDesc, day);
  assert.deepEqual([r.body.overall.needsPurpose, r.body.overall.purposeText, r.body.overall.description, r.body.overall.purpose], [true, 'Add a one-line purpose', null, null]);
  // a bad preset is ignored (this week); bad events are dropped
  r = await ai.run('status-report', { projectId: 'vendor-modernization', preset: 'nope', events: [{ at: 5 }, 'x'] }, docs, day);
  assert.equal(r.body.window.preset, 'this-week');
});

test('R10.1 AI path: the model gets only the period and overall facts; the period lists stay the engine\'s (mocked Azure OpenAI)', async () => {
  const day = '2026-11-17';
  const docs = seed(day).docs;
  const saved = global.fetch;
  Object.assign(process.env, { AZURE_OPENAI_ENDPOINT: 'https://example.invalid', AZURE_OPENAI_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'd' });
  let sent = null;
  try {
    global.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      headline: 'Some tasks late: bank details hold things up', summary: 'Work continues.', highlights: [], risks: ['The bank form is late'], asks: [],
      periodSummary: 'A quiet week: one problem was found in testing and the expected finish moved two business days.' }) } }] }) }; };
    const r = await ai.run('status-report', { projectId: 'vendor-modernization', preset: 'this-week' }, docs, day);
    assert.equal(r.body.source, 'ai');
    assert.equal(r.body.sourceLabel, 'Generated by AI');
    assert.match(r.body.periodSummary, /^A quiet week/);
    assert.equal(r.body.sections.find(s => s.key === 'completed').empty, 'Nothing completed this week');
    const user = JSON.parse(sent.messages[1].content);
    assert.ok(user.periodFacts && user.periodFacts.period.window === 'Week of Mon Nov 16 – Fri Nov 20');
    assert.ok(user.periodFacts.overall.concerns.length === 3);
    assert.ok(/periodSummary/.test(sent.messages[0].content));
  } finally {
    global.fetch = saved;
    ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_DEPLOYMENT'].forEach(k => delete process.env[k]);
  }
});

/* ================= R11 (G1) separation of duties, enforced by the API (never only in the page) ================= */
const put = (ws, type, id, actor, data, extra) => call('PUT', `ws/${ws}/doc/${type}/${id}`, Object.assign({ actor, data }, extra || {}));

test('R11 §2 bulk pass: only tests assigned to you or unassigned; never as someone else; never while the problem is open', { skip: !(engine && engine.heldTests) && 'engine without R11' }, async () => {
  const ws = await newWs();
  let st = await state(ws);
  const tc11 = find(st, 'testCase', 'TC11').data, tc12 = find(st, 'testCase', 'TC12').data;
  await put(ws, 'testCase', 'TC11', 'ta', Object.assign({}, tc11, { tester: 'ps' }));     // assigned to Priya
  await put(ws, 'testCase', 'TC12', 'ta', Object.assign({}, tc12, { tester: 'mc' }));     // assigned to Maya (an Admin)
  const run = (id, by, results, actor) => put(ws, 'testRun', id, actor || by, { projectId: 'vendor-modernization', env: 'uat', at: new Date().toISOString(), by, results });
  // Maya is an Admin: no exemption. She can't pass Priya's test, even in a bulk pass with her own
  let r = await run('RX1', 'mc', [{ caseId: 'TC11', outcome: 'pass', evidence: 'bulk' }, { caseId: 'TC12', outcome: 'pass', evidence: 'bulk' }]);
  assert.equal(r.status, 403); assert.match(r.body.error, /only pass tests assigned to you or unassigned ones\. 1 of the 2 selected tests is assigned to Priya Shah\./);
  // her own is fine (R12: an unassigned Compliance test is Compliance's to pass, see the R12 test below)
  r = await run('RX2', 'mc', [{ caseId: 'TC12', outcome: 'pass', evidence: 'ok' }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // a failure on someone else's test can be recorded (anyone may report a problem)
  r = await run('RX3', 'mc', [{ caseId: 'TC11', outcome: 'fail', note: 'Rejected a valid value' }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // nobody records results under another person's name
  r = await run('RX4', 'ps', [{ caseId: 'TC11', outcome: 'pass' }], 'mc');
  assert.equal(r.status, 403); assert.match(r.body.error, /recorded under your own name/);
  // the test held by the open bank-form problem (TC4 ↔ W12, in progress) can't pass, not even unassigned
  r = await run('RX5', 'lp', [{ caseId: 'TC4', outcome: 'pass', evidence: 'looks fine' }]);
  assert.equal(r.status, 403); assert.match(r.body.error, /can't pass while its problem is still open\. Fix “Fix: the bank details form accepts a blank account holder”/);
  // once the problem is marked fixed, the retest passes
  st = await state(ws);
  const w12 = find(st, 'workItem', 'W12').data;
  await put(ws, 'workItem', 'W12', 'lp', Object.assign({}, w12, { defectStatus: 'fixed' }));
  r = await run('RX6', 'lp', [{ caseId: 'TC4', outcome: 'pass', evidence: 'blank holder now rejected' }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('R11 §2 approvals: step owners, test recorders, the PM, other names and no step-up are refused; Admin is no exemption', { skip: !(engine && engine.approvalBar) && 'engine without R11' }, async () => {
  const ws = await newWs();
  await r17ReadyCompliance(ws);   // R17 #4: Compliance's two newly in-scope pieces get their tests
  const at = () => new Date(Date.now() + 1000).toISOString();
  const appr = (id, actor, bu, extra) => put(ws, 'approval', id, actor, Object.assign({ projectId: 'vendor-modernization', bu, approver: actor, decision: 'approved', at: at(), snapshotAt: at(), stepUp: true, note: 'ok' }, extra || {}));
  let r = await appr('Q1', 'ps', 'Compliance');                        // Priya does Compliance steps (and recorded its tests)
  assert.equal(r.status, 403); assert.match(r.body.error, /Priya Shah does steps in Compliance’s part, so someone else must approve it/);
  r = await appr('Q2', 'mc', 'Procurement');                           // Maya: Admin role, does Procurement steps
  assert.equal(r.status, 403); assert.match(r.body.error, /Maya Chen does steps in Procurement’s part/);
  r = await appr('Q3', 'ta', 'Compliance');                            // the project manager
  assert.equal(r.status, 403); assert.match(r.body.error, /project manager/);
  r = await appr('Q4', 'mc', 'Compliance', { approver: 'do' });        // as someone else
  assert.equal(r.status, 403); assert.match(r.body.error, /under your own name/);
  r = await appr('Q5', 'do', 'Compliance', { stepUp: false });         // no step-up
  assert.equal(r.status, 403); assert.match(r.body.error, /step-up/);
  r = await appr('Q6', 'do', 'Compliance');                            // Dave: an Approver who neither does the steps nor recorded tests
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // recording any result for a part's tests bars that person from approving it
  const ws2 = await newWs();
  r = await put(ws2, 'testRun', 'RD', 'ar', { projectId: 'vendor-modernization', env: 'uat', at: new Date().toISOString(), by: 'ar', results: [{ caseId: 'TC14', outcome: 'fail', note: 'R12: Ana may report a problem, but only Compliance passes it' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await put(ws2, 'approval', 'Q7', 'ar', { projectId: 'vendor-modernization', bu: 'Compliance', approver: 'ar', decision: 'approved', at: at(), snapshotAt: at(), stepUp: true, note: 'ok' });
  assert.equal(r.status, 403); assert.match(r.body.error, /Ana Ruiz recorded test results for Compliance’s part/);
});

test('R11 §2/§3 launch overrides need the PM and a sponsor, both with step-up; nobody overrides alone', { skip: !(engine && engine.launchOverrideStatus) && 'engine without R11' }, async () => {
  const ws = await newWs();
  await addRunbook(ws);
  let st = await state(ws);
  const a4 = find(st, 'workItem', 'A4').data;
  await put(ws, 'workItem', 'A4', 'ps', Object.assign({}, a4, { status: 'done', doneAt: st.today, time: [{ by: 'ps', date: st.today, hours: 4 }] /* R15 #8: hours logged, so the Done needs no second person */ }));
  const at = () => new Date(Date.now() + 1000).toISOString();
  let r = await put(ws, 'approval', 'AQ', 'do', { projectId: 'access-review-automation', bu: 'Compliance', approver: 'do', decision: 'approved', at: at(), snapshotAt: at(), stepUp: true, note: 'ok' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // the launch window opens in 3 business days and a launch-day step is still open
  st = await state(ws);
  const pr = find(st, 'project', 'access-review-automation').data;
  const opens = engine.addBusinessDays(st.today, 3);
  r = await put(ws, 'project', 'access-review-automation', 'ta', Object.assign({}, pr, { cutover: Object.assign({}, pr.cutover, { window: opens + ' 08:00–10:00',
    tasks: pr.cutover.tasks.concat([{ id: 'CT2', order: 2, task: 'Brief the service desk', owner: 'dk', planned: '09:00', done: false }]) }) }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // re-take approvals after the launch-day plan edit
  r = await put(ws, 'approval', 'AP8', 'mc', { projectId: 'access-review-automation', bu: 'IT', approver: 'mc', decision: 'approved', at: at(), snapshotAt: at(), stepUp: true, note: 'again' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  st = await state(ws);
  assert.equal(engine.readiness(st.docs, 'access-review-automation', st.today).pass, true);
  const go = () => call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta', localNow: st.today + 'T09:00', stepUp: { at: new Date().toISOString() } });
  r = await go();
  assert.equal(r.status, 409); assert.equal(r.body.error, 'launch locked');
  assert.ok(r.body.reasons.some(x => /^The launch window opens /.test(x)) && r.body.reasons.some(x => /launch-day step is not done yet: “Brief the service desk”/.test(x)), JSON.stringify(r.body));
  const sign = (id, actor, role, extra) => put(ws, 'approval', id, actor, Object.assign({ projectId: 'access-review-automation', kind: 'launch-override', role, approver: actor, decision: 'approved',
    stepUp: true, at: at(), reason: 'Steering group moved the launch up' }, extra || {}));
  // the PM alone (who is also the launch owner) is not enough
  r = await sign('O1', 'ta', 'pm'); assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await go(); assert.equal(r.status, 409); assert.match(r.body.reasons.join(' '), /A sponsor or approver still has to sign/);
  // wrong role, someone who can't sign, and no step-up are refused
  r = await sign('O2', 'do', 'pm'); assert.equal(r.status, 403); assert.match(r.body.error, /only as the sponsor or approver/);
  r = await sign('O3', 'ps', 'sponsor'); assert.equal(r.status, 403); assert.match(r.body.error, /can't sign a launch override/);
  r = await sign('O4', 'do', 'sponsor', { stepUp: false }); assert.equal(r.status, 403);
  // the sponsor's sign-off completes the override
  r = await sign('O5', 'do', 'sponsor'); assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await go();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.release.override.signoffs.map(x => [x.role, x.by]), [['pm', 'ta'], ['sponsor', 'do']]);
  assert.ok(!r.body.release.approvers.includes('ta'), 'override sign-offs are never team approvals');
  /* R13 #11: an override launch is an exception in the launch history */
  assert.ok(r.body.release.exceptions.some(x => /^release:/.test(x.ref) && /two-person override \(Tom Alvarez and Dave Ortiz\)/.test(x.summary)), JSON.stringify(r.body.release.exceptions));
});

/* ================= R12 (H1) ================= */
test('R12 #4 who can pass a business check: the assignee or the owning department; bulk passes need step-up', { skip: !(engine && engine.canPassTest) && 'engine without R12' }, async () => {
  const ws = await newWs();
  const run = (id, by, results, extra) => put(ws, 'testRun', id, by, Object.assign({ projectId: 'vendor-modernization', env: 'uat', at: new Date().toISOString(), by, results }, extra || {}));
  // Jordan's repro: Ana (Accounts Payable) bulk-passes Compliance's unassigned sanctions tests
  let r = await run('RY1', 'ar', [{ caseId: 'TC11', outcome: 'pass', evidence: 'bulk' }, { caseId: 'TC12', outcome: 'pass', evidence: 'bulk' }], { stepUp: true });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /^Only someone in Compliance \(or the person it is assigned to\) can pass the test “Sanctions screening result: Match status”\. \(2 of the 2 selected tests can't be passed by Ana Ruiz\.\)$/);
  // Ana may still record a failure on them (anyone may report a problem)
  r = await run('RY2', 'ar', [{ caseId: 'TC11', outcome: 'fail', note: 'Rejected a valid value' }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Priya (Compliance) passing two at once needs step-up; with it, it is accepted
  r = await run('RY3', 'ps', [{ caseId: 'TC11', outcome: 'pass', evidence: 'ok' }, { caseId: 'TC12', outcome: 'pass', evidence: 'ok' }]);
  assert.equal(r.status, 403); assert.match(r.body.error, /^Passing 2 tests at once needs the extra sign-in check \(step-up\)\.$/);
  r = await run('RY4', 'ps', [{ caseId: 'TC11', outcome: 'pass', evidence: 'ok' }, { caseId: 'TC12', outcome: 'pass', evidence: 'ok' }], { stepUp: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // one pass needs no step-up
  r = await run('RY5', 'ps', [{ caseId: 'TC13', outcome: 'pass', evidence: 'ok' }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

/* ================================ R13 (K1) ================================ */
/* R14 (with L4, Jordan A): department changes. First approvers of a department with none: one Admin, at once, dated.
   With two or more Admins, a move is proposed, and a second Admin (not the proposer, not the person moved) confirms it
   with the extra sign-in check. A one-Admin workspace applies at once. Every grant is dated (approverSince/buSince). */
test('R14 departments: first approvers at once; moves need a second Admin with step-up; one-Admin workspaces apply at once', async () => {
  const ws = await newWs();
  const dep = (actor, op) => call('POST', `ws/${ws}/departments`, { actor, op });
  const settings = async () => find(await state(ws), 'workspace', 'settings').data;
  /* PMO has no approvers yet: Tom (an Admin) names one, applied at once and dated */
  let r = await dep('ta', { kind: 'approvers', id: 'dept-pmo', approvers: ['rv'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const pmo = (await settings()).departments.find(d => d.id === 'dept-pmo');
  assert.deepEqual(pmo.approvers, ['rv']);
  assert.ok(pmo.approverSince && pmo.approverSince.rv, JSON.stringify(pmo));
  /* an Editor can't move people */
  r = await dep('ar', { kind: 'assign', personId: 'lp', id: 'dept-compliance' });
  assert.equal(r.status, 403);
  /* two Admins (Tom, Maya): Tom proposes moving Leo; Tom and Leo can't confirm; Maya confirms with step-up */
  r = await dep('ta', { kind: 'assign', personId: 'lp', id: 'dept-compliance' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const pend = (await settings()).pendingDept.find(p => p.status === 'pending' && p.op.personId === 'lp');
  assert.ok(pend, 'the move waits for a second Admin');
  assert.equal(find(await state(ws), 'person', 'lp').data.bu, 'Treasury', 'nothing moves before the confirmation');
  const confirm = (actor, stepUp) => call('POST', `workspaces/${ws}/admin/departments/pending/${pend.id}/confirm`, Object.assign({ actor }, stepUp ? { stepUp: { method: 'simulated-mfa', at: new Date().toISOString() } } : {}));
  assert.equal((await confirm('ta', true)).status, 403, 'the proposer never confirms');
  assert.equal((await confirm('mc', false)).status, 403, 'step-up is needed');
  r = await confirm('mc', true);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const lp = find(await state(ws), 'person', 'lp').data;
  assert.equal(lp.bu, 'Compliance');
  assert.ok(lp.buSince, 'the move is dated');
  /* the engine rule: Leo joined Compliance after this project's testing started, so he can't pass its Compliance tests */
  const st = await state(ws);
  const t = engine.projectTruth(st.docs, 'vendor-modernization', st.today).testing.perBU.Compliance.tests[0];
  const bar = engine.canPassTest(st.docs, 'vendor-modernization', t.id, 'lp');
  assert.ok(bar && bar.rule === 'recent-move', JSON.stringify(bar));
  /* a one-Admin workspace: Maya made an Editor, so Tom's move applies at once */
  const sd = await settings();
  await store.putDoc(ws, 'workspace', 'settings', Object.assign({}, sd, { roles: Object.assign({}, sd.roles, { mc: 'editor' }) }));
  r = await dep('ta', { kind: 'assign', personId: 'ar', id: 'dept-compliance' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(find(await state(ws), 'person', 'ar').data.bu, 'Compliance');
});
test('R13 #3 server: test assignment across departments is refused; the assigner can\'t pass; approval needs a ready part in every view', async () => {
  const ws = await newWs();
  const st0 = await state(ws);
  const truth = engine.projectTruth(st0.docs, 'vendor-modernization', st0.today);
  const tid = truth.testing.perBU.Compliance.tests.map(x => x.id).find(id => find(st0, 'testCase', id));
  const tc = find(st0, 'testCase', tid).data;
  let r = await call('PUT', `ws/${ws}/doc/testCase/${tid}`, { actor: 'ar', data: Object.assign({}, tc, { tester: 'ar' }) });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.match(r.body.error, /Only someone in Compliance or the project manager can assign/);
  r = await call('PUT', `ws/${ws}/doc/testCase/${tid}`, { actor: 'ps', data: Object.assign({}, tc, { tester: 'ps' }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.doc.data.assignedBy, 'ps');
  r = await call('PUT', `ws/${ws}/doc/testRun/tr-self-${rnd()}`, { actor: 'ps', data: { projectId: 'vendor-modernization', env: 'uat', by: 'ps', at: new Date().toISOString(), results: [{ caseId: tid, outcome: 'pass' }] } });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.match(r.body.error, /assigned the test .*so someone else must pass it/);
  /* one approval-readiness rule: Nina can't approve Accounts Payable's part while its tests are not passed (Advanced allowed it) */
  const ap = engine.buReady(st0.docs, 'vendor-modernization', 'Accounts Payable');
  assert.equal(ap.ready, false);
  r = await call('PUT', `ws/${ws}/doc/approval/apr-early-${rnd()}`, { actor: 'nb', data: { projectId: 'vendor-modernization', bu: 'Accounts Payable', approver: 'nb', decision: 'approved', stepUp: true, at: new Date().toISOString(), attestation: 'Looked at it' } });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.match(r.body.error, /^Not ready for your approval yet: waiting on/);
});

test('R13 #7 profile: shared bank accounts and near-duplicate names reach the stored profile and the generator (no values)', async () => {
  const ws = await newWs();
  const csv = ['legal_name,tax_id,account_number', 'Acme Supply Inc,12-3456789,000123456789', 'ACME Supply Inc.,12-3456789,000123456789', 'Fabrikam Metals,45-1112223,000987654321', 'Fabrikam Metal Works,45-1112224,000555666777'].join('\n');
  const r = await call('POST', `ws/${ws}/profile/D2`, { actor: 'lp', csv });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const col = n => r.body.columns.find(c => c.name === n);
  assert.deepEqual([col('account_number').sharedAccount.accounts, col('account_number').sharedAccount.records], [1, 2]);
  /* R14 (BPM-2): legal name and tax id belong to "Vendor legal name & Tax ID", so they are profiled there */
  assert.deepEqual(r.body.split.map(x => x.dataId), ['D1']);
  const d1 = find(await state(ws), 'profile', 'profile-D1').data;
  const ln = d1.columns.find(c => c.name === 'legal_name');
  assert.ok(ln.nearDuplicates && ln.nearDuplicates.groups >= 1, JSON.stringify(ln));
  assert.ok(!/Acme|Fabrikam/.test(JSON.stringify(d1)));
  assert.ok(!JSON.stringify(r.body).includes('000123456789') && !/Acme|Fabrikam/.test(JSON.stringify(r.body)), 'no values stored');
  const de = { id: 'DV', name: 'Vendors', fields: [{ name: 'Account number', type: 'digits', minLen: 4, maxLen: 17 }] };
  const tests = engine.generateTests(de, r.body.columns.map(c => Object.assign({}, c, { name: c.name === 'account_number' ? 'Account number' : c.name })), { all: true });
  assert.ok(tests.some(t => t.field === 'Account number' && t.expect === 'reject' && /Same bank account number as another vendor/.test(t.note)), 'a uniqueness test from the stored profile');
});

/* R13 (K3 finding): once a project has a plan, Settings may not move the deadline or budget around sponsor approval */
test('R13: deadline/budget on a planned project move only through Change the plan', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const prj = (st.docs.project || []).find(p => (st.docs.workItem || []).some(w => w.data.projectId === p.id));
  assert.ok(prj, 'a seeded project with work');
  const base = prj.data;
  const moved = await call('PUT', `ws/${ws}/doc/project/${prj.id}`, { data: Object.assign({}, base, { target: '2027-06-30' }), actor: base.owner });
  assert.equal(moved.status, 409);
  assert.match(moved.body.error, /Change the plan/);
  const bud = await call('PUT', `ws/${ws}/doc/project/${prj.id}`, { data: Object.assign({}, base, { budget: Object.assign({}, base.budget || {}, { planned: 999999 }) }), actor: base.owner });
  assert.equal(bud.status, 409);
  const renamed = await call('PUT', `ws/${ws}/doc/project/${prj.id}`, { data: Object.assign({}, base, { desc: (base.desc || '') + ' (edited)' }), actor: base.owner });
  assert.equal(renamed.status, 200, 'other settings still save');
  /* a project with no work yet: first-time setup may set the deadline */
  const fresh = { id: 'PNEW' + rnd(), name: 'Fresh project ' + rnd(), owner: base.owner, target: '2027-03-01', processIds: [] };
  assert.equal((await call('PUT', `ws/${ws}/doc/project/${fresh.id}`, { data: fresh, actor: base.owner })).status, 200);
  assert.equal((await call('PUT', `ws/${ws}/doc/project/${fresh.id}`, { data: Object.assign({}, fresh, { target: '2027-04-01' }), actor: base.owner })).status, 200);
});


/* R13 (PMO expert r13, audit forgery): a client cannot make the history say something other than what changed */
test('R13: the history sentence is server-written; a forged client summary is only a quoted note', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const wd = st.docs.workItem.find(d => d.data.status !== 'done' && d.data.owner); const w = wd.data;
  const put = await call('PUT', `ws/${ws}/doc/workItem/${wd.id}`, { actor: w.owner, summary: 'Comment added', data: Object.assign({}, w, { status: 'done' }) });
  assert.equal(put.status, 200);
  const ev = (await call('GET', `ws/${ws}/events`, null, { limit: '50' })).body.events.find(e => e.ref === 'workItem:' + wd.id);
  assert.match(ev.summary, /status .* → Done/);
  assert.match(ev.summary, /\(note: “Comment added”\)$/);
  assert.ok(!/^Comment added/.test(ev.summary));
});

/* ================================ R14 (L1): audit integrity and the deadline guard ================================ */
const R14put = (ws, type, id, data, actor, extra) => call('PUT', `ws/${ws}/doc/${type}/${id}`, Object.assign({ data, actor }, extra || {}));
const R14events = async (ws, ref) => (await call('GET', `ws/${ws}/events`, null, { limit: '200' })).body.events.filter(e => !ref || e.ref === ref);

test('R14 PMO-A1/A3: only the owner, the PM, the launch owner or an Admin change a task; hours carry server time; backdated is labelled', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const w8 = find(st, 'workItem', 'W8').data;   // Dev Kumar's task
  assert.equal(w8.owner, 'dk');
  // the PMO expert's repro: Ana (an Editor, not the owner) adds 40 backdated hours to Dev's task through the API
  const forged = await R14put(ws, 'workItem', 'W8', Object.assign({}, w8, { time: (w8.time || []).concat([{ by: 'ar', date: '2026-10-01', hours: 40, note: 'x' }]) }), 'ar', { summary: 'Viewed' });
  assert.equal(forged.status, 403);
  assert.match(forged.body.error, /Dev Kumar.*task owner|only/i);
  /* R14 (Jordan B): the refusal is in History, server-written, and never as if it happened */
  const ref8 = await R14events(ws, 'workItem:W8');
  assert.equal(ref8.length, 1); assert.equal(ref8[0].action, 'refused'); assert.match(ref8[0].summary, /^Refused: change to work item .* — Only Dev Kumar/);
  assert.ok(!/Viewed/.test(ref8[0].summary), 'the client\'s note is never the History text');
  // the owner logs hours: the server stamps the time; a past date is labelled backdated
  const today = new Date().toISOString().slice(0, 10);
  const own = await R14put(ws, 'workItem', 'W8', Object.assign({}, w8, { time: (w8.time || []).concat([{ by: 'dk', date: '2026-10-01', hours: 3, note: 'late entry', at: '2020-01-01T00:00:00.000Z' }]) }), 'dk');
  assert.equal(own.status, 200);
  const t = own.body.doc.data.time.slice(-1)[0];
  assert.ok(Math.abs(Date.parse(t.at) - Date.now()) < 60000, 'server time, never the client\'s');
  assert.equal(t.backdated, true);
  assert.match((await R14events(ws, 'workItem:W8'))[0].summary, /backdated/);
  // the PM may edit anyone's task; another editor may pick up an unowned task
  assert.equal((await R14put(ws, 'workItem', 'W8', Object.assign({}, own.body.doc.data, { title: w8.title + ' (renamed)' }), 'ta')).status, 200);
  const w11 = find(st, 'workItem', 'W11').data;
  assert.equal((await R14put(ws, 'workItem', 'W11', Object.assign({}, w11, { owner: undefined, ownerRole: 'Integration' }), 'ta')).status, 200);
  const un = Object.assign({}, w11, { ownerRole: 'Integration' }); delete un.owner;
  assert.equal((await R14put(ws, 'workItem', 'W11', Object.assign({}, un, { owner: 'ar' }), 'ar')).status, 200, 'pick up unowned work');
  void today;
});

test('R14 PMO-A2: a refused or empty write never appears in History; a note claiming a change that did not happen is dropped', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const prj = (st.docs.project || []).find(p => p.id === 'vendor-modernization').data;
  // the refused $90,000 budget edit
  const bud = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { budget: { planned: 90000 } }), prj.owner, { summary: 'Project settings: planned budget $48,000 → $90,000' });
  assert.equal(bud.status, 409);
  // the settings dialog keeps the locked budget but its note still claims the edit: no change, nothing logged
  const same = await R14put(ws, 'project', prj.id, Object.assign({}, prj), prj.owner, { summary: 'Project settings: planned budget $48,000 → $90,000' });
  assert.equal(same.status, 200);
  const ev = await R14events(ws, 'project:' + prj.id);
  assert.ok(!ev.some(e => e.action !== 'refused' && /90,?000/.test(e.summary)), JSON.stringify(ev.map(e => e.summary)));
  assert.ok(ev.some(e => e.action === 'refused' && /^Refused: change to project .*Change the plan/.test(e.summary)), 'the refusal itself is recorded');
  // a real change with a false claim in the note: the server sentence stays, the false claim is dropped
  const real = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { desc: 'New words' }), prj.owner, { summary: 'Project settings: planned budget $48,000 → $90,000; description updated' });
  assert.equal(real.status, 200);
  const e2 = (await R14events(ws, 'project:' + prj.id))[0];
  assert.match(e2.summary, /^Updated project .*: desc/);
  /* the person's note is kept, quoted, and can't look like a server change */
  assert.match(e2.summary, /\(note: “Project settings: planned budget \$48,000 to \$90,000; description updated”\)$/, e2.summary);
  assert.ok(!/→ \$?90/.test(e2.summary), e2.summary);
});

test('R14 PMO-S1..S3 / PMO-11: deadline guard on task writes, day-off due dates, the sponsor and rebaselining', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const prj = find(st, 'project', 'vendor-modernization').data;
  const w11 = find(st, 'workItem', 'W11').data;
  // the owner moves his own due date past the deadline: refused, Change the plan
  const late = engine.addBusinessDays(prj.target, 6);
  const r = await R14put(ws, 'workItem', 'W11', Object.assign({}, w11, { due: late }), w11.owner);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Change the plan/);
  assert.ok(r.body.deadline && r.body.deadline.target === prj.target);
  assert.ok((await R14events(ws, 'workItem:W11')).every(e => e.action === 'refused'));
  // a holiday due date is refused, naming the day
  const xmas = await R14put(ws, 'workItem', 'W11', Object.assign({}, w11, { due: '2026-12-25' }), w11.owner);
  assert.equal(xmas.status, 400);
  assert.match(xmas.body.error, /Fri Dec 25 is Christmas Day/);
  // inside the buffer: fine
  const ok = await R14put(ws, 'workItem', 'W11', Object.assign({}, w11, { due: engine.addBusinessDays(w11.due, 1) }), w11.owner);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  // the PM can't make himself sponsor; changing the sponsor needs an Admin or the current sponsor
  const self = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { sponsor: prj.owner }), prj.owner);
  assert.equal(self.status, 403);
  assert.match(self.body.error, /sponsor/);
  // rebaselining: "Save plan" on a project that has a saved plan goes through Change the plan
  assert.ok((prj.baselines || []).length, 'the seed has a saved plan');
  const bl = { id: 'bl-new', label: 'My new plan', at: new Date().toISOString(), items: {} };
  const rb = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { baselines: prj.baselines.concat([bl]) }), prj.owner);
  assert.equal(rb.status, 409);
  assert.match(rb.body.error, /Change the plan/);
});

test('R14 PMO-1 server: Done is stamped with its doer; only someone else confirms it', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const w7 = find(st, 'workItem', 'W7').data;
  const done = await R14put(ws, 'workItem', 'W7', Object.assign({}, w7, { status: 'done', doneBy: 'ta' }), w7.owner);
  assert.equal(done.status, 200);
  assert.equal(done.body.doc.data.doneBy, w7.owner, 'the doer is the actor, never a name the client sends');
  const selfC = await R14put(ws, 'workItem', 'W7', Object.assign({}, done.body.doc.data, { confirmedBy: w7.owner }), w7.owner);
  assert.equal(selfC.status, 403);
  const pmC = await R14put(ws, 'workItem', 'W7', Object.assign({}, done.body.doc.data, { confirmedBy: 'ta' }), 'ta');
  assert.equal(pmC.status, 200);
  assert.ok(pmC.body.doc.data.confirmedAt);
  assert.equal(engine.unconfirmedDone((await state(ws)).docs, 'W7').flag, false);
});

test('R14 PMO-7 server: a Done saved after the last report shows in "since last report" (exact server time, viewer\'s clock)', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const prj = find(st, 'project', 'vendor-modernization').data;
  /* R16 N1 #3: the report is recorded by SENDING it (the server stamps lastReportAt; a client value is ignored) */
  const sent = await R14put(ws, 'project', prj.id, Object.assign({}, prj), prj.owner, { report: { action: 'send', preset: 'this-week' } });
  assert.equal(sent.status, 200);
  const stamp = sent.body.doc.data.lastReportAtTime;
  assert.ok(stamp && Date.now() - Date.parse(stamp) < 60000, 'the server stamps the send time');
  const w11 = find(st, 'workItem', 'W11').data;
  const done = await R14put(ws, 'workItem', 'W11', Object.assign({}, w11, { status: 'done', time: [{ by: 'dk', date: st.today, hours: 6 }] }), 'dk');
  assert.equal(done.status, 200);
  assert.ok(done.body.doc.data.doneTs > stamp);
  const r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: prj.id, preset: 'since-last-report', tzOffsetMinutes: 360 });
  assert.equal(r.status, 200);
  const completed = r.body.sections.find(x => x.key === 'completed');
  assert.ok(completed.items.some(x => x.includes(w11.title)), JSON.stringify(completed));
  assert.ok(!/UTC/.test(r.body.window.note || ''), r.body.window.note);
});

test('R14 PMO-S2 (with L4): a plain project PUT uses the one sponsor rule: the PM never sets the sponsor; an Admin does', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const prj = find(st, 'project', 'vendor-modernization').data;
  const self = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { sponsor: prj.owner }), prj.owner);
  assert.equal(self.status, 403);
  const other = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { sponsor: 'rv' }), prj.owner);
  assert.equal(other.status, 403, 'the PM does not pick the sponsor');
  assert.ok(!(await R14events(ws, 'project:' + prj.id)).some(e => e.action !== 'refused' && /sponsor/.test(e.summary)));
  const byAdmin = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { sponsor: 'rv' }), 'mc');   /* Maya: an Admin, not the PM */
  assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body));
});

test('R14 BPM-2 server: a multi-column sample uploaded on one item is split per information item; counts are records', async () => {
  const ws = await newWs();
  const csv = ['bank_name,vendor_id,account_number', 'First Lakeview Bank,V000123,000123456789', 'First Lakeview Bank,V000124,000123456789', 'Harbor Trust,V000125,000987654321'].join('\n');
  const r = await call('POST', `ws/${ws}/profile/D2`, { actor: 'lp', csv });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!r.body.columns.some(c => c.name === 'vendor_id'), 'the vendor id column went to Vendor master record');
  assert.deepEqual(r.body.split.map(x => x.dataId), ['D4']);
  const st = await state(ws);
  assert.deepEqual(find(st, 'profile', 'profile-D4').data.columns.map(c => c.name), ['vendor_id']);
  assert.equal(r.body.columns.find(c => c.name === 'account_number').sharedAccount.records, 2);
  assert.ok(!JSON.stringify(st.docs.profile).includes('000123456789'), 'no values kept');
});

/* R14 lead (Jordan r14 #2): a write a route module refuses is recorded in History as "Refused: …" (server-written) */
test('R14: route-module refusals (403/409) are logged as refused events', async () => {
  const ws = await newWs();
  const r = await call('PUT', `workspaces/${ws}/admin/sponsor/vendor-modernization`, { sponsor: 'ta', actor: 'ta' });
  assert.equal(r.status, 403);
  const ev = (await call('GET', `ws/${ws}/events`, null, { limit: '20' })).body.events;
  const ref = ev.find(e => e.action === 'refused');
  assert.ok(ref && /^Refused: /.test(ref.summary) && ref.actor === 'ta', JSON.stringify(ev.slice(0, 3)));
});

/* ================================ R15 (M1) ================================ */
test('R15 #3/#4/#5/#6 server: the PM changes hands through Change the plan; start dates; self-assigned tests; first Done kept; forecast log is the server\'s', async () => {
  const ws = await newWs();
  let st = await state(ws);
  const prj = find(st, 'project', 'vendor-modernization').data;
  // #3 a plain edit of the PM is refused and logged as refused
  let r = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { owner: 'mc' }), 'ta');
  assert.equal(r.status, 409); assert.match(r.body.error, /Change the plan.*project manager role to Maya Chen/);
  // #4 a start after the due date, and a start on a day off, are refused
  const w = (st.docs.workItem || []).map(d => d.data).find(x => x.projectId === prj.id && x.status === 'idle' && x.owner);
  const addDay = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  r = await R14put(ws, 'workItem', w.id, Object.assign({}, w, { start: addDay(w.due, 7) }), w.owner);
  assert.equal(r.status, 400); assert.match(r.body.error, /after the due date/);
  let sat = w.start; while (new Date(sat + 'T12:00:00Z').getUTCDay() !== 6) sat = addDay(sat, -1);
  r = await R14put(ws, 'workItem', w.id, Object.assign({}, w, { start: sat }), w.owner);
  assert.equal(r.status, 400); assert.match(r.body.error, /weekend day/);
  // #5 a test assigned by its own tester can't be passed in Try it out
  const tc = (st.docs.testCase || []).map(d => d.data).find(c => c.dataId);
  r = await R14put(ws, 'testCase', tc.id, Object.assign({}, tc, { tester: 'ta' }), 'ta');
  assert.equal(r.status, 200);
  r = await R14put(ws, 'testRun', 'run-r15-self', { id: 'run-r15-self', projectId: prj.id, env: 'sit', at: new Date().toISOString(), by: 'ta', results: [{ caseId: tc.id, outcome: 'pass' }] }, 'ta');
  assert.equal(r.status, 403); assert.match(r.body.error, /assigned the test .* to themselves, so someone else must pass it, in Try it out too/);
  // #6 Done → reopen → Done keeps the first completion date
  st = await state(ws);
  const w2 = (st.docs.workItem || []).map(d => d.data).find(x => x.projectId === prj.id && x.status === 'prog' && x.owner);
  const today = st.today;
  r = await R14put(ws, 'workItem', w2.id, Object.assign({}, w2, { status: 'done', doneAt: addDay(today, -2) }), w2.owner, { today });
  assert.equal(r.status, 200); const first = r.body.doc.data.doneAt;
  assert.equal(r.body.doc.data.firstDoneAt, first);
  r = await R14put(ws, 'workItem', w2.id, Object.assign({}, r.body.doc.data, { status: 'prog', doneAt: undefined }), w2.owner, { today });
  r = await R14put(ws, 'workItem', w2.id, Object.assign({}, r.body.doc.data, { status: 'done', doneAt: today, firstDoneAt: '2020-01-01' }), w2.owner, { today });
  assert.equal(r.body.doc.data.doneAt, first, 're-Done keeps the first completion date');
  assert.equal(r.body.doc.data.firstDoneAt, first, 'firstDoneAt is the server\'s');
  // #6 the forecast log can't be rewritten by a client; a recorded report appends the server's own forecast
  st = await state(ws);
  const p2 = find(st, 'project', prj.id).data;
  r = await R14put(ws, 'project', prj.id, Object.assign({}, p2, { forecastLog: [{ date: '2026-01-01', finish: '2026-01-02' }] }), 'ta');
  assert.deepEqual((r.body.doc && r.body.doc.data.forecastLog) || p2.forecastLog, p2.forecastLog);
  /* R16 N1 #3: a report is recorded when it is sent (body.report), never from a client reportLog value */
  r = await R14put(ws, 'project', prj.id, Object.assign({}, p2, { reportLog: (p2.reportLog || []).concat([{ date: today, preset: 'this-week' }]), forecastLog: [] }), 'ta', { today });
  assert.deepEqual(r.body.doc ? r.body.doc.data.reportLog || [] : p2.reportLog || [], p2.reportLog || [], 'a client reportLog value records nothing');
  r = await R14put(ws, 'project', prj.id, Object.assign({}, p2, { forecastLog: [] }), 'ta', { today, report: { action: 'send', preset: 'this-week' } });
  assert.equal(r.status, 200);
  const fl = r.body.doc.data.forecastLog;
  assert.ok(fl.length === (p2.forecastLog || []).filter(x => x.date !== today).length + 1 && fl[fl.length - 1].date === today && fl[fl.length - 1].at, JSON.stringify(fl));
  // #6 a future-dated entry is flagged
  st = await state(ws);
  const w3 = find(st, 'workItem', w2.id).data;
  r = await R14put(ws, 'workItem', w2.id, Object.assign({}, w3, { time: (w3.time || []).concat([{ by: w3.owner, date: addDay(today, 5), hours: 3 }]) }), w3.owner, { today });
  assert.equal(r.status, 200); assert.equal(r.body.doc.data.time.slice(-1)[0].future, true);
});

test('R15 #1 server: a new task made from a role step is the role\'s, never the process owner; a data owner follows its step', async () => {
  const ws = await newWs();
  let st = await state(ws);
  const proc = find(st, 'process', 'vendor-onboarding').data;
  const s3 = proc.tobe.find(n => n.id === 's3');
  const p2 = JSON.parse(JSON.stringify(proc));
  const t3 = p2.tobe.find(n => n.id === 's3'); t3.ownerRole = 'Treasury Analyst'; t3.owner = 'mc';
  let r = await R14put(ws, 'process', proc.id, p2, 'mc');
  assert.equal(r.status, 200);
  // the bank details (owned by Leo, s3's old doer) follow s3 to its new role
  st = await state(ws);
  const d2 = find(st, 'dataElement', 'D2').data;
  assert.equal(d2.ownerRole, 'Treasury Analyst', JSON.stringify(d2)); assert.equal(d2.owner, undefined);
  // the client fills the process owner in from the step: the server keeps it the role's
  r = await R14put(ws, 'workItem', 'W-r15-new', { id: 'W-r15-new', projectId: 'vendor-modernization', pid: 'vendor-onboarding', step: 's3', title: 'New bank form', owner: 'mc', status: 'idle', start: st.today, due: st.today, deps: [] }, 'ta');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.doc.data.owner, r.body.doc.data.ownerRole], [undefined, 'Treasury Analyst']);
  void s3;
});

/* ------------------------------------------------------------------ R16 N1 */
async function callH(method, p, body, headers) {
  const ctx = { res: null, log: Object.assign(() => {}, { error() {}, warn() {}, info() {} }) };
  await fn(ctx, { method, url: '/api/pmoflow/' + p, headers: Object.assign({ 'x-forwarded-for': '127.0.0.1' }, headers || {}), params: { path: p }, query: {}, body });
  return ctx.res;
}
const principalHeader = (email, userId) => ({ 'x-ms-client-principal': Buffer.from(JSON.stringify({ identityProvider: 'aad', userId: userId || 'u-' + email, userDetails: email, userRoles: ['authenticated'] })).toString('base64') });

test('R16 N1 #1 identity binding: a hosted sign-in binds the actor; a step-up older than 10 minutes or in the future is refused and logged', async () => {
  const ws = await newWs();
  await r17ReadyCompliance(ws);   // R17 #4: Compliance's two newly in-scope pieces get their tests
  let st = await state(ws);
  // link Ana to her sign-in (open demo, an Admin edits the person)
  const ana = find(st, 'person', 'ar').data;
  let r = await R14put(ws, 'person', 'ar', Object.assign({}, ana, { email: 'ana.ruiz@northwind.example' }), 'ta');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const H = principalHeader('Ana.Ruiz@northwind.example');
  // forged actor under Ana's sign-in: refused and logged
  const w = (st.docs.workItem || []).map(d => d.data).find(x => x.owner === 'ar' && x.status !== 'done');
  r = await callH('PUT', `ws/${ws}/doc/workItem/${w.id}`, { actor: 'ta', data: Object.assign({}, w, { title: w.title + ' (edited)' }) }, H);
  assert.equal(r.status, 403); assert.match(r.body.error, /signed in as Ana Ruiz, so you can't act as Tom Alvarez/);
  let ev = (await call('GET', `ws/${ws}/events`, null, { limit: '20' })).body.events;
  assert.ok(ev.some(e => e.action === 'refused' && /signed in as Ana Ruiz/.test(e.summary)), 'the forged actor is in History');
  // no actor: the signed-in person is the actor
  r = await callH('PUT', `ws/${ws}/doc/workItem/${w.id}`, { data: Object.assign({}, w, { title: w.title + ' (edited)' }) }, H);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.event.actor, 'ar');
  // a sign-in linked to nobody
  r = await callH('PUT', `ws/${ws}/doc/workItem/${w.id}`, { actor: 'ar', data: w }, principalHeader('stranger@example.com'));
  assert.equal(r.status, 403); assert.match(r.body.error, /isn't linked to anyone in this workspace/);
  // step-ups: 2020 (stale) and tomorrow (future) are refused, in the open demo too; a fresh one is recorded with server time
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta', simulateFailure: true, stepUp: { method: 'simulated-mfa', at: '2020-01-01T00:00:00.000Z' } });
  assert.equal(r.status, 403); assert.match(r.body.error, /more than 10 minutes ago/);
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta', simulateFailure: true, stepUp: { method: 'simulated-mfa', at: new Date(Date.now() + 3600e3).toISOString() } });
  assert.equal(r.status, 403); assert.match(r.body.error, /dated in the future/);
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta', simulateFailure: true, stepUp: { method: 'simulated-mfa', at: new Date(Date.now() - 11 * 60000).toISOString() } });
  assert.equal(r.status, 403);
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta', simulateFailure: true, stepUp: { method: 'simulated-mfa', at: new Date(Date.now() - 9 * 60000).toISOString() } });
  assert.notEqual(r.status, 403, 'a 9-minute-old step-up passes the check (the launch itself may still wait on readiness)');
  assert.ok(!/sign-in check/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  // an approval stamped 2020 is refused; a fresh one records stepUpAt
  const at0 = '2020-01-01T00:00:00.000Z';
  r = await call('PUT', `ws/${ws}/doc/approval/apr-r16-${rnd()}`, { actor: 'do', data: { projectId: 'vendor-modernization', bu: 'Compliance', approver: 'do', decision: 'approved', at: at0, snapshotAt: at0, stepUp: true, note: 'ok' } });
  assert.equal(r.status, 403); assert.match(r.body.error, /extra sign-in check/);
  ev = (await call('GET', `ws/${ws}/events`, null, { limit: '20' })).body.events;
  assert.ok(ev.filter(e => e.action === 'refused' && /extra sign-in check/.test(e.summary)).length >= 3, 'stale step-ups are in History');
  const atNow = new Date().toISOString();
  r = await call('PUT', `ws/${ws}/doc/approval/apr-r16-${rnd()}`, { actor: 'do', data: { projectId: 'vendor-modernization', bu: 'Compliance', approver: 'do', decision: 'approved', at: atNow, snapshotAt: atNow, stepUp: true, note: 'ok' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.doc.data.stepUp === true && Date.now() - Date.parse(r.body.doc.data.stepUpAt) < 60000, 'the server records stepUpAt with its own clock');
  // a role-change confirm with a stale step-up is refused by the same gate (route modules included)
  r = await call('POST', `workspaces/${ws}/admin/roles/pending/none/confirm`, { actor: 'ta', stepUp: { method: 'simulated-mfa', at: at0 } });
  assert.equal(r.status, 403); assert.match(r.body.error, /more than 10 minutes ago/);
  void st;
});

test('R16 N1 #2 hours are append-only: no removal or reduction by a plain save; a reversing entry with a reason; History shows hours and dollars', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const w = (st.docs.workItem || []).map(d => d.data).find(x => x.projectId === 'vendor-modernization' && Array.isArray(x.time) && x.time.length >= 2);
  assert.ok(w, 'a seeded task with hours');
  const total0 = engine.hoursTotals(st.docs, w);
  // removing entries: refused (409) and logged
  let r = await R14put(ws, 'workItem', w.id, Object.assign({}, w, { time: w.time.slice(0, 1) }), w.owner);
  assert.equal(r.status, 409); assert.match(r.body.error, /Use “Correct hours”/);
  // lowering an entry: refused
  r = await R14put(ws, 'workItem', w.id, Object.assign({}, w, { time: [Object.assign({}, w.time[0], { hours: 1 })].concat(w.time.slice(1)) }), w.owner);
  assert.equal(r.status, 409);
  // a negative entry with no reason: refused
  r = await R14put(ws, 'workItem', w.id, Object.assign({}, w, { time: w.time.concat([{ by: w.owner, date: st.today, hours: -2 }]) }), w.owner);
  assert.equal(r.status, 409); assert.match(r.body.error, /needs a reason/);
  // a reversing entry with a reason: accepted, net hours go down, History shows hours and dollars before → after
  const corr = engine.reverseEntry(w.time[0], 2, 'Double-logged', w.owner, st.today);
  r = await R14put(ws, 'workItem', w.id, Object.assign({}, w, { time: w.time.concat([corr]) }), w.owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const total1 = engine.hoursTotals((await state(ws)).docs, r.body.doc.data);
  assert.equal(total1.hours, total0.hours - 2);
  assert.match(r.body.event.summary, /hours corrected: −2 hours on .* \(correction: “Double-logged”\)/);
  assert.match(r.body.event.summary, /total \d+ hours \(\$[\d,]+\) → \d+ hours \(\$[\d,]+\)/);
  // can't go below zero
  r = await R14put(ws, 'workItem', w.id, Object.assign({}, r.body.doc.data, { time: r.body.doc.data.time.concat([engine.reverseEntry(w.time[0], 999, 'oops', w.owner, st.today)]) }), w.owner);
  assert.equal(r.status, 409);
});

test('R16 N1 #3 a report preview never logs; only send or export writes reportLog and forecastLog', async () => {
  const ws = await newWs();
  let st = await state(ws);
  const prj = find(st, 'project', 'vendor-modernization').data;
  // the preview (the status-report route) writes nothing
  let r = await call('POST', `ws/${ws}/ai/status-report`, { projectId: prj.id, preset: 'this-week' });
  assert.equal(r.status, 200);
  st = await state(ws);
  assert.deepEqual(find(st, 'project', prj.id).data.reportLog || [], prj.reportLog || []);
  // a client save that adds a reportLog entry (the old preview path) writes nothing either
  r = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { reportLog: (prj.reportLog || []).concat([{ date: st.today, preset: 'this-week' }]), lastReportAt: st.today }), 'ta');
  st = await state(ws);
  assert.deepEqual(find(st, 'project', prj.id).data.reportLog || [], prj.reportLog || []);
  assert.equal(find(st, 'project', prj.id).data.lastReportAt || null, prj.lastReportAt || null);
  // send: one entry with the server's time and the forecast
  r = await R14put(ws, 'project', prj.id, Object.assign({}, prj), 'ta', { report: { action: 'send', preset: 'this-week' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body.doc.data;
  assert.equal(d.reportLog.slice(-1)[0].action, 'send');
  assert.equal(d.forecastLog.slice(-1)[0].date, st.today);
  assert.equal(d.lastReportAt, st.today);
});

test('R16 N1 #5/#6 the launch owner changes only through Change the plan; a part with nothing to sign can\'t be approved', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const prj = find(st, 'project', 'vendor-modernization').data;
  let r = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { releaseManager: 'mc' }), 'ta');
  assert.equal(r.status, 409); assert.match(r.body.error, /Use “Change the plan” to hand the launch owner role to Maya Chen/);
  const ev = await R14events(ws, 'project:' + prj.id);
  assert.ok(ev.some(e => e.action === 'refused' && /launch owner/.test(e.summary)));
  // a client can't write formerLeads
  r = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { formerLeads: ['ps'], desc: 'x' }), 'ta');
  assert.equal(r.status, 200); assert.equal(r.body.doc.data.formerLeads, undefined);
  // PMO has nothing to sign: an approval of it is refused
  const at = new Date().toISOString();
  r = await call('PUT', `ws/${ws}/doc/approval/apr-pmo-${rnd()}`, { actor: 'ps', data: { projectId: prj.id, bu: 'PMO', approver: 'ps', decision: 'approved', at, snapshotAt: at, stepUp: true, note: 'ok' } });
  assert.equal(r.status, 403); assert.match(r.body.error, /PMO's part did not change/);
});

test('R16 N1 #4 server: someone who moved out of a department can\'t approve its part, and is told why', async () => {
  const ws = await newWs();
  let st = await state(ws);
  // Sam moves to Treasury (one Admin proposes, a second confirms; in a one-Admin case it applies at once)
  let r = await call('POST', `ws/${ws}/departments`, { actor: 'ta', op: { kind: 'assign', personId: 'sk', id: 'dept-treasury' } });
  if (r.body && r.body.pending) r = await call('POST', `workspaces/${ws}/admin/departments/pending/${r.body.pending.id}/confirm`, { actor: 'mc', stepUp: { method: 'simulated-mfa', at: new Date().toISOString() } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  st = await state(ws);
  assert.equal(find(st, 'person', 'sk').data.bu, 'Treasury');
  const it = engine.departments(st.docs).find(d => d.name === 'IT');
  assert.ok(!it.approvers.includes('sk'), 'IT no longer names Sam: ' + JSON.stringify(it));
  const at = new Date().toISOString();
  r = await call('PUT', `ws/${ws}/doc/approval/apr-it-${rnd()}`, { actor: 'sk', data: { projectId: 'access-review-automation', bu: 'IT', approver: 'sk', decision: 'approved', at, snapshotAt: at, stepUp: true, note: 'again' } });
  assert.equal(r.status, 403); assert.match(r.body.error, /^You moved out of IT, so you no longer approve its part/);
  const so = engine.readiness(st.docs, 'access-review-automation', st.today).checks.find(c => c.id === 'bu-signoff');
  assert.ok(so.reopened.some(x => x.bu === 'IT' && x.person === 'sk'), JSON.stringify(so.reopened));
});

test('R16 N1 #7 guards: a launch window on a holiday or past the deadline; cost over budget; an added dependency moves the start', async () => {
  const ws = await newWs();
  const st = await state(ws);
  const prj = find(st, 'project', 'vendor-modernization').data;
  // the launch window
  const xmasYear = prj.target.slice(0, 4);
  let r = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { cutover: Object.assign({}, prj.cutover, { window: xmasYear + '-12-25 07:30–10:00' }) }), 'ta');
  assert.equal(r.status, 400); assert.match(r.body.error, /can’t be on \w{3} Dec 25, (Christmas Day|a weekend)/);   /* the year follows the seed day */
  const late = engine.addBusinessDays(prj.target, 5);
  r = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { cutover: Object.assign({}, prj.cutover, { window: late + ' 07:30–10:00' }) }), 'ta');
  assert.equal(r.status, 409); assert.match(r.body.error, /Use “Change the plan” to move the launch past the .* deadline/);
  const inside = engine.addBusinessDays(prj.target, -2);
  r = await R14put(ws, 'project', prj.id, Object.assign({}, prj, { cutover: Object.assign({}, prj.cutover, { window: inside + ' 07:30–10:00' }) }), 'ta');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // a cost that takes the expected cost over the budget
  const w11 = find(st, 'workItem', 'W11').data;
  r = await R14put(ws, 'workItem', 'W11', Object.assign({}, w11, { cost: 20000 }), 'ta');
  assert.equal(r.status, 409); assert.match(r.body.error, /Use “Change the plan” to change this cost/); assert.match(r.body.error, /over the \$48,000 budget/);
  // an added dependency moves the dependent's start after the work it waits on, keeping its length
  const w8 = find(st, 'workItem', 'W8').data;
  const fc = engine.forecastAll(st.docs, st.today);
  const need = engine.addBusinessDays(fc.W8.forecast || w8.due, 1);
  r = await R14put(ws, 'workItem', 'W11', Object.assign({}, w11, { deps: ['W8'] }), 'ta', { today: st.today });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(need > w11.start, 'the fixture needs a move');
  assert.equal(r.body.doc.data.start, need);
  assert.equal(engine.businessDaysBetween(r.body.doc.data.start, r.body.doc.data.due), engine.businessDaysBetween(w11.start, w11.due));
  assert.match(r.body.event.summary, /start/);
});

/* R16 lead (PMO r16 attack): a delete with no named person is refused and logged */
test('R16: anonymous delete is refused (403) and logged as refused', async () => {
  const ws = await newWs();
  const r = await call('DELETE', `ws/${ws}/doc/risk/R1`, {});
  assert.equal(r.status, 403);
  const ev = (await call('GET', `ws/${ws}/events`, null, { limit: '10' })).body.events;
  assert.ok(ev.some(e => e.action === 'refused' && /delete risk/.test(e.summary)));
});

/* ------------------------------------------------------------------ R17 P1 */
test('R17 #3 server: a threshold change on a process save regenerates the boundary tests, clears their results, reopens and renames the routing task, logs why', async () => {
  const ws = await newWs();
  const tobe = amt => [
    { id: 'k', type: 'trigger', title: 'Credit request received', owner: 'mc', data: [] },
    { id: 'c1', title: 'Review the credit request', owner: 'mc', data: ['r17req'], from: 'x1' },
    { id: 'g1', type: 'decision', from: 'gx', title: 'Requested limit over $' + amt.toLocaleString('en-US') + '?', threshold: { subject: 'Requested limit', op: '>', amount: amt },
      branches: [{ label: 'Yes', nodes: [{ id: 'c2', title: 'Controller approves the limit', owner: 'hp', data: ['r17req'] }] }, { label: 'No', nodes: [] }] },
    { id: 'e', type: 'end', title: 'Limit set' }];
  const proc = { name: 'Credit limit (R17)', owner: 'mc', version: 1, released: [], asis: [
    { id: 'k', type: 'trigger', title: 'Credit request received', owner: 'mc', data: [] },
    { id: 'x1', title: 'Review the credit request', owner: 'mc', data: ['r17req'] },
    { id: 'gx', type: 'decision', title: 'Requested limit over $250,000?', threshold: { subject: 'Requested limit', op: '>', amount: 250000 }, branches: [{ label: 'Yes', nodes: [] }, { label: 'No', nodes: [] }] },
    { id: 'e', type: 'end', title: 'Limit set' }], tobe: tobe(200000) };
  let r = await R14put(ws, 'dataElement', 'r17req', { id: 'r17req', name: 'Credit request (R17)', avail: 'example', fields: [{ name: 'Requested limit', type: 'currency', format: 'currency', rule: 'Required', required: true }] }, 'mc');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await R14put(ws, 'process', 'r17cl', proc, 'mc'); assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await R14put(ws, 'project', 'r17cp', { id: 'r17cp', name: 'Credit limit v2 (R17)', owner: 'ta', processes: ['r17cl'], status: 'active', target: '2026-12-31' }, 'ta'); assert.equal(r.status, 200, JSON.stringify(r.body));
  let st = await state(ws);
  r = await R14put(ws, 'workItem', 'r17w', { id: 'r17w', projectId: 'r17cp', pid: 'r17cl', step: 'g1', title: 'Route requests over $200,000 to the Controller', owner: 'dk', status: 'idle', start: st.today, due: st.today, deps: [] }, 'ta');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const cases = engine.thresholdCases(st.docs, 'r17req').filter(c => c.threshold === 'g1');
  assert.equal(cases.length, 2);
  for (const [i, c] of cases.entries()) { r = await R14put(ws, 'testCase', 'r17tc' + i, Object.assign({ id: 'r17tc' + i }, c), 'ta'); assert.equal(r.status, 200, JSON.stringify(r.body)); }
  r = await R14put(ws, 'testRun', 'r17run', { id: 'r17run', projectId: 'r17cp', env: 'uat', at: new Date(Date.now() - 60000).toISOString(), by: 'mc', results: [{ caseId: 'r17tc0', outcome: 'pass' }, { caseId: 'r17tc1', outcome: 'pass' }] }, 'mc');
  // the change: $200,000 → $150,000
  st = await state(ws);
  r = await R14put(ws, 'process', 'r17cl', Object.assign({}, find(st, 'process', 'r17cl').data, { tobe: tobe(150000) }), 'mc');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  st = await state(ws);
  const now = (st.docs.testCase || []).map(d => d.data).filter(c => c.threshold === 'g1');
  assert.deepEqual(now.map(c => c.input).sort(), ['150000.00', '150000.01']);
  assert.ok(!find(st, 'testCase', 'r17tc0'), 'the $200,000 cases are gone');
  const prj = find(st, 'project', 'r17cp').data;
  assert.equal(prj.evidenceResets.length, 1);
  const w = find(st, 'workItem', 'r17w').data;
  assert.equal(w.title, 'Route requests over $150,000 to the Controller');
  const ev = await R14events(ws, 'project:r17cp');
  assert.ok(ev.some(e => /The choice “Requested limit over \$150,000\?” changed \(over \$200,000 → over \$150,000\)/.test(e.summary)), JSON.stringify(ev.map(e => e.summary)));
  const tp = engine.readiness(st.docs, 'r17cp', st.today).checks.find(c => c.id === 'tests-passed');
  assert.equal(tp.pass, false);
});

test('R17 (P3 asks) server: a new task over the cost tolerance and a dependency that moves waiting tasks both go through Change the plan', async () => {
  const ws = await newWs();
  const st = await state(ws);
  // a new task that adds a lot of work to a project with a saved plan
  let r = await R14put(ws, 'workItem', 'W-r17-big', { id: 'W-r17-big', projectId: 'vendor-modernization', pid: 'vendor-onboarding', step: 's3', title: 'Vendor portal rebuild', owner: 'dk', status: 'idle', start: st.today, due: engine.addBusinessDays(st.today, 9), effortDays: 10, cost: 9000, deps: [] }, 'ta');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /^Use “Change the plan” to add this work, so the sponsor can approve the cost\. This raises the expected cost/);
  // a small new task is still a plain save
  r = await R14put(ws, 'workItem', 'W-r17-small', { id: 'W-r17-small', projectId: 'vendor-modernization', pid: 'vendor-onboarding', step: 's3', title: 'Update the vendor FAQ', owner: 'dk', status: 'idle', start: st.today, due: st.today, effortDays: 0.25, deps: [] }, 'ta');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // W7, W8 and W10 wait on W6 (not started): making W6 wait for W11 moves W6, and them with it, so it is a plan change
  const w6 = find(st, 'workItem', 'W6').data;
  assert.ok(engine.dependencyShift(st.docs, w6, (w6.deps || []).concat(['W11']), st.today).moved, 'the fixture needs a move');
  r = await R14put(ws, 'workItem', 'W6', Object.assign({}, w6, { deps: (w6.deps || []).concat(['W11']) }), 'ta', { today: st.today });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /^Use “Change the plan” to add this dependency: .* It also moves 3 tasks that wait on it\.$/);
  assert.deepEqual(r.body.knockOn.sort(), ['W10', 'W7', 'W8']);
});
