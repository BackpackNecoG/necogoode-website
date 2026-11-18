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
/* a plain YYYY-MM-DD calendar day (a real date: 2026-02-30 is rejected) */
const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;

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

/* R6 grants: the API never starts an expiry countdown on a requested grant; the time box starts at approval.
   Approval time = approvedAt, else the latest "approved…" log entry, else (approving now) the server time. */
const GRANT_MAX_DAYS = 30;
function grantApprovalTime(g, prev) {
  if (typeof g.approvedAt === 'string' && isFinite(Date.parse(g.approvedAt))) return g.approvedAt;
  const hit = (Array.isArray(g.log) ? g.log : []).filter(e => e && /^approv/i.test(String(e.action || '')) && isFinite(Date.parse(e.at))).map(e => e.at).sort().pop();
  if (hit) return hit;
  if (prev && ['approved', 'active'].includes(prev.status) && prev.approvedAt) return prev.approvedAt;
  return new Date().toISOString();
}
function grantExpiryError(g, prev) {
  if (!['approved', 'active'].includes(g.status)) return null;
  if (typeof g.expires !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(g.expires)) return 'An approved grant needs an expiry date: access is time-boxed to at most 30 days from approval.';
  const appr = grantApprovalTime(g, prev);
  const limit = new Date(Date.parse(appr.slice(0, 10) + 'T12:00:00Z') + GRANT_MAX_DAYS * 86400000).toISOString().slice(0, 10);
  if (g.expires.slice(0, 10) > limit) return `Access expires at most 30 days after approval (approved ${shortDate(appr)}, so by ${shortDate(limit + 'T12:00:00Z')}).`;
  return null;
}

const RATE_LIMIT_MSG = 'Too many new demo sandboxes from your network today. Try again tomorrow.';
/* the client's today: body.today on writes, ?today= on reads */
function dayInput(req, body) {
  if (body && typeof body.today === 'string') return body;
  const q = (req && req.query) || {};
  return typeof q.today === 'string' ? { today: q.today } : body;
}
function clientToday(body, serverToday) {
  const t = body && typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : null;
  if (!t || !isFinite(Date.parse(t + 'T12:00:00Z')) || new Date(t + 'T12:00:00Z').toISOString().slice(0, 10) !== t) return serverToday;   /* rejects 2026-02-30 */
  return Math.abs(Date.parse(t + 'T12:00:00Z') - Date.parse(serverToday + 'T12:00:00Z')) <= 2 * 86400000 ? t : serverToday;
}

/* R7 §9: project.approvers {bu: personId} picks who approves a section. The person must exist and may not be
   the project manager or the launch owner (separation of duties). Only entries that are new or changed are checked. */
