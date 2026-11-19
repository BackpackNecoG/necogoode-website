/* PMOFlow R10.2 stream C: traceable plan changes, server routes. Loaded by api/pmoflow/index.js through the
   route-module hook (the lead adds 'pmoflow-routes-change' to ROUTE_MODULES). Handles:
     GET  /workspaces/:ws/changes?project=&format=json|csv   the log (newest first) + each project's process reference
     POST /workspaces/:ws/changes               {actor, change:{projectId,title,reason,category,source,edits,ackSteps}}
                                                 → proposed; applied at once when within tolerance (unless apply:false)
     POST /workspaces/:ws/changes/:id/decide    {actor, decision:'approve'|'reject', note}   a pending approver only
     POST /workspaces/:ws/changes/:id/apply     {actor}   an approved change, or a proposed one still within tolerance
   Impact is computed here with the same pure module the browser uses (pmoflow-change.js → the engine), on the
   server's copy of the docs, so the stored numbers are the engine's. Applying writes every edit through the doc store
   (pmoflow-store putDoc/deleteDoc + one history event per doc, updatedAt stamped like the generic PUT), saves a
   "before" and an "after" Saved plan on the project, records the decision trail, and writes notification docs.
   planChange docs are written ONLY here: the generic doc API refuses them, so approvals cannot be faked. */
const crypto = require('crypto');
const seedMod = require('./pmoflow-seed');
const C = require('./pmoflow-change.js');

/* Until 'planChange' is added to DOC_TYPES in pmoflow-seed.js, register it here so getState returns docs.planChange
   and the seed initialises it to []. Idempotent; a no-op once the seed lists it. (Reported to the lead.) */
if (Array.isArray(seedMod.DOC_TYPES) && !seedMod.DOC_TYPES.includes('planChange')) seedMod.DOC_TYPES.push('planChange');

const WS_RE = /^[a-z0-9]{12,32}$/;
const ID_RE = /^[\w.-]{1,64}$/;
const MAX_DOC = 48 * 1024;
const actorOf = b => (b && typeof b.actor === 'string' && ID_RE.test(b.actor) ? b.actor : 'anonymous');
const engine = () => require('./pmoflow-engine.js');
function adminRoutes() { try { return require('./pmoflow-routes-admin.js'); } catch (e) { return null; } }
const getDoc = (docs, type, id) => { const d = (docs[type] || []).find(x => x.id === id); return d ? d.data : null; };
const pname = (docs, id) => (getDoc(docs, 'person', id) || {}).name || 'someone';
const newId = p => p + '-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
/* R12 #4: approving a plan change needs the extra sign-in check (simulated MFA, reported by the client). Only the time
   and method are kept. null when the body carries none. */
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
/* R16 (N1 #1, via N4): ONE step-up rule for every route: the stamp must be within the last 10 minutes of server time and
   not in the future (E.stepUpProblem). Returns {at, method} for a fresh check, {problem} for a stale or future one,
   null when there is none. The server's own time is recorded (stepUpAt). */
function stepUpOf(body, at) {
  const s = body && isObj(body.stepUp) ? body.stepUp : null;
  if (!s || typeof s.method !== 'string' || !s.method) return null;
  const E = engine();
  const pr = E && typeof E.stepUpProblem === 'function' ? E.stepUpProblem(s.at, at)
    : (typeof s.at === 'string' && isFinite(Date.parse(s.at)) && Date.parse(s.at) <= Date.parse(at) + 60000 && Date.parse(at) - Date.parse(s.at) <= 10 * 60000 ? null : { text: 'The extra sign-in check was more than 10 minutes ago. Do it again.' });
  if (pr) return { problem: pr.text || STEPUP_NEEDED };
  return { at, method: 'simulated-mfa' };
}
const STEPUP_NEEDED = 'Approving a plan change needs the extra sign-in check. Approve again and complete the check.';

/* Who may propose/apply edits: a person in the directory whose workspace role can edit tasks (S5 roles when present). */
function editorError(docs, actor) {
  if (!getDoc(docs, 'person', actor)) return 'Pick who you are (“Viewing as”) before changing the plan.';
  const adm = adminRoutes();
  const r = adm && adm.roleError ? adm.roleError(docs, actor, 'workItem') : null;
  return r || null;
}

/* The process reference each project's drift banner compares against: the processes as they were when the plan was
   last changed (the latest applied plan change of that project), else as first seeded (when the demo plan was made). */
