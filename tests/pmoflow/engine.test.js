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
    { id: 'D9', name: 'Payment hold list', owner: 'ar', avail: 'missing', fields: [] },
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
  // R5: live needs evidence; seeded live elements carry an ok connection check.
  dataElement.forEach(d => { if (d.avail === 'live') d.check = { ok: true, at: '2026-11-01T00:00:00Z', detail: 'Probe ok' }; });
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
  d.dataElement.forEach(e => { e.data.avail = 'live'; e.data.check = { ok: true, at: '2026-11-01T00:00:00Z', detail: 'Probe ok' }; });
  const bus = ['Procurement', 'Compliance', 'Treasury', 'Accounts Payable', 'IT'];
  d.approval = bus.map((bu, i) => ({ id: 'AP' + i, data: { id: 'AP' + i, projectId: PRJ, bu, approver: i % 2 ? 'ar' : 'mc', decision: 'approved', at: '2026-11-01T10:00:00Z', stepUp: true, note: '' } }));
  d.testCase = wrap([
    { id: 'T1', dataId: 'D2', field: 'Routing number', kind: 'valid', input: '123456789', expect: 'accept', origin: 'spec' },
    { id: 'T2', dataId: 'D2', field: 'Routing number', kind: 'boundary', input: '12345678', expect: 'reject', origin: 'spec' },
    { id: 'TX', dataId: 'DX-unused', field: 'x', kind: 'valid', input: 'a', expect: 'accept', origin: 'user' },
  ]);
  // R5: every spec field needs a (non-custom) case.
  ['Bank name', 'Account holder', 'Amount', 'Account number'].forEach((f, i) => d.testCase.push({ id: 'TF' + i, data: { id: 'TF' + i, dataId: 'D2', field: f, kind: 'valid', input: 'x', expect: 'accept', origin: 'spec' } }));
  // R3: every project data element needs at least one test case.
  ['D1', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'].forEach(id => d.testCase.push({ id: 'C' + id, data: { id: 'C' + id, dataId: id, field: 'f', kind: 'valid', input: 'x', expect: 'accept', origin: 'user' } }));
  d.testRun = wrap([
    { id: 'R1', projectId: PRJ, env: 'dev', at: '2026-11-01T09:00:00Z', by: 'dk', results: [{ caseId: 'T1', outcome: 'pass' }, { caseId: 'T2', outcome: 'pass' }, { caseId: 'TX', outcome: 'pass' }] },
    { id: 'R2', projectId: PRJ, env: 'uat', at: '2026-11-02T09:00:00Z', by: 'ar', results: [{ caseId: 'T1', outcome: 'pass' }, { caseId: 'T2', outcome: 'pass' }] },
  ]);
  d.testCase.filter(e => e.id.startsWith('C') || e.id.startsWith('TF')).forEach(e => { d.testRun[0].data.results.push({ caseId: e.id, outcome: 'pass' }); d.testRun[1].data.results.push({ caseId: e.id, outcome: 'pass' }); });
  E.generateUatScripts(d, PRJ).forEach(sc => d.testRun[1].data.results.push({ scriptId: sc.id, outcome: 'pass', evidence: 'screenshot' }));
  d.project[0].data.cutover = { window: 'Sat 06:00-10:00', rollbackOwner: 'dk', rollbackPlan: 'Restore v1 as-is', hypercareDays: 10, hypercareOwner: 'ta', comms: 'Teams', tasks: [{ id: 'CT1', order: 1, task: 'Switch over', owner: 'dk', planned: '06:00', gonogo: true, done: false }] };
  d.grant = wrap([{ id: 'G1', projectId: PRJ, dataId: 'D2', env: 'uat', access: 'read', reason: 'UAT', requestedBy: 'dk', status: 'active', expires: '2026-12-01', log: [] }]);
  return d;
}
const check = (r, id) => r.checks.find(c => c.id === id);
// R6: plan the one unplanned missing element (D9) so health is driven by the schedule.
function withHoldResolver(d) {
  d.workItem.push({ id: 'W12', data: { id: 'W12', projectId: PRJ, pid: 'invoice-approval', step: 'i4', title: 'Hold list feed', owner: 'ar', status: 'idle', start: '2026-11-05', due: '2026-11-12', deps: [], resolves: 'D9' } });
  return d;
}

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
  assert.equal(fc.W8.forecast, '2026-11-24');                   // R4: business days (11-11 + 9 bd)
  assert.equal(fc.W10.forecast, '2026-12-01');         // binding constraint is W8 (R4: business days)
  assert.equal(fc.W10.sched, 'slip');
  assert.equal(fc.W10.cause, 'D2');                     // root cause traced through W8 to W6
  assert.equal(fc.W10.slipDays, 11);
  assert.equal(fc.W1.sched, 'done');
  assert.equal(fc.W4.sched, 'slip');                    // R4: implicit data blocker (D5 resolver W2 + 5 bd)
  assert.equal(fc.W4.cause, 'D5');
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
  assert.deepEqual([st.total, st.done, st.pct, st.late, st.slip], [11, 2, 18, 1, 5]);
  assert.equal(st.finish, '2026-12-01');
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
  assert.equal(drift.find(x => x.field === 'Routing number' && x.issue === 'length-mismatch').detail, '1 of 4 routing numbers has 8 digits; the spec requires 9 digits.');
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
  const keys = cases.map(c => c.field + '|' + c.input + '|' + JSON.stringify(c.context || null));
  assert.equal(new Set(keys).size, keys.length);           // deduped
  const raws = RAW_ROWS.flat().filter(v => v.length >= 3);
  cases.forEach(c => assert.ok(!raws.some(r => c.input.includes(r)), 'raw value in input ' + c.input));
  // expectations agree with the engine's own validator
  cases.filter(c => !c.context).forEach(c => assert.equal(E.validate(E.fieldSpec(d2.fields.find(f => f.name === c.field)), c.input) ? 'accept' : 'reject', c.expect, c.field + ' ' + c.note));
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
  assert.equal(bv.find(r => r.workId === 'W10').varianceDays, 11);   // R4: business-day forecast Dec 1
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
  assert.equal(st.finish, '2026-12-01');
  assert.equal(st.actualFinish, undefined);
  const bv = E.baselineVariance(deepFreeze(baseDocs()), PRJ, 'b1', TODAY);
  const sum = bv.reduce((a, r) => a + Math.max(0, r.varianceDays || 0), 0);
  assert.equal(bv.projectSlipDays, 11);                         // 12-01 − 11-20
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
  assert.match(c.detail, /loops back to a step that no longer exists/);
  assert.ok(!/\bnope\b|s5|d1\b/.test(c.detail), c.detail);   // plain English, no ids
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
  d = readyDocs();                                                                 // R4: a later partial UAT run carries earlier passes forward
  d.testRun.push({ id: 'R3', data: { id: 'R3', projectId: PRJ, env: 'uat', at: '2026-11-03T09:00:00Z', by: 'ar', results: [{ caseId: 'T1', outcome: 'pass' }] } });
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'tests-passed').pass, true);
  d = readyDocs();
  d.workItem.push({ id: 'W12', data: { id: 'W12', projectId: PRJ, pid: 'vendor-onboarding', step: 's3', title: 'Fix routing check', owner: 'dk', status: 'prog', start: TODAY, due: TODAY, kind: 'defect', testRef: { runId: 'R2', caseId: 'T2' } } });
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'tests-passed').defects, ['W12']);
  d = readyDocs(); d.project[0].data.uatScripts = [{ id: 'custom-1', pid: 'vendor-onboarding', step: 's3', title: 'Bank capture', given: 'g', when: 'w', then: 't', data: ['D2'] }];
  let c = check(E.readiness(d, PRJ, TODAY), 'tests-passed');
  assert.deepEqual(c.scripts, ['custom-1']); assert.deepEqual(c.unrun, ['custom-1']);
  d.testRun[1].data.results.push({ scriptId: 'custom-1', outcome: 'pass', evidence: 'Screenshot in the ticket' });   // R5: script passes need evidence
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

/* ================================ Round 3 ================================ */
const IDS = /\b(W\d+|D\d+|AP\d+|G\d+|T\d+|s\d+a?|i\d+|sug-\d+)\b/;

test('R3 effectiveAvail drives blockers (missing only) and data-live (fails on examples)', () => {
  const docs = deepFreeze(baseDocs());
  assert.equal(E.effectiveAvail(docs, 'D4'), 'live');
  assert.equal(E.effectiveAvail(docs, 'D1'), 'example');
  assert.equal(E.effectiveAvail(docs, 'D2'), 'missing');
  assert.equal(E.effectiveAvail(docs, 'nope'), 'missing');
  const d = baseDocs(); d.workItem.find(e => e.id === 'W6').data.status = 'done';
  assert.equal(E.effectiveAvail(d, 'D2'), 'pending');            // R4: fix done, awaiting owner confirmation
  const s2 = E.stepState(docs, PRJ, 'vendor-onboarding', 's2', TODAY);
  assert.deepEqual(s2.blockers, ['D5']);                        // red: missing only
  assert.deepEqual(s2.needsLive, ['D1', 'D8']);                 // amber: examples only
  const r = readyDocs(); r.dataElement.find(e => e.id === 'D1').data.avail = 'example';
  const c = check(E.readiness(r, PRJ, TODAY), 'data-live');
  assert.equal(c.pass, false); assert.equal(c.status, 'fail');
  assert.deepEqual(c.examples, ['D1']);
  assert.equal(c.detail, 'Vendor legal name & Tax ID has examples only and needs a live source before go-live.');
});

test('R3 released project: frozen readiness, staleness ignored', () => {
  const d = readyDocs();
  const atRelease = E.readiness(d, PRJ, TODAY);
  d.project[0].data.status = 'live';
  d.release = wrap([{ id: 'REL1', projectId: PRJ, kind: 'golive', at: '2026-11-04T15:00:00Z', by: 'ta', snapshot: { 'vendor-onboarding': 2 }, checks: atRelease.checks }]);
  d.workItem[5].data.updatedAt = '2026-11-05T00:00:00Z';         // promotion-time edits must not matter
  d.process[0].data.updatedAt = '2026-11-05T00:00:00Z';
  d.workItem[0].data.status = 'prog';
  const r = E.readiness(deepFreeze(d), PRJ, TODAY);
  assert.equal(r.released, true); assert.equal(r.pass, true);
  assert.equal(r.releasedAt, '2026-11-04T15:00:00Z');
  assert.deepEqual(r.versions, { 'vendor-onboarding': 2 });
  assert.deepEqual(r.checks.map(c => c.id), atRelease.checks.map(c => c.id));
  assert.ok(r.checks.every(c => c.status === 'pass'));
  // a rollback release is not "the" release
  const d2 = readyDocs(); d2.project[0].data.status = 'live';
  d2.release = wrap([{ id: 'REL2', projectId: PRJ, kind: 'rollback', at: '2026-11-05T00:00:00Z' }]);
  assert.deepEqual(E.readiness(d2, PRJ, TODAY).checks, []);
});

