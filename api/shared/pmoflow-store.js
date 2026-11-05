/* PMOFlow persistence — the adapter boundary. A tenant build swaps this file
   for SharePoint lists or SQL; the function and engine never touch storage directly.

   Design: copy-on-write over a deterministic seed.
     pmoflowws      PK 'ws',        RK wsId               {createdAt, seedDate, ipHash}
     pmoflowdocs    PK wsId,        RK '<type>~<docId>'   {type, docId, deleted, n, d0..d3}  (overrides + tombstones)
     pmoflowevents  PK wsId,        RK inverted-ts + rand {at, actor, action, ref, summary}   (newest first)
     pmoflowlimits  PK 'create-<YYYYMMDD>', RK ipHash     {count}
   State = seed(seedDate) overlaid with the workspace's override rows. Creating a
   workspace is one row write; reset deletes the overrides and re-dates the seed.
   Without EMCEE_STORAGE_CONNECTION an in-memory backend is used (dev only). */
const crypto = require('crypto');
const tables = require('./tables');
const { seed, DOC_TYPES } = require('./pmoflow-seed');

const T = { ws: 'pmoflowws', docs: 'pmoflowdocs', events: 'pmoflowevents', limits: 'pmoflowlimits' };
const EXPIRY_DAYS = 30;
const CREATES_PER_DAY = 5;
const CHUNK = 16000;            /* chars per string property (Table limit is 64 KiB of UTF-16) */
const APP = 'pmoflow';

/* ---------- Table REST backend (reuses tables.js; adds GET-by-key-free DELETE) ---------- */
function parseConn() {
  const cs = process.env.EMCEE_STORAGE_CONNECTION || '';
  const m = Object.fromEntries(cs.split(';').filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
  if (!m.AccountName || !m.AccountKey) return null;
  return { name: m.AccountName, key: m.AccountKey, host: `https://${m.AccountName}.table.core.windows.net` };
}
function signed(acct, resource, extra) {
  /* SharedKeyLite, identical to tables.js (which does not export its signer) */
  const date = new Date().toUTCString();
  const sig = crypto.createHmac('sha256', Buffer.from(acct.key, 'base64')).update(`${date}\n/${acct.name}/${resource}`, 'utf8').digest('base64');
  return Object.assign({ 'x-ms-date': date, 'x-ms-version': '2019-02-02', Authorization: `SharedKeyLite ${acct.name}:${sig}`,
    Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json' }, extra || {});
}
const q = s => String(s).replace(/'/g, "''");

const tableBackend = {
  async list(table, filter) { return (await tables.query(table, filter)) || []; },
  async upsert(table, entity) {
    if (!(await tables.upsert(table, entity))) throw Object.assign(new Error('storage write failed'), { status: 503 });
  },
  async del(table, pk, rk) {
    const acct = parseConn(); if (!acct) return false;
    const addr = `${table}(PartitionKey='${encodeURIComponent(pk)}',RowKey='${encodeURIComponent(rk)}')`;
    const r = await fetch(`${acct.host}/${addr}`, { method: 'DELETE', headers: signed(acct, addr, { 'If-Match': '*' }) });
    return r.status === 204 || r.status === 404;
  },
};

/* ---------- in-memory backend (no connection string) ---------- */
const mem = new Map();
function memMatch(e, filter) {
  /* supports the filters this file builds: clauses "<prop> eq '<v>'" joined by " and " */
  return filter.split(' and ').every(c => {
    const m = /^(\w+) eq '((?:[^']|'')*)'$/.exec(c.trim());
    return m && String(e[m[1]]) === m[2].replace(/''/g, "'");
  });
}
const memBackend = {
  async list(table, filter) { return [...(mem.get(table) || new Map()).values()].filter(e => memMatch(e, filter)).map(e => Object.assign({}, e)); },
  async upsert(table, entity) {
    if (!mem.has(table)) mem.set(table, new Map());
    mem.get(table).set(entity.PartitionKey + '\u0000' + entity.RowKey, Object.assign({ Timestamp: new Date().toISOString() }, entity));
  },
  async del(table, pk, rk) { const t = mem.get(table); if (t) t.delete(pk + '\u0000' + rk); return true; },
};
const db = () => (parseConn() ? tableBackend : memBackend);

/* ---------- helpers ---------- */
const today = () => new Date().toISOString().slice(0, 10);
const dayKey = d => d.toISOString().slice(0, 10).replace(/-/g, '');
function newWorkspaceId() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return [...crypto.randomBytes(20)].map(b => abc[b % 36]).join('');
}
function isExpired(createdAt, now) {
  const t = Date.parse(createdAt);
  if (!isFinite(t)) return true;
  return (now ? +now : Date.now()) - t > EXPIRY_DAYS * 86400000;
}
function packData(data) {
  const s = JSON.stringify(data);
  const out = { n: Math.ceil(s.length / CHUNK) || 1 };
  for (let i = 0; i < out.n; i++) out['d' + i] = s.slice(i * CHUNK, (i + 1) * CHUNK);
  return out;
}
function unpackData(e) {
  let s = ''; for (let i = 0; i < (e.n || 0); i++) s += e['d' + i] || '';
  try { return JSON.parse(s); } catch (x) { return null; }
}
const rowKey = (type, id) => `${type}~${id}`;
/* R6: the row key follows the event's own timestamp, so storage order and time order agree */
function invertedTs(at) {
  const t = Date.parse(at); const ms = isFinite(t) ? t : Date.now();
  return String(9999999999999 - ms).padStart(13, '0') + '-' + crypto.randomBytes(3).toString('hex');
}

