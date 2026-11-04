/* Release page (stream R): readiness gate, BU sign-off, project-scoped access grants, go-live + release history.
   Route: /release/:prj */
import { store } from '../store.js';
import { E, esc, fmt, fmtTime, days, addDays, link, go, av, pname, badge, chip, modal, stepUp, toast, commentsPanel, bindActivity, formValues } from '../ui.js';

/* Module state survives the router's full re-render on every store change. */
const ui = { open: new Set(), lastRelease: null, reasons: null, showRel: new Set(), pipe: null };

const ICON = { pass: '✓', fail: '✕', warn: '!' };
const LOCKI = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
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

/* Audit lines use names, never ids: swap any known doc id in an event summary for its name. */
function idNames() {
  const m = {};
  store.list('dataElement').forEach(d => { m[d.id] = d.name; });
  store.list('workItem').forEach(w => { m[w.id] = w.title; });
  store.list('process').forEach(p => { m[p.id] = p.name; });
  store.list('testRun').forEach(r => { m[r.id] = `${String(r.env).toUpperCase()} run, ${fmt(r.at)}`; });
  store.list('testCase').forEach(c => { const de = store.get('dataElement', c.dataId); m[c.id] = `${de ? de.name + ' · ' : ''}${c.field} test`; });
  store.list('grant').forEach(g => { const de = store.get('dataElement', g.dataId); m[g.id] = `${de ? de.name : 'data'} ${String(g.env).toUpperCase()} access`; });
  store.list('risk').forEach(r => { m[r.id] = r.title; });
  return m;
}
export function humanizeSummary(text, names) {
  const m = names || idNames();
  let s = String(text || '');
  s = s.replace(/\s*\(([A-Za-z][\w-]*\d[\w-]*)\)/g, (all, id) => m[id] ? (s.includes(m[id]) ? '' : ` (${m[id]})`) : all);
  return s.replace(/\b([A-Za-z][\w-]*\d[\w-]*)\b/g, (all, id) => m[id] || all);
}

/* Dialogs never lose input on a validation error: validate before the modal's own click handler (capture phase).
   If invalid, the dialog stays open with every value as typed and the error shown inline next to the field. */
export function guardModal(validate) {
  const ovs = document.querySelectorAll('.overlay'); const ov = ovs[ovs.length - 1]; if (!ov) return;
  const mb = ov.querySelector('.mb');
  const box = document.createElement('div'); box.className = 'rl-err'; box.setAttribute('role', 'alert'); box.dataset.err = ''; box.hidden = true;
  mb.prepend(box);
  ov.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.dataset.act === 'cancel') return;
    mb.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
    const res = validate(formValues(mb), b.dataset.act, mb); if (!res) return;
    e.stopPropagation();
    const r = typeof res === 'string' ? { msg: res } : res;
    box.hidden = false; box.textContent = r.msg;
    const f = r.field && mb.querySelector(`[name="${r.field}"]`);
    if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
  }, true);
}

/* Effective data state (R4): live | pending (fix done, awaiting owner confirmation) | example | missing. */
export function effAvail(dataId) {
  const e = E(); const de = store.get('dataElement', dataId);
  if (e && e.effectiveAvail) { try { return e.effectiveAvail(store.state.docs, dataId); } catch (err) { /* fall through */ } }
  return (de && de.avail) || 'missing';
}
const AVAIL_TXT = { live: 'Live', pending: 'Fix done, awaiting owner confirmation', example: 'Examples only: needs a live source', missing: 'Missing' };

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

/* One section per BU (R4): the BUs of to-be step owners, plus any BU named (case-insensitive) in a step's `touches` tags.
   Each step entry records why it is in the section: 'owner' or 'tag'. */
