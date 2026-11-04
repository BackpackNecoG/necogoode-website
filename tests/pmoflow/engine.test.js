// PMOFlow v3 engine tests (stream E). Run: node --test tests/pmoflow/engine.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const API_ENGINE = path.join(ROOT, 'api', 'shared', 'pmoflow-engine.js');
const WEB_ENGINE = path.join(ROOT, 'web', 'public', 'concepts', 'pmoflow', 'app', 'engine.js');
const E = require(API_ENGINE);

const TODAY = '2026-11-04';
const PRJ = 'vendor-modernization';

/* ---------------- fixture: mirrors the v2 scenario (fictional Northwind data) ---------------- */
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }
const wrap = arr => arr.map(d => ({ id: d.id, data: d }));

function baseDocs() {
  const person = [
    { id: 'mc', name: 'Maya Chen', role: 'Process Owner', color: '#7c3aed', bu: 'Procurement' },
    { id: 'ta', name: 'Tom Alvarez', role: 'Project Manager', color: '#0891b2', bu: 'PMO' },
    { id: 'ps', name: 'Priya Shah', role: 'Compliance SME', color: '#db2777', bu: 'Compliance' },
    { id: 'lp', name: 'Leo Park', role: 'Treasury SME', color: '#ea580c', bu: 'Treasury' },
    { id: 'ar', name: 'Ana Ruiz', role: 'AP Lead', color: '#16a34a', bu: 'Accounts Payable' },
    { id: 'dk', name: 'Dev Kumar', role: 'Integration Eng.', color: '#2563eb', bu: 'IT' },
  ];
  const dataElement = [
    { id: 'D1', name: 'Vendor legal name & Tax ID', avail: 'example', fields: [] },
    { id: 'D2', name: 'Bank remittance details', avail: 'missing', fields: [
      { name: 'Bank name', format: 'text', rule: 'Required', type: 'text', required: true },
      { name: 'Routing number', format: '9 digits', rule: 'Required', type: 'digits', length: 9, required: true },
      { name: 'Account holder', format: 'text', rule: 'Must match legal name', type: 'text', required: true, max: 40 },
      { name: 'Amount', format: 'currency', rule: '', type: 'currency', min: 0, max: 1000000 },
      { name: 'Account number', format: 'text, masked', rule: 'Required', type: 'text', required: true },
    ] },
    { id: 'D3', name: 'Certificate of insurance', avail: 'example', fields: [] },
    { id: 'D4', name: 'Vendor master record', avail: 'live', fields: [] },
    { id: 'D5', name: 'Sanctions screening result', avail: 'missing', fields: [] },
    { id: 'D6', name: 'Contract terms', avail: 'live', fields: [] },
    { id: 'D7', name: 'Approver matrix', avail: 'live', fields: [] },
    { id: 'D8', name: 'Vendor risk tier', avail: 'example', fields: [] },
    { id: 'D9', name: 'Payment hold list', avail: 'missing', fields: [] },
  ];
  const process = [
    { id: 'vendor-onboarding', name: 'Vendor Onboarding', owner: 'mc', resources: [], version: 1, released: [],
      asis: [
        { id: 'k', type: 'trigger', title: 'Vendor request emailed', owner: 'mc', data: [] },
        { id: 'a1', title: 'Email vendor for W-9 and COI', owner: 'mc', data: ['D1', 'D3'] },
        { id: 'a2', title: 'Manual sanctions lookup', owner: 'ps', data: ['D1'] },
        { id: 'a3', title: 'Receive bank letter by email', owner: 'lp', data: ['D2'] },
        { id: 'a4', title: 'Key vendor into ERP by hand', owner: 'ar', data: ['D1', 'D2'] },
        { id: 'a5', title: 'Activate contract', owner: 'mc', data: ['D6'] },
        { id: 'a6', title: 'Email requester when done', owner: 'mc', data: [] },
        { id: 'a7', title: 'Fax confirmation to vendor', owner: 'mc', data: [] },
        { id: 'e', type: 'end', title: 'Vendor active & payable' },
      ],
      tobe: [
        { id: 'k', type: 'trigger', title: 'Vendor request submitted', owner: 'mc', data: [] },
        { id: 's1', title: 'Collect vendor information', owner: 'mc', data: ['D1', 'D3'], from: 'a1',
          subs: [{ title: 'Vendor uploads W-9 and COI', data: ['D1', 'D3'] }] },
        { id: 's2', title: 'Sanctions & risk screening', owner: 'ps', data: ['D1', 'D5', 'D8'], from: 'a2' },
        { id: 'd1', type: 'decision', title: 'Risk tier?', branches: [
          { label: 'High', nodes: [{ id: 's2a', title: 'Enhanced due diligence', owner: 'ps', data: ['D3', 'D8'] }] },
          { label: 'Standard', nodes: [] },
        ] },
        { id: 's3', title: 'Capture banking details', owner: 'lp', data: ['D2'], from: 'a3' },
        { id: 's4', title: 'Create vendor master record', owner: 'ar', data: ['D1', 'D2', 'D4'], from: 'a4' },
        { id: 's5', title: 'Activate contract', owner: 'mc', data: ['D6', 'D4'], from: 'a5' },
        { id: 's6', title: 'Notify requester & approvers', owner: 'dk', data: ['D7'], from: 'a6' },
        { id: 'e', type: 'end', title: 'Vendor active & payable' },
      ] },
    { id: 'invoice-approval', name: 'Invoice Approval', owner: 'ar', resources: [], version: 1, released: [],
      asis: [
        { id: 'k', type: 'trigger', title: 'Invoice received in AP inbox', owner: 'ar', data: [] },
        { id: 'b1', title: 'Manual PO match', owner: 'ar', data: ['D4'] },
        { id: 'b2', title: 'Email approver', owner: 'ar', data: [] },
        { id: 'b3', title: 'Schedule payment', owner: 'lp', data: ['D2', 'D4'] },
        { id: 'e', type: 'end', title: 'Payment scheduled' },
      ],
      tobe: [
        { id: 'k', type: 'trigger', title: 'Invoice received', owner: 'ar', data: [] },
        { id: 'i1', title: 'Match to PO & vendor master', owner: 'ar', data: ['D4', 'D2'], from: 'b1' },
        { id: 'i2', title: 'Route for approval', owner: 'dk', data: ['D7'], from: 'b2' },
        { id: 'i3', title: 'Schedule payment', owner: 'lp', data: ['D2', 'D4'], from: 'b3' },
        { id: 'i4', title: 'Payment hold re-check', owner: 'ps', data: ['D9'] },
        { id: 'e', type: 'end', title: 'Payment scheduled' },
      ] },
  ];
  const W = (id, title, pid, step, owner, status, start, due, extra) =>
    Object.assign({ id, projectId: PRJ, pid, step, title, owner, status, start, due, deps: [] }, extra || {});
  const workItem = [
    W('W1', 'Launch vendor portal upload', 'vendor-onboarding', 's1', 'mc', 'done', '2026-10-08', '2026-10-20'),
    W('W2', 'Sign screening vendor contract', 'vendor-onboarding', 's2', 'ps', 'prog', '2026-10-28', '2026-11-10', { resolves: 'D5' }),
    W('W3', 'Integrate screening API', 'vendor-onboarding', 's2', 'dk', 'idle', '2026-11-11', '2026-11-17', { deps: ['W2'] }),
    W('W4', 'Define risk-tier scoring rules', 'vendor-onboarding', 's2', 'ps', 'prog', '2026-10-30', '2026-11-06'),
    W('W5', 'EDD checklist & sign-off form', 'vendor-onboarding', 's2a', 'ps', 'idle', '2026-11-07', '2026-11-12', { deps: ['W4'] }),
    W('W6', 'Stand up structured bank capture', 'vendor-onboarding', 's3', 'lp', 'idle', '2026-10-27', '2026-11-03', { resolves: 'D2' }),
    W('W7', 'Build micro-deposit verification', 'vendor-onboarding', 's3', 'dk', 'idle', '2026-11-04', '2026-11-10', { deps: ['W6'] }),
    W('W8', 'ERP vendor write integration', 'vendor-onboarding', 's4', 'dk', 'prog', '2026-11-02', '2026-11-14', { deps: ['W6'] }),
    W('W9', 'Notification automation', 'vendor-onboarding', 's6', 'dk', 'done', '2026-10-20', '2026-10-30'),
    W('W10', 'Remit-to check in 3-way match', 'invoice-approval', 'i1', 'ar', 'idle', '2026-11-15', '2026-11-20', { deps: ['W6', 'W8'] }),
    W('W11', 'Amount-based approval routing', 'invoice-approval', 'i2', 'dk', 'idle', '2026-11-10', '2026-11-20'),
  ];
  const project = [{ id: PRJ, name: 'Vendor Onboarding Modernization', owner: 'ta', resources: [], target: '2026-12-15',
    processes: ['vendor-onboarding', 'invoice-approval'], status: 'active',
    baselines: [{ id: 'b1', at: '2026-10-01', label: 'Kickoff', items: { W6: { start: '2026-10-27', due: '2026-11-03' }, W10: { start: '2026-11-15', due: '2026-11-20' } } }] }];
  // process data entries intentionally omit data.id: the engine must take the entry id.
  return {
    person: wrap(person), dataElement: wrap(dataElement), workItem: wrap(workItem), project: wrap(project),
    process: process.map(p => { const d = Object.assign({}, p); delete d.id; return { id: p.id, data: d }; }),
    grant: [], approval: [], testCase: [], testRun: [],
  };
}

