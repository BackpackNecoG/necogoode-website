/* Azure Table Storage over raw REST with SharedKeyLite signing — zero deps.
   Connection string from EMCEE_STORAGE_CONNECTION. All functions no-op
   gracefully when it's absent (the site must never depend on the database). */
const crypto = require('crypto');

function parseConn() {
  const cs = process.env.EMCEE_STORAGE_CONNECTION || '';
  const m = Object.fromEntries(cs.split(';').filter(Boolean).map(p => {
    const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)];
  }));
  if (!m.AccountName || !m.AccountKey) return null;
  return { name: m.AccountName, key: m.AccountKey, host: `https://${m.AccountName}.table.core.windows.net` };
}

function headers(acct, resource) {
  const date = new Date().toUTCString();
  const toSign = `${date}\n/${acct.name}/${resource}`;
  const sig = crypto.createHmac('sha256', Buffer.from(acct.key, 'base64')).update(toSign, 'utf8').digest('base64');
  return {
    'x-ms-date': date,
    'x-ms-version': '2019-02-02',
    'Authorization': `SharedKeyLite ${acct.name}:${sig}`,
    'Accept': 'application/json;odata=nometadata',
    'Content-Type': 'application/json'
  };
}

async function createTable(acct, table) {
  await fetch(`${acct.host}/Tables`, {
    method: 'POST', headers: headers(acct, 'Tables'), body: JSON.stringify({ TableName: table })
  }).catch(() => {});
}

async function insert(table, entity) {
  const acct = parseConn(); if (!acct) return false;
  let r = await fetch(`${acct.host}/${table}`, {
    method: 'POST', headers: headers(acct, table), body: JSON.stringify(entity)
  });
  if (r.status === 404) { /* first ever write: create the table, retry once */
    await createTable(acct, table);
    r = await fetch(`${acct.host}/${table}`, {
      method: 'POST', headers: headers(acct, table), body: JSON.stringify(entity)
    });
  }
  return r.status === 201 || r.status === 204;
}

async function upsert(table, entity) {
  const acct = parseConn(); if (!acct) return false;
  const addr = `${table}(PartitionKey='${encodeURIComponent(entity.PartitionKey)}',RowKey='${encodeURIComponent(entity.RowKey)}')`;
  let r = await fetch(`${acct.host}/${addr}`, {
    method: 'PUT', headers: headers(acct, addr), body: JSON.stringify(entity)
  });
  if (r.status === 404) { await createTable(acct, table);
    r = await fetch(`${acct.host}/${addr}`, { method: 'PUT', headers: headers(acct, addr), body: JSON.stringify(entity) });
  }
  return r.status === 204;
}

async function query(table, filter, top) {
  const acct = parseConn(); if (!acct) return null;
  let url = `${acct.host}/${table}()?$filter=${encodeURIComponent(filter)}` + (top ? `&$top=${top}` : '');
  const out = [];
  for (let i = 0; i < 20; i++) { /* follow continuation, bounded */
    const r = await fetch(url, { headers: headers(acct, `${table}()`) });
    if (!r.ok) return out;
    const j = await r.json();
    out.push(...(j.value || []));
    const npk = r.headers.get('x-ms-continuation-nextpartitionkey');
    const nrk = r.headers.get('x-ms-continuation-nextrowkey');
    if (!npk) break;
    url = `${acct.host}/${table}()?$filter=${encodeURIComponent(filter)}` + (top ? `&$top=${top}` : '') +
      `&NextPartitionKey=${encodeURIComponent(npk)}` + (nrk ? `&NextRowKey=${encodeURIComponent(nrk)}` : '');
  }
  return out;
}

function dayKey(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function lastDays(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(dayKey(new Date(Date.now() - i * 86400000)));
  return out;
}
module.exports = { insert, upsert, query, dayKey, lastDays, configured: () => !!parseConn() };
