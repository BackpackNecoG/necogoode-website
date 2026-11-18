/* R10 S4 — /api/pmoflow/workspaces/:ws/connections... (Jira / Azure DevOps two-way sync, Teams / Outlook notifications).
   Loaded by api/pmoflow/index.js through the route-module hook. Demo mode: the "tool" is a simulated Jira / Azure DevOps that
   lives inside the connection doc, and a simulated relay verifies every signed intent exactly as the customer-deployed relay
   (integrations/relay) does: HMAC-SHA256 with a per-project rotating secret, a nonce, a 5-minute expiry, refused on replay.
   PMOFlow never stores Jira or Azure DevOps tokens, nor Teams webhook addresses: those live in the customer's Key Vault.

   Routes (seg = path after /api/pmoflow/):
     GET    workspaces/:ws/connections                       list connections
     POST   workspaces/:ws/connections                       connect a project  {projectId, tool, site, projectKey, fields?, statusMap?, notify?, syncNow?}
     PUT    workspaces/:ws/connections/:id                   edit settings (tool, site and key are fixed once connected)
     DELETE workspaces/:ws/connections/:id                   disconnect
     POST   workspaces/:ws/connections/:id/sync              two-way sync now
     POST   workspaces/:ws/connections/:id/sim               a person changes an item "in Jira" (demo); flows back like a webhook
     POST   workspaces/:ws/connections/:id/notify            preview + simulated delivery of a notification {event}
     POST   workspaces/:ws/connections/:id/rotate            rotate the project's signing secret
     POST   workspaces/:ws/connections/:id/replay            re-send the last signed intent (shows the replay refusal) */
const crypto = require('crypto');
const S = require('./pmoflow-sync');
const seedMod = require('./pmoflow-seed');

/* The connection doc type. Registered here so the existing document store keeps it (and reset clears it).
   The lead/S1 should add 'connection' to DOC_TYPES in pmoflow-seed.js; this line then does nothing. */
if (Array.isArray(seedMod.DOC_TYPES) && !seedMod.DOC_TYPES.includes('connection')) seedMod.DOC_TYPES.push('connection');

const TYPE = 'connection';
const WS_RE = /^[a-z0-9]{12,32}$/;
const ID_RE = /^[\w.-]{1,64}$/;
const LOG_CAP = 40, DELIVERY_CAP = 12, NONCE_CAP = 400;
const SKEW_MS = 30 * 1000;
const WRITES_PER_MIN = 60;
const SECRET_SEED = process.env.PMOFLOW_SYNC_SECRET || process.env.PMOFLOW_SALT || 'pmoflow-demo-sync-v1';

function engine() { try { return require('./pmoflow-engine.js'); } catch (e) { return null; } }
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const writes = new Map();
function limited(ws) {
  const now = Date.now(); const a = (writes.get(ws) || []).filter(t => now - t < 60000);
  if (a.length >= WRITES_PER_MIN) { writes.set(ws, a); return true; }
  a.push(now); writes.set(ws, a); if (writes.size > 5000) writes.clear(); return false;
}

/* ---------- signing (demo stand-in for PMOFlow's side; the relay holds the same per-project secret in Key Vault) ---------- */
function secretFor(wsId, conn, kid) {
  return crypto.createHmac('sha256', SECRET_SEED).update(`${wsId}|${conn.id}|${kid == null ? conn.kid : kid}`).digest();
}
function sign(intent, secret) {
  return Object.assign({}, intent, { sig: crypto.createHmac('sha256', secret).update(S.signingString(intent), 'utf8').digest('hex') });
}
/* Same checks as integrations/relay/lib/intent.js verify(). seen: {nonce: expISO} (mutated). */
function verify(intent, secretOf, seen, nowMs) {
  if (!isObj(intent) || intent.v !== S.VERSION) return { ok: false, reason: 'Unknown intent format.' };
  if (typeof intent.sig !== 'string' || !/^[0-9a-f]{64}$/.test(intent.sig)) return { ok: false, reason: 'Missing signature.' };
  const secret = secretOf(intent.kid);
  if (!secret) return { ok: false, reason: 'Signed with a retired key.' };
  const want = crypto.createHmac('sha256', secret).update(S.signingString(intent), 'utf8').digest();
  const got = Buffer.from(intent.sig, 'hex');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return { ok: false, reason: 'Signature doesn’t match.' };
  const iat = Date.parse(intent.iat), exp = Date.parse(intent.exp);
  if (!isFinite(iat) || !isFinite(exp) || exp - iat > S.INTENT_TTL_MS || iat > nowMs + SKEW_MS) return { ok: false, reason: 'Bad time window.' };
  if (nowMs > exp) return { ok: false, reason: 'Expired (intents are valid for 5 minutes).' };
  if (seen[intent.nonce]) return { ok: false, reason: 'Already used (replay refused).' };
  seen[intent.nonce] = intent.exp;
  return { ok: true };
}
function pruneNonces(seen, nowMs) {
  const keep = Object.entries(seen || {}).filter(([, exp]) => Date.parse(exp) + SKEW_MS > nowMs).slice(-NONCE_CAP);
  return Object.fromEntries(keep);
}