// A project that passes every gate; individual tests break one thing at a time.
function readyDocs() {
  const d = baseDocs();
  d.workItem.forEach(e => { e.data.status = 'done'; });
  d.dataElement.forEach(e => { e.data.avail = 'live'; });
  const bus = ['Procurement', 'Compliance', 'Treasury', 'Accounts Payable', 'IT'];
  d.approval = bus.map((bu, i) => ({ id: 'AP' + i, data: { id: 'AP' + i, projectId: PRJ, bu, approver: i % 2 ? 'ta' : 'mc', decision: 'approved', at: '2026-11-01T10:00:00Z', stepUp: true, note: '' } }));
  d.testCase = wrap([
    { id: 'T1', dataId: 'D2', field: 'Routing number', kind: 'valid', input: '123456789', expect: 'accept', origin: 'spec' },
    { id: 'T2', dataId: 'D2', field: 'Routing number', kind: 'boundary', input: '12345678', expect: 'reject', origin: 'spec' },
    { id: 'TX', dataId: 'DX-unused', field: 'x', kind: 'valid', input: 'a', expect: 'accept', origin: 'user' },
  ]);
  d.testRun = wrap([
    { id: 'R1', projectId: PRJ, env: 'dev', at: '2026-11-01T09:00:00Z', by: 'dk', results: [{ caseId: 'T1', outcome: 'pass' }, { caseId: 'T2', outcome: 'pass' }, { caseId: 'TX', outcome: 'pass' }] },
    { id: 'R2', projectId: PRJ, env: 'uat', at: '2026-11-02T09:00:00Z', by: 'ar', results: [{ caseId: 'T1', outcome: 'pass' }, { caseId: 'T2', outcome: 'pass' }] },
  ]);
  E.generateUatScripts(d, PRJ).forEach(sc => d.testRun[1].data.results.push({ scriptId: sc.id, outcome: 'pass', evidence: 'screenshot' }));
  d.project[0].data.cutover = { window: 'Sat 06:00-10:00', rollbackOwner: 'dk', rollbackPlan: 'Restore v1 as-is', hypercareDays: 10, hypercareOwner: 'ta', comms: 'Teams' };
  d.grant = wrap([{ id: 'G1', projectId: PRJ, dataId: 'D2', env: 'uat', access: 'read', reason: 'UAT', requestedBy: 'dk', status: 'active', expires: '2026-12-01', log: [] }]);
  return d;
}
const check = (r, id) => r.checks.find(c => c.id === id);

