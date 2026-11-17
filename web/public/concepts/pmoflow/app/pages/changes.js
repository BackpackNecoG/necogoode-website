/* PMOFlow R10.2 stream C: traceable plan changes (UI).
   Standalone route: /project/:prj/changes  (render/bind). For the project page to embed:
     openChangeWizard(projectId, preset)   "Change the plan" wizard: what + why → edits → impact preview → apply / send for approval
     renderChangesSection(projectId)       drift banner + "waiting for your decision" + the change log (call bindChangesSection(root) after)
     taskChangesHTML(taskId)               "Changed 2 times" line with links, for a task's editor/drawer
   Logic lives in window.PMOChange (app/change.js, byte-identical to api/shared/pmoflow-change.js); every number in the
   preview comes from running window.PMOEngine on the docs before and after the change. Writes go through
   /api/pmoflow/workspaces/:ws/changes (api/shared/pmoflow-routes-change.js), which writes each edit through the doc store. */
import { store } from '../store.js';
import { esc, fmt, fmtTime, link, toast, drawer, av, pname, modal, activityCard, bindActivity } from '../ui.js';

const C = () => window.PMOChange;
const E = () => window.PMOEngine;
const money = n => (n == null || !isFinite(n) ? '—' : (n < 0 ? '−' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US'));
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const STATUS_CLS = { proposed: 'b-soon', approved: 'b-prog', applied: 'b-done', rejected: 'b-late' };
const openIds = new Set();   /* expanded log entries survive re-renders */

/* ---------------------------------------------------------------- assets (until the lead adds them to index.html) */
let assetsP = null;
export function ensureAssets() {
  if (!document.querySelector('link[data-chg-css],link[href$="/css/change.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = link('/app/css/change.css'); l.setAttribute('data-chg-css', ''); document.head.appendChild(l);
  }
  if (window.PMOChange) return Promise.resolve();
  if (!assetsP) assetsP = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = link('/app/change.js'); s.onload = () => resolve(); s.onerror = () => { assetsP = null; reject(new Error('change.js did not load')); };
    document.head.appendChild(s);
  });
  return assetsP;
}

/* ---------------------------------------------------------------- server */
async function api(method, path, body) {
  const t = store.state.today;
  const url = `/api/pmoflow/workspaces/${encodeURIComponent(store.state.ws)}/changes${path || ''}` + (method === 'GET' ? (path && path.includes('?') ? '&' : '?') + 'today=' + t : '');
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(Object.assign({ today: t, actor: store.state.me }, body || {})) });
  const ct = r.headers.get('content-type') || '';
  const j = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
  if (!r.ok) { const e = new Error((j && j.error) || 'HTTP ' + r.status); e.status = r.status; e.body = j; throw e; }
  return j;
}
/* the process reference each project's drift banner compares against (server-side: last applied change, else the seed) */
const refCache = {};
function refKey(prj) { return store.state.ws + '|' + prj + '|' + C().changesOf(store.state.docs, prj).filter(c => c.status === 'applied').length; }
async function refsOf(prj) {
  const k = refKey(prj);
  if (!refCache[k]) refCache[k] = api('GET', '?project=' + encodeURIComponent(prj)).then(j => (j.refs || {})[prj] || {}).catch(() => { delete refCache[k]; return null; });
  return refCache[k];
}

/* ---------------------------------------------------------------- small views */
const projectOf = id => store.get('project', id);
const tasksOf = prj => store.list('workItem', w => w.projectId === prj).sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')) || String(a.title).localeCompare(String(b.title)));
const statusBadge = c => `<span class="badge ${STATUS_CLS[c.status] || 'b-idle'}" data-chg-status="${esc(c.status)}">${esc(C().STATUS_LABEL[c.status] || c.status)}</span>`;
const changeHref = c => `/project/${encodeURIComponent(c.projectId)}/changes?change=${encodeURIComponent(c.id)}`;
const catLabel = id => (C().CATEGORIES.find(x => x.id === id) || {}).label || '';

