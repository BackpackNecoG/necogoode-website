/* /api/bst/login — magic-link sign-in for Byte Sized Training trainees.
   POST {email} → if the trainee is allowed, mint a one-time token (15 min),
   store it in BstTokens, and email the link via Azure Communication Services
   (same EMCEE_ACS_CONNECTION / EMCEE_ACS_SENDER settings the boss login uses;
   BST_ACS_* override if you ever want a separate sender).
   GET ?token= → validate, burn, set the bst_session cookie, 302 to the studio.
   BST_DEV_LOGIN=1 (or EMCEE_DEV_LOGIN=1) returns the link in the POST response
   for pre-email testing. */
const crypto = require('crypto');
const { insert, upsert, query } = require('../shared/tables');
const bst = require('../shared/bst');

async function sendAcsEmail(to, link) {
  const cs = process.env.BST_ACS_CONNECTION || process.env.EMCEE_ACS_CONNECTION || '';
  const sender = process.env.BST_ACS_SENDER || process.env.EMCEE_ACS_SENDER || '';
  const m = Object.fromEntries(cs.split(';').filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
  if (!m.endpoint || !m.accesskey || !sender) return false;
  const endpoint = m.endpoint.replace(/\/$/, '');
  const host = endpoint.replace('https://', '');
  const pathAndQuery = '/emails:send?api-version=2023-03-31';
  const body = JSON.stringify({
    senderAddress: sender,
    recipients: { to: [{ address: to }] },
    content: {
      subject: 'Your Byte Sized Training studio pass',
      plainText: 'Mr. Bryte here — the studio lights are on.\n\nYour sign-in link (good for 15 minutes):\n\n' + link +
        '\n\nIf you did not request this, ignore it; nothing happens without the click.',
      html: '<p>Mr. Bryte here — the studio lights are on.</p>' +
        '<p><a href="' + link + '">Enter the studio</a> (link is good for 15 minutes).</p>' +
        '<p style="color:#888">If you did not request this, ignore it — nothing happens without the click.</p>'
    }
  });
  const date = new Date().toUTCString();
  const contentHash = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
  const toSign = `POST\n${pathAndQuery}\n${date};${host};${contentHash}`;
  const sig = crypto.createHmac('sha256', Buffer.from(m.accesskey, 'base64')).update(toSign, 'utf8').digest('base64');
  const r = await fetch(endpoint + pathAndQuery, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'x-ms-date': date, 'x-ms-content-sha256': contentHash,
      'Authorization': `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${sig}`
    }, body
  });
  return r.status === 202;
}

module.exports = async function (context, req) {
  const res = (status, body, extra) => { context.res = Object.assign({ status, headers: { 'content-type': 'application/json' }, body }, extra || {}); };
  try {
    const origin = process.env.BST_PUBLIC_ORIGIN || process.env.EMCEE_PUBLIC_ORIGIN ||
      ('https://' + (req.headers['x-forwarded-host'] || req.headers.host));

    /* ── GET ?token= — complete the link ─────────────────────────────── */
    if (req.method === 'GET') {
      const token = String((req.query && req.query.token) || '').trim();
      if (!token) return res(400, { error: 'missing token' });
      const rows = await query('BstTokens', `PartitionKey eq 'token' and RowKey eq '${token.replace(/'/g, '')}'`, 1);
      const t = rows && rows[0];
      if (!t || t.used || Number(t.exp) < Date.now()) {
        return res(200, '<html><body style="font-family:sans-serif;background:#0B1220;color:#EDE6D6;display:flex;align-items:center;justify-content:center;height:100vh"><div>That link has expired or was already used. <a style="color:#38e8ff" href="' + bst.APP_PATH + '">Request a fresh one</a>.</div></body></html>',
          { headers: { 'content-type': 'text/html' } });
      }
      await upsert('BstTokens', { PartitionKey: 'token', RowKey: t.RowKey, email: t.email, exp: t.exp, used: true });
      await upsert('BstUsers', { PartitionKey: 'user', RowKey: t.email, lastLogin: new Date().toISOString() });
      const session = bst.makeSession(t.email, 30);
      return res(302, null, { headers: { 'Location': origin + bst.APP_PATH, 'Set-Cookie': bst.cookieHeaderFor(session) } });
    }

    /* ── POST {email} — request a link ───────────────────────────────── */
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!email || !email.includes('@') || email.length > 200) return res(400, { error: 'bad email' });

    let allowed = bst.allowedByEnv(email);
    if (!allowed) {
      const rows = await query('BstUsers', `PartitionKey eq 'user' and RowKey eq '${email.replace(/'/g, '')}'`, 1);
      allowed = !!(rows && rows[0]);
    }
    if (!allowed) return res(200, { unknown: true });

    const token = crypto.randomBytes(24).toString('base64url');
    await insert('BstTokens', { PartitionKey: 'token', RowKey: token, email, exp: Date.now() + 15 * 60000, used: false });
    const link = origin + '/api/bst/login?token=' + token;

    if (process.env.BST_DEV_LOGIN === '1' || process.env.EMCEE_DEV_LOGIN === '1') return res(200, { devLink: link });
    const sent = await sendAcsEmail(email, link);
    return res(200, sent ? { sent: true } : { error: 'email-not-configured' });
  } catch (e) {
    context.log('[bst/login] ' + (e && e.message));
    return res(500, { error: 'server' });
  }
};
