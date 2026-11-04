/* Release page (stream R): readiness gate, BU sign-off, project-scoped access grants, go-live + release history.
   Route: /release/:prj */
import { store } from '../store.js';
import { E, esc, fmt, fmtTime, days, addDays, link, go, av, pname, badge, chip, modal, stepUp, toast, commentsPanel, bindActivity } from '../ui.js';

/* Module state survives the router's full re-render on every store change. */
const ui = { open: new Set(), lastRelease: null, reasons: null, showRel: new Set() };

const ICON = { pass: '✓', fail: '✕', warn: '!' };
const CHECK_LINK = {
  'work-done': p => ({ href: `/project/${p}?mode=work`, label: 'Open project work' }),
  'data-live': () => null, /* per-item links to the data pages */
  'tests-passed': p => ({ href: `/testing/${p}`, label: 'Open testing' }),
  'grants-closed': () => ({ anchor: 'grants', label: 'Jump to access grants' }),
  'bu-signoff': () => ({ anchor: 'signoff', label: 'Jump to sign-off' }),
  'two-person': () => ({ anchor: 'signoff', label: 'Jump to sign-off' }),
  'exceptions': () => ({ anchor: 'signoff', label: 'Jump to sign-off' }),
};

/* ---------- derived data ---------- */
function projectProcesses(prj) { return (prj.processes || []).map(id => store.get('process', id)).filter(Boolean); }
function flat(nodes) { const e = E(); return e && e.flatSteps ? e.flatSteps(nodes || []) : (nodes || []).filter(n => n.type === 'step'); }

function projectData(prj) {
  const ids = new Set();
  projectProcesses(prj).forEach(p => flat(p.tobe && p.tobe.length ? p.tobe : p.asis).forEach(s => {
    (s.data || []).forEach(d => ids.add(d)); (s.subs || []).forEach(sb => (sb.data || []).forEach(d => ids.add(d)));
  }));
  return [...ids].map(id => store.get('dataElement', id)).filter(Boolean);
}

/* One section per BU: the to-be steps owned by people in that BU. */
function buSections(prj) {
  const map = new Map();
  projectProcesses(prj).forEach(p => flat(p.tobe && p.tobe.length ? p.tobe : p.asis).forEach(s => {
    const per = store.person(s.owner); if (!per || !per.bu) return;
    if (!map.has(per.bu)) map.set(per.bu, []);
    map.get(per.bu).push({ pid: p.id, pname: p.name, step: s });
  }));
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bu, steps]) => ({ bu, steps }));
}

function latestApproval(prjId, bu) {
  return store.list('approval', a => a.projectId === prjId && a.bu === bu).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null;
}

function readiness(prjId) {
  const e = E();
  if (!e || !e.readiness) return { pass: false, checks: [], unavailable: true };
  try { return e.readiness(store.state.docs, prjId, store.state.today); } catch (err) { console.warn(err); return { pass: false, checks: [], unavailable: true }; }
}

function checkState(c) { return c.id === 'exceptions' ? ((c.items || []).length ? 'warn' : 'pass') : (c.pass ? 'pass' : 'fail'); }

function grantStatus(g) {
  if ((g.status === 'active' || g.status === 'approved') && g.expires && g.expires < store.state.today) return 'expired';
  return g.status;
}
const GRANT_CLS = { requested: 'b-soon', approved: 'b-prog', active: 'b-done', expired: 'b-idle', revoked: 'b-idle', denied: 'b-late' };

