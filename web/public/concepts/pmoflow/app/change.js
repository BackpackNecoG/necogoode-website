/* PMOFlow R10.2 stream C: traceable plan changes (pure logic).
   Canonical copy: api/shared/pmoflow-change.js. web/public/concepts/pmoflow/app/change.js MUST be byte-identical.
   UMD: window.PMOChange in the browser (reads window.PMOEngine), require() in Node (reads ./pmoflow-engine.js).
   Pure functions only: no I/O, no clock. Times (`at`) and `today` are passed in. Inputs are never mutated.
   `docs` has the /state shape: {type: [{id, data}]}.

   A plan change (doc type 'planChange'):
   { id, projectId, title, reason, category, kinds: ['dates'|'owner'|'work'|'scope'|'budget'|'deadline'], source: 'manual'|'process',
     edits: [ {op:'set', type:'workItem', id, field:'start'|'due'|'owner'|'effortDays'|'title'|'deps', from, to, label}
              {op:'set', type:'project',  id, field:'target'|'budget', from, to, label}
              {op:'add', type:'workItem', id, data, label}
              {op:'remove', type:'workItem', id, from: <task data>, label} ],
     status: 'proposed'|'approved'|'applied'|'rejected',
     impact, tolerance: {within, reasons}, approvers: [{role:'pm'|'sponsor'|'linkedPm', person, projectId?, decision, at, note, stepUp}],
     linked: [{projectId, changeId}]   (R12: the linked entries written in other projects' logs for a cross-project knock-on)
   A linked entry (source 'knockOn', no edits): { id, projectId: <the other project>, linkedFrom: {projectId, changeId, projectName},
     knockOn: [its tasks that moved], impact (computed for that project), approvers (its PM), status 'applied', … }
     requestedBy, requestedAt, decidedBy, decidedAt, appliedBy, appliedAt,
     snapshots: {before: {workId: {start, due, owner}}, after: {...}}, baselines: {before, after}, processRef, ackSteps }
   Impact is computed ONLY by running the engine (projectTruth, forecastAll, dependents, latestOutcomes) on the docs
   before and after the change, then comparing. */
