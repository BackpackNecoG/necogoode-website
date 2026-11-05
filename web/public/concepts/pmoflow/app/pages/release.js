/* Release page (stream R): readiness gate, BU sign-off, project-scoped access grants, go-live + release history.
   Route: /release/:prj */
import { store } from '../store.js';
import { E, esc, fmt, fmtTime, days, addDays, link, go, av, pname, badge, chip, modal, stepUp, toast, commentsPanel, bindActivity, formValues } from '../ui.js';

/* Module state survives the router's full re-render on every store change. */
const ui = { open: new Set(), lastRelease: null, reasons: null, showRel: new Set(), pipe: null, attest: {}, incident: {} };

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

/* R6: plain-language check labels; jargon only with a tooltip. [label, tooltip] */
const PLAIN = {
  'work-done': ['All project work is finished', 'Every work item in the project plan is done.'],
  'data-live': ['Data comes from live, proven sources', 'Each data element the process uses is connected to its real source, with evidence.'],
  'tests-passed': ['Tests passed, including user acceptance', 'UAT (user acceptance testing): the people who run the process confirm it works, step by step.'],
  'grants-closed': ['Temporary data access is time-boxed', 'Access granted for building and testing closes at go-live.'],
  'bu-signoff': ['Every affected business unit signed off', 'Each business unit whose steps change approves its own section.'],
  'two-person': ['Two different people approved', 'Separation of duties: at least two independent approvers.'],
  'exceptions': ['Nothing changed after sign-off', 'Any edit after an approval sends that section back for re-approval.'],
  'discovered-resolved': ['Rules found in testing are resolved', 'Requirements nobody had documented, found by failing tests, are settled by the data owner.'],
  'process-valid': ['Process maps are complete', 'Every step has an owner and every decision has its branches.'],
  'cutover-plan': ['Switch-over plan is ready', 'Cutover: the timed runbook for switching from the old way of working to the new one, plus who rolls back and who supports it afterwards.'],
};
const plainOf = c => (PLAIN[c.id] || [c.label, ''])[0] || c.label;
const tipOf = c => (PLAIN[c.id] || [])[1] || '';
/* A jargon term with its plain meaning as a tooltip. */
export const term = (word, tip) => `<abbr class="rl-term" title="${esc(tip)}" tabindex="0">${esc(word)}</abbr>`;
const GNG = () => term('Go/no-go', 'A checkpoint where the named owner confirms it is safe to continue the switch-over.');

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

/* R5 roles: the release manager (defaults to the PM) is the only person who can go live or roll back,
   and can't be counted as a BU approver (separation of duties). */
export const rmOf = prj => (prj && (prj.releaseManager || prj.owner)) || null;
function rmLine(prj) {
  const rm = rmOf(prj);
  return `<div class="rl-rm" data-rm="${esc(rm || '')}"><span class="lbl">Release manager</span>${rm ? `${av(rm)} <b>${esc(pname(rm))}</b>` : '<b>Not set</b>'}
    <span class="hint">Only the release manager can go live or roll back. They can't sign off a business-unit section.</span></div>`;
}