/* ---------------- forecast ---------------- */
test('forecast: slip ripples from W6 through dependents with D2 as root cause', () => {
  const docs = deepFreeze(baseDocs());
  const fc = E.forecastAll(docs, TODAY);
  assert.equal(fc.W6.sched, 'late');
  assert.equal(fc.W6.forecast, '2026-11-11');         // today + 7-day duration
  assert.equal(fc.W6.slipDays, 8);
  assert.equal(fc.W6.cause, undefined);
  assert.equal(fc.W7.sched, 'slip');
  assert.equal(fc.W7.forecast, '2026-11-17');
  assert.equal(fc.W7.cause, 'D2');                      // W6 resolves D2
  assert.equal(fc.W7.causeWork, 'W6');
  assert.equal(fc.W8.sched, 'slip');
  assert.equal(fc.W8.forecast, '2026-11-23');
  assert.equal(fc.W10.forecast, '2026-11-28');         // binding constraint is W8
  assert.equal(fc.W10.sched, 'slip');
  assert.equal(fc.W10.cause, 'D2');                     // root cause traced through W8 to W6
  assert.equal(fc.W10.slipDays, 8);
  assert.equal(fc.W1.sched, 'done');
  assert.equal(fc.W4.sched, 'soon');
  assert.equal(fc.W3.sched, 'ok');
  assert.deepEqual(E.dependents(docs, 'W6').sort(), ['W10', 'W7', 'W8']);
});

test('forecast: dependency cycle terminates', () => {
  const d = baseDocs();
  d.workItem.find(e => e.id === 'W2').data.deps = ['W3'];   // W2 <-> W3
  d.workItem.find(e => e.id === 'W1').data.deps = ['W1'];   // self loop
  deepFreeze(d);
  const fc = E.forecastAll(d, TODAY);
  assert.ok(fc.W2.forecast && fc.W3.forecast);
  const deps = E.dependents(d, 'W2');
  assert.ok(deps.includes('W3') && !deps.includes('W2'));
});

/* ---------------- step state, stats, data ---------------- */
test('stepState, projectStats, dataReady, impactOfData, flatSteps', () => {
  const docs = deepFreeze(baseDocs());
  const s3 = E.stepState(docs, PRJ, 'vendor-onboarding', 's3', TODAY);
  assert.equal(s3.status, 'idle');
  assert.equal(s3.sched, 'late');
  assert.deepEqual(s3.blockers, ['D2']);
  assert.equal(s3.next, '2026-11-03');
  const s6 = E.stepState(docs, PRJ, 'vendor-onboarding', 's6', TODAY);
  assert.equal(s6.status, 'done');
  assert.deepEqual(s6.blockers, []);
  assert.equal(E.stepState(docs, PRJ, 'vendor-onboarding', 's5', TODAY).status, 'none');
  const st = E.projectStats(docs, PRJ, TODAY);
  assert.deepEqual([st.total, st.done, st.pct, st.late, st.slip], [11, 2, 18, 1, 3]);
  assert.equal(st.finish, '2026-11-28');
  assert.equal(st.onTrack, true);
  assert.equal(E.dataReady(docs, 'D4'), true);
  assert.equal(E.dataReady(docs, 'D2'), false);
  assert.equal(E.dataReady(docs, 'D1'), false);          // examples only is not live
  assert.deepEqual(E.impactOfData(docs, 'D2').map(x => x.stepId).sort(), ['i1', 'i3', 's3', 's4']);
  const proc = docs.process[0].data;
  assert.deepEqual(E.flatSteps(proc.tobe).map(s => s.id), ['s1', 's2', 's2a', 's3', 's4', 's5', 's6']);
});

/* ---------------- diff ---------------- */
test('diffProcess classifies new / changed / same / removed', () => {
  const docs = deepFreeze(baseDocs());
  const vo = E.diffProcess(docs.process[0].data);
  assert.equal(vo.nodes.s2a, 'new');
  assert.equal(vo.nodes.s1, 'changed');
  assert.ok(vo.changes.s1.some(c => c.startsWith('Title')));
  assert.equal(vo.nodes.s5, 'changed');
  assert.deepEqual(vo.changes.s5, ['Data added: D4']);
  assert.ok(vo.changes.s2.includes('Data added: D5, D8'));
  assert.deepEqual(vo.removed.map(n => n.id), ['a7']);  // trigger/end ignored
  assert.equal(vo.nodes.k, undefined);
  const ia = E.diffProcess(docs.process[1].data);
  assert.equal(ia.nodes.i3, 'same');
  assert.equal(ia.nodes.i2, 'changed');
  assert.ok(ia.changes.i2.includes('Owner ar → dk'));
  assert.equal(ia.nodes.i4, 'new');
});