test('R3 diffSummary counts gateways; criticalPath', () => {
  const docs = deepFreeze(baseDocs());
  assert.deepEqual(E.diffSummary(docs.process[0].data), { new: 2, changed: 6, removed: 1, same: 0 });
  assert.deepEqual(E.diffSummary(docs.process[1].data), { new: 1, changed: 2, removed: 0, same: 1 });
  assert.deepEqual(E.criticalPath(docs, PRJ, TODAY), ['W6', 'W8', 'W10']);
  const d = baseDocs(); d.workItem.forEach(e => { e.data.status = 'done'; e.data.doneAt = e.data.due; });
  assert.deepEqual(E.criticalPath(d, PRJ, TODAY), ['W6', 'W8', 'W10']);   // R6 (changed): full predecessor chain, even when done
  const cyc = baseDocs(); cyc.workItem.find(e => e.id === 'W6').data.deps = ['W10'];
  assert.ok(Array.isArray(E.criticalPath(cyc, PRJ, TODAY)));    // terminates on cycles
  assert.deepEqual(E.criticalPath(docs, 'nope', TODAY), []);
});

test('R3 check status and summary counts', () => {
  const base = E.readiness(deepFreeze(baseDocs()), PRJ, TODAY);
  base.checks.forEach(c => assert.ok(['pass', 'fail', 'warn'].includes(c.status)));
  base.checks.forEach(c => assert.equal(c.status === 'pass', c.pass));
  assert.equal(base.summary.pass + base.summary.fail + base.summary.warn, base.checks.length);
  const d = readyDocs(); d.workItem[5].data.updatedAt = '2026-11-02T08:00:00Z';
  const r = E.readiness(d, PRJ, TODAY);
  assert.equal(check(r, 'exceptions').status, 'warn');
  assert.equal(r.summary.warn, 1);
  assert.equal(r.summary.pass, r.checks.filter(c => c.pass).length);  // warnings never counted as passing
  const ok = E.readiness(readyDocs(), PRJ, TODAY);
  assert.deepEqual(ok.summary, { pass: 10, fail: 0, warn: 0 });
});

test('R3 two-person counts approved non-stale approvals only', () => {
  const d = readyDocs();                                          // ar approved Compliance and Accounts Payable
  d.workItem.find(e => e.id === 'W2').data.updatedAt = '2026-11-02T00:00:00Z';   // Compliance section
  d.workItem.find(e => e.id === 'W10').data.updatedAt = '2026-11-02T00:00:00Z';  // Accounts Payable section
  const c = check(E.readiness(d, PRJ, TODAY), 'two-person');
  assert.equal(c.pass, false); assert.deepEqual(c.items, ['mc']);
  assert.equal(c.detail, 'Only Maya Chen has a current approval; a second approver is needed.');
  assert.equal(check(E.readiness(readyDocs(), PRJ, TODAY), 'two-person').detail, 'Approved by Ana Ruiz and Maya Chen.');
});

test('R3 details are plain English with names, never ids', () => {
  const variants = [baseDocs(), readyDocs()];
  const v = readyDocs(); v.grant.push({ id: 'G2', data: { id: 'G2', projectId: PRJ, dataId: 'D2', env: 'dev', access: 'write', status: 'requested', log: [] } });
  v.testRun[1].data.results[0].outcome = 'fail'; v.workItem[5].data.updatedAt = '2026-11-02T08:00:00Z';
  variants.push(v);
  variants.forEach(d => E.readiness(d, PRJ, TODAY).checks.forEach(c => assert.ok(!IDS.test(c.detail) && !/undefined/.test(c.detail), c.id + ': ' + c.detail)));
  const r = E.readiness(baseDocs(), PRJ, TODAY);
  assert.equal(check(r, 'cutover-plan').detail, 'A runbook task, rollback owner, rollback plan and hypercare owner are not set.');
  assert.match(check(r, 'work-done').detail, /^9 of 11 work items are still open: Sign screening vendor contract, /);
  assert.match(check(r, 'data-live').detail, /Sanctions screening result, Bank remittance details and Payment hold list are missing\./);
  assert.match(check(E.readiness(v, PRJ, TODAY), 'grants-closed').detail, /Still requested: Bank remittance details \(DEV, write\)/);
});

test('R3 tests-passed: latest run per env, zero-case elements fail', () => {
  let d = readyDocs();
  d.testRun.push({ id: 'R0', data: { id: 'R0', projectId: PRJ, env: 'dev', at: '2026-10-01T00:00:00Z', results: [{ caseId: 'T1', outcome: 'fail' }] } });
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'tests-passed').pass, true);   // older dev failure ignored
  d = readyDocs(); d.testCase = d.testCase.filter(e => e.id !== 'CD9');
  const c = check(E.readiness(d, PRJ, TODAY), 'tests-passed');
  assert.equal(c.pass, false); assert.deepEqual(c.noCases, ['D9']);
  assert.match(c.detail, /Payment hold list has no test cases\./);
});

function aba(s) { const d = s.split('').map(Number); return /^\d{9}$/.test(s) && (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + d[2] + d[5] + d[8]) % 10 === 0; }
test('R3 generateTests: every field, special characters, cross-field, ABA routing', () => {
  const d2 = baseDocs().dataElement.find(e => e.id === 'D2').data;
  const cases = E.generateTests(d2);
  d2.fields.forEach(f => assert.ok(cases.some(c => c.field === f.name), 'no cases for ' + f.name));
  const bank = cases.filter(c => c.field === 'Bank name');
  ["O'Neill Supply", 'Zoë Café', 'Ames & Sons', 'Acme Rockets 🚀', '  Acme Ltd  '].forEach(x => assert.ok(bank.some(c => c.input === x && c.kind === 'edge'), x));
  const holder = cases.filter(c => c.field === 'Account holder' && c.context);
  assert.deepEqual(holder.map(c => [c.expect, c.context['legal name'] === c.input]), [['accept', true], ['reject', false]]);
  const rt = cases.filter(c => c.field === 'Routing number');
  const validRt = rt.filter(c => c.kind === 'valid');
  assert.ok(validRt.length >= 2 && validRt.every(c => aba(c.input) && c.expect === 'accept'));
  const bad = rt.find(c => /ABA checksum fails/.test(c.note));
  assert.ok(bad && /^\d{9}$/.test(bad.input) && !aba(bad.input) && bad.expect === 'reject');
  // same-element cross-field: "Must be after Start date"
  const dates = E.generateTests({ id: 'DX', fields: [{ name: 'Start date', type: 'date' }, { name: 'End date', type: 'date', rule: 'Must be after Start date' }] });
  const cross = dates.filter(c => c.context);
  assert.equal(cross.length, 2);
  cross.forEach(c => { assert.ok('Start date' in c.context); assert.equal(c.expect === 'accept', c.input > c.context['Start date']); });
});