function refsFor(docs, seedDocs, projectId) {
  const project = getDoc(docs, 'project', projectId);
  if (!project) return {};
  const applied = C.changesOf(docs, projectId).filter(c => c.status === 'applied' && c.processRef);
  const out = {};
  (project.processes || []).forEach(pid => {
    const hit = applied.find(c => c.processRef[pid]);
    if (hit) { out[pid] = hit.processRef[pid]; return; }
    const sp = getDoc(seedDocs, 'process', pid);
    if (sp && (getDoc(seedDocs, 'project', projectId) || {}).processes) out[pid] = C.processRef(sp, null);
  });
  return out;
}
function processRefs(docs, project, at) {
  const out = {};
  (project.processes || []).forEach(pid => { const p = getDoc(docs, 'process', pid); if (p) out[pid] = C.processRef(p, at); });
  return out;
}

function fits(doc) { return Buffer.byteLength(JSON.stringify(doc), 'utf8') <= MAX_DOC; }
/* keep the stored doc under the 48 KB doc limit: trim long lists first, then the snapshots */
function trimmed(doc) {
  if (fits(doc)) return doc;
  const d = JSON.parse(JSON.stringify(doc));
  if (d.impact) { d.impact.knockOn = (d.impact.knockOn || []).slice(0, 15); d.impact.testsRerun = (d.impact.testsRerun || []).slice(0, 15); d.impact.people = (d.impact.people || []).slice(0, 20); }
  if (!fits(d)) delete d.snapshots;
  if (!fits(d)) delete d.processRef;
  return d;
}

async function notify(store, wsId, docs, toIds, actor, text, ref, at) {
  const sent = [];
  for (const to of [...new Set(toIds)].filter(t => t && t !== actor && getDoc(docs, 'person', t))) {
    const id = newId('ntf');
    await store.putDoc(wsId, 'notification', id, { id, to, text: String(text).slice(0, 280), ref, at, read: false });
    sent.push(to);
  }
  return sent;
}

/* R15 (M3 #5): History sentences for the doc writes a plan change makes are worded the way the server words every doc
   write ("Created …", "Updated …", "Deleted …"), so History and the audit export label them as written by the system,
   never "Older entry: worded by the person". One line per task: its edits after the task's name, the knock-on note once. */
function taskSummary(mine, docs, E) {
  const add = mine.find(x => x.op === 'add');
  if (add) return 'Created work item ' + C.editText(add, docs, E).replace(/^Added /, '');
  const label = (mine[0] && mine[0].label) || 'a task';
  const pre = '“' + label + '”: ', KNOCK = ' (knock-on: it waits on the moved work)', LATER = ' (moved: it is now expected to finish later)';
  /* R16: "knock-on" only for a task that waits on the moved work; one that only finishes later says that instead */
  const knock = mine.some(x => x.knock && x.waits !== false), later = !knock && mine.some(x => x.knock && x.waits === false);
  const parts = mine.map(x => { let t = C.editText(x, docs, E); if (t.startsWith(pre)) t = t.slice(pre.length); return t.endsWith(KNOCK) ? t.slice(0, -KNOCK.length) : t.endsWith(LATER) ? t.slice(0, -LATER.length) : t; });
  return 'Updated work item “' + label + '”: ' + parts.join('; ') + (knock ? KNOCK : later ? LATER : '');
}

