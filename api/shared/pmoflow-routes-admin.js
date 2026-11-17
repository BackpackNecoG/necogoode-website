/* PMOFlow R10 stream S5: workspace admin routes (people and roles, invites, holiday calendar, hash-chained audit export).
   Loaded by api/pmoflow/index.js through the route-module hook. Handles:
     GET    /workspaces/:ws/admin                      settings with defaults, effective roles, seat counts
     PUT    /workspaces/:ws/admin/roles/:personId      {role, actor}            Admin only
     POST   /workspaces/:ws/admin/invites              {email, role, actor}     Admin only (stored, no email is sent)
     DELETE /workspaces/:ws/admin/invites/:id          {actor}                  Admin only
     POST   /workspaces/:ws/admin/holidays             {date, name, actor}      Admin only
     DELETE /workspaces/:ws/admin/holidays/:date       {actor}                  Admin only
     GET    /workspaces/:ws/admin/audit?format=json|csv&person=&item=&from=&to=   chained log + Verify result
     POST   /workspaces/:ws/admin/audit/anchor         {actor}                  records the current chain head
     POST   /workspaces/:ws/admin/audit/verify         {entries:[...]}          re-checks a saved JSON export
   Roles, invites and audit checkpoints live in ONE doc: type 'workspace', id 'settings'
     { roles: {personId: role}, invites: [...], anchors: [...] }   (rides along in /ws/:ws/state as docs.workspace)
   Holidays live in S1's calendar doc: type 'calendar', id 'workspace', { holidays: [{date, name}, {date, name, off: true}] },
   which the engine's holidays()/addBusinessDays read.

   AUDIT CHAIN (computed at export time; see chainEvents): entries are ordered oldest first, exactly as the history
   store returns them, and each entry's hash = SHA-256(prevHash + "\n" + canonical(entry)). The first prevHash is a
   per-workspace genesis value. Recorded anchors (head hash at entry n) make later edits to anchored history detectable. */
const crypto = require('crypto');
const seedMod = require('./pmoflow-seed');

/* Until S1 adds 'workspace' to DOC_TYPES in pmoflow-seed.js, register it here so getState returns docs.workspace and the
   seed initialises it to []. Idempotent; a no-op once the seed lists it. (Reported to the lead.) */
if (Array.isArray(seedMod.DOC_TYPES) && !seedMod.DOC_TYPES.includes('workspace')) seedMod.DOC_TYPES.push('workspace');

const WS_RE = /^[a-z0-9]{12,32}$/;
const ID_RE = /^[\w.-]{1,64}$/;
const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const ROLES = ['admin', 'editor', 'approver', 'viewer'];
const ROLE_LABEL = { admin: 'Admin', editor: 'Editor', approver: 'Approver', viewer: 'Viewer' };
const PAID = ['admin', 'editor'];                 /* approvers and viewers are free seats */
const SETTINGS_ID = 'settings';
const MAX_INVITES = 200, MAX_HOLIDAYS = 200, MAX_ANCHORS = 50, AUDIT_LIMIT = 500;
/* What each role may write through the generic doc API (admin settings go through this module only). */
const APPROVER_TYPES = ['approval', 'grant', 'comment', 'notification'];
const VIEWER_TYPES = ['comment', 'notification'];

const isPlainObject = v => v && typeof v === 'object' && !Array.isArray(v);
const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && isFinite(Date.parse(v + 'T12:00:00Z')) &&
  new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
const actorOf = b => (b && typeof b.actor === 'string' && ID_RE.test(b.actor) ? b.actor : 'anonymous');
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

/* ---------- roles ---------- */
/* Default role from the directory title: the project manager and the process owner run the workspace; everyone else edits.
   Defaults never take write access away from anyone, so existing flows keep working until an Admin changes a role. */
