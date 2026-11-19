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
// R10 §3: the pre-R10 fixtures were written for a Monday–Friday calendar. They keep it by working every federal
// holiday ({date, off: true}); the R10 holiday tests below use the real calendar.
const WEEKDAYS_ONLY = () => [{ id: 'workspace', data: { id: 'workspace', holidays: [2025, 2026, 2027, 2028].flatMap(y => E.federalHolidays(y)).map(h => ({ date: h.date, off: true })) } }];

function baseDocs() {
  const person = [
    { id: 'mc', name: 'Maya Chen', role: 'Process Owner', color: '#7c3aed', bu: 'Procurement' },
    { id: 'ta', name: 'Tom Alvarez', role: 'Project Manager', color: '#0891b2', bu: 'PMO' },
    { id: 'ps', name: 'Priya Shah', role: 'Compliance SME', color: '#db2777', bu: 'Compliance' },
    { id: 'lp', name: 'Leo Park', role: 'Treasury SME', color: '#ea580c', bu: 'Treasury' },
    { id: 'ar', name: 'Ana Ruiz', role: 'AP Lead', color: '#16a34a', bu: 'Accounts Payable' },
    { id: 'dk', name: 'Dev Kumar', role: 'Integration Eng.', color: '#2563eb', bu: 'IT' },
    // R11 §2: department heads who approve parts they neither do steps in nor recorded tests for
    { id: 'hp', name: 'Hana Price', role: 'Head of Procurement', color: '#7c2d12', bu: 'Procurement' },
    { id: 'hc', name: 'Carl Diaz', role: 'Head of Compliance', color: '#4f46e5', bu: 'Compliance' },
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
    grant: [], approval: [], testCase: [], testRun: [], calendar: WEEKDAYS_ONLY(),
  };
}

// A project that passes every gate; individual tests break one thing at a time.
function readyDocs() {
  const d = baseDocs();
  d.workItem.forEach(e => { e.data.status = 'done'; });
  d.dataElement.forEach(e => { e.data.avail = 'live'; e.data.check = { ok: true, at: '2026-11-01T00:00:00Z', detail: 'Probe ok' }; });
  const bus = ['Procurement', 'Compliance', 'Treasury', 'Accounts Payable', 'IT'];
  d.approval = bus.map((bu, i) => ({ id: 'AP' + i, data: { id: 'AP' + i, projectId: PRJ, bu, approver: i % 2 ? 'hc' : 'hp', decision: 'approved', at: '2026-11-01T10:00:00Z', stepUp: true, note: '' } }));
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
  assert.match(g.detail, /closes automatically at launch/);   // R11 §3 one set of words: open grants close at launch
  assert.ok(!check(r, 'tests-passed').unrun.includes('TX'));   // unused data's cases need no UAT coverage
});

test('readiness: each check fails on its own condition', () => {
  let d = readyDocs(); d.grant.push({ id: 'G2', data: { id: 'G2', projectId: PRJ, status: 'requested', log: [] } });
  let r = E.readiness(deepFreeze(d), PRJ, TODAY);
  assert.equal(check(r, 'grants-closed').pass, false); assert.equal(r.pass, false);

  // R11 §3: an approved grant is "open" (closes at launch); only a request waiting for approval blocks
  d = readyDocs(); d.grant[0].data.status = 'approved';
  assert.equal(check(E.readiness(d, PRJ, TODAY), 'grants-closed').pass, true);

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
  // R15 #8: the Done tasks that depend on the reopened W6 now need someone else to confirm them, so they are listed too
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'work-done').items, ['W6', 'W7', 'W8', 'W10']);
  assert.deepEqual(check(E.readiness(d, PRJ, TODAY), 'work-done').unconfirmed, ['W7', 'W8', 'W10']);

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
  assert.deepEqual(bu.stale, [{ bu: 'Treasury', changed: ['workItem:W6'], details: [{ ref: 'workItem:W6', label: 'Stand up structured bank capture' }], reason: 're-approval needed: Stand up structured bank capture',
    text: 'Treasury must approve again: Stand up structured bank capture.' }]);
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
  assert.equal(E.maskValue('Ab-12c'), 'Xxxx-99xxxx');   // R13 #7: no first or last letter, no word length
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
  /* R16 N1 #10 adds start/plannedStart to each row (so done never shows before start); the R2 fields are unchanged */
  const w6r = bv.find(r => r.workId === 'W6');
  assert.deepEqual({ workId: w6r.workId, plannedDue: w6r.plannedDue, forecast: w6r.forecast, varianceDays: w6r.varianceDays }, { workId: 'W6', plannedDue: '2026-11-03', forecast: '2026-11-11', varianceDays: 8 });
  assert.ok(!w6r.start || w6r.start <= w6r.forecast);
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
  // R11 §1: one denominator with the coverage matrix: every other changed step now has no business check script
  c = check(E.readiness(d, PRJ, TODAY), 'tests-passed');
  assert.equal(c.pass, false); assert.ok(c.scriptGaps.length > 0 && !c.scriptGaps.some(g => g.step === 's3'));
  d.project[0].data.uatScripts = d.project[0].data.uatScripts.concat(E.generateUatScripts(Object.assign({}, d, { project: [{ id: PRJ, data: Object.assign({}, d.project[0].data, { uatScripts: undefined }) }] }), PRJ));
  d.project[0].data.uatScripts.slice(1).forEach(sc => d.testRun[1].data.results.push({ scriptId: sc.id, outcome: 'pass', evidence: 'Screenshot' }));
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
  assert.deepEqual(E.diffSummary(docs.process[0].data), { new: 2, added: 2, changed: 6, removed: 1, same: 0 });
  assert.deepEqual(E.diffSummary(docs.process[1].data), { new: 1, added: 1, changed: 2, removed: 0, same: 1 });
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
  assert.equal(c.pass, false); assert.deepEqual(c.items, ['hp']);   // R11 §2 fixtures: department heads approve
  assert.equal(c.detail, 'Only Hana Price has a current approval; a second approver is needed.');
  assert.equal(check(E.readiness(readyDocs(), PRJ, TODAY), 'two-person').detail, 'Approved by Carl Diaz and Hana Price.');
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
  assert.match(check(E.readiness(v, PRJ, TODAY), 'grants-closed').detail, /1 access request is waiting for approval: Bank remittance details \(DEV, write\)/);
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
  // R10 §6: + a Retire task for the removed Today step (a7), + "Tell affected teams" and "Train the people" at the end
  assert.deepEqual(sug.map(s => [s.key, s.step, s.resolves || s.retires || s.tag || null]), [
    ['sug-1', 's2', 'D8'], ['sug-2', 'd1', null], ['sug-3', 's5', null], ['sug-4', null, 'a7'], ['sug-5', 'i4', 'D9'], ['sug-6', 'i4', null],
    ['sug-7', null, 'tell'], ['sug-8', null, 'train']]);
  assert.equal(sug[0].title, 'Make Vendor risk tier available');      // R8: one plain wording
  assert.equal(sug[1].title, 'Configure routing: Risk tier?');        // new gateway
  assert.match(sug[3].title, /^Retire the old step: /);
  assert.equal(sug[4].title, 'Make Payment hold list available');
  assert.equal(sug[4].owner, 'ar');                                 // data owner for resolvers
  assert.equal(sug[5].owner, 'ps');                                 // step owner otherwise
  assert.deepEqual([sug[6].owner, sug[7].owner], ['ta', 'ta']);     // tell / train: the project manager
  // R6 (changed): flow-order FS deps on the nearest preceding step's work, plus resolvers; dates spread toward the target
  assert.deepEqual(sug[5].deps, ['W11', 'sug-5']);                  // i2's open work, then the D9 resolver
  assert.deepEqual(sug[2].deps, ['W8']);                            // s5 follows s4's open work
  assert.deepEqual(sug[1].deps, ['W2', 'W3', 'W4']);                // gateway follows s2's open work
  assert.deepEqual(sug[7].deps, ['sug-2', 'sug-3', 'sug-4', 'sug-6']);   // training follows every step task
  assert.ok(sug.every(s => s.effortDays === (s.tag === 'tell' ? 1 : 3)));   // R8: default 3 business days
  assert.deepEqual([4, 6].map(i => sug[i].start), Array(2).fill('2026-11-04'));   // can start now = today
  // R11 §4: s2 also needs Sanctions screening result (W2 gets it), so its task starts later instead of stretching
  assert.ok(sug[0].start > '2026-11-04' && E.businessDaysBetween(sug[0].start, sug[0].due) <= 10);
  assert.ok(sug.every(x => E.businessDaysBetween(x.start, x.due) <= 10), 'no task spans more than 10 business days');
  // business day after deps finish; R9 §4 levelled: Priya's gateway task waits for her own risk-tier task first
  assert.deepEqual([sug[1].start, sug[2].start, sug[5].start], ['2026-11-18', '2026-11-25', '2026-11-24']);
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
  assert.deepEqual([s2.start, s2.due], ['2026-11-12', '2026-11-17']);   // R6 (changed): day after W6's Nov 11 forecast; spread span (R8: 3-day effort; R10: the stretch keeps the deadline)
  // R11: the D9 resolver has no prerequisite, so it shows the anchor (the D8 task waits for W2's forecast)
  assert.equal(E.suggestWorkFromDiff(docs, PRJ).find(x => x.resolves === 'D9').start, '2026-11-20');   // anchor: latest project due
  // weekend anchor rolls to Monday
  assert.equal(E.suggestWorkFromDiff(docs, PRJ, '2026-11-07').find(x => x.resolves === 'D9').start, '2026-11-09');
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
  d = readyDocs(); d.approval.forEach(a => { if (a.data.approver === 'hc') a.data.approver = 'ta'; });
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
  ].concat(extra || []), project: [{ id: 'P', data: { id: 'P', processes: [], target: '2026-12-31' } }], calendar: WEEKDAYS_ONLY() };
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
  // R10 §3: the federal holidays after Jan 1 that fall on weekdays in 2026 are not business days (10 of them)
  E.syncCalendar({});
  assert.equal(n, 260);
  assert.equal(E.businessDaysBetween('2026-01-01', '2026-12-31'), 250);
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
  d = readyDocs(); d.project[0].data.releaseManager = 'hc';          // hc approved Compliance and Accounts Payable
  const r = E.readiness(d, PRJ, TODAY);
  bu = check(r, 'bu-signoff');
  // R11 §2: Priya does Compliance steps and Ana does Accounts Payable steps, so with the release manager excluded
  // both parts need an approver chosen (suggested: process owner Maya Chen, who does neither part's steps)
  assert.deepEqual(bu.needsApprover, ['Accounts Payable', 'Compliance']);
  assert.equal(bu.suggestions['Accounts Payable'], 'mc'); assert.equal(bu.suggestions.Compliance, 'mc');
  assert.deepEqual(bu.excludedApprovers, ['ta', 'hc']);
  assert.match(bu.detail, /Approvals by the project owner and release manager \(Tom Alvarez and Carl Diaz\) do not count\./);
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
  assert.equal(st.rag, 'amber'); assert.match(st.ragReason, /^6 tasks late \(1 past due, 5 will finish after their due date\), but the finish still meets the deadline; /);   // R9 §1
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
  // R10 §2: no CPI yet, so the forecast is the estimate (forecastBasis says so)
  // R14 Karen 2: only dk has a rate, so the other open tasks would be default-rate guesses: "Cost unknown: set rates"
  assert.deepEqual(f, { planned: 9000, estimate: null, forecastCost: null, forecastBasis: 'estimate', eacMethod: 'bottom-up', actualCost: 0, remainingCost: null, variance: null, overBudget: false, program: 'Supplier Excellence', unknown: true, unknownText: 'Cost unknown: set rates', unpriced: 5 });
  // with a rate for everyone (800 for all but dk), the R5 numbers hold
  const d2 = baseDocs(); d2.person.forEach(e => { e.data.dayRate = e.id === 'dk' ? 1000 : 800; }); d2.workItem.find(e => e.id === 'W8').data.effortDays = 5;
  d2.project[0].data.budget = { planned: 9000 }; d2.project[0].data.program = 'Supplier Excellence';
  assert.deepEqual(E.projectFinancials(d2, PRJ), { planned: 9000, estimate: 13800, forecastCost: 13800, forecastBasis: 'estimate', eacMethod: 'bottom-up', actualCost: 0, remainingCost: 13800, variance: 4800, overBudget: true, program: 'Supplier Excellence', unknown: false, unpriced: 0 });
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
  assert.deepEqual(h.reasons, ['6 tasks late (1 past due, 5 will finish after their due date), but the finish still meets the deadline',
    'Bank remittance details, Sanctions screening result and Payment hold list are not available yet; work is planned to get them']);
  d.project[0].data.target = '2026-11-30';
  assert.deepEqual(E.projectHealth(d, PRJ, TODAY), { rag: 'red', label: 'Will miss the deadline', bufferDays: -1, reasons: ['Forecast finish Dec 1 is after the Nov 30 deadline'] });
  // R8: a small buffer alone is not "at risk" (status changes only for a missed deadline, a blocker or late tasks)
  // R13 #4: the task has an owner (an unowned task is a reason of its own)
  const g = { workItem: [{ id: 'A', data: { id: 'A', projectId: 'P', status: 'idle', start: '2026-11-16', due: '2026-11-20', deps: [], owner: 'u' } }],
    person: [{ id: 'u', data: { id: 'u', name: 'Una Lee' } }], project: [{ id: 'P', data: { id: 'P', processes: [], target: '2026-11-26' } }], calendar: WEEKDAYS_ONLY() };
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
  const OLD = ['BAC', 'PV', 'EV', 'AC', 'SPI', 'CPI', 'EAC', 'estimate', 'pctDone', 'pct', 'started'];
  const pickEv = o => Object.fromEntries(OLD.map(k => [k, o[k]]));
  const ev = pickEv(E.earnedValue(d, 'P', TODAY));
  // PV: A 4000 + B 4000 × (2 of 4 bd from Nov 2 to Nov 4) = 6000; EV: 4000 + 1600 = 5600; AC: 4000 + 1600
  assert.deepEqual(ev, { BAC: 12000, PV: 6000, EV: 5600, AC: 5600, SPI: 0.93, CPI: 1, EAC: 12000, estimate: 12000, pctDone: 5600 / 12000, pct: 47, started: true });
  const b = JSON.parse(JSON.stringify(d)); b.project[0].data.budget = { planned: 6000 };
  assert.deepEqual(pickEv(E.earnedValue(b, 'P', TODAY)), { BAC: 6000, PV: 3000, EV: 2800, AC: 5600, SPI: 0.93, CPI: 0.5, EAC: 12000, estimate: 12000, pctDone: 2800 / 6000, pct: 47, started: true });
  const z = pickEv(E.earnedValue({ project: [{ id: 'P', data: { id: 'P' } }], workItem: [] }, 'P', TODAY));
  assert.deepEqual(z, { BAC: 0, PV: 0, EV: 0, AC: 0, SPI: null, CPI: null, EAC: null, estimate: 0, pctDone: 0, pct: 0, started: false });
  // R10 §2: before any hours are logged CPI is blank, so EAC is blank too; the cost forecast falls back to the estimate
  const n = JSON.parse(JSON.stringify(b)); n.workItem.forEach(e => { delete e.data.time; });
  const nv = E.earnedValue(n, 'P', TODAY);
  // R11 §6 one EAC method: without CPI, EAC = max(bottom-up, spent + remaining estimate), never below spent
  assert.deepEqual([nv.SPI, nv.CPI, nv.EAC, nv.eacMethod], [null, null, 12000, 'bottom-up']);
  assert.deepEqual([E.projectFinancials(n, 'P', TODAY).forecastCost, E.projectFinancials(n, 'P', TODAY).forecastBasis], [12000, 'estimate']);
  // A done with no hours logged is flagged
  assert.deepEqual(nv.doneNoHours, ['A']); assert.ok(nv.flags.some(f => f.key === 'done-no-hours'));
});

