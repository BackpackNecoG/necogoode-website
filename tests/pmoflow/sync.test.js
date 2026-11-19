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
  /* R12: W11 is a plain task (no problem fix, no information to make available), so Done moves its status */
  S.simEdit(conn.sim, S.keyOf(conn, 'W11'), { status: 'Done' }, clock());
  const { res } = sync(docs, conn);
  assert.equal(res.updates.length, 1);
  assert.deepEqual(res.updates[0].changes, [{ field: 'status', from: 'idle', to: 'done' }]);
  assert.equal(wi(docs, 'W11').status, 'done');
  assert.equal(wi(docs, 'W11').doneAt, DAY);
  const after = E.projectTruth(docs, PRJ, DAY);
  assert.equal(after.tasks.done, before.tasks.done + 1);
  /* back to In Progress clears the done date */
  S.simEdit(conn.sim, S.keyOf(conn, 'W11'), { status: 'In Progress' }, clock());
  sync(docs, conn);
  assert.equal(wi(docs, 'W11').status, 'prog');
  assert.equal(wi(docs, 'W11').doneAt, undefined);
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
  /* R14: a date inside the deadline is put back; a date past the deadline becomes a plan change request (test below) */
  S.simEdit(conn.sim, k, { due: '2026-11-25' }, clock());
  const { res, sent } = sync(docs, conn);
  assert.equal(res.ignored.length, 1);
  assert.equal((res.planChanges || []).length, 0);
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
  S.simEdit(conn.sim, S.keyOf(conn, 'W11'), { status: 'Closed' }, clock());
  sync(docs, conn);
  assert.equal(wi(docs, 'W11').status, 'done', 'Closed in Azure DevOps → Done for a plain task');
  /* R13 #5: W7 waits on W6 (still open), so its Closed is held in review */
  S.simEdit(conn.sim, k7, { status: 'Closed' }, clock());
  sync(docs, conn);
  assert.equal(wi(docs, 'W7').status, 'review', 'Closed out of order is held');
  /* R12: W6 makes Bank remittance details available, so Closed is held as In review, never Done */
  S.simEdit(conn.sim, k6, { status: 'Closed' }, clock());
  sync(docs, conn);
  assert.equal(wi(docs, 'W6').status, 'review');
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
    /* R15: the sentence counts the plan's links, and the issues (Link rows) they were set on */
    assert.match(r.body.sync.sentence, new RegExp(`^${sum.created} issues created in Jira · ${sum.links} dependency links set on ${sum.linked} issues in Jira$`));
    /* the next sync reads nothing: PMOFlow just wrote every issue itself */
    const again = await call('POST', `workspaces/${ws}/connections/${c.id}/sync`, { actor: owner });
    assert.equal(again.body.connection.log.find(e => e.op === 'pull').detail, '0 changed issues since the last sync.');
    assert.equal(again.body.sentence, 'Everything was already in sync');
    /* one person changes one issue: exactly 1 changed issue; it is Done while its predecessors are open, so (R13 #5) it is
       held in review for its owner, not applied */
    const items = again.body.connection.sim.items;
    const docs = (await call('GET', `ws/${ws}/state`)).body.docs;
    const open = id => (docs.workItem.find(d => d.id === id) || {}).data;
    const key = Object.keys(items).find(k => { const w = open(items[k].pmoId); return w && w.status !== 'done' && w.kind !== 'defect' && !w.resolves && (w.deps || []).some(d => open(d) && open(d).status !== 'done'); });
    assert.ok(key, 'the seed has a task waiting on open work');
    const sim = await call('POST', `workspaces/${ws}/connections/${c.id}/sim`, { key, status: 'Done', actor: owner });
    assert.equal(sim.status, 200);
    const log = sim.body.connection.log;
    assert.equal(log.find(e => e.op === 'pull').detail, '1 changed issue since the last sync.');
    const flag = log.find(e => e.op === 'held' && e.kind === 'order');
    assert.ok(flag && flag.result === 'held' && flag.key === key, 'held row in the sync log');
    assert.match(flag.detail, /Finished before the work it depends on \(.+ still open\)/);
    assert.equal(sim.body.summary.received, 1); assert.equal(sim.body.summary.held, 1); assert.equal(sim.body.summary.early, 1);
    assert.match(sim.body.sentence, /1 task updated from Jira · 1 Done held for review in PMOFlow \(1 finished before the work it depends on\)/);
    const after = (await call('GET', `ws/${ws}/state`)).body.docs;
    assert.notEqual(after.workItem.find(d => d.id === items[key].pmoId).data.status, 'done', 'held, not applied');
    const evs = (await call('GET', `ws/${ws}/events`)).body.events;
    assert.ok(evs.some(e => /finished before the work it depends on/i.test(e.summary)), 'recorded in history');
  } finally {
    await store.deleteWorkspace(ws).catch(() => {});
    if (saved !== undefined) process.env.EMCEE_STORAGE_CONNECTION = saved;
  }
});

/* ---------- R12 H4 (CONSOLIDATED-R11 #3): sync can never bypass governance ----------
   The PMO expert's repro: moving issues to Done in Jira closed a defect while its test was still failing, marked
   "Bank remittance details" confirmed live with no evidence, flipped the project to On track, cut the expected cost,
   and recorded all of it under the PM. Inbound changes may move a work item's status only. */
const strip = (docs) => JSON.parse(JSON.stringify(docs));
/* every doc, with the one work item's status / doneAt / updatedAt taken out */
function without(docs, wid) {
  const d = strip(docs);
  d.workItem.forEach(x => { if (x.id === wid) { delete x.data.status; delete x.data.doneAt; delete x.data.firstDoneAt; delete x.data.updatedAt; delete x.data.syncHold; } });
  delete d.connection;
  return d;
}
const cost = (docs) => E.projectFinancials(docs, PRJ, DAY).forecastCost;

