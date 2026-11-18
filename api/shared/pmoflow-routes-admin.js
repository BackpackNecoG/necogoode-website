/* PMOFlow R10 stream S5: workspace admin routes (people and roles, invites, holiday calendar, hash-chained audit export).
   Loaded by api/pmoflow/index.js through the route-module hook. Handles:
     GET    /workspaces/:ws/admin                      settings with defaults, effective roles, seat counts
     PUT    /workspaces/:ws/admin/roles/:personId      {role, actor}            Admin only. R15: a proposal a second Admin confirms
     POST   /workspaces/:ws/admin/roles/pending/:id/confirm|cancel  {actor, stepUp}  R15: the second Admin confirms (step-up)
     POST   /workspaces/:ws/admin/invites              {email, role, actor}     Admin only (stored, no email is sent)
     DELETE /workspaces/:ws/admin/invites/:id          {actor}                  Admin only
     POST   /workspaces/:ws/admin/holidays             {date, name, actor}      Admin only
     DELETE /workspaces/:ws/admin/holidays/:date       {actor}                  Admin only
     POST   /ws/:ws/departments                        {op, actor}  R14: assign/approvers become proposals (two Admins, step-up)
     POST   /workspaces/:ws/admin/departments/pending/:id/confirm|cancel  {actor, stepUp}  a second Admin confirms
     PUT    /workspaces/:ws/admin/sponsor/:projectId   {sponsor, actor}         R14: an Admin who is not the PM (or the current sponsor)
     GET    /workspaces/:ws/admin/audit?format=json|csv&person=&item=&from=&to=   chained log + Verify result
     POST   /workspaces/:ws/admin/audit/anchor         {actor}                  records the current chain head
     POST   /workspaces/:ws/admin/audit/verify         {entries:[...], head}    re-checks a saved JSON export (links, signed head, checkpoints)
     POST   /workspaces                                  R11: sandbox creation (returning visitor via the pmoflow_ws cookie, limits)
   Roles, invites and audit checkpoints live in ONE doc: type 'workspace', id 'settings'
     { roles: {personId: role}, invites: [...], anchors: [...] }   (rides along in /ws/:ws/state as docs.workspace)
   Holidays live in S1's calendar doc: type 'calendar', id 'workspace', { holidays: [{date, name}, {date, name, off: true}] },
   which the engine's holidays()/addBusinessDays read.

   AUDIT CHAIN (computed at export time; see chainEvents): entries are ordered oldest first, exactly as the history
   store returns them, and each entry's hash = SHA-256(prevHash + "\n" + canonical(entry)). The first prevHash is a
   per-workspace genesis value. Recorded anchors (head hash at entry n) make later edits to anchored history detectable.
   R11 KEYED HEAD: every export carries head = {count, hash, signature}, signature = HMAC-SHA256 over
   (workspace, count, head hash) with a per-workspace key = HMAC-SHA256(server secret, workspace id). The server secret is
   the app setting PMOFLOW_AUDIT_KEY, else a dev key derived (HMAC) from the storage connection string read at runtime,
   else (in-memory dev backend only) a random per-process key. The secret is never returned, printed or logged.
   Verify fails on: an edited entry (hash mismatch), a deleted or added tail (count/head mismatch), a fully re-hashed
   forgery (bad signature), and history that no longer matches a recorded checkpoint.
   R12 (CONSOLIDATED-R11 #2): the hashed content includes the actor's id AND display name (actorName), so changing who an
   entry names fails the check. The name is the one shown at export (the person's name, or the external identity such as
   "Jira: jane@contoso.com" that sync records). Checkpoints recorded before R12 hashed without the name; they carry no `v`
   and are not compared (v: 2 checkpoints are). A CSV export ends with a footer row
   "# Signed head,<count>,<head hash>,<signature>,<key source>" and can be checked in the app like a JSON export.
   Key source label: "production key" when the app setting PMOFLOW_AUDIT_KEY is set, else "development key".
   Why export time and not write time: events are appended by the shared history store (pmoflow-store.appendEvent, called
   from index.js), which this stream does not own; chaining there needs a per-workspace head row with optimistic retry.
   So: an export is sealed when it is made, and checkpoints are recorded at every export. Not guaranteed: a change made
   directly in storage to entries newer than the latest checkpoint, before the next export. */
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
  /* R11: a seeded app role wins (e.g. Dave Ortiz, approve-only: appRole 'approver', a free seat) */
  if (person && ROLES.includes(person.appRole)) return person.appRole;
  const t = String((person && person.role) || '');
  if (/project manager|process owner/i.test(t)) return 'admin';
  return 'editor';
}
function settingsOf(docs) {
  const d = ((docs && docs.workspace) || []).find(x => x.id === SETTINGS_ID);
  const s = d && isPlainObject(d.data) ? d.data : {};
  /* R13: the stored doc also carries fields other streams own (departments: K1's POST /ws/:ws/departments). They ride
     along untouched in `rest`, so an admin write never wipes them. */
  return {
    rest: s,
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

/* ---------- R14 L4 #2: the project sponsor ---------- */
/* Who may set a project's sponsor (also the hook for the generic doc API in index.js: ADMIN_ROUTES.sponsorError).
   project: the project as stored; next: the new sponsor id (or null to clear). Returns an error message or null.
   Rules: an Admin or the current (explicit) sponsor decides; the project manager never picks the sponsor, even as an
   Admin; the project manager can never be the sponsor; nobody appoints themselves (another Admin does). */
function sponsorError(docs, actor, project, next) {
  if (!project) return 'Pick a project.';
  const cur = project.sponsor || null;
  next = next || null;
  if (cur === next) return null;
  const pmName = personName(docs, project.owner) || 'the project manager';
  if (actor && actor === project.owner) return `${pmName} is the project manager of ${project.name || 'this project'}, so another Admin sets its sponsor.`;
  if (next && next === project.owner) return `${pmName} is the project manager, so they can’t also be the sponsor. Pick someone else.`;
  if (next && next === actor && actor !== cur) return 'Nobody makes themselves sponsor: another Admin sets it.';
  if (actor && cur && actor === cur) return null;              /* the current sponsor hands it over */
  if (roleOf(docs, actor) === 'admin') return null;
  const list = admins(docs).filter(a => a.id !== project.owner).map(a => a.name);
  return `Only an Admin can change the sponsor of ${project.name || 'a project'}${list.length ? ` (ask ${list.join(' or ')})` : ''}.`;
}
function changeMod() { try { return require('./pmoflow-change.js'); } catch (e) { return null; } }
/* each project's manager, explicit sponsor and the sponsor that approves today (never the project manager) */
function projectSponsors(docs) {
  const C = changeMod();
  return ((docs && docs.project) || []).map(d => {
    const p = Object.assign({}, d.data, { id: d.id });
    const explicit = p.sponsor && p.sponsor !== p.owner && personName(docs, p.sponsor) ? p.sponsor : null;
    let effective = explicit;
    if (!effective && C && typeof C.sponsorOf === 'function') { try { effective = C.sponsorOf(docs, Object.assign({}, p, { sponsor: null }), [p.owner]) || null; } catch (e) { effective = null; } }
    if (effective === p.owner) effective = null;
    return { id: p.id, name: p.name || p.id, status: p.status || null, owner: p.owner || null, ownerName: personName(docs, p.owner),
      sponsor: explicit, sponsorName: explicit ? personName(docs, explicit) : null, effective, effectiveName: effective ? personName(docs, effective) : null };
  });
}

/* ---------- audit chain ---------- */
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const genesis = wsId => sha256('pmoflow-audit-genesis|' + wsId);
const EPHEMERAL_SECRET = crypto.randomBytes(32);
/* The server secret and where it came from. Never returned, printed or logged: callers get only the source label.
   Production (Azure: WEBSITE_SITE_NAME / WEBSITE_INSTANCE_ID set by the platform) uses ONLY the app setting
   PMOFLOW_AUDIT_KEY; without it, signing is refused (503) rather than falling back. The dev key derived from the storage
   connection string, and the per-process key, are for local runs only. */
const inAzure = () => !!(process.env.WEBSITE_SITE_NAME || process.env.WEBSITE_INSTANCE_ID);
function auditSecret() {
  const app = process.env.PMOFLOW_AUDIT_KEY;
  if (app && String(app).trim()) return { key: Buffer.from(String(app).trim(), 'utf8'), source: 'app-setting' };
  if (inAzure()) throw Object.assign(new Error('The audit signing key is not configured (app setting PMOFLOW_AUDIT_KEY).'), { status: 503 });
  const conn = process.env.EMCEE_STORAGE_CONNECTION;
  if (conn && String(conn).trim()) return { key: crypto.createHmac('sha256', String(conn).trim()).update('pmoflow-audit-dev-key|v1').digest(), source: 'derived' };
  return { key: EPHEMERAL_SECRET, source: 'ephemeral' };
}
const auditKeySource = () => { try { return auditSecret().source; } catch (e) { return 'missing'; } };
const wsKey = wsId => crypto.createHmac('sha256', auditSecret().key).update('pmoflow-audit-ws|v1|' + wsId).digest();
const headPayload = (wsId, count, hash) => `pmoflow-audit-head|v1|${wsId}|${count}|${hash}`;
function signHead(wsId, count, hash) {
  return crypto.createHmac('sha256', wsKey(wsId)).update(headPayload(wsId, count, hash)).digest('hex');
}
function headOf(wsId, chain) {
  const last = chain[chain.length - 1];
  const hash = last ? last.hash : genesis(wsId);
  return { count: chain.length, hash, signature: signHead(wsId, chain.length, hash), algorithm: 'HMAC-SHA256 over (workspace, count, head hash), keyed per workspace by the PMOFlow service' };
}
function headSignatureOk(wsId, head) {
  if (!head || typeof head.signature !== 'string' || !/^[a-f0-9]{64}$/.test(head.signature)) return false;
  const want = Buffer.from(signHead(wsId, Number(head.count), String(head.hash || '')), 'hex');
  return crypto.timingSafeEqual(want, Buffer.from(head.signature, 'hex'));
}
const CHAIN_V = 2;
const nameOf = e => String(e.actorName != null ? e.actorName : (e.actor || ''));
/* The hashed content of an entry: position, the five stored fields and the actor's display name, in a fixed order. */
const canonical = (seq, e) => JSON.stringify([seq, String(e.at || ''), String(e.actor || ''), nameOf(e), String(e.action || ''), String(e.ref || ''), String(e.summary || '')]);
/* R14: who wrote an entry's sentence. Since R14 the server writes the sentence of every generic doc save from the actual
   field diff ("Updated …: field a → b"), and keeps the person's own text only as a quoted note at the end
   (" (note: “…”)"). Before R14 the doc API stored the person's text as the sentence. The routes (sync, plan changes, admin,
   launch…) always wrote their own. R14 (Jordan B): refused writes are logged by the server as action 'refused'
   ("Refused: … — reason") and exported with refused: true. This is a label for readers: the hash covers the stored summary exactly as it is, so
   `written` and `note` are derived, never hashed, and moving text between the sentence and the note breaks the chain. */
const DOC_ACTIONS = ['create', 'update', 'delete'];
const NOTE_RE = /\s\(note: “([\s\S]*)”\)$/;
/* R15 (PMO R14 disagreement 1): sentences the server's own routes write under a create/update/delete action. Each one is
   built by the server, never taken from the request: the generic doc API ("Created/Updated/Deleted …"), a plan change's
   edits (pmoflow-routes-change: "… (plan change “title”)", "Knock-on from the plan change …"), the launch-override sign-off
   (index.js), and a connection's settings change and disconnect (pmoflow-routes-connect). Seeded demo history (opts.seeded)
   is the system's too. Only a pre-R14 doc-API sentence (the person's own text) is labelled 'client'. */
const SERVER_SENTENCE = [/^(Created|Updated|Deleted) /, / \(plan change “.*”\)$/, /^Knock-on from the plan change “/,
  /^Signed the launch override as /, /^Changed the .+ sync settings for "/, /^Disconnected project ".*" from .+\. Tasks stay in PMOFlow\.$/];
function summaryParts(summary, action, opts) {
  const sm = String(summary == null ? '' : summary);
  const m = sm.match(NOTE_RE);
  const text = m ? sm.slice(0, m.index) : sm;
  const docApi = action == null || DOC_ACTIONS.includes(String(action));
  const written = !docApi || (opts && opts.seeded) || SERVER_SENTENCE.some(re => re.test(text)) ? 'server' : 'client';
  return { written, text, note: m && written === 'server' ? m[1] : null };
}
const KEY_LABEL = { 'app-setting': 'production key', derived: 'development key', ephemeral: 'development key', missing: 'no key' };
const keyLabel = () => KEY_LABEL[auditKeySource()] || 'development key';
/* events: oldest first; names: {personId: name}. Returns entries with seq, actorName, prevHash, hash. Deterministic. */
function chainEvents(wsId, events, names) {
  let prev = genesis(wsId);
  names = names || {};
  return events.map((e, i) => {
    const seq = i + 1;
    const actorName = e.actorName != null ? String(e.actorName) : (names[e.actor] || String(e.actor || ''));
    const hash = sha256(prev + '\n' + canonical(seq, Object.assign({}, e, { actorName })));
    const out = { seq, at: e.at, actor: e.actor, actorName, action: e.action, ref: e.ref, summary: e.summary, prevHash: prev, hash };
    /* R14: derived labels (not hashed): who wrote the sentence, and the person's own note when there is one */
    const sp = summaryParts(e.summary, e.action, { seeded: !!e.seeded });
    out.written = sp.written; if (sp.note != null) out.note = sp.note;
    if (e.seeded) out.seeded = true;                         /* R15: the demo's seeded history (a label, not hashed) */
    if (String(e.action) === 'refused') out.refused = true;   /* R14 (Jordan B): a write the server refused, logged by the server */
    prev = hash;
    return out;
  });
}
/* Recompute a chain from its entries (as exported). Checks each prevHash link and each hash, then the signed head
   (opts.head: count, last hash, signature) when given or required, then any recorded anchors (checkpoints).
   opts: {head, requireHead, anchorsWithin}. Passing an array as the third argument keeps the R10 call shape (anchors only). */
function verifyChain(wsId, entries, anchors, opts) {
  opts = opts || {};
  entries = entries || [];
  let prev = genesis(wsId);
  const out = { ok: true, count: 0, head: prev, firstBreak: null, anchorsChecked: 0, signed: false, at: new Date().toISOString() };
  const brk = (seq, reason) => { out.ok = false; out.firstBreak = { seq, reason }; };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] || {};
    const seq = i + 1;
    const want = sha256(prev + '\n' + canonical(seq, e));
    if (Number(e.seq) !== seq || e.prevHash !== prev || e.hash !== want) {
      brk(seq, Number(e.seq) !== seq ? 'an entry is missing or out of order' : e.prevHash !== prev ? 'the link to the previous entry is broken' : 'the entry was changed after it was recorded');
      break;
    }
    prev = want; out.count = seq; out.head = want;
  }
  if (out.ok && (opts.head || opts.requireHead)) {
    const h = opts.head;
    if (!h || typeof h !== 'object') brk(entries.length, 'the file has no signed head, so missing entries at the end could not be ruled out');
    else if (!headSignatureOk(wsId, h)) brk(Number(h.count) || entries.length, 'the signature does not match, so the file was not exported from this workspace as it is now (its fingerprints were recomputed or its head was edited)');
    else if (Number(h.count) !== entries.length) brk(Math.min(Number(h.count), entries.length) + 1, `the signed head covers ${Number(h.count)} entries but the file has ${entries.length}, so entries ${Number(h.count) > entries.length ? 'were removed from the end' : 'were added'}`);
    else if (h.hash !== out.head) brk(entries.length, 'the last entry does not match the signed head');
    else out.signed = true;
  }
  for (const a of anchors || []) {
    if (!out.ok) break;
    if (Number(a.v) !== CHAIN_V) continue;                  /* recorded before actor names were hashed */
    const n = Number(a.n);
    if (!(n >= 1)) continue;
    if (opts.anchorsWithin && n > entries.length) continue;   /* a saved file predates later checkpoints; its own end is covered by the signed head */
    out.anchorsChecked++;
    const e = entries[n - 1];
    if (!e || e.hash !== a.hash) brk(n, !e ? `entries up to ${n} were recorded at the checkpoint of ${String(a.at || '').slice(0, 10)}, but only ${entries.length} remain` : `history up to entry ${n} no longer matches the checkpoint recorded ${String(a.at || '').slice(0, 10)}`);
  }
  out.summary = out.ok ? `Chain intact: ${out.count} entr${out.count === 1 ? 'y' : 'ies'} recomputed${out.signed ? ', signed head matches' : ''}${out.anchorsChecked ? `, ${out.anchorsChecked} recorded checkpoint${out.anchorsChecked === 1 ? '' : 's'} match` : ''}.`
    : `Chain broken at entry ${out.firstBreak.seq}: ${out.firstBreak.reason}.`;
  return out;
}
/* No spreadsheet formula injection: a value starting with = + - @ tab CR (or a quote, so the escape round-trips) gets a
   leading quote, which fromCSV removes again. */
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r']/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const CSV_COLS = ['seq', 'at', 'actor', 'actorName', 'action', 'ref', 'summary', 'prevHash', 'hash'];
const HEAD_ROW = '# Signed head', FILTERED_ROW = '# Filtered export';
function toCSV(entries, verify, head, keySource) {
  const lines = [CSV_COLS.join(',')].concat(entries.map(e => CSV_COLS.map(c => csvCell(e[c])).join(',')));
  lines.push('');
  lines.push(csvCell('# Verify: ' + verify.summary + ' Head ' + verify.head + '. Recomputed ' + verify.at + '.'));
  /* the footer row the in-app check reads: entry count, head fingerprint, signature, key source */
  if (head) lines.push([HEAD_ROW, head.count, head.hash, head.signature, keySource || keyLabel()].map(csvCell).join(','));
  else lines.push([FILTERED_ROW, entries.length, '', '', keySource || keyLabel()].map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}
/* RFC 4180 rows (quoted cells may hold commas, quotes and line breaks). */
function csvRows(text) {
  const rows = []; let row = [], cell = '', q = false, i = 0;
  const t = String(text || '').replace(/^\uFEFF/, '');
  while (i < t.length) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === '') { q = true; i++; continue; }
    if (c === ',') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r' || c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += (c === '\r' && t[i + 1] === '\n') ? 2 : 1; continue; }
    cell += c; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const uncell = s => (s.charAt(0) === "'" ? s.slice(1) : s);
/* A CSV export back into {entries, head, filtered, keySource}, or {error}. opts.seeded: the seq numbers of seeded demo
   history (the CSV has no column for it), so the derived labels match the JSON export. */
function fromCSV(text, opts) {
  const seededSeq = new Set(((opts && opts.seeded) || []).map(Number));
  const rows = csvRows(text);
  if (!rows.length || rows[0].join(',') !== CSV_COLS.join(',')) return { error: 'That file isn’t a PMOFlow history export (the first row should be ' + CSV_COLS.join(',') + ').' };
  const entries = []; let head = null, filtered = false, keySource = null, i = 1;
  for (; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0] === '') break;
    if (r.length !== CSV_COLS.length) return { error: `Row ${i + 1} has ${r.length} cells instead of ${CSV_COLS.length}, so the file was changed or cut.` };
    const e = {}; CSV_COLS.forEach((c, k) => { e[c] = uncell(r[k]); });
    e.seq = Number(e.seq);
    /* R14: the same derived labels as the JSON export (not columns, so files exported before R14 still parse) */
    const seeded = seededSeq.has(e.seq);
    const sp = summaryParts(e.summary, e.action, { seeded });
    e.written = sp.written; if (sp.note != null) e.note = sp.note;
    if (seeded) e.seeded = true;
    if (e.action === 'refused') e.refused = true;
    entries.push(e);
  }
  for (; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] === HEAD_ROW) { head = { count: Number(r[1]), hash: String(r[2] || ''), signature: String(r[3] || '') }; keySource = r[4] || null; }
    if (r[0] === FILTERED_ROW) { filtered = true; keySource = r[4] || null; }
  }
  return { entries, head, filtered, keySource };
}
function filterEntries(entries, q) {
  const person = q.person ? String(q.person) : '';
  const item = q.item ? String(q.item).toLowerCase() : '';
  const from = isDay(q.from) ? q.from : '', to = isDay(q.to) ? q.to : '';
  return entries.filter(e => (!person || e.actor === person) &&
    (!item || String(e.ref || '').toLowerCase().includes(item) || String(e.summary || '').toLowerCase().includes(item)) &&
    (!from || String(e.at).slice(0, 10) >= from) && (!to || String(e.at).slice(0, 10) <= to));
}
async function chainFor(store, ws, docs) {
  const evs = (await store.listEvents(ws, { limit: AUDIT_LIMIT })).slice().reverse();   /* oldest first */
  if (!docs) docs = (await store.getState(ws)).docs;
  const names = Object.fromEntries(((docs && docs.person) || []).map(d => [d.id, d.data.name]));
  return chainEvents(ws.id, evs, names);
}

