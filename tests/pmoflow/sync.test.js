// PMOFlow R10 S4 sync engine tests. Run: node tests/pmoflow/sync.test.js  (or node --test)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const API_SYNC = path.join(ROOT, 'api', 'shared', 'pmoflow-sync.js');
const WEB_SYNC = path.join(ROOT, 'web', 'public', 'concepts', 'pmoflow', 'app', 'sync.js');
const S = require(API_SYNC);
const E = require(path.join(ROOT, 'api', 'shared', 'pmoflow-engine.js'));
const { seed } = require(path.join(ROOT, 'api', 'shared', 'pmoflow-seed.js'));

const DAY = '2026-11-17';
const PRJ = 'vendor-modernization';
let n = 0;
const nonce = () => 'n' + (++n);
const clock = (() => { let t = Date.parse('2026-11-17T15:00:00Z'); return () => new Date(t += 1000).toISOString(); })();

function fresh(tool) {
  const docs = seed(DAY).docs;
  const conn = Object.assign(S.defaultConnection({ projectId: PRJ, tool }), { id: 'conn-' + PRJ });
  conn.sim = S.simNew(conn);
  return { docs, conn };
}
const wi = (docs, id) => docs.workItem.find(d => d.id === id).data;
function setWi(docs, id, patch) { const d = docs.workItem.find(x => x.id === id); d.data = Object.assign({}, d.data, patch); return d.data; }
/* one full sync pass the way the route runs it: inbound, then outbound, then links */
function sync(docs, conn) {
  const pull = S.simExecute(conn, conn.sim, S.pullIntent(conn, { nonce }), clock());
  const res = S.applyInbound(conn, docs, pull.changes, { today: DAY, now: clock() });
  conn.cursor = pull.cursor || conn.cursor;
  res.updates.forEach(u => { docs.workItem.find(d => d.id === u.workItemId).data = u.data; });
  const sent = [];
  for (const it of S.computeOutbound(conn, docs, { nonce }).concat()) { const r = S.simExecute(conn, conn.sim, it, clock()); S.recordResult(conn, it, r, docs); sent.push(it); }
  for (const it of S.computeLinks(conn, docs, { nonce })) { const r = S.simExecute(conn, conn.sim, it, clock()); S.recordResult(conn, it, r, docs); sent.push(it); }
  return { res, sent };
}

test('browser copy is byte-identical', () => {
  assert.equal(fs.readFileSync(WEB_SYNC, 'utf8'), fs.readFileSync(API_SYNC, 'utf8'));
});

test('canonical JSON sorts keys at every level and drops undefined', () => {
  assert.equal(S.canonical({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 'x' }, u: undefined }), '{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}');
  assert.equal(S.signingString({ sig: 'abc', a: 1 }), '{"a":1}');
});