/* ---------------- readiness ---------------- */
test('readiness: scenario project fails work-done and data-live', () => {
  const r = E.readiness(deepFreeze(baseDocs()), PRJ, TODAY);
  assert.equal(r.pass, false);
  assert.deepEqual(r.checks.map(c => c.id), ['work-done', 'data-live', 'discovered-resolved', 'process-valid', 'tests-passed', 'grants-closed', 'bu-signoff', 'two-person', 'cutover-plan', 'exceptions']);
  assert.equal(check(r, 'cutover-plan').pass, false);
  r.checks.forEach(c => assert.ok('id' in c && 'label' in c && 'pass' in c && 'detail' in c && Array.isArray(c.items)));
  assert.equal(check(r, 'work-done').pass, false);
  assert.equal(check(r, 'data-live').pass, false);
  assert.ok(check(r, 'data-live').items.includes('D2'));
  assert.equal(check(r, 'bu-signoff').pass, false);
  assert.equal(check(r, 'two-person').pass, false);
});

test('readiness: ready project passes; active grant is listed as expiring', () => {
  const r = E.readiness(deepFreeze(readyDocs()), PRJ, TODAY);
  r.checks.forEach(c => assert.equal(c.pass, true, c.id + ': ' + c.detail));
  assert.equal(r.pass, true);
  const g = check(r, 'grants-closed');
  assert.deepEqual(g.expiring, ['G1']);
  assert.match(g.detail, /expire automatically at go-live/);
  assert.ok(!check(r, 'tests-passed').unrun.includes('TX'));   // unused data's cases need no UAT coverage
});

test('readiness: each check fails on its own condition', () => {
  let d = readyDocs(); d.grant.push({ id: 'G2', data: { id: 'G2', projectId: PRJ, status: 'requested', log: [] } });
  let r = E.readiness(deepFreeze(d), PRJ, TODAY);
  assert.equal(check(r, 'grants-closed').pass, false); assert.equal(r.pass, false);

  d = readyDocs(); d.grant[0].data.status = 'approved';
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'grants-closed').pass, false);

  d = readyDocs(); d.approval[2].data.stepUp = false;          // Treasury without step-up
  r = E.readiness(d, PRJ, TODAY);
  assert.deepEqual(check(r, 'bu-signoff').items, ['Treasury']);

  d = readyDocs(); d.approval.push({ id: 'AP9', data: { id: 'AP9', projectId: PRJ, bu: 'IT', approver: 'dk', decision: 'rejected', at: '2026-11-03T10:00:00Z', stepUp: true } });
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'bu-signoff').pass, false);   // latest decision wins

  d = readyDocs(); d.approval.forEach(a => { a.data.approver = 'mc'; });
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'two-person').pass, false);

  d = readyDocs(); d.testRun[1].data.results[0].outcome = 'fail';
  r = E.readiness(d, PRJ, TODAY);
  assert.deepEqual(check(r, 'tests-passed').failing, ['T1']);

  d = readyDocs(); d.testRun[1].data.results = d.testRun[1].data.results.filter(x => x.caseId !== 'T2');
  r = E.readiness(d, PRJ, TODAY);
  assert.deepEqual(check(r, 'tests-passed').unrun, ['T2']);

  d = readyDocs(); d.workItem[5].data.status = 'prog';
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'work-done').items, ['W6']);

  d = readyDocs(); d.dataElement.find(e => e.id === 'D9').data.avail = 'missing';
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'data-live').items, ['D9']);

  // R2: an edit after sign-off is still listed by `exceptions` (warning), and now blocks through `bu-signoff`.
  d = readyDocs(); d.workItem[5].data.updatedAt = '2026-11-02T08:00:00Z';   // W6 (Treasury step) edited after approval
  r = E.readiness(d, PRJ, TODAY);
  const ex = check(r, 'exceptions');
  assert.equal(ex.warning, true); assert.equal(ex.pass, false); assert.deepEqual(ex.items, ['W6']);
  const bu = check(r, 'bu-signoff');
  assert.equal(bu.pass, false); assert.deepEqual(bu.items, ['Treasury']);
  assert.match(bu.detail, /Treasury: re-approval needed: Stand up structured bank capture/);
  assert.deepEqual(bu.stale, [{ bu: 'Treasury', changed: ['workItem:W6'], reason: 're-approval needed: Stand up structured bank capture' }]);
  assert.equal(r.pass, false);
  d = readyDocs(); d.workItem[5].data.updatedAt = '2026-10-30T08:00:00Z';   // edited before approval: fine
  assert.equal(E.readiness(d, PRJ, TODAY).pass, true);
});

/* ---------------- profiler ---------------- */
const RAW_ROWS = [
  ['Northwind Bank, N.A.', '021000021', 'Contoso "Holdings" LLC', '1250.50', 'line one\r\nline two', '55501234'],
  ['Fabrikam Credit Union', '11122233', 'Chloé Brontë Ltd', '980.00', 'plain', '55509876'],
  ['Tailspin Savings', '031100649', 'Adventure Works, Inc.', '15.25', '', '55504321'],
  ['', '021200339', 'Wide World Importers', '700.75', 'x', '55507777'],
];
function toCsv(rows) {
  const q = v => /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  return ['Bank name,Routing_Number,Account holder,Amount,Notes,account number'].concat(rows.map(r => r.map(q).join(','))).join('\r\n') + '\r\n';
}
const CSV = toCsv(RAW_ROWS);

test('parseCsv handles quotes, escaped quotes, embedded commas and CRLF', () => {
  const rows = E.parseCsv(CSV);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[1], RAW_ROWS[0]);
  assert.deepEqual(rows[2], RAW_ROWS[1]);
  assert.deepEqual(E.parseCsv('a,b\n"x,""y""",\n'), [['a', 'b'], ['x,"y"', '']]);
});