/* Live evidence (R5): profile with zero blocking drift, a passing connection check, or an attested link + note (weaker). */
const EV_TXT = { profile: 'Profile: no blocking drift', check: 'Connection check passed', attested: 'Attested: link and note (weaker)', seed: 'Live integration (seeded)' };
function evidenceOf(de) {
  const ev = de && de.liveEvidence;
  let eng = null; const e = E(); if (e && e.evidenceOf) { try { eng = e.evidenceOf(store.state.docs, de); } catch (err) { eng = null; } }
  if (ev && ev.type) return { type: ev.type, text: (EV_TXT[ev.type] || ev.type) + (eng && !eng.ok ? ` (does not hold: ${eng.reason || 'failing'})` : ''), ref: ev.ref || '', at: ev.at, by: ev.by, ok: eng ? eng.ok : true };
  if (de && de.check && de.check.ok) return { type: 'check', text: EV_TXT.check, ref: de.check.detail || '', at: de.check.at };
  return null;
}

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
  /* R5: the engine may name sections whose BU has no person yet ("No approver in HR"); those are known BUs too */
  engineSectionBus(prj).forEach(bu => { if (!known.has(bu.toLowerCase())) known.set(bu.toLowerCase(), bu); });
  projectProcesses(prj).forEach(p => {
    const nodes = p.tobe && p.tobe.length ? p.tobe : p.asis;
    /* R5: the trigger's touches count too */
    (nodes || []).filter(n => n && n.type === 'trigger').forEach(n => (n.touches || []).forEach(t => { const bu = known.get(String(t || '').trim().toLowerCase()); if (bu) add(bu, { pid: p.id, pname: p.name, step: n, via: 'trigger', tag: t }); }));
    flat(nodes).forEach(s => {
      const per = store.person(s.owner);
      if (per && per.bu) add(per.bu, { pid: p.id, pname: p.name, step: s, via: 'owner' });
      (s.touches || []).forEach(t => { const bu = known.get(String(t || '').trim().toLowerCase()); if (bu) add(bu, { pid: p.id, pname: p.name, step: s, via: 'tag', tag: t }); });
    });
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bu, steps]) => ({ bu, steps, fromTags: steps.every(x => x.via !== 'owner') }));
}
/* BU names the engine's bu-signoff check reports (sections, missing approvers), so UI sections match the gate. */
function engineSectionBus(prj) {
  const out = new Set();
  const rd = readiness(prj.id); const c = (rd.checks || []).find(x => x.id === 'bu-signoff'); if (!c) return [];
  const take = v => { if (typeof v === 'string' && v && !/[:#]/.test(v) && v.length < 40) out.add(v); else if (v && typeof v === 'object' && typeof v.bu === 'string') out.add(v.bu); };
  (c.items || []).forEach(take); (c.sections || []).forEach(take); (c.noApprover || []).forEach(take);
  const m = String(c.detail || '').match(/No approver in ([^:;,.]+)/g) || [];
  m.forEach(x => out.add(x.replace(/^No approver in /, '').trim()));
  return [...out].filter(bu => bu !== 'PMO' || store.state.people.some(p => p.bu === bu));
}
/* Approvals that count: approved, step-up, not by the project owner (R4) and not by the release manager (R5). */
const counts = (prj, a) => !!a && a.decision === 'approved' && a.stepUp && a.approver !== prj.owner && a.approver !== rmOf(prj);
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
  if (m[1] === 'project' || m[1] === 'cutover') return cutoverStaleView(store.get('project', m[1] === 'project' ? m[2].replace(/#.*$/, '') : prjId) || store.get('project', prjId));
  return { text: ref, extra: '', href: null };
}
/* R5: editing the cutover plan after an approval makes every approval stale. */
function cutoverStaleView(prj) { return { text: 'Cutover plan edited', extra: `by ${pname(prj && prj.owner)}${prj && prj.cutoverUpdatedAt ? ' · ' + fmtTime(prj.cutoverUpdatedAt) : ''}`, href: null, anchor: 'cutover', cutover: true }; }
function staleChanges(prj, section, a, rd) {
  if (!a || a.decision !== 'approved') return [];
  const at = String(a.at || '');
  const co = prj.cutoverUpdatedAt && String(prj.cutoverUpdatedAt) > at ? [cutoverStaleView(prj)] : [];
  /* Prefer the engine's verdict so the card and the gate never disagree. */
  const chk = rd && (rd.checks || []).find(c => c.id === 'bu-signoff');
  if (chk && Array.isArray(chk.stale)) {
    const x = chk.stale.find(y => y.bu === section.bu); if (!x) return [];
    const v = (x.changed || []).map(r => refView(r, prj.id));
    return v.some(y => y.cutover) ? v : co.concat(v);
  }
  if (co.length) return co.concat(staleFallback(prj, section, at));
  return staleFallback(prj, section, at);
}
function staleFallback(prj, section, at) {
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
  const ev = evidenceOf(de);
  const extra = st === 'pending' ? `Fix done, awaiting ${pname(de.owner)} confirmation` : st === 'live' && ev && ev.type === 'attested' ? 'Live, but attested only: a link and a note, weaker than a profile or a connection check' : AVAIL_TXT[st] || st;
  return { text: de.name, extra, href: '/data/' + dataId, state: st === 'live' && ev && ev.type === 'attested' ? 'attested' : st, cta: st === 'pending' ? `Open the data page: ${pname(de.owner)} confirms the live source there ›` : null };
}

/* R5: what proves each element is live. Profile and connection-check evidence are independent; attested is a warning. */
function dataEvidence(prj) {
  const rows = projectData(prj).map(de => {
    const st = effAvail(de.id); const ev = evidenceOf(de);
    const kind = st !== 'live' ? 'none' : ev ? ev.type : (de.avail === 'live' && !de.liveConfirmedBy ? 'seed' : 'unknown');
    const label = st !== 'live' ? (AVAIL_TXT[st] || st) : ev ? ev.text : kind === 'seed' ? EV_TXT.seed : 'Confirmed live, no evidence recorded';
    const cls = kind === 'attested' || kind === 'unknown' ? 'warn' : kind === 'none' ? 'fail' : 'pass';
    const meta = ev ? [ev.by ? pname(ev.by) : '', ev.at ? fmtTime(ev.at) : '', ev.ref && kind !== 'check' ? ev.ref : ''].filter(Boolean).join(' · ') : '';
    return `<li class="${cls}" data-evidence="${esc(de.id)}" data-ev-type="${esc(kind)}"><span class="rl-ic ${cls}">${ICON[cls]}</span><span><a href="${link('/data/' + de.id)}" data-link>${esc(de.name)}</a> <span class="rl-evb ${esc(kind)}">${esc(label)}</span>${meta ? ` <small>${esc(meta)}</small>` : ''}</span></li>`;
  }).join('');
  return rows ? `<div class="rl-ev" data-evidence-list><div class="rl-ev-h"><b>Live evidence</b><span class="hint">A profile with no blocking drift or a passing connection check proves the source. An attested link and note is accepted, but shown as a warning.</span></div><ul>${rows}</ul></div>` : '';
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
  if (params.q && params.q.bu) return buView(prj, params.q.bu, rd);
  const live = prj.status === 'live';
  const myBu = (store.person(store.state.me) || {}).bu;
  const mySection = myBu && buSections(prj).some(s => s.bu === myBu) ? myBu : null;
  const releases =store.list('release', r => r.projectId === prjId).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  /* R5: a failed pipeline writes a failed release with no side effects; it never counts as the live release */
  const lastGo = releases.find(r => !isRollback(r) && !isFailedRel(r));
  const failedRel = !live && releases[0] && !isRollback(releases[0]) && pipePhase(releases[0]) === 'failed' ? releases[0] : null;
  /* After release show the checks as they stood at go-live (engine first, else the copy stored on the release). */
  if (live && !rd.released && lastGo && Array.isArray(lastGo.checks) && lastGo.checks.length) rd.checks = lastGo.checks;
  const cnt = countChecks(rd.checks);
  const failing = cnt.fail, warns = cnt.warn;

  const relFailed = !!failedRel;
  const gateCls = live ? 'live' : rd.pass ? 'pass' : 'blocked';
  const gateTitle = live ? 'Released' : rd.pass ? (relFailed ? 'PASS — last release failed, retry when ready' : 'PASS — ready for go-live') : `Blocked — ${failing} check${failing === 1 ? '' : 's'} failing`;
  const gateSub = live ? `Live since ${fmt(lastGo && lastGo.at)}. Every integration grant was closed at go-live.`
    : rd.unavailable ? 'Readiness engine is still loading.'
    : rd.pass ? (warns ? `All required checks pass. ${warns} warning to review.` : 'All required checks pass. Two approvers can release.')
    : 'Go-live unlocks when every check below is green.';

  const header = `<section class="hdr rl-hdr"><div>
      <div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> · <a href="${link('/project/' + prjId)}" data-link>${esc(prj.name)}</a> · Release</div>
      <div class="rl-title"><h1>Go-live readiness</h1>
        <select class="rl-switch" data-switch aria-label="Project">${projects.map(p => `<option value="${esc(p.id)}" ${p.id === prjId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <p>One view for approvers: what must be true before <b>${esc(prj.name)}</b> goes live, who has signed, and which integration access is still open.</p>
      ${rmLine(prj)}
      ${mySection ? `<a class="btn sm primary rl-mysec" href="${link(`/release/${prjId}?bu=${encodeURIComponent(mySection)}`)}" data-link data-review-mine="${esc(mySection)}">Review my section · ${esc(mySection)}</a>` : ''}
    </div>
    <div class="hdr-side"><div class="rl-gate ${gateCls}" data-gate="${gateCls}">
      <span class="rl-gate-ic">${live ? '★' : rd.pass ? ICON.pass : ICON.fail}</span>
      <div><b>${esc(gateTitle)}</b><span>${esc(gateSub)}</span></div></div>
      <div class="rl-meter" aria-label="${esc(countsText(cnt))}">${rd.checks.map(c => `<i class="${checkState(c)}" title="${esc(plainOf(c))}"></i>`).join('')}</div>
    </div></section>`;

  /* readiness checklist */
  const checks = rd.checks.map(c => {
    const st = checkState(c); const items = c.items || [];
    const lk = (CHECK_LINK[c.id] || (() => null))(prjId);
    const key = c.id; const open = ui.open.has(key);
    const lkHtml = lk ? (lk.href ? `<a class="rl-go" href="${link(lk.href)}" data-link>${esc(lk.label)} ›</a>` : `<a class="rl-go" href="#${lk.anchor}" data-anchor="${lk.anchor}">${esc(lk.label)} ›</a>`) : '';
    const stTxt = { pass: 'Done', warn: 'Review', fail: 'Blocking' }[st];
    return `<details class="rl-check ${st}" data-check="${esc(c.id)}" ${open ? 'open' : ''}>
      <summary title="${esc(tipOf(c) || c.label)}"><span class="rl-ic ${st}">${ICON[st]}</span>
        <span class="rl-ct1" data-plain>${esc(plainOf(c))}</span>
        <span class="rl-st ${st}">${stTxt}${items.length && st !== 'pass' ? ` · ${items.length}` : ''}</span>
        <span class="rl-more" aria-hidden="true"><span class="sh">Show detail</span><span class="hd">Hide detail</span></span></summary>
      <div class="rl-items"><div class="rl-detail" data-detail>${esc(c.detail || '')}${tipOf(c) ? `<div class="hint">${esc(tipOf(c))}</div>` : ''}</div>${items.map(it => { const v = itemView(it, c.id, prjId, c);
        if (v.state) return `<div class="rl-item rl-data ${esc(v.state)}" data-avail="${esc(v.state)}"><span class="rl-dstate ${esc(v.state)}" aria-hidden="true"></span><a href="${link(v.href)}" data-link>${esc(v.text)}</a><small>${esc(v.extra)}</small>${v.cta ? `<a class="rl-go" href="${link(v.href)}" data-link data-confirm-link>${esc(v.cta)}</a>` : ''}</div>`;
        return `<div class="rl-item">${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : `<span>${esc(v.text)}</span>`}${v.extra ? `<small>${esc(v.extra)}</small>` : ''}</div>`; }).join('') || `<div class="hint">${st === 'pass' ? 'Nothing outstanding.' : 'No item detail.'}</div>`}
        ${c.id === 'data-live' ? dataEvidence(prj) : ''}
        ${lkHtml ? `<div class="rl-item-foot">${lkHtml}</div>` : ''}</div></details>`;
  }).join('') || '<div class="empty">Readiness checks are not available yet.</div>';

  return header + `<div class="grid rl-grid"><div class="rl-main">
    ${ui.reasons ? `<div class="banner rl-reasons" data-reasons><b>Go-live was refused by the server.</b><ul>${ui.reasons.map(r => `<li>${esc(typeof r === 'string' ? r : (r.label || r.detail || JSON.stringify(r)))}</li>`).join('')}</ul></div>` : ''}
    ${failedRel ? failBanner(prj, failedRel) : ''}
    ${live && releases[0] && isFailedRb(releases[0]) ? rbFailBanner(prj, releases[0]) : ''}
    ${live ? releasedCard(prj, rd, lastGo) + hypercareCard(prj, lastGo) : `<div class="card"><h3>Readiness checklist<span class="n" data-counts>${esc(countsText(cnt))}</span></h3>${checks}</div>`}
    ${cutoverCard(prj)}
    ${signoffCard(prj, rd)}
    ${grantsCard(prj)}
  </div>
  <aside class="side">
    ${goLiveCard(prj, rd, live)}
    ${releaseCards(prj, releases)}
    <div class="card rl-explain"><h3>How integration access works</h3>
      <p><b>Access is scoped to one data set, expires at go-live, every action is logged.</b></p>
      <ul><li>The data element's owner approves each request with step-up MFA. The requester never approves their own request; if the owner asked, the project owner decides.</li><li>Grants are for dev or UAT only and last 30 days at most, counted from approval.</li><li>Customer data and keys stay in the customer's tenant.</li></ul></div>
    <div class="card"><h3>Comments</h3>${commentsPanel('project:' + prjId)}</div>
    <div class="card"><h3>Gate audit log</h3><div data-rl-history><div class="hint">Loading history…</div></div></div>
  </aside></div>`;
}

/* Why the current persona can't sign this BU's section (html hint), or '' when they can. */
function signoffWhy(prj, bu, open) {
  const meId = store.state.me; const me = store.person(meId) || {};
  const rm = rmOf(prj); const isOwner = meId === prj.owner, isRm = meId === rm;
  const names = store.state.people.filter(p => p.bu === bu && p.id !== prj.owner && p.id !== rm).map(p => p.name).join(', ');
  const who = names ? `${esc(names)} can sign off for ${esc(bu)}.` : '';
  if (isOwner && isRm) return `<span class="hint" data-why="owner">Project owners can't approve their own release, and the release manager can't sign a section. ${who}</span>`;
  if (isOwner) return `<span class="hint" data-why="owner">Project owners can't approve their own release. ${who}</span>`;
  if (isRm) return `<span class="hint" data-why="rm">As release manager, ${esc(pname(rm))} can't sign off a business-unit section (separation of duties). ${who}</span>`;
  if (me.bu !== bu) return `<span class="hint" data-why="bu">Switch 'Viewing as' to ${/^[AEIOU]/i.test(bu) ? 'an' : 'a'} ${esc(bu)} person to sign off${names ? ` (${esc(names)})` : ''}.</span>`;
  if (!open) return `<span class="hint" data-why="locked">Sign-off opens when the other checks pass.</span>`;
  return '';
}

function signoffCard(prj, rd) {
  const meId = store.state.me;
  const me = store.person(meId) || {};
  const sections = buSections(prj);
  const live = prj.status === 'live';
  const open = live || signoffOpenOf(rd);
  const isOwner = meId === prj.owner;
  const rm = rmOf(prj); const isRm = meId === rm;
  const staleBy = {}; sections.forEach(s => { staleBy[s.bu] = live ? [] : staleChanges(prj, s, latestApproval(prj.id, s.bu), rd); });
  const approved = sections.map(s => latestApproval(prj.id, s.bu)).filter(a => counts(prj, a) && !(staleBy[a.bu] || []).length);
  const approvers = [...new Set(approved.map(a => a.approver))];
  const exc = (rd.checks.find(c => c.id === 'exceptions') || {}).items || [];
  const blocking = (rd.checks || []).filter(c => !['bu-signoff', 'two-person', 'exceptions'].includes(c.id) && checkState(c) === 'fail');
  const cards = sections.map(s => {
    const a = latestApproval(prj.id, s.bu);
    const mine = me.bu === s.bu;
    const eligible = store.state.people.filter(p => p.bu === s.bu && p.id !== prj.owner && p.id !== rm);
    const nobody = !store.state.people.some(p => p.bu === s.bu);
    const stale = staleBy[s.bu] || [];
    const byOwner = a && a.decision === 'approved' && a.approver === prj.owner;
    const byRm = a && a.decision === 'approved' && !byOwner && a.approver === rm;
    const state = !a ? 'pending' : byOwner ? 'owner' : byRm ? 'rm' : (a.decision === 'approved' && stale.length ? 'stale' : a.decision);
    const stCls = state === 'approved' ? 'b-done' : state === 'rejected' || state === 'stale' ? 'b-late' : 'b-soon';
    const stTxt = { pending: nobody ? 'No approver' : 'Awaiting sign-off', approved: 'Signed off', rejected: 'Rejected', stale: 'Re-approval needed', owner: 'Needs an independent approver', rm: 'Needs an independent approver' }[state];
    const tagged = s.steps.filter(x => x.via !== 'owner');
    const names = eligible.map(p => p.name).join(', ');
    let act = '';
    if (!live && nobody) {
      act = `<div class="rl-noappr" data-no-approver="${esc(s.bu)}"><b>No approver in ${esc(s.bu)}: assign one.</b><span class="hint">This section is here because a step or the trigger touches ${esc(s.bu)}, but nobody in the workspace belongs to ${esc(s.bu)}. Add a person in ${esc(s.bu)}, or remove the ${esc(s.bu)} tag if the change doesn't affect them.</span></div>`;
    } else if (!live && state !== 'approved') {
      /* a signed, current section needs no action: no stale "Switch 'Viewing as'" hint after sign-off */
      const label = a && a.decision === 'approved' && !byOwner && !byRm ? 'Re-approve' : 'Approve section';
      const why = signoffWhy(prj, s.bu, open);
      act = `<div class="rl-bu-act">${why ? `<button class="btn sm" disabled data-locked>${label}</button>${why}`
        : `<button class="btn sm primary" data-signoff="approved" data-bu="${esc(s.bu)}">${label}</button><button class="btn sm danger" data-signoff="rejected" data-bu="${esc(s.bu)}">Reject</button>`}</div>`;
    } else if (!live && mine && !isOwner && !isRm && open) {
      act = `<div class="rl-bu-act"><button class="btn sm danger" data-signoff="rejected" data-bu="${esc(s.bu)}">Withdraw and reject</button></div>`;
    }
    const viaTxt = x => x.via === 'trigger' ? 'trigger touches' : 'tag';
    return `<div class="rl-bu ${state}" data-bu="${esc(s.bu)}" ${s.fromTags ? 'data-from-tags' : ''}>
      <div class="rl-bu-h"><b>${esc(s.bu)}</b>${badge(stTxt, stCls)}<a class="rl-go rl-bu-rev" href="${link(`/release/${prj.id}?bu=${encodeURIComponent(s.bu)}`)}" data-link data-bu-review="${esc(s.bu)}">Review section ›</a></div>
      ${tagged.length ? `<div class="rl-tagnote" data-tagnote>${s.fromTags ? 'Included because' : 'Also includes'} ${tagged.some(x => x.via === 'trigger') ? 'the trigger or steps that are' : 'steps'} tagged <span class="chip">${esc(s.bu)}</span> in their <i>touches</i> tags.</div>` : ''}
      ${stale.length ? `<div class="rl-stale" data-stale="${esc(s.bu)}"><b>Re-approval needed: changed after sign-off</b><ul>${stale.map(v => `<li ${v.cutover ? 'data-stale-cutover' : ''}>${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : v.anchor ? `<a href="#${v.anchor}" data-anchor="${v.anchor}">${esc(v.text)}</a>` : esc(v.text)} <small>${esc(v.extra)}</small></li>`).join('')}</ul>${stale.some(v => v.cutover) ? '<div class="hint">A cutover edit changes what every approver signed, so all sections need re-approval.</div>' : ''}</div>` : ''}
      <ol class="rl-steps">${s.steps.map(x => `<li ${x.via !== 'owner' ? `data-via-${x.via === 'trigger' ? 'trigger' : 'tag'}` : ''}><a href="${link(`/process/${x.pid}/step/${x.step.id}`)}" data-link>${x.via === 'trigger' ? 'Trigger: ' : ''}${esc(x.step.title)}</a> <small>${x.step.owner ? esc(pname(x.step.owner)) + ' · ' : ''}${esc(x.pname)}</small>${x.via !== 'owner' ? ` <span class="rl-viatag" title="In this section because of its touches tag">${viaTxt(x)}: ${esc(x.tag)}</span>` : ''}</li>`).join('')}</ol>
      ${a ? `<div class="rl-signed">${av(a.approver)} <span>${esc(pname(a.approver))} ${a.decision === 'approved' ? 'approved' : 'rejected'} · ${esc(fmtTime(a.at))}${a.stepUp ? ' · <span class="rl-mfa">MFA verified</span>' : ''}</span></div>${byOwner ? `<div class="rl-ownerx" data-owner-excluded>Doesn't count: project owners can't approve their own release.</div>` : ''}${byRm ? `<div class="rl-ownerx" data-rm-excluded>Doesn't count: the release manager can't sign a section.</div>` : ''}${a.attestation || a.note ? `<div class="rl-attest" data-attestation>“${esc(a.attestation || a.note)}”</div>` : ''}` : ''}
      ${act}</div>`;
  }).join('');
  const two = approvers.length >= 2;
  return `<div class="card" id="signoff"><h3>Business-unit sign-off<span class="n">${approved.length}/${sections.length} signed</span></h3>
    ${!live && !open ? `<div class="rl-lock" data-signoff-locked><span class="rl-ic warn">${LOCKI}</span><div><b>Sign-off opens when the other checks pass.</b><div class="hint">Approvers sign off on evidence, not on promises. Still failing: ${esc(blocking.map(plainOf).join(' · ') || 'checks are loading')}. Existing approvals are kept.</div></div></div>` : ''}
    <div class="rl-two ${two ? 'ok' : ''}"><span class="rl-ic ${two ? 'pass' : 'fail'}">${two ? ICON.pass : ICON.fail}</span>
      <div><b>Two-person rule</b> · ${approvers.length} distinct approver${approvers.length === 1 ? '' : 's'} ${approvers.map(av).join('')}<div class="hint">Go-live needs at least two different people to have signed off, each with step-up MFA. The project owner (${esc(pname(prj.owner))})${rm && rm !== prj.owner ? ` and the release manager (${esc(pname(rm))})` : ''} can't be one of them.</div></div></div>
    ${exc.length && !Object.values(staleBy).some(x => x.length) ? `<div class="rl-exc"><b>Changes after sign-off</b> · listed by the gate. Re-approve the section to clear them.</div>` : ''}
    <div class="rl-bus">${cards || '<div class="empty">No owned or tagged steps in the linked to-be processes yet.</div>'}</div></div>`;
}

/* Cutover runbook (R6): project.cutover.tasks = [{id, order, task, owner, plannedStart, durationMins, gonogo, done, doneAt?, doneBy?}], in order.
   Older plans used `planned`; it is read as plannedStart. */
const startOf = t => t.plannedStart || t.planned || '';
/* Overdue: not done and its planned end (start + duration) has passed. */
function overdue(t) { const s0 = startOf(t); if (t.done || !s0) return false; const ms = new Date(s0).getTime(); return !isNaN(ms) && ms + (Number(t.durationMins) || 0) * 60000 < Date.now(); }
const fmtDur = m => { m = Number(m) || 0; if (!m) return ''; return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`; };
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
/* R5: a go/no-go task is confirmed only by its own owner; other tasks by their owner or the PM. */
const canTick = (prj, t) => { const me = store.state.me; if (!me) return false; if (t.gonogo) return !!t.owner && me === t.owner; return me === t.owner || me === prj.owner; };
const gngOf = prj => tasksOf(prj.cutover).filter(t => t.gonogo);
const gngOpen = prj => gngOf(prj).filter(t => !t.owner || !t.done);
function fmtPlanned(v) { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function runbookTable(prj, opts) {
  opts = opts || {};
  const tasks = tasksOf(prj.cutover);
  if (!tasks.length) return '<div class="hint" data-runbook-empty>No runbook tasks yet. Add the sequenced steps the cutover team follows.</div>';
  const done = tasks.filter(t => t.done).length;
  const late = opts.readonly ? [] : tasks.filter(overdue);
  return `<div class="rl-rb-h"><b>${opts.checklist ? 'Cutover checklist' : 'Runbook'}</b><span class="hint" data-runbook-progress>${done}/${tasks.length} done · ${tasks.filter(t => t.gonogo).length} ${GNG()}</span></div>
    <div class="rl-rbar"><i style="width:${Math.round(100 * done / tasks.length)}%"></i></div>
    ${late.length ? `<div class="rl-overdue-w" data-runbook-overdue="${late.length}"><span class="rl-ic warn">!</span> ${late.length} runbook task${late.length === 1 ? ' is' : 's are'} overdue: ${late.map(t => `${esc(t.task)} (${t.owner ? esc(pname(t.owner)) : 'no owner'})`).join(' · ')}</div>` : ''}
    <ol class="rl-runbook ${opts.checklist ? 'check' : ''}" data-runbook>${tasks.map((t, i) => {
      const tick = canTick(prj, t) && !opts.readonly;
      const od = !opts.readonly && overdue(t);
      return `<li class="${t.done ? 'done' : ''} ${t.gonogo ? 'gng' : ''} ${od ? 'od' : ''}" data-rbtask="${esc(t.id)}" ${od ? 'data-overdue' : ''}><span class="rl-rbn">${i + 1}</span>
        <label class="rl-rbchk"><input type="checkbox" data-rb-done="${esc(t.id)}" ${t.done ? 'checked' : ''} ${tick ? '' : 'disabled'} aria-label="Done: ${esc(t.task)}"></label>
        <div class="rl-rbt"><div><b>${esc(t.task)}</b>${t.gonogo ? ` <span class="rl-gng">${GNG()}</span>` : ''}${od ? ' <span class="badge b-late">Overdue</span>' : ''}</div>
          <small><span class="rl-rbown" data-rb-owner="${esc(t.owner || '')}">${t.owner ? `${av(t.owner)} ${esc(pname(t.owner))}` : '<b class="rl-noown">No owner</b>'}</span> · ${esc(fmtPlanned(startOf(t)))}${t.durationMins ? ` · ${esc(fmtDur(t.durationMins))}` : ''}${t.done && t.doneBy ? ` · ${t.gonogo ? 'confirmed' : 'done'} by ${esc(pname(t.doneBy))} ${esc(fmtTime(t.doneAt))}` : ''}</small>
          ${t.gonogo && !t.done && !opts.readonly ? `<small class="rl-gngwho" data-gng-who>${t.owner ? `Only ${esc(pname(t.owner))} can confirm go/no-go.` : 'Needs an owner before go-live.'}</small>` : ''}</div></li>`;
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
      : `<button class="btn sm" disabled>Edit cutover plan</button><span class="hint" data-why>Only the project manager (${esc(pname(prj.owner))}) can edit the cutover plan. Task owners tick their own tasks; go/no-go checks are confirmed by their owner only.</span>`}</div></div>`;
}

async function tickTask(prj, tid, done) {
  const cur = store.get('project', prj.id) || prj;
  const tasks = tasksOf(cur.cutover); const t = tasks.find(x => x.id === tid); if (!t) return;
  if (!canTick(cur, t)) { toast(t.gonogo ? `Only the task owner (${pname(t.owner)}) can confirm this go/no-go.` : `Only ${pname(t.owner)} or the project manager can tick this task.`); store.emit(); return; }
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
    <input type="datetime-local" data-tp value="${esc(startOf(t))}" aria-label="Planned start">
    <input type="number" data-td min="0" max="1440" step="5" value="${esc(t.durationMins == null ? '' : t.durationMins)}" placeholder="Mins" aria-label="Duration in minutes">
    <label class="rl-tg" title="A checkpoint where the owner confirms it is safe to continue"><input type="checkbox" data-tg ${t.gonogo ? 'checked' : ''}> Go/no-go</label>
    <span class="rl-tctl"><button type="button" class="btn sm" data-tup aria-label="Move task up">↑</button><button type="button" class="btn sm" data-tdn aria-label="Move task down">↓</button><button type="button" class="btn sm danger" data-trm aria-label="Remove task">✕</button></span></div>`;
  const tasks = tasksOf(c);
  const p = modal({
    title: 'Cutover plan',
    body: `<div class="field"><label>Runbook · sequenced tasks: planned start, duration in minutes, owner, and ${GNG()} checkpoints</label><div class="rl-trows" data-trows>${(tasks.length ? tasks : [{}]).map(trow).join('')}</div>
        <div><button type="button" class="btn sm" data-tadd>+ Add task</button></div></div>
      <div class="field"><label>Cutover window</label><input name="window" value="${esc(c.window || '')}" placeholder="e.g. Sat 06:00–10:00 CT, payment run frozen"></div>
      <div class="field"><label>Rollback owner</label>${sel('rollbackOwner', c.rollbackOwner)}</div>
      <div class="field"><label>Rollback plan</label><textarea name="rollbackPlan" placeholder="Trigger, steps and who decides">${esc(c.rollbackPlan || '')}</textarea></div>
      <div class="frow"><div class="field"><label>Hypercare days</label><input type="number" min="0" max="90" name="hypercareDays" value="${esc(c.hypercareDays == null ? 10 : c.hypercareDays)}"></div>
        <div class="field"><label>Hypercare owner</label>${sel('hypercareOwner', c.hypercareOwner)}</div></div>
      <div class="field"><label>Communications</label><textarea name="comms" placeholder="Who is told what, and when">${esc(c.comms || '')}</textarea></div>
      <div class="hint">The go-live gate needs at least one runbook task, a rollback owner and plan, and a hypercare owner. Every go/no-go task needs an owner, who confirms it before go-live. Editing the plan after sign-off sends every section back for re-approval.</div>`,
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
    const bad = rows.find(r => !r.querySelector('[data-tt]').value.trim() && (r.querySelector('[data-to]').value || r.querySelector('[data-tp]').value || r.querySelector('[data-td]').value));
    const badD = rows.find(r => r.querySelector('[data-td]').value && !/^\d+$/.test(r.querySelector('[data-td]').value.trim()));
    if (badD) { badD.querySelector('[data-td]').setAttribute('aria-invalid', 'true'); return 'A task duration must be a whole number of minutes.'; }
    if (bad) return 'A runbook task has an owner or time but no description. Describe it or remove the row.';
    const gng = rows.find(r => r.querySelector('[data-tt]').value.trim() && r.querySelector('[data-tg]').checked && !r.querySelector('[data-to]').value);
    if (gng) { gng.querySelector('[data-to]').setAttribute('aria-invalid', 'true'); return `“${gng.querySelector('[data-tt]').value.trim()}” is a go/no-go check, so it needs an owner: only that owner can confirm it before go-live.`; }
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
    const dm = parseInt(x.row.querySelector('[data-td]').value, 10);
    const t = { id, order: i + 1, task: x.task, owner: x.row.querySelector('[data-to]').value || '', plannedStart: x.row.querySelector('[data-tp]').value || '', durationMins: isNaN(dm) ? 0 : Math.max(0, Math.min(1440, dm)), gonogo: x.row.querySelector('[data-tg]').checked, done: !!prev.done };
    if (prev.done) { t.doneAt = prev.doneAt; t.doneBy = prev.doneBy; }
    return t;
  });
  const days = Math.max(0, Math.min(90, parseInt(f.hypercareDays, 10) || 0));
  const cutover = { window: (f.window || '').trim(), rollbackOwner: f.rollbackOwner || '', rollbackPlan: (f.rollbackPlan || '').trim(), hypercareDays: days, hypercareOwner: f.hypercareOwner || '', comms: (f.comms || '').trim(), tasks: newTasks };
  const cur = store.get('project', prj.id) || prj;
  /* R5: a cutover edit after sign-off makes every approval stale (project.cutoverUpdatedAt) */
  await store.save('project', prj.id, Object.assign({}, cur, { cutover, cutoverUpdatedAt: new Date().toISOString() }), `Updated the cutover plan for ${prj.name} (${newTasks.length} runbook task${newTasks.length === 1 ? '' : 's'})`);
  await store.notify([cutover.rollbackOwner, cutover.hypercareOwner, ...newTasks.map(t => t.owner)], `${pname(store.state.me)} named you in the cutover plan for ${prj.name}`, 'project:' + prj.id);
  toast('Cutover plan saved');
}

/* Separation of duties: the data owner approves; if the owner asked for the access, the project owner approves.
   The requester never approves their own request. */
function grantApprover(g, de, prj) {
  const a = g.requestedBy === de.owner ? prj.owner : de.owner;
  return a && a !== g.requestedBy ? a : null;
}

/* R6: the time box starts at approval. Requested grants carry a duration; approval sets the expiry. */
const grantDays = g => Math.max(1, Math.min(30, Number(g.durationDays) || 30));
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
      <td data-expiry>${st === 'requested' ? `<span data-from-approval>${esc(grantDays(g))} days from approval</span>` : st === 'denied' ? '—' : `${esc(fmt(g.expires))}${left != null && (st === 'active' || st === 'approved') ? `<div class="hint">${left >= 0 ? left + 'd left' : 'past'}</div>` : ''}`}</td>
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
  const rm = rmOf(prj); const isRm = store.state.me === rm;
  const open = gngOpen(prj);
  const ready = rd.pass && !live && !open.length;
  let why = '';
  if (!live && !isRm) why = `<div class="hint rl-why" data-why="rm">Only the release manager (${esc(pname(rm))}) can go live. Switch 'Viewing as' to ${esc(pname(rm))} to release.</div>`;
  else if (!live && open.length) why = `<div class="hint rl-why" data-why="gonogo">Go/no-go not confirmed: ${open.map(t => `${esc(t.task)} (${t.owner ? esc(pname(t.owner)) + ' confirms' : 'needs an owner'})`).join(' · ')}.</div>`;
  return `<div class="card rl-golive ${ready ? 'ready' : ''}"><h3>Go-live</h3>
    ${live ? `<p class="rl-p">This project is live. The to-be processes became the new as-is versions.</p>`
      : `<p class="rl-p">${rd.pass ? 'The gate passes. Releasing runs the deployment pipeline first; only if it succeeds are the to-be processes promoted, the SOP published and access closed.' : 'Locked until every readiness check passes.'}</p>`}
    <div class="rl-procs">${procs.map(p => `<div><a href="${link('/process/' + p.id)}" data-link>${esc(p.name)}</a><span class="chip">v${esc(p.version || 1)}${live ? '' : ` → v${esc((p.version || 1) + 1)}`}</span></div>`).join('')}</div>
    ${!live && gngOf(prj).length ? `<div class="rl-gngsum ${open.length ? 'fail' : 'pass'}" data-gng-summary><span class="rl-ic ${open.length ? 'fail' : 'pass'}">${open.length ? ICON.fail : ICON.pass}</span> Go/no-go: ${gngOf(prj).length - open.length} of ${gngOf(prj).length} confirmed by their owners</div>` : ''}
    <button class="btn primary rl-gobtn" data-golive ${rd.pass && !live && isRm && !open.length ? '' : 'disabled'}>${live ? 'Released' : 'Go live'}</button>
    ${why}
    ${!rd.pass && !live ? `<div class="hint" style="margin-top:6px">${rd.checks.filter(c => checkState(c) === 'fail').map(c => esc(plainOf(c))).join(' · ')}</div>` : ''}
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
    <ul class="rl-rel-checks">${rd.checks.map(c => { const st = checkState(c); return `<li class="${st}" data-check-at-release="${esc(c.id)}"><span class="rl-ic ${st}" aria-label="${st}">${ICON[st]}</span><span><b title="${esc(tipOf(c))}">${esc(plainOf(c))}</b> <small>${esc(c.detail || '')}</small></span></li>`; }).join('')}</ul>
    ${rollbackBlock(prj, procs)}</div>`;
}

/* R5: only the release manager rolls back (the server returns 403 otherwise). */
function canRollback(prj) { const me = store.state.me; return !!me && me === rmOf(prj); }
function rollbackBlock(prj, procs) {
  const prev = procs.filter(p => (p.version || 1) > 1);
  return `<div class="rl-rb"><div class="hint">${prev.length ? `Rolling back restores ${prev.map(p => `${esc(p.name)} v${esc((p.version || 1) - 1)}`).join(', ')} as the as-is version and re-publishes the previous SOP.` : 'No previous version to restore.'}</div>
    ${canRollback(prj) ? `<button class="btn danger rl-gobtn" data-rollback ${prev.length ? '' : 'disabled'}>Roll back release</button>`
      : `<button class="btn rl-gobtn" disabled>Roll back release</button><div class="hint" data-why="rm">Only the release manager (${esc(pname(rmOf(prj)))}) can roll back.</div>`}</div>`;
}

const PIPE_FAIL = 'Stage “smoke-test” failed: the vendor sync health check returned HTTP 500 after deploy (simulated).';
/* R6: go-live and rollback both run the (simulated) pipeline; a failed one of either kind changed nothing. */
const failedAny = r => !!r && (r.status === 'failed' || r.failed === true || (r.pipeline && r.pipeline.status === 'failed'));
const isFailedRel = r => failedAny(r) && !isRollback(r);
const isFailedRb = r => failedAny(r) && isRollback(r);
/* Pipeline phase for a release: animating locally, else the stored final status. Legacy 'simulated-ok' reads as succeeded. */
function pipePhase(r, a) {
  if (ui.pipe && ui.pipe.id === r.id) return ui.pipe.phase;
  if (ui.pipeStart === r.projectId) return 'queued'; /* go-live just returned; the run has not started */
  if (failedAny(r)) return 'failed';
  const st = (r.pipeline && r.pipeline.status) || (a && a.status);
  return st === 'failed' ? 'failed' : st === 'queued' || st === 'running' ? st : 'succeeded';
}
function pipeError(r, a) {
  const pa = (r.actions || []).find(x => x.type === 'pipeline') || {};
  const m = /Run result: ([^\n]+)/.exec(String(pa.detail || ''));
  return (r.pipeline && r.pipeline.error) || r.error || (a && a.error) || pa.error || (m && m[1]) || PIPE_FAIL;
}
function pipelineView(r, a) {
  const ph = pipePhase(r, a);
  const steps = ['queued', 'running', ph === 'failed' ? 'failed' : 'succeeded'];
  const idx = steps.indexOf(ph);
  const label = { queued: 'Queued', running: 'Running', succeeded: 'Succeeded', failed: 'Failed' };
  const err = ph === 'failed' ? pipeError(r, a) : '';
  const det = a.detail == null ? '' : typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail, null, 2);
  return `<div class="rl-act rl-pipe ${ph}" data-pipe-phase="${esc(ph)}" data-pipe-kind="${isRollback(r) ? 'rollback' : 'golive'}"><div class="rl-act-h"><b>${isRollback(r) ? 'Rollback pipeline' : 'Deployment pipeline'}</b><span class="hint">${esc(a.target || '')}</span>
    <span class="sim">Simulated pipeline</span>${badge(label[ph], ph === 'failed' ? 'b-late' : ph === 'succeeded' ? 'b-done' : 'b-prog')}</div>
    <ol class="rl-pipesteps" aria-label="Pipeline status: ${esc(label[ph])}">${steps.map((x, i) => `<li class="${i < idx ? 'done' : i === idx ? 'cur ' + x : ''}"><span></span>${esc(label[x])}</li>`).join('')}</ol>
    ${err ? `<div class="rl-pipeerr" data-pipe-error>${esc(err)}</div>` : ''}
    ${det && ph !== 'queued' ? `<pre class="rl-pre">${esc(det)}</pre>` : ''}
    <div class="hint">Simulated: in this showroom no pipeline runs. In the product this is the customer's own CI/CD run, triggered from their tenant.</div></div>`;
}
function actionView(a, r) {
  if (a.type === 'pipeline' && r) return pipelineView(r, a);
  const det = a.detail == null ? '' : typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail, null, 2);
  const label = { pipeline: 'Deployment pipeline', 'sop-publish': 'Publish SOP', notify: 'Notify stakeholders', 'sop-republish': 'Re-publish previous SOP', restore: 'Restore process version' }[a.type] || a.type;
  return `<div class="rl-act"><div class="rl-act-h"><b>${esc(label)}</b><span class="hint">${esc(a.target || '')}</span>
    <span class="sim">Simulated</span>${badge(a.status || 'simulated-ok', /fail/.test(a.status || '') ? 'b-late' : 'b-done')}</div>
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
/* Side effects a rollback undid (R5). Server records them; older records are described from their snapshot and actions. */
function undoneOf(r) {
  const raw = r.undone || r.restored || r.sideEffects || r.undid;
  const procName = id => (store.get('process', id) || {}).name || id;
  if (Array.isArray(raw) && raw.length) return raw.map(x => {
    if (typeof x === 'string') return x;
    if (x.detail) return `${x.target ? x.target + ': ' : ''}${x.detail}`;
    const t = x.type || x.kind || '';
    const nm = x.name || (x.processId || x.pid ? procName(x.processId || x.pid) : '') || x.target || '';
    if (/restore|version/.test(t)) return `Restored ${nm}${x.version || x.to ? ' v' + (x.version || x.to) : ''} as the as-is process${x.from ? ` (v${x.from} withdrawn)` : ''}`;
    if (/sop|publish/.test(t)) return `Re-published the previous SOP${nm ? ' for ' + nm : ''}${x.version ? ' (v' + x.version + ')' : ''}`;
    if (/grant|access/.test(t)) return x.detail || `Access record noted: ${nm}`;
    if (/data/.test(t)) return x.detail || `Data state restored: ${nm}`;
    return x.detail || x.summary || x.text || [t, nm].filter(Boolean).join(': ');
  });
  const snap = r.snapshot || {};
  const out = Object.keys(snap).map(pid => `Restored ${procName(pid)} v${snap[pid]} as the as-is process`);
  (r.actions || []).filter(a => a.type === 'sop-publish' || a.type === 'sop-republish').forEach(a => out.push(`Re-published the previous SOP${a.target ? ': ' + a.target : ''}`));
  return out;
}
function releaseRecord(r) {
  const snap = r.snapshot || {};
  const rb = isRollback(r);
  const failed = pipePhase(r) === 'failed';
  const exc = r.exceptions || [];
  const undone = rb ? undoneOf(r) : [];
  return `<div class="rl-rec" data-release="${esc(r.id)}" data-kind="${rb ? 'rollback' : 'golive'}" ${failed ? 'data-failed' : ''}>
    <div class="rl-rec-h">${badge(rb ? (failed ? 'Rollback failed' : 'Rollback') : failed ? 'Go-live failed' : 'Go-live', rb || failed ? 'b-late' : 'b-done')} <b>${esc(fmtTime(r.at))}</b> · ${failed ? 'attempted' : rb ? 'rolled back' : 'released'} by ${av(r.by)} ${esc(pname(r.by))}${r.stepUp ? ` · <span class="rl-mfa" data-stepup>step-up verified</span>` : ''}</div>
    ${rb ? (r.reason || r.note ? `<div class="rl-rec-s"><span class="lbl">Reason</span>${esc(r.reason || r.note)}</div>` : '')
      : `<div class="rl-rec-s"><span class="lbl">Approvers</span>${(r.approvers || []).map(id => `${av(id)}<span class="rl-nm">${esc(pname(id))}</span>`).join(' ') || '—'}</div>`}
    ${failed && rb ? `<div class="rl-rec-s rl-noeffect" data-no-side-effects><span class="lbl">Side effects</span><b>Nothing was restored.</b> <span class="hint">The released versions are still live, the SOP was not re-published, and only the release manager was notified.</span></div>`
      : failed ? `<div class="rl-rec-s rl-noeffect" data-no-side-effects><span class="lbl">Side effects</span><b>Nothing was promoted or published.</b> <span class="hint">No process version changed, the SOP was not published, access grants were left as they were, and only the release manager was notified.</span></div>`
      : `<div class="rl-rec-s"><span class="lbl">${rb ? 'Restored versions' : 'Released versions'}</span>${Object.keys(snap).map(pid => { const p = store.get('process', pid); return `<a class="chip" href="${link('/process/' + pid)}" data-link data-ver="${esc(pid)}">${esc(p ? p.name : pid)} · v${esc(snap[pid])}</a>`; }).join(' ') || '—'}</div>`}
    ${rb && !failed ? `<div class="rl-rec-s rl-undone" data-undone="${undone.length}"><span class="lbl">Side effects undone</span>${undone.length ? `<ul>${undone.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="hint">Nothing to undo.</span>'}</div>` : ''}
    ${rb || failed ? '' : `<div class="rl-rec-s rl-rec-exc" data-exceptions="${exc.length}"><span class="lbl">Exceptions · changed after an approval</span>${exc.length
      ? `<ul>${exc.map(x => { const v = exceptionView(x, r.projectId); return `<li>${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : esc(v.text)}${v.extra ? ` <small>${esc(v.extra)}</small>` : ''}</li>`; }).join('')}</ul>`
      : '<span class="hint">None. Nothing changed after its business unit signed off.</span>'}</div>`}
    <div class="rl-acts-list">${(r.actions || []).some(a => a.type === 'pipeline') ? '' : pipelineView(r, { type: 'pipeline', target: 'Customer CI/CD (simulated)' })}${(r.actions || []).filter(a => !failed || a.type === 'pipeline' || a.type === 'notify').map(a => actionView(a, r)).join('')}</div></div>`;
}

function releaseCards(prj, releases) {
  if (!releases.length) return `<div class="card"><h3>Release history</h3><div class="hint">No releases yet. The release record and its pipeline request appear here after go-live.</div></div>`;
  const latest = releases[0];
  const fresh = ui.lastRelease === latest.id;
  const rbLatest = isRollback(latest);
  const lf = pipePhase(latest) === 'failed';
  const running = ui.pipe && ui.pipe.id === latest.id && ui.pipe.phase !== 'failed' && ui.pipe.phase !== 'succeeded';
  const statusBadge = r => pipePhase(r) === 'failed' ? badge('failed · no changes', 'b-late') : isRollback(r) ? badge('rolled back', 'b-late') : badge('deployed', 'b-done');
  const sub = r => { const n = Object.keys(r.snapshot || {}).length; return pipePhase(r) === 'failed' ? (isRollback(r) ? 'pipeline failed · nothing restored' : 'pipeline failed · nothing promoted or published') : isRollback(r) ? `${n} process version${n === 1 ? '' : 's'} restored` : `${(r.actions || []).length} actions · ${(r.exceptions || []).length} exception${(r.exceptions || []).length === 1 ? '' : 's'}`; };
  const title = running ? (rbLatest ? 'Rollback running' : 'Release running') : lf ? (rbLatest ? 'Rollback failed' : 'Release failed') : fresh ? (rbLatest ? 'Rollback complete' : 'Release complete') : (rbLatest ? 'Latest rollback' : 'Latest release');
  return `<div class="card rl-latest ${fresh ? 'fresh' : ''} ${rbLatest || lf ? 'rb' : ''}"><h3>${title}</h3>${releaseRecord(latest)}</div>
    <div class="card"><h3>Release history<span class="n">${releases.length}</span></h3>${releases.map(r => `<div class="row click" data-relrow="${esc(r.id)}" data-kind="${isRollback(r) ? 'rollback' : 'golive'}" ${pipePhase(r) === 'failed' ? 'data-failed' : ''}><div><div class="t">${isRollback(r) ? 'Rollback' : 'Go-live'} · ${esc(fmtTime(r.at))}</div><div class="s">${esc(pname(r.by))} · ${sub(r)}</div></div><div class="r">${statusBadge(r)}</div></div>${ui.showRel.has(r.id) && r.id !== latest.id ? releaseRecord(r) : ''}`).join('')}</div>`;
}

/* ---------- R6: BU approver view, /release/:prj?bu=<BU> ---------- */
function latestOutcomes(prjId, envs) {
  const by = {};
  store.list('testRun', r => r.projectId === prjId && envs.includes(r.env)).sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .forEach(r => (r.results || []).forEach(x => { const k = x.caseId || x.scriptId; if (k && x.outcome !== 'not-run' && x.outcome !== 'skipped') by[k] = { outcome: x.outcome, env: r.env, at: r.at }; }));
  return by;
}
const OUT_B = { pass: 'b-done', fail: 'b-late', blocked: 'b-soon' };
function sectionScripts(prj, keys) {
  const e = E();
  let list = Array.isArray(prj.uatScripts) ? prj.uatScripts : [];
  if (!Array.isArray(prj.uatScripts) && e && e.generateUatScripts) { try { list = e.generateUatScripts(store.state.docs, prj.id) || []; } catch (err) { list = []; } }
  const scn = (prj.uatScenarios || []).filter(x => (x.steps || []).some(st => keys.has(x.pid + '|' + st.step)));
  return list.filter(x => keys.has(x.pid + '|' + x.step)).concat(scn.map(x => Object.assign({ scenario: true }, x)));
}
function buView(prj, buRaw, rd) {
  const sections = buSections(prj);
  const s = sections.find(x => x.bu.toLowerCase() === String(buRaw).toLowerCase());
  const back = `<a class="rl-go" href="${link('/release/' + prj.id)}" data-link data-bu-back>‹ Back to the full go-live page</a>`;
  const crumbs = `<div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> · <a href="${link('/project/' + prj.id)}" data-link>${esc(prj.name)}</a> · <a href="${link('/release/' + prj.id)}" data-link>Release</a> · ${esc(s ? s.bu : buRaw)}</div>`;
  if (!s) return `<section class="hdr"><div>${crumbs}<h1>${esc(buRaw)} section</h1><p>No step in ${esc(prj.name)} is owned by or tagged for ${esc(buRaw)}, so there is nothing for ${esc(buRaw)} to sign.</p>${back}</div></section>
    <div class="card"><div class="empty">Sections: ${sections.map(x => `<a href="${link(`/release/${prj.id}?bu=${encodeURIComponent(x.bu)}`)}" data-link>${esc(x.bu)}</a>`).join(' · ') || 'none yet'}.</div></div>`;
  const live = prj.status === 'live';
  const open = live || signoffOpenOf(rd);
  const a = latestApproval(prj.id, s.bu);
  const stale = live ? [] : staleChanges(prj, s, a, rd);
  const signed = a && counts(prj, a) && !stale.length;
  const state = !a ? 'Awaiting sign-off' : signed ? 'Signed off' : a.decision === 'rejected' ? 'Rejected' : stale.length ? 'Re-approval needed' : 'Needs an independent approver';
  const keys = new Set(s.steps.map(x => x.pid + '|' + x.step.id));
  const e = E();
  const diffs = {}; [...new Set(s.steps.map(x => x.pid))].forEach(pid => { const p = store.get('process', pid); try { diffs[pid] = p && e && e.diffProcess ? e.diffProcess(p) : { nodes: {}, changes: {} }; } catch (err) { diffs[pid] = { nodes: {}, changes: {} }; } });
  const work = store.list('workItem', w => w.projectId === prj.id && w.kind !== 'defect' && keys.has(w.pid + '|' + w.step));
  const DIFF_B = { new: 'b-prog', changed: 'b-soon', same: 'b-idle' };
  const nm = idNames();
  const steps = s.steps.map(x => {
    const d = diffs[x.pid] || { nodes: {}, changes: {} }; const st = d.nodes[x.step.id] || 'same'; const ch = (d.changes && d.changes[x.step.id]) || [];
    const ws = work.filter(w => w.pid === x.pid && w.step === x.step.id); const done = ws.filter(w => w.status === 'done').length;
    return `<li data-bu-step="${esc(x.step.id)}"><div class="rl-bv-t"><a href="${link(`/process/${x.pid}/step/${x.step.id}`)}" data-link>${x.via === 'trigger' ? 'Trigger: ' : ''}${esc(x.step.title)}</a>
        ${badge(st === 'same' ? 'unchanged' : st, DIFF_B[st] || 'b-idle')}${ws.length ? badge(`${done}/${ws.length} work done`, done === ws.length ? 'b-done' : 'b-prog') : ''}</div>
      <small>${esc(x.pname)}${x.step.owner ? ' · ' + esc(pname(x.step.owner)) : ''}${x.via !== 'owner' ? ` · in this section by its touches tag “${esc(x.tag)}”` : ''}</small>
      ${ch.length && st !== 'same' ? `<ul class="rl-bv-diff" data-bu-diff>${ch.slice(0, 6).map(c => `<li>${esc(humanizeSummary(c, nm))}</li>`).join('')}</ul>` : ''}</li>`;
  }).join('');
  /* data used by these steps (and their sub-steps) with its evidence */
  const dataIds = new Set(); s.steps.forEach(x => { (x.step.data || []).forEach(d => dataIds.add(d)); (x.step.subs || []).forEach(sb => (sb.data || []).forEach(d => dataIds.add(d))); });
  const des = [...dataIds].map(id => store.get('dataElement', id)).filter(Boolean);
  const outs = latestOutcomes(prj.id, ['uat', 'sit', 'prod-verify', 'dev']);
  const data = des.map(de => {
    const st = effAvail(de.id); const ev = evidenceOf(de);
    const kind = st !== 'live' ? 'none' : ev ? ev.type : 'seed';
    const cls = kind === 'none' ? 'fail' : kind === 'attested' ? 'warn' : 'pass';
    const label = st !== 'live' ? (AVAIL_TXT[st] || st) : ev ? ev.text : EV_TXT.seed;
    return `<li class="${cls}" data-bu-data="${esc(de.id)}"><span class="rl-ic ${cls}">${ICON[cls]}</span><span><a href="${link('/data/' + de.id)}" data-link>${esc(de.name)}</a> <span class="rl-evb ${esc(kind)}">${esc(label)}</span> <small>owner ${esc(pname(de.owner))}</small></span></li>`;
  }).join('');
  /* tests: data cases for that data, UAT scripts and scenarios for those steps */
  const caseRows = des.map(de => {
    const cs = store.list('testCase', c => c.dataId === de.id); const o = cs.map(c => outs[c.id] && outs[c.id].outcome);
    const p = o.filter(x => x === 'pass').length, f = o.filter(x => x === 'fail').length, nr = o.filter(x => !x).length;
    return `<tr data-bu-test="data:${esc(de.id)}"><td><span class="chip">Data</span> ${esc(de.name)}</td><td>${cs.length} case${cs.length === 1 ? '' : 's'}</td><td>${cs.length ? `${badge(p + ' pass', 'b-done')}${f ? badge(f + ' fail', 'b-late') : ''}${nr ? badge(nr + ' not run', 'b-idle') : ''}` : '<b>No cases</b>'}</td></tr>`;
  });
  const scr = sectionScripts(prj, keys).map(x => { const o = outs[x.id]; return `<tr data-bu-test="script:${esc(x.id)}"><td><span class="chip">${x.scenario ? 'Scenario' : 'UAT script'}</span> ${esc(x.title)}</td><td>${(x.steps || []).length || 1} step${((x.steps || []).length || 1) === 1 ? '' : 's'}</td><td>${o ? badge(`${o.outcome} · ${String(o.env).toUpperCase()}`, OUT_B[o.outcome] || 'b-idle') : badge('not run', 'b-idle')}</td></tr>`; });
  const tests = caseRows.concat(scr).join('');
  const caseIds = new Set(); des.forEach(de => store.list('testCase', c => c.dataId === de.id).forEach(c => caseIds.add(c.id)));
  const scrIds = new Set(sectionScripts(prj, keys).map(x => x.id));
  const defects = store.list('workItem', w => w.projectId === prj.id && w.kind === 'defect' && w.status !== 'done' && (keys.has(w.pid + '|' + w.step) || (w.testRef && (caseIds.has(w.testRef.caseId) || scrIds.has(w.testRef.scriptId)))));
  const changes = stale.length ? `<ul class="rl-bv-ch">${stale.map(v => `<li data-bu-change>${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : esc(v.text)} <small>${esc(v.extra)}</small></li>`).join('')}</ul>`
    : a && a.decision === 'approved' ? `<div class="hint" data-bu-nochange>Nothing in this section changed since ${esc(pname(a.approver))} signed off on ${esc(fmtTime(a.at))}.</div>`
    : `<div class="hint" data-bu-nochange>${esc(s.bu)} has not signed off yet, so everything above is new to review: ${s.steps.filter(x => ((diffs[x.pid] || { nodes: {} }).nodes[x.step.id] || 'same') !== 'same').length} new or changed step${s.steps.length === 1 ? '' : 's'}.</div>`;
  const why = live ? '' : signoffWhy(prj, s.bu, open);
  const form = live ? `<div class="hint">The project is live; sign-off is closed.</div>`
    : `<div class="rl-bv-form" data-bu-form><div class="field"><label for="rl-attest">Attestation note <span class="rl-req">required</span></label>
        <textarea id="rl-attest" data-attest placeholder="What you checked, e.g. “I reviewed the ${esc(s.bu)} steps, the evidence for their data, and the UAT results.”" ${why ? 'disabled' : ''}>${esc(ui.attest[prj.id + '|' + s.bu] || '')}</textarea></div>
        <div class="rl-err" data-attest-err role="alert" hidden></div>
        <div class="rl-bu-act">${why ? `<button class="btn sm" disabled data-locked>${a && a.decision === 'approved' ? 'Re-approve' : 'Approve section'}</button>${why}`
          : `<button class="btn primary sm" data-bu-decide="approved">${a && a.decision === 'approved' ? 'Re-approve' : 'Approve section'}</button><button class="btn sm danger" data-bu-decide="rejected">Reject</button><span class="hint">Your note is stored on the approval. Step-up MFA follows.</span>`}</div></div>`;
  return `<section class="hdr rl-hdr"><div>${crumbs}
      <div class="rl-title"><h1>${esc(s.bu)} sign-off</h1>${badge(state, signed ? 'b-done' : a && (a.decision === 'rejected' || stale.length) ? 'b-late' : 'b-soon')}</div>
      <p>Everything ${esc(s.bu)} is signing for in <b>${esc(prj.name)}</b>, on one screen: its steps and what changed, the data they use and its evidence, test results, open defects, and changes since the last sign-off.</p>${back}</div>
    <div class="hdr-side"><div class="kpis"><div class="kpi"><b>${s.steps.length}</b><span>Steps</span></div><div class="kpi"><b>${des.length}</b><span>Data elements</span></div><div class="kpi"><b class="${defects.length ? 'fail' : ''}">${defects.length}</b><span>Open defects</span></div><div class="kpi"><b class="${stale.length ? 'fail' : ''}">${stale.length}</b><span>Changes since sign-off</span></div></div></div></section>
    <div class="grid rl-grid rl-bv" data-bu-view="${esc(s.bu)}"><div class="rl-main">
      <div class="card"><h3>Steps<span class="n">${s.steps.length}</span></h3><ol class="rl-bv-steps">${steps}</ol></div>
      <div class="card"><h3>Data and evidence<span class="n">${des.length}</span></h3>${data ? `<ul class="rl-bv-data">${data}</ul>` : '<div class="empty">These steps use no data elements.</div>'}</div>
      <div class="card"><h3>Test results<span class="n">latest per item</span></h3>${tests ? `<div class="tbl-wrap"><table class="rl-gt rl-bv-tests"><thead><tr><th>Item</th><th>Size</th><th>Latest result</th></tr></thead><tbody>${tests}</tbody></table></div>` : '<div class="empty">No tests cover these steps or their data yet.</div>'}
        <div class="rl-item-foot"><a class="rl-go" href="${link('/testing/' + prj.id)}" data-link>Open testing ›</a></div></div>
    </div><aside class="side">
      <div class="card rl-bv-sign"><h3>Sign off ${esc(s.bu)}</h3>
        ${a ? `<div class="rl-signed">${av(a.approver)} <span>${esc(pname(a.approver))} ${a.decision === 'approved' ? 'approved' : 'rejected'} · ${esc(fmtTime(a.at))}${a.stepUp ? ' · <span class="rl-mfa">MFA verified</span>' : ''}</span></div>${a.attestation || a.note ? `<div class="rl-attest" data-attestation>“${esc(a.attestation || a.note)}”</div>` : ''}` : '<div class="hint">Not signed yet.</div>'}
        ${form}</div>
      <div class="card"><h3>Changes since last sign-off<span class="n">${stale.length}</span></h3>${changes}</div>
      <div class="card"><h3>Open defects<span class="n">${defects.length}</span></h3>${defects.map(w => `<div class="row" data-bu-defect="${esc(w.id)}"><div><div class="t">${esc(w.title)}</div><div class="s">${esc(pname(w.owner))}${w.severity ? ` · severity ${esc(w.severity)}` : ''} · due ${esc(fmt(w.due))}</div></div></div>`).join('') || '<div class="hint">No open defects on these steps or their data.</div>'}</div>
    </aside></div>`;
}

/* Who may decide this section, with a toast when not. */
function canDecide(prj, bu, decision) {
  if (store.state.me === prj.owner && decision === 'approved') { toast("Project owners can't approve their own release."); return false; }
  if (store.state.me === rmOf(prj) && decision === 'approved') { toast("The release manager can't sign off a business-unit section."); return false; }
  if (!signoffOpenOf(readiness(prj.id))) { toast('Sign-off opens when the other checks pass.'); return false; }
  return true;
}
/* Record a BU decision: the attestation note is required and stored on the approval, then step-up. */
async function decide(prj, bu, decision, note) {
  const attestation = String(note || '').trim();
  if (!attestation) { toast('An attestation note is required.'); return false; }
  if (!(await stepUp(`${decision === 'approved' ? 'approve' : 'reject'} the ${bu} section`))) { toast('Step-up not completed. Nothing was signed.'); return false; }
  const prev = latestApproval(prj.id, bu);
  const re = decision === 'approved' && prev && prev.decision === 'approved';
  const id = store.newId('apr'); const at = new Date().toISOString();
  await store.save('approval', id, { id, projectId: prj.id, bu, approver: store.state.me, decision, at, snapshotAt: at, stepUp: true, attestation, note: attestation },
    `${decision === 'approved' ? (re ? 'Re-approved' : 'Approved') : 'Rejected'} the ${bu} section of ${prj.name} (step-up verified): “${attestation.slice(0, 120)}”`);
  await store.notify([prj.owner], `${pname(store.state.me)} ${decision} the ${bu} section of ${prj.name}`, 'approval:' + id);
  delete ui.attest[prj.id + '|' + bu];
  toast(`${bu} section ${decision}`);
  return true;
}
function bindBuView(root, prj, bu) {
  const ta = root.querySelector('[data-attest]');
  const key = prj.id + '|' + ((root.querySelector('[data-bu-view]') || {}).dataset || {}).buView;
  if (ta) ta.oninput = () => { ui.attest[key] = ta.value; };
  root.querySelectorAll('[data-bu-decide]').forEach(b => b.onclick = async () => {
    const decision = b.dataset.buDecide; const err = root.querySelector('[data-attest-err]');
    const secBu = root.querySelector('[data-bu-view]').dataset.buView;
    if (!ta.value.trim()) { err.hidden = false; err.textContent = decision === 'approved' ? 'Write what you are attesting to: it is stored on the approval.' : 'Say what needs to change before you can sign off.'; ta.setAttribute('aria-invalid', 'true'); ta.focus(); return; }
    err.hidden = true; ta.removeAttribute('aria-invalid');
    if (!canDecide(prj, secBu, decision)) return;
    await decide(prj, secBu, decision, ta.value);
  });
  bindActivity(root);
}

/* ---------- bind ---------- */
export function bind(root, params) {
  const prjId = params.prj;
  const prj = store.get('project', prjId);
  const sw = root.querySelector('[data-switch]');
  if (sw) sw.onchange = () => { ui.reasons = null; go('/release/' + sw.value); };
  if (!prj) return;
  if (params.q && params.q.bu) { bindBuView(root, prj, params.q.bu); return; }

  root.querySelectorAll('details[data-check]').forEach(d => d.addEventListener('toggle', () => { d.open ? ui.open.add(d.dataset.check) : ui.open.delete(d.dataset.check); }));
  root.querySelectorAll('[data-anchor]').forEach(a => a.onclick = e => { e.preventDefault(); const t = root.querySelector('#' + a.dataset.anchor); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  /* BU sign-off */
  /* BU sign-off from the main page: the attestation note is asked for in a dialog (required), then step-up */
  root.querySelectorAll('[data-signoff]').forEach(b => b.onclick = async () => {
    const bu = b.dataset.bu, decision = b.dataset.signoff;
    if (!canDecide(prj, bu, decision)) return;
    const apv = decision === 'approved';
    const p = modal({ title: `${apv ? 'Approve' : 'Reject'} the ${bu} section`,
      body: `<div class="field"><label>${apv ? 'Attestation' : 'Reason'} <span class="rl-req">required</span></label><textarea name="note" data-attest-modal placeholder="${apv ? `What you checked, e.g. "I reviewed the ${esc(bu)} steps, their data and test results."` : 'What needs to change before you can sign off?'}"></textarea></div>
        <div class="hint">Stored on the approval with your name and the time. Use “Review section” to see everything in ${esc(bu)} on one screen.</div>`,
      actions: [{ id: 'go', label: apv ? 'Continue to verify' : 'Reject', primary: apv, danger: !apv }] });
    guardModal(f => !String(f.note || '').trim() ? { msg: apv ? 'Write what you are attesting to: it is stored on the approval.' : 'Say what needs to change.', field: 'note' } : null);
    const r = await p;
    if (r.action !== 'go') return;
    await decide(prj, bu, decision, r.form.note);
  });

  /* Grants */
  const rq = root.querySelector('[data-request]');
  if (rq) rq.onclick = () => requestAccess(prj);
  root.querySelectorAll('[data-glog]').forEach(b => b.onclick = () => { const k = 'log:' + b.dataset.glog; ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k); store.emit(); });
  root.querySelectorAll('[data-gact]').forEach(b => b.onclick = () => grantAction(prj, b.dataset.gid, b.dataset.gact));

  /* Go-live */
  const gl = root.querySelector('[data-golive]');
  if (gl) gl.onclick = () => goLive(prj);
  root.querySelectorAll('[data-rollback],[data-rollback-hc]').forEach(b => b.onclick = () => rollBack(prj));
  const ia = root.querySelector('[data-inc-add]'); if (ia) ia.onclick = () => addIncident(prj, root);
  const it = root.querySelector('[data-inc-title]'); if (it) it.oninput = () => { ui.incident[prj.id] = Object.assign({}, ui.incident[prj.id], { title: it.value }); };
  const is = root.querySelector('[data-inc-sev]'); if (is) is.onchange = () => { ui.incident[prj.id] = Object.assign({}, ui.incident[prj.id], { sev: is.value }); };
  root.querySelectorAll('[data-inc-resolve]').forEach(b => b.onclick = () => resolveIncident(prj, b.dataset.incResolve));
  const rt = root.querySelector('[data-retry]');
  if (rt) rt.onclick = () => goLive(prj, true);
  root.querySelectorAll('[data-rb-done]').forEach(cb => cb.onchange = () => tickTask(prj, cb.dataset.rbDone, cb.checked));
  const ce = root.querySelector('[data-cutover-edit]');
  if (ce) ce.onclick = () => editCutover(prj);
  root.querySelectorAll('[data-relrow]').forEach(r => r.onclick = () => { const id = r.dataset.relrow; ui.showRel.has(id) ? ui.showRel.delete(id) : ui.showRel.add(id); store.emit(); });

  bindActivity(root);
  bindAudit(root, prj);
}

/* R6: the gate audit log reads top to bottom in true chronological order (oldest first). The API returns newest first and
   stamps each go-live/rollback step 1 ms apart; ties keep the server's order. */
async function bindAudit(root, prj) {
  const box = root.querySelector('[data-rl-history]'); if (!box) return;
  const refs = new Set(['project:' + prj.id]);
  ['grant', 'approval', 'release'].forEach(t => store.list(t, d => d.projectId === prj.id).forEach(d => refs.add(t + ':' + d.id)));
  (prj.processes || []).forEach(p => refs.add('process:' + p));
  const all = await store.events(null, 200);
  const evs = all.map((e, i) => Object.assign({ _i: i }, e)).filter(e => refs.has(e.ref) && (e.action !== 'update' || !String(e.ref).startsWith('process:'))).slice(0, 30)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || b._i - a._i);
  const nm = idNames();
  if (!root.contains(box)) return;
  box.innerHTML = evs.length ? `<div class="hint rl-aud-h">Oldest first · ${evs.length} most recent gate events</div>` + evs.map(e => `<div class="ev" data-audit="${esc(e.action || '')}"><time datetime="${esc(e.at)}">${esc(fmtTime(e.at))}</time><span>${av(e.actor)} <b>${esc(pname(e.actor))}</b> <span data-audit-text>${esc(humanizeSummary(e.summary || e.action, nm))}</span></span></div>`).join('') : '<div class="hint">No gate activity yet.</div>';
}

async function requestAccess(prj) {
  const des = projectData(prj);
  if (!des.length) { toast('This project uses no data elements yet.'); return; }
  const p = modal({
    title: 'Request integration access',
    body: `<div class="field"><label>Data element</label><select name="dataId">${des.map(d => `<option value="${esc(d.id)}">${esc(d.name)} — owner ${esc(pname(d.owner))}</option>`).join('')}</select></div>
      <div class="frow"><div class="field"><label>Environment</label><select name="env"><option value="dev">Dev</option><option value="uat">UAT</option></select></div>
      <div class="field"><label>Access</label><select name="access"><option value="read">Read</option><option value="write">Write</option></select></div></div>
      <div class="field"><label>Reason</label><textarea name="reason" placeholder="What the integration needs this data for"></textarea></div>
      <div class="field"><label>Duration (days, max 30)</label><input type="number" name="days" value="30" min="1" max="30" inputmode="numeric"></div>
      <div class="hint">The time box starts when the data owner approves, not when you ask: a request waiting a week still gets its full duration. Only data elements used by this project's processes can be requested. The data owner approves with step-up MFA.</div>`,
    actions: [{ id: 'send', label: 'Send request', primary: true }],
  });
  guardModal(f => {
    if (!f.reason || !f.reason.trim()) return { msg: 'Add a reason so the data owner can decide.', field: 'reason' };
    const n = String(f.days || '').trim();
    if (!/^\d+$/.test(n) || +n < 1 || +n > 30) return { msg: 'Duration must be a whole number of days from 1 to 30. Grants are time-boxed.', field: 'days' };
    return null;
  });
  const r = await p;
  if (r.action !== 'send') return;
  const f = r.form;
  const de = store.get('dataElement', f.dataId);
  const id = store.newId('grt'); const me = store.state.me;
  await store.save('grant', id, { id, projectId: prj.id, dataId: f.dataId, env: f.env, access: f.access, reason: f.reason.trim(), requestedBy: me, status: 'requested', durationDays: +f.days, log: [{ at: new Date().toISOString(), by: me, action: `requested ${f.access} access in ${f.env.toUpperCase()} for ${+f.days} days from approval` }] },
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
  let status, verb, expires = null;
  if (act === 'approve') {
    if (!(await stepUp(`approve ${g.access} access to ${de.name}`))) { toast('Step-up not completed. Access not granted.'); return; }
    expires = addDays(store.state.today, grantDays(g));
    status = 'active'; verb = `approved (step-up verified); access active until ${fmt(expires)}`;
  } else if (act === 'deny') { status = 'denied'; verb = 'denied'; }
  else {
    const r = await modal({ title: 'Revoke access?', body: `<p style="margin:0">${esc(de.name)} · ${esc(String(g.env).toUpperCase())} · ${esc(g.access)}. The integration loses access immediately.</p>`, actions: [{ id: 'revoke', label: 'Revoke', danger: true }] });
    if (r.action !== 'revoke') return; status = 'revoked'; verb = 'revoked';
  }
  const next = Object.assign({}, g, { status, log: [...(g.log || []), { at: new Date().toISOString(), by: me, action: verb }] });
  if (act === 'approve') { next.approvedBy = me; next.approvedAt = new Date().toISOString(); next.expires = expires; }
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

function rbFailBanner(prj, rel) {
  return `<div class="rl-failbn" data-rollback-failed><div><b>Rollback failed: the rollback pipeline did not succeed.</b><span class="sim">Simulated pipeline</span>
      <div class="rl-noeffect-b" data-no-side-effects><b>Nothing was restored.</b> The released versions are still live and the SOP was not re-published. Only the release manager was notified.</div>
      <div class="hint">${esc(pipeError(rel))}</div></div>
    ${canRollback(prj) ? '<button class="btn danger" data-rollback>Retry rollback</button>' : `<span class="hint" data-why="rm">Only the release manager (${esc(pname(rmOf(prj)))}) can retry.</span>`}</div>`;
}

/* R6 hypercare: days remaining and owner from the cutover plan, plus an incident log on project.incidents.
   An open severity-1 incident suggests a rollback. */
const SEV = { 1: 'Sev 1 · critical', 2: 'Sev 2 · major', 3: 'Sev 3 · minor', 4: 'Sev 4 · cosmetic' };
function hypercareCard(prj, lastGo) {
  const c = prj.cutover || {};
  const total = Number(c.hypercareDays) || 0;
  const since = prj.liveAt || (lastGo && lastGo.at);
  const elapsed = since ? Math.max(0, -days(String(since).slice(0, 10))) : 0;
  const left = Math.max(0, total - elapsed);
  const inc = (Array.isArray(prj.incidents) ? prj.incidents : []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const open = inc.filter(x => x.status !== 'resolved');
  const sev1 = open.filter(x => +x.severity === 1);
  const f = ui.incident[prj.id] || {};
  return `<div class="card rl-hc" id="hypercare" data-hypercare><h3>Hypercare<span class="n" data-hc-left="${left}">${total ? (left ? `${left} of ${total} day${total === 1 ? '' : 's'} left` : 'ended') : 'no period set'}</span></h3>
    <div class="rl-hc-h"><span class="lbl">Owner</span>${c.hypercareOwner ? `${av(c.hypercareOwner)} <b>${esc(pname(c.hypercareOwner))}</b>` : '<b class="rl-noown">Not set</b>'}
      <span class="hint">Live since ${esc(fmt(since))}. Log anything that goes wrong after go-live here; the hypercare owner triages it.</span></div>
    ${total ? `<div class="rl-rbar" aria-label="${left} days of hypercare left"><i style="width:${Math.round(100 * Math.min(total, elapsed) / total)}%"></i></div>` : ''}
    ${sev1.length ? `<div class="rl-sev1" data-consider-rollback><span class="rl-ic fail">!</span><div><b>Consider rollback.</b> ${sev1.length} open severity-1 incident${sev1.length === 1 ? '' : 's'}: ${sev1.map(x => esc(x.title)).join(' · ')}.
      <div class="hint">${canRollback(prj) ? 'You are the release manager: the rollback is in the release summary above.' : `Only the release manager (${esc(pname(rmOf(prj)))}) can roll back.`}</div></div>${canRollback(prj) ? '<button class="btn sm danger" data-rollback-hc>Roll back…</button>' : ''}</div>` : ''}
    <div class="rl-inc-form" data-incident-form><input data-inc-title placeholder="What went wrong? e.g. Approver emails not sent" aria-label="Incident title" value="${esc(f.title || '')}">
      <select data-inc-sev aria-label="Severity">${[1, 2, 3, 4].map(n => `<option value="${n}" ${String(f.sev || 3) === String(n) ? 'selected' : ''}>${SEV[n]}</option>`).join('')}</select>
      <button class="btn sm primary" data-inc-add>Log incident</button></div>
    <div class="rl-err" data-inc-err role="alert" hidden></div>
    <div class="rl-incs">${inc.map(x => `<div class="rl-inc ${x.status === 'resolved' ? 'done' : ''}" data-incident="${esc(x.id)}" data-sev="${esc(x.severity)}">
      ${badge(SEV[x.severity] || 'Sev ' + x.severity, +x.severity === 1 ? 'b-late' : +x.severity === 2 ? 'b-soon' : 'b-idle')}
      <div class="rl-inc-t"><b>${esc(x.title)}</b><small>${esc(pname(x.by))} · ${esc(fmtTime(x.at))}${x.status === 'resolved' && x.resolvedBy ? ` · resolved by ${esc(pname(x.resolvedBy))}` : ''}</small></div>
      ${badge(x.status === 'resolved' ? 'resolved' : 'open', x.status === 'resolved' ? 'b-done' : 'b-late')}
      ${x.status !== 'resolved' ? `<button class="btn sm" data-inc-resolve="${esc(x.id)}">Resolve</button>` : ''}</div>`).join('') || '<div class="hint">No incidents logged.</div>'}</div></div>`;
}
async function addIncident(prj, root) {
  const t = root.querySelector('[data-inc-title]'); const sev = +root.querySelector('[data-inc-sev]').value; const err = root.querySelector('[data-inc-err]');
  const title = t.value.trim();
  if (!title) { err.hidden = false; err.textContent = 'Describe the incident in a few words.'; t.setAttribute('aria-invalid', 'true'); t.focus(); return; }
  const cur = store.get('project', prj.id) || prj;
  const x = { id: store.newId('inc'), title, severity: sev, at: new Date().toISOString(), by: store.state.me, status: 'open' };
  delete ui.incident[prj.id];
  await store.save('project', prj.id, Object.assign({}, cur, { incidents: (cur.incidents || []).concat([x]) }), `Logged hypercare incident (severity ${sev}): ${title}`);
  const owner = (cur.cutover || {}).hypercareOwner;
  await store.notify([owner, sev === 1 ? rmOf(cur) : null], `${pname(store.state.me)} logged a severity-${sev} incident on ${cur.name}: ${title}`, 'project:' + prj.id);
  toast(sev === 1 ? 'Severity-1 incident logged. Consider rollback.' : 'Incident logged');
}
async function resolveIncident(prj, id) {
  const cur = store.get('project', prj.id) || prj;
  const x = (cur.incidents || []).find(i => i.id === id); if (!x) return;
  await store.save('project', prj.id, Object.assign({}, cur, { incidents: cur.incidents.map(i => i.id === id ? Object.assign({}, i, { status: 'resolved', resolvedBy: store.state.me, resolvedAt: new Date().toISOString() }) : i) }), `Resolved hypercare incident: ${x.title}`);
  toast('Incident resolved');
}

function failBanner(prj, rel) {
  const err = pipeError(rel);
  const rm = rmOf(prj);
  return `<div class="rl-failbn" data-pipeline-failed><div><b>Release failed: the deployment pipeline did not succeed.</b><span class="sim">Simulated pipeline</span>
      <div class="rl-noeffect-b" data-no-side-effects><b>Nothing was promoted or published.</b> The process versions, the SOP and the access grants are exactly as they were, and only the release manager was notified.</div>
      <div class="hint">${esc(err)}</div></div>
    ${store.state.me === rm ? `<button class="btn primary" data-retry ${readiness(prj.id).pass && !gngOpen(prj).length ? '' : 'disabled'}>Retry go-live</button>` : `<span class="hint" data-why="rm">Only the release manager (${esc(pname(rm))}) can retry.</span>`}</div>`;
}

/* Simulated pipeline animation: queued -> running -> the server's outcome (succeeded | failed). The server already decided
   and wrote its audit trail in order (approval -> pipeline -> promotion/restore -> publish -> grants -> notifications), so the
   animation is display only: it writes nothing, which keeps the audit log truthful and a failure to exactly one entry. */
const PIPE_MS = 1300;
function startPipeline(prj, relId, fail, kind) {
  ui.pipe = { id: relId, phase: 'queued', fail, kind };
  store.emit();
  setTimeout(() => { if (ui.pipe && ui.pipe.id === relId) { ui.pipe.phase = 'running'; store.emit(); } }, PIPE_MS);
  setTimeout(() => finishPipeline(prj, relId), PIPE_MS * 2 + 200);
}
function finishPipeline(prj, relId) {
  const p = ui.pipe; if (!p || p.id !== relId) return;
  ui.pipe = null; store.emit();
  const rb = p.kind === 'rollback';
  toast(p.fail ? (rb ? 'Rollback pipeline failed (simulated). Nothing was restored.' : 'Pipeline failed (simulated). Nothing was promoted or published.') : (rb ? 'Rollback pipeline succeeded (simulated)' : 'Pipeline succeeded (simulated)'));
}
/* The release the server just wrote: from the response, else the newest for the project. */
function newestRelease(prj, res) {
  const rel = (res && (res.release || (res.data && res.data.projectId ? res.data : null) || (res.projectId ? res : null))) || null;
  const latest = store.list('release', x => x.projectId === prj.id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  return (rel && rel.id && store.get('release', rel.id)) || rel || latest || null;
}
const SIMFAIL = what => `<label class="rl-simfail"><input type="checkbox" name="simfail" value="1" data-simfail> <span><b>Simulate failure</b><small>The simulated pipeline fails. The server then records a failed ${what} and changes nothing.</small></span></label>`;

async function goLive(prj, retry) {
  const rm = rmOf(prj);
  if (store.state.me !== rm) { toast(`Only the release manager (${pname(rm)}) can go live.`); return; }
  const rd = readiness(prj.id);
  if (!rd.pass) { toast('The gate is not passing yet.'); return; }
  const procs = projectProcesses(prj);
  const sections = buSections(prj);
  const approvers = [...new Set(sections.map(s => latestApproval(prj.id, s.bu)).filter(a => counts(prj, a)).map(a => a.approver))];
  const openGrants = store.list('grant', g => g.projectId === prj.id && ['active', 'approved'].includes(grantStatus(g))).length;
  const excs = cycleExceptions(prj);
  const tasks = tasksOf(prj.cutover);
  const gOpen = gngOpen(prj);
  /* the runbook as a plain table: every task keeps its owner's name */
  const rbRows = tasks.map((t, i) => `<tr data-gl-task="${esc(t.id)}" class="${t.gonogo ? 'gng' : ''}"><td>${i + 1}</td><td>${esc(t.task)}${t.gonogo ? ` <span class="rl-gng">${GNG()}</span>` : ''}</td>
    <td data-gl-owner="${esc(t.owner || '')}">${t.owner ? `${av(t.owner)} ${esc(pname(t.owner))}` : '<b class="rl-noown">No owner</b>'}</td>
    <td>${t.gonogo ? (t.done ? `<span class="rl-ok">Confirmed by ${esc(pname(t.doneBy || t.owner))}</span>` : '<b class="rl-noown">Not confirmed</b>') : t.done ? 'Done' : esc(fmtPlanned(startOf(t)))}${overdue(t) ? ' <span class="badge b-late">Overdue</span>' : ''}</td></tr>`).join('');
  const r = modal({
    title: `${retry ? 'Retry release' : 'Release'} ${prj.name}`,
    body: `<div class="rl-sum">
      <div><span class="lbl">Release manager</span><div>${av(rm)} ${esc(pname(rm))}</div></div>
      <div><span class="lbl">Processes promoted if the pipeline succeeds</span>${procs.map(p => `<div>${esc(p.name)} <b>v${esc(p.version || 1)} → v${esc((p.version || 1) + 1)}</b></div>`).join('')}</div>
      <div><span class="lbl">Signed off by</span>${approvers.map(id => `<div>${av(id)} ${esc(pname(id))}</div>`).join('')}</div>
      <div><span class="lbl">Access</span><div>${openGrants} open grant${openGrants === 1 ? '' : 's'} will expire if the pipeline succeeds</div></div>
      <div><span class="lbl">Re-approved changes</span><div>${excs.length ? `${excs.length} change${excs.length === 1 ? '' : 's'} made after a sign-off, then re-approved` : 'None'}</div></div>
      <div><span class="lbl">Release actions</span><div>Run the deployment pipeline, then promote the processes, publish the new SOP, expire access and notify stakeholders</div></div></div>
      <div class="rl-gl-rb" data-golive-runbook>${tasks.length ? `<div class="rl-rb-h"><b>Cutover runbook</b><span class="hint">${gngOf(prj).length - gOpen.length}/${gngOf(prj).length} ${GNG()} confirmed</span></div>
        <div class="tbl-wrap"><table class="rl-gltbl"><thead><tr><th>#</th><th>Task</th><th>Owner</th><th>Status</th></tr></thead><tbody>${rbRows}</tbody></table></div>` : '<div class="hint">No runbook tasks.</div>'}
        ${gOpen.length ? `<div class="rl-err" data-gng-block>Go-live is blocked until every go/no-go task has an owner who has confirmed it.</div>` : ''}</div>
      ${SIMFAIL('release: no promotion, no SOP publish, no access expiry')}
      <span class="sim">Simulated: in this showroom the pipeline trigger is recorded, not sent, and its run is animated.</span>`,
    actions: [{ id: 'go', label: 'Continue to verify', primary: true }],
  });
  guardModal(() => gngOpen(store.get('project', prj.id) || prj).length ? 'Every go/no-go task must be confirmed by its owner before go-live.' : null);
  const res0 = await r;
  if (res0.action !== 'go') return;
  const fail = (res0.form.simfail || []).includes('1');
  if (!(await stepUp('release to production'))) { toast('Step-up not completed. Nothing was released.'); return; }
  ui.pipeStart = prj.id;
  try {
    const res = await store.api('/golive/' + prj.id, { simulateFailure: fail, stepUp: { method: 'simulated-mfa', at: new Date().toISOString() } });
    ui.reasons = null;
    await store.load();
    const rel = newestRelease(prj, res);
    ui.lastRelease = rel ? rel.id : null;
    const failed = !!(res && res.failed) || failedAny(rel);
    ui.pipeStart = null;
    if (rel) startPipeline(prj, rel.id, failed, 'golive'); else store.emit();
    toast(failed ? `${prj.name} · pipeline queued (simulated)` : `${prj.name} is live · pipeline queued (simulated)`);
  } catch (e) {
    ui.pipeStart = null;
    if (e.status === 409 || e.status === 403) { ui.reasons = (e.body && e.body.reasons && e.body.reasons.length) ? e.body.reasons : [e.message || `Only the release manager (${pname(rm)}) can go live.`]; store.emit(); toast(e.status === 403 ? 'Go-live refused: only the release manager can go live.' : 'Go-live refused. See the reasons above the checklist.'); }
    else toast('Go-live failed: ' + e.message);
  }
}

/* R6: rollback runs a pipeline too, with the same success/failure handling. */
async function rollBack(prj) {
  const rm = rmOf(prj);
  if (!canRollback(prj)) { toast(`Only the release manager (${pname(rm)}) can roll back.`); return; }
  const procs = projectProcesses(prj);
  const r = await modal({
    title: `Roll back ${prj.name}?`,
    body: `<p style="margin:0 0 8px">The rollback pipeline runs first. Only if it succeeds does the server restore the previous as-is version of each process, re-publish the previous SOP and set the project back to active. The released version stays in history.</p>
      <div class="rl-sum"><div><span class="lbl">Processes restored</span>${procs.map(p => `<div>${esc(p.name)} <b>v${esc(p.version || 1)} → v${esc(Math.max(1, (p.version || 1) - 1))}</b></div>`).join('')}</div>
      <div><span class="lbl">Rollback plan</span><div>${esc((prj.cutover || {}).rollbackPlan || 'No plan recorded')}</div></div></div>
      <div class="field" style="margin-top:10px"><label>Reason</label><textarea name="reason" placeholder="What went wrong?"></textarea></div>
      ${SIMFAIL('rollback: nothing is restored or re-published, and the release stays live')}`,
    actions: [{ id: 'rollback', label: 'Continue to verify', danger: true }],
  });
  if (r.action !== 'rollback') return;
  const fail = (r.form.simfail || []).includes('1');
  if (!(await stepUp('roll back the release'))) { toast('Step-up not completed. Nothing was rolled back.'); return; }
  const reason = (r.form.reason || '').trim();
  ui.pipeStart = prj.id;
  try {
    const res = await store.api('/rollback/' + prj.id, { reason, simulateFailure: fail, stepUp: { method: 'simulated-mfa', at: new Date().toISOString() } });
    await store.load();
    const rel = newestRelease(prj, res);
    ui.lastRelease = rel ? rel.id : null;
    const failed = !!(res && res.failed) || failedAny(rel);
    ui.pipeStart = null;
    if (rel) startPipeline(prj, rel.id, failed, 'rollback'); else store.emit();
    toast(failed ? `${prj.name} · rollback pipeline queued (simulated)` : `${prj.name} rolled back · pipeline queued (simulated)`);
  } catch (e) {
    ui.pipeStart = null;
    if (e.status === 403 || e.status === 409) { ui.reasons = (e.body && e.body.reasons && e.body.reasons.length) ? e.body.reasons : [e.message || `Only the release manager (${pname(rm)}) can roll back.`]; store.emit(); }
    toast('Rollback refused: ' + e.message);
  }
}
