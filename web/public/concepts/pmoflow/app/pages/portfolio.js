/* PMOFlow — portfolio (stream P). Route: /portfolio
   Projects RAG table, workload, risk register, baseline variance, AI status report. */
import { store } from '../store.js';
import { esc, fmt, link, av, pname, modal, toast } from '../ui.js';
import { eng, docs, today, projectStats, rag, ragBadge, RAG_RULE, rerender, feedHTML, bindFeed } from './project.js';

const LV = ['low', 'med', 'high'];
const LV_LBL = { low: 'Low', med: 'Medium', high: 'High' };
const st = { blPrj: null, blId: null, repPrj: null, riskFilter: 'open' };
const reports = {}; /* projectId -> {loading, data, error} */
const dayDiff = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);

/* ---------------------------------------------------------------- projects */
function projectsHTML(projects) {
  if (!projects.length) return '<div class="card"><h3>Projects</h3><div class="empty">No projects yet.</div></div>';
  const rows = projects.map(j => {
    const s = projectStats(j.id), r = rag(j, s);
    const buf = s.finish && j.target ? dayDiff(j.target, s.finish) : null;
    const rel = store.list('release', x => x.projectId === j.id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    return `<tr class="click" data-go="/project/${esc(j.id)}">
      <td><b>${esc(j.name)}</b><div class="hint">${av(j.owner)} ${esc(pname(j.owner))}</div></td>
      <td>${ragBadge(r)}</td>
      <td><div class="pmo-prog"><div class="bar" style="width:110px"><i style="width:${s.pct}%"></i></div><b>${s.pct}%</b></div><div class="hint">${s.done}/${s.total} done</div></td>
      <td class="pmo-nowrap"><b style="color:${buf != null && buf < 0 ? 'var(--late)' : 'inherit'}">${esc(fmt(s.finish))}</b> <span class="hint">/ ${esc(fmt(j.target))}</span><div class="hint">${buf == null ? '—' : buf < 0 ? `<span class="fail">${-buf}d over</span>` : `${buf}d buffer`}</div></td>
      <td class="pmo-nowrap"><span class="${s.late ? 'fail' : ''}"><b>${s.late}</b> late</span> · <span class="${s.slip ? 'warn' : ''}"><b>${s.slip}</b> slipping</span></td>
      <td>${j.status === 'live' ? `<span class="badge b-done">Live</span><div class="hint">${rel ? esc(fmt(rel.at)) : ''}</div>` : `<a class="badge b-idle" href="${link('/release/' + encodeURIComponent(j.id))}" data-link>Not released ›</a>`}</td></tr>`;
  }).join('');
  return `<div class="card"><h3>Projects <span class="n">${projects.length}</span></h3>
    <div class="tbl-wrap"><table class="pmo-ptable"><thead><tr><th>Project</th><th>Status</th><th>Progress</th><th>Forecast / target</th><th>Schedule</th><th>Release</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="pmo-rule"><span class="rag rag-red"><i></i>Red</span><span class="rag rag-amber"><i></i>Amber</span><span class="rag rag-green"><i></i>Green</span><span class="hint">${esc(RAG_RULE)}</span></div></div>`;
}

/* ---------------------------------------------------------------- workload */
function workloadHTML() {
  const rows = (eng('workload', [], docs(), undefined, today()) || []).filter(r => r && (r.open || r.late || r.dueNext7));
  if (!rows.length) return '<div class="card"><h3>Workload</h3><div class="empty">Nobody has open work.</div></div>';
  rows.sort((a, b) => b.open - a.open || b.late - a.late);
  const max = Math.max(1, ...rows.map(r => r.open || 0));
  return `<div class="card"><h3>Workload <span class="n">${rows.length} people</span></h3><div class="hint" style="margin:-4px 0 10px">Open work items per person, across every project</div>
    <div class="pmo-wl">${rows.map(r => {
      const pid = typeof r.person === 'object' && r.person ? r.person.id : r.person;
      const late = r.late || 0, soon = Math.max(0, Math.min((r.open || 0) - late, r.dueNext7 || 0)), rest = Math.max(0, (r.open || 0) - late - soon);
      const w = n => (n / max * 100).toFixed(2);
      return `<div class="pmo-wl-row"><div class="pmo-wl-who">${av(pid)}<span>${esc(pname(pid))}</span></div>
        <div class="pmo-wl-bar" role="img" aria-label="${esc(pname(pid))}: ${r.open} open, ${late} late, ${r.dueNext7 || 0} due in 7 days">${late ? `<i class="late" style="width:${w(late)}%"></i>` : ''}${soon ? `<i class="soon" style="width:${w(soon)}%"></i>` : ''}${rest ? `<i class="rest" style="width:${w(rest)}%"></i>` : ''}</div>
        <div class="pmo-wl-n"><b>${r.open || 0}</b> open${late ? ` · <span class="fail">${late} late</span>` : ''}${r.dueNext7 ? ` · ${r.dueNext7} next 7d` : ''}</div></div>`;
    }).join('')}</div>
    <div class="pmo-wl-key"><span><i class="late"></i>Late</span><span><i class="soon"></i>Due next 7 days</span><span><i class="rest"></i>Other open</span></div></div>`;
}

/* ---------------------------------------------------------------- risks */
const score = r => (LV.indexOf(r.impact) + 1) * (LV.indexOf(r.likelihood) + 1);
const sevCls = n => n >= 6 ? 'hi' : n >= 3 ? 'md' : 'lo';
function matrixHTML(risks) {
  const open = risks.filter(r => r.status !== 'closed');
  let cells = '';
  ['high', 'med', 'low'].forEach(im => {
    cells += `<div class="pmo-mx-y">${LV_LBL[im]}</div>`;
    LV.forEach(li => {
      const n = open.filter(r => r.impact === im && r.likelihood === li).length;
      cells += `<div class="pmo-mx-c ${sevCls((LV.indexOf(im) + 1) * (LV.indexOf(li) + 1))} ${n ? 'has' : ''}" title="Impact ${LV_LBL[im]}, likelihood ${LV_LBL[li]}: ${n} open">${n || ''}</div>`;
    });
  });
  return `<div class="pmo-mx" aria-label="Impact by likelihood matrix of open risks"><div class="pmo-mx-lbl">Impact ↑</div>${cells}<div></div>${LV.map(l => `<div class="pmo-mx-x">${LV_LBL[l]}</div>`).join('')}<div class="pmo-mx-lbl x">Likelihood →</div></div>`;
}
function risksHTML(projects) {
  const all = store.list('risk');
  const list = all.filter(r => st.riskFilter === 'all' || (r.status || 'open') === st.riskFilter)
    .sort((a, b) => score(b) - score(a) || String(a.title).localeCompare(String(b.title)));
  const pn = id => (store.get('project', id) || {}).name || '—';
  return `<div class="card"><h3>Risk register <span class="n">${all.filter(r => r.status !== 'closed').length} open</span></h3>
    <div class="pmo-risk">
      <div>${matrixHTML(all)}</div>
      <div style="min-width:0">
        <div class="pmo-tlbar"><div class="seg">${[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => `<button data-rf="${k}" class="${st.riskFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div><button class="btn sm primary" data-add-risk ${projects.length ? '' : 'disabled'}>+ Add risk</button></div>
        ${list.length ? `<div class="tbl-wrap"><table class="pmo-rtable"><thead><tr><th>Risk</th><th>Impact × likelihood</th><th>Owner</th><th>Status</th><th></th></tr></thead><tbody>
          ${list.map(r => `<tr data-rid="${esc(r.id)}"><td><b>${esc(r.title)}</b><div class="hint">${esc(pn(r.projectId))}</div>${r.mitigation ? `<div class="pmo-mit">Mitigation: ${esc(r.mitigation)}</div>` : ''}</td>
            <td class="pmo-nowrap"><span class="pmo-sev ${sevCls(score(r))}">${score(r)}</span> ${esc(LV_LBL[r.impact] || r.impact)} × ${esc(LV_LBL[r.likelihood] || r.likelihood)}</td>
            <td class="pmo-nowrap">${av(r.owner)} ${esc(pname(r.owner).split(' ')[0])}</td>
            <td><span class="badge ${r.status === 'closed' ? 'b-done' : 'b-soon'}">${r.status === 'closed' ? 'Closed' : 'Open'}</span></td>
            <td class="pmo-nowrap"><button class="btn sm" data-edit-risk="${esc(r.id)}">Edit</button> <button class="btn sm danger" data-del-risk="${esc(r.id)}" aria-label="Delete risk ${esc(r.title)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`
          : `<div class="empty">${all.length ? 'No risks match this filter.' : 'No risks logged yet. Add one to track impact, likelihood and mitigation.'}</div>`}
      </div></div>
    <div style="margin-top:12px"><div class="hint" style="margin-bottom:4px;text-transform:uppercase;letter-spacing:.6px;font-size:11px">Recent risk changes</div>${feedHTML('risk')}</div></div>`;
}
async function editRisk(r, err) {
  const isNew = !r || !r.id;
  const projects = store.list('project');
  r = Object.assign({ projectId: (projects[0] || {}).id, title: '', impact: 'med', likelihood: 'med', owner: store.state.me, mitigation: '', status: 'open' }, r || {});
  const sel = (name, opts, v) => `<select name="${name}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const lv = LV.map(k => [k, LV_LBL[k]]);
  const body = `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}
    <div class="field"><label>Project</label>${sel('projectId', projects.map(p => [p.id, p.name]), r.projectId)}</div>
    <div class="field"><label>Risk</label><input name="title" maxlength="140" value="${esc(r.title)}" placeholder="e.g. Screening vendor contract slips past month end" /></div>
    <div class="frow"><div class="field"><label>Impact</label>${sel('impact', lv, r.impact)}</div><div class="field"><label>Likelihood</label>${sel('likelihood', lv, r.likelihood)}</div></div>
    <div class="frow"><div class="field"><label>Owner</label>${sel('owner', store.state.people.map(p => [p.id, p.name]), r.owner)}</div><div class="field"><label>Status</label>${sel('status', [['open', 'Open'], ['closed', 'Closed']], r.status)}</div></div>
    <div class="field"><label>Mitigation</label><textarea name="mitigation" maxlength="600" placeholder="What reduces the impact or likelihood?">${esc(r.mitigation)}</textarea></div>`;
  const acts = [{ id: 'save', label: isNew ? 'Add risk' : 'Save changes', primary: true }];
  if (!isNew) acts.unshift({ id: 'delete', label: 'Delete', danger: true });
  const res = await modal({ title: isNew ? 'Add risk' : 'Edit risk', body, actions: acts });
  if (res.action === 'delete') return deleteRisk(r);
  if (res.action !== 'save') return;
  const f = res.form;
  const next = Object.assign({}, r, { projectId: f.projectId, title: (f.title || '').trim(), impact: f.impact, likelihood: f.likelihood, owner: f.owner, status: f.status, mitigation: (f.mitigation || '').trim() });
  if (!next.title) return editRisk(next, 'Describe the risk.');
  if (isNew) {
    next.id = store.newId('rsk');
    await store.save('risk', next.id, next, `Logged risk “${next.title}” (impact ${LV_LBL[next.impact]}, likelihood ${LV_LBL[next.likelihood]})`);
    toast('Risk added'); return;
  }
  const ch = [];
  if (r.title !== next.title) ch.push(`renamed from “${r.title}”`);
  if (r.impact !== next.impact) ch.push(`impact ${LV_LBL[r.impact]} → ${LV_LBL[next.impact]}`);
  if (r.likelihood !== next.likelihood) ch.push(`likelihood ${LV_LBL[r.likelihood]} → ${LV_LBL[next.likelihood]}`);
  if (r.owner !== next.owner) ch.push(`owner → ${pname(next.owner)}`);
  if (r.status !== next.status) ch.push(next.status === 'closed' ? 'closed' : 'reopened');
  if (r.mitigation !== next.mitigation) ch.push('mitigation updated');
  if (r.projectId !== next.projectId) ch.push('moved project');
  if (!ch.length) { toast('No changes'); return; }
  await store.save('risk', next.id, next, `Edited risk “${next.title}”: ${ch.join('; ')}`);
  toast('Risk saved');
}
async function deleteRisk(r) {
  const res = await modal({ title: 'Delete risk?', body: `<p style="margin:0">Delete <b>${esc(r.title)}</b>? Consider closing it instead to keep the record.</p>`, actions: [{ id: 'delete', label: 'Delete', danger: true }] });
  if (res.action !== 'delete') return;
  await store.remove('risk', r.id, `Deleted risk “${r.title}”`);
  toast('Risk deleted');
}

/* ---------------------------------------------------------------- baseline variance */
function varianceHTML(projects) {
  const withBl = projects.filter(p => (p.baselines || []).length);
  if (!withBl.length) return `<div class="card"><h3>Baseline variance</h3><div class="empty">No baselines yet. Open a project and use “Save baseline” to snapshot the plan, then compare forecasts here.</div></div>`;
  const j = withBl.find(p => p.id === st.blPrj) || withBl[0];
  const bls = j.baselines;
  const bl = bls.find(b => b.id === st.blId) || bls[bls.length - 1];
  const rows = eng('baselineVariance', [], docs(), j.id, bl.id, today()) || [];
  const wt = id => (store.get('workItem', id) || {}).title || 'Deleted work item';
  const total = rows.reduce((a, r) => a + Math.max(0, r.varianceDays || 0), 0);
  const gained = rows.reduce((a, r) => a + Math.min(0, r.varianceDays || 0), 0);
  const worst = rows.slice().sort((a, b) => (b.varianceDays || 0) - (a.varianceDays || 0));
  return `<div class="card"><h3>Baseline variance</h3>
    <div class="pmo-tlbar"><select class="pmo-sel" data-bl-prj aria-label="Project">${withBl.map(p => `<option value="${esc(p.id)}" ${p.id === j.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <select class="pmo-sel" data-bl-id aria-label="Baseline">${bls.map(b => `<option value="${esc(b.id)}" ${b.id === bl.id ? 'selected' : ''}>${esc(b.label || 'Baseline')} · ${esc(fmt(b.at))}</option>`).join('')}</select></div>
    <div class="pmo-var-kpis"><div class="kpi"><b class="${total ? 'fail' : ''}">+${total}d</b><span>Total slip</span></div><div class="kpi"><b>${rows.filter(r => r.varianceDays > 0).length}/${rows.length}</b><span>Items later than plan</span></div><div class="kpi"><b class="${gained ? 'pass' : ''}">${gained}d</b><span>Gained</span></div></div>
    ${rows.length ? `<div class="tbl-wrap"><table class="pmo-vtable"><thead><tr><th>Work item</th><th>Planned due</th><th>Forecast</th><th>Variance</th></tr></thead><tbody>
      ${worst.map(r => `<tr><td>${esc(wt(r.workId))}</td><td class="pmo-nowrap">${esc(fmt(r.plannedDue))}</td><td class="pmo-nowrap">${esc(fmt(r.forecast))}</td><td class="pmo-nowrap">${r.plannedDue ? `<span class="pmo-var ${r.varianceDays > 0 ? 'up' : r.varianceDays < 0 ? 'down' : ''}">${r.varianceDays > 0 ? '+' : ''}${r.varianceDays || 0}d</span>` : '<span class="pmo-var">added after baseline</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">This baseline has no items that still exist.</div>'}</div>`;
}

/* ---------------------------------------------------------------- status report */
const txt = x => x == null ? '' : typeof x === 'string' ? x : (x.text || x.title || x.summary || x.detail || JSON.stringify(x));
function reportText(j, d) {
  const sec = (h, arr) => (arr && arr.length) ? `\n${h}\n` + arr.map(x => '- ' + txt(x)).join('\n') + '\n' : '';
  return `${j.name}: status report (${fmt(today())})\n\n${txt(d.headline)}\n\n${txt(d.summary)}\n${sec('Highlights', d.highlights)}${sec('Risks', d.risks)}${sec('Asks', d.asks)}`.trim();
}
function reportHTML(projects) {
  if (!projects.length) return '<div class="card"><h3>Status report</h3><div class="empty">No projects to report on.</div></div>';
  const j = projects.find(p => p.id === st.repPrj) || projects[0];
  const rep = reports[j.id];
  let out = '<div class="pmo-rep-empty hint">Pick a project and generate a one-page status report from its live facts: progress, forecast, blockers, risks and approvals.</div>';
  if (rep && rep.loading) out = '<div class="pmo-rep-loading"><span class="pmo-spin"></span> Generating the report…</div>';
  else if (rep && rep.error) out = `<div class="banner">Couldn’t generate the report: ${esc(rep.error)}</div>`;
  else if (rep && rep.data) {
    const d = rep.data, ai = String(d.source || '').toLowerCase() === 'ai';
    const list = (h, arr, cls) => (arr && arr.length) ? `<div class="pmo-rep-sec ${cls}"><h4>${h}</h4><ul>${arr.map(x => `<li>${esc(txt(x))}</li>`).join('')}</ul></div>` : '';
    out = `<div class="pmo-rep">
      <div class="pmo-rep-top"><span class="pmo-src ${ai ? 'ai' : ''}">${ai ? '✦ Generated by AI' : 'Rules-based'}</span><span class="hint">${ai ? 'Written from project facts only. Check before sending.' : 'Built from project facts by deterministic rules.'}</span><button class="btn sm" data-copy-rep style="margin-left:auto">Copy</button></div>
      <h3 class="pmo-rep-h">${esc(txt(d.headline) || j.name)}</h3>
      ${d.summary ? `<p class="pmo-rep-p">${esc(txt(d.summary))}</p>` : ''}
      <div class="pmo-rep-grid">${list('Highlights', d.highlights, 'hl')}${list('Risks', d.risks, 'rk')}${list('Asks', d.asks, 'ak')}</div></div>`;
  }
  return `<div class="card"><h3>Status report</h3>
    <div class="pmo-tlbar"><select class="pmo-sel" data-rep-prj aria-label="Project for status report">${projects.map(p => `<option value="${esc(p.id)}" ${p.id === j.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <button class="btn sm primary" data-gen-rep ${rep && rep.loading ? 'disabled' : ''}>${rep && rep.data ? 'Regenerate' : '✦ Generate report'}</button></div>${out}</div>`;
}
async function generate(prj) {
  reports[prj] = { loading: true }; rerender();
  try {
    const r = await store.api('/ai/status-report', { projectId: prj });
    reports[prj] = { data: (r && (r.report || r)) || {} };
  } catch (e) { reports[prj] = { error: e.message || 'service unavailable' }; }
  rerender();
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove(); return ok;
  }
}

/* ---------------------------------------------------------------- page */
export function render() {
  const projects = store.list('project');
  const totals = projects.map(p => ({ p, s: projectStats(p.id) }));
  const rc = { red: 0, amber: 0, green: 0, live: 0 }; totals.forEach(({ p, s }) => rc[rag(p, s).k]++);
  const openWork = totals.reduce((a, x) => a + (x.s.total - x.s.done), 0);
  const openRisks = store.list('risk', r => r.status !== 'closed').length;
  return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › Portfolio</div><h1>Portfolio</h1>
      <p>Every project’s health in one place: progress, forecast against target, who is overloaded, what could go wrong, and how far the plan has drifted from its baseline.</p></div>
    <div class="hdr-side"><div class="kpis"><div class="kpi"><b>${projects.length}</b><span>Projects</span></div><div class="kpi"><b><em class="pmo-rc fail">${rc.red}</em> · <em class="pmo-rc warn">${rc.amber}</em> · <em class="pmo-rc pass">${rc.green}</em></b><span>Red · amber · green</span></div><div class="kpi"><b>${openWork}</b><span>Open work items</span></div><div class="kpi"><b>${openRisks}</b><span>Open risks</span></div></div></div></section>
    <div class="pmo-stack">${projectsHTML(projects)}</div>
    <div class="two pmo-top">${workloadHTML()}${reportHTML(projects)}</div>
    <div class="pmo-stack">${risksHTML(projects)}</div>
    <div class="pmo-stack">${varianceHTML(projects)}</div>`;
}

export function bind(root) {
  const on = (sel, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener('click', e => { e.preventDefault(); fn(el); }));
  on('[data-add-risk]', () => editRisk(null));
  on('[data-edit-risk]', el => { const r = store.get('risk', el.dataset.editRisk); if (r) editRisk(r); });
  on('[data-del-risk]', el => { const r = store.get('risk', el.dataset.delRisk); if (r) deleteRisk(r); });
  on('[data-rf]', el => { st.riskFilter = el.dataset.rf; rerender(); });
  const chg = (sel, fn) => { const el = root.querySelector(sel); if (el) el.addEventListener('change', () => fn(el.value)); };
  chg('[data-bl-prj]', v => { st.blPrj = v; st.blId = null; rerender(); });
  chg('[data-bl-id]', v => { st.blId = v; rerender(); });
  chg('[data-rep-prj]', v => { st.repPrj = v; rerender(); });
  on('[data-gen-rep]', () => { const sel = root.querySelector('[data-rep-prj]'); generate(sel ? sel.value : st.repPrj); });
  on('[data-copy-rep]', async () => {
    const sel = root.querySelector('[data-rep-prj]'); const j = store.get('project', sel && sel.value); const rep = j && reports[j.id];
    if (!rep || !rep.data) return;
    toast((await copyText(reportText(j, rep.data))) ? 'Report copied' : 'Copy failed: select the text and copy manually');
  });
  bindFeed(root, 'risk', e => String(e.ref || '').startsWith('risk:'));
}