test('R6 levelResources: latest-starting non-critical items move later, spans kept, FS successors follow', () => {
  const W = (id, status, start, due, more) => ({ id, data: Object.assign({ id, projectId: 'P', owner: 'mc', title: id, status, start, due, deps: [] }, more) });
  const d = deepFreeze({ person: [{ id: 'mc', data: { id: 'mc', capacity: 4 } }], project: [{ id: 'P', data: { id: 'P', processes: [], target: '2026-12-31' } }], calendar: WEEKDAYS_ONLY(),
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
  const one = { workItem: [W('X', 'idle', '2026-11-09', '2026-11-10', { effortDays: 6 })], project: d.project, calendar: d.calendar };
  const r1 = E.levelResources(one, 'P', TODAY);
  assert.deepEqual([Object.keys(r1.shifts).length, r1.overloadsAfter.length], [0, 1]);
});

test('R6 compareScenario and defaultTarget', () => {
  const W = (id, start, due, more) => ({ id, data: Object.assign({ id, projectId: 'P', owner: 'mc', title: id, status: 'idle', start, due, deps: [] }, more) });
  const d = deepFreeze({ workItem: [W('A', '2026-11-09', '2026-11-13'), W('B', '2026-11-16', '2026-11-20', { effortDays: 2, deps: ['A'] })], project: [{ id: 'P', data: { id: 'P', processes: [] } }], calendar: WEEKDAYS_ONLY() });
  const same = E.compareScenario(d, 'P', { dates: { B: { start: '2026-11-16', due: '2026-11-20' } } }, TODAY);
  assert.deepEqual(same, { planFinish: '2026-11-20', scenarioFinish: '2026-11-20', planCost: 4800, scenarioCost: 4800, changed: [] });
  const r = E.compareScenario(d, 'P', { dates: { A: { start: '2026-11-09', due: '2026-11-19' } } }, TODAY);
  assert.deepEqual(r, { planFinish: '2026-11-20', scenarioFinish: '2026-11-23', planCost: 4800, scenarioCost: 8000, changed: ['A'] });
  assert.equal(d.workItem[0].data.due, '2026-11-13');                    // live plan untouched
  E.syncCalendar({});                                                     // R10 §3: the federal calendar again
  assert.equal(E.defaultTarget('2026-11-04'), '2027-01-04');             // Jan 3 is a Sunday → Monday
  assert.equal(E.defaultTarget('2026-11-02'), '2027-01-04');             // R10 §3: Jan 1 is New Year's Day → Monday
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
  // R10 §6: the stretch never pushes the plan past the deadline (training now closes the plan, after every step task)
  assert.ok(sug.map(s => s.due).sort().pop() <= '2026-12-15');
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
  assert.deepEqual(E.availLabel(d, 'D4', A), { state: 'live', key: 'connected', label: 'Available', tone: 'green' });   // R14: one word
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
  assert.equal(s.who[0].why, 'blocker');   // R11 §5: the late fix task of a blocking piece of information is its blocker row
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
  d.approval = wrap([{ id: 'A1', projectId: PRJ, bu: 'Treasury', approver: 'hc', decision: 'approved', at: '2026-11-04T09:00:00Z', stepUp: true }]);   // R11: not lp (does Treasury steps)
  const r = E.readiness(deepFreeze(d), PRJ, TODAY);
  const bu = check(r, 'bu-signoff');
  assert.equal(r.signoffOpen, false);
  assert.ok(!bu.unsigned.includes('Treasury'));                 // counted although other checks fail
  assert.equal(bu.sectionStatus.find(s => s.bu === 'Treasury').approved, true);
  assert.equal(bu.sectionStatus.find(s => s.bu === 'IT').approved, false);
});

test('R11 re-approval reason says what changed; ownerRole, raci and timer reopen the approval', () => {
  const fresh = () => { const d = readyDocs(); d.approval.forEach(e => { e.data.fingerprint = E.sectionFingerprint(d, PRJ, e.data.bu); }); return d; };
  const staleOf = d => check(E.readiness(d, PRJ, TODAY), 'bu-signoff').stale;
  assert.deepEqual(staleOf(fresh()), []);
  // the owner of a Treasury step changes to another Treasury person: Treasury reopens, and says which step and what
  let d = fresh();
  const tr = d.person.find(e => e.data.bu === 'Treasury');
  const s3 = d.process[0].data.tobe.find(n => n.id === 's3');
  d.person.push({ id: 'tw', data: { id: 'tw', name: 'Tess Wade', role: 'Treasury analyst', bu: 'Treasury' } });
  s3.owner = 'tw';
  let st = staleOf(d);
  assert.deepEqual(st.map(x => x.bu), ['Treasury'], JSON.stringify(st) + ' ' + (tr && tr.id));
  // R12: the reason says from → to
  assert.equal(st[0].text, 'Treasury must approve again: “' + s3.title + '” owner Leo Park → Tess Wade.');
  assert.ok(st[0].changed.every(c => /^section:Treasury#s:/.test(c)));
  const ap = E.projectTruth(d, PRJ, TODAY).approvals.find(a => a.bu === 'Treasury');
  assert.equal(ap.sentence, 'Changed after approval: Treasury must approve again: “' + s3.title + '” owner Leo Park → Tess Wade.');
  // ownerRole, raci and timer are part of the step: each one alone reopens the approval, and is named
  for (const [f, v, word] of [['ownerRole', 'Treasury Analyst', 'owner Leo Park → Treasury Analyst'], ['raci', { r: ['lp'], a: 'lp', c: [], i: ['ar'] }, 'RACI'], ['timer', '2 business days', 'timer']]) {
    d = fresh(); d.process[0].data.tobe.find(n => n.id === 's3')[f] = v;
    st = staleOf(d);
    assert.ok(st.length && st.every(x => new RegExp('“' + s3.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '” ' + word + (/→/.test(word) ? '' : ' changed')).test(x.text)), f + ': ' + JSON.stringify(st));
  }
  // two fields at once are listed together
  d = fresh(); Object.assign(d.process[0].data.tobe.find(n => n.id === 's3'), { timer: '1 day', sla: '4h' });
  assert.match(staleOf(d)[0].text, /time limit none → 4h, timer changed\.$/);
  // an approval saved before R11 (no per-step hashes) still reopens, with the general reason
  d = fresh(); d.approval.forEach(e => { e.data.fingerprint = e.data.fingerprint.replace(/;k:.*$/, ''); });
  d.process[0].data.tobe.find(n => n.id === 's3').timer = '3 days';
  st = staleOf(d);
  assert.ok(st.length && st.every(x => x.reason === 're-approval needed: its steps'), JSON.stringify(st));
});

test('R7 re-approval scope: one owner change stales only the sections it touches (fingerprint)', () => {
  const d = readyDocs();
  const fp = bu => E.sectionFingerprint(d, PRJ, bu);
  d.approval.forEach(e => { e.data.fingerprint = fp(e.data.bu); });
  assert.equal(E.readiness(d, PRJ, TODAY).pass, true);
  assert.match(fp('Treasury'), /^s:[0-9a-z]+;d:[0-9a-z]+;t:[0-9a-z]+;c:[0-9a-z]+;k:[^;]+;v:[^;]+;w:[^;]+;g:[^;]+;x:[^;]+$/);   // R14: + the part's tasks (w)
  // s3 moves from Leo Park (Treasury) to Ana Ruiz (Accounts Payable); the process is stamped as a whole
  d.process[0].data.tobe.find(n => n.id === 's3').owner = 'ar';
  d.process[0].data.updatedAt = '2026-11-03T00:00:00Z';
  const bu = check(E.readiness(d, PRJ, TODAY), 'bu-signoff');
  // R8: Treasury's only changed step moved to Accounts Payable, so Treasury no longer has a part to approve
  assert.ok(!bu.sections.includes('Treasury'));
  assert.deepEqual(bu.stale.map(x => x.bu).sort(), ['Accounts Payable']);
  // R11: the reason names the step: s3 is new in Accounts Payable's part
  assert.ok(bu.stale.every(x => /^re-approval needed: “[^”]+” added/.test(x.reason)), JSON.stringify(bu.stale));
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
  // R11 §2: Maya does a step in PMO's part and Ana recorded its tests, so no process owner can be suggested
  assert.equal(bu.suggestions.PMO, null);
  assert.equal(bu.sectionStatus.find(s => s.bu === 'PMO').needsApprover, true);
  assert.match(bu.detail, /No approver in PMO: assign one\./);
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
  /* R16 N1 #9 (BPM, supersedes R7 "all from observed values"): a min/max is never taken from the sample; the sample's
     range is kept as information (observedMin/observedMax), so nothing valid outside it is rejected */
  assert.deepEqual(by('Amount'), { name: 'Amount', type: 'currency', required: true, origin: 'profile', observedMin: 12.5, observedMax: 1200, format: 'currency', rule: 'Required' });
  assert.equal(by('Qty').type, 'number'); assert.deepEqual([by('Qty').min, by('Qty').max, by('Qty').observedMin, by('Qty').observedMax], [undefined, undefined, 3, 10]);
  assert.equal(by('Paid on').type, 'date');
  assert.equal(by('Branch code').type, 'digits'); assert.equal(by('Branch code').length, 4); assert.equal(by('Branch code').format, '4 digits');
  assert.equal(by('Payee').type, 'text'); assert.deepEqual([by('Payee').min, by('Payee').max, by('Payee').observedMinLen, by('Payee').observedMaxLen], [undefined, undefined, 6, 7]);
  assert.equal(by('Memo').required, false); assert.equal(by('Memo').rule, '');
  assert.deepEqual(E.specFromProfile({ columns: prof }), f);       // a profile doc works too
  assert.deepEqual(E.specFromProfile(null), []);
  // the generated spec validates its own sample
  const de = { id: 'DX', name: 'Payments', fields: f };
  const cases = GT(de, prof);
  cases.filter(c => !c.context).forEach(c => assert.equal(E.validate(E.fieldSpec(f.find(x => x.name === c.field)), c.input) ? 'accept' : 'reject', c.expect, c.field + ' ' + c.note));
  assert.ok(cases.some(c => c.field === 'Amount' && c.kind === 'boundary' && c.input === '12.50' && c.expect === 'accept'));
  assert.ok(!cases.some(c => c.field === 'Amount' && c.input === '1200.01' && c.expect === 'reject'), 'a value just above the sample\'s largest is not rejected');
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
  d.person.forEach(e => { e.data.dayRate = 800; });   // R14: an expected cost needs a rate for the open work
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
  assert.deepEqual([gt.label, gt.lateCount, gt.rag], ['Waiting on information', 0, 'amber']);  /* R15 lead ruling (Karen r15): a blocker holding up work is never "On track" */
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
    else if (s.tag) assert.ok(['retire', 'train', 'tell'].includes(s.tag), s.title);                       // R10 §6: retire / train / tell
    else assert.ok(['new', 'changed'].includes(state(s)), s.title);                                       // only changed/new steps
    assert.equal(s.effortDays, ['w1', 'm1'].includes(s.step) || s.tag === 'tell' ? 1 : 3);
    assert.ok(s.owner || /^Needs an owner/.test(s.note || ''), s.title);   // R11 §4: never the PM by default
    assert.ok(s.start >= TODAY && s.due >= TODAY);
  });
  // R10 §6 (supersedes R8): every new or changed step gets a task, a wait or a message included (1 day of effort)
  assert.deepEqual(['w1', 'm1'].map(id => sug.filter(s => s.step === id).length), [1, 1]);
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
  assert.equal(us.done, false); assert.equal(us.stage, 'tryout'); assert.equal(us.nextAction.label, 'Try out the 10 information checks');   // R14: the stage's own unit
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
  // R11 §5: the 'blocker' rows are exactly projectTruth.blocking (holds up an open task, planned or not); a planned
  // blocker's row is its open fix task's action; missing information that holds nothing up is an 'info' row
  assert.deepEqual(r.who.filter(x => x.why === 'blocker').map(x => x.what), ['Plan work to get Vendor risk tier', 'Finish “Stand up structured bank capture” (was due Nov 3)', 'Finish “Sign screening vendor contract”']);   // R14: on schedule itself, never "back on schedule"
  assert.deepEqual(r.who.filter(x => x.why === 'blocker').map(x => x.ref).sort(), r.blocking.items.map(b => 'data:' + b.dataId).sort());
  assert.equal(r.who.filter(x => x.why === 'blocker').length, r.blocking.count);
  assert.ok(r.who.some(x => x.why === 'info' && x.what === 'Plan work to get Payment hold list'));
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
  p.workItem.find(e => e.id === 'W2').data.time = [{ by: 'ps', date: '2026-11-03', hours: 4 }];   // R10 §2: SPI also needs actual cost
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
  d.person.push({ id: 'ht', data: { id: 'ht', name: 'Tess Hale', role: 'Treasurer', bu: 'Treasury' } });   // R11: approves; does no steps
  d.approval = [{ id: 'A1', data: { id: 'A1', projectId: PRJ, bu: 'Treasury', approver: 'ht', decision: 'approved', at: '2026-11-03T10:00:00Z', stepUp: true } }];
  const r = E.readiness(d, PRJ, TODAY);
  assert.deepEqual(check(r, 'bu-signoff').sections, ['Treasury']);
  assert.equal(check(r, 'bu-signoff').pass, true);
  assert.equal(check(r, 'two-person').pass, true);                     // one changed team: one approval is enough
  const t = E.projectTruth(d, PRJ, TODAY);
  assert.deepEqual(t.approvals.map(a => [a.bu, a.needed, a.approved, a.approver]), [['Treasury', true, true, 'ht']]);
  assert.equal(t.launchSteps.find(s => s.key === 'approvals').done, true);
  assert.equal(E.buReady(d, PRJ, 'Procurement').needed, false);       // not a gate condition anywhere
  assert.ok(!t.launchSteps.some(s => /Procurement/.test(s.action)));
  // separation of duties (R11 §2): Tess recorded test results of Treasury's part and Leo does its step, so someone
  // else must approve
  const s = JSON.parse(JSON.stringify(d));
  s.testRun.forEach(e => { e.data.by = 'ht'; });
  s.approval = [];
  const st = E.projectTruth(s, PRJ, TODAY);
  const a = st.approvals.find(x => x.bu === 'Treasury');
  assert.equal(a.approved, false);
  assert.deepEqual([a.blockedBy.rule, a.blockedBy.person], ['separation-of-duties', 'lp']);
  assert.deepEqual(a.blockedBy.people, ['lp', 'ht']);
  assert.equal(a.blockedBy.text, 'Leo Park does steps in Treasury’s part, so someone else must approve it. Tess Hale recorded test results for Treasury’s part, so someone else must approve it.');
  assert.equal(a.blockedBy.fix, "Choose who approves Treasury's part");
  assert.match(st.launchSteps.find(x => x.key === 'approvals').action, /Leo Park does steps in Treasury’s part, so someone else must approve it\. Choose who approves Treasury's part/);
  // their own approvals do not count
  ['lp', 'ht'].forEach(who => {
    s.approval = [{ id: 'A2', data: { id: 'A2', projectId: PRJ, bu: 'Treasury', approver: who, decision: 'approved', at: '2026-11-03T10:00:00Z', stepUp: true } }];
    assert.equal(check(E.readiness(s, PRJ, TODAY), 'bu-signoff').pass, false);
  });
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
  assert.ok(!pq.some(x => x.kind === 'approval'), JSON.stringify(pq));   // R11 §2: Priya does Compliance steps
  const hq = E.personQueue(r, 'hc', TODAY);
  assert.ok(hq.some(x => x.kind === 'approval' && x.id === 'Compliance'), JSON.stringify(hq));
  assert.deepEqual(E.personQueue(r, 'nobody', TODAY), []);
});

test('R9 §4 plans: owners carried from steps, levelled, feasible, and the dialog date equals the truth after Accept', () => {
  const d = baseDocs();
  // a role-only changed step and a step with nobody
  d.process[0].data.tobe.splice(6, 0, { id: 'sR', title: 'Clerk files the vendor packet', ownerRole: 'Clerk', data: [] }, { id: 'sN', title: 'Archive the packet', data: [] });
  deepFreeze(d);
  const sug = E.suggestWorkFromDiff(d, PRJ, TODAY);
  const role = sug.find(s => s.step === 'sR');
  // R11 §4 (supersedes R10 §6): a role-only step is unassigned with the role shown, unless exactly one person
  // in the workspace has that role; never the PM by default
  assert.deepEqual([role.owner, role.ownerRole], [null, 'Clerk']);
  assert.equal(role.note, 'Needs an owner: Clerk.');
  assert.equal(sug.find(s => s.step === 'sN').owner, null);
  const one = JSON.parse(JSON.stringify(d)); one.person.push({ id: 'ck', data: { id: 'ck', name: 'Cal Kim', role: 'Clerk', bu: 'Procurement' } });
  const r1 = E.suggestWorkFromDiff(one, PRJ, TODAY).find(s => s.step === 'sR');
  assert.deepEqual([r1.owner, r1.ownerRole], ['ck', 'Clerk']);
  assert.ok(E.planFit(d, PRJ, TODAY, sug).unassigned.some(u => u.text === 'Needs an owner: Clerk'));
  assert.equal(sug.find(s => s.step === 's5').owner, 'mc');           // the step's owner
  // levelled: nobody works on two suggested tasks at once
  const byOwner = {};
  sug.forEach(s => { const k = s.owner || s.key; (byOwner[k] = byOwner[k] || []).push(s); });
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
  // R10 §6: retire/train/tell tasks make this fixture's plan longer; the dialog says whichever is true
  assert.equal(fit.message, fit.fits ? 'Done by about ' + E.fmtDay(t.forecastFinish) + ', ' + t.bufferDays + ' business days before your Dec 15 deadline.'
    : 'This plan needs until ' + E.fmtDay(t.forecastFinish) + ', past your Dec 15 deadline.');
  assert.equal(fit.fits, t.forecastFinish <= '2026-12-15');
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

/* ================================ Round 10: NUMBERS YOU CAN TRUST ================================ */
const SEED = require(path.join(ROOT, 'api', 'shared', 'pmoflow-seed.js'));
const GOLD_DAY = '2026-11-17';

test('R10 §3 holiday calendar: federal holidays computed for any year, observed dates, workspace days', () => {
  const h26 = E.federalHolidays(2026).map(h => h.date);
  assert.deepEqual(h26, ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25']);
  assert.ok(E.federalHolidays(2027).some(h => h.date === '2027-12-31' && h.name === 'New Year’s Day'));   // Jan 1 2028 is a Saturday
  assert.ok(!E.federalHolidays(2028).some(h => h.date.endsWith('-01-01')));
  assert.equal(E.federalHolidays(2031).find(h => h.name === 'Thanksgiving Day').date, '2031-11-27');       // computed, not a table
  E.syncCalendar({});
  assert.equal(E.addBusinessDays('2026-11-25', 1), '2026-11-27');    // Thanksgiving skipped
  assert.equal(E.addBusinessDays('2026-12-24', 1), '2026-12-28');    // Christmas + weekend
  assert.equal(E.addBusinessDays('2026-12-25', 0), '2026-12-28');    // a holiday rolls forward
  assert.equal(E.businessDaysBetween('2026-11-25', '2026-11-30'), 2); // Fri 27, Mon 30
  assert.equal(E.isBusinessDay('2026-11-26'), false);
  assert.equal(E.holidayName('2026-12-25'), 'Christmas Day');
  // the workspace's own calendar: a day off, and a federal holiday the workspace works
  const ws = { calendar: [{ id: 'workspace', data: { id: 'workspace', holidays: [{ date: '2026-12-24', name: 'Christmas Eve' }, { date: '2026-11-11', off: true }] } }] };
  assert.equal(E.isBusinessDay('2026-12-24', ws), false);
  assert.equal(E.holidayName('2026-12-24', ws), 'Christmas Eve');
  assert.equal(E.isBusinessDay('2026-11-11', ws), true);
  assert.equal(E.addBusinessDays('2026-12-23', 1), '2026-12-28');    // the active calendar now has Dec 24 off
  const list = E.holidays(ws, { today: GOLD_DAY });
  assert.equal(list.filter(h => h.source === 'federal').length, 33);   // 2026–2028
  assert.ok(list.some(h => h.date === '2026-12-24' && h.source === 'custom'));
  assert.ok(list.some(h => h.date === '2026-11-11' && h.worked));
  E.syncCalendar({});
  assert.equal(E.isBusinessDay('2026-12-24'), true);
  // the launch window refuses a weekend or a holiday
  assert.equal(E.checkLaunchWindow('2026-12-25'), 'Fri Dec 25, Christmas Day');
  assert.equal(E.checkLaunchWindow('2026-12-26'), 'Sat Dec 26, a weekend');
  assert.equal(E.checkLaunchWindow('2026-12-29'), null);
  const d = SEED.seed(GOLD_DAY).docs;
  d.project.find(p => p.id === PRJ).data.cutover.window = '2026-12-25 07:30–10:00';
  const r = E.readiness(d, PRJ, GOLD_DAY);
  const co = r.checks.find(c => c.id === 'cutover-plan');
  assert.equal(co.pass, false); assert.match(co.detail, /^The launch window is on Fri Dec 25, Christmas Day; pick a business day\./);
  assert.deepEqual(E.projectTruth(d, PRJ, GOLD_DAY).launch, { date: '2026-12-25', source: 'window', problem: 'Fri Dec 25, Christmas Day' });
});

test('R10 §3 seed: no seeded date is a weekend or holiday, and every business-day gap is the same on any business day', () => {
  const gaps = day => { const d = SEED.seed(day).docs; const t = d.project.find(p => p.id === PRJ).data;
    return [E.businessDaysBetween(day, t.target), ...d.workItem.map(w => E.businessDaysBetween(w.data.start, w.data.due))].join(','); };
  const ref = gaps(GOLD_DAY);
  for (let i = 0; i < 400; i += 3) {
    const day = E.addDays('2026-06-01', i);
    if (!E.isBusinessDay(day)) continue;
    assert.equal(gaps(day), ref, day);
    const d = SEED.seed(day).docs;
    for (const w of d.workItem) for (const k of ['start', 'due', 'doneAt']) if (w.data[k]) assert.ok(E.isBusinessDay(w.data[k]), w.id + ' ' + k + ' ' + w.data[k]);
    for (const p of d.project) { assert.ok(E.isBusinessDay(p.data.target)); const l = E.launchDate(d, p.id); assert.equal(l.problem, null, p.id + ' launch ' + l.date); }
  }
});

test('R10 §1 one change count: changeSummary counts new, changed and removed (removed steps count)', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const P = id => d.process.find(p => p.id === id).data;
  // R11 §8: choices (decision / parallel gateways) are not steps, so they are never counted as a step change
  assert.deepEqual(E.changeSummary(P('vendor-onboarding')), { added: 4, changed: 6, removed: 1, steps: 10, total: 11, text: '4 new · 6 changed · 1 removed' });
  assert.equal(E.changeSummary(P('invoice-approval')).text, '1 new · 3 changed');
  assert.equal(E.changeSummary(d.project.find(p => p.id === PRJ).data, d).text, '5 new · 9 changed · 1 removed');
  ['vendor-onboarding', 'invoice-approval', 'access-review', 'expense-reimbursement'].forEach(id => { const c = E.changeSummary(P(id)); assert.ok(c.added + c.changed <= c.steps, id); });
  assert.equal(E.diffSummary(P('vendor-onboarding')).added, E.diffSummary(P('vendor-onboarding')).new);
  assert.equal(E.changeSummary({ asis: [], tobe: [] }).text, '');
});

test('R10 §2 earned value reconciles: tile % = EV ÷ budget; SPI/CPI/EAC blank until started with actual cost; SPI < 0.9 is never On track', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const t = E.projectTruth(d, PRJ, GOLD_DAY);
  assert.equal(t.pctDone, Math.round(t.ev.EV / t.ev.BAC * 100));
  assert.equal(E.projectStats(d, PRJ, GOLD_DAY).pct, t.pctDone);
  assert.ok(Math.abs(t.ev.EV - t.ev.BAC * t.ev.pctDone) < 0.01);
  assert.ok(t.ev.SPI < 0.9 && t.label !== 'On track' && t.reasons.some(r => /^Behind on effort: /.test(r)));
  const erp = E.projectTruth(d, 'erp-upgrade-readiness', GOLD_DAY);
  // R11 §6: money spent with nothing finished shows 0.00 and is flagged; one EAC method (bottom-up + spent)
  assert.deepEqual([erp.ev.SPI, erp.ev.CPI, erp.ev.EAC, erp.ev.started, erp.ev.eacMethod], [0, 0, 10406.25, false, 'bottom-up']);
  assert.ok(erp.ev.AC > 0);                                        // hours logged, but nothing earned yet
  assert.deepEqual(erp.evFlags.map(f => f.text), ['Spent with nothing finished']);
  assert.equal(erp.label, 'Behind on effort');                     // SPI 0.00 is never "On track"
  assert.deepEqual([erp.cost.forecast, erp.cost.actual], [10406.25, 1406.25]);
  assert.ok(erp.cost.forecast >= erp.cost.actual);
  // a project that would be green but is behind on effort reads "Behind on effort"
  const W = (id, more) => ({ id, data: Object.assign({ id, projectId: 'P', owner: 'mc', title: id, status: 'prog', start: '2026-11-03', due: '2026-12-01', deps: [], effortDays: 2, progress: 0.1, time: [{ by: 'mc', date: '2026-11-04', hours: 4 }] }, more) });
  const g = { person: [{ id: 'mc', data: { id: 'mc', dayRate: 800 } }], project: [{ id: 'P', data: { id: 'P', processes: [], target: '2027-03-01', budget: { planned: 1600 } } }], workItem: [W('A'), W('B')] };
  const ar = E.projectTruth(g, 'P', GOLD_DAY);
  if (ar.lateCount === 0 && ar.ev.SPI != null && ar.ev.SPI < 0.9) { assert.equal(ar.label, 'Behind on effort'); assert.equal(ar.rag, 'amber'); assert.match(ar.reasons[0], /^Behind on effort: \d+% of the work planned by today is done$/); }
  else assert.fail('fixture should be behind on effort with nothing late: ' + JSON.stringify([ar.lateCount, ar.ev.SPI]));
});

test('R10 §4/§5/§7 testing has one truth; the late split; grammar', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const t = E.projectTruth(d, PRJ, GOLD_DAY).testing;
  assert.deepEqual([t.needTests, t.haveTests, t.next], [2, 1, 'Add tests for 1 new piece of information']);
  assert.equal(t.done, false);
  assert.equal(t.stages.find(s => s.key === 'uat').total, t.total);   // one denominator
  assert.equal(E.testCoverage(d, PRJ, GOLD_DAY).uat.total, t.total);
  assert.equal(E.lateText({ lateCount: 5, pastDueCount: 1, finishAfterDueCount: 4 }), '5 late (1 past due, 4 will finish after their due date)');
  assert.equal(E.lateText({ lateCount: 1, pastDueCount: 0, finishAfterDueCount: 1 }), '1 late (1 will finish after its due date)');
  assert.equal(E.lateText({ lateCount: 0, pastDueCount: 0, finishAfterDueCount: 0 }), 'Nothing late');
  // "1 test that hasn't run": cover every field of D2 so only not-run tests remain, with one left unrun
  const g = SEED.seed(GOLD_DAY).docs;
  ['Bank name', 'Account number'].forEach((f, i) => g.testCase.push({ id: 'TCX' + i, data: { id: 'TCX' + i, dataId: 'D2', field: f, kind: 'valid', input: 'x', expect: 'accept', origin: 'spec' } }));
  const tt = E.projectTruth(g, PRJ, GOLD_DAY).testing;
  assert.equal(tt.haveTests, 2);
  assert.ok(!/1 tests|1 test that haven't/.test(tt.next), tt.next);
});

test('R10 §6 suggested plans are real plans: every change, retire/train/tell, people only, dependencies respected', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  d.project.push({ id: 'px', data: { id: 'px', name: 'Expense Upgrade', owner: 'ta', processes: ['expense-reimbursement'], status: 'active', target: E.addBusinessDays(GOLD_DAY, 40) } });
  let t = E.projectTruth(d, 'px', GOLD_DAY);
  assert.equal(t.noPlan, true);
  assert.deepEqual(t.launchSteps.filter(s => s.done).map(s => s.key), []);              // never "Information available ✓" / "1 of 7 done"
  const sug = E.suggestWorkFromDiff(d, 'px', GOLD_DAY);
  assert.deepEqual(sug.map(s => s.tag || s.step), ['x1', 'tell', 'train']);
  // R11 §4: nobody in the workspace has the role "Employee", so the task needs an owner (never the PM)
  assert.deepEqual([sug[0].owner, sug[0].ownerRole, sug[0].note], [null, 'Employee', 'Needs an owner: Employee.']);
  assert.ok(sug.slice(1).every(s => s.owner && !s.ownerRole), 'tell and train: the project manager');
  assert.equal(sug[1].note, 'Teams: Employee.');
  // the vendor process: one task per new/changed step without work, a Retire task, train + tell; all owned by people
  const v = SEED.seed(GOLD_DAY).docs;
  v.project.push({ id: 'pv', data: { id: 'pv', name: 'Vendor 2', owner: 'ta', processes: ['vendor-onboarding'], status: 'active', target: E.addBusinessDays(GOLD_DAY, 60) } });
  const sv = E.suggestWorkFromDiff(v, 'pv', GOLD_DAY);
  const diff = E.diffProcess(v.process.find(p => p.id === 'vendor-onboarding').data);
  Object.keys(diff.nodes).filter(id => diff.nodes[id] !== 'same').forEach(id => assert.ok(sv.some(s => s.step === id && !s.resolves), 'a task for ' + id));
  assert.ok(sv.some(s => s.tag === 'retire' && s.retires === 'a3b' && s.title === 'Retire the old step: Print and file the bank letter'));
  assert.ok(sv.some(s => s.resolves === 'D2') === false);                                    // W6 already resolves D2
  assert.ok(sv.every(s => s.owner && v.person.some(p => p.id === s.owner)));
  assert.equal(sv.find(s => s.tag === 'tell').note, 'Teams: ' + 'Procurement, Compliance, Treasury, Accounts Payable and IT' + '.');
  // accepted: no task starts before a prerequisite finishes, nothing late on day one
  const acc = Object.assign({}, v, { workItem: v.workItem.concat(E.planToWork('pv', sv).map(w => ({ id: w.id, data: w }))) });
  assert.deepEqual(E.scheduleConflicts(acc, 'pv').filter(c => sv.some(s => s.key === c.workId)), []);
  const by = Object.fromEntries(sv.map(s => [s.key, s]));
  sv.forEach(s => s.deps.forEach(dp => { const f = by[dp] ? by[dp].due : null; if (f) assert.ok(s.start > f, s.key + ' starts after ' + dp); }));
  const fc = E.forecastAll(acc, GOLD_DAY);
  sv.forEach(s => assert.notEqual(fc[s.key].sched, 'late', s.title));
  t = E.projectTruth(acc, 'pv', GOLD_DAY);
  assert.equal(t.noPlan, false);
});

test('R11 golden numbers (docs/pmoflow/GOLDEN-NUMBERS.md) at seed day 0', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const v = E.projectTruth(d, PRJ, GOLD_DAY), e = E.projectTruth(d, 'erp-upgrade-readiness', GOLD_DAY);
  assert.deepEqual([v.label, v.tasks.done, v.tasks.total, v.pctDone, v.lateText, v.who.filter(x => x.why === 'blocker').length, v.stepsLeft],
    ['Some tasks late', 7, 13, 48, '5 late (1 past due, 4 will finish after their due date)', 1, 6]);
  assert.deepEqual([v.forecastFinish, v.target, v.bufferDays, v.launch.date], ['2026-12-09', '2026-12-30', 14, '2026-12-29']);
  assert.deepEqual([v.ev.BAC, v.ev.EV, v.ev.AC, v.ev.SPI, v.ev.CPI, v.ev.EAC, v.cost.forecast], [48000, 23258.28, 23668.75, 0.79, 0.98, 48847.12, 48847.12]);
  // R11 §1: one testing truth; each phase keeps its own count; the test held by the open problem never counts as passed
  assert.deepEqual([v.testing.passed, v.testing.total, v.testing.failed, v.testing.waitingForFix, v.testing.notRun, v.testing.needTests, v.testing.haveTests], [9, 26, 1, 1, 16, 2, 1]);
  assert.equal(v.testing.count, '9 of 26 tests passed');
  assert.deepEqual(v.testing.stages.map(s => s.passed + '/' + s.total), ['7/8', '9/26']);
  assert.deepEqual([v.testing.coverage.gaps, v.testing.coverage.text], [1, '1 coverage gap: Bank remittance details has no test for Bank name and Account number']);
  assert.deepEqual(Object.entries(v.testing.perBU).map(([k, x]) => [k, x.passed, x.total, x.failed, x.notRun, x.gapCount]),
    [['Accounts Payable', 0, 7, 1, 6, 1], ['Compliance', 9, 9, 0, 0, 0], ['IT', 0, 4, 0, 4, 0], ['Procurement', 1, 4, 0, 3, 0], ['Treasury', 0, 11, 1, 10, 1]]);
  assert.equal(v.testing.perBU.Compliance.text, '9 of 9 tests passed');
  assert.equal(v.testing.perBU.Treasury.text, '0 of 12 checks done: 0 of 11 tests passed, and 1 piece of information has no tests yet (Bank remittance details: Bank name and Account number)');
  assert.equal(v.testing.perBU.Compliance.notChangedText, 'Not tested because this project does not change them: Vendor legal name & Tax ID, Certificate of insurance and Vendor risk tier.');
  assert.equal(v.who.length, 7);
  assert.deepEqual([v.blocking.count, v.blocking.holdsUp, v.blocking.text], [1, 5, '1 blocking (holds up 5 tasks)']);
  assert.deepEqual([v.lateness.W6.text, v.lateness.W6.dueText, v.lateness.W7.dueText], ['1 business day past due; expected to finish 6 business days late', 'was due Nov 16', 'due Nov 23']);   /* R16 N1 #10 one wording */
  assert.deepEqual([v.grants.waiting, v.grants.open], [1, 1]);
  assert.deepEqual(v.approvals.map(a => [a.bu, a.ready, a.approver]), [['Accounts Payable', false, 'nb'], ['Compliance', true, 'do'], ['IT', false, 'sk'], ['Procurement', false, 'rv'], ['Treasury', false, 'gw']]);
  // R11 §2 seed: every team has an eligible approver (its department head) who does none of its steps and recorded none
  // of its tests, so separation of duties never makes the demo un-approvable
  assert.ok(v.approvals.every(a => a.approver && !E.approvalBar(d, PRJ, a.bu, a.approver) && !a.blockedBy), JSON.stringify(v.approvals.map(a => [a.bu, a.approver, a.blockedBy])));
  assert.equal(v.who.filter(x => x.why === 'blocker').length, v.blocking.count);
  assert.deepEqual([e.label, e.tasks.done, e.tasks.total, e.pctDone, e.lateCount, e.stepsLeft, e.ev.SPI, e.ev.CPI, e.ev.EAC, e.cost.forecast, e.cost.actual],
    ['Behind on effort', 0, 2, 0, 0, 6, 0, 0, 10406.25, 10406.25, 1406.25]);
  assert.deepEqual(e.evFlags.map(f => f.text), ['Spent with nothing finished']);
  assert.deepEqual([e.forecastFinish, e.target, e.bufferDays, e.launch.date, e.launch.source], ['2026-12-10', '2027-01-19', 25, '2027-01-19', 'deadline']);
  assert.deepEqual([e.testing.passed, e.testing.total, e.testing.haveTests], [0, 20, 1]);
  assert.deepEqual([E.changeSummary(d.process.find(p => p.id === 'vendor-onboarding').data).text, E.changeSummary(d.process.find(p => p.id === 'invoice-approval').data).text],
    ['4 new · 6 changed · 1 removed', '1 new · 3 changed']);
});

/* ================================ Round 11 (G1) ================================ */
test('R11 §1 testingTruth: phases never mix, a pass held by an open problem never counts, coverage gaps in N of N', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const before = E.testingTruth(d, PRJ, GOLD_DAY);
  assert.deepEqual(before, E.projectTruth(d, PRJ, GOLD_DAY).testing);
  // recording only the business check changes only the business-check phase
  const ids = before.stages[1].total;
  const all = E.readiness(d, PRJ, GOLD_DAY).checks.find(c => c.id === 'tests-passed');
  const allIds = all.cases.concat(all.scripts);
  d.testRun.push({ id: 'TRX', data: { id: 'TRX', projectId: PRJ, env: 'uat', at: GOLD_DAY + 'T20:00:00Z', by: 'ar', results: allIds.map(k => k.startsWith('uat-') ? { scriptId: k, outcome: 'pass', evidence: 'seen' } : { caseId: k, outcome: 'pass' }) } });
  const after = E.testingTruth(d, PRJ, GOLD_DAY);
  assert.deepEqual(after.stages[0], before.stages[0], 'Try it out unchanged');
  assert.equal(after.stages[1].passed, ids - 1, 'every business test passed except the one waiting for its fix');
  assert.equal(after.waitingForFix, 1);
  assert.notEqual(after.passed, after.total, 'never "N of N passed" while a problem is open');
  // the problem marked fixed: the retest pass now counts
  const w12 = d.workItem.find(x => x.id === 'W12').data; w12.defectStatus = 'fixed';
  const fixed = E.testingTruth(d, PRJ, GOLD_DAY);
  assert.equal(fixed.waitingForFix, 0);
  // the gate reads the same truth
  const gate = E.readiness(d, PRJ, GOLD_DAY).checks.find(c => c.id === 'tests-passed');
  assert.equal(gate.passed, fixed.passed); assert.equal(gate.total, fixed.total);
  // audit text uses the phase's own counts
  const run = d.testRun.find(r => r.id === 'TRX').data;
  assert.match(E.runAuditText(d, PRJ, run), /^Recorded the business check for Vendor Onboarding Modernization: \d+ results \(\d+ passed\)\. Business check now \d+ of 26 tests passed\.$/);
});

test('R11 §2 separation of duties: approvalBar names the rule for every barred person', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  assert.equal(E.approvalBar(d, PRJ, 'Compliance', 'do'), null);                              // Dave may approve
  assert.equal(E.approvalBar(d, PRJ, 'Compliance', 'ps').rule, 'step-owner');                // Priya does Compliance steps
  assert.equal(E.approvalBar(d, PRJ, 'Compliance', 'ta').rule, 'project-manager');
  d.testRun.push({ id: 'TRD', data: { id: 'TRD', projectId: PRJ, env: 'uat', at: GOLD_DAY + 'T20:00:00Z', by: 'do', results: [{ caseId: 'TC11', outcome: 'pass' }] } });
  assert.equal(E.approvalBar(d, PRJ, 'Compliance', 'do').rule, 'recorded-tests');           // recorded one result → barred
  const t = E.projectTruth(d, PRJ, GOLD_DAY);
  assert.equal(t.approvals.find(a => a.bu === 'Compliance').blockedBy.rule, 'separation-of-duties');
});

