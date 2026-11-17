/* Minimal HTTP client on Node built-ins. request({method, url, headers, body, contentType}) -> {status, headers, body}.
   body objects are sent as JSON (or contentType, e.g. application/json-patch+json); responses are parsed as JSON when they look like JSON.
   A transport can be injected (tests): transport({method, url, headers, body: string|undefined}) -> Promise<{status, headers, text}>. */
'use strict';
const https = require('https');
const http = require('http');

const TIMEOUT_MS = 20000;
const MAX_BYTES = 8 * 1024 * 1024;

function nodeTransport({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    /* plain http is only allowed for the local managed-identity endpoint */
    const lib = u.protocol === 'https:' ? https : (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || /^169\.254\./.test(u.hostname)) ? http : null;
    if (!lib) return reject(new Error('refusing a non-HTTPS request'));
    const req = lib.request(u, { method, headers, timeout: TIMEOUT_MS }, res => {
      const chunks = []; let n = 0;
      res.on('data', c => { n += c.length; if (n > MAX_BYTES) { req.destroy(new Error('response too large')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function createHttp(transport) {
  const t = transport || nodeTransport;
  return {
    async request({ method, url, headers, body, contentType }) {
      const h = Object.assign({ Accept: 'application/json' }, headers || {});
      let payload;
      if (body !== undefined) {
        payload = typeof body === 'string' ? body : JSON.stringify(body);
        if (!h['Content-Type']) h['Content-Type'] = contentType || 'application/json';
        h['Content-Length'] = Buffer.byteLength(payload);
      }
      const r = await t({ method: method || 'GET', url, headers: h, body: payload });
      let parsed = r.text;
      if (typeof r.text === 'string' && /^\s*[[{]/.test(r.text)) { try { parsed = JSON.parse(r.text); } catch (e) { parsed = r.text; } }
      return { status: r.status, headers: r.headers || {}, body: parsed };
    },
  };
}

/* A short, token-free description of an HTTP failure for logs and results. */
function failure(service, r) {
  const b = r && r.body;
  let msg = '';
  if (b && typeof b === 'object') msg = [].concat(b.errorMessages || [], Object.values(b.errors || {}), b.message || [], (b.error && (b.error.message || b.error.code)) || []).filter(Boolean).join('; ');
  else if (typeof b === 'string') msg = b.replace(/\s+/g, ' ');
  return `${service} answered ${r ? r.status : 'nothing'}${msg ? ': ' + String(msg).slice(0, 200) : ''}`;
}

module.exports = { createHttp, nodeTransport, failure };