test('settings validation: Jira and Azure DevOps, locked fields, emails, status map', () => {
  const ok = S.validateSettings({ tool: 'jira', projectId: PRJ, site: 'https://Northwind.atlassian.net/', projectKey: 'vom', notify: { teams: { on: true, channel: 'Vendor team' }, outlook: { on: true, to: 'ta@northwind.example, ar@northwind.example' } },
    fields: { due: { dir: 'in' }, title: { dir: 'out' } } }, { projects: [PRJ], statuses: ['idle', 'prog', 'review', 'done'] });
  assert.ok(ok.ok, ok.errors.join());
  assert.equal(ok.value.site, 'northwind.atlassian.net');
  assert.equal(ok.value.projectKey, 'VOM');
  assert.equal(ok.value.fields.due.dir, 'out', 'PMOFlow owns due dates');
  assert.equal(ok.value.fields.title.dir, 'out');
  assert.deepEqual(ok.value.notify.outlook.to, ['ta@northwind.example', 'ar@northwind.example']);
  assert.equal(ok.value.statusMap.review, 'In Review');
  const ado = S.validateSettings({ tool: 'ado', projectId: PRJ, site: 'dev.azure.com/northwind', projectKey: 'Vendor Onboarding' }, { projects: [PRJ] });
  assert.ok(ado.ok, ado.errors.join());
  assert.equal(ado.value.site, 'northwind');
  assert.equal(ado.value.statusMap.done, 'Closed');
  const bad = S.validateSettings({ tool: 'jira', projectId: 'nope', site: 'example.com', projectKey: '1', notify: { outlook: { on: true, to: 'not-an-email' } } }, { projects: [PRJ] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 4, bad.errors.join(' | '));
  assert.equal(S.validateSettings({ tool: 'trello' }).ok, false);
});

test('people map by email; secrets are referenced by name only', () => {
  const docs = seed(DAY).docs;
  const maya = docs.person.find(d => d.id === 'mc').data;
  assert.equal(S.personEmail(maya, 'northwind.example'), 'maya.chen@northwind.example');
  assert.equal(S.personByEmail(docs, 'MAYA.CHEN@northwind.example', 'northwind.example').id, 'mc');
  assert.equal(S.personEmail({ name: 'X', email: 'Pat@Northwind.example' }), 'pat@northwind.example');
  assert.equal(S.teamsSecretName('Vendor team!'), 'teams-webhook-vendor-team');
});

test('rich text conversions round-trip plain text', () => {
  const t = 'Line one & <two>\n\nLine "three"';
  assert.equal(S.textFromAdf(S.adfFromText(t)), t);
  assert.equal(S.textFromHtml(S.htmlFromText(t)), t);
  assert.equal(S.textFromAdf({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] }), 'a\nb');
});

test('status mapping both ways, with understood extras', () => {
  const { conn } = fresh('jira');
  assert.equal(S.toolStatus(conn, 'prog'), 'In Progress');
  assert.equal(S.pmoStatus(conn, 'in progress'), 'prog');
  assert.equal(S.pmoStatus(conn, 'Closed'), 'done');
  assert.equal(S.pmoStatus(conn, 'Waiting for vendor'), undefined);
  const ado = fresh('ado').conn;
  assert.equal(S.pmoStatus(ado, 'Active'), 'prog');
  assert.equal(S.pmoStatus(ado, 'Removed'), undefined);
});

test('first sync creates one Jira issue per task, with the mapped fields', () => {
  const { docs, conn } = fresh('jira');
  const intents = S.computeOutbound(conn, docs, { nonce });
  assert.equal(intents.length, docs.workItem.filter(d => d.data.projectId === PRJ).length);
  const w6 = intents.find(i => i.ref.workItemId === 'W6');
  assert.equal(w6.op, 'create');
  assert.equal(w6.payload.fields.project.key, 'VOM');
  assert.equal(w6.payload.fields.summary, 'Set up the bank details form');
  assert.equal(w6.payload.fields.description.type, 'doc');
  assert.equal(w6.payload.fields.duedate, wi(docs, 'W6').due);
  assert.deepEqual(w6.payload.fields.labels, ['pmoflow']);
  assert.equal(w6.payload.assigneeEmail, 'leo.park@northwind.example');
  assert.equal(w6.payload.status, 'To Do');
  assert.equal(Date.parse(w6.exp) - Date.parse(w6.iat), 5 * 60 * 1000, 'intents expire after 5 minutes');
  assert.ok(w6.nonce && w6.kid === 1);
  const reqs = S.describeRequest(conn, w6);
  assert.ok(reqs.some(r => r.method === 'POST' && r.url === 'https://northwind.atlassian.net/rest/api/3/issue'));
  assert.ok(reqs.some(r => r.method === 'GET' && /user\/search\?query=leo.park/.test(r.url)));
});