function defaultRole(person) {
  const t = String((person && person.role) || '');
  if (/project manager|process owner/i.test(t)) return 'admin';
  return 'editor';
}
function settingsOf(docs) {
  const d = ((docs && docs.workspace) || []).find(x => x.id === SETTINGS_ID);
  const s = d && isPlainObject(d.data) ? d.data : {};
  return {
    id: SETTINGS_ID,
    roles: isPlainObject(s.roles) ? s.roles : {},
    invites: Array.isArray(s.invites) ? s.invites.filter(isPlainObject) : [],
    anchors: Array.isArray(s.anchors) ? s.anchors.filter(isPlainObject) : [],
  };
}
function roleOf(docs, personId) {
  const s = settingsOf(docs);
  if (ROLES.includes(s.roles[personId])) return s.roles[personId];
  const p = ((docs && docs.person) || []).find(d => d.id === personId);
  return p ? defaultRole(p.data) : null;
}
function effectiveRoles(docs) {
  return ((docs && docs.person) || []).map(d => ({ id: d.id, name: d.data.name, title: d.data.role, role: roleOf(docs, d.id),
    isDefault: !ROLES.includes(settingsOf(docs).roles[d.id]) }));
}
function seats(docs) {
  const s = settingsOf(docs);
  const people = effectiveRoles(docs);
  const count = r => people.filter(p => p.role === r).length + s.invites.filter(i => i.role === r).length;
  const c = { admin: count('admin'), editor: count('editor'), approver: count('approver'), viewer: count('viewer') };
  return Object.assign(c, { paid: c.admin + c.editor, free: c.approver + c.viewer });
}
const personName = (docs, id) => { const p = ((docs.person || []).find(d => d.id === id) || {}).data; return p ? p.name : null; };
function admins(docs) { return effectiveRoles(docs).filter(p => p.role === 'admin'); }

/* Server-side role check for the generic doc API in index.js (lead hook): returns an error message or null.
   Unknown actors (no matching person) are left to the existing R5 owner checks, so anonymous demo use is unchanged. */
function roleError(docs, actor, type) {
  if (type === 'workspace') return 'Workspace settings change only from Admin.';
  const role = roleOf(docs, actor);
  if (type === 'calendar' && role && role !== 'admin') return adminError(docs, actor);
  if (!role || role === 'admin' || role === 'editor') return null;
  const nm = personName(docs, actor) || 'This person';
  if (role === 'viewer' && !VIEWER_TYPES.includes(type)) return `${nm} is a Viewer, so they can read and comment but not make changes. An Admin can change their role.`;
  if (role === 'approver' && !APPROVER_TYPES.includes(type)) return `${nm} is an Approver, so they can approve and comment but not edit. An Admin can change their role.`;
  return null;
}
function adminError(docs, actor) {
  if (roleOf(docs, actor) === 'admin') return null;
  const list = admins(docs).map(a => a.name);
  return `Only an Admin can change workspace settings${list.length ? ` (Admins: ${list.join(', ')})` : ''}.`;
}

