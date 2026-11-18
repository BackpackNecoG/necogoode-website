/* PMOFlow R10.2 stream C: traceable plan changes (pure module + routes).
   Run: node --test tests/pmoflow/change.test.js
   Uses the store's in-memory backend unless EMCEE_STORAGE_CONNECTION is already set. Workspaces are deleted in after(). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const API = path.join(__dirname, '../../api');
const fn = require(path.join(API, 'pmoflow/index.js'));
const store = require(path.join(API, 'shared/pmoflow-store.js'));
const C = require(path.join(API, 'shared/pmoflow-change.js'));
const routes = require(path.join(API, 'shared/pmoflow-routes-change.js'));
const E = require(path.join(API, 'shared/pmoflow-engine.js'));
const { seed, DOC_TYPES } = require(path.join(API, 'shared/pmoflow-seed.js'));

const PRJ = 'vendor-modernization';
const created = [];
const rnd = () => Math.random().toString(36).slice(2, 10);
/* index.js loads route modules from ROUTE_MODULES; until the lead adds 'pmoflow-routes-change' there, call it directly */
const wired = fs.readFileSync(path.join(API, 'pmoflow/index.js'), 'utf8').includes("'pmoflow-routes-change'");
async function call(method, p, body, query) {
  const ctx = { res: null, log: Object.assign(() => {}, { error() {}, warn() {}, info() {} }) };
  const req = { method, url: '/api/pmoflow/' + p, headers: { 'x-forwarded-for': '127.0.0.31' }, params: { path: p }, query: query || {}, body };
  if (!wired && p.startsWith('workspaces/')) {
    const { _internal } = fn;
    const send = (status, b) => { ctx.res = { status, body: b }; };
    const fail = (status, error, reasons) => send(status, reasons ? { error, reasons } : { error });
    const seg = p.split('?')[0].split('/').filter(Boolean);
    await routes.handle({ method, seg, body, req, store, send, fail, clientIpHash: _internal.clientIpHash, dayInput: _internal.dayInput, clientToday: _internal.clientToday });
    return ctx.res;
  }
  await fn(ctx, req);
  return ctx.res;
}
async function newWs() {
  const hash = 'test-chg-' + rnd();
  const ws = await store.createWorkspace(hash, { id: 'tstchg' + rnd() + rnd() });
  created.push([ws.id, hash]);
  return ws;
}
test.after(async () => { for (const [id, hash] of created) await store.deleteWorkspace(id, hash).catch(() => {}); });

const docsOf = async wsId => (await store.getState(wsId)).docs;
const task = (docs, id) => (docs.workItem.find(d => d.id === id) || {}).data;
const proj = docs => docs.project.find(d => d.id === PRJ).data;
/* the server's "today" is its own UTC day (the client's when sent): use the same day for engine expectations */
const TODAY = new Date().toISOString().slice(0, 10);
const seedDocs = () => seed(TODAY).docs;
const preview = (docs, edits, extra) => {
  const { change, errors } = C.buildChange(Object.assign({ projectId: PRJ, reason: 'Test', edits }, extra || {}), docs);
  assert.deepEqual(errors, []);
  const after = C.applyToDocs(docs, change, '2099-01-01T00:00:00.000Z');
  return { change, after, im: C.impact(docs, after, PRJ, TODAY, { change }) };
};
const addBiz = (d, n) => E.addBusinessDays(d, n);
/* R12 #4: approving a plan change needs the extra sign-in check (simulated MFA), enforced by the server */
const STEP = () => ({ method: 'simulated-mfa', at: new Date().toISOString() });

test('planChange doc type is registered, the web copy is byte-identical', () => {
  assert.ok(DOC_TYPES.includes('planChange'));
  const a = fs.readFileSync(path.join(API, 'shared/pmoflow-change.js'));
  const b = fs.readFileSync(path.join(__dirname, '../../web/public/concepts/pmoflow/app/change.js'));
  assert.ok(a.equals(b), 'app/change.js must be byte-identical to api/shared/pmoflow-change.js');
});