/* ---------- helpers ---------- */
function projectOf(docs, id) { return ((docs.project || []).find(d => d.id === id) || {}).data || null; }
function personName(docs, id) { const p = ((docs.person || []).find(d => d.id === id) || {}).data; return p ? p.name : 'someone'; }
function truthSummary(docs, projectId, today) {
  const eng = engine(); if (!eng || typeof eng.projectTruth !== 'function') return null;
  try {
    const t = eng.projectTruth(docs, projectId, today); if (!t) return null;
    return { label: t.label, rag: t.rag, done: t.tasks.done, total: t.tasks.total, late: t.lateCount, sentence: t.sentence };
  } catch (e) { return null; }
}
function publicConn(c) { const o = Object.assign({}, c); delete o.nonces; return o; }
function toolName(conn) { return (S.TOOLS[conn.tool] || {}).simName || 'the tool'; }
const shortVal = v => { const s = Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v); return s.length > 60 ? s.slice(0, 57) + '…' : (s || '(blank)'); };
function statusName(project, id) { const s = ((project && project.statuses) || []).find(x => x.id === id); return s ? s.name : id; }
function fieldText(project, f, v, docs, conn) {
  if (f === 'status') return statusName(project, v);
  if (f === 'assignee') { const p = S.personByEmail(docs, v, conn.emailDomain); return p ? p.name : v; }
  return shortVal(v);
}

