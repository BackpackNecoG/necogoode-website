/* PMOFlow — portfolio (stream P). Route: /portfolio
   Projects RAG table, workload, risk register, baseline variance, AI status report. */
import { store } from '../store.js';
import { esc, fmt, link, av, pname, modal, toast } from '../ui.js';
import { eng, docs, today, projectStats, rag, ragBadge, RAG_RULE, rerender, feedHTML, bindFeed, finishInfo, BUG, gateInfo, newProject } from './project.js';

const LV = ['low', 'med', 'high'];
const LV_LBL = { low: 'Low', med: 'Medium', high: 'High' };
const st = { blPrj: null, blId: null, repPrj: null, riskFilter: 'open' };
const reports = {}; /* projectId -> {loading, data, error} */
const dayDiff = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);

/* ---------------------------------------------------------------- projects */
function projectsHTML(projects) {
  if (!projects.length) return '<div class="card"><h3>Projects</h3><div class="empty">No projects yet. <button class="btn sm primary" data-new-project>+ New project</button></div></div>';
  const rows = projects.map(j => {
    const s = projectStats(j.id), r = rag(j, s), gi = gateInfo(j, s), fi = gi.fi;
    const buf = fi.date && j.target ? dayDiff(j.target, fi.date) : null;
    /* Gate-aware: never "Finished · Nd early" while go-live is still pending the readiness gate. */
    const when = gi.k === 'live' ? `<b style="color:var(--done)">${esc(gi.label)}</b><div class="hint">target ${esc(fmt(j.target))}</div>`
      : gi.k === 'awaiting' ? `<b>Work done ${esc(fmt(fi.date))}</b><div class="hint"><a href="${link('/release/' + encodeURIComponent(j.id))}" data-link class="${gi.blocking ? 'fail' : ''}">Awaiting go-live${gi.blocking ? ` · ${gi.blocking} blocking` : ''} ›</a></div>`
      : `<b style="color:${buf != null && buf < 0 ? 'var(--late)' : 'inherit'}">${esc(fmt(fi.date))}</b> <span class="hint">/ ${esc(fmt(j.target))}</span><div class="hint">${buf == null ? '—' : buf < 0 ? `<span class="fail">${-buf}d over</span>` : `${buf}d buffer`}</div>`;
    const rel = store.list('release', x => x.projectId === j.id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    return `<tr class="click" data-go="/project/${esc(j.id)}">
      <td><b>${esc(j.name)}</b><div class="hint">${av(j.owner)} ${esc(pname(j.owner))}</div></td>
      <td>${ragBadge(r)}</td>
      <td><div class="pmo-prog"><div class="bar" style="width:110px"><i style="width:${s.pct}%"></i></div><b>${s.pct}%</b></div><div class="hint">${s.done}/${s.total} done</div></td>
      <td class="pmo-nowrap" data-when>${when}</td>
      <td class="pmo-nowrap"><span class="${s.late ? 'fail' : ''}"><b>${s.late}</b> late</span> · <span class="${s.slip ? 'warn' : ''}"><b>${s.slip}</b> slipping</span></td>
      <td>${j.status === 'live' ? `<span class="badge b-done">Live</span><div class="hint">${rel ? esc(fmt(rel.at)) : ''}</div>` : `<a class="badge b-idle" href="${link('/release/' + encodeURIComponent(j.id))}" data-link>Not released ›</a>`}</td></tr>`;
  }).join('');
  return `<div class="card"><h3 class="pmo-h3row">Projects <span class="n">${projects.length}</span><button class="btn sm primary" data-new-project>+ New project</button></h3>
    <div class="tbl-wrap"><table class="pmo-ptable"><thead><tr><th>Project</th><th>Status</th><th>Progress</th><th>Forecast / target</th><th>Schedule</th><th>Release</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="pmo-rule"><span class="rag rag-red"><i></i>Red</span><span class="rag rag-amber"><i></i>Amber</span><span class="rag rag-green"><i></i>Green</span><span class="hint">${esc(RAG_RULE)}</span></div></div>`;
}

/* ---------------------------------------------------------------- workload */
/* Engine R2: workload(docs, today) -> {person, open, late, dueNext7, effortNext14, capacityNext14, overloaded}.
   Older signature was (docs, projectId, today); both are handled. */
function workloadRows() {
  let rows = eng('workload', null, docs(), today());
  if (!Array.isArray(rows) || (rows[0] && rows[0].effortNext14 === undefined)) rows = eng('workload', [], docs(), undefined, today()) || [];
  const seen = new Set(rows.map(r => typeof r.person === 'object' && r.person ? r.person.id : r.person));
  store.state.people.forEach(p => { if (!seen.has(p.id)) rows.push({ person: p.id, open: 0, late: 0, dueNext7: 0, effortNext14: 0 }); });
  return rows.map(r => {
    const pid = typeof r.person === 'object' && r.person ? r.person.id : r.person;
    const cap = Number((store.person(pid) || {}).capacity) > 0 ? Number(store.person(pid).capacity) : 4;
    const capN = cap * 2; /* from the person doc so an edit shows immediately */
    const effN = typeof r.effortNext14 === 'number' ? r.effortNext14 : 0;
    return Object.assign({}, r, { pid, cap, capN, effN, overloaded: effN > capN });
  });
}
const d1 = n => Math.round(n * 10) / 10;
function workloadHTML() {
  const rows = workloadRows();
  if (!rows.length) return '<div class="card"><h3>Workload</h3><div class="empty">No people in this workspace.</div></div>';
  rows.sort((a, b) => (b.effN / (b.capN || 1)) - (a.effN / (a.capN || 1)) || b.open - a.open);
  const max = Math.max(1, ...rows.map(r => Math.max(r.effN, r.capN)));
  const over = rows.filter(r => r.overloaded).length;
  return `<div class="card"><h3>Workload <span class="n">${over ? `<span class="fail">${over} overloaded</span>` : rows.length + ' people'}</span></h3><div class="hint" style="margin:-4px 0 10px">Planned effort in the next 14 days against each person’s capacity, across every project</div>
    <div class="pmo-wl">${rows.map(r => {
      const pct = n => (n / max * 100).toFixed(2);
      return `<div class="pmo-wl-row ${r.overloaded ? 'over' : ''}" data-wl="${esc(r.pid)}"><div class="pmo-wl-who">${av(r.pid)}<span>${esc(pname(r.pid))}</span></div>
        <div class="pmo-wl-bar" role="img" aria-label="${esc(pname(r.pid))}: ${d1(r.effN)} days of effort against ${d1(r.capN)} days capacity in 14 days">
          <i class="${r.overloaded ? 'late' : 'rest'}" style="width:${pct(r.effN)}%"></i><b class="pmo-cap" style="left:${pct(r.capN)}%" title="Capacity ${d1(r.capN)}d"></b></div>
        <div class="pmo-wl-n"><div><b class="${r.overloaded ? 'fail' : ''}">${d1(r.effN)}d</b> / ${d1(r.capN)}d <button class="pmo-capbtn" data-cap="${esc(r.pid)}" title="Edit capacity (days per week)" aria-label="Edit capacity of ${esc(pname(r.pid))}">${d1(r.cap)}d/wk ✎</button></div>
          <div class="hint">${r.overloaded ? '<span class="badge b-late">Overloaded</span> ' : ''}${r.open || 0} open${r.late ? ` · <span class="fail">${r.late} late</span>` : ''}${r.dueNext7 ? ` · ${r.dueNext7} due in 7d` : ''}</div></div></div>`;
    }).join('')}</div>
    <div class="pmo-wl-key"><span><i class="rest"></i>Effort next 14 days</span><span><i class="late"></i>Over capacity</span><span><i class="capk"></i>Capacity (days/week × 2)</span></div></div>`;
}
async function editCapacity(pid) {
  const p = store.person(pid); if (!p) return;
  const cur = Number(p.capacity) > 0 ? Number(p.capacity) : 4;
  const r = await modal({ title: `Capacity: ${p.name}`, body: `<p class="hint" style="margin:0">Days per week this person can give to project work (the rest goes to run-the-business work). Default 4.</p>
    <div class="field"><label>Days per week</label><input type="number" name="capacity" min="0" max="7" step="0.5" value="${esc(cur)}" /></div>`, actions: [{ id: 'save', label: 'Save capacity', primary: true }] });
  if (r.action !== 'save') return;
  const v = Number(r.form.capacity);
  if (!(v >= 0 && v <= 7)) { toast('Capacity must be between 0 and 7 days per week'); return; }
  if (v === cur) return;
  const next = Object.assign({}, p, { capacity: v });
  Object.assign(p, { capacity: v }); /* keep store.state.people in step with the person doc */
  await store.save('person', pid, next, `Capacity of ${p.name}: ${cur} → ${v} days/week`);
  toast('Capacity saved');
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
function linkedWork(r) {
  const ws = (r.workItems || []).map(id => store.get('workItem', id)).filter(Boolean);
  if (!ws.length) return '';
  return `<div class="pmo-rlinks"><span class="hint">Affects</span>${ws.map(w => `<a class="chip" href="${link('/project/' + encodeURIComponent(w.projectId) + '?mode=work')}" data-link>${w.kind === 'defect' ? BUG + ' ' : ''}${esc(w.title)}</a>`).join('')}</div>`;
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
          ${list.map(r => `<tr data-rid="${esc(r.id)}"><td><b>${esc(r.title)}</b><div class="hint">${esc(pn(r.projectId))}</div>${r.mitigation ? `<div class="pmo-mit">Mitigation: ${esc(r.mitigation)}</div>` : ''}${linkedWork(r)}</td>
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
    <div class="field"><label>Mitigation</label><textarea name="mitigation" maxlength="600" placeholder="What reduces the impact or likelihood?">${esc(r.mitigation)}</textarea></div>
    <div class="field"><label>Linked work items</label><div class="pmo-checks" data-risk-work>${store.list('workItem').map(w => `<label data-wprj="${esc(w.projectId)}" ${w.projectId === r.projectId ? '' : 'hidden'}><input type="checkbox" name="workItems" value="${esc(w.id)}" ${(r.workItems || []).includes(w.id) ? 'checked' : ''}/> <span>${esc(w.title)}</span> <small>${esc(fmt(w.due))}</small></label>`).join('')}</div>
      <div class="hint">Linked items show a risk badge in the project’s Work tab.</div></div>`;
  const acts = [{ id: 'save', label: isNew ? 'Add risk' : 'Save changes', primary: true }];
  if (!isNew) acts.unshift({ id: 'delete', label: 'Delete', danger: true });
  const pending = modal({ title: isNew ? 'Add risk' : 'Edit risk', body, actions: acts });
  /* filter the work list to the selected project (modal DOM exists synchronously) */
  const ov = [...document.querySelectorAll('.overlay')].pop();
  const psel = ov && ov.querySelector('select[name="projectId"]');
  if (psel) psel.addEventListener('change', () => ov.querySelectorAll('[data-wprj]').forEach(l => { const show = l.dataset.wprj === psel.value; l.hidden = !show; if (!show) l.querySelector('input').checked = false; }));
  const res = await pending;
  if (res.action === 'delete') return deleteRisk(r);
  if (res.action !== 'save') return;
  const f = res.form;
  const next = Object.assign({}, r, { projectId: f.projectId, title: (f.title || '').trim(), impact: f.impact, likelihood: f.likelihood, owner: f.owner, status: f.status, mitigation: (f.mitigation || '').trim(), workItems: (f.workItems || []).filter(id => (store.get('workItem', id) || {}).projectId === f.projectId) });
  if (!next.title) return editRisk(next, 'Describe the risk.');
  if (isNew) {
    next.id = store.newId('rsk');
    await store.save('risk', next.id, next, `Logged risk “${next.title}” (impact ${LV_LBL[next.impact]}, likelihood ${LV_LBL[next.likelihood]}${next.workItems.length ? ', ' + next.workItems.length + ' linked work item' + (next.workItems.length > 1 ? 's' : '') : ''})`);
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
  const wa = new Set(r.workItems || []), wb = new Set(next.workItems);
  const wt = id => (store.get('workItem', id) || {}).title || id;
  const wAdd = [...wb].filter(x => !wa.has(x)), wRem = [...wa].filter(x => !wb.has(x));
  if (wAdd.length) ch.push('linked ' + wAdd.map(wt).join(', '));
  if (wRem.length) ch.push('unlinked ' + wRem.map(wt).join(', '));
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
  const raw = eng('baselineVariance', [], docs(), j.id, bl.id, today()) || [];
  const rows = Array.isArray(raw) ? raw : (raw.items || raw.rows || []);
  /* Headline = project finish − latest baseline due (engine R2 projectSlipDays); never a sum of item slips. */
  let projSlip = raw.projectSlipDays;
  if (typeof projSlip !== 'number') {
    const blMax = Object.values(bl.items || {}).map(x => x && x.due).filter(Boolean).sort().slice(-1)[0];
    const fi = finishInfo(j, projectStats(j.id));
    projSlip = blMax && fi.date ? dayDiff(fi.date, blMax) : 0;
  }
  const wt = id => (store.get('workItem', id) || {}).title || 'Deleted work item';
  const worstItem = rows.reduce((a, r) => Math.max(a, r.varianceDays || 0), 0);
  const worst = rows.slice().sort((a, b) => (b.varianceDays || 0) - (a.varianceDays || 0));
  return `<div class="card"><h3>Baseline variance</h3>
    <div class="pmo-tlbar"><select class="pmo-sel" data-bl-prj aria-label="Project">${withBl.map(p => `<option value="${esc(p.id)}" ${p.id === j.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <select class="pmo-sel" data-bl-id aria-label="Baseline">${bls.map(b => `<option value="${esc(b.id)}" ${b.id === bl.id ? 'selected' : ''}>${esc(b.label || 'Baseline')} · ${esc(fmt(b.at))}</option>`).join('')}</select></div>
    <div class="pmo-var-kpis"><div class="kpi" data-proj-slip><b class="${projSlip > 0 ? 'fail' : projSlip < 0 ? 'pass' : ''}">${projSlip > 0 ? '+' : ''}${projSlip}d</b><span>Project slip (finish vs baseline)</span></div><div class="kpi"><b>${rows.filter(r => r.varianceDays > 0).length}/${rows.length}</b><span>Items later than plan</span></div><div class="kpi"><b>${worstItem ? '+' + worstItem + 'd' : '0d'}</b><span>Worst single item</span></div></div>
    <div class="hint" style="margin:-4px 0 8px">Item slips overlap through dependencies, so they are not added up. The headline is how far the project’s finish has moved.</div>
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
  on('[data-new-project]', () => newProject());
  on('[data-add-risk]', () => editRisk(null));
  on('[data-edit-risk]', el => { const r = store.get('risk', el.dataset.editRisk); if (r) editRisk(r); });
  on('[data-del-risk]', el => { const r = store.get('risk', el.dataset.delRisk); if (r) deleteRisk(r); });
  on('[data-cap]', el => editCapacity(el.dataset.cap));
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
