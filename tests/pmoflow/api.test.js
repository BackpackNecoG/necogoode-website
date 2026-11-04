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
  assert.ok(r.body.asks.some(a => a.includes('D2')), 'missing bank data is an ask');

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
});

test('go-live: refused with 409 + reasons when the gate fails; promotes on pass', { skip: !engine && 'pmoflow-engine.js not present' }, async () => {
  const ws = await newWs();
  let r = await call('POST', `ws/${ws}/golive/vendor-modernization`, { actor: 'ta' });
  assert.equal(r.status, 409);
  assert.ok(Array.isArray(r.body.reasons) && r.body.reasons.length >= 3);
  let st = await state(ws);
  assert.equal(find(st, 'project', 'vendor-modernization').data.status, 'active');

  /* access-review: only A4 open; finish it and the gate passes */
  const a4 = find(st, 'workItem', 'A4').data;
  await call('PUT', `ws/${ws}/doc/workItem/A4`, { data: Object.assign({}, a4, { status: 'done' }), actor: 'ps' });
  st = await state(ws);
  assert.equal(engine.readiness(st.docs, 'access-review-automation', st.today).pass, true);
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  st = await state(ws);
  const proc = find(st, 'process', 'access-review').data;
  assert.equal(proc.version, 2);
  assert.equal(proc.released.length, 1);
  assert.equal(proc.asis.find(n => n.id === 'r1').title, 'Pull entitlements automatically');
  assert.ok(Object.values(engine.diffProcess(proc).nodes).every(v => v === 'same'));
  assert.equal(find(st, 'grant', 'G4').data.status, 'expired');
  assert.equal(find(st, 'project', 'access-review-automation').data.status, 'live');
  const rel = st.docs.release[0].data;
  assert.equal(rel.projectId, 'access-review-automation');
  assert.deepEqual(rel.snapshot, { 'access-review': 2 });
  assert.deepEqual(rel.actions.map(a => a.type), ['pipeline', 'sop-publish', 'notify']);
  assert.ok(rel.actions[0].detail.includes('/dispatches'));
  assert.ok(rel.approvers.length >= 2);
  const ev = await call('GET', `ws/${ws}/events`, null, { ref: 'project:access-review-automation' });
  assert.equal(ev.body.events[0].action, 'golive');
  r = await call('POST', `ws/${ws}/golive/access-review-automation`, { actor: 'ta' });
  assert.equal(r.status, 409);
});
