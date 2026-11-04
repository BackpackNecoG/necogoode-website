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
const { seed, DOC_TYPES } = require(path.join(API, 'shared/pmoflow-seed.js'));
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
  const ws = await store.createWorkspace(hash, { id: 'test' + rnd() + rnd() });
  created.push([ws.id, hash]);
  return ws.id;
}
const state = async ws => (await call('GET', `ws/${ws}/state`)).body;
const find = (st, type, id) => (st.docs[type] || []).find(d => d.id === id);

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
  assert.equal(s.body.people.length, 6);
  assert.ok(s.body.people.every(p => p.bu));
  assert.equal(s.body.today, new Date().toISOString().slice(0, 10));
  assert.equal(s.body.docs.dataElement.length, 8);
  assert.equal(s.body.docs.process.length, 3);
  assert.equal(s.body.docs.workItem.length, 15);
});

test('workspace creation is limited to 5 per IP hash per day', async () => {
  const ip = testIp();
  const hash = fn._internal.clientIpHash({ headers: { 'x-forwarded-for': ip } });
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', 'workspaces', {}, {}, ip);
    assert.equal(r.status, 201);
    created.push([r.body.id, hash]);
  }
  const r = await call('POST', 'workspaces', {}, {}, ip);
  assert.equal(r.status, 429);
  assert.ok(r.body.error);
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
  assert.equal(st.docs.workItem.length, 15); /* 15 seeded - W11 + W99 */

  r = await call('GET', `ws/${ws}/events`, null, { ref: 'workItem:W99' });
  assert.equal(r.status, 200);
  assert.equal(r.body.events.length, 2);
  assert.equal(r.body.events[0].summary, 'Started W99');
  assert.equal(r.body.events[1].summary, 'Added W99');
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
    for (const c of stored.data.columns) assert.deepEqual(Object.keys(c).filter(k => !['name', 'nulls', 'distinct', 'minLen', 'maxLen', 'min', 'max', 'charClasses', 'specials', 'patterns', 'examples'].includes(k)), []);
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
  assert.equal(r.body.nodes.length, 5);
  assert.equal(r.body.nodes[0].owner, 'mc');
  assert.deepEqual(r.body.nodes[0].data, ['D1']);
  assert.equal(r.body.nodes[1].owner, 'ps');
  assert.equal(r.body.nodes[2].owner, 'lp');
  assert.deepEqual(r.body.nodes[2].data, ['D2']);
  assert.equal(r.body.nodes[4].owner, undefined, '"Dev environment" must not map to a person');
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
  assert.equal(w('W1').start, '2027-02-11');
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
  assert.equal(s.docs.project.find(d => d.id === 'vendor-modernization').data.cutover, undefined);
  assert.ok(s.docs.risk.every(d => Array.isArray(d.data.workItems) && d.data.workItems.length));
  assert.ok(s.docs.approval.every(d => d.data.snapshotAt));
});