test('impact numbers are the engine’s numbers on the after-docs', () => {
  const docs = seedDocs();
  const w6 = task(docs, 'W6');
  const { change, after, im } = preview(docs, [{ op: 'set', type: 'workItem', id: 'W6', field: 'due', to: addBiz(w6.due, 25) }]);
  const tb = E.projectTruth(docs, PRJ, TODAY), ta = E.projectTruth(after, PRJ, TODAY);
  assert.equal(im.finish.before, tb.forecastFinish);
  assert.equal(im.finish.after, ta.forecastFinish);
  assert.equal(im.deadline.after, ta.deadline);
  assert.equal(im.buffer.after, ta.bufferDays);
  assert.equal(im.cost.before, tb.cost.forecast);
  assert.equal(im.cost.after, ta.cost.forecast);
  assert.equal(im.late.after, ta.lateCount);
  assert.equal(im.label.after, ta.label);
  /* the knock-on forecasts are forecastAll's */
  const fa = E.forecastAll(after, TODAY);
  im.knockOn.forEach(k => assert.equal(k.to, fa[k.id].forecast));
  /* the after-docs are the change applied on a copy: the input is untouched */
  assert.equal(task(docs, 'W6').due, w6.due);
  assert.equal(task(after, 'W6').due, addBiz(w6.due, 25));
  assert.ok(im.finish.after > im.finish.before);
  assert.match(im.sentence, /^This moves the expected finish from \w{3} \d{1,2} to \w{3} \d{1,2} \(\d+ business days? (after|before) the \w{3} \d{1,2} deadline\)/);
  assert.equal(change.kinds.join(), 'dates');
});

test('a dependent knock-on: tasks after the moved one move too, and are marked as dependents', () => {
  const docs = seedDocs();
  const { im } = preview(docs, [{ op: 'set', type: 'workItem', id: 'W6', field: 'due', to: addBiz(task(docs, 'W6').due, 25) }]);
  const deps = E.dependents(docs, 'W6');                    /* W7, W8, W10 wait on W6 */
  ['W7', 'W8', 'W10'].forEach(id => assert.ok(deps.includes(id), id + ' depends on W6'));
  const ko = Object.fromEntries(im.knockOn.map(k => [k.id, k]));
  ['W7', 'W8', 'W10'].forEach(id => { assert.ok(ko[id], id + ' moves'); assert.equal(ko[id].dependent, true); assert.ok(ko[id].to > ko[id].from); });
  assert.ok(!ko.W6, 'the edited task is not a knock-on');
  /* people affected: the edited task's owner and the knock-on owners */
  const ids = im.people.map(p => p.id);
  ['lp', 'dk', 'ar', 'ta'].forEach(id => assert.ok(ids.includes(id), id + ' is affected'));
});

