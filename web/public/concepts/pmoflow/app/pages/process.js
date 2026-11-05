/* Process page (stream D): /process/:pid?mode=asis|tobe|diff|lanes|edit and /new.
   Vertical map ported from v2, plus a structural editor that saves the whole process doc. */
import { store } from '../store.js';
import { E, esc, fmt, fmtTime, link, go, av, personChip, pname, badge, chip, dataDot, AVAIL, LOCK, modal, toast, activityCard, bindActivity } from '../ui.js';

/* ---------- shared helpers (also used by step.js and data.js) ---------- */
export const docs = () => store.state.docs;
export const today = () => store.state.today;
/* Engine call that never takes the page down: a failure renders an empty result and logs a warning. */
export function eng(name, args, fallback) {
  try { const P = E(); if (!P || typeof P[name] !== 'function') return fallback; const r = P[name](...args); return r == null ? fallback : r; }
  catch (e) { console.warn('PMOEngine.' + name + ' failed:', e && e.message); return fallback; }
}
export const isGw = n => !!n && (n.type === 'decision' || n.type === 'parallel');
export const isStep = n => !!n && n.type !== 'trigger' && n.type !== 'end' && !isGw(n);
export function flat(nodes) {
  const out = [];
  (nodes || []).forEach(n => { if (!n) return; if (isGw(n)) (n.branches || []).forEach(b => out.push(...flat(b.nodes))); else if (isStep(n)) out.push(n); });
  return out;
}
/* every node (steps, gateways, trigger, end) in document order */
export function allNodes(nodes) { const out = []; (nodes || []).forEach(n => { if (!n) return; out.push(n); if (isGw(n)) (n.branches || []).forEach(b => out.push(...allNodes(b.nodes))); }); return out; }
/* compact SLA / system / duration line, e.g. "⏱ 2 business days · ERP · 4h" */
export function opsLine(n) {
  const parts = [n.sla ? '⏱ ' + n.sla : '', n.system || '', n.durationHrs ? n.durationHrs + 'h' : ''].filter(Boolean);
  return parts.length ? `<div class="d-ops">${esc(parts.join(' · '))}</div>` : '';
}
/* ---------- R6 node types ----------
   subprocess {calls: processId, callsName?}  calls another process; its card shows that process's step count and opens it
   wait       {wait: "2 business days"}       a timer, e.g. "Wait 2 business days for vendor response"
   message    {direction: 'send'|'receive', party: "Vendor"}  sends to / receives from an external party
   The engine treats all three as steps (they have owners, can carry data and can have work). */