test('profileCsv statistics', () => {
  const cols = E.profileCsv(CSV, {});
  const by = n => cols.find(c => c.name === n);
  assert.equal(cols.length, 6);
  const bank = by('Bank name');
  assert.deepEqual([bank.rows, bank.nulls, bank.distinct], [4, 1, 3]);
  assert.ok(bank.specials.includes(',') && bank.specials.includes('.'));
  const rt = by('Routing_Number');
  assert.deepEqual([rt.minLen, rt.maxLen], [8, 9]);
  assert.equal(rt.min, undefined);                       // identifier-like: no numeric min/max
  assert.deepEqual(rt.patterns[0], { pattern: '9{9}', count: 3 });
  assert.ok(rt.examples.includes('099999991'));          // masked 021000021
  const amt = by('Amount');
  assert.deepEqual([amt.min, amt.max], [15.25, 1250.5]);
  const holder = by('Account holder');
  assert.ok(holder.charClasses.includes('unicode'));
  assert.ok(holder.specials.includes('"'));
  assert.equal(E.maskValue('Ab-12c'), 'Ax-99c');
  assert.equal(E.profileCsv(CSV, { maxRows: 2 })[0].rows, 2);
});

function allStrings(o, out = []) {
  if (typeof o === 'string') out.push(o);
  else if (o && typeof o === 'object') Object.keys(o).forEach(k => { out.push(k); allStrings(o[k], out); });
  return out;
}
test('profileCsv never outputs raw values', () => {
  const strings = allStrings(E.profileCsv(CSV, {}));
  const raws = RAW_ROWS.flat().map(v => v.trim()).filter(v => v.length >= 3);
  for (const raw of raws) for (const s of strings) assert.ok(!s.includes(raw), 'raw value leaked: ' + JSON.stringify(raw));
});

/* ---------------- spec drift + generated tests ---------------- */
test('specDrift flags an 8-digit routing number against a 9-digit spec, and more', () => {
  const docs = baseDocs();
  const d2 = docs.dataElement.find(e => e.id === 'D2').data;
  const drift = E.specDrift(d2, { columns: E.profileCsv(CSV, {}) });
  const has = (field, issue) => drift.some(x => x.field === field && x.issue === issue);
  assert.ok(has('Routing number', 'length-mismatch'));
  assert.match(drift.find(x => x.field === 'Routing number').detail, /length 9 digits.*length 8–9/);
  assert.ok(has('Bank name', 'required-nulls'));
  assert.ok(has('Notes', 'unspecified-column'));
  assert.ok(!has('Account number', 'missing-column'));  // matched case/punctuation-insensitively
  const drift2 = E.specDrift({ fields: [
    { name: 'Routing number', type: 'digits', length: 9 }, { name: 'Amount', type: 'currency', min: 0, max: 1000 }, { name: 'Missing one', type: 'text' },
  ] }, E.profileCsv('Routing number,Amount\n12-345678,1500\n123456789,abc\n', {}));
  const has2 = (field, issue) => drift2.some(x => x.field === field && x.issue === issue);
  assert.ok(has2('Routing number', 'non-digit'));
  assert.ok(has2('Amount', 'type-mismatch'));
  assert.ok(has2('Missing one', 'missing-column'));
  const drift3 = E.specDrift({ fields: [{ name: 'Amount', type: 'currency', min: 0, max: 1000 }, { name: 'Code', type: 'text', column: 'cd', pattern: '##-###' }] },
    E.profileCsv('Amount,cd\n1500,12-345\n-3,1234\n', {}));
  assert.ok(drift3.some(x => x.issue === 'out-of-range' && /above/.test(x.detail)));
  assert.ok(drift3.some(x => x.issue === 'out-of-range' && /below/.test(x.detail)));
  assert.ok(drift3.some(x => x.field === 'Code' && x.issue === 'pattern-mismatch'));
});

test('generateTests produces valid/boundary/invalid/edge cases, synthetic and deduped', () => {
  const d2 = baseDocs().dataElement.find(e => e.id === 'D2').data;
  const cases = E.generateTests(d2, E.profileCsv(CSV, {}));
  const kinds = new Set(cases.map(c => c.kind));
  ['valid', 'boundary', 'invalid', 'edge'].forEach(k => assert.ok(kinds.has(k), 'missing kind ' + k));
  const rt = cases.filter(c => c.field === 'Routing number');
  assert.ok(rt.some(c => c.kind === 'boundary' && c.input.length === 8 && c.expect === 'reject'));
  assert.ok(rt.some(c => c.kind === 'boundary' && c.input.length === 10 && c.expect === 'reject'));
  assert.ok(rt.some(c => c.kind === 'invalid' && c.input === '' && c.expect === 'reject'));
  assert.ok(rt.some(c => c.kind === 'invalid' && /[A-Z]/.test(c.input)));
  assert.ok(rt.some(c => c.kind === 'edge' && /Leading zero/.test(c.note) && c.input[0] === '0'));
  const holder = cases.filter(c => c.field === 'Account holder');
  assert.ok(holder.some(c => /Unicode/.test(c.note) && c.expect === 'accept'));
  assert.ok(holder.some(c => c.kind === 'boundary' && c.input.length === 41 && c.expect === 'reject'));
  assert.ok(cases.some(c => c.origin === 'profile' && /special character/.test(c.note)));
  assert.ok(cases.some(c => c.field === 'Amount' && c.kind === 'boundary' && c.input === '1000000.01' && c.expect === 'reject'));
  cases.forEach(c => { assert.equal(c.id, undefined); assert.equal(c.dataId, 'D2'); });
  const keys = cases.map(c => c.field + '|' + c.input);
  assert.equal(new Set(keys).size, keys.length);           // deduped
  const raws = RAW_ROWS.flat().filter(v => v.length >= 3);
  cases.forEach(c => assert.ok(!raws.some(r => c.input.includes(r)), 'raw value in input ' + c.input));
  // expectations agree with the engine's own validator
  cases.forEach(c => assert.equal(E.validate(E.fieldSpec(d2.fields.find(f => f.name === c.field)), c.input) ? 'accept' : 'reject', c.expect, c.field + ' ' + c.note));
  assert.ok(E.generateTests(d2).every(c => c.origin === 'spec'));
});