function buSections(prj) {
  const known = new Map(); store.state.people.forEach(p => { if (p.bu) known.set(String(p.bu).toLowerCase(), p.bu); });
  const map = new Map();
  const add = (bu, entry) => {
    if (!map.has(bu)) map.set(bu, []);
    const arr = map.get(bu);
    const dup = arr.find(x => x.pid === entry.pid && x.step.id === entry.step.id);
    if (dup) { if (entry.via === 'owner') dup.via = 'owner'; return; }
    arr.push(entry);
  };
  projectProcesses(prj).forEach(p => flat(p.tobe && p.tobe.length ? p.tobe : p.asis).forEach(s => {
    const per = store.person(s.owner);
    if (per && per.bu) add(per.bu, { pid: p.id, pname: p.name, step: s, via: 'owner' });
    (s.touches || []).forEach(t => { const bu = known.get(String(t || '').trim().toLowerCase()); if (bu) add(bu, { pid: p.id, pname: p.name, step: s, via: 'tag', tag: t }); });
  }));
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bu, steps]) => ({ bu, steps, fromTags: steps.every(x => x.via === 'tag') }));
}
/* Approvals that count: approved, step-up, not by the project owner (R4: owners can't approve their own release). */
const counts = (prj, a) => !!a && a.decision === 'approved' && a.stepUp && a.approver !== prj.owner;
function signoffOpenOf(rd) {
  if (typeof rd.signoffOpen === 'boolean') return rd.signoffOpen;
  return (rd.checks || []).filter(c => !['bu-signoff', 'two-person', 'exceptions'].includes(c.id)).every(c => checkState(c) !== 'fail');
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

function checkState(c) {
  if (c.status === 'pass' || c.status === 'fail' || c.status === 'warn') return c.status;
  if (c.warning || c.id === 'exceptions') return (c.items || []).length || c.pass === false ? 'warn' : 'pass';
  return c.pass ? 'pass' : 'fail';
}
/* Summary counts: warnings are never counted as passing. */
function countChecks(checks) { const n = { pass: 0, warn: 0, fail: 0 }; (checks || []).forEach(c => { n[checkState(c)]++; }); return n; }
const countsText = n => [`${n.pass} pass`, n.warn ? `${n.warn} warn` : '', n.fail ? `${n.fail} fail` : ''].filter(Boolean).join(' · ');

function grantStatus(g) {
  if ((g.status === 'active' || g.status === 'approved') && g.expires && g.expires < store.state.today) return 'expired';
  return g.status;
}
const GRANT_CLS = { requested: 'b-soon', approved: 'b-prog', active: 'b-done', expired: 'b-idle', revoked: 'b-idle', denied: 'b-late' };

/* Readiness items arrive as strings or small objects; render a label and a link where we can infer one. */
const CO_LABEL = { tasks: 'No runbook tasks yet', runbook: 'No runbook tasks yet', rollbackOwner: 'Rollback owner not set', rollbackPlan: 'Rollback plan not written', hypercareOwner: 'Hypercare owner not set' };
function itemView(item, checkId, prjId, chk) {
  if (item == null) return { text: '' };
  if (typeof item !== 'object') {
    const s = String(item);
    if (checkId === 'cutover-plan') return { text: CO_LABEL[s] || s, href: null };
    if (checkId === 'data-live' && store.get('dataElement', s)) return dataLiveView(s);
    if (/^(workItem|process):/.test(s)) { const v = refView(s, prjId); return { text: v.text, extra: v.extra, href: v.href }; }
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
  if (checkId === 'data-live' && dataId && store.get('dataElement', dataId)) return dataLiveView(dataId);
  if (checkId === 'exceptions' && item.ref && /^(workItem|process):/.test(item.ref)) { const v = refView(item.ref, prjId); return { text: v.text, extra: [item.summary && item.summary !== v.text ? item.summary : '', v.extra].filter(Boolean).join(' · '), href: v.href }; }
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

/* data-live items: the effective state, and for 'pending' who has to confirm, with a link to the data page. */
function dataLiveView(dataId) {
  const de = store.get('dataElement', dataId); const st = effAvail(dataId);
  const extra = st === 'pending' ? `Fix done, awaiting ${pname(de.owner)} confirmation` : AVAIL_TXT[st] || st;
  return { text: de.name, extra, href: '/data/' + dataId, state: st, cta: st === 'pending' ? `Open the data page: ${pname(de.owner)} confirms the live source there ›` : null };
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
  const live = prj.status === 'live';
  const releases = store.list('release', r => r.projectId === prjId).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const lastGo = releases.find(r => !isRollback(r));
  /* After release show the checks as they stood at go-live (engine first, else the copy stored on the release). */
  if (live && !rd.released && lastGo && Array.isArray(lastGo.checks) && lastGo.checks.length) rd.checks = lastGo.checks;
  const cnt = countChecks(rd.checks);
  const failing = cnt.fail, warns = cnt.warn;

  const relFailed = live && lastGo && releases[0] === lastGo && (lastGo.status === 'failed' || pipePhase(lastGo) === 'failed');
  const gateCls = relFailed ? 'blocked' : live ? 'live' : rd.pass ? 'pass' : 'blocked';
  const gateTitle = relFailed ? 'Released, but the pipeline failed' : live ? 'Released' : rd.pass ? 'PASS — ready for go-live' : `Blocked — ${failing} check${failing === 1 ? '' : 's'} failing`;
  const gateSub = relFailed ? 'The deployment pipeline failed (simulated). Roll back from the banner below.' : live ? `Live since ${fmt(lastGo && lastGo.at)}. Every integration grant was closed at go-live.`
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
      <span class="rl-gate-ic">${relFailed ? ICON.fail : live ? '★' : rd.pass ? ICON.pass : ICON.fail}</span>
      <div><b>${esc(gateTitle)}</b><span>${esc(gateSub)}</span></div></div>
      <div class="rl-meter" aria-label="${esc(countsText(cnt))}">${rd.checks.map(c => `<i class="${checkState(c)}" title="${esc(c.label)}"></i>`).join('')}</div>
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
      <div class="rl-items">${items.map(it => { const v = itemView(it, c.id, prjId, c);
        if (v.state) return `<div class="rl-item rl-data ${esc(v.state)}" data-avail="${esc(v.state)}"><span class="rl-dstate ${esc(v.state)}" aria-hidden="true"></span><a href="${link(v.href)}" data-link>${esc(v.text)}</a><small>${esc(v.extra)}</small>${v.cta ? `<a class="rl-go" href="${link(v.href)}" data-link data-confirm-link>${esc(v.cta)}</a>` : ''}</div>`;
        return `<div class="rl-item">${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : `<span>${esc(v.text)}</span>`}${v.extra ? `<small>${esc(v.extra)}</small>` : ''}</div>`; }).join('') || `<div class="hint">${st === 'pass' ? 'Nothing outstanding.' : 'No item detail.'}</div>`}
        ${lkHtml ? `<div class="rl-item-foot">${lkHtml}</div>` : ''}</div></details>`;
  }).join('') || '<div class="empty">Readiness checks are not available yet.</div>';

  return header + `<div class="grid rl-grid"><div class="rl-main">
    ${ui.reasons ? `<div class="banner rl-reasons" data-reasons><b>Go-live was refused by the server.</b><ul>${ui.reasons.map(r => `<li>${esc(typeof r === 'string' ? r : (r.label || r.detail || JSON.stringify(r)))}</li>`).join('')}</ul></div>` : ''}
    ${live && lastGo && releases[0] === lastGo && (lastGo.status === 'failed' || pipePhase(lastGo) === 'failed') ? failBanner(prj, lastGo) : ''}
    ${live ? releasedCard(prj, rd, lastGo) : `<div class="card"><h3>Readiness checklist<span class="n" data-counts>${esc(countsText(cnt))}</span></h3>${checks}</div>`}
    ${cutoverCard(prj)}
    ${signoffCard(prj, rd)}
    ${grantsCard(prj)}
  </div>
  <aside class="side">
    ${goLiveCard(prj, rd, live)}
    ${releaseCards(prj, releases)}
    <div class="card rl-explain"><h3>How integration access works</h3>
      <p><b>Access is scoped to one data set, expires at go-live, every action is logged.</b></p>
      <ul><li>The data element's owner approves each request with step-up MFA. The requester never approves their own request; if the owner asked, the project owner decides.</li><li>Grants are for dev or UAT only and last 30 days at most.</li><li>Customer data and keys stay in the customer's tenant.</li></ul></div>
    <div class="card"><h3>Comments</h3>${commentsPanel('project:' + prjId)}</div>
    <div class="card"><h3>Gate audit log</h3><div data-rl-history><div class="hint">Loading history…</div></div></div>
  </aside></div>`;
}

function signoffCard(prj, rd) {
  const meId = store.state.me;
  const me = store.person(meId) || {};
  const sections = buSections(prj);
  const live = prj.status === 'live';
  const open = live || signoffOpenOf(rd);
  const isOwner = meId === prj.owner;
  const staleBy = {}; sections.forEach(s => { staleBy[s.bu] = live ? [] : staleChanges(prj, s, latestApproval(prj.id, s.bu), rd); });
  const approved = sections.map(s => latestApproval(prj.id, s.bu)).filter(a => counts(prj, a) && !(staleBy[a.bu] || []).length);
  const approvers = [...new Set(approved.map(a => a.approver))];
  const exc = (rd.checks.find(c => c.id === 'exceptions') || {}).items || [];
  const blocking = (rd.checks || []).filter(c => !['bu-signoff', 'two-person', 'exceptions'].includes(c.id) && checkState(c) === 'fail');
  const cards = sections.map(s => {
    const a = latestApproval(prj.id, s.bu);
    const mine = me.bu === s.bu;
    const eligible = store.state.people.filter(p => p.bu === s.bu && p.id !== prj.owner);
    const stale = staleBy[s.bu] || [];
    const byOwner = a && a.decision === 'approved' && a.approver === prj.owner;
    const state = !a ? 'pending' : byOwner ? 'owner' : (a.decision === 'approved' && stale.length ? 'stale' : a.decision);
    const stCls = state === 'approved' ? 'b-done' : state === 'rejected' || state === 'stale' ? 'b-late' : 'b-soon';
    const stTxt = { pending: 'Awaiting sign-off', approved: 'Signed off', rejected: 'Rejected', stale: 'Re-approval needed', owner: 'Needs an independent approver' }[state];
    const tagged = s.steps.filter(x => x.via === 'tag');
    let act = '';
    if (!live) {
      const label = a && a.decision === 'approved' && !byOwner ? 'Re-approve' : 'Approve section';
      let why = '';
      if (isOwner) why = `<span class="hint" data-why="owner">Project owners can't approve their own release. ${eligible.length ? `${esc(eligible.map(p => p.name).join(', '))} can sign off for ${esc(s.bu)}.` : ''}</span>`;
      else if (!mine) why = `<span class="hint" data-why="bu">Switch 'Viewing as' to ${/^[AEIOU]/i.test(s.bu) ? 'an' : 'a'} ${esc(s.bu)} person to sign off${eligible.length ? ` (${esc(eligible.map(p => p.name).join(', '))})` : ''}.</span>`;
      else if (!open) why = `<span class="hint" data-why="locked">Sign-off opens when the other checks pass.</span>`;
      act = `<div class="rl-bu-act">${why ? `<button class="btn sm" disabled data-locked>${label}</button>${why}`
        : `<button class="btn sm primary" data-signoff="approved" data-bu="${esc(s.bu)}">${label}</button><button class="btn sm danger" data-signoff="rejected" data-bu="${esc(s.bu)}">Reject</button>`}</div>`;
    }
    return `<div class="rl-bu ${state}" data-bu="${esc(s.bu)}" ${s.fromTags ? 'data-from-tags' : ''}>
      <div class="rl-bu-h"><b>${esc(s.bu)}</b>${badge(stTxt, stCls)}</div>
      ${tagged.length ? `<div class="rl-tagnote" data-tagnote>${s.fromTags ? 'Included because steps are tagged' : 'Also includes steps tagged'} <span class="chip">${esc(s.bu)}</span> in their <i>touches</i> tags.</div>` : ''}
      ${stale.length ? `<div class="rl-stale" data-stale="${esc(s.bu)}"><b>Re-approval needed: changed after sign-off</b><ul>${stale.map(v => `<li>${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : esc(v.text)} <small>${esc(v.extra)}</small></li>`).join('')}</ul></div>` : ''}
      <ol class="rl-steps">${s.steps.map(x => `<li ${x.via === 'tag' ? 'data-via-tag' : ''}><a href="${link(`/process/${x.pid}/step/${x.step.id}`)}" data-link>${esc(x.step.title)}</a> <small>${esc(pname(x.step.owner))} · ${esc(x.pname)}</small>${x.via === 'tag' ? ` <span class="rl-viatag" title="In this section because of its touches tag">tag: ${esc(x.tag)}</span>` : ''}</li>`).join('')}</ol>
      ${a ? `<div class="rl-signed">${av(a.approver)} <span>${esc(pname(a.approver))} ${a.decision === 'approved' ? 'approved' : 'rejected'} · ${esc(fmtTime(a.at))}${a.stepUp ? ' · <span class="rl-mfa">MFA verified</span>' : ''}</span></div>${byOwner ? `<div class="rl-ownerx" data-owner-excluded>Doesn't count: project owners can't approve their own release.</div>` : ''}${a.note ? `<div class="hint">“${esc(a.note)}”</div>` : ''}` : ''}
      ${act}</div>`;
  }).join('');
  const two = approvers.length >= 2;
  return `<div class="card" id="signoff"><h3>Business-unit sign-off<span class="n">${approved.length}/${sections.length} signed</span></h3>
    ${!live && !open ? `<div class="rl-lock" data-signoff-locked><span class="rl-ic warn">${LOCKI}</span><div><b>Sign-off opens when the other checks pass.</b><div class="hint">Approvers sign off on evidence, not on promises. Still failing: ${esc(blocking.map(c => c.label).join(' · ') || 'checks are loading')}. Existing approvals are kept.</div></div></div>` : ''}
    <div class="rl-two ${two ? 'ok' : ''}"><span class="rl-ic ${two ? 'pass' : 'fail'}">${two ? ICON.pass : ICON.fail}</span>
      <div><b>Two-person rule</b> · ${approvers.length} distinct approver${approvers.length === 1 ? '' : 's'} ${approvers.map(av).join('')}<div class="hint">Go-live needs at least two different people to have signed off, each with step-up MFA. The project owner (${esc(pname(prj.owner))}) can't be one of them.</div></div></div>
    ${exc.length && !Object.values(staleBy).some(x => x.length) ? `<div class="rl-exc"><b>Changes after sign-off</b> · listed by the gate. Re-approve the section to clear them.</div>` : ''}
    <div class="rl-bus">${cards || '<div class="empty">No owned or tagged steps in the linked to-be processes yet.</div>'}</div></div>`;
}

