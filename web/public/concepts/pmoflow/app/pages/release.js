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
  'discovered-resolved': p => ({ href: `/testing/${p}`, label: 'Resolve on the testing page' }),
  'process-valid': () => null, /* per-item links to the process editor */
  'cutover-plan': () => ({ anchor: 'cutover', label: 'Jump to cutover plan' }),
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

/* Contract R2: an approval is stale when a work item or process in that BU's section changed after it (updatedAt > approval.at). */
function refView(ref, prjId) {
  const m = /^(\w+):(.+)$/.exec(String(ref || '')); if (!m) return { text: String(ref || ''), extra: '', href: null };
  if (m[1] === 'workItem') { const w = store.get('workItem', m[2]); return w ? { text: w.title, extra: `work item · ${pname(w.owner)}${w.updatedAt ? ' · changed ' + fmtTime(w.updatedAt) : ''}`, href: `/project/${prjId}?mode=work` } : { text: m[2], extra: 'work item', href: null }; }
  if (m[1] === 'process') { const p = store.get('process', m[2]); return { text: `${p ? p.name : m[2]} (process edited)`, extra: p && p.updatedAt ? 'changed ' + fmtTime(p.updatedAt) : '', href: `/process/${m[2]}?mode=diff` }; }
  return { text: ref, extra: '', href: null };
}
function staleChanges(prj, section, a, rd) {
  if (!a || a.decision !== 'approved') return [];
  /* Prefer the engine's verdict so the card and the gate never disagree. */
  const chk = rd && (rd.checks || []).find(c => c.id === 'bu-signoff');
  if (chk && Array.isArray(chk.stale)) { const x = chk.stale.find(y => y.bu === section.bu); return x ? (x.changed || []).map(r => refView(r, prj.id)) : []; }
  const at = String(a.at || '');
  const keys = new Set(section.steps.map(x => x.pid + '|' + x.step.id));
  const buPeople = new Set(store.state.people.filter(p => p.bu === section.bu).map(p => p.id));
  const out = [];
  store.list('workItem', w => w.projectId === prj.id && w.updatedAt && String(w.updatedAt) > at && (keys.has(w.pid + '|' + w.step) || buPeople.has(w.owner)))
    .forEach(w => out.push({ text: w.title, extra: `work item · ${pname(w.owner)} · changed ${fmtTime(w.updatedAt)}`, href: `/project/${prj.id}?mode=work` }));
  [...new Set(section.steps.map(x => x.pid))].map(id => store.get('process', id)).filter(p => p && p.updatedAt && String(p.updatedAt) > at)
    .forEach(p => out.push({ text: `${p.name} (process edited)`, extra: `changed ${fmtTime(p.updatedAt)}`, href: `/process/${p.id}?mode=diff` }));
  return out;
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
const CO_LABEL = { rollbackOwner: 'Rollback owner not set', rollbackPlan: 'Rollback plan not written', hypercareOwner: 'Hypercare owner not set' };
function itemView(item, checkId, prjId, chk) {
  if (item == null) return { text: '' };
  if (typeof item !== 'object') {
    const s = String(item);
    if (checkId === 'cutover-plan') return { text: CO_LABEL[s] || s, href: null };
    if (checkId === 'bu-signoff') { const st = ((chk && chk.stale) || []).find(x => x.bu === s); return { text: s, extra: st ? st.reason : 'awaiting sign-off' }; }
    const dm = /^(.+)#(\d+)$/.exec(s);
    if (dm && store.get('dataElement', dm[1])) { const de = store.get('dataElement', dm[1]); const d = (de.discovered || [])[+dm[2]] || {}; return { text: d.text || de.name, extra: `${de.name} · owner ${pname(de.owner)}`, href: `/testing/${prjId}?de=${dm[1]}` }; }
    if (checkId === 'process-valid') { const pm = /^([^:]+):(.+)$/.exec(s); const pr = (((chk && chk.problems) || []).find(x => x.pid + ':' + x.node === s) || {}); const proc = pm && store.get('process', pm[1]); return { text: pr.problem || s, extra: proc ? proc.name : '', href: pm ? `/process/${pm[1]}?mode=edit` : null }; }
    if (checkId === 'tests-passed' && !store.get('workItem', s) && !store.get('testCase', s)) { const prj = store.get('project', prjId) || {}; const e = E(); let sc = (prj.uatScripts || []).find(x => x.id === s); if (!sc && e && e.generateUatScripts) { try { sc = e.generateUatScripts(store.state.docs, prjId).find(x => x.id === s); } catch (err) { sc = null; } } if (sc) return { text: sc.title, extra: 'UAT script', href: `/testing/${prjId}` }; }
    if (store.get('dataElement', s)) return { text: store.get('dataElement', s).name, href: checkId === 'discovered-resolved' ? `/testing/${prjId}?de=${s}` : '/data/' + s };
    if (store.get('process', s)) return { text: store.get('process', s).name, href: `/process/${s}?mode=edit` };
    if (store.get('workItem', s)) { const w = store.get('workItem', s); return { text: w.title, extra: `${w.kind === 'defect' ? 'open defect · ' : ''}${pname(w.owner)} · ${w.status === 'prog' ? 'in progress' : w.status === 'done' ? 'done' : 'not started'}`, href: w.kind === 'defect' ? `/testing/${prjId}` : `/project/${prjId}?mode=work` }; }
    if (store.get('testCase', s)) { const c = store.get('testCase', s); const de = store.get('dataElement', c.dataId); return { text: `${de ? de.name + ' · ' : ''}${c.field}: ${c.input === '' ? '(empty)' : c.input}`, extra: `${c.kind}, expect ${c.expect}`, href: `/testing/${prjId}` }; }
    if (store.get('grant', s)) { const g = store.get('grant', s); const de = store.get('dataElement', g.dataId); return { text: `${de ? de.name : g.dataId} · ${String(g.env).toUpperCase()} ${g.access}`, extra: g.status === 'active' ? 'active, expires at go-live' : g.status }; }
    if (store.person(s)) { const p = store.person(s); return { text: p.name, extra: `${p.role}${p.bu ? ' · ' + p.bu : ''}` }; }
    return { text: s, href: checkId === 'tests-passed' ? `/testing/${prjId}` : null };
  }
  const refM = /^(\w+):(.+)$/.exec(item.ref || '');
  const dataId = item.dataId || (item.type === 'dataElement' ? item.id : null) || (refM && refM[1] === 'dataElement' ? refM[2] : null);
  const workId = item.workId || (item.type === 'workItem' ? item.id : null) || (refM && refM[1] === 'workItem' ? refM[2] : null);
  const pid = item.pid || item.processId || (refM && refM[1] === 'process' ? refM[2] : null);
  const proc = pid ? store.get('process', pid) : null;
  const w = workId ? store.get('workItem', workId) : null;
  const de = dataId ? store.get('dataElement', dataId) : null;
  const text = item.label || item.title || item.text || item.summary || item.name || item.issue || item.detail || (w && w.title) || (de && de.name) || (proc && proc.name) || item.bu || item.id || '';
  let href = null;
  const nodeId = item.nodeId || item.stepId || item.step;
  if (checkId === 'discovered-resolved' && dataId) href = `/testing/${prjId}?de=${dataId}`;
  else if (checkId === 'cutover-plan') href = null;
  else if (pid && !w) href = nodeId && checkId !== 'process-valid' ? `/process/${pid}/step/${nodeId}` : `/process/${pid}?mode=edit`;
  else if (checkId === 'data-live' && dataId) href = '/data/' + dataId;
  else if (checkId === 'work-done' || w) href = `/project/${prjId}?mode=work`;
  else if (checkId === 'tests-passed') href = `/testing/${prjId}`;
  else if (de) href = '/data/' + dataId;
  const extra = item.reason || item.status || (item.detail && item.detail !== text ? item.detail : '') || (proc && text !== proc.name ? proc.name : '') || (de && text !== de.name ? de.name : '') || '';
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
  const lastGo = releases.find(r => !isRollback(r));
  const gateSub = live ? `Live since ${fmt(lastGo && lastGo.at)}. Every integration grant was closed at go-live.`
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
      <div class="rl-items">${items.map(it => { const v = itemView(it, c.id, prjId, c); return `<div class="rl-item">${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : `<span>${esc(v.text)}</span>`}${v.extra ? `<small>${esc(v.extra)}</small>` : ''}</div>`; }).join('') || `<div class="hint">${st === 'pass' ? 'Nothing outstanding.' : 'No item detail.'}</div>`}
        ${lkHtml ? `<div class="rl-item-foot">${lkHtml}</div>` : ''}</div></details>`;
  }).join('') || '<div class="empty">Readiness checks are not available yet.</div>';

  return header + `<div class="grid rl-grid"><div class="rl-main">
    ${ui.reasons ? `<div class="banner rl-reasons" data-reasons><b>Go-live was refused by the server.</b><ul>${ui.reasons.map(r => `<li>${esc(typeof r === 'string' ? r : (r.label || r.detail || JSON.stringify(r)))}</li>`).join('')}</ul></div>` : ''}
    <div class="card"><h3>Readiness checklist<span class="n">${rd.checks.length - failing}/${rd.checks.length} passing</span></h3>${checks}</div>
    ${cutoverCard(prj)}
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
  const live = prj.status === 'live';
  const staleBy = {}; sections.forEach(s => { staleBy[s.bu] = live ? [] : staleChanges(prj, s, latestApproval(prj.id, s.bu), rd); });
  const approved = sections.map(s => latestApproval(prj.id, s.bu)).filter(a => a && a.decision === 'approved' && a.stepUp && !(staleBy[a.bu] || []).length);
  const approvers = [...new Set(approved.map(a => a.approver))];
  const exc = (rd.checks.find(c => c.id === 'exceptions') || {}).items || [];
  const cards = sections.map(s => {
    const a = latestApproval(prj.id, s.bu);
    const mine = me.bu === s.bu;
    const eligible = store.state.people.filter(p => p.bu === s.bu);
    const stale = staleBy[s.bu] || [];
    const state = a ? (a.decision === 'approved' && stale.length ? 'stale' : a.decision) : 'pending';
    const stCls = state === 'approved' ? 'b-done' : state === 'rejected' || state === 'stale' ? 'b-late' : 'b-soon';
    const stTxt = { pending: 'Awaiting sign-off', approved: 'Signed off', rejected: 'Rejected', stale: 'Re-approval needed' }[state];
    return `<div class="rl-bu ${state}" data-bu="${esc(s.bu)}">
      <div class="rl-bu-h"><b>${esc(s.bu)}</b>${badge(stTxt, stCls)}</div>
      ${stale.length ? `<div class="rl-stale" data-stale="${esc(s.bu)}"><b>Re-approval needed: changed after sign-off</b><ul>${stale.map(v => `<li>${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : esc(v.text)} <small>${esc(v.extra)}</small></li>`).join('')}</ul></div>` : ''}
      <ol class="rl-steps">${s.steps.map(x => `<li><a href="${link(`/process/${x.pid}/step/${x.step.id}`)}" data-link>${esc(x.step.title)}</a> <small>${esc(pname(x.step.owner))} · ${esc(x.pname)}</small></li>`).join('')}</ol>
      ${a ? `<div class="rl-signed">${av(a.approver)} <span>${esc(pname(a.approver))} ${a.decision === 'approved' ? 'approved' : 'rejected'} · ${esc(fmtTime(a.at))}${a.stepUp ? ' · <span class="rl-mfa">MFA verified</span>' : ''}</span></div>${a.note ? `<div class="hint">“${esc(a.note)}”</div>` : ''}` : ''}
      ${live ? '' : `<div class="rl-bu-act">${mine
        ? `<button class="btn sm primary" data-signoff="approved" data-bu="${esc(s.bu)}">${a && a.decision === 'approved' ? 'Re-approve' : 'Approve section'}</button><button class="btn sm danger" data-signoff="rejected" data-bu="${esc(s.bu)}">Reject</button>`
        : `<button class="btn sm" disabled>${stale.length ? 'Re-approve' : 'Approve section'}</button><span class="hint" data-why>Switch 'Viewing as' to ${/^[AEIOU]/i.test(s.bu) ? 'an' : 'a'} ${esc(s.bu)} person to sign off${eligible.length ? ` (${esc(eligible.map(p => p.name).join(', '))})` : ''}.</span>`}</div>`}</div>`;
  }).join('');
  const two = approvers.length >= 2;
  return `<div class="card" id="signoff"><h3>Business-unit sign-off<span class="n">${approved.length}/${sections.length} signed</span></h3>
    <div class="rl-two ${two ? 'ok' : ''}"><span class="rl-ic ${two ? 'pass' : 'fail'}">${two ? ICON.pass : ICON.fail}</span>
      <div><b>Two-person rule</b> · ${approvers.length} distinct approver${approvers.length === 1 ? '' : 's'} ${approvers.map(av).join('')}<div class="hint">Go-live needs at least two different people to have signed off, each with step-up MFA.</div></div></div>
    ${exc.length && !Object.values(staleBy).some(x => x.length) ? `<div class="rl-exc"><b>Changes after sign-off</b> · listed by the gate. Re-approve the section to clear them.</div>` : ''}
    <div class="rl-bus">${cards || '<div class="empty">No owned steps in the linked to-be processes yet.</div>'}</div></div>`;
}

function cutoverCard(prj) {
  const c = prj.cutover || {};
  const canEdit = store.state.me === prj.owner;
  const need = [['rollbackOwner', 'rollback owner'], ['rollbackPlan', 'rollback plan'], ['hypercareOwner', 'hypercare owner']].filter(([k]) => !String(c[k] || '').trim()).map(x => x[1]);
  const row = (label, html, key) => `<div class="rl-co-r" data-co="${key}"><span class="lbl">${esc(label)}</span><div>${html || '<span class="hint">Not set</span>'}</div></div>`;
  return `<div class="card" id="cutover"><h3>Cutover plan<span class="n">${need.length ? 'incomplete' : 'complete'}</span></h3>
    <div class="rl-co-st ${need.length ? 'fail' : 'pass'}"><span class="rl-ic ${need.length ? 'fail' : 'pass'}">${need.length ? ICON.fail : ICON.pass}</span>
      <span>${need.length ? `Gate item: add the ${esc(need.join(', '))}.` : 'Gate item satisfied: rollback and hypercare are owned.'}</span></div>
    ${!prj.cutover ? '<div class="empty rl-co-empty">No cutover plan yet. Name a rollback owner, write the rollback plan and set hypercare before go-live.</div>' : `<div class="rl-co">
      ${row('Cutover window', esc(c.window || ''), 'window')}
      ${row('Rollback owner', c.rollbackOwner ? `${av(c.rollbackOwner)} ${esc(pname(c.rollbackOwner))}` : '', 'rollbackOwner')}
      ${row('Rollback plan', c.rollbackPlan ? `<span class="rl-pre-line">${esc(c.rollbackPlan)}</span>` : '', 'rollbackPlan')}
      ${row('Hypercare', c.hypercareOwner || c.hypercareDays ? `${c.hypercareDays ? esc(c.hypercareDays) + ' days' : ''}${c.hypercareOwner ? ` · ${av(c.hypercareOwner)} ${esc(pname(c.hypercareOwner))}` : ''}` : '', 'hypercare')}
      ${row('Communications', c.comms ? `<span class="rl-pre-line">${esc(c.comms)}</span>` : '', 'comms')}
    </div>`}
    <div class="rl-bu-act">${canEdit ? `<button class="btn sm primary" data-cutover-edit>${prj.cutover ? 'Edit cutover plan' : 'Add cutover plan'}</button>`
      : `<button class="btn sm" disabled>Edit cutover plan</button><span class="hint" data-why>Only the project owner (${esc(pname(prj.owner))}) can edit the cutover plan.</span>`}</div></div>`;
}

async function editCutover(prj) {
  if (store.state.me !== prj.owner) { toast(`Only the project owner (${pname(prj.owner)}) can edit the cutover plan.`); return; }
  const c = prj.cutover || {};
  const ppl = store.state.people;
  const sel = (name, v) => `<select name="${name}"><option value="">Choose a person</option>${ppl.map(p => `<option value="${esc(p.id)}" ${p.id === v ? 'selected' : ''}>${esc(p.name)} · ${esc(p.role)}</option>`).join('')}</select>`;
  const r = await modal({
    title: 'Cutover plan',
    body: `<div class="field"><label>Cutover window</label><input name="window" value="${esc(c.window || '')}" placeholder="e.g. Sat 06:00–10:00 CT, payment run frozen"></div>
      <div class="field"><label>Rollback owner</label>${sel('rollbackOwner', c.rollbackOwner)}</div>
      <div class="field"><label>Rollback plan</label><textarea name="rollbackPlan" placeholder="Trigger, steps and who decides">${esc(c.rollbackPlan || '')}</textarea></div>
      <div class="frow"><div class="field"><label>Hypercare days</label><input type="number" min="0" max="90" name="hypercareDays" value="${esc(c.hypercareDays == null ? 10 : c.hypercareDays)}"></div>
        <div class="field"><label>Hypercare owner</label>${sel('hypercareOwner', c.hypercareOwner)}</div></div>
      <div class="field"><label>Communications</label><textarea name="comms" placeholder="Who is told what, and when">${esc(c.comms || '')}</textarea></div>
      <div class="hint">Rollback owner, rollback plan and hypercare owner are required by the go-live gate.</div>`,
    actions: [{ id: 'save', label: 'Save plan', primary: true }],
  });
  if (r.action !== 'save') return;
  const f = r.form;
  const days = Math.max(0, Math.min(90, parseInt(f.hypercareDays, 10) || 0));
  const cutover = { window: (f.window || '').trim(), rollbackOwner: f.rollbackOwner || '', rollbackPlan: (f.rollbackPlan || '').trim(), hypercareDays: days, hypercareOwner: f.hypercareOwner || '', comms: (f.comms || '').trim() };
  const cur = store.get('project', prj.id) || prj;
  await store.save('project', prj.id, Object.assign({}, cur, { cutover }), `Updated the cutover plan for ${prj.name}`);
  await store.notify([cutover.rollbackOwner, cutover.hypercareOwner], `${pname(store.state.me)} named you in the cutover plan for ${prj.name}`, 'project:' + prj.id);
  toast('Cutover plan saved');
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
    ${!rd.pass && !live ? `<div class="hint" style="margin-top:6px">${rd.checks.filter(c => checkState(c) === 'fail').map(c => esc(c.label)).join(' · ')}</div>` : ''}
    ${live ? rollbackBlock(prj, procs) : ''}</div>`;
}

function canRollback(prj) { const me = store.state.me; return !!me && (me === prj.owner || me === (prj.cutover || {}).rollbackOwner); }
function rollbackBlock(prj, procs) {
  const rbo = (prj.cutover || {}).rollbackOwner;
  const prev = procs.filter(p => (p.version || 1) > 1);
  return `<div class="rl-rb"><div class="hint">${prev.length ? `Rolling back restores ${prev.map(p => `${esc(p.name)} v${esc((p.version || 1) - 1)}`).join(', ')} as the as-is version.` : 'No previous version to restore.'}</div>
    ${canRollback(prj) ? `<button class="btn danger rl-gobtn" data-rollback ${prev.length ? '' : 'disabled'}>Roll back release</button>`
      : `<button class="btn rl-gobtn" disabled>Roll back release</button><div class="hint" data-why>Only the project owner (${esc(pname(prj.owner))})${rbo && rbo !== prj.owner ? ` or the rollback owner (${esc(pname(rbo))})` : ''} can roll back.</div>`}</div>`;
}

function actionView(a) {
  const det = a.detail == null ? '' : typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail, null, 2);
  const label = { pipeline: 'Deployment pipeline', 'sop-publish': 'Publish SOP', notify: 'Notify stakeholders' }[a.type] || a.type;
  return `<div class="rl-act"><div class="rl-act-h"><b>${esc(label)}</b><span class="hint">${esc(a.target || '')}</span>
    <span class="sim">Simulated</span>${badge(a.status || 'simulated-ok', 'b-done')}</div>
    ${det ? (a.type === 'pipeline' || typeof a.detail === 'object' ? `<pre class="rl-pre">${esc(det)}</pre>` : `<div class="hint">${esc(det)}</div>`) : ''}</div>`;
}

const isRollback = r => r.kind === 'rollback';
function exceptionView(x, prjId) {
  if (typeof x === 'string') { const w = store.get('workItem', x); return { text: w ? w.title : x, href: w ? `/project/${prjId}?mode=work` : null }; }
  const v = itemView(x, 'exceptions', prjId);
  const by = x.by ? pname(x.by) : '';
  const extra = [x.summary && x.summary !== v.text ? x.summary : '', x.note && x.note !== v.text ? x.note : '', by, x.at ? fmtTime(x.at) : ''].filter(Boolean).join(' · ');
  return { text: v.text, href: v.href, extra };
}
function releaseRecord(r) {
  const snap = r.snapshot || {};
  const rb = isRollback(r);
  const exc = r.exceptions || [];
  return `<div class="rl-rec" data-release="${esc(r.id)}" data-kind="${rb ? 'rollback' : 'golive'}">
    <div class="rl-rec-h">${badge(rb ? 'Rollback' : 'Go-live', rb ? 'b-late' : 'b-done')} <b>${esc(fmtTime(r.at))}</b> · ${rb ? 'rolled back' : 'released'} by ${av(r.by)} ${esc(pname(r.by))}</div>
    ${rb ? (r.reason || r.note ? `<div class="rl-rec-s"><span class="lbl">Reason</span>${esc(r.reason || r.note)}</div>` : '')
      : `<div class="rl-rec-s"><span class="lbl">Approvers</span>${(r.approvers || []).map(id => `${av(id)}<span class="rl-nm">${esc(pname(id))}</span>`).join(' ') || '—'}</div>`}
    <div class="rl-rec-s"><span class="lbl">${rb ? 'Restored versions' : 'Released versions'}</span>${Object.keys(snap).map(pid => { const p = store.get('process', pid); return `<a class="chip" href="${link('/process/' + pid)}" data-link data-ver="${esc(pid)}">${esc(p ? p.name : pid)} · v${esc(snap[pid])}</a>`; }).join(' ') || '—'}</div>
    ${rb ? '' : `<div class="rl-rec-s rl-rec-exc" data-exceptions="${exc.length}"><span class="lbl">Exceptions · changed after an approval</span>${exc.length
      ? `<ul>${exc.map(x => { const v = exceptionView(x, r.projectId); return `<li>${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : esc(v.text)}${v.extra ? ` <small>${esc(v.extra)}</small>` : ''}</li>`; }).join('')}</ul>`
      : '<span class="hint">None. Nothing changed after its business unit signed off.</span>'}</div>`}
    <div class="rl-acts-list">${(r.actions || []).map(actionView).join('')}</div></div>`;
}

function releaseCards(prj, releases) {
  if (!releases.length) return `<div class="card"><h3>Release history</h3><div class="hint">No releases yet. The release record and its pipeline request appear here after go-live.</div></div>`;
  const latest = releases[0];
  const fresh = ui.lastRelease === latest.id;
  const rbLatest = isRollback(latest);
  return `<div class="card rl-latest ${fresh ? 'fresh' : ''} ${rbLatest ? 'rb' : ''}"><h3>${fresh ? (rbLatest ? 'Rollback complete' : 'Release complete') : (rbLatest ? 'Latest rollback' : 'Latest release')}</h3>${releaseRecord(latest)}</div>
    <div class="card"><h3>Release history<span class="n">${releases.length}</span></h3>${releases.map(r => { const n = Object.keys(r.snapshot || {}).length; return `<div class="row click" data-relrow="${esc(r.id)}" data-kind="${isRollback(r) ? 'rollback' : 'golive'}"><div><div class="t">${isRollback(r) ? 'Rollback' : 'Go-live'} · ${esc(fmtTime(r.at))}</div><div class="s">${esc(pname(r.by))} · ${isRollback(r) ? `${n} process version${n === 1 ? '' : 's'} restored` : `${(r.actions || []).length} actions · ${(r.exceptions || []).length} exception${(r.exceptions || []).length === 1 ? '' : 's'}`}</div></div><div class="r">${badge(isRollback(r) ? 'rolled back' : 'simulated-ok', isRollback(r) ? 'b-late' : 'b-done')}</div></div>${ui.showRel.has(r.id) && r.id !== latest.id ? releaseRecord(r) : ''}`; }).join('')}</div>`;
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
    const prev = latestApproval(prjId, bu);
    const re = decision === 'approved' && prev && prev.decision === 'approved';
    const id = store.newId('apr'); const at = new Date().toISOString();
    await store.save('approval', id, { id, projectId: prjId, bu, approver: store.state.me, decision, at, snapshotAt: at, stepUp: true, note },
      `${decision === 'approved' ? (re ? 'Re-approved' : 'Approved') : 'Rejected'} the ${bu} section of ${prj.name} (step-up verified)`);
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
  const rb = root.querySelector('[data-rollback]');
  if (rb) rb.onclick = () => rollBack(prj);
  const ce = root.querySelector('[data-cutover-edit]');
  if (ce) ce.onclick = () => editCutover(prj);
  root.querySelectorAll('[data-relrow]').forEach(r => r.onclick = () => { const id = r.dataset.relrow; ui.showRel.has(id) ? ui.showRel.delete(id) : ui.showRel.add(id); store.emit(); });

  bindActivity(root);
  bindAudit(root, prj);
}

async function bindAudit(root, prj) {
  const box = root.querySelector('[data-rl-history]'); if (!box) return;
  const refs = new Set(['project:' + prj.id]);
  ['grant', 'approval', 'release'].forEach(t => store.list(t, d => d.projectId === prj.id).forEach(d => refs.add(t + ':' + d.id)));
  (prj.processes || []).forEach(p => refs.add('process:' + p));
  const evs = (await store.events(null, 100)).filter(e => refs.has(e.ref) && (e.action !== 'update' || !String(e.ref).startsWith('process:'))).slice(0, 20);
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

/* Changes made after a BU's first sign-off in this release cycle (they forced a re-approval). The engine's own
   exceptions list only un-re-approved changes, which block, so at a passing gate it is empty; this keeps the audit trail. */
function cycleExceptions(prj) {
  const lastGo = store.list('release', r => r.projectId === prj.id && r.kind !== 'rollback').map(r => String(r.at)).sort().pop() || '';
  const sections = buSections(prj);
  const stepBu = {}; sections.forEach(s => s.steps.forEach(x => { stepBu[x.pid + '|' + x.step.id] = s.bu; }));
  const buOf = w => stepBu[w.pid + '|' + w.step] || (store.person(w.owner) || {}).bu;
  const out = [];
  sections.forEach(sec => {
    const apr = store.list('approval', a => a.projectId === prj.id && a.bu === sec.bu && a.decision === 'approved' && String(a.at) > lastGo).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    if (apr.length < 2) return;
    const first = String(apr[0].at), last = apr[apr.length - 1];
    store.list('workItem', w => w.projectId === prj.id && w.updatedAt && String(w.updatedAt) > first && String(w.updatedAt) <= String(last.at) && buOf(w) === sec.bu)
      .forEach(w => out.push({ ref: 'workItem:' + w.id, summary: `“${w.title}” (work item, owner ${pname(w.owner)}) changed after the ${sec.bu} sign-off; re-approved by ${pname(last.approver)}`, by: pname(w.owner), at: w.updatedAt }));
    [...new Set(sec.steps.map(x => x.pid))].map(id => store.get('process', id)).filter(p => p && p.updatedAt && String(p.updatedAt) > first && String(p.updatedAt) <= String(last.at))
      .forEach(p => out.push({ ref: 'process:' + p.id, summary: `“${p.name}” (process) changed after the ${sec.bu} sign-off; re-approved by ${pname(last.approver)}`, by: pname(p.owner), at: p.updatedAt }));
  });
  const seen = new Set(); return out.filter(x => !seen.has(x.ref) && seen.add(x.ref));
}

async function goLive(prj) {
  const rd = readiness(prj.id);
  if (!rd.pass) { toast('The gate is not passing yet.'); return; }
  const procs = projectProcesses(prj);
  const sections = buSections(prj);
  const approvers = [...new Set(sections.map(s => latestApproval(prj.id, s.bu)).filter(a => a && a.decision === 'approved').map(a => a.approver))];
  const openGrants = store.list('grant', g => g.projectId === prj.id && ['active', 'approved'].includes(grantStatus(g))).length;
  const excs = cycleExceptions(prj);
  const r = await modal({
    title: `Release ${prj.name}`,
    body: `<div class="rl-sum">
      <div><span class="lbl">Processes promoted</span>${procs.map(p => `<div>${esc(p.name)} <b>v${esc(p.version || 1)} → v${esc((p.version || 1) + 1)}</b></div>`).join('')}</div>
      <div><span class="lbl">Signed off by</span>${approvers.map(id => `<div>${av(id)} ${esc(pname(id))}</div>`).join('')}</div>
      <div><span class="lbl">Access</span><div>${openGrants} open grant${openGrants === 1 ? '' : 's'} will expire now</div></div>
      <div><span class="lbl">Exceptions recorded</span><div>${excs.length ? `${excs.length} change${excs.length === 1 ? '' : 's'} made after a sign-off and re-approved` : 'None'}</div></div>
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
    const saved = ui.lastRelease && store.get('release', ui.lastRelease);
    if (saved && !(saved.exceptions || []).length && excs.length) {
      await store.save('release', saved.id, Object.assign({}, saved, { exceptions: excs }), `Recorded ${excs.length} exception${excs.length === 1 ? '' : 's'} on the ${prj.name} release (changes re-approved after sign-off)`);
    }
    store.emit();
    toast(`${prj.name} is live`);
  } catch (e) {
    if (e.status === 409) { ui.reasons = (e.body && e.body.reasons && e.body.reasons.length) ? e.body.reasons : [e.message]; store.emit(); toast('Go-live refused. See the reasons above the checklist.'); }
    else toast('Go-live failed: ' + e.message);
  }
}