/* ---------------- portfolio ---------------- */
test('workload, baselineVariance, suggestWorkFromDiff', () => {
  const docs = deepFreeze(baseDocs());
  const wl = E.workload(docs, PRJ, TODAY);
  const dk = wl.find(r => r.person === 'dk');
  assert.deepEqual([dk.open, dk.late, dk.dueNext7], [4, 0, 1]);
  assert.equal(wl.find(r => r.person === 'lp').late, 1);
  assert.deepEqual(E.workload(docs, TODAY), wl);           // projectId optional
  const bv = E.baselineVariance(docs, PRJ, 'b1', TODAY);
  assert.deepEqual(bv.find(r => r.workId === 'W6'), { workId: 'W6', plannedDue: '2026-11-03', forecast: '2026-11-11', varianceDays: 8 });
  assert.equal(bv.find(r => r.workId === 'W10').varianceDays, 8);
  assert.equal(bv.find(r => r.workId === 'W1').plannedDue, null);
  const sug = E.suggestWorkFromDiff(docs, PRJ);
  assert.ok(sug.some(s => s.step === 's5' && s.pid === 'vendor-onboarding' && !s.resolves));
  assert.ok(sug.some(s => s.step === 'i4' && !s.resolves));
  assert.ok(sug.some(s => s.resolves === 'D9' && s.title === 'Make Payment hold list available'));
  assert.ok(!sug.some(s => s.resolves === 'D2' || s.resolves === 'D5'));   // resolvers exist
  assert.ok(!sug.some(s => s.step === 's3' || s.step === 'i3'));            // has work / unchanged
});

/* ---------------- packaging ---------------- */
test('engine files are byte-identical and the UMD exports the contract', () => {
  assert.ok(fs.readFileSync(API_ENGINE).equals(fs.readFileSync(WEB_ENGINE)));
  ['flatSteps', 'diffProcess', 'forecastAll', 'stepState', 'dataReady', 'dependents', 'impactOfData', 'projectStats', 'readiness',
    'profileCsv', 'specDrift', 'generateTests', 'workload', 'baselineVariance', 'suggestWorkFromDiff'].forEach(n => assert.equal(typeof E[n], 'function', n));
  const sandbox = {}; new Function('self', fs.readFileSync(WEB_ENGINE, 'utf8'))(sandbox);   // browser path: sets self.PMOEngine
  assert.equal(typeof sandbox.PMOEngine.forecastAll, 'function');
});

/* ================================ Round 2 ================================ */
test('R2 Bug 1: done items forecast at doneAt; finish/actualFinish; variance uses doneAt', () => {
  const d = baseDocs();
  d.workItem.forEach(e => { e.data.status = 'done'; e.data.doneAt = '2026-11-08'; });
  deepFreeze(d);
  const fc = E.forecastAll(d, TODAY);
  assert.equal(fc.W10.forecast, '2026-11-08');                // not the due date (Nov 20)
  assert.equal(fc.W6.slipDays, 5);
  const st = E.projectStats(d, PRJ, TODAY);
  assert.equal(st.finish, '2026-11-08');
  assert.equal(st.actualFinish, '2026-11-08');
  const bv = E.baselineVariance(d, PRJ, 'b1', TODAY);
  assert.equal(bv.find(r => r.workId === 'W6').varianceDays, 5);   // doneAt − baseline due (grader expected +5)
  assert.equal(bv.find(r => r.workId === 'W10').varianceDays, -12);
  assert.equal(bv.plannedFinish, '2026-11-20');
  assert.equal(bv.projectSlipDays, -12);                       // finish − max baseline due, not a sum
  // done without doneAt falls back to due
  const d2 = baseDocs(); d2.workItem.forEach(e => { e.data.status = 'done'; });
  assert.equal(E.projectStats(d2, PRJ, TODAY).finish, '2026-11-20');
});

test('R2: open-work finish ignores done items; projectSlipDays on the scenario', () => {
  const d = baseDocs();
  d.workItem.find(e => e.id === 'W9').data.doneAt = '2026-12-31';   // a late-recorded done item must not drive the open forecast
  const st = E.projectStats(d, PRJ, TODAY);
  assert.equal(st.finish, '2026-11-28');
  assert.equal(st.actualFinish, undefined);
  const bv = E.baselineVariance(deepFreeze(baseDocs()), PRJ, 'b1', TODAY);
  const sum = bv.reduce((a, r) => a + Math.max(0, r.varianceDays || 0), 0);
  assert.equal(bv.projectSlipDays, 8);                          // 11-28 − 11-20
  assert.notEqual(bv.projectSlipDays, sum);
  assert.ok(Array.isArray(bv) && bv.length === 11);
});

test('R2 readiness: stale via process updatedAt and snapshotAt', () => {
  let d = readyDocs();
  d.process[1].data.updatedAt = '2026-11-03T00:00:00Z';         // invoice-approval: owners ar, dk, lp, ps
  let bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.deepEqual(bu.items.sort(), ['Accounts Payable', 'Compliance', 'IT', 'Treasury']);
  assert.ok(bu.stale.every(x => x.changed.includes('process:invoice-approval')));
  d = readyDocs();
  d.approval.forEach(a => { a.data.snapshotAt = '2026-11-05T00:00:00Z'; });
  d.process[1].data.updatedAt = '2026-11-03T00:00:00Z';
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'bu-signoff').pass, true);
});