test('R11 §3 launch guard and the two-person override', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const p = d.project.find(x => x.id === PRJ).data;
  p.cutover = { window: '2026-12-29 07:30-10:00', tasks: [{ id: 'CT1', task: 'Freeze vendor master', owner: 'dk', done: false }] };
  let g = E.launchGuard(d, PRJ, '2026-12-29T07:00');
  assert.deepEqual(g.codes, ['window', 'tasks']);
  assert.equal(g.text, 'Ready except: the launch window opens Tue Dec 29, 7:30 AM; 1 launch-day step is not done yet: “Freeze vendor master”');
  assert.deepEqual(E.launchGuard(d, PRJ, '2026-12-29T07:30').codes, ['tasks']);
  let o = E.launchOverrideStatus(d, PRJ, '2026-12-29T07:00');
  assert.deepEqual([o.needed, o.ok, o.missing], [true, false, ['pm', 'sponsor']]);
  assert.equal(E.overrideSignerRole(d, PRJ, 'ta'), 'pm');
  assert.equal(E.overrideSignerRole(d, PRJ, 'do'), 'sponsor');                              // an eligible approver
  assert.equal(E.overrideSignerRole(d, PRJ, 'ps'), null);                                   // can't approve any part
  const sign = (id, by, role) => d.approval.push({ id, data: { id, projectId: PRJ, kind: 'launch-override', role, approver: by, decision: 'approved', stepUp: true, at: GOLD_DAY + 'T21:00:00Z', reason: 'Steering group moved it' } });
  sign('O1', 'ta', 'pm');
  o = E.launchOverrideStatus(d, PRJ, '2026-12-29T07:00'); assert.deepEqual([o.ok, o.missing], [false, ['sponsor']]);
  sign('O2', 'do', 'sponsor');
  o = E.launchOverrideStatus(d, PRJ, '2026-12-29T07:00'); assert.deepEqual([o.ok, o.overridden], [true, true]);
  // override sign-offs never count as a team's approval
  assert.equal(E.readiness(d, PRJ, GOLD_DAY).checks.find(c => c.id === 'bu-signoff').sectionStatus.find(x => x.bu === 'Compliance').approved, false);
  // a launch day on a day off is flagged, never "On track"
  const q = SEED.seed(GOLD_DAY).docs;
  q.calendar[0].data.holidays = [{ date: '2026-12-29', name: 'Year-end shutdown' }];
  const t = E.projectTruth(q, PRJ, GOLD_DAY);
  assert.match(t.launchFlag, /^Launch day Tue Dec 29, Year-end shutdown is a day off/);
  assert.notEqual(t.label, 'On track'); assert.equal(t.reasons[0], t.launchFlag);
  E.syncCalendar({});
});

test('R11 §3 access grants: one set of words, local dates, never more than 30 days', () => {
  const g = { status: 'active', approvedAt: '2026-11-13T00:30:00Z', expires: '2026-12-12' };
  const v = E.grantView(g, '2026-11-17', 360);                 // Chicago: approved on the evening of Nov 12
  assert.deepEqual([v.state, v.from, v.to, v.days, v.overMax], ['open', '2026-11-12', '2026-12-12', 30, false]);
  assert.equal(E.grantView({ status: 'requested' }, '2026-11-17').label, 'Waiting for approval');
  assert.equal(E.grantView(Object.assign({}, g, { expires: '2026-11-16' }), '2026-11-17').state, 'closed');
  const d = SEED.seed(GOLD_DAY).docs;
  const c = E.grantCounts(d, PRJ, GOLD_DAY);
  const gate = E.readiness(d, PRJ, GOLD_DAY).checks.find(x => x.id === 'grants-closed');
  assert.equal(gate.blocking.length, c.waiting); assert.equal(gate.expiring.length, c.open);
});

test('R11 §4 plan sanity: 10-day cap, late-on-arrival warning, role owners, real teams', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  d.project.push({ id: 'px', data: { id: 'px', name: 'Vendor 3', owner: 'ta', processes: ['vendor-onboarding'], status: 'active', target: E.addBusinessDays(GOLD_DAY, 3) } });
  const sug = E.suggestWorkFromDiff(d, 'px', GOLD_DAY);
  assert.ok(sug.every(s => E.businessDaysBetween(s.start, s.due) <= 10), 'no task longer than 10 business days');
  const fit = E.planFit(d, 'px', GOLD_DAY, sug);
  assert.equal(fit.fits, false);
  assert.match(fit.warning.text, /^This needs until [A-Z][a-z]{2} \d+, past your [A-Z][a-z]{2} \d+ deadline \(\d+ business days? late\)\.$/);
  assert.deepEqual(fit.warning.options.map(o => o.label), ['Accept anyway', 'Adjust']);
  // long work is split into parts
  const big = E.suggestWorkFromDiff(d, 'px', GOLD_DAY).map(s => Object.assign(s, { effortDays: s.effortDays }));
  assert.ok(big.length > 0);
});

test('R11 §5/§6/§9: one lateness per task, one blocking definition, EV hygiene, Jira done-before-dependencies', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const t = E.projectTruth(d, PRJ, GOLD_DAY);
  Object.values(t.lateness).forEach(l => { assert.ok(l.days > 0); assert.ok(l.text === 'Expected to finish ' + l.days + ' business day' + (l.days === 1 ? '' : 's') + ' late' || l.text === l.pastDueDays + ' business day' + (l.pastDueDays === 1 ? '' : 's') + ' past due; expected to finish ' + l.days + ' business day' + (l.days === 1 ? '' : 's') + ' late', l.text);   /* R16 N1 #10 */ if (l.due >= GOLD_DAY) assert.doesNotMatch(l.dueText, /was due/); });
  assert.equal(t.blocking.count, t.blocking.items.length);
  assert.ok(t.blocking.items.every(b => b.held > 0));
  // a Jira "Done" on a task whose predecessor is open
  const w = d.workItem.find(x => x.data.deps && x.data.deps.length && x.data.status !== 'done').data;
  w.status = 'done';
  const f = E.doneBeforeDeps(d, w.id);
  assert.equal(f.flag, true); assert.match(f.text, /^Finished before the work it depends on/);
  // EV: done with 0 hours is flagged
  const ev = E.earnedValue(d, PRJ, GOLD_DAY);
  assert.ok(ev.doneNoHours.includes(w.id)); assert.ok(ev.flags.some(x => x.key === 'done-no-hours'));
});

test('R11 §7 sprint calendar: holidays reduce working days and capacity', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const sp = E.sprintCalendar(d, PRJ, GOLD_DAY);
  const tg = sp.find(s => s.start <= '2026-11-26' && s.end >= '2026-11-26');
  assert.equal(tg.workingDays, 9); assert.deepEqual(tg.daysOff.map(x => x.name), ['Thanksgiving Day']);
  assert.match(tg.text, /9 working days \(Thanksgiving Day off\)$/);
  tg.capacity.people.forEach(p => assert.ok(p.days <= 4 * 9 / 5 + 1e-9 || p.days < 10));
  const xm = sp.find(s => s.start <= '2026-12-25' && s.end >= '2026-12-25');
  assert.ok(xm.workingDays < 10 && xm.daysOff.some(x => x.name === 'Christmas Day'));
});

test('R10 "Not checked yet": imported information (avail unchecked) is never "We have it" or "Connected"', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  d.dataElement.push({ id: 'DU', data: { id: 'DU', name: 'Dispute register entry', avail: 'unchecked', fields: [] } });
  const vo = d.process.find(p => p.id === 'vendor-onboarding').data;
  vo.asis.find(n => n.id === 'a1').data = ['D1', 'D3', 'DU'];          // even on a Today step
  vo.tobe.find(n => n.id === 's1').data = ['D1', 'D3', 'DU'];
  assert.equal(E.effectiveAvail(d, 'DU'), 'unchecked');
  assert.equal(E.dataReady(d, 'DU'), false);
  assert.deepEqual(E.availLabel(d, 'DU'), { state: 'unchecked', needsConfirm: false, key: 'unchecked', label: 'Not checked yet', tone: 'amber' });
  assert.equal(E.availLabel(d, 'DU', { advanced: true }).label, 'Not checked yet');
  assert.ok(E.projectTruth(d, PRJ, GOLD_DAY).blockers.some(b => b.dataId === 'DU'), 'counts as not available');
  // the owner's confirmation makes it available again
  d.dataElement.find(e => e.id === 'DU').data.liveConfirmedBy = 'mc';
  assert.notEqual(E.effectiveAvail(d, 'DU'), 'unchecked');
});

/* ---------------- R10.1 stream R: the status report with a time window ---------------- */
{
  const SEEDR = require(path.join(ROOT, 'api', 'shared', 'pmoflow-seed.js'));
  const RDAY = '2026-11-17';   // Tue; the week of Mon Nov 16; last week had Veterans Day (Wed Nov 11)
  // a tiny project: one task done before the window, one inside, one problem raised before and still open
  const tiny = () => {
    const w = (id, x) => ({ id, data: Object.assign({ id, projectId: 'tp', title: id, owner: 'a', status: 'idle', start: '2026-11-02', due: '2026-11-30', effortDays: 1 }, x) });
    return {
      calendar: [{ id: 'workspace', data: { id: 'workspace', holidays: [] } }],
      person: [{ id: 'a', data: { id: 'a', name: 'Ann Lee', bu: 'Ops', dayRate: 800 } }, { id: 'b', data: { id: 'b', name: 'Ben Ito', bu: 'IT', dayRate: 800 } }],
      project: [{ id: 'tp', data: { id: 'tp', name: 'Tiny', desc: '', target: '2026-12-31', owner: 'a', processes: [], createdAt: '2026-11-02' } }],
      process: [], dataElement: [], testRun: [], approval: [], risk: [],
      workItem: [
        w('before', { status: 'done', doneAt: '2026-11-06', createdAt: '2026-11-02' }),
        w('inside', { status: 'done', doneAt: '2026-11-13', createdAt: '2026-11-02', time: [{ by: 'a', date: '2026-11-13', hours: 8 }, { by: 'a', date: '2026-11-06', hours: 4 }] }),
        w('edgeMon', { status: 'done', doneAt: '2026-11-09', createdAt: '2026-11-02' }),
        w('bug', { kind: 'defect', status: 'prog', createdAt: '2026-11-03', owner: 'b', due: '2026-11-20' }),
      ],
    };
  };

  test('R10.1 periodWindow: Mon–Fri weeks, holidays, clamping to the project start, presets', () => {
    const d = tiny();
    let w = E.periodWindow(d, 'tp', { preset: 'this-week' }, RDAY);
    assert.deepEqual([w.from, w.to, w.label, w.partial, w.short], ['2026-11-16', '2026-11-17', 'Week of Mon Nov 16 – Fri Nov 20', true, 'week of Nov 16']);
    w = E.periodWindow(d, 'tp', { preset: 'last-week' }, RDAY);
    assert.deepEqual([w.from, w.to, w.label, w.days], ['2026-11-09', '2026-11-13', 'Week of Mon Nov 9 – Fri Nov 13', 4], 'Veterans Day is not a business day');
    // a week whose Friday is a holiday ends on Thursday; a Monday holiday starts it on Tuesday
    w = E.periodWindow(d, 'tp', { preset: 'last-week' }, '2026-12-29');
    assert.deepEqual([w.from, w.to], ['2026-12-21', '2026-12-24'], 'Christmas Day (Fri) closes the week on Thu');
    w = E.periodWindow(d, 'tp', { preset: 'this-week' }, '2027-01-20');
    assert.equal(w.from, '2027-01-19', 'MLK Day (Mon Jan 18) opens the week on Tue');
    // clamped to the project start
    w = E.periodWindow(d, 'tp', { preset: 'this-month' }, '2026-11-04');
    assert.deepEqual([w.from, w.to, w.clamped], ['2026-11-02', '2026-11-04', false]);
    w = E.periodWindow(d, 'tp', { from: '2026-10-01', to: '2026-11-04' }, RDAY);
    assert.deepEqual([w.preset, w.from, w.to, w.clamped], ['custom', '2026-11-02', '2026-11-04', true]);
    // to never passes today; whole project starts at the project start
    w = E.periodWindow(d, 'tp', { preset: 'custom', from: '2026-11-10', to: '2026-12-31' }, RDAY);
    assert.equal(w.to, RDAY);
    assert.equal(E.periodWindow(d, 'tp', { preset: 'whole-project' }, RDAY).from, '2026-11-02');
    // since last report: no report yet -> this week, honestly noted; with one -> the day after it
    w = E.periodWindow(d, 'tp', { preset: 'since-last-report' }, RDAY);
    assert.equal(w.preset, 'this-week'); assert.match(w.note, /No earlier report/);
    d.project[0].data.reportLog = [{ date: '2026-11-12' }];
    w = E.periodWindow(d, 'tp', { preset: 'since-last-report' }, RDAY);
    assert.deepEqual([w.preset, w.from, w.to], ['since-last-report', '2026-11-13', RDAY]);
  });

  test('R10.1 periodReport: window filtering, edge dates, a blocker opened before the window', () => {
    const d = tiny();
    const p = E.periodReport(d, 'tp', { preset: 'last-week' }, RDAY);
    assert.deepEqual(p.completed.map(x => x.id), ['edgeMon', 'inside'], 'Mon and Fri are inside; a task finished before the window is not');
    assert.equal(p.completed.some(x => x.id === 'before'), false);
    assert.equal(p.spendInPeriod, 800, 'only hours logged inside the window');
    // the problem was raised on Nov 3 and is still open: open at the end, not raised in the window
    assert.equal(p.blockersRaised.length, 0);
    assert.deepEqual(p.blockersOpenAtEnd.map(b => [b.id, b.daysOpen]), [['work:bug', 7]], 'Nov 3 → Nov 13 is 7 business days (Veterans Day skipped)');
    const wk1 = E.periodReport(d, 'tp', { from: '2026-11-02', to: '2026-11-06' }, RDAY);
    assert.deepEqual(wk1.blockersRaised.map(b => b.id), ['work:bug']);
    assert.deepEqual(wk1.completed.map(x => x.id), ['before']);
    // undated facts fall back to history events, never guessed
    delete d.workItem[3].data.createdAt;
    assert.equal(E.periodReport(d, 'tp', { from: '2026-11-02', to: '2026-11-06' }, RDAY).blockersRaised.length, 0, 'no date: left out');
    const ev = [{ at: '2026-11-04T15:00:00.000Z', ref: 'workItem:bug', action: 'create' }];
    assert.deepEqual(E.periodReport(d, 'tp', { from: '2026-11-02', to: '2026-11-06' }, RDAY, { events: ev }).blockersRaised.map(b => b.date), ['2026-11-04']);
    // no description and no purpose: the report asks for one instead of inventing it
    assert.equal(p.overall.needsPurpose, true);
    // the "behind" list as the window ended in the past: a task finished after it is open again
    d.workItem.push({ id: 'late1', data: { id: 'late1', projectId: 'tp', title: 'late1', owner: 'a', status: 'done', doneAt: '2026-11-16', start: '2026-11-02', due: '2026-11-11', effortDays: 1, createdAt: '2026-11-02' } });
    const lw = E.periodReport(d, 'tp', { preset: 'last-week' }, RDAY);
    assert.deepEqual(lw.behindAtEnd.map(x => [x.id, x.split]), [['late1', 'past-due']]);
    assert.equal(lw.behindText, '1 late (1 past due)');
  });

  test('R10.1 periodReport: the slip from forecast snapshots, a baseline, or "not tracked"', () => {
    const d = tiny();
    let p = E.periodReport(d, 'tp', { preset: 'this-week' }, RDAY);
    assert.equal(p.slipDays, null); assert.equal(p.forecastFinishThenSource, 'not-tracked'); assert.match(p.slipText, /not tracked/);
    const now = p.forecastFinishNow;
    d.project[0].data.baselines = [{ id: 'bl', at: '2026-11-02T16:00:00Z', label: 'Kickoff plan', items: { inside: { due: E.addBusinessDays(now, -4) } } }];
    p = E.periodReport(d, 'tp', { preset: 'this-week' }, RDAY);
    assert.deepEqual([p.forecastFinishThenSource, p.slipDays], ['baseline', 4]);
    assert.match(p.slipText, /4 business days later than the “Kickoff plan” plan/);
    d.project[0].data.forecastLog = [{ date: '2026-11-13', finish: E.addBusinessDays(now, -3) }, { date: '2026-11-16', finish: now }];
    p = E.periodReport(d, 'tp', { preset: 'this-week' }, RDAY);
    assert.deepEqual([p.forecastFinishThenSource, p.forecastFinishThen, p.forecastFinishEnd, p.slipDays], ['snapshot', E.addBusinessDays(now, -3), now, 3]);
    assert.match(p.slipText, /^Expected finish moved 3 business days later this week/);
  });

  test('R10.1 areasOfConcern groups late and blocked tasks by category, step and team', () => {
    const d = SEEDR.seed(RDAY).docs;
    const c = E.periodReport(d, PRJ, { preset: 'this-week' }, RDAY).overall.concerns;
    assert.deepEqual(c.map(x => [x.dimension, x.key, x.count, x.of]),
      [['category', 'Banking', 4, 5], ['step', 'vendor-onboarding/s3', 3, 5], ['team', 'IT', 2, 5]]);
    assert.equal(c[0].text, 'Banking (risk area): 4 of the 5 tasks late or held up');   /* R16 N1 #10: the header's unit ("tasks late or held up") */
    // fewer than two late or blocked tasks: no areas of concern
    assert.deepEqual(E.periodReport(tiny(), 'tp', { preset: 'this-week' }, RDAY).overall.concerns, []);
  });

  test('R10.1 plan changes proposed or applied in the window (hand-made planChange docs)', () => {
    const d = tiny();
    d.planChange = [
      { id: 'pc1', data: { id: 'pc1', projectId: 'tp', title: 'Moved go-live', reason: 'dependency slipped', category: 'schedule', requestedBy: 'a', at: '2026-11-10T10:00:00Z',
        status: 'applied', decidedBy: 'b', decidedAt: '2026-11-11T10:00:00Z', appliedAt: '2026-11-16T09:00:00Z', edits: [], impact: { forecastBefore: '2026-12-01', forecastAfter: '2026-12-04', deadlineEffect: 3 } } },
      { id: 'pc2', data: { id: 'pc2', projectId: 'tp', title: 'Add a training task', status: 'proposed', at: '2026-11-17T09:00:00Z', impact: {} } },
      { id: 'pc3', data: { id: 'pc3', projectId: 'other', title: 'Not ours', status: 'proposed', at: '2026-11-17T09:00:00Z' } },
      { id: 'pc4', data: { id: 'pc4', projectId: 'tp', title: 'Old', status: 'rejected', at: '2026-11-02T09:00:00Z' } },
    ];
    const p = E.periodReport(d, 'tp', { preset: 'this-week' }, RDAY);
    assert.deepEqual(p.planChanges.map(c => [c.id, c.event, c.shiftDays]), [['pc1', 'applied', 3], ['pc2', 'proposed', null]]);
    assert.equal(p.planChanges[0].text, 'Moved go-live (expected finish 3 business days later; dependency slipped; approved by Ben Ito)');
    assert.equal(p.planChanges[1].text, 'Add a training task (waiting for a decision)');
    assert.deepEqual(E.periodReport(d, 'tp', { preset: 'last-week' }, RDAY).planChanges.map(c => c.id), ['pc1'], 'proposed last week');
    // the doc type may not exist yet
    delete d.planChange;
    assert.deepEqual(E.periodReport(d, 'tp', { preset: 'this-week' }, RDAY).planChanges, []);
  });

  test('R10.1 golden period values for Vendor Onboarding Modernization (GOLDEN-NUMBERS.md)', () => {
    const d = SEEDR.seed(RDAY).docs;
    const t = E.projectTruth(d, PRJ, RDAY);
    const ids = a => a.map(x => x.id);
    const tw = E.periodReport(d, PRJ, { preset: 'this-week' }, RDAY);
    assert.equal(tw.window.label, 'Week of Mon Nov 16 – Fri Nov 20');
    assert.deepEqual([ids(tw.completed), ids(tw.assigned), ids(tw.started)], [[], ['W12'], ['W12', 'W8']]);
    assert.deepEqual([ids(tw.blockersRaised), ids(tw.blockersResolved), tw.blockersOpenAtEnd.map(b => [b.id, b.daysOpen])], [['work:W12'], [], [['data:D2', 21], ['work:W12', 1]]]);
    assert.deepEqual([tw.behindAtEnd.length, tw.behindText, tw.testsRun.passed, tw.testsRun.failed], [5, '5 late (1 past due, 4 will finish after their due date)', 12, 1]);   // R14: only ledger tests
    assert.deepEqual([tw.approvalsGiven.map(a => a.bu), ids(tw.risksOpened), ids(tw.risksClosed), tw.spendInPeriod], [['Procurement'], ['R3'], [], 4350]);
    assert.deepEqual([tw.forecastFinishThen, tw.forecastFinishNow, tw.slipDays], ['2026-12-07', '2026-12-09', 2]);
    // consistency: the window ends today, so "behind" is exactly the project screen's late list
    assert.deepEqual(ids(tw.behindAtEnd).sort(), t.late.slice().sort());
    assert.equal(tw.behindText, t.lateText);
    assert.deepEqual(tw.blockersOpenAtEnd.filter(b => b.kind === 'information').map(b => b.dataId), t.blockers.map(b => b.dataId));
    const lw = E.periodReport(d, PRJ, { preset: 'last-week' }, RDAY);
    assert.equal(lw.window.label, 'Week of Mon Nov 9 – Fri Nov 13');
    assert.deepEqual([ids(lw.completed), ids(lw.assigned), ids(lw.started)], [['W3', 'W9', 'W5'], ['W11'], []]);
    assert.deepEqual([ids(lw.blockersRaised), ids(lw.blockersResolved), lw.blockersOpenAtEnd.map(b => [b.id, b.daysOpen])], [[], ['data:D5'], [['data:D2', 19]]]);
    assert.deepEqual([lw.behindAtEnd.length, lw.behindText, lw.testsRun.passed, lw.testsRun.failed], [4, '4 late (4 will finish after their due date)', 4, 0]);
    assert.deepEqual([lw.approvalsGiven.length, ids(lw.risksOpened), ids(lw.risksClosed), lw.spendInPeriod], [0, [], ['R1'], 2468.75]);
    assert.deepEqual([lw.forecastFinishThen, lw.forecastFinishEnd, lw.slipDays], ['2026-12-04', '2026-12-07', 1]);
    assert.equal(tw.compare.text, '0 done this week vs 3 the week before');
    // overall is projectTruth as of today
    assert.deepEqual([tw.overall.label, tw.overall.lateText, tw.overall.budget.overBudget, tw.overall.budget.forecast], [t.label, t.lateText, true, 48847.12]);
    assert.match(tw.overall.budget.text, /^Higher budget need expected/);
    // since last report (Fri Nov 13) covers Mon Nov 16 to today
    const sl = E.periodReport(d, PRJ, { preset: 'since-last-report' }, RDAY);
    assert.deepEqual([sl.from, sl.to], ['2026-11-16', RDAY]);
  });
}

