/* Process index (stream D, R4): /processes — every process with version, owner, step count, new + changed,
   data state counts and linked projects; search; "+ New workflow", "Import BPMN" and "Import SOP". */
import { store } from '../store.js';
import { esc, fmt, link, av, pname } from '../ui.js';
import { flat, diffCounts, effAvail, projectsFor, importBtn, bindImport, isAdv, AV, HAVE, NOTYET } from './process.js';

let query = ''; /* kept across re-renders (the router re-renders on every store change) */

const norm = s => String(s || '').toLowerCase();
function rowOf(p) {
  const steps = flat(p.tobe);
  const ids = [...new Set(steps.flatMap(s => s.data || []))];
  const st = ids.map(effAvail);
  const n = k => st.filter(a => a === k).length;
  const prjs = projectsFor(p.id);
  return { p, steps: steps.length, sum: diffCounts(p), data: { total: ids.length, live: n('live'), pending: n('pending'), example: n('example'), missing: n('missing') }, prjs,
    hay: norm([p.name, p.desc, pname(p.owner), ...prjs.map(j => j.name), ...steps.map(s => s.title)].join(' ')) };
}
const matches = (r, q) => !q || norm(q).split(/\s+/).filter(Boolean).every(t => r.hay.includes(t));

function dataCell(d) {
  if (!d.total) return '<span class="hint">None added yet</span>';
  /* R8 §1: two states in Simple */
  if (!isAdv()) { const ny = d.total - d.live;
    return `<div class="d-dcs" data-datacounts="${d.live}/${d.pending}/${d.example}/${d.missing}">${d.live ? `<span class="d-dc d-dc-live" title="${HAVE}"><i aria-hidden="true"></i>We have ${d.live}</span>` : ''}${ny ? `<span class="d-dc d-dc-missing" title="${NOTYET}"><i aria-hidden="true"></i>${ny} ${NOTYET.toLowerCase()}</span>` : ''}</div>`; }
  const seg = (k, v) => v ? `<span class="d-dc d-dc-${k}" title="${esc(AV[k].label)}"><i aria-hidden="true"></i>${v} ${esc(AV[k].label.toLowerCase())}</span>` : '';
  return `<div class="d-dcs" data-datacounts="${d.live}/${d.pending}/${d.example}/${d.missing}">${seg('live', d.live)}${seg('pending', d.pending)}${seg('example', d.example)}${seg('missing', d.missing)}</div>`;
}

export function render() {
  const rows = store.list('process').map(rowOf).sort((a, b) => String(a.p.name).localeCompare(String(b.p.name)));
  const shown = rows.filter(r => matches(r, query));
  const totals = rows.reduce((t, r) => { t.steps += r.steps; t.pending += r.data.pending; t.missing += r.data.missing; return t; }, { steps: 0, pending: 0, missing: 0 });
  const adv = isAdv();
  const list = rows.length ? rows.map(r => {
    const p = r.p, hidden = !matches(r, query);
    return `<div class="d-prow" data-prow="${esc(p.id)}" ${hidden ? 'hidden' : ''}>
      <div class="d-pname"><a href="${link('/process/' + p.id)}" data-link><b>${esc(p.name)}</b></a>${adv ? ` <span class="badge b-idle" data-ver>v${esc(p.version || 1)}</span>` : ''}${p.desc ? `<div class="s d-desc">${esc(p.desc)}</div>` : ''}</div>
      <div class="d-pcell" data-col="owner"><span class="d-plbl">Owner</span>${p.owner ? `${av(p.owner)} ${esc(pname(p.owner))}` : '<span class="hint">None</span>'}</div>
      <div class="d-pcell" data-col="steps"><span class="d-plbl">Steps</span><b>${r.steps}</b></div>
      <div class="d-pcell" data-col="diff"><span class="d-plbl">What changed</span><b title="${r.sum.new} new, ${r.sum.changed} changed">${r.sum.new}+${r.sum.changed}</b></div>
      <div class="d-pcell" data-col="data"><span class="d-plbl">Information</span>${dataCell(r.data)}</div>
      <div class="d-pcell" data-col="projects"><span class="d-plbl">Projects</span>${r.prjs.length ? r.prjs.map(j => `<a class="chip" href="${link('/project/' + j.id)}" data-link>${esc(j.name)}${j.status === 'live' ? ' · launched' : ''}</a>`).join('') : '<span class="hint">Not in a project</span>'}</div>
    </div>`;
  }).join('') : '';

  return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> › Processes</div><h1>Processes</h1>
      <p>Every process: how it works today, how it should work in future, and whether the information it needs is ready.</p>
      <div class="d-pacts"><a class="btn sm" href="${link('/import')}" data-link data-import-sop>Paste a procedure</a><a class="btn primary" href="${link('/new')}" data-link data-new-workflow>+ Map a process</a>${adv ? importBtn() : ''}</div></div>
    ${adv ? `<div class="hdr-side"><div class="kpis"><div class="kpi"><b>${rows.length}</b><span>Processes</span></div><div class="kpi"><b>${totals.steps}</b><span>Future steps</span></div><div class="kpi"><b style="color:${totals.missing ? 'var(--late)' : totals.pending ? '#b45309' : 'inherit'}">${totals.missing}/${totals.pending}</b><span>Not available yet / waiting</span></div></div></div>` : ''}</section>
  <div class="card d-pindex">
    <div class="d-psearch"><input type="search" data-psearch value="${esc(query)}" placeholder="Search processes, owners, steps or projects" aria-label="Search processes" />
      <span class="hint" data-pcount aria-live="polite">${shown.length} of ${rows.length}</span></div>
    ${rows.length ? `<div class="d-phead" aria-hidden="true"><span>Process</span><span>Owner</span><span>Steps</span><span>What changed</span><span>Information</span><span>Projects</span></div>
      <div class="d-plist">${list}</div><div class="empty" data-pnone ${shown.length ? 'hidden' : ''}>No process matches “<span data-pq>${esc(query)}</span>”.</div>`
      : `<div class="empty" data-pempty>No processes yet. Paste a procedure you already have, or map one from scratch.</div>`}
  </div>`;
}

export function bind(root) {
  bindImport(root);
  const inp = root.querySelector('[data-psearch]');
  if (!inp) return;
  const rows = store.list('process').map(rowOf);
  const apply = () => {
    query = inp.value;
    let n = 0;
    rows.forEach(r => { const el = root.querySelector(`[data-prow="${CSS.escape(r.p.id)}"]`); if (!el) return; const on = matches(r, query); el.hidden = !on; if (on) n++; });
    const c = root.querySelector('[data-pcount]'); if (c) c.textContent = `${n} of ${rows.length}`;
    const none = root.querySelector('[data-pnone]'); if (none) { none.hidden = n > 0; const q = none.querySelector('[data-pq]'); if (q) q.textContent = query; }
  };
  inp.addEventListener('input', apply);
}
