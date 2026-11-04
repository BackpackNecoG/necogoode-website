/* PMOFlow — project page (stream P).
   /project/:prj?mode=map|timeline|work
   Also exports small PMO helpers reused by home.js and portfolio.js. */
import { store } from '../store.js';
import { E, esc, fmt, fmtTime, days, addDays, link, av, personChip, pname, modal, toast, LOCK, activityCard, bindActivity } from '../ui.js';

/* ---------------------------------------------------------------- shared helpers */
export const STATUS_LBL = { done: 'Done', prog: 'In progress', idle: 'Not started', none: 'No change' };
export const KIND_LBL = { build: 'Build', access: 'Access', test: 'Test', other: 'Other' };
export const rerender = () => window.dispatchEvent(new Event('pmo:route'));
const iso = d => d.toISOString().slice(0, 10);
const maxDate = arr => arr.filter(Boolean).sort().slice(-1)[0] || null;
const minDate = arr => arr.filter(Boolean).sort()[0] || null;
const dayDiff = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);

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
export function projectStats(prj) {
  const s = eng('projectStats', null, docs(), prj, today());
  if (s) return s;
  const items = projectItems(prj), done = items.filter(w => w.status === 'done').length;
  return { total: items.length, done, pct: items.length ? Math.round(done / items.length * 100) : 0, late: 0, slip: 0, blocked: 0, finish: maxDate(items.map(w => w.due)), target: (store.get('project', prj) || {}).target, onTrack: true };
}

/* Red/amber/green. Stated rule (also shown in the UI):
   Red   = any late work item, or forecast finish after target.
   Amber = any slipping work item, or forecast finish within 7 days of target.
   Green = otherwise. Live projects show "Live". */
export const RAG_RULE = 'Red: any late item, or forecast after target. Amber: any slipping item, or less than 7 days of buffer. Green: otherwise.';
export function rag(p, s) {
  if (p.status === 'live') return { k: 'live', label: 'Live' };
  const buffer = (s.finish && p.target) ? dayDiff(p.target, s.finish) : null;
  if (s.late > 0 || (buffer != null && buffer < 0)) return { k: 'red', label: 'Red' };
  if (s.slip > 0 || (buffer != null && buffer < 7)) return { k: 'amber', label: 'Amber' };
  return { k: 'green', label: 'Green' };
}
export const ragBadge = r => `<span class="rag rag-${r.k}" title="${esc(RAG_RULE)}"><i></i>${esc(r.label)}</span>`;

export function wBadge(w, f) {
  f = f || {};
  if (w.status === 'done') return `<span class="badge b-done">Done</span>`;
  const sched = f.sched || 'ok', fc = f.forecast || w.due, n = days(w.due);
  if (sched === 'late') return `<span class="badge b-late">${Math.max(1, -n)}d late${fc > w.due ? ' · now ' + fmt(fc) : ''}</span>`;
  if (sched === 'slip') return `<span class="badge b-slip">Slipping → ${fmt(fc)}</span>`;
  if (sched === 'soon') return `<span class="badge b-soon">${n <= 0 ? 'Due today' : 'Due in ' + n + 'd'}</span>`;
  return `<span class="badge b-ok">Due ${fmt(w.due)}</span>`;
}
function stBadge(st) {
  if (!st || st.status === 'none') return `<span class="badge b-none">No work</span>`;
  if (st.status === 'done') return `<span class="badge b-done">Done</span>`;
  const sch = st.sched === 'late' ? `<span class="badge b-late">Late${st.forecast && st.due && st.forecast > st.due ? ' · now ' + fmt(st.forecast) : ''}</span>`
    : st.sched === 'slip' ? `<span class="badge b-slip">Slipping → ${fmt(st.forecast)}</span>`
    : st.sched === 'soon' ? `<span class="badge b-soon">Next due ${st.next ? fmt(st.next) : 'soon'}</span>`
    : `<span class="badge b-ok">Due ${fmt(st.due)}</span>`;
  return `<span class="badge b-${st.status}">${STATUS_LBL[st.status] || st.status}</span>${sch}`;
}

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
const blPick = {}; /* prj -> baseline id for timeline overlay */