test('R3 specDrift plain English; row count from the profile doc; humanPattern', () => {
  const d2 = baseDocs().dataElement.find(e => e.id === 'D2').data;
  const cols = E.profileCsv(CSV, {}).map(c => { const x = Object.assign({}, c); delete x.rows; return x; });  // server profiles may omit per-column rows
  const drift = E.specDrift(d2, { rows: 4, columns: cols });
  drift.forEach(x => assert.ok(!/undefined|NaN|9\{|A\{|a\{/.test(x.detail), x.detail));
  assert.equal(drift.find(x => x.field === 'Bank name').detail, '1 of 4 bank names is empty; the spec says bank name is required.');
  assert.equal(drift.find(x => x.field === 'Routing number' && x.issue === 'length-mismatch').detail, '1 of 4 routing numbers has 8 digits; the spec requires 9 digits.');
  const tax = E.specDrift({ fields: [{ name: 'Tax ID (EIN)', format: '##-#######' }] }, { rows: 3, columns: E.profileCsv('tax_id\n12-3456789\n123456789\n98-7654321\n', {}) });
  assert.equal(tax.find(x => x.issue === 'pattern-mismatch').detail, '1 of 3 tax IDs looks like 9 digits; the spec format is ##-####### (2 digits, a hyphen, 7 digits).');
  assert.equal(E.humanPattern('9{8}'), '8 digits');
  assert.equal(E.humanPattern('Aa{5} Aa{6}'), 'two capitalized words');
  assert.equal(E.humanPattern('Aa{4}'), 'a capitalized word');
  assert.equal(E.humanPattern('a{3} a{2} a{4}'), 'three lowercase words');
  assert.equal(E.humanPattern('9{2}-9{7}'), '2 digits, a hyphen, 7 digits');
  assert.equal(E.humanPattern('A{2}9{4}'), '2 capital letters, 4 digits');
});

test('R4 suggestWorkFromDiff: data-driven deps, gateways, all non-live data, business days', () => {
  const docs = deepFreeze(baseDocs());
  const sug = E.suggestWorkFromDiff(docs, PRJ, TODAY);
  assert.deepEqual(sug.map(s => [s.key, s.step, s.resolves || null]), [
    ['sug-1', 's1', 'D1'], ['sug-2', 's1', 'D3'], ['sug-3', 's2', 'D8'], ['sug-4', 'd1', null], ['sug-5', 's5', null], ['sug-6', 'i4', 'D9'], ['sug-7', 'i4', null]]);
  assert.equal(sug[0].title, 'Connect a live source for Vendor legal name & Tax ID');
  assert.equal(sug[3].title, 'Configure routing: Risk tier?');        // new gateway
  assert.equal(sug[5].title, 'Make Payment hold list available');
  assert.equal(sug[5].owner, 'ar');                                 // data owner for resolvers
  assert.equal(sug[6].owner, 'ps');                                 // step owner otherwise
  // R6 (changed): flow-order FS deps on the nearest preceding step's work, plus resolvers; dates spread toward the target
  assert.deepEqual(sug[6].deps, ['W11', 'sug-6']);                  // i2's open work, then the D9 resolver
  assert.deepEqual(sug[4].deps, ['W8']);                            // s5 follows s4's open work
  assert.deepEqual(sug[3].deps, ['W2', 'W3', 'W4']);                // gateway follows s2's open work
  assert.ok(sug.every(s => s.effortDays === 2));
  assert.deepEqual([0, 1, 2, 5].map(i => sug[i].start), Array(4).fill('2026-11-04'));   // can start now = today
  assert.deepEqual([sug[4].start, sug[6].start], ['2026-11-25', '2026-11-23']);         // business day after deps finish
  assert.ok(new Set(sug.map(s => s.start)).size > 1);
  // resolvers for non-live data used by ANY to-be step, even unchanged ones
  const d = baseDocs(); d.dataElement.push({ id: 'DZ', data: { id: 'DZ', name: 'Bank cut-off calendar', owner: 'lp', avail: 'missing', fields: [] } });
  d.process[1].data.tobe.find(n => n.id === 'i3').data = ['D2', 'D4', 'DZ'];
  d.process[1].data.asis.find(n => n.id === 'b3').data = ['D2', 'D4', 'DZ'];                  // i3 stays unchanged ("same")
  const s3 = E.suggestWorkFromDiff(d, PRJ, TODAY);
  assert.ok(s3.some(x => x.resolves === 'DZ' && x.step === 'i3'));
  assert.ok(!s3.some(x => x.step === 'i3' && !x.resolves));
  // a step needing an unfinished existing resolver depends on it and starts at its forecast (W6 → Nov 11)
  const e = baseDocs();
  e.process[1].data.tobe.splice(1, 0, { id: 'i0', title: 'Check bank on file', owner: 'lp', data: ['D2'] });
  const s2 = E.suggestWorkFromDiff(e, PRJ, TODAY).find(x => x.step === 'i0');
  assert.deepEqual(s2.deps, ['W6']);
  assert.deepEqual([s2.start, s2.due], ['2026-11-12', '2026-11-17']);   // R6 (changed): day after W6's Nov 11 forecast; spread span
  assert.equal(E.suggestWorkFromDiff(docs, PRJ)[0].start, '2026-11-20');   // anchor: latest project due
  // weekend anchor rolls to Monday
  assert.equal(E.suggestWorkFromDiff(docs, PRJ, '2026-11-07')[0].start, '2026-11-09');
});

/* ================================ Round 4 ================================ */
test('R4 effectiveAvail: pending until the data owner confirms', () => {
  const d = baseDocs(); d.workItem.find(e => e.id === 'W6').data.status = 'done';
  const d2 = d.dataElement.find(e => e.id === 'D2').data;
  d2.owner = 'lp';
  assert.equal(E.effectiveAvail(d, 'D2'), 'pending');
  assert.equal(E.dataReady(d, 'D2'), false);
  const s3 = E.stepState(d, PRJ, 'vendor-onboarding', 's3', TODAY);
  assert.deepEqual(s3.blockers, []); assert.deepEqual(s3.pending, ['D2']); assert.ok(s3.needsLive.includes('D2'));
  d2.liveConfirmedBy = 'dk'; d2.liveSource = 'Treasury API';      // not the owner
  assert.equal(E.effectiveAvail(d, 'D2'), 'pending');
  d2.liveConfirmedBy = 'lp'; d2.liveSource = '';                  // owner but no source
  assert.equal(E.effectiveAvail(d, 'D2'), 'pending');
  d2.liveSource = 'Treasury portal API';
  assert.equal(E.effectiveAvail(d, 'D2'), 'pending');            // R5: confirmation alone is not enough; evidence required
  d2.check = { ok: true, at: '2026-11-04T09:00:00Z', detail: 'Probe ok' }; d2.liveEvidence = { type: 'check', ref: 'probe', at: '2026-11-04T09:00:00Z', by: 'lp' };
  assert.equal(E.effectiveAvail(d, 'D2'), 'live');
  const e = baseDocs(); e.dataElement.find(x => x.id === 'D1').data.owner = 'mc';
  Object.assign(e.dataElement.find(x => x.id === 'D1').data, { liveConfirmedBy: 'mc', liveSource: 'Vendor portal', liveEvidence: { type: 'attested', ref: 'https://intranet.northwind.example/evidence/1', at: '2026-11-04', by: 'mc' } });
  assert.equal(E.effectiveAvail(e, 'D1'), 'live');                // examples element confirmed live by its owner
  // gate: pending fails data-live with "awaiting <owner> to confirm"
  const r = readyDocs(); const rd2 = r.dataElement.find(x => x.id === 'D2').data;
  rd2.avail = 'missing'; rd2.owner = 'lp';
  const c = check(E.readiness(r, PRJ, TODAY), 'data-live');
  assert.equal(c.pass, false); assert.deepEqual(c.pending, ['D2']);
  assert.equal(c.awaiting[0].text, 'awaiting Leo Park to confirm');
  assert.match(c.detail, /Bank remittance details: fix done, awaiting Leo Park to confirm it is live with evidence\./);   // R5 wording
});

test('R4 sign-off: sections from touches, project owner excluded, signoffOpen', () => {
  let d = readyDocs();
  d.process[0].data.tobe.find(n => n.id === 's1').touches = ['Procurement', 'pmo'];   // PMO named in a tag (case-insensitive)
  let bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.ok(bu.sections.includes('PMO')); assert.deepEqual(bu.unsigned, ['PMO']);
  d.approval.push({ id: 'AP7', data: { id: 'AP7', projectId: PRJ, bu: 'PMO', approver: 'ta', decision: 'approved', at: '2026-11-01T10:00:00Z', stepUp: true } });
  let r = E.readiness(d, PRJ, TODAY);
  assert.deepEqual(check(r, 'bu-signoff').unsigned, ['PMO']);      // ta is the project owner: doesn't count
  assert.match(check(r, 'bu-signoff').detail, /Approvals by the project owner \(Tom Alvarez\) do not count\./);
  assert.equal(check(r, 'bu-signoff').excludedApprover, 'ta');
  d.approval.find(a => a.id === 'AP7').data.approver = 'ps';
  assert.equal(E.readiness(d, PRJ, TODAY).pass, true);
  // owner approvals don't count toward two-person either
  d = readyDocs(); d.approval.forEach(a => { if (a.data.approver === 'ar') a.data.approver = 'ta'; });
  r = E.readiness(d, PRJ, TODAY);
  assert.equal(check(r, 'two-person').pass, false);
  assert.match(check(r, 'two-person').detail, /The project owner \(Tom Alvarez\) does not count\./);
  // signoffOpen
  assert.equal(E.readiness(readyDocs(), PRJ, TODAY).signoffOpen, true);
  assert.equal(E.readiness(baseDocs(), PRJ, TODAY).signoffOpen, false);
  d = readyDocs(); d.approval = [];
  r = E.readiness(d, PRJ, TODAY);
  assert.equal(r.pass, false); assert.equal(r.signoffOpen, true);  // only sign-off missing
});

test('R4 exceptions include process edits, with names', () => {
  const d = readyDocs(); d.process[1].data.updatedAt = '2026-11-03T00:00:00Z';
  const ex = check(E.readiness(d, PRJ, TODAY), 'exceptions');
  assert.deepEqual(ex.items, ['process:invoice-approval']);
  assert.equal(ex.detail, 'The Invoice Approval process was changed after sign-off; its section needs re-approval.');
});

function depDocs(extra) {
  const W = (id, start, due, more) => ({ id, data: Object.assign({ id, projectId: 'P', pid: 'x', step: 'y', title: 'Item ' + id, owner: 'mc', status: 'idle', start, due, deps: [] }, more) });
  return { workItem: [
    W('A', '2026-11-04', '2026-11-10', { effortDays: 3 }),
    W('B', '2026-11-04', '2026-11-06', { effortDays: 2, deps: [{ id: 'A', type: 'SS', lag: 1 }] }),
    W('C', '2026-11-04', '2026-11-06', { effortDays: 2, deps: [{ id: 'A', type: 'FF', lag: 2 }] }),
    W('D', '2026-11-04', '2026-11-06', { effortDays: 1, deps: [{ id: 'A', type: 'FS', lag: 1 }] }),
    W('E', '2026-11-04', '2026-11-06', { effortDays: 1, deps: ['A'] }),
  ].concat(extra || []), project: [{ id: 'P', data: { id: 'P', processes: [], target: '2026-12-31' } }] };
}
test('R4 dependency types FS/SS/FF with lag (business days)', () => {
  const docs = deepFreeze(depDocs());
  const fc = E.forecastAll(docs, TODAY);
  assert.equal(fc.A.forecast, '2026-11-10'); assert.equal(fc.A.start, '2026-11-05');
  assert.equal(fc.B.forecast, '2026-11-10');   // SS: A start Nov 5 + 1 lag = Nov 6, + 2 effort = Nov 10
  assert.equal(fc.C.forecast, '2026-11-12');   // FF: A finish Nov 10 + 2 lag
  assert.equal(fc.D.forecast, '2026-11-12');   // FS: Nov 10 + 1 lag + 1 effort
  assert.equal(fc.E.forecast, '2026-11-11');   // string dep = FS, lag 0
  assert.deepEqual(fc.B.basis, { kind: 'dep', ref: 'A', type: 'SS', lag: 1, from: '2026-11-05', dur: 2 });
  assert.deepEqual(E.dependents(docs, 'A').sort(), ['B', 'C', 'D', 'E']);
  assert.equal(E.projectStats(docs, 'P', TODAY).blocked, 4);
  assert.match(E.explainForecast(docs, 'B', TODAY)[1].text, /^Starts with "Item A" \(starting Nov 5\) \+ 1 business day lag → \+2 business days effort → Nov 10$/);
  assert.match(E.explainForecast(docs, 'C', TODAY)[1].text, /^Finishes with "Item A" \(forecast Nov 10\) \+ 2 business days lag → Nov 12$/);
});

test('R4 implicit data blocker, effortDays duration, moved-due-date fix', () => {
  const fc = E.forecastAll(deepFreeze(baseDocs()), TODAY);
  assert.deepEqual([fc.W4.basis.kind, fc.W4.cause, fc.W4.causeWork, fc.W4.via], ['data', 'D5', 'W2', 'W2']);
  assert.equal(fc.W4.forecast, '2026-11-17');                    // W2 forecast Nov 10 + 5 business days
  let d = baseDocs(); d.workItem.find(e => e.id === 'W6').data.effortDays = 2;
  assert.equal(E.forecastAll(d, TODAY).W6.forecast, '2026-11-06');   // today + 2 business days
  // moving the due date later clears the old slip (no effortDays)
  d = baseDocs(); d.workItem.find(e => e.id === 'W6').data.due = '2026-11-20';
  let f = E.forecastAll(d, TODAY).W6;
  assert.deepEqual([f.forecast, f.sched, f.slipDays], ['2026-11-20', 'ok', 0]);
  // with effortDays: forecast = max(due, today + effort)
  d.workItem.find(e => e.id === 'W6').data.effortDays = 3;
  assert.equal(E.forecastAll(d, TODAY).W6.forecast, '2026-11-20');
  d.workItem.find(e => e.id === 'W6').data.due = '2026-11-05';
  f = E.forecastAll(d, TODAY).W6;
  assert.deepEqual([f.forecast, f.sched], ['2026-11-09', 'slip']);  // Wed + 3 business days = Mon
});

test('R4 business days helpers', () => {
  assert.equal(E.addBusinessDays('2026-11-06', 1), '2026-11-09');   // Fri → Mon
  assert.equal(E.addBusinessDays('2026-11-07', 0), '2026-11-09');   // Sat rolls to Mon
  assert.equal(E.addBusinessDays('2026-11-09', -1), '2026-11-06');
  assert.equal(E.businessDaysBetween('2026-11-06', '2026-11-09'), 1);
  assert.equal(E.businessDaysBetween('2026-11-09', '2026-11-06'), -1);
  let n = 0; for (let ms = Date.UTC(2026, 0, 2); ms <= Date.UTC(2026, 11, 31); ms += 86400000) { const w = new Date(ms).getUTCDay(); if (w && w !== 6) n++; }
  assert.equal(E.businessDaysBetween('2026-01-01', '2026-12-31'), n);
  assert.equal(E.businessDaysBetween('2026-01-01', '2026-12-31'), 260);
});

test('R4 explainForecast: human chain with names', () => {
  const lines = E.explainForecast(deepFreeze(baseDocs()), 'W10', TODAY).map(l => l.text);
  assert.deepEqual(lines, [
    '"Stand up structured bank capture" has not started and its start date (Oct 27) has passed → today (Nov 4) + 5 business days effort → Nov 11',
    'Waits for "Stand up structured bank capture" (forecast Nov 11) → +9 business days effort → Nov 24',
    'Waits for "ERP vendor write integration" (forecast Nov 24) → +5 business days effort → Dec 1',
    'Due Nov 20; forecast Dec 1 (7 business days late)',
  ]);
  assert.match(E.explainForecast(baseDocs(), 'W4', TODAY)[1].text, /^Needs Sanctions screening result, which "Sign screening vendor contract" makes available \(forecast Nov 10\)/);
  assert.match(E.explainForecast(baseDocs(), 'W11', TODAY).slice(-1)[0].text, /\(on plan\)$/);
  assert.equal(E.explainForecast(baseDocs(), 'W1', TODAY)[0].text, '"Launch vendor portal upload" finished on Oct 20');
  assert.deepEqual(E.explainForecast(baseDocs(), 'nope', TODAY), []);
});

test('R4 sprints and sprintOf', () => {
  const docs = deepFreeze(baseDocs());
  const project = docs.project[0].data;
  const sp = E.sprints(Object.assign({ id: PRJ }, project), TODAY, docs);
  assert.deepEqual(sp[0], { id: 'S1', name: 'Sprint 1', start: '2026-10-05', end: '2026-10-18' });   // Monday before W1 start
  assert.equal(sp.length, 6);
  assert.deepEqual(sp[5], { id: 'S6', name: 'Sprint 6', start: '2026-12-14', end: '2026-12-27' });   // covers target Dec 15
  const p = Object.assign({ id: PRJ }, project);
  assert.equal(E.sprintOf(p, { due: '2026-11-03' }, docs, TODAY), 'S3');
  assert.equal(E.sprintOf(p, { due: '2026-11-03', sprintId: 'S5' }, docs, TODAY), 'S5');
  assert.equal(E.sprintOf(p, { due: '2026-11-03', sprintId: 'gone' }, docs, TODAY), 'S3');
  const explicit = { id: 'X', sprints: [{ id: 'a', name: 'Alpha', start: '2026-11-01', end: '2026-11-14' }] };
  assert.deepEqual(E.sprints(explicit, TODAY), [{ id: 'a', name: 'Alpha', start: '2026-11-01', end: '2026-11-14' }]);
  assert.equal(E.sprintOf(explicit, { due: '2026-11-20' }), null);
  assert.deepEqual(E.sprints({ id: 'Y', target: '2026-11-30' }, TODAY).map(x => x.start), ['2026-11-02', '2026-11-16', '2026-11-30']);   // no docs: from today's week
});

test('R4 profile-derived test cases reproduce observed shapes synthetically', () => {
  const d2 = baseDocs().dataElement.find(e => e.id === 'D2').data;
  const prof = E.profileCsv(CSV, {});
  const cases = E.generateTests(d2, prof).filter(c => c.origin === 'profile');
  const rt = cases.filter(c => c.field === 'Routing number');
  const eight = rt.find(c => /^Observed shape: 8 digits/.test(c.note));
  assert.ok(eight && /^\d{8}$/.test(eight.input) && eight.expect === 'reject');
  const nine = rt.find(c => /^Observed shape: 9 digits/.test(c.note));
  assert.ok(nine && aba(nine.input) && nine.expect === 'accept');
  const blank = E.generateTests(d2, prof).find(c => c.field === 'Bank name' && c.input === '');   // blanks observed: deduped into the spec case
  assert.ok(blank.observed && blank.expect === 'reject' && /also observed in the extract: empty values observed \(1\)/.test(blank.note), blank.note);
  assert.ok(cases.some(c => c.field === 'Account holder' && /Unicode/.test(c.note)));
  assert.ok(cases.some(c => /Longest observed length/.test(c.note)));
  const raws = RAW_ROWS.flat().filter(v => v.length >= 3);
  cases.forEach(c => assert.ok(!raws.some(r => c.input.includes(r)), 'raw value: ' + c.input));
  assert.ok(cases.every(c => !/undefined/.test(c.note)));
});

test('R4 UAT scripts: multi-step, names only', () => {
  const scripts = E.generateUatScripts(deepFreeze(baseDocs()), PRJ);
  const s1 = scripts.find(x => x.id === 'uat-vendor-onboarding-s1');
  assert.deepEqual(s1.steps, [{ action: 'Maya Chen: Vendor uploads W-9 and COI using Vendor legal name & Tax ID and Certificate of insurance', expected: 'Vendor legal name & Tax ID and Certificate of insurance are recorded correctly' }]);
  const s3 = scripts.find(x => x.id === 'uat-vendor-onboarding-s3');
  assert.deepEqual(s3.steps, [{ action: 'Leo Park: Capture banking details using Bank remittance details', expected: 'Bank remittance details is recorded correctly' }]);
  const s6 = scripts.find(x => x.id === 'uat-vendor-onboarding-s6');
  assert.match(s6.then, /Dev Kumar now owns the step instead of Maya Chen/);
  const br = scripts.find(x => x.id === 'uat-vendor-onboarding-d1-high');
  assert.equal(br.steps.length, 2);
  assert.equal(br.steps[1].action, 'Priya Shah: Enhanced due diligence');
  scripts.forEach(sc => {
    const text = [sc.title, sc.given, sc.when, sc.then].concat(sc.steps.flatMap(x => [x.action, x.expected])).join(' | ');
    assert.ok(!IDS.test(text) && !/undefined/.test(text), sc.id + ': ' + text);
  });
});

test('R4 coverage: latest result per item across all runs in the env, by project', () => {
  let d = readyDocs();
  // partial CI import: newer UAT run has only T1; T2 and the scripts carry forward from the earlier run
  d.testRun.push({ id: 'R5', data: { id: 'R5', projectId: PRJ, env: 'uat', at: '2026-11-03T09:00:00Z', results: [{ caseId: 'T1', outcome: 'pass' }] } });
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'tests-passed').pass, true);
  // a newer failure overrides an earlier pass for that item only
  d.testRun.push({ id: 'R6', data: { id: 'R6', projectId: PRJ, env: 'uat', at: '2026-11-03T10:00:00Z', results: [{ caseId: 'T2', outcome: 'fail' }] } });
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'tests-passed').failing, ['T2']);
  // and a later pass clears it
  d.testRun.push({ id: 'R7', data: { id: 'R7', projectId: PRJ, env: 'uat', at: '2026-11-03T11:00:00Z', results: [{ caseId: 'T2', outcome: 'pass' }] } });
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'tests-passed').pass, true);
  // runs of another project are ignored
  d.testRun.push({ id: 'R8', data: { id: 'R8', projectId: 'other', env: 'uat', at: '2026-11-04T09:00:00Z', results: [{ caseId: 'T1', outcome: 'fail' }] } });
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'tests-passed').pass, true);
});

