/* PMOFlow — project page (stream P).
   /project/:prj?mode=map|timeline|work
   Also exports small PMO helpers reused by home.js and portfolio.js. */
import { store } from '../store.js';
import { E, esc, fmt, fmtTime, days, addDays, link, go, av, personChip, pname, modal, toast, LOCK, activityCard, bindActivity } from '../ui.js';

/* ---------------------------------------------------------------- shared helpers */
export const STATUS_LBL = { done: 'Done', prog: 'In progress', idle: 'Not started', none: 'No change' };
export const KIND_LBL = { build: 'Build', access: 'Access', test: 'Test', defect: 'Defect', other: 'Other' };
export const BUG = '<svg class="pmo-bug" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-label="Defect" role="img"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M9 6l-2-3M15 6l2-3M3 13h5M16 13h5M4 8l4 2M20 8l-4 2M4 19l4-2M20 19l-4-2"/></svg>';
export const rerender = () => window.dispatchEvent(new Event('pmo:route'));
const maxDate = arr => arr.filter(Boolean).sort().slice(-1)[0] || null;
const minDate = arr => arr.filter(Boolean).sort()[0] || null;
export const dayDiff = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);

/* Engine calls are wrapped so one bad doc can't blank the page. */
export function eng(name, fallback, ...args) {
  try { const f = E() && E()[name]; return f ? f(...args) : fallback; }
  catch (e) { console.warn('PMOEngine.' + name, e); return fallback; }
}
export const docs = () => store.state.docs;
export const today = () => store.state.today;
export const forecasts = () => eng('forecastAll', {}, docs(), today()) || {};
export const flatSteps = nodes => eng('flatSteps', [], nodes || []) || [];
export const dataName = id => (store.get('dataElement', id) || {}).name || id;
export function stepOf(pid, sid) { const p = store.get('process', pid); return p ? flatSteps(p.tobe).find(s => s.id === sid) || null : null; }
/* Any to-be node by id (steps and gateways, inside branches too). R4 suggestions can target gateways. */
export function nodeOf(pid, id) {
  const p = store.get('process', pid); if (!p) return null;
  const walk = nodes => { for (const n of nodes || []) { if (n.id === id) return n; for (const b of n.branches || []) { const x = walk(b.nodes); if (x) return x; } } return null; };
  return walk(p.tobe);
}
/* Steps and gateways in map order (for "the step this work delivers" selects and the filter bar). */
export function planNodes(pid) {
  const p = store.get('process', pid); if (!p) return [];
  const out = [];
  const walk = nodes => (nodes || []).forEach(n => {
    if (Array.isArray(n.branches)) { out.push(n); n.branches.forEach(b => walk(b.nodes)); }
    else if (n.type !== 'trigger' && n.type !== 'end') out.push(n);
  });
  walk(p.tobe);
  return out;
}
export const stepTitle = (pid, sid) => (stepOf(pid, sid) || nodeOf(pid, sid) || {}).title || 'Unknown step';
/* R4 dependencies: a string (FS, lag 0) or {id, type: FS|SS|FF, lag}. */
export const depId = d => (d && typeof d === 'object') ? d.id : d;
export const depNorm = d => (d && typeof d === 'object') ? { id: d.id, type: ['FS', 'SS', 'FF'].includes(d.type) ? d.type : 'FS', lag: Number(d.lag) || 0 } : { id: d, type: 'FS', lag: 0 };
export const depLabel = d => { const n = depNorm(d); return n.type === 'FS' && !n.lag ? '' : `${n.type}${n.lag ? (n.lag > 0 ? ' +' : ' ') + n.lag + 'd' : ''}`; };
/* Business days (engine R4 addBusinessDays, with a local fallback that skips Saturday and Sunday). */
const isWeekend = s => { const g = new Date(s + 'T12:00:00').getDay(); return g === 0 || g === 6; };
export function addBiz(s, n) {
  const f = E() && E().addBusinessDays; if (f) { try { const r = f(s, n); if (r) return r; } catch (e) { /* fall through */ } }
  let d = s; let k = Math.abs(n); const step = n < 0 ? -1 : 1;
  while (k > 0) { d = addDays(d, step); if (!isWeekend(d)) k--; }
  return d;
}
export function bizDays(a, b) { let n = 0; for (let d = a; d <= b; d = addDays(d, 1)) if (!isWeekend(d)) n++; return n; }
export const procName = pid => (store.get('process', pid) || {}).name || 'Unlinked process';
export const projectItems = prj => store.list('workItem', w => w.projectId === prj);
export const effortOf = w => (typeof w.effortDays === 'number' && w.effortDays > 0) ? w.effortDays : 1;
const fmtEffort = n => (Math.round(n * 10) / 10) + 'd';
export function projectStats(prj) {
  const s = eng('projectStats', null, docs(), prj, today());
  if (s) return s;
  const items = projectItems(prj), done = items.filter(w => w.status === 'done').length;
  return { total: items.length, done, pct: items.length ? Math.round(done / items.length * 100) : 0, late: 0, slip: 0, blocked: 0, finish: maxDate(items.map(w => w.due)), target: (store.get('project', prj) || {}).target, onTrack: true };
}
/* Finished (all work done: actual date) vs forecast (open work). */
export function finishInfo(j, s) {
  const allDone = s.total > 0 && s.done === s.total;
  const date = allDone ? (s.actualFinish || maxDate(projectItems(j.id).map(w => w.doneAt || w.due))) : s.finish;
  return { done: allDone, date, label: allDone ? 'Finished' : 'Forecast', over: !!(date && j.target && date > j.target) };
}

/* R3: the data element is the single source of truth. Engine effectiveAvail, with a local fallback that mirrors the contract. */
export function effAvail(dataId) {
  const v = eng('effectiveAvail', undefined, docs(), dataId);
  if (v === 'live' || v === 'example' || v === 'missing' || v === 'pending') return v;
  const d = store.get('dataElement', dataId); if (!d) return 'missing';
  if (d.avail === 'live' || store.list('workItem', w => w.resolves === dataId && w.status === 'done').length) return 'live';
  return d.avail === 'example' ? 'example' : 'missing';
}
/* R3: every diff count comes from diffSummary (local fallback counts diffProcess nodes). */
export function diffCounts(p) {
  const s = eng('diffSummary', null, p);
  if (s && typeof s.new === 'number') return s;
  const dp = eng('diffProcess', null, p) || { nodes: {}, removed: [] };
  const k = Object.values(dp.nodes || {});
  return { new: k.filter(x => x === 'new').length, changed: k.filter(x => x === 'changed').length, removed: (dp.removed || []).length, same: k.filter(x => x === 'same').length };
}
/* Data ids used by a project's linked to-be processes (steps and sub-steps), in map order. */
export function projectData(j) {
  const out = [];
  (j.processes || []).forEach(pid => {
    const p = store.get('process', pid); if (!p) return;
    flatSteps(p.tobe).forEach(s => [...(s.data || []), ...(s.subs || []).flatMap(x => x.data || [])].forEach(d => { if (!out.includes(d)) out.push(d); }));
  });
  return out;
}
/* The work item that resolves a data element, preferring this project's own. */
export const resolverOf = (dataId, prj) => store.list('workItem', w => w.resolves === dataId).sort((a, b) => (a.projectId === prj ? -1 : 0) - (b.projectId === prj ? -1 : 0))[0] || null;

/* Gate-aware finish state. Live: "Live since <date> (vN)". All work done but not released: "Work done · awaiting go-live".
   Otherwise the forecast. Never "Finished · early" while the readiness gate decides go-live. */
export function gateInfo(j, s) {
  const fi = finishInfo(j, s || projectStats(j.id));
  if (j.status === 'live') {
    const rd = eng('readiness', null, docs(), j.id, today());
    const rel = store.list('release', x => x.projectId === j.id && x.kind !== 'rollback').sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    const at = (rd && rd.releasedAt) || (rel && rel.at) || null;
    const vers = (j.processes || []).map(pid => Number((store.get('process', pid) || {}).version)).filter(n => n > 0);
    const v = vers.length ? Math.max(...vers) : null;
    return { k: 'live', at, v, fi, label: `Live since ${fmt(at)}${v ? ` (v${v})` : ''}` };
  }
  if (fi.done) {
    const rd = eng('readiness', null, docs(), j.id, today());
    const blocking = rd && Array.isArray(rd.checks) ? rd.checks.filter(c => c.status ? c.status === 'fail' : (!c.pass && c.id !== 'exceptions')).length : null;
    return { k: 'awaiting', fi, blocking, label: 'Work done · awaiting go-live' };
  }
  return { k: 'forecast', fi, label: `Forecast ${fmt(fi.date)}` };
}

/* Permissions: the item's owner or the project owner (PM) may change it. */
export const canEditWork = (w, j) => !!w && !!j && (store.state.me === w.owner || store.state.me === j.owner);
export const lockTitle = (w, j) => `Only ${pname(w.owner)} or ${pname(j && j.owner)} can update this`;

/* Red/amber/green. Stated rule (also shown in the UI). */
export const RAG_RULE = 'Red: any late item, or forecast after target. Amber: any slipping item, or less than 7 days of buffer. Green: otherwise.';
export function rag(p, s) {
  if (p.status === 'live') return { k: 'live', label: 'Live' };
  const fi = finishInfo(p, s);
  const buffer = (fi.date && p.target) ? dayDiff(p.target, fi.date) : null;
  if (s.late > 0 || (buffer != null && buffer < 0)) return { k: 'red', label: 'Red' };
  if (s.slip > 0 || (!fi.done && buffer != null && buffer < 7)) return { k: 'amber', label: 'Amber' };
  return { k: 'green', label: 'Green' };
}
export const ragBadge = r => `<span class="rag rag-${r.k}" title="${esc(RAG_RULE)}"><i></i>${esc(r.label)}</span>`;

/* One schedule format everywhere: short status badge + "Due Nov 3 · forecast Nov 11 (+8d)". */
export function slipOf(w, f) {
  f = f || {};
  const end = w.status === 'done' ? (w.doneAt || w.due) : (f.forecast || w.due);
  return end && w.due && end > w.due ? dayDiff(end, w.due) : 0;
}
export function wBadge(w, f) {
  f = f || {};
  if (w.status === 'done') return `<span class="badge b-done">Done</span>`;
  const sched = f.sched || 'ok';
  if (sched === 'late') return `<span class="badge b-late">Late</span>`;
  if (sched === 'slip') return `<span class="badge b-slip">Slipping</span>`;
  if (sched === 'soon') return `<span class="badge b-soon">Due soon</span>`;
  return `<span class="badge b-ok">On track</span>`;
}
export function dueLine(w, f) {
  f = f || {};
  const n = slipOf(w, f);
  if (w.status === 'done') return `Due ${fmt(w.due)} · done ${fmt(w.doneAt || w.due)}${n ? ` (+${n}d)` : ''}`;
  return `Due ${fmt(w.due)} · forecast ${fmt(f.forecast || w.due)}${n ? ` (+${n}d)` : ''}`;
}
export const schedHTML = (w, f) => `${wBadge(w, f)}${whyBtn(w)} <span class="pmo-dl">${esc(dueLine(w, f))}</span>`;
/* "Why this date?" sits next to every forecast badge of an open item. */
export const whyBtn = w => (w && w.status !== 'done' && w.id) ? `<button type="button" class="pmo-why" data-why="${esc(w.id)}" aria-label="Why this date? ${esc(w.title || '')}" title="Why this date?">?</button>` : '';

function stBadge(st) {
  if (!st || st.status === 'none') return `<span class="badge b-none">No work</span>`;
  if (st.status === 'done') return `<span class="badge b-done">Done</span>`;
  const sch = st.sched === 'late' ? `<span class="badge b-late">Late${st.forecast && st.due && st.forecast > st.due ? ' · forecast ' + fmt(st.forecast) : ''}</span>`
    : st.sched === 'slip' ? `<span class="badge b-slip">Slipping · forecast ${fmt(st.forecast)}</span>`
    : st.sched === 'soon' ? `<span class="badge b-soon">Next due ${st.next ? fmt(st.next) : 'soon'}</span>`
    : `<span class="badge b-ok">Due ${fmt(st.due)}</span>`;
  return `<span class="badge b-${st.status}">${STATUS_LBL[st.status] || st.status}</span>${sch}`;
}
export const risksFor = wid => store.list('risk', r => r.status !== 'closed' && (r.workItems || []).includes(wid));

/* Work-item events don't carry the project, so feeds filter by known ids + project name in delete summaries. */
export function feedHTML(key) { return `<div data-feed="${esc(key)}"><div class="hint">Loading history…</div></div>`; }
export function bindFeed(root, key, match) {
  const box = root.querySelector(`[data-feed="${key}"]`); if (!box) return;
  store.events(null, 100).then(evs => {
    const list = (evs || []).filter(match).slice(0, 15);
    box.innerHTML = list.length ? list.map(e => `<div class="ev"><time>${esc(fmtTime(e.at))}</time><span>${av(e.actor)} <b>${esc(pname(e.actor))}</b> ${esc(e.summary || e.action)}</span></div>`).join('') : '<div class="hint">No changes recorded yet.</div>';
  });
}

/* ---------------------------------------------------------------- page state */
let showUnchanged = false;
let showBaseline = true;
let showCrit = true;
let workGroup = 'flat'; /* 'flat' | 'step' */
const folded = new Set(); /* collapsed group keys in grouped work view */
const blPick = {}; /* prj -> baseline id for timeline overlay */