/* ---------- API ---------- */
async function getWorkspace(wsId) {
  const rows = await db().list(T.ws, `PartitionKey eq 'ws' and RowKey eq '${q(wsId)}'`);
  const r = rows && rows[0];
  if (!r) return null;
  return { id: wsId, createdAt: r.createdAt, seedDate: r.seedDate || String(r.createdAt).slice(0, 10), expired: isExpired(r.createdAt) };
}

/* Throws {status: 429} when this IP hash has already created CREATES_PER_DAY workspaces today. */
async function createWorkspace(ipHash, opts) {
  opts = opts || {};
  const pk = 'create-' + dayKey(new Date());
  const rk = String(ipHash || 'unknown').slice(0, 64);
  const rows = await db().list(T.limits, `PartitionKey eq '${pk}' and RowKey eq '${q(rk)}'`);
  const count = (rows[0] && rows[0].count) || 0;
  if (count >= CREATES_PER_DAY) throw Object.assign(new Error('Workspace limit reached for today'), { status: 429 });
  await db().upsert(T.limits, { PartitionKey: pk, RowKey: rk, count: count + 1, app: APP });
  const id = opts.id || newWorkspaceId();
  const now = new Date().toISOString();
  /* R8 §2: the seed is dated with the visitor's own today (already validated by the caller), else the server's UTC date */
  const seedDate = validDay(opts.seedDate) || now.slice(0, 10);
  await db().upsert(T.ws, { PartitionKey: 'ws', RowKey: id, createdAt: now, seedDate, ipHash: rk, app: APP });
  return { id, createdAt: now, seedDate };
}

async function listOverrides(wsId) {
  return db().list(T.docs, `PartitionKey eq '${q(wsId)}'`);
}

const validDay = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && isFinite(Date.parse(d + 'T12:00:00Z')) &&
  new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d ? d : null);

/* ws: object from getWorkspace (or a wsId string). Returns {docs, people, today}; today is the caller's (client) date when given. */
async function getState(ws, clientDay) {
  if (typeof ws === 'string') ws = await getWorkspace(ws);
  const base = seed(ws.seedDate);
  const docs = base.docs;
  const rows = (await listOverrides(ws.id)).sort((a, b) => String(a.Timestamp || '').localeCompare(String(b.Timestamp || '')));
  for (const r of rows) {
    if (!DOC_TYPES.includes(r.type)) continue;
    const arr = docs[r.type];
    const i = arr.findIndex(d => d.id === r.docId);
    if (r.deleted) { if (i >= 0) arr.splice(i, 1); continue; }
    const data = unpackData(r); if (!data) continue;
    if (i >= 0) arr[i] = { id: r.docId, data }; else arr.push({ id: r.docId, data });
  }
  const people = docs.person.map(d => d.data);
  return { docs, people, today: validDay(clientDay) || today() };
}

