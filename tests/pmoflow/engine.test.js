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
// R8: generateTests keeps at most 6 cases per field by default; the pre-R8 tests below check the full set.
const GT = (d, p) => E.generateTests(d, p, { all: true });

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
// R8: remove an element from every Today (as-is) step so it counts as new in the Future (the project changes it).
function asNewInFuture(d, id) {
  const strip = nodes => (nodes || []).forEach(n => { if (!n) return; if (Array.isArray(n.data)) n.data = n.data.filter(x => x !== id); (n.subs || []).forEach(x => { if (x && Array.isArray(x.data)) x.data = x.data.filter(y => y !== id); }); (n.branches || []).forEach(b => strip(b && b.nodes)); });
  d.process.forEach(e => strip(e.data.asis));
  return d;
}
// R6: plan the one unplanned missing element (D9) so health is driven by the schedule.
function withHoldResolver(d) {
  d.workItem.push({ id: 'W12', data: { id: 'W12', projectId: PRJ, pid: 'invoice-approval', step: 'i4', title: 'Hold list feed', owner: 'ar', status: 'idle', start: '2026-11-05', due: '2026-11-12', deps: [], resolves: 'D9' } });
  // R8: Vendor risk tier (new in the Future, examples only) is an unplanned blocker too; give it a live source.
  Object.assign(d.dataElement.find(e => e.id === 'D8').data, { avail: 'live', check: { ok: true, at: '2026-11-01T00:00:00Z', detail: 'Probe ok' } });
  return d;
}

/* ---------------- forecast ---------------- */
test('forecast: slip ripples from W6 through dependents with D2 as root cause', () => {
  const docs = deepFreeze(baseDocs());
  const fc = E.forecastAll(docs, TODAY);
  assert.equal(fc.W6.sched, 'late');
  assert.equal(fc.W6.forecast, '2026-11-11');         // today + 7-day duration
  assert.equal(fc.W6.slipDays, 6);                     // R9 §3: business days
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
  assert.equal(fc.W10.slipDays, 7);                    // R9 §3: business days
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
  assert.deepEqual([st.total, st.done, st.pct, st.late, st.slip, st.pastDue], [11, 2, 18, 6, 5, 1]);   // R9 §1: one late count (1 past due + 5 finishing after due)
  assert.equal(st.finish, '2026-12-01');
  assert.equal(st.onTrack, true);
  assert.equal(E.dataReady(docs, 'D4'), true);
  assert.equal(E.dataReady(docs, 'D2'), false);
  assert.equal(E.dataReady(docs, 'D1'), true);           // R8: on a Today step and not marked missing → live
  assert.equal(E.dataReady(docs, 'D8'), false);          // R8: new in Future, examples only → not live
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
  assert.deepEqual(rt.patterns[0], { pattern: '9{9}', count: 3, row: 1 });   // R9 §13: the first sample row with that shape
  assert.ok(rt.examples.includes('999999999'));          // R8: every digit hidden (021000021)
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
  const cases = GT(d2, E.profileCsv(CSV, {}));
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
  assert.ok(GT(d2).every(c => c.origin === 'spec'));
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
  assert.equal(fc.W6.slipDays, 3);                           // R9 §3: business days
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
  assert.equal(E.effectiveAvail(docs, 'D1'), 'live');            // R8: on a Today step, not marked missing
  assert.equal(E.effectiveAvail(docs, 'D8'), 'example');         // R8: new in Future
  assert.equal(E.effectiveAvail(docs, 'D2'), 'missing');
  assert.equal(E.effectiveAvail(docs, 'nope'), 'missing');
  const d = baseDocs(); d.workItem.find(e => e.id === 'W6').data.status = 'done';
  d.dataElement.find(e => e.id === 'D2').data.owner = 'ar';      // R8: a fix by someone other than the owner
  assert.equal(E.effectiveAvail(d, 'D2'), 'pending');            // R4: fix done, awaiting owner confirmation
  const s2 = E.stepState(docs, PRJ, 'vendor-onboarding', 's2', TODAY);
  assert.deepEqual(s2.blockers, ['D5']);                        // red: missing only
  assert.deepEqual(s2.needsLive, ['D8']);                       // amber: examples only (R8: D1 is on a Today step)
  const r = readyDocs(); r.dataElement.find(e => e.id === 'D8').data.avail = 'example';
  const c = check(E.readiness(r, PRJ, TODAY), 'data-live');
  assert.equal(c.pass, false); assert.equal(c.status, 'fail');
  assert.deepEqual(c.examples, ['D8']);
  assert.equal(c.detail, 'Vendor risk tier has examples only and needs a live source before go-live.');
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
  const cases = GT(d2);
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
  const dates = GT({ id: 'DX', fields: [{ name: 'Start date', type: 'date' }, { name: 'End date', type: 'date', rule: 'Must be after Start date' }] });
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
  // R8: D1/D3 are on Today steps ("We have it"): no tasks for them; only Not-available-yet information (D8, D9).
  assert.deepEqual(sug.map(s => [s.key, s.step, s.resolves || null]), [
    ['sug-1', 's2', 'D8'], ['sug-2', 'd1', null], ['sug-3', 's5', null], ['sug-4', 'i4', 'D9'], ['sug-5', 'i4', null]]);
  assert.equal(sug[0].title, 'Make Vendor risk tier available');      // R8: one plain wording
  assert.equal(sug[1].title, 'Configure routing: Risk tier?');        // new gateway
  assert.equal(sug[3].title, 'Make Payment hold list available');
  assert.equal(sug[3].owner, 'ar');                                 // data owner for resolvers
  assert.equal(sug[4].owner, 'ps');                                 // step owner otherwise
  // R6 (changed): flow-order FS deps on the nearest preceding step's work, plus resolvers; dates spread toward the target
  assert.deepEqual(sug[4].deps, ['W11', 'sug-4']);                  // i2's open work, then the D9 resolver
  assert.deepEqual(sug[2].deps, ['W8']);                            // s5 follows s4's open work
  assert.deepEqual(sug[1].deps, ['W2', 'W3', 'W4']);                // gateway follows s2's open work
  assert.ok(sug.every(s => s.effortDays === 3));                    // R8: default 3 business days
  assert.deepEqual([0, 3].map(i => sug[i].start), Array(2).fill('2026-11-04'));   // can start now = today
  // business day after deps finish; R9 §4 levelled: Priya's gateway task waits for her own risk-tier task first
  assert.deepEqual([sug[1].start, sug[2].start, sug[4].start], ['2026-11-18', '2026-11-25', '2026-11-25']);
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
  assert.deepEqual([s2.start, s2.due], ['2026-11-12', '2026-11-18']);   // R6 (changed): day after W6's Nov 11 forecast; spread span (R8: 3-day effort)
  assert.equal(E.suggestWorkFromDiff(docs, PRJ)[0].start, '2026-11-20');   // anchor: latest project due
  // weekend anchor rolls to Monday
  assert.equal(E.suggestWorkFromDiff(docs, PRJ, '2026-11-07')[0].start, '2026-11-09');
});

/* ================================ Round 4 ================================ */
test('R4 effectiveAvail: pending until the data owner confirms', () => {
  const d = baseDocs(); d.workItem.find(e => e.id === 'W6').data.status = 'done';
  d.workItem.find(e => e.id === 'W6').data.owner = 'dk';          // R8: fixed by someone other than the owner
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
  rd2.avail = 'missing'; rd2.owner = 'lp'; r.workItem.find(x => x.id === 'W6').data.owner = 'dk';   // R8: fixed by a non-owner
  const c = check(E.readiness(r, PRJ, TODAY), 'data-live');
  assert.equal(c.pass, false); assert.deepEqual(c.pending, ['D2']);
  assert.equal(c.awaiting[0].text, 'awaiting Leo Park to confirm');
  assert.match(c.detail, /Bank remittance details: fix done, awaiting Leo Park to confirm it is live with evidence\./);   // R5 wording
});

test('R4 sign-off: sections from touches, project owner excluded, signoffOpen', () => {
  let d = readyDocs();
  d.process[0].data.tobe.find(n => n.id === 's1').touches = ['Procurement', 'pmo'];   // PMO named in a tag (case-insensitive)
  let bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  // R7 (deliberate change): PMO's only member is the PM, so the section needs an approver chosen (was: unsigned)
  assert.ok(bu.sections.includes('PMO')); assert.deepEqual(bu.unsigned, []); assert.deepEqual(bu.needsApprover, ['PMO']);
  d.approval.push({ id: 'AP7', data: { id: 'AP7', projectId: PRJ, bu: 'PMO', approver: 'ta', decision: 'approved', at: '2026-11-01T10:00:00Z', stepUp: true } });
  let r = E.readiness(d, PRJ, TODAY);
  assert.deepEqual(check(r, 'bu-signoff').needsApprover, ['PMO']);      // ta is the project owner: doesn't count
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
  const cases = GT(d2, prof).filter(c => c.origin === 'profile');
  const rt = cases.filter(c => c.field === 'Routing number');
  const eight = rt.find(c => /^Observed shape: 8 digits/.test(c.note));
  assert.ok(eight && /^\d{8}$/.test(eight.input) && eight.expect === 'reject');
  const nine = rt.find(c => /^Observed shape: 9 digits/.test(c.note));
  assert.ok(nine && aba(nine.input) && nine.expect === 'accept');
  const blank = GT(d2, prof).find(c => c.field === 'Bank name' && c.input === '');   // blanks observed: deduped into the spec case
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
  asNewInFuture(d, 'D2'); d.workItem.find(e => e.id === 'W6').data.owner = 'dk';   // R8: evidence applies to changing information
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
  // R7 (deliberate change): ar is AP's only member, so AP needs an approver chosen (suggested: process owner Maya Chen)
  assert.deepEqual(bu.unsigned, ['Compliance']); assert.deepEqual(bu.needsApprover, ['Accounts Payable']);
  assert.equal(bu.suggestions['Accounts Payable'], 'mc');
  assert.deepEqual(bu.excludedApprovers, ['ta', 'ar']);
  assert.match(bu.detail, /Approvals by the project owner and release manager \(Tom Alvarez and Ana Ruiz\) do not count\./);
  assert.equal(check(r, 'two-person').pass, false);
  // R7 (deliberate change): a launch-day plan edit makes stale only the sections owning runbook tasks (CT1: dk, IT),
  // not every section; the launch owner gets their own review flag.
  d = readyDocs(); d.project[0].data.cutoverUpdatedAt = '2026-11-03T00:00:00Z';
  bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.deepEqual(bu.stale.map(x => x.bu), ['IT']);
  assert.ok(bu.stale.every(x => /the launch-day plan/.test(x.reason)));
  assert.deepEqual(bu.launchOwnerReview, { person: 'ta', needed: true });
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
  // R8: unplanned blockers = Not-available-yet information with no work planned (D9 missing, D8 new with examples only)
  assert.deepEqual([st.rag, st.ragReason, st.notPlanned], ['red', 'Vendor risk tier and Payment hold list are not available yet and no work is planned to get them', false]);
  let d = withHoldResolver(baseDocs());
  st = E.projectStats(d, PRJ, TODAY);
  assert.equal(st.rag, 'amber'); assert.match(st.ragReason, /^6 tasks late, but the finish still meets the deadline; /);   // R9 §1
  d = withHoldResolver(baseDocs()); d.workItem.forEach(e => { e.data.status = 'done'; e.data.doneAt = e.data.due; });
  st = E.projectStats(d, PRJ, TODAY);
  assert.deepEqual([st.rag, st.ragReason], ['green', 'All work done']);
  d.project[0].data.target = '2026-11-10';
  assert.deepEqual(E.projectStats(d, PRJ, TODAY).ragReason, 'Forecast finish Nov 20 is after the Nov 10 deadline');
  // R8: all tasks done but an unplanned blocker remains → At risk, never "All work done"
  d = baseDocs(); d.workItem.forEach(e => { e.data.status = 'done'; e.data.doneAt = e.data.due; });
  st = E.projectStats(d, PRJ, TODAY);
  assert.equal(st.rag, 'red'); assert.doesNotMatch(st.ragReason, /All work/);
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
  const cases = GT(d2, { rows: 4, columns: cols });
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
  // R8: actualCost = logged hours × rate (none logged here → 0); forecastCost = EAC (bottom-up estimate before actuals)
  assert.deepEqual(f, { planned: 9000, estimate: 13800, forecastCost: 13800, actualCost: 0, remainingCost: 13800, variance: 4800, overBudget: true, program: 'Supplier Excellence' });
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
  assert.deepEqual(E.projectHealth(deepFreeze(baseDocs()), PRJ, TODAY), { rag: 'red', label: 'Will miss the deadline', bufferDays: 10, reasons: ['Vendor risk tier and Payment hold list are not available yet and no work is planned to get them'] });
  const d = withHoldResolver(baseDocs());
  const h = E.projectHealth(d, PRJ, TODAY);
  assert.equal(h.rag, 'amber');                                     // late W6 but finish Dec 1 ≤ target Dec 15
  assert.equal(h.label, 'Some tasks late');                         // R9 §1 label
  assert.deepEqual(h.reasons, ['6 tasks late, but the finish still meets the deadline',
    'Bank remittance details, Sanctions screening result and Payment hold list are not available yet; work is planned to get them']);
  d.project[0].data.target = '2026-11-30';
  assert.deepEqual(E.projectHealth(d, PRJ, TODAY), { rag: 'red', label: 'Will miss the deadline', bufferDays: -1, reasons: ['Forecast finish Dec 1 is after the Nov 30 deadline'] });
  // R8: a small buffer alone is not "at risk" (status changes only for a missed deadline, a blocker or late tasks)
  const g = { workItem: [{ id: 'A', data: { id: 'A', projectId: 'P', status: 'idle', start: '2026-11-16', due: '2026-11-20', deps: [] } }],
    project: [{ id: 'P', data: { id: 'P', processes: [], target: '2026-11-26' } }] };
  assert.deepEqual(E.projectHealth(g, 'P', TODAY), { rag: 'green', label: 'On track', bufferDays: 4, reasons: ['On track: 4 business days of buffer'] });
  g.project[0].data.target = '2026-11-27';
  assert.deepEqual(E.projectHealth(g, 'P', TODAY), { rag: 'green', label: 'On track', bufferDays: 5, reasons: ['On track: 5 business days of buffer'] });
  g.workItem = [];
  assert.equal(E.projectHealth(g, 'P', TODAY).rag, 'grey');
});

