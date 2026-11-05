/* PMOFlow — project page (stream P).
   /project/:prj?mode=map|timeline|work
   Also exports small PMO helpers reused by home.js and portfolio.js. */
import { store } from '../store.js';
import { E, esc, fmt, fmtTime, days, addDays, link, go, av, personChip, pname, modal, toast, LOCK, activityCard, bindActivity, commentsPanel, historyPanel } from '../ui.js';

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

/* Permissions: the item's owner or the project manager (owner) may change it. */
export const canEditWork = (w, j) => !!w && !!j && (store.state.me === w.owner || store.state.me === j.owner);
export const lockTitle = (w, j) => `Only ${pname(w.owner)} or ${pname(j && j.owner)} can update this`;

/* Red/amber/green. R6: one health truth, the engine's projectHealth(docs, prj, today) -> {rag, reasons[]}.
   Red only when the finish date is at risk; every pill carries its reasons; zero work is grey "Not planned". */
export const RAG_RULE = 'Red: the forecast finish is after the target, or missing data has no plan. Amber: an item is late but the finish still meets the target, or less than 5 business days of buffer. Green: otherwise. Grey: no work planned yet.';
const RAG_LBL = { red: 'Red', amber: 'Amber', green: 'Green', none: 'Not planned', live: 'Live' };
const nItems = (n, w) => `${n} ${w} item${n === 1 ? '' : 's'}`;
const reasonText = x => typeof x === 'string' ? x : (x && (x.text || x.label || x.detail)) || '';
export function rag(p, s) {
  if (p.status === 'live') return { k: 'live', label: 'Live', reason: 'released', reasons: ['released'] };
  s = s || projectStats(p.id);
  if (!s.total) return { k: 'none', label: 'Not planned', reason: 'no work items yet', reasons: ['no work items yet'] };
  const h = eng('projectHealth', null, docs(), p.id, today());
  if (h && (h.rag || h.status)) {
    const raw = String(h.rag || h.status).toLowerCase();
    const k = ({ red: 'red', amber: 'amber', green: 'green', r: 'red', a: 'amber', g: 'green', grey: 'none', gray: 'none', none: 'none', live: 'live' })[raw] || 'none';
    const reasons = (Array.isArray(h.reasons) ? h.reasons : []).map(reasonText).filter(Boolean);
    return { k, label: RAG_LBL[k], reason: reasons.join('; '), reasons };
  }
  /* local fallback: the same R6 rule */
  const fi = finishInfo(p, s);
  const buffer = (fi.date && p.target) ? dayDiff(p.target, fi.date) : null;
  const bizBuf = (fi.date && p.target) ? (fi.date <= p.target ? bizDays(addDays(fi.date, 1), p.target) : -1) : null;
  const red = [];
  if (buffer != null && buffer < 0) red.push(`forecast finish ${-buffer}d after target`);
  if (red.length) return { k: 'red', label: 'Red', reason: red.join('; '), reasons: red };
  const amber = [];
  if (s.late > 0) amber.push(`${nItems(s.late, 'late')}, finish still meets target`);
  if (!fi.done && bizBuf != null && bizBuf < 5) amber.push(`only ${bizBuf} business day${bizBuf === 1 ? '' : 's'} of buffer`);
  if (amber.length) return { k: 'amber', label: 'Amber', reason: amber.join('; '), reasons: amber };
  const g = fi.done ? 'all work done' : buffer != null ? `${buffer}d buffer, nothing late` : 'nothing late';
  return { k: 'green', label: 'Green', reason: g, reasons: [g] };
}
export const ragBadge = r => `<span class="rag rag-${r.k}" data-rag-k="${r.k}" title="${esc(r.label + ': ' + (r.reason || '') + '. ' + RAG_RULE)}"><i></i>${esc(r.label)}${r.reason ? `<small class="pmo-rag-why" data-rag-reason> · ${esc(r.reason)}</small>` : ''}</span>`;

