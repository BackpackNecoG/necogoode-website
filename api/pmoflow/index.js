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
/* R16 N1 #1: the hosted sign-in (Azure Static Web Apps) as the platform passes it: base64 JSON {userId, userDetails,
   identityProvider, userRoles}. null without one (the open demo). */
function principalOf(req) {
  const h = req && req.headers ? (req.headers['x-ms-client-principal'] || req.headers['X-MS-CLIENT-PRINCIPAL']) : null;
  if (!h) return null;
  try { const p = JSON.parse(Buffer.from(String(h), 'base64').toString('utf8')); return p && typeof p === 'object' && (p.userId || p.userDetails) ? p : null; } catch (e) { return null; }
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

/* the project whose changed information a data case belongs to (the first linked one), for the assignment rule */
function projectOfCase(docs, dataId) {
  const eng = engine(); if (!eng || !dataId) return null;
  const p = (docs.project || []).find(d => d.data && d.data.status !== 'live' && (eng.changedInformation(docs, d.id) || []).some(x => x.dataId === dataId));
  return p ? p.id : null;
}
/* R13 (PMO expert r13, audit forgery): the history sentence is written by the SERVER from the actual change. The client's
   summary is kept only as a quoted note after it, so "Comment added" can no longer stand in for a status change. */
const DIFF_SKIP = new Set(['id', 'updatedAt', 'createdAt', 'snapshotAt', 'fingerprint', 'cutoverUpdatedAt']);
const PERSON_FIELDS = new Set(['owner', 'sponsor', 'releaseManager', 'testLead', 'approver', 'tester', 'assignedBy', 'requestedBy', 'by']);
function fieldLabel(k) { return String(k).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); }
const STATUS_WORD = { idle: 'Not started', prog: 'In progress', done: 'Done', blocked: 'Blocked', requested: 'Requested', approved: 'Approved',
  active: 'Active', expired: 'Expired', revoked: 'Revoked', rejected: 'Changes asked for', pass: 'Passed', fail: 'Failed', missing: 'Not available', pending: 'Pending' };