const SVG = d => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const NT = {
  subprocess: { label: 'Another process', cls: 'd-nt-sub', icon: SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 9v6M9 12h6"/>') },
  wait: { label: 'Wait', cls: 'd-nt-wait', icon: SVG('<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9"/>') },
  message: { label: 'Message', cls: 'd-nt-msg', icon: SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>') },
};
export const isSpecial = n => !!n && !!NT[n.type];
export const typeLabel = n => n && NT[n.type] ? NT[n.type].label : 'Step';
/* the process a subprocess node calls, with its to-be step count */
export function calledOf(n) {
  if (!n || n.type !== 'subprocess') return null;
  const p = n.calls ? store.get('process', n.calls) : null;
  return p ? { p, steps: flat(p.tobe).length } : { p: null, steps: 0, name: n.callsName || '' };
}
/* R9 §11: "Wait up to 2 business days" (a duration) or "Wait for the supplier's quote" (an event); never "WAIT · 2" */
export function waitText(n) {
  const w = String((n && n.wait) || '').trim().replace(/^(wait\s+)?(up to|for|until)\s+/i, '');
  if (!w) return 'Wait for a set time';
  return /^(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(w) ? 'Wait up to ' + w : 'Wait for ' + w;
}
/* the kicker under a typed node's title: what kind it is, in words, with no bare number */
const kickerOf = n => n.type === 'wait' ? 'Wait' : n.type === 'message' ? msgText(n) : NT[n.type] ? NT[n.type].label : 'Step';
export const msgText = n => `${n.direction === 'receive' ? 'Receives from' : 'Sends to'} ${n.party || 'an external party'}`;
/* one-line description of a typed node (cards, ghosts, lanes, step page) */
export function typeDetail(n) {
  if (!isSpecial(n)) return '';
  if (n.type === 'wait') return waitText(n);
  if (n.type === 'message') return msgText(n);
  const c = calledOf(n);
  return c && c.p ? `Calls ${c.p.name} · ${c.steps} step${c.steps === 1 ? '' : 's'}` : `Calls ${c && c.name ? c.name + ' (not in this workspace)' : 'no process yet'}`;
}
/* the card body line for a typed node; the subprocess line carries its "Open" drill-in */
function typeBody(n, ctx) {
  if (n.type === 'wait') return `<div class="d-ntline" data-wait><span>${esc(waitText(n))}</span></div>`;
  if (n.type === 'message') return `<div class="d-ntline" data-msg="${n.direction === 'receive' ? 'receive' : 'send'}"><span class="d-dir">${n.direction === 'receive' ? '⇠ Receives from' : 'Sends to ⇢'}</span><span class="chip d-party">${esc(n.party || 'External party')}</span></div>`;
  const c = calledOf(n);
  if (c && c.p) return `<div class="d-ntline" data-calls="${esc(c.p.id)}"><span>Calls <b>${esc(c.p.name)}</b></span><span class="d-subn" data-sub-steps="${c.steps}">${c.steps} step${c.steps === 1 ? '' : 's'}</span>${ctx && ctx.edit ? '' : `<a class="btn sm d-open" href="${link('/process/' + c.p.id)}" data-link data-open-sub aria-label="Open ${esc(c.p.name)}">Open ›</a>`}</div>`;
  return `<div class="d-ntline"><span class="hint">Calls ${c && c.name ? esc(c.name) + ' (not in this workspace)' : 'no process yet'}</span></div>`;
}
/* case-insensitive duplicate check for data element names; returns the clashing element or null */
export function dupDataName(name, exceptId, extra) {
  const k = String(name || '').trim().toLowerCase(); if (!k) return null;
  return [...store.list('dataElement'), ...(extra || [])].find(d => d.id !== exceptId && String(d.name || '').trim().toLowerCase() === k) || null;
}
export const dataEl = id => store.get('dataElement', id);
export const dataName = id => (dataEl(id) || {}).name || id;
/* Effective availability (R3): the data element is the single source of truth.
   'live' if avail is live or its resolver work item is done; otherwise 'example' or 'missing'. */
export function effAvail(id) {
  const r = eng('effectiveAvail', [docs(), id], null);
  if (r === 'live' || r === 'example' || r === 'missing' || r === 'pending' || r === 'problem') return r;
  const d = dataEl(id); if (!d) return 'missing';
  if (d.avail === 'live' || (d.liveConfirmedBy && d.liveConfirmedBy === d.owner && d.liveSource)) return 'live';
  if (store.list('workItem', w => w.resolves === id && w.status === 'done').length) return 'pending';
  return d.avail === 'example' ? 'example' : 'missing';
}
export const availOf = effAvail;
/* R7 §2: plain availability words. One label per state on every page: Connected / Sample only / Not available yet /
   Waiting for confirmation. The engine's availLabel decides when it exists; these are the fallback. */
export const AV = {
  live: { label: 'Connected', short: 'Connected', color: 'var(--live)' },
  example: { label: 'Sample only', short: 'Sample only', color: 'var(--example)' },
  missing: { label: 'Not available yet', short: 'Not available yet', color: 'var(--missing)' },
  pending: { label: 'Waiting for confirmation', short: 'Waiting for confirmation', color: 'var(--soon)' },
  /* R9 §6: information with an open problem is never "We have it" */
  problem: { label: 'Has a problem', short: 'Has a problem', color: 'var(--soon)' },
};
export const avOf = k => AV[k] || AV.missing;
const LBL_KEY = { connected: 'live', 'we have it': 'live', 'sample only': 'example', 'not available yet': 'missing', 'waiting for confirmation': 'pending', 'has a problem': 'problem' };
/* R7: Simple is the default; Advanced shows the power tools */
export const isAdv = () => !!store.advanced;
/* R8 §1: Simple has two states only. "We have it" (effectively live) and "Not available yet" (everything else).
   The words connected / waiting for confirmation / sample only are Advanced-only detail. */
export const HAVE = 'We have it', NOTYET = 'Not available yet', PROBLEM = 'Has a problem';
export const SIMPLE_AV = { live: { label: HAVE, color: 'var(--live)' }, notyet: { label: NOTYET, color: 'var(--missing)' } };
/* {key, label, tone, simple} for a data element. key is the detailed state (live/example/missing/pending);
   label is the plain label for the current mode. The engine's availLabel decides when it gives a usable answer. */
export function availInfo(id) {
  const r = eng('availLabel', [docs(), id, { advanced: isAdv() }], null);
  const k0 = effAvail(id);
  let key = k0, label = avOf(k0).label, tone = '';
  if (r && typeof r === 'object' && (r.label || r.key)) {
    key = AV[r.state] ? r.state : AV[r.key] ? r.key : LBL_KEY[String(r.label || '').toLowerCase()] || k0;
    label = r.label || avOf(key).label; tone = r.tone || '';
  }
  const simple = key === 'live' ? HAVE : key === 'problem' ? PROBLEM : NOTYET;
  return { key, label: isAdv() ? label : simple, tone, simple, have: key === 'live' };
}
export const avText = id => availInfo(id).label;
/* the owner still has to say "we have it" (a fix finished by someone else, or information the project adds) */
export const awaitingText = id => { const d = dataEl(id); const who = d && d.owner ? pname(d.owner) : 'the owner';
  return isAdv() ? `Waiting for ${who} to confirm it's connected` : `Fixed. ${who} needs to confirm we have it`; };
/* dot coloured by the plain state (two colours in Simple) */
export function effDot(id) { const i = availInfo(id), a = isAdv() || i.key === 'problem' ? avOf(i.key) : SIMPLE_AV[i.have ? 'live' : 'notyet']; return `<span class="dot" style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${a.color}" title="${esc(i.label)}" aria-hidden="true"></span>`; }
export const NEEDS_LIVE_ADV = 'Needs to be connected before launch';
/* kept as a constant for the pages that import it; reads plainly in Simple */
export const NEEDS_LIVE = NEEDS_LIVE_ADV;
export const needsLive = () => isAdv() ? NEEDS_LIVE_ADV : 'Needed before launch';
/* R7 §4: who does a step — a person, or a free-text role stored as ownerRole */
/* R9 §13: never a raw id or a dash: an unknown or missing person reads "Nobody yet" */
export const personName = id => { const p = id && store.person(id); return p ? p.name : 'Nobody yet'; };
/* R9 §8: who owns a piece of information, in words: its role, its person, or "Nobody yet" (never "—") */
export const dataOwnerName = x => { const r = x && x.id ? eng('dataOwner', [docs(), x.id], null) : null; const n = r && (r.role || (r.person ? r.name : '')); return n ? n : (x && x.ownerRole) || personName(x && x.owner); };
export const whoOf = n => (n && n.ownerRole) ? n.ownerRole : personName(n && n.owner);
export const whoAv = n => (n && n.ownerRole) ? '' : av(n && n.owner);
/* R8 §8: the same words for "who does it" wherever a step shows (a role reads exactly as typed on the map) */
export const whoChip = n => n && n.ownerRole ? `<span class="person d-role" data-who data-role>${esc(n.ownerRole)}</span>` : n && n.owner ? `<span class="person" data-who>${av(n.owner)}${esc(pname(n.owner))}</span>` : '';
/* R5: process editors are the owner plus the resources; everyone else is read-only */
export const canEditProc = p => !!p && !!store.state.me && (p.owner === store.state.me || (p.resources || []).includes(store.state.me));
export const askAccess = p => `Ask ${pname(p && p.owner)} for edit access`;
/* R5: where a data element is used, to-be and as-is counted separately. One source (engine usageOf) for every count shown. */
function normUse(list) { return (Array.isArray(list) ? list : []).map(u => ({ pid: u.pid || u.processId, stepId: u.stepId || u.step || u.sid })).filter(u => u.pid && u.stepId); }
export function usage(did, pid) {
  let r = eng('usageOf', [docs(), did], null);
  let out;
  if (r && (Array.isArray(r.tobeSteps) || Array.isArray(r.asisSteps))) out = { tobe: normUse(r.tobeSteps), asis: normUse(r.asisSteps) };
  else { /* fallback: scan the maps directly */
    out = { tobe: [], asis: [] };
    store.list('process').forEach(p => ['tobe', 'asis'].forEach(k => flat(p[k]).forEach(s => { if ((s.data || []).includes(did) || (s.subs || []).some(x => (x.data || []).includes(did))) out[k].push({ pid: p.id, stepId: s.id }); })));
  }
  if (pid) { out.tobe = out.tobe.filter(u => u.pid === pid); out.asis = out.asis.filter(u => u.pid === pid); }
  return out;
}
export const usageText = u => `${u.tobe.length} Future · ${u.asis.length} Today`;

/* ---------- R6 §6: cross-process impact of one to-be step ----------
   shared:    every other to-be step (any process) that uses the same data, with the projects that have open work there
   projects:  every project with open work on this step
   conflicts: 'conflict' (red) when two or more active projects have open work on this step;
              'overlap' (amber) when another active project changes a step sharing this step's data, or resolves its data,
              while a different project is changing this step */
const openWorkOn = (pid, sid) => store.list('workItem', w => w.pid === pid && w.step === sid && w.status !== 'done');
function byProject(items) {
  const m = {}; items.forEach(w => (m[w.projectId] = m[w.projectId] || []).push(w));
  return Object.entries(m).map(([id, list]) => ({ prj: store.get('project', id), items: list })).filter(x => x.prj);
}
export function stepImpact(pid, sid) {
  const p = store.get('process', pid); const s = p && flat(p.tobe).find(x => x.id === sid);
  if (!s) return null;
  const data = [...new Set([...(s.data || []), ...(s.subs || []).flatMap(x => x.data || [])])];
  const sh = {};
  data.forEach(d => usage(d).tobe.forEach(u => { if (u.pid === pid && u.stepId === sid) return; const k = u.pid + '/' + u.stepId; (sh[k] = sh[k] || { pid: u.pid, stepId: u.stepId, data: [] }).data.push(d); }));
  const shared = Object.values(sh).map(x => { const pp = store.get('process', x.pid); const ss = pp && flat(pp.tobe).find(y => y.id === x.stepId); return ss ? Object.assign(x, { p: pp, s: ss, data: [...new Set(x.data)], projects: byProject(openWorkOn(x.pid, x.stepId)) }) : null; }).filter(Boolean)
    .sort((a, b) => (a.pid === pid ? 0 : 1) - (b.pid === pid ? 0 : 1) || String(a.p.name).localeCompare(String(b.p.name)));
  const projects = byProject(openWorkOn(pid, sid));
  const active = j => !!j && j.status !== 'live';
  const here = projects.filter(x => active(x.prj)), hereIds = new Set(here.map(x => x.prj.id));
  const conflicts = [];
  if (here.length >= 2) conflicts.push({ level: 'conflict', kind: 'same-step', projects: here.map(x => x.prj.id), text: `${here.length} active projects have open work on this step (${here.map(x => x.prj.name).join(', ')}). Agree the order of changes before either goes live.` });
  if (here.length) {
    shared.forEach(x => x.projects.filter(y => active(y.prj) && !hereIds.has(y.prj.id)).forEach(y => conflicts.push({ level: 'overlap', kind: 'shared-data', projects: [y.prj.id], pid: x.pid, stepId: x.stepId,
      text: `${y.prj.name} is also changing “${x.s.title}” (${x.p.name}), which shares ${x.data.map(dataName).join(', ')}.` })));
    const seen = new Set();
    store.list('workItem', w => w.resolves && data.includes(w.resolves) && w.status !== 'done' && !hereIds.has(w.projectId)).forEach(w => {
      const j = store.get('project', w.projectId); if (!active(j) || seen.has(j.id + w.resolves)) return; seen.add(j.id + w.resolves);
      conflicts.push({ level: 'overlap', kind: 'resolver', projects: [j.id], text: `${j.name} is resolving ${dataName(w.resolves)}, which this step needs (“${w.title}”).` });
    });
  }
  return { s, data, shared, projects, conflicts, status: conflicts.some(c => c.level === 'conflict') ? 'conflict' : conflicts.length ? 'overlap' : 'clear' };
}
export const IMPACT = { conflict: { label: 'Conflict', cls: 'b-late' }, overlap: { label: 'Overlap', cls: 'b-soon' }, clear: { label: 'No conflicts', cls: 'b-done' } };
export const impactBadge = st => `<span class="badge ${IMPACT[st].cls}" data-impact-badge="${st}">${esc(IMPACT[st].label)}</span>`;
function impactHTML(p) {
  const rows = flat(p.tobe).map(s => stepImpact(p.id, s.id)).filter(Boolean);
  if (!rows.length) return '<div class="empty">No Future steps yet. Add steps to the Future version to see who they affect.</div>';
  const n = k => rows.filter(r => r.status === k).length;
  const prjs = new Set(rows.flatMap(r => r.projects.map(x => x.prj.id)));
  const shareN = rows.filter(r => r.shared.length).length;
  return `<div class="d-impact" data-impact-tab>
    <div class="d-impsum d-impkpis" data-impact-sum="${n('conflict')}/${n('overlap')}/${shareN}/${prjs.size}"><span><b class="${n('conflict') ? 'fail' : ''}">${n('conflict')}</b> step${n('conflict') === 1 ? '' : 's'} in conflict</span><span><b>${n('overlap')}</b> overlap${n('overlap') === 1 ? '' : 's'}</span><span><b>${shareN}</b> of ${rows.length} steps share information</span><span><b>${prjs.size}</b> project${prjs.size === 1 ? '' : 's'} with open work</span></div>
    <div class="tbl-wrap"><table class="d-imptbl"><tr><th>Step</th><th>Shares information with</th><th>Projects with open work</th><th>Status</th></tr>
    ${rows.map(r => { const procs = new Set(r.shared.map(x => x.pid)).size; return `<tr class="click" data-go="/process/${esc(p.id)}/step/${esc(r.s.id)}" data-impact-row="${esc(r.s.id)}" data-impact-status="${r.status}">
      <td><a href="${link('/process/' + p.id + '/step/' + r.s.id)}" data-link><b>${esc(r.s.title)}</b></a>${isSpecial(r.s) ? ` <span class="chip d-ntchip">${esc(typeLabel(r.s))}</span>` : ''}</td>
      <td data-shared-n="${r.shared.length}">${r.shared.length ? `<b>${r.shared.length}</b> step${r.shared.length === 1 ? '' : 's'} in ${procs} process${procs === 1 ? '' : 'es'}<div class="hint">${esc(r.shared.slice(0, 3).map(x => x.s.title).join(', '))}${r.shared.length > 3 ? ` +${r.shared.length - 3}` : ''}</div>` : '<span class="hint">No shared information</span>'}</td>
      <td data-prj-n="${r.projects.length}">${r.projects.length ? r.projects.map(x => `<span class="chip">${esc(x.prj.name)} · ${x.items.length}</span>`).join(' ') : '<span class="hint">None</span>'}</td>
      <td>${impactBadge(r.status)}${r.conflicts.length ? `<div class="hint">${esc(r.conflicts[0].text)}${r.conflicts.length > 1 ? ` +${r.conflicts.length - 1} more` : ''}</div>` : ''}</td></tr>`; }).join('')}</table></div></div>`;
}
/* R5: evidence behind a live confirmation. Attested (link + note) is the weaker kind. */
export const EVID = { profile: { label: 'Sample data check', long: 'Latest sample data check, nothing blocking', cls: 'd-ev-ok' }, check: { label: 'Connection check', long: 'Connection check passed', cls: 'd-ev-ok' }, attested: { label: 'Link and note', long: 'Link and note (weaker proof)', cls: 'd-ev-weak' } };
export function evidenceTag(x, short) {
  const ev = x && x.liveEvidence; if (!ev || !ev.type) return '';
  const e = EVID[ev.type] || { label: ev.type, long: ev.type, cls: 'd-ev-ok' };
  return `<span class="badge d-ev ${e.cls}" data-evidence="${esc(ev.type)}" title="Proof: ${esc(e.long)}">${short ? '' : 'Proof: '}${esc(e.label)}${ev.type === 'attested' && !short ? ' (weaker)' : ''}</span>`;
}
/* drift issues that block a profile from counting as evidence: everything except "a column with no spec" */
export function blockingDrift(drift) { return (drift || []).filter(d => d && d.issue !== 'unspecified-column'); }
/* TC<n> labels for test cases (R5) */
export function caseLbl(c) {
  if (!c) return '';
  const r = eng('caseLabel', [docs(), c.id], null);
  if (typeof r === 'string' && r) return r;
  const same = store.list('testCase', t => t.dataId === c.dataId);
  return 'TC' + (same.findIndex(t => t.id === c.id) + 1);
}
export function readyCounts(ids) { ids = ids || []; const st = ids.map(effAvail); return { live: st.filter(a => a === 'live').length, total: ids.length, missing: st.filter(a => a === 'missing').length, example: st.filter(a => a === 'example').length, pending: st.filter(a => a === 'pending').length }; }
/* new/changed/removed counts (R3): every count shown comes from the engine's diffSummary */
export function diffCounts(p) {
  const r = eng('diffSummary', [p], null);
  if (r && typeof r.new === 'number') return r;
  const d = eng('diffProcess', [p], { nodes: {}, removed: [] }); const v = Object.values(d.nodes || {});
  return { new: v.filter(x => x === 'new').length, changed: v.filter(x => x === 'changed').length, same: v.filter(x => x === 'same').length, removed: (d.removed || []).length };
}
/* R9 §13: headline counts that add up: Future steps, and how many of those steps are new or changed (gateways,
   the trigger and the end are not steps), plus steps removed from Today. Read from the engine's diffProcess. */
export function stepChangeCounts(p) {
  const d = eng('diffProcess', [p], { nodes: {}, removed: [] });
  const steps = flat(p && p.tobe);
  const st = id => (d.nodes || {})[id];
  return { steps: steps.length, new: steps.filter(s => st(s.id) === 'new').length, changed: steps.filter(s => st(s.id) === 'changed').length,
    removed: (d.removed || []).filter(g => g && isStep(g)).length };
}
export const changeText = c => [c.new ? `${c.new} new` : '', c.changed ? `${c.changed} changed` : '', c.removed ? `${c.removed} removed` : ''].filter(Boolean).join(' · ');
/* plain-language profile pattern (R3): '9{8}' -> '8 digits' */
export function humanPat(pt) { const r = eng('humanPattern', [pt], null); return typeof r === 'string' && r ? r : String(pt || ''); }
export const projectsFor = pid => store.list('project', j => (j.processes || []).includes(pid));
export const STATUS_LBL = { done: 'Done', prog: 'In progress', idle: 'Not started', none: 'No change' };
/* R9 §1: one schedule badge per item, read from the engine's scheduleBadge (the single late definition).
   Simple says "Late" for anything past due or finishing after its due date; Advanced may name which. */
const BADGE_CLS = { done: 'b-done', late: 'b-late', slipping: 'b-late', causing: 'b-slip', soon: 'b-soon', ontrack: 'b-ok' };
export function workBadge(w, f) {
  f = f || {};
  if (w.status === 'done') return badge('Done ' + fmt(w.doneAt || w.due), 'b-done');
  const r = eng('scheduleBadge', [docs(), w.id, today()], null) || {};
  const key = BADGE_CLS[r.key] ? r.key : 'ontrack';
  const late = !!r.late || key === 'late' || key === 'slipping';
  const when = f.forecast && w.due && f.forecast > w.due ? ' · expected ' + fmt(f.forecast) : '';
  const txt = late ? (isAdv() ? (r.advancedLabel || 'Late') : 'Late') + when
    : key === 'causing' ? (r.label || 'Holding up other work') : key === 'soon' ? 'Due ' + fmt(w.due) : 'Due ' + fmt(w.due);
  return `<span class="badge ${late ? 'b-late' : BADGE_CLS[key]}" data-sched="${esc(late ? 'late' : key)}">${esc(txt)}</span>`;
}
/* is any open work item of a step late (engine forecast's single `late` flag)? */
export function stepLate(st) {
  if (!st || !Array.isArray(st.items)) return false;
  if (typeof st.late === 'boolean') return st.late;
  if (typeof st.late === 'number') return st.late > 0;
  const fc = eng('forecastAll', [docs(), today()], {});
  return st.items.some(w => w.status !== 'done' && fc[w.id] && fc[w.id].late === true);
}
/* R6 §2: one status that combines work and data. Work done but data not effectively live is
   "Built · awaiting live data" (amber), never green Done. Pass the step node (or its data ids). */
export const BUILT_LBL_ADV = 'Built · information not connected yet';
export const BUILT_LBL = BUILT_LBL_ADV;
export const builtLbl = () => isAdv() ? BUILT_LBL_ADV : 'Built · information not available yet';
export function stepData(n) { return n ? [...new Set([...(n.data || []), ...(n.subs || []).flatMap(x => x.data || [])])] : []; }
export function combinedStatus(st, node) {
  if (!st || st.status === 'none') return 'none';
  if (st.status === 'done') return stepData(node).some(d => effAvail(d) !== 'live') ? 'built' : 'done';
  return st.status;
}
export function stepBadge(st, node) {
  const cs = combinedStatus(st, node);
  if (cs === 'none') return badge('No change', 'b-none');
  if (cs === 'done') return badge('Done', 'b-done');
  if (cs === 'built') return `<span class="badge d-b-amber" data-built title="The work is done; the information this step needs is not available yet">${esc(builtLbl())}</span>`;
  const sch = stepLate(st) ? `<span class="badge b-late" data-sched="late">Late${st.forecast && st.due && st.forecast > st.due ? ' · expected ' + esc(fmt(st.forecast)) : ''}</span>`
    : st.next || st.due ? badge('Next due ' + fmt(st.next || st.due), 'b-ok') : '';
  return badge(STATUS_LBL[st.status] || st.status, 'b-' + st.status) + ' ' + sch;
}
export const notFound = what => `<div class="card"><h3>Not found</h3><p class="hint" style="margin:0 0 8px">${esc(what || 'This item')} does not exist in your sandbox. It may have been deleted, or the demo data was reset.</p><a href="${link('/')}" data-link style="color:var(--accent)">Back to Home</a></div>`;
/* the trigger prompt is a placeholder, never a value (older sandboxes stored it literally) */
const TRIG_PH = 'What starts this process?';
const TRIG_PHS = [TRIG_PH, 'What starts it?', 'What starts it'];
const trigTitle = n => (n && n.title && !TRIG_PHS.includes(n.title.trim())) ? n.title : '';
/* R9 §13: system names are not teams */
const SYSTEM_WORDS = /^(servicenow|hris|erp|crm|workday|sap|oracle|netsuite|concur|salesforce|sharepoint|docusign|jira|coupa|ariba|quickbooks|xero|okta|active directory|zendesk|hubspot|dynamics|outlook|teams|excel|finance system|.* system|.* portal)$/i;
export const isSystemName = t => SYSTEM_WORDS.test(String(t || '').trim());
const touchChip = t => isSystemName(t) ? `<span class="chip d-syschip" title="System">${esc(t)}</span>` : `<span class="chip touch" title="Team involved">Team: ${esc(t)}</span>`;
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- tree helpers ---------- */
function findLoc(nodes, id) {
  for (let i = 0; i < (nodes || []).length; i++) {
    const n = nodes[i]; if (n.id === id) return { list: nodes, index: i, node: n };
    if (isGw(n)) for (const b of n.branches || []) { const r = findLoc(b.nodes, id); if (r) return r; }
  }
  return null;
}
function getList(nodes, key) {
  if (key === 'root') return nodes;
  const [did, bi] = key.split('#'); const loc = findLoc(nodes, did);
  return loc && loc.node.branches && loc.node.branches[+bi] ? loc.node.branches[+bi].nodes : null;
}
function freshIds(nodes, keepFrom, map) {
  map = map || {};
  return (nodes || []).map(n => {
    const c = clone(n); c.id = store.newId(isGw(n) ? 'd' : 'n'); map[n.id] = c.id;
    if (keepFrom) c.from = n.id; else delete c.from;
    if (isGw(c)) c.branches = (n.branches || []).map(b => Object.assign({ label: b.label, nodes: freshIds(b.nodes, keepFrom, map) }, b.goto ? { goto: b.goto } : {}));
    return c;
  });
}
/* fork: copy with fresh ids, then re-point loop-back targets at the copies */
function forkNodes(nodes) {
  const map = {}; const out = freshIds(nodes, true, map);
  allNodes(out).forEach(n => isGw(n) && (n.branches || []).forEach(b => { if (b.goto) { if (map[b.goto]) b.goto = map[b.goto]; else delete b.goto; } }));
  return out;
}
const VER = { asis: 'Today', tobe: 'Future' };

/* ---------- map rendering ---------- */
function nodeHTML(n, ctx, idx) {
  if (n.type === 'end') return `<div class="node end" data-node="${esc(n.id)}">● ${esc(n.title || 'End')}${ctx.edit ? ' ' + toolbar(n, ctx) : ''}</div>`;
  const trig = n.type === 'trigger';
  const rd = readyCounts(n.data);
  const status = ctx.diff ? (ctx.diff.nodes || {})[n.id] : null;
  const showDiff = ctx.mode === 'diff' && status && status !== 'same';
  const diffChip = showDiff ? `<span class="chip diff-${esc(status)}">${status === 'new' ? 'NEW' : 'CHANGED'}</span>` : '';
  let body = '';
  const sp = isSpecial(n) ? NT[n.type] : null;
  const tn = (n.touches || []).length;
  if (trig) body = (n.touches || []).length ? `<div class="stats">${n.touches.map(touchChip).join('')}</div>` : '';
  else if (sp && n.type === 'wait' && !rd.total) {
    body = typeBody(n, ctx) + opsLine(n);
    if (showDiff && status === 'changed') body += changeNote(n, ctx);
  } else {
    const bare = !rd.total && !tn && !(n.subs || []).length; /* nothing tagged: no empty stats line */
    /* R8 §1: Simple shows how much information the step needs and, only when some is missing, how much is not available yet */
    const notYet = rd.total - rd.live;
    const infoStats = isAdv()
      ? `${rd.total ? `<span>Information <b>${rd.live}/${rd.total}</b> connected</span>` : ''}${rd.missing ? `<span class="d-miss" title="Information that is not available yet">${LOCK} ${rd.missing} not available yet</span>` : ''}${rd.pending ? `<span class="d-pend" title="A fix is done; the owner has not confirmed it is connected">${rd.pending} waiting for confirmation</span>` : ''}${rd.example ? `<span class="d-needlive" title="${NEEDS_LIVE}">${rd.example} sample only</span>` : ''}`
      : `${rd.total ? `<span data-info-n="${rd.total}">Information <b>${rd.total}</b></span>` : ''}${notYet ? `<span class="d-miss" data-notyet="${notYet}" title="Information that is not available yet">${LOCK} ${notYet} not available yet</span>` : ''}`;
    body = (sp ? typeBody(n, ctx) : '') + (bare ? '' : `<div class="stats">${infoStats}${tn ? `<span>${tn} team${tn === 1 ? '' : 's'}</span>` : ''}${(n.subs || []).length ? `<span>${n.subs.length} detail step${n.subs.length === 1 ? '' : 's'}</span>` : ''}</div>`) + opsLine(n);
    if (showDiff && status === 'changed') body += changeNote(n, ctx);
  }
  const goAttr = !ctx.edit && !trig && ctx.pid && !ctx.readonly ? `data-go="/process/${esc(ctx.pid)}/step/${esc(n.id)}" tabindex="0" role="link" aria-label="Open step ${esc(n.title)}"` : '';
  const who = esc(whoOf(n));
  return `<div class="node ${trig ? 'trigger' : ''} ${sp ? sp.cls : ''} ${ctx.edit ? 'd-editing' : ''}" data-node="${esc(n.id)}" ${trig ? '' : `data-step="${esc(n.id)}"`} data-ntype="${esc(n.type || 'step')}" data-data="${esc((n.data || []).join(','))}" ${goAttr}>
    <div class="nh"><span class="ic" ${sp ? `title="${esc(sp.label)}" data-idx="${idx}"` : ''}>${trig ? '⚡' : sp ? sp.icon : idx}</span>
      <div style="min-width:0"><div class="ttl">${trig && !trigTitle(n) ? '<span class="d-ph" data-trigger-empty>What starts it? e.g. A vendor sends a request</span>' : esc(trig ? trigTitle(n) : n.title)}</div><div class="num">${trig ? 'What starts it' : sp ? `<span class="d-ntk" data-ntk>${esc(kickerOf(n))}</span> · <span data-who>${who}</span>` : `<span data-who${n.ownerRole ? ' data-role' : ''}>${who}</span>`}</div></div>
      <div style="margin-left:auto;display:flex;gap:5px;align-items:center">${diffChip}${trig ? '' : whoAv(n)}</div></div>
    ${body ? `<div class="nb">${body}</div>` : ''}${ctx.edit ? `<div class="d-tools">${toolbar(n, ctx)}</div>` : ''}</div>`;
}
function changeNote(n, ctx) {
  const a = ctx.cmp ? null : n.from ? ctx.asisById[n.from] : null;
  const lines = [];
  if (ctx.cmp) ((ctx.diff.changes || {})[n.id] || []).forEach(t => lines.push(typeof t === 'string' ? t : (t && (t.text || t.detail)) || ''));
  if (a) {
    /* readable version of the engine's change list: names instead of ids */
    if ((a.title || '') !== (n.title || '')) lines.push('was: ' + a.title);
    if (whoOf(a) !== whoOf(n)) lines.push('who: ' + whoOf(a).replace('Nobody yet', 'Nobody') + ' → ' + whoOf(n).replace('Nobody yet', 'Nobody'));
    const ad = new Set(a.data || []), nd = new Set(n.data || []);
    const added = [...nd].filter(d => !ad.has(d)), removed = [...ad].filter(d => !nd.has(d));
    if (added.length) lines.push('+ information: ' + added.map(dataName).join(', '));
    if (removed.length) lines.push('− information: ' + removed.map(dataName).join(', '));
    if ((a.sla || '') !== (n.sla || '')) lines.push('time limit: ' + (a.sla || 'none') + ' → ' + (n.sla || 'none'));
    if ((a.system || '') !== (n.system || '')) lines.push('system: ' + (a.system || 'none') + ' → ' + (n.system || 'none'));
    if ((a.type || 'step') !== (n.type || 'step')) lines.push('type: ' + typeLabel(a) + ' → ' + typeLabel(n));
    else if (isSpecial(n) && typeDetail(a) !== typeDetail(n)) lines.push(typeDetail(a) + ' → ' + typeDetail(n));
    const st = x => (x.subs || []).map(y => y.title).join('|');
    if (st(a) !== st(n)) lines.push('detail steps: ' + (a.subs || []).length + ' → ' + (n.subs || []).length + ((a.subs || []).length === (n.subs || []).length ? ' (reworded)' : ''));
  }
  if (!lines.length) lines.push('same step, new way of working or information');
  return `<div class="was d-was">${lines.map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
}
function toolbar(n, ctx) {
  const lbl = esc(n.title || n.type);
  const movable = n.type !== 'trigger' && n.type !== 'end';
  return `<button class="btn sm" data-ed="edit" data-id="${esc(n.id)}" aria-label="Edit ${lbl}">Edit</button>${movable ? `
    <button class="btn sm" data-ed="up" data-id="${esc(n.id)}" aria-label="Move ${lbl} up">↑</button>
    <button class="btn sm" data-ed="down" data-id="${esc(n.id)}" aria-label="Move ${lbl} down">↓</button>
    <button class="btn sm danger" data-ed="del" data-id="${esc(n.id)}" aria-label="Delete ${lbl}">Delete</button>` : ''}`;
}
const insBtn = (key, pos) => `<div class="conn d-conn"><button class="d-ins" data-ins="${esc(key)}" data-pos="${pos}" aria-label="Add a step or a choice here" title="Add a step or a choice here">+</button></div>`;
/* R7 §4: the big "Add a step" button at the end of the main list goes straight to the step dialog */
const addStepBtn = (key, pos) => `<div class="d-addwrap"><button class="btn primary d-addstep" data-addstep data-pos="${pos}">+ Add a step</button><button class="btn sm d-addother" data-ins="${esc(key)}" data-pos="${pos}" aria-label="Add a choice or something else here">or a choice…</button></div>`;
function canInsert(nodes, k) { if (k === 0 && nodes[0] && nodes[0].type === 'trigger') return false; if (k === nodes.length && nodes.length && nodes[nodes.length - 1].type === 'end') return false; return true; }

function flowHTML(nodes, ctx, key, counter) {
  counter = counter || { n: 0 };
  const parts = [];
  if (ctx.edit && canInsert(nodes, 0)) parts.push(insBtn(key, 0));
  nodes.forEach((n, i) => {
    if (ctx.edit && key === 'root' && n.type === 'end') { parts.push('<div class="conn"></div>' + addStepBtn(key, i) + '<div class="conn"></div>'); }
    else if (i > 0) parts.push(ctx.edit && canInsert(nodes, i) ? insBtn(key, i) : '<div class="conn"></div>');
    if (isGw(n)) {
      const bs = n.branches || [], par = n.type === 'parallel';
      const st = ctx.mode === 'diff' && ctx.diff ? (ctx.diff.nodes || {})[n.id] : null;
      const dchip = st === 'new' || st === 'changed' ? ` <span class="chip diff-${st}">${st === 'new' ? 'NEW' : 'CHANGED'}</span>` : '';
      const gotoLbl = b => { if (!b.goto) return ''; const t = ctx.byId[b.goto]; return `<div class="d-goto" data-goto="${esc(b.goto)}">↩ Go back to ${t ? '“' + esc(t.title || 'start') + '”' : '<i>missing step</i>'}</div>`; };
      parts.push(`<div class="decision ${par ? 'd-parallel' : ''}" data-node="${esc(n.id)}" data-gw="${esc(n.type)}"><div class="diamond ${par ? 'd-par' : ''}"><span aria-hidden="true">${par ? '⊕' : '◆'}</span> <span class="d-gwt"><small class="d-parlbl d-gwkind" data-gw-label>${par ? 'At the same time' : 'Choice'}</small>${esc(n.title)}</span>${dchip}${ctx.edit ? `<span class="d-tools d-inline">${toolbar(n, ctx)}</span>` : ''}</div><div class="conn"></div>
        <div class="branches" style="--bl:${100 / (Math.max(bs.length, 1) * 2)}%;--br:${100 / (Math.max(bs.length, 1) * 2)}%">${bs.map((b, bi) => `<div class="branch"><span class="blabel">${esc(b.label)}</span>
          ${(b.nodes || []).length ? `<div class="flow">${flowHTML(b.nodes, ctx, n.id + '#' + bi, counter)}${gotoLbl(b)}</div>`
            : `<div class="flow">${ctx.edit ? insBtn(n.id + '#' + bi, 0) : ''}${b.goto ? gotoLbl(b) : `<div class="passthru">${par ? 'Nothing extra on this path' : 'Carries on to the next step'}</div>`}</div>`}</div>`).join('')}</div></div>`);
    } else {
      const idx = isStep(n) ? ++counter.n : '';
      parts.push(nodeHTML(n, ctx, idx));
    }
  });
  if (ctx.edit && nodes.length && canInsert(nodes, nodes.length)) parts.push(insBtn(key, nodes.length));
  return parts.join('');
}
function removedHTML(diff, n, from) {
  const gone = ((diff && diff.removed) || []).filter(g => g && g.type !== 'trigger' && g.type !== 'end');
  const count = n != null ? n : gone.length;
  return gone.length || count ? `<div class="conn"></div><div class="hint d-removed-h">Removed from ${esc(from || 'Today')} <span class="n" data-removed-n>${count}</span></div>${gone.map(g => `<div class="ghost" data-ghost="${esc(g.id)}" data-ntype="${esc(g.type || 'step')}">${isGw(g) ? `<span aria-hidden="true">${g.type === 'parallel' ? '⊕' : '◆'}</span> <span class="d-gwkind">${g.type === 'parallel' ? 'At the same time:' : 'Choice:'}</span> ` : isSpecial(g) ? `<span class="d-ghost-ic" title="${esc(NT[g.type].label)}">${NT[g.type].icon}</span> ` : ''}${esc(g.title)}${g.owner ? ` <span class="d-ghost-own">· ${esc(pname(g.owner))}</span>` : ''}</div>`).join('<div style="height:8px"></div>')}` : '';
}
function lanesHTML(nodes, ctx) {
  /* rows in document order: each step sits in its owner's lane; each gateway gets its own full-width row */
  const rows = [];
  const walk = list => (list || []).forEach(n => { if (isGw(n)) { rows.push({ gw: n }); (n.branches || []).forEach(b => walk(b.nodes)); } else if (isStep(n)) rows.push({ s: n }); });
  walk(nodes);
  const steps = rows.filter(r => r.s).map(r => r.s);
  if (!steps.length) return '<div class="empty">No steps yet. Tap “Edit steps” to add them.</div>';
  /* one lane per person, or per role for steps done by a role */
  const laneKey = s => s.ownerRole ? 'role:' + s.ownerRole : (s.owner || '');
  const owners = [...new Set(steps.map(laneKey))];
  /* R6: message nodes talk to an "External parties" lane on the right */
  const ext = steps.some(s => s.type === 'message');
  const cols = owners.length + (ext ? 1 : 0);
  let h = `<div class="d-lanewrap" tabindex="0" aria-label="Steps by person, scroll sideways for more people"><div class="lanes d-lanes" data-lanes="${cols}" style="grid-template-columns:repeat(${cols},minmax(220px,1fr));min-width:${cols * 220}px">`;
  owners.forEach(o => h += `<div class="lane-h">${o.startsWith('role:') ? esc(o.slice(5)) : o ? av(o) + esc(pname(o)) : 'Unassigned'}</div>`);
  if (ext) h += `<div class="lane-h d-lane-ext" data-ext-lane>${NT.message.icon} External parties</div>`;
  let i = 0;
  rows.forEach(r => {
    if (r.gw) {
      const par = r.gw.type === 'parallel';
      const where = (r.gw.branches || []).map(b => { const first = (b.nodes || [])[0]; const tgt = b.goto && ctx.byId[b.goto]; return `<span class="blabel">${esc(b.label)}</span> ${first ? esc(first.title) : tgt ? '↩ ' + esc(tgt.title) : (par ? 'nothing extra' : 'continue')}`; }).join('<span class="d-sep">·</span>');
      h += `<div class="d-lane-gw" style="grid-column:1/-1" data-node="${esc(r.gw.id)}" data-gw="${esc(r.gw.type)}"><div class="diamond ${par ? 'd-par' : ''}"><span aria-hidden="true">${par ? '⊕' : '◆'}</span> <span class="d-gwt"><small class="d-parlbl d-gwkind" data-gw-label>${par ? 'At the same time' : 'Choice'}</small>${esc(r.gw.title)}</span></div><div class="d-lane-br">${where}</div></div>`;
    } else {
      i++; owners.forEach(o => { h += `<div class="lane-c">${laneKey(r.s) === o ? nodeHTML(r.s, ctx, i) : ''}</div>`; });
      if (ext) h += `<div class="lane-c d-lane-extc">${r.s.type === 'message' ? `<div class="d-extmsg" data-ext-msg="${esc(r.s.id)}"><b>${esc(r.s.party || 'External party')}</b><span class="d-dir">${r.s.direction === 'receive' ? 'sends: ' : 'receives: '}${esc(r.s.title)}</span></div>` : ''}</div>`;
    }
  });
  return h + '</div></div>';
}

/* ---------- BPMN 2.0 export ---------- */
/* Layout: one vertical lane (column) per step owner; every flow node sits on its own row, in its lane.
   Events and gateways sit in the lane of the node before them, so every node belongs to exactly one lane.
   R6: PMOFlow data travels in extensionElements (namespace below) so a round trip is lossless; subprocess ->
   callActivity, wait -> intermediateCatchEvent + timerEventDefinition, message -> intermediateThrow/CatchEvent +
   messageEventDefinition. Optional "External parties" pool: message nodes connect to it with messageFlows. */
export const PMO_NS = 'https://necogoode.com/pmoflow';
const xid = id => 'N_' + String(id).replace(/[^\w.-]/g, '_');
const xe = s => esc(s);
const LANE_W = 260, LANE_X0 = 40, ROW_GAP = 46, TOP = 60, EXT_W = 150, EXT_GAP = 80;
/* "2 business days" -> "P2D" (timeDuration); null when the text has no readable duration */
export function isoDuration(t) {
  const m = String(t || '').match(/(\d+(?:\.\d+)?)\s*(?:business\s+|working\s+|calendar\s+)?(minute|min|hour|hr|day|week|month)s?\b/i);
  if (!m) return null; const n = m[1], u = m[2].toLowerCase();
  return u.startsWith('min') ? `PT${n}M` : u.startsWith('h') ? `PT${n}H` : u === 'day' ? `P${n}D` : u === 'week' ? `P${n}W` : `P${n}M`;
}
/* "P2D" -> "2 days" (used only for foreign files without PMOFlow extension data) */
export function durationText(iso) {
  const m = /^P(T?)(\d+(?:\.\d+)?)([MHDW])$/i.exec(String(iso || '').trim()); if (!m) return '';
  const u = m[3].toUpperCase(), w = m[1] ? (u === 'M' ? 'minute' : 'hour') : ({ D: 'day', W: 'week', M: 'month' })[u] || 'day';
  return `${m[2]} ${w}${m[2] === '1' ? '' : 's'}`;
}
const attr = (k, v) => v == null || v === '' ? '' : ` ${k}="${xe(v)}"`;
function extXml(n, ind) {
  const ref = d => `<pmoflow:data ref="${xe(d)}" name="${xe(dataName(d))}" />`;
  const c = n.type === 'subprocess' ? calledOf(n) : null;
  const lines = [`<pmoflow:node${attr('id', n.id)}${attr('nodeType', n.type || 'step')}${attr('owner', n.owner)}${attr('ownerName', n.owner ? pname(n.owner) : '')}${attr('ownerRole', n.ownerRole)}${attr('sla', n.sla)}${attr('system', n.system)}${attr('durationHrs', n.durationHrs)}${n.type === 'wait' ? attr('wait', n.wait) : ''}${n.type === 'message' ? attr('direction', n.direction === 'receive' ? 'receive' : 'send') + attr('party', n.party) : ''}${c ? attr('calls', n.calls) + attr('callsName', c.p ? c.p.name : c.name) : ''} />`];
  (n.data || []).forEach(d => lines.push(ref(d)));
  (n.touches || []).forEach(t => lines.push(`<pmoflow:touch name="${xe(t)}" />`));
  (n.subs || []).forEach(sb => lines.push((sb.data || []).length ? `<pmoflow:sub title="${xe(sb.title)}">\n${sb.data.map(d => `${ind}    ${ref(d)}`).join('\n')}\n${ind}  </pmoflow:sub>` : `<pmoflow:sub title="${xe(sb.title)}" />`));
  return `${ind}<bpmn:extensionElements>\n${lines.map(l => ind + '  ' + l).join('\n')}\n${ind}</bpmn:extensionElements>`;
}
export function bpmnXml(p, nodes, label, opts) {
  opts = opts || {};
  const els = [], flows = [], pos = {}, messages = [], msgFlows = []; let y = TOP, fi = 0;
  const SZ = { startEvent: [36, 36], endEvent: [36, 36], userTask: [170, 70], callActivity: [170, 70], intermediateCatchEvent: [36, 36], intermediateThrowEvent: [36, 36], exclusiveGateway: [50, 50], parallelGateway: [50, 50] };
  /* lanes: one per step owner, in order of first appearance */
  const laneKeys = []; flat(nodes).forEach(n => { const k = n.owner || ''; if (!laneKeys.includes(k)) laneKeys.push(k); });
  if (!laneKeys.length) laneKeys.push((nodes || []).find(n => n.type === 'trigger' && n.owner) ? nodes.find(n => n.type === 'trigger').owner : '');
  const laneOf = k => Math.max(0, laneKeys.indexOf(k));
  const laneRefs = laneKeys.map(() => []);
  const trig = (nodes || []).find(n => n.type === 'trigger');
  let curLane = trig && trig.owner && laneKeys.includes(trig.owner) ? laneOf(trig.owner) : 0;
  const add = (tag, id, inner, name, lane, extra) => {
    if (lane != null) curLane = lane;
    const [w, h] = SZ[tag]; const cx = LANE_X0 + curLane * LANE_W + LANE_W / 2;
    els.push(`    <bpmn:${tag} id="${id}"${name != null ? ` name="${xe(name)}"` : ''}${extra || ''}${inner ? `>\n${inner}\n    </bpmn:${tag}>` : ' />'}`);
    pos[id] = { x: Math.round(cx - w / 2), y, w, h, tag }; laneRefs[curLane].push(id); y += h + ROW_GAP;
  };
  const flow = (from, to, name) => flows.push({ id: 'Flow_' + (++fi), from, to, name });
  const connect = (tails, id) => tails.forEach(t => flow(t.id, id, t.name));
  const doc = n => { const bits = [];
    if (isSpecial(n)) bits.push(typeLabel(n) + ': ' + typeDetail(n));
    if (n.ownerRole) bits.push('Role: ' + n.ownerRole); if (n.owner) bits.push('Owner: ' + pname(n.owner));
    if ((n.data || []).length) bits.push('Data: ' + n.data.map(d => dataName(d) + ' (' + avOf(availOf(d)).short + ')').join(', '));
    if (n.system) bits.push('System: ' + n.system); if (n.sla) bits.push('SLA: ' + n.sla); if (n.durationHrs) bits.push('Duration: ' + n.durationHrs + 'h');
    if ((n.subs || []).length) bits.push('Sub-steps: ' + n.subs.map(x => x.title).join('; '));
    return bits.length ? `      <bpmn:documentation>${xe(bits.join('. '))}</bpmn:documentation>` : ''; };
  const body = (n, tail) => [doc(n), extXml(n, '      '), tail || ''].filter(Boolean).join('\n');
  const ids = new Set(allNodes(nodes).map(n => n.id));
  let ended = false;
  function emitTask(n, id) {
    const lane = laneOf(n.owner || '');
    if (n.type === 'subprocess') add('callActivity', id, body(n), n.title, lane, n.calls ? ` calledElement="${xe('Process_' + String(n.calls).replace(/[^\w.-]/g, '_'))}"` : '');
    else if (n.type === 'wait') { const iso = isoDuration(n.wait); add('intermediateCatchEvent', id, body(n, `      <bpmn:timerEventDefinition id="${id}_timer">${iso ? `\n        <bpmn:timeDuration>${iso}</bpmn:timeDuration>\n      ` : ''}</bpmn:timerEventDefinition>`), n.title, lane); }
    else if (n.type === 'message') {
      const send = n.direction !== 'receive', mid = 'Message_' + id.slice(2);
      messages.push({ id: mid, name: (n.party || 'External party') + ': ' + n.title });
      msgFlows.push({ id: 'MessageFlow_' + id.slice(2), node: id, send, name: n.party || 'External party' });
      add(send ? 'intermediateThrowEvent' : 'intermediateCatchEvent', id, body(n, `      <bpmn:messageEventDefinition id="${id}_msg" messageRef="${mid}" />`), n.title, lane);
    } else add('userTask', id, body(n), n.title, lane);
  }
  function emit(list, tails) {
    for (const n of list || []) {
      const id = xid(n.id);
      if (n.type === 'trigger') { add('startEvent', id, (n.touches || []).length || (n.data || []).length || n.owner ? extXml(n, '      ') : '', n.title); connect(tails, id); tails = [{ id }]; }
      else if (n.type === 'end') { add('endEvent', id, '', n.title); ended = true; connect(tails, id); tails = []; }
      else if (isGw(n)) {
        const tag = n.type === 'parallel' ? 'parallelGateway' : 'exclusiveGateway';
        add(tag, id, '', n.title); connect(tails, id);
        const gwLane = curLane, out = [];
        (n.branches || []).forEach(b => {
          curLane = gwLane;
          const loop = b.goto && ids.has(b.goto) ? xid(b.goto) : null;
          if (!(b.nodes || []).length) { if (loop) flow(id, loop, b.label); else out.push({ id, name: b.label }); }
          else { const t = emit(b.nodes, [{ id, name: b.label }]); if (loop) t.forEach(tt => flow(tt.id, loop, tt.name)); else out.push(...t); }
        });
        if (out.length) { const jid = id + '_join'; add(tag, jid, '', null, gwLane); connect(out, jid); tails = [{ id: jid }]; } else tails = [];
      } else { emitTask(n, id); connect(tails, id); tails = [{ id }]; }
    }
    return tails;
  }
  let tails = [];
  if (!(nodes || []).length || nodes[0].type !== 'trigger') { add('startEvent', 'StartEvent_1', '', 'Start'); tails = [{ id: 'StartEvent_1' }]; }
  tails = emit(nodes, tails);
  if (tails.length || !ended) { add('endEvent', 'EndEvent_1', '', 'End'); connect(tails, 'EndEvent_1'); }
  const pidX = 'Process_' + String(p.id).replace(/[^\w.-]/g, '_');
  const height = y - ROW_GAP + 40;
  const lanes = laneKeys.map((k, i) => ({ id: 'Lane_' + (i + 1), name: k ? pname(k) : 'Unassigned', refs: laneRefs[i] }));
  const pool = !!opts.pool && msgFlows.length > 0;
  const poolW = laneKeys.length * LANE_W, extX = LANE_X0 + poolW + EXT_GAP;
  const c = b => ({ x: b.x + b.w / 2, top: b.y, bot: b.y + b.h, mid: b.y + b.h / 2, right: b.x + b.w });
  const edges = flows.map(f => { const s = c(pos[f.from]), t = c(pos[f.to]); let pts;
    if (t.top > s.bot) pts = s.x === t.x ? [[s.x, s.bot], [t.x, t.top]] : [[s.x, s.bot], [s.x, (s.bot + t.top) / 2], [t.x, (s.bot + t.top) / 2], [t.x, t.top]];
    else { const rx = Math.max(s.right, t.right) + 30; pts = [[s.right, s.mid], [rx, s.mid], [rx, t.mid], [t.right, t.mid]]; } /* loop back */
    return { id: f.id, pts }; });
  if (pool) msgFlows.forEach(m => { const b = c(pos[m.node]); edges.push({ id: m.id, pts: m.send ? [[b.right, b.mid], [extX, b.mid]] : [[extX, b.mid], [b.right, b.mid]] }); });
  const edgeXml = e => `      <bpmndi:BPMNEdge id="${e.id}_di" bpmnElement="${e.id}">\n${e.pts.map(([px, py]) => `        <di:waypoint x="${Math.round(px)}" y="${Math.round(py)}" />`).join('\n')}\n      </bpmndi:BPMNEdge>`;
  const procName = p.name + ' (' + label + ')';
  const collab = pool ? `  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_Main" name="${xe(procName)}" processRef="${pidX}" />
    <bpmn:participant id="Participant_External" name="External parties" />
${msgFlows.map(m => `    <bpmn:messageFlow id="${m.id}" name="${xe(m.name)}" sourceRef="${m.send ? m.node : 'Participant_External'}" targetRef="${m.send ? 'Participant_External' : m.node}" />`).join('\n')}
  </bpmn:collaboration>
` : '';
  const poolShapes = pool ? `      <bpmndi:BPMNShape id="Participant_Main_di" bpmnElement="Participant_Main" isHorizontal="false">\n        <dc:Bounds x="${LANE_X0}" y="0" width="${poolW}" height="${height + 20}" />\n      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Participant_External_di" bpmnElement="Participant_External" isHorizontal="false">\n        <dc:Bounds x="${extX}" y="0" width="${EXT_W}" height="${height + 20}" />\n      </bpmndi:BPMNShape>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:pmoflow="${PMO_NS}" id="Definitions_1" targetNamespace="https://www.necogoode.com/concepts/pmoflow" exporter="PMOFlow" exporterVersion="6">
${messages.map(m => `  <bpmn:message id="${m.id}" name="${xe(m.name)}" />`).join('\n')}${messages.length ? '\n' : ''}${collab}  <bpmn:process id="${pidX}" name="${xe(procName)}" isExecutable="false">
    <bpmn:documentation>${xe((p.desc || '') + ' Exported from PMOFlow, ' + label + '.')}</bpmn:documentation>
    <bpmn:laneSet id="LaneSet_1">
${lanes.map(l => `      <bpmn:lane id="${l.id}" name="${xe(l.name)}">\n${l.refs.map(r => `        <bpmn:flowNodeRef>${r}</bpmn:flowNodeRef>`).join('\n')}\n      </bpmn:lane>`).join('\n')}
    </bpmn:laneSet>
${els.join('\n')}
${flows.map(f => `    <bpmn:sequenceFlow id="${f.id}" sourceRef="${f.from}" targetRef="${f.to}"${f.name ? ` name="${xe(f.name)}"` : ''} />`).join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="${pool ? 'Collaboration_1' : pidX}">
${poolShapes}${lanes.map((l, i) => `      <bpmndi:BPMNShape id="${l.id}_di" bpmnElement="${l.id}" isHorizontal="false">\n        <dc:Bounds x="${LANE_X0 + i * LANE_W}" y="20" width="${LANE_W}" height="${height}" />\n      </bpmndi:BPMNShape>`).join('\n')}
${Object.entries(pos).map(([id, b]) => `      <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${b.tag === 'exclusiveGateway' ? ' isMarkerVisible="true"' : ''}>\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />\n      </bpmndi:BPMNShape>`).join('\n')}
${edges.map(edgeXml).join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

/* ---------- BPMN 2.0 import (parsed in the browser with DOMParser) ----------
   startEvent -> trigger, tasks -> steps, callActivity -> subprocess, timer catch event -> wait, message throw/catch
   event -> message (send/receive), exclusive/inclusive/event-based gateway -> decision, parallelGateway -> parallel,
   branches from outgoing sequence flows (a flow back to an earlier node becomes a loop-back), endEvent -> end,
   lanes -> owners by name (unknown names -> the current persona). PMOFlow extensionElements (data by id or name, sla,
   system, touches, sub-steps, node type) are read back, so an exported file round-trips without loss.
   Pass-through merge gateways and plain intermediate events are skipped. */
const TASKS = new Set(['task', 'userTask', 'manualTask', 'serviceTask', 'scriptTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'callActivity', 'subProcess']);
const GWS = { exclusiveGateway: 'decision', inclusiveGateway: 'decision', eventBasedGateway: 'decision', complexGateway: 'decision', parallelGateway: 'parallel' };
/* structural children that carry no flow element of their own */
const IGNORED = new Set(['sequenceFlow', 'laneSet', 'documentation', 'extensionElements', 'ioSpecification', 'property', 'association']);
/* PMOFlow extension data on an element, or null */
function extOf(el) {
  const ee = [...el.children].find(c => c.localName === 'extensionElements'); if (!ee) return null;
  const kids = [...ee.children].filter(c => c.namespaceURI === PMO_NS); if (!kids.length) return null;
  const a = {}; const ne = kids.find(c => c.localName === 'node'); if (ne) [...ne.attributes].forEach(x => { if (!x.name.startsWith('xmlns')) a[x.localName] = x.value; });
  const refs = list => list.filter(c => c.localName === 'data').map(c => ({ id: c.getAttribute('ref') || c.getAttribute('id') || '', name: (c.getAttribute('name') || '').trim() }));
  return { a, data: refs(kids), touches: kids.filter(c => c.localName === 'touch').map(c => (c.getAttribute('name') || c.textContent || '').trim()).filter(Boolean),
    subs: kids.filter(c => c.localName === 'sub').map(c => ({ title: (c.getAttribute('title') || '').trim(), data: refs([...c.children].filter(x => x.namespaceURI === PMO_NS)) })).filter(s => s.title) };
}
export function parseBpmn(text, people, me) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This file is not well-formed XML.');
  const proc = doc.getElementsByTagNameNS('*', 'process')[0];
  if (!proc) throw new Error('No BPMN process was found in this file.');
  const kids = [...proc.children];
  const nodes = {}, outs = {}, ins = {};
  /* R5: anything PMOFlow cannot represent is reported as dropped before the import is confirmed */
  const dropped = [];
  const human = t => t.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const label = el => (el.getAttribute('name') || '').trim() || el.getAttribute('id') || '';
  const defOf = el => { const k = [...el.children].map(c => c.localName); return k.includes('timerEventDefinition') ? 'timer' : k.includes('messageEventDefinition') ? 'message' : null; };
  kids.forEach(el => {
    const t = el.localName;
    if (TASKS.has(t) || GWS[t] || ['startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent'].includes(t)) nodes[el.getAttribute('id')] = { el, tag: t, name: (el.getAttribute('name') || '').trim(), def: /^intermediate/.test(t) ? defOf(el) : null };
    else if (!IGNORED.has(t)) dropped.push({ name: label(el), type: human(t), reason: 'not supported by PMOFlow' });
  });
  kids.filter(el => el.localName === 'sequenceFlow').forEach(el => {
    const f = { from: el.getAttribute('sourceRef'), to: el.getAttribute('targetRef'), name: (el.getAttribute('name') || '').trim() };
    if (!nodes[f.from] || !nodes[f.to]) return;
    (outs[f.from] = outs[f.from] || []).push(f); (ins[f.to] = ins[f.to] || []).push(f);
  });
  /* message flows (External parties pool): the flow's name, else the other participant's name, is the party */
  const partName = {}; [...doc.getElementsByTagNameNS('*', 'participant')].forEach(pt => { partName[pt.getAttribute('id')] = (pt.getAttribute('name') || '').trim(); });
  const msgParty = {}; [...doc.getElementsByTagNameNS('*', 'messageFlow')].forEach(mf => {
    const s = mf.getAttribute('sourceRef'), t = mf.getAttribute('targetRef'), nm = (mf.getAttribute('name') || '').trim();
    if (nodes[s]) msgParty[s] = { party: nm || partName[t] || '', send: true }; if (nodes[t]) msgParty[t] = { party: nm || partName[s] || '', send: false };
  });
  const msgName = {}; [...doc.getElementsByTagNameNS('*', 'message')].forEach(m => { msgName[m.getAttribute('id')] = (m.getAttribute('name') || '').trim(); });
  /* lanes -> owner ids by person name (exact, then first name), else the current persona */
  const laneOwner = {}, laneMatched = {}; const unknownLanes = new Set();
  const byName = nm => { const k = nm.toLowerCase(); return people.find(x => x.name.toLowerCase() === k) || people.find(x => x.name.split(' ')[0].toLowerCase() === k) || null; };
  [...proc.getElementsByTagNameNS('*', 'lane')].forEach(l => {
    const nm = (l.getAttribute('name') || '').trim(); const person = nm ? byName(nm) : null;
    if (!person && nm && nm !== 'Unassigned') unknownLanes.add(nm);
    [...l.getElementsByTagNameNS('*', 'flowNodeRef')].forEach(r => { laneOwner[r.textContent.trim()] = person ? person.id : me; if (person) laneMatched[r.textContent.trim()] = true; });
  });
  /* owner: a lane naming a person, else the extension's owner (by id, then name), else the current persona */
  const extOwner = a => a && ((a.owner && people.find(x => x.id === a.owner)) || (a.ownerName && byName(a.ownerName)));
  const ownerOf = (id, a) => laneMatched[id] ? laneOwner[id] : (extOwner(a) || {}).id || laneOwner[id] || me;
  const docText = el => { const d = [...el.children].find(c => c.localName === 'documentation'); return d ? d.textContent : ''; };
  /* data references: by id when it exists in this workspace, else by name; unknown names become new data elements */
  const newData = [], newByName = {};
  const resolveRef = r => {
    if (r.id && store.get('dataElement', r.id)) return r.id;
    const k = (r.name || '').toLowerCase(); if (!k) return null;
    const hit = store.list('dataElement').find(d => String(d.name || '').trim().toLowerCase() === k); if (hit) return hit.id;
    if (!newByName[k]) { newByName[k] = { id: store.newId('de'), name: r.name }; newData.push(newByName[k]); }
    return newByName[k].id;
  };
  const refs = list => [...new Set((list || []).map(resolveRef).filter(Boolean))];
  const applyExt = (out, x) => {
    out.data = refs(x.data); out.touches = x.touches.slice();
    if (out.type !== 'trigger') out.subs = x.subs.map(s => ({ title: s.title, data: refs(s.data) }));
    const a = x.a; if (a.ownerRole && out.type !== 'trigger') out.ownerRole = a.ownerRole; if (a.sla) out.sla = a.sla; if (a.system) out.system = a.system; if (a.durationHrs && isFinite(+a.durationHrs)) out.durationHrs = +a.durationHrs;
  };
  const extIds = new Set();
  /* R8 §8: the PMOFlow id a node had when it was exported (extension attribute, else the exporter's element id) */
  const fromPmo = (doc.documentElement.getAttribute('exporter') || '') === 'PMOFlow';
  const pmoIdOf = (elId, a) => (a && a.id) || (fromPmo && /^N_/.test(elId || '') && !/_join$/.test(elId) ? elId.slice(2) : null);
  const emitted = {}; let pendingAlias = [];
  const mark = (bid, nid) => { emitted[bid] = nid; pendingAlias.forEach(a => emitted[a] = nid); pendingAlias = []; };
  const taskLike = n => !!n && (TASKS.has(n.tag) || !!n.def);
  const passThrough = id => { const n = nodes[id]; return n && ((GWS[n.tag] && (outs[id] || []).length <= 1) || (/Event$/.test(n.tag) && n.tag !== 'startEvent' && n.tag !== 'endEvent' && !n.def)); };
  let stepN = 0, gwN = 0, trigger = null, hasEnd = false; const laneHit = new Set();
  const procs = store.list('process');
  const mkStep = (id) => {
    const n = nodes[id]; const d = docText(n.el); const x = extOf(n.el); const a = x ? x.a : {};
    let type = a.nodeType === 'step' || NT[a.nodeType] ? a.nodeType : n.tag === 'callActivity' ? 'subprocess' : n.def === 'timer' ? 'wait' : n.def === 'message' ? 'message' : 'step';
    const out = { id: store.newId('n'), type, title: n.name, owner: ownerOf(id, a), data: [], touches: [], subs: [] };
    const pid0 = pmoIdOf(id, a); if (pid0) out.pmoId = pid0;
    if (laneMatched[id] || extOwner(a)) laneHit.add(out.id);
    if (type === 'wait') {
      const td = n.el.getElementsByTagNameNS('*', 'timeDuration')[0];
      out.wait = a.wait || durationText(td && td.textContent) || (n.name || '').replace(/^wait\s+(for\s+)?/i, '') || '1 business day';
      if (!out.title) out.title = 'Wait ' + out.wait;
    } else if (type === 'message') {
      const mp = msgParty[id] || {}; const md = n.el.getElementsByTagNameNS('*', 'messageEventDefinition')[0]; const mref = md && msgName[md.getAttribute('messageRef')];
      out.direction = a.direction === 'receive' || a.direction === 'send' ? a.direction : mp.send != null ? (mp.send ? 'send' : 'receive') : n.tag === 'intermediateThrowEvent' || n.tag === 'sendTask' ? 'send' : 'receive';
      out.party = a.party || mp.party || (mref ? mref.split(':')[0].trim() : '') || 'External party';
      if (!out.title) out.title = (out.direction === 'send' ? 'Notify ' : 'Receive from ') + out.party;
    } else if (type === 'subprocess') {
      const ce = (n.el.getAttribute('calledElement') || '').replace(/^Process_/, '');
      const nm = (a.callsName || n.name || '').toLowerCase();
      const hit = (a.calls && procs.find(p => p.id === a.calls)) || (ce && procs.find(p => p.id === ce || String(p.id).replace(/[^\w.-]/g, '_') === ce)) || (nm && procs.find(p => String(p.name).toLowerCase() === nm));
      if (hit) out.calls = hit.id; else out.callsName = a.callsName || n.name || ce || '';
      if (!out.title) out.title = 'Run ' + (hit ? hit.name : out.callsName || 'subprocess');
    }
    if (!out.title) out.title = 'Untitled step';
    if (x) { applyExt(out, x); extIds.add(out.id); }
    else { const sys = d.match(/System: ([^.]+)/), sla = d.match(/SLA: ([^.]+)/); if (sys) out.system = sys[1].trim(); if (sla) out.sla = sla[1].trim(); }
    stepN++; return out;
  };
  /* nodes reachable from start without passing through already-emitted nodes, with BFS distance */
  function reach(start) {
    const dist = new Map(); if (emitted[start] !== undefined) return dist;
    const q = [[start, 0]]; dist.set(start, 0);
    while (q.length) { const [c, d] = q.shift(); (outs[c] || []).forEach(f => { if (emitted[f.to] === undefined && !dist.has(f.to)) { dist.set(f.to, d + 1); q.push([f.to, d + 1]); } }); }
    return dist;
  }
  function findJoin(flowsOut) {
    const sets = flowsOut.map(f => reach(f.to));
    const score = new Map();
    sets.forEach(s => s.forEach((d, id) => { const v = score.get(id) || { n: 0, d: 0 }; v.n++; v.d += d; score.set(id, v); }));
    let best = null;
    score.forEach((v, id) => { if (v.n >= 2 && (!best || v.n > best.v.n || (v.n === best.v.n && v.d < best.v.d))) best = { id, v }; });
    if (best) return best.id;
    /* only one branch continues (the others loop back or end): its nearest pass-through merge gateway closes the split */
    let mg = null; sets.forEach(s => s.forEach((d, id) => { if (nodes[id] && GWS[nodes[id].tag] && (ins[id] || []).length >= 1 && (outs[id] || []).length === 1 && (!mg || d < mg.d)) mg = { id, d }; }));
    return mg ? mg.id : null;
  }
  function seq(start, stop) {
    const list = []; let cur = start, guard = 0;
    while (cur && cur !== stop && guard++ < 5000) {
      if (emitted[cur] !== undefined) return { list, goto: emitted[cur] };
      const n = nodes[cur]; const o = outs[cur] || [];
      if (n.tag === 'startEvent') {
        const x = extOf(n.el); const t = { id: store.newId('n'), type: 'trigger', title: n.name || 'Process starts', owner: ownerOf(cur, x && x.a), touches: [], data: [] };
        const tp = pmoIdOf(cur, x && x.a); if (tp) t.pmoId = tp;
        if (x) { t.touches = x.touches.slice(); t.data = refs(x.data); extIds.add(t.id); }
        mark(cur, t.id); list.push(t); trigger = t; cur = o[0] && o[0].to; continue;
      }
      if (n.tag === 'endEvent') { const e = { id: store.newId('n'), type: 'end', title: n.name || 'Process complete' }; mark(cur, e.id); list.push(e); hasEnd = true; return { list }; }
      if (passThrough(cur)) { if (!GWS[n.tag]) dropped.push({ name: n.name || cur, type: n.tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), reason: 'skipped; the flow continues through it' }); pendingAlias.push(cur); emitted[cur] = null; cur = o[0] && o[0].to; continue; }
      let kind = GWS[n.tag];
      if (taskLike(n)) { const st = mkStep(cur); mark(cur, st.id); list.push(st); if (o.length <= 1) { cur = o[0] && o[0].to; continue; } kind = o.every(f => f.name) ? 'decision' : 'parallel'; }
      /* split: a gateway (or a task with several outgoing flows) */
      const gw = { id: store.newId('d'), type: kind, title: taskLike(n) ? (kind === 'parallel' ? 'In parallel' : 'Decision') : (n.name || (kind === 'parallel' ? 'In parallel' : 'Decision')), branches: [] };
      if (!taskLike(n)) { const gp = pmoIdOf(cur, null); if (gp) gw.pmoId = gp; }
      if (!taskLike(n)) mark(cur, gw.id);
      gwN++;
      const join = findJoin(o);
      o.forEach((f, i) => {
        const b = { label: f.name || (kind === 'parallel' ? 'Track ' + String.fromCharCode(65 + i) : 'Option ' + (i + 1)), nodes: [] };
        if (f.to !== join) { const r = seq(f.to, join); b.nodes = r.list; if (r.goto) b.goto = r.goto; }
        gw.branches.push(b);
      });
      list.push(gw);
      if (!join) return { list };
      cur = join;
    }
    return { list };
  }
  const starts = Object.keys(nodes).filter(id => nodes[id].tag === 'startEvent');
  const first = starts[0] || Object.keys(nodes).find(id => !(ins[id] || []).length);
  if (!first) throw new Error('The process has no start event.');
  let list = seq(first, null).list;
  /* nodes the walk from the start never reached are not connected to the flow */
  Object.keys(nodes).forEach(id => { if (!(id in emitted)) { const n = nodes[id]; dropped.push({ name: n.name || id, type: n.tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), reason: 'not connected to the flow' }); } });
  /* loop-back targets that resolved to null (a skipped merge gateway with nothing after it) are dropped */
  allNodes(list).forEach(n => isGw(n) && n.branches.forEach(b => { if (b.goto == null) delete b.goto; }));
  if (!trigger) list.unshift({ id: store.newId('n'), type: 'trigger', title: 'Process starts', owner: me, touches: [], data: [] });
  if (!list.length || list[list.length - 1].type !== 'end') list.push({ id: store.newId('n'), type: 'end', title: 'Process complete' });
  const rawName = (proc.getAttribute('name') || doc.documentElement.getAttribute('name') || '').trim();
  /* only data a node still references after the walk is created */
  const usedIds = new Set(allNodes(list).flatMap(n => [...(n.data || []), ...(n.subs || []).flatMap(s => s.data || [])]));
  return { name: rawName.replace(/\s*\((to-be|as-is[^)]*|future|today[^)]*|released[^)]*)\)\s*$/i, ''), desc: (docText(proc) || '').replace(/\s*Exported from PMOFlow,[^.]*\.\s*$/, '').trim(), nodes: list, steps: stepN, gateways: gwN, unknownLanes: [...unknownLanes], dropped, laneOwned: laneHit, extIds, newData: newData.filter(d => usedIds.has(d.id)) };
}
/* create the data elements an import references by name but this workspace does not have yet */
export async function createImportedData(list, fileName) {
  for (const d of list || []) {
    if (store.get('dataElement', d.id)) continue;
    await store.save('dataElement', d.id, { id: d.id, name: d.name, owner: store.state.me, source: '', avail: 'missing', note: `Created by the BPMN import of ${fileName}.`, fields: [], samples: [], discovered: [] }, `Created data element '${d.name}' from the BPMN import of ${fileName}`);
  }
}

/* ---------- module state ---------- */
let hl = null;            /* highlighted data element on the map */
let newOpen = false;      /* /new modal guard (the router re-renders on every store change) */
let newImport = false;    /* the visitor chose "Import BPMN" on /new: do not re-open the create modal on re-render */
let hdrOpen = false;      /* phone: header KPIs and controls expanded */
const sideOpen = new Set(); /* R8 phone: side panels the visitor opened (folded by default) */
let autoAdd = null;       /* R7: a process just created opens its first "Add a step" dialog */
const futureMaking = new Set(); /* R7: processes whose Future version is being created from Today */
let menuCloser = null;    /* document listener that closes the "⋯ More" menu */
/* R5 "Undo last change": the previous process snapshot of each save this session, newest last */
const undoStack = {};
export const MAX_DRAFTS = 10;

/* R5: every version a process can be compared across: current to-be / as-is, saved drafts, released */
export function versionSources(p) {
  const out = [{ key: 'cur-tobe', label: 'Current Future', nodes: p.tobe || [] }, { key: 'cur-asis', label: `Current Today (v${p.version || 1})`, nodes: p.asis || [] }];
  (p.drafts || []).forEach(d => out.push({ key: 'draft:' + d.id, label: `Saved “${d.name}” (Future)`, nodes: d.tobe || [], draft: d }));
  (p.released || []).slice().sort((a, b) => b.version - a.version).forEach(r => out.push({ key: 'rel:' + r.version, label: `Released v${r.version} (Today)`, nodes: r.asis || [] }));
  return out;
}
function cmpPair(p, q) {
  const src = versionSources(p);
  const B = src.find(s => s.key === q.b) || src[0];
  const defA = (p.drafts || []).length ? 'draft:' + p.drafts[p.drafts.length - 1].id : 'cur-asis';
  const A = src.find(s => s.key === q.a) || src.find(s => s.key === defA) || src[1];
  return { src, A, B };
}
/* engine diff between two versions (same shape as diffProcess) */
export function cmpDiff(A, B) {
  /* a to-be compared with the as-is it was forked from links by `from`, not by id: the process diff covers that pair */
  const aIds = new Set(allNodes(A.nodes).map(n => n.id)), bAll = allNodes(B.nodes);
  const byFrom = bAll.filter(n => n.from && aIds.has(n.from)).length, byId = bAll.filter(n => isStep(n) && aIds.has(n.id)).length;
  if (byFrom > byId) { const d = eng('diffProcess', [{ asis: A.nodes, tobe: B.nodes }, docs()], null); if (d && d.nodes) return d; }
  const d = eng('diffVersions', [A.nodes, B.nodes, docs()], null);
  return d && d.nodes ? d : { nodes: {}, removed: [], changes: {} };
}

/* "v1 · to-be rev 2": the released as-is version, plus the to-be revision once a BPMN import has replaced the to-be */
export const verLabel = p => `v${p.version || 1}${(p.tobeRev || 1) > 1 ? ' · Future rev ' + p.tobeRev : ''}`;
/* which node list the page is showing, and its label */
function shown(p, q) {
  let mode = ['asis', 'tobe', 'diff', 'lanes', 'impact', 'edit', 'compare'].includes(q.mode) ? q.mode : (flat(p.tobe).length ? 'tobe' : 'asis');
  if (mode === 'edit' && !canEditProc(p)) mode = 'tobe'; /* read-only for non-editors */
  const rel = q.rel ? (p.released || []).find(r => String(r.version) === String(q.rel)) : null;
  if (rel) return { mode: 'asis', rel, nodes: rel.asis || [], key: 'released', label: 'released v' + rel.version + ' Today' };
  if (mode === 'compare') { const c = cmpPair(p, q); return Object.assign({ mode, ver: 'tobe', nodes: c.B.nodes, key: 'compare', label: c.B.label.toLowerCase() }, c); }
  const ver = q.v === 'asis' ? 'asis' : 'tobe';
  if (mode === 'asis' || (mode === 'edit' && ver === 'asis')) return { mode, ver, nodes: p.asis || [], key: 'asis', label: 'Today v' + (p.version || 1) };
  return { mode, ver, nodes: p.tobe || [], key: 'tobe', label: 'Future' };
}

/* ---------- render ---------- */
/* R7 §4: has the Future version been made yet? It is created from Today the first time someone opens Future. */
export const needsFuture = p => !!p && !p.tobeForked && !flat(p.tobe).length && flat(p.asis).length > 0;
const FUTURE_HINT = 'Change steps to show how it should work. We’ll highlight what changed.';
export function render(params) {
  if (params.create) return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> › <a href="${link('/processes')}" data-link>Processes</a> › Map a process</div><h1>Map a process</h1><p>Give it a name, then add the steps as they happen today.</p></div><div class="hdr-side"><div class="d-hdrtools"><button class="btn primary" data-new-open>Start</button>${isAdv() ? importBtn() : ''}</div></div></section>`;
  const pid = params.pid;
  const p = store.get('process', pid);
  if (!p) return notFound('Process “' + pid + '”');
  const q = params.q || {};
  const adv = isAdv();
  const editor = canEditProc(p);
  const view = shown(p, q);
  const mode = view.mode, ver = view.ver || 'tobe', rel = view.rel;
  const deniedEdit = q.mode === 'edit' && !editor && !rel;
  const tobe = p.tobe || [], asis = p.asis || [];
  const steps = flat(tobe);
  const diff = mode === 'compare' ? cmpDiff(view.A, view.B) : eng('diffProcess', [p], { nodes: {}, removed: [], changes: {} });
  const sum = diffCounts(p);
  const tdl = [...new Set(steps.flatMap(s => s.data || []))];
  const live = tdl.filter(d => availOf(d) === 'live').length;
  const asisById = {}; flat(asis).forEach(a => asisById[a.id] = a);
  const byId = {}; allNodes(view.nodes).forEach(n => byId[n.id] = n);
  const ctx = { pid, mode: mode === 'compare' ? 'diff' : mode, cmp: mode === 'compare', diff, asisById, byId, readonly: !!rel || mode === 'compare', edit: mode === 'edit' && !rel ? { ver } : null };
  const editing = mode === 'edit' && !rel;
  const futureView = (mode === 'tobe' || (editing && ver === 'tobe'));
  const making = futureView && editor && needsFuture(p); /* bind() creates it; show a short note meanwhile */

  /* tabs: Today · Future · What changed. Advanced adds By person and Who's affected as tabs; in Simple they sit in "⋯ More". */
  const tabOn = k => !rel && (k === 'asis' ? (mode === 'asis' || (editing && ver === 'asis')) : k === 'tobe' ? (mode === 'tobe' || (editing && ver === 'tobe')) : mode === k);
  const modes = [['asis', 'Today'], ['tobe', 'Future'], ['diff', 'What changed']].concat(adv ? [['lanes', 'By person'], ['impact', 'Who’s affected']] : []);
  const rels = (p.released || []).slice().sort((a, b) => b.version - a.version);
  const undo = (undoStack[pid] || []).length ? undoStack[pid][undoStack[pid].length - 1] : null;
  const ownerName = pname(p.owner);
  const menuItem = (attrs, label, title, on) => `<button type="button" class="d-mi ${on ? 'on' : ''}" role="menuitem" ${attrs}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
  const more = `<details class="d-more" data-more><summary class="btn sm" aria-label="More options" data-more-btn>⋯<span class="d-long"> More</span></summary><div class="d-menu" role="menu">
      <label class="d-verlbl">Version <select class="d-sel" data-version aria-label="Version"><option value="" data-ver-current>Current (${esc(verLabel(p))})</option>${rels.map(r => `<option value="${esc(r.version)}" ${rel && rel.version === r.version ? 'selected' : ''}>Released v${esc(r.version)} · ${esc(fmt(String(r.at || '').slice(0, 10)))}</option>`).join('')}</select></label>
      ${menuItem('data-compare-open', 'Compare versions', 'Compare any two of the current, saved and released versions', mode === 'compare')}
      ${editor && !rel ? menuItem('data-save-version', 'Save version', `Keep a named copy of Today and Future (${(p.drafts || []).length}/${MAX_DRAFTS})`) : ''}
      ${editor && !rel && undo ? menuItem('data-undo', 'Undo last change', 'Undo: ' + undo.summary) : ''}
      ${adv ? '' : menuItem(`data-mode="lanes"`, 'By person', 'The Future steps grouped by who does them') + menuItem(`data-mode="impact"`, 'Who’s affected', 'Other steps and projects each Future step affects')}
      ${adv ? menuItem('data-bpmn', 'Download diagram file (BPMN)', 'Download this map as a diagram file other tools can open (BPMN 2.0)') : ''}
      ${!adv || rel || !editor ? '' : importBtn('Import diagram file (BPMN)', 'Import a diagram file (BPMN 2.0) as a new version of this process', 'd-mi')}
    </div></details>`;
  const editBtn = rel || !editor ? '' : editing ? `<button class="btn sm primary" data-edit-done>✓ Done</button>` : `<button class="btn sm d-editbtn" data-mode="edit" aria-label="Edit steps">✎ Edit<span class="d-long"> steps</span></button>`;
  const kpis = adv ? `<div class="kpis"><div class="kpi"><b>${steps.length}</b><span>Future steps</span></div><div class="kpi" data-kpi-diff><b>${stepChangeCounts(p).new}+${stepChangeCounts(p).changed}</b><span>New + changed steps</span></div><div class="kpi"><b>${live}/${tdl.length}</b><span>Information connected</span></div></div>` : '';
  /* phone: everything but the tabs collapses into one summary row so the map starts near the top */
  const vlabel = rel ? 'Released v' + rel.version : mode === 'compare' ? 'Compare' : tabOn('asis') ? 'Today' : tabOn('tobe') ? 'Future' : mode === 'diff' ? 'What changed' : mode === 'lanes' ? 'By person' : 'Who’s affected';
  const vcount = flat(view.nodes).length;
  /* R9 §13: "10 steps · 4 new · 2 changed" (step counts only, so the parts never exceed the whole) */
  const sc = stepChangeCounts(p), scText = view.key === 'tobe' || mode === 'diff' ? changeText(sc) : '';
  const sumrow = `<button type="button" class="d-sumrow" data-hdr-toggle aria-expanded="${hdrOpen}" aria-controls="d-hdrmore"><span data-headline="${vcount}/${sc.new}/${sc.changed}/${sc.removed}"><b>${esc(vlabel)}</b> · ${vcount} step${vcount === 1 ? '' : 's'}${scText ? ` · ${esc(scText)}` : ''}</span><span class="d-sumtog">${hdrOpen ? 'Less ▴' : 'Details ▾'}</span></button>`;
  const side = `<div class="d-tabrow"><div class="seg d-modes" role="tablist" aria-label="Which map">${modes.map(([k, l]) => `<button role="tab" aria-selected="${tabOn(k)}" data-mode="${k}" class="${tabOn(k) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>${editBtn}${more}</div>
    ${sumrow}<div class="d-collapse" id="d-hdrmore">${editor ? '' : `<span class="d-only d-ro" data-readonly>View only · ${esc(askAccess(p))}</span>`}${kpis}</div>`;

  const res = p.resources || [];
  const people = store.state.people;
  const headLeft = editing
    ? `<div class="crumbs"><a href="${link('/')}" data-link>Home</a> › <a href="${link('/processes')}" data-link>Processes</a> › Changing the steps</div>
       <input class="title" data-meta="name" value="${esc(p.name)}" aria-label="Process name" />
       <div class="d-collapse"><textarea data-meta="desc" rows="2" aria-label="Process description" placeholder="One line: what this process does">${esc(p.desc || '')}</textarea>
       <details class="d-hdropts"${adv ? ' open' : ''}><summary>Owner and people who can edit</summary>
       <div class="res"><span class="lbl">Owner</span><select class="d-sel" data-meta="owner" aria-label="Process owner">${people.map(x => `<option value="${esc(x.id)}" ${x.id === p.owner ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
       <div class="res"><span class="lbl">Can edit</span>${res.map(r => `<span class="person">${av(r)}${esc(pname(r))}<button class="d-x" data-res-del="${esc(r)}" aria-label="Remove ${esc(pname(r))}">×</button></span>`).join('')}
         <select class="d-sel" data-res-add aria-label="Add a person who can edit"><option value="">+ Add person</option>${people.filter(x => !res.includes(x.id)).map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div></details></div>`
    : `<div class="crumbs"><a href="${link('/')}" data-link>Home</a> › <a href="${link('/processes')}" data-link>Processes</a>${adv ? ` · <span data-ver-label>${esc(verLabel(p))}</span>${p.tobeFrom && (p.tobeRev || 1) > 1 ? ` <span class="hint" data-ver-from>from ${esc(p.tobeFrom)}</span>` : ''}` : ''}</div><h1>${esc(p.name)}</h1><div class="d-collapse">${p.desc ? `<p class="d-desc">${esc(p.desc)}</p>` : ''}
       <div class="res d-people"><span class="lbl">Owner</span>${personChip(p.owner) || '<span class="hint">None</span>'}${adv ? `<span class="lbl">Can edit</span>${res.map(personChip).join('') || '<span class="hint">Nobody yet</span>'}` : res.length > 1 ? `<span class="d-avs" title="${esc(res.map(pname).join(', '))} can edit">${res.map(av).join('')}</span>` : ''}</div></div>`;

  /* canvas */
  let canvas;
  const modeNote = rel || mode === 'compare' ? '' : futureView ? FUTURE_HINT
    : ({ asis: 'How it works today. Tap a step to see its details.', diff: 'Future compared with Today: what is new, what changed, and what was removed.', lanes: 'The Future steps grouped by who does them.', impact: 'For each Future step: other steps that use the same information, and projects with work on it.', })[mode] || '';
  const roBanner = deniedEdit ? `<div class="d-robanner" role="status" data-edit-denied><b>${LOCK} You can view this process but not change it.</b><span>Only ${esc(ownerName)} (owner) and the people they add can change it. ${esc(askAccess(p))}.</span><button class="btn sm" data-ask-access>Ask ${esc(ownerName)}</button></div>` : '';
  if (rel) canvas = `<div class="d-relbanner" role="status"><b>Released ${esc(fmt(String(rel.at || '').slice(0, 10)))} by ${esc(pname(rel.by))}</b><span>Version ${esc(rel.version)} of the Today map, view only. This is how the process ran before the next release.</span><button class="btn sm" data-version-current>Back to current</button></div>
      ${(rel.asis || []).length ? `<div class="flow">${flowHTML(rel.asis, ctx, 'root')}</div>` : '<div class="empty">This release has no Today map stored.</div>'}`;
  else if (mode === 'compare') {
    const v = Object.values(diff.nodes || {}), same = view.A.key === view.B.key;
    const n = { new: v.filter(x => x === 'new').length, changed: v.filter(x => x === 'changed').length, removed: (diff.removed || []).filter(g => g && g.type !== 'trigger' && g.type !== 'end').length };
    const opts = sel => view.src.map(s => `<option value="${esc(s.key)}" ${s.key === sel ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
    canvas = `<div class="d-cmpbar" role="group" aria-label="Compare versions"><label>From <select class="d-sel" data-cmp="a" aria-label="Compare from">${opts(view.A.key)}</select></label><span class="d-cmparrow" aria-hidden="true">→</span><label>To <select class="d-sel" data-cmp="b" aria-label="Compare to">${opts(view.B.key)}</select></label>
        <span class="d-cmpsum" data-cmp-sum>${same ? 'Pick two different versions' : `${n.new} new · ${n.changed} changed · ${n.removed} removed`}</span></div>
      ${(view.B.nodes || []).length ? `<div class="flow">${flowHTML(view.B.nodes, ctx, 'root')}${same ? '' : removedHTML(diff, n.removed, view.A.label)}</div>` : '<div class="empty">This version has no map.</div>'}`;
  }
  else if (mode === 'lanes') canvas = lanesHTML(tobe, ctx);
  else if (mode === 'impact') canvas = impactHTML(p);
  else if (mode === 'asis') canvas = flat(asis).length || asis.length ? `<div class="flow">${flowHTML(asis, ctx, 'root')}</div>${editor && !flat(asis).length ? '<div class="d-firsthint" role="note">No steps yet. Tap “✎ Edit steps” to add them.</div>' : ''}` : '<div class="empty">No Today map yet.</div>';
  else if (editing) {
    canvas = `<div class="d-editbar" role="group" aria-label="Editor"><span>${ver === 'asis' ? 'Changing <b>Today</b>: how it works now. Tap “+ Add a step”, or + to add one in between.' : 'Changing <b>Future</b>: how it should work.'} Every change is saved.</span>
        ${adv && ver === 'tobe' ? '<button class="btn sm" data-fork title="Replace the Future map with a fresh copy of Today">Start Future again from Today</button>' : ''}</div>
      ${making ? '<div class="d-firsthint" role="status" data-future-making>Making the Future version from Today…</div>' : ''}
      <div class="flow">${flowHTML(view.nodes, ctx, 'root')}</div>`;
  } else canvas = making ? '<div class="d-firsthint" role="status" data-future-making>Making the Future version from Today…</div>' : `<div class="flow">${flowHTML(tobe, ctx, 'root')}${mode === 'diff' ? removedHTML(diff, sum.removed) : ''}</div>`;

  /* side panel: describes the map being shown (Today, released or Future) */
  const vsteps = flat(view.nodes);
  const vname = view.key === 'tobe' ? 'Future' : view.key === 'asis' ? 'Today' : view.key === 'compare' ? view.B.label : 'released Today';
  const dl = [...new Set(vsteps.flatMap(s => s.data || []))];
  const stepGo = s => rel || mode === 'compare' ? '' : `data-go="/process/${esc(pid)}/step/${esc(s.id)}"`;
  /* R8 §8: a step can sit in several groups (one piece missing, another sample only): each group keeps every step it applies to */
  const stepsWith = k => vsteps.filter(s => (s.data || []).some(d => availOf(d) === k));
  const notYetSteps = vsteps.filter(s => (s.data || []).some(d => availOf(d) !== 'live'));
  const missingSteps = adv ? stepsWith('missing') : notYetSteps;
  const pendSteps = adv ? stepsWith('pending') : [];
  const liveSteps = adv ? stepsWith('example') : [];
  const blockNames = s => (s.data || []).filter(d => adv ? availOf(d) === 'missing' : availOf(d) !== 'live').map(d => esc(dataName(d))).join(', ');
  const ord = ['missing', 'pending', 'example', 'live'];
  const dataRows = dl.slice().sort((a, b) => ord.indexOf(availOf(a)) - ord.indexOf(availOf(b))).map(d => {
    const x = dataEl(d) || {}; const u = usage(d, pid);
    return `<div class="row click d-hlrow ${hl === d ? 'hl-on' : ''}" data-hl="${esc(d)}" tabindex="0" role="button" aria-pressed="${hl === d}" aria-label="Highlight steps using ${esc(x.name || d)}"><span style="margin-top:3px">${effDot(d)}</span>
      <div><div class="t">${esc(x.name || d)}</div><div class="s" data-side-owner>${adv ? esc(x.source || 'Source not set') + ' · ' : ''}${esc(dataOwnerName(x))}</div></div>
      <div class="r"><a href="${link('/data/' + d)}" data-link style="color:var(--accent)" data-avail="${esc(availInfo(d).key)}">${esc(avText(d))} ›</a>${effAvail(d) === 'live' && adv ? `<div>${evidenceTag(x, true)}</div>` : ''}${adv ? `<div class="s" data-usage="${u.tobe.length}/${u.asis.length}" title="Steps in this process that use it">${esc(usageText(u))}</div>` : ''}</div></div>`;
  }).join('');
  /* teams involved: the "what starts it" tags count too */
  /* R9 §13: "Teams involved" lists teams only; a system named as a team moves to "Systems touched" */
  const systems = {}; vsteps.forEach(s => { if (s.system) systems[s.system] = (systems[s.system] || 0) + 1; });
  const isSys = t => isSystemName(t) || Object.keys(systems).some(x => x.toLowerCase() === String(t).toLowerCase());
  const touches = {}; [...allNodes(view.nodes).filter(n => n.type === 'trigger'), ...vsteps].forEach(s => (s.touches || []).forEach(t => { if (isSys(t)) systems[t] = (systems[t] || 0) + 1; else touches[t] = (touches[t] || 0) + 1; }));
  const linked = projectsFor(pid);
  const drafts = (p.drafts || []).slice().reverse();
  const versionsCard = rel || (!adv && !drafts.length) ? '' : `<div class="card" data-versions><h3>Saved versions <span class="n">${(p.drafts || []).length}/${MAX_DRAFTS}</span></h3>${drafts.length ? drafts.map(d => `<div class="row" data-draft="${esc(d.id)}"><div style="min-width:0"><div class="t">${esc(d.name)}</div><div class="s">${esc(pname(d.by))} · ${esc(fmtTime(d.at))} · ${flat(d.tobe).length} Future steps</div></div>
      <div class="r d-draftacts"><button class="btn sm" data-draft-cmp="${esc(d.id)}" aria-label="Compare ${esc(d.name)} with the current Future">Compare</button>${editor ? `<button class="btn sm" data-draft-restore="${esc(d.id)}" aria-label="Restore ${esc(d.name)}">Restore</button><button class="btn sm danger" data-draft-del="${esc(d.id)}" aria-label="Delete saved version ${esc(d.name)}">Delete</button>` : ''}</div></div>`).join('') : '<div class="s">No saved versions yet. “Save version” (in ⋯ More) keeps a named copy you can compare or restore.</div>'}</div>`;
  const whoMini = s => s.ownerRole ? `<span class="d-rolesm" data-who>${esc(s.ownerRole)}</span>` : whoAv(s);
  const blockCard = missingSteps.length || pendSteps.length || liveSteps.length || adv ? `<div class="card" data-side-blocked><h3>${LOCK} Steps waiting for information <span class="n">${missingSteps.length}</span></h3><div class="hint" style="margin:-4px 0 8px">In the ${esc(vname)} map</div>${missingSteps.length ? missingSteps.map(s => `<div class="row ${stepGo(s) ? 'click' : ''}" ${stepGo(s)} data-blocked-step="${esc(s.id)}"><div><div class="t">${esc(s.title)}</div><div class="s">Not available yet: ${blockNames(s)}</div></div><div class="r">${whoMini(s)}</div></div>`).join('') : '<div class="s">Every step has the information it needs, or a plan to get it.</div>'}
      ${liveSteps.length ? `<div class="d-needlive-h" data-sample-steps>Sample only: ${NEEDS_LIVE.toLowerCase()} <span class="n">${liveSteps.length}</span></div>${liveSteps.map(s => `<div class="row ${stepGo(s) ? 'click' : ''}" ${stepGo(s)} data-sample-step="${esc(s.id)}"><div><div class="t">${esc(s.title)}</div><div class="s">Sample only: ${s.data.filter(d => availOf(d) === 'example').map(d => esc(dataName(d))).join(', ')}</div></div><div class="r">${whoMini(s)}</div></div>`).join('')}` : ''}
      ${pendSteps.length ? `<div class="d-needlive-h d-pend-h" data-pend-steps>Waiting for confirmation <span class="n">${pendSteps.length}</span></div>${pendSteps.map(s => `<div class="row ${stepGo(s) ? 'click' : ''}" ${stepGo(s)}><div><div class="t">${esc(s.title)}</div><div class="s">${esc(awaitingText(s.data.find(d => availOf(d) === 'pending')))}: ${s.data.filter(d => availOf(d) === 'pending').map(d => esc(dataName(d))).join(', ')}</div></div><div class="r">${whoMini(s)}</div></div>`).join('')}` : ''}</div>` : '';
  const sideHTML = `${blockCard}
    <div class="card" data-side-data="${view.key}"><h3>Information <span class="n">${dl.length}</span></h3><div class="hint" style="margin:-4px 0 8px">What the ${esc(vname)} steps need. Tap one to highlight the steps that use it.</div>${dataRows || '<div class="s">Add information to steps and this list builds itself.</div>'}
      ${rel || !adv ? '' : '<div style="margin-top:10px"><button class="btn sm" data-newdata>+ New information</button></div>'}</div>
    ${Object.keys(touches).length || adv ? `<div class="card" data-touches><h3>Teams involved</h3><div class="chips">${Object.entries(touches).sort((a, b) => b[1] - a[1]).map(([t, c]) => `<span class="chip touch" data-touch="${esc(t)}" title="${c} step${c === 1 ? '' : 's'}">${esc(t)} · ${c} step${c === 1 ? '' : 's'}</span>`).join('') || '<span class="s">No teams added yet.</span>'}</div></div>` : ''}
    ${Object.keys(systems).length ? `<div class="card" data-systems><h3>Systems touched</h3><div class="chips">${Object.entries(systems).sort((a, b) => b[1] - a[1]).map(([t, c]) => `<span class="chip d-syschip" data-system="${esc(t)}">${esc(t)} · ${c} step${c === 1 ? '' : 's'}</span>`).join('')}</div></div>` : ''}
    ${versionsCard}
    <div class="card"><h3>Used in projects <span class="n">${linked.length}</span></h3>${linked.map(j => `<div class="row click" data-go="/project/${esc(j.id)}"><div><div class="t">${esc(j.name)}</div><div class="s">Target ${esc(fmt(j.target))}${j.status === 'live' ? ' · launched' : ''}</div></div><div class="r" style="color:var(--accent)">Open ›</div></div>`).join('') || '<div class="s">Not in a project yet.</div>'}
      ${rel ? '' : startPrjHTML(p, steps)}</div>
    ${activityCard('process:' + pid)}`;

  return `<section class="hdr d-hdr ${hdrOpen ? 'd-hdr-open' : ''} ${adv ? 'd-adv' : 'd-simple'}"><div>${headLeft}</div><div class="hdr-side">${side}</div></section>
    <div class="grid"><section class="canvas ${editing ? 'd-edit' : ''}" id="canvas" aria-label="Process map">${roBanner}${modeNote ? `<div class="hint d-modenote" data-modenote style="text-align:center;margin:-8px 0 14px">${esc(modeNote)}</div>` : ''}${canvas}</section>
    <aside class="side d-sidefold" aria-label="About this map">${sideHTML}</aside></div>`;
}

/* R9 §4: a project plans the change from Today to Future, so it can only start once the Future differs from Today */
function startPrjHTML(p, steps) {
  const c = stepChangeCounts(p), any = c.new + c.changed + c.removed > 0 || diffCounts(p).new + diffCounts(p).changed + diffCounts(p).removed > 0;
  if (!steps.length) return '<div class="d-startprj"><span class="hint">Add the Future steps, then start a project from them.</span></div>';
  return `<div class="d-startprj" data-start-gate="${any ? 'on' : 'off'}"><button class="btn sm primary" data-start-project ${any ? '' : 'disabled aria-disabled="true" aria-describedby="d-startprj-h"'}>Start a project from this Future</button><span class="hint" id="d-startprj-h" data-start-hint>${any ? 'Plans the work to get from Today to Future.' : 'Change a Future step first'}</span></div>`;
}

/* ---------- persistence ---------- */
/* every process write goes through here: it keeps the previous snapshot for "Undo last change" and turns a
   server permission refusal (403) into a plain message instead of an error */
export function deniedMsg(p) { return `You can view this process but not edit it. ${askAccess(p)}.`; }
async function saveProc(p, summary, opts) {
  opts = opts || {};
  const prev = store.get('process', p.id);
  if (prev && !canEditProc(prev)) { toast(deniedMsg(prev)); return false; }
  try {
    await store.save('process', p.id, p, summary);
    if (prev && !opts.noUndo) { const st = undoStack[p.id] || (undoStack[p.id] = []); st.push({ doc: clone(prev), summary }); if (st.length > 20) st.shift(); store.emit(); }
    if (!opts.quiet) toast(summary);
    return true;
  } catch (e) {
    if (e.status === 403) { store.state.error = null; toast(deniedMsg(store.get('process', p.id) || prev || p)); store.emit(); }
    else toast('Could not save: ' + e.message);
    return false;
  }
}

/* ---------- modals ---------- */
const personOpts = sel => store.state.people.map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)} — ${esc(x.role || '')}</option>`).join('');
/* R9 §13: Simple asks one positive thing, a "We have it" switch (on = we have it). Advanced keeps the detailed choice. */
export const AVAIL_OPT = { live: 'We have it (connected)', example: 'Sample only', missing: 'Not available yet' };
export const availOpts = sel => Object.entries(AVAIL_OPT).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
/* the availability control for a form: a select named `avail` (Advanced) or a tick box named `notyet` (Simple) */
export const availField = (sel, attrs) => isAdv()
  ? `<div class="field"><label>Do we have it?</label><select name="avail" ${attrs || ''}>${availOpts(sel)}</select></div>`
  : `<div class="field d-nyfield"><label class="d-check d-switch d-havecheck"><input type="checkbox" role="switch" name="have" value="yes" ${sel === 'live' ? 'checked' : ''} ${attrs || ''} /> <span>${HAVE}</span></label><span class="hint">Switch it off if we don’t have this yet.</span></div>`;
/* reads availField back: Simple switch on = live, off = missing; Advanced keeps a sample-only choice */
export const availFrom = form => form.avail != null && form.avail !== '' && !Array.isArray(form.avail) ? form.avail : [].concat(form.have || []).filter(Boolean).length ? 'live' : 'missing';
const allData = () => store.list('dataElement').slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
const availDot = a => `<span class="dot" style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${avOf(a).color}" title="${esc(avOf(a).label)}"></span>`;
const dataCheck = (name, d, on, pending) => `<label class="d-pick ${pending ? 'd-pending' : ''}"><input type="checkbox" name="${esc(name)}" value="${esc(d.id)}" ${on ? 'checked' : ''} />${pending ? availDot(d.avail) : effDot(d.id)}<span>${esc(d.name)}${pending ? ' <small>(new)</small>' : ''}</span></label>`;
function subRow(s, k) {
  const sel = new Set((s && s.data) || []);
  return `<div class="d-subrow" data-subrow>
    <div class="d-subhead"><input name="sub_title" aria-label="Detail step ${k + 1} title" placeholder="Detail step title" value="${esc((s && s.title) || '')}" /><button type="button" class="btn sm danger" data-subdel aria-label="Remove detail step">Remove</button></div>
    <div class="d-picks d-picks-sm" data-subpicks>${allData().map(d => dataCheck('sub_data', d, sel.has(d.id))).join('')}</div></div>`;
}
/* default state for information first added on a map: Today = we have it; Future = not available yet */
export const defaultAvail = ver => ver === 'asis' ? 'live' : 'missing';

export async function newDataModal(defaults) {
  defaults = defaults || {};
  const r = await modal({
    title: 'New information',
    body: `${defaults.error ? `<div class="banner d-err" role="alert">${esc(defaults.error)}</div>` : ''}<div class="field"><label>Name</label><input name="name" value="${esc(defaults.name || '')}" placeholder="e.g. Vendor bank account" /></div>
      <div class="frow"><div class="field"><label>Owner</label><select name="owner">${personOpts(defaults.owner || store.state.me)}</select><span class="hint">You own it unless you pick someone else. The owner sets its rules and ${isAdv() ? 'confirms it is connected' : 'confirms we have it'}.</span></div>
      ${availField(defaults.avail || 'missing')}</div>
      <div class="field"><label>Where it comes from</label><input name="source" placeholder="e.g. Finance system" value="${esc(defaults.source || '')}" /></div>
      <div class="field"><label>Note</label><textarea name="note" placeholder="What exists today, and what is needed">${esc(defaults.note || '')}</textarea></div>`,
    actions: [{ id: 'save', label: 'Create', primary: true }],
  });
  if (r.action !== 'save') return null;
  const name = (r.form.name || '').trim();
  if (!name) return newDataModal(Object.assign({}, r.form, { avail: availFrom(r.form), error: 'Give the information a name.' }));
  const dup = dupDataName(name);
  if (dup) return newDataModal(Object.assign({}, r.form, { avail: availFrom(r.form), error: `Information called '${dup.name}' already exists. Use it, or choose a different name.` }));
  const id = store.newId('de');
  const data = { id, name, owner: r.form.owner, source: r.form.source.trim(), avail: availFrom(r.form), note: r.form.note.trim(), fields: [], samples: [], discovered: [] };
  try { await store.save('dataElement', id, data, `Created information '${name}'`); toast(`Created '${name}'`); return data; }
  catch (e) { toast('Could not save: ' + e.message); return null; }
}

/* R7 §4: "Who does it" is a person or a free-text role. A typed name that matches a person (full name, or a unique
   first name) is that person; anything else is a role, stored as ownerRole, with the process owner kept as the
   accountable person so readiness checks and sign-off still have someone. */
export function parseWho(text, p) {
  const t = String(text || '').trim(); const people = store.state.people;
  const fallback = (p && p.owner) || store.state.me;
  if (!t) return { owner: fallback };
  const k = t.toLowerCase().replace(/\s+—\s+.*$/, '');
  const hit = people.find(x => x.name.toLowerCase() === k) || (people.filter(x => x.name.split(' ')[0].toLowerCase() === k).length === 1 ? people.find(x => x.name.split(' ')[0].toLowerCase() === k) : null);
  return hit ? { owner: hit.id } : { owner: fallback, ownerRole: t };
}
const peopleList = () => `<datalist id="d-people">${store.state.people.map(x => `<option value="${esc(x.name)}">${esc(x.role || '')}</option>`).join('')}</datalist>`;
const infoList = () => `<datalist id="d-infos">${allData().map(d => `<option value="${esc(d.name)}"></option>`).join('')}</datalist>`;
/* an information chip; new information (no id yet) carries its own "not available yet" tick box (R8 §1) */
const chipHTML = c => `<span class="d-ichip" data-ichip="${esc(c.id || '')}" data-iname="${esc(c.name)}">${c.id ? effDot(c.id) : availDot(c.avail === 'live' ? 'live' : 'missing')}<span>${esc(c.name)}</span>${c.id || c.fixed ? '' : `<label class="d-ny d-have" title="Switch off if we do not have ${esc(c.name)} yet"><input type="checkbox" role="switch" data-have aria-label="${esc(c.name)}: ${HAVE.toLowerCase()}" ${c.avail === 'live' ? 'checked' : ''} />${HAVE.toLowerCase()}</label>`}<button type="button" class="d-x" data-ichip-del aria-label="Remove ${esc(c.name)}">×</button></span>`;

/* R6: the step dialog also edits the typed nodes. Subprocess picks the process it calls; wait sets how long;
   message sets the direction and the external party. Waits carry no information or sub-steps.
   R7: three fields up front (name, who, information); everything else under "More options".
   Returns { node, next } where next means "Enter: add this step and open the next one". */
const PH = { step: 'e.g. Check the invoice', subprocess: 'e.g. Run vendor onboarding', wait: 'e.g. Wait 2 business days for the vendor', message: 'e.g. Tell the vendor' };
async function stepModal(p, ver, node, opts) {
  opts = opts || {};
  const adv = isAdv();
  const kind = NT[node.type] ? node.type : 'step', lbl = kind === 'step' ? 'step' : NT[kind].label.toLowerCase();
  const isNew = !node.title;
  /* R8 §7: on a phone the keyboard has no reliable Enter, so "Add step" keeps the dialog going and "Done adding" ends it */
  const phoneQuick = !!(isNew && opts.quick && typeof window !== 'undefined' && window.innerWidth <= 640);
  const asisSteps = flat(p.asis);
  const pending = []; /* information created inline (More options): saved only when the step is saved */
  const others = store.list('process', x => x.id !== p.id).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const chips = (node.data || []).map(id => ({ id, name: dataName(id) }));
  const whoVal = node.ownerRole || (node.owner ? pname(node.owner) : opts.who || pname(store.state.me));
  const typeFields = kind === 'subprocess' ? `<div class="field"><label>Which process it runs</label>${others.length ? `<select name="calls" data-calls-sel>${others.map(x => `<option value="${esc(x.id)}" ${x.id === node.calls ? 'selected' : ''}>${esc(x.name)} · ${flat(x.tobe).length} steps</option>`).join('')}</select>` : '<div class="hint fail">There is no other process to run yet. Create it first.</div>'}<span class="hint">Opening this step opens that process. Its steps stay in that process.</span></div>`
    : kind === 'wait' ? `<div class="field"><label>How long to wait</label><input name="wait" value="${esc(node.wait || '')}" placeholder="e.g. 2 business days" /></div>`
    : kind === 'message' ? `<div class="frow"><div class="field"><label>Direction</label><select name="direction"><option value="send" ${node.direction !== 'receive' ? 'selected' : ''}>We send it</option><option value="receive" ${node.direction === 'receive' ? 'selected' : ''}>We receive it</option></select></div>
        <div class="field"><label>Who outside</label><input name="party" value="${esc(node.party || '')}" placeholder="e.g. Vendor" /></div></div>` : '';
  const hasData = kind !== 'wait';
  const moreOpen = adv; /* Advanced users see every option; Simple keeps them folded */
  const pr = modal({
    title: kind === 'step' ? `${isNew ? 'Add a step' : 'Edit step'} · ${VER[ver]}` : `${isNew ? 'Add' : 'Edit'}: ${NT[kind].label} · ${VER[ver]}`,
    body: `${kind !== 'step' ? `<div class="d-ntbanner ${NT[kind].cls}">${NT[kind].icon}<b>${esc(NT[kind].label)}</b></div>` : ''}${typeFields}
      <div class="field"><label for="d-f-title">Step name</label><input id="d-f-title" name="title" value="${esc(node.title || '')}" placeholder="${esc(PH[kind])}" autocomplete="off" enterkeyhint="${isNew && opts.quick ? 'next' : 'done'}" />${kind !== 'step' ? '<span class="hint">Leave blank for a name made from the fields above.</span>' : ''}</div>
      <div class="field"><label for="d-f-who">Who does it</label><input id="d-f-who" name="who" list="d-people" value="${esc(whoVal)}" placeholder="A person, or a role such as Manager" autocomplete="off" enterkeyhint="${isNew && opts.quick ? 'next' : 'done'}" data-who-input />${peopleList()}</div>
      ${hasData ? `<div class="field"><label for="d-f-info">What information it needs</label><div class="d-chipbox" data-chipbox>${chips.map(chipHTML).join('')}<input id="d-f-info" list="d-infos" data-info-input placeholder="${chips.length ? 'Add more…' : 'e.g. Invoice number, Due date'}" autocomplete="off" enterkeyhint="${isNew && opts.quick ? 'next' : 'done'}" aria-describedby="d-f-info-h" /></div>${infoList()}
        <span class="hint" id="d-f-info-h" data-avail-help>Separate several with commas. Each new piece of information has a “${HAVE}” switch. Here it starts ${ver === 'asis' ? 'on' : 'off'}.</span></div>` : ''}
      ${isNew && opts.quick ? `<div class="hint d-quickhint">${phoneQuick ? 'Tap “Add step” to save it and start the next one. Tap “Done adding” when you have finished.' : 'Press Enter to add this step and start the next one.'}</div>` : ''}
      <details class="d-moreopts" data-more-options${moreOpen ? ' open' : ''}><summary>More options</summary><div class="d-moreopts-b">
      ${ver === 'tobe' ? `<div class="field"><label>Replaces this step from Today</label><select name="from"><option value="">None: new in Future</option>${asisSteps.map(a => `<option value="${esc(a.id)}" ${a.id === node.from ? 'selected' : ''}>${esc(a.title)}</option>`).join('')}</select></div>` : ''}
      ${kind === 'wait' ? '' : `<div class="frow d-frow3"><div class="field"><label>Time limit</label><input name="sla" value="${esc(node.sla || '')}" placeholder="e.g. 2 business days" /></div>
        <div class="field"><label>System used</label><input name="system" value="${esc(node.system || '')}" placeholder="e.g. Finance system" /></div>
        <div class="field"><label>How long (hours)</label><input name="durationHrs" type="number" min="0" step="0.25" inputmode="decimal" value="${esc(node.durationHrs != null ? node.durationHrs : '')}" /></div></div>`}
      <div class="field"><label>Teams involved (separate with commas)</label><input name="touches" value="${esc((node.touches || []).join(', '))}" placeholder="e.g. Finance, Legal" /></div>
      ${hasData ? `<div class="field"><label>Add information with a different owner or source</label>
        <div class="d-inline-new" data-nd-row><input data-nd-name placeholder="Information name" aria-label="New information name" /><select data-nd-avail aria-label="Do we have it?">${availOpts(defaultAvail(ver))}</select>
          <select data-nd-owner aria-label="Owner of the new information" title="Owner (defaults to whoever does the step)"><option value="" selected>Owner: whoever does the step</option>${store.state.people.map(x => `<option value="${esc(x.id)}">${esc(x.name)}${x.id === store.state.me ? ' (me)' : ''}</option>`).join('')}</select>
          <input data-nd-source placeholder="Where it comes from, e.g. Finance system" aria-label="Where the new information comes from" />
          <button type="button" class="btn sm" data-nd-create>Create and add</button></div>
        <div class="hint" data-nd-msg aria-live="polite"></div></div>` : ''}
      ${kind === 'step' ? `<div class="field"><label>Detail steps: how this step is done</label><div data-subs>${(node.subs || []).map(subRow).join('')}</div><div><button type="button" class="btn sm" data-subadd>+ Add detail step</button></div></div>` : ''}
      </div></details>`,
    actions: [{ id: 'save', label: isNew ? (kind === 'step' ? 'Add step' : 'Add') : 'Save', primary: true }].concat(phoneQuick ? [{ id: 'done', label: 'Done adding' }] : []),
  });
  const m = [...document.querySelectorAll('.overlay .modal')].pop();
  let next = false;
  /* R8 queue: a step needs a name (inline message, the dialog stays open). "Done adding" with an empty name just closes. */
  m.parentNode.addEventListener('click', e => {
    const b = e.target.closest('[data-act="save"],[data-act="done"]'); if (!b || kind !== 'step') return;
    const t = m.querySelector('#d-f-title'); if (!t || t.value.trim()) return;
    if (b.dataset.act === 'done') return;
    e.stopPropagation(); e.preventDefault();
    let er = m.querySelector('[data-title-err]');
    if (!er) { t.insertAdjacentHTML('afterend', `<span class="hint fail" data-title-err role="alert">Type a name for the step${phoneQuick ? ', or tap “Done adding”' : ''}.</span>`); er = m.querySelector('[data-title-err]'); }
    t.setAttribute('aria-invalid', 'true'); t.focus();
  }, true);
  m.querySelector('#d-f-title').addEventListener('input', e => { const er = m.querySelector('[data-title-err]'); if (er && e.target.value.trim()) { er.remove(); e.target.removeAttribute('aria-invalid'); } });
  /* information chips */
  const box = m.querySelector('[data-chipbox]'), infoEl = m.querySelector('[data-info-input]');
  const chipNames = () => [...m.querySelectorAll('[data-ichip]')].map(c => c.dataset.iname.toLowerCase());
  const addChip = (name, meta) => {
    name = String(name || '').trim(); if (!name || !box) return;
    if (chipNames().includes(name.toLowerCase())) return;
    const hit = dupDataName(name, null, pending), isPend = !!hit && pending.includes(hit);
    const c = hit && !isPend ? { id: hit.id, name: hit.name } : { id: '', name: hit ? hit.name : name, avail: hit ? hit.avail : defaultAvail(ver), fixed: isPend };
    infoEl.insertAdjacentHTML('beforebegin', chipHTML(c));
    const el = infoEl.previousElementSibling; if (isPend) el.dataset.pendingId = hit.id;
    infoEl.placeholder = 'Add more…';
  };
  const flushInfo = () => { if (!infoEl) return; const parts = infoEl.value.split(','); infoEl.value = ''; parts.forEach(x => addChip(x)); };
  if (infoEl) {
    infoEl.addEventListener('input', () => { if (infoEl.value.includes(',')) { const parts = infoEl.value.split(','); infoEl.value = parts.pop(); parts.forEach(x => addChip(x)); } });
    infoEl.addEventListener('change', () => { /* picking a suggestion adds it */ if (allData().some(d => d.name.toLowerCase() === infoEl.value.trim().toLowerCase())) flushInfo(); });
    infoEl.addEventListener('blur', flushInfo);
    infoEl.addEventListener('keydown', e => { if (e.key === 'Backspace' && !infoEl.value) { const last = infoEl.previousElementSibling; if (last && last.matches('[data-ichip]')) last.remove(); } });
    box.addEventListener('click', e => { const b = e.target.closest('[data-ichip-del]'); if (b) { b.closest('[data-ichip]').remove(); infoEl.focus(); } else if (e.target === box) infoEl.focus(); });
    box.addEventListener('change', e => { const t = e.target.closest('[data-have]'); if (!t) return; const dot = t.closest('[data-ichip]').querySelector('.dot'); if (dot) dot.outerHTML = availDot(t.checked ? 'live' : 'missing'); });
  }
  /* Enter in the three main fields: add the step (and start the next one when quick-adding) */
  m.querySelectorAll('#d-f-title, #d-f-who, #d-f-info').forEach(el => el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault(); flushInfo();
    next = !!(isNew && opts.quick);
    const sb = m.parentNode.querySelector('[data-act="save"]'); if (sb) sb.click();
  }));
  m.querySelector('#d-f-who').addEventListener('focus', e => e.target.select());
  const subs = m.querySelector('[data-subs]');
  if (subs) m.querySelector('[data-subadd]').onclick = () => {
    subs.insertAdjacentHTML('beforeend', subRow(null, subs.children.length));
    const sbox = subs.lastElementChild.querySelector('[data-subpicks]'); pending.forEach(d => sbox.insertAdjacentHTML('beforeend', dataCheck('sub_data', d, false, true)));
    subs.lastElementChild.querySelector('input').focus();
  };
  if (subs) subs.addEventListener('click', e => { const b = e.target.closest('[data-subdel]'); if (b) b.closest('[data-subrow]').remove(); });
  const msg = m.querySelector('[data-nd-msg]');
  const nameEl = m.querySelector('[data-nd-name]');
  const create = () => {
    const name = nameEl.value.trim(); if (!name) { nameEl.focus(); return; }
    const dup = dupDataName(name, null, pending);
    if (dup) { msg.textContent = `'${dup.name}' already exists${pending.includes(dup) ? ' in this step' : ''}. Type it in “What information it needs” instead.`; msg.className = 'hint fail'; nameEl.focus(); return; }
    const d = { id: store.newId('de'), name, avail: m.querySelector('[data-nd-avail]').value, owner: m.querySelector('[data-nd-owner]').value || '', source: m.querySelector('[data-nd-source]').value.trim() };
    pending.push(d);
    addChip(name, { pid: d.id, avail: d.avail });
    m.querySelectorAll('[data-subpicks]').forEach(b => b.insertAdjacentHTML('beforeend', dataCheck('sub_data', d, false, true)));
    nameEl.value = ''; m.querySelector('[data-nd-source]').value = ''; msg.className = 'hint';
    msg.textContent = `'${name}' will be created when you save the ${lbl}, owned by ${!d.owner ? 'whoever does the step' : d.owner === store.state.me ? 'you' : pname(d.owner)}${d.source ? ', from ' + d.source : ''}.`;
  };
  if (nameEl) { m.querySelector('[data-nd-create]').onclick = create; nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); create(); } }); }
  const r = await pr;
  if (r.action === 'done') { if (!(r.form.title || '').trim()) return null; next = false; }
  else if (r.action !== 'save') return null; /* cancelled: pending information is discarded */
  else if (phoneQuick) next = true;
  const root = r.root;
  const hrs = parseFloat(r.form.durationHrs);
  const who = parseWho(r.form.who, p);
  /* chips -> data ids (existing by name, new ones created below) */
  const chipEls = [...root.querySelectorAll('[data-ichip]')];
  const created = [];
  const dataIds = chipEls.map(c => {
    if (c.dataset.ichip) return c.dataset.ichip;
    if (c.dataset.pendingId) { const d = pending.find(x => x.id === c.dataset.pendingId); if (d) { created.push(d); return d.id; } }
    const hit = dupDataName(c.dataset.iname); if (hit) return hit.id;
    const hv = c.querySelector('[data-have]');
    const d = { id: store.newId('de'), name: c.dataset.iname, avail: hv ? (hv.checked ? 'live' : 'missing') : defaultAvail(ver), owner: '', source: '' };
    created.push(d); return d.id;
  });
  const out = Object.assign({}, node, {
    type: kind,
    title: (r.form.title || '').trim(),
    owner: who.owner,
    data: [...new Set(dataIds)],
    touches: (r.form.touches || '').split(',').map(x => x.trim()).filter(Boolean),
    subs: [...root.querySelectorAll('[data-subrow]')].map(row => ({ title: row.querySelector('[name=sub_title]').value.trim(), data: [...row.querySelectorAll('input[name=sub_data]:checked')].map(i => i.value) })).filter(s => s.title),
  });
  if (who.ownerRole) out.ownerRole = who.ownerRole; else delete out.ownerRole;
  if (kind === 'wait') out.data = [];
  ['sla', 'system'].forEach(k => { const v = (r.form[k] || '').trim(); if (v) out[k] = v; else delete out[k]; });
  if (isFinite(hrs) && hrs > 0) out.durationHrs = hrs; else delete out.durationHrs;
  if (kind === 'wait') { out.wait = (r.form.wait || '').trim() || '1 business day'; if (!out.title) out.title = 'Wait ' + out.wait; }
  if (kind === 'message') { out.direction = r.form.direction === 'receive' ? 'receive' : 'send'; out.party = (r.form.party || '').trim() || 'External party'; if (!out.title) out.title = (out.direction === 'send' ? 'Notify ' : 'Receive from ') + out.party.toLowerCase(); }
  if (kind === 'subprocess') { if (r.form.calls) { out.calls = r.form.calls; delete out.callsName; } const cp = calledOf(out); if (!out.title) out.title = 'Run ' + (cp && cp.p ? cp.p.name : 'subprocess'); }
  if (!out.title) out.title = 'Untitled step';
  if (ver === 'tobe') { if (r.form.from) out.from = r.form.from; else delete out.from; }
  /* create the new information this step (or its sub-steps) actually uses */
  const used = new Set([...out.data, ...out.subs.flatMap(x => x.data)]);
  pending.filter(x => used.has(x.id) && !created.includes(x)).forEach(x => created.push(x));
  for (const d of created) {
    if (dupDataName(d.name)) { const hit = dupDataName(d.name); out.data = out.data.map(x => x === d.id ? hit.id : x); continue; }
    /* R8 §1: new information belongs to whoever does the step (a person, or the role with its accountable person) */
    const doc = { id: d.id, name: d.name, owner: d.owner || out.owner || store.state.me, source: d.source || '', avail: d.avail, note: `Added from the step '${out.title}'.`, fields: [], samples: [], discovered: [] };
    if (!d.owner && out.ownerRole) doc.ownerRole = out.ownerRole;
    try { await store.save('dataElement', d.id, doc, `Created information '${d.name}'`); }
    catch (e) { toast('Could not save: ' + e.message); out.data = out.data.filter(x => x !== d.id); }
  }
  out.data = [...new Set(out.data)];
  return { node: out, next, who: r.form.who };
}

