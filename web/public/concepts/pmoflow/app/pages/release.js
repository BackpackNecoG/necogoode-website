/* Release page (stream R): readiness gate, BU sign-off, project-scoped access grants, go-live + release history.
   Route: /release/:prj */
import { store } from '../store.js';
import { E, esc, fmt as fmtDay, fmtTime, days, addDays, link, go, av, pname, badge, chip, modal, toast, commentsPanel, bindActivity, formValues } from '../ui.js';

/* R8: timestamps (ISO with a time) render as the browser's LOCAL calendar date; plain YYYY-MM-DD dates stay as they are. */
const fmt = s => s && /T\d/.test(String(s)) && !isNaN(new Date(s)) ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : fmtDay(s);

/* Module state survives the router's full re-render on every store change. */
const ui = { open: new Set(), lastRelease: null, reasons: null, showRel: new Set(), pipe: null, attest: {}, incident: {} };

const ICON = { pass: '✓', fail: '✕', warn: '!' };
const LOCKI = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const CHECK_LINK = {
  'work-done': p => ({ href: `/project/${p}?mode=work`, label: 'Open project work' }),
  'data-live': () => null, /* per-item links to the data pages */
  'tests-passed': p => ({ href: `/testing/${p}`, label: 'Open testing' }),
  'grants-closed': () => ({ anchor: 'grants', label: 'Jump to temporary data access' }),
  'bu-signoff': () => ({ anchor: 'signoff', label: 'Jump to approvals' }),
  'two-person': () => ({ anchor: 'signoff', label: 'Jump to approvals' }),
  'exceptions': () => ({ anchor: 'signoff', label: 'Jump to approvals' }),
  'discovered-resolved': p => ({ href: `/testing/${p}`, label: 'Resolve on the testing page' }),
  'process-valid': () => null, /* per-item links to the process editor */
  'cutover-plan': () => ({ anchor: 'cutover', label: 'Jump to the launch-day plan' }),
};

/* R6: plain-language check labels; jargon only with a tooltip. [label, tooltip] */
const PLAIN = {
  'work-done': ['All project work is finished', 'Every work item in the project plan is done.'],
  'data-live': ['All information is connected', 'Each piece of information the process uses is connected to its real source, with proof.'],
  'tests-passed': ['Tests passed, including business testing', 'Business testing (UAT): the people who run the process confirm it works, step by step.'],
  'grants-closed': ['Temporary data access closes at launch', 'Access opened for building and testing closes when the project launches.'],
  'bu-signoff': ['Every affected team approved its part', 'Each team whose steps change approves its own part.'],
  'two-person': ['Two different people approved', 'Separation of duties: at least two independent approvers.'],
  'exceptions': ['Nothing changed after approval', 'Any edit after an approval sends that part back for approval.'],
  'discovered-resolved': ['Rules found in testing are settled', 'Rules nobody had written down, found by failing tests, are settled by the information owner.'],
  'process-valid': ['Process maps are complete', 'Every step has an owner and every choice has its paths.'],
  'cutover-plan': ['Launch-day plan is ready', 'Launch-day plan (cutover runbook): the timed steps for switching from the old way of working to the new one, plus who undoes it if needed and who supports it afterwards.'],
};
const plainOf = c => (PLAIN[c.id] || [c.label, ''])[0] || c.label;
const tipOf = c => (PLAIN[c.id] || [])[1] || '';
/* A jargon term with its plain meaning as a tooltip. */
export const term = (word, tip) => `<abbr class="rl-term" title="${esc(tip)}" tabindex="0">${esc(word)}</abbr>`;
const GNG = () => term('Final check', 'Go/no-go: a checkpoint where the named owner confirms it is safe to continue the launch.');

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
const AVAIL_TXT = { live: 'Connected', pending: 'Waiting for confirmation', example: 'Sample only', missing: 'Not available yet' };

/* R5 roles: the release manager (defaults to the PM) is the only person who can go live or roll back,
   and can't be counted as a BU approver (separation of duties). */
export const rmOf = prj => (prj && (prj.releaseManager || prj.owner)) || null;
function rmLine(prj) {
  const rm = rmOf(prj);
  return `<div class="rl-rm" data-rm="${esc(rm || '')}"><span class="lbl" title="Release manager">Launch owner</span>${rm ? `${av(rm)} <b>${esc(pname(rm))}</b>` : '<b>Not set</b>'}
    <span class="hint">Only the launch owner can launch or undo the launch. They can't approve a team's part.</span></div>`;
}

/* Live evidence (R5): profile with zero blocking drift, a passing connection check, or an attested link + note (weaker). */
const EV_TXT = { profile: 'Sample data checked: matches the rules', check: 'Connection check passed', attested: 'Owner confirmed with a link and a note (weaker)', seed: 'Connected' };
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
  /* R8: a team whose part didn't change doesn't approve: no section unless one of its steps is new or changed,
     or it owns launch-day tasks. */
  const e = E(); const diffs = {};
  projectProcesses(prj).forEach(p => { try { diffs[p.id] = p.tobe && p.tobe.length && e && e.diffProcess ? e.diffProcess(p) : { nodes: {} }; } catch (err) { diffs[p.id] = { nodes: {} }; } });
  /* same rule as the engine's sections: a trigger counts as changed when its title, owner or teams involved differ from Today's */
  const tch = n => JSON.stringify((n.touches || []).map(String).sort());
  const chg = x => {
    if (x.step.type === 'trigger') { const p = store.get('process', x.pid); const a = p && (p.asis || []).find(n => n && n.id === (x.step.from || x.step.id));
      return !a || a.type !== 'trigger' || (a.title || '') !== (x.step.title || '') || (a.owner || '') !== (x.step.owner || '') || tch(a) !== tch(x.step); }
    const st = ((diffs[x.pid] || {}).nodes || {})[x.step.id]; return st === 'new' || st === 'changed'; };
  const taskBus = new Set(tasksOf(prj.cutover).map(t => t.bu || (store.person(t.owner) || {}).bu).filter(Boolean).map(b => String(b).toLowerCase()));
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bu, steps]) => ({ bu, steps, changed: steps.filter(chg), tasks: taskBus.has(bu.toLowerCase()), fromTags: steps.every(x => x.via !== 'owner') }))
    .filter(sec => sec.changed.length || sec.tasks);
}

/* R8 approvals happen once: is this team's own evidence complete (its steps' work, its information, its tests)?
   Engine buReady first; the local fallback applies the same rule. -> {ready, waiting: [plain text]} */