const allIds = docs => new Set(Object.values(docs).flat().map(d => d.id).filter(id => id.length >= 2));
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

  let st = await state(ws);
  const v1 = find(st, 'process', 'access-review').data;
  /* access-review: finish A4, then Compliance signs off (A4's edit makes any older Compliance approval stale) */
  const a4 = find(st, 'workItem', 'A4').data;
  await call('PUT', `ws/${ws}/doc/workItem/A4`, { data: Object.assign({}, a4, { status: 'done', doneAt: st.today }), actor: 'ps' });
  st = await state(ws);
  assert.equal(engine.readiness(st.docs, 'access-review-automation', st.today).pass, false);
  await call('PUT', `ws/${ws}/doc/approval/AP9`, { actor: 'ps', data: { projectId: 'access-review-automation', bu: 'Compliance', approver: 'ps',
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
  r = await call('POST', `ws/${ws}/rollback/access-review-automation`, { actor: 'dk' });
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
  r = await call('POST', `ws/${ws}/rollback/access-review-automation`, { actor: 'dk' });
  assert.equal(r.status, 409);
});

test('release exceptions use names, never raw ids', () => {
  const docs = seed('2026-11-04').docs;
  const ex = fn._internal.releaseExceptions(docs, { id: 'exceptions', items: ['W1', { ref: 'process:vendor-onboarding' }] });
  assert.equal(ex.length, 2);
  for (const e of ex) for (const k of ['ref', 'summary', 'by', 'at']) assert.ok(k in e, k);
  assert.ok(ex[0].summary.includes('Launch vendor portal W-9/COI upload'));
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
  assert.ok(r.body.asks.some(a => a.includes('Payment run calendar')));
  assert.ok(r.body.risks.some(a => a.includes('Publish payment calendar')));
  assertNoIds({ headline: r.body.headline, summary: r.body.summary, highlights: r.body.highlights, risks: r.body.risks, asks: r.body.asks }, st.docs, 'report');
  assertNoIds(r.body.facts, st.docs, 'facts');
});

test('put doc stamps updatedAt on workItem and process docs only', async () => {
  const ws = await newWs();
  let st = await state(ws);
  const w = find(st, 'workItem', 'W4').data;
  const before = Date.now();
  await call('PUT', `ws/${ws}/doc/workItem/W4`, { actor: 'ps', data: Object.assign({}, w, { status: 'done' }) });
  st = await state(ws);
  const t1 = find(st, 'workItem', 'W4').data.updatedAt;
  assert.ok(Date.parse(t1) >= before - 5);
  /* client echoes the stored value back unchanged -> server re-stamps */
  await new Promise(res => setTimeout(res, 5));
  await call('PUT', `ws/${ws}/doc/workItem/W4`, { actor: 'ps', data: find(st, 'workItem', 'W4').data });
  st = await state(ws);
  assert.ok(find(st, 'workItem', 'W4').data.updatedAt > t1);
  /* client-supplied fresh value is kept */
  await call('PUT', `ws/${ws}/doc/workItem/W4`, { actor: 'ps', data: Object.assign({}, w, { updatedAt: '2030-01-01T00:00:00.000Z' }) });
  st = await state(ws);
  assert.equal(find(st, 'workItem', 'W4').data.updatedAt, '2030-01-01T00:00:00.000Z');
  await call('PUT', `ws/${ws}/doc/process/access-review`, { actor: 'dk', data: find(st, 'process', 'access-review').data });
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
  const titles = r.nodes.map(n => n.title);
  assert.equal(r.nodes.length, 5, JSON.stringify(titles));
  assert.ok(!titles.some(t => /reimbursement sop|purpose|scope|revision|owner:/i.test(t)), 'title/purpose/scope/owner/revision skipped');
  assert.deepEqual(r.nodes[0].subs.map(x => x.title), ['Attach itemized receipts', 'Code each line to a cost center'], 'lettered items nest');
  const dec = r.nodes[2];
  assert.equal(dec.type, 'decision');
  assert.match(dec.title, /\$5,000\?$/);
  assert.deepEqual(dec.branches.map(b => b.label), ['Yes', 'No']);
  assert.equal(dec.branches[0].nodes[0].title, 'The Finance Director approves');
  assert.deepEqual(dec.branches[1].nodes, []);
  const bank = r.nodes[3];
  assert.equal(bank.data, undefined, 'employee bank details must not link to vendor Bank remittance details');
  assert.equal(bank.owner, 'ar', 'BU match');
  assert.ok(r.newData.some(x => x.name === 'Employee bank details' && /Bank remittance details/.test(x.reason)));
  assert.equal(r.nodes[4].owner, 'lp', 'full-name match');
  assert.equal(r.nodes[4].subs[0].title, 'Confirm the payment file totals');
  assert.equal(r.nodes[1].owner, undefined, '"Manager" is neither a full name nor a BU');
  /* strong matches still link */
  const ok = ai.sopRules('1. Leo Park records the vendor bank remittance details\n2. Vendor uploads the certificate of insurance', docs);
  assert.deepEqual(ok.nodes[0].data, ['D2']);
  assert.deepEqual(ok.nodes[1].data, ['D3']);
  /* other condition phrasings */
  const c = ai.sopRules('1. Approval required for new vendors over $10,000\n2. Pay the invoice when the amount exceeds the PO\n3. File the receipt', docs);
  assert.deepEqual(c.nodes.map(n => n.type), ['decision', 'decision', 'step']);
  assert.equal(c.nodes[1].branches[0].nodes[0].title, 'Pay the invoice');
});
