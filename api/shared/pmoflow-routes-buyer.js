/* PMOFlow R10 · S3 buyer layer routes (loaded by api/pmoflow/index.js through the route-module hook).

     POST /api/pmoflow/buyer/demo-request   validated "Book a demo" form -> table pmoflowleads
     GET  /api/pmoflow/buyer/leads?key=...  founder's list (404 unless app setting PMOFLOW_ADMIN_KEY is set)

   Storage: the same Azure Table connection as pmoflow-store.js (EMCEE_STORAGE_CONNECTION through ./tables),
   with an in-memory fallback when no connection is configured (dev/test only).
     pmoflowleads   PK 'lead',            RK inverted-ts + rand   (newest first)  {at, name, email, company, ...}
     pmoflowlimits  PK 'lead-<YYYYMMDD>', RK ipHash               {count}         (10 requests per IP hash per day)
   Every entity carries app:'pmoflow'. Raw IPs are never stored (only the salted hash from index.js).
   No email is sent from the API in this round; the founder reads the leads list. */
const crypto = require('crypto');
const tables = require('./tables');

const APP = 'pmoflow';
const T = { leads: 'pmoflowleads', limits: 'pmoflowlimits' };
const PER_DAY = 10;
const TOOLS = ['Jira', 'Azure DevOps', 'ServiceNow', 'Planner/Project', 'Smartsheet', 'monday', 'Visio', 'Signavio', 'Other'];
const TEAM_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'];
const WINDOWS = ['morning', 'midday', 'afternoon', 'any'];
const INTERESTS = ['demo', 'pilot'];
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/* ---------- storage (table when configured, else memory) ---------- */
const mem = new Map();
const memKey = (t, pk, rk) => t + '\u0000' + pk + '\u0000' + rk;
const q = s => String(s).replace(/'/g, "''");
const backend = {
  async get(table, pk, rk) {
    if (tables.configured()) {
      const rows = await tables.query(table, `PartitionKey eq '${q(pk)}' and RowKey eq '${q(rk)}'`);
      return (rows && rows[0]) || null;
    }
    return mem.get(memKey(table, pk, rk)) || null;
  },
  async upsert(table, entity) {
    if (tables.configured()) {
      if (!(await tables.upsert(table, entity))) throw Object.assign(new Error('storage write failed'), { status: 503 });
      return;
    }
    mem.set(memKey(table, entity.PartitionKey, entity.RowKey), Object.assign({ Timestamp: new Date().toISOString() }, entity));
  },
  async list(table, pk) {
    if (tables.configured()) return (await tables.query(table, `PartitionKey eq '${q(pk)}'`)) || [];
    return [...mem.entries()].filter(([k]) => k.startsWith(table + '\u0000' + pk + '\u0000')).map(([, v]) => Object.assign({}, v));
  },
};

/* ---------- validation ---------- */
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/\s+/g, ' ');

/* Returns { lead } or { errors: {field: message} }. today = 'YYYY-MM-DD' (server UTC). */
function validate(body, today) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {};
  const name = oneLine(b.name, 100);
  const email = oneLine(b.email, 200).toLowerCase();
  const company = oneLine(b.company, 120);
  const role = oneLine(b.role, 100);
  const teamSize = oneLine(b.teamSize, 20);
  const fix = clean(b.fix, 2000);
  const timesNote = clean(b.timesNote, 300);
  const preferredDate = oneLine(b.preferredDate, 10);
  const preferredWindow = oneLine(b.preferredWindow, 20) || 'any';
  const timezone = oneLine(b.timezone, 64);
  const interest = oneLine(b.interest, 10) || 'demo';
  const plan = oneLine(b.plan, 20);
  const rawTools = Array.isArray(b.tools) ? b.tools : (b.tools ? [b.tools] : []);
  const tools = [...new Set(rawTools.map(t => oneLine(t, 40)))];
  const toolsOther = oneLine(b.toolsOther, 100);

  if (name.length < 2) errors.name = 'Please enter your name.';
  if (!EMAIL_RE.test(email)) errors.email = 'Please enter a valid work email.';
  if (company.length < 2) errors.company = 'Please enter your company.';
  if (role.length < 2) errors.role = 'Please enter your role.';
  if (!TEAM_SIZES.includes(teamSize)) errors.teamSize = 'Please choose a team size.';
  if (tools.some(t => !TOOLS.includes(t))) errors.tools = 'Please choose tools from the list.';
  if (fix.length < 5) errors.fix = 'Please tell us briefly what you want to fix.';
  if (!WINDOWS.includes(preferredWindow)) errors.preferredWindow = 'Please choose a time of day.';
  if (!INTERESTS.includes(interest)) errors.interest = 'Unknown request type.';
  if (preferredDate) {
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(preferredDate) && isFinite(Date.parse(preferredDate + 'T12:00:00Z')) &&
      new Date(preferredDate + 'T12:00:00Z').toISOString().slice(0, 10) === preferredDate;
    const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
    const limit = new Date(Date.parse(today + 'T12:00:00Z') + 180 * 86400000).toISOString().slice(0, 10);
    if (!ok || preferredDate < yesterday || preferredDate > limit) errors.preferredDate = 'Please choose a date in the next six months.';
  }
  if (Object.keys(errors).length) return { errors };
  return { lead: { name, email, company, role, teamSize, tools: tools.join(', '), toolsOther, fix, preferredDate, preferredWindow, timezone, timesNote, interest, plan, test: b.test === true } };
}

