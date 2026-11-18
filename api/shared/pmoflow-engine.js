/* PMOFlow v3 engine (stream E). Canonical copy: api/shared/pmoflow-engine.js.
   web/public/concepts/pmoflow/app/engine.js MUST be byte-identical to this file.
   Pure functions only: no I/O, no clock. `today` is always passed in as YYYY-MM-DD.
   Inputs are never mutated. `docs` has the /state shape: {type: [{id, data}]}. */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.PMOEngine = f(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Document access                                                     */
  /* ------------------------------------------------------------------ */

  // Returns the data objects of one doc type. The entry id is authoritative;
  // when data.id is missing or differs, a shallow copy carrying the entry id is returned.
  function list(docs, type) {
    syncCalendar(docs);
    const arr = (docs && Array.isArray(docs[type])) ? docs[type] : [];
    const out = [];
    for (const e of arr) {
      if (!e) continue;
      const d = e.data || {};
      out.push(e.id == null || d.id === e.id ? d : Object.assign({}, d, { id: e.id }));
    }
    return out;
  }
  function byId(arr) { const m = {}; for (const x of arr) m[x.id] = x; return m; }
  function get(docs, type, id) { return list(docs, type).find(x => x.id === id) || null; }

  // People come from docs.person; docs.people (array or id-keyed map) is accepted as a fallback.
  function personList(docs) { const m = personMap(docs); return Object.keys(m).map(k => m[k]).filter(Boolean); }
  function personMap(docs) {
    const m = byId(list(docs, 'person'));
    const extra = docs && docs.people;
    if (Array.isArray(extra)) extra.forEach(p => { const d = p && (p.data || p); if (d && (d.id || p.id) && !m[d.id || p.id]) m[d.id || p.id] = d; });
    else if (extra && typeof extra === 'object') Object.keys(extra).forEach(k => { if (!m[k]) m[k] = Object.assign({ id: k }, extra[k]); });
    return m;
  }

  /* ------------------------------------------------------------------ */
  /* Dates (UTC, day precision)                                          */
  /* ------------------------------------------------------------------ */
  const DAY = 86400000;
  function toMs(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function isDate(s) { return !isNaN(toMs(s)); }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function addDays(s, n) { return iso(toMs(s) + n * DAY); }
  function diffDays(a, b) { return Math.round((toMs(a) - toMs(b)) / DAY); } // a - b, in days
  function maxDate(arr) { const v = arr.filter(isDate).map(s => String(s).slice(0, 10)).sort(); return v.length ? v[v.length - 1] : null; }
  function minDate(arr) { const v = arr.filter(isDate).map(s => String(s).slice(0, 10)).sort(); return v.length ? v[0] : null; }

  /* ------------------------------------------------------------------ */
  /* Process helpers                                                     */
  /* ------------------------------------------------------------------ */
  // A gateway is any node with `branches` (decision or parallel); both are traversed the same way.
  function isGateway(n) { return !!n && (Array.isArray(n.branches) || n.type === 'decision' || n.type === 'parallel'); }
  function isStep(n) { return !!n && !isGateway(n) && n.type !== 'trigger' && n.type !== 'end'; }

  // Steps only (no trigger/end/gateway), branch steps included, in map order.
  function flatSteps(nodes) {
    const out = [];
    (nodes || []).forEach(n => {
      if (!n) return;
      if (isGateway(n)) (n.branches || []).forEach(b => out.push(...flatSteps(b && b.nodes)));
      else if (isStep(n)) out.push(n);
    });
    return out;
  }
  // Gateways, nested ones included, in map order.
  function flatGateways(nodes) {
    const out = [];
    (nodes || []).forEach(n => {
      if (!isGateway(n)) return;
      out.push(n);
      (n.branches || []).forEach(b => out.push(...flatGateways(b && b.nodes)));
    });
    return out;
  }
  // Every node id (any type, any depth).
  function allNodeIds(nodes, set) {
    set = set || new Set();
    (nodes || []).forEach(n => { if (!n) return; if (n.id != null) set.add(n.id); (n.branches || []).forEach(b => allNodeIds(b && b.nodes, set)); });
    return set;
  }
  function stepData(s) {
    const set = new Set(s.data || []);
    (s.subs || []).forEach(x => (x && x.data || []).forEach(d => set.add(d)));
    return [...set];
  }
  function findStep(docs, pid, stepId) {
    const p = get(docs, 'process', pid);
    return p ? flatSteps(p.tobe).find(s => s.id === stepId) || null : null;
  }
  function linkedProcesses(docs, project) {
    const procs = byId(list(docs, 'process'));
    return (project && project.processes || []).map(pid => procs[pid]).filter(Boolean);
  }

  /* ------------------------------------------------------------------ */
  /* Diff                                                                */
  /* ------------------------------------------------------------------ */
  function textChange(label, a, b) {
    a = a == null ? '' : String(a); b = b == null ? '' : String(b);
    if (a === b) return null;
    if (!a) return label + ' added: ' + b;
    if (!b) return label + ' removed: ' + a;
    return label + ' "' + a + '" → "' + b + '"';
  }
  function setDiff(label, a, b) {
    const A = new Set(a || []), B = new Set(b || []);
    const out = [];
    const add = [...B].filter(x => !A.has(x)), rem = [...A].filter(x => !B.has(x));
    if (add.length) out.push(label + ' added: ' + add.join(', '));
    if (rem.length) out.push(label + ' removed: ' + rem.join(', '));
    return out;
  }
  // R9 §13: with `nm` (from namesFor(docs)) person and information ids read as names; empty reads "Nobody".
  function stepChanges(a, n, nm) {
    const ch = [];
    const pName = id => id ? (nm ? nm.person(id) : id) : (nm ? 'Nobody' : '(none)');
    const dNames = arr => (arr || []).map(id => nm ? nm.data(id) : id);
    const t = textChange('Title', a.title, n.title); if (t) ch.push(t);
    if ((a.owner || '') !== (n.owner || '') || (a.ownerRole || '') !== (n.ownerRole || ''))
      ch.push('Owner ' + (a.owner ? pName(a.owner) : a.ownerRole || pName(null)) + ' → ' + (n.owner ? pName(n.owner) : n.ownerRole || pName(null)));
    if (nm) setDiff('Information', dNames(stepData(a)), dNames(stepData(n))).forEach(x => ch.push(x));
    else setDiff('Data', a.data, n.data).forEach(x => ch.push(x));
    const s = textChange('SLA', a.sla, n.sla); if (s) ch.push(s);
    const y = textChange('System', a.system, n.system); if (y) ch.push(y);
    // R6 node types: subprocess {calls: processId}, wait {wait: text}, message {direction: send|receive, party}.
    if ((a.type || 'step') !== (n.type || 'step')) ch.push('Type ' + (a.type || 'step') + ' → ' + (n.type || 'step'));
    [['Calls', 'calls'], ['Wait', 'wait'], ['Message', 'direction'], ['Party', 'party']].forEach(([l, k]) => { const c = textChange(l, a[k], n[k]); if (c) ch.push(c); });
    // Sub-steps are compared only when the as-is step documents them (undefined = not decomposed).
    if (Array.isArray(a.subs)) {
      const at = a.subs.map(x => x && x.title || ''), nt = (n.subs || []).map(x => x && x.title || '');
      setDiff('Sub-steps', at, nt).forEach(x => ch.push(x));
      const am = {}; a.subs.forEach(x => { if (x) am[x.title || ''] = x; });
      (n.subs || []).forEach(x => {
        const o = x && am[x.title || ''];
        if (o) setDiff('Sub-step "' + x.title + '" ' + (nm ? 'information' : 'data'), nm ? dNames(o.data) : o.data, nm ? dNames(x.data) : x.data).forEach(c => ch.push(c));
      });
      if (!ch.some(c => c.startsWith('Sub-step')) && at.join('\u0000') !== nt.join('\u0000')) ch.push('Sub-steps reordered');
    }
    return ch;
  }
  function gatewayChanges(a, n) {
    const ch = [];
    if ((a.type || '') !== (n.type || '')) ch.push('Gateway type ' + (a.type || '(none)') + ' → ' + (n.type || '(none)'));
    const t = textChange('Title', a.title, n.title); if (t) ch.push(t);
    const lab = g => (g.branches || []).map(b => b && b.label || '');
    setDiff('Branches', lab(a), lab(n)).forEach(x => ch.push(x));
    const gt = g => (g.branches || []).filter(b => b && b.goto).map(b => (b.label || '') + ' ↺ ' + b.goto);
    setDiff('Loop-backs', gt(a), gt(n)).forEach(x => ch.push(x));
    return ch;
  }

  // Classifies to-be steps AND gateways (trigger/end ignored). Gateways match as-is gateways via `from`.
  // R9 §13 id → name resolvers for history and diff text (person ids → names, information ids → names).
  function namesFor(docs) {
    const people = personMap(docs), data = byId(list(docs, 'dataElement'));
    return { person: id => (people[id] && people[id].name) || (id ? 'someone' : 'Nobody'), data: id => (data[id] && data[id].name) || 'some information' };
  }
  // R9: pass `docs` to get names instead of ids in the change text (diffProcess(process, docs)).
  function diffProcess(process, docs) {
    const nm = docs ? namesFor(docs) : null;
    const asisSteps = flatSteps(process && process.asis), asisGw = flatGateways(process && process.asis);
    const asis = byId(asisSteps), asisG = byId(asisGw);
    const nodes = {}, changes = {}, used = new Set();
    const classify = (n, a, kindLabel, fn) => {
      if (!n.from) { nodes[n.id] = 'new'; changes[n.id] = ['New ' + kindLabel]; return; }
      if (!a) { nodes[n.id] = 'new'; changes[n.id] = ['New ' + kindLabel + ' (as-is ' + kindLabel + ' ' + n.from + ' not found)']; return; }
      used.add(n.from);
      const ch = fn(a, n);
      nodes[n.id] = ch.length ? 'changed' : 'same';
      changes[n.id] = ch;
    };
    flatSteps(process && process.tobe).forEach(n => classify(n, n.from && asis[n.from], 'step', (a, x) => stepChanges(a, x, nm)));
    flatGateways(process && process.tobe).forEach(n => classify(n, n.from && asisG[n.from], 'gateway', gatewayChanges));
    const removed = asisSteps.concat(asisGw).filter(a => !used.has(a.id));
    return { nodes, removed, changes };
  }

  // Counts for every UI badge: gateways count as nodes in new/changed.
  // R10 §1: `added` is the same number as `new`; removed Today steps and gateways count.
  function diffSummary(process) {
    const d = diffProcess(process);
    const out = { new: 0, changed: 0, removed: d.removed.length, same: 0 };
    Object.keys(d.nodes).forEach(k => { out[d.nodes[k]]++; });
    out.added = out.new;
    return out;
  }
  // R10 §1 the ONE change phrase: "5 new · 6 changed · 1 removed" ('' when nothing changes). Pass a process, or a
  // project with docs (sums its linked processes). Every screen that counts changes shows this text.
  function changeText(c) {
    c = c || {};
    return [c.added ? c.added + ' new' : '', c.changed ? c.changed + ' changed' : '', c.removed ? c.removed + ' removed' : ''].filter(Boolean).join(' · ');
  }
  function changeSummary(x, docs) {
    const procs = x && Array.isArray(x.processes) && !x.tobe ? (docs ? linkedProcesses(docs, x) : []) : x ? [x] : [];
    const out = { added: 0, changed: 0, removed: 0 };
    // R11 §8: only steps count (steps, waits, messages, calls to other processes), never choices (decision /
    // parallel gateways), so "10 steps · 4 new · 6 changed" can never exceed the step count.
    out.steps = 0;
    procs.forEach(p => {
      if (!p || !Array.isArray(p.tobe) || !p.tobe.length) return;
      const d = diffProcess(p), idx = {};
      allNodes(p.tobe).forEach(n => { if (n && n.id) idx[n.id] = n; });
      const steps = flatSteps(p.tobe);
      out.steps += steps.length;
      steps.forEach(n => { const st = d.nodes[n.id]; if (st === 'new') out.added++; else if (st === 'changed') out.changed++; });
      out.removed += (d.removed || []).filter(r => r && isStep(r)).length;
    });
    out.total = out.added + out.changed + out.removed;
    out.text = changeText(out);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Forecast                                                            */
  /* ------------------------------------------------------------------ */
  // R10 §3 business-day calendar: Monday–Friday, minus US federal holidays (observed dates, computed for any year)
  // and the workspace's own calendar (docs.calendar[0].holidays: [{date, name}] adds a day off; {date, off: true}
  // works a federal holiday). Every engine function that receives `docs` selects that workspace's calendar first
  // (see syncCalendar), so addBusinessDays / businessDaysBetween / isBusinessDay all skip the same days.
  // addBusinessDays(d, 0) rolls a weekend or holiday forward to the next business day.
  function weekday(ms) { return new Date(ms).getUTCDay(); }
  function nthWeekday(y, m, wd, n) { // n-th (1-based) weekday wd of month m (0-based); n = -1 is the last one
    if (n > 0) { const first = Date.UTC(y, m, 1); return first + (((wd - weekday(first)) + 7) % 7 + (n - 1) * 7) * DAY; }
    const last = Date.UTC(y, m + 1, 0); return last - (((weekday(last) - wd) + 7) % 7) * DAY;
  }
  function observed(ms) { const wd = weekday(ms); return wd === 6 ? ms - DAY : wd === 0 ? ms + DAY : ms; }
  const FED_CACHE = {};
  // US federal holidays observed in calendar year y: [{date, name}] sorted by date. A Saturday holiday is observed on
  // the Friday before, a Sunday one on the Monday after (so New Year's Day can be observed on Dec 31 of the year before).
  function federalHolidays(year) {
    const y = Math.round(+year);
    if (!isFinite(y)) return [];
    if (FED_CACHE[y]) return FED_CACHE[y].map(h => Object.assign({}, h));
    const raw = yy => [
      ['New Year’s Day', observed(Date.UTC(yy, 0, 1))],
      ['Martin Luther King Jr. Day', nthWeekday(yy, 0, 1, 3)],
      ['Presidents’ Day', nthWeekday(yy, 1, 1, 3)],
      ['Memorial Day', nthWeekday(yy, 4, 1, -1)],
      ['Juneteenth', observed(Date.UTC(yy, 5, 19))],
      ['Independence Day', observed(Date.UTC(yy, 6, 4))],
      ['Labor Day', nthWeekday(yy, 8, 1, 1)],
      ['Columbus Day', nthWeekday(yy, 9, 1, 2)],
      ['Veterans Day', observed(Date.UTC(yy, 10, 11))],
      ['Thanksgiving Day', nthWeekday(yy, 10, 4, 4)],
      ['Christmas Day', observed(Date.UTC(yy, 11, 25))],
    ];
    const out = raw(y).concat(raw(y + 1).filter(x => x[0] === 'New Year’s Day'))
      .map(([name, ms]) => ({ date: iso(ms), name, source: 'federal' }))
      .filter(h => +h.date.slice(0, 4) === y)
      .sort((a, b) => a.date.localeCompare(b.date));
    FED_CACHE[y] = out;
    return out.map(h => Object.assign({}, h));
  }
  // The active workspace calendar: custom days off and federal days worked. Selected by syncCalendar(docs).
  let CAL = { add: {}, off: {}, entries: null };
  function calendarEntries(docs) {
    const arr = docs && Array.isArray(docs.calendar) ? docs.calendar : null;
    if (!arr) return [];
    const out = [];
    arr.forEach(e => { const d = e && (e.data || e); (d && Array.isArray(d.holidays) ? d.holidays : []).forEach(h => { if (h && isDate(h.date)) out.push(h); }); });
    return out;
  }
  function syncCalendar(docs) {
    if (!docs || typeof docs !== 'object') return;
    const arr = Array.isArray(docs.calendar) ? docs.calendar : null;
    const refs = arr ? arr.map(e => e && (e.data || e)) : [];
    const prev = CAL.entries;
    if (prev && prev.length === refs.length && refs.every((r, i) => r === prev[i]) && CAL.docs === docs.calendar) return;
    const add = {}, off = {};
    calendarEntries(docs).forEach(h => { const d = String(h.date).slice(0, 10); if (h.off) off[d] = true; else add[d] = String(h.name || 'Company holiday'); });
    CAL = { add, off, entries: refs, docs: docs.calendar };
  }
  // Name of the holiday on day d under the active calendar, or null (weekends are not holidays).
  function holidayName(d, docs) {
    if (docs) syncCalendar(docs);
    if (!isDate(d)) return null;
    const day = String(d).slice(0, 10);
    if (CAL.add[day]) return CAL.add[day];
    if (CAL.off[day]) return null;
    const f = federalHolidays(+day.slice(0, 4)).find(h => h.date === day);
    return f ? f.name : null;
  }
  function isHoliday(d, docs) { return holidayName(d, docs) != null; }
  function offMs(ms) { const wd = weekday(ms); return wd === 0 || wd === 6 || holidayName(iso(ms)) != null; }
  // Every holiday the workspace observes from Jan 1 of `fromYear` (default: this year of `today`, else of the first
  // custom holiday) for `years` years (default 3: the current and next two): [{date, name, source:'federal'|'custom',
  // weekday}] sorted by date. Federal holidays the workspace works ({date, off:true}) are listed with worked: true.
  function holidays(docs, opts) {
    if (docs) syncCalendar(docs);
    opts = opts || {};
    const today = isDate(opts.today) ? String(opts.today).slice(0, 10) : null;
    const y0 = opts.fromYear != null && isFinite(+opts.fromYear) ? Math.round(+opts.fromYear) : today ? +today.slice(0, 4) : new Date().getUTCFullYear();
    const n = opts.years != null && isFinite(+opts.years) ? Math.max(1, Math.round(+opts.years)) : 3;
    const out = [];
    for (let y = y0; y < y0 + n; y++) federalHolidays(y).forEach(h => out.push(Object.assign(h, CAL.off[h.date] ? { worked: true } : {})));
    Object.keys(CAL.add).forEach(d => { const y = +d.slice(0, 4); if (y >= y0 && y < y0 + n && !out.some(h => h.date === d && !h.worked)) out.push({ date: d, name: CAL.add[d], source: 'custom' }); });
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source))
      .map(h => Object.assign(h, { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(toMs(h.date))] }));
  }
  function addBusinessDays(s, n) {
    if (!isDate(s)) return null;
    let ms = toMs(s), left = Math.abs(Math.round(n || 0));
    const step = n < 0 ? -1 : 1;
    if (!left) { for (let g = 0; offMs(ms) && g < 400; g++) ms += DAY; return iso(ms); }
    for (let g = 0; left > 0 && g < 100000; g++) { ms += step * DAY; if (!offMs(ms)) left--; }
    return iso(ms);
  }
  // Business days in (a, b]; negative when b < a.
  function businessDaysBetween(a, b) {
    if (!isDate(a) || !isDate(b)) return 0;
    let x = toMs(a), y = toMs(b), sign = 1;
    if (y < x) { const t = x; x = y; y = t; sign = -1; }
    const days = Math.round((y - x) / DAY), full = Math.floor(days / 7);
    let n = full * 5;
    for (let ms = x + (full * 7 + 1) * DAY; ms <= y; ms += DAY) { const wd = weekday(ms); if (wd !== 0 && wd !== 6) n++; }
    // minus the weekday holidays inside (x, y]
    const lo = iso(x), hi = iso(y);
    const ya = +lo.slice(0, 4), yb = +hi.slice(0, 4);
    const seen = {};
    for (let yy = ya; yy <= yb + 1; yy++) federalHolidays(yy).forEach(h => { seen[h.date] = true; });
    Object.keys(CAL.add).forEach(d => { seen[d] = true; });
    Object.keys(seen).forEach(d => { if (d > lo && d <= hi && holidayName(d) != null) { const wd = weekday(toMs(d)); if (wd !== 0 && wd !== 6) n--; } });
    return sign * n;
  }

  // Dependencies: "W1" (FS, lag 0) or {id, type: 'FS'|'SS'|'FF', lag}.
  function normDeps(w) {
    return (w && w.deps || []).map(d => typeof d === 'string' ? { id: d, type: 'FS', lag: 0 }
      : d && d.id ? { id: d.id, type: /^(SS|FF)$/.test(d.type) ? d.type : 'FS', lag: isFinite(+d.lag) ? Math.round(+d.lag) : 0 } : null).filter(Boolean);
  }
  function depIds(w) { return normDeps(w).map(d => d.id); }

  // Duration in business days: effortDays if set, else business days between start and due (min 1).
  function hasEffort(w) { return w.effortDays != null && w.effortDays !== '' && isFinite(+w.effortDays) && +w.effortDays > 0; }
  function duration(w) {
    if (hasEffort(w)) return Math.max(1, Math.ceil(+w.effortDays));
    if (!isDate(w.start) || !isDate(w.due)) return 1;
    return Math.max(1, businessDaysBetween(w.start, w.due));
  }

  // Effective data state for every element (see effectiveAvail).
  function availMap(docs) {
    const work = list(docs, 'workItem');
    const m = {};
    const ctx = availCtx(docs);
    list(docs, 'dataElement').forEach(d => { m[d.id] = availOf(d, work, docs, ctx); });
    return m;
  }
  // R8: information that appears on any Today (as-is) step, and the owner of each piece of information
  // (data.owner, else the owner of the first to-be step that uses it: "new information's owner is the step's owner").
  // R9 §8: the owner (or role) of the first Future step using it, else of the first Today step. stepRole holds the
  // role when that step has only a role. R9 §6: `problem` = information with an open defect (defect.dataId, else
  // the information of the test it came from, else the only information on its step).
  function availCtx(docs) {
    const asis = new Set(), stepOwner = {}, stepRole = {}, stepInfo = {};
    const claim = st => stepData(st).forEach(d => {
      if (stepOwner[d] || stepRole[d]) return;
      if (st.owner) stepOwner[d] = st.owner; else if (String(st.ownerRole || '').trim()) stepRole[d] = String(st.ownerRole).trim();
    });
    list(docs, 'process').forEach(p => {
      flatSteps(p.asis).forEach(st => stepData(st).forEach(d => asis.add(d)));
      flatSteps(p.tobe).forEach(st => { claim(st); stepInfo[p.id + '/' + st.id] = stepData(st); });
    });
    list(docs, 'process').forEach(p => flatSteps(p.asis).forEach(claim));
    const problem = new Map();
    list(docs, 'workItem').forEach(w => {
      if (w.kind !== 'defect' || w.status === 'done' || String(w.defectStatus || '').toLowerCase() === 'closed') return;
      const tc = w.testRef && w.testRef.caseId ? get(docs, 'testCase', w.testRef.caseId) : null;
      const onStep = stepInfo[w.pid + '/' + w.step] || [];
      const did = w.dataId || (tc && tc.dataId) || (onStep.length === 1 ? onStep[0] : null);
      if (did) { if (!problem.has(did)) problem.set(did, []); problem.get(did).push(w.id); }
    });
    return { asis, stepOwner, stepRole, problem };
  }
  function dataOwnerOf(docs, d, ctx) { return !d ? null : d.owner || ((ctx || availCtx(docs)).stepOwner[d.id] || null); }
  // R9 §8 {person, role, name}: never empty while a step uses the information (person, else the step's role).
  function dataOwner(docs, dataId) {
    const ctx = availCtx(docs), d = get(docs, 'dataElement', dataId);
    const person = dataOwnerOf(docs, d || { id: dataId }, ctx);
    const role = person ? null : (d && d.ownerRole) || ctx.stepRole[dataId] || null;
    return { person: person || null, role, name: person ? nameOf(docs, person) : role || 'Nobody' };
  }
  // R9 §8 the default owner for information added on a step: the step's owner, else its role (never the mapper).
  function defaultDataOwner(step) { return step ? (step.owner ? { owner: step.owner } : String(step.ownerRole || '').trim() ? { ownerRole: String(step.ownerRole).trim() } : {}) : {}; }
  // R8: the owner finishing the fix task counts as their confirmation.
  function fixedByOwner(docs, d, work, ctx) {
    const owner = dataOwnerOf(docs, d, ctx);
    return owner ? (work || list(docs, 'workItem')).find(w => w.resolves === d.id && w.status === 'done' && w.owner === owner) || null : null;
  }
  // Evidence behind a live claim. Types: 'profile' (latest profile has zero blocking drift issues, i.e. anything but
  // "column with no spec"), 'check' (stored connection check is ok), 'attested' (evidence link given; weaker).
  // An ok `dataElement.check` with no liveEvidence also counts as check evidence.
  function evidenceOf(docs, d) {
    if (!d) return null;
    const ev = d.liveEvidence;
    if (!ev || !ev.type) {
      if (d.check && d.check.ok) return { type: 'check', ok: true, strong: true };
      const fx = fixedByOwner(docs, d);
      if (fx) { const p = personMap(docs)[fx.owner]; return { type: 'fix', ok: true, strong: true, by: fx.owner, text: 'Fix completed by ' + ((p && p.name) || 'the owner') }; }
      return null;
    }
    if (ev.type === 'profile') {
      const prof = latestBy(list(docs, 'profile').filter(x => x.dataId === d.id), 'at');
      if (!prof) return { type: 'profile', ok: false, strong: true, reason: 'no profile on file' };
      const blocking = specDrift(d, prof).filter(x => x.issue !== 'unspecified-column');
      return { type: 'profile', ok: blocking.length === 0, strong: true, issues: blocking.length, reason: blocking.length ? nWord(blocking.length, 'drift issue') + ' in the latest profile' : '' };
    }
    if (ev.type === 'check') return { type: 'check', ok: !!(d.check && d.check.ok), strong: true, reason: d.check && d.check.ok ? '' : 'the connection check has not passed' };
    if (ev.type === 'attested') return { type: 'attested', ok: !!String(ev.ref || '').trim(), strong: false, reason: String(ev.ref || '').trim() ? '' : 'no evidence link' };
    return { type: String(ev.type), ok: false, strong: false, reason: 'unknown evidence type' };
  }
  // live    = confirmed (avail 'live', or the owner confirmed with a source) AND evidence that holds up;
  // pending = a resolver is done, or it is confirmed but the evidence is missing or failing;
  // else example | missing.
  // R8: information on any Today (as-is) step is live unless explicitly marked missing (avail 'missing'); the
  // confirmation/evidence rule applies only to information the project changes (missing → fixed, or new in Future);
  // a done fix task owned by the information's owner counts as the owner's confirmation.
  function availOf(d, work, docs, ctx) {
    if (!d) return 'missing';
    ctx = ctx || availCtx(docs);
    const st = availCore(d, work, docs, ctx);
    // R9 §6 (B14): an open problem keeps it from "We have it", even when its fix task is done.
    return (st === 'live' || st === 'pending') && ctx.problem && ctx.problem.has(d.id) ? 'problem' : st;
  }
  // R10: imported or new information starts as avail 'unchecked' ("Not checked yet"): not available until its owner
  // confirms it (liveConfirmedBy) or a fix task resolves it, even when a Today step uses it.
  function availCore(d, work, docs, ctx) {
    if (d.avail === 'unchecked' && !d.liveConfirmedBy) return work.some(w => w.resolves === d.id && w.status === 'done') ? 'pending' : 'unchecked';
    if (ctx.asis.has(d.id) && d.avail !== 'missing') return 'live';
    const owner = dataOwnerOf(docs, d, ctx);
    const confirmed = d.avail === 'live' || !!(d.liveConfirmedBy && d.liveConfirmedBy === owner && d.liveSource);
    const ev = evidenceOf(docs, d);
    if (confirmed && ev && ev.ok) return 'live';
    if (fixedByOwner(docs, d, work, ctx)) return 'live';
    if (confirmed || work.some(w => w.resolves === d.id && w.status === 'done')) return 'pending';
    return d.avail === 'example' ? 'example' : 'missing';
  }

  // Forecast rules for an open item (all in business days; the later candidate wins):
  //  due date; each open dependency (FS: dep finish + lag + duration, SS: dep start + lag + duration,
  //  FF: dep finish + lag); implicit data blocker (step data effectively missing/pending: its resolver's
  //  forecast + duration); late start (idle, start passed, and either effortDays is set or the due date has
  //  passed: today + duration; moving the due date later therefore clears an old slip); today.
  // Done items forecast at doneAt || due. Cycles: a dependency on the evaluation stack is ignored.
  // Each result carries `basis` {kind: 'due'|'dep'|'data'|'late-start'|'today'|'done', ...} for explainForecast.
  function forecastAll(docs, today) {
    const work = list(docs, 'workItem');
    const idx = byId(work);
    const avail = availMap(docs);
    const resolverOf = {};
    work.forEach(w => { if (w.resolves && !resolverOf[w.resolves]) resolverOf[w.resolves] = w.id; });
    const stepIdx = {};
    list(docs, 'process').forEach(p => flatSteps(p.tobe).forEach(st => { stepIdx[p.id + '/' + st.id] = st; }));
    const memo = {}, visiting = {};
    function calc(id) {
      if (memo[id]) return memo[id];
      const w = idx[id];
      visiting[id] = true;
      let res;
      if (w.status === 'done') {
        const fin = isDate(w.doneAt) ? w.doneAt : isDate(w.due) ? w.due : null;
        res = { forecast: fin, start: isDate(w.start) ? w.start : fin, sched: 'done', late: false, pastDueDays: 0, lateDays: 0, slipDays: fin && isDate(w.due) ? Math.max(0, businessDaysBetween(w.due, fin)) : 0, basis: { kind: 'done' } };
      } else {
        const dur = duration(w);
        // R9 §3: a weekend due date counts as the next Monday; no forecast lands on a weekend.
        const due = isDate(w.due) ? addBusinessDays(w.due, 0) : null;
        let best = due, basis = { kind: 'due' };
        const consider = (date, b) => { if (isDate(date) && (!best || date > best)) { best = date; basis = b; } };
        normDeps(w).forEach(d => {
          const dep = idx[d.id];
          if (!dep || dep.status === 'done' || visiting[d.id] || d.id === id) return;
          const r = calc(d.id);
          if (!r.forecast) return;
          const date = d.type === 'FF' ? addBusinessDays(r.forecast, d.lag)
            : addBusinessDays(addBusinessDays(d.type === 'SS' ? r.start : r.forecast, d.lag), dur);
          const b_ = { kind: 'dep', ref: d.id, type: d.type, lag: d.lag, from: d.type === 'SS' ? r.start : r.forecast, dur };
          if (dep.projectId !== w.projectId) b_.external = true;   // cross-project dependency
          consider(date, b_);
        });
        const st = stepIdx[w.pid + '/' + w.step];
        if (st) (st.data || []).forEach(dataId => {
          const state = avail[dataId] || 'missing';
          if (state !== 'missing' && state !== 'pending') return;
          const rid = resolverOf[dataId];
          if (!rid || rid === id || w.resolves === dataId || visiting[rid]) return;
          const r = calc(rid);
          if (r.forecast) consider(addBusinessDays(r.forecast, dur), { kind: 'data', ref: dataId, resolver: rid, from: r.forecast, dur });
        });
        if (isDate(today)) {
          if (w.status === 'idle' && isDate(w.start) && w.start < today && (hasEffort(w) || (isDate(w.due) && w.due < today)))
            consider(addBusinessDays(today, dur), { kind: 'late-start', from: today, dur });
          consider(addBusinessDays(today, 0), { kind: 'today' });
        }
        // R9 §3: slipDays is business days (never calendar days).
        res = { forecast: best, start: best ? addBusinessDays(best, -dur) : null, slipDays: best && due ? Math.max(0, businessDaysBetween(due, best)) : 0, basis };
        const viaId = basis.kind === 'dep' ? basis.ref : basis.kind === 'data' ? basis.resolver : null;
        if (viaId) res.via = viaId;   // the item that sets this forecast (binding)
        if (due && isDate(today) && due < today) res.sched = 'late';
        else if (best && due && best > due) res.sched = 'slip';
        else if (due && isDate(today) && diffDays(due, today) <= 5) res.sched = 'soon';
        else res.sched = 'ok';
        // R9 §1 one notion of late: past due ('late') or forecast after due ('slip').
        res.late = res.sched === 'late' || res.sched === 'slip';
        res.pastDueDays = res.sched === 'late' ? businessDaysBetween(due, isDate(today) ? today : due) : 0;
        // R11 §5 ONE lateness number per task: business days from its due date to its expected finish.
        res.lateDays = res.late ? Math.max(res.slipDays, res.pastDueDays) : 0;
        if (viaId && best && due && best > due) {
          if (basis.kind === 'data') { res.cause = basis.ref; res.causeWork = basis.resolver; }
          else {
            const up = memo[viaId];
            const rootWork = (up && up.causeWork) || viaId;
            const rw = idx[rootWork];
            res.causeWork = rootWork;
            res.cause = (up && up.cause && up.causeWork === rootWork) ? up.cause : ((rw && rw.resolves) || rootWork);
          }
        }
      }
      visiting[id] = false;
      memo[id] = res;
      return res;
    }
    const out = {};
    for (const w of work) out[w.id] = JSON.parse(JSON.stringify(calc(w.id)));
    // "Causing slip": an item whose forecast is the binding reason a dependent finishes after its due date.
    work.forEach(w => { const r = out[w.id]; if (r.via && r.forecast && isDate(w.due) && r.forecast > addBusinessDays(w.due, 0) && out[r.via]) out[r.via].causesSlip = true; });
    work.forEach(w => { if (!out[w.id].causesSlip) out[w.id].causesSlip = false; });
    return out;
  }

  // Human explanation of a forecast, root cause first: [{text}].
  function explainForecast(docs, workId, today) {
    const fc = forecastAll(docs, today);
    const idx = byId(list(docs, 'workItem'));
    const data = byId(list(docs, 'dataElement'));
    const w = idx[workId];
    if (!w || !fc[workId]) return [];
    const t = id => '"' + ((idx[id] && idx[id].title) || 'a deleted work item') + '"';
    const projs = byId(list(docs, 'project'));
    const projName = pid => '"' + ((projs[pid] && projs[pid].name) || 'another project') + '"';
    const bd = n => nWord(n, 'business day');
    const chain = [], seen = new Set();
    for (let cur = workId; cur && !seen.has(cur) && idx[cur]; cur = fc[cur].via) { seen.add(cur); chain.unshift(cur); }
    const lines = chain.map((id, i) => {
      const r = fc[id], b = r.basis || {}, it = idx[id];
      const lagTxt = b.lag ? (b.lag > 0 ? ' + ' : ' − ') + bd(Math.abs(b.lag)) + ' lag' : '';
      switch (b.kind) {
        case 'done': return t(id) + ' finished on ' + fmtDay(r.forecast);
        case 'dep':
          if (b.type === 'FF') return 'Finishes with ' + t(b.ref) + ' (forecast ' + fmtDay(b.from) + ')' + lagTxt + ' → ' + fmtDay(r.forecast);
          return (b.type === 'SS' ? 'Starts with ' : 'Waits for ') + (b.external ? 'external ' : '') + t(b.ref) + (b.external ? ' in ' + projName(idx[b.ref] && idx[b.ref].projectId) : '') + (b.type === 'SS' ? ' (starting ' : ' (forecast ') + fmtDay(b.from) + ')' + lagTxt + ' → +' + bd(b.dur) + ' effort → ' + fmtDay(r.forecast);
        case 'data': return 'Needs ' + ((data[b.ref] && data[b.ref].name) || 'a data element') + ', which ' + t(b.resolver) + ' makes available (forecast ' + fmtDay(b.from) + ') → +' + bd(b.dur) + ' effort → ' + fmtDay(r.forecast);
        case 'late-start': return t(id) + ' has not started and its start date (' + fmtDay(it.start) + ') has passed → today (' + fmtDay(b.from) + ') + ' + bd(b.dur) + ' effort → ' + fmtDay(r.forecast);
        case 'today': return t(id) + ' is still open past its due date → no earlier than today, ' + fmtDay(r.forecast);
        default: return (i === 0 ? t(id) + ' is planned to finish on its due date, ' : 'Due ') + fmtDay(r.forecast);
      }
    }).map(text => ({ text }));
    const r = fc[workId];
    if (w.status === 'done') return lines;
    const late = r.forecast && isDate(w.due) && r.forecast > w.due ? businessDaysBetween(w.due, r.forecast) : 0;
    lines.push({ text: 'Due ' + fmtDay(w.due) + '; forecast ' + fmtDay(r.forecast) + (late ? ' (' + bd(late) + ' late)' : ' (on plan)') });
    return lines;
  }

  // Longest chain ending at the project finish, root first. All done: the chain ending at the latest actual finish.
  function criticalPath(docs, projectId, today) {
    const fc = forecastAll(docs, today);
    const items = list(docs, 'workItem').filter(w => w.projectId === projectId);
    if (!items.length) return [];
    const finish = projectStats(docs, projectId, today).finish;
    const allDone = items.every(w => w.status === 'done');
    const ends = items.filter(w => (allDone ? (w.doneAt || w.due) : (w.status !== 'done' && fc[w.id].forecast)) === finish);
    // R6: the full predecessor chain. Each step back takes the binding item (forecast `via`) when there is one,
    // otherwise the dependency (done or open) with the latest finish.
    const idx = byId(list(docs, 'workItem'));
    const finOf = id => fc[id] && fc[id].forecast || (idx[id] && (idx[id].doneAt || idx[id].due)) || '';
    const predOf = id => {
      if (fc[id] && fc[id].via && idx[fc[id].via]) return fc[id].via;
      const preds = depIds(idx[id]).filter(x => idx[x]);
      return preds.sort((a, b) => String(finOf(b)).localeCompare(String(finOf(a))) || String(a).localeCompare(String(b)))[0] || null;
    };
    let best = [];
    ends.forEach(w => {
      const chain = [], seen = new Set();
      let cur = w.id;
      while (cur && !seen.has(cur)) { seen.add(cur); chain.unshift(cur); cur = predOf(cur); }
      if (chain.length > best.length) best = chain;
    });
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* Data readiness, dependents, impact                                  */
  /* ------------------------------------------------------------------ */
  // Single source of truth for a data element's state:
  //  'live'    avail is live (seeded live counts as confirmed) or the data owner confirmed it (liveConfirmedBy === owner, liveSource set);
  //  'pending' a resolver work item is done but the owner has not confirmed ("Fix done, awaiting owner confirmation");
  //  otherwise 'example' or 'missing'. Unknown elements are 'missing'.
  function effectiveAvail(docs, dataId) {
    return availOf(get(docs, 'dataElement', dataId), list(docs, 'workItem'), docs);
  }
  function dataReady(docs, dataId) { return effectiveAvail(docs, dataId) === 'live'; }

  function dependents(docs, workId) {
    const work = list(docs, 'workItem');
    const out = new Set();
    const walk = x => work.forEach(w => {
      if (depIds(w).includes(x) && !out.has(w.id) && w.id !== workId) { out.add(w.id); walk(w.id); }
    });
    walk(workId);
    return [...out];
  }

  function impactOfData(docs, dataId) {
    const out = [];
    list(docs, 'process').forEach(p => flatSteps(p.tobe).forEach(s => {
      if (stepData(s).includes(dataId)) out.push({ pid: p.id, stepId: s.id, title: s.title });
    }));
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Step state and project stats                                        */
  /* ------------------------------------------------------------------ */
  const SCHED_ORDER = ['late', 'slip', 'soon', 'ok'];
  function worstSched(list_) { return list_.slice().sort((a, b) => SCHED_ORDER.indexOf(a) - SCHED_ORDER.indexOf(b))[0] || 'ok'; }

  function stepState(docs, projectId, pid, stepId, today) {
    const items = list(docs, 'workItem').filter(w => w.projectId === projectId && w.pid === pid && w.step === stepId);
    if (!items.length) return { items, status: 'none', done: 0, due: null, forecast: null, next: null, sched: 'ok', blockers: [], built: false, awaitingLive: false };
    const fc = forecastAll(docs, today);
    const done = items.filter(w => w.status === 'done').length;
    const status = done === items.length ? 'done' : (items.some(w => w.status !== 'idle') ? 'prog' : 'idle');
    const open = items.filter(w => w.status !== 'done');
    const step = findStep(docs, pid, stepId);
    return {
      items, status, done,
      due: maxDate(items.map(w => w.due)),
      forecast: maxDate(items.map(w => fc[w.id] && fc[w.id].forecast)),
      next: minDate(open.map(w => w.due)),
      sched: status === 'done' ? 'done' : worstSched(open.map(w => fc[w.id].sched)),
      // Red blockers: effectively MISSING data only. Examples-only and pending (awaiting owner confirmation) are amber.
      blockers: open.length && step ? (step.data || []).filter(d => effectiveAvail(docs, d) === 'missing') : [],
      needsLive: step ? (step.data || []).filter(d => { const e = effectiveAvail(docs, d); return e === 'example' || e === 'unchecked' || e === 'pending' || e === 'problem'; }) : [],
      pending: step ? (step.data || []).filter(d => effectiveAvail(docs, d) === 'pending') : [],
      // R6: work done but data not effectively live = "Built · awaiting live data" (amber), never green Done.
      built: status === 'done',
      awaitingLive: status === 'done' && !!step && stepData(step).some(d => effectiveAvail(docs, d) !== 'live'),
    };
  }

  function projectStats(docs, projectId, today) {
    const project = get(docs, 'project', projectId);
    const work = list(docs, 'workItem');
    const idx = byId(work);
    const items = work.filter(w => w.projectId === projectId);
    const fc = forecastAll(docs, today);
    const done = items.filter(w => w.status === 'done').length;
    const allDone = items.length > 0 && done === items.length;
    // All done: finish is the actual finish (max doneAt, falling back to due). Otherwise: max forecast of open items.
    const finish = allDone ? maxDate(items.map(w => w.doneAt || w.due)) : maxDate(items.filter(w => w.status !== 'done').map(w => fc[w.id].forecast));
    const target = project && project.target || null;
    const out = {
      total: items.length, done,
      pct: items.length ? Math.round(done / items.length * 100) : 0,
      late: items.filter(w => fc[w.id].late).length,          // R9 §1: one late count (past due + finishing after due)
      slip: items.filter(w => fc[w.id].sched === 'slip').length, // finishing after due (Advanced breakdown)
      pastDue: items.filter(w => fc[w.id].sched === 'late').length,
      blocked: items.filter(w => w.status !== 'done' && depIds(w).some(d => idx[d] && idx[d].status !== 'done')).length,
      finish, target,
      onTrack: !target || !finish || finish <= target,
    };
    if (allDone) out.actualFinish = finish;
    // RAG (R6): the single projectHealth rule; see healthOf.
    out.notPlanned = items.length === 0;
    const h = healthOf(docs, project, items, fc, finish, allDone, today);
    out.rag = h.rag;
    out.ragReason = h.reasons.join('; ');
    // R10 §2: "% done" is the share of the budgeted work done (EV ÷ budget), the same % earned value uses.
    // taskPct keeps the plain task-count share (done ÷ total).
    out.taskPct = out.pct;
    out.pct = h.ev ? h.ev.pct : 0;
    return out;
  }

  // R6 project RAG. red   = forecast finish after the target, or a step needs data that is effectively missing
  //                         and no work item resolves it (unplanned missing data);
  //                 amber = any open item late or slipping while the finish still meets the target,
  //                         or fewer than 5 business days of buffer;
  //                 grey  = no work ("Not planned"); green otherwise. Every result carries plain reasons.
  function unplannedMissing(docs, project) {
    return blockersOf(docs, project, []).filter(b => !b.planned && b.state === 'missing').map(b => b.dataId);
  }
  // R8 the one blockers list: information used by the project's Future steps that is not available yet
  // (effective state missing or example). planned = some work item resolves it. Unplanned first, then by open
  // tasks held. {dataId, name, state, owner, planned, resolver, resolverOwner, steps, held, text}.
  function blockersOf(docs, project, items) {
    const work = list(docs, 'workItem'), ctx = availCtx(docs), procs = linkedProcesses(docs, project);
    const own = items || work.filter(w => project && w.projectId === project.id);
    const out = [], seen = new Set();
    procs.forEach(p => flatSteps(p.tobe).forEach(s => stepData(s).forEach(id => {
      if (seen.has(id)) return; seen.add(id);
      const d = get(docs, 'dataElement', id);
      const st = availOf(d, work, docs, ctx);
      if (st !== 'missing' && st !== 'example' && st !== 'unchecked') return;
      const res = work.filter(w => w.resolves === id);
      const resolver = res.find(w => w.status !== 'done') || res[0] || null;
      let steps = 0, held = 0;
      procs.forEach(pp => flatSteps(pp.tobe).forEach(ss => {
        if (!stepData(ss).includes(id)) return;
        steps++; held += own.filter(w => w.pid === pp.id && w.step === ss.id && w.status !== 'done').length;
      }));
      const name = (d && d.name) || 'some information';
      out.push({ dataId: id, name, state: st, owner: dataOwnerOf(docs, d, ctx) || (project && project.owner) || null, planned: res.length > 0,
        resolver: resolver ? resolver.id : null, resolverOwner: resolver ? resolver.owner || null : null, steps, held,
        text: name + ' is not available yet' + (res.length ? '' : ' and no work is planned to get it') });
    })));
    return out.sort((a, b) => (a.planned - b.planned) || b.held - a.held || a.name.localeCompare(b.name));
  }
  // R9 §1 schedule truth (the single status rule). One notion of late: an open task is late when its due date is
  // before today (pastDue) or its forecast finish is after its due date (finishAfterDue). rag/label:
  //   red   "Will miss the deadline" (Advanced: "At risk") = the forecast misses the deadline, or an unplanned blocker;
  //   amber "Some tasks late" = otherwise, when any task is late;
  //   green "On track" = nothing late, no unplanned blockers, forecast on or before the deadline (planned blockers are
  //   mentioned in the reasons, since work to get them is scheduled); grey "Not planned" (no work).
  //   bufferDays = business days from the forecast (or actual) finish to the deadline.
  // `runningLate` is kept as a deprecated alias of finishAfterDue.
  function scheduleCore(docs, project, today, fc) {
    fc = fc || forecastAll(docs, today);
    const items = project ? list(docs, 'workItem').filter(w => w.projectId === project.id) : [];
    const open = items.filter(w => w.status !== 'done');
    const allDone = items.length > 0 && !open.length;
    const finish = allDone ? maxDate(items.map(w => w.doneAt || w.due)) : maxDate(open.map(w => fc[w.id] && fc[w.id].forecast));
    const target = project && isDate(project.target) ? project.target : null;
    const bufferDays = target && finish ? businessDaysBetween(finish, target) : null;
    const pastDue = open.filter(w => fc[w.id] && fc[w.id].sched === 'late').map(w => w.id);
    const finishAfterDue = open.filter(w => fc[w.id] && fc[w.id].sched === 'slip').map(w => w.id);
    const late = open.filter(w => fc[w.id] && fc[w.id].late).map(w => w.id);
    const blockers = project ? blockersOf(docs, project, items) : [];
    const unplanned = blockers.filter(b => !b.planned), plannedB = blockers.filter(b => b.planned);
    const misses = !!(target && finish && finish > target);
    // R10 §2: a project with SPI < 0.9 never reads "On track": the label stays driven by lateness, "Behind on effort"
    // joins the reasons, and a project that would otherwise be green is amber "Behind on effort".
    const ev = project && items.length ? earnedValue(docs, project.id, today) : null;
    const behindEffort = !!(ev && ev.SPI != null && ev.SPI < 0.9);
    const effortReason = behindEffort ? 'Behind on effort: ' + Math.round(ev.SPI * 100) + '% of the work planned by today is done' : null;
    const reasons = [];
    let rag, effortOnly = false;
    if (!items.length) { rag = 'grey'; reasons.push('Not planned: no work yet'); }
    else if (misses || unplanned.length) {
      rag = 'red';
      if (misses) reasons.push('Forecast finish ' + fmtDay(finish) + ' is after the ' + fmtDay(target) + ' deadline');
      if (unplanned.length) reasons.push(joinList(unplanned.map(b => b.name), 3) + ' ' + isAre(unplanned.length) + ' not available yet and no work is planned to get ' + (unplanned.length === 1 ? 'it' : 'them'));
    } else if (late.length) {
      rag = 'amber';
      reasons.push(nWord(late.length, 'task') + ' late' + lateSplit(pastDue.length, finishAfterDue.length) + (target ? ', but the finish still meets the deadline' : ''));
      if (plannedB.length) reasons.push(joinList(plannedB.map(b => b.name), 3) + ' ' + isAre(plannedB.length) + ' not available yet; work is planned to get ' + (plannedB.length === 1 ? 'it' : 'them'));
    } else if (behindEffort && !allDone) {
      rag = 'amber'; effortOnly = true;
      if (plannedB.length) reasons.push(joinList(plannedB.map(b => b.name), 3) + ' ' + isAre(plannedB.length) + ' not available yet; work is planned to get ' + (plannedB.length === 1 ? 'it' : 'them'));
    } else {
      rag = 'green';
      reasons.push(allDone ? 'All work done' : bufferDays == null ? 'On track; no deadline set' : 'On track: ' + nWord(bufferDays, 'business day') + ' of buffer');
      if (plannedB.length) reasons.push(joinList(plannedB.map(b => b.name), 3) + ' ' + isAre(plannedB.length) + ' not available yet; work is planned to get ' + (plannedB.length === 1 ? 'it' : 'them'));
    }
    if (effortReason && rag !== 'grey' && !allDone) reasons.splice(effortOnly ? 0 : 1, 0, effortReason);
    // R11 §3: a launch day on a weekend, holiday or workspace day off is never "On track".
    const ld = project ? launchDate(docs, project) : null;
    let launchFlag = null;
    if (ld && ld.problem && ld.source === 'window' && project.status !== 'live') {
      launchFlag = 'Launch day ' + ld.problem + ' is a day off: pick a business day';
      reasons.unshift(launchFlag);
      if (rag === 'green') rag = 'amber';
    }
    let label2 = effortOnly ? 'Behind on effort' : RAG_LABEL[rag], labelAdv2 = effortOnly ? 'Behind on effort' : RAG_LABEL_ADVANCED[rag];
    if (launchFlag && (label2 === RAG_LABEL.amber || label2 === 'Behind on effort') && !late.length) { label2 = 'Launch day is a day off'; labelAdv2 = label2; }
    return { project, items, open, allDone, finish, target, bufferDays, late, pastDue, finishAfterDue, runningLate: finishAfterDue, blockers, rag,
      label: label2, labelAdvanced: labelAdv2, reasons, fc, ev, behindEffort, today: today || null, launchFlag };
  }
  // R10 §3 the ONE launch date: the launch window's day when set, else the deadline. Every screen (Launch page,
  // dashboard "Upcoming launches", project header) shows this. {date, source: 'window'|'deadline'|null, problem}
  // where problem names a weekend or holiday the window sits on ("Fri Dec 25, Christmas Day").
  function windowDate(w) { const m = /(\d{4}-\d{2}-\d{2})/.exec(String(w || '')); return m ? m[1] : null; }
  function launchWindowProblem(d) {
    if (!isDate(d)) return null;
    const h = holidayName(d), wd = weekday(toMs(d));
    if (h) return fmtDayLong(d) + ', ' + h;
    if (wd === 0 || wd === 6) return fmtDayLong(d) + ', a weekend';
    return null;
  }
  function launchDate(docs, prj) {
    const project = projOf(docs, prj);
    if (!project) return { date: null, source: null, problem: null };
    if (docs) syncCalendar(docs);
    const w = windowDate(project.cutover && project.cutover.window);
    if (w) return { date: w, source: 'window', problem: launchWindowProblem(w) };
    return { date: isDate(project.target) ? project.target : null, source: isDate(project.target) ? 'deadline' : null, problem: null };
  }
  // A launch window the user is about to pick: null when fine, else the plain reason ("Fri Dec 25, Christmas Day").
  function checkLaunchWindow(date, docs) { if (docs) syncCalendar(docs); return launchWindowProblem(date); }

  // R10 §5 the late split, shown in Simple and in the report: "5 late (1 past due, 4 will finish after their due date)".
  function lateSplit(pd, fad) {
    const parts = [pd ? pd + ' past due' : '', fad ? fad + ' will finish after ' + (fad === 1 ? 'its' : 'their') + ' due date' : ''].filter(Boolean);
    return parts.length ? ' (' + parts.join(', ') + ')' : '';
  }
  function lateText(t) {
    if (!t) return '';
    const n = t.lateCount != null ? t.lateCount : (t.late || []).length;
    if (!n) return 'Nothing late';
    return n + ' late' + lateSplit(t.pastDueCount != null ? t.pastDueCount : (t.pastDue || []).length, t.finishAfterDueCount != null ? t.finishAfterDueCount : (t.finishAfterDue || []).length);
  }
  function healthOf(docs, project, items, fc, finish, allDone, today) {
    const c = scheduleCore(docs, project, today, fc);
    return { rag: c.rag, label: c.label, reasons: c.reasons, ev: c.ev };
  }
  function projectHealth(docs, projectId, today) {
    const c = scheduleCore(docs, projOf(docs, projectId), today);
    return { rag: c.rag, label: c.label, reasons: c.reasons, bufferDays: c.bufferDays };
  }

  // R6 one schedule badge per item, by priority: late > causing slip > slipping > due soon > on track.
  // R8 plain words (no "slip"): keys are unchanged.
  // R9 §1: Simple has one "Late" (past due or finishing after its due date); `late` is true for both and the
  // Advanced breakdown is advancedLabel. A late item that also holds up others stays "Late" (holdsUp: true).
  const BADGE_LABEL = { done: 'Done', late: 'Late', causing: 'Holding up other work', slipping: 'Late', soon: 'Due soon', ontrack: 'On track' };
  const BADGE_ADVANCED = { done: 'Done', late: 'Past due', causing: 'Holding up other work', slipping: 'Will finish after its due date', soon: 'Due soon', ontrack: 'On track' };
  function badgeOf(w, r) {
    let key;
    if (!w || !r) key = 'ontrack';
    else if (w.status === 'done') key = 'done';
    else if (r.sched === 'late') key = 'late';
    else if (r.sched === 'slip') key = 'slipping';
    else if (r.causesSlip) key = 'causing';
    else if (r.sched === 'soon') key = 'soon';
    else key = 'ontrack';
    return { key, label: BADGE_LABEL[key], advancedLabel: BADGE_ADVANCED[key], late: key === 'late' || key === 'slipping', holdsUp: !!(r && r.causesSlip) };
  }
  function scheduleBadge(docs, workId, today) {
    const w = get(docs, 'workItem', workId);
    if (!w) return { key: 'ontrack', label: BADGE_LABEL.ontrack };
    return badgeOf(w, forecastAll(docs, today)[workId]);
  }

  /* ------------------------------------------------------------------ */
  /* Readiness gate                                                      */
  /* ------------------------------------------------------------------ */
  function latestBy(arr, key) { return arr.slice().sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || ''))).pop() || null; }

  const KNOWN_BUS = ['Procurement', 'Compliance', 'Treasury', 'Accounts Payable', 'IT', 'HR'];
  const ENVS = ['dev', 'sit', 'uat', 'prod-verify'];
  function allNodes(nodes) { const out = []; (nodes || []).forEach(n => { if (!n) return; out.push(n); (n.branches || []).forEach(b => out.push(...allNodes(b && b.nodes))); }); return out; }

  /* Plain-English helpers */
  function joinList(arr, max) {
    const a = arr.filter(x => x != null && x !== '').map(String);
    if (max && a.length > max) { const rest = a.length - max; return a.slice(0, max).join(', ') + ' and ' + rest + ' more'; }
    return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }
  function capFirst(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function nWord(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function isAre(n) { return n === 1 ? 'is' : 'are'; }
  function fmtDay(d) { const ms = toMs(d); if (isNaN(ms)) return String(d || ''); const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; const x = new Date(ms); return M[x.getUTCMonth()] + ' ' + x.getUTCDate(); }

  // status: warning checks → pass|warn; blocking checks → fail, or warn when passing with a soft concern (c.soft).
  function finishCheck(c) {
    c.status = c.warning ? (c.pass ? 'pass' : 'warn') : (c.pass ? (c.soft ? 'warn' : 'pass') : 'fail');
    return c;
  }
  function summarize(checks) {
    const sm = { pass: 0, fail: 0, warn: 0 };
    checks.forEach(c => { sm[c.status] = (sm[c.status] || 0) + 1; });
    return sm;
  }

  // BU sections: a step belongs to its owner's BU plus every BU named (case-insensitive) in its touches tags;
  // trigger touches count too. Known BU names include those of people plus KNOWN_BUS (a BU may have no person).
  // R7: role-only steps (ownerRole, no owner) belong to no section.
  function sectionHelpers(people) {
    const buOf = pid => people[pid] && people[pid].bu || null;
    const peopleBus = [...new Set(Object.keys(people).map(k => people[k] && people[k].bu).filter(Boolean))];
    const allBus = [...new Set(peopleBus.concat(KNOWN_BUS))];
    const stepBus = st => {
      const set = new Set();
      if (!st.owner && String(st.ownerRole || '').trim()) return [];
      const ob = buOf(st.owner); if (ob) set.add(ob);
      (st.touches || []).forEach(tag => { const tl = String(tag || '').trim().toLowerCase(); allBus.forEach(b => { if (b.toLowerCase() === tl) set.add(b); }); });
      return [...set];
    };
    return { buOf, peopleBus, allBus, stepBus };
  }
  // R7: a runbook task belongs to the section of its owner's BU (or task.bu when set).
  function taskBu(people, t) { return (t && t.bu) || (t && people[t.owner] && people[t.owner].bu) || null; }
  function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  // R7 per-section fingerprint for re-approval scoping. Save it on the approval (approval.fingerprint) when a
  // section is approved; readiness then makes that section stale only when ITS OWN steps, information
  // definitions, tests or launch-day tasks changed. Format "s:<h>;d:<h>;t:<h>;c:<h>;k:<step>=<h>.<h>…,…".
  // R11: `k` keeps a short hash per step field (STEP_FIELDS order), so a reopened approval can say WHAT changed
  // ("“Capture banking details” owner changed"). ownerRole, raci and timer are part of a step: changing them reopens it.
  const STEP_FIELDS = [['title', 'name'], ['owner', 'owner'], ['data', 'information'], ['touches', 'teams involved'], ['subs', 'sub-steps'],
    ['sla', 'time limit'], ['system', 'system'], ['calls', 'called process'], ['raci', 'RACI'], ['timer', 'timer'], ['type', 'kind']];
  function stepFieldHashes(st) {
    return STEP_FIELDS.map(([f]) => hashStr(JSON.stringify(f === 'owner' ? [st.owner, st.ownerRole] : st[f])).slice(0, 4)).join('.');
  }
  function sectionParts(docs, project, bu) {
    const people = personMap(docs);
    const { stepBus } = sectionHelpers(people);
    const stepsOut = [];
    linkedProcesses(docs, project).forEach(p => allNodes(p.tobe).forEach(n => {
      if (!n || isGateway(n) || n.type === 'end') return;
      if (!stepBus(n).includes(bu)) return;
      stepsOut.push({ pid: p.id, id: n.id, title: n.title || '', type: n.type || '', owner: n.owner || '', ownerRole: n.ownerRole || '', data: stepData(n).slice().sort(),
        touches: (n.touches || []).map(String).sort(), subs: (n.subs || []).map(x => x && x.title || ''), sla: n.sla == null ? '' : n.sla, system: n.system || '', calls: n.calls || '',
        raci: n.raci == null ? '' : n.raci, timer: n.timer == null ? '' : n.timer });
    }));
    const dataIds = [...new Set(stepsOut.flatMap(x => x.data))].sort();
    const dataOut = dataIds.map(id => { const d = get(docs, 'dataElement', id) || {}; return { id, name: d.name || '', fields: d.fields || [] }; });
    const testsOut = list(docs, 'testCase').filter(c => dataIds.includes(c.dataId)).map(c => ({ id: c.id, dataId: c.dataId, field: c.field || '', kind: c.kind || '', input: c.input == null ? '' : c.input, expect: c.expect || '' }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const tasks = (project.cutover && Array.isArray(project.cutover.tasks) ? project.cutover.tasks.filter(Boolean) : []).filter(t => taskBu(people, t) === bu)
      .map(t => ({ id: t.id || '', task: t.task || t.title || '', owner: t.owner || '', gonogo: !!t.gonogo, order: t.order == null ? '' : t.order, plannedStart: t.plannedStart || '', durationMins: t.durationMins == null ? '' : t.durationMins }));
    const k = stepsOut.map(st => encodeURIComponent(st.pid + '/' + st.id) + '=' + stepFieldHashes(st)).join(',');
    const titles = {}; stepsOut.forEach(st => { titles[st.pid + '/' + st.id] = st.title; });
    return { s: hashStr(JSON.stringify(stepsOut)), d: hashStr(JSON.stringify(dataOut)), t: hashStr(JSON.stringify(testsOut)), c: hashStr(JSON.stringify(tasks)), k, titles };
  }
  function fpString(parts) { return 's:' + parts.s + ';d:' + parts.d + ';t:' + parts.t + ';c:' + parts.c + (parts.k != null ? ';k:' + parts.k : ''); }
  function fpParse(str) { const out = {}; String(str || '').split(';').forEach(x => { const m = /^([sdtck]):(.*)$/.exec(x); if (m) out[m[1]] = m[2]; }); return out; }
  function fpSteps(k) { const out = {}; String(k || '').split(',').filter(Boolean).forEach(x => { const i = x.indexOf('='); if (i > 0) out[decodeURIComponent(x.slice(0, i))] = x.slice(i + 1).split('.'); }); return out; }
  // R11 (partStepChanges): what changed in a part's steps since the approval, in words: [{key, title, text}] ("“X” owner changed").
  // Needs the per-step hashes (k); approvals saved before R11 have none, so [] (the caller says "its steps").
  function partStepChanges(wasK, now, docs) {
    if (wasK == null) return [];
    const was = fpSteps(wasK), cur = fpSteps(now.k), out = [];
    Object.keys(cur).forEach(key => {
      const t = '“' + (now.titles[key] || 'a step') + '”';
      if (!was[key]) return out.push({ key, title: now.titles[key] || '', text: t + ' added' });
      const f = STEP_FIELDS.filter((x, i) => was[key][i] !== cur[key][i]).map(x => x[1]);
      if (f.length) out.push({ key, title: now.titles[key] || '', text: t + ' ' + joinList(f) + ' changed' });
    });
    Object.keys(was).filter(key => !cur[key]).forEach(key => {
      const [pid, id] = key.split('/'); const pr = docs ? get(docs, 'process', pid) : null;
      const n = pr ? [...allNodes(pr.tobe), ...allNodes(pr.asis)].find(x => x && x.id === id) : null;
      out.push({ key, title: (n && n.title) || '', text: (n && n.title ? '“' + n.title + '”' : 'a step') + ' is no longer in this part' });
    });
    return out;
  }
  function sectionFingerprint(docs, projectId, bu) {
    const project = get(docs, 'project', projectId);
    return project ? fpString(sectionParts(docs, project, bu)) : '';
  }

  // R8 approval sections: teams owning a new/changed Future step (or a trigger that changed), plus teams that own
  // launch-day tasks. Unchanged teams need no approval.
  function sectionBus(docs, project, people) {
    const { stepBus } = sectionHelpers(people);
    const set = new Set();
    linkedProcesses(docs, project).forEach(p => {
      const diff = diffProcess(p);
      const asisAll = byId(allNodes(p.asis).filter(Boolean));
      allNodes(p.tobe).forEach(n => {
        if (!n || isGateway(n) || n.type === 'end') return;
        let changed;
        if (n.type === 'trigger') {
          const a = asisAll[n.from || n.id];
          const tch = x => JSON.stringify((x.touches || []).map(String).sort());
          changed = !a || a.type !== 'trigger' || (a.title || '') !== (n.title || '') || (a.owner || '') !== (n.owner || '') || tch(a) !== tch(n);
        } else changed = diff.nodes[n.id] === 'new' || diff.nodes[n.id] === 'changed';
        if (changed) stepBus(n).forEach(b => set.add(b));
      });
    });
    // Launch-day tasks run by the PM or launch owner themselves (no explicit task.bu) add no section: they cannot approve it.
    const lead = [project.owner, project.releaseManager].filter(Boolean);
    (project.cutover && Array.isArray(project.cutover.tasks) ? project.cutover.tasks.filter(Boolean) : []).forEach(t => {
      if (!t.bu && lead.includes(t.owner)) return;
      const b = taskBu(people, t); if (b) set.add(b);
    });
    return [...set].sort();
  }
  // R8 test stages: dev, sit and system runs count toward "Try it out"; uat toward "Business sign-off".
  function stageOfEnv(env) { return env === 'uat' ? 'uat' : env === 'dev' || env === 'sit' || env === 'system' ? 'system' : null; }
  // R8 information the project changes (the only information that needs tests and owner confirmation):
  //  'new'   used by a Future step but on no Today step;
  //  'fixed' explicitly marked missing, or a work item of this project resolves it;
  //  'rules' dataElement.rulesChanged, or a field marked changed/isNew.
  // [{dataId, reason}] in map order of the project's Future steps.
  function changedInformation(docs, prj) {
    const project = projOf(docs, prj);
    if (!project) return [];
    const ctx = availCtx(docs), work = list(docs, 'workItem').filter(w => w.projectId === project.id);
    const out = [], seen = new Set();
    linkedProcesses(docs, project).forEach(p => flatSteps(p.tobe).forEach(st => stepData(st).forEach(id => {
      if (seen.has(id)) return; seen.add(id);
      const d = get(docs, 'dataElement', id) || { id };
      let reason = null;
      if (!ctx.asis.has(id)) reason = 'new';
      else if (d.avail === 'missing' || work.some(w => w.resolves === id)) reason = 'fixed';
      else if (d.rulesChanged === true || (d.fields || []).some(f => f && (f.changed === true || f.isNew === true))) reason = 'rules';
      if (reason) out.push({ dataId: id, reason });
    })));
    return out;
  }

  // R11 §1 THE testing facts (one function; the gate check, testingTruth, perBU, the matrix and the audit strings all
  // read it). Scope: test cases on information the project changes + UAT scripts + saved scenarios.
  //  - Each phase keeps its own latest result per test: "Try it out" = dev/sit/system runs, "Business check" = uat
  //    runs. Recording one phase never changes the other phase's counts.
  //  - 'not-run'/'skipped' never override; a script pass without evidence counts only from a 'ci' run.
  //  - A test linked to an open problem whose fix is not done (defect state new/triaged/in progress) is "waiting for
  //    a fix": it never counts as passed, in any phase.
  //  - Per test: 'fix' (held by an open problem) > 'failed' (latest fail in either phase) > 'blocked' (business) >
  //    'passed' (latest business check passed) > 'notRun'.
  //  - Coverage: every piece of changed information needs at least one non-custom case AND a case on each of its rule
  //    fields; every new or changed step (and gateway) needs a script. Information the Future steps use that the
  //    project does not change needs no tests (listed in notChanged, never counted as a gap).
  const FIX_DONE = ['fixed', 'verified', 'closed'];
  function rawDefectState(w) { return String((w && w.defectStatus) || '').trim().toLowerCase().replace(/[\s_]+/g, '-'); }
  function problemFixDone(w) { return !!w && (w.status === 'done' || FIX_DONE.includes(rawDefectState(w))); }
  // {testId: defect workItem id} for open problems whose fix is not done yet
  function heldTests(docs, projectId) {
    const m = {};
    list(docs, 'workItem').filter(w => w.projectId === projectId && w.kind === 'defect' && !problemFixDone(w)).forEach(w => {
      const k = w.testRef && (w.testRef.caseId || w.testRef.scriptId); if (k && !m[k]) m[k] = w.id;
    });
    return m;
  }
  function projectScripts(docs, project) {
    return (Array.isArray(project.uatScripts) ? project.uatScripts : generateUatScripts(docs, project.id)).filter(Boolean)
      .concat(Array.isArray(project.uatScenarios) ? project.uatScenarios.filter(Boolean) : []);
  }
  function testFacts(docs, project) {
    const changed = changedInformation(docs, project);
    const changedSet = new Set(changed.map(x => x.dataId));
    const dataIdx = byId(list(docs, 'dataElement'));
    const cases = list(docs, 'testCase').filter(c => changedSet.has(c.dataId));
    const scripts = projectScripts(docs, project);
    const caseIds = cases.map(c => c.id), scriptIds = scripts.map(s => s.id);
    const ids = caseIds.concat(scriptIds);
    const runs = list(docs, 'testRun').filter(r => r.projectId === project.id).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    const phase = { system: {}, uat: {} }, noEvidence = new Set(), skipped = new Set(), byEnv = {};
    ENVS.forEach(e => { byEnv[e] = {}; });
    runs.forEach(r => {
      const ph = stageOfEnv(r.env);
      (r.results || []).forEach(x => {
        const k = x && (x.caseId || x.scriptId); if (!k) return;
        if (x.outcome === 'not-run' || x.outcome === 'skipped') { if (byEnv[r.env] && !byEnv[r.env][k]) skipped.add(r.env + ':' + k); return; }
        if (x.scriptId && x.outcome === 'pass' && r.source !== 'ci' && !String(x.evidence || '').trim()) { noEvidence.add(k); return; }
        const v = { outcome: x.outcome, runId: r.id, at: r.at || null, by: r.by || null };
        if (byEnv[r.env]) { byEnv[r.env][k] = x.outcome; skipped.delete(r.env + ':' + k); }
        if (ph) phase[ph][k] = v;
      });
    });
    const held = heldTests(docs, project.id);
    const statusOf = k => {
      const s = phase.system[k] && phase.system[k].outcome, b = phase.uat[k] && phase.uat[k].outcome;
      if (held[k]) return 'fix';
      if (s === 'fail' || b === 'fail') return 'failed';
      if (b === 'blocked') return 'blocked';
      if (b === 'pass') return 'passed';
      return 'notRun';
    };
    const status = {}; ids.forEach(k => { status[k] = statusOf(k); });
    const stageCount = (key, list_) => {
      const m = phase[key], o = { total: list_.length, passed: 0, failed: 0, blocked: 0, notRun: 0 };
      list_.forEach(k => {
        const v = m[k] && m[k].outcome;
        if (held[k] && v) o.failed++;
        else if (v === 'pass') o.passed++;
        else if (v === 'fail') o.failed++;
        else if (v === 'blocked') o.blocked++;
        else o.notRun++;
      });
      o.run = runs.some(r => stageOfEnv(r.env) === key);
      return o;
    };
    const system = Object.assign({ key: 'system', label: 'Try it out' }, stageCount('system', caseIds));
    const uat = Object.assign({ key: 'uat', label: 'Business sign-off' }, stageCount('uat', ids));
    system.done = !caseIds.length || (system.run && !system.failed);
    uat.done = !ids.length || uat.passed === ids.length;
    // coverage
    const elements = changed.map(x => {
      const d = dataIdx[x.dataId] || { id: x.dataId };
      const mine = cases.filter(c => c.dataId === x.dataId);
      const fields = (d.fields || []).filter(Boolean);
      const unc = fields.filter(f => !mine.some(c => c.kind !== 'custom' && tokens(c.field) === tokens(f.name))).map(f => f.name);
      const state = !mine.length ? 'no-cases' : unc.length ? 'fields-missing' : 'covered';
      return { dataId: x.dataId, name: d.name || 'some information', reason: x.reason, cases: mine.length, fields: fields.length, fieldsCovered: fields.length - unc.length,
        uncoveredFields: unc, covered: state === 'covered', state };
    });
    const procs = linkedProcesses(docs, project);
    const scriptGaps = [];
    procs.forEach(p => {
      const diff = diffProcess(p);
      flatSteps(p.tobe).concat(flatGateways(p.tobe)).forEach(s => {
        const st = diff.nodes[s.id];
        if ((st === 'new' || st === 'changed') && !scripts.some(x => x.pid === p.id && x.step === s.id)) scriptGaps.push({ pid: p.id, step: s.id, title: s.title || 'untitled step' });
      });
    });
    const used = [...new Set(procs.flatMap(p => flatSteps(p.tobe).flatMap(stepData)))];
    const notChanged = used.filter(id => !changedSet.has(id)).map(id => ({ dataId: id, name: (dataIdx[id] && dataIdx[id].name) || 'some information',
      cases: list(docs, 'testCase').filter(c => c.dataId === id).length }));
    const notCovered = elements.filter(e => !e.covered);
    const uncoveredFields = [];
    elements.forEach(e => e.uncoveredFields.forEach(f => uncoveredFields.push({ dataId: e.dataId, field: f })));
    const fieldsTotal = elements.reduce((a, e) => a + e.fields, 0);
    const coverage = { denominator: 'information this project changes', elements, needTests: elements.length, haveTests: elements.length - notCovered.length,
      notCovered: notCovered.map(e => e.dataId), noCases: elements.filter(e => e.state === 'no-cases').map(e => e.dataId),
      uncoveredFields, fieldsTotal, fieldsCovered: fieldsTotal - uncoveredFields.length, scriptGaps,
      gaps: notCovered.length + scriptGaps.length, notChanged };
    const work = list(docs, 'workItem').filter(w => w.projectId === project.id);
    const defects = work.filter(w => w.kind === 'defect' && w.status !== 'done').map(w => w.id);
    const n = s => ids.filter(k => status[k] === s);
    return { project, cases, scripts, caseIds, scriptIds, ids, runs, phase, byEnv, skipped, noEvidence, held, status, stages: { system, uat }, coverage, defects,
      passed: n('passed'), failed: n('failed'), fix: n('fix'), blocked: n('blocked'), notRun: n('notRun'), changed };
  }

  // R11 §2 separation of duties for approving one team's part. Nobody approves a part when they are the project
  // manager, the launch owner, own a step in that part, or recorded any test result for that part's tests. The
  // Admin role grants no exemption. Returns null when the person may approve, else {rule, text}.
  function partBars(docs, project, bu, ctx) {
    ctx = ctx || {};
    const people = personMap(docs);
    const sc = ctx.scope || sectionScope(docs, project, bu);
    const tests = new Set(sc.caseIds.concat(sc.scriptIds));
    const runs = ctx.runs || list(docs, 'testRun').filter(r => r.projectId === project.id);
    const recorders = [...new Set(runs.filter(r => r.by && (r.results || []).some(x => { const k = x && (x.caseId || x.scriptId); return k && tests.has(k); })).map(r => r.by))].sort();
    const stepOwners = [...new Set(sc.steps.map(x => x.s.owner).filter(Boolean))].sort();
    return { recorders, stepOwners, pm: project.owner || null, launchOwner: project.releaseManager || project.owner || null, people };
  }
  function approvalBar(docs, prj, bu, personId, ctx) {
    const project = projOf(docs, prj);
    if (!project || !personId) return { rule: 'unknown', text: 'Choose who approves.' };
    const b = ctx && ctx.bars ? ctx.bars : partBars(docs, project, bu, ctx);
    const nm = nameOf(docs, personId);
    if (personId === b.pm) return { rule: 'project-manager', text: nm + ' is the project manager, so they can’t approve a team’s part.' };
    if (personId === b.launchOwner) return { rule: 'launch-owner', text: nm + ' is the launch owner, so they can’t approve a team’s part.' };
    if (b.stepOwners.includes(personId)) return { rule: 'step-owner', text: nm + ' does steps in ' + bu + '’s part, so someone else must approve it.' };
    if (b.recorders.includes(personId)) return { rule: 'recorded-tests', text: nm + ' recorded test results for ' + bu + '’s part, so someone else must approve it.' };
    return null;
  }

  function readiness(docs, projectId, today) {
    const project = get(docs, 'project', projectId);
    if (!project) {
      const checks = [finishCheck({ id: 'project', label: 'Project exists', pass: false, detail: 'This project could not be found.', items: [] })];
      return { pass: false, checks, summary: summarize(checks) };
    }
    // Released projects: report the gate as evaluated at release; never re-evaluate (promotion must not fail it).
    if (project.status === 'live') {
      const rel = latestBy(list(docs, 'release').filter(r => r.projectId === projectId && r.kind !== 'rollback'), 'at');
      const checks = rel && Array.isArray(rel.checks) ? rel.checks.map(c => finishCheck(Object.assign({}, c))) : [];
      return { released: true, releasedAt: rel ? rel.at || null : null, versions: rel && rel.snapshot || null, pass: true, checks, summary: summarize(checks), signoffOpen: false };
    }
    const people = personMap(docs);
    const procs = linkedProcesses(docs, project);
    const steps = [];
    procs.forEach(p => flatSteps(p.tobe).forEach(s => steps.push({ pid: p.id, s })));
    const usedData = [...new Set(steps.flatMap(x => stepData(x.s)))];
    const dataIdx = byId(list(docs, 'dataElement'));
    const dn = d => (dataIdx[d] && dataIdx[d].name) || 'an unknown data element';
    const pn = id => (people[id] && people[id].name) || 'an unassigned person';
    const work = list(docs, 'workItem').filter(w => w.projectId === projectId);
    const workIdx = byId(work);
    const wt = id => (workIdx[id] && workIdx[id].title) || 'a deleted work item';
    const checks = [];
    const { buOf, peopleBus, stepBus } = sectionHelpers(people);
    const stepBuIdx = {};
    steps.forEach(x => { stepBuIdx[x.pid + '/' + x.s.id] = stepBus(x.s); });
    // R8: a defect raised from a test belongs to the sections that test covers (not to its owner's team).
    const workBus = w => stepBuIdx[w.pid + '/' + w.step] || (w.testRef && (w.testRef.caseId || w.testRef.scriptId) ? testBus(w.testRef.caseId || w.testRef.scriptId) : null) || [buOf(w.owner)].filter(Boolean);
    // R8 the sections a test covers: a data case → the sections whose steps use that information; a UAT script → the
    // sections of its step (a gateway script: of the steps in its branches).
    const testBus = id => {
      const tc = get(docs, 'testCase', id);
      if (tc) return [...new Set(steps.filter(x => stepData(x.s).includes(tc.dataId)).flatMap(x => stepBuIdx[x.pid + '/' + x.s.id] || []))];
      const sc = (Array.isArray(project.uatScripts) ? project.uatScripts : generateUatScripts(docs, projectId)).concat(Array.isArray(project.uatScenarios) ? project.uatScenarios : []).find(x => x && x.id === id);
      if (!sc) return [];
      if (stepBuIdx[sc.pid + '/' + sc.step]) return stepBuIdx[sc.pid + '/' + sc.step];
      const p = procs.find(pp => pp.id === sc.pid);
      const g = p && flatGateways(p.tobe).find(x => x.id === sc.step);
      const own = g ? flatSteps((g.branches || []).flatMap(b => (b && b.nodes) || [])).flatMap(x => stepBuIdx[sc.pid + '/' + x.id] || []) : [];
      return [...new Set(own.length ? own : steps.filter(x => (sc.data || []).some(d => stepData(x.s).includes(d))).flatMap(x => stepBuIdx[x.pid + '/' + x.s.id] || []))];
    };
    const triggers = p => allNodes(p.tobe).filter(n => n.type === 'trigger');
    const procBus = p => [...new Set(flatSteps(p.tobe).flatMap(stepBus).concat(triggers(p).flatMap(stepBus)))];

    // work-done
    const open = work.filter(w => w.status !== 'done');
    checks.push({ id: 'work-done', label: 'All work items done', pass: open.length === 0,
      detail: open.length ? open.length + ' of ' + nWord(work.length, 'work item') + ' ' + isAre(open.length) + ' still open: ' + joinList(open.map(w => w.title || 'untitled item'), 5) + '.'
        : 'All ' + nWord(work.length, 'work item') + ' ' + isAre(work.length) + ' done.', items: open.map(w => w.id) });

    // data-live: examples-only data fails here (it needs a live source before go-live).
    const av = availMap(docs);
    const missing = usedData.filter(d => (av[d] || 'missing') === 'missing');
    const examples = usedData.filter(d => av[d] === 'example' || av[d] === 'unchecked');
    const pendingD = usedData.filter(d => av[d] === 'pending');
    const problemD = usedData.filter(d => av[d] === 'problem');
    const dl = [];
    if (problemD.length) dl.push(joinList(problemD.map(dn)) + ' ' + (problemD.length === 1 ? 'has' : 'have') + ' an open problem.');
    if (missing.length) dl.push(joinList(missing.map(dn)) + ' ' + isAre(missing.length) + ' missing.');
    if (examples.length) dl.push(joinList(examples.map(dn)) + ' ' + (examples.length === 1 ? 'has' : 'have') + ' examples only and need' + (examples.length === 1 ? 's' : '') + ' a live source before go-live.');
    pendingD.forEach(d => {
      const ev = evidenceOf(docs, dataIdx[d]);
      dl.push(dn(d) + (ev && !ev.ok && ev.reason ? ': live evidence does not hold (' + ev.reason + '); awaiting ' : ': fix done, awaiting ') + pn(dataIdx[d] && dataIdx[d].owner) + ' to confirm it is live with evidence.');
    });
    const attested = usedData.filter(d => av[d] === 'live' && (evidenceOf(docs, dataIdx[d]) || {}).type === 'attested');
    if (attested.length) dl.push(joinList(attested.map(dn)) + ' ' + (attested.length === 1 ? 'is' : 'are') + ' live on attested evidence only (a link and a note), which is weaker than a profile or connection check.');
    if (!dl.length) dl.push('All ' + nWord(usedData.length, 'data element') + ' ' + isAre(usedData.length) + ' live.');
    checks.push({ id: 'data-live', label: 'Required data is live', pass: !missing.length && !examples.length && !pendingD.length && !problemD.length, soft: attested.length > 0, detail: dl.join(' '),
      items: missing.concat(examples, pendingD, problemD), missing, examples, pending: pendingD, problems: problemD, attested,
      awaiting: pendingD.map(d => ({ dataId: d, owner: (dataIdx[d] && dataIdx[d].owner) || null, text: 'awaiting ' + pn(dataIdx[d] && dataIdx[d].owner) + ' to confirm' })) });

    // discovered-resolved. Items are "<dataId>#<index>".
    const unresolved = [], perData = {};
    usedData.forEach(d => ((dataIdx[d] && dataIdx[d].discovered) || []).forEach((x, i) => { if (x && !x.resolved) { unresolved.push(d + '#' + i); perData[d] = (perData[d] || 0) + 1; } }));
    checks.push({ id: 'discovered-resolved', label: 'Discovered requirements resolved', pass: unresolved.length === 0,
      detail: unresolved.length ? joinList(Object.keys(perData).map(d => nWord(perData[d], 'discovered requirement') + ' on ' + dn(d))) + ' ' + isAre(unresolved.length) + ' not resolved.'
        : 'No open discovered requirements.', items: unresolved });

    // process-valid
    const problems = [];
    const procExists = id => !!get(docs, 'process', id);
    procs.forEach(p => {
      const ids = allNodeIds(p.tobe);
      const where = ' in ' + (p.name || 'a linked process');
      // R6: wait and message nodes need no owner; a subprocess must call an existing (other) process.
      flatSteps(p.tobe).forEach(s => {
        if (!s.owner && !String(s.ownerRole || '').trim() && s.type !== 'wait' && s.type !== 'message') problems.push({ pid: p.id, node: s.id, problem: 'Step "' + (s.title || 'untitled') + '"' + where + ' has no owner' });
        if (s.type === 'subprocess') {
          if (!s.calls || !procExists(s.calls)) problems.push({ pid: p.id, node: s.id, problem: 'Subprocess "' + (s.title || 'untitled') + '"' + where + (s.calls ? ' calls a process that does not exist' : ' does not say which process it calls') });
          else if (s.calls === p.id) problems.push({ pid: p.id, node: s.id, problem: 'Subprocess "' + (s.title || 'untitled') + '"' + where + ' calls its own process' });
        }
      });
      flatGateways(p.tobe).forEach(g => {
        const br = g.branches || [];
        if (!br.some(b => b && ((b.nodes || []).length || b.goto))) problems.push({ pid: p.id, node: g.id, problem: 'Gateway "' + (g.title || 'untitled') + '"' + where + ' has only empty branches' });
        br.forEach(b => { if (b && b.goto && !ids.has(b.goto)) problems.push({ pid: p.id, node: g.id, problem: 'Branch "' + (b.label || 'unlabelled') + '" of "' + (g.title || 'untitled') + '"' + where + ' loops back to a step that no longer exists' }); });
      });
    });
    checks.push({ id: 'process-valid', label: 'Process design is valid', pass: problems.length === 0,
      detail: problems.length ? problems.map(x => x.problem).join('. ') + '.' : 'Every step has an owner (a person or a role) and every gateway is well formed.',
      items: problems.map(x => x.pid + ':' + x.node), problems });

    // tests-passed (environments dev | sit | uat | prod-verify):
    //  - each case/script outcome per env = its latest real result across ALL runs of that env for this project;
    //    'not-run' (JUnit <skipped/>) never overrides an earlier result and is reported as skipped;
    //    a UAT script/scenario 'pass' without evidence counts only when the run's source is 'ci';
    //  - zero fails in dev and SIT; UAT covers every data case, UAT script and saved scenario with zero fail/blocked;
    //  - every spec field of each project data element has at least one non-custom case (elements without a
    //    spec need any case); no open defects.
    // R8: tests are needed only for information the project changes (new, fixed or rule changes). Stages: any
    // dev/sit/system run counts toward "Try it out" (system); uat runs toward "Business sign-off".
    // R11 §1: built from testFacts, the same facts testingTruth, perBU and the matrix read.
    const tf = testFacts(docs, project);
    const changedSet = new Set(tf.changed.map(x => x.dataId));
    const cases = tf.cases;
    const caseIdx = byId(cases);
    const scripts = tf.scripts;
    const scriptIdx = byId(scripts);
    const runs = tf.runs;
    const lastUat = latestBy(runs.filter(r => r.env === 'uat'), 'at');
    const sysRuns = runs.filter(r => stageOfEnv(r.env) === 'system');
    // a failure recorded in this project's runs blocks even for a test outside the counted scope (never counted)
    const outside = k => !tf.ids.includes(k);
    const failing = new Set(tf.failed.concat(Object.keys(tf.phase.system).concat(Object.keys(tf.phase.uat)).filter(k => outside(k) && ((tf.phase.system[k] || {}).outcome === 'fail' || (tf.phase.uat[k] || {}).outcome === 'fail'))));
    const blocked = new Set(tf.blocked), held = tf.fix.slice();
    const unrun = tf.notRun.slice();
    const changedData = usedData.filter(d => changedSet.has(d));
    const noCases = tf.coverage.noCases.slice();
    const uncoveredFields = tf.coverage.uncoveredFields.slice();
    const scriptGaps = tf.coverage.scriptGaps.slice();
    const defects = tf.defects.slice();
    const noEvidence = tf.noEvidence;
    const missingRuns = [cases.length && !sysRuns.length ? 'system' : null, (cases.length || scripts.length) && !lastUat ? 'uat' : null].filter(Boolean);
    const tname = id => caseIdx[id] ? dn(caseIdx[id].dataId) + ' ' + (caseLabel(docs, id) || 'case') + ' · ' + (caseIdx[id].field || 'case') + ' (' + (caseIdx[id].kind || 'case') + ')'
      : scriptIdx[id] ? 'UAT script "' + (scriptIdx[id].title || 'untitled') + '"' : 'a test outside this project';
    const tp = failing.size === 0 && blocked.size === 0 && held.length === 0 && unrun.length === 0 && defects.length === 0 && missingRuns.length === 0 && noCases.length === 0 && uncoveredFields.length === 0 && scriptGaps.length === 0;
    const skippedIds = [...new Set([...tf.skipped].map(x => x.slice(x.indexOf(':') + 1)))];
    const tDetail = [];
    if (missingRuns.length) tDetail.push('No ' + joinList(missingRuns.map(e => e === 'system' ? 'system test ("Try it out")' : 'UAT (business sign-off)')) + ' run has been recorded.');
    if (noCases.length) tDetail.push(joinList(noCases.map(dn)) + (noCases.length === 1 ? ' has' : ' have') + ' no test cases.');
    if (uncoveredFields.length) tDetail.push(nWord(uncoveredFields.length, 'spec field') + ' ' + (uncoveredFields.length === 1 ? 'has' : 'have') + ' no test case: ' + joinList(uncoveredFields.map(x => dn(x.dataId) + ' · ' + x.field), 4) + '.');
    if (scriptGaps.length) tDetail.push(nWord(scriptGaps.length, 'changed step') + ' ' + (scriptGaps.length === 1 ? 'has' : 'have') + ' no business check script: ' + joinList(scriptGaps.map(x => '"' + x.title + '"'), 3) + '.');
    if (held.length) tDetail.push(nWord(held.length, 'test') + ' ' + (held.length === 1 ? 'waits' : 'wait') + ' for an open problem to be fixed: ' + joinList(held.map(tname), 3) + '.');
    if (failing.size) tDetail.push(nWord(failing.size, 'test') + ' failed on its latest run: ' + joinList([...failing].map(tname), 3) + '.');
    if (blocked.size) tDetail.push(nWord(blocked.size, 'test') + ' ' + (blocked.size === 1 ? 'was' : 'were') + ' blocked on the latest UAT result: ' + joinList([...blocked].map(tname), 3) + '.');
    if (unrun.length) tDetail.push(nWord(unrun.length, 'test') + ' ' + (unrun.length === 1 ? 'has' : 'have') + ' not passed the business check yet: ' + joinList(unrun.map(tname), 3) + '.');
    if (skippedIds.length) tDetail.push(nWord(skippedIds.length, 'test') + ' skipped.');
    if (noEvidence.size) tDetail.push(nWord(noEvidence.size, 'UAT script pass') + ' had no evidence and ' + (noEvidence.size === 1 ? 'does' : 'do') + ' not count.');
    if (defects.length) tDetail.push(nWord(defects.length, 'defect') + ' ' + isAre(defects.length) + ' still open: ' + joinList(defects.map(wt), 3) + '.');
    if (tp) tDetail.push(nWord(cases.length, 'data test case') + ' and ' + nWord(scripts.length, 'UAT script') + ' passed; no open defects.');
    const envSummary = {};
    ENVS.forEach(env => {
      const o = tf.byEnv[env] || {}, sm = { pass: 0, fail: 0, blocked: 0, skipped: 0 };
      Object.keys(o).forEach(k => { if (sm[o[k]] != null) sm[o[k]]++; });
      sm.skipped = [...tf.skipped].filter(x => x.startsWith(env + ':')).length;
      envSummary[env] = sm;
    });
    const allTests = tf.ids;
    const stages = { system: Object.assign({}, tf.stages.system), uat: Object.assign({}, tf.stages.uat) };
    checks.push({ id: 'tests-passed', label: 'Tests passed', pass: tp, detail: tDetail.join(' '),
      total: allTests.length, passed: tf.passed.length, stages, changedData, cases: cases.map(c => c.id),
      items: [...new Set([...failing, ...held, ...blocked, ...unrun, ...defects, ...noCases])], failing: [...failing], held, blocked: [...blocked], unrun, defects, noCases,
      uncoveredFields, scriptGaps, skipped: skippedIds, noEvidence: [...noEvidence], byEnv: envSummary, scripts: scripts.map(x => x.id), coverage: tf.coverage });

    // grants-closed: requested/approved block; active ones are expired automatically at go-live.
    const grants = list(docs, 'grant').filter(g => g.projectId === projectId);
    const gname = g => dn(g.dataId) + ' (' + String(g.env || '').toUpperCase() + ', ' + (g.access || 'access') + ')';
    // R11 §3: one set of words with grantCounts: waiting (requested) blocks; open (approved/active) closes at launch.
    const blockG = grants.filter(g => grantState(g, today) === 'waiting');
    const expG = grants.filter(g => grantState(g, today) === 'open');
    checks.push({ id: 'grants-closed', label: 'Access grants closed', pass: blockG.length === 0,
      detail: (blockG.length ? nWord(blockG.length, 'access request') + ' ' + (blockG.length === 1 ? 'is' : 'are') + ' waiting for approval: ' + joinList(blockG.map(gname)) + '. Approve or decline ' + (blockG.length === 1 ? 'it' : 'them') + ' first. ' : 'No access requests waiting for approval. ') +
        (expG.length ? nWord(expG.length, 'open grant') + ' close' + (expG.length === 1 ? 's' : '') + ' automatically at launch (' + joinList(expG.map(gname)) + ').' : 'Open grants close automatically at launch.'),
      items: blockG.concat(expG).map(g => g.id), blocking: blockG.map(g => g.id), expiring: expG.map(g => g.id) });

    // bu-signoff: latest approval per BU approved with step-up and not stale.
    // The project owner's approvals never count (independence of evidence).
    // The release manager (defaults to the owner) is excluded too (separation of duties).
    // R7: approvals count any time (no lock behind the other checks); staleness is scoped per section.
    const releaseManager = project.releaseManager || project.owner || null;
    const excluded = [...new Set([project.owner, releaseManager].filter(Boolean))];
    const allApprovals = list(docs, 'approval').filter(a => a.projectId === projectId && a.bu && !a.kind);
    const approvals = allApprovals.filter(a => !excluded.includes(a.approver));
    const ownerApprovals = allApprovals.length - approvals.length;
    // R8: only teams whose part changed (new/changed steps, changed triggers) or who own launch-plan tasks approve.
    const bus = sectionBus(docs, project, people);
    // R7 eligibility: BU members other than the PM and launch owner, plus project.approvers[bu] (never the PM or
    // launch owner). A section with nobody eligible needs an approver chosen; suggestion = the process owner.
    // R9 §13 separation of duties ("two different people"): when one person recorded every test result of a
    // section, that person cannot approve it; someone else must. Never a dead end: the section then needs an
    // approver chosen (needsApprover, sodBlockedBy names the recorder).
    // R11 §2: nobody approves a part they recorded test results for or do steps in (not only a sole recorder).
    const barsOf = {};
    bus.forEach(bu => { barsOf[bu] = partBars(docs, project, bu, { runs }); });
    const recordersOf = bu => barsOf[bu].recorders;
    const barOf = (bu, id) => approvalBar(docs, project, bu, id, { bars: barsOf[bu] });
    const validForRaw = bu => {
      const latest = latestBy(approvals.filter(a => a.bu === bu && !a.kind), 'at');
      return latest && latest.decision === 'approved' && latest.stepUp === true && !barOf(bu, latest.approver) ? latest : null;
    };
    const overrides = project.approvers && typeof project.approvers === 'object' ? project.approvers : {};
    const eligible = {}, sodBlocked = {}, barred = {};
    bus.forEach(bu => {
      const e = Object.keys(people).filter(id => people[id] && people[id].bu === bu && !excluded.includes(id));
      const o = overrides[bu];
      if (o && people[o] && !excluded.includes(o) && !e.includes(o)) e.push(o);
      const ok = e.filter(id => !barOf(bu, id));
      barred[bu] = e.filter(id => barOf(bu, id)).map(id => Object.assign({ person: id }, barOf(bu, id)));
      if (e.length && !ok.length) sodBlocked[bu] = barred[bu][0].person;
      eligible[bu] = ok;
    });
    const needsApprover = bus.filter(bu => !eligible[bu].length && !validForRaw(bu));
    const suggestions = {};
    needsApprover.forEach(bu => {
      const p = procs.find(pp => allNodes(pp.tobe).some(n => n && !isGateway(n) && stepBus(n).includes(bu)));
      const cand = [p && p.owner].concat(procs.map(pp => pp.owner), project.sponsor || null).find(id => id && people[id] && !excluded.includes(id) && !barOf(bu, id));
      suggestions[bu] = cand || null;
    });
    const noPerson = needsApprover;
    const validFor = bu => validForRaw(bu);
    const apprAt = a => String(a.snapshotAt || a.at || '');
    const coTasks = Array.isArray((project.cutover || {}).tasks) ? project.cutover.tasks.filter(Boolean) : [];
    const taskStamps = coTasks.some(t => t.updatedAt);
    const PART_LABEL = { s: 'its steps', d: 'its information', t: 'its tests', c: 'its launch-day tasks' };
    const changedSince = bu => {
      const a = validFor(bu); if (!a) return [];
      const t = apprAt(a), out = [];
      work.forEach(w => { if (w.updatedAt && String(w.updatedAt) > t && workBus(w).includes(bu)) out.push({ ref: 'workItem:' + w.id, label: w.title || 'untitled item' }); });
      // R8: a failed or blocked test result recorded after the approval stales only the sections that test covers.
      const hitRuns = new Set();
      runs.forEach(r => { if (!r.at || String(r.at) <= t) return; (r.results || []).forEach(x => {
        const k = x && (x.caseId || x.scriptId);
        if (k && (x.outcome === 'fail' || x.outcome === 'blocked') && testBus(k).includes(bu)) hitRuns.add(r.id);
      }); });
      hitRuns.forEach(id => out.push({ ref: 'testRun:' + id, label: 'a test result' }));
      if (a.fingerprint) {
        // R7 exact scope: compare the section's own content with what was approved.
        const was = fpParse(a.fingerprint), now = sectionParts(docs, project, bu);
        ['s', 'd', 't'].forEach(k => {
          if (was[k] == null || was[k] === now[k]) return;
          const sc = k === 's' ? partStepChanges(was.k, now, docs) : [];
          if (sc.length) sc.forEach(x => out.push({ ref: 'section:' + bu + '#s:' + x.key, label: x.text }));
          else out.push({ ref: 'section:' + bu + '#' + k, label: PART_LABEL[k] });
        });
        if (was.c != null && was.c !== now.c) out.push({ ref: 'project:' + project.id + '#cutover', label: 'the launch-day plan' });
        return out;
      }
      // Timestamps (approvals without a fingerprint). Launch-day plan: only sections owning affected tasks.
      const mine = coTasks.filter(x => taskBu(people, x) === bu);
      const coChanged = taskStamps ? mine.some(x => x.updatedAt && String(x.updatedAt) > t)
        : !!(project.cutoverUpdatedAt && String(project.cutoverUpdatedAt) > t && mine.length);
      if (coChanged) out.push({ ref: 'project:' + project.id + '#cutover', label: 'the launch-day plan' });
      procs.forEach(p => {
        if (!(p.updatedAt && String(p.updatedAt) > t)) return;
        const nodes = allNodes(p.tobe).filter(n => n && !isGateway(n));
        // Step-level stamps scope the change to the sections of the changed steps; else the whole process.
        const hit = nodes.some(n => n.updatedAt) ? nodes.some(n => n.updatedAt && String(n.updatedAt) > t && stepBus(n).includes(bu)) : procBus(p).includes(bu);
        if (hit) out.push({ ref: 'process:' + p.id, label: 'the ' + (p.name || 'linked') + ' process' });
      });
      return out;
    };
    const unsigned = bus.filter(bu => !needsApprover.includes(bu) && !validFor(bu));
    const stale = bus.filter(bu => validFor(bu)).map(bu => ({ bu, changed: changedSince(bu) })).filter(x => x.changed.length);
    const staleSet = new Set(stale.map(x => x.bu));
    const pnSafe = id => (people[id] && people[id].name) || null;
    const buDetail = [];
    if (!bus.length) buDetail.push("No team's part changed, so no approvals are needed.");
    needsApprover.forEach(b => buDetail.push((sodBlocked[b] ? barred[b].map(x => x.text).join(' ') + ' Choose who approves ' + b + "'s part." : 'No approver in ' + b + ': assign one.') + (suggestions[b] && pnSafe(suggestions[b]) ? ' Suggested: ' + pnSafe(suggestions[b]) + '.' : '')));
    if (unsigned.length) buDetail.push('Waiting for sign-off from ' + joinList(unsigned) + '.');
    stale.forEach(x => buDetail.push(x.bu + ': re-approval needed: ' + joinList(x.changed.map(c => c.label)) + (x.changed.every(c => /#s:/.test(c.ref)) ? ' (after sign-off).' : ' changed after sign-off.')));
    if (bus.length && !unsigned.length && !stale.length && !needsApprover.length) buDetail.push('All ' + nWord(bus.length, 'business unit') + ' approved with step-up: ' + joinList(bus) + '.');
    const exclNames = joinList(excluded.map(pn));
    const exclRole = excluded.length > 1 ? 'the project owner and release manager' : releaseManager === project.owner ? 'the project owner' : 'the release manager';
    if (ownerApprovals) buDetail.push('Approvals by ' + exclRole + ' (' + exclNames + ') do not count.');
    // Launch owner's own check: the launch-day plan changed after the latest current approval (informational).
    const currentAts = bus.filter(bu => validFor(bu) && !staleSet.has(bu)).map(bu => apprAt(validFor(bu))).sort();
    const coAt = [project.cutoverUpdatedAt].concat(coTasks.map(x => x.updatedAt)).filter(Boolean).map(String).sort().pop() || null;
    const launchOwnerReview = { person: releaseManager, needed: !!(coAt && currentAts.length && coAt > currentAts[currentAts.length - 1]) };
    const sectionStatus = bus.map(bu => ({ bu, approved: !!validFor(bu), approval: validFor(bu) ? validFor(bu).id || null : null, stale: staleSet.has(bu),
      needsApprover: needsApprover.includes(bu), eligible: eligible[bu].slice(), suggestion: suggestions[bu] || null, override: overrides[bu] || null,
      approver: validFor(bu) ? validFor(bu).approver || null : null, approvedAt: validFor(bu) ? validFor(bu).at || null : null,
      sodBlockedBy: sodBlocked[bu] || null, recorders: recordersOf(bu), stepOwners: barsOf[bu].stepOwners.slice(), barred: barred[bu].slice() }));
    // R9 §13: a team that does not need to approve is never a gate condition (no changed teams → nothing to approve).
    checks.push({ id: 'bu-signoff', label: 'Every business unit signed off', pass: unsigned.length === 0 && stale.length === 0 && needsApprover.length === 0,
      detail: buDetail.join(' '), items: needsApprover.concat(unsigned, stale.map(x => x.bu)), unsigned, noPerson, needsApprover, eligible, suggestions, sectionStatus, launchOwnerReview,
      sections: bus, excludedApprover: project.owner || null, excludedApprovers: excluded, releaseManager,
      stale: stale.map(x => ({ bu: x.bu, changed: x.changed.map(c => c.ref), details: x.changed.map(c => ({ ref: c.ref, label: c.label })), reason: 're-approval needed: ' + joinList(x.changed.map(c => c.label)),
        text: x.bu + ' must approve again: ' + joinList(x.changed.map(c => c.label)) + '.' })) });

    // two-person: approved, non-stale approvals only (matches the sign-off panel).
    const current = bus.filter(bu => validFor(bu) && !staleSet.has(bu)).map(validFor);
    const approvers = [...new Set(current.map(a => a.approver))];
    // R9 §13 deadlock-free: with one changed team, its one approval (never the PM, launch owner or the person who
    // recorded all its tests) already makes two different people; with none, nothing is needed.
    const tpPass = bus.length === 0 ? true : bus.length === 1 ? current.length === 1 : approvers.length >= 2;
    checks.push({ id: 'two-person', label: 'Two-person rule', pass: tpPass,
      detail: (bus.length === 0 ? "No team's part changed, so no approvals are needed."
        : bus.length === 1 && current.length === 1 ? 'Approved by ' + pn(approvers[0]) + '; only one team\'s part changed, so one approval is enough.'
        : approvers.length >= 2 ? 'Approved by ' + joinList(approvers.map(pn)) + '.'
        : approvers.length === 1 ? 'Only ' + pn(approvers[0]) + ' has a current approval; a second approver is needed.'
        : 'No current approvals; two different approvers are needed.') + (ownerApprovals ? ' ' + capFirst(exclRole) + ' (' + exclNames + ') ' + (excluded.length > 1 ? 'do' : 'does') + ' not count.' : ''), items: approvers });

    // cutover-plan: rollback owner, rollback plan and hypercare owner set; at least one runbook task; every
    // go/no-go task has an owner.
    const co = project.cutover || {};
    const coLabels = { rollbackOwner: 'rollback owner', rollbackPlan: 'rollback plan', hypercareOwner: 'hypercare owner' };
    const missingCo = Object.keys(coLabels).filter(k => !(co[k] && String(co[k]).trim()));
    const tasks = Array.isArray(co.tasks) ? co.tasks.filter(Boolean) : [];
    const gonogoNoOwner = tasks.filter(x => x.gonogo && !String(x.owner || '').trim());
    const coDetail = [];
    const notSet = (tasks.length ? [] : ['a runbook task']).concat(missingCo.map(k => coLabels[k]));
    if (notSet.length) coDetail.push(capFirst(joinList(notSet)) + ' ' + (notSet.length === 1 ? 'is' : 'are') + ' not set.');
    if (gonogoNoOwner.length) coDetail.push(nWord(gonogoNoOwner.length, 'go/no-go task') + ' ' + (gonogoNoOwner.length === 1 ? 'has' : 'have') + ' no owner: ' + joinList(gonogoNoOwner.map(x => '"' + (x.task || x.step || x.title || 'untitled task') + '"')) + '.');
    if (!coDetail.length) coDetail.push('Rollback owner (' + pn(co.rollbackOwner) + '), rollback plan, hypercare owner (' + pn(co.hypercareOwner) + ') and ' + nWord(tasks.length, 'runbook task') + ' are set.');
    // R10 §3: the launch window must be a business day (never a weekend or a holiday)
    const lw = launchWindowProblem(windowDate(co.window));
    if (lw) coDetail.unshift('The launch window is on ' + lw + '; pick a business day.');
    checks.push({ id: 'cutover-plan', label: 'Cutover and rollback plan', pass: !missingCo.length && tasks.length > 0 && !gonogoNoOwner.length && !lw,
      detail: coDetail.join(' '), items: missingCo.concat(tasks.length ? [] : ['tasks'], gonogoNoOwner.map(x => 'task:' + (x.id || x.task || x.step || '')), lw ? ['window'] : []) });

    // exceptions (warning only), R6: computed from the same staleness function (changedSince) as bu-signoff, so the
    // two always agree. Items: work ids, "process:<id>" and "cutover". Stale ones block through bu-signoff.
    const excRefs = new Map();
    const cutoverBus = [];
    stale.forEach(x => x.changed.forEach(c => {
      if (/#cutover$/.test(c.ref)) { if (!cutoverBus.includes(x.bu)) cutoverBus.push(x.bu); return; }
      if (!excRefs.has(c.ref)) excRefs.set(c.ref, c);
    }));
    const excList = [...excRefs.values()];
    const excW = excList.filter(c => c.ref.startsWith('workItem:')), excP = excList.filter(c => c.ref.startsWith('process:'));
    const excS = excList.filter(c => c.ref.startsWith('section:') && !/#s:/.test(c.ref));
    // R11: step-level changes say which step and what changed, grouped per team
    const excSS = {}; excList.filter(c => /^section:[^#]+#s:/.test(c.ref)).forEach(c => { const b = c.ref.slice(8, c.ref.indexOf('#')); (excSS[b] = excSS[b] || []).push(c.label); });
    const excNames = excW.map(c => '"' + c.label + '"').concat(excP.map(c => c.label), excS.map(c => c.ref.slice(8, c.ref.indexOf('#')) + "'s " + c.label.replace(/^its /, '')));
    const exDetail = [];
    if (excNames.length) exDetail.push(capFirst(joinList(excNames, 5)) + (excNames.length === 1 ? ' was' : ' were') + ' changed after sign-off; ' + (excNames.length === 1 ? 'its section needs' : 'those sections need') + ' re-approval.');
    Object.keys(excSS).sort().forEach(b => exDetail.push(b + "'s steps changed after sign-off (" + joinList(excSS[b], 5) + '); its section needs re-approval.'));
    if (cutoverBus.length) exDetail.push('Cutover plan changed after ' + joinList(cutoverBus.slice().sort()) + ' sign-off.');
    // Runbook (R6): an open task whose planned start + duration has passed is overdue (warning). `today` may carry
    // a time (ISO date-time); a date alone means the start of that day (UTC).
    const nowMs = /T\d/.test(String(today || '')) && !isNaN(Date.parse(today)) ? Date.parse(today) : toMs(today);
    const overdueTasks = (Array.isArray(co.tasks) ? co.tasks.filter(Boolean) : []).filter(t => {
      if (t.done || !t.plannedStart) return false;
      const st = Date.parse(/T\d/.test(String(t.plannedStart)) ? t.plannedStart : String(t.plannedStart).slice(0, 10) + 'T00:00:00Z');
      return !isNaN(st) && !isNaN(nowMs) && st + (isFinite(+t.durationMins) ? +t.durationMins : 0) * 60000 < nowMs;
    });
    if (overdueTasks.length) exDetail.push(nWord(overdueTasks.length, 'runbook task') + ' ' + isAre(overdueTasks.length) + ' overdue: ' + joinList(overdueTasks.map(t => '"' + (t.task || t.title || 'untitled task') + '"'), 3) + '.');
    checks.push({ id: 'exceptions', label: 'Changes after sign-off', pass: excNames.length === 0 && !Object.keys(excSS).length && cutoverBus.length === 0 && overdueTasks.length === 0, warning: true,
      detail: exDetail.length ? exDetail.join(' ') : 'No work or process changed after sign-off.',
      items: excW.map(c => c.ref.slice('workItem:'.length)).concat(excP.map(c => c.ref), excS.map(c => c.ref), excList.filter(c => /^section:[^#]+#s:/.test(c.ref)).map(c => c.ref), cutoverBus.length ? ['cutover'] : [], overdueTasks.map(t => 'task:' + (t.id || t.task || ''))),
      cutoverBus, overdueTasks: overdueTasks.map(t => t.id || t.task || '') });

    checks.forEach(finishCheck);
    // R7: signoffOpen is informational only (every other blocking check passes); approvals count any time.
    const signoffOpen = checks.filter(c => !c.warning && c.id !== 'bu-signoff' && c.id !== 'two-person').every(c => c.pass);
    const out = { pass: checks.filter(c => !c.warning).every(c => c.pass), checks, summary: summarize(checks), signoffOpen };
    Object.defineProperty(out, '_tf', { value: tf, enumerable: false });   // R11: testingTruth reads the same facts
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* UAT scripts                                                         */
  /* ------------------------------------------------------------------ */
  function slug(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'branch'; }
  // One script per new/changed to-be step plus one per gateway branch. Deterministic ids:
  // uat-<pid>-<step> and uat-<pid>-<gatewayId>-<branch-label-slug>. Each script has `steps: [{action, expected}]`,
  // one per sub-step (falling back to the step title). All text uses names, never ids.
  function generateUatScripts(docs, projectId) {
    const project = get(docs, 'project', projectId);
    if (!project) return [];
    const people = personMap(docs);
    const data = byId(list(docs, 'dataElement'));
    const pname = id => (people[id] && people[id].name) || 'the step owner';
    const dname = d => (data[d] && data[d].name) || 'the required data';
    const out = [], ids = new Set();
    const push = sc => { let id = sc.id, k = 2; while (ids.has(id)) id = sc.id + '-' + k++; ids.add(id); out.push(Object.assign(sc, { id })); };
    linkedProcesses(docs, project).forEach(p => {
      const diff = diffProcess(p);
      const titles = {};
      const walk = nodes => (nodes || []).forEach(n => { if (!n) return; titles[n.id] = n.title || 'an earlier step'; (n.branches || []).forEach(b => walk(b && b.nodes)); });
      walk(p.tobe);
      const asis = byId(flatSteps(p.asis));
      flatSteps(p.tobe).forEach(s => {
        const st = diff.nodes[s.id];
        if (st !== 'new' && st !== 'changed') return;
        const sd = stepData(s);
        const title = s.title || 'Untitled step';
        const subs = (s.subs || []).filter(x => x && x.title);
        const stepsArr = (subs.length ? subs : [{ title, data: s.data || [] }]).map(x => ({
          action: pname(s.owner) + ': ' + x.title + ((x.data || []).length ? ' using ' + joinList(x.data.map(dname)) : '') + (s.system ? ' in ' + s.system : ''),
          expected: (x.data || []).length ? joinList(x.data.map(dname)) + ' ' + ((x.data || []).length === 1 ? 'is' : 'are') + ' recorded correctly' : '"' + x.title + '" is completed and recorded',
        }));
        // Plain-English verification of what changed vs as-is (names, not ids).
        const was = s.from && asis[s.from];
        const verify = [];
        if (st === 'new') verify.push('this new step runs as designed');
        if (was && was.title !== s.title) verify.push('the old step "' + (was.title || '') + '" is replaced');
        if (was && was.owner !== s.owner) verify.push(pname(s.owner) + ' now owns the step instead of ' + pname(was.owner));
        if (was) { const added = (s.data || []).filter(d => !(was.data || []).includes(d)); if (added.length) verify.push(joinList(added.map(dname)) + ' ' + (added.length === 1 ? 'is' : 'are') + ' now used'); }
        if (s.sla) verify.push('the step completes within ' + s.sla);
        push({ id: 'uat-' + p.id + '-' + s.id, pid: p.id, step: s.id, title,
          given: sd.length ? capFirst(joinList(sd.map(dname))) + (sd.length > 1 ? ' are' : ' is') + ' available in UAT' : 'The process has reached "' + title + '"',
          when: pname(s.owner) + ' performs "' + title + '"',
          then: 'The step completes' + (s.system ? ' in ' + s.system : '') + (s.sla ? ' within ' + s.sla : '') + ' and its output is recorded' + (verify.length ? '; verify that ' + joinList(verify) : ''),
          steps: stepsArr, data: sd });
      });
      flatGateways(p.tobe).forEach(g => (g.branches || []).forEach((b, i) => {
        if (!b) return;
        const label = b.label || 'branch ' + (i + 1);
        const bSteps = flatSteps(b.nodes);
        const first = bSteps[0];
        const bd = [...new Set(bSteps.flatMap(stepData))];
        const then = b.goto ? 'The flow returns to "' + (titles[b.goto] || 'an earlier step') + '"' : first ? 'The flow continues to "' + (first.title || 'the next step') + '"' : 'The flow continues to the next step';
        push({ id: 'uat-' + p.id + '-' + g.id + '-' + slug(b.label || String(i + 1)), pid: p.id, step: g.id,
          title: (g.title || 'Gateway') + ' → ' + label,
          given: 'The process reaches "' + (g.title || 'the gateway') + '"',
          when: g.type === 'parallel' ? 'Branch "' + label + '" runs in parallel' : 'The outcome is "' + label + '"',
          then,
          steps: [{ action: 'Drive the process to "' + (g.title || 'the gateway') + '" with ' + (g.type === 'parallel' ? 'branch "' + label + '" running' : 'the outcome "' + label + '"'), expected: then }]
            .concat(bSteps.map(x => ({ action: pname(x.owner) + ': ' + (x.title || 'next step'), expected: '"' + (x.title || 'The step') + '" is completed and recorded' }))),
          data: bd });
      }));
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* CSV profiling (statistics only, never raw values)                   */
  /* ------------------------------------------------------------------ */
  // RFC 4180-style parser: quoted fields, "" escapes, commas/newlines inside quotes, CRLF/LF/CR.
  function parseCsv(text) {
    const s = String(text == null ? '' : text).replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', inQ = false, quoted = false;
    const endRow = () => {
      row.push(field);
      if (!(row.length === 1 && row[0] === '' && !quoted)) rows.push(row);
      row = []; field = ''; quoted = false;
    };
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') { inQ = true; quoted = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { if (s[i + 1] === '\n') i++; endRow(); }
      else if (c === '\n') endRow();
      else field += c;
    }
    if (field !== '' || row.length || quoted) endRow();
    return rows;
  }

  const RE_LU = /\p{Lu}/u, RE_L = /\p{L}/u, RE_DIGIT = /[0-9]/, RE_ALNUM_SPACE = /[\p{L}\p{N}\s]/u;
  function chars(v) { return Array.from(String(v)); }
  function shapeChar(c) { if (RE_DIGIT.test(c)) return '9'; if (RE_LU.test(c)) return 'A'; if (RE_L.test(c)) return 'a'; return c; }
  function maskChar(c) { if (RE_DIGIT.test(c)) return '9'; if (RE_LU.test(c)) return 'X'; if (RE_L.test(c)) return 'x'; return c; }
  // Raw shape (no collapse): digits→9, upper→A, lower→a, others kept.
  function shapeOf(v) { return chars(v).map(shapeChar).join(''); }
  // Collapsed pattern: runs of the same shape char become X{n}, e.g. "021000021" → "9{9}".
  function collapse(shape) {
    const cs = chars(shape); let out = '';
    for (let i = 0; i < cs.length;) { let j = i; while (j < cs.length && cs[j] === cs[i]) j++; out += cs[i] + (j - i > 1 ? '{' + (j - i) + '}' : ''); i = j; }
    return out;
  }
  function patternOf(v) { return collapse(shapeOf(v)); }
  // Expand a collapsed pattern back into a synthetic string (digits 1-9-0 cycle, letters A-Z/a-z cycle).
  function expandPattern(p) {
    const D = '1234567890', U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', L = 'abcdefghijklmnopqrstuvwxyz';
    const out = []; let di = 0, ui = 0, li = 0;
    const re = /(.)(?:\{(\d+)\})?/gu; let m;
    while ((m = re.exec(p))) {
      const n = m[2] ? +m[2] : 1;
      for (let k = 0; k < n; k++) out.push(m[1] === '9' ? D[di++ % 10] : m[1] === 'A' ? U[ui++ % 26] : m[1] === 'a' ? L[li++ % 26] : m[1]);
    }
    return out.join('');
  }
  // Plain-English description of a collapsed pattern: '9{8}' → '8 digits', 'Aa{5} Aa{6}' → 'two capitalized words',
  // '9{2}-9{7}' → '2 digits, a hyphen, 7 digits'.
  const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const PUNCT = { '-': 'a hyphen', ' ': 'a space', '.': 'a period', ',': 'a comma', '/': 'a slash', '@': 'an @ sign', '_': 'an underscore', '(': 'an opening parenthesis', ')': 'a closing parenthesis', "'": 'an apostrophe', '&': 'an ampersand', '#': 'a # sign', '+': 'a plus sign', ':': 'a colon', '$': 'a dollar sign', '"': 'a quotation mark' };
  function humanPattern(p) {
    const runs = []; const re = /(.)(?:\{(\d+)\})?/gu; let m;
    while ((m = re.exec(String(p || '')))) runs.push({ c: m[1], n: m[2] ? +m[2] : 1 });
    const units = [];
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i], nx = runs[i + 1];
      if (r.c === 'A' && r.n === 1 && nx && nx.c === 'a') { units.push({ k: 'cap' }); i++; }
      else if (r.c === 'a') units.push({ k: 'lower' });
      else if (r.c === 'A') units.push({ k: 'upper', n: r.n });
      else if (r.c === '9') units.push({ k: 'digits', n: r.n });
      else units.push({ k: 'punct', c: r.c, n: r.n });
    }
    if (!units.length) return 'empty';
    const words = units.filter((u, i) => i % 2 === 0), seps = units.filter((u, i) => i % 2 === 1);
    const kinds = { cap: 'capitalized', lower: 'lowercase' };
    if (units.length % 2 === 1 && kinds[words[0].k] && words.every(u => u.k === words[0].k) && seps.every(u => u.k === 'punct' && u.c === ' ' && u.n === 1))
      return words.length === 1 ? 'a ' + kinds[words[0].k] + ' word' : (NUMW[words.length] || words.length) + ' ' + kinds[words[0].k] + ' words';
    return units.map(u => u.k === 'digits' ? nWord(u.n, 'digit') : u.k === 'cap' ? 'a capitalized word' : u.k === 'lower' ? 'a lowercase word'
      : u.k === 'upper' ? nWord(u.n, 'capital letter') : (u.n > 1 ? u.n + ' × ' : '') + (PUNCT[u.c] || '"' + u.c + '"')).join(', ');
  }
  // Humanize and merge: patterns with the same description are combined, counts summed, order by count.
  function humanPatterns(patterns) {
    const m = {}, order = [];
    (patterns || []).forEach(p => { const t = humanPattern(p.pattern); if (!(t in m)) { m[t] = 0; order.push(t); } m[t] += p.count || 0; });
    return order.map(t => ({ text: t, count: m[t] })).sort((a, b) => b.count - a.count);
  }
  // Masking: keep first and last char; digits→9, letters→x/X, punctuation and spaces kept.
  // Values of 1–2 chars are fully masked. If the result would equal the raw value, mask fully;
  // if that still equals it (e.g. "999"), replace with '*'.
  function maskValue(v) {
    const cs = chars(v);
    const full = cs.map(maskChar).join('');
    // R8: every digit is hidden (no first/last digit shown); a first/last letter or symbol may stay.
    const keep = c => !RE_DIGIT.test(c);
    let m = cs.length <= 2 ? full : (keep(cs[0]) ? cs[0] : maskChar(cs[0])) + cs.slice(1, -1).map(maskChar).join('') + (keep(cs[cs.length - 1]) ? cs[cs.length - 1] : maskChar(cs[cs.length - 1]));
    if (m === String(v)) m = full;
    if (m === String(v)) m = '*'.repeat(cs.length);
    return m;
  }
  const RE_NUM = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

  function profileCsv(csvText, opts) {
    const maxRows = opts && opts.maxRows > 0 ? opts.maxRows : 50000;
    const rows = parseCsv(csvText);
    if (!rows.length) return [];
    const header = rows[0].map((h, i) => String(h).trim() || 'column_' + (i + 1));
    const data = rows.slice(1, 1 + maxRows);
    // R9 §13: with opts.fields (or opts.dataElement) every column is checked against its field's rules using the
    // real values (only counts and row numbers are kept, never values).
    const specFields = (opts && (opts.fields || (opts.dataElement && opts.dataElement.fields))) || null;
    return header.map((name, j) => {
      const vals = data.map(r => (r[j] == null ? '' : r[j]));
      const present = vals.filter(v => v.trim() !== '');
      const lens = present.map(v => chars(v).length);
      const classes = new Set(), specials = [];
      const pcount = {}, pfirst = {}, pvalid = {};
      const fld = specFields ? specFields.find(f => f && columnFor(f, [{ name }])) : null;
      const sp = fld ? fieldSpec(fld) : null;
      const check = sp ? { rejected: 0, firstRow: null, blank: 0, wrongLength: 0, badChars: 0, pattern: 0 } : null;
      let nullRow = null;
      vals.forEach((v, i) => {
        if (v.trim() === '' && nullRow == null) nullRow = i + 1;
        if (!check || validate(sp, v)) return;
        check.rejected++; if (check.firstRow == null) check.firstRow = i + 1;
        const len = chars(v).length;
        if (v.trim() === '') check.blank++;
        else if ((sp.length != null && len !== sp.length) || (sp.minLen != null && len < sp.minLen) || (sp.maxLen != null && len > sp.maxLen)) check.wrongLength++;
        else if ((sp.type === 'digits' && !sp.mask && !/^\d+$/.test(v)) || (sp.mask && shapeOf(v) !== sp.maskShape && chars(v).length === sp.length)) check.badChars++;
        else check.pattern++;
      });
      present.forEach(v => {
        chars(v).forEach(c => {
          if (RE_DIGIT.test(c)) classes.add('digits');
          else if (/[A-Za-z]/.test(c)) classes.add('letters');
          else if (/\s/.test(c)) classes.add('space');
          else if (c.codePointAt(0) > 127) classes.add('unicode');
          else classes.add('punct');
          if (c.codePointAt(0) > 127) classes.add('unicode');
          if (!RE_ALNUM_SPACE.test(c) && !specials.includes(c) && specials.length < 15) specials.push(c);
        });
        const p = patternOf(v); pcount[p] = (pcount[p] || 0) + 1;
        if (!(p in pfirst)) { pfirst[p] = vals.indexOf(v) + 1; if (sp) pvalid[p] = validate(sp, v); }
      });
      const col = {
        name, rows: vals.length, nulls: vals.length - present.length, distinct: new Set(present).size,
        duplicates: present.length - new Set(present).size,   // R6: non-empty values repeating an earlier value
        minLen: lens.length ? Math.min(...lens) : 0, maxLen: lens.length ? Math.max(...lens) : 0,
      };
      // Numeric min/max only for measure-like columns. Identifier-like digit columns
      // (leading zeros, or every value 8+ digits: routing/account/tax ids) are skipped,
      // because their min/max would be a raw identifier.
      const trimmed = present.map(v => v.trim());
      const numeric = trimmed.length > 0 && trimmed.every(v => RE_NUM.test(v));
      const idLike = trimmed.every(v => /^\d+$/.test(v)) && trimmed.some(v => v.length > 1 && v[0] === '0' || v.length >= 8);
      if (numeric && !idLike) { const ns = trimmed.map(Number); col.min = Math.min(...ns); col.max = Math.max(...ns); }
      col.charClasses = ['digits', 'letters', 'space', 'punct', 'unicode'].filter(c => classes.has(c));
      col.specials = specials;
      if (nullRow != null) col.nullRow = nullRow;
      if (check) col.check = check;
      col.patterns = Object.keys(pcount).map(p => Object.assign({ pattern: p, count: pcount[p], row: pfirst[p] }, sp ? { valid: pvalid[p] } : {}))
        .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern)).slice(0, 5);
      const ex = [];
      for (const v of [...new Set(present)]) { const m = maskValue(v); if (!ex.includes(m)) ex.push(m); if (ex.length >= 3) break; }
      col.examples = ex;
      return col;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Field spec interpretation (shared by specDrift / generateTests)     */
  /* ------------------------------------------------------------------ */
  // Token normalisation for field↔column matching: split camelCase, drop parenthetical text,
  // lower-case, split on punctuation/space/underscore. "Tax ID (EIN)" → "tax id" ↔ "tax_id".
  function tokens(s) {
    return String(s || '').replace(/\([^)]*\)/g, ' ').replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').toLowerCase()
      .split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
  }
  function parenTokens(s) { const m = /\(([^)]*)\)/.exec(String(s || '')); return m ? tokens(m[1]) : ''; }
  function isMask(s) { return typeof s === 'string' && s.includes('#') && /^[#9\-\/.\s()+]+$/.test(s); }

  // Normalised view of a field: type, exact length, length bounds (text/digits), value bounds
  // (number/currency), digit mask, regex, required, allowed values.
  function fieldSpec(f) {
    const fmt = String(f.format || '');
    let type = f.type;
    // R8: Yes/No fields are a two-value list; photo/file fields hold a file name.
    if (/^(boolean|bool|yesno|yes\/no|checkbox)$/i.test(String(type || '')) || (!type && /^\s*yes\s*\/\s*no\s*$/i.test(fmt))) { type = 'list'; f = Object.assign({}, f, { values: Array.isArray(f.values) && f.values.length ? f.values : ['Yes', 'No'] }); }
    if (/^(file|image|photo|attachment)$/i.test(String(type || '')) || (!type && /^(file|image|photo|attachment)$/i.test(fmt))) type = 'file';
    const mask = isMask(f.pattern) ? f.pattern : isMask(fmt) ? fmt : null;
    if (!type) {
      if (mask || /digit/i.test(fmt)) type = 'digits';
      else if (/currency/i.test(fmt)) type = 'currency';
      else if (/date|timestamp/i.test(fmt)) type = 'date';
      else if (/^list$/i.test(fmt) || / \/ /.test(fmt)) type = 'list';
      else if (/^number$/i.test(fmt)) type = 'number';
      else type = 'text';
    }
    const sp = { name: f.name, type, mask, aba: /routing/i.test(String(f.name || '')), required: f.required === true || (f.required == null && /required/i.test(String(f.rule || '')) && !/optional/i.test(String(f.rule || ''))) };
    if (mask) { sp.maskShape = shapeOf(mask.replace(/#/g, '9')); sp.length = chars(mask).length; }
    else if (f.length != null) sp.length = +f.length;
    else { const m = /(\d+)\s*digits?/i.exec(fmt); if (m) sp.length = +m[1]; }
    if (type === 'number' || type === 'currency') {
      if (f.min != null) sp.minVal = +f.min;
      if (f.max != null) sp.maxVal = +f.max;
    } else {
      if (f.min != null) sp.minLen = +f.min;
      if (f.max != null) sp.maxLen = +f.max;
    }
    if (f.pattern && !mask) { try { sp.regex = new RegExp(f.pattern, 'u'); } catch (e) { sp.regex = null; } }
    sp.sem = type === 'file' ? 'file' : semOf(f.name);
    if (sp.sem === 'file' && type === 'text') sp.type = 'file';
    sp.values = Array.isArray(f.values) && f.values.length ? f.values.map(String)
      : (type === 'list' && / \/ /.test(fmt) ? fmt.split('/').map(x => x.trim()).filter(Boolean) : null);
    return sp;
  }
  // R6 semantic kind of a field from its name, used to tailor generated values: email, phone, postal, address,
  // city, id (number/code/reference/account), name (legal/company/holder/contact), else text.
  function semOf(name) {
    const t = ' ' + tokens(name) + ' ';
    if (/ e ?mail /.test(t)) return 'email';
    if (/ (phone|fax|mobile|tel) /.test(t)) return 'phone';
    if (/ (photo|photos|image|picture|scan|attachment|upload|signature) /.test(t) && !/ (id|number|no|code) /.test(t)) return 'file';
    if (/ (zip|postal|postcode) /.test(t)) return 'postal';
    if (/ (address|street|addr) /.test(t)) return 'address';
    if (/ (city|town) /.test(t)) return 'city';
    if (/ (employee|staff|manager|requester|approver|person|people|user|first|last|surname|given|full name) /.test(t)) return 'person';   // R9 §13: people, never vendor names
    if (/ (name|holder|payee|contact) /.test(t)) return 'name';
    if (/ (id|ids|number|no|num|code|ref|reference|account|iban|swift|bic|ein|ssn|tin|sku) /.test(t)) return 'id';
    if (/ (vendor|company|supplier|bank) /.test(t)) return 'name';
    return 'text';
  }
  const SEM_SAMPLE = { email: 'ap@northwind.example', phone: '+1 555 0142', postal: '75201', address: '125 Harbor Way, Suite 4',
    city: 'Lakeview', id: 'NW100245', name: 'Northwind Supply Co', person: 'Dana Whitfield', text: 'Standard terms apply' };
  // Free text: special-character cases apply only here (never to ids, emails, phones, postal codes or patterned fields).
  function isFreeText(sp) { return sp.type === 'text' && sp.sem !== 'file' && !sp.values && !sp.mask && !sp.regex && sp.length == null && !['id', 'email', 'phone', 'postal'].includes(sp.sem); }
  function allowedSpecials(sp) {
    if (sp.mask) return new Set(chars(sp.mask).filter(c => !RE_ALNUM_SPACE.test(c) && c !== '#'));
    if (sp.type === 'number') return new Set(['-', '+', '.']);
    if (sp.type === 'currency') return new Set(['$', ',', '.', '-']);
    if (sp.type === 'date') return new Set(['-', '/', ':', '.']);
    return null; // text/list: any
  }
  // ABA routing checksum: 3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10).
  function abaValid(s) {
    if (!/^\d{9}$/.test(s)) return false;
    const d = s.split('').map(Number);
    return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
  }
  // Append the check digit to 8 digits.
  function abaFrom(prefix8) {
    const d = prefix8.split('').map(Number);
    const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5]);
    return prefix8 + String((10 - (sum % 10)) % 10);
  }
  function validDate(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false; const ms = toMs(s); return !isNaN(ms) && iso(ms) === s; }
  // Does `input` satisfy the field spec?
  function validate(sp, input) {
    const s = String(input == null ? '' : input);
    if (s.trim() === '') return !sp.required;
    const len = chars(s).length;
    if (sp.mask && shapeOf(s) !== sp.maskShape) return false;
    if (sp.regex && !sp.regex.test(s)) return false;
    if (sp.type === 'digits' && !sp.mask && !/^\d+$/.test(s)) return false;
    if (sp.aba && !abaValid(s)) return false;
    if (sp.type === 'number' || sp.type === 'currency') {
      const t = sp.type === 'currency' ? s.replace(/[$,]/g, '') : s;
      if (!RE_NUM.test(t)) return false;
      const n = Number(t);
      if (sp.minVal != null && n < sp.minVal) return false;
      if (sp.maxVal != null && n > sp.maxVal) return false;
    }
    if (sp.type === 'date' && !validDate(s)) return false;
    if (sp.values && !sp.values.some(v => v.toLowerCase() === s.toLowerCase())) return false;
    if (sp.length != null && len !== sp.length) return false;
    if (sp.minLen != null && len < sp.minLen) return false;
    if (sp.maxLen != null && len > sp.maxLen) return false;
    return true;
  }

  function columnsOf(profile) { return Array.isArray(profile) ? profile : (profile && Array.isArray(profile.columns) ? profile.columns : []); }
  // Match order: explicit field.column (token-equal), then field name tokens, then the parenthetical alias ("EIN").
  function columnFor(f, cols) {
    const keys = f.column ? [tokens(f.column)] : [tokens(f.name), tokens(String(f.name || '').replace(/\s+/g, '')), parenTokens(f.name)];
    for (const k of keys) { if (!k) continue; const c = cols.find(x => tokens(x.name) === k); if (c) return c; }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Spec drift                                                          */
  /* ------------------------------------------------------------------ */
  // "Routing number" → "routing number(s)"; "Tax ID (EIN)" → "tax ID(s)". Acronyms keep their case.
  function nounOf(name, n) {
    const words = String(name || 'value').replace(/\s*\([^)]*\)/g, '').trim().split(/\s+/).filter(Boolean)
      .map(w => /^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase());
    if (!words.length) words.push('value');
    if (n !== 1) {
      const w = words[words.length - 1];
      words[words.length - 1] = /^[A-Z0-9]{2,}$/.test(w) ? w + 's' : /(s|x|ch|sh)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's';
    }
    return words.join(' ');
  }
  function quoteChars(arr) { return joinList(arr.map(c => c === ' ' ? 'spaces' : '"' + c + '"')); }

  function specDrift(dataElement, profile) {
    const cols = columnsOf(profile);
    const docRows = profile && !Array.isArray(profile) && profile.rows != null ? +profile.rows : null;
    const fields = (dataElement && dataElement.fields) || [];
    const out = [];
    const matched = new Set();
    for (const f of fields) {
      const sp = fieldSpec(f);
      const col = columnFor(f, cols);
      const N = (n) => nounOf(f.name, n);
      if (!col) { out.push({ field: f.name, issue: 'missing-column', detail: 'No column in the extract matches "' + f.name + '".' }); continue; }
      matched.add(col.name);
      const nulls = +col.nulls || 0;
      const rows = col.rows != null ? +col.rows : docRows != null ? docRows : colRows(col, null);
      const filled = rows - nulls;
      const hasHave = n => (n === 1 ? 'has' : 'have');
      if (sp.required && nulls > 0) out.push({ field: f.name, issue: 'required-nulls', detail: nulls + ' of ' + rows + ' ' + N(rows) + ' ' + isAre(nulls) + ' empty; the spec says ' + N(1) + ' is required.' });
      if (filled <= 0) continue;
      // R6: duplicates in a field marked unique (profiles from before R6 have no duplicates count: skipped).
      if (f.unique && +col.duplicates > 0) out.push({ field: f.name, issue: 'duplicates', detail: col.duplicates + ' of ' + rows + ' ' + N(rows) + ' ' + (+col.duplicates === 1 ? 'repeats' : 'repeat') + ' an earlier value; the spec says each ' + N(1) + ' must be unique.' });
      const pats = col.patterns || [];
      const isDigitsPat = p => /^9(\{\d+\})?$/.test(p);
      if (sp.length != null && (col.minLen !== sp.length || col.maxLen !== sp.length)) {
        const groups = {};
        // R6: like with like — observed lengths use the spec's unit (digits for a plain digits spec, else characters).
        const unit = sp.type === 'digits' && !sp.mask ? ' digits' : ' characters';
        pats.forEach(p => { const L = chars(expandPattern(p.pattern)).length; if (L !== sp.length) { const k = L + (unit === ' digits' && !isDigitsPat(p.pattern) ? ' characters' : unit); groups[k] = (groups[k] || 0) + p.count; } });
        const parts = Object.keys(groups).map(k => groups[k] + ' of ' + rows + ' ' + N(rows) + ' ' + hasHave(groups[k]) + ' ' + k);
        out.push({ field: f.name, issue: 'length-mismatch', detail: (parts.length ? parts.join('; ') : capFirst(N(2)) + ' range from ' + col.minLen + ' to ' + col.maxLen + unit) + '; the spec requires ' + sp.length + unit + '.' });
      }
      if (sp.minLen != null && col.minLen < sp.minLen) out.push({ field: f.name, issue: 'length-mismatch', detail: 'The shortest ' + N(1) + ' is ' + nWord(col.minLen, 'character') + '; the spec minimum is ' + sp.minLen + '.' });
      if (sp.maxLen != null && col.maxLen > sp.maxLen) out.push({ field: f.name, issue: 'length-mismatch', detail: 'The longest ' + N(1) + ' is ' + nWord(col.maxLen, 'character') + '; the spec allows ' + sp.maxLen + '.' });
      const allowed = allowedSpecials(sp);
      if (sp.type === 'digits') {
        const bad = (col.charClasses || []).filter(c => c === 'letters' || c === 'space' || c === 'unicode').map(c => c === 'unicode' ? 'non-English characters' : c === 'space' ? 'spaces' : c);
        const badSp = (col.specials || []).filter(c => !(allowed && allowed.has(c)));
        if (bad.length || badSp.length) out.push({ field: f.name, issue: 'non-digit', detail: 'Some ' + N(2) + ' contain ' + joinList(bad.concat(badSp.length ? [quoteChars(badSp)] : [])) + '; the spec says digits only' + (sp.mask ? ' in the format ' + sp.mask : '') + '.' });
      } else if (allowed) {
        const badSp = (col.specials || []).filter(c => !allowed.has(c));
        if (badSp.length) out.push({ field: f.name, issue: 'unexpected-specials', detail: 'Some ' + N(2) + ' contain characters a ' + sp.type + ' field should not have: ' + quoteChars(badSp) + '.' });
      }
      if (sp.type === 'number' || sp.type === 'currency') {
        const hasLetters = (col.charClasses || []).some(c => c === 'letters' || c === 'unicode');
        if (col.min == null && hasLetters) out.push({ field: f.name, issue: 'type-mismatch', detail: 'Some ' + N(2) + ' are not numbers; the spec says ' + sp.type + '.' });
        if (col.min != null && sp.minVal != null && col.min < sp.minVal) out.push({ field: f.name, issue: 'out-of-range', detail: 'The smallest ' + N(1) + ' is ' + col.min + ', below the spec minimum of ' + sp.minVal + '.' });
        if (col.max != null && sp.maxVal != null && col.max > sp.maxVal) out.push({ field: f.name, issue: 'out-of-range', detail: 'The largest ' + N(1) + ' is ' + col.max + ', above the spec maximum of ' + sp.maxVal + '.' });
      }
      const offText = off => humanPatterns(off).map(h => h.count + ' of ' + rows + ' ' + N(rows) + ' ' + (h.count === 1 ? 'looks' : 'look') + ' like ' + h.text).join('; ');
      if (sp.mask) {
        const want = collapse(sp.maskShape);
        const off = pats.filter(p => p.pattern !== want);
        if (off.length) out.push({ field: f.name, issue: 'pattern-mismatch', detail: offText(off) + '; the spec format is ' + sp.mask + ' (' + humanPattern(want) + ').' });
      } else if (sp.regex) {
        const off = pats.filter(p => !sp.regex.test(expandPattern(p.pattern)));
        if (off.length) out.push({ field: f.name, issue: 'pattern-mismatch', detail: offText(off) + ', which does not match the spec pattern.' });
      }
      if (sp.values && col.distinct > sp.values.length)
        out.push({ field: f.name, issue: 'value-not-in-list', detail: capFirst(N(2)) + ' have ' + col.distinct + ' different values; the spec allows ' + sp.values.length + ': ' + joinList(sp.values) + '.' });
    }
    cols.filter(c => !matched.has(c.name)).forEach(c => out.push({ field: c.name, issue: 'unspecified-column', detail: 'The extract has a column "' + c.name + '" that is not in the spec.' }));
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Test generation (synthetic inputs only)                             */
  /* ------------------------------------------------------------------ */
  function digitsOf(n) { let s = ''; for (let i = 0; i < n; i++) s += '1234567890'[i % 10]; return s; }
  function textOf(n) { const a = 'Abcdefghijklmnopqrstuvwxyz'; let s = ''; for (let i = 0; i < n; i++) s += a[i % 26]; return s; }
  function strOfLen(sp, n) { return sp.type === 'digits' ? digitsOf(n) : sp.sem === 'id' && n > 2 ? 'NW' + digitsOf(n - 2) : textOf(n); }
  function fmtNum(sp, n) { return sp.type === 'currency' ? n.toFixed(2) : String(n); }

  function validSample(sp) {
    if (sp.values) return sp.values[0];
    if (sp.aba) return abaFrom('12345678');
    if (sp.mask) { let i = 0; return chars(sp.mask).map(c => c === '#' || c === '9' ? '1234567890'[i++ % 10] : c).join(''); }
    if (sp.type === 'number' || sp.type === 'currency') {
      const lo = sp.minVal, hi = sp.maxVal;
      const v = lo != null && hi != null ? (lo + hi) / 2 : lo != null ? lo + 1 : hi != null ? hi - 1 : 100;
      return fmtNum(sp, sp.type === 'number' && lo != null && hi != null ? Math.round(v) : v);
    }
    if (sp.type === 'date') return '2026-01-15';
    if (sp.type === 'file') return 'northwind-photo-0142.jpg';
    if (sp.type === 'text' && sp.sem && SEM_SAMPLE[sp.sem] && validate(sp, SEM_SAMPLE[sp.sem])) return SEM_SAMPLE[sp.sem];
    const n = sp.length != null ? sp.length : Math.max(sp.minLen || 0, Math.min(sp.maxLen != null ? sp.maxLen : 9, 9));
    return strOfLen(sp, Math.max(n, 1));
  }
  function wrongType(sp) {
    if (sp.type === 'digits') { const v = validSample(sp); return 'AB' + v.slice(2); }
    if (sp.type === 'number' || sp.type === 'currency') return 'abc';
    if (sp.type === 'date') return '2026-13-45';
    if (sp.values) return 'not-a-listed-value';
    return null;
  }

  // Cross-field rule in free text: "Must match legal name", "same as X", "differs from X", "before/after X".
  function crossRule(f, fields) {
    const rule = String(f.rule || '');
    const m = /\b(match(?:es)?|equals?|same as|differs? from|on or before|on or after|before|after)\s+(?:the\s+)?([^.;,]+)/i.exec(rule);
    if (!m) return null;
    const verb = m[1].toLowerCase();
    const rel = /match|equal|same/.test(verb) ? 'equal' : /differ/.test(verb) ? 'differ' : /before/.test(verb) ? 'before' : 'after';
    const rt = ' ' + tokens(rule) + ' ';
    const other = fields.find(o => o !== f && tokens(o.name) && rt.includes(' ' + tokens(o.name) + ' '));
    return { rel, other: other ? other.name : m[2].trim(), rule };
  }
  const SPECIAL_TEXT = [
    ["O'Neill Supply", 'apostrophe'], ['Zoë Café', 'accented letters'], ['Ames & Sons', 'ampersand'],
    ['Acme Rockets 🚀', 'emoji'], ['  Acme Ltd  ', 'leading and trailing spaces'],
  ];
  // R6: special-character cases tailored to the kind of free text; emoji only in name fields.
  const SPECIAL_BY_SEM = {
    name: SPECIAL_TEXT,
    person: [["Dana O'Neil", 'apostrophe'], ['Zoë Martín', 'accented letters'], ['Ana-Lucía Ruiz', 'hyphen'], ['  Dana Whitfield  ', 'leading and trailing spaces']],
    address: [["12 O'Connell St", 'apostrophe'], ['8 Rue Saint-Rémy, Montréal', 'accented letters'], ['Unit #4, 9 Elm Rd', 'hash and comma'], ['  125 Harbor Way  ', 'leading and trailing spaces']],
    city: [["Coeur d'Alene", 'apostrophe'], ['São Paulo', 'accented letters'], ['  Lakeview  ', 'leading and trailing spaces']],
    text: [["Vendor's terms", 'apostrophe'], ['Résumé on file', 'accented letters'], ['Net 30 & 2% discount', 'ampersand and percent'], ['  Standard terms  ', 'leading and trailing spaces']],
  };

  // Row count for a profile column: column rows, else the profile doc's rows, else nulls + pattern counts.
  function colRows(col, profile) {
    if (col && col.rows != null) return +col.rows;
    if (profile && !Array.isArray(profile) && profile.rows != null) return +profile.rows;
    return (+(col && col.nulls) || 0) + ((col && col.patterns) || []).reduce((a, p) => a + (p.count || 0), 0);
  }
  // A value of length n that satisfies every other rule of the spec where possible.
  function specValidOfLen(sp, n) {
    if (sp.aba && n === 9) return abaFrom('12345678');
    if (sp.mask && n === chars(sp.mask).length) return validSample(sp);
    if (sp.values) { const v = sp.values.find(x => chars(x).length === n); if (v) return v; }
    if (sp.type === 'number' || sp.type === 'currency') return '1' + '0'.repeat(Math.max(0, n - 1));
    if (sp.type === 'date' && n === 10) return '2026-01-15';
    return strOfLen(sp, n);
  }

  // R8 sanity: every value matches the field's type (an expected-accept value always passes the spec), bad values
  // seen in the sample become "should be rejected" tests, and at most opts.maxPerField (default 6) cases per field are
  // kept, most useful first (opts.all keeps every case).
  const TEST_RANK = { valid: 0, invalid: 1, boundary: 2, edge: 3 };
  function generateTests(dataElement, profile, opts) {
    const out = generateTestsAll(dataElement, profile);
    const max = opts && opts.all ? Infinity : opts && opts.maxPerField > 0 ? +opts.maxPerField : 6;
    if (!isFinite(max)) return out;
    const byField = {};
    out.forEach((tc, i) => { (byField[tc.field] = byField[tc.field] || []).push({ tc, i }); });
    const keep = new Set();
    Object.keys(byField).forEach(k => {
      const arr = byField[k];
      // One of each kind first (valid, invalid, boundary, edge; spec before profile), then the rest in order.
      const ranked = arr.slice().sort((a, b) => (TEST_RANK[a.tc.kind] - TEST_RANK[b.tc.kind]) || ((a.tc.origin === 'profile') - (b.tc.origin === 'profile')) || a.i - b.i);
      const picked = [], kinds = new Set();
      ranked.forEach(x => { if (picked.length < max && !kinds.has(x.tc.kind + (x.tc.expect || ''))) { picked.push(x); kinds.add(x.tc.kind + (x.tc.expect || '')); } });
      ranked.forEach(x => { if (picked.length < max && !picked.includes(x)) picked.push(x); });
      picked.forEach(x => keep.add(x.i));
    });
    return out.filter((tc, i) => keep.has(i));
  }
  // R9 §13: a synthetic value of an observed shape that a pattern rule (regex) also accepts, by using the rule's own
  // literal letters ("E" in E\d{5}); null when none fits.
  function fitRegex(sp, input) {
    if (!sp.regex || validate(sp, input)) return input;
    const src = sp.regex.source.replace(/\\./g, '').replace(/\[[^\]]*\]|\{[^}]*\}/g, '');
    const lits = [...new Set((src.match(/[A-Za-z]/g) || []))];
    for (const L of lits) {
      const up = L.toUpperCase(), lo = L.toLowerCase();
      const cand = chars(input).map(c => RE_LU.test(c) ? up : RE_L.test(c) ? lo : c).join('');
      if (validate(sp, cand)) return cand;
    }
    return null;
  }
  function generateTestsAll(dataElement, profile) {
    const de = dataElement || {};
    const cols = columnsOf(profile);
    const out = [], seen = new Set();
    const add = (f, kind, input, expect, origin, note, context) => {
      const key = f.name + '\u0000' + input + '\u0000' + (context ? JSON.stringify(context) : '');
      if (seen.has(key)) {
        // Deduped. A profile case that repeats a spec case marks it as also observed in the extract.
        const prev = out.find(x => x.field === f.name && x.input === input && JSON.stringify(x.context || null) === JSON.stringify(context || null));
        if (origin === 'profile' && prev && prev.origin !== 'profile' && !prev.observed) { prev.observed = true; prev.note += ' (also observed in the extract: ' + note.charAt(0).toLowerCase() + note.slice(1) + ')'; }
        return;
      }
      seen.add(key);
      // R8 sanity: an expected-accept value must satisfy the field's own spec (its type, list, length).
      if (expect === 'accept' && !validate(fieldSpec(f), input)) return;
      const tc = { dataId: de.id, field: f.name, kind, input, expect, origin, note };
      if (context) tc.context = context;
      out.push(tc);
    };
    for (const f of de.fields || []) {
      const sp = fieldSpec(f);
      const valid = validSample(sp);
      const ok = s => (validate(sp, s) ? 'accept' : 'reject');
      add(f, 'valid', valid, ok(valid), 'spec', 'Valid value built from the spec');

      // Boundaries
      if (sp.type === 'number' || sp.type === 'currency') {
        const step = sp.type === 'currency' ? 0.01 : 1;
        if (sp.minVal != null) { add(f, 'boundary', fmtNum(sp, sp.minVal), 'accept', 'spec', 'Minimum value'); add(f, 'boundary', fmtNum(sp, +(sp.minVal - step).toFixed(2)), 'reject', 'spec', 'Just below minimum'); }
        if (sp.maxVal != null) { add(f, 'boundary', fmtNum(sp, sp.maxVal), 'accept', 'spec', 'Maximum value'); add(f, 'boundary', fmtNum(sp, +(sp.maxVal + step).toFixed(2)), 'reject', 'spec', 'Just above maximum'); }
      } else if (sp.length != null) {
        add(f, 'boundary', valid, 'accept', 'spec', 'Exact length ' + sp.length);
        if (chars(valid).length > 1) add(f, 'boundary', chars(valid).slice(0, -1).join(''), 'reject', 'spec', 'One shorter than length ' + sp.length);
        add(f, 'boundary', valid + (sp.type === 'digits' ? '1' : 'a'), 'reject', 'spec', 'One longer than length ' + sp.length);
      } else if (!sp.values && sp.type !== 'file' && sp.type !== 'date') {
        if (sp.minLen != null) {
          add(f, 'boundary', strOfLen(sp, sp.minLen), ok(strOfLen(sp, sp.minLen)), 'spec', 'Minimum length ' + sp.minLen);
          if (sp.minLen > 1) add(f, 'boundary', strOfLen(sp, sp.minLen - 1), 'reject', 'spec', 'One below minimum length');
        }
        if (sp.maxLen != null) {
          add(f, 'boundary', strOfLen(sp, sp.maxLen), ok(strOfLen(sp, sp.maxLen)), 'spec', 'Maximum length ' + sp.maxLen);
          add(f, 'boundary', strOfLen(sp, sp.maxLen + 1), 'reject', 'spec', 'One above maximum length');
        }
      }

      // Invalid
      const wt = wrongType(sp);
      if (wt != null) add(f, 'invalid', wt, ok(wt), 'spec', 'Wrong type for ' + sp.type);
      const hi = sp.length != null ? sp.length : sp.maxLen;
      if (hi != null && !sp.values && sp.type !== 'file') add(f, 'invalid', strOfLen(sp, hi + 5), 'reject', 'spec', 'Too long');
      if (sp.required) add(f, 'invalid', '', 'reject', 'spec', 'Empty but required');

      // Routing numbers: ABA checksum-valid values and a checksum-invalid one.
      if (sp.aba) {
        const v2 = abaFrom('31415926');
        add(f, 'valid', v2, ok(v2), 'spec', 'Valid ABA checksum');
        const bad = valid.slice(0, 8) + String((+valid[8] + 1) % 10);
        add(f, 'invalid', bad, 'reject', 'spec', 'Nine digits but the ABA checksum fails');
      }

      // Free-text fields: special characters.
      if (isFreeText(sp))
        (SPECIAL_BY_SEM[sp.sem] || SPECIAL_BY_SEM.text).forEach(([input, what]) => add(f, 'edge', input, ok(input), 'spec', 'Special characters: ' + what));

      // Cross-field rules (expectation depends on the other field, given in `context`).
      const cr = sp.type === 'text' || sp.type === 'date' ? crossRule(f, de.fields || []) : null;   // R8: text/date values only
      if (cr) {
        const isDate_ = sp.type === 'date';
        const x = isDate_ ? '2026-01-10' : sp.sem === 'person' ? 'Dana Whitfield' : 'Northwind Supply Co', y = isDate_ ? '2026-01-20' : sp.sem === 'person' ? 'Dana Whitfield-Ray' : 'Northwind Supply Company';
        const say = 'Cross-field: ' + cr.rule.trim();
        if (cr.rel === 'equal') { add(f, 'valid', x, 'accept', 'spec', say + ' (same value)', { [cr.other]: x }); add(f, 'invalid', x, 'reject', 'spec', say + ' (different value)', { [cr.other]: y }); }
        else if (cr.rel === 'differ') { add(f, 'valid', x, 'accept', 'spec', say + ' (different value)', { [cr.other]: y }); add(f, 'invalid', x, 'reject', 'spec', say + ' (same value)', { [cr.other]: x }); }
        else if (cr.rel === 'before') { add(f, 'valid', x, 'accept', 'spec', say + ' (earlier)', { [cr.other]: y }); add(f, 'invalid', y, 'reject', 'spec', say + ' (later)', { [cr.other]: x }); }
        else { add(f, 'valid', y, 'accept', 'spec', say + ' (later)', { [cr.other]: x }); add(f, 'invalid', x, 'reject', 'spec', say + ' (earlier)', { [cr.other]: y }); }
      }

      // Profile edge cases
      const col = columnFor(f, cols);
      if (!col) continue;
      // R7: observed numeric min/max become boundary tests where the spec sets no bound on that side (a spec bound
      // already has its own boundary cases). Min/max are profile statistics, never row values of id-like columns.
      const numF = sp.type === 'number' || sp.type === 'currency';
      if (numF && sp.minVal == null && col.min != null && isFinite(+col.min)) { const v = sp.type === 'currency' ? (+col.min).toFixed(2) : String(+col.min); add(f, 'boundary', v, ok(v), 'profile', 'Smallest value seen in the sample (' + v + ')'); }
      if (numF && sp.maxVal == null && col.max != null && isFinite(+col.max)) { const v = sp.type === 'currency' ? (+col.max).toFixed(2) : String(+col.max); add(f, 'boundary', v, ok(v), 'profile', 'Largest value seen in the sample (' + v + ')'); }
      if (isFreeText(sp)) (col.specials || []).forEach(c => {   // R6: free text only (no "1-2-3456789" for an EIN)
        const base = chars(valid);
        const input = base.length > 1 ? base[0] + c + base.slice(1).join('') : base.join('') + c;
        add(f, 'edge', input, ok(input), 'profile', 'Observed special character "' + c + '"');
      });
      // One case per observed shape (top patterns), reproduced synthetically: e.g. an 8-digit routing number.
      // R8: a shape seen in only a few rows while most rows share another shape is a bad sample value: it becomes
      // a "should be rejected" test, never an accepted one.
      const pats = col.patterns || [];
      const patTotal = pats.reduce((a, p) => a + (+p.count || 0), 0);
      const top = pats.slice().sort((a, b) => (b.count || 0) - (a.count || 0))[0];
      const outlier = pt => top && pt !== top && patTotal > 0 && (top.count || 0) / patTotal >= 0.8 && (pt.count || 0) / patTotal < 0.2;
      pats.forEach(pt => {
        // Digits shifted by one so a shape case never collides with (and is deduped into) a spec case.
        let input = expandPattern(pt.pattern).replace(/[0-9]/g, c => String((+c + 1) % 10));
        if (sp.aba && /^\d{9}$/.test(input)) input = abaFrom(input.slice(0, 8));
        if (pt.valid !== false && sp.regex) input = fitRegex(sp, input) || input;
        // R9 §13: when the profile checked the real values against the rules, that decides (a real value the
        // rules reject is a "should be rejected" test); the test links to the sample row it came from.
        const bad = outlier(pt) || pt.valid === false;
        const expect = bad ? 'reject' : ok(input);
        const before = out.length;
        add(f, 'edge', input, expect, 'profile', 'Observed shape: ' + humanPattern(pt.pattern) + ' (' + pt.count + ' of ' + colRows(col, profile) + ' rows)'
          + (pt.valid === false ? '; the rules reject it' : bad && ok(input) === 'accept' ? '; unlike most values, so it should be rejected' : ''));
        if (out.length > before && pt.row) out[out.length - 1].sampleRow = pt.row;
      });
      if (col.maxLen > 0 && !sp.values && sp.type !== 'file') {
        // Built to be otherwise valid for the spec, so the expectation is decided by length alone.
        const input = sp.regex ? fitRegex(sp, specValidOfLen(sp, col.maxLen)) : specValidOfLen(sp, col.maxLen);
        if (input != null) add(f, 'edge', input, ok(input), 'profile', 'Longest observed length (' + col.maxLen + ')');
      }
      const numericCol = (col.patterns || []).some(p => /^9/.test(p.pattern));
      if (sp.type === 'digits' || sp.type === 'number' || sp.type === 'currency' || numericCol) {
        const input = sp.aba ? abaFrom('0' + valid.slice(1, 8)) : sp.type === 'digits' || sp.mask ? '0' + chars(valid).slice(1).join('') : '0' + valid;
        add(f, 'edge', input, ok(input), 'profile', 'Leading zero');
      }
      if ((col.charClasses || []).includes('unicode') && !sp.values && sp.type !== 'file') {
        const input = 'Zoë Ñandú';
        add(f, 'edge', input, ok(input), 'profile', 'Unicode characters observed in the extract');
      }
      if (col.nulls > 0) { const before = out.length; add(f, 'edge', '', ok(''), 'profile', 'Empty values observed (' + col.nulls + ')'); if (out.length > before && col.nullRow) out[out.length - 1].sampleRow = col.nullRow; }
    }
    return out;
  }

  // R8 profile results in Simple: one plain line per column, e.g. "Tax ID: 40 values, 1 is too short".
  // [{column, field, text, problems}] — counts only, never raw values.
  function profileLines(dataElement, profile) {
    const cols = columnsOf(profile), fields = (dataElement && dataElement.fields) || [];
    return cols.filter(c => c && c.name).map(col => {
      const f = fields.find(x => columnFor(x, [col]) === col) || null;
      const rows = colRows(col, profile), nulls = +col.nulls || 0, filled = Math.max(0, rows - nulls);
      const bits = [];
      if (f) {
        const sp = fieldSpec(f);
        if (sp.required && nulls) bits.push(nulls + ' ' + isAre(nulls) + ' empty');
        const lenOf = p => chars(expandPattern(p.pattern)).length;
        const pats = col.patterns || [];
        const want = sp.length != null ? sp.length : null;
        const shortN = pats.filter(p => (want != null && lenOf(p) < want) || (sp.minLen != null && lenOf(p) < sp.minLen)).reduce((a, p) => a + (p.count || 0), 0);
        const longN = pats.filter(p => (want != null && lenOf(p) > want) || (sp.maxLen != null && lenOf(p) > sp.maxLen)).reduce((a, p) => a + (p.count || 0), 0);
        if (shortN) bits.push(shortN + ' ' + isAre(shortN) + ' too short');
        if (longN) bits.push(longN + ' ' + isAre(longN) + ' too long');
        // R9 §13: values the rules reject (from the real-value check when the profile has one, else from the shapes).
        const lenBad = p => (want != null && lenOf(p) !== want) || (sp.minLen != null && lenOf(p) < sp.minLen) || (sp.maxLen != null && lenOf(p) > sp.maxLen);
        const misN = pats.filter(p => !lenBad(p) && (p.valid === false || (p.valid == null && !sp.regex && !validate(sp, expandPattern(p.pattern))))).reduce((a, p) => a + (p.count || 0), 0);
        if (misN) bits.push(misN + ' ' + (misN === 1 ? "doesn't" : "don't") + ' match the pattern');
        const other = specDrift({ fields: [f] }, { rows, columns: [Object.assign({}, col, { name: col.name })] })
          .filter(x => x.field === f.name && !['length-mismatch', 'required-nulls', 'unspecified-column', 'missing-column'].includes(x.issue));
        if (other.length && !shortN && !longN && !misN) bits.push('some do not match the rules');
      }
      if (!f && nulls) bits.push(nulls + ' ' + isAre(nulls) + ' empty');
      return { column: col.name, field: f ? f.name : null, problems: bits.length, text: (f ? f.name : col.name) + ': ' + nWord(filled, 'value') + (bits.length ? ', ' + bits.join(', ') : '') };
    });
  }

  // R8 "Create the tests": one press generates for every piece of information the project changes (opts
  // .includeUnchanged: all information its Future steps use); nothing is skipped. Information without field rules uses
  // its latest profile's columns as the rules, else gets a presence test (provided → accept, empty → reject).
  // [{dataId, cases}] where cases follow generateTests (synthetic values only).
  function generateProjectTests(docs, projectId, opts) {
    const project = projOf(docs, projectId);
    if (!project) return [];
    const ids = opts && opts.includeUnchanged ? [...new Set(linkedProcesses(docs, project).flatMap(p => flatSteps(p.tobe).flatMap(stepData)))]
      : changedInformation(docs, project).map(x => x.dataId);
    return ids.map(id => {
      const d = get(docs, 'dataElement', id) || { id, name: 'Information', fields: [] };
      const prof = latestBy(list(docs, 'profile').filter(x => x.dataId === id), 'at');
      if ((d.fields || []).length) return { dataId: id, cases: generateTests(d, prof || undefined, opts) };
      if (prof && columnsOf(prof).length) return { dataId: id, cases: generateTests(Object.assign({}, d, { fields: specFromProfile(prof) }), prof, opts) };
      const name = d.name || 'Information';
      const sample = (d.samples || []).find(x => String(x || '').trim()) || 'Provided';
      return { dataId: id, cases: [
        { dataId: id, field: name, kind: 'valid', input: String(sample), expect: 'accept', origin: 'spec', note: 'The information is provided' },
        { dataId: id, field: name, kind: 'invalid', input: '', expect: 'reject', origin: 'spec', note: 'Missing, but the step needs it' },
      ] };
    });
  }

  // R7 "Use these columns as the rules to test": spec fields from a profile (profileCsv columns or a profile doc).
  // type: currency (numbers with 2 decimals) | number | date (YYYY-MM-DD) | digits (digit strings, e.g. codes) | text;
  // required when the column has no empty values; digits: exact length when every value has the same length,
  // else min/max length; text: min/max length; number/currency: min/max value. All from observed values.
  function specFromProfile(profile) {
    return columnsOf(profile).filter(c => c && c.name).map(c => {
      const pats = (c.patterns || []).map(p => String(p.pattern || ''));
      const present = (c.rows != null ? +c.rows : 0) - (+c.nulls || 0);
      const cls = c.charClasses || [];
      let type = 'text';
      if (c.min != null && c.max != null && isFinite(+c.min) && isFinite(+c.max)) type = pats.length && pats.every(p => /\.(9\{2\}|99)$/.test(p)) ? 'currency' : 'number';
      else if (pats.length && pats.every(p => p === '9{4}-9{2}-9{2}')) type = 'date';
      else if (cls.length === 1 && cls[0] === 'digits') type = 'digits';
      const f = { name: String(c.name), type, required: (+c.nulls || 0) === 0 && (c.rows == null || present > 0), origin: 'profile' };
      if (type === 'number' || type === 'currency') { f.min = +c.min; f.max = +c.max; f.format = type; }
      else if (type === 'digits') {
        // R8: when one fixed-length shape covers 80%+ of rows, the rare other lengths are bad values, not the rule.
        const ps = (c.patterns || []).filter(p => /^9(\{\d+\})?$/.test(p.pattern || '')), tot = (c.patterns || []).reduce((a, p) => a + (+p.count || 0), 0);
        const dom = ps.slice().sort((a, b) => (b.count || 0) - (a.count || 0))[0];
        const domLen = dom ? chars(expandPattern(dom.pattern)).length : 0;
        if (c.minLen && c.minLen === c.maxLen) { f.length = +c.minLen; f.format = c.minLen + ' digits'; }
        else if (dom && tot > 0 && (dom.count || 0) / tot >= 0.8) { f.length = domLen; f.format = domLen + ' digits'; }
        else { if (c.minLen) f.min = +c.minLen; if (c.maxLen) f.max = +c.maxLen; f.format = 'digits'; }
      } else if (type === 'date') f.format = 'date';
      else { if (c.minLen) f.min = +c.minLen; if (c.maxLen) f.max = +c.maxLen; f.format = 'text'; }
      f.rule = f.required ? 'Required' : '';
      return f;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Portfolio helpers                                                   */
  /* ------------------------------------------------------------------ */
  // workload(docs, today) or workload(docs, projectId|null|undefined, today).
  // effortNext14 = effortDays (default 1) of open items falling in [today, today+13]: overdue items count in
  // full; items spanning the window count pro rata by calendar-day overlap of [start, due].
  // capacityNext14 = capacity (days/week, default 4) × 2. overloaded = effortNext14 > capacityNext14.
  function workload(docs, projectId, today) {
    if (today === undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(projectId || ''))) { today = projectId; projectId = null; }
    const fc = forecastAll(docs, today);
    const people = personMap(docs);
    const items = list(docs, 'workItem').filter(w => !projectId || w.projectId === projectId);
    const rows = {};
    const winEnd = isDate(today) ? addDays(today, 13) : null;
    items.forEach(w => {
      if (!w.owner) return;
      const cap = people[w.owner] && people[w.owner].capacity != null && isFinite(+people[w.owner].capacity) ? +people[w.owner].capacity : 4;
      const r = rows[w.owner] || (rows[w.owner] = { person: w.owner, open: 0, late: 0, dueNext7: 0, effortNext14: 0, capacityNext14: cap * 2, overloaded: false });
      if (w.status === 'done') return;
      r.open++;
      if (fc[w.id] && fc[w.id].sched === 'late') r.late++;
      if (isDate(w.due) && isDate(today)) { const d = diffDays(w.due, today); if (d >= 0 && d <= 7) r.dueNext7++; }
      if (winEnd) {
        const effort = w.effortDays != null && isFinite(+w.effortDays) ? Math.max(0, +w.effortDays) : 1;
        const due = isDate(w.due) ? w.due : today;
        const start = isDate(w.start) && w.start <= due ? w.start : due;
        let share;
        if (due < today) share = 1;
        else {
          const from = start > today ? start : today, to = due < winEnd ? due : winEnd;
          share = from > to ? 0 : (diffDays(to, from) + 1) / (diffDays(due, start) + 1);
        }
        r.effortNext14 = Math.round((r.effortNext14 + effort * share) * 100) / 100;
      }
    });
    Object.values(rows).forEach(r => { r.overloaded = r.effortNext14 > r.capacityNext14; });
    return Object.values(rows).sort((a, b) => b.open - a.open || b.late - a.late || String(a.person).localeCompare(String(b.person)));
  }

  // Rows: variance = (doneAt for done items, else forecast) − baseline due.
  // Returns an array (rows) carrying `projectSlipDays` = project finish − max baseline due (the headline
  // number; never sum row variances), plus `plannedFinish` and `finish`.
  function baselineVariance(docs, projectId, baselineId, today) {
    const project = get(docs, 'project', projectId);
    const bl = project && (project.baselines || []).find(b => b.id === baselineId);
    const rows = [];
    rows.projectSlipDays = null; rows.plannedFinish = null; rows.finish = null;
    if (!bl) return rows;
    const fc = forecastAll(docs, today);
    const work = byId(list(docs, 'workItem'));
    const planned = bl.items || {};
    const ids = Object.keys(planned);
    Object.values(work).forEach(w => { if (w.projectId === projectId && !(w.id in planned)) ids.push(w.id); });
    ids.forEach(id => {
      const w = work[id];
      const plannedDue = planned[id] ? planned[id].due || null : null;
      const forecast = !w ? null : w.status === 'done' ? (isDate(w.doneAt) ? w.doneAt : w.due || null) : (fc[id] ? fc[id].forecast : null);
      rows.push({ workId: id, plannedDue, forecast, varianceDays: plannedDue && forecast ? diffDays(forecast, plannedDue) : null });
    });
    rows.plannedFinish = maxDate(Object.keys(planned).map(k => planned[k] && planned[k].due));
    rows.finish = projectStats(docs, projectId, today).finish;
    rows.projectSlipDays = rows.plannedFinish && rows.finish ? diffDays(rows.finish, rows.plannedFinish) : null;
    return rows;
  }

  // Rules-based, data-driven suggestions in map order (linked processes in project order; a gateway before its branches).
  //  - Resolver for every non-live (missing or examples-only) data element used by ANY to-be step, unless one exists:
  //    "Make X available" / "Connect a live source for X"; owner = data owner (else step owner).
  //  - Build item for each new/changed step or gateway that has no work; owner = step owner (gateway: owner of its first
  //    branch step, else the process owner). A step item depends on the resolvers of that step's non-live data only;
  //    steps never chain on each other by map order.
  // Each: {key: 'sug-N', pid, step, title, kind: 'build', owner, effortDays: 2, start, due, deps, resolves?}.
  // `deps` holds suggestion keys and/or existing work ids. Dates are business days: start = today (or the anchor) or
  // the latest finish of its deps; due = start + effortDays. anchor = today, else the latest due of the project's work.
  // R8: no make-work. Tasks only for new/changed Future steps (never wait/message nodes) and for information that is
  // not available yet; owners are the step (or information) owners; default effort 3 business days; never late on
  // day one (every start is today or later).
  // R10 §6 suggested plans are real plans:
  //  - one task per new or changed step (waits, messages and calls to other processes included, 1 day of effort) and
  //    per new or changed choice; one "Make X available" per piece of information not available yet;
  //  - one "Retire the old step: X" per Today step the Future drops; then "Train the people who do the changed steps"
  //    and "Tell affected teams about the change" (once per project, unless the project already has them);
  //  - owners are PEOPLE: the step's owner, else the project manager with the step's role in `note`; never a bare role;
  //  - every task starts the business day after each prerequisite finishes, and nobody does two suggested tasks at
  //    once (levelled per owner); every due date is at least its own forecast, so nothing is late on day one.
  const SUGGEST_EFFORT = 3;
  const MAX_TASK_DAYS = 10;   // R11 §4 default cap on one suggested task's span (business days)
  function suggestWorkFromDiff(docs, projectId, today) {
    const project = get(docs, 'project', projectId);
    if (!project) return [];
    const work = list(docs, 'workItem');
    const own = work.filter(w => w.projectId === projectId);
    const data = byId(list(docs, 'dataElement'));
    const av = availMap(docs);
    const fc = forecastAll(docs, today);
    const pm = project.owner || null;
    const anchorRaw = isDate(today) ? today : maxDate(own.map(w => w.due));
    const anchor = anchorRaw ? addBusinessDays(anchorRaw, 0) : null;
    const out = [], resolverKey = {};
    let n = 0;
    const minDue = {};
    const finishOf = dep => {
      const sg = out.find(x => x.key === dep); if (sg) return sg.due;
      const w = work.find(x => x.id === dep);
      return w ? (w.status === 'done' ? (w.doneAt || w.due) : fc[w.id] && fc[w.id].forecast) : null;
    };
    // R11 §4: the step's owner; a role-only step gets the one person in the workspace with that role (exact title),
    // otherwise the task stays unassigned with the role shown ("Needs an owner: Credit Analyst"), never the PM.
    const ppl = personList(docs);
    const roleHolder = role => { const m = ppl.filter(p => String(p.role || '').trim().toLowerCase() === role.toLowerCase()); return m.length === 1 ? m[0] : null; };
    const ownerOf = (st, fallbackPerson) => {
      if (st && st.owner) return { owner: st.owner };
      const role = st && String(st.ownerRole || '').trim().replace(/^(the|a|an)\s+/i, '');
      if (role) {
        const h = roleHolder(role);
        return h ? { owner: h.id, ownerRole: role, note: 'The step is done by the role "' + role + '"; ' + (h.name || 'one person') + ' is the only ' + role + ' in the workspace.' }
          : { owner: null, ownerRole: role, note: 'Needs an owner: ' + role + '.' };
      }
      if (fallbackPerson) return { owner: fallbackPerson };
      return { owner: null, note: 'Needs an owner: nobody is named on this step.' };
    };
    const push = sg => {
      sg.key = 'sug-' + (++n);
      if (!sg.effortDays) sg.effortDays = SUGGEST_EFFORT;
      if (sg.owner === undefined) sg.owner = pm;
      if (!sg.note) delete sg.note;
      out.push(sg);
      return sg;
    };
    // Dates. An item with no open prerequisite starts on the anchor (today); otherwise the business day after its
    // latest prerequisite finishes (FS). Spans = effortDays × one stretch factor (1–2×) toward the deadline, keeping
    // max(5, 15%) business days of buffer. One suggested task at a time per owner. minDue holds each task's forecast.
    let factor = 1;
    const schedule = () => {
      const free = {};
      out.forEach(sg => {
        if (!anchor) { sg.start = null; sg.due = null; return; }
        const fins = sg.deps.map(finishOf).filter(isDate);
        const who = sg.owner || sg.key;   // unassigned tasks never queue behind each other
        sg.start = maxDate([anchor, fins.length ? addBusinessDays(maxDate(fins), 1) : anchor, free[who] || anchor]);
        // R11 §4: no task spans more than MAX_TASK_DAYS business days. A later forecast moves the start, never
        // stretches the task.
        const span = Math.min(MAX_TASK_DAYS, Math.max(1, Math.round(sg.effortDays * factor)));
        sg.due = maxDate([addBusinessDays(sg.start, span), minDue[sg.key]].filter(isDate));
        if (businessDaysBetween(sg.start, sg.due) > span) sg.start = addBusinessDays(sg.due, -span);
        free[who] = addBusinessDays(sg.due, 1);
      });
    };
    const hasWork = (pid, nodeId) => own.some(w => w.pid === pid && w.step === nodeId);
    const resolversFor = (p, st) => {
      const needs = [];
      stepData(st).forEach(d => {
        const de = data[d];
        const eff = av[d] || 'missing';
        // R8: only information that is not available yet (missing or example); never "We have it" or pending.
        if (!de || (eff !== 'missing' && eff !== 'example' && eff !== 'unchecked')) return;
        const existing = work.find(w => w.resolves === d);
        if (existing) { if (existing.status !== 'done') needs.push(existing.id); return; }
        if (!resolverKey[d]) {
          const sg = push(Object.assign({ pid: p.id, step: st.id, title: 'Make ' + (de.name || 'the information') + ' available',   // R8: one plain wording for "Not available yet"
            kind: 'build', deps: [], resolves: d }, de.owner ? { owner: de.owner } : ownerOf(st)));
          resolverKey[d] = sg.key;
        }
        needs.push(resolverKey[d]);
      });
      return [...new Set(needs)];
    };
    const stepTasks = [], changedPeople = new Set(), changedRoles = new Set();
    let anyChange = false;
    linkedProcesses(docs, project).forEach(p => {
      const diff = diffProcess(p);
      let flowPrev = [];
      const visit = nodes => (nodes || []).forEach(nd => {
        if (!nd) return;
        if (isGateway(nd)) {
          const st = diff.nodes[nd.id];
          if (st === 'new' || st === 'changed') anyChange = true;
          if ((st === 'new' || st === 'changed') && !hasWork(p.id, nd.id)) {
            const firstStep = flatSteps((nd.branches || []).flatMap(b => (b && b.nodes) || []))[0];
            const g = push(Object.assign({ pid: p.id, step: nd.id, title: (nd.type === 'parallel' ? 'Set up parallel branches: ' : 'Configure routing: ') + (nd.title || 'untitled gateway'),
              kind: 'build', deps: flowPrev.slice() }, ownerOf(firstStep, p.owner)));
            stepTasks.push(g.key);
            flowPrev = [g.key];
          }
          // each branch follows the gateway; the step after the gateway follows every branch's last work
          const atGate = flowPrev, ends = [];
          (nd.branches || []).forEach(b => { flowPrev = atGate; visit(b && b.nodes); ends.push(...flowPrev); });
          flowPrev = [...new Set(ends.length ? ends : atGate)];
          return;
        }
        if (!isStep(nd)) return;
        const needs = resolversFor(p, nd);
        const st = diff.nodes[nd.id];
        if (st === 'new' || st === 'changed') {
          anyChange = true;
          if (nd.owner) changedPeople.add(nd.owner); else if (String(nd.ownerRole || '').trim()) changedRoles.add(String(nd.ownerRole).trim());
        }
        if ((st === 'new' || st === 'changed') && !hasWork(p.id, nd.id)) {
          const light = nd.type === 'wait' || nd.type === 'message';
          const sg = push(Object.assign({ pid: p.id, step: nd.id, title: (st === 'new' ? 'Stand up new step: ' : 'Implement changes: ') + (nd.title || 'untitled step'), kind: 'build',
            deps: [...new Set(flowPrev.concat(needs))] }, light ? { effortDays: 1 } : {}, ownerOf(nd)));
          stepTasks.push(sg.key);
          flowPrev = [sg.key];
        } else {
          const open = own.filter(w => w.pid === p.id && w.step === nd.id && w.status !== 'done').map(w => w.id);
          if (hasWork(p.id, nd.id)) flowPrev = open;   // all done: nothing to wait for
        }
      });
      visit(p.tobe);
      // R10 §6: a "Retire" task for every Today step the Future drops, after the new way of that process is built
      diff.removed.filter(r => r && isStep(r)).forEach(r => {
        anyChange = true;
        if (own.some(w => w.retires === r.id && w.pid === p.id)) return;
        const sg = push(Object.assign({ pid: p.id, step: null, retires: r.id, title: 'Retire the old step: ' + (r.title || 'untitled step'), kind: 'other', tag: 'retire',
          deps: flowPrev.slice() }, ownerOf(r)));
        stepTasks.push(sg.key);
      });
    });
    // R10 §6: train the people who do the changed steps, and tell the affected teams (once per project)
    if (anyChange) {
      const ends = stepTasks.slice();
      const people = [...changedPeople].map(id => nameOf(docs, id)), roles = [...changedRoles];
      // R11 §4 "Tell affected teams" names the process's own teams: each changed step's team (its owner's team, else
      // its role), plus the teams it touches.
      const pmap = personMap(docs), teams = [];
      linkedProcesses(docs, project).forEach(p => { const df = diffProcess(p); flatSteps(p.tobe).forEach(st => {
        if (df.nodes[st.id] !== 'new' && df.nodes[st.id] !== 'changed') return;
        const t = st.owner && pmap[st.owner] && pmap[st.owner].bu ? pmap[st.owner].bu : String(st.ownerRole || '').trim().replace(/^(the|a|an)\s+/i, '');
        const known = new Set(Object.keys(pmap).map(id => pmap[id] && pmap[id].bu).filter(Boolean).concat(KNOWN_BUS).map(x => String(x).toLowerCase()));
        [t].concat((Array.isArray(st.touches) ? st.touches : []).filter(x => known.has(String(x || '').trim().toLowerCase())))
          .forEach(x => { x = String(x || '').trim(); if (x && !teams.some(y => y.toLowerCase() === x.toLowerCase())) teams.push(x); });
      }); });
      // telling the teams happens early (1 day, can start now); training follows the changed steps' work
      if (!own.some(w => w.tag === 'tell')) push({ pid: null, step: null, title: 'Tell affected teams about the change', kind: 'other', tag: 'tell', owner: pm, deps: [], effortDays: 1,
        note: 'Teams: ' + (joinList(teams, 8) || 'everyone the change touches') + '.', teams: teams.slice() });
      if (!own.some(w => w.tag === 'train')) push({ pid: null, step: null, title: 'Train the people who do the changed steps', kind: 'other', tag: 'train', owner: pm, deps: ends,
        note: 'Who: ' + (joinList(people.concat(roles.map(r => r + ' (role)')), 8) || 'the people on the changed steps') + '.' });
    }
    // R11 §4: longer work is split into parts of at most MAX_TASK_DAYS days, each after the one before
    for (let i = 0; i < out.length; i++) {
      const sg = out[i];
      if (!(sg.effortDays > MAX_TASK_DAYS)) continue;
      const parts = Math.ceil(sg.effortDays / MAX_TASK_DAYS), base = sg.title, total = sg.effortDays;
      sg.effortDays = MAX_TASK_DAYS; sg.title = base + ' (part 1 of ' + parts + ')';
      let prev = sg.key;
      for (let k = 2; k <= parts; k++) {
        const part = Object.assign({}, sg, { title: base + ' (part ' + k + ' of ' + parts + ')', deps: [prev], effortDays: Math.min(MAX_TASK_DAYS, total - MAX_TASK_DAYS * (k - 1)) });
        delete part.resolves;
        part.key = 'sug-' + (++n);
        out.splice(i + k - 1, 0, part);
        prev = part.key;
      }
      out.forEach(x => { if (x !== sg && x.deps.includes(sg.key) && !/\(part \d+ of/.test(x.title)) x.deps = x.deps.map(d => d === sg.key ? prev : d); });
    }
    schedule();
    if (anchor && out.length) {
      const target = isDate(project.target) && project.target > anchor ? project.target : defaultTarget(anchor);
      const avail = businessDaysBetween(anchor, target);
      const usable = avail - Math.max(5, Math.ceil(avail * 0.15));
      const needed = businessDaysBetween(anchor, maxDate(out.map(x => x.due)));
      if (needed > 0 && usable > needed) { factor = Math.min(2, usable / needed); schedule(); }
      // R9 §4 / R10 §6: each due date is at least its own forecast (nothing late on day one), and after any due date
      // moves, the tasks after it move too (a task never starts before its prerequisite finishes).
      const settle = () => {
        for (let i = 0; i < 12; i++) {
          const fc2 = forecastAll(withPlan(docs, projectId, out), today);
          let moved = false;
          out.forEach(sg => { const f = fc2[sg.key] && fc2[sg.key].forecast; if (isDate(f) && f > sg.due) { minDue[sg.key] = f; moved = true; } });
          if (!moved) break;
          schedule();
        }
      };
      settle();
      // the stretch never eats the buffer: when settling pushed the end past it, shrink the stretch and settle again
      for (let k = 0; k < 4 && factor > 1; k++) {
        const end = businessDaysBetween(anchor, maxDate(out.map(x => x.due)));
        if (end <= usable) break;
        factor = Math.max(1, factor * usable / end - 0.05);
        Object.keys(minDue).forEach(key => { delete minDue[key]; });
        schedule(); settle();
      }
    }
    return out;
  }
  // R9 §4 the exact work items "Accept" stores for a suggested plan (status idle, dates, effort, deps, owner/role).
  function planToWork(projectId, suggestions) {
    return (suggestions || []).filter(Boolean).map(s => {
      const w = { id: s.key, projectId, pid: s.pid, step: s.step, title: s.title, owner: s.owner || null, status: 'idle', start: s.start, due: s.due,
        effortDays: s.effortDays, deps: (s.deps || []).slice(), kind: s.kind || 'build' };
      if (s.ownerRole) w.ownerRole = s.ownerRole;
      if (s.resolves) w.resolves = s.resolves;
      ['note', 'tag', 'retires'].forEach(k => { if (s[k]) w[k] = s[k]; });
      return w;
    });
  }
  function withPlan(docs, projectId, suggestions) {
    const add = planToWork(projectId, suggestions).map(w => ({ id: w.id, data: w }));
    return Object.assign({}, docs, { workItem: ((docs && docs.workItem) || []).concat(add) });
  }
  // R9 §4 what the plan dialog says before Accept. forecastFinish equals projectTruth.forecastFinish after Accept
  // (planToWork stored as-is). {forecastFinish, deadline, fits, lateCount, message}.
  function planFit(docs, projectId, today, suggestions) {
    const sug = suggestions || suggestWorkFromDiff(docs, projectId, today);
    const t = projectTruth(withPlan(docs, projectId, sug), projectId, today);
    if (!t) return { forecastFinish: null, deadline: null, fits: false, lateCount: 0, message: 'This project could not be found.', warning: null, unassigned: [], longestTaskDays: 0, maxTaskDays: MAX_TASK_DAYS };
    const fin = t.forecastFinish, dl = t.deadline;
    const fits = !dl || !fin || fin <= dl;
    const keys = new Set(sug.map(s => s.key));
    const lateCount = t.late.filter(id => keys.has(id)).length;
    const message = !fin ? 'This plan has no dates yet.'
      : !dl ? 'Done by about ' + fmtDay(fin) + '. No deadline is set.'
      : fits ? 'Done by about ' + fmtDay(fin) + ', ' + nWord(t.bufferDays, 'business day') + ' before your ' + fmtDay(dl) + ' deadline.'
      : 'This plan needs until ' + fmtDay(fin) + ', past your ' + fmtDay(dl) + ' deadline.';
    // R11 §4 never offer a plan that is late on arrival without a clear warning and a choice
    const warning = fits ? null : { key: 'late-on-arrival', daysLate: dl && fin ? businessDaysBetween(dl, fin) : null,
      text: 'This needs until ' + fmtDay(fin) + ', past your ' + fmtDay(dl) + ' deadline' + (dl && fin ? ' (' + nWord(businessDaysBetween(dl, fin), 'business day') + ' late)' : '') + '.',
      options: [{ key: 'accept', label: 'Accept anyway' }, { key: 'adjust', label: 'Adjust' }] };
    const unassigned = sug.filter(x => !x.owner).map(x => ({ key: x.key, title: x.title, role: x.ownerRole || null, text: 'Needs an owner' + (x.ownerRole ? ': ' + x.ownerRole : '') }));
    const longest = sug.reduce((a, x) => Math.max(a, isDate(x.start) && isDate(x.due) ? businessDaysBetween(x.start, x.due) : 0), 0);
    return { forecastFinish: fin, deadline: dl, fits, lateCount, message, warning, unassigned, longestTaskDays: longest, maxTaskDays: MAX_TASK_DAYS };
  }

  /* ------------------------------------------------------------------ */
  /* Sprints (a view of the same data: a due date is a due date)         */
  /* ------------------------------------------------------------------ */
  // sprints(project, today, docs?): project.sprints when present; otherwise two-week sprints (Mon–Sun) from the
  // earliest work start (docs given) or today, to the later of the forecast finish and the target. Max 52.
  function sprints(project, today, docs) {
    if (!project) return [];
    if (Array.isArray(project.sprints) && project.sprints.length)
      return project.sprints.map((x, i) => ({ id: x.id || 'S' + (i + 1), name: x.name || 'Sprint ' + (i + 1), start: x.start || null, end: x.end || null }));
    const items = docs ? list(docs, 'workItem').filter(w => w.projectId === project.id) : [];
    const first = minDate(items.map(w => w.start).concat(items.map(w => w.due))) || (isDate(today) ? today : null);
    if (!first) return [];
    const fin = docs && items.length ? projectStats(docs, project.id, today).finish : null;
    const last = maxDate([fin, project.target, first].concat(items.map(w => w.due)));
    let ms = toMs(first);
    ms -= ((weekday(ms) + 6) % 7) * DAY;           // back to Monday
    const out = [];
    while (iso(ms) <= last && out.length < 52) {
      out.push({ id: 'S' + (out.length + 1), name: 'Sprint ' + (out.length + 1), start: iso(ms), end: iso(ms + 13 * DAY) });
      ms += 14 * DAY;
    }
    return out;
  }
  // The explicit item.sprintId (if it names a sprint), else the id of the sprint containing the due date, else null.
  function sprintOf(project, item, docs, today) {
    if (!item) return null;
    const list_ = sprints(project, today, docs);
    if (item.sprintId && list_.some(x => x.id === item.sprintId)) return item.sprintId;
    const d = item.due;
    const hit = isDate(d) && list_.find(x => x.start && x.end && d >= x.start && d <= x.end);
    return hit ? hit.id : null;
  }

  /* ------------------------------------------------------------------ */
  /* R5: labels, versions, planning, scenarios, usage, financials        */
  /* ------------------------------------------------------------------ */
  // "TC<n>": position among the element's cases, stable sort by creation (createdAt || at), then document order.
  function caseLabel(docs, caseId) {
    const all = list(docs, 'testCase');
    const c = all.find(x => x.id === caseId);
    if (!c) return null;
    const same = all.map((x, i) => ({ x, i })).filter(o => o.x.dataId === c.dataId)
      .sort((a, b) => String(a.x.createdAt || a.x.at || '').localeCompare(String(b.x.createdAt || b.x.at || '')) || a.i - b.i);
    return 'TC' + (same.findIndex(o => o.x.id === caseId) + 1);
  }

  // Compare two versions (current process, a draft, or a released entry: {tobe} or {asis} or a node array).
  // Nodes match by id. Output shape = diffProcess.
  function versionNodes(v) { return Array.isArray(v) ? v : v ? (v.tobe || v.asis || []) : []; }
  function diffVersions(a, b, docs) {
    const A = versionNodes(a), B = versionNodes(b);
    const ids = allNodeIds(A);
    const tag = nodes => (nodes || []).map(n => {
      if (!n) return n;
      const c = Object.assign({}, n);
      if (ids.has(n.id)) c.from = n.id; else delete c.from;
      if (Array.isArray(n.branches)) c.branches = n.branches.map(br => Object.assign({}, br, { nodes: tag(br && br.nodes) }));
      return c;
    });
    return diffProcess({ asis: A, tobe: tag(B) }, docs);
  }

  // Planned-date conflicts: a successor's planned start/finish violates its dependency
  // (FS: start ≥ dep finish + lag; SS: start ≥ dep start + lag; FF: due ≥ dep finish + lag). Business days.
  function plannedFinish(w) { return w.status === 'done' ? (w.doneAt || w.due) : w.due; }
  function depRequirement(dep, d, dates) {
    const ds = dates[dep.id] || { start: dep.start, due: plannedFinish(dep) };
    if (d.type === 'SS') return { field: 'start', min: addBusinessDays(ds.start, d.lag) };
    if (d.type === 'FF') return { field: 'due', min: addBusinessDays(ds.due, d.lag) };
    return { field: 'start', min: addBusinessDays(ds.due, 1 + d.lag) };   // R6: FS starts the business day after
  }
  function scheduleConflicts(docs, projectId) {
    const all = list(docs, 'workItem');
    const idx = byId(all);
    const out = [];
    all.filter(w => w.projectId === projectId && w.status !== 'done').forEach(w => normDeps(w).forEach(d => {
      const dep = idx[d.id];
      if (!dep) return;
      const req = depRequirement(dep, d, {});
      const have = w[req.field];
      if (!isDate(have) || !isDate(req.min) || have >= req.min) return;
      const rel = d.type === 'SS' ? 'starts' : 'finishes';
      out.push({ workId: w.id, dep: d.id, type: d.type, lag: d.lag, external: dep.projectId !== w.projectId,
        detail: '"' + (w.title || 'Untitled item') + '" ' + (req.field === 'start' ? 'starts ' : 'is due ') + fmtDay(have) + ', but "' + (dep.title || 'its dependency') + '"' +
          (dep.projectId !== w.projectId ? ' (external)' : '') + ' ' + rel + ' ' + fmtDay(d.type === 'SS' ? dep.start : plannedFinish(dep)) +
          (d.lag ? ' + ' + nWord(d.lag, 'business day') + ' lag' : '') + '; it can ' + (req.field === 'start' ? 'start' : 'finish') + ' on ' + fmtDay(req.min) + ' at the earliest.' });
    }));
    return out;
  }
  // Proposed {workId: {start, due}} that resolves conflicts: items (all open project items, or `workIds`) move later
  // only, keep their business-day span exactly, and are processed in dependency order. Items without a conflict
  // never move. FS: the successor starts the business day after its predecessor finishes. Unchanged items are omitted.
  function autoSchedule(docs, projectId, workIds) {
    const all = list(docs, 'workItem');
    const idx = byId(all);
    const movable = new Set(all.filter(w => w.projectId === projectId && w.status !== 'done' && (!workIds || workIds.includes(w.id))).map(w => w.id));
    const dates = {}, state = {};
    const place = id => {
      if (state[id] === 2) return; if (state[id] === 1) return;   // cycle: leave as is
      state[id] = 1;
      const w = idx[id];
      // R6: the business-day span is kept exactly (a same-day item stays same-day) and only items with a conflict move.
      const dur = isDate(w.start) && isDate(w.due) ? Math.max(0, businessDaysBetween(w.start, w.due)) : 0;
      let start = w.start, due = w.due, moved = false;
      normDeps(w).forEach(d => { if (idx[d.id] && movable.has(d.id)) place(d.id); });
      if (movable.has(id) && isDate(start) && isDate(due)) {
        normDeps(w).forEach(d => {
          const dep = idx[d.id]; if (!dep) return;
          const req = depRequirement(dep, d, dates);
          if (!isDate(req.min)) return;
          if (req.field === 'start' && start < req.min) { start = addBusinessDays(req.min, 0); due = addBusinessDays(start, dur); moved = true; }
          if (req.field === 'due' && due < req.min) { due = addBusinessDays(req.min, 0); start = addBusinessDays(due, -dur); moved = true; }
        });
        if (moved && start < addBusinessDays(w.start, 0)) { start = addBusinessDays(w.start, 0); due = addBusinessDays(start, dur); }
      }
      dates[id] = { start, due };
      state[id] = 2;
    };
    [...movable].forEach(place);
    const out = {};
    [...movable].forEach(id => { const w = idx[id]; if (dates[id] && (dates[id].start !== w.start || dates[id].due !== w.due)) out[id] = dates[id]; });
    return out;
  }

  // End-to-end scenarios: one per path through each linked to-be process. Decision branches expand into separate
  // paths; parallel branches are all walked in one path; a `goto` loop is followed once. Max 25 paths per process.
  function generateScenarios(docs, projectId) {
    const project = get(docs, 'project', projectId);
    if (!project) return [];
    const people = personMap(docs);
    const data = byId(list(docs, 'dataElement'));
    const pname = id => (people[id] && people[id].name) || 'The step owner';
    const out = [];
    linkedProcesses(docs, project).forEach(p => {
      const top = p.tobe || [];
      // locate(nodeId) → frames [{seq, i}] from the top level down to the node.
      const locate = (seq, id, frames) => {
        for (let i = 0; i < seq.length; i++) {
          const n = seq[i]; if (!n) continue;
          if (n.id === id) return frames.concat([{ seq, i }]);
          for (const br of n.branches || []) { const r = locate((br && br.nodes) || [], id, frames.concat([{ seq, i, into: true }])); if (r) return r; }
        }
        return null;
      };
      const paths = [];
      const walk = (stack, trail, labels, looped, guard) => {
        if (paths.length >= 25 || guard > 500) return;
        if (!stack.length) { paths.push({ trail, labels }); return; }
        const fr = stack[stack.length - 1];
        if (fr.i >= fr.seq.length) {
          const rest = stack.slice(0, -1);
          if (rest.length) { const up = rest[rest.length - 1]; rest[rest.length - 1] = { seq: up.seq, i: up.i + 1 }; }
          return walk(rest, trail, labels, looped, guard + 1);
        }
        const n = fr.seq[fr.i];
        const next = st => { const c = st.slice(); const t = c[c.length - 1]; c[c.length - 1] = { seq: t.seq, i: t.i + 1 }; return c; };
        if (!n) return walk(next(stack), trail, labels, looped, guard + 1);
        if (isGateway(n)) {
          const brs = (n.branches || []).filter(Boolean);
          if (n.type === 'parallel') {
            const nodes = brs.flatMap(b => b.nodes || []);
            const tr = trail.concat([{ gateway: n, label: brs.map(b => b.label).filter(Boolean).join(' + ') || 'all branches', parallel: true }]);
            return walk(stack.concat([{ seq: nodes, i: 0, parentGw: true }]), tr, labels, looped, guard + 1);
          }
          let options = brs.map((b, k) => ({ b, k })).filter(o => !(o.b.goto && looped.has(n.id + ':' + o.k)));
          if (!options.length) options = brs.map((b, k) => ({ b, k })).filter(o => !o.b.goto);
          options.forEach(o => {
            const tr = trail.concat([{ gateway: n, label: o.b.label || 'branch ' + (o.k + 1) }]);
            const lb = labels.concat([(n.title || 'Decision') + ' = ' + (o.b.label || 'branch ' + (o.k + 1))]);
            if (o.b.goto) {
              const lp = new Set(looped); lp.add(n.id + ':' + o.k);
              const branchSteps = flatSteps(o.b.nodes);
              const tr2 = tr.concat(branchSteps.map(st => ({ step: st })));
              const loc = locate(top, o.b.goto, []);
              if (!loc) return walk(next(stack), tr2, lb, lp, guard + 1);
              const st2 = loc.map(f => ({ seq: f.seq, i: f.i }));
              return walk(st2, tr2.concat([{ loopTo: o.b.goto }]), lb.concat(['loop back once']), lp, guard + 1);
            }
            walk(stack.concat([{ seq: o.b.nodes || [], i: 0 }]), tr, lb, looped, guard + 1);
          });
          return;
        }
        if (isStep(n)) return walk(next(stack), trail.concat([{ step: n }]), labels, looped, guard + 1);
        return walk(next(stack), trail, labels, looped, guard + 1);
      };
      walk([{ seq: top, i: 0 }], [], [], new Set(), 0);
      const titles = {}; allNodes(top).forEach(n => { titles[n.id] = n.title || 'an earlier step'; });
      paths.forEach((pt, k) => {
        const stepsArr = [];
        pt.trail.forEach(e => {
          if (e.step) stepsArr.push({ step: e.step.id, title: e.step.title || 'Untitled step', action: pname(e.step.owner) + ': ' + (e.step.title || 'untitled step'),
            expected: (e.step.data || []).length ? joinList(e.step.data.map(d => (data[d] && data[d].name) || 'the required data')) + ((e.step.data || []).length === 1 ? ' is' : ' are') + ' recorded correctly' : '"' + (e.step.title || 'The step') + '" is completed and recorded' });
          else if (e.gateway) stepsArr.push({ step: e.gateway.id, title: e.gateway.title || 'Gateway', action: e.parallel ? 'Run all branches of "' + (e.gateway.title || 'the gateway') + '" (' + e.label + ')' : 'At "' + (e.gateway.title || 'the decision') + '", choose "' + e.label + '"', expected: 'The flow follows "' + e.label + '"' });
          else if (e.loopTo) stepsArr.push({ step: e.loopTo, title: titles[e.loopTo] || 'an earlier step', action: 'Return to "' + (titles[e.loopTo] || 'an earlier step') + '"', expected: 'The flow repeats from "' + (titles[e.loopTo] || 'an earlier step') + '" once' });
        });
        const sd = [...new Set(pt.trail.filter(e => e.step).flatMap(e => stepData(e.step)))];
        out.push({ id: 'scn-' + p.id + '-' + (k + 1), pid: p.id, title: (p.name || 'Process') + ': ' + (pt.labels.length ? pt.labels.join(', ') : 'main path'), steps: stepsArr, data: sd });
      });
    });
    return out;
  }

  // Steps using a data element, counted separately for to-be and as-is (sub-steps included).
  function usageOf(docs, dataId) {
    const tobe = [], asis = [];
    list(docs, 'process').forEach(p => {
      flatSteps(p.tobe).forEach(s => { if (stepData(s).includes(dataId)) tobe.push({ pid: p.id, stepId: s.id }); });
      flatSteps(p.asis).forEach(s => { if (stepData(s).includes(dataId)) asis.push({ pid: p.id, stepId: s.id }); });
    });
    return { tobe: tobe.length, asis: asis.length, tobeSteps: tobe, asisSteps: asis };
  }

  /* Financials: cost = effortDays (default 1) × person.dayRate (default 800). */
  const DEFAULT_DAY_RATE = 800;
  function effortOf(w) { return hasEffort(w) ? +w.effortDays : 1; }
  function workCost(docs, workOrId) {
    const w = typeof workOrId === 'string' ? get(docs, 'workItem', workOrId) : workOrId;
    if (!w) return 0;
    const p = personMap(docs)[w.owner];
    const rate = p && p.dayRate != null && isFinite(+p.dayRate) ? +p.dayRate : DEFAULT_DAY_RATE;
    return Math.round(effortOf(w) * rate * 100) / 100;
  }
  // R8: actualCost = logged hours × rate (earnedValue AC); forecastCost = EAC (the one cost forecast);
  // estimate = Σ workCost (bottom-up planned cost); planned = the budget.
  function projectFinancials(docs, projectId, today) {
    const project = get(docs, 'project', projectId);
    const planned = project && project.budget && project.budget.planned != null && isFinite(+project.budget.planned) ? +project.budget.planned : null;
    return costOf(project, planned, earnedValue(docs, projectId, today));
  }
  // R10 §2: the cost forecast is EAC once CPI exists; before that it is the bottom-up estimate (forecastBasis says which).
  function costOf(project, planned, ev) {
    const r2 = n => Math.round(n * 100) / 100;
    const forecastCost = ev.EAC != null ? ev.EAC : ev.estimate, actualCost = ev.AC;
    return { planned, estimate: ev.estimate, forecastCost, forecastBasis: ev.EAC != null && ev.eacMethod === 'cpi' ? 'eac' : 'estimate', eacMethod: ev.eacMethod || null, actualCost, remainingCost: r2(Math.max(0, forecastCost - actualCost)),
      variance: planned == null ? null : r2(forecastCost - planned), overBudget: planned != null && forecastCost > planned,
      program: project && project.program || null };
  }
  // R6 earned value. Each item's value = workCost, scaled so values sum to BAC when budget.planned is set.
  //  PV: value scheduled by today (linear across start→due in business days; due ≤ today = all).
  //  EV: done = full value; otherwise value × logged progress (progress 0–1, else pct 0–100); no logged progress = 0
  //      (R9 §5: an untouched or merely "in progress" task earns nothing).
  //  AC: Σ time[].hours × dayRate/8 (rate of the person who logged, else the owner, else 800).
  //  SPI = EV/PV, CPI = EV/AC (null when the divisor is 0); EAC = BAC/CPI, or BAC when CPI is null.
  function progressOf(w) {
    if (w.status === 'done') return 1;
    if (w.progress != null && w.progress !== '' && isFinite(+w.progress)) return Math.min(1, Math.max(0, +w.progress));
    if (w.pct != null && w.pct !== '' && isFinite(+w.pct)) return Math.min(1, Math.max(0, +w.pct / 100));
    return 0;
  }
  function scheduledFraction(w, today) {
    if (!isDate(today) || !isDate(w.due)) return 0;
    if (w.due <= today) return 1;
    if (!isDate(w.start) || w.start > today) return 0;
    const span = businessDaysBetween(w.start, w.due);
    return span > 0 ? Math.min(1, Math.max(0, businessDaysBetween(w.start, today) / span)) : 0;
  }
  function rateOf(docs, id) { const p = personMap(docs)[id]; return p && p.dayRate != null && isFinite(+p.dayRate) ? +p.dayRate : null; }
  function earnedValue(docs, projectId, today) {
    const project = get(docs, 'project', projectId);
    const items = list(docs, 'workItem').filter(w => w.projectId === projectId);
    const r2 = n => Math.round(n * 100) / 100;
    const costs = items.map(w => workCost(docs, w));
    const total = costs.reduce((a, b) => a + b, 0);
    const planned = project && project.budget && project.budget.planned != null && isFinite(+project.budget.planned) && +project.budget.planned > 0 ? +project.budget.planned : null;
    const BAC = planned != null ? planned : total;
    const scale = total > 0 ? BAC / total : 0;
    let PV = 0, EV = 0, AC = 0;
    items.forEach((w, i) => {
      const v = costs[i] * scale;
      PV += v * scheduledFraction(w, today);
      EV += v * progressOf(w);
      (Array.isArray(w.time) ? w.time : []).forEach(t => {
        const h = t && isFinite(+t.hours) ? +t.hours : 0;
        const rate = rateOf(docs, t && t.by) ?? rateOf(docs, w.owner) ?? DEFAULT_DAY_RATE;
        AC += h * rate / 8;
      });
    });
    // R10 §2: SPI and CPI are blank (null) until work has started (some task done or with logged progress, so EV > 0)
    // AND actual cost > 0. EAC = BAC / CPI, blank when CPI is blank. pctDone is the share of the budgeted work done:
    // EV = BAC × pctDone exactly, and the "% done" tile shows round(pctDone × 100).
    const started = EV > 0;
    // R11 §6: money spent with nothing finished shows 0.00 (never "—") and is flagged.
    const spentNothing = AC > 0 && !started;
    const SPI = PV > 0 && AC > 0 && (started || spentNothing) ? r2(EV / PV) : null, CPI = AC > 0 && (started || spentNothing) ? r2(EV / AC) : null;
    // R11 §6 ONE expected-cost (EAC) method for every project: BAC / CPI when CPI is defined and above 0; otherwise
    // max(bottom-up estimate, spent + remaining estimate). Never below what is already spent.
    const remainingEst = items.reduce((a, w, i) => a + (w.status === 'done' ? 0 : costs[i] * (1 - progressOf(w))), 0);
    const eacMethod = CPI ? 'cpi' : 'bottom-up';
    const EAC = !items.length ? null : r2(Math.max(AC, CPI ? BAC / (EV / AC) : Math.max(total, AC + remainingEst)));
    const pctDone = BAC > 0 ? EV / BAC : 0;
    const doneNoHours = items.filter(w => w.status === 'done' && !(Array.isArray(w.time) ? w.time : []).some(t => t && isFinite(+t.hours) && +t.hours > 0)).map(w => w.id);
    const flags = [];
    if (spentNothing) flags.push({ key: 'spent-nothing-finished', text: 'Spent with nothing finished' });
    if (doneNoHours.length) flags.push({ key: 'done-no-hours', items: doneNoHours, text: nWord(doneNoHours.length, 'task') + ' marked Done with no hours logged, so the cost figures may be too low' });
    return { BAC: r2(BAC), PV: r2(PV), EV: r2(EV), AC: r2(AC), SPI, CPI, EAC, eacMethod, remainingEstimate: r2(remainingEst), estimate: r2(total), pctDone, pct: Math.round(pctDone * 100), started,
      spentNothing, doneNoHours, flags };
  }

  // R6 capacity leveling. Load: each open item's effort (effortDays, default 1) is spread evenly over the business
  // days from start to due (inclusive); weeks start on Monday; capacity = person.capacity days/week (default 4).
  // While a (person, week) is over capacity, the latest-starting idle, non-critical item of that person active in
  // that week moves one business day later (start and due together, so its business-day span is kept), and FS
  // successors that would now start too early move with it. An overload with no movable item, or that only one item
  // causes, is left in overloadsAfter. Returns {shifts: {workId: {start, due}}, overloadsBefore, overloadsAfter}.
  function bizDaysIncl(start, due) {
    const out = [];
    if (!isDate(due)) return out;
    let d = addBusinessDays(isDate(start) && start <= due ? start : due, 0);
    for (let g = 0; d <= due && g < 1000; g++) { out.push(d); d = addBusinessDays(d, 1); }
    return out.length ? out : [addBusinessDays(due, 0)];
  }
  function mondayOf(d) { const ms = toMs(d); return iso(ms - ((weekday(ms) + 6) % 7) * DAY); }
  function shiftBiz(d, n) { return isDate(d) ? addBusinessDays(addBusinessDays(d, 0), n) : d; }
  function weeklyLoad(items, dates, people) {
    const load = {};
    items.forEach(w => {
      if (!w.owner || w.status === 'done') return;
      const dt = dates[w.id];
      const days = bizDaysIncl(dt.start, dt.due);
      if (!days.length) return;
      const per = effortOf(w) / days.length;
      days.forEach(d => { const k = w.owner + '|' + mondayOf(d); load[k] = (load[k] || 0) + per; });
    });
    const capOf = id => people[id] && people[id].capacity != null && isFinite(+people[id].capacity) ? +people[id].capacity : 4;
    return Object.keys(load).map(k => { const [person, week] = k.split('|'); return { person, week, load: Math.round(load[k] * 100) / 100, capacity: capOf(person) }; })
      .filter(o => o.load > o.capacity + 1e-9).sort((a, b) => a.week.localeCompare(b.week) || a.person.localeCompare(b.person));
  }
  function levelResources(docs, projectId, today) {
    const items = list(docs, 'workItem').filter(w => w.projectId === projectId && isDate(w.due));
    const people = personMap(docs);
    const dates = {}, orig = {};
    items.forEach(w => { dates[w.id] = { start: isDate(w.start) ? w.start : w.due, due: w.due }; orig[w.id] = Object.assign({}, dates[w.id]); });
    const critical = new Set(criticalPath(docs, projectId, today));
    const before = weeklyLoad(items, dates, people);
    const moved = {}, stuck = new Set();
    const activeIn = (w, week) => bizDaysIncl(dates[w.id].start, dates[w.id].due).some(d => mondayOf(d) === week);
    const push = (w, n) => {
      dates[w.id] = { start: shiftBiz(dates[w.id].start, n), due: shiftBiz(dates[w.id].due, n) };
      moved[w.id] = (moved[w.id] || 0) + n;
      items.forEach(s => {   // FS successors keep starting after this item finishes
        if (s.status === 'done') return;
        normDeps(s).forEach(dp => {
          if (dp.id !== w.id || dp.type !== 'FS') return;
          const need = addBusinessDays(dates[w.id].due, 1 + dp.lag);
          if (dates[s.id].start < need) push(s, businessDaysBetween(dates[s.id].start, need));
        });
      });
    };
    for (let guard = 0; guard < 3000; guard++) {
      const o = weeklyLoad(items, dates, people).find(x => !stuck.has(x.person + '|' + x.week));
      if (!o) break;
      const active = items.filter(w => w.owner === o.person && w.status !== 'done' && activeIn(w, o.week));
      const cands = active.length < 2 ? [] : active.filter(w => w.status === 'idle' && !critical.has(w.id) && (moved[w.id] || 0) < 130
        && (!isDate(today) || dates[w.id].start >= today || moved[w.id]))
        .sort((a, b) => dates[b.id].start.localeCompare(dates[a.id].start) || String(b.id).localeCompare(String(a.id)));
      const candSet = new Set(cands.map(w => w.id));
      const fixedLoad = active.filter(w => !candSet.has(w.id)).reduce((a, w) => {
        const days = bizDaysIncl(dates[w.id].start, dates[w.id].due);
        return a + effortOf(w) / days.length * days.filter(d => mondayOf(d) === o.week).length;
      }, 0);
      if (!cands.length || fixedLoad > o.capacity + 1e-9) { stuck.add(o.person + '|' + o.week); continue; }
      push(cands[0], 1);
    }
    const shifts = {};
    items.forEach(w => { if (dates[w.id].start !== orig[w.id].start || dates[w.id].due !== orig[w.id].due) shifts[w.id] = dates[w.id]; });
    return { shifts, overloadsBefore: before, overloadsAfter: weeklyLoad(items, dates, people) };
  }

  // R6 what-if: apply scenario.dates {workId: {start?, due?}} to a copy of the docs and compare with the plan.
  // Cost here = effort × owner dayRate where effort is effortDays, or — when unset — the item's business-day span
  // (start→due, min 1), so resizing a bar in a scenario changes its cost. finish = projectStats finish.
  function spanCost(docs, w) {
    const p = personMap(docs)[w.owner];
    const rate = p && p.dayRate != null && isFinite(+p.dayRate) ? +p.dayRate : DEFAULT_DAY_RATE;
    return (hasEffort(w) ? +w.effortDays : duration(w)) * rate;
  }
  function compareScenario(docs, projectId, scenario, today) {
    const sd = (scenario && scenario.dates) || {};
    const changed = [];
    const workItem = ((docs && docs.workItem) || []).map(e => {
      if (!e) return e;
      const d = e.data || {}, id = e.id != null ? e.id : d.id;
      const x = sd[id];
      if (!x || d.projectId !== projectId) return e;
      const nd = Object.assign({}, d);
      if (isDate(x.start)) nd.start = x.start;
      if (isDate(x.due)) nd.due = x.due;
      if (nd.start === d.start && nd.due === d.due) return e;
      changed.push(id);
      return Object.assign({}, e, { data: nd });
    });
    const docs2 = Object.assign({}, docs, { workItem });
    const cost = dd => Math.round(list(dd, 'workItem').filter(w => w.projectId === projectId).reduce((a, w) => a + spanCost(dd, w), 0) * 100) / 100;
    return { planFinish: projectStats(docs, projectId, today).finish, scenarioFinish: projectStats(docs2, projectId, today).finish,
      planCost: cost(docs), scenarioCost: cost(docs2), changed };
  }

  // R6 default target for a new project: the first business day on or after today + 60 calendar days.
  function defaultTarget(today) { return isDate(today) ? addBusinessDays(addDays(today, 60), 0) : null; }

  // R6 latest real outcome per case/script id for a project's runs (optionally one env), same rules as the gate:
  // 'not-run'/'skipped' never override; a script pass without evidence counts only from a 'ci' run.
  // Returns {id: {outcome, runId, at}}.
  function latestOutcomes(docs, projectId, env) {
    const m = {};
    list(docs, 'testRun').filter(r => r.projectId === projectId && (!env || r.env === env))
      .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
      .forEach(r => (r.results || []).forEach(x => {
        const k = x && (x.caseId || x.scriptId); if (!k) return;
        if (x.outcome === 'not-run' || x.outcome === 'skipped') return;
        if (x.scriptId && x.outcome === 'pass' && r.source !== 'ci' && !String(x.evidence || '').trim()) return;
        m[k] = { outcome: x.outcome, runId: r.id, at: r.at || null };
      }));
    return m;
  }

  // R6 traceability headline: spec-field coverage beside UAT and dev pass counts.
  // fields = spec fields of data used by the project's to-be steps; covered = a non-custom case on that field.
  // uat: cases + UAT scripts/scenarios whose latest UAT outcome is pass; dev: cases whose latest dev outcome is pass.
  function testCoverage(docs, projectId) {
    const project = get(docs, 'project', projectId);
    // R8: only information the project changes needs tests.
    const used = changedInformation(docs, project).map(x => x.dataId);
    const usedSet = new Set(used);
    const dataIdx = byId(list(docs, 'dataElement'));
    const cases = list(docs, 'testCase').filter(c => usedSet.has(c.dataId));
    let fieldsTotal = 0;
    const uncoveredFields = [];
    used.forEach(d => ((dataIdx[d] && dataIdx[d].fields) || []).forEach(f => {
      if (!f) return;
      fieldsTotal++;
      const k = tokens(f.name);
      if (!cases.some(c => c.dataId === d && c.kind !== 'custom' && tokens(c.field) === k)) uncoveredFields.push({ data: d, field: f.name });
    }));
    const scripts = !project ? [] : (Array.isArray(project.uatScripts) ? project.uatScripts : generateUatScripts(docs, projectId))
      .concat(Array.isArray(project.uatScenarios) ? project.uatScenarios : []);
    const uat = latestOutcomes(docs, projectId, 'uat');
    // R8: any dev/sit/system run counts toward the system stage ("Try it out").
    const sys = {};
    ['dev', 'sit', 'system'].map(env => latestOutcomes(docs, projectId, env)).forEach(m => Object.keys(m).forEach(k => {
      if (!sys[k] || String(m[k].at || '') >= String(sys[k].at || '')) sys[k] = m[k];
    }));
    const passed = (m, ids) => ids.filter(id => m[id] && m[id].outcome === 'pass').length;
    const uatIds = cases.map(c => c.id).concat(scripts.map(s => s.id));
    const system = { done: passed(sys, cases.map(c => c.id)), total: cases.length, label: 'Try it out' };
    return { fieldsTotal, fieldsCovered: fieldsTotal - uncoveredFields.length, uncoveredFields,
      uat: { done: passed(uat, uatIds), total: uatIds.length, label: 'Business sign-off' }, system, dev: system };
  }

  // R6 defect lifecycle: new → triaged → in-progress → fixed → verified → closed.
  //  closed   = defectStatus 'closed' or the work item is done;
  //  verified = the referenced case/script (testRef) has a latest outcome of pass from a run after the run that
  //             raised the defect (any env of the project) — a passing retest verifies automatically;
  //  else defectStatus when valid ('in progress' accepted), else from status (prog → in-progress, otherwise new).
  const DEFECT_STATES = ['new', 'triaged', 'in-progress', 'fixed', 'verified', 'closed'];
  function defectState(docs, defectId) {
    const w = typeof defectId === 'string' ? get(docs, 'workItem', defectId) : defectId;
    if (!w) return null;
    const ds = String(w.defectStatus || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (ds === 'closed' || w.status === 'done') return 'closed';
    const ref = w.testRef || {};
    const itemId = ref.caseId || ref.scriptId;
    if (itemId) {
      const last = latestOutcomes(docs, w.projectId)[itemId];
      const src = ref.runId ? get(docs, 'testRun', ref.runId) : null;
      const after = !src || !last || String(last.at || '') > String(src.at || '') || (!src.at && last.runId !== src.id);
      if (last && last.outcome === 'pass' && last.runId !== ref.runId && after) return 'verified';
    }
    if (ds === 'verified') return 'fixed';   // verified needs a passing retest
    if (DEFECT_STATES.includes(ds)) return ds;
    return w.status === 'prog' ? 'in-progress' : 'new';
  }
  // Defects of a project that a passing retest has verified and that can now be closed.
  function defectsVerifiable(docs, projectId) {
    return list(docs, 'workItem').filter(w => w.projectId === projectId && w.kind === 'defect' && defectState(docs, w) === 'verified').map(w => w.id);
  }

  // Burndown of remaining effort (days). Points on business days from the earliest work start to max(target, today);
  // weekly (Mondays) when the span exceeds 90 business days. remaining = total − effort done by that date (doneAt,
  // else due); null after today. ideal falls linearly from the total at start to 0 at the target.
  function burndown(docs, projectId, today) {
    const project = get(docs, 'project', projectId);
    const items = list(docs, 'workItem').filter(w => w.projectId === projectId);
    if (!project || !items.length) return [];
    const start = addBusinessDays(minDate(items.map(w => w.start).concat(items.map(w => w.due))), 0);
    const target = isDate(project.target) ? project.target : maxDate(items.map(w => w.due));
    const end = maxDate([target, today, start]);
    const total = items.reduce((a, w) => a + effortOf(w), 0);
    const span = Math.max(1, businessDaysBetween(start, target));
    const weekly = businessDaysBetween(start, end) > 90;
    const out = [];
    for (let d = start, guard = 0; d <= end && guard < 2000; guard++) {
      const doneEffort = items.filter(w => w.status === 'done' && (w.doneAt || w.due) <= d).reduce((a, w) => a + effortOf(w), 0);
      const ideal = Math.max(0, total * (1 - businessDaysBetween(start, d) / span));
      out.push({ date: d, remaining: isDate(today) && d > today ? null : Math.round((total - doneEffort) * 100) / 100, ideal: Math.round(ideal * 100) / 100 });
      d = weekly ? addBusinessDays(d, 5) : addBusinessDays(d, 1);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* R7 SIMPLICITY: plain-language summaries. No internal ids in text.   */
  /* ------------------------------------------------------------------ */
  function projOf(docs, prj) { return typeof prj === 'string' ? get(docs, 'project', prj) : (prj && prj.id ? get(docs, 'project', prj.id) || prj : null); }
  function nameOf(docs, id) { const p = personMap(docs)[id]; return (p && p.name) || 'someone'; }
  function dataName(docs, id) { const d = get(docs, 'dataElement', id); return (d && d.name) || 'some information'; }

  // R7 one label set for information state, used on every page.
  const AVAIL_LABELS = {
    live: { key: 'connected', label: 'Connected', tone: 'green' },
    example: { key: 'sample', label: 'Sample only', tone: 'amber' },
    missing: { key: 'notyet', label: 'Not available yet', tone: 'red' },
    pending: { key: 'waiting', label: 'Waiting for confirmation', tone: 'amber' },
    problem: { key: 'problem', label: 'Has a problem', tone: 'amber' },
    unchecked: { key: 'unchecked', label: 'Not checked yet', tone: 'amber' },   // R10: never "We have it" / "Connected"
  };
  // R8 Simple has two states only: "We have it" / "Not available yet" (state = the effective state; needsConfirm
  // when only the owner's confirmation is missing). {advanced: true} returns the detailed R7 labels.
  const SIMPLE_AVAIL = { have: { key: 'have', label: 'We have it', tone: 'green' }, notyet: { key: 'notyet', label: 'Not available yet', tone: 'red' } };
  function availLabel(docs, dataId, opts) {
    const st = effectiveAvail(docs, dataId);
    if (opts && opts.advanced) return Object.assign({ state: st }, AVAIL_LABELS[st] || AVAIL_LABELS.missing);
    if (st === 'problem') return Object.assign({ state: st, needsConfirm: false }, AVAIL_LABELS.problem);
    if (st === 'unchecked') return Object.assign({ state: st, needsConfirm: false }, AVAIL_LABELS.unchecked);
    return Object.assign({ state: st, needsConfirm: st === 'pending' }, st === 'live' ? SIMPLE_AVAIL.have : SIMPLE_AVAIL.notyet, st === 'pending' || st === 'example' ? { tone: 'amber' } : {});
  }
  // R8 "Confirm all": information waiting for this person's confirmation (fix done by someone else).
  function awaitingConfirmation(docs, personId) {
    const work = list(docs, 'workItem'), ctx = availCtx(docs);
    return list(docs, 'dataElement').filter(d => dataOwnerOf(docs, d, ctx) === personId && availOf(d, work, docs, ctx) === 'pending').map(d => d.id);
  }

  // Rough plain distance between two dates: "3 days", "about 2 weeks", "about 3 months".
  function roughGap(days) {
    days = Math.abs(days);
    if (days < 10) return nWord(days, 'day');
    if (days < 60) return 'about ' + nWord(Math.round(days / 7), 'week');
    return 'about ' + nWord(Math.round(days / 30), 'month');
  }
  // R8: "At risk" only when the forecast misses the deadline or an unplanned blocker exists.
  // R9 §1: the Simple labels. Advanced may keep "At risk" for red.
  const RAG_LABEL = { green: 'On track', amber: 'Some tasks late', red: 'Will miss the deadline', grey: 'Not planned' };
  const RAG_LABEL_ADVANCED = { green: 'On track', amber: 'Some tasks late', red: 'At risk', grey: 'Not planned' };

  // R9 §1 the one ranked "who needs to act" list. Ranks: unplanned blockers, past due, late items delaying others,
  // other late items, information being made available / open problems, approvals ready, tests to run.
  // [{person, name, what, why, href, ref, rank, action}] (action = what, kept for R8 callers).
  const WHO_RANK = { plan: 5, blocker: 10, 'past-due': 20, deadline: 25, delaying: 30, late: 40, info: 45, problem: 47, approval: 50, test: 60 };
  function q(t) { return '“' + (t || 'untitled task') + '”'; }
  function problemTitle(w) { return capFirst(String((w && w.title) || 'untitled problem').replace(/^\s*fix\s*:\s*/i, '')); }
  function taskHref(project, w) { return '/project/' + (w.projectId || (project && project.id) || '') + '?task=' + encodeURIComponent(w.id); }
  function whoOf(docs, project, c, extra) {
    extra = extra || {};
    const out = [], seen = new Set();
    const add = (person, what, why, href, ref) => {
      const key = ref || (why + ':' + person + ':' + what);
      if (seen.has(key)) return; seen.add(key);
      out.push({ person: person || null, name: person ? nameOf(docs, person) : 'Nobody', what, why, href: href || '/project/' + project.id, ref: ref || null, rank: WHO_RANK[why] || 99, action: what });
    };
    if (c.rag === 'grey') { add(project.owner, 'Add the work or accept a suggested plan', 'plan', '/project/' + project.id, 'plan:' + project.id); return out; }
    const fc = c.fc;
    const openIds = new Set(c.open.map(w => w.id));
    const holding = w => dependents(docs, w.id).filter(id => openIds.has(id)).length;
    const verb = w => w.kind === 'defect' ? 'Fix the problem: ' + q(problemTitle(w)) : 'Finish ' + q(w.title);
    // R11 §5 one blocking definition: every projectTruth.blocking item (information not available yet that holds up
    // at least one open task, planned or not) is exactly one 'blocker' row, so who.filter(blocker) = blocking.count
    // and the "What's blocking" box is a view of this list. A planned blocker's row is its open fix task's action
    // (that task is then not listed again); missing information that holds nothing up is an 'info' row.
    const workIdx = byId(c.open);
    const resolverWhat = w => c.pastDue.includes(w.id) ? verb(w) + (isDate(w.due) && isDate(c.today) && w.due < c.today ? ' (was due ' + fmtDay(w.due) + ')' : isDate(w.due) ? ' (due ' + fmtDay(w.due) + ')' : '')
      : c.finishAfterDue.includes(w.id) || (fc[w.id] && fc[w.id].causesSlip) ? 'Get ' + q(w.title) + ' back on schedule' : verb(w);
    c.blockers.filter(b => b.held > 0).forEach(b => {
      if (!b.planned) return add(b.owner, 'Plan work to get ' + b.name, 'blocker', '/data/' + b.dataId, 'data:' + b.dataId);
      const rw = b.resolver && workIdx[b.resolver];
      add(rw ? rw.owner || b.resolverOwner || b.owner : b.resolverOwner || b.owner, rw ? resolverWhat(rw) : 'Get ' + b.name + ' ready', 'blocker', '/data/' + b.dataId, 'data:' + b.dataId);
      if (rw) { seen.add('work:' + rw.id); const row = out[out.length - 1]; if (row && row.ref === 'data:' + b.dataId) row.workId = rw.id; }
    });
    c.blockers.filter(b => !b.planned && !(b.held > 0)).forEach(b => add(b.owner, 'Plan work to get ' + b.name, 'info', '/data/' + b.dataId, 'data:' + b.dataId));
    const byHold = arr => arr.map(w => ({ w, n: holding(w) })).sort((x, y) => y.n - x.n || String(x.w.due || '').localeCompare(String(y.w.due || '')));
    byHold(c.open.filter(w => c.pastDue.includes(w.id))).forEach(({ w }) =>
      add(w.owner, verb(w) + (isDate(w.due) && isDate(c.today) && w.due < c.today ? ' (was due ' + fmtDay(w.due) + ')' : isDate(w.due) ? ' (due ' + fmtDay(w.due) + ')' : ''), 'past-due', taskHref(project, w), 'work:' + w.id));
    if (c.finish && c.target && c.finish > c.target && !c.late.length) add(project.owner, 'Review the plan: the work finishes after the deadline', 'deadline', '/project/' + project.id, 'deadline:' + project.id);
    const fad = byHold(c.open.filter(w => c.finishAfterDue.includes(w.id)));
    fad.filter(x => x.n > 0 || (fc[x.w.id] && fc[x.w.id].causesSlip)).forEach(({ w }) => add(w.owner, 'Get ' + q(w.title) + ' back on schedule', 'delaying', taskHref(project, w), 'work:' + w.id));
    // not late itself, but the reason another task finishes after its due date
    byHold(c.open.filter(w => !c.late.includes(w.id) && fc[w.id] && fc[w.id].causesSlip)).forEach(({ w }) => add(w.owner, 'Get ' + q(w.title) + ' back on schedule', 'delaying', taskHref(project, w), 'work:' + w.id));
    fad.forEach(({ w }) => add(w.owner, (w.kind === 'defect' ? 'Fix the problem: ' + q(problemTitle(w)) : 'Get ' + q(w.title) + ' back on schedule'), 'late', taskHref(project, w), 'work:' + w.id));
    // a planned blocker whose fix task is already listed above is not listed twice
    c.blockers.filter(b => b.planned && !(b.resolver && seen.has('work:' + b.resolver))).forEach(b => add(b.resolverOwner || b.owner, 'Get ' + b.name + ' ready', 'info', '/data/' + b.dataId, 'data:' + b.dataId));
    c.open.filter(w => w.kind === 'defect').forEach(w => add(w.owner, 'Fix the problem: ' + q(problemTitle(w)), 'problem', taskHref(project, w), 'work:' + w.id));
    (extra.approvals || []).forEach(a => {
      if (!a.needed || a.approved || !a.ready) return;
      if (a.blockedBy) add(project.owner, a.blockedBy.fix, 'approval', '/release/' + project.id + '?bu=' + encodeURIComponent(a.bu), 'approval:' + a.bu);
      else if (a.approver) add(a.approver, 'Approve ' + a.bu + "'s part", 'approval', '/release/' + project.id + '?bu=' + encodeURIComponent(a.bu), 'approval:' + a.bu);
    });
    const t = extra.testing;
    if (t && t.stage && t.stage !== 'done' && t.next) add(project.testLead || project.owner, t.next, 'test', '/testing/' + project.id, 'testing:' + project.id);
    return out.sort((x, y) => x.rank - y.rank);
  }
  // R9 §1 status sentence: the forecast and the deadline, then the late count and the first name to act.
  function sentenceOf(docs, project, c, who) {
    if (c.rag === 'grey') return 'No work has been planned yet, so there is nothing to track. Next: add the work or accept a suggested plan.';
    const { finish, target, allDone, blockers } = c;
    const bd = n => nWord(Math.abs(n), 'business day');
    let timing;
    if (allDone) timing = blockers.length ? 'Every planned task is finished' + (finish ? ' (' + fmtDay(finish) + ')' : '') + '.' : 'All work is done' + (finish ? ', finished ' + fmtDay(finish) : '') + '.';
    else if (!finish) timing = 'The work has no dates yet.';
    else if (!target) timing = 'Expected ' + fmtDay(finish) + '. No deadline is set.';
    else if (finish === target) timing = 'Expected ' + fmtDay(finish) + ', right on the ' + fmtDay(target) + ' deadline.';
    else if (finish < target) timing = 'Expected ' + fmtDay(finish) + ', ' + bd(c.bufferDays) + ' before the ' + fmtDay(target) + ' deadline.';
    else timing = 'Expected ' + fmtDay(finish) + ', ' + bd(c.bufferDays) + ' after the ' + fmtDay(target) + ' deadline.';
    const parts = [timing];
    const nm = p => p ? ' (' + nameOf(docs, p) + ')' : '';
    const unplanned = blockers.filter(b => !b.planned);
    if (unplanned.length) parts.push(capFirst(unplanned[0].text) + nm(unplanned[0].owner) + '.' + (unplanned.length > 1 ? ' ' + nWord(unplanned.length - 1, 'other piece') + ' of information ' + (unplanned.length === 2 ? 'is' : 'are') + ' missing too.' : ''));
    if (c.late.length) {
      const first = who.find(x => ((x.why === 'past-due' || x.why === 'delaying' || x.why === 'late') && x.ref && c.late.includes(x.ref.slice(5))) || (x.why === 'blocker' && x.workId && c.late.includes(x.workId)));
      const w = first ? c.open.find(x => x.id === first.workId || 'work:' + x.id === first.ref) : c.open.find(x => c.late.includes(x.id));
      parts.push((c.late.length === 1 ? '1 task is late: ' : c.late.length + ' tasks are late; first: ') + q(w && w.title) + nm(w && w.owner) + '.');
    } else if (!unplanned.length) {
      const pb = blockers.find(b => b.planned);
      if (pb) parts.push(capFirst(pb.name) + ' is not available yet; work is planned to get it' + nm(pb.resolverOwner || pb.owner) + '.');
      else if (who.length) parts.push('Next: ' + who[0].what.charAt(0).toLowerCase() + who[0].what.slice(1) + nm(who[0].person) + '.');
      else if (!allDone) parts.push('Nothing needs attention right now.');
    }
    return parts.join(' ');
  }
  // R8 compatibility: {sentence, rag, label, who} — now read from projectTruth so every caller agrees.
  function projectSummary(docs, prj, today) {
    const t = projectTruth(docs, prj, today);
    if (!t) return { sentence: 'This project could not be found.', rag: 'grey', label: RAG_LABEL.grey, who: [] };
    return { sentence: t.sentence, rag: t.rag, label: t.label, who: t.who };
  }

  // R7 "Is testing finished?" in one line. R9: the same object as projectTruth(...).testing.
  function testingSummary(docs, prj, today) {
    const t = projectTruth(docs, prj, today || null);
    if (!t) return { done: false, sentence: 'This project could not be found.', nextAction: { key: 'none', label: 'Nothing to do' }, stage: 'create', next: '', perBU: {} };
    return t.testing;
  }
  // R9 §6 the one testing count. needTests (information the project changes), haveTests (with at least one test),
  // total / passed / failed / notRun (latest result in any stage; blocked counts as not run), stage
  // 'create'|'tryout'|'business'|'done', and ONE plain `next` sentence every screen shows. perBU is added by
  // projectTruth. R8 fields (done, count, sentence, stages, nextAction, changedInformation) are kept.
  function testingCore(docs, project, r) {
    const c = (r.checks || []).find(x => x.id === 'tests-passed');
    const READY = 'Ready for business sign-off';
    if (r.released) return { done: true, passed: null, total: null, failed: 0, notRun: 0, blocked: 0, waitingForFix: 0, needTests: 0, haveTests: 0, count: '', stage: 'done', next: 'Testing was finished before launch',
      sentence: 'Yes: testing was finished before launch.', stages: [], nextAction: { key: 'none', label: 'Testing was finished before launch' }, perBU: {}, coverage: null, phases: {} };
    if (!c) return { done: false, passed: 0, total: 0, failed: 0, notRun: 0, blocked: 0, waitingForFix: 0, needTests: 0, haveTests: 0, count: '0 of 0 tests passed', stage: 'create', next: 'Add the work first',
      sentence: 'Not yet: no tests have been set up.', stages: [], nextAction: { key: 'create', label: 'Add the work first' }, perBU: {}, coverage: null, phases: {} };
    const tf = r._tf || testFacts(docs, project);
    const n = a => (a || []).length;
    const total = tf.ids.length;
    const passed = tf.passed.length, failedOnly = tf.failed.length, waitingForFix = tf.fix.length, blocked = tf.blocked.length;
    const failed = failedOnly + waitingForFix;
    const notRun = total - passed - failed;   // blocked counts as not run
    const cov = tf.coverage;
    const needTests = cov.needTests, haveTests = cov.haveTests;
    const toAdd = cov.notCovered;
    const count = passed + ' of ' + nWord(total, 'test') + ' passed';
    const stages = [Object.assign({}, tf.stages.system), Object.assign({}, tf.stages.uat)];
    let stage, next, key;
    const fixN = n(c.defects) || failed;
    if (c.pass) { stage = 'done'; next = READY; key = 'none'; }
    else if (toAdd.length) { stage = 'create'; key = 'generate'; next = 'Add tests for ' + nWord(toAdd.length, 'new piece') + ' of information'; }
    else if (cov.scriptGaps.length) { stage = 'create'; key = 'scripts'; next = 'Add business check scripts for ' + nWord(cov.scriptGaps.length, 'changed step'); }
    else {
      stage = !tf.stages.system.done ? 'tryout' : 'business';
      if (fixN) { key = 'fix'; next = 'Fix ' + nWord(fixN, 'problem') + ', then re-run ' + (fixN === 1 ? 'its test' : 'their tests'); }
      else if (stage === 'tryout') { key = 'run-build'; next = 'Try out the ' + nWord(tf.stages.system.notRun || tf.caseIds.length, 'test'); }
      else if (notRun) { key = 'run'; next = 'Run the business check for ' + nWord(notRun, 'test'); }
      else if (n(c.noEvidence)) { key = 'evidence'; next = 'Add evidence to ' + nWord(n(c.noEvidence), 'passed test'); }
      else { key = 'review'; next = 'Review the test results'; }
    }
    const done = !!c.pass;
    const sentence = done ? (total ? 'Yes: ' + count + ' and no problems are open.' : 'Yes: nothing this project changes needs testing.')
      : 'Not yet: ' + count + '. Next: ' + next.charAt(0).toLowerCase() + next.slice(1) + '.';
    // per-test status for any screen that lists tests: 'passed' | 'failed' | 'fix' | 'blocked' | 'notRun'
    const statusById = Object.assign({}, tf.status);
    const phases = {};
    ['system', 'uat'].forEach(k => { phases[k] = {}; Object.keys(tf.phase[k]).forEach(id => { phases[k][id] = tf.phase[k][id].outcome; }); });
    return { done, passed, total, failed, failedOnly, waitingForFix, blocked, notRun, needTests, haveTests, count, stage, next, sentence, stages,
      changedInformation: n(c.changedData), problems: n(c.defects), nextAction: { key, label: next },
      coverage: { denominator: cov.denominator, needTests, haveTests, gaps: cov.gaps, notCovered: cov.notCovered.slice(), elements: cov.elements.map(e => Object.assign({}, e)),
        fieldsTotal: cov.fieldsTotal, fieldsCovered: cov.fieldsCovered, uncoveredFields: cov.uncoveredFields.slice(), scriptGaps: cov.scriptGaps.slice(), notChanged: cov.notChanged.slice(),
        text: cov.gaps ? nWord(cov.gaps, 'coverage gap') + ': ' + joinList(cov.elements.filter(e => !e.covered).map(e => e.name + (e.state === 'no-cases' ? ' has no tests' : ' has no test for ' + joinList(e.uncoveredFields, 3))).concat(cov.scriptGaps.map(g => '“' + g.title + '” has no business check script')), 4)
          : (needTests ? 'All ' + nWord(needTests, 'piece') + ' of changed information ' + (needTests === 1 ? 'has' : 'have') + ' tests for every rule' : 'Nothing this project changes needs tests') },
      status: statusById, phases, heldBy: Object.assign({}, tf.held) };
  }
  // R11 §1 THE testing truth: every testing number on every screen (Simple and Advanced Testing, the coverage matrix,
  // the launch gate, the Launch page per-team counts, the approver page, the status report, Home and the audit text).
  // = projectTruth(...).testing. See testFacts for the rules.
  function testingTruth(docs, prj, today) {
    const t = projectTruth(docs, prj, today || null);
    return t ? t.testing : null;
  }
  // R11 §1 the audit line for a recorded run, with the phase's own counts after the run (never a stale local total):
  // "Recorded the business check for Vendor Onboarding Modernization: 13 results (12 passed, 1 failed). Business
  // check now 21 of 26 passed."
  function runAuditText(docs, prj, run) {
    const project = projOf(docs, prj);
    if (!project || !run) return 'Recorded a test run';
    const withRun = Object.assign({}, docs, { testRun: ((docs && docs.testRun) || []).filter(d => d.id !== run.id).concat([{ id: run.id, data: run }]) });
    const tf = testFacts(withRun, project);
    const ph = stageOfEnv(run.env) || 'system';
    const st = tf.stages[ph];
    const res = (run.results || []).filter(x => x && x.outcome && x.outcome !== 'not-run' && x.outcome !== 'skipped');
    const cnt = o => res.filter(x => x.outcome === o).length;
    const parts = [cnt('pass') ? cnt('pass') + ' passed' : '', cnt('fail') ? cnt('fail') + ' failed' : '', cnt('blocked') ? cnt('blocked') + ' blocked' : ''].filter(Boolean);
    const label = ph === 'uat' ? 'the business check' : 'a try-it-out run';
    return 'Recorded ' + label + ' for ' + (project.name || 'the project') + ': ' + nWord(res.length, 'result') + (parts.length ? ' (' + parts.join(', ') + ')' : '') + '. ' +
      (ph === 'uat' ? 'Business check' : 'Try it out') + ' now ' + st.passed + ' of ' + nWord(st.total, 'test') + ' passed.';
  }

  // R7 "Steps to launch": the readiness checks as an ordered plain checklist.
  // [{key, label, done, who: [personId], action, next}] — `next` marks the first step not done.
  function launchSteps(docs, prj, today) {
    const t = projectTruth(docs, prj, today);
    return t ? t.launchSteps : [];
  }
  function launchStepsCore(docs, project, today, r, testing, approvals) {
    const ck = id => (r.checks || []).find(c => c.id === id) || { pass: !!r.released };
    const owner = project.owner || null;
    const lo = project.releaseManager || project.owner || null;
    const live = project.status === 'live' || !!r.released;
    const items = list(docs, 'workItem').filter(w => w.projectId === project.id);
    const people = personMap(docs);
    const uniq = a => [...new Set(a.filter(Boolean))];
    const steps = [];
    // 1. Plan the work
    const pv = ck('process-valid');
    const planned = live || items.length > 0;
    const noOwner = (pv.problems || []).length;
    steps.push({ key: 'plan', label: 'Plan the work', done: live || (planned && pv.pass), who: uniq([owner]),
      action: !planned ? 'Add the work or accept a suggested plan' : !pv.pass ? 'Fix ' + nWord(noOwner || 1, 'problem') + ' in the process map' + (noOwner ? ' (for example, a step with nobody doing it)' : '') : 'Done' });
    // 2. Finish the work
    const open = items.filter(w => w.status !== 'done');
    steps.push({ key: 'work', label: 'Finish the work', done: live || (planned && open.length === 0), who: uniq(open.map(w => w.owner)).slice(0, 5),
      action: !planned ? 'Plan the work first' : open.length ? nWord(open.length, 'task') + ' still open' : 'Done' });
    // 3. Information connected (data-live + discovered requirements)
    const dl = ck('data-live'), dr = ck('discovered-resolved');
    const notLive = uniq([].concat(dl.missing || [], dl.examples || [], dl.pending || [], dl.problems || []));
    const dataOwners = uniq(notLive.map(id => dataOwnerOf(docs, get(docs, 'dataElement', id))));
    const nDr = (dr.items || []).length;
    // R10 §6: before a plan exists nothing past "Plan the work" can read as done ("No plan yet")
    steps.push({ key: 'information', label: 'Information available', done: live || (planned && !!dl.pass && !!dr.pass), who: dataOwners.length ? dataOwners : (dl.pass && dr.pass ? [] : uniq([owner])),
      action: !planned && !live ? 'Plan the work first' : dl.pass && dr.pass ? 'Done' : [notLive.length ? nWord(notLive.length, 'piece') + ' of information ' + (notLive.length === 1 ? 'is' : 'are') + ' not available yet: ' + joinList(notLive.map(id => dataName(docs, id)), 3) : '',
        nDr ? nWord(nDr, 'new requirement') + ' found during the work ' + (nDr === 1 ? 'needs' : 'need') + ' a decision' : ''].filter(Boolean).join('; ') });
    // 4. Tests passed
    // R9 §6: the same sentence as projectTruth.testing.next (never "Create the tests").
    const ts = live ? { done: true, next: 'Done' } : !planned ? { done: false, next: 'Plan the work first' } : testing;
    steps.push({ key: 'tests', label: 'Tests passed', done: !!ts.done, who: ts.done ? [] : uniq([project.testLead || owner]), action: ts.done ? 'Done' : ts.next });
    // 5. Each team approved its part (bu-signoff + two-person)
    const bu = ck('bu-signoff'), tp = ck('two-person');
    const waiting = uniq([].concat(bu.unsigned || [], (bu.stale || []).map(x => x.bu)));
    const needs = bu.needsApprover || bu.noPerson || [];
    const elig = bu.eligible || {};
    const readyBu = b => { const a = (approvals || []).find(x => x.bu === b); return !a || a.ready !== false; };
    const apprWho = uniq(waiting.filter(readyBu).flatMap(b => elig[b] || Object.keys(people).filter(id => people[id] && people[id].bu === b && id !== owner && id !== lo)));
    const apprActs = [];
    // R11 §2: one sentence for the parts whose own people can't approve them (they do its steps or recorded its tests)
    const sodParts = (bu.sectionStatus || []).filter(x => x.needsApprover && x.sodBlockedBy);
    if (sodParts.length === 1) apprActs.push(((sodParts[0].barred || [])[0] || {}).text || nameOf(docs, sodParts[0].sodBlockedBy) + ' recorded these tests, so someone else must approve');
    else if (sodParts.length > 1) apprActs.push('In ' + joinList(sodParts.map(x => x.bu)) + ', the only possible approvers carry out the steps or recorded the tests themselves, so someone else must approve each part');
    if (needs.length) apprActs.push('Choose who approves ' + (needs.length === 1 ? needs[0] + "'s part" : 'the ' + joinList(needs) + ' parts'));
    // R10 §6: nobody is asked to approve before their part's work is done
    const readyOf = b => { const a = (approvals || []).find(x => x.bu === b); return !a || a.ready !== false; };
    const unsignedReady = (bu.unsigned || []).filter(readyOf), unsignedWaiting = (bu.unsigned || []).filter(b => !readyOf(b));
    if (unsignedReady.length) apprActs.push('Waiting for ' + joinList(unsignedReady) + ' to approve ' + (unsignedReady.length === 1 ? 'its' : 'their') + ' part');
    if (unsignedWaiting.length) apprActs.push(joinList(unsignedWaiting) + (unsignedWaiting.length === 1 ? ' approves its part' : ' approve their parts') + ' once the work on ' + (unsignedWaiting.length === 1 ? 'it is' : 'them is') + ' done');
    if ((bu.stale || []).length) apprActs.push(joinList(bu.stale.map(x => x.bu)) + ' must approve again after changes');
    if (!apprActs.length && !tp.pass) apprActs.push('Two different people need to approve');
    steps.push({ key: 'approvals', label: 'Each team approved its part', done: live || (planned && !!bu.pass && !!tp.pass), who: (bu.pass && tp.pass) ? [] : (needs.length ? uniq([owner]).concat(apprWho) : apprWho),
      action: !planned && !live ? 'Plan the work first' : (bu.pass && tp.pass) ? 'Done' : apprActs.map(x => x.replace(/\.$/, '')).join('. ') + '.' });
    // 6. Launch-day plan ready (cutover-plan)
    const co = ck('cutover-plan');
    steps.push({ key: 'launch-plan', label: 'Launch-day plan ready', done: live || (planned && !!co.pass), who: co.pass ? [] : uniq([lo]),
      action: co.pass ? 'Done' : 'Finish the launch-day plan: who undoes it if needed, how, who supports after launch, and the launch-day tasks' });
    // 7. Launch (also needs temporary data access closed)
    const gc = ck('grants-closed');
    const blockers = steps.filter(s => !s.done).length;
    steps.push({ key: 'launch', label: 'Launch', done: live, who: live ? [] : uniq([lo]),
      action: live ? 'Launched' : !gc.pass ? 'Approve or decline the ' + nWord((gc.blocking || []).length || 1, 'access request') + ' waiting for approval' : blockers ? 'Waiting for the steps above' : 'Ready: give the final yes and launch' });
    const first = steps.find(s => !s.done);
    steps.forEach(s => { s.next = s === first; });
    return steps;
  }

  // R8 burndown direction at today (remaining vs ideal) beside the SPI direction. When they disagree the burndown
  // shows only on Sprints (sprintsOnly), so no page shows "ahead" next to "behind".
  function burndownStatus(docs, projectId, today, ev) {
    const pts = burndown(docs, projectId, today).filter(p => p.remaining != null);
    const last = pts[pts.length - 1] || null;
    const direction = !last ? null : last.remaining <= last.ideal + 1e-9 ? 'on-track' : 'behind';
    const spi = ev ? ev.SPI : earnedValue(docs, projectId, today).SPI;
    const spiDirection = spi == null ? null : spi >= 1 ? 'on-track' : 'behind';
    const agree = direction == null || spiDirection == null || direction === spiDirection;
    return { direction, spiDirection, agree, sprintsOnly: !agree, remaining: last ? last.remaining : null, ideal: last ? last.ideal : null };
  }

  // R8 latest real outcome per test across every stage (same counting rules as the gate).
  function latestAnyStage(docs, projectId) {
    const m = {};
    list(docs, 'testRun').filter(r => r.projectId === projectId && stageOfEnv(r.env))
      .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
      .forEach(r => (r.results || []).forEach(x => {
        const k = x && (x.caseId || x.scriptId); if (!k || x.outcome === 'not-run' || x.outcome === 'skipped') return;
        if (x.scriptId && x.outcome === 'pass' && r.source !== 'ci' && !String(x.evidence || '').trim()) return;
        m[k] = x.outcome;
      }));
    return m;
  }
  // R8 what one team (section) owns: its new/changed Future steps, the information they use, the tests on that
  // information (only information the project changes) and the UAT scripts of its steps, and its launch-day tasks.
  function sectionScope(docs, project, bu) {
    const people = personMap(docs);
    const { stepBus } = sectionHelpers(people);
    const steps = [], stepKeys = new Set();
    linkedProcesses(docs, project).forEach(p => {
      const diff = diffProcess(p);
      flatSteps(p.tobe).forEach(st => {
        if ((diff.nodes[st.id] === 'new' || diff.nodes[st.id] === 'changed') && stepBus(st).includes(bu)) { steps.push({ pid: p.id, s: st }); stepKeys.add(p.id + '/' + st.id); }
      });
    });
    const dataIds = [...new Set(steps.flatMap(x => stepData(x.s)))];
    const changed = new Set(changedInformation(docs, project).map(x => x.dataId));
    const caseIds = list(docs, 'testCase').filter(c => changed.has(c.dataId) && dataIds.includes(c.dataId)).map(c => c.id);
    const scripts = (Array.isArray(project.uatScripts) ? project.uatScripts : generateUatScripts(docs, project.id)).filter(sc => {
      if (!sc) return false;
      if (stepKeys.has(sc.pid + '/' + sc.step)) return true;
      const p = get(docs, 'process', sc.pid);
      const g = p && flatGateways(p.tobe).find(x => x.id === sc.step);
      return !!g && flatSteps((g.branches || []).flatMap(b => (b && b.nodes) || [])).some(x => stepKeys.has(sc.pid + '/' + x.id));
    }).map(sc => sc.id);
    const tasks = (project.cutover && Array.isArray(project.cutover.tasks) ? project.cutover.tasks.filter(Boolean) : []).filter(t => taskBu(people, t) === bu);
    const work = list(docs, 'workItem').filter(w => w.projectId === project.id && stepKeys.has(w.pid + '/' + w.step));
    return { steps, dataIds, caseIds, scriptIds: scripts, tasks, work };
  }
  // R8 "Approve my part" appears only when that team's own items are complete: the work on its changed steps is done,
  // the information those steps use is available, and its tests passed. {bu, ready, waiting:[{kind, text}], sentence}.
  function buReady(docs, prj, bu) {
    const project = projOf(docs, prj);
    if (!project) return { bu, needed: false, ready: false, waiting: [], sentence: 'This project could not be found.' };
    // R9 §13: a team whose part did not change does not approve, and is never a gate condition.
    const needed = sectionBus(docs, project, personMap(docs)).includes(bu);
    if (!needed) return { bu, needed, ready: false, waiting: [], waitingOn: 0, steps: 0, tests: { passed: 0, total: 0 }, sentence: bu + "'s part did not change, so it doesn't need to approve anything." };
    const sc = sectionScope(docs, project, bu);
    const work = list(docs, 'workItem'), ctx = availCtx(docs);
    const waiting = [];
    const open = sc.work.filter(w => w.status !== 'done');
    if (open.length) waiting.push({ kind: 'work', count: open.length, items: open.map(w => w.id), text: nWord(open.length, 'task') + ' on ' + (open.length === 1 ? 'its step' : 'its steps') });
    const notYet = sc.dataIds.filter(id => availOf(get(docs, 'dataElement', id), work, docs, ctx) !== 'live');
    if (notYet.length) waiting.push({ kind: 'information', count: notYet.length, items: notYet, text: joinList(notYet.map(id => dataName(docs, id)), 3) });
    const pt = partTests(docs, project, bu, sc);
    const notPassed = pt.ids.filter(id => pt.status[id] !== 'passed');
    if (notPassed.length) waiting.push({ kind: 'tests', count: notPassed.length, items: notPassed, text: nWord(notPassed.length, 'test') + ' to pass' });
    if (pt.gaps.length) waiting.push({ kind: 'coverage', count: pt.gaps.length, items: pt.gaps.map(g => g.dataId), text: joinList(pt.gaps.map(g => g.name), 3) + ' to get tests' });
    const ready = !waiting.length;
    return { bu, needed, ready, waiting, waitingOn: waiting.reduce((a, x) => a + x.count, 0), steps: sc.steps.length, tests: { passed: pt.passed, total: pt.ids.length, gaps: pt.gaps.length, checks: pt.checks, text: pt.text },
      sentence: ready ? 'Ready for your approval.' : 'Not ready for your approval yet: waiting on ' + joinList(waiting.map(x => x.text)) + '.' };
  }
  // R8 prefilled "What you checked", built from facts, never boilerplate.
  // {text: "3 changed steps reviewed; 12 of 12 tests passed", facts: {...}}
  function approvalNoteFacts(docs, prj, bu) {
    const project = projOf(docs, prj);
    if (!project) return { text: '', facts: {} };
    const sc = sectionScope(docs, project, bu);
    const work = list(docs, 'workItem'), ctx = availCtx(docs);
    const pt = partTests(docs, project, bu, sc);
    const tests = pt.ids, passed = pt.passed;
    const have = sc.dataIds.filter(id => availOf(get(docs, 'dataElement', id), work, docs, ctx) === 'live').length;
    const facts = { changedSteps: sc.steps.length, tests: { passed, total: tests.length, gaps: pt.gaps.length, checks: pt.checks, text: pt.text, notChanged: pt.notChanged.map(x => x.name) }, information: { have, total: sc.dataIds.length },
      tasks: { done: sc.work.filter(w => w.status === 'done').length, total: sc.work.length }, launchTasks: sc.tasks.length };
    const parts = [];
    if (facts.changedSteps) parts.push(nWord(facts.changedSteps, 'changed step') + ' reviewed');
    if (facts.tasks.total) parts.push(facts.tasks.done + ' of ' + nWord(facts.tasks.total, 'task') + ' done');
    if (tests.length || pt.gaps.length) parts.push(pt.text);
    if (facts.information.total) parts.push(have + ' of ' + nWord(facts.information.total, 'piece') + ' of information available');
    if (facts.launchTasks) parts.push(nWord(facts.launchTasks, 'launch-day task') + ' reviewed');
    return { text: capFirst(parts.join('; ')), facts };
  }
  // R8 cross-project conflict: another active project (not live/closed) has work on the same step.
  // {conflict, projects: [{id, name}], text: "Another project is also changing this step"}.
  function stepConflict(docs, projectId, pid, stepId) {
    const projs = byId(list(docs, 'project'));
    const others = [...new Set(list(docs, 'workItem').filter(w => w.projectId !== projectId && w.pid === pid && w.step === stepId).map(w => w.projectId))]
      .filter(id => projs[id] && projs[id].status !== 'live' && projs[id].status !== 'closed');
    return { conflict: others.length > 0, projects: others.map(id => ({ id, name: projs[id].name || 'another project' })),
      text: others.length ? (others.length === 1 ? 'Another project is' : 'Other projects are') + ' also changing this step' : '' };
  }
  function projectConflicts(docs, projectId) {
    const seen = new Set(), out = [];
    list(docs, 'workItem').filter(w => w.projectId === projectId && w.pid && w.step).forEach(w => {
      const k = w.pid + '/' + w.step; if (seen.has(k)) return; seen.add(k);
      const c = stepConflict(docs, projectId, w.pid, w.step);
      if (c.conflict) out.push(Object.assign({ pid: w.pid, step: w.step }, c));
    });
    return out;
  }

  // R9 §6 per-team test counts: only the tests on the information and steps that team owns (sectionScope).
  function testsPerBU(docs, project, sections) {
    const res = {}, tf = testFacts(docs, project);
    sections.forEach(bu => {
      const pt = partTests(docs, project, bu, null, tf);
      const c = o => pt.ids.filter(id => pt.status[id] === o).length;
      const failed = c('failed') + c('fix');
      res[bu] = { total: pt.ids.length, passed: pt.passed, failed, blocked: c('blocked'), notRun: pt.ids.length - pt.passed - failed,
        gaps: pt.gaps.map(g => Object.assign({}, g)), gapCount: pt.gaps.length, checks: pt.checks, text: pt.text, notChanged: pt.notChanged.map(x => x.name), notChangedText: pt.notChangedText };
    });
    return res;
  }
  // R11 §1 one team's tests and coverage: "N of M" counts tests AND coverage gaps (a piece of changed information with
  // no tests, or a rule field with no test), and says so plainly. Information the part uses that the project does
  // not change needs no tests and is named (notChangedText), never counted.
  function partTests(docs, project, bu, sc, tf) {
    sc = sc || sectionScope(docs, project, bu);
    tf = tf || testFacts(docs, project);
    const ids = sc.caseIds.concat(sc.scriptIds);
    const status = tf.status;
    const passed = ids.filter(id => status[id] === 'passed').length;
    const gaps = tf.coverage.elements.filter(e => !e.covered && sc.dataIds.includes(e.dataId)).map(e => ({ dataId: e.dataId, name: e.name, state: e.state, fields: e.uncoveredFields.slice() }));
    const notChanged = tf.coverage.notChanged.filter(x => sc.dataIds.includes(x.dataId));
    const checks = ids.length + gaps.length;
    const gapText = gaps.length ? nWord(gaps.length, 'piece') + ' of information ' + (gaps.length === 1 ? 'has' : 'have') + ' no tests yet (' + joinList(gaps.map(g => g.name + (g.state === 'fields-missing' ? ': ' + joinList(g.fields, 3) : '')), 3) + ')' : '';
    const text = !gaps.length ? passed + ' of ' + nWord(ids.length, 'test') + ' passed'
      : passed + ' of ' + checks + ' checks done: ' + passed + ' of ' + nWord(ids.length, 'test') + ' passed, and ' + gapText;
    const notChangedText = notChanged.length ? 'Not tested because this project does not change ' + (notChanged.length === 1 ? 'it' : 'them') + ': ' + joinList(notChanged.map(x => x.name), 4) + '.' : '';
    return { ids, status, passed, gaps, checks, text, notChanged, notChangedText };
  }
  // R9 §13 the one approvals list the launch gate and the approver pages read.
  // [{bu, needed, ready, approved, stale, approver, eligible, suggestion, blockedBy: null|{rule, person, text, fix}, waiting, waitingOn, sentence}]
  // After launch: every team that approved (from the release record, else the approval docs).
  function approvalsOf(docs, project, r) {
    const bu = (r.checks || []).find(x => x.id === 'bu-signoff') || {};
    if (r.released) {
      const fromCheck = (bu.sectionStatus || []).filter(x => x.approved);
      const rows = fromCheck.length ? fromCheck.map(x => ({ bu: x.bu, approver: x.approver || null }))
        : [...new Set(list(docs, 'approval').filter(a => a.projectId === project.id && a.bu && !a.kind).map(a => a.bu))].sort().map(b => {
          const l = latestBy(list(docs, 'approval').filter(a => a.projectId === project.id && a.bu === b), 'at');
          return l && l.decision === 'approved' ? { bu: b, approver: l.approver || null } : null;
        }).filter(Boolean);
      return rows.map(x => ({ bu: x.bu, needed: true, ready: true, approved: true, stale: false, approver: x.approver, approverName: x.approver ? nameOf(docs, x.approver) : null,
        eligible: [], suggestion: null, blockedBy: null, waiting: [], waitingOn: 0, sentence: 'Approved' + (x.approver ? ' by ' + nameOf(docs, x.approver) : '') + '.' }));
    }
    return (bu.sectionStatus || []).map(x => {
      const br = buReady(docs, project, x.bu);
      const approved = !!x.approved && !x.stale;
      const approver = approved ? x.approver : (x.override && x.eligible.includes(x.override) ? x.override : x.eligible[0] || null);
      let blockedBy = null;
      if (!approved && x.needsApprover) {
        const fix = 'Choose who approves ' + x.bu + "'s part";
        const bar = (x.barred || [])[0];
        blockedBy = x.sodBlockedBy
          ? { rule: 'separation-of-duties', reason: bar ? bar.rule : 'recorded-tests', person: x.sodBlockedBy, people: (x.barred || []).map(b => b.person),
            text: (x.barred || []).map(b => b.text).join(' ') || nameOf(docs, x.sodBlockedBy) + ' recorded these tests, so someone else must approve.', fix, suggestion: x.suggestion || null }
          : { rule: 'no-approver', person: null, text: 'Nobody in ' + x.bu + ' can approve this part yet.', fix, suggestion: x.suggestion || null };
      }
      const stx = x.stale ? ((bu.stale || []).find(y => y.bu === x.bu) || {}).text : null;
      const sentence = approved ? 'Approved by ' + nameOf(docs, x.approver) + '.' : x.stale ? (stx ? 'Changed after approval: ' + stx : 'Changed after approval: ' + x.bu + ' must approve again.')
        : blockedBy ? blockedBy.text + ' ' + blockedBy.fix + '.' : br.sentence;
      return { bu: x.bu, needed: true, ready: br.ready, approved, stale: !!x.stale, approver, approverName: approver ? nameOf(docs, approver) : null, eligible: x.eligible.slice(),
        suggestion: x.suggestion || null, blockedBy, waiting: br.waiting, waitingOn: br.waitingOn || 0, sentence };
    });
  }

  // R8 ONE TRUTH: every number, date and label a page, report, CSV, dashboard or portfolio shows for a project.
  // R9: one late list, the ranked `who`, stepsLeft, testing (one count + perBU + next), approvals, EV/SPI note.
  // projectSummary, testingSummary and launchSteps return parts of this object. Dates are YYYY-MM-DD; bufferDays,
  // lateness and "days behind" are business days.
  function projectTruth(docs, prj, today) {
    const project = projOf(docs, prj);
    if (!project) return null;
    const c = scheduleCore(docs, project, today);
    const r = readiness(docs, project.id, today);
    const testing = testingCore(docs, project, r);
    const buCk = (r.checks || []).find(x => x.id === 'bu-signoff') || {};
    if (!r.released) testing.perBU = testsPerBU(docs, project, buCk.sections || []);
    const approvals = approvalsOf(docs, project, r);
    const launch = launchStepsCore(docs, project, today, r, testing, approvals);
    const who = whoOf(docs, project, c, { approvals, testing });
    const sentence = sentenceOf(docs, project, c, who);
    const ev = earnedValue(docs, project.id, today);
    const planned = project.budget && project.budget.planned != null && isFinite(+project.budget.planned) ? +project.budget.planned : null;
    const cost = costOf(project, planned, ev);
    const hasRates = planned != null || personList(docs).some(p => p.dayRate != null && isFinite(+p.dayRate));
    // R9 §5 Advanced-only note: the label stays driven by §1.
    const advancedNote = ev.SPI != null && ev.SPI < 0.95 && c.rag === 'green' ? 'Behind plan on effort (SPI ' + ev.SPI.toFixed(2) + ')' : null;
    return {
      projectId: project.id, name: project.name || '', today: today || null,
      tasks: { total: c.items.length, done: c.items.length - c.open.length, open: c.open.length },
      pctDone: ev.pct, behindEffort: c.behindEffort,
      // R10 §6: no work yet and not live: every screen says "No plan yet" instead of a step count
      noPlan: !c.items.length && !r.released && project.status !== 'live',
      launch: launchDate(docs, project),
      lateText: lateText({ lateCount: c.late.length, pastDueCount: c.pastDue.length, finishAfterDueCount: c.finishAfterDue.length }),
      forecastFinish: c.finish, actualFinish: c.allDone ? c.finish : null, target: c.target, deadline: c.target,
      bufferDays: c.bufferDays, bufferUnit: 'business days',
      late: c.late.slice(), lateCount: c.late.length,
      pastDue: c.pastDue.slice(), pastDueCount: c.pastDue.length, finishAfterDue: c.finishAfterDue.slice(), finishAfterDueCount: c.finishAfterDue.length,
      runningLate: c.finishAfterDue.slice(), runningLateCount: c.finishAfterDue.length,   // deprecated (R8): use finishAfterDue
      blockers: c.blockers, unplannedBlockers: c.blockers.filter(b => !b.planned).length,
      rag: c.rag, label: c.label, labelAdvanced: c.labelAdvanced, advancedNote, sentence, who, reasons: c.reasons.slice(),
      status: { rag: c.rag, label: c.label, labelAdvanced: c.labelAdvanced, advancedNote, sentence, reasons: c.reasons.slice(), who },
      launchSteps: launch, stepsLeft: launch.filter(s => !s.done).length, testing, approvals,
      cost: { planned, estimate: cost.estimate, actual: cost.actualCost, forecast: cost.forecastCost, remaining: cost.remainingCost, variance: cost.variance, overBudget: cost.overBudget, show: hasRates,
        method: ev.eacMethod || null },
      ev, evFlags: (ev.flags || []).slice(), burndown: burndownStatus(docs, project.id, today, ev),
      // R11 §5 one blocking definition, one lateness per task
      blocking: blockingOf(docs, project, c.blockers),
      lateness: Object.fromEntries(c.open.filter(w => c.fc[w.id] && c.fc[w.id].late).map(w => [w.id, lateInfo(docs, w, today, c.fc)])),
      // R11 §3 launch day on a day off (Launch, Dashboard, status), access counts
      launchFlag: c.launchFlag || null, grants: grantCounts(docs, project, today),
    };
  }

  // R9 §2 one personal queue: every open item for one person, across active projects, in `who` rank order.
  // Work items (late, or due within 10 business days), fix tasks, problems, practice reviews (kind 'test'),
  // confirmations, approvals that are ready, tests assigned to them, and every `who` entry naming them.
  // [{kind, projectId, id, title, due, late, href, oneTap, why, rank, what}]; Home's badge = list.length.
  const QUEUE_DAYS = 10;
  function personQueue(docs, person, today) {
    if (!person) return [];
    const out = [], seen = new Set();
    const pname = id => { const p = get(docs, 'project', id); return p ? p.name || '' : ''; };
    const add = it => {
      const k = it.kind === 'information' || it.kind === 'confirm' ? it.kind + ':' + it.id : it.kind + ':' + it.projectId + ':' + it.id;
      if (seen.has(k)) return; seen.add(k); it.projectName = pname(it.projectId); out.push(it);
    };
    const fc = forecastAll(docs, today);
    const projects = list(docs, 'project').filter(p => p.status !== 'live' && p.status !== 'closed');
    const kindOf = w => w.kind === 'defect' ? 'problem' : w.kind === 'test' ? 'practice' : w.resolves ? 'fix' : 'work';
    projects.forEach(project => {
      const t = projectTruth(docs, project, today);
      const whoRank = {};
      t.who.forEach(x => { if (x.ref && !(x.ref in whoRank)) whoRank[x.ref] = x; });
      list(docs, 'workItem').filter(w => w.projectId === project.id && w.owner === person && w.status !== 'done').forEach(w => {
        const r = fc[w.id] || {};
        const kind = kindOf(w);
        const soon = isDate(w.due) && isDate(today) && businessDaysBetween(today, addBusinessDays(w.due, 0)) <= QUEUE_DAYS;
        if (!(r.late || soon || kind !== 'work')) return;
        const wx = whoRank['work:' + w.id];
        add({ kind, projectId: project.id, id: w.id, title: kind === 'problem' ? problemTitle(w) : w.title || 'Untitled task', due: w.due || null, late: !!r.late, href: taskHref(project, w),
          oneTap: { action: 'done', label: kind === 'problem' ? 'Mark fixed' : 'Mark done' }, why: wx ? wx.why : r.late ? 'late' : 'work',
          rank: wx ? wx.rank : r.late ? WHO_RANK.late : kind === 'problem' ? WHO_RANK.problem : 70,
          what: wx ? wx.what : (kind === 'problem' ? 'Fix the problem: ' : 'Finish ') + q(w.title) });
      });
      t.approvals.filter(a => a.needed && a.ready && !a.approved && !a.blockedBy && a.approver === person).forEach(a =>
        add({ kind: 'approval', projectId: project.id, id: a.bu, title: 'Approve ' + a.bu + "'s part", due: null, late: false, href: '/release/' + project.id + '?bu=' + encodeURIComponent(a.bu),
          oneTap: null, why: 'approval', rank: WHO_RANK.approval, what: 'Approve ' + a.bu + "'s part" }));
      const outc = latestAnyStage(docs, project.id);
      list(docs, 'testCase').filter(c => c.assignee === person && outc[c.id] !== 'pass' && changedInformation(docs, project).some(x => x.dataId === c.dataId)).forEach(c =>
        add({ kind: 'test', projectId: project.id, id: c.id, title: 'Run the test for ' + dataName(docs, c.dataId) + (c.field ? ' · ' + c.field : ''), due: null, late: false,
          href: '/testing/' + project.id, oneTap: null, why: 'test', rank: WHO_RANK.test, what: 'Run the test for ' + dataName(docs, c.dataId) }));
      (Array.isArray(project.uatScripts) ? project.uatScripts : []).filter(sc => sc && sc.assignee === person && outc[sc.id] !== 'pass').forEach(sc =>
        add({ kind: 'test', projectId: project.id, id: sc.id, title: 'Business check: ' + (sc.title || 'untitled'), due: null, late: false,
          href: '/testing/' + project.id, oneTap: null, why: 'test', rank: WHO_RANK.test, what: 'Run the business check ' + q(sc.title) }));
      t.who.filter(x => x.person === person).forEach(x => {
        const id = x.ref ? x.ref.slice(x.ref.indexOf(':') + 1) : x.what;
        const kind = x.why === 'approval' ? 'approval' : x.why === 'test' ? 'test' : x.why === 'blocker' || x.why === 'info' ? 'information' : x.why === 'problem' ? 'problem' : x.ref && x.ref.startsWith('work:') ? 'work' : 'action';
        if (x.ref && x.ref.startsWith('work:') && seen.has(['work', 'fix', 'problem', 'practice'].map(k => k + ':' + project.id + ':' + id).find(k => seen.has(k)))) return;
        if (kind === 'approval' && seen.has('approval:' + project.id + ':' + id)) return;
        const w = x.ref && x.ref.startsWith('work:') ? get(docs, 'workItem', id) : null;
        if (kind === 'information') {
          // the fix task is already listed: it carries this rank (one item, never two)
          const b = t.blockers.find(bb => bb.dataId === id), fx = b && b.resolver && out.find(o => o.id === b.resolver);
          if (fx) { if (x.rank < fx.rank) { fx.rank = x.rank; fx.why = x.why; } return; }
        }
        add({ kind, projectId: project.id, id, title: x.what, due: w ? w.due || null : null, late: !!(w && fc[w.id] && fc[w.id].late), href: x.href, oneTap: null, why: x.why, rank: x.rank, what: x.what });
      });
    });
    // confirmations: information waiting for this owner's one-tap confirmation
    awaitingConfirmation(docs, person).forEach(did => {
      const pr = projects.find(p => linkedProcesses(docs, p).some(pp => flatSteps(pp.tobe).some(st => stepData(st).includes(did))));
      add({ kind: 'confirm', projectId: pr ? pr.id : null, id: did, title: 'Confirm ' + dataName(docs, did) + ' is available', due: null, late: false, href: '/data/' + did,
        oneTap: { action: 'confirm', label: 'Confirm' }, why: 'info', rank: WHO_RANK.info, what: 'Confirm ' + dataName(docs, did) + ' is available' });
    });
    // R10.2: plan changes waiting for this person's decision (same output as PMOChange.queueFor)
    list(docs, 'planChange').filter(c => c.status === 'proposed' && (c.approvers || []).some(a => a.person === person && !a.decision)).forEach(c =>
      add({ kind: 'planChange', projectId: c.projectId, id: c.id, title: 'Approve the plan change “' + c.title + '”', due: null, late: false,
        href: '/project/' + c.projectId + '/changes?change=' + encodeURIComponent(c.id), oneTap: null, why: 'approval', rank: WHO_RANK.approval, what: 'Approve the plan change “' + c.title + '”' }));
    return out.sort((a, b) => a.rank - b.rank || (b.late - a.late) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.title).localeCompare(String(b.title)));
  }

  // R9 §13 real dependencies only: the open tasks a task actually waits on (its dependency edges and the open fix
  // task for information its step needs). Never tasks that merely run in parallel. [{id, title, owner, kind}]
  function waitingOn(docs, workId) {
    const w = get(docs, 'workItem', workId);
    if (!w || w.status === 'done') return [];
    const idx = byId(list(docs, 'workItem'));
    const out = [];
    depIds(w).forEach(id => { const d = idx[id]; if (d && d.status !== 'done') out.push({ id, title: d.title || 'untitled task', owner: d.owner || null, kind: 'dependency' }); });
    const st = findStep(docs, w.pid, w.step), ctx = availCtx(docs), work = list(docs, 'workItem');
    (st ? stepData(st) : []).forEach(did => {
      const state = availOf(get(docs, 'dataElement', did), work, docs, ctx);
      if (state !== 'missing' && state !== 'example' && state !== 'unchecked') return;
      const r = work.find(x => x.resolves === did && x.status !== 'done' && x.id !== w.id);
      if (r && !out.some(o => o.id === r.id)) out.push({ id: r.id, title: r.title || 'untitled task', owner: r.owner || null, kind: 'information', dataId: did });
    });
    return out;
  }
  // R9 §13 history values: person ids read as names, empty as "Nobody", information ids as names; else unchanged.
  function displayValue(docs, value) {
    if (value == null || value === '' || value === '(none)') return 'Nobody';
    if (Array.isArray(value)) return value.length ? value.map(v => displayValue(docs, v)).join(', ') : 'Nobody';
    const s0 = String(value), people = personMap(docs);
    if (people[s0]) return people[s0].name || 'someone';
    const d = get(docs, 'dataElement', s0);
    return d ? d.name || 'some information' : s0;
  }
  // R9 §3 calendar helpers: business-day checks and "Mon Nov 16".
  function isBusinessDay(d, docs) { if (docs) syncCalendar(docs); return isDate(d) && !offMs(toMs(d)); }
  function toBusinessDay(d) { return isDate(d) ? addBusinessDays(String(d).slice(0, 10), 0) : d; }
  function fmtDayLong(d) { const ms = toMs(d); return isNaN(ms) ? String(d || '') : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(ms)] + ' ' + fmtDay(d); }

  /* ------------------------------------------------------------------ */
  /* R10.1 stream R: the status report with a time window                */
  /* ------------------------------------------------------------------ */
  // Presets: this-week | last-week | last-2-weeks | this-month | since-last-report | whole-project | custom.
  // Weeks run Monday–Friday; a window starts on its first business day and ends on its last (holidays skipped),
  // never after `today`, never before the project started. Dates are inclusive YYYY-MM-DD.
  const PERIOD_PRESETS = ['this-week', 'last-week', 'last-2-weeks', 'this-month', 'since-last-report', 'whole-project', 'custom'];
  const PERIOD_LABEL = { 'this-week': 'This week', 'last-week': 'Last week', 'last-2-weeks': 'Last 2 weeks', 'this-month': 'This month',
    'since-last-report': 'Since last report', 'whole-project': 'Whole project', custom: 'Custom' };
  const PERIOD_NOUN = { 'this-week': 'this week', 'last-week': 'last week', 'last-2-weeks': 'in the last 2 weeks', 'this-month': 'this month',
    'since-last-report': 'since the last report', 'whole-project': 'so far', custom: 'in this period' };
  // A date or timestamp as a day. Plain days are kept; ISO timestamps use their UTC date.
  function dayOfValue(v) { if (v == null || v === '') return null; const s = String(v); return isDate(s) ? s.slice(0, 10) : null; }
  function firstBizFrom(d) { return addBusinessDays(d, 0); }
  function lastBizOnOrBefore(d) { let ms = toMs(d); for (let g = 0; offMs(ms) && g < 400; g++) ms -= DAY; return iso(ms); }
  function projectStart(docs, project) {
    const items = list(docs, 'workItem').filter(w => w.projectId === project.id);
    return minDate([project.start, dayOfValue(project.createdAt)].concat((project.baselines || []).map(b => dayOfValue(b && b.at)),
      items.map(w => w.start), items.map(w => dayOfValue(w.createdAt))));
  }
  function lastReportDay(project, today) {
    const log = (Array.isArray(project.reportLog) ? project.reportLog : []).map(r => dayOfValue(r && r.date)).filter(Boolean);
    const all = log.concat([dayOfValue(project.lastReportAt)]).filter(d => d && d < today).sort();
    return all.length ? all[all.length - 1] : null;
  }
  // {preset, from, to, label, short, noun, partial, note, weekEnd}
  function periodWindow(docs, prj, range, today) {
    const project = projOf(docs, prj);
    range = range || {};
    if (!isDate(today)) today = range.to || null;
    let preset = PERIOD_PRESETS.includes(range.preset) ? range.preset : (range.from || range.to ? 'custom' : 'this-week');
    const td = String(today).slice(0, 10);
    let from, to = td, label = null, note = null, weekEnd = null;
    const week = (d, label0) => {
      const mon = mondayOf(d), fri = addDays(mon, 4);
      let f = firstBizFrom(mon); if (f > fri) f = mon;
      let e = lastBizOnOrBefore(fri); if (e < f) e = fri;
      weekEnd = e;
      return { from: f, to: e < td ? e : td, label: label0 + fmtDayLong(f) + ' – ' + fmtDayLong(e) };
    };
    if (preset === 'since-last-report') {
      const last = project ? lastReportDay(project, td) : null;
      if (last) { from = firstBizFrom(addDays(last, 1)); if (from > td) from = td; note = 'Since the last report on ' + fmtDayLong(last) + '.'; }
      else { preset = 'this-week'; note = 'No earlier report yet, so this shows this week.'; }
    }
    if (preset === 'this-week') { const w = week(td, 'Week of '); from = w.from; to = w.to; label = w.label; }
    else if (preset === 'last-week') { const w = week(addDays(mondayOf(td), -7), 'Week of '); from = w.from; to = w.to; label = w.label; }
    else if (preset === 'last-2-weeks') from = firstBizFrom(addDays(mondayOf(td), -7));
    else if (preset === 'this-month') from = firstBizFrom(td.slice(0, 8) + '01');
    else if (preset === 'whole-project') from = project ? projectStart(docs, project) || td : td;
    else if (preset === 'custom') {
      to = isDate(range.to) ? String(range.to).slice(0, 10) : td;
      if (to > td) to = td;
      from = isDate(range.from) ? String(range.from).slice(0, 10) : mondayOf(to);
    }
    if (from > to) { const x = from; from = to; to = x; if (to > td) to = td; }
    const start = project ? projectStart(docs, project) : null;
    let clamped = false;
    if (start && from < start && start <= to) { from = start; clamped = true; if (label) label = fmtDayLong(from) + ' – ' + fmtDayLong(weekEnd || to); }
    if (!label) label = from === to ? fmtDayLong(from) : fmtDayLong(from) + ' – ' + fmtDayLong(to);
    const partial = !!(weekEnd && to < weekEnd);
    const short = /^Week of /.test(label) ? 'week of ' + fmtDay(from) : from === to ? fmtDay(from) : fmtDay(from) + ' – ' + fmtDay(to);
    return { preset, presetLabel: PERIOD_LABEL[preset], from, to, label, short, noun: PERIOD_NOUN[preset], partial, weekEnd, clamped, note,
      days: businessDaysBetween(addDays(from, -1), to) };
  }
  // The same docs as they stood at the end of day `to`: tasks created later are left out, tasks finished later
  // are open again (in progress when they had started by then), and hours logged later are dropped.
  function docsAsOf(docs, projectId, to, facts) {
    const items = (docs.workItem || []).map(e => {
      const w = e && (e.data || e); if (!w || w.projectId !== projectId) return e;
      const f = facts(w);
      if (f.created && f.created > to) return null;
      const d = Object.assign({}, w);
      if (d.status === 'done' && f.done && f.done > to) { d.status = f.started && f.started <= to ? 'prog' : 'idle'; delete d.doneAt; }
      if (Array.isArray(d.time)) d.time = d.time.filter(t => !(t && dayOfValue(t.date) && dayOfValue(t.date) > to));
      return { id: e.id, data: d };
    }).filter(Boolean);
    return Object.assign({}, docs, { workItem: items });
  }
  // periodReport(docs, projectId, {from, to, preset}, today, {events}) -> what happened in the window plus the
  // overall status as of today (projectTruth). Every fact is dated: a task's createdAt/assignedAt/startedAt/doneAt,
  // logged hours, test runs, approvals, risks (openedAt/closedAt), information (unavailableSince/liveConfirmedAt),
  // plan changes and the project's forecastLog snapshots. A fact without a date falls back to the history events
  // passed in opts.events ({at, ref, action}); otherwise it is left out (never guessed).
  function periodReport(docs, prj, range, today, opts) {
    const project = projOf(docs, prj);
    if (!project) return null;
    opts = opts || {};
    const win = periodWindow(docs, project, range, today);
    const { from, to } = win;
    const within = d => !!d && d >= from && d <= to;
    const t = projectTruth(docs, project, today);
    const people = personMap(docs);
    const pn = id => (id && people[id] && people[id].name) || (id ? 'someone' : 'Nobody');
    // history events: earliest "create" per ref
    const created = {};
    (Array.isArray(opts.events) ? opts.events : []).forEach(e => {
      if (!e || typeof e.ref !== 'string' || e.action !== 'create') return;
      const d = dayOfValue(e.at); if (!d) return;
      if (!created[e.ref] || d < created[e.ref]) created[e.ref] = d;
    });
    const runs = list(docs, 'testRun').filter(r => r.projectId === project.id);
    const runDay = id => { const r = runs.find(x => x.id === id); return r ? dayOfValue(r.at) : null; };
    const factsOf = w => {
      const c = dayOfValue(w.createdAt) || created['workItem:' + w.id] || (w.kind === 'defect' && w.testRef ? runDay(w.testRef.runId) : null);
      const times = (Array.isArray(w.time) ? w.time : []).map(x => x && dayOfValue(x.date)).filter(Boolean);
      const started = dayOfValue(w.startedAt) || (w.status !== 'idle' ? minDate(times) : null);
      return { created: c, assigned: dayOfValue(w.assignedAt) || (w.owner ? c : null), started, done: w.status === 'done' ? dayOfValue(w.doneAt) : null };
    };
    const items = list(docs, 'workItem').filter(w => w.projectId === project.id);
    const row = (w, date, extra) => Object.assign({ id: w.id, title: w.title || 'Untitled task', owner: w.owner || null, ownerName: pn(w.owner), kind: w.kind || null, date }, extra || {});
    const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.title).localeCompare(String(b.title));
    const completed = [], assigned = [], started = [];
    items.forEach(w => {
      const f = factsOf(w);
      if (within(f.done)) completed.push(row(w, f.done, { due: w.due || null }));
      if (within(f.assigned)) assigned.push(row(w, f.assigned, { due: w.due || null }));
      if (within(f.started)) started.push(row(w, f.started));
    });
    // blockers: information not available yet (projectTruth's list) and problems (defect tasks)
    const raised = [], resolved = [], openAtEnd = [];
    const nowOpen = to >= String(today).slice(0, 10);
    const procs = linkedProcesses(docs, project), used = new Set();
    procs.forEach(p => flatSteps(p.tobe).forEach(s => stepData(s).forEach(id => used.add(id))));
    const infoBlockers = t.blockers.slice();
    const infoIds = new Set(infoBlockers.map(b => b.dataId));
    used.forEach(id => {
      const d = get(docs, 'dataElement', id); if (!d) return;
      const since = dayOfValue(d.unavailableSince);
      const res = items.find(w => w.resolves === id);
      const liveAt = !infoIds.has(id) ? dayOfValue(d.liveConfirmedAt) : null;
      const b = { kind: 'information', id: 'data:' + id, dataId: id, title: (d.name || 'some information') + ' is not available yet', name: d.name || 'some information',
        owner: dataOwnerOf(docs, d) || null, raisedAt: since };
      b.ownerName = pn(b.owner);
      if (within(since)) raised.push(Object.assign({}, b, { date: since }));
      if (liveAt && (since || res) && within(liveAt)) resolved.push(Object.assign({}, b, { title: (d.name || 'Some information') + ' is available', date: liveAt }));
      const openThen = infoIds.has(id) ? (!since || since <= to) : (!!liveAt && liveAt > to && !!since && since <= to);
      if (nowOpen ? infoIds.has(id) : openThen) {
        const ib = infoBlockers.find(x => x.dataId === id);
        openAtEnd.push(Object.assign({}, b, { planned: ib ? !!ib.planned : !!res, daysOpen: since ? businessDaysBetween(since, to) : null }));
      }
    });
    items.filter(w => w.kind === 'defect').forEach(w => {
      const f = factsOf(w);
      const b = { kind: 'problem', id: 'work:' + w.id, workId: w.id, title: problemTitle(w), owner: w.owner || null, ownerName: pn(w.owner), raisedAt: f.created };
      if (within(f.created)) raised.push(Object.assign({}, b, { date: f.created }));
      if (within(f.done)) resolved.push(Object.assign({}, b, { date: f.done }));
      const open = nowOpen ? w.status !== 'done' : (!f.created || f.created <= to) && (!f.done || f.done > to) && !(w.status === 'done' && !f.done);
      if (open) openAtEnd.push(Object.assign({}, b, { daysOpen: f.created ? businessDaysBetween(f.created, to) : null }));
    });
    // behind at the end of the window: projectTruth's late lists when it ends today, else the docs as they stood then
    let core;
    if (nowOpen) core = { pastDue: t.pastDue, finishAfterDue: t.finishAfterDue, late: t.late, fc: forecastAll(docs, today), items };
    else {
      const d2 = docsAsOf(docs, project.id, to, factsOf);
      const c2 = scheduleCore(d2, projOf(d2, project.id), to);
      core = { pastDue: c2.pastDue, finishAfterDue: c2.finishAfterDue, late: c2.late, fc: c2.fc, items: c2.items };
    }
    const wById = byId(core.items);
    const behindAtEnd = core.late.map(id => {
      const w = wById[id] || {}, f = core.fc[id] || {};
      return { id, title: w.title || 'Untitled task', owner: w.owner || null, ownerName: pn(w.owner), due: w.due || null, forecast: f.forecast || null,
        split: core.pastDue.includes(id) ? 'past-due' : 'finish-after-due', daysPastDue: f.pastDueDays || 0, slipDays: f.slipDays || 0, kind: w.kind || null };
    });
    const behindText = lateText({ lateCount: core.late.length, pastDueCount: core.pastDue.length, finishAfterDueCount: core.finishAfterDue.length });
    // tests, approvals, risks, spend
    const testsRun = { passed: 0, failed: 0, runs: 0 };
    runs.forEach(r => { if (!within(dayOfValue(r.at))) return; testsRun.runs++;
      (r.results || []).forEach(x => { if (x && x.outcome === 'pass') testsRun.passed++; else if (x && x.outcome === 'fail') testsRun.failed++; }); });
    const approvalsGiven = list(docs, 'approval').filter(a => a.projectId === project.id && a.bu && !a.kind && a.decision === 'approved')
      .map(a => ({ id: a.id, bu: a.bu || null, approver: a.approver || null, approverName: pn(a.approver), date: dayOfValue(a.date) || dayOfValue(a.at) }))
      .filter(a => within(a.date)).sort(byDate);
    const risksOpened = [], risksClosed = [];
    list(docs, 'risk').filter(r => r.projectId === project.id).forEach(r => {
      const o = dayOfValue(r.openedAt) || dayOfValue(r.createdAt) || created['risk:' + r.id] || null;
      const c = r.status === 'closed' ? dayOfValue(r.closedAt) : null;
      const base = { id: r.id, title: r.title || 'Untitled risk', impact: r.impact || null, owner: r.owner || null, ownerName: pn(r.owner) };
      if (within(o)) risksOpened.push(Object.assign({}, base, { date: o }));
      if (within(c)) risksClosed.push(Object.assign({}, base, { date: c }));
    });
    let spend = 0;
    items.forEach(w => (Array.isArray(w.time) ? w.time : []).forEach(x => {
      if (!x || !within(dayOfValue(x.date))) return;
      const h = isFinite(+x.hours) ? +x.hours : 0;
      spend += h * (rateOf(docs, x.by) ?? rateOf(docs, w.owner) ?? DEFAULT_DAY_RATE) / 8;
    }));
    spend = Math.round(spend * 100) / 100;
    // forecast finish when the window opened vs at its end (and now): saved snapshots, else a baseline, else not tracked
    const snaps = (Array.isArray(project.forecastLog) ? project.forecastLog : []).map(s => ({ date: dayOfValue(s && s.date), finish: dayOfValue(s && s.finish) }))
      .filter(s => s.date && s.finish).sort((a, b) => a.date.localeCompare(b.date));
    const before = snaps.filter(s => s.date < from).pop() || null;
    let thenF = null, thenSource = 'not-tracked', thenNote = null;
    if (before) { thenF = before.finish; thenSource = 'snapshot'; thenNote = 'saved ' + fmtDayLong(before.date); }
    else {
      const bl = (project.baselines || []).filter(b => b && dayOfValue(b.at) && dayOfValue(b.at) < from).sort((a, b) => String(a.at).localeCompare(String(b.at))).pop();
      const blFinish = bl && bl.items ? maxDate(Object.keys(bl.items).map(k => bl.items[k] && bl.items[k].due)) : null;
      if (blFinish) { thenF = blFinish; thenSource = 'baseline'; thenNote = 'the “' + (bl.label || 'saved plan') + '” plan (saved ' + fmtDayLong(dayOfValue(bl.at)) + ')'; }
    }
    const endSnap = snaps.filter(s => s.date <= to).pop() || null;
    const endF = nowOpen ? t.forecastFinish : endSnap ? endSnap.finish : null;
    const slipDays = thenF && endF ? businessDaysBetween(thenF, endF) : null;
    const bdw = n => nWord(Math.abs(n), 'business day');
    let slipText;
    if (slipDays == null) slipText = thenF || endF ? 'Change in the expected finish: not tracked (no saved forecast ' + (thenF ? 'at the end of this period' : 'from before this period') + ')'
      : 'Change in the expected finish: not tracked (no saved forecast or plan from before this period)';
    else if (thenSource === 'baseline') slipText = slipDays === 0 ? 'Expected finish ' + fmtDay(endF) + ', the same as ' + thenNote
      : 'Expected finish ' + fmtDay(endF) + ', ' + bdw(slipDays) + (slipDays > 0 ? ' later' : ' earlier') + ' than ' + thenNote;
    else slipText = slipDays === 0 ? 'Expected finish did not move ' + win.noun + ' (' + fmtDay(endF) + ')'
      : 'Expected finish moved ' + bdw(slipDays) + (slipDays > 0 ? ' later ' : ' earlier ') + win.noun + ' (' + fmtDay(thenF) + ' → ' + fmtDay(endF) + ')';
    // plan changes proposed or applied in the window (doc type planChange; read defensively)
    const planChanges = [];
    list(docs, 'planChange').filter(c => c && c.projectId === project.id).forEach(c => {
      const ap = c.status === 'applied' ? dayOfValue(c.appliedAt) : null, pr = dayOfValue(c.at);
      const ev = within(ap) ? 'applied' : within(pr) ? 'proposed' : null;
      if (!ev) return;
      const im = c.impact && typeof c.impact === 'object' ? c.impact : {};
      const de = im.deadlineEffect;
      const shift = typeof de === 'number' && isFinite(de) ? Math.round(de)
        : dayOfValue(im.forecastBefore) && dayOfValue(im.forecastAfter) ? businessDaysBetween(dayOfValue(im.forecastBefore), dayOfValue(im.forecastAfter)) : null;
      const decided = c.decidedBy ? pn(c.decidedBy) : null;
      const st = c.status === 'applied' || c.status === 'approved' ? (decided ? 'approved by ' + decided : 'approved') : c.status === 'rejected' ? 'rejected' + (decided ? ' by ' + decided : '') : 'waiting for a decision';
      const bits = [shift ? 'expected finish ' + bdw(shift) + (shift > 0 ? ' later' : ' earlier') : '', c.reason ? String(c.reason) : '', st].filter(Boolean);
      planChanges.push({ id: c.id, title: c.title || 'Plan change', reason: c.reason || null, category: c.category || null, status: c.status || 'proposed', event: ev,
        date: ev === 'applied' ? ap : pr, requestedBy: c.requestedBy || null, decidedBy: c.decidedBy || null, decidedByName: decided, shiftDays: shift,
        text: (c.title || 'Plan change') + ' (' + bits.join('; ') + ')' });
    });
    planChanges.sort(byDate);
    // overall: projectTruth as of today, plus the common areas of concern
    const cost = t.cost || {};
    const money0 = n => '$' + Math.round(+n || 0).toLocaleString('en-US');
    let budgetText = null;
    if (cost.planned != null && cost.forecast != null) budgetText = cost.overBudget
      ? 'Higher budget need expected: expected cost ' + money0(cost.forecast) + ' against the ' + money0(cost.planned) + ' budget (' + money0(cost.forecast - cost.planned) + ' over)'
      : 'Within budget: expected cost ' + money0(cost.forecast) + ' against the ' + money0(cost.planned) + ' budget';
    else if (cost.show && cost.forecast != null) budgetText = 'Expected cost ' + money0(cost.forecast) + ' (no budget set)';
    const concerns = areasOfConcern(docs, project, t);
    const desc = String(project.desc || project.description || '').trim(), purpose = String(project.purpose || '').trim();
    const overall = {
      name: project.name || '', description: desc || null, purpose: purpose || null, needsPurpose: !desc && !purpose,
      label: t.label, rag: t.rag, sentence: t.sentence, reasons: t.reasons.slice(), lateText: t.lateText, lateCount: t.lateCount,
      forecastFinish: t.forecastFinish, deadline: t.target, bufferDays: t.bufferDays,
      schedule: t.forecastFinish && t.target ? (t.forecastFinish > t.target ? 'Behind schedule: expected ' + fmtDay(t.forecastFinish) + ', ' + bdw(t.bufferDays) + ' after the ' + fmtDay(t.target) + ' deadline'
        : 'Expected ' + fmtDay(t.forecastFinish) + ', ' + (t.forecastFinish === t.target ? 'right on' : bdw(t.bufferDays) + ' before') + ' the ' + fmtDay(t.target) + ' deadline') : null,
      behindSchedule: !!(t.forecastFinish && t.target && t.forecastFinish > t.target),
      budget: { planned: cost.planned != null ? cost.planned : null, actual: cost.actual != null ? cost.actual : null, forecast: cost.forecast != null ? cost.forecast : null,
        overBudget: !!cost.overBudget, variance: cost.variance != null ? cost.variance : null, text: budgetText },
      who: t.who.slice(0, 5).map(x => ({ person: x.person, name: x.name, what: x.what, why: x.why })), whoCount: t.who.length,
      tasks: Object.assign({}, t.tasks), pctDone: t.pctDone, stepsLeft: t.stepsLeft,
      testingNext: t.testing && t.testing.next ? t.testing.next : null, concerns,
    };
    // compare with the previous week (week presets only)
    let compare = null;
    if (win.preset === 'this-week' || win.preset === 'last-week') {
      const pw = periodWindow(docs, project, { preset: 'custom', from: firstBizFrom(addDays(mondayOf(from), -7)), to: lastBizOnOrBefore(addDays(mondayOf(from), -3)) }, today);
      const n = items.filter(w => { const d = factsOf(w).done; return d && d >= pw.from && d <= pw.to; }).length;
      compare = { from: pw.from, to: pw.to, completed: completed.length, prevCompleted: n,
        text: completed.length + ' done ' + win.noun + ' vs ' + n + ' the week before' };
    }
    return {
      projectId: project.id, today: String(today).slice(0, 10), window: win, from, to,
      completed: completed.sort(byDate), assigned: assigned.sort(byDate), started: started.sort(byDate),
      blockersRaised: raised.sort(byDate), blockersResolved: resolved.sort(byDate), blockersOpenAtEnd: openAtEnd,
      behindAtEnd, behindText, behindPastDue: core.pastDue.length, behindFinishAfterDue: core.finishAfterDue.length,
      testsRun, approvalsGiven, risksOpened: risksOpened.sort(byDate), risksClosed: risksClosed.sort(byDate),
      spendInPeriod: spend, forecastFinishThen: thenF, forecastFinishThenSource: thenSource, forecastFinishThenNote: thenNote,
      forecastFinishEnd: endF, forecastFinishNow: t.forecastFinish, slipDays, slipText, planChanges, compare, overall,
    };
  }
  // The 2–3 recurring places late and blocked work sits: grouped by category (the project's first select field, e.g.
  // "Risk area"), by step and by team. A group needs 2+ items; a group with the same items as a stronger one is skipped.
  function areasOfConcern(docs, project, t) {
    const items = byId(list(docs, 'workItem').filter(w => w.projectId === project.id));
    const ids = new Set(t.late);
    Object.keys(items).forEach(id => { const w = items[id]; if (w.status !== 'done' && w.kind === 'defect') ids.add(id); });
    t.blockers.forEach(b => Object.keys(items).forEach(id => {
      const w = items[id]; if (w.status === 'done') return;
      const st = findStep(docs, w.pid, w.step); if (st && stepData(st).includes(b.dataId)) ids.add(id);
    }));
    const all = [...ids].map(id => items[id]).filter(Boolean);
    if (all.length < 2) return [];
    const people = personMap(docs);
    const field = (project.fields || []).find(f => f && f.type === 'select');
    const groups = {};
    const put = (dim, key, label, w) => { if (!key) return; const k = dim + ':' + key; (groups[k] = groups[k] || { dimension: dim, key, label, items: [] }).items.push(w.id); };
    all.forEach(w => {
      if (field && w.custom && w.custom[field.key]) put('category', w.custom[field.key], String(w.custom[field.key]), w);
      const st = findStep(docs, w.pid, w.step); if (st) put('step', w.pid + '/' + w.step, '“' + (st.title || 'a step') + '”', w);
      const bu = people[w.owner] && people[w.owner].bu; if (bu) put('team', bu, bu, w);
    });
    const order = { category: 0, step: 1, team: 2 }, word = { category: field ? String(field.label || 'category').toLowerCase() : 'category', step: 'step', team: 'team' };
    const picked = [];
    Object.keys(groups).map(k => groups[k]).filter(g => g.items.length >= 2)
      .sort((a, b) => b.items.length - a.items.length || order[a.dimension] - order[b.dimension] || a.label.localeCompare(b.label))
      .forEach(g => { if (picked.length >= 3) return; const sig = g.items.slice().sort().join(','); if (picked.some(p => p.items.slice().sort().join(',') === sig)) return; picked.push(g); });
    return picked.map(g => ({ dimension: g.dimension, key: g.key, label: g.label, count: g.items.length, of: all.length, items: g.items,
      titles: g.items.map(id => items[id].title || 'Untitled task'),
      text: (g.dimension === 'step' ? 'The ' + g.label + ' step: ' : g.dimension === 'team' ? g.label + ' team: ' : g.label + ' (' + word.category + '): ') +
        g.items.length + ' of the ' + all.length + ' late or blocked tasks' }));
  }

  /* ------------------------------------------------------------------ */
  /* R11 (G1) governance integrity helpers                               */
  /* ------------------------------------------------------------------ */
  // R11 §5 one lateness per task: {late, days, pastDue, due, forecast, text: "Late by 6 business days",
  // dueText: "was due Nov 16" (past dates only) | "due Dec 3"}.
  function lateInfo(docs, workId, today, fc) {
    const w = typeof workId === 'string' ? get(docs, 'workItem', workId) : workId;
    if (!w) return null;
    const r = (fc || forecastAll(docs, today))[w.id] || {};
    const days = r.lateDays || 0;
    const due = isDate(w.due) ? w.due : null;
    const past = !!(due && isDate(today) && due < today);
    return { workId: w.id, late: !!r.late, days, pastDue: r.sched === 'late', due, forecast: r.forecast || null,
      text: r.late ? 'Late by ' + nWord(days, 'business day') : '', dueText: due ? (past ? 'was due ' : 'due ') + fmtDay(due) : '' };
  }
  // R11 §5 ONE definition of blocking, used by the header, the report and the risk register: a piece of information
  // the project's Future steps need that is not available yet AND holds up at least one open task. planned = work
  // is scheduled to get it. {count, holdsUp, unplanned, items: [{dataId, name, planned, held, text}], text}.
  function blockingOf(docs, prj, blockers) {
    const project = projOf(docs, prj);
    if (!project) return { count: 0, holdsUp: 0, unplanned: 0, items: [], text: 'Nothing blocking' };
    const items = (blockers || blockersOf(docs, project)).filter(b => b.held > 0).map(b => ({ dataId: b.dataId, name: b.name, planned: b.planned, held: b.held, owner: b.owner,
      text: b.name + ' holds up ' + nWord(b.held, 'task') + (b.planned ? '; work is planned to get it' : '; no work is planned to get it') }));
    const holdsUp = items.reduce((a, b) => a + b.held, 0);
    return { count: items.length, holdsUp, unplanned: items.filter(b => !b.planned).length, items,
      text: items.length ? items.length + ' blocking (holds up ' + nWord(holdsUp, 'task') + ')' : 'Nothing blocking' };
  }
  // R11 §3 temporary data access, one set of words and counts everywhere (Launch, the gate, History):
  //  waiting = requested (needs a decision; blocks launch), open = approved or active and not past its expiry
  //  (closes automatically at launch), closed = expired, revoked or denied. Dates are the person's local dates when
  //  tzOffsetMinutes is given (Date#getTimezoneOffset sign: minutes BEHIND UTC, e.g. 360 for Chicago in winter).
  const GRANT_MAX_DAYS = 30;
  function localDay(ts, tzOffsetMinutes) {
    if (!ts) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(ts))) return String(ts);
    const ms = Date.parse(ts); if (isNaN(ms)) return null;
    return iso(ms - (isFinite(+tzOffsetMinutes) ? +tzOffsetMinutes : 0) * 60000 - ((ms - (isFinite(+tzOffsetMinutes) ? +tzOffsetMinutes : 0) * 60000) % DAY + DAY) % DAY);
  }
  function grantState(g, today) {
    if (!g) return 'closed';
    if ((g.status === 'active' || g.status === 'approved') && isDate(g.expires) && isDate(today) && String(g.expires).slice(0, 10) < today) return 'closed';
    return g.status === 'requested' ? 'waiting' : g.status === 'active' || g.status === 'approved' ? 'open' : 'closed';
  }
  const GRANT_WORDS = { waiting: 'Waiting for approval', open: 'Open', closed: 'Closed' };
  function grantView(g, today, tzOffsetMinutes) {
    const state = grantState(g, today);
    const from = localDay(g && (g.approvedAt || null), tzOffsetMinutes);
    const to = g && isDate(g.expires) ? String(g.expires).slice(0, 10) : null;
    const days = from && to ? Math.max(0, diffDays(to, from)) : null;
    const closedOn = state === 'closed' && g ? localDay(g.closedAt || g.expiredAt || (g.status !== 'denied' && to && isDate(today) && to < today ? to : null) || ((g.log || []).filter(e => e && /expire|revoke|den/i.test(String(e.action || ''))).map(e => e.at).sort().pop()) || null, tzOffsetMinutes) : null;
    return { state, label: GRANT_WORDS[state], from, to, days, maxDays: GRANT_MAX_DAYS, overMax: days != null && days > GRANT_MAX_DAYS, closedOn,
      text: state === 'waiting' ? 'Waiting for approval' : state === 'open' ? 'Open' + (to ? ' until ' + fmtDay(to) : '') + (days != null ? ' (' + nWord(days, 'day') + ' of ' + GRANT_MAX_DAYS + ' at most)' : '')
        : 'Closed' + (closedOn ? ' ' + fmtDay(closedOn) : '') };
  }
  function grantCounts(docs, prj, today) {
    const project = projOf(docs, prj);
    const gs = project ? list(docs, 'grant').filter(g => g.projectId === project.id) : [];
    const by = { waiting: [], open: [], closed: [] };
    gs.forEach(g => by[grantState(g, today)].push(g.id));
    return { waiting: by.waiting.length, open: by.open.length, closed: by.closed.length, ids: by, blocking: by.waiting.length,
      text: [by.waiting.length ? nWord(by.waiting.length, 'request') + ' waiting for approval' : '', by.open.length ? by.open.length + ' open (they close at launch)' : ''].filter(Boolean).join(' · ') || 'No temporary access open' };
  }
  // R11 §3 the launch guard, evaluated on the person's local wall time `now` ("YYYY-MM-DDTHH:MM", or a date).
  // {ok, why: [plain reasons], codes: ['window'|'tasks'], windowOpens: "Mon Dec 7, 7:30 AM", openTasks: [...]}.
  function windowParts(w) {
    if (!w) return null;
    if (typeof w === 'object') { const st = String(w.start || ''); return isDate(st) ? { date: st.slice(0, 10), from: st.slice(11, 16) || '' } : null; }
    const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/.exec(String(w).trim());
    return m ? { date: m[1], from: m[2] ? (m[2].length === 4 ? '0' + m[2] : m[2]) : '' } : null;
  }
  function fmtClock(hm) { const m = /^(\d{1,2}):(\d{2})$/.exec(hm || ''); if (!m) return ''; const h = +m[1]; return (h % 12 || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function launchGuard(docs, prj, now) {
    const project = projOf(docs, prj);
    if (!project) return { ok: false, why: ['the project could not be found'], codes: ['project'], openTasks: [] };
    const co = project.cutover || {};
    const why = [], codes = [];
    const wp = windowParts(co.window);
    const nowS = String(now || '');
    const nowDay = isDate(nowS) ? nowS.slice(0, 10) : null, nowHm = (/T(\d{2}:\d{2})/.exec(nowS) || [])[1] || null;
    let windowOpens = null;
    if (wp && nowDay) {
      const opens = wp.date + 'T' + (wp.from || '00:00');
      const nowKey = nowDay + 'T' + (nowHm || '00:00');
      if (nowKey < opens) { windowOpens = fmtDayLong(wp.date) + (wp.from ? ', ' + fmtClock(wp.from) : ''); why.push('the launch window opens ' + windowOpens); codes.push('window'); }
    }
    // go/no-go tasks are not here: they must be confirmed by their owners and can never be overridden
    const openTasks = (Array.isArray(co.tasks) ? co.tasks.filter(Boolean) : []).filter(t => !t.done && !t.gonogo);
    if (openTasks.length) { why.push(nWord(openTasks.length, 'launch-day step') + ' ' + (openTasks.length === 1 ? 'is' : 'are') + ' not done yet: ' + joinList(openTasks.map(t => '“' + (t.task || t.title || 'untitled step') + '”'), 3)); codes.push('tasks'); }
    return { ok: !why.length, why, codes, windowOpens, openTasks: openTasks.map(t => t.id || t.task || ''),
      text: why.length ? 'Ready except: ' + why.join('; ') : 'Ready to launch' };
  }
  // R11 §2 launch overrides need TWO different people, both with step-up: the project manager AND a sponsor or
  // approver (project.sponsor when set; otherwise anyone who may approve one of the project's parts, never the
  // project manager or the launch owner). Sign-offs are approval docs {kind: 'launch-override', projectId, role:
  // 'pm'|'sponsor', approver, decision: 'approved', stepUp: true, reason, at}. A sign-off taken before the latest
  // launch-day plan change does not count.
  function overrideSignerRole(docs, prj, personId) {
    const project = projOf(docs, prj);
    if (!project || !personId) return null;
    if (personId === project.owner) return 'pm';
    const lo = project.releaseManager || project.owner;
    if (personId === lo) return null;
    if (project.sponsor) return personId === project.sponsor ? 'sponsor' : null;
    const r = readiness(docs, project.id, null);
    const bu = (r.checks || []).find(c => c.id === 'bu-signoff') || {};
    const elig = Object.keys(bu.eligible || {}).some(k => (bu.eligible[k] || []).includes(personId));
    const approved = (bu.sectionStatus || []).some(x => x.approver === personId && x.approved);
    return elig || approved ? 'sponsor' : null;
  }
  function launchOverrideStatus(docs, prj, now) {
    const project = projOf(docs, prj);
    if (!project) return { needed: false, ok: false, signoffs: [], missing: [], text: '' };
    const guard = launchGuard(docs, project, now);
    const since = [project.cutoverUpdatedAt].concat(((project.cutover || {}).tasks || []).filter(Boolean).map(t => t.updatedAt)).filter(Boolean).map(String).sort().pop() || '';
    const docsO = list(docs, 'approval').filter(a => a.projectId === project.id && a.kind === 'launch-override' && a.decision === 'approved' && a.stepUp === true && String(a.at || '') > since);
    const pick = role => latestBy(docsO.filter(a => a.role === role && overrideSignerRole(docs, project, a.approver) === role), 'at');
    const pm = pick('pm'), sp = pick('sponsor');
    const signoffs = [pm, sp].filter(Boolean).map(a => ({ role: a.role, by: a.approver, name: nameOf(docs, a.approver), at: a.at, reason: a.reason || '' }));
    const ok = !!(pm && sp && pm.approver !== sp.approver);
    const missing = [!pm ? 'pm' : null, !sp ? 'sponsor' : null].filter(Boolean);
    return { needed: !guard.ok, guard, ok: guard.ok || ok, overridden: !guard.ok && ok, signoffs, missing,
      text: guard.ok ? '' : ok ? 'Override signed by ' + joinList(signoffs.map(x => x.name)) + '.' : 'An override needs the project manager and a sponsor or approver, both with an extra sign-in check. ' +
        (missing.length === 2 ? 'Neither has signed.' : (missing[0] === 'pm' ? 'The project manager' : 'A sponsor or approver') + ' still has to sign.') };
  }
  // R11 §9 Jira/ADO inbound dependency check: a task marked Done (by sync) while work it depends on is still open.
  // {flag, open: [{id, title}], text: "Finished before the work it depends on"}.
  function doneBeforeDeps(docs, workId) {
    const w = typeof workId === 'string' ? get(docs, 'workItem', workId) : workId;
    if (!w || w.status !== 'done') return { flag: false, open: [], text: '' };
    const idx = byId(list(docs, 'workItem'));
    const open = depIds(w).map(id => idx[id]).filter(d => d && d.status !== 'done').map(d => ({ id: d.id, title: d.title || 'untitled task' }));
    return { flag: open.length > 0, open, text: open.length ? 'Finished before the work it depends on (' + joinList(open.map(d => '“' + d.title + '”'), 3) + ' ' + (open.length === 1 ? 'is' : 'are') + ' still open)' : '' };
  }
  // R11 §7 holiday-aware sprint calendar: working days, the days off inside it, and capacity pro-rated per person
  // (person.capacity days per 5-day week, default 4). [{id, name, start, end, workingDays, daysOff: [{date, name}],
  // capacity: {total, people: [{id, name, days}]}, text: "Nov 16–27 · 9 working days (Thanksgiving Day off)"}].
  function sprintCalendar(docs, prj, today) {
    const project = projOf(docs, prj);
    if (!project) return [];
    syncCalendar(docs);
    const ppl = personList(docs);
    const items = list(docs, 'workItem').filter(w => w.projectId === project.id);
    const involved = [...new Set(items.map(w => w.owner).filter(Boolean))];
    return sprints(project, today, docs).map(sp => {
      const daysOff = [];
      let working = 0;
      if (isDate(sp.start) && isDate(sp.end)) for (let ms = toMs(sp.start), g = 0; ms <= toMs(sp.end) && g < 400; ms += DAY, g++) {
        const wd = weekday(ms); if (wd === 0 || wd === 6) continue;
        const h = holidayName(iso(ms)); if (h) daysOff.push({ date: iso(ms), name: h }); else working++;
      }
      const people = involved.map(id => { const p = ppl.find(x => x.id === id) || {}; const cap = p.capacity != null && isFinite(+p.capacity) ? +p.capacity : 4;
        return { id, name: p.name || 'someone', days: Math.round(cap * working / 5 * 10) / 10 }; });
      const total = Math.round(people.reduce((a, x) => a + x.days, 0) * 10) / 10;
      return Object.assign({}, sp, { workingDays: working, daysOff, capacity: { total, people },
        text: fmtDay(sp.start) + '–' + fmtDay(sp.end) + ' · ' + nWord(working, 'working day') + (daysOff.length ? ' (' + joinList(daysOff.map(d => d.name)) + ' off)' : '') });
    });
  }

  return {
    // R11 (G1)
    testingTruth, runAuditText, approvalBar, partTests, lateInfo, blockingOf, grantState, grantView, grantCounts, localDay, launchGuard,
    launchOverrideStatus, overrideSignerRole, doneBeforeDeps, sprintCalendar, heldTests, problemFixDone, GRANT_MAX_DAYS,
    // R10.1 stream R
    periodReport, periodWindow, areasOfConcern, PERIOD_PRESETS,
    // R10
    federalHolidays, holidays, isHoliday, holidayName, syncCalendar, changeSummary, changeText, lateText, launchDate, checkLaunchWindow,
    // R9
    personQueue, planFit, planToWork, waitingOn, displayValue, namesFor, dataOwner, defaultDataOwner,
    isBusinessDay, toBusinessDay, fmtDay, fmtDayLong,
    // R8
    projectTruth, awaitingConfirmation, burndownStatus, changedInformation, generateProjectTests,
    buReady, approvalNoteFacts, stepConflict, projectConflicts, profileLines,
    // R7
    availLabel, projectSummary, testingSummary, launchSteps, specFromProfile, sectionFingerprint,
    // contract section 4
    flatSteps, diffProcess, forecastAll, stepState, dataReady, dependents, impactOfData,
    projectStats, readiness, profileCsv, specDrift, generateTests, workload, baselineVariance, suggestWorkFromDiff,
    generateUatScripts, flatGateways, effectiveAvail, diffSummary, criticalPath, humanPattern,
    explainForecast, sprints, sprintOf, addBusinessDays, businessDaysBetween,
    caseLabel, diffVersions, scheduleConflicts, autoSchedule, generateScenarios, usageOf, workCost, projectFinancials, burndown,
    humanPatterns, evidenceOf,
    // R6
    projectHealth, scheduleBadge, earnedValue, levelResources, compareScenario, defaultTarget,
    testCoverage, defectState, defectsVerifiable, latestOutcomes,
    // helpers (stable, safe to use from pages)
    parseCsv, maskValue, patternOf, expandPattern, fieldSpec, validate, addDays, diffDays,
  };
});