test('after a sync nothing is re-sent; dependencies are linked once both ends exist', () => {
  const { docs, conn } = fresh('jira');
  const first = sync(docs, conn);
  assert.ok(first.sent.some(i => i.op === 'link' && i.ref.workItemId === 'W7' && i.payload.dependsOn.length === 1));
  const k6 = S.keyOf(conn, 'W6');
  assert.match(k6, /^VOM-\d+$/);
  assert.deepEqual(conn.sim.items[S.keyOf(conn, 'W7')].deps, [k6]);
  const again = sync(docs, conn);
  assert.equal(again.sent.length, 0, 'second sync sends nothing');
  assert.equal(again.res.updates.length, 0, 'own echoes are not applied back');
});

test('a PMOFlow edit sends only the changed field', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  setWi(docs, 'W8', { title: 'Save new vendors in the ERP automatically (v2)', updatedAt: clock() });
  const ints = S.computeOutbound(conn, docs, { nonce });
  assert.equal(ints.length, 1);
  assert.equal(ints[0].op, 'update');
  assert.deepEqual(ints[0].changed, ['title']);
  assert.deepEqual(Object.keys(ints[0].payload.fields), ['summary']);
  setWi(docs, 'W8', { status: 'done' });
  const st = S.computeOutbound(conn, docs, { nonce })[0];
  assert.equal(st.payload.status, 'Done');
  const reqs = S.describeRequest(conn, st);
  assert.ok(reqs.some(r => r.method === 'POST' && /\/issue\/VOM-\d+\/transitions$/.test(r.url)), 'status goes through a transition');
});

test('a status change in Jira flows back and the engine recomputes', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  const before = E.projectTruth(docs, PRJ, DAY);
  S.simEdit(conn.sim, S.keyOf(conn, 'W6'), { status: 'Done' }, clock());
  const { res } = sync(docs, conn);
  assert.equal(res.updates.length, 1);
  assert.deepEqual(res.updates[0].changes, [{ field: 'status', from: 'idle', to: 'done' }]);
  assert.equal(wi(docs, 'W6').status, 'done');
  assert.equal(wi(docs, 'W6').doneAt, DAY);
  const after = E.projectTruth(docs, PRJ, DAY);
  assert.equal(after.tasks.done, before.tasks.done + 1);
  /* back to In Progress clears the done date */
  S.simEdit(conn.sim, S.keyOf(conn, 'W6'), { status: 'In Progress' }, clock());
  sync(docs, conn);
  assert.equal(wi(docs, 'W6').status, 'prog');
  assert.equal(wi(docs, 'W6').doneAt, undefined);
});

test('assignee maps by email; unknown people and unmapped statuses are skipped and logged', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  const k = S.keyOf(conn, 'W11');
  S.simEdit(conn.sim, k, { assigneeEmail: 'Ana.Ruiz@northwind.example' }, clock());
  sync(docs, conn);
  assert.equal(wi(docs, 'W11').owner, 'ar');
  S.simEdit(conn.sim, k, { assigneeEmail: 'stranger@elsewhere.example', status: 'Waiting for vendor' }, clock());
  const { res } = sync(docs, conn);
  assert.equal(wi(docs, 'W11').owner, 'ar');
  assert.equal(res.skipped.length, 2);
  assert.ok(res.skipped.some(s => s.field === 'status' && /isn’t mapped/.test(s.reason)));
  assert.ok(res.skipped.some(s => s.field === 'assignee'));
});

test('conflicts: the later change wins per field, and it is logged', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  const k = S.keyOf(conn, 'W10');
  /* Jira first, PMOFlow later → PMOFlow wins and is pushed back out */
  S.simEdit(conn.sim, k, { title: 'Jira title' }, clock());
  setWi(docs, 'W10', { title: 'PMOFlow title', updatedAt: clock() });
  let r = sync(docs, conn);
  assert.equal(r.res.conflicts.length, 1);
  assert.equal(r.res.conflicts[0].winner, 'PMOFlow');
  assert.equal(wi(docs, 'W10').title, 'PMOFlow title');
  assert.equal(conn.sim.items[k].title, 'PMOFlow title', 'the winner is sent to Jira');
  /* PMOFlow first, Jira later → Jira wins */
  setWi(docs, 'W10', { title: 'PMOFlow again', updatedAt: clock() });
  S.simEdit(conn.sim, k, { title: 'Jira again' }, clock());
  r = sync(docs, conn);
  assert.equal(r.res.conflicts[0].winner, 'Jira');
  assert.equal(wi(docs, 'W10').title, 'Jira again');
  /* a different field on each side is not a conflict */
  setWi(docs, 'W10', { note: 'Checked with AP', updatedAt: clock() });
  S.simEdit(conn.sim, k, { status: 'In Progress' }, clock());
  r = sync(docs, conn);
  assert.equal(r.res.conflicts.length, 0);
  assert.equal(wi(docs, 'W10').status, 'prog');
  assert.equal(conn.sim.items[k].description, 'Checked with AP');
});