test('R6/R9 scheduleBadge: one badge, past due > finishing after due > causing > soon > on track; one "Late"', () => {
  const d = deepFreeze(withHoldResolver(baseDocs()));
  const k = id => E.scheduleBadge(d, id, TODAY).key;
  // R9 §1: a late item that also holds up others stays "Late" (holdsUp), so map badges with "Late" = lateCount
  assert.deepEqual(['W1', 'W6', 'W8', 'W2', 'W7', 'W3'].map(k), ['done', 'late', 'slipping', 'causing', 'slipping', 'ontrack']);
  assert.deepEqual(E.scheduleBadge(d, 'W2', TODAY), { key: 'causing', label: 'Holding up other work', advancedLabel: 'Holding up other work', late: false, holdsUp: true });
  assert.deepEqual(E.scheduleBadge(d, 'W8', TODAY), { key: 'slipping', label: 'Late', advancedLabel: 'Will finish after its due date', late: true, holdsUp: true });
  assert.equal(E.scheduleBadge(d, 'W6', TODAY).advancedLabel, 'Past due');
  const t = E.projectTruth(d, PRJ, TODAY);
  assert.equal(d.workItem.filter(e => E.scheduleBadge(d, e.id, TODAY).label === 'Late').length, t.lateCount);
  const s = { workItem: [{ id: 'S', data: { id: 'S', projectId: 'P', status: 'idle', start: '2026-11-04', due: '2026-11-06', deps: [] } }] };
  assert.deepEqual(E.scheduleBadge(s, 'S', TODAY), { key: 'soon', label: 'Due soon', advancedLabel: 'Due soon', late: false, holdsUp: false });
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
  assert.deepEqual(ev, { BAC: 12000, PV: 6000, EV: 5600, AC: 5600, SPI: 0.93, CPI: 1, EAC: 12000, estimate: 12000 });
  const b = JSON.parse(JSON.stringify(d)); b.project[0].data.budget = { planned: 6000 };
  assert.deepEqual(E.earnedValue(b, 'P', TODAY), { BAC: 6000, PV: 3000, EV: 2800, AC: 5600, SPI: 0.93, CPI: 0.5, EAC: 12000, estimate: 12000 });
  const z = E.earnedValue({ project: [{ id: 'P', data: { id: 'P' } }], workItem: [] }, 'P', TODAY);
  assert.deepEqual(z, { BAC: 0, PV: 0, EV: 0, AC: 0, SPI: null, CPI: null, EAC: 0, estimate: 0 });
  // R8: before any hours are logged, EAC is the bottom-up estimate (so an estimate above the budget shows)
  const n = JSON.parse(JSON.stringify(b)); n.workItem.forEach(e => { delete e.data.time; });
  assert.equal(E.earnedValue(n, 'P', TODAY).EAC, 12000);
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
  // R8: only cases on information the project changes count (D2 fixed; D5, D7, D8, D9 new) → 10, not 14
  assert.equal(c.uat.done, c.uat.total); assert.equal(c.dev.total, 10); assert.equal(c.dev.done, 10);
  assert.deepEqual(c.system, c.dev); assert.equal(c.system.label, 'Try it out');
  const d = readyDocs();
  d.testCase = d.testCase.filter(e => e.id !== 'TF0');                       // Bank name loses its case
  d.testRun[1].data.results = d.testRun[1].data.results.map(x => x.caseId === 'T1' ? Object.assign({}, x, { outcome: 'fail' }) : x);
  const c2 = E.testCoverage(d, PRJ);
  assert.deepEqual(c2.uncoveredFields, [{ data: 'D2', field: 'Bank name' }]);
  assert.equal(c2.fieldsCovered, 4);
  assert.equal(c2.uat.done, c2.uat.total - 1);
  assert.deepEqual(E.testCoverage(baseDocs(), PRJ).dev, { done: 0, total: 0, label: 'Try it out' });
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
  d.workItem.find(e => e.id === 'W6').data.owner = 'dk';                // R8: fixed by a non-owner → still pending
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
  assert.equal(ex.detail, 'Cutover plan changed after IT sign-off.');     // R7 (deliberate): only the task-owning section
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
  const cases = GT(de, prof);
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

/* ======================= R7 SIMPLICITY ======================= */
// Internal ids must never appear in plain-language text.
function assertNoIds(text, docs) {
  const ids = [];
  Object.keys(docs).forEach(t => (Array.isArray(docs[t]) ? docs[t] : []).forEach(e => { if (e && e.id) ids.push(String(e.id)); }));
  ids.push(PRJ, 'vendor-onboarding', 'invoice-approval');
  const words = new Set(String(text).split(/[^A-Za-z0-9_-]+/).filter(Boolean));
  ids.filter(id => id.length > 1).forEach(id => assert.ok(!words.has(id), 'id "' + id + '" leaked into: ' + text));
}
const JARGON = /\b(SPI|CPI|EAC|slip|slipping|amber|UAT|SIT|spec|cutover|runbook|go\/no-go|BU)\b/i;

test('R7 availLabel: one label set from effectiveAvail', () => {
  const d = baseDocs();
  d.workItem.find(e => e.id === 'W2').data.status = 'done';      // resolver of D5 done (by dk, not the owner) -> pending
  d.workItem.find(e => e.id === 'W2').data.owner = 'dk';
  deepFreeze(d);
  // R8 Advanced: the detailed labels
  const A = { advanced: true };
  assert.deepEqual(E.availLabel(d, 'D4', A), { state: 'live', key: 'connected', label: 'Connected', tone: 'green' });
  assert.deepEqual(E.availLabel(d, 'D8', A), { state: 'example', key: 'sample', label: 'Sample only', tone: 'amber' });
  assert.deepEqual(E.availLabel(d, 'D2', A), { state: 'missing', key: 'notyet', label: 'Not available yet', tone: 'red' });
  assert.deepEqual(E.availLabel(d, 'D5', A), { state: 'pending', key: 'waiting', label: 'Waiting for confirmation', tone: 'amber' });
  assert.deepEqual(E.availLabel(d, 'nope', A), { state: 'missing', key: 'notyet', label: 'Not available yet', tone: 'red' });
  ['D1', 'D2', 'D4', 'D5'].forEach(id => assertNoIds(E.availLabel(d, id).label, d));
});

test('R7 projectSummary: label matches projectHealth; At risk says what; red/grey/green plain', () => {
  // red: D9 missing with nothing planned
  let d = deepFreeze(baseDocs());
  let s = E.projectSummary(d, PRJ, TODAY);
  assert.equal(s.rag, E.projectHealth(d, PRJ, TODAY).rag);
  assert.equal(s.rag, 'red'); assert.equal(s.label, 'Will miss the deadline');      // R9: unplanned blocker → red
  assert.match(s.sentence, /Vendor risk tier is not available yet and no work is planned to get it \(Priya Shah\)/);
  assert.ok(s.who.some(x => x.person === 'ar' && x.name === 'Ana Ruiz' && /Plan work to get Payment hold list/.test(x.action)));
  // amber: finishes before the deadline but W6 is late and holds up 3 tasks
  d = deepFreeze(withHoldResolver(baseDocs()));
  s = E.projectSummary(d, PRJ, TODAY);
  assert.equal(E.projectHealth(d, PRJ, TODAY).rag, 'amber');
  assert.equal(s.rag, 'amber'); assert.equal(s.label, 'Some tasks late');   // R9
  // R9 §1: forecast, deadline, the late count, then the first name to act
  assert.equal(s.sentence, 'Expected Dec 1, 10 business days before the Dec 15 deadline. 6 tasks are late; first: “Stand up structured bank capture” (Leo Park).');
  assert.ok(s.who.some(x => /^Get “.*” back on schedule$/.test(x.action)) && !s.who.some(x => /Speed up/.test(x.action)));
  assert.equal(s.who[0].person, 'lp'); assert.equal(s.who[0].action, 'Finish “Stand up structured bank capture” (was due Nov 3)');
  assert.equal(s.who[0].why, 'past-due');
  // green
  d = withHoldResolver(baseDocs());
  d.workItem.forEach(e => { if (e.data.status !== 'done') { e.data.status = 'idle'; e.data.deps = []; delete e.data.resolves; e.data.start = '2026-11-20'; e.data.due = '2026-11-25'; } });
  d.dataElement.forEach(e => { e.data.avail = 'live'; e.data.check = { ok: true }; });
  s = E.projectSummary(deepFreeze(d), PRJ, TODAY);
  assert.equal(E.projectHealth(d, PRJ, TODAY).rag, 'green');
  assert.deepEqual([s.rag, s.label], ['green', 'On track']);
  // R9 §1: nothing late, so the sentence names the first `who` entry (here: the tests to add)
  assert.equal(s.sentence, 'Expected Nov 25, 14 business days before the Dec 15 deadline. Next: add tests for 4 new pieces of information (Tom Alvarez).');
  // off track by date
  d = withHoldResolver(baseDocs()); d.project[0].data.target = '2026-11-20';
  s = E.projectSummary(deepFreeze(d), PRJ, TODAY);
  assert.equal(s.label, 'Will miss the deadline'); assert.match(s.sentence, /7 business days after the Nov 20 deadline\./);
  // grey
  d = baseDocs(); d.workItem = [];
  s = E.projectSummary(deepFreeze(d), PRJ, TODAY);
  assert.deepEqual([s.rag, s.label], ['grey', 'Not planned']);
  assert.match(s.sentence, /No work has been planned yet/);
  // project object accepted; unknown project
  assert.equal(E.projectSummary(baseDocs(), { id: PRJ }, TODAY).rag, 'red');
  assert.equal(E.projectSummary(baseDocs(), 'nope', TODAY).label, 'Not planned');
});

test('R7 projectSummary: no jargon, no ids, never contradicts itself', () => {
  const variants = [baseDocs(), withHoldResolver(baseDocs()), readyDocs()];
  const tight = withHoldResolver(baseDocs()); tight.project[0].data.target = '2026-12-02'; variants.push(tight);
  variants.forEach(d => {
    const s = E.projectSummary(d, PRJ, TODAY);
    assert.ok(!JARGON.test(s.sentence), s.sentence);
    assertNoIds(s.sentence, d); s.who.forEach(x => { assertNoIds(x.action, d); assertNoIds(x.name, d); });
    assert.equal(s.label, { green: 'On track', amber: 'Some tasks late', red: 'Will miss the deadline', grey: 'Not planned' }[E.projectHealth(d, PRJ, TODAY).rag]);
    if (s.rag === 'amber') { assert.ok(!/after the .* deadline/.test(s.sentence)); assert.ok(!/Nothing needs attention/.test(s.sentence)); assert.ok(s.sentence.split('. ').length >= 2); }
    if (s.rag === 'green') assert.ok(!/late|after the/.test(s.sentence));
  });
  // amber from a thin buffer only names the buffer
  const s = E.projectSummary(tight, PRJ, TODAY);
  assert.equal(s.rag, E.projectHealth(tight, PRJ, TODAY).rag);
});

test('R7 testingSummary: plain one line with a next action', () => {
  let d = deepFreeze(readyDocs());
  let t = E.testingSummary(d, PRJ);
  assert.equal(t.done, true);
  assert.match(t.sentence, /^Yes: (\d+) of \1 tests passed and no problems are open\.$/);   // R8: one number
  assert.equal(t.nextAction.key, 'none');
  // one rule without a test, one business test not run
  d = readyDocs();
  d.dataElement.find(e => e.id === 'D2').data.fields.push({ name: 'Swift code', type: 'text' });
  d.testCase.push({ id: 'CZ', data: { id: 'CZ', dataId: 'D4', field: 'g', kind: 'valid', input: 'x', expect: 'accept', origin: 'user' } });
  t = E.testingSummary(deepFreeze(d), PRJ);
  assert.equal(t.done, false);
  // R8: D4 is unchanged ("We have it"), so its untested case is not required; the new D2 rule still needs a test
  // R9 §6: one next sentence, never "Create the tests"
  assert.equal(t.sentence, 'Not yet: 22 of 22 tests passed. Next: add tests for 1 new piece of information.');
  assert.deepEqual([t.stage, t.next, t.nextAction], ['create', 'Add tests for 1 new piece of information', { key: 'generate', label: 'Add tests for 1 new piece of information' }]);
  // a failed test -> fix
  d = readyDocs(); d.testRun[1].data.results[0].outcome = 'fail';
  t = E.testingSummary(deepFreeze(d), PRJ);
  assert.equal(t.nextAction.key, 'fix'); assert.equal(t.next, 'Fix 1 problem, then re-run its test'); assert.equal(t.failed, 1);
  // nothing run yet
  d = baseDocs(); t = E.testingSummary(deepFreeze(d), PRJ);
  assert.equal(t.done, false);
  [readyDocs(), baseDocs(), d].forEach(x => { const s = E.testingSummary(x, PRJ); assert.ok(!JARGON.test(s.sentence), s.sentence); assertNoIds(s.sentence, x); assertNoIds(s.nextAction.label, x); });
  // done mirrors the gate check
  assert.equal(E.testingSummary(readyDocs(), PRJ).done, check(E.readiness(readyDocs(), PRJ, TODAY), 'tests-passed').pass);
});

test('R7 launchSteps: ordered plain checklist from the readiness checks', () => {
  let steps = E.launchSteps(deepFreeze(baseDocs()), PRJ, TODAY);
  assert.deepEqual(steps.map(s => s.label), ['Plan the work', 'Finish the work', 'Information available', 'Tests passed', 'Each team approved its part', 'Launch-day plan ready', 'Launch']);   // R8: no "connected"
  assert.deepEqual(steps.map(s => s.key), ['plan', 'work', 'information', 'tests', 'approvals', 'launch-plan', 'launch']);
  assert.equal(steps[0].done, true); assert.equal(steps[1].done, false); assert.equal(steps[1].next, true);
  assert.equal(steps.filter(s => s.next).length, 1);
  assert.ok(steps[2].who.includes('ar'));                         // D9 owner acts
  steps.forEach(s => { assert.ok(Array.isArray(s.who)); assertNoIds(s.label, baseDocs()); assertNoIds(s.action, baseDocs()); assert.ok(!JARGON.test(s.label + ' ' + s.action), s.action); });
  // ready project: everything but Launch done, Launch is next with the launch owner
  steps = E.launchSteps(deepFreeze(readyDocs()), PRJ, TODAY);
  assert.deepEqual(steps.map(s => s.done), [true, true, true, true, true, true, false]);
  assert.equal(steps[6].next, true); assert.deepEqual(steps[6].who, ['ta']);
  assert.match(steps[6].action, /Ready/);
  // the checklist agrees with readiness: all but launch done <=> gate passes
  assert.equal(E.readiness(readyDocs(), PRJ, TODAY).pass, true);
  // no work yet
  const d = baseDocs(); d.workItem = [];
  steps = E.launchSteps(deepFreeze(d), PRJ, TODAY);
  assert.equal(steps[0].done, false); assert.equal(steps[0].next, true); assert.deepEqual(steps[0].who, ['ta']);
  // released
  const r = readyDocs(); r.project[0].data.status = 'live';
  assert.ok(E.launchSteps(r, PRJ, TODAY).every(s => s.done));
});

test('R7 approvals count any time; signoffOpen is informational only', () => {
  const d = baseDocs();                       // most checks fail
  d.approval = wrap([{ id: 'A1', projectId: PRJ, bu: 'Treasury', approver: 'lp', decision: 'approved', at: '2026-11-04T09:00:00Z', stepUp: true }]);
  const r = E.readiness(deepFreeze(d), PRJ, TODAY);
  const bu = check(r, 'bu-signoff');
  assert.equal(r.signoffOpen, false);
  assert.ok(!bu.unsigned.includes('Treasury'));                 // counted although other checks fail
  assert.equal(bu.sectionStatus.find(s => s.bu === 'Treasury').approved, true);
  assert.equal(bu.sectionStatus.find(s => s.bu === 'IT').approved, false);
});

test('R7 re-approval scope: one owner change stales only the sections it touches (fingerprint)', () => {
  const d = readyDocs();
  const fp = bu => E.sectionFingerprint(d, PRJ, bu);
  d.approval.forEach(e => { e.data.fingerprint = fp(e.data.bu); });
  assert.equal(E.readiness(d, PRJ, TODAY).pass, true);
  assert.match(fp('Treasury'), /^s:[0-9a-z]+;d:[0-9a-z]+;t:[0-9a-z]+;c:[0-9a-z]+$/);
  // s3 moves from Leo Park (Treasury) to Ana Ruiz (Accounts Payable); the process is stamped as a whole
  d.process[0].data.tobe.find(n => n.id === 's3').owner = 'ar';
  d.process[0].data.updatedAt = '2026-11-03T00:00:00Z';
  const bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  // R8: Treasury's only changed step moved to Accounts Payable, so Treasury no longer has a part to approve
  assert.ok(!bu.sections.includes('Treasury'));
  assert.deepEqual(bu.stale.map(x => x.bu).sort(), ['Accounts Payable']);
  assert.ok(bu.stale.every(x => x.reason === 're-approval needed: its steps'));
  assert.ok(bu.stale.every(x => x.changed.every(c => /^section:/.test(c))));
  const ex = check(E.readiness(d, PRJ, TODAY), 'exceptions');
  assert.equal(ex.pass, false); assert.match(ex.detail, /Accounts Payable's steps/);
  // a test case change on D2 stales only the sections using D2 (Treasury, Accounts Payable: s3/s4/i1/i3)
  const t = readyDocs(); t.approval.forEach(e => { e.data.fingerprint = E.sectionFingerprint(t, PRJ, e.data.bu); });
  t.testCase.find(e => e.id === 'T1').data.input = '021000021';
  const st = check(E.readiness(t, PRJ, TODAY), 'bu-signoff').stale;
  assert.deepEqual(st.map(x => x.bu).sort(), ['Accounts Payable', 'Treasury']);
  assert.ok(st.every(x => /its tests/.test(x.reason)));
  // legacy approvals (no fingerprint) with step stamps: only the stamped step's section
  const l = readyDocs();
  l.process[0].data.tobe.forEach(n => { n.updatedAt = '2026-10-01T00:00:00Z'; });
  l.process[0].data.tobe.find(n => n.id === 's2').updatedAt = '2026-11-03T00:00:00Z';
  l.process[0].data.updatedAt = '2026-11-03T00:00:00Z';
  assert.deepEqual(check(E.readiness(l, PRJ, TODAY), 'bu-signoff').stale.map(x => x.bu), ['Compliance']);
});

test('R7 re-approval scope: launch-day plan edits stale only task-owning sections plus the launch owner check', () => {
  const d = readyDocs();
  d.project[0].data.cutover.tasks.push({ id: 'CT2', order: 2, task: 'Confirm bank feed', owner: 'lp', gonogo: false });
  d.approval.forEach(e => { e.data.fingerprint = E.sectionFingerprint(d, PRJ, e.data.bu); });
  let bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.equal(bu.pass, true); assert.equal(bu.launchOwnerReview.needed, false);
  // change Leo's task only
  d.project[0].data.cutover.tasks[1].task = 'Confirm bank feed and limits';
  d.project[0].data.cutoverUpdatedAt = '2026-11-03T00:00:00Z';
  bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.deepEqual(bu.stale.map(x => x.bu), ['Treasury']);
  assert.equal(bu.stale[0].reason, 're-approval needed: the launch-day plan');
  assert.deepEqual(bu.launchOwnerReview, { person: 'ta', needed: true });
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'exceptions').cutoverBus, ['Treasury']);
  // timestamps with per-task stamps (no fingerprint): only the stamped task's section
  const t = readyDocs();
  t.project[0].data.cutover.tasks.push({ id: 'CT2', task: 'Confirm bank feed', owner: 'lp', updatedAt: '2026-11-03T00:00:00Z' });
  t.project[0].data.cutover.tasks[0].updatedAt = '2026-10-01T00:00:00Z';
  t.project[0].data.cutoverUpdatedAt = '2026-11-03T00:00:00Z';
  assert.deepEqual(check(E.readiness(t, PRJ, TODAY), 'bu-signoff').stale.map(x => x.bu), ['Treasury']);
});

test('R7 eligible approvers: project.approvers override, never the PM or launch owner, needsApprover + suggestion', () => {
  let d = readyDocs();
  d.process[0].data.tobe.find(n => n.id === 's1').touches = ['Procurement', 'PMO'];   // PMO: only the PM (ta) is in it
  let bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.deepEqual(bu.needsApprover, ['PMO']);
  assert.equal(bu.suggestions.PMO, 'mc');                        // the process owner
  assert.equal(bu.sectionStatus.find(s => s.bu === 'PMO').needsApprover, true);
  assert.match(bu.detail, /No approver in PMO: assign one\. Suggested: Maya Chen\./);
  assert.equal(bu.pass, false);
  // override: Priya approves PMO's part
  d.project[0].data.approvers = { PMO: 'ps' };
  bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.deepEqual(bu.needsApprover, []); assert.deepEqual(bu.unsigned, ['PMO']);
  assert.deepEqual(bu.eligible.PMO, ['ps']);
  d.approval.push({ id: 'AP9', data: { id: 'AP9', projectId: PRJ, bu: 'PMO', approver: 'ps', decision: 'approved', at: '2026-11-01T10:00:00Z', stepUp: true } });
  assert.equal(E.readiness(d, PRJ, TODAY).pass, true);
  // the PM or the launch owner as override is ignored
  d = readyDocs(); d.process[0].data.tobe.find(n => n.id === 's1').touches = ['PMO'];
  d.project[0].data.approvers = { PMO: 'ta' };
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'bu-signoff').needsApprover, ['PMO']);
  d.project[0].data.releaseManager = 'dk'; d.project[0].data.approvers = { PMO: 'dk', IT: 'dk' };
  bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.ok(!bu.eligible.IT.includes('dk')); assert.ok(bu.needsApprover.includes('PMO'));
  // override for a BU nobody is in (HR)
  d = readyDocs(); d.process[0].data.tobe[0].touches = ['HR'];
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'bu-signoff').needsApprover, ['HR']);
  d.project[0].data.approvers = { HR: 'ps' };
  bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.deepEqual(bu.needsApprover, []); assert.deepEqual(bu.unsigned, ['HR']);
  // launchSteps shows the choose-approver action
  d = readyDocs(); d.process[0].data.tobe.find(n => n.id === 's1').touches = ['PMO'];
  const st = E.launchSteps(d, PRJ, TODAY).find(s => s.key === 'approvals');
  assert.equal(st.done, false); assert.match(st.action, /Choose who approves PMO's part/);
});