test('R12 guardrail 1: an inbound Done never closes a defect (it waits in review)', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  assert.equal(wi(docs, 'W12').kind, 'defect');
  assert.notEqual(E.defectState(docs, 'W12'), 'closed');
  const k = S.keyOf(conn, 'W12');
  S.simEdit(conn.sim, k, { status: 'Done' }, clock(), 'leo.park@northwind.example');
  const { res, sent } = sync(docs, conn);
  assert.notEqual(wi(docs, 'W12').status, 'done', 'the defect is not closed from Jira');
  assert.notEqual(E.defectState(docs, 'W12'), 'closed');
  assert.equal(wi(docs, 'W12').status, 'review', 'it moves to In review, waiting for its retest');
  assert.equal(res.held.length, 1);
  assert.equal(res.held[0].workItemId, 'W12');
  assert.equal(res.held[0].kind, 'problem');
  assert.match(res.held[0].reason, /retest/);
  assert.ok(!sent.some(i => i.ref.workItemId === 'W12'), 'Jira keeps its own Done; nothing is pushed back');
  /* a second sync with nothing new does not log it again */
  assert.equal(sync(docs, conn).res.held.length, 0);
  /* ADO "Closed" and a custom status that means done are held too */
  const a = fresh('ado');
  sync(a.docs, a.conn);
  S.simEdit(a.conn.sim, S.keyOf(a.conn, 'W12'), { status: 'Closed' }, clock());
  sync(a.docs, a.conn);
  assert.notEqual(E.defectState(a.docs, 'W12'), 'closed');
  const c = fresh('jira');
  c.docs.project.find(d => d.id === PRJ).data.statuses.push({ id: 'shipped', name: 'Shipped', maps: 'done' });
  c.conn.statusMap.shipped = 'Shipped';
  sync(c.docs, c.conn);
  S.simEdit(c.conn.sim, S.keyOf(c.conn, 'W12'), { status: 'Shipped' }, clock());
  sync(c.docs, c.conn);
  assert.equal(wi(c.docs, 'W12').status, 'review', 'a status that maps to done is held the same way');
});

test('R12 guardrail 2: an inbound Done never marks information available', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  assert.equal(wi(docs, 'W6').resolves, 'D2');
  const before = E.effectiveAvail(docs, 'D2');
  assert.notEqual(before, 'live');
  S.simEdit(conn.sim, S.keyOf(conn, 'W6'), { status: 'Done' }, clock(), 'leo.park@northwind.example');
  const { res } = sync(docs, conn);
  assert.equal(E.effectiveAvail(docs, 'D2'), before, 'availability is unchanged');
  assert.notEqual(wi(docs, 'W6').status, 'done');
  assert.equal(wi(docs, 'W6').status, 'review');
  assert.equal(res.held[0].kind, 'information');
  assert.match(res.held[0].reason, /Bank remittance details/);
  assert.match(res.held[0].reason, /confirm/i);
  const d2 = docs.dataElement.find(d => d.id === 'D2').data;
  assert.ok(!d2.liveConfirmedBy && d2.avail !== 'live', 'the information record itself is never touched');
  /* W6's owner is the information owner, so a done W6 would count as their confirmation in PMOFlow: still held. The project
     status is exactly what the same task in review gives (it does not flip to On track) */
  const byHand = strip(fresh('jira').docs); setWi(byHand, 'W6', { status: 'review' });
  assert.equal(E.projectTruth(docs, PRJ, DAY).label, E.projectTruth(byHand, PRJ, DAY).label);
});

test('R12 guardrail 3: an inbound Done changes the expected cost only through the work item status', () => {
  /* a plain task: the result equals marking the same task done in PMOFlow, and nothing else in the workspace changes */
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  const manual = strip(docs);
  setWi(manual, 'W11', { status: 'done', doneAt: DAY });
  const beforeDocs = strip(docs);
  S.simEdit(conn.sim, S.keyOf(conn, 'W11'), { status: 'Done' }, clock());
  sync(docs, conn);
  assert.equal(cost(docs), cost(manual), 'same expected cost as marking it done in PMOFlow');
  assert.deepEqual(without(docs, 'W11'), without(beforeDocs, 'W11'), 'nothing but W11 status / done date changed');
  /* guarded items: the expected cost equals the same item set to In review by hand, and nothing else changed */
  for (const wid of ['W12', 'W6']) {
    const f = fresh('jira');
    sync(f.docs, f.conn);
    const pre = strip(f.docs);
    const byHand = strip(f.docs); setWi(byHand, wid, { status: 'review' });
    S.simEdit(f.conn.sim, S.keyOf(f.conn, wid), { status: 'Done' }, clock());
    sync(f.docs, f.conn);
    assert.equal(cost(f.docs), cost(byHand), `${wid}: expected cost moves only with the status`);
    assert.deepEqual(without(f.docs, wid), without(pre, wid), `${wid}: no other document changed`);
    assert.equal(wi(f.docs, wid).doneAt, undefined);
  }
  /* titles, notes and owners still sync, and never touch cost-bearing fields (effort, rates, budget) */
  const g = fresh('jira');
  sync(g.docs, g.conn);
  const pre = strip(g.docs);
  S.simEdit(g.conn.sim, S.keyOf(g.conn, 'W11'), { title: 'Route invoices by amount' }, clock());
  sync(g.docs, g.conn);
  assert.equal(cost(g.docs), cost(pre));
});