async function rollBack(prj) {
  if (!canRollback(prj)) { toast('Only the project owner or the rollback owner can roll back.'); return; }
  const procs = projectProcesses(prj);
  const r = await modal({
    title: `Roll back ${prj.name}?`,
    body: `<p style="margin:0 0 8px">This restores the previous as-is version of each process and sets the project back to active. The released version stays in history.</p>
      <div class="rl-sum"><div><span class="lbl">Processes restored</span>${procs.map(p => `<div>${esc(p.name)} <b>v${esc(p.version || 1)} → v${esc(Math.max(1, (p.version || 1) - 1))}</b></div>`).join('')}</div>
      <div><span class="lbl">Rollback plan</span><div>${esc((prj.cutover || {}).rollbackPlan || 'No plan recorded')}</div></div></div>
      <div class="field" style="margin-top:10px"><label>Reason</label><textarea name="reason" placeholder="What went wrong?"></textarea></div>`,
    actions: [{ id: 'rollback', label: 'Continue to verify', danger: true }],
  });
  if (r.action !== 'rollback') return;
  if (!(await stepUp('roll back the release'))) { toast('Step-up not completed. Nothing was rolled back.'); return; }
  try {
    const res = await store.api('/rollback/' + prj.id, { reason: (r.form.reason || '').trim() });
    await store.load();
    const latest = store.list('release', x => x.projectId === prj.id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    ui.lastRelease = (res && res.release && res.release.id) || (latest && latest.id) || null;
    store.emit();
    toast(`${prj.name} rolled back`);
  } catch (e) { toast('Rollback failed: ' + e.message); }
}