test('R2 readiness: discovered-resolved, process-valid, cutover-plan', () => {
  let d = readyDocs();
  const d2 = d.dataElement.find(e => e.id === 'D2').data;
  d2.discovered = [{ text: 'Routing can be 8 digits for legacy banks', fromRun: 'R2', at: '2026-11-02' }, { text: 'x', fromRun: 'R2', at: '2026-11-02', resolved: { by: 'lp', at: '2026-11-03', note: 'spec updated' } }];
  let c = check(E.readiness(d, PRJ, TODAY), 'discovered-resolved');
  assert.equal(c.pass, false); assert.deepEqual(c.items, ['D2#0']);
  d2.discovered[0].resolved = { by: 'lp', at: '2026-11-03', note: 'ok' };
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'discovered-resolved').pass, true);

  d = readyDocs();
  const vo = d.process[0].data;
  vo.tobe.find(n => n.id === 's5').owner = '';
  vo.tobe.find(n => n.id === 'd1').branches[0].goto = 'nope';
  vo.tobe.splice(1, 0, { id: 'g9', type: 'parallel', title: 'Empty fork', branches: [{ label: 'A', nodes: [] }, { label: 'B', nodes: [] }] });
  c = check(E.readiness(d, PRJ, TODAY), 'process-valid');
  assert.equal(c.pass, false);
  assert.deepEqual(c.items.sort(), ['vendor-onboarding:d1', 'vendor-onboarding:g9', 'vendor-onboarding:s5']);
  assert.match(c.detail, /missing node nope/);
  d = readyDocs();
  d.process[0].data.tobe.find(n => n.id === 'd1').branches[1].goto = 's1';    // valid loop-back
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'process-valid').pass, true);

  d = readyDocs(); d.project[0].data.cutover.rollbackPlan = ' ';
  c = check(E.readiness(d, PRJ, TODAY), 'cutover-plan');
  assert.equal(c.pass, false); assert.deepEqual(c.items, ['rollbackPlan']);
});

test('R2 readiness: stricter tests-passed', () => {
  let d = readyDocs(); d.testRun[0].data.results[2].outcome = 'fail';            // any dev fail blocks
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'tests-passed').failing, ['TX']);
  d = readyDocs(); d.testRun[1].data.results[0].outcome = 'blocked';
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'tests-passed').blocked, ['T1']);
  d = readyDocs(); const firstScript = d.testRun[1].data.results.find(x => x.scriptId).scriptId;
  d.testRun[1].data.results = d.testRun[1].data.results.filter(x => x.scriptId !== firstScript);
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'tests-passed').unrun, [firstScript]);
  d = readyDocs();                                                                 // an older complete UAT run doesn't count
  d.testRun.push({ id: 'R3', data: { id: 'R3', projectId: PRJ, env: 'uat', at: '2026-11-03T09:00:00Z', by: 'ar', results: [{ caseId: 'T1', outcome: 'pass' }] } });
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'tests-passed').pass, false);
  d = readyDocs();
  d.workItem.push({ id: 'W12', data: { id: 'W12', projectId: PRJ, pid: 'vendor-onboarding', step: 's3', title: 'Fix routing check', owner: 'dk', status: 'prog', start: TODAY, due: TODAY, kind: 'defect', testRef: { runId: 'R2', caseId: 'T2' } } });
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'tests-passed').defects, ['W12']);
  d = readyDocs(); d.project[0].data.uatScripts = [{ id: 'custom-1', pid: 'vendor-onboarding', step: 's3', title: 'Bank capture', given: 'g', when: 'w', then: 't', data: ['D2'] }];
  let c = check(E.readiness(d, PRJ, TODAY), 'tests-passed');
  assert.deepEqual(c.scripts, ['custom-1']); assert.deepEqual(c.unrun, ['custom-1']);
  d.testRun[1].data.results.push({ scriptId: 'custom-1', outcome: 'pass' });
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'tests-passed').pass, true);
});