test('R7 ownerRole: role-only steps are valid and ignored by sign-off sections', () => {
  const d = readyDocs();
  const s6 = d.process[0].data.tobe.find(n => n.id === 's6');   // Dev Kumar (IT)
  delete s6.owner; s6.ownerRole = 'Employee';
  d.process[1].data.tobe.find(n => n.id === 'i2').owner = '';   // the other IT step
  d.process[1].data.tobe.find(n => n.id === 'i2').ownerRole = 'Manager';
  let r = E.readiness(d, PRJ, TODAY);
  assert.equal(check(r, 'process-valid').pass, true);
  assert.ok(check(r, 'bu-signoff').sections.includes('IT'));        // R8: IT still owns a launch-day task (Dev Kumar)
  d.project[0].data.cutover.tasks[0].owner = 'mc';
  r = E.readiness(d, PRJ, TODAY);
  assert.ok(!check(r, 'bu-signoff').sections.includes('IT'));
  // blank role is still "no owner"
  s6.ownerRole = '  ';
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'process-valid').pass, false);
});

test('R7 specFromProfile: types, required, bounds; generateTests uses observed min/max', () => {
  const prof = E.profileCsv('Amount,Qty,Paid on,Branch code,Payee,Memo\n12.50,3,2026-01-05,0012,Ana Li,a\n1200.00,10,2026-02-01,0099,Bo Chen,\n', {});
  const f = E.specFromProfile(prof);
  const by = n => f.find(x => x.name === n);
  assert.deepEqual(by('Amount'), { name: 'Amount', type: 'currency', required: true, origin: 'profile', min: 12.5, max: 1200, format: 'currency', rule: 'Required' });
  assert.equal(by('Qty').type, 'number'); assert.deepEqual([by('Qty').min, by('Qty').max], [3, 10]);
  assert.equal(by('Paid on').type, 'date');
  assert.equal(by('Branch code').type, 'digits'); assert.equal(by('Branch code').length, 4); assert.equal(by('Branch code').format, '4 digits');
  assert.equal(by('Payee').type, 'text'); assert.deepEqual([by('Payee').min, by('Payee').max], [6, 7]);
  assert.equal(by('Memo').required, false); assert.equal(by('Memo').rule, '');
  assert.deepEqual(E.specFromProfile({ columns: prof }), f);       // a profile doc works too
  assert.deepEqual(E.specFromProfile(null), []);
  // the generated spec validates its own sample
  const de = { id: 'DX', name: 'Payments', fields: f };
  const cases = GT(de, prof);
  cases.filter(c => !c.context).forEach(c => assert.equal(E.validate(E.fieldSpec(f.find(x => x.name === c.field)), c.input) ? 'accept' : 'reject', c.expect, c.field + ' ' + c.note));
  assert.ok(cases.some(c => c.field === 'Amount' && c.kind === 'boundary' && c.input === '12.50' && c.expect === 'accept'));
  assert.ok(cases.some(c => c.field === 'Amount' && c.kind === 'boundary' && c.input === '1200.01' && c.expect === 'reject'));
  // no spec bounds: observed min/max still become boundary cases (profile origin)
  const loose = GT({ id: 'DY', fields: [{ name: 'Qty', type: 'number' }] }, prof);
  assert.ok(loose.some(c => c.kind === 'boundary' && c.origin === 'profile' && c.input === '3' && /Smallest value seen/.test(c.note)));
  assert.ok(loose.some(c => c.kind === 'boundary' && c.origin === 'profile' && c.input === '10' && /Largest value seen/.test(c.note)));
});