/* ---------- one sync pass ---------- */
async function runSync(ctx, conn, st, opts) {
  const { store, wsId, actor, today } = ctx;
  const docs = st.docs;
  const project = projectOf(docs, conn.projectId);
  const nowMs = Date.now();
  conn.nonces = pruneNonces(conn.nonces, nowMs);
  conn.sim = conn.sim || S.simNew(conn);
  const secretOf = kid => (kid === conn.kid || kid === conn.kid - 1 ? secretFor(wsId, conn, kid) : null);  /* current + previous key */
  const entries = [];
  const nowIso = () => new Date().toISOString();
  const entry = (e) => { const x = Object.assign({ id: 'log-' + crypto.randomBytes(5).toString('hex'), at: nowIso() }, e); entries.push(x); return x; };
  const before = truthSummary(docs, conn.projectId, today);
  /* sent = created + updated + linked; each one is exactly one "PMOFlow → tool" row in the sync log */
  const sum = { sent: 0, created: 0, updated: 0, linked: 0, received: 0, conflicts: 0, skipped: 0, ignored: 0, refused: 0, early: 0 };

  const exec = (intent) => {
    const signed = sign(intent, secretFor(wsId, conn));
    const v = verify(signed, secretOf, conn.nonces, Date.now());
    const result = v.ok ? S.simExecute(conn, conn.sim, signed, nowIso()) : { ok: false, detail: 'Relay refused: ' + v.reason };
    if (!v.ok) sum.refused++;
    return { signed, result, verified: v.ok };
  };
  const outbound = (intents) => {
    for (const it of intents) {
      const { signed, result } = exec(it);
      if (result.ok) {
        S.recordResult(conn, signed, result, docs); sum.sent++;
        if (it.op === 'create') sum.created++; else if (it.op === 'link') sum.linked++; else sum.updated++;
      }
      const changed = it.op === 'update' ? ` (${(it.changed || []).map(f => S.FIELD_LABELS[f].toLowerCase()).join(', ')})` : '';
      entry({ dir: 'out', op: it.op, key: result.key || it.ref.key || null, workItemId: it.ref.workItemId, title: it.ref.title || '',
        result: result.ok ? 'ok' : 'failed', detail: (result.detail || '') + changed, intent: signed, requests: S.describeRequest(conn, signed) });
    }
  };

  /* Inbound first, so a field changed on both sides is settled by time (later change wins) before anything is sent. */
  let updates = [];
  if (opts.inbound !== false) {
    const pull = exec(S.pullIntent(conn));
    const res = pull.result;
    if (!res.ok) entry({ dir: 'in', op: 'pull', result: 'failed', detail: res.detail, intent: pull.signed, requests: S.describeRequest(conn, pull.signed) });
    else {
      const applied = S.applyInbound(conn, docs, res.changes || [], { today, now: nowIso(), toolName: toolName(conn) });
      conn.cursor = res.cursor || conn.cursor;
      entry({ dir: 'in', op: 'pull', result: 'ok', detail: res.detail, intent: pull.signed, requests: S.describeRequest(conn, pull.signed) });
      for (const u of applied.updates) {
        await store.putDoc(wsId, 'workItem', u.workItemId, u.data);
        const list = st.docs.workItem; const i = list.findIndex(d => d.id === u.workItemId);
        if (i >= 0) list[i] = { id: u.workItemId, data: u.data };
        const what = u.changes.map(c => `${S.FIELD_LABELS[c.field].toLowerCase()} ${fieldText(project, c.field, c.from, docs, conn)} → ${fieldText(project, c.field, c.to, docs, conn)}`).join('; ');
        await store.appendEvent(wsId, { actor, action: 'sync', ref: 'workItem:' + u.workItemId,
          summary: `From ${S.TOOLS[conn.tool].name} ${u.key}: work item "${u.data.title}" ${what}`.slice(0, 300) });
        entry({ dir: 'in', op: 'apply', key: u.key, workItemId: u.workItemId, title: u.data.title, result: 'ok', detail: 'Updated in PMOFlow: ' + what });
        sum.received++;
        /* R11 §9: a "Done" from the tool is accepted, but flagged when work it depends on is still open */
        const early = u.changes.some(c => c.field === 'status') ? doneBeforeDeps(st.docs, u.workItemId) : null;
        if (early && early.flag) {
          const detail = `${early.text}. Accepted as ${S.TOOLS[conn.tool].name} reported it; check the order.`;
          entry({ dir: 'in', op: 'flag', key: u.key, workItemId: u.workItemId, title: u.data.title, result: 'flagged', flag: 'finished-before-dependencies', open: early.open.map(w => w.id), detail });
          await store.appendEvent(wsId, { actor, action: 'sync', ref: 'workItem:' + u.workItemId,
            summary: `From ${S.TOOLS[conn.tool].name} ${u.key}: "${u.data.title}": ${early.text}`.slice(0, 300) });
          sum.early++;
        }
      }
      for (const c of applied.conflicts) {
        entry({ dir: 'in', op: 'conflict', key: c.key, workItemId: c.workItemId, result: 'conflict',
          detail: `${S.FIELD_LABELS[c.field]}: PMOFlow “${fieldText(project, c.field, c.pmoflow, docs, conn)}” vs ${S.TOOLS[conn.tool].name} “${fieldText(project, c.field, c.tool, docs, conn)}”. ${c.reason}` });
        sum.conflicts++;
      }
      for (const s of applied.skipped) { entry({ dir: 'in', op: 'skip', key: s.key, workItemId: s.workItemId || null, result: 'skipped', detail: s.reason }); sum.skipped++; }
      for (const g of applied.ignored) { entry({ dir: 'in', op: 'ignore', key: g.key, workItemId: g.workItemId, result: 'ignored', detail: `${S.FIELD_LABELS[g.field]} ${g.value} in ${S.TOOLS[conn.tool].name}: ${g.reason}` }); sum.ignored++; }
      updates = applied.updates;
    }
  }
  /* Then outbound: PMOFlow's changes, conflicts PMOFlow won, and PMOFlow-owned dates changed in the tool (put back). */
  if (opts.outbound !== false) {
    outbound(S.computeOutbound(conn, docs));
    outbound(S.computeLinks(conn, docs));
  }
  const after = truthSummary(st.docs, conn.projectId, today);
  conn.lastSync = { at: nowIso(), by: actor, summary: sum };
  conn.log = entries.slice().reverse().concat(conn.log || []).slice(0, LOG_CAP);
  return { sum, entries, before, after, updates };
}

