/* Signed sync intents: verification and replay protection.
   An intent is HMAC-SHA256-signed (hex, field `sig`) over canonical JSON of every other field, with the
   per-project secret version named by `kid`. It carries a nonce and expires 5 minutes after `iat`.
   A nonce is accepted once: the nonce store must refuse a second use. */
'use strict';
const crypto = require('crypto');
const { canonical } = require('./pmoflow-sync');

const VERSION = 1;
const TTL_MS = 5 * 60 * 1000;
const SKEW_MS = 30 * 1000;
const OPS = ['create', 'update', 'link', 'pull', 'notify'];

function signingString(intent) { const c = Object.assign({}, intent); delete c.sig; return canonical(c); }
function sign(intent, secret) {
  return Object.assign({}, intent, { sig: crypto.createHmac('sha256', secret).update(signingString(intent), 'utf8').digest('hex') });
}

/* getSecret(projectId, kid) -> Promise<Buffer|string|null>; nonces.claim(nonce, expMs) -> Promise<boolean> (false = already used).
   Returns {ok:true} or {ok:false, status, reason}. Checks run cheapest-first; the nonce is claimed only after the signature is valid. */
async function verify(intent, { getSecret, nonces, now }) {
  const t = now == null ? Date.now() : now;
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return { ok: false, status: 400, reason: 'intent must be an object' };
  if (intent.v !== VERSION) return { ok: false, status: 400, reason: 'unknown intent version' };
  if (!OPS.includes(intent.op)) return { ok: false, status: 400, reason: 'unknown operation' };
  if (typeof intent.nonce !== 'string' || !/^[\w-]{8,64}$/.test(intent.nonce)) return { ok: false, status: 400, reason: 'bad nonce' };
  if (typeof intent.projectId !== 'string' || !/^[\w.-]{1,64}$/.test(intent.projectId)) return { ok: false, status: 400, reason: 'bad project id' };
  if (!Number.isInteger(intent.kid) || intent.kid < 1 || intent.kid > 100000) return { ok: false, status: 400, reason: 'bad key id' };
  if (typeof intent.sig !== 'string' || !/^[0-9a-f]{64}$/.test(intent.sig)) return { ok: false, status: 401, reason: 'missing signature' };
  const iat = Date.parse(intent.iat), exp = Date.parse(intent.exp);
  if (!isFinite(iat) || !isFinite(exp) || exp <= iat || exp - iat > TTL_MS) return { ok: false, status: 401, reason: 'bad time window' };
  if (iat > t + SKEW_MS) return { ok: false, status: 401, reason: 'issued in the future' };
  if (t > exp) return { ok: false, status: 401, reason: 'expired' };
  const secret = await getSecret(intent.projectId, intent.kid);
  if (!secret) return { ok: false, status: 401, reason: 'unknown or retired key' };
  const want = crypto.createHmac('sha256', secret).update(signingString(intent), 'utf8').digest();
  const got = Buffer.from(intent.sig, 'hex');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return { ok: false, status: 401, reason: 'signature mismatch' };
  if (!(await nonces.claim(intent.nonce, exp + SKEW_MS))) return { ok: false, status: 409, reason: 'replay refused' };
  return { ok: true };
}

/* Single-process nonce store (local runs and tests). Production uses TableNonceStore (shared by every instance). */
class MemoryNonceStore {
  constructor() { this.seen = new Map(); }
  async claim(nonce, untilMs) {
    const now = Date.now();
    if (this.seen.size > 10000) for (const [k, v] of this.seen) if (v < now) this.seen.delete(k);
    const prev = this.seen.get(nonce);
    if (prev != null && prev >= now) return false;
    this.seen.set(nonce, untilMs);
    return true;
  }
}

/* Azure Table Storage nonce store. Insert is atomic: a second insert of the same RowKey returns 409, which is a replay.
   Uses the function's managed identity (role: Storage Table Data Contributor). Rows are partitioned by UTC day. */
class TableNonceStore {
  constructor({ http, tokens, accountUrl, table }) { Object.assign(this, { http, tokens, accountUrl: accountUrl.replace(/\/+$/, ''), table }); }
  async claim(nonce, untilMs) {
    const token = await this.tokens.get('https://storage.azure.com/');
    const r = await this.http.request({ method: 'POST', url: `${this.accountUrl}/${this.table}`,
      headers: { Authorization: 'Bearer ' + token, 'x-ms-version': '2020-12-06', 'x-ms-date': new Date().toUTCString(), Accept: 'application/json;odata=nometadata',
        'Content-Type': 'application/json', Prefer: 'return-no-content' },
      body: { PartitionKey: new Date().toISOString().slice(0, 10), RowKey: nonce, until: new Date(untilMs).toISOString() } });
    if (r.status === 201 || r.status === 204) return true;
    if (r.status === 409) return false;
    throw Object.assign(new Error('nonce store unavailable (' + r.status + ')'), { status: 503 });
  }
}

module.exports = { VERSION, TTL_MS, SKEW_MS, OPS, signingString, sign, verify, MemoryNonceStore, TableNonceStore };