/* ================================ Round 12 (H1) ================================ */
// Karen's repro: a pasted procedure whose roles are Purchasing, Credit, AP and Treasury. "Who does it" stores the
// role as ownerRole and writes the process owner (Maya, Procurement) into owner as a fallback.
function karenDocs(mapping) {
  const d = SEED.seed(GOLD_DAY).docs;
  const st = (id, title, role, touches) => ({ id, type: 'step', title, owner: 'mc', ownerRole: role, touches, data: [] });
  const tobe = [
    st('k1', 'Request a new vendor', 'Purchasing mgr', ['Purchasing']),
    st('k2', 'Run the credit check', 'Credit dept', ['Credit', 'D&B']),
    st('k3', 'Set up the vendor in the ERP', 'AP clerk', ['AP', 'ERP']),
    st('k4', 'Pay the vendor', 'AP clerk', ['AP'], ),
    st('k5', 'Verify the bank account', 'Treasury analyst', ['Treasury']),
  ];
  tobe[3].sla = '2 business days';
  const proc = { id: 'kp', name: 'Karen vendor setup', owner: 'mc', asis: [], tobe };
  if (mapping) proc.teamDepartments = mapping;
  d.process.push({ id: 'kp', data: proc });
  d.project.push({ id: 'kprj', data: { id: 'kprj', name: 'Karen rollout', owner: 'ta', processes: ['kp'], status: 'active', target: E.addBusinessDays(GOLD_DAY, 40) } });
  return d;
}

test('R12 #1 routing: a role step is routed by its role\'s team, never the process owner\'s department', () => {
  const d = karenDocs();
  const kp = d.process.find(p => p.id === 'kp').data;
  assert.deepEqual(kp.tobe.map(n => E.stepTeams(d, kp, n)), [['Purchasing'], ['Credit'], ['AP'], ['AP'], ['Treasury']]);
  assert.equal(E.departmentFor(d, kp, 'AP'), 'Accounts Payable');
  assert.equal(E.departmentFor(d, kp, 'Purchasing'), null, 'no default team');
  const t = E.projectTruth(d, 'kprj', GOLD_DAY);
  assert.ok(!t.approvals.some(a => a.bu === 'Procurement'), 'Procurement is never asked by default: ' + JSON.stringify(t.approvals.map(a => a.bu)));
  assert.deepEqual(t.approvals.map(a => a.bu), ['Accounts Payable', 'Treasury']);
  assert.deepEqual(t.routing.unmapped.map(x => x.text), ['Choose who approves for Purchasing', 'Choose who approves for Credit']);
  const ck = E.readiness(d, 'kprj', GOLD_DAY).checks.find(c => c.id === 'bu-signoff');
  assert.equal(ck.pass, false);
  assert.match(ck.detail, /^Choose who approves for Purchasing \(“Request a new vendor”\)\. Choose who approves for Credit/);
  // the doer of a role step is never the fallback owner
  assert.deepEqual(E.stepDoer(d, kp.tobe[1]), { owner: null, role: 'Credit dept', text: 'Needs an owner: Credit dept' });
  assert.equal(E.stepDoer(d, { owner: 'ar' }).text, 'Ana Ruiz');
});

test('R12 #1 routing: the mapping is seeded at import with no default, editable, and drives approvals', () => {
  const d = karenDocs();
  const kp = d.process.find(p => p.id === 'kp').data;
  assert.deepEqual(E.seedTeamDepartments(d, kp.tobe), { Purchasing: null, Credit: null, AP: 'Accounts Payable', Treasury: 'Treasury' });
  const r = E.teamRouting(d, kp);
  assert.deepEqual(r.teams.map(x => x.text), ['Choose who approves for Purchasing', 'Choose who approves for Credit', 'AP → Accounts Payable', 'Treasury']);
  assert.equal(r.text, '4 teams · 2 need an approving department');
  assert.ok(r.departments.some(x => x.name === 'Procurement' && x.people.some(p => p.id === 'rv')));
  const d2 = karenDocs({ Purchasing: 'Procurement', Credit: 'Treasury', AP: 'Accounts Payable', Treasury: 'Treasury' });
  const t = E.projectTruth(d2, 'kprj', GOLD_DAY);
  assert.deepEqual(t.approvals.map(a => a.bu), ['Accounts Payable', 'Procurement', 'Treasury']);
  assert.deepEqual(t.routing.unmapped, []);
  assert.equal(E.teamRouting(d2, 'kp').text, 'All 4 teams have an approving department');
  // the process owner is not a step owner, so she may approve Procurement's part
  assert.equal(E.approvalBar(d2, 'kprj', 'Procurement', 'mc'), null);
});

test('R12 #1 re-approval: an AP-only edit reopens only AP, and says from → to', () => {
  const d = karenDocs({ Purchasing: 'Procurement', Credit: 'Treasury', AP: 'Accounts Payable', Treasury: 'Treasury' });
  const at = '2026-11-17T15:00:00Z';
  [['Accounts Payable', 'nb'], ['Procurement', 'rv'], ['Treasury', 'gw']].forEach(([bu, who], i) => d.approval.push({ id: 'KA' + i, data: {
    id: 'KA' + i, projectId: 'kprj', bu, approver: who, decision: 'approved', stepUp: true, at, fingerprint: E.sectionFingerprint(d, 'kprj', bu) } }));
  let ck = E.readiness(d, 'kprj', GOLD_DAY).checks.find(c => c.id === 'bu-signoff');
  assert.deepEqual(ck.stale, []);
  const kp = d.process.find(p => p.id === 'kp').data;
  kp.tobe[3].sla = '1 business day';
  kp.tobe[2].title = 'Create the vendor in the ERP';
  ck = E.readiness(d, 'kprj', GOLD_DAY).checks.find(c => c.id === 'bu-signoff');
  assert.deepEqual(ck.stale.map(x => x.bu), ['Accounts Payable'], 'Procurement and Treasury stay approved');
  assert.deepEqual(ck.stale[0].details.map(x => x.label),
    ['“Set up the vendor in the ERP” → “Create the vendor in the ERP”', '“Pay the vendor” time limit 2 business days → 1 business day']);
  assert.ok(!/section:|#s:|kprj|kp\//.test(ck.detail + ck.stale[0].text), 'no internal ids in text: ' + ck.detail);
});

test('R12 #6 ownership: role steps never fall back to the PM or process owner, on the plan, who and Tell teams', () => {
  const d = karenDocs({ Purchasing: 'Procurement' });
  const sug = E.suggestWorkFromDiff(d, 'kprj', GOLD_DAY);
  const step = sug.filter(s => s.step);
  assert.ok(step.length >= 5);
  assert.ok(step.every(s => s.owner === null), JSON.stringify(step.map(s => [s.title, s.owner])));
  assert.deepEqual(step.map(s => s.note), ['Needs an owner: Purchasing mgr.', 'Needs an owner: Credit dept.', 'Needs an owner: AP clerk.', 'Needs an owner: AP clerk.', 'Needs an owner: Treasury analyst.']);
  const tell = sug.find(s => s.tag === 'tell');
  assert.deepEqual(tell.teams, ['Procurement', 'Credit', 'Accounts Payable', 'Treasury'], 'departments, plus unmapped teams by name; never the owner\'s department');
  // after Accept, who and the owner text agree with the Work tab ("Needs an owner")
  const d2 = E.withPlan(d, 'kprj', sug);
  const who = E.projectTruth(d2, 'kprj', GOLD_DAY).who;
  assert.ok(!who.some(x => x.person === 'mc' && /^work:/.test(x.ref || '')), 'no task under Maya');
  const w = d2.workItem.find(x => x.data.projectId === 'kprj' && x.data.ownerRole === 'Credit dept').data;
  assert.equal(E.ownerText(d2, w), 'Needs an owner: Credit dept');
  who.filter(x => /^work:/.test(x.ref || '') && !x.person).forEach(x => assert.match(x.name, /^Needs an owner/));
  // the information a role step uses is owned by the role, not the process owner
  const kp = d.process.find(p => p.id === 'kp').data; kp.tobe[1].data = ['D5'];
  assert.notEqual(E.dataOwner(d, 'D5') && E.dataOwner(d, 'D5').owner, 'mc');
});

test('R12 #2 seeded history obeys separation of duties and records the real approver', () => {
  const s = SEED.seed(GOLD_DAY);
  const appr = s.docs.approval.map(x => x.data).filter(a => a.bu && !a.kind);
  const approveEvents = s.events.filter(e => e.action === 'approve' && /^approval:/.test(e.ref));
  assert.equal(approveEvents.length, appr.length);
  approveEvents.forEach(e => {
    const a = appr.find(x => 'approval:' + x.id === e.ref);
    assert.equal(e.actor, a.approver, e.summary + ': history names the approver on the card');
    assert.equal(E.approvalBar(s.docs, a.projectId, a.bu, e.actor), null, e.summary + ' is a sign-off the rule allows');
  });
  // grants are approved by the information owner (never the requester)
  s.docs.grant.map(x => x.data).filter(g => g.approvedBy).forEach(g => assert.equal(g.approvedBy, E.grantApproverOf(s.docs, g), g.id));
});

test('R12 #7 access: one status per row, the information owner approves, never over 30 days, the same day in history', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const g = id => d.grant.find(x => x.id === id).data;
  // pages call grantView with docs first (eng() prepends docs); that must not read every row as Closed
  assert.deepEqual(['G1', 'G2', 'G3'].map(id => E.grantView(d, g(id), GOLD_DAY, 360).state), ['open', 'waiting', 'closed']);
  assert.deepEqual(['G1', 'G2', 'G3'].map(id => E.grantView(g(id), GOLD_DAY, 360).state), ['open', 'waiting', 'closed']);
  assert.equal(E.grantView(d, g('G2'), GOLD_DAY, 360).text, 'Waiting for Leo Park');
  assert.equal(E.grantApproverOf(d, g('G2')), 'lp');
  const launch = E.projectTruth(d, PRJ, GOLD_DAY).launchSteps.find(s => s.key === 'launch');
  assert.deepEqual(launch.who, ['lp'], 'the launch step names the same approver as the table');
  d.grant.forEach(x => { const v = E.grantView(x.data, GOLD_DAY, 360); assert.ok(v.days == null || v.days <= 30, x.id + ' ' + v.days); });
  const v3 = E.grantView(g('G3'), GOLD_DAY, 360), exp = g('G3').log.find(l => l.action === 'expired');
  assert.equal(v3.closedOn, E.localDay(exp.at, 360), 'Ends and History give the same local day');
  const c = E.grantCounts(d, PRJ, GOLD_DAY);
  assert.deepEqual([c.open, c.waiting, c.closed], [1, 1, 1]);
});

test('R12 #10 launch-day plan: every step on a business day and inside the window, or the plan is not ready', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const prj = d.project.find(p => p.id === PRJ).data;
  assert.equal(E.launchPlanCheck(d, PRJ).ok, true, E.launchPlanCheck(d, PRJ).text);
  assert.deepEqual(E.projectTruth(d, PRJ, GOLD_DAY).launchPlan.problems, []);
  // the BPM expert's repro: one step on Christmas, one outside the window
  prj.cutover.tasks[1].plannedStart = '2026-12-25T08:00';
  prj.cutover.tasks[2].plannedStart = prj.cutover.tasks[2].plannedStart.slice(0, 10) + 'T13:00';
  const lp = E.launchPlanCheck(d, PRJ);
  assert.equal(lp.ok, false);
  assert.deepEqual(lp.problems.map(x => [x.taskId, x.why]), [['VT2', 'day-off'], ['VT3', 'outside-window']]);
  assert.equal(lp.problems[0].text, '“Final check with Treasury and Compliance” is set for Fri Dec 25, Christmas Day: pick a business day');
  assert.match(lp.problems[1].text, /^“Switch vendor intake to the portal” is set for [A-Z][a-z]{2} [A-Z][a-z]{2} \d+, 1:00 PM, outside the launch window \([A-Z][a-z]{2} [A-Z][a-z]{2} \d+, 7:30 AM–10:00 AM\)$/);
  const ck = E.readiness(d, PRJ, GOLD_DAY).checks.find(c => c.id === 'cutover-plan');
  assert.equal(ck.pass, false);
  assert.match(ck.detail, /^2 launch-day steps need a new time: /);
  assert.equal(E.projectTruth(d, PRJ, GOLD_DAY).launchSteps.find(s => s.key === 'launch-plan').done, false, 'never "Ready"');
});

test('R12 #4 canPassTest: the assignee, else the department that owns the test\'s part', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  assert.deepEqual(E.testDepartments(d, PRJ, 'TC11'), ['Compliance']);
  assert.equal(E.canPassTest(d, PRJ, 'TC11', 'ps'), null);
  assert.equal(E.canPassTest(d, PRJ, 'TC11', 'ar').rule, 'department');
  d.testCase.find(x => x.id === 'TC11').data.tester = 'ar';
  assert.equal(E.canPassTest(d, PRJ, 'TC11', 'ar'), null);
  assert.deepEqual(E.canPassTest(d, PRJ, 'TC11', 'ps'), { rule: 'assignee', text: 'The test “Sanctions screening result: Match status” is assigned to Ana Ruiz, so only they can pass it.' });
});

test('R12 (H4 ask) defectState: a defect In review (inbound Jira/ADO Done) is fixed, awaiting a passing retest', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const w12 = d.workItem.find(x => x.id === 'W12').data;
  delete w12.defectStatus; w12.status = 'review';
  assert.equal(E.defectState(d, 'W12'), 'fixed');
  assert.ok(!E.heldTests(d, PRJ).TC4, 'no longer held by an open problem');
  assert.notEqual(E.projectTruth(d, PRJ, GOLD_DAY).testing.status.TC4, 'passed', 'still needs a passing retest');
});

test('R12 (H2 ask) stepTeams: a person\'s name and generic actors are never teams that need an approving department', () => {
  const d = karenDocs({ Purchasing: 'Procurement', Credit: 'Treasury' });
  const kp = d.process.find(p => p.id === 'kp').data;
  // Karen's SOP wording: "The Requester submits the request", "if spend over $25k Karen approves too", "Sam Wu signs off",
  // "Ana Ruiz sets up the vendor" (a workspace person), "The vendor sends bank details", "Employee", "Applicant"
  const st = (id, title, role) => ({ id, type: 'step', title, owner: 'mc', ownerRole: role, touches: [], data: [] });
  kp.tobe.push(st('r1', 'Submit the request', 'Requester'), st('r2', 'Approve spend over $25k', 'Karen'), st('r3', 'Sign off', 'Sam Wu'),
    st('r4', 'Set up the vendor record', 'Ana Ruiz'), st('r5', 'Send bank details', 'Vendor'), st('r6', 'File the claim', 'Employee'), st('r7', 'Apply', 'Applicant'),
    st('r8', 'Upload the W-9', 'Customer/Vendor'));
  assert.deepEqual(kp.tobe.slice(5).map(n => E.stepTeams(d, kp, n)), [[], [], [], ['Accounts Payable'], [], [], [], []]);
  const r = E.teamRouting(d, kp);
  assert.ok(!r.teams.some(x => /Karen|Requester|Sam|Vendor|Employee|Applicant|Customer/.test(x.team)), JSON.stringify(r.teams.map(x => x.text)));
  assert.deepEqual(r.unmapped, []);
  assert.deepEqual(Object.keys(E.seedTeamDepartments(d, kp.tobe)), ['Purchasing', 'Credit', 'AP', 'Treasury']);
  // the step of a workspace person named in "Who does it" is that person's
  assert.equal(E.stepDoer(d, kp.tobe[8]).owner, 'ar');
  assert.deepEqual(E.projectTruth(d, 'kprj', GOLD_DAY).routing.unmapped, []);
});

test('R12 #11 profiling: shared bank account, near-duplicate names, whitespace; observed valid shapes never rejected; uniqueness tests', () => {
  const csv = ['Vendor name,Tax ID,Account number',
    'Acme Supply Inc,12-3456789,000123456789',
    'ACME Supply,12-3456789,000123456789',
    ' Northwind Parts ,98-7654321,000123456789',
    'Contoso  Ltd,45-1112223,000987654321',
    'ABC,45-1112224,000555666777'].join('\n');
  const prof = E.profileCsv(csv);
  const col = n => prof.find(c => c.name === n);
  assert.deepEqual([col('Account number').sharedAccount.accounts, col('Account number').sharedAccount.records], [1, 3]);
  assert.match(col('Account number').sharedAccount.text, /One account number is on 3 records/);   // R14 wording
  assert.deepEqual([col('Vendor name').nearDuplicates.groups, col('Vendor name').nearDuplicates.records], [1, 2]);
  assert.deepEqual(col('Vendor name').whitespace, { count: 2, firstRow: 3 });
  assert.ok(!JSON.stringify(prof).includes('000123456789') && !JSON.stringify(prof).includes('Acme'), 'no values kept');
  const de = { id: 'DV', name: 'Vendors', fields: [{ name: 'Vendor name', type: 'text', required: true, maxLen: 60 }, { name: 'Tax ID', format: '##-#######', type: 'text', unique: true }, { name: 'Account number', type: 'digits', minLen: 4, maxLen: 17 }] };
  const lines = E.profileLines(de, { rows: 5, columns: E.profileCsv(csv, { dataElement: de }) });
  assert.match(lines.find(l => l.field === 'Account number').text, /One account number is on 3 records/);
  assert.match(lines.find(l => l.field === 'Vendor name').text, /2 have extra spaces, 2 look like duplicates/);
  const tests = E.generateTests(de, E.profileCsv(csv, { dataElement: de }), { all: true });
  // the observed valid short name ("ABC" shape) is never a "should be rejected" test
  assert.ok(!tests.some(t => t.field === 'Vendor name' && t.origin === 'profile' && /Observed shape/.test(t.note) && t.expect === 'reject'), JSON.stringify(tests.filter(t => t.field === 'Vendor name')));
  // duplicate warnings become uniqueness tests
  assert.ok(tests.some(t => t.field === 'Tax ID' && t.expect === 'reject' && /Same value as another record/.test(t.note)));
  assert.ok(tests.some(t => t.field === 'Account number' && t.expect === 'reject' && /Same bank account number as another vendor \(3 records share 1 account number/.test(t.note)));
});

/* ================================ Round 13 (K1): close the R12 review findings ================================ */
const wsSettings = d => d.workspace.find(x => x.id === 'settings').data;
const withDepts = (d, depts) => Object.assign({}, d, { workspace: d.workspace.filter(x => x.id !== 'settings').concat([{ id: 'settings', data: Object.assign({}, wsSettings(d), { departments: depts }) }]) });

test('R13 #1 departments are workspace data: the seeded six are ordinary entries with named approvers', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const ds = E.departments(d);
  assert.deepEqual(ds.map(x => [x.name, x.approvers.join(','), x.configured]),
    [['Accounts Payable', 'nb', true], ['Compliance', 'do', true], ['IT', 'sk', true], ['PMO', '', true], ['Procurement', 'rv', true], ['Treasury', 'gw', true]]);
  assert.deepEqual(ds.find(x => x.name === 'Compliance').people.map(p => p.id).sort(), ['do', 'ps']);
  assert.deepEqual(ds.find(x => x.name === 'Compliance').approverNames, ['Dave Ortiz']);
  // the pick list on the process/import pages is the same list
  assert.deepEqual(E.teamRouting(d, 'vendor-onboarding').departments.map(x => x.name), ds.map(x => x.name));
  // without a configured list (old sandboxes) the list is derived from person.bu
  const old = Object.assign({}, d, { workspace: [] });
  assert.ok(E.departments(old).every(x => !x.configured) && E.departments(old).some(x => x.name === 'PMO'));
});

test('R13 #1 departmentEdit: add, rename (rewrites people, routing and overrides), approvers, assign, remove', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const apply = (d, r) => {
    const put = (type, patches, key) => { const out = d[type].map(e => { const p = patches.find(x => x.id === e.id); return p ? { id: e.id, data: Object.assign({}, e.data, p) } : e; }); return out; };
    return Object.assign({}, withDepts(d, r.departments), { person: put('person', r.people), process: put('process', r.processes), project: put('project', r.projects) });
  };
  assert.equal(E.departmentEdit(d0, { kind: 'add', name: '  ' }).error, 'Name a department.');
  assert.equal(E.departmentEdit(d0, { kind: 'add', name: 'compliance' }).error, 'A department called Compliance already exists.');
  assert.equal(E.departmentEdit(d0, { kind: 'add', name: 'AP' }).error, 'A department called Accounts Payable already exists.');
  let r = E.departmentEdit(d0, { kind: 'add', name: 'Credit', approvers: ['rv'] });
  assert.ok(r.ok, r.error);
  let d = apply(d0, r);
  const credit = E.departments(d).find(x => x.name === 'Credit');
  assert.deepEqual([credit.id, credit.approvers], ['dept-credit', ['rv']]);
  // a team called Credit now routes to it with no mapping
  assert.equal(E.departmentFor(d, 'vendor-onboarding', 'Credit'), 'Credit');
  assert.equal(E.departmentFor(d0, 'vendor-onboarding', 'Credit'), null);
  // assign Ana to Credit, then rename Credit → Credit & Collections: person.bu, teamDepartments values and approvers keys follow
  r = E.departmentEdit(d, { kind: 'assign', personId: 'gw', id: 'dept-credit' }); assert.ok(r.ok); d = apply(d, r);
  assert.equal(d.person.find(p => p.id === 'gw').data.bu, 'Credit');
  const vp = d.process.find(p => p.id === 'vendor-onboarding');
  d = Object.assign({}, d, { process: d.process.map(p => p.id === 'vendor-onboarding' ? { id: p.id, data: Object.assign({}, p.data, { teamDepartments: Object.assign({}, p.data.teamDepartments, { 'Credit dept': 'Credit' }) }) } : p),
    project: d.project.map(p => p.id === PRJ ? { id: p.id, data: Object.assign({}, p.data, { approvers: { Credit: 'rv' } }) } : p) });
  assert.ok(vp);
  r = E.departmentEdit(d, { kind: 'rename', id: 'dept-credit', name: 'Credit & Collections' });
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.people, [{ id: 'gw', bu: 'Credit & Collections' }]);
  assert.equal(r.processes.find(p => p.id === 'vendor-onboarding').teamDepartments['Credit dept'], 'Credit & Collections');
  assert.deepEqual(r.projects.find(p => p.id === PRJ).approvers, { 'Credit & Collections': 'rv' });
  d = apply(d, r);
  assert.equal(E.departments(d).find(x => x.id === 'dept-credit').name, 'Credit & Collections');
  // remove is refused while people are in it, then clears routing and overrides
  assert.equal(E.departmentEdit(d, { kind: 'remove', id: 'dept-credit' }).error, 'Move the 1 person in Credit & Collections to another department first.');
  r = E.departmentEdit(d, { kind: 'assign', personId: 'gw', id: 'dept-treasury' }); d = apply(d, r);
  r = E.departmentEdit(d, { kind: 'remove', id: 'dept-credit' });
  assert.ok(r.ok, r.error);
  assert.equal(r.processes.find(p => p.id === 'vendor-onboarding').teamDepartments['Credit dept'], null);
  assert.deepEqual(r.projects.find(p => p.id === PRJ).approvers, {});
  assert.ok(!r.departments.some(x => x.id === 'dept-credit'));
  // approvers must be real people
  assert.equal(E.departmentEdit(d, { kind: 'approvers', id: 'dept-it', approvers: ['nobody'] }).error, 'Choose approvers from the people in this workspace.');
  assert.deepEqual(E.departmentEdit(d, { kind: 'approvers', id: 'dept-it', approvers: ['sk', 'dk'] }).departments.find(x => x.id === 'dept-it').approvers, ['sk', 'dk']);
});

test('R13 #1 approvals route to a custom department and only its named approvers may approve', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  // Compliance's named approver is Dave; with Priya named instead (she recorded its tests), nobody eligible is left
  const t0 = E.projectTruth(d0, PRJ, GOLD_DAY).approvals.find(a => a.bu === 'Compliance');
  assert.deepEqual(t0.eligible, ['do']);
  const ds = wsSettings(d0).departments.map(x => x.name === 'Compliance' ? Object.assign({}, x, { approvers: ['ps'] }) : x);
  const d1 = withDepts(d0, ds);
  d1.project = d1.project.map(p => p.id === PRJ ? { id: p.id, data: Object.assign({}, p.data, { approvers: {} }) } : p);
  const t1 = E.projectTruth(d1, PRJ, GOLD_DAY).approvals.find(a => a.bu === 'Compliance');
  assert.deepEqual([t1.eligible, t1.blockedBy && t1.blockedBy.rule], [[], 'separation-of-duties']);
  // a custom department receives a team's approval
  const d2 = withDepts(d0, wsSettings(d0).departments.concat([{ id: 'dept-credit', name: 'Credit', approvers: ['gw'] }]));
  const proc = d2.process.find(p => p.id === 'vendor-onboarding').data;
  const s1 = proc.tobe.find(n => n.id === 's1');
  assert.deepEqual(E.stepTeams(d2, proc, Object.assign({}, s1, { touches: (s1.touches || []).concat(['Credit']) })).includes('Credit'), true);
});