/* ---------------------------------------------------------------- map */
function nodeHTML(n, pid, prj, idx, dp) {
  if (n.type === 'end') return `<div class="node end">● ${esc(n.title)}</div>`;
  const trig = n.type === 'trigger';
  const st = trig ? null : eng('stepState', null, docs(), prj, pid, n.id, today());
  const kind = dp && dp.nodes ? dp.nodes[n.id] : null;
  const dl = n.data || [];
  const eff = dl.map(d => [d, effAvail(d)]);
  const live = eff.filter(x => x[1] === 'live').length;
  const cls = ['node', trig ? 'trigger' : '', st ? 's-' + st.status : '', st && st.status !== 'none' && st.status !== 'done' ? 'sch-' + st.sched : ''].join(' ');
  const diff = (kind === 'new' || kind === 'changed') ? `<span class="chip diff-${kind}">${kind === 'new' ? 'NEW' : 'CHANGED'}</span>` : '';
  let body;
  if (trig) body = `<div class="stats">${(n.touches || []).map(t => `<span class="chip touch"># ${esc(t)}</span>`).join('')}</div>`;
  else {
    const items = (st && st.items) || [];
    const done = items.filter(w => w.status === 'done').length;
    const gap = (kind === 'new' || kind === 'changed') && !items.length;
    const defects = items.filter(w => w.kind === 'defect' && w.status !== 'done').length;
    /* R3: red "Waiting on" only for effectively missing data on a step with open work; examples-only data is amber. */
    const openWork = items.some(w => w.status !== 'done');
    const red = openWork ? eff.filter(x => x[1] === 'missing').map(x => x[0]) : [];
    const amber = eff.filter(x => x[1] === 'example' || x[1] === 'pending');
    body = `<div class="meta">${stBadge(st)}${gap ? '<span class="badge b-soon">No work planned</span>' : ''}${defects ? `<span class="badge b-late">${BUG} ${defects} defect${defects > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="stats">${items.length ? `<span>Work <b>${done}/${items.length}</b></span>` : ''}<span>Data <b>${live}/${dl.length}</b> live</span></div>
      ${red.length || amber.length ? `<div class="chips">${red.map(d => `<a class="chip block" href="${link('/data/' + encodeURIComponent(d))}" data-link>${LOCK} Waiting on ${esc(dataName(d))}</a>`).join('')}${amber.map(([d, e]) => e === 'pending'
        ? `<a class="chip pmo-amber" data-pending href="${link('/data/' + encodeURIComponent(d))}" data-link title="Fix done, awaiting owner confirmation." aria-label="${esc(dataName(d))}: fix done, awaiting owner confirmation"><i class="pmo-adot"></i>Awaiting confirmation: ${esc(dataName(d))}</a>`
        : `<a class="chip pmo-amber" href="${link('/data/' + encodeURIComponent(d))}" data-link title="Examples only. Needs a live source before go-live." aria-label="${esc(dataName(d))}: examples only, needs a live source before go-live"><i class="pmo-adot"></i>Examples only: ${esc(dataName(d))}</a>`).join('')}</div>` : ''}`;
  }
  const goAttr = trig ? '' : `data-go="/process/${esc(pid)}/step/${esc(n.id)}"`;
  return `<div class="${cls}" data-step="${esc(n.id)}" ${goAttr}>
    <div class="nh"><span class="ic">${trig ? '⚡' : idx}</span>
      <div style="min-width:0"><div class="ttl">${esc(n.title)}</div><div class="num">${trig ? 'Kickoff / trigger' : esc(pname(n.owner))}</div></div>
      <div style="margin-left:auto;display:flex;gap:5px;align-items:center">${diff}${trig ? '' : av(n.owner)}</div></div>
    <div class="nb">${body}</div></div>`;
}
function flowHTML(nodes, pid, prj, dp, counter) {
  counter = counter || { n: 0 };
  const parts = []; let run = [];
  const flush = () => {
    if (!run.length) return;
    parts.push(`<button class="collapsed" data-expand="1">▸ ${run.length} unchanged step${run.length > 1 ? 's' : ''}: ${run.map(r => esc(r.title)).join(', ')} <span style="float:right">show</span></button>`);
    run = [];
  };
  (nodes || []).forEach(n => {
    const gateway = Array.isArray(n.branches);
    const isStep = n.type !== 'trigger' && n.type !== 'end' && !gateway;
    const same = !dp || !dp.nodes || !dp.nodes[n.id] || dp.nodes[n.id] === 'same';
    const collapsible = !showUnchanged && isStep && same && !store.list('workItem', w => w.projectId === prj && w.pid === pid && w.step === n.id).length;
    if (collapsible) { counter.n++; run.push(n); return; }
    flush();
    if (gateway) {
      const br = n.branches || [];
      const par = n.type === 'parallel';
      const gk = dp && dp.nodes ? dp.nodes[n.id] : null;
      const gchip = gk === 'new' ? ' <span class="chip diff-new" data-gw-diff="new">NEW</span>' : gk === 'changed' ? ' <span class="chip diff-changed" data-gw-diff="changed">CHANGED</span>' : '';
      parts.push(`<div class="decision" data-gateway="${esc(n.id)}"><div class="diamond">${par ? '⫴' : '◆'} ${esc(n.title)}${par ? ' <small style="font-weight:500">(all run)</small>' : ''}${gchip}</div><div class="conn"></div>
        <div class="branches" style="--bl:${100 / (Math.max(1, br.length) * 2)}%;--br:${100 / (Math.max(1, br.length) * 2)}%">${br.map(b => `<div class="branch"><span class="blabel">${esc(b.label)}</span>
          ${(b.nodes || []).length ? `<div class="flow">${flowHTML(b.nodes, pid, prj, dp, counter)}</div>` : `<div class="passthru">${b.goto ? '↩ Loop back' : 'Continue → next step'}</div>`}</div>`).join('')}</div></div>`);
    } else {
      const idx = (n.type === 'trigger' || n.type === 'end') ? '' : (++counter.n);
      parts.push(nodeHTML(n, pid, prj, idx, dp));
    }
  });
  flush();
  return parts.join('<div class="conn"></div>');
}
function mapHTML(j) {
  const procs = (j.processes || []).map(pid => [pid, store.get('process', pid)]);
  if (!procs.length) return `<div class="empty">No processes linked yet. Link a to-be process to plan work against its steps.<div style="margin-top:10px"><button class="btn primary" data-link-proc>Link a process</button></div></div>`;
  return procs.map(([pid, p]) => {
    if (!p) return `<div class="pgroup"><div class="empty">A linked process (${esc(pid)}) no longer exists. Use “Link a process” to tidy the list.</div></div>`;
    const dp = eng('diffProcess', { nodes: {}, removed: [] }, p) || { nodes: {}, removed: [] };
    const removed = (dp.removed || []).filter(r => r && r.type !== 'trigger' && r.type !== 'end');
    return `<div class="pgroup"><a class="pgroup-h" href="${link('/process/' + encodeURIComponent(pid))}" data-link>▤ ${esc(p.name)} <span style="color:var(--accent);font-weight:500">open design ›</span></a>
      <div class="flow">${flowHTML(p.tobe, pid, j.id, dp)}
      ${removed.length ? `<div class="conn"></div><div class="hint" style="margin-bottom:6px">Removed from as-is</div>${removed.map(g => `<div class="ghost">${esc(g.title)}</div>`).join('<div style="height:8px"></div>')}` : ''}</div></div>`;
  }).join('') + `<div style="text-align:center;margin-top:28px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
    <button class="btn" data-expand="${showUnchanged ? '0' : '1'}">${showUnchanged ? 'Hide unchanged steps' : 'Show unchanged steps'}</button>
    <button class="btn" data-link-proc>+ Link another process</button></div>`;
}

/* ---------------------------------------------------------------- timeline */
function groupedItems(j, list) {
  const items = list || projectItems(j.id);
  const groups = [];
  const seen = new Set();
  (j.processes || []).forEach(pid => {
    const p = store.get('process', pid); if (!p) return;
    const order = flatSteps(p.tobe).map(s => s.id);
    const list = items.filter(w => w.pid === pid).sort((a, b) => (order.indexOf(a.step) - order.indexOf(b.step)) || String(a.start).localeCompare(String(b.start)));
    list.forEach(w => seen.add(w.id));
    if (list.length) groups.push({ pid, name: p.name, items: list, order });
  });
  const rest = items.filter(w => !seen.has(w.id)).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  if (rest.length) groups.push({ pid: '_other', name: 'Other work (process not linked)', items: rest, order: [] });
  return groups;
}
const shortId = id => String(id || '').length <= 8 ? String(id) : '';
function timelineHTML(j, fc, list) {
  const groups = groupedItems(j, list);
  const all = groups.flatMap(g => g.items);
  if (!all.length) return list && projectItems(j.id).length ? noMatchHTML() : emptyWorkHTML();
  const bls = j.baselines || [];
  const bl = bls.find(b => b.id === blPick[j.id]) || bls[bls.length - 1] || null;
  const blItems = (showBaseline && bl && bl.items) || {};
  const start = addDays(minDate([...all.map(w => w.start), today()]), -2);
  const end = addDays(maxDate([...all.map(w => (fc[w.id] || {}).forecast || w.due), ...all.map(w => w.due), ...all.map(w => w.doneAt), j.target, today(), ...Object.values(blItems).map(x => x && x.due)]), 4);
  const span = Math.max(1, dayDiff(end, start));
  const pos = s => (dayDiff(s, start) / span * 100);
  const ticks = []; for (let d = start; d <= end; d = addDays(d, 7)) ticks.push(d);
  const marks = `<span class="tday" style="left:${pos(today())}%"></span>${j.target ? `<span class="tgt" style="left:${pos(j.target)}%"></span>` : ''}`;
  const crit = new Set(showCrit ? criticalIds(j, fc) : []);
  let rows = `<tr class="thead"><td class="lab"><span class="hint">${all.length} work items</span></td><td class="lane">${ticks.map(t => `<span class="tick" style="left:${pos(t)}%">${fmt(t)}</span>`).join('')}${marks}</td></tr>`;
  groups.forEach(g => {
    rows += `<tr class="grp"><td class="lab">${esc(g.name)}</td><td class="lane"></td></tr>`;
    g.items.forEach(w => {
      const f = fc[w.id] || {}, fcast = f.forecast || w.due;
      const s0 = w.start || w.due, l = pos(s0), wd = Math.max(1.5, pos(w.due) - l);
      const b = blItems[w.id];
      const deps = (w.deps || []).map(d => { const t = (store.get('workItem', depId(d)) || {}).title; const l = depLabel(d); return t ? t + (l ? ` (${l})` : '') : null; }).filter(Boolean);
      const sid = shortId(w.id);
      const barTxt = wd < 6 ? '' : `${sid && wd >= 11 ? esc(sid) + ' · ' : ''}${esc(fmt(s0))} – ${esc(fmt(w.due))}`;
      const sub = [stepTitle(w.pid, w.step), pname(w.owner)];
      if (w.resolves) sub.push('unblocks ' + dataName(w.resolves));
      if (deps.length) sub.push('after ' + deps.join(', '));
      const actual = w.status === 'done' && w.doneAt;
      const isCrit = crit.has(w.id);
      const drag = w.status !== 'done' && canEditWork(w, j);
      const barCls = `tbar ${esc(w.status)}${isCrit ? ' pmo-crit' : ''}${drag ? ' pmo-drag' : ''}`;
      const barTitle = `${w.title} · ${dueLine(w, f)}${isCrit ? ' · on the critical path' : ''}`;
      const bar = drag
        ? `<button type="button" class="${barCls}" data-bar="${esc(w.id)}" style="left:${l}%;width:${wd}%" title="${esc(barTitle)}. Drag to reschedule." aria-label="${esc(`${w.title}: ${fmt(s0)} to ${fmt(w.due)}${isCrit ? ', critical path' : ''}. Drag to reschedule, or press Enter to edit dates.`)}">${barTxt}</button>`
        : `<span class="${barCls}" data-bar="${esc(w.id)}" style="left:${l}%;width:${wd}%" title="${esc(barTitle)}${w.status === 'done' ? '' : '. ' + esc(lockTitle(w, j))}">${barTxt}</span>`;
      rows += `<tr class="click ${isCrit ? 'pmo-crit-row' : ''}" data-go="/process/${esc(w.pid)}/step/${esc(w.step)}"><td class="lab"><div class="t" title="${esc(w.title)}">${isCrit ? '<span class="pmo-crit-tag" title="On the critical path">CP</span> ' : ''}${w.kind === 'defect' ? BUG + ' ' : ''}${esc(w.title)}</div><div class="s" title="${esc(sub.join(' · '))}">${esc(sub.join(' · '))}</div></td>
        <td class="lane">${marks}
        ${b && b.due ? `<span class="pmo-blbar" style="left:${pos(b.start || b.due)}%;width:${Math.max(0.6, pos(b.due) - pos(b.start || b.due))}%"></span><span class="pmo-blmark" style="left:${pos(b.due)}%" title="Baseline due ${esc(fmt(b.due))}"></span>` : ''}
        ${bar}
        ${w.status !== 'done' && fcast > w.due ? `<span class="tslip" style="left:${pos(w.due)}%;width:${pos(fcast) - pos(w.due)}%" title="Forecast ${esc(fmt(fcast))}"></span>` : ''}
        ${actual && w.doneAt > w.due ? `<span class="tslip pmo-late-actual" style="left:${pos(w.due)}%;width:${pos(w.doneAt) - pos(w.due)}%"></span>` : ''}
        ${actual ? `<span class="pmo-actual" style="left:${pos(w.doneAt)}%" title="Finished ${esc(fmt(w.doneAt))} (planned ${esc(fmt(w.due))})"></span>` : ''}</td></tr>`;
    });
  });
  const critCtl = `<label class="pmo-toggle"><input type="checkbox" data-crit-toggle ${showCrit ? 'checked' : ''}/> Highlight critical path${showCrit && crit.size ? ` <span class="hint">(${crit.size} item${crit.size === 1 ? '' : 's'})</span>` : ''}</label>`;
  const blCtl = bls.length ? `<div class="pmo-tlbar">${critCtl}<label class="pmo-toggle"><input type="checkbox" data-bl-toggle ${showBaseline ? 'checked' : ''}/> Show baseline</label>
      <select class="pmo-sel" data-bl-pick aria-label="Baseline" ${showBaseline ? '' : 'disabled'}>${bls.map(x => `<option value="${esc(x.id)}" ${bl && x.id === bl.id ? 'selected' : ''}>${esc(x.label || 'Baseline')} · ${esc(fmt(x.at))}</option>`).join('')}</select></div>`
    : `<div class="pmo-tlbar">${critCtl}<span class="hint">No baseline saved yet. “Save baseline” snapshots today’s plan so you can see drift here.</span></div>`;
  const canDrag = all.some(w => w.status !== 'done' && canEditWork(w, j));
  const dragHint = `<div class="hint pmo-draghint">${canDrag ? 'Drag a bar sideways to reschedule it (whole days, same duration). Or select a bar and press Enter to edit its dates.' : `Only each item’s owner or ${esc(pname(j.owner))} (project owner) can reschedule. Bars you can move have a grab handle.`}</div>`;
  return `${blCtl}${dragHint}<div class="tl" id="pmoTl" data-span="${span}"><table>${rows}</table><svg class="pmo-arrows" aria-hidden="true"></svg></div>
   <div class="legend" style="margin-top:12px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
    <div><span class="sw" style="background:var(--done)"></span>Done (planned dates)</div><div><span class="sw" style="background:var(--prog)"></span>In progress</div><div><span class="sw" style="background:#94a3b8"></span>Not started</div>
    <div><span class="sw" style="background:repeating-linear-gradient(45deg,#fecaca,#fecaca 4px,#fee2e2 4px,#fee2e2 8px)"></span>Forecast or actual slip</div>
    <div><span class="pmo-actual static"></span>Actual finish</div>
    <div><span class="sw pmo-sw-crit"></span>Critical path</div><div><span class="pmo-sw-arrow">→</span>Dependency</div>
    <div><span class="sw" style="border:0;border-left:2px solid var(--accent);border-radius:0"></span>Today</div><div><span class="sw" style="border:0;border-left:2px dashed #16a34a;border-radius:0"></span>Target</div>
    ${bls.length ? '<div><span class="pmo-blmark static"></span>Baseline due</div>' : ''}</div>`;
}

/* Critical path: engine R3 criticalPath, with a local fallback (latest-forecast chain walked back through deps). */
function criticalIds(j, fc) {
  const cp = eng('criticalPath', null, docs(), j.id, today());
  if (Array.isArray(cp)) return cp.map(x => typeof x === 'object' && x ? x.id || x.workId : x);
  const end = w => (fc[w.id] || {}).forecast || w.due;
  const open = projectItems(j.id).filter(w => w.status !== 'done');
  if (!open.length) return [];
  let cur = open.slice().sort((a, b) => String(end(b)).localeCompare(String(end(a))))[0];
  const path = [cur.id];
  for (let guard = 0; guard < 200; guard++) {
    const deps = (cur.deps || []).map(d => store.get('workItem', depId(d))).filter(x => x && x.projectId === j.id && x.status !== 'done' && !path.includes(x.id));
    if (!deps.length) break;
    cur = deps.sort((a, b) => String(end(b)).localeCompare(String(end(a))))[0];
    path.unshift(cur.id);
  }
  return path;
}
/* SVG connectors from each dependency's bar end to the dependent bar's start. Coordinates are in the scroll box's content space. */
function drawArrows(box) {
  const svg = box && box.querySelector('svg.pmo-arrows'); if (!svg) return;
  const br = box.getBoundingClientRect();
  const bars = {}; box.querySelectorAll('[data-bar]').forEach(b => { bars[b.dataset.bar] = b; });
  const pt = (el, side) => { const r = el.getBoundingClientRect(); return { x: (side === 'end' ? r.right : r.left) - br.left + box.scrollLeft, y: r.top + r.height / 2 - br.top + box.scrollTop }; };
  let paths = '';
  Object.keys(bars).forEach(id => {
    const w = store.get('workItem', id); if (!w) return;
    (w.deps || []).forEach(dRaw => {
      const dn = depNorm(dRaw), d = dn.id;
      const from = bars[d]; if (!from) return;
      /* FS: dep end -> start; SS: dep start -> start; FF: dep end -> end */
      const a = pt(from, dn.type === 'SS' ? 'start' : 'end'), b = pt(bars[id], dn.type === 'FF' ? 'end' : 'start');
      const crit = from.classList.contains('pmo-crit') && bars[id].classList.contains('pmo-crit');
      const dx = Math.max(14, Math.min(40, Math.abs(b.x - a.x) / 2));
      const sa = dn.type === 'SS' ? -1 : 1, sb = dn.type === 'FF' ? 1 : -1;
      paths += `<path class="${crit ? 'crit' : ''}" data-from="${esc(d)}" data-to="${esc(id)}" data-type="${dn.type}" d="M${a.x.toFixed(1)},${a.y.toFixed(1)} C${(a.x + sa * dx).toFixed(1)},${a.y.toFixed(1)} ${(b.x + sb * dx).toFixed(1)},${b.y.toFixed(1)} ${(b.x + sb).toFixed(1)},${b.y.toFixed(1)}" marker-end="url(#pmoArr${crit ? 'C' : ''})"/>`;
    });
  });
  svg.setAttribute('width', box.scrollWidth); svg.setAttribute('height', box.scrollHeight);
  svg.innerHTML = `<defs><marker id="pmoArr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></marker>
    <marker id="pmoArrC" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#b91c1c"/></marker></defs>${paths}`;
}
let arrowsResize = false;
async function reschedule(j, w, dd) {
  if (!canEditWork(w, j)) { toast(lockTitle(w, j)); rerender(); return; }
  const s0 = w.start || w.due;
  const next = Object.assign({}, w, { start: addDays(s0, dd), due: addDays(w.due, dd), updatedAt: stamp() });
  await store.save('workItem', w.id, next, `Rescheduled “${w.title}” on the timeline: ${fmt(s0)} – ${fmt(w.due)} → ${fmt(next.start)} – ${fmt(next.due)} (${dd > 0 ? '+' : ''}${dd}d)`);
  toast(`Moved ${dd > 0 ? 'later' : 'earlier'} by ${Math.abs(dd)} day${Math.abs(dd) === 1 ? '' : 's'}`);
}
/* Drag a bar horizontally to reschedule: snaps to whole days, keeps duration. Click or Enter opens the edit modal. */
function bindTimeline(root, j) {
  const box = root.querySelector('#pmoTl'); if (!box) return;
  const span = Number(box.dataset.span) || 1;
  requestAnimationFrame(() => drawArrows(box));
  if (!arrowsResize) { arrowsResize = true; window.addEventListener('resize', () => drawArrows(document.querySelector('#pmoTl'))); }
  box.querySelectorAll('button.tbar[data-bar]').forEach(bar => {
    let suppress = false;
    bar.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const w = store.get('workItem', bar.dataset.bar); if (!w) return;
      const pxDay = bar.parentElement.clientWidth / span;
      const x0 = e.clientX; let dd = 0, moved = false;
      const s0 = w.start || w.due;
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      let tip = null;
      const move = ev => {
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 4) return;
        moved = true;
        dd = Math.round(dx / pxDay);
        bar.style.transform = `translateX(${(dd * pxDay).toFixed(1)}px)`;
        bar.classList.add('dragging');
        if (!tip) { tip = document.createElement('span'); tip.className = 'pmo-dragtip'; bar.parentElement.appendChild(tip); }
        tip.style.left = bar.style.left;
        tip.style.transform = bar.style.transform;
        tip.textContent = `${fmt(addDays(s0, dd))} – ${fmt(addDays(w.due, dd))}${dd ? ` (${dd > 0 ? '+' : ''}${dd}d)` : ''}`;
      };
      const end = () => {
        bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', end); bar.removeEventListener('pointercancel', end);
        if (!moved) return;
        suppress = true;
        if (tip) tip.remove();
        if (!dd) { bar.style.transform = ''; bar.classList.remove('dragging'); return; }
        reschedule(j, w, dd);
      };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
    });
    bar.addEventListener('click', e => {
      e.stopPropagation();
      if (suppress) { suppress = false; return; }
      const w = store.get('workItem', bar.dataset.bar); if (w) editWork(store.get('project', j.id), w);
    });
  });
}

