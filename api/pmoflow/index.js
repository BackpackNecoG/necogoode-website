/* /api/pmoflow/{*path} — PMOFlow showroom API (contract: docs/pmoflow/CONTRACTS.md §3).
   Per-visitor sandbox workspaces; persistence goes through ../shared/pmoflow-store.js only.
   Raw client IPs are hashed (SHA-256 + salt) and never stored or logged. Raw CSV values are never stored or logged. */
const crypto = require('crypto');
const store = require('../shared/pmoflow-store');
const { DOC_TYPES } = require('../shared/pmoflow-seed');
const ai = require('../shared/pmoflow-ai');

const WS_RE = /^[a-z0-9]{12,32}$/;
const ID_RE = /^[\w.-]{1,64}$/;
const REF_RE = /^[A-Za-z]{1,32}:[\w.-]{1,64}(\/[\w.-]{1,64})?$/; /* allows step:pid/sid */
const MAX_DOC = 48 * 1024;
const MAX_CSV = 2 * 1024 * 1024;
const MAX_ROWS = 50000;
const WRITES_PER_MIN = 120;
const STAMPED = ['workItem', 'process'];
const SALT = process.env.PMOFLOW_SALT || 'pmoflow-showroom-v3-salt';

function engine() { try { return require('../shared/pmoflow-engine.js'); } catch (e) { return null; } }

