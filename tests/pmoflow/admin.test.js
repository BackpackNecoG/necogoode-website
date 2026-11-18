/* PMOFlow R10 stream S5: admin route tests (roles, invites, holidays, hash-chained audit).
   Run: node tests/pmoflow/admin.test.js   (or node --test tests/pmoflow/admin.test.js)
   Uses the store's in-memory backend unless EMCEE_STORAGE_CONNECTION is already set. Workspaces are deleted in after(). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');

const API = path.join(__dirname, '../../api');
const fn = require(path.join(API, 'pmoflow/index.js'));
const store = require(path.join(API, 'shared/pmoflow-store.js'));
const admin = require(path.join(API, 'shared/pmoflow-routes-admin.js'));
const { DOC_TYPES } = require(path.join(API, 'shared/pmoflow-seed.js'));

const created = [];
const rnd = () => Math.random().toString(36).slice(2, 10);
async function call(method, p, body, query) {
  const ctx = { res: null, log: Object.assign(() => {}, { error() {}, warn() {}, info() {} }) };
  await fn(ctx, { method, url: '/api/pmoflow/' + p, headers: { 'x-forwarded-for': '127.0.0.9' }, params: { path: p }, query: query || {}, body });
  return ctx.res;
}
async function newWs() {
  const hash = 'test-s5-' + rnd();
  const ws = await store.createWorkspace(hash, { id: 'tsts5' + rnd() + rnd() });
  created.push([ws.id, hash]);
  return ws.id;
}
test.after(async () => { for (const [id, hash] of created) await store.deleteWorkspace(id, hash).catch(() => {}); });

test('workspace doc type is registered and appears in state', async () => {
  assert.ok(DOC_TYPES.includes('workspace'));
  const ws = await newWs();
  const st = await call('GET', `ws/${ws}/state`);
  assert.equal(st.status, 200);
  assert.ok(Array.isArray(st.body.docs.workspace));
});

test('GET admin: default roles, seats, no settings yet', async () => {
  const ws = await newWs();
  const r = await call('GET', `workspaces/${ws}/admin`);
  assert.equal(r.status, 200);
  const roles = Object.fromEntries(r.body.people.map(p => [p.id, p.role]));
  assert.equal(roles.ta, 'admin');      /* Project Manager */
  assert.equal(roles.mc, 'admin');      /* Process Owner */
  assert.equal(roles.lp, 'editor');
  /* R11 §8 (G1 seed): Dave Ortiz only approves, so he is an Approver on a free seat */
  assert.equal(roles.do, 'approver');
  /* R11 (F1 seed): each team has a department-head Approver on a free seat: do, nb, sk, rv, gw */
  for (const id of ['nb', 'sk', 'rv', 'gw']) assert.equal(roles[id], 'approver', id);
  const free = r.body.people.filter(p => p.role === 'approver' || p.role === 'viewer').length;
  assert.equal(free, 5);
  assert.equal(r.body.seats.free, free);
  assert.equal(r.body.seats.paid, r.body.people.length - free);
  assert.deepEqual(r.body.calendar.holidays || [], []);
});

