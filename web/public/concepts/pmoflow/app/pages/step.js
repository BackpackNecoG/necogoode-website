/* Step drill-down (stream D): /process/:pid/step/:sid. Ported from v2. */
import { store } from '../store.js';
import { esc, fmt, link, av, personChip, pname, AVAIL, LOCK, commentsPanel, historyPanel, bindActivity } from '../ui.js';
import { eng, docs, today, flat, dataEl, dataName, availOf, effDot, NEEDS_LIVE, projectsFor, STATUS_LBL, workBadge, notFound } from './process.js';

export function render(params) {
  const { pid, sid } = params;
  const p = store.get('process', pid);
  if (!p) return notFound('Process “' + pid + '”');
  const tobeSteps = flat(p.tobe), asisSteps = flat(p.asis);
  let s = tobeSteps.find(x => x.id === sid), version = 'tobe';
  if (!s) { s = asisSteps.find(x => x.id === sid); version = 'asis'; }
  if (!s) return notFound('Step “' + sid + '” in ' + p.name);
  const steps = version === 'tobe' ? tobeSteps : asisSteps;
  const i = steps.indexOf(s), prev = steps[i - 1], next = steps[i + 1];
  const data = s.data || [];
  const projects = projectsFor(pid);
  const prj = projects[0];
  const st = prj && version === 'tobe' ? eng('stepState', [docs(), prj.id, pid, sid, today()], null) : null;
  /* R3: effective availability everywhere. Red blockers are effectively-missing data only; examples-only data is amber. */
  const ready = data.filter(d => availOf(d) === 'live').length;
  const blockers = data.filter(d => availOf(d) === 'missing' && !(st && st.status === 'done'));
  const needLive = data.filter(d => availOf(d) === 'example');
  /* other steps sharing data, grouped */
  const shared = {};
  data.forEach(d => eng('impactOfData', [docs(), d], []).forEach(u => {
    if (u.pid === pid && u.stepId === sid) return;
    const k = u.pid + '/' + u.stepId; (shared[k] = shared[k] || { pid: u.pid, stepId: u.stepId, data: [] }).data.push(d);
  }));
  const sharedList = Object.values(shared).map(x => { const pp = store.get('process', x.pid); const ss = pp && flat(pp.tobe).find(y => y.id === x.stepId); return ss ? Object.assign(x, { p: pp, s: ss }) : null; }).filter(Boolean);
  const asis = version === 'tobe' && s.from ? (p.asis ? flat(p.asis).find(a => a.id === s.from) : null) : null;
  const diff = version === 'tobe' ? (eng('diffProcess', [p], { nodes: {} }).nodes || {})[sid] : null;
  const fc = eng('forecastAll', [docs(), today()], {});
  const work = store.list('workItem', w => w.pid === pid && w.step === sid).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const W = id => store.get('workItem', id);
  const schedColor = st && (st.sched === 'late' || st.sched === 'slip') ? 'var(--late)' : st && st.sched === 'soon' ? '#b45309' : 'inherit';
  const stepLink = x => link(`/process/${pid}/step/${x.id}`);
  /* UAT scripts: the project's edited set wins; otherwise the engine generates them from the design */
  let uat = [], uatSrc = '';
  if (prj && version === 'tobe') {
    const own = (prj.uatScripts || []).filter(u => u.pid === pid && u.step === sid);
    if ((prj.uatScripts || []).length) { uat = own; uatSrc = 'From the project’s UAT script set'; }
    else { uat = eng('generateUatScripts', [docs(), prj.id], []).filter(u => u.pid === pid && u.step === sid); uatSrc = 'Generated from the to-be design (not yet saved to the project)'; }
  }
  const ops = [s.sla ? ['SLA', s.sla] : null, s.system ? ['System', s.system] : null, s.durationHrs ? ['Duration', s.durationHrs + ' h'] : null].filter(Boolean);

  return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › <a href="${link('/process/' + pid + (version === 'asis' ? '?mode=asis' : ''))}" data-link>${esc(p.name)}</a> › ${version === 'asis' ? 'As-is step' : 'Step'} ${i + 1} of ${steps.length}</div>
      <h1>${esc(s.title)}</h1><div class="res">${personChip(s.owner) || '<span class="hint">No owner</span>'}${(s.touches || []).map(t => `<span class="chip touch"># ${esc(t)}</span>`).join('')}${diff === 'new' ? '<span class="chip diff-new">NEW IN TO-BE</span>' : diff === 'changed' ? '<span class="chip diff-changed">CHANGED FROM AS-IS</span>' : ''}${version === 'asis' ? '<span class="chip">AS-IS (today)</span>' : ''}</div>
      <div class="res d-opsrow">${ops.length ? ops.map(([k, v]) => `<span class="chip d-opschip"><b>${k}</b> ${esc(v)}</span>`).join('') : '<span class="hint">No SLA, system or duration set. Add them in the process editor.</span>'}</div>
      ${version === 'tobe' ? `<p style="margin-top:8px"><span class="was">${asis ? 'As-is: ' + esc(asis.title) : 'No as-is step: this is new in the to-be design'}</span></p>` : ''}</div>
    <div class="hdr-side"><div class="d-prevnext">${prev ? `<a class="btn" href="${stepLink(prev)}" data-link aria-label="Previous step: ${esc(prev.title)}">‹ ${esc(prev.title)}</a>` : ''}${next ? `<a class="btn" href="${stepLink(next)}" data-link aria-label="Next step: ${esc(next.title)}">${esc(next.title)} ›</a>` : ''}</div></div></section>
  <div class="kgrid">
    <div class="kc"><span>Project status</span><b>${st ? esc(STATUS_LBL[st.status] || st.status) : '—'}</b><small>${prj ? (st && st.items && st.items.length ? `${st.done}/${st.items.length} work items · ${esc(prj.name)}` : 'nothing to build') : 'not in a project'}</small></div>
    <div class="kc"><span>Forecast</span><b style="color:${schedColor}">${st && st.forecast ? esc(fmt(st.forecast)) : '—'}</b><small>${st && st.due ? (st.forecast > st.due ? 'planned ' + esc(fmt(st.due)) : 'on plan') : 'no work'}</small></div>
    <div class="kc"><span>Data ready</span><b>${ready}/${data.length}</b><small>live or resolved</small></div>
    <div class="kc"><span>Blockers</span><b style="color:${blockers.length ? 'var(--late)' : 'inherit'}">${blockers.length}</b><small>${blockers.length ? 'missing data' : needLive.length ? `${needLive.length} need${needLive.length === 1 ? 's' : ''} a live source` : 'none'}</small></div>
    <div class="kc"><span>Shared with</span><b>${sharedList.length}</b><small>steps using the same data</small></div>
  </div>
  <div class="two">
    <div class="card"><h3>How this step runs <span class="n">process</span></h3>${(s.subs || []).length ? `<div class="subs">${s.subs.map((x, k) => { const sd = x.data || []; const miss = sd.filter(d => availOf(d) === 'missing'); return `<div class="sub ${miss.length ? 'blocked' : ''}"><span class="dotc">${miss.length ? '!' : k + 1}</span><div><div class="t" style="font-weight:600">${esc(x.title)}</div><div class="s">${sd.length ? sd.map(d => `${effDot(d)} ${esc(dataName(d))}`).join(' &nbsp; ') : 'No data needed'}</div></div></div>`; }).join('')}</div>` : `<div class="s">No sub-steps yet. Add them in the process editor.</div>`}</div>
    <div class="card"><h3>Work to deliver it <span class="n">${work.length}</span></h3>${work.length ? work.map(w => { const f = fc[w.id] || {}; return `<a class="wi d-wi" href="${link('/project/' + w.projectId + '?mode=work')}" data-link>${av(w.owner)}<div style="flex:1;min-width:0"><div class="t" style="font-weight:600">${esc(w.title)}</div>
        <div class="dep">${esc((store.get('project', w.projectId) || {}).name || w.projectId)}${w.resolves ? ` · Makes <b>${esc(dataName(w.resolves))}</b> available` : ''}${(w.deps || []).length ? ` · After ${w.deps.map(d => { const x = W(d); return x ? esc(x.title) + (x.status === 'done' ? ' ✓' : ' (open)') : ''; }).filter(Boolean).join(', ')}` : ''}</div></div>
        <div style="text-align:right">${workBadge(w, f)}<div class="s" style="font-size:11px;margin-top:3px">${esc(fmt(w.start))} → ${esc(fmt(w.due))}</div></div></a>`; }).join('') : `<div class="s">${version === 'asis' ? 'As-is steps describe today; work is planned against to-be steps.' : 'No work items yet. Plan them on the project page.'}</div>`}</div>
  </div>
  <div class="two">
    <div class="card"><h3>Data this step needs <span class="n">${data.length}</span></h3>${data.length ? `<div class="tbl-wrap"><table><tr><th>Element</th><th>Owner</th><th>Availability</th></tr>${data.map(d => { const x = dataEl(d) || {}; return `<tr class="click" data-go="/data/${esc(d)}"><td><a href="${link('/data/' + d)}" data-link><b>${esc(x.name || d)}</b></a><div style="color:var(--ink2);font-size:12px">${esc(x.source || 'Source not set')} · ${(x.fields || []).length} fields</div></td><td>${esc(pname(x.owner))}</td><td><span class="chip">${effDot(d)}${esc(AVAIL[availOf(d)].short)}</span>${blockers.includes(d) ? `<div class="d-blk">${LOCK} blocks this step</div>` : availOf(d) === 'example' ? `<div class="d-needlive-s">${NEEDS_LIVE}</div>` : ''}</td></tr>`; }).join('')}</table></div>` : '<div class="s">No data tagged on this step.</div>'}</div>
    <div class="card"><h3>Also touched by this change <span class="n">${sharedList.length}</span></h3>${sharedList.length ? sharedList.map(x => `<div class="row click" data-go="/process/${esc(x.pid)}/step/${esc(x.stepId)}"><div><div class="t">${esc(x.s.title)}</div><div class="s">${esc(x.p.name)} · shares ${x.data.map(d => esc(dataName(d))).join(', ')}</div></div><div class="r">${av(x.s.owner)}</div></div>`).join('') : '<div class="s">No other steps share this data.</div>'}</div>
  </div>
  ${version === 'tobe' ? `<div class="card" style="margin-top:16px"><h3>UAT scripts for this step <span class="n">${uat.length}</span></h3>${prj ? `<div class="hint" style="margin:-4px 0 8px">${esc(uatSrc)} · <a href="${link('/testing/' + prj.id)}" data-link style="color:var(--accent)">Open testing ›</a></div>` : ''}
    ${uat.length ? `<div class="d-uat">${uat.map(u => `<div class="d-uatc" data-uat="${esc(u.id)}"><div class="t">${esc(u.title)}</div><dl><dt>Given</dt><dd>${esc(u.given)}</dd><dt>When</dt><dd>${esc(u.when)}</dd><dt>Then</dt><dd>${esc(u.then)}</dd></dl>${(u.data || []).length ? `<div class="s">${u.data.map(d => `${effDot(d)} ${esc(dataName(d))}`).join(' &nbsp; ')}</div>` : ''}</div>`).join('')}</div>`
      : `<div class="s">${prj ? 'No UAT scripts for this step. Unchanged steps do not need one.' : 'Link this process to a project to plan UAT.'}</div>`}</div>` : ''}
  <div class="two"><div class="card"><h3>Comments</h3>${commentsPanel('step:' + pid + '/' + sid)}</div>
    <div class="card"><h3>History <span class="n">process</span></h3><div class="hint" style="margin:-4px 0 8px">Changes to ${esc(p.name)}, which holds this step</div>${historyPanel('process:' + pid)}</div></div>`;
}

export function bind(root) { bindActivity(root); }