/* ---------------------------------------------------------------- R6: custom statuses, custom fields, time, EV, exports */
export const DEFAULT_STATUSES = [{ id: 'idle', name: 'Not started', maps: 'idle' }, { id: 'prog', name: 'In progress', maps: 'prog' }, { id: 'review', name: 'In review', maps: 'prog' }, { id: 'done', name: 'Done', maps: 'done' }];
const MAPS = ['idle', 'prog', 'done'];
/* project.statuses: ordered [{id, name, maps: idle|prog|done}]; the engine only sees maps (stored as workItem.status). */
export function statusesOf(j) {
  const s = j && Array.isArray(j.statuses) ? j.statuses.filter(x => x && x.id && x.name && MAPS.includes(x.maps)) : [];
  return s.length ? s : DEFAULT_STATUSES;
}
/* An item's custom status: workItem.statusId when it still exists and agrees with status, else the first status with the same mapping. */
export function statusOf(w, j) {
  const ss = statusesOf(j);
  const hit = w.statusId && ss.find(x => x.id === w.statusId && x.maps === w.status);
  return hit || ss.find(x => x.maps === w.status) || { id: w.status, name: STATUS_LBL[w.status] || w.status, maps: w.status };
}
export const statusName = (w, j) => statusOf(w, j).name;
/* project.fields: [{key, label, type: text|number|select, options}]; values in workItem.custom[key]. */
export function fieldsOf(j) { return (j && Array.isArray(j.fields) ? j.fields : []).filter(f => f && f.key && f.label); }
export const fieldVal = (w, f) => { const v = w && w.custom ? w.custom[f.key] : undefined; return v == null ? '' : String(v); };
/* Time logged on a work item: [{by, date, hours, note}]. */
export const hoursOf = w => (Array.isArray(w && w.time) ? w.time : []).reduce((a, t) => a + (Number(t.hours) || 0), 0);
const fmtHours = n => (Math.round(n * 10) / 10) + 'h';
/* R6 earned value: E().earnedValue(docs, prj, today) -> PV, EV, AC, SPI, CPI, EAC (keys normalised to lower case). */
export function earnedValue(j) {
  const raw = j ? eng('earnedValue', null, docs(), j.id, today()) : null;
  if (!raw || typeof raw !== 'object') return null;
  const pick = k => { const hit = Object.keys(raw).find(x => x.toLowerCase() === k); const v = hit != null ? Number(raw[hit]) : NaN; return isFinite(v) ? v : null; };
  const out = { pv: pick('pv'), ev: pick('ev'), ac: pick('ac'), spi: pick('spi'), cpi: pick('cpi'), eac: pick('eac'), bac: pick('bac') };
  return Object.values(out).some(v => v != null) ? out : null;
}
const r2 = v => v == null ? '—' : (Math.round(v * 100) / 100).toFixed(2);
export const idxCls = v => v == null ? '' : v >= 1 ? 'pass' : v >= 0.9 ? 'warn' : 'fail';
export function evChips(ev) {
  if (!ev) return '<span class="hint">No earned value yet</span>';
  return `<span class="pmo-ev" data-ev-spi title="Schedule performance index: earned value ÷ planned value. Below 1 means behind schedule."><small>SPI</small><b class="${idxCls(ev.spi)}">${r2(ev.spi)}</b></span><span class="pmo-ev" data-ev-cpi title="Cost performance index: earned value ÷ actual cost. Below 1 means over cost."><small>CPI</small><b class="${idxCls(ev.cpi)}">${r2(ev.cpi)}</b></span><span class="pmo-ev" data-ev-eac title="Estimate at completion: budget ÷ CPI"><small>EAC</small><b>${esc(money(ev.eac))}</b></span>`;
}
export const fmtIdx = r2;
/* R6 default target: the next business day on or after today + 60 calendar days (engine defaultTarget). */
export function defaultTarget() {
  const t = eng('defaultTarget', null, today());
  if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  let d = addDays(today(), 60); while (isWeekend(d)) d = addDays(d, 1); return d;
}
/* CSV export: RFC 4180 quoting, Blob download. Leading = + - @ are prefixed so spreadsheets don't run them as formulas. */
const csvCell = v => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
export const slug = s => String(s || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'export';
export function downloadCSV(name, rows) {
  const blob = new Blob(['﻿' + toCSV(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rows.length - 1;
}

/* R5 roles: the project manager (owner) edits the plan; the release manager (defaults to the PM) goes live. */
export const relMgr = j => (j && (j.releaseManager || j.owner)) || null;
export const isPM = j => !!j && store.state.me === j.owner;
export const pmOnly = (j, what) => `Only ${pname(j && j.owner)} (project manager) can ${what}`;
/* Saves that the server may refuse (R5: 403 for non-PM plan changes). The store has already reloaded server truth;
   say what happened and mark the error handled so it never surfaces as an unhandled rejection. */
const denied = e => e && e.status === 403 ? `Not saved: ${e.message && !/^HTTP/.test(e.message) ? e.message : 'you don’t have permission to change this'}` : `Not saved: ${(e && e.message) || 'the server refused the change'}`;
export async function psave(type, id, data, summary) {
  try { return await store.save(type, id, data, summary); }
  catch (e) { toast(denied(e)); if (e && typeof e === 'object') e.pmoHandled = true; throw e; }
}
export async function premove(type, id, summary) {
  try { return await store.remove(type, id, summary); }
  catch (e) { toast(denied(e)); if (e && typeof e === 'object') e.pmoHandled = true; throw e; }
}
if (typeof window !== 'undefined' && !window.__pmoHandledRej) {
  window.__pmoHandledRej = true;
  window.addEventListener('unhandledrejection', e => { if (e.reason && e.reason.pmoHandled) e.preventDefault(); });
}

/* R5: an open item whose forecast pushes back downstream work. Engine flag first (forecastAll causesSlip), then a local rule. */
export function causesSlip(w, fc) {
  if (!w || w.status === 'done') return false;
  const f = (fc || {})[w.id] || {};
  if (typeof f.causesSlip === 'boolean') return f.causesSlip;
  if (typeof w.causesSlip === 'boolean') return w.causesSlip;
  return Object.entries(fc || {}).some(([id, x]) => id !== w.id && x && x.slipDays > 0 && (x.sched === 'slip' || x.sched === 'late') && (x.cause === w.id || (w.resolves && x.cause === w.resolves)));
}
export const SLIP_BADGE = '<span class="badge b-late pmo-causes" data-causes-slip title="Its forecast pushes back work that depends on it">Causing slip</span>';
export const slipBadge = (w, fc) => causesSlip(w, fc) ? SLIP_BADGE : '';
/* R5 planning conflicts: [{workId, dep, type, detail}] where a successor's planned dates break its dependency. */
export function schedConflicts(prj, d) {
  const r = eng('scheduleConflicts', [], d || docs(), prj);
  return Array.isArray(r) ? r.filter(x => x && x.workId) : [];
}
/* People: R5 cost = effortDays × dayRate (default 800). */
export const DEFAULT_RATE = 800;
export const rateOf = pid => { const p = store.person(pid) || {}; return Number(p.dayRate) > 0 ? Number(p.dayRate) : DEFAULT_RATE; };
export const money = n => (n == null || !isFinite(n)) ? '—' : '$' + Math.round(n).toLocaleString('en-US');
/* Fictional mailbox for a person: first.last@northwind.example */
export function emailOf(pid) {
  const p = store.person(pid); if (!p) return null;
  const parts = String(p.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s'-]/g, '').replace(/['-]/g, '').split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return (parts.length > 1 ? parts[0] + '.' + parts[parts.length - 1] : parts[0]) + '@northwind.example';
}

/* One schedule format everywhere: short status badge + "Due Nov 3 · forecast Nov 11 (+8d)". */
export function slipOf(w, f) {
  f = f || {};
  const end = w.status === 'done' ? (w.doneAt || w.due) : (f.forecast || w.due);
  return end && w.due && end > w.due ? dayDiff(end, w.due) : 0;
}
/* R6: exactly one schedule badge per item, by priority late > causing slip > slipping > due soon > on track.
   Engine scheduleBadge first; a local rule with the same priority otherwise. Returns {k, label}. */
const BADGE = { done: ['b-done', 'Done'], late: ['b-late', 'Late'], causing: ['b-late pmo-causes', 'Causing slip'], slip: ['b-slip', 'Slipping'], soon: ['b-soon', 'Due soon'], ok: ['b-ok', 'On track'] };
const BADGE_ALIAS = { late: 'late', causing: 'causing', causingslip: 'causing', 'causing-slip': 'causing', causesslip: 'causing', slip: 'slip', slipping: 'slip', soon: 'soon', duesoon: 'soon', 'due-soon': 'soon', ok: 'ok', ontrack: 'ok', 'on-track': 'ok', done: 'done' };
const badgeCache = new WeakMap(); /* forecast map -> {workId: key}, so each item asks the engine once per render */
export const fcDocs = new WeakMap(); /* forecast map -> the docs it was computed from (a what-if scenario's copy) */
export function schedKey(w, fc) {
  if (!w) return 'ok';
  if (w.status === 'done') return 'done';
  const memo = fc && typeof fc === 'object' ? (badgeCache.get(fc) || (badgeCache.set(fc, {}), badgeCache.get(fc))) : null;
  if (memo && memo[w.id]) return memo[w.id];
  const f = (fc || {})[w.id];
  let k = null;
  const fn = E() && E().scheduleBadge;
  const D = (fc && fcDocs.get(fc)) || docs();
  if (fn && w.id && (D.workItem || []).some(x => x.id === w.id)) {
    try { const r = fn(D, w.id, today()); const raw = r && typeof r === 'object' ? (r.key || r.k || r.label) : r; k = raw ? BADGE_ALIAS[String(raw).toLowerCase().replace(/\s+/g, '')] || null : null; } catch (e) { k = null; }
  }
  if (!k) {
    const sched = (f || {}).sched || 'ok';
    k = sched === 'late' ? 'late' : causesSlip(w, fc) ? 'causing' : sched === 'slip' ? 'slip' : sched === 'soon' ? 'soon' : 'ok';
  }
  if (memo) memo[w.id] = k;
  return k;
}
export function wBadge(w, f, fc) {
  fc = fc || renderFc || (f && w ? { [w.id]: f } : {});
  const k = schedKey(w, fc);
  const [cls, label] = BADGE[k] || BADGE.ok;
  return `<span class="badge ${cls}" data-sched="${k}"${k === 'causing' ? ' data-causes-slip title="Its forecast pushes back work that depends on it"' : ''}>${label}</span>`;
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

/* Step badge: work status plus ONE schedule badge (late > causing slip > slipping > due soon > on track).
   R6: a step whose work is done but whose data isn't effectively live is "Built · awaiting live data" (amber), never green Done. */
function stBadge(st, causing, awaitingData) {
  if (!st || st.status === 'none') return `<span class="badge b-none">No work</span>`;
  if (st.status === 'done') return awaitingData ? `<span class="badge b-soon" data-built-awaiting>Built · awaiting live data</span>` : `<span class="badge b-done">Done</span>`;
  const sch = st.sched === 'late' ? `<span class="badge b-late" data-sched="late">Late${st.forecast && st.due && st.forecast > st.due ? ' · forecast ' + fmt(st.forecast) : ''}</span>`
    : causing ? SLIP_BADGE
    : st.sched === 'slip' ? `<span class="badge b-slip" data-sched="slip">Slipping · forecast ${fmt(st.forecast)}</span>`
    : st.sched === 'soon' ? `<span class="badge b-soon" data-sched="soon">Next due ${st.next ? fmt(st.next) : 'soon'}</span>`
    : `<span class="badge b-ok" data-sched="ok">Due ${fmt(st.due)}</span>`;
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

/* ---------------------------------------------------------------- R5 PMO: financials + burndown */
/* Planned budget vs forecast cost (all work) vs actual cost (done work). Engine projectFinancials, with a local fallback
   that applies the same rule: cost = effortDays × the owner's dayRate (default 800). */
export function financials(j) {
  const planned = Number(j && j.budget && j.budget.planned) || 0;
  const r = j ? eng('projectFinancials', null, docs(), j.id, today()) : null;
  const num = (...xs) => { for (const x of xs) if (typeof x === 'number' && isFinite(x)) return x; return null; };
  if (r && typeof r === 'object') {
    const f = num(r.forecast, r.forecastCost, r.forecast && r.forecast.cost), a = num(r.actual, r.actualCost, r.actual && r.actual.cost);
    if (f != null && a != null) { const pl = num(r.planned, r.budget, r.plannedBudget); return { planned: pl != null ? pl : planned, forecast: f, actual: a, src: 'engine' }; }
  }
  const items = j ? projectItems(j.id) : [];
  const cost = w => effortOf(w) * rateOf(w.owner);
  return { planned, forecast: items.reduce((x, w) => x + cost(w), 0), actual: items.filter(w => w.status === 'done').reduce((x, w) => x + cost(w), 0), src: 'local' };
}
/* Burndown: remaining effort over time (work drops off on its doneAt), plus an ideal line from start to target.
   Normalised to {points: [{date, remaining, ideal}], total, start, end}. */
function normBurn(r) {
  if (!r) return null;
  const arr = Array.isArray(r) ? r : (r.points || r.series || r.actual || r.days || null);
  if (!Array.isArray(arr) || !arr.length) return null;
  const idealArr = !Array.isArray(r) && Array.isArray(r.ideal) ? r.ideal : null;
  const idealAt = {}; (idealArr || []).forEach(x => { if (x && x.date) idealAt[x.date] = Number(x.remaining != null ? x.remaining : x.value); });
  const pts = arr.filter(x => x && x.date).map(x => ({ date: String(x.date).slice(0, 10), remaining: x.remaining != null ? Number(x.remaining) : (x.actual != null ? Number(x.actual) : null), ideal: x.ideal != null ? Number(x.ideal) : (idealAt[x.date] != null ? idealAt[x.date] : null) }));
  (idealArr || []).forEach(x => { if (x && x.date && !pts.some(p => p.date === String(x.date).slice(0, 10))) pts.push({ date: String(x.date).slice(0, 10), remaining: null, ideal: Number(x.remaining != null ? x.remaining : x.value) }); });
  pts.sort((a, b) => a.date.localeCompare(b.date));
  const total = Number(!Array.isArray(r) && r.total) || Math.max(0, ...pts.map(p => Math.max(p.remaining || 0, p.ideal || 0)));
  return { points: pts, total, start: pts[0].date, end: pts[pts.length - 1].date };
}
/* Local burndown on business days (same rule as the engine): remaining = total − effort done by that date; ideal is linear. */
function localBurn(items, start, end) {
  const total = items.reduce((a, w) => a + effortOf(w), 0);
  if (!start || !end || end < start) return null;
  const dates = []; for (let d = start; d <= end; d = addDays(d, 1)) if (!isWeekend(d)) dates.push(d);
  if (!dates.length) dates.push(start);
  const span = Math.max(1, dates.length - 1);
  const doneBy = d => items.filter(w => w.status === 'done' && (w.doneAt || w.due) <= d).reduce((a, w) => a + effortOf(w), 0);
  return { total, start: dates[0], end: dates[dates.length - 1], points: dates.map((d, i) => ({ date: d, remaining: d > today() ? null : Math.round((total - doneBy(d)) * 10) / 10, ideal: Math.round(Math.max(0, total * (1 - i / span)) * 10) / 10 })) };
}
export function projectBurn(j) {
  const items = projectItems(j.id);
  if (!items.length) return null;
  const e = normBurn(eng('burndown', null, docs(), j.id, today()));
  if (e) return e;
  const start = minDate(items.map(w => w.start || w.due));
  return localBurn(items, start, maxDate([j.target, start]));
}
function sprintBurn(j, sp, items) {
  if (!sp || !items.length) return null;
  /* engine burndown is project-wide; a sprint burns its own items over the sprint's business days */
  return localBurn(items, sp.start, sp.end);
}
/* Inline SVG chart (actual + ideal) with a text summary and an accessible data table. */
export function burnChart(b, opts) {
  opts = opts || {};
  const id = opts.id || 'burn';
  if (!b || !b.points || !b.points.length) return `<div class="empty" data-burn-empty="${esc(id)}">${esc(opts.empty || 'No work to burn down yet.')}</div>`;
  const W = 320, H = 150, L = 34, R = 10, T = 10, B = 24;
  const x0 = b.start, span = Math.max(1, dayDiff(b.end, b.start));
  const ymax = Math.max(1, b.total, ...b.points.map(p => Math.max(p.remaining || 0, p.ideal || 0)));
  const X = d => (L + (W - L - R) * dayDiff(d, x0) / span).toFixed(1), Y = v => (T + (H - T - B) * (1 - v / ymax)).toFixed(1);
  const line = key => b.points.filter(p => p[key] != null && isFinite(p[key])).map((p, i) => `${i ? 'L' : 'M'}${X(p.date)},${Y(p[key])}`).join(' ');
  const act = b.points.filter(p => p.remaining != null);
  const nowP = act[act.length - 1];
  const td = today() >= b.start && today() <= b.end ? `<line class="pmo-burn-today" x1="${X(today())}" x2="${X(today())}" y1="${T}" y2="${H - B}"/>` : '';
  const idealNow = nowP && b.points.find(p => p.date === nowP.date);
  const ahead = nowP && idealNow && idealNow.ideal != null ? Math.round((idealNow.ideal - nowP.remaining) * 10) / 10 : null;
  const summary = nowP ? `${fmtEffort(nowP.remaining)} of ${fmtEffort(b.total)} effort remaining on ${fmt(nowP.date)}${ahead != null ? (ahead >= 0 ? `, ${fmtEffort(ahead)} ahead of the ideal line` : `, ${fmtEffort(-ahead)} behind the ideal line`) : ''}` : `${fmtEffort(b.total)} of effort planned; burndown starts ${fmt(b.start)}`;
  const rows = b.points.filter(p => p.remaining != null || p.ideal != null);
  return `<figure class="pmo-burn" data-burn="${esc(id)}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc((opts.title || 'Burndown') + ': ' + summary)}" preserveAspectRatio="xMidYMid meet">
      <line class="pmo-burn-ax" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/><line class="pmo-burn-ax" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/>
      <text class="pmo-burn-t" x="${L - 4}" y="${T + 4}" text-anchor="end">${esc(fmtEffort(ymax))}</text><text class="pmo-burn-t" x="${L - 4}" y="${H - B}" text-anchor="end">0</text>
      <text class="pmo-burn-t" x="${L}" y="${H - 8}">${esc(fmt(b.start))}</text><text class="pmo-burn-t" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(fmt(b.end))}</text>
      ${td}<path class="pmo-burn-ideal" data-line="ideal" d="${line('ideal')}"/><path class="pmo-burn-act" data-line="actual" d="${line('remaining')}"/>
      ${nowP ? `<circle class="pmo-burn-dot" cx="${X(nowP.date)}" cy="${Y(nowP.remaining)}" r="3"/>` : ''}</svg>
    <figcaption><span class="pmo-burn-key"><i class="act"></i>Remaining effort</span><span class="pmo-burn-key"><i class="ideal"></i>Ideal${opts.idealTo ? ' (to ' + esc(opts.idealTo) + ')' : ''}</span><span class="hint" data-burn-summary>${esc(summary)}</span></figcaption>
    <details class="pmo-burn-tbl"><summary>Data table</summary><div class="tbl-wrap"><table><caption class="pmo-sr">${esc(opts.title || 'Burndown')}</caption><thead><tr><th scope="col">Date</th><th scope="col">Remaining</th><th scope="col">Ideal</th></tr></thead><tbody>${rows.map(p => `<tr><th scope="row">${esc(fmt(p.date))}</th><td>${p.remaining != null ? esc(fmtEffort(p.remaining)) : '—'}</td><td>${p.ideal != null ? esc(fmtEffort(p.ideal)) : '—'}</td></tr>`).join('')}</tbody></table></div></details></figure>`;
}

/* ---------------------------------------------------------------- page state */
let showUnchanged = false;
let renderFc = null; /* forecasts for the render in progress */
let activityOpen = false;
const sprintBurnPick = {}; /* prj -> sprint id for the sprint burndown */
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
  const built = !trig && st && st.status === 'done' && eff.some(x => x[1] !== 'live');
  const cls = ['node', trig ? 'trigger' : '', st ? (built ? 's-built' : 's-' + st.status) : '', st && st.status !== 'none' && st.status !== 'done' ? 'sch-' + st.sched : ''].join(' ');
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
    const fcAll = renderFc || forecasts();
    const causing = items.some(w => schedKey(w, fcAll) === 'causing');
    const awaitingData = !!st && st.status === 'done' && eff.some(x => x[1] !== 'live');
    body = `<div class="meta">${stBadge(st, causing, awaitingData)}${gap ? '<span class="badge b-soon">No work planned</span>' : ''}${defects ? `<span class="badge b-late">${BUG} ${defects} defect${defects > 1 ? 's' : ''}</span>` : ''}</div>
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
  const lp = isPM(j) ? '' : `disabled title="${esc(pmOnly(j, 'link processes'))}"`;
  if (!procs.length) return `<div class="empty">No processes linked yet. Link a to-be process to plan work against its steps.<div style="margin-top:10px"><button class="btn primary" data-link-proc ${lp}>Link a process</button></div></div>`;
  return procs.map(([pid, p]) => {
    if (!p) return `<div class="pgroup"><div class="empty">A linked process (${esc(pid)}) no longer exists. Use “Link a process” to tidy the list.</div></div>`;
    const dp = eng('diffProcess', { nodes: {}, removed: [] }, p) || { nodes: {}, removed: [] };
    const removed = (dp.removed || []).filter(r => r && r.type !== 'trigger' && r.type !== 'end');
    return `<div class="pgroup"><a class="pgroup-h" href="${link('/process/' + encodeURIComponent(pid))}" data-link>▤ ${esc(p.name)} <span style="color:var(--accent);font-weight:500">open design ›</span></a>
      <div class="flow">${flowHTML(p.tobe, pid, j.id, dp)}
      ${removed.length ? `<div class="conn"></div><div class="hint" style="margin-bottom:6px">Removed from as-is</div>${removed.map(g => `<div class="ghost">${esc(g.title)}</div>`).join('<div style="height:8px"></div>')}` : ''}</div></div>`;
  }).join('') + `<div style="text-align:center;margin-top:28px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
    <button class="btn" data-expand="${showUnchanged ? '0' : '1'}">${showUnchanged ? 'Hide unchanged steps' : 'Show unchanged steps'}</button>
    <button class="btn" data-link-proc ${lp}>+ Link another process</button></div>`;
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
/* "Starts Nov 3, before “Build API” finishes (Nov 5)". Engine detail first. */
export function confText(c) {
  if (c.detail) return String(c.detail);
  const a = (store.get('workItem', c.workId) || {}).title || 'Item', b = (store.get('workItem', depId(c.dep)) || {}).title || 'its dependency';
  return `“${a}” breaks its ${c.type || 'FS'} dependency on “${b}”`;
}
const shortId = id => String(id || '').length <= 8 ? String(id) : '';
/* R6 what-if scenarios: project.scenarios [{id, name, dates: {workId: {start, due}}, by, at}]. The live plan never changes until Apply. */
export const scenariosOf = j => (j && Array.isArray(j.scenarios) ? j.scenarios : []).filter(s => s && s.id);
const scenarioOf = (j, id) => id ? scenariosOf(j).find(s => s.id === id) || null : null;
function scenarioDocs(sc) {
  const dates = (sc && sc.dates) || {};
  return Object.assign({}, docs(), { workItem: (docs().workItem || []).map(x => dates[x.id] ? { id: x.id, data: Object.assign({}, x.data, { start: dates[x.id].start, due: dates[x.id].due }) } : x) });
}
const scItems = (D, prj) => (D.workItem || []).map(x => x.data).filter(w => w.projectId === prj);
/* Changed items in a scenario: [{w, s: {start, due}}] where the scenario dates differ from the plan. */
function scenarioChanges(j, sc) {
  return Object.entries((sc && sc.dates) || {}).map(([id, s]) => ({ w: store.get('workItem', id), s }))
    .filter(x => x.w && x.w.projectId === j.id && x.s && (x.s.start !== x.w.start || x.s.due !== x.w.due));
}
/* E().compareScenario -> plan vs scenario finish and cost, normalised to {plan: {finish, cost}, scen: {finish, cost}}. */
function compareScen(j, sc) {
  let r = null;
  const fn = E() && E().compareScenario;
  if (fn) { try { r = fn(docs(), j.id, sc, today()); } catch (e) { r = null; } if (!r) { try { r = fn(docs(), j.id, sc && sc.id, today()); } catch (e) { r = null; } } }
  const num = v => typeof v === 'number' && isFinite(v) ? v : null;
  const side = o => o && typeof o === 'object' ? { finish: o.finish || o.forecastFinish || o.end || null, cost: num(o.cost != null ? o.cost : o.forecastCost != null ? o.forecastCost : o.eac) } : null;
  let plan = r && side(r.plan || r.base || r.baseline || r.live), scen = r && side(r.scenario || r.whatIf || r.scen);
  if (r && !plan && (r.planFinish || r.planCost != null)) plan = { finish: r.planFinish || null, cost: num(r.planCost) };
  if (r && !scen && (r.scenarioFinish || r.scenarioCost != null)) scen = { finish: r.scenarioFinish || null, cost: num(r.scenarioCost) };
  if (!plan || !scen) {
    const fin = D => { const f = eng('forecastAll', {}, D, today()) || {}; return maxDate(scItems(D, j.id).map(w => w.status === 'done' ? (w.doneAt || w.due) : ((f[w.id] || {}).forecast || w.due))); };
    const cost = financials(j).forecast;
    plan = plan || { finish: fin(docs()), cost }; scen = scen || { finish: fin(scenarioDocs(sc)), cost };
  }
  const finishDelta = num(r && (r.finishDelta != null ? r.finishDelta : r.finishDeltaDays)) != null ? num(r.finishDelta != null ? r.finishDelta : r.finishDeltaDays) : (plan.finish && scen.finish ? dayDiff(scen.finish, plan.finish) : null);
  const costDelta = num(r && r.costDelta) != null ? num(r.costDelta) : (plan.cost != null && scen.cost != null ? scen.cost - plan.cost : null);
  return { plan, scen, finishDelta, costDelta, notes: r && Array.isArray(r.notes) ? r.notes.map(reasonText).filter(Boolean) : [] };
}
function scenarioBarHTML(j, sc, list) {
  const scs = scenariosOf(j), pm = isPM(j);
  if (!sc) {
    return `<div class="pmo-scenbar" data-scenbar><span class="pmo-scen-lbl">What-if</span>
      ${scs.length ? `<select class="pmo-sel" data-scen-open aria-label="Open a what-if scenario"><option value="">Open a scenario…</option>${scs.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>` : '<span class="hint">Try a change without touching the plan.</span>'}
      <button class="btn sm" data-scen-new ${pm ? '' : `disabled title="${esc(pmOnly(j, 'create scenarios'))}"`}>+ New scenario</button>
      <button class="btn sm" data-level ${list.length ? '' : 'disabled'} title="${esc(pm ? 'Preview date shifts so nobody is over capacity in any week' : 'Anyone can preview; ' + pmOnly(j, 'apply the shifts'))}">Level resources</button></div>`;
  }
  const c = compareScen(j, sc), n = scenarioChanges(j, sc).length;
  const dl = (v, unit) => v == null ? '' : v === 0 ? '<span class="pmo-var">no change</span>' : `<span class="pmo-var ${v > 0 ? 'up' : 'down'}">${v > 0 ? '+' : '−'}${unit === '$' ? esc(money(Math.abs(v))) : Math.abs(v) + 'd'}</span>`;
  return `<div class="pmo-scen" data-scenario="${esc(sc.id)}" role="region" aria-label="What-if scenario ${esc(sc.name)}">
    <div class="pmo-scen-h"><span class="pmo-scen-tag">WHAT-IF SCENARIO</span><b>${esc(sc.name)}</b><span class="hint">Drag freely. Nothing in the live plan changes until you apply. ${n} item${n === 1 ? '' : 's'} moved.</span></div>
    <div class="pmo-scen-cmp" data-scen-compare>
      <div><span class="lbl">Finish</span><b data-cmp-finish>${esc(fmt(c.scen.finish))}</b><span class="hint">plan ${esc(fmt(c.plan.finish))}</span>${dl(c.finishDelta)}</div>
      <div><span class="lbl">Cost</span><b data-cmp-cost>${esc(money(c.scen.cost))}</b><span class="hint">plan ${esc(money(c.plan.cost))}</span>${dl(c.costDelta, '$')}</div>
      <div><span class="lbl">Target</span><b>${esc(fmt(j.target))}</b><span class="hint">${c.scen.finish && j.target ? (c.scen.finish <= j.target ? `${dayDiff(j.target, c.scen.finish)}d buffer` : `<span class="fail">${dayDiff(c.scen.finish, j.target)}d over</span>`) : ''}</span></div></div>
    ${c.notes.length ? `<div class="hint">${c.notes.map(esc).join(' · ')}</div>` : ''}
    <div class="pmo-scen-acts"><button class="btn sm primary" data-scen-apply ${pm && n ? '' : `disabled title="${esc(pm ? 'Move something first' : pmOnly(j, 'apply a scenario'))}"`}>Apply to plan${n ? ` (${n})` : ''}</button><button class="btn sm danger" data-scen-discard ${pm ? '' : 'disabled'}>Discard</button><button class="btn sm" data-scen-exit>Back to the plan</button></div></div>`;
}
function timelineHTML(j, fc, list, D, sc) {
  const groups = groupedItems(j, list);
  const all = groups.flatMap(g => g.items);
  const top = scenarioBarHTML(j, sc, list || []);
  if (!all.length) return top + (list && projectItems(j.id).length ? noMatchHTML() : emptyWorkHTML());
  const bls = j.baselines || [];
  const bl = bls.find(b => b.id === blPick[j.id]) || bls[bls.length - 1] || null;
  const blItems = (!sc && showBaseline && bl && bl.items) || {};
  const start = addDays(minDate([...all.map(w => w.start), today()]), -2);
  const end = addDays(maxDate([...all.map(w => (fc[w.id] || {}).forecast || w.due), ...all.map(w => w.due), ...all.map(w => w.doneAt), j.target, today(), ...Object.values(blItems).map(x => x && x.due)]), 4);
  const span = Math.max(1, dayDiff(end, start));
  const pos = s => (dayDiff(s, start) / span * 100);
  const ticks = []; for (let d = start; d <= end; d = addDays(d, 7)) ticks.push(d);
  const marks = `<span class="tday" style="left:${pos(today())}%"></span>${j.target ? `<span class="tgt" style="left:${pos(j.target)}%"></span>` : ''}`;
  const crit = new Set(showCrit ? criticalIds(j, fc, D) : []);
  const confs = schedConflicts(j.id, D);
  const confBy = {}; confs.forEach(c => { (confBy[c.workId] = confBy[c.workId] || []).push(c); });
  const itemOf = id => all.find(x => x.id === id) || store.get('workItem', id);
  const canMove = w => w.status !== 'done' && (sc ? isPM(j) : canEditWork(w, j));
  let rows = `<tr class="thead"><td class="lab"><span class="hint">${all.length} work items</span></td><td class="lane">${ticks.map(t => `<span class="tick" style="left:${pos(t)}%">${fmt(t)}</span>`).join('')}${marks}</td></tr>`;
  groups.forEach(g => {
    rows += `<tr class="grp"><td class="lab">${esc(g.name)}</td><td class="lane"></td></tr>`;
    g.items.forEach(w => {
      const f = fc[w.id] || {}, fcast = f.forecast || w.due;
      const s0 = w.start || w.due, l = pos(s0), wd = Math.max(1.5, pos(w.due) - l);
      const b = blItems[w.id];
      const deps = (w.deps || []).map(d => { const x = itemOf(depId(d)); if (!x) return null; const lb = depLabel(d); return x.title + (lb ? ` (${lb})` : '') + (x.projectId !== j.id ? ' [external]' : ''); }).filter(Boolean);
      const wc = confBy[w.id] || [];
      const sid = shortId(w.id);
      const barTxt = wd < 6 ? '' : `${sid && wd >= 11 ? esc(sid) + ' · ' : ''}${esc(fmt(s0))} – ${esc(fmt(w.due))}`;
      const sub = [stepTitle(w.pid, w.step), pname(w.owner)];
      if (w.resolves) sub.push('unblocks ' + dataName(w.resolves));
      if (deps.length) sub.push('after ' + deps.join(', '));
      const actual = w.status === 'done' && w.doneAt;
      const isCrit = crit.has(w.id);
      const drag = canMove(w);
      const lw = sc ? store.get('workItem', w.id) : null;
      const moved = !!(lw && ((lw.start || lw.due) !== s0 || lw.due !== w.due));
      const barCls = `tbar ${esc(w.status)}${isCrit ? ' pmo-crit' : ''}${drag ? ' pmo-drag' : ''}${wc.length ? ' pmo-conf' : ''}${moved ? ' pmo-scen-moved' : ''}`;
      const barTitle = `${w.title} · ${dueLine(w, f)}${isCrit ? ' · on the critical path' : ''}${wc.length ? ' · conflict: ' + wc.map(confText).join('; ') : ''}`;
      const bar = drag
        ? `<button type="button" class="${barCls}" data-bar="${esc(w.id)}" style="left:${l}%;width:${wd}%" title="${esc(barTitle)}. Drag to move, drag the right edge to change the due date." aria-label="${esc(`${w.title}: ${fmt(s0)} to ${fmt(w.due)}${isCrit ? ', critical path' : ''}. Arrow keys move one business day, Shift plus arrow keys change the due date, Enter edits.`)}">${barTxt}<span class="pmo-rsz" data-rsz aria-hidden="true"></span></button>`
        : `<span class="${barCls}" data-bar="${esc(w.id)}" style="left:${l}%;width:${wd}%" title="${esc(barTitle)}${w.status === 'done' ? '' : '. ' + esc(sc ? pmOnly(j, 'change a scenario') : lockTitle(w, j))}">${barTxt}</span>`;
      const k = schedKey(w, fc);
      rows += `<tr class="click ${isCrit ? 'pmo-crit-row' : ''}" data-go="/process/${esc(w.pid)}/step/${esc(w.step)}"><td class="lab"><div class="t" title="${esc(w.title)}">${isCrit ? '<span class="pmo-crit-tag" title="On the critical path">CP</span> ' : ''}${wc.length ? `<span class="pmo-conf-tag" data-conf-mark="${esc(w.id)}" title="${esc(wc.map(confText).join('; '))}" aria-label="Scheduling conflict: ${esc(wc.map(confText).join('; '))}">⚠</span> ` : ''}${w.kind === 'defect' ? BUG + ' ' : ''}${esc(w.title)}</div>${k !== 'ok' && k !== 'done' ? `<div class="pmo-tl-badges">${wBadge(w, f, fc)}</div>` : ''}<div class="s" title="${esc(sub.join(' · '))}">${esc(sub.join(' · '))}</div></td>
        <td class="lane">${marks}
        ${b && b.due ? `<span class="pmo-blbar" style="left:${pos(b.start || b.due)}%;width:${Math.max(0.6, pos(b.due) - pos(b.start || b.due))}%"></span><span class="pmo-blmark" style="left:${pos(b.due)}%" title="Baseline due ${esc(fmt(b.due))}"></span>` : ''}
        ${bar}
        ${w.status !== 'done' && fcast > w.due ? `<span class="tslip" style="left:${pos(w.due)}%;width:${pos(fcast) - pos(w.due)}%" title="Forecast ${esc(fmt(fcast))}"></span>` : ''}
        ${actual && w.doneAt > w.due ? `<span class="tslip pmo-late-actual" style="left:${pos(w.due)}%;width:${pos(w.doneAt) - pos(w.due)}%"></span>` : ''}
        ${actual ? `<span class="pmo-actual" style="left:${pos(w.doneAt)}%" title="Finished ${esc(fmt(w.doneAt))} (planned ${esc(fmt(w.due))})"></span>` : ''}</td></tr>`;
    });
  });
  const critCtl = `<label class="pmo-toggle"><input type="checkbox" data-crit-toggle ${showCrit ? 'checked' : ''}/> Highlight critical path${showCrit && crit.size ? ` <span class="hint">(${crit.size} item${crit.size === 1 ? '' : 's'})</span>` : ''}</label>`;
  const blCtl = bls.length && !sc ? `<div class="pmo-tlbar">${critCtl}<label class="pmo-toggle"><input type="checkbox" data-bl-toggle ${showBaseline ? 'checked' : ''}/> Show baseline</label>
      <select class="pmo-sel" data-bl-pick aria-label="Baseline" ${showBaseline ? '' : 'disabled'}>${bls.map(x => `<option value="${esc(x.id)}" ${bl && x.id === bl.id ? 'selected' : ''}>${esc(x.label || 'Baseline')} · ${esc(fmt(x.at))}</option>`).join('')}</select></div>`
    : `<div class="pmo-tlbar">${critCtl}${sc ? '' : '<span class="hint">No baseline saved yet. “Save baseline” snapshots today’s plan so you can see drift here.</span>'}</div>`;
  const canDrag = all.some(canMove);
  const confIds = [...new Set(confs.map(c => c.workId))].filter(id => all.some(w => w.id === id));
  const asBtn = sc ? '' : `<button class="btn sm ${confIds.length ? 'primary' : ''}" data-autosched title="${esc(isPM(j) ? 'Preview date moves that resolve every dependency conflict' : 'Anyone can preview; ' + pmOnly(j, 'apply the moves'))}">Auto-schedule</button>`;
  const confBar = `<div class="pmo-confbar ${confIds.length ? 'has' : ''}" data-conf-bar role="status">${confIds.length
    ? `<b>⚠ ${confs.length} scheduling conflict${confs.length === 1 ? '' : 's'}</b> <span class="hint">${confs.slice(0, 2).map(c => esc(confText(c))).join(' · ')}${confs.length > 2 ? ` · +${confs.length - 2} more` : ''}</span>`
    : '<span class="hint">No scheduling conflicts: every item’s planned dates respect its dependencies.</span>'}${asBtn}</div>`;
  const dragHint = `<div class="hint pmo-draghint">${canDrag ? 'Drag a bar to move it, or drag its right edge to change the due date. Keyboard: focus a bar, ←/→ moves it one business day, Shift+←/→ changes the due date, Enter edits.' : sc ? `Only ${esc(pname(j.owner))} (project manager) can change a scenario.` : `Only each item’s owner or ${esc(pname(j.owner))} (project manager) can reschedule. Bars you can move have a grab handle.`}</div>`;
  return `${top}${blCtl}${confBar}${dragHint}<div class="tl ${sc ? 'pmo-tl-scen' : ''}" id="pmoTl" data-span="${span}" data-start="${esc(start)}"><table>${rows}</table><svg class="pmo-arrows" aria-hidden="true"></svg></div>
   <div class="legend" style="margin-top:12px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
    <div><span class="sw" style="background:var(--done)"></span>Done (planned dates)</div><div><span class="sw" style="background:var(--prog)"></span>In progress</div><div><span class="sw" style="background:#94a3b8"></span>Not started</div>
    <div><span class="sw" style="background:repeating-linear-gradient(45deg,#fecaca,#fecaca 4px,#fee2e2 4px,#fee2e2 8px)"></span>Forecast or actual slip</div>
    <div><span class="pmo-actual static"></span>Actual finish</div>
    <div><span class="sw pmo-sw-crit"></span>Critical path</div><div><span class="pmo-sw-arrow">→</span>Dependency</div><div><span class="pmo-conf-tag">⚠</span> Dates break a dependency</div>
    <div><span class="sw" style="border:0;border-left:2px solid var(--accent);border-radius:0"></span>Today</div><div><span class="sw" style="border:0;border-left:2px dashed #16a34a;border-radius:0"></span>Target</div>
    ${sc ? '<div><span class="sw pmo-sw-scen"></span>Moved in this scenario</div>' : ''}${bls.length && !sc ? '<div><span class="pmo-blmark static"></span>Baseline due</div>' : ''}</div>`;
}

/* Critical path: engine criticalPath (R6: the full predecessor chain), with a local fallback walked back through deps. */
function criticalIds(j, fc, D) {
  const cp = eng('criticalPath', null, D || docs(), j.id, today());
  if (Array.isArray(cp)) return cp.map(x => typeof x === 'object' && x ? x.id || x.workId : x);
  const items = D ? scItems(D, j.id) : projectItems(j.id);
  const get = id => items.find(x => x.id === id);
  const end = w => (fc[w.id] || {}).forecast || w.due;
  const open = items.filter(w => w.status !== 'done');
  if (!open.length) return [];
  let cur = open.slice().sort((a, b) => String(end(b)).localeCompare(String(end(a))))[0];
  const path = [cur.id];
  for (let guard = 0; guard < 200; guard++) {
    const deps = (cur.deps || []).map(d => get(depId(d))).filter(x => x && x.status !== 'done' && !path.includes(x.id));
    if (!deps.length) break;
    cur = deps.sort((a, b) => String(end(b)).localeCompare(String(end(a))))[0];
    path.unshift(cur.id);
  }
  return path;
}
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

/* Live check while dragging: would these dates break a dependency (either way round)? */
function dragConflicts(j, w, s, d, D) {
  const base = D || docs();
  const nd = Object.assign({}, base, { workItem: (base.workItem || []).map(x => x.id === w.id ? { id: x.id, data: Object.assign({}, x.data, { start: s, due: d }) } : x) });
  const before = new Set(schedConflicts(j.id, base).map(c => c.workId + '>' + depId(c.dep)));
  const fresh = schedConflicts(j.id, nd).filter(c => (c.workId === w.id || depId(c.dep) === w.id) && !before.has(c.workId + '>' + depId(c.dep)));
  if (!fresh.length) return '';
  const other = c => (store.get('workItem', c.workId === w.id ? depId(c.dep) : c.workId) || {}).title || 'another item';
  return `conflicts with ${fresh.slice(0, 2).map(other).join(', ')}${fresh.length > 2 ? ` +${fresh.length - 2}` : ''}`;
}
let arrowsResize = false;
let refocusBar = null, refocusUntil = 0; /* keyboard moves re-render the timeline (twice per save); focus returns to the same bar */
/* Commit new dates from a drag, resize or key press: to the live plan (owner/PM), or into the open scenario (PM). */
async function commitDates(j, w, start, due, how, sc) {
  const s0 = w.start || w.due;
  if (start === s0 && due === w.due) return;
  if (sc) {
    if (!isPM(j)) { toast(pmOnly(j, 'change a scenario')); rerender(); return; }
    const cur = store.get('project', j.id) || j;
    const scs = scenariosOf(cur).map(x => x.id === sc.id ? Object.assign({}, x, { dates: Object.assign({}, x.dates || {}, { [w.id]: { start, due } }) }) : x);
    await psave('project', j.id, Object.assign({}, cur, { scenarios: scs }), `Scenario “${sc.name}”: “${w.title}” ${fmt(s0)} – ${fmt(w.due)} → ${fmt(start)} – ${fmt(due)} (live plan unchanged)`);
    return;
  }
  const live = store.get('workItem', w.id) || w;
  if (!canEditWork(live, j)) { toast(lockTitle(live, j)); rerender(); return; }
  const next = Object.assign({}, live, { start, due, updatedAt: stamp() });
  const dd = dayDiff(start, s0), de = dayDiff(due, w.due);
  const sign = n => (n > 0 ? '+' : '') + n + 'd';
  const summary = how === 'resize'
    ? `Resized “${w.title}” on the timeline: due ${fmt(w.due)} → ${fmt(due)} (${sign(de)})`
    : `Rescheduled “${w.title}” on the timeline: ${fmt(s0)} – ${fmt(w.due)} → ${fmt(start)} – ${fmt(due)} (${sign(dd)})`;
  await psave('workItem', w.id, next, summary);
  const nConf = schedConflicts(j.id).filter(c => c.workId === w.id || depId(c.dep) === w.id).length;
  if (how !== 'key') toast(`${how === 'resize' ? `Due ${de > 0 ? 'later' : 'earlier'} by ${Math.abs(de)} day${Math.abs(de) === 1 ? '' : 's'}` : `Moved ${dd > 0 ? 'later' : 'earlier'} by ${Math.abs(dd)} day${Math.abs(dd) === 1 ? '' : 's'}`}${nConf ? ` · ${nConf} scheduling conflict${nConf === 1 ? '' : 's'}: try Auto-schedule` : ''}`);
}
/* R5 Auto-schedule: preview the engine's proposed {workId: {start, due}} as before → after, apply on confirm (PM only). */
function proposedMoves(j) {
  let r = eng('autoSchedule', null, docs(), j.id);
  if (r && r.moves) r = r.moves;
  const map = {};
  if (Array.isArray(r)) r.forEach(x => { if (x && (x.workId || x.id)) map[x.workId || x.id] = x; });
  else if (r && typeof r === 'object') Object.assign(map, r);
  return Object.entries(map).map(([id, v]) => ({ w: store.get('workItem', id), v: v || {} }))
    .filter(x => x.w && x.w.projectId === j.id && x.w.status !== 'done' && x.v.start && x.v.due && (x.v.start !== x.w.start || x.v.due !== x.w.due))
    .sort((a, b) => String(a.v.start).localeCompare(String(b.v.start)));
}
async function autoSchedule(j) {
  const moves = proposedMoves(j);
  const nConf = schedConflicts(j.id).length;
  const pm = isPM(j);
  if (!moves.length) {
    await modal({ title: 'Auto-schedule', body: `<p style="margin:0" data-as-none>${nConf ? 'The scheduler could not find moves that resolve the conflicts. Adjust the dependencies by hand.' : 'Nothing to move: every item’s planned dates already respect its dependencies.'}</p>`, actions: [{ id: 'ok', label: 'OK', primary: true }] });
    return;
  }
  const rows = moves.map(({ w, v }) => { const dd = dayDiff(v.start, w.start || w.due);
    return `<tr data-as-row="${esc(w.id)}"><td><b>${esc(w.title)}</b><div class="hint">${esc(pname(w.owner))}</div></td><td class="pmo-nowrap">${esc(fmt(w.start))} – ${esc(fmt(w.due))}</td><td class="pmo-nowrap"><b>${esc(fmt(v.start))} – ${esc(fmt(v.due))}</b></td><td class="pmo-nowrap"><span class="pmo-var ${dd > 0 ? 'up' : dd < 0 ? 'down' : ''}">${dd > 0 ? '+' : ''}${dd}d</span></td></tr>`; }).join('');
  const body = `<p class="hint" style="margin:0">${nConf ? `Resolves ${nConf} scheduling conflict${nConf === 1 ? '' : 's'}.` : 'Tightens the plan to its dependencies.'} Durations are kept exactly, items without a conflict don’t move, and a successor starts the business day after its predecessor finishes. Nothing changes until you apply.</p>
    ${pm ? '' : `<div class="banner pmo-ro-note" style="margin:0">${esc(pmOnly(j, 'apply these moves'))}.</div>`}
    <div class="tbl-wrap"><table class="pmo-astable" data-as-table><thead><tr><th>Work item</th><th>Before</th><th>After</th><th>Shift</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const pending = modal({ title: `Auto-schedule: ${moves.length} move${moves.length === 1 ? '' : 's'}`, body, actions: pm ? [{ id: 'apply', label: `Apply ${moves.length} move${moves.length === 1 ? '' : 's'}`, primary: true }] : [] });
  const ov = [...document.querySelectorAll('.overlay')].pop(); if (ov) ov.querySelector('.modal').classList.add('pmo-wide');
  const r = await pending;
  if (r.action !== 'apply' || !isPM(store.get('project', j.id))) return;
  let n = 0;
  for (const { w, v } of moves) {
    const cur = store.get('workItem', w.id) || w;
    await psave('workItem', w.id, Object.assign({}, cur, { start: v.start, due: v.due, updatedAt: stamp() }), `Auto-scheduled “${w.title}”: ${fmt(cur.start)} – ${fmt(cur.due)} → ${fmt(v.start)} – ${fmt(v.due)}`);
    n++;
  }
  const left = schedConflicts(j.id).length;
  toast(`Applied ${n} move${n === 1 ? '' : 's'}${left ? ` · ${left} conflict${left === 1 ? '' : 's'} left` : ' · no conflicts left'}`);
}

/* Timeline interactions. Pointer: drag a bar to move it (whole days, same duration), drag its right edge to change the due date.
   Keyboard: ←/→ moves one business day, Shift+←/→ resizes (due date), Enter/click opens the edit modal. */
function bindTimeline(root, j, sc, D) {
  const box = root.querySelector('#pmoTl'); if (!box) return;
  const span = Number(box.dataset.span) || 1;
  const itemOf = id => (D ? scItems(D, j.id).find(x => x.id === id) : null) || store.get('workItem', id);
  requestAnimationFrame(() => drawArrows(box));
  if (!arrowsResize) { arrowsResize = true; window.addEventListener('resize', () => drawArrows(document.querySelector('#pmoTl'))); }
  box.querySelectorAll('button.tbar[data-bar]').forEach(bar => {
    let suppress = false;
    bar.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const w = itemOf(bar.dataset.bar); if (!w) return;
      const resize = !!e.target.closest('[data-rsz]');
      const pxDay = bar.parentElement.clientWidth / span;
      const x0 = e.clientX; let dd = 0, moved = false;
      const s0 = w.start || w.due;
      const w0 = bar.getBoundingClientRect().width;
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      let tip = null, lastDd = null, confNote = '';
      const dates = () => resize ? [s0, maxDate([s0, addDays(w.due, dd)])] : [addDays(s0, dd), addDays(w.due, dd)];
      const move = ev => {
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 4) return;
        moved = true;
        dd = Math.round(dx / pxDay);
        if (resize) { dd = Math.max(dd, -dayDiff(w.due, s0)); bar.style.width = Math.max(6, w0 + dd * pxDay).toFixed(1) + 'px'; }
        else bar.style.transform = `translateX(${(dd * pxDay).toFixed(1)}px)`;
        bar.classList.add('dragging');
        if (!tip) { tip = document.createElement('span'); tip.className = 'pmo-dragtip'; bar.parentElement.appendChild(tip); }
        tip.style.left = bar.style.left;
        tip.style.transform = resize ? '' : bar.style.transform;
        const [a, b] = dates();
        if (dd !== lastDd) { lastDd = dd; confNote = dragConflicts(j, w, a, b, D); }
        tip.classList.toggle('conf', !!confNote);
        tip.textContent = resize ? `Due ${fmt(b)}${dd ? ` (${dd > 0 ? '+' : ''}${dd}d)` : ''}${confNote ? ' · ⚠ ' + confNote : ''}`
          : `${fmt(a)} – ${fmt(b)}${dd ? ` (${dd > 0 ? '+' : ''}${dd}d)` : ''}${confNote ? ' · ⚠ ' + confNote : ''}`;
      };
      const end = () => {
        bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', end); bar.removeEventListener('pointercancel', end);
        if (!moved) return;
        suppress = true;
        if (tip) tip.remove();
        if (!dd) { bar.style.transform = ''; bar.style.width = ''; bar.classList.remove('dragging'); return; }
        const [a, b] = dates();
        commitDates(j, w, a, b, resize ? 'resize' : 'move', sc);
      };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
    });
    bar.addEventListener('click', e => {
      e.stopPropagation();
      if (suppress) { suppress = false; return; }
      if (sc) { toast('In a scenario, drag bars or use the arrow keys. Apply the scenario to change the plan.'); return; }
      const w = store.get('workItem', bar.dataset.bar); if (w) editWork(store.get('project', j.id), w);
    });
    bar.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); e.stopPropagation();
      const w = itemOf(bar.dataset.bar); if (!w) return;
      const n = e.key === 'ArrowRight' ? 1 : -1, s0 = w.start || w.due;
      let a = s0, b = w.due;
      if (e.shiftKey) { b = addBiz(w.due, n); if (b < s0) { toast('The due date can’t be before the start'); return; } }
      else { a = addBiz(s0, n); b = addBiz(w.due, n); }
      refocusBar = w.id; refocusUntil = Date.now() + 2500;
      commitDates(j, w, a, b, 'key', sc);
    });
  });
  if (refocusBar && Date.now() < refocusUntil) {
    const el = box.querySelector(`button.tbar[data-bar="${CSS.escape(refocusBar)}"]`);
    if (el) el.focus({ preventScroll: true });
  } else refocusBar = null;
}