/* ---------------------------------------------------------------- work table */
const COLS = 9;
function workRowHTML(w, j, fc) {
  const deps = (w.deps || []).map(d => { const x = store.get('workItem', depId(d)); return x ? Object.assign({ lbl: depLabel(d) }, x) : null; }).filter(Boolean);
  const can = canEditWork(w, j), lt = can ? '' : `disabled title="${esc(lockTitle(w, j))}"`;
  const risks = risksFor(w.id);
  const run = w.testRef && w.testRef.runId;
  return `<tr data-wid="${esc(w.id)}" class="${can ? '' : 'pmo-ro'} ${w.kind === 'defect' ? 'pmo-defect' : ''}">
    <td><b class="pmo-wt">${w.kind === 'defect' ? BUG + ' ' : ''}${esc(w.title)}</b><div class="pmo-wsub">${w.kind ? `<span class="chip ${w.kind === 'defect' ? 'pmo-chip-defect' : ''}">${esc(KIND_LBL[w.kind] || w.kind)}</span>` : ''}${w.resolves ? `<span class="chip">${LOCK} resolves ${esc(dataName(w.resolves))}</span>` : ''}${risks.length ? `<span class="pmo-riskb" title="${esc(risks.map(r => r.title).join(' · '))}">⚠ ${risks.length} risk${risks.length > 1 ? 's' : ''}</span>` : ''}${w.kind === 'defect' ? `<a class="pmo-runlink" href="${link('/testing/' + encodeURIComponent(j.id) + (run ? '?run=' + encodeURIComponent(run) : ''))}" data-link>${run ? 'View test run ›' : 'Testing ›'}</a>` : ''}</div></td>
    <td class="pmo-c-step"><div class="pmo-wstep">${esc(stepTitle(w.pid, w.step))}</div><div class="hint">${esc(procName(w.pid))}</div></td>
    <td class="pmo-nowrap pmo-c-owner">${av(w.owner)} ${esc(pname(w.owner).split(' ')[0])}</td>
    <td><select class="pmo-sel st-${esc(w.status)}" data-status="${esc(w.id)}" aria-label="Status of ${esc(w.title)}" ${lt}>${['idle', 'prog', 'done'].map(s => `<option value="${s}" ${w.status === s ? 'selected' : ''}>${STATUS_LBL[s]}</option>`).join('')}</select></td>
    <td class="pmo-nowrap pmo-c-dates">${esc(fmt(w.start))} → ${esc(fmt(w.due))}</td>
    <td class="pmo-nowrap pmo-c-eff"><span class="pmo-eff">${fmtEffort(effortOf(w))}</span></td>
    <td class="pmo-c-sched">${wBadge(w, fc[w.id])}${whyBtn(w)}<div class="pmo-dl">${esc(dueLine(w, fc[w.id]))}</div></td>
    <td class="pmo-deps pmo-c-deps">${deps.length ? '<span class="pmo-c-lbl">After </span>' + deps.map(d => `<span class="dep">${esc(d.title)}${d.lbl ? ` <small class="pmo-deptype">${esc(d.lbl)}</small>` : ''}${d.status === 'done' ? ' ✓' : ''}</span>`).join('') : '<span class="hint">—</span>'}</td>
    <td class="pmo-nowrap"><button class="btn sm" data-edit-work="${esc(w.id)}" ${lt}>Edit</button> <button class="btn sm danger" data-del-work="${esc(w.id)}" aria-label="Delete ${esc(w.title)}" ${lt}>Delete</button></td></tr>`;
}
function rollup(items) {
  const done = items.filter(w => w.status === 'done').length;
  const effort = items.reduce((a, w) => a + effortOf(w), 0);
  const pct = items.length ? Math.round(done / items.length * 100) : 0;
  return `<span class="pmo-roll"><span class="bar"><i style="width:${pct}%"></i></span><b>${done}/${items.length}</b> done · ${fmtEffort(effort)} effort</span>`;
}
function workHTML(j, fc, list) {
  const items = (list || projectItems(j.id)).slice().sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const isPM = store.state.me === j.owner;
  const head = `<div class="pmo-tlbar"><div class="seg" role="tablist" aria-label="Group work"><button data-wgroup="flat" class="${workGroup === 'flat' ? 'on' : ''}">Flat list</button><button data-wgroup="step" class="${workGroup === 'step' ? 'on' : ''}">By process › step</button></div>
    <span class="hint">${items.length} item${items.length === 1 ? '' : 's'} · ${isPM ? 'you’re the project owner, so you can update any item' : `you can update your own items; ${esc(pname(j.owner))} (project owner) can update all`}</span><button class="btn primary sm" data-add-work>+ Add work item</button></div>`;
  if (!items.length) return head + (projectItems(j.id).length ? noMatchHTML() : emptyWorkHTML());
  let body;
  if (workGroup === 'step') {
    body = groupedItems(j, items).map(g => {
      const pk = 'p:' + g.pid, pOpen = !folded.has(pk);
      let out = `<tr class="pmo-gh p" data-tg="${esc(pk)}"><td colspan="${COLS}"><button class="pmo-gh-btn" aria-expanded="${pOpen}">${pOpen ? '▾' : '▸'} ${esc(g.name)}</button>${rollup(g.items)}</td></tr>`;
      if (!pOpen) return out;
      const steps = [...new Set(g.items.map(w => w.step))];
      steps.forEach(sid => {
        const sItems = g.items.filter(w => w.step === sid);
        const sk = 's:' + g.pid + ':' + sid, sOpen = !folded.has(sk);
        out += `<tr class="pmo-gh s" data-tg="${esc(sk)}"><td colspan="${COLS}"><button class="pmo-gh-btn" aria-expanded="${sOpen}">${sOpen ? '▾' : '▸'} ${esc(stepTitle(g.pid, sid))}</button>${rollup(sItems)}</td></tr>`;
        if (sOpen) out += sItems.map(w => workRowHTML(w, j, fc)).join('');
      });
      return out;
    }).join('');
  } else body = items.map(w => workRowHTML(w, j, fc)).join('');
  return head + `<div class="card pmo-flush"><div class="tbl-wrap"><table class="pmo-work ${workGroup === 'step' ? 'grouped' : ''}">
    <thead><tr><th>Work item</th><th class="pmo-c-step">Step</th><th>Owner</th><th>Status</th><th>Planned</th><th>Effort</th><th>Schedule</th><th>After</th><th></th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

/* ---------------------------------------------------------------- side panel */
function sideHTML(j, fc) {
  const items = projectItems(j.id);
  const open = items.filter(w => w.status !== 'done');
  /* R3: red = effectively missing data on steps with open work. Everything else not live (examples-only, or missing
     with no open work yet) is amber: it doesn't hold work today but fails the gate's data-live check. */
  const held = {};
  (j.processes || []).forEach(pid => {
    const p = store.get('process', pid); if (!p) return;
    flatSteps(p.tobe).forEach(s => {
      if (!items.some(w => w.pid === pid && w.step === s.id && w.status !== 'done')) return;
      (s.data || []).forEach(d => { if (effAvail(d) === 'missing') (held[d] = held[d] || []).push({ pid, s }); });
    });
  });
  const blockers = Object.entries(held).map(([d, steps]) => ({ d, steps, r: resolverOf(d, j.id) })).sort((a, b) => b.steps.length - a.steps.length);
  const amber = projectData(j).filter(d => !held[d] && effAvail(d) !== 'live').map(d => ({ d, e: effAvail(d), r: resolverOf(d, j.id) }));
  const fixLine = r => r ? `<div class="s">Fix: ${esc(r.title)} · ${esc(pname(r.owner))}</div><div class="s pmo-schedrow">${schedHTML(r, fc[r.id])}</div>` : '<div class="s pmo-noplan">No resolution plan. Add a work item that resolves it.</div>';
  const ranked = open.map(w => ({ w, n: (eng('dependents', [], docs(), w.id) || []).length })).sort((a, b) => b.n - a.n || String(a.w.due).localeCompare(String(b.w.due)));
  const dueSorted = open.slice().sort((a, b) => String(a.due).localeCompare(String(b.due)));
  return `
    <div class="card" data-blockers><h3>${LOCK} Biggest blockers <span class="n">${blockers.length}</span></h3>${blockers.map(({ d, steps, r }) => `<div class="row click" data-go="/data/${esc(d)}"><span style="color:var(--late);margin-top:2px">${LOCK}</span><div><div class="t">${esc(dataName(d))}</div>
      ${fixLine(r)}</div><div class="r"><b style="color:var(--late)">${steps.length}</b><div class="s">step${steps.length === 1 ? '' : 's'} held</div></div></div>`).join('') || '<div class="s">No data is holding open work. Missing data on steps with open work shows here.</div>'}</div>
    ${amber.length ? `<div class="card pmo-amber-card" data-needs-live><h3><i class="pmo-adot"></i> Needs a live source before go-live <span class="n">${amber.length}</span></h3><div class="hint" style="margin:-4px 0 8px">Not holding work today, but the release gate requires live data.</div>${amber.map(({ d, e, r }) => `<div class="row click" data-go="/data/${esc(d)}"><span class="pmo-amber-dot" aria-hidden="true"></span><div><div class="t">${esc(dataName(d))} <span class="badge ${e === 'missing' ? 'b-late' : 'b-soon'}">${e === 'example' ? 'Examples only' : e === 'pending' ? 'Fix done · awaiting owner confirmation' : 'Missing'}</span></div>${e === 'pending' ? `<div class="s">Waiting for ${esc(pname((store.get('dataElement', d) || {}).owner))} to confirm the live source.</div>` : fixLine(r)}</div></div>`).join('')}</div>` : ''}
    <div class="card" data-upnext><h3>Up next <span class="n">${open.length}</span></h3>${items.length ? `<div class="hint" style="margin:-4px 0 8px">Ranked by how much downstream work each one unblocks</div>${ranked.slice(0, 5).map(({ w, n }) => `<div class="row click" data-go="/process/${esc(w.pid)}/step/${esc(w.step)}">${av(w.owner)}<div><div class="t">${esc(w.title)}</div><div class="s">${n ? `<b style="color:var(--ink)">Unblocks ${n}</b> · ` : ''}${esc(stepTitle(w.pid, w.step))}</div><div class="s pmo-schedrow">${schedHTML(w, fc[w.id])}</div></div></div>`).join('') || '<div class="s">All work is done.</div>'}`
      : `<div class="s" data-nowork>No work planned yet — <button class="btn sm" data-suggest>✦ Suggest work from diff</button></div>`}</div>
    <div class="card"><h3>Due dates</h3>${dueSorted.slice(0, 8).map(w => `<div class="row click" data-go="/process/${esc(w.pid)}/step/${esc(w.step)}"><div style="width:44px;text-align:center;flex:none"><b>${esc(fmt(w.due).split(' ')[1] || '')}</b><div class="s">${esc(fmt(w.due).split(' ')[0])}</div></div><div><div class="t">${esc(w.title)}</div><div class="s">${esc(pname(w.owner))}</div><div class="s pmo-schedrow">${schedHTML(w, fc[w.id])}</div></div></div>`).join('') || '<div class="s">Nothing open.</div>'}${dueSorted.length > 8 ? `<div class="hint" style="margin-top:6px">+${dueSorted.length - 8} more in the Work tab</div>` : ''}</div>
    <div class="card"><h3>How to read the map</h3><div class="legend">
      <div><span class="sw" style="background:var(--done-fill);border-color:#bbf7d0"></span>Done</div>
      <div><span class="sw" style="background:var(--prog-fill);border-left:4px solid var(--prog)"></span>In progress</div>
      <div><span class="sw" style="background:var(--idle-fill)"></span>Not started</div>
      <div><span class="sw" style="border:2px solid var(--soon)"></span>Due within 5 days</div>
      <div><span class="sw" style="border:2px solid var(--late)"></span>Late or slipping</div>
      <div><span class="chip block" style="padding:1px 6px">${LOCK}</span> Waiting on missing data</div>
      <div><span class="chip pmo-amber" style="padding:1px 6px"><i class="pmo-adot"></i></span> Examples only: needs live data before go-live</div>
      <div><span class="chip diff-new">NEW</span> Not in as-is</div>
      <div><span class="chip diff-changed">CHANGED</span> Differs from as-is</div></div>
      <div class="hint" style="margin-top:8px">A step’s status comes from its work items. Unchanged steps with no work are collapsed. A late fix pushes back every item that depends on it.</div></div>
    ${activityCard('project:' + j.id)}
    <div class="card"><h3>Work item changes</h3>${feedHTML('prj-work')}</div>`;
}

/* ---------------------------------------------------------------- empty states */
function emptyWorkHTML() {
  return `<div class="card"><div class="empty" data-nowork>No work planned yet — <button class="btn sm primary" data-suggest>✦ Suggest work from diff</button> or <button class="btn sm" data-add-work>+ Add work item</button></div></div>`;
}
function noMatchHTML() {
  return `<div class="card"><div class="empty" data-nomatch>No work items match these filters. <button class="btn sm" data-fclear>Clear filters</button></div></div>`;
}

/* ---------------------------------------------------------------- shared filter bar (Board, Sprints, Timeline, Work)
   Filters are views of the same work items: owner, status, process/step, data, late/slipping, text. They live in the URL query. */
const FKEYS = ['owner', 'status', 'step', 'data', 'late', 'q'];
const FILTER_MODES = ['board', 'sprints', 'timeline', 'work'];
const ST_FILTER = { open: 'Not done', idle: 'Not started', prog: 'In progress', done: 'Done' };
export function readFilters(q) { const f = {}; FKEYS.forEach(k => { if (q && q[k]) f[k] = String(q[k]); }); return f; }
const sameFilters = (a, b) => FKEYS.every(k => String((a || {})[k] || '') === String((b || {})[k] || ''));
function nodeData(pid, sid) { const n = nodeOf(pid, sid) || {}; return [...(n.data || []), ...(n.subs || []).flatMap(x => x.data || [])]; }
export function filterItems(items, f, fc) {
  const q = String(f.q || '').trim().toLowerCase();
  return items.filter(w => {
    if (f.owner && w.owner !== f.owner) return false;
    if (f.status === 'open' ? w.status === 'done' : (f.status && w.status !== f.status)) return false;
    if (f.step) { const [pid, sid] = f.step.split('::'); if (w.pid !== pid || (sid && w.step !== sid)) return false; }
    if (f.data && w.resolves !== f.data && !nodeData(w.pid, w.step).includes(f.data)) return false;
    if (f.late) { const s = (fc[w.id] || {}).sched; if (w.status === 'done' || (s !== 'late' && s !== 'slip')) return false; }
    if (q && ![w.title, stepTitle(w.pid, w.step), pname(w.owner), procName(w.pid), w.resolves ? dataName(w.resolves) : ''].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}
export function describeFilters(f) {
  const out = [];
  if (f.owner) out.push('owner ' + pname(f.owner));
  if (f.status) out.push('status ' + (ST_FILTER[f.status] || f.status).toLowerCase());
  if (f.step) { const [pid, sid] = f.step.split('::'); out.push(sid ? 'step “' + stepTitle(pid, sid) + '”' : 'process “' + procName(pid) + '”'); }
  if (f.data) out.push('data ' + dataName(f.data));
  if (f.late) out.push('late or slipping');
  if (f.q) out.push('“' + f.q + '”');
  return out.join(', ') || 'no filters';
}
function prjURL(prj, mode, f, view) {
  const sp = new URLSearchParams();
  if (mode && mode !== 'map') sp.set('mode', mode);
  FKEYS.forEach(k => { if (f && f[k]) sp.set(k, f[k]); });
  if (view) sp.set('view', view);
  const s = sp.toString();
  return '/project/' + encodeURIComponent(prj) + (s ? '?' + s : '');
}
let refocusSearch = false;
function setFilters(prj, mode, f, view, push) {
  const path = link(prjURL(prj, mode, f, view));
  if (push) history.pushState({}, '', path); else history.replaceState({}, '', path);
  rerender();
}
function filterBarHTML(j, f, mode, shown, total, view) {
  const people = [...new Set(projectItems(j.id).map(w => w.owner).concat(j.resources || []))].filter(id => store.person(id));
  const views = j.views || [];
  const active = views.find(v => v.id === view && sameFilters(v.filters, f)) || views.find(v => sameFilters(v.filters, f) && Object.keys(f).length);
  const any = Object.keys(f).length > 0;
  const stepOpts = (j.processes || []).map(pid => { const p = store.get('process', pid); if (!p) return '';
    return `<option value="${esc(pid)}" ${f.step === pid ? 'selected' : ''}>${esc(p.name)} (all steps)</option>` + planNodes(pid).map(n => `<option value="${esc(pid)}::${esc(n.id)}" ${f.step === pid + '::' + n.id ? 'selected' : ''}>&nbsp;&nbsp;${Array.isArray(n.branches) ? '◆ ' : ''}${esc(n.title)}</option>`).join(''); }).join('');
  return `<div class="pmo-fbar" data-fbar role="search" aria-label="Filter work">
    <select class="pmo-sel" data-f="owner" aria-label="Filter by owner"><option value="">Any owner</option>${people.map(id => `<option value="${esc(id)}" ${f.owner === id ? 'selected' : ''}>${esc(pname(id))}</option>`).join('')}</select>
    <select class="pmo-sel" data-f="status" aria-label="Filter by status"><option value="">Any status</option>${Object.entries(ST_FILTER).map(([k, l]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select class="pmo-sel pmo-fstep" data-f="step" aria-label="Filter by process or step"><option value="">Any process / step</option>${stepOpts}</select>
    <select class="pmo-sel" data-f="data" aria-label="Filter by data element"><option value="">Any data</option>${projectData(j).map(d => `<option value="${esc(d)}" ${f.data === d ? 'selected' : ''}>${esc(dataName(d))}</option>`).join('')}</select>
    <label class="pmo-toggle pmo-flate"><input type="checkbox" data-f="late" ${f.late ? 'checked' : ''}/> Late or slipping</label>
    <input class="pmo-sel pmo-fq" type="search" data-f="q" value="${esc(f.q || '')}" placeholder="Search work…" aria-label="Search work items" />
    <span class="pmo-fsep"></span>
    <select class="pmo-sel" data-view-pick aria-label="Saved views"><option value="">${views.length ? 'Saved views…' : 'No saved views'}</option>${views.map(v => `<option value="${esc(v.id)}" ${active && active.id === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
    <button class="btn sm" data-save-view ${any ? '' : 'disabled title="Set a filter first"'}>Save view</button>
    ${active ? `<button class="btn sm danger" data-del-view="${esc(active.id)}" aria-label="Delete saved view ${esc(active.name)}">Delete view</button>` : ''}
    ${any ? `<button class="btn sm" data-fclear>Clear</button>` : ''}
    <span class="hint pmo-fcount" data-fcount>${any ? `Showing ${shown} of ${total}` : `${total} item${total === 1 ? '' : 's'}`}</span></div>`;
}
function bindFilters(root, j, mode, f, view) {
  const bar = root.querySelector('[data-fbar]'); if (!bar) return;
  const apply = (next, keepView) => setFilters(j.id, mode, next, keepView ? view : null);
  bar.querySelectorAll('select[data-f]').forEach(el => el.addEventListener('change', () => { const n = Object.assign({}, f); if (el.value) n[el.dataset.f] = el.value; else delete n[el.dataset.f]; apply(n); }));
  const late = bar.querySelector('input[data-f="late"]'); if (late) late.addEventListener('change', () => { const n = Object.assign({}, f); if (late.checked) n.late = '1'; else delete n.late; apply(n); });
  const q = bar.querySelector('input[data-f="q"]');
  if (q) {
    let t = null;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { const n = Object.assign({}, f); const v = q.value.trim(); if (v) n.q = v; else delete n.q; refocusSearch = true; apply(n); }, 300); });
    if (refocusSearch) { refocusSearch = false; q.focus(); const L = q.value.length; try { q.setSelectionRange(L, L); } catch (e) { /* search inputs */ } }
  }
  root.querySelectorAll('[data-fclear]').forEach(b => b.addEventListener('click', () => apply({})));
  const vp = bar.querySelector('[data-view-pick]');
  if (vp) vp.addEventListener('change', () => { const v = (j.views || []).find(x => x.id === vp.value); if (v) setFilters(j.id, mode, readFilters(v.filters), v.id); else apply({}); });
  const sv = bar.querySelector('[data-save-view]'); if (sv) sv.addEventListener('click', () => saveView(store.get('project', j.id), mode, f));
  const dv = bar.querySelector('[data-del-view]'); if (dv) dv.addEventListener('click', () => deleteView(store.get('project', j.id), dv.dataset.delView, mode, f));
}
async function saveView(j, mode, f, err) {
  const r = await modal({ title: 'Save view', body: `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}<p class="hint" style="margin:0">Saves these filters on the project so anyone can pick them from “Saved views”: <b>${esc(describeFilters(f))}</b>.</p>
    <div class="field"><label for="pmo-vname">View name</label><input id="pmo-vname" name="name" maxlength="60" placeholder="e.g. Dev’s late work" /></div>`, actions: [{ id: 'save', label: 'Save view', primary: true }] });
  if (r.action !== 'save') return;
  const name = String(r.form.name || '').trim();
  if (!name) return saveView(j, mode, f, 'Give the view a name.');
  const cur = store.get('project', j.id) || j;
  if ((cur.views || []).some(v => v.name.toLowerCase() === name.toLowerCase())) return saveView(j, mode, f, `A view called “${name}” already exists.`);
  const v = { id: store.newId('vw'), name, filters: readFilters(f), by: store.state.me, at: stamp() };
  history.replaceState({}, '', link(prjURL(j.id, mode, f, v.id)));
  await store.save('project', j.id, Object.assign({}, cur, { views: [...(cur.views || []), v] }), `Saved view “${name}” (${describeFilters(f)})`);
  toast('View saved');
}
async function deleteView(j, id, mode, f) {
  const v = (j.views || []).find(x => x.id === id); if (!v) return;
  const r = await modal({ title: 'Delete saved view?', body: `<p style="margin:0">Delete the view <b>${esc(v.name)}</b>? The work items are not affected.</p>`, actions: [{ id: 'delete', label: 'Delete', danger: true }] });
  if (r.action !== 'delete') return;
  history.replaceState({}, '', link(prjURL(j.id, mode, f, null)));
  await store.save('project', j.id, Object.assign({}, j, { views: (j.views || []).filter(x => x.id !== id) }), `Deleted saved view “${v.name}”`);
  toast('View deleted');
}

/* ---------------------------------------------------------------- cards (Board + Sprints) */
/* Data blockers on an open item: its step's data that is effectively missing or pending, plus the forecast's data cause. */
function dataBlockers(w, f) {
  if (w.status === 'done') return [];
  const ids = new Set(nodeData(w.pid, w.step).filter(d => d !== w.resolves));
  if (f && f.cause && store.get('dataElement', f.cause)) ids.add(f.cause);
  return [...ids].map(d => ({ d, e: effAvail(d) })).filter(x => x.e === 'missing' || x.e === 'pending');
}
function shortDue(w, f) {
  f = f || {};
  if (w.status === 'done') return `Done ${fmt(w.doneAt || w.due)}`;
  const fcast = f.forecast || w.due;
  return fcast > w.due ? `Due ${fmt(w.due)} → ${fmt(fcast)}` : `Due ${fmt(w.due)}`;
}
function cardHTML(w, j, fc, extra) {
  const f = fc[w.id] || {};
  const can = canEditWork(w, j);
  const risks = risksFor(w.id);
  const blk = dataBlockers(w, f);
  const chips = [
    ...blk.map(({ d, e }) => e === 'pending'
      ? `<span class="chip pmo-amber" data-blocker="${esc(d)}" title="Fix done, awaiting owner confirmation"><i class="pmo-adot"></i>${esc(dataName(d))}</span>`
      : `<span class="chip block" data-blocker="${esc(d)}" title="Waiting on missing data">${LOCK} ${esc(dataName(d))}</span>`),
    risks.length ? `<span class="pmo-riskb" data-risk title="${esc(risks.map(r => r.title).join(' · '))}">⚠ ${risks.length} risk${risks.length > 1 ? 's' : ''}</span>` : '',
    w.kind === 'defect' ? `<span class="chip pmo-chip-defect">${BUG} Defect</span>` : '',
  ].join('');
  return `<article class="pmo-card st-${esc(w.status)} ${can ? 'pmo-cdrag' : 'pmo-ro'}" data-card="${esc(w.id)}" ${can ? 'draggable="true"' : ''} tabindex="0"
      aria-label="${esc(`${w.title}. ${STATUS_LBL[w.status]}. Owner ${pname(w.owner)}. ${shortDue(w, f)}.${can ? ' Drag to move, or use the select inside the card.' : ' ' + lockTitle(w, j) + '.'}`)}" title="${esc(can ? 'Drag to move · click to edit' : lockTitle(w, j))}">
    <div class="pmo-card-h">${av(w.owner)}<b class="pmo-card-t">${esc(w.title)}</b>${can ? '' : `<span class="pmo-card-lock" aria-hidden="true">${LOCK}</span>`}</div>
    ${extra || ''}
    <div class="pmo-card-s">${esc(stepTitle(w.pid, w.step))} <span class="pmo-card-eff">· ${fmtEffort(effortOf(w))}</span></div>
    <div class="pmo-card-b">${wBadge(w, f)}${whyBtn(w)}<span class="pmo-card-due">${esc(shortDue(w, f))}</span></div>
    ${chips ? `<div class="pmo-card-c">${chips}</div>` : ''}</article>`;
}
const BOARD_COLS = [['idle', 'Not started'], ['prog', 'In progress'], ['done', 'Done']];
function boardHTML(j, fc, list) {
  if (!projectItems(j.id).length) return emptyWorkHTML();
  const can = list.some(w => canEditWork(w, j));
  const cols = BOARD_COLS.map(([k, l]) => {
    const items = list.filter(w => w.status === k).sort((a, b) => String(a.due).localeCompare(String(b.due)));
    const eff = items.reduce((a, w) => a + effortOf(w), 0);
    return `<section class="pmo-col" data-col="${k}" aria-label="${l}"><header class="pmo-col-h"><span class="pmo-col-dot st-${k}"></span><b>${l}</b><span class="n">${items.length}</span><span class="hint">${fmtEffort(eff)}</span></header>
      <div class="pmo-col-b">${items.map(w => cardHTML(w, j, fc, `<label class="pmo-card-kb">Status <select class="pmo-sel" data-status="${esc(w.id)}" aria-label="Status of ${esc(w.title)}" ${canEditWork(w, j) ? '' : 'disabled'}>${BOARD_COLS.map(([s, sl]) => `<option value="${s}" ${w.status === s ? 'selected' : ''}>${sl}</option>`).join('')}</select></label>`)).join('') || '<div class="pmo-col-empty">Drop a card here</div>'}</div></section>`;
  }).join('');
  return `<div class="hint pmo-draghint">${can ? 'Drag a card to another column to change its status. Keyboard: focus a card, press Tab to reach its status select.' : `Only each item’s owner or ${esc(pname(j.owner))} (project owner) can move cards.`}</div>
    ${list.length ? `<div class="pmo-board" data-board>${cols}</div>` : noMatchHTML()}`;
}
function bindDnD(root, sel, dropAttr, onDrop) {
  root.querySelectorAll('.pmo-card.pmo-cdrag').forEach(c => {
    c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', c.dataset.card); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
    c.addEventListener('dragend', () => { c.classList.remove('dragging'); root.querySelectorAll('.pmo-over').forEach(x => x.classList.remove('pmo-over')); });
  });
  root.querySelectorAll(sel).forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('pmo-over'); });
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('pmo-over'); });
    col.addEventListener('drop', e => { e.preventDefault(); col.classList.remove('pmo-over'); const id = e.dataTransfer.getData('text/plain'); if (id) onDrop(id, col.getAttribute(dropAttr)); });
  });
}
function bindCards(root, j) {
  root.querySelectorAll('.pmo-card[data-card]').forEach(c => {
    c.addEventListener('click', e => {
      if (e.target.closest('select,button,a,label')) return;
      const w = store.get('workItem', c.dataset.card); if (!w) return;
      const p = store.get('project', j.id);
      if (canEditWork(w, p)) editWork(p, w); else go(`/process/${w.pid}/step/${w.step}`);
    });
    c.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === c) { e.preventDefault(); c.click(); } });
  });
}

