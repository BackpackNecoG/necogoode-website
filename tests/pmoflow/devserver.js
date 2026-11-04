/* Local dev server: static site + /api/pmoflow via the real Function handler.
   Usage: PMOFLOW_STORAGE_FILE=~/.pmoflow-storage.conn node tests/pmoflow/devserver.js [port]
   Mirrors the SWA routes: /concepts/pmoflow/app/* served as files, other /concepts/pmoflow/* -> index.html. */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../../web/public');
const FN = path.join(__dirname, '../../api/pmoflow/index.js');
const port = Number(process.argv[2] || 8790);
if (process.env.PMOFLOW_STORAGE_FILE && !process.env.EMCEE_STORAGE_CONNECTION)
  process.env.EMCEE_STORAGE_CONNECTION = fs.readFileSync(process.env.PMOFLOW_STORAGE_FILE.replace(/^~/, process.env.HOME), 'utf8').trim();
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/pmoflow')) {
    let raw = ''; for await (const c of req) raw += c;
    let body = undefined; try { body = raw ? JSON.parse(raw) : undefined; } catch (e) { body = raw; }
    Object.keys(require.cache).filter(k => k.includes('/api/')).forEach(k => delete require.cache[k]); /* hot reload */
    const ctx = { res: null, log: Object.assign((...a) => console.log(...a), { error: console.error, warn: console.warn, info: console.log }) };
    const r = { method: req.method, url: req.url, headers: Object.assign({ 'x-forwarded-for': '127.0.0.1' }, req.headers), query: Object.fromEntries(u.searchParams), body, rawBody: raw, params: { path: u.pathname.replace(/^\/api\/pmoflow\/?/, '') } };
    try { await require(FN)(ctx, r); } catch (e) { console.error(e); ctx.res = { status: 500, body: { error: e.message } }; }
    const out = ctx.res || { status: 204 };
    res.writeHead(out.status || 200, Object.assign({ 'content-type': 'application/json' }, out.headers || {}));
    return res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body == null ? null : out.body));
  }
  let p = u.pathname;
  if (p.startsWith('/concepts/pmoflow') && !p.startsWith('/concepts/pmoflow/app/')) p = '/concepts/pmoflow/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('pmoflow dev server on http://localhost:' + port + '/concepts/pmoflow/'));