/* ================================ Round 5 ================================ */
test('R5 effectiveAvail requires evidence; attested evidence is a warn', () => {
  const d = readyDocs();
  const d2 = d.dataElement.find(e => e.id === 'D2').data;
  delete d2.check;                                                   // claimed live, no evidence
  assert.equal(E.effectiveAvail(d, 'D2'), 'pending');
  d2.liveEvidence = { type: 'profile', ref: 'PR1', at: '2026-11-03', by: 'lp' };
  assert.equal(E.effectiveAvail(d, 'D2'), 'pending');                // no profile on file
  d.profile = [{ id: 'PR1', data: { id: 'PR1', dataId: 'D2', at: '2026-11-03', rows: 4, columns: E.profileCsv(CSV, {}) } }];
  assert.equal(E.evidenceOf(d, d2).ok, false);                       // the 8-digit routing number is blocking drift
  const clean = 'Bank name,Routing number,Account holder,Amount,Account number,Extra\nNorthwind Bank,123456789,Ann Lee,10.00,12345678,x\n';
  d.profile[0].data.columns = E.profileCsv(clean, {});
  assert.equal(E.effectiveAvail(d, 'D2'), 'live');                   // only "column with no spec" left: not blocking
  d2.liveEvidence = { type: 'check', ref: 'probe', at: '2026-11-03', by: 'lp' };
  d2.check = { ok: false, at: '2026-11-03', detail: 'timeout' };
  assert.equal(E.effectiveAvail(d, 'D2'), 'pending');
  d2.liveEvidence = { type: 'attested', ref: 'https://intranet.northwind.example/evidence/7', at: '2026-11-03', by: 'lp' };
  assert.equal(E.effectiveAvail(d, 'D2'), 'live');
  const c = check(E.readiness(d, PRJ, TODAY), 'data-live');
  assert.equal(c.pass, true); assert.equal(c.status, 'warn'); assert.deepEqual(c.attested, ['D2']);
  assert.match(c.detail, /Bank remittance details is live on attested evidence only/);
  assert.equal(E.readiness(d, PRJ, TODAY).summary.warn, 1);
  d2.liveEvidence.ref = '';
  assert.equal(E.effectiveAvail(d, 'D2'), 'pending');
});

