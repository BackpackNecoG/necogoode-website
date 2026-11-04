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
  function isStep(n) { return n && n.type !== 'decision' && n.type !== 'trigger' && n.type !== 'end'; }

  // Steps only (no trigger/end/decision), branch steps included, in map order.
  function flatSteps(nodes) {
    const out = [];
    (nodes || []).forEach(n => {
      if (!n) return;
      if (n.type === 'decision') (n.branches || []).forEach(b => out.push(...flatSteps(b && b.nodes)));
      else if (isStep(n)) out.push(n);
    });
    return out;
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
  function diffProcess(process) {
    const asisSteps = flatSteps(process && process.asis);
    const asis = byId(asisSteps);
    const tobe = flatSteps(process && process.tobe);
    const nodes = {}, changes = {}, used = new Set();
    for (const n of tobe) {
      if (!n.from) { nodes[n.id] = 'new'; changes[n.id] = ['New step']; continue; }
      const a = asis[n.from];
      if (!a) { nodes[n.id] = 'new'; changes[n.id] = ['New step (as-is step ' + n.from + ' not found)']; continue; }
      used.add(n.from);
      const ch = [];
      if ((a.title || '') !== (n.title || '')) ch.push('Title "' + (a.title || '') + '" → "' + (n.title || '') + '"');
      if ((a.owner || '') !== (n.owner || '')) ch.push('Owner ' + (a.owner || '(none)') + ' → ' + (n.owner || '(none)'));
      const ad = new Set(a.data || []), nd = new Set(n.data || []);
      const added = [...nd].filter(d => !ad.has(d)), removed = [...ad].filter(d => !nd.has(d));
      if (added.length) ch.push('Data added: ' + added.join(', '));
      if (removed.length) ch.push('Data removed: ' + removed.join(', '));
      nodes[n.id] = ch.length ? 'changed' : 'same';
      changes[n.id] = ch;
    }
    const removed = asisSteps.filter(a => !used.has(a.id));
    return { nodes, removed, changes };
  }

  /* ------------------------------------------------------------------ */
  /* Forecast                                                            */
  /* ------------------------------------------------------------------ */
  function duration(w) {
    if (!isDate(w.start) || !isDate(w.due)) return 1;
    return Math.max(1, diffDays(w.due, w.start));
  }

  // Rules: a not-done item cannot finish before (a) its due date, (b) each open dep's
  // forecast + its own duration, (c) today + duration when idle and the start has passed,
  // (d) today. Cycles: a dep already on the evaluation stack is treated as no dep.
  function forecastAll(docs, today) {
    const work = list(docs, 'workItem');
    const idx = byId(work);
    const memo = {}, visiting = {};
    function calc(id) {
      if (memo[id]) return memo[id];
      const w = idx[id];
      visiting[id] = true;
      let res;
      if (w.status === 'done') {
        res = { forecast: isDate(w.due) ? w.due : null, sched: 'done', slipDays: 0 };
      } else {
        const dur = duration(w);
        let best = isDate(w.due) ? w.due : null, bestCause = null;
        const consider = (date, cause) => { if (isDate(date) && (!best || date > best)) { best = date; bestCause = cause; } };
        (w.deps || []).forEach(d => {
          const dep = idx[d];
          if (!dep || dep.status === 'done' || visiting[d] || d === id) return;
          const r = calc(d);
          if (r.forecast) consider(addDays(r.forecast, dur), d);
        });
        if (isDate(today)) {
          if (w.status === 'idle' && isDate(w.start) && w.start < today) consider(addDays(today, dur), null);
          consider(today, null);
        }
        res = { forecast: best, slipDays: best && isDate(w.due) ? Math.max(0, diffDays(best, w.due)) : 0 };
        if (isDate(w.due) && isDate(today) && w.due < today) res.sched = 'late';
        else if (best && isDate(w.due) && best > w.due) res.sched = 'slip';
        else if (isDate(w.due) && isDate(today) && diffDays(w.due, today) <= 5) res.sched = 'soon';
        else res.sched = 'ok';
        if (bestCause && best && isDate(w.due) && best > w.due) {
          // Root cause: follow the binding dependency chain to its origin work item.
          const up = memo[bestCause];
          const rootWork = (up && up.causeWork) || bestCause;
          const rw = idx[rootWork];
          res.causeWork = rootWork;
          res.cause = (rw && rw.resolves) || rootWork;
        }
      }
      visiting[id] = false;
      memo[id] = res;
      return res;
    }
    const out = {};
    for (const w of work) out[w.id] = Object.assign({}, calc(w.id));
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Data readiness, dependents, impact                                  */
  /* ------------------------------------------------------------------ */
  function dataReady(docs, dataId) {
    const d = get(docs, 'dataElement', dataId);
    if (d && d.avail === 'live') return true;
    return list(docs, 'workItem').some(w => w.resolves === dataId && w.status === 'done');
  }

  function dependents(docs, workId) {
    const work = list(docs, 'workItem');
    const out = new Set();
    const walk = x => work.forEach(w => {
      if ((w.deps || []).includes(x) && !out.has(w.id) && w.id !== workId) { out.add(w.id); walk(w.id); }
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
      blockers: open.length && step ? (step.data || []).filter(d => !dataReady(docs, d)) : [],
    };
  }

  function projectStats(docs, projectId, today) {
    const project = get(docs, 'project', projectId);
    const work = list(docs, 'workItem');
    const idx = byId(work);
    const items = work.filter(w => w.projectId === projectId);
    const fc = forecastAll(docs, today);
    const done = items.filter(w => w.status === 'done').length;
    const finish = maxDate(items.map(w => fc[w.id].forecast));
    const target = project && project.target || null;
    return {
      total: items.length, done,
      pct: items.length ? Math.round(done / items.length * 100) : 0,
      late: items.filter(w => fc[w.id].sched === 'late').length,
      slip: items.filter(w => fc[w.id].sched === 'slip').length,
      blocked: items.filter(w => w.status !== 'done' && (w.deps || []).some(d => idx[d] && idx[d].status !== 'done')).length,
      finish, target,
      onTrack: !target || !finish || finish <= target,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Readiness gate                                                      */
  /* ------------------------------------------------------------------ */
  function latestBy(arr, key) { return arr.slice().sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || ''))).pop() || null; }

  function readiness(docs, projectId, today) {
    const project = get(docs, 'project', projectId);
    if (!project) return { pass: false, checks: [{ id: 'project', label: 'Project exists', pass: false, detail: 'Project ' + projectId + ' not found.', items: [] }] };
    const people = personMap(docs);
    const procs = linkedProcesses(docs, project);
    const steps = [];
    procs.forEach(p => flatSteps(p.tobe).forEach(s => steps.push({ pid: p.id, s })));
    const usedData = [...new Set(steps.flatMap(x => stepData(x.s)))];
    const work = list(docs, 'workItem').filter(w => w.projectId === projectId);
    const checks = [];

    // work-done
    const open = work.filter(w => w.status !== 'done').map(w => w.id);
    checks.push({ id: 'work-done', label: 'All work items done', pass: open.length === 0,
      detail: open.length ? open.length + ' of ' + work.length + ' work items still open.' : 'All ' + work.length + ' work items are done.', items: open });

    // data-live
    const notReady = usedData.filter(d => !dataReady(docs, d));
    checks.push({ id: 'data-live', label: 'Required data is live', pass: notReady.length === 0,
      detail: notReady.length ? notReady.length + ' data element(s) used by the to-be steps are not live and have no completed resolver.' : 'All ' + usedData.length + ' data elements are live or resolved.', items: notReady });

    // tests-passed: only cases for data used by linked to-be steps
    const usedSet = new Set(usedData);
    const cases = list(docs, 'testCase').filter(c => usedSet.has(c.dataId));
    const caseIds = new Set(cases.map(c => c.id));
    const runs = list(docs, 'testRun').filter(r => r.projectId === projectId);
    const lastDev = latestBy(runs.filter(r => r.env === 'dev'), 'at');
    const lastUat = latestBy(runs.filter(r => r.env === 'uat'), 'at');
    const failing = new Set();
    [lastDev, lastUat].forEach(r => r && (r.results || []).forEach(x => { if (caseIds.has(x.caseId) && x.outcome === 'fail') failing.add(x.caseId); }));
    const ranInUat = new Set();
    runs.filter(r => r.env === 'uat').forEach(r => (r.results || []).forEach(x => { if (x.outcome === 'pass' || x.outcome === 'fail') ranInUat.add(x.caseId); }));
    const unrun = cases.map(c => c.id).filter(id => !ranInUat.has(id));
    const missingRuns = cases.length ? [lastDev ? null : 'dev', lastUat ? null : 'uat'].filter(Boolean) : [];
    const tp = failing.size === 0 && unrun.length === 0 && missingRuns.length === 0;
    const tDetail = [];
    if (!cases.length) tDetail.push('No test cases for the data used by this project.');
    if (missingRuns.length) tDetail.push('No ' + missingRuns.join(' or ').toUpperCase() + ' run recorded.');
    if (failing.size) tDetail.push(failing.size + ' case(s) failing in the latest dev/UAT run.');
    if (unrun.length) tDetail.push(unrun.length + ' case(s) never run in UAT.');
    if (tp && cases.length) tDetail.push('All ' + cases.length + ' cases pass and have run in UAT.');
    checks.push({ id: 'tests-passed', label: 'Tests passed in dev and UAT', pass: tp, detail: tDetail.join(' '),
      items: [...new Set([...failing, ...unrun])], failing: [...failing], unrun });

    // grants-closed: requested/approved block; active ones are expired automatically at go-live.
    const grants = list(docs, 'grant').filter(g => g.projectId === projectId);
    const blocking = grants.filter(g => g.status === 'requested' || g.status === 'approved').map(g => g.id);
    const expiring = grants.filter(g => g.status === 'active').map(g => g.id);
    checks.push({ id: 'grants-closed', label: 'Access grants closed', pass: blocking.length === 0,
      detail: (blocking.length ? blocking.length + ' grant(s) still requested or approved; deny, revoke or activate them first. ' : 'No pending grants. ') +
        'Active grants expire automatically at go-live' + (expiring.length ? ' (' + expiring.length + ' will be expired).' : '.'),
      items: blocking.concat(expiring), blocking, expiring });

    // bu-signoff: each BU owning at least one to-be step needs its latest approval approved with stepUp.
    const approvals = list(docs, 'approval').filter(a => a.projectId === projectId);
    const bus = [...new Set(steps.map(x => people[x.s.owner] && people[x.s.owner].bu).filter(Boolean))].sort();
    const validFor = bu => {
      const latest = latestBy(approvals.filter(a => a.bu === bu), 'at');
      return latest && latest.decision === 'approved' && latest.stepUp === true ? latest : null;
    };
    const unsigned = bus.filter(bu => !validFor(bu));
    checks.push({ id: 'bu-signoff', label: 'Every business unit signed off', pass: bus.length > 0 && unsigned.length === 0,
      detail: !bus.length ? 'No business units own steps in the linked processes.' : unsigned.length ? 'Awaiting sign-off: ' + unsigned.join(', ') + '.' : 'All ' + bus.length + ' business units approved with step-up.', items: unsigned });

    // two-person
    const approvers = [...new Set(bus.map(validFor).filter(Boolean).map(a => a.approver))];
    checks.push({ id: 'two-person', label: 'Two-person rule', pass: approvers.length >= 2,
      detail: approvers.length + ' distinct approver(s); at least 2 required.', items: approvers });

    // exceptions (warning only): work items whose updatedAt is after their BU's approval.
    const stepOwner = {};
    steps.forEach(x => { stepOwner[x.pid + '/' + x.s.id] = x.s.owner; });
    const exc = work.filter(w => {
      if (!w.updatedAt) return false;
      const owner = stepOwner[w.pid + '/' + w.step] || w.owner;
      const bu = people[owner] && people[owner].bu;
      const appr = bu && validFor(bu);
      return appr && String(w.updatedAt) > String(appr.at);
    }).map(w => w.id);
    checks.push({ id: 'exceptions', label: 'Changes after sign-off', pass: exc.length === 0, warning: true,
      detail: exc.length ? exc.length + ' work item(s) changed after their business unit approved. Warning only.' : 'No work changed after sign-off.', items: exc });

    return { pass: checks.filter(c => !c.warning).every(c => c.pass), checks };
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
  function norm(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
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
    const sp = { name: f.name, type, mask, required: f.required === true || (f.required == null && /required/i.test(String(f.rule || '')) && !/optional/i.test(String(f.rule || ''))) };
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
  function validDate(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false; const ms = toMs(s); return !isNaN(ms) && iso(ms) === s; }
  // Does `input` satisfy the field spec?
  function validate(sp, input) {
    const s = String(input == null ? '' : input);
    if (s.trim() === '') return !sp.required;
    const len = chars(s).length;
    if (sp.mask && shapeOf(s) !== sp.maskShape) return false;
    if (sp.regex && !sp.regex.test(s)) return false;
    if (sp.type === 'digits' && !sp.mask && !/^\d+$/.test(s)) return false;
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
  function columnFor(f, cols) { const k = norm(f.column || f.name); return cols.find(c => norm(c.name) === k) || null; }

  /* ------------------------------------------------------------------ */
  /* Spec drift                                                          */
  /* ------------------------------------------------------------------ */
  function specDrift(dataElement, profile) {
    const cols = columnsOf(profile);
    const fields = (dataElement && dataElement.fields) || [];
    const out = [];
    const matched = new Set();
    for (const f of fields) {
      const sp = fieldSpec(f);
      const col = columnFor(f, cols);
      if (!col) { out.push({ field: f.name, issue: 'missing-column', detail: 'Spec field "' + f.name + '" has no matching column in the profile.' }); continue; }
      matched.add(col.name);
      const filled = col.rows - col.nulls;
      if (sp.required && col.nulls > 0) out.push({ field: f.name, issue: 'required-nulls', detail: 'Required, but ' + col.nulls + ' of ' + col.rows + ' rows are empty.' });
      if (filled <= 0) continue;
      const lenRange = col.minLen === col.maxLen ? String(col.minLen) : col.minLen + '–' + col.maxLen;
      if (sp.length != null && (col.minLen !== sp.length || col.maxLen !== sp.length))
        out.push({ field: f.name, issue: 'length-mismatch', detail: 'Spec says length ' + sp.length + (sp.type === 'digits' ? ' digits' : '') + '; profile has values of length ' + lenRange + '.' });
      if (sp.minLen != null && col.minLen < sp.minLen) out.push({ field: f.name, issue: 'length-mismatch', detail: 'Spec minimum length ' + sp.minLen + '; shortest observed value is ' + col.minLen + '.' });
      if (sp.maxLen != null && col.maxLen > sp.maxLen) out.push({ field: f.name, issue: 'length-mismatch', detail: 'Spec maximum length ' + sp.maxLen + '; longest observed value is ' + col.maxLen + '.' });
      const allowed = allowedSpecials(sp);
      if (sp.type === 'digits') {
        const bad = (col.charClasses || []).filter(c => c === 'letters' || c === 'space' || c === 'unicode');
        const badSp = (col.specials || []).filter(c => !(allowed && allowed.has(c)));
        if (bad.length || badSp.length) out.push({ field: f.name, issue: 'non-digit', detail: 'Digits field contains ' + bad.concat(badSp.map(c => '"' + c + '"')).join(', ') + '.' });
      } else if (allowed) {
        const badSp = (col.specials || []).filter(c => !allowed.has(c));
        if (badSp.length) out.push({ field: f.name, issue: 'unexpected-specials', detail: 'Unexpected characters for a ' + sp.type + ' field: ' + badSp.map(c => '"' + c + '"').join(', ') + '.' });
      }
      if (sp.type === 'number' || sp.type === 'currency') {
        const hasLetters = (col.charClasses || []).some(c => c === 'letters' || c === 'unicode');
        if (col.min == null && hasLetters) out.push({ field: f.name, issue: 'type-mismatch', detail: 'Spec says ' + sp.type + '; profile has non-numeric values.' });
        if (col.min != null && sp.minVal != null && col.min < sp.minVal) out.push({ field: f.name, issue: 'out-of-range', detail: 'Values below the spec minimum ' + sp.minVal + '.' });
        if (col.max != null && sp.maxVal != null && col.max > sp.maxVal) out.push({ field: f.name, issue: 'out-of-range', detail: 'Values above the spec maximum ' + sp.maxVal + '.' });
      }
      if (sp.mask) {
        const want = collapse(sp.maskShape);
        const off = (col.patterns || []).filter(p => p.pattern !== want);
        if (off.length) out.push({ field: f.name, issue: 'pattern-mismatch', detail: 'Spec format ' + sp.mask + ' (' + want + '); profile also has ' + off.map(p => p.pattern + ' ×' + p.count).join(', ') + '.' });
      } else if (sp.regex) {
        const off = (col.patterns || []).filter(p => !sp.regex.test(expandPattern(p.pattern)));
        if (off.length) out.push({ field: f.name, issue: 'pattern-mismatch', detail: 'Observed shapes do not match the spec pattern: ' + off.map(p => p.pattern + ' ×' + p.count).join(', ') + '.' });
      }
      if (sp.values && col.distinct > sp.values.length)
        out.push({ field: f.name, issue: 'value-not-in-list', detail: col.distinct + ' distinct values observed; the spec allows ' + sp.values.length + '.' });
    }
    cols.filter(c => !matched.has(c.name)).forEach(c => out.push({ field: c.name, issue: 'unspecified-column', detail: 'Column "' + c.name + '" is in the extract but not in the spec.' }));
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

  function generateTests(dataElement, profile) {
    const de = dataElement || {};
    const cols = columnsOf(profile);
    const out = [], seen = new Set();
    const add = (f, kind, input, expect, origin, note) => {
      const key = f.name + '\u0000' + input;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ dataId: de.id, field: f.name, kind, input, expect, origin, note });
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

      // Profile edge cases
      const col = columnFor(f, cols);
      if (!col) continue;
      (col.specials || []).forEach(c => {
        const base = chars(valid);
        const input = base.length > 1 ? base[0] + c + base.slice(1).join('') : base.join('') + c;
        add(f, 'edge', input, ok(input), 'profile', 'Observed special character "' + c + '"');
      });
      if (col.maxLen > 0) {
        const top = (col.patterns || []).map(p => expandPattern(p.pattern)).find(s => chars(s).length === col.maxLen);
        const input = top || strOfLen(sp, col.maxLen);
        add(f, 'edge', input, ok(input), 'profile', 'Longest observed length (' + col.maxLen + ')');
      }
      const numericCol = (col.patterns || []).some(p => /^9/.test(p.pattern));
      if (sp.type === 'digits' || sp.type === 'number' || sp.type === 'currency' || numericCol) {
        const input = sp.type === 'digits' || sp.mask ? '0' + chars(valid).slice(1).join('') : '0' + valid;
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
  // workload(docs, projectId?, today). projectId may be null/undefined; workload(docs, today) also works.
  function workload(docs, projectId, today) {
    if (today === undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(projectId || ''))) { today = projectId; projectId = null; }
    const fc = forecastAll(docs, today);
    const items = list(docs, 'workItem').filter(w => !projectId || w.projectId === projectId);
    const rows = {};
    items.forEach(w => {
      if (!w.owner) return;
      const r = rows[w.owner] || (rows[w.owner] = { person: w.owner, open: 0, late: 0, dueNext7: 0 });
      if (w.status === 'done') return;
      r.open++;
      if (fc[w.id] && fc[w.id].sched === 'late') r.late++;
      if (isDate(w.due) && isDate(today)) { const d = diffDays(w.due, today); if (d >= 0 && d <= 7) r.dueNext7++; }
    });
    return Object.values(rows).sort((a, b) => b.open - a.open || b.late - a.late || String(a.person).localeCompare(String(b.person)));
  }

  function baselineVariance(docs, projectId, baselineId, today) {
    const project = get(docs, 'project', projectId);
    const bl = project && (project.baselines || []).find(b => b.id === baselineId);
    if (!bl) return [];
    const fc = forecastAll(docs, today);
    const planned = bl.items || {};
    const ids = Object.keys(planned);
    list(docs, 'workItem').forEach(w => { if (w.projectId === projectId && !(w.id in planned)) ids.push(w.id); });
    return ids.map(id => {
      const plannedDue = planned[id] ? planned[id].due || null : null;
      const forecast = fc[id] ? fc[id].forecast : null;
      return { workId: id, plannedDue, forecast, varianceDays: plannedDue && forecast ? diffDays(forecast, plannedDue) : null };
    });
  }

  function suggestWorkFromDiff(docs, projectId) {
    const project = get(docs, 'project', projectId);
    if (!project) return [];
    const work = list(docs, 'workItem');
    const data = byId(list(docs, 'dataElement'));
    const out = [], seenData = new Set();
    const pending = [];
    linkedProcesses(docs, project).forEach(p => {
      const diff = diffProcess(p);
      flatSteps(p.tobe).forEach(s => {
        const st = diff.nodes[s.id];
        if (st !== 'new' && st !== 'changed') return;
        if (!work.some(w => w.projectId === projectId && w.pid === p.id && w.step === s.id))
          out.push({ pid: p.id, step: s.id, title: (st === 'new' ? 'Stand up new step: ' : 'Implement changes: ') + (s.title || s.id), kind: 'build' });
        stepData(s).forEach(d => {
          const de = data[d];
          if (seenData.has(d) || !de || de.avail !== 'missing') return;
          seenData.add(d);
          if (!work.some(w => w.resolves === d)) pending.push({ pid: p.id, step: s.id, title: 'Make ' + (de.name || d) + ' available', kind: 'build', resolves: d });
        });
      });
    });
    return out.concat(pending);
  }

  return {
    // contract section 4
    flatSteps, diffProcess, forecastAll, stepState, dataReady, dependents, impactOfData,
    projectStats, readiness, profileCsv, specDrift, generateTests, workload, baselineVariance, suggestWorkFromDiff,
    // helpers (stable, safe to use from pages)
    parseCsv, maskValue, patternOf, expandPattern, fieldSpec, validate, addDays, diffDays,
  };
});
