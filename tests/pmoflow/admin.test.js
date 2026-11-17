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
  assert.equal(r.body.seats.paid, r.body.people.length);
  assert.equal(r.body.seats.free, 0);
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
  assert.equal(ok.body.seats.free, 1);
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
  const want1 = crypto.createHash('sha256').update(admin.genesis('wsx') + '\n' + JSON.stringify([1, evs[0].at, 'ta', 'create', 'project:p1', 'Created project'])).digest('hex');
  assert.equal(a[0].hash, want1);
  assert.equal(admin.verifyChain('wsx', a).ok, true);
  const edited = a.map(e => Object.assign({}, e)); edited[1].summary = 'Edited step (quietly changed)';
  const v = admin.verifyChain('wsx', edited);
  assert.equal(v.ok, false); assert.equal(v.firstBreak.seq, 2);
  const dropped = [a[0], a[2]];
  assert.equal(admin.verifyChain('wsx', dropped).ok, false);
  assert.equal(admin.verifyChain('other-ws', a).ok, false);
  /* anchors: a recorded head must still match */
  assert.equal(admin.verifyChain('wsx', a, [{ n: 2, hash: a[1].hash }]).ok, true);
  assert.equal(admin.verifyChain('wsx', a, [{ n: 2, hash: 'f'.repeat(64) }]).ok, false);
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
  /* verify a saved file, then a tampered copy */
  const good = await call('POST', `workspaces/${ws}/admin/audit/verify`, { entries: j.body.entries });
  assert.equal(good.body.verify.ok, true);
  const bad = j.body.entries.map(e => Object.assign({}, e)); bad[0].actor = 'lp';
  const vb = await call('POST', `workspaces/${ws}/admin/audit/verify`, { entries: bad });
  assert.equal(vb.body.verify.ok, false);
  assert.equal(vb.body.verify.firstBreak.seq, 1);
});

test('CSV cells are escaped and formula-safe', () => {
  const csv = admin.toCSV([{ seq: 1, at: 'a', actor: 'x', actorName: '=HYPERLINK("e")', action: 'u', ref: 'r', summary: 'a, "b"', prevHash: 'p', hash: 'h' }],
    { summary: 'Chain intact.', head: 'h', at: 'now' });
  assert.match(csv, /'=HYPERLINK\(""e""\)/);
  assert.match(csv, /"a, ""b"""/);
});

test('unknown workspace and bad routes', async () => {
  assert.equal((await call('GET', 'workspaces/zzzzzzzzzzzzzzzz/admin')).status, 404);
  assert.equal((await call('GET', 'workspaces/BAD/admin')).status, 400);
  const ws = await newWs();
  assert.equal((await call('POST', `workspaces/${ws}/admin/nope`, { actor: 'ta' })).status, 404);
  assert.equal((await call('POST', `workspaces/${ws}/admin`, {})).status, 405);
});