test('R5 coverage: every spec field needs a non-custom case; envs, skipped, script evidence', () => {
  let d = readyDocs(); d.testCase = d.testCase.filter(e => e.id !== 'TF2');   // Amount uncovered
  let c = check(E.readiness(d, PRJ, TODAY), 'tests-passed');
  assert.equal(c.pass, false); assert.deepEqual(c.uncoveredFields, [{ dataId: 'D2', field: 'Amount' }]);
  assert.match(c.detail, /1 spec field has no test case: Bank remittance details · Amount\./);
  d = readyDocs(); d.testCase.find(e => e.id === 'TF2').data.kind = 'custom';    // custom-only doesn't count
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'tests-passed').uncoveredFields.length, 1);
  // SIT failures block; prod-verify is not part of the gate
  d = readyDocs(); d.testRun.push({ id: 'RS', data: { id: 'RS', projectId: PRJ, env: 'sit', at: '2026-11-02T00:00:00Z', results: [{ caseId: 'T1', outcome: 'fail' }] } });
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'tests-passed').failing, ['T1']);
  d = readyDocs(); d.testRun.push({ id: 'RP', data: { id: 'RP', projectId: PRJ, env: 'prod-verify', at: '2026-11-02T00:00:00Z', results: [{ caseId: 'T1', outcome: 'fail' }] } });
  c = check(E.readiness(d, PRJ, TODAY), 'tests-passed');
  assert.equal(c.pass, true); assert.equal(c.byEnv['prod-verify'].fail, 1);
  // skipped (not-run) never overrides an earlier result, and is counted
  d = readyDocs(); d.testRun.push({ id: 'RK', data: { id: 'RK', projectId: PRJ, env: 'uat', source: 'ci', at: '2026-11-03T00:00:00Z', results: [{ caseId: 'T1', outcome: 'not-run' }] } });
  c = check(E.readiness(d, PRJ, TODAY), 'tests-passed');
  assert.equal(c.pass, true); assert.deepEqual(c.skipped, []);
  d.testCase.push({ id: 'T9', data: { id: 'T9', dataId: 'D2', field: 'Routing number', kind: 'edge', input: '0', expect: 'reject', origin: 'profile' } });
  d.testRun.find(e => e.id === 'RK').data.results.push({ caseId: 'T9', outcome: 'not-run' });
  c = check(E.readiness(d, PRJ, TODAY), 'tests-passed');
  assert.deepEqual(c.skipped, ['T9']); assert.ok(c.unrun.includes('T9')); assert.equal(c.byEnv.uat.skipped, 1);
  assert.match(c.detail, /1 test skipped\./);
  // a UAT script pass without evidence does not count unless the run source is CI
  d = readyDocs(); d.testRun[1].data.results.filter(x => x.scriptId).forEach(x => { delete x.evidence; });
  c = check(E.readiness(d, PRJ, TODAY), 'tests-passed');
  assert.equal(c.pass, false); assert.ok(c.noEvidence.length > 0);
  d.testRun[1].data.source = 'ci';
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'tests-passed').pass, true);
});

test('R5 sign-off: trigger touches, BU without a person, release manager excluded, cutover staleness', () => {
  let d = readyDocs();
  d.process[0].data.tobe[0].touches = ['Procurement', 'HR'];       // trigger touches HR; nobody is in HR
  let bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.equal(bu.pass, false); assert.deepEqual(bu.noPerson, ['HR']);
  assert.match(bu.detail, /No approver in HR: assign one\./);
  d.person.push({ id: 'hr', data: { id: 'hr', name: 'Grace Lin', role: 'HR Business Partner', bu: 'HR' } });
  bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.deepEqual(bu.noPerson, []); assert.deepEqual(bu.unsigned, ['HR']);
  d.approval.push({ id: 'AP8', data: { id: 'AP8', projectId: PRJ, bu: 'HR', approver: 'hr', decision: 'approved', at: '2026-11-01T10:00:00Z', stepUp: true } });
  assert.equal(E.readiness(d, PRJ, TODAY).pass, true);
  // release manager can't approve
  d = readyDocs(); d.project[0].data.releaseManager = 'ar';          // ar approved Compliance and Accounts Payable
  const r = E.readiness(d, PRJ, TODAY);
  bu = check(r, 'bu-signoff');
  assert.deepEqual(bu.unsigned, ['Accounts Payable', 'Compliance']);
  assert.deepEqual(bu.excludedApprovers, ['ta', 'ar']);
  assert.match(bu.detail, /Approvals by the project owner and release manager \(Tom Alvarez and Ana Ruiz\) do not count\./);
  assert.equal(check(r, 'two-person').pass, false);
  // cutover edits after approval make every approval stale
  d = readyDocs(); d.project[0].data.cutoverUpdatedAt = '2026-11-03T00:00:00Z';
  bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.equal(bu.stale.length, 5);
  assert.ok(bu.stale.every(x => /the cutover plan/.test(x.reason)));
});

test('R5 cutover check: tasks present, go/no-go tasks owned', () => {
  let d = readyDocs(); d.project[0].data.cutover.tasks = [];
  let c = check(E.readiness(d, PRJ, TODAY), 'cutover-plan');
  assert.equal(c.pass, false); assert.equal(c.detail, 'A runbook task is not set.');
  d = readyDocs(); d.project[0].data.cutover.tasks.push({ id: 'CT2', order: 2, task: 'Go/no-go call', owner: '', gonogo: true });
  c = check(E.readiness(d, PRJ, TODAY), 'cutover-plan');
  assert.equal(c.pass, false); assert.match(c.detail, /1 go\/no-go task has no owner: "Go\/no-go call"\./);
  assert.deepEqual(c.items, ['task:CT2']);
});

test('R5 diffVersions compares any two versions by node id', () => {
  const p = baseDocs().process[0].data;
  const draft = { id: 'dr1', name: 'Draft 1', tobe: JSON.parse(JSON.stringify(p.tobe)) };
  draft.tobe.find(n => n.id === 's3').title = 'Capture and verify banking details';
  draft.tobe.find(n => n.id === 's5').data = ['D6'];
  draft.tobe.splice(2, 0, { id: 's9', title: 'Collect beneficial owners', owner: 'ps', data: [] });
  draft.tobe = draft.tobe.filter(n => n.id !== 's6');
  const df = E.diffVersions(p, draft);
  assert.equal(df.nodes.s3, 'changed'); assert.ok(df.changes.s3[0].startsWith('Title'));
  assert.deepEqual(df.changes.s5, ['Data removed: D4']);
  assert.equal(df.nodes.s9, 'new'); assert.equal(df.nodes.s1, 'same'); assert.equal(df.nodes.d1, 'same');
  assert.deepEqual(df.removed.map(n => n.id), ['s6']);
  assert.deepEqual(Object.keys(E.diffVersions(p, p).nodes).filter(k => E.diffVersions(p, p).nodes[k] !== 'same'), []);
  assert.equal(E.diffVersions({ version: 1, asis: p.asis }, p).nodes.s1, 'new');   // released as-is vs current to-be: ids differ
});

test('R5 scheduleConflicts and autoSchedule (business days, durations kept)', () => {
  const d = depDocs();
  d.workItem.find(e => e.id === 'B').data.start = '2026-11-04';   // SS A + 1 → must start ≥ Nov 5
  d.workItem.find(e => e.id === 'E').data.start = '2026-11-09';   // FS A (due Nov 10) → conflict
  d.workItem.find(e => e.id === 'E').data.due = '2026-11-10';
  deepFreeze(d);
  const cf = E.scheduleConflicts(d, 'P');
  assert.deepEqual(cf.map(x => [x.workId, x.dep, x.type]).sort(), [['B', 'A', 'SS'], ['C', 'A', 'FF'], ['D', 'A', 'FS'], ['E', 'A', 'FS']]);
  assert.equal(cf.find(x => x.workId === 'E').detail, '"Item E" starts Nov 9, but "Item A" finishes Nov 10; it can start on Nov 11 at the earliest.');   // R6 (changed): FS starts the next business day
  const plan = E.autoSchedule(d, 'P');
  assert.deepEqual(plan.E, { start: '2026-11-11', due: '2026-11-12' });   // R6 (changed): day after A finishes; 1 bd kept
  assert.deepEqual(plan.D, { start: '2026-11-12', due: '2026-11-16' });   // R6 (changed): FS lag 1 → 2nd bd after; 2-bd span kept
  assert.deepEqual(plan.C, { start: '2026-11-10', due: '2026-11-12' });   // FF: due ≥ Nov 10 + 2
  assert.equal(plan.A, undefined);                                         // unchanged items omitted
  // applying the plan clears the conflicts
  const d2 = depDocs(); d2.workItem.find(e => e.id === 'E').data.start = '2026-11-09'; d2.workItem.find(e => e.id === 'E').data.due = '2026-11-10';
  const p2 = E.autoSchedule(d2, 'P');
  d2.workItem.forEach(e => { if (p2[e.id]) Object.assign(e.data, p2[e.id]); });
  assert.deepEqual(E.scheduleConflicts(d2, 'P'), []);
  assert.deepEqual(Object.keys(E.autoSchedule(d2, 'P', ['A'])), []);       // restricted to given ids
});

test('R5 external deps, causesSlip', () => {
  const d = baseDocs();
  d.workItem.push({ id: 'X1', data: { id: 'X1', projectId: 'other-project', pid: 'p', step: 's', title: 'Treasury platform upgrade', owner: 'lp', status: 'idle', start: '2026-11-04', due: '2026-11-25', deps: [] } });
  d.project.push({ id: 'other-project', data: { id: 'other-project', name: 'Treasury Platform', processes: [] } });
  d.workItem.find(e => e.id === 'W11').data.deps = [{ id: 'X1', type: 'FS', lag: 0 }];
  deepFreeze(d);
  const fc = E.forecastAll(d, TODAY);
  assert.equal(fc.W11.forecast, '2026-12-07');                    // Nov 25 + 8 business days (W11 spans Nov 10–20)
  assert.equal(fc.W11.basis.external, true);
  assert.equal(fc.X1.causesSlip, true);
  assert.match(E.explainForecast(d, 'W11', TODAY)[1].text, /^Waits for external "Treasury platform upgrade" in "Treasury Platform" \(forecast Nov 25\)/);
  const base = E.forecastAll(baseDocs(), TODAY);
  assert.deepEqual(Object.keys(base).filter(k => base[k].causesSlip).sort(), ['W2', 'W4', 'W6', 'W8']);
  assert.equal(base.W10.causesSlip, false);
  const ex = E.scheduleConflicts(Object.assign({}, d, { workItem: d.workItem.map(e => e.id === 'W11' ? { id: 'W11', data: Object.assign({}, e.data, { start: '2026-11-10' }) } : e) }), PRJ);
  assert.ok(ex.some(x => x.workId === 'W11' && x.external && /\(external\)/.test(x.detail)));
});