function approversError(prev, next, docs) {
  if (next.approvers == null) return null;
  if (!isPlainObject(next.approvers)) return 'approvers must be an object of {business unit: person id}.';
  const before = (prev && isPlainObject(prev.approvers)) ? prev.approvers : {};
  const pm = next.owner, launch = next.releaseManager || next.owner;
  for (const [bu, pid] of Object.entries(next.approvers)) {
    if (typeof bu !== 'string' || !bu.trim() || bu.length > 60) return 'Each approver needs a business unit name.';
    if (pid == null || pid === '') continue;                 /* cleared: the section falls back to its default approvers */
    if (before[bu] === pid) continue;
    if (typeof pid !== 'string' || !(docs.person || []).some(d => d.id === pid)) return `Choose a person from the directory to approve the ${bu} part.`;
    if (pid === pm) return `${personName(docs, pid)} is the project manager, so they can't approve the ${bu} part. Choose someone else.`;
    if (pid === launch) return `${personName(docs, pid)} is the launch owner, so they can't approve the ${bu} part. Choose someone else.`;
    /* R11 §2: nor someone who does steps in this part or recorded its tests */
    const eng = engine();
    const bar = eng && typeof eng.approvalBar === 'function' && next.id ? eng.approvalBar(docs, Object.assign({}, next), bu, pid) : null;
    if (bar && bar.rule !== 'project-manager' && bar.rule !== 'launch-owner') return bar.text + ' Choose someone else.';
  }
  return null;
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

/* R11 §2 separation of duties, enforced here (never only in the page). The Admin role grants no exemption.
   testRun: results are recorded under the actor's own name; a manual PASS is refused for a test assigned to someone
   else, and for a test whose open problem is not fixed yet (CI runs still never count a held test: the engine). */
function testRunError(prev, next, actor, docs) {
  const eng = engine();
  if (!eng || typeof eng.heldTests !== 'function') return null;
  const newRun = !prev;
  if ((newRun || (prev && prev.by !== next.by)) && next.by !== actor)
    return `Test results are recorded under your own name: ${personName(docs, actor)} can't record them as ${personName(docs, next.by)}.`;
  const key = x => x && (x.caseId || x.scriptId);
  const before = new Set(((prev && prev.results) || []).filter(x => x && x.outcome === 'pass').map(key));
  const passes = (Array.isArray(next.results) ? next.results : []).filter(x => x && x.outcome === 'pass' && key(x) && !before.has(key(x))).map(key);
  if (!passes.length) return null;
  const flat = Object.fromEntries(Object.entries(docs).map(([t, arr]) => [t, arr]));
  const project = ((docs.project || []).find(d => d.id === next.projectId) || {}).data || {};
  const testerOf = {};
  (docs.testCase || []).forEach(d => { if (d.data && d.data.tester) testerOf[d.id] = d.data.tester; });
  (Array.isArray(project.uatScripts) ? project.uatScripts : []).concat(Array.isArray(project.uatScenarios) ? project.uatScenarios : [])
    .forEach(x => { if (x && x.id && x.tester) testerOf[x.id] = x.tester; });
  if (next.source !== 'ci') {
    const others = passes.filter(k => testerOf[k] && testerOf[k] !== actor);
    if (others.length) {
      const who = [...new Set(others.map(k => personName(docs, testerOf[k])))];
      return `You can only pass tests assigned to you or unassigned ones. ${others.length} of the ${passes.length} selected test${passes.length === 1 ? '' : 's'} ${others.length === 1 ? 'is' : 'are'} assigned to ${who.join(', ')}.`;
    }
    // R12 #4: a business-check pass is the assignee's, or (unassigned) someone's in the department that owns the
    // test's part; passing several at once needs the extra sign-in check (step-up)
    if (next.env === 'uat' && typeof eng.canPassTest === 'function') {
      const refused = passes.map(k => eng.canPassTest(flat, next.projectId, k, actor)).filter(Boolean);
      if (refused.length) return refused.length === 1 ? refused[0].text : `${refused[0].text} (${refused.length} of the ${passes.length} selected tests can't be passed by ${personName(docs, actor)}.)`;
      if (passes.length > 1 && !(next.stepUp === true || (next.stepUp && typeof next.stepUp === 'object'))) return `Passing ${passes.length} tests at once needs the extra sign-in check (step-up).`;
    }
    const held = eng.heldTests(flat, next.projectId);
    const blocked = passes.filter(k => held[k]);
    if (blocked.length) {
      const titles = [...new Set(blocked.map(k => (((docs.workItem || []).find(d => d.id === held[k]) || {}).data || {}).title || 'an open problem'))];
      return `A test can't pass while its problem is still open. Fix ${titles.map(t => `“${t}”`).join(', ')} first (mark it fixed), then re-run ${blocked.length === 1 ? 'the test' : 'the tests'}.`;
    }
  }
  return null;
}
/* R11 §2 approvals: a decision is the actor's own, with step-up; nobody approves a part they do steps in, recorded
   tests for, manage or launch. A launch-override sign-off is the actor's own and only in the role they hold. */
function approvalError(prev, next, actor, docs) {
  const eng = engine();
  if (!eng || typeof eng.approvalBar !== 'function') return null;
  const changed = !prev || prev.decision !== next.decision || prev.approver !== next.approver || prev.at !== next.at;
  if (!changed || !next.decision) return null;
  if (next.approver !== actor) return `Approvals are given under your own name: ${personName(docs, actor)} can't approve as ${personName(docs, next.approver)}.`;
  if (next.decision === 'approved' && next.stepUp !== true) return 'Approving needs the extra sign-in check (step-up).';
  if (next.kind === 'launch-override') {
    const role = eng.overrideSignerRole(docs, next.projectId, actor);
    if (!role) return `${personName(docs, actor)} can't sign a launch override: it needs the project manager and a sponsor or approver of this project.`;
    if (next.role !== role) return `${personName(docs, actor)} can sign the override only as the ${role === 'pm' ? 'project manager' : 'sponsor or approver'}.`;
    return null;
  }
  if (next.decision !== 'approved') return null;
  const bar = eng.approvalBar(docs, next.projectId, next.bu, actor);
  return bar ? bar.text : null;
}
/* R11 §3 the person's local wall time for the launch guard ("YYYY-MM-DDTHH:MM"), within a day of their today */
function localNowOf(body, today) {
  const v = body && typeof body.localNow === 'string' ? body.localNow : '';
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m || !isDay(m[1]) || +m[2] > 23 || +m[3] > 59) return today + 'T00:00';
  return Math.abs(Date.parse(m[1] + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) <= 86400000 ? m[1] + 'T' + m[2] + ':' + m[3] : today + 'T00:00';
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

/* R6: one audit trail in true order. Each step is stamped base + n ms, so the events endpoint
   (sorted by time) returns approval -> pipeline started -> pipeline result -> promotion -> SOP publish
   -> grants expired -> notifications, never a tie. */
function auditClock(base) {
  const t0 = Date.parse(base);
  let n = 0;
  return () => new Date(t0 + (n++)).toISOString();
}
/* R6: the release manager's step-up, as the client reports it (simulated MFA). Only the time and method are kept. */
function stepUpOf(body, actor, at) {
  const s = body && isPlainObject(body.stepUp) ? body.stepUp : null;
  const t = s && typeof s.at === 'string' && isFinite(Date.parse(s.at)) && Math.abs(Date.parse(s.at) - Date.parse(at)) < 15 * 60000 ? new Date(Date.parse(s.at)).toISOString() : at;
  return { by: actor, at: t, method: 'simulated-mfa' };
}

async function goLive(wsId, docs, project, actor, today, simulateFailure, body) {
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
  tasks.filter(t => t && t.gonogo).forEach(t => {
    const label = `Go/no-go task "${String(t.task || 'untitled').trim() || 'untitled'}"`;
    if (!t.owner) gng.push(`${label} has no owner.`);
    if (t.done !== true) gng.push(`${label} is not confirmed (Go/no-go confirmed).`);
  });
  if (gng.length) return { status: 409, body: { error: 'go/no-go not confirmed', reasons: gng } };

  const at = new Date().toISOString();
  const tick = auditClock(at);
  const log = [];
  const ev = (action, ref, summary) => log.push({ actor, at: tick(), action, ref, summary });
  const rm = project.releaseManager || project.owner;
  const people = Object.fromEntries((docs.person || []).map(d => [d.id, d.data]));
  const pn = id => (people[id] && people[id].name) || 'the assigned person';
  const procDocs = (docs.process || []).filter(d => (project.processes || []).includes(d.id));
  const relId = 'rel-' + projectId.slice(0, 40) + '-' + Date.now().toString(36);
  const approvers = [...new Set((docs.approval || []).map(d => d.data)
    .filter(a => a.projectId === projectId && a.bu && !a.kind && a.decision === 'approved' && a.stepUp === true).map(a => a.approver))];
  const stepUp = stepUpOf(body, actor, at);
  const plan = Object.fromEntries(procDocs.map(pd => [pd.id, (Number(pd.data.version) || 1) + 1]));

  /* 1. approval with step-up, 2. pipeline started */
  ev('golive-approved', 'project:' + projectId, `Go-live of ${project.name} approved by ${pn(actor)} (step-up verified)`);
  ev('pipeline-started', 'release:' + relId, `Deployment pipeline started for ${project.name} (simulated)`);

  /* R5 step 3: pipeline (simulated). On failure: record it, notify the release manager only, no side effects. */
  if (simulateFailure) {
    const pipe = pipelineAction('golive', projectId, relId, plan);
    pipe.status = 'simulated-failed';
    pipe.detail += '\n\nRun result: failed at step "deploy automation" (simulated). Nothing was promoted, published or expired.';
    const release = { id: relId, kind: 'golive', status: 'failed', projectId, at, date: today, by: actor, approvers, stepUp, actions: [pipe,
      { type: 'notify', target: pn(rm), status: 'simulated-ok', detail: `Pipeline failure notice for ${project.name} sent to the release manager only.` }],
      exceptions: [], checks: JSON.parse(JSON.stringify(gate.checks)), snapshot: {} };
    /* 3. the one failure event */
    ev('golive-failed', 'project:' + projectId, `Go-live pipeline failed for ${project.name} (simulated); nothing was promoted, published or expired`);
    /* 4. notification */
    const nAt = tick();
    log.push({ actor, at: nAt, action: 'notify', ref: 'release:' + relId, summary: `Pipeline failure notice sent to the release manager (${pn(rm)})` });
    await store.putDoc(wsId, 'release', relId, release);
    const nid = 'ntf-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    await store.putDoc(wsId, 'notification', nid, { id: nid, to: rm, text: `Go-live pipeline failed for ${project.name}. Nothing was changed; fix and retry.`, ref: 'release:' + relId, at: nAt, read: false });
    for (const e of log) await store.appendEvent(wsId, e);
    return { status: 200, body: { ok: false, failed: true, release, project } };
  }
  /* 3. pipeline result */
  ev('pipeline-succeeded', 'release:' + relId, `Deployment pipeline succeeded for ${project.name} (simulated)`);

  /* 4. promotion (success only) */
  const snapshot = {}, promoted = [];
  for (const pd of procDocs) {
    const p = JSON.parse(JSON.stringify(pd.data));
    const prevVersion = Number(p.version) || 1;
    const version = prevVersion + 1;
    /* keep the pre-release version viewable (and restorable): as-is plus the to-be that replaced it */
    p.released = (p.released || []).concat([{ version: prevVersion, at, by: actor, asis: cloneNodes(p.asis, false), tobe: JSON.parse(JSON.stringify(p.tobe || [])) }]);
    const nodes = cloneNodes(p.tobe, false);
    p.asis = nodes;
    p.tobe = cloneNodes(nodes, true);
    p.version = version;          /* no updatedAt stamp: promotion must never make approvals stale (R3) */
    snapshot[p.id] = version;
    promoted.push(p);
    await store.putDoc(wsId, 'process', p.id, p);
    ev('release', 'process:' + p.id, `Released ${p.name} v${version}: to-be promoted to as-is (v${prevVersion} kept in history)`);
  }
  const liveAt = tick();
  const proj = Object.assign({}, project, { status: 'live', liveAt, liveDate: today });
  await store.putDoc(wsId, 'project', projectId, proj);
  log.push({ actor, at: liveAt, action: 'golive', ref: 'project:' + projectId, summary: `${project.name} went live` });
  /* 5. SOP publish */
  for (const p of promoted) ev('sop-publish', 'process:' + p.id, `Published ${p.name} v${snapshot[p.id]} as the controlled SOP; v${snapshot[p.id] - 1} archived`);
  /* 6. grants expired (requested ones are denied; their expiry is left alone: it never started) */
  for (const gd of (docs.grant || []).filter(d => d.data.projectId === projectId)) {
    const g = JSON.parse(JSON.stringify(gd.data));
    const next = g.status === 'active' || g.status === 'approved' ? 'expired' : g.status === 'requested' ? 'denied' : null;
    if (!next) continue;
    const gAt = tick();
    g.status = next;
    if (next === 'expired') g.expires = today;
    g.log = (g.log || []).concat([{ at: gAt, by: actor, action: next === 'expired' ? 'expired at go-live' : 'denied at go-live' }]);
    await store.putDoc(wsId, 'grant', g.id, g);
    log.push({ actor, at: gAt, action: next === 'expired' ? 'expire' : 'update', ref: 'grant:' + g.id, summary: `${describe('grant', g, docs)} ${next} at go-live` });
  }
  /* R4: go-live never flips data to live; only the data owner's confirmation (liveConfirmedBy + liveSource) does */
  const team = (project.resources || []).map(pn).join(', ');
  const release = {
    id: relId, kind: 'golive', status: 'succeeded', projectId, at, date: today, by: actor, approvers, stepUp,
    ...(body && body._override ? { override: body._override } : {}),
    actions: [pipelineAction('golive', projectId, relId, snapshot),
      ...procDocs.map(pd => ({ type: 'sop-publish', target: `SOP library: ${pd.data.name} v${snapshot[pd.id]}`, status: 'simulated-ok',
        detail: `Published the released process as the controlled SOP for ${pd.data.name}; v${snapshot[pd.id] - 1} was archived.` })),
      { type: 'notify', target: team, status: 'simulated-ok', detail: `Go-live notice for ${project.name} sent to the project team and process owners.` }],
    exceptions: releaseExceptions(docs, gate.checks.find(c => c.id === 'exceptions')),
    checks: JSON.parse(JSON.stringify(gate.checks)),
    snapshot,
  };
  await store.putDoc(wsId, 'release', relId, release);
  /* 7. notifications */
  ev('notify', 'release:' + relId, `Go-live notice for ${project.name} sent to ${team || 'the project team'}`);
  for (const e of log) await store.appendEvent(wsId, e);
  return { status: 200, body: { ok: true, release, project: proj } };
}

async function rollback(wsId, docs, project, actor, body, today) {
  const projectId = project.id;
  if (project.status !== 'live') return { status: 409, body: { error: 'only a live project can be rolled back', reasons: ['Project status is ' + (project.status || 'active') + '.'] } };
  const reason = String((body && body.reason) || '').slice(0, 500);
  const at = new Date().toISOString();
  const tick = auditClock(at);
  const log = [];
  const ev = (action, ref, summary) => log.push({ actor, at: tick(), action, ref, summary });
  const people = Object.fromEntries((docs.person || []).map(d => [d.id, d.data]));
  const pn = id => (people[id] && people[id].name) || 'the assigned person';
  const rm = project.releaseManager || project.owner;
  const procDocs = (docs.process || []).filter(d => (project.processes || []).includes(d.id));
  const relId = 'rel-' + projectId.slice(0, 36) + '-rb-' + Date.now().toString(36);
  const stepUp = stepUpOf(body, actor, at);
  /* R5: the go-live being reversed */
  const undoes = (docs.release || []).map(d => d.data).filter(r => r.projectId === projectId && r.kind === 'golive' && r.status !== 'failed' && !r.rolledBackBy)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null;
  /* what would be restored: each process whose previous released version exists */
  const plan = [];
  for (const pd of procDocs) {
    const cur = Number(pd.data.version) || 1;
    const released = pd.data.released || [];
    let idx = -1;
    for (let i = released.length - 1; i >= 0; i--) if (!released[i].rolledBack && released[i].version === cur - 1) { idx = i; break; }
    if (idx >= 0) plan.push({ pd, cur, idx });
  }
  const target = Object.fromEntries(plan.map(x => [x.pd.id, x.cur - 1]));

  /* R6: 1. rollback approved, 2. pipeline started */
  ev('rollback-approved', 'project:' + projectId, `Rollback of ${project.name} approved by ${pn(actor)} (step-up verified)` + (reason ? `: ${reason.slice(0, 120)}` : ''));
  ev('pipeline-started', 'release:' + relId, `Rollback pipeline started for ${project.name} (simulated)`);

  if (body && body.simulateFailure === true) {
    /* R6: a failed rollback restores nothing; one failure event; the release manager is told */
    const pipe = pipelineAction('rollback', projectId, relId, target);
    pipe.status = 'simulated-failed';
    pipe.detail += '\n\nRun result: failed at step "restore previous version" (simulated). Nothing was restored or re-published.';
    const release = { id: relId, kind: 'rollback', status: 'failed', projectId, at, date: today, by: actor, approvers: [], stepUp, reason,
      actions: [pipe, { type: 'notify', target: pn(rm), status: 'simulated-ok', detail: `Rollback failure notice for ${project.name} sent to the release manager only.` }],
      exceptions: [], snapshot: {}, undone: [], undoes: undoes ? undoes.id : null };
    ev('rollback-failed', 'project:' + projectId, `Rollback pipeline failed for ${project.name} (simulated); nothing was restored, the release stays live`);
    const nAt = tick();
    log.push({ actor, at: nAt, action: 'notify', ref: 'release:' + relId, summary: `Rollback failure notice sent to the release manager (${pn(rm)})` });
    await store.putDoc(wsId, 'release', relId, release);
    const nid = 'ntf-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    await store.putDoc(wsId, 'notification', nid, { id: nid, to: rm, text: `Rollback pipeline failed for ${project.name}. Nothing was restored; the release is still live.`, ref: 'release:' + relId, at: nAt, read: false });
    for (const e of log) await store.appendEvent(wsId, e);
    return { status: 200, body: { ok: false, failed: true, release, project } };
  }
  ev('pipeline-succeeded', 'release:' + relId, `Rollback pipeline succeeded for ${project.name} (simulated)`);

  /* 3. restore */
  const snapshot = {}, undone = [], restored = [];
  for (const { pd, cur, idx } of plan) {
    const p = JSON.parse(JSON.stringify(pd.data));
    const released = p.released || [];
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
    restored.push({ p, cur });
    await store.putDoc(wsId, 'process', p.id, p);
    ev('rollback', 'process:' + p.id, `Restored ${p.name} from v${cur} to v${cur - 1}`);
    undone.push({ type: 'process-version', target: p.name, from: cur, to: cur - 1, detail: `Restored the v${cur - 1} as-is and its designed to-be` });
  }
  const proj = Object.assign({}, project, { status: 'active', rolledBackAt: at });
  delete proj.liveAt;
  await store.putDoc(wsId, 'project', projectId, proj);
  /* 4. re-publish */
  for (const { p, cur } of restored) {
    ev('sop-publish', 'process:' + p.id, `Re-published ${p.name} SOP v${cur - 1}; v${cur} withdrawn`);
    undone.push({ type: 'sop-publish', target: `SOP library: ${p.name}`, from: cur, to: cur - 1, detail: `Re-published SOP v${cur - 1}; v${cur} withdrawn` });
  }
  undone.push({ type: 'grants', target: 'Access grants', detail: 'Grants expired at go-live stay expired (least privilege); request access again if needed' });
  ev('rollback', 'project:' + projectId, `${project.name} rolled back to the previous process versions`);
  const owner = project.cutover && project.cutover.rollbackOwner;
  const team = (project.resources || []).map(pn).join(', ');
  const release = {
    id: relId, kind: 'rollback', projectId, at, date: today, by: actor, approvers: [], stepUp,
    actions: [pipelineAction('rollback', projectId, relId, snapshot),
      ...procDocs.filter(pd => snapshot[pd.id]).map(pd => ({ type: 'sop-publish', target: `SOP library: ${pd.data.name} v${snapshot[pd.id]}`, status: 'simulated-ok',
        detail: `Re-published v${snapshot[pd.id]} of ${pd.data.name} as the controlled SOP; v${snapshot[pd.id] + 1} was withdrawn.` })),
      { type: 'notify', target: team, status: 'simulated-ok',
        detail: `Rollback notice for ${project.name}` + (owner && people[owner] ? `; rollback owner ${people[owner].name}.` : '.') }],
    reason, exceptions: [], snapshot,
    status: 'succeeded', undone, undoes: undoes ? undoes.id : null,
  };
  await store.putDoc(wsId, 'release', relId, release);
  if (undoes) await store.putDoc(wsId, 'release', undoes.id, Object.assign({}, undoes, { rolledBackBy: relId, rolledBackAt: at }));
  /* 5. notifications */
  ev('notify', 'release:' + relId, `Rollback notice for ${project.name} sent to ${team || 'the project team'}`);
  for (const e of log) await store.appendEvent(wsId, e);
  return { status: 200, body: { ok: true, release, project: proj } };
}

const ROUTE_MODULES = ['pmoflow-routes-buyer', 'pmoflow-routes-connect', 'pmoflow-routes-admin', 'pmoflow-routes-change']
  .map(n => { try { return require('../shared/' + n); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return null; } })
  .filter(m => m && typeof m.handle === 'function');

const ADMIN_ROUTES = ROUTE_MODULES.find(m => typeof m.roleError === 'function') || null;

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
    let body = parseBody(req);
    if (body === null) return fail(400, 'body must be JSON');

    /* R10: stream-owned route modules (buyer layer, connections, admin). Each exports
       handle({ method, seg, body, req, store, send, fail, clientIpHash, dayInput, clientToday }) → true when it handled the request.
       A module that is missing simply isn't loaded, so streams can land independently. */
    for (const mod of ROUTE_MODULES) {
      if (await mod.handle({ method, seg, body, req, store, send, fail, clientIpHash, dayInput, clientToday })) return;
    }

    /* POST /workspaces */
    if (seg[0] === 'workspaces' && seg.length === 1) {
      if (method !== 'POST') return fail(405, 'method not allowed');
      try {
        /* R8 §2: the demo is dated from the visitor's own today (within 2 days of the server's UTC date) */
        const ws = await store.createWorkspace(clientIpHash(req), { seedDate: clientToday(dayInput(req, body), new Date().toISOString().slice(0, 10)) });
        return send(201, { id: ws.id });
      } catch (e) {
        /* R8 §8: one plain message, nothing else */
        if (e.status === 429) return send(429, { error: RATE_LIMIT_MSG });
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
    const serverToday = new Date().toISOString().slice(0, 10);
    /* R8 §2: "today" is the client's local date (body.today, or ?today= on GET), accepted within 2 days of the server's UTC date */
    const today = clientToday(dayInput(req, body), serverToday);

    /* GET /ws/:ws/state */
    if (action === 'state' && seg.length === 3) {
      if (method !== 'GET') return fail(405, 'method not allowed');
      return send(200, await store.getState(ws, today));
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
        /* R10 S5: workspace roles (Viewer / Approver / admin-only settings) */
        const rd = ADMIN_ROUTES && ADMIN_ROUTES.roleError ? ADMIN_ROUTES.roleError(st.docs, actor, type) : null;
        if (rd) return fail(403, rd);
        /* R5 [S]: permissions */
        const denied = permissionError(type, prev && prev.data, data, actor, st.docs);
        if (denied) return fail(403, denied);
        if (type === 'project') {
          const bad = approversError(prev && prev.data, data, st.docs);
          if (bad) return fail(400, bad);
        }
        /* R11 §2: separation of duties */
        if (type === 'testRun') {
          const bad = testRunError(prev && prev.data, data, actor, st.docs);
          if (bad) return fail(403, bad);
        }
        if (type === 'approval') {
          const bad = approvalError(prev && prev.data, data, actor, st.docs);
          if (bad) return fail(403, bad);
        }
        /* R6: a grant's time box starts at approval: an approved or active grant expires within 30 days of it */
        if (type === 'grant') {
          const bad = grantExpiryError(data, prev && prev.data);
          if (bad) return fail(400, bad);
        }
        /* R5: cutover edits are stamped so approvals taken before them go stale */
        if (type === 'project' && cutoverStructureChanged(prev && prev.data.cutover, data.cutover) &&
          (!data.cutoverUpdatedAt || (prev && prev.data.cutoverUpdatedAt === data.cutoverUpdatedAt))) data.cutoverUpdatedAt = new Date().toISOString();
        /* R8 §2: an approval decision is dated with the approver's own today (the timestamp stays ISO) */
        if (type === 'approval' && data.decision && (!data.date || !(prev && prev.data.decision === data.decision))) data.date = today;
        /* R9 §3 (bug B8): a done date is the client's local today, never the server's UTC date. A missing or timestamp
           doneAt becomes today (or keeps the earlier done date); a date after the client's today (a UTC slice taken in
           the evening) is clamped to today. */
        if (type === 'workItem' && data.status === 'done') {
          const wasDone = !!(prev && prev.data.status === 'done');
          const prevDay = wasDone && isDay(prev.data.doneAt) ? prev.data.doneAt : null;
          if (!isDay(data.doneAt)) data.doneAt = prevDay || today;
          else if (data.doneAt > today && data.doneAt !== prevDay) data.doneAt = today;
        }
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
        const rdel = ADMIN_ROUTES && ADMIN_ROUTES.roleError ? ADMIN_ROUTES.roleError(st.docs, actor, type) : null;
        if (prev && rdel) return fail(403, rdel);
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
      const w = await store.resetWorkspace(ws, today);
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
        /* a count only (non-empty values repeating an earlier value), never the values: specDrift flags it against a
           field whose spec is unique (e.g. "Required, unique per vendor") */
        if (typeof c.duplicates === 'number' && isFinite(c.duplicates)) o.duplicates = Math.max(0, Math.floor(c.duplicates));
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
      /* R7: reports are dated with the client's own today (no server/local skew); only a date within 2 days of the server is accepted */
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
      /* R11 §2/§3: before the window or with launch-day steps open, launching needs a two-person override (the PM and a
         sponsor or approver, both with step-up). Nobody, the launch owner or an Admin included, overrides alone. */
      const eng = engine();
      if (action === 'golive' && project.status !== 'live' && eng && typeof eng.launchOverrideStatus === 'function' && eng.readiness(st.docs, projectId, today).pass) {
        const ov = eng.launchOverrideStatus(st.docs, projectId, localNowOf(body, today));
        if (!ov.ok) return send(409, { error: 'launch locked', reasons: ov.guard.why.map(w => w.charAt(0).toUpperCase() + w.slice(1) + '.').concat([ov.text]) });
        if (ov.overridden) body = Object.assign({}, body, { _override: { signoffs: ov.signoffs, guard: ov.guard.why } });
      }
      const r = action === 'golive'
        ? await goLive(wsId, st.docs, project, actorOf(body), today, body.simulateFailure === true, body)
        : await rollback(wsId, st.docs, project, actorOf(body), body, today);
      return send(r.status, r.body);
    }

    return fail(404, 'unknown route');
  } catch (e) {
    context.log && context.log('[pmoflow] ' + (e && e.message ? e.message.slice(0, 200) : 'error'));
    return fail(e && e.status === 503 ? 503 : 500, 'server error');
  }
};

module.exports._internal = { testRunError, approvalError, localNowOf, RATE_LIMIT_MSG, dayInput, clientIpHash, clientToday, approversError, cloneNodes, localProfile, releaseExceptions, describe, grantExpiryError, auditClock, WS_RE, ID_RE };