function clientIpHash(req) {
  const h = req.headers || {};
  let ip = String(h['x-azure-clientip'] || h['x-client-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || '').trim();
  if (/^\[/.test(ip)) ip = ip.slice(1, ip.indexOf(']'));                    /* [v6]:port */
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.replace(/:\d+$/, ''); /* v4:port */
  return crypto.createHash('sha256').update(SALT + '|' + (ip || 'unknown')).digest('hex');
}

/* best-effort per-instance write limiter */
const writeLog = new Map();
function rateLimited(wsId) {
  const now = Date.now();
  const arr = (writeLog.get(wsId) || []).filter(t => now - t < 60000);
  if (arr.length >= WRITES_PER_MIN) { writeLog.set(wsId, arr); return true; }
  arr.push(now); writeLog.set(wsId, arr);
  if (writeLog.size > 5000) writeLog.clear();
  return false;
}

function parseBody(req) {
  const b = req.body;
  if (b == null || b === '') return {};
  if (typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  try { const j = JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : String(b)); return j && typeof j === 'object' ? j : null; } catch (e) { return null; }
}
const actorOf = b => (typeof b.actor === 'string' && ID_RE.test(b.actor) ? b.actor : 'anonymous');
const summaryOf = (b, dflt) => (typeof b.summary === 'string' && b.summary.trim() ? b.summary.trim().slice(0, 300) : dflt);
const isPlainObject = v => v && typeof v === 'object' && !Array.isArray(v);

/* minimal local profiler, used only if the engine is unavailable */
function localProfile(csv) {
  const rows = String(csv).split(/\r?\n/).filter(l => l.length).map(l => l.split(','));
  const header = rows[0] || [];
  const data = rows.slice(1, 1 + MAX_ROWS);
  const mask = v => { const c = Array.from(v); const m = c.map(x => /\d/.test(x) ? '9' : /\p{Lu}/u.test(x) ? 'X' : /\p{L}/u.test(x) ? 'x' : x);
    return c.length <= 2 ? m.join('') : c[0] + m.slice(1, -1).join('') + c[c.length - 1]; };
  return header.map((name, j) => {
    const present = data.map(r => (r[j] || '').trim()).filter(Boolean);
    const lens = present.map(v => Array.from(v).length);
    const pc = {}; present.forEach(v => { const p = v.replace(/\d/g, '9').replace(/\p{Lu}/gu, 'A').replace(/\p{Ll}/gu, 'a'); pc[p] = (pc[p] || 0) + 1; });
    return { name: name.trim(), nulls: data.length - present.length, distinct: new Set(present).size,
      minLen: lens.length ? Math.min(...lens) : 0, maxLen: lens.length ? Math.max(...lens) : 0, charClasses: [], specials: [],
      patterns: Object.entries(pc).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([pattern, count]) => ({ pattern, count })),
      examples: [...new Set(present)].slice(0, 3).map(v => { const m = mask(v); return m === v ? '*'.repeat(Array.from(v).length) : m; }) };
  });
}

/* deep copy of nodes; with asFrom=true every node points back at itself (post-release to-be) */
function cloneNodes(nodes, asFrom) {
  return (nodes || []).map(n => {
    const c = JSON.parse(JSON.stringify(n));
    delete c.from;
    if (asFrom) c.from = c.id;
    if (Array.isArray(c.branches)) c.branches = c.branches.map(b => Object.assign({}, b, { nodes: cloneNodes(b.nodes, asFrom) }));
    return c;
  });
}

const shortDate = iso => { const t = Date.parse(iso); return isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''; };
const ENV = e => (String(e || '').toLowerCase() === 'uat' ? 'UAT' : 'Dev');

/* Human label for a doc in event summaries (R3: names, never ids). */
function describe(type, data, docs) {
  data = data || {};
  const get = (t, id) => (((docs[t] || []).find(d => d.id === id) || {}).data) || null;
  const nm = (t, id) => { const d = get(t, id); return d ? (d.name || d.title || 'an item') : 'an item'; };
  switch (type) {
    case 'workItem': return `work item "${data.title || 'untitled'}"`;
    case 'dataElement': return `data element "${data.name || 'untitled'}"`;
    case 'process': return `process "${data.name || 'untitled'}"`;
    case 'project': return `project "${data.name || 'untitled'}"`;
    case 'person': return data.name || 'a person';
    case 'grant': return `${ENV(data.env)} ${data.access || 'read'} access to ${nm('dataElement', data.dataId)}`;
    case 'testRun': return `${ENV(data.env)} run, ${shortDate(data.at) || 'undated'}`;
    case 'testCase': return `"${data.field || 'field'}" test case for ${nm('dataElement', data.dataId)}`;
    case 'approval': return `${data.bu || 'business unit'} sign-off`;
    case 'risk': return `risk "${data.title || 'untitled'}"`;
    case 'profile': return `profile of ${nm('dataElement', data.dataId)}`;
    case 'release': return `${data.kind === 'rollback' ? 'rollback' : 'go-live'} release`;
    case 'comment': { const [t, id] = String(data.ref || '').split(':'); return `comment on ${get(t, id) ? describe(t, get(t, id), docs) : 'an item'}`; }
    case 'notification': return 'notification';
    default: return type;
  }
}

/* R5: ticking a runbook task (done/doneAt/doneBy) is not a cutover edit */
const TICK = ['done', 'doneAt', 'doneBy'];
function cutoverSansTicks(c) {
  if (!c) return null;
  const o = Object.assign({}, c);
  if (Array.isArray(o.tasks)) o.tasks = o.tasks.map(t => { const x = Object.assign({}, t); TICK.forEach(k => delete x[k]); return x; });
  return o;
}
function cutoverStructureChanged(a, b) { return JSON.stringify(cutoverSansTicks(a)) !== JSON.stringify(cutoverSansTicks(b)); }
function tickedTasks(a, b) {
  const before = new Map(((a && a.tasks) || []).map((t, i) => [t.id || i, t]));
  return ((b && b.tasks) || []).filter((t, i) => { const p = before.get(t.id || i) || {}; return TICK.some(k => JSON.stringify(p[k]) !== JSON.stringify(t[k])); });
}

function personName(docs, id) { const p = ((docs.person || []).find(d => d.id === id) || {}).data; return p ? p.name : 'the assigned person'; }

/* R5 [S] permission rules for PUT. Returns an error message or null. Server promotions bypass this (they write via the store). */
function permissionError(type, prev, next, actor, docs) {
  if (type === 'process') {
    const ref = prev || next;
    const editors = [ref.owner].concat(ref.resources || []).filter(Boolean);
    if (!prev && !editors.length) return null;                       /* brand-new process with no owner yet */
    if (editors.includes(actor)) return null;
    return `Only the process owner (${personName(docs, ref.owner)}) and the process resources can edit ${describe('process', ref, docs)}. Ask ${personName(docs, ref.owner)} for edit access.`;
  }
  if (type === 'project' && prev) {
    const changed = ['releaseManager', 'processes'].filter(k => JSON.stringify(prev[k] == null ? null : prev[k]) !== JSON.stringify(next[k] == null ? null : next[k]));
    if (cutoverStructureChanged(prev.cutover, next.cutover)) changed.unshift('cutover');
    else if (actor !== prev.owner) {
      /* only runbook ticks changed: each ticked task must belong to the actor */
      const others = tickedTasks(prev.cutover, next.cutover).filter(t => t.owner !== actor);
      if (others.length) return `Only the task owner (${others.map(t => personName(docs, t.owner)).join(', ')}) or the project manager (${personName(docs, prev.owner)}) can confirm "${others.map(t => t.task || 'untitled').join('", "')}".`;
    }
    if (changed.length && actor !== prev.owner) {
      const what = changed.map(k => ({ cutover: 'the cutover plan', releaseManager: 'the release manager', processes: 'the linked processes' }[k])).join(', ');
      return `Only the project manager (${personName(docs, prev.owner)}) can change ${what} on ${describe('project', prev, docs)}.`;
    }
  }
  return null;
}

const names = docs => {
  const m = {};
  ['person', 'dataElement', 'process', 'project', 'workItem'].forEach(t => (docs[t] || []).forEach(d => { m[t + ':' + d.id] = d.data.name || d.data.title || d.id; }));
  return m;
};

/* release.exceptions from the engine's exceptions check: [{ref, summary, by, at}], summaries use names, never ids */
function releaseExceptions(docs, check) {
  const n = names(docs);
  return ((check && check.items) || []).map(it => {
    const ref = typeof it === 'string' ? (it.includes(':') ? it : 'workItem:' + it) : String(it.ref || '');
    const [type, id] = ref.split(':');
    const doc = ((docs[type] || []).find(d => d.id === id) || {}).data || {};
    const label = n[ref] || (typeof it === 'object' && it.title) || 'An item';
    const owner = n['person:' + (doc.owner || (typeof it === 'object' && it.by))] || 'its owner';
    return { ref, summary: `"${label}" (${type === 'process' ? 'process' : 'work item'}, owner ${owner}) changed after its business unit signed off`,
      by: owner, at: doc.updatedAt || (typeof it === 'object' && it.at) || null };
  });
}

function pipelineAction(kind, projectId, relId, snapshot) {
  const dispatch = { ref: 'main', inputs: { project: projectId, release: relId, mode: kind, processes: JSON.stringify(snapshot) } };
  return { type: 'pipeline', target: 'github: northwind-traders/process-automation · release.yml', status: 'simulated-ok',
    detail: 'POST https://api.github.com/repos/northwind-traders/process-automation/actions/workflows/release.yml/dispatches\n' +
      'Accept: application/vnd.github+json\nAuthorization: Bearer <token from Key Vault>\n\n' + JSON.stringify(dispatch, null, 2) };
}

async function goLive(wsId, docs, project, actor, today, simulateFailure) {
  const eng = engine();
  if (!eng || typeof eng.readiness !== 'function') return { status: 503, body: { error: 'engine unavailable' } };
  const projectId = project.id;
  if (project.status === 'live') return { status: 409, body: { error: 'project is already live', reasons: ['Project status is live.'] } };
  const gate = eng.readiness(docs, projectId, today);
  if (!gate.pass) return { status: 409, body: { error: 'readiness gate failed',
    reasons: gate.checks.filter(c => !c.pass && !c.warning).map(c => `${c.label}: ${c.detail}`) } };
  /* R5 step 2: go/no-go enforcement — every go/no-go runbook task has an owner and is confirmed done */
  const tasks = (project.cutover && Array.isArray(project.cutover.tasks)) ? project.cutover.tasks : [];
  const gng = [];
  tasks.filter(t => t && t.gonogo).forEach((t, i) => {
    const label = `Go/no-go task "${String(t.task || 'untitled').trim() || 'untitled'}"`;
    if (!t.owner) gng.push(`${label} has no owner.`);
    if (t.done !== true) gng.push(`${label} is not confirmed (Go/no-go confirmed).`);
  });
  if (gng.length) return { status: 409, body: { error: 'go/no-go not confirmed', reasons: gng } };

  const at = new Date().toISOString();
  const rm = project.releaseManager || project.owner;
  const people = Object.fromEntries((docs.person || []).map(d => [d.id, d.data]));
  const procDocs = (docs.process || []).filter(d => (project.processes || []).includes(d.id));
  const relId = 'rel-' + projectId.slice(0, 40) + '-' + Date.now().toString(36);
  const approvers = [...new Set((docs.approval || []).map(d => d.data)
    .filter(a => a.projectId === projectId && a.decision === 'approved' && a.stepUp === true).map(a => a.approver))];

  /* R5 step 3: pipeline (simulated). On failure: record it, notify the release manager only, no side effects. */
  if (simulateFailure) {
    const plan = Object.fromEntries(procDocs.map(pd => [pd.id, (Number(pd.data.version) || 1) + 1]));
    const pipe = pipelineAction('golive', projectId, relId, plan);
    pipe.status = 'simulated-failed';
    pipe.detail += '\n\nRun result: failed at step "deploy automation" (simulated). Nothing was promoted, published or expired.';
    const release = { id: relId, kind: 'golive', status: 'failed', projectId, at, by: actor, approvers, actions: [pipe,
      { type: 'notify', target: (people[rm] && people[rm].name) || rm, status: 'simulated-ok', detail: `Pipeline failure notice for ${project.name} sent to the release manager only.` }],
      exceptions: [], checks: JSON.parse(JSON.stringify(gate.checks)), snapshot: {} };
    await store.putDoc(wsId, 'release', relId, release);
    const nid = 'ntf-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    await store.putDoc(wsId, 'notification', nid, { id: nid, to: rm, text: `Go-live pipeline failed for ${project.name}. Nothing was changed; fix and retry.`, ref: 'release:' + relId, at, read: false });
    await store.appendEvent(wsId, { actor, at, action: 'golive-failed', ref: 'project:' + projectId, summary: `Go-live pipeline failed for ${project.name}; no changes were made` });
    return { status: 200, body: { ok: false, failed: true, release, project } };
  }

  /* R5 step 4: side effects, success only */
  const events = [], snapshot = {};
  for (const pd of procDocs) {
    const p = JSON.parse(JSON.stringify(pd.data));
    const prevVersion = Number(p.version) || 1;
    const version = prevVersion + 1;
    /* keep the pre-release version viewable (and restorable): as-is plus the to-be that replaced it */
    p.released = (p.released || []).concat([{ version: prevVersion, at, by: actor, asis: cloneNodes(p.asis, false), tobe: JSON.parse(JSON.stringify(p.tobe || [])) }]);
    const promoted = cloneNodes(p.tobe, false);
    p.asis = promoted;
    p.tobe = cloneNodes(promoted, true);
    p.version = version;          /* no updatedAt stamp: promotion must never make approvals stale (R3) */
    snapshot[p.id] = version;
    await store.putDoc(wsId, 'process', p.id, p);
    events.push({ action: 'release', ref: 'process:' + p.id, summary: `Released ${p.name} v${version}: to-be promoted to as-is (v${prevVersion} kept in history)` });
  }
  for (const gd of (docs.grant || []).filter(d => d.data.projectId === projectId)) {
    const g = JSON.parse(JSON.stringify(gd.data));
    const next = g.status === 'active' || g.status === 'approved' ? 'expired' : g.status === 'requested' ? 'denied' : null;
    if (!next) continue;
    g.status = next; g.expires = today;
    g.log = (g.log || []).concat([{ at, by: actor, action: next === 'expired' ? 'expired at go-live' : 'denied at go-live' }]);
    await store.putDoc(wsId, 'grant', g.id, g);
    events.push({ action: 'update', ref: 'grant:' + g.id, summary: `${describe('grant', g, docs)} ${next} at go-live` });
  }
  /* R4: go-live never flips data to live; only the data owner's confirmation (liveConfirmedBy + liveSource) does */
  const release = {
    id: relId, kind: 'golive', status: 'succeeded', projectId, at, by: actor, approvers,
    actions: [pipelineAction('golive', projectId, relId, snapshot),
      ...procDocs.map(pd => ({ type: 'sop-publish', target: `SOP library: ${pd.data.name} v${snapshot[pd.id]}`, status: 'simulated-ok',
        detail: `Published the released process as the controlled SOP for ${pd.data.name}; v${snapshot[pd.id] - 1} was archived.` })),
      { type: 'notify', target: (project.resources || []).map(id => (people[id] && people[id].name) || id).join(', '), status: 'simulated-ok',
        detail: `Go-live notice for ${project.name} sent to the project team and process owners.` }],
    exceptions: releaseExceptions(docs, gate.checks.find(c => c.id === 'exceptions')),
    checks: JSON.parse(JSON.stringify(gate.checks)),
    snapshot,
  };
  await store.putDoc(wsId, 'release', relId, release);
  const proj = Object.assign({}, project, { status: 'live', liveAt: at });
  await store.putDoc(wsId, 'project', projectId, proj);
  events.push({ action: 'create', ref: 'release:' + relId, summary: `Go-live release recorded with ${release.actions.length} simulated action(s)` });
  events.push({ action: 'golive', ref: 'project:' + projectId, summary: `${project.name} went live` });
  for (const e of events) await store.appendEvent(wsId, Object.assign({ actor, at }, e));
  return { status: 200, body: { ok: true, release, project: proj } };
}

async function rollback(wsId, docs, project, actor, reason) {
  const projectId = project.id;
  if (project.status !== 'live') return { status: 409, body: { error: 'only a live project can be rolled back', reasons: ['Project status is ' + (project.status || 'active') + '.'] } };
  const at = new Date().toISOString();
  const events = [], snapshot = {}, undone = [];
  const procDocs = (docs.process || []).filter(d => (project.processes || []).includes(d.id));
  /* R5: the go-live being reversed */
  const undoes = (docs.release || []).map(d => d.data).filter(r => r.projectId === projectId && r.kind === 'golive' && r.status !== 'failed' && !r.rolledBackBy)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null;
  for (const pd of procDocs) {
    const p = JSON.parse(JSON.stringify(pd.data));
    const cur = Number(p.version) || 1;
    const released = p.released || [];
    let idx = -1;
    for (let i = released.length - 1; i >= 0; i--) if (!released[i].rolledBack && released[i].version === cur - 1) { idx = i; break; }
    if (idx < 0) continue;
    const prev = released[idx];
    /* the rolled-back version stays viewable in history, flagged */
    released.splice(idx, 1);
    released.push({ version: cur, at, by: actor, asis: cloneNodes(p.asis, false), rolledBack: true });
    p.released = released;
    p.asis = cloneNodes(prev.asis, false);
    p.tobe = prev.tobe ? JSON.parse(JSON.stringify(prev.tobe)) : JSON.parse(JSON.stringify(p.tobe || []));
    p.version = cur - 1;
    p.updatedAt = at;
    snapshot[p.id] = p.version;
    await store.putDoc(wsId, 'process', p.id, p);
    events.push({ action: 'rollback', ref: 'process:' + p.id, summary: `Rolled ${p.name} back from v${cur} to v${cur - 1}` });
    undone.push({ type: 'process-version', target: p.name, from: cur, to: cur - 1, detail: `Restored the v${cur - 1} as-is and its designed to-be` });
    undone.push({ type: 'sop-publish', target: `SOP library: ${p.name}`, from: cur, to: cur - 1, detail: `Re-published SOP v${cur - 1}; v${cur} withdrawn` });
  }
  undone.push({ type: 'grants', target: 'Access grants', detail: 'Grants expired at go-live stay expired (least privilege); request access again if needed' });
  const people = Object.fromEntries((docs.person || []).map(d => [d.id, d.data]));
  const relId = 'rel-' + projectId.slice(0, 36) + '-rb-' + Date.now().toString(36);
  const owner = project.cutover && project.cutover.rollbackOwner;
  const release = {
    id: relId, kind: 'rollback', projectId, at, by: actor, approvers: [],
    actions: [pipelineAction('rollback', projectId, relId, snapshot),
      ...procDocs.filter(pd => snapshot[pd.id]).map(pd => ({ type: 'sop-publish', target: `SOP library: ${pd.data.name} v${snapshot[pd.id]}`, status: 'simulated-ok',
        detail: `Re-published v${snapshot[pd.id]} of ${pd.data.name} as the controlled SOP; v${snapshot[pd.id] + 1} was withdrawn.` })),
      { type: 'notify', target: (project.resources || []).map(id => (people[id] && people[id].name) || id).join(', '), status: 'simulated-ok',
        detail: `Rollback notice for ${project.name}` + (owner && people[owner] ? `; rollback owner ${people[owner].name}.` : '.') }],
    reason: String(reason || '').slice(0, 500), exceptions: [], snapshot,
    status: 'succeeded', undone, undoes: undoes ? undoes.id : null,
  };
  await store.putDoc(wsId, 'release', relId, release);
  if (undoes) await store.putDoc(wsId, 'release', undoes.id, Object.assign({}, undoes, { rolledBackBy: relId, rolledBackAt: at }));
  const proj = Object.assign({}, project, { status: 'active', rolledBackAt: at });
  delete proj.liveAt;
  await store.putDoc(wsId, 'project', projectId, proj);
  events.push({ action: 'create', ref: 'release:' + relId, summary: 'Rollback release recorded' });
  events.push({ action: 'rollback', ref: 'project:' + projectId, summary: `${project.name} rolled back to the previous process versions` });
  for (const e of events) await store.appendEvent(wsId, Object.assign({ actor, at }, e));
  return { status: 200, body: { ok: true, release, project: proj } };
}

module.exports = async function (context, req) {
  const send = (status, body) => {
    context.res = { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body };
  };
  const fail = (status, error, reasons) => send(status, reasons ? { error, reasons } : { error });
  try {
    const method = String(req.method || 'GET').toUpperCase();
    let path = (req.params && req.params.path) || '';
    if (!path && req.url) path = String(req.url).split('?')[0].replace(/^.*\/api\/pmoflow\/?/, '');
    let seg;
    try { seg = String(path).split('/').filter(Boolean).map(decodeURIComponent); } catch (e) { return fail(400, 'bad path'); }
    const body = parseBody(req);
    if (body === null) return fail(400, 'body must be JSON');

    /* POST /workspaces */
    if (seg[0] === 'workspaces' && seg.length === 1) {
      if (method !== 'POST') return fail(405, 'method not allowed');
      try {
        const ws = await store.createWorkspace(clientIpHash(req));
        return send(201, { id: ws.id });
      } catch (e) {
        if (e.status === 429) return fail(429, 'Daily workspace limit reached. Try again tomorrow.');
        throw e;
      }
    }

    if (seg[0] !== 'ws' || seg.length < 3) return fail(404, 'unknown route');
    const wsId = seg[1];
    if (!WS_RE.test(wsId)) return fail(400, 'invalid workspace id');
    const ws = await store.getWorkspace(wsId);
    if (!ws || ws.expired) return fail(404, 'workspace not found or expired');
    const action = seg[2];
    const isWrite = method !== 'GET';
    if (isWrite && rateLimited(wsId)) return fail(429, 'Too many writes. Slow down.');
    const today = new Date().toISOString().slice(0, 10);

    /* GET /ws/:ws/state */
    if (action === 'state' && seg.length === 3) {
      if (method !== 'GET') return fail(405, 'method not allowed');
      return send(200, await store.getState(ws));
    }

    /* GET /ws/:ws/events */
    if (action === 'events' && seg.length === 3) {
      if (method !== 'GET') return fail(405, 'method not allowed');
      const qy = req.query || {};
      const ref = qy.ref ? String(qy.ref) : '';
      if (ref && !REF_RE.test(ref)) return fail(400, 'invalid ref');
      const limit = qy.limit == null ? 100 : Number(qy.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) return fail(400, 'limit must be an integer 1-500');
      return send(200, { events: await store.listEvents(ws, { ref, limit }) });
    }

    /* PUT|DELETE /ws/:ws/doc/:type/:id */
    if (action === 'doc' && seg.length === 5) {
      const [, , , type, id] = seg;
      if (!DOC_TYPES.includes(type)) return fail(400, 'invalid doc type');
      if (!ID_RE.test(id)) return fail(400, 'invalid doc id');
      const actor = actorOf(body);
      if (method === 'PUT') {
        if (!isPlainObject(body.data)) return fail(400, 'data must be an object');
        const data = Object.assign({}, body.data, { id });
        if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_DOC) return fail(413, 'document exceeds 48 KB');
        const st = await store.getState(ws);
        const prev = (st.docs[type] || []).find(d => d.id === id);
        const exists = !!prev;
        /* R5 [S]: permissions */
        const denied = permissionError(type, prev && prev.data, data, actor, st.docs);
        if (denied) return fail(403, denied);
        /* R5: cutover edits are stamped so approvals taken before them go stale */
        if (type === 'project' && cutoverStructureChanged(prev && prev.data.cutover, data.cutover) &&
          (!data.cutoverUpdatedAt || (prev && prev.data.cutoverUpdatedAt === data.cutoverUpdatedAt))) data.cutoverUpdatedAt = new Date().toISOString();
        /* R2: stamp updatedAt when the client did not (missing, or echoed back unchanged) */
        if (STAMPED.includes(type) && (!data.updatedAt || (prev && prev.data.updatedAt === data.updatedAt))) data.updatedAt = new Date().toISOString();
        await store.putDoc(wsId, type, id, data);
        const after = Object.assign({}, st.docs, { [type]: (st.docs[type] || []).filter(d => d.id !== id).concat([{ id, data }]) });
        const ev = await store.appendEvent(wsId, { actor, action: exists ? 'update' : 'create', ref: `${type}:${id}`,
          summary: ai.labeler(after).scrub(summaryOf(body, `${exists ? 'Updated' : 'Created'} ${describe(type, data, after)}`)) });
        return send(200, { ok: true, doc: { type, id, data }, event: ev });
      }
      if (method === 'DELETE') {
        const st = await store.getState(ws);
        const prev = (st.docs[type] || []).find(d => d.id === id);
        if (prev && (type === 'process' || type === 'project')) {
          const denied = type === 'process' ? permissionError('process', prev.data, prev.data, actor, st.docs)
            : (actor !== prev.data.owner ? `Only the project manager (${personName(st.docs, prev.data.owner)}) can delete ${describe('project', prev.data, st.docs)}.` : null);
          if (denied) return fail(403, denied);
        }
        await store.deleteDoc(wsId, type, id);
        const ev = await store.appendEvent(wsId, { actor, action: 'delete', ref: `${type}:${id}`,
          summary: ai.labeler(st.docs).scrub(summaryOf(body, `Deleted ${prev ? describe(type, prev.data, st.docs) : type}`)) });
        return send(200, { ok: true, event: ev });
      }
      return fail(405, 'method not allowed');
    }

    if (method !== 'POST') return fail(405, 'method not allowed');

    /* POST /ws/:ws/reset */
    if (action === 'reset' && seg.length === 3) {
      const w = await store.resetWorkspace(ws);
      await store.appendEvent(wsId, { actor: actorOf(body), action: 'reset', ref: 'workspace:' + wsId, summary: 'Workspace reset to the demo seed' });
      return send(200, { ok: true, id: w.id });
    }

    /* POST /ws/:ws/profile/:dataId */
    if (action === 'profile' && seg.length === 4) {
      const dataId = seg[3];
      if (!ID_RE.test(dataId)) return fail(400, 'invalid data id');
      if (typeof body.csv !== 'string' || !body.csv.trim()) return fail(400, 'csv is required');
      if (Buffer.byteLength(body.csv, 'utf8') > MAX_CSV) return fail(413, 'csv exceeds 2 MB');
      const st = await store.getState(ws);
      if (!(st.docs.dataElement || []).some(d => d.id === dataId)) return fail(404, 'unknown data element');
      const eng = engine();
      let rows, columns;
      if (eng && typeof eng.profileCsv === 'function') {
        const parsed = eng.parseCsv ? eng.parseCsv(body.csv) : null;
        rows = parsed ? Math.max(0, parsed.length - 1) : null;
        if (rows != null && rows > MAX_ROWS) return fail(413, `csv exceeds ${MAX_ROWS} rows`);
        const out = eng.profileCsv(body.csv, { maxRows: MAX_ROWS });
        columns = Array.isArray(out) ? out : (out && out.columns) || [];
        if (rows == null) rows = (out && out.rows) || (columns[0] && columns[0].rows) || 0;
      } else {
        rows = String(body.csv).split(/\r?\n/).filter(Boolean).length - 1;
        if (rows > MAX_ROWS) return fail(413, `csv exceeds ${MAX_ROWS} rows`);
        columns = localProfile(body.csv);
      }
      /* whitelist the statistics so nothing raw can ride along */
      columns = columns.map(c => {
        const o = { name: String(c.name).slice(0, 80), nulls: c.nulls, distinct: c.distinct, minLen: c.minLen, maxLen: c.maxLen,
          charClasses: c.charClasses || [], specials: c.specials || [], patterns: c.patterns || [], examples: c.examples || [] };
        if (typeof c.min === 'number') o.min = c.min;
        if (typeof c.max === 'number') o.max = c.max;
        return o;
      });
      const id = 'profile-' + dataId;
      const doc = { id, dataId, at: new Date().toISOString(), rows, columns };
      if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > MAX_DOC) return fail(413, 'profile exceeds 48 KB (too many columns)');
      await store.putDoc(wsId, 'profile', id, doc);
      await store.appendEvent(wsId, { actor: actorOf(body), action: 'profile', ref: 'dataElement:' + dataId,
        summary: `Profiled ${rows} row(s) × ${columns.length} column(s); statistics only` });
      return send(200, doc);
    }

    /* POST /ws/:ws/ai/:kind */
    if (action === 'ai' && seg.length === 4) {
      const kind = seg[3];
      if (!ai.KINDS.includes(kind)) return fail(400, 'unknown ai kind');
      const st = await store.getState(ws);
      const r = await ai.run(kind, body, st.docs, today);
      return send(r.status, r.body);
    }

    /* POST /ws/:ws/check/:dataId — simulated in-tenant connection probe (R5 evidence) */
    if (action === 'check' && seg.length === 4) {
      const dataId = seg[3];
      if (!ID_RE.test(dataId)) return fail(400, 'invalid data id');
      const st = await store.getState(ws);
      const de = ((st.docs.dataElement || []).find(d => d.id === dataId) || {}).data;
      if (!de) return fail(404, 'unknown data element');
      const at = new Date().toISOString();
      const source = String(de.source || '').trim();
      /* A finished resolver means the integration was built, so the probe can reach it even while avail still reads 'missing'. */
      const resolverDone = (st.docs.workItem || []).some(w => w.data && w.data.resolves === dataId && w.data.status === 'done');
      const ok = !!source && (de.avail !== 'missing' || resolverDone);
      const detail = ok
        ? `Simulated in-tenant probe reached ${source} and read one ${de.name} record (field names only; no values kept).`
        : !source ? `No source is recorded for ${de.name}, so there is nothing to probe. Add the source system first.`
          : `Simulated in-tenant probe found no integration for ${de.name} at ${source}: it is marked missing and its fix isn't done yet.`;
      const check = { ok, at, detail, by: actorOf(body) };
      await store.putDoc(wsId, 'dataElement', dataId, Object.assign({}, de, { check }));
      await store.appendEvent(wsId, { actor: actorOf(body), action: 'check', ref: 'dataElement:' + dataId,
        summary: `Connection check for ${de.name}: ${ok ? 'ok' : 'failed'}` });
      return send(200, { ok, at, detail });
    }

    /* POST /ws/:ws/golive/:projectId  and  POST /ws/:ws/rollback/:projectId */
    if ((action === 'golive' || action === 'rollback') && seg.length === 4) {
      const projectId = seg[3];
      if (!ID_RE.test(projectId)) return fail(400, 'invalid project id');
      const st = await store.getState(ws);
      const project = ((st.docs.project || []).find(d => d.id === projectId) || {}).data;
      if (!project) return fail(404, 'unknown project');
      /* R5 [S]: only the release manager (defaults to the project owner) can go live or roll back */
      const rm = project.releaseManager || project.owner;
      if (actorOf(body) !== rm) return fail(403, `Only the release manager (${personName(st.docs, rm)}) can ${action === 'golive' ? 'take' : 'roll back'} ${project.name}${action === 'golive' ? ' live' : ''}.`);
      const r = action === 'golive'
        ? await goLive(wsId, st.docs, project, actorOf(body), today, body.simulateFailure === true)
        : await rollback(wsId, st.docs, project, actorOf(body), body && body.reason);
      return send(r.status, r.body);
    }

    return fail(404, 'unknown route');
  } catch (e) {
    context.log && context.log('[pmoflow] ' + (e && e.message ? e.message.slice(0, 200) : 'error'));
    return fail(e && e.status === 503 ? 503 : 500, 'server error');
  }
};

module.exports._internal = { clientIpHash, cloneNodes, localProfile, releaseExceptions, describe, WS_RE, ID_RE };