// R6 deliberately changes the RAG rule (was: any late item = red, < 7 calendar days buffer = amber).
test('R6 projectStats RAG follows projectHealth; notPlanned', () => {
  let st = E.projectStats(baseDocs(), PRJ, TODAY);
  assert.deepEqual([st.rag, st.ragReason, st.notPlanned], ['red', 'Payment hold list is missing with no work planned to provide it', false]);
  let d = withHoldResolver(baseDocs());
  st = E.projectStats(d, PRJ, TODAY);
  assert.equal(st.rag, 'amber'); assert.match(st.ragReason, /^1 item late, but the finish still meets the target; 5 items slipping/);
  d = baseDocs(); d.workItem.forEach(e => { e.data.status = 'done'; e.data.doneAt = e.data.due; });
  st = E.projectStats(d, PRJ, TODAY);
  assert.deepEqual([st.rag, st.ragReason], ['green', 'All work done']);
  d.project[0].data.target = '2026-11-10';
  assert.deepEqual(E.projectStats(d, PRJ, TODAY).ragReason, 'Forecast finish Nov 20 is after the target Nov 10');
  d = baseDocs(); d.workItem = [];
  st = E.projectStats(d, PRJ, TODAY);
  assert.deepEqual([st.rag, st.ragReason, st.notPlanned], ['grey', 'Not planned: no work yet', true]);
});

test('R5 generateScenarios: one per path, branches expanded, loops once', () => {
  const sc = E.generateScenarios(deepFreeze(baseDocs()), PRJ);
  assert.deepEqual(sc.map(x => x.title), ['Vendor Onboarding: Risk tier? = High', 'Vendor Onboarding: Risk tier? = Standard', 'Invoice Approval: main path']);
  assert.deepEqual(sc[0].steps.map(x => x.step), ['s1', 's2', 'd1', 's2a', 's3', 's4', 's5', 's6']);
  assert.deepEqual(sc[1].steps.map(x => x.step), ['s1', 's2', 'd1', 's3', 's4', 's5', 's6']);
  assert.equal(sc[0].steps[2].action, 'At "Risk tier?", choose "High"');
  assert.ok(sc.every(x => x.steps.every(s => !IDS.test(s.action + s.expected))));
  // loop-back and parallel
  const d = baseDocs();
  d.process[1].data.tobe = [
    { id: 'k', type: 'trigger', title: 'Invoice received', owner: 'ar', data: [] },
    { id: 'i1', title: 'Match to PO', owner: 'ar', data: ['D4'] },
    { id: 'g1', type: 'decision', title: 'Matched?', branches: [{ label: 'Yes', nodes: [] }, { label: 'No', nodes: [{ id: 'i1b', title: 'Fix the PO', owner: 'ar', data: [] }], goto: 'i1' }] },
    { id: 'p1', type: 'parallel', title: 'Fan out', branches: [{ label: 'Pay', nodes: [{ id: 'i3', title: 'Schedule payment', owner: 'lp', data: [] }] }, { label: 'File', nodes: [{ id: 'i5', title: 'Archive invoice', owner: 'ar', data: [] }] }] },
    { id: 'e', type: 'end', title: 'Done' },
  ];
  const s2 = E.generateScenarios(d, PRJ).filter(x => x.pid === 'invoice-approval');
  assert.deepEqual(s2.map(x => x.steps.map(y => y.step).join('>')), [
    'i1>g1>p1>i3>i5',
    'i1>g1>i1b>i1>i1>g1>p1>i3>i5',
  ]);
  assert.equal(s2[1].title, 'Invoice Approval: Matched? = No, loop back once, Matched? = Yes');
  assert.ok(s2[1].steps.some(x => x.action === 'Return to "Match to PO"'));
});

test('R5 caseLabel: TC<n> per element, stable by creation', () => {
  const d = readyDocs();
  assert.equal(E.caseLabel(d, 'T1'), 'TC1');
  assert.equal(E.caseLabel(d, 'T2'), 'TC2');
  assert.equal(E.caseLabel(d, 'TF0'), 'TC3');
  assert.equal(E.caseLabel(d, 'CD1'), 'TC1');                       // numbering is per element
  d.testCase.filter(e => e.data.dataId === 'D2').forEach((e, i) => { e.data.createdAt = '2026-11-0' + (i + 2) + 'T00:00:00Z'; });
  d.testCase.find(e => e.id === 'T2').data.createdAt = '2026-11-01T00:00:00Z';   // created first
  assert.equal(E.caseLabel(d, 'T2'), 'TC1');
  assert.equal(E.caseLabel(d, 'T1'), 'TC2');
  assert.equal(E.caseLabel(d, 'nope'), null);
});

test('R5 generated cases: longest-length expectation follows the spec; no "? rows"; merged shapes', () => {
  const d2 = baseDocs().dataElement.find(e => e.id === 'D2').data;
  const cols = E.profileCsv(CSV, {}).map(c => { const x = Object.assign({}, c); delete x.rows; return x; });
  const cases = E.generateTests(d2, { rows: 4, columns: cols });
  const longest = cases.find(c => c.field === 'Routing number' && /longest observed length \(9\)/i.test(c.note));   // may merge into the identical spec case
  assert.equal(longest.expect, 'accept');                          // spec allows 9 digits
  assert.ok(aba(longest.input));
  const holderLong = cases.find(c => c.field === 'Account holder' && /longest observed length/i.test(c.note));
  assert.equal(holderLong.expect, 'accept');                       // within max 40
  cases.forEach(c => assert.ok(!/\?/.test(c.note.replace(/Risk tier\?/g, '')), c.note));
  assert.ok(cases.some(c => /\(1 of 4 rows\)/.test(c.note)));
  // duplicate humanized patterns are merged
  assert.deepEqual(E.humanPatterns([{ pattern: 'Aa{4} Aa{5}', count: 2 }, { pattern: 'Aa{3} Aa{6}', count: 3 }, { pattern: '9{8}', count: 1 }]),
    [{ text: 'two capitalized words', count: 5 }, { text: '8 digits', count: 1 }]);
  const drift = E.specDrift({ fields: [{ name: 'Code', type: 'text', pattern: '^\\d+$' }] }, { rows: 5, columns: E.profileCsv('Code\nAb Cd\nAbc Def\nGh Ij\n123\n45\n', {}) });
  assert.equal(drift.find(x => x.issue === 'pattern-mismatch').detail, '3 of 5 codes look like two capitalized words, which does not match the spec pattern.');
});

test('R5 usageOf counts to-be and as-is separately', () => {
  const u = E.usageOf(deepFreeze(baseDocs()), 'D2');
  assert.deepEqual([u.tobe, u.asis], [4, 3]);
  assert.deepEqual(u.asisSteps.map(x => x.stepId), ['a3', 'a4', 'b3']);
  assert.deepEqual(E.usageOf(baseDocs(), 'D9'), { tobe: 1, asis: 0, tobeSteps: [{ pid: 'invoice-approval', stepId: 'i4' }], asisSteps: [] });
});

test('R5 financials: workCost, projectFinancials, burndown', () => {
  const d = baseDocs();
  d.person.find(e => e.id === 'dk').data.dayRate = 1000;
  d.workItem.find(e => e.id === 'W8').data.effortDays = 5;
  d.project[0].data.budget = { planned: 9000 };
  d.project[0].data.program = 'Supplier Excellence';
  deepFreeze(d);
  assert.equal(E.workCost(d, 'W8'), 5000);                         // 5 days × 1,000
  assert.equal(E.workCost(d, 'W6'), 800);                          // default: 1 day × 800
  const f = E.projectFinancials(d, PRJ);
  // dk: W3, W7, W9 at 1 day × 1000 + W8 5000 = 8000; others: W1, W2, W4, W5, W6, W10 at 800 = 4800 → 12800 (+W11 dk 1000) = 13800
  assert.deepEqual(f, { planned: 9000, forecastCost: 13800, actualCost: 1800, remainingCost: 12000, variance: 4800, overBudget: true, program: 'Supplier Excellence' });
  const bd = E.burndown(d, PRJ, TODAY);
  assert.deepEqual(bd[0], { date: '2026-10-08', remaining: 15, ideal: 15 });
  assert.equal(bd[bd.length - 1].date, '2026-12-15'); assert.equal(bd[bd.length - 1].ideal, 0);
  assert.equal(bd.find(p => p.date === '2026-10-20').remaining, 14);   // W1 done on its due date
  assert.equal(bd.find(p => p.date === '2026-10-30').remaining, 13);   // W9
  assert.equal(bd.find(p => p.date === '2026-11-05').remaining, null);  // future
  assert.ok(bd.every(p => !['0', '6'].includes(String(new Date(p.date + 'T00:00:00Z').getUTCDay()))));
  assert.deepEqual(E.burndown(d, 'nope', TODAY), []);
});

/* ---------------- R6 ---------------- */
test('R6 projectHealth: red only for finish after target or unplanned missing data; amber for late/slip/buffer; grey', () => {
  assert.deepEqual(E.projectHealth(deepFreeze(baseDocs()), PRJ, TODAY), { rag: 'red', reasons: ['Payment hold list is missing with no work planned to provide it'] });
  const d = withHoldResolver(baseDocs());
  const h = E.projectHealth(d, PRJ, TODAY);
  assert.equal(h.rag, 'amber');                                     // late W6 but finish Dec 1 ≤ target Dec 15
  assert.deepEqual(h.reasons, ['1 item late, but the finish still meets the target', '5 items slipping']);
  d.project[0].data.target = '2026-11-30';
  assert.deepEqual(E.projectHealth(d, PRJ, TODAY), { rag: 'red', reasons: ['Forecast finish Dec 1 is after the target Nov 30'] });
  // buffer: everything on plan, finish 4 business days before target → amber
  const g = { workItem: [{ id: 'A', data: { id: 'A', projectId: 'P', status: 'idle', start: '2026-11-16', due: '2026-11-20', deps: [] } }],
    project: [{ id: 'P', data: { id: 'P', processes: [], target: '2026-11-26' } }] };
  assert.deepEqual(E.projectHealth(g, 'P', TODAY), { rag: 'amber', reasons: ['Only 4 business days of buffer before the target'] });
  g.project[0].data.target = '2026-11-27';
  assert.deepEqual(E.projectHealth(g, 'P', TODAY), { rag: 'green', reasons: ['On track: 5 business days of buffer'] });
  g.workItem = [];
  assert.equal(E.projectHealth(g, 'P', TODAY).rag, 'grey');
});