test('roles: only an Admin changes them; last Admin is protected; event recorded', async () => {
  const ws = await newWs();
  const deny = await call('PUT', `workspaces/${ws}/admin/roles/ps`, { role: 'viewer', actor: 'lp' });
  assert.equal(deny.status, 403);
  assert.match(deny.body.error, /Only an Admin/);
  const ok = await call('PUT', `workspaces/${ws}/admin/roles/ps`, { role: 'approver', actor: 'ta' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.people.find(p => p.id === 'ps').role, 'approver');
  assert.equal(ok.body.seats.free, 6);   /* 5 seeded approvers + Priya */
  const bad = await call('PUT', `workspaces/${ws}/admin/roles/ps`, { role: 'owner', actor: 'ta' });
  assert.equal(bad.status, 400);
  /* demote mc, then the last admin (ta) cannot demote themself */
  assert.equal((await call('PUT', `workspaces/${ws}/admin/roles/mc`, { role: 'editor', actor: 'ta' })).status, 200);
  const last = await call('PUT', `workspaces/${ws}/admin/roles/ta`, { role: 'editor', actor: 'ta' });
  assert.equal(last.status, 409);
  const evs = (await call('GET', `ws/${ws}/events`, null, { ref: 'person:ps' })).body.events;
  assert.ok(evs.some(e => /Priya Shah's role from Editor to Approver/.test(e.summary)));
  /* settings persist into state as docs.workspace */
  const st = (await call('GET', `ws/${ws}/state`)).body;
  assert.equal(st.docs.workspace.find(d => d.id === 'settings').data.roles.ps, 'approver');
});

test('roleError: viewers and approvers are limited; unknown actors untouched', async () => {
  const ws = await newWs();
  await call('PUT', `workspaces/${ws}/admin/roles/lp`, { role: 'viewer', actor: 'ta' });
  await call('PUT', `workspaces/${ws}/admin/roles/ps`, { role: 'approver', actor: 'ta' });
  const docs = (await call('GET', `ws/${ws}/state`)).body.docs;
  assert.match(admin.roleError(docs, 'lp', 'workItem'), /Viewer/);
  assert.equal(admin.roleError(docs, 'lp', 'comment'), null);
  assert.match(admin.roleError(docs, 'ps', 'workItem'), /Approver/);
  assert.equal(admin.roleError(docs, 'ps', 'approval'), null);
  assert.equal(admin.roleError(docs, 'ar', 'workItem'), null);
  assert.equal(admin.roleError(docs, 'anonymous', 'workItem'), null);
  assert.match(admin.roleError(docs, 'ta', 'workspace'), /Admin/);
  assert.match(admin.roleError(docs, 'ar', 'calendar'), /Only an Admin/);
  assert.equal(admin.roleError(docs, 'ta', 'calendar'), null);
});

test('generic doc API cannot write the settings doc', async () => {
  const ws = await newWs();
  const r = await call('PUT', `ws/${ws}/doc/workspace/settings`, { data: { roles: { lp: 'admin' } }, actor: 'lp' });
  assert.equal(r.status, 403);
  const d = await call('DELETE', `ws/${ws}/doc/workspace/settings`, { actor: 'ta' });
  assert.equal(d.status, 403);
});

test('invites: validate, store, count seats, remove', async () => {
  const ws = await newWs();
  assert.equal((await call('POST', `workspaces/${ws}/admin/invites`, { email: 'not-an-email', role: 'editor', actor: 'ta' })).status, 400);
  const a = await call('POST', `workspaces/${ws}/admin/invites`, { email: 'Jordan.Lee@northwind.example', role: 'viewer', actor: 'ta' });
  assert.equal(a.status, 200);
  const inv = a.body.settings.invites[0];
  assert.equal(inv.email, 'jordan.lee@northwind.example');
  assert.equal(a.body.seats.viewer, 1);
  assert.equal((await call('POST', `workspaces/${ws}/admin/invites`, { email: 'jordan.lee@northwind.example', role: 'editor', actor: 'ta' })).status, 409);
  assert.equal((await call('POST', `workspaces/${ws}/admin/invites`, { email: 'x@northwind.example', role: 'editor', actor: 'ar' })).status, 403);
  const d = await call('DELETE', `workspaces/${ws}/admin/invites/${inv.id}`, { actor: 'ta' });
  assert.equal(d.status, 200);
  assert.equal(d.body.settings.invites.length, 0);
});

test('holidays: add/remove custom days and work/restore a federal one, in the calendar doc the engine reads', async () => {
  const ws = await newWs();
  const eng = require(path.join(API, 'shared/pmoflow-engine.js'));
  const calOf = async () => ((await call('GET', `ws/${ws}/state`)).body.docs.calendar.find(d => d.id === 'workspace') || {}).data;
  assert.equal((await call('POST', `workspaces/${ws}/admin/holidays`, { date: '2026-02-30', name: 'Bad', actor: 'ta' })).status, 400);
  assert.equal((await call('POST', `workspaces/${ws}/admin/holidays`, { date: '2026-12-24', name: 'Christmas Eve', actor: 'lp' })).status, 403);
  const a = await call('POST', `workspaces/${ws}/admin/holidays`, { date: '2026-12-24', name: 'Christmas Eve', actor: 'ta' });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.calendar.holidays, [{ date: '2026-12-24', name: 'Christmas Eve' }]);
  assert.equal((await call('POST', `workspaces/${ws}/admin/holidays`, { date: '2026-12-24', actor: 'ta' })).status, 409);
  /* a federal holiday is already a day off */
  const xmas = eng.federalHolidays(2026).find(h => /Christmas/.test(h.name)).date;
  assert.equal((await call('POST', `workspaces/${ws}/admin/holidays`, { date: xmas, actor: 'ta' })).status, 409);
  /* the engine now skips the custom day */
  let docs = (await call('GET', `ws/${ws}/state`)).body.docs;
  assert.equal(eng.isHoliday('2026-12-24', docs), true);
  assert.ok(eng.holidays(docs, { fromYear: 2026, years: 1 }).some(h => h.date === '2026-12-24' && h.source === 'custom'));
  /* work a federal holiday, then restore it */
  const w = await call('DELETE', `workspaces/${ws}/admin/holidays/${xmas}`, { actor: 'ta' });
  assert.equal(w.status, 200);
  assert.ok((await calOf()).holidays.some(h => h.date === xmas && h.off === true));
  docs = (await call('GET', `ws/${ws}/state`)).body.docs;
  assert.equal(eng.isHoliday(xmas, docs), false);
  assert.equal((await call('POST', `workspaces/${ws}/admin/holidays`, { date: xmas, actor: 'ta' })).status, 200);
  assert.ok(!(await calOf()).holidays.some(h => h.date === xmas));
  /* remove the custom day */
  const d = await call('DELETE', `workspaces/${ws}/admin/holidays/2026-12-24`, { actor: 'ta' });
  assert.equal(d.status, 200);
  assert.deepEqual(d.body.calendar.holidays, []);
  assert.equal((await call('DELETE', `workspaces/${ws}/admin/holidays/2026-12-23`, { actor: 'ta' })).status, 404);
  const evs = (await call('GET', `ws/${ws}/events`, null, { ref: 'calendar:workspace' })).body.events;
  assert.ok(evs.some(e => /Christmas Eve/.test(e.summary)));
});

test('audit chain: deterministic, links verify, tampering detected', () => {
  const evs = [
    { at: '2026-01-01T10:00:00.000Z', actor: 'ta', action: 'create', ref: 'project:p1', summary: 'Created project' },
    { at: '2026-01-02T10:00:00.000Z', actor: 'mc', action: 'update', ref: 'process:x', summary: 'Edited step' },
    { at: '2026-01-03T10:00:00.000Z', actor: 'ps', action: 'update', ref: 'approval:a', summary: 'Approved' },
  ];
  const a = admin.chainEvents('wsx', evs), b = admin.chainEvents('wsx', evs);
  assert.deepEqual(a, b);
  assert.equal(a[0].prevHash, admin.genesis('wsx'));
  for (let i = 1; i < a.length; i++) assert.equal(a[i].prevHash, a[i - 1].hash);
  const want1 = crypto.createHash('sha256').update(admin.genesis('wsx') + '\n' + JSON.stringify([1, evs[0].at, 'ta', 'ta', 'create', 'project:p1', 'Created project'])).digest('hex');
  assert.equal(a[0].hash, want1);
  assert.equal(admin.verifyChain('wsx', a).ok, true);
  const edited = a.map(e => Object.assign({}, e)); edited[1].summary = 'Edited step (quietly changed)';
  const v = admin.verifyChain('wsx', edited);
  assert.equal(v.ok, false); assert.equal(v.firstBreak.seq, 2);
  const dropped = [a[0], a[2]];
  assert.equal(admin.verifyChain('wsx', dropped).ok, false);
  assert.equal(admin.verifyChain('other-ws', a).ok, false);
  /* anchors: a recorded head must still match */
  assert.equal(admin.verifyChain('wsx', a, [{ n: 2, hash: a[1].hash, v: 2 }]).ok, true);
  assert.equal(admin.verifyChain('wsx', a, [{ n: 2, hash: 'f'.repeat(64), v: 2 }]).ok, false);
  /* R12: checkpoints recorded before actor names were hashed (no v) are not compared */
  assert.equal(admin.verifyChain('wsx', a, [{ n: 2, hash: 'f'.repeat(64) }]).anchorsChecked, 0);
});

test('audit export over the history store: JSON, CSV, filters, anchor, verify a saved file', async () => {
  const ws = await newWs();
  await call('PUT', `ws/${ws}/doc/risk/rk-s5`, { data: { title: 'Vendor data late', status: 'open' }, actor: 'ta', summary: 'Logged risk' });
  await call('POST', `workspaces/${ws}/admin/holidays`, { date: '2026-12-31', name: 'Year-end shutdown', actor: 'ta' });
  const j = await call('GET', `workspaces/${ws}/admin/audit`, null, { format: 'json' });
  assert.equal(j.status, 200);
  assert.equal(j.body.verify.ok, true);
  assert.equal(j.body.entries.length, j.body.total);
  assert.ok(j.body.total >= 2);
  const last = j.body.entries[j.body.entries.length - 1];
  assert.match(last.summary, /Year-end shutdown/);
  assert.equal(last.actorName, 'Tom Alvarez');
  /* stable: a second export yields the same chain */
  const j2 = await call('GET', `workspaces/${ws}/admin/audit`, null, {});
  assert.equal(j2.body.verify.head, j.body.verify.head);
  /* filters */
  const f = await call('GET', `workspaces/${ws}/admin/audit`, null, { person: 'ta', item: 'risk' });
  assert.ok(f.body.filtered);
  assert.ok(f.body.entries.length >= 1 && f.body.entries.every(e => e.actor === 'ta'));
  /* CSV */
  const c = await call('GET', `workspaces/${ws}/admin/audit`, null, { format: 'csv' });
  assert.equal(c.status, 200);
  assert.match(c.body, /^seq,at,actor,actorName,action,ref,summary,prevHash,hash\r\n/);
  assert.match(c.body, /# Verify: Chain intact/);
  /* anchor then verify still ok */
  const an = await call('POST', `workspaces/${ws}/admin/audit/anchor`, { actor: 'ta' });
  assert.equal(an.status, 200);
  assert.equal(an.body.anchor.hash, j.body.verify.head);
  const j3 = await call('GET', `workspaces/${ws}/admin/audit`, null, {});
  assert.equal(j3.body.verify.ok, true);
  assert.equal(j3.body.verify.anchorsChecked, 1);
  /* verify a saved file (entries + signed head), then a tampered copy */
  assert.equal(j.body.head.count, j.body.total);
  assert.equal(j.body.head.hash, j.body.verify.head);
  assert.match(j.body.head.signature, /^[a-f0-9]{64}$/);
  assert.equal(f.body.head, null, 'a filtered export carries no signed head');
  assert.match(c.body, /\r\n# Signed head,\d+,[a-f0-9]{64},[a-f0-9]{64},(production|development) key\r\n$/);
  const good = await call('POST', `workspaces/${ws}/admin/audit/verify`, { entries: j.body.entries, head: j.body.head });
  assert.equal(good.body.verify.ok, true, good.body.verify.summary);
  assert.equal(good.body.verify.signed, true);
  const bad = j.body.entries.map(e => Object.assign({}, e)); bad[0].actor = 'lp';
  const vb = await call('POST', `workspaces/${ws}/admin/audit/verify`, { entries: bad, head: j.body.head });
  assert.equal(vb.body.verify.ok, false);
  assert.equal(vb.body.verify.firstBreak.seq, 1);
});

/* R11 §1: the three break tests from the PMO expert's review (expert-pmo.md, "The audit chain recomputes") */
test('audit break tests: deleted tail, re-hashed forgery, edited entry, missing head, filtered file', async () => {
  const ws = await newWs();
  for (let i = 0; i < 3; i++) await call('PUT', `ws/${ws}/doc/risk/rk-b${i}`, { data: { title: 'Risk ' + i, status: 'open' }, actor: 'ta', summary: 'Logged risk ' + i });
  const j = (await call('GET', `workspaces/${ws}/admin/audit`, null, {})).body;
  const verify = async (entries, head, extra) => (await call('POST', `workspaces/${ws}/admin/audit/verify`, Object.assign({ entries, head }, extra || {}))).body.verify;
  assert.equal((await verify(j.entries, j.head)).ok, true);
  /* 1. delete the last entry and keep the head: count mismatch */
  const cut = j.entries.slice(0, -1);
  let v = await verify(cut, j.head);
  assert.equal(v.ok, false); assert.match(v.summary, /removed from the end/);
  /* 1b. delete the last entry and edit the head to match: signature fails */
  v = await verify(cut, Object.assign({}, j.head, { count: cut.length, hash: cut[cut.length - 1].hash }));
  assert.equal(v.ok, false); assert.match(v.summary, /signature does not match/);
  /* 2. re-hashed forgery: change an entry, recompute every fingerprint and the head hash (all public), keep the signature */
  const forged = j.entries.map(e => ({ at: e.at, actor: e.actor, action: e.action, ref: e.ref, summary: e.summary }));
  forged[1].summary = 'Nothing to see here';
  const rechained = admin.chainEvents(ws, forged);
  v = await verify(rechained, Object.assign({}, j.head, { hash: rechained[rechained.length - 1].hash }));
  assert.equal(v.ok, false); assert.match(v.summary, /signature does not match/);
  /* 2b. ...and with a signature made with a guessed key */
  const guess = crypto.createHmac('sha256', 'guess').update(`pmoflow-audit-head|v1|${ws}|${rechained.length}|${rechained[rechained.length - 1].hash}`).digest('hex');
  v = await verify(rechained, { count: rechained.length, hash: rechained[rechained.length - 1].hash, signature: guess });
  assert.equal(v.ok, false);
  /* 3. an edited entry */
  const edited = j.entries.map(e => Object.assign({}, e)); edited[2].summary += ' (changed)';
  v = await verify(edited, j.head);
  assert.equal(v.ok, false); assert.equal(v.firstBreak.seq, 3); assert.match(v.summary, /changed after it was recorded/);
  /* no head (an R10-style file) can't be confirmed complete; a filtered file can't be checked */
  v = await verify(j.entries, null);
  assert.equal(v.ok, false); assert.match(v.summary, /no signed head/);
  v = await verify(j.entries, j.head, { filtered: true });
  assert.equal(v.ok, false); assert.match(v.summary, /filtered/);
  /* the head is bound to its workspace: another workspace can't vouch for it */
  const ws2 = await newWs();
  const other = (await call('POST', `workspaces/${ws2}/admin/audit/verify`, { entries: j.entries, head: j.head })).body.verify;
  assert.equal(other.ok, false);
  /* a server checkpoint beyond a saved file's end doesn't fail an older, honest file */
  await call('POST', `workspaces/${ws}/admin/audit/anchor`, { actor: 'ta' });
  await call('PUT', `ws/${ws}/doc/risk/rk-b9`, { data: { title: 'Later', status: 'open' }, actor: 'ta', summary: 'Later risk' });
  await call('POST', `workspaces/${ws}/admin/audit/anchor`, { actor: 'ta' });
  assert.equal((await verify(j.entries, j.head)).ok, true);
  /* the live view: history shorter than a recorded checkpoint is reported as broken */
  const live = (await call('GET', `workspaces/${ws}/admin/audit`, null, {})).body;
  assert.equal(live.verify.ok, true); assert.equal(live.verify.anchorsChecked, 2);
  assert.ok(!JSON.stringify(live).includes(process.env.PMOFLOW_AUDIT_KEY || '\u0000never'), 'the key is never returned');
  const short = admin.verifyChain(ws, live.entries.slice(0, -1), live.anchors, {});
  assert.equal(short.ok, false); assert.match(short.summary, /only \d+ remain/);
});

test('audit key: app setting wins, else derived from the storage connection, never exposed', () => {
  const saved = { k: process.env.PMOFLOW_AUDIT_KEY, c: process.env.EMCEE_STORAGE_CONNECTION };
  try {
    process.env.PMOFLOW_AUDIT_KEY = 'unit-test-audit-key-0123456789';
    assert.equal(admin.auditKeySource(), 'app-setting');
    const a = admin.signHead('wsk', 3, 'a'.repeat(64));
    process.env.PMOFLOW_AUDIT_KEY = 'another-unit-test-key-abcdefghij';
    assert.notEqual(admin.signHead('wsk', 3, 'a'.repeat(64)), a, 'the signature depends on the key');
    delete process.env.PMOFLOW_AUDIT_KEY;
    process.env.EMCEE_STORAGE_CONNECTION = 'AccountName=unit;AccountKey=dW5pdA==';
    assert.equal(admin.auditKeySource(), 'derived');
    const d = admin.signHead('wsk', 3, 'a'.repeat(64));
    assert.equal(admin.signHead('wsk', 3, 'a'.repeat(64)), d, 'stable for the same connection');
    assert.notEqual(admin.signHead('wsk2', 3, 'a'.repeat(64)), d, 'keyed per workspace');
    assert.notEqual(admin.signHead('wsk', 4, 'a'.repeat(64)), d, 'covers the count');
    /* in Azure, no fallback: without the app setting, signing is refused */
    process.env.WEBSITE_SITE_NAME = 'unit-test-site';
    assert.equal(admin.auditKeySource(), 'missing');
    assert.throws(() => admin.signHead('wsk', 3, 'a'.repeat(64)), e => e.status === 503 && !/AccountKey|dW5pdA/.test(e.message));
    process.env.PMOFLOW_AUDIT_KEY = 'unit-test-audit-key-0123456789';
    assert.equal(admin.auditKeySource(), 'app-setting');
    delete process.env.WEBSITE_SITE_NAME;
  } finally {
    delete process.env.WEBSITE_SITE_NAME;
    if (saved.k === undefined) delete process.env.PMOFLOW_AUDIT_KEY; else process.env.PMOFLOW_AUDIT_KEY = saved.k;
    if (saved.c === undefined) delete process.env.EMCEE_STORAGE_CONNECTION; else process.env.EMCEE_STORAGE_CONNECTION = saved.c;
  }
});

/* R11 §2: sandbox limits and the returning-visitor cookie (through the route module, so Set-Cookie is visible) */
async function createVia(ip, cookie, host) {
  let res = null;
  const req = { headers: Object.assign({ 'x-forwarded-for': ip, host: host || 'www.necogoode.com' }, cookie ? { cookie } : {}), query: {} };
  const send = (status, body, headers) => { res = { status, body, headers: headers || {} }; };
  const fail = (status, error) => { res = { status, body: { error } }; };
  const handled = await admin.handle({ method: 'POST', seg: ['workspaces'], body: {}, req, store, send, fail,
    clientIpHash: r => require(path.join(API, 'pmoflow/index.js'))._internal.clientIpHash(r), dayInput: () => ({}), clientToday: (d, t) => t });
  assert.equal(handled, true);
  return res;
}
const hashOf = ip => fn._internal.clientIpHash({ headers: { 'x-forwarded-for': ip } });
const testIp = () => `198.51.100.${200 + Math.floor(Math.random() * 50)}-${rnd()}`;

test('sandbox: new visitor gets a 30-day HttpOnly SameSite=Lax cookie; a returning visitor keeps their sandbox', async () => {
  const ip = testIp();
  const r = await createVia(ip);
  assert.equal(r.status, 201);
  created.push([r.body.id, hashOf(ip)]);
  const ck = r.headers['Set-Cookie'];
  assert.match(ck, new RegExp(`^pmoflow_ws=${r.body.id}; `));
  for (const part of ['Max-Age=2592000', 'Path=/api/pmoflow', 'HttpOnly', 'SameSite=Lax', 'Secure']) assert.ok(ck.includes(part), part);
  /* returning with the cookie: same sandbox, not counted, cookie never outlives the sandbox */
  const back = await createVia(ip, `other=1; pmoflow_ws=${r.body.id}`);
  assert.equal(back.status, 200);
  assert.deepEqual(back.body, { id: r.body.id, returning: true });
  const age = Number(/Max-Age=(\d+)/.exec(back.headers['Set-Cookie'])[1]);
  assert.ok(age <= 2592000 && age > 2592000 - 120);
  /* a cookie for an unknown or malformed sandbox starts a new one */
  const fresh = await createVia(ip, 'pmoflow_ws=zzzzzzzzzzzzzzzzzzzz');
  assert.equal(fresh.status, 201); assert.notEqual(fresh.body.id, r.body.id);
  created.push([fresh.body.id, hashOf(ip)]);
  const junk = await createVia(ip, 'pmoflow_ws=../../x');
  assert.equal(junk.status, 201);
  created.push([junk.body.id, hashOf(ip)]);
  /* local plain-http dev server: no Secure flag, so the cookie works on http://localhost */
  const local = await createVia(ip, null, 'localhost:8904');
  assert.ok(!/Secure/.test(local.headers['Set-Cookie']));
  created.push([local.body.id, hashOf(ip)]);
  /* GET is not allowed */
  let res = null;
  await admin.handle({ method: 'GET', seg: ['workspaces'], body: {}, req: { headers: {} }, store, send: () => {}, fail: (s) => { res = s; } });
  assert.equal(res, 405);
});

test('sandbox: burst limit of 10 per network in 10 minutes, with one plain message', async () => {
  const ip = testIp();
  for (let i = 0; i < store.BURST_MAX; i++) {
    const r = await createVia(ip);
    assert.equal(r.status, 201, 'create ' + (i + 1));
    created.push([r.body.id, hashOf(ip)]);
  }
  const r = await createVia(ip);
  assert.equal(r.status, 429);
  /* R12 #12: one message, one true time (the burst just happened, so the wait is the full 10 minutes) */
  assert.deepEqual(r.body, { error: 'This network has started a lot of demos recently. You can start another in 10 minutes, or book a guided demo.' });
  assert.equal((r.body.error.match(/\d+ minutes?|tomorrow|a minute/g) || []).length, 1, 'exactly one time in the message');
  assert.equal(store.LIMIT_MSG.burst(1), 'This network has started a lot of demos recently. You can start another in 1 minute, or book a guided demo.');
  assert.equal(store.BURST_MAX, 10); assert.equal(store.BURST_WINDOW_MS, 600000);
  /* a returning visitor is not blocked by the limit */
  const back = await createVia(ip, 'pmoflow_ws=' + created[created.length - 1][0]);
  assert.equal(back.status, 200);
  /* another network is unaffected */
  const other = testIp();
  const o = await createVia(other);
  assert.equal(o.status, 201); created.push([o.body.id, hashOf(other)]);
});

test('sandbox: daily cap of 50 per network, with one plain message', { skip: store._backend() !== 'memory' && 'creates 50 sandboxes: in-memory backend only' }, async () => {
  assert.equal(store.CREATES_PER_DAY, 50);
  const ip = testIp(), hash = hashOf(ip);
  /* step the clock 11 minutes after every 10 sandboxes, inside one UTC day, so only the daily cap can refuse */
  const realNow = Date.now;
  const base = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:05:00Z');
  let n = 0;
  Date.now = () => base + Math.floor(n / 10) * 11 * 60000;
  try {
    for (; n < 50; n++) {
      const r = await createVia(ip);
      assert.equal(r.status, 201, 'create ' + (n + 1));
      created.push([r.body.id, hash]);
    }
    const r = await createVia(ip);
    assert.equal(r.status, 429);
    assert.deepEqual(r.body, { error: 'This network has started a lot of demos today. You can start another tomorrow, or book a guided demo.' });
  } finally { Date.now = realNow; }
});

/* ---------- R12 H4 (CONSOLIDATED-R11 #2): every audit attack from expert-pmo.md, on JSON and CSV, plus the new ones ---------- */
async function auditWs() {
  const ws = await newWs();
  for (let i = 0; i < 4; i++) await call('PUT', `ws/${ws}/doc/risk/rk-r12${i}`, { data: { title: 'Risk ' + i, status: 'open' }, actor: i % 2 ? 'mc' : 'ta', summary: 'Logged risk ' + i });
  /* an external identity, the way sync records it */
  await store.appendEvent(ws, { actor: 'Jira: jane@contoso.example', action: 'sync', ref: 'workItem:W11', summary: 'From Jira VOM-11: work item status Not started → Done' });
  /* summaries that need CSV escaping and formula protection must round-trip exactly */
  await store.appendEvent(ws, { actor: 'ta', action: 'update', ref: 'risk:rk-x', summary: '=HYPERLINK("x"), "quoted", line\nbreak' });
  await store.appendEvent(ws, { actor: 'ta', action: 'update', ref: 'risk:rk-y', summary: "'=already quoted" });
  const j = (await call('GET', `workspaces/${ws}/admin/audit`, null, {})).body;
  const csv = (await call('GET', `workspaces/${ws}/admin/audit`, null, { format: 'csv' })).body;
  return { ws, j, csv };
}
const vJson = async (ws, entries, head) => (await call('POST', `workspaces/${ws}/admin/audit/verify`, { entries, head })).body.verify;
const vCsv = async (ws, csv) => (await call('POST', `workspaces/${ws}/admin/audit/verify`, { csv })).body.verify;
/* CSV built from (possibly tampered) entries and head, in the exact export format */
const csvOf = (entries, head, key) => admin.toCSV(entries, { summary: 'x', head: '', at: '' }, head, key || 'development key');

test('R12 audit: actor id and actor name are inside the hash', async () => {
  const { ws, j } = await auditWs();
  assert.equal((await vJson(ws, j.entries, j.head)).ok, true);
  const tom = j.entries.findIndex(e => e.actor === 'ta');
  assert.equal(j.entries[tom].actorName, 'Tom Alvarez');
  /* the expert's attack: edit actorName only */
  const named = j.entries.map(e => Object.assign({}, e)); named[tom].actorName = 'Rosa Diaz';
  let v = await vJson(ws, named, j.head);
  assert.equal(v.ok, false, 'an edited actorName fails'); assert.equal(v.firstBreak.seq, tom + 1); assert.match(v.summary, /changed after it was recorded/);
  /* edit the actor id only */
  const id = j.entries.map(e => Object.assign({}, e)); id[tom].actor = 'rd';
  assert.equal((await vJson(ws, id, j.head)).ok, false, 'an edited actor id fails');
  /* the external identity is the recorded actor and name */
  const ext = j.entries.find(e => e.action === 'sync');
  assert.equal(ext.actor, 'Jira: jane@contoso.example'); assert.equal(ext.actorName, 'Jira: jane@contoso.example');
  const ext2 = j.entries.map(e => Object.assign({}, e)); ext2[ext.seq - 1].actorName = 'Tom Alvarez';
  assert.equal((await vJson(ws, ext2, j.head)).ok, false, 'relabelling a Jira change as Tom fails');
  /* re-hash after the name edit, keep the head: the signature fails */
  const re = admin.chainEvents(ws, named.map(e => ({ at: e.at, actor: e.actor, actorName: e.actorName, action: e.action, ref: e.ref, summary: e.summary })));
  v = await vJson(ws, re, Object.assign({}, j.head, { hash: re[re.length - 1].hash }));
  assert.equal(v.ok, false); assert.match(v.summary, /signature does not match/);
  /* the algorithm string says what is hashed */
  assert.match(j.algorithm, /actor, actorName, action/);
});

test('R12 audit: a CSV export is verifiable in the app (head and count in a footer row)', async () => {
  const { ws, j, csv } = await auditWs();
  const lines = csv.trimEnd().split('\r\n');
  const foot = lines[lines.length - 1].split(',');
  assert.equal(foot[0], '# Signed head');
  assert.equal(Number(foot[1]), j.total, 'footer carries the count');
  assert.equal(foot[2], j.head.hash, 'footer carries the head');
  assert.equal(foot[3], j.head.signature);
  /* round trip: parsing gives back exactly the exported entries */
  const parsed = admin.fromCSV(csv);
  assert.deepEqual(parsed.entries, j.entries.map(e => Object.assign({}, e, { seq: e.seq })));
  assert.match(csv, /"'=HYPERLINK\(""x""\), ""quoted"", line\nbreak"/, 'formula protection in the file');
  assert.match(csv, /,''=already quoted,/);
  let v = await vCsv(ws, csv);
  assert.equal(v.ok, true, v.summary); assert.equal(v.signed, true); assert.equal(v.format, 'csv');
  assert.equal((await vCsv(ws, '﻿' + csv)).ok, true, 'the byte-order mark the app adds is fine');
  /* every attack from the expert's report, on the CSV */
  const E = () => parsed.entries.map(e => Object.assign({}, e));
  /* 1. edit an entry */
  let t = E(); t[2].summary += ' (changed)';
  v = await vCsv(ws, csvOf(t, j.head)); assert.equal(v.ok, false); assert.equal(v.firstBreak.seq, 3);
  /* 1b. edit by hand in the text */
  v = await vCsv(ws, csv.replace('Logged risk 1', 'Logged risk 9')); assert.equal(v.ok, false);
  /* 2. edit actorName */
  t = E(); t[0].actorName = 'Someone else';
  v = await vCsv(ws, csvOf(t, j.head)); assert.equal(v.ok, false); assert.equal(v.firstBreak.seq, 1);
  /* 3. re-hash everything after an edit, keep the signature */
  t = E(); t[1].summary = 'Nothing to see here';
  let re = admin.chainEvents(ws, t);
  v = await vCsv(ws, csvOf(re, Object.assign({}, j.head, { hash: re[re.length - 1].hash })));
  assert.equal(v.ok, false); assert.match(v.summary, /signature does not match/);
  /* 4. delete the tail, keep the head */
  v = await vCsv(ws, csvOf(E().slice(0, -1), j.head)); assert.equal(v.ok, false); assert.match(v.summary, /removed from the end/);
  /* 4b. delete the tail and fix the head's count and hash */
  t = E().slice(0, -1);
  v = await vCsv(ws, csvOf(t, Object.assign({}, j.head, { count: t.length, hash: t[t.length - 1].hash }))); assert.equal(v.ok, false); assert.match(v.summary, /signature does not match/);
  /* 5. delete a middle entry and re-hash */
  t = E(); t.splice(2, 1); re = admin.chainEvents(ws, t);
  v = await vCsv(ws, csvOf(re, { count: re.length, hash: re[re.length - 1].hash, signature: j.head.signature })); assert.equal(v.ok, false);
  /* 5b. delete a middle entry without re-hashing */
  t = E(); t.splice(2, 1);
  v = await vCsv(ws, csvOf(t, j.head)); assert.equal(v.ok, false);
  /* 6. remove the head row */
  v = await vCsv(ws, csv.replace(/# Signed head,[^\r\n]*\r\n$/, '')); assert.equal(v.ok, false); assert.match(v.summary, /no signed head/);
  /* 7. a cut row, a foreign file, a filtered export, another workspace */
  v = await vCsv(ws, csv.replace(/\r\n2,[^\r\n]*/, '\r\n2,cut')); assert.equal(v.ok, false); assert.match(v.summary, /cells instead of/);
  v = await vCsv(ws, 'name,amount\r\nx,1\r\n'); assert.equal(v.ok, false); assert.match(v.summary, /isn’t a PMOFlow history export/);
  const filtered = (await call('GET', `workspaces/${ws}/admin/audit`, null, { format: 'csv', person: 'ta' })).body;
  assert.match(filtered, /\r\n# Filtered export,\d+,,,/);
  v = await vCsv(ws, filtered); assert.equal(v.ok, false); assert.match(v.summary, /filtered/);
  const ws2 = await newWs();
  assert.equal((await vCsv(ws2, csv)).ok, false, 'another workspace cannot vouch for it');
  /* JSON: the same attacks still fail (R11 suite) and the honest file passes */
  assert.equal((await vJson(ws, j.entries, j.head)).ok, true);
});

test('R12 audit: the key source reads "production key" only when PMOFLOW_AUDIT_KEY is set', async () => {
  const saved = process.env.PMOFLOW_AUDIT_KEY;
  try {
    delete process.env.PMOFLOW_AUDIT_KEY;
    const ws = await newWs();
    await call('PUT', `ws/${ws}/doc/risk/rk-k`, { data: { title: 'K', status: 'open' }, actor: 'ta', summary: 'Logged risk K' });
    let j = (await call('GET', `workspaces/${ws}/admin/audit`, null, {})).body;
    assert.equal(j.keySource, 'development key');
    let csv = (await call('GET', `workspaces/${ws}/admin/audit`, null, { format: 'csv' })).body;
    assert.match(csv, /,development key\r\n$/);
    assert.equal((await vCsv(ws, csv)).keySource, 'development key');
    process.env.PMOFLOW_AUDIT_KEY = 'unit-test-production-audit-key-0123';
    assert.equal(admin.keyLabel(), 'production key');
    j = (await call('GET', `workspaces/${ws}/admin/audit`, null, {})).body;
    assert.equal(j.keySource, 'production key');
    csv = (await call('GET', `workspaces/${ws}/admin/audit`, null, { format: 'csv' })).body;
    assert.match(csv, /,production key\r\n$/);
    const v = await vCsv(ws, csv);
    assert.equal(v.ok, true); assert.equal(v.keySource, 'production key'); assert.equal(v.fileKeySource, 'production key');
    assert.ok(!csv.includes('unit-test-production-audit-key') && !JSON.stringify(j).includes('unit-test-production-audit-key'), 'the key itself never appears');
    /* a file signed with the development key does not verify under the production key */
    process.env.PMOFLOW_AUDIT_KEY = 'a-different-production-key-456789';
    assert.equal((await vCsv(ws, csv)).ok, false);
  } finally {
    if (saved === undefined) delete process.env.PMOFLOW_AUDIT_KEY; else process.env.PMOFLOW_AUDIT_KEY = saved;
  }
});

test('R12 sandbox: the burst message names the real wait, and Retry-After agrees', async () => {
  const ip = testIp();
  const realNow = Date.now;
  const t0 = realNow();
  let off = 0;
  Date.now = () => t0 + off;
  try {
    for (let i = 0; i < store.BURST_MAX; i++) { const r = await createVia(ip); assert.equal(r.status, 201); created.push([r.body.id, hashOf(ip)]); }
    off = 4 * 60000 + 5000;            /* 4 minutes later: the oldest leaves the window in 5 min 55 s */
    const r = await createVia(ip);
    assert.equal(r.status, 429);
    assert.match(r.body.error, /You can start another in 6 minutes, or book a guided demo\.$/);
    assert.equal(Number((r.headers || {})['Retry-After']), 355);
    off = 10 * 60000 + 1000;           /* after the window: allowed again */
    const ok2 = await createVia(ip);
    assert.equal(ok2.status, 201); created.push([ok2.body.id, hashOf(ip)]);
  } finally { Date.now = realNow; }
});

/* R13 K4 (Jordan, R12 mismatch 8): "CSV verify mentions the development key; JSON verify doesn't". Both formats state the
   key source the same way, from what the server checked the signature with, not from a label the file carries. */
test('R13 audit: JSON and CSV verify messages show the key source the same way', async () => {
  const { ws, j, csv } = await auditWs();
  const vj = await vJson(ws, j.entries, j.head);
  const vc = await vCsv(ws, csv);
  assert.equal(vj.ok, true, vj.summary); assert.equal(vc.ok, true, vc.summary);
  assert.match(vj.keyNote, /^Signed with the (development|production) key\.$/, 'JSON verify states the key source');
  assert.equal(vc.keyNote, vj.keyNote, 'CSV verify states it the same way');
  assert.equal(vj.keyNote, `Signed with the ${admin.keyLabel()}.`);
  /* a CSV whose footer claims another key source does not change what the check says */
  const relabelled = csv.replace(/,(development|production) key\r\n$/, ',production key\r\n');
  assert.equal((await vCsv(ws, relabelled)).keyNote, vj.keyNote);
  /* a broken file makes no claim about its key */
  const bad = j.entries.map(e => Object.assign({}, e)); bad[0].summary += ' (changed)';
  assert.equal((await vJson(ws, bad, j.head)).keyNote, '');
  assert.equal((await vCsv(ws, 'name,amount\r\nx,1\r\n')).keyNote || '', '');
});

/* R13 K4 #1 (Karen, BPM expert): departments are workspace data. Admin keeps them through every settings write, shows them in
   GET admin, and invites name a department. Writes go through K1's POST /ws/:ws/departments. */
test('R13 departments: admin writes keep settings.departments; GET admin lists them', async () => {
  const ws = await newWs();
  const add = await call('POST', `ws/${ws}/departments`, { op: { kind: 'add', name: 'Credit', approvers: ['ar'] }, actor: 'ta' });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const names = r => r.body.departments.map(d => d.name);
  let g = await call('GET', `workspaces/${ws}/admin`);
  assert.ok(Array.isArray(g.body.departments), 'GET admin carries the department list');
  assert.ok(names(g).includes('Credit') && names(g).includes('Treasury'));
  const credit = g.body.departments.find(d => d.name === 'Credit');
  assert.deepEqual(credit.approvers, ['ar']); assert.deepEqual(credit.approverNames, ['Ana Ruiz']);
  /* a role change, an invite, an export checkpoint: none of them wipe the departments */
  assert.equal((await call('PUT', `workspaces/${ws}/admin/roles/ps`, { role: 'approver', actor: 'ta' })).status, 200);
  assert.equal((await call('POST', `workspaces/${ws}/admin/invites`, { email: 'kim@northwind.example', role: 'viewer', actor: 'ta' })).status, 200);
  await call('POST', `workspaces/${ws}/admin/audit/anchor`, { actor: 'ta' });
  const st = (await call('GET', `ws/${ws}/state`)).body.docs;
  const set = st.workspace.find(d => d.id === 'settings').data;
  assert.ok(set.departments.some(d => d.name === 'Credit'), 'departments survive admin writes');
  assert.equal(set.roles.ps, 'approver');
  g = await call('GET', `workspaces/${ws}/admin`);
  assert.ok(names(g).includes('Credit'));
  /* each person row says which department they are in */
  assert.equal(g.body.people.find(p => p.id === 'lp').department, 'Treasury');
});

test('R13 departments: an invite names a department (optional), checked against the list', async () => {
  const ws = await newWs();
  await call('POST', `ws/${ws}/departments`, { op: { kind: 'add', name: 'Credit' }, actor: 'ta' });
  const g = await call('GET', `workspaces/${ws}/admin`);
  const credit = g.body.departments.find(d => d.name === 'Credit');
  let r = await call('POST', `workspaces/${ws}/admin/invites`, { email: 'sam.wu@northwind.example', role: 'approver', departmentId: credit.id, actor: 'ta' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const inv = r.body.settings.invites.find(i => i.email === 'sam.wu@northwind.example');
  assert.equal(inv.departmentId, credit.id); assert.equal(inv.department, 'Credit');
  r = await call('POST', `workspaces/${ws}/admin/invites`, { email: 'x@northwind.example', role: 'viewer', departmentId: 'dept-nope', actor: 'ta' });
  assert.equal(r.status, 400); assert.match(r.body.error, /department/i);
  r = await call('POST', `workspaces/${ws}/admin/invites`, { email: 'y@northwind.example', role: 'viewer', actor: 'ta' });
  assert.equal(r.status, 200, 'no department is fine');
  assert.equal(r.body.settings.invites.find(i => i.email === 'y@northwind.example').departmentId, null);
  const evs = (await call('GET', `ws/${ws}/events`)).body.events;
  assert.ok(evs.some(e => /Invited sam\.wu@northwind\.example as Approver in Credit/.test(e.summary)));
  /* renaming the department shows the new name on the invite */
  await call('POST', `ws/${ws}/departments`, { op: { kind: 'rename', id: credit.id, name: 'Credit and Collections' }, actor: 'ta' });
  const g2 = await call('GET', `workspaces/${ws}/admin`);
  assert.equal(g2.body.settings.invites.find(i => i.email === 'sam.wu@northwind.example').department, 'Credit and Collections');
});