/* Apply: write every edit through the doc store, two Saved plans, the log entry, notifications. */
async function applyChange(store, wsId, docs, change, actor, today) {
  const E = engine();
  const conflicts = C.conflicts(docs, Object.assign({}, change, { edits: (change.edits || []).filter(e => !e.knock) }));
  /* R14 (PMO-9): the knock-on re-dating is recomputed on the plan as it is now, so the tasks that wait on the moved work move with it */
  change = Object.assign({}, change, { edits: C.withKnockOn(change, docs, today, { engine: E }).edits });
  if (conflicts.length) return { status: 409, body: { error: 'The plan changed since this was proposed: ' + conflicts.slice(0, 3).join('; ') + '. Propose the change again.', reasons: conflicts } };
  const at = new Date().toISOString();
  const project = getDoc(docs, 'project', change.projectId);
  const after = C.applyToDocs(docs, change, at);
  const im = C.impact(docs, after, change.projectId, today, { change, engine: E });
  const tag = ` (plan change “${change.title}”)`;
  const log = [];
  for (const e of change.edits) {
    if (e.type !== 'workItem') continue;
    if (e.op === 'remove') {
      await store.deleteDoc(wsId, 'workItem', e.id);
      log.push({ ref: 'workItem:' + e.id, action: 'delete', summary: 'Deleted work item “' + (e.label || 'a task') + '”' + tag });
    }
  }
  const written = new Set();
  for (const e of change.edits) {
    if (e.type !== 'workItem' || e.op === 'remove' || written.has(e.id)) continue;
    written.add(e.id);
    const data = getDoc(after, 'workItem', e.id);
    if (!data) continue;
    await store.putDoc(wsId, 'workItem', e.id, data);
    const mine = change.edits.filter(x => x.type === 'workItem' && x.id === e.id);
    log.push({ ref: 'workItem:' + e.id, action: e.op === 'add' ? 'create' : 'update', summary: taskSummary(mine, docs, E) + tag });
  }
  /* project: deadline/budget edits plus the two Saved plans, in one save */
  const pAfter = getDoc(after, 'project', change.projectId) || project;
  const short = String(change.title).length > 44 ? String(change.title).slice(0, 43).trimEnd() + '…' : String(change.title);
  const blBefore = C.baselineOf(docs, change.projectId, newId('bl'), short + ' · before', at, change.id);
  const blAfter = C.baselineOf(after, change.projectId, newId('bl'), short + ' · after', at, change.id);
  const proj = Object.assign({}, pAfter, { baselines: (pAfter.baselines || []).concat([blBefore, blAfter]) });
  /* keep the project doc within the size limit: drop the oldest automatic Saved plans first */
  while (!fits(proj) && proj.baselines.some(b => b.auto && b.changeId !== change.id)) {
    const i = proj.baselines.findIndex(b => b.auto && b.changeId !== change.id);
    proj.baselines.splice(i, 1);
  }
  await store.putDoc(wsId, 'project', change.projectId, proj);
  change.edits.filter(e => e.type === 'project').forEach(e => log.push({ ref: 'project:' + change.projectId, action: 'update', summary: `Updated project “${project.name}”: ` + C.editText(e, docs, E) + tag }));
  log.push({ ref: 'project:' + change.projectId, action: 'baseline', summary: `Saved the plan “${blBefore.label}” and “${blAfter.label}” (automatic, plan change)` });
  const afterDocs = Object.assign({}, after, { project: (after.project || []).map(d => (d.id === change.projectId ? { id: d.id, data: proj } : d)) });
  const doc = Object.assign({}, change, {
    status: 'applied', appliedBy: actor, appliedAt: at, impact: im, tolerance: change.tolerance,
    snapshots: { before: C.snapshot(docs, change.projectId), after: C.snapshot(afterDocs, change.projectId) },
    baselines: { before: blBefore.id, after: blAfter.id, beforeLabel: blBefore.label, afterLabel: blAfter.label },
    processRef: processRefs(afterDocs, proj, at),
  });
  /* R12 #13: a knock-on into another project: a linked entry in that project's log, its history, its PM told */
  const cross = (im.crossProjects || []).filter(x => getDoc(docs, 'project', x.projectId));
  doc.impact = im;
  const linked = [];
  for (const x of cross) {
    const lid = newId('chg');
    const entry = Object.assign({ id: lid }, C.linkedEntry(Object.assign({}, change, { impact: im }), docs, afterDocs, x.projectId, today, { engine: E }),
      { status: 'applied', appliedBy: actor, appliedAt: at });
    await store.putDoc(wsId, 'planChange', lid, trimmed(entry));
    linked.push({ projectId: x.projectId, changeId: lid });
    const moved = (entry.knockOn || []).slice(0, 3).map(k => `“${k.title}” ${E.fmtDay(k.from)} → ${E.fmtDay(k.to)}`).join('; ');
    log.push({ ref: 'project:' + x.projectId, action: 'update', summary: `Updated project “${x.name}”: Knock-on from the plan change “${change.title}” on ${project.name}: ${moved || 'expected dates move'}`.slice(0, 300) });
    log.push({ ref: 'planChange:' + lid, action: 'apply', summary: `Recorded the knock-on of “${change.title}” (${project.name}) in ${x.name}’s plan changes`.slice(0, 300) });
    if (x.owner) await notify(store, wsId, docs, [x.owner], actor, `A plan change on ${project.name} moves ${x.taskCount === 1 ? 'a task' : (x.taskCount || x.tasks.length) + ' tasks'} in ${x.name}: “${change.title}”.`, 'project:' + x.projectId, at);
  }
  if (linked.length) doc.linked = linked;
  const people = (im.people || []).map(p => p.id).concat([change.requestedBy]);
  doc.notified = await notify(store, wsId, docs, people, actor, `Plan change on ${project.name}: “${change.title}”. ${im.sentence}`, 'project:' + change.projectId, at);
  const stored = trimmed(doc);
  await store.putDoc(wsId, 'planChange', change.id, stored);
  log.push({ ref: 'planChange:' + change.id, action: 'apply', summary: `Applied plan change “${change.title}” on ${project.name}: ${change.reason}`.slice(0, 300) });
  /* one ordered trail: edits first, then the change entry */
  const t0 = Date.parse(at);
  for (let i = 0; i < log.length; i++) await store.appendEvent(wsId, Object.assign({ actor, at: new Date(t0 + i).toISOString() }, log[i]));
  return { status: 200, body: { ok: true, change: stored, applied: true } };
}

