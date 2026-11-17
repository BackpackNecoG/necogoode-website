/* POST /api/intent  — body: a signed intent (or {intent}). The HMAC signature is the authentication: an unsigned,
   expired, replayed or tampered intent is refused before anything else happens. */
'use strict';
const { createRelay } = require('../lib/relay');

const MAX_BODY = 256 * 1024;
let relay = null;

module.exports = async function (context, req) {
  relay = relay || createRelay({});
  const origin = relay.config.allowedOrigin;
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (origin && req.headers && req.headers.origin === origin) Object.assign(headers, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', vary: 'Origin' });
  if (String(req.method).toUpperCase() === 'OPTIONS') { context.res = { status: 204, headers }; return; }
  const raw = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || null);
  if (Buffer.byteLength(raw || '', 'utf8') > MAX_BODY) { context.res = { status: 413, headers, body: { ok: false, detail: 'too large' } }; return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const intent = body && body.intent ? body.intent : body;
  const r = await relay.handle(intent);
  /* one log line per intent, with no payload, secret or token */
  if (context.log) context.log(`[relay] ${intent && intent.op} ${intent && intent.tool} ${intent && intent.id} -> ${r.status}${r.body && r.body.refused ? ' refused' : ''}`);
  context.res = { status: r.status, headers, body: r.body };
};
