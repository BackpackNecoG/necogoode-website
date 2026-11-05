/* PMOFlow — home (stream P). Route: /
   R7 SIMPLICITY: "Hi <first name>", a "Waiting for you" list (R9: exactly E().personQueue) with one-tap actions,
   three big choices, then projects and processes (each labelled, one plain sentence each). */
import { store } from '../store.js';
import { esc, fmt, link, go, av, pname, LOCK } from '../ui.js';
import { eng, docs, today, flatSteps, projectStats, newProject, summaryOf, summaryHTML, whoLineHTML, markDone, availText, diffCounts, factsHTML } from './project.js';

const PRJ_IC = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h7"/></svg>';
const PROC_IC = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="5" rx="1.5"/><rect x="7" y="17" width="10" height="5" rx="1.5"/><path d="M12 7v3M12 14v3"/><path d="M12 10l3 2-3 2-3-2z"/></svg>';
const PASTE_IC = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 2h6v4H9zM8 11h8M8 15h8M8 19h5"/></svg>';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------------------------------------------------------------- "Waiting for you" */
/* R9 §2: "Waiting for you" is exactly E().personQueue(docs, me, today). The badge is its length; the header bell reads
   the same function (queueCount). Nothing here decides what is late or what is waiting. */
export function personQueue(person) {
  const q = eng('personQueue', [], docs(), person || store.state.me, today());
  return Array.isArray(q) ? q : [];
}
export const queueCount = person => personQueue(person).length;
export function waitingFor() { const list = personQueue(); return { list, total: list.length }; }

/* §7: an approval opens that team's part page */
const hrefOf = x => x.kind === 'approval' && x.projectId && x.id ? `/release/${encodeURIComponent(x.projectId)}?bu=${encodeURIComponent(x.id)}` : (x.href || '/');
const KIND_IC = { work: '☐', fix: '☐', practice: '☐', problem: '!', approval: '✓', test: '▶', confirm: '?', information: LOCK, action: '›' };
const KIND_CLS = { work: 'done', fix: 'done', practice: 'done', problem: 'notready', approval: 'approve', test: 'test', confirm: 'confirm', information: 'notready', action: 'mention' };
function waitHTML() {
  const { list } = waitingFor();
  const pn = id => (store.get('project', id) || {}).name || '';
  const rows = list.map((x, i) => {
    const kind = String(x.kind || 'action'), cls = KIND_CLS[kind] || 'mention';
    const due = x.due ? (x.late ? `<b class="fail">Late · was due ${esc(fmt(x.due))}</b>` : `due ${esc(fmt(x.due))}`) : (x.late ? '<b class="fail">Late</b>' : '');
    const sub = [pn(x.projectId) ? esc(pn(x.projectId)) : '', due].filter(Boolean).join(' · ');
    const one = x.oneTap && x.oneTap.action;
    const title = esc(x.title || x.what || '');
    const act = one === 'done' && x.id
      ? `<button class="btn primary pmo-big" data-wdone="${esc(x.id)}" aria-label="${esc((x.oneTap.label || 'Mark done') + ': ' + (x.title || ''))}">✓ ${esc(x.oneTap.label || 'Mark done')}</button>`
      : one === 'confirm' && x.id
      ? `<a class="btn primary pmo-big" data-confirm-data="${esc(x.id)}" href="${link('/data/' + encodeURIComponent(x.id) + '?confirm=1')}" data-link>${esc(x.oneTap.label || 'Confirm')}</a>`
      : `<a class="btn primary pmo-big" href="${link(hrefOf(x))}" data-link data-wopen="${i}">${kind === 'approval' ? 'Open the approval' : kind === 'test' ? 'Run it' : 'Open'}</a>`;
    return `<li class="pmo-wrow" data-wkind="${esc(kind)}" data-wq="${i}"><span class="pmo-wic pmo-wic-${cls}" aria-hidden="true">${KIND_IC[kind] || '›'}</span>
      <div class="pmo-wtxt"><div class="t"><a href="${link(hrefOf(x))}" data-link ${x.id ? `data-task-link="${esc(x.id)}"` : ''}>${title}</a></div>${sub ? `<div class="s">${sub}</div>` : ''}</div><div class="pmo-wact">${act}</div></li>`;
  });
  return `<section class="card pmo-wait" data-waiting aria-labelledby="pmo-wait-h"><h2 id="pmo-wait-h">Waiting for you ${list.length ? `<span class="pmo-wn" data-wait-count>${list.length}</span>` : ''}</h2>
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

  return `<a class="tile pmo-tile" href="${link('/project/' + encodeURIComponent(j.id))}" data-link data-ptile="${esc(j.id)}">
    <span class="pmo-kind pmo-kind-prj">${PRJ_IC}Project</span>
    <h4>${esc(j.name)}</h4>
    ${summaryHTML(sm)}
    ${s.total ? `<div class="pmo-prog"><div class="bar"><i style="width:${s.pct}%"></i></div><b>${s.done} of ${s.total}</b><span class="hint">tasks done</span></div>` : ''}
    <div class="pmo-sline pmo-tfacts" data-tile-facts>${factsHTML(j, { cost: store.advanced })}</div>
    ${whoLineHTML(j, 2)}</a>`;
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

export function bind(root) {
  const on = (sel, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener('click', e => { e.preventDefault(); fn(el); }));
  on('[data-new-project]', () => newProject());
  on('[data-wdone]', async el => {
    el.disabled = true;
    await markDone(el.dataset.wdone); /* shows "Done · Undo" */
  });
  on('[data-big="check"]', () => go('/projects'));
}