(function (root, f) {
  if (typeof module === 'object' && module.exports) module.exports = f(function () { return require('./pmoflow-engine.js'); });
  else root.PMOChange = f(function () { return root.PMOEngine; });
})(typeof self !== 'undefined' ? self : this, function (engineOf) {
  'use strict';

  const KINDS = [
    { id: 'dates', label: 'Move dates' },
    { id: 'owner', label: 'Change owner' },
    { id: 'work', label: 'Add or remove work' },
    { id: 'scope', label: 'Change scope (the process changed)' },
    { id: 'budget', label: 'Change budget' },
    { id: 'deadline', label: 'Change deadline' },
  ];
  const CATEGORIES = [
    { id: 'client', label: 'Client request' },
    { id: 'dependency', label: 'Dependency slipped' },
    { id: 'resource', label: 'Resource change' },
    { id: 'scope', label: 'Scope change' },
    { id: 'issue', label: 'Issue found' },
    { id: 'other', label: 'Other' },
  ];
  const STATUS_LABEL = { proposed: 'Waiting for approval', approved: 'Approved', applied: 'Applied', rejected: 'Rejected' };
  const ROLE_LABEL = { pm: 'project manager', sponsor: 'sponsor', linkedPm: 'project manager of another project', linkedSponsor: 'sponsor of another project' };
  /* "Within tolerance": the deadline is unaffected, the budget is unchanged, expected cost moves by less than 5%,
     and no department approval reopens. */
  const COST_TOLERANCE_PCT = 5;
  const TASK_FIELDS = ['start', 'due', 'owner', 'effortDays', 'title', 'deps'];
  const PROJECT_FIELDS = ['target', 'budget'];
  const ID_RE = /^[\w.-]{1,64}$/;
  const MAX_EDITS = 120, MAX_LIST = 60;

  const E = eng => eng || engineOf();
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
  const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && isFinite(Date.parse(v + 'T12:00:00Z')) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const r2 = n => Math.round(n * 100) / 100;

  function list(docs, type) { return ((docs && docs[type]) || []).map(e => (e && e.data ? (e.data.id === e.id ? e.data : Object.assign({}, e.data, { id: e.id })) : null)).filter(Boolean); }
  function get(docs, type, id) { return list(docs, type).find(x => x.id === id) || null; }
  function personName(docs, id) { const p = get(docs, 'person', id); return p ? p.name || 'someone' : (id ? 'someone' : 'Nobody'); }
  function depId(d) { return d && typeof d === 'object' ? d.id : d; }
  function money(n) { return n == null || !isFinite(n) ? '—' : (n < 0 ? '−' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US'); }
  function day(d, eng) { return d ? E(eng).fmtDay(d) : '—'; }
  function joinAnd(arr) { return arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]; }
  function budgetOf(project) { return project && project.budget && project.budget.planned != null && isFinite(+project.budget.planned) ? +project.budget.planned : null; }

  /* The project's sponsor: project.sponsor when set, else the owner of its first linked process (when that is not the
     project manager), else (R13) the approvers of the project manager's department (workspace.departments), else nobody.
     `exclude` (R13 #3): people who may not stand as sponsor here (the requester): the next default approver stands in. */
  function sponsorOf(docs, projectOrId, exclude) {
    const project = typeof projectOrId === 'string' ? get(docs, 'project', projectOrId) : projectOrId;
    if (!project) return null;
    const no = new Set((exclude || []).filter(Boolean));
    const ok = id => id && !no.has(id) && get(docs, 'person', id);
    if (ok(project.sponsor)) return project.sponsor;
    for (const pid of project.processes || []) {
      const p = get(docs, 'process', pid);
      if (p && p.owner !== project.owner && ok(p.owner)) return p.owner;
    }
    const pm = get(docs, 'person', project.owner);
    const deps = departmentsOf(docs);
    const mine = pm && pm.bu ? deps.find(d => String(d.name || '').toLowerCase() === String(pm.bu).toLowerCase()) : null;
    const hit = mine ? (mine.approvers || []).find(id => id !== project.owner && ok(id)) : null;
    return hit || null;
  }
  /* R13 #1 (K1's shape): workspace.departments = [{id, name, approvers: [personId]}], on any workspace doc */
  function departmentsOf(docs) {
    for (const w of list(docs, 'workspace')) if (Array.isArray(w.departments)) return w.departments.filter(d => d && typeof d === 'object');
    return [];
  }
  /* R13 #3: an approver entry may carry several roles (one person counts once): [{role, projectId?}] */
  function rolesOf(a) { return a ? (Array.isArray(a.roles) && a.roles.length ? a.roles : [{ role: a.role, projectId: a.projectId }]) : []; }
  function hasRole(a, role, projectId) { return rolesOf(a).some(r => r.role === role && (projectId === undefined || r.projectId === projectId)); }

  /* R12 #13: an approver's role in words: "project manager", "sponsor", "project manager of ERP Upgrade Readiness".
     R13 #3: every role a person decides in, once: "project manager and project manager of ERP Upgrade Readiness". */
  function oneRoleText(r, docs) {
    if (r.role === 'linkedPm' || r.role === 'linkedSponsor') {
      const p = r.projectId ? get(docs, 'project', r.projectId) : null;
      return (r.role === 'linkedPm' ? 'project manager' : 'sponsor') + (p && p.name ? ' of ' + p.name : ' of another project');
    }
    return ROLE_LABEL[r.role] || String(r.role || '');
  }
  function roleText(a, docs) {
    if (!a) return '';
    const out = [];
    rolesOf(a).forEach(r => { const t = oneRoleText(r, docs); if (t && !out.includes(t)) out.push(t); });
    return joinAnd(out);
  }

  /* ------------------------------------------------------------------ */
  /* Edits: human text                                                  */
  /* ------------------------------------------------------------------ */
  function valueText(field, v, docs, eng) {
    if (field === 'start' || field === 'due' || field === 'target') return day(v, eng);
    if (field === 'owner') return personName(docs, v);
    if (field === 'budget') return money(v);
    if (field === 'effortDays') return v == null ? '—' : plural(+v, 'day');
    if (field === 'deps') return (v || []).length ? (v || []).map(d => { const w = get(docs, 'workItem', depId(d)); return '“' + (w ? w.title : 'a removed task') + '”'; }).join(', ') : 'nothing';
    return '“' + String(v == null ? '' : v) + '”';
  }
  const FIELD_LABEL = { start: 'start', due: 'due', owner: 'owner', effortDays: 'effort', title: 'title', deps: 'waits on', target: 'Deadline', budget: 'Budget' };
  function editText(e, docs, eng) {
    if (e.op === 'add') {
      const d = e.data || {};
      return 'Added “' + (d.title || 'untitled task') + '” (' + personName(docs, d.owner) + ', ' + day(d.start, eng) + ' – ' + day(d.due, eng) + ')';
    }
    if (e.op === 'remove') return 'Removed “' + (e.label || (e.from && e.from.title) || 'a task') + '”';
    if (e.type === 'project') return FIELD_LABEL[e.field] + ' ' + valueText(e.field, e.from, docs, eng) + ' → ' + valueText(e.field, e.to, docs, eng);
    if (e.field === 'title') return 'Renamed ' + valueText('title', e.from) + ' → ' + valueText('title', e.to);
    return '“' + (e.label || 'a task') + '”: ' + FIELD_LABEL[e.field] + ' ' + valueText(e.field, e.from, docs, eng) + ' → ' + valueText(e.field, e.to, docs, eng);
  }

  /* ------------------------------------------------------------------ */
  /* buildChange: validate and normalise a requested change             */
  /* ------------------------------------------------------------------ */
  function kindsOf(edits, source) {
    const k = new Set();
    edits.forEach(e => {
      if (e.op === 'set' && e.type === 'workItem' && (e.field === 'start' || e.field === 'due')) k.add('dates');
      if (e.op === 'set' && e.type === 'workItem' && e.field === 'owner') k.add('owner');
      if (e.op === 'set' && e.type === 'workItem' && (e.field === 'effortDays' || e.field === 'title')) k.add('work');
      if ((e.op === 'add' || e.op === 'remove') && !e.auto) k.add(source === 'process' || e.fromProcess ? 'scope' : 'work');
      if (e.type === 'project' && e.field === 'target') k.add('deadline');
      if (e.type === 'project' && e.field === 'budget') k.add('budget');
    });
    return KINDS.map(x => x.id).filter(x => k.has(x));
  }
  function autoTitle(edits, docs, eng) {
    const sets = edits.filter(e => e.op === 'set' && e.type === 'workItem' && !e.auto);
    const parts = [];
    const dateIds = [...new Set(sets.filter(e => e.field === 'start' || e.field === 'due').map(e => e.id))];
    if (dateIds.length === 1) parts.push('Move “' + (sets.find(e => e.id === dateIds[0]).label || 'a task') + '”');
    else if (dateIds.length) parts.push('Move ' + plural(dateIds.length, 'task'));
    const own = sets.filter(e => e.field === 'owner');
    if (own.length === 1) parts.push('Give “' + (own[0].label || 'a task') + '” to ' + personName(docs, own[0].to));
    else if (own.length) parts.push('Change the owner of ' + plural(own.length, 'task'));
    const adds = edits.filter(e => e.op === 'add').length, rems = edits.filter(e => e.op === 'remove').length;
    if (adds) parts.push('Add ' + plural(adds, 'task'));
    if (rems === 1) parts.push('Remove “' + (edits.find(e => e.op === 'remove').label || 'a task') + '”');
    else if (rems) parts.push('Remove ' + plural(rems, 'task'));
    const other = sets.filter(e => e.field === 'effortDays' || e.field === 'title').length;
    if (other && !parts.length) parts.push('Update ' + plural(other, 'task'));
    const t = edits.find(e => e.type === 'project' && e.field === 'target');
    if (t) parts.push('Move the deadline to ' + day(t.to, eng));
    const b = edits.find(e => e.type === 'project' && e.field === 'budget');
    if (b) parts.push('Set the budget to ' + money(b.to));
    const s = parts.slice(0, 2).join(', ') + (parts.length > 2 ? ' and more' : '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Plan change';
  }

  /* R13 #13: a start or due date on a day off (a weekend, a federal holiday, or the workspace's own day off) is refused,
     naming the day: '“Train the people” can’t be due on Fri Dec 25 (Christmas Day): that’s a day off. Pick a business day.'
     '' when d is a business day. */
  const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function offDayError(d, docs, what, title, eng) {
    const en = E(eng);
    if (!isDay(d) || en.isBusinessDay(d, docs)) return '';
    const h = en.holidayName(d, docs);
    const why = h || 'a ' + WEEKDAY[new Date(d + 'T12:00:00Z').getUTCDay()];
    return '“' + (title || 'This task') + '” can’t ' + (what === 'start' ? 'start' : 'be due') + ' on ' + day(d, en) + ' (' + why + '): that’s a day off. Pick a business day.';
  }

  /* input: {projectId, title?, reason, category?, source?, edits: [...], ackSteps?}. Returns {change, errors}.
     Fills each set edit's `from` with the current value (so a later apply can detect a plan that moved meanwhile),
     drops no-op edits, merges repeated edits of one field, and adds the dependency clean-up a removal needs. */
  function buildChange(input, docs, opts) {
    opts = opts || {};
    const eng = opts.engine;
    const errors = [];
    input = input || {};
    const projectId = String(input.projectId || '');
    const project = get(docs, 'project', projectId);
    if (!project) return { change: null, errors: ['Pick a project.'] };
    const reason = clean(input.reason, 200);
    if (!reason) errors.push('Say why the plan is changing (one line).');
    const category = CATEGORIES.some(c => c.id === input.category) ? input.category : null;
    const source = input.source === 'process' ? 'process' : 'manual';
    const raw = Array.isArray(input.edits) ? input.edits.slice(0, MAX_EDITS) : [];
    const tasks = list(docs, 'workItem');
    const taskOf = id => tasks.find(w => w.id === id) || null;
    const edits = [];
    const setKey = e => e.type + ':' + e.id + ':' + e.field;
    const removed = new Set(raw.filter(e => e && e.op === 'remove').map(e => String(e.id)));
    raw.forEach(e0 => {
      if (!e0 || typeof e0 !== 'object') return;
      const e = clone(e0);
      if (e.op === 'set' && e.type === 'workItem') {
        const w = taskOf(e.id);
        if (!w || w.projectId !== projectId) { errors.push('A task in this change is not part of the project any more.'); return; }
        if (!TASK_FIELDS.includes(e.field)) { errors.push('That task detail cannot be changed here.'); return; }
        if (removed.has(w.id)) return;
        let to = e.to;
        if (e.field === 'start' || e.field === 'due') {
          if (!isDay(to)) { errors.push('Pick a real ' + e.field + ' date for “' + w.title + '”.'); return; }
          const off = to !== w[e.field] ? offDayError(to, docs, e.field, w.title, eng) : '';
          if (off) { errors.push(off); return; }
        }
        if (e.field === 'owner') { if (!get(docs, 'person', to)) { errors.push('Pick a person to own “' + w.title + '”.'); return; } }
        if (e.field === 'effortDays') { to = +to; if (!(to > 0) || to > 200) { errors.push('Effort for “' + w.title + '” must be between 0.5 and 200 days.'); return; } }
        if (e.field === 'title') { to = clean(to, 140); if (!to) { errors.push('A task needs a title.'); return; } }
        if (e.field === 'deps') { to = Array.isArray(to) ? to.filter(d => taskOf(depId(d))) : []; }
        const from = w[e.field] === undefined ? null : clone(w[e.field]);
        const out = { op: 'set', type: 'workItem', id: w.id, field: e.field, from, to, label: w.title || 'untitled task' };
        if (e.auto) out.auto = true;
        const i = edits.findIndex(x => x.op === 'set' && setKey(x) === setKey(out));
        if (i >= 0) edits.splice(i, 1);
        if (!same(from, to)) edits.push(out);
        return;
      }
      if (e.op === 'set' && e.type === 'project') {
        if (!PROJECT_FIELDS.includes(e.field)) { errors.push('That project detail cannot be changed here.'); return; }
        let to = e.to, from;
        if (e.field === 'target') { if (!isDay(to)) { errors.push('Pick a real deadline date.'); return; } from = project.target || null; }
        else { to = +to; if (!(to >= 0) || !isFinite(to) || to > 1e9) { errors.push('Enter the budget as a number of dollars.'); return; } from = budgetOf(project); }
        const out = { op: 'set', type: 'project', id: projectId, field: e.field, from, to, label: project.name || 'the project' };
        const i = edits.findIndex(x => x.op === 'set' && setKey(x) === setKey(out));
        if (i >= 0) edits.splice(i, 1);
        if (!same(from, to)) edits.push(out);
        return;
      }
      if (e.op === 'add' && e.type === 'workItem') {
        const d = Object.assign({}, e.data || {});
        const id = String(e.id || d.id || '');
        if (!ID_RE.test(id) || taskOf(id) || edits.some(x => x.op === 'add' && x.id === id)) { errors.push('A new task needs a fresh id.'); return; }
        d.title = clean(d.title, 140);
        if (!d.title) { errors.push('Give each new task a title.'); return; }
        if (!isDay(d.start) || !isDay(d.due)) { errors.push('Set a start and a due date for “' + d.title + '”.'); return; }
        if (d.due < d.start) { errors.push('“' + d.title + '” is due before it starts.'); return; }
        const off = offDayError(d.start, docs, 'start', d.title, eng) || offDayError(d.due, docs, 'due', d.title, eng);
        if (off) { errors.push(off); return; }
        if (!get(docs, 'person', d.owner)) { errors.push('Pick an owner for “' + d.title + '”.'); return; }
        const eff = d.effortDays == null || d.effortDays === '' ? 1 : +d.effortDays;
        if (!(eff > 0) || eff > 200) { errors.push('Effort for “' + d.title + '” must be between 0.5 and 200 days.'); return; }
        const data = { id, projectId, pid: d.pid || null, step: d.step || null, title: d.title, owner: d.owner, status: 'idle', start: d.start, due: d.due,
          effortDays: eff, deps: (Array.isArray(d.deps) ? d.deps : []).filter(x => taskOf(depId(x)) || raw.some(y => y && y.op === 'add' && String(y.id || (y.data || {}).id) === depId(x))),
          kind: ['build', 'other', 'access', 'test', 'defect'].includes(d.kind) ? d.kind : 'build' };
        ['note', 'tag', 'retires', 'resolves'].forEach(k => { if (d[k]) data[k] = String(d[k]).slice(0, 300); });
        const out = { op: 'add', type: 'workItem', id, data, label: data.title };
        if (e.fromProcess || source === 'process') out.fromProcess = true;
        edits.push(out);
        return;
      }
      if (e.op === 'remove' && e.type === 'workItem') {
        const w = taskOf(e.id);
        if (!w || w.projectId !== projectId) { errors.push('A task to remove is not part of the project any more.'); return; }
        if (w.status === 'done') { errors.push('“' + w.title + '” is already done, so it stays in the plan.'); return; }
        if (edits.some(x => x.op === 'remove' && x.id === w.id)) return;
        edits.push({ op: 'remove', type: 'workItem', id: w.id, from: clone(w), label: w.title || 'untitled task' });
        return;
      }
      errors.push('One of the edits is not something a plan change can do.');
    });
    /* a removed task no longer holds up the tasks that waited on it: record that as an edit too */
    edits.filter(e => e.op === 'remove').forEach(rm => {
      tasks.filter(w => !removed.has(w.id) && (w.deps || []).some(d => depId(d) === rm.id)).forEach(w => {
        const cur = edits.find(x => x.op === 'set' && x.type === 'workItem' && x.id === w.id && x.field === 'deps');
        const base = cur ? cur.to : (w.deps || []);
        const to = base.filter(d => !removed.has(depId(d)));
        if (cur) cur.to = to;
        else edits.push({ op: 'set', type: 'workItem', id: w.id, field: 'deps', from: clone(w.deps || []), to, label: w.title || 'untitled task', auto: true });
      });
    });
    /* R13: only when no edit was refused for its own reason (a refused holiday date is the whole story) */
    if (!edits.length && errors.length === (reason ? 0 : 1)) errors.push('Nothing changes yet. Pick at least one edit.');
    const title = clean(input.title, 100) || autoTitle(edits, docs, eng);
    const change = { projectId, title, reason, category, source, kinds: kindsOf(edits, source), edits };
    if (Array.isArray(input.ackSteps)) change.ackSteps = input.ackSteps.filter(x => typeof x === 'string').slice(0, 200);
    return { change, errors };
  }

  /* ------------------------------------------------------------------ */
  /* applyToDocs: the change applied to a copy of the docs              */
  /* ------------------------------------------------------------------ */
  /* `at` stamps updatedAt on edited tasks, exactly as the doc store does on save (so the engine sees the same
     approval staleness the real save will cause). */
  function applyToDocs(docs, change, at) {
    const out = Object.assign({}, docs);
    const edits = (change && change.edits) || [];
    const stamp = at || (change && (change.appliedAt || change.requestedAt)) || null;
    if (edits.some(e => e.type === 'workItem')) {
      let arr = ((docs && docs.workItem) || []).map(e => ({ id: e.id, data: e.data }));
      const touched = new Set();
      const mut = id => { const i = arr.findIndex(x => x.id === id); if (i < 0) return null; if (!touched.has(id)) { arr[i] = { id, data: clone(arr[i].data) }; touched.add(id); } return arr[i].data; };
      edits.forEach(e => {
        if (e.type !== 'workItem') return;
        if (e.op === 'set') { const w = mut(e.id); if (!w) return; w[e.field] = clone(e.to); if (stamp) w.updatedAt = stamp; }
        else if (e.op === 'add') { const d = Object.assign(clone(e.data), { id: e.id }); if (stamp) d.updatedAt = stamp; arr = arr.filter(x => x.id !== e.id).concat([{ id: e.id, data: d }]); }
        else if (e.op === 'remove') arr = arr.filter(x => x.id !== e.id);
      });
      out.workItem = arr;
    }
    const pe = edits.filter(e => e.type === 'project');
    if (pe.length) {
      out.project = ((docs && docs.project) || []).map(e => {
        const mine = pe.filter(x => x.id === e.id);
        if (!mine.length) return e;
        const d = clone(e.data);
        mine.forEach(x => { if (x.field === 'budget') d.budget = Object.assign({}, d.budget || {}, { planned: x.to }); else d[x.field] = x.to; });
        return { id: e.id, data: d };
      });
    }
    return out;
  }

  /* Edits whose starting point moved since the change was proposed (someone else edited the plan). [] when none. */
  function conflicts(docs, change) {
    const out = [];
    ((change && change.edits) || []).forEach(e => {
      if (e.op === 'set' && e.type === 'workItem') {
        const w = get(docs, 'workItem', e.id);
        if (!w) out.push('“' + (e.label || 'a task') + '” was deleted');
        else if (!same(w[e.field] === undefined ? null : w[e.field], e.from)) out.push('“' + (e.label || 'a task') + '” ' + (FIELD_LABEL[e.field] || e.field) + ' changed');
      } else if (e.op === 'set' && e.type === 'project') {
        const p = get(docs, 'project', e.id);
        const cur = !p ? undefined : e.field === 'budget' ? budgetOf(p) : (p.target || null);
        if (!p || !same(cur, e.from)) out.push((e.field === 'budget' ? 'the budget' : 'the deadline') + ' changed');
      } else if (e.op === 'add') {
        if (get(docs, 'workItem', e.id)) out.push('a task with the same id already exists');
      } else if (e.op === 'remove') {
        if (!get(docs, 'workItem', e.id)) out.push('“' + (e.label || 'a task') + '” was already removed');
      }
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* impact: run the engine before and after, compare                   */
  /* ------------------------------------------------------------------ */
  function impact(docsBefore, docsAfter, projectId, today, opts) {
    opts = opts || {};
    const eng = E(opts.engine);
    const change = opts.change || null;
    const tb = eng.projectTruth(docsBefore, projectId, today), ta = eng.projectTruth(docsAfter, projectId, today);
    if (!tb || !ta) return null;
    const fb = eng.forecastAll(docsBefore, today), fa = eng.forecastAll(docsAfter, today);
    const edits = (change && change.edits) || [];
    const edited = new Set(edits.filter(e => e.type === 'workItem' && !e.auto).map(e => e.id));
    const projectB = get(docsBefore, 'project', projectId), projectA = get(docsAfter, 'project', projectId);
    /* knock-on: open tasks whose forecast finish moves although nobody edited them */
    const dependents = new Set();
    edited.forEach(id => { if (get(docsAfter, 'workItem', id)) (eng.dependents(docsAfter, id) || []).forEach(x => dependents.add(x)); });
    edits.filter(e => e.op === 'remove').forEach(e => (eng.dependents(docsBefore, e.id) || []).forEach(x => dependents.add(x)));
    const knockOn = list(docsAfter, 'workItem').filter(w => w.status !== 'done' && !edited.has(w.id) && fb[w.id] && fa[w.id] && fb[w.id].forecast !== fa[w.id].forecast)
      .map(w => ({ id: w.id, title: w.title || 'untitled task', owner: w.owner || null, projectId: w.projectId, from: fb[w.id].forecast, to: fa[w.id].forecast,
        due: w.due || null, lateAfter: !!fa[w.id].late, dependent: dependents.has(w.id) }))
      .sort((a, b) => String(a.to || '').localeCompare(String(b.to || '')) || a.title.localeCompare(b.title));
    /* department approvals: approved before, not approved after */
    const apB = {}; (tb.approvals || []).forEach(a => { apB[a.bu] = a; });
    const reopened = (ta.approvals || []).filter(a => apB[a.bu] && apB[a.bu].approved && !a.approved)
      .map(a => ({ bu: a.bu, approver: apB[a.bu].approver || null, approverName: apB[a.bu].approver ? personName(docsBefore, apB[a.bu].approver) : null }));
    /* tests to run again: passing tests on the information used by steps whose work was added, removed or reshaped */
    const scopeTasks = edits.filter(e => e.op === 'add' || e.op === 'remove' || (e.op === 'set' && e.type === 'workItem' && (e.field === 'title' || e.field === 'effortDays')));
    const dataIds = new Set();
    scopeTasks.forEach(e => {
      const w = e.op === 'add' ? e.data : e.op === 'remove' ? e.from : get(docsAfter, 'workItem', e.id);
      if (!w || !w.pid || !w.step) return;
      const p = get(docsAfter, 'process', w.pid);
      const walk = nodes => (nodes || []).forEach(n => { if (!n) return; if (n.id === w.step) (n.data || []).forEach(d => dataIds.add(d)); (n.branches || []).forEach(b => walk(b && b.nodes)); });
      if (p) walk(p.tobe);
      if (w.resolves) dataIds.add(w.resolves);
    });
    const outcomes = eng.latestOutcomes(docsBefore, projectId) || {};
    const testsRerun = list(docsBefore, 'testCase').filter(c => dataIds.has(c.dataId) && outcomes[c.id] && outcomes[c.id].outcome === 'pass')
      .map(c => ({ id: c.id, dataId: c.dataId, field: c.field || '', label: eng.caseLabel ? eng.caseLabel(docsBefore, c.id) : (c.field || 'test') }));
    /* people affected */
    const people = new Map();
    const touch = (id, why) => { if (!id || !get(docsBefore, 'person', id) && !get(docsAfter, 'person', id)) return; if (!people.has(id)) people.set(id, []); const a = people.get(id); if (!a.includes(why)) a.push(why); };
    edits.forEach(e => {
      if (e.type !== 'workItem' || e.auto) return;
      if (e.op === 'set' && e.field === 'owner') { touch(e.from, 'no longer owns “' + e.label + '”'); touch(e.to, 'now owns “' + e.label + '”'); return; }
      if (e.op === 'add') { touch(e.data && e.data.owner, 'owns a new task'); return; }
      if (e.op === 'remove') { touch(e.from && e.from.owner, 'owned a removed task'); return; }
      const w = get(docsAfter, 'workItem', e.id); touch(w && w.owner, 'owns a task that changes');
    });
    knockOn.forEach(k => touch(k.owner, 'a task moves as a knock-on'));
    reopened.forEach(r => touch(r.approver, 'approves ' + r.bu + '’s part again'));
    const deadlineMoved = !same(projectB && projectB.target, projectA && projectA.target);
    const budgetMoved = !same(budgetOf(projectB), budgetOf(projectA));
    if (projectA && projectA.owner) touch(projectA.owner, 'project manager');
    const sponsor = sponsorOf(docsAfter, projectId);
    if (sponsor && (deadlineMoved || budgetMoved)) touch(sponsor, 'sponsor');
    /* R12 #13: knock-ons into OTHER projects, one entry per project, with that project's own finish before/after */
    const crossMap = new Map();
    knockOn.filter(k => k.projectId && k.projectId !== projectId).forEach(k => {
      if (!crossMap.has(k.projectId)) crossMap.set(k.projectId, []);
      crossMap.get(k.projectId).push({ id: k.id, title: k.title, owner: k.owner, from: k.from, to: k.to, due: k.due, lateAfter: k.lateAfter });
    });
    const crossProjects = [...crossMap.entries()].map(([pid, tasks]) => {
      const p = get(docsAfter, 'project', pid) || get(docsBefore, 'project', pid) || {};
      const xb = eng.projectTruth(docsBefore, pid, today), xa = eng.projectTruth(docsAfter, pid, today);
      if (p.owner) touch(p.owner, 'project manager of ' + (p.name || 'another project') + ' (a task there moves)');
      return { projectId: pid, name: p.name || 'another project', owner: p.owner || null, tasks: tasks.slice(0, MAX_LIST), taskCount: tasks.length,
        finish: { before: xb ? xb.forecastFinish : null, after: xa ? xa.forecastFinish : null }, late: { before: xb ? xb.lateCount : null, after: xa ? xa.lateCount : null } };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const costB = tb.cost && tb.cost.forecast, costA = ta.cost && ta.cost.forecast;
    const costDelta = costB != null && costA != null ? r2(costA - costB) : null;
    const costPct = costDelta == null ? null : costB ? r2(costDelta / costB * 100) : (costA ? 100 : 0);
    const out = {
      projectId, today: today || null,
      finish: { before: tb.forecastFinish, after: ta.forecastFinish },
      deadline: { before: tb.deadline, after: ta.deadline, moved: deadlineMoved },
      buffer: { before: tb.bufferDays, after: ta.bufferDays },
      misses: { before: !!(tb.deadline && tb.forecastFinish && tb.forecastFinish > tb.deadline), after: !!(ta.deadline && ta.forecastFinish && ta.forecastFinish > ta.deadline) },
      cost: { before: costB, after: costA, delta: costDelta, pct: costPct, basisBefore: tb.ev && tb.ev.EAC != null ? 'eac' : 'estimate', basisAfter: ta.ev && ta.ev.EAC != null ? 'eac' : 'estimate' },
      budget: { before: budgetOf(projectB), after: budgetOf(projectA), moved: budgetMoved },
      label: { before: tb.label, after: ta.label },
      late: { before: tb.lateCount, after: ta.lateCount },
      tasks: { before: tb.tasks.total, after: ta.tasks.total },
      knockOn: knockOn.slice(0, MAX_LIST), knockOnCount: knockOn.length, crossProjects,
      people: [...people.entries()].map(([id, why]) => ({ id, name: personName(docsAfter, id), why })).slice(0, MAX_LIST),
      approvalsReopen: reopened,
      testsRerun: testsRerun.slice(0, MAX_LIST), testsRerunCount: testsRerun.length,
    };
    out.sentence = sentenceOf(out, eng);
    return out;
  }

  function bufferPhrase(finish, deadline, bufferDays, still, eng) {
    if (!deadline || !finish || bufferDays == null) return '';
    if (bufferDays > 0) return ' (' + (still ? 'still ' : '') + plural(bufferDays, 'business day') + ' before the ' + day(deadline, eng) + ' deadline)';
    if (bufferDays === 0 || finish === deadline) return ' (on the ' + day(deadline, eng) + ' deadline)';
    return ' (' + plural(-bufferDays, 'business day') + ' after the ' + day(deadline, eng) + ' deadline)';
  }
  /* "This moves the expected finish from Nov 25 to Dec 2 (still 9 business days before the Dec 15 deadline) and reopens Treasury's approval." */
  function sentenceOf(im, eng) {
    const f = im.finish, dl = im.deadline;
    const still = !im.misses.before && !im.misses.after && f.before !== f.after && !dl.moved;
    let head;
    const moved = f.before && f.after && f.before !== f.after;
    if (!f.after) head = 'The project has no open work left';
    else if (moved) head = 'This moves the expected finish from ' + day(f.before, eng) + ' to ' + day(f.after, eng);
    else head = 'The expected finish stays ' + day(f.after, eng);
    if (dl.moved) {
      const b = im.buffer.after;
      head += (moved ? ', moves the deadline from ' : ' and the deadline moves from ') + day(dl.before, eng) + ' to ' + day(dl.after, eng) +
        (b == null || !f.after ? '' : b > 0 ? ' (now ' + plural(b, 'business day') + ' before it)' : b === 0 ? ' (now on the deadline)' : ' (still ' + plural(-b, 'business day') + ' after it)');
    }
    else head += bufferPhrase(f.after, dl.after, im.buffer.after, still, eng);
    const rest = [];
    if (im.budget.moved) rest.push('sets the budget to ' + money(im.budget.after) + ' (was ' + money(im.budget.before) + ')');
    if (im.cost.delta != null && Math.abs(im.cost.delta) >= 1) rest.push((im.cost.delta > 0 ? 'raises' : 'lowers') + ' the expected cost by ' + money(Math.abs(im.cost.delta)) + ' (' + Math.abs(im.cost.pct).toFixed(1) + '%)');
    if (im.approvalsReopen.length) rest.push('reopens ' + joinAnd(im.approvalsReopen.map(a => a.bu + '’s')) + ' ' + (im.approvalsReopen.length === 1 ? 'approval' : 'approvals'));
    (im.crossProjects || []).forEach(x => rest.push('moves ' + plural(x.taskCount != null ? x.taskCount : x.tasks.length, 'task') + ' in ' + x.name));
    if (!rest.length) return head + '.';
    return moved || dl.moved ? head + (rest.length === 1 && !dl.moved ? ' and ' + rest[0] : ', ' + joinAnd(rest)) + '.'
      : head + '; the change ' + joinAnd(rest) + '.';
  }

  /* ------------------------------------------------------------------ */
  /* tolerance and approvers                                            */
  /* ------------------------------------------------------------------ */
  /* {within, reasons: [plain text], approvers: [{role, person, projectId?, roles: [{role, projectId?}]}], blocked}.
     Within tolerance = deadline unaffected (not moved and the finish does not newly miss it or miss it by more), budget
     unchanged, cost moves < 5%, no approvals reopen.
     R13 #3 routing (opts.requester = who asks):
       - the project manager approves every change over tolerance;
       - a deadline breach (the deadline moves, or the finish moves past it) or a budget change needs the SPONSOR
         (sponsorOf: project.sponsor, else the project's default approver);
       - a knock-on into another project needs that project's manager;
       - the requester is NEVER an approver: a role the requester holds passes to the sponsor (of this project, or of the
         other project for a knock-on), with the requester excluded from the sponsor's fallback chain too;
       - one person counts once: a single entry per person carries every role they decide in.
     `blocked` is the reason when nobody but the requester could approve (the change cannot be sent). */
  function needsApproval(change, im, docs, opts) {
    opts = opts || {};
    const reasons = [];
    const pastDeadline = !im.deadline.moved && im.misses.after && (!im.misses.before || (im.finish.after > im.finish.before));
    if (im.deadline.moved) reasons.push('The deadline moves (' + day(im.deadline.before) + ' → ' + day(im.deadline.after) + ').');
    else if (pastDeadline) reasons.push('The expected finish moves past the ' + day(im.deadline.after) + ' deadline.');
    if (im.budget.moved) reasons.push('The budget changes (' + money(im.budget.before) + ' → ' + money(im.budget.after) + ').');
    if (im.cost.pct != null && Math.abs(im.cost.pct) >= COST_TOLERANCE_PCT) reasons.push('The expected cost changes by ' + Math.abs(im.cost.pct).toFixed(1) + '% (more than ' + COST_TOLERANCE_PCT + '%).');
    if (im.approvalsReopen.length) reasons.push(joinAnd(im.approvalsReopen.map(a => a.bu + '’s')) + ' ' + (im.approvalsReopen.length === 1 ? 'approval reopens' : 'approvals reopen') + '.');
    /* R12 #13: a knock-on into another project needs that project's manager too */
    const cross = (im.crossProjects || []);
    cross.forEach(x => reasons.push('It moves ' + plural(x.taskCount != null ? x.taskCount : x.tasks.length, 'task') + ' in ' + x.name + ' (another project), so its project manager approves too.'));
    const within = !reasons.length;
    const project = get(docs, 'project', change.projectId);
    const requester = opts.requester || change.requestedBy || null;
    const breach = im.deadline.moved || pastDeadline;
    if (within || !project) return { within, reasons, approvers: [], blocked: '' };
    if (breach) reasons.push('A change past the deadline needs the sponsor’s approval.');
    const need = [];      /* [{role, person|null, projectId?}] before merging */
    const missing = [];
    const sponsorFor = (prj, role, pid) => {
      const sp = sponsorOf(docs, prj, [requester]);
      if (sp) need.push(pid ? { role, person: sp, projectId: pid } : { role, person: sp });
      else missing.push(pid ? 'a sponsor for ' + (prj.name || 'the other project') : 'a sponsor for ' + (project.name || 'the project'));
    };
    /* this project's manager, or the sponsor for them when they asked */
    if (project.owner && get(docs, 'person', project.owner) && project.owner !== requester) need.push({ role: 'pm', person: project.owner });
    if (breach || im.budget.moved || !need.length) sponsorFor(project, 'sponsor');
    /* each other project's manager, or its sponsor when its manager asked */
    cross.forEach(x => {
      const other = get(docs, 'project', x.projectId);
      if (x.owner && get(docs, 'person', x.owner) && x.owner !== requester) need.push({ role: 'linkedPm', person: x.owner, projectId: x.projectId });
      else if (other) sponsorFor(other, 'linkedSponsor', x.projectId);
    });
    /* one person counts once */
    const approvers = [];
    need.forEach(n => {
      const r = n.projectId ? { role: n.role, projectId: n.projectId } : { role: n.role };
      const hit = approvers.find(a => a.person === n.person);
      if (hit) { if (!hit.roles.some(x => x.role === r.role && x.projectId === r.projectId)) hit.roles.push(r); return; }
      approvers.push(Object.assign({}, n, { roles: [r] }));
    });
    const blocked = !approvers.length || missing.length
      ? 'Nobody besides ' + (requester ? personName(docs, requester) : 'the requester') + ' can approve this change: ' + (project.name || 'the project') + ' needs ' + joinAnd([...new Set(missing.length ? missing : ['a sponsor'])]) +
        ' who did not ask for it. Set the sponsor in the project’s settings, then propose it again.'
      : '';
    return { within, reasons, approvers, blocked };
  }
  /* approvers still to decide */
  function pendingApprovers(change) { return ((change && change.approvers) || []).filter(a => !a.decision); }
  function waitingText(change, docs) {
    const p = pendingApprovers(change);
    if (!p.length) return '';
    /* one name per person, with every role they decide in ("Tom Alvarez (project manager and project manager of ERP …)") */
    const by = new Map();
    p.forEach(a => { if (!by.has(a.person)) by.set(a.person, []); const r = roleText(a, docs); if (!by.get(a.person).includes(r)) by.get(a.person).push(r); });
    return 'Waiting for ' + joinAnd([...by.entries()].map(([id, roles]) => personName(docs, id) + ' (' + joinAnd(roles) + ')'));
  }

  /* ------------------------------------------------------------------ */
  /* traceability                                                       */
  /* ------------------------------------------------------------------ */
  /* A project's log: its own changes, plus (R12 #13) changes of other projects still waiting for a decision that would
     move tasks here. Once such a change is applied, the linked entry written into this project's log stands for it. */
  function changesOf(docs, projectId) {
    return list(docs, 'planChange').filter(c => !projectId || c.projectId === projectId || (pendingHere(c, projectId)))
      .sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')));
  }
  function pendingHere(c, projectId) {
    return (c.status === 'proposed' || c.status === 'approved') && c.projectId !== projectId &&
      (((c.impact || {}).crossProjects || []).some(x => x.projectId === projectId) || (c.approvers || []).some(a => (hasRole(a, 'linkedPm', projectId) || hasRole(a, 'linkedSponsor', projectId))));
  }
  /* R12 #13: the entry written into another project's log when a change with a knock-on there is applied */
  function linkedEntry(change, docsBefore, docsAfter, otherId, today, opts) {
    opts = opts || {};
    const eng = E(opts.engine);
    const src = get(docsBefore, 'project', change.projectId) || {};
    const x = (((change.impact || {}).crossProjects) || []).find(p => p.projectId === otherId) || null;
    const im0 = impact(docsBefore, docsAfter, otherId, today, { change, engine: eng });
    const tasks = x ? x.tasks : (im0 ? (im0.knockOn || []).filter(k => k.projectId === otherId) : []);
    const srcName = src.name || 'another project';
    /* seen from this project: only its own tasks move; the change's own project is where it came from, not "another project" */
    let im = im0;
    if (im0) {
      const ko = (im0.knockOn || []).filter(k => k.projectId === otherId);
      const mine = new Set(ko.map(k => k.owner).filter(Boolean));
      const p = get(docsAfter, 'project', otherId) || {};
      im = Object.assign({}, im0, { knockOn: ko, knockOnCount: ko.length, crossProjects: [], approvalsReopen: im0.approvalsReopen || [], testsRerun: [], testsRerunCount: 0,
        people: (im0.people || []).filter(pp => mine.has(pp.id) || pp.id === p.owner).map(pp => ({ id: pp.id, name: pp.name, why: pp.id === p.owner && !mine.has(pp.id) ? ['project manager'] : ['a task moves as a knock-on'] })) });
      im.sentence = sentenceOf(im, eng);
    }
    return {
      projectId: otherId, source: 'knockOn', kinds: ['dates'], edits: [], category: change.category || null,
      title: clean(change.title || 'Plan change', 100),
      reason: clean('A plan change on ' + srcName + ' moves ' + plural(tasks.length, 'task') + ' here: ' + (change.reason || ''), 200),
      linkedFrom: { projectId: change.projectId, changeId: change.id, projectName: srcName },
      knockOn: tasks.map(t => ({ id: t.id, title: t.title, owner: t.owner || null, from: t.from, to: t.to, lateAfter: !!t.lateAfter })),
      approvers: (change.approvers || []).filter(a => hasRole(a, 'linkedPm', otherId) || hasRole(a, 'linkedSponsor', otherId)).map(a => clone(a)),
      tolerance: { within: false, reasons: ['A plan change on ' + srcName + ' moves work in this project.'] },
      impact: im,
      requestedBy: change.requestedBy || null, requestedAt: change.requestedAt || null, decidedBy: change.decidedBy || null, decidedAt: change.decidedAt || null,
    };
  }
  /* plan changes that touched one task (proposed, applied or rejected), newest first */
  function changesForTask(docs, taskId) {
    return changesOf(docs).filter(c => (c.edits || []).some(e => e.type === 'workItem' && e.id === taskId && !e.auto));
  }
  /* start/due/owner of every task of a project: the "Saved plan" items (start, due), plus the owner for the log */
  function snapshot(docs, projectId) {
    const out = {};
    list(docs, 'workItem').filter(w => w.projectId === projectId).forEach(w => { out[w.id] = { start: w.start || null, due: w.due || null, owner: w.owner || null, title: w.title || '' }; });
    return out;
  }
  function baselineOf(docs, projectId, id, label, at, changeId) {
    const items = {};
    const snap = snapshot(docs, projectId);
    Object.keys(snap).forEach(k => { items[k] = { start: snap[k].start, due: snap[k].due }; });
    return { id, at, label: String(label).slice(0, 60), items, auto: true, changeId };
  }

  /* "Waiting for you": a pending approval of a plan change, in the engine's personQueue item shape. */
  const QUEUE_RANK = 50;   /* the engine's WHO_RANK.approval */
  function queueFor(docs, person, today) {
    if (!person) return [];
    return list(docs, 'planChange').filter(c => c.status === 'proposed' && c.requestedBy !== person && pendingApprovers(c).some(a => a.person === person)).map(c => {
      const p = get(docs, 'project', c.projectId);
      return { kind: 'planChange', projectId: c.projectId, id: c.id, title: 'Approve the plan change “' + c.title + '”', due: null, late: false,
        href: '/project/' + c.projectId + '/changes?change=' + encodeURIComponent(c.id), oneTap: null, why: 'approval', rank: QUEUE_RANK,
        what: 'Approve the plan change “' + c.title + '”', projectName: p ? p.name || '' : '' };
    }).sort((a, b) => a.title.localeCompare(b.title));
  }

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   /* no spreadsheet formula injection */
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const LOG_COLUMNS = ['Requested', 'Project', 'Title', 'Reason', 'Category', 'Status', 'Requested by', 'Decided by', 'Decided', 'Applied', 'Expected finish before', 'Expected finish after',
    'Deadline before', 'Deadline after', 'Expected cost before', 'Expected cost after', 'Approvals reopened', 'Knock-on tasks', 'Tests to run again', 'Within tolerance', 'Edits', 'Change id'];
  function logRows(changes, docs, eng) {
    const cat = id => (CATEGORIES.find(c => c.id === id) || {}).label || '';
    const rows = [LOG_COLUMNS.slice()];
    const editsOf = c => (c.linkedFrom ? (c.knockOn || []).map(k => '“' + k.title + '”: expected finish ' + day(k.from, eng) + ' → ' + day(k.to, eng) + ' (knock-on)') : (c.edits || []).filter(e => !e.auto).map(e => editText(e, docs, eng)));
    (changes || []).forEach(c => {
      const im = c.impact || {};
      const p = get(docs, 'project', c.projectId);
      const decider = c.decidedBy ? personName(docs, c.decidedBy) : '';
      rows.push([
        c.requestedAt || '', p ? p.name : c.projectId, c.title || '', c.reason || '', cat(c.category), STATUS_LABEL[c.status] || c.status || '',
        personName(docs, c.requestedBy), decider, c.decidedAt || '', c.appliedAt || '',
        (im.finish || {}).before || '', (im.finish || {}).after || '', (im.deadline || {}).before || '', (im.deadline || {}).after || '',
        (im.cost || {}).before != null ? im.cost.before : '', (im.cost || {}).after != null ? im.cost.after : '',
        (im.approvalsReopen || []).map(a => a.bu).join('; '), im.knockOnCount != null ? im.knockOnCount : '', im.testsRerunCount != null ? im.testsRerunCount : '',
        c.tolerance ? (c.tolerance.within ? 'yes' : 'no') : '',
        editsOf(c).join('; '), c.id || '',
      ]);
    });
    return rows;
  }
  function toCSV(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }

  /* ------------------------------------------------------------------ */
  /* process changed mid-project                                        */
  /* ------------------------------------------------------------------ */
  function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function walkNodes(nodes, fn) { (nodes || []).forEach(n => { if (!n) return; fn(n); (n.branches || []).forEach(b => walkNodes(b && b.nodes, fn)); }); }
  /* A fingerprint of a process's Future map at one moment: {sigs: {nodeId: hash}, froms: [Today step ids it keeps]}. */
  function processRef(process, at) {
    const sigs = {}, froms = [];
    walkNodes(process && process.tobe, n => {
      if (n.type === 'end') return;
      sigs[n.id] = hashStr(JSON.stringify([n.type || '', n.title || '', n.owner || '', n.ownerRole || '', (n.data || []).slice().sort(), (n.touches || []).slice().sort(),
        n.from || '', (n.subs || []).map(s => s && s.title || ''), (n.branches || []).map(b => b && b.label || ''), n.calls || '', n.sla == null ? '' : n.sla, n.system || '']));
      if (n.from) froms.push(n.from);
    });
    return { at: at || (process && process.updatedAt) || null, sigs, froms };
  }
  /* Steps of the project's linked processes that are new or changed SINCE the reference (the plan's last update) and
     have no work in this project, plus Today steps newly dropped without a "Retire" task. refs: {pid: processRef}.
     Suggested tasks come from the engine's suggestWorkFromDiff, kept only for those steps.
     newId(i) names each suggested task; without it the engine's keys are used. */
  function processDrift(docs, projectId, refs, today, opts) {
    opts = opts || {};
    const eng = E(opts.engine);
    const project = get(docs, 'project', projectId);
    const none = { changed: false, steps: [], removed: [], suggestions: [], text: '', ackSteps: [] };
    if (!project || !refs) return none;
    const work = list(docs, 'workItem').filter(w => w.projectId === projectId);
    const steps = [], removed = [];
    (project.processes || []).forEach(pid => {
      const p = get(docs, 'process', pid), ref = refs[pid];
      if (!p || !ref || !ref.sigs) return;
      const now = processRef(p);
      const diff = eng.diffProcess(p);
      walkNodes(p.tobe, n => {
        const kind = diff.nodes[n.id];
        if (kind !== 'new' && kind !== 'changed') return;
        if (ref.sigs[n.id] && ref.sigs[n.id] === now.sigs[n.id]) return;           /* not changed since the plan */
        if (work.some(w => w.pid === pid && w.step === n.id)) return;
        steps.push({ pid, step: n.id, title: n.title || 'untitled step', kind, processName: p.name || '' });
      });
      (diff.removed || []).forEach(r => {
        if (!r || r.type === 'trigger' || r.type === 'end') return;
        if (!(ref.froms || []).includes(r.id)) return;                               /* already gone when the plan was made */
        if (work.some(w => w.retires === r.id && w.pid === pid)) return;
        removed.push({ pid, step: r.id, title: r.title || 'untitled step', processName: p.name || '' });
      });
    });
    if (!steps.length && !removed.length) return none;
    const keep = new Set(steps.map(s => s.pid + '/' + s.step)), keepR = new Set(removed.map(s => s.pid + '/' + s.step));
    const all = eng.suggestWorkFromDiff(docs, projectId, today) || [];
    const picked = all.filter(s => (s.step && keep.has(s.pid + '/' + s.step)) || (s.retires && keepR.has(s.pid + '/' + s.retires)));
    const keys = new Set(picked.map(s => s.key));
    const workIds = new Set(list(docs, 'workItem').map(w => w.id));
    const rename = {};
    picked.forEach((s, i) => { rename[s.key] = opts.newId ? opts.newId(i) : s.key; });
    const suggestions = eng.planToWork(projectId, picked).map(w => {
      const id = rename[w.id];
      const deps = (w.deps || []).filter(d => keys.has(depId(d)) || workIds.has(depId(d))).map(d => (keys.has(depId(d)) ? rename[depId(d)] : d));
      return Object.assign({}, w, { id, deps });
    });
    const nNew = steps.filter(s => s.kind === 'new').length, nCh = steps.length - nNew;
    const parts = [];
    if (steps.length) parts.push(joinAnd([nNew ? plural(nNew, 'new step') : '', nCh ? plural(nCh, 'changed step') : ''].filter(Boolean)) + ' ' + (steps.length === 1 ? 'has' : 'have') + ' no work');
    if (removed.length) parts.push(plural(removed.length, 'removed step') + ' ' + (removed.length === 1 ? 'has' : 'have') + ' no task to retire ' + (removed.length === 1 ? 'it' : 'them'));
    return { changed: true, steps, removed, suggestions, text: 'The process changed after this plan was made: ' + parts.join('; ') + '.',
      ackSteps: steps.map(s => s.pid + '/' + s.step).concat(removed.map(s => s.pid + '/-' + s.step)) };
  }

  return {
    KINDS, CATEGORIES, STATUS_LABEL, ROLE_LABEL, COST_TOLERANCE_PCT, LOG_COLUMNS,
    buildChange, applyToDocs, conflicts, impact, needsApproval, pendingApprovers, waitingText, sponsorOf, roleText, rolesOf, hasRole, offDayError, linkedEntry, pendingHere,
    editText, changesOf, changesForTask, snapshot, baselineOf, queueFor, logRows, toCSV, processRef, processDrift, sentenceOf,
  };
});