test('R13 #2 one testing ledger: the report counts each test\'s latest result per stage, never the sum of runs', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const tw0 = E.periodReport(d0, PRJ, { preset: 'this-week' }, GOLD_DAY).testsRun;
  // this week: Try it out TC3–TC6 (3 passed, TC4 failed; R14: TC1–TC2 test information this project doesn't change, so
  // they are not in its ledger), Business check 9 passed; 2 runs
  assert.deepEqual([tw0.stages.system.passed, tw0.stages.system.failed, tw0.stages.uat.passed, tw0.stages.uat.failed, tw0.runs, tw0.tests], [3, 1, 9, 0, 2, 13]);
  assert.equal(tw0.text, 'Business check: 9 tests passed (now 9 of 26 passed). Try it out: 3 passed, 1 failed (now 7 of 8 passed). Latest result of each test, from 2 test runs.');
  // Jordan's repro: re-passing 4 tests already passed raises no count
  const again = { id: 'TR-again', projectId: PRJ, env: 'uat', at: GOLD_DAY + 'T16:00:00.000Z', by: 'ps', results: ['TC11', 'TC12', 'TC13', 'TC14'].map(caseId => ({ caseId, outcome: 'pass' })) };
  const d1 = Object.assign({}, d0, { testRun: d0.testRun.concat([{ id: again.id, data: again }]) });
  const tw1 = E.periodReport(d1, PRJ, { preset: 'this-week' }, GOLD_DAY).testsRun;
  assert.deepEqual([tw1.stages.uat.passed, tw1.runs, tw1.tests], [9, 3, 13]);
  assert.equal(E.projectTruth(d1, PRJ, GOLD_DAY).testing.passed, 9);
  // a later fail of the same test replaces its pass in the period count
  const fail1 = { id: 'TR-fail', projectId: PRJ, env: 'uat', at: GOLD_DAY + 'T17:00:00.000Z', by: 'ps', results: [{ caseId: 'TC11', outcome: 'fail' }] };
  const d2 = Object.assign({}, d1, { testRun: d1.testRun.concat([{ id: fail1.id, data: fail1 }]) });
  const tw2 = E.periodReport(d2, PRJ, { preset: 'this-week' }, GOLD_DAY).testsRun;
  assert.deepEqual([tw2.stages.uat.passed, tw2.stages.uat.failed], [8, 1]);
  // a past window never shows today's ledger
  const lw = E.periodReport(d0, PRJ, { preset: 'last-week' }, GOLD_DAY).testsRun;
  assert.equal(lw.text, 'Try it out: 4 tests passed. Latest result of each test, from 1 test run.');
  assert.equal(lw.ledger, null);
});

test('R13 #2 one ledger: the gate\'s tests count = tests not passed; the approver page says who passed each test', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const t = E.projectTruth(d, PRJ, GOLD_DAY);
  const ck = E.readiness(d, PRJ, GOLD_DAY).checks.find(c => c.id === 'tests-passed');
  // "Tests · Blocking 18" summed item kinds; the gate now shows the ledger's 26 − 9 = 17 tests not passed
  assert.equal(ck.count, t.testing.total - t.testing.passed);
  assert.equal(ck.count, 17);
  const comp = t.testing.perBU.Compliance;
  assert.equal(comp.tests.length, comp.total);
  const p = comp.tests.filter(x => x.status === 'passed');
  assert.equal(p.length, 9);
  assert.ok(p.every(x => x.passedBy === 'ps' && x.passedByName === 'Priya Shah' && x.passedByDept === 'Compliance' && !x.otherDept && x.passedAt), JSON.stringify(p[0]));
  assert.equal(comp.passedByText, 'Passed by Priya Shah (Compliance): 9 tests.');
  // Jordan's repro: Ana (Accounts Payable) passes a Compliance test; Dave's page shows it, flagged as another department
  const id = p[0].id;
  const run = { id: 'TR-ana', projectId: PRJ, env: 'uat', at: GOLD_DAY + 'T18:00:00.000Z', by: 'ar', results: [{ caseId: id, outcome: 'pass' }] };
  const d2 = Object.assign({}, d, { testRun: d.testRun.concat([{ id: run.id, data: run }]) });
  const c2 = E.projectTruth(d2, PRJ, GOLD_DAY).testing.perBU.Compliance;
  const x = c2.tests.find(y => y.id === id);
  assert.deepEqual([x.passedBy, x.passedByDept, x.otherDept], ['ar', 'Accounts Payable', true]);
  assert.equal(c2.passedByText, 'Passed by Priya Shah (Compliance): 8 tests. Passed by Ana Ruiz (Accounts Payable, another department): 1 test.');
});

test('R13 #5/#12 a held inbound item (status review + syncHold) moves no forecast or EV, and goes to syncHold.confirmBy, never the PM', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const hold = (d, id, patch, h) => Object.assign({}, d, { workItem: d.workItem.map(e => e.id === id ? { id, data: Object.assign({}, e.data, patch, { syncHold: h }) } : e) });
  const t0 = E.projectTruth(d0, PRJ, GOLD_DAY);
  // the PMO expert's repro: an out-of-order Done (W7 waits on the open W6) arrives from Jira and is held In review
  const h = { kind: 'order', reason: 'Done in Jira while “Set up the bank details form” is still open', confirmBy: 'dk', tool: 'Jira', key: 'VOM-8', toolStatus: 'Done', by: 'dk', at: GOLD_DAY + 'T15:00:00.000Z' };
  const d1 = hold(d0, 'W7', { status: 'review', progress: 1, pct: 100 }, h);
  const t1 = E.projectTruth(d1, PRJ, GOLD_DAY);
  assert.deepEqual([t1.forecastFinish, t1.lateCount, t1.ev.EV, t1.ev.SPI, t1.ev.CPI, t1.ev.EAC, t1.tasks.done], [t0.forecastFinish, t0.lateCount, t0.ev.EV, t0.ev.SPI, t0.ev.CPI, t0.ev.EAC, t0.tasks.done]);
  // a held problem fix (defect In review, held) does not release its held test
  const d2 = hold(d0, 'W12', { status: 'review' }, Object.assign({}, h, { kind: 'problem', key: 'VOM-12', confirmBy: 'lp' }));
  assert.equal(E.projectTruth(d2, PRJ, GOLD_DAY).testing.waitingForFix, t0.testing.waitingForFix);
  // the confirmer's queue: "Confirm “<task>” finished in Jira"
  const q = E.personQueue(d1, 'dk', GOLD_DAY).find(x => x.kind === 'syncHold');
  assert.ok(q, JSON.stringify(E.personQueue(d1, 'dk', GOLD_DAY).map(x => x.kind)));
  assert.equal(q.title, 'Confirm “Check bank accounts with a small test deposit” finished in Jira');
  assert.equal(q.id, 'W7');
  assert.ok(!E.personQueue(d1, 'ta', GOLD_DAY).some(x => x.kind === 'syncHold'), 'never the PM');
  // no confirmer: "Needs an owner" in who, never the PM
  const d3 = hold(d0, 'W7', { status: 'review' }, Object.assign({}, h, { confirmBy: null }));
  const row = E.projectTruth(d3, PRJ, GOLD_DAY).who.find(x => x.ref === 'hold:W7');
  assert.ok(row && row.person === null && row.needsOwner && /^Needs an owner/.test(row.name), JSON.stringify(row));
  assert.ok(!E.personQueue(d3, 'ta', GOLD_DAY).some(x => x.kind === 'syncHold'));
  // once done, the hold is no longer asked for
  const d4 = hold(d0, 'W7', { status: 'done', doneAt: GOLD_DAY }, h);
  assert.ok(!E.personQueue(d4, 'dk', GOLD_DAY).some(x => x.kind === 'syncHold'));
});

test('R13 #12 a re-approval reaches the approver\'s queue even before the part is ready', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const a = E.projectTruth(d, PRJ, GOLD_DAY).approvals.find(x => x.bu === 'Procurement');
  assert.ok(a.stale && a.approver === 'rv');
  const q = E.personQueue(d, 'rv', GOLD_DAY);
  const it = q.find(x => x.kind === 'approval' && x.id === 'Procurement');
  assert.ok(it, JSON.stringify(q));
  assert.equal(it.title, 'Approve Procurement\'s part again');
});

test('R13 #3 separation of duties: only the owning department or the PM assigns a test; whoever assigned it can\'t pass it', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const comp = E.projectTruth(d0, PRJ, GOLD_DAY).testing.perBU.Compliance.tests.map(x => x.id);
  const tid = comp.find(id => d0.testCase.some(c => c.id === id));
  // Jordan's repro: Ana (Accounts Payable) assigns a Compliance test to herself
  const r = E.canAssignTest(d0, PRJ, tid, 'ar', 'ar');
  assert.equal(r && r.rule, 'department');
  assert.match(r.text, /Only someone in Compliance or the project manager can assign/);
  assert.equal(E.canAssignTest(d0, PRJ, tid, 'ps', 'ps'), null);   // Priya is in Compliance
  assert.equal(E.canAssignTest(d0, PRJ, tid, 'ta', 'ps'), null);   // the PM
  // whoever assigned the test can't pass it (even when it is assigned to them)
  const d1 = Object.assign({}, d0, { testCase: d0.testCase.map(e => e.id === tid ? { id: tid, data: Object.assign({}, e.data, { tester: 'ps', assignedBy: 'ps' }) } : e) });
  assert.equal((E.canPassTest(d1, PRJ, tid, 'ps') || {}).rule, 'assigner');
  const d2 = Object.assign({}, d0, { testCase: d0.testCase.map(e => e.id === tid ? { id: tid, data: Object.assign({}, e.data, { tester: 'ps', assignedBy: 'ta' }) } : e) });
  assert.equal(E.canPassTest(d2, PRJ, tid, 'ps'), null);
});

test('R13 #4 unowned work: never the PM\'s; "N tasks need an owner"; never "On track" while most tasks are unowned', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const prj = { id: 'px', name: 'Expense X', owner: 'mc', releaseManager: 'mc', resources: ['mc'], processes: ['expense-reimbursement'], status: 'active', target: E.addBusinessDays(GOLD_DAY, 40), baselines: [] };
  d.project.push({ id: 'px', data: prj });
  const work = E.planToWork('px', E.suggestWorkFromDiff(d, 'px', GOLD_DAY));
  // Karen's shape: most tasks are role-only (no owner)
  work.forEach((w, i) => { if (i > 0) { w.owner = null; w.ownerRole = 'Buyer'; } d.workItem.push({ id: w.id, data: w }); });
  const t = E.projectTruth(d, 'px', GOLD_DAY);
  assert.notEqual(t.label, 'On track');
  assert.equal(t.label, 'Tasks need owners');
  assert.ok(t.reasons.includes('3 tasks need an owner'), JSON.stringify(t.reasons));
  const row = t.who.find(x => x.why === 'owner');
  assert.ok(row && row.person === null && row.name === 'Needs an owner' && row.what === 'Choose owners for 3 tasks', JSON.stringify(t.who));
  assert.ok(!t.who.some(x => x.person === 'mc' && /Finish|back on schedule/.test(x.what)), JSON.stringify(t.who));
  const ws = t.launchSteps.find(x => x.key === 'work');
  assert.deepEqual(ws.who, []);
  assert.equal(ws.action, '3 tasks still open (3 need an owner)');
  assert.ok(!E.personQueue(d, 'mc', GOLD_DAY).some(x => x.projectId === 'px' && /Finish|owners/.test(x.what)));
  assert.deepEqual(t.unowned.sort(), work.map(w => w.id).sort());
});

test('R13 #6 EV: planned value from the baseline (a slip never raises SPI); added scope cost raises EAC; no expected cost without rates', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const t0 = E.projectTruth(d0, PRJ, GOLD_DAY);
  const setW = (d, id, patch) => Object.assign({}, d, { workItem: d.workItem.map(e => e.id === id ? { id, data: Object.assign({}, e.data, patch) } : e) });
  // the PMO expert's repro: push due dates out; the project now misses its deadline; SPI must not rise
  const w7 = d0.workItem.find(e => e.id === 'W7').data, w8 = d0.workItem.find(e => e.id === 'W8').data;
  let d1 = setW(d0, 'W7', { due: E.addBusinessDays(w7.due, 30) });
  d1 = setW(d1, 'W8', { due: E.addBusinessDays(w8.due, 30) });
  const t1 = E.projectTruth(d1, PRJ, GOLD_DAY);
  assert.ok(t1.ev.SPI <= t0.ev.SPI, JSON.stringify([t0.ev.SPI, t1.ev.SPI]));
  assert.equal(t1.ev.PV, t0.ev.PV, 'planned value comes from the saved plan');
  // a plan change's automatic before/after snapshots are records, never a new baseline
  const prj = d1.project.find(p => p.id === PRJ).data;
  const auto = { id: 'bl-auto', auto: true, changeId: 'chg-x', at: GOLD_DAY + 'T10:00:00.000Z', label: 'After: slip', items: Object.fromEntries(d1.workItem.filter(e => e.data.projectId === PRJ).map(e => [e.id, { start: e.data.start, due: e.data.due }])) };
  const d2 = Object.assign({}, d1, { project: d1.project.map(p => p.id === PRJ ? { id: PRJ, data: Object.assign({}, prj, { baselines: prj.baselines.concat([auto]) }) } : p) });
  assert.equal(E.projectTruth(d2, PRJ, GOLD_DAY).ev.PV, t0.ev.PV);
  // a scope change that adds a licence cost raises the expected cost by at least that much
  const lic = { id: 'W-lic', projectId: PRJ, title: 'Buy the bank-check licence', owner: 'dk', status: 'idle', start: GOLD_DAY, due: E.addBusinessDays(GOLD_DAY, 5), deps: [], effortDays: 1, cost: 12000, kind: 'other' };
  const d3 = Object.assign({}, d0, { workItem: d0.workItem.concat([{ id: lic.id, data: lic }]) });
  const t3 = E.projectTruth(d3, PRJ, GOLD_DAY);
  assert.ok(t3.cost.forecast >= t0.cost.forecast + 12000, JSON.stringify([t0.cost.forecast, t3.cost.forecast]));
  assert.ok(t3.ev.BAC > t0.ev.BAC);
  // Karen: no budget, no rates, no hours: no expected cost at all
  const d4 = SEED.seed(GOLD_DAY).docs;
  d4.project.push({ id: 'px', data: { id: 'px', name: 'No money', owner: 'mc', processes: ['expense-reimbursement'], status: 'active', target: E.addBusinessDays(GOLD_DAY, 40), baselines: [] } });
  E.planToWork('px', E.suggestWorkFromDiff(d4, 'px', GOLD_DAY)).forEach(w => d4.workItem.push({ id: w.id, data: w }));
  const t4 = E.projectTruth(d4, 'px', GOLD_DAY);
  assert.deepEqual([t4.cost.show, t4.cost.forecast, t4.cost.estimate], [false, null, null]);
  const rep = E.periodReport(d4, 'px', { preset: 'this-week' }, GOLD_DAY);
  assert.equal(rep.overall.budget.text, null);
});

test('R13 #7 masking hides names: no first or last letters and no word lengths; digits keep their shape', () => {
  assert.equal(E.maskValue('Acme Supply Inc'), 'Xxxx Xxxx Xxxx');
  assert.equal(E.maskValue('ACME Supply'), 'XXXX Xxxx');
  assert.equal(E.maskValue('12-3456789'), '99-9999999');
  assert.equal(E.maskValue('V001234'), 'X999999');
  const ex = E.profileCsv('Vendor name\nAcme Supply Inc\nContoso Ltd\n')[0].examples;
  assert.ok(ex.every(x => !/[A-Z][a-z]*[a-wyz]/.test(x.replace(/X/g, ''))), JSON.stringify(ex));
});

test('R13 #10 removing a control step: the owning team must approve and is told (Karen: AP\'s bank-letter double-check)', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  // Access Review Automation has no Accounts Payable part; its Today map gains AP's double-check, which the Future drops
  const p = d.process.find(x => x.id === 'access-review').data;
  p.asis = p.asis.concat([{ id: 'apchk', type: 'step', title: 'AP double-checks the bank letter', owner: 'ar', data: [], touches: ['Accounts Payable'] }]);
  const AR = 'access-review-automation';
  const t = E.projectTruth(d, AR, GOLD_DAY);
  assert.ok(t.approvals.some(a => a.bu === 'Accounts Payable'), JSON.stringify(t.approvals.map(a => a.bu)));
  const ck = E.readiness(d, AR, GOLD_DAY).checks.find(c => c.id === 'bu-signoff');
  assert.ok(ck.sections.includes('Accounts Payable'));
  // the plan tells AP
  const prj = d.project.find(x => x.id === AR).data;
  const d2 = Object.assign({}, d, { workItem: d.workItem.filter(e => e.data.projectId !== AR) });
  const plan = E.suggestWorkFromDiff(d2, AR, GOLD_DAY);
  const tell = plan.find(x => x.tag === 'tell');
  assert.ok(tell && tell.teams.includes('Accounts Payable'), JSON.stringify(tell));
  // a "tell-removed" task (K2's delete flow) already tells AP: the plan's tell task doesn't repeat it
  const tr = { id: 'tr1', projectId: AR, title: 'Tell Accounts Payable that “AP double-checks the bank letter” is removed', owner: prj.owner, status: 'idle', tag: 'tell-removed', teams: ['Accounts Payable'], due: GOLD_DAY, start: GOLD_DAY, deps: [] };
  const d3 = Object.assign({}, d2, { workItem: d2.workItem.concat([{ id: tr.id, data: tr }]) });
  const tell3 = E.suggestWorkFromDiff(d3, AR, GOLD_DAY).find(x => x.tag === 'tell');
  assert.ok(!tell3 || !tell3.teams.includes('Accounts Payable'), JSON.stringify(tell3));
});

test('R13 #11 reports: exact-time "since last report", no present-day leakage, stale and repeat approvals marked', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const prj = d0.project.find(p => p.id === PRJ).data;
  // a report sent today at 10:00; a plan change applied at 09:00 (already reported) and one at 11:00 (new)
  const pc = (id, at) => ({ id, data: { id, projectId: PRJ, title: 'Change ' + id, status: 'applied', at, appliedAt: at, decidedBy: 'ta', impact: {} } });
  const d1 = Object.assign({}, d0, { planChange: [pc('c-before', GOLD_DAY + 'T09:00:00.000Z'), pc('c-after', GOLD_DAY + 'T11:00:00.000Z')],
    project: d0.project.map(p => p.id === PRJ ? { id: PRJ, data: Object.assign({}, prj, { lastReportAt: GOLD_DAY + 'T10:00:00.000Z', reportLog: (prj.reportLog || []).concat([{ date: GOLD_DAY, at: GOLD_DAY + 'T10:00:00.000Z' }]) }) } : p) });
  const r = E.periodReport(d1, PRJ, { preset: 'since-last-report', tzOffsetMinutes: 0 }, GOLD_DAY);
  assert.deepEqual(r.planChanges.map(c => c.id), ['c-after']);
  assert.equal(r.window.since, GOLD_DAY + 'T10:00:00.000Z');
  assert.match(r.window.note, /10:00 AM\.$/);   // R14: the viewer's clock, never "UTC"
  assert.ok(!/UTC/.test(E.periodReport(d1, PRJ, { preset: 'since-last-report' }, GOLD_DAY).window.note));
  // a past range reads the plan as it stood then: a change applied later is undone in "behind at the end"
  const w6 = d0.workItem.find(e => e.id === 'W6').data;
  const later = { id: 'c-later', projectId: PRJ, title: 'Slip', status: 'applied', at: GOLD_DAY + 'T09:00:00.000Z', appliedAt: GOLD_DAY + 'T09:00:00.000Z',
    snapshots: { before: { W6: { start: w6.start, due: w6.due, owner: w6.owner } }, after: { W6: { start: w6.start, due: E.addBusinessDays(w6.due, 40), owner: w6.owner } } } };
  const d2 = Object.assign({}, d0, { planChange: [{ id: later.id, data: later }], workItem: d0.workItem.map(e => e.id === 'W6' ? { id: 'W6', data: Object.assign({}, w6, { due: E.addBusinessDays(w6.due, 40) }) } : e) });
  const lw0 = E.periodReport(d0, PRJ, { preset: 'last-week' }, GOLD_DAY), lw2 = E.periodReport(d2, PRJ, { preset: 'last-week' }, GOLD_DAY);
  assert.deepEqual(lw2.behindAtEnd.map(x => [x.id, x.due, x.forecast]), lw0.behindAtEnd.map(x => [x.id, x.due, x.forecast]));
  // approvals: a stale one is marked, a repeat is "again"
  const tw = E.periodReport(d0, PRJ, { preset: 'this-week' }, GOLD_DAY);
  const proc = tw.approvalsGiven.find(a => a.bu === 'Procurement');
  assert.ok(proc.stale, JSON.stringify(proc));
  assert.equal(proc.text, 'Procurement’s part approved by Rosa Vega; changed since, so it must be approved again');
});

test('R13 #11/#13 re-approvals counted per team; the launch-day card reads the gate', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const mk = (id, bu, who, at) => ({ id, data: { id, projectId: PRJ, bu, approver: who, decision: 'approved', stepUp: true, at } });
  const d1 = Object.assign({}, d0, { approval: d0.approval.concat([mk('x1', 'Compliance', 'do', GOLD_DAY + 'T09:00:00.000Z'), mk('x2', 'Compliance', 'do', GOLD_DAY + 'T10:00:00.000Z'),
    mk('x3', 'IT', 'sk', GOLD_DAY + 'T09:00:00.000Z'), mk('x4', 'IT', 'sk', GOLD_DAY + 'T10:00:00.000Z')]) });
  const t = E.projectTruth(d1, PRJ, GOLD_DAY);
  assert.deepEqual(t.reapprovals.map(x => x.bu), ['Compliance', 'IT']);
  assert.equal(t.reapprovalsText, 'Compliance and IT approved again after changes');
  // #13: a launch-day step on Christmas: the plan check fails and the per-step state says so
  const prj = d0.project.find(p => p.id === PRJ).data;
  const tasks = prj.cutover.tasks.map((x, i) => i === 0 ? Object.assign({}, x, { plannedStart: '2026-12-25T09:00' }) : x);
  const d2 = Object.assign({}, d0, { project: d0.project.map(p => p.id === PRJ ? { id: PRJ, data: Object.assign({}, prj, { cutover: Object.assign({}, prj.cutover, { tasks }) }) } : p) });
  const lp = E.launchPlanCheck(d2, PRJ);
  assert.equal(lp.ok, false);
  const st = E.launchDayCard(d2, PRJ, GOLD_DAY);
  assert.equal(st.ready, false);
  assert.equal(st.label, 'Not ready');
  assert.ok(st.steps.find(x => x.taskId === tasks[0].id).problem, JSON.stringify(st.steps[0]));
});

/* R13 lead fix (Karen r13 repro): an unowned task that resolves a blocker is never shown under the PM (or the data owner) */
test('R13: who never attributes unowned work to the PM; it reads "Needs an owner: <role>"', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const T0 = E.projectTruth(d, PRJ, GOLD_DAY);
  const pm = d.project.find(p => p.id === PRJ).data.owner;
  const row = T0.who.find(x => x.why === 'blocker' && x.workId);
  assert.ok(row, 'a planned blocker with its resolver task');
  const w = d.workItem.find(x => x.id === row.workId).data;
  delete w.owner; w.ownerRole = 'Vendor';
  const T = E.projectTruth(d, PRJ, GOLD_DAY);
  const r2 = T.who.find(x => x.ref === row.ref);
  assert.equal(r2.person, null);
  assert.equal(r2.name, 'Needs an owner: Vendor');
  assert.ok(!T.who.some(x => x.workId === row.workId && x.person === pm), 'never the PM');
  assert.ok(!E.personQueue(d, pm, GOLD_DAY).some(q => q.id === row.workId), 'not in the PM\'s Waiting for you');
});

/* ================================ R14 (L1): close the R13 review findings ================================ */
const R14set = (d, id, patch) => Object.assign({}, d, { workItem: d.workItem.map(e => e.id === id ? { id, data: Object.assign({}, e.data, patch) } : e) });

test('R14 PMO-1: a Done with an open predecessor and 0 hours stays out of EV and the forecast until someone else confirms it', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const t0 = E.projectTruth(d0, PRJ, GOLD_DAY);
  // the PMO expert's repro: W7 (waits on the open W6, 4 days estimated) marked Done in the Work tab with no hours
  const d1 = R14set(d0, 'W7', { status: 'done', doneAt: GOLD_DAY, doneBy: 'dk' });
  const u = E.unconfirmedDone(d1, 'W7');
  assert.equal(u.flag, true);
  assert.deepEqual(u.reasons.sort(), ['no-hours', 'open-predecessor']);
  assert.equal(u.doer, 'dk');
  const t1 = E.projectTruth(d1, PRJ, GOLD_DAY);
  assert.deepEqual([t1.ev.EV, t1.ev.SPI, t1.ev.CPI, t1.ev.EAC, t1.cost.forecast, t1.forecastFinish], [t0.ev.EV, t0.ev.SPI, t0.ev.CPI, t0.ev.EAC, t0.cost.forecast, t0.forecastFinish]);
  assert.equal(t1.unconfirmed.count, 1);
  assert.match(t1.unconfirmed.text, /1 task marked Done needs someone else to confirm it/);
  // who: the PM confirms (never the doer)
  const row = t1.who.find(x => x.why === 'confirm');
  assert.ok(row, JSON.stringify(t1.who.map(x => x.why)));
  assert.equal(row.person, 'ta');
  assert.equal(row.what, 'Confirm “' + d0.workItem.find(e => e.id === 'W7').data.title + '” is done');
  assert.ok(E.personQueue(d1, 'ta', GOLD_DAY).some(q => q.id === 'W7'), 'Home: in the PM\'s Waiting for you');
  // confirmed by someone else: it counts
  const d2 = R14set(d1, 'W7', { confirmedBy: 'ta', confirmedAt: GOLD_DAY + 'T12:00:00.000Z' });
  assert.equal(E.unconfirmedDone(d2, 'W7').flag, false);
  const t2 = E.projectTruth(d2, PRJ, GOLD_DAY);
  assert.ok(t2.ev.EV > t0.ev.EV);
  assert.equal(t2.unconfirmed.count, 0);
  // self-confirmation does not count
  assert.equal(E.unconfirmedDone(R14set(d1, 'W7', { confirmedBy: 'dk' }), 'W7').flag, true);
  // an ordinary Done (hours logged, predecessors done) needs nobody
  assert.equal(E.unconfirmedDone(d0, 'W3').flag, false);
});

