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
  function stepChanges(a, n) {
    const ch = [];
    const t = textChange('Title', a.title, n.title); if (t) ch.push(t);
    if ((a.owner || '') !== (n.owner || '')) ch.push('Owner ' + (a.owner || '(none)') + ' → ' + (n.owner || '(none)'));
    setDiff('Data', a.data, n.data).forEach(x => ch.push(x));
    const s = textChange('SLA', a.sla, n.sla); if (s) ch.push(s);
    const y = textChange('System', a.system, n.system); if (y) ch.push(y);
    // Sub-steps are compared only when the as-is step documents them (undefined = not decomposed).
    if (Array.isArray(a.subs)) {
      const at = a.subs.map(x => x && x.title || ''), nt = (n.subs || []).map(x => x && x.title || '');
      setDiff('Sub-steps', at, nt).forEach(x => ch.push(x));
      const am = {}; a.subs.forEach(x => { if (x) am[x.title || ''] = x; });
      (n.subs || []).forEach(x => {
        const o = x && am[x.title || ''];
        if (o) setDiff('Sub-step "' + x.title + '" data', o.data, x.data).forEach(c => ch.push(c));
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
  function diffProcess(process) {
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
    flatSteps(process && process.tobe).forEach(n => classify(n, n.from && asis[n.from], 'step', stepChanges));
    flatGateways(process && process.tobe).forEach(n => classify(n, n.from && asisG[n.from], 'gateway', gatewayChanges));
    const removed = asisSteps.concat(asisGw).filter(a => !used.has(a.id));
    return { nodes, removed, changes };
  }

  // Counts for every UI badge: gateways count as nodes in new/changed.
  function diffSummary(process) {
    const d = diffProcess(process);
    const out = { new: 0, changed: 0, removed: d.removed.length, same: 0 };
    Object.keys(d.nodes).forEach(k => { out[d.nodes[k]]++; });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Forecast                                                            */
  /* ------------------------------------------------------------------ */
  // Business-day calendar: Monday–Friday. addBusinessDays(d, 0) rolls a weekend date forward to Monday.
  function weekday(ms) { return new Date(ms).getUTCDay(); }
  function addBusinessDays(s, n) {
    if (!isDate(s)) return null;
    let ms = toMs(s), left = Math.abs(Math.round(n || 0));
    const step = n < 0 ? -1 : 1;
    if (!left) { while (weekday(ms) === 0 || weekday(ms) === 6) ms += DAY; return iso(ms); }
    while (left > 0) { ms += step * DAY; const wd = weekday(ms); if (wd !== 0 && wd !== 6) left--; }
    return iso(ms);
  }
  // Weekdays in (a, b]; negative when b < a.
  function businessDaysBetween(a, b) {
    if (!isDate(a) || !isDate(b)) return 0;
    let x = toMs(a), y = toMs(b), sign = 1;
    if (y < x) { const t = x; x = y; y = t; sign = -1; }
    const days = Math.round((y - x) / DAY), full = Math.floor(days / 7);
    let n = full * 5;
    for (let ms = x + (full * 7 + 1) * DAY; ms <= y; ms += DAY) { const wd = weekday(ms); if (wd !== 0 && wd !== 6) n++; }
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
    list(docs, 'dataElement').forEach(d => { m[d.id] = availOf(d, work); });
    return m;
  }
  function availOf(d, work) {
    if (!d) return 'missing';
    if (d.avail === 'live') return 'live';
    if (d.liveConfirmedBy && d.liveConfirmedBy === d.owner && d.liveSource) return 'live';
    if (work.some(w => w.resolves === d.id && w.status === 'done')) return 'pending';
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
        res = { forecast: fin, start: isDate(w.start) ? w.start : fin, sched: 'done', slipDays: fin && isDate(w.due) ? Math.max(0, diffDays(fin, w.due)) : 0, basis: { kind: 'done' } };
      } else {
        const dur = duration(w);
        let best = isDate(w.due) ? w.due : null, basis = { kind: 'due' };
        const consider = (date, b) => { if (isDate(date) && (!best || date > best)) { best = date; basis = b; } };
        normDeps(w).forEach(d => {
          const dep = idx[d.id];
          if (!dep || dep.status === 'done' || visiting[d.id] || d.id === id) return;
          const r = calc(d.id);
          if (!r.forecast) return;
          const date = d.type === 'FF' ? addBusinessDays(r.forecast, d.lag)
            : addBusinessDays(addBusinessDays(d.type === 'SS' ? r.start : r.forecast, d.lag), dur);
          consider(date, { kind: 'dep', ref: d.id, type: d.type, lag: d.lag, from: d.type === 'SS' ? r.start : r.forecast, dur });
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
          consider(today, { kind: 'today' });
        }
        res = { forecast: best, start: best ? addBusinessDays(best, -dur) : null, slipDays: best && isDate(w.due) ? Math.max(0, diffDays(best, w.due)) : 0, basis };
        const viaId = basis.kind === 'dep' ? basis.ref : basis.kind === 'data' ? basis.resolver : null;
        if (viaId) res.via = viaId;   // the item that sets this forecast (binding)
        if (isDate(w.due) && isDate(today) && w.due < today) res.sched = 'late';
        else if (best && isDate(w.due) && best > w.due) res.sched = 'slip';
        else if (isDate(w.due) && isDate(today) && diffDays(w.due, today) <= 5) res.sched = 'soon';
        else res.sched = 'ok';
        if (viaId && best && isDate(w.due) && best > w.due) {
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
          return (b.type === 'SS' ? 'Starts with ' + t(b.ref) + ' (starting ' : 'Waits for ' + t(b.ref) + ' (forecast ') + fmtDay(b.from) + ')' + lagTxt + ' → +' + bd(b.dur) + ' effort → ' + fmtDay(r.forecast);
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

  // Longest binding forecast chain ending at the project finish, root first. All done: the chain ending
  // at the latest actual finish. A dependency is on the path only when it sets its successor's forecast.
  function criticalPath(docs, projectId, today) {
    const fc = forecastAll(docs, today);
    const items = list(docs, 'workItem').filter(w => w.projectId === projectId);
    if (!items.length) return [];
    const finish = projectStats(docs, projectId, today).finish;
    const allDone = items.every(w => w.status === 'done');
    const ends = items.filter(w => (allDone ? (w.doneAt || w.due) : (w.status !== 'done' && fc[w.id].forecast)) === finish);
    let best = [];
    ends.forEach(w => {
      const chain = [], seen = new Set();
      let cur = w.id;
      while (cur && !seen.has(cur)) { seen.add(cur); chain.unshift(cur); cur = fc[cur] && fc[cur].via; }
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
    return availOf(get(docs, 'dataElement', dataId), list(docs, 'workItem'));
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
    if (!items.length) return { items, status: 'none', done: 0, due: null, forecast: null, next: null, sched: 'ok', blockers: [] };
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
      needsLive: step ? (step.data || []).filter(d => { const e = effectiveAvail(docs, d); return e === 'example' || e === 'pending'; }) : [],
      pending: step ? (step.data || []).filter(d => effectiveAvail(docs, d) === 'pending') : [],
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
      late: items.filter(w => fc[w.id].sched === 'late').length,
      slip: items.filter(w => fc[w.id].sched === 'slip').length,
      blocked: items.filter(w => w.status !== 'done' && depIds(w).some(d => idx[d] && idx[d].status !== 'done')).length,
      finish, target,
      onTrack: !target || !finish || finish <= target,
    };
    if (allDone) out.actualFinish = finish;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Readiness gate                                                      */
  /* ------------------------------------------------------------------ */
  function latestBy(arr, key) { return arr.slice().sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || ''))).pop() || null; }

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

  function finishCheck(c) {
    c.status = c.warning ? (c.pass ? 'pass' : 'warn') : (c.pass ? 'pass' : 'fail');
    return c;
  }
  function summarize(checks) {
    const sm = { pass: 0, fail: 0, warn: 0 };
    checks.forEach(c => { sm[c.status] = (sm[c.status] || 0) + 1; });
    return sm;
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
    const buOf = pid => people[pid] && people[pid].bu || null;
    // BU sections: a step belongs to its owner's BU plus every BU named (case-insensitive) in its touches tags.
    const allBus = [...new Set(Object.keys(people).map(k => people[k] && people[k].bu).filter(Boolean))];
    const stepBus = st => {
      const set = new Set();
      const ob = buOf(st.owner); if (ob) set.add(ob);
      (st.touches || []).forEach(tag => { const tl = String(tag || '').trim().toLowerCase(); allBus.forEach(b => { if (b.toLowerCase() === tl) set.add(b); }); });
      return [...set];
    };
    const stepBuIdx = {};
    steps.forEach(x => { stepBuIdx[x.pid + '/' + x.s.id] = stepBus(x.s); });
    const workBus = w => stepBuIdx[w.pid + '/' + w.step] || [buOf(w.owner)].filter(Boolean);
    const procBus = p => [...new Set(flatSteps(p.tobe).flatMap(stepBus))];

    // work-done
    const open = work.filter(w => w.status !== 'done');
    checks.push({ id: 'work-done', label: 'All work items done', pass: open.length === 0,
      detail: open.length ? open.length + ' of ' + nWord(work.length, 'work item') + ' ' + isAre(open.length) + ' still open: ' + joinList(open.map(w => w.title || 'untitled item'), 5) + '.'
        : 'All ' + nWord(work.length, 'work item') + ' ' + isAre(work.length) + ' done.', items: open.map(w => w.id) });

    // data-live: examples-only data fails here (it needs a live source before go-live).
    const av = availMap(docs);
    const missing = usedData.filter(d => (av[d] || 'missing') === 'missing');
    const examples = usedData.filter(d => av[d] === 'example');
    const pendingD = usedData.filter(d => av[d] === 'pending');
    const dl = [];
    if (missing.length) dl.push(joinList(missing.map(dn)) + ' ' + isAre(missing.length) + ' missing.');
    if (examples.length) dl.push(joinList(examples.map(dn)) + ' ' + (examples.length === 1 ? 'has' : 'have') + ' examples only and need' + (examples.length === 1 ? 's' : '') + ' a live source before go-live.');
    pendingD.forEach(d => dl.push(dn(d) + ': fix done, awaiting ' + pn(dataIdx[d] && dataIdx[d].owner) + ' to confirm it is live.'));
    if (!dl.length) dl.push('All ' + nWord(usedData.length, 'data element') + ' ' + isAre(usedData.length) + ' live.');
    checks.push({ id: 'data-live', label: 'Required data is live', pass: !missing.length && !examples.length && !pendingD.length, detail: dl.join(' '),
      items: missing.concat(examples, pendingD), missing, examples, pending: pendingD,
      awaiting: pendingD.map(d => ({ dataId: d, owner: (dataIdx[d] && dataIdx[d].owner) || null, text: 'awaiting ' + pn(dataIdx[d] && dataIdx[d].owner) + ' to confirm' })) });

    // discovered-resolved. Items are "<dataId>#<index>".
    const unresolved = [], perData = {};
    usedData.forEach(d => ((dataIdx[d] && dataIdx[d].discovered) || []).forEach((x, i) => { if (x && !x.resolved) { unresolved.push(d + '#' + i); perData[d] = (perData[d] || 0) + 1; } }));
    checks.push({ id: 'discovered-resolved', label: 'Discovered requirements resolved', pass: unresolved.length === 0,
      detail: unresolved.length ? joinList(Object.keys(perData).map(d => nWord(perData[d], 'discovered requirement') + ' on ' + dn(d))) + ' ' + isAre(unresolved.length) + ' not resolved.'
        : 'No open discovered requirements.', items: unresolved });

    // process-valid
    const problems = [];
    procs.forEach(p => {
      const ids = allNodeIds(p.tobe);
      const where = ' in ' + (p.name || 'a linked process');
      flatSteps(p.tobe).forEach(s => { if (!s.owner) problems.push({ pid: p.id, node: s.id, problem: 'Step "' + (s.title || 'untitled') + '"' + where + ' has no owner' }); });
      flatGateways(p.tobe).forEach(g => {
        const br = g.branches || [];
        if (!br.some(b => b && ((b.nodes || []).length || b.goto))) problems.push({ pid: p.id, node: g.id, problem: 'Gateway "' + (g.title || 'untitled') + '"' + where + ' has only empty branches' });
        br.forEach(b => { if (b && b.goto && !ids.has(b.goto)) problems.push({ pid: p.id, node: g.id, problem: 'Branch "' + (b.label || 'unlabelled') + '" of "' + (g.title || 'untitled') + '"' + where + ' loops back to a step that no longer exists' }); });
      });
    });
    checks.push({ id: 'process-valid', label: 'Process design is valid', pass: problems.length === 0,
      detail: problems.length ? problems.map(x => x.problem).join('. ') + '.' : 'Every step has an owner and every gateway is well formed.',
      items: problems.map(x => x.pid + ':' + x.node), problems });

    // tests-passed: latest run per env; failing counts only those runs; every project data element needs cases.
    const usedSet = new Set(usedData);
    const cases = list(docs, 'testCase').filter(c => usedSet.has(c.dataId));
    const caseIdx = byId(cases);
    const scripts = Array.isArray(project.uatScripts) ? project.uatScripts : generateUatScripts(docs, projectId);
    const scriptIdx = byId(scripts);
    const runs = list(docs, 'testRun').filter(r => r.projectId === projectId);
    const lastDev = latestBy(runs.filter(r => r.env === 'dev'), 'at');
    const lastUat = latestBy(runs.filter(r => r.env === 'uat'), 'at');
    const rid = x => x.caseId || x.scriptId;
    // Outcome of each case/script per env = its latest result across ALL runs of that env (partial imports carry earlier passes forward).
    const latestPerItem = env => {
      const m = {};
      runs.filter(r => r.env === env).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
        .forEach(r => (r.results || []).forEach(x => { if (rid(x)) m[rid(x)] = x.outcome; }));
      return m;
    };
    const devOut = latestPerItem('dev'), uatOut = latestPerItem('uat');
    const failing = new Set(), blocked = new Set();
    Object.keys(devOut).forEach(k => { if (devOut[k] === 'fail') failing.add(k); });
    const coveredUat = new Set(Object.keys(uatOut));
    Object.keys(uatOut).forEach(k => { if (uatOut[k] === 'fail') failing.add(k); else if (uatOut[k] === 'blocked') blocked.add(k); });
    const unrun = cases.map(c => c.id).concat(scripts.map(x => x.id)).filter(id => !coveredUat.has(id));
    const noCases = usedData.filter(d => !cases.some(c => c.dataId === d));
    const defects = work.filter(w => w.kind === 'defect' && w.status !== 'done').map(w => w.id);
    const missingRuns = [cases.length && !lastDev ? 'dev' : null, (cases.length || scripts.length) && !lastUat ? 'uat' : null].filter(Boolean);
    const tname = id => caseIdx[id] ? dn(caseIdx[id].dataId) + ' · ' + (caseIdx[id].field || 'case') + ' (' + (caseIdx[id].kind || 'case') + ')'
      : scriptIdx[id] ? 'UAT script "' + (scriptIdx[id].title || 'untitled') + '"' : 'a test outside this project';
    const tp = failing.size === 0 && blocked.size === 0 && unrun.length === 0 && defects.length === 0 && missingRuns.length === 0 && noCases.length === 0;
    const tDetail = [];
    if (missingRuns.length) tDetail.push('No ' + joinList(missingRuns.map(e => e === 'dev' ? 'dev' : 'UAT')) + ' run has been recorded.');
    if (noCases.length) tDetail.push(joinList(noCases.map(dn)) + (noCases.length === 1 ? ' has' : ' have') + ' no test cases.');
    if (failing.size) tDetail.push(nWord(failing.size, 'test') + ' failed on its latest run: ' + joinList([...failing].map(tname), 3) + '.');
    if (blocked.size) tDetail.push(nWord(blocked.size, 'test') + ' ' + (blocked.size === 1 ? 'was' : 'were') + ' blocked on the latest UAT result: ' + joinList([...blocked].map(tname), 3) + '.');
    if (unrun.length) tDetail.push(nWord(unrun.length, 'test') + ' ' + (unrun.length === 1 ? 'was' : 'were') + ' never run in UAT: ' + joinList(unrun.map(tname), 3) + '.');
    if (defects.length) tDetail.push(nWord(defects.length, 'defect') + ' ' + isAre(defects.length) + ' still open: ' + joinList(defects.map(wt), 3) + '.');
    if (tp) tDetail.push(nWord(cases.length, 'data test case') + ' and ' + nWord(scripts.length, 'UAT script') + ' passed; no open defects.');
    checks.push({ id: 'tests-passed', label: 'Tests passed in dev and UAT', pass: tp, detail: tDetail.join(' '),
      items: [...new Set([...failing, ...blocked, ...unrun, ...defects, ...noCases])], failing: [...failing], blocked: [...blocked], unrun, defects, noCases, scripts: scripts.map(x => x.id) });

    // grants-closed: requested/approved block; active ones are expired automatically at go-live.
    const grants = list(docs, 'grant').filter(g => g.projectId === projectId);
    const gname = g => dn(g.dataId) + ' (' + String(g.env || '').toUpperCase() + ', ' + (g.access || 'access') + ')';
    const blockG = grants.filter(g => g.status === 'requested' || g.status === 'approved');
    const expG = grants.filter(g => g.status === 'active');
    checks.push({ id: 'grants-closed', label: 'Access grants closed', pass: blockG.length === 0,
      detail: (blockG.length ? 'Still ' + joinList([...new Set(blockG.map(g => g.status))]) + ': ' + joinList(blockG.map(gname)) + '. Deny, revoke or activate ' + (blockG.length === 1 ? 'it' : 'them') + ' first. ' : 'No pending access requests. ') +
        'Active grants expire automatically at go-live' + (expG.length ? ' (' + joinList(expG.map(gname)) + ').' : '.'),
      items: blockG.concat(expG).map(g => g.id), blocking: blockG.map(g => g.id), expiring: expG.map(g => g.id) });

    // bu-signoff: latest approval per BU approved with step-up and not stale.
    // The project owner's approvals never count (independence of evidence).
    const allApprovals = list(docs, 'approval').filter(a => a.projectId === projectId);
    const approvals = allApprovals.filter(a => !project.owner || a.approver !== project.owner);
    const ownerApprovals = allApprovals.length - approvals.length;
    const bus = [...new Set(steps.flatMap(x => stepBus(x.s)))].sort();
    const validFor = bu => {
      const latest = latestBy(approvals.filter(a => a.bu === bu), 'at');
      return latest && latest.decision === 'approved' && latest.stepUp === true ? latest : null;
    };
    const apprAt = a => String(a.snapshotAt || a.at || '');
    const changedSince = bu => {
      const a = validFor(bu); if (!a) return [];
      const t = apprAt(a), out = [];
      work.forEach(w => { if (w.updatedAt && String(w.updatedAt) > t && workBus(w).includes(bu)) out.push({ ref: 'workItem:' + w.id, label: w.title || 'untitled item' }); });
      procs.forEach(p => { if (p.updatedAt && String(p.updatedAt) > t && procBus(p).includes(bu)) out.push({ ref: 'process:' + p.id, label: 'the ' + (p.name || 'linked') + ' process' }); });
      return out;
    };
    const unsigned = bus.filter(bu => !validFor(bu));
    const stale = bus.filter(bu => validFor(bu)).map(bu => ({ bu, changed: changedSince(bu) })).filter(x => x.changed.length);
    const staleSet = new Set(stale.map(x => x.bu));
    const buDetail = [];
    if (!bus.length) buDetail.push('No business units own steps in the linked processes.');
    if (unsigned.length) buDetail.push('Waiting for sign-off from ' + joinList(unsigned) + '.');
    stale.forEach(x => buDetail.push(x.bu + ': re-approval needed: ' + joinList(x.changed.map(c => c.label)) + ' changed after sign-off.'));
    if (bus.length && !unsigned.length && !stale.length) buDetail.push('All ' + nWord(bus.length, 'business unit') + ' approved with step-up: ' + joinList(bus) + '.');
    if (ownerApprovals) buDetail.push('Approvals by the project owner (' + pn(project.owner) + ') do not count.');
    checks.push({ id: 'bu-signoff', label: 'Every business unit signed off', pass: bus.length > 0 && unsigned.length === 0 && stale.length === 0,
      detail: buDetail.join(' '), items: unsigned.concat(stale.map(x => x.bu)), unsigned, sections: bus, excludedApprover: project.owner || null,
      stale: stale.map(x => ({ bu: x.bu, changed: x.changed.map(c => c.ref), reason: 're-approval needed: ' + joinList(x.changed.map(c => c.label)) })) });

    // two-person: approved, non-stale approvals only (matches the sign-off panel).
    const current = bus.filter(bu => validFor(bu) && !staleSet.has(bu)).map(validFor);
    const approvers = [...new Set(current.map(a => a.approver))];
    checks.push({ id: 'two-person', label: 'Two-person rule', pass: approvers.length >= 2,
      detail: (approvers.length >= 2 ? 'Approved by ' + joinList(approvers.map(pn)) + '.'
        : approvers.length === 1 ? 'Only ' + pn(approvers[0]) + ' has a current approval; a second approver is needed.'
        : 'No current approvals; two different approvers are needed.') + (ownerApprovals ? ' The project owner (' + pn(project.owner) + ') does not count.' : ''), items: approvers });

    // cutover-plan
    const co = project.cutover || {};
    const coLabels = { tasks: 'a runbook task', rollbackOwner: 'rollback owner', rollbackPlan: 'rollback plan', hypercareOwner: 'hypercare owner' };
    const missingCo = Object.keys(coLabels).filter(k => k === 'tasks' ? !(Array.isArray(co.tasks) && co.tasks.length) : !(co[k] && String(co[k]).trim())); /* R4: runbook needs >= 1 task */
    checks.push({ id: 'cutover-plan', label: 'Cutover and rollback plan', pass: missingCo.length === 0,
      detail: missingCo.length ? capFirst(joinList(missingCo.map(k => coLabels[k]))) + ' ' + (missingCo.length === 1 ? 'is' : 'are') + ' not set.'
        : 'Rollback owner (' + pn(co.rollbackOwner) + '), rollback plan and hypercare owner (' + pn(co.hypercareOwner) + ') are set.', items: missingCo });

    // exceptions (warning only): work items and linked processes changed after the approval of a BU whose
    // section they touch. Items: work ids and "process:<id>". Stale ones block through bu-signoff.
    const excW = work.filter(w => w.updatedAt && workBus(w).some(bu => { const ap = validFor(bu); return ap && String(w.updatedAt) > apprAt(ap); }));
    const excP = procs.filter(p => p.updatedAt && procBus(p).some(bu => { const ap = validFor(bu); return ap && String(p.updatedAt) > apprAt(ap); }));
    const excNames = excW.map(w => '"' + (w.title || 'untitled item') + '"').concat(excP.map(p => 'the ' + (p.name || 'linked') + ' process'));
    checks.push({ id: 'exceptions', label: 'Changes after sign-off', pass: excNames.length === 0, warning: true,
      detail: excNames.length ? capFirst(joinList(excNames, 5)) + (excNames.length === 1 ? ' was' : ' were') + ' changed after sign-off; ' + (excNames.length === 1 ? 'its section needs' : 'those sections need') + ' re-approval.' : 'No work or process changed after sign-off.',
      items: excW.map(w => w.id).concat(excP.map(p => 'process:' + p.id)) });

    checks.forEach(finishCheck);
    // Sign-off opens only when every other blocking check passes.
    const signoffOpen = checks.filter(c => !c.warning && c.id !== 'bu-signoff' && c.id !== 'two-person').every(c => c.pass);
    return { pass: checks.filter(c => !c.warning).every(c => c.pass), checks, summary: summarize(checks), signoffOpen };
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
  // Masking: keep first and last char; digits→9, letters→x/X, punctuation and spaces kept.
  // Values of 1–2 chars are fully masked. If the result would equal the raw value, mask fully;
  // if that still equals it (e.g. "999"), replace with '*'.
  function maskValue(v) {
    const cs = chars(v);
    const full = cs.map(maskChar).join('');
    let m = cs.length <= 2 ? full : cs[0] + cs.slice(1, -1).map(maskChar).join('') + cs[cs.length - 1];
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
    return header.map((name, j) => {
      const vals = data.map(r => (r[j] == null ? '' : r[j]));
      const present = vals.filter(v => v.trim() !== '');
      const lens = present.map(v => chars(v).length);
      const classes = new Set(), specials = [];
      const pcount = {};
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
      });
      const col = {
        name, rows: vals.length, nulls: vals.length - present.length, distinct: new Set(present).size,
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
      col.patterns = Object.keys(pcount).map(p => ({ pattern: p, count: pcount[p] }))
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
    sp.values = Array.isArray(f.values) && f.values.length ? f.values.map(String)
      : (type === 'list' && / \/ /.test(fmt) ? fmt.split('/').map(x => x.trim()).filter(Boolean) : null);
    return sp;
  }
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
      const rows = col.rows != null ? +col.rows : docRows != null ? docRows : nulls + (col.patterns || []).reduce((a, p) => a + (p.count || 0), 0);
      const filled = rows - nulls;
      const hasHave = n => (n === 1 ? 'has' : 'have');
      if (sp.required && nulls > 0) out.push({ field: f.name, issue: 'required-nulls', detail: nulls + ' of ' + rows + ' ' + N(rows) + ' ' + isAre(nulls) + ' empty; the spec says ' + N(1) + ' is required.' });
      if (filled <= 0) continue;
      const pats = col.patterns || [];
      const isDigitsPat = p => /^9(\{\d+\})?$/.test(p);
      if (sp.length != null && (col.minLen !== sp.length || col.maxLen !== sp.length)) {
        const groups = {};
        pats.forEach(p => { const L = chars(expandPattern(p.pattern)).length; if (L !== sp.length) { const k = L + (isDigitsPat(p.pattern) ? ' digits' : ' characters'); groups[k] = (groups[k] || 0) + p.count; } });
        const unit = sp.type === 'digits' ? ' digits' : ' characters';
        const parts = Object.keys(groups).map(k => groups[k] + ' of ' + rows + ' ' + N(rows) + ' ' + hasHave(groups[k]) + ' ' + k);
        out.push({ field: f.name, issue: 'length-mismatch', detail: (parts.length ? parts.join('; ') : capFirst(N(2)) + ' range from ' + col.minLen + ' to ' + col.maxLen + unit) + '; the spec says ' + sp.length + (parts.length ? '' : unit) + '.' });
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
      const offText = off => off.map(p => p.count + ' of ' + rows + ' ' + N(rows) + ' ' + (p.count === 1 ? 'looks' : 'look') + ' like ' + humanPattern(p.pattern)).join('; ');
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
  function strOfLen(sp, n) { return sp.type === 'digits' ? digitsOf(n) : textOf(n); }
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

  function generateTests(dataElement, profile) {
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
      } else {
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
      if (hi != null) add(f, 'invalid', strOfLen(sp, hi + 5), 'reject', 'spec', 'Too long');
      if (sp.required) add(f, 'invalid', '', 'reject', 'spec', 'Empty but required');

      // Routing numbers: ABA checksum-valid values and a checksum-invalid one.
      if (sp.aba) {
        const v2 = abaFrom('31415926');
        add(f, 'valid', v2, ok(v2), 'spec', 'Valid ABA checksum');
        const bad = valid.slice(0, 8) + String((+valid[8] + 1) % 10);
        add(f, 'invalid', bad, 'reject', 'spec', 'Nine digits but the ABA checksum fails');
      }

      // Free-text fields: special characters.
      if (sp.type === 'text' && !sp.values && !sp.mask && !sp.regex && sp.length == null)
        SPECIAL_TEXT.forEach(([input, what]) => add(f, 'edge', input, ok(input), 'spec', 'Special characters: ' + what));

      // Cross-field rules (expectation depends on the other field, given in `context`).
      const cr = crossRule(f, de.fields || []);
      if (cr) {
        const isDate_ = sp.type === 'date';
        const x = isDate_ ? '2026-01-10' : 'Northwind Supply Co', y = isDate_ ? '2026-01-20' : 'Northwind Supply Company';
        const say = 'Cross-field: ' + cr.rule.trim();
        if (cr.rel === 'equal') { add(f, 'valid', x, 'accept', 'spec', say + ' (same value)', { [cr.other]: x }); add(f, 'invalid', x, 'reject', 'spec', say + ' (different value)', { [cr.other]: y }); }
        else if (cr.rel === 'differ') { add(f, 'valid', x, 'accept', 'spec', say + ' (different value)', { [cr.other]: y }); add(f, 'invalid', x, 'reject', 'spec', say + ' (same value)', { [cr.other]: x }); }
        else if (cr.rel === 'before') { add(f, 'valid', x, 'accept', 'spec', say + ' (earlier)', { [cr.other]: y }); add(f, 'invalid', y, 'reject', 'spec', say + ' (later)', { [cr.other]: x }); }
        else { add(f, 'valid', y, 'accept', 'spec', say + ' (later)', { [cr.other]: x }); add(f, 'invalid', x, 'reject', 'spec', say + ' (earlier)', { [cr.other]: y }); }
      }

      // Profile edge cases
      const col = columnFor(f, cols);
      if (!col) continue;
      (col.specials || []).forEach(c => {
        const base = chars(valid);
        const input = base.length > 1 ? base[0] + c + base.slice(1).join('') : base.join('') + c;
        add(f, 'edge', input, ok(input), 'profile', 'Observed special character "' + c + '"');
      });
      // One case per observed shape (top patterns), reproduced synthetically: e.g. an 8-digit routing number.
      (col.patterns || []).forEach(pt => {
        // Digits shifted by one so a shape case never collides with (and is deduped into) a spec case.
        let input = expandPattern(pt.pattern).replace(/[0-9]/g, c => String((+c + 1) % 10));
        if (sp.aba && /^\d{9}$/.test(input)) input = abaFrom(input.slice(0, 8));
        add(f, 'edge', input, ok(input), 'profile', 'Observed shape: ' + humanPattern(pt.pattern) + ' (' + pt.count + ' of ' + (col.rows != null ? col.rows : '?') + ' rows)');
      });
      if (col.maxLen > 0) {
        const top = (col.patterns || []).map(p => expandPattern(p.pattern)).find(s => chars(s).length === col.maxLen);
        const input = top || strOfLen(sp, col.maxLen);
        add(f, 'edge', input, ok(input), 'profile', 'Longest observed length (' + col.maxLen + ')');
      }
      const numericCol = (col.patterns || []).some(p => /^9/.test(p.pattern));
      if (sp.type === 'digits' || sp.type === 'number' || sp.type === 'currency' || numericCol) {
        const input = sp.aba ? abaFrom('0' + valid.slice(1, 8)) : sp.type === 'digits' || sp.mask ? '0' + chars(valid).slice(1).join('') : '0' + valid;
        add(f, 'edge', input, ok(input), 'profile', 'Leading zero');
      }
      if ((col.charClasses || []).includes('unicode')) {
        const input = 'Zoë Ñandú';
        add(f, 'edge', input, ok(input), 'profile', 'Unicode characters observed in the extract');
      }
      if (col.nulls > 0) add(f, 'edge', '', ok(''), 'profile', 'Empty values observed (' + col.nulls + ')');
    }
    return out;
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
  function suggestWorkFromDiff(docs, projectId, today) {
    const project = get(docs, 'project', projectId);
    if (!project) return [];
    const work = list(docs, 'workItem');
    const data = byId(list(docs, 'dataElement'));
    const av = availMap(docs);
    const fc = forecastAll(docs, today);
    const anchorRaw = isDate(today) ? today : maxDate(work.filter(w => w.projectId === projectId).map(w => w.due));
    const anchor = anchorRaw ? addBusinessDays(anchorRaw, 0) : null;
    const out = [], resolverKey = {};
    let n = 0;
    const finishOf = dep => {
      const sg = out.find(x => x.key === dep); if (sg) return sg.due;
      const w = work.find(x => x.id === dep);
      return w ? (w.status === 'done' ? (w.doneAt || w.due) : fc[w.id] && fc[w.id].forecast) : null;
    };
    const push = sg => {
      sg.key = 'sug-' + (++n);
      sg.effortDays = 2;
      if (anchor) { sg.start = addBusinessDays(maxDate([anchor].concat(sg.deps.map(finishOf))), 0); sg.due = addBusinessDays(sg.start, sg.effortDays); }
      else { sg.start = null; sg.due = null; }
      out.push(sg);
      return sg;
    };
    const hasWork = (pid, nodeId) => work.some(w => w.projectId === projectId && w.pid === pid && w.step === nodeId);
    const resolversFor = (p, st) => {
      const needs = [];
      stepData(st).forEach(d => {
        const de = data[d];
        const eff = av[d] || 'missing';
        if (!de || eff === 'live') return;
        const existing = work.find(w => w.resolves === d);
        if (existing) { if (existing.status !== 'done') needs.push(existing.id); return; }
        if (!resolverKey[d]) {
          const sg = push({ pid: p.id, step: st.id, title: (eff === 'example' ? 'Connect a live source for ' + (de.name || 'data element') : 'Make ' + (de.name || 'data element') + ' available'),
            kind: 'build', owner: de.owner || st.owner || null, deps: [], resolves: d });
          resolverKey[d] = sg.key;
        }
        needs.push(resolverKey[d]);
      });
      return [...new Set(needs)];
    };
    linkedProcesses(docs, project).forEach(p => {
      const diff = diffProcess(p);
      const visit = nodes => (nodes || []).forEach(nd => {
        if (!nd) return;
        if (isGateway(nd)) {
          const st = diff.nodes[nd.id];
          if ((st === 'new' || st === 'changed') && !hasWork(p.id, nd.id)) {
            const firstStep = flatSteps((nd.branches || []).flatMap(b => (b && b.nodes) || []))[0];
            push({ pid: p.id, step: nd.id, title: (nd.type === 'parallel' ? 'Set up parallel branches: ' : 'Configure routing: ') + (nd.title || 'untitled gateway'),
              kind: 'build', owner: (firstStep && firstStep.owner) || p.owner || null, deps: [] });
          }
          (nd.branches || []).forEach(b => visit(b && b.nodes));
          return;
        }
        if (!isStep(nd)) return;
        const needs = resolversFor(p, nd);
        const st = diff.nodes[nd.id];
        if ((st === 'new' || st === 'changed') && !hasWork(p.id, nd.id))
          push({ pid: p.id, step: nd.id, title: (st === 'new' ? 'Stand up new step: ' : 'Implement changes: ') + (nd.title || 'untitled step'), kind: 'build', owner: nd.owner || null, deps: needs });
      });
      visit(p.tobe);
    });
    return out;
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

  return {
    // contract section 4
    flatSteps, diffProcess, forecastAll, stepState, dataReady, dependents, impactOfData,
    projectStats, readiness, profileCsv, specDrift, generateTests, workload, baselineVariance, suggestWorkFromDiff,
    generateUatScripts, flatGateways, effectiveAvail, diffSummary, criticalPath, humanPattern,
    explainForecast, sprints, sprintOf, addBusinessDays, businessDaysBetween,
    // helpers (stable, safe to use from pages)
    parseCsv, maskValue, patternOf, expandPattern, fieldSpec, validate, addDays, diffDays,
  };
});
