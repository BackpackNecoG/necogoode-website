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
export const stepTitle = (pid, sid) => (stepOf(pid, sid) || {}).title || 'Unknown step';
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
  if (v === 'live' || v === 'example' || v === 'missing') return v;
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
export const schedHTML = (w, f) => `${wBadge(w, f)} <span class="pmo-dl">${esc(dueLine(w, f))}</span>`;

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
    const amber = eff.filter(x => x[1] === 'example').map(x => x[0]);
    body = `<div class="meta">${stBadge(st)}${gap ? '<span class="badge b-soon">No work planned</span>' : ''}${defects ? `<span class="badge b-late">${BUG} ${defects} defect${defects > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="stats">${items.length ? `<span>Work <b>${done}/${items.length}</b></span>` : ''}<span>Data <b>${live}/${dl.length}</b> live</span></div>
      ${red.length || amber.length ? `<div class="chips">${red.map(d => `<a class="chip block" href="${link('/data/' + encodeURIComponent(d))}" data-link>${LOCK} Waiting on ${esc(dataName(d))}</a>`).join('')}${amber.map(d => `<a class="chip pmo-amber" href="${link('/data/' + encodeURIComponent(d))}" data-link title="Examples only. Needs a live source before go-live." aria-label="${esc(dataName(d))}: examples only, needs a live source before go-live"><i class="pmo-adot"></i>Examples only: ${esc(dataName(d))}</a>`).join('')}</div>` : ''}`;
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
      parts.push(`<div class="decision"><div class="diamond">${par ? '⫴' : '◆'} ${esc(n.title)}${par ? ' <small style="font-weight:500">(all run)</small>' : ''}</div><div class="conn"></div>
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
function groupedItems(j) {
  const items = projectItems(j.id);
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
function timelineHTML(j, fc) {
  const groups = groupedItems(j);
  const all = groups.flatMap(g => g.items);
  if (!all.length) return `<div class="card"><div class="empty">No work items yet. Add work in the Work tab, or use “Suggest work from diff”.</div></div>`;
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
      const deps = (w.deps || []).map(d => (store.get('workItem', d) || {}).title).filter(Boolean);
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
    const deps = (cur.deps || []).map(d => store.get('workItem', d)).filter(x => x && x.projectId === j.id && x.status !== 'done' && !path.includes(x.id));
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
    (w.deps || []).forEach(d => {
      const from = bars[d]; if (!from) return;
      const a = pt(from, 'end'), b = pt(bars[id], 'start');
      const crit = from.classList.contains('pmo-crit') && bars[id].classList.contains('pmo-crit');
      const dx = Math.max(14, Math.min(40, Math.abs(b.x - a.x) / 2));
      paths += `<path class="${crit ? 'crit' : ''}" data-from="${esc(d)}" data-to="${esc(id)}" d="M${a.x.toFixed(1)},${a.y.toFixed(1)} C${(a.x + dx).toFixed(1)},${a.y.toFixed(1)} ${(b.x - dx).toFixed(1)},${b.y.toFixed(1)} ${(b.x - 1).toFixed(1)},${b.y.toFixed(1)}" marker-end="url(#pmoArr${crit ? 'C' : ''})"/>`;
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
  const deps = (w.deps || []).map(d => store.get('workItem', d)).filter(Boolean);
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
    <td class="pmo-c-sched">${wBadge(w, fc[w.id])}<div class="pmo-dl">${esc(dueLine(w, fc[w.id]))}</div></td>
    <td class="pmo-deps pmo-c-deps">${deps.length ? '<span class="pmo-c-lbl">After </span>' + deps.map(d => `<span class="dep">${esc(d.title)}${d.status === 'done' ? ' ✓' : ''}</span>`).join('') : '<span class="hint">—</span>'}</td>
    <td class="pmo-nowrap"><button class="btn sm" data-edit-work="${esc(w.id)}" ${lt}>Edit</button> <button class="btn sm danger" data-del-work="${esc(w.id)}" aria-label="Delete ${esc(w.title)}" ${lt}>Delete</button></td></tr>`;
}
function rollup(items) {
  const done = items.filter(w => w.status === 'done').length;
  const effort = items.reduce((a, w) => a + effortOf(w), 0);
  const pct = items.length ? Math.round(done / items.length * 100) : 0;
  return `<span class="pmo-roll"><span class="bar"><i style="width:${pct}%"></i></span><b>${done}/${items.length}</b> done · ${fmtEffort(effort)} effort</span>`;
}
function workHTML(j, fc) {
  const items = projectItems(j.id).slice().sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const isPM = store.state.me === j.owner;
  const head = `<div class="pmo-tlbar"><div class="seg" role="tablist" aria-label="Group work"><button data-wgroup="flat" class="${workGroup === 'flat' ? 'on' : ''}">Flat list</button><button data-wgroup="step" class="${workGroup === 'step' ? 'on' : ''}">By process › step</button></div>
    <span class="hint">${items.length} item${items.length === 1 ? '' : 's'} · ${isPM ? 'you’re the project owner, so you can update any item' : `you can update your own items; ${esc(pname(j.owner))} (project owner) can update all`}</span><button class="btn primary sm" data-add-work>+ Add work item</button></div>`;
  if (!items.length) return head + `<div class="card"><div class="empty">No work items yet.</div></div>`;
  let body;
  if (workGroup === 'step') {
    body = groupedItems(j).map(g => {
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
    ${amber.length ? `<div class="card pmo-amber-card" data-needs-live><h3><i class="pmo-adot"></i> Needs a live source before go-live <span class="n">${amber.length}</span></h3><div class="hint" style="margin:-4px 0 8px">Not holding work today, but the release gate requires live data.</div>${amber.map(({ d, e, r }) => `<div class="row click" data-go="/data/${esc(d)}"><span class="pmo-amber-dot" aria-hidden="true"></span><div><div class="t">${esc(dataName(d))} <span class="badge ${e === 'example' ? 'b-soon' : 'b-late'}">${e === 'example' ? 'Examples only' : 'Missing'}</span></div>${fixLine(r)}</div></div>`).join('')}</div>` : ''}
    <div class="card"><h3>Up next <span class="n">${open.length}</span></h3><div class="hint" style="margin:-4px 0 8px">Ranked by how much downstream work each one unblocks</div>${ranked.slice(0, 5).map(({ w, n }) => `<div class="row click" data-go="/process/${esc(w.pid)}/step/${esc(w.step)}">${av(w.owner)}<div><div class="t">${esc(w.title)}</div><div class="s">${n ? `<b style="color:var(--ink)">Unblocks ${n}</b> · ` : ''}${esc(stepTitle(w.pid, w.step))}</div><div class="s pmo-schedrow">${schedHTML(w, fc[w.id])}</div></div></div>`).join('') || '<div class="s">All work is done.</div>'}</div>
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

/* ---------------------------------------------------------------- render */
export function render(params) {
  const prj = params.prj;
  const j = store.get('project', prj);
  if (!j) {
    const all = store.list('project');
    return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › Project</div><h1>Project not found</h1><p>It may have been removed, or the link is from another sandbox.</p></div></section>
      <div class="card" style="margin-top:16px"><h3>Projects</h3>${all.map(p => `<div class="row click" data-go="/project/${esc(p.id)}"><div><div class="t">${esc(p.name)}</div><div class="s">Target ${esc(fmt(p.target))}</div></div><div class="r" style="color:var(--accent)">Open ›</div></div>`).join('') || '<div class="s">No projects yet.</div>'}</div>`;
  }
  const mode = ['map', 'timeline', 'work'].includes(params.q && params.q.mode) ? params.q.mode : 'map';
  const fc = forecasts();
  const s = projectStats(prj);
  const gi = gateInfo(j, s), fi = gi.fi;
  const isOwner = store.state.me === j.owner;
  const finishKpi = gi.k === 'live'
    ? `<div class="kpi" data-kpi-finish><b style="color:var(--done)">Live since ${esc(fmt(gi.at))}${gi.v ? ` <small>(v${esc(gi.v)})</small>` : ''}</b><span>Released · <a href="${link('/release/' + encodeURIComponent(prj))}" data-link>release log ›</a></span></div>`
    : gi.k === 'awaiting'
    ? `<a class="kpi pmo-kpi-gate" data-kpi-finish href="${link('/release/' + encodeURIComponent(prj))}" data-link><b>Work done · awaiting go-live</b><span>${gi.blocking ? `<span class="fail">${gi.blocking} gate check${gi.blocking === 1 ? '' : 's'} blocking</span>` : gi.blocking === 0 ? 'Gate passes' : 'Readiness gate'} · open release ›</span></a>`
    : `<div class="kpi" data-kpi-finish><b style="color:${fi.over ? 'var(--late)' : 'inherit'}">${esc(fmt(fi.date))}</b><span>Forecast · target ${esc(fmt(j.target))}</span></div>`;
  const tab = (k, l) => `<a href="${link('/project/' + encodeURIComponent(prj) + '?mode=' + k)}" data-link class="${mode === k ? 'on' : ''}" role="tab" aria-selected="${mode === k}">${l}</a>`;
  const hdr = `<section class="hdr"><div>
      <div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › <a href="${link('/portfolio')}" data-link>Portfolio</a> › Project</div>
      <h1>${esc(j.name)} ${j.status === 'live' ? '<span class="badge b-done" style="vertical-align:3px">Live</span>' : ''}</h1>${j.desc ? `<p>${esc(j.desc)}</p>` : ''}
      <div class="res"><span class="lbl">Owner</span>${personChip(j.owner)}${(j.resources || []).filter(r => r !== j.owner).length ? '<span class="lbl" style="margin-left:6px">Team</span>' + (j.resources || []).filter(r => r !== j.owner).map(av).join('') : ''}</div></div>
    <div class="hdr-side"><div class="kpis">
      <div class="kpi"><b>${s.pct}%</b><span>${s.done}/${s.total} work done</span><div class="bar pmo-kbar"><i style="width:${s.pct}%"></i></div></div>
      <div class="kpi"><b style="color:${s.late ? 'var(--late)' : 'inherit'}">${s.late}</b><span>Late</span></div>
      <div class="kpi"><b style="color:${s.slip ? 'var(--late)' : 'inherit'}">${s.slip}</b><span>Slipping</span></div>
      ${finishKpi}</div></div></section>
    <div class="pmo-toolbar"><nav class="seg pmo-tabs" role="tablist">${tab('map', 'Map')}${tab('timeline', 'Timeline')}${tab('work', 'Work')}</nav>
      <div class="pmo-actions"><button class="btn sm" data-link-proc>Link a process</button><button class="btn sm" data-suggest title="${isOwner ? 'Propose work for new and changed steps and for data without a live source' : esc(`Anyone can preview suggestions; only ${pname(j.owner)} (project owner) can create them`)}">✦ Suggest work from diff</button><button class="btn sm" data-baseline>Save baseline</button>
      <a class="btn sm" href="${link('/release/' + encodeURIComponent(prj))}" data-link>Release ›</a><a class="btn sm" href="${link('/testing/' + encodeURIComponent(prj))}" data-link>Testing ›</a></div></div>`;
  const main = mode === 'timeline' ? `<section class="pmo-main">${timelineHTML(j, fc)}</section>`
    : mode === 'work' ? `<section class="pmo-main">${workHTML(j, fc)}</section>`
    : `<section class="canvas pm" id="canvas">${mapHTML(j)}</section>`;
  return hdr + `<div class="grid pmo-grid">${main}<aside class="side">${sideHTML(j, fc)}</aside></div>`;
}

/* ---------------------------------------------------------------- actions */
function stepOptions(j, selPid, selStep) {
  return (j.processes || []).map(pid => {
    const p = store.get('process', pid); if (!p) return '';
    return `<optgroup label="${esc(p.name)}">${flatSteps(p.tobe).map(s => `<option value="${esc(pid)}::${esc(s.id)}" ${pid === selPid && s.id === selStep ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</optgroup>`;
  }).join('');
}
const EFF_LBL = { live: 'live', example: 'examples only', missing: 'missing' };
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
    <div class="field"><label>Depends on (must finish first)</label>${others.length ? `<div class="pmo-checks">${others.map(o => `<label><input type="checkbox" name="deps" value="${esc(o.id)}" ${(w.deps || []).includes(o.id) ? 'checked' : ''}/> <span>${esc(o.title)}</span> <small>${esc(fmt(o.due))}</small></label>`).join('')}</div>` : '<div class="hint">No other work items to depend on.</div>'}
      ${blocked.size > 1 ? '<div class="hint">Items that already depend on this one are hidden to prevent loops.</div>' : ''}</div>`;
  const acts = [{ id: 'save', label: isNew ? 'Add work item' : 'Save changes', primary: true }];
  if (!isNew) acts.unshift({ id: 'delete', label: 'Delete', danger: true });
  const r = await modal({ title: isNew ? 'Add work item' : 'Edit work item', body, actions: acts });
  if (r.action === 'delete') return deleteWork(j, w);
  if (r.action !== 'save') return;
  const f = r.form;
  const [pid, step] = String(f.step || '').split('::');
  const eff = Number(f.effortDays);
  const next = Object.assign({}, w, { title: (f.title || '').trim(), owner: f.owner, kind: f.kind, start: f.start, due: f.due, status: f.status, deps: f.deps || [], pid: pid || w.pid, step: step || w.step, projectId: j.id, effortDays: eff });
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
  const a = new Set(prev.deps || []), b = new Set(next.deps);
  const added = [...b].filter(x => !a.has(x)), removed = [...a].filter(x => !b.has(x));
  const t = id => (store.get('workItem', id) || {}).title || id;
  if (added.length) ch.push(`now after ${added.map(t).join(', ')}`);
  if (removed.length) ch.push(`no longer after ${removed.map(t).join(', ')}`);
  if (!ch.length) { toast('No changes'); return; }
  await store.save('workItem', next.id, next, `Edited “${next.title}”: ${ch.join('; ')}`);
  toast('Work item saved');
}
async function deleteWork(j, w) {
  if (!canEditWork(w, j)) { toast(lockTitle(w, j)); return; }
  const deps = projectItems(j.id).filter(x => (x.deps || []).includes(w.id));
  const r = await modal({ title: 'Delete work item?', body: `<p style="margin:0">Delete <b>${esc(w.title)}</b>? This can’t be undone.</p>${deps.length ? `<div class="note">${deps.length} item${deps.length > 1 ? 's depend' : ' depends'} on it (${deps.map(d => esc(d.title)).join(', ')}). The dependency will be removed from ${deps.length > 1 ? 'them' : 'it'}.</div>` : ''}`, actions: [{ id: 'delete', label: 'Delete', danger: true }] });
  if (r.action !== 'delete') return;
  await store.remove('workItem', w.id, `Deleted work item “${w.title}” from ${j.name}`);
  for (const d of deps) await store.save('workItem', d.id, Object.assign({}, d, { deps: (d.deps || []).filter(x => x !== w.id), updatedAt: stamp() }), `Removed dependency of “${d.title}” on deleted “${w.title}”`);
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
      /* the engine chains dates after the previous suggestion; make that an explicit dependency so forecasts propagate */
      const prev = items[i - 1];
      if (prev && x.start && prev.due && x.start >= prev.due && !x.deps.includes('S:' + (i - 1))) x.deps.unshift('S:' + (i - 1));
    } else if (!engineDeps) {
      /* fallback chain: after the previous suggestion and after any suggested resolver of this step's data */
      const step = stepOf(x.pid, x.step);
      const res = items.map((y, k) => (y.resolves && k !== i && step && (step.data || []).includes(y.resolves)) ? 'S:' + k : null).filter(Boolean);
      x.deps = [...new Set([...(i > 0 ? ['S:' + (i - 1)] : []), ...res])].filter(d => Number(d.slice(2)) !== i);
    }
    if (!x.owner || !store.person(x.owner)) {
      const step = stepOf(x.pid, x.step), dEl = x.resolves && store.get('dataElement', x.resolves);
      x.owner = (dEl && dEl.owner) || (step && step.owner) || j.owner || store.state.me;
    }
    x.effortDays = Number(x.effortDays) > 0 ? Number(x.effortDays) : 2;
    x.kind = KIND_LBL[x.kind] ? x.kind : 'build';
  });
  /* fallback dates, chained in list order after deps */
  items.forEach(x => {
    if (x.start && x.due) return;
    const after = (x.deps || []).map(d => d[0] === 'S' ? items[Number(d.slice(2))].due : (store.get('workItem', d.slice(2)) || {}).due).filter(Boolean);
    x.start = after.length ? addDays(maxDate(after), 1) : today();
    x.due = addDays(x.start, Math.max(1, Math.ceil(x.effortDays)) - 1);
  });
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
        <div class="hint">${esc(procName(x.pid))} › ${esc(stepTitle(x.pid, x.step))} · ${esc(KIND_LBL[x.kind] || x.kind)}${x.resolves ? ' · resolves ' + esc(dataName(x.resolves)) + ' (' + EFF_LBL[effAvail(x.resolves)] + ')' : ''}</div></div></div>
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
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pmo-src ${ai ? 'ai' : ''}">${ai ? '✦ AI' : 'Rules'}</span><span class="hint">${ai ? 'Generated by AI from the project facts. Review before adding.' : 'One item per new or changed step without work, plus a resolver for each data element without a live source. In map order.'}</span></div>
    ${meta.note ? `<div class="note">${esc(meta.note)}</div>` : ''}
    ${ro ? `<div class="banner pmo-ro-note" style="margin:0">Only <b>${esc(pname(j.owner))}</b> (project owner) can create work from suggestions. Switch “Viewing as” to ${esc(pname(j.owner).split(' ')[0])} to create them.</div>` : ''}
    <div class="pmo-sg-list">${items.map(row).join('')}</div>
    <div class="hint">Dates are chained in map order: each item starts after the items it depends on. Change a start date and the due date moves with it.</div>`;
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
  /* timeline: start scrolled so "today" is in view on narrow screens */
  const tl = root.querySelector('#pmoTl .tday');
  if (tl) { const box = root.querySelector('#pmoTl'); const lane = tl.parentElement; requestAnimationFrame(() => { const x = lane.offsetLeft + tl.offsetLeft - box.clientWidth / 2; if (x > 0 && box.scrollWidth > box.clientWidth) box.scrollLeft = x; }); }
  bindActivity(root);
  const ids = new Set(projectItems(j.id).map(w => w.id));
  bindFeed(root, 'prj-work', e => { const [t, id] = String(e.ref || '').split(':'); return t === 'workItem' && (ids.has(id) || String(e.summary || '').includes(j.name)); });
}
