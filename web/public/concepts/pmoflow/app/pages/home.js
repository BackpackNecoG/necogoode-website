/* PMOFlow — home (stream P). Route: /
   R7 SIMPLICITY: "Hi <first name>", a "Waiting for you" list where every item is done in one tap on this page,
   three big choices, then projects and processes (each labelled, one plain sentence each). */
import { store } from '../store.js';
import { esc, fmt, fmtTime, link, go, av, pname, toast, stepUp, addDays, LOCK } from '../ui.js';
import { eng, docs, today, forecasts, flatSteps, projectStats, rerender, newProject, relMgr, schedKey, summaryOf, summaryHTML, whoActs, markDone, availText, diffCounts, factsHTML } from './project.js';

const PRJ_IC = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h7"/></svg>';
const PROC_IC = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="5" rx="1.5"/><rect x="7" y="17" width="10" height="5" rx="1.5"/><path d="M12 7v3M12 14v3"/><path d="M12 10l3 2-3 2-3-2z"/></svg>';
const PASTE_IC = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 2h6v4H9zM8 11h8M8 15h8M8 19h5"/></svg>';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------------------------------------------------------------- "Waiting for you" */
/* Business-unit sections of a project still waiting for (re-)approval, from the engine's sign-off check. */
function pendingSections(p) {
  if (!p || p.status === 'live') return [];
  const rd = eng('readiness', null, docs(), p.id, today());
  const c = rd && (rd.checks || []).find(x => x.id === 'bu-signoff');
  if (!c) return [];
  const stale = (c.stale || []).map(x => ({ bu: x.bu, stale: true }));
  return (c.unsigned || []).map(bu => ({ bu, stale: false })).concat(stale);
}
/* Can I approve this business unit's part? Members of the BU (not the PM or launch owner), or the person chosen for it. */
function canApprovePart(p, bu) {
  const me = store.state.me, my = store.person(me) || {};
  if (p.approvers && p.approvers[bu]) return p.approvers[bu] === me;
  return my.bu === bu && me !== p.owner && me !== relMgr(p);
}
/* The data owner decides an access request; if the owner asked for it, the project manager decides. Never the requester. */
function grantApprover(g) {
  const de = store.get('dataElement', g.dataId) || {}, p = store.get('project', g.projectId) || {};
  const a = g.requestedBy === de.owner ? p.owner : de.owner;
  return a && a !== g.requestedBy ? a : null;
}
function refPath(ref) {
  const [type, id] = String(ref || '').split(':');
  if (!id) return null;
  if (type === 'process') return '/process/' + id;
  if (type === 'dataElement') return '/data/' + id;
  if (type === 'project') return '/project/' + id.replace(/#.*$/, '');
  if (type === 'grant' || type === 'approval' || type === 'release') { const d = store.get(type, id); return d ? '/release/' + d.projectId : null; }
  if (type === 'workItem') { const w = store.get('workItem', id); return w ? `/project/${w.projectId}?mode=work&item=${w.id}` : null; }
  if (type === 'step') { const [pid, sid] = id.split('/'); return `/process/${pid}/step/${sid}`; }
  return null;
}

/* R8 §5: is this business unit's part ready for approval? E().buReady(...) decides; "waiting on" says what's missing. */
export function buReadiness(p, bu) {
  let r = eng('buReady', undefined, docs(), p.id, bu, today());
  if (r === undefined) return { ready: true, waiting: [] }; /* engine without buReady: keep the R7 behaviour */
  if (typeof r === 'boolean') return { ready: r, waiting: [] };
  r = r || {};
  const list = [].concat(r.waiting || r.waitingOn || r.missing || r.blockers || r.reasons || []).map(x => typeof x === 'string' ? x : (x && (x.text || x.label || x.title || x.name)) || '').filter(Boolean);
  return { ready: !!(r.ready != null ? r.ready : r.ok != null ? r.ok : !list.length), waiting: list };
}
export function waitingFor() {
  const me = store.state.me, fc = forecasts(), soon = addDays(today(), 7);
  const projects = store.list('project');
  const parts = projects.flatMap(p => pendingSections(p).filter(x => canApprovePart(p, x.bu)).map(x => Object.assign({ p, bu: x.bu, stale: x.stale }, buReadiness(p, x.bu))));
  const approve = parts.filter(x => x.ready), notReady = parts.filter(x => !x.ready);
  const done = store.list('workItem', w => w.owner === me && w.status !== 'done' && (String(w.due) <= soon || ['late', 'slip', 'causing'].includes(schedKey(w, fc))))
    .filter(w => { const p = store.get('project', w.projectId); return p && p.status !== 'live'; })
    .sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const used = new Set(projects.filter(p => p.status !== 'live').flatMap(p => (p.processes || []).flatMap(pid => flatSteps((store.get('process', pid) || {}).tobe).flatMap(s => [...(s.data || []), ...(s.subs || []).flatMap(x => x.data || [])]))));
  const confirm = store.list('dataElement', d => d.owner === me && used.has(d.id) && availText(d.id).key === 'pending');
  const grants = store.list('grant', g => g.status === 'requested' && grantApprover(g) === me);
  const grantIds = new Set(grants.map(g => 'grant:' + g.id));
  const mentions = store.list('notification', n => n.to === me && !n.read && !grantIds.has(n.ref)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { approve, notReady, done, confirm, grants, mentions, total: approve.length + done.length + confirm.length + grants.length + mentions.length };
}

function waitHTML() {
  const w = waitingFor(), fc = forecasts();
  const pn = id => (store.get('project', id) || {}).name || 'Project';
  const row = (kind, icon, title, sub, acts) => `<li class="pmo-wrow" data-wkind="${kind}"><span class="pmo-wic pmo-wic-${kind}" aria-hidden="true">${icon}</span>
    <div class="pmo-wtxt"><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div><div class="pmo-wact">${acts}</div></li>`;
  const rows = [
    ...w.approve.map(({ p, bu, stale }) => row('approve', '✓', `Approve your part of <b>${esc(p.name)}</b>`, `${esc(bu)}${stale ? ' · something changed since you last approved' : ' · your team’s steps, information and tests on one page'}`,
      `<a class="btn primary pmo-big" data-approve-part="${esc(p.id)}" data-bu="${esc(bu)}" href="${link('/release/' + encodeURIComponent(p.id) + '?bu=' + encodeURIComponent(bu))}" data-link>Approve my part</a>`)),
    ...w.notReady.map(({ p, bu, waiting }) => `<li class="pmo-wrow pmo-wrow-muted" data-wkind="notready" data-notready="${esc(p.id)}"><span class="pmo-wic pmo-wic-notready" aria-hidden="true">…</span>
      <div class="pmo-wtxt"><div class="t">${esc(p.name)} · ${esc(bu)}</div><div class="s" data-notready-text>Your part isn’t ready yet: waiting on ${esc(waiting.length ? waiting.slice(0, 2).join(' and ') : 'your team’s tasks, information and tests')}.</div></div></li>`),
    ...w.done.map(x => { const f = fc[x.id] || {}, late = String(x.due) < today(), k = schedKey(x, fc);
      return row('done', '☐', `<a href="${link(`/project/${x.projectId}?mode=work&item=${x.id}`)}" data-link data-task-link="${esc(x.id)}">${esc(x.title)}</a>`,
        `${esc(pn(x.projectId))} · ${late ? `<b class="fail">was due ${esc(fmt(x.due))}</b>` : `due ${esc(fmt(x.due))}`}${k === 'causing' ? ' · <b class="fail">other tasks are waiting for it</b>' : ''}${!late && f.forecast && f.forecast > x.due ? ` · expected ${esc(fmt(f.forecast))}` : ''}`,
        `<button class="btn primary pmo-big" data-wdone="${esc(x.id)}" aria-label="Mark “${esc(x.title)}” done">✓ Mark done</button>`); }),
    ...w.confirm.map(d => row('confirm', '?', `Is <b>${esc(d.name)}</b> connected?`, 'The fix is done. Confirm it so the launch can count it.',
      `<a class="btn primary pmo-big" data-confirm-data="${esc(d.id)}" href="${link('/data/' + encodeURIComponent(d.id) + '?confirm=1')}" data-link>Confirm it’s connected</a>`)),
    ...w.grants.map(g => { const de = store.get('dataElement', g.dataId) || { name: g.dataId };
      return row('grant', LOCK, `${esc(pname(g.requestedBy))} asks to ${g.access === 'write' ? 'change' : 'read'} <b>${esc(de.name)}</b>`, `${esc(pn(g.projectId))} · for testing, up to 30 days, closed automatically at launch`,
        `<button class="btn primary pmo-big" data-grant-ok="${esc(g.id)}">Allow</button><button class="btn pmo-big" data-grant-no="${esc(g.id)}">Say no</button>`); }),
    ...w.mentions.map(n => row('mention', '@', esc(n.text), esc(fmtTime(n.at)),
      `${refPath(n.ref) ? `<button class="btn primary pmo-big" data-note-open="${esc(n.id)}">Open</button>` : ''}<button class="btn pmo-big" data-note-seen="${esc(n.id)}" aria-label="Mark as seen: ${esc(n.text.slice(0, 60))}">Seen</button>`)),
  ];
  return `<section class="card pmo-wait" data-waiting aria-labelledby="pmo-wait-h"><h2 id="pmo-wait-h">Waiting for you ${w.total ? `<span class="pmo-wn">${w.total}</span>` : ''}</h2>
    ${rows.length ? `<ul class="pmo-wlist">${rows.join('')}</ul>` : '<div class="pmo-wnone" data-waiting-none>✓ Nothing is waiting for you. You’re all caught up.</div>'}</section>`;
}

/* ---------------------------------------------------------------- three big choices */
function bigCards() {
  const card = (attrs, ic, t, s) => `<${attrs.startsWith('href') ? 'a' : 'button type="button"'} class="pmo-big3-c" ${attrs}><span class="pmo-big3-ic" aria-hidden="true">${ic}</span><span class="t">${t}</span><span class="s">${s}</span></${attrs.startsWith('href') ? 'a' : 'button'}>`;
  return `<section class="pmo-big3" data-big3 aria-label="What would you like to do?">
    ${card(`href="${link('/import')}" data-link data-big="import"`, PASTE_IC, 'Paste a procedure you already have', 'The fastest way: paste the text and we turn it into a process map.')}
    ${card(`href="${link('/projects')}" data-link data-big="check"`, PRJ_IC, 'Check on a project', 'See in one sentence if it’s on track, and what’s holding it up.')}
    ${card(`href="${link('/new')}" data-link data-big="map"`, PROC_IC, 'Map a process from scratch', 'Add the steps one at a time. We guide you as you go.')}</section>`;
}

/* ---------------------------------------------------------------- tiles */
function projectTile(j) {
  const s = projectStats(j.id), sm = summaryOf(j);
  const who = j.status === 'live' ? [] : whoActs(j, 2);
  return `<a class="tile pmo-tile" href="${link('/project/' + encodeURIComponent(j.id))}" data-link data-ptile="${esc(j.id)}">
    <span class="pmo-kind pmo-kind-prj">${PRJ_IC}Project</span>
    <h4>${esc(j.name)}</h4>
    ${summaryHTML(sm)}
    ${s.total ? `<div class="pmo-prog"><div class="bar"><i style="width:${s.pct}%"></i></div><b>${s.done} of ${s.total}</b><span class="hint">tasks done</span></div>` : ''}
    <div class="pmo-sline pmo-tfacts" data-tile-facts>${factsHTML(j, { cost: store.advanced })}</div>
    ${who.length ? `<div class="pmo-who" data-who>${who.map(x => `<span class="pmo-who-r">${av(x.person)}<span><b>${esc(pname(x.person))}</b>${x.action ? ': ' + esc(x.action) : ''}</span></span>`).join('')}</div>` : ''}</a>`;
}
function processTile(p) {
  const st = flatSteps(p.tobe), dc = diffCounts(p);
  const dl = [...new Set(st.flatMap(s => [...(s.data || []), ...(s.subs || []).flatMap(x => x.data || [])]))];
  const notYet = dl.filter(d => availText(d).key === 'missing').length;
  const changed = dc.new + dc.changed;
  return `<a class="tile pmo-tile" href="${link('/process/' + encodeURIComponent(p.id))}" data-link data-proctile="${esc(p.id)}">
    <span class="pmo-kind pmo-kind-proc">${PROC_IC}Process</span>
    <h4>${esc(p.name)}</h4>
    ${p.desc ? `<p>${esc(p.desc)}</p>` : ''}
    <div class="chips"><span class="chip">${plural(st.length, 'step')}</span>${changed ? `<span class="chip" data-diffcount>${changed} changing in the future version</span>` : ''}${notYet ? `<span class="chip block" data-miss>${LOCK} ${notYet} not available yet</span>` : ''}</div>
    <div class="pmo-tile-f">${av(p.owner)}<span class="hint">${esc(pname(p.owner))}</span></div></a>`;
}

export function render() {
  const me = store.person(store.state.me) || { name: 'there' };
  const procs = store.list('process'), projects = store.list('project').slice().sort((a, b) => (a.status === 'live') - (b.status === 'live'));
  return `<section class="pmo-greet"><h1 data-greeting>Hi ${esc(me.name.split(' ')[0])}.</h1><p>Here’s what needs you, and what you can do next.</p></section>
    ${waitHTML()}
    ${bigCards()}
    <div class="sect" id="home-projects"><h2>Projects</h2><button class="btn pmo-sect-btn" data-new-project>+ New project</button></div>
    ${projects.length ? `<div class="home-grid">${projects.map(projectTile).join('')}</div>` : '<div class="card" style="margin-top:12px"><div class="empty">No projects yet. <button class="btn primary" data-new-project>+ New project</button></div></div>'}
    <div class="sect" id="home-processes"><h2>Processes</h2><a class="btn pmo-sect-btn" href="${link('/new')}" data-link>+ New process</a></div>
    ${procs.length ? `<div class="home-grid">${procs.map(processTile).join('')}</div>` : `<div class="card" style="margin-top:12px"><div class="empty">No processes yet. <a href="${link('/import')}" data-link style="color:var(--accent)">Paste a procedure</a> or <a href="${link('/new')}" data-link style="color:var(--accent)">map one from scratch</a>.</div></div>`}`;
}

async function decideGrant(id, ok) {
  const g = store.get('grant', id); if (!g) return;
  const me = store.state.me, de = store.get('dataElement', g.dataId) || { name: g.dataId };
  if (grantApprover(g) !== me) { toast('Only the information owner can decide this request.'); return; }
  let next;
  if (ok) {
    if (!(await stepUp(`allow ${g.access} access to ${de.name}`))) { toast('Not verified. Nothing changed.'); return; }
    const expires = addDays(today(), Math.max(1, Math.min(30, Number(g.durationDays) || 30)));
    next = Object.assign({}, g, { status: 'active', approvedBy: me, approvedAt: new Date().toISOString(), expires, log: [...(g.log || []), { at: new Date().toISOString(), by: me, action: `approved (step-up verified); access active until ${fmt(expires)}` }] });
    await store.save('grant', id, next, `Access to ${de.name} (${String(g.env).toUpperCase()}) approved (step-up verified); active until ${fmt(expires)}`);
  } else {
    next = Object.assign({}, g, { status: 'denied', log: [...(g.log || []), { at: new Date().toISOString(), by: me, action: 'denied' }] });
    await store.save('grant', id, next, `Access to ${de.name} (${String(g.env).toUpperCase()}) denied`);
  }
  await store.notify([g.requestedBy], `${pname(me)} ${ok ? 'approved' : 'denied'} your ${g.access} access to ${de.name}`, 'grant:' + id);
  toast(ok ? 'Access allowed' : 'Request declined');
}
async function readNote(id) {
  const n = store.get('notification', id); if (!n || n.read) return n;
  await store.save('notification', id, Object.assign({}, n, { read: true }), 'Read notification');
  return n;
}

export function bind(root) {
  const on = (sel, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener('click', e => { e.preventDefault(); fn(el); }));
  on('[data-new-project]', () => newProject());
  on('[data-wdone]', async el => {
    el.disabled = true;
    await markDone(el.dataset.wdone); /* shows "Done · Undo" */
  });
  on('[data-grant-ok]', el => decideGrant(el.dataset.grantOk, true));
  on('[data-grant-no]', el => decideGrant(el.dataset.grantNo, false));
  on('[data-note-seen]', el => { el.disabled = true; readNote(el.dataset.noteSeen); });
  on('[data-note-open]', async el => { const n = await readNote(el.dataset.noteOpen); const p = n && refPath(n.ref); if (p) go(p); });
  on('[data-big="check"]', () => go('/projects'));
}

/* Kept for other pages and older tests: business units still to approve a project (now from the engine's sign-off check). */
export const pendingApprovals = pendingSections;