function deltaDays(a, b) { return a && b && a !== b ? E().businessDaysBetween(a, b) : 0; }
function impactDetailsHTML(im, opts) {
  opts = opts || {};
  if (!im) return '<div class="hint">No impact was recorded.</div>';
  const fd = deltaDays(im.finish.before, im.finish.after);
  const pn = id => esc(pname(id));
  const pjName = id => esc((projectOf(id) || {}).name || 'another project');
  const ko = im.knockOn || [];
  const cost = im.cost || {};
  const tile = (lbl, before, after, note, attr) => `<div class="chg-tile" ${attr || ''}><span class="lbl">${lbl}</span><b>${before === after ? esc(after) : `${esc(before)} <span aria-hidden="true">→</span><span class="sr"> to </span> ${esc(after)}`}</b>${note ? `<span class="hint">${note}</span>` : ''}</div>`;
  return `<div class="chg-tiles">
      ${tile('Expected finish', fmt(im.finish.before), fmt(im.finish.after), fd ? `${fd > 0 ? '+' : '−'}${plural(Math.abs(fd), 'business day')}` : 'no change', 'data-imp-finish')}
      ${tile('Deadline', fmt(im.deadline.before), fmt(im.deadline.after), im.buffer.after == null ? '' : im.buffer.after >= 0 ? `${plural(im.buffer.after, 'business day')} to spare` : `<span class="fail">${plural(-im.buffer.after, 'business day')} late</span>`, 'data-imp-deadline')}
      ${tile('Expected cost', money(cost.before), money(cost.after), cost.delta ? `${cost.delta > 0 ? '+' : '−'}${money(Math.abs(cost.delta))} (${Math.abs(cost.pct).toFixed(1)}%)` : 'no change', 'data-imp-cost')}
      ${im.budget && im.budget.moved ? tile('Budget', money(im.budget.before), money(im.budget.after), '', 'data-imp-budget') : ''}
    </div>
    <div class="chg-lists">
      <div class="chg-list" data-imp-knock><h4>Tasks that move as a knock-on <span class="n">${im.knockOnCount || 0}</span></h4>${ko.length ? `<ul>${ko.map(k => `<li><span>${esc(k.title)}${k.projectId !== im.projectId ? ` <small class="hint">(${pjName(k.projectId)})</small>` : ''}${k.dependent ? ' <small class="chip">waits on it</small>' : ''}</span><span class="hint">${pn(k.owner)} · ${esc(fmt(k.from))} → <b class="${k.lateAfter ? 'fail' : ''}">${esc(fmt(k.to))}</b></span></li>`).join('')}</ul>` : '<div class="hint">None. No other task moves.</div>'}</div>
      <div class="chg-list" data-imp-people><h4>People affected <span class="n">${(im.people || []).length}</span></h4>${(im.people || []).length ? `<ul>${im.people.map(p => `<li><span>${av(p.id)} ${esc(p.name)}</span><span class="hint">${esc(p.why.join('; '))}</span></li>`).join('')}</ul>` : '<div class="hint">Nobody.</div>'}</div>
      <div class="chg-list" data-imp-approvals><h4>Department approvals that reopen <span class="n">${(im.approvalsReopen || []).length}</span></h4>${(im.approvalsReopen || []).length ? `<ul>${im.approvalsReopen.map(a => `<li><span>${esc(a.bu)}</span><span class="hint">${a.approverName ? esc(a.approverName) + ' approves again' : 'needs approval again'}</span></li>`).join('')}</ul>` : '<div class="hint">None. Every approval stays valid.</div>'}</div>
      <div class="chg-list" data-imp-tests><h4>Tests to run again <span class="n">${im.testsRerunCount || 0}</span></h4>${(im.testsRerun || []).length ? `<ul>${im.testsRerun.map(t => `<li><span>${esc(t.label)}</span></li>`).join('')}</ul>${opts.testsNote === false ? '' : '<div class="hint">Passed tests on the information used by the steps whose work changed.</div>'}` : '<div class="hint">None.</div>'}</div>
    </div>`;
}
function editsListHTML(c) {
  const ed = (c.edits || []);
  if (!ed.length) return '<div class="hint">No edits.</div>';
  return `<ul class="chg-edits" data-chg-edits>${ed.map(e => `<li class="${e.auto ? 'auto' : ''}">${esc(C().editText(e, store.state.docs, E()))}${e.auto ? ' <small class="hint">(automatic)</small>' : ''}</li>`).join('')}</ul>`;
}
function decisionsHTML(c) {
  const rows = [`<li>${av(c.requestedBy)} <span><b>${esc(pname(c.requestedBy))}</b> proposed it · ${esc(fmtTime(c.requestedAt))}</span></li>`];
  (c.approvers || []).forEach(a => rows.push(`<li>${av(a.person)} <span><b>${esc(pname(a.person))}</b> (${esc(C().ROLE_LABEL[a.role])}) ${a.decision ? `${a.decision === 'approved' ? 'approved' : 'rejected'}${a.note ? ': “' + esc(a.note) + '”' : ''} · ${esc(fmtTime(a.at))}` : '<i>has not decided yet</i>'}</span></li>`));
  if (c.appliedAt) rows.push(`<li>${av(c.appliedBy)} <span>Applied by <b>${esc(pname(c.appliedBy))}</b> · ${esc(fmtTime(c.appliedAt))}</span></li>`);
  return `<ul class="chg-trail" data-chg-trail>${rows.join('')}</ul>`;
}
function entryHTML(c, open) {
  const me = store.state.me;
  const canDecide = c.status === 'proposed' && C().pendingApprovers(c).some(a => a.person === me);
  const wait = c.status === 'proposed' ? C().waitingText(c, store.state.docs) : '';
  const tol = c.tolerance ? (c.tolerance.within ? '<span class="chip chg-ok">Within tolerance</span>' : `<span class="chip chg-over" title="${esc(c.tolerance.reasons.join(' '))}">Needed approval</span>`) : '';
  return `<details class="chg-entry" data-chg="${esc(c.id)}" ${open || openIds.has(c.id) ? 'open' : ''}>
    <summary><div class="chg-sum"><div class="chg-sum-t"><b data-chg-title>${esc(c.title)}</b>${statusBadge(c)}${tol}</div>
      <div class="chg-sum-s">“${esc(c.reason)}”${c.category ? ` · ${esc(catLabel(c.category))}` : ''} · ${esc(pname(c.requestedBy))} · ${esc(fmtTime(c.requestedAt))}</div>
      ${c.impact ? `<div class="chg-sum-i" data-chg-sentence>${esc(c.impact.sentence)}</div>` : ''}
      ${wait ? `<div class="chg-sum-w" data-chg-waiting>${esc(wait)}.</div>` : ''}${c.applyError ? `<div class="banner" style="margin:6px 0 0">${esc(c.applyError)}</div>` : ''}</div></summary>
    <div class="chg-body">
      ${canDecide ? `<div class="chg-decide" data-chg-decide-box><span>You decide this change as ${esc(C().pendingApprovers(c).filter(a => a.person === me).map(a => C().ROLE_LABEL[a.role]).join(' and '))}.</span><span class="chg-acts"><button class="btn primary" data-chg-approve="${esc(c.id)}">Approve and apply</button><button class="btn danger" data-chg-reject="${esc(c.id)}">Reject</button></span></div>` : ''}
      ${c.status === 'approved' ? `<div class="chg-decide"><span>Approved but not applied yet.</span><span class="chg-acts"><button class="btn primary" data-chg-apply="${esc(c.id)}">Apply now</button></span></div>` : ''}
      <h4>What changes</h4>${editsListHTML(c)}
      <h4>Impact ${c.status === 'applied' ? 'when it was applied' : c.status === 'rejected' ? 'it would have had' : 'if applied'}</h4>${impactDetailsHTML(c.impact)}
      ${c.tolerance && !c.tolerance.within ? `<div class="hint chg-why">Why it needed approval: ${esc(c.tolerance.reasons.join(' '))}</div>` : ''}
      <h4>Decisions</h4>${decisionsHTML(c)}
      ${c.status === 'applied' ? `<div class="chg-plans" data-chg-plans><span>Saved plans: <b>${esc((c.baselines || {}).beforeLabel || 'before')}</b> and <b>${esc((c.baselines || {}).afterLabel || 'after')}</b></span><button class="btn sm" data-chg-compare="${esc(c.id)}">Compare before and after</button></div>` : c.status === 'rejected' ? '<div class="hint" data-chg-nothing>Rejected, so nothing in the plan changed.</div>' : ''}
    </div></details>`;
}