test('R12 guardrail 4 (route): audit entries name the external identity, never the PM; the early-Done flag stays', async () => {
  const saved = process.env.EMCEE_STORAGE_CONNECTION; delete process.env.EMCEE_STORAGE_CONNECTION;
  const fn = require(path.join(ROOT, 'api', 'pmoflow', 'index.js'));
  const store = require(path.join(ROOT, 'api', 'shared', 'pmoflow-store.js'));
  const ws = (await store.createWorkspace('sync-r12-' + Date.now(), {})).id;
  const call = async (method, p, body) => { const ctx = { res: null, log: Object.assign(() => {}, { error() {}, warn() {}, info() {} }) };
    await fn(ctx, { method, url: '/api/pmoflow/' + p, headers: { 'x-forwarded-for': '10.9.9.8' }, params: { path: p }, query: {}, body }); return ctx.res; };
  try {
    const st0 = (await call('GET', `ws/${ws}/state`)).body.docs;
    const pm = st0.project.find(d => d.id === PRJ).data.owner;
    const r = await call('POST', `workspaces/${ws}/connections`, { projectId: PRJ, tool: 'jira', site: 'northwind.atlassian.net', projectKey: 'VOM', actor: pm });
    assert.equal(r.status, 201);
    const c = r.body.connection, items = c.sim.items;
    const keyOf = wid => Object.keys(items).find(k => items[k].pmoId === wid);
    const stateBefore = (await call('GET', `ws/${ws}/state`)).body.docs;
    const costBefore = E.projectFinancials(stateBefore, PRJ, DAY).forecastCost;
    /* the PM is the persona clicking in the simulated Jira; the person who moved it in Jira is jane */
    const s1 = await call('POST', `workspaces/${ws}/connections/${c.id}/sim`, { key: keyOf('W12'), status: 'Done', by: 'jane@contoso.example', actor: pm });
    assert.equal(s1.status, 200);
    assert.ok(s1.body.connection.log.some(e => e.op === 'held' && e.workItemId === 'W12' && e.result === 'held'), 'held row in the sync log');
    assert.match(s1.body.sentence, /1 Done held for review in PMOFlow/);
    const s2 = await call('POST', `workspaces/${ws}/connections/${c.id}/sim`, { key: keyOf('W6'), status: 'Done', actor: pm });
    assert.equal(s2.status, 200);
    const docs = (await call('GET', `ws/${ws}/state`)).body.docs;
    assert.notEqual(E.defectState(docs, 'W12'), 'closed', 'defect not closed');
    assert.notEqual(E.effectiveAvail(docs, 'D2'), 'live', 'information not available');
    assert.equal(docs.dataElement.find(d => d.id === 'D2').data.avail, stateBefore.dataElement.find(d => d.id === 'D2').data.avail);
    const costAfter = E.projectFinancials(docs, PRJ, DAY).forecastCost;
    const byHand = strip(stateBefore); setWi(byHand, 'W12', { status: 'review' }); setWi(byHand, 'W6', { status: 'review' });
    assert.equal(costAfter, E.projectFinancials(byHand, PRJ, DAY).forecastCost, `expected cost moves only with the status (${costBefore} → ${costAfter})`);
    /* approvals, tests and test runs are never written by sync */
    for (const t of ['approval', 'testRun', 'testCase', 'uatScript', 'grant', 'dataElement']) assert.deepEqual(docs[t], stateBefore[t], `${t} untouched by sync`);
    const evs = (await call('GET', `ws/${ws}/events`)).body.events;
    const fromTool = evs.filter(e => /^From Jira VOM-/.test(e.summary) || e.action === 'tool-change');
    assert.ok(fromTool.length >= 4, 'tool changes are in history');
    assert.ok(fromTool.every(e => e.actor !== pm), 'never recorded under the PM');
    assert.ok(fromTool.every(e => /^Jira: /.test(e.actor)), 'recorded under the Jira identity: ' + fromTool.map(e => e.actor).join(', '));
    assert.ok(fromTool.some(e => e.actor === 'Jira: jane@contoso.example' && /W12|blank account holder/.test(e.summary + e.ref)), 'the person who moved it in Jira');
    assert.ok(fromTool.some(e => e.actor === 'Jira: leo.park@northwind.example'), 'without "by", the Jira assignee moved it');
    /* audit export shows the external identity as the actor name */
    const audit = (await call('GET', `workspaces/${ws}/admin/audit`)).body;
    assert.ok(audit.entries.some(e => e.actor === 'Jira: jane@contoso.example' && e.actorName === 'Jira: jane@contoso.example'));
    /* "Finished before the work it depends on" stays flagged across later syncs */
    const w = docs.workItem.find(d => d.data.projectId === PRJ && d.data.kind !== 'defect' && !d.data.resolves && d.data.status !== 'done' &&
      (d.data.deps || []).some(id => { const p = docs.workItem.find(x => x.id === id); return p && p.data.status !== 'done'; }));
    assert.ok(w, 'a plain task waiting on open work');
    const s3 = await call('POST', `workspaces/${ws}/connections/${c.id}/sim`, { key: keyOf(w.id), status: 'Done', actor: pm });
    assert.equal(s3.body.summary.early, 1);
    const again = await call('POST', `workspaces/${ws}/connections/${c.id}/sync`, { actor: pm });
    assert.equal(again.status, 200);
    const later = (await call('GET', `ws/${ws}/state`)).body.docs;
    const lw = later.workItem.find(d => d.id === w.id).data;
    assert.ok(lw.status !== 'done' && lw.syncHold && lw.syncHold.kind === 'order', 'still held and flagged after another sync');
    const flagEv = (await call('GET', `ws/${ws}/events`)).body.events.find(e => /finished before the work it depends on/i.test(e.summary));
    assert.ok(flagEv && /^Jira: /.test(flagEv.actor), 'the flag is recorded under the Jira identity');
  } finally {
    await store.deleteWorkspace(ws).catch(() => {});
    if (saved !== undefined) process.env.EMCEE_STORAGE_CONNECTION = saved;
  }
});

/* ---------- R13 K4 (CONSOLIDATED-R12 #5, sync side) ----------
   The PMO expert's repro: an out-of-order Done (VOM-8, predecessor still open) moved EAC $48.8k→$37.0k and pulled the finish
   date in; the warning was only in the sync log. Held, out-of-order or unverified inbound statuses must not move the
   forecast or EV, and each held item is flagged for the person who confirms it (the queue entry is K1's personQueue). */
