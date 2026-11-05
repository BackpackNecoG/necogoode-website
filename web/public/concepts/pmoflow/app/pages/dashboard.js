/* PMOFlow — configurable PMO dashboard (stream P). Route: /dashboard
   The user picks widgets (RAG, burndown, earned value, workload, risks, top blockers, upcoming go-lives), adds, removes and
   reorders them; the layout is saved in localStorage. Program roll-ups group projects by project.program. */
import { store } from '../store.js';
import { esc, fmt, link, av, pname, toast } from '../ui.js';
import { today, projectStats, rag, ragBadge, RAG_RULE, rerender, gateInfo, financials, money,
  earnedValue, fmtIdx, idxCls, projectItems, truthOf, summaryPill, summaryOf, launchStepsOf } from './project.js';
import { byProgram, workloadRows, burnOrNote, likelyResolved } from './portfolio.js';

const KEY = 'pmoflow.dashboard';
const ALL = 'all';
export const WIDGETS = {
  rag: { title: 'Project health', wide: true, desc: 'On track / at risk / off track for every project, with the reasons' },
  burndown: { title: 'Burndown', desc: 'Remaining effort over time against the ideal line' },
  ev: { title: 'Earned value', wide: true, desc: 'SPI, CPI and estimate at completion per project' },
  workload: { title: 'Workload', desc: 'Effort in the next 14 days against capacity' },
  risks: { title: 'Top risks', desc: 'Open risks by impact × likelihood' },
  blockers: { title: 'Top blockers', desc: 'Information that holds up the most open tasks' },
  golives: { title: 'Upcoming launches', desc: 'Active projects by deadline, with expected finish and launch checks' },
};
const DEFAULT = { widgets: ['rag', 'ev', 'golives', 'blockers', 'risks', 'workload', 'burndown'], program: ALL, burnPrj: null };

/* Layout in localStorage, guarded: storage may be unavailable or hold junk. */
export function loadLayout() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.widgets)) return Object.assign({}, DEFAULT, { widgets: DEFAULT.widgets.slice() });
  const widgets = [...new Set(raw.widgets.filter(w => WIDGETS[w]))];
  return { widgets, program: typeof raw.program === 'string' ? raw.program : ALL, burnPrj: typeof raw.burnPrj === 'string' ? raw.burnPrj : null };
}
function saveLayout(l) {
  try { localStorage.setItem(KEY, JSON.stringify(l)); return true; } catch (e) { return false; }
}
let layout = null;
const L = () => layout || (layout = loadLayout());
function update(fn, msg) { const l = L(); fn(l); if (!saveLayout(l)) toast('Layout changed for this visit (browser storage is unavailable)'); else if (msg) toast(msg); rerender(); }

/* ---------------------------------------------------------------- data helpers */
const programOf = p => String(p.program || '').trim() || 'No program';
function scope() {
  const all = store.list('project');
  const prog = L().program;
  return prog === ALL ? all : all.filter(p => programOf(p) === prog);
}
function evSum(projects) {
  const evs = projects.map(earnedValue).filter(Boolean);
  const sum = k => evs.reduce((a, e) => a + (e[k] || 0), 0);
  const pv = sum('pv'), ev = sum('ev'), ac = sum('ac'), bac = sum('bac');
  return evs.length ? { spi: pv ? ev / pv : null, cpi: ac ? ev / ac : null, eac: evs.reduce((a, e) => a + (e.eac || 0), 0) || null, bac } : null;
}

/* ---------------------------------------------------------------- program roll-up */
function rollupHTML() {
  const groups = byProgram(store.list('project'));
  if (!groups.length) return '';
  const prog = L().program;
  return `<section class="pmo-dash-roll" data-rollup aria-label="Program roll-up">${groups.map(g => {
    const rc = {}; g.projects.forEach(p => { const k = truthOf(p).k; rc[k] = (rc[k] || 0) + 1; });
    const fin = g.projects.map(financials), planned = fin.reduce((a, f) => a + (f.planned || 0), 0), fc = fin.reduce((a, f) => a + f.forecast, 0);
    const ev = evSum(g.projects);
    const next = g.projects.filter(p => p.status !== 'live' && p.target).sort((a, b) => String(a.target).localeCompare(String(b.target)))[0];
    const on = prog === g.program;
    return `<button type="button" class="pmo-roll-card ${on ? 'on' : ''}" data-program="${esc(g.program)}" aria-pressed="${on}" title="${on ? 'Show every program' : 'Show only ' + esc(g.program)}">
      <span class="pmo-roll-h"><b>${esc(g.program)}</b><span class="hint">${g.projects.length} project${g.projects.length === 1 ? '' : 's'}</span></span>
      <span class="pmo-roll-rag">${['red', 'amber', 'green', 'none', 'live'].filter(k => rc[k]).map(k => `<span class="rag rag-${k}"><i></i>${rc[k]}</span>`).join('')}</span>
      <span class="pmo-roll-n"><span>${planned ? `Budget <b>${esc(money(planned))}</b> · ` : ''}forecast <b class="${planned && fc > planned ? 'fail' : ''}">${esc(money(fc))}</b></span>
        <span>SPI <b class="${idxCls(ev && ev.spi)}">${fmtIdx(ev && ev.spi)}</b> · CPI <b class="${idxCls(ev && ev.cpi)}">${fmtIdx(ev && ev.cpi)}</b></span>
        <span>${next ? `Next deadline <b>${esc(fmt(next.target))}</b> · ${esc(next.name)}` : 'No upcoming launch'}</span></span></button>`;
  }).join('')}</section>`;
}