/* ---------------------------------------------------------------- sprints (a view of the same due dates) */
function sprintList(j) {
  const s = eng('sprints', null, j, today(), docs());
  if (Array.isArray(s) && s.length) return s.filter(x => x && x.start && x.end).map((x, i) => ({ id: String(x.id != null ? x.id : 'S' + (i + 1)), name: x.name || `Sprint ${i + 1}`, start: x.start, end: x.end }));
  return buildSprints(j, sprintCfg(j));
}
/* Explicit sprints for a cadence, covering the first start through the later of the forecast finish and target (max 52).
   Ids carry the start date, so re-planning never re-uses an old sprint id by accident. */
function buildSprints(j, cfg) {
  const items = projectItems(j.id), fc = forecasts();
  const s0 = cfg.start || minDate(items.map(w => w.start || w.due)) || today();
  const end = maxDate([...items.map(w => (fc[w.id] || {}).forecast || w.due), j.target, addDays(s0, cfg.length - 1)]);
  const out = []; let a = s0;
  for (let i = 0; a <= end && i < 52; i++) { const b = addDays(a, cfg.length - 1); out.push({ id: 'S-' + a, name: `Sprint ${i + 1}`, start: a, end: b }); a = addDays(b, 1); }
  return out;
}
/* project.sprints (engine R4) is an explicit list [{id, name, start, end}]; the cadence is read back from it. */
function sprintCfg(j) {
  const s = j.sprints;
  if (Array.isArray(s) && s.length && s[0].start && s[0].end) return { start: s[0].start, length: s[1] && s[1].start ? dayDiff(s[1].start, s[0].start) : dayDiff(s[0].end, s[0].start) + 1 };
  return { start: null, length: 14 };
}
function sprintIdOf(j, w, list) {
  const r = eng('sprintOf', undefined, j, w, docs(), today());
  const id = r && typeof r === 'object' ? r.id : r;
  if (id == null && w.sprintId && list.some(s => s.id === w.sprintId)) return w.sprintId;
  if (id != null && list.some(s => s.id === String(id))) return String(id);
  if (w.sprintId && list.some(s => s.id === w.sprintId)) return w.sprintId;
  const hit = list.find(s => w.due >= s.start && w.due <= s.end)
    /* a weekend due date between two working-week sprints belongs to the sprint that just ended */
    || list.find(s => w.due > s.end && dayDiff(w.due, s.end) <= 2 && isWeekend(w.due));
  return hit ? hit.id : null;
}
/* Capacity: each assigned person's days per week (default 4), pro-rated to the sprint's business days. */
function sprintLoad(sp, items) {
  const owners = [...new Set(items.map(w => w.owner))];
  const wd = bizDays(sp.start, sp.end);
  const cap = owners.reduce((a, id) => a + ((store.person(id) || {}).capacity > 0 ? store.person(id).capacity : 4) * wd / 5, 0);
  const effort = items.reduce((a, w) => a + effortOf(w), 0);
  return { owners, cap: Math.round(cap * 10) / 10, effort: Math.round(effort * 10) / 10, over: effort > cap + 1e-9 };
}
function sprintsHTML(j, fc, list) {
  if (!projectItems(j.id).length) return emptyWorkHTML();
  const sps = sprintList(j);
  const all = projectItems(j.id);
  const by = {}; all.forEach(w => { const k = sprintIdOf(j, w, sps) || '_none'; (by[k] = by[k] || []).push(w); });
  const shown = new Set(list.map(w => w.id));
  const cfg = sprintCfg(j);
  const isPM = store.state.me === j.owner;
  const opts = (w, cur) => sps.map(s => `<option value="${esc(s.id)}" ${cur === s.id ? 'selected' : ''}>${esc(s.name)} · ${esc(fmt(s.start))}–${esc(fmt(s.end))}</option>`).join('');
  const col = (sp, items) => {
    const ld = sp ? sprintLoad(sp, items) : null;
    const vis = items.filter(w => shown.has(w.id)).sort((a, b) => String(a.due).localeCompare(String(b.due)));
    const cur = sp && today() >= sp.start && today() <= sp.end;
    const pct = ld && ld.cap ? Math.min(100, ld.effort / ld.cap * 100) : (ld && ld.effort ? 100 : 0);
    return `<section class="pmo-spr ${ld && ld.over ? 'over' : ''} ${cur ? 'cur' : ''} ${sp ? '' : 'none'}" ${sp ? `data-sprint="${esc(sp.id)}"` : 'data-sprint-none'} aria-label="${esc(sp ? sp.name : 'Not in a sprint')}">
      <header class="pmo-spr-h"><div><b>${esc(sp ? sp.name : 'Not in a sprint')}</b>${cur ? ' <span class="badge b-ok">Current</span>' : ''}</div>
        ${sp ? `<div class="hint">${esc(fmt(sp.start))} – ${esc(fmt(sp.end))} · ${bizDays(sp.start, sp.end)} working days</div>` : '<div class="hint">Due outside every sprint</div>'}
        ${ld ? `<div class="pmo-spr-cap" data-cap-line><div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div><span><b>${fmtEffort(ld.effort)}</b> effort / ${fmtEffort(ld.cap)} capacity</span></div>
          ${ld.over ? `<div class="pmo-spr-over" data-over>Over capacity by ${fmtEffort(Math.round((ld.effort - ld.cap) * 10) / 10)}</div>` : ''}
          <div class="pmo-spr-who">${ld.owners.map(av).join('')}</div>` : ''}
        ${vis.length !== items.length ? `<div class="hint">${vis.length} of ${items.length} shown</div>` : ''}</header>
      <div class="pmo-spr-b">${vis.map(w => cardHTML(w, j, fc, `<label class="pmo-card-kb">Sprint <select class="pmo-sel" data-sprint-pick="${esc(w.id)}" aria-label="Sprint for ${esc(w.title)}" ${canEditWork(w, j) && w.status !== 'done' ? '' : 'disabled'}>${sp ? '' : '<option value="" selected>Not in a sprint</option>'}${opts(w, sp && sp.id)}</select></label>`)).join('') || `<div class="pmo-col-empty">${sp ? 'Drop work here' : ''}</div>`}</div></section>`;
  };
  const cols = sps.map(sp => col(sp, by[sp.id] || [])).join('') + ((by._none || []).length ? col(null, by._none) : '');
  return `<div class="pmo-tlbar pmo-spr-bar"><span class="hint">${esc((j.sprints || []).length ? `Planned cadence: ${cfg.length}-day sprints from ${fmt(cfg.start)}` : 'Automatic: two-week sprints from the week of the earliest work')} · effort counts this project’s work; capacity is each assigned person’s days per week, pro-rated to the sprint.</span>
      <button class="btn sm" data-plan-sprints ${isPM ? '' : `disabled title="${esc(`Only ${pname(j.owner)} (project owner) can change the sprint cadence`)}"`}>Plan sprints</button></div>
    <div class="hint pmo-draghint">Drag a card into a sprint to plan it there: its due date moves inside the sprint and its duration is kept. Keyboard: focus a card, Tab to its sprint select.</div>
    ${list.length ? `<div class="pmo-sprints" data-sprints>${cols}</div>` : noMatchHTML()}`;
}
async function moveToSprint(j, id, spId) {
  const w = store.get('workItem', id); if (!w) return;
  if (!canEditWork(w, j)) { toast(lockTitle(w, j)); rerender(); return; }
  if (w.status === 'done') { toast('Done work stays where it finished'); rerender(); return; }
  const sp = sprintList(j).find(s => s.id === spId); if (!sp) return;
  const s0 = w.start || w.due;
  let due = w.due < sp.start ? sp.start : w.due > sp.end ? sp.end : w.due;
  while (isWeekend(due) && due > sp.start) due = addDays(due, -1);
  while (isWeekend(due) && due < sp.end) due = addDays(due, 1);
  const dd = dayDiff(due, w.due);
  if (!dd && w.sprintId === sp.id) { rerender(); return; }
  const next = Object.assign({}, w, { sprintId: sp.id, start: addDays(s0, dd), due, updatedAt: stamp() });
  await store.save('workItem', w.id, next, `Planned “${w.title}” in ${sp.name} (${fmt(sp.start)} – ${fmt(sp.end)})${dd ? `: ${fmt(s0)} – ${fmt(w.due)} → ${fmt(next.start)} – ${fmt(next.due)} (${dd > 0 ? '+' : ''}${dd}d, same duration)` : ', dates unchanged'}`);
  toast(`Moved to ${sp.name}`);
}
async function planSprints(j, err, v) {
  if (store.state.me !== j.owner) { toast(`Only ${pname(j.owner)} (project owner) can change the sprint cadence`); return; }
  const cfg = sprintCfg(j);
  const cur = sprintList(j);
  v = v || { start: cfg.start || (cur[0] || {}).start || today(), length: cfg.length };
  const r = await modal({ title: 'Plan sprints', body: `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}
    <p class="hint" style="margin:0">Sprints are a view of the same due dates. Changing the cadence regroups work by due date; nothing else changes.</p>
    <div class="frow"><div class="field"><label for="pmo-sp-start">First sprint starts</label><input id="pmo-sp-start" type="date" name="start" value="${esc(v.start)}" /></div>
      <div class="field"><label for="pmo-sp-len">Sprint length (days)</label><input id="pmo-sp-len" type="number" name="length" min="5" max="42" step="1" value="${esc(v.length)}" /></div></div>`,
    actions: [...((j.sprints || []).length ? [{ id: 'auto', label: 'Use automatic' }] : []), { id: 'save', label: 'Save cadence', primary: true }] });
  if (r.action === 'auto') {
    const next = Object.assign({}, j); delete next.sprints;
    await store.save('project', j.id, next, 'Sprint cadence set back to automatic (two-week sprints)');
    toast('Sprints set to automatic'); return;
  }
  if (r.action !== 'save') return;
  const n = Number(r.form.length), start = r.form.start;
  if (!start) return planSprints(j, 'Pick the first sprint’s start date.', { start, length: r.form.length });
  if (!(n >= 5 && n <= 42) || Math.round(n) !== n) return planSprints(j, 'Sprint length must be a whole number of days between 5 and 42.', { start, length: r.form.length });
  const planned = buildSprints(j, { start, length: n });
  await store.save('project', j.id, Object.assign({}, j, { sprints: planned }), `Sprint cadence: ${n}-day sprints starting ${fmt(start)} (${planned.length} sprint${planned.length === 1 ? '' : 's'}, to ${fmt(planned[planned.length - 1].end)})`);
  toast('Sprint cadence saved');
}