/* ================================ Round 8: ONE TRUTH, NO MAKE-WORK ================================ */
const SIMPLE_JARGON = /\b(slip|slipping|target|connected|sample only|waiting for confirmation)\b/i;

test('R8 exports', () => {
  ['projectTruth', 'buReady', 'approvalNoteFacts', 'changedInformation', 'generateProjectTests', 'awaitingConfirmation', 'burndownStatus', 'stepConflict', 'projectConflicts']
    .forEach(n => assert.equal(typeof E[n], 'function', n));
  assert.ok(fs.readFileSync(API_ENGINE).equals(fs.readFileSync(WEB_ENGINE)));
});

test('R8 §1 information on a Today step is live unless explicitly missing; evidence only for changing information', () => {
  const d = baseDocs();
  // D1/D3 are examples-only but used Today → "We have it"; D6 live on Today needs no evidence
  delete d.dataElement.find(e => e.id === 'D6').data.check;
  deepFreeze(d);
  assert.equal(E.effectiveAvail(d, 'D1'), 'live');
  assert.equal(E.effectiveAvail(d, 'D3'), 'live');
  assert.equal(E.effectiveAvail(d, 'D6'), 'live');
  assert.equal(E.effectiveAvail(d, 'D2'), 'missing');            // on Today but explicitly marked missing
  assert.equal(E.effectiveAvail(d, 'D8'), 'example');            // new in Future
  assert.equal(E.effectiveAvail(d, 'D9'), 'missing');
  // new in Future, claimed live without evidence → still needs evidence (changing information)
  const n = baseDocs(); delete n.dataElement.find(e => e.id === 'D7').data.check;
  assert.equal(E.effectiveAvail(n, 'D7'), 'pending');
  // the owner finishing the fix task counts as their confirmation (owner defaults to the step owner: Leo Park on s3)
  const f = baseDocs(); f.workItem.find(e => e.id === 'W6').data.status = 'done';
  assert.equal(E.effectiveAvail(f, 'D2'), 'live');
  const ev = E.evidenceOf(f, f.dataElement.find(e => e.id === 'D2').data);
  assert.deepEqual([ev.type, ev.ok, ev.text], ['fix', true, 'Fix completed by Leo Park']);
  // someone else fixed it → one "Confirm" tap by the owner is still needed
  f.workItem.find(e => e.id === 'W6').data.owner = 'dk';
  assert.equal(E.effectiveAvail(f, 'D2'), 'pending');
  assert.deepEqual(E.awaitingConfirmation(f, 'lp'), ['D2']);
  assert.deepEqual(E.awaitingConfirmation(f, 'dk'), []);
  // an explicit data owner wins over the step owner
  f.dataElement.find(e => e.id === 'D2').data.owner = 'dk';
  assert.equal(E.effectiveAvail(f, 'D2'), 'live');
});

test('R8 §1 availLabel: Simple has two states; Advanced keeps the detailed labels', () => {
  const d = baseDocs(); d.workItem.find(e => e.id === 'W2').data.status = 'done'; d.workItem.find(e => e.id === 'W2').data.owner = 'dk';
  deepFreeze(d);
  const labels = ['D1', 'D2', 'D4', 'D5', 'D8', 'D9', 'nope'].map(id => E.availLabel(d, id).label);
  assert.deepEqual([...new Set(labels)].sort(), ['Not available yet', 'We have it']);
  assert.deepEqual(E.availLabel(d, 'D1'), { state: 'live', needsConfirm: false, key: 'have', label: 'We have it', tone: 'green' });
  assert.deepEqual(E.availLabel(d, 'D2'), { state: 'missing', needsConfirm: false, key: 'notyet', label: 'Not available yet', tone: 'red' });
  assert.deepEqual(E.availLabel(d, 'D5'), { state: 'pending', needsConfirm: true, key: 'notyet', label: 'Not available yet', tone: 'amber' });
  ['D1', 'D2', 'D5', 'D8'].forEach(id => assert.ok(!SIMPLE_JARGON.test(E.availLabel(d, id).label)));
  assert.equal(E.availLabel(d, 'D5', { advanced: true }).label, 'Waiting for confirmation');
  assert.equal(E.availLabel(d, 'D8', { advanced: true }).label, 'Sample only');
});