/* R17 (PMO defect 1): a guard on the generic task API, ahead of it: a DELETE of a task with logged hours is refused (the
   hours would be erased); the task is cancelled through Change the plan instead. The refusal is logged in History as
   "Refused: …", like the doc API's own refusals. Returns true when it answered. (A new task over the cost tolerance and an
   added dependency with a knock-on are sent through Change the plan by the Work tab; the server-side guard for a plain
   PUT belongs in index.js scheduleError, P1.) */
async function taskGuard({ method, seg, body, store, send }) {
  if (seg[0] !== 'ws' || seg[2] !== 'doc' || seg[3] !== 'workItem' || seg.length !== 5 || method !== 'DELETE') return false;
  const wsId = seg[1], id = seg[4];
  if (!WS_RE.test(wsId || '') || !ID_RE.test(id || '')) return false;
  const ws = await store.getWorkspace(wsId);
  if (!ws || ws.expired) return false;
  const st = await store.getState(ws);
  const docs = st.docs;
  const prev = getDoc(docs, 'workItem', id);
  const actor = actorOf(body);
  const refuse = async (status, msg, extra) => {
    await store.appendEvent(wsId, { actor, action: 'refused', ref: 'workItem:' + id, summary: `Refused: delete work item “${String(((prev || (body && body.data) || {}).title) || 'untitled task').slice(0, 100)}” — ${msg}`.slice(0, 300) }).catch(() => {});
    /* answered with send (not the route-module fail, which would log a second, rawer "Refused" line) */
    send(status, Object.assign({ error: msg }, Array.isArray(extra) ? { reasons: extra } : extra || {}));
    return true;
  };
  if (!prev || !C.hasHours(prev)) return false;
  const h = Math.round(C.hoursLogged(prev) * 100) / 100;
  return refuse(409, `“${prev.title || 'This task'}” has ${h} ${h === 1 ? 'hour' : 'hours'} logged, so it can’t be deleted. Cancel it instead: the hours stay.`);
}