function branchRow(b, targets) {
  return `<div class="d-brow" data-brow><input name="blabel" value="${esc(b ? b.label : '')}" placeholder="Path name, e.g. Yes" aria-label="Path name" data-keep="${b && b.keep != null ? b.keep : ''}" />
    ${targets ? `<select name="bgoto" aria-label="Then" class="d-goto-sel"><option value="">Then continue</option>${targets.map(t => `<option value="${esc(t.id)}" ${b && b.goto === t.id ? 'selected' : ''}>↩ Go back to ${esc(t.title)}</option>`).join('')}</select>` : ''}
    <button type="button" class="btn sm danger" data-bdel aria-label="Remove path">Remove</button></div>`;
}
/* decision (exclusive, optional loop-backs) or parallel gateway (all branches run) */
async function decisionModal(node, kind, versionNodes) {
  const isNew = !node.title, par = kind === 'parallel';
  const targets = par ? null : allNodes(versionNodes || []).filter(n => isStep(n) || n.type === 'trigger').filter(n => !flat([node]).some(x => x.id === n.id));
  const bs = (node.branches && node.branches.length) ? node.branches.map((b, i) => ({ label: b.label, keep: i, goto: b.goto })) : (par ? [{ label: 'Track A' }, { label: 'Track B' }] : [{ label: 'Yes' }, { label: 'No' }]);
  const what = par ? 'things at the same time' : 'choice';
  const pr = modal({
    title: par ? (isNew ? 'Add things that happen at the same time' : 'Edit: at the same time') : (isNew ? 'Add a choice' : 'Edit choice'),
    body: `<div class="field"><label>${par ? 'What happens at the same time' : 'The question'}</label><input name="title" value="${esc(node.title || '')}" placeholder="${par ? 'e.g. Set up the vendor' : 'e.g. Is the amount over $5,000?'}" /></div>
      <div class="field"><label>Paths</label><div data-branches class="${par || isAdv() ? '' : 'd-nogoto'}">${bs.map(b => branchRow(b, targets)).join('')}</div><div><button type="button" class="btn sm" data-badd>+ Add path</button></div>
      <span class="hint">${par ? 'Every path happens; the process continues when all are done.' : 'Only one path is taken.'} At least 2 paths. Removing a path removes the steps on it.</span></div>
      ${par ? '' : `<details class="d-moreopts" data-more-options${isAdv() || (node.branches || []).some(b => b.goto) ? ' open' : ''}><summary>More options</summary><div class="d-moreopts-b"><label class="d-check"><input type="checkbox" data-show-goto ${isAdv() || (node.branches || []).some(b => b.goto) ? 'checked' : ''} /> A path can go back to an earlier step (e.g. “Incomplete → back to Collect information”)</label></div></details>`}`,
    actions: [{ id: 'save', label: isNew ? 'Add' : 'Save', primary: true }],
  });
  const m = [...document.querySelectorAll('.overlay .modal')].pop();
  const box = m.querySelector('[data-branches]');
  const sg = m.querySelector('[data-show-goto]'); const syncGoto = () => box.classList.toggle('d-nogoto', !!sg && !sg.checked); if (sg) { sg.onchange = syncGoto; syncGoto(); }
  m.querySelector('[data-badd]').onclick = () => { box.insertAdjacentHTML('beforeend', branchRow(null, targets)); box.lastElementChild.querySelector('input').focus(); };
  box.addEventListener('click', e => { const b = e.target.closest('[data-bdel]'); if (!b) return; if (box.children.length <= 2) { toast('A choice needs at least 2 paths'); return; } b.closest('[data-brow]').remove(); });
  const r = await pr;
  if (r.action !== 'save') return null;
  const old = node.branches || [];
  const branches = [...r.root.querySelectorAll('[data-brow]')].map((row, i) => {
    const inp = row.querySelector('input[name=blabel]'), g = row.querySelector('select[name=bgoto]');
    const b = { label: inp.value.trim() || 'Path ' + (i + 1), nodes: inp.dataset.keep !== '' && old[+inp.dataset.keep] ? old[+inp.dataset.keep].nodes : [] };
    if (g && g.value && !r.root.querySelector('[data-branches].d-nogoto')) b.goto = g.value;
    return b;
  });
  return Object.assign({}, node, { type: par ? 'parallel' : 'decision', title: (r.form.title || '').trim() || (par ? 'In parallel' : 'Decision'), branches });
}
async function simpleNodeModal(node) {
  const trig = node.type === 'trigger';
  const r = await modal({
    title: trig ? 'What starts it?' : 'Edit the end',
    body: `<div class="field"><label>${trig ? 'What starts it' : 'How it ends'}</label><input name="title" value="${esc(trig ? trigTitle(node) : (node.title || ''))}" placeholder="${trig ? 'e.g. A vendor sends a request' : 'e.g. Process complete'}" /></div>
      ${trig ? `<details class="d-moreopts"${isAdv() ? ' open' : ''}><summary>More options</summary><div class="d-moreopts-b"><div class="field"><label>Owner</label><select name="owner">${personOpts(node.owner || store.state.me)}</select></div><div class="field"><label>Teams involved (separate with commas)</label><input name="touches" value="${esc((node.touches || []).join(', '))}" /></div></div></details>` : ''}`,
    actions: [{ id: 'save', label: 'Save', primary: true }],
  });
  if (r.action !== 'save') return null;
  const out = Object.assign({}, node, { title: (r.form.title || '').trim() || (trig ? '' : node.title) });
  if (trig) { out.owner = r.form.owner; out.touches = (r.form.touches || '').split(',').map(x => x.trim()).filter(Boolean); }
  return out;
}
export const confirmBox = async (title, text, label) => (await modal({ title, body: `<p style="margin:0">${esc(text)}</p>`, actions: [{ id: 'yes', label: label || 'Confirm', danger: true }] })).action === 'yes';