/* ---------------------------------------------------------------- map */
function nodeHTML(n, pid, prj, idx, dp, ctx) {
  if (n.type === 'end') return `<div class="node end">● ${esc(n.title)}</div>`;
  const trig = n.type === 'trigger';
  const st = trig ? null : eng('stepState', null, docs(), prj, pid, n.id, today());
  const kind = dp && dp.nodes ? dp.nodes[n.id] : null;
  const dl = n.data || [];
  const live = dl.filter(d => (store.get('dataElement', d) || {}).avail === 'live').length;
  const cls = ['node', trig ? 'trigger' : '', st ? 's-' + st.status : '', st && st.status !== 'none' && st.status !== 'done' ? 'sch-' + st.sched : ''].join(' ');
  const diff = (kind === 'new' || kind === 'changed') ? `<span class="chip diff-${kind}">${kind === 'new' ? 'NEW' : 'CHANGED'}</span>` : '';
  let body;
  if (trig) body = `<div class="stats">${(n.touches || []).map(t => `<span class="chip touch"># ${esc(t)}</span>`).join('')}</div>`;
  else {
    const items = (st && st.items) || [];
    const done = items.filter(w => w.status === 'done').length;
    const gap = (kind === 'new' || kind === 'changed') && !items.length;
    body = `<div class="meta">${stBadge(st)}${gap ? '<span class="badge b-soon">No work planned</span>' : ''}</div>
      <div class="stats">${items.length ? `<span>Work <b>${done}/${items.length}</b></span>` : ''}<span>Data <b>${live}/${dl.length}</b> live</span></div>
      ${st && st.blockers && st.blockers.length ? `<div class="chips">${st.blockers.map(d => `<a class="chip block" href="${link('/data/' + encodeURIComponent(d))}" data-link>${LOCK} Waiting on ${esc(dataName(d))}</a>`).join('')}</div>` : ''}`;
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
    const isStep = n.type !== 'trigger' && n.type !== 'end' && n.type !== 'decision';
    const same = !dp || !dp.nodes || !dp.nodes[n.id] || dp.nodes[n.id] === 'same';
    const collapsible = !showUnchanged && isStep && same && !store.list('workItem', w => w.projectId === prj && w.pid === pid && w.step === n.id).length;
    if (collapsible) { counter.n++; run.push(n); return; }
    flush();
    if (n.type === 'decision') {
      const br = n.branches || [];
      parts.push(`<div class="decision"><div class="diamond">◆ ${esc(n.title)}</div><div class="conn"></div>
        <div class="branches" style="--bl:${100 / (Math.max(1, br.length) * 2)}%;--br:${100 / (Math.max(1, br.length) * 2)}%">${br.map(b => `<div class="branch"><span class="blabel">${esc(b.label)}</span>
          ${(b.nodes || []).length ? `<div class="flow">${flowHTML(b.nodes, pid, prj, dp, counter)}</div>` : '<div class="passthru">Continue → next step</div>'}</div>`).join('')}</div></div>`);
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
function orderedItems(j) {
  const items = projectItems(j.id);
  const groups = [];
  const seen = new Set();
  (j.processes || []).forEach(pid => {
    const p = store.get('process', pid); if (!p) return;
    const order = flatSteps(p.tobe).map(s => s.id);
    const list = items.filter(w => w.pid === pid).sort((a, b) => (order.indexOf(a.step) - order.indexOf(b.step)) || String(a.start).localeCompare(String(b.start)));
    list.forEach(w => seen.add(w.id));
    if (list.length) groups.push({ name: p.name, items: list });
  });
  const rest = items.filter(w => !seen.has(w.id)).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  if (rest.length) groups.push({ name: 'Other work (process not linked)', items: rest });
  return groups;
}
function timelineHTML(j, fc) {
  const groups = orderedItems(j);
  const all = groups.flatMap(g => g.items);
  if (!all.length) return `<div class="card"><div class="empty">No work items yet. Add work in the Work tab, or use “Suggest work from diff”.</div></div>`;
  const bls = j.baselines || [];
  const bl = bls.find(b => b.id === blPick[j.id]) || bls[bls.length - 1] || null;
  const blItems = (showBaseline && bl && bl.items) || {};
  const start = addDays(minDate([...all.map(w => w.start), today()]), -2);
  const end = addDays(maxDate([...all.map(w => (fc[w.id] || {}).forecast || w.due), ...all.map(w => w.due), j.target, today(), ...Object.values(blItems).map(x => x && x.due)]), 4);
  const span = Math.max(1, dayDiff(end, start));
  const pos = s => (dayDiff(s, start) / span * 100);
  const ticks = []; for (let d = start; d <= end; d = addDays(d, 7)) ticks.push(d);
  const marks = `<span class="tday" style="left:${pos(today())}%"></span>${j.target ? `<span class="tgt" style="left:${pos(j.target)}%"></span>` : ''}`;
  let rows = `<tr class="thead"><td class="lab"><span class="hint">${all.length} work items</span></td><td class="lane">${ticks.map(t => `<span class="tick" style="left:${pos(t)}%">${fmt(t)}</span>`).join('')}${marks}</td></tr>`;
  groups.forEach(g => {
    rows += `<tr class="grp"><td class="lab">${esc(g.name)}</td><td class="lane"></td></tr>`;
    g.items.forEach(w => {
      const f = fc[w.id] || {}, fcast = f.forecast || w.due;
      const s0 = w.start || w.due, l = pos(s0), wd = Math.max(1.5, pos(w.due) - l);
      const b = blItems[w.id];
      const deps = (w.deps || []).map(d => (store.get('workItem', d) || {}).title).filter(Boolean);
      rows += `<tr class="click" data-go="/process/${esc(w.pid)}/step/${esc(w.step)}"><td class="lab"><div class="t" title="${esc(w.title)}">${esc(w.title)}</div><div class="s">${esc(stepTitle(w.pid, w.step))} · ${esc(pname(w.owner))}${deps.length ? ' · after ' + esc(deps.join(', ')) : ''}</div></td>
        <td class="lane">${marks}
        ${b && b.due ? `<span class="pmo-blbar" style="left:${pos(b.start || b.due)}%;width:${Math.max(0.6, pos(b.due) - pos(b.start || b.due))}%"></span><span class="pmo-blmark" style="left:${pos(b.due)}%" title="Baseline due ${esc(fmt(b.due))}"></span>` : ''}
        <span class="tbar ${esc(w.status)}" style="left:${l}%;width:${wd}%" title="${esc(fmt(s0))} → ${esc(fmt(w.due))}${w.resolves ? ' · unblocks ' + esc(dataName(w.resolves)) : ''}">${wd < 7 ? '' : w.resolves && wd >= 14 ? 'unblocks ' + esc(dataName(w.resolves)) : esc(fmt(s0)) + ' – ' + esc(fmt(w.due))}</span>
        ${w.status !== 'done' && fcast > w.due ? `<span class="tslip" style="left:${pos(w.due)}%;width:${pos(fcast) - pos(w.due)}%" title="Forecast ${esc(fmt(fcast))}"></span>` : ''}</td></tr>`;
    });
  });
  const blCtl = bls.length ? `<div class="pmo-tlbar"><label class="pmo-toggle"><input type="checkbox" data-bl-toggle ${showBaseline ? 'checked' : ''}/> Show baseline</label>
      <select class="pmo-sel" data-bl-pick aria-label="Baseline" ${showBaseline ? '' : 'disabled'}>${bls.map(x => `<option value="${esc(x.id)}" ${bl && x.id === bl.id ? 'selected' : ''}>${esc(x.label || 'Baseline')} · ${esc(fmt(x.at))}</option>`).join('')}</select></div>`
    : `<div class="pmo-tlbar"><span class="hint">No baseline saved yet. “Save baseline” snapshots today’s plan so you can see drift here.</span></div>`;
  return `${blCtl}<div class="tl" id="pmoTl"><table>${rows}</table></div>
   <div class="legend" style="margin-top:12px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
    <div><span class="sw" style="background:var(--done)"></span>Done</div><div><span class="sw" style="background:var(--prog)"></span>In progress</div><div><span class="sw" style="background:#94a3b8"></span>Not started</div>
    <div><span class="sw" style="background:repeating-linear-gradient(45deg,#fecaca,#fecaca 4px,#fee2e2 4px,#fee2e2 8px)"></span>Forecast slip</div>
    <div><span class="sw" style="border:0;border-left:2px solid var(--accent);border-radius:0"></span>Today</div><div><span class="sw" style="border:0;border-left:2px dashed #16a34a;border-radius:0"></span>Target</div>
    ${bls.length ? '<div><span class="pmo-blmark static"></span>Baseline due</div>' : ''}</div>`;
}

/* ---------------------------------------------------------------- work table */
function workHTML(j, fc) {
  const items = projectItems(j.id).slice().sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const head = `<div class="pmo-tlbar"><span class="hint">${items.length} work item${items.length === 1 ? '' : 's'} · change status inline, or open a row to edit dates, dependencies and what it resolves</span><button class="btn primary sm" data-add-work>+ Add work item</button></div>`;
  if (!items.length) return head + `<div class="card"><div class="empty">No work items yet.</div></div>`;
  return head + `<div class="card pmo-flush"><div class="tbl-wrap"><table class="pmo-work">
    <thead><tr><th>Work item</th><th>Step</th><th>Owner</th><th>Status</th><th>Dates</th><th>Forecast</th><th>After</th><th></th></tr></thead><tbody>
    ${items.map(w => {
      const deps = (w.deps || []).map(d => store.get('workItem', d)).filter(Boolean);
      return `<tr data-wid="${esc(w.id)}">
        <td><b class="pmo-wt">${esc(w.title)}</b><div class="pmo-wsub">${w.kind ? `<span class="chip">${esc(KIND_LBL[w.kind] || w.kind)}</span>` : ''}${w.resolves ? `<span class="chip">${LOCK} resolves ${esc(dataName(w.resolves))}</span>` : ''}</div></td>
        <td class="pmo-c-step"><div class="pmo-wstep">${esc(stepTitle(w.pid, w.step))}</div><div class="hint">${esc(procName(w.pid))}</div></td>
        <td class="pmo-nowrap pmo-c-owner">${av(w.owner)} ${esc(pname(w.owner).split(' ')[0])}</td>
        <td><select class="pmo-sel st-${esc(w.status)}" data-status="${esc(w.id)}" aria-label="Status of ${esc(w.title)}">${['idle', 'prog', 'done'].map(s => `<option value="${s}" ${w.status === s ? 'selected' : ''}>${STATUS_LBL[s]}</option>`).join('')}</select></td>
        <td class="pmo-nowrap">${esc(fmt(w.start))} → ${esc(fmt(w.due))}</td>
        <td>${wBadge(w, fc[w.id])}</td>
        <td class="pmo-deps pmo-c-deps">${deps.length ? '<span class="pmo-c-lbl">After </span>' + deps.map(d => `<span class="dep">${esc(d.title)}${d.status === 'done' ? ' ✓' : ''}</span>`).join('') : '<span class="hint">—</span>'}</td>
        <td class="pmo-nowrap"><button class="btn sm" data-edit-work="${esc(w.id)}">Edit</button> <button class="btn sm danger" data-del-work="${esc(w.id)}" aria-label="Delete ${esc(w.title)}">Delete</button></td></tr>`;
    }).join('')}</tbody></table></div></div>`;
}

/* ---------------------------------------------------------------- side panel */
function sideHTML(j, fc) {
  const items = projectItems(j.id);
  const open = items.filter(w => w.status !== 'done');
  /* Biggest blockers: every missing data element holding a step in a linked process */
  const held = {};
  (j.processes || []).forEach(pid => {
    const p = store.get('process', pid); if (!p) return;
    flatSteps(p.tobe).forEach(s => {
      const st = eng('stepState', null, docs(), j.id, pid, s.id, today());
      ((st && st.blockers) || []).forEach(d => { (held[d] = held[d] || []).push({ pid, s }); });
    });
  });
  const blockers = Object.entries(held).map(([d, steps]) => {
    const r = store.list('workItem', w => w.resolves === d).sort((a, b) => (a.projectId === j.id ? -1 : 0) - (b.projectId === j.id ? -1 : 0))[0];
    return { d, steps, r };
  }).sort((a, b) => b.steps.length - a.steps.length);
  const ranked = open.map(w => ({ w, n: (eng('dependents', [], docs(), w.id) || []).length })).sort((a, b) => b.n - a.n || String(a.w.due).localeCompare(String(b.w.due)));
  const dueSorted = open.slice().sort((a, b) => String(a.due).localeCompare(String(b.due)));
  return `
    <div class="card"><h3>${LOCK} Biggest blockers <span class="n">${blockers.length}</span></h3>${blockers.map(({ d, steps, r }) => `<div class="row click" data-go="/data/${esc(d)}"><span style="color:var(--late);margin-top:2px">${LOCK}</span><div><div class="t">${esc(dataName(d))}</div>
      <div class="s">${r ? `Fix: ${esc(r.title)} · ${esc(pname(r.owner))} · forecast ${esc(fmt((fc[r.id] || {}).forecast || r.due))} ${wBadge(r, fc[r.id])}` : '<span style="color:var(--late);font-weight:600">No resolution plan. Add a work item that resolves it.</span>'}</div></div><div class="r"><b style="color:var(--late)">${steps.length}</b><div class="s">step${steps.length === 1 ? '' : 's'} held</div></div></div>`).join('') || '<div class="s">No data blockers. Every step’s data is live or has a finished resolver.</div>'}</div>
    <div class="card"><h3>Up next <span class="n">${open.length}</span></h3><div class="hint" style="margin:-4px 0 8px">Ranked by how much downstream work each one unblocks</div>${ranked.slice(0, 5).map(({ w, n }) => `<div class="row click" data-go="/process/${esc(w.pid)}/step/${esc(w.step)}">${av(w.owner)}<div><div class="t">${esc(w.title)}</div><div class="s">${n ? `<b style="color:var(--ink)">Unblocks ${n}</b> · ` : ''}${esc(stepTitle(w.pid, w.step))}</div></div><div class="r">${wBadge(w, fc[w.id])}</div></div>`).join('') || '<div class="s">All work is done.</div>'}</div>
    <div class="card"><h3>Due dates</h3>${dueSorted.slice(0, 8).map(w => `<div class="row click" data-go="/process/${esc(w.pid)}/step/${esc(w.step)}"><div style="width:44px;text-align:center;flex:none"><b>${esc(fmt(w.due).split(' ')[1] || '')}</b><div class="s">${esc(fmt(w.due).split(' ')[0])}</div></div><div><div class="t">${esc(w.title)}</div><div class="s">${esc(pname(w.owner))}</div></div><div class="r">${wBadge(w, fc[w.id])}</div></div>`).join('') || '<div class="s">Nothing open.</div>'}${dueSorted.length > 8 ? `<div class="hint" style="margin-top:6px">+${dueSorted.length - 8} more in the Work tab</div>` : ''}</div>
    <div class="card"><h3>How to read the map</h3><div class="legend">
      <div><span class="sw" style="background:var(--done-fill);border-color:#bbf7d0"></span>Done</div>
      <div><span class="sw" style="background:var(--prog-fill);border-left:4px solid var(--prog)"></span>In progress</div>
      <div><span class="sw" style="background:var(--idle-fill)"></span>Not started</div>
      <div><span class="sw" style="border:2px solid var(--soon)"></span>Due within 5 days</div>
      <div><span class="sw" style="border:2px solid var(--late)"></span>Late or slipping</div>
      <div><span class="chip block" style="padding:1px 6px">${LOCK}</span> Waiting on data</div>
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
  const late = s.finish && j.target && s.finish > j.target;
  const tab = (k, l) => `<a href="${link('/project/' + encodeURIComponent(prj) + '?mode=' + k)}" data-link class="${mode === k ? 'on' : ''}" role="tab" aria-selected="${mode === k}">${l}</a>`;
  const hdr = `<section class="hdr"><div>
      <div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › <a href="${link('/portfolio')}" data-link>Portfolio</a> › Project</div>
      <h1>${esc(j.name)} ${j.status === 'live' ? '<span class="badge b-done" style="vertical-align:3px">Live</span>' : ''}</h1>${j.desc ? `<p>${esc(j.desc)}</p>` : ''}
      <div class="res"><span class="lbl">Owner</span>${personChip(j.owner)}${(j.resources || []).filter(r => r !== j.owner).length ? '<span class="lbl" style="margin-left:6px">Team</span>' + (j.resources || []).filter(r => r !== j.owner).map(av).join('') : ''}</div></div>
    <div class="hdr-side"><div class="kpis">
      <div class="kpi"><b>${s.pct}%</b><span>${s.done}/${s.total} work done</span><div class="bar pmo-kbar"><i style="width:${s.pct}%"></i></div></div>
      <div class="kpi"><b style="color:${s.late ? 'var(--late)' : 'inherit'}">${s.late}</b><span>Late</span></div>
      <div class="kpi"><b style="color:${s.slip ? 'var(--late)' : 'inherit'}">${s.slip}</b><span>Slipping</span></div>
      <div class="kpi"><b style="color:${late ? 'var(--late)' : 'inherit'}">${esc(fmt(s.finish))}</b><span>Forecast · target ${esc(fmt(j.target))}</span></div></div></div></section>
    <div class="pmo-toolbar"><nav class="seg pmo-tabs" role="tablist">${tab('map', 'Map')}${tab('timeline', 'Timeline')}${tab('work', 'Work')}</nav>
      <div class="pmo-actions"><button class="btn sm" data-link-proc>Link a process</button><button class="btn sm" data-suggest>✦ Suggest work from diff</button><button class="btn sm" data-baseline>Save baseline</button>
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
async function editWork(j, w, err) {
  const isNew = !w || !w.id;
  w = Object.assign({ title: '', owner: store.state.me, status: 'idle', kind: 'build', start: today(), due: addDays(today(), 7), deps: [] }, w || {});
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
      <div class="field"><label>Resolves (makes data available)</label><select name="resolves"><option value="">— nothing —</option>${store.list('dataElement').map(d => `<option value="${esc(d.id)}" ${w.resolves === d.id ? 'selected' : ''}>${esc(d.name)}${d.avail === 'missing' ? ' (missing)' : ''}</option>`).join('')}</select></div></div>
    <div class="field"><label>Depends on (must finish first)</label>${others.length ? `<div class="pmo-checks">${others.map(o => `<label><input type="checkbox" name="deps" value="${esc(o.id)}" ${(w.deps || []).includes(o.id) ? 'checked' : ''}/> <span>${esc(o.title)}</span> <small>${esc(fmt(o.due))}</small></label>`).join('')}</div>` : '<div class="hint">No other work items to depend on.</div>'}
      ${blocked.size > 1 ? '<div class="hint">Items that already depend on this one are hidden to prevent loops.</div>' : ''}</div>`;
  const acts = [{ id: 'save', label: isNew ? 'Add work item' : 'Save changes', primary: true }];
  if (!isNew) acts.unshift({ id: 'delete', label: 'Delete', danger: true });
  const r = await modal({ title: isNew ? 'Add work item' : 'Edit work item', body, actions: acts });
  if (r.action === 'delete') return deleteWork(j, w);
  if (r.action !== 'save') return;
  const f = r.form;
  const [pid, step] = String(f.step || '').split('::');
  const next = Object.assign({}, w, { title: (f.title || '').trim(), owner: f.owner, kind: f.kind, start: f.start, due: f.due, status: f.status, deps: f.deps || [], pid: pid || w.pid, step: step || w.step, projectId: j.id });
  if (f.resolves) next.resolves = f.resolves; else delete next.resolves;
  if (!next.title) return editWork(j, next, 'Give the work item a title.');
  if (!next.pid || !next.step) return editWork(j, next, 'Pick the to-be step this work delivers.');
  if (!next.start || !next.due) return editWork(j, next, 'Set both a start and a due date.');
  if (next.due < next.start) return editWork(j, next, 'The due date is before the start date.');
  next.updatedAt = new Date().toISOString();
  if (isNew) {
    next.id = store.newId('wi');
    await store.save('workItem', next.id, next, `Added work item “${next.title}” to step “${stepTitle(next.pid, next.step)}”`);
    toast('Work item added');
    return;
  }
  const ch = [];
  if (w.title !== next.title) ch.push(`renamed from “${w.title}”`);
  if (w.status !== next.status) ch.push(`status ${STATUS_LBL[w.status] || w.status} → ${STATUS_LBL[next.status]}`);
  if (w.owner !== next.owner) ch.push(`owner ${pname(w.owner)} → ${pname(next.owner)}`);
  if (w.start !== next.start) ch.push(`start ${fmt(w.start)} → ${fmt(next.start)}`);
  if (w.due !== next.due) ch.push(`due ${fmt(w.due)} → ${fmt(next.due)}`);
  if (w.kind !== next.kind) ch.push(`kind ${KIND_LBL[next.kind] || next.kind}`);
  if (w.pid !== next.pid || w.step !== next.step) ch.push(`moved to step “${stepTitle(next.pid, next.step)}”`);
  if ((w.resolves || '') !== (next.resolves || '')) ch.push(next.resolves ? `now resolves ${dataName(next.resolves)}` : 'no longer resolves data');
  const a = new Set(w.deps || []), b = new Set(next.deps);
  const added = [...b].filter(x => !a.has(x)), removed = [...a].filter(x => !b.has(x));
  const t = id => (store.get('workItem', id) || {}).title || id;
  if (added.length) ch.push(`now after ${added.map(t).join(', ')}`);
  if (removed.length) ch.push(`no longer after ${removed.map(t).join(', ')}`);
  if (!ch.length) { toast('No changes'); return; }
  await store.save('workItem', next.id, next, `Edited “${next.title}”: ${ch.join('; ')}`);
  toast('Work item saved');
}
async function deleteWork(j, w) {
  const deps = projectItems(j.id).filter(x => (x.deps || []).includes(w.id));
  const r = await modal({ title: 'Delete work item?', body: `<p style="margin:0">Delete <b>${esc(w.title)}</b>? This can’t be undone.</p>${deps.length ? `<div class="note">${deps.length} item${deps.length > 1 ? 's depend' : ' depends'} on it (${deps.map(d => esc(d.title)).join(', ')}). The dependency will be removed from ${deps.length > 1 ? 'them' : 'it'}.</div>` : ''}`, actions: [{ id: 'delete', label: 'Delete', danger: true }] });
  if (r.action !== 'delete') return;
  await store.remove('workItem', w.id, `Deleted work item “${w.title}” from ${j.name}`);
  for (const d of deps) await store.save('workItem', d.id, Object.assign({}, d, { deps: (d.deps || []).filter(x => x !== w.id), updatedAt: new Date().toISOString() }), `Removed dependency of “${d.title}” on deleted “${w.title}”`);
  toast('Work item deleted');
}
async function setStatus(j, id, status) {
  const w = store.get('workItem', id); if (!w || w.status === status) return;
  await store.save('workItem', id, Object.assign({}, w, { status, updatedAt: new Date().toISOString() }), `“${w.title}”: ${STATUS_LBL[w.status] || w.status} → ${STATUS_LBL[status]}`);
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
  const bl = { id: store.newId('bl'), at: new Date().toISOString(), label, items: snap };
  blPick[j.id] = bl.id; showBaseline = true;
  await store.save('project', j.id, Object.assign({}, j, { baselines: [...(j.baselines || []), bl] }), `Saved baseline “${label}” (${items.length} work items)`);
  toast('Baseline saved');
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
  const srcBadge = `<span class="pmo-src ${ai ? 'ai' : ''}">${ai ? '✦ AI' : 'Rules'}</span>`;
  if (!list.length) {
    await modal({ title: 'Suggested work', body: `<div>${srcBadge}</div><p style="margin:0">Nothing to suggest. Every new or changed step already has work, and every missing data element has a resolver.</p>`, actions: [{ id: 'ok', label: 'OK', primary: true }] });
    return;
  }
  const r = await modal({ title: 'Suggested work from the as-is → to-be diff', body: `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${srcBadge}<span class="hint">${ai ? 'Generated by AI from the project facts. Review before adding.' : 'One item per new or changed step without work, plus a resolver for each missing data element.'}</span></div>
    ${note ? `<div class="note">${esc(note)}</div>` : ''}
    <div class="pmo-checks tall">${list.map((x, i) => `<label class="pmo-sugg"><input type="checkbox" name="pick" value="${i}" checked/> <span><b>${esc(x.title)}</b><br/><small>${esc(procName(x.pid))} › ${esc(stepTitle(x.pid, x.step))}${x.kind ? ' · ' + esc(KIND_LBL[x.kind] || x.kind) : ''}${x.resolves ? ' · resolves ' + esc(dataName(x.resolves)) : ''}</small></span></label>`).join('')}</div>
    <div class="hint">Resolvers start today. Work on a step that needs that data is scheduled after its resolver and depends on it.</div>`, actions: [{ id: 'create', label: 'Create selected', primary: true }] });
  if (r.action !== 'create') return;
  const picks = (r.form.pick || []).map(Number).map(i => list[i]).filter(Boolean);
  if (!picks.length) return;
  const DUR = { build: 7, access: 5, test: 4, other: 5 };
  const created = [];
  const sorted = picks.slice().sort((a, b) => (b.resolves ? 1 : 0) - (a.resolves ? 1 : 0));
  for (const x of sorted) {
    const step = stepOf(x.pid, x.step);
    const kind = KIND_LBL[x.kind] ? x.kind : 'build';
    const deps = created.filter(c => c.resolves && step && (step.data || []).includes(c.resolves));
    const start = deps.length ? addDays(maxDate(deps.map(d => d.due)), 1) : today();
    const id = store.newId('wi');
    const w = { id, projectId: j.id, pid: x.pid, step: x.step, title: String(x.title).slice(0, 140), owner: (step && step.owner) || j.owner || store.state.me, status: 'idle', kind, start, due: addDays(start, DUR[kind] || 5), deps: deps.map(d => d.id), updatedAt: new Date().toISOString() };
    if (x.resolves) w.resolves = x.resolves;
    created.push(w);
    await store.save('workItem', id, w, `Added suggested work “${w.title}” (${ai ? 'AI' : 'rules'} suggestion)`);
  }
  toast(`Created ${created.length} work item${created.length > 1 ? 's' : ''}`);
}

/* ---------------------------------------------------------------- bind */
export function bind(root, params) {
  const j = store.get('project', params.prj);
  if (!j) return;
  const on = (sel, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener('click', e => { e.preventDefault(); fn(el, e); }));
  on('[data-expand]', el => { showUnchanged = el.dataset.expand === '1'; rerender(); });
  on('[data-link-proc]', () => linkProcess(store.get('project', j.id)));
  on('[data-baseline]', () => saveBaseline(store.get('project', j.id)));
  on('[data-suggest]', el => suggestWork(store.get('project', j.id), el));
  on('[data-add-work]', () => editWork(store.get('project', j.id), null));
  on('[data-edit-work]', el => editWork(store.get('project', j.id), store.get('workItem', el.dataset.editWork)));
  on('[data-del-work]', el => { const w = store.get('workItem', el.dataset.delWork); if (w) deleteWork(store.get('project', j.id), w); });
  root.querySelectorAll('[data-status]').forEach(el => el.addEventListener('change', () => setStatus(j, el.dataset.status, el.value)));
  root.querySelectorAll('tr[data-wid] td:first-child').forEach(td => { td.style.cursor = 'pointer'; td.addEventListener('click', () => editWork(store.get('project', j.id), store.get('workItem', td.parentElement.dataset.wid))); });
  const tg = root.querySelector('[data-bl-toggle]'); if (tg) tg.addEventListener('change', () => { showBaseline = tg.checked; rerender(); });
  const bp = root.querySelector('[data-bl-pick]'); if (bp) bp.addEventListener('change', () => { blPick[j.id] = bp.value; rerender(); });
  /* timeline: start scrolled so "today" is in view on narrow screens */
  const tl = root.querySelector('#pmoTl .tday');
  if (tl) { const box = root.querySelector('#pmoTl'); const lane = tl.parentElement; requestAnimationFrame(() => { const x = lane.offsetLeft + tl.offsetLeft - box.clientWidth / 2; if (x > 0 && box.scrollWidth > box.clientWidth) box.scrollLeft = x; }); }
  bindActivity(root);
  const ids = new Set(projectItems(j.id).map(w => w.id));
  bindFeed(root, 'prj-work', e => { const [t, id] = String(e.ref || '').split(':'); return t === 'workItem' && (ids.has(id) || String(e.summary || '').includes(j.name)); });
}