/* Cutover runbook (R4): project.cutover.tasks = [{id, order, task, owner, planned, gonogo, done, doneAt?, doneBy?}], in order. */
const tasksOf = c => (Array.isArray(c && c.tasks) ? c.tasks : []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
function cutoverNeeds(c) {
  c = c || {};
  const need = [];
  if (!tasksOf(c).some(t => String(t.task || '').trim())) need.push('at least one runbook task');
  if (!c.rollbackOwner) need.push('rollback owner');
  if (!String(c.rollbackPlan || '').trim()) need.push('rollback plan');
  if (!c.hypercareOwner) need.push('hypercare owner');
  return need;
}
const canTick = (prj, t) => { const me = store.state.me; return !!me && (me === t.owner || me === prj.owner || me === (prj.cutover || {}).rollbackOwner); };
function fmtPlanned(v) { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function runbookTable(prj, opts) {
  opts = opts || {};
  const tasks = tasksOf(prj.cutover);
  if (!tasks.length) return '<div class="hint" data-runbook-empty>No runbook tasks yet. Add the sequenced steps the cutover team follows.</div>';
  const done = tasks.filter(t => t.done).length;
  return `<div class="rl-rb-h"><b>${opts.checklist ? 'Cutover checklist' : 'Runbook'}</b><span class="hint" data-runbook-progress>${done}/${tasks.length} done · ${tasks.filter(t => t.gonogo).length} go/no-go</span></div>
    <div class="rl-rbar"><i style="width:${Math.round(100 * done / tasks.length)}%"></i></div>
    <ol class="rl-runbook ${opts.checklist ? 'check' : ''}" data-runbook>${tasks.map((t, i) => {
      const tick = canTick(prj, t) && !opts.readonly;
      return `<li class="${t.done ? 'done' : ''} ${t.gonogo ? 'gng' : ''}" data-rbtask="${esc(t.id)}"><span class="rl-rbn">${i + 1}</span>
        <label class="rl-rbchk"><input type="checkbox" data-rb-done="${esc(t.id)}" ${t.done ? 'checked' : ''} ${tick ? '' : 'disabled'} aria-label="Done: ${esc(t.task)}"></label>
        <div class="rl-rbt"><div><b>${esc(t.task)}</b>${t.gonogo ? ' <span class="rl-gng" title="The cutover lead confirms go or no-go here before continuing">Go/no-go</span>' : ''}</div>
          <small>${t.owner ? `${av(t.owner)} ${esc(pname(t.owner))}` : 'No owner'} · ${esc(fmtPlanned(t.planned))}${t.done && t.doneBy ? ` · done by ${esc(pname(t.doneBy))} ${esc(fmtTime(t.doneAt))}` : ''}</small></div></li>`;
    }).join('')}</ol>`;
}
function cutoverCard(prj) {
  const c = prj.cutover || {};
  const canEdit = store.state.me === prj.owner;
  const live = prj.status === 'live';
  const need = cutoverNeeds(prj.cutover);
  const row = (label, html, key) => `<div class="rl-co-r" data-co="${key}"><span class="lbl">${esc(label)}</span><div>${html || '<span class="hint">Not set</span>'}</div></div>`;
  return `<div class="card" id="cutover"><h3>${live ? 'Cutover runbook' : 'Cutover plan'}<span class="n">${need.length ? 'incomplete' : 'complete'}</span></h3>
    <div class="rl-co-st ${need.length ? 'fail' : 'pass'}"><span class="rl-ic ${need.length ? 'fail' : 'pass'}">${need.length ? ICON.fail : ICON.pass}</span>
      <span>${need.length ? `Gate item: add ${esc(need.join(', '))}.` : 'Gate item satisfied: the runbook is sequenced and rollback and hypercare are owned.'}</span></div>
    ${!prj.cutover ? '<div class="empty rl-co-empty">No cutover plan yet. Sequence the runbook tasks, name a rollback owner, write the rollback plan and set hypercare before go-live.</div>' : `
      ${runbookTable(prj, { checklist: live })}
      <div class="rl-co">
      ${row('Cutover window', esc(c.window || ''), 'window')}
      ${row('Rollback owner', c.rollbackOwner ? `${av(c.rollbackOwner)} ${esc(pname(c.rollbackOwner))}` : '', 'rollbackOwner')}
      ${row('Rollback plan', c.rollbackPlan ? `<span class="rl-pre-line">${esc(c.rollbackPlan)}</span>` : '', 'rollbackPlan')}
      ${row('Hypercare', c.hypercareOwner || c.hypercareDays ? `${c.hypercareDays ? esc(c.hypercareDays) + ' days' : ''}${c.hypercareOwner ? ` · ${av(c.hypercareOwner)} ${esc(pname(c.hypercareOwner))}` : ''}` : '', 'hypercare')}
      ${row('Communications', c.comms ? `<span class="rl-pre-line">${esc(c.comms)}</span>` : '', 'comms')}
    </div>`}
    <div class="rl-bu-act">${canEdit ? `<button class="btn sm primary" data-cutover-edit>${prj.cutover ? 'Edit cutover plan' : 'Add cutover plan'}</button>`
      : `<button class="btn sm" disabled>Edit cutover plan</button><span class="hint" data-why>Only the project owner (${esc(pname(prj.owner))}) can edit the cutover plan. Task owners tick their own tasks.</span>`}</div></div>`;
}

async function tickTask(prj, tid, done) {
  const cur = store.get('project', prj.id) || prj;
  const tasks = tasksOf(cur.cutover); const t = tasks.find(x => x.id === tid); if (!t) return;
  if (!canTick(cur, t)) { toast(`Only ${pname(t.owner)} or the project owner can tick this task.`); store.emit(); return; }
  const next = tasks.map(x => x.id === tid ? Object.assign({}, x, done ? { done: true, doneAt: new Date().toISOString(), doneBy: store.state.me } : { done: false, doneAt: undefined, doneBy: undefined }) : x);
  await store.save('project', prj.id, Object.assign({}, cur, { cutover: Object.assign({}, cur.cutover, { tasks: next }) }), `${done ? 'Completed' : 'Reopened'} cutover task “${t.task}”`);
  toast(done ? 'Task done' : 'Task reopened');
}

async function editCutover(prj) {
  if (store.state.me !== prj.owner) { toast(`Only the project owner (${pname(prj.owner)}) can edit the cutover plan.`); return; }
  const c = prj.cutover || {};
  const ppl = store.state.people;
  const sel = (name, v, extra) => `<select name="${name}" ${extra || ''}><option value="">Choose a person</option>${ppl.map(p => `<option value="${esc(p.id)}" ${p.id === v ? 'selected' : ''}>${esc(p.name)} · ${esc(p.role)}</option>`).join('')}</select>`;
  const trow = t => `<div class="rl-trow" data-trow data-tid="${esc(t.id || '')}" data-done="${t.done ? '1' : ''}"><span class="rl-rbn" data-tn></span>
    <input data-tt value="${esc(t.task || '')}" placeholder="Task, e.g. Freeze the payment run" aria-label="Task">
    <select data-to aria-label="Task owner"><option value="">Owner</option>${ppl.map(p => `<option value="${esc(p.id)}" ${p.id === t.owner ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <input type="datetime-local" data-tp value="${esc(t.planned || '')}" aria-label="Planned time">
    <label class="rl-tg"><input type="checkbox" data-tg ${t.gonogo ? 'checked' : ''}> Go/no-go</label>
    <span class="rl-tctl"><button type="button" class="btn sm" data-tup aria-label="Move task up">↑</button><button type="button" class="btn sm" data-tdn aria-label="Move task down">↓</button><button type="button" class="btn sm danger" data-trm aria-label="Remove task">✕</button></span></div>`;
  const tasks = tasksOf(c);
  const p = modal({
    title: 'Cutover plan',
    body: `<div class="field"><label>Runbook · sequenced tasks</label><div class="rl-trows" data-trows>${(tasks.length ? tasks : [{}]).map(trow).join('')}</div>
        <div><button type="button" class="btn sm" data-tadd>+ Add task</button></div></div>
      <div class="field"><label>Cutover window</label><input name="window" value="${esc(c.window || '')}" placeholder="e.g. Sat 06:00–10:00 CT, payment run frozen"></div>
      <div class="field"><label>Rollback owner</label>${sel('rollbackOwner', c.rollbackOwner)}</div>
      <div class="field"><label>Rollback plan</label><textarea name="rollbackPlan" placeholder="Trigger, steps and who decides">${esc(c.rollbackPlan || '')}</textarea></div>
      <div class="frow"><div class="field"><label>Hypercare days</label><input type="number" min="0" max="90" name="hypercareDays" value="${esc(c.hypercareDays == null ? 10 : c.hypercareDays)}"></div>
        <div class="field"><label>Hypercare owner</label>${sel('hypercareOwner', c.hypercareOwner)}</div></div>
      <div class="field"><label>Communications</label><textarea name="comms" placeholder="Who is told what, and when">${esc(c.comms || '')}</textarea></div>
      <div class="hint">The go-live gate needs at least one runbook task, a rollback owner and plan, and a hypercare owner.</div>`,
    actions: [{ id: 'save', label: 'Save plan', primary: true }],
  });
  const ovs = document.querySelectorAll('.overlay'); const ov = ovs[ovs.length - 1];
  if (ov) {
    const box = ov.querySelector('[data-trows]');
    const renum = () => box.querySelectorAll('[data-tn]').forEach((n, i) => { n.textContent = i + 1; });
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return; e.stopPropagation();
      const row = b.closest('[data-trow]');
      if (b.hasAttribute('data-trm')) { if (box.children.length > 1) row.remove(); else row.querySelectorAll('input:not([type=checkbox])').forEach(i => { i.value = ''; }); }
      if (b.hasAttribute('data-tup') && row.previousElementSibling) box.insertBefore(row, row.previousElementSibling);
      if (b.hasAttribute('data-tdn') && row.nextElementSibling) box.insertBefore(row.nextElementSibling, row);
      renum();
    });
    ov.querySelector('[data-tadd]').onclick = e => { e.stopPropagation(); box.insertAdjacentHTML('beforeend', trow({})); renum(); box.lastElementChild.querySelector('[data-tt]').focus(); };
    renum();
  }
  guardModal((f, act, mb) => {
    const rows = [...mb.querySelectorAll('[data-trow]')];
    const bad = rows.find(r => !r.querySelector('[data-tt]').value.trim() && (r.querySelector('[data-to]').value || r.querySelector('[data-tp]').value));
    if (bad) return 'A runbook task has an owner or time but no description. Describe it or remove the row.';
    const hd = String(f.hypercareDays || '').trim();
    if (hd && (!/^\d+$/.test(hd) || +hd > 90)) return { msg: 'Hypercare days must be a whole number from 0 to 90.', field: 'hypercareDays' };
    return null;
  });
  const r = await p;
  if (r.action !== 'save') return;
  const f = r.form;
  const old = new Map(tasks.map(t => [t.id, t]));
  const newTasks = [...r.root.querySelectorAll('[data-trow]')].map(row => ({ row, task: row.querySelector('[data-tt]').value.trim() })).filter(x => x.task).map((x, i) => {
    const id = x.row.dataset.tid || store.newId('ct'); const prev = old.get(id) || {};
    const t = { id, order: i + 1, task: x.task, owner: x.row.querySelector('[data-to]').value || '', planned: x.row.querySelector('[data-tp]').value || '', gonogo: x.row.querySelector('[data-tg]').checked, done: !!prev.done };
    if (prev.done) { t.doneAt = prev.doneAt; t.doneBy = prev.doneBy; }
    return t;
  });
  const days = Math.max(0, Math.min(90, parseInt(f.hypercareDays, 10) || 0));
  const cutover = { window: (f.window || '').trim(), rollbackOwner: f.rollbackOwner || '', rollbackPlan: (f.rollbackPlan || '').trim(), hypercareDays: days, hypercareOwner: f.hypercareOwner || '', comms: (f.comms || '').trim(), tasks: newTasks };
  const cur = store.get('project', prj.id) || prj;
  await store.save('project', prj.id, Object.assign({}, cur, { cutover }), `Updated the cutover plan for ${prj.name} (${newTasks.length} runbook task${newTasks.length === 1 ? '' : 's'})`);
  await store.notify([cutover.rollbackOwner, cutover.hypercareOwner, ...newTasks.map(t => t.owner)], `${pname(store.state.me)} named you in the cutover plan for ${prj.name}`, 'project:' + prj.id);
  toast('Cutover plan saved');
}

/* Separation of duties: the data owner approves; if the owner asked for the access, the project owner approves.
   The requester never approves their own request. */
function grantApprover(g, de, prj) {
  const a = g.requestedBy === de.owner ? prj.owner : de.owner;
  return a && a !== g.requestedBy ? a : null;
}

function grantsCard(prj) {
  const me = store.state.me;
  const grants = store.list('grant', g => g.projectId === prj.id).sort((a, b) => String((b.log && b.log[0] && b.log[0].at) || '').localeCompare(String((a.log && a.log[0] && a.log[0].at) || '')));
  const rows = grants.map(g => {
    const de = store.get('dataElement', g.dataId) || { name: g.dataId, owner: null };
    const st = grantStatus(g); const isOwner = de.owner === me;
    const approver = grantApprover(g, de, prj); const isApprover = approver && approver === me;
    const canRevoke = (st === 'active' || st === 'approved' || st === 'requested') && (isOwner || g.requestedBy === me || prj.owner === me);
    let acts = '';
    if (st === 'requested') acts = isApprover ? `<button class="btn sm primary" data-gact="approve" data-gid="${esc(g.id)}">Approve</button><button class="btn sm danger" data-gact="deny" data-gid="${esc(g.id)}">Deny</button>`
      : `<span class="hint" data-awaiting>${approver ? `Awaiting ${esc(pname(approver))}${approver !== de.owner ? ' (project owner: the data owner requested it)' : ''}` : 'No independent approver: ask someone else to request it'}</span>`;
    if (canRevoke && st !== 'requested') acts += `<button class="btn sm danger" data-gact="revoke" data-gid="${esc(g.id)}">Revoke</button>`;
    if (canRevoke && st === 'requested' && !isApprover) acts += `<button class="btn sm" data-gact="revoke" data-gid="${esc(g.id)}">Withdraw</button>`;
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
    ${live ? '<div class="hint" style="margin-top:6px">Rollback is in the release summary.</div>' : ''}</div>`;
}

function releasedCard(prj, rd, rel) {
  const procs = projectProcesses(prj);
  const snap = (rel && rel.snapshot) || {};
  const vers = Object.values(snap).map(Number).filter(Boolean);
  const v = vers.length ? Math.max(...vers) : Math.max(...procs.map(p => p.version || 1), 1);
  const when = rd.releasedAt || (rel && rel.at);
  const n = countChecks(rd.checks);
  return `<div class="card rl-released" data-released><h3>Release summary<span class="n" data-counts>${esc(countsText(n))}</span></h3>
    <div class="rl-rel-h"><span class="rl-gate-ic">★</span><div><b>Released v${esc(v)} on ${esc(fmt(when))} by ${esc(pname(rel && rel.by))}</b>
      <span class="hint">${procs.map(p => `${esc(p.name)} v${esc(snap[p.id] || p.version || 1)}`).join(' · ')}. The checks below are as they stood at release.</span></div></div>
    <ul class="rl-rel-checks">${rd.checks.map(c => { const st = checkState(c); return `<li class="${st}" data-check-at-release="${esc(c.id)}"><span class="rl-ic ${st}" aria-label="${st}">${ICON[st]}</span><span><b>${esc(c.label)}</b> <small>${esc(c.detail || '')}</small></span></li>`; }).join('')}</ul>
    ${rollbackBlock(prj, procs)}</div>`;
}

function canRollback(prj) { const me = store.state.me; return !!me && (me === prj.owner || me === (prj.cutover || {}).rollbackOwner); }
function rollbackBlock(prj, procs) {
  const rbo = (prj.cutover || {}).rollbackOwner;
  const prev = procs.filter(p => (p.version || 1) > 1);
  return `<div class="rl-rb"><div class="hint">${prev.length ? `Rolling back restores ${prev.map(p => `${esc(p.name)} v${esc((p.version || 1) - 1)}`).join(', ')} as the as-is version.` : 'No previous version to restore.'}</div>
    ${canRollback(prj) ? `<button class="btn danger rl-gobtn" data-rollback ${prev.length ? '' : 'disabled'}>Roll back release</button>`
      : `<button class="btn rl-gobtn" disabled>Roll back release</button><div class="hint" data-why>Only the project owner (${esc(pname(prj.owner))})${rbo && rbo !== prj.owner ? ` or the rollback owner (${esc(pname(rbo))})` : ''} can roll back.</div>`}</div>`;
}

const PIPE_FAIL = 'Stage “smoke-test” failed: the vendor sync health check returned HTTP 500 after deploy (simulated).';
/* Pipeline phase for a release: animating locally, else the stored final status. Legacy 'simulated-ok' reads as succeeded. */
function pipePhase(r, a) {
  if (ui.pipe && ui.pipe.id === r.id) return ui.pipe.phase;
  if (!r.pipeline && (r.status === 'queued' || ui.pipeStart === r.projectId)) return 'queued'; /* go-live just returned; the run has not started */
  const st = (r.pipeline && r.pipeline.status) || (a && a.status);
  return st === 'failed' ? 'failed' : st === 'queued' || st === 'running' ? st : 'succeeded';
}
function pipelineView(r, a) {
  const ph = pipePhase(r, a);
  const steps = ['queued', 'running', ph === 'failed' ? 'failed' : 'succeeded'];
  const idx = steps.indexOf(ph);
  const label = { queued: 'Queued', running: 'Running', succeeded: 'Succeeded', failed: 'Failed' };
  const err = ph === 'failed' ? ((r.pipeline && r.pipeline.error) || a.error || PIPE_FAIL) : '';
  const det = a.detail == null ? '' : typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail, null, 2);
  return `<div class="rl-act rl-pipe ${ph}" data-pipe-phase="${esc(ph)}"><div class="rl-act-h"><b>Deployment pipeline</b><span class="hint">${esc(a.target || '')}</span>
    <span class="sim">Simulated pipeline</span>${badge(label[ph], ph === 'failed' ? 'b-late' : ph === 'succeeded' ? 'b-done' : 'b-prog')}</div>
    <ol class="rl-pipesteps" aria-label="Pipeline status: ${esc(label[ph])}">${steps.map((x, i) => `<li class="${i < idx ? 'done' : i === idx ? 'cur ' + x : ''}"><span></span>${esc(label[x])}</li>`).join('')}</ol>
    ${err ? `<div class="rl-pipeerr" data-pipe-error>${esc(err)}</div>` : ''}
    ${det && ph !== 'queued' ? `<pre class="rl-pre">${esc(det)}</pre>` : ''}
    <div class="hint">Simulated: in this showroom no pipeline runs. In the product this is the customer's own CI/CD run, triggered from their tenant.</div></div>`;
}
function actionView(a, r) {
  if (a.type === 'pipeline' && r && !isRollback(r)) return pipelineView(r, a);
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
    <div class="rl-rec-h">${badge(rb ? 'Rollback' : 'Go-live', rb ? 'b-late' : 'b-done')} <b>${esc(fmtTime(r.at))}</b> · ${rb ? 'rolled back' : 'released'} by ${av(r.by)} ${esc(pname(r.by))}${r.stepUp ? ` · <span class="rl-mfa" data-stepup>step-up verified</span>` : ''}</div>
    ${rb ? (r.reason || r.note ? `<div class="rl-rec-s"><span class="lbl">Reason</span>${esc(r.reason || r.note)}</div>` : '')
      : `<div class="rl-rec-s"><span class="lbl">Approvers</span>${(r.approvers || []).map(id => `${av(id)}<span class="rl-nm">${esc(pname(id))}</span>`).join(' ') || '—'}</div>`}
    <div class="rl-rec-s"><span class="lbl">${rb ? 'Restored versions' : 'Released versions'}</span>${Object.keys(snap).map(pid => { const p = store.get('process', pid); return `<a class="chip" href="${link('/process/' + pid)}" data-link data-ver="${esc(pid)}">${esc(p ? p.name : pid)} · v${esc(snap[pid])}</a>`; }).join(' ') || '—'}</div>
    ${rb ? '' : `<div class="rl-rec-s rl-rec-exc" data-exceptions="${exc.length}"><span class="lbl">Exceptions · changed after an approval</span>${exc.length
      ? `<ul>${exc.map(x => { const v = exceptionView(x, r.projectId); return `<li>${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : esc(v.text)}${v.extra ? ` <small>${esc(v.extra)}</small>` : ''}</li>`; }).join('')}</ul>`
      : '<span class="hint">None. Nothing changed after its business unit signed off.</span>'}</div>`}
    <div class="rl-acts-list">${(r.actions || []).map(a => actionView(a, r)).join('')}</div></div>`;
}

function releaseCards(prj, releases) {
  if (!releases.length) return `<div class="card"><h3>Release history</h3><div class="hint">No releases yet. The release record and its pipeline request appear here after go-live.</div></div>`;
  const latest = releases[0];
  const fresh = ui.lastRelease === latest.id;
  const rbLatest = isRollback(latest);
  const lf = !rbLatest && (latest.status === 'failed' || pipePhase(latest) === 'failed');
  return `<div class="card rl-latest ${fresh ? 'fresh' : ''} ${rbLatest || lf ? 'rb' : ''}"><h3>${lf ? 'Release failed' : fresh ? (rbLatest ? 'Rollback complete' : 'Release complete') : (rbLatest ? 'Latest rollback' : 'Latest release')}</h3>${releaseRecord(latest)}</div>
    <div class="card"><h3>Release history<span class="n">${releases.length}</span></h3>${releases.map(r => { const n = Object.keys(r.snapshot || {}).length; return `<div class="row click" data-relrow="${esc(r.id)}" data-kind="${isRollback(r) ? 'rollback' : 'golive'}"><div><div class="t">${isRollback(r) ? 'Rollback' : 'Go-live'} · ${esc(fmtTime(r.at))}</div><div class="s">${esc(pname(r.by))} · ${isRollback(r) ? `${n} process version${n === 1 ? '' : 's'} restored` : `${(r.actions || []).length} actions · ${(r.exceptions || []).length} exception${(r.exceptions || []).length === 1 ? '' : 's'}`}</div></div><div class="r">${isRollback(r) ? badge('rolled back', 'b-late') : r.status === 'failed' ? badge('pipeline failed', 'b-late') : badge('deployed', 'b-done')}</div></div>${ui.showRel.has(r.id) && r.id !== latest.id ? releaseRecord(r) : ''}`; }).join('')}</div>`;
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
    if (store.state.me === prj.owner) { toast("Project owners can't approve their own release."); return; }
    if (!signoffOpenOf(readiness(prjId))) { toast('Sign-off opens when the other checks pass.'); return; }
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
  const rbn = root.querySelector('[data-rollback-now]');
  if (rbn) rbn.onclick = () => { const rel = store.list('release', r => r.projectId === prj.id && r.kind !== 'rollback').sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]; rollBack(prj, 'Deployment pipeline failed: ' + ((rel && rel.pipeline && rel.pipeline.error) || PIPE_FAIL)); };
  root.querySelectorAll('[data-rb-done]').forEach(cb => cb.onchange = () => tickTask(prj, cb.dataset.rbDone, cb.checked));
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
  const nm = idNames();
  box.innerHTML = evs.length ? evs.map(e => `<div class="ev"><time>${esc(fmtTime(e.at))}</time><span>${av(e.actor)} <b>${esc(pname(e.actor))}</b> ${esc(humanizeSummary(e.summary || e.action, nm))}</span></div>`).join('') : '<div class="hint">No gate activity yet.</div>';
}

async function requestAccess(prj) {
  const des = projectData(prj);
  if (!des.length) { toast('This project uses no data elements yet.'); return; }
  const today = store.state.today, max = addDays(today, 30);
  const p = modal({
    title: 'Request integration access',
    body: `<div class="field"><label>Data element</label><select name="dataId">${des.map(d => `<option value="${esc(d.id)}">${esc(d.name)} — owner ${esc(pname(d.owner))}</option>`).join('')}</select></div>
      <div class="frow"><div class="field"><label>Environment</label><select name="env"><option value="dev">Dev</option><option value="uat">UAT</option></select></div>
      <div class="field"><label>Access</label><select name="access"><option value="read">Read</option><option value="write">Write</option></select></div></div>
      <div class="field"><label>Reason</label><textarea name="reason" placeholder="What the integration needs this data for"></textarea></div>
      <div class="field"><label>Expires (max 30 days)</label><input type="date" name="expires" value="${addDays(today, 14)}" min="${today}" max="${max}"></div>
      <div class="hint">Only data elements used by this project's processes can be requested. The data owner approves with step-up MFA.</div>`,
    actions: [{ id: 'send', label: 'Send request', primary: true }],
  });
  guardModal(f => {
    if (!f.reason || !f.reason.trim()) return { msg: 'Add a reason so the data owner can decide.', field: 'reason' };
    if (!f.expires || f.expires < today || f.expires > max) return { msg: `Expiry must be within the next 30 days (by ${fmt(max)}). Grants are time-boxed.`, field: 'expires' };
    return null;
  });
  const r = await p;
  if (r.action !== 'send') return;
  const f = r.form;
  const de = store.get('dataElement', f.dataId);
  const id = store.newId('grt'); const me = store.state.me;
  await store.save('grant', id, { id, projectId: prj.id, dataId: f.dataId, env: f.env, access: f.access, reason: f.reason.trim(), requestedBy: me, status: 'requested', expires: f.expires, log: [{ at: new Date().toISOString(), by: me, action: `requested ${f.access} access in ${f.env.toUpperCase()}` }] },
    `Requested ${f.access} access to ${de ? de.name : f.dataId} (${f.env.toUpperCase()}) for ${prj.name}`);
  const appr = de ? grantApprover({ requestedBy: me }, de, prj) : null;
  if (appr) await store.notify([appr], `${pname(me)} requested ${f.access} access to ${de.name} (${f.env.toUpperCase()}) for ${prj.name}${appr !== de.owner ? ' (you approve: the data owner requested it)' : ''}`, 'grant:' + id);
  toast('Access requested. ' + (appr ? pname(appr) + ' has been notified.' : 'No independent approver is available.'));
}

