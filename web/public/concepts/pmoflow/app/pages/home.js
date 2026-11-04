/* PMOFlow — workspace home (stream P). Route: / */
import { store } from '../store.js';
import { esc, fmt, fmtTime, link, av, pname, LOCK } from '../ui.js';
import { eng, forecasts, flatSteps, projectStats, rag, ragBadge, dataName, rerender, finishInfo, dueLine } from './project.js';

let scope = 'mine'; /* 'mine' | 'all' */

/* BUs that own steps in a project's linked processes and still need a (re-)approval.
   An approval is stale when work or a process in that BU's section changed after it (R2). Returns [{bu, stale}]. */
export function pendingApprovals(project) {
  if (!project || project.status === 'live') return [];
  const section = {}; /* bu -> {steps:Set('pid/sid'), procs:Set(pid)} */
  (project.processes || []).forEach(pid => {
    const p = store.get('process', pid); if (!p) return;
    flatSteps(p.tobe).forEach(s => { const o = store.person(s.owner); if (!o || !o.bu) return; const x = section[o.bu] = section[o.bu] || { steps: new Set(), procs: new Set() }; x.steps.add(pid + '/' + s.id); x.procs.add(pid); });
  });
  const out = [];
  Object.keys(section).sort().forEach(bu => {
    const ap = store.list('approval', a => a.projectId === project.id && a.bu === bu).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    if (!ap || ap.decision !== 'approved') { out.push({ bu, stale: false }); return; }
    const at = String(ap.at || '');
    const x = section[bu];
    const changed = store.list('workItem', w => w.projectId === project.id && x.steps.has(w.pid + '/' + w.step) && String(w.updatedAt || '') > at).length
      + [...x.procs].filter(pid => String((store.get('process', pid) || {}).updatedAt || '') > at).length;
    if (changed) out.push({ bu, stale: true });
  });
  return out;
}

function attention() {
  const me = store.state.me, my = store.person(me) || {};
  const fc = forecasts();
  const projects = store.list('project');
  const pName = id => (store.get('project', id) || {}).name || 'Project';
  const work = store.list('workItem', w => w.status !== 'done' && fc[w.id] && (fc[w.id].sched === 'late' || fc[w.id].sched === 'slip'))
    .map(w => ({ w, f: fc[w.id] })).sort((a, b) => (b.f.slipDays || 0) - (a.f.slipDays || 0));
  const approvals = projects.flatMap(p => pendingApprovals(p).map(x => ({ p, bu: x.bu, stale: x.stale })));
  const grants = store.list('grant', g => g.status === 'requested').map(g => ({ g, d: store.get('dataElement', g.dataId) }));
  const notes = store.list('notification', n => !n.read).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const mine = {
    work: work.filter(x => x.w.owner === me),
    approvals: approvals.filter(x => my.bu && x.bu === my.bu),
    grants: grants.filter(x => x.d && x.d.owner === me),
    notes: notes.filter(n => n.to === me),
  };
  const all = { work, approvals, grants, notes };
  return { mine, all, my };
}

function attnHTML() {
  const { mine, all, my } = attention();
  const set = scope === 'mine' ? mine : all;
  const more = (arr, n) => arr.length > n ? `<div class="hint pmo-more">+${arr.length - n} more</div>` : '';
  const box = (key, title, sub, arr, rows, emptyText) => `<div class="pmo-attn-col ${arr.length ? 'has' : ''}" data-attn="${key}">
      <div class="pmo-attn-h"><b class="pmo-attn-n">${arr.length}</b><div><div class="t">${title}</div><div class="hint">${sub}</div></div></div>
      ${arr.length ? rows + more(arr, 3) : `<div class="pmo-attn-empty">${emptyText}</div>`}</div>`;
  const workRows = set.work.slice(0, 3).map(({ w, f }) => `<a class="pmo-attn-row" href="${link('/project/' + encodeURIComponent(w.projectId) + '?mode=work')}" data-link>${av(w.owner)}<span><span class="t">${esc(w.title)}</span><span class="s">${f.sched === 'late' ? '<b class="fail">Late</b>' : '<b class="warn">Slipping</b>'} · ${esc(dueLine(w, f))}${f.cause ? ' · waits on ' + esc(dataName(f.cause) !== f.cause ? dataName(f.cause) : ((store.get('workItem', f.cause) || {}).title || f.cause)) : ''}</span></span></a>`).join('');
  const apprRows = set.approvals.slice(0, 3).map(({ p, bu, stale }) => `<a class="pmo-attn-row" href="${link('/release/' + encodeURIComponent(p.id))}" data-link><span class="pmo-attn-ic">✓</span><span><span class="t">${esc(bu)} ${stale ? 're-approval (changed since sign-off)' : 'sign-off'}</span><span class="s">${esc(p.name)}</span></span></a>`).join('');
  const grantRows = set.grants.slice(0, 3).map(({ g, d }) => `<a class="pmo-attn-row" href="${link('/release/' + encodeURIComponent(g.projectId))}" data-link><span class="pmo-attn-ic">${LOCK}</span><span><span class="t">${esc(d ? d.name : g.dataId)}</span><span class="s">${esc(String(g.env || '').toUpperCase())} ${esc(g.access || '')} · requested by ${esc(pname(g.requestedBy))}</span></span></a>`).join('');
  const noteRows = set.notes.slice(0, 3).map(n => `<button class="pmo-attn-row" data-open-bell><span class="pmo-attn-ic">●</span><span><span class="t">${esc(n.text)}</span><span class="s">${scope === 'all' ? 'To ' + esc(pname(n.to)) + ' · ' : ''}${esc(fmtTime(n.at))}</span></span></button>`).join('');
  const total = set.work.length + set.approvals.length + set.grants.length + set.notes.length;
  return `<section class="card pmo-attn">
    <div class="pmo-attn-top"><h3 style="margin:0">Needs attention <span class="n">${total}</span></h3>
      <span class="hint">${scope === 'mine' ? `For ${esc(pname(store.state.me))}${my.bu ? ' · ' + esc(my.bu) : ''}` : 'Across the whole workspace'}</span>
      <div class="seg" role="tablist" style="margin-left:auto"><button data-scope="mine" class="${scope === 'mine' ? 'on' : ''}">Mine (${mine.work.length + mine.approvals.length + mine.grants.length + mine.notes.length})</button><button data-scope="all" class="${scope === 'all' ? 'on' : ''}">Everyone (${all.work.length + all.approvals.length + all.grants.length + all.notes.length})</button></div></div>
    <div class="pmo-attn-grid">
      ${box('work', 'Late or slipping work', scope === 'mine' ? 'Items you own' : 'All projects', set.work, workRows, 'Nothing late or slipping.')}
      ${box('approvals', 'Approvals waiting', scope === 'mine' ? (my.bu ? 'Your business unit: ' + esc(my.bu) : 'No business unit') : 'Every business unit', set.approvals, apprRows, 'No sign-offs waiting.')}
      ${box('grants', 'Access requests', scope === 'mine' ? 'On data you own' : 'All data', set.grants, grantRows, 'No pending requests.')}
      ${box('notes', 'Unread notifications', scope === 'mine' ? 'Mentions and alerts for you' : 'Everyone’s unread', set.notes, noteRows, 'You’re all caught up.')}
    </div></section>`;
}