test('R6 scheduleBadge: one badge, late > causing > slipping > soon > on track', () => {
  const d = deepFreeze(withHoldResolver(baseDocs()));
  const k = id => E.scheduleBadge(d, id, TODAY).key;
  assert.deepEqual(['W1', 'W6', 'W8', 'W2', 'W7', 'W3'].map(k), ['done', 'late', 'causing', 'causing', 'slipping', 'ontrack']);
  assert.deepEqual(E.scheduleBadge(d, 'W8', TODAY), { key: 'causing', label: 'Causing slip' });
  assert.equal(E.scheduleBadge(d, 'W6', TODAY).label, 'Late');      // W6 is late AND causes slip: late wins
  const s = { workItem: [{ id: 'S', data: { id: 'S', projectId: 'P', status: 'idle', start: '2026-11-04', due: '2026-11-06', deps: [] } }] };
  assert.deepEqual(E.scheduleBadge(s, 'S', TODAY), { key: 'soon', label: 'Due soon' });
  assert.equal(E.scheduleBadge(s, 'nope', TODAY).key, 'ontrack');
});

test('R6 earnedValue: BAC, PV, EV, AC, SPI, CPI, EAC with divide-by-zero guards', () => {
  const W = (id, status, start, due, more) => ({ id, data: Object.assign({ id, projectId: 'P', owner: 'mc', status, start, due, deps: [] }, more) });
  const d = { person: [{ id: 'mc', data: { id: 'mc', dayRate: 800 } }, { id: 'lp', data: { id: 'lp', dayRate: 1600 } }],
    project: [{ id: 'P', data: { id: 'P', processes: [] } }],
    workItem: [
      W('A', 'done', '2026-10-26', '2026-10-30', { effortDays: 5, time: [{ by: 'mc', date: '2026-10-28', hours: 40 }] }),   // 4000, AC 4000
      W('B', 'prog', '2026-11-02', '2026-11-06', { effortDays: 5, progress: 0.4, time: [{ by: 'lp', date: '2026-11-03', hours: 8 }] }), // AC 1600
      W('C', 'idle', '2026-11-09', '2026-11-13', { effortDays: 5 }),
    ] };
  deepFreeze(d);
  const ev = E.earnedValue(d, 'P', TODAY);
  // PV: A 4000 + B 4000 × (2 of 4 bd from Nov 2 to Nov 4) = 6000; EV: 4000 + 1600 = 5600; AC: 4000 + 1600
  assert.deepEqual(ev, { BAC: 12000, PV: 6000, EV: 5600, AC: 5600, SPI: 0.93, CPI: 1, EAC: 12000 });
  const b = JSON.parse(JSON.stringify(d)); b.project[0].data.budget = { planned: 6000 };
  assert.deepEqual(E.earnedValue(b, 'P', TODAY), { BAC: 6000, PV: 3000, EV: 2800, AC: 5600, SPI: 0.93, CPI: 0.5, EAC: 12000 });
  const z = E.earnedValue({ project: [{ id: 'P', data: { id: 'P' } }], workItem: [] }, 'P', TODAY);
  assert.deepEqual(z, { BAC: 0, PV: 0, EV: 0, AC: 0, SPI: null, CPI: null, EAC: 0 });
});

test('R6 levelResources: latest-starting non-critical items move later, spans kept, FS successors follow', () => {
  const W = (id, status, start, due, more) => ({ id, data: Object.assign({ id, projectId: 'P', owner: 'mc', title: id, status, start, due, deps: [] }, more) });
  const d = deepFreeze({ person: [{ id: 'mc', data: { id: 'mc', capacity: 4 } }], project: [{ id: 'P', data: { id: 'P', processes: [], target: '2026-12-31' } }],
    workItem: [
      W('A', 'idle', '2026-11-09', '2026-11-13', { effortDays: 3 }),
      W('B', 'idle', '2026-11-09', '2026-11-13', { effortDays: 3 }),
      W('C', 'idle', '2026-11-11', '2026-11-13', { effortDays: 2 }),
      W('D', 'idle', '2026-11-16', '2026-11-17', { effortDays: 1, deps: ['C'] }),
      W('Z', 'idle', '2026-11-23', '2026-12-04', { owner: 'lp', effortDays: 2 }),            // the critical path
    ] });
  assert.deepEqual(E.criticalPath(d, 'P', TODAY), ['Z']);
  const r = E.levelResources(d, 'P', TODAY);
  assert.deepEqual(r.overloadsBefore, [{ person: 'mc', week: '2026-11-09', load: 8, capacity: 4 }]);
  assert.deepEqual(r.overloadsAfter, []);
  assert.equal(r.shifts.A, undefined);                                  // earliest-starting item stays
  for (const id of Object.keys(r.shifts)) {
    const o = d.workItem.find(e => e.id === id).data;
    assert.equal(E.businessDaysBetween(r.shifts[id].start, r.shifts[id].due), E.businessDaysBetween(o.start, o.due));   // span kept
    assert.ok(r.shifts[id].start > o.start);                              // only later
    assert.ok(![0, 6].includes(new Date(r.shifts[id].start + 'T00:00:00Z').getUTCDay()));
  }
  assert.ok(r.shifts.D.start > r.shifts.C.due);                          // FS successor follows C
  // a single item that alone exceeds capacity is reported, not chased forever
  const one = { workItem: [W('X', 'idle', '2026-11-09', '2026-11-10', { effortDays: 6 })], project: d.project };
  const r1 = E.levelResources(one, 'P', TODAY);
  assert.deepEqual([Object.keys(r1.shifts).length, r1.overloadsAfter.length], [0, 1]);
});

test('R6 compareScenario and defaultTarget', () => {
  const W = (id, start, due, more) => ({ id, data: Object.assign({ id, projectId: 'P', owner: 'mc', title: id, status: 'idle', start, due, deps: [] }, more) });
  const d = deepFreeze({ workItem: [W('A', '2026-11-09', '2026-11-13'), W('B', '2026-11-16', '2026-11-20', { effortDays: 2, deps: ['A'] })], project: [{ id: 'P', data: { id: 'P', processes: [] } }] });
  const same = E.compareScenario(d, 'P', { dates: { B: { start: '2026-11-16', due: '2026-11-20' } } }, TODAY);
  assert.deepEqual(same, { planFinish: '2026-11-20', scenarioFinish: '2026-11-20', planCost: 4800, scenarioCost: 4800, changed: [] });
  const r = E.compareScenario(d, 'P', { dates: { A: { start: '2026-11-09', due: '2026-11-19' } } }, TODAY);
  assert.deepEqual(r, { planFinish: '2026-11-20', scenarioFinish: '2026-11-23', planCost: 4800, scenarioCost: 8000, changed: ['A'] });
  assert.equal(d.workItem[0].data.due, '2026-11-13');                    // live plan untouched
  assert.equal(E.defaultTarget('2026-11-04'), '2027-01-04');             // Jan 3 is a Sunday → Monday
  assert.equal(E.defaultTarget('2026-11-02'), '2027-01-01');
});

test('R6 testCoverage: field coverage beside UAT and dev counts', () => {
  const r = deepFreeze(readyDocs());
  const c = E.testCoverage(r, PRJ);
  assert.deepEqual([c.fieldsTotal, c.fieldsCovered, c.uncoveredFields], [5, 5, []]);
  assert.equal(c.uat.done, c.uat.total); assert.equal(c.dev.total, 14); assert.equal(c.dev.done, 14);
  const d = readyDocs();
  d.testCase = d.testCase.filter(e => e.id !== 'TF0');                       // Bank name loses its case
  d.testRun[1].data.results = d.testRun[1].data.results.map(x => x.caseId === 'T1' ? Object.assign({}, x, { outcome: 'fail' }) : x);
  const c2 = E.testCoverage(d, PRJ);
  assert.deepEqual(c2.uncoveredFields, [{ data: 'D2', field: 'Bank name' }]);
  assert.equal(c2.fieldsCovered, 4);
  assert.equal(c2.uat.done, c2.uat.total - 1);
  assert.deepEqual(E.testCoverage(baseDocs(), PRJ).dev, { done: 0, total: 0 });
});

test('R6 defectState lifecycle; a passing retest verifies', () => {
  const d = readyDocs();
  d.testRun.push({ id: 'R3', data: { id: 'R3', projectId: PRJ, env: 'uat', at: '2026-11-03T09:00:00Z', by: 'ar', results: [{ caseId: 'T1', outcome: 'fail' }] } });
  const D = (id, more) => ({ id, data: Object.assign({ id, projectId: PRJ, kind: 'defect', title: 'Defect ' + id, owner: 'dk', status: 'idle', severity: 2, testRef: { runId: 'R3', caseId: 'T1' } }, more) });
  d.workItem.push(D('DF1'), D('DF2', { defectStatus: 'triaged' }), D('DF3', { defectStatus: 'in progress' }), D('DF4', { defectStatus: 'fixed' }),
    D('DF5', { defectStatus: 'closed' }), D('DF6', { status: 'prog' }), D('DF7', { defectStatus: 'verified' }));
  const s = () => ['DF1', 'DF2', 'DF3', 'DF4', 'DF5', 'DF6', 'DF7'].map(id => E.defectState(d, id));
  assert.deepEqual(s(), ['new', 'triaged', 'in-progress', 'fixed', 'closed', 'in-progress', 'fixed']);
  assert.deepEqual(E.defectsVerifiable(d, PRJ), []);
  // retest passes after the failing run → every open defect on T1 is verified
  d.testRun.push({ id: 'R4', data: { id: 'R4', projectId: PRJ, env: 'uat', at: '2026-11-04T09:00:00Z', by: 'ar', results: [{ caseId: 'T1', outcome: 'pass' }] } });
  assert.deepEqual(s(), ['verified', 'verified', 'verified', 'verified', 'closed', 'verified', 'verified']);
  assert.deepEqual(E.defectsVerifiable(d, PRJ), ['DF1', 'DF2', 'DF3', 'DF4', 'DF6', 'DF7']);
  assert.equal(E.defectState(d, 'nope'), null);
});