/* ---------------------------------------------------------------- cross-project conflicts */
export function conflictsOf(j) {
  if (!j || j.status === 'live') return [];
  const mine = new Set(), data = new Set(projectData(j));
  (j.processes || []).forEach(pid => planNodes(pid).forEach(n => mine.add(pid + '::' + n.id)));
  return store.list('project', p => p.id !== j.id && p.status !== 'live').map(p => {
    const open = projectItems(p.id).filter(w => w.status !== 'done');
    const steps = {}; const res = {};
    open.forEach(w => {
      if (mine.has(w.pid + '::' + w.step)) (steps[w.pid + '::' + w.step] = steps[w.pid + '::' + w.step] || []).push(w);
      if (w.resolves && data.has(w.resolves)) (res[w.resolves] = res[w.resolves] || []).push(w);
    });
    return { p, steps: Object.entries(steps), res: Object.entries(res) };
  }).filter(x => x.steps.length || x.res.length);
}
function conflictHTML(j) {
  const cs = conflictsOf(j); if (!cs.length) return '';
  return `<div class="pmo-conflict" data-conflicts role="note"><b>Overlaps with other active projects.</b> Coordinate before changing these:
    <ul>${cs.map(({ p, steps, res }) => `<li data-conflict="${esc(p.id)}"><a href="${link('/project/' + encodeURIComponent(p.id) + '?mode=work')}" data-link>${esc(p.name)}</a> (${esc(pname(p.owner))}):
      ${[...steps.map(([k, ws]) => { const [pid, sid] = k.split('::'); return `<a href="${link(prjURL(p.id, 'work', { step: k }))}" data-link>${ws.length} open item${ws.length === 1 ? '' : 's'} on “${esc(stepTitle(pid, sid))}”</a>`; }),
        ...res.map(([d, ws]) => `<a href="${link('/data/' + encodeURIComponent(d))}" data-link>resolving ${esc(dataName(d))}</a> <span class="hint">(${esc(ws.map(w => w.title).join(', '))})</span>`)].join('; ')}</li>`).join('')}</ul></div>`;
}