/* ---------------------------------------------------------------- the section the project page embeds */
export function renderChangesSection(projectId, opts) {
  opts = opts || {};
  if (!C()) return `<section class="card chg-section" data-changes-section="${esc(projectId)}"><div class="hint">Loading plan changes…</div></section>`;
  const j = projectOf(projectId);
  if (!j) return '';
  const all = C().changesOf(store.state.docs, projectId);
  const me = store.state.me;
  const mine = all.filter(c => c.status === 'proposed' && C().pendingApprovers(c).some(a => a.person === me));
  const focus = opts.focus || null;
  return `<section class="chg-section" data-changes-section="${esc(projectId)}">
    <div data-chg-drift="${esc(projectId)}"></div>
    ${mine.length ? `<div class="card chg-waiting" data-chg-mine><h3>Waiting for your decision <span class="n">${mine.length}</span></h3>${mine.map(c => `<a class="row click" href="${link(changeHref(c))}" data-link data-chg-goto="${esc(c.id)}"><div><div class="t">${esc(c.title)}</div><div class="s">${esc(c.impact ? c.impact.sentence : c.reason)}</div></div></a>`).join('')}</div>` : ''}
    <div class="card chg-log" data-chg-log><div class="chg-log-h"><h3>Plan changes <span class="n" data-chg-count>${all.length}</span></h3>
      <span class="chg-acts">${opts.standalone ? `<button class="btn sm primary" data-chg-open="${esc(projectId)}">Change the plan</button>` : ''}${all.length ? `<button class="btn sm" data-chg-csv="${esc(projectId)}">Export CSV</button>` : ''}</span></div>
      ${all.length ? all.map(c => entryHTML(c, c.id === focus)).join('') : '<div class="empty" data-chg-none>No plan changes yet. When dates, owners, work, scope, budget or the deadline change, use “Change the plan” so the reason and the impact are kept.</div>'}</div>
  </section>`;
}