test('R13 #5: an out-of-order Done (predecessor still open) is held in review, never applied', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  assert.deepEqual(wi(docs, 'W7').deps, ['W6']);
  assert.notEqual(wi(docs, 'W6').status, 'done');
  const pre = strip(docs);
  const byHand = strip(docs); setWi(byHand, 'W7', { status: 'review' });
  S.simEdit(conn.sim, S.keyOf(conn, 'W7'), { status: 'Done' }, clock(), 'dan.kim@northwind.example');
  const { res, sent } = sync(docs, conn);
  assert.equal(wi(docs, 'W7').status, 'review', 'held in review, not Done');
  assert.equal(wi(docs, 'W7').doneAt, undefined);
  assert.equal(res.held.length, 1);
  assert.equal(res.held[0].kind, 'order');
  assert.match(res.held[0].reason, /Set up the bank details form/);
  assert.deepEqual(res.held[0].open, ['W6']);
  assert.equal(cost(docs), cost(byHand), 'expected cost is what the same task in review gives');
  assert.equal(E.projectTruth(docs, PRJ, DAY).label, E.projectTruth(byHand, PRJ, DAY).label);
  assert.deepEqual(without(docs, 'W7'), without(pre, 'W7'), 'nothing else changed');
  assert.ok(!sent.some(i => i.ref.workItemId === 'W7'), 'Jira keeps its own Done');
  assert.equal(sync(docs, conn).res.held.length, 0, 'not held twice for the same Done');
  /* predecessor and successor Done in the same pull, predecessor first: the predecessor is plain and applies, so the
     successor's work is finished in order and applies too */
  const f = fresh('jira');
  sync(f.docs, f.conn);
  setWi(f.docs, 'W6', { resolves: undefined });
  ['W6', 'W7'].forEach(id => S.simEdit(f.conn.sim, S.keyOf(f.conn, id), { status: 'Done' }, clock()));
  const r2 = sync(f.docs, f.conn).res;
  assert.equal(wi(f.docs, 'W6').status, 'done'); assert.equal(wi(f.docs, 'W7').status, 'done');
  assert.equal(r2.held.length, 0);
  /* a task with no open predecessors is applied as before (W11) */
  const g = fresh('jira');
  sync(g.docs, g.conn);
  S.simEdit(g.conn.sim, S.keyOf(g.conn, 'W11'), { status: 'Done' }, clock());
  assert.equal(sync(g.docs, g.conn).res.held.length, 0);
  assert.equal(wi(g.docs, 'W11').status, 'done');
});

test('R13 #5: every held item is flagged on the work item for the person who confirms it', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  const now = clock();
  S.simEdit(conn.sim, S.keyOf(conn, 'W12'), { status: 'Done' }, now, 'jane@contoso.example');
  S.simEdit(conn.sim, S.keyOf(conn, 'W6'), { status: 'Done' }, clock());
  S.simEdit(conn.sim, S.keyOf(conn, 'W8'), { status: 'Done' }, clock());
  const { res } = sync(docs, conn);
  assert.equal(res.held.length, 3);
  const h = id => wi(docs, id).syncHold;
  /* the problem: its owner confirms the retest */
  assert.equal(h('W12').kind, 'problem'); assert.equal(h('W12').confirmBy, 'lp');
  assert.equal(h('W12').tool, 'Jira'); assert.equal(h('W12').key, S.keyOf(conn, 'W12')); assert.equal(h('W12').toolStatus, 'Done');
  assert.equal(h('W12').by, 'jane@contoso.example'); assert.ok(h('W12').at);
  assert.match(h('W12').reason, /retest/);
  /* information: the information's owner confirms it */
  assert.equal(h('W6').kind, 'information'); assert.equal(h('W6').confirmBy, docs.dataElement.find(d => d.id === 'D2').data.owner);
  assert.equal(h('W6').dataId, 'D2');
  /* out of order: the task's owner checks the order */
  assert.equal(h('W8').kind, 'order'); assert.equal(h('W8').confirmBy, 'dk'); assert.deepEqual(h('W8').open, ['W6']);
  res.held.forEach(x => assert.equal(x.confirmBy, h(x.workItemId).confirmBy, 'the result names the same person'));
  /* an unowned task is never attributed to the PM: confirmBy is null */
  const u = fresh('jira');
  sync(u.docs, u.conn);
  setWi(u.docs, 'W7', { owner: null });
  S.simEdit(u.conn.sim, S.keyOf(u.conn, 'W7'), { status: 'Done' }, clock());
  sync(u.docs, u.conn);
  assert.equal(wi(u.docs, 'W7').syncHold.confirmBy, null);
  /* the tool moves it back off Done: the flag clears */
  S.simEdit(conn.sim, S.keyOf(conn, 'W8'), { status: 'In Progress' }, clock());
  sync(docs, conn);
  assert.equal(wi(docs, 'W8').syncHold, undefined, 'no longer held once the tool takes its Done back');
  assert.equal(wi(docs, 'W8').status, 'prog');
});

