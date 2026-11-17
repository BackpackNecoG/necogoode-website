/* Azure DevOps work item REST adapter (api-version 7.1).
   Auth: the relay's managed identity (Entra token for Azure DevOps, resource 499b84ac-1321-427f-aa17-267ca6975798),
   or a PAT read from Key Vault when ADO_AUTH=pat.
   Endpoints: POST {org}/{project}/_apis/wit/workitems/${type}, PATCH {org}/_apis/wit/workitems/{id} (JSON Patch),
   GET {org}/_apis/wit/workitems/{id}?$expand=relations, POST {org}/{project}/_apis/wit/wiql, POST {org}/{project}/_apis/wit/workitemsbatch. */
'use strict';
const { failure } = require('./http');
const S = require('./pmoflow-sync');

const PATCH = 'application/json-patch+json';
const V = 'api-version=7.1';
const BATCH = 200;

class AdoAdapter {
  /* auth: async () => 'Bearer …' | 'Basic …' */
  constructor({ http, org, project, auth }) {
    Object.assign(this, { http, auth, project, org: `https://dev.azure.com/${encodeURIComponent(org)}`, proj: `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}` });
  }
  async call(method, url, body, contentType) {
    return this.http.request({ method, url, headers: { Authorization: await this.auth() }, body, contentType });
  }
  itemUrl(id) { return `${this.org}/_apis/wit/workItems/${encodeURIComponent(id)}`; }
  async create(intent) {
    const p = intent.payload || {};
    const type = p.workItemType || 'Task';
    const r = await this.call('POST', `${this.proj}/_apis/wit/workitems/$${encodeURIComponent(type)}?${V}`, p.patch || [], PATCH);
    if (r.status !== 200 || !r.body || r.body.id == null) return { ok: false, detail: failure('Azure DevOps create work item', r) };
    const key = String(r.body.id), warnings = [];
    if (p.status) {
      const s = await this.call('PATCH', `${this.org}/_apis/wit/workitems/${key}?${V}`, [{ op: 'add', path: '/fields/System.State', value: p.status }], PATCH);
      if (s.status !== 200) warnings.push(failure('Azure DevOps set state', s));
    }
    return { ok: true, key, detail: `Created work item ${key}.`, warnings };
  }
  async update(intent) {
    const p = intent.payload || {}, key = intent.ref && intent.ref.key;
    if (!/^\d+$/.test(String(key || ''))) return { ok: false, detail: 'update needs a numeric ref.key' };
    const patch = (p.patch || []).slice();
    if (p.status) patch.push({ op: 'add', path: '/fields/System.State', value: p.status });
    if (!patch.length) return { ok: true, key, detail: 'Nothing to change.' };
    const r = await this.call('PATCH', `${this.org}/_apis/wit/workitems/${key}?${V}`, patch, PATCH);
    if (r.status !== 200) return { ok: false, key, detail: failure('Azure DevOps update work item', r) };
    return { ok: true, key, detail: `Updated work item ${key}.` };
  }
  /* Predecessor links: System.LinkTypes.Dependency-Reverse on the dependent item points at its prerequisite. */
  async link(intent) {
    const p = intent.payload || {}, key = String(intent.ref && intent.ref.key || '');
    if (!/^\d+$/.test(key)) return { ok: false, detail: 'link needs a numeric ref.key' };
    const rel = p.linkType || S.TOOL_FIELDS.ado.deps;
    const ops = (p.dependsOn || []).map(d => ({ op: 'add', path: '/relations/-', value: { rel, url: this.itemUrl(d) } }));
    if ((p.remove || []).length) {
      const g = await this.call('GET', `${this.org}/_apis/wit/workitems/${key}?$expand=relations&${V}`);
      const rels = (g.body && g.body.relations) || [];
      rels.map((r, i) => ({ r, i })).filter(x => x.r.rel === rel && p.remove.some(d => String(x.r.url).endsWith('/' + d)))
        .sort((a, b) => b.i - a.i).forEach(x => ops.push({ op: 'remove', path: '/relations/' + x.i }));
    }
    if (!ops.length) return { ok: true, key, detail: 'Nothing to link.' };
    const r = await this.call('PATCH', `${this.org}/_apis/wit/workitems/${key}?${V}`, ops, PATCH);
    if (r.status !== 200) return { ok: false, key, detail: failure('Azure DevOps link work items', r) };
    return { ok: true, key, detail: `Linked ${key} to ${(p.dependsOn || []).join(', ') || 'nothing new'}.` };
  }
  async pull(intent, conn) {
    const p = intent.payload || {};
    const q = await this.call('POST', `${this.proj}/_apis/wit/wiql?timePrecision=true&${V}`, { query: S.adoPullQuery(p.since) });
    if (q.status !== 200 || !q.body || !Array.isArray(q.body.workItems)) return { ok: false, detail: failure('Azure DevOps WIQL', q) };
    const ids = q.body.workItems.map(w => w.id);
    const fields = S.adoPullFields(conn, p.toolFields);
    const tf = Object.assign({ title: 'System.Title', description: 'System.Description', due: S.TOOL_FIELDS.ado.due }, p.toolFields || {});
    const changes = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const b = await this.call('POST', `${this.proj}/_apis/wit/workitemsbatch?${V}`, { ids: ids.slice(i, i + BATCH), fields });
      if (b.status !== 200 || !b.body || !Array.isArray(b.body.value)) return { ok: false, detail: failure('Azure DevOps work items batch', b) };
      for (const w of b.body.value) {
        const f = w.fields || {};
        const who = f['System.AssignedTo'];
        changes.push({ key: String(w.id), title: String(f[tf.title] || ''), description: S.textFromHtml(f[tf.description] || ''), status: String(f['System.State'] || ''),
          assigneeEmail: who && typeof who === 'object' ? String(who.uniqueName || '').toLowerCase() : String(who || '').replace(/^.*<([^>]+)>$/, '$1').toLowerCase(),
          due: f[tf.due] ? String(f[tf.due]).slice(0, 10) : '', updatedAt: f['System.ChangedDate'] ? new Date(f['System.ChangedDate']).toISOString() : null });
      }
    }
    const cursor = changes.reduce((m, c) => (c.updatedAt && c.updatedAt > m ? c.updatedAt : m), p.since || '') || null;
    return { ok: true, changes, cursor, detail: `${changes.length} changed work item(s).` };
  }
}

module.exports = { AdoAdapter, ADO_RESOURCE: '499b84ac-1321-427f-aa17-267ca6975798' };
