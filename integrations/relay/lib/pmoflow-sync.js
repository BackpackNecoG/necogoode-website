/* PMOFlow sync engine (R10 S4). Pure logic, no I/O. UMD: window.PMOSync in the browser, require() in Node.
   Byte-identical copies: api/shared/pmoflow-sync.js and web/public/concepts/pmoflow/app/sync.js.

   What it does
   - Field mapping between PMOFlow work items and Jira issues / Azure DevOps work items.
   - Two-way rules: title, description, status and assignee sync both ways (per-field direction is configurable);
     due dates and dependencies are owned by PMOFlow (outbound only, locked). Assignee maps by email.
     Conflicts (both sides changed the same field since the last sync): the later change wins, per field, and is logged.
   - Computes outbound intents from what changed since the last sync, and applies inbound changes to PMOFlow docs.
   - A simulated Jira / Azure DevOps (demo mode) that executes intents and reports changes, in the same shapes
     the customer-deployed relay (integrations/relay) returns.
   - Notification payloads: Teams Workflows webhook (Adaptive Card) and Microsoft Graph sendMail.
   Signing: intents are signed elsewhere (server or relay, HMAC-SHA256 over canonical(intent)); this module only
   provides canonical() so both sides hash the same bytes. */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.PMOSync = f(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;
  var INTENT_TTL_MS = 5 * 60 * 1000;
  var TOOLS = {
    jira: { id: 'jira', name: 'Jira', simName: 'Simulated Jira (demo)', siteLabel: 'Jira site', siteHint: 'yourcompany.atlassian.net',
      keyLabel: 'Jira project key', keyHint: 'For example VOM', itemNoun: 'issue', defaultSite: 'northwind.atlassian.net', defaultType: 'Task' },
    ado: { id: 'ado', name: 'Azure DevOps', simName: 'Simulated Azure DevOps (demo)', siteLabel: 'Azure DevOps organization', siteHint: 'yourcompany (from dev.azure.com/yourcompany)',
      keyLabel: 'Azure DevOps project', keyHint: 'For example Vendor Onboarding', itemNoun: 'work item', defaultSite: 'northwind', defaultType: 'Task' },
  };
  var FIELDS = ['title', 'description', 'status', 'assignee', 'due', 'deps'];
  var FIELD_LABELS = { title: 'Title', description: 'Description', status: 'Status', assignee: 'Assigned to', due: 'Due date', deps: 'Depends on' };
  /* PMOFlow owns these: they only ever flow out. */
  var LOCKED = { due: true, deps: true };
  var DIRS = ['both', 'out', 'in', 'off'];
  var DIR_LABELS = { both: 'Both ways', out: 'PMOFlow → tool only', in: 'Tool → PMOFlow only', off: 'Don’t sync' };
  var TOOL_FIELDS = {
    jira: { title: 'summary', description: 'description', status: 'status', assignee: 'assignee', due: 'duedate', deps: 'issuelinks (Blocks)' },
    ado: { title: 'System.Title', description: 'System.Description', status: 'System.State', assignee: 'System.AssignedTo',
      due: 'Microsoft.VSTS.Scheduling.DueDate', deps: 'System.LinkTypes.Dependency-Reverse' },
  };
  var DEFAULT_STATUS_MAP = {
    jira: { idle: 'To Do', prog: 'In Progress', review: 'In Review', done: 'Done' },
    ado: { idle: 'New', prog: 'Active', review: 'Resolved', done: 'Closed' },
  };
  /* extra tool statuses that are understood when they come back in (tool → PMOFlow status id) */
  var INBOUND_EXTRA = {
    jira: { 'backlog': 'idle', 'selected for development': 'idle', 'open': 'idle', 'in development': 'prog', 'closed': 'done', 'resolved': 'done' },
    ado: { 'to do': 'idle', 'proposed': 'idle', 'approved': 'idle', 'committed': 'prog', 'doing': 'prog', 'in progress': 'prog', 'done': 'done', 'removed': null },
  };
  var EVENTS = ['late', 'approval', 'testFailed', 'launchDone'];
  var EVENT_LABELS = { late: 'A task is late', approval: 'An approval is needed', testFailed: 'A test failed', launchDone: 'A launch is done' };

  /* ---------- small helpers ---------- */
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function str(v) { return v == null ? '' : String(v); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function eq(a, b) { return JSON.stringify(norm(a)) === JSON.stringify(norm(b)); }
  function norm(v) { if (Array.isArray(v)) return v.map(String).sort(); return v == null ? '' : v; }
  function natural(a, b) { return String(a).localeCompare(String(b), 'en', { numeric: true }); }
  function list(docs, type) { return ((docs && docs[type]) || []).map(function (d) { return d.data || d; }); }

  /* Deterministic JSON: object keys sorted at every level. Signing hashes exactly these bytes. */
  function canonical(v) {
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort()
      .map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
  }
  /* The string an intent's HMAC covers: everything except the signature itself. */
  function signingString(intent) { var c = Object.assign({}, intent); delete c.sig; return canonical(c); }

  /* ---------- people ↔ email ---------- */
  function slug(name) { return str(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, ''); }
  function personEmail(p, domain) {
    if (!p) return '';
    if (p.email && /@/.test(p.email)) return String(p.email).toLowerCase();
    return slug(p.name) ? slug(p.name) + '@' + (domain || 'northwind.example') : '';
  }
  function personByEmail(docs, email, domain) {
    var e = str(email).trim().toLowerCase(); if (!e) return null;
    return list(docs, 'person').find(function (p) { return personEmail(p, domain) === e; }) || null;
  }

  /* ---------- rich text ↔ plain text ---------- */
  function adfFromText(text) {
    var paras = str(text).split(/\r?\n/);
    return { type: 'doc', version: 1, content: paras.map(function (t) { return t ? { type: 'paragraph', content: [{ type: 'text', text: t }] } : { type: 'paragraph', content: [] }; }) };
  }
  function textFromAdf(adf) {
    if (adf == null) return '';
    if (typeof adf === 'string') return adf;
    var out = [];
    (function walk(n, para) {
      if (!n) return;
      if (n.type === 'text') { para.push(str(n.text)); return; }
      if (n.type === 'hardBreak') { para.push('\n'); return; }
      if (Array.isArray(n.content)) {
        if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'listItem' || n.type === 'codeBlock') { var p = []; n.content.forEach(function (c) { walk(c, p); }); out.push(p.join('')); }
        else n.content.forEach(function (c) { walk(c, para); });
      } else if (n.type === 'paragraph') out.push('');
    })(adf, []);
    return out.join('\n').replace(/\s+$/, '');
  }
  function escHtml(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function htmlFromText(text) { return str(text).split(/\r?\n/).map(function (l) { return '<div>' + (escHtml(l) || '<br>') + '</div>'; }).join(''); }
  function textFromHtml(html) {
    return str(html).replace(/<br\s*\/?>(?=\s*<\/div>)/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/\n+$/, '');
  }

  /* ---------- connection settings ---------- */
  function defaultFields(tool) {
    var tf = TOOL_FIELDS[tool] || TOOL_FIELDS.jira, o = {};
    FIELDS.forEach(function (f) { o[f] = { dir: LOCKED[f] ? 'out' : 'both', toolField: tf[f] }; if (LOCKED[f]) o[f].locked = true; });
    return o;
  }
  function defaultConnection(opts) {
    opts = opts || {};
    var tool = TOOLS[opts.tool] ? opts.tool : 'jira';
    return {
      projectId: str(opts.projectId), tool: tool,
      site: str(opts.site || TOOLS[tool].defaultSite), projectKey: str(opts.projectKey || (tool === 'jira' ? 'VOM' : 'Vendor Onboarding')),
      issueType: TOOLS[tool].defaultType, emailDomain: 'northwind.example',
      fields: defaultFields(tool), statusMap: clone(DEFAULT_STATUS_MAP[tool]),
      notify: { teams: { on: true, channel: 'Project updates' }, outlook: { on: false, to: [] },
        events: { late: true, approval: true, testFailed: true, launchDone: true } },
      kid: 1, links: {}, cursor: null, log: [], deliveries: [], nonces: {},
    };
  }

  var EMAIL_RE = /^[^\s@<>"',;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
  /* Validates and normalises the user-editable part of a connection. Returns {ok, value, errors}. */
  function validateSettings(input, ctx) {
    ctx = ctx || {}; input = input || {};
    var errors = [], tool = input.tool;
    if (!TOOLS[tool]) { errors.push('Choose Jira or Azure DevOps.'); tool = 'jira'; }
    var base = defaultConnection({ tool: tool, projectId: input.projectId });
    var v = { projectId: str(input.projectId).trim(), tool: tool };
    if (!v.projectId) errors.push('Choose the PMOFlow project to connect.');
    else if (ctx.projects && ctx.projects.indexOf(v.projectId) < 0) errors.push('That project doesn’t exist in this workspace.');
    var site = str(input.site).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (tool === 'ado') site = site.replace(/^dev\.azure\.com\//, '').replace(/\.visualstudio\.com$/, '');
    if (tool === 'jira' && !/^[a-z0-9][a-z0-9-]{1,60}\.atlassian\.net$/.test(site)) errors.push('Enter your Jira site, like yourcompany.atlassian.net.');
    if (tool === 'ado' && !/^[a-z0-9][a-z0-9-]{0,49}$/.test(site)) errors.push('Enter your Azure DevOps organization name, like yourcompany.');
    v.site = site;
    var key = str(input.projectKey).trim();
    if (tool === 'jira') { key = key.toUpperCase(); if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(key)) errors.push('A Jira project key is 2–10 letters or numbers starting with a letter, like VOM.'); }
    else if (!/^[\w][\w .-]{0,63}$/.test(key)) errors.push('Enter the Azure DevOps project name (letters, numbers, spaces, dots or dashes).');
    v.projectKey = key;
    v.issueType = /^[\w ]{1,40}$/.test(str(input.issueType).trim()) ? str(input.issueType).trim() : base.issueType;
    v.emailDomain = /^[a-z0-9.-]{3,100}\.[a-z]{2,24}$/i.test(str(input.emailDomain).trim()) ? str(input.emailDomain).trim().toLowerCase() : base.emailDomain;
    /* fields: direction per field; locked fields are always out */
    v.fields = base.fields;
    if (isObj(input.fields)) FIELDS.forEach(function (f) {
      var src = input.fields[f]; if (!isObj(src)) return;
      if (!LOCKED[f] && DIRS.indexOf(src.dir) >= 0) v.fields[f].dir = src.dir;
      if (typeof src.toolField === 'string' && /^[\w .()-]{1,80}$/.test(src.toolField.trim())) v.fields[f].toolField = src.toolField.trim();
    });
    /* status mapping: every PMOFlow status needs a tool status */
    var statuses = (ctx.statuses && ctx.statuses.length ? ctx.statuses : Object.keys(base.statusMap));
    v.statusMap = {};
    statuses.forEach(function (s) {
      var t = isObj(input.statusMap) ? str(input.statusMap[s]).trim() : '';
      if (t && !/^[\w .'/-]{1,40}$/.test(t)) { errors.push('Status names can use letters, numbers, spaces and . \' / -'); t = ''; }
      v.statusMap[s] = t || base.statusMap[s] || base.statusMap.prog;
    });
    /* notifications */
    var n = isObj(input.notify) ? input.notify : {};
    var teams = isObj(n.teams) ? n.teams : {}, outlook = isObj(n.outlook) ? n.outlook : {};
    var channel = str(teams.channel).trim().slice(0, 80);
    var to = (Array.isArray(outlook.to) ? outlook.to : str(outlook.to).split(/[\s,;]+/)).map(function (x) { return str(x).trim().toLowerCase(); }).filter(Boolean);
    var bad = to.filter(function (x) { return !EMAIL_RE.test(x); });
    if (bad.length) errors.push('These don’t look like email addresses: ' + bad.slice(0, 3).join(', ') + '.');
    if (to.length > 20) errors.push('Send to at most 20 email addresses.');
    if (teams.on && !channel) errors.push('Name the Teams channel (for example “Project updates”).');
    if (outlook.on && !to.length) errors.push('Add at least one email address for Outlook, or turn Outlook off.');
    var ev = isObj(n.events) ? n.events : {};
    v.notify = { teams: { on: !!teams.on, channel: channel || base.notify.teams.channel }, outlook: { on: !!outlook.on, to: to.filter(function (x) { return EMAIL_RE.test(x); }).slice(0, 20) },
      events: {} };
    EVENTS.forEach(function (e) { v.notify.events[e] = ev[e] == null ? true : !!ev[e]; });
    return { ok: !errors.length, value: v, errors: errors };
  }
  /* Teams webhook addresses are secrets. PMOFlow stores only the Key Vault secret NAME the relay reads. */
  function teamsSecretName(channel) { return ('teams-webhook-' + slug(channel).replace(/\./g, '-')).slice(0, 120).replace(/-+$/, '') || 'teams-webhook'; }

  /* ---------- status mapping ---------- */
  function toolStatus(conn, pmoStatus) { return (conn.statusMap || {})[pmoStatus] || (conn.statusMap || {}).prog || ''; }
  /* tool status name → PMOFlow status id. The first PMOFlow status mapped to a name wins (so idle beats review on ties). */
  function pmoStatus(conn, toolStatusName) {
    var t = str(toolStatusName).trim().toLowerCase(); if (!t) return undefined;
    var map = conn.statusMap || {}, ids = Object.keys(map);
    for (var i = 0; i < ids.length; i++) if (str(map[ids[i]]).trim().toLowerCase() === t) return ids[i];
    var extra = INBOUND_EXTRA[conn.tool] || {};
    if (Object.prototype.hasOwnProperty.call(extra, t)) return extra[t] === null ? undefined : extra[t];
    return undefined;
  }
  function toolStatuses(conn) {
    var seen = {}, out = [];
    Object.keys(conn.statusMap || {}).forEach(function (k) { var s = conn.statusMap[k]; if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = 1; out.push(s); } });
    return out;
  }

  /* ---------- PMOFlow side ---------- */
  function projectItems(docs, projectId) {
    return list(docs, 'workItem').filter(function (w) { return w && w.projectId === projectId; }).sort(function (a, b) { return natural(a.id, b.id); });
  }
  /* A work item in sync vocabulary. Assignee is an email; deps are PMOFlow work item ids. */
  function pmoRecord(w, docs, conn) {
    var p = list(docs, 'person').find(function (x) { return x.id === w.owner; });
    return { title: str(w.title), description: str(w.note), status: str(w.status || 'idle'), assignee: personEmail(p, conn.emailDomain),
      due: str(w.due).slice(0, 10), deps: (Array.isArray(w.deps) ? w.deps : []).map(String).sort(natural) };
  }
  function outFields(conn) { return FIELDS.filter(function (f) { var d = (conn.fields[f] || {}).dir; return d === 'both' || d === 'out'; }); }
  function inFields(conn) { return FIELDS.filter(function (f) { var d = (conn.fields[f] || {}).dir; return !LOCKED[f] && (d === 'both' || d === 'in'); }); }
  function keyOf(conn, workItemId) { var l = (conn.links || {})[workItemId]; return l ? l.key : null; }
  function workItemOfKey(conn, key) {
    var links = conn.links || {}, ids = Object.keys(links);
    for (var i = 0; i < ids.length; i++) if (links[ids[i]].key === key) return ids[i];
    return null;
  }

  /* Tool payload for a set of fields. Jira: {fields:{...}, assigneeEmail?, status?}; ADO: {patch:[JSON Patch], assigneeEmail?, status?}.
     Status and assignee travel separately because the relay resolves them at run time (Jira transition id, Jira accountId). */
  function payloadFor(conn, rec, fields, isCreate) {
    var tf = {}; FIELDS.forEach(function (f) { tf[f] = (conn.fields[f] || {}).toolField || TOOL_FIELDS[conn.tool][f]; });
    var has = function (f) { return fields.indexOf(f) >= 0; };
    var out = {};
    if (conn.tool === 'jira') {
      var fl = {};
      if (isCreate) { fl.project = { key: conn.projectKey }; fl.issuetype = { name: conn.issueType || 'Task' }; fl.labels = ['pmoflow']; }
      if (has('title')) fl[tf.title] = rec.title;
      if (has('description')) fl[tf.description] = adfFromText(rec.description);
      if (has('due')) fl[tf.due] = rec.due || null;
      out.fields = fl;
    } else {
      var patch = [];
      var add = function (field, value) { patch.push({ op: 'add', path: '/fields/' + field, value: value }); };
      if (has('title')) add(tf.title, rec.title);
      if (has('description')) add(tf.description, htmlFromText(rec.description));
      if (has('due') && rec.due) add(tf.due, rec.due + 'T00:00:00Z');
      if (has('assignee')) add(tf.assignee, rec.assignee || '');
      if (isCreate) { add('System.Tags', 'PMOFlow'); out.workItemType = conn.issueType || 'Task'; }
      out.patch = patch;
    }
    if (has('assignee')) out.assigneeEmail = rec.assignee || '';
    if (has('status')) out.status = toolStatus(conn, rec.status);
    return out;
  }

  function newIntent(conn, op, ref, payload, opts) {
    var now = opts && opts.now ? new Date(opts.now) : new Date();
    var nonce = opts && opts.nonce ? opts.nonce() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    return { v: VERSION, id: 'int-' + nonce, kid: conn.kid || 1, nonce: nonce, iat: now.toISOString(), exp: new Date(now.getTime() + INTENT_TTL_MS).toISOString(),
      projectId: conn.projectId, connectionId: conn.id || null, tool: conn.tool, target: { site: conn.site, projectKey: conn.projectKey },
      op: op, ref: ref || {}, payload: payload || {} };
  }

  /* Outbound intents for title/description/status/assignee/due (creates and updates). Dependencies come from computeLinks,
     after creates have keys. opts: {now, nonce, only: [workItemIds]} */
  function computeOutbound(conn, docs, opts) {
    opts = opts || {};
    var fields = outFields(conn).filter(function (f) { return f !== 'deps'; }), out = [];
    projectItems(docs, conn.projectId).forEach(function (w) {
      if (opts.only && opts.only.indexOf(w.id) < 0) return;
      var rec = pmoRecord(w, docs, conn), link = (conn.links || {})[w.id];
      if (!link) {
        out.push(newIntent(conn, 'create', { workItemId: w.id, title: rec.title }, payloadFor(conn, rec, fields, true), opts));
        return;
      }
      var changed = fields.filter(function (f) { return !eq(rec[f], (link.base || {})[f]); });
      if (changed.length) {
        var it = newIntent(conn, 'update', { workItemId: w.id, key: link.key, title: rec.title }, payloadFor(conn, rec, changed, false), opts);
        it.changed = changed;
        out.push(it);
      }
    });
    return out;
  }
  /* Dependency links for items whose PMOFlow deps differ from what was last sent. Every dep must already have a key. */
  function computeLinks(conn, docs, opts) {
    opts = opts || {};
    if (outFields(conn).indexOf('deps') < 0) return [];
    var out = [];
    projectItems(docs, conn.projectId).forEach(function (w) {
      var link = (conn.links || {})[w.id]; if (!link) return;
      var rec = pmoRecord(w, docs, conn);
      if (eq(rec.deps, (link.base || {}).deps)) return;
      var sent = ((link.base || {}).deps || []);
      var add = rec.deps.filter(function (d) { return sent.indexOf(d) < 0; }).map(function (d) { return { workItemId: d, key: keyOf(conn, d) }; });
      var remove = sent.filter(function (d) { return rec.deps.indexOf(d) < 0; }).map(function (d) { return { workItemId: d, key: keyOf(conn, d) }; });
      if (add.some(function (d) { return !d.key; })) return;          /* wait until the prerequisite exists in the tool */
      out.push(newIntent(conn, 'link', { workItemId: w.id, key: link.key, title: rec.title },
        { dependsOn: add.map(function (d) { return d.key; }), remove: remove.filter(function (d) { return d.key; }).map(function (d) { return d.key; }),
          linkType: conn.tool === 'jira' ? 'Blocks' : (conn.fields.deps.toolField || TOOL_FIELDS.ado.deps) }, opts));
    });
    return out;
  }
  function pullIntent(conn, opts) {
    var tf = {}; ['title', 'description', 'due'].forEach(function (f) { tf[f] = (conn.fields[f] || {}).toolField || TOOL_FIELDS[conn.tool][f]; });
    return newIntent(conn, 'pull', {}, { since: conn.cursor || null, fields: inFields(conn), toolFields: tf }, opts);
  }

  /* After the relay reports success: record the key and what was sent, so the next sync only sends real changes. */
  function recordResult(conn, intent, result, docs) {
    if (!result || !result.ok) return conn;
    conn.links = conn.links || {};
    var wid = intent.ref && intent.ref.workItemId; if (!wid) return conn;
    var w = projectItems(docs, conn.projectId).find(function (x) { return x.id === wid; });
    var rec = w ? pmoRecord(w, docs, conn) : null;
    var link = conn.links[wid] || (conn.links[wid] = { key: result.key || (intent.ref && intent.ref.key), base: { deps: [] } });
    if (result.key) link.key = result.key;
    if (rec) {
      if (intent.op === 'create') FIELDS.forEach(function (f) { if (f !== 'deps' && outFields(conn).indexOf(f) >= 0) link.base[f] = rec[f]; });
      if (intent.op === 'update') (intent.changed || []).forEach(function (f) { link.base[f] = rec[f]; });
      if (intent.op === 'link') link.base.deps = rec.deps.filter(function (d) { return keyOf(conn, d); });
      if (!link.base.deps) link.base.deps = [];   /* fields never sent stay unset: the tool's first value is taken as-is */
    }
    link.at = intent.iat;
    return conn;
  }

  /* ---------- inbound ---------- */
  /* change: {key, title?, description?, status? (tool status name), assigneeEmail?, due?, updatedAt}. Description is plain text
     (relay converts ADF / HTML). Returns {updates:[{workItemId, data, changes:[{field, from, to}]}], conflicts, skipped, log}.
     opts: {today: 'YYYY-MM-DD', now: ISO, toolName}. conn.links[*].base is updated in place for applied/settled fields. */
  function applyInbound(conn, docs, changes, opts) {
    opts = opts || {};
    var toolName = opts.toolName || (TOOLS[conn.tool] || {}).name || 'the tool';
    var now = opts.now || new Date().toISOString();
    var today = opts.today || now.slice(0, 10);
    var res = { updates: [], conflicts: [], skipped: [], ignored: [] };
    var items = projectItems(docs, conn.projectId), fields = inFields(conn);
    var byWid = {};
    (changes || []).slice().sort(function (a, b) { return str(a.updatedAt).localeCompare(str(b.updatedAt)); }).forEach(function (ch) {
      var wid = workItemOfKey(conn, ch.key);
      if (!wid) { res.skipped.push({ key: ch.key, reason: 'Not linked to a PMOFlow task. PMOFlow plans the work, so add the task in PMOFlow first.' }); return; }
      var w0 = items.find(function (x) { return x.id === wid; });
      if (!w0) { res.skipped.push({ key: ch.key, workItemId: wid, reason: 'The PMOFlow task was deleted.' }); return; }
      var entry = byWid[wid] || (byWid[wid] = { workItemId: wid, key: ch.key, data: clone(w0), changes: [] });
      var w = entry.data, link = conn.links[wid], base = link.base || (link.base = {});
      var rec = pmoRecord(w, docs, conn);
      var incoming = {};
      if ('title' in ch) incoming.title = str(ch.title);
      if ('description' in ch) incoming.description = str(ch.description);
      if ('status' in ch) {
        var s = pmoStatus(conn, ch.status);
        if (s === undefined) res.skipped.push({ key: ch.key, workItemId: wid, field: 'status', reason: 'Status “' + str(ch.status) + '” isn’t mapped to a PMOFlow status. Map it under Status mapping.' });
        else incoming.status = s;
      }
      if ('assigneeEmail' in ch) {
        var em = str(ch.assigneeEmail).toLowerCase();
        var person = em ? personByEmail(docs, em, conn.emailDomain) : null;
        if (em && !person) res.skipped.push({ key: ch.key, workItemId: wid, field: 'assignee', reason: em + ' isn’t a person in PMOFlow, so the owner stays the same.' });
        else if (em) incoming.assignee = em;
      }
      /* PMOFlow owns due dates and dependencies: a different value in the tool is overwritten on the next sync */
      ['due'].forEach(function (f) {
        if (f in ch && str(ch[f]).slice(0, 10) !== str(base[f]).slice(0, 10)) {
          res.ignored.push({ key: ch.key, workItemId: wid, field: f, value: str(ch[f]).slice(0, 10), reason: 'PMOFlow owns ' + FIELD_LABELS[f].toLowerCase() + 's; ' + toolName + ' gets PMOFlow’s date back on the next sync.' });
          base[f] = str(ch[f]).slice(0, 10);   /* differs from PMOFlow, so the next outbound sync re-sends PMOFlow's value */
        }
      });
      fields.forEach(function (f) {
        if (!(f in incoming)) return;
        var tv = incoming[f], b = base[f], pv = rec[f];
        if (eq(tv, b)) return;                                  /* the tool didn't change it (or it is our own echo) */
        if (eq(pv, tv)) { base[f] = tv; return; }               /* already equal */
        var apply = true;
        if (b !== undefined && !eq(pv, b)) {                   /* both sides changed since the last sync */
          var toolAt = Date.parse(ch.updatedAt || 0), pmoAt = Date.parse(w.updatedAt || 0);
          apply = !(isFinite(pmoAt) && pmoAt > (isFinite(toolAt) ? toolAt : 0));
          res.conflicts.push({ key: ch.key, workItemId: wid, field: f, pmoflow: pv, tool: tv, winner: apply ? toolName : 'PMOFlow',
            reason: 'Both changed since the last sync; the later change wins (' + (apply ? toolName : 'PMOFlow') + ').' });
        }
        base[f] = tv;
        if (!apply) return;
        entry.changes.push({ field: f, from: pv, to: tv });
        setField(w, f, tv, docs, conn, today);
        rec = pmoRecord(w, docs, conn);
      });
    });
    Object.keys(byWid).forEach(function (wid) {
      var e = byWid[wid];
      if (e.changes.length) { e.data.updatedAt = now; res.updates.push(e); }
    });
    return res;
  }
  function setField(w, f, v, docs, conn, today) {
    if (f === 'title') w.title = v;
    else if (f === 'description') { if (v) w.note = v; else delete w.note; }
    else if (f === 'assignee') { var p = personByEmail(docs, v, conn.emailDomain); if (p) w.owner = p.id; }
    else if (f === 'status') {
      var was = w.status; w.status = v;
      if (v === 'done' && was !== 'done') w.doneAt = today;
      if (v !== 'done') delete w.doneAt;
    }
  }

  /* ---------- simulated tool (demo mode) ---------- */
  function simNew(conn) { return { seq: 0, items: {}, tool: conn.tool, statuses: toolStatuses(conn) }; }
  function simKey(conn, sim) { sim.seq += 1; return conn.tool === 'jira' ? conn.projectKey + '-' + sim.seq : String(1000 + sim.seq); }
  /* Executes one verified intent against the simulated tool. Returns {ok, key?, detail, changes?, cursor?}. */
  function simExecute(conn, sim, intent, now) {
    now = now || new Date().toISOString();
    var p = intent.payload || {}, ref = intent.ref || {};
    var tname = (TOOLS[conn.tool] || {}).name;
    var fromPayload = function (item) {
      var tf = {}; FIELDS.forEach(function (f) { tf[f] = (conn.fields[f] || {}).toolField || TOOL_FIELDS[conn.tool][f]; });
      if (conn.tool === 'jira') {
        var fl = p.fields || {};
        if (tf.title in fl) item.title = str(fl[tf.title]);
        if (tf.description in fl) item.description = textFromAdf(fl[tf.description]);
        if (tf.due in fl) item.due = str(fl[tf.due]).slice(0, 10);
      } else {
        (p.patch || []).forEach(function (op) {
          var field = str(op.path).replace(/^\/fields\//, '');
          if (field === tf.title) item.title = str(op.value);
          else if (field === tf.description) item.description = textFromHtml(op.value);
          else if (field === tf.due) item.due = str(op.value).slice(0, 10);
          else if (field === 'System.State') item.status = str(op.value);
        });
      }
      if ('assigneeEmail' in p) item.assigneeEmail = str(p.assigneeEmail).toLowerCase();
      if ('status' in p && p.status) item.status = p.status;
    };
    if (intent.op === 'create') {
      var key = simKey(conn, sim);
      var item = { key: key, title: '', description: '', status: toolStatus(conn, 'idle'), assigneeEmail: '', due: '', deps: [], createdAt: now, updatedAt: now, updatedBy: 'PMOFlow sync', pmoId: ref.workItemId };
      fromPayload(item);
      sim.items[key] = item;
      return { ok: true, key: key, detail: 'Created ' + tname + ' ' + TOOLS[conn.tool].itemNoun + ' ' + key + '.' };
    }
    if (intent.op === 'update' || intent.op === 'link') {
      var it = sim.items[ref.key];
      if (!it) return { ok: false, key: ref.key, detail: ref.key + ' no longer exists in ' + tname + '.' };
      if (intent.op === 'update') fromPayload(it);
      else {
        it.deps = (it.deps || []).filter(function (k) { return (p.remove || []).indexOf(k) < 0; });
        (p.dependsOn || []).forEach(function (k) { if (it.deps.indexOf(k) < 0) it.deps.push(k); });
      }
      it.updatedAt = now; it.updatedBy = 'PMOFlow sync';
      return { ok: true, key: ref.key, detail: (intent.op === 'link' ? 'Linked ' + ref.key + ' to ' + ((p.dependsOn || []).join(', ') || 'nothing new') : 'Updated ' + ref.key) + '.' };
    }
    if (intent.op === 'pull') {
      var since = p.since || '';
      var ch = Object.keys(sim.items).map(function (k) { return sim.items[k]; }).filter(function (x) { return !since || x.updatedAt > since; })
        .sort(function (a, b) { return a.updatedAt.localeCompare(b.updatedAt); })
        .map(function (x) { return { key: x.key, title: x.title, description: x.description, status: x.status, assigneeEmail: x.assigneeEmail, due: x.due, updatedAt: x.updatedAt }; });
      var cursor = ch.length ? ch[ch.length - 1].updatedAt : (since || null);
      return { ok: true, changes: ch, cursor: cursor, detail: ch.length + ' changed ' + TOOLS[conn.tool].itemNoun + (ch.length === 1 ? '' : 's') + ' since the last sync.' };
    }
    if (intent.op === 'notify') {
      return { ok: true, detail: p.channel === 'teams' ? 'Posted the card to the Teams channel (simulated: the demo doesn’t send).' : 'Sent the email to ' + (p.to || []).join(', ') + ' (simulated: the demo doesn’t send).' };
    }
    return { ok: false, detail: 'Unknown operation ' + intent.op + '.' };
  }
  /* A person changing an item in the simulated tool. patch: {status?, title?, assigneeEmail?, due?} */
  function simEdit(sim, key, patch, now) {
    var it = sim.items[key]; if (!it) return null;
    ['status', 'title', 'assigneeEmail', 'due', 'description'].forEach(function (k) { if (patch && typeof patch[k] === 'string') it[k] = k === 'assigneeEmail' ? patch[k].toLowerCase() : patch[k]; });
    it.updatedAt = now || new Date().toISOString(); it.updatedBy = 'a person in the tool';
    return it;
  }

  /* ---------- what the relay will call (for the sync log preview) ---------- */
  function describeRequest(conn, intent) {
    var p = intent.payload || {}, ref = intent.ref || {}, out = [];
    if (intent.op === 'notify') {
      if (p.channel === 'teams') return [{ method: 'POST', url: '<Workflows webhook address from Key Vault secret “' + p.secretName + '”>', body: p.body }];
      return [{ method: 'POST', url: 'https://graph.microsoft.com/v1.0/users/<sender mailbox>/sendMail', body: p.body }];
    }
    if (conn.tool === 'jira') {
      var J = 'https://' + conn.site + '/rest/api/3';
      var fields = Object.assign({}, p.fields || {});
      if ('assigneeEmail' in p) fields.assignee = p.assigneeEmail ? { id: '<accountId for ' + p.assigneeEmail + '>' } : null;
      if ('assigneeEmail' in p && p.assigneeEmail) out.push({ method: 'GET', url: J + '/user/search?query=' + encodeURIComponent(p.assigneeEmail) });
      if (intent.op === 'create') out.push({ method: 'POST', url: J + '/issue', body: { fields: fields } });
      if (intent.op === 'update' && Object.keys(fields).length) out.push({ method: 'PUT', url: J + '/issue/' + ref.key, body: { fields: fields } });
      if ((intent.op === 'create' || intent.op === 'update') && p.status) {
        var k = intent.op === 'create' ? '<new key>' : ref.key;
        out.push({ method: 'GET', url: J + '/issue/' + k + '/transitions' });
        out.push({ method: 'POST', url: J + '/issue/' + k + '/transitions', body: { transition: { id: '<id of the transition to “' + p.status + '”>' } } });
      }
      if (intent.op === 'link') (p.dependsOn || []).forEach(function (d) { out.push({ method: 'POST', url: J + '/issueLink', body: { type: { name: 'Blocks' }, outwardIssue: { key: d }, inwardIssue: { key: ref.key } } }); });
      if (intent.op === 'pull') out.push({ method: 'POST', url: J + '/search/jql', body: jiraPullBody(conn, p.since, p.toolFields) });
    } else {
      var A = 'https://dev.azure.com/' + encodeURIComponent(conn.site);
      var proj = encodeURIComponent(conn.projectKey);
      var patch = (p.patch || []).slice();
      if (intent.op === 'create') {
        out.push({ method: 'POST', url: A + '/' + proj + '/_apis/wit/workitems/$' + encodeURIComponent(p.workItemType || conn.issueType || 'Task') + '?api-version=7.1', contentType: 'application/json-patch+json', body: patch });
        if (p.status) out.push({ method: 'PATCH', url: A + '/_apis/wit/workitems/<new id>?api-version=7.1', contentType: 'application/json-patch+json', body: [{ op: 'add', path: '/fields/System.State', value: p.status }] });
      }
      if (intent.op === 'update') {
        if (p.status) patch.push({ op: 'add', path: '/fields/System.State', value: p.status });
        out.push({ method: 'PATCH', url: A + '/_apis/wit/workitems/' + ref.key + '?api-version=7.1', contentType: 'application/json-patch+json', body: patch });
      }
      if (intent.op === 'link') out.push({ method: 'PATCH', url: A + '/_apis/wit/workitems/' + ref.key + '?api-version=7.1', contentType: 'application/json-patch+json',
        body: (p.dependsOn || []).map(function (d) { return { op: 'add', path: '/relations/-', value: { rel: p.linkType || TOOL_FIELDS.ado.deps, url: A + '/_apis/wit/workItems/' + d } }; }) });
      if (intent.op === 'pull') {
        out.push({ method: 'POST', url: A + '/' + proj + '/_apis/wit/wiql?timePrecision=true&api-version=7.1', body: { query: adoPullQuery(p.since) } });
        out.push({ method: 'POST', url: A + '/' + proj + '/_apis/wit/workitemsbatch?api-version=7.1', body: { ids: ['<ids from the query, up to 200>'], fields: adoPullFields(conn, p.toolFields) } });
      }
    }
    return out;
  }
  function jiraTime(iso) { var d = new Date(iso); var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()); }
  function jiraPullBody(conn, since, toolFields) {
    var tf = toolFields || { title: (conn.fields && conn.fields.title || {}).toolField || 'summary', description: (conn.fields && conn.fields.description || {}).toolField || 'description',
      due: (conn.fields && conn.fields.due || {}).toolField || 'duedate' };
    return { jql: 'project = "' + conn.projectKey + '" AND labels = pmoflow' + (since ? ' AND updated >= "' + jiraTime(since) + '"' : '') + ' ORDER BY updated ASC',
      fields: [tf.title, tf.description, 'status', 'assignee', tf.due, 'updated'], maxResults: 100 };
  }
  function adoPullQuery(since) {
    return "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS 'PMOFlow'" +
      (since ? " AND [System.ChangedDate] > '" + new Date(since).toISOString() + "'" : '') + ' ORDER BY [System.ChangedDate] ASC';
  }
  function adoPullFields(conn, toolFields) {
    var tf = function (f) { return (toolFields && toolFields[f]) || ((conn.fields || {})[f] || {}).toolField || TOOL_FIELDS.ado[f]; };
    return ['System.Id', tf('title'), tf('description'), 'System.State', 'System.AssignedTo', tf('due'), 'System.ChangedDate'];
  }

  /* ---------- notifications ---------- */
  /* notice: {event, title, text, facts:[[label, value]], url}. Built from engine output by the caller (route or page). */
  function noticeFor(event, ctx) {
    ctx = ctx || {};
    var name = str(ctx.projectName || 'your project'), url = str(ctx.url || '');
    var t = ctx.truth || {};
    var n = { event: event, url: url, facts: [] };
    if (event === 'late') {
      var late = ctx.lateItems || [];
      n.title = late.length ? (late.length === 1 ? '1 task is late' : late.length + ' tasks are late') + ' on ' + name : 'Nothing is late on ' + name;
      n.text = late.length ? 'First: “' + str(late[0].title) + '” (' + str(late[0].owner || 'no owner') + '), due ' + str(late[0].due) + '.' : 'Every task is on schedule.';
      late.slice(0, 3).forEach(function (w) { n.facts.push([str(w.title), 'Due ' + str(w.due) + ' · ' + str(w.owner || 'no owner')]); });
    } else if (event === 'approval') {
      var a = ctx.approval || null;
      n.title = !a ? 'No approval is waiting on ' + name : a.ready ? 'Approval needed: ' + str(a.bu) + ' part of ' + name : 'Coming up: approval of the ' + str(a.bu) + ' part of ' + name;
      n.text = !a ? 'Nobody needs to approve anything right now.' : a.ready ? str(a.approverName || 'The approver') + ', the ' + str(a.bu) + ' part is ready for your sign-off.'
        : str(a.sentence || 'It isn’t ready for sign-off yet.');
      if (a) n.facts.push(['Approver', str(a.approverName || '—')], ['Part', str(a.bu)]);
    } else if (event === 'testFailed') {
      var tst = t.testing || {};
      n.title = (tst.failed ? (tst.failed === 1 ? '1 test failed' : tst.failed + ' tests failed') : 'No failed tests') + ' on ' + name;
      n.text = str(tst.sentence || '');
      if (tst.count) n.facts.push(['Tests', str(tst.count)]);
    } else if (event === 'launchDone') {
      n.title = ctx.live ? name + ' is live' : name + ' hasn’t launched yet';
      n.text = ctx.live ? 'The launch finished' + (ctx.liveDate ? ' on ' + ctx.liveDate : '') + '. The new process is now the controlled SOP.' : 'You’ll get this message when it launches.';
    }
    if (t.label) n.facts.push(['Project status', str(t.label)]);
    return n;
  }
  /* Teams Workflows ("Post to a channel when a webhook request is received") request body with one Adaptive Card. */
  function teamsCard(notice) {
    var body = [
      { type: 'TextBlock', text: 'PMOFlow', size: 'Small', weight: 'Bolder', color: 'Accent' },
      { type: 'TextBlock', text: str(notice.title), size: 'Medium', weight: 'Bolder', wrap: true },
    ];
    if (notice.text) body.push({ type: 'TextBlock', text: str(notice.text), wrap: true });
    if (notice.facts && notice.facts.length) body.push({ type: 'FactSet', facts: notice.facts.map(function (f) { return { title: str(f[0]), value: str(f[1]) }; }) });
    var content = { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body: body };
    if (notice.url) content.actions = [{ type: 'Action.OpenUrl', title: 'Open in PMOFlow', url: notice.url }];
    return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: content }] };
  }
  /* Microsoft Graph POST /users/{sender}/sendMail request body. */
  function graphMail(notice, to) {
    var rows = (notice.facts || []).map(function (f) { return '<tr><td style="padding:2px 12px 2px 0;color:#4b5563">' + escHtml(f[0]) + '</td><td>' + escHtml(f[1]) + '</td></tr>'; }).join('');
    var html = '<p style="font:600 16px Segoe UI,Arial,sans-serif">' + escHtml(notice.title) + '</p>' + (notice.text ? '<p>' + escHtml(notice.text) + '</p>' : '') +
      (rows ? '<table style="font:14px Segoe UI,Arial,sans-serif">' + rows + '</table>' : '') + (notice.url ? '<p><a href="' + escHtml(notice.url) + '">Open in PMOFlow</a></p>' : '');
    return { message: { subject: 'PMOFlow: ' + str(notice.title), body: { contentType: 'HTML', content: html },
      toRecipients: (to || []).map(function (a) { return { emailAddress: { address: a } }; }) }, saveToSentItems: false };
  }

  /* Signed-intent form of a notification: the relay posts it with the webhook address / mailbox it holds in Key Vault. */
  function notifyIntents(conn, notice, opts) {
    var n = conn.notify || {}, out = [], ref = { event: notice.event, title: notice.title };
    if (n.teams && n.teams.on) out.push(newIntent(conn, 'notify', ref, { channel: 'teams', secretName: teamsSecretName(n.teams.channel), body: teamsCard(notice) }, opts));
    if (n.outlook && n.outlook.on && (n.outlook.to || []).length) out.push(newIntent(conn, 'notify', ref, { channel: 'outlook', to: n.outlook.to.slice(), body: graphMail(notice, n.outlook.to) }, opts));
    return out;
  }

  return {
    VERSION: VERSION, INTENT_TTL_MS: INTENT_TTL_MS, TOOLS: TOOLS, FIELDS: FIELDS, FIELD_LABELS: FIELD_LABELS, LOCKED: LOCKED, DIRS: DIRS, DIR_LABELS: DIR_LABELS,
    TOOL_FIELDS: TOOL_FIELDS, DEFAULT_STATUS_MAP: DEFAULT_STATUS_MAP, EVENTS: EVENTS, EVENT_LABELS: EVENT_LABELS,
    canonical: canonical, signingString: signingString,
    personEmail: personEmail, personByEmail: personByEmail,
    adfFromText: adfFromText, textFromAdf: textFromAdf, htmlFromText: htmlFromText, textFromHtml: textFromHtml,
    defaultConnection: defaultConnection, validateSettings: validateSettings, teamsSecretName: teamsSecretName,
    toolStatus: toolStatus, pmoStatus: pmoStatus, toolStatuses: toolStatuses,
    projectItems: projectItems, pmoRecord: pmoRecord, outFields: outFields, inFields: inFields, keyOf: keyOf, workItemOfKey: workItemOfKey,
    payloadFor: payloadFor, newIntent: newIntent, computeOutbound: computeOutbound, computeLinks: computeLinks, pullIntent: pullIntent, recordResult: recordResult,
    applyInbound: applyInbound,
    simNew: simNew, simExecute: simExecute, simEdit: simEdit,
    describeRequest: describeRequest, jiraPullBody: jiraPullBody, adoPullQuery: adoPullQuery, adoPullFields: adoPullFields,
    noticeFor: noticeFor, teamsCard: teamsCard, graphMail: graphMail, notifyIntents: notifyIntents,
  };
});