async function grantAction(prj, gid, act) {
  const g = store.get('grant', gid); if (!g) return;
  const de = store.get('dataElement', g.dataId) || { name: g.dataId };
  const me = store.state.me;
  const approver = grantApprover(g, de, prj);
  if ((act === 'approve' || act === 'deny') && approver !== me) { toast(approver ? `Only ${pname(approver)} can decide this request. Requesters never approve their own access.` : 'No independent approver for this request.'); return; }
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

function failBanner(prj, rel) {
  const err = (rel.pipeline && rel.pipeline.error) || PIPE_FAIL;
  return `<div class="rl-failbn" data-pipeline-failed><div><b>Release failed: the deployment pipeline did not succeed.</b><span class="sim">Simulated pipeline</span>
      <div class="hint">${esc(err)} The release is marked failed. Rolling back restores the previous as-is versions.</div></div>
    ${canRollback(prj) ? `<button class="btn danger" data-rollback-now>Roll back now</button>` : `<span class="hint" data-why>Only the project owner (${esc(pname(prj.owner))})${(prj.cutover || {}).rollbackOwner && prj.cutover.rollbackOwner !== prj.owner ? ` or the rollback owner (${esc(pname(prj.cutover.rollbackOwner))})` : ''} can roll back.</span>`}</div>`;
}

/* Simulated pipeline: queued -> running -> succeeded | failed, then the final status is saved on the release record. */
const PIPE_MS = 1300;
function startPipeline(prj, relId, fail) {
  const t0 = new Date().toISOString();
  ui.pipe = { id: relId, phase: 'queued', fail, log: [{ phase: 'queued', at: t0 }] };
  store.emit();
  setTimeout(() => { if (ui.pipe && ui.pipe.id === relId) { ui.pipe.phase = 'running'; ui.pipe.log.push({ phase: 'running', at: new Date().toISOString() }); store.emit(); } }, PIPE_MS);
  setTimeout(() => finishPipeline(prj, relId), PIPE_MS * 2 + 200);
}
async function finishPipeline(prj, relId) {
  const p = ui.pipe; if (!p || p.id !== relId) return;
  const final = p.fail ? 'failed' : 'succeeded';
  p.phase = final; p.log.push({ phase: final, at: new Date().toISOString() });
  store.emit();
  const rel = store.get('release', relId);
  if (!rel) { ui.pipe = null; return; }
  const acts = (rel.actions || []).slice();
  if (!acts.some(a => a.type === 'pipeline')) acts.unshift({ type: 'pipeline', target: 'Customer CI/CD (simulated)', status: 'queued' });
  const pipeline = { status: final, simulated: true, log: p.log };
  if (p.fail) pipeline.error = PIPE_FAIL;
  const next = Object.assign({}, rel, { status: final, pipeline, actions: acts.map(a => a.type === 'pipeline' ? Object.assign({}, a, { status: final }, p.fail ? { error: PIPE_FAIL } : {}) : a) });
  try {
    await store.save('release', relId, next, p.fail ? `Deployment pipeline failed for ${prj.name} (simulated); release marked failed` : `Deployment pipeline succeeded for ${prj.name} (simulated)`);
  } finally { ui.pipe = null; store.emit(); }
  toast(p.fail ? 'Pipeline failed (simulated). Roll back from the banner.' : 'Pipeline succeeded (simulated)');
}

async function goLive(prj) {
  const rd = readiness(prj.id);
  if (!rd.pass) { toast('The gate is not passing yet.'); return; }
  const procs = projectProcesses(prj);
  const sections = buSections(prj);
  const approvers = [...new Set(sections.map(s => latestApproval(prj.id, s.bu)).filter(a => counts(prj, a)).map(a => a.approver))];
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
      <div class="rl-gl-rb" data-golive-runbook>${runbookTable(prj, { checklist: true, readonly: true })}<div class="hint">After release, task owners tick each task on the release page.</div></div>
      <label class="rl-simfail"><input type="checkbox" name="simfail" value="1" data-simfail> <span><b>Simulate failure</b><small>The simulated pipeline ends in “failed” so you can see the failure and rollback path.</small></span></label>
      <span class="sim">Simulated: in this showroom the pipeline trigger is recorded, not sent, and its run is animated.</span>`,
    actions: [{ id: 'go', label: 'Continue to verify', primary: true }],
  });
  if (r.action !== 'go') return;
  const fail = (r.form.simfail || []).includes('1');
  if (!(await stepUp('release to production'))) { toast('Step-up not completed. Nothing was released.'); return; }
  ui.pipeStart = prj.id;
  try {
    const res = await store.api('/golive/' + prj.id);
    ui.reasons = null;
    await store.load();
    const rel = (res && (res.release || (res.data && res.data.projectId ? res.data : null) || (res.projectId ? res : null))) || null;
    const latest = store.list('release', x => x.projectId === prj.id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    ui.lastRelease = (rel && rel.id) || (latest && latest.id) || null;
    const saved = ui.lastRelease && store.get('release', ui.lastRelease);
    if (saved) {
      const next = Object.assign({}, saved, { status: 'queued', stepUp: { by: store.state.me, at: new Date().toISOString(), method: 'simulated-mfa' } });
      const addExc = !(saved.exceptions || []).length && excs.length;
      if (addExc) next.exceptions = excs;
      await store.save('release', saved.id, next, `Go-live approved with step-up by ${pname(store.state.me)}${addExc ? `; ${excs.length} re-approved change${excs.length === 1 ? '' : 's'} recorded as exceptions` : ''}`);
      startPipeline(prj, saved.id, fail);
    }
    ui.pipeStart = null;
    store.emit();
    toast(`${prj.name} is live · pipeline queued (simulated)`);
  } catch (e) {
    ui.pipeStart = null;
    if (e.status === 409) { ui.reasons = (e.body && e.body.reasons && e.body.reasons.length) ? e.body.reasons : [e.message]; store.emit(); toast('Go-live refused. See the reasons above the checklist.'); }
    else toast('Go-live failed: ' + e.message);
  }
}

async function rollBack(prj, quick) {
  if (!canRollback(prj)) { toast('Only the project owner or the rollback owner can roll back.'); return; }
  const procs = projectProcesses(prj);
  /* one-click rollback from a failed pipeline: no confirm dialog, the reason is the failure; step-up still applies */
  const r = quick ? { action: 'rollback', form: { reason: quick } } : await modal({
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
    const rbRel = ui.lastRelease && store.get('release', ui.lastRelease);
    if (rbRel) await store.save('release', rbRel.id, Object.assign({}, rbRel, { reason: (r.form.reason || '').trim() || undefined, stepUp: { by: store.state.me, at: new Date().toISOString(), method: 'simulated-mfa' } }), `Rollback approved with step-up by ${pname(store.state.me)}${(r.form.reason || '').trim() ? ': ' + r.form.reason.trim() : ''}`);
    store.emit();
    toast(`${prj.name} rolled back`);
  } catch (e) { toast('Rollback failed: ' + e.message); }
}