/* ---------------------------------------------------------------- work table */
const COLS = 9;
function workRowHTML(w, j, fc) {
  const deps = (w.deps || []).map(d => { const x = store.get('workItem', depId(d)); return x ? Object.assign({ lbl: depLabel(d) }, x) : null; }).filter(Boolean);
  const can = canEditWork(w, j), lt = can ? '' : `disabled title="${esc(lockTitle(w, j))}"`;
  const risks = risksFor(w.id);
  const run = w.testRef && w.testRef.runId;
  return `<tr data-wid="${esc(w.id)}" class="${can ? '' : 'pmo-ro'} ${w.kind === 'defect' ? 'pmo-defect' : ''}">
    <td><b class="pmo-wt">${w.kind === 'defect' ? BUG + ' ' : ''}${esc(w.title)}</b><div class="pmo-wsub">${w.kind ? `<span class="chip ${w.kind === 'defect' ? 'pmo-chip-defect' : ''}">${esc(KIND_LBL[w.kind] || w.kind)}</span>` : ''}${w.resolves ? `<span class="chip">${LOCK} resolves ${esc(dataName(w.resolves))}</span>` : ''}${fieldsOf(j).map(fd => fieldVal(w, fd) ? `<span class="chip pmo-ftag" data-ftag="${esc(fd.key)}"><small>${esc(fd.label)}</small> ${esc(fieldVal(w, fd))}</span>` : '').join('')}${risks.length ? `<span class="pmo-riskb" title="${esc(risks.map(r => r.title).join(' · '))}">⚠ ${risks.length} risk${risks.length > 1 ? 's' : ''}</span>` : ''}${w.kind === 'defect' ? `<a class="pmo-runlink" href="${link('/testing/' + encodeURIComponent(j.id) + (run ? '?run=' + encodeURIComponent(run) : ''))}" data-link>${run ? 'View test run ›' : 'Testing ›'}</a>` : ''}</div></td>
    <td class="pmo-c-step"><div class="pmo-wstep">${esc(stepTitle(w.pid, w.step))}</div><div class="hint">${esc(procName(w.pid))}</div></td>
    <td class="pmo-nowrap pmo-c-owner">${av(w.owner)} ${esc(pname(w.owner).split(' ')[0])}</td>
    <td>${statusSelect(w, j, lt)}</td>
    <td class="pmo-nowrap pmo-c-dates">${esc(fmt(w.start))} → ${esc(fmt(w.due))}</td>
    <td class="pmo-nowrap pmo-c-eff"><span class="pmo-eff">${fmtEffort(effortOf(w))}</span>${hoursOf(w) ? `<div class="hint" data-hours>${fmtHours(hoursOf(w))} logged</div>` : ''}</td>
    <td class="pmo-c-sched">${wBadge(w, fc[w.id], fc)}${whyBtn(w)}<div class="pmo-dl">${esc(dueLine(w, fc[w.id]))}</div></td>
    <td class="pmo-deps pmo-c-deps">${deps.length ? '<span class="pmo-c-lbl">After </span>' + deps.map(d => `<span class="dep">${esc(d.title)}${d.lbl ? ` <small class="pmo-deptype">${esc(d.lbl)}</small>` : ''}${d.projectId !== j.id ? ` <small class="pmo-ext" title="${esc('In ' + ((store.get('project', d.projectId) || {}).name || 'another project'))}">external</small>` : ''}${d.status === 'done' ? ' ✓' : ''}</span>`).join('') : '<span class="hint">—</span>'}</td>
    <td class="pmo-nowrap"><button class="btn sm" data-log-time="${esc(w.id)}" ${canLogTime(w, j) ? '' : `disabled title="${esc(`Only the project team can log time`)}"`}>Log time</button> <button class="btn sm" data-edit-work="${esc(w.id)}" ${lt}>Edit</button> <button class="btn sm danger" data-del-work="${esc(w.id)}" aria-label="Delete ${esc(w.title)}" ${lt}>Delete</button></td></tr>`;
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
    <span class="hint">${items.length} item${items.length === 1 ? '' : 's'} · ${isPM ? 'you’re the project manager, so you can update any item' : `you can update your own items; ${esc(pname(j.owner))} (project manager) can update all`}</span><button class="btn sm" data-export-work ${items.length ? '' : 'disabled'} title="Download the ${items.length} work item${items.length === 1 ? '' : 's'} shown as a CSV file">Export CSV</button><button class="btn primary sm" data-add-work>+ Add work item</button></div>`;
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
/* R6 view-aware right rail.
   Map: blockers, up next, legend. Timeline: conflicts, critical path. Board/Sprints: sprint stats (burndown only on Sprints).
   Work: filter summary. Every view: one collapsed "Activity" toggle (comments, history, work changes). */
function blockersHTML(j, fc) {
  const items = projectItems(j.id);
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
  return `<div class="card" data-blockers><h3>${LOCK} Biggest blockers <span class="n">${blockers.length}</span></h3>${blockers.map(({ d, steps, r }) => `<div class="row click" data-go="/data/${esc(d)}"><span style="color:var(--late);margin-top:2px">${LOCK}</span><div><div class="t">${esc(dataName(d))}</div>
      ${fixLine(r)}</div><div class="r"><b style="color:var(--late)">${steps.length}</b><div class="s">step${steps.length === 1 ? '' : 's'} held</div></div></div>`).join('') || '<div class="s">No data is holding open work. Missing data on steps with open work shows here.</div>'}</div>
    ${amber.length ? `<div class="card pmo-amber-card" data-needs-live><h3><i class="pmo-adot"></i> Needs a live source before go-live <span class="n">${amber.length}</span></h3><div class="hint" style="margin:-4px 0 8px">Not holding work today, but the release gate requires live data.</div>${amber.map(({ d, e, r }) => `<div class="row click" data-go="/data/${esc(d)}"><span class="pmo-amber-dot" aria-hidden="true"></span><div><div class="t">${esc(dataName(d))} <span class="badge ${e === 'missing' ? 'b-late' : 'b-soon'}">${e === 'example' ? 'Examples only' : e === 'pending' ? 'Fix done · awaiting owner confirmation' : 'Missing'}</span></div>${e === 'pending' ? `<div class="s">Waiting for ${esc(pname((store.get('dataElement', d) || {}).owner))} to confirm the live source.</div>` : fixLine(r)}</div></div>`).join('')}</div>` : ''}`;
}
function upNextHTML(j, fc) {
  const items = projectItems(j.id), open = items.filter(w => w.status !== 'done');
  const ranked = open.map(w => ({ w, n: (eng('dependents', [], docs(), w.id) || []).length })).sort((a, b) => b.n - a.n || String(a.w.due).localeCompare(String(b.w.due)));
  return `<div class="card" data-upnext><h3>Up next <span class="n">${open.length}</span></h3>${items.length ? `<div class="hint" style="margin:-4px 0 8px">Ranked by how much downstream work each one unblocks</div>${ranked.slice(0, 5).map(({ w, n }) => `<div class="row click" data-go="/process/${esc(w.pid)}/step/${esc(w.step)}">${av(w.owner)}<div><div class="t">${esc(w.title)}</div><div class="s">${n ? `<b style="color:var(--ink)">Unblocks ${n}</b> · ` : ''}${esc(stepTitle(w.pid, w.step))}</div><div class="s pmo-schedrow">${schedHTML(w, fc[w.id])}</div></div></div>`).join('') || '<div class="s">All work is done.</div>'}`
    : `<div class="s" data-nowork>No work planned yet — <button class="btn sm" data-suggest>✦ Suggest work from diff</button></div>`}</div>`;
}
function conflictsRailHTML(j, D) {
  const confs = schedConflicts(j.id, D);
  return `<div class="card" data-rail-conflicts><h3>⚠ Scheduling conflicts <span class="n">${confs.length}</span></h3>${confs.length
    ? confs.slice(0, 8).map(c => { const w = (D ? (D.workItem || []).map(x => x.data) : projectItems(j.id)).find(x => x.id === c.workId) || store.get('workItem', c.workId) || {};
      return `<div class="row"><span class="pmo-conf-tag" aria-hidden="true">⚠</span><div><div class="t">${esc(w.title || 'Work item')}</div><div class="s">${esc(confText(c))}</div></div></div>`; }).join('') + (confs.length > 8 ? `<div class="hint">+${confs.length - 8} more</div>` : '') + '<div class="hint" style="margin-top:6px">Auto-schedule moves only conflicting items and keeps durations.</div>'
    : '<div class="s">None. Every item’s planned dates respect its dependencies.</div>'}</div>`;
}
function critRailHTML(j, fc, D) {
  const ids = criticalIds(j, fc, D);
  const all = D ? (D.workItem || []).map(x => x.data) : store.list('workItem');
  const chain = ids.map(id => all.find(w => w.id === id)).filter(Boolean);
  const end = chain.length ? ((fc[chain[chain.length - 1].id] || {}).forecast || chain[chain.length - 1].due) : null;
  return `<div class="card" data-rail-crit><h3>Critical path <span class="n">${chain.length} item${chain.length === 1 ? '' : 's'}</span></h3>${chain.length
    ? `<div class="hint" style="margin:-4px 0 8px">The longest dependency chain to the finish${end ? ` (${esc(fmt(end))})` : ''}. A delay on any of these moves the finish.</div><ol class="pmo-crit-list">${chain.map(w => `<li data-crit-item="${esc(w.id)}"><b>${esc(w.title)}</b>${w.projectId !== j.id ? ` <small class="pmo-ext" data-crit-ext title="${esc('In ' + ((store.get('project', w.projectId) || {}).name || 'another project'))}">external</small>` : ''}<span class="s">${w.projectId !== j.id ? esc((store.get('project', w.projectId) || {}).name || 'Another project') + ' · ' : ''}${esc(pname(w.owner))} · ${esc(fmt(w.start || w.due))} – ${esc(fmt((fc[w.id] || {}).forecast || w.due))}</span></li>`).join('')}</ol>`
    : '<div class="s">No open work, so no critical path.</div>'}</div>`;
}
function sprintStatsHTML(j, fc) {
  const sps = sprintList(j); if (!sps.length) return '';
  const t = today();
  const sp = sps.find(x => t >= x.start && t <= x.end) || sps.find(x => x.start > t) || sps[sps.length - 1];
  const items = projectItems(j.id).filter(w => sprintIdOf(j, w, sps) === sp.id);
  const ld = sprintLoad(sp, items);
  const done = items.filter(w => w.status === 'done').length;
  const late = items.filter(w => ['late', 'causing', 'slip'].includes(schedKey(w, fc))).length;
  const left = t > sp.end ? 0 : bizDays(t > sp.start ? t : sp.start, sp.end);
  const cur = t >= sp.start && t <= sp.end;
  return `<div class="card" data-sprint-stats><h3>${esc(sp.name)} ${cur ? '<span class="badge b-ok">Current</span>' : t < sp.start ? '<span class="badge b-idle">Next</span>' : '<span class="badge b-idle">Last</span>'}</h3>
    <div class="hint" style="margin:-4px 0 8px">${esc(fmt(sp.start))} – ${esc(fmt(sp.end))} · ${left} working day${left === 1 ? '' : 's'} left</div>
    <div class="pmo-sstats"><div><b>${done}/${items.length}</b><span>done</span></div><div><b class="${ld.over ? 'fail' : ''}">${fmtEffort(ld.effort)}</b><span>effort / ${fmtEffort(ld.cap)} capacity</span></div><div><b class="${late ? 'fail' : ''}">${late}</b><span>late or slipping</span></div></div>
    ${ld.over ? `<div class="pmo-spr-over" data-over>Over capacity by ${fmtEffort(Math.round((ld.effort - ld.cap) * 10) / 10)}</div>` : ''}
    <div class="pmo-spr-who" style="margin-top:6px">${ld.owners.map(av).join('')}</div></div>`;
}
function filterSummaryHTML(j, f, fc, list) {
  const all = projectItems(j.id);
  const by = {}; list.forEach(w => { const n = statusName(w, j); by[n] = (by[n] || 0) + 1; });
  const eff = list.reduce((a, w) => a + effortOf(w), 0), hrs = list.reduce((a, w) => a + hoursOf(w), 0);
  const late = list.filter(w => ['late', 'causing', 'slip'].includes(schedKey(w, fc))).length;
  return `<div class="card" data-filter-summary><h3>Showing <span class="n">${list.length} of ${all.length}</span></h3>
    <div class="s" style="margin-bottom:8px">${Object.keys(f).length ? `Filtered by ${esc(describeFilters(f, j))}.` : 'No filters: every work item in the project.'}</div>
    <div class="pmo-sstats"><div><b>${fmtEffort(eff)}</b><span>effort</span></div><div><b>${fmtHours(hrs)}</b><span>logged</span></div><div><b class="${late ? 'fail' : ''}">${late}</b><span>late or slipping</span></div></div>
    <div class="pmo-fsum">${statusesOf(j).map(st => `<span class="chip"><i class="pmo-col-dot st-${esc(st.maps)}"></i>${esc(st.name)} <b>${by[st.name] || 0}</b></span>`).join('')}</div></div>`;
}
function sideHTML(j, fc, mode, ctx) {
  ctx = ctx || {};
  let body = '';
  if (mode === 'map') body = blockersHTML(j, fc) + upNextHTML(j, fc) + mapLegend();
  else if (mode === 'timeline') body = conflictsRailHTML(j, ctx.D) + critRailHTML(j, ctx.fc || fc, ctx.D);
  else if (mode === 'board' || mode === 'sprints') body = sprintStatsHTML(j, fc) + (mode === 'sprints' ? sprintBurnHTML(j) : '');
  else if (mode === 'work') body = filterSummaryHTML(j, ctx.f || {}, fc, ctx.list || projectItems(j.id));
  return body + activityToggle(j);
}
const mapLegend = () => `    <div class="card" data-legend><h3>How to read the map</h3><div class="legend">
      <div><span class="sw" style="background:var(--done-fill);border-color:#bbf7d0"></span>Done</div>
      <div><span class="sw" style="background:var(--prog-fill);border-left:4px solid var(--prog)"></span>In progress</div>
      <div><span class="sw" style="background:var(--idle-fill)"></span>Not started</div>
      <div><span class="sw pmo-sw-built"></span>Built · awaiting live data</div>
      <div><span class="sw" style="border:2px solid var(--soon)"></span>Due within 5 days</div>
      <div><span class="sw" style="border:2px solid var(--late)"></span>Late or slipping</div>
      <div><span class="chip block" style="padding:1px 6px">${LOCK}</span> Waiting on missing data</div>
      <div><span class="chip pmo-amber" style="padding:1px 6px"><i class="pmo-adot"></i></span> Examples only: needs live data before go-live</div>
      <div>${SLIP_BADGE} Its work pushes back later work</div>
      <div><span class="chip diff-new">NEW</span> Not in as-is</div>
      <div><span class="chip diff-changed">CHANGED</span> Differs from as-is</div></div>
      <div class="hint" style="margin-top:8px">A step’s status comes from its work and its data: done work on data that isn’t live yet is amber, not green. Unchanged steps with no work are collapsed. A late fix pushes back every item that depends on it.</div></div>`;
/* Comments and history collapse into one "Activity" toggle on every view. */
function activityToggle(j) {
  const n = store.list('comment', c => c.ref === 'project:' + j.id).length;
  return `<details class="card pmo-activity" data-activity ${activityOpen ? 'open' : ''}><summary><h3>Activity <span class="n">${n} comment${n === 1 ? '' : 's'}</span></h3><span class="hint">Comments, history and work changes</span></summary>
    <div class="pmo-act-b"><h4>Comments</h4>${commentsPanel('project:' + j.id)}<h4>History</h4>${historyPanel('project:' + j.id)}<h4>Work item changes</h4>${feedHTML('prj-work')}</div></details>`;
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
/* R6: custom field filters ride along as cf_<key>. */
const isCF = k => /^cf_[\w-]{1,40}$/.test(k);
export function readFilters(q) { const f = {}; FKEYS.forEach(k => { if (q && q[k]) f[k] = String(q[k]); }); Object.keys(q || {}).filter(isCF).forEach(k => { if (q[k]) f[k] = String(q[k]); }); return f; }
const fkeys = (a, b) => [...new Set([...FKEYS, ...Object.keys(a || {}).filter(isCF), ...Object.keys(b || {}).filter(isCF)])];
const sameFilters = (a, b) => fkeys(a, b).every(k => String((a || {})[k] || '') === String((b || {})[k] || ''));
function nodeData(pid, sid) { const n = nodeOf(pid, sid) || {}; return [...(n.data || []), ...(n.subs || []).flatMap(x => x.data || [])]; }
export function filterItems(items, f, fc) {
  const q = String(f.q || '').trim().toLowerCase();
  return items.filter(w => {
    if (f.owner && w.owner !== f.owner) return false;
    if (f.status === 'open' ? w.status === 'done' : (f.status && w.status !== f.status)) return false;
    if (f.step) { const [pid, sid] = f.step.split('::'); if (w.pid !== pid || (sid && w.step !== sid)) return false; }
    if (f.data && w.resolves !== f.data && !nodeData(w.pid, w.step).includes(f.data)) return false;
    if (f.late) { const s = (fc[w.id] || {}).sched; if (w.status === 'done' || (s !== 'late' && s !== 'slip')) return false; }
    if (q && ![w.title, stepTitle(w.pid, w.step), pname(w.owner), procName(w.pid), w.resolves ? dataName(w.resolves) : '', ...Object.values(w.custom || {})].join(' ').toLowerCase().includes(q)) return false;
    for (const k of Object.keys(f).filter(isCF)) { const v = w.custom ? w.custom[k.slice(3)] : undefined; if (v == null || String(v) !== f[k]) return false; }
    return true;
  });
}
export function describeFilters(f, j) {
  const out = [];
  if (f.owner) out.push('owner ' + pname(f.owner));
  if (f.status) out.push('status ' + (ST_FILTER[f.status] || f.status).toLowerCase());
  if (f.step) { const [pid, sid] = f.step.split('::'); out.push(sid ? 'step “' + stepTitle(pid, sid) + '”' : 'process “' + procName(pid) + '”'); }
  if (f.data) out.push('data ' + dataName(f.data));
  if (f.late) out.push('late or slipping');
  if (f.q) out.push('“' + f.q + '”');
  Object.keys(f).filter(isCF).forEach(k => { const fd = fieldsOf(j || {}).find(x => x.key === k.slice(3)); out.push(`${fd ? fd.label : k.slice(3)} ${f[k]}`); });
  return out.join(', ') || 'no filters';
}
function prjURL(prj, mode, f, view) {
  const sp = new URLSearchParams();
  if (mode && mode !== 'map') sp.set('mode', mode);
  FKEYS.forEach(k => { if (f && f[k]) sp.set(k, f[k]); });
  Object.keys(f || {}).filter(isCF).forEach(k => { if (f[k]) sp.set(k, f[k]); });
  if (view) sp.set('view', view);
  const s = sp.toString();
  return '/project/' + encodeURIComponent(prj) + (s ? '?' + s : '');
}
let refocusSearch = false;
function setFilters(prj, mode, f, view, push) {
  let path = link(prjURL(prj, mode, f, view));
  const sc = new URLSearchParams(location.search).get('sc');
  if (sc && mode === 'timeline') path += (path.includes('?') ? '&' : '?') + 'sc=' + encodeURIComponent(sc);
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
    ${fieldsOf(j).map(fd => { const vals = fd.type === 'select' ? (fd.options || []).map(String) : [...new Set(projectItems(j.id).map(w => fieldVal(w, fd)).filter(Boolean))].sort();
      return vals.length ? `<select class="pmo-sel" data-f="cf_${esc(fd.key)}" aria-label="Filter by ${esc(fd.label)}"><option value="">Any ${esc(fd.label.toLowerCase())}</option>${vals.map(v => `<option value="${esc(v)}" ${f['cf_' + fd.key] === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : ''; }).join('')}
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
  const r = await modal({ title: 'Save view', body: `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}<p class="hint" style="margin:0">Saves these filters on the project so anyone can pick them from “Saved views”: <b>${esc(describeFilters(f, j))}</b>.</p>
    <div class="field"><label for="pmo-vname">View name</label><input id="pmo-vname" name="name" maxlength="60" placeholder="e.g. Dev’s late work" /></div>`, actions: [{ id: 'save', label: 'Save view', primary: true }] });
  if (r.action !== 'save') return;
  const name = String(r.form.name || '').trim();
  if (!name) return saveView(j, mode, f, 'Give the view a name.');
  const cur = store.get('project', j.id) || j;
  if ((cur.views || []).some(v => v.name.toLowerCase() === name.toLowerCase())) return saveView(j, mode, f, `A view called “${name}” already exists.`);
  const v = { id: store.newId('vw'), name, filters: readFilters(f), by: store.state.me, at: stamp() };
  history.replaceState({}, '', link(prjURL(j.id, mode, f, v.id)));
  await psave('project', j.id, Object.assign({}, cur, { views: [...(cur.views || []), v] }), `Saved view “${name}” (${describeFilters(f, j)})`);
  toast('View saved');
}
async function deleteView(j, id, mode, f) {
  const v = (j.views || []).find(x => x.id === id); if (!v) return;
  const r = await modal({ title: 'Delete saved view?', body: `<p style="margin:0">Delete the view <b>${esc(v.name)}</b>? The work items are not affected.</p>`, actions: [{ id: 'delete', label: 'Delete', danger: true }] });
  if (r.action !== 'delete') return;
  history.replaceState({}, '', link(prjURL(j.id, mode, f, null)));
  await psave('project', j.id, Object.assign({}, j, { views: (j.views || []).filter(x => x.id !== id) }), `Deleted saved view “${v.name}”`);
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
    fieldTags(w, j),
  ].join('');
  return `<article class="pmo-card st-${esc(w.status)} ${can ? 'pmo-cdrag' : 'pmo-ro'}" data-card="${esc(w.id)}" ${can ? 'draggable="true"' : ''} tabindex="0"
      aria-label="${esc(`${w.title}. ${statusName(w, j)}. Owner ${pname(w.owner)}. ${shortDue(w, f)}.${can ? ' Drag to move, or use the select inside the card.' : ' ' + lockTitle(w, j) + '.'}`)}" title="${esc(can ? 'Drag to move · click to edit' : lockTitle(w, j))}">
    <div class="pmo-card-h">${av(w.owner)}<b class="pmo-card-t">${esc(w.title)}</b>${can ? '' : `<span class="pmo-card-lock" aria-hidden="true">${LOCK}</span>`}</div>
    ${extra || ''}
    <div class="pmo-card-s">${esc(stepTitle(w.pid, w.step))} <span class="pmo-card-eff">· ${fmtEffort(effortOf(w))}</span></div>
    <div class="pmo-card-b">${wBadge(w, f, fc)}${whyBtn(w)}<span class="pmo-card-due">${esc(shortDue(w, f))}</span></div>
    ${chips ? `<div class="pmo-card-c">${chips}</div>` : ''}</article>`;
}
/* R6: the board's columns follow project.statuses (each maps to idle|prog|done for the engine). */
function statusSelect(w, j, attrs) {
  const cur = statusOf(w, j);
  return `<select class="pmo-sel st-${esc(w.status)}" data-status="${esc(w.id)}" aria-label="Status of ${esc(w.title)}" ${attrs || ''}>${statusesOf(j).map(x => `<option value="${esc(x.id)}" ${cur.id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
}
let showFieldTags = (() => { try { return localStorage.getItem('pmoflow.cardTags') !== '0'; } catch (e) { return true; } })();
function fieldTags(w, j) {
  if (!showFieldTags) return '';
  return fieldsOf(j).map(f => { const v = fieldVal(w, f); return v ? `<span class="chip pmo-ftag" data-ftag="${esc(f.key)}" title="${esc(f.label)}"><small>${esc(f.label)}</small> ${esc(v)}</span>` : ''; }).join('');
}
function boardHTML(j, fc, list) {
  if (!projectItems(j.id).length) return emptyWorkHTML();
  const can = list.some(w => canEditWork(w, j));
  const ss = statusesOf(j);
  const flds = fieldsOf(j);
  const cols = ss.map(st => {
    const items = list.filter(w => statusOf(w, j).id === st.id).sort((a, b) => String(a.due).localeCompare(String(b.due)));
    const eff = items.reduce((a, w) => a + effortOf(w), 0);
    return `<section class="pmo-col" data-col="${esc(st.id)}" data-maps="${esc(st.maps)}" aria-label="${esc(st.name)}"><header class="pmo-col-h"><span class="pmo-col-dot st-${esc(st.maps)}"></span><b>${esc(st.name)}</b><span class="n">${items.length}</span><span class="hint">${fmtEffort(eff)}</span></header>
      <div class="pmo-col-b">${items.map(w => cardHTML(w, j, fc, `<label class="pmo-card-kb">Status ${statusSelect(w, j, canEditWork(w, j) ? '' : 'disabled')}</label>`)).join('') || '<div class="pmo-col-empty">Drop a card here</div>'}</div></section>`;
  }).join('');
  return `<div class="pmo-tlbar pmo-board-bar"><span class="hint pmo-draghint" style="margin:0">${can ? 'Drag a card to another column to change its status. Keyboard: focus a card, press Tab to reach its status select.' : `Only each item’s owner or ${esc(pname(j.owner))} (project manager) can move cards.`}</span>
      ${flds.length ? `<label class="pmo-toggle"><input type="checkbox" data-cf-tags ${showFieldTags ? 'checked' : ''}/> Show field tags</label>` : ''}
      <button class="btn sm" data-customize ${isPM(j) ? '' : `disabled title="${esc(pmOnly(j, 'change statuses and fields'))}"`}>Statuses &amp; fields</button></div>
    ${list.length ? `<div class="pmo-board" data-board style="--cols:${ss.length}">${cols}</div>` : noMatchHTML()}`;
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
      <button class="btn sm" data-plan-sprints ${isPM ? '' : `disabled title="${esc(`Only ${pname(j.owner)} (project manager) can change the sprint cadence`)}"`}>Plan sprints</button></div>
    <div class="hint pmo-draghint">Drag a card into a sprint to plan it there: its due date moves inside the sprint and its duration is kept. Keyboard: focus a card, Tab to its sprint select.</div>
    ${list.length ? `<div class="pmo-sprints" data-sprints>${cols}</div>` : noMatchHTML()}`;
}
/* R5 sprint burndown: the picked sprint (default: the current one, else the next, else the last). */
function sprintBurnHTML(j) {
  const sps = sprintList(j);
  if (!sps.length) return '';
  const by = {}; projectItems(j.id).forEach(w => { const k = sprintIdOf(j, w, sps) || '_none'; (by[k] = by[k] || []).push(w); });
  const t = today();
  const def = sps.find(x => t >= x.start && t <= x.end) || sps.find(x => x.start > t) || sps[sps.length - 1];
  const sp = sps.find(x => x.id === sprintBurnPick[j.id]) || def;
  const items = by[sp.id] || [];
  return `<section class="card pmo-sburn" data-sprint-burn><div class="pmo-h3row"><h3 style="margin:0">Sprint burndown</h3>
      <select class="pmo-sel" data-sburn-pick aria-label="Sprint for the burndown">${sps.map(x => `<option value="${esc(x.id)}" ${x.id === sp.id ? 'selected' : ''}>${esc(x.name)} · ${esc(fmt(x.start))}–${esc(fmt(x.end))}</option>`).join('')}</select></div>
    ${burnChart(sprintBurn(j, sp, items), { id: 'sprint', title: sp.name + ' burndown', idealTo: 'sprint end ' + fmt(sp.end), empty: `No work is planned in ${sp.name}.` })}</section>`;
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
  await psave('workItem', w.id, next, `Planned “${w.title}” in ${sp.name} (${fmt(sp.start)} – ${fmt(sp.end)})${dd ? `: ${fmt(s0)} – ${fmt(w.due)} → ${fmt(next.start)} – ${fmt(next.due)} (${dd > 0 ? '+' : ''}${dd}d, same duration)` : ', dates unchanged'}`);
  toast(`Moved to ${sp.name}`);
}
async function planSprints(j, err, v) {
  if (store.state.me !== j.owner) { toast(`Only ${pname(j.owner)} (project manager) can change the sprint cadence`); return; }
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
    await psave('project', j.id, next, 'Sprint cadence set back to automatic (two-week sprints)');
    toast('Sprints set to automatic'); return;
  }
  if (r.action !== 'save') return;
  const n = Number(r.form.length), start = r.form.start;
  if (!start) return planSprints(j, 'Pick the first sprint’s start date.', { start, length: r.form.length });
  if (!(n >= 5 && n <= 42) || Math.round(n) !== n) return planSprints(j, 'Sprint length must be a whole number of days between 5 and 42.', { start, length: r.form.length });
  const planned = buildSprints(j, { start, length: n });
  await psave('project', j.id, Object.assign({}, j, { sprints: planned }), `Sprint cadence: ${n}-day sprints starting ${fmt(start)} (${planned.length} sprint${planned.length === 1 ? '' : 's'}, to ${fmt(planned[planned.length - 1].end)})`);
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
/* R5 count: "not yet live" = every project data element that isn't effectively live (missing + examples + pending). */
export function dataNotLive(j) {
  const ids = projectData(j), by = { missing: 0, example: 0, pending: 0 };
  ids.forEach(d => { const e = effAvail(d); if (e !== 'live') by[e] = (by[e] || 0) + 1; });
  return { n: by.missing + by.example + by.pending, of: ids.length, by };
}
export const notLiveText = x => `${x.n} of ${x.of} data element${x.of === 1 ? '' : 's'} not yet live${x.n ? ` (${[x.by.missing ? x.by.missing + ' missing' : '', x.by.example ? x.by.example + ' examples only' : '', x.by.pending ? x.by.pending + ' awaiting owner confirmation' : ''].filter(Boolean).join(', ')})` : ''}`;
export function reportText(j, d) {
  const sec = (h, arr) => (arr && arr.length) ? `\n${h}\n` + arr.map(x => '- ' + txt(x)).join('\n') + '\n' : '';
  return `${j.name}: status report (${fmt(today())})\n\n${txt(d.headline)}\n\n${txt(d.summary)}\n${sec('Highlights', d.highlights)}${sec('Risks', d.risks)}${sec('Asks', d.asks)}\nData: ${notLiveText(dataNotLive(j))}.`.trim();
}
/* R5: the email draft goes to the project's resources (the PM is always one), as first.last@northwind.example. */
export function reportRecipients(j) {
  const ids = [...new Set([j.owner, ...(j.resources || [])])].filter(id => store.person(id));
  return ids.map(id => ({ id, name: pname(id), email: emailOf(id) })).filter(x => x.email);
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
    const to = reportRecipients(j);
    const mail = `mailto:${to.map(x => x.email).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(reportText(j, d))}`;
    body = `<div class="pmo-rep" data-rep-body>
      <div class="pmo-rep-top">${ragBadge(r)}<span class="pmo-src ${ai ? 'ai' : ''}">${ai ? '✦ Generated by AI' : 'Rules-based'}</span><span class="hint">${esc(fmt(today()))} · ${ai ? 'written from project facts only; check before sending' : 'built from project facts by deterministic rules'}</span></div>
      <h3 class="pmo-rep-h">${esc(txt(d.headline) || j.name)}</h3>
      ${d.summary ? `<p class="pmo-rep-p">${esc(txt(d.summary))}</p>` : ''}
      <div class="pmo-rep-fact hint" data-rep-notlive>Data: ${esc(notLiveText(dataNotLive(j)))}.</div>
      <div class="pmo-rep-grid">${list('Highlights', d.highlights, 'hl')}${list('Risks', d.risks, 'rk')}${list('Asks', d.asks, 'ak')}</div></div>
      <div class="pmo-rep-to" data-rep-to><span class="lbl">Email to</span>${to.map(x => `<span class="chip" data-rcpt="${esc(x.email)}" title="${esc(x.name)}">${esc(x.email)}</span>`).join('') || '<span class="hint">No project resources yet.</span>'}<span class="hint">project resources (fictional addresses)</span></div>
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
  const fc = forecasts(); renderFc = fc;
  const s = projectStats(prj);
  const gi = gateInfo(j, s), fi = gi.fi;
  const r = rag(j, s);
  const isOwner = store.state.me === j.owner;
  const f = readFilters(params.q);
  const view = params.q && params.q.view;
  const all = projectItems(prj);
  /* R6 what-if: on the timeline, ?sc=<id> renders the scenario's dates (the live plan is untouched) */
  const sc = mode === 'timeline' ? scenarioOf(j, params.q && params.q.sc) : null;
  const D = sc ? scenarioDocs(sc) : null;
  const fcT = D ? (eng('forecastAll', {}, D, today()) || {}) : fc;
  if (D) fcDocs.set(fcT, D);
  const list = filterItems(D ? scItems(D, prj) : all, f, fcT);
  const finishKpi = gi.k === 'live'
    ? `<div class="kpi" data-kpi-finish><b style="color:var(--done)">Live since ${esc(fmt(gi.at))}${gi.v ? ` <small>(v${esc(gi.v)})</small>` : ''}</b><span>Released · <a href="${link('/release/' + encodeURIComponent(prj))}" data-link>release log ›</a></span></div>`
    : gi.k === 'awaiting'
    ? `<a class="kpi pmo-kpi-gate" data-kpi-finish href="${link('/release/' + encodeURIComponent(prj))}" data-link><b>Work done · awaiting go-live</b><span>${gi.blocking ? `<span class="fail">${gi.blocking} gate check${gi.blocking === 1 ? '' : 's'} blocking</span>` : gi.blocking === 0 ? 'Gate passes' : 'Readiness gate'} · open release ›</span></a>`
    : !s.total ? `<div class="kpi" data-kpi-finish><b class="pmo-muted">Not planned</b><span>No work yet · target ${esc(fmt(j.target))}</span></div>`
    : `<div class="kpi" data-kpi-finish><b style="color:${fi.over ? 'var(--late)' : 'inherit'}">${esc(fmt(fi.date))}</b><span>Forecast · target ${esc(fmt(j.target))}</span></div>`;
  const rm = relMgr(j);
  const team = (j.resources || []).filter(x => x !== j.owner && x !== rm);
  const fin = financials(j);
  const dis = what => isOwner ? '' : `disabled title="${esc(pmOnly(j, what))}"`;
  /* tabs keep the filters (they are views of the same items); Map ignores them */
  const tab = (k, l) => `<a href="${link(k === 'map' ? prjURL(prj, 'map') : prjURL(prj, k, f, view))}" data-link data-tab="${k}" class="${mode === k ? 'on' : ''}" role="tab" aria-selected="${mode === k}">${l}</a>`;
  const hdr = `<section class="hdr"><div>
      <div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › <a href="${link('/portfolio')}" data-link>Portfolio</a> › ${j.program ? `<span data-program>${esc(j.program)}</span> › ` : ''}Project</div>
      <h1>${esc(j.name)} <span class="pmo-hrag" data-rag="${r.k}">${ragBadge(r)}</span></h1>${j.desc ? `<p>${esc(j.desc)}</p>` : ''}
      <div class="res pmo-roles"><span class="pmo-role" data-role-pm><span class="lbl">Project manager</span>${personChip(j.owner)}</span><span class="pmo-role" data-role-rm><span class="lbl">Release manager</span>${personChip(rm)}${rm === j.owner ? '<small class="hint"> (also PM)</small>' : ''}</span>${team.length ? `<span class="pmo-role"><span class="lbl">Team</span>${team.map(av).join('')}</span>` : ''}</div>
      ${j.program || fin.planned ? `<div class="pmo-hfin" data-hfin>${j.program ? `<span class="chip" data-program-chip>Program: ${esc(j.program)}</span>` : ''}${fin.planned ? `<span class="chip ${fin.forecast > fin.planned ? 'block' : ''}">Budget ${esc(money(fin.planned))} · forecast ${esc(money(fin.forecast))}</span>` : ''}</div>` : ''}
      ${s.total ? `<div class="pmo-hev" data-hev><span class="lbl">Earned value</span>${evChips(earnedValue(j))}</div>` : ''}</div>
    <div class="hdr-side"><div class="kpis">
      <div class="kpi"><b>${s.pct}%</b><span>${s.done}/${s.total} work done</span><div class="bar pmo-kbar"><i style="width:${s.pct}%"></i></div></div>
      <div class="kpi"><b style="color:${s.late ? 'var(--late)' : 'inherit'}">${s.late}</b><span>Late</span></div>
      <div class="kpi"><b style="color:${s.slip ? 'var(--late)' : 'inherit'}">${s.slip}</b><span>Slipping</span></div>
      ${finishKpi}</div></div></section>
    <div class="pmo-toolbar"><nav class="seg pmo-tabs" role="tablist" aria-label="Project views">${tab('map', 'Map')}${tab('timeline', 'Timeline')}${tab('board', 'Board')}${tab('sprints', 'Sprints')}${tab('work', 'Work')}</nav>
      <div class="pmo-actions"><button class="btn sm primary" data-report>Report</button><button class="btn sm" data-settings ${dis('change project settings')}>Settings</button><button class="btn sm" data-link-proc ${dis('link processes')}>Link a process</button><button class="btn sm" data-suggest title="${isOwner ? 'Propose work for new and changed steps and for data without a live source' : esc(`Anyone can preview suggestions; only ${pname(j.owner)} (project manager) can create them`)}">✦ Suggest work from diff</button><button class="btn sm" data-baseline ${dis('save a baseline')}>Save baseline</button>
      <a class="btn sm" href="${link('/release/' + encodeURIComponent(prj))}" data-link>Release ›</a><a class="btn sm" href="${link('/testing/' + encodeURIComponent(prj))}" data-link>Testing ›</a></div></div>`;
  const fbar = FILTER_MODES.includes(mode) && all.length ? filterBarHTML(j, f, mode, list.length, all.length, view) : '';
  const main = mode === 'timeline' ? `<section class="pmo-main">${fbar}${timelineHTML(j, fcT, list, D, sc)}</section>`
    : mode === 'work' ? `<section class="pmo-main">${fbar}${workHTML(j, fc, list)}</section>`
    : mode === 'board' ? `<section class="pmo-main pmo-wide-main">${fbar}${boardHTML(j, fc, list)}</section>`
    : mode === 'sprints' ? `<section class="pmo-main pmo-wide-main">${fbar}${sprintsHTML(j, fc, list)}</section>`
    : `<section class="canvas pm" id="canvas">${mapHTML(j)}</section>`;
  const wide = mode === 'board' || mode === 'sprints';
  return hdr + conflictHTML(j) + reportPanelHTML(j, r) + `<div class="grid pmo-grid ${wide ? 'pmo-grid-wide' : ''}">${main}<aside class="side">${sideHTML(j, fc, mode, { D, fc: fcT, f, list })}</aside></div>`;
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
/* R6 custom fields on the work item modal; values live in workItem.custom[key]. */
function customFieldInputs(j, w) {
  const fl = fieldsOf(j); if (!fl.length) return '';
  return `<div class="pmo-cf" data-cf-inputs><div class="pmo-cf-h">Custom fields</div><div class="pmo-cf-g">${fl.map(fd => {
    const v = fieldVal(w, fd), id = 'cf-' + esc(fd.key);
    const input = fd.type === 'select' ? `<select id="${id}" name="cf_${esc(fd.key)}"><option value="">—</option>${(fd.options || []).map(o => `<option value="${esc(o)}" ${v === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : `<input id="${id}" name="cf_${esc(fd.key)}" ${fd.type === 'number' ? 'type="number" step="any"' : 'maxlength="120"'} value="${esc(v)}" />`;
    return `<div class="field"><label for="${id}">${esc(fd.label)}</label>${input}</div>`; }).join('')}</div></div>`;
}
function readCustomFields(j, f, next) {
  const fl = fieldsOf(j); if (!fl.length) return null;
  const custom = Object.assign({}, next.custom || {});
  for (const fd of fl) {
    const raw = String(f['cf_' + fd.key] == null ? '' : f['cf_' + fd.key]).trim();
    if (!raw) { delete custom[fd.key]; continue; }
    if (fd.type === 'number') { const n = Number(raw); if (!isFinite(n)) return `${fd.label} must be a number.`; custom[fd.key] = n; }
    else if (fd.type === 'select') { if (!(fd.options || []).map(String).includes(raw)) return `Pick a ${fd.label} from the list.`; custom[fd.key] = raw; }
    else custom[fd.key] = raw.slice(0, 120);
  }
  if (Object.keys(custom).length) next.custom = custom; else delete next.custom;
  return null;
}
/* R6 time logging: the item's owner, the PM and the project team log hours against a work item. Actual cost = hours × day rate / 8. */
export const canLogTime = (w, j) => !!w && !!j && (canEditWork(w, j) || (j.resources || []).includes(store.state.me));
async function logTime(j, w, err, v) {
  if (!canLogTime(w, j)) { toast('Only the project team can log time'); return; }
  v = v || { hours: '', date: today(), note: '' };
  const entries = (w.time || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const body = `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}
    <p class="hint" style="margin:0"><b>${esc(w.title)}</b> · ${fmtEffort(effortOf(w))} planned effort (${fmtHours(effortOf(w) * 8)}) · <b data-time-total>${fmtHours(hoursOf(w))}</b> logged so far. Actual cost = hours × the person’s day rate ÷ 8.</p>
    <div class="frow"><div class="field"><label for="lt-hours">Hours</label><input id="lt-hours" type="number" name="hours" min="0.25" max="24" step="0.25" value="${esc(v.hours)}" placeholder="e.g. 3" /></div>
      <div class="field"><label for="lt-date">Date</label><input id="lt-date" type="date" name="date" max="${esc(today())}" value="${esc(v.date)}" /></div></div>
    <div class="field"><label for="lt-note">Note</label><input id="lt-note" name="note" maxlength="140" value="${esc(v.note)}" placeholder="What was done" /></div>
    ${entries.length ? `<div class="tbl-wrap"><table class="pmo-ttable" data-time-list><thead><tr><th>Date</th><th>Who</th><th class="pmo-num">Hours</th><th>Note</th></tr></thead><tbody>${entries.slice(0, 12).map(t => `<tr><td class="pmo-nowrap">${esc(fmt(t.date))}</td><td class="pmo-nowrap">${av(t.by)} ${esc(pname(t.by).split(' ')[0])}</td><td class="pmo-num">${esc(fmtHours(Number(t.hours) || 0))}</td><td>${esc(t.note || '')}</td></tr>`).join('')}</tbody></table></div>${entries.length > 12 ? `<div class="hint">+${entries.length - 12} older entries</div>` : ''}` : '<div class="hint">No time logged yet.</div>'}`;
  const r = await modal({ title: 'Log time', body, actions: [{ id: 'log', label: 'Log time', primary: true }] });
  if (r.action !== 'log') return;
  const f = r.form, h = Number(f.hours);
  const keep = { hours: f.hours, date: f.date, note: f.note };
  if (!(h >= 0.25 && h <= 24)) return logTime(j, w, 'Hours must be between 0.25 and 24.', keep);
  if (!f.date) return logTime(j, w, 'Pick the date the work was done.', keep);
  if (f.date > today()) return logTime(j, w, 'You can’t log time in the future.', keep);
  const cur = store.get('workItem', w.id) || w;
  const entry = { by: store.state.me, date: f.date, hours: Math.round(h * 100) / 100, note: String(f.note || '').trim().slice(0, 140) };
  await psave('workItem', w.id, Object.assign({}, cur, { time: [...(cur.time || []), entry] }), `Logged ${fmtHours(entry.hours)} on “${w.title}” (${fmt(entry.date)})${entry.note ? ': ' + entry.note : ''}`);
  toast(`Logged ${fmtHours(entry.hours)}`);
}
async function editWork(j, w, err) {
  const isNew = !w || !w.id;
  if (!isNew && !canEditWork(store.get('workItem', w.id) || w, j)) { toast(lockTitle(w, j)); return; }
  const prev = isNew ? null : (store.get('workItem', w.id) || w);
  w = Object.assign({ title: '', owner: store.state.me, status: 'idle', kind: 'build', start: today(), due: addDays(today(), 7), deps: [], effortDays: 1 }, w || {});
  if (!w.pid && (j.processes || []).length) { const p = store.get('process', j.processes[0]); const s0 = p && flatSteps(p.tobe)[0]; if (s0) { w.pid = p.id; w.step = s0.id; } }
  const blocked = new Set(w.id ? [w.id, ...(eng('dependents', [], docs(), w.id) || [])] : []); /* cycle guard */
  const others = projectItems(j.id).filter(x => !blocked.has(x.id));
  /* R5: dependencies may point at other projects' work, shown as "external" */
  const ext = store.list('workItem', x => x.projectId !== j.id && !blocked.has(x.id) && store.get('project', x.projectId)).sort((a, b) => String(a.projectId).localeCompare(String(b.projectId)) || String(a.due).localeCompare(String(b.due)));
  const curDep = id => (w.deps || []).map(depNorm).find(d => d.id === id);
  const depRow = o => { const cur = curDep(o.id); const t = cur ? cur.type : 'FS'; const x = o.projectId !== j.id;
    return `<div class="pmo-dep ${x ? 'ext' : ''}"><label><input type="checkbox" name="deps" value="${esc(o.id)}" ${cur ? 'checked' : ''}/> <span>${esc(o.title)}</span> ${x ? '<small class="pmo-ext">external</small> ' : ''}<small>${esc(fmt(o.due))}</small></label>
        <span class="pmo-dep-opt"><select name="dt_${esc(o.id)}" aria-label="Dependency type for ${esc(o.title)}">${[['FS', 'Finish → start'], ['SS', 'Start → start'], ['FF', 'Finish → finish']].map(([k, l]) => `<option value="${k}" ${t === k ? 'selected' : ''}>${k} · ${l}</option>`).join('')}</select>
        <input type="number" name="dl_${esc(o.id)}" value="${esc(cur ? cur.lag : 0)}" min="-30" max="60" step="1" aria-label="Lag in days for ${esc(o.title)}" /><small>lag days</small></span></div>`; };
  const stepOpts = stepOptions(j, w.pid, w.step);
  const body = `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}
    <div class="field"><label>Title</label><input name="title" value="${esc(w.title)}" maxlength="140" placeholder="e.g. Integrate screening API" /></div>
    <div class="frow"><div class="field"><label>Owner</label><select name="owner">${store.state.people.map(p => `<option value="${esc(p.id)}" ${p.id === w.owner ? 'selected' : ''}>${esc(p.name)} — ${esc(p.role)}</option>`).join('')}</select></div>
      <div class="field"><label>Kind</label><select name="kind">${Object.entries(KIND_LBL).map(([k, l]) => `<option value="${k}" ${w.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="field"><label>To-be step it delivers</label>${stepOpts ? `<select name="step">${stepOpts}</select>` : '<div class="hint">Link a process first. Work attaches to a to-be step.</div>'}</div>
    <div class="frow"><div class="field"><label>Start</label><input type="date" name="start" value="${esc(w.start || '')}" /></div><div class="field"><label>Due</label><input type="date" name="due" value="${esc(w.due || '')}" /></div></div>
    <div class="frow"><div class="field"><label>Status</label><select name="status">${statusesOf(j).map(x => `<option value="${esc(x.id)}" ${statusOf(w, j).id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Effort (person-days)</label><input type="number" name="effortDays" min="0.5" max="200" step="0.5" value="${esc(effortOf(w))}" /></div></div>
    ${customFieldInputs(j, w)}
    ${isNew ? '' : `<div class="hint" data-time-sum>Time logged: <b>${fmtHours(hoursOf(w))}</b>${(w.time || []).length ? ` in ${(w.time || []).length} entr${(w.time || []).length === 1 ? 'y' : 'ies'}` : ''}. Use “Log time” on the Work tab to add hours.</div>`}
    <div class="field"><label>Resolves (makes data available)</label><select name="resolves"><option value="">— nothing —</option>${resolvesOptions(j, w.resolves)}</select><div class="hint">Only data used by this project’s processes.</div></div>
    <div class="field"><label>Depends on</label>${others.length || ext.length ? `<div class="pmo-checks pmo-depl">${others.map(depRow).join('') || '<div class="hint">No other work in this project.</div>'}</div>
      ${ext.length ? `<details class="pmo-extdeps" data-ext-deps ${ext.some(o => curDep(o.id)) ? 'open' : ''}><summary>Other projects <span class="pmo-ext">external</span> <span class="hint">${ext.length} item${ext.length === 1 ? '' : 's'}</span></summary>
        <div class="pmo-checks pmo-depl">${[...new Set(ext.map(o => o.projectId))].map(pj => `<div class="pmo-extgrp">${esc((store.get('project', pj) || {}).name || 'Another project')}</div>${ext.filter(o => o.projectId === pj).map(depRow).join('')}`).join('')}</div></details>` : ''}
      <div class="hint">FS: starts after it finishes. SS: starts after it starts. FF: finishes after it finishes. Lag adds days (negative overlaps). External items belong to other projects; their dates drive this one.</div>` : '<div class="hint">No other work items to depend on.</div>'}
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
  const stPick = statusesOf(j).find(x => x.id === f.status) || statusOf(w, j);
  const next = Object.assign({}, w, { title: (f.title || '').trim(), owner: f.owner, kind: f.kind, start: f.start, due: f.due, status: stPick.maps, statusId: stPick.id, deps, pid: pid || w.pid, step: step || w.step, projectId: j.id, effortDays: eff });
  const cfErr = readCustomFields(j, f, next);
  if (cfErr) return editWork(j, next, cfErr);
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
    await psave('workItem', next.id, next, `Added work item “${next.title}” to step “${stepTitle(next.pid, next.step)}”`);
    toast('Work item added');
    return;
  }
  const ch = [];
  if (prev.title !== next.title) ch.push(`renamed from “${prev.title}”`);
  if (prev.status !== next.status || statusOf(prev, j).id !== statusOf(next, j).id) ch.push(`status ${statusName(prev, j)} → ${statusName(next, j)}`);
  fieldsOf(j).forEach(fd => { if (fieldVal(prev, fd) !== fieldVal(next, fd)) ch.push(`${fd.label} ${fieldVal(prev, fd) || '—'} → ${fieldVal(next, fd) || '—'}`); });
  if (prev.owner !== next.owner) ch.push(`owner ${pname(prev.owner)} → ${pname(next.owner)}`);
  if (prev.start !== next.start) ch.push(`start ${fmt(prev.start)} → ${fmt(next.start)}`);
  if (prev.due !== next.due) ch.push(`due ${fmt(prev.due)} → ${fmt(next.due)}`);
  if (effortOf(prev) !== next.effortDays) ch.push(`effort ${fmtEffort(effortOf(prev))} → ${fmtEffort(next.effortDays)}`);
  if ((prev.kind || '') !== next.kind) ch.push(`kind ${KIND_LBL[next.kind] || next.kind}`);
  if (prev.pid !== next.pid || prev.step !== next.step) ch.push(`moved to step “${stepTitle(next.pid, next.step)}”`);
  if ((prev.resolves || '') !== (next.resolves || '')) ch.push(next.resolves ? `now resolves ${dataName(next.resolves)}` : 'no longer resolves data');
  const pa = new Map((prev.deps || []).map(depNorm).map(d => [d.id, d])), pb = new Map(next.deps.map(depNorm).map(d => [d.id, d]));
  const t = id => { const x = store.get('workItem', id); return x ? x.title + (x.projectId !== j.id ? ' (external)' : '') : id; };
  const dl = d => { const l = depLabel(d); return l ? ` (${l})` : ''; };
  const added = [...pb.values()].filter(x => !pa.has(x.id)), removed = [...pa.values()].filter(x => !pb.has(x.id));
  const retyped = [...pb.values()].filter(x => pa.has(x.id) && (pa.get(x.id).type !== x.type || pa.get(x.id).lag !== x.lag));
  if (added.length) ch.push(`now after ${added.map(d => t(d.id) + dl(d)).join(', ')}`);
  if (removed.length) ch.push(`no longer after ${removed.map(d => t(d.id)).join(', ')}`);
  retyped.forEach(d => ch.push(`dependency on ${t(d.id)} now ${d.type}${d.lag ? (d.lag > 0 ? ' +' : ' ') + d.lag + 'd lag' : ', no lag'}`));
  if (!ch.length) { toast('No changes'); return; }
  await psave('workItem', next.id, next, `Edited “${next.title}”: ${ch.join('; ')}`);
  toast('Work item saved');
}
async function deleteWork(j, w) {
  if (!canEditWork(w, j)) { toast(lockTitle(w, j)); return; }
  const deps = projectItems(j.id).filter(x => (x.deps || []).some(d => depId(d) === w.id));
  const r = await modal({ title: 'Delete work item?', body: `<p style="margin:0">Delete <b>${esc(w.title)}</b>? This can’t be undone.</p>${deps.length ? `<div class="note">${deps.length} item${deps.length > 1 ? 's depend' : ' depends'} on it (${deps.map(d => esc(d.title)).join(', ')}). The dependency will be removed from ${deps.length > 1 ? 'them' : 'it'}.</div>` : ''}`, actions: [{ id: 'delete', label: 'Delete', danger: true }] });
  if (r.action !== 'delete') return;
  await premove('workItem', w.id, `Deleted work item “${w.title}” from ${j.name}`);
  for (const d of deps) await psave('workItem', d.id, Object.assign({}, d, { deps: (d.deps || []).filter(x => depId(x) !== w.id), updatedAt: stamp() }), `Removed dependency of “${d.title}” on deleted “${w.title}”`);
  /* drop the deleted item from any risk links */
  for (const rk of store.list('risk', x => (x.workItems || []).includes(w.id))) await psave('risk', rk.id, Object.assign({}, rk, { workItems: rk.workItems.filter(x => x !== w.id) }), `Unlinked deleted work item “${w.title}” from risk “${rk.title}”`);
  toast('Work item deleted');
}
/* Status changes take a custom status id (or a raw idle|prog|done), store statusId + the engine mapping, and handle doneAt. */
async function setStatus(j, id, statusKey) {
  const w = store.get('workItem', id); if (!w) return;
  const ss = statusesOf(j);
  const st = ss.find(x => x.id === statusKey) || ss.find(x => x.maps === statusKey);
  if (!st) return;
  const prevSt = statusOf(w, j);
  if (prevSt.id === st.id && w.status === st.maps) return;
  if (!canEditWork(w, j)) { toast(lockTitle(w, j)); rerender(); return; }
  const next = applyDone(w, Object.assign({}, w, { status: st.maps, statusId: st.id, updatedAt: stamp() }));
  await psave('workItem', id, next, `“${w.title}”: ${prevSt.name} → ${st.name}${st.maps === 'done' && w.status !== 'done' ? ' (finished ' + fmt(next.doneAt) + ')' : ''}`);
  toast(`Marked ${st.name.toLowerCase()}`);
}
async function linkProcess(j) {
  if (!isPM(j)) { toast(pmOnly(j, 'link processes')); return; }
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
  await psave('project', j.id, Object.assign({}, j, { processes: order }), parts.join('; ').replace(/^./, c => c.toUpperCase()));
  toast('Processes updated');
}
async function saveBaseline(j) {
  if (!isPM(j)) { toast(pmOnly(j, 'save a baseline')); return; }
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
  await psave('project', j.id, Object.assign({}, j, { baselines: [...(j.baselines || []), bl] }), `Saved baseline “${label}” (${items.length} work items)`);
  toast('Baseline saved');
}
/* Suggest work (R3): map order, each suggestion with owner, effort, start/due and deps, all editable before creating.
   Anyone can preview; only the project manager can create. */
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
      <details class="pmo-sg-deps"><summary>After: ${depNames.length ? esc(depNames.join(', ')) : '<span class="badge b-ok" data-sg-now>Can start now</span>'}</summary>
        <div class="pmo-checks">${opts || '<span class="hint">No other work to depend on.</span>'}</div></details></div>`;
  };
  const ai = String(meta.source).toLowerCase() === 'ai';
  return `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pmo-src ${ai ? 'ai' : ''}">${ai ? '✦ AI' : 'Rules'}</span><span class="hint">${ai ? 'Generated by AI from the project facts. Review before adding.' : 'One item per new or changed step or gateway without work, plus a resolver for each data element without a live source. In map order.'}</span></div>
    ${meta.note ? `<div class="note">${esc(meta.note)}</div>` : ''}
    ${ro ? `<div class="banner pmo-ro-note" style="margin:0">Only <b>${esc(pname(j.owner))}</b> (project manager) can create work from suggestions. Switch “Viewing as” to ${esc(pname(j.owner).split(' ')[0])} to create them.</div>` : ''}
    ${(() => { const st = minDate(items.map(x => x.start)), en = maxDate(items.map(x => x.due)), now = items.filter(x => !(x.deps || []).length).length;
      return `<div class="pmo-sg-sum" data-sg-spread><span>Spread <b>${esc(fmt(st))} → ${esc(fmt(en))}</b></span><span>target <b>${esc(fmt(j.target))}</b>${en && j.target ? (en <= j.target ? ` · ${dayDiff(j.target, en)}d buffer` : ` · <span class="fail">${dayDiff(en, j.target)}d past target</span>`) : ''}</span><span><b>${now}</b> can start now</span><span><b>${items.reduce((a, x) => a + (x.deps || []).length, 0)}</b> dependencies</span></div>`; })()}
    <div class="pmo-sg-list">${items.map(row).join('')}</div>
    <div class="hint">Dates are business days (weekends skipped), spread from today toward the target ${esc(fmt(j.target))}. Each step’s work follows the previous step’s work in map order (finish → start) and waits for the resolvers of its data; items with nothing before them start today. Change a start date and the due date moves with it.</div>`;
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
  if (store.state.me !== j.owner) { toast(`Only ${pname(j.owner)} (project manager) can create work from suggestions`); return; }
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
    await psave('workItem', w.id, w, `Added suggested work “${w.title}” for ${pname(w.owner)}, ${fmt(w.start)} – ${fmt(w.due)}, ${fmtEffort(w.effortDays)} effort${deps.length ? ', after ' + deps.map(d => (store.get('workItem', d) || {}).title).filter(Boolean).join(', ') : ''} (${String(meta.source).toLowerCase() === 'ai' ? 'AI' : 'rules'} suggestion)`);
    n++;
  }
  toast(`Created ${n} work item${n > 1 ? 's' : ''}`);
}

/* Shared bits of the project modals (R5 roles + PMO fields). */
const peopleOpts = (sel, me) => store.state.people.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}${p.id === me ? ' (me)' : ''} — ${esc(p.role)}</option>`).join('');
const programs = () => [...new Set(store.list('project').map(p => String(p.program || '').trim()).filter(Boolean))].sort();
function pmoFields(v) {
  return `<div class="frow"><div class="field"><label for="pf-program">Program</label><input id="pf-program" name="program" maxlength="60" list="pf-programs" value="${esc(v.program || '')}" placeholder="e.g. Finance Transformation" /><datalist id="pf-programs">${programs().map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist></div>
      <div class="field"><label for="pf-budget">Planned budget (USD)</label><input id="pf-budget" type="number" name="budget" min="0" step="500" value="${esc(v.budget != null && v.budget !== '' ? v.budget : '')}" placeholder="e.g. 60000" /></div></div>`;
}
function roleFields(v, me) {
  return `<div class="frow"><div class="field"><label for="pf-pm">Project manager</label><select id="pf-pm" name="owner">${peopleOpts(v.owner, me)}</select><div class="hint">Edits the plan, cutover and release manager.</div></div>
      <div class="field"><label for="pf-rm">Release manager</label><select id="pf-rm" name="releaseManager"><option value="" ${v.releaseManager ? '' : 'selected'}>Same as the project manager</option>${peopleOpts(v.releaseManager, me)}</select><div class="hint">The only person who can go live or roll back.</div></div></div>`;
}
const budgetOf = v => { const n = Number(v); return v === '' || v == null || !isFinite(n) ? null : n; };

/* "+ New project" (R3/R5), used by home and portfolio. Creates the project and opens it. */
export async function newProject(prefill, err) {
  const me = store.state.me;
  const v = Object.assign({ name: '', desc: '', target: defaultTarget(), owner: me, releaseManager: '', program: '', budget: '', resources: me ? [me] : [], processes: [] }, prefill || {});
  const procs = store.list('process');
  const body = `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}
    <div class="field"><label for="np-name">Name</label><input id="np-name" name="name" maxlength="100" value="${esc(v.name)}" placeholder="e.g. Supplier Payments Uplift" /></div>
    <div class="field"><label for="np-desc">Description</label><textarea id="np-desc" name="desc" maxlength="600" placeholder="What changes, and why it matters">${esc(v.desc)}</textarea></div>
    <div class="field"><label for="np-target">Target go-live</label><input id="np-target" type="date" name="target" value="${esc(v.target)}" /><div class="hint">Defaults to the first business day 60 days out.</div></div>
    ${roleFields(v, me)}
    ${pmoFields(v)}
    <div class="field"><label>Resources</label><div class="pmo-checks pmo-np-people">${store.state.people.map(p => `<label><input type="checkbox" name="resources" value="${esc(p.id)}" ${(v.resources || []).includes(p.id) ? 'checked' : ''}/> <span>${av(p.id)} ${esc(p.name)} <small>${esc(p.role)}</small></span></label>`).join('')}</div><div class="hint">The project manager and release manager are always on the team.</div></div>
    <div class="field"><label>Processes to link</label>${procs.length ? `<div class="pmo-checks">${procs.map(p => { const c = diffCounts(p); return `<label><input type="checkbox" name="processes" value="${esc(p.id)}" ${(v.processes || []).includes(p.id) ? 'checked' : ''}/> <span><b>${esc(p.name)}</b><br/><small>${flatSteps(p.tobe).length} to-be steps · ${c.new} new + ${c.changed} changed</small></span></label>`; }).join('')}</div>
      <div class="hint">The new and changed steps of linked processes are what the project delivers. You can link more later.</div>` : '<div class="hint">No processes yet. Create a workflow first, or link one later.</div>'}</div>`;
  const r = await modal({ title: 'New project', body, actions: [{ id: 'create', label: 'Create project', primary: true }] });
  if (r.action !== 'create') return null;
  const f = r.form;
  const next = { name: (f.name || '').trim(), desc: (f.desc || '').trim(), target: f.target, owner: f.owner || me, releaseManager: f.releaseManager || '', program: (f.program || '').trim(), budget: f.budget, resources: f.resources || [], processes: f.processes || [] };
  if (!next.name) return newProject(next, 'Give the project a name.');
  if (!next.target) return newProject(next, 'Set a target go-live date.');
  const bud = budgetOf(next.budget);
  if (next.budget !== '' && next.budget != null && !(bud >= 0)) return newProject(next, 'The planned budget must be zero or more.');
  if (store.list('project', p => p.name.trim().toLowerCase() === next.name.toLowerCase()).length) return newProject(next, `A project called “${next.name}” already exists.`);
  const rm = next.releaseManager || next.owner; /* R5: defaults to the PM */
  [rm, next.owner].forEach(x => { if (!next.resources.includes(x)) next.resources.unshift(x); }); /* both are always on the team */
  const id = store.newId('prj');
  const data = { id, name: next.name, desc: next.desc, owner: next.owner, releaseManager: rm, resources: next.resources, target: next.target, processes: next.processes, status: 'active', baselines: [] };
  if (next.program) data.program = next.program;
  if (bud != null) data.budget = { planned: bud };
  await psave('project', id, data, `Created project “${data.name}” (PM ${pname(data.owner)}, release manager ${pname(rm)}, target ${fmt(data.target)}${data.program ? ', program ' + data.program : ''}${bud != null ? ', budget ' + money(bud) : ''}, ${data.processes.length} linked process${data.processes.length === 1 ? '' : 'es'})`);
  toast('Project created');
  go('/project/' + id);
  return data;
}

/* R5 project settings: the PM edits name, target, roles, program and budget. The server rejects role changes from anyone else. */
async function editSettings(j, err, prefill) {
  if (!isPM(j)) { toast(pmOnly(j, 'change project settings')); return; }
  const v = Object.assign({ name: j.name, desc: j.desc || '', target: j.target, owner: j.owner, releaseManager: j.releaseManager && j.releaseManager !== j.owner ? j.releaseManager : '', program: j.program || '', budget: j.budget && j.budget.planned != null ? j.budget.planned : '' }, prefill || {});
  const fin = financials(j);
  const body = `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}
    <div class="field"><label for="ps-name">Name</label><input id="ps-name" name="name" maxlength="100" value="${esc(v.name)}" /></div>
    <div class="field"><label for="ps-desc">Description</label><textarea id="ps-desc" name="desc" maxlength="600">${esc(v.desc)}</textarea></div>
    <div class="field"><label for="ps-target">Target go-live</label><input id="ps-target" type="date" name="target" value="${esc(v.target || '')}" /></div>
    ${roleFields(v, store.state.me)}
    ${pmoFields(v)}
    <div class="hint" data-set-fin>Forecast cost ${esc(money(fin.forecast))} · actual ${esc(money(fin.actual))} so far (effort × each owner’s day rate; edit rates in Portfolio › Workload).</div>`;
  const r = await modal({ title: 'Project settings', body, actions: [{ id: 'save', label: 'Save settings', primary: true }] });
  if (r.action !== 'save') return;
  const f = r.form;
  const cur = store.get('project', j.id) || j;
  const vals = { name: (f.name || '').trim(), desc: (f.desc || '').trim(), target: f.target, owner: f.owner || cur.owner, releaseManager: f.releaseManager || '', program: (f.program || '').trim(), budget: f.budget };
  if (!vals.name) return editSettings(cur, 'Give the project a name.', vals);
  if (!vals.target) return editSettings(cur, 'Set a target go-live date.', vals);
  const bud = budgetOf(vals.budget);
  if (vals.budget !== '' && vals.budget != null && !(bud >= 0)) return editSettings(cur, 'The planned budget must be zero or more.', vals);
  if (store.list('project', p => p.id !== cur.id && p.name.trim().toLowerCase() === vals.name.toLowerCase()).length) return editSettings(cur, `A project called “${vals.name}” already exists.`, vals);
  const rm = vals.releaseManager || vals.owner;
  const next = Object.assign({}, cur, { name: vals.name, desc: vals.desc, target: vals.target, owner: vals.owner, releaseManager: rm });
  if (vals.program) next.program = vals.program; else delete next.program;
  if (bud != null) next.budget = Object.assign({}, cur.budget || {}, { planned: bud }); else delete next.budget;
  next.resources = [...(cur.resources || [])]; [rm, vals.owner].forEach(x => { if (!next.resources.includes(x)) next.resources.unshift(x); });
  const ch = [];
  if (cur.name !== next.name) ch.push(`renamed from “${cur.name}”`);
  if ((cur.desc || '') !== next.desc) ch.push('description updated');
  if (cur.target !== next.target) ch.push(`target ${fmt(cur.target)} → ${fmt(next.target)}`);
  if (cur.owner !== next.owner) ch.push(`project manager ${pname(cur.owner)} → ${pname(next.owner)}`);
  if (relMgr(cur) !== rm) ch.push(`release manager ${pname(relMgr(cur))} → ${pname(rm)}`);
  if ((cur.program || '') !== (next.program || '')) ch.push(next.program ? `program “${next.program}”` : 'removed from its program');
  const pb = cur.budget && cur.budget.planned != null ? cur.budget.planned : null;
  if (pb !== bud) ch.push(bud != null ? `planned budget ${pb != null ? money(pb) + ' → ' : ''}${money(bud)}` : 'planned budget cleared');
  if (!ch.length) { toast('No changes'); return; }
  await psave('project', cur.id, next, `Project settings: ${ch.join('; ')}`);
  toast('Settings saved');
}

/* ---------------------------------------------------------------- R6: statuses & custom fields (PM) */
const MAPS_LBL = { idle: 'Not started (counts as idle)', prog: 'Under way (counts as in progress)', done: 'Finished (counts as done)' };
const keyOf = (label, taken) => { let k = String(label).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+(.)?/g, (m, c) => c ? c.toUpperCase() : '').replace(/^[^A-Za-z]+/, ''); k = (k.charAt(0).toLowerCase() + k.slice(1)).slice(0, 30) || 'field'; let out = k, n = 2; while (taken.has(out)) out = k + n++; return out; };
function statusRow(x, i) {
  return `<div class="pmo-cz-row" data-st-row><input type="hidden" data-k="id" value="${esc(x.id || '')}" />
    <input data-k="name" maxlength="30" value="${esc(x.name || '')}" aria-label="Status name ${i + 1}" placeholder="Status name" />
    <select data-k="maps" aria-label="What status ${i + 1} means for forecasts">${MAPS.map(m => `<option value="${m}" ${x.maps === m ? 'selected' : ''}>${esc(MAPS_LBL[m])}</option>`).join('')}</select>
    <span class="pmo-cz-btns"><button type="button" class="btn sm" data-cz-up aria-label="Move status up">↑</button><button type="button" class="btn sm" data-cz-down aria-label="Move status down">↓</button><button type="button" class="btn sm danger" data-cz-del aria-label="Remove status">✕</button></span></div>`;
}
function fieldRow(x, i) {
  return `<div class="pmo-cz-row" data-fd-row><input type="hidden" data-k="key" value="${esc(x.key || '')}" />
    <input data-k="label" maxlength="30" value="${esc(x.label || '')}" aria-label="Field label ${i + 1}" placeholder="Field label" />
    <select data-k="type" aria-label="Field type ${i + 1}">${[['text', 'Text'], ['number', 'Number'], ['select', 'Pick list']].map(([k, l]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input data-k="options" maxlength="300" value="${esc((x.options || []).join(', '))}" aria-label="Options for field ${i + 1}, comma separated" placeholder="Options, comma separated" ${x.type === 'select' ? '' : 'hidden'} />
    <span class="pmo-cz-btns"><button type="button" class="btn sm danger" data-cz-del aria-label="Remove field">✕</button></span></div>`;
}
async function customize(j, err, draft) {
  if (!isPM(j)) { toast(pmOnly(j, 'change statuses and fields')); return; }
  const sts = draft ? draft.statuses : statusesOf(j), fds = draft ? draft.fields : fieldsOf(j);
  const body = `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}
    <div class="pmo-cz-sec"><h4>Statuses <span class="hint">Board columns, in order. Each one tells forecasts whether the work is not started, under way or finished.</span></h4>
      <div class="pmo-cz-list" data-st-list>${sts.map(statusRow).join('')}</div><button type="button" class="btn sm" data-cz-add-st>+ Add status</button></div>
    <div class="pmo-cz-sec"><h4>Custom fields <span class="hint">Edited on each work item, filterable, and shown as tags on board cards.</span></h4>
      <div class="pmo-cz-list" data-fd-list>${fds.map(fieldRow).join('') || ''}</div><button type="button" class="btn sm" data-cz-add-fd>+ Add field</button></div>`;
  const pending = modal({ title: 'Statuses & fields', body, actions: [{ id: 'save', label: 'Save', primary: true }] });
  const ov = [...document.querySelectorAll('.overlay')].pop();
  if (ov) {
    ov.querySelector('.modal').classList.add('pmo-wide');
    ov.addEventListener('click', e => {
      const b = e.target.closest('button[type="button"]'); if (!b) return;
      const row = b.closest('.pmo-cz-row');
      if (b.matches('[data-cz-up]') && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
      else if (b.matches('[data-cz-down]') && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
      else if (b.matches('[data-cz-del]')) row.remove();
      else if (b.matches('[data-cz-add-st]')) { ov.querySelector('[data-st-list]').insertAdjacentHTML('beforeend', statusRow({ name: '', maps: 'prog' }, ov.querySelectorAll('[data-st-row]').length)); ov.querySelector('[data-st-row]:last-child [data-k="name"]').focus(); }
      else if (b.matches('[data-cz-add-fd]')) { ov.querySelector('[data-fd-list]').insertAdjacentHTML('beforeend', fieldRow({ label: '', type: 'text' }, ov.querySelectorAll('[data-fd-row]').length)); ov.querySelector('[data-fd-row]:last-child [data-k="label"]').focus(); }
    });
    ov.addEventListener('change', e => { if (e.target.matches('[data-fd-row] [data-k="type"]')) e.target.closest('[data-fd-row]').querySelector('[data-k="options"]').hidden = e.target.value !== 'select'; });
  }
  const r = await pending;
  if (r.action !== 'save') return;
  const val = (row, k) => { const el = row.querySelector(`[data-k="${k}"]`); return el ? String(el.value).trim() : ''; };
  const nStat = [...r.root.querySelectorAll('[data-st-row]')].map(row => ({ id: val(row, 'id'), name: val(row, 'name'), maps: val(row, 'maps') }));
  const nFld = [...r.root.querySelectorAll('[data-fd-row]')].map(row => ({ key: val(row, 'key'), label: val(row, 'label'), type: val(row, 'type'), options: val(row, 'options').split(',').map(x => x.trim()).filter(Boolean) }));
  const d = { statuses: nStat, fields: nFld };
  if (nStat.length < 2) return customize(j, 'Keep at least two statuses.', d);
  if (nStat.some(x => !x.name)) return customize(j, 'Every status needs a name.', d);
  if (new Set(nStat.map(x => x.name.toLowerCase())).size !== nStat.length) return customize(j, 'Status names must be different.', d);
  if (!nStat.some(x => x.maps === 'idle') || !nStat.some(x => x.maps === 'done')) return customize(j, 'Keep at least one “not started” status and one “finished” status.', d);
  if (nFld.some(x => !x.label)) return customize(j, 'Every custom field needs a label.', d);
  if (new Set(nFld.map(x => x.label.toLowerCase())).size !== nFld.length) return customize(j, 'Custom field labels must be different.', d);
  const badSel = nFld.find(x => x.type === 'select' && !x.options.length); if (badSel) return customize(j, `Give “${badSel.label}” at least one option.`, d);
  const takenS = new Set(nStat.map(x => x.id).filter(Boolean));
  nStat.forEach(x => { if (!x.id) { x.id = keyOf(x.name, takenS); takenS.add(x.id); } });
  const takenF = new Set(nFld.map(x => x.key).filter(Boolean));
  nFld.forEach(x => { if (!x.key) { x.key = keyOf(x.label, takenF); takenF.add(x.key); } if (x.type !== 'select') delete x.options; });
  const cur = store.get('project', j.id) || j;
  const before = statusesOf(cur), beforeF = fieldsOf(cur);
  const ch = [];
  const sNames = a => a.map(x => `${x.name} (${x.maps})`).join(', ');
  if (sNames(before) !== sNames(nStat)) ch.push(`statuses ${nStat.map(x => x.name).join(' → ')}`);
  const fNames = a => a.map(x => `${x.label}:${x.type}:${(x.options || []).join('|')}`).join(',');
  if (fNames(beforeF) !== fNames(nFld)) ch.push(nFld.length ? `custom fields ${nFld.map(x => x.label).join(', ')}` : 'custom fields removed');
  if (!ch.length) { toast('No changes'); return; }
  const next = Object.assign({}, cur, { statuses: nStat });
  if (nFld.length) next.fields = nFld; else delete next.fields;
  await psave('project', j.id, next, `Board settings: ${ch.join('; ')}`);
  /* a status whose meaning changed carries its items with it (status + doneAt follow the new mapping) */
  for (const w of projectItems(j.id)) {
    const st = w.statusId && nStat.find(x => x.id === w.statusId);
    if (st && st.maps !== w.status) await psave('workItem', w.id, applyDone(w, Object.assign({}, w, { status: st.maps, updatedAt: stamp() })), `“${w.title}”: status “${st.name}” now counts as ${STATUS_LBL[st.maps].toLowerCase()}`);
  }
  toast('Statuses and fields saved');
}

/* ---------------------------------------------------------------- R6: capacity leveling (preview → apply) */
/* E().levelResources(docs, prj, today) -> proposed shifts so nobody exceeds capacity in any week. Normalised to
   {moves: [{w, start, due}], before: [overload], after: [overload]} where overload = {person, week, load, cap}. */
function levelPlan(j) {
  const r = eng('levelResources', null, docs(), j.id, today());
  if (!r) return null;
  let mv = r.moves || r.shifts || r.proposal || r.changes || (Array.isArray(r) ? r : null);
  const list = [];
  if (Array.isArray(mv)) mv.forEach(x => { if (x && (x.workId || x.id)) list.push([x.workId || x.id, x]); });
  else if (mv && typeof mv === 'object') Object.entries(mv).forEach(([id, x]) => list.push([id, x]));
  const moves = list.map(([id, v]) => ({ w: store.get('workItem', id), start: v.start || (v.to && v.to.start), due: v.due || (v.to && v.to.due) }))
    .filter(x => x.w && x.w.projectId === j.id && x.w.status !== 'done' && x.start && x.due && (x.start !== x.w.start || x.due !== x.w.due))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const ov = arr => (Array.isArray(arr) ? arr : []).map(o => ({ person: o.person || o.personId || o.owner, week: o.week || o.weekStart || o.start, load: Number(o.load != null ? o.load : o.effort != null ? o.effort : o.days), cap: Number(o.cap != null ? o.cap : o.capacity) })).filter(o => o.person);
  return { moves, before: ov(r.before || r.overloadsBefore || r.overloads), after: ov(r.after || r.overloadsAfter || r.remaining), notes: (Array.isArray(r.notes) ? r.notes : r.note ? [r.note] : []).map(reasonText).filter(Boolean) };
}
const ovLine = o => `${esc(pname(o.person))}${o.week ? ` · week of ${esc(fmt(o.week))}` : ''}${isFinite(o.load) ? `: ${esc(fmtEffort(o.load))}${isFinite(o.cap) ? ` / ${esc(fmtEffort(o.cap))}` : ''}` : ''}`;
async function levelResources(j) {
  const plan = levelPlan(j);
  const pm = isPM(j);
  if (!plan) { await modal({ title: 'Level resources', body: '<p style="margin:0">Leveling isn’t available right now.</p>', actions: [{ id: 'ok', label: 'OK', primary: true }] }); return; }
  const { moves, before, after } = plan;
  const ovList = (arr, cls) => arr.length ? `<ul class="pmo-ovl ${cls}">${arr.slice(0, 8).map(o => `<li>${ovLine(o)}</li>`).join('')}${arr.length > 8 ? `<li class="hint">+${arr.length - 8} more</li>` : ''}</ul>` : '<div class="hint">None</div>';
  const rows = moves.map(({ w, start, due }) => { const dd = dayDiff(start, w.start || w.due);
    return `<tr data-lv-row="${esc(w.id)}"><td><b>${esc(w.title)}</b><div class="hint">${esc(pname(w.owner))}</div></td><td class="pmo-nowrap">${esc(fmt(w.start))} – ${esc(fmt(w.due))}</td><td class="pmo-nowrap"><b>${esc(fmt(start))} – ${esc(fmt(due))}</b></td><td class="pmo-nowrap"><span class="pmo-var ${dd > 0 ? 'up' : dd < 0 ? 'down' : ''}">${dd > 0 ? '+' : ''}${dd}d</span></td></tr>`; }).join('');
  const body = `<p class="hint" style="margin:0">Shifts work so nobody is over capacity in any week, keeping dependencies and durations. Nothing changes until you apply.</p>
    ${pm ? '' : `<div class="banner pmo-ro-note" style="margin:0">${esc(pmOnly(j, 'apply leveling'))}.</div>`}
    <div class="pmo-lv-cmp" data-lv-compare><div><h4>Overloads now <span class="n" data-lv-before>${before.length}</span></h4>${ovList(before, 'before')}</div><div><h4>After leveling <span class="n" data-lv-after>${after.length}</span></h4>${ovList(after, 'after')}</div></div>
    ${plan.notes.length ? `<div class="hint">${plan.notes.map(esc).join(' · ')}</div>` : ''}
    ${moves.length ? `<div class="tbl-wrap"><table class="pmo-astable" data-lv-table><thead><tr><th>Work item</th><th>Before</th><th>After</th><th>Shift</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p style="margin:0" data-lv-none>${before.length ? 'No shift inside the plan removes these overloads. Consider reassigning work or raising capacity.' : 'Nobody is over capacity, so nothing needs to move.'}</p>`}`;
  const pending = modal({ title: `Level resources${moves.length ? `: ${moves.length} shift${moves.length === 1 ? '' : 's'}` : ''}`, body, actions: pm && moves.length ? [{ id: 'apply', label: `Apply ${moves.length} shift${moves.length === 1 ? '' : 's'}`, primary: true }] : [] });
  const ov = [...document.querySelectorAll('.overlay')].pop(); if (ov) ov.querySelector('.modal').classList.add('pmo-wide');
  const r = await pending;
  if (r.action !== 'apply' || !isPM(store.get('project', j.id))) return;
  for (const { w, start, due } of moves) {
    const cur = store.get('workItem', w.id) || w;
    await psave('workItem', w.id, Object.assign({}, cur, { start, due, updatedAt: stamp() }), `Leveled “${w.title}”: ${fmt(cur.start)} – ${fmt(cur.due)} → ${fmt(start)} – ${fmt(due)} (capacity)`);
  }
  toast(`Applied ${moves.length} shift${moves.length === 1 ? '' : 's'}`);
}

/* ---------------------------------------------------------------- R6: what-if scenario actions */
function scenURL(j, scId, f) { const u = new URL(link(prjURL(j.id, 'timeline', f)), location.origin); if (scId) u.searchParams.set('sc', scId); return u.pathname + u.search; }
async function newScenario(j, f, err, name) {
  if (!isPM(j)) { toast(pmOnly(j, 'create scenarios')); return; }
  const n = scenariosOf(j).length + 1;
  const r = await modal({ title: 'New what-if scenario', body: `${err ? `<div class="banner" style="margin:0">${esc(err)}</div>` : ''}<p class="hint" style="margin:0">Copies today’s plan dates into a scenario. Drag freely in it, compare finish and cost against the plan, then apply or discard. The live plan doesn’t change until you apply.</p>
    <div class="field"><label for="sc-name">Scenario name</label><input id="sc-name" name="name" maxlength="60" value="${esc(name != null ? name : 'Scenario ' + n)}" /></div>`, actions: [{ id: 'create', label: 'Create scenario', primary: true }] });
  if (r.action !== 'create') return;
  const nm = String(r.form.name || '').trim();
  if (!nm) return newScenario(j, f, 'Give the scenario a name.', nm);
  const cur = store.get('project', j.id) || j;
  if (scenariosOf(cur).some(x => x.name.toLowerCase() === nm.toLowerCase())) return newScenario(j, f, `A scenario called “${nm}” already exists.`, nm);
  const dates = {}; projectItems(j.id).forEach(w => { dates[w.id] = { start: w.start || w.due, due: w.due }; });
  const sc = { id: store.newId('sc'), name: nm, dates, by: store.state.me, at: stamp() };
  history.replaceState({}, '', scenURL(j, sc.id, f));
  await psave('project', j.id, Object.assign({}, cur, { scenarios: [...scenariosOf(cur), sc] }), `Created what-if scenario “${nm}” from the plan (${Object.keys(dates).length} items)`);
  toast('Scenario created: the live plan is unchanged');
}
async function applyScenario(j, sc, f) {
  if (!isPM(j)) { toast(pmOnly(j, 'apply a scenario')); return; }
  const ch = scenarioChanges(j, sc);
  const r = await modal({ title: `Apply “${sc.name}”?`, body: `<p style="margin:0">Moves ${ch.length} work item${ch.length === 1 ? '' : 's'} in the live plan to the scenario’s dates, then removes the scenario.</p><ul class="pmo-ovl">${ch.slice(0, 10).map(({ w, s }) => `<li>${esc(w.title)}: ${esc(fmt(w.start))} – ${esc(fmt(w.due))} → <b>${esc(fmt(s.start))} – ${esc(fmt(s.due))}</b></li>`).join('')}${ch.length > 10 ? `<li class="hint">+${ch.length - 10} more</li>` : ''}</ul>`, actions: [{ id: 'apply', label: 'Apply to plan', primary: true }] });
  if (r.action !== 'apply') return;
  for (const { w, s } of ch) {
    const cur = store.get('workItem', w.id) || w;
    await psave('workItem', w.id, Object.assign({}, cur, { start: s.start, due: s.due, updatedAt: stamp() }), `Applied scenario “${sc.name}” to “${w.title}”: ${fmt(cur.start)} – ${fmt(cur.due)} → ${fmt(s.start)} – ${fmt(s.due)}`);
  }
  const pj = store.get('project', j.id) || j;
  history.replaceState({}, '', scenURL(j, null, f));
  await psave('project', j.id, Object.assign({}, pj, { scenarios: scenariosOf(pj).filter(x => x.id !== sc.id) }), `Applied what-if scenario “${sc.name}” (${ch.length} item${ch.length === 1 ? '' : 's'} moved)`);
  toast(`Scenario applied: ${ch.length} item${ch.length === 1 ? '' : 's'} moved`);
}
async function discardScenario(j, sc, f) {
  if (!isPM(j)) { toast(pmOnly(j, 'discard a scenario')); return; }
  const r = await modal({ title: `Discard “${sc.name}”?`, body: '<p style="margin:0">The scenario is deleted. The live plan is not affected.</p>', actions: [{ id: 'discard', label: 'Discard', danger: true }] });
  if (r.action !== 'discard') return;
  const cur = store.get('project', j.id) || j;
  history.replaceState({}, '', scenURL(j, null, f));
  await psave('project', j.id, Object.assign({}, cur, { scenarios: scenariosOf(cur).filter(x => x.id !== sc.id) }), `Discarded what-if scenario “${sc.name}” (live plan unchanged)`);
  toast('Scenario discarded');
}

/* ---------------------------------------------------------------- R6: CSV export of work items */
export function workCSVRows(j, list) {
  const fc = forecasts(), flds = fieldsOf(j);
  const head = ['ID', 'Title', 'Process', 'Step', 'Owner', 'Status', 'Kind', 'Start', 'Due', 'Forecast', 'Schedule', 'Done on', 'Effort (days)', 'Hours logged', 'Resolves', 'Depends on', ...flds.map(f => f.label)];
  const rows = (list || projectItems(j.id)).slice().sort((a, b) => String(a.due).localeCompare(String(b.due))).map(w => {
    const f = fc[w.id] || {};
    return [w.id, w.title, procName(w.pid), stepTitle(w.pid, w.step), pname(w.owner), statusName(w, j), KIND_LBL[w.kind] || w.kind || '', w.start || '', w.due || '', w.status === 'done' ? (w.doneAt || w.due) : (f.forecast || w.due || ''),
      (BADGE[schedKey(w, fc)] || BADGE.ok)[1], w.doneAt || '', effortOf(w), Math.round(hoursOf(w) * 100) / 100, w.resolves ? dataName(w.resolves) : '',
      (w.deps || []).map(d => (store.get('workItem', depId(d)) || {}).title).filter(Boolean).join('; '), ...flds.map(fd => fieldVal(w, fd))];
  });
  return [head, ...rows];
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
  /* R4 views + filters */
  const mode = ['map', 'timeline', 'board', 'sprints', 'work'].includes(params.q && params.q.mode) ? params.q.mode : 'map';
  const fl = readFilters(params.q);
  const sc = mode === 'timeline' ? scenarioOf(j, params.q && params.q.sc) : null;
  bindTimeline(root, j, sc, sc ? scenarioDocs(sc) : null);
  /* R6: scenarios, leveling, statuses & fields, time, export */
  const sco = root.querySelector('[data-scen-open]'); if (sco) sco.addEventListener('change', () => { if (sco.value) { history.pushState({}, '', scenURL(j, sco.value, fl)); rerender(); } });
  on('[data-scen-new]', () => newScenario(cur(), fl));
  on('[data-scen-exit]', () => { history.pushState({}, '', scenURL(j, null, fl)); rerender(); });
  on('[data-scen-apply]', () => { const s2 = scenarioOf(cur(), sc && sc.id); if (s2) applyScenario(cur(), s2, fl); });
  on('[data-scen-discard]', () => { const s2 = scenarioOf(cur(), sc && sc.id); if (s2) discardScenario(cur(), s2, fl); });
  on('[data-level]', () => levelResources(cur()));
  on('[data-customize]', () => customize(cur()));
  on('[data-log-time]', el => { const w = store.get('workItem', el.dataset.logTime); if (w) logTime(cur(), w); });
  on('[data-export-work]', () => { const p = cur(); const n = downloadCSV(`${slug(p.name)}-work-items.csv`, workCSVRows(p, filterItems(projectItems(p.id), fl, forecasts()))); toast(`Exported ${n} work item${n === 1 ? '' : 's'} to CSV`); });
  const cft = root.querySelector('[data-cf-tags]'); if (cft) cft.addEventListener('change', () => { showFieldTags = cft.checked; try { localStorage.setItem('pmoflow.cardTags', showFieldTags ? '1' : '0'); } catch (e) { /* storage unavailable */ } rerender(); });
  bindFilters(root, j, mode, fl, params.q && params.q.view);
  bindWhyGlobal();
  bindCards(root, j);
  if (mode === 'board') bindDnD(root, '.pmo-col[data-col]', 'data-col', (id, st) => setStatus(cur(), id, st));
  if (mode === 'sprints') {
    bindDnD(root, '.pmo-spr[data-sprint]', 'data-sprint', (id, sp) => moveToSprint(cur(), id, sp));
    root.querySelectorAll('[data-sprint-pick]').forEach(el => el.addEventListener('change', () => { if (el.value) moveToSprint(cur(), el.dataset.sprintPick, el.value); }));
  }
  on('[data-plan-sprints]', () => planSprints(cur()));
  on('[data-settings]', () => editSettings(cur()));
  on('[data-autosched]', () => autoSchedule(cur()));
  const sb = root.querySelector('[data-sburn-pick]'); if (sb) sb.addEventListener('change', () => { sprintBurnPick[j.id] = sb.value; rerender(); });
  const actT = root.querySelector('[data-activity]'); if (actT) actT.addEventListener('toggle', () => { activityOpen = actT.open; });
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