test('R8 §2 projectTruth holds every number, date and label', () => {
  const d = withHoldResolver(baseDocs());
  d.project[0].data.budget = { planned: 9000 };
  d.workItem.find(e => e.id === 'W1').data.time = [{ by: 'mc', date: '2026-10-15', hours: 16 }];
  deepFreeze(d);
  const t = E.projectTruth(d, PRJ, TODAY);
  assert.deepEqual([t.forecastFinish, t.target, t.bufferDays, t.bufferUnit], ['2026-12-01', '2026-12-15', 10, 'business days']);
  assert.deepEqual([t.lateCount, t.pastDue, t.pastDueCount, t.finishAfterDueCount], [6, ['W6'], 1, 5]);   // R9 §1 one late list
  assert.deepEqual(t.late.slice().sort(), ['W10', 'W4', 'W5', 'W6', 'W7', 'W8']);
  assert.deepEqual(t.tasks, { total: 12, done: 2, open: 10 });
  assert.deepEqual([t.rag, t.label], ['amber', 'Some tasks late']);
  assert.deepEqual(t.blockers.map(b => [b.name, b.planned]), [['Bank remittance details', true], ['Sanctions screening result', true], ['Payment hold list', true]]);
  assert.equal(t.unplannedBlockers, 0);
  assert.equal(t.cost.actual, 1600);                                // 16 h × 800 / 8
  assert.equal(t.cost.actual, t.ev.AC);
  assert.equal(t.cost.forecast, t.ev.EAC);                          // EAC is the one cost forecast
  assert.equal(t.cost.planned, 9000);
  assert.equal(t.testing.count, t.testing.passed + ' of ' + t.testing.total + ' tests passed');
  assert.equal(t.launchSteps.length, 7);
  assert.ok(['on-track', 'behind', null].includes(t.burndown.direction));
  assert.equal(E.projectTruth(d, 'nope', TODAY), null);
});

test('R8 §2 consistency: every derived function reads the same truth', () => {
  const variants = [baseDocs(), withHoldResolver(baseDocs()), readyDocs()];
  const late = withHoldResolver(baseDocs()); late.project[0].data.target = '2026-11-20'; variants.push(late);
  const done = baseDocs(); done.workItem.forEach(e => { e.data.status = 'done'; e.data.doneAt = e.data.due; }); variants.push(done);
  const timed = withHoldResolver(baseDocs()); timed.project[0].data.budget = { planned: 5000 };
  timed.workItem.find(e => e.id === 'W1').data.time = [{ by: 'mc', date: '2026-10-15', hours: 24 }]; variants.push(timed);
  variants.forEach(d => {
    deepFreeze(d);
    const t = E.projectTruth(d, PRJ, TODAY);
    const s = E.projectSummary(d, PRJ, TODAY), h = E.projectHealth(d, PRJ, TODAY), st = E.projectStats(d, PRJ, TODAY);
    assert.deepEqual([s.sentence, s.rag, s.label, s.who], [t.sentence, t.rag, t.label, t.who]);
    assert.deepEqual([h.rag, h.label, h.reasons, h.bufferDays], [t.rag, t.label, t.reasons, t.bufferDays]);
    assert.deepEqual([st.rag, st.ragReason, st.finish, st.late, st.slip], [t.rag, t.reasons.join('; '), t.forecastFinish, t.lateCount, t.runningLateCount]);
    assert.deepEqual(E.testingSummary(d, PRJ, TODAY), t.testing);
    assert.deepEqual(E.launchSteps(d, PRJ, TODAY), t.launchSteps);
    assert.deepEqual(E.earnedValue(d, PRJ, TODAY), t.ev);
    const f = E.projectFinancials(d, PRJ, TODAY);
    assert.deepEqual([f.actualCost, f.forecastCost, f.planned, f.variance, f.overBudget], [t.cost.actual, t.cost.forecast, t.cost.planned, t.cost.variance, t.cost.overBudget]);
    assert.deepEqual(E.burndownStatus(d, PRJ, TODAY), t.burndown);
    assert.equal(t.launchSteps.find(x => x.key === 'tests').done, t.testing.done);
    // never "All work is done" / "Nothing needs attention" while blockers exist
    if (t.blockers.length) assert.ok(!/All work is done|Nothing needs attention/.test(t.sentence), t.sentence);
    if (t.blockers.length) assert.ok(!t.reasons.some(r => /^All work done/.test(r)));
    assert.ok(!SIMPLE_JARGON.test(t.sentence + ' ' + t.reasons.join(' ') + ' ' + t.who.map(x => x.action).join(' ') + ' ' + t.testing.sentence), t.sentence);
    assertNoIds(t.sentence, d);
  });
});

test('R8 §2 status rules: At risk only for a missed deadline or an unplanned blocker; due today is not late', () => {
  // all tasks done but an unplanned blocker remains
  const d = baseDocs(); d.workItem.forEach(e => { e.data.status = 'done'; e.data.doneAt = e.data.due; });
  const t = E.projectTruth(deepFreeze(d), PRJ, TODAY);
  assert.equal(t.label, 'Will miss the deadline'); assert.equal(t.labelAdvanced, 'At risk');
  assert.ok(!/All work is done/.test(t.sentence)); assert.match(t.sentence, /^Every planned task is finished/);
  // late tasks while the finish meets the deadline: not "At risk"
  const a = E.projectTruth(deepFreeze(withHoldResolver(baseDocs())), PRJ, TODAY);
  assert.equal(a.label, 'Some tasks late');
  // R9 §1 (lead ruling): a planned blocker alone is On track — its fix is scheduled — but it is named (never "Nothing needs attention")
  const g = withHoldResolver(baseDocs());
  g.workItem.forEach(e => { if (e.data.status !== 'done') { const fix = !!e.data.resolves; e.data.deps = []; e.data.start = fix ? '2026-11-05' : '2026-11-20'; e.data.due = fix ? '2026-11-10' : '2026-11-25'; e.data.status = 'idle'; } });
  const gt = E.projectTruth(deepFreeze(g), PRJ, TODAY);
  assert.deepEqual([gt.label, gt.lateCount], ['On track', 0]);
  assert.match(gt.sentence, /work is planned to get it/);
  assert.ok(gt.blockers.length > 0 && gt.blockers.every(b => b.planned));
  assert.doesNotMatch(gt.sentence, /Nothing needs attention/);
  assert.match(gt.sentence, /not available yet; work is planned to get it/);
  // due today is not late; due yesterday is
  const W = (id, due) => ({ id, data: { id, projectId: 'P', title: id, owner: 'mc', status: 'prog', start: '2026-11-02', due, deps: [] } });
  const x = { project: [{ id: 'P', data: { id: 'P', processes: [], target: '2026-11-30' } }], workItem: [W('A', TODAY), W('B', '2026-11-03')] };
  const xt = E.projectTruth(x, 'P', TODAY);
  assert.deepEqual(xt.late, ['B']); assert.equal(E.forecastAll(x, TODAY).A.sched, 'soon');
  // buffer is business days: Fri Nov 20 → Mon Nov 23 is 1 business day (3 calendar days)
  const y = { project: [{ id: 'P', data: { id: 'P', processes: [], target: '2026-11-23' } }], workItem: [W('A', '2026-11-20')] };
  assert.equal(E.projectTruth(y, 'P', TODAY).bufferDays, 1);
  assert.match(E.projectTruth(y, 'P', TODAY).sentence, /1 business day before the Nov 23 deadline/);
});

test('R8 §2 SPI and burndown agree in direction, or the burndown shows only on Sprints', () => {
  const t = E.projectTruth(deepFreeze(withHoldResolver(baseDocs())), PRJ, TODAY);
  const b = t.burndown;
  assert.equal(b.spiDirection, t.ev.SPI == null ? null : t.ev.SPI >= 1 ? 'on-track' : 'behind');
  assert.equal(b.agree, b.direction == null || b.spiDirection == null || b.direction === b.spiDirection);
  assert.equal(b.sprintsOnly, !b.agree);
  const pts = E.burndown(withHoldResolver(baseDocs()), PRJ, TODAY).filter(p => p.remaining != null);
  const last = pts[pts.length - 1];
  assert.equal(b.direction, last.remaining <= last.ideal ? 'on-track' : 'behind');
});

test('R8 §3 suggestWorkFromDiff: no make-work, owners spread, 3 business days, never late on day one', () => {
  const d = baseDocs();
  // a wait node and a message node in the Future: no tasks for them
  d.process[0].data.tobe.splice(5, 0, { id: 'w1', type: 'wait', title: 'Wait for vendor signature', wait: 'signature' }, { id: 'm1', type: 'message', title: 'Tell the vendor', direction: 'send', party: 'Vendor' });
  deepFreeze(d);
  const sug = E.suggestWorkFromDiff(d, PRJ, TODAY);
  const diff0 = E.diffProcess(d.process[0].data), diff1 = E.diffProcess(d.process[1].data);
  const state = s => (s.pid === 'vendor-onboarding' ? diff0 : diff1).nodes[s.step];
  sug.forEach(s => {
    if (s.resolves) assert.ok(['missing', 'example'].includes(E.effectiveAvail(d, s.resolves)), s.title);   // only Not-available-yet information
    else assert.ok(['new', 'changed'].includes(state(s)), s.title);                                       // only changed/new steps
    assert.ok(!['w1', 'm1'].includes(s.step) || s.resolves);
    assert.equal(s.effortDays, 3);
    assert.ok(s.owner, s.title);
    assert.ok(s.start >= TODAY && s.due >= TODAY);
  });
  assert.ok(!sug.some(s => s.step === 'w1' || s.step === 'm1'));
  assert.ok(!sug.some(s => s.resolves === 'D1' || s.resolves === 'D3'));                                 // "We have it"
  assert.ok(new Set(sug.map(s => s.owner)).size >= 3);                                                   // spread across step owners
  // accepting the plan: nothing is late on day one
  const acc = JSON.parse(JSON.stringify(d));
  sug.forEach(s => acc.workItem.push({ id: s.key, data: { id: s.key, projectId: PRJ, pid: s.pid, step: s.step, title: s.title, owner: s.owner, status: 'idle', start: s.start, due: s.due, effortDays: s.effortDays, deps: s.deps, resolves: s.resolves } }));
  const fc = E.forecastAll(acc, TODAY);
  sug.forEach(s => assert.notEqual(fc[s.key].sched, 'late', s.title));
});