test('tolerance: within / finish past deadline / deadline / budget / cost ≥ 5% / approvals reopen', () => {
  const docs = seedDocs();
  /* within: the owner of one task changes, the finish and deadline hold, cost moves < 5% */
  let r = preview(docs, [{ op: 'set', type: 'workItem', id: 'W11', field: 'owner', to: 'ar' }]);
  let need = C.needsApproval(r.change, r.im, docs);
  assert.ok(Math.abs(r.im.cost.pct) < 5);
  assert.equal(need.within, true); assert.deepEqual(need.approvers, []);
  /* the finish moves past the deadline: the project manager approves (no sponsor: deadline and budget did not move) */
  r = preview(docs, [{ op: 'set', type: 'workItem', id: 'W6', field: 'due', to: addBiz(task(docs, 'W6').due, 25) }]);
  need = C.needsApproval(r.change, r.im, docs);
  assert.equal(need.within, false); assert.match(need.reasons[0], /past the .* deadline/);
  /* R12 #13: W6 also moves an ERP task (a cross-project knock-on), so ERP's project manager approves too */
  assert.deepEqual(need.approvers, [{ role: 'pm', person: 'ta' }, { role: 'linkedPm', person: 'ta', projectId: 'erp-upgrade-readiness' }]);
  /* the deadline moves: project manager and sponsor (the process owner, as no sponsor is set) */
  r = preview(docs, [{ op: 'set', type: 'project', id: PRJ, field: 'target', to: addBiz(proj(docs).target, 5) }]);
  need = C.needsApproval(r.change, r.im, docs);
  assert.equal(need.within, false);
  assert.deepEqual(need.approvers, [{ role: 'pm', person: 'ta' }, { role: 'sponsor', person: 'mc' }]);
  assert.equal(r.change.kinds.join(), 'deadline');
  /* an explicit sponsor wins */
  const d2 = JSON.parse(JSON.stringify(docs)); proj(d2).sponsor = 'do';
  r = preview(d2, [{ op: 'set', type: 'project', id: PRJ, field: 'budget', to: 50000 }]);
  need = C.needsApproval(r.change, r.im, d2);
  assert.deepEqual(need.approvers, [{ role: 'pm', person: 'ta' }, { role: 'sponsor', person: 'do' }]);
  assert.ok(need.reasons.some(x => /budget changes/.test(x)));
  /* cost ≥ 5%: removing an open task */
  r = preview(docs, [{ op: 'remove', type: 'workItem', id: 'W7' }]);
  need = C.needsApproval(r.change, r.im, docs);
  assert.ok(Math.abs(r.im.cost.pct) >= 5, 'cost moves ' + r.im.cost.pct + '%');
  assert.ok(need.reasons.some(x => /expected cost changes by/.test(x)));
  /* removing W7 also records that W7 no longer holds anything up (an automatic edit) */
  assert.ok(r.change.edits.every(e => e.op === 'remove' || e.auto));
  /* an approval reopens: Treasury approved after W6 was last saved; moving W6 (a Treasury task) reopens it */
  const d3 = JSON.parse(JSON.stringify(docs));
  /* R11 separation of duties: the approver must be someone allowed to approve Treasury's part */
  const okApprover = (d3.person || []).map(p => p.id || (p.data && p.data.id)).find(pid => pid && pid !== 'ta' && !E.approvalBar(d3, PRJ, 'Treasury', pid));
  assert.ok(okApprover, 'someone may approve Treasury');
  d3.approval.push({ id: 'AP-T', data: { id: 'AP-T', projectId: PRJ, bu: 'Treasury', approver: okApprover, decision: 'approved', at: '2098-01-01T00:00:00.000Z', stepUp: true } });
  d3.workItem.forEach(w => { if (w.data.projectId === PRJ) delete w.data.updatedAt; });
  const before = E.projectTruth(d3, PRJ, TODAY).approvals.find(a => a.bu === 'Treasury');
  assert.equal(before.approved, true);
  r = preview(d3, [{ op: 'set', type: 'workItem', id: 'W12', field: 'due', to: addBiz(task(d3, 'W12').due, 1) }]);
  assert.deepEqual(r.im.approvalsReopen.map(a => a.bu), ['Treasury']);
  assert.equal(E.projectTruth(r.after, PRJ, TODAY).approvals.find(a => a.bu === 'Treasury').approved, false);
  need = C.needsApproval(r.change, r.im, d3);
  assert.equal(need.within, false);
  assert.ok(need.reasons.some(x => /Treasury’s approval reopens/.test(x)));
  assert.match(r.im.sentence, /reopens Treasury’s approval\.$/);
});

test('buildChange: reason required, no-op edits dropped, from-values filled, bad edits refused', () => {
  const docs = seedDocs();
  let r = C.buildChange({ projectId: PRJ, reason: '', edits: [{ op: 'set', type: 'workItem', id: 'W6', field: 'due', to: task(docs, 'W6').due }] }, docs);
  assert.ok(r.errors.some(e => /why/.test(e)));
  assert.ok(r.errors.some(e => /Nothing changes/.test(e)));
  r = C.buildChange({ projectId: PRJ, reason: 'x', edits: [{ op: 'set', type: 'workItem', id: 'A1', field: 'due', to: '2030-01-01' }] }, docs);
  assert.ok(r.errors.some(e => /not part of the project/.test(e)));
  r = C.buildChange({ projectId: PRJ, reason: 'x', edits: [{ op: 'set', type: 'workItem', id: 'W6', field: 'status', to: 'done' }] }, docs);
  assert.ok(r.errors.length);
  r = C.buildChange({ projectId: PRJ, reason: 'Client asked', category: 'client', edits: [{ op: 'set', type: 'workItem', id: 'W6', field: 'owner', to: 'dk' }] }, docs);
  assert.deepEqual(r.errors, []);
  assert.equal(r.change.edits[0].from, 'lp');
  assert.equal(r.change.title, 'Give “Set up the bank details form” to Dev Kumar');
  assert.equal(r.change.category, 'client');
});