test('R14 PMO-S1/PMO-11: deadline guard and day-off due dates are engine rules the server and sync share', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const prj = d0.project.find(p => p.id === PRJ).data;
  assert.equal(E.deadlineBreach(d0, d0, PRJ, GOLD_DAY), null);
  const d1 = R14set(d0, 'W11', { due: E.addBusinessDays(prj.target, 5) });
  const b = E.deadlineBreach(d0, d1, PRJ, GOLD_DAY);
  assert.ok(b, 'moving a task past the deadline is a breach');
  assert.equal(b.target, prj.target);
  assert.ok(b.finishAfter > prj.target);
  assert.match(b.text, /past the .* deadline/);
  // inside the buffer: fine
  assert.equal(E.deadlineBreach(d0, R14set(d0, 'W11', { due: E.addBusinessDays(d0.workItem.find(e => e.id === 'W11').data.due, 2) }), PRJ, GOLD_DAY), null);
  // Dec 25 is a day off
  const p = E.dueDateProblem('2026-12-25', d0);
  assert.equal(p.name, 'Christmas Day');
  assert.equal(p.text, 'Fri Dec 25 is Christmas Day, a day off. Pick a working day, such as Thu Dec 24.');
  assert.match(E.dueDateProblem('2026-12-26', d0).text, /^Sat Dec 26 is a weekend day/);
  assert.equal(E.dueDateProblem('2026-12-24', d0), null);
});

test('R14 Karen 2: no expected cost without rates: "Cost unknown: set rates", never red over budget from default rates', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  // a budget is set but nobody doing the open work has a day rate (new people added inline, or "Needs an owner")
  d.project.push({ id: 'pk', data: { id: 'pk', name: 'Karen budget', owner: 'mc', processes: ['expense-reimbursement'], status: 'active', target: E.addBusinessDays(GOLD_DAY, 40), budget: { planned: 15000 }, baselines: [] } });
  E.planToWork('pk', E.suggestWorkFromDiff(d, 'pk', GOLD_DAY)).forEach(w => { delete w.owner; w.ownerRole = 'Operations director'; d.workItem.push({ id: w.id, data: w }); });
  const t = E.projectTruth(d, 'pk', GOLD_DAY);
  assert.equal(t.cost.unknown, true);
  assert.equal(t.cost.unknownText, 'Cost unknown: set rates');
  assert.deepEqual([t.cost.forecast, t.cost.estimate, t.cost.variance, t.cost.overBudget, t.cost.planned], [null, null, null, false, 15000]);
  assert.ok(t.cost.unpriced > 0);
  const f = E.projectFinancials(d, 'pk', GOLD_DAY);
  assert.deepEqual([f.forecastCost, f.overBudget, f.unknown], [null, false, true]);
  const rep = E.periodReport(d, 'pk', { preset: 'this-week' }, GOLD_DAY);
  assert.ok(!/over/i.test(String(rep.overall.budget.text || '')), rep.overall.budget.text);
  assert.match(String(rep.overall.budget.text || ''), /Cost unknown: set rates/);
  // the seeded project (everyone has a rate) is unchanged
  assert.equal(E.projectTruth(SEED.seed(GOLD_DAY).docs, PRJ, GOLD_DAY).cost.unknown, false);
});

test('R14 BPM/Karen 7: "holds up N tasks" counts distinct tasks within the project', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  // a second missing piece used by the same steps as Bank remittance details: the same tasks must not count twice
  const d4 = d.dataElement.find(e => e.id === 'D4').data; d4.avail = 'missing'; delete d4.check; delete d4.liveConfirmedBy;
  const t = E.projectTruth(d, PRJ, GOLD_DAY);
  const open = t.tasks.open;
  assert.ok(t.blocking.count >= 2, JSON.stringify(t.blocking));
  assert.ok(t.blocking.holdsUp <= open, JSON.stringify([t.blocking.holdsUp, open]));
  const ids = new Set(); t.blocking.items.forEach(b => (b.heldIds || []).forEach(x => ids.add(x)));
  assert.equal(t.blocking.holdsUp, ids.size);
});

test('R14 PMO list 9: no "back on schedule" ask for a task whose expected finish equals its due date', () => {
  const s0 = SEED.seed(GOLD_DAY).docs;
  // the PMO expert's repro: a task due Dec 22, expected Dec 22, holds up a successor due the same day
  const w11 = s0.workItem.find(e => e.id === 'W11').data;
  const x = { id: 'W-x', projectId: PRJ, title: 'Follow-on check', owner: 'ar', status: 'idle', start: w11.due, due: w11.due, deps: ['W11'], effortDays: 2, kind: 'other' };
  const d0 = Object.assign({}, s0, { workItem: s0.workItem.concat([{ id: x.id, data: x }]) });
  const t = E.projectTruth(d0, PRJ, GOLD_DAY);
  const fc = E.forecastAll(d0, GOLD_DAY);
  assert.equal(fc.W11.forecast, E.toBusinessDay(w11.due));
  assert.ok(!t.who.some(r => r.ref === 'work:W11' && /back on schedule/.test(r.what)), JSON.stringify(t.who.filter(r => r.ref === 'work:W11')));
  t.who.filter(x => /back on schedule/.test(x.what)).forEach(x => {
    const id = x.workId || (x.ref || '').replace(/^work:/, '');
    const w = d0.workItem.find(e => e.id === id).data;
    assert.ok(fc[id].forecast > E.toBusinessDay(w.due), x.what + ' expected ' + fc[id].forecast + ' due ' + w.due);
  });
});

test('R14 PMO-7/8 + list 6: "since last report" by exact time, past ranges as of their end, the viewer\'s clock, one late-or-blocked count', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const prj = d0.project.find(p => p.id === PRJ).data;
  // the PMO expert's repro: a report at 2:59 (Chicago, 08:59 UTC), then a Done at 3:01
  const w11 = d0.workItem.find(e => e.id === 'W11').data;
  const d1 = Object.assign({}, R14set(d0, 'W11', { status: 'done', doneAt: GOLD_DAY, doneTs: GOLD_DAY + 'T09:01:00.000Z', doneBy: 'dk', time: [{ by: 'dk', date: GOLD_DAY, hours: 8 }] }), {
    project: d0.project.map(p => p.id === PRJ ? { id: PRJ, data: Object.assign({}, prj, { lastReportAt: GOLD_DAY + 'T08:59:00.000Z' }) } : p) });
  const r = E.periodReport(d1, PRJ, { preset: 'since-last-report', tzOffsetMinutes: 360 }, GOLD_DAY);
  assert.deepEqual(r.completed.map(x => x.id), ['W11'], JSON.stringify(r.completed));
  assert.match(r.window.note, /at 2:59 AM\./);
  void w11;
  // a past range: the headline is as of the period end, and says so
  const lw = E.periodReport(d0, PRJ, { preset: 'last-week' }, GOLD_DAY);
  assert.equal(lw.overall.asOf.past, true);
  assert.match(lw.overall.asOf.label, /^as of (Mon|Tue|Wed|Thu|Fri) /);
  assert.equal(E.periodReport(d0, PRJ, { preset: 'this-week' }, GOLD_DAY).overall.asOf.label, 'as of today');
  // one "late or blocked" count: the report's areas of concern use the header's set
  const t = E.projectTruth(d0, PRJ, GOLD_DAY);
  const ids = new Set(t.late); t.blocking.items.forEach(b => b.heldIds.forEach(x => ids.add(x)));
  assert.equal(t.lateOrBlocked.count, ids.size);
  const tw = E.periodReport(d0, PRJ, { preset: 'this-week' }, GOLD_DAY);
  tw.overall.concerns.forEach(c => assert.equal(c.of, t.lateOrBlocked.count));
  // Karen 7: blockers raised in the period = blocking information whose work was planned in the period
  const d3 = SEED.seed(GOLD_DAY).docs;
  d3.dataElement.push({ id: 'DK1', data: { id: 'DK1', name: 'Vendor W-9 form', avail: 'missing', createdAt: GOLD_DAY } });
  d3.process.find(p => p.id === 'vendor-onboarding').data.tobe.find(n => n.id === 's1').data.push('DK1');
  const r3 = E.periodReport(d3, PRJ, { preset: 'this-week' }, GOLD_DAY);
  assert.ok(r3.blockersRaised.some(b => b.dataId === 'DK1'), JSON.stringify(r3.blockersRaised));
});

test('R14 Karen 8 / BPM-9: a part\'s approval waits for its retire work; "Changed after approval" says from → to', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  // Karen: Treasury's removed Today step ("Print and file the bank letter") has its "Retire the old step" task still open
  const wr = { id: 'WR', projectId: PRJ, pid: 'vendor-onboarding', step: null, retires: 'a3b', title: 'Retire the old step: Print and file the bank letter', owner: 'lp', status: 'idle', start: GOLD_DAY, due: E.addBusinessDays(GOLD_DAY, 3), deps: [], effortDays: 1, kind: 'other', tag: 'retire' };
  const d1 = Object.assign({}, d0, { workItem: d0.workItem.concat([{ id: wr.id, data: wr }]) });
  const br = E.buReady(d1, PRJ, 'Treasury');
  assert.ok(br.waiting.find(x => x.kind === 'work').items.includes('WR'), JSON.stringify(br.waiting));
  // BPM-9: approve Compliance with a fingerprint, then move one of its tasks: the card says what changed, from → to
  const at = GOLD_DAY + 'T09:00:00.000Z';
  const fp = E.sectionFingerprint(d0, PRJ, 'Compliance');
  const sc = E.projectTruth(d0, PRJ, GOLD_DAY).approvals.find(a => a.bu === 'Compliance');
  const appr = { id: 'A-c', projectId: PRJ, bu: 'Compliance', approver: sc.approver, decision: 'approved', stepUp: true, at, snapshotAt: at, fingerprint: fp };
  const w = d0.workItem.map(e => e.data).find(x => x.projectId === PRJ && x.status !== 'done' && E.buReady(d0, PRJ, 'Compliance') && x.owner === 'ps') ||
    d0.workItem.map(e => e.data).find(x => x.projectId === PRJ && x.owner === 'ps');
  const d2 = Object.assign({}, R14set(d0, w.id, { due: E.addBusinessDays(w.due, 2), updatedAt: GOLD_DAY + 'T10:00:00.000Z' }), { approval: d0.approval.concat([{ id: appr.id, data: appr }]) });
  const a2 = E.projectTruth(d2, PRJ, GOLD_DAY).approvals.find(a => a.bu === 'Compliance');
  if (a2.stale) {
    const hit = a2.changedAfter.find(x => x.ref === 'workItem:' + w.id);
    assert.ok(hit, JSON.stringify(a2.changedAfter));
    assert.match(hit.text, new RegExp('due ' + E.fmtDay(w.due) + ' → ' + E.fmtDay(E.addBusinessDays(w.due, 2))));
  } else assert.fail('the moved task should reopen Compliance\'s approval: ' + JSON.stringify(a2));
});

test('R14 PMO-9: knock-on re-dating edits and impact warnings; R14 one information split', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  // the re-plan: W6 (holds up W7, W8, W10) moves out 10 business days
  const w6 = d0.workItem.find(e => e.id === 'W6').data;
  const d1 = R14set(d0, 'W6', { due: E.addBusinessDays(GOLD_DAY, 10), start: GOLD_DAY });
  const warn = E.pastDueWarnings(d1, PRJ, GOLD_DAY);
  assert.ok(warn.some(x => x.workId === 'W7'), JSON.stringify(warn));
  assert.match(warn.find(x => x.workId === 'W7').text, /will be late: expected/);
  const ed = E.knockOnRedates(d1, PRJ, GOLD_DAY, { exclude: ['W6'] });
  assert.ok(ed.length && ed.every(e => e.type === 'workItem' && e.op === 'set' && e.field === 'due' && e.auto && e.to > e.from), JSON.stringify(ed));
  assert.ok(!ed.some(e => e.id === 'W6'));
  // applied: no knock-on task is still late for that reason
  let d2 = d1; ed.forEach(e => { d2 = R14set(d2, e.id, { due: e.to }); });
  const fc = E.forecastAll(d2, GOLD_DAY);
  ed.forEach(e => assert.equal(fc[e.id].sched === 'slip', false, e.label));
  void w6;
  const c = E.infoStateCounts(d0, PRJ);
  assert.equal(c.total, c.have + c.notAvailable + c.notChecked + c.sampleOnly + c.waiting + c.problem);
  assert.match(c.text, /1 not available/);
});

test('R14 (L3 asks): an unowned fix is never named after the PM or data owner; a held item is on Home once; PM-done confirmations go to someone else', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const w6 = d.workItem.find(e => e.id === 'W6').data; delete w6.owner; w6.ownerRole = 'Treasury analyst';
  // the sentence names "Needs an owner", never Leo (data owner) or Tom (PM)
  const t = E.projectTruth(d, PRJ, GOLD_DAY);
  assert.ok(!/\((Leo Park|Tom Alvarez|Maya Chen)\)/.test(t.sentence.replace(/^.*?late; first: “[^”]*” /, '')) || /Needs an owner/.test(t.sentence), t.sentence);
  t.who.filter(x => x.workId === 'W6').forEach(x => assert.equal(x.person, null));
  // a held Jira item: one "Confirm" row on the confirmer's Home
  const h = { kind: 'order', reason: 'x', confirmBy: 'dk', tool: 'Jira', key: 'VOM-8', toolStatus: 'Done', by: 'dk', at: GOLD_DAY + 'T15:00:00.000Z' };
  const d1 = R14set(SEED.seed(GOLD_DAY).docs, 'W7', { status: 'review', syncHold: h });
  assert.equal(E.personQueue(d1, 'dk', GOLD_DAY).filter(x => /^Confirm /.test(x.title || x.what)).length, 1);
  // the PM (also the launch owner) marks a task done with no hours: someone else is asked to confirm
  const d2 = SEED.seed(GOLD_DAY).docs;
  const prj = d2.project.find(p => p.id === PRJ).data; delete prj.releaseManager;
  const d3 = R14set(d2, 'W11', { owner: prj.owner, status: 'done', doneAt: GOLD_DAY, doneBy: prj.owner });
  const row = E.projectTruth(d3, PRJ, GOLD_DAY).who.find(x => x.why === 'confirm');
  assert.ok(row && row.person && row.person !== prj.owner, JSON.stringify(row));
});

test('R14 BPM-2: profile warnings become tests with the right counts; bank wording only on bank fields; amounts and scores are numbers; samples split per item', () => {
  // two shared accounts (4 records), three repeated tax ids... counts are records, never just repeats
  const csv = ['Vendor name,Tax ID,Bank account number,Customer account number',
    'Acme Supply Inc,12-3456789,000123456789,C100', 'ACME Supply,12-3456789,000123456789,C100',
    'Fabrikam,45-1112223,000987654321,C200', 'Fabrikam Metals,45-1112223,000987654321,C300', 'Contoso,45-1112223,000555666777,C400'].join('\n');
  const prof = E.profileCsv(csv, { context: 'Bank remittance details' });
  const col = n => prof.find(c => c.name === n);
  assert.deepEqual([col('Bank account number').sharedAccount.accounts, col('Bank account number').sharedAccount.records], [2, 4]);
  assert.match(col('Bank account number').sharedAccount.text, /^2 account numbers are each on more than one record \(4 records in all\)/);
  assert.equal(col('Customer account number').sharedAccount, undefined, 'a customer account number never gets the shared-bank wording');
  assert.equal(col('Tax ID').duplicateRecords, 5);
  const de = { id: 'DV', name: 'Vendors', fields: [{ name: 'Vendor name', type: 'text', required: true }, { name: 'Tax ID', format: '##-#######', type: 'text', unique: true }, { name: 'Bank account number', type: 'digits' }] };
  const tests = E.generateTests(de, prof, { all: true });
  assert.ok(tests.some(t => t.field === 'Bank account number' && t.signal === 'shared-account' && /4 records share 2 account numbers/.test(t.note)), JSON.stringify(tests.filter(t => t.field === 'Bank account number').map(t => t.note)));
  assert.ok(tests.some(t => t.field === 'Vendor name' && t.signal === 'near-duplicate' && t.expect === 'reject'), 'near-duplicate names become a test');
  assert.ok(tests.filter(t => t.setup).every(t => /^Setup: first save a record/.test(t.setup)), 'a duplicate test says why it differs from the valid test');
  // numeric inference: a "requested limit" typed as text is a number; a score above 100 is out of range
  const lim = E.fieldSpec({ name: 'requested_limit', type: 'text' }), sc = E.fieldSpec({ name: 'risk_score', type: 'text' });
  assert.deepEqual([lim.type, E.validate(lim, 'Abcdef'), E.validate(lim, '25000')], ['currency', false, true]);
  assert.deepEqual([sc.type, E.validate(sc, 'abc'), E.validate(sc, '101'), E.validate(sc, '87')], ['number', false, false, true]);
  assert.equal(E.fieldSpec({ name: 'Customer account number', type: 'text' }).type, 'text');
  // a majority shape is never "should be rejected"
  const shapes = ['Name,Code', 'a,AB-12', 'b,AB-13', 'c,AB-14', 'd,AB-15', 'e,AB-16', 'f,AB-17', 'g,AB-18', 'h,AB-19', 'i,X1', 'j,Y2'].join('\n');
  const t2 = E.generateTests({ id: 'DS', name: 'Codes', fields: [{ name: 'Code', type: 'text' }] }, E.profileCsv(shapes), { all: true });
  assert.ok(!t2.some(t => /Observed shape/.test(t.note) && /8 of 10/.test(t.note) && t.expect === 'reject'), JSON.stringify(t2.map(t => [t.note, t.expect])));
  // a 3-column sample uploaded on one item is split per information item used by the same steps
  const d = SEED.seed(GOLD_DAY).docs;
  const split = E.splitSampleColumns(d, 'D2', ['bank_name', 'vendor_id', 'mystery']);
  assert.ok(split.D2.includes('mystery') && split.D2.includes('bank_name'), JSON.stringify(split));
  assert.deepEqual(split.D4, ['vendor_id'], JSON.stringify(split));
});

test('R14 Jordan A: a department move or new approver grants no rights on a part already in flight', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const comp = E.departments(d0).find(x => x.name === 'Compliance');
  const at = GOLD_DAY + 'T20:00:00.000Z';   // after the project's testing started
  const r = E.departmentEdit(d0, { kind: 'assign', personId: 'ar', id: comp.id, at });
  assert.ok(r.ok !== false, JSON.stringify(r));
  const d1 = Object.assign({}, d0, { person: d0.person.map(e => { const x = r.people.find(p => p.id === e.id); return x ? { id: e.id, data: Object.assign({}, e.data, x) } : e; }) });
  assert.equal(d1.person.find(e => e.id === 'ar').data.buSince, at);
  const tests = E.projectTruth(d1, PRJ, GOLD_DAY).testing.perBU.Compliance.tests.filter(t => !t.passedBy);
  const tid = (tests[0] || E.projectTruth(d1, PRJ, GOLD_DAY).testing.perBU.Compliance.tests[0]).id;
  const bar = E.canPassTest(d1, PRJ, tid, 'ar');
  assert.ok(bar && bar.rule === 'recent-move', JSON.stringify(bar));
  // named as a Compliance approver after the fact: not eligible for this project's Compliance part
  const r2 = E.departmentEdit(d1, { kind: 'approvers', id: comp.id, approvers: comp.approvers.concat(['ar']), at });
  const settings = d1.workspace.find(w => w.id === 'settings').data;
  const d2 = Object.assign({}, d1, { workspace: d1.workspace.map(w => w.id === 'settings' ? { id: 'settings', data: Object.assign({}, settings, { departments: r2.departments }) } : w) });
  const a = E.projectTruth(d2, PRJ, GOLD_DAY).approvals.find(x => x.bu === 'Compliance');
  assert.ok(!a.eligible.includes('ar'), JSON.stringify(a.eligible));
  // R14 Jordan r14: chosen as the project's approver for that part ("Choose who approves") after the fact: still not eligible,
  // and so not an override co-signer either
  const d4 = Object.assign({}, d1, { project: d1.project.map(e => e.id === PRJ ? { id: e.id, data: Object.assign({}, e.data, { approvers: Object.assign({}, e.data.approvers || {}, { Compliance: 'ar' }) }) } : e) });
  const a4 = E.projectTruth(d4, PRJ, GOLD_DAY).approvals.find(x => x.bu === 'Compliance');
  assert.ok(!a4.eligible.includes('ar'), 'chosen approver held to the recent-move rule: ' + JSON.stringify(a4.eligible));
  assert.equal(E.overrideSignerRole(d4, PRJ, 'ar'), null);
  // a part not yet in flight (no tests, no approvals): the move counts
  const d3 = Object.assign({}, d1, { testRun: [], approval: [] });
  assert.equal(E.grantTooRecent(d3, d3.project.find(p => p.id === PRJ).data, 'Compliance', 'ar'), false);
});

test('R14 Jordan D: the report\'s finish move and the plan change\'s say the same thing', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const at = GOLD_DAY + 'T15:00:00.000Z';
  const t0 = E.projectTruth(d0, PRJ, GOLD_DAY);
  const w11 = d0.workItem.find(e => e.id === 'W11').data;
  const to = E.addBusinessDays(t0.forecastFinish, 14);
  const dm = R14set(d0, 'W11', { due: to });
  const after = E.projectTruth(dm, PRJ, GOLD_DAY).forecastFinish;
  const c = { id: 'c14', projectId: PRJ, title: 'Slip W11', status: 'applied', at, appliedAt: at, decidedBy: 'mc', impact: { finish: { before: t0.forecastFinish, after } } };
  const d1 = Object.assign({}, dm, { planChange: [{ id: c.id, data: c }] });
  const n = E.businessDaysBetween(t0.forecastFinish, after);
  const r = E.periodReport(d1, PRJ, { preset: 'this-week' }, GOLD_DAY);
  const pc = r.planChanges.find(x => x.id === 'c14');
  assert.equal(pc.shiftDays, n);
  // the seed has a saved forecast from before this week, so the period's move is longer; it says how much the change made
  assert.match(r.slipText, new RegExp(n + ' business days from the plan change “Slip W11” \\(' + E.fmtDay(t0.forecastFinish) + ' → ' + E.fmtDay(after) + '\\)'), r.slipText);
  // with no saved forecast, the report's move is the change's move
  const pr = d1.project.find(p => p.id === PRJ).data;
  const d2 = Object.assign({}, d1, { project: d1.project.map(p => p.id === PRJ ? { id: PRJ, data: Object.assign({}, pr, { forecastLog: [], baselines: [] }) } : p) });
  const r2 = E.periodReport(d2, PRJ, { preset: 'this-week' }, GOLD_DAY);
  assert.equal(r2.slipDays, n, r2.slipText);
  void w11;
});

test('R14 (L2 asks): per-run documents are available; new information is the step role\'s; impossible threshold paths are pruned; a department with nobody is a gap', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  d.dataElement.push({ id: 'DW9', data: { id: 'DW9', name: 'W-9 form', avail: 'missing', perRun: true } });
  assert.equal(E.effectiveAvail(d, 'DW9'), 'live');
  assert.deepEqual(E.defaultDataOwner({ owner: 'ta', ownerRole: 'Credit analyst' }), { ownerRole: 'Credit analyst' });
  // two amount choices: "under $50k?" Yes, then "above $250k?" Yes is impossible
  const proc = { id: 'pt', name: 'Limits', owner: 'mc', asis: [], tobe: [
    { id: 'g1', type: 'decision', title: 'Requested limit under $50k?', threshold: { subject: 'requested limit', op: '<', amount: 50000 }, branches: [
      { label: 'Yes', nodes: [{ id: 'g2', type: 'decision', title: 'Requested limit above $250,000?', threshold: { subject: 'requested limit', op: '>', amount: 250000 }, branches: [
        { label: 'Yes', nodes: [{ id: 'a', type: 'step', title: 'CFO approves', owner: 'mc' }] }, { label: 'No', nodes: [{ id: 'b', type: 'step', title: 'Auto-approve', owner: 'mc' }] }] }] },
      { label: 'No', nodes: [{ id: 'c', type: 'step', title: 'Controller approves', owner: 'mc' }] }] }] };
  d.process.push({ id: 'pt', data: proc });
  d.project.push({ id: 'ppt', data: { id: 'ppt', name: 'Limits', owner: 'mc', processes: ['pt'], status: 'active', target: E.addBusinessDays(GOLD_DAY, 30) } });
  const sc = E.generateScenarios(d, 'ppt');
  assert.ok(sc.length >= 2, JSON.stringify(sc.map(x => x.title)));
  assert.ok(!sc.some(x => JSON.stringify(x).includes('CFO approves') && /under \$50k\? = Yes/.test(JSON.stringify(x))), JSON.stringify(sc.map(x => x.title)));
  // a department with no approvers and no members: a gap on the process page
  const settings = d.workspace.find(w => w.id === 'settings').data;
  settings.departments = settings.departments.concat([{ id: 'dept-ops', name: 'Operations', approvers: [] }]);
  proc.teamDepartments = { Operations: 'Operations' };
  proc.tobe[0].branches[1].nodes[0].touches = ['Operations'];
  const tr = E.teamRouting(d, 'pt');
  assert.ok(tr.noApprover.includes('Operations'), JSON.stringify(tr));
  assert.match(tr.text, /nobody to approve/);
});