test('R13 #5 (route): held out-of-order Done is logged, named for its owner, and never moves the forecast', async () => {
  const saved = process.env.EMCEE_STORAGE_CONNECTION; delete process.env.EMCEE_STORAGE_CONNECTION;
  const fn = require(path.join(ROOT, 'api', 'pmoflow', 'index.js'));
  const store = require(path.join(ROOT, 'api', 'shared', 'pmoflow-store.js'));
  const ws = (await store.createWorkspace('sync-r13-' + Date.now(), {})).id;
  const call = async (method, p, body) => { const ctx = { res: null, log: Object.assign(() => {}, { error() {}, warn() {}, info() {} }) };
    await fn(ctx, { method, url: '/api/pmoflow/' + p, headers: { 'x-forwarded-for': '10.9.9.7' }, params: { path: p }, query: {}, body }); return ctx.res; };
  try {
    const st0 = (await call('GET', `ws/${ws}/state`)).body.docs;
    const pm = st0.project.find(d => d.id === PRJ).data.owner;
    const r = await call('POST', `workspaces/${ws}/connections`, { projectId: PRJ, tool: 'jira', site: 'northwind.atlassian.net', projectKey: 'VOM', actor: pm });
    const c = r.body.connection, items = c.sim.items;
    const keyOf = wid => Object.keys(items).find(k => items[k].pmoId === wid);
    const pre = (await call('GET', `ws/${ws}/state`)).body.docs;
    const fin = E.forecastAll ? JSON.stringify(E.forecastAll(pre, DAY)) : null;
    const s = await call('POST', `workspaces/${ws}/connections/${c.id}/sim`, { key: keyOf('W8'), status: 'Done', by: 'dan.kim@northwind.example', actor: pm });
    assert.equal(s.status, 200);
    const row = s.body.connection.log.find(e => e.op === 'held' && e.workItemId === 'W8');
    assert.ok(row && row.result === 'held' && row.kind === 'order', 'held row for the out-of-order Done');
    assert.equal(row.confirmBy, 'dk');
    assert.match(row.detail, /Set up the bank details form/);
    assert.match(row.detail, /Dev Kumar/, 'the log names who confirms it');
    assert.match(s.body.sentence, /1 Done held for review in PMOFlow \(1 finished before the work it depends on\)/);
    assert.equal(s.body.summary.received, 1);
    const docs = (await call('GET', `ws/${ws}/state`)).body.docs;
    const w8 = docs.workItem.find(d => d.id === 'W8').data;
    assert.equal(w8.status, 'review'); assert.equal(w8.syncHold.confirmBy, 'dk');
    const byHand = strip(pre); setWi(byHand, 'W8', { status: 'review' });
    assert.equal(cost(docs), cost(byHand), 'expected cost moves only with the held status');
    if (fin) assert.equal(JSON.stringify(E.forecastAll(docs, DAY)), JSON.stringify(E.forecastAll(byHand, DAY)), 'forecast equals the task in review by hand');
    const evs = (await call('GET', `ws/${ws}/events`)).body.events;
    assert.ok(evs.some(e => e.action === 'sync-held' && /^Jira: /.test(e.actor) && /Dev Kumar/.test(e.summary)), 'history says who confirms it');
  } finally {
    await store.deleteWorkspace(ws).catch(() => {});
    if (saved !== undefined) process.env.EMCEE_STORAGE_CONNECTION = saved;
  }
});

/* ---------- R14 L4 #1: an inbound due date that breaches the deadline is held as a plan change request ---------- */
test('R14 L4 #1: an inbound due date past the deadline is held as a plan change request, never applied', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  const k = S.keyOf(conn, 'W7'), due = wi(docs, 'W7').due;
  const target = docs.project.find(d => d.id === PRJ).data.target;
  S.simEdit(conn.sim, k, { due: '2027-01-15' }, clock(), 'dev.kumar@northwind.example');
  const { res, sent } = sync(docs, conn);
  assert.equal(res.ignored.length, 0, 'not silently put back');
  assert.equal(res.planChanges.length, 1, 'one plan change request');
  const pc = res.planChanges[0];
  assert.equal(pc.workItemId, 'W7'); assert.equal(pc.field, 'due'); assert.equal(pc.from, due); assert.equal(pc.to, '2027-01-15');
  assert.equal(pc.by, 'dev.kumar@northwind.example');
  assert.match(pc.reason, /deadline/);
  assert.ok(target < pc.to);
  assert.equal(wi(docs, 'W7').due, due, 'the PMOFlow date never moves');
  assert.ok(!res.updates.some(u => u.workItemId === 'W7' && u.changes.some(c => c.field === 'due')));
  /* PMOFlow keeps owning the date: the tool shows PMOFlow's date until the change is approved */
  assert.ok(sent.some(i => i.op === 'update' && i.changed.includes('due')));
  assert.equal(conn.sim.items[k].due, due);
});

test('R14 L4 #1: the route can decide the breach with the engine (dueCheck); no breach means put back', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  const k = S.keyOf(conn, 'W7');
  S.simEdit(conn.sim, k, { due: '2026-12-31' }, clock());
  const pull = S.simExecute(conn, conn.sim, S.pullIntent(conn, { nonce }), clock());
  const asked = [];
  const res = S.applyInbound(conn, docs, pull.changes, { today: DAY, now: clock(),
    dueCheck: (wid, to, from) => { asked.push([wid, to, from]); return { breach: false }; } });
  assert.deepEqual(asked, [['W7', '2026-12-31', wi(docs, 'W7').due]]);
  assert.equal(res.planChanges.length, 0); assert.equal(res.ignored.length, 1);
  S.simEdit(conn.sim, k, { due: '2026-12-02' }, clock());
  const pull2 = S.simExecute(conn, conn.sim, S.pullIntent(conn, { nonce }), clock());
  const res2 = S.applyInbound(conn, docs, pull2.changes, { today: DAY, now: clock(),
    dueCheck: () => ({ breach: true, reason: 'This moves the expected finish past the deadline.' }) });
  assert.equal(res2.planChanges.length, 1);
  assert.equal(res2.planChanges[0].reason, 'This moves the expected finish past the deadline.');
});