test('due dates are owned by PMOFlow: a Jira change is ignored and put back', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  const k = S.keyOf(conn, 'W7'), due = wi(docs, 'W7').due;
  S.simEdit(conn.sim, k, { due: '2030-01-01' }, clock());
  const { res, sent } = sync(docs, conn);
  assert.equal(res.ignored.length, 1);
  assert.equal(wi(docs, 'W7').due, due);
  assert.ok(sent.some(i => i.op === 'update' && i.changed.includes('due')));
  assert.equal(conn.sim.items[k].due, due);
});

test('per-field direction: out-only title ignores Jira, in-only status is never sent', () => {
  const { docs, conn } = fresh('jira');
  conn.fields.title.dir = 'out';
  conn.fields.status.dir = 'in';
  sync(docs, conn);
  const k = S.keyOf(conn, 'W8');
  assert.equal(conn.sim.items[k].status, 'To Do', 'status was not sent');
  S.simEdit(conn.sim, k, { title: 'Renamed in Jira', status: 'In Review' }, clock());
  const { res } = sync(docs, conn);
  assert.equal(wi(docs, 'W8').status, 'review', 'in-only status comes in, no conflict on first value');
  assert.equal(res.conflicts.length, 0);
  assert.equal(wi(docs, 'W8').title, 'Save new vendors in the ERP automatically');
  conn.fields.title.dir = 'off';
  assert.ok(!S.outFields(conn).includes('title'));
});

test('Azure DevOps: JSON Patch payloads, WIQL pull, dependency relations', () => {
  const { docs, conn } = fresh('ado');
  const create = S.computeOutbound(conn, docs, { nonce }).find(i => i.ref.workItemId === 'W7');
  const paths = create.payload.patch.map(p => p.path);
  assert.ok(paths.includes('/fields/System.Title'));
  assert.ok(paths.includes('/fields/System.Description'));
  assert.ok(paths.includes('/fields/System.AssignedTo'));
  assert.ok(paths.includes('/fields/Microsoft.VSTS.Scheduling.DueDate'));
  assert.ok(create.payload.patch.every(p => p.op === 'add'));
  assert.ok(create.payload.patch.some(p => p.path === '/fields/System.Tags' && p.value === 'PMOFlow'));
  const reqs = S.describeRequest(conn, create);
  assert.equal(reqs[0].url, 'https://dev.azure.com/northwind/Vendor%20Onboarding/_apis/wit/workitems/$Task?api-version=7.1');
  assert.equal(reqs[0].contentType, 'application/json-patch+json');
  sync(docs, conn);
  const k6 = S.keyOf(conn, 'W6'), k7 = S.keyOf(conn, 'W7');
  assert.match(k6, /^\d+$/);
  assert.deepEqual(conn.sim.items[k7].deps, [k6]);
  S.simEdit(conn.sim, k6, { status: 'Closed' }, clock());
  sync(docs, conn);
  assert.equal(wi(docs, 'W6').status, 'done');
  const pull = S.describeRequest(conn, S.pullIntent(conn, { nonce }));
  assert.match(pull[0].url, /\/_apis\/wit\/wiql\?timePrecision=true&api-version=7\.1$/);
  assert.match(pull[0].body.query, /\[System\.ChangedDate\] > '/);
  assert.match(pull[1].url, /workitemsbatch\?api-version=7\.1$/);
  const link = S.describeRequest(conn, Object.assign(S.newIntent(conn, 'link', { workItemId: 'W7', key: k7 }, { dependsOn: [k6], linkType: 'System.LinkTypes.Dependency-Reverse' })));
  assert.equal(link[0].body[0].path, '/relations/-');
  assert.equal(link[0].body[0].value.rel, 'System.LinkTypes.Dependency-Reverse');
});

test('Jira pull uses the enhanced JQL search', () => {
  const { conn } = fresh('jira');
  const b = S.jiraPullBody(conn, '2026-11-17T15:04:05.000Z');
  assert.equal(b.jql, 'project = "VOM" AND labels = pmoflow AND updated >= "2026-11-17 15:04" ORDER BY updated ASC');
  assert.ok(b.fields.includes('status'));
  const r = S.describeRequest(conn, S.pullIntent(conn));
  assert.equal(r[0].url, 'https://northwind.atlassian.net/rest/api/3/search/jql');
});

test('items not created by PMOFlow are skipped; deleted tasks are skipped', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  const res = S.applyInbound(conn, docs, [{ key: 'VOM-999', title: 'x', updatedAt: clock() }], { today: DAY });
  assert.equal(res.skipped.length, 1);
  docs.workItem = docs.workItem.filter(d => d.id !== 'W9');
  const r2 = S.applyInbound(conn, docs, [{ key: S.keyOf(conn, 'W9'), title: 'x', updatedAt: clock() }], { today: DAY });
  assert.match(r2.skipped[0].reason, /deleted/);
});