/* ---------- BPMN import + start project ---------- */
export function importBtn(label, aria, cls) { return `<label class="${cls || 'btn sm'} d-import">${esc(label || 'Import BPMN')}<input type="file" accept=".bpmn,.xml,application/xml,text/xml" data-bpmn-file class="d-sr" aria-label="${esc(aria || 'Import a BPMN 2.0 file (.bpmn or .xml)')}" /></label>`; }
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const droppedHTML = list => `<div class="d-dropped" data-dropped="${list.length}"><b>Dropped elements <span class="n">${list.length}</span></b>${list.length ? `<ul>${list.slice(0, 25).map(d => `<li><b>${esc(d.name)}</b> <span class="hint">${esc(d.type)}: ${esc(d.reason)}</span></li>`).join('')}${list.length > 25 ? `<li class="hint">and ${list.length - 25} more</li>` : ''}</ul>` : '<div class="hint">None: every element in the file maps to PMOFlow.</div>'}</div>`;
/* bindImport(root): the process index and /new create a new process from the file.
   bindImport(root, pid): on a process page the file becomes a new version of that process's to-be. */
export function bindImport(root, pid) {
  root.querySelectorAll('[data-bpmn-file]').forEach(inp => inp.onchange = async () => {
    const file = inp.files && inp.files[0]; inp.value = ''; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('That file is over 2 MB. Export a single process.'); return; }
    let r;
    try { r = parseBpmn(await file.text(), store.state.people, store.state.me); }
    catch (e) { await modal({ title: 'Could not import BPMN', body: `<p style="margin:0">${esc(e.message)}</p><p class="hint">PMOFlow reads BPMN 2.0 XML: start and end events, tasks, exclusive and parallel gateways, sequence flows and lanes.</p>`, actions: [] }); return; }
    if (!r.steps) { toast('No tasks found in that BPMN file'); return; }
    if (pid) { await importVersion(pid, r, file.name); return; }
    const name = r.name || file.name.replace(/\.(bpmn|xml)$/i, '') || 'Imported process';
    const id = store.newId('proc');
    allNodes(r.nodes).forEach(n => delete n.pmoId); /* a new process: the ids in the file belong to some other map */
    const asis = r.nodes, tobe = forkNodes(asis);
    const owners = [...new Set(flat(asis).map(n => n.owner).filter(Boolean))];
    const p = { id, name, desc: r.desc || `Imported from ${file.name}.`, owner: store.state.me, resources: [...new Set([store.state.me, ...owners])], version: 1, asis, tobe, released: [] };
    try {
      await createImportedData(r.newData, file.name);
      await store.save('process', id, p, `Imported process '${name}' from BPMN (${plural(r.steps, 'step')}, ${plural(r.gateways, 'gateway')})`);
      toast(`Imported '${name}': ${plural(r.steps, 'step')}, ${plural(r.gateways, 'gateway')}${r.dropped.length ? `, ${r.dropped.length} dropped` : ''}${r.newData.length ? `, ${plural(r.newData.length, 'new data element')}` : ''}${r.unknownLanes.length ? `. Lanes not matched to a person were assigned to you: ${r.unknownLanes.join(', ')}` : ''}`);
      go(`/process/${id}?mode=edit`);
    } catch (e) { toast('Could not import: ' + e.message); }
  });
}