async function handle(ctx) {
  const { method, seg, req, store, send, fail, dayInput, clientToday } = ctx;
  let body = ctx.body;
  /* Guard: the generic doc API must not write plan changes directly (it would skip the approval rules). */
  if (seg[0] === 'ws' && seg[2] === 'doc' && seg[3] === 'planChange' && method !== 'GET') { fail(403, 'Plan changes are recorded through “Change the plan” only.'); return true; }
  if (await taskGuard(ctx)) return true;
  if (seg[0] !== 'workspaces' || seg[2] !== 'changes') return false;
  const wsId = seg[1];
  if (!WS_RE.test(wsId || '')) { fail(400, 'invalid workspace id'); return true; }
  const ws = await store.getWorkspace(wsId);
  if (!ws || ws.expired) { fail(404, 'workspace not found or expired'); return true; }
  body = body || {};
  const q = (req && req.query) || {};
  const serverToday = new Date().toISOString().slice(0, 10);
  const today = clientToday ? clientToday(dayInput ? dayInput(req, body) : body, serverToday) : serverToday;
  const rest = seg.slice(3);
  const st = await store.getState(ws);
  const docs = st.docs;
  const E = engine();

  /* GET /workspaces/:ws/changes */
  if (!rest.length && method === 'GET') {
    const projectId = q.project ? String(q.project) : '';
    if (projectId && !ID_RE.test(projectId)) { fail(400, 'invalid project id'); return true; }
    const changes = C.changesOf(docs, projectId || null);
    if (String(q.format || 'json') === 'csv') { send(200, C.toCSV(C.logRows(changes, docs, E))); return true; }
    const seedDocs = seedMod.seed(ws.seedDate).docs;
    const ids = projectId ? [projectId] : (docs.project || []).map(d => d.id);
    const refs = Object.fromEntries(ids.map(id => [id, refsFor(docs, seedDocs, id)]));
    send(200, { changes, refs, today });
    return true;
  }

  /* POST /workspaces/:ws/changes — propose (and apply at once when within tolerance) */
  if (!rest.length && method === 'POST') {
    const actor = actorOf(body);
    const denied = editorError(docs, actor);
    if (denied) { fail(403, denied); return true; }
    const built = C.buildChange(body.change, docs, { engine: E });
    const errors = built.errors;
    if (errors.length) { fail(400, errors[0], errors); return true; }
    /* R14 (PMO-9): tasks that wait on the moved work are re-dated with it (automatic edits, listed in the change) */
    const change = C.withKnockOn(built.change, docs, today, { engine: E });
    const project = getDoc(docs, 'project', change.projectId);
    if (project.status === 'live') { fail(409, `${project.name} is live, so its plan is closed. Start a new project for further changes.`); return true; }
    const at = new Date().toISOString();
    const after = C.applyToDocs(docs, change, at);
    const im = C.impact(docs, after, change.projectId, today, { change, engine: E });
    /* R13 #3: the requester is never an approver; when nobody else can approve, the change cannot be sent */
    const need = C.needsApproval(change, im, docs, { requester: actor });
    if (!need.within && need.blocked) { fail(409, need.blocked); return true; }
    const id = newId('chg');
    const approvers = need.approvers.map(a => Object.assign({}, a, { decision: null, at: null }));
    const doc = Object.assign({ id }, change, {
      status: 'proposed', requestedBy: actor, requestedAt: at, impact: im, tolerance: { within: need.within, reasons: need.reasons }, approvers,
    });
    if (need.within && body.apply !== false) {
      const r = await applyChange(store, wsId, docs, doc, actor, today);
      if (r.status === 200) await store.appendEvent(wsId, { actor, at: new Date(Date.parse(at) - 1).toISOString(), action: 'propose', ref: 'planChange:' + id,
        summary: `Proposed plan change “${doc.title}”: ${doc.reason} (within tolerance, applied at once)` });
      send(r.status, r.body);
      return true;
    }
    const stored = trimmed(doc);
    await store.putDoc(wsId, 'planChange', id, stored);
    const pending = C.pendingApprovers(stored);
    await notify(store, wsId, docs, pending.map(a => a.person), actor, `${pname(docs, actor)} asks you to approve a plan change on ${project.name}: “${doc.title}”. ${im.sentence}`, 'project:' + project.id, at);
    await store.appendEvent(wsId, { actor, at, action: 'propose', ref: 'planChange:' + id,
      summary: `Proposed plan change “${doc.title}” on ${project.name}: ${doc.reason}. ${C.waitingText(stored, docs)}.`.slice(0, 300) });
    send(200, { ok: true, change: stored, applied: false });
    return true;
  }

  const cid = rest[0];
  if (!ID_RE.test(cid || '')) { fail(400, 'invalid change id'); return true; }
  const change = getDoc(docs, 'planChange', cid);
  if (!change) { fail(404, 'That plan change was not found.'); return true; }
  if (method !== 'POST') { fail(405, 'method not allowed'); return true; }
  const actor = actorOf(body);
  const project = getDoc(docs, 'project', change.projectId);
  if (!project) { fail(404, 'The project of this change was deleted.'); return true; }

  /* POST …/:id/decide */
  if (rest[1] === 'decide' && rest.length === 2) {
    const decision = body.decision === 'reject' ? 'reject' : body.decision === 'approve' ? 'approve' : null;
    if (!decision) { fail(400, 'decision must be approve or reject'); return true; }
    if (change.status !== 'proposed') { fail(409, `This change is already ${C.STATUS_LABEL[change.status].toLowerCase()}.`); return true; }
    const pending = C.pendingApprovers(change);
    const mine = pending.filter(a => a.person === actor);
    if (!mine.length) {
      fail(403, pending.length ? `Only ${pending.map(a => `${pname(docs, a.person)} (${C.roleText(a, docs)})`).join(' and ')} can decide this change.` : 'Nobody needs to decide this change.');
      return true;
    }
    /* R13 #3: the requester never decides their own change (also for changes stored before R13 listed them) */
    if (actor === change.requestedBy) {
      const others = pending.filter(a => a.person !== actor);
      fail(403, `You asked for this change, so someone else decides it${others.length ? `: ${others.map(a => `${pname(docs, a.person)} (${C.roleText(a, docs)})`).join(' and ')}` : ''}.`);
      return true;
    }
    const note = String(body.note || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    const at = new Date().toISOString();
    const su = stepUpOf(body, at);
    if (decision === 'approve' && !su) { fail(403, STEPUP_NEEDED); return true; }
    if (decision === 'approve' && su.problem) { fail(403, su.problem); return true; }
    const next = JSON.parse(JSON.stringify(change));
    next.approvers.forEach(a => { if (a.person === actor && !a.decision) Object.assign(a, { decision: decision === 'approve' ? 'approved' : 'rejected', at, note }, su && decision === 'approve' ? { stepUp: true, stepUpAt: su.at } : {}); });
    if (decision === 'reject') {
      Object.assign(next, { status: 'rejected', decidedBy: actor, decidedAt: at, decisionNote: note });
      await store.putDoc(wsId, 'planChange', cid, next);
      await notify(store, wsId, docs, [change.requestedBy], actor, `${pname(docs, actor)} rejected your plan change “${change.title}” on ${project.name}${note ? ': ' + note : '.'}`, 'project:' + project.id, at);
      await store.appendEvent(wsId, { actor, at, action: 'reject', ref: 'planChange:' + cid, summary: `Rejected plan change “${change.title}”${note ? ': ' + note : ''}. Nothing in the plan changed.`.slice(0, 300) });
      send(200, { ok: true, change: next, applied: false });
      return true;
    }
    await store.appendEvent(wsId, { actor, at, action: 'approve', ref: 'planChange:' + cid,
      summary: `Approved plan change “${change.title}” as ${[...new Set(mine.map(a => C.roleText(a, docs)))].join(' and ')} (extra sign-in check done)${note ? ': ' + note : ''}`.slice(0, 300) });
    if (C.pendingApprovers(next).length) {
      await store.putDoc(wsId, 'planChange', cid, next);
      await notify(store, wsId, docs, C.pendingApprovers(next).map(a => a.person), actor, `${pname(docs, actor)} approved the plan change “${change.title}” on ${project.name}; it now needs your approval.`, 'project:' + project.id, at);
      send(200, { ok: true, change: next, applied: false });
      return true;
    }
    Object.assign(next, { status: 'approved', decidedBy: actor, decidedAt: at, decisionNote: note });
    /* the last approval applies the change, written by the approver */
    const r = await applyChange(store, wsId, docs, next, actor, today);
    if (r.status !== 200) {
      next.applyError = r.body.error;
      await store.putDoc(wsId, 'planChange', cid, next);
      send(200, { ok: true, change: next, applied: false, error: r.body.error });
      return true;
    }
    send(200, r.body);
    return true;
  }

  /* POST …/:id/apply */
  if (rest[1] === 'apply' && rest.length === 2) {
    const denied = editorError(docs, actor);
    if (denied) { fail(403, denied); return true; }
    if (change.status === 'applied' || change.status === 'rejected') { fail(409, `This change is already ${C.STATUS_LABEL[change.status].toLowerCase()}.`); return true; }
    let next = JSON.parse(JSON.stringify(change));
    if (change.status === 'proposed') {
      /* only while it is still within tolerance on today's plan */
      const im = C.impact(docs, C.applyToDocs(docs, change, new Date().toISOString()), change.projectId, today, { change, engine: E });
      const need = C.needsApproval(change, im, docs, { requester: change.requestedBy });
      if (!need.within) { fail(409, `This change needs approval first: ${need.reasons.join(' ')} ${C.waitingText(change, docs)}.`.trim(), need.reasons); return true; }
      next.tolerance = { within: true, reasons: [] };
    }
    delete next.applyError;
    const r = await applyChange(store, wsId, docs, next, actor, today);
    send(r.status, r.body);
    return true;
  }

  fail(404, 'unknown route');
  return true;
}

module.exports = { handle, refsFor, editorError };