async function putDoc(wsId, type, id, data) {
  await db().upsert(T.docs, Object.assign({ PartitionKey: wsId, RowKey: rowKey(type, id), type, docId: id, deleted: false, app: APP }, packData(data)));
  return data;
}

async function deleteDoc(wsId, type, id) {
  /* tombstone, so seeded docs stay deleted */
  await db().upsert(T.docs, { PartitionKey: wsId, RowKey: rowKey(type, id), type, docId: id, deleted: true, n: 0, app: APP });
  return true;
}

async function appendEvent(wsId, ev) {
  const e = { at: ev.at || new Date().toISOString(), actor: String(ev.actor || 'unknown').slice(0, 64), action: String(ev.action || 'update').slice(0, 32),
    ref: String(ev.ref || '').slice(0, 140), summary: String(ev.summary || '').slice(0, 300) };
  await db().upsert(T.events, Object.assign({ PartitionKey: wsId, RowKey: invertedTs(e.at), app: APP }, e));
  return e;
}

/* Newest first. Seeded history is synthesized from the seed so it is never empty. */
async function listEvents(ws, opts) {
  if (typeof ws === 'string') ws = await getWorkspace(ws);
  opts = opts || {};
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 100));
  let filter = `PartitionKey eq '${q(ws.id)}'`;
  if (opts.ref) filter += ` and ref eq '${q(opts.ref)}'`;
  const rows = await db().list(T.events, filter);
  /* newest first by event time; ties (same ms, independent writes) fall back to write order, newest first */
  const stored = rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : String(b.Timestamp || '').localeCompare(String(a.Timestamp || ''))))
    .map(r => ({ at: r.at, actor: r.actor, action: r.action, ref: r.ref, summary: r.summary }));
  const seeded = seed(ws.seedDate).events.filter(e => !opts.ref || e.ref === opts.ref);
  return stored.concat(seeded).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

async function resetWorkspace(ws, clientDay) {
  if (typeof ws === 'string') ws = await getWorkspace(ws);
  const b = db();
  const docs = await listOverrides(ws.id);
  const evs = await b.list(T.events, `PartitionKey eq '${q(ws.id)}'`);
  await Promise.all(docs.map(r => b.del(T.docs, r.PartitionKey, r.RowKey)).concat(evs.map(r => b.del(T.events, r.PartitionKey, r.RowKey))));
  const seedDate = validDay(clientDay) || today();
  const rows = await b.list(T.ws, `PartitionKey eq 'ws' and RowKey eq '${q(ws.id)}'`);
  const row = rows[0] || {};
  await b.upsert(T.ws, { PartitionKey: 'ws', RowKey: ws.id, createdAt: row.createdAt || ws.createdAt, seedDate, ipHash: row.ipHash || '', app: APP });
  return { id: ws.id, createdAt: row.createdAt || ws.createdAt, seedDate };
}

/* Removes the workspace row and all its overrides/events (used by tests and cleanup). */
async function deleteWorkspace(wsId, ipHash) {
  const b = db();
  await resetWorkspace({ id: wsId, createdAt: new Date().toISOString() });
  await b.del(T.ws, 'ws', wsId);
  if (ipHash) await b.del(T.limits, 'create-' + dayKey(new Date()), ipHash);
  return true;
}

module.exports = { getWorkspace, createWorkspace, getState, putDoc, deleteDoc, appendEvent, listEvents, resetWorkspace,
  deleteWorkspace, isExpired, EXPIRY_DAYS, CREATES_PER_DAY, TABLES: T, _backend: () => (parseConn() ? 'table' : 'memory') };