/* ---------- audit chain ---------- */
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const genesis = wsId => sha256('pmoflow-audit-genesis|' + wsId);
/* The hashed content of an entry: position plus the five stored fields, in a fixed order. */
const canonical = (seq, e) => JSON.stringify([seq, String(e.at || ''), String(e.actor || ''), String(e.action || ''), String(e.ref || ''), String(e.summary || '')]);
/* events: oldest first. Returns entries with seq, prevHash, hash. Deterministic for the same ordered input. */
function chainEvents(wsId, events) {
  let prev = genesis(wsId);
  return events.map((e, i) => {
    const seq = i + 1;
    const hash = sha256(prev + '\n' + canonical(seq, e));
    const out = { seq, at: e.at, actor: e.actor, action: e.action, ref: e.ref, summary: e.summary, prevHash: prev, hash };
    prev = hash;
    return out;
  });
}
/* Recompute a chain from its entries (as exported). Checks each prevHash link and each hash, then any anchors. */
function verifyChain(wsId, entries, anchors) {
  let prev = genesis(wsId);
  const out = { ok: true, count: 0, head: prev, firstBreak: null, anchorsChecked: 0, at: new Date().toISOString() };
  for (let i = 0; i < (entries || []).length; i++) {
    const e = entries[i] || {};
    const seq = i + 1;
    const want = sha256(prev + '\n' + canonical(seq, e));
    if (Number(e.seq) !== seq || e.prevHash !== prev || e.hash !== want) {
      out.ok = false;
      out.firstBreak = { seq, reason: Number(e.seq) !== seq ? 'an entry is missing or out of order' : e.prevHash !== prev ? 'the link to the previous entry is broken' : 'the entry was changed after it was recorded' };
      break;
    }
    prev = want; out.count = seq; out.head = want;
  }
  for (const a of anchors || []) {
    if (!out.ok) break;
    const n = Number(a.n);
    if (!(n >= 1)) continue;
    out.anchorsChecked++;
    const e = (entries || [])[n - 1];
    if (!e || e.hash !== a.hash) { out.ok = false; out.firstBreak = { seq: n, reason: `history up to entry ${n} no longer matches the copy recorded ${String(a.at || '').slice(0, 10)}` }; }
  }
  out.summary = out.ok ? `Chain intact: ${out.count} entr${out.count === 1 ? 'y' : 'ies'} recomputed${out.anchorsChecked ? `, ${out.anchorsChecked} recorded checkpoint${out.anchorsChecked === 1 ? '' : 's'} match` : ''}.`
    : `Chain broken at entry ${out.firstBreak.seq}: ${out.firstBreak.reason}.`;
  return out;
}
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           /* no spreadsheet formula injection */
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(entries, verify) {
  const cols = ['seq', 'at', 'actor', 'actorName', 'action', 'ref', 'summary', 'prevHash', 'hash'];
  const lines = [cols.join(',')].concat(entries.map(e => cols.map(c => csvCell(e[c])).join(',')));
  lines.push('');
  lines.push(csvCell('# Verify: ' + verify.summary + ' Head ' + verify.head + '. Recomputed ' + verify.at + '.'));
  return lines.join('\r\n') + '\r\n';
}
function filterEntries(entries, q) {
  const person = q.person ? String(q.person) : '';
  const item = q.item ? String(q.item).toLowerCase() : '';
  const from = isDay(q.from) ? q.from : '', to = isDay(q.to) ? q.to : '';
  return entries.filter(e => (!person || e.actor === person) &&
    (!item || String(e.ref || '').toLowerCase().includes(item) || String(e.summary || '').toLowerCase().includes(item)) &&
    (!from || String(e.at).slice(0, 10) >= from) && (!to || String(e.at).slice(0, 10) <= to));
}
async function chainFor(store, ws) {
  const evs = (await store.listEvents(ws, { limit: AUDIT_LIMIT })).slice().reverse();   /* oldest first */
  return chainEvents(ws.id, evs);
}

/* ---------- persistence ---------- */
async function saveSettings(store, wsId, s) {
  const data = { id: SETTINGS_ID, roles: s.roles, invites: s.invites.slice(-MAX_INVITES), anchors: s.anchors.slice(-MAX_ANCHORS) };
  await store.putDoc(wsId, 'workspace', SETTINGS_ID, data);
  return data;
}
/* S1's calendar doc: docs.calendar, id 'workspace', {holidays: [{date, name, off?}]} */
const CAL_ID = 'workspace';
function calendarOf(docs) {
  const d = ((docs && docs.calendar) || []).find(x => x.id === CAL_ID);
  const doc = d && isPlainObject(d.data) ? d.data : { id: CAL_ID };
  const holidays = (Array.isArray(doc.holidays) ? doc.holidays : []).filter(h => isPlainObject(h) && isDay(h.date)).map(h => Object.assign({}, h));
  return { doc, holidays };
}
function engine() { try { return require('./pmoflow-engine.js'); } catch (e) { return null; } }
function federalName(date) {
  const eng = engine();
  if (!eng || typeof eng.federalHolidays !== 'function') return null;
  const f = eng.federalHolidays(+String(date).slice(0, 4)).find(h => h.date === date);
  return f ? f.name : null;
}
function view(docs, s) {
  return { settings: s, calendar: calendarOf(docs).doc, people: effectiveRoles(docs), seats: seats(docs), roles: ROLES.map(r => ({ id: r, label: ROLE_LABEL[r], paid: PAID.includes(r) })) };
}