/* Readiness items arrive as strings or small objects; render a label and a link where we can infer one. */
function itemView(item, checkId, prjId) {
  if (item == null) return { text: '' };
  if (typeof item !== 'object') {
    const s = String(item);
    if (store.get('dataElement', s)) return { text: store.get('dataElement', s).name, href: '/data/' + s };
    if (store.get('workItem', s)) { const w = store.get('workItem', s); return { text: w.title, extra: `${pname(w.owner)} · ${w.status === 'prog' ? 'in progress' : w.status === 'done' ? 'done' : 'not started'}`, href: `/project/${prjId}?mode=work` }; }
    if (store.get('testCase', s)) { const c = store.get('testCase', s); const de = store.get('dataElement', c.dataId); return { text: `${de ? de.name + ' · ' : ''}${c.field}: ${c.input === '' ? '(empty)' : c.input}`, extra: `${c.kind}, expect ${c.expect}`, href: `/testing/${prjId}` }; }
    if (store.get('grant', s)) { const g = store.get('grant', s); const de = store.get('dataElement', g.dataId); return { text: `${de ? de.name : g.dataId} · ${String(g.env).toUpperCase()} ${g.access}`, extra: g.status === 'active' ? 'active, expires at go-live' : g.status }; }
    if (store.person(s)) { const p = store.person(s); return { text: p.name, extra: `${p.role}${p.bu ? ' · ' + p.bu : ''}` }; }
    return { text: s, href: checkId === 'tests-passed' ? `/testing/${prjId}` : null };
  }
  const dataId = item.dataId || (item.type === 'dataElement' ? item.id : null);
  const workId = item.workId || (item.type === 'workItem' ? item.id : null);
  const w = workId ? store.get('workItem', workId) : null;
  const de = dataId ? store.get('dataElement', dataId) : null;
  const text = item.label || item.title || item.text || item.name || item.detail || (w && w.title) || (de && de.name) || item.bu || item.id || '';
  let href = null;
  if (checkId === 'data-live' && dataId) href = '/data/' + dataId;
  else if (checkId === 'work-done' || w) href = `/project/${prjId}?mode=work`;
  else if (checkId === 'tests-passed') href = `/testing/${prjId}`;
  else if (de) href = '/data/' + dataId;
  const extra = item.reason || item.status || (item.detail && item.detail !== text ? item.detail : '') || '';
  return { text: String(text), extra: String(extra), href };
}

