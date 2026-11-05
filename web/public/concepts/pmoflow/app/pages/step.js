/* Step drill-down (stream D): /process/:pid/step/:sid. Ported from v2. */
import { store } from '../store.js';
import { esc, fmt, link, av, personChip, pname, LOCK, commentsPanel, historyPanel, bindActivity } from '../ui.js';
import { eng, docs, today, flat, dataEl, dataName, availOf, effDot, needsLive, projectsFor, STATUS_LBL, workBadge, notFound, avOf, awaitingText, evidenceTag,
  NT, isSpecial, typeDetail, calledOf, combinedStatus, builtLbl, stepImpact, impactBadge, IMPACT, availInfo, avText, isAdv, whoOf, whoAv, whoChip, isSystemName, personName, stepLate, stepData } from './process.js';
const RAG_COLOR = { green: 'var(--done)', amber: '#b45309', red: 'var(--late)', grey: 'var(--ink3)' };

/* R9 §8: the owner of a piece of information: its own owner (person or role), else whoever does this step; never "—" */
export function dataOwnerText(x, step) {
  if (x && x.ownerRole) return x.ownerRole;
  if (x && x.owner && store.person(x.owner)) return store.person(x.owner).name;
  return step ? whoOf(step) : 'Nobody yet';
}
/* "Why this date?" (R4): the engine's plain-English chain for an open work item's forecast */
function whyDate(w, f) {
  let chain = eng('explainForecast', [docs(), w.id, today()], null);
  if (!Array.isArray(chain) || !chain.length) return '';
  chain = chain.map(c => (c && typeof c === 'object' ? c.text : c)).filter(Boolean);
  if (!chain.length) return '';
  return `<details class="d-why" data-why="${esc(w.id)}"><summary>Why ${f && f.forecast ? esc(fmt(f.forecast)) : 'this date'}?</summary><ol>${chain.map(t => `<li>${esc(t)}</li>`).join('')}</ol></details>`;
}

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
  /* R9 §1: the project's status and blockers come from projectTruth (one source); a Today step has no project status */
  const truth = prj && version === 'tobe' ? eng('projectTruth', [docs(), prj.id, today()], null) : null;
  const stepIds = stepData(s);
  const blockers = truth && Array.isArray(truth.blockers) ? truth.blockers.filter(b => stepIds.includes(b.dataId)).map(b => b.dataId)
    : data.filter(d => availOf(d) === 'missing' && !(st && st.status === 'done'));
  const stepWho = truth && Array.isArray(truth.who) ? truth.who.filter(x => blockers.length && x.why === 'blocker' && blockers.some(d => String(x.ref || x.href || '').includes(d))) : [];
  const needLive = data.filter(d => availOf(d) === 'example');
  const pend = data.filter(d => availOf(d) === 'pending');
  /* R6 §6: step-level impact (steps sharing data, projects with open work here, conflicts) */
  const imp = version === 'tobe' ? stepImpact(pid, sid) : null;
  const sharedList = imp ? imp.shared : [];
  const asis = version === 'tobe' && s.from ? (p.asis ? flat(p.asis).find(a => a.id === s.from) : null) : null;
  const diff = version === 'tobe' ? (eng('diffProcess', [p], { nodes: {} }).nodes || {})[sid] : null;
  const fc = eng('forecastAll', [docs(), today()], {});
  const work = store.list('workItem', w => w.pid === pid && w.step === sid).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const W = id => store.get('workItem', id);
  const schedColor = st && stepLate(st) ? 'var(--late)' : 'inherit';
  /* R6 §2: one status combining work and data. Done work with data not live is amber "Built · awaiting live data";
     late is red, as on the project map. */
  const cs = combinedStatus(st, s);
  const late = st && cs !== 'done' && cs !== 'built' && cs !== 'none' && stepLate(st);
  const stLabel = !st ? '—' : cs === 'built' ? builtLbl() : late ? (STATUS_LBL[st.status] || st.status) + ' · Late' : (STATUS_LBL[st.status] || st.status);
  const stColor = cs === 'built' ? '#b45309' : late ? 'var(--late)' : cs === 'done' ? 'var(--done)' : 'inherit';
  const sp = isSpecial(s) ? NT[s.type] : null; const called = calledOf(s);
  const stepLink = x => link(`/process/${pid}/step/${x.id}`);
  /* UAT scripts: the project's edited set wins; otherwise the engine generates them from the design */
  let uat = [], uatSrc = '';
  if (prj && version === 'tobe') {
    const own = (prj.uatScripts || []).filter(u => u.pid === pid && u.step === sid);
    if ((prj.uatScripts || []).length) { uat = own; uatSrc = 'From the project’s business tests'; }
    else { uat = eng('generateUatScripts', [docs(), prj.id], []).filter(u => u.pid === pid && u.step === sid); uatSrc = 'Made from the Future steps (not yet saved to the project)'; }
  }
  const ops = [s.sla ? ['Time limit', s.sla] : null, s.system ? ['System', s.system] : null, s.durationHrs ? ['How long', s.durationHrs + ' h'] : null].filter(Boolean);
  const adv = isAdv();
  /* R8 §8: "who does it" reads exactly as on the map card */
  const who = whoChip(s);
  /* R8 §8: a cross-project conflict on this step is one plain line in Simple */
  const sameStep = imp ? imp.conflicts.filter(c => c.kind === 'same-step') : [];
  const others = sameStep.length ? sameStep[0].projects.map(id => store.get('project', id)).filter(j => j) : [];
  const conflictLine = sameStep.length ? `<div class="d-conflict-line" role="status" data-conflict-line><b>⚠ Another project is also changing this step.</b> <span>${esc(others.map(j => j.name).join(' and '))}${others.length ? ' have' : 'Projects have'} open work here. Agree the order of changes with the project managers.</span> <button type="button" class="btn sm" data-impact-jump>See who</button></div>` : '';

  return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> › <a href="${link('/processes')}" data-link>Processes</a> › <a href="${link('/process/' + pid + (version === 'asis' ? '?mode=asis' : ''))}" data-link>${esc(p.name)}</a> › ${version === 'asis' ? 'Today' : 'Future'} · step ${i + 1} of ${steps.length}</div>
      <h1>${sp ? `<span class="d-h1ic ${sp.cls}" title="${esc(sp.label)}">${sp.icon}</span>` : ''}${esc(s.title)}</h1>${sp ? `<div class="res d-typerow" data-step-type="${esc(s.type)}"><span class="chip d-ntchip">${esc(sp.label)}</span><span>${esc(typeDetail(s))}</span>${called && called.p ? `<a class="btn sm" href="${link('/process/' + called.p.id)}" data-link data-open-sub>Open ${esc(called.p.name)} ›</a>` : ''}</div>` : ''}<div class="res">${who || '<span class="hint">Nobody yet</span>'}${(s.touches || []).map(t => isSystemName(t) ? `<span class="chip d-syschip" title="System">${esc(t)}</span>` : `<span class="chip touch" title="Team involved">Team: ${esc(t)}</span>`).join('')}${diff === 'new' ? '<span class="chip diff-new">NEW IN FUTURE</span>' : diff === 'changed' ? '<span class="chip diff-changed">CHANGED FROM TODAY</span>' : ''}${version === 'asis' ? '<span class="chip">TODAY</span>' : ''}</div>
      ${ops.length || adv ? `<div class="res d-opsrow">${ops.length ? ops.map(([k, v]) => `<span class="chip d-opschip"><b>${k}</b> ${esc(v)}</span>`).join('') : '<span class="hint">No time limit, system or duration set. Add them under More options when you edit the step.</span>'}</div>` : ''}
      ${version === 'tobe' ? `<p style="margin-top:8px"><span class="was">${asis ? 'Today: ' + esc(asis.title) : 'New in the Future version'}</span></p>` : ''}${conflictLine}</div>
    <div class="hdr-side"><div class="d-prevnext">${prev ? `<a class="btn" href="${stepLink(prev)}" data-link aria-label="Previous step: ${esc(prev.title)}">‹ ${esc(prev.title)}</a>` : ''}${next ? `<a class="btn" href="${stepLink(next)}" data-link aria-label="Next step: ${esc(next.title)}">${esc(next.title)} ›</a>` : ''}</div></div></section>
  <div class="kgrid">
    <div class="kc" data-step-status="${esc(cs)}${late ? '-late' : ''}" data-project-label="${esc(truth ? truth.label : '')}"><span>Project status</span><b style="color:${truth ? RAG_COLOR[truth.rag] || 'inherit' : 'inherit'}">${esc(truth ? truth.label : prj ? 'Today step' : 'Not in a project')}</b><small>${prj && version === 'tobe' ? `<a href="${link('/project/' + prj.id)}" data-link>${esc(prj.name)}</a> · this step: <span style="color:${stColor}" data-step-label>${esc(stLabel === '—' ? 'nothing to build' : stLabel)}</span>${st && st.items && st.items.length ? ` (${st.done}/${st.items.length} done)` : ''}` : prj ? 'Work is planned on Future steps' : 'Add this process to a project to plan the change'}</small></div>
    <div class="kc"><span>Forecast</span><b style="color:${schedColor}">${st && st.forecast ? esc(fmt(st.forecast)) : '—'}</b><small>${st && st.due ? (st.forecast > st.due ? 'planned ' + esc(fmt(st.due)) : 'on plan') : 'no work'}</small></div>
    <div class="kc" data-kpi-info="${ready}/${data.length}"><span>${adv ? 'Information ready' : 'Information we have'}</span><b>${ready}/${data.length}</b><small>${adv ? 'connected' : data.length - ready ? `${data.length - ready} not available yet` : data.length ? 'all of it' : 'none needed'}</small></div>
    <div class="kc" data-step-blockers="${blockers.length}"><span>Blockers</span><b style="color:${blockers.length ? 'var(--late)' : 'inherit'}">${blockers.length}</b><small>${blockers.length ? `${esc(blockers.map(dataName).slice(0, 2).join(', '))} not available yet${stepWho[0] ? ` · ${esc(stepWho[0].name || personName(stepWho[0].person))} acts` : ''}` : !adv ? 'none' : pend.length ? `${pend.length} waiting for confirmation` : needLive.length ? `${needLive.length} sample only` : 'none'}</small></div>
    <div class="kc"><span>Who’s affected</span><b data-impact-kpi="${imp ? imp.status : ''}" style="color:${imp ? ({ conflict: 'var(--late)', overlap: '#b45309', clear: 'var(--done)' })[imp.status] : 'inherit'}">${imp ? esc(IMPACT[imp.status].label) : '—'}</b><small>${imp ? `${sharedList.length} step${sharedList.length === 1 ? '' : 's'} share information · ${imp.projects.length} project${imp.projects.length === 1 ? '' : 's'}` : 'Today step'}</small></div>
  </div>
  <div class="two">
    <div class="card"><h3>How this step is done</h3>${(s.subs || []).length ? `<div class="subs">${s.subs.map((x, k) => { const sd = x.data || []; const miss = sd.filter(d => availOf(d) === 'missing'); return `<div class="sub ${miss.length ? 'blocked' : ''}"><span class="dotc">${miss.length ? '!' : k + 1}</span><div><div class="t" style="font-weight:600">${esc(x.title)}</div><div class="s">${sd.length ? sd.map(d => `${effDot(d)} ${esc(dataName(d))}`).join(' &nbsp; ') : 'No information needed'}</div></div></div>`; }).join('')}</div>` : `<div class="s">No detail steps yet. Add them under More options when you edit the step.</div>`}</div>
    <div class="card"><h3>Work to deliver it <span class="n">${work.length}</span></h3>${work.length ? work.map(w => { const f = fc[w.id] || {}; return `<div class="d-wiwrap"><a class="wi d-wi" href="${link('/project/' + w.projectId + '?mode=work')}" data-link>${av(w.owner)}<div style="flex:1;min-width:0"><div class="t" style="font-weight:600">${esc(w.title)}</div>
        <div class="dep">${esc((store.get('project', w.projectId) || {}).name || w.projectId)}${w.resolves ? ` · Makes <b>${esc(dataName(w.resolves))}</b> available` : ''}${(w.deps || []).length ? ` · After ${w.deps.map(d => { const x = W(d && typeof d === 'object' ? d.id : d); return x ? '“' + esc(x.title) + '”' + (x.status === 'done' ? ' ✓' : ' (open)') : ''; }).filter(Boolean).join(', ')}` : ''}</div></div>
        <div style="text-align:right">${workBadge(w, f)}<div class="s" style="font-size:11px;margin-top:3px">${esc(fmt(w.start))} → ${esc(fmt(w.due))}</div></div></a>${w.status !== 'done' ? whyDate(w, f) : ''}</div>`; }).join('') : `<div class="s">${version === 'asis' ? 'Today steps describe how it works now; work is planned on Future steps.' : 'No work items yet. Plan them on the project page.'}</div>`}</div>
  </div>
  <div class="${imp ? 'd-onecol' : 'two'}">
    <div class="card"><h3>Information this step needs <span class="n">${data.length}</span></h3>${data.length ? `<div class="tbl-wrap"><table><tr><th>Information</th><th>Owner</th><th>Status</th></tr>${data.map(d => { const x = dataEl(d) || {}; return `<tr class="click" data-go="/data/${esc(d)}"><td><a href="${link('/data/' + d)}" data-link><b>${esc(x.name || d)}</b></a>${adv ? `<div style="color:var(--ink2);font-size:12px">${esc(x.source || 'Source not set')} · ${(x.fields || []).length} rules</div>` : ''}</td><td data-data-owner>${esc(dataOwnerText(x, s))}</td><td><span class="chip" data-eff="${availOf(d)}">${effDot(d)}${esc(avText(d))}</span>${availOf(d) === 'live' && adv ? ' ' + evidenceTag(x, true) : ''}${blockers.includes(d) ? `<div class="d-blk">${LOCK} holds up this step</div>` : availOf(d) === 'example' ? `<div class="d-needlive-s">${esc(needsLive())}</div>` : availOf(d) === 'pending' ? `<div class="d-needlive-s d-pend-s">${esc(awaitingText(d))}</div>` : ''}</td></tr>`; }).join('')}</table></div>` : '<div class="s">No information added to this step.</div>'}</div>
    ${imp ? '' : '<div class="card"><h3>Who’s affected</h3><div class="s">This is tracked on Future steps. This step shows how the process works today.</div></div>'}
  </div>
  ${imp ? impactCard(imp, pid, fc) : ''}
  ${version === 'tobe' ? `<div class="card" style="margin-top:16px" data-uat-card><h3>Business tests for this step <span class="n">${uat.length}</span></h3>${prj ? `<div class="hint" style="margin:-4px 0 8px">${esc(uatSrc)} · <a href="${link('/testing/' + prj.id)}" data-link style="color:var(--accent)">Open testing ›</a></div>` : ''}
    ${uat.length ? `<div class="d-uat">${uat.map(u => `<div class="d-uatc" data-uat="${esc(u.id)}"><div class="t">${esc(u.title)}</div><dl><dt>Given</dt><dd>${esc(u.given)}</dd><dt>When</dt><dd>${esc(u.when)}</dd><dt>Then</dt><dd>${esc(u.then)}</dd></dl>${(u.data || []).length ? `<div class="s">${u.data.map(d => `${effDot(d)} ${esc(dataName(d))}`).join(' &nbsp; ')}</div>` : ''}</div>`).join('')}</div>`
      : `<div class="s">${prj ? 'No business tests for this step. Unchanged steps do not need one.' : 'Add this process to a project to plan business testing.'}</div>`}</div>` : ''}
  <div class="two"><div class="card"><h3>Comments</h3>${commentsPanel('step:' + pid + '/' + sid)}</div>
    <div class="card"><h3>History <span class="n">process</span></h3><div class="hint" style="margin:-4px 0 8px">Changes to ${esc(p.name)}, which holds this step</div>${historyPanel('process:' + pid)}</div></div>`;
}

/* R6 §6: the step-level Impact section */
function impactCard(imp, pid, fc) {
  const shared = imp.shared, prjs = imp.projects;
  const prjLine = list => list.length ? list.map(x => `<span class="chip">${esc(x.prj.name)} · ${x.items.length} open</span>`).join(' ') : '';
  return `<div class="card d-impcard" id="impact" data-step-impact="${imp.status}" style="margin-top:16px"><h3>Who’s affected ${impactBadge(imp.status)}</h3>
    <div class="d-impgrid">
      <div data-imp-shared="${shared.length}"><h4>Steps that use the same information <span class="n">${shared.length}</span></h4>${shared.length ? shared.map(x => `<div class="row click" data-go="/process/${esc(x.pid)}/step/${esc(x.stepId)}" data-shared-step="${esc(x.stepId)}"><div style="min-width:0"><div class="t">${esc(x.s.title)}</div><div class="s">${x.pid === pid ? 'This process' : esc(x.p.name)} · also uses ${x.data.map(d => esc(dataName(d))).join(', ')}</div>${x.projects.length ? `<div class="d-impchips">${prjLine(x.projects)}</div>` : ''}</div><div class="r">${x.s.ownerRole ? `<span class="d-rolesm" data-who>${esc(x.s.ownerRole)}</span>` : whoAv(x.s)}</div></div>`).join('') : '<div class="s">No other step uses this step’s information.</div>'}</div>
      <div data-imp-projects="${prjs.length}"><h4>Projects with open work here <span class="n">${prjs.length}</span></h4>${prjs.length ? prjs.map(x => { const next = x.items.slice().sort((a, b) => String(a.due).localeCompare(String(b.due)))[0]; return `<div class="row click" data-go="/project/${esc(x.prj.id)}?mode=work" data-imp-prj="${esc(x.prj.id)}"><div style="min-width:0"><div class="t">${esc(x.prj.name)}</div><div class="s">${x.items.length} open item${x.items.length === 1 ? '' : 's'} · PM ${esc(pname(x.prj.owner))}${x.prj.status === 'live' ? ' · live' : ''}</div></div><div class="r">${workBadge(next, fc[next.id])}</div></div>`; }).join('') : '<div class="s">No project has open work on this step.</div>'}</div>
      <div data-imp-conflicts="${imp.conflicts.length}"><h4>Conflicts <span class="n">${imp.conflicts.length}</span></h4>${imp.conflicts.length ? imp.conflicts.map(c => `<div class="d-conf d-conf-${c.level}" data-conflict="${esc(c.kind)}"><b>${esc(IMPACT[c.level].label)}</b> ${esc(c.text)}</div>`).join('') : `<div class="s pass">${prjs.length ? 'Only one project is changing this step, and no other project is changing a step that uses the same information.' : 'Nothing is changing this step right now.'}</div>`}</div>
    </div></div>`;
}

export function bind(root) {
  bindActivity(root);
  const j = root.querySelector('[data-impact-jump]');
  if (j) j.onclick = () => { const c = root.querySelector('#impact'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
}