test('R14 L4 #1 (route): the tool date past the deadline becomes a proposed plan change for the sponsor; dates never move', async () => {
  const saved = process.env.EMCEE_STORAGE_CONNECTION; delete process.env.EMCEE_STORAGE_CONNECTION;
  const fn = require(path.join(ROOT, 'api', 'pmoflow', 'index.js'));
  const store = require(path.join(ROOT, 'api', 'shared', 'pmoflow-store.js'));
  const ws = (await store.createWorkspace('sync-r14-' + Date.now(), {})).id;
  const call = async (method, p, body) => { const ctx = { res: null, log: Object.assign(() => {}, { error() {}, warn() {}, info() {} }) };
    await fn(ctx, { method, url: '/api/pmoflow/' + p, headers: { 'x-forwarded-for': '10.9.9.6' }, params: { path: p }, query: {}, body }); return ctx.res; };
  try {
    const st0 = (await call('GET', `ws/${ws}/state`)).body.docs;
    const prj = st0.project.find(d => d.id === PRJ).data, pm = prj.owner;
    const r = await call('POST', `workspaces/${ws}/connections`, { projectId: PRJ, tool: 'jira', site: 'northwind.atlassian.net', projectKey: 'VOM', actor: pm });
    const c = r.body.connection, items = c.sim.items;
    const keyOf = wid => Object.keys(items).find(k => items[k].pmoId === wid);
    const pre = (await call('GET', `ws/${ws}/state`)).body.docs;
    const due0 = pre.workItem.find(d => d.id === 'W7').data.due;
    const fin0 = E.projectTruth(pre, PRJ, DAY).forecastFinish;
    const s = await call('POST', `workspaces/${ws}/connections/${c.id}/sim`, { key: keyOf('W7'), due: '2027-01-15', by: 'dev.kumar@northwind.example', actor: pm });
    assert.equal(s.status, 200);
    assert.match(s.body.sentence, /1 date change past the deadline sent to Change the plan/);
    assert.equal(s.body.summary.planChanges, 1);
    const row = s.body.connection.log.find(e => e.op === 'plan-change' && e.workItemId === 'W7');
    assert.ok(row && row.result === 'held', 'a held plan-change row in the sync log');
    assert.match(row.detail, /Change the plan/);
    assert.match(row.detail, /approv/i);
    const docs = (await call('GET', `ws/${ws}/state`)).body.docs;
    assert.equal(docs.workItem.find(d => d.id === 'W7').data.due, due0, 'the due date did not move');
    assert.equal(E.projectTruth(docs, PRJ, DAY).forecastFinish, fin0, 'the forecast did not move');
    const pcs = (docs.planChange || []).map(d => d.data).filter(x => x.projectId === PRJ && x.source === 'sync');
    assert.equal(pcs.length, 1, 'one proposed plan change');
    const pc = pcs[0];
    assert.equal(pc.status, 'proposed');
    assert.deepEqual(pc.edits.map(e => [e.id, e.field, e.from, e.to]), [['W7', 'due', due0, '2027-01-15']]);
    /* R15 (M1 #3): the stored sponsor approves; with no sponsor set, an Admin who is not the requester */
    const deciders = ['sponsor', 'admin'];
    assert.ok(pc.approvers.some(a => deciders.includes(a.role) || (a.roles || []).some(x => deciders.includes(x.role))), 'the sponsor (or, with none set, an Admin) approves: ' + JSON.stringify(pc.approvers));
    assert.ok(pc.approvers.every(a => a.person !== pc.requestedBy), 'the requester never approves');
    assert.equal(pc.fromSync.key, keyOf('W7'));
    assert.equal(pc.fromSync.by, 'dev.kumar@northwind.example');
    assert.equal(pc.requestedBy, 'dk', 'requested by the person mapped from the tool email');
    const evs = (await call('GET', `ws/${ws}/events`)).body.events;
    assert.ok(evs.some(e => e.action === 'sync-plan-change' && /^Jira: dev\.kumar@/.test(e.actor)), 'history credits the tool identity');
    assert.ok((docs.notification || []).some(n => pc.approvers.some(a => a.person === n.data.to) && /plan change/.test(n.data.text)), 'approvers are told');
    /* the tool shows PMOFlow's date again; the same date set again does not open a second request */
    const s2 = await call('POST', `workspaces/${ws}/connections/${c.id}/sim`, { key: keyOf('W7'), due: '2027-01-15', by: 'dev.kumar@northwind.example', actor: pm });
    assert.equal(s2.status, 200);
    const docs2 = (await call('GET', `ws/${ws}/state`)).body.docs;
    assert.equal((docs2.planChange || []).filter(d => d.data.source === 'sync').length, 1, 'no duplicate request');
    assert.match(s2.body.connection.log.find(e => e.op === 'plan-change').detail, /already waiting/);
    /* a date inside the deadline is simply put back */
    /* lead: never a hardcoded day — the seed follows the clock, so pick a date that differs from W7's due and stays inside the deadline */
    const w7 = docs2.workItem.find(d => d.id === 'W7').data, prjDl = docs2.project.find(d => d.id === w7.projectId).data.target;
    const nextDay = iso => { const t = new Date(iso + 'T12:00:00Z'); do { t.setUTCDate(t.getUTCDate() + 1); } while ([0, 6].includes(t.getUTCDay())); return t.toISOString().slice(0, 10); };
    const inside = nextDay(w7.due);
    assert.ok(!prjDl || inside <= prjDl, 'the test date stays inside the deadline: ' + inside + ' vs ' + prjDl);
    const s3 = await call('POST', `workspaces/${ws}/connections/${c.id}/sim`, { key: keyOf('W7'), due: inside, actor: pm });
    assert.equal(s3.body.summary.ignored, 1);
    assert.equal(s3.body.summary.planChanges || 0, 0);
  } finally {
    await store.deleteWorkspace(ws).catch(() => {});
    if (saved !== undefined) process.env.EMCEE_STORAGE_CONNECTION = saved;
  }
});