/* R5: merge an imported map into this process's to-be. R8 §8: nodes are matched by the PMOFlow id the file carries
   (extensionElements, set on export) first, then by name (and kind). A matched step keeps its id, so its work items stay
   attached, along with its data tags, sub-steps, touches, owner and Today link. A step matched by id under a new name
   is reported as renamed. */
const nkey = n => (isGw(n) || isSpecial(n) ? n.type : n.type === 'trigger' || n.type === 'end' ? n.type : 'step') + '|' + String((n.type === 'trigger' ? trigTitle(n) : n.title) || '').trim().toLowerCase().replace(/\s+/g, ' ');
const kindOf = n => n.type === 'trigger' || n.type === 'end' ? n.type : isGw(n) ? 'gw' : 'step';
export function mergeImport(oldNodes, newNodes, laneOwned, extIds) {
  /* R6: a node that carried PMOFlow extension data keeps what the file says (lossless); a foreign node keeps the old tags */
  const fromFile = n => !!(extIds && extIds.has(n.id));
  const olds = allNodes(oldNodes), byOld = {}; olds.forEach(n => byOld[n.id] = n);
  const used = new Set(), byNewId = {};
  /* pass 1: reserve every id match, so a name match can never take a node another node claims by id */
  allNodes(newNodes).forEach(n => { const o = n.pmoId && byOld[n.pmoId]; if (o && !used.has(o.id) && kindOf(o) === kindOf(n)) { used.add(o.id); byNewId[n.id] = o; } });
  const pool = {}; olds.forEach(n => (pool[nkey(n)] = pool[nkey(n)] || []).push(n));
  const shift = l => { while (l && l.length) { const o = l.shift(); if (!used.has(o.id)) { used.add(o.id); return o; } } return null; };
  const take = n => {
    if (byNewId[n.id]) return byNewId[n.id];
    if (n.type === 'trigger' || n.type === 'end') { for (const k of Object.keys(pool).filter(x => x.startsWith(n.type + '|'))) { const o = shift(pool[k]); if (o) return o; } return null; }
    return shift(pool[nkey(n)]);
  };
  const idMap = {}, kept = [], added = [], renamed = [];
  const walk = list => (list || []).map(n => {
    const o = take(n); const c = Object.assign({}, n); delete c.pmoId;
    if (o) {
      idMap[n.id] = o.id; c.id = o.id; if (o.from) c.from = o.from;
      if (n.type === 'trigger') { c.title = trigTitle(n) && trigTitle(n) !== 'Process starts' ? n.title : (o.title || n.title); if (!fromFile(n)) { c.owner = o.owner || n.owner; c.touches = o.touches || []; c.data = o.data || []; } }
      if (isStep(n)) {
        if (!fromFile(n)) { c.data = o.data || []; c.subs = o.subs || []; c.touches = o.touches || []; if (o.ownerRole) c.ownerRole = o.ownerRole; }
        if (!(laneOwned && laneOwned.has(n.id)) || !n.owner) c.owner = o.owner || n.owner; /* a lane naming a real person wins; otherwise keep the owner */
        if (!fromFile(n)) ['sla', 'system', 'durationHrs'].forEach(k => { if (c[k] == null && o[k] != null) c[k] = o[k]; });
        kept.push(c);
        if (String(o.title || '').trim() !== String(n.title || '').trim()) renamed.push({ id: o.id, from: o.title, to: n.title });
      }
    } else if (isStep(n)) added.push(c);
    if (isGw(n)) c.branches = (n.branches || []).map(b => Object.assign({}, b, { nodes: walk(b.nodes) }));
    return c;
  });
  const out = walk(newNodes);
  allNodes(out).forEach(n => isGw(n) && (n.branches || []).forEach(b => { if (b.goto && idMap[b.goto]) b.goto = idMap[b.goto]; }));
  const outIds = new Set(allNodes(out).map(n => n.id));
  const removed = flat(oldNodes).filter(n => !outIds.has(n.id));
  return { nodes: out, kept, added, removed, renamed };
}
async function importVersion(pid, r, fileName) {
  const p0 = store.get('process', pid); if (!p0) return;
  if (!canEditProc(p0)) { toast(deniedMsg(p0)); return; }
  const m = mergeImport(p0.tobe || [], r.nodes, r.laneOwned, r.extIds);
  const removedWork = store.list('workItem', w => w.pid === pid && m.removed.some(s => s.id === w.step));
  const room = (p0.drafts || []).length < MAX_DRAFTS;
  const res = await modal({
    title: 'Import as a new version of this process',
    body: `<p style="margin:0">The Future map of <b>${esc(p0.name)}</b> is replaced by <b>${esc(fileName)}</b>. Steps that were in this map before keep their work, information, detail steps and owners, even if they were renamed.</p>
      <div class="d-impsum" data-impsum><span><b>${m.kept.length}</b> matched</span><span data-imp-renamed="${m.renamed.length}"><b>${m.renamed.length}</b> renamed</span><span><b>${m.added.length}</b> new</span><span><b>${m.removed.length}</b> no longer in the map</span><span><b>${r.gateways}</b> choice${r.gateways === 1 ? '' : 's'}</span></div>
      ${m.renamed.length ? `<ul class="d-renamed" data-renamed-list>${m.renamed.slice(0, 12).map(x => { const wn = store.list('workItem', w => w.pid === pid && w.step === x.id).length; return `<li data-renamed="${esc(x.id)}">Renamed: “${esc(x.from)}” → “<b>${esc(x.to)}</b>”${wn ? ` <span class="hint">keeps ${plural(wn, 'work item')}</span>` : ''}</li>`; }).join('')}${m.renamed.length > 12 ? `<li class="hint">and ${m.renamed.length - 12} more</li>` : ''}</ul>` : ''}
      ${m.removed.length ? `<div class="hint">Leaving the Future map: ${m.removed.map(s => esc(s.title)).join(', ')}${removedWork.length ? `. <b class="fail">${plural(removedWork.length, 'work item')} on these steps will need a new step.</b>` : ''}</div>` : ''}
      ${droppedHTML(r.dropped)}
      ${r.newData.length ?  `<div class="hint" data-imp-newdata="${r.newData.length}">New information created on import (you own it): ${esc(r.newData.map(d => d.name).join(', '))}</div>` : ''}
      ${r.unknownLanes.length ? `<div class="hint">Lanes that match nobody (new steps there are assigned to you): ${esc(r.unknownLanes.join(', '))}</div>` : ''}
      ${room ? `<label class="d-check"><input type="checkbox" name="snap" value="yes" checked /> Save the current version as “Before import of ${esc(fileName)}” first</label>` : `<div class="hint">You have ${MAX_DRAFTS} saved versions, so the current one is not saved first. “Undo last change” still restores it in this session.</div>`}`,
    actions: [{ id: 'import', label: 'Import as new version', primary: true }],
  });
  if (res.action !== 'import') return;
  const p = clone(store.get('process', pid));
  if ((res.form.snap || []).length && (p.drafts || []).length < MAX_DRAFTS) p.drafts = [...(p.drafts || []), { id: store.newId('ver'), name: `Before import of ${fileName}`, at: new Date().toISOString(), by: store.state.me, asis: clone(p.asis || []), tobe: clone(p.tobe || []) }];
  p.tobe = m.nodes;
  /* R6: the header's version label moves with the import: to-be revision n+1, from this file */
  p.tobeRev = (p.tobeRev || 1) + 1; p.tobeFrom = fileName;
  try { await createImportedData(r.newData, fileName); } catch (e) { toast('Could not create the new data elements: ' + e.message); return; }
  if (await saveProc(p, `Imported '${fileName}' as Future revision ${p.tobeRev} (${m.kept.length} matched, ${m.renamed.length} renamed, ${m.added.length} new, ${m.removed.length} removed, ${r.dropped.length} dropped)`)) go(`/process/${pid}?mode=diff`);
}
/* R7: one "New project" form everywhere (stream P's: name, which process, deadline; first plan suggested right after).
   The local form is the fallback if that module cannot load. */
