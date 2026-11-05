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
    const ctx = availCtx(docs);
    list(docs, 'dataElement').forEach(d => { m[d.id] = availOf(d, work, docs, ctx); });
    return m;
  }
  // R8: information that appears on any Today (as-is) step, and the owner of each piece of information
  // (data.owner, else the owner of the first to-be step that uses it: "new information's owner is the step's owner").
  function availCtx(docs) {
    const asis = new Set(), stepOwner = {};
    list(docs, 'process').forEach(p => {
      flatSteps(p.asis).forEach(st => stepData(st).forEach(d => asis.add(d)));
      flatSteps(p.tobe).forEach(st => stepData(st).forEach(d => { if (!stepOwner[d] && st.owner) stepOwner[d] = st.owner; }));
    });
    return { asis, stepOwner };
  }
  function dataOwnerOf(docs, d, ctx) { return !d ? null : d.owner || ((ctx || availCtx(docs)).stepOwner[d.id] || null); }
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
    // "Causing slip": an item whose forecast is the binding reason a dependent finishes after its due date.
    work.forEach(w => { const r = out[w.id]; if (r.via && r.forecast && isDate(w.due) && r.forecast > w.due && out[r.via]) out[r.via].causesSlip = true; });
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
      needsLive: step ? (step.data || []).filter(d => { const e = effectiveAvail(docs, d); return e === 'example' || e === 'pending'; }) : [],
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
      late: items.filter(w => fc[w.id].sched === 'late').length,
      slip: items.filter(w => fc[w.id].sched === 'slip').length,
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
      if (st !== 'missing' && st !== 'example') return;
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
  // R8 schedule truth (the single status rule). rag/label:
  //   red   "At risk"  = the forecast finish misses the deadline, or an unplanned blocker exists;
  //   amber "On track, some tasks running late" = otherwise, when any open task is late or running late;
  //   green "On track"; grey "Not planned" (no work). Late = open and due before today (due today is not late).
  //   bufferDays = business days from the forecast (or actual) finish to the deadline.
  function scheduleCore(docs, project, today, fc) {
    fc = fc || forecastAll(docs, today);
    const items = project ? list(docs, 'workItem').filter(w => w.projectId === project.id) : [];
    const open = items.filter(w => w.status !== 'done');
    const allDone = items.length > 0 && !open.length;
    const finish = allDone ? maxDate(items.map(w => w.doneAt || w.due)) : maxDate(open.map(w => fc[w.id] && fc[w.id].forecast));
    const target = project && isDate(project.target) ? project.target : null;
    const bufferDays = target && finish ? businessDaysBetween(finish, target) : null;
    const late = open.filter(w => fc[w.id] && fc[w.id].sched === 'late').map(w => w.id);
    const runningLate = open.filter(w => fc[w.id] && fc[w.id].sched === 'slip').map(w => w.id);
    const blockers = project ? blockersOf(docs, project, items) : [];
    const unplanned = blockers.filter(b => !b.planned);
    const misses = !!(target && finish && finish > target);
    const reasons = [];
    let rag;
    if (!items.length) { rag = 'grey'; reasons.push('Not planned: no work yet'); }
    else if (misses || unplanned.length) {
      rag = 'red';
      if (misses) reasons.push('Forecast finish ' + fmtDay(finish) + ' is after the ' + fmtDay(target) + ' deadline');
      if (unplanned.length) reasons.push(joinList(unplanned.map(b => b.name), 3) + ' ' + isAre(unplanned.length) + ' not available yet and no work is planned to get ' + (unplanned.length === 1 ? 'it' : 'them'));
    } else if (late.length || runningLate.length) {
      rag = 'amber';
      if (late.length) reasons.push(nWord(late.length, 'task') + ' late' + (target ? ', but the finish still meets the deadline' : ''));
      if (runningLate.length) reasons.push(nWord(runningLate.length, 'task') + ' running late' + (target && !late.length ? ', but the finish still meets the deadline' : ''));
    } else {
      rag = 'green';
      reasons.push(allDone ? (blockers.length ? 'Every task is finished, but ' + nWord(blockers.length, 'piece') + ' of information ' + isAre(blockers.length) + ' not available yet' : 'All work done')
        : bufferDays == null ? 'On track; no deadline set' : 'On track: ' + nWord(bufferDays, 'business day') + ' of buffer');
    }
    return { project, items, open, allDone, finish, target, bufferDays, late, runningLate, blockers, rag, label: RAG_LABEL[rag], reasons, fc };
  }
  function healthOf(docs, project, items, fc, finish, allDone, today) {
    const c = scheduleCore(docs, project, today, fc);
    return { rag: c.rag, label: c.label, reasons: c.reasons };
  }
  function projectHealth(docs, projectId, today) {
    const c = scheduleCore(docs, projOf(docs, projectId), today);
    return { rag: c.rag, label: c.label, reasons: c.reasons, bufferDays: c.bufferDays };
  }

  // R6 one schedule badge per item, by priority: late > causing slip > slipping > due soon > on track.
  // R8 plain words (no "slip"): keys are unchanged.
  const BADGE_LABEL = { done: 'Done', late: 'Late', causing: 'Holding up other work', slipping: 'Running late', soon: 'Due soon', ontrack: 'On track' };
  function badgeOf(w, r) {
    let key;
    if (!w || !r) key = 'ontrack';
    else if (w.status === 'done') key = 'done';
    else if (r.sched === 'late') key = 'late';
    else if (r.causesSlip) key = 'causing';
    else if (r.sched === 'slip') key = 'slipping';
    else if (r.sched === 'soon') key = 'soon';
    else key = 'ontrack';
    return { key, label: BADGE_LABEL[key] };
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
  // definitions, tests or launch-day tasks changed. Format "s:<h>;d:<h>;t:<h>;c:<h>".
  function sectionParts(docs, project, bu) {
    const people = personMap(docs);
    const { stepBus } = sectionHelpers(people);
    const stepsOut = [];
    linkedProcesses(docs, project).forEach(p => allNodes(p.tobe).forEach(n => {
      if (!n || isGateway(n) || n.type === 'end') return;
      if (!stepBus(n).includes(bu)) return;
      stepsOut.push({ pid: p.id, id: n.id, title: n.title || '', type: n.type || '', owner: n.owner || '', data: stepData(n).slice().sort(),
        touches: (n.touches || []).map(String).sort(), subs: (n.subs || []).map(x => x && x.title || ''), sla: n.sla == null ? '' : n.sla, system: n.system || '', calls: n.calls || '' });
    }));
    const dataIds = [...new Set(stepsOut.flatMap(x => x.data))].sort();
    const dataOut = dataIds.map(id => { const d = get(docs, 'dataElement', id) || {}; return { id, name: d.name || '', fields: d.fields || [] }; });
    const testsOut = list(docs, 'testCase').filter(c => dataIds.includes(c.dataId)).map(c => ({ id: c.id, dataId: c.dataId, field: c.field || '', kind: c.kind || '', input: c.input == null ? '' : c.input, expect: c.expect || '' }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const tasks = (project.cutover && Array.isArray(project.cutover.tasks) ? project.cutover.tasks.filter(Boolean) : []).filter(t => taskBu(people, t) === bu)
      .map(t => ({ id: t.id || '', task: t.task || t.title || '', owner: t.owner || '', gonogo: !!t.gonogo, order: t.order == null ? '' : t.order, plannedStart: t.plannedStart || '', durationMins: t.durationMins == null ? '' : t.durationMins }));
    return { s: hashStr(JSON.stringify(stepsOut)), d: hashStr(JSON.stringify(dataOut)), t: hashStr(JSON.stringify(testsOut)), c: hashStr(JSON.stringify(tasks)) };
  }
  function fpString(parts) { return 's:' + parts.s + ';d:' + parts.d + ';t:' + parts.t + ';c:' + parts.c; }
  function fpParse(str) { const out = {}; String(str || '').split(';').forEach(x => { const m = /^([sdtc]):(.*)$/.exec(x); if (m) out[m[1]] = m[2]; }); return out; }
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
    const examples = usedData.filter(d => av[d] === 'example');
    const pendingD = usedData.filter(d => av[d] === 'pending');
    const dl = [];
    if (missing.length) dl.push(joinList(missing.map(dn)) + ' ' + isAre(missing.length) + ' missing.');
    if (examples.length) dl.push(joinList(examples.map(dn)) + ' ' + (examples.length === 1 ? 'has' : 'have') + ' examples only and need' + (examples.length === 1 ? 's' : '') + ' a live source before go-live.');
    pendingD.forEach(d => {
      const ev = evidenceOf(docs, dataIdx[d]);
      dl.push(dn(d) + (ev && !ev.ok && ev.reason ? ': live evidence does not hold (' + ev.reason + '); awaiting ' : ': fix done, awaiting ') + pn(dataIdx[d] && dataIdx[d].owner) + ' to confirm it is live with evidence.');
    });
    const attested = usedData.filter(d => av[d] === 'live' && (evidenceOf(docs, dataIdx[d]) || {}).type === 'attested');
    if (attested.length) dl.push(joinList(attested.map(dn)) + ' ' + (attested.length === 1 ? 'is' : 'are') + ' live on attested evidence only (a link and a note), which is weaker than a profile or connection check.');
    if (!dl.length) dl.push('All ' + nWord(usedData.length, 'data element') + ' ' + isAre(usedData.length) + ' live.');
    checks.push({ id: 'data-live', label: 'Required data is live', pass: !missing.length && !examples.length && !pendingD.length, soft: attested.length > 0, detail: dl.join(' '),
      items: missing.concat(examples, pendingD), missing, examples, pending: pendingD, attested,
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
    const changedSet = new Set(changedInformation(docs, project).map(x => x.dataId));
    const usedSet = changedSet;
    const cases = list(docs, 'testCase').filter(c => usedSet.has(c.dataId));
    const caseIdx = byId(cases);
    const scripts = (Array.isArray(project.uatScripts) ? project.uatScripts : generateUatScripts(docs, projectId))
      .concat(Array.isArray(project.uatScenarios) ? project.uatScenarios : []);
    const scriptIdx = byId(scripts);
    const runs = list(docs, 'testRun').filter(r => r.projectId === projectId);
    const lastDev = latestBy(runs.filter(r => r.env === 'dev'), 'at');
    const lastUat = latestBy(runs.filter(r => r.env === 'uat'), 'at');
    const rid = x => x.caseId || x.scriptId;
    const noEvidence = new Set(), skipped = new Set();
    const latestPerItem = env => {
      const m = {};
      runs.filter(r => r.env === env).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
        .forEach(r => (r.results || []).forEach(x => {
          const k = rid(x); if (!k) return;
          if (x.outcome === 'not-run' || x.outcome === 'skipped') { if (!m[k]) skipped.add(env + ':' + k); return; }
          if (x.scriptId && x.outcome === 'pass' && r.source !== 'ci' && !String(x.evidence || '').trim()) { noEvidence.add(k); return; }
          m[k] = x.outcome; skipped.delete(env + ':' + k);
        }));
      return m;
    };
    const byEnv = {};
    ENVS.forEach(env => { byEnv[env] = latestPerItem(env); });
    const sysRuns = runs.filter(r => stageOfEnv(r.env) === 'system');
    const sysOut = {}, anyOut = {};
    runs.slice().sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))).forEach(r => (r.results || []).forEach(x => {
      const k = rid(x); if (!k || x.outcome === 'not-run' || x.outcome === 'skipped') return;
      if (x.scriptId && x.outcome === 'pass' && r.source !== 'ci' && !String(x.evidence || '').trim()) return;
      if (stageOfEnv(r.env) === 'system') sysOut[k] = x.outcome;
      if (stageOfEnv(r.env)) anyOut[k] = x.outcome;
    }));
    const failing = new Set(), blocked = new Set();
    Object.keys(sysOut).forEach(k => { if (sysOut[k] === 'fail') failing.add(k); });
    const uatOut = byEnv.uat;
    const coveredUat = new Set(Object.keys(uatOut));
    Object.keys(uatOut).forEach(k => { if (uatOut[k] === 'fail') failing.add(k); else if (uatOut[k] === 'blocked') blocked.add(k); });
    const unrun = cases.map(c => c.id).concat(scripts.map(x => x.id)).filter(id => !coveredUat.has(id));
    const changedData = usedData.filter(d => changedSet.has(d));
    const noCases = changedData.filter(d => !cases.some(c => c.dataId === d));
    const uncoveredFields = [];
    changedData.forEach(d => ((dataIdx[d] && dataIdx[d].fields) || []).forEach(f => {
      const k = tokens(f.name);
      if (!cases.some(c => c.dataId === d && c.kind !== 'custom' && tokens(c.field) === k)) uncoveredFields.push({ dataId: d, field: f.name });
    }));
    const defects = work.filter(w => w.kind === 'defect' && w.status !== 'done').map(w => w.id);
    const missingRuns = [cases.length && !sysRuns.length ? 'system' : null, (cases.length || scripts.length) && !lastUat ? 'uat' : null].filter(Boolean);
    const tname = id => caseIdx[id] ? dn(caseIdx[id].dataId) + ' ' + (caseLabel(docs, id) || 'case') + ' · ' + (caseIdx[id].field || 'case') + ' (' + (caseIdx[id].kind || 'case') + ')'
      : scriptIdx[id] ? 'UAT script "' + (scriptIdx[id].title || 'untitled') + '"' : 'a test outside this project';
    const tp = failing.size === 0 && blocked.size === 0 && unrun.length === 0 && defects.length === 0 && missingRuns.length === 0 && noCases.length === 0 && uncoveredFields.length === 0;
    const skippedIds = [...new Set([...skipped].map(x => x.slice(x.indexOf(':') + 1)))];
    const tDetail = [];
    if (missingRuns.length) tDetail.push('No ' + joinList(missingRuns.map(e => e === 'system' ? 'system test ("Try it out")' : 'UAT (business sign-off)')) + ' run has been recorded.');
    if (noCases.length) tDetail.push(joinList(noCases.map(dn)) + (noCases.length === 1 ? ' has' : ' have') + ' no test cases.');
    if (uncoveredFields.length) tDetail.push(nWord(uncoveredFields.length, 'spec field') + ' ' + (uncoveredFields.length === 1 ? 'has' : 'have') + ' no test case: ' + joinList(uncoveredFields.map(x => dn(x.dataId) + ' · ' + x.field), 4) + '.');
    if (failing.size) tDetail.push(nWord(failing.size, 'test') + ' failed on its latest run: ' + joinList([...failing].map(tname), 3) + '.');
    if (blocked.size) tDetail.push(nWord(blocked.size, 'test') + ' ' + (blocked.size === 1 ? 'was' : 'were') + ' blocked on the latest UAT result: ' + joinList([...blocked].map(tname), 3) + '.');
    if (unrun.length) tDetail.push(nWord(unrun.length, 'test') + ' ' + (unrun.length === 1 ? 'was' : 'were') + ' never run in UAT: ' + joinList(unrun.map(tname), 3) + '.');
    if (skippedIds.length) tDetail.push(nWord(skippedIds.length, 'test') + ' skipped.');
    if (noEvidence.size) tDetail.push(nWord(noEvidence.size, 'UAT script pass') + ' had no evidence and ' + (noEvidence.size === 1 ? 'does' : 'do') + ' not count.');
    if (defects.length) tDetail.push(nWord(defects.length, 'defect') + ' ' + isAre(defects.length) + ' still open: ' + joinList(defects.map(wt), 3) + '.');
    if (tp) tDetail.push(nWord(cases.length, 'data test case') + ' and ' + nWord(scripts.length, 'UAT script') + ' passed; no open defects.');
    const envSummary = {};
    ENVS.forEach(env => {
      const o = byEnv[env], sm = { pass: 0, fail: 0, blocked: 0, skipped: 0 };
      Object.keys(o).forEach(k => { if (sm[o[k]] != null) sm[o[k]]++; });
      sm.skipped = [...skipped].filter(x => x.startsWith(env + ':')).length;
      envSummary[env] = sm;
    });
    const allTests = cases.map(c => c.id).concat(scripts.map(x => x.id));
    const stages = {
      system: { key: 'system', label: 'Try it out', total: cases.length, run: sysRuns.length > 0, passed: cases.filter(c => sysOut[c.id] === 'pass').length,
        failed: cases.filter(c => sysOut[c.id] === 'fail').length },
      uat: { key: 'uat', label: 'Business sign-off', total: allTests.length, run: !!lastUat, passed: allTests.filter(id => uatOut[id] === 'pass').length,
        failed: allTests.filter(id => uatOut[id] === 'fail').length, blocked: allTests.filter(id => uatOut[id] === 'blocked').length },
    };
    stages.system.done = !cases.length || (stages.system.run && !stages.system.failed);
    stages.uat.done = !allTests.length || stages.uat.passed === allTests.length;
    checks.push({ id: 'tests-passed', label: 'Tests passed', pass: tp, detail: tDetail.join(' '),
      total: allTests.length, passed: allTests.filter(id => anyOut[id] === 'pass').length, stages, changedData, cases: cases.map(c => c.id),
      items: [...new Set([...failing, ...blocked, ...unrun, ...defects, ...noCases])], failing: [...failing], blocked: [...blocked], unrun, defects, noCases,
      uncoveredFields, skipped: skippedIds, noEvidence: [...noEvidence], byEnv: envSummary, scripts: scripts.map(x => x.id) });

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
    // The release manager (defaults to the owner) is excluded too (separation of duties).
    // R7: approvals count any time (no lock behind the other checks); staleness is scoped per section.
    const releaseManager = project.releaseManager || project.owner || null;
    const excluded = [...new Set([project.owner, releaseManager].filter(Boolean))];
    const allApprovals = list(docs, 'approval').filter(a => a.projectId === projectId);
    const approvals = allApprovals.filter(a => !excluded.includes(a.approver));
    const ownerApprovals = allApprovals.length - approvals.length;
    // R8: only teams whose part changed (new/changed steps, changed triggers) or who own launch-plan tasks approve.
    const bus = sectionBus(docs, project, people);
    // R7 eligibility: BU members other than the PM and launch owner, plus project.approvers[bu] (never the PM or
    // launch owner). A section with nobody eligible needs an approver chosen; suggestion = the process owner.
    const validForRaw = bu => {
      const latest = latestBy(approvals.filter(a => a.bu === bu), 'at');
      return latest && latest.decision === 'approved' && latest.stepUp === true ? latest : null;
    };
    const overrides = project.approvers && typeof project.approvers === 'object' ? project.approvers : {};
    const eligible = {};
    bus.forEach(bu => {
      const e = Object.keys(people).filter(id => people[id] && people[id].bu === bu && !excluded.includes(id));
      const o = overrides[bu];
      if (o && people[o] && !excluded.includes(o) && !e.includes(o)) e.push(o);
      eligible[bu] = e;
    });
    const needsApprover = bus.filter(bu => !eligible[bu].length && !validForRaw(bu));
    const suggestions = {};
    needsApprover.forEach(bu => {
      const p = procs.find(pp => allNodes(pp.tobe).some(n => n && !isGateway(n) && stepBus(n).includes(bu)));
      const cand = [p && p.owner].concat(procs.map(pp => pp.owner)).find(id => id && people[id] && !excluded.includes(id));
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
        ['s', 'd', 't'].forEach(k => { if (was[k] != null && was[k] !== now[k]) out.push({ ref: 'section:' + bu + '#' + k, label: PART_LABEL[k] }); });
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
    if (!bus.length) buDetail.push('No business units own steps in the linked processes.');
    needsApprover.forEach(b => buDetail.push('No approver in ' + b + ': assign one.' + (suggestions[b] && pnSafe(suggestions[b]) ? ' Suggested: ' + pnSafe(suggestions[b]) + '.' : '')));
    if (unsigned.length) buDetail.push('Waiting for sign-off from ' + joinList(unsigned) + '.');
    stale.forEach(x => buDetail.push(x.bu + ': re-approval needed: ' + joinList(x.changed.map(c => c.label)) + ' changed after sign-off.'));
    if (bus.length && !unsigned.length && !stale.length && !needsApprover.length) buDetail.push('All ' + nWord(bus.length, 'business unit') + ' approved with step-up: ' + joinList(bus) + '.');
    const exclNames = joinList(excluded.map(pn));
    const exclRole = excluded.length > 1 ? 'the project owner and release manager' : releaseManager === project.owner ? 'the project owner' : 'the release manager';
    if (ownerApprovals) buDetail.push('Approvals by ' + exclRole + ' (' + exclNames + ') do not count.');
    // Launch owner's own check: the launch-day plan changed after the latest current approval (informational).
    const currentAts = bus.filter(bu => validFor(bu) && !staleSet.has(bu)).map(bu => apprAt(validFor(bu))).sort();
    const coAt = [project.cutoverUpdatedAt].concat(coTasks.map(x => x.updatedAt)).filter(Boolean).map(String).sort().pop() || null;
    const launchOwnerReview = { person: releaseManager, needed: !!(coAt && currentAts.length && coAt > currentAts[currentAts.length - 1]) };
    const sectionStatus = bus.map(bu => ({ bu, approved: !!validFor(bu), approval: validFor(bu) ? validFor(bu).id || null : null, stale: staleSet.has(bu),
      needsApprover: needsApprover.includes(bu), eligible: eligible[bu].slice(), suggestion: suggestions[bu] || null, override: overrides[bu] || null }));
    checks.push({ id: 'bu-signoff', label: 'Every business unit signed off', pass: bus.length > 0 && unsigned.length === 0 && stale.length === 0 && needsApprover.length === 0,
      detail: buDetail.join(' '), items: needsApprover.concat(unsigned, stale.map(x => x.bu)), unsigned, noPerson, needsApprover, eligible, suggestions, sectionStatus, launchOwnerReview,
      sections: bus, excludedApprover: project.owner || null, excludedApprovers: excluded, releaseManager,
      stale: stale.map(x => ({ bu: x.bu, changed: x.changed.map(c => c.ref), reason: 're-approval needed: ' + joinList(x.changed.map(c => c.label)) })) });

    // two-person: approved, non-stale approvals only (matches the sign-off panel).
    const current = bus.filter(bu => validFor(bu) && !staleSet.has(bu)).map(validFor);
    const approvers = [...new Set(current.map(a => a.approver))];
    checks.push({ id: 'two-person', label: 'Two-person rule', pass: approvers.length >= 2,
      detail: (approvers.length >= 2 ? 'Approved by ' + joinList(approvers.map(pn)) + '.'
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
    checks.push({ id: 'cutover-plan', label: 'Cutover and rollback plan', pass: !missingCo.length && tasks.length > 0 && !gonogoNoOwner.length,
      detail: coDetail.join(' '), items: missingCo.concat(tasks.length ? [] : ['tasks'], gonogoNoOwner.map(x => 'task:' + (x.id || x.task || x.step || ''))) });

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
    const excS = excList.filter(c => c.ref.startsWith('section:'));
    const excNames = excW.map(c => '"' + c.label + '"').concat(excP.map(c => c.label), excS.map(c => c.ref.slice(8, c.ref.indexOf('#')) + "'s " + c.label.replace(/^its /, '')));
    const exDetail = [];
    if (excNames.length) exDetail.push(capFirst(joinList(excNames, 5)) + (excNames.length === 1 ? ' was' : ' were') + ' changed after sign-off; ' + (excNames.length === 1 ? 'its section needs' : 'those sections need') + ' re-approval.');
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
    checks.push({ id: 'exceptions', label: 'Changes after sign-off', pass: excNames.length === 0 && cutoverBus.length === 0 && overdueTasks.length === 0, warning: true,
      detail: exDetail.length ? exDetail.join(' ') : 'No work or process changed after sign-off.',
      items: excW.map(c => c.ref.slice('workItem:'.length)).concat(excP.map(c => c.ref), excS.map(c => c.ref), cutoverBus.length ? ['cutover'] : [], overdueTasks.map(t => 'task:' + (t.id || t.task || ''))),
      cutoverBus, overdueTasks: overdueTasks.map(t => t.id || t.task || '') });

    checks.forEach(finishCheck);
    // R7: signoffOpen is informational only (every other blocking check passes); approvals count any time.
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
    if (/ (name|holder|payee|contact) /.test(t)) return 'name';
    if (/ (id|ids|number|no|num|code|ref|reference|account|iban|swift|bic|ein|ssn|tin|sku) /.test(t)) return 'id';
    if (/ (vendor|company|supplier|bank) /.test(t)) return 'name';
    return 'text';
  }
  const SEM_SAMPLE = { email: 'ap@northwind.example', phone: '+1 555 0142', postal: '75201', address: '125 Harbor Way, Suite 4',
    city: 'Lakeview', id: 'NW100245', name: 'Northwind Supply Co', text: 'Standard terms apply' };
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
        const bad = outlier(pt);
        add(f, 'edge', input, bad ? 'reject' : ok(input), 'profile', 'Observed shape: ' + humanPattern(pt.pattern) + ' (' + pt.count + ' of ' + colRows(col, profile) + ' rows)' + (bad && ok(input) === 'accept' ? '; unlike most values, so it should be rejected' : ''));
      });
      if (col.maxLen > 0 && !sp.values && sp.type !== 'file') {
        // Built to be otherwise valid for the spec, so the expectation is decided by length alone.
        const input = specValidOfLen(sp, col.maxLen);
        add(f, 'edge', input, ok(input), 'profile', 'Longest observed length (' + col.maxLen + ')');
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
      if (col.nulls > 0) add(f, 'edge', '', ok(''), 'profile', 'Empty values observed (' + col.nulls + ')');
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
        const other = specDrift({ fields: [f] }, { rows, columns: [Object.assign({}, col, { name: col.name })] })
          .filter(x => x.field === f.name && !['length-mismatch', 'required-nulls', 'unspecified-column', 'missing-column'].includes(x.issue));
        if (other.length && !shortN && !longN) bits.push('some do not match the rules');
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
  const SUGGEST_EFFORT = 3;
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
      sg.effortDays = SUGGEST_EFFORT;
      out.push(sg);
      return sg;
    };
    // R6 dates: an item with no open dependency ("can start now") starts on the anchor (today); otherwise the
    // business day after its latest dependency finishes (FS). Spans = effortDays stretched by one factor (1–2×)
    // so the chain spreads toward the target while keeping a buffer of max(5, 15%) business days before it.
    const schedule = factor => {
      const span = Math.max(1, Math.round(SUGGEST_EFFORT * factor));
      out.forEach(sg => {
        if (!anchor) { sg.start = null; sg.due = null; return; }
        const fins = sg.deps.map(finishOf).filter(isDate);
        sg.start = fins.length ? maxDate([anchor, addBusinessDays(maxDate(fins), 1)]) : anchor;
        sg.due = addBusinessDays(sg.start, span);
      });
    };
    const hasWork = (pid, nodeId) => work.some(w => w.projectId === projectId && w.pid === pid && w.step === nodeId);
    const resolversFor = (p, st) => {
      const needs = [];
      stepData(st).forEach(d => {
        const de = data[d];
        const eff = av[d] || 'missing';
        // R8: only information that is not available yet (missing or example); never "We have it" or pending.
        if (!de || (eff !== 'missing' && eff !== 'example')) return;
        const existing = work.find(w => w.resolves === d);
        if (existing) { if (existing.status !== 'done') needs.push(existing.id); return; }
        if (!resolverKey[d]) {
          const sg = push({ pid: p.id, step: st.id, title: 'Make ' + (de.name || 'the information') + ' available',   // R8: one plain wording for "Not available yet"
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
            const g = push({ pid: p.id, step: nd.id, title: (nd.type === 'parallel' ? 'Set up parallel branches: ' : 'Configure routing: ') + (nd.title || 'untitled gateway'),
              kind: 'build', owner: (firstStep && firstStep.owner) || p.owner || null, deps: flowPrev.slice() });
            flowPrev = [g.key];
          }
          // each branch follows the gateway; the step after the gateway follows every branch's last work
          const atGate = flowPrev, ends = [];
          (nd.branches || []).forEach(b => { flowPrev = atGate; visit(b && b.nodes); ends.push(...flowPrev); });
          flowPrev = [...new Set(ends.length ? ends : atGate)];
          return;
        }
        if (!isStep(nd)) return;
        if (nd.type === 'wait' || nd.type === 'message') return;   // R8: wait/message nodes create no build tasks
        const needs = resolversFor(p, nd);
        const st = diff.nodes[nd.id];
        if ((st === 'new' || st === 'changed') && !hasWork(p.id, nd.id)) {
          const sg = push({ pid: p.id, step: nd.id, title: (st === 'new' ? 'Stand up new step: ' : 'Implement changes: ') + (nd.title || 'untitled step'), kind: 'build', owner: nd.owner || p.owner || null,
            deps: [...new Set(flowPrev.concat(needs))] });
          flowPrev = [sg.key];
        } else {
          const open = work.filter(w => w.projectId === projectId && w.pid === p.id && w.step === nd.id && w.status !== 'done').map(w => w.id);
          if (hasWork(p.id, nd.id)) flowPrev = open;   // all done: nothing to wait for
        }
      });
      // R6 flow order: a step's build item depends (FS) on the nearest preceding step's work in map order
      // (its suggested build item, else its open work items), plus its data resolvers.
      let flowPrev = [];
      visit(p.tobe);
    });
    schedule(1);
    if (anchor && out.length) {
      const target = isDate(project.target) && project.target > anchor ? project.target : defaultTarget(anchor);
      const avail = businessDaysBetween(anchor, target);
      const usable = avail - Math.max(5, Math.ceil(avail * 0.15));
      const needed = businessDaysBetween(anchor, maxDate(out.map(x => x.due)));
      if (needed > 0 && usable > needed) schedule(Math.min(2, usable / needed));
    }
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
  function diffVersions(a, b) {
    const A = versionNodes(a), B = versionNodes(b);
    const ids = allNodeIds(A);
    const tag = nodes => (nodes || []).map(n => {
      if (!n) return n;
      const c = Object.assign({}, n);
      if (ids.has(n.id)) c.from = n.id; else delete c.from;
      if (Array.isArray(n.branches)) c.branches = n.branches.map(br => Object.assign({}, br, { nodes: tag(br && br.nodes) }));
      return c;
    });
    return diffProcess({ asis: A, tobe: tag(B) });
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
  function costOf(project, planned, ev) {
    const r2 = n => Math.round(n * 100) / 100;
    const forecastCost = ev.EAC, actualCost = ev.AC;
    return { planned, estimate: ev.estimate, forecastCost, actualCost, remainingCost: r2(Math.max(0, forecastCost - actualCost)),
      variance: planned == null ? null : r2(forecastCost - planned), overBudget: planned != null && forecastCost > planned,
      program: project && project.program || null };
  }
  // R6 earned value. Each item's value = workCost, scaled so values sum to BAC when budget.planned is set.
  //  PV: value scheduled by today (linear across start→due in business days; due ≤ today = all).
  //  EV: done = full value; in progress = value × fraction (progress 0–1, else pct 0–100, else 0.5); idle = 0.
  //  AC: Σ time[].hours × dayRate/8 (rate of the person who logged, else the owner, else 800).
  //  SPI = EV/PV, CPI = EV/AC (null when the divisor is 0); EAC = BAC/CPI, or BAC when CPI is null.
  function progressOf(w) {
    if (w.status === 'done') return 1;
    if (w.status === 'idle' || !w.status) return 0;
    if (w.progress != null && isFinite(+w.progress)) return Math.min(1, Math.max(0, +w.progress));
    if (w.pct != null && isFinite(+w.pct)) return Math.min(1, Math.max(0, +w.pct / 100));
    return 0.5;
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
    const SPI = PV > 0 ? r2(EV / PV) : null, CPI = AC > 0 ? r2(EV / AC) : null;
    // R8: EAC is the one cost forecast. With actuals: BAC / CPI; before any hours are logged: the bottom-up
    // estimate (Σ workCost), so an estimate above the budget shows as over budget from day one.
    const EAC = CPI ? r2(BAC / (EV / AC)) : r2(total > 0 ? total : BAC);
    return { BAC: r2(BAC), PV: r2(PV), EV: r2(EV), AC: r2(AC), SPI, CPI, EAC, estimate: r2(total) };
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
  };
  // R8 Simple has two states only: "We have it" / "Not available yet" (state = the effective state; needsConfirm
  // when only the owner's confirmation is missing). {advanced: true} returns the detailed R7 labels.
  const SIMPLE_AVAIL = { have: { key: 'have', label: 'We have it', tone: 'green' }, notyet: { key: 'notyet', label: 'Not available yet', tone: 'red' } };
  function availLabel(docs, dataId, opts) {
    const st = effectiveAvail(docs, dataId);
    if (opts && opts.advanced) return Object.assign({ state: st }, AVAIL_LABELS[st] || AVAIL_LABELS.missing);
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
  const RAG_LABEL = { green: 'On track', amber: 'On track, some tasks running late', red: 'At risk', grey: 'Not planned' };

  // R8 "Are we on track?" in plain words, from scheduleCore (the same facts as projectTruth).
  // who: [{person (person id), name, action}] — the people who need to act, most important first.
  function statusOf(docs, project, c) {
    const rag = c.rag, label = c.label;
    const who = [];
    const addWho = (person, action) => { if (person && !who.some(x => x.person === person && x.action === action)) who.push({ person, name: nameOf(docs, person), action }); };
    if (rag === 'grey') {
      addWho(project.owner, 'Add the work or accept a suggested plan');
      return { sentence: 'No work has been planned yet, so there is nothing to track. Next: add the work or accept a suggested plan.', rag, label, who };
    }
    const { finish, target, allDone, blockers } = c;
    const bd = n => nWord(Math.abs(n), 'business day');
    let timing;
    if (allDone) timing = blockers.length ? 'Every planned task is finished' + (finish ? ' (' + fmtDay(finish) + ')' : '') + '.' : 'All work is done' + (finish ? ', finished ' + fmtDay(finish) : '') + '.';
    else if (!finish) timing = 'The work has no dates yet.';
    else if (!target) timing = 'Expected ' + fmtDay(finish) + '. No deadline is set.';
    else if (finish === target) timing = 'Expected ' + fmtDay(finish) + ', right on the deadline.';
    else if (finish < target) timing = 'Expected ' + fmtDay(finish) + ', ' + bd(c.bufferDays) + ' before the ' + fmtDay(target) + ' deadline.';
    else timing = 'Expected ' + fmtDay(finish) + ', ' + bd(c.bufferDays) + ' after the ' + fmtDay(target) + ' deadline.';
    const issues = [];
    blockers.forEach(b => issues.push({ text: b.text + (b.planned ? '; work is planned to get it' : '') + (b.owner ? ' (' + nameOf(docs, b.owner) + ')' : ''),
      person: b.planned ? (b.resolverOwner || b.owner) : b.owner, action: b.planned ? 'Get ' + b.name + ' ready' : 'Plan work to get ' + b.name, planned: b.planned }));
    const items = c.items, fc = c.fc;
    const openIds = new Set(c.open.map(w => w.id));
    const holding = w => dependents(docs, w.id).filter(id => openIds.has(id)).length;
    const lateW = c.open.filter(w => c.late.includes(w.id)).map(w => ({ w, n: holding(w) })).sort((a, b) => b.n - a.n);
    const schedIssues = [];
    lateW.forEach(({ w, n }) => schedIssues.push({
      text: capFirst(w.title || 'A task') + ' is late' + (n ? ' and holding up ' + nWord(n, 'other task') : '') + (w.owner ? ' (' + nameOf(docs, w.owner) + ')' : ''),
      person: w.owner, action: 'Finish ' + (w.title || 'the late task') + (isDate(w.due) ? ' (was due ' + fmtDay(w.due) + ')' : '') }));
    const causing = c.open.filter(w => fc[w.id] && fc[w.id].sched !== 'late' && fc[w.id].causesSlip).map(w => ({ w, n: holding(w) })).sort((a, b) => b.n - a.n);
    causing.forEach(({ w, n }) => schedIssues.push({
      text: capFirst(w.title || 'A task') + ' is delaying ' + (n ? nWord(n, 'other task') : 'other work') + (w.owner ? ' (' + nameOf(docs, w.owner) + ')' : ''),
      person: w.owner, action: 'Get “' + (w.title || 'this task') + '” back on schedule' }));
    const rl = c.runningLate.length;
    if (!lateW.length && !causing.length && rl) schedIssues.push({ text: nWord(rl, 'task') + ' ' + isAre(rl) + ' running late', person: project.owner, action: 'Review the tasks that are running late' });
    // Order: unplanned blockers, the deadline miss / schedule issues, then planned blockers.
    const ordered = issues.filter(x => !x.planned).concat(schedIssues, issues.filter(x => x.planned));
    if (!allDone && c.bufferDays != null && c.bufferDays >= 0 && c.bufferDays < 5 && rag !== 'red')
      ordered.push({ text: 'There ' + (c.bufferDays === 1 ? 'is' : 'are') + ' only ' + bd(c.bufferDays) + ' to spare before the deadline', person: project.owner, action: 'Look for work that can finish sooner' });
    if (rag === 'red' && c.finish && c.target && c.finish > c.target && !ordered.length) ordered.push({ text: 'The work will not finish by the deadline', person: project.owner, action: 'Review the plan' });
    if (!ordered.length) {
      // Green with nothing open to report (never while blockers exist: they are listed above).
      return { sentence: timing + (allDone ? '' : ' Nothing needs attention right now.'), rag, label, who };
    }
    ordered.forEach(x => addWho(x.person, x.action));
    const more = ordered.length - 1;
    const sentence = timing + ' ' + capFirst(ordered[0].text) + '.' + (more > 0 ? ' ' + nWord(more, 'other thing') + ' also need' + (more === 1 ? 's' : '') + ' attention.' : '');
    return { sentence, rag, label, who };
  }
  function projectSummary(docs, prj, today) {
    const project = projOf(docs, prj);
    if (!project) return { sentence: 'This project could not be found.', rag: 'grey', label: RAG_LABEL.grey, who: [] };
    return statusOf(docs, project, scheduleCore(docs, project, today));
  }

  // R7 "Is testing finished?" in one line. done mirrors the tests-passed gate check.
  function testingSummary(docs, prj, today) {
    const project = projOf(docs, prj);
    if (!project) return { done: false, sentence: 'This project could not be found.', nextAction: { key: 'none', label: 'Nothing to do' } };
    return testingCore(docs, project, readiness(docs, project.id, today || null));
  }
  // R8 one number ("6 of 34 tests passed": a test's latest result in any stage is a pass), two stages
  // ("Try it out", "Business sign-off"), one next action. Only information the project changes needs tests.
  function testingCore(docs, project, r) {
    const c = (r.checks || []).find(x => x.id === 'tests-passed');
    if (r.released) return { done: true, passed: null, total: null, count: '', sentence: 'Yes: testing was finished before launch.', stages: [], nextAction: { key: 'none', label: 'Nothing left to test' } };
    if (!c) return { done: false, passed: 0, total: 0, count: '0 of 0 tests passed', sentence: 'Not yet: no tests have been set up.', stages: [], nextAction: { key: 'generate', label: 'Create the tests' } };
    const n = a => (a || []).length;
    const total = c.total || 0, passed = c.passed || 0;
    const count = passed + ' of ' + nWord(total, 'test') + ' passed';
    const stages = [c.stages.system, c.stages.uat].map(x => Object.assign({}, x));
    const base = { passed, total, count, stages, changedInformation: (c.changedData || []).length };
    if (c.pass) {
      if (!total) return Object.assign(base, { done: true, sentence: 'Yes: nothing this project changes needs testing.', nextAction: { key: 'none', label: 'Nothing left to test' } });
      return Object.assign(base, { done: true, sentence: 'Yes: ' + count + ' and no problems are open.', nextAction: { key: 'none', label: 'Nothing left to test' } });
    }
    const parts = [];
    if (n(c.failing)) parts.push(nWord(n(c.failing), 'test') + ' failed');
    if (n(c.blocked)) parts.push(nWord(n(c.blocked), 'test') + ' ' + isAre(n(c.blocked)) + ' blocked');
    if (n(c.noCases) || n(c.uncoveredFields)) parts.push('some information has no tests yet');
    if (n(c.defects)) parts.push(nWord(n(c.defects), 'problem') + ' ' + isAre(n(c.defects)) + ' still open');
    if (n(c.noEvidence)) parts.push(nWord(n(c.noEvidence), 'passed test') + ' ' + (n(c.noEvidence) === 1 ? 'needs' : 'need') + ' evidence');
    let next;
    if (n(c.uncoveredFields) || n(c.noCases)) next = { key: 'generate', label: 'Create the tests' };
    else if (n(c.failing)) next = { key: 'fix', label: 'Fix the failed tests' };
    else if (n(c.defects)) next = { key: 'problems', label: 'Close the open problems' };
    else if (!c.stages.system.done) next = { key: 'run-build', label: 'Try it out' };
    else if (n(c.unrun) || n(c.blocked)) next = { key: 'run', label: 'Run the business sign-off test' };
    else if (n(c.noEvidence)) next = { key: 'evidence', label: 'Add evidence to the passed tests' };
    else next = { key: 'review', label: 'Review the test results' };
    return Object.assign(base, { done: false, sentence: 'Not yet: ' + count + (parts.length ? '; ' + joinList(parts) : '') + '. Next: ' + next.label.charAt(0).toLowerCase() + next.label.slice(1) + '.', nextAction: next });
  }

  // R7 "Steps to launch": the readiness checks as an ordered plain checklist.
  // [{key, label, done, who: [personId], action, next}] — `next` marks the first step not done.
  function launchSteps(docs, prj, today) {
    const project = projOf(docs, prj);
    if (!project) return [];
    const r = readiness(docs, project.id, today);
    return launchStepsCore(docs, project, today, r, testingCore(docs, project, r));
  }
  function launchStepsCore(docs, project, today, r, testing) {
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
    const notLive = uniq([].concat(dl.missing || [], dl.examples || [], dl.pending || []));
    const dataOwners = uniq(notLive.map(id => dataOwnerOf(docs, get(docs, 'dataElement', id))));
    const nDr = (dr.items || []).length;
    steps.push({ key: 'information', label: 'Information available', done: live || (!!dl.pass && !!dr.pass), who: dataOwners.length ? dataOwners : (dl.pass && dr.pass ? [] : uniq([owner])),
      action: dl.pass && dr.pass ? 'Done' : [notLive.length ? nWord(notLive.length, 'piece') + ' of information ' + (notLive.length === 1 ? 'is' : 'are') + ' not available yet: ' + joinList(notLive.map(id => dataName(docs, id)), 3) : '',
        nDr ? nWord(nDr, 'new requirement') + ' found during the work ' + (nDr === 1 ? 'needs' : 'need') + ' a decision' : ''].filter(Boolean).join('; ') });
    // 4. Tests passed
    const ts = live ? { done: true, nextAction: { label: 'Done' } } : testing;
    steps.push({ key: 'tests', label: 'Tests passed', done: !!ts.done, who: ts.done ? [] : uniq([owner]), action: ts.done ? 'Done' : ts.nextAction.label });
    // 5. Each team approved its part (bu-signoff + two-person)
    const bu = ck('bu-signoff'), tp = ck('two-person');
    const waiting = uniq([].concat(bu.unsigned || [], (bu.stale || []).map(x => x.bu)));
    const needs = bu.needsApprover || bu.noPerson || [];
    const elig = bu.eligible || {};
    const apprWho = uniq(waiting.flatMap(b => elig[b] || Object.keys(people).filter(id => people[id] && people[id].bu === b && id !== owner && id !== lo)));
    const apprActs = [];
    if (needs.length) apprActs.push('Choose who approves ' + joinList(needs) + "'s part");
    if ((bu.unsigned || []).length) apprActs.push('Waiting for ' + joinList(bu.unsigned) + ' to approve ' + ((bu.unsigned || []).length === 1 ? 'its' : 'their') + ' part');
    if ((bu.stale || []).length) apprActs.push(joinList(bu.stale.map(x => x.bu)) + ' must approve again after changes');
    if (!apprActs.length && !tp.pass) apprActs.push('Two different people need to approve');
    steps.push({ key: 'approvals', label: 'Each team approved its part', done: live || (!!bu.pass && !!tp.pass), who: (bu.pass && tp.pass) ? [] : (needs.length ? uniq([owner]).concat(apprWho) : apprWho),
      action: (bu.pass && tp.pass) ? 'Done' : apprActs.join('; ') });
    // 6. Launch-day plan ready (cutover-plan)
    const co = ck('cutover-plan');
    steps.push({ key: 'launch-plan', label: 'Launch-day plan ready', done: live || !!co.pass, who: co.pass ? [] : uniq([lo]),
      action: co.pass ? 'Done' : 'Finish the launch-day plan: who undoes it if needed, how, who supports after launch, and the launch-day tasks' });
    // 7. Launch (also needs temporary data access closed)
    const gc = ck('grants-closed');
    const blockers = steps.filter(s => !s.done).length;
    steps.push({ key: 'launch', label: 'Launch', done: live, who: live ? [] : uniq([lo]),
      action: live ? 'Launched' : !gc.pass ? 'Close the open temporary data access requests' : blockers ? 'Waiting for the steps above' : 'Ready: give the final yes and launch' });
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
    if (!project) return { bu, ready: false, waiting: [], sentence: 'This project could not be found.' };
    const sc = sectionScope(docs, project, bu);
    const work = list(docs, 'workItem'), ctx = availCtx(docs);
    const waiting = [];
    const open = sc.work.filter(w => w.status !== 'done');
    if (open.length) waiting.push({ kind: 'work', count: open.length, items: open.map(w => w.id), text: nWord(open.length, 'task') + ' on ' + (open.length === 1 ? 'its step' : 'its steps') });
    const notYet = sc.dataIds.filter(id => availOf(get(docs, 'dataElement', id), work, docs, ctx) !== 'live');
    if (notYet.length) waiting.push({ kind: 'information', count: notYet.length, items: notYet, text: joinList(notYet.map(id => dataName(docs, id)), 3) });
    const out = latestAnyStage(docs, project.id);
    const tests = sc.caseIds.concat(sc.scriptIds);
    const notPassed = tests.filter(id => out[id] !== 'pass');
    if (notPassed.length) waiting.push({ kind: 'tests', count: notPassed.length, items: notPassed, text: nWord(notPassed.length, 'test') + ' to pass' });
    const ready = !waiting.length;
    return { bu, ready, waiting, steps: sc.steps.length, tests: { passed: tests.length - notPassed.length, total: tests.length },
      sentence: ready ? 'Ready for your approval.' : 'Not ready for your approval yet: waiting on ' + joinList(waiting.map(x => x.text)) + '.' };
  }
  // R8 prefilled "What you checked", built from facts, never boilerplate.
  // {text: "3 changed steps reviewed; 12 of 12 tests passed", facts: {...}}
  function approvalNoteFacts(docs, prj, bu) {
    const project = projOf(docs, prj);
    if (!project) return { text: '', facts: {} };
    const sc = sectionScope(docs, project, bu);
    const work = list(docs, 'workItem'), ctx = availCtx(docs);
    const out = latestAnyStage(docs, project.id);
    const tests = sc.caseIds.concat(sc.scriptIds);
    const passed = tests.filter(id => out[id] === 'pass').length;
    const have = sc.dataIds.filter(id => availOf(get(docs, 'dataElement', id), work, docs, ctx) === 'live').length;
    const facts = { changedSteps: sc.steps.length, tests: { passed, total: tests.length }, information: { have, total: sc.dataIds.length },
      tasks: { done: sc.work.filter(w => w.status === 'done').length, total: sc.work.length }, launchTasks: sc.tasks.length };
    const parts = [];
    if (facts.changedSteps) parts.push(nWord(facts.changedSteps, 'changed step') + ' reviewed');
    if (facts.tasks.total) parts.push(facts.tasks.done + ' of ' + nWord(facts.tasks.total, 'task') + ' done');
    if (tests.length) parts.push(passed + ' of ' + nWord(tests.length, 'test') + ' passed');
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

  // R8 ONE TRUTH: every number, date and label a page, report, CSV, dashboard or portfolio shows for a project.
  // projectSummary, projectHealth, testingSummary, launchSteps and earnedValue are the functions this uses, so
  // nothing can disagree. Dates are YYYY-MM-DD; bufferDays is business days.
  function projectTruth(docs, prj, today) {
    const project = projOf(docs, prj);
    if (!project) return null;
    const c = scheduleCore(docs, project, today);
    const st = statusOf(docs, project, c);
    const r = readiness(docs, project.id, today);
    const testing = testingCore(docs, project, r);
    const launch = launchStepsCore(docs, project, today, r, testing);
    const ev = earnedValue(docs, project.id, today);
    const planned = project.budget && project.budget.planned != null && isFinite(+project.budget.planned) ? +project.budget.planned : null;
    const cost = costOf(project, planned, ev);
    return {
      projectId: project.id, name: project.name || '', today: today || null,
      tasks: { total: c.items.length, done: c.items.length - c.open.length, open: c.open.length },
      forecastFinish: c.finish, actualFinish: c.allDone ? c.finish : null, target: c.target, deadline: c.target,
      bufferDays: c.bufferDays, bufferUnit: 'business days',
      lateCount: c.late.length, late: c.late.slice(), runningLateCount: c.runningLate.length, runningLate: c.runningLate.slice(),
      blockers: c.blockers, unplannedBlockers: c.blockers.filter(b => !b.planned).length,
      rag: c.rag, label: c.label, sentence: st.sentence, who: st.who, reasons: c.reasons.slice(),
      status: { rag: c.rag, label: c.label, sentence: st.sentence, reasons: c.reasons.slice(), who: st.who },
      launchSteps: launch, testing,
      cost: { planned, estimate: cost.estimate, actual: cost.actualCost, forecast: cost.forecastCost, remaining: cost.remainingCost, variance: cost.variance, overBudget: cost.overBudget },
      ev, burndown: burndownStatus(docs, project.id, today, ev),
    };
  }

  return {
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