export function bindChangesSection(root, projectId) {
  if (!C()) { ensureAssets().then(() => window.dispatchEvent(new Event('pmo:route'))).catch(() => {}); return; }
  const on = (sel, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(el); }));
  on('[data-chg-open]', el => openChangeWizard(el.dataset.chgOpen));
  on('[data-chg-csv]', el => exportCSV(el.dataset.chgCsv));
  on('[data-chg-approve]', el => decide(el.dataset.chgApprove, 'approve', el));
  on('[data-chg-reject]', el => decide(el.dataset.chgReject, 'reject', el));
  on('[data-chg-apply]', el => applyNow(el.dataset.chgApply, el));
  on('[data-chg-compare]', el => compare(el.dataset.chgCompare));
  root.querySelectorAll('details[data-chg]').forEach(d => d.addEventListener('toggle', () => { if (d.open) openIds.add(d.dataset.chg); else openIds.delete(d.dataset.chg); }));
  /* process changed mid-project: the banner needs the server's reference */
  root.querySelectorAll('[data-chg-drift]').forEach(async box => {
    const prj = box.dataset.chgDrift;
    const refs = await refsOf(prj);
    if (!refs || !box.isConnected) return;
    const n = { i: 0 };
    const dr = C().processDrift(store.state.docs, prj, refs, store.state.today, { engine: E(), newId: () => store.newId('wi') + (n.i++) });
    if (!dr.changed) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="banner chg-drift" data-chg-drift-banner role="status"><span>${esc(dr.text)}</span><button class="btn primary" data-chg-update>Update the plan</button></div>`;
    box.querySelector('[data-chg-update]').addEventListener('click', () => openChangeWizard(prj, {
      kinds: ['scope'], source: 'process', category: 'scope', suggestions: dr.suggestions, ackSteps: dr.ackSteps,
      reason: 'The process changed: ' + dr.steps.map(s => s.title).concat(dr.removed.map(s => 'removed ' + s.title)).slice(0, 3).join(', ') }));
  });
}
/* one line for a task's editor or drawer: "Changed 2 times: …" (empty when never changed) */
export function taskChangesHTML(taskId) {
  if (!C()) return '';
  const list = C().changesForTask(store.state.docs, taskId);
  if (!list.length) return '';
  return `<div class="chg-task" data-chg-task="${esc(taskId)}"><b>Changed ${plural(list.length, 'time')}</b>: ${list.map(c => `<a href="${link(changeHref(c))}" data-link>${esc(c.title)}</a> <span class="hint">(${esc(fmt(String(c.appliedAt || c.requestedAt).slice(0, 10)))}, ${esc((C().STATUS_LABEL[c.status] || '').toLowerCase())})</span>`).join(' · ')}</div>`;
}

async function refresh() { await store.load(); }
async function decide(id, decision, btn) {
  let note = '';
  if (decision === 'reject') {
    const r = await modal({ title: 'Reject this plan change?', body: '<p style="margin:0">Nothing in the plan changes. The person who asked is told.</p><div class="field"><label>Why (optional)</label><input name="note" maxlength="200" /></div>', actions: [{ id: 'reject', label: 'Reject', danger: true }] });
    if (r.action !== 'reject') return;
    note = (r.form.note || '').trim();
  }
  if (btn) btn.disabled = true;
  try {
    const r = await api('POST', `/${encodeURIComponent(id)}/decide`, { decision, note });
    await refresh();
    toast(r.change.status === 'applied' ? 'Approved and applied' : r.change.status === 'rejected' ? 'Plan change rejected' : r.error ? 'Approved, but not applied: ' + r.error : 'Approved. Waiting for the next approver.');
  } catch (e) { if (btn) btn.disabled = false; toast(e.message); }
}
async function applyNow(id, btn) {
  if (btn) btn.disabled = true;
  try { await api('POST', `/${encodeURIComponent(id)}/apply`, {}); await refresh(); toast('Plan change applied'); }
  catch (e) { if (btn) btn.disabled = false; toast(e.message); }
}
function exportCSV(prj) {
  const rows = C().logRows(C().changesOf(store.state.docs, prj), store.state.docs, E());
  const blob = new Blob([C().toCSV(rows)], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = String((projectOf(prj) || {}).name || prj).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-plan-changes.csv';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  toast(`Exported ${plural(rows.length - 1, 'plan change')} to CSV`);
}
function compare(id) {
  const c = store.get('planChange', id);
  if (!c) return;
  const s = c.snapshots || {};
  const b = s.before || {}, a = s.after || {};
  const ids = [...new Set(Object.keys(b).concat(Object.keys(a)))];
  const same = k => b[k] && a[k] && b[k].start === a[k].start && b[k].due === a[k].due && b[k].owner === a[k].owner;
  const rows = ids.map(k => ({ k, t: (a[k] || b[k]).title || 'task', changed: !same(k) })).sort((x, y) => (y.changed - x.changed) || x.t.localeCompare(y.t));
  const cell = x => x ? `${esc(fmt(x.start))} – ${esc(fmt(x.due))}<br><small class="hint">${esc(pname(x.owner))}</small>` : '<i class="hint">not in the plan</i>';
  drawer('Before and after: ' + c.title, `<p class="hint" style="margin-top:0">Saved automatically when the change was applied: <b>${esc((c.baselines || {}).beforeLabel || '')}</b> and <b>${esc((c.baselines || {}).afterLabel || '')}</b>. Both are also in the project’s Saved plans (Advanced › Timeline).</p>
    ${ids.length ? `<div class="tbl-wrap"><table class="chg-cmp" data-chg-cmp><thead><tr><th>Task</th><th>Before</th><th>After</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.changed ? 'chg-diff' : ''}"><td>${esc(r.t)}</td><td>${cell(b[r.k])}</td><td>${cell(a[r.k])}</td></tr>`).join('')}</tbody></table></div>` : '<div class="hint">No task snapshot was kept for this change.</div>'}`);
}