test('R6 stepState built/awaitingLive; criticalPath full predecessor chain', () => {
  const d = baseDocs();
  d.workItem.find(e => e.id === 'W6').data.status = 'done';
  d.workItem.find(e => e.id === 'W7').data.status = 'done';
  deepFreeze(d);
  const s3 = E.stepState(d, PRJ, 'vendor-onboarding', 's3', TODAY);    // work done, D2 only pending (not live)
  assert.deepEqual([s3.status, s3.built, s3.awaitingLive], ['done', true, true]);
  const s6 = E.stepState(d, PRJ, 'vendor-onboarding', 's6', TODAY);    // D7 live
  assert.deepEqual([s6.built, s6.awaitingLive], [true, false]);
  assert.deepEqual([E.stepState(d, PRJ, 'vendor-onboarding', 's5', TODAY).built, E.stepState(d, PRJ, 'vendor-onboarding', 's2', TODAY).awaitingLive], [false, false]);
  // non-binding dependencies still form the chain
  const W = (id, start, due, deps) => ({ id, data: { id, projectId: 'P', title: id, owner: 'mc', status: 'idle', start, due, deps } });
  const c = { project: [{ id: 'P', data: { id: 'P', processes: [] } }], workItem: [W('A', '2026-11-05', '2026-11-06', []), W('B', '2026-11-09', '2026-11-10', ['A']), W('C', '2026-11-16', '2026-11-20', ['B'])] };
  assert.deepEqual(E.criticalPath(c, 'P', TODAY), ['A', 'B', 'C']);
});

test('R6 autoSchedule keeps spans exactly, moves only conflicts, FS starts next business day', () => {
  const W = (id, start, due, deps) => ({ id, data: { id, projectId: 'P', title: id, owner: 'mc', status: 'idle', start, due, deps: deps || [] } });
  const d = deepFreeze({ project: [{ id: 'P', data: { id: 'P', processes: [] } }], workItem: [
    W('A', '2026-11-09', '2026-11-13'),                   // Mon–Fri
    W('B', '2026-11-12', '2026-11-12', ['A']),            // same-day item overlapping A → conflict
    W('C', '2026-11-16', '2026-11-18', ['B']),            // fine before, conflicts once B moves
    W('S', '2026-11-07', '2026-11-10'),                   // weekend start, no conflict: never touched
  ] });
  const plan = E.autoSchedule(d, 'P');
  assert.deepEqual(plan, { B: { start: '2026-11-16', due: '2026-11-16' }, C: { start: '2026-11-17', due: '2026-11-19' } });
  assert.deepEqual(E.scheduleConflicts(d, 'P').map(x => x.workId), ['B']);
});

test('R6 suggestWorkFromDiff: business days only, spans spread toward target with buffer, FS respected', () => {
  const docs = deepFreeze(baseDocs());
  const sug = E.suggestWorkFromDiff(docs, PRJ, TODAY);
  const fc = E.forecastAll(docs, TODAY);
  const fin = id => (sug.find(x => x.key === id) || {}).due || fc[id].forecast;
  sug.forEach(s => {
    [s.start, s.due].forEach(x => assert.ok(![0, 6].includes(new Date(x + 'T00:00:00Z').getUTCDay()), x));
    assert.ok(E.businessDaysBetween(s.start, s.due) >= s.effortDays);
    s.deps.forEach(dp => assert.ok(s.start > fin(dp), s.key + ' after ' + dp));
    assert.ok(s.due <= '2026-12-15');
  });
  assert.ok(E.businessDaysBetween(sug.map(s => s.due).sort().pop(), '2026-12-15') >= 5);   // buffer kept
});

test('R6 exceptions share the bu-signoff staleness (cutover edits included); runbook overdue warns', () => {
  let d = readyDocs(); d.project[0].data.cutoverUpdatedAt = '2026-11-02T00:00:00Z';
  let r = E.readiness(d, PRJ, TODAY);
  const ex = check(r, 'exceptions'), bu = check(r, 'bu-signoff');
  assert.equal(ex.pass, false); assert.equal(ex.warning, true);
  assert.deepEqual(ex.items, ['cutover']);
  assert.equal(ex.detail, 'Cutover plan changed after Accounts Payable, Compliance, IT, Procurement and Treasury sign-off.');
  assert.deepEqual(bu.items.slice().sort(), ex.cutoverBus.slice().sort());     // same truth
  // work edit: both checks agree on the BU and the item
  d = readyDocs(); d.workItem[5].data.updatedAt = '2026-11-02T08:00:00Z';
  r = E.readiness(d, PRJ, TODAY);
  assert.deepEqual(check(r, 'exceptions').items, ['W6']); assert.deepEqual(check(r, 'bu-signoff').stale[0].changed, ['workItem:W6']);
  // runbook: planned start + duration in the past and not done → warning only
  d = readyDocs();
  d.project[0].data.cutover.tasks = [{ id: 'CT1', task: 'Switch over', owner: 'dk', plannedStart: '2026-11-03T06:00:00Z', durationMins: 60, gonogo: true, done: false },
    { id: 'CT2', task: 'Smoke test', owner: 'dk', plannedStart: '2026-11-04T09:00:00Z', durationMins: 30, done: false }];
  r = E.readiness(d, PRJ, TODAY);
  assert.deepEqual(check(r, 'exceptions').items, ['task:CT1']);
  assert.equal(check(r, 'exceptions').status, 'warn');
  assert.match(check(r, 'exceptions').detail, /^1 runbook task is overdue: "Switch over"\.$/);
  assert.equal(r.pass, true);
  assert.deepEqual(check(E.readiness(d, PRJ, '2026-11-04T10:00:00Z'), 'exceptions').items, ['task:CT1', 'task:CT2']);
});

test('R6 node types: subprocess, wait, message in flatSteps, diff and process-valid', () => {
  const d = readyDocs();
  const tobe = d.process[0].data.tobe;
  tobe.splice(2, 0, { id: 'w1', type: 'wait', title: 'Wait 2 business days for vendor response', wait: '2 business days', data: [] },
    { id: 'm1', type: 'message', title: 'Notify vendor', direction: 'send', party: 'Vendor', data: [] },
    { id: 'sp1', type: 'subprocess', title: 'Approve first invoice', owner: 'ar', calls: 'invoice-approval', data: [] });
  const steps = E.flatSteps(tobe).map(s => s.id);
  assert.ok(['w1', 'm1', 'sp1'].every(id => steps.includes(id)));
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'process-valid').pass, true);          // wait/message need no owner
  tobe.find(n => n.id === 'sp1').calls = 'no-such-process';
  const pv = check(E.readiness(d, PRJ, TODAY), 'process-valid');
  assert.equal(pv.pass, false); assert.deepEqual(pv.items, ['vendor-onboarding:sp1']);
  assert.match(pv.detail, /Subprocess "Approve first invoice" in Vendor Onboarding calls a process that does not exist/);
  // diff: changed wait/message/subprocess properties are reported
  const p = { asis: [{ id: 'x', type: 'wait', title: 'Wait', wait: '1 business day' }, { id: 'y', type: 'message', title: 'Tell', direction: 'send', party: 'Vendor' }],
    tobe: [{ id: 'x', type: 'wait', title: 'Wait', wait: '2 business days', from: 'x' }, { id: 'y', type: 'message', title: 'Tell', direction: 'receive', party: 'Vendor', from: 'y' }] };
  const df = E.diffProcess(p);
  assert.equal(df.nodes.x, 'changed'); assert.equal(df.nodes.y, 'changed');
});

test('R6 generateTests: complete in one call, type-tailored values, specials only for free text', () => {
  const de = { id: 'DV', fields: [
    { name: 'Tax ID (EIN)', pattern: '##-#######', required: true }, { name: 'Remit-to address', type: 'text' }, { name: 'Contact email', type: 'text' },
    { name: 'Vendor ID', type: 'text' }, { name: 'Legal name', type: 'text', required: true }, { name: 'Notes', type: 'text' },
  ] };
  const prof = E.profileCsv('Tax ID,Remit-to address,Notes\n12-3456789,"1 Main St, Ste 2",a&b\n98-7654321,2 Oak Ave,x\n', {});
  const cases = E.generateTests(de, prof);
  de.fields.forEach(f => assert.ok(cases.some(c => c.field === f.name && c.kind === 'valid'), f.name));   // every field, one call
  const by = n => cases.filter(c => c.field === n);
  assert.ok(!by('Tax ID (EIN)').some(c => /special character/i.test(c.note)));          // no "1-2-3456789"
  assert.ok(!by('Tax ID (EIN)').some(c => c.input === '1-2-3456789'));
  assert.equal(by('Remit-to address').find(c => c.kind === 'valid').input, '125 Harbor Way, Suite 4');
  assert.ok(by('Remit-to address').some(c => /Special characters/.test(c.note)));
  assert.equal(by('Contact email').find(c => c.kind === 'valid').input, 'ap@northwind.example');
  assert.ok(!by('Contact email').some(c => /Special characters/.test(c.note)));
  assert.equal(by('Vendor ID').find(c => c.kind === 'valid').input, 'NW100245');
  assert.ok(!by('Vendor ID').some(c => c.kind === 'edge' && /Special/.test(c.note)));
  const emoji = /\p{Extended_Pictographic}/u;
  cases.filter(c => emoji.test(c.input)).forEach(c => assert.equal(c.field, 'Legal name'));   // emoji only in name fields
  assert.ok(by('Legal name').some(c => emoji.test(c.input)));
  cases.filter(c => !c.context).forEach(c => assert.equal(E.validate(E.fieldSpec(de.fields.find(f => f.name === c.field)), c.input) ? 'accept' : 'reject', c.expect));
});

test('R6 profileCsv duplicates; specDrift uses the spec unit and flags duplicates on unique fields', () => {
  const prof = E.profileCsv('Tax ID,Invoice no\n123456789,INV-1\n12-3456789,INV-1\n98-7654321,INV-2\n,INV-1\n', {});
  assert.deepEqual(prof.map(c => [c.name, c.duplicates]), [['Tax ID', 0], ['Invoice no', 2]]);
  const drift = E.specDrift({ fields: [{ name: 'Tax ID (EIN)', pattern: '##-#######' }, { name: 'Invoice no', type: 'text', unique: true }] }, { rows: 4, columns: prof });
  // 2026-11 R6: old wording mixed units ("9 digits; the spec says 10")
  assert.equal(drift.find(x => x.issue === 'length-mismatch').detail, '1 of 4 tax IDs has 9 characters; the spec requires 10 characters.');
  assert.equal(drift.find(x => x.issue === 'duplicates').detail, '2 of 4 invoice nos repeat an earlier value; the spec says each invoice no must be unique.');
  assert.ok(!E.specDrift({ fields: [{ name: 'Invoice no', type: 'text' }] }, { rows: 4, columns: prof }).some(x => x.issue === 'duplicates'));   // not unique: no flag
});