async function startProject(p) {
  try { const m = await import('./project.js'); if (m && typeof m.newProject === 'function') { await m.newProject({ from: p.id, name: p.name + ' rollout' }); return; } }
  catch (e) { console.warn('New project form unavailable, using the local one:', e && e.message); }
  return startProjectLocal(p);
}
async function startProjectLocal(p, err, vals) {
  vals = vals || {};
  const def = new Date(store.state.today + 'T12:00:00'); def.setDate(def.getDate() + 60);
  const r = await modal({
    title: 'Start a project',
    body: `${err ? `<div class="banner d-err" role="alert">${esc(err)}</div>` : ''}<p class="hint" style="margin:0">The project changes <b>${esc(p.name)}</b> from Today to Future.</p>
      <div class="field"><label>Project name</label><input name="name" value="${esc(vals.name != null ? vals.name : p.name + ' rollout')}" /></div>
      <div class="field"><label>Deadline</label><input name="target" type="date" min="${esc(store.state.today)}" value="${esc(vals.target || def.toISOString().slice(0, 10))}" /></div>
      <details class="d-moreopts"><summary>More options</summary><div class="d-moreopts-b"><div class="frow"><div class="field"><label>Project manager</label><select name="pm">${personOpts(vals.pm || store.state.me)}</select></div>
        <div class="field"><label>Launch owner</label><select name="rm">${personOpts(vals.rm || vals.pm || store.state.me)}</select></div></div>
      <div class="field"><label>Description</label><textarea name="desc" placeholder="Why this change, and what done looks like">${esc(vals.desc || '')}</textarea></div></div></details>`,
    actions: [{ id: 'create', label: 'Start project', primary: true }],
  });
  if (r.action !== 'create') return;
  const name = (r.form.name || '').trim(), target = r.form.target || '';
  if (!name) return startProjectLocal(p, 'A project needs a name.', r.form);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) return startProjectLocal(p, 'Choose a deadline.', r.form);
  if (target < store.state.today) return startProjectLocal(p, 'The deadline is in the past.', r.form);
  const me = store.state.me, id = store.newId('prj');
  const pm = r.form.pm || me, rm = r.form.rm || pm;
  const prj = { id, name, desc: (r.form.desc || '').trim(), owner: pm, releaseManager: rm, resources: [...new Set([pm, rm, me, ...(p.resources || [])])], target, processes: [p.id], status: 'active', baselines: [] };
  try { await store.save('project', id, prj, `Started project '${name}' from the Future version of '${p.name}'`); toast(`Started '${name}'`); go(`/project/${id}`); }
  catch (e) { toast('Could not create the project: ' + e.message); }
}