/* ================================ Round 15 (M1): close the R14 review findings ================================ */
// The BPM reviewer's credit-limit process (fictional Northwind): role steps whose stale named owner is the process
// owner (Maya), Ana named as the Accounts Receivable approver though she sits in Accounts Payable, and a changed
// threshold choice whose paths belong to the Controller (Finance).
function r15Credit() {
  const d = SEED.seed(GOLD_DAY).docs;
  const settings = d.workspace.find(w => w.id === 'settings').data;
  settings.departments = settings.departments.concat([{ id: 'dept-ar', name: 'Accounts Receivable', approvers: ['ar'] }, { id: 'dept-fin', name: 'Finance', approvers: ['dk'] }]);
  const proc = { id: 'credit', name: 'Credit limit request', owner: 'mc', resources: [], version: 1, released: [],
    teamDepartments: { 'AR Specialist': 'Accounts Receivable', Controller: 'Finance', 'IT Support': 'IT' },
    asis: [
      { id: 'k', type: 'trigger', title: 'Credit request received', owner: 'mc', data: [] },
      { id: 'a1', type: 'step', title: 'Review credit request', ownerRole: 'AR Specialist', owner: 'mc', data: [] },
      { id: 'ag', type: 'decision', title: 'Requested limit over $200,000?', threshold: { subject: 'requested limit', op: '>', amount: 200000 }, branches: [
        { label: 'Yes', nodes: [{ id: 'a2', type: 'step', title: 'Controller approves', ownerRole: 'Controller', data: [] }] },
        { label: 'No', nodes: [] }] },
      { id: 'a3', type: 'step', title: 'Update the credit limit in the ERP', ownerRole: 'AR Specialist', owner: 'mc', data: [] },
      { id: 'a4', type: 'step', title: 'Sync to the ERP', ownerRole: 'IT Support', data: [] },
    ],
    tobe: [
      { id: 'k', type: 'trigger', title: 'Credit request received', owner: 'mc', data: [], from: 'k' },
      { id: 'c1', type: 'step', title: 'Review credit request in the portal', ownerRole: 'AR Specialist', owner: 'mc', data: [], from: 'a1' },
      { id: 'cg', type: 'decision', title: 'Requested limit over $250,000?', threshold: { subject: 'requested limit', op: '>', amount: 250000 }, from: 'ag', branches: [
        { label: 'Yes', nodes: [{ id: 'c2', type: 'step', title: 'Controller approves', ownerRole: 'Controller', data: [], from: 'a2' }] },
        { label: 'No', nodes: [] }] },
      { id: 'c3', type: 'step', title: 'Update the credit limit in the ERP', ownerRole: 'AR Specialist', owner: 'mc', data: [], from: 'a3' },
      { id: 'c4', type: 'step', title: 'Sync to the ERP', ownerRole: 'IT Support', data: [], from: 'a4' },
    ] };
  d.process.push({ id: 'credit', data: proc });
  d.project.push({ id: 'pcr', data: { id: 'pcr', name: 'Credit portal', owner: 'ta', processes: ['credit'], status: 'active', target: E.addBusinessDays(GOLD_DAY, 40) } });
  return d;
}

test('R15 #1 one owner truth: plan tasks, scripts and scenarios name the step\'s doer, never the process owner; data owners follow their step', () => {
  const d = r15Credit();
  assert.deepEqual(E.stepTaskOwner(d, 'credit', 'c1'), { owner: null, ownerRole: 'AR Specialist', text: 'Needs an owner: AR Specialist' });
  const sug = E.suggestWorkFromDiff(d, 'pcr', GOLD_DAY).filter(s => s.step === 'c1');
  assert.deepEqual(sug.map(s => [s.owner, s.ownerRole]), [[null, 'AR Specialist']]);
  const scripts = E.generateUatScripts(d, 'pcr');
  assert.ok(scripts.length && scripts.every(s => !JSON.stringify(s).includes('Maya Chen')), JSON.stringify(scripts.map(s => s.when)));
  assert.equal(scripts.find(s => s.step === 'c1').when, 'AR Specialist performs "Review credit request in the portal"');
  assert.ok(!JSON.stringify(E.generateScenarios(d, 'pcr')).includes('Maya Chen'));
  // Karen: outside parties are told, never trained
  const v = r15Credit(); v.process.find(p => p.id === 'credit').data.tobe[1].ownerRole = 'Vendor';
  const train = E.suggestWorkFromDiff(v, 'pcr', GOLD_DAY).find(s => s.tag === 'train');
  assert.ok(train && !/Vendor/.test(train.note), train && train.note);
  // a data owner follows its step to its new doer
  const b = r15Credit();
  b.dataElement.push({ id: 'DCL', data: { id: 'DCL', name: 'Credit limit', ownerRole: 'AR Specialist', avail: 'live' } });
  b.process.find(p => p.id === 'credit').data.tobe[1].data = ['DCL'];
  const a = JSON.parse(JSON.stringify(b)); a.process.find(p => p.id === 'credit').data.tobe[1].ownerRole = 'Credit Analyst';
  assert.deepEqual(E.dataOwnersToFollow(b, a), [{ dataId: 'DCL', set: { owner: null, ownerRole: 'Credit Analyst' }, from: 'AR Specialist', to: 'Credit Analyst' }]);
});

test('R15 #2 one approver truth: a named department approver is eligible on Launch; Departments, the process page and Launch agree', () => {
  const d = r15Credit();
  const pa = E.partApprovers(d, 'pcr', 'Accounts Receivable');
  assert.deepEqual([pa.eligible, pa.source], [['ar'], 'named']);
  assert.equal(E.departmentApprovers(d, 'Accounts Receivable').text, 'Approves: Ana Ruiz');
  const ap = E.projectTruth(d, 'pcr', GOLD_DAY).approvals.find(x => x.bu === 'Accounts Receivable');
  assert.deepEqual(ap.eligible, pa.eligible, 'Launch reads the same list');
  // Jordan: a department with named approvers lists only them, never its other members
  const comp = E.departments(d).find(x => x.name === 'Compliance');
  const pc = E.partApprovers(d, PRJ, 'Compliance');
  assert.ok(pc.eligible.every(id => comp.approvers.length ? comp.approvers.includes(id) : true), JSON.stringify([pc.eligible, comp.approvers]));
  assert.deepEqual(pc.eligible, E.projectTruth(d, PRJ, GOLD_DAY).approvals.find(x => x.bu === 'Compliance').eligible);
});

test('R15 #3 the sponsor is stored, never computed; with no sponsor a deadline change goes to an Admin who did not ask', () => {
  const d = r15Credit();
  assert.equal(E.sponsorOf(d, 'pcr'), null, 'no computed sponsor from the process owner');
  const da = E.deadlineApprover(d, 'pcr', 'ta');
  assert.equal(da.role, 'admin'); assert.ok(da.person && da.person !== 'ta', JSON.stringify(da));
  assert.ok(E.adminsOf(d).includes(da.person));
  const p = d.project.find(x => x.id === 'pcr').data; p.sponsor = 'ps';
  assert.deepEqual([E.sponsorOf(d, 'pcr'), E.deadlineApprover(d, 'pcr', 'ta').person], ['ps', 'ps']);
  assert.equal(E.deadlineApprover(d, 'pcr', 'ps').role, 'admin', 'the sponsor asking: an Admin approves');
  p.sponsor = 'ta';
  assert.equal(E.sponsorOf(d, 'pcr'), null, 'the PM is never the sponsor');
});

test('R15 #4 effort counts in the forecast; a start after the due date or on a day off is a problem; cost tolerance', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const t0 = E.projectTruth(d0, PRJ, GOLD_DAY);
  const w = d0.workItem.find(e => e.data.status === 'idle' && e.data.start > GOLD_DAY && e.data.projectId === PRJ).data;
  const d1 = R14set(d0, w.id, { effortDays: 40 });
  const f = E.forecastAll(d1, GOLD_DAY)[w.id];
  assert.ok(f.forecast >= E.addBusinessDays(w.start, 39), JSON.stringify(f));
  const d1b = R14set(d1, w.id, { deps: [] });
  assert.equal(E.forecastAll(d1b, GOLD_DAY)[w.id].basis.kind, 'effort');
  assert.ok(E.deadlineBreach(d0, d1, PRJ, GOLD_DAY), 'a 40-day effort edit moves the finish past the deadline');
  assert.ok(E.explainForecast(d1b, w.id, GOLD_DAY).some(x => /needs 40 business days of effort/.test(x.text)));
  assert.equal(E.startDateProblem({ start: E.addBusinessDays(w.due, 2), due: w.due }, d0).kind, 'after-due');
  assert.equal(E.startDateProblem({ start: '2026-12-25', due: '2026-12-31' }, d0).kind, 'day-off');
  assert.equal(E.startDateProblem({ start: w.start, due: w.due }, d0), null);
  const c = E.costBreach(d0, R14set(d0, w.id, { effortDays: (w.effortDays || 1) + 10 }), PRJ, GOLD_DAY);
  assert.ok(c === null || c.pct >= E.COST_TOLERANCE_PCT);
  assert.equal(E.costBreach(d0, d0, PRJ, GOLD_DAY), null);
  void t0;
});

test('R15 #5/#6 a self-assigned test can\'t be passed in Try it out; first completion kept; hours flags', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const tc = d.testCase[0].data; tc.tester = 'dk'; tc.assignedBy = 'dk';
  const bar = E.canPassTest(d, PRJ, tc.id, 'dk', { env: 'sit' });
  assert.ok(bar && bar.rule === 'assigner' && /Try it out too/.test(bar.text), JSON.stringify(bar));
  tc.assignedBy = 'ta';
  assert.equal(E.canPassTest(d, PRJ, tc.id, 'dk', { env: 'sit' }), null);
  // first completion
  const prev = { status: 'prog', firstDoneAt: '2026-11-02', doneAt: undefined };
  assert.deepEqual(E.keepFirstDone(prev, { status: 'done', doneAt: '2026-11-16' }), { status: 'done', doneAt: '2026-11-02', firstDoneAt: '2026-11-02' });
  assert.equal(E.keepFirstDone({ status: 'done', doneAt: '2026-11-03' }, { status: 'prog' }).firstDoneAt, '2026-11-03');
  assert.deepEqual(E.hoursFlags(null, { start: '2026-11-10' }, { date: '2026-11-20', hours: 8 }, GOLD_DAY, 30), { future: true, overDay: true });
  assert.deepEqual(E.hoursFlags(null, { start: '2026-11-10' }, { date: '2026-11-05', hours: 8 }, GOLD_DAY, 8), { beforeStart: true });
  assert.equal(E.timeEntryText({ hours: 8, date: '2026-11-30', at: '2026-11-18T10:00:00Z', future: true }), '8 hours on Nov 30 (logged Nov 18, future date)');
  // the seed never shows an impossible day as ordinary
  const dk = d.workItem.flatMap(e => (e.data.time || [])).filter(t => t.by === 'dk');
  const per = {}; dk.forEach(t => { per[t.date] = (per[t.date] || 0) + t.hours; });
  dk.filter(t => per[t.date] > 24).forEach(t => assert.equal(t.overDay, true));
});

test('R15 #11 a changed choice routes to its own step\'s team and its paths\' teams, says was → now; unchanged parts never reopen', () => {
  const d = r15Credit();
  const df = E.diffProcess(d.process.find(p => p.id === 'credit').data);
  assert.ok(df.changes.cg.includes('Threshold over $200,000 → over $250,000'), JSON.stringify(df.changes.cg));
  const secs = E.readiness(d, 'pcr', GOLD_DAY).checks.find(c => c.id === 'bu-signoff').sections;
  assert.deepEqual(secs, ['Accounts Receivable', 'Finance'], 'the Controller (Finance) approves the changed threshold; IT, untouched, does not');
  const tell = E.suggestWorkFromDiff(d, 'pcr', GOLD_DAY).find(s => s.tag === 'tell');
  assert.match(tell.note, /Accounts Receivable/); assert.match(tell.note, /Finance/);
  // approve Finance and IT-like parts with fingerprints, then change only the threshold: only parts it involves reopen
  const at = GOLD_DAY + 'T10:00:00.000Z';
  const fpF = E.sectionFingerprint(d, 'pcr', 'Finance');
  d.approval.push({ id: 'APF', data: { id: 'APF', projectId: 'pcr', bu: 'Finance', approver: 'dk', decision: 'approved', at, stepUp: true, fingerprint: fpF } });
  const g = d.process.find(p => p.id === 'credit').data.tobe[2]; g.threshold = { subject: 'requested limit', op: '>', amount: 300000 }; g.title = 'Requested limit over $300,000?';
  const st = E.readiness(d, 'pcr', GOLD_DAY).checks.find(c => c.id === 'bu-signoff').stale.find(x => x.bu === 'Finance');
  assert.ok(st && st.details.some(x => /threshold over \$250,000 → over \$300,000/.test(x.label)), JSON.stringify(st));
  // a no-op save of a task in an approved part does not reopen it
  const d2 = SEED.seed(GOLD_DAY).docs;
  const comp = E.readiness(d2, PRJ, GOLD_DAY).checks.find(c => c.id === 'bu-signoff');
  const w = d2.workItem.find(e => e.data.projectId === PRJ && e.data.step === 's2').data;
  const later = new Date(Date.parse(GOLD_DAY + 'T23:00:00Z')).toISOString();
  const d3 = R14set(d2, w.id, { updatedAt: later });
  const after = E.readiness(d3, PRJ, GOLD_DAY).checks.find(c => c.id === 'bu-signoff');
  assert.deepEqual(after.stale.map(x => x.bu), comp.stale.map(x => x.bu));
});

test('R15 (M2 ask) E2E paths respect Stop nodes; skip-aheads are skips, not loops', () => {
  const d = r15Credit();
  const proc = d.process.find(p => p.id === 'credit').data;
  proc.tobe[2].branches[0].nodes.push({ id: 'cx', type: 'end', title: 'Stop: request rejected' });
  const sc = E.generateScenarios(d, 'pcr');
  const yes = sc.find(x => /= Yes/.test(x.title));
  assert.ok(yes && !yes.steps.some(s => s.step === 'c3') && yes.steps.some(s => s.action.startsWith('The process stops here')), JSON.stringify(yes && yes.steps.map(s => s.action)));
  proc.tobe[2].branches[0].nodes = [{ id: 'c2', type: 'step', title: 'Controller approves', ownerRole: 'Controller', data: [], from: 'a2' }];
  proc.tobe[2].branches[1].goto = 'c4';
  const no = E.generateScenarios(d, 'pcr').find(x => /= No/.test(x.title));
  assert.ok(no && !no.title.includes('loop back') && !no.steps.some(s => s.step === 'c3'), JSON.stringify(no));
  const scr = E.generateUatScripts(d, 'pcr').find(x => x.step === 'cg' && /No/.test(x.title));
  assert.match(scr.then, /skips to/);
});

test('R15 #7 profile → tests (BPM fixture): own shapes, leading zeros, warnings become tests, the majority shape is never rejected, thresholds, data page status', () => {
  const csv = fs.readFileSync(path.join(ROOT, 'tests', 'pmoflow', 'fixtures', 'r15-credit-sample.csv'), 'utf8');
  const prof = E.profileCsv(csv);
  const spec = E.specFromProfile(prof);
  const de = { id: 'DCR', name: 'Credit request', fields: spec };
  const tests = E.generateTests(de, prof);   // the default (capped) set: warnings are never cut
  const by = f => tests.filter(t => t.field === f);
  // the bank account's tests use its own shape (9 digits-10 digits), never the account number's "NW…"
  assert.ok(by('bank_account').every(t => !/^NW/.test(t.input) && !/^0NW/.test(t.input)), JSON.stringify(by('bank_account').map(t => t.input)));
  assert.ok(by('bank_account').some(t => /Leading zero/.test(t.note) && /^0\d{8}-\d{10}$/.test(t.input) && t.expect === 'accept'));
  assert.ok(by('bank_account').some(t => t.signal === 'shared-account'));
  assert.ok(by('customer_name').some(t => t.signal === 'near-duplicate'));
  assert.ok(by('account_number').some(t => t.signal === 'unique'), 'a key whose sample values are all different gets a uniqueness test');
  // a routing number with a leading zero is a real value
  assert.equal(E.validate(E.fieldSpec({ name: 'Routing number', type: 'number' }), '021000021'), true);
  // a score is 0–100
  assert.equal(E.validate(E.fieldSpec(spec.find(f => f.name === 'risk_score')), '101'), true);
  assert.ok(E.generateTests(de, prof, { all: true }).some(t => t.field === 'risk_score' && t.input === '101' && t.expect === 'reject'));
  // never reject the majority shape
  const all = E.generateTests(de, prof, { all: true });
  prof.forEach(c => (c.patterns || []).filter(pt => pt.count * 2 > 10).forEach(pt => assert.ok(!all.some(t => t.field === c.name && /Observed shape/.test(t.note) && t.note.includes('(' + pt.count + ' of') && t.expect === 'reject'), c.name)));
  // thresholds of the process become boundary tests
  const d = r15Credit();
  d.dataElement.push({ id: 'DCR', data: Object.assign({ avail: 'live' }, de, { fields: [{ name: 'Requested limit', type: 'currency', min: 0 }] }) });
  d.process.find(p => p.id === 'credit').data.tobe[1].data = ['DCR'];
  const tc = E.thresholdCases(d, 'DCR');
  assert.deepEqual(tc.map(t => [t.input, /takes the “(\w+)” path/.exec(t.note)[1]]), [['250000.00', 'No'], ['250000.01', 'Yes']]);
  // the data page never says "all match" while a warning stands
  d.profile.push({ id: 'PR1', data: { id: 'PR1', dataId: 'DCR', at: GOLD_DAY + 'T10:00:00Z', columns: prof, rows: 10 } });
  const ps = E.dataProfileStatus(d, 'DCR');
  assert.equal(ps.allMatch, false); assert.ok(ps.warnings.some(w => w.kind === 'shared-account') && ps.warnings.some(w => w.kind === 'near-duplicate'), JSON.stringify(ps));
  assert.ok(!/all match/i.test(ps.text));
});

test('R15 #8/#9/#10 unconfirmed Done is not finished; one late-or-blocked count with parts; per-run information is never a blocker', () => {
  const d0 = SEED.seed(GOLD_DAY).docs;
  const open = d0.workItem.find(e => e.data.projectId === PRJ && e.data.status !== 'done' && (d0.workItem.some(x => (x.data.deps || []).includes(e.id))));
  const dep = d0.workItem.find(x => (x.data.deps || []).includes(open.id));
  const d1 = R14set(d0, dep.id, { status: 'done', doneAt: GOLD_DAY, doneBy: dep.data.owner });
  const wd = E.readiness(d1, PRJ, GOLD_DAY).checks.find(c => c.id === 'work-done');
  assert.ok(wd.unconfirmed.includes(dep.id) && !wd.pass);
  const u = E.unconfirmedDone(d1, dep.id);
  assert.ok(u.open.some(x => x.id === open.id) && /still open\. Confirm/.test(u.confirmText), JSON.stringify(u));
  const t = E.projectTruth(d0, PRJ, GOLD_DAY);
  const lb = t.lateOrBlocked;
  assert.equal(lb.count, lb.late + lb.held - lb.both);
  assert.match(lb.text, new RegExp('^' + lb.count + ' tasks? late or blocked: '));
  assert.equal(t.testing.openIssues.count, t.testing.total - t.testing.passed);
  // per-run information: never raised as a blocker in the weekly report; raised − resolved + carried in = open
  const d2 = SEED.seed(GOLD_DAY).docs;
  d2.dataElement.push({ id: 'DW9', data: { id: 'DW9', name: 'W-9 form', avail: 'missing', perRun: true, createdAt: GOLD_DAY } });
  d2.process.find(p => p.id === 'vendor-onboarding').data.tobe.find(n => n.id === 's1').data.push('DW9');
  const r = E.periodReport(d2, PRJ, { preset: 'this-week' }, GOLD_DAY);
  assert.ok(!r.blockersRaised.some(b => b.dataId === 'DW9') && !r.blockersOpenAtEnd.some(b => b.dataId === 'DW9'));
  assert.equal(r.blockersOpenAtEnd.length, r.blockersCarriedIn + r.blockersRaised.length - r.blockersResolved.length);
  // a launched project is 100% done
  const d3 = SEED.seed(GOLD_DAY).docs; d3.project.find(p => p.id === PRJ).data.status = 'live';
  assert.equal(E.projectTruth(d3, PRJ, GOLD_DAY).pctDone, 100);
});

/* ------------------------------------------------------------------ R16 N1 */
const r16apply = (d, r) => {
  const put = (type, patches) => d[type].map(e => { const p = (patches || []).find(x => x.id === e.id); return p ? { id: e.id, data: Object.assign({}, e.data, p) } : e; });
  return Object.assign({}, withDepts(d, r.departments), { person: put('person', r.people), process: put('process', r.processes), project: put('project', r.projects) });
};

test('R16 #1 step-ups expire after 10 minutes and are never in the future; a hosted sign-in maps to one person', () => {
  const now = '2026-11-18T15:00:00.000Z';
  assert.equal(E.STEP_UP_MAX_MINUTES, 10);
  assert.equal(E.stepUpProblem('2026-11-18T14:51:00.000Z', now), null);
  assert.equal(E.stepUpProblem({ at: '2026-11-18T14:51:00.000Z' }, now), null);
  assert.equal(E.stepUpProblem('2026-11-18T14:49:59.000Z', now).kind, 'stale');
  assert.equal(E.stepUpProblem('2020-01-01T00:00:00.000Z', now).kind, 'stale');
  assert.equal(E.stepUpProblem('2026-11-18T15:00:30.000Z', now), null, 'under a minute of clock difference is allowed');
  assert.equal(E.stepUpProblem('2026-11-18T15:05:00.000Z', now).kind, 'future');
  assert.equal(E.stepUpProblem(undefined, now).kind, 'missing');
  const d = SEED.seed(GOLD_DAY).docs;
  d.person.find(p => p.id === 'ar').data.email = 'Ana.Ruiz@northwind.example';
  d.person.find(p => p.id === 'ta').data.principalId = 'u-123';
  assert.equal(E.personForPrincipal(d, { userDetails: 'ana.ruiz@northwind.example' }), 'ar');
  assert.equal(E.personForPrincipal(d, { userId: 'u-123', userDetails: 'other@x.example' }), 'ta');
  assert.equal(E.personForPrincipal(d, { userDetails: 'nobody@x.example' }), null);
});

test('R16 #2 hours are append-only: removals and reductions are problems; a correction is a reversing entry with a reason; totals net', () => {
  const t0 = [{ by: 'lp', date: '2026-11-16', hours: 6, at: '2026-11-16T20:00:00Z' }, { by: 'lp', date: '2026-11-17', hours: 4, at: '2026-11-17T20:00:00Z' }];
  assert.equal(E.timeEntryProblem(t0, t0.concat([{ by: 'lp', date: '2026-11-18', hours: 2 }])), null);
  assert.equal(E.timeEntryProblem(t0, t0.slice(1)).kind, 'removed');
  assert.equal(E.timeEntryProblem(t0, [Object.assign({}, t0[0], { hours: 3 }), t0[1]]).kind, 'removed');
  assert.equal(E.timeEntryProblem(t0, t0.map(t => Object.assign({}, t, { at: undefined }))), null, 'server stamps are not part of an entry');
  assert.equal(E.timeEntryProblem(t0, t0.concat([{ by: 'lp', date: '2026-11-18', hours: -3 }])).kind, 'no-reason');
  const c = E.reverseEntry(t0[0], 3, 'Double-logged', 'lp', '2026-11-18');
  assert.deepEqual([c.hours, c.reason, c.reverses, c.correction], [-3, 'Double-logged', t0[0].at, true]);
  assert.equal(E.timeEntryProblem(t0, t0.concat([c])), null);
  assert.equal(E.timeEntryProblem(t0, t0.concat([E.reverseEntry(t0[0], 20, 'x', 'lp', '2026-11-18')])).kind, 'below-zero');
  assert.equal(E.timeEntryText(c), '−3 hours on Nov 18 (correction: “Double-logged”)');
  const d = SEED.seed(GOLD_DAY).docs;
  const w = { id: 'WX', owner: 'lp', time: t0.concat([c]) };
  const tot = E.hoursTotals(d, w);
  assert.equal(tot.hours, 7);
  assert.match(tot.text, /^7 hours \(\$[\d,]+\)$/);
});

test('R16 #2 a past period never changes after the fact: a correction or backdated entry logged later is left out', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const prj = d.project.find(p => p.id === PRJ).data;
  const w = d.workItem.map(x => x.data).find(x => x.projectId === PRJ && Array.isArray(x.time) && x.time.length);
  const from = '2026-11-09', to = '2026-11-13';
  const before = E.periodReport(d, PRJ, { preset: 'custom', from, to }, GOLD_DAY);
  w.time = w.time.concat([{ by: w.owner, date: '2026-11-10', hours: 40, at: GOLD_DAY + 'T15:00:00.000Z', backdated: true },
    Object.assign(E.reverseEntry(w.time[0], 1, 'fix', w.owner, '2026-11-11'), { at: GOLD_DAY + 'T15:01:00.000Z' })]);
  const after = E.periodReport(d, PRJ, { preset: 'custom', from, to }, GOLD_DAY);
  assert.deepEqual(JSON.stringify(after.overall && after.overall.budget), JSON.stringify(before.overall && before.overall.budget));
  void prj;
});