/* ---------------------------------------------------------------- status report on the project page */
const reports = {}; /* prj -> {loading|data|error} */
const txt = x => x == null ? '' : typeof x === 'string' ? x : (x.text || x.title || x.summary || x.detail || JSON.stringify(x));
export function reportText(j, d) {
  const sec = (h, arr) => (arr && arr.length) ? `\n${h}\n` + arr.map(x => '- ' + txt(x)).join('\n') + '\n' : '';
  return `${j.name}: status report (${fmt(today())})\n\n${txt(d.headline)}\n\n${txt(d.summary)}\n${sec('Highlights', d.highlights)}${sec('Risks', d.risks)}${sec('Asks', d.asks)}`.trim();
}
function reportPanelHTML(j, r) {
  const rep = reports[j.id]; if (!rep) return '';
  let body;
  if (rep.loading) body = '<div class="pmo-rep-loading"><span class="pmo-spin"></span> Generating the report…</div>';
  else if (rep.error) body = `<div class="banner">Couldn’t generate the report: ${esc(rep.error)}</div>`;
  else {
    const d = rep.data || {}, ai = String(d.source || '').toLowerCase() === 'ai';
    const list = (h, arr, cls) => (arr && arr.length) ? `<div class="pmo-rep-sec ${cls}"><h4>${h}</h4><ul>${arr.map(x => `<li>${esc(txt(x))}</li>`).join('')}</ul></div>` : '';
    const subject = `${j.name}: status ${r.label} (${fmt(today())})`;
    const mail = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(reportText(j, d))}`;
    body = `<div class="pmo-rep" data-rep-body>
      <div class="pmo-rep-top">${ragBadge(r)}<span class="pmo-src ${ai ? 'ai' : ''}">${ai ? '✦ Generated by AI' : 'Rules-based'}</span><span class="hint">${esc(fmt(today()))} · ${ai ? 'written from project facts only; check before sending' : 'built from project facts by deterministic rules'}</span></div>
      <h3 class="pmo-rep-h">${esc(txt(d.headline) || j.name)}</h3>
      ${d.summary ? `<p class="pmo-rep-p">${esc(txt(d.summary))}</p>` : ''}
      <div class="pmo-rep-grid">${list('Highlights', d.highlights, 'hl')}${list('Risks', d.risks, 'rk')}${list('Asks', d.asks, 'ak')}</div></div>
      <div class="pmo-rep-acts"><button class="btn sm primary" data-rep-print>Print / PDF</button><a class="btn sm" data-rep-mail href="${esc(mail)}">Email draft</a><button class="btn sm" data-rep-regen>Regenerate</button></div>`;
  }
  return `<section class="card pmo-prj-rep" data-prj-rep><h3 class="pmo-h3row">Status report · ${esc(j.name)} <button class="btn sm" data-rep-close aria-label="Close the status report">Close</button></h3>${body}</section>`;
}
async function openReport(j) {
  reports[j.id] = { loading: true }; rerender();
  try { const r = await store.api('/ai/status-report', { projectId: j.id }); reports[j.id] = { data: (r && (r.report || r)) || {} }; }
  catch (e) { reports[j.id] = { error: e.message || 'service unavailable' }; }
  rerender();
  requestAnimationFrame(() => { const el = document.querySelector('[data-prj-rep]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
}

/* ---------------------------------------------------------------- "Why this date?" popover */
function explainLines(id) {
  const r = eng('explainForecast', null, docs(), id, today());
  if (Array.isArray(r) && r.length) return r.map(x => typeof x === 'string' ? x : txt(x));
  const w = store.get('workItem', id), f = forecasts()[id] || {};
  if (!w) return [];
  const out = [`Planned ${fmt(w.start)} – ${fmt(w.due)}, ${fmtEffort(effortOf(w))} effort`];
  if (f.cause) out.push(`Waits for ${store.get('dataElement', f.cause) ? dataName(f.cause) : (store.get('workItem', f.cause) || {}).title || f.cause}`);
  out.push(`Forecast ${fmt(f.forecast || w.due)}`);
  return out;
}
function closeWhy() { document.querySelectorAll('.pmo-pop').forEach(p => p.remove()); }
function openWhy(btn) {
  const id = btn.dataset.why; const w = store.get('workItem', id); if (!w) return;
  const was = document.querySelector(`.pmo-pop[data-pop="${CSS.escape(id)}"]`);
  closeWhy(); if (was) return;
  const f = forecasts()[id] || {};
  const lines = explainLines(id);
  const pop = document.createElement('div');
  pop.className = 'pmo-pop'; pop.dataset.pop = id; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Why this date?');
  pop.innerHTML = `<div class="pmo-pop-h"><b>Why ${esc(fmt(f.forecast || w.due))}?</b><button class="pmo-pop-x" data-pop-close aria-label="Close">×</button></div>
    <div class="pmo-pop-t">${esc(w.title)}</div>
    <ol class="pmo-pop-l">${lines.map(t => `<li>${esc(t)}</li>`).join('') || '<li>No forecast detail available.</li>'}</ol>`;
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect(), pw = Math.min(320, innerWidth - 16);
  pop.style.width = pw + 'px';
  pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + scrollX + 'px';
  pop.style.top = (r.bottom + 6 + scrollY) + 'px';
  pop.querySelector('[data-pop-close]').addEventListener('click', closeWhy);
  pop.querySelector('[data-pop-close]').focus();
}
let whyBound = false;
function bindWhyGlobal() {
  if (whyBound) return; whyBound = true;
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-why]');
    if (b) { e.preventDefault(); e.stopPropagation(); openWhy(b); return; }
    if (!e.target.closest('.pmo-pop')) closeWhy();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeWhy(); });
  window.addEventListener('pmo:route', closeWhy);
}

/* ---------------------------------------------------------------- render */
export function render(params) {
  const prj = params.prj;
  const j = store.get('project', prj);
  if (!j) {
    const all = store.list('project');
    return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › Project</div><h1>Project not found</h1><p>It may have been removed, or the link is from another sandbox.</p></div></section>
      <div class="card" style="margin-top:16px"><h3>Projects</h3>${all.map(p => `<div class="row click" data-go="/project/${esc(p.id)}"><div><div class="t">${esc(p.name)}</div><div class="s">Target ${esc(fmt(p.target))}</div></div><div class="r" style="color:var(--accent)">Open ›</div></div>`).join('') || '<div class="s">No projects yet.</div>'}</div>`;
  }
  const mode = ['map', 'timeline', 'board', 'sprints', 'work'].includes(params.q && params.q.mode) ? params.q.mode : 'map';
  const fc = forecasts();
  const s = projectStats(prj);
  const gi = gateInfo(j, s), fi = gi.fi;
  const r = rag(j, s);
  const isOwner = store.state.me === j.owner;
  const f = readFilters(params.q);
  const view = params.q && params.q.view;
  const all = projectItems(prj);
  const list = filterItems(all, f, fc);
  const finishKpi = gi.k === 'live'
    ? `<div class="kpi" data-kpi-finish><b style="color:var(--done)">Live since ${esc(fmt(gi.at))}${gi.v ? ` <small>(v${esc(gi.v)})</small>` : ''}</b><span>Released · <a href="${link('/release/' + encodeURIComponent(prj))}" data-link>release log ›</a></span></div>`
    : gi.k === 'awaiting'
    ? `<a class="kpi pmo-kpi-gate" data-kpi-finish href="${link('/release/' + encodeURIComponent(prj))}" data-link><b>Work done · awaiting go-live</b><span>${gi.blocking ? `<span class="fail">${gi.blocking} gate check${gi.blocking === 1 ? '' : 's'} blocking</span>` : gi.blocking === 0 ? 'Gate passes' : 'Readiness gate'} · open release ›</span></a>`
    : `<div class="kpi" data-kpi-finish><b style="color:${fi.over ? 'var(--late)' : 'inherit'}">${esc(fmt(fi.date))}</b><span>Forecast · target ${esc(fmt(j.target))}</span></div>`;
  /* tabs keep the filters (they are views of the same items); Map ignores them */
  const tab = (k, l) => `<a href="${link(k === 'map' ? prjURL(prj, 'map') : prjURL(prj, k, f, view))}" data-link data-tab="${k}" class="${mode === k ? 'on' : ''}" role="tab" aria-selected="${mode === k}">${l}</a>`;
  const hdr = `<section class="hdr"><div>
      <div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › <a href="${link('/portfolio')}" data-link>Portfolio</a> › Project</div>
      <h1>${esc(j.name)} <span class="pmo-hrag" data-rag="${r.k}">${ragBadge(r)}</span></h1>${j.desc ? `<p>${esc(j.desc)}</p>` : ''}
      <div class="res"><span class="lbl">Owner</span>${personChip(j.owner)}${(j.resources || []).filter(r => r !== j.owner).length ? '<span class="lbl" style="margin-left:6px">Team</span>' + (j.resources || []).filter(r => r !== j.owner).map(av).join('') : ''}</div></div>
    <div class="hdr-side"><div class="kpis">
      <div class="kpi"><b>${s.pct}%</b><span>${s.done}/${s.total} work done</span><div class="bar pmo-kbar"><i style="width:${s.pct}%"></i></div></div>
      <div class="kpi"><b style="color:${s.late ? 'var(--late)' : 'inherit'}">${s.late}</b><span>Late</span></div>
      <div class="kpi"><b style="color:${s.slip ? 'var(--late)' : 'inherit'}">${s.slip}</b><span>Slipping</span></div>
      ${finishKpi}</div></div></section>
    <div class="pmo-toolbar"><nav class="seg pmo-tabs" role="tablist" aria-label="Project views">${tab('map', 'Map')}${tab('timeline', 'Timeline')}${tab('board', 'Board')}${tab('sprints', 'Sprints')}${tab('work', 'Work')}</nav>
      <div class="pmo-actions"><button class="btn sm primary" data-report>Report</button><button class="btn sm" data-link-proc>Link a process</button><button class="btn sm" data-suggest title="${isOwner ? 'Propose work for new and changed steps and for data without a live source' : esc(`Anyone can preview suggestions; only ${pname(j.owner)} (project owner) can create them`)}">✦ Suggest work from diff</button><button class="btn sm" data-baseline>Save baseline</button>
      <a class="btn sm" href="${link('/release/' + encodeURIComponent(prj))}" data-link>Release ›</a><a class="btn sm" href="${link('/testing/' + encodeURIComponent(prj))}" data-link>Testing ›</a></div></div>`;
  const fbar = FILTER_MODES.includes(mode) && all.length ? filterBarHTML(j, f, mode, list.length, all.length, view) : '';
  const main = mode === 'timeline' ? `<section class="pmo-main">${fbar}${timelineHTML(j, fc, list)}</section>`
    : mode === 'work' ? `<section class="pmo-main">${fbar}${workHTML(j, fc, list)}</section>`
    : mode === 'board' ? `<section class="pmo-main pmo-wide-main">${fbar}${boardHTML(j, fc, list)}</section>`
    : mode === 'sprints' ? `<section class="pmo-main pmo-wide-main">${fbar}${sprintsHTML(j, fc, list)}</section>`
    : `<section class="canvas pm" id="canvas">${mapHTML(j)}</section>`;
  const wide = mode === 'board' || mode === 'sprints';
  return hdr + conflictHTML(j) + reportPanelHTML(j, r) + `<div class="grid pmo-grid ${wide ? 'pmo-grid-wide' : ''}">${main}<aside class="side">${sideHTML(j, fc)}</aside></div>`;
}