/* ---------- /new ---------- */
async function openNew() {
  if (newOpen) return; newOpen = true;
  const pr = modal({
    title: 'Map a process',
    body: `<div class="field"><label for="d-np-name">Process name</label><input id="d-np-name" name="name" placeholder="e.g. Purchase request approval" autocomplete="off" /></div>
      <details class="d-moreopts"${isAdv() ? ' open' : ''}><summary>More options</summary><div class="d-moreopts-b">
      <div class="field"><label>One-line description</label><textarea name="desc" rows="2" placeholder="What this process does and where it ends"></textarea></div>
      <div class="field"><label>Owner</label><select name="owner">${personOpts(store.state.me)}</select></div></div></details>
      <div class="hint">Next you add the steps as they happen today. Press Enter after each one.</div>`,
    actions: (isAdv() ? [{ id: 'import', label: 'Import BPMN…' }] : []).concat([{ id: 'create', label: 'Create and add steps', primary: true }]),
  });
  /* Enter in the name creates the process */
  const nm = document.querySelector('.overlay #d-np-name');
  if (nm) nm.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const b = nm.closest('.modal').querySelector('[data-act="create"]'); if (b) b.click(); } });
  const r = await pr;
  if (r.action === 'import') { newOpen = false; newImport = true; const f = document.querySelector('[data-bpmn-file]'); if (f) f.click(); return; }
  if (r.action !== 'create') { newOpen = false; go('/'); return; }
  const name = (r.form.name || '').trim() || 'Untitled process';
  const id = store.newId('proc');
  const mk = () => { const t = store.newId('n'), e = store.newId('n'); return [{ id: t, type: 'trigger', title: '', owner: r.form.owner, touches: [], data: [] }, { id: e, type: 'end', title: 'Process complete' }]; };
  const asis = mk(), tobe = mk(); tobe[0].from = asis[0].id;
  const p = { id, name, desc: (r.form.desc || '').trim(), owner: r.form.owner || store.state.me, resources: [r.form.owner], version: 1, asis, tobe, released: [] };
  /* keep the guard up until we have left /new: store.save re-renders this route before go() runs */
  autoAdd = id; /* open the first "Add a step" dialog straight away */
  try { await store.save('process', id, p, `Created process '${name}'`); toast(`Created '${name}'`); go(`/process/${id}?mode=edit&v=asis`); }
  catch (e) { toast('Could not create: ' + e.message); }
  finally { newOpen = false; }
}

/* ---------- loop-back arrows (R4) ----------
   A curved return arrow from the end of a branch (its "Loop back to" label) to the target node, drawn as an SVG
   overlay on the canvas. The text label stays in the DOM for screen readers; the SVG is aria-hidden. */
let loopCanvas = null, loopRaf = 0;
export function drawLoops(root) {
  const cv = (root || document).querySelector('#canvas');
  loopCanvas = cv;
  if (!cv) return;
  cv.querySelectorAll(':scope > svg.d-loops').forEach(x => x.remove());
  const labels = [...cv.querySelectorAll('.d-goto[data-goto]')];
  cv.classList.toggle('d-hasloop', labels.length > 0);
  if (!labels.length) return;
  const cr = cv.getBoundingClientRect();
  const W = cv.scrollWidth, H = cv.scrollHeight;
  const rel = r => ({ l: r.left - cr.left + cv.scrollLeft, r: r.right - cr.left + cv.scrollLeft, t: r.top - cr.top + cv.scrollTop, b: r.bottom - cr.top + cv.scrollTop });
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'd-loops'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '<defs><marker id="d-loop-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#d97706"/></marker></defs>';
  const used = { left: 0, right: 0 };
  labels.forEach(lb => {
    let tgt = cv.querySelector(`[data-node="${CSS.escape(lb.dataset.goto)}"]`);
    if (!tgt) return;
    if (tgt.classList.contains('decision')) tgt = tgt.querySelector('.diamond') || tgt;
    const a = rel(lb.getBoundingClientRect()), t = rel(tgt.getBoundingClientRect());
    if (!a.r || !t.r) return;
    /* route on the side nearest the label so the arrow does not cross sibling branches */
    const side = (a.l + a.r) / 2 < W / 2 - 4 ? 'left' : 'right';
    const k = used[side]++;
    const y1 = (a.t + a.b) / 2, y2 = Math.min(t.t + 20, (t.t + t.b) / 2);
    const R = Math.max(4, Math.min(14, Math.abs(y1 - y2) / 2));
    let x1, x2, X;
    if (side === 'right') { x1 = a.r + 2; x2 = t.r + 2; X = Math.min(W - 5 - k * 6, Math.max(x1, x2) + 26 + k * 12); }
    else { x1 = a.l - 2; x2 = t.l - 2; X = Math.max(5 + k * 6, Math.min(x1, x2) - 26 - k * 12); }
    const dx = side === 'right' ? 1 : -1, dy = y2 < y1 ? -1 : 1;
    const r1 = Math.min(R, Math.abs(X - x1)), r2 = Math.min(R, Math.abs(X - x2));
    const d = `M${x1} ${y1} H${X - dx * r1} Q${X} ${y1} ${X} ${y1 + dy * r1} V${y2 - dy * r2} Q${X} ${y2} ${X - dx * r2} ${y2} H${x2 + dx * 3}`;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d); path.setAttribute('class', 'd-loop'); path.setAttribute('data-loop', lb.dataset.goto);
    path.setAttribute('marker-end', 'url(#d-loop-head)');
    svg.appendChild(path);
  });
  cv.appendChild(svg);
}
if (typeof window !== 'undefined') window.addEventListener('resize', () => { cancelAnimationFrame(loopRaf); loopRaf = requestAnimationFrame(() => { if (loopCanvas && loopCanvas.isConnected) drawLoops(loopCanvas.parentNode); }); });

/* R5: deleting a step that has work: move the work to another step, or delete it too */
async function deleteWorkDialog(p, ver, n, kind, goneIds, work) {
  const targets = flat(p[ver]).filter(s => !goneIds.has(s.id));
  const prjs = [...new Set(work.map(w => (store.get('project', w.projectId) || {}).name).filter(Boolean))];
  const r = await modal({
    title: `Delete ${kind} with work?`,
    body: `<div class="banner d-err" role="alert" style="margin:0"><b>'${esc(n.title)}' has ${plural(work.length, 'work item')}</b>${prjs.length ? ` in ${esc(prjs.join(', '))}` : ''}. Choose what happens to ${work.length === 1 ? 'it' : 'them'}.</div>
      <ul class="d-worklist">${work.map(w => `<li data-delwork="${esc(w.id)}">${av(w.owner)} ${esc(w.title)} <span class="hint">${esc(STATUS_LBL[w.status] || w.status)} · due ${esc(fmt(w.due))}</span></li>`).join('')}</ul>
      ${targets.length ? `<div class="field"><label>Move work to step…</label><select name="to">${targets.map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('')}</select></div>` : '<div class="hint">There is no other step to move the work to.</div>'}`,
    actions: [...(targets.length ? [{ id: 'move', label: 'Move work and delete step', primary: true }] : []), { id: 'deletework', label: 'Delete work too', danger: true }],
  });
  if (r.action === 'move' && r.form.to) return { action: 'move', to: r.form.to, toTitle: (targets.find(s => s.id === r.form.to) || {}).title || '' };
  if (r.action === 'deletework') return { action: 'delete' };
  return null;
}