/* ---------- helpers ---------- */
const dayKey = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
function invertedTs(ms) { return String(9999999999999 - ms).padStart(13, '0') + '-' + crypto.randomBytes(3).toString('hex'); }
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function queryParam(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  try { return new URL(String(req.url || ''), 'http://x').searchParams.get(name); } catch (e) { return null; }
}
const LEAD_FIELDS = ['at', 'name', 'email', 'company', 'role', 'teamSize', 'tools', 'toolsOther', 'fix', 'preferredDate', 'preferredWindow', 'timezone', 'timesNote', 'interest', 'plan', 'test'];

/* ---------- route handler ---------- */
async function handle({ method, seg, body, req, send, fail, clientIpHash }) {
  if (seg[0] !== 'buyer') return false;

  if (seg[1] === 'demo-request' && seg.length === 2) {
    if (method !== 'POST') { fail(405, 'method not allowed'); return true; }
    const b = body && typeof body === 'object' ? body : {};
    /* honeypot: bots fill the hidden "website" field; answer as if it worked and store nothing */
    if (clean(b.website, 200)) { send(201, { ok: true }); return true; }
    const today = new Date().toISOString().slice(0, 10);
    const v = validate(b, today);
    if (v.errors) { send(400, { error: 'Please check the highlighted fields.', fields: v.errors }); return true; }

    const ipHash = String(clientIpHash(req) || 'unknown').slice(0, 64);
    const pk = 'lead-' + dayKey();
    const row = await backend.get(T.limits, pk, ipHash);
    const count = (row && Number(row.count)) || 0;
    if (count >= PER_DAY) { send(429, { error: 'We have already received several requests from your network today. Please try again tomorrow.' }); return true; }
    await backend.upsert(T.limits, { PartitionKey: pk, RowKey: ipHash, count: count + 1, app: APP });

    const now = Date.now();
    const id = invertedTs(now);
    await backend.upsert(T.leads, Object.assign({ PartitionKey: 'lead', RowKey: id, app: APP, at: new Date(now).toISOString() }, v.lead));
    send(201, { ok: true, id });
    return true;
  }

  if (seg[1] === 'leads' && seg.length === 2) {
    const adminKey = process.env.PMOFLOW_ADMIN_KEY;
    if (!adminKey) { fail(404, 'unknown route'); return true; }
    if (method !== 'GET') { fail(405, 'method not allowed'); return true; }
    const key = queryParam(req, 'key');
    if (!key || !safeEqual(key, adminKey)) { fail(403, 'forbidden'); return true; }
    const includeTest = queryParam(req, 'test') === '1';
    const rows = (await backend.list(T.leads, 'lead'))
      .filter(r => r.app === APP && (includeTest || r.test !== true))
      .sort((a, b) => String(a.RowKey).localeCompare(String(b.RowKey)))
      .map(r => Object.assign({ id: r.RowKey }, Object.fromEntries(LEAD_FIELDS.map(f => [f, r[f] == null ? '' : r[f]]))));
    send(200, { count: rows.length, leads: rows });
    return true;
  }

  fail(404, 'unknown route');
  return true;
}

module.exports = { handle, validate, TOOLS, TEAM_SIZES, WINDOWS, PER_DAY, TABLES: T, _mem: mem };