/* ---------------------------------------------------------------- actions */
function stepOptions(j, selPid, selStep) {
  return (j.processes || []).map(pid => {
    const p = store.get('process', pid); if (!p) return '';
    return `<optgroup label="${esc(p.name)}">${planNodes(pid).map(s => `<option value="${esc(pid)}::${esc(s.id)}" ${pid === selPid && s.id === selStep ? 'selected' : ''}>${Array.isArray(s.branches) ? '◆ ' : ''}${esc(s.title)}</option>`).join('')}</optgroup>`;
  }).join('');
}
const EFF_LBL = { live: 'live', example: 'examples only', missing: 'missing', pending: 'fix done, awaiting confirmation' };
/* R3: the "Resolves" select lists only data used by this project's processes (plus the current value, so it is never lost). */
function resolvesOptions(j, cur) {
  const ids = projectData(j);
  if (cur && !ids.includes(cur)) ids.push(cur);
  return ids.map(id => [id, store.get('dataElement', id)]).filter(x => x[1])
    .map(([id, d]) => `<option value="${esc(id)}" ${cur === id ? 'selected' : ''}>${esc(d.name)} (${EFF_LBL[effAvail(id)]})</option>`).join('');
}
const stamp = () => new Date().toISOString();
/* status -> doneAt rule: done sets today (keeps an existing actual date), anything else clears it */
function applyDone(prev, next) {
  if (next.status === 'done') next.doneAt = (prev && prev.status === 'done' && prev.doneAt) ? prev.doneAt : today();
  else delete next.doneAt;
  return next;
}
async function editWork(j, w, err) {
  const isNew = !w || !w.id;
  if (!isNew && !canEditWork(store.get('workItem', w.id) || w, j)) { toast(lockTitle(w, j)); return; }
  const prev = isNew ? null : (store.get('workItem', w.id) || w);
  w = Object.assign({ title: '', owner: store.state.me, status: 'idle', kind: 'build', start: today(), due: addDays(today(), 7), deps: [], effortDays: 1 }, w || {});
  if (!w.pid && (j.processes || []).length) { const p = store.get('process', j.processes[0]); const s0 = p && flatSteps(p.tobe)[0]; if (s0) { w.pid = p.id; w.step = s0.id; } }
  const blocked = new Set(w.id ? [w.id, ...(eng('dependents', [], docs(), w.id) || [])] : []); /* cycle guard */
  const others = projectItems(j.id).filter(x => !blocked.has(x.id));
  const stepOpts = stepOptions(j, w.pid, w.step);
  const body = `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}
    <div class="field"><label>Title</label><input name="title" value="${esc(w.title)}" maxlength="140" placeholder="e.g. Integrate screening API" /></div>
    <div class="frow"><div class="field"><label>Owner</label><select name="owner">${store.state.people.map(p => `<option value="${esc(p.id)}" ${p.id === w.owner ? 'selected' : ''}>${esc(p.name)} — ${esc(p.role)}</option>`).join('')}</select></div>
      <div class="field"><label>Kind</label><select name="kind">${Object.entries(KIND_LBL).map(([k, l]) => `<option value="${k}" ${w.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="field"><label>To-be step it delivers</label>${stepOpts ? `<select name="step">${stepOpts}</select>` : '<div class="hint">Link a process first. Work attaches to a to-be step.</div>'}</div>
    <div class="frow"><div class="field"><label>Start</label><input type="date" name="start" value="${esc(w.start || '')}" /></div><div class="field"><label>Due</label><input type="date" name="due" value="${esc(w.due || '')}" /></div></div>
    <div class="frow"><div class="field"><label>Status</label><select name="status">${['idle', 'prog', 'done'].map(s => `<option value="${s}" ${w.status === s ? 'selected' : ''}>${STATUS_LBL[s]}</option>`).join('')}</select></div>
      <div class="field"><label>Effort (person-days)</label><input type="number" name="effortDays" min="0.5" max="200" step="0.5" value="${esc(effortOf(w))}" /></div></div>
    <div class="field"><label>Resolves (makes data available)</label><select name="resolves"><option value="">— nothing —</option>${resolvesOptions(j, w.resolves)}</select><div class="hint">Only data used by this project’s processes.</div></div>
    <div class="field"><label>Depends on</label>${others.length ? `<div class="pmo-checks pmo-depl">${others.map(o => { const cur = (w.deps || []).map(depNorm).find(d => d.id === o.id); const t = cur ? cur.type : 'FS';
        return `<div class="pmo-dep"><label><input type="checkbox" name="deps" value="${esc(o.id)}" ${cur ? 'checked' : ''}/> <span>${esc(o.title)}</span> <small>${esc(fmt(o.due))}</small></label>
        <span class="pmo-dep-opt"><select name="dt_${esc(o.id)}" aria-label="Dependency type for ${esc(o.title)}">${[['FS', 'Finish → start'], ['SS', 'Start → start'], ['FF', 'Finish → finish']].map(([k, l]) => `<option value="${k}" ${t === k ? 'selected' : ''}>${k} · ${l}</option>`).join('')}</select>
        <input type="number" name="dl_${esc(o.id)}" value="${esc(cur ? cur.lag : 0)}" min="-30" max="60" step="1" aria-label="Lag in days for ${esc(o.title)}" /><small>lag days</small></span></div>`; }).join('')}</div>
      <div class="hint">FS: starts after it finishes. SS: starts after it starts. FF: finishes after it finishes. Lag adds days (negative overlaps).</div>` : '<div class="hint">No other work items to depend on.</div>'}
      ${blocked.size > 1 ? '<div class="hint">Items that already depend on this one are hidden to prevent loops.</div>' : ''}</div>`;
  const acts = [{ id: 'save', label: isNew ? 'Add work item' : 'Save changes', primary: true }];
  if (!isNew) acts.unshift({ id: 'delete', label: 'Delete', danger: true });
  const r = await modal({ title: isNew ? 'Add work item' : 'Edit work item', body, actions: acts });
  if (r.action === 'delete') return deleteWork(j, w);
  if (r.action !== 'save') return;
  const f = r.form;
  const [pid, step] = String(f.step || '').split('::');
  const eff = Number(f.effortDays);
  let badLag = false;
  const deps = (f.deps || []).map(id => {
    const type = ['FS', 'SS', 'FF'].includes(f['dt_' + id]) ? f['dt_' + id] : 'FS';
    const lag = Math.round(Number(f['dl_' + id]) || 0);
    if (lag < -30 || lag > 60) badLag = true;
    return type === 'FS' && !lag ? id : { id, type, lag };
  });
  const next = Object.assign({}, w, { title: (f.title || '').trim(), owner: f.owner, kind: f.kind, start: f.start, due: f.due, status: f.status, deps, pid: pid || w.pid, step: step || w.step, projectId: j.id, effortDays: eff });
  if (badLag) return editWork(j, next, 'Lag must be between -30 and 60 days.');
  if (f.resolves) next.resolves = f.resolves; else delete next.resolves;
  if (!next.title) return editWork(j, next, 'Give the work item a title.');
  if (!next.pid || !next.step) return editWork(j, next, 'Pick the to-be step this work delivers.');
  if (!next.start || !next.due) return editWork(j, next, 'Set both a start and a due date.');
  if (next.due < next.start) return editWork(j, next, 'The due date is before the start date.');
  if (!(eff > 0) || eff > 200) return editWork(j, Object.assign(next, { effortDays: 1 }), 'Effort must be between 0.5 and 200 person-days.');
  applyDone(prev, next);
  next.updatedAt = stamp();
  if (isNew) {
    next.id = store.newId('wi');
    await store.save('workItem', next.id, next, `Added work item “${next.title}” to step “${stepTitle(next.pid, next.step)}”`);
    toast('Work item added');
    return;
  }
  const ch = [];
  if (prev.title !== next.title) ch.push(`renamed from “${prev.title}”`);
  if (prev.status !== next.status) ch.push(`status ${STATUS_LBL[prev.status] || prev.status} → ${STATUS_LBL[next.status]}`);
  if (prev.owner !== next.owner) ch.push(`owner ${pname(prev.owner)} → ${pname(next.owner)}`);
  if (prev.start !== next.start) ch.push(`start ${fmt(prev.start)} → ${fmt(next.start)}`);
  if (prev.due !== next.due) ch.push(`due ${fmt(prev.due)} → ${fmt(next.due)}`);
  if (effortOf(prev) !== next.effortDays) ch.push(`effort ${fmtEffort(effortOf(prev))} → ${fmtEffort(next.effortDays)}`);
  if ((prev.kind || '') !== next.kind) ch.push(`kind ${KIND_LBL[next.kind] || next.kind}`);
  if (prev.pid !== next.pid || prev.step !== next.step) ch.push(`moved to step “${stepTitle(next.pid, next.step)}”`);
  if ((prev.resolves || '') !== (next.resolves || '')) ch.push(next.resolves ? `now resolves ${dataName(next.resolves)}` : 'no longer resolves data');
  const pa = new Map((prev.deps || []).map(depNorm).map(d => [d.id, d])), pb = new Map(next.deps.map(depNorm).map(d => [d.id, d]));
  const t = id => (store.get('workItem', id) || {}).title || id;
  const dl = d => { const l = depLabel(d); return l ? ` (${l})` : ''; };
  const added = [...pb.values()].filter(x => !pa.has(x.id)), removed = [...pa.values()].filter(x => !pb.has(x.id));
  const retyped = [...pb.values()].filter(x => pa.has(x.id) && (pa.get(x.id).type !== x.type || pa.get(x.id).lag !== x.lag));
  if (added.length) ch.push(`now after ${added.map(d => t(d.id) + dl(d)).join(', ')}`);
  if (removed.length) ch.push(`no longer after ${removed.map(d => t(d.id)).join(', ')}`);
  retyped.forEach(d => ch.push(`dependency on ${t(d.id)} now ${d.type}${d.lag ? (d.lag > 0 ? ' +' : ' ') + d.lag + 'd lag' : ', no lag'}`));
  if (!ch.length) { toast('No changes'); return; }
  await store.save('workItem', next.id, next, `Edited “${next.title}”: ${ch.join('; ')}`);
  toast('Work item saved');
}
async function deleteWork(j, w) {
  if (!canEditWork(w, j)) { toast(lockTitle(w, j)); return; }
  const deps = projectItems(j.id).filter(x => (x.deps || []).some(d => depId(d) === w.id));
  const r = await modal({ title: 'Delete work item?', body: `<p style="margin:0">Delete <b>${esc(w.title)}</b>? This can’t be undone.</p>${deps.length ? `<div class="note">${deps.length} item${deps.length > 1 ? 's depend' : ' depends'} on it (${deps.map(d => esc(d.title)).join(', ')}). The dependency will be removed from ${deps.length > 1 ? 'them' : 'it'}.</div>` : ''}`, actions: [{ id: 'delete', label: 'Delete', danger: true }] });
  if (r.action !== 'delete') return;
  await store.remove('workItem', w.id, `Deleted work item “${w.title}” from ${j.name}`);
  for (const d of deps) await store.save('workItem', d.id, Object.assign({}, d, { deps: (d.deps || []).filter(x => depId(x) !== w.id), updatedAt: stamp() }), `Removed dependency of “${d.title}” on deleted “${w.title}”`);
  /* drop the deleted item from any risk links */
  for (const rk of store.list('risk', x => (x.workItems || []).includes(w.id))) await store.save('risk', rk.id, Object.assign({}, rk, { workItems: rk.workItems.filter(x => x !== w.id) }), `Unlinked deleted work item “${w.title}” from risk “${rk.title}”`);
  toast('Work item deleted');
}
async function setStatus(j, id, status) {
  const w = store.get('workItem', id); if (!w || w.status === status) return;
  if (!canEditWork(w, j)) { toast(lockTitle(w, j)); rerender(); return; }
  const next = applyDone(w, Object.assign({}, w, { status, updatedAt: stamp() }));
  await store.save('workItem', id, next, `“${w.title}”: ${STATUS_LBL[w.status] || w.status} → ${STATUS_LBL[status]}${status === 'done' ? ' (finished ' + fmt(next.doneAt) + ')' : ''}`);
  toast(`Marked ${STATUS_LBL[status].toLowerCase()}`);
}
async function linkProcess(j) {
  const procs = store.list('process');
  if (!procs.length) { toast('No processes yet. Create one first.'); return; }
  const r = await modal({ title: 'Link processes', body: `<p class="hint" style="margin:0">Linked to-be processes appear on the map; their new and changed steps are what this project delivers.</p>
    <div class="pmo-checks tall">${procs.map(p => { const n = flatSteps(p.tobe).length; const items = projectItems(j.id).filter(w => w.pid === p.id).length; return `<label><input type="checkbox" name="procs" value="${esc(p.id)}" ${(j.processes || []).includes(p.id) ? 'checked' : ''}/> <span><b>${esc(p.name)}</b><br/><small>${n} to-be steps${items ? ' · ' + items + ' work items here' : ''}</small></span></label>`; }).join('')}</div>`, actions: [{ id: 'save', label: 'Save links', primary: true }] });
  if (r.action !== 'save') return;
  const next = r.form.procs || [];
  const before = j.processes || [];
  const add = next.filter(x => !before.includes(x)), rem = before.filter(x => !next.includes(x));
  if (!add.length && !rem.length) return;
  const order = [...before.filter(x => next.includes(x)), ...add];
  const parts = [];
  if (add.length) parts.push('linked ' + add.map(p => `“${procName(p)}”`).join(', '));
  if (rem.length) parts.push('unlinked ' + rem.map(p => `“${procName(p)}”`).join(', '));
  await store.save('project', j.id, Object.assign({}, j, { processes: order }), parts.join('; ').replace(/^./, c => c.toUpperCase()));
  toast('Processes updated');
}
async function saveBaseline(j) {
  const items = projectItems(j.id);
  if (!items.length) { toast('Add work items before saving a baseline'); return; }
  const n = (j.baselines || []).length + 1;
  const r = await modal({ title: 'Save baseline', body: `<p class="hint" style="margin:0">Snapshots the start and due date of all ${items.length} work items. Compare later in Timeline or Portfolio › Baseline variance.</p>
    <div class="field"><label>Label</label><input name="label" maxlength="60" value="${esc('Baseline ' + n + ' · ' + fmt(today()))}" /></div>`, actions: [{ id: 'save', label: 'Save baseline', primary: true }] });
  if (r.action !== 'save') return;
  const label = (r.form.label || '').trim() || ('Baseline ' + n);
  const snap = {}; items.forEach(w => { snap[w.id] = { start: w.start, due: w.due }; });
  const bl = { id: store.newId('bl'), at: stamp(), label, items: snap };
  blPick[j.id] = bl.id; showBaseline = true;
  await store.save('project', j.id, Object.assign({}, j, { baselines: [...(j.baselines || []), bl] }), `Saved baseline “${label}” (${items.length} work items)`);
  toast('Baseline saved');
}
/* Suggest work (R3): map order, each suggestion with owner, effort, start/due and deps, all editable before creating.
   Anyone can preview; only the project owner can create. */
function normalizeSuggestions(j, list) {
  const items = list.map((x, i) => Object.assign({}, x, { key: String(x.id != null ? x.id : (x.key != null ? x.key : i)) }));
  const byKey = new Map(items.map((x, i) => [x.key, i]));
  const engineDeps = items.some(x => Array.isArray(x.deps));
  items.forEach((x, i) => {
    if (Array.isArray(x.deps)) {
      x.deps = x.deps.map(d => {
        if (typeof d === 'number' && items[d] && d !== i) return 'S:' + d;
        const k = String(d && typeof d === 'object' ? (d.id || d.key) : d);
        if (byKey.has(k) && byKey.get(k) !== i) return 'S:' + byKey.get(k);
        const w = store.get('workItem', k);
        return w && w.projectId === j.id ? 'W:' + k : null;
      }).filter(Boolean);
      x.deps = [...new Set(x.deps)];
    } else if (!engineDeps) {
      /* R4 fallback: dependencies come from data. A step item waits for the suggested resolvers of its step's non-live data. */
      const used = nodeData(x.pid, x.step);
      x.deps = items.map((y, k) => (y.resolves && k !== i && !x.resolves && used.includes(y.resolves)) ? 'S:' + k : null).filter(Boolean);
    }
    x.gateway = Array.isArray((nodeOf(x.pid, x.step) || {}).branches);
    if (!x.owner || !store.person(x.owner)) {
      const step = stepOf(x.pid, x.step), dEl = x.resolves && store.get('dataElement', x.resolves);
      x.owner = (dEl && dEl.owner) || (step && step.owner) || j.owner || store.state.me;
    }
    x.effortDays = Number(x.effortDays) > 0 ? Number(x.effortDays) : 2;
    x.kind = KIND_LBL[x.kind] ? x.kind : 'build';
  });
  /* fallback dates in business days: start today (or the next working day after what it waits for) */
  const firstBiz = d => isWeekend(d) ? addBiz(d, 1) : d;
  const dateOf = (x, seen) => {
    if (x.start && x.due) return;
    if (seen.has(x)) { x.start = firstBiz(today()); x.due = addBiz(x.start, Math.max(1, Math.ceil(x.effortDays)) - 1); return; }
    seen.add(x);
    const after = (x.deps || []).map(d => { if (d[0] === 'S') { const y = items[Number(d.slice(2))]; dateOf(y, seen); return y.due; } return (store.get('workItem', d.slice(2)) || {}).due; }).filter(Boolean);
    x.start = after.length ? addBiz(maxDate(after), 1) : firstBiz(today());
    x.due = addBiz(x.start, Math.max(1, Math.ceil(x.effortDays)) - 1);
  };
  items.forEach(x => dateOf(x, new Set()));
  return items;
}
function suggestBody(j, items, meta, ro, err) {
  const people = store.state.people;
  const existing = projectItems(j.id).filter(w => w.status !== 'done');
  const row = (x, i) => {
    const dis = ro ? 'disabled' : '';
    const depNames = (x.deps || []).map(d => d[0] === 'S' ? (items[Number(d.slice(2))] || {}).title : (store.get('workItem', d.slice(2)) || {}).title).filter(Boolean);
    const opts = [...items.map((y, k) => k === i ? '' : `<label><input type="checkbox" name="dep_${i}" value="S:${k}" ${(x.deps || []).includes('S:' + k) ? 'checked' : ''} ${dis}/> <span>${esc(y.title)}</span> <small>suggested</small></label>`),
      ...existing.map(w => `<label><input type="checkbox" name="dep_${i}" value="W:${esc(w.id)}" ${(x.deps || []).includes('W:' + w.id) ? 'checked' : ''} ${dis}/> <span>${esc(w.title)}</span> <small>${esc(fmt(w.due))}</small></label>`)].join('');
    return `<div class="pmo-sg" data-sg="${i}">
      <div class="pmo-sg-h">${ro ? `<span class="pmo-sg-n">${i + 1}</span>` : `<input type="checkbox" name="pick" value="${i}" ${x.picked === false ? '' : 'checked'} aria-label="Create suggestion ${i + 1}"/>`}
        <div class="pmo-sg-main"><input class="pmo-sg-t" name="t_${i}" value="${esc(x.title)}" maxlength="140" aria-label="Title of suggestion ${i + 1}" ${dis}/>
        <div class="hint">${esc(procName(x.pid))} › ${x.gateway ? '<span class="pmo-gw" data-sg-gateway>◆ gateway</span> ' : ''}${esc(stepTitle(x.pid, x.step))} · ${esc(KIND_LBL[x.kind] || x.kind)}${x.resolves ? ' · resolves ' + esc(dataName(x.resolves)) + ' (' + EFF_LBL[effAvail(x.resolves)] + ')' : ''}</div></div></div>
      <div class="pmo-sg-f">
        <label>Owner<select name="o_${i}" ${dis}>${people.map(p => `<option value="${esc(p.id)}" ${p.id === x.owner ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label>Effort (days)<input type="number" name="e_${i}" min="0.5" max="200" step="0.5" value="${esc(x.effortDays)}" ${dis}/></label>
        <label>Start<input type="date" name="s_${i}" value="${esc(x.start)}" data-sg-start="${i}" ${dis}/></label>
        <label>Due<input type="date" name="d_${i}" value="${esc(x.due)}" ${dis}/></label></div>
      <details class="pmo-sg-deps"><summary>After: ${depNames.length ? esc(depNames.join(', ')) : '<span class="hint">nothing (can start now)</span>'}</summary>
        <div class="pmo-checks">${opts || '<span class="hint">No other work to depend on.</span>'}</div></details></div>`;
  };
  const ai = String(meta.source).toLowerCase() === 'ai';
  return `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pmo-src ${ai ? 'ai' : ''}">${ai ? '✦ AI' : 'Rules'}</span><span class="hint">${ai ? 'Generated by AI from the project facts. Review before adding.' : 'One item per new or changed step or gateway without work, plus a resolver for each data element without a live source. In map order.'}</span></div>
    ${meta.note ? `<div class="note">${esc(meta.note)}</div>` : ''}
    ${ro ? `<div class="banner pmo-ro-note" style="margin:0">Only <b>${esc(pname(j.owner))}</b> (project owner) can create work from suggestions. Switch “Viewing as” to ${esc(pname(j.owner).split(' ')[0])} to create them.</div>` : ''}
    <div class="pmo-sg-list">${items.map(row).join('')}</div>
    <div class="hint">Dates are in business days (weekends skipped). An item waits only for what it really needs: the resolvers of its step’s data that isn’t live yet. Change a start date and the due date moves with it.</div>`;
}
/* depth-first cycle check over the picked suggestions' S: deps */
function hasCycle(items, picked) {
  const state = {};
  const visit = i => {
    if (state[i] === 1) return true; if (state[i] === 2) return false;
    state[i] = 1;
    for (const d of items[i].deps || []) { if (d[0] !== 'S') continue; const k = Number(d.slice(2)); if (picked.has(k) && visit(k)) return true; }
    state[i] = 2; return false;
  };
  return [...picked].some(visit);
}
async function suggestWork(j, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="pmo-spin sm"></span> Thinking…'; }
  let list = [], source = 'rules', note = '';
  try {
    const r = await store.api('/ai/suggest-work', { projectId: j.id });
    list = Array.isArray(r) ? r : (r && (r.items || r.suggestions || r.work)) || [];
    source = (r && r.source) || 'rules';
  } catch (e) {
    list = eng('suggestWorkFromDiff', [], docs(), j.id) || [];
    note = 'The suggestion service is unavailable, so these come from the local diff rules.';
  }
  if (btn) { btn.disabled = false; btn.textContent = '✦ Suggest work from diff'; }
  list = list.filter(x => x && x.title);
  const ai = String(source).toLowerCase() === 'ai';
  if (!list.length) {
    await modal({ title: 'Suggested work', body: `<div><span class="pmo-src ${ai ? 'ai' : ''}">${ai ? '✦ AI' : 'Rules'}</span></div><p style="margin:0">Nothing to suggest. Every new or changed step already has work, and every data element without a live source has a resolver.</p>`, actions: [{ id: 'ok', label: 'OK', primary: true }] });
    return;
  }
  return suggestModal(j, normalizeSuggestions(j, list), { source, note });
}
async function suggestModal(j, items, meta, err) {
  const ro = store.state.me !== j.owner;
  const pending = modal({ title: 'Suggested work from the as-is → to-be diff', body: suggestBody(j, items, meta, ro, err), actions: ro ? [] : [{ id: 'create', label: 'Create selected', primary: true }] });
  const ov = [...document.querySelectorAll('.overlay')].pop();
  if (ov) {
    ov.querySelector('.modal').classList.add('pmo-wide');
    /* moving a start date keeps the item's duration */
    ov.querySelectorAll('[data-sg-start]').forEach(inp => {
      let prev = inp.value;
      inp.addEventListener('change', () => {
        const due = ov.querySelector(`[name="d_${inp.dataset.sgStart}"]`);
        if (prev && inp.value && due && due.value) due.value = addDays(due.value, dayDiff(inp.value, prev));
        prev = inp.value;
      });
    });
  }
  const r = await pending;
  if (r.action !== 'create' || ro) return;
  if (store.state.me !== j.owner) { toast(`Only ${pname(j.owner)} (project owner) can create work from suggestions`); return; }
  const f = r.form;
  const picked = new Set((f.pick || []).map(Number));
  items.forEach((x, i) => Object.assign(x, {
    picked: picked.has(i), title: String(f['t_' + i] || '').trim(), owner: f['o_' + i] || x.owner, effortDays: Number(f['e_' + i]),
    start: f['s_' + i], due: f['d_' + i], deps: f['dep_' + i] || [],
  }));
  if (!picked.size) return;
  for (const i of picked) {
    const x = items[i], n = `Suggestion ${i + 1}`;
    if (!x.title) return suggestModal(j, items, meta, `${n} needs a title.`);
    if (!x.start || !x.due) return suggestModal(j, items, meta, `${n} (“${x.title}”) needs a start and a due date.`);
    if (x.due < x.start) return suggestModal(j, items, meta, `“${x.title}” is due before it starts.`);
    if (!(x.effortDays > 0) || x.effortDays > 200) return suggestModal(j, items, meta, `“${x.title}”: effort must be between 0.5 and 200 days.`);
  }
  if (hasCycle(items, picked)) return suggestModal(j, items, meta, 'The selected items depend on each other in a loop. Untick one of the “After” links.');
  const ids = {}; picked.forEach(i => { ids[i] = store.newId('wi'); });
  let n = 0;
  for (const i of [...picked].sort((a, b) => a - b)) {
    const x = items[i];
    const deps = x.deps.map(d => d[0] === 'S' ? ids[Number(d.slice(2))] : d.slice(2)).filter(Boolean);
    const w = { id: ids[i], projectId: j.id, pid: x.pid, step: x.step, title: x.title.slice(0, 140), owner: x.owner, status: 'idle', kind: x.kind, start: x.start, due: x.due, deps, effortDays: x.effortDays, updatedAt: stamp() };
    if (x.resolves) w.resolves = x.resolves;
    await store.save('workItem', w.id, w, `Added suggested work “${w.title}” for ${pname(w.owner)}, ${fmt(w.start)} – ${fmt(w.due)}, ${fmtEffort(w.effortDays)} effort${deps.length ? ', after ' + deps.map(d => (store.get('workItem', d) || {}).title).filter(Boolean).join(', ') : ''} (${String(meta.source).toLowerCase() === 'ai' ? 'AI' : 'rules'} suggestion)`);
    n++;
  }
  toast(`Created ${n} work item${n > 1 ? 's' : ''}`);
}

/* "+ New project" (R3), used by home and portfolio. Creates the project and opens it. */
export async function newProject(prefill, err) {
  const me = store.state.me;
  const v = Object.assign({ name: '', desc: '', target: addDays(today(), 60), owner: me, resources: me ? [me] : [], processes: [] }, prefill || {});
  const procs = store.list('process');
  const body = `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}
    <div class="field"><label for="np-name">Name</label><input id="np-name" name="name" maxlength="100" value="${esc(v.name)}" placeholder="e.g. Supplier Payments Uplift" /></div>
    <div class="field"><label for="np-desc">Description</label><textarea id="np-desc" name="desc" maxlength="600" placeholder="What changes, and why it matters">${esc(v.desc)}</textarea></div>
    <div class="frow"><div class="field"><label for="np-target">Target go-live</label><input id="np-target" type="date" name="target" value="${esc(v.target)}" /></div>
      <div class="field"><label for="np-owner">Owner (project manager)</label><select id="np-owner" name="owner">${store.state.people.map(p => `<option value="${esc(p.id)}" ${p.id === v.owner ? 'selected' : ''}>${esc(p.name)}${p.id === me ? ' (me)' : ''} — ${esc(p.role)}</option>`).join('')}</select></div></div>
    <div class="field"><label>Resources</label><div class="pmo-checks pmo-np-people">${store.state.people.map(p => `<label><input type="checkbox" name="resources" value="${esc(p.id)}" ${(v.resources || []).includes(p.id) ? 'checked' : ''}/> <span>${av(p.id)} ${esc(p.name)} <small>${esc(p.role)}</small></span></label>`).join('')}</div></div>
    <div class="field"><label>Processes to link</label>${procs.length ? `<div class="pmo-checks">${procs.map(p => { const c = diffCounts(p); return `<label><input type="checkbox" name="processes" value="${esc(p.id)}" ${(v.processes || []).includes(p.id) ? 'checked' : ''}/> <span><b>${esc(p.name)}</b><br/><small>${flatSteps(p.tobe).length} to-be steps · ${c.new} new + ${c.changed} changed</small></span></label>`; }).join('')}</div>
      <div class="hint">The new and changed steps of linked processes are what the project delivers. You can link more later.</div>` : '<div class="hint">No processes yet. Create a workflow first, or link one later.</div>'}</div>`;
  const r = await modal({ title: 'New project', body, actions: [{ id: 'create', label: 'Create project', primary: true }] });
  if (r.action !== 'create') return null;
  const f = r.form;
  const next = { name: (f.name || '').trim(), desc: (f.desc || '').trim(), target: f.target, owner: f.owner || me, resources: f.resources || [], processes: f.processes || [] };
  if (!next.name) return newProject(next, 'Give the project a name.');
  if (!next.target) return newProject(next, 'Set a target go-live date.');
  if (store.list('project', p => p.name.trim().toLowerCase() === next.name.toLowerCase()).length) return newProject(next, `A project called “${next.name}” already exists.`);
  if (!next.resources.includes(next.owner)) next.resources.unshift(next.owner); /* the owner is always on the team */
  const id = store.newId('prj');
  const data = { id, name: next.name, desc: next.desc, owner: next.owner, resources: next.resources, target: next.target, processes: next.processes, status: 'active', baselines: [] };
  await store.save('project', id, data, `Created project “${data.name}” (owner ${pname(data.owner)}, target ${fmt(data.target)}, ${data.processes.length} linked process${data.processes.length === 1 ? '' : 'es'})`);
  toast('Project created');
  go('/project/' + id);
  return data;
}

/* ---------------------------------------------------------------- bind */
export function bind(root, params) {
  const j = store.get('project', params.prj);
  if (!j) return;
  const cur = () => store.get('project', j.id);
  const on = (sel, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener('click', e => { e.preventDefault(); fn(el, e); }));
  on('[data-expand]', el => { showUnchanged = el.dataset.expand === '1'; rerender(); });
  on('[data-link-proc]', () => linkProcess(cur()));
  on('[data-baseline]', () => saveBaseline(cur()));
  on('[data-suggest]', el => suggestWork(cur(), el));
  on('[data-add-work]', () => editWork(cur(), null));
  on('[data-edit-work]', el => editWork(cur(), store.get('workItem', el.dataset.editWork)));
  on('[data-del-work]', el => { const w = store.get('workItem', el.dataset.delWork); if (w) deleteWork(cur(), w); });
  on('[data-wgroup]', el => { workGroup = el.dataset.wgroup; rerender(); });
  on('tr[data-tg]', el => { const k = el.dataset.tg; folded.has(k) ? folded.delete(k) : folded.add(k); rerender(); });
  root.querySelectorAll('[data-status]').forEach(el => el.addEventListener('change', () => setStatus(cur(), el.dataset.status, el.value)));
  root.querySelectorAll('tr[data-wid]:not(.pmo-ro) td:first-child').forEach(td => {
    td.style.cursor = 'pointer';
    td.addEventListener('click', e => { if (e.target.closest('a')) return; editWork(cur(), store.get('workItem', td.parentElement.dataset.wid)); });
  });
  const tg = root.querySelector('[data-bl-toggle]'); if (tg) tg.addEventListener('change', () => { showBaseline = tg.checked; rerender(); });
  const bp = root.querySelector('[data-bl-pick]'); if (bp) bp.addEventListener('change', () => { blPick[j.id] = bp.value; rerender(); });
  const ct = root.querySelector('[data-crit-toggle]'); if (ct) ct.addEventListener('change', () => { showCrit = ct.checked; rerender(); });
  bindTimeline(root, j);
  /* R4 views + filters */
  const mode = ['map', 'timeline', 'board', 'sprints', 'work'].includes(params.q && params.q.mode) ? params.q.mode : 'map';
  bindFilters(root, j, mode, readFilters(params.q), params.q && params.q.view);
  bindWhyGlobal();
  bindCards(root, j);
  if (mode === 'board') bindDnD(root, '.pmo-col[data-col]', 'data-col', (id, st) => setStatus(cur(), id, st));
  if (mode === 'sprints') {
    bindDnD(root, '.pmo-spr[data-sprint]', 'data-sprint', (id, sp) => moveToSprint(cur(), id, sp));
    root.querySelectorAll('[data-sprint-pick]').forEach(el => el.addEventListener('change', () => { if (el.value) moveToSprint(cur(), el.dataset.sprintPick, el.value); }));
  }
  on('[data-plan-sprints]', () => planSprints(cur()));
  on('[data-report]', () => openReport(cur()));
  on('[data-rep-regen]', () => openReport(cur()));
  on('[data-rep-close]', () => { delete reports[j.id]; rerender(); });
  on('[data-rep-print]', () => window.print());
  /* the mailto link must open the mail client, not be swallowed by the router */
  root.querySelectorAll('[data-rep-mail]').forEach(a => a.addEventListener('click', e => e.stopPropagation()));
  /* timeline: start scrolled so "today" is in view on narrow screens */
  const tl = root.querySelector('#pmoTl .tday');
  if (tl) { const box = root.querySelector('#pmoTl'); const lane = tl.parentElement; requestAnimationFrame(() => { const x = lane.offsetLeft + tl.offsetLeft - box.clientWidth / 2; if (x > 0 && box.scrollWidth > box.clientWidth) box.scrollLeft = x; }); }
  bindActivity(root);
  const ids = new Set(projectItems(j.id).map(w => w.id));
  bindFeed(root, 'prj-work', e => { const [t, id] = String(e.ref || '').split(':'); return t === 'workItem' && (ids.has(id) || String(e.summary || '').includes(j.name)); });
}