/* R11 §9: G1's engine helper is the one definition of "finished before the work it depends on":
   doneBeforeDeps(docs, workId) -> {flag, open: [{id, title}], text}. */
function doneBeforeDeps(docs, workItemId) {
  const eng = engine();
  if (!eng || typeof eng.doneBeforeDeps !== 'function') return { flag: false, open: [], text: '' };
  try { return eng.doneBeforeDeps(docs, workItemId) || { flag: false, open: [], text: '' }; } catch (e) { return { flag: false, open: [], text: '' }; }
}

function syncSentence(conn, sum) {
  const T = S.TOOLS[conn.tool], tool = T.name, noun = n => `${T.itemNoun}${n === 1 ? '' : 's'}`, parts = [];
  if (sum.created) parts.push(`${sum.created} ${noun(sum.created)} created in ${tool}`);
  if (sum.updated) parts.push(`${sum.updated} ${noun(sum.updated)} updated in ${tool}`);
  if (sum.linked) parts.push(`${sum.linked} dependency link${sum.linked === 1 ? '' : 's'} set in ${tool}`);
  if (sum.sent && !(sum.created || sum.updated || sum.linked)) parts.push(`${sum.sent} change${sum.sent === 1 ? '' : 's'} sent to ${tool}`);
  if (sum.received) parts.push(`${sum.received} task${sum.received === 1 ? '' : 's'} updated from ${tool}`);
  if (sum.early) parts.push(`${sum.early} finished before the work ${sum.early === 1 ? 'it depends' : 'they depend'} on (flagged)`);
  if (sum.conflicts) parts.push(`${sum.conflicts} conflict${sum.conflicts === 1 ? '' : 's'} settled (later change wins)`);
  if (sum.ignored) parts.push(`${sum.ignored} PMOFlow-owned date${sum.ignored === 1 ? '' : 's'} put back`);
  if (sum.refused) parts.push(`${sum.refused} refused by the relay`);
  return parts.length ? parts.join(' · ') : 'Everything was already in sync';
}

/* ---------- notifications ---------- */
function noticeContext(docs, conn, today, origin) {
  const project = projectOf(docs, conn.projectId) || {};
  const eng = engine();
  let truth = null;
  try { truth = eng && eng.projectTruth ? eng.projectTruth(docs, conn.projectId, today) : null; } catch (e) { truth = null; }
  const wi = id => ((docs.workItem || []).find(d => d.id === id) || {}).data;
  const lateItems = ((truth && truth.late) || []).map(x => wi(typeof x === 'string' ? x : x && x.id)).filter(Boolean)
    .map(w => ({ title: w.title, due: w.due, owner: personName(docs, w.owner) }));
  const appr = (truth && truth.approvals) || [];
  const approval = appr.find(a => a.needed && a.ready && !a.approved) || appr.find(a => a.needed && !a.approved) || null;
  const base = /^https?:\/\/[\w.-]+(:\d+)?$/.test(String(origin || '')) ? origin : 'https://necogoode.com';
  return { projectName: project.name, url: `${base}/concepts/pmoflow/project/${encodeURIComponent(conn.projectId)}`, truth: truth || {},
    lateItems, approval, live: project.status === 'live', liveDate: project.liveDate || null };
}