/* ---------- persistence ---------- */
async function saveSettings(store, wsId, s) {
  const data = Object.assign({}, s.rest || {}, { id: SETTINGS_ID, roles: s.roles, invites: s.invites.slice(-MAX_INVITES), anchors: s.anchors.slice(-MAX_ANCHORS) });
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
/* R13 #1: the department list is the engine's (E.departments), the one list for the approver panel, Admin and invites */
function departmentsOf(docs) {
  const eng = engine();
  if (!eng || typeof eng.departments !== 'function') return [];
  try { return eng.departments(docs) || []; } catch (e) { return []; }
}
function view(docs, s) {
  const depts = departmentsOf(docs);
  const deptName = id => (depts.find(d => d.id === id) || {}).name || null;
  const settings = { id: s.id, roles: s.roles, anchors: s.anchors,
    invites: s.invites.map(i => Object.assign({}, i, { departmentId: i.departmentId || null, department: i.departmentId ? deptName(i.departmentId) : null })) };
  const bu = Object.fromEntries(((docs && docs.person) || []).map(d => [d.id, d.data && d.data.bu ? String(d.data.bu) : null]));
  return { settings, calendar: calendarOf(docs).doc, departments: depts, projects: projectSponsors(docs), pendingDepartments: pendingView(docs), pendingRoles: pendingRolesView(docs),
    people: effectiveRoles(docs).map(p => Object.assign(p, { department: bu[p.id] || null })),
    seats: seats(docs), roles: ROLES.map(r => ({ id: r, label: ROLE_LABEL[r], paid: PAID.includes(r) })) };
}

/* ---------- R14 (Jordan re-test 1): two-person, step-up department changes ---------- */
/* Moving a person between departments ('assign') and choosing a department's approvers ('approvers') give or take
   sign-off rights, so one Admin proposes and a second Admin confirms with the extra sign-in check. Until then nothing
   changes. The confirmer is never the proposer, nor a person the change moves or makes (or stops being) an approver.
   Proposals live in settings.pendingDept [{id, kind, op, by, at, affected, text}]. On confirmation the server stamps:
     person.buSince = server time (membership), department.approverSince[personId] = server time (each new approver),
   so the engine can ignore memberships and approver rights newer than a part already in flight. Entries without a
   since date predate R14 and count as old. Adding, renaming and removing a department stay one-Admin changes (they give
   nobody rights). R14 rules 1-2 (Rule #1, Karen): naming the FIRST approver(s) of a department that has none (also when
   adding it), and any change when no other Admin could confirm it (one-Admin workspace), apply at once, still stamped,
   so they count for new work only. Every sentence is server-written. */
const MAX_PENDING = 50;
const stepUpOf = (body, at) => {
  const su = body && isPlainObject(body.stepUp) ? body.stepUp : null;
  if (!su || typeof su.method !== 'string' || !su.method) return null;
  const t = typeof su.at === 'string' && isFinite(Date.parse(su.at)) && Math.abs(Date.parse(su.at) - Date.parse(at)) < 15 * 60000 ? new Date(Date.parse(su.at)).toISOString() : at;
  return { at: t, method: 'simulated-mfa' };
};
const pendingOf = docs => { const r = settingsOf(docs).rest; return Array.isArray(r.pendingDept) ? r.pendingDept.filter(isPlainObject) : []; };
function deptText(docs, op) {
  const eng = engine(); const ds = eng ? eng.departments(docs) : [];
  const d = ds.find(x => x.id === op.id) || null;
  const nm = id => personName(docs, id) || 'someone';
  if (op.kind === 'assign') {
    const p = ((docs.person || []).find(x => x.id === op.personId) || {}).data || {};
    const from = p.bu ? String(p.bu) : null, to = d ? d.name : null;
    return { verb: to ? `moving ${nm(op.personId)}${from ? ` from ${from}` : ''} to ${to}` : `taking ${nm(op.personId)} out of ${from || 'their department'}`,
      text: to ? `Move ${nm(op.personId)}${from ? ` from ${from}` : ''} to ${to}` : `Take ${nm(op.personId)} out of ${from || 'their department'}`,
      done: to ? `Moved ${nm(op.personId)}${from ? ` from ${from}` : ''} to ${to}` : `Took ${nm(op.personId)} out of ${from || 'their department'}`,
      withdraw: to ? `move ${nm(op.personId)}${from ? ` from ${from}` : ''} to ${to}` : `take ${nm(op.personId)} out of ${from || 'their department'}`, affected: [op.personId] };
  }
  const cur = d ? d.approvers : [], next = [...new Set((op.approvers || []).map(String))];
  const add = next.filter(x => !cur.includes(x)), rm = cur.filter(x => !next.includes(x));
  const parts = [add.length ? 'add ' + add.map(nm).join(', ') : '', rm.length ? 'remove ' + rm.map(nm).join(', ') : ''].filter(Boolean).join('; ') || 'no change';
  const dn = d ? d.name : 'the department';
  return { verb: `changing ${dn} approvers (${parts})`, text: `${dn} approvers: ${parts}`, done: `Changed ${dn} approvers (${parts})`, withdraw: `change ${dn} approvers (${parts})`, affected: add.concat(rm) };
}
/* Writes a department edit the engine returned, keeping every other settings field and each approver's since date. */
async function writeDeptEdit(store, wsId, docs, r, opts) {
  opts = opts || {};
  const now = opts.at || new Date().toISOString();
  const setDoc = settingsOf(docs).rest;
  const prev = Array.isArray(setDoc.departments) ? setDoc.departments : [];
  const departments = r.departments.map(d => {
    const old = prev.find(x => x && x.id === d.id) || {};
    const was = isPlainObject(old.approverSince) ? old.approverSince : {};
    const since = {};
    const eng = isPlainObject(d.approverSince) ? d.approverSince : {};   /* the engine's departmentEdit stamps new approvers too */
    (d.approvers || []).forEach(id => { if (was[id]) since[id] = was[id]; else if (opts.stampApprovers && !(old.approvers || []).includes(id)) since[id] = now; else if (eng[id]) since[id] = eng[id]; });
    const out = { id: d.id, name: d.name, approvers: d.approvers || [] };
    if (Object.keys(since).length) out.approverSince = since;
    return out;
  });
  const pend = opts.pending !== undefined ? opts.pending : pendingOf(docs);
  await store.putDoc(wsId, 'workspace', SETTINGS_ID, Object.assign({}, setDoc, { id: SETTINGS_ID, departments, pendingDept: pend.slice(-MAX_PENDING) }));
  const patch = async (type, list) => {
    for (const x of list || []) {
      const cur = ((docs[type] || []).find(d => d.id === x.id) || {}).data;
      if (!cur) continue;
      const data = Object.assign({}, cur, x, { id: x.id });
      if (type === 'person') { if (data.bu == null) delete data.bu; if (opts.stampMember && (cur.bu || null) !== (x.bu || null)) data.buSince = now; }
      await store.putDoc(wsId, type, x.id, data);
    }
  };
  await patch('person', r.people); await patch('process', r.processes); await patch('project', r.projects);
  return departments;
}
function pendingView(docs) {
  return pendingOf(docs).map(p => Object.assign({}, p, { byName: personName(docs, p.by), departmentId: p.op && p.op.id || null,
    note: null }));
}
async function handleDepartments({ method, wsId, ws, body, store, send, fail }) {
  if (method !== 'POST') { fail(405, 'method not allowed'); return; }
  const eng = engine();
  const op = isPlainObject(body.op) ? body.op : null;
  if (!eng || !op || typeof op.kind !== 'string') { fail(400, 'op is required'); return; }
  const actor = actorOf(body);
  const st = await store.getState(ws);
  const docs = st.docs;
  const role = roleOf(docs, actor);
  const nm = personName(docs, actor) || 'This person';
  if (op.kind === 'add' ? !(role === 'admin' || role === 'editor') : role !== 'admin') {
    const list = admins(docs).map(a => a.name);
    fail(403, op.kind === 'add' ? `${nm} can't add a department: only an Admin or an Editor can.` : `Only an Admin can change departments${list.length ? ` (Admins: ${list.join(', ')})` : ''}.`); return;
  }
  const at = new Date().toISOString();
  const propose = async (pop, docsNow, extraSent) => {
    const chk = eng.departmentEdit(docsNow, pop);
    if (!chk.ok) return { error: chk.error };
    const pend = pendingOf(docsNow);
    const clash = pend.find(p => p.kind === pop.kind && (pop.kind === 'assign' ? p.op.personId === pop.personId : p.op.id === pop.id));
    if (clash) return { conflict: `A change for ${pop.kind === 'assign' ? personName(docsNow, pop.personId) : 'this department'} is already waiting for a second Admin (${clash.text}). Confirm or cancel it first.` };
    const t = deptText(docsNow, pop);
    const entry = { id: 'dmv-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), kind: pop.kind, op: pop, by: actor, at, status: 'pending', affected: t.affected, text: t.text };
    const sd = settingsOf(docsNow).rest;
    await store.putDoc(wsId, 'workspace', SETTINGS_ID, Object.assign({}, sd, { id: SETTINGS_ID, pendingDept: pend.concat([entry]).slice(-MAX_PENDING) }));
    await store.appendEvent(wsId, { actor, action: 'departments', ref: 'workspace:settings', summary: `Proposed ${t.verb} (waits for a second Admin)`.slice(0, 300) });
    return { entry };
  };
  const fresh = async () => (await store.getState(ws)).docs;
  if (op.kind === 'assign' || op.kind === 'approvers') {
    const pop = { kind: op.kind, id: op.id == null ? null : String(op.id), personId: op.personId != null ? String(op.personId) : undefined, approvers: op.approvers };
    /* R14 rules 1-2 (Karen, Rule #1): applied at once, stamped (the engine counts it for new work only), when
       - it names the FIRST approver(s) of a department that has none, or
       - no other Admin could confirm it (a one-Admin workspace, or the only other Admin is the person it moves). */
    const t = deptText(docs, pop);
    const curD = (eng.departments(docs).find(d => d.id === pop.id) || {});
    const first = pop.kind === 'approvers' && !(curD.approvers || []).length && (pop.approvers || []).length > 0;
    const others = admins(docs).filter(a => a.id !== actor && !t.affected.includes(a.id));
    if (first || !others.length) {
      const er = eng.departmentEdit(docs, pop);
      if (!er.ok) { fail(400, er.error); return; }
      if (pendingOf(docs).some(p => p.kind === pop.kind && (pop.kind === 'assign' ? p.op.personId === pop.personId : p.op.id === pop.id))) { fail(409, 'A change for this is already waiting for a second Admin. Confirm or cancel it first.'); return; }
      await writeDeptEdit(store, wsId, docs, er, { at, stampMember: pop.kind === 'assign', stampApprovers: pop.kind === 'approvers' });
      const nms = (pop.approvers || []).map(id => personName(docs, id) || 'someone');
      const sentence = first ? `Named the first approver${nms.length === 1 ? '' : 's'} for ${curD.name || 'the department'}: ${nms.join(', ')} (applies to new work only)`
        : `${t.done} (${admins(docs).length <= 1 ? 'no second Admin in this workspace' : 'no other Admin can confirm it'}; applies to new work only)`;
      await store.appendEvent(wsId, { actor, action: 'departments', ref: 'workspace:settings', summary: sentence.slice(0, 300) });
      send(200, { ok: true, applied: true, pending: null, departments: eng.departments(await fresh()) });
      return;
    }
    const r = await propose({ kind: op.kind, id: op.id == null ? null : String(op.id), personId: op.personId != null ? String(op.personId) : undefined, approvers: op.approvers }, docs);
    if (r.error) { fail(400, r.error); return; }
    if (r.conflict) { fail(409, r.conflict); return; }
    const d2 = await fresh();
    send(200, { ok: true, applied: false, pending: pendingView(d2).find(p => p.id === r.entry.id), departments: eng.departments(d2) });
    return;
  }
  /* add / rename / remove: one Admin (add: an Admin or Editor); a new department's approvers wait for a second Admin */
  /* R14 rule 1: approvers named when adding a department are its first approvers: immediate, stamped */
  const ap = op.kind === 'add' && Array.isArray(op.approvers) ? [...new Set(op.approvers.map(String).filter(Boolean))] : [];
  const r = eng.departmentEdit(docs, op);
  if (!r.ok) { fail(400, r.error); return; }
  const prevDepts = eng.departments(docs);
  await writeDeptEdit(store, wsId, docs, r, { at, stampApprovers: op.kind === 'add' });
  const was = prevDepts.find(d => d.id === op.id), now = r.departments.find(d => d.id === op.id);
  const added = op.kind === 'add' ? r.departments.find(d => !prevDepts.some(p => p.id === d.id)) : null;
  const summary = op.kind === 'add' ? `Added the ${added ? added.name : 'new'} department`
    : op.kind === 'rename' ? `Renamed the ${was ? was.name : ''} department to ${now ? now.name : ''}`
    : op.kind === 'remove' ? `Removed the ${was ? was.name : ''} department` : 'Changed the departments';
  await store.appendEvent(wsId, { actor, action: 'departments', ref: 'workspace:settings', summary });
  if (added && ap.length) {
    const nms = ap.map(id => personName(docs, id) || 'someone');
    await store.appendEvent(wsId, { actor, action: 'departments', ref: 'workspace:settings',
      summary: `Named the first approver${nms.length === 1 ? '' : 's'} for ${added.name}: ${nms.join(', ')} (applies to new work only)`.slice(0, 300) });
  }
  send(200, { ok: true, applied: true, departments: eng.departments(await fresh()), pending: null });
}
async function decidePending({ wsId, ws, body, store, send, fail, pid, decision }) {
  const eng = engine();
  const actor = actorOf(body);
  const st = await store.getState(ws);
  const docs = st.docs;
  const pend = pendingOf(docs);
  const p = pend.find(x => x.id === pid);
  if (!p) { fail(404, 'That department change is no longer waiting (it was confirmed or cancelled).'); return; }
  if (roleOf(docs, actor) !== 'admin') { fail(403, `Only an Admin can ${decision === 'confirm' ? 'confirm' : 'cancel'} a department change.`); return; }
  const rest = pend.filter(x => x.id !== pid);
  const t = deptText(docs, p.op);
  if (decision === 'cancel') {
    await store.putDoc(wsId, 'workspace', SETTINGS_ID, Object.assign({}, settingsOf(docs).rest, { id: SETTINGS_ID, pendingDept: rest }));
    await store.appendEvent(wsId, { actor, action: 'departments', ref: 'workspace:settings',
      summary: (actor === p.by ? `Withdrew the proposal to ${t.withdraw}` : `Turned down ${personName(docs, p.by) || 'an Admin'}’s proposal to ${t.withdraw}`).slice(0, 300) });
    send(200, { ok: true, cancelled: true });
    return;
  }
  if (actor === p.by) { fail(403, `You proposed this change, so a second Admin confirms it${admins(docs).filter(a => a.id !== actor && !(p.affected || []).includes(a.id)).length ? `: ${admins(docs).filter(a => a.id !== actor && !(p.affected || []).includes(a.id)).map(a => a.name).join(' or ')}` : ''}.`); return; }
  if ((p.affected || []).includes(actor) || (t.affected || []).includes(actor)) { fail(403, `${personName(docs, actor)} is the person being moved or given approval rights here, so another Admin confirms their own change.`); return; }
  const at = new Date().toISOString();
  const su = stepUpOf(body, at);
  if (!su) { fail(403, 'Confirming a department change needs the extra sign-in check. Confirm again and complete the check.'); return; }
  const r = eng.departmentEdit(docs, p.op);
  if (!r.ok) { fail(409, `This change can’t be applied any more: ${r.error} Cancel it and propose it again.`); return; }
  await writeDeptEdit(store, wsId, docs, r, { at, pending: rest, stampMember: p.kind === 'assign', stampApprovers: p.kind === 'approvers' });
  await store.appendEvent(wsId, { actor, action: 'departments', ref: 'workspace:settings',
    summary: `${t.done} (proposed by ${personName(docs, p.by) || 'an Admin'}, confirmed by ${personName(docs, actor)} with the extra sign-in check)`.slice(0, 300) });
  const d2 = (await store.getState(ws)).docs;
  send(200, { ok: true, applied: true, departments: eng.departments(d2) });
}

/* ---------- R15 M4 #1 (Jordan R14 re-test 2): two-person, step-up role changes ---------- */
/* Proposals live in settings.pendingRoles [{id, kind:'role', personId, from, to, by, at, affected, text}]. On confirmation the
   server stamps settings.roleSince[personId] = server time. Who confirms: an Admin other than the proposer; the person
   whose role changes only when the change takes Admin away from them (they may agree to it), never when it gives them
   more rights. With nobody able to confirm (a one-Admin workspace), the change applies at once and History says so. */
const pendingRolesOf = docs => { const r = settingsOf(docs).rest; return Array.isArray(r.pendingRoles) ? r.pendingRoles.filter(isPlainObject) : []; };
function roleText(docs, pid, from, to) {
  const nm = personName(docs, pid) || 'someone';
  return { text: `Make ${nm} ${/^[AEIOU]/.test(ROLE_LABEL[to]) ? 'an' : 'a'} ${ROLE_LABEL[to]} (now ${ROLE_LABEL[from] || 'no role'})`,
    change: `${nm}'s role from ${ROLE_LABEL[from] || 'no role'} to ${ROLE_LABEL[to]}` };
}
function roleConfirmers(docs, p) {
  const losesAdmin = p.from === 'admin' && p.to !== 'admin';
  return admins(docs).map(a => a.id).filter(id => id !== p.by && (id !== p.personId || losesAdmin));
}
function pendingRolesView(docs) {
  return pendingRolesOf(docs).map(p => Object.assign({}, p, { byName: personName(docs, p.by), personName: personName(docs, p.personId), canConfirm: roleConfirmers(docs, p) }));
}
async function applyRole(store, wsId, docs, pid, role, at, pendingRoles) {
  const s = settingsOf(docs);
  const since = isPlainObject(s.rest.roleSince) ? Object.assign({}, s.rest.roleSince) : {};
  since[pid] = at;
  const data = await saveSettings(store, wsId, Object.assign({}, s, { roles: Object.assign({}, s.roles, { [pid]: role }),
    rest: Object.assign({}, s.rest, { roleSince: since, pendingRoles: (pendingRoles || []).slice(-MAX_PENDING) }) }));
  return Object.assign({}, docs, { workspace: [{ id: SETTINGS_ID, data }] });
}

/* ---------- sandbox creation (R11 §2) ---------- */
/* A returning visitor keeps their sandbox through the pmoflow_ws cookie (HttpOnly, SameSite=Lax, 30 days at most and never
   past the sandbox's own expiry), in addition to the client's localStorage. Limits per network (salted IP hash):
   10 new sandboxes per rolling 10 minutes, 50 per UTC day (pmoflow-store.createWorkspace). A returning visitor is never
   counted against them. The cookie travels only to /api/pmoflow. */
const WS_COOKIE = 'pmoflow_ws';
function readCookie(req, name) {
  const h = (req && req.headers) || {};
  const raw = String(h.cookie || h.Cookie || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
function wsCookie(req, id, maxAgeSec) {
  const h = (req && req.headers) || {};
  const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim().replace(/:\d+$/, '');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host);   /* plain-http dev server only */
  return `${WS_COOKIE}=${id}; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}; Path=/api/pmoflow; HttpOnly; SameSite=Lax${local ? '' : '; Secure'}`;
}
async function createSandbox({ body, req, store, send, clientIpHash, dayInput, clientToday }) {
  const life = (store.EXPIRY_DAYS || 30) * 86400;
  const back = readCookie(req, WS_COOKIE);
  if (back && WS_RE.test(back)) {
    const ws = await store.getWorkspace(back);
    if (ws && !ws.expired) {
      const left = life - (Date.now() - Date.parse(ws.createdAt)) / 1000;
      send(200, { id: ws.id, returning: true }, { 'Set-Cookie': wsCookie(req, ws.id, left) });
      return;
    }
  }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const seedDate = typeof clientToday === 'function' && typeof dayInput === 'function' ? clientToday(dayInput(req, body || {}), today) : today;
    const ws = await store.createWorkspace(clientIpHash(req), { seedDate });
    send(201, { id: ws.id }, { 'Set-Cookie': wsCookie(req, ws.id, life) });
  } catch (e) {
    if (e.status === 429) { send(429, { error: e.message }, e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : undefined); return;   /* one plain message, nothing else (R8 §8) */ }
    throw e;
  }
}

/* ---------- route handler ---------- */
async function handle({ method, seg, body, req, store, send, fail, clientIpHash, dayInput, clientToday }) {
  /* POST /workspaces (R11: owned here; index.js keeps its old handler as an unreachable fallback) */
  if (seg[0] === 'workspaces' && seg.length === 1) {
    if (method !== 'POST') { fail(405, 'method not allowed'); return true; }
    await createSandbox({ body, req, store, send, clientIpHash, dayInput, clientToday });
    return true;
  }
  /* Guard: the generic doc API must not write the settings doc directly (it would skip the Admin check). */
  if (seg[0] === 'ws' && seg[2] === 'doc' && seg[3] === 'workspace' && method !== 'GET') { fail(403, 'Workspace settings change only from Admin.'); return true; }
  /* R14 (Jordan): department changes are owned here (the index.js handler stays as an unreachable fallback) */
  if (seg[0] === 'ws' && seg.length === 3 && seg[2] === 'departments' && WS_RE.test(seg[1] || '')) {
    const ws = await store.getWorkspace(seg[1]);
    if (!ws || ws.expired) { fail(404, 'workspace not found or expired'); return true; }
    await handleDepartments({ method, wsId: seg[1], ws, body: body || {}, store, send, fail });
    return true;
  }
  /* R14: no one-click department move through the generic doc API, and nobody writes a membership date */
  if (seg[0] === 'ws' && seg.length === 5 && seg[2] === 'doc' && seg[3] === 'person' && method === 'PUT' && WS_RE.test(seg[1] || '') && body && isPlainObject(body.data)) {
    const ws = await store.getWorkspace(seg[1]);
    if (ws && !ws.expired) {
      const st = await store.getState(ws);
      const prev = ((st.docs.person || []).find(d => d.id === seg[4]) || {}).data || null;
      const nb = body.data.bu == null || body.data.bu === '' ? null : String(body.data.bu);
      if ((prev && (prev.bu || null) !== nb) || (prev ? (prev.buSince || null) !== (body.data.buSince || null) : body.data.buSince != null)) {
        fail(409, 'Move people between departments from Admin › Departments: one Admin proposes it and a second Admin confirms it.'); return true;
      }
    }
  }
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

  /* POST /workspaces/:ws/admin/departments/pending/:id/confirm|cancel   R14 (Jordan) */
  if (rest[0] === 'departments' && rest[1] === 'pending' && rest.length === 4) {
    if (method !== 'POST') { fail(405, 'method not allowed'); return true; }
    if (!ID_RE.test(rest[2] || '') || !['confirm', 'cancel'].includes(rest[3])) { fail(404, 'unknown route'); return true; }
    await decidePending({ wsId, ws, body, store, send, fail, pid: rest[2], decision: rest[3] });
    return true;
  }
  /* PUT /workspaces/:ws/admin/sponsor/:projectId {sponsor, actor}   R14 L4 #2 */
  if (rest[0] === 'sponsor') {
    if (rest.length !== 2 || method !== 'PUT') { fail(rest.length === 2 ? 405 : 404, rest.length === 2 ? 'method not allowed' : 'unknown route'); return true; }
    const pid = rest[1];
    if (!ID_RE.test(pid || '')) { fail(400, 'invalid project id'); return true; }
    const actor = actorOf(body);
    const st = await store.getState(ws);
    const pd = (st.docs.project || []).find(d => d.id === pid);
    if (!pd) { fail(404, 'That project was not found.'); return true; }
    const project = Object.assign({}, pd.data, { id: pid });
    const next = body.sponsor == null || body.sponsor === '' ? null : String(body.sponsor);
    if (next && (!ID_RE.test(next) || !personName(st.docs, next))) { fail(400, 'Pick a person from the directory as sponsor.'); return true; }
    if (next && next === project.owner && actor !== project.owner) { fail(400, sponsorError(st.docs, actor, project, next)); return true; }
    const denied = sponsorError(st.docs, actor, project, next);
    if (denied) { fail(403, denied); return true; }
    const before = projectSponsors(st.docs).find(p => p.id === pid) || {};
    if ((project.sponsor || null) === next) { send(200, { ok: true, project: before }); return true; }
    const data = Object.assign({}, pd.data, { sponsor: next, updatedAt: new Date().toISOString() });
    if (!next) delete data.sponsor;
    await store.putDoc(wsId, 'project', pid, data);
    const after = Object.assign({}, st.docs, { project: (st.docs.project || []).map(d => (d.id === pid ? { id: pid, data } : d)) });
    const row = projectSponsors(after).find(p => p.id === pid);
    const was = before.sponsor ? before.sponsorName : before.effectiveName ? `${before.effectiveName} (default)` : 'nobody';
    const now = row.sponsor ? row.sponsorName : row.effectiveName ? `${row.effectiveName} (default)` : 'nobody';
    /* server-written: the client's text is never the sentence */
    await store.appendEvent(wsId, { actor, action: 'sponsor', ref: `project:${pid}`, summary: `Set the sponsor of “${project.name || pid}”: ${was} → ${now}`.slice(0, 300) });
    send(200, { ok: true, project: row });
    return true;
  }

  /* audit */
  if (rest[0] === 'audit') {
    try { auditSecret(); } catch (e) { fail(e.status || 503, e.message); return true; }
    if (rest.length === 1) {
      if (method !== 'GET') { fail(405, 'method not allowed'); return true; }
      const st = await store.getState(ws);
      const s = settingsOf(st.docs);
      const chain = await chainFor(store, ws, st.docs);
      const head = headOf(wsId, chain);
      const verify = verifyChain(wsId, chain, s.anchors, { head });
      const entries = filterEntries(chain, q);
      const filtered = entries.length !== chain.length;
      const keySource = keyLabel();
      if (String(q.format || 'json') === 'csv') {
        send(200, toCSV(entries, verify, filtered ? null : head, keySource));
        return true;
      }
      send(200, { workspace: wsId, exportedAt: new Date().toISOString(), algorithm: 'SHA-256(prevHash + "\\n" + JSON[seq, at, actor, actorName, action, ref, summary])',
        genesis: genesis(wsId), total: chain.length, filtered, head: filtered ? null : head, verify, anchors: s.anchors, entries, limit: AUDIT_LIMIT, keySource });
      return true;
    }
    if (rest[1] === 'verify' && rest.length === 2) {
      if (method !== 'POST') { fail(405, 'method not allowed'); return true; }
      const filteredMsg = { verify: { ok: false, count: 0, signed: false, anchorsChecked: 0, firstBreak: null, summary: 'This export was filtered, so its chain has gaps. Export without filters to check it.' } };
      /* R12: a CSV export is checked the same way; its footer row carries the signed head */
      let entries = body.entries, head = isPlainObject(body.head) ? body.head : null, fileKey = null;
      if (typeof body.csv === 'string') {
        if (Buffer.byteLength(body.csv, 'utf8') > 4 * 1024 * 1024) { fail(413, 'That file is too large to be a PMOFlow history export.'); return true; }
        const parsed = fromCSV(body.csv);
        if (parsed.error) { send(200, { verify: { ok: false, count: 0, signed: false, anchorsChecked: 0, firstBreak: null, summary: parsed.error } }); return true; }
        if (parsed.filtered) { send(200, filteredMsg); return true; }
        entries = parsed.entries; head = parsed.head; fileKey = parsed.keySource;
      }
      if (!Array.isArray(entries) || entries.length > 5000) { fail(400, 'entries must be the array from a JSON export'); return true; }
      if (body.filtered === true) { send(200, filteredMsg); return true; }
      /* the saved file must carry its signed head; checkpoints come from the server, never from the file */
      const st = await store.getState(ws);
      const v = verifyChain(wsId, entries, settingsOf(st.docs).anchors, { head, requireHead: true, anchorsWithin: true });
      /* R13 (Jordan): one key-source sentence for both formats, from the key the signature was checked with (a label the
         file carries is not trusted). Empty when the check failed. */
      const keyNote = v.ok && v.signed ? `Signed with the ${keyLabel()}.` : '';
      send(200, { verify: Object.assign(v, { keySource: keyLabel(), fileKeySource: fileKey, keyNote, format: typeof body.csv === 'string' ? 'csv' : 'json' }) });
      return true;
    }
    if (rest[1] === 'anchor' && rest.length === 2) {
      if (method !== 'POST') { fail(405, 'method not allowed'); return true; }
      const st = await store.getState(ws);
      const actor = actorOf(body);
      const chain = await chainFor(store, ws, st.docs);
      const s = settingsOf(st.docs);
      const head = chain[chain.length - 1];
      if (head && !(s.anchors.length && s.anchors[s.anchors.length - 1].hash === head.hash)) {
        s.anchors.push({ n: head.seq, hash: head.hash, at: new Date().toISOString(), by: actor, v: CHAIN_V });
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

  /* R15 M4 #1 (Jordan R14 re-test 2): a role change is proposed by one Admin and confirmed by a second Admin with the
     extra sign-in check, like a department move. It applies at once only when no other Admin could confirm it (a
     one-Admin workspace), and History says so. Every sentence is server-written. */
  if (rest[0] === 'roles' && rest.length === 2 && method === 'PUT') {
    const pid = rest[1];
    if (!ID_RE.test(pid) || !(docs.person || []).some(d => d.id === pid)) { fail(404, 'Choose a person from the directory.'); return true; }
    const role = String(body.role || '');
    if (!ROLES.includes(role)) { fail(400, 'Role must be Admin, Editor, Approver or Viewer.'); return true; }
    const before = roleOf(docs, pid);
    if (before === role) { send(200, Object.assign(view(docs, s), { applied: true, unchanged: true, pendingRole: null })); return true; }
    if (before === 'admin' && role !== 'admin' && admins(docs).length <= 1) { fail(409, 'The workspace needs at least one Admin. Make someone else an Admin first.'); return true; }
    const pend = pendingRolesOf(docs);
    const clash = pend.find(p => p.personId === pid);
    if (clash) { fail(409, `A role change for ${personName(docs, pid)} is already waiting for a second Admin (${clash.text}). Confirm or cancel it first.`); return true; }
    const at = new Date().toISOString();
    const t = roleText(docs, pid, before, role);
    const entry = { id: 'rol-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), kind: 'role', personId: pid, from: before, to: role,
      by: actor, at, status: 'pending', affected: [pid], text: t.text };
    if (!roleConfirmers(docs, entry).length) {
      const after = await applyRole(store, wsId, docs, pid, role, at, pend);
      await log('person:' + pid, `Changed ${t.change} (${admins(docs).length <= 1 ? 'no second Admin in this workspace' : 'no other Admin can confirm it'})`.slice(0, 300));
      send(200, Object.assign(view(after, settingsOf(after)), { applied: true, pendingRole: null }));
      return true;
    }
    const data = await saveSettings(store, wsId, Object.assign({}, s, { rest: Object.assign({}, s.rest, { pendingRoles: pend.concat([entry]).slice(-MAX_PENDING) }) }));
    const after = Object.assign({}, docs, { workspace: [{ id: SETTINGS_ID, data }] });
    await log('person:' + pid, `Proposed changing ${t.change} (waits for a second Admin)`.slice(0, 300));
    send(200, Object.assign(view(after, settingsOf(after)), { applied: false, pendingRole: pendingRolesView(after).find(p => p.id === entry.id) }));
    return true;
  }
  /* POST /workspaces/:ws/admin/roles/pending/:id/confirm|cancel  {actor, stepUp}   R15 M4 #1 */
  if (rest[0] === 'roles' && rest[1] === 'pending' && rest.length === 4) {
    if (method !== 'POST') { fail(405, 'method not allowed'); return true; }
    if (!ID_RE.test(rest[2] || '') || !['confirm', 'cancel'].includes(rest[3])) { fail(404, 'unknown route'); return true; }
    const pend = pendingRolesOf(docs);
    const p = pend.find(x => x.id === rest[2]);
    if (!p) { fail(404, 'That role change is no longer waiting (it was confirmed or cancelled).'); return true; }
    const left = pend.filter(x => x.id !== p.id);
    const t = roleText(docs, p.personId, p.from, p.to);
    const byName = personName(docs, p.by) || 'an Admin';
    if (rest[3] === 'cancel') {
      const data = await saveSettings(store, wsId, Object.assign({}, s, { rest: Object.assign({}, s.rest, { pendingRoles: left }) }));
      const after = Object.assign({}, docs, { workspace: [{ id: SETTINGS_ID, data }] });
      await log('person:' + p.personId, (actor === p.by ? `Withdrew the proposal to change ${t.change}` : `Turned down ${byName}’s proposal to change ${t.change}`).slice(0, 300));
      send(200, Object.assign(view(after, settingsOf(after)), { cancelled: true }));
      return true;
    }
    const who = roleConfirmers(docs, p);
    if (actor === p.by) { fail(403, `You proposed this change, so a second Admin confirms it${who.length ? ': ' + who.map(id => personName(docs, id)).join(' or ') : ''}.`); return true; }
    if (!who.includes(actor)) { fail(403, `${personName(docs, actor) || 'This person'} is the person this change makes an Admin, so another Admin confirms it.`); return true; }
    const at = new Date().toISOString();
    if (!stepUpOf(body, at)) { fail(403, 'Confirming a role change needs the extra sign-in check. Confirm again and complete the check.'); return true; }
    const cur = roleOf(docs, p.personId);
    if (cur !== p.from) { fail(409, `${personName(docs, p.personId)}'s role changed since this was proposed (now ${ROLE_LABEL[cur]}). Cancel it and propose it again.`); return true; }
    if (cur === 'admin' && p.to !== 'admin' && admins(docs).length <= 1) { fail(409, 'The workspace needs at least one Admin. Make someone else an Admin first.'); return true; }
    const after = await applyRole(store, wsId, docs, p.personId, p.to, at, left);
    await log('person:' + p.personId, `Changed ${t.change} (proposed by ${byName}, confirmed by ${personName(docs, actor)} with the extra sign-in check)`.slice(0, 300));
    send(200, Object.assign(view(after, settingsOf(after)), { applied: true }));
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
      /* R13 #1: an invite may name a department from the workspace's list (optional) */
      const depId = body.departmentId == null || body.departmentId === '' ? null : String(body.departmentId);
      const dep = depId ? departmentsOf(docs).find(d => d.id === depId) : null;
      if (depId && !dep) { fail(400, 'Choose a department from the list, or leave it blank.'); return true; }
      const id = 'inv-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      s.invites.push({ id, email, role, departmentId: dep ? dep.id : null, by: actor, at: new Date().toISOString() });
      const data = await saveSettings(store, wsId, s);
      const after = Object.assign({}, docs, { workspace: [{ id: SETTINGS_ID, data }] });
      await log('workspace:' + wsId, `Invited ${email} as ${ROLE_LABEL[role]}${dep ? ' in ' + dep.name : ''} (no email sent in the demo)`);
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

module.exports = { sponsorError, projectSponsors, summaryParts, handle, readCookie, wsCookie, WS_COOKIE, signHead, headOf, auditKeySource, keyLabel, roleError, roleOf, settingsOf, effectiveRoles, seats, chainEvents, verifyChain, toCSV, fromCSV, csvRows, filterEntries, genesis, canonical, CHAIN_V,
  ROLES, ROLE_LABEL, defaultRole };
