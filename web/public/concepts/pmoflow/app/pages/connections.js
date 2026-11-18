/* PMOFlow — Connections (R10 stream S4). Route: /connections
   Connect a project to Jira or Azure DevOps in 3 plain steps; two-way sync; Teams / Outlook notifications.
   Demo mode: the tool is a simulated Jira / Azure DevOps inside the sandbox ("Simulated Jira (demo)"); a simulated relay
   verifies every signed intent. Sync logic lives in app/sync.js (window.PMOSync, byte-identical to api/shared/pmoflow-sync.js).
   Server routes: /api/pmoflow/workspaces/:ws/connections... (api/shared/pmoflow-routes-connect.js). */
import { store } from '../store.js';
import { esc, fmt, fmtTime, link, pname, toast, modal, E, activityCard, bindActivity } from '../ui.js';

/* ---------- assets (until the lead adds the tags to index.html) ---------- */
const APP = (() => { try { return new URL('../', import.meta.url).href; } catch (e) { return '/concepts/pmoflow/app/'; } })();
let syncLoading = null;
function needSync() {
  if (window.PMOSync) return true;
  if (!syncLoading) {
    syncLoading = new Promise(res => {
      const s = document.createElement('script'); s.src = APP + 'sync.js'; s.async = true;
      s.onload = () => { res(true); window.dispatchEvent(new Event('pmo:route')); };
      s.onerror = () => res(false);
      document.head.appendChild(s);
    });
  }
  return false;
}
if (!document.querySelector('link[data-cx-css]') && !document.querySelector('link[href$="css/connect.css"]')) {
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = APP + 'css/connect.css'; l.setAttribute('data-cx-css', '1'); document.head.appendChild(l);
}
const S = () => window.PMOSync;

/* ---------- page state that survives re-renders ---------- */
const ui = { wizard: null, result: null, openLog: new Set(), sel: null, busy: false, delivery: null };

async function cx(method, path, body) {
  const t = store.state.today;
  const url = `/api/pmoflow/workspaces/${store.state.ws}/connections${path || ''}` + (method === 'GET' ? `?today=${t}` : '');
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(Object.assign({ today: t, actor: store.state.me }, body || {})) });
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok) { const err = new Error((j && j.error) || ('HTTP ' + r.status)); err.body = j; throw err; }
  return j;
}