/* ---------- R15 M4 #3a (PMO R14 audit): a Jira Done → reopen → Done round trip keeps the first completion date ---------- */
test('R15: Done, reopened, Done again keeps the first completion date (doneAt never moves later)', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  const k = S.keyOf(conn, 'W11');
  const pass = today => {
    const pull = S.simExecute(conn, conn.sim, S.pullIntent(conn, { nonce }), clock());
    const res = S.applyInbound(conn, docs, pull.changes, { today, now: clock() });
    conn.cursor = pull.cursor || conn.cursor;
    res.updates.forEach(u => { docs.workItem.find(d => d.id === u.workItemId).data = u.data; });
    return res;
  };
  S.simEdit(conn.sim, k, { status: 'Done' }, clock()); pass('2026-11-17');
  assert.equal(wi(docs, 'W11').status, 'done'); assert.equal(wi(docs, 'W11').doneAt, '2026-11-17');
  assert.equal(wi(docs, 'W11').firstDoneAt, '2026-11-17', 'the first completion date is kept on the task');
  S.simEdit(conn.sim, k, { status: 'In Progress' }, clock()); pass('2026-11-19');
  assert.equal(wi(docs, 'W11').status, 'prog'); assert.equal(wi(docs, 'W11').doneAt, undefined, 'not done: no done date');
  assert.equal(wi(docs, 'W11').firstDoneAt, '2026-11-17', 'reopening keeps the first completion date');
  S.simEdit(conn.sim, k, { status: 'Done' }, clock()); pass('2026-11-24');
  assert.equal(wi(docs, 'W11').doneAt, '2026-11-17', 're-Done takes the first completion date back, never the later one');
  /* a task done in PMOFlow before it was ever synced (W1, done Oct 30 in the seed) keeps its own date too */
  assert.equal(wi(docs, 'W1').doneAt, '2026-10-30');
  S.simEdit(conn.sim, S.keyOf(conn, 'W1'), { status: 'In Progress' }, clock()); pass('2026-11-18');
  assert.equal(wi(docs, 'W1').status, 'prog'); assert.equal(wi(docs, 'W1').firstDoneAt, '2026-10-30');
  S.simEdit(conn.sim, S.keyOf(conn, 'W1'), { status: 'Done' }, clock()); pass('2026-11-25');
  assert.equal(wi(docs, 'W1').doneAt, '2026-10-30', 'the reopen round trip never overwrites Oct 30');
});

/* ---------- R15 M4 #3b (PMO R14 disagreement 5): the "N dependency links" count is the plan's links ---------- */
test('R15: the first sync says how many dependency links the plan has (6), on how many issues (5)', async () => {
  const saved = process.env.EMCEE_STORAGE_CONNECTION; delete process.env.EMCEE_STORAGE_CONNECTION;
  const fn = require(path.join(ROOT, 'api', 'pmoflow', 'index.js'));
  const store = require(path.join(ROOT, 'api', 'shared', 'pmoflow-store.js'));
  const ws = (await store.createWorkspace('sync-r15-' + Date.now(), {})).id;
  const call = async (method, p, body) => { const ctx = { res: null, log: Object.assign(() => {}, { error() {}, warn() {}, info() {} }) };
    await fn(ctx, { method, url: '/api/pmoflow/' + p, headers: { 'x-forwarded-for': '10.9.9.15' }, params: { path: p }, query: {}, body }); return ctx.res; };
  try {
    const docs = (await call('GET', `ws/${ws}/state`)).body.docs;
    const items = docs.workItem.filter(d => d.data.projectId === PRJ);
    const ids = new Set(items.map(d => d.id));
    const planLinks = items.reduce((n, d) => n + (d.data.deps || []).map(x => (typeof x === 'string' ? x : x.id)).filter(x => ids.has(x)).length, 0);
    const withLinks = items.filter(d => (d.data.deps || []).length).length;
    assert.equal(planLinks, 6); assert.equal(withLinks, 5);
    const owner = docs.project.find(d => d.id === PRJ).data.owner;
    const r = await call('POST', `workspaces/${ws}/connections`, { projectId: PRJ, tool: 'jira', site: 'northwind.atlassian.net', projectKey: 'VOM', actor: owner });
    assert.equal(r.status, 201);
    const sum = r.body.sync.summary;
    assert.equal(sum.links, planLinks, 'links set = the plan’s dependency links');
    assert.equal(sum.linked, withLinks, 'one Link row per issue in the sync log');
    assert.equal(r.body.sync.sentence, `13 issues created in Jira · ${planLinks} dependency links set on ${withLinks} issues in Jira`);
    /* the simulated Jira holds exactly the plan's links */
    const sim = r.body.connection.sim.items;
    assert.equal(Object.values(sim).reduce((n, it) => n + (it.deps || []).length, 0), planLinks);
    /* one link removed and one added later: "1 dependency link set in Jira" counts the one added */
    const w10 = docs.workItem.find(d => d.id === 'W10').data;
    const put = await call('PUT', `ws/${ws}/doc/workItem/W10`, { actor: w10.owner || owner, data: Object.assign({}, w10, { deps: ['W6', 'W8', 'W9'] }) });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const again = await call('POST', `workspaces/${ws}/connections/${r.body.connection.id}/sync`, { actor: owner });
    assert.equal(again.body.summary.links, 1); assert.match(again.body.sentence, /(^| · )1 dependency link set in Jira($| · )/);
  } finally {
    await store.deleteWorkspace(ws).catch(() => {});
    if (saved !== undefined) process.env.EMCEE_STORAGE_CONNECTION = saved;
  }
});