test('R2 gateways: parallel traversal, goto, diff of gateways and sla/system/sub-steps', () => {
  const proc = {
    asis: [
      { id: 'k', type: 'trigger', title: 'Start' },
      { id: 'a1', title: 'Review', owner: 'mc', data: [], sla: '3 days', system: 'Email', subs: [{ title: 'Read', data: [] }, { title: 'Decide', data: [] }] },
      { id: 'g0', type: 'decision', title: 'Approved?', branches: [{ label: 'Yes', nodes: [] }, { label: 'No', nodes: [] }] },
      { id: 'a2', title: 'File it', owner: 'mc', data: [] },
      { id: 'e', type: 'end', title: 'End' },
    ],
    tobe: [
      { id: 'k', type: 'trigger', title: 'Start' },
      { id: 'r1', title: 'Review', owner: 'mc', data: [], from: 'a1', sla: '1 day', system: 'Portal', subs: [{ title: 'Read', data: ['D1'] }, { title: 'Score', data: [] }] },
      { id: 'g1', type: 'decision', title: 'Approved?', from: 'g0', branches: [{ label: 'Yes', nodes: [] }, { label: 'No', nodes: [], goto: 'r1' }] },
      { id: 'p1', type: 'parallel', title: 'Fan out', branches: [{ label: 'Notify', nodes: [{ id: 'n1', title: 'Notify', owner: 'dk', data: [] }] }, { label: 'Archive', nodes: [{ id: 'n2', title: 'Archive', owner: 'mc', data: [], from: 'a2' }] }] },
      { id: 'e', type: 'end', title: 'End' },
    ],
  };
  deepFreeze(proc);
  assert.deepEqual(E.flatSteps(proc.tobe).map(s => s.id), ['r1', 'n1', 'n2']);
  const df = E.diffProcess(proc);
  assert.equal(df.nodes.p1, 'new');
  assert.equal(df.nodes.g1, 'changed');
  assert.ok(df.changes.g1.includes('Loop-backs added: No ↺ r1'));
  assert.equal(df.nodes.r1, 'changed');
  ['SLA "3 days" → "1 day"', 'System "Email" → "Portal"', 'Sub-steps added: Score', 'Sub-steps removed: Decide', 'Sub-step "Read" data added: D1']
    .forEach(t => assert.ok(df.changes.r1.includes(t), t));
  assert.equal(df.nodes.n2, 'changed');                       // title differs
  assert.equal(df.nodes.n1, 'new');
  assert.deepEqual(df.removed, []);
  // a node released as-is (from = own id) diffs as same; undocumented as-is subs are not compared
  const same = E.diffProcess({ asis: [{ id: 'x', title: 'X', owner: 'mc', data: [] }, { id: 'g', type: 'parallel', title: 'P', branches: [{ label: 'A', nodes: [] }] }],
    tobe: [{ id: 'x', from: 'x', title: 'X', owner: 'mc', data: [], subs: [{ title: 'detail', data: [] }] }, { id: 'g', from: 'g', type: 'parallel', title: 'P', branches: [{ label: 'A', nodes: [] }] }] });
  assert.deepEqual(same.nodes, { x: 'same', g: 'same' });
});

test('R2 generateUatScripts: deterministic ids, one per new/changed step and per gateway branch', () => {
  const docs = deepFreeze(baseDocs());
  const a = E.generateUatScripts(docs, PRJ), b = E.generateUatScripts(docs, PRJ);
  assert.deepEqual(a, b);
  const ids = a.map(x => x.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('uat-vendor-onboarding-s3'));
  assert.ok(ids.includes('uat-vendor-onboarding-s2a'));
  assert.ok(!ids.includes('uat-invoice-approval-i3'));        // unchanged step
  assert.ok(ids.includes('uat-vendor-onboarding-d1-high') && ids.includes('uat-vendor-onboarding-d1-standard'));
  const s3 = a.find(x => x.id === 'uat-vendor-onboarding-s3');
  assert.deepEqual(s3.data, ['D2']);
  assert.match(s3.given, /Bank remittance details is available/);
  assert.match(s3.when, /Leo Park performs "Capture banking details"/);
  a.forEach(x => ['id', 'pid', 'step', 'title', 'given', 'when', 'then'].forEach(k => assert.equal(typeof x[k], 'string')));
  assert.match(a.find(x => x.id === 'uat-vendor-onboarding-d1-high').then, /Enhanced due diligence/);
});

test('R2 Bug 8: specDrift token-normalised matching', () => {
  const prof = E.profileCsv('tax_id,routing_number,AccountHolder,ein_alias\n12-3456789,123456789,Ann,x\n', {});
  const drift = E.specDrift({ fields: [
    { name: 'Tax ID (EIN)', type: 'text', format: '##-#######' },
    { name: 'Routing Number', type: 'digits', length: 9 },
    { name: 'Account holder', type: 'text' },
    { name: 'Alias', column: 'EIN alias', type: 'text' },
  ] }, prof);
  assert.deepEqual(drift, []);
  // parenthetical alias as a fallback: "Tax ID (EIN)" ↔ column "ein"
  assert.deepEqual(E.specDrift({ fields: [{ name: 'Tax ID (EIN)', type: 'text' }] }, E.profileCsv('EIN\n12-3456789\n', {})), []);
  let seedMod = null; try { seedMod = require(path.join(ROOT, 'api', 'shared', 'pmoflow-seed.js')); } catch (e) { seedMod = null; }
  if (seedMod && seedMod.seed) {
    const d1 = seedMod.seed(TODAY).docs.dataElement.find(e => e.id === 'D1').data;
    const sd = E.specDrift(d1, E.profileCsv(d1.sampleCsv, {}));
    assert.ok(!sd.some(x => x.issue === 'missing-column' || x.issue === 'unspecified-column'), JSON.stringify(sd));
    assert.ok(sd.some(x => x.field === 'Tax ID (EIN)' && x.issue === 'pattern-mismatch'));
  }
});

test('R2 workload: capacity-aware', () => {
  const d = baseDocs();
  d.person.find(e => e.id === 'dk').data.capacity = 1;          // 2 days per fortnight
  d.workItem.find(e => e.id === 'W7').data.effortDays = 3;
  deepFreeze(d);
  const wl = E.workload(d, TODAY);
  const dk = wl.find(r => r.person === 'dk');
  assert.equal(dk.capacityNext14, 2);
  assert.equal(dk.overloaded, true);
  assert.ok(dk.effortNext14 >= 3);
  const lp = wl.find(r => r.person === 'lp');
  assert.deepEqual([lp.effortNext14, lp.capacityNext14, lp.overloaded], [1, 8, false]);   // overdue W6 counts in full
  // W3: 11-11..11-17 lies inside the 14-day window → full effort 1. W11 (11-10..11-20) overlaps 8 of 11 days.
  const one = E.workload({ person: d.person, workItem: [d.workItem.find(e => e.id === 'W11')] }, TODAY)[0];
  assert.equal(one.effortNext14, Math.round(8 / 11 * 100) / 100);
  ['person', 'open', 'late', 'dueNext7', 'effortNext14', 'capacityNext14', 'overloaded'].forEach(k => assert.ok(k in dk, k));
});