test('apply (within tolerance): edits written, before/after Saved plans, log entry, history, notifications', async () => {
  const ws = await newWs();
  const docs0 = await docsOf(ws.id);
  const bl0 = (proj(docs0).baselines || []).length;
  const r = await call('POST', `workspaces/${ws.id}/changes`, { actor: 'lp', change: { projectId: PRJ, reason: 'Leo is out next week', category: 'resource',
    edits: [{ op: 'set', type: 'workItem', id: 'W11', field: 'owner', to: 'ar' }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.applied, true);
  const c = r.body.change;
  assert.equal(c.status, 'applied');
  assert.equal(c.requestedBy, 'lp'); assert.equal(c.appliedBy, 'lp');
  assert.equal(c.tolerance.within, true);
  assert.ok(c.impact.sentence.length > 10);
  const docs = await docsOf(ws.id);
  assert.equal(task(docs, 'W11').owner, 'ar');
  assert.ok(task(docs, 'W11').updatedAt, 'updatedAt stamped like a normal save');
  const bls = proj(docs).baselines;
  assert.equal(bls.length, bl0 + 2);
  const before = bls.find(b => b.id === c.baselines.before), after = bls.find(b => b.id === c.baselines.after);
  assert.ok(before && after);
  assert.match(before.label, /· before$/); assert.match(after.label, /· after$/);
  assert.ok(before.label.startsWith(c.title.slice(0, 20)));
  assert.equal(before.changeId, c.id);
  assert.equal(c.snapshots.before.W11.owner, 'dk'); assert.equal(c.snapshots.after.W11.owner, 'ar');
  /* the stored log entry */
  const stored = docs.planChange.find(d => d.id === c.id).data;
  assert.equal(stored.status, 'applied');
  assert.equal(stored.reason, 'Leo is out next week');
  assert.ok(stored.edits.length === 1 && stored.edits[0].from === 'dk' && stored.edits[0].to === 'ar');
  /* history: the task edit and the change, both by the requester */
  const evs = await store.listEvents(ws, { limit: 50 });
  assert.ok(evs.some(e => e.ref === 'workItem:W11' && /owner Dev Kumar → Ana Ruiz/.test(e.summary) && /plan change/.test(e.summary) && e.actor === 'lp'));
  assert.ok(evs.some(e => e.ref === 'planChange:' + c.id && /Applied plan change/.test(e.summary)));
  /* notifications: the old and the new owner, and the project manager, never the actor */
  const to = docs.notification.map(n => n.data).filter(n => /Plan change on/.test(n.text)).map(n => n.to).sort();
  assert.deepEqual(to, ['ar', 'dk', 'ta']);
  /* the task's change list */
  assert.deepEqual(C.changesForTask(docs, 'W11').map(x => x.id), [c.id]);
});

test('over tolerance: proposed, waiting in the approver’s queue, approve by a second persona applies it', async () => {
  const ws = await newWs();
  const docs0 = await docsOf(ws.id);
  const newDue = addBiz(task(docs0, 'W6').due, 25);
  const r = await call('POST', `workspaces/${ws.id}/changes`, { actor: 'lp', change: { projectId: PRJ, reason: 'Bank portal vendor delayed', category: 'dependency',
    edits: [{ op: 'set', type: 'workItem', id: 'W6', field: 'due', to: newDue }] } });
  assert.equal(r.status, 200);
  const c = r.body.change;
  assert.equal(c.status, 'proposed'); assert.equal(r.body.applied, false);
  assert.deepEqual(c.approvers.map(a => [a.role, a.person, a.decision]), [['pm', 'ta', null], ['linkedPm', 'ta', null]]);
  let docs = await docsOf(ws.id);
  assert.equal(task(docs, 'W6').due, task(docs0, 'W6').due, 'nothing applied yet');
  const q = C.queueFor(docs, 'ta', TODAY);
  assert.equal(q.length, 1);
  assert.equal(q[0].kind, 'planChange'); assert.equal(q[0].href, `/project/${PRJ}/changes?change=${c.id}`); assert.equal(q[0].rank, 50);
  assert.deepEqual(C.queueFor(docs, 'lp', TODAY), []);
  assert.ok(docs.notification.some(n => n.data.to === 'ta' && /asks you to approve/.test(n.data.text)));
  /* the requester cannot approve; the apply route refuses while it is over tolerance */
  const self = await call('POST', `workspaces/${ws.id}/changes/${c.id}/decide`, { actor: 'lp', decision: 'approve' });
  assert.equal(self.status, 403); assert.match(self.body.error, /Only Tom Alvarez \(project manager\)/);
  const early = await call('POST', `workspaces/${ws.id}/changes/${c.id}/apply`, { actor: 'lp' });
  assert.equal(early.status, 409); assert.match(early.body.error, /needs approval/);
  /* the project manager approves: it applies */
  const ok = await call('POST', `workspaces/${ws.id}/changes/${c.id}/decide`, { actor: 'ta', decision: 'approve', note: 'Agreed', stepUp: STEP() });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.change.status, 'applied');
  assert.equal(ok.body.change.decidedBy, 'ta'); assert.equal(ok.body.change.appliedBy, 'ta');
  docs = await docsOf(ws.id);
  assert.equal(task(docs, 'W6').due, newDue);
  assert.deepEqual(C.queueFor(docs, 'ta', TODAY), []);
  const evs = await store.listEvents(ws, { limit: 50 });
  assert.ok(evs.some(e => e.ref === 'planChange:' + c.id && e.action === 'approve' && e.actor === 'ta'));
});

test('a deadline move needs the project manager and the sponsor; the PM’s own request counts as the PM’s approval', async () => {
  const ws = await newWs();
  const docs0 = await docsOf(ws.id);
  const r = await call('POST', `workspaces/${ws.id}/changes`, { actor: 'ta', stepUp: STEP(), change: { projectId: PRJ, reason: 'Client moved go-live', category: 'client',
    edits: [{ op: 'set', type: 'project', id: PRJ, field: 'target', to: addBiz(proj(docs0).target, 5) }] } });
  const c = r.body.change;
  assert.equal(c.status, 'proposed');
  assert.deepEqual(c.approvers.map(a => [a.role, a.person, a.decision]), [['pm', 'ta', 'approved'], ['sponsor', 'mc', null]]);
  const ok = await call('POST', `workspaces/${ws.id}/changes/${c.id}/decide`, { actor: 'mc', decision: 'approve', stepUp: STEP() });
  assert.equal(ok.body.change.status, 'applied');
  assert.equal(proj(await docsOf(ws.id)).target, addBiz(proj(docs0).target, 5));
});

test('reject changes nothing', async () => {
  const ws = await newWs();
  const docs0 = await docsOf(ws.id);
  const r = await call('POST', `workspaces/${ws.id}/changes`, { actor: 'dk', change: { projectId: PRJ, reason: 'Drop the test deposit', category: 'scope',
    edits: [{ op: 'remove', type: 'workItem', id: 'W7' }] } });
  const c = r.body.change;
  assert.equal(c.status, 'proposed');
  const no = await call('POST', `workspaces/${ws.id}/changes/${c.id}/decide`, { actor: 'ta', decision: 'reject', note: 'Treasury needs the deposit check' });
  assert.equal(no.status, 200);
  assert.equal(no.body.change.status, 'rejected');
  assert.equal(no.body.change.decisionNote, 'Treasury needs the deposit check');
  const docs = await docsOf(ws.id);
  assert.deepEqual(docs.workItem, docs0.workItem, 'tasks unchanged');
  assert.deepEqual(proj(docs), proj(docs0), 'project unchanged (no Saved plans added)');
  assert.ok(docs.notification.some(n => n.data.to === 'dk' && /rejected your plan change/.test(n.data.text)));
  const again = await call('POST', `workspaces/${ws.id}/changes/${c.id}/apply`, { actor: 'ta' });
  assert.equal(again.status, 409);
});

test('apply refuses when the plan moved since the proposal; generic doc writes of plan changes are refused', async () => {
  const ws = await newWs();
  const docs0 = await docsOf(ws.id);
  const r = await call('POST', `workspaces/${ws.id}/changes`, { actor: 'lp', change: { projectId: PRJ, reason: 'Slip',
    edits: [{ op: 'set', type: 'workItem', id: 'W6', field: 'due', to: addBiz(task(docs0, 'W6').due, 25) }] } });
  const c = r.body.change;
  await call('PUT', `ws/${ws.id}/doc/workItem/W6`, { actor: 'lp', data: Object.assign({}, task(docs0, 'W6'), { due: addBiz(task(docs0, 'W6').due, 2) }), summary: 'Moved' });
  const ok = await call('POST', `workspaces/${ws.id}/changes/${c.id}/decide`, { actor: 'ta', decision: 'approve', stepUp: STEP() });
  assert.equal(ok.body.change.status, 'approved');
  assert.match(ok.body.change.applyError, /The plan changed since this was proposed/);
  if (wired) {
    const put = await call('PUT', `ws/${ws.id}/doc/planChange/x1`, { actor: 'ta', data: { status: 'applied' } });
    assert.equal(put.status, 403);
  }
});

test('log export: CSV route and logRows', async () => {
  const ws = await newWs();
  await call('POST', `workspaces/${ws.id}/changes`, { actor: 'lp', change: { projectId: PRJ, reason: '=cmd|"x" risky, quoted', edits: [{ op: 'set', type: 'workItem', id: 'W11', field: 'owner', to: 'ar' }] } });
  const list = await call('GET', `workspaces/${ws.id}/changes`, null, { project: PRJ });
  assert.equal(list.status, 200);
  assert.equal(list.body.changes.length, 1);
  assert.ok(list.body.refs[PRJ]['vendor-onboarding'].sigs, 'process reference for the drift banner');
  const csv = await call('GET', `workspaces/${ws.id}/changes`, null, { project: PRJ, format: 'csv' });
  assert.equal(csv.status, 200);
  const lines = csv.body.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('Requested,Project,Title,Reason'));
  assert.ok(lines[1].includes('Vendor Onboarding Modernization'));
  assert.ok(lines[1].includes('"\'=cmd|""x"" risky, quoted"'), 'formula guarded and quoted');
  assert.ok(lines[1].includes('owner Dev Kumar → Ana Ruiz'));
  const rows = C.logRows(list.body.changes, await docsOf(ws.id));
  assert.equal(rows[0].length, C.LOG_COLUMNS.length);
  assert.equal(rows[1][5], 'Applied');
});

test('process changed mid-project: only the newly changed steps without work, suggested from suggestWorkFromDiff', async () => {
  const docs = seedDocs();
  const proc = docs.process.find(d => d.id === 'vendor-onboarding').data;
  const refs = { 'vendor-onboarding': C.processRef(proc), 'invoice-approval': C.processRef(docs.process.find(d => d.id === 'invoice-approval').data) };
  assert.equal(C.processDrift(docs, PRJ, refs, TODAY).changed, false, 'no change since the plan: no banner (even though older steps lack work)');
  const d2 = JSON.parse(JSON.stringify(docs));
  const p2 = d2.process.find(d => d.id === 'vendor-onboarding').data;
  const i = p2.tobe.findIndex(n => n.id === 's4');
  p2.tobe.splice(i + 1, 0, { id: 'snew', type: 'step', title: 'Call the vendor to confirm bank details', owner: 'lp', data: [], touches: ['Treasury'] });
  p2.updatedAt = '2099-01-01T00:00:00.000Z';
  let n = 0;
  const dr = C.processDrift(d2, PRJ, refs, TODAY, { newId: () => 'wi-new-' + (++n) });
  assert.equal(dr.changed, true);
  assert.deepEqual(dr.steps.map(s => s.step), ['snew']);
  assert.equal(dr.text, 'The process changed after this plan was made: 1 new step has no work.');
  assert.equal(dr.suggestions.length, 1);
  assert.equal(dr.suggestions[0].id, 'wi-new-1');
  assert.equal(dr.suggestions[0].step, 'snew');
  assert.equal(dr.suggestions[0].owner, 'lp');
  /* the suggestion is the engine's own task for that step */
  const eng = E.suggestWorkFromDiff(d2, PRJ, TODAY).find(s => s.step === 'snew');
  assert.equal(dr.suggestions[0].title, eng.title); assert.equal(dr.suggestions[0].due, eng.due);
  /* the wizard's change built from it is a scope change */
  const { change, errors } = C.buildChange({ projectId: PRJ, reason: 'Process changed', source: 'process', edits: dr.suggestions.map(w => ({ op: 'add', type: 'workItem', id: w.id, data: w })) }, d2);
  assert.deepEqual(errors, []);
  assert.deepEqual(change.kinds, ['scope']);
  /* after the plan is updated, the reference moves on and the banner goes */
  assert.equal(C.processDrift(C.applyToDocs(d2, change, 'x'), PRJ, refs, TODAY).changed, false);
  assert.equal(C.processDrift(d2, PRJ, { 'vendor-onboarding': C.processRef(p2) }, TODAY).changed, false);
});

test('process drift through the routes: the seeded plan is the reference until a change is applied', async () => {
  const ws = await newWs();
  let list = await call('GET', `workspaces/${ws.id}/changes`, null, { project: PRJ });
  let docs = await docsOf(ws.id);
  assert.equal(C.processDrift(docs, PRJ, list.body.refs[PRJ], TODAY).changed, false);
  const p = JSON.parse(JSON.stringify(docs.process.find(d => d.id === 'vendor-onboarding').data));
  p.tobe.splice(2, 0, { id: 'snew', type: 'step', title: 'Call the vendor to confirm bank details', owner: 'lp', data: [], touches: ['Treasury'] });
  const put = await call('PUT', `ws/${ws.id}/doc/process/vendor-onboarding`, { actor: 'mc', data: p, summary: 'Added a step' });
  assert.equal(put.status, 200);
  docs = await docsOf(ws.id);
  list = await call('GET', `workspaces/${ws.id}/changes`, null, { project: PRJ });
  const dr = C.processDrift(docs, PRJ, list.body.refs[PRJ], TODAY, { newId: i => 'wi-p' + i });
  assert.equal(dr.changed, true);
  const r = await call('POST', `workspaces/${ws.id}/changes`, { actor: 'ta', stepUp: STEP(), change: { projectId: PRJ, reason: 'The process changed', category: 'scope', source: 'process',
    edits: dr.suggestions.map(w => ({ op: 'add', type: 'workItem', id: w.id, data: w })) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.change.status, 'applied');
  docs = await docsOf(ws.id);
  assert.ok(task(docs, 'wi-p0'));
  list = await call('GET', `workspaces/${ws.id}/changes`, null, { project: PRJ });
  assert.equal(C.processDrift(docs, PRJ, list.body.refs[PRJ], TODAY).changed, false, 'banner gone after the plan was updated');
});

/* ---------------------------------------------------------------- R12 */
const ERP = 'erp-upgrade-readiness';
test('R12 #13: a knock-on into another project is listed per project, and that project’s PM approves too', () => {
  const docs = seedDocs();
  const { change, im } = preview(docs, [{ op: 'set', type: 'workItem', id: 'W6', field: 'due', to: addBiz(task(docs, 'W6').due, 25) }]);
  assert.ok(Array.isArray(im.crossProjects), 'impact lists the other projects the change reaches');
  const x = im.crossProjects.find(p => p.projectId === ERP);
  assert.ok(x, 'ERP is reached');
  assert.equal(x.name, 'ERP Upgrade Readiness');
  assert.equal(x.owner, 'ta');
  assert.ok(x.tasks.some(t => t.id === 'E1' && t.to > t.from), 'E1 moves');
  assert.ok(!im.crossProjects.some(p => p.projectId === PRJ), 'the change’s own project is not “another project”');
  /* ERP's own expected finish before/after, from the engine */
  const eb = E.projectTruth(docs, ERP, TODAY);
  assert.equal(x.finish.before, eb.forecastFinish);
  assert.match(im.sentence, /moves \d+ tasks? in ERP Upgrade Readiness\.$/);
  const need = C.needsApproval(change, im, docs);
  assert.ok(need.reasons.some(r => /ERP Upgrade Readiness/.test(r) && /project manager approves too/.test(r)), need.reasons.join(' | '));
  assert.ok(need.approvers.some(a => a.role === 'linkedPm' && a.projectId === ERP && a.person === 'ta'));
  assert.equal(C.roleText({ role: 'linkedPm', person: 'ta', projectId: ERP }, docs), 'project manager of ERP Upgrade Readiness');
  assert.equal(C.roleText({ role: 'pm', person: 'ta' }, docs), 'project manager');
  /* a knock-on alone (inside tolerance otherwise) still needs the other PM */
  const d2 = JSON.parse(JSON.stringify(docs));
  const owner2 = 'nb';
  proj(d2); d2.project.find(p => p.id === ERP).data.owner = owner2;
  const r2 = preview(d2, [{ op: 'set', type: 'workItem', id: 'W6', field: 'due', to: addBiz(task(d2, 'W6').due, 25) }]);
  const n2 = C.needsApproval(r2.change, r2.im, d2);
  assert.ok(n2.approvers.some(a => a.role === 'linkedPm' && a.person === owner2), 'ERP’s own PM (Nina here) is asked');
  assert.match(C.waitingText(Object.assign({}, r2.change, { approvers: n2.approvers }), d2), /Nina Brooks \(project manager of ERP Upgrade Readiness\)/);
});

test('R12 #13 routes: the other project’s log gets a linked entry, its PM approves (with step-up), history and notice', async () => {
  const ws = await newWs();
  /* give ERP its own PM so the extra approver is visible */
  const docs0 = await docsOf(ws.id);
  const erp = docs0.project.find(p => p.id === ERP).data;
  await store.putDoc(ws.id, 'project', ERP, Object.assign({}, erp, { owner: 'nb' }));
  const newDue = addBiz(task(docs0, 'W6').due, 25);
  const r = await call('POST', `workspaces/${ws.id}/changes`, { actor: 'lp', change: { projectId: PRJ, reason: 'Bank portal vendor delayed', category: 'dependency',
    edits: [{ op: 'set', type: 'workItem', id: 'W6', field: 'due', to: newDue }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const c = r.body.change;
  assert.equal(c.status, 'proposed');
  assert.deepEqual(c.approvers.map(a => [a.role, a.person, a.projectId || null]), [['pm', 'ta', null], ['linkedPm', 'nb', ERP]]);
  let docs = await docsOf(ws.id);
  /* while waiting: Nina has it in her queue, and ERP's log shows it as pending (from another project) */
  assert.equal(C.queueFor(docs, 'nb', TODAY).length, 1);
  const pend = C.changesOf(docs, ERP);
  assert.equal(pend.length, 1); assert.equal(pend[0].id, c.id);
  assert.ok(docs.notification.some(n => n.data.to === 'nb' && /asks you to approve/.test(n.data.text)));
  /* approving without the extra sign-in check is refused by the server */
  const noStep = await call('POST', `workspaces/${ws.id}/changes/${c.id}/decide`, { actor: 'ta', decision: 'approve' });
  assert.equal(noStep.status, 403); assert.match(noStep.body.error, /extra sign-in check/);
  const a1 = await call('POST', `workspaces/${ws.id}/changes/${c.id}/decide`, { actor: 'ta', decision: 'approve', stepUp: STEP() });
  assert.equal(a1.status, 200); assert.equal(a1.body.change.status, 'proposed', 'still waits for ERP’s PM');
  assert.equal(a1.body.change.approvers[0].stepUp, true);
  assert.match(C.waitingText(a1.body.change, docs), /Nina Brooks \(project manager of ERP Upgrade Readiness\)/);
  const a2 = await call('POST', `workspaces/${ws.id}/changes/${c.id}/decide`, { actor: 'nb', decision: 'approve', stepUp: STEP() });
  assert.equal(a2.status, 200, JSON.stringify(a2.body));
  assert.equal(a2.body.change.status, 'applied');
  docs = await docsOf(ws.id);
  const main = docs.planChange.find(d => d.id === c.id).data;
  assert.ok(Array.isArray(main.linked) && main.linked.length === 1 && main.linked[0].projectId === ERP);
  const erpLog = C.changesOf(docs, ERP);
  assert.equal(erpLog.length, 1, 'ERP’s log has exactly one entry: the linked one');
  const L = erpLog[0];
  assert.equal(L.id, main.linked[0].changeId);
  assert.equal(L.projectId, ERP);
  assert.equal(L.status, 'applied');
  assert.equal(L.source, 'knockOn');
  assert.deepEqual(L.linkedFrom, { projectId: PRJ, changeId: c.id, projectName: 'Vendor Onboarding Modernization' });
  assert.ok(L.knockOn.some(t => t.id === 'E1'));
  assert.equal(L.impact.projectId, ERP);
  assert.ok(L.approvers.some(a => a.person === 'nb' && a.decision === 'approved'));
  assert.equal(L.title, main.title);
  assert.deepEqual(L.impact.crossProjects, []); assert.ok(L.impact.knockOn.every(k => k.projectId === ERP));
  /* the generic approval queue is empty again, and ERP's history has the entry */
  assert.deepEqual(C.queueFor(docs, 'nb', TODAY), []);
  const evs = await store.listEvents(ws, { limit: 80 });
  assert.ok(evs.some(e => e.ref === 'project:' + ERP && /Knock-on from the plan change/.test(e.summary)), 'ERP history');
  assert.ok(evs.some(e => e.ref === 'planChange:' + L.id));
  /* CSV of ERP lists the linked entry */
  const csv = await call('GET', `workspaces/${ws.id}/changes`, null, { project: ERP, format: 'csv' });
  assert.match(csv.body, /Knock-on/);
});

test('R12 #4: a self-approval at request time needs step-up; without it the approval stays open', async () => {
  const ws = await newWs();
  const docs0 = await docsOf(ws.id);
  const r = await call('POST', `workspaces/${ws.id}/changes`, { actor: 'ta', change: { projectId: PRJ, reason: 'Client moved go-live', category: 'client',
    edits: [{ op: 'set', type: 'project', id: PRJ, field: 'target', to: addBiz(proj(docs0).target, 5) }] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.change.approvers.map(a => [a.role, a.person, a.decision]), [['pm', 'ta', null], ['sponsor', 'mc', null]]);
});