/* ---------- route handler ---------- */
async function handle({ method, seg, body, req, store, send, fail }) {
  /* Guard: the generic doc API must not write the settings doc directly (it would skip the Admin check). */
  if (seg[0] === 'ws' && seg[2] === 'doc' && seg[3] === 'workspace' && method !== 'GET') { fail(403, 'Workspace settings change only from Admin.'); return true; }
  if (seg[0] !== 'workspaces' || seg[2] !== 'admin') return false;
  const wsId = seg[1];
  if (!WS_RE.test(wsId || '')) { fail(400, 'invalid workspace id'); return true; }
  const ws = await store.getWorkspace(wsId);
  if (!ws || ws.expired) { fail(404, 'workspace not found or expired'); return true; }
  const rest = seg.slice(3);
  const q = (req && req.query) || {};
  body = body || {};

  /* GET /workspaces/:ws/admin */
  if (!rest.length) {
    if (method !== 'GET') { fail(405, 'method not allowed'); return true; }
    const st = await store.getState(ws);
    send(200, view(st.docs, settingsOf(st.docs)));
    return true;
  }

  /* audit */
  if (rest[0] === 'audit') {
    if (rest.length === 1) {
      if (method !== 'GET') { fail(405, 'method not allowed'); return true; }
      const st = await store.getState(ws);
      const s = settingsOf(st.docs);
      const chain = await chainFor(store, ws);
      const verify = verifyChain(wsId, chain, s.anchors);
      const names = Object.fromEntries((st.docs.person || []).map(d => [d.id, d.data.name]));
      const entries = filterEntries(chain, q).map(e => Object.assign({}, e, { actorName: names[e.actor] || e.actor }));
      const filtered = entries.length !== chain.length;
      if (String(q.format || 'json') === 'csv') {
        send(200, toCSV(entries, verify));
        return true;
      }
      send(200, { workspace: wsId, exportedAt: new Date().toISOString(), algorithm: 'SHA-256(prevHash + "\\n" + JSON[seq, at, actor, action, ref, summary])',
        genesis: genesis(wsId), total: chain.length, filtered, verify, anchors: s.anchors, entries, limit: AUDIT_LIMIT });
      return true;
    }
    if (rest[1] === 'verify' && rest.length === 2) {
      if (method !== 'POST') { fail(405, 'method not allowed'); return true; }
      if (!Array.isArray(body.entries) || body.entries.length > 5000) { fail(400, 'entries must be the array from a JSON export'); return true; }
      send(200, { verify: verifyChain(wsId, body.entries, []) });
      return true;
    }
    if (rest[1] === 'anchor' && rest.length === 2) {
      if (method !== 'POST') { fail(405, 'method not allowed'); return true; }
      const st = await store.getState(ws);
      const actor = actorOf(body);
      const chain = await chainFor(store, ws);
      const s = settingsOf(st.docs);
      const head = chain[chain.length - 1];
      if (head && !(s.anchors.length && s.anchors[s.anchors.length - 1].hash === head.hash)) {
        s.anchors.push({ n: head.seq, hash: head.hash, at: new Date().toISOString(), by: actor });
        await saveSettings(store, wsId, s);
      }
      send(200, { ok: true, anchor: s.anchors[s.anchors.length - 1] || null });
      return true;
    }
    fail(404, 'unknown route'); return true;
  }

  /* writes below: Admin only */
  if (method === 'GET') { fail(405, 'method not allowed'); return true; }
  const st = await store.getState(ws);
  const docs = st.docs;
  const actor = actorOf(body);
  const denied = adminError(docs, actor);
  if (denied) { fail(403, denied); return true; }
  const s = settingsOf(docs);
  const log = (ref, summary) => store.appendEvent(wsId, { actor, action: 'admin', ref, summary });

  if (rest[0] === 'roles' && rest.length === 2 && method === 'PUT') {
    const pid = rest[1];
    if (!ID_RE.test(pid) || !(docs.person || []).some(d => d.id === pid)) { fail(404, 'Choose a person from the directory.'); return true; }
    const role = String(body.role || '');
    if (!ROLES.includes(role)) { fail(400, 'Role must be Admin, Editor, Approver or Viewer.'); return true; }
    const before = roleOf(docs, pid);
    if (before === 'admin' && role !== 'admin' && admins(docs).length <= 1) { fail(409, 'The workspace needs at least one Admin. Make someone else an Admin first.'); return true; }
    s.roles[pid] = role;
    const data = await saveSettings(store, wsId, s);
    const after = Object.assign({}, docs, { workspace: [{ id: SETTINGS_ID, data }] });
    await log('person:' + pid, `Changed ${personName(docs, pid)}'s role from ${ROLE_LABEL[before]} to ${ROLE_LABEL[role]}`);
    send(200, view(after, settingsOf(after)));
    return true;
  }

  if (rest[0] === 'invites') {
    if (rest.length === 1 && method === 'POST') {
      const email = clean(body.email, 254).toLowerCase();
      const role = String(body.role || 'editor');
      if (!EMAIL_RE.test(email)) { fail(400, 'Enter a work email address, like name@company.com.'); return true; }
      if (!ROLES.includes(role)) { fail(400, 'Role must be Admin, Editor, Approver or Viewer.'); return true; }
      if (s.invites.some(i => i.email === email)) { fail(409, `${email} is already invited.`); return true; }
      if (s.invites.length >= MAX_INVITES) { fail(409, 'Too many open invites. Remove some first.'); return true; }
      const id = 'inv-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      s.invites.push({ id, email, role, by: actor, at: new Date().toISOString() });
      const data = await saveSettings(store, wsId, s);
      const after = Object.assign({}, docs, { workspace: [{ id: SETTINGS_ID, data }] });
      await log('workspace:' + wsId, `Invited ${email} as ${ROLE_LABEL[role]} (no email sent in the demo)`);
      send(200, view(after, settingsOf(after)));
      return true;
    }
    if (rest.length === 2 && method === 'DELETE') {
      const inv = s.invites.find(i => i.id === rest[1]);
      if (!inv) { fail(404, 'invite not found'); return true; }
      s.invites = s.invites.filter(i => i.id !== inv.id);
      const data = await saveSettings(store, wsId, s);
      const after = Object.assign({}, docs, { workspace: [{ id: SETTINGS_ID, data }] });
      await log('workspace:' + wsId, `Removed the invite for ${inv.email}`);
      send(200, view(after, settingsOf(after)));
      return true;
    }
  }

  if (rest[0] === 'holidays') {
    /* Writes S1's calendar doc (type 'calendar', id 'workspace'): {date, name} adds a day off; {date, name, off: true}
       means the workspace works that federal holiday. The engine's holidays()/addBusinessDays read it. */
    const cal = calendarOf(docs);
    const fed = date => federalName(date);
    const saveCal = async (summary) => {
      const data = Object.assign({}, cal.doc, { id: CAL_ID, holidays: cal.holidays.sort((a, b) => a.date.localeCompare(b.date)) });
      await store.putDoc(wsId, 'calendar', CAL_ID, data);
      await log('calendar:' + CAL_ID, summary);
      const after = Object.assign({}, docs, { calendar: [{ id: CAL_ID, data }] });
      send(200, Object.assign(view(after, s), { calendar: data }));
    };
    if (rest.length === 1 && method === 'POST') {
      const date = String(body.date || '');
      if (!isDay(date)) { fail(400, 'Pick a real date.'); return true; }
      const worked = cal.holidays.find(h => h.date === date && h.off);
      if (worked) {                                          /* restore a federal holiday the workspace had been working */
        cal.holidays = cal.holidays.filter(h => h !== worked);
        await saveCal(`Restored ${fed(date) || 'the holiday'} (${date}) as a day off`);
        return true;
      }
      if (fed(date)) { fail(409, `${date} is already a holiday (${fed(date)}).`); return true; }
      if (cal.holidays.some(h => h.date === date)) { fail(409, 'That day is already on the calendar.'); return true; }
      if (cal.holidays.length >= MAX_HOLIDAYS) { fail(409, 'The calendar is full. Remove past days first.'); return true; }
      const name = clean(body.name, 60) || 'Company holiday';
      cal.holidays.push({ date, name });
      await saveCal(`Added ${name} (${date}) to the holiday calendar`);
      return true;
    }
    if (rest.length === 2 && method === 'DELETE') {
      const date = rest[1];
      if (!isDay(date)) { fail(400, 'Pick a real date.'); return true; }
      const custom = cal.holidays.find(h => h.date === date && !h.off);
      if (custom) {
        cal.holidays = cal.holidays.filter(h => h !== custom);
        await saveCal(`Removed ${custom.name || 'Company holiday'} (${date}) from the holiday calendar`);
        return true;
      }
      if (fed(date) && !cal.holidays.some(h => h.date === date && h.off)) {
        cal.holidays.push({ date, name: fed(date), off: true });
        await saveCal(`${fed(date)} (${date}) is now a working day`);
        return true;
      }
      fail(404, 'That day is not on the calendar.'); return true;
    }
  }

  fail(404, 'unknown route');
  return true;
}

module.exports = { handle, roleError, roleOf, settingsOf, effectiveRoles, seats, chainEvents, verifyChain, toCSV, filterEntries, genesis, canonical,
  ROLES, ROLE_LABEL, defaultRole };