/* ---------- R16 N4 #5 (PMO R15 re-test 1): clearing a held Jira item routes through the open-predecessor warning ---------- */
test('R16: clearHold gives the engine’s open-predecessor warning, clears the flag, and leaves the Done unconfirmed (out of EV)', () => {
  const { docs, conn } = fresh('jira');
  sync(docs, conn);
  S.simEdit(conn.sim, S.keyOf(conn, 'W8'), { status: 'Done' }, clock());
  sync(docs, conn);
  assert.equal(wi(docs, 'W8').syncHold.kind, 'order');
  /* only the person the hold names confirms it */
  let r = S.clearHold(docs, 'W8', 'ta', { engine: E, today: DAY });
  assert.equal(r.ok, false); assert.match(r.error, /Dev Kumar confirms/);
  r = S.clearHold(docs, 'W8', 'dk', { engine: E, today: DAY });
  assert.equal(r.ok, true, r.error);
  const want = typeof E.holdClearWarning === 'function' ? E.holdClearWarning(docs, wi(docs, 'W8')) : E.unconfirmedDone(docs, Object.assign({}, wi(docs, 'W8'), { status: 'done' })).confirmText;
  assert.ok(want, 'the fixture has an open predecessor');
  assert.equal(r.warning, want, 'the same words as the PM confirm');
  assert.deepEqual(r.open.map(o => o.id), ['W6']);
  assert.equal(r.data.status, 'done'); assert.equal(r.data.syncHold, undefined);
  assert.equal(r.data.doneBy, 'dk'); assert.equal(r.data.doneAt, DAY); assert.ok(!r.data.confirmedBy, 'not confirmed by the doer');
  assert.equal(r.data.holdCleared.by, 'dk'); assert.equal(r.data.holdCleared.kind, 'order'); assert.equal(r.data.holdCleared.key, S.keyOf(conn, 'W8'));
  /* applied: the task is Done but unconfirmed, so it earns nothing until someone else confirms it */
  const after = JSON.parse(JSON.stringify(docs)); after.workItem.find(d => d.id === 'W8').data = r.data;
  const uc = E.unconfirmedDone(after, 'W8');
  assert.equal(uc.flag, true); assert.ok(uc.reasons.includes('open-predecessor'));
  /* the next sync keeps PMOFlow's Done and does not hold it again (the tool already says Done) */
  const { res } = sync(after, conn);
  assert.equal(res.held.length, 0, JSON.stringify(res.held));
  assert.equal(wi(after, 'W8').status, 'done'); assert.equal(wi(after, 'W8').syncHold, undefined);
  /* nothing open: no warning */
  const d2 = JSON.parse(JSON.stringify(docs)); setWi(d2, 'W6', { status: 'done', doneAt: DAY });
  assert.equal(S.clearHold(d2, 'W8', 'dk', { engine: E, today: DAY }).warning, '');
  /* only an out-of-order hold is cleared here: problems close on a passed retest, information on its owner's confirm */
  setWi(docs, 'W7', { syncHold: { kind: 'problem', confirmBy: 'lp', reason: 'x' }, status: 'review' });
  r = S.clearHold(docs, 'W7', 'lp', { engine: E, today: DAY });
  assert.equal(r.ok, false); assert.match(r.error, /retest/);
  assert.equal(S.clearHold(docs, 'W11', 'dk', { engine: E, today: DAY }).ok, false, 'not held');
});

test('R16 (route): clear-hold asks first when work is still open, and History says the Done waits for someone else', async () => {
  const saved = process.env.EMCEE_STORAGE_CONNECTION; delete process.env.EMCEE_STORAGE_CONNECTION;
  const fn = require(path.join(ROOT, 'api', 'pmoflow', 'index.js'));
  const store = require(path.join(ROOT, 'api', 'shared', 'pmoflow-store.js'));
  const ws = (await store.createWorkspace('sync-r16-' + Date.now(), {})).id;
  const call = async (method, p, body) => { const ctx = { res: null, log: Object.assign(() => {}, { error() {}, warn() {}, info() {} }) };
    await fn(ctx, { method, url: '/api/pmoflow/' + p, headers: { 'x-forwarded-for': '10.9.9.8' }, params: { path: p }, query: {}, body }); return ctx.res; };
  try {
    const st0 = (await call('GET', `ws/${ws}/state`)).body.docs;
    const pm = st0.project.find(d => d.id === PRJ).data.owner;
    const c = (await call('POST', `workspaces/${ws}/connections`, { projectId: PRJ, tool: 'jira', site: 'northwind.atlassian.net', projectKey: 'VOM', actor: pm })).body.connection;
    const key = Object.keys(c.sim.items).find(k => c.sim.items[k].pmoId === 'W8');
    await call('POST', `workspaces/${ws}/connections/${c.id}/sim`, { key, status: 'Done', by: 'dan.kim@northwind.example', actor: pm });
    let r = await call('POST', `workspaces/${ws}/connections/${c.id}/clear-hold`, { workItemId: 'W8', actor: pm });
    assert.equal(r.status, 403, 'the PM is not who confirms it'); assert.match(r.body.error, /Dev Kumar confirms/);
    r = await call('POST', `workspaces/${ws}/connections/${c.id}/clear-hold`, { workItemId: 'W8', actor: 'dk' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.needsConfirm, true, 'open work: asks first, changes nothing');
    assert.match(r.body.warning, /still open\. Confirm “.+” is done anyway\?$/);
    let w8 = (await call('GET', `ws/${ws}/state`)).body.docs.workItem.find(d => d.id === 'W8').data;
    assert.equal(w8.status, 'review'); assert.ok(w8.syncHold);
    r = await call('POST', `workspaces/${ws}/connections/${c.id}/clear-hold`, { workItemId: 'W8', actor: 'dk', confirmOpen: true });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.cleared, true);
    const docs = (await call('GET', `ws/${ws}/state`)).body.docs;
    w8 = docs.workItem.find(d => d.id === 'W8').data;
    assert.equal(w8.status, 'done'); assert.equal(w8.syncHold, undefined); assert.equal(w8.doneBy, 'dk');
    assert.equal(E.unconfirmedDone(docs, 'W8').flag, true, 'out of EV until someone else confirms it');
    const evs = (await call('GET', `ws/${ws}/events`)).body.events;
    assert.ok(evs.some(e => e.actor === 'dk' && /^Cleared the Jira hold on “.+” \(VOM-\d+\): marked Done while “.+” is still open, so it counts only once someone else confirms it$/.test(e.summary)),
      evs.slice(0, 5).map(e => e.summary).join(' | '));
  } finally {
    await store.deleteWorkspace(ws).catch(() => {});
    if (saved !== undefined) process.env.EMCEE_STORAGE_CONNECTION = saved;
  }
});