/* R5: "Save version" stores a named snapshot of both maps (max 10) */
async function saveVersion(p0, err, name) {
  if (!canEditProc(p0)) { toast(deniedMsg(p0)); return; }
  const n = (p0.drafts || []).length;
  if (n >= MAX_DRAFTS) { await modal({ title: 'Saved versions are full', body: `<p style="margin:0">This process already has ${MAX_DRAFTS} saved versions, the most it keeps. Delete one in “Saved versions”, then save again.</p>`, actions: [] }); return; }
  const r = await modal({
    title: 'Save version',
    body: `${err ? `<div class="banner d-err" role="alert">${esc(err)}</div>` : ''}<p class="hint" style="margin:0">Keeps a named copy of the current Today and Future maps (${n + 1} of ${MAX_DRAFTS}). Compare it with any other version, or restore it later.</p>
      <div class="field"><label>Name</label><input name="name" value="${esc(name != null ? name : '')}" placeholder="e.g. Before risk-tier redesign" maxlength="80" /></div>`,
    actions: [{ id: 'save', label: 'Save version', primary: true }],
  });
  if (r.action !== 'save') return;
  const nm = (r.form.name || '').trim();
  if (!nm) return saveVersion(p0, 'Give the version a name.', nm);
  const p = clone(store.get('process', p0.id));
  if ((p.drafts || []).some(d => d.name.toLowerCase() === nm.toLowerCase())) return saveVersion(p0, `A saved version called '${nm}' already exists.`, nm);
  p.drafts = [...(p.drafts || []), { id: store.newId('ver'), name: nm, at: new Date().toISOString(), by: store.state.me, asis: clone(p.asis || []), tobe: clone(p.tobe || []) }];
  await saveProc(p, `Saved version '${nm}'`);
}

/* ---------- bind ---------- */
function applyHl(root) {
  const nodes = root.querySelectorAll('#canvas .node[data-step]');
  nodes.forEach(n => { n.classList.remove('dim', 'hl'); if (hl) n.classList.add((n.dataset.data || '').split(',').includes(hl) ? 'hl' : 'dim'); });
}

export function bind(root, params) {
  bindImport(root, params.create ? null : params.pid);
  if (params.create) { const b = root.querySelector('[data-new-open]'); if (b) b.onclick = () => { newImport = false; openNew(); }; if (!newImport) openNew(); return; }
  newImport = false;
  const pid = params.pid; const cur = () => store.get('process', pid);
  if (!cur()) return;
  bindActivity(root);
  const q = params.q || {};
  const ver = q.v === 'asis' ? 'asis' : 'tobe';
  drawLoops(root);
  const vs = root.querySelector('[data-version]');
  if (vs) vs.onchange = () => go(vs.value ? `/process/${pid}?mode=asis&rel=${encodeURIComponent(vs.value)}` : `/process/${pid}?mode=asis`);
  const vc = root.querySelector('[data-version-current]'); if (vc) vc.onclick = () => go(`/process/${pid}?mode=asis`);
  const bx = root.querySelector('[data-bpmn]');
  if (bx) bx.onclick = async () => {
    const p = cur(); const view = shown(p, q);
    /* R6: optional "External parties" pool with message flows for the message nodes */
    const msgs = flat(view.nodes).filter(n => n.type === 'message').length;
    const r = await modal({ title: 'Download diagram file', body: `<p style="margin:0">Downloads the <b>${esc(view.label)}</b> map of <b>${esc(p.name)}</b> as a diagram file that other process tools can open (BPMN 2.0).</p>
      <label class="d-check"><input type="checkbox" name="pool" value="yes" ${msgs ? 'checked' : 'disabled'} /> Show people outside the organisation as their own group${msgs ? ` (${msgs} message step${msgs === 1 ? '' : 's'})` : ' (no message steps in this map)'}</label>
      <div class="hint">Information, time limits, systems, teams and detail steps are kept in the file, so importing it back loses nothing.</div>`, actions: [{ id: 'download', label: 'Download', primary: true }] });
    if (r.action !== 'download') return;
    const xml = bpmnXml(p, view.nodes, view.label, { pool: (r.form.pool || []).length > 0 });
    const slug = String(p.name || 'process').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    a.download = `${slug}-${view.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.bpmn`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Downloaded the ' + view.label + ' map');
  };
  /* tabs: Today / Future switch the map (and keep editing on); What changed, By person and Who's affected leave editing */
  const inEdit = q.mode === 'edit' && !q.rel && canEditProc(cur());
  const curView = shown(cur(), q);
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    const m = b.dataset.mode;
    if (m === 'edit') {
      if (!canEditProc(cur())) { toast(deniedMsg(cur())); return; }
      const v = q.v || (curView.mode === 'asis' ? 'asis' : 'tobe');
      go(`/process/${pid}?mode=edit&v=${v}`); return;
    }
    if (inEdit && (m === 'asis' || m === 'tobe')) { go(`/process/${pid}?mode=edit&v=${m}`); return; }
    go(`/process/${pid}?mode=${m}`);
  });
  const done = root.querySelector('[data-edit-done]');
  if (done) done.onclick = () => go(`/process/${pid}?mode=${ver === 'asis' ? 'asis' : 'tobe'}`);
  /* "⋯ More": close on outside click, Escape, or after choosing an item */
  const menu = root.querySelector('[data-more]');
  if (menu) {
    const close = () => { menu.open = false; };
    menu.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); menu.querySelector('summary').focus(); } });
    menu.querySelectorAll('.d-mi:not(.d-import)').forEach(b => b.addEventListener('click', close));
    if (menuCloser) document.removeEventListener('click', menuCloser);
    menuCloser = e => { if (menu.isConnected && menu.open && !menu.contains(e.target)) close(); };
    document.addEventListener('click', menuCloser);
  }
  /* R7 §4: Future is created from Today the first time an editor opens it (no fork button, no confirm) */
  const fv = curView.mode === 'tobe' || (inEdit && curView.ver === 'tobe');
  if (fv && canEditProc(cur()) && needsFuture(cur()) && !futureMaking.has(pid)) {
    futureMaking.add(pid);
    const p = clone(cur()); p.tobe = forkNodes(p.asis || []); p.tobeForked = true;
    saveProc(p, 'Created the Future version from Today', { quiet: true, noUndo: true }).finally(() => futureMaking.delete(pid));
  }
  /* R8 §7: on a phone the side panels sit below the map, folded to their headings; a tap opens one */
  root.querySelectorAll('.d-sidefold > .card').forEach((card, i) => {
    const h = card.querySelector(':scope > h3'); if (!h) return;
    const key = card.getAttribute('data-side-blocked') != null ? 'blocked' : card.dataset.sideData != null ? 'data' : (h.textContent || '').trim().split(/\s+/)[0] + i;
    card.dataset.fold = key; card.classList.toggle('d-unfold', sideOpen.has(key));
    h.classList.add('d-foldh');
    if (window.innerWidth <= 640) { h.setAttribute('tabindex', '0'); h.setAttribute('role', 'button'); h.setAttribute('aria-expanded', String(sideOpen.has(key))); }
    const tog = () => { if (sideOpen.has(key)) sideOpen.delete(key); else sideOpen.add(key); card.classList.toggle('d-unfold', sideOpen.has(key)); if (h.hasAttribute('aria-expanded')) h.setAttribute('aria-expanded', String(sideOpen.has(key))); };
    h.addEventListener('click', e => { if (e.target.closest('a,button,input,select')) return; if (window.innerWidth <= 640) tog(); });
    h.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && window.innerWidth <= 640) { e.preventDefault(); tog(); } });
  });
  /* phone summary row */
  const ht = root.querySelector('[data-hdr-toggle]');
  if (ht) ht.onclick = () => { hdrOpen = !hdrOpen; const h = root.querySelector('.d-hdr'); h.classList.toggle('d-hdr-open', hdrOpen); ht.setAttribute('aria-expanded', String(hdrOpen)); ht.querySelector('.d-sumtog').textContent = hdrOpen ? 'Less ▴' : 'Details ▾'; };
  /* R5: ask the owner for edit access */
  const aa = root.querySelector('[data-ask-access]');
  if (aa) aa.onclick = async () => { const p = cur(); await store.notify([p.owner], `${pname(store.state.me)} asked for edit access to '${p.name}'`, 'process:' + pid); toast(`Asked ${pname(p.owner)} for edit access`); };
  /* R5: compare versions */
  const cmpGo = (a, b) => go(`/process/${pid}?mode=compare&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  const co = root.querySelector('[data-compare-open]');
  if (co) co.onclick = () => { const c = cmpPair(cur(), q); cmpGo(c.A.key, c.B.key); };
  root.querySelectorAll('[data-cmp]').forEach(sel => sel.onchange = () => { const a = root.querySelector('[data-cmp="a"]').value, b = root.querySelector('[data-cmp="b"]').value; cmpGo(a, b); });
  root.querySelectorAll('[data-draft-cmp]').forEach(b => b.onclick = () => cmpGo('draft:' + b.dataset.draftCmp, 'cur-tobe'));
  /* R5: saved versions (named drafts, max 10) */
  const sv = root.querySelector('[data-save-version]');
  if (sv) sv.onclick = () => saveVersion(cur());
  root.querySelectorAll('[data-draft-del]').forEach(b => b.onclick = async () => {
    const p = clone(cur()); const d = (p.drafts || []).find(x => x.id === b.dataset.draftDel); if (!d) return;
    if (!await confirmBox('Delete saved version?', `Delete the saved version '${d.name}'? The current maps are not affected.`, 'Delete')) return;
    p.drafts = p.drafts.filter(x => x.id !== d.id);
    await saveProc(p, `Deleted saved version '${d.name}'`);
  });
  root.querySelectorAll('[data-draft-restore]').forEach(b => b.onclick = async () => {
    const p = clone(cur()); const d = (p.drafts || []).find(x => x.id === b.dataset.draftRestore); if (!d) return;
    if (!await confirmBox('Restore saved version?', `Replace the current as-is and to-be maps with '${d.name}'? “Undo last change” can bring the current maps back in this session.`, 'Restore')) return;
    p.asis = clone(d.asis || []); p.tobe = clone(d.tobe || []);
    await saveProc(p, `Restored saved version '${d.name}'`);
  });
  /* R5: undo the last change made in this session */
  const ub = root.querySelector('[data-undo]');
  if (ub) ub.onclick = async () => {
    const st = undoStack[pid] || []; const last = st[st.length - 1]; if (!last) return;
    const back = clone(last.doc);
    if (await saveProc(back, `Undid: ${last.summary}`, { noUndo: true })) { st.pop(); store.emit(); }
  };
  root.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => go(`/process/${pid}?mode=edit&v=${b.dataset.ver}`));

  /* data highlight */
  if (hl && !root.querySelector(`[data-hl="${CSS.escape(hl)}"]`)) hl = null;
  applyHl(root);
  root.querySelectorAll('[data-hl]').forEach(row => {
    const toggle = () => { hl = hl === row.dataset.hl ? null : row.dataset.hl; root.querySelectorAll('[data-hl]').forEach(r => { r.classList.toggle('hl-on', r.dataset.hl === hl); r.setAttribute('aria-pressed', String(r.dataset.hl === hl)); }); applyHl(root);
      const first = root.querySelector('#canvas .node.hl'); if (first && hl && window.innerWidth < 1060) first.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    row.addEventListener('click', e => { if (e.target.closest('a')) return; toggle(); });
    row.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a')) { e.preventDefault(); toggle(); } });
  });
  /* keyboard open for clickable step cards */
  root.querySelectorAll('#canvas [data-go]').forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) go(el.dataset.go); }));
  const nd = root.querySelector('[data-newdata]'); if (nd) nd.onclick = () => newDataModal();
  const sp = root.querySelector('[data-start-project]'); if (sp && !sp.disabled) sp.onclick = () => startProject(cur());

  if (!inEdit) return;
  /* header meta */
  root.querySelectorAll('[data-meta]').forEach(el => el.addEventListener('change', () => {
    const p = clone(cur()); const k = el.dataset.meta; const v = k === 'owner' ? el.value : el.value.trim();
    if (k === 'name' && !v) { el.value = p.name; return; }
    if ((p[k] || '') === v) return; p[k] = v;
    saveProc(p, k === 'name' ? `Renamed process to '${v}'` : k === 'desc' ? 'Updated process description' : `Set process owner to ${pname(v)}`);
  }));
  root.querySelectorAll('[data-res-del]').forEach(b => b.onclick = async () => { const id = b.dataset.resDel; if (!await confirmBox('Remove resource?', `Remove ${pname(id)} from this process's resources?`, 'Remove')) return; const p = clone(cur()); p.resources = (p.resources || []).filter(x => x !== id); saveProc(p, `Removed ${pname(id)} from resources`); });
  const ra = root.querySelector('[data-res-add]'); if (ra) ra.onchange = () => { if (!ra.value) return; const p = clone(cur()); p.resources = [...new Set([...(p.resources || []), ra.value])]; saveProc(p, `Added ${pname(ra.value)} to resources`); };

  const fork = root.querySelector('[data-fork]');
  if (fork) fork.onclick = async () => {
    const p = clone(cur());
    if (!await confirmBox('Start Future again from Today?', `This replaces the Future map (${flat(p.tobe).length} steps) with a fresh copy of Today. Each copied step remembers the Today step it came from.`, 'Replace Future')) return;
    p.tobe = forkNodes(p.asis || []); p.tobeForked = true;
    await saveProc(p, 'Started Future again from Today');
    go(`/process/${pid}?mode=edit&v=tobe`);
  };

  /* R7 §4 quick-add: "+ Add a step" opens the 3-field dialog; Enter adds the step and opens the next one right after it */
  const quickAdd = async (key, pos, who) => {
    let saving = null;
    for (;;) {
      const p0 = cur();
      const res = await stepModal(p0, ver, { id: store.newId('n'), type: 'step', data: [], touches: [], subs: [] }, { quick: true, who });
      if (saving) await saving;
      if (!res) return;
      const p = clone(cur()); const list = getList(p[ver] || (p[ver] = []), key);
      if (!list) { toast('That spot no longer exists'); return; }
      list.splice(Math.min(pos, list.length), 0, res.node);
      saving = saveProc(p, `Added step '${res.node.title}' to ${VER[ver]}`);
      if (!res.next) { await saving; return; }
      pos = Math.min(pos, list.length - 1) + 1; who = res.who;
    }
  };
  root.querySelectorAll('[data-addstep]').forEach(b => b.onclick = () => {
    const steps = flat(cur()[ver]); const last = steps[steps.length - 1];
    quickAdd('root', +b.dataset.pos, last ? whoOf(last) : undefined);
  });
  if (autoAdd === pid) { autoAdd = null; const b = root.querySelector('[data-addstep]'); if (b) setTimeout(() => b.click(), 60); }

  root.querySelectorAll('[data-ins]').forEach(b => b.onclick = async () => {
    const key = b.dataset.ins, pos = +b.dataset.pos;
    const KINDS = [['step', '1', 'A step', 'Someone does something. Say who, and what information they need.'], ['decision', '◆', 'A choice', 'Only one path is taken, e.g. “Approved? Yes / No”.'], ['parallel', '⊕', 'At the same time', 'Several things happen at once.'],
      ['wait', NT.wait.icon, 'Wait', 'Nothing happens for a while, e.g. 2 business days.'], ['message', NT.message.icon, 'Message', 'We send something to, or get something from, someone outside.'], ['subprocess', NT.subprocess.icon, 'Another process', 'Runs a whole other process here.']];
    const kindBtn = ([k, ic, l, h]) => `<button type="button" class="d-kind d-kind-${k}" data-act="${k}"><span class="d-kic" aria-hidden="true">${ic}</span><span><b>${esc(l)}</b><small>${esc(h)}</small></span></button>`;
    const pick = await modal({ title: 'What do you want to add here?', body: `<div class="d-kinds" role="group" aria-label="What to add">${KINDS.slice(0, 3).map(kindBtn).join('')}</div>
      <details class="d-moreopts"${isAdv() ? ' open' : ''}><summary>More options</summary><div class="d-kinds d-moreopts-b">${KINDS.slice(3).map(kindBtn).join('')}</div></details>`, actions: [] });
    if (!KINDS.some(k => k[0] === pick.action)) return;
    const p0 = cur();
    if (pick.action === 'step') { quickAdd(key, pos); return; }
    const node = isGw({ type: pick.action }) ? await decisionModal({ id: store.newId('d'), type: pick.action }, pick.action, p0[ver]) : ((await stepModal(p0, ver, { id: store.newId('n'), type: pick.action, data: [], touches: [], subs: [] })) || {}).node;
    if (!node) return;
    const p = clone(cur()); const list = getList(p[ver] || (p[ver] = []), key);
    if (!list) { toast('That spot no longer exists'); return; }
    list.splice(Math.min(pos, list.length), 0, node);
    const where = key === 'root' ? '' : (() => { const [did, bi] = key.split('#'); const d = findLoc(p[ver], did); return d ? ` (path '${d.node.branches[+bi].label}' of '${d.node.title}')` : ''; })();
    await saveProc(p, `Added ${node.type === 'decision' ? 'choice' : node.type === 'parallel' ? '“at the same time”' : isSpecial(node) ? NT[node.type].label.toLowerCase() : 'step'} '${node.title}' to ${VER[ver]}${where}`);
  });

  root.querySelectorAll('[data-ed]').forEach(b => b.onclick = async () => {
    const act = b.dataset.ed, id = b.dataset.id;
    const p = clone(cur()); const loc = findLoc(p[ver] || [], id); if (!loc) return;
    const n = loc.node; const kind = n.type === 'decision' ? 'choice' : n.type === 'parallel' ? '“at the same time”' : n.type === 'trigger' ? 'what starts it' : n.type === 'end' ? 'end' : isSpecial(n) ? NT[n.type].label.toLowerCase() : 'step';
    if (act === 'edit') {
      const out = isGw(n) ? await decisionModal(n, n.type, p[ver]) : (n.type === 'trigger' || n.type === 'end') ? await simpleNodeModal(n) : ((await stepModal(p, ver, n)) || {}).node;
      if (!out) return;
      const p2 = clone(cur()); const l2 = findLoc(p2[ver] || [], id); if (!l2) return;
      l2.list[l2.index] = out;
      await saveProc(p2, `Edited ${kind} '${out.title}' in ${VER[ver]}`);
    } else if (act === 'up' || act === 'down') {
      const j = loc.index + (act === 'up' ? -1 : 1);
      const blocked = j < 0 || j >= loc.list.length || ['trigger', 'end'].includes(loc.list[j].type);
      if (blocked) { toast(`'${n.title}' is already at the ${act === 'up' ? 'top' : 'bottom'} of its list`); return; }
      [loc.list[loc.index], loc.list[j]] = [loc.list[j], loc.list[loc.index]];
      await saveProc(p, `Moved ${kind} '${n.title}' ${act} in ${VER[ver]}`);
      const again = document.querySelector(`[data-ed="${act}"][data-id="${CSS.escape(id)}"]`); if (again) again.focus();
    } else if (act === 'del') {
      const inner = isGw(n) ? flat([n]).length : 0;
      const goneIds = new Set(allNodes([n]).map(x => x.id));
      const work = store.list('workItem', w => w.pid === pid && goneIds.has(w.step));
      let plan = null;
      if (work.length) { plan = await deleteWorkDialog(p, ver, n, kind, goneIds, work); if (!plan) return; }
      else if (!await confirmBox(`Delete ${kind}?`, `Delete '${n.title}' from the ${VER[ver]} map${inner ? ` and the ${inner} step${inner === 1 ? '' : 's'} inside its branches` : ''}?`, 'Delete')) return;
      const p2 = clone(cur()); const l2 = findLoc(p2[ver] || [], id); if (!l2) return;
      if (plan) {
        try {
          if (plan.action === 'move') for (const w of work) await store.save('workItem', w.id, Object.assign({}, w, { step: plan.to, updatedAt: new Date().toISOString() }), `Moved work item '${w.title}' to step '${plan.toTitle}' (step '${n.title}' deleted)`);
          else {
            const ids = new Set(work.map(w => w.id));
            for (const w of work) await store.remove('workItem', w.id, `Deleted work item '${w.title}' with step '${n.title}'`);
            /* successors no longer wait for deleted work */
            for (const o of store.list('workItem', w => (w.deps || []).some(d => ids.has(d && typeof d === 'object' ? d.id : d))))
              await store.save('workItem', o.id, Object.assign({}, o, { deps: o.deps.filter(d => !ids.has(d && typeof d === 'object' ? d.id : d)), updatedAt: new Date().toISOString() }), `Removed a dependency on deleted work from '${o.title}'`);
          }
        } catch (e) { toast('Could not update the work items: ' + e.message); return; }
      }
      const gone = new Set(allNodes([l2.node]).map(x => x.id));
      l2.list.splice(l2.index, 1);
      /* loop-backs that pointed at the deleted node(s) now continue instead */
      allNodes(p2[ver]).forEach(x => isGw(x) && (x.branches || []).forEach(br => { if (br.goto && gone.has(br.goto)) delete br.goto; }));
      await saveProc(p2, `Deleted ${kind} '${n.title}' from ${VER[ver]}`);
    }
  });
}