test('notifications: Teams Workflows Adaptive Card and Graph sendMail bodies', () => {
  const docs = seed(DAY).docs;
  const truth = E.projectTruth(docs, PRJ, DAY);
  const late = S.noticeFor('late', { projectName: 'Vendor Onboarding Modernization', truth, url: 'https://example.test/p', lateItems: [{ title: 'Set up the bank details form', due: 'Nov 14', owner: 'Leo Park' }] });
  assert.match(late.title, /1 task is late on Vendor Onboarding Modernization/);
  const card = S.teamsCard(late);
  assert.equal(card.type, 'message');
  assert.equal(card.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(card.attachments[0].content.type, 'AdaptiveCard');
  assert.equal(card.attachments[0].content.version, '1.4');
  assert.equal(card.attachments[0].content.actions[0].type, 'Action.OpenUrl');
  assert.ok(card.attachments[0].content.body.some(b => b.type === 'FactSet'));
  const mail = S.graphMail(late, ['ta@northwind.example']);
  assert.equal(mail.message.subject, 'PMOFlow: ' + late.title);
  assert.equal(mail.message.body.contentType, 'HTML');
  assert.deepEqual(mail.message.toRecipients, [{ emailAddress: { address: 'ta@northwind.example' } }]);
  assert.equal(mail.saveToSentItems, false);
  assert.ok(!/<script/i.test(S.graphMail({ title: '<script>x</script>', facts: [] }, []).message.body.content), 'escaped');
  const tf = S.noticeFor('testFailed', { projectName: 'P', truth });
  assert.match(tf.title, /test(s)? failed on P/);
  assert.match(S.noticeFor('approval', { projectName: 'P', approval: { bu: 'Compliance', ready: true, approverName: 'Dave Ortiz' } }).title, /^Approval needed: Compliance/);
  assert.match(S.noticeFor('launchDone', { projectName: 'P', live: true, liveDate: 'Dec 9' }).title, /P is live/);
});

/* ---------- R11 G4: counters equal the log; Done before dependencies is flagged (through the route, in-memory store) ---------- */
test('R11 route: "changed issues since the last sync" excludes PMOFlow’s own writes; counts match the log; early Done is flagged', async () => {
  const saved = process.env.EMCEE_STORAGE_CONNECTION; delete process.env.EMCEE_STORAGE_CONNECTION;
  const fn = require(path.join(ROOT, 'api', 'pmoflow', 'index.js'));
  const store = require(path.join(ROOT, 'api', 'shared', 'pmoflow-store.js'));
  const ws = (await store.createWorkspace('sync-r11-' + Date.now(), {})).id;
  const call = async (method, p, body) => { const ctx = { res: null, log: Object.assign(() => {}, { error() {}, warn() {}, info() {} }) };
    await fn(ctx, { method, url: '/api/pmoflow/' + p, headers: { 'x-forwarded-for': '10.9.9.9' }, params: { path: p }, query: {}, body }); return ctx.res; };
  try {
    const st = (await call('GET', `ws/${ws}/state`)).body;
    const owner = st.docs.project.find(d => d.id === PRJ).data.owner;
    const r = await call('POST', `workspaces/${ws}/connections`, { projectId: PRJ, tool: 'jira', site: 'northwind.atlassian.net', projectKey: 'VOM', actor: owner });
    assert.equal(r.status, 201);
    const c = r.body.connection, sum = r.body.sync.summary;
    const outRows = c.log.filter(e => e.dir === 'out' && e.result === 'ok');
    assert.equal(sum.sent, outRows.length, 'changes sent = PMOFlow → Jira rows in the log');
    assert.equal(sum.created, outRows.filter(e => e.op === 'create').length);
    assert.equal(sum.linked, outRows.filter(e => e.op === 'link').length);
    assert.match(r.body.sync.sentence, new RegExp(`^${sum.created} issues created in Jira · ${sum.linked} dependency links set in Jira$`));
    /* the next sync reads nothing: PMOFlow just wrote every issue itself */
    const again = await call('POST', `workspaces/${ws}/connections/${c.id}/sync`, { actor: owner });
    assert.equal(again.body.connection.log.find(e => e.op === 'pull').detail, '0 changed issues since the last sync.');
    assert.equal(again.body.sentence, 'Everything was already in sync');
    /* one person changes one issue: exactly 1 changed issue; it is Done while its predecessors are open, so it is flagged */
    const items = again.body.connection.sim.items;
    const docs = (await call('GET', `ws/${ws}/state`)).body.docs;
    const open = id => (docs.workItem.find(d => d.id === id) || {}).data;
    const key = Object.keys(items).find(k => { const w = open(items[k].pmoId); return w && w.status !== 'done' && (w.deps || []).some(d => open(d) && open(d).status !== 'done'); });
    assert.ok(key, 'the seed has a task waiting on open work');
    const sim = await call('POST', `workspaces/${ws}/connections/${c.id}/sim`, { key, status: 'Done', actor: owner });
    assert.equal(sim.status, 200);
    const log = sim.body.connection.log;
    assert.equal(log.find(e => e.op === 'pull').detail, '1 changed issue since the last sync.');
    const flag = log.find(e => e.op === 'flag');
    assert.ok(flag && flag.result === 'flagged' && flag.key === key, 'flag row in the sync log');
    assert.match(flag.detail, /^Finished before the work it depends on \(.+ still open\)\. Accepted/);
    assert.equal(sim.body.summary.received, 1); assert.equal(sim.body.summary.early, 1);
    assert.match(sim.body.sentence, /1 task updated from Jira · 1 finished before the work it depends on \(flagged\)/);
    const after = (await call('GET', `ws/${ws}/state`)).body.docs;
    assert.equal(after.workItem.find(d => d.id === items[key].pmoId).data.status, 'done', 'accepted, not refused');
    const evs = (await call('GET', `ws/${ws}/events`)).body.events;
    assert.ok(evs.some(e => /finished before the work it depends on/i.test(e.summary)), 'recorded in history');
  } finally {
    await store.deleteWorkspace(ws).catch(() => {});
    if (saved !== undefined) process.env.EMCEE_STORAGE_CONNECTION = saved;
  }
});