/* ---------------------------------------------------------------- widgets */
function ragW(projects) {
  if (!projects.length) return '<div class="empty">No projects in this program.</div>';
  return byProgram(projects).map(g => `<div class="pmo-dash-grp"><div class="pmo-dash-grp-h">${esc(g.program)}</div>${g.projects.map(p => {
    const t = truthOf(p);
    return `<a class="pmo-dash-row" href="${link('/project/' + encodeURIComponent(p.id))}" data-link data-dash-prj="${esc(p.id)}"><span class="pmo-dash-main"><b>${esc(p.name)}</b><span class="hint">${esc(t.sentence)}</span></span>${summaryPill(summaryOf(p))}</a>`;
  }).join('')}</div>`).join('') + `<div class="hint" style="margin-top:8px">${esc(RAG_RULE)}</div>`;
}
function burnW(projects) {
  const withWork = projects.filter(p => projectItems(p.id).length);
  if (!withWork.length) return '<div class="empty">No project here has work yet.</div>';
  const j = withWork.find(p => p.id === L().burnPrj) || withWork.find(p => p.status !== 'live') || withWork[0];
  return `<select class="pmo-sel" data-dash-burn aria-label="Project for the burndown">${withWork.map(p => `<option value="${esc(p.id)}" ${p.id === j.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    ${burnOrNote(j, 'dash')}`;
}
function evW(projects) {
  if (!projects.length) return '<div class="empty">No projects in this program.</div>';
  const rows = byProgram(projects).map(g => {
    const t = evSum(g.projects);
    return `<tr class="pmo-prog-h"><td colspan="6"><b>${esc(g.program)}</b> <span class="hint">SPI ${fmtIdx(t && t.spi)} · CPI ${fmtIdx(t && t.cpi)}</span></td></tr>` + g.projects.map(p => {
      const e = earnedValue(p);
      return `<tr data-dash-ev="${esc(p.id)}"><td><a href="${link('/project/' + encodeURIComponent(p.id))}" data-link>${esc(p.name)}</a></td>${e ? `<td class="pmo-num">${esc(money(e.pv))}</td><td class="pmo-num">${esc(money(e.ev))}</td><td class="pmo-num"><b class="${idxCls(e.spi)}">${fmtIdx(e.spi)}</b></td><td class="pmo-num"><b class="${idxCls(e.cpi)}">${fmtIdx(e.cpi)}</b></td><td class="pmo-num" data-t="cost">${esc(money(financials(p).forecast))}</td>` : '<td colspan="5" class="hint">No earned value yet</td>'}</tr>`;
    }).join('');
  }).join('');
  return `<div class="tbl-wrap"><table class="pmo-fin"><thead><tr><th>Project</th><th class="pmo-num">Planned value</th><th class="pmo-num">Earned value</th><th class="pmo-num">SPI</th><th class="pmo-num">CPI</th><th class="pmo-num">Forecast cost</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="hint" style="margin-top:6px">SPI and CPI below 1.00 mean behind schedule or over cost. Forecast cost is the expected total at completion; actual cost comes from logged hours × day rate ÷ 8.</div>`;
}
function workloadW(projects) {
  const ids = new Set(projects.flatMap(p => [p.owner, ...(p.resources || []), ...projectItems(p.id).map(w => w.owner)]));
  const rows = workloadRows().filter(r => ids.has(r.pid)).sort((a, b) => (b.effN / (b.capN || 1)) - (a.effN / (a.capN || 1))).slice(0, 8);
  if (!rows.length) return '<div class="empty">Nobody has planned work here.</div>';
  const max = Math.max(1, ...rows.map(r => Math.max(r.effN, r.capN)));
  const pct = n => (n / max * 100).toFixed(1);
  return `<div class="pmo-wl">${rows.map(r => `<div class="pmo-wl-row pmo-dash-wl ${r.overloaded ? 'over' : ''}" data-dash-wl="${esc(r.pid)}"><div class="pmo-wl-who">${av(r.pid)}<span>${esc(pname(r.pid))}</span></div>
    <div class="pmo-wl-bar" role="img" aria-label="${esc(pname(r.pid))}: ${Math.round(r.effN * 10) / 10} days against ${Math.round(r.capN * 10) / 10} days capacity"><i class="${r.overloaded ? 'late' : 'rest'}" style="width:${pct(r.effN)}%"></i><b class="pmo-cap" style="left:${pct(r.capN)}%"></b></div>
    <div class="pmo-wl-n"><b class="${r.overloaded ? 'fail' : ''}">${Math.round(r.effN * 10) / 10}d</b> / ${Math.round(r.capN * 10) / 10}d</div></div>`).join('')}</div><div class="hint" style="margin-top:6px">Next 14 days, across every project. <a href="${link('/portfolio')}" data-link>Edit capacity ›</a></div>`;
}
const LV = ['low', 'med', 'high'];
const score = r => (LV.indexOf(r.impact) + 1) * (LV.indexOf(r.likelihood) + 1);
function risksW(projects) {
  const ids = new Set(projects.map(p => p.id));
  const list = store.list('risk', r => r.status !== 'closed' && ids.has(r.projectId)).sort((a, b) => score(b) - score(a)).slice(0, 6);
  if (!list.length) return '<div class="empty">No open risks.</div>';
  return list.map(r => `<a class="pmo-dash-row" href="${link('/portfolio')}" data-link data-dash-risk="${esc(r.id)}"><span class="pmo-sev ${score(r) >= 6 ? 'hi' : score(r) >= 3 ? 'md' : 'lo'}">${score(r)}</span><span class="pmo-dash-main"><b>${esc(r.title)}</b><span class="hint">${esc((store.get('project', r.projectId) || {}).name || '')} · ${esc(pname(r.owner))}${likelyResolved(r) ? ' · <b>Likely resolved: close it?</b>' : ''}</span></span></a>`).join('');
}
/* The same blockers list as every project page (projectTruth), most urgent projects first. */
function blockersW(projects) {
  const list = projects.filter(p => p.status !== 'live').flatMap(p => truthOf(p).blockers.map(b => ({ p, b }))).slice(0, 6);
  if (!list.length) return '<div class="empty">Nothing is blocking any project.</div>';
  return list.map(({ p, b }) => `<a class="pmo-dash-row" href="${link(b.href)}" data-link data-dash-blocker="${esc(b.ref)}"><span class="pmo-dash-main"><b>${esc(b.text)}</b><span class="hint">${esc(p.name)}${b.who ? ` · ${esc(pname(b.who))}` : ''}${b.action ? ': ' + esc(b.action) : ''}</span></span></a>`).join('');
}
function goLivesW(projects) {
  const list = projects.filter(p => p.status !== 'live' && p.target).sort((a, b) => String(a.target).localeCompare(String(b.target))).slice(0, 6);
  if (!list.length) return '<div class="empty">No upcoming launches.</div>';
  return list.map(p => {
    const s = projectStats(p.id), gi = gateInfo(p, s), t = truthOf(p);
    const ls = launchStepsOf(p), fails = ls.length ? ls.filter(x => !x.done).length : null;
    const d = Math.round((new Date(p.target + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 86400000);
    return `<a class="pmo-dash-row" href="${link('/release/' + encodeURIComponent(p.id))}" data-link data-dash-golive="${esc(p.id)}"><span class="pmo-dash-date"><b>${esc(fmt(p.target).split(' ')[1] || '')}</b><small>${esc(fmt(p.target).split(' ')[0])}</small></span><span class="pmo-dash-main"><b>${esc(p.name)}</b><span class="hint">${d >= 0 ? `in ${d} day${d === 1 ? '' : 's'}` : `${-d} day${d === -1 ? '' : 's'} ago`} · ${esc(gi.k === 'forecast' && s.total ? 'expected ' + fmt(t.forecast) : gi.label)}${fails != null ? ` · ${fails ? `<span class="fail">${fails} launch step${fails === 1 ? '' : 's'} left</span>` : 'ready to launch'}` : ''}</span></span>${summaryPill(summaryOf(p))}</a>`;
  }).join('');
}
const RENDER = { rag: ragW, burndown: burnW, ev: evW, workload: workloadW, risks: risksW, blockers: blockersW, golives: goLivesW };

function widgetHTML(id, i, n, projects) {
  const w = WIDGETS[id];
  let body;
  try { body = RENDER[id](projects); } catch (e) { console.warn('dashboard widget ' + id, e); body = '<div class="empty">This widget could not load.</div>'; }
  return `<section class="card pmo-dash-w ${w.wide ? 'wide' : ''}" data-widget="${id}" aria-label="${esc(w.title)}">
    <header class="pmo-dash-wh"><h3>${esc(w.title)}</h3><span class="pmo-dash-tools">
      <button type="button" class="btn sm" data-w-up="${id}" aria-label="Move ${esc(w.title)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="btn sm" data-w-down="${id}" aria-label="Move ${esc(w.title)} down" ${i === n - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" class="btn sm" data-w-remove="${id}" aria-label="Remove ${esc(w.title)}">✕</button></span></header>${body}</section>`;
}

/* ---------------------------------------------------------------- page */
export function render() {
  if (!store.advanced) return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> › Dashboard</div><h1>Dashboard</h1>
      <p>The dashboard is one of the advanced tools. For a quick view of every project, open the Portfolio.</p></div></section>
    <div class="card pmo-adv-note" data-dash-simple style="margin-top:16px"><a class="btn primary" href="${link('/portfolio')}" data-link>Open the Portfolio</a><button class="btn" data-adv-on>Show advanced tools</button></div>`;
  const l = L();
  const groups = byProgram(store.list('project'));
  if (l.program !== ALL && !groups.some(g => g.program === l.program)) l.program = ALL;
  const projects = scope();
  const hidden = Object.keys(WIDGETS).filter(k => !l.widgets.includes(k));
  return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> › Dashboard</div><h1>Dashboard</h1>
      <p>Your PMO view: pick the widgets you want, put them in order, and filter by program. The layout is saved in this browser.</p></div>
    <div class="hdr-side"><div class="pmo-dash-ctl">
      <label class="pmo-toggle">Program <select class="pmo-sel" data-dash-program aria-label="Program"><option value="${ALL}" ${l.program === ALL ? 'selected' : ''}>All programs</option>${groups.map(g => `<option value="${esc(g.program)}" ${l.program === g.program ? 'selected' : ''}>${esc(g.program)}</option>`).join('')}</select></label>
      <select class="pmo-sel" data-dash-add aria-label="Add a widget" ${hidden.length ? '' : 'disabled'}><option value="">${hidden.length ? '+ Add widget…' : 'All widgets shown'}</option>${hidden.map(k => `<option value="${k}">${esc(WIDGETS[k].title)} · ${esc(WIDGETS[k].desc)}</option>`).join('')}</select>
      <button type="button" class="btn sm" data-dash-reset>Reset layout</button></div></div></section>
    ${rollupHTML()}
    ${l.widgets.length ? `<div class="pmo-dash-grid" data-dash-grid>${l.widgets.map((id, i) => widgetHTML(id, i, l.widgets.length, projects)).join('')}</div>`
      : `<div class="card" style="margin-top:16px"><div class="empty" data-dash-empty>No widgets on your dashboard. Use “+ Add widget” to pick some, or reset the layout.</div></div>`}`;
}

export function bind(root) {
  const on = (sel, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener('click', e => { e.preventDefault(); fn(el); }));
  on('[data-adv-on]', () => store.setAdvanced(true));
  const move = (id, d) => update(l => { const i = l.widgets.indexOf(id), k = i + d; if (i < 0 || k < 0 || k >= l.widgets.length) return; l.widgets.splice(i, 1); l.widgets.splice(k, 0, id); });
  on('[data-w-up]', el => move(el.dataset.wUp, -1));
  on('[data-w-down]', el => move(el.dataset.wDown, 1));
  on('[data-w-remove]', el => update(l => { l.widgets = l.widgets.filter(x => x !== el.dataset.wRemove); }, `Removed ${WIDGETS[el.dataset.wRemove].title}`));
  on('[data-dash-reset]', () => update(l => { Object.assign(l, DEFAULT, { widgets: DEFAULT.widgets.slice() }); }, 'Layout reset'));
  on('[data-program]', el => update(l => { l.program = l.program === el.dataset.program ? ALL : el.dataset.program; }));
  const add = root.querySelector('[data-dash-add]');
  if (add) add.addEventListener('change', () => { const k = add.value; if (WIDGETS[k]) update(l => { if (!l.widgets.includes(k)) l.widgets.push(k); }, `Added ${WIDGETS[k].title}`); });
  const pg = root.querySelector('[data-dash-program]');
  if (pg) pg.addEventListener('change', () => update(l => { l.program = pg.value || ALL; }));
  const bp = root.querySelector('[data-dash-burn]');
  if (bp) bp.addEventListener('change', () => update(l => { l.burnPrj = bp.value; }));
}