function processTile(p) {
  const st = flatSteps(p.tobe);
  const dp = eng('diffProcess', { nodes: {} }, p) || { nodes: {} };
  const kinds = Object.values(dp.nodes || {});
  const nw = kinds.filter(k => k === 'new').length, chg = kinds.filter(k => k === 'changed').length;
  const dl = new Set(st.flatMap(s => s.data || []));
  const miss = [...dl].filter(d => (store.get('dataElement', d) || {}).avail === 'missing').length;
  return `<a class="tile" href="${link('/process/' + encodeURIComponent(p.id))}" data-link><div class="pmo-tile-h"><h4>${esc(p.name)}</h4>${p.version ? `<span class="chip">v${esc(p.version)}</span>` : ''}</div>
    ${p.desc ? `<p>${esc(p.desc)}</p>` : ''}
    <div class="chips"><span class="chip">${st.length} steps</span><span class="chip">${nw} new + ${chg} changed vs as-is</span><span class="chip">${dl.size} data elements</span>${miss ? `<span class="chip block">${LOCK} ${miss} missing</span>` : ''}</div>
    <div class="pmo-tile-f">${av(p.owner)}<span class="hint">${esc(pname(p.owner))}</span></div></a>`;
}
function projectTile(j) {
  const s = projectStats(j.id), r = rag(j, s), fi = finishInfo(j, s);
  const over = fi.over;
  return `<a class="tile" href="${link('/project/' + encodeURIComponent(j.id))}" data-link><div class="pmo-tile-h"><h4>${esc(j.name)}</h4>${ragBadge(r)}</div>
    ${j.desc ? `<p>${esc(j.desc)}</p>` : ''}
    <div class="pmo-prog"><div class="bar"><i style="width:${s.pct}%"></i></div><b>${s.pct}%</b></div>
    <div class="chips"><span class="chip">${s.done}/${s.total} work done</span>${s.late + s.slip ? `<span class="chip block">${s.late} late · ${s.slip} slipping</span>` : ''}
      <span class="chip ${over ? 'block' : ''}">${fi.label} ${esc(fmt(fi.date))} · target ${esc(fmt(j.target))}</span><span class="chip">${(j.processes || []).length} linked process${(j.processes || []).length === 1 ? '' : 'es'}</span></div>
    <div class="pmo-tile-f">${av(j.owner)}<span class="hint">${esc(pname(j.owner))}</span></div></a>`;
}

export function render() {
  const procs = store.list('process'), projects = store.list('project');
  return `<section class="hdr pmo-hero"><div><div class="crumbs">Northwind Traders · Workspace</div><h1>Process-first planning</h1>
      <p>Analysts design the process; the project is the work that gets you from how it runs today to the designed version. One map for both, with blockers computed from the data each step needs.</p></div>
    <div class="hdr-side"><div class="pmo-hero-acts"><a class="btn primary" href="${link('/new')}" data-link>+ New workflow</a><a class="btn" href="${link('/import')}" data-link>Import an SOP</a><a class="btn" href="${link('/portfolio')}" data-link>Portfolio</a></div></div></section>
    ${attnHTML()}
    <div class="sect"><h2>Processes</h2><span class="hint">As-is, to-be and the diff, with data requirements and owners</span></div>
    ${procs.length ? `<div class="home-grid">${procs.map(processTile).join('')}</div>` : `<div class="card" style="margin-top:12px"><div class="empty">No processes yet. <a href="${link('/new')}" data-link style="color:var(--accent)">Create a workflow</a> or <a href="${link('/import')}" data-link style="color:var(--accent)">import an SOP</a>.</div></div>`}
    <div class="sect"><h2>Projects</h2><span class="hint">Work items attached to to-be steps, with dependencies and forecasts</span></div>
    ${projects.length ? `<div class="home-grid">${projects.map(projectTile).join('')}</div>` : '<div class="card" style="margin-top:12px"><div class="empty">No projects yet.</div></div>'}`;
}

export function bind(root) {
  root.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => { scope = b.dataset.scope; rerender(); }));
  root.querySelectorAll('[data-open-bell]').forEach(b => b.addEventListener('click', () => { const bell = document.getElementById('bell'); if (bell) bell.click(); }));
}