function buReadyOf(prj, bu) {
  const r = eng('buReady', prj.id, bu, store.state.today);
  if (typeof r === 'boolean') return { ready: r, waiting: [] };
  if (r && typeof r === 'object') {
    const ready = [r.ready, r.done, r.pass, r.ok].find(v => typeof v === 'boolean');
    const raw = r.waiting || r.waitingOn || r.missing || r.reasons || r.items || r.left || [];
    const waiting = (Array.isArray(raw) ? raw : [raw]).map(x => typeof x === 'string' ? x : x && (x.text || x.label || x.title || x.what) || '').filter(Boolean);
    if (typeof ready === 'boolean') return { ready, waiting: ready ? [] : waiting.length ? waiting : [r.sentence || r.text || 'the rest of this part'].filter(Boolean) };
  }
  const sec = buSections(prj).find(x => x.bu.toLowerCase() === String(bu).toLowerCase());
  if (!sec) return { ready: true, waiting: [] };
  const keys = new Set(sec.steps.map(x => x.pid + '|' + x.step.id));
  const work = store.list('workItem', w => w.projectId === prj.id && w.kind !== 'defect' && keys.has(w.pid + '|' + w.step) && w.status !== 'done');
  const dataIds = new Set(); sec.changed.forEach(x => stepDataIds(x.step).forEach(d => dataIds.add(d)));
  const notLive = [...dataIds].filter(id => effAvail(id) !== 'live').map(id => (store.get('dataElement', id) || {}).name).filter(Boolean);
  const testIds = new Set(store.list('testCase', c => dataIds.has(c.dataId)).map(c => c.id)); sectionScripts(prj, new Set(sec.changed.map(x => x.pid + '|' + x.step.id))).forEach(x => testIds.add(x.id));
  const outs = latestOutcomes(prj.id, ['uat']); const notPassed = [...testIds].filter(id => !outs[id] || outs[id].outcome !== 'pass').length;
  const waiting = [];
  if (work.length) waiting.push(`${work.length} task${work.length === 1 ? '' : 's'} to finish (${work.slice(0, 2).map(w => w.title).join(', ')}${work.length > 2 ? '…' : ''})`);
  if (notLive.length) waiting.push(`${notLive.slice(0, 3).join(', ')} to be available`);
  if (notPassed) waiting.push(`${notPassed} business check${notPassed === 1 ? '' : 's'} to pass`);
  return { ready: !waiting.length, waiting };
}
const stepDataIds = st => { const out = new Set(st.data || []); (st.subs || []).forEach(sb => (sb.data || []).forEach(d => out.add(d))); return [...out]; };
const joinAnd = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || '';
/* R8 prefilled "What you checked": built from facts ("3 changed steps reviewed; 12 of 12 tests passed"), never boilerplate. */
function noteFactsOf(prj, bu, sec) {
  const r = eng('approvalNoteFacts', prj.id, bu, store.state.today);
  if (typeof r === 'string' && r.trim()) return r.trim();
  if (r && typeof r === 'object') {
    const t = r.text || r.note || r.sentence; if (typeof t === 'string' && t.trim()) return t.trim();
    const facts = Array.isArray(r) ? r : r.facts; if (Array.isArray(facts) && facts.length) return facts.map(x => typeof x === 'string' ? x : x.text || x.label || '').filter(Boolean).join('; ') + '.';
  }
  sec = sec || buSections(prj).find(x => x.bu.toLowerCase() === String(bu).toLowerCase());
  if (!sec) return '';
  const facts = [`${sec.changed.length} changed step${sec.changed.length === 1 ? '' : 's'} reviewed`];
  const dataIds = new Set(); sec.changed.forEach(x => stepDataIds(x.step).forEach(d => dataIds.add(d)));
  if (dataIds.size) { const live = [...dataIds].filter(id => effAvail(id) === 'live').length; facts.push(`${live} of ${dataIds.size} piece${dataIds.size === 1 ? '' : 's'} of information available`); }
  const testIds = new Set(store.list('testCase', c => dataIds.has(c.dataId)).map(c => c.id)); sectionScripts(prj, new Set(sec.changed.map(x => x.pid + '|' + x.step.id))).forEach(x => testIds.add(x.id));
  if (testIds.size) { const outs = latestOutcomes(prj.id, ['uat']); facts.push(`${[...testIds].filter(id => outs[id] && outs[id].outcome === 'pass').length} of ${testIds.size} tests passed`); }
  if (sec.tasks) facts.push('my launch-day tasks checked');
  return facts.join('; ') + '.';
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
  if (m[1] === 'section') { const k = (/#(\w)$/.exec(m[2]) || [])[1]; return { text: { s: 'its steps changed', d: 'its information changed', t: 'its tests changed', c: 'the launch-day plan changed' }[k] || 'this part changed', extra: '', href: k === 't' ? `/testing/${prjId}` : null }; }
  if (m[1] === 'project' || m[1] === 'cutover') return cutoverStaleView(store.get('project', m[1] === 'project' ? m[2].replace(/#.*$/, '') : prjId) || store.get('project', prjId));
  return { text: ref, extra: '', href: null };
}
/* R5: editing the cutover plan after an approval makes every approval stale. */
function cutoverStaleView(prj) { return { text: 'Launch-day plan edited', extra: `by ${pname(prj && prj.owner)}${prj && prj.cutoverUpdatedAt ? ' · ' + fmtTime(prj.cutoverUpdatedAt) : ''}`, href: null, anchor: 'cutover', cutover: true }; }
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
const GRANT_TXT = { requested: 'waiting for approval', approved: 'approved', active: 'open', expired: 'closed', revoked: 'closed early', denied: 'declined' };
/* R7 plain names for the test environments; the professional term stays in a tooltip. */
export const ENV_PLAIN = { dev: 'Build testing', sit: 'System testing', uat: 'Business testing', 'prod-verify': 'Check after launch' };
const envPlain = e => ENV_PLAIN[e] || String(e || '').toUpperCase();

/* Readiness items arrive as strings or small objects; render a label and a link where we can infer one. */
const CO_LABEL = { tasks: 'No launch-day steps yet', runbook: 'No launch-day steps yet', rollbackOwner: 'Nobody named to undo the launch if needed', rollbackPlan: 'Undo plan not written', hypercareOwner: 'Nobody named for support after launch' };
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
    if (checkId === 'tests-passed' && !store.get('workItem', s) && !store.get('testCase', s)) { const prj = store.get('project', prjId) || {}; const e = E(); let sc = (prj.uatScripts || []).find(x => x.id === s); if (!sc && e && e.generateUatScripts) { try { sc = e.generateUatScripts(store.state.docs, prjId).find(x => x.id === s); } catch (err) { sc = null; } } if (sc) return { text: sc.title, extra: 'Business check', href: `/testing/${prjId}` }; }
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
  const extra = st === 'pending' ? `Waiting for ${pname(de.owner)} to confirm it's connected` : st === 'live' && ev && ev.type === 'attested' ? 'Connected, but proven only by a link and a note: weaker than checking sample data or a connection check' : AVAIL_TXT[st] || st;
  return { text: de.name, extra, href: '/data/' + dataId, state: st === 'live' && ev && ev.type === 'attested' ? 'attested' : st, cta: st === 'pending' ? `Open the information page: ${pname(de.owner)} confirms it there ›` : null };
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
  return rows ? `<div class="rl-ev" data-evidence-list><div class="rl-ev-h"><b>Proof it is connected</b><span class="hint">Checked sample data that matches the rules, or a passing connection check, proves the source. A link and a note from the owner is accepted, but shown as a warning.</span></div><ul>${rows}</ul></div>` : '';
}

/* ---------- render ---------- */
export function render(params) {
  const prjId = params.prj;
  const projects = store.list('project');
  const prj = store.get('project', prjId);
  if (!prj) {
    return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> · Launch</div><h1>Launch</h1>
      <p>Project not found. Pick a project to see what it needs before launch.</p></div></section>
      <div class="home-grid">${projects.map(p => `<a class="tile" href="${link('/release/' + p.id)}" data-link><h4>${esc(p.name)}</h4><p>${esc(p.desc || '')}</p></a>`).join('') || '<div class="empty">No projects yet.</div>'}</div>`;
  }
  const rd = readiness(prjId);
  if (params.q && params.q.bu) return store.advanced ? buView(prj, params.q.bu, rd) : simpleBuView(prj, params.q.bu, rd);
  if (!store.advanced) return simpleRender(prj, rd, params);
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
  const sLeft = stepsLeftOf(prj, truthSteps(prj));
  const gateTitle = live ? 'Launched' : rd.pass ? (relFailed ? 'Ready: the last launch failed, try again when ready' : 'Ready to launch') : `Not ready to launch: ${sLeft} step${sLeft === 1 ? '' : 's'} left`;
  const gateSub = live ? `Live since ${fmt(lastGo && lastGo.at)}. Temporary data access closed at launch.`
    : rd.unavailable ? 'Readiness engine is still loading.'
    : rd.pass ? (warns ? `Everything required is done. ${warns} warning to review.` : 'Everything required is done. The launch owner can launch.')
    : 'Launch unlocks when every check below is done.';

  const header = `<section class="hdr rl-hdr"><div>
      <div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> · <a href="${link('/project/' + prjId)}" data-link>${esc(prj.name)}</a> · Launch</div>
      <div class="rl-title"><h1>Launch readiness</h1>
        <select class="rl-switch" data-switch aria-label="Project">${projects.map(p => `<option value="${esc(p.id)}" ${p.id === prjId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <p>What must be true before <b>${esc(prj.name)}</b> launches, who has approved, and which temporary data access is still open.</p>
      ${rmLine(prj)}
      ${mySection ? `<a class="btn sm primary rl-mysec" href="${link(`/release/${prjId}?bu=${encodeURIComponent(mySection)}`)}" data-link data-review-mine="${esc(mySection)}">Review my part · ${esc(mySection)}</a>` : ''}
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
    ${ui.reasons ? `<div class="banner rl-reasons" data-reasons><b>The launch was refused by the server.</b><ul>${ui.reasons.map(r => `<li>${esc(typeof r === 'string' ? r : (r.label || r.detail || JSON.stringify(r)))}</li>`).join('')}</ul></div>` : ''}
    ${failedRel ? failBanner(prj, failedRel) : ''}
    ${live && releases[0] && isFailedRb(releases[0]) ? rbFailBanner(prj, releases[0]) : ''}
    ${live ? releasedCard(prj, rd, lastGo) + hypercareCard(prj, lastGo) : `<div class="card"><h3>What has to be true before launch<span class="n" data-counts>${esc(countsText(cnt))}</span></h3>${checks}</div>`}
    ${cutoverCard(prj)}
    ${signoffCard(prj, rd)}
    ${grantsCard(prj)}
  </div>
  <aside class="side">
    ${goLiveCard(prj, rd, live)}
    ${releaseCards(prj, releases)}
    <div class="card rl-explain"><h3>How temporary data access works</h3>
      <p><b>Access covers one piece of information, closes at launch, and every action is logged.</b></p>
      <ul><li>The information's owner approves each request with an extra sign-in check. Nobody approves their own request; if the owner asked, the project manager decides.</li><li>Access is for build testing or business testing only, for the number of days asked for (30 at most), counted from approval.</li><li>Customer data and keys stay in the customer's own systems.</li></ul></div>
    <div class="card"><h3>Comments</h3>${commentsPanel('project:' + prjId)}</div>
    <div class="card"><h3>History</h3><div data-rl-history><div class="hint">Loading history…</div></div></div>
  </aside></div>`;
}

/* Why the current persona can't sign this BU's section (html hint), or '' when they can. */
function signoffWhy(prj, bu, open) {
  const meId = store.state.me; const me = store.person(meId) || {};
  const rm = rmOf(prj); const isOwner = meId === prj.owner, isRm = meId === rm;
  const names = store.state.people.filter(p => p.bu === bu && p.id !== prj.owner && p.id !== rm).map(p => p.name).join(', ');
  const elig = eligibleFor(prj, bu);
  const names2 = elig.map(pname).join(', ');
  const who = names2 ? `${esc(names2)} can approve the ${esc(bu)} part.` : '';
  if (isOwner && isRm) return `<span class="hint" data-why="owner">Project managers can't approve their own project, and the launch owner can't approve a team's part. ${who}</span>`;
  if (isOwner) return `<span class="hint" data-why="owner">Project managers can't approve their own project. ${who}</span>`;
  if (isRm) return `<span class="hint" data-why="rm">As launch owner, ${esc(pname(rm))} can't approve a team's part (separation of duties). ${who}</span>`;
  if (!elig.includes(meId)) return `<span class="hint" data-why="bu">${names2 ? `To try it, switch “Viewing as” to ${esc(names2)}.` : `Nobody can approve the ${esc(bu)} part yet.`}</span>`;
  return '';
}

/* R9: only teams that need to approve (projectTruth.approvals) are sections; never a gate condition otherwise. */
function neededSections(prj) {
  const secs = buSections(prj); const appr = approvalsTruth(prj);
  if (!appr) return secs;
  return appr.filter(a => a.needed !== false).map(a => secs.find(s => s.bu.toLowerCase() === String(a.bu).toLowerCase()) || { bu: a.bu, steps: [], changed: [], tasks: false, fromTags: false });
}
function signoffCard(prj, rd) {
  const meId = store.state.me;
  const sections = prj.status === 'live' ? buSections(prj) : neededSections(prj);
  const live = prj.status === 'live';
  const isOwner = meId === prj.owner;
  const rm = rmOf(prj); const isRm = meId === rm;
  const staleBy = {}; sections.forEach(s => { staleBy[s.bu] = live ? [] : staleChanges(prj, s, latestApproval(prj.id, s.bu), rd); });
  const approved = sections.map(s => latestApproval(prj.id, s.bu)).filter(a => counts(prj, a) && !(staleBy[a.bu] || []).length);
  const approvers = [...new Set(approved.map(a => a.approver))];
  const exc = (rd.checks.find(c => c.id === 'exceptions') || {}).items || [];
  const cards = sections.map(s => {
    const a = latestApproval(prj.id, s.bu);
    const eligible = eligibleFor(prj, s.bu);
    const mine = eligible.includes(meId);
    const nobody = !eligible.length;
    const stale = staleBy[s.bu] || [];
    const byOwner = a && a.decision === 'approved' && a.approver === prj.owner;
    const byRm = a && a.decision === 'approved' && !byOwner && a.approver === rm;
    const state = !a ? 'pending' : byOwner ? 'owner' : byRm ? 'rm' : (a.decision === 'approved' && stale.length ? 'stale' : a.decision);
    const stCls = state === 'approved' ? 'b-done' : state === 'rejected' || state === 'stale' ? 'b-late' : 'b-soon';
    const stTxt = { pending: nobody ? 'Nobody can approve yet' : 'Waiting for approval', approved: 'Approved', rejected: 'Changes asked for', stale: 'Changed: approve again', owner: 'Needs an independent approver', rm: 'Needs an independent approver' }[state];
    const tagged = s.steps.filter(x => x.via !== 'owner');
    let act = '';
    if (!live && nobody) {
      act = `<div class="rl-noappr" data-no-approver="${esc(s.bu)}"><b>Nobody can approve the ${esc(s.bu)} part yet.</b><span class="hint">A step or what starts the process involves ${esc(s.bu)}, but nobody who can approve belongs to ${esc(s.bu)}.</span>${choosePicker(prj, s.bu)}</div>`;
    } else if (!live && state !== 'approved') {
      /* a signed, current section needs no action: no stale "Switch 'Viewing as'" hint after sign-off */
      const label = a && a.decision === 'approved' && !byOwner && !byRm ? 'Approve again' : 'Approve this part';
      const why = signoffWhy(prj, s.bu, true);
      act = `<div class="rl-bu-act">${why ? `<button class="btn sm" disabled data-locked>${label}</button>${why}`
        : `<button class="btn sm primary" data-signoff="approved" data-bu="${esc(s.bu)}">${label}</button><button class="btn sm danger" data-signoff="rejected" data-bu="${esc(s.bu)}">Ask for changes</button>`}</div>`;
    } else if (!live && mine && !isOwner && !isRm) {
      act = `<div class="rl-bu-act"><button class="btn sm danger" data-signoff="rejected" data-bu="${esc(s.bu)}">Withdraw and ask for changes</button></div>`;
    }
    const apT = !live && (approvalsTruth(prj) || []).find(x => String(x.bu).toLowerCase() === s.bu.toLowerCase());
    if (apT && apT.blockedBy && apT.blockedBy.rule !== 'no-approver' && state !== 'approved') act = sodBlock(prj, { bu: s.bu, blockedBy: apT.blockedBy });
    const chosen = (prj.approvers || {})[s.bu];
    const viaTxt = x => x.via === 'trigger' ? 'what starts it involves' : 'teams involved';
    return `<div class="rl-bu ${state}" data-bu="${esc(s.bu)}" ${s.fromTags ? 'data-from-tags' : ''}>
      <div class="rl-bu-h"><b>${esc(s.bu)}</b>${badge(stTxt, stCls)}<a class="rl-go rl-bu-rev" href="${link(`/release/${prj.id}?bu=${encodeURIComponent(s.bu)}`)}" data-link data-bu-review="${esc(s.bu)}">Review this part ›</a></div>
      ${chosen && store.person(chosen) ? `<div class="hint" data-chosen-approver="${esc(chosen)}">Approver chosen for this part: ${av(chosen)} ${esc(pname(chosen))}</div>` : ''}
      ${tagged.length ? `<div class="rl-tagnote" data-tagnote>${s.fromTags ? 'Included because' : 'Also includes'} ${tagged.some(x => x.via === 'trigger') ? 'what starts the process or steps that list' : 'steps that list'} <span class="chip">${esc(s.bu)}</span> under <i>Teams involved</i>.</div>` : ''}
      ${stale.length ? `<div class="rl-stale" data-stale="${esc(s.bu)}"><b>Changed after approval: approve again</b><ul>${stale.map(v => `<li ${v.cutover ? 'data-stale-cutover' : ''}>${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : v.anchor ? `<a href="#${v.anchor}" data-anchor="${v.anchor}">${esc(v.text)}</a>` : esc(v.text)} <small>${esc(v.extra)}</small></li>`).join('')}</ul>${stale.some(v => v.cutover) ? '<div class="hint">A launch-day plan change affects what this team approved, so it needs approving again.</div>' : ''}</div>` : ''}
      <ol class="rl-steps">${s.steps.map(x => `<li ${x.via !== 'owner' ? `data-via-${x.via === 'trigger' ? 'trigger' : 'tag'}` : ''}><a href="${link(`/process/${x.pid}/step/${x.step.id}`)}" data-link>${x.via === 'trigger' ? 'What starts it: ' : ''}${esc(x.step.title)}</a> <small>${x.step.owner ? esc(pname(x.step.owner)) + ' · ' : ''}${esc(x.pname)}</small>${x.via !== 'owner' ? ` <span class="rl-viatag" title="In this part because of its Teams involved list">${viaTxt(x)}: ${esc(x.tag)}</span>` : ''}</li>`).join('')}</ol>
      ${a ? `<div class="rl-signed">${av(a.approver)} <span>${esc(pname(a.approver))} ${a.decision === 'approved' ? 'approved' : 'asked for changes'} · ${esc(fmtTime(a.at))}${a.stepUp ? ' · <span class="rl-mfa">extra sign-in check done</span>' : ''}</span></div>${byOwner ? `<div class="rl-ownerx" data-owner-excluded>Doesn't count: the project manager can't approve their own project.</div>` : ''}${byRm ? `<div class="rl-ownerx" data-rm-excluded>Doesn't count: the launch owner can't approve a team's part.</div>` : ''}${a.attestation || a.note ? `<div class="rl-attest" data-attestation>“${esc(a.attestation || a.note)}”</div>` : ''}` : ''}
      ${act}</div>`;
  }).join('');
  const two = approvers.length >= 2;
  return `<div class="card" id="signoff"><h3>Approvals<span class="n">${approved.length}/${sections.length} approved</span></h3>
    <div class="rl-two ${two ? 'ok' : ''}"><span class="rl-ic ${two ? 'pass' : 'fail'}">${two ? ICON.pass : ICON.fail}</span>
      <div><b>Two different people</b> · ${approvers.length} different approver${approvers.length === 1 ? '' : 's'} ${approvers.map(av).join('')}<div class="hint">Launch needs at least two different people to approve, each with the extra sign-in check. The project manager (${esc(pname(prj.owner))})${rm && rm !== prj.owner ? ` and the launch owner (${esc(pname(rm))})` : ''} can't be one of them. Each team can approve its part at any time.</div></div></div>
    ${exc.length && !Object.values(staleBy).some(x => x.length) ? `<div class="rl-exc"><b>Changes after approval</b> · approve the part again to clear them.</div>` : ''}
    <div class="rl-bus">${cards || '<div class="empty">No owned or listed steps in the future versions yet.</div>'}</div></div>`;
}

/* R7 deadlock fix: who may approve a team's part. Its members plus anyone chosen in project.approvers {bu: personId},
   never the project manager or the launch owner. */
export function eligibleFor(prj, bu) {
  const ex = new Set([prj.owner, rmOf(prj)].filter(Boolean));
  const low = String(bu || '').toLowerCase();
  const ids = store.state.people.filter(p => p.bu && String(p.bu).toLowerCase() === low && !ex.has(p.id)).map(p => p.id);
  const pick = Object.entries(prj.approvers || {}).find(([k]) => String(k).toLowerCase() === low);
  if (pick && pick[1] && !ex.has(pick[1]) && store.person(pick[1]) && !ids.includes(pick[1])) ids.unshift(pick[1]);
  return ids;
}
/* Default suggestion: if the only member is the PM, the owner of the first linked process. */
function suggestApprover(prj, bu) {
  const ex = new Set([prj.owner, rmOf(prj)].filter(Boolean));
  const procOwner = projectProcesses(prj).map(p => p.owner).find(o => o && !ex.has(o));
  return procOwner || (store.state.people.find(p => !ex.has(p.id)) || {}).id || '';
}
const canChoose = prj => store.state.me === prj.owner || store.state.me === rmOf(prj);
function choosePicker(prj, bu, opts) {
  opts = opts || {};
  const ex = new Set([prj.owner, rmOf(prj)].concat(opts.exclude || []).filter(Boolean));
  if (!canChoose(prj)) return `<div class="hint" data-choose-who>${esc(pname(prj.owner))} (project manager) chooses who approves this part.</div>`;
  const sug = ex.has(suggestApprover(prj, bu)) ? (store.state.people.find(p => !ex.has(p.id) && p.bu === bu) || store.state.people.find(p => !ex.has(p.id)) || {}).id : suggestApprover(prj, bu);
  return `<div class="rs-choose" data-choose="${esc(bu)}"><label for="rs-ch-${esc(bu)}">${esc(opts.label || 'Choose who approves this part')}</label>
    <div class="rs-choose-r"><select id="rs-ch-${esc(bu)}" data-choose-sel="${esc(bu)}">${store.state.people.filter(p => !ex.has(p.id)).map(p => `<option value="${esc(p.id)}" ${p.id === sug ? 'selected' : ''}>${esc(p.name)} · ${esc(p.role)}</option>`).join('')}</select>
    <button class="btn primary" data-choose-save="${esc(bu)}">Choose</button></div></div>`;
}
/* R9 §13: a separation-of-duties block is never a silent dead end: say it plainly, with a person picker. */
function sodBlock(prj, p) {
  const b = p.blockedBy; if (!b) return '';
  const who = typeof b === 'object' ? (b.person || b.by || b.recordedBy) : null;
  return `<div class="rs-sod" data-sod-block="${esc(p.bu)}" role="note"><b>${esc(blockText(b, p.bu))}</b>${choosePicker(prj, p.bu, { exclude: [who], label: 'Choose who:' })}</div>`;
}
async function chooseApprover(prj, bu, pid) {
  const cur = store.get('project', prj.id) || prj;
  if (!canChoose(cur)) { toast(`Only ${pname(cur.owner)} (project manager) can choose who approves.`); return; }
  if (!pid || pid === cur.owner || pid === rmOf(cur)) { toast("Pick someone other than the project manager or the launch owner."); return; }
  await store.save('project', prj.id, Object.assign({}, cur, { approvers: Object.assign({}, cur.approvers || {}, { [bu]: pid }) }), `Chose ${pname(pid)} to approve the ${bu} part of ${cur.name}`);
  await store.notify([pid], `${pname(store.state.me)} chose you to approve the ${bu} part of ${cur.name}`, 'project:' + prj.id);
  toast(`${pname(pid)} can now approve the ${bu} part`);
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
  if (!tasksOf(c).some(t => String(t.task || '').trim())) need.push('at least one launch-day step');
  if (!c.rollbackOwner) need.push('who undoes the launch if needed');
  if (!String(c.rollbackPlan || '').trim()) need.push('an undo plan');
  if (!c.hypercareOwner) need.push('who handles support after launch');
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
  if (!tasks.length) return '<div class="hint" data-runbook-empty>No launch-day steps yet. Add the steps, in order, that people follow on launch day.</div>';
  const done = tasks.filter(t => t.done).length;
  const late = opts.readonly ? [] : tasks.filter(overdue);
  return `<div class="rl-rb-h"><b>${opts.checklist ? 'Launch-day checklist' : 'Launch-day steps'}</b><span class="hint" data-runbook-progress>${done}/${tasks.length} done · ${tasks.filter(t => t.gonogo).length} ${GNG()}</span></div>
    <div class="rl-rbar"><i style="width:${Math.round(100 * done / tasks.length)}%"></i></div>
    ${late.length ? `<div class="rl-overdue-w" data-runbook-overdue="${late.length}"><span class="rl-ic warn">!</span> ${late.length} launch-day step${late.length === 1 ? ' is' : 's are'} overdue: ${late.map(t => `${esc(t.task)} (${t.owner ? esc(pname(t.owner)) : 'no owner'})`).join(' · ')}</div>` : ''}
    <ol class="rl-runbook ${opts.checklist ? 'check' : ''}" data-runbook>${tasks.map((t, i) => {
      const tick = canTick(prj, t) && !opts.readonly;
      const od = !opts.readonly && overdue(t);
      return `<li class="${t.done ? 'done' : ''} ${t.gonogo ? 'gng' : ''} ${od ? 'od' : ''}" data-rbtask="${esc(t.id)}" ${od ? 'data-overdue' : ''}><span class="rl-rbn">${i + 1}</span>
        <label class="rl-rbchk"><input type="checkbox" data-rb-done="${esc(t.id)}" ${t.done ? 'checked' : ''} ${tick ? '' : 'disabled'} aria-label="Done: ${esc(t.task)}"></label>
        <div class="rl-rbt"><div><b data-user-text>${esc(t.task)}</b>${t.gonogo ? ` <span class="rl-gng">${GNG()}</span>` : ''}${od ? ' <span class="badge b-late">Overdue</span>' : ''}</div>
          <small><span class="rl-rbown" data-rb-owner="${esc(t.owner || '')}">${t.owner ? `${av(t.owner)} ${esc(pname(t.owner))}` : '<b class="rl-noown">No owner</b>'}</span> · ${esc(fmtPlanned(startOf(t)))}${t.durationMins ? ` · ${esc(fmtDur(t.durationMins))}` : ''}${t.done && t.doneBy ? ` · ${t.gonogo ? 'confirmed' : 'done'} by ${esc(pname(t.doneBy))} ${esc(fmtTime(t.doneAt))}` : ''}</small>
          ${t.gonogo && !t.done && !opts.readonly ? `<small class="rl-gngwho" data-gng-who>${t.owner ? `Only ${esc(pname(t.owner))} can confirm this final check.` : 'Needs an owner before launch.'}</small>` : ''}</div></li>`;
    }).join('')}</ol>`;
}
function cutoverCard(prj) {
  const c = prj.cutover || {};
  const canEdit = store.state.me === prj.owner;
  const live = prj.status === 'live';
  const need = cutoverNeeds(prj.cutover);
  const row = (label, html, key) => `<div class="rl-co-r" data-co="${key}"><span class="lbl">${esc(label)}</span><div>${html || '<span class="hint">Not set</span>'}</div></div>`;
  return `<div class="card" id="cutover"><h3>Launch-day plan<span class="n">${need.length ? 'incomplete' : 'complete'}</span></h3>
    <div class="rl-co-st ${need.length ? 'fail' : 'pass'}"><span class="rl-ic ${need.length ? 'fail' : 'pass'}">${need.length ? ICON.fail : ICON.pass}</span>
      <span>${need.length ? `Needed before launch: add ${esc(need.join(', '))}.` : 'Ready: the launch-day steps are in order, and someone owns the undo plan and support after launch.'}</span></div>
    ${!prj.cutover ? '<div class="empty rl-co-empty">No launch-day plan yet. List the launch-day steps in order, name who undoes the launch if needed, write the undo plan and name who handles support after launch.</div>' : `
      ${runbookTable(prj, { checklist: live })}
      <div class="rl-co">
      ${row('Launch window', esc(fmtWindow(c)), 'window')}
      ${row('Who undoes it if needed', c.rollbackOwner ? `${av(c.rollbackOwner)} ${esc(pname(c.rollbackOwner))}` : '', 'rollbackOwner')}
      ${row('Undo plan', c.rollbackPlan ? `<span class="rl-pre-line">${esc(c.rollbackPlan)}</span>` : '', 'rollbackPlan')}
      ${row('Support after launch', c.hypercareOwner || c.hypercareDays ? `${c.hypercareDays ? esc(c.hypercareDays) + ' days' : ''}${c.hypercareOwner ? ` · ${av(c.hypercareOwner)} ${esc(pname(c.hypercareOwner))}` : ''}` : '', 'hypercare')}
      ${row('Who is told what', c.comms ? `<span class="rl-pre-line">${esc(c.comms)}</span>` : '', 'comms')}
    </div>`}
    <div class="rl-bu-act">${canEdit ? `<button class="btn sm primary" data-cutover-edit>${prj.cutover ? 'Edit launch-day plan' : 'Add launch-day plan'}</button>`
      : `<span class="hint" data-why>Only the project manager (${esc(pname(prj.owner))}) can edit the launch-day plan. People tick their own steps; final checks are confirmed by their owner only.</span>`}</div></div>`;
}

async function tickTask(prj, tid, done) {
  const cur = store.get('project', prj.id) || prj;
  const tasks = tasksOf(cur.cutover); const t = tasks.find(x => x.id === tid); if (!t) return;
  if (!canTick(cur, t)) { toast(t.gonogo ? `Only ${pname(t.owner)} can confirm this final check.` : `Only ${pname(t.owner)} or the project manager can tick this step.`); store.emit(); return; }
  const next = tasks.map(x => x.id === tid ? Object.assign({}, x, done ? { done: true, doneAt: new Date().toISOString(), doneBy: store.state.me } : { done: false, doneAt: undefined, doneBy: undefined }) : x);
  await store.save('project', prj.id, Object.assign({}, cur, { cutover: Object.assign({}, cur.cutover, { tasks: next }) }), `${done ? 'Completed' : 'Reopened'} launch-day step “${t.task}”`);
  toast(done ? 'Step done' : 'Step reopened');
}

async function editCutover(prj) {
  if (store.state.me !== prj.owner) { toast(`Only the project manager (${pname(prj.owner)}) can edit the launch-day plan.`); return; }
  const c = prj.cutover || {};
  const ppl = store.state.people;
  const sel = (name, v, extra) => `<select name="${name}" ${extra || ''}><option value="">Choose a person</option>${ppl.map(p => `<option value="${esc(p.id)}" ${p.id === v ? 'selected' : ''}>${esc(p.name)} · ${esc(p.role)}</option>`).join('')}</select>`;
  const trow = t => `<div class="rl-trow" data-trow data-tid="${esc(t.id || '')}" data-done="${t.done ? '1' : ''}"><span class="rl-rbn" data-tn></span>
    <input data-tt value="${esc(t.task || '')}" placeholder="Step, e.g. Pause the payment run" aria-label="Step">
    <select data-to aria-label="Who does it"><option value="">Who does it</option>${ppl.map(p => `<option value="${esc(p.id)}" ${p.id === t.owner ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <input type="datetime-local" data-tp value="${esc(startOf(t))}" aria-label="Planned start">
    <input type="number" data-td min="0" max="1440" step="5" value="${esc(t.durationMins == null ? '' : t.durationMins)}" placeholder="Mins" aria-label="Duration in minutes">
    <label class="rl-tg" title="Go/no-go: a checkpoint where the owner confirms it is safe to continue"><input type="checkbox" data-tg ${t.gonogo ? 'checked' : ''}> Final check</label>
    <span class="rl-tctl"><button type="button" class="btn sm" data-tup aria-label="Move step up">↑</button><button type="button" class="btn sm" data-tdn aria-label="Move step down">↓</button><button type="button" class="btn sm danger" data-trm aria-label="Remove step">✕</button></span></div>`;
  const tasks = tasksOf(c);
  /* R9: the launch window is a business day with a start and end time; the default runbook step is prefilled */
  const pw = parseWindow(c) || {};
  const wDate = pw.date || (E() && E().addBusinessDays ? E().addBusinessDays(store.state.today, 5) : '');
  const wFrom = pw.from || '08:00', wTo = pw.to || '10:00';
  const dflt = { task: 'Switch on the new way of working and check the first request goes through', owner: rmOf(prj) || prj.owner || '', plannedStart: wDate ? `${wDate}T${wFrom.padStart(5, '0')}` : '', durationMins: 30 };
  const p = modal({
    title: 'Launch-day plan',
    body: `<div class="field"><label>Launch window</label><div class="rl-wrow" data-window-row><input type="date" name="windowDate" value="${esc(wDate)}" aria-label="Launch day"><input type="time" name="windowStart" value="${esc(wFrom)}" aria-label="Starts at"><span aria-hidden="true">to</span><input type="time" name="windowEnd" value="${esc(wTo)}" aria-label="Ends at"></div>
        <input name="windowNote" value="${esc(pw.note || '')}" placeholder="Note, e.g. after quarter close" aria-label="Launch window note" class="rl-wnote"></div>
      <div class="field"><label>Launch-day steps, in order: who does it, start time, minutes, and any ${GNG()}</label><div class="rl-trows" data-trows>${(tasks.length ? tasks : [dflt]).map(trow).join('')}</div>
        <div><button type="button" class="btn sm" data-tadd>+ Add step</button></div></div>
      <div class="field"><label>Who undoes the launch if needed</label>${sel('rollbackOwner', c.rollbackOwner || prj.owner)}</div>
      <div class="field"><label>Undo plan</label><textarea name="rollbackPlan" placeholder="When to undo, the steps, and who decides">${esc(c.rollbackPlan || '')}</textarea></div>
      <div class="frow"><div class="field"><label>Days of support after launch</label><input type="number" min="0" max="90" name="hypercareDays" value="${esc(c.hypercareDays == null ? 10 : c.hypercareDays)}"></div>
        <div class="field"><label>Who handles support after launch</label>${sel('hypercareOwner', c.hypercareOwner)}</div></div>
      <div class="field"><label>Who is told what</label><textarea name="comms" placeholder="Who is told what, and when">${esc(c.comms || '')}</textarea></div>
      <div class="hint">Before launch the plan needs at least one step, someone who can undo the launch and an undo plan, and someone for support after launch. Every final check needs an owner, who confirms it before launch. Changing the plan after approval sends the affected parts back for approval.</div>`,
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
    if (badD) { badD.querySelector('[data-td]').setAttribute('aria-invalid', 'true'); return 'Minutes must be a whole number.'; }
    if (bad) return 'A step has a person or a time but no description. Describe it or remove the row.';
    const gng = rows.find(r => r.querySelector('[data-tt]').value.trim() && r.querySelector('[data-tg]').checked && !r.querySelector('[data-to]').value);
    if (gng) { gng.querySelector('[data-to]').setAttribute('aria-invalid', 'true'); return `“${gng.querySelector('[data-tt]').value.trim()}” is a final check, so it needs an owner: only that owner can confirm it before launch.`; }
    if (f.windowDate) { const wd = new Date(f.windowDate + 'T12:00:00Z').getUTCDay(); if (wd === 0 || wd === 6) return { msg: 'Pick a business day (Monday to Friday) for the launch window.', field: 'windowDate' }; }
    if (f.windowStart && f.windowEnd && f.windowEnd <= f.windowStart) return { msg: 'The launch window must end after it starts.', field: 'windowEnd' };
    const hd = String(f.hypercareDays || '').trim();
    if (hd && (!/^\d+$/.test(hd) || +hd > 90)) return { msg: 'Days of support must be a whole number from 0 to 90.', field: 'hypercareDays' };
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
  const wNote = (f.windowNote || '').trim();
  const window = f.windowDate ? `${f.windowDate}${f.windowStart ? ' ' + f.windowStart + (f.windowEnd ? '–' + f.windowEnd : '') : ''}${wNote ? ' (' + wNote + ')' : ''}` : '';
  const cutover = { window, windowDate: f.windowDate || '', windowStart: f.windowStart || '', windowEnd: f.windowEnd || '', windowNote: wNote, rollbackOwner: f.rollbackOwner || '', rollbackPlan: (f.rollbackPlan || '').trim(), hypercareDays: days, hypercareOwner: f.hypercareOwner || '', comms: (f.comms || '').trim(), tasks: newTasks };
  const cur = store.get('project', prj.id) || prj;
  /* R5: a cutover edit after sign-off makes every approval stale (project.cutoverUpdatedAt) */
  await store.save('project', prj.id, Object.assign({}, cur, { cutover, cutoverUpdatedAt: new Date().toISOString() }), `Updated the launch-day plan for ${prj.name} (${newTasks.length} step${newTasks.length === 1 ? '' : 's'})`);
  await store.notify([cutover.rollbackOwner, cutover.hypercareOwner, ...newTasks.map(t => t.owner)], `${pname(store.state.me)} named you in the launch-day plan for ${prj.name}`, 'project:' + prj.id);
  toast('Launch-day plan saved');
}

/* Separation of duties: the data owner approves; if the owner asked for the access, the project owner approves.
   The requester never approves their own request. */
function grantApprover(g, de, prj) {
  const a = g.requestedBy === de.owner ? prj.owner : de.owner;
  return a && a !== g.requestedBy ? a : null;
}

/* R6: the time box starts at approval. Requested grants carry a duration; approval sets the expiry. */
const grantDays = g => Math.max(1, Math.min(30, Number(g.durationDays) || 30));
/* R9: the card shows the duration that was asked for ("7 days"), never a maximum. */
const askedDays = g => { const n = Number(g.durationDays) || (g.expires && g.approvedAt ? Math.round((new Date(g.expires) - new Date(String(g.approvedAt).slice(0, 10))) / 864e5) : 0); return n > 0 ? `${n} day${n === 1 ? '' : 's'}` : ''; };
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
      : `<span class="hint" data-awaiting>${approver ? `Waiting for ${esc(pname(approver))}${approver !== de.owner ? ' (project manager: the owner asked for it)' : ''}` : 'Nobody else can approve: ask someone else to request it'}</span>`;
    if (canRevoke && st !== 'requested') acts += `<button class="btn sm danger" data-gact="revoke" data-gid="${esc(g.id)}">Remove access</button>`;
    if (canRevoke && st === 'requested' && !isApprover) acts += `<button class="btn sm" data-gact="revoke" data-gid="${esc(g.id)}">Withdraw</button>`;
    const left = g.expires ? days(g.expires) : null;
    const logOpen = ui.open.has('log:' + g.id);
    return `<tr data-grant="${esc(g.id)}"><td><a href="${link('/data/' + g.dataId)}" data-link class="rl-de">${esc(de.name)}</a><div class="hint">Owner ${esc(pname(de.owner))}</div></td>
      <td><span class="chip" title="${esc(String(g.env || '').toUpperCase())}">${esc(envPlain(g.env))}</span></td><td>${esc(g.access)}</td>
      <td>${av(g.requestedBy)} <span class="rl-nm">${esc(pname(g.requestedBy))}</span>${g.reason ? `<div class="hint rl-reason" data-user-text>${esc(g.reason)}</div>` : ''}</td>
      <td>${badge(GRANT_TXT[st] || st, GRANT_CLS[st] || 'b-idle')}</td>
      <td data-expiry>${st === 'requested' ? `<span data-from-approval data-asked="${esc(askedDays(g))}">${esc(askedDays(g) || grantDays(g) + ' days')} from approval</span>` : st === 'denied' ? '—' : `${esc(fmt(g.expires))}${askedDays(g) ? ` <small data-asked="${esc(askedDays(g))}">· ${esc(askedDays(g))}</small>` : ''}${left != null && (st === 'active' || st === 'approved') ? `<div class="hint">${left >= 0 ? left + ' days left' : 'past'}</div>` : ''}`}</td>
      <td class="rl-acts">${acts}<button class="btn sm rl-linkbtn" data-glog="${esc(g.id)}">${logOpen ? 'Hide history' : 'History'} (${(g.log || []).length})</button></td></tr>
      ${logOpen ? `<tr class="rl-logrow"><td colspan="7">${(g.log || []).map(l => `<div class="ev"><time>${esc(fmtTime(l.at))}</time><span>${av(l.by)} <b>${esc(store.person(l.by) ? pname(l.by) : l.by)}</b> ${esc(l.action)}</span></div>`).join('') || '<div class="hint">No entries.</div>'}</td></tr>` : ''}`;
  }).join('');
  const open = grants.filter(g => ['active', 'approved', 'requested'].includes(grantStatus(g))).length;
  return `<div class="card" id="grants"><h3>Temporary data access<span class="n">${open} open</span></h3>
    <div class="rl-gtools"><span class="hint">Short-term access to real information for build testing and business testing, for this project only. It closes automatically at launch.</span>
      <button class="btn sm primary" data-request ${prj.status === 'live' ? 'disabled' : ''}>Request access</button></div>
    ${grants.length ? `<div class="tbl-wrap"><table class="rl-gt"><thead><tr><th>Information</th><th>For</th><th>Access</th><th>Asked by</th><th>Status</th><th>Ends</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="empty">No temporary data access for this project yet.</div>'}</div>`;
}

function goLiveCard(prj, rd, live) {
  const procs = projectProcesses(prj);
  const rm = rmOf(prj); const isRm = store.state.me === rm;
  const open = gngOpen(prj);
  const guard = launchGuard(prj);
  const gateOk = rd.pass && !live && !open.length;
  const ready = gateOk && guard.ok;
  let why = '';
  if (!live && !isRm) why = `<div class="hint rl-why" data-why="rm">Only the launch owner (${esc(pname(rm))}) can launch. To try it, switch “Viewing as” to ${esc(pname(rm))}.</div>`;
  else if (!live && open.length) why = `<div class="hint rl-why" data-why="gonogo">Final checks not confirmed: ${open.map(t => `${esc(t.task)} (${t.owner ? esc(pname(t.owner)) + ' confirms' : 'needs an owner'})`).join(' · ')}.</div>`;
  return `<div class="card rl-golive ${ready ? 'ready' : ''}"><h3>Launch</h3>
    ${live ? `<p class="rl-p">This project is live. The future versions are now how the processes work today.</p>`
      : `<p class="rl-p">${rd.pass ? 'Everything is done. Launching runs the delivery pipeline first; only if it succeeds do the future versions become today’s, the procedure get published and temporary data access close.' : 'Locked until everything above is done.'}</p>`}
    <div class="rl-procs">${procs.map(p => `<div><a href="${link('/process/' + p.id)}" data-link>${esc(p.name)}</a><span class="chip">v${esc(p.version || 1)}${live ? '' : ` → v${esc((p.version || 1) + 1)}`}</span></div>`).join('')}</div>
    ${!live && gngOf(prj).length ? `<div class="rl-gngsum ${open.length ? 'fail' : 'pass'}" data-gng-summary><span class="rl-ic ${open.length ? 'fail' : 'pass'}">${open.length ? ICON.fail : ICON.pass}</span> Final checks: ${gngOf(prj).length - open.length} of ${gngOf(prj).length} confirmed by their owners</div>` : ''}
    ${!live && fmtWindow(prj.cutover) ? `<div class="rl-window" data-launch-window><span class="lbl">Launch window</span> <b>${esc(fmtWindow(prj.cutover))}</b></div>` : ''}
    <button class="btn primary rl-gobtn" data-golive ${ready && isRm ? '' : 'disabled'}>${live ? 'Launched' : 'Launch now'}</button>
    ${why}
    ${!live && gateOk && !guard.ok ? `<div class="hint rl-why" data-why="guard">Launch now is locked: ${esc(joinAnd(guard.why))}.</div>
      ${isRm ? '<button class="btn sm danger" data-override>Override with reason…</button>' : ''}` : ''}
    ${!rd.pass && !live ? `<div class="hint" style="margin-top:6px">${rd.checks.filter(c => checkState(c) === 'fail').map(c => esc(plainOf(c))).join(' · ')}</div>` : ''}
    ${live ? '<div class="hint" style="margin-top:6px">To undo the launch, use the launch summary.</div>' : ''}</div>`;
}

function releasedCard(prj, rd, rel) {
  const procs = projectProcesses(prj);
  const snap = (rel && rel.snapshot) || {};
  const vers = Object.values(snap).map(Number).filter(Boolean);
  const v = vers.length ? Math.max(...vers) : Math.max(...procs.map(p => p.version || 1), 1);
  const when = rd.releasedAt || (rel && rel.at);
  const n = countChecks(rd.checks);
  return `<div class="card rl-released" data-released><h3>Launch summary<span class="n" data-counts>${esc(countsText(n))}</span></h3>
    <div class="rl-rel-h"><span class="rl-gate-ic">★</span><div><b>Launched v${esc(v)} on ${esc(fmt(when))} by ${esc(pname(rel && rel.by))}</b>
      <span class="hint">${procs.map(p => `${esc(p.name)} v${esc(snap[p.id] || p.version || 1)}`).join(' · ')}. The checks below are as they stood at launch.</span></div></div>
    <ul class="rl-rel-checks">${rd.checks.map(c => { const st = checkState(c); return `<li class="${st}" data-check-at-release="${esc(c.id)}"><span class="rl-ic ${st}" aria-label="${st}">${ICON[st]}</span><span><b title="${esc(tipOf(c))}">${esc(plainOf(c))}</b> <small>${esc(c.detail || '')}</small></span></li>`; }).join('')}</ul>
    ${rollbackBlock(prj, procs)}</div>`;
}

/* R5: only the release manager rolls back (the server returns 403 otherwise). */
function canRollback(prj) { const me = store.state.me; return !!me && me === rmOf(prj); }
function rollbackBlock(prj, procs) {
  const prev = procs.filter(p => (p.version || 1) > 1);
  return `<div class="rl-rb"><div class="hint">${prev.length ? `Undoing the launch brings back ${prev.map(p => `${esc(p.name)} v${esc((p.version || 1) - 1)}`).join(', ')} as today’s process and re-publishes the previous procedure.` : 'No previous version to bring back.'}</div>
    ${canRollback(prj) ? `<button class="btn danger rl-gobtn" data-rollback ${prev.length ? '' : 'disabled'}>Undo the launch</button>`
      : `<div class="hint" data-why="rm">Only the launch owner (${esc(pname(rmOf(prj)))}) can undo the launch.</div>`}</div>`;
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
    <div class="rl-rec-h">${badge(rb ? (failed ? 'Undo failed' : 'Undo') : failed ? 'Launch failed' : 'Launch', rb || failed ? 'b-late' : 'b-done')} <b>${esc(fmtTime(r.at))}</b> · ${failed ? 'attempted' : rb ? 'undone' : 'launched'} by ${av(r.by)} ${esc(pname(r.by))}${r.stepUp ? ` · <span class="rl-mfa" data-stepup>extra sign-in check done</span>` : ''}</div>
    ${rb ? (r.reason || r.note ? `<div class="rl-rec-s"><span class="lbl">Reason</span>${esc(r.reason || r.note)}</div>` : '')
      : `<div class="rl-rec-s"><span class="lbl">Approvers</span>${(r.approvers || []).map(id => `${av(id)}<span class="rl-nm">${esc(pname(id))}</span>`).join(' ') || '—'}</div>`}
    ${failed && rb ? `<div class="rl-rec-s rl-noeffect" data-no-side-effects><span class="lbl">Side effects</span><b>Nothing was restored.</b> <span class="hint">The launched versions are still live, the procedure was not re-published, and only the launch owner was told.</span></div>`
      : failed ? `<div class="rl-rec-s rl-noeffect" data-no-side-effects><span class="lbl">Side effects</span><b>Nothing was promoted or published.</b> <span class="hint">No process version changed, the procedure was not published, temporary data access was left as it was, and only the launch owner was told.</span></div>`
      : `<div class="rl-rec-s"><span class="lbl">${rb ? 'Versions brought back' : 'Launched versions'}</span>${Object.keys(snap).map(pid => { const p = store.get('process', pid); return `<a class="chip" href="${link('/process/' + pid)}" data-link data-ver="${esc(pid)}">${esc(p ? p.name : pid)} · v${esc(snap[pid])}</a>`; }).join(' ') || '—'}</div>`}
    ${rb && !failed ? `<div class="rl-rec-s rl-undone" data-undone="${undone.length}"><span class="lbl">What the undo reversed</span>${undone.length ? `<ul>${undone.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="hint">Nothing to undo.</span>'}</div>` : ''}
    ${rb || failed ? '' : `<div class="rl-rec-s rl-rec-exc" data-exceptions="${exc.length}"><span class="lbl">Changed after an approval</span>${exc.length
      ? `<ul>${exc.map(x => { const v = exceptionView(x, r.projectId); return `<li>${v.href ? `<a href="${link(v.href)}" data-link>${esc(v.text)}</a>` : esc(v.text)}${v.extra ? ` <small>${esc(v.extra)}</small>` : ''}</li>`; }).join('')}</ul>`
      : '<span class="hint">None. Nothing changed after its team approved.</span>'}</div>`}
    <div class="rl-acts-list">${(r.actions || []).some(a => a.type === 'pipeline') ? '' : pipelineView(r, { type: 'pipeline', target: 'Customer CI/CD (simulated)' })}${(r.actions || []).filter(a => !failed || a.type === 'pipeline' || a.type === 'notify').map(a => actionView(a, r)).join('')}</div></div>`;
}

function releaseCards(prj, releases) {
  if (!releases.length) return `<div class="card"><h3>Launch history</h3><div class="hint">No launches yet. The launch record and its pipeline run appear here after launch.</div></div>`;
  const latest = releases[0];
  const fresh = ui.lastRelease === latest.id;
  const rbLatest = isRollback(latest);
  const lf = pipePhase(latest) === 'failed';
  const running = ui.pipe && ui.pipe.id === latest.id && ui.pipe.phase !== 'failed' && ui.pipe.phase !== 'succeeded';
  const statusBadge = r => pipePhase(r) === 'failed' ? badge('failed · no changes', 'b-late') : isRollback(r) ? badge('undone', 'b-late') : badge('launched', 'b-done');
  const sub = r => { const n = Object.keys(r.snapshot || {}).length; return pipePhase(r) === 'failed' ? (isRollback(r) ? 'pipeline failed · nothing restored' : 'pipeline failed · nothing promoted or published') : isRollback(r) ? `${n} process version${n === 1 ? '' : 's'} restored` : `${(r.actions || []).length} actions · ${(r.exceptions || []).length} exception${(r.exceptions || []).length === 1 ? '' : 's'}`; };
  const title = running ? (rbLatest ? 'Undo running' : 'Launch running') : lf ? (rbLatest ? 'Undo failed' : 'Launch failed') : fresh ? (rbLatest ? 'Undo complete' : 'Launch complete') : (rbLatest ? 'Latest undo' : 'Latest launch');
  return `<div class="card rl-latest ${fresh ? 'fresh' : ''} ${rbLatest || lf ? 'rb' : ''}"><h3>${title}</h3>${releaseRecord(latest)}</div>
    <div class="card"><h3>Launch history<span class="n">${releases.length}</span></h3>${releases.map(r => `<div class="row click" data-relrow="${esc(r.id)}" data-kind="${isRollback(r) ? 'rollback' : 'golive'}" ${pipePhase(r) === 'failed' ? 'data-failed' : ''}><div><div class="t">${isRollback(r) ? 'Undo' : 'Launch'} · ${esc(fmtTime(r.at))}</div><div class="s">${esc(pname(r.by))} · ${sub(r)}</div></div><div class="r">${statusBadge(r)}</div></div>${ui.showRel.has(r.id) && r.id !== latest.id ? releaseRecord(r) : ''}`).join('')}</div>`;
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
  const open = true; /* R7: no sign-off lock */
  const a = latestApproval(prj.id, s.bu);
  const stale = live ? [] : staleChanges(prj, s, a, rd);
  const signed = a && counts(prj, a) && !stale.length;
  const state = !a ? 'Awaiting sign-off' : signed ? 'Signed off' : a.decision === 'rejected' ? 'Rejected' : stale.length ? 'Re-approval needed' : 'Needs an independent approver';
  const keys = new Set(s.steps.map(x => x.pid + '|' + x.step.id));
  const e = E();
  const diffs = {}; [...new Set(s.steps.map(x => x.pid))].forEach(pid => { const p = store.get('process', pid); try { diffs[pid] = p && e && e.diffProcess ? e.diffProcess(p, store.state.docs) : { nodes: {}, changes: {} }; } catch (err) { diffs[pid] = { nodes: {}, changes: {} }; } });
  const work = store.list('workItem', w => w.projectId === prj.id && w.kind !== 'defect' && keys.has(w.pid + '|' + w.step));
  const DIFF_B = { new: 'b-prog', changed: 'b-soon', same: 'b-idle' };
  const nm = idNames();
  const steps = s.steps.map(x => {
    const d = diffs[x.pid] || { nodes: {}, changes: {} }; const st = d.nodes[x.step.id] || 'same'; const ch = (d.changes && d.changes[x.step.id]) || [];
    const ws = work.filter(w => w.pid === x.pid && w.step === x.step.id); const done = ws.filter(w => w.status === 'done').length;
    return `<li data-bu-step="${esc(x.step.id)}"><div class="rl-bv-t"><a href="${link(`/process/${x.pid}/step/${x.step.id}`)}" data-link>${x.via === 'trigger' ? 'Trigger: ' : ''}${esc(x.step.title)}</a>
        ${badge(st === 'same' ? 'unchanged' : st, DIFF_B[st] || 'b-idle')}${ws.length ? badge(`${done}/${ws.length} work done`, done === ws.length ? 'b-done' : 'b-prog') : ''}</div>
      <small>${esc(x.pname)}${x.step.owner ? ' · ' + esc(pname(x.step.owner)) : ''}${x.via !== 'owner' ? ` · in this section by its touches tag “${esc(x.tag)}”` : ''}</small>
      ${ch.length && st !== 'same' ? `<ul class="rl-bv-diff" data-bu-diff>${ch.slice(0, 6).map(c => `<li>${esc(namesIn(humanizeSummary(c, nm)))}</li>`).join('')}</ul>` : ''}</li>`;
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
    : a && a.decision === 'approved' ? `<div class="hint" data-bu-nochange>Nothing in this part changed since ${esc(pname(a.approver))} approved on ${esc(fmtTime(a.at))}.</div>`
    : `<div class="hint" data-bu-nochange>${esc(s.bu)} has not approved yet, so everything above is new to review: ${s.steps.filter(x => ((diffs[x.pid] || { nodes: {} }).nodes[x.step.id] || 'same') !== 'same').length} new or changed step${s.steps.length === 1 ? '' : 's'}.</div>`;
  const why = live ? '' : signoffWhy(prj, s.bu, open);
  const rdy = live || signed ? { ready: true, waiting: [] } : buReadyOf(prj, s.bu);
  const early = !live && !rdy.ready ? `<div class="rl-early" data-early-warning role="note"><b>Not ready for approval yet: waiting on ${esc(joinAnd(rdy.waiting))}.</b> You can approve early, but this part may need approving again when that changes.</div>` : '';
  const form = live ? `<div class="hint">The project is live; approvals are closed.</div>`
    : `<div class="rl-bv-form" data-bu-form><div class="field"><label for="rl-attest" title="Attestation note">What you checked <span class="rl-req">required</span></label>
        <textarea id="rl-attest" data-attest placeholder="e.g. “I reviewed the ${esc(s.bu)} steps, the proof for their information, and the business test results.”" ${why ? 'disabled' : ''}>${esc(ui.attest[prj.id + '|' + s.bu] != null ? ui.attest[prj.id + '|' + s.bu] : why ? '' : noteFactsOf(prj, s.bu, s))}</textarea></div>
        <div class="rl-err" data-attest-err role="alert" hidden></div>
        <div class="rl-bu-act">${why ? `<button class="btn sm" disabled data-locked>${a && a.decision === 'approved' ? 'Approve again' : 'Approve this part'}</button>${why}`
          : `<button class="btn primary sm" data-bu-decide="approved">${a && a.decision === 'approved' ? 'Approve again' : 'Approve this part'}</button><button class="btn sm danger" data-bu-decide="rejected">Ask for changes</button><span class="hint">Your note is stored on the approval. The extra sign-in check follows.</span>`}</div></div>`;
  return `<section class="hdr rl-hdr"><div>${crumbs}
      <div class="rl-title"><h1>${esc(s.bu)} approval</h1>${badge(state, signed ? 'b-done' : a && (a.decision === 'rejected' || stale.length) ? 'b-late' : 'b-soon')}</div>
      <p>Everything ${esc(s.bu)} is approving in <b>${esc(prj.name)}</b>, on one screen: its steps and what changed, the information they use and its proof, test results, open defects, and changes since the last approval.</p>${back}</div>
    <div class="hdr-side"><div class="kpis"><div class="kpi"><b>${s.steps.length}</b><span>Steps</span></div><div class="kpi"><b>${des.length}</b><span>Information</span></div><div class="kpi"><b class="${defects.length ? 'fail' : ''}">${defects.length}</b><span>Open defects</span></div><div class="kpi"><b class="${stale.length ? 'fail' : ''}">${stale.length}</b><span>Changes since approval</span></div></div></div></section>
    <div class="grid rl-grid rl-bv" data-bu-view="${esc(s.bu)}"><div class="rl-main">
      <div class="card"><h3>Steps<span class="n">${s.steps.length}</span></h3><ol class="rl-bv-steps">${steps}</ol></div>
      <div class="card"><h3>Information and proof<span class="n">${des.length}</span></h3>${data ? `<ul class="rl-bv-data">${data}</ul>` : '<div class="empty">These steps use no information.</div>'}</div>
      <div class="card"><h3>Test results<span class="n">latest per item</span></h3>${tests ? `<div class="tbl-wrap"><table class="rl-gt rl-bv-tests"><thead><tr><th>Item</th><th>Size</th><th>Latest result</th></tr></thead><tbody>${tests}</tbody></table></div>` : '<div class="empty">No tests cover these steps or their data yet.</div>'}
        <div class="rl-item-foot"><a class="rl-go" href="${link('/testing/' + prj.id)}" data-link>Open testing ›</a></div></div>
    </div><aside class="side">
      <div class="card rl-bv-sign"><h3>Approve the ${esc(s.bu)} part</h3>
        ${a ? `<div class="rl-signed">${av(a.approver)} <span>${esc(pname(a.approver))} ${a.decision === 'approved' ? 'approved' : 'asked for changes'} · ${esc(fmtTime(a.at))}${a.stepUp ? ' · <span class="rl-mfa">extra sign-in check done</span>' : ''}</span></div>${a.attestation || a.note ? `<div class="rl-attest" data-attestation>“${esc(a.attestation || a.note)}”</div>` : ''}` : '<div class="hint">Not approved yet.</div>'}
        ${early}${form}</div>
      <div class="card"><h3>Changes since last approval<span class="n">${stale.length}</span></h3>${changes}</div>
      <div class="card"><h3>Open defects<span class="n">${defects.length}</span></h3>${defects.map(w => `<div class="row" data-bu-defect="${esc(w.id)}"><div><div class="t">${esc(w.title)}</div><div class="s">${esc(pname(w.owner))}${w.severity ? ` · severity ${esc(w.severity)}` : ''} · due ${esc(fmt(w.due))}</div></div></div>`).join('') || '<div class="hint">No open defects on these steps or their data.</div>'}</div>
    </aside></div>`;
}

/* Who may decide this section, with a toast when not. */
/* R7: a team can approve its part at any time, even while other checks fail (no sign-off lock). */
function canDecide(prj, bu, decision) {
  if (store.state.me === prj.owner && decision === 'approved') { toast("Project managers can't approve their own project."); return false; }
  if (store.state.me === rmOf(prj) && decision === 'approved') { toast("The launch owner can't approve a team's part."); return false; }
  if (!eligibleFor(prj, bu).includes(store.state.me)) { toast(`Only ${eligibleFor(prj, bu).map(pname).join(', ') || 'someone chosen for it'} can approve the ${bu} part.`); return false; }
  return true;
}
/* Record a BU decision: the attestation note is required and stored on the approval, then step-up. */
async function decide(prj, bu, decision, note) {
  const attestation = String(note || '').trim();
  if (!attestation) { toast('Write what you checked first.'); return false; }
  if (!(await signIn(`${decision === 'approved' ? 'approve' : 'ask for changes to'} the ${bu} part`))) { toast('Extra sign-in check not completed. Nothing was saved.'); return false; }
  const prev = latestApproval(prj.id, bu);
  const re = decision === 'approved' && prev && prev.decision === 'approved';
  const id = store.newId('apr'); const at = new Date().toISOString();
  const fp = eng('sectionFingerprint', prj.id, bu);
  await store.save('approval', id, Object.assign({ id, projectId: prj.id, bu, approver: store.state.me, decision, at, snapshotAt: at, stepUp: true, attestation, note: attestation }, fp ? { fingerprint: fp } : {}),
    `${decision === 'approved' ? (re ? 'Approved again' : 'Approved') : 'Asked for changes to'} the ${bu} part of ${prj.name} (extra sign-in check): “${attestation.slice(0, 120)}”`);
  await store.notify([prj.owner], `${pname(store.state.me)} ${decision === 'approved' ? 'approved' : 'asked for changes to'} the ${bu} part of ${prj.name}`, 'approval:' + id);
  delete ui.attest[prj.id + '|' + bu];
  if (decision === 'approved') ui.justApproved = prj.id + '|' + bu;
  toast(decision === 'approved' ? `${bu} part approved` : `Changes asked for on the ${bu} part`);
  return true;
}
function bindBuView(root, prj, bu) {
  const ta = root.querySelector('[data-attest]');
  const key = prj.id + '|' + ((root.querySelector('[data-bu-view]') || {}).dataset || {}).buView;
  if (ta) ta.oninput = () => { ui.attest[key] = ta.value; };
  root.querySelectorAll('[data-bu-decide]').forEach(b => b.onclick = async () => {
    const decision = b.dataset.buDecide; const err = root.querySelector('[data-attest-err]');
    const secBu = root.querySelector('[data-bu-view]').dataset.buView;
    if (!store.advanced && decision === 'rejected') {
      if (!canDecide(prj, secBu, decision)) return;
      const p = modal({ title: `Ask for changes to the ${secBu} part`, body: `<div class="field"><label>What needs to change?</label><textarea name="note" data-attest-modal></textarea></div><div class="hint">The project manager is told, with your note.</div>`, actions: [{ id: 'go', label: 'Ask for changes', danger: true }] });
      guardModal(f => !String(f.note || '').trim() ? { msg: 'Say what needs to change.', field: 'note' } : null);
      const r = await p; if (r.action !== 'go') return;
      await decide(prj, secBu, 'rejected', r.form.note); return;
    }
    if (!ta.value.trim()) { err.hidden = false; err.textContent = decision === 'approved' ? 'Write what you checked: it is stored on the approval.' : 'Say what needs to change before you can approve.'; ta.setAttribute('aria-invalid', 'true'); ta.focus(); return; }
    err.hidden = true; ta.removeAttribute('aria-invalid');
    if (!canDecide(prj, secBu, decision)) return;
    await decide(prj, secBu, decision, ta.value);
  });
  bindActivity(root);
}


/* ======================================================================================================
   R7 SIMPLE MODE (the default). One sentence first, a plain list of what is left and who acts, one-tap
   actions, and the rest folded away. Advanced mode keeps the full page above.
   ====================================================================================================== */
function eng(name, ...args) { const e = E(); if (!e || typeof e[name] !== 'function') return undefined; try { return e[name](store.state.docs, ...args); } catch (err) { return undefined; } }

/* ---------- R9 ONE TRUTH: every count on this page comes from projectTruth (testing, approvals, stepsLeft, launchSteps) ---------- */
function truthOf(prj) { return eng('projectTruth', prj.id, store.state.today) || null; }
/* projectTruth.testing: {needTests, haveTests, total, passed, failed, notRun, stage, next, perBU} */
function testingTruth(prj, t) { t = t || truthOf(prj); return (t && t.testing) || null; }
const nextOfTesting = tt => tt ? String(tt.next || (tt.nextAction && tt.nextAction.label) || tt.sentence || '') : '';
/* projectTruth.approvals = [{bu, needed, ready, approved, approver, blockedBy}] (the launch gate reads the same list) */
function approvalsTruth(prj, t) {
  t = t || truthOf(prj);
  const raw = t && (t.approvals || (t.status && t.status.approvals));
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.keys(raw).map(bu => Object.assign({ bu }, raw[bu])) : null;
  return arr ? arr.filter(a => a && a.bu) : null;
}
/* One count per part: perBU[bu] from projectTruth.testing. */
function perBuOf(prj, bu, t) {
  const tt = testingTruth(prj, t); const m = tt && tt.perBU; if (!m) return null;
  const k = Object.keys(m).find(x => x.toLowerCase() === String(bu).toLowerCase());
  const v = k ? m[k] : null;
  return v ? { total: +v.total || 0, passed: +v.passed || 0, failed: +v.failed || 0, notRun: +v.notRun || 0 } : { total: 0, passed: 0, failed: 0, notRun: 0 };
}
/* "Not ready to launch: N steps left" = projectTruth.stepsLeft (the checklist's undone count). */
function stepsLeftOf(prj, steps, t) {
  t = t || truthOf(prj);
  if (t && typeof t.stepsLeft === 'number') return t.stepsLeft;
  return Array.isArray(steps) ? steps.filter(s => !s.done).length : 0;
}
/* Plain text for a separation-of-duties (or other) block on a part. */
function blockText(b, bu) {
  if (!b) return '';
  if (typeof b === 'string') return b;
  const t = b.text || b.sentence || b.message || b.reason || b.label;
  if (t) return String(t);
  const who = b.person || b.by || b.recordedBy;
  if (who) return `${firstName(who)} recorded these tests, so someone else in ${bu} must approve.`;
  return '';
}

/* Launch window: "YYYY-MM-DD HH:MM–HH:MM (note)" (or {start, end}) shown as "Mon Nov 16, 8:00–10:00 AM", never ISO. */
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function parseWindow(c) {
  c = c || {};
  let date = c.windowDate || '', from = c.windowStart || '', to = c.windowEnd || '', note = c.windowNote || '';
  const w = c.window;
  if (w && typeof w === 'object') { const s = String(w.start || ''), e = String(w.end || ''); date = date || s.slice(0, 10); from = from || s.slice(11, 16); to = to || e.slice(11, 16); note = note || w.note || ''; }
  else if (typeof w === 'string' && w.trim()) {
    const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?(?:\s*[–-]\s*(\d{1,2}:\d{2}))?\s*(.*)$/.exec(w.trim());
    if (m) { date = date || m[1]; from = from || m[2] || ''; to = to || m[3] || ''; note = note || m[4].replace(/^\(|\)$/g, '').trim(); }
    else return { raw: w.trim() };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { date, from, to, note };
}
const hm = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? { h: +m[1], m: +m[2] } : null; };
const ampm = t => `${t.h % 12 || 12}:${String(t.m).padStart(2, '0')}`;
export function fmtWindow(c) {
  const p = parseWindow(c); if (!p) return ''; if (p.raw) return p.raw;
  const d = new Date(p.date + 'T12:00:00Z');
  let s = `${WD[d.getUTCDay()]} ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const a = hm(p.from), b = hm(p.to);
  if (a && b) { const pa = a.h < 12 ? 'AM' : 'PM', pb = b.h < 12 ? 'AM' : 'PM'; s += `, ${ampm(a)}${pa === pb ? '' : ' ' + pa}–${ampm(b)} ${pb}`; }
  else if (a) s += `, ${ampm(a)} ${a.h < 12 ? 'AM' : 'PM'}`;
  return s + (p.note ? ` (${p.note})` : '');
}
/* Has the launch window opened (local time)? No window set = no time guard. */
function windowOpen(prj) {
  const p = parseWindow(prj.cutover); if (!p || p.raw) return { open: true, text: '' };
  const t = hm(p.from) || { h: 0, m: 0 };
  const start = new Date(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), t.h, t.m);
  return { open: Date.now() >= start.getTime(), text: fmtWindow(prj.cutover) };
}
/* Launch guard: before the window or with launch-day steps not done, "Launch now" is disabled. */
function launchGuard(prj) {
  const w = windowOpen(prj);
  const left = tasksOf(prj.cutover).filter(t => !t.done);
  const why = [];
  if (!w.open) why.push(`the launch window opens ${w.text}`);
  if (left.length) why.push(`${left.length} launch-day step${left.length === 1 ? ' is' : 's are'} not done yet: ${left.slice(0, 3).map(t => `“${t.task}”`).join(', ')}${left.length > 3 ? '…' : ''}`);
  return { ok: !why.length, why, windowOpen: w.open, stepsLeft: left.length };
}
/* R9: "Teams involved" lists teams only; systems get their own "Systems touched" line. */
function teamsSystems(sec) {
  const bus = new Set(store.state.people.map(p => String(p.bu || '').toLowerCase()).filter(Boolean));
  const teams = new Set(), systems = new Set();
  (sec.steps || []).forEach(x => {
    (x.step.touches || []).forEach(t => { const v = String(t || '').trim(); if (!v) return; (bus.has(v.toLowerCase()) ? teams : systems).add(v); });
    if (x.step.system) String(x.step.system).split(/\s*[,/]\s*/).filter(Boolean).forEach(v => systems.add(v));
  });
  return (teams.size ? `<div class="rs-part-s" data-teams-involved><span class="rs-lbl">Teams involved:</span> ${esc([...teams].join(', '))}</div>` : '')
    + (systems.size ? `<div class="rs-part-s" data-systems-touched><span class="rs-lbl">Systems touched:</span> ${esc([...systems].join(', '))}</div>` : '');
}
function windowLine(prj) {
  const w = fmtWindow(prj.cutover);
  return w ? `<div class="rs-window" data-launch-window><span class="rs-lbl">Launch window</span> <b>${esc(w)}</b></div>` : '';
}
/* R9 §13: after launch, every team that approved (approvals current at launch; nothing dropped). */
function approvedAtLaunch(prj, lastGo) {
  if (!lastGo) return [];
  const at = String(lastGo.at || '');
  const prevGo = store.list('release', r => r.projectId === prj.id && r.id !== lastGo.id && !isRollback(r) && !failedAny(r) && String(r.at) < at).map(r => String(r.at)).sort().pop() || '';
  const by = {};
  store.list('approval', a => a.projectId === prj.id && String(a.at) <= at && String(a.at) > prevGo).sort((a, b) => String(a.at).localeCompare(String(b.at))).forEach(a => { by[a.bu] = a; });
  const out = Object.values(by).filter(a => counts(prj, a));
  const appr = approvalsTruth(prj) || [];
  appr.filter(x => x.approved && x.approver && !out.some(a => a.bu === x.bu)).forEach(x => out.push({ bu: x.bu, approver: x.approver, at: x.at || x.approvedAt || '' }));
  return out.sort((a, b) => String(a.bu).localeCompare(String(b.bu)));
}
function approvedTeams(prj, lastGo) {
  const list = approvedAtLaunch(prj, lastGo);
  if (!list.length) return '';
  return `<div class="rs-approved" data-approved-teams="${list.length}"><span class="rs-lbl">Approved by ${list.length === 1 ? 'the team' : `all ${list.length} teams`}</span><ul>${list.map(a => `<li data-approved-team="${esc(a.bu)}"><b>${esc(a.bu)}</b> ${av(a.approver)} ${esc(pname(a.approver))}${a.at ? `, ${esc(fmt(a.at))}` : ''}</li>`).join('')}</ul></div>`;
}
/* Raw person ids in diff lines ("Owner dk → ps") become names; "(none)" becomes "Nobody". */
function namesIn(t) {
  return String(t).replace(/^Owner (\S+) → (\S+)$/, (all, a, b) => `Owner ${a === '(none)' ? 'Nobody' : pname(a)} → ${b === '(none)' ? 'Nobody' : pname(b)}`).replace(/\(none\)/g, 'Nobody');
}
/* Information with an open problem shows "Has a problem" (amber) and counts as not ready. */
function hasOpenProblem(prj, dataId) {
  const l = eng('availLabel', dataId);
  if (l && l.state) return l.state === 'problem';
  return store.list('workItem', w => w.projectId === prj.id && w.kind === 'defect' && w.status !== 'done' && w.defectStatus !== 'closed'
    && (w.dataId === dataId || w.resolves === dataId || (w.testRef && w.testRef.caseId && (store.get('testCase', w.testRef.caseId) || {}).dataId === dataId))).length > 0;
}
const TONE = { green: 'ok', amber: 'warn', red: 'bad' };
/* Connected / Sample only / Not available yet / Waiting for confirmation, from the engine (one label set everywhere). */
export function availOf(dataId) {
  const l = eng('availLabel', dataId);
  if (l && l.label) return { label: l.label, tone: TONE[l.tone] || 'warn', key: l.key };
  const st = effAvail(dataId);
  return { live: { label: 'Connected', tone: 'ok' }, example: { label: 'Sample only', tone: 'warn' }, pending: { label: 'Waiting for confirmation', tone: 'warn' } }[st] || { label: 'Not available yet', tone: 'bad' };
}
const firstName = id => String(pname(id)).split(' ')[0];
const whoList = ids => (ids || []).filter(id => store.person(id)).map(id => `<span class="rs-who" data-who="${esc(id)}">${av(id)} ${esc(pname(id))}</span>`).join('');
const glossTip = { launchOwner: 'Release manager: the one person who can launch or undo the launch.' };

/* Each team's part, with who can approve it and where it stands. */
function partsOf(prj, rd, t) {
  const live = prj.status === 'live';
  t = t || truthOf(prj);
  /* R9: the parts are projectTruth.approvals (the gate's own list). A team that doesn't need to approve is never a part. */
  const appr = approvalsTruth(prj, t);
  let secs = buSections(prj);
  if (appr) {
    const need = appr.filter(a => a.needed !== false);
    secs = need.map(a => secs.find(s => s.bu.toLowerCase() === String(a.bu).toLowerCase()) || { bu: a.bu, steps: [], changed: [], tasks: false, fromTags: false });
  }
  return secs.map(s => {
    const ap = appr ? appr.find(a => String(a.bu).toLowerCase() === s.bu.toLowerCase()) || null : null;
    const a = latestApproval(prj.id, s.bu);
    const stale = live ? [] : staleChanges(prj, s, a, rd);
    const eligible = eligibleFor(prj, s.bu);
    const ok = counts(prj, a);
    const rdy = live ? { ready: true, waiting: [] } : buReadyOf(prj, s.bu);
    const state = ok && !stale.length ? 'approved' : ok && stale.length ? 'stale' : a && a.decision === 'rejected' && eligible.includes(a.approver) ? 'rejected' : !eligible.length ? 'nobody' : rdy.ready ? 'waiting' : 'notready';
    /* R8: a changed (stale) part is looked at again only once its own evidence is complete too */
    let state2 = (state === 'stale' || state === 'rejected') && !rdy.ready ? 'notready' : state;
    if (ap && ap.approved === true && state2 !== 'approved' && ok) state2 = 'approved';
    const blockedBy = !live && ap && ap.blockedBy && ap.blockedBy.rule !== 'no-approver' && state2 !== 'approved' ? ap.blockedBy : null;
    if (blockedBy && (state2 === 'waiting' || state2 === 'nobody')) state2 = 'blocked';
    /* one count per part: perBU.notRun + perBU.failed + open items (buReady's non-test items) */
    const pb = perBuOf(prj, s.bu, t);
    const br = live ? null : eng('buReady', prj.id, s.bu, store.state.today);
    const openItems = br && Array.isArray(br.waiting) ? br.waiting.filter(w => w && w.kind !== 'tests').reduce((n, w) => n + (+w.count || (w.items || []).length || 1), 0) : 0;
    const waitN = ap && typeof ap.waitingOn === 'number' ? ap.waitingOn : pb ? pb.notRun + pb.failed + openItems : null;
    return { bu: s.bu, s, a, stale, eligible, state: state2, ready: rdy.ready, waiting: rdy.waiting, sentence: br && br.sentence, blockedBy, perBU: pb, waitN, truth: ap };
  });
}
const PART_TXT = { approved: 'Approved', stale: 'Changed: approve again', rejected: 'Changes asked for', nobody: 'Needs someone to approve', waiting: 'Ready for approval', notready: 'Not ready yet', blocked: 'Choose another approver' };
const PART_CLS = { approved: 'b-done', stale: 'b-late', rejected: 'b-late', nobody: 'b-soon', waiting: 'b-soon', notready: 'b-idle', blocked: 'b-late' };
/* R9: the sentence is buReady's own ("Not ready for your approval yet: waiting on …"). */
const waitingTxt = p => p.sentence && /^Not ready/.test(p.sentence) ? p.sentence : `Not ready for your approval yet: waiting on ${joinAnd(p.waiting.length ? p.waiting : ['the rest of this part'])}.`;

/* "The launch still needs": the open launch steps in plain words (engine launchSteps), else the failing checks. */
/* R8 ONE TRUTH: launch steps (and their numbers and labels) come from E().projectTruth, the single source every page reads. */
function truthSteps(prj) {
  const t = eng('projectTruth', prj.id, store.state.today);
  const st = t && (t.launchSteps || t.launch && (t.launch.steps || t.launch));
  return Array.isArray(st) ? st : eng('launchSteps', prj.id, store.state.today);
}
function stillNeeds(prj, rd, skipKey) {
  const steps = truthSteps(prj);
  if (Array.isArray(steps)) return steps.filter(s => !s.done && s.key !== skipKey && s.key !== 'launch').map(s => ({ key: s.key, label: s.label, action: s.action, who: s.who || [] }));
  return (rd.checks || []).filter(c => checkState(c) === 'fail').map(c => ({ key: c.id, label: plainOf(c), action: '', who: [] }));
}

/* One-tap action for a launch step, where one exists. */
function stepAction(prj, st, parts, me) {
  const mine = parts.find(p => p.state !== 'approved' && p.state !== 'notready' && p.eligible.includes(me));
  switch (st.key) {
    case 'approvals': {
      if (mine) return `<a class="btn primary" href="${link(`/release/${prj.id}?bu=${encodeURIComponent(mine.bu)}`)}" data-link data-step-act="approve">Approve your part</a>`;
      if (parts.some(p => p.state === 'nobody') && canChoose(prj)) return `<button class="btn primary" data-open-sec="approvals" data-step-act="choose">Choose who approves</button>`;
      return `<button class="btn" data-open-sec="approvals" data-step-act="see">See approvals</button>`;
    }
    case 'plan': return `<a class="btn" href="${link('/project/' + prj.id)}" data-link data-step-act="plan">Open the plan</a>`;
    case 'work': return `<a class="btn" href="${link('/project/' + prj.id + '?mode=work')}" data-link data-step-act="work">Open the work</a>`;
    case 'information': {
      const pend = projectData(prj).find(de => effAvail(de.id) === 'pending' && de.owner === me);
      if (pend) return `<a class="btn primary" href="${link('/data/' + pend.id)}" data-link data-step-act="confirm">Confirm it’s connected</a>`;
      const first = projectData(prj).find(de => effAvail(de.id) !== 'live');
      return first ? `<a class="btn" href="${link('/data/' + first.id)}" data-link data-step-act="info">Open ${esc(first.name)}</a>` : '';
    }
    case 'tests': return `<a class="btn" href="${link('/testing/' + prj.id)}" data-link data-step-act="tests">Open testing</a>`;
    case 'launch-plan': return store.state.me === prj.owner ? `<button class="btn primary" data-cutover-edit data-step-act="plan-edit">${prj.cutover ? 'Finish the launch-day plan' : 'Add the launch-day plan'}</button>` : `<button class="btn" data-open-sec="plan" data-step-act="plan-see">See the launch-day plan</button>`;
    case 'launch': {
      const gc = (rd => (rd.checks || []).find(c => c.id === 'grants-closed'))(readiness(prj.id));
      if (gc && checkState(gc) === 'fail') return `<button class="btn" data-open-sec="access" data-step-act="access">See temporary data access</button>`;
      return '';
    }
    default: return '';
  }
}

function simpleRender(prj, rd, params) {
  const prjId = prj.id; const me = store.state.me;
  const projects = store.list('project');
  const live = prj.status === 'live';
  const rm = rmOf(prj);
  const releases = store.list('release', r => r.projectId === prjId).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const lastGo = releases.find(r => !isRollback(r) && !isFailedRel(r));
  const failedRel = !live && releases[0] && !isRollback(releases[0]) && pipePhase(releases[0]) === 'failed' ? releases[0] : null;
  const t = truthOf(prj);
  const parts = partsOf(prj, rd, t);
  const stepsRaw = truthSteps(prj);
  const steps = Array.isArray(stepsRaw) ? stepsRaw : (rd.checks || []).map(c => ({ key: c.id, label: plainOf(c), done: checkState(c) !== 'fail', who: [], action: c.detail || '' }));
  const ckFail = id => { const c = (rd.checks || []).find(x => x.id === id); return !!c && checkState(c) === 'fail'; };
  const gOpen = gngOpen(prj);
  /* R9: one number, projectTruth.stepsLeft (equals the checklist's undone count below) */
  const left = stepsLeftOf(prj, steps, t);
  const guard = launchGuard(prj);
  const gateOk = !live && rd.pass && !gOpen.length;
  const ready = gateOk && guard.ok;
  const testNext = nextOfTesting(testingTruth(prj, t));
  const running = ui.pipe && ui.pipe.phase !== 'failed' && ui.pipe.phase !== 'succeeded' && store.get('release', ui.pipe.id) && store.get('release', ui.pipe.id).projectId === prjId;
  const status = live ? { cls: 'live', icon: '✓', title: `Launched on ${fmt(lastGo && lastGo.at)}`, sub: `${prj.name} is live. The new way of working is now how it works today.` }
    : running ? { cls: 'busy', icon: '…', title: 'Launching now', sub: 'The delivery step is running. This takes a few seconds.' }
    : ready ? { cls: 'ready', icon: '✓', title: 'Ready to launch', sub: failedRel ? 'The last launch did not go through. Nothing changed, so it is safe to try again.' : rm === me ? 'Everything is done. You can launch now.' : `Everything is done. ${pname(rm)} (launch owner) can launch.` }
    : left ? { cls: 'notready', icon: String(left), title: `Not ready to launch: ${left} step${left === 1 ? '' : 's'} left`, sub: 'Here is what is left and who does it.' }
    : { cls: 'notready', icon: '…', title: 'Not ready to launch yet', sub: `Launch is possible once ${joinAnd(guard.why.concat(gOpen.length ? ['the final checks are confirmed'] : []))}.` };
  const myPart = !live && parts.find(p => p.state !== 'approved' && p.state !== 'notready' && p.eligible.includes(me));
  const myWait = !live && !myPart && parts.find(p => p.state === 'notready' && p.eligible.includes(me));
  const myDone = parts.find(p => p.state === 'approved' && p.a && p.a.approver === me);

  const stepRows = steps.filter(s => s.key !== 'launch' || !s.done).map(s => {
    const act = s.done ? '' : stepAction(prj, s, parts, me);
    /* R9 §6: the Tests step reads the one testing "next" sentence, never "Create the tests" */
    const action = s.key === 'tests' && !s.done && testNext ? testNext : s.action;
    return `<li class="rs-step ${s.done ? 'done' : ''} ${s.next ? 'next' : ''}" data-launch-step="${esc(s.key)}" data-done="${s.done ? '1' : '0'}">
      <span class="rs-tick" aria-hidden="true">${s.done ? '✓' : ''}</span>
      <div class="rs-step-b"><b>${esc(s.label)}</b>${!s.done && action && action !== 'Done' ? `<span class="rs-act-t" ${s.key === 'tests' ? 'data-tests-next' : ''}>${esc(action)}</span>` : ''}
        ${!s.done && (s.who || []).length ? `<div class="rs-whos"><span class="rs-lbl">Who:</span>${whoList(s.who)}</div>` : ''}</div>
      ${act ? `<div class="rs-step-a">${act}</div>` : ''}</li>`;
  }).join('');

  const partRows = parts.map(p => {
    const mine = p.eligible.includes(me);
    const href = link(`/release/${prjId}?bu=${encodeURIComponent(p.bu)}`);
    const by = p.a && (p.state === 'approved' || p.state === 'stale' || p.state === 'rejected') ? `${av(p.a.approver)} ${esc(pname(p.a.approver))}, ${esc(fmt(p.a.at))}` : p.eligible.length ? `Who can approve: ${p.eligible.map(id => esc(pname(id))).join(', ')}` : '';
    /* R9 §7: one count per part, from perBU; the card opens the part page */
    const waitLine = p.state === 'notready' ? `<div class="rs-part-s" data-part-waiting="${p.waitN == null ? '' : p.waitN}">${p.waitN != null ? `Waiting on ${p.waitN}: ` : 'Waiting on '}${esc(joinAnd(p.waiting))}</div>` : '';
    const testLine = p.perBU && p.perBU.total ? `<div class="rs-part-s" data-part-tests="${p.perBU.passed}/${p.perBU.total}">Tests for this part: ${p.perBU.passed} of ${p.perBU.total} passed${p.perBU.failed ? `, ${p.perBU.failed} failed` : ''}${p.perBU.notRun ? `, ${p.perBU.notRun} not run` : ''}</div>` : '';
    if (!live && (p.state === 'nobody' || p.state === 'blocked')) {
      return `<div class="rs-part ${p.state}" data-part="${esc(p.bu)}" data-state="${p.state}"><div class="rs-part-h"><a href="${href}" data-link data-part-open="${esc(p.bu)}"><b>${esc(p.bu)}</b></a>${badge(PART_TXT[p.state], PART_CLS[p.state])}</div>
        ${p.state === 'blocked' ? sodBlock(prj, p) : choosePicker(prj, p.bu)}${testLine}</div>`;
    }
    const act = !live && mine && p.state !== 'approved' && p.state !== 'notready' ? `<span class="btn primary" data-part-approve="${esc(p.bu)}">${p.state === 'stale' ? 'Look again and approve' : 'Approve your part'}</span>`
      : `<span class="rl-go" data-bu-review="${esc(p.bu)}">See this part ›</span>`;
    return `<a class="rs-part rs-part-link ${p.state}" href="${href}" data-link data-part="${esc(p.bu)}" data-part-open="${esc(p.bu)}" data-state="${p.state}"><div class="rs-part-h"><b>${esc(p.bu)}</b>${badge(PART_TXT[p.state], PART_CLS[p.state])}</div>
      ${by ? `<div class="rs-part-s">${by}</div>` : ''}${waitLine}${testLine}${act}</a>`;
  }).join('');

  const grantsOpen = store.list('grant', g => g.projectId === prjId && ['active', 'approved', 'requested'].includes(grantStatus(g))).length;
  const planNeeds = cutoverNeeds(prj.cutover);
  const hc = Array.isArray(prj.incidents) ? prj.incidents.filter(x => x.status !== 'resolved') : [];
  const sec = (key, title, sub, body, isOpen) => `<details class="rs-sec" data-sec="${key}" ${(ui.secOpen && ui.secOpen[prjId + key] != null ? ui.secOpen[prjId + key] : isOpen) ? 'open' : ''}>
    <summary><span class="rs-sec-t">${title}</span><span class="rs-sec-s">${sub}</span></summary><div class="rs-sec-b">${body}</div></details>`;

  return `<section class="hdr rl-hdr rs-hdr"><div>
      <div class="crumbs"><a href="${link('/')}" data-link>Home</a> · <a href="${link('/project/' + prjId)}" data-link>${esc(prj.name)}</a> · Launch</div>
      <div class="rl-title"><h1>Launch</h1>${projects.length > 1 ? `<select class="rl-switch" data-switch aria-label="Project">${projects.map(p => `<option value="${esc(p.id)}" ${p.id === prjId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}</div></div></section>
    <div class="rs-wrap" data-simple-launch>
    <div class="rs-status ${status.cls}" data-launch-status="${status.cls}" role="status"><span class="rs-status-ic" aria-hidden="true">${esc(status.icon)}</span><div><b data-launch-sentence>${esc(status.title)}</b><span>${esc(status.sub)}</span></div></div>
    ${ui.reasons ? `<div class="banner rl-reasons" data-reasons><b>The launch was refused.</b><ul>${ui.reasons.map(r => `<li>${esc(typeof r === 'string' ? r : (r.label || r.detail || ''))}</li>`).join('')}</ul></div>` : ''}
    ${failedRel && !running ? `<div class="rs-fail" data-pipeline-failed><b>The last launch did not go through.</b> Nothing was changed: the processes, the procedure and temporary data access are exactly as they were.${rm === me ? ` <button class="btn primary" data-retry ${rd.pass && !gOpen.length && guard.ok ? '' : 'disabled'}>Try the launch again</button>` : ''}</div>` : ''}
    ${running ? `<div class="rs-run" data-pipe-phase="${esc(ui.pipe.phase)}" data-pipe-kind="${ui.pipe.kind === 'rollback' ? 'rollback' : 'golive'}"><span class="rs-spin" aria-hidden="true"></span>${ui.pipe.kind === 'rollback' ? 'Undoing the launch…' : 'Launching…'} <small>${ui.pipe.phase === 'queued' ? 'Starting' : 'Running'} (simulated)</small></div>` : ''}
    ${myPart ? `<a class="rs-mine" href="${link(`/release/${prjId}?bu=${encodeURIComponent(myPart.bu)}`)}" data-link data-review-mine="${esc(myPart.bu)}"><b>${myPart.state === 'stale' ? `The ${esc(myPart.bu)} part changed: please look again` : `Approve the ${esc(myPart.bu)} part`}</b><span>You can approve it now, even while other things are still open. It takes about a minute.</span><span class="rs-mine-go" aria-hidden="true">›</span></a>`
      : myWait ? `<div class="rs-mine wait" data-my-notready="${esc(myWait.bu)}"><b>The ${esc(myWait.bu)} part isn’t ready for your approval yet.</b><span>${esc(waitingTxt(myWait).replace(/^Not ready for your approval yet: /, ''))} You’ll be told when it’s ready.</span></div>`
      : myDone && !live ? `<div class="rs-mine done" data-my-approved><b>Your part (${esc(myDone.bu)}) is approved.</b><span>Thank you. Nothing else is needed from you for it.</span></div>` : ''}
    ${!live ? `<div class="card rs-card"><h3>What is left before launch</h3><ol class="rs-steps" data-launch-steps>${stepRows}</ol></div>` : ''}
    ${!live && (ready || rm === me) ? `<div class="card rs-card rs-go"><h3>Launch</h3>${windowLine(prj)}${rm === me
        ? `<button class="btn primary rs-big" data-golive ${ready ? '' : 'disabled'}>Launch now</button>${ready ? '' : `<div class="hint" data-why="notready">${!gateOk ? `You can launch when everything above is done${gOpen.length ? ` and the final checks are confirmed (${gOpen.map(t => esc(t.owner ? pname(t.owner) : 'needs an owner')).join(', ')})` : ''}.` : `Not yet: ${esc(joinAnd(guard.why))}.`}</div>`}`
        : `<div class="hint" data-why="rm">Only the <span title="${esc(glossTip.launchOwner)}">launch owner</span>, ${esc(pname(rm))}, can launch.</div>`}</div>` : ''}
    ${live ? `<div class="card rs-card" data-live-card><h3>Launched</h3><p class="rs-p">${esc(prj.name)} went live on ${esc(fmt(lastGo && lastGo.at))}${lastGo && lastGo.by ? `, launched by ${esc(pname(lastGo.by))}` : ''}. Temporary data access closed at launch.</p>
      ${approvedTeams(prj, lastGo)}
      ${canRollback(prj) ? `<button class="btn danger" data-rollback>Undo the launch</button>` : `<div class="hint" data-why="rm">If something goes badly wrong, ${esc(pname(rm))} (launch owner) can undo the launch.</div>`}
      ${releases[0] && isFailedRb(releases[0]) ? `<div class="rs-fail" data-rollback-failed><b>The undo did not go through.</b> Nothing was restored; the launch is still live.</div>` : ''}</div>` : ''}
    ${parts.length && !live ? sec('approvals', 'Approvals', `${parts.filter(p => p.state === 'approved').length} of ${parts.length} teams approved`, `<div class="rs-parts">${partRows}</div><div class="hint">Only teams whose part changed approve, once their part is ready. Two different people must approve. The project manager and the launch owner can’t approve a team’s part.</div>`, !live && (canChoose(prj) && parts.some(p => p.state === 'nobody' || p.state === 'blocked'))) : ''}
    ${sec('plan', 'Launch-day plan', live ? 'Done' : planNeeds.length ? 'Not ready yet' : gOpen.length ? `${gOpen.length} final check${gOpen.length === 1 ? '' : 's'} to confirm` : 'Ready', cutoverCard(prj), !live && (ckFail('cutover-plan') || gOpen.some(t => t.owner === me)))}
    ${sec('access', 'Temporary data access', grantsOpen ? `${grantsOpen} open` : 'None open', grantsCard(prj), !live && ckFail('grants-closed'))}
    ${live ? sec('support', 'Support after launch', hc.length ? `${hc.length} open problem${hc.length === 1 ? '' : 's'}` : 'No open problems', hypercareCard(prj, lastGo), hc.some(x => +x.severity === 1)) : ''}
    ${sec('audit', 'History', 'Every launch event, oldest first', '<div data-rl-history><div class="hint">Loading history…</div></div>', false)}
    ${sec('comments', 'Comments', `${store.list('comment', c => c.ref === 'project:' + prjId).length}`, commentsPanel('project:' + prjId), false)}
    <div class="rs-adv"><button class="btn rs-link" data-show-adv>Show advanced tools</button></div>
    </div>`;
}

/* Plain words for one changed step: "New step", "Changed: …". */
function plainChanges(list, nm) {
  return (list || []).slice(0, 4).map(c => namesIn(humanizeSummary(c, nm))).map(t => t.replace(/\bdata element(s?)\b/gi, 'information').replace(/\bto-be\b/gi, 'future').replace(/\bas-is\b/gi, 'today').replace(/\btouches\b/gi, 'teams involved').replace(/\bSLA\b/g, 'time limit'));
}

/* Business-test evidence an approver can trust: "33 business tests passed by Priya on Nov 4: “note”…", with "passed together". */
function evidenceLine(prj, s) {
  const keys = new Set(s.steps.map(x => x.pid + '|' + x.step.id));
  const dataIds = new Set(); s.steps.forEach(x => { (x.step.data || []).forEach(d => dataIds.add(d)); (x.step.subs || []).forEach(sb => (sb.data || []).forEach(d => dataIds.add(d))); });
  const ids = new Set(store.list('testCase', c => dataIds.has(c.dataId)).map(c => c.id));
  sectionScripts(prj, keys).forEach(x => ids.add(x.id));
  if (!ids.size) return { text: 'No tests cover this part yet.', tone: 'warn', n: 0 };
  const runs = store.list('testRun', r => r.projectId === prj.id).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const pick = env => { const by = {}; runs.filter(r => r.env === env).forEach(r => (r.results || []).forEach(x => { const k = x.caseId || x.scriptId; if (k && ids.has(k) && x.outcome !== 'not-run' && x.outcome !== 'skipped') by[k] = Object.assign({ run: r }, x); })); return by; };
  let env = 'uat', by = pick('uat');
  if (!Object.keys(by).length) { env = 'sit'; by = pick('sit'); }
  const kind = env === 'uat' ? 'business check' : 'try-it-out test';
  const all = Object.values(by);
  if (!all.length) return { text: `${ids.size} test${ids.size === 1 ? '' : 's'} for this part, none run yet.`, tone: 'warn', n: 0 };
  const pass = all.filter(x => x.outcome === 'pass'), fail = all.filter(x => x.outcome === 'fail'), blk = all.filter(x => x.outcome === 'blocked');
  const notRun = ids.size - all.length;
  const runner = {}; pass.forEach(x => { runner[x.run.by] = (runner[x.run.by] || 0) + 1; });
  const who = Object.keys(runner).sort((a, b) => runner[b] - runner[a])[0];
  const last = pass.map(x => x.run.at).sort().pop();
  const byNote = {}; pass.forEach(x => { const k = x.run.id + '|' + String(x.evidence || x.note || '').trim(); byNote[k] = (byNote[k] || 0) + 1; });
  /* the note most passes share (a bulk pass shows its one note), else the first note */
  const topK = Object.entries(byNote).filter(([k]) => !/\|$/.test(k)).sort((a, b) => b[1] - a[1])[0];
  const note = (topK ? topK[0].slice(topK[0].indexOf('|') + 1) : '').replace(/\bUAT folder\b/g, 'Business check scripts').replace(/\bdev run\b/g, 'test run').replace(/\bUAT\b/g, 'business check');
  const together = Object.entries(byNote).some(([k, n]) => n >= 3 && !/\|$/.test(k));
  const parts = [];
  if (pass.length) parts.push(`${pass.length} ${kind}${pass.length === 1 ? '' : 's'} passed by ${firstName(who)} on ${fmt(last)}${note ? `: “${note.length > 70 ? note.slice(0, 70) + '…' : note}”` : ''}`);
  if (fail.length) parts.push(`${fail.length} failed: “${String(fail[0].note || 'no note').slice(0, 60)}”`);
  if (blk.length) parts.push(`${blk.length} blocked`);
  if (notRun > 0) parts.push(`${notRun} not run yet`);
  return { text: parts.join(' · '), together, tone: fail.length || blk.length ? 'bad' : notRun > 0 ? 'warn' : 'ok', n: pass.length };
}

function simpleBuView(prj, buRaw, rd) {
  const parts = partsOf(prj, rd);
  const p = parts.find(x => x.bu.toLowerCase() === String(buRaw).toLowerCase());
  const back = `<a class="rl-go" href="${link('/release/' + prj.id)}" data-link data-bu-back>‹ Back to Launch</a>`;
  if (!p) return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> · <a href="${link('/release/' + prj.id)}" data-link>Launch</a></div><h1>${esc(buRaw)}</h1><p data-no-section>Nothing ${esc(buRaw)} does changes in ${esc(prj.name)}, so ${esc(buRaw)} doesn’t need to approve anything.</p>${back}</div></section>`;
  const s = p.s; const me = store.state.me; const live = prj.status === 'live';
  const e = E(); const nm = idNames();
  const diffs = {}; [...new Set(s.steps.map(x => x.pid))].forEach(pid => { const pr = store.get('process', pid); try { diffs[pid] = pr && e && e.diffProcess ? e.diffProcess(pr, store.state.docs) : { nodes: {}, changes: {} }; } catch (err) { diffs[pid] = { nodes: {}, changes: {} }; } });
  const stOf = x => (diffs[x.pid] || { nodes: {} }).nodes[x.step.id] || 'same';
  const changed = s.steps.filter(x => stOf(x) !== 'same');
  const same = s.steps.filter(x => stOf(x) === 'same');
  const stepsHtml = changed.map(x => { const st = stOf(x); const ch = plainChanges(((diffs[x.pid] || {}).changes || {})[x.step.id], nm);
    return `<li data-bu-step="${esc(x.step.id)}"><span class="rs-chg ${st === 'new' ? 'new' : 'chg'}">${st === 'new' ? 'New step' : 'Changed'}</span> <b>${esc(x.step.title)}</b>${ch.length && st !== 'new' ? `<div class="rs-chg-l">${ch.map(t => esc(t)).join(' · ')}</div>` : ''}</li>`; }).join('')
    + (same.length ? `<li class="rs-same" data-bu-same>${same.length} other step${same.length === 1 ? '' : 's'} in your part ${same.length === 1 ? 'has' : 'have'} not changed: ${same.map(x => esc(x.step.title)).join(', ')}.</li>` : '');
  const dataIds = new Set(); s.steps.forEach(x => { (x.step.data || []).forEach(d => dataIds.add(d)); (x.step.subs || []).forEach(sb => (sb.data || []).forEach(d => dataIds.add(d))); });
  const des = [...dataIds].map(id => store.get('dataElement', id)).filter(Boolean);
  const info = des.map(de => { const l0 = availOf(de.id); const l = hasOpenProblem(prj, de.id) ? { label: 'Has a problem', tone: 'warn' } : l0; return `<li data-bu-data="${esc(de.id)}"><span class="rs-dot ${l.tone}" aria-hidden="true"></span>${esc(de.name)} <span class="rs-st ${l.tone}">${esc(l.label)}</span></li>`; }).join('');
  /* R9 §7: "Tests for this part" uses the same perBU numbers as the part card */
  const pb = p.perBU;
  const ev = pb ? { text: pb.total ? `${pb.passed} of ${pb.total} test${pb.total === 1 ? '' : 's'} passed${pb.failed ? ` · ${pb.failed} failed` : ''}${pb.notRun ? ` · ${pb.notRun} not run yet` : ''}` : 'No tests cover this part yet.', tone: pb.failed ? 'bad' : pb.notRun || !pb.total ? 'warn' : 'ok', together: evidenceLine(prj, s).together } : evidenceLine(prj, s);
  const titles = (changed.length ? changed : s.steps).slice(0, 3).map(x => x.step.title);
  const key = prj.id + '|' + p.bu;
  const dflt = noteFactsOf(prj, p.bu, s) || `I reviewed the changes to ${titles.join(', ')}.`;
  const val = ui.attest[key] != null ? ui.attest[key] : dflt;
  const canAct = !live && p.eligible.includes(me);
  const a = p.a;
  const statusLine = p.state === 'approved' ? `Approved by ${esc(pname(a.approver))} on ${esc(fmt(a.at))}.`
    : p.state === 'stale' ? `${esc(pname(a.approver))} approved on ${esc(fmt(a.at))}, but this part has changed since: ${esc(p.stale.map(v => v.text).join(', '))}. Please look again.`
    : p.state === 'rejected' ? `${esc(pname(a.approver))} asked for changes on ${esc(fmt(a.at))}${a.attestation ? `: “${esc(a.attestation)}”` : ''}.`
    : p.state === 'nobody' ? 'Nobody can approve this part yet.' : p.state === 'blocked' ? esc(blockText(p.blockedBy, p.bu)) : p.state === 'notready' ? 'Not ready for approval yet.' : 'Ready for your approval.';
  const needs = stillNeeds(prj, rd, null);
  const doneMsg = p.state === 'approved' && (a.approver === me || ui.justApproved === key)
    ? `<div class="rs-done" data-part-approved><b>Your part is approved.</b>${needs.length ? `<span>The launch still needs:</span><ul data-still-needs>${needs.map(x => `<li>${esc(x.label)}${x.action && x.action !== 'Done' ? ` <small>${esc(x.action)}</small>` : ''}</li>`).join('')}</ul>` : '<span>Nothing else is needed: the launch owner can launch.</span>'}</div>` : '';
  let actHtml = '';
  if (live) actHtml = '<div class="hint">This project is live. Approvals are closed.</div>';
  else if (p.state === 'nobody') actHtml = `<div class="rs-nobody" data-no-approver="${esc(p.bu)}"><b>Nobody can approve the ${esc(p.bu)} part yet.</b>${choosePicker(prj, p.bu)}</div>`;
  else if (p.state === 'blocked') actHtml = sodBlock(prj, p);
  else if (p.state === 'notready') actHtml = `<div class="rs-notready" data-bu-notready role="status"><b data-bu-waiting="${p.waitN == null ? '' : p.waitN}">${esc(waitingTxt(p))}</b><span>${canAct ? 'Your part is ready to approve once that is done. You’ll be told, so there’s nothing to do now.' : `${p.eligible.length ? esc(p.eligible.map(pname).join(' or ')) + ' approves it then.' : ''}`}</span></div>`;
  else if (canAct && p.state !== 'approved') actHtml = `<div class="rs-form" data-bu-form>
      <label for="rl-attest" class="rs-lbl2" title="Attestation note">What you checked</label>
      <textarea id="rl-attest" data-attest rows="3">${esc(val)}</textarea>
      <div class="rl-err" data-attest-err role="alert" hidden></div>
      <button class="btn primary rs-big" data-bu-decide="approved">${p.state === 'stale' ? 'Approve again' : 'Approve'}</button>
      <div class="rs-form-f"><span class="hint">Next: a quick <span title="Step-up MFA">extra sign-in check</span>.</span><button class="btn rs-link" data-bu-decide="rejected">Ask for changes instead</button></div></div>`;
  else if (p.state !== 'approved') actHtml = `<div class="hint" data-why="${me === prj.owner ? 'owner' : me === rmOf(prj) ? 'rm' : 'bu'}">${me === prj.owner ? 'The project manager can’t approve a team’s part. ' : me === rmOf(prj) ? 'The launch owner can’t approve a team’s part. ' : ''}${p.eligible.length ? `${p.eligible.map(pname).map(esc).join(' or ')} can approve this part. To try it, switch “Viewing as” at the top.` : ''}</div>`;
  return `<section class="hdr rl-hdr rs-hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> · <a href="${link('/release/' + prj.id)}" data-link>Launch</a> · ${esc(p.bu)}</div>
      <h1>Approve the ${esc(p.bu)} part</h1><p class="rs-sub">${esc(prj.name)} · ${statusLine}</p></div></section>
    <div class="rs-wrap rs-bv" data-bu-view="${esc(p.bu)}" data-simple-approver>
      ${doneMsg}
      <div class="card rs-card"><h3>What changed in your part</h3><ul class="rs-list rs-changes">${stepsHtml || '<li>No steps.</li>'}</ul>${teamsSystems(s)}</div>
      <div class="card rs-card"><h3>Information your part uses</h3>${info ? `<ul class="rs-list rs-info">${info}</ul>` : '<div class="hint">Your part uses no information.</div>'}</div>
      <div class="card rs-card"><h3>Tests for this part</h3><div class="rs-ev ${ev.tone}" data-evidence-line ${pb ? `data-part-tests="${pb.passed}/${pb.total}"` : ''}>${esc(ev.text)}${ev.together ? ' <span class="rs-together" data-passed-together title="Many tests were marked passed at once with one shared note">passed together</span>' : ''}</div>
        <a class="rl-go" href="${link('/testing/' + prj.id)}" data-link>See the tests ›</a></div>
      ${actHtml ? `<div class="card rs-card rs-sign">${actHtml}</div>` : ''}
      ${back}
    </div>`;
}

/* ---------- bind ---------- */
export function bind(root, params) {
  const prjId = params.prj;
  const prj = store.get('project', prjId);
  const sw = root.querySelector('[data-switch]');
  if (sw) sw.onchange = () => { ui.reasons = null; go('/release/' + sw.value); };
  if (!prj) return;
  root.querySelectorAll('[data-choose-save]').forEach(b => b.onclick = () => { const bu = b.dataset.chooseSave; const sel = root.querySelector(`[data-choose-sel="${CSS.escape(bu)}"]`); chooseApprover(prj, bu, sel && sel.value); });
  const adv = root.querySelector('[data-show-adv]'); if (adv) adv.onclick = () => { store.setAdvanced(true); toast('Advanced tools shown'); };
  root.querySelectorAll('details[data-sec]').forEach(d => d.addEventListener('toggle', () => { ui.secOpen = ui.secOpen || {}; ui.secOpen[prjId + d.dataset.sec] = d.open; }));
  root.querySelectorAll('[data-open-sec]').forEach(b => b.onclick = () => { const d = root.querySelector(`details[data-sec="${b.dataset.openSec}"]`); if (!d) return; d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  if (params.q && params.q.bu) { bindBuView(root, prj, params.q.bu); return; }

  root.querySelectorAll('details[data-check]').forEach(d => d.addEventListener('toggle', () => { d.open ? ui.open.add(d.dataset.check) : ui.open.delete(d.dataset.check); }));
  root.querySelectorAll('[data-anchor]').forEach(a => a.onclick = e => { e.preventDefault(); const t = root.querySelector('#' + a.dataset.anchor); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  /* BU sign-off */
  /* BU sign-off from the main page: the attestation note is asked for in a dialog (required), then step-up */
  root.querySelectorAll('[data-signoff]').forEach(b => b.onclick = async () => {
    const bu = b.dataset.bu, decision = b.dataset.signoff;
    if (!canDecide(prj, bu, decision)) return;
    const apv = decision === 'approved';
    const p = modal({ title: `${apv ? 'Approve' : 'Ask for changes to'} the ${bu} part`,
      body: `<div class="field"><label>${apv ? 'What you checked' : 'What needs to change'} <span class="rl-req">required</span></label><textarea name="note" data-attest-modal placeholder="${apv ? `e.g. "I reviewed the ${esc(bu)} steps, their information and test results."` : 'What needs to change before you can approve?'}"></textarea></div>
        <div class="hint">Stored on the approval with your name and the time. Use “Review this part” to see everything in ${esc(bu)} on one screen.</div>`,
      actions: [{ id: 'go', label: apv ? 'Continue to verify' : 'Ask for changes', primary: apv, danger: !apv }] });
    guardModal(f => !String(f.note || '').trim() ? { msg: apv ? 'Write what you checked: it is stored on the approval.' : 'Say what needs to change.', field: 'note' } : null);
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
  const ovb = root.querySelector('[data-override]'); if (ovb) ovb.onclick = () => overrideLaunch(prj);
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
  if (!des.length) { toast('This project uses no information yet.'); return; }
  const p = modal({
    title: 'Request temporary data access',
    body: `<div class="field"><label>Information</label><select name="dataId">${des.map(d => `<option value="${esc(d.id)}">${esc(d.name)} — owner ${esc(pname(d.owner))}</option>`).join('')}</select></div>
      <div class="frow"><div class="field"><label>For</label><select name="env"><option value="dev">Build testing</option><option value="uat">Business testing</option></select></div>
      <div class="field"><label>Access</label><select name="access"><option value="read">Read</option><option value="write">Write</option></select></div></div>
      <div class="field"><label>Why</label><textarea name="reason" placeholder="What the work needs this information for"></textarea></div>
      <div class="field"><label>How many days</label><input type="number" name="days" value="7" min="1" max="30" inputmode="numeric"></div>
      <div class="hint">The days start when the owner approves, not when you ask: a request waiting a week still gets its full time. Only information used by this project's processes can be requested. The owner approves with an extra sign-in check.</div>`,
    actions: [{ id: 'send', label: 'Send request', primary: true }],
  });
  guardModal(f => {
    if (!f.reason || !f.reason.trim()) return { msg: 'Say why, so the owner can decide.', field: 'reason' };
    const n = String(f.days || '').trim();
    if (!/^\d+$/.test(n) || +n < 1 || +n > 30) return { msg: 'Days must be a whole number from 1 to 30. Access is always temporary.', field: 'days' };
    return null;
  });
  const r = await p;
  if (r.action !== 'send') return;
  const f = r.form;
  const de = store.get('dataElement', f.dataId);
  const id = store.newId('grt'); const me = store.state.me;
  await store.save('grant', id, { id, projectId: prj.id, dataId: f.dataId, env: f.env, access: f.access, reason: f.reason.trim(), requestedBy: me, status: 'requested', durationDays: +f.days, log: [{ at: new Date().toISOString(), by: me, action: `requested ${f.access} access for ${envPlain(f.env).toLowerCase()} for ${+f.days} days from approval` }] },
    `Requested ${f.access} access to ${de ? de.name : f.dataId} (${envPlain(f.env).toLowerCase()}) for ${prj.name}`);
  const appr = de ? grantApprover({ requestedBy: me }, de, prj) : null;
  if (appr) await store.notify([appr], `${pname(me)} asked for ${f.access} access to ${de.name} (${envPlain(f.env).toLowerCase()}) for ${prj.name}${appr !== de.owner ? ' (you approve: the owner asked for it)' : ''}`, 'grant:' + id);
  toast('Access requested. ' + (appr ? pname(appr) + ' has been told.' : 'Nobody else can approve it.'));
}

async function grantAction(prj, gid, act) {
  const g = store.get('grant', gid); if (!g) return;
  const de = store.get('dataElement', g.dataId) || { name: g.dataId };
  const me = store.state.me;
  const approver = grantApprover(g, de, prj);
  if ((act === 'approve' || act === 'deny') && approver !== me) { toast(approver ? `Only ${pname(approver)} can decide this request. Nobody approves their own access.` : 'Nobody else can approve this request.'); return; }
  let status, verb, expires = null;
  if (act === 'approve') {
    if (!(await signIn(`approve ${g.access} access to ${de.name}`))) { toast('Extra sign-in check not completed. Access not granted.'); return; }
    expires = addDays(store.state.today, grantDays(g));
    status = 'active'; verb = `approved (extra sign-in check); access open until ${fmt(expires)}`;
  } else if (act === 'deny') { status = 'denied'; verb = 'denied'; }
  else {
    const r = await modal({ title: 'Remove access?', body: `<p style="margin:0">${esc(de.name)} · ${esc(envPlain(g.env))} · ${esc(g.access)}. Access ends immediately.</p>`, actions: [{ id: 'revoke', label: 'Remove access', danger: true }] });
    if (r.action !== 'revoke') return; status = 'revoked'; verb = 'removed access';
  }
  const next = Object.assign({}, g, { status, log: [...(g.log || []), { at: new Date().toISOString(), by: me, action: verb }] });
  if (act === 'approve') { next.approvedBy = me; next.approvedAt = new Date().toISOString(); next.expires = expires; }
  await store.save('grant', gid, next, `Access to ${de.name} (${envPlain(g.env).toLowerCase()}) ${verb}`);
  if (act !== 'revoke' || g.requestedBy !== me) await store.notify([g.requestedBy], `${pname(me)} ${verb.split(' ')[0]} your ${g.access} access to ${de.name}`, 'grant:' + gid);
  toast(`Access ${GRANT_TXT[status] || status}`);
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
  return `<div class="rl-failbn" data-rollback-failed><div><b>The undo did not go through: its pipeline failed.</b><span class="sim">Simulated pipeline</span>
      <div class="rl-noeffect-b" data-no-side-effects><b>Nothing was restored.</b> The launched versions are still live and the procedure was not re-published. Only the launch owner was told.</div>
      <div class="hint">${esc(pipeError(rel))}</div></div>
    ${canRollback(prj) ? '<button class="btn danger" data-rollback>Try the undo again</button>' : `<span class="hint" data-why="rm">Only the launch owner (${esc(pname(rmOf(prj)))}) can try again.</span>`}</div>`;
}

/* R6 hypercare: days remaining and owner from the cutover plan, plus an incident log on project.incidents.
   An open severity-1 incident suggests a rollback. */
/* R8: only the support owner, the project manager or the launch owner can resolve a problem after launch. */
const incResolvers = prj => [...new Set([((prj && prj.cutover) || {}).hypercareOwner, prj && prj.owner, rmOf(prj)].filter(Boolean))];
const canResolveInc = prj => !!store.state.me && incResolvers(prj).includes(store.state.me);
const SEV = { 1: 'Critical: work has stopped', 2: 'Major: a workaround is needed', 3: 'Minor', 4: 'Cosmetic' };
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
  return `<div class="card rl-hc" id="hypercare" data-hypercare><h3 title="Hypercare">Support after launch<span class="n" data-hc-left="${left}">${total ? (left ? `${left} of ${total} day${total === 1 ? '' : 's'} left` : 'ended') : 'no period set'}</span></h3>
    <div class="rl-hc-h"><span class="lbl">Who handles problems</span>${c.hypercareOwner ? `${av(c.hypercareOwner)} <b>${esc(pname(c.hypercareOwner))}</b>` : '<b class="rl-noown">Not set</b>'}
      <span class="hint">Live since ${esc(fmt(since))}. Report anything that goes wrong after launch here; the support owner looks at it.</span></div>
    ${total ? `<div class="rl-rbar" aria-label="${left} days of support left"><i style="width:${Math.round(100 * Math.min(total, elapsed) / total)}%"></i></div>` : ''}
    ${sev1.length ? `<div class="rl-sev1" data-consider-rollback><span class="rl-ic fail">!</span><div><b>Consider undoing the launch.</b> ${sev1.length} open critical problem${sev1.length === 1 ? '' : 's'}: ${sev1.map(x => esc(x.title)).join(' · ')}.
      <div class="hint">${canRollback(prj) ? 'You are the launch owner: you can undo the launch.' : `Only the launch owner (${esc(pname(rmOf(prj)))}) can undo the launch.`}</div></div>${canRollback(prj) ? '<button class="btn sm danger" data-rollback-hc>Undo the launch…</button>' : ''}</div>` : ''}
    <div class="rl-inc-form" data-incident-form><input data-inc-title placeholder="What went wrong? e.g. Approver emails not sent" aria-label="What went wrong" value="${esc(f.title || '')}">
      <select data-inc-sev aria-label="How bad is it">${[1, 2, 3, 4].map(n => `<option value="${n}" ${String(f.sev || 3) === String(n) ? 'selected' : ''}>${SEV[n]}</option>`).join('')}</select>
      <button class="btn sm primary" data-inc-add>Report a problem</button></div>
    <div class="rl-err" data-inc-err role="alert" hidden></div>
    <div class="rl-incs">${inc.map(x => `<div class="rl-inc ${x.status === 'resolved' ? 'done' : ''}" data-incident="${esc(x.id)}" data-sev="${esc(x.severity)}">
      ${badge(SEV[x.severity] || 'Level ' + x.severity, +x.severity === 1 ? 'b-late' : +x.severity === 2 ? 'b-soon' : 'b-idle')}
      <div class="rl-inc-t"><b>${esc(x.title)}</b><small>${esc(pname(x.by))} · ${esc(fmtTime(x.at))}${x.status === 'resolved' && x.resolvedBy ? ` · resolved by ${esc(pname(x.resolvedBy))}` : ''}</small></div>
      ${badge(x.status === 'resolved' ? 'resolved' : 'open', x.status === 'resolved' ? 'b-done' : 'b-late')}
      ${x.status !== 'resolved' && canResolveInc(prj) ? `<button class="btn sm" data-inc-resolve="${esc(x.id)}">Resolve</button>` : ''}</div>`).join('') || '<div class="hint">No problems reported.</div>'}</div>
    ${open.length && !canResolveInc(prj) ? `<div class="hint" data-why="inc-resolve">Only ${esc(incResolvers(prj).map(pname).join(', ').replace(/, ([^,]*)$/, ' or $1'))} can mark a problem resolved.</div>` : ''}</div>`;
}
async function addIncident(prj, root) {
  const t = root.querySelector('[data-inc-title]'); const sev = +root.querySelector('[data-inc-sev]').value; const err = root.querySelector('[data-inc-err]');
  const title = t.value.trim();
  if (!title) { err.hidden = false; err.textContent = 'Say what went wrong in a few words.'; t.setAttribute('aria-invalid', 'true'); t.focus(); return; }
  const cur = store.get('project', prj.id) || prj;
  const x = { id: store.newId('inc'), title, severity: sev, at: new Date().toISOString(), by: store.state.me, status: 'open' };
  delete ui.incident[prj.id];
  await store.save('project', prj.id, Object.assign({}, cur, { incidents: (cur.incidents || []).concat([x]) }), `Reported a problem after launch (${SEV[sev]}): ${title}`);
  const owner = (cur.cutover || {}).hypercareOwner;
  await store.notify([owner, sev === 1 ? rmOf(cur) : null], `${pname(store.state.me)} reported a problem after launch on ${cur.name} (${SEV[sev]}): ${title}`, 'project:' + prj.id);
  toast(sev === 1 ? 'Critical problem reported. Consider undoing the launch.' : 'Problem reported');
}
async function resolveIncident(prj, id) {
  const cur = store.get('project', prj.id) || prj;
  const x = (cur.incidents || []).find(i => i.id === id); if (!x) return;
  if (!canResolveInc(cur)) { toast(`Only ${incResolvers(cur).map(pname).join(', ')} can resolve problems after launch.`); return; }
  await store.save('project', prj.id, Object.assign({}, cur, { incidents: cur.incidents.map(i => i.id === id ? Object.assign({}, i, { status: 'resolved', resolvedBy: store.state.me, resolvedAt: new Date().toISOString() }) : i) }), `Resolved a problem after launch: ${x.title}`);
  toast('Problem resolved');
}

function failBanner(prj, rel) {
  const err = pipeError(rel);
  const rm = rmOf(prj);
  return `<div class="rl-failbn" data-pipeline-failed><div><b>The launch did not go through: the delivery pipeline failed.</b><span class="sim">Simulated pipeline</span>
      <div class="rl-noeffect-b" data-no-side-effects><b>Nothing was promoted or published.</b> The process versions, the procedure and temporary data access are exactly as they were, and only the launch owner was told.</div>
      <div class="hint">${esc(err)}</div></div>
    ${store.state.me === rm ? `<button class="btn primary" data-retry ${readiness(prj.id).pass && !gngOpen(prj).length && launchGuard(prj).ok ? '' : 'disabled'}>Try the launch again</button>` : `<span class="hint" data-why="rm">Only the launch owner (${esc(pname(rm))}) can try again.</span>`}</div>`;
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
  toast(p.fail ? (rb ? 'The undo failed (simulated). Nothing was restored.' : 'The launch failed (simulated). Nothing was changed.') : (rb ? 'Launch undone (simulated)' : 'Launched (simulated)'));
}
/* The release the server just wrote: from the response, else the newest for the project. */
function newestRelease(prj, res) {
  const rel = (res && (res.release || (res.data && res.data.projectId ? res.data : null) || (res.projectId ? res : null))) || null;
  const latest = store.list('release', x => x.projectId === prj.id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  return (rel && rel.id && store.get('release', rel.id)) || rel || latest || null;
}
const SIMFAIL = (what, after) => `<label class="rl-simfail"><input type="checkbox" name="simfail" value="1" data-simfail> <span><b>Simulate failure</b><small>The simulated delivery step fails. The failed ${what} is recorded${after ? `, and ${after}` : ''}. Nothing else changes.</small></span></label>`;

/* R9 §13: Advanced keeps "Override with reason": the reason is required and logged in History before launching. */
async function overrideLaunch(prj) {
  const rm = rmOf(prj);
  if (store.state.me !== rm) { toast(`Only the launch owner (${pname(rm)}) can override.`); return; }
  const g = launchGuard(prj);
  const p = modal({ title: 'Override the launch guard', body: `<p style="margin:0 0 8px">Launch now is locked: ${esc(joinAnd(g.why))}.</p>
      <div class="field"><label>Why launch anyway? <span class="rl-req">required</span></label><textarea name="reason" data-override-reason placeholder="e.g. The window was moved up by the steering group on Nov 3"></textarea></div>
      <div class="hint">Your reason is saved in the project's History with your name and the time.</div>`,
    actions: [{ id: 'go', label: 'Override and continue', danger: true }] });
  guardModal(f => !String(f.reason || '').trim() ? { msg: 'Say why you are overriding: it is logged.', field: 'reason' } : null);
  const r = await p; if (r.action !== 'go') return;
  const reason = String(r.form.reason || '').trim();
  const cur = store.get('project', prj.id) || prj;
  const ov = { by: store.state.me, at: new Date().toISOString(), reason, guard: g.why };
  await store.save('project', prj.id, Object.assign({}, cur, { launchOverride: ov, launchOverrides: (cur.launchOverrides || []).concat([ov]) }), `Overrode the launch guard (${g.why.join('; ')}): “${reason}”`);
  await goLive(store.get('project', prj.id) || cur, false, ov);
}

async function goLive(prj, retry, override) {
  const rm = rmOf(prj);
  if (store.state.me !== rm) { toast(`Only the launch owner (${pname(rm)}) can launch.`); return; }
  const rd = readiness(prj.id);
  if (!rd.pass) { toast('Not ready to launch yet.'); return; }
  const lg = launchGuard(prj);
  if (!lg.ok && !override) { toast(`Not yet: ${joinAnd(lg.why)}.`); return; }
  const procs = projectProcesses(prj);
  const sections = buSections(prj);
  const approvers = [...new Set(sections.map(s => latestApproval(prj.id, s.bu)).filter(a => counts(prj, a)).map(a => a.approver))];
  const openGrants = store.list('grant', g => g.projectId === prj.id && ['active', 'approved'].includes(grantStatus(g))).length;
  const excs = cycleExceptions(prj);
  const tasks = tasksOf(prj.cutover);
  const gOpen = gngOpen(prj);
  const simple = !store.advanced;
  /* the launch-day steps as a plain table: every step keeps its owner's name */
  const rbRows = tasks.map((t, i) => `<tr data-gl-task="${esc(t.id)}" class="${t.gonogo ? 'gng' : ''}"><td>${i + 1}</td><td>${esc(t.task)}${t.gonogo ? ` <span class="rl-gng">${GNG()}</span>` : ''}</td>
    <td data-gl-owner="${esc(t.owner || '')}">${t.owner ? `${av(t.owner)} ${esc(pname(t.owner))}` : '<b class="rl-noown">No owner</b>'}</td>
    <td>${t.gonogo ? (t.done ? `<span class="rl-ok">Confirmed by ${esc(pname(t.doneBy || t.owner))}</span>` : '<b class="rl-noown">Not confirmed</b>') : t.done ? 'Done' : esc(fmtPlanned(startOf(t)))}${overdue(t) ? ' <span class="badge b-late">Overdue</span>' : ''}</td></tr>`).join('');
  const body = simple
    ? `<p style="margin:0 0 8px">When you launch:</p><ul class="rs-what" data-golive-what>
        <li>The new way of working replaces today’s for ${procs.map(p => `<b>${esc(p.name)}</b>`).join(', ')}.</li>
        <li>Temporary data access closes${openGrants ? ` (${openGrants} open)` : ''}.</li>
        <li>The new procedure is published and everyone involved is told.</li></ul>
      <div class="hint">If the delivery step fails, nothing changes and you can try again.</div>
      <div class="rl-gl-rb" data-golive-runbook hidden style="display:none">${rbRows ? `<table><tbody>${rbRows}</tbody></table>` : ''}</div>
      ${SIMFAIL('launch')}`
    : `<div class="rl-sum">
      <div><span class="lbl">Launch owner</span><div>${av(rm)} ${esc(pname(rm))}</div></div>
      <div><span class="lbl">Processes updated if the pipeline succeeds</span>${procs.map(p => `<div>${esc(p.name)} <b>v${esc(p.version || 1)} → v${esc((p.version || 1) + 1)}</b></div>`).join('')}</div>
      <div><span class="lbl">Approved by</span>${approvers.map(id => `<div>${av(id)} ${esc(pname(id))}</div>`).join('')}</div>
      <div><span class="lbl">Temporary data access</span><div>${openGrants} open access${openGrants === 1 ? '' : 'es'} will close if the pipeline succeeds</div></div>
      <div><span class="lbl">Approved again after changes</span><div>${excs.length ? `${excs.length} change${excs.length === 1 ? '' : 's'} made after an approval, then approved again` : 'None'}</div></div>
      <div><span class="lbl">What happens</span><div>Run the delivery pipeline, then update the processes, publish the new procedure, close temporary data access and tell everyone involved</div></div></div>
      <div class="rl-gl-rb" data-golive-runbook>${tasks.length ? `<div class="rl-rb-h"><b>Launch-day steps</b><span class="hint">${gngOf(prj).length - gOpen.length}/${gngOf(prj).length} ${GNG()} confirmed</span></div>
        <div class="tbl-wrap"><table class="rl-gltbl"><thead><tr><th>#</th><th>Step</th><th>Who</th><th>Status</th></tr></thead><tbody>${rbRows}</tbody></table></div>` : '<div class="hint">No launch-day steps.</div>'}
        ${gOpen.length ? `<div class="rl-err" data-gng-block>Launch is blocked until every final check has an owner who has confirmed it.</div>` : ''}</div>
      ${SIMFAIL('launch', 'nothing is promoted or published; temporary data access stays as it is')}
      <span class="sim">Simulated: in this showroom the pipeline request is recorded, not sent, and its run is animated.</span>`;
  const r = modal({ title: `${retry ? 'Try again: launch' : 'Launch'} ${prj.name}`, body, actions: [{ id: 'go', label: simple ? 'Launch' : 'Continue to verify', primary: true }] });
  guardModal(() => gngOpen(store.get('project', prj.id) || prj).length ? 'Every final check must be confirmed by its owner before launch.' : null);
  const res0 = await r;
  if (res0.action !== 'go') return;
  const fail = (res0.form.simfail || []).includes('1');
  if (!(await signIn('launch ' + prj.name))) { toast('Extra sign-in check not completed. Nothing was launched.'); return; }
  ui.pipeStart = prj.id;
  try {
    const res = await store.api('/golive/' + prj.id, Object.assign({ simulateFailure: fail, stepUp: { method: 'simulated-mfa', at: new Date().toISOString() } }, override ? { override } : {}));
    ui.reasons = null;
    await store.load();
    const rel = newestRelease(prj, res);
    ui.lastRelease = rel ? rel.id : null;
    const failed = !!(res && res.failed) || failedAny(rel);
    ui.pipeStart = null;
    if (rel) startPipeline(prj, rel.id, failed, 'golive'); else store.emit();
    toast(failed ? `${prj.name}: launch started (simulated)` : `${prj.name} is launching (simulated)`);
  } catch (e) {
    ui.pipeStart = null;
    if (e.status === 409 || e.status === 403) { ui.reasons = (e.body && e.body.reasons && e.body.reasons.length) ? e.body.reasons : [e.message || `Only the launch owner (${pname(rm)}) can launch.`]; store.emit(); toast(e.status === 403 ? 'Launch refused: only the launch owner can launch.' : 'Launch refused. See the reasons on the page.'); }
    else toast('Launch failed: ' + e.message);
  }
}

/* R6: undoing a launch runs a pipeline too, with the same success/failure handling. */
async function rollBack(prj) {
  const rm = rmOf(prj);
  if (!canRollback(prj)) { toast(`Only the launch owner (${pname(rm)}) can undo the launch.`); return; }
  const procs = projectProcesses(prj);
  const r = await modal({
    title: `Undo the launch of ${prj.name}?`,
    body: `<p style="margin:0 0 8px">The undo runs through the delivery pipeline first. Only if that works do we bring back the previous version of each process as today’s, re-publish the previous procedure and set the project back to active. The launched version stays in the history.</p>
      <div class="rl-sum"><div><span class="lbl">Processes brought back</span>${procs.map(p => `<div>${esc(p.name)} <b>v${esc(p.version || 1)} → v${esc(Math.max(1, (p.version || 1) - 1))}</b></div>`).join('')}</div>
      <div><span class="lbl">Undo plan</span><div>${esc((prj.cutover || {}).rollbackPlan || 'No plan written')}</div></div></div>
      <div class="field" style="margin-top:10px"><label>Why</label><textarea name="reason" placeholder="What went wrong?"></textarea></div>
      ${SIMFAIL('undo', 'the launch stays live')}`,
    actions: [{ id: 'rollback', label: 'Continue to verify', danger: true }],
  });
  if (r.action !== 'rollback') return;
  const fail = (r.form.simfail || []).includes('1');
  if (!(await signIn('undo the launch'))) { toast('Extra sign-in check not completed. Nothing was undone.'); return; }
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
    toast(failed ? `${prj.name}: undo started (simulated)` : `${prj.name}: undoing the launch (simulated)`);
  } catch (e) {
    ui.pipeStart = null;
    if (e.status === 403 || e.status === 409) { ui.reasons = (e.body && e.body.reasons && e.body.reasons.length) ? e.body.reasons : [e.message || `Only the launch owner (${pname(rm)}) can undo the launch.`]; store.emit(); }
    toast('Undo refused: ' + e.message);
  }
}

/* R7 "Extra sign-in check" (simulated step-up) in plain words. In production this is a Microsoft Entra
   Conditional Access authentication-context challenge, checked by the in-tenant API. */
export async function signIn(actionLabel, attempt) {
  attempt = attempt || 1;
  const r = await modal({
    title: 'Extra sign-in check',
    /* R9 §7: Simple shows one field, "Enter the 6-digit code from your phone"; Advanced also names the action */
    body: `${attempt > 1 ? '<div class="banner" style="margin:0">That code wasn’t 6 digits. Try again.</div>' : ''}${store.advanced ? `<p style="margin:0">To <b>${esc(actionLabel)}</b>, confirm it’s you.</p>` : ''}
      <div class="field"><label for="rs-code">Enter the 6-digit code from your phone</label><input id="rs-code" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="Any 6 digits in this demo" maxlength="6" /></div>
      <span class="sim">Demo: any 6 digits work. In the product this is your organisation's own sign-in check.</span>`,
    actions: [{ id: 'verify', label: 'Verify', primary: true }],
  });
  if (r.action !== 'verify') return false;
  if (/^\d{6}$/.test(r.form.code || '')) return true;
  return attempt < 3 ? signIn(actionLabel, attempt + 1) : false;
}