/* ---------- handler ---------- */
async function handle({ method, seg, body, req, store, send, fail, dayInput, clientToday }) {
  if (seg[0] !== 'workspaces' || seg.length < 3 || seg[2] !== 'connections') return false;
  const wsId = seg[1];
  if (!WS_RE.test(wsId)) { fail(400, 'invalid workspace id'); return true; }
  const ws = await store.getWorkspace(wsId);
  if (!ws || ws.expired) { fail(404, 'workspace not found or expired'); return true; }
  if (method !== 'GET' && limited(wsId)) { fail(429, 'Too many changes. Slow down.'); return true; }
  const today = clientToday(dayInput(req, body), new Date().toISOString().slice(0, 10));
  const st = await store.getState(ws, today);
  const docs = st.docs;
  const actor = typeof body.actor === 'string' && ID_RE.test(body.actor) ? body.actor : null;
  const conns = (docs[TYPE] || []).map(d => d.data);
  const id = seg[3], sub = seg[4];
  const canWork = (project) => actor && project && (actor === project.owner || (project.resources || []).includes(actor));
  const teamMsg = (project) => `Only the project team of ${project.name} can change its connection. Switch to the project manager (${personName(docs, project.owner)}) or a team member.`;

  /* list / connect */
  if (seg.length === 3) {
    if (method === 'GET') { send(200, { connections: conns.map(publicConn), tools: S.TOOLS }); return true; }
    if (method !== 'POST') { fail(405, 'method not allowed'); return true; }
    const project = projectOf(docs, body.projectId);
    const v = S.validateSettings(body, { projects: (docs.project || []).map(d => d.id), statuses: ((project && project.statuses) || []).map(s => s.id) });
    if (!v.ok) { fail(400, v.errors[0], v.errors); return true; }
    if (!canWork(project)) { fail(403, teamMsg(project)); return true; }
    const cid = 'conn-' + v.value.projectId.slice(0, 50);
    if (conns.some(c => c.id === cid)) { fail(409, `${project.name} is already connected. Edit or disconnect that connection first.`); return true; }
    const conn = Object.assign(S.defaultConnection(v.value), v.value, { id: cid, createdBy: actor, createdAt: new Date().toISOString() });
    conn.sim = S.simNew(conn);
    await store.appendEvent(wsId, { actor, action: 'connect', ref: `${TYPE}:${cid}`,
      summary: `Connected project "${project.name}" to ${toolName(conn)} · ${conn.projectKey}` });
    let out = null;
    if (body.syncNow !== false) out = await runSync({ store, wsId, actor, today }, conn, st, {});
    await store.putDoc(wsId, TYPE, cid, conn);
    if (out) await store.appendEvent(wsId, { actor, action: 'sync', ref: `${TYPE}:${cid}`, summary: `First sync with ${toolName(conn)}: ${syncSentence(conn, out.sum)}` });
    send(201, { ok: true, connection: publicConn(conn), sync: out && { summary: out.sum, sentence: syncSentence(conn, out.sum), before: out.before, after: out.after } });
    return true;
  }

  if (!ID_RE.test(id || '')) { fail(400, 'invalid connection id'); return true; }
  const conn = conns.find(c => c.id === id);
  if (!conn) { fail(404, 'This connection no longer exists.'); return true; }
  const project = projectOf(docs, conn.projectId);
  if (!project) { fail(404, 'The connected project no longer exists. Disconnect it.'); return true; }

  if (seg.length === 4) {
    if (method === 'GET') { send(200, { connection: publicConn(conn) }); return true; }
    if (method === 'PUT') {
      if (!canWork(project)) { fail(403, teamMsg(project)); return true; }
      const input = Object.assign({}, body, { projectId: conn.projectId, tool: conn.tool, site: conn.site, projectKey: conn.projectKey });
      if ((body.tool && body.tool !== conn.tool) || (body.site && body.site !== conn.site) || (body.projectKey && body.projectKey !== conn.projectKey)) {
        fail(409, 'To connect to a different tool, site or project, disconnect and connect again.'); return true;
      }
      const v = S.validateSettings(input, { statuses: (project.statuses || []).map(s => s.id) });
      if (!v.ok) { fail(400, v.errors[0], v.errors); return true; }
      const next = Object.assign({}, conn, { fields: v.value.fields, statusMap: v.value.statusMap, notify: v.value.notify, issueType: v.value.issueType, emailDomain: v.value.emailDomain, updatedAt: new Date().toISOString() });
      await store.putDoc(wsId, TYPE, id, next);
      await store.appendEvent(wsId, { actor, action: 'update', ref: `${TYPE}:${id}`, summary: `Changed the ${toolName(conn)} sync settings for "${project.name}"` });
      send(200, { ok: true, connection: publicConn(next) }); return true;
    }
    if (method === 'DELETE') {
      if (!actor || (actor !== project.owner && actor !== conn.createdBy)) {
        fail(403, `Only the project manager (${personName(docs, project.owner)}) or the person who connected it can disconnect.`); return true;
      }
      await store.deleteDoc(wsId, TYPE, id);
      await store.appendEvent(wsId, { actor, action: 'delete', ref: `${TYPE}:${id}`, summary: `Disconnected project "${project.name}" from ${toolName(conn)}. Tasks stay in PMOFlow.` });
      send(200, { ok: true }); return true;
    }
    fail(405, 'method not allowed'); return true;
  }

  if (seg.length !== 5 || method !== 'POST') { fail(seg.length === 5 ? 405 : 404, seg.length === 5 ? 'method not allowed' : 'unknown route'); return true; }

  if (sub === 'sync') {
    if (!canWork(project)) { fail(403, `Only the project team of ${project.name} can run a sync.`); return true; }
    const out = await runSync({ store, wsId, actor, today }, conn, st, {});
    await store.putDoc(wsId, TYPE, id, conn);
    await store.appendEvent(wsId, { actor, action: 'sync', ref: `${TYPE}:${id}`, summary: `Synced with ${toolName(conn)}: ${syncSentence(conn, out.sum)}` });
    send(200, { ok: true, connection: publicConn(conn), summary: out.sum, sentence: syncSentence(conn, out.sum), before: out.before, after: out.after, entries: out.entries.map(e => e.id) });
    return true;
  }

  if (sub === 'sim') {
    /* A person working in the (simulated) tool. Anyone may act there; the change then flows back like a webhook. */
    const key = String(body.key || '');
    conn.sim = conn.sim || S.simNew(conn);
    const item = conn.sim.items[key];
    if (!item) { fail(404, `${key || 'That item'} isn’t in ${toolName(conn)}. Sync first.`); return true; }
    const patch = {};
    if (typeof body.status === 'string') {
      const ok = S.toolStatuses(conn).includes(body.status) || S.pmoStatus(conn, body.status) !== undefined;
      if (!ok) { fail(400, `“${body.status}” isn’t a status in ${toolName(conn)}.`); return true; }
      patch.status = body.status;
    }
    if (typeof body.title === 'string') { const t = body.title.trim(); if (!t || t.length > 200) { fail(400, 'A title needs 1–200 characters.'); return true; } patch.title = t; }
    if (typeof body.assigneeEmail === 'string') patch.assigneeEmail = body.assigneeEmail.trim().slice(0, 254);
    if (typeof body.due === 'string') { if (!/^\d{4}-\d{2}-\d{2}$/.test(body.due)) { fail(400, 'Use a YYYY-MM-DD date.'); return true; } patch.due = body.due; }
    if (!Object.keys(patch).length) { fail(400, 'Nothing to change.'); return true; }
    const was = Object.assign({}, item);
    /* the tool's clock moves forward, so this change is newer than anything already synced */
    const at = new Date(Math.max(Date.now(), Date.parse(conn.cursor || 0) + 1)).toISOString();
    S.simEdit(conn.sim, key, patch, at);
    const what = Object.keys(patch).map(k => `${k === 'assigneeEmail' ? 'assignee' : k} ${shortVal(was[k])} → ${shortVal(patch[k])}`).join('; ');
    await store.appendEvent(wsId, { actor: actor || 'anonymous', action: 'tool-change', ref: `${TYPE}:${id}`, summary: `In ${toolName(conn)}: ${key} ${what}` });
    const out = await runSync({ store, wsId, actor: actor || 'anonymous', today }, conn, st, { outbound: true });
    await store.putDoc(wsId, TYPE, id, conn);
    send(200, { ok: true, connection: publicConn(conn), summary: out.sum, sentence: syncSentence(conn, out.sum), before: out.before, after: out.after, changed: what });
    return true;
  }

  if (sub === 'notify') {
    const event = String(body.event || '');
    if (!S.EVENTS.includes(event)) { fail(400, 'Choose a notification type.'); return true; }
    const n = conn.notify || {};
    if (!(n.teams && n.teams.on) && !(n.outlook && n.outlook.on)) { fail(400, 'Turn on Teams or Outlook first (Edit settings → Notifications).'); return true; }
    const notice = S.noticeFor(event, noticeContext(docs, conn, today, body.origin));
    const delivery = { id: 'dlv-' + crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), by: actor, event, title: notice.title,
      status: 'simulated', enabled: !!(n.events || {})[event], results: [] };
    conn.nonces = pruneNonces(conn.nonces, Date.now());
    const secretOf = kid => (kid === conn.kid || kid === conn.kid - 1 ? secretFor(wsId, conn, kid) : null);
    for (const it of S.notifyIntents(conn, notice)) {
      const signed = sign(it, secretFor(wsId, conn));
      const v = verify(signed, secretOf, conn.nonces, Date.now());
      const r = v.ok ? S.simExecute(conn, conn.sim || S.simNew(conn), signed, new Date().toISOString()) : { ok: false, detail: 'Relay refused: ' + v.reason };
      delivery.results.push({ channel: it.payload.channel, ok: r.ok, detail: r.detail });
      if (it.payload.channel === 'teams') delivery.teams = { channel: n.teams.channel, secretName: it.payload.secretName, body: it.payload.body, intentId: signed.id };
      else delivery.outlook = { to: it.payload.to, body: it.payload.body, intentId: signed.id };
    }
    if (!delivery.results.length) { fail(400, 'Add at least one Outlook recipient or turn on Teams.'); return true; }
    conn.deliveries = [delivery].concat(conn.deliveries || []).slice(0, DELIVERY_CAP);
    await store.putDoc(wsId, TYPE, id, conn);
    await store.appendEvent(wsId, { actor: actor || 'anonymous', action: 'notify', ref: `${TYPE}:${id}`,
      summary: `Notification preview “${notice.title}” (${[delivery.teams && 'Teams', delivery.outlook && 'Outlook'].filter(Boolean).join(' and ')}; demo, not sent)`.slice(0, 300) });
    send(200, { ok: true, delivery, notice }); return true;
  }

  if (sub === 'rotate') {
    if (!canWork(project)) { fail(403, teamMsg(project)); return true; }
    conn.kid = (conn.kid || 1) + 1;
    conn.rotatedAt = new Date().toISOString();
    await store.putDoc(wsId, TYPE, id, conn);
    await store.appendEvent(wsId, { actor, action: 'rotate', ref: `${TYPE}:${id}`, summary: `Rotated the signing key for "${project.name}" (now key ${conn.kid}; key ${conn.kid - 1} still accepted until the next rotation)` });
    send(200, { ok: true, connection: publicConn(conn) }); return true;
  }

  if (sub === 'replay') {
    const signedOk = (conn.log || []).filter(e => e.intent && e.intent.sig && e.result === 'ok');
    const last = signedOk.find(e => e.op === 'update' || e.op === 'create') || signedOk[0];
    if (!last) { fail(409, 'Sync once first, so there is a signed request to replay.'); return true; }
    const secretOf = kid => (kid === conn.kid || kid === conn.kid - 1 ? secretFor(wsId, conn, kid) : null);
    const seen = Object.assign({}, conn.nonces || {});
    /* the nonce is remembered for its 5-minute life; after that the expiry check refuses it instead */
    const v = verify(last.intent, secretOf, seen, Date.now());
    const tampered = Object.assign({}, last.intent, { payload: Object.assign({}, last.intent.payload, { status: 'Done' }), nonce: last.intent.nonce + 'x' });
    const t = verify(tampered, secretOf, Object.assign({}, conn.nonces || {}), Date.now());
    const detail = `Replayed the signed ${last.op}${last.key ? ' of ' + last.key : ''}: ${v.ok ? 'accepted (unexpected)' : 'refused, ' + v.reason} Tampered copy: ${t.ok ? 'accepted (unexpected)' : 'refused, ' + t.reason}`;
    conn.log = [{ id: 'log-' + crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), dir: 'out', op: 'replay-test', key: last.key, result: v.ok || t.ok ? 'failed' : 'refused', detail }].concat(conn.log || []).slice(0, LOG_CAP);
    await store.putDoc(wsId, TYPE, id, conn);
    await store.appendEvent(wsId, { actor: actor || 'anonymous', action: 'security-test', ref: `${TYPE}:${id}`, summary: detail.slice(0, 300) });
    send(200, { ok: true, replay: { refused: !v.ok, reason: v.reason || null }, tampered: { refused: !t.ok, reason: t.reason || null }, detail }); return true;
  }

  fail(404, 'unknown route'); return true;
}

module.exports = { handle, _internal: { sign, verify, secretFor, runSync, noticeContext, syncSentence, doneBeforeDeps } };
