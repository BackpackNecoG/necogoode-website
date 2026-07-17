/* /api/bst/progress — the trainee's whole training state, one JSON blob per
   user in BstProgress (PK 'progress', RK email). GET also merges in the
   notebook notes so the studio boots with one call. */
const { upsert, query } = require('../shared/tables');
const bst = require('../shared/bst');

module.exports = async function (context, req) {
  const res = (status, body) => { context.res = { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body }; };
  const email = bst.sessionEmail(req.headers.cookie);
  if (!email) return res(401, {});
  const safeEmail = email.replace(/'/g, '');
  try {
    if (req.method === 'GET') {
      const rows = await query('BstProgress', `PartitionKey eq 'progress' and RowKey eq '${safeEmail}'`, 1);
      let out = {};
      if (rows && rows[0] && rows[0].data) { try { out = JSON.parse(rows[0].data); } catch (e) {} }
      const nb = await query('BstNotebook', `PartitionKey eq 'notebook' and RowKey eq '${safeEmail}'`, 1);
      if (nb && nb[0] && nb[0].notes) out.notes = nb[0].notes;
      return res(200, out);
    }
    /* POST — save. Hard-cap the blob so a runaway client can't blow the row. */
    const data = JSON.stringify(req.body || {});
    if (data.length > 58000) {
      /* trim oldest feedback entries first, then save */
      const p = req.body || {};
      p.feedback = (p.feedback || []).slice(-30);
      return upsert('BstProgress', { PartitionKey: 'progress', RowKey: email, data: JSON.stringify(p).slice(0, 58000) })
        .then(() => res(200, { ok: true, trimmed: true }));
    }
    await upsert('BstProgress', { PartitionKey: 'progress', RowKey: email, data });
    return res(200, { ok: true });
  } catch (e) {
    context.log('[bst/progress] ' + (e && e.message));
    return res(500, { error: 'server' });
  }
};