test('R8 §4 generateTests sanity: types match, ≤ 6 per field, bad sample values are rejected', () => {
  const de = { id: 'DQ', name: 'Receipt', fields: [
    { name: 'Receipt photo', type: 'file', required: true },
    { name: 'Approved', type: 'boolean', required: true },
    { name: 'Notes', type: 'text', min: 2, max: 60 },
    { name: 'Total', type: 'currency', min: 0, max: 5000, rule: 'Must match the invoice total' },
    { name: 'Routing number', type: 'digits', length: 9, required: true },
  ] };
  const cases = E.generateTests(de);
  const by = n => cases.filter(c => c.field === n);
  de.fields.forEach(f => { assert.ok(by(f.name).length >= 2, f.name); assert.ok(by(f.name).length <= 6, f.name + ' ' + by(f.name).length); });
  // every expected-accept value satisfies the field's own spec (no "Net 30" for a photo, no "Aab" for Yes/No)
  cases.filter(c => c.expect === 'accept').forEach(c => assert.ok(E.validate(E.fieldSpec(de.fields.find(f => f.name === c.field)), c.input), c.field + ': ' + c.input));
  assert.ok(!by('Receipt photo').some(c => /Net 30|&|Résumé/.test(c.input)));
  assert.ok(by('Receipt photo').some(c => c.expect === 'accept' && /\.jpg$/.test(c.input)));
  assert.ok(!by('Approved').some(c => /^Ab/.test(c.input)));
  assert.ok(by('Approved').some(c => c.input === 'Yes' && c.expect === 'accept'));
  assert.ok(!by('Total').some(c => c.context));                    // cross-field text values never go into a currency field
  assert.ok(E.generateTests(de, undefined, { all: true }).length > cases.length);
  // a rare shape seen in the sample is a "should be rejected" test, never accepted
  const csv = 'Branch code\n' + Array.from({ length: 19 }, (_, i) => '0' + (100 + i)).join('\n') + '\n012\n';   // codes (leading zeros)
  const prof = E.profileCsv(csv, {});
  const f = E.specFromProfile(prof);
  assert.equal(f[0].length, 4);                                    // the dominant length is the rule, not 3–4
  const pc = E.generateTests({ id: 'DB', fields: f }, prof, { all: true }).filter(c => c.origin === 'profile' && /Observed shape: 3 digits/.test(c.note));
  assert.ok(pc.length && pc.every(c => c.expect === 'reject'));
  const loose = E.generateTests({ id: 'DB', fields: [{ name: 'Branch code', type: 'text' }] }, prof, { all: true }).filter(c => /Observed shape: 3 digits/.test(c.note));
  assert.ok(loose.length && loose.every(c => c.expect === 'reject'));
});

test('R8 §4 tests only for changed information; "Create the tests" covers all of it; stages; one number', () => {
  const d = baseDocs();
  deepFreeze(d);
  assert.deepEqual(E.changedInformation(d, PRJ).map(x => x.dataId + ':' + x.reason).sort(),
    ['D2:fixed', 'D5:new', 'D7:new', 'D8:new', 'D9:new'].sort());          // D1, D3, D4, D6 are unchanged "We have it"
  const gen = E.generateProjectTests(d, PRJ);
  assert.deepEqual(gen.map(x => x.dataId).sort(), ['D2', 'D5', 'D7', 'D8', 'D9']);
  gen.forEach(x => assert.ok(x.cases.length >= 2, x.dataId));               // nothing skipped, even without field rules
  assert.deepEqual(gen.find(x => x.dataId === 'D9').cases.map(c => c.expect), ['accept', 'reject']);
  assert.ok(E.generateProjectTests(d, PRJ, { includeUnchanged: true }).length > gen.length);
  // a rule change makes Today information need tests
  const r = baseDocs(); r.dataElement.find(e => e.id === 'D6').data.rulesChanged = true;
  assert.ok(E.changedInformation(r, PRJ).some(x => x.dataId === 'D6' && x.reason === 'rules'));
  // stages: a SIT run counts for "Try it out"; UAT for "Business sign-off"; one number
  const t = readyDocs();
  t.testRun[0].data.env = 'sit';
  const ts = E.testingSummary(deepFreeze(t), PRJ, TODAY);
  assert.equal(ts.done, true);
  assert.deepEqual(ts.stages.map(s => [s.label, s.done]), [['Try it out', true], ['Business sign-off', true]]);
  assert.match(ts.sentence, /^Yes: \d+ of \d+ tests passed and no problems are open\.$/);
  // no system run at all → "Try it out" is the next action (no separate build gate)
  const u = readyDocs(); u.testRun.splice(0, 1);
  const us = E.testingSummary(u, PRJ, TODAY);
  assert.equal(us.done, false); assert.equal(us.stage, 'tryout'); assert.equal(us.nextAction.label, 'Try out the 10 tests');
  assert.ok(!/build/i.test(us.sentence));
  // an unchanged element's missing tests do not block
  const v = readyDocs(); v.testCase = v.testCase.filter(e => e.id !== 'CD6' && e.id !== 'CD1');
  assert.equal(E.testingSummary(v, PRJ, TODAY).done, true);
  // generated UAT scripts count without adopting them
  assert.equal(readyDocs().project[0].data.uatScripts, undefined);
  assert.ok(E.testingSummary(readyDocs(), PRJ, TODAY).total > E.testCoverage(readyDocs(), PRJ).system.total);
});

test('R8 §4 masking hides every digit of identifier-like values', () => {
  ['021000021', '12-3456789', 'NW100245', '4111 1111 1111 1111'].forEach(v => assert.ok(!/\d/.test(E.maskValue(v).replace(/9/g, '')) && ![...v].some((c, i) => /\d/.test(c) && c !== '9' && E.maskValue(v)[i] === c), v));
  assert.equal(E.maskValue('021000021'), '999999999');
  assert.equal(E.maskValue('12-3456789'), '99-9999999');
  const prof = E.profileCsv('Tax ID\n123456789\n987654321\n', {});
  prof[0].examples.forEach(x => assert.match(x, /^9+$/));
});

test('R8 §5 sections only for changed teams; buReady; precise staleness; prefilled facts', () => {
  const d = readyDocs();
  // invoice-approval: i3 (Schedule payment, Leo Park) is unchanged
  const bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  assert.deepEqual(bu.sections, ['Accounts Payable', 'Compliance', 'IT', 'Procurement', 'Treasury']);
  // a team whose steps did not change gets no section
  const u = readyDocs();
  const s3 = u.process[0].data.tobe.find(n => n.id === 's3'); const a3 = u.process[0].data.asis.find(n => n.id === 'a3');
  s3.title = a3.title; s3.owner = 'ar';                                // Treasury's only changed step moves to AP
  assert.ok(!check(E.readiness(u, PRJ, TODAY), 'bu-signoff').sections.includes('Treasury'));
  // buReady: complete → ready; an open task or a failed test → waiting
  assert.equal(E.buReady(d, PRJ, 'Treasury').ready, true);
  assert.equal(E.buReady(d, PRJ, 'Treasury').sentence, 'Ready for your approval.');
  const w = readyDocs(); w.workItem.find(e => e.id === 'W6').data.status = 'prog';
  const wr = E.buReady(w, PRJ, 'Treasury');
  assert.equal(wr.ready, false); assert.equal(wr.waiting[0].kind, 'work');
  assert.match(wr.sentence, /^Not ready for your approval yet: waiting on 1 task on its step/);
  assert.equal(E.buReady(w, PRJ, 'Compliance').ready, true);           // other teams are unaffected
  // a failed test result after approval stales only the sections that test covers (T1: D2 → Treasury, Accounts Payable)
  const s = readyDocs();
  s.testRun.push({ id: 'R9', data: { id: 'R9', projectId: PRJ, env: 'uat', at: '2026-11-03T09:00:00Z', by: 'ar', results: [{ caseId: 'T1', outcome: 'fail' }] } });
  const st = check(E.readiness(s, PRJ, TODAY), 'bu-signoff').stale.map(x => x.bu).sort();
  assert.deepEqual(st, ['Accounts Payable', 'Treasury']);
  assert.equal(E.buReady(s, PRJ, 'Treasury').ready, false);
  // a defect raised from that test belongs to the covered sections, not its owner's team (Dev Kumar, IT)
  const df = readyDocs();
  df.workItem.push({ id: 'DF1', data: { id: 'DF1', projectId: PRJ, kind: 'defect', title: 'Routing rejected', owner: 'dk', status: 'done', updatedAt: '2026-11-03T00:00:00Z', testRef: { caseId: 'T1' } } });
  assert.deepEqual(check(E.readiness(df, PRJ, TODAY), 'bu-signoff').stale.map(x => x.bu).sort(), ['Accounts Payable', 'Treasury']);
  // prefilled "What you checked" from facts
  const n = E.approvalNoteFacts(d, PRJ, 'Treasury');
  assert.match(n.text, /^\d+ changed steps? reviewed; \d+ of \d+ tasks? done; (\d+) of \1 tests? passed; (\d+) of \2 pieces? of information available$/);
  assert.equal(n.facts.tests.passed, n.facts.tests.total);
  assert.equal(E.approvalNoteFacts(s, PRJ, 'Treasury').facts.tests.passed, n.facts.tests.passed - 1);
});

test('R8 §8 wording and cross-project conflicts', () => {
  const d = withHoldResolver(baseDocs());
  const strings = [];
  ['W1', 'W6', 'W7', 'W8', 'W3'].forEach(id => strings.push(E.scheduleBadge(d, id, TODAY).label));
  const t = E.projectTruth(d, PRJ, TODAY);
  strings.push(t.sentence, t.label, ...t.reasons, ...t.who.map(x => x.action), t.testing.sentence, ...t.launchSteps.map(s => s.label + ' ' + s.action));
  strings.forEach(x => assert.ok(!SIMPLE_JARGON.test(x), x));
  assert.ok(!t.who.some(x => /Speed up/.test(x.action)));
  // conflicts: two projects changing one step
  const c = baseDocs();
  c.project.push({ id: 'P2', data: { id: 'P2', name: 'Payments refresh', owner: 'ta', processes: ['vendor-onboarding'], status: 'active' } });
  c.workItem.push({ id: 'X1', data: { id: 'X1', projectId: 'P2', pid: 'vendor-onboarding', step: 's3', title: 'Bank form v2', owner: 'lp', status: 'idle', start: '2026-11-10', due: '2026-11-12', deps: [] } });
  deepFreeze(c);
  assert.deepEqual(E.stepConflict(c, PRJ, 'vendor-onboarding', 's3'), { conflict: true, projects: [{ id: 'P2', name: 'Payments refresh' }], text: 'Another project is also changing this step' });
  assert.equal(E.stepConflict(c, PRJ, 'vendor-onboarding', 's1').conflict, false);
  assert.deepEqual(E.projectConflicts(c, PRJ).map(x => x.step), ['s3']);
  assert.deepEqual(E.projectConflicts(c, 'P2').map(x => x.step), ['s3']);
});

test('R8 §4 profileLines: one plain line per column, counts only', () => {
  const prof = E.profileCsv('Tax ID (EIN),Bank name,Extra\n123456789,A,x\n12345678,,y\n987654321,B,z\n', {});
  const lines = E.profileLines({ fields: [{ name: 'Tax ID (EIN)', type: 'digits', length: 9, required: true }, { name: 'Bank name', type: 'text', required: true }] }, { rows: 3, columns: prof });
  assert.deepEqual(lines.map(l => l.text), ['Tax ID (EIN): 3 values, 1 is too short', 'Bank name: 2 values, 1 is empty', 'Extra: 3 values']);
  lines.forEach(l => assert.ok(!/123456789|12345678|987654321/.test(l.text)));
});

/* ================================ Round 9: ONE TRUTH, ENFORCED ================================ */
test('R9 exports and byte-identical engine', () => {
  ['personQueue', 'planFit', 'planToWork', 'waitingOn', 'displayValue', 'namesFor', 'dataOwner', 'defaultDataOwner', 'isBusinessDay', 'toBusinessDay', 'fmtDayLong']
    .forEach(n => assert.equal(typeof E[n], 'function', n));
  assert.ok(fs.readFileSync(API_ENGINE).equals(fs.readFileSync(WEB_ENGINE)));
});

