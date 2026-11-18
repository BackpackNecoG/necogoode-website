/* Jira Cloud REST v3 adapter. Auth: Basic (account email + API token, both read from Key Vault).
   Endpoints: POST /rest/api/3/issue, PUT /rest/api/3/issue/{key}, GET+POST /rest/api/3/issue/{key}/transitions,
   GET /rest/api/3/user/search, POST /rest/api/3/issueLink, DELETE /rest/api/3/issueLink/{id}, POST /rest/api/3/search/jql. */
'use strict';
const { failure } = require('./http');
const S = require('./pmoflow-sync');

const MAX_PAGES = 20;
/* Jira's "2026-11-17T15:04:05.000+0000" → ISO */
const isoOf = s => { const t = Date.parse(String(s || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')); return isFinite(t) ? new Date(t).toISOString() : null; };

class JiraAdapter {
  /* auth: async () => 'Basic …' */
  constructor({ http, site, auth }) { Object.assign(this, { http, base: `https://${site}/rest/api/3`, auth }); }
  async call(method, path, body) {
    const r = await this.http.request({ method, url: this.base + path, headers: { Authorization: await this.auth() }, body });
    return r;
  }
  async accountIdFor(email, warnings) {
    if (!email) return null;
    const r = await this.call('GET', '/user/search?query=' + encodeURIComponent(email));
    if (r.status !== 200 || !Array.isArray(r.body)) { warnings.push(failure('Jira user search', r)); return undefined; }
    const exact = r.body.find(u => String(u.emailAddress || '').toLowerCase() === email.toLowerCase());
    const pick = exact || (r.body.length === 1 ? r.body[0] : null);
    if (!pick) { warnings.push(`No single Jira user matches ${email}; the assignee was left as it is.`); return undefined; }
    return pick.accountId;
  }
  async fieldsWithAssignee(payload, warnings) {
    const fields = Object.assign({}, payload.fields || {});
    if ('assigneeEmail' in payload) {
      if (!payload.assigneeEmail) fields.assignee = null;
      else { const id = await this.accountIdFor(payload.assigneeEmail, warnings); if (id) fields.assignee = { accountId: id }; }
    }
    return fields;
  }
  async transition(key, status, warnings) {
    const r = await this.call('GET', `/issue/${encodeURIComponent(key)}/transitions`);
    if (r.status !== 200 || !r.body || !Array.isArray(r.body.transitions)) { warnings.push(failure('Jira transitions', r)); return false; }
    const want = String(status).toLowerCase();
    const t = r.body.transitions.find(x => x.to && String(x.to.name).toLowerCase() === want) || r.body.transitions.find(x => String(x.name).toLowerCase() === want);
    if (!t) { warnings.push(`${key}: no transition to “${status}” from its current status (it may already be there).`); return false; }
    const p = await this.call('POST', `/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: t.id } });
    if (p.status !== 204) { warnings.push(failure('Jira transition', p)); return false; }
    return true;
  }
  async create(intent) {
    const warnings = [], p = intent.payload || {};
    const fields = await this.fieldsWithAssignee(p, warnings);
    const r = await this.call('POST', '/issue', { fields });
    if (r.status !== 201 || !r.body || !r.body.key) return { ok: false, detail: failure('Jira create issue', r) };
    if (p.status) await this.transition(r.body.key, p.status, warnings);
    return { ok: true, key: r.body.key, id: r.body.id, detail: `Created ${r.body.key}.`, warnings };
  }
  async update(intent) {
    const warnings = [], p = intent.payload || {}, key = intent.ref && intent.ref.key;
    if (!key) return { ok: false, detail: 'update needs ref.key' };
    const fields = await this.fieldsWithAssignee(p, warnings);
    if (Object.keys(fields).length) {
      const r = await this.call('PUT', `/issue/${encodeURIComponent(key)}`, { fields });
      if (r.status !== 204 && r.status !== 200) return { ok: false, key, detail: failure('Jira edit issue', r) };
    }
    if (p.status) await this.transition(key, p.status, warnings);
    return { ok: true, key, detail: `Updated ${key}.`, warnings };
  }
  /* The prerequisite blocks the dependent issue: outwardIssue = prerequisite ("blocks"), inwardIssue = this issue ("is blocked by"). */
  async link(intent) {
    const warnings = [], p = intent.payload || {}, key = intent.ref && intent.ref.key;
    const type = p.linkType || 'Blocks';
    for (const dep of p.dependsOn || []) {
      const r = await this.call('POST', '/issueLink', { type: { name: type }, outwardIssue: { key: dep }, inwardIssue: { key } });
      if (r.status !== 201) return { ok: false, key, detail: failure('Jira link issues', r) };
    }
    if ((p.remove || []).length) {
      const g = await this.call('GET', `/issue/${encodeURIComponent(key)}?fields=issuelinks`);
      const links = (g.body && g.body.fields && g.body.fields.issuelinks) || [];
      for (const l of links) {
        if (l.type && l.type.name === type && l.outwardIssue && p.remove.includes(l.outwardIssue.key)) {
          const d = await this.call('DELETE', `/issueLink/${encodeURIComponent(l.id)}`);
          if (d.status !== 204) warnings.push(failure('Jira remove link', d));
        }
      }
    }
    return { ok: true, key, detail: `Linked ${key} to ${(p.dependsOn || []).join(', ') || 'nothing new'}.`, warnings };
  }
  /* Changes since the cursor, normalised to the sync engine's shape. JQL "updated" has minute precision, so the window
     overlaps; the engine ignores values it already has. */
  async pull(intent, conn) {
    const p = intent.payload || {}, tf = p.toolFields || { title: 'summary', description: 'description', due: 'duedate' };
    const body = S.jiraPullBody(conn, p.since, tf);
    const changes = []; let token = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await this.call('POST', '/search/jql', token ? Object.assign({}, body, { nextPageToken: token }) : body);
      if (r.status !== 200 || !r.body || !Array.isArray(r.body.issues)) return { ok: false, detail: failure('Jira search', r) };
      for (const is of r.body.issues) {
        const f = is.fields || {};
        const c = { key: is.key, title: String(f[tf.title] || ''), description: S.textFromAdf(f[tf.description]), status: f.status ? f.status.name : '',
          due: f[tf.due] ? String(f[tf.due]).slice(0, 10) : '', updatedAt: isoOf(f.updated) };
        /* R12: the latest changelog author (needs expand=changelog); email only when the user allows it, else display name */
        const hist = is.changelog && Array.isArray(is.changelog.histories) ? is.changelog.histories : [];
        const last = hist.reduce((m, h) => (!m || String(h.created || '') > String(m.created || '') ? h : m), null);
        if (last && last.author) c.changedBy = String(last.author.emailAddress || last.author.displayName || '').toLowerCase() || null;
        /* Jira hides email addresses unless the user allows it; only send an assignee when it is known */
        if (f.assignee === null) c.assigneeEmail = '';
        else if (f.assignee && f.assignee.emailAddress) c.assigneeEmail = String(f.assignee.emailAddress).toLowerCase();
        changes.push(c);
      }
      if (r.body.isLast !== false || !r.body.nextPageToken) break;
      token = r.body.nextPageToken;
    }
    const cursor = changes.reduce((m, c) => (c.updatedAt && c.updatedAt > m ? c.updatedAt : m), p.since || '') || null;
    return { ok: true, changes, cursor, detail: `${changes.length} changed issue(s).` };
  }
}

module.exports = { JiraAdapter, isoOf };