/* ---------- render ---------- */
export function render(params) {
  const prjId = params.prj;
  const projects = store.list('project');
  const prj = store.get('project', prjId);
  if (!prj) {
    return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> · Release</div><h1>Release</h1>
      <p>Project not found. Pick a project to see its go-live gate.</p></div></section>
      <div class="home-grid">${projects.map(p => `<a class="tile" href="${link('/release/' + p.id)}" data-link><h4>${esc(p.name)}</h4><p>${esc(p.desc || '')}</p></a>`).join('') || '<div class="empty">No projects yet.</div>'}</div>`;
  }
  const rd = readiness(prjId);
  const failing = rd.checks.filter(c => checkState(c) === 'fail').length;
  const warns = rd.checks.filter(c => checkState(c) === 'warn').length;
  const live = prj.status === 'live';
  const releases = store.list('release', r => r.projectId === prjId).sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const gateCls = live ? 'live' : rd.pass ? 'pass' : 'blocked';
  const gateTitle = live ? 'Released' : rd.pass ? 'PASS — ready for go-live' : `Blocked — ${failing} check${failing === 1 ? '' : 's'} failing`;
  const gateSub = live ? `Live since ${fmt(releases[0] && releases[0].at)}. Every integration grant was closed at go-live.`
    : rd.unavailable ? 'Readiness engine is still loading.'
    : rd.pass ? (warns ? `All required checks pass. ${warns} warning to review.` : 'All required checks pass. Two approvers can release.')
    : 'Go-live unlocks when every check below is green.';

  const header = `<section class="hdr rl-hdr"><div>
      <div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> · <a href="${link('/project/' + prjId)}" data-link>${esc(prj.name)}</a> · Release</div>
      <div class="rl-title"><h1>Go-live readiness</h1>
        <select class="rl-switch" data-switch aria-label="Project">${projects.map(p => `<option value="${esc(p.id)}" ${p.id === prjId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <p>One view for approvers: what must be true before <b>${esc(prj.name)}</b> goes live, who has signed, and which integration access is still open.</p>
    </div>
    <div class="hdr-side"><div class="rl-gate ${gateCls}" data-gate="${gateCls}">
      <span class="rl-gate-ic">${live ? '★' : rd.pass ? ICON.pass : ICON.fail}</span>
      <div><b>${esc(gateTitle)}</b><span>${esc(gateSub)}</span></div></div>
      <div class="rl-meter" aria-label="Checks passing">${rd.checks.map(c => `<i class="${checkState(c)}" title="${esc(c.label)}"></i>`).join('')}</div>
    </div></section>`;

  /* readiness checklist */
  const checks = rd.checks.map(c => {
    const st = checkState(c); const items = c.items || [];
    const lk = (CHECK_LINK[c.id] || (() => null))(prjId);
    const key = c.id; const open = ui.open.has(key);
    const lkHtml = lk ? (lk.href ? `<a class="rl-go" href="${link(lk.href)}" data-link>${esc(lk.label)} ›</a>` : `<a class="rl-go" href="#${lk.anchor}" data-anchor="${lk.anchor}">${esc(lk.label)} ›</a>`) : '';
    return `<details class="rl-check ${st}" data-check="${esc(c.id)}" ${open ? 'open' : ''}>
      <summary><span class="rl-ic ${st}">${ICON[st]}</span>
        <div class="rl-ct"><div class="t">${esc(c.label)}</div><div class="s">${esc(c.detail || '')}</div></div>
        ${items.length ? `<span class="rl-cnt">${items.length}</span>` : ''}<span class="rl-chev">${items.length || lk ? '›' : ''}</span></summary>
      <div class="rl-items">${items.map(it => { const v = itemView(it, c.id, prjId); return `<div class="rl-item">${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : `<span>${esc(v.text)}</span>`}${v.extra ? `<small>${esc(v.extra)}</small>` : ''}</div>`; }).join('') || `<div class="hint">${st === 'pass' ? 'Nothing outstanding.' : 'No item detail.'}</div>`}
        ${lkHtml ? `<div class="rl-item-foot">${lkHtml}</div>` : ''}</div></details>`;
  }).join('') || '<div class="empty">Readiness checks are not available yet.</div>';

  return header + `<div class="grid rl-grid"><div class="rl-main">
    ${ui.reasons ? `<div class="banner rl-reasons" data-reasons><b>Go-live was refused by the server.</b><ul>${ui.reasons.map(r => `<li>${esc(typeof r === 'string' ? r : (r.label || r.detail || JSON.stringify(r)))}</li>`).join('')}</ul></div>` : ''}
    <div class="card"><h3>Readiness checklist<span class="n">${rd.checks.length - failing}/${rd.checks.length} passing</span></h3>${checks}</div>
    ${signoffCard(prj, rd)}
    ${grantsCard(prj)}
  </div>
  <aside class="side">
    ${goLiveCard(prj, rd, live)}
    ${releaseCards(prj, releases)}
    <div class="card rl-explain"><h3>How integration access works</h3>
      <p><b>Access is scoped to one data set, expires at go-live, every action is logged.</b></p>
      <ul><li>The data element's owner approves each request with step-up MFA.</li><li>Grants are for dev or UAT only and last 30 days at most.</li><li>Customer data and keys stay in the customer's tenant.</li></ul></div>
    <div class="card"><h3>Comments</h3>${commentsPanel('project:' + prjId)}</div>
    <div class="card"><h3>Gate audit log</h3><div data-rl-history><div class="hint">Loading history…</div></div></div>
  </aside></div>`;
}

function signoffCard(prj, rd) {
  const me = store.person(store.state.me) || {};
  const sections = buSections(prj);
  const approved = sections.map(s => latestApproval(prj.id, s.bu)).filter(a => a && a.decision === 'approved' && a.stepUp);
  const approvers = [...new Set(approved.map(a => a.approver))];
  const exc = (rd.checks.find(c => c.id === 'exceptions') || {}).items || [];
  const cards = sections.map(s => {
    const a = latestApproval(prj.id, s.bu);
    const mine = me.bu === s.bu;
    const eligible = store.state.people.filter(p => p.bu === s.bu);
    const state = a ? a.decision : 'pending';
    const stCls = state === 'approved' ? 'b-done' : state === 'rejected' ? 'b-late' : 'b-soon';
    return `<div class="rl-bu ${state}" data-bu="${esc(s.bu)}">
      <div class="rl-bu-h"><b>${esc(s.bu)}</b>${badge(state === 'pending' ? 'Awaiting sign-off' : state === 'approved' ? 'Signed off' : 'Rejected', stCls)}</div>
      <ol class="rl-steps">${s.steps.map(x => `<li><a href="${link(`/process/${x.pid}/step/${x.step.id}`)}" data-link>${esc(x.step.title)}</a> <small>${esc(pname(x.step.owner))} · ${esc(x.pname)}</small></li>`).join('')}</ol>
      ${a ? `<div class="rl-signed">${av(a.approver)} <span>${esc(pname(a.approver))} ${a.decision === 'approved' ? 'approved' : 'rejected'} · ${esc(fmtTime(a.at))}${a.stepUp ? ' · <span class="rl-mfa">MFA verified</span>' : ''}</span></div>${a.note ? `<div class="hint">“${esc(a.note)}”</div>` : ''}` : ''}
      ${prj.status === 'live' ? '' : `<div class="rl-bu-act">${mine
        ? `<button class="btn sm primary" data-signoff="approved" data-bu="${esc(s.bu)}">${a && a.decision === 'approved' ? 'Re-approve' : 'Approve section'}</button><button class="btn sm danger" data-signoff="rejected" data-bu="${esc(s.bu)}">Reject</button>`
        : `<button class="btn sm" disabled>Approve section</button><span class="hint" data-why>Switch 'Viewing as' to ${/^[AEIOU]/i.test(s.bu) ? 'an' : 'a'} ${esc(s.bu)} person to sign off${eligible.length ? ` (${esc(eligible.map(p => p.name).join(', '))})` : ''}.</span>`}</div>`}</div>`;
  }).join('');
  const two = approvers.length >= 2;
  return `<div class="card" id="signoff"><h3>Business-unit sign-off<span class="n">${approved.length}/${sections.length} signed</span></h3>
    <div class="rl-two ${two ? 'ok' : ''}"><span class="rl-ic ${two ? 'pass' : 'fail'}">${two ? ICON.pass : ICON.fail}</span>
      <div><b>Two-person rule</b> · ${approvers.length} distinct approver${approvers.length === 1 ? '' : 's'} ${approvers.map(av).join('')}<div class="hint">Go-live needs at least two different people to have signed off, each with step-up MFA.</div></div></div>
    ${exc.length ? `<div class="rl-exc"><b>Exceptions</b> · changed after approval<ul>${exc.map(it => { const v = itemView(it, 'exceptions', prj.id); return `<li>${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : esc(v.text)}${v.extra ? ` <small>${esc(v.extra)}</small>` : ''}</li>`; }).join('')}</ul></div>` : ''}
    <div class="rl-bus">${cards || '<div class="empty">No owned steps in the linked to-be processes yet.</div>'}</div></div>`;
}

function grantsCard(prj) {
  const me = store.state.me;
  const grants = store.list('grant', g => g.projectId === prj.id).sort((a, b) => String((b.log && b.log[0] && b.log[0].at) || '').localeCompare(String((a.log && a.log[0] && a.log[0].at) || '')));
  const rows = grants.map(g => {
    const de = store.get('dataElement', g.dataId) || { name: g.dataId, owner: null };
    const st = grantStatus(g); const isOwner = de.owner === me;
    const canRevoke = (st === 'active' || st === 'approved' || st === 'requested') && (isOwner || g.requestedBy === me || prj.owner === me);
    let acts = '';
    if (st === 'requested') acts = isOwner ? `<button class="btn sm primary" data-gact="approve" data-gid="${esc(g.id)}">Approve</button><button class="btn sm danger" data-gact="deny" data-gid="${esc(g.id)}">Deny</button>`
      : `<span class="hint">Awaiting ${esc(pname(de.owner))}</span>`;
    if (canRevoke && st !== 'requested') acts += `<button class="btn sm danger" data-gact="revoke" data-gid="${esc(g.id)}">Revoke</button>`;
    if (canRevoke && st === 'requested' && !isOwner) acts += `<button class="btn sm" data-gact="revoke" data-gid="${esc(g.id)}">Withdraw</button>`;
    const left = g.expires ? days(g.expires) : null;
    const logOpen = ui.open.has('log:' + g.id);
    return `<tr data-grant="${esc(g.id)}"><td><a href="${link('/data/' + g.dataId)}" data-link class="rl-de">${esc(de.name)}</a><div class="hint">Owner ${esc(pname(de.owner))}</div></td>
      <td><span class="chip">${esc(String(g.env || '').toUpperCase())}</span></td><td>${esc(g.access)}</td>
      <td>${av(g.requestedBy)} <span class="rl-nm">${esc(pname(g.requestedBy))}</span>${g.reason ? `<div class="hint rl-reason">${esc(g.reason)}</div>` : ''}</td>
      <td>${badge(st, GRANT_CLS[st] || 'b-idle')}</td>
      <td>${esc(fmt(g.expires))}${left != null && (st === 'active' || st === 'approved' || st === 'requested') ? `<div class="hint">${left >= 0 ? left + 'd left' : 'past'}</div>` : ''}</td>
      <td class="rl-acts">${acts}<button class="btn sm rl-linkbtn" data-glog="${esc(g.id)}">${logOpen ? 'Hide log' : 'Log'} (${(g.log || []).length})</button></td></tr>
      ${logOpen ? `<tr class="rl-logrow"><td colspan="7">${(g.log || []).map(l => `<div class="ev"><time>${esc(fmtTime(l.at))}</time><span>${av(l.by)} <b>${esc(store.person(l.by) ? pname(l.by) : l.by)}</b> ${esc(l.action)}</span></div>`).join('') || '<div class="hint">No entries.</div>'}</td></tr>` : ''}`;
  }).join('');
  const open = grants.filter(g => ['active', 'approved', 'requested'].includes(grantStatus(g))).length;
  return `<div class="card" id="grants"><h3>Integration access grants<span class="n">${open} open</span></h3>
    <div class="rl-gtools"><span class="hint">Project-scoped, time-boxed access to customer data for dev and UAT. Closed automatically at go-live.</span>
      <button class="btn sm primary" data-request ${prj.status === 'live' ? 'disabled' : ''}>Request access</button></div>
    ${grants.length ? `<div class="tbl-wrap"><table class="rl-gt"><thead><tr><th>Data element</th><th>Env</th><th>Access</th><th>Requested by</th><th>Status</th><th>Expires</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="empty">No access grants for this project yet.</div>'}</div>`;
}

function goLiveCard(prj, rd, live) {
  const procs = projectProcesses(prj);
  return `<div class="card rl-golive ${rd.pass && !live ? 'ready' : ''}"><h3>Go-live</h3>
    ${live ? `<p class="rl-p">This project is live. The to-be processes became the new as-is versions.</p>`
      : `<p class="rl-p">${rd.pass ? 'The gate passes. Releasing promotes each to-be process to the new as-is version and runs the release actions.' : 'Locked until every readiness check passes.'}</p>`}
    <div class="rl-procs">${procs.map(p => `<div><a href="${link('/process/' + p.id)}" data-link>${esc(p.name)}</a><span class="chip">v${esc(p.version || 1)}${live ? '' : ` → v${esc((p.version || 1) + 1)}`}</span></div>`).join('')}</div>
    <button class="btn primary rl-gobtn" data-golive ${rd.pass && !live ? '' : 'disabled'}>${live ? 'Released' : 'Go live'}</button>
    ${!rd.pass && !live ? `<div class="hint" style="margin-top:6px">${rd.checks.filter(c => checkState(c) === 'fail').map(c => esc(c.label)).join(' · ')}</div>` : ''}</div>`;
}

function actionView(a) {
  const det = a.detail == null ? '' : typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail, null, 2);
  const label = { pipeline: 'Deployment pipeline', 'sop-publish': 'Publish SOP', notify: 'Notify stakeholders' }[a.type] || a.type;
  return `<div class="rl-act"><div class="rl-act-h"><b>${esc(label)}</b><span class="hint">${esc(a.target || '')}</span>
    <span class="sim">Simulated</span>${badge(a.status || 'simulated-ok', 'b-done')}</div>
    ${det ? (a.type === 'pipeline' || typeof a.detail === 'object' ? `<pre class="rl-pre">${esc(det)}</pre>` : `<div class="hint">${esc(det)}</div>`) : ''}</div>`;
}

function releaseRecord(r) {
  const snap = r.snapshot || {};
  return `<div class="rl-rec" data-release="${esc(r.id)}">
    <div class="rl-rec-h"><b>${esc(fmtTime(r.at))}</b> · released by ${av(r.by)} ${esc(pname(r.by))}</div>
    <div class="rl-rec-s"><span class="lbl">Approvers</span>${(r.approvers || []).map(id => `${av(id)}<span class="rl-nm">${esc(pname(id))}</span>`).join(' ') || '—'}</div>
    <div class="rl-rec-s"><span class="lbl">Released versions</span>${Object.keys(snap).map(pid => { const p = store.get('process', pid); return `<a class="chip" href="${link('/process/' + pid)}" data-link data-ver="${esc(pid)}">${esc(p ? p.name : pid)} · v${esc(snap[pid])}</a>`; }).join(' ') || '—'}</div>
    ${(r.exceptions || []).length ? `<div class="rl-rec-s"><span class="lbl">Exceptions</span>${(r.exceptions || []).map(x => `<span class="chip">${esc(typeof x === 'string' ? x : (x.label || x.title || x.id || ''))}</span>`).join(' ')}</div>` : ''}
    <div class="rl-acts-list">${(r.actions || []).map(actionView).join('')}</div></div>`;
}

function releaseCards(prj, releases) {
  if (!releases.length) return `<div class="card"><h3>Release history</h3><div class="hint">No releases yet. The release record and its pipeline request appear here after go-live.</div></div>`;
  const latest = releases[0];
  const fresh = ui.lastRelease === latest.id;
  return `<div class="card rl-latest ${fresh ? 'fresh' : ''}"><h3>${fresh ? 'Release complete' : 'Latest release'}</h3>${releaseRecord(latest)}</div>
    <div class="card"><h3>Release history<span class="n">${releases.length}</span></h3>${releases.map(r => `<div class="row click" data-relrow="${esc(r.id)}"><div><div class="t">${esc(fmtTime(r.at))}</div><div class="s">${esc(pname(r.by))} · ${(r.actions || []).length} actions · ${Object.keys(r.snapshot || {}).length} process version${Object.keys(r.snapshot || {}).length === 1 ? '' : 's'}</div></div><div class="r">${badge('simulated-ok', 'b-done')}</div></div>${ui.showRel.has(r.id) && r.id !== latest.id ? releaseRecord(r) : ''}`).join('')}</div>`;
}

/* ---------- bind ---------- */
export function bind(root, params) {
  const prjId = params.prj;
  const prj = store.get('project', prjId);
  const sw = root.querySelector('[data-switch]');
  if (sw) sw.onchange = () => { ui.reasons = null; go('/release/' + sw.value); };
  if (!prj) return;

  root.querySelectorAll('details[data-check]').forEach(d => d.addEventListener('toggle', () => { d.open ? ui.open.add(d.dataset.check) : ui.open.delete(d.dataset.check); }));
  root.querySelectorAll('[data-anchor]').forEach(a => a.onclick = e => { e.preventDefault(); const t = root.querySelector('#' + a.dataset.anchor); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  /* BU sign-off */
  root.querySelectorAll('[data-signoff]').forEach(b => b.onclick = async () => {
    const bu = b.dataset.bu, decision = b.dataset.signoff;
    let note = '';
    if (decision === 'rejected') {
      const r = await modal({ title: `Reject the ${bu} section`, body: `<div class="field"><label>Reason</label><textarea name="note" placeholder="What needs to change before you can sign off?"></textarea></div>`, actions: [{ id: 'reject', label: 'Reject', danger: true }] });
      if (r.action !== 'reject') return; note = r.form.note || '';
    }
    if (!(await stepUp(`${decision === 'approved' ? 'approve' : 'reject'} the ${bu} section`))) { toast('Step-up not completed. Nothing was signed.'); return; }
    const id = store.newId('apr');
    await store.save('approval', id, { id, projectId: prjId, bu, approver: store.state.me, decision, at: new Date().toISOString(), stepUp: true, note },
      `${decision === 'approved' ? 'Approved' : 'Rejected'} the ${bu} section of ${prj.name} (step-up verified)`);
    await store.notify([prj.owner], `${pname(store.state.me)} ${decision} the ${bu} section of ${prj.name}`, 'approval:' + id);
    toast(`${bu} section ${decision}`);
  });

  /* Grants */
  const rq = root.querySelector('[data-request]');
  if (rq) rq.onclick = () => requestAccess(prj);
  root.querySelectorAll('[data-glog]').forEach(b => b.onclick = () => { const k = 'log:' + b.dataset.glog; ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k); store.emit(); });
  root.querySelectorAll('[data-gact]').forEach(b => b.onclick = () => grantAction(prj, b.dataset.gid, b.dataset.gact));

  /* Go-live */
  const gl = root.querySelector('[data-golive]');
  if (gl) gl.onclick = () => goLive(prj);
  root.querySelectorAll('[data-relrow]').forEach(r => r.onclick = () => { const id = r.dataset.relrow; ui.showRel.has(id) ? ui.showRel.delete(id) : ui.showRel.add(id); store.emit(); });

  bindActivity(root);
  bindAudit(root, prj);
}

async function bindAudit(root, prj) {
  const box = root.querySelector('[data-rl-history]'); if (!box) return;
  const refs = new Set(['project:' + prj.id]);
  ['grant', 'approval', 'release'].forEach(t => store.list(t, d => d.projectId === prj.id).forEach(d => refs.add(t + ':' + d.id)));
  (prj.processes || []).forEach(p => refs.add('process:' + p));
  const evs = (await store.events(null, 100)).filter(e => refs.has(e.ref) && (e.action !== 'update' || !String(e.ref).startsWith('process:'))).slice(0, 12);
  box.innerHTML = evs.length ? evs.map(e => `<div class="ev"><time>${esc(fmtTime(e.at))}</time><span>${av(e.actor)} <b>${esc(pname(e.actor))}</b> ${esc(e.summary || e.action)}</span></div>`).join('') : '<div class="hint">No gate activity yet.</div>';
}

async function requestAccess(prj) {
  const des = projectData(prj);
  if (!des.length) { toast('This project uses no data elements yet.'); return; }
  const today = store.state.today, max = addDays(today, 30);
  const r = await modal({
    title: 'Request integration access',
    body: `<div class="field"><label>Data element</label><select name="dataId">${des.map(d => `<option value="${esc(d.id)}">${esc(d.name)} — owner ${esc(pname(d.owner))}</option>`).join('')}</select></div>
      <div class="frow"><div class="field"><label>Environment</label><select name="env"><option value="dev">Dev</option><option value="uat">UAT</option></select></div>
      <div class="field"><label>Access</label><select name="access"><option value="read">Read</option><option value="write">Write</option></select></div></div>
      <div class="field"><label>Reason</label><textarea name="reason" placeholder="What the integration needs this data for"></textarea></div>
      <div class="field"><label>Expires (max 30 days)</label><input type="date" name="expires" value="${addDays(today, 14)}" min="${today}" max="${max}"></div>
      <div class="hint">Only data elements used by this project's processes can be requested. The data owner approves with step-up MFA.</div>`,
    actions: [{ id: 'send', label: 'Send request', primary: true }],
  });
  if (r.action !== 'send') return;
  const f = r.form;
  if (!f.reason || !f.reason.trim()) { toast('Add a reason so the data owner can decide.'); return; }
  if (!f.expires || f.expires < today || f.expires > max) { toast('Expiry must be within the next 30 days.'); return; }
  const de = store.get('dataElement', f.dataId);
  const id = store.newId('grt'); const me = store.state.me;
  await store.save('grant', id, { id, projectId: prj.id, dataId: f.dataId, env: f.env, access: f.access, reason: f.reason.trim(), requestedBy: me, status: 'requested', expires: f.expires, log: [{ at: new Date().toISOString(), by: me, action: `requested ${f.access} access in ${f.env.toUpperCase()}` }] },
    `Requested ${f.access} access to ${de ? de.name : f.dataId} (${f.env.toUpperCase()}) for ${prj.name}`);
  if (de) await store.notify([de.owner], `${pname(me)} requested ${f.access} access to ${de.name} (${f.env.toUpperCase()}) for ${prj.name}`, 'grant:' + id);
  toast('Access requested. ' + (de ? pname(de.owner) + ' has been notified.' : ''));
}

async function grantAction(prj, gid, act) {
  const g = store.get('grant', gid); if (!g) return;
  const de = store.get('dataElement', g.dataId) || { name: g.dataId };
  const me = store.state.me;
  if ((act === 'approve' || act === 'deny') && de.owner !== me) { toast(`Only the data owner (${pname(de.owner)}) can decide this request.`); return; }
  let status, verb;
  if (act === 'approve') {
    if (!(await stepUp(`approve ${g.access} access to ${de.name}`))) { toast('Step-up not completed. Access not granted.'); return; }
    status = 'active'; verb = 'approved (step-up verified); access active';
  } else if (act === 'deny') { status = 'denied'; verb = 'denied'; }
  else {
    const r = await modal({ title: 'Revoke access?', body: `<p style="margin:0">${esc(de.name)} · ${esc(String(g.env).toUpperCase())} · ${esc(g.access)}. The integration loses access immediately.</p>`, actions: [{ id: 'revoke', label: 'Revoke', danger: true }] });
    if (r.action !== 'revoke') return; status = 'revoked'; verb = 'revoked';
  }
  const next = Object.assign({}, g, { status, log: [...(g.log || []), { at: new Date().toISOString(), by: me, action: verb }] });
  if (act === 'approve') next.approvedBy = me;
  await store.save('grant', gid, next, `Access to ${de.name} (${String(g.env).toUpperCase()}) ${verb}`);
  if (act !== 'revoke' || g.requestedBy !== me) await store.notify([g.requestedBy], `${pname(me)} ${verb.split(' ')[0]} your ${g.access} access to ${de.name}`, 'grant:' + gid);
  toast(`Access ${status}`);
}

async function goLive(prj) {
  const rd = readiness(prj.id);
  if (!rd.pass) { toast('The gate is not passing yet.'); return; }
  const procs = projectProcesses(prj);
  const sections = buSections(prj);
  const approvers = [...new Set(sections.map(s => latestApproval(prj.id, s.bu)).filter(a => a && a.decision === 'approved').map(a => a.approver))];
  const openGrants = store.list('grant', g => g.projectId === prj.id && ['active', 'approved'].includes(grantStatus(g))).length;
  const r = await modal({
    title: `Release ${prj.name}`,
    body: `<div class="rl-sum">
      <div><span class="lbl">Processes promoted</span>${procs.map(p => `<div>${esc(p.name)} <b>v${esc(p.version || 1)} → v${esc((p.version || 1) + 1)}</b></div>`).join('')}</div>
      <div><span class="lbl">Signed off by</span>${approvers.map(id => `<div>${av(id)} ${esc(pname(id))}</div>`).join('')}</div>
      <div><span class="lbl">Access</span><div>${openGrants} open grant${openGrants === 1 ? '' : 's'} will expire now</div></div>
      <div><span class="lbl">Release actions</span><div>Trigger the deployment pipeline · publish the new SOP · notify stakeholders</div></div></div>
      <span class="sim">Simulated: in this showroom the pipeline trigger is recorded, not sent.</span>`,
    actions: [{ id: 'go', label: 'Continue to verify', primary: true }],
  });
  if (r.action !== 'go') return;
  if (!(await stepUp('release to production'))) { toast('Step-up not completed. Nothing was released.'); return; }
  try {
    const res = await store.api('/golive/' + prj.id);
    ui.reasons = null;
    await store.load();
    const rel = (res && (res.release || (res.data && res.data.projectId ? res.data : null) || (res.projectId ? res : null))) || null;
    const latest = store.list('release', x => x.projectId === prj.id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    ui.lastRelease = (rel && rel.id) || (latest && latest.id) || null;
    store.emit();
    toast(`${prj.name} is live`);
  } catch (e) {
    if (e.status === 409) { ui.reasons = (e.body && e.body.reasons && e.body.reasons.length) ? e.body.reasons : [e.message]; store.emit(); toast('Go-live refused. See the reasons above the checklist.'); }
    else toast('Go-live failed: ' + e.message);
  }
}