test('R9 §1 one late list, three labels, the status sentence, a ranked who, stepsLeft', () => {
  const d = deepFreeze(withHoldResolver(baseDocs()));
  const t = E.projectTruth(d, PRJ, TODAY);
  const fc = E.forecastAll(d, TODAY);
  const open = d.workItem.map(e => e.data).filter(w => w.projectId === PRJ && w.status !== 'done');
  // late = past due OR forecast after due, one list
  assert.deepEqual(t.late.slice().sort(), open.filter(w => w.due < TODAY || fc[w.id].forecast > w.due).map(w => w.id).sort());
  assert.equal(t.lateCount, t.pastDueCount + t.finishAfterDueCount);
  assert.ok(t.lateCount > 0 && t.label !== 'On track');
  assert.match(t.sentence, /^Expected Dec 1, 10 business days before the Dec 15 deadline\. 6 tasks are late; first: “Stand up structured bank capture” \(Leo Park\)\.$/);
  // who ranks: blockers < past due < delaying < late < info < problem < approval < test
  const ranks = t.who.map(x => x.rank);
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b));
  t.who.forEach(x => { assert.ok(x.person && x.name && x.what && x.why && x.href, JSON.stringify(x)); assert.equal(x.action, x.what); assertNoIds(x.what, d); });
  assert.equal(new Set(t.who.map(x => x.ref)).size, t.who.length);   // never the same item twice
  // unplanned blockers rank first and drive red
  const r = E.projectTruth(deepFreeze(baseDocs()), PRJ, TODAY);
  assert.equal(r.who[0].why, 'blocker'); assert.equal(r.label, 'Will miss the deadline');
  assert.deepEqual(r.who.filter(x => x.why === 'blocker').map(x => x.what), ['Plan work to get Vendor risk tier', 'Plan work to get Payment hold list']);
  // "On track" never appears with anything late
  [baseDocs(), withHoldResolver(baseDocs()), readyDocs()].forEach(x => { const tt = E.projectTruth(x, PRJ, TODAY); if (tt.lateCount) assert.notEqual(tt.label, 'On track'); });
  // stepsLeft = the checklist's undone count
  assert.equal(t.stepsLeft, t.launchSteps.filter(s => !s.done).length);
  // an all-green project
  const g = withHoldResolver(baseDocs());
  g.workItem.forEach(e => { if (e.data.status !== 'done') { e.data.status = 'idle'; e.data.deps = []; delete e.data.resolves; e.data.start = '2026-11-20'; e.data.due = '2026-11-25'; } });
  g.dataElement.forEach(e => { e.data.avail = 'live'; e.data.check = { ok: true }; });
  const gt = E.projectTruth(deepFreeze(g), PRJ, TODAY);
  assert.deepEqual([gt.label, gt.lateCount], ['On track', 0]);
});

test('R9 §3 business-day calendar: weekend dues and forecasts roll to Monday; lateness in business days', () => {
  const W = (id, extra) => ({ id, data: Object.assign({ id, projectId: 'P', title: id, owner: 'mc', status: 'idle', deps: [] }, extra) });
  const x = { project: [{ id: 'P', data: { id: 'P', processes: [], target: '2026-11-30' } }],
    workItem: [W('A', { start: '2026-11-02', due: '2026-11-07' }), W('B', { start: '2026-11-09', due: '2026-11-10', effortDays: 1, deps: ['A'] }), W('C', { status: 'prog', start: '2026-10-26', due: '2026-10-30' })] };
  const fc = E.forecastAll(x, TODAY);
  assert.equal(fc.A.forecast, '2026-11-09');                          // Sat Nov 7 counts as Mon Nov 9
  assert.equal(fc.A.sched, 'soon'); assert.equal(fc.A.late, false);   // a weekend due is not "late" by rolling
  Object.keys(fc).forEach(id => assert.ok(E.isBusinessDay(fc[id].forecast), id + ' ' + fc[id].forecast));
  assert.equal(fc.C.sched, 'late'); assert.equal(fc.C.pastDueDays, 3);  // Fri Oct 30 → Wed Nov 4: 3 business days
  // a Saturday "today" still forecasts on Monday
  assert.equal(E.forecastAll(x, '2026-11-07').C.forecast, '2026-11-09');
  assert.equal(E.toBusinessDay('2026-11-08'), '2026-11-09');
  assert.equal(E.fmtDayLong('2026-11-16'), 'Mon Nov 16');
  // the truth's finish never lands on a weekend
  const t = E.projectTruth(x, 'P', TODAY);
  assert.ok(E.isBusinessDay(t.forecastFinish));
});

test('R9 §5 EV: untouched and merely "in progress" tasks earn 0; SPI only once work has started', () => {
  const d = baseDocs();
  d.workItem.forEach(e => { e.data.status = e.data.status === 'done' ? 'idle' : e.data.status; delete e.data.time; });
  let ev = E.earnedValue(deepFreeze(d), PRJ, TODAY);
  assert.equal(ev.EV, 0);
  assert.equal(ev.SPI, null);                                          // "in progress" alone is not a start
  const p = baseDocs(); p.workItem.find(e => e.id === 'W2').data.progress = 0.5;
  p.workItem.forEach(e => { if (e.data.status === 'done') e.data.status = 'idle'; });
  ev = E.earnedValue(p, PRJ, TODAY);
  assert.ok(ev.EV > 0 && ev.SPI != null);
  assert.equal(ev.EV, Math.round(E.workCost(p, 'W2') * 0.5 * 100) / 100);
  // Advanced note when SPI < 0.95 under a green label
  const g = baseDocs();
  g.workItem.forEach(e => { if (e.data.status !== 'done') { e.data.status = 'idle'; e.data.deps = []; delete e.data.resolves; } });
  g.dataElement.forEach(e => { e.data.avail = 'live'; e.data.check = { ok: true }; });
  g.workItem.forEach(e => { if (e.data.status !== 'done') { e.data.start = '2026-10-20'; e.data.due = '2026-11-25'; } });
  const t = E.projectTruth(g, PRJ, TODAY);
  if (t.label === 'On track' && t.ev.SPI != null && t.ev.SPI < 0.95) assert.equal(t.advancedNote, 'Behind plan on effort (SPI ' + t.ev.SPI.toFixed(2) + ')');
  else assert.equal(t.advancedNote, null);
});

test('R9 §6 testing: one count, one next sentence, per-team isolation, open problems block "We have it"', () => {
  const d = deepFreeze(baseDocs());
  const t = E.projectTruth(d, PRJ, TODAY).testing;
  assert.equal(t.total, t.passed + t.failed + t.notRun);
  assert.equal(t.stage, 'create');
  assert.equal(t.next, 'Add tests for 5 new pieces of information');
  assert.equal(E.projectTruth(d, PRJ, TODAY).launchSteps.find(s => s.key === 'tests').action, t.next);
  assert.ok(!/Create the tests/.test(JSON.stringify(E.projectTruth(d, PRJ, TODAY))));
  // per-team counts: completing any task never changes another team's test counts
  const r = readyDocs(); r.workItem.forEach(e => { e.data.status = 'idle'; });
  const base = E.projectTruth(deepFreeze(JSON.parse(JSON.stringify(r))), PRJ, TODAY).testing.perBU;
  assert.ok(Object.keys(base).length >= 3);
  r.workItem.forEach(e => {
    const x = JSON.parse(JSON.stringify(r)); x.workItem.find(y => y.id === e.id).data.status = 'done';
    assert.deepEqual(E.projectTruth(x, PRJ, TODAY).testing.perBU, base, 'completing ' + e.id);
  });
  Object.values(base).forEach(b => assert.equal(b.total, b.passed + b.failed + b.notRun));
  // a failed test → "Fix 1 problem, then re-run its test"
  const f = readyDocs(); f.testRun[1].data.results[0].outcome = 'fail';
  assert.equal(E.projectTruth(f, PRJ, TODAY).testing.next, 'Fix 1 problem, then re-run its test');
  assert.equal(E.projectTruth(readyDocs(), PRJ, TODAY).testing.next, 'Ready for business sign-off');
  // B14: an open problem on information keeps it "Has a problem" even when its fix task is done
  const p = baseDocs(); p.workItem.find(e => e.id === 'W6').data.status = 'done';
  assert.equal(E.availLabel(p, 'D2').label, 'We have it');
  p.workItem.push({ id: 'BUG1', data: { id: 'BUG1', projectId: PRJ, pid: 'vendor-onboarding', step: 's3', title: 'Fix: blank account holder accepted', owner: 'lp', status: 'prog', kind: 'defect', start: '2026-11-03', due: '2026-11-06', deps: [] } });
  assert.deepEqual(E.availLabel(p, 'D2'), { state: 'problem', needsConfirm: false, key: 'problem', label: 'Has a problem', tone: 'amber' });
  assert.equal(E.dataReady(p, 'D2'), false);
  assert.ok(check(E.readiness(p, PRJ, TODAY), 'data-live').problems.includes('D2'));
  // B13: the who list shows a defect as "Fix the problem: …"
  assert.ok(E.projectTruth(p, PRJ, TODAY).who.some(x => x.what === 'Fix the problem: “Blank account holder accepted”'));
});

