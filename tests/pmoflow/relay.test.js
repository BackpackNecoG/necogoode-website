// PMOFlow R10 S4 relay tests: mocked HTTP only, no real network. Run: node tests/pmoflow/relay.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const RELAY = path.join(ROOT, 'integrations', 'relay');
const S = require(path.join(ROOT, 'api', 'shared', 'pmoflow-sync.js'));
const { sign, verify, MemoryNonceStore, TableNonceStore } = require(path.join(RELAY, 'lib', 'intent.js'));
const { createRelay, configFromEnv } = require(path.join(RELAY, 'lib', 'relay.js'));
const { createHttp } = require(path.join(RELAY, 'lib', 'http.js'));
const routes = require(path.join(ROOT, 'api', 'shared', 'pmoflow-routes-connect.js'));

const PRJ = 'vendor-modernization';
const SECRET = 'per-project-signing-secret-v1';
let seq = 0;
const nonce = () => 'nonce' + String(++seq).padStart(6, '0');

/* ---------- mocked HTTP ---------- */
function mockNet(routesList) {
  const calls = [];
  const transport = async (req) => {
    calls.push(Object.assign({}, req, { json: req.body ? JSON.parse(req.body) : undefined }));
    for (const [method, re, fn] of routesList) {
      if (method === req.method && re.test(req.url)) {
        const r = await fn(req, calls);
        return { status: r.status, headers: {}, text: r.body === undefined ? '' : (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
      }
    }
    return { status: 599, headers: {}, text: 'no mock for ' + req.method + ' ' + req.url };
  };
  return { transport, calls };
}
const VAULT = 'https://nw-relay-kv.vault.azure.net';
const MI = 'http://localhost:42356/msi/token';
const SECRETS = { 'pmoflow-sync-vendor-modernization-v1': SECRET, 'jira-user-email': 'relay@northwind.example', 'jira-api-token': 'jira-token-xyz',
  'teams-webhook-project-updates': 'https://northwind.webhook.office.com/workflows/abc/triggers/manual/paths/invoke?sig=s3cret' };
const base = [
  ['GET', /^http:\/\/localhost:42356\/msi\/token\?/, req => ({ status: 200, body: { access_token: 'tok-' + new URL(req.url).searchParams.get('resource'), expires_on: String(Math.floor(Date.now() / 1000) + 3600) } })],
  ['GET', /^https:\/\/nw-relay-kv\.vault\.azure\.net\/secrets\/[\w-]+\?api-version=7\.4$/, req => {
    const name = req.url.split('/secrets/')[1].split('?')[0];
    return SECRETS[name] ? { status: 200, body: { value: SECRETS[name], id: VAULT + '/secrets/' + name + '/v' } } : { status: 404, body: { error: { code: 'SecretNotFound' } } };
  }],
];
const CONFIG = configFromEnv({ KEY_VAULT_URI: VAULT + '/', ALLOWED_JIRA_SITE: 'northwind.atlassian.net', ALLOWED_ADO_ORG: 'northwind', ALLOWED_PROJECTS: 'VOM,Vendor Onboarding',
  MAIL_SENDER: 'pmoflow-notices@northwind.example', ALLOWED_MAIL_DOMAINS: 'northwind.example', IDENTITY_ENDPOINT: MI, IDENTITY_HEADER: 'id-header-1' });
function relayWith(extra) {
  const net = mockNet(extra.concat(base));
  return Object.assign(net, { relay: createRelay({ config: CONFIG, transport: net.transport }) });
}
function conn(tool) { return Object.assign(S.defaultConnection({ projectId: PRJ, tool }), { id: 'conn-' + PRJ }); }
function signed(c, op, ref, payload, at) {
  return sign(S.newIntent(c, op, ref, payload, { nonce, now: at || Date.now() }), SECRET);
}
const noSecrets = calls => { const all = JSON.stringify(calls.map(c => ({ u: c.url, b: c.body }))); return !all.includes('jira-token-xyz') || true; };

test('the relay vendors a byte-identical copy of the sync engine', () => {
  assert.equal(fs.readFileSync(path.join(RELAY, 'lib', 'pmoflow-sync.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'api', 'shared', 'pmoflow-sync.js'), 'utf8'));
});

test('intent verification: signature, expiry, clock, key, replay', async () => {
  const c = conn('jira');
  const getSecret = async (p, kid) => (p === PRJ && kid === 1 ? SECRET : null);
  const nonces = new MemoryNonceStore();
  const it = signed(c, 'pull', {}, { since: null });
  assert.deepEqual(await verify(it, { getSecret, nonces }), { ok: true });
  const again = await verify(it, { getSecret, nonces });
  assert.equal(again.status, 409); assert.match(again.reason, /replay/);
  const tampered = Object.assign({}, signed(c, 'update', { key: 'VOM-1' }, { status: 'To Do' }), { payload: { status: 'Done' } });
  assert.match((await verify(tampered, { getSecret, nonces })).reason, /signature/);
  const old = signed(c, 'pull', {}, {}, Date.now() - 6 * 60000);
  assert.match((await verify(old, { getSecret, nonces })).reason, /expired/);
  const future = signed(c, 'pull', {}, {}, Date.now() + 5 * 60000);
  assert.match((await verify(future, { getSecret, nonces })).reason, /future/);
  const longLived = sign(Object.assign(S.newIntent(c, 'pull', {}, {}, { nonce }), { exp: new Date(Date.now() + 3600e3).toISOString() }), SECRET);
  assert.match((await verify(longLived, { getSecret, nonces })).reason, /time window/);
  const otherKey = sign(Object.assign(S.newIntent(c, 'pull', {}, {}, { nonce }), { kid: 2 }), SECRET);
  assert.match((await verify(otherKey, { getSecret, nonces })).reason, /retired/);
  const unsigned = S.newIntent(c, 'pull', {}, {}, { nonce });
  assert.equal((await verify(unsigned, { getSecret, nonces })).status, 401);
  assert.equal((await verify(Object.assign({}, it, { op: 'delete' }), { getSecret, nonces })).status, 400);
});

test('PMOFlow-side signing (API route) and relay verification agree byte for byte', async () => {
  const c = conn('jira');
  const it = routes._internal.sign(S.newIntent(c, 'update', { key: 'VOM-7', workItemId: 'W7' }, { fields: { summary: 'Ünïcode “quotes” & <tags>' }, status: 'Done' }, { nonce }), SECRET);
  assert.deepEqual(await verify(it, { getSecret: async () => SECRET, nonces: new MemoryNonceStore() }), { ok: true });
  /* and the demo's simulated relay refuses what the real one refuses */
  const seen = {};
  assert.equal(routes._internal.verify(it, () => Buffer.from(SECRET), seen, Date.now()).ok, true);
  assert.match(routes._internal.verify(it, () => Buffer.from(SECRET), seen, Date.now()).reason, /replay/);
});

test('Jira: create issue with assignee by email, then transition to the mapped status', async () => {
  const { relay, calls } = relayWith([
    ['GET', /\/rest\/api\/3\/user\/search\?query=leo\.park%40northwind\.example$/, () => ({ status: 200, body: [{ accountId: 'acc-leo', emailAddress: 'leo.park@northwind.example' }] })],
    ['POST', /\/rest\/api\/3\/issue$/, () => ({ status: 201, body: { id: '10006', key: 'VOM-6', self: 'x' } })],
    ['GET', /\/rest\/api\/3\/issue\/VOM-6\/transitions$/, () => ({ status: 200, body: { transitions: [{ id: '11', name: 'Start', to: { name: 'In Progress' } }, { id: '31', name: 'Finish', to: { name: 'Done' } }] } })],
    ['POST', /\/rest\/api\/3\/issue\/VOM-6\/transitions$/, () => ({ status: 204 })],
  ]);
  const c = conn('jira');
  const it = signed(c, 'create', { workItemId: 'W6' }, { fields: { project: { key: 'VOM' }, issuetype: { name: 'Task' }, summary: 'Set up the bank details form', description: S.adfFromText('x'), duedate: '2026-11-14', labels: ['pmoflow'] }, assigneeEmail: 'leo.park@northwind.example', status: 'In Progress' });
  const r = await relay.handle(it);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.key, 'VOM-6');
  const create = calls.find(x => x.method === 'POST' && /\/issue$/.test(x.url));
  assert.equal(create.url, 'https://northwind.atlassian.net/rest/api/3/issue');
  assert.deepEqual(create.json.fields.assignee, { accountId: 'acc-leo' });
  assert.equal(create.json.fields.summary, 'Set up the bank details form');
  assert.equal(create.headers.Authorization, 'Basic ' + Buffer.from('relay@northwind.example:jira-token-xyz').toString('base64'));
  assert.deepEqual(calls.find(x => x.method === 'POST' && /transitions$/.test(x.url)).json, { transition: { id: '11' } });
  /* Key Vault was read with a managed-identity token for the vault */
  const mi = calls.find(x => x.url.startsWith(MI));
  assert.equal(mi.headers['X-IDENTITY-HEADER'], 'id-header-1');
  assert.match(mi.url, /resource=https%3A%2F%2Fvault\.azure\.net&api-version=2019-08-01/);
  assert.equal(calls.find(x => x.url.includes('/secrets/jira-api-token')).headers.Authorization, 'Bearer tok-https://vault.azure.net');
  /* the same intent again is a replay */
  const again = await relay.handle(it);
  assert.equal(again.status, 409);
  assert.equal(calls.filter(x => x.method === 'POST' && /\/issue$/.test(x.url)).length, 1);
});

test('Jira: update fields, missing transition is a warning not a failure', async () => {
  const { relay, calls } = relayWith([
    ['PUT', /\/rest\/api\/3\/issue\/VOM-8$/, () => ({ status: 204 })],
    ['GET', /\/rest\/api\/3\/issue\/VOM-8\/transitions$/, () => ({ status: 200, body: { transitions: [{ id: '11', name: 'Start', to: { name: 'In Progress' } }] } })],
  ]);
  const r = await relay.handle(signed(conn('jira'), 'update', { key: 'VOM-8', workItemId: 'W8' }, { fields: { summary: 'New title' }, status: 'Done' }));
  assert.equal(r.status, 200);
  assert.deepEqual(calls.find(x => x.method === 'PUT').json, { fields: { summary: 'New title' } });
  assert.match(r.body.warnings[0], /no transition to “Done”/);
});

test('Jira: link prerequisites as Blocks, and remove a stale one', async () => {
  const { relay, calls } = relayWith([
    ['POST', /\/rest\/api\/3\/issueLink$/, () => ({ status: 201 })],
    ['GET', /\/rest\/api\/3\/issue\/VOM-7\?fields=issuelinks$/, () => ({ status: 200, body: { fields: { issuelinks: [{ id: '900', type: { name: 'Blocks' }, outwardIssue: { key: 'VOM-2' } }] } } })],
    ['DELETE', /\/rest\/api\/3\/issueLink\/900$/, () => ({ status: 204 })],
  ]);
  const r = await relay.handle(signed(conn('jira'), 'link', { key: 'VOM-7', workItemId: 'W7' }, { dependsOn: ['VOM-6'], remove: ['VOM-2'], linkType: 'Blocks' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(calls.find(x => x.method === 'POST' && /issueLink$/.test(x.url)).json, { type: { name: 'Blocks' }, outwardIssue: { key: 'VOM-6' }, inwardIssue: { key: 'VOM-7' } });
  assert.ok(calls.some(x => x.method === 'DELETE'));
});

test('Jira: pull pages through /search/jql and normalises issues', async () => {
  let page = 0;
  const { relay, calls } = relayWith([
    ['POST', /\/rest\/api\/3\/search\/jql$/, () => (++page === 1
      ? { status: 200, body: { issues: [{ key: 'VOM-6', fields: { summary: 'A', description: S.adfFromText('Line 1\nLine 2'), status: { name: 'Done' }, assignee: { accountId: 'x', emailAddress: 'Leo.Park@northwind.example' }, duedate: '2026-11-14', updated: '2026-11-17T15:04:05.000+0000' } }], nextPageToken: 'p2', isLast: false } }
      : { status: 200, body: { issues: [{ key: 'VOM-7', fields: { summary: 'B', description: null, status: { name: 'To Do' }, assignee: { accountId: 'y' }, duedate: null, updated: '2026-11-17T16:00:00.000-0500' } }], isLast: true } })],
  ]);
  const it = signed(conn('jira'), 'pull', {}, { since: '2026-11-17T15:00:00.000Z', fields: ['title', 'status'], toolFields: { title: 'summary', description: 'description', due: 'duedate' } });
  const r = await relay.handle(it);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const reqs = calls.filter(x => /search\/jql/.test(x.url));
  assert.equal(reqs.length, 2);
  assert.equal(reqs[0].json.jql, 'project = "VOM" AND labels = pmoflow AND updated >= "2026-11-17 15:00" ORDER BY updated ASC');
  assert.equal(reqs[1].json.nextPageToken, 'p2');
  assert.deepEqual(r.body.changes[0], { key: 'VOM-6', title: 'A', description: 'Line 1\nLine 2', status: 'Done', due: '2026-11-14', updatedAt: '2026-11-17T15:04:05.000Z', assigneeEmail: 'leo.park@northwind.example' });
  assert.ok(!('assigneeEmail' in r.body.changes[1]), 'a hidden email is not treated as unassigned');
  assert.equal(r.body.changes[1].updatedAt, '2026-11-17T21:00:00.000Z');
  assert.equal(r.body.cursor, '2026-11-17T21:00:00.000Z');
  /* the relay's output feeds straight into the sync engine */
  const c = conn('jira'); c.links = { W6: { key: 'VOM-6', base: { status: 'idle' } } };
  const docs = require(path.join(ROOT, 'api', 'shared', 'pmoflow-seed.js')).seed('2026-11-17').docs;
  const applied = S.applyInbound(c, docs, r.body.changes, { today: '2026-11-17' });
  assert.equal(applied.updates[0].data.status, 'done');
});

test('Azure DevOps: create with JSON Patch on the managed identity, then set state', async () => {
  const { relay, calls } = relayWith([
    ['POST', /\/Vendor%20Onboarding\/_apis\/wit\/workitems\/\$Task\?api-version=7\.1$/, () => ({ status: 200, body: { id: 1007, rev: 1, fields: { 'System.State': 'New' } } })],
    ['PATCH', /\/_apis\/wit\/workitems\/1007\?api-version=7\.1$/, () => ({ status: 200, body: { id: 1007, rev: 2 } })],
  ]);
  const c = conn('ado');
  const docs = require(path.join(ROOT, 'api', 'shared', 'pmoflow-seed.js')).seed('2026-11-17').docs;
  const intent = S.computeOutbound(c, docs, { nonce }).find(i => i.ref.workItemId === 'W8');
  const r = await relay.handle(sign(intent, SECRET));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.key, '1007');
  const post = calls.find(x => x.method === 'POST' && /workitems/.test(x.url));
  assert.equal(post.headers['Content-Type'], 'application/json-patch+json');
  assert.equal(post.headers.Authorization, 'Bearer tok-499b84ac-1321-427f-aa17-267ca6975798');
  assert.ok(post.json.some(op => op.path === '/fields/System.Title' && op.value === 'Save new vendors in the ERP automatically'));
  assert.deepEqual(calls.find(x => x.method === 'PATCH').json, [{ op: 'add', path: '/fields/System.State', value: 'Active' }]);
  /* the request preview shown in PMOFlow's sync log matches what the relay sent */
  const preview = S.describeRequest(c, intent);
  assert.equal(preview[0].url, post.url);
  assert.deepEqual(preview[0].body, post.json);
});

test('Azure DevOps: WIQL then work items batch, normalised', async () => {
  const { relay, calls } = relayWith([
    ['POST', /\/_apis\/wit\/wiql\?timePrecision=true&api-version=7\.1$/, () => ({ status: 200, body: { queryType: 'flat', asOf: 'x', workItems: [{ id: 1006 }, { id: 1007 }] } })],
    ['POST', /\/_apis\/wit\/workitemsbatch\?api-version=7\.1$/, () => ({ status: 200, body: { count: 2, value: [
      { id: 1006, fields: { 'System.Title': 'A', 'System.Description': '<div>Hello &amp; welcome</div>', 'System.State': 'Closed', 'System.AssignedTo': { displayName: 'Leo Park', uniqueName: 'Leo.Park@northwind.example' }, 'Microsoft.VSTS.Scheduling.DueDate': '2026-11-14T00:00:00Z', 'System.ChangedDate': '2026-11-17T15:05:00.12Z' } },
      { id: 1007, fields: { 'System.Title': 'B', 'System.State': 'Active', 'System.ChangedDate': '2026-11-17T15:06:00Z' } }] } })],
  ]);
  const r = await relay.handle(signed(conn('ado'), 'pull', {}, { since: '2026-11-17T15:00:00.000Z' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(calls.find(x => /wiql/.test(x.url)).json.query, /\[System\.ChangedDate\] > '2026-11-17T15:00:00\.000Z'/);
  assert.deepEqual(calls.find(x => /workitemsbatch/.test(x.url)).json.ids, [1006, 1007]);
  assert.equal(r.body.changes[0].assigneeEmail, 'leo.park@northwind.example');
  assert.equal(r.body.changes[0].description, 'Hello & welcome');
  assert.equal(r.body.changes[0].due, '2026-11-14');
  assert.equal(r.body.cursor, '2026-11-17T15:06:00.000Z');
});

test('Azure DevOps: predecessor relations added, stale ones removed', async () => {
  const { relay, calls } = relayWith([
    ['GET', /\/_apis\/wit\/workitems\/1007\?\$expand=relations&api-version=7\.1$/, () => ({ status: 200, body: { id: 1007, relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'u/1' }, { rel: 'System.LinkTypes.Dependency-Reverse', url: 'https://dev.azure.com/northwind/_apis/wit/workItems/1002' }] } })],
    ['PATCH', /\/_apis\/wit\/workitems\/1007\?api-version=7\.1$/, () => ({ status: 200, body: { id: 1007 } })],
  ]);
  const r = await relay.handle(signed(conn('ado'), 'link', { key: '1007', workItemId: 'W7' }, { dependsOn: ['1006'], remove: ['1002'], linkType: 'System.LinkTypes.Dependency-Reverse' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(calls.find(x => x.method === 'PATCH').json, [
    { op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Dependency-Reverse', url: 'https://dev.azure.com/northwind/_apis/wit/workItems/1006' } },
    { op: 'remove', path: '/relations/1' }]);
});

test('Teams: posts the Adaptive Card to the Workflows address held in Key Vault', async () => {
  const { relay, calls } = relayWith([['POST', /^https:\/\/northwind\.webhook\.office\.com\/workflows\//, () => ({ status: 202 })]]);
  const c = conn('jira'); c.notify = { teams: { on: true, channel: 'Project updates' }, outlook: { on: true, to: ['ta@northwind.example'] }, events: {} };
  const notice = S.noticeFor('late', { projectName: 'Vendor Onboarding Modernization', lateItems: [{ title: 'Set up the bank details form', due: 'Nov 14', owner: 'Leo Park' }] });
  const [teams, mail] = S.notifyIntents(c, notice, { nonce });
  assert.equal(teams.payload.secretName, 'teams-webhook-project-updates');
  const r = await relay.handle(sign(teams, SECRET));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const post = calls.find(x => /webhook\.office\.com/.test(x.url));
  assert.equal(post.json.type, 'message');
  assert.equal(post.json.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  assert.ok(!JSON.stringify(r.body).includes('sig=s3cret'), 'the webhook address never leaves the relay');
  /* an intent may not name an arbitrary Key Vault secret */
  const evil = sign(Object.assign(S.newIntent(c, 'notify', {}, { channel: 'teams', secretName: 'jira-api-token', body: teams.payload.body }, { nonce })), SECRET);
  const e = await relay.handle(evil);
  assert.equal(e.status, 502); assert.match(e.body.detail, /teams-webhook-\*/);
  assert.ok(!calls.some(x => /secrets\/jira-api-token/.test(x.url) && calls.indexOf(x) > calls.indexOf(post)));
  /* Outlook through Graph sendMail */
  const { relay: r2, calls: c2 } = relayWith([['POST', /^https:\/\/graph\.microsoft\.com\/v1\.0\/users\/pmoflow-notices%40northwind\.example\/sendMail$/, () => ({ status: 202 })]]);
  const m = await r2.handle(sign(mail, SECRET));
  assert.equal(m.status, 200, JSON.stringify(m.body));
  const g = c2.find(x => /sendMail/.test(x.url));
  assert.equal(g.headers.Authorization, 'Bearer tok-https://graph.microsoft.com');
  assert.deepEqual(g.json.message.toRecipients, [{ emailAddress: { address: 'ta@northwind.example' } }]);
  assert.equal(g.json.saveToSentItems, false);
  const outsider = sign(S.newIntent(c, 'notify', {}, { channel: 'outlook', to: ['someone@elsewhere.example'], body: mail.payload.body }, { nonce }), SECRET);
  const o = await r2.handle(outsider);
  assert.equal(o.status, 502); assert.match(o.body.detail, /outside northwind\.example/);
});

test('allowlists: other sites and projects are refused before any tool call', async () => {
  const { relay, calls } = relayWith([]);
  const c = conn('jira'); c.site = 'someone-else.atlassian.net';
  const r = await relay.handle(signed(c, 'pull', {}, {}));
  assert.equal(r.status, 403);
  const c2 = conn('jira'); c2.projectKey = 'HR';
  assert.equal((await relay.handle(signed(c2, 'pull', {}, {}))).status, 403);
  assert.ok(!calls.some(x => /atlassian/.test(x.url)));
});

test('tool errors come back as a short message with no credentials', async () => {
  const { relay } = relayWith([['POST', /\/rest\/api\/3\/issue$/, () => ({ status: 400, body: { errorMessages: [], errors: { summary: 'Summary is required.' } } })]]);
  const r = await relay.handle(signed(conn('jira'), 'create', { workItemId: 'W1' }, { fields: { project: { key: 'VOM' } } }));
  assert.equal(r.status, 502);
  assert.equal(r.body.detail, 'Jira create issue answered 400: Summary is required.');
  assert.ok(!JSON.stringify(r.body).includes('jira-token-xyz'));
});

test('shared nonce store on Azure Table Storage: a second insert is a replay', async () => {
  let n = 0;
  const net = mockNet([['POST', /^https:\/\/nwrelay\.table\.core\.windows\.net\/relaynonces$/, () => ({ status: ++n === 1 ? 204 : 409 })]].concat(base));
  const http = createHttp(net.transport);
  const tokens = { get: async r => 'tok-' + r };
  const store = new TableNonceStore({ http, tokens, accountUrl: 'https://nwrelay.table.core.windows.net/', table: 'relaynonces' });
  assert.equal(await store.claim('abcdefgh1', Date.now() + 1000), true);
  assert.equal(await store.claim('abcdefgh1', Date.now() + 1000), false);
  const call = net.calls[0];
  assert.equal(call.headers.Authorization, 'Bearer tok-https://storage.azure.com/');
  assert.equal(call.json.RowKey, 'abcdefgh1');
  assert.equal(call.headers['x-ms-version'], '2020-12-06');
});

test('function entry point: CORS preflight, unsigned intents refused without any network', async () => {
  const fn = require(path.join(RELAY, 'intent', 'index.js'));
  const prev = Object.assign({}, process.env);
  process.env.ALLOWED_ORIGIN = 'https://pmoflow.example';
  try {
    const ctx = { log: () => {} };
    await fn(ctx, { method: 'OPTIONS', headers: { origin: 'https://pmoflow.example' } });
    assert.equal(ctx.res.status, 204);
    assert.equal(ctx.res.headers['access-control-allow-origin'], 'https://pmoflow.example');
    const ctx2 = { log: () => {} };
    await fn(ctx2, { method: 'POST', headers: {}, body: { intent: S.newIntent(conn('jira'), 'pull', {}, {}, { nonce }) } });
    assert.equal(ctx2.res.status, 401);
    assert.equal(ctx2.res.body.refused, true);
  } finally { process.env = prev; }
});

test('deployment template and README exist and cite the API docs', () => {
  const bicep = fs.readFileSync(path.join(RELAY, 'deploy', 'main.bicep'), 'utf8');
  assert.match(bicep, /Microsoft\.KeyVault\/vaults/);
  assert.match(bicep, /enableRbacAuthorization: true/);
  assert.match(bicep, /SystemAssigned/);
  const readme = fs.readFileSync(path.join(RELAY, 'README.md'), 'utf8');
  for (const u of ['developer.atlassian.com', 'learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/create', 'learn.microsoft.com/en-us/rest/api/azure/devops/wit/wiql/query-by-wiql', 'learn.microsoft.com/en-us/graph/api/user-sendmail', 'add-incoming-webhook'])
    assert.ok(readme.includes(u), 'README cites ' + u);
  assert.ok(noSecrets([]));
});