const conns = () => store.list('connection').sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
const projectOf = id => store.get('project', id);
const canWork = p => !!p && (store.state.me === p.owner || (p.resources || []).includes(store.state.me));
const teamHint = p => p ? `Only the project team of ${p.name} can change this. Switch person in the menu to ${pname(p.owner)} (project manager) or a team member.` : '';
const initials = name => String(name || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'PMO';
const statusName = (p, id) => (((p && p.statuses) || []).find(s => s.id === id) || {}).name || id;

function truthLine(projectId) {
  const eng = E(); if (!eng || !eng.projectTruth) return '';
  try {
    const t = eng.projectTruth(store.state.docs, projectId, store.state.today); if (!t) return '';
    const cls = t.rag === 'green' ? 'b-done' : t.rag === 'red' ? 'b-late' : t.rag === 'amber' ? 'b-soon' : 'b-idle';
    return `<span class="badge ${cls}" data-cx-truth>${esc(t.label)}</span> <span class="hint">${t.tasks.done} of ${t.tasks.total} tasks done</span>`;
  } catch (e) { return ''; }
}

/* ---------- wizard ---------- */
function newDraft() {
  const ps = store.list('project').filter(p => p.status !== 'live');
  const taken = new Set(conns().map(c => c.projectId));
  const p = ps.find(x => canWork(x) && !taken.has(x.id)) || ps.find(x => !taken.has(x.id)) || ps[0] || null;
  const d = S().defaultConnection({ tool: 'jira', projectId: p ? p.id : '', projectKey: initials(p && p.name) });
  return Object.assign(d, { step: 1 });
}
function toolDefaults(d, tool) {
  const p = projectOf(d.projectId);
  const n = S().defaultConnection({ tool, projectId: d.projectId, projectKey: tool === 'jira' ? initials(p && p.name) : (p ? p.name.slice(0, 60) : '') });
  return Object.assign(n, { step: d.step, notify: d.notify });
}

function wizardHTML(d) {
  const sync = S(), T = sync.TOOLS[d.tool], p = projectOf(d.projectId);
  const steps = ['Choose the tool', 'Point to the project', 'What syncs'];
  const head = `<ol class="cx-steps" aria-label="Steps">${steps.map((s, i) => `<li class="${d.step === i + 1 ? 'on' : d.step > i + 1 ? 'done' : ''}"><b>${i + 1}</b> ${esc(s)}</li>`).join('')}</ol>`;
  let body = '';
  if (d.step === 1) {
    const ps = store.list('project').filter(x => x.status !== 'live');
    body = `<div class="field"><label for="cx-prj">PMOFlow project</label><select id="cx-prj" data-cx="projectId">${ps.map(x => `<option value="${esc(x.id)}" ${x.id === d.projectId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="cx-tools" role="radiogroup" aria-label="Tool">${['jira', 'ado'].map(t => `<button type="button" class="cx-tool ${d.tool === t ? 'on' : ''}" role="radio" aria-checked="${d.tool === t}" data-cx-tool="${t}">
        <span class="cx-logo cx-${t}" aria-hidden="true">${t === 'jira' ? 'J' : 'A'}</span><b>${esc(sync.TOOLS[t].name)}</b><span class="hint">${t === 'jira' ? 'Jira Cloud issues' : 'Azure Boards work items'}</span></button>`).join('')}</div>
      ${p && !canWork(p) ? `<div class="banner" data-cx-perm>${esc(teamHint(p))}</div>` : ''}`;
  } else if (d.step === 2) {
    body = `<div class="frow"><div class="field"><label for="cx-site">${esc(T.siteLabel)}</label><input id="cx-site" data-cx="site" value="${esc(d.site)}" placeholder="${esc(T.siteHint)}" autocomplete="off"></div>
      <div class="field"><label for="cx-key">${esc(T.keyLabel)}</label><input id="cx-key" data-cx="projectKey" value="${esc(d.projectKey)}" placeholder="${esc(T.keyHint)}" autocomplete="off"></div></div>
      <p class="hint" style="margin:10px 0 0">PMOFlow never asks for a ${esc(T.name)} password or token. A small relay in your company’s Azure holds the key and makes the changes. <a href="/pmoflow/security" style="color:var(--accent)">How this stays safe</a></p>
      <span class="sim">Demo: this connects to ${esc(T.simName)}, which lives in your sandbox.</span>`;
  } else {
    body = settingsHTML(d, p);
  }
  const nextLabel = d.step < 3 ? 'Next' : 'Connect and sync';
  return `<div class="card cx-wizard" data-cx-wizard><h3>Connect a project</h3>${head}<div class="cx-wbody">${body}</div>
    <div class="cx-err" data-cx-err role="alert" hidden></div>
    <div class="cx-wfoot"><button class="btn" data-cx-cancel>Cancel</button>${d.step > 1 ? '<button class="btn" data-cx-back>Back</button>' : ''}
      <button class="btn primary" data-cx-next ${p && !canWork(p) ? 'disabled' : ''}>${nextLabel}</button></div></div>`;
}

/* step 3 and the settings dialog share this form */
function settingsHTML(d, p) {
  const sync = S(), T = sync.TOOLS[d.tool];
  const statuses = (p && p.statuses && p.statuses.length ? p.statuses : Object.keys(d.statusMap).map(id => ({ id, name: id })));
  const dirOpts = (f) => sync.DIRS.map(x => `<option value="${x}" ${d.fields[f].dir === x ? 'selected' : ''}>${esc(x === 'out' ? 'PMOFlow → ' + T.name + ' only' : x === 'in' ? T.name + ' → PMOFlow only' : sync.DIR_LABELS[x])}</option>`).join('');
  const preview = sync.FIELDS.map(f => {
    const fd = d.fields[f];
    const dir = fd.dir === 'both' ? '⇄ both ways' : fd.dir === 'out' ? (fd.locked ? '→ PMOFlow decides' : '→ to ' + T.name) : fd.dir === 'in' ? '← from ' + T.name : 'not synced';
    return `<tr><td>${esc(sync.FIELD_LABELS[f])}</td><td class="cx-dir ${fd.dir}">${esc(dir)}</td><td><code>${esc(fd.toolField)}</code></td></tr>`;
  }).join('');
  const n = d.notify;
  return `<div class="cx-sum"><div>✓ <b>Title, description, status and owner</b> stay the same in both places.</div>
      <div>✓ <b>Due dates and dependencies</b> are decided in PMOFlow and copied to ${esc(T.name)}.</div>
      <div>✓ If both sides change the same thing, the <b>later change wins</b> and it’s written in the sync log.</div></div>
    <div class="tbl-wrap"><table class="cx-map" data-cx-map><thead><tr><th>PMOFlow</th><th>Sync</th><th>${esc(T.name)} field</th></tr></thead><tbody>${preview}</tbody></table></div>
    <details class="cx-adv" data-cx-adv><summary>Advanced field mapping</summary>
      <div class="cx-grid">${sync.FIELDS.map(f => `<div class="field"><label for="cx-dir-${f}">${esc(sync.FIELD_LABELS[f])}</label>
        <select id="cx-dir-${f}" data-cx-dir="${f}" ${d.fields[f].locked ? 'disabled title="PMOFlow owns this field"' : ''}>${dirOpts(f)}</select>
        <input aria-label="${esc(T.name)} field for ${esc(sync.FIELD_LABELS[f])}" data-cx-tf="${f}" value="${esc(d.fields[f].toolField)}" ${f === 'deps' || f === 'status' || f === 'assignee' ? 'readonly' : ''}></div>`).join('')}</div>
      <div class="field" style="margin-top:8px;max-width:320px"><label for="cx-domain">Company email domain (matches owners by email)</label><input id="cx-domain" data-cx="emailDomain" value="${esc(d.emailDomain)}"></div>
    </details>
    <details class="cx-adv" data-cx-statuses><summary>Match statuses <span class="hint">${statuses.map(s => esc(s.name) + ' = ' + esc(d.statusMap[s.id] || '')).join(' · ')}</span></summary>
      <div class="cx-grid">${statuses.map(s => `<div class="field"><label for="cx-st-${esc(s.id)}">PMOFlow “${esc(s.name)}” is ${esc(T.name)}</label><input id="cx-st-${esc(s.id)}" data-cx-st="${esc(s.id)}" value="${esc(d.statusMap[s.id] || '')}"></div>`).join('')}</div>
    </details>
    <h4 class="cx-h4">Send notifications to</h4>
    <div class="cx-notify">
      <label class="cx-check"><input type="checkbox" data-cx-n="teams" ${n.teams.on ? 'checked' : ''}> Teams channel</label>
      <div class="field"><label for="cx-ch">Channel name</label><input id="cx-ch" data-cx-ch value="${esc(n.teams.channel)}" placeholder="Project updates"></div>
      <label class="cx-check"><input type="checkbox" data-cx-n="outlook" ${n.outlook.on ? 'checked' : ''}> Outlook email</label>
      <div class="field"><label for="cx-to">Email addresses (comma separated)</label><input id="cx-to" data-cx-to value="${esc((n.outlook.to || []).join(', '))}" placeholder="name@yourcompany.com"></div>
    </div>
    <div class="cx-events" role="group" aria-label="Which events">${sync.EVENTS.map(e => `<label class="cx-check"><input type="checkbox" data-cx-ev="${e}" ${n.events[e] ? 'checked' : ''}> ${esc(sync.EVENT_LABELS[e])}</label>`).join('')}</div>
    <p class="hint" style="margin:6px 0 0">The Teams channel’s web address is kept in your Key Vault as <code data-cx-secret>${esc(sync.teamsSecretName(n.teams.channel || 'channel'))}</code>, never in PMOFlow.</p>`;
}

/* read the form into a draft */
function readSettings(root, d) {
  const sync = S();
  root.querySelectorAll('[data-cx]').forEach(el => { d[el.dataset.cx] = el.value; });
  root.querySelectorAll('[data-cx-dir]').forEach(el => { const f = el.dataset.cxDir; if (!d.fields[f].locked) d.fields[f].dir = el.value; });
  root.querySelectorAll('[data-cx-tf]').forEach(el => { d.fields[el.dataset.cxTf].toolField = el.value.trim() || d.fields[el.dataset.cxTf].toolField; });
  root.querySelectorAll('[data-cx-st]').forEach(el => { d.statusMap[el.dataset.cxSt] = el.value.trim(); });
  const t = root.querySelector('[data-cx-n="teams"]'); if (t) d.notify.teams.on = t.checked;
  const o = root.querySelector('[data-cx-n="outlook"]'); if (o) d.notify.outlook.on = o.checked;
  const ch = root.querySelector('[data-cx-ch]'); if (ch) d.notify.teams.channel = ch.value;
  const to = root.querySelector('[data-cx-to]'); if (to) d.notify.outlook.to = to.value.split(/[\s,;]+/).filter(Boolean);
  root.querySelectorAll('[data-cx-ev]').forEach(el => { d.notify.events[el.dataset.cxEv] = el.checked; });
  void sync;
  return d;
}
function settingsPayload(d) {
  return { projectId: d.projectId, tool: d.tool, site: d.site, projectKey: d.projectKey, issueType: d.issueType, emailDomain: d.emailDomain,
    fields: d.fields, statusMap: d.statusMap, notify: d.notify };
}

/* ---------- connected view ---------- */
function resultHTML(r) {
  if (!r) return '';
  const b = r.before, a = r.after;
  const st = b && a ? (b.label !== a.label || b.done !== a.done
    ? ` Project status: <b>${esc(b.label)}</b> → <b data-cx-after>${esc(a.label)}</b> (${b.done} → ${a.done} of ${a.total} tasks done).`
    : ` Project status stays <b data-cx-after>${esc(a.label)}</b>.`) : '';
  return `<div class="cx-result ${r.error ? 'err' : ''}" data-cx-result role="status">${r.error ? esc(r.error) : `<b>${esc(r.title || 'Synced')}</b> ${esc(r.sentence || '')}.${st}`}</div>`;
}

const RESULT_BADGE = { held: ['b-soon', 'Waits in review'], flagged: ['b-soon', 'Check order'], ok: ['b-done', 'Done'], failed: ['b-late', 'Failed'], refused: ['b-done', 'Refused'], conflict: ['b-soon', 'Conflict'], skipped: ['b-idle', 'Skipped'], ignored: ['b-idle', 'Put back'] };
function logHTML(c) {
  const sync = S(), tool = sync.TOOLS[c.tool].name;
  const items = (c.log || []).slice(0, 25);
  if (!items.length) return '<div class="empty">Nothing synced yet.</div>';
  return `<div class="cx-log" data-cx-log>${items.map(e => {
    const [cls, lbl] = RESULT_BADGE[e.result] || ['b-idle', e.result];
    const dir = e.dir === 'out' ? `PMOFlow → ${tool}` : `${tool} → PMOFlow`;
    const what = { create: 'Create', update: 'Update', link: 'Link', pull: 'Read changes', apply: 'Apply', conflict: 'Conflict', skip: 'Skip', ignore: 'Keep PMOFlow’s', flag: 'Finished early', held: 'Done held', 'replay-test': 'Replay test' }[e.op] || e.op;
    const open = ui.openLog.has(e.id);
    const tech = e.intent || (e.requests && e.requests.length);
    return `<div class="cx-le"><div class="cx-lh"><span class="badge ${cls}">${esc(lbl)}</span><span class="cx-ld">${esc(dir)}</span>
      <span class="cx-lt"><b>${esc(what)}${e.key ? ' ' + esc(e.key) : ''}</b>${e.title ? ' · ' + esc(e.title) : ''}</span><time>${esc(fmtTime(e.at))}</time></div>
      <div class="cx-lx">${esc(e.detail || '')}</div>${e.by ? `<div class="hint cx-lby" data-cx-by>Changed by ${esc(e.by)}</div>` : ''}
      ${tech ? `<details data-cx-tech="${esc(e.id)}" ${open ? 'open' : ''}><summary>Signed request and what the relay calls</summary>
        ${e.intent ? `<div class="hint">Signed intent (HMAC-SHA256, key ${esc(e.intent.kid)}, expires ${esc(fmtTime(e.intent.exp))})</div><pre>${esc(JSON.stringify(e.intent, null, 2))}</pre>` : ''}
        ${(e.requests || []).map(q => `<div class="hint">${esc(q.method)} ${esc(q.url)}</div>${q.body ? `<pre>${esc(JSON.stringify(q.body, null, 2))}</pre>` : ''}`).join('')}</details>` : ''}</div>`;
  }).join('')}</div>`;
}

/* R12 #3: a Done from the tool that PMOFlow held in review (it would close a problem or make information available).
   Shown while the tool still says Done and PMOFlow has not finished the task itself. */
function heldNote(c, wid, it, w) {
  if (!wid || !w || w.status === 'done') return null;
  const sync = S();
  if (sync.pmoStatus(c, it.status) !== 'done') return null;
  const h = (c.log || []).find(e => e.op === 'held' && e.workItemId === wid);
  return h ? h.detail : null;
}
/* R11 §9: G1's engine helper (the one definition), shown while it is still true */
function earlyFlag(wid) {
  const eng = window.PMOEngine;
  if (!wid || !eng || typeof eng.doneBeforeDeps !== 'function') return null;
  try { const r = eng.doneBeforeDeps(store.state.docs, wid); return r && r.flag ? r.text : null; } catch (e) { return null; }
}
function simHTML(c, p) {
  const sync = S(), T = sync.TOOLS[c.tool];
  const items = Object.values((c.sim && c.sim.items) || {}).sort((a, b) => String(a.key).localeCompare(String(b.key), 'en', { numeric: true }));
  if (!items.length) return `<div class="empty">Nothing in ${esc(T.simName)} yet. Press “Sync now”.</div>`;
  const statuses = sync.toolStatuses(c);
  return `<div class="cx-sim" data-cx-sim>${items.map(it => {
    const wid = sync.workItemOfKey(c, it.key), w = wid ? store.get('workItem', wid) : null;
    const who = (sync.personByEmail(store.state.docs, it.assigneeEmail, c.emailDomain) || {}).name || it.assigneeEmail || 'Unassigned';
    return `<div class="cx-si" data-cx-item="${esc(it.key)}"><span class="cx-key">${esc(it.key)}</span>
      <div class="cx-st"><div class="t">${esc(it.title)}</div><div class="s">${esc(who)}${it.due ? ' · due ' + esc(fmt(it.due)) : ''}${(it.deps || []).length ? ' · after ' + esc(it.deps.join(', ')) : ''}</div>
        <div class="s">In PMOFlow: ${w ? `<b data-cx-pmo="${esc(wid)}">${esc(statusName(p, w.status))}</b>` : '<i>deleted</i>'}</div>
        ${(() => { const t = earlyFlag(wid); return t ? `<div class="s warn cx-flag" data-cx-early="${esc(wid)}" role="note">${esc(t)}.</div>` : ''; })()}
        ${(() => { const t = heldNote(c, wid, it, w); return t ? `<div class="s warn cx-flag" data-cx-held="${esc(wid)}" role="note">${esc(t)}</div>` : ''; })()}</div>
      <label class="cx-ss"><span>${esc(T.name)} status</span><select data-cx-simstatus="${esc(it.key)}" aria-label="Status of ${esc(it.key)} in ${esc(T.simName)}">${statuses.concat(statuses.includes(it.status) ? [] : [it.status]).map(s => `<option ${s === it.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label></div>`;
  }).join('')}</div>`;
}

function cardRender(body) {
  /* Adaptive Card body → HTML, escaping every value */
  const blocks = (((body || {}).attachments || [])[0] || {}).content || {};
  return (blocks.body || []).map(b => b.type === 'TextBlock' ? `<div class="cx-tb ${b.weight === 'Bolder' ? 'b' : ''} ${b.size === 'Small' ? 'sm' : ''}">${esc(b.text)}</div>`
    : b.type === 'FactSet' ? `<div class="cx-facts">${(b.facts || []).map(f => `<div><span>${esc(f.title)}</span><span>${esc(f.value)}</span></div>`).join('')}</div>` : '').join('')
    + ((blocks.actions || []).length ? `<div class="cx-cact">${blocks.actions.map(a => `<span>${esc(a.title)}</span>`).join('')}</div>` : '');
}
function deliveryHTML(dl) {
  if (!dl) return '<div class="hint">Pick a message to preview. In the demo nothing is sent.</div>';
  const mail = dl.outlook && dl.outlook.body && dl.outlook.body.message;
  return `<div class="cx-previews" data-cx-delivery>
    ${dl.teams ? `<div class="cx-teams" data-cx-teams><div class="cx-ph">Teams · ${esc(dl.teams.channel)}</div><div class="cx-card">${cardRender(dl.teams.body)}</div></div>` : ''}
    ${mail ? `<div class="cx-mail" data-cx-mail><div class="cx-ph">Outlook</div><div class="cx-mh"><div><span>To</span> ${esc((dl.outlook.to || []).join(', '))}</div><div><span>Subject</span> <b>${esc(mail.subject)}</b></div></div>
      <div class="cx-mb">${cardRender(dl.teams ? dl.teams.body : { attachments: [{ content: { body: [{ type: 'TextBlock', text: dl.title, weight: 'Bolder' }] } }] })}</div></div>` : ''}
    <div class="hint">${esc((dl.results || []).map(r => r.detail).join(' '))}${dl.enabled === false ? ' This message type is switched off in the settings, so it would not be sent.' : ''}</div></div>`;
}

function connectedHTML(c) {
  const sync = S(), T = sync.TOOLS[c.tool], p = projectOf(c.projectId);
  if (!p) return `<div class="card"><h3>Connection</h3><div class="empty">The connected project was deleted. <button class="btn sm danger" data-cx-disconnect="${esc(c.id)}">Disconnect</button></div></div>`;
  const can = canWork(p);
  const canDrop = store.state.me === p.owner || store.state.me === c.createdBy;
  const last = c.lastSync;
  const n = c.notify || {};
  const dests = [n.teams && n.teams.on ? 'Teams “' + n.teams.channel + '”' : '', n.outlook && n.outlook.on ? 'Outlook (' + (n.outlook.to || []).length + ')' : ''].filter(Boolean).join(' and ') || 'nobody yet';
  const dl = ui.delivery && ui.delivery.cid === c.id ? ui.delivery.d : (c.deliveries || [])[0];
  return `<div class="card cx-conn" data-cx-conn="${esc(c.id)}">
      <div class="cx-ch1"><span class="cx-logo cx-${esc(c.tool)}" aria-hidden="true">${c.tool === 'jira' ? 'J' : 'A'}</span>
        <div class="cx-ct"><div class="cx-title"><a href="${link('/project/' + encodeURIComponent(p.id))}" data-link>${esc(p.name)}</a> ⇄ ${esc(T.simName)} · ${esc(c.projectKey)}</div>
        <div class="hint">${esc(c.site)} · ${last ? `Last synced ${esc(fmtTime(last.at))} by ${esc(pname(last.by))}` : 'Not synced yet'} · ${truthLine(p.id)}</div></div></div>
      ${ui.result && ui.result.cid === c.id ? resultHTML(ui.result) : ''}
      <div class="cx-actions"><button class="btn primary" data-cx-sync="${esc(c.id)}" ${can && !ui.busy ? '' : 'disabled'}>${ui.busy ? 'Syncing…' : 'Sync now'}</button>
        <button class="btn" data-cx-edit="${esc(c.id)}" ${can ? '' : 'disabled'}>Settings</button>
        <button class="btn danger" data-cx-disconnect="${esc(c.id)}" ${canDrop ? '' : 'disabled'}>Disconnect</button></div>
      ${!can ? `<div class="hint" data-cx-perm>${esc(teamHint(p))}</div>` : !canDrop ? `<div class="hint">Only ${esc(pname(p.owner))} (project manager) or ${esc(pname(c.createdBy))} can disconnect.</div>` : ''}
    </div>
    <div class="cx-cols">
      <div class="card"><h3>${esc(T.simName)} <span class="sim">simulated</span></h3>
        <p class="hint" style="margin:0 0 8px">This is what your team sees in ${esc(T.name)}. Change a status here, as the person it is assigned to would in ${esc(T.name)}: it flows back to PMOFlow, the project status updates, and History records it under their ${esc(T.name)} identity. A Done never closes a problem or makes information available on its own: those wait in review until the retest passes or the information’s owner confirms it.</p>
        ${simHTML(c, p)}</div>
      <div class="card"><h3>Sync log <span class="n">${(c.log || []).length}</span></h3>${logHTML(c)}
        <details class="cx-adv"><summary>Security checks</summary>
          <p class="hint">Every change is a signed instruction that expires after 5 minutes and can be used once. Try it:</p>
          <div class="cx-actions"><button class="btn sm" data-cx-replay="${esc(c.id)}">Test replay protection</button>
          <button class="btn sm" data-cx-rotate="${esc(c.id)}" ${can ? '' : 'disabled'}>Rotate signing key (now key ${esc(c.kid || 1)})</button></div></details></div>
    </div>
    <div class="card cx-ncard"><h3>Notifications</h3>
      <div class="hint" style="margin-bottom:8px">Going to ${esc(dests)}. Messages: ${esc(sync.EVENTS.filter(e => (n.events || {})[e]).map(e => sync.EVENT_LABELS[e].toLowerCase()).join(', ') || 'none')}.</div>
      <div class="cx-actions">${sync.EVENTS.map(e => `<button class="btn sm" data-cx-notify="${e}" data-cid="${esc(c.id)}">Preview: ${esc(sync.EVENT_LABELS[e].toLowerCase())}</button>`).join('')}</div>
      ${deliveryHTML(dl)}</div>
    ${activityCard('connection:' + c.id)}`;
}

/* ---------- render ---------- */
export function render() {
  if (!needSync()) return `<section class="hdr"><div><h1>Connections</h1><p>Loading…</p></div></section>`;
  const list = conns();
  const sel = list.find(c => c.id === ui.sel) || list[0] || null;
  if (sel) ui.sel = sel.id;
  const intro = `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> › Connections</div><h1>Connections</h1>
      <p>Already using Jira or Azure DevOps? Keep your workflow. PMOFlow syncs both ways, and tells people in Teams or Outlook when something needs them. No migration project: connect what you have, or don’t. Your keys stay in your company’s Azure; PMOFlow never stores them.</p></div>
    <div class="hdr-side">${!ui.wizard ? '<button class="btn primary" data-cx-start>+ Connect a project</button>' : ''}</div></section>`;
  const picker = list.length > 1 ? `<div class="cx-pick" role="tablist">${list.map(c => `<button role="tab" aria-selected="${c.id === ui.sel}" class="${c.id === ui.sel ? 'on' : ''}" data-cx-pick="${esc(c.id)}">${esc((projectOf(c.projectId) || {}).name || c.projectId)}</button>`).join('')}</div>` : '';
  const empty = !list.length && !ui.wizard ? `<div class="card cx-empty" data-cx-empty><h3>Nothing connected, and that’s fine</h3>
      <p data-cx-standalone><b>You don’t need to connect anything. PMOFlow runs the whole project on its own.</b></p>
      <p>Already using Jira or Azure DevOps? Keep your workflow. PMOFlow syncs both ways: it creates the project’s tasks there, keeps titles, status and owners the same in both places, and keeps due dates and dependencies the way you planned them.</p>
      <button class="btn primary" data-cx-start>Connect a project</button> <span class="sim">Demo: uses a simulated Jira inside your sandbox</span></div>` : '';
  return `<div class="cx">${intro}${ui.wizard ? wizardHTML(ui.wizard) : ''}${empty}${picker}${sel ? connectedHTML(sel) : ''}</div>`;
}

export function bind(root) {
  if (!S()) return;
  const showErr = (msg) => { const e = root.querySelector('[data-cx-err]'); if (e) { e.hidden = false; e.textContent = msg; } else toast(msg); };
  const rerender = () => window.dispatchEvent(new Event('pmo:route'));
  root.querySelectorAll('[data-cx-start]').forEach(b => b.onclick = () => { ui.wizard = newDraft(); ui.result = null; rerender(); });

  /* wizard */
  const w = root.querySelector('[data-cx-wizard]');
  if (w && ui.wizard) {
    const d = ui.wizard;
    w.querySelectorAll('[data-cx-tool]').forEach(b => b.onclick = () => { readSettings(w, d); ui.wizard = toolDefaults(d, b.dataset.cxTool); rerender(); });
    const prj = w.querySelector('[data-cx="projectId"]');
    if (prj) prj.onchange = () => { d.projectId = prj.value; ui.wizard = toolDefaults(d, d.tool); rerender(); };
    const ch = w.querySelector('[data-cx-ch]'), sec = w.querySelector('[data-cx-secret]');
    if (ch && sec) ch.oninput = () => { sec.textContent = S().teamsSecretName(ch.value || 'channel'); };
    w.querySelector('[data-cx-cancel]').onclick = () => { ui.wizard = null; rerender(); };
    const back = w.querySelector('[data-cx-back]'); if (back) back.onclick = () => { readSettings(w, d); d.step--; rerender(); };
    w.querySelector('[data-cx-next]').onclick = async (ev) => {
      readSettings(w, d);
      const p = projectOf(d.projectId);
      const v = S().validateSettings(settingsPayload(d), { projects: store.list('project').map(x => x.id), statuses: ((p && p.statuses) || []).map(s => s.id) });
      const stepErr = d.step === 1 ? v.errors.filter(e => /^Choose the PMOFlow project|doesn’t exist|^Choose Jira/.test(e)) : d.step === 2 ? v.errors.filter(e => /site|organization|project key|project name/i.test(e)) : v.errors;
      if (stepErr.length) return showErr(stepErr[0]);
      if (d.step < 3) { d.step++; return rerender(); }
      ev.target.disabled = true; ev.target.textContent = 'Connecting…';
      try {
        const r = await cx('POST', '', settingsPayload(d));
        ui.wizard = null; ui.sel = r.connection.id;
        ui.result = Object.assign({ cid: r.connection.id, title: 'Connected.' }, r.sync || {});
        await store.load();
        toast('Connected to ' + S().TOOLS[d.tool].simName);
      } catch (e) { ev.target.disabled = false; ev.target.textContent = 'Connect and sync'; showErr(e.message); }
    };
  }

  root.querySelectorAll('[data-cx-pick]').forEach(b => b.onclick = () => { ui.sel = b.dataset.cxPick; ui.result = null; rerender(); });

  /* connected actions */
  root.querySelectorAll('[data-cx-sync]').forEach(b => b.onclick = async () => {
    const cid = b.dataset.cxSync; ui.busy = true; rerender();
    try { const r = await cx('POST', `/${encodeURIComponent(cid)}/sync`); ui.result = Object.assign({ cid, title: 'Synced.' }, r); }
    catch (e) { ui.result = { cid, error: e.message }; }
    ui.busy = false; await store.load();
  });
  root.querySelectorAll('[data-cx-simstatus]').forEach(sel => sel.onchange = async () => {
    const c = conns().find(x => x.id === ui.sel); if (!c) return;
    sel.disabled = true;
    try {
      const r = await cx('POST', `/${encodeURIComponent(c.id)}/sim`, { key: sel.dataset.cxSimstatus, status: sel.value });
      ui.result = Object.assign({ cid: c.id, title: `${sel.dataset.cxSimstatus} moved to “${sel.value}” in ${S().TOOLS[c.tool].name}.` }, r);
      toast('Change came back from ' + S().TOOLS[c.tool].name);
    } catch (e) { ui.result = { cid: c.id, error: e.message }; }
    await store.load();
  });
  root.querySelectorAll('details[data-cx-tech]').forEach(dt => dt.ontoggle = () => { if (dt.open) ui.openLog.add(dt.dataset.cxTech); else ui.openLog.delete(dt.dataset.cxTech); });
  root.querySelectorAll('[data-cx-notify]').forEach(b => b.onclick = async () => {
    const cid = b.dataset.cid;
    try { const r = await cx('POST', `/${encodeURIComponent(cid)}/notify`, { event: b.dataset.cxNotify, origin: location.origin }); ui.delivery = { cid, d: r.delivery }; toast('Preview ready (demo: not sent)'); }
    catch (e) { toast(e.message); return; }
    await store.load();
  });
  root.querySelectorAll('[data-cx-replay]').forEach(b => b.onclick = async () => {
    const cid = b.dataset.cxReplay;
    try { const r = await cx('POST', `/${encodeURIComponent(cid)}/replay`); ui.result = { cid, title: 'Security check:', sentence: r.detail.replace(/\.$/, '') }; }
    catch (e) { ui.result = { cid, error: e.message }; }
    await store.load();
  });
  root.querySelectorAll('[data-cx-rotate]').forEach(b => b.onclick = async () => {
    const cid = b.dataset.cxRotate;
    try { const r = await cx('POST', `/${encodeURIComponent(cid)}/rotate`); toast('Signing key rotated (now key ' + r.connection.kid + ')'); }
    catch (e) { toast(e.message); return; }
    await store.load();
  });
  root.querySelectorAll('[data-cx-edit]').forEach(b => b.onclick = async () => {
    const c = conns().find(x => x.id === b.dataset.cxEdit); if (!c) return;
    const d = JSON.parse(JSON.stringify(c)); const p = projectOf(c.projectId);
    for (let tries = 0; tries < 5; tries++) {
      const r = await modal({ title: 'Sync settings', body: `<div class="cx-modal" data-cx-form>${settingsHTML(d, p)}</div>`, actions: [{ id: 'save', label: 'Save', primary: true }] });
      if (r.action !== 'save') return;
      readSettings(r.root, d);
      try { await cx('PUT', `/${encodeURIComponent(c.id)}`, settingsPayload(d)); toast('Settings saved'); await store.load(); return; }
      catch (e) { toast(e.message); }
    }
  });
  root.querySelectorAll('[data-cx-disconnect]').forEach(b => b.onclick = async () => {
    const c = conns().find(x => x.id === b.dataset.cxDisconnect); if (!c) return;
    const r = await modal({ title: 'Disconnect?', body: `<p style="margin:0">PMOFlow stops syncing with ${esc(S().TOOLS[c.tool].simName)}. Your PMOFlow tasks stay as they are; items already in ${esc(S().TOOLS[c.tool].name)} stay there too.</p>`, actions: [{ id: 'go', label: 'Disconnect', danger: true }] });
    if (r.action !== 'go') return;
    try { await cx('DELETE', `/${encodeURIComponent(c.id)}`); ui.result = null; ui.sel = null; ui.delivery = null; toast('Disconnected'); await store.load(); }
    catch (e) { toast(e.message); }
  });
  bindActivity(root);
}
