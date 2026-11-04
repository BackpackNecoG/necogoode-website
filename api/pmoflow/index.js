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
        const exists = (st.docs[type] || []).some(d => d.id === id);
        await store.putDoc(wsId, type, id, data);
        const ev = await store.appendEvent(wsId, { actor, action: exists ? 'update' : 'create', ref: `${type}:${id}`,
          summary: summaryOf(body, `${exists ? 'Updated' : 'Created'} ${type} ${id}`) });
        return send(200, { ok: true, doc: { type, id, data }, event: ev });
      }
      if (method === 'DELETE') {
        await store.deleteDoc(wsId, type, id);
        const ev = await store.appendEvent(wsId, { actor, action: 'delete', ref: `${type}:${id}`, summary: summaryOf(body, `Deleted ${type} ${id}`) });
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

    /* POST /ws/:ws/golive/:projectId */
    if (action === 'golive' && seg.length === 4) {
      const projectId = seg[3];
      if (!ID_RE.test(projectId)) return fail(400, 'invalid project id');
      const eng = engine();
      if (!eng || typeof eng.readiness !== 'function') return fail(503, 'engine unavailable');
      const st = await store.getState(ws);
      const docs = st.docs;
      const project = ((docs.project || []).find(d => d.id === projectId) || {}).data;
      if (!project) return fail(404, 'unknown project');
      if (project.status === 'live') return fail(409, 'project is already live', ['Project status is live.']);
      const gate = eng.readiness(docs, projectId, today);
      if (!gate.pass) {
        return fail(409, 'readiness gate failed', gate.checks.filter(c => !c.pass && !c.warning).map(c => `${c.label}: ${c.detail}`));
      }
      const actor = actorOf(body);
      const at = new Date().toISOString();
      const events = [];
      const snapshot = {};
      const procDocs = (docs.process || []).filter(d => (project.processes || []).includes(d.id));
      for (const pd of procDocs) {
        const p = JSON.parse(JSON.stringify(pd.data));
        const version = (Number(p.version) || 1) + 1;
        const promoted = cloneNodes(p.tobe, false);
        p.released = (p.released || []).concat([{ version, at, by: actor, asis: promoted }]);
        p.asis = promoted;
        p.tobe = cloneNodes(promoted, true);
        p.version = version;
        snapshot[p.id] = version;
        await store.putDoc(wsId, 'process', p.id, p);
        events.push({ action: 'release', ref: 'process:' + p.id, summary: `Released ${p.name} v${version}: to-be promoted to as-is` });
      }
      for (const gd of (docs.grant || []).filter(d => d.data.projectId === projectId)) {
        const g = JSON.parse(JSON.stringify(gd.data));
        const next = g.status === 'active' || g.status === 'approved' ? 'expired' : g.status === 'requested' ? 'denied' : null;
        if (!next) continue;
        g.status = next; g.expires = today;
        g.log = (g.log || []).concat([{ at, by: actor, action: next === 'expired' ? 'expired at go-live' : 'denied at go-live' }]);
        await store.putDoc(wsId, 'grant', g.id, g);
        events.push({ action: 'update', ref: 'grant:' + g.id, summary: `Grant ${g.id} ${next} at go-live` });
      }
      const people = Object.fromEntries((docs.person || []).map(d => [d.id, d.data]));
      const approvers = [...new Set((docs.approval || []).map(d => d.data)
        .filter(a => a.projectId === projectId && a.decision === 'approved' && a.stepUp === true).map(a => a.approver))];
      const exc = gate.checks.find(c => c.id === 'exceptions');
      const relId = 'rel-' + projectId.slice(0, 40) + '-' + Date.now().toString(36);
      const dispatch = { ref: 'main', inputs: { project: projectId, release: relId, processes: JSON.stringify(snapshot) } };
      const release = {
        id: relId, projectId, at, by: actor, approvers,
        actions: [
          { type: 'pipeline', target: 'github: northwind-traders/process-automation · release.yml', status: 'simulated-ok',
            detail: 'POST https://api.github.com/repos/northwind-traders/process-automation/actions/workflows/release.yml/dispatches\n' +
              'Accept: application/vnd.github+json\nAuthorization: Bearer <token from Key Vault>\n\n' + JSON.stringify(dispatch, null, 2) },
          ...procDocs.map(pd => ({ type: 'sop-publish', target: `SOP library: ${pd.data.name} v${snapshot[pd.id]}`, status: 'simulated-ok',
            detail: `Published the released process as the controlled SOP for ${pd.data.name}; the previous version was archived.` })),
          { type: 'notify', target: (project.resources || []).map(id => (people[id] && people[id].name) || id).join(', '), status: 'simulated-ok',
            detail: `Go-live notice for ${project.name} sent to the project team and process owners.` },
        ],
        exceptions: exc && exc.items ? exc.items.map(w => ({ workId: w, note: 'Changed after business unit sign-off' })) : [],
        snapshot,
      };
      await store.putDoc(wsId, 'release', relId, release);
      const proj = Object.assign({}, project, { status: 'live', liveAt: at });
      await store.putDoc(wsId, 'project', projectId, proj);
      events.push({ action: 'create', ref: 'release:' + relId, summary: `Release ${relId} recorded with ${release.actions.length} simulated action(s)` });
      events.push({ action: 'golive', ref: 'project:' + projectId, summary: `${project.name} went live` });
      for (const e of events) await store.appendEvent(wsId, Object.assign({ actor, at }, e));
      return send(200, { ok: true, release, project: proj });
    }

    return fail(404, 'unknown route');
  } catch (e) {
    context.log && context.log('[pmoflow] ' + (e && e.message ? e.message.slice(0, 200) : 'error'));
    return fail(e && e.status === 503 ? 503 : 500, 'server error');
  }
};

module.exports._internal = { clientIpHash, cloneNodes, localProfile, WS_RE, ID_RE };