function fmtVal(docs, k, v) {
  if (v == null || v === '') return 'none';
  if ((PERSON_FIELDS.has(k) || /By$/.test(k)) && typeof v === 'string') return personName(docs, v);
  if ((k === 'status' || k === 'decision' || k === 'avail' || k === 'outcome') && STATUS_WORD[v]) return STATUS_WORD[v];
  if (Array.isArray(v)) return v.length + ' item' + (v.length === 1 ? '' : 's');
  if (typeof v === 'object') return 'set';
  const t = String(v); return t.length > 40 ? '“' + t.slice(0, 37) + '…”' : typeof v === 'string' ? '“' + t + '”' : t;
}
function changeText(docs, prevData, data) {
  const out = []; const a = prevData || {}, b = data || {};
  /* server timestamps (…At) are recorded on the event itself; they are not "changes" a person made */
  const keys = [...new Set(Object.keys(a).concat(Object.keys(b)))].filter(k => !DIFF_SKIP.has(k) && !/At$/.test(k) && !/Ts$/.test(k) && k !== 'doneBy');
  for (const k of keys) {
    const x = a[k], y = b[k];
    if (JSON.stringify(x === undefined ? null : x) === JSON.stringify(y === undefined ? null : y)) continue;
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
      const sub = [...new Set(Object.keys(x).concat(Object.keys(y)))].filter(s => JSON.stringify(x[s] == null ? null : x[s]) !== JSON.stringify(y[s] == null ? null : y[s]));
      sub.slice(0, 3).forEach(s => out.push(fieldLabel(k) + ' ' + fieldLabel(s) + ' ' + fmtVal(docs, s, x[s]) + ' → ' + fmtVal(docs, s, y[s])));
      continue;
    }
    if (k === 'time' && Array.isArray(y)) {
      /* R14 PMO-A3: hours entries are spelled out with the server's logging time and "backdated" */
      const eng = engine(); const was = new Set((Array.isArray(x) ? x : []).map(t => JSON.stringify(t)));
      const added = y.filter(t => !was.has(JSON.stringify(t)));
      const removed = (Array.isArray(x) ? x : []).length - (y.length - added.length);
      const pos = added.filter(t => !(+t.hours < 0)), neg = added.filter(t => +t.hours < 0);
      const line = l => l.slice(0, 3).map(t => (eng && eng.timeEntryText ? eng.timeEntryText(t) : (t.hours + ' hours')) + (t.by ? ' by ' + personName(docs, t.by) : '')).join('; ');
      if (pos.length) out.push('hours logged: ' + line(pos));
      if (neg.length) out.push('hours corrected: ' + line(neg));
      if (removed > 0) out.push(removed + ' hours entr' + (removed === 1 ? 'y' : 'ies') + ' removed');
      /* R16 N1 #2: History shows the hours and dollars before and after */
      if ((added.length || removed > 0) && eng && typeof eng.hoursTotals === 'function') {
        const tb = eng.hoursTotals(docs, Object.assign({}, a, { time: Array.isArray(x) ? x : [] })), ta = eng.hoursTotals(docs, b);
        out.push('total ' + tb.text + ' → ' + ta.text);
      }
      continue;
    }
    if (Array.isArray(x) || Array.isArray(y)) { out.push(fieldLabel(k) + ' ' + fmtVal(docs, k, x || []) + ' → ' + fmtVal(docs, k, y || [])); continue; }
    out.push(fieldLabel(k) + ' ' + fmtVal(docs, k, x) + ' → ' + fmtVal(docs, k, y));
  }
  return out.length ? (out.length > 8 ? out.slice(0, 8).join('; ') + '; and ' + (out.length - 8) + ' more' : out.join('; ')) : 'no field changed';
}
function serverSummary(body, base, changes) {
  let note = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim().slice(0, 200) : '';
  /* R14 PMO-A2: the person's note is kept, quoted after the server's sentence, but neutralised so it can never look
     like a server-written change ("$48,000 → $90,000" reads "$48,000 to $90,000" inside the quote) */
  note = note.replace(/\s*(→|->|=>)\s*/g, ' to ');
  /* R16 N1 (flaky e2e "R6 history: resize summarised"): History keeps 300 characters, so a long change list is shortened
     here, never the person's note at the end ("Resized … on the timeline (+2d)") */
  const tail = note && note !== base ? ' (note: “' + note.replace(/[“”]/g, '"') + '”)' : '';
  let ch = changes ? ': ' + changes : '';
  const room = 280 - base.length - tail.length;
  if (ch.length > room) ch = room > 12 ? ch.slice(0, room - 1).replace(/[;,]?\s*\S*$/, '') + '…' : '';
  return base + ch + tail;
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

/* R14 PMO-A1: task ownership, enforced on every workItem write. Only the owner, the project manager, the launch owner or
   an Admin change a task's fields or hours. An unowned task may be picked up by anyone who can edit; a problem's
   reporter may move it through its states; a process owner may move work between steps when a step is removed; a
   confirmation of someone else's Done is the confirmer's own. */
/* server stamps: the client's copy may not have them yet (it keeps what it sent), so they never count as a change */
const WI_SERVER = new Set(['updatedAt', 'createdAt', 'doneBy', 'confirmedAt', 'createdTs', 'assignedTs', 'startedTs', 'doneTs', 'firstDoneAt']);
/* R15 #6: the flags the server stamps on an hours entry never count as a change by the client */
const TIME_STAMPS = { at: undefined, backdated: undefined, future: undefined, overDay: undefined, beforeStart: undefined };
const normWI = (k, v) => (k === 'time' && Array.isArray(v) ? v.map(t => (t && typeof t === 'object' ? Object.assign({}, t, TIME_STAMPS) : t)) : v);
function changedKeys(a, b) {
  return [...new Set(Object.keys(a || {}).concat(Object.keys(b || {})))].filter(k => !WI_SERVER.has(k) &&
    JSON.stringify(normWI(k, (a || {})[k] === undefined ? null : a[k])) !== JSON.stringify(normWI(k, (b || {})[k] === undefined ? null : b[k])));
}
function workItemError(prev, next, actor, docs) {
  if (!prev) return null;
  const changed = changedKeys(prev, next);
  if (!changed.length) return null;
  const project = ((docs.project || []).find(d => d.id === (prev.projectId || next.projectId)) || {}).data || {};
  const role = ADMIN_ROUTES && typeof ADMIN_ROUTES.roleOf === 'function' ? ADMIN_ROUTES.roleOf(docs, actor) : null;
  const owned = prev.owner && (docs.person || []).some(d => d.id === prev.owner);
  if (!owned || actor === prev.owner || actor === project.owner || actor === (project.releaseManager || project.owner) || role === 'admin') return null;
  const only = keys => changed.every(k => keys.includes(k));
  if (only(['confirmedBy']) && next.confirmedBy === actor) return null;
  const reporter = Array.isArray(prev.stateLog) && prev.stateLog[0] ? prev.stateLog[0].by : null;
  if (prev.kind === 'defect' && reporter === actor && only(['defectStatus', 'status', 'stateLog', 'doneAt'])) return null;
  /* a passing retest the actor recorded verifies the problem (state fields only, and only to "verified") */
  if (prev.kind === 'defect' && next.defectStatus === 'verified' && only(['defectStatus', 'status', 'stateLog', 'verifiedByRun']) &&
    ((docs.testRun || []).find(d => d.id === next.verifiedByRun) || {}).data && ((docs.testRun || []).find(d => d.id === next.verifiedByRun).data.by === actor)) return null;
  const proc = ((docs.process || []).find(d => d.id === prev.pid) || {}).data;
  if (proc && only(['step', 'deps']) && [proc.owner].concat(proc.resources || []).includes(actor)) return null;
  const title = prev.title || 'this task';
  return `Only ${personName(docs, prev.owner)} (the task owner), ${personName(docs, project.owner)} (the project manager) or an Admin can change “${title}”${changed.includes('time') ? ' or log hours on it' : ''}.`;
}
/* R14 PMO-1/A3 server stamps on a task: the doer of a Done, the confirmer's time, the time each hours entry was logged */
function stampWorkItem(prev, data, actor, today, docs) {
  const wasDone = !!(prev && prev.status === 'done');
  /* R14 PMO-7: exact server times for the report's "since the last report" (the client's day fields stay as they are) */
  const nowTs = new Date().toISOString();
  const keep = k => { if (prev && prev[k]) data[k] = prev[k]; else delete data[k]; };
  if (!prev) data.createdTs = nowTs; else keep('createdTs');
  if (data.owner && (!prev || prev.owner !== data.owner)) data.assignedTs = nowTs; else if (data.owner) keep('assignedTs'); else delete data.assignedTs;
  if (data.status && data.status !== 'idle' && (!prev || !prev.status || prev.status === 'idle') && !(prev && prev.startedTs)) data.startedTs = nowTs; else keep('startedTs');
  if (data.status === 'done' && !wasDone) data.doneTs = nowTs; else if (data.status === 'done') keep('doneTs'); else delete data.doneTs;
  if (data.status === 'done' && !wasDone) data.doneBy = actor;
  else if (data.status === 'done' && wasDone) { if (prev.doneBy) data.doneBy = prev.doneBy; else delete data.doneBy; }
  else { delete data.doneBy; delete data.confirmedBy; delete data.confirmedAt; }
  if (data.status === 'done' && data.confirmedBy) {
    if (!(prev && prev.confirmedBy === data.confirmedBy)) data.confirmedAt = new Date().toISOString();
    else data.confirmedAt = prev.confirmedAt || new Date().toISOString();
  } else delete data.confirmedAt;
  if (Array.isArray(data.time)) {
    const was = new Map(((prev && Array.isArray(prev.time)) ? prev.time : []).map(t => { const k = JSON.stringify(Object.assign({}, t, TIME_STAMPS)); return [k, t]; }));
    const now = new Date().toISOString();
    const eng = engine();
    /* R15 #6 (PMO): hours per person per day across every task, so more than 24 hours in one day is flagged */
    const dayHours = {};
    const addH = (who, t) => { if (!who || !t || !isDay(t.date) || !(isFinite(+t.hours) && +t.hours > 0)) return; const k = who + '|' + t.date; dayHours[k] = (dayHours[k] || 0) + +t.hours; };
    ((docs && docs.workItem) || []).forEach(d => { if (!d || !d.data || d.id === data.id) return; (Array.isArray(d.data.time) ? d.data.time : []).forEach(t => addH((t && t.by) || d.data.owner, t)); });
    data.time.forEach(t => addH((t && t.by) || data.owner, t));
    data.time = data.time.filter(t => t && typeof t === 'object').map(t => {
      const k = JSON.stringify(Object.assign({}, t, TIME_STAMPS));
      const o = Object.assign({}, t, TIME_STAMPS);
      /* an entry already stored keeps the stamps it was given; only a new entry is stamped now */
      if (was.has(k)) { const p = was.get(k); ['at', 'backdated', 'future', 'overDay', 'beforeStart'].forEach(x => { if (p[x]) o[x] = p[x]; }); }
      else {
        o.at = now; if (isDay(o.date) && o.date < today) o.backdated = true;
        Object.assign(o, eng && typeof eng.hoursFlags === 'function' ? eng.hoursFlags(null, data, o, today, dayHours[((o.by) || data.owner) + '|' + o.date]) : {});
      }
      Object.keys(o).forEach(x => { if (o[x] === undefined) delete o[x]; });
      return o;
    });
  }
  /* R15 #6 (PMO): the first completion date is kept; a reopen and re-Done never overwrites it */
  const eng2 = engine();
  if (eng2 && typeof eng2.keepFirstDone === 'function') {
    const k = eng2.keepFirstDone(prev, data);
    if (k.firstDoneAt) data.firstDoneAt = k.firstDoneAt; else delete data.firstDoneAt;
    if (data.status === 'done' && k.doneAt) data.doneAt = k.doneAt;
  }
  return data;
}
function confirmError(prev, data, actor, docs) {
  if (!data.confirmedBy || (prev && prev.confirmedBy === data.confirmedBy)) return null;
  if (data.status !== 'done') return 'Only a finished task can be confirmed as done.';
  if (data.confirmedBy !== actor) return `Confirmations are given under your own name: ${personName(docs, actor)} can't confirm as ${personName(docs, data.confirmedBy)}.`;
  const doer = data.doneBy || data.owner;
  if (doer === actor) return `${personName(docs, actor)} marked “${data.title || 'this task'}” done, so someone else confirms it.`;
  return null;
}
/* R14 PMO-S1/PMO-11: a task write that moves the project's finish past its deadline goes through Change the plan; a due
   date is a working day. Status-only writes (Done, hours, problem states) are never refused for the deadline. */
const SCHEDULE_KEYS = ['due', 'start', 'effortDays', 'cost', 'deps', 'pid', 'step', 'resolves', 'projectId', 'status'];
function scheduleError(prev, data, docs, today) {
  const eng = engine();
  if (!eng || typeof eng.deadlineBreach !== 'function') return null;
  if ((!prev || prev.due !== data.due) && data.due && data.due !== today && typeof eng.dueDateProblem === 'function') {
    const p = eng.dueDateProblem(data.due, docs);
    if (p) return { status: 400, body: { error: p.text, day: p } };
  }
  /* R15 #4 (PMO): a start after the due date, or on a day off, is refused */
  if (typeof eng.startDateProblem === 'function' && data.start && (!prev || prev.start !== data.start || prev.due !== data.due)) {
    const sp = eng.startDateProblem(data, docs);
    if (sp && (sp.kind === 'after-due' || !prev || prev.start !== data.start)) return { status: 400, body: { error: sp.text, start: sp } };
  }
  if (data.kind === 'defect') return null;
  const changed = changedKeys(prev, data).filter(k => SCHEDULE_KEYS.includes(k));
  /* reopening or finishing work is never refused for the deadline; only plan moves are */
  const statusOnly = changed.every(k => k === 'status');
  if (prev && (!changed.length || statusOnly)) return null;
  const projectId = data.projectId || (prev && prev.projectId);
  const project = ((docs.project || []).find(d => d.id === projectId) || {}).data;
  if (!project) return null;
  /* a brand-new task in a project still being planned (no saved plan yet) is part of drafting the plan */
  if (!prev && !(Array.isArray(project.baselines) && project.baselines.length)) return null;
  /* R16 N1 #7 (PMO): an added dependency moves the dependent's start (and due, keeping its length) to after the work it
     now waits on; if that breaks the deadline, the deadline guard below refuses it */
  let shift = null;
  if (prev && changed.includes('deps') && typeof eng.dependencyShift === 'function') {
    shift = eng.dependencyShift(docs, prev, data.deps, today);
    if (shift && shift.moved) { data.start = shift.start; if (shift.due) data.due = shift.due; }
  }
  const after = Object.assign({}, docs, { workItem: (docs.workItem || []).filter(d => d.id !== data.id).concat([{ id: data.id, data }]) });
  const b = eng.deadlineBreach(docs, after, projectId, today);
  if (b) return { status: 409, body: { error: 'Use “Change the plan” to move this work past the deadline, so the sponsor can approve it. ' + (shift && shift.moved ? shift.text + ' ' : '') + b.text, reasons: [b.text], deadline: b } };
  /* R15 #4 / R16 #7 (PMO): an effort or cost edit (or a new task with a cost) that raises the expected cost past the
     tolerance, or over the budget, goes through Change the plan too (a new task is planned through Change the plan's
     "add work" or the plan itself, as before) */
  const costKeys = changedKeys(prev, data).filter(k => k === 'effortDays' || k === 'cost');
  if (prev && costKeys.length && Array.isArray(project.baselines) && project.baselines.length && typeof eng.costBreach === 'function') {
    const c = eng.costBreach(docs, after, projectId, today);
    if (c) return { status: 409, body: { error: 'Use “Change the plan” to change this ' + (costKeys.includes('cost') && !costKeys.includes('effortDays') ? 'cost' : prev ? 'effort' : 'work') + ', so the sponsor can approve the cost. ' + c.text, reasons: [c.text], cost: c } };
  }
  return null;
}
/* R14 PMO-S2/S3: the sponsor and the saved plan are the sponsor's controls */
function projectGuardError(prev, next, actor, docs) {
  if (!prev) return next.sponsor && next.sponsor === next.owner ? { status: 403, body: { error: `${personName(docs, next.owner)} is the project manager, so they can't also be the sponsor. Choose someone else.` } } : null;
  /* R15 #3 (PMO, Jordan): the project manager role changes hands only through "Change the plan", once the project has
     work, so the sponsor (or an Admin when no sponsor is set) approves it */
  const hasWork = (docs.workItem || []).some(w => w.data && w.data.projectId === (next.id || prev.id));
  if ((prev.owner || null) !== (next.owner || null) && hasWork)
    return { status: 409, body: { error: `Use “Change the plan” to hand the project manager role to ${next.owner ? personName(docs, next.owner) : 'someone else'}, so the sponsor can approve it.` } };
  if ((prev.sponsor || null) !== (next.sponsor || null)) {
    /* R14 (L4): the one sponsor rule, shared with PUT /workspaces/:ws/admin/sponsor/:projectId */
    if (ADMIN_ROUTES && typeof ADMIN_ROUTES.sponsorError === 'function') {
      const t = ADMIN_ROUTES.sponsorError(docs, actor, prev, next.sponsor || null);
      if (t) return { status: 403, body: { error: t } };
    } else {
    const role = ADMIN_ROUTES && typeof ADMIN_ROUTES.roleOf === 'function' ? ADMIN_ROUTES.roleOf(docs, actor) : null;
    if (next.sponsor && next.sponsor === (next.owner || prev.owner)) return { status: 403, body: { error: `${personName(docs, next.sponsor)} is the project manager, so they can't also be the sponsor. Choose someone else.` } };
    if (prev.sponsor && actor !== prev.sponsor && role !== 'admin') return { status: 403, body: { error: `Only an Admin or the current sponsor (${personName(docs, prev.sponsor)}) can change the sponsor.` } };
    }
  }
  const bl = d => JSON.stringify(Array.isArray(d.baselines) ? d.baselines : []);
  if (Array.isArray(prev.baselines) && prev.baselines.length && bl(prev) !== bl(next))
    return { status: 409, body: { error: 'Use “Change the plan” to save a new plan, so the sponsor can approve it.' } };
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
    // R15 #5 (Jordan): whoever assigned a test (themselves included) can't pass it in ANY environment
    if (next.env !== 'uat' && typeof eng.canPassTest === 'function') {
      const refused = passes.map(k => eng.canPassTest(flat, next.projectId, k, actor, { env: next.env || 'sit' })).filter(x => x && x.rule === 'assigner');
      if (refused.length) return refused.length === 1 ? refused[0].text : `${refused[0].text} (${refused.length} of the ${passes.length} selected tests can't be passed by ${personName(docs, actor)}.)`;
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
  if (bar) return bar.text;
  /* R16 N1 #4 (Jordan): only someone who may approve this part now (still in the department or a named or chosen
     approver, and not a recent joiner) approves it; the refusal says why, to the person ("You joined …") */
  /* R16 N1 #5 (Jordan): a part with nothing to sign can't be approved (its approval would never count) */
  if (typeof eng.buReady === 'function' && next.bu && !next.kind) {
    const nb = eng.buReady(docs, next.projectId, next.bu);
    if (nb && nb.needed === false) return nb.sentence;
  }
  if (typeof eng.approverStatus === 'function' && next.bu && !next.kind) {
    const as = eng.approverStatus(docs, next.projectId, next.bu, actor);
    if (as && !as.eligible) return as.you || as.text;
  }
  /* R13 #3: ONE approval-readiness rule for Simple and Advanced: a part is approved only when it is ready */
  if (typeof eng.buReady === 'function' && next.bu && !next.kind) {
    const br = eng.buReady(docs, next.projectId, next.bu);
    if (br && br.needed && !br.ready) return br.sentence;
  }
  return null;
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
    /* R13 #11: a launch on a two-person override is an exception too (outside the window or with steps still open) */
    /* R14 (Jordan C): ONE exception per overridden condition, so the count says how many conditions were overridden */
    exceptions: releaseExceptions(docs, gate.checks.find(c => c.id === 'exceptions')).concat(body && body._override ? ((body._override.guard || []).length ? body._override.guard : ['outside the launch window']).map((g, i) => ({ ref: 'release:' + relId + (i ? '#' + i : ''),
      summary: `Launched with a two-person override (${(body._override.signoffs || []).map(x => x.name).filter(Boolean).join(' and ') || 'two people'}): ${g}`,
      by: pn(actor), at, override: true })) : []),
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
  const send = (status, body, headers) => {
    /* R13: route modules may add response headers (e.g. Set-Cookie for the returning-visitor sandbox, Retry-After) */
    const extra = headers && typeof headers === 'object' ? headers : {};
    context.res = { status, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, extra), body };
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
    /* R14 (Jordan r14 #2): a write a route module refuses (403/409) on a workspace is recorded in History as "Refused: …",
       written by the server, the same as a refused doc write. GETs and non-workspace routes are not logged. */
    const modWs = (seg[0] === 'ws' || seg[0] === 'workspaces') && seg[1] && /^[a-z0-9]{12,32}$/.test(seg[1]) ? seg[1] : null;
    const modFail = (status, msg, reasons) => {
      const out = fail(status, msg, reasons);
      if (modWs && method !== 'GET' && (status === 403 || status === 409)) pendingLogs.push((async () => {
        try {
          const what = seg.slice(2).filter(x => !/^[a-z0-9_-]{12,}$/i.test(x)).join(' ').replace(/[^\w .-]/g, '').slice(0, 60) || 'change';
          await store.appendEvent(modWs, { actor: actorOf(body || {}), action: 'refused', ref: 'route:' + seg.slice(2, 4).join('/').slice(0, 100),
            summary: `Refused: ${what} — ${String((msg && msg.error) || msg || 'not allowed').replace(/\s+/g, ' ')}`.slice(0, 300) });
        } catch (e) { /* the refusal stands even if History can't be written */ }
      })());
      return out;
    };
    const pendingLogs = [];
    /* R16 N1 #1 (PMO top 1): identity binding and fresh step-ups, for every workspace write (route modules included).
       - Hosted sign-in (Azure Static Web Apps puts x-ms-client-principal on the request; a browser can't set it there):
         the actor is the person linked to that sign-in. Acting as anyone else is refused (403) and logged.
       - Every step-up the write carries is checked against the server clock: older than 10 minutes, or in the
         future, is refused (403) and logged. The server then records its own time (stepUpAt / stepUp.at).
       - The open demo (no principal) keeps the "Viewing as" switcher; the step-up check still applies. */
    if (modWs && method !== 'GET') {
      const eng = engine();
      const nowIso = new Date().toISOString();
      const gateRefuse = async (msg, ref) => {
        try { await store.appendEvent(modWs, { actor: actorOf(body || {}), action: 'refused', ref: String(ref || ('route:' + seg.slice(2, 4).join('/'))).slice(0, 100), summary: `Refused: ${String(msg).replace(/\s+/g, ' ')}`.slice(0, 300) }); } catch (e) { /* the refusal stands */ }
        return fail(403, msg);
      };
      const principal = principalOf(req);
      let gateDocs = null;
      const docsNow = async () => { if (gateDocs) return gateDocs; const w = await store.getWorkspace(modWs); gateDocs = w && !w.expired ? (await store.getState(w)).docs : null; return gateDocs; };
      if (principal && eng && typeof eng.personForPrincipal === 'function') {
        const docs = await docsNow();
        if (docs) {
          const pid = eng.personForPrincipal(docs, principal);
          const who = String(principal.userDetails || 'this sign-in').slice(0, 80);
          if (!pid) return gateRefuse(`${who} isn't linked to anyone in this workspace. Ask an Admin to add you.`);
          if (typeof body.actor === 'string' && body.actor && body.actor !== pid)
            return gateRefuse(`You're signed in as ${personName(docs, pid)}, so you can't act as ${personName(docs, body.actor)}.`);
          body.actor = pid;
        }
      }
      if (eng && typeof eng.stepUpProblem === 'function') {
        if (isPlainObject(body.stepUp)) {
          const pr = eng.stepUpProblem(body.stepUp.at, nowIso);
          if (pr) return gateRefuse(pr.text);
          body.stepUp = { method: 'simulated-mfa', at: nowIso };
          body.stepUpAt = nowIso;
        }
        /* a claimed step-up on an approval or a test-run doc (data.stepUp): its stamp is stepUp.at, else stepUpAt, else at */
        if (seg[0] === 'ws' && seg[2] === 'doc' && ['approval', 'testRun'].includes(seg[3]) && method === 'PUT' && isPlainObject(body.data) && body.data.stepUp) {
          const d = body.data;
          const docs = await docsNow();
          const prev = docs ? (((docs[seg[3]] || []).find(x => x.id === seg[4]) || {}).data || null) : null;
          const same = prev && prev.stepUp && (() => { const strip = o => JSON.stringify(Object.keys(o || {}).filter(k => !['updatedAt', 'stepUpAt', 'stepUp'].includes(k)).sort().map(k => [k, o[k]])); return strip(prev) === strip(d); })();
          if (same) { d.stepUp = prev.stepUp; if (prev.stepUpAt) d.stepUpAt = prev.stepUpAt; else delete d.stepUpAt; }
          else {
            const stamp = isPlainObject(d.stepUp) ? d.stepUp.at : (d.stepUpAt || d.at);
            const pr = eng.stepUpProblem(stamp, nowIso);
            if (pr) return gateRefuse(pr.text, `${seg[3]}:${seg[4]}`);
            if (isPlainObject(d.stepUp)) d.stepUp = { method: 'simulated-mfa', at: nowIso };
            d.stepUpAt = nowIso;
          }
        }
      }
    }
    for (const mod of ROUTE_MODULES) {
      const handled = await mod.handle({ method, seg, body, req, store, send, fail: modFail, clientIpHash, dayInput, clientToday });
      if (pendingLogs.length) await Promise.all(pendingLogs);
      if (handled) return;
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

    /* R13 #1 POST /ws/:ws/departments {op, actor}: departments are workspace data (settings.departments). Admins and
       Editors add one (the approver panel's "Add a department"); rename, remove, approvers and assign are Admin only.
       The engine's departmentEdit decides; this writes the settings doc (every other field kept) plus the person,
       process and project patches it returns, and appends one audit event. */
    if (action === 'departments' && seg.length === 3) {
      if (method !== 'POST') return fail(405, 'method not allowed');
      const eng = engine();
      const op = isPlainObject(body.op) ? body.op : null;
      if (!op || typeof op.kind !== 'string') return fail(400, 'op is required');
      const actor = actorOf(body);
      const st = await store.getState(ws);
      const role = ADMIN_ROUTES && typeof ADMIN_ROUTES.roleOf === 'function' ? ADMIN_ROUTES.roleOf(st.docs, actor) : null;
      const nm = personName(st.docs, actor);
      if (op.kind === 'add' ? !(role === 'admin' || role === 'editor') : role !== 'admin') {
        const admins = ADMIN_ROUTES && typeof ADMIN_ROUTES.effectiveRoles === 'function' ? ADMIN_ROUTES.effectiveRoles(st.docs).filter(p => p.role === 'admin').map(p => p.name) : [];
        return fail(403, op.kind === 'add' ? `${nm} can't add a department: only an Admin or an Editor can.` : `Only an Admin can change departments${admins.length ? ` (Admins: ${admins.join(', ')})` : ''}.`);
      }
      /* R14 (Jordan A): the server dates every department change (a client can't backdate a move) */
      const r = eng.departmentEdit(st.docs, Object.assign({}, op, { at: new Date().toISOString() }));
      if (!r.ok) return fail(400, r.error);
      const prevDepts = eng.departments(st.docs);
      const setDoc = ((st.docs.workspace || []).find(d => d.id === 'settings') || {}).data || {};
      await store.putDoc(wsId, 'workspace', 'settings', Object.assign({}, setDoc, { id: 'settings', departments: r.departments }));
      const patch = async (type, list) => {
        for (const x of list) {
          const cur = ((st.docs[type] || []).find(d => d.id === x.id) || {}).data;
          if (!cur) continue;
          const data = Object.assign({}, cur, x, { id: x.id });
          if (type === 'person' && data.bu == null) delete data.bu;
          await store.putDoc(wsId, type, x.id, data);
        }
      };
      await patch('person', r.people); await patch('process', r.processes); await patch('project', r.projects);
      const was = prevDepts.find(d => d.id === op.id), now = r.departments.find(d => d.id === op.id);
      const added = op.kind === 'add' ? r.departments.find(d => !prevDepts.some(p => p.id === d.id)) : null;
      const who = op.personId ? personName(st.docs, op.personId) : '';
      const summary = op.kind === 'add' ? `Added the ${added ? added.name : 'new'} department`
        : op.kind === 'rename' ? `Renamed the ${was ? was.name : ''} department to ${now ? now.name : ''}`
        : op.kind === 'remove' ? `Removed the ${was ? was.name : ''} department`
        : op.kind === 'approvers' ? `Set who approves for ${now ? now.name : ''}: ${(now ? now.approvers : []).map(id => personName(st.docs, id)).join(', ') || 'its members'}`
        : `${now ? `Moved ${who} to ${now.name}` : `Took ${who} out of their department`}`;
      await store.appendEvent(wsId, { actor, action: 'departments', ref: 'workspace:settings', summary });
      return send(200, { ok: true, departments: r.departments });
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
        /* R14 (Jordan B): a refused write is recorded in History as "Refused: <what> — <reason>", written by the server, and
           never as if it had happened */
        const refuse = async (status, x) => {
          const b0 = typeof x === 'string' ? { error: x } : x;
          try {
            const what = `${exists ? 'change to' : 'new'} ${describe(type, exists ? prev.data : data, st.docs)}` + (exists ? (() => { const t = changeText(st.docs, prev.data, data); return t && t !== 'no field changed' ? ' (' + t + ')' : ''; })() : '');
            await store.appendEvent(wsId, { actor, action: 'refused', ref: `${type}:${id}`, summary: ai.labeler(st.docs).scrub(`Refused: ${what} — ${String(b0.error || 'not allowed').replace(/\s+/g, ' ')}`).slice(0, 300) });
          } catch (e) { /* the refusal stands even if History can't be written */ }
          return send(status, b0);
        };
        /* R13: once a project has a plan, its deadline and planned budget move only through "Change the plan"
           (the change routes write directly, with sponsor approval); a plain doc save may not move them. */
        if (type === 'project' && prev && prev.data) {
          const hasPlan = (st.docs.workItem || []).some(w => w.data && w.data.projectId === id);
          const pb = d => (d && d.budget && d.budget.planned != null) ? Number(d.budget.planned) : null;
          if (hasPlan && ((prev.data.target || null) !== (data.target || null) || pb(prev.data) !== pb(data)))
            return refuse(409, 'Use “Change the plan” to move the deadline or budget, so the sponsor can approve it.');
        }
        /* R10 S5: workspace roles (Viewer / Approver / admin-only settings) */
        const rd = ADMIN_ROUTES && ADMIN_ROUTES.roleError ? ADMIN_ROUTES.roleError(st.docs, actor, type) : null;
        if (rd) return refuse(403, rd);
        /* R16 N1 #1: the link between a person and their hosted sign-in (email, principalId) is set by an Admin only */
        if (type === 'person' && ['email', 'principalId'].some(k => ((prev && prev.data[k]) || null) !== (data[k] || null))) {
          const role = ADMIN_ROUTES && typeof ADMIN_ROUTES.roleOf === 'function' ? ADMIN_ROUTES.roleOf(st.docs, actor) : null;
          if (role !== 'admin') return refuse(403, 'Only an Admin can link a person to their sign-in.');
        }
        /* R5 [S]: permissions */
        const denied = permissionError(type, prev && prev.data, data, actor, st.docs);
        if (denied) return refuse(403, denied);
        if (type === 'project') {
          const bad = approversError(prev && prev.data, data, st.docs);
          if (bad) return refuse(400, bad);
          const g = projectGuardError(prev && prev.data, data, actor, st.docs);
          if (g) return refuse(g.status, g.body);
          /* R16 N1 #6 (Jordan): once a project has work, the launch owner changes only through "Change the plan" (a
             plan change the sponsor approves), never in one click */
          if (prev && prev.data && (st.docs.workItem || []).some(w => w.data && w.data.projectId === id) &&
            (prev.data.releaseManager || prev.data.owner || null) !== (data.releaseManager || data.owner || null) && (prev.data.owner || null) === (data.owner || null))
            return refuse(409, `Use “Change the plan” to hand the launch owner role to ${personName(st.docs, data.releaseManager || data.owner)}, so the sponsor can approve it.`);
          /* R16 N1 #7 (PMO): a launch window on a day off is refused; past the deadline it goes through Change the plan */
          {
            const eng = engine();
            const wv = x => (x && x.cutover && x.cutover.window) || null;
            if (eng && typeof eng.launchWindowGuard === 'function' && JSON.stringify(wv(prev && prev.data)) !== JSON.stringify(wv(data)) && wv(data)) {
              const lw = eng.launchWindowGuard(Object.assign({}, st.docs, { project: (st.docs.project || []).filter(d => d.id !== id).concat([{ id, data }]) }), id, wv(data));
              if (lw) return refuse(lw.kind === 'day-off' ? 400 : 409, { error: lw.text, window: lw });
            }
          }
          /* R16 N1 #5: formerLeads is the server's (kept from the stored project) */
          if (prev && Array.isArray(prev.data.formerLeads)) data.formerLeads = prev.data.formerLeads; else delete data.formerLeads;
        }
        /* R14 PMO-A1/S1/PMO-11/PMO-1: task ownership, the deadline guard, working-day due dates, second-person confirmation */
        if (type === 'workItem') {
          const own = workItemError(prev && prev.data, data, actor, st.docs);
          if (own) return refuse(403, own);
          const cf = confirmError(prev && prev.data, data, actor, st.docs);
          if (cf) return refuse(403, cf);
          /* R16 N1 #2 (PMO): hours are append-only: a plain save can add entries, never remove or lower one; a correction
             is a reversing (negative) entry with a reason */
          {
            const eng = engine();
            const tp = eng && typeof eng.timeEntryProblem === 'function' && (prev || Array.isArray(data.time)) ? eng.timeEntryProblem(prev && prev.data.time, data.time) : null;
            if (tp) return refuse(409, tp.text);
          }
          const sc = scheduleError(prev && prev.data, data, st.docs, today);
          if (sc) return refuse(sc.status, sc.body);
          stampWorkItem(prev && prev.data, data, actor, today, st.docs);
          /* R15 #1 (Karen 5, BPM 5): a new task made from a step is the step's doer's (its role), never the process owner
             that a client filled in from the step's stale named owner */
          if (!prev && data.pid && data.step) {
            const eng = engine();
            const t = eng && typeof eng.stepTaskOwner === 'function' ? eng.stepTaskOwner(st.docs, data.pid, data.step) : null;
            const proc = ((st.docs.process || []).find(d => d.id === data.pid) || {}).data || {};
            const raw = eng && typeof eng.flatSteps === 'function' ? (function find(nodes) { for (const n of nodes || []) { if (!n) continue; if (n.id === data.step) return n; for (const b of n.branches || []) { const r = find(b && b.nodes); if (r) return r; } } return null; })(proc.tobe) : null;
            if (t && t.ownerRole && data.owner && data.owner !== t.owner && ((raw && data.owner === raw.owner) || data.owner === proc.owner)) {
              if (t.owner) data.owner = t.owner; else delete data.owner;
              data.ownerRole = t.ownerRole;
              delete data.assignedTs;
            }
          }
        }
        /* R13 #3: only the PM or the test's own department assigns a test; the assigner is stamped (they can't pass it) */
        if (type === 'testCase' && (prev ? prev.data.tester || null : null) !== (data.tester || null)) {
          const eng = engine();
          if (data.tester) {
            const bad = eng && typeof eng.canAssignTest === 'function' ? eng.canAssignTest(st.docs, data.projectId || projectOfCase(st.docs, data.dataId), id, actor) : null;
            if (bad && (data.projectId || projectOfCase(st.docs, data.dataId))) return refuse(403, bad.text);
            data.assignedBy = actor;
          } else delete data.assignedBy;
        }
        if (type === 'project' && prev && Array.isArray(data.uatScripts)) {
          const eng = engine(); const was = {}; (Array.isArray(prev.data.uatScripts) ? prev.data.uatScripts : []).forEach(x => { if (x && x.id) was[x.id] = x; });
          for (const sc of data.uatScripts) {
            if (!sc || !sc.id || ((was[sc.id] || {}).tester || null) === (sc.tester || null)) continue;
            if (sc.tester) {
              const bad = eng && typeof eng.canAssignTest === 'function' ? eng.canAssignTest(st.docs, prev.data, sc.id, actor) : null;
              if (bad) return refuse(403, bad.text);
              sc.assignedBy = actor;
            } else delete sc.assignedBy;
          }
        }
        /* R11 §2: separation of duties */
        if (type === 'testRun') {
          const bad = testRunError(prev && prev.data, data, actor, st.docs);
          if (bad) return refuse(403, bad);
        }
        if (type === 'approval') {
          const bad = approvalError(prev && prev.data, data, actor, st.docs);
          if (bad) return refuse(403, bad);
        }
        /* R6: a grant's time box starts at approval: an approved or active grant expires within 30 days of it */
        if (type === 'grant') {
          const bad = grantExpiryError(data, prev && prev.data);
          if (bad) return refuse(400, bad);
        }
        /* R15 #6 (PMO): the forecast log is the server's: a client value is ignored; when a report is recorded (a new
           reportLog entry for today) the server appends that day's expected finish itself. reportLog is append-only. */
        if (type === 'project') {
          const prevFL = prev && Array.isArray(prev.data.forecastLog) ? prev.data.forecastLog : [];
          const prevRL = prev && Array.isArray(prev.data.reportLog) ? prev.data.reportLog : [];
          /* R16 N1 #3 (PMO regression): only a report that is SENT or EXPORTED is recorded (body.report.action), never a
             preview. A client reportLog / lastReportAt is ignored; the server writes them. One entry per day. */
          const rep = isPlainObject(body.report) && ['send', 'export'].includes(body.report.action) ? body.report : null;
          const added = rep && !prevRL.some(y => y && y.date === today) ? [{ preset: typeof rep.preset === 'string' ? rep.preset.slice(0, 20) : null, action: rep.action }] : [];
          const nowIso = new Date().toISOString();
          if (prevRL.length || added.length) data.reportLog = prevRL.concat(added.map(x => ({ date: today, at: nowIso, preset: x.preset || null, action: x.action }))).slice(-30); else delete data.reportLog;
          if (added.length) { data.lastReportAt = today; data.lastReportAtTime = nowIso; }
          else if (prev) { ['lastReportAt', 'lastReportAtTime'].forEach(k => { if (prev.data[k] != null) data[k] = prev.data[k]; else delete data[k]; }); }
          else { delete data.lastReportAt; delete data.lastReportAtTime; }
          let fl = prevFL.slice();
          if (added.length) {
            const eng = engine();
            let finish = null;
            try { const t = eng && eng.projectTruth ? eng.projectTruth(st.docs, id, today) : null; finish = t ? t.forecastFinish || null : null; } catch (e) { finish = null; }
            if (finish) fl = fl.filter(x => x && x.date !== today).concat([{ date: today, finish, at: nowIso }]).slice(-60);
          }
          if (fl.length) data.forecastLog = fl; else delete data.forecastLog;
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
          /* R15 #6: the first completion date wins over a re-Done */
          if (isDay(data.firstDoneAt)) data.doneAt = data.firstDoneAt; else data.firstDoneAt = data.doneAt;
        }
        /* R14 PMO-A2: a save that changes no field writes nothing and logs nothing */
        if (exists && (() => { const strip = o => JSON.stringify(Object.keys(o || {}).filter(k => k !== 'updatedAt' && !(type === 'workItem' && WI_SERVER.has(k)) && o[k] !== undefined).sort().map(k => [k, type === 'workItem' ? normWI(k, o[k]) : o[k]])); return strip(prev.data) === strip(data); })())
          return send(200, { ok: true, doc: { type, id, data: prev.data }, event: null, unchanged: true });
        /* R14 (Karen 7): new information is dated, so the report can say when a blocker was raised */
        if (!exists && ['dataElement', 'risk'].includes(type) && !data.createdAt) data.createdAt = today;
        /* R2: stamp updatedAt when the client did not (missing, or echoed back unchanged) */
        if (STAMPED.includes(type) && (!data.updatedAt || (prev && prev.data.updatedAt === data.updatedAt))) data.updatedAt = new Date().toISOString();
        await store.putDoc(wsId, type, id, data);
        const after = Object.assign({}, st.docs, { [type]: (st.docs[type] || []).filter(d => d.id !== id).concat([{ id, data }]) });
        /* R15 #1 (BPM): information owned by a step's doer follows that step to its new doer (written by the server) */
        if (type === 'process' && exists) {
          const eng = engine();
          const follow = eng && typeof eng.dataOwnersToFollow === 'function' ? eng.dataOwnersToFollow(st.docs, after) : [];
          for (const f of follow) {
            const de = ((after.dataElement || []).find(d => d.id === f.dataId) || {}).data; if (!de) continue;
            const nd = Object.assign({}, de, { updatedAt: new Date().toISOString() });
            if (f.set.ownerRole) { nd.ownerRole = f.set.ownerRole; delete nd.owner; } else if (f.set.owner) { nd.owner = f.set.owner; delete nd.ownerRole; } else continue;
            await store.putDoc(wsId, 'dataElement', f.dataId, nd);
            await store.appendEvent(wsId, { actor, action: 'update', ref: `dataElement:${f.dataId}`, summary: ai.labeler(after).scrub(`Owner of ${de.name || 'information'} follows its step: ${f.from || 'nobody'} → ${f.to || 'nobody'}`).slice(0, 300) });
          }
        }
        const ev = await store.appendEvent(wsId, { actor, action: exists ? 'update' : 'create', ref: `${type}:${id}`,
          summary: ai.labeler(after).scrub(type === 'approval' && data.kind === 'launch-override' && !exists
            /* the override sign-off in the server's own words (role from the engine, reason from the record) */
            ? (() => { const eng = engine(); const role = eng && eng.overrideRoleLabel ? eng.overrideRoleLabel(after, data.projectId, actor) : (data.role === 'pm' ? 'project manager' : 'sponsor or approver');
              return `Signed the launch override as ${role || 'a signer'}${Array.isArray(data.guard) && data.guard.length ? ' (' + data.guard.join('; ') + ')' : ''}: “${String(data.reason || '').slice(0, 120)}”`.slice(0, 300); })()
            : serverSummary(body, `${exists ? 'Updated' : 'Created'} ${describe(type, data, after)}`, exists ? changeText(after, prev && prev.data, data) : '')) });
        return send(200, { ok: true, doc: { type, id, data }, event: ev });
      }
      if (method === 'DELETE') {
        const st = await store.getState(ws);
        const prev = (st.docs[type] || []).find(d => d.id === id);
        const rdel = ADMIN_ROUTES && ADMIN_ROUTES.roleError ? ADMIN_ROUTES.roleError(st.docs, actor, type) : null;
        const refuseDel = async msg => { await store.appendEvent(wsId, { actor, action: 'refused', ref: `${type}:${id}`, summary: ai.labeler(st.docs).scrub(`Refused: delete ${describe(type, prev.data, st.docs)} — ${msg}`).slice(0, 300) }).catch(() => {}); return fail(403, msg); };
        if (prev && rdel) return refuseDel(rdel);
        if (prev && (type === 'process' || type === 'project')) {
          const denied = type === 'process' ? permissionError('process', prev.data, prev.data, actor, st.docs)
            : (actor !== prev.data.owner ? `Only the project manager (${personName(st.docs, prev.data.owner)}) can delete ${describe('project', prev.data, st.docs)}.` : null);
          if (denied) return refuseDel(denied);
        }
        await store.deleteDoc(wsId, type, id);
        const ev = await store.appendEvent(wsId, { actor, action: 'delete', ref: `${type}:${id}`,
          summary: ai.labeler(st.docs).scrub(serverSummary(body, `Deleted ${prev ? describe(type, prev.data, st.docs) : type}`, '')) });
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
      const deDoc = ((st.docs.dataElement || []).find(d => d.id === dataId) || {}).data;
      if (!deDoc) return fail(404, 'unknown data element');
      const eng = engine();
      let rows, columns;
      if (eng && typeof eng.profileCsv === 'function') {
        const parsed = eng.parseCsv ? eng.parseCsv(body.csv) : null;
        rows = parsed ? Math.max(0, parsed.length - 1) : null;
        if (rows != null && rows > MAX_ROWS) return fail(413, `csv exceeds ${MAX_ROWS} rows`);
        /* R14 (BPM-2): the information's name is context for the shared-bank check (never a customer account) */
        const out = eng.profileCsv(body.csv, { maxRows: MAX_ROWS, context: deDoc.name || '' });
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
        if (typeof c.duplicateRecords === 'number' && isFinite(c.duplicateRecords)) o.duplicateRecords = Math.max(0, Math.floor(c.duplicateRecords));
        /* R13 #7: the fraud and quality checks reach the page and the test generator (counts, row numbers and the engine's
           own sentence only; never a value): a bank account shared across records, near-duplicate names, extra spaces */
        const cnt = v => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
        const rowsOf = r => (Array.isArray(r) ? r.slice(0, 20).map(g => (Array.isArray(g) ? g.slice(0, 20).map(cnt) : [])) : []);
        if (c.sharedAccount && typeof c.sharedAccount === 'object') o.sharedAccount = { accounts: cnt(c.sharedAccount.accounts), records: cnt(c.sharedAccount.records), rows: rowsOf(c.sharedAccount.rows), text: String(c.sharedAccount.text || '').slice(0, 200) };
        if (c.nearDuplicates && typeof c.nearDuplicates === 'object') o.nearDuplicates = { groups: cnt(c.nearDuplicates.groups), records: cnt(c.nearDuplicates.records), rows: rowsOf(c.nearDuplicates.rows), text: String(c.nearDuplicates.text || '').slice(0, 200) };
        if (c.whitespace && typeof c.whitespace === 'object') o.whitespace = { count: cnt(c.whitespace.count), firstRow: cnt(c.whitespace.firstRow) };
        return o;
      });
      /* R14 (BPM-2): a sample with columns for other information used by the same steps is split per piece, so the
         tests land on the right information (never 30 cases under one piece) */
      const at = new Date().toISOString();
      const split = eng && typeof eng.splitSampleColumns === 'function' && columns.length > 1 ? eng.splitSampleColumns(st.docs, dataId, columns.map(c => c.name)) : { [dataId]: columns.map(c => c.name) };
      const moved = [];
      for (const [oid, names_] of Object.entries(split)) {
        if (oid === dataId || !names_.length) continue;
        const od = ((st.docs.dataElement || []).find(d => d.id === oid) || {}).data; if (!od) continue;
        const ocols = columns.filter(c => names_.includes(c.name));
        const odoc = { id: 'profile-' + oid, dataId: oid, at, rows, columns: ocols, splitFrom: dataId };
        if (Buffer.byteLength(JSON.stringify(odoc), 'utf8') > MAX_DOC) continue;
        await store.putDoc(wsId, 'profile', odoc.id, odoc);
        await store.appendEvent(wsId, { actor: actorOf(body), action: 'profile', ref: 'dataElement:' + oid,
          summary: `Profiled ${rows} row(s) × ${ocols.length} column(s) from a sample uploaded on ${deDoc.name || 'other information'}; statistics only` });
        moved.push({ dataId: oid, name: od.name || 'information', columns: ocols.map(c => c.name) });
      }
      const keepNames = new Set(split[dataId] || []);
      const own = moved.length ? columns.filter(c => keepNames.has(c.name)) : columns;
      const id = 'profile-' + dataId;
      const doc = { id, dataId, at, rows, columns: own };
      if (moved.length) doc.split = moved;
      if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > MAX_DOC) return fail(413, 'profile exceeds 48 KB (too many columns)');
      await store.putDoc(wsId, 'profile', id, doc);
      await store.appendEvent(wsId, { actor: actorOf(body), action: 'profile', ref: 'dataElement:' + dataId,
        summary: `Profiled ${rows} row(s) × ${own.length} column(s); statistics only` + (moved.length ? `; ${moved.map(m => m.columns.length + ' column' + (m.columns.length === 1 ? '' : 's') + ' went to ' + m.name).join(', ')}` : '') });
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

module.exports._internal = { workItemError, stampWorkItem, scheduleError, projectGuardError, serverSummary, testRunError, approvalError, localNowOf, RATE_LIMIT_MSG, dayInput, clientIpHash, clientToday, approversError, cloneNodes, localProfile, releaseExceptions, describe, grantExpiryError, auditClock, WS_RE, ID_RE };