/* ---------------------------------------------------------------- the wizard */
const STEPS = ['What and why', 'The edits', 'Impact'];
export async function openChangeWizard(projectId, preset) {
  try { await ensureAssets(); } catch (e) { toast('Plan changes are unavailable right now.'); return; }
  const j = projectOf(projectId);
  if (!j) { toast('Project not found'); return; }
  preset = preset || {};
  const tasks = tasksOf(projectId);
  const open = tasks.filter(w => w.status !== 'done');
  const S = {
    step: 0, kinds: new Set(preset.kinds || (preset.taskId ? ['dates'] : [])), reason: preset.reason || '', category: preset.category || '', title: '',
    dates: {}, owners: {}, removes: new Set(), adds: [], picks: new Set((preset.suggestions || []).map(s => s.id)), budget: '', target: '',
    errors: [], built: null, im: null, need: null, busy: false,
  };
  if (preset.taskId) { const w = store.get('workItem', preset.taskId); if (w && w.status !== 'done') S.dates[w.id] = { start: w.start, due: w.due, on: true }; }
  const sugg = preset.suggestions || [];

  const ov = document.createElement('div'); ov.className = 'overlay chg-ov';
  ov.innerHTML = `<div class="modal chg-wiz" role="dialog" aria-modal="true" aria-label="Change the plan"><h2>Change the plan <small class="hint">${esc(j.name)}</small></h2><ol class="chg-steps" aria-label="Steps"></ol><div class="mb"></div><div class="mf"></div></div>`;
  const opener = document.activeElement;
  const close = () => { ov.remove(); if (opener && opener.isConnected && opener.focus) try { opener.focus(); } catch (_) { /* gone */ } };
  ov._close = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
  const mb = ov.querySelector('.mb'), mf = ov.querySelector('.mf'), steps = ov.querySelector('.chg-steps');
  const val = n => { const el = mb.querySelector(`[name="${n}"]`); return el ? el.value : ''; };

  const people = sel => store.state.people.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} — ${esc(p.role)}</option>`).join('');
  const stepOpts = sel => (j.processes || []).map(pid => store.get('process', pid)).filter(Boolean).map(p => `<optgroup label="${esc(p.name)}">${E().flatSteps(p.tobe).map(s => `<option value="${esc(p.id + '::' + s.id)}" ${sel === p.id + '::' + s.id ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</optgroup>`).join('');

  function collect() {
    if (S.step === 0) {
      S.reason = val('reason').trim(); S.category = val('category'); S.title = val('title').trim();
      S.kinds = new Set([...mb.querySelectorAll('[name="kind"]:checked')].map(x => x.value));
    }
    if (S.step === 1) {
      open.forEach(w => {
        const on = mb.querySelector(`[name="dt_on"][value="${CSS.escape(w.id)}"]`);
        if (on) S.dates[w.id] = { on: on.checked, start: val('st_' + w.id) || w.start, due: val('du_' + w.id) || w.due };
        const ow = mb.querySelector(`[name="ow_${CSS.escape(w.id)}"]`); if (ow) S.owners[w.id] = ow.value;
      });
      if (mb.querySelector('[name="rm"]')) S.removes = new Set([...mb.querySelectorAll('[name="rm"]:checked')].map(x => x.value));
      S.adds.forEach((a, i) => { if (!mb.querySelector(`[name="ad_title_${i}"]`)) return; Object.assign(a, { title: val('ad_title_' + i), owner: val('ad_owner_' + i), step: val('ad_step_' + i), start: val('ad_start_' + i), due: val('ad_due_' + i), effortDays: val('ad_eff_' + i) }); });
      if (mb.querySelector('[name="sg"]')) S.picks = new Set([...mb.querySelectorAll('[name="sg"]:checked')].map(x => x.value));
      if (mb.querySelector('[name="budget"]')) S.budget = val('budget');
      if (mb.querySelector('[name="target"]')) S.target = val('target');
    }
  }
  function editsOf() {
    const ed = [];
    if (S.kinds.has('dates')) Object.entries(S.dates).forEach(([id, d]) => { if (!d.on) return; ed.push({ op: 'set', type: 'workItem', id, field: 'start', to: d.start }, { op: 'set', type: 'workItem', id, field: 'due', to: d.due }); });
    if (S.kinds.has('owner')) Object.entries(S.owners).forEach(([id, o]) => ed.push({ op: 'set', type: 'workItem', id, field: 'owner', to: o }));
    if (S.kinds.has('work')) {
      S.removes.forEach(id => ed.push({ op: 'remove', type: 'workItem', id }));
      S.adds.forEach(a => { const [pid, step] = String(a.step || '').split('::'); ed.push({ op: 'add', type: 'workItem', id: a.id, data: { title: a.title, owner: a.owner, pid: pid || null, step: step || null, start: a.start, due: a.due, effortDays: a.effortDays } }); });
    }
    if (S.kinds.has('scope')) sugg.filter(s => S.picks.has(s.id)).forEach(s => ed.push({ op: 'add', type: 'workItem', id: s.id, data: s, fromProcess: true }));
    if (S.kinds.has('budget') && S.budget !== '') ed.push({ op: 'set', type: 'project', id: projectId, field: 'budget', to: Number(S.budget) });
    if (S.kinds.has('deadline') && S.target) ed.push({ op: 'set', type: 'project', id: projectId, field: 'target', to: S.target });
    return ed;
  }

  function step0() {
    return `<fieldset class="chg-kinds"><legend>What’s changing? <small class="hint">Pick one or more</small></legend>${C().KINDS.map(k => `<label class="chg-kind"><input type="checkbox" name="kind" value="${k.id}" ${S.kinds.has(k.id) ? 'checked' : ''}/> <span>${esc(k.label)}</span></label>`).join('')}</fieldset>
      <div class="field"><label for="chg-reason">Why? <small class="hint">Required, one line</small></label><input id="chg-reason" name="reason" maxlength="200" value="${esc(S.reason)}" placeholder="e.g. The bank portal vendor needs two more weeks" /></div>
      <div class="frow"><div class="field"><label>Reason type <small class="hint">optional</small></label><select name="category"><option value="">—</option>${C().CATEGORIES.map(c => `<option value="${c.id}" ${S.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
      <div class="field"><label>Short title <small class="hint">optional</small></label><input name="title" maxlength="100" value="${esc(S.title)}" placeholder="We write one for you" /></div></div>`;
  }
  function taskLine(w) { return `<span class="chg-tl"><b>${esc(w.title)}</b><small class="hint">${esc(pname(w.owner))} · ${esc(fmt(w.start))} – ${esc(fmt(w.due))}</small></span>`; }
  function step1() {
    const parts = [];
    if (S.kinds.has('dates')) parts.push(`<section class="chg-ed" data-ed="dates"><h4>Move dates</h4><div class="hint">Tick the tasks that move, then set their new dates.</div>
      <div class="chg-shift"><label>Shift the ticked tasks by <input type="number" name="shift" value="5" min="-60" max="120" step="1" aria-label="Business days to shift" /> business days</label><button class="btn sm" data-shift>Shift</button></div>
      ${open.map(w => { const d = S.dates[w.id] || { start: w.start, due: w.due }; return `<div class="chg-trow ${d.on ? 'on' : ''}"><label class="chg-pick"><input type="checkbox" name="dt_on" value="${esc(w.id)}" ${d.on ? 'checked' : ''}/> ${taskLine(w)}</label>
        <span class="chg-dates"><label>Start <input type="date" name="st_${esc(w.id)}" value="${esc(d.start || '')}" /></label><label>Due <input type="date" name="du_${esc(w.id)}" value="${esc(d.due || '')}" /></label></span></div>`; }).join('') || '<div class="hint">No open tasks.</div>'}</section>`);
    if (S.kinds.has('owner')) parts.push(`<section class="chg-ed" data-ed="owner"><h4>Change owner</h4>${open.map(w => `<div class="chg-trow"><span class="chg-pick">${taskLine(w)}</span><select name="ow_${esc(w.id)}" aria-label="Owner of ${esc(w.title)}">${people(S.owners[w.id] || w.owner)}</select></div>`).join('') || '<div class="hint">No open tasks.</div>'}</section>`);
    if (S.kinds.has('work')) parts.push(`<section class="chg-ed" data-ed="work"><h4>Add or remove work</h4>
      ${S.adds.map((a, i) => `<div class="chg-add" data-add="${i}"><div class="field"><label>New task</label><input name="ad_title_${i}" maxlength="140" value="${esc(a.title || '')}" placeholder="What needs doing" /></div>
        <div class="frow"><div class="field"><label>Owner</label><select name="ad_owner_${i}">${people(a.owner || store.state.me)}</select></div><div class="field"><label>Step it delivers</label><select name="ad_step_${i}"><option value="">— none —</option>${stepOpts(a.step)}</select></div></div>
        <div class="frow"><div class="field"><label>Start</label><input type="date" name="ad_start_${i}" value="${esc(a.start || '')}" /></div><div class="field"><label>Due</label><input type="date" name="ad_due_${i}" value="${esc(a.due || '')}" /></div><div class="field"><label>Effort (days)</label><input type="number" name="ad_eff_${i}" min="0.5" max="200" step="0.5" value="${esc(a.effortDays || 1)}" /></div></div></div>`).join('')}
      <button class="btn sm" data-add-task>+ Add a task</button>
      <h4 class="chg-sub">Remove tasks</h4>${open.map(w => `<label class="chg-trow chg-pick"><input type="checkbox" name="rm" value="${esc(w.id)}" ${S.removes.has(w.id) ? 'checked' : ''}/> ${taskLine(w)}</label>`).join('') || '<div class="hint">No open tasks.</div>'}</section>`);
    if (S.kinds.has('scope')) parts.push(`<section class="chg-ed" data-ed="scope"><h4>Change scope</h4>${sugg.length ? `<div class="hint">Suggested tasks for the steps that changed in the process. Untick any you don’t need.</div>${sugg.map(s => `<label class="chg-trow chg-pick"><input type="checkbox" name="sg" value="${esc(s.id)}" ${S.picks.has(s.id) ? 'checked' : ''}/> ${taskLine(s)}</label>`).join('')}`
      : '<div class="hint">The linked processes have no new changes without work. To add tasks by hand, also tick “Add or remove work”.</div>'}</section>`);
    if (S.kinds.has('budget')) parts.push(`<section class="chg-ed" data-ed="budget"><h4>Change budget</h4><div class="field"><label>New budget (USD) <small class="hint">now ${esc(money(((j.budget || {}).planned)))}</small></label><input type="number" name="budget" min="0" step="100" value="${esc(S.budget !== '' ? S.budget : ((j.budget || {}).planned ?? ''))}" /></div></section>`);
    if (S.kinds.has('deadline')) parts.push(`<section class="chg-ed" data-ed="deadline"><h4>Change deadline</h4><div class="field"><label>New deadline <small class="hint">now ${esc(fmt(j.target))}</small></label><input type="date" name="target" value="${esc(S.target || j.target || '')}" /></div></section>`);
    return parts.join('') || '<div class="hint">Go back and pick what’s changing.</div>';
  }
  function step2() {
    const im = S.im, need = S.need;
    const who = need.approvers.map(a => `${pname(a.person)} (${C().ROLE_LABEL[a.role]})${a.person === store.state.me ? ' — that’s you' : ''}`);
    return `<p class="chg-sentence" data-chg-preview-sentence>${esc(im.sentence)}</p>
      ${need.within ? '<div class="chg-verdict ok" data-chg-verdict="within">Within tolerance: it applies as soon as you confirm.</div>'
        : `<div class="chg-verdict over" data-chg-verdict="approval"><b>Needs approval from ${esc(who.join(' and '))}.</b><ul>${need.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>`}
      <h4>What changes</h4>${editsListHTML(S.built)}
      ${impactDetailsHTML(im)}`;
  }
  function draw() {
    steps.innerHTML = STEPS.map((s, i) => `<li class="${i === S.step ? 'on' : i < S.step ? 'done' : ''}" ${i === S.step ? 'aria-current="step"' : ''}><span>${i + 1}</span> ${esc(s)}</li>`).join('');
    const err = S.errors.length ? `<div class="banner" style="margin:0" role="alert" data-chg-errors>${S.errors.map(esc).join('<br>')}</div>` : '';
    mb.innerHTML = err + (S.step === 0 ? step0() : S.step === 1 ? step1() : step2());
    const needs = S.need && !S.need.within;
    mf.innerHTML = `<button class="btn" data-w="cancel">Cancel</button>${S.step ? '<button class="btn" data-w="back">Back</button>' : ''}${S.step < 2 ? `<button class="btn primary" data-w="next">${S.step === 1 ? 'See the impact' : 'Next'}</button>` : `<button class="btn primary" data-w="submit" ${S.busy ? 'disabled' : ''}>${needs ? 'Send for approval' : 'Apply change'}</button>`}`;
    const f = mb.querySelector('input:not([type=checkbox]),select,textarea'); if (f && S.step < 2) f.focus();
    mb.querySelectorAll('[name="dt_on"]').forEach(cb => cb.addEventListener('change', () => cb.closest('.chg-trow').classList.toggle('on', cb.checked)));
    const sh = mb.querySelector('[data-shift]');
    if (sh) sh.addEventListener('click', e => {
      e.preventDefault(); const n = Math.round(Number(val('shift')) || 0); if (!n) return;
      mb.querySelectorAll('[name="dt_on"]:checked').forEach(cb => { const w = store.get('workItem', cb.value); if (!w) return;
        mb.querySelector(`[name="st_${CSS.escape(w.id)}"]`).value = E().addBusinessDays(w.start, n); mb.querySelector(`[name="du_${CSS.escape(w.id)}"]`).value = E().addBusinessDays(w.due, n); });
    });
    const at = mb.querySelector('[data-add-task]');
    if (at) at.addEventListener('click', e => { e.preventDefault(); collect(); const s0 = E().addBusinessDays(store.state.today, 0); S.adds.push({ id: store.newId('wi'), owner: store.state.me, start: s0, due: E().addBusinessDays(s0, 3), effortDays: 1 }); draw(); });
  }
  function preview() {
    const { change, errors } = C().buildChange({ projectId, title: S.title, reason: S.reason, category: S.category || null, source: preset.source || 'manual', edits: editsOf(), ackSteps: preset.ackSteps }, store.state.docs, { engine: E() });
    if (errors.length) { S.errors = errors; return false; }
    const after = C().applyToDocs(store.state.docs, change, new Date().toISOString());
    S.built = change;
    S.im = C().impact(store.state.docs, after, projectId, store.state.today, { change, engine: E() });
    S.need = C().needsApproval(change, S.im, store.state.docs);
    return true;
  }
  async function submit() {
    S.busy = true; draw();
    try {
      const body = { change: { projectId, title: S.built.title, reason: S.reason, category: S.category || null, source: preset.source || 'manual', edits: S.built.edits.filter(e => !e.auto).map(e => {
        const o = { op: e.op, type: e.type, id: e.id }; if (e.op === 'set') { o.field = e.field; o.to = e.to; } if (e.op === 'add') { o.data = e.data; if (e.fromProcess) o.fromProcess = true; } return o; }), ackSteps: preset.ackSteps } };
      const r = await api('POST', '', body);
      close();
      await refresh();
      const c = r.change;
      toast(c.status === 'applied' ? 'Plan change applied' : 'Sent for approval: ' + C().waitingText(c, store.state.docs).replace(/^Waiting for /, ''));
      if (!/\/changes$/.test(location.pathname)) return;
      history.replaceState({}, '', link(changeHref(c))); window.dispatchEvent(new Event('pmo:route'));
    } catch (e) { S.busy = false; S.errors = [e.message]; draw(); }
  }
  mf.addEventListener('click', e => {
    const b = e.target.closest('[data-w]'); if (!b) return;
    const w = b.dataset.w;
    if (w === 'cancel') return close();
    if (w === 'back') { collect(); S.errors = []; S.step--; return draw(); }
    if (w === 'next') {
      collect(); S.errors = [];
      if (S.step === 0) {
        if (!S.kinds.size) S.errors.push('Pick what’s changing.');
        if (!S.reason) S.errors.push('Say why the plan is changing (one line).');
        if (!S.errors.length) S.step = 1;
        return draw();
      }
      if (preview()) S.step = 2;
      return draw();
    }
    if (w === 'submit') submit();
  });
  draw();
}

/* ---------------------------------------------------------------- standalone page: /project/:prj/changes */
export function render(params) {
  const prj = params.prj;
  const j = projectOf(prj);
  if (!j) return `<div class="card"><h3>Project not found</h3><a href="${link('/projects')}" data-link style="color:var(--accent)">All projects</a></div>`;
  const focus = params.q && params.q.change;
  return `<section class="hdr chg-hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> › <a href="${link('/projects')}" data-link>Projects</a> › <a href="${link('/project/' + encodeURIComponent(prj))}" data-link>${esc(j.name)}</a> › Changes</div>
      <h1>Plan changes</h1><p>Every change to the plan: what changed, why, who decided, and what it did to the finish date, the cost and the approvals.</p></div>
      <div class="hdr-side"><a class="btn" href="${link('/project/' + encodeURIComponent(prj))}" data-link>Back to the project</a></div></section>
    <div class="chg-page">${renderChangesSection(prj, { focus, standalone: true })}<div class="chg-activity">${activityCard('project:' + prj)}</div></div>`;
}
let scrolledTo = null;
export function bind(root, params) {
  if (!C()) { ensureAssets().then(() => window.dispatchEvent(new Event('pmo:route'))).catch(() => {}); return; }
  ensureAssets().catch(() => {});
  bindChangesSection(root, params.prj);
  bindActivity(root);
  const focus = params.q && params.q.change;
  if (focus && focus !== scrolledTo) requestAnimationFrame(() => { const el = root.querySelector(`[data-chg="${CSS.escape(focus)}"]`); if (el) { scrolledTo = focus; openIds.add(focus); el.scrollIntoView({ block: 'start' }); } });
  if (params.q && params.q.open === '1') { history.replaceState({}, '', link(`/project/${encodeURIComponent(params.prj)}/changes`)); openChangeWizard(params.prj, params.q.task ? { taskId: params.q.task } : null); }
}
