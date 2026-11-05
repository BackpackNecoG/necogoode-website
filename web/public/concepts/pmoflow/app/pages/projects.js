/* PMOFlow — projects list (stream P). Route: /projects
   R8 §8: "Projects" in the nav and "Check on a project" on home land here. One row per project, every value from
   projectTruth (label, sentence, expected finish, late, blocking), the ones that need attention first. */
import { store } from '../store.js';
import { esc, fmt, link, av, pname } from '../ui.js';
import { summaryOf, summaryHTML, projectStats, factsHTML, whoActs, newProject, isSimple, truthOf } from './project.js';

const ORDER = { red: 0, amber: 1, none: 2, green: 3, live: 4 };

function rowHTML(j) {
  const s = projectStats(j.id), sm = summaryOf(j), who = j.status === 'live' ? [] : whoActs(j, 2);
  return `<a class="card pmo-plist-row" href="${link('/project/' + encodeURIComponent(j.id))}" data-link data-plist="${esc(j.id)}">
    <div class="pmo-plist-h"><h3>${esc(j.name)}</h3><span class="pmo-chev" aria-hidden="true">›</span></div>
    ${summaryHTML(sm)}
    <div class="pmo-sline">${s.total ? `<span><b>${s.done} of ${s.total}</b> tasks done</span>` : ''}${factsHTML(j, { cost: !isSimple() })}<span>Deadline <b>${esc(fmt(j.target))}</b></span></div>
    ${who.length ? `<div class="pmo-who" data-who><span class="lbl">Who needs to act</span>${who.map(x => `<span class="pmo-who-r">${av(x.person)}<span><b>${esc(pname(x.person))}</b>${x.action ? ': ' + esc(x.action) : ''}</span></span>`).join('')}</div>` : ''}
    <div class="hint">Project manager ${esc(pname(j.owner))}</div></a>`;
}

export function render() {
  const all = store.list('project');
  const sorted = all.map(p => ({ p, k: truthOf(p).k })).sort((a, b) => (ORDER[a.k] ?? 5) - (ORDER[b.k] ?? 5) || String(a.p.target || '').localeCompare(String(b.p.target || ''))).map(x => x.p);
  const active = sorted.filter(p => p.status !== 'live'), live = sorted.filter(p => p.status === 'live');
  return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> › Projects</div><h1>Projects</h1>
      <p>Each project in one sentence: is it on track, and who needs to act. Open one to see its plan.</p></div>
    <div class="hdr-side"><button class="btn primary" data-new-project>+ New project</button></div></section>
    ${all.length ? `${active.length ? `<div class="pmo-plist" data-plist-active>${active.map(rowHTML).join('')}</div>` : ''}
      ${live.length ? `<div class="sect"><h2>Launched</h2></div><div class="pmo-plist" data-plist-live>${live.map(rowHTML).join('')}</div>` : ''}`
      : '<div class="card" style="margin-top:14px"><div class="empty" data-plist-empty>No projects yet. <button class="btn primary" data-new-project>+ New project</button></div></div>'}
    <div class="hint" style="margin-top:14px">Want every project’s money, workload and risks together? <a href="${link('/portfolio')}" data-link style="color:var(--accent)">Open the Portfolio ›</a></div>`;
}

export function bind(root) {
  root.querySelectorAll('[data-new-project]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); newProject(); }));
}