test('R16 #4 a move out of a department ends approver rights and reopens their approvals before launch; a joiner is told why', () => {
  let d = SEED.seed(GOLD_DAY).docs;
  const AR = 'access-review-automation';
  const ok0 = E.readiness(d, AR, GOLD_DAY).checks.find(c => c.id === 'bu-signoff');
  assert.ok(ok0.sectionStatus.find(x => x.bu === 'IT').approved, 'Sam approved IT');
  // Sam moves to Treasury: IT no longer names him, his IT approval reopens with the reason
  const r = E.departmentEdit(d, { kind: 'assign', personId: 'sk', id: 'dept-treasury', at: GOLD_DAY + 'T15:00:00.000Z' });
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.departments.find(x => x.name === 'IT').approvers, []);
  assert.ok(r.departments.find(x => x.name === 'IT').approverRemoved.sk);
  assert.deepEqual(r.people.find(p => p.id === 'sk').leftDepartments, [{ bu: 'IT', at: GOLD_DAY + 'T15:00:00.000Z' }]);
  d = r16apply(d, r);
  assert.ok(!/Sam Keller/.test(E.departmentApprovers(d, 'IT').text), E.departmentApprovers(d, 'IT').text);
  const so = E.readiness(d, AR, GOLD_DAY).checks.find(c => c.id === 'bu-signoff');
  assert.equal(so.sectionStatus.find(x => x.bu === 'IT').approved, false);
  assert.deepEqual(so.reopened.map(x => [x.bu, x.person, x.reason]), [['IT', 'sk', 'Sam Keller moved out of IT, so their approval no longer counts']]);
  assert.match(so.detail, /IT reopened: Sam Keller moved out of IT/);
  const st = E.approverStatus(d, AR, 'IT', 'sk');
  assert.equal(st.eligible, false); assert.match(st.you, /^You moved out of IT, so you no longer approve its part/);
  // even when an older settings doc still names him (a legacy move), "Approves: Sam" is not shown
  const legacy = withDepts(d, wsSettings(d).departments.map(x => x.name === 'IT' ? Object.assign({}, x, { approvers: ['sk'] }) : x));
  assert.ok(!/Sam Keller/.test(E.departmentApprovers(legacy, 'IT').text));
  // a launched project keeps its record
  const live = JSON.parse(JSON.stringify(d)); live.project.find(p => p.id === AR).data.status = 'live';
  const lso = E.readiness(live, AR, GOLD_DAY).checks.find(c => c.id === 'bu-signoff');
  assert.deepEqual(lso ? lso.reopened || [] : [], [], 'a launched project (frozen readiness) reopens nothing');
  // removal as approver: dated, and the approval reopens too
  let d2 = SEED.seed(GOLD_DAY).docs;
  const r2 = E.departmentEdit(d2, { kind: 'approvers', id: 'dept-it', approvers: ['dk'], at: GOLD_DAY + 'T15:00:00.000Z' });
  d2 = r16apply(d2, r2);
  assert.match(E.readiness(d2, AR, GOLD_DAY).checks.find(c => c.id === 'bu-signoff').reopened[0].reason, /Sam Keller is no longer an approver for IT/);
  // a joiner after testing started is told why, in plain words
  let d3 = SEED.seed(GOLD_DAY).docs;
  d3 = r16apply(d3, E.departmentEdit(d3, { kind: 'approvers', id: 'dept-compliance', approvers: [], at: GOLD_DAY + 'T14:00:00.000Z' }));   /* members approve */
  const r3 = E.departmentEdit(d3, { kind: 'assign', personId: 'gw', id: 'dept-compliance', at: GOLD_DAY + 'T15:00:00.000Z' });
  d3 = r16apply(d3, r3);
  const runsAt = d3.testRun.map(x => x.data).filter(x => x.projectId === PRJ && x.at).map(x => x.at).sort()[0];
  assert.ok(runsAt && runsAt < GOLD_DAY + 'T15:00:00.000Z');
  const js = E.approverStatus(d3, PRJ, 'Compliance', 'gw');
  assert.equal(js.rule, 'recent-move');
  assert.match(js.you, /^You joined Compliance after its testing started, so you can’t approve its part\. Ask Dave Ortiz\.$/);
});

test('R16 #5 no phantom part after a hand-over: the former PM\'s launch tasks add no part; nothing to sign is never asked', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const p = d.project.find(x => x.id === PRJ).data;
  const before = E.readiness(d, PRJ, GOLD_DAY).checks.find(c => c.id === 'bu-signoff').sections;
  assert.ok(!before.includes('PMO'));
  // Tom hands the PM and launch owner roles to Maya (an applied plan change); his launch-day task stays his
  p.owner = 'mc'; p.releaseManager = 'mc';
  d.planChange = (d.planChange || []).concat([{ id: 'pc-r16', data: { id: 'pc-r16', projectId: PRJ, status: 'applied', appliedAt: GOLD_DAY + 'T15:00:00Z',
    edits: [{ op: 'set', type: 'project', id: PRJ, field: 'owner', from: 'ta', to: 'mc' }, { op: 'set', type: 'project', id: PRJ, field: 'releaseManager', from: 'ta', to: 'mc' }] } }]);
  assert.deepEqual(E.formerLeads(d, p), ['ta']);
  const so = E.readiness(d, PRJ, GOLD_DAY).checks.find(c => c.id === 'bu-signoff');
  assert.ok(!so.sections.includes('PMO'), 'no PMO part: ' + so.sections.join(','));
  assert.equal(E.partHasWork(d, PRJ, 'PMO'), false);
  assert.equal(E.buReady(d, PRJ, 'PMO').needed, false);
  assert.ok(!E.approvalAsks(d, PRJ, GOLD_DAY).some(a => a.bu === 'PMO'));
  // an approval of it never counts
  d.approval.push({ id: 'AP-pmo', data: { id: 'AP-pmo', projectId: PRJ, bu: 'PMO', approver: 'ps', decision: 'approved', at: GOLD_DAY + 'T16:00:00Z', stepUp: true } });
  assert.ok(!E.readiness(d, PRJ, GOLD_DAY).checks.find(c => c.id === 'bu-signoff').sectionStatus.some(x => x.bu === 'PMO'));
});

test('R16 #6 hand-over approvals never route to an Admin who became Admin after the project started; another Admin instead', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const ws = d.workspace.find(x => x.id === 'settings').data;
  const start = E.projectStartedAt(d, PRJ);
  assert.ok(start && start < GOLD_DAY + 'T00:00:00.000Z', start);
  const first = E.deadlineApprover(d, PRJ, 'ta');
  assert.equal(first.role, 'admin');
  // that Admin became Admin 20 minutes ago: someone else is asked
  ws.roleSince = Object.assign({}, ws.roleSince, { [first.person]: GOLD_DAY + 'T15:00:00.000Z' });
  assert.equal(E.newerThanProject(d, d.project.find(x => x.id === PRJ).data, first.person), true);
  const next = E.deadlineApprover(d, PRJ, 'ta');
  assert.notEqual(next.person, first.person);
  // nobody older: nobody is chosen, and the sentence says why
  E.adminsOf(d).forEach(id => { ws.roleSince[id] = GOLD_DAY + 'T15:00:00.000Z'; });
  const none = E.deadlineApprover(d, PRJ, 'ta');
  assert.equal(none.person, null); assert.match(none.text, /after this project started/);
});

test('R16 #7/#8 launch window guard, dependency shift, cost over budget; clearing a Jira hold warns and keeps it out of EV', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const p = d.project.find(x => x.id === PRJ).data;   /* deadline Wed Dec 30 */
  assert.equal(E.launchWindowGuard(d, PRJ, '2026-12-25 07:30').kind, 'day-off');
  assert.match(E.launchWindowGuard(d, PRJ, '2026-12-25').text, /Fri Dec 25, Christmas Day/);
  assert.equal(E.launchWindowGuard(d, PRJ, '2027-01-15 07:30').kind, 'after-deadline');
  assert.equal(E.launchWindowGuard(d, PRJ, '2026-12-29 07:30–10:00'), null);
  // W11 (idle, no deps) waits on W8 (in progress): it starts the business day after W8 is expected to finish
  const w11 = d.workItem.find(x => x.id === 'W11').data;
  const fc = E.forecastAll(d, GOLD_DAY);
  const sh = E.dependencyShift(d, w11, ['W8'], GOLD_DAY);
  assert.equal(sh.moved, true);
  assert.equal(sh.start, E.addBusinessDays(fc.W8.forecast, 1));
  assert.equal(E.businessDaysBetween(sh.start, sh.due), E.businessDaysBetween(w11.start, w11.due));
  assert.match(sh.text, /now waits for “.*”, so it starts /);
  assert.equal(E.dependencyShift(d, w11, [], GOLD_DAY).moved, false);
  assert.equal(E.dependencyShift(d, d.workItem.find(x => x.id === 'W8').data, ['W12'], GOLD_DAY).moved, false, 'work in progress keeps its start');
  // cost over budget, even under the 5% step
  const after = JSON.parse(JSON.stringify(d));
  const est = E.projectTruth(d, PRJ, GOLD_DAY).cost.estimate;   /* $45,300 of work against the $48,000 budget */
  after.workItem.find(x => x.id === 'W11').data.cost = Math.ceil(p.budget.planned - est + 100);   /* +$2,800: 6%, over the budget */
  const cb = E.costBreach(d, after, PRJ, GOLD_DAY);
  assert.ok(cb && cb.overBudget, JSON.stringify(cb)); assert.match(cb.text, /over the \$48,000 budget/);
  // a Jira hold on W7 (it waits on W6, still open): clearing it warns like the PM confirm, and earns nothing until confirmed
  const w7 = d.workItem.find(x => x.id === 'W7').data;
  w7.syncHold = { kind: 'order', reason: 'Done in Jira while W6 is open', confirmBy: 'dk', tool: 'Jira', key: 'NW-7' };
  assert.equal(E.holdClearWarning(d, w7), E.unconfirmedDone(d, Object.assign({}, w7, { status: 'done', syncHold: undefined })).confirmText);
  assert.match(E.holdClearWarning(d, 'W7'), /It depends on “.*”, which is still open\. Confirm “.*” is done anyway\?/);
  const cleared = JSON.parse(JSON.stringify(d));
  const c7 = cleared.workItem.find(x => x.id === 'W7').data; delete c7.syncHold; c7.status = 'done'; c7.doneBy = 'dk'; c7.time = [{ by: 'dk', date: GOLD_DAY, hours: 8 }];
  assert.equal(E.unconfirmedDone(cleared, 'W7').flag, true);
  const ev0 = E.earnedValue(d, PRJ, GOLD_DAY), ev1 = E.earnedValue(cleared, PRJ, GOLD_DAY);
  assert.equal(ev1.EV != null ? ev1.EV : ev1.ev, ev0.EV != null ? ev0.EV : ev0.ev, 'a cleared hold with an open predecessor stays out of EV');
});

test('R16 #7 PMO repro: with the expected cost already over budget, an effort edit 4 → 5 days is a plan change', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  assert.ok(E.projectTruth(d, PRJ, GOLD_DAY).cost.overBudget, 'the seed is $847 over');
  const after = JSON.parse(JSON.stringify(d));
  after.workItem.find(x => x.id === 'W7').data.effortDays = 5;
  const cb = E.costBreach(d, after, PRJ, GOLD_DAY);
  assert.ok(cb && cb.overBudget && cb.pct < E.COST_TOLERANCE_PCT, JSON.stringify(cb));
  assert.match(cb.text, /^This raises the expected cost from \$48,847 to \$[\d,]+, over the \$48,000 budget\.$/);
});

test('R16 #9 BPM fourth round: boundary tests at every changed threshold on the gateway scripts; warnings become tests with the right counts; no sample min/max', () => {
  const I = require(path.join(ROOT, 'api', 'shared', 'pmoflow-import.js'));
  const sop = fs.readFileSync(path.join(ROOT, 'tests', 'pmoflow', 'fixtures', 'r15-credit-sop.txt'), 'utf8');
  const csv = fs.readFileSync(path.join(ROOT, 'tests', 'pmoflow', 'fixtures', 'r15-credit-sample.csv'), 'utf8');
  const r = I.parseSop(sop);
  const d = SEED.seed(GOLD_DAY).docs;
  // information from the import, each with its own column of the sample
  const col = { 'Customer name': 'customer_name', 'Account number': 'account_number', 'Requested limit': 'requested_limit', 'Bank account': 'bank_account', 'Risk score': 'risk_score' };
  const rows = E.parseCsv(csv); const hdr = rows[0];
  const idOf = {};
  r.newData.forEach((nd, i) => {
    const id = 'DC' + i; idOf[nd.name] = id;
    d.dataElement.push({ id, data: { id, name: nd.name, avail: 'live', fields: [] } });
    if (col[nd.name]) {
      const j = hdr.indexOf(col[nd.name]);
      const one = rows.map(x => x[j] == null ? '' : /[",]/.test(x[j]) ? '"' + String(x[j]).replace(/"/g, '""') + '"' : x[j]).join('\n');
      d.profile.push({ id: 'PF' + i, data: { id: 'PF' + i, dataId: id, at: GOLD_DAY + 'T10:00:00Z', columns: E.profileCsv(one, { context: nd.name }), rows: 10 } });
    }
  });
  const withData = ns => ns.map(n => { const o = Object.assign({}, n); const nd = r.newData.filter(x => (x.steps || []).includes(n.id)); if (nd.length) o.data = nd.map(x => idOf[x.name]); if (n.branches) o.branches = n.branches.map(b => Object.assign({}, b, { nodes: withData(b.nodes || []) })); return o; });
  const asis = withData(r.nodes);
  // the BPM's to-be: auto-approve up to $75,000 and a risk score of 65; the Controller above $200,000
  const tobe = JSON.parse(JSON.stringify(asis)).map(n => Object.assign(n, { from: n.id }));
  const g1 = tobe.find(n => n.id === 'd6'), g2 = tobe.find(n => n.id === 'd9');
  g1.title = 'Requested limit is $75,000 or less and the risk score is 65 or below?'; g1.threshold = Object.assign({}, g1.threshold, { amount: 75000 });
  g2.title = 'Requested limit over $200,000?'; g2.threshold = Object.assign({}, g2.threshold, { amount: 200000 });
  d.process.push({ id: 'credit16', data: { id: 'credit16', name: 'Credit limit request', owner: 'mc', resources: [], version: 1, released: [], asis, tobe } });
  d.project.push({ id: 'p16', data: { id: 'p16', name: 'Credit limits', owner: 'ta', processes: ['credit16'], status: 'active', target: E.addBusinessDays(GOLD_DAY, 40) } });
  // the conditions of the changed choices
  assert.deepEqual(E.gatewayConditions(g1).map(c => [c.subject, c.op, c.amount]), [['Requested limit', '<=', 75000], ['risk score', '<=', 65]]);
  const all = E.generateProjectTests(d, 'p16');
  const casesOf = name => ((all.find(x => x.dataId === idOf[name]) || {}).cases || []);
  const path_ = t => (/takes the “(\w+)” path/.exec(t.note) || [])[1];
  const lim = casesOf('Requested limit').filter(t => t.kind === 'boundary' && t.threshold);
  assert.deepEqual(lim.map(t => [t.input, path_(t)]), [['75000.00', 'Yes'], ['75000.01', 'No'], ['200000.00', 'No'], ['200000.01', 'Yes']]);
  // the unchanged risk score feeds the changed choice: 65 / 66 boundary tests
  assert.ok(E.changedInformation(d, 'p16').some(x => x.dataId === idOf['Risk score'] && x.reason === 'decision'));
  const risk = casesOf('Risk score');
  assert.deepEqual(risk.filter(t => t.threshold).map(t => [t.input, path_(t)]), [['65', 'Yes'], ['66', 'No']]);
  // no min/max from the sample: 29 is never rejected, and nothing says "Minimum value 30"
  assert.ok(!risk.some(t => t.input === '29' && t.expect === 'reject'), JSON.stringify(risk.map(t => [t.input, t.expect, t.note])));
  assert.ok(!all.some(x => x.cases.some(t => /Minimum value 30|Just below minimum/.test(t.note) && x.dataId === idOf['Risk score'])));
  // warnings become tests, with the sample's counts (7 in 3 groups), on unchanged information too
  const nameT = casesOf('Customer name').find(t => t.signal === 'near-duplicate');
  assert.ok(nameT, 'near-duplicate names get a test'); assert.match(nameT.note, /7 records in 3 groups/);
  assert.ok(casesOf('Bank account').some(t => t.signal === 'shared-account'), 'the shared bank account gets a test');
  assert.ok(casesOf('Account number').some(t => t.signal === 'unique'), 'the account number (all different) gets a uniqueness test');
  // never "observed in the extract: leading zero" when no value starts with 0
  assert.ok(!all.some(x => x.cases.some(t => /observed in the extract: leading zero/i.test(t.note))));
  // the masked example matches the rule (6 characters, 2 capital letters and 4 digits)
  assert.equal(E.maskValue('NW1001'), 'XX9999');
  assert.equal(E.maskValue('Acme Corp'), 'Xxxx Xxxx', 'names still never show their length');
  // the boundary values are on the gateway scripts too
  const scr = E.generateUatScripts(d, 'p16').filter(x => x.step === 'd6');
  const yes = scr.find(x => / → Yes$/.test(x.title)), no = scr.find(x => / → No$/.test(x.title));
  assert.deepEqual(yes.boundaries.map(b => b.input), ['75000.00', '65']);
  assert.deepEqual(no.boundaries.map(b => b.input), ['75000.01', '66']);
  assert.ok(yes.steps.some(st => st.boundary && /Requested limit \$75,000\.00/.test(st.action)), JSON.stringify(yes.steps));
  assert.match(no.when, /try Requested limit \$75,000\.01 \(with the other conditions met\) and Risk score 66/);
});

test('R16 #10 counts: late wording, unconfirmed clears on confirm, no done-before-start, within tolerance is "no approval needed", one past finish', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  // late wording: past due and expected lateness in one sentence
  assert.equal(E.lateInfo(d, 'W6', GOLD_DAY).text, '1 business day past due; expected to finish 6 business days late');
  // unconfirmed clears when someone else confirms
  const d1 = R14set(d, 'W7', { status: 'done', doneAt: GOLD_DAY, doneBy: 'dk' });
  assert.equal(E.projectTruth(d1, PRJ, GOLD_DAY).unconfirmed.count, 1);
  const d2 = R14set(d1, 'W7', { confirmedBy: 'ta' });
  assert.equal(E.projectTruth(d2, PRJ, GOLD_DAY).unconfirmed.count, 0);
  assert.ok(!E.readiness(d2, PRJ, GOLD_DAY).checks.find(c => c.id === 'work-done').unconfirmed.includes('W7'));
  // the variance never shows a task done before it started
  const bl = d.project.find(p => p.id === PRJ).data.baselines[0];
  const d3 = R14set(d, 'W7', { status: 'done', doneAt: E.addBusinessDays(GOLD_DAY, -3), doneBy: 'dk', confirmedBy: 'ta' });
  const row = E.baselineVariance(d3, PRJ, bl.id, GOLD_DAY).find(r => r.workId === 'W7');
  assert.ok(row.start <= row.forecast, JSON.stringify(row));
  // a change applied within tolerance with nobody deciding: "no approval needed"
  const d4 = SEED.seed(GOLD_DAY).docs;
  d4.planChange = (d4.planChange || []).concat([{ id: 'pc-tol', data: { id: 'pc-tol', projectId: PRJ, title: 'Move the test deposit', status: 'applied', at: GOLD_DAY + 'T09:00:00Z', appliedAt: GOLD_DAY + 'T09:05:00Z', tolerance: { within: true }, approvers: [], edits: [] } }]);
  const pr = E.periodReport(d4, PRJ, { preset: 'this-week' }, GOLD_DAY);
  const pc = pr.planChanges.find(c => c.id === 'pc-tol');
  assert.match(pc.text, /no approval needed/); assert.doesNotMatch(pc.text, /approved/);
  // a past range: the headline's expected finish and the change line agree (from the forecast log)
  const past = E.periodReport(d, PRJ, { preset: 'custom', from: '2026-11-02', to: '2026-11-06' }, GOLD_DAY);
  assert.ok(past.slipText.includes(E.fmtDay(past.overall.forecastFinish)), past.slipText + ' / ' + past.overall.forecastFinish);
  // this week and the last two weeks read the forecast log: from = the entry before the window
  const fl = d.project.find(p => p.id === PRJ).data.forecastLog;
  ['this-week', 'last-2-weeks'].forEach(k => {
    const r = E.periodReport(d, PRJ, { preset: k }, GOLD_DAY);
    const before = fl.filter(x => x.date < r.window.from).pop();
    assert.equal(r.forecastFinishThen, before.finish, k);
    assert.equal(r.forecastFinishEnd, E.projectTruth(d, PRJ, GOLD_DAY).forecastFinish, k);
  });
});

test('R16 N2 follow-up #1: diffProcess lists non-money and compound threshold changes (risk score 60 → 65)', () => {
  const gw = (title, amount) => ({ id: 'g', type: 'decision', title, threshold: { subject: 'requested limit', op: '<=', amount, compound: true }, branches: [{ label: 'Yes', nodes: [] }, { label: 'No', nodes: [] }] });
  const p = { asis: [gw('Requested limit is $50,000 or less and the risk score is 60 or below?', 50000)], tobe: [Object.assign(gw('Requested limit is $50,000 or less and the risk score is 65 or below?', 50000), { from: 'g' })] };
  const ch = E.diffProcess(p).changes.g || [];
  assert.ok(ch.some(x => /^Threshold for risk score: at most 60 → at most 65$/.test(x)), JSON.stringify(ch));
  assert.ok(!ch.some(x => /requested limit/i.test(x) && /Threshold/.test(x)), 'the unchanged limit is not listed');
  // the single money case keeps its words
  const q = { asis: [{ id: 'h', type: 'decision', title: 'Requested limit over $250,000?', threshold: { subject: 'requested limit', op: '>', amount: 250000 }, branches: [] }],
    tobe: [{ id: 'h', from: 'h', type: 'decision', title: 'Requested limit over $300,000?', threshold: { subject: 'requested limit', op: '>', amount: 300000 }, branches: [] }] };
  assert.ok((E.diffProcess(q).changes.h || []).includes('Threshold over $250,000 → over $300,000'));
  // an imported inclusive op ('<=') is read as "at most"
  assert.deepEqual(E.gatewayConditions({ title: 'Amount $10,000 or less?', threshold: { subject: 'amount', op: '<=', amount: 10000 } }).map(c => c.op), ['<=']);
});

test('R16 N2 follow-up #2: teamRouting counts Launch-chosen approvers and leaves out the PM, so it says what Launch says', () => {
  const d = r15Credit();
  const settings = d.workspace.find(w => w.id === 'settings').data;
  settings.departments = settings.departments.map(x => x.name === 'Accounts Receivable' ? Object.assign({}, x, { approvers: [] }) : x);   /* no approvers, no members */
  let tr = E.teamRouting(d, 'credit');
  assert.ok(tr.noApprover.includes('AR Specialist'), JSON.stringify(tr.noApprover));
  // Launch has a chosen approver for the part: the process page agrees
  d.project.find(p => p.id === 'pcr').data.approvers = { 'Accounts Receivable': 'ar' };
  assert.ok(E.partApprovers(d, 'pcr', 'Accounts Receivable').eligible.includes('ar'));
  tr = E.teamRouting(d, 'credit');
  assert.ok(!tr.noApprover.includes('AR Specialist'), JSON.stringify(tr.noApprover));
  // the PM is never an approver: a department whose only possible approver is the PM has nobody, on both pages
  d.project.find(p => p.id === 'pcr').data.approvers = { 'Accounts Receivable': 'ta' };
  settings.departments = settings.departments.map(x => x.name === 'Accounts Receivable' ? Object.assign({}, x, { approvers: ['ta'] }) : x);
  assert.deepEqual(E.partApprovers(d, 'pcr', 'Accounts Receivable').eligible, []);
  tr = E.teamRouting(d, 'credit');
  assert.ok(tr.noApprover.includes('AR Specialist'), JSON.stringify(tr));
  assert.match(tr.text, /ha(s|ve) nobody to approve/);
});

test('R16 N2 follow-up #3: an approver invited by email shows on Launch: "Invited: <email> (can approve once they join)"', () => {
  const d = r15Credit();
  const settings = d.workspace.find(w => w.id === 'settings').data;
  settings.departments = settings.departments.map(x => x.name === 'Accounts Receivable' ? Object.assign({}, x, { approvers: [] }) : x);
  settings.invites = [{ id: 'inv1', email: 'jordan.lee@northwind.example', role: 'approver', departmentId: 'dept-ar', by: 'ta', at: GOLD_DAY + 'T10:00:00Z' }];
  assert.deepEqual(E.departmentInvites(d, 'Accounts Receivable').map(i => i.email), ['jordan.lee@northwind.example']);
  const pa = E.partApprovers(d, 'pcr', 'Accounts Receivable');
  assert.deepEqual(pa.invited, ['jordan.lee@northwind.example']);
  assert.equal(pa.invitedText, 'Invited: jordan.lee@northwind.example (can approve once they join)');
  assert.match(pa.text, /Invited: jordan\.lee@northwind\.example \(can approve once they join\)/);
});

test('R16 N2 follow-up #4: the profile line keeps one wording before and after Add tests (BPM disagreement 4)', () => {
  const csv = fs.readFileSync(path.join(ROOT, 'tests', 'pmoflow', 'fixtures', 'r15-credit-sample.csv'), 'utf8');
  const prof = E.profileCsv(csv).filter(c => c.name === 'risk_score');   /* 10 rows, 1 empty, one 101 */
  const before = E.profileLines({ id: 'DR', name: 'Risk score', fields: [] }, prof)[0].text;
  const after = E.profileLines({ id: 'DR', name: 'Risk score', fields: E.specFromProfile(prof) }, prof)[0].text;
  assert.match(before, /1 is empty/); assert.match(after, /1 is empty/);
  assert.doesNotMatch(after, /9 don't match/);
  // only the real outlier (101, a score is 0–100) is counted against the rule; the sample's range is never the rule
  assert.match(after, /1 doesn't match the pattern/);
});

test('R16 N3 follow-up #4: the no-hours check on a Done counts corrections in the net total', () => {
  const d = SEED.seed(GOLD_DAY).docs;
  const e = E.reverseEntry({ at: GOLD_DAY + 'T09:00:00Z' }, 6, 'Logged on the wrong task', 'dk', GOLD_DAY);
  const d1 = R14set(d, 'W11', { status: 'done', doneAt: GOLD_DAY, doneBy: 'dk', confirmedBy: 'dk', time: [{ by: 'dk', date: GOLD_DAY, hours: 6, at: GOLD_DAY + 'T09:00:00Z' }, e] });
  assert.ok(E.unconfirmedDone(d1, 'W11').reasons.includes('no-hours'), 'net 0 hours: still "Done with no hours logged"');
  const ev = E.earnedValue(d1, PRJ, GOLD_DAY);
  assert.ok((ev.doneNoHours || (ev.flags || []).flatMap(f => f.items || [])).includes('W11'), JSON.stringify(ev.flags || ev.doneNoHours));
  const d2 = R14set(d, 'W11', { status: 'done', doneAt: GOLD_DAY, doneBy: 'dk', time: [{ by: 'dk', date: GOLD_DAY, hours: 6 }, Object.assign({}, e, { hours: -2 })] });
  assert.ok(!E.unconfirmedDone(d2, 'W11').reasons.includes('no-hours'), '4 net hours count');
});