test('R9 §13 approvals: one list, never a deadlock, separation of duties shows who to choose', () => {
  // only one team's step changes (Treasury's s3); everything else is unchanged
  const d = readyDocs();
  const p0 = d.process[0].data, p1 = d.process[1].data;
  p0.tobe = p0.asis.map(n => Object.assign({}, n, { from: n.type === 'trigger' || n.type === 'end' ? undefined : n.id }));
  p0.tobe.find(n => n.id === 'a3').title = 'Capture bank details in a form';
  p1.tobe = p1.asis.map(n => Object.assign({}, n, { from: n.type === 'trigger' || n.type === 'end' ? undefined : n.id }));
  d.project[0].data.cutover.tasks = [{ id: 'CT1', order: 1, task: 'Switch over', owner: 'ta', planned: '06:00', gonogo: true, done: false }];
  d.approval = [{ id: 'A1', data: { id: 'A1', projectId: PRJ, bu: 'Treasury', approver: 'lp', decision: 'approved', at: '2026-11-03T10:00:00Z', stepUp: true } }];
  const r = E.readiness(d, PRJ, TODAY);
  assert.deepEqual(check(r, 'bu-signoff').sections, ['Treasury']);
  assert.equal(check(r, 'bu-signoff').pass, true);
  assert.equal(check(r, 'two-person').pass, true);                     // one changed team: one approval is enough
  const t = E.projectTruth(d, PRJ, TODAY);
  assert.deepEqual(t.approvals.map(a => [a.bu, a.needed, a.approved, a.approver]), [['Treasury', true, true, 'lp']]);
  assert.equal(t.launchSteps.find(s => s.key === 'approvals').done, true);
  assert.equal(E.buReady(d, PRJ, 'Procurement').needed, false);       // not a gate condition anywhere
  assert.ok(!t.launchSteps.some(s => /Procurement/.test(s.action)));
  // separation of duties: Leo recorded every test run of Treasury's part, so someone else must approve
  const s = JSON.parse(JSON.stringify(d));
  s.testRun.forEach(e => { e.data.by = 'lp'; });
  s.approval = [];
  const st = E.projectTruth(s, PRJ, TODAY);
  const a = st.approvals.find(x => x.bu === 'Treasury');
  assert.equal(a.approved, false);
  assert.deepEqual([a.blockedBy.rule, a.blockedBy.person], ['separation-of-duties', 'lp']);
  assert.equal(a.blockedBy.text, 'Leo Park recorded these tests, so someone else in Treasury must approve.');
  assert.equal(a.blockedBy.fix, "Choose who approves Treasury's part");
  assert.match(st.launchSteps.find(x => x.key === 'approvals').action, /Leo Park recorded these tests, so someone else in Treasury must approve\. Choose who approves Treasury's part/);
  // his own approval does not count
  s.approval = [{ id: 'A2', data: { id: 'A2', projectId: PRJ, bu: 'Treasury', approver: 'lp', decision: 'approved', at: '2026-11-03T10:00:00Z', stepUp: true } }];
  assert.equal(check(E.readiness(s, PRJ, TODAY), 'bu-signoff').pass, false);
  // waitingOn = tests not passed + open tasks + information not available
  const b = E.projectTruth(deepFreeze(baseDocs()), PRJ, TODAY);
  b.approvals.forEach(x => { const br = E.buReady(baseDocs(), PRJ, x.bu); assert.equal(x.waitingOn, br.waiting.reduce((n, w) => n + w.count, 0)); assert.equal(x.ready, br.ready); });
});

test('R9 §2 personQueue: every open item for the person, ranked, and its length is the badge', () => {
  const d = withHoldResolver(baseDocs());
  d.workItem.push({ id: 'PR1', data: { id: 'PR1', projectId: PRJ, pid: 'vendor-onboarding', step: 's2', title: 'Practice review with Compliance', owner: 'ps', status: 'idle', kind: 'test', start: '2026-12-01', due: '2026-12-04', deps: [] } });
  d.workItem.find(e => e.id === 'W6').data.owner = 'dk';                // someone else fixes Leo's information → Leo confirms
  d.workItem.find(e => e.id === 'W6').data.status = 'done';
  deepFreeze(d);
  const fc = E.forecastAll(d, TODAY);
  const t = E.projectTruth(d, PRJ, TODAY);
  ['ps', 'dk', 'lp', 'ar', 'ta'].forEach(person => {
    const qx = E.personQueue(d, person, TODAY);
    // completeness: every open task of theirs that is late, due within 10 business days, a fix, a problem or a practice review
    d.workItem.map(e => e.data).filter(w => w.projectId === PRJ && w.owner === person && w.status !== 'done'
      && (fc[w.id].late || E.businessDaysBetween(TODAY, w.due) <= 10 || w.resolves || w.kind === 'test' || w.kind === 'defect'))
      .forEach(w => assert.ok(qx.some(x => x.id === w.id), person + ' ' + w.id));
    // every who entry naming them
    t.who.filter(x => x.person === person).forEach(x => assert.ok(qx.some(y => y.rank === x.rank), person + ' ' + x.what));
    // ranked
    assert.deepEqual(qx.map(x => x.rank), qx.map(x => x.rank).slice().sort((a, b) => a - b));
    qx.forEach(x => { assert.ok(x.kind && x.projectId !== undefined && x.title && x.href, JSON.stringify(x)); assertNoIds(x.title, d); });
  });
  assert.ok(E.personQueue(d, 'ps', TODAY).some(x => x.kind === 'practice' && x.title === 'Practice review with Compliance'));
  assert.ok(E.personQueue(d, 'lp', TODAY).some(x => x.kind === 'confirm' && x.oneTap && x.oneTap.action === 'confirm'));
  // a ready approval appears for its approver
  const r = readyDocs(); r.approval = r.approval.filter(a => a.data.bu !== 'Compliance');
  const pq = E.personQueue(r, 'ps', TODAY);
  assert.ok(pq.some(x => x.kind === 'approval' && x.id === 'Compliance'), JSON.stringify(pq));
  assert.deepEqual(E.personQueue(r, 'nobody', TODAY), []);
});

test('R9 §4 plans: owners carried from steps, levelled, feasible, and the dialog date equals the truth after Accept', () => {
  const d = baseDocs();
  // a role-only changed step and a step with nobody
  d.process[0].data.tobe.splice(6, 0, { id: 'sR', title: 'Clerk files the vendor packet', ownerRole: 'Clerk', data: [] }, { id: 'sN', title: 'Archive the packet', data: [] });
  deepFreeze(d);
  const sug = E.suggestWorkFromDiff(d, PRJ, TODAY);
  const role = sug.find(s => s.step === 'sR');
  assert.deepEqual([role.owner, role.ownerRole], [null, 'Clerk']);     // the role, never the PM
  assert.equal(sug.find(s => s.step === 'sN').owner, 'ta');           // the PM only when the step has neither
  assert.equal(sug.find(s => s.step === 's5').owner, 'mc');           // the step's owner
  // levelled: nobody works on two suggested tasks at once
  const byOwner = {};
  sug.forEach(s => { const k = s.owner || s.ownerRole; (byOwner[k] = byOwner[k] || []).push(s); });
  Object.values(byOwner).forEach(arr => arr.forEach((a, i) => arr.slice(i + 1).forEach(b => assert.ok(a.due < b.start || b.due < a.start, a.key + ' overlaps ' + b.key))));
  // accepted: no plan task late on day 0; the dialog date is the truth's forecast
  const fit = E.planFit(d, PRJ, TODAY, sug);
  const acc = JSON.parse(JSON.stringify(d));
  E.planToWork(PRJ, sug).forEach(w => acc.workItem.push({ id: w.id, data: w }));
  const t = E.projectTruth(acc, PRJ, TODAY);
  assert.equal(fit.forecastFinish, t.forecastFinish);
  assert.equal(fit.lateCount, 0);
  sug.forEach(s => assert.ok(!t.late.includes(s.key), s.title));
  sug.forEach(s => { assert.ok(E.isBusinessDay(s.start) && E.isBusinessDay(s.due)); assert.ok(s.due >= E.forecastAll(acc, TODAY)[s.key].forecast); });
  assert.equal(fit.message, 'Done by about ' + E.fmtDay(t.forecastFinish) + ', ' + t.bufferDays + ' business days before your Dec 15 deadline.');
  // a deadline the plan cannot meet is said before Accept
  const late = JSON.parse(JSON.stringify(d)); late.project[0].data.target = '2026-11-20';
  const lf = E.planFit(late, PRJ, TODAY);
  assert.equal(lf.fits, false);
  assert.match(lf.message, /^This plan needs until [A-Z][a-z]{2} \d+, past your Nov 20 deadline\.$/);
});

test('R9 §8/§13 owners, names and real dependencies', () => {
  const d = baseDocs();
  d.process[1].data.tobe.splice(1, 0, { id: 'iR', title: 'Clerk checks the invoice', ownerRole: 'Clerk', data: ['DN'] });
  d.dataElement.push({ id: 'DN', data: { id: 'DN', name: 'Invoice checklist', avail: 'missing', fields: [] } });
  deepFreeze(d);
  assert.deepEqual(E.dataOwner(d, 'D8'), { person: 'ps', role: null, name: 'Priya Shah' });      // the step's owner
  assert.deepEqual(E.dataOwner(d, 'DN'), { person: null, role: 'Clerk', name: 'Clerk' });        // the step's role, never "—"
  assert.deepEqual(E.defaultDataOwner({ owner: 'lp' }), { owner: 'lp' });
  assert.deepEqual(E.defaultDataOwner({ ownerRole: 'Clerk' }), { ownerRole: 'Clerk' });
  // history and diff values: names, never raw ids
  assert.equal(E.displayValue(d, 'dk'), 'Dev Kumar');
  assert.equal(E.displayValue(d, '(none)'), 'Nobody');
  assert.equal(E.displayValue(d, ''), 'Nobody');
  assert.equal(E.displayValue(d, 'D2'), 'Bank remittance details');
  const p = JSON.parse(JSON.stringify(d.process[0].data));
  p.tobe.find(n => n.id === 's5').owner = 'dk';
  const ch = E.diffProcess(p, d).changes.s5;
  assert.ok(ch.includes('Owner Maya Chen → Dev Kumar'), JSON.stringify(ch));
  Object.values(E.diffProcess(d.process[0].data, d).changes).flat().forEach(x => assertNoIds(x, d));
  // real dependencies only: W10 waits on W6 and W8 (edges), never on parallel W11
  assert.deepEqual(E.waitingOn(d, 'W10').map(x => x.id), ['W6', 'W8']);
  assert.deepEqual(E.waitingOn(d, 'W11'), []);
  assert.deepEqual(E.waitingOn(d, 'W7').map(x => [x.id, x.kind]), [['W6', 'dependency']]);
  assert.deepEqual(E.waitingOn(d, 'W4').map(x => [x.id, x.kind]), [['W2', 'information']]);   // s2 needs D5, which W2 makes available
});

test('R9 §13 data-driven tests: real sample values and their problems, linked to sample rows', () => {
  const de = { id: 'DE', name: 'Employee record', fields: [
    { name: 'Employee ID', type: 'text', pattern: 'E\\d{5}', required: true },
    { name: 'Employee name', type: 'text', required: true },
  ] };
  const csv = 'Employee ID,Employee name\nE12345,Dana O\'Neil\nE-77,Zoë Martín\nE23456,\nE34567,Leo Park\n';
  const prof = E.profileCsv(csv, { dataElement: de });
  assert.deepEqual(prof[0].check, { rejected: 1, firstRow: 2, blank: 0, wrongLength: 0, badChars: 0, pattern: 1 });
  assert.deepEqual(prof[1].check, { rejected: 1, firstRow: 3, blank: 1, wrongLength: 0, badChars: 0, pattern: 0 });
  assert.ok(!JSON.stringify(prof).includes('E-77') && !JSON.stringify(prof).includes('E12345'));   // counts and rows only
  assert.deepEqual(E.profileLines(de, { rows: 4, columns: prof }).map(l => l.text), ["Employee ID: 4 values, 1 doesn't match the pattern", 'Employee name: 3 values, 1 is empty']);
  const cases = E.generateTests(de, { rows: 4, columns: prof }, { all: true });
  const idShapes = cases.filter(c => c.field === 'Employee ID' && /^Observed shape/.test(c.note));
  assert.deepEqual(idShapes.map(c => [c.input, c.expect, c.sampleRow]), [['E23456', 'accept', 1], ['A-23', 'reject', 2]]);   // one accept per valid shape, one reject per problem
  const names = cases.filter(c => c.field === 'Employee name');
  assert.ok(names.some(c => c.expect === 'accept' && /'/.test(c.input)));     // the apostrophe seen is accepted
  assert.ok(names.some(c => c.expect === 'accept' && /[ëí]/.test(c.input)));  // the accent seen is accepted
  assert.ok(names.some(c => c.input === '' && c.expect === 'reject'));        // the blank seen is rejected
  assert.ok(!cases.some(c => /Northwind Supply|Supply Co/.test(c.input)), 'no vendor names for people');
});
