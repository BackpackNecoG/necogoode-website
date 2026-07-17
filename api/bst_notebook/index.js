/* /api/bst/notebook — the trainee's free-text notes (cheat cards ride inside
   the progress blob; notes save separately so a keystroke autosave never
   races the quiz engine's progress writes). */
const { upsert, query } = require('../shared/tables');
const bst = require('../shared/bst');

module.exports = async function (context, req) {
  const res = (status, body) => { context.res = { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body }; };
  const email = bst.sessionEmail(req.headers.cookie);
  if (!email) return res(401, {});
  try {
    if (req.method === 'GET') {
      const rows = await query('BstNotebook', `PartitionKey eq 'notebook' and RowKey eq '${email.replace(/'/g, '')}'`, 1);
      return res(200, { notes: (rows && rows[0] && rows[0].notes) || '' });
    }
    const notes = String((req.body && req.body.notes) || '').slice(0, 32000);
    await upsert('BstNotebook', { PartitionKey: 'notebook', RowKey: email, notes });
    return res(200, { ok: true });
  } catch (e) {
    context.log('[bst/notebook] ' + (e && e.message));
    return res(500, { error: 'server' });
  }
};
