/* Process page (stream D): /process/:pid?mode=asis|tobe|diff|lanes|edit and /new.
   Vertical map ported from v2, plus a structural editor that saves the whole process doc. */
import { store } from '../store.js';
import { E, esc, fmt, link, go, av, personChip, pname, badge, chip, dataDot, AVAIL, LOCK, modal, toast, activityCard, bindActivity } from '../ui.js';

/* ---------- shared helpers (also used by step.js and data.js) ---------- */
export const docs = () => store.state.docs;
export const today = () => store.state.today;
/* Engine call that never takes the page down: a failure renders an empty result and logs a warning. */
export function eng(name, args, fallback) {
  try { const P = E(); if (!P || typeof P[name] !== 'function') return fallback; const r = P[name](...args); return r == null ? fallback : r; }
  catch (e) { console.warn('PMOEngine.' + name + ' failed:', e && e.message); return fallback; }
}
export const isStep = n => n && n.type !== 'trigger' && n.type !== 'end' && n.type !== 'decision';
export function flat(nodes) {
  const out = [];
  (nodes || []).forEach(n => { if (!n) return; if (n.type === 'decision') (n.branches || []).forEach(b => out.push(...flat(b.nodes))); else if (isStep(n)) out.push(n); });
  return out;
}
export const dataEl = id => store.get('dataElement', id);
export const dataName = id => (dataEl(id) || {}).name || id;
export const availOf = id => (dataEl(id) || {}).avail || 'missing';
export function readyCounts(ids) { ids = ids || []; return { live: ids.filter(d => availOf(d) === 'live').length, total: ids.length, missing: ids.filter(d => availOf(d) === 'missing').length }; }
export const projectsFor = pid => store.list('project', j => (j.processes || []).includes(pid));
export const STATUS_LBL = { done: 'Done', prog: 'In progress', idle: 'Not started', none: 'No change' };
export function workBadge(w, f) {
  f = f || {};
  if (w.status === 'done') return badge('Done ' + fmt(w.due), 'b-done');
  const dd = daysTo(w.due);
  if (f.sched === 'late') return badge((dd < 0 ? -dd + 'd late' : 'Late') + (f.forecast && f.forecast > w.due ? ' · now ' + fmt(f.forecast) : ''), 'b-late');
  if (f.sched === 'slip') return badge('Slipping → ' + fmt(f.forecast), 'b-slip');
  if (f.sched === 'soon') return badge('Due in ' + Math.max(0, dd) + 'd', 'b-soon');
  return badge('Due ' + fmt(w.due), 'b-ok');
}
export function stepBadge(st) {
  if (!st || st.status === 'none') return badge('No change', 'b-none');
  if (st.status === 'done') return badge('Done', 'b-done');
  const sch = st.sched === 'late' ? badge('Late' + (st.forecast && st.forecast > st.due ? ' · now ' + fmt(st.forecast) : ''), 'b-late')
    : st.sched === 'slip' ? badge('Slipping → ' + fmt(st.forecast), 'b-slip')
    : st.sched === 'soon' ? badge('Next due in ' + Math.max(0, daysTo(st.next || st.due)) + 'd', 'b-soon') : badge('Due ' + fmt(st.due), 'b-ok');
  return badge(STATUS_LBL[st.status] || st.status, 'b-' + st.status) + ' ' + sch;
}
function daysTo(s) { if (!s) return 0; return Math.round((new Date(s + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 86400000); }
export const notFound = what => `<div class="card"><h3>Not found</h3><p class="hint" style="margin:0 0 8px">${esc(what || 'This item')} does not exist in your sandbox. It may have been deleted, or the demo data was reset.</p><a href="${link('/')}" data-link style="color:var(--accent)">Back to workspace</a></div>`;
const touchChip = t => `<span class="chip touch"># ${esc(t)}</span>`;
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- tree helpers ---------- */
function findLoc(nodes, id) {
  for (let i = 0; i < (nodes || []).length; i++) {
    const n = nodes[i]; if (n.id === id) return { list: nodes, index: i, node: n };
    if (n.type === 'decision') for (const b of n.branches || []) { const r = findLoc(b.nodes, id); if (r) return r; }
  }
  return null;
}
function getList(nodes, key) {
  if (key === 'root') return nodes;
  const [did, bi] = key.split('#'); const loc = findLoc(nodes, did);
  return loc && loc.node.branches && loc.node.branches[+bi] ? loc.node.branches[+bi].nodes : null;
}
function freshIds(nodes, keepFrom) {
  return (nodes || []).map(n => {
    const c = clone(n); c.id = store.newId(n.type === 'decision' ? 'd' : 'n');
    if (keepFrom && n.type !== 'decision') c.from = n.id; else delete c.from;
    if (c.type === 'decision') c.branches = (n.branches || []).map(b => ({ label: b.label, nodes: freshIds(b.nodes, keepFrom) }));
    return c;
  });
}
const VER = { asis: 'as-is', tobe: 'to-be' };

/* ---------- map rendering ---------- */
function nodeHTML(n, ctx, idx) {
  if (n.type === 'end') return `<div class="node end" data-node="${esc(n.id)}">● ${esc(n.title || 'End')}${ctx.edit ? ' ' + toolbar(n, ctx) : ''}</div>`;
  const trig = n.type === 'trigger';
  const rd = readyCounts(n.data);
  const status = ctx.diff ? (ctx.diff.nodes || {})[n.id] : null;
  const showDiff = ctx.mode === 'diff' && status && status !== 'same';
  const diffChip = showDiff ? `<span class="chip diff-${esc(status)}">${status === 'new' ? 'NEW' : 'CHANGED'}</span>` : '';
  let body = '';
  if (trig) body = `<div class="stats">${(n.touches || []).map(touchChip).join('') || '<span class="hint">Kickoff</span>'}</div>`;
  else {
    body = `<div class="stats"><span>Data <b>${rd.live}/${rd.total}</b> live</span>${rd.missing ? `<span style="color:var(--late)">${LOCK} ${rd.missing} missing</span>` : ''}<span>${(n.touches || []).length} area${(n.touches || []).length === 1 ? '' : 's'}</span>${(n.subs || []).length ? `<span>${n.subs.length} sub-steps</span>` : ''}</div>`;
    if (showDiff && status === 'changed') body += changeNote(n, ctx);
  }
  const goAttr = !ctx.edit && !trig && ctx.pid ? `data-go="/process/${esc(ctx.pid)}/step/${esc(n.id)}" tabindex="0" role="link" aria-label="Open step ${esc(n.title)}"` : '';
  return `<div class="node ${trig ? 'trigger' : ''} ${ctx.edit ? 'd-editing' : ''}" data-node="${esc(n.id)}" ${trig ? '' : `data-step="${esc(n.id)}"`} data-data="${esc((n.data || []).join(','))}" ${goAttr}>
    <div class="nh"><span class="ic">${trig ? '⚡' : idx}</span>
      <div style="min-width:0"><div class="ttl">${esc(n.title)}</div><div class="num">${trig ? 'Kickoff / trigger' : esc(pname(n.owner))}</div></div>
      <div style="margin-left:auto;display:flex;gap:5px;align-items:center">${diffChip}${n.owner ? av(n.owner) : ''}</div></div>
    <div class="nb">${body}</div>${ctx.edit ? `<div class="d-tools">${toolbar(n, ctx)}</div>` : ''}</div>`;
}
function changeNote(n, ctx) {
  const a = n.from ? ctx.asisById[n.from] : null;
  const lines = [];
  if (a) {
    /* readable version of the engine's change list: names instead of ids */
    if ((a.title || '') !== (n.title || '')) lines.push('was: ' + a.title);
    if ((a.owner || '') !== (n.owner || '')) lines.push('owner: ' + pname(a.owner) + ' → ' + pname(n.owner));
    const ad = new Set(a.data || []), nd = new Set(n.data || []);
    const added = [...nd].filter(d => !ad.has(d)), removed = [...ad].filter(d => !nd.has(d));
    if (added.length) lines.push('+ data: ' + added.map(dataName).join(', '));
    if (removed.length) lines.push('− data: ' + removed.map(dataName).join(', '));
  }
  if (!lines.length) lines.push('same step, new method or data');
  return `<div class="was d-was">${lines.map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
}
function toolbar(n, ctx) {
  const lbl = esc(n.title || n.type);
  const movable = n.type !== 'trigger' && n.type !== 'end';
  return `<button class="btn sm" data-ed="edit" data-id="${esc(n.id)}" aria-label="Edit ${lbl}">Edit</button>${movable ? `
    <button class="btn sm" data-ed="up" data-id="${esc(n.id)}" aria-label="Move ${lbl} up">↑</button>
    <button class="btn sm" data-ed="down" data-id="${esc(n.id)}" aria-label="Move ${lbl} down">↓</button>
    <button class="btn sm danger" data-ed="del" data-id="${esc(n.id)}" aria-label="Delete ${lbl}">Delete</button>` : ''}`;
}
const insBtn = (key, pos) => `<div class="conn d-conn"><button class="d-ins" data-ins="${esc(key)}" data-pos="${pos}" aria-label="Insert a step or decision here" title="Insert a step or decision here">+</button></div>`;
function canInsert(nodes, k) { if (k === 0 && nodes[0] && nodes[0].type === 'trigger') return false; if (k === nodes.length && nodes.length && nodes[nodes.length - 1].type === 'end') return false; return true; }

function flowHTML(nodes, ctx, key, counter) {
  counter = counter || { n: 0 };
  const parts = [];
  if (ctx.edit && canInsert(nodes, 0)) parts.push(insBtn(key, 0));
  nodes.forEach((n, i) => {
    if (i > 0) parts.push(ctx.edit && canInsert(nodes, i) ? insBtn(key, i) : '<div class="conn"></div>');
    if (n.type === 'decision') {
      const bs = n.branches || [];
      parts.push(`<div class="decision" data-node="${esc(n.id)}"><div class="diamond">◆ ${esc(n.title)}${ctx.edit ? `<span class="d-tools d-inline">${toolbar(n, ctx)}</span>` : ''}</div><div class="conn"></div>
        <div class="branches" style="--bl:${100 / (Math.max(bs.length, 1) * 2)}%;--br:${100 / (Math.max(bs.length, 1) * 2)}%">${bs.map((b, bi) => `<div class="branch"><span class="blabel">${esc(b.label)}</span>
          ${(b.nodes || []).length ? `<div class="flow">${flowHTML(b.nodes, ctx, n.id + '#' + bi, counter)}</div>`
            : (ctx.edit ? `<div class="flow">${insBtn(n.id + '#' + bi, 0)}<div class="passthru">Continue → next step</div></div>` : '<div class="passthru">Continue → next step</div>')}</div>`).join('')}</div></div>`);
    } else {
      const idx = isStep(n) ? ++counter.n : '';
      parts.push(nodeHTML(n, ctx, idx));
    }
  });
  if (ctx.edit && nodes.length && canInsert(nodes, nodes.length)) parts.push(insBtn(key, nodes.length));
  return parts.join('');
}
function removedHTML(diff) {
  const gone = ((diff && diff.removed) || []).filter(isStep);
  return gone.length ? `<div class="conn"></div><div class="hint d-removed-h">Removed from as-is <span class="n">${gone.length}</span></div>${gone.map(g => `<div class="ghost" data-ghost="${esc(g.id)}">${esc(g.title)}${g.owner ? ` <span class="d-ghost-own">· ${esc(pname(g.owner))}</span>` : ''}</div>`).join('<div style="height:8px"></div>')}` : '';
}
function lanesHTML(p, ctx) {
  const steps = flat(p.tobe);
  if (!steps.length) return '<div class="empty">No to-be steps yet. Open Edit to design the process.</div>';
  const owners = [...new Set(steps.map(s => s.owner || ''))];
  let h = `<div class="lanes d-lanes" style="grid-template-columns:repeat(${owners.length},250px)">`;
  owners.forEach(o => h += `<div class="lane-h">${o ? av(o) + esc(pname(o)) : 'Unassigned'}</div>`);
  steps.forEach((s, i) => owners.forEach(o => { h += `<div class="lane-c">${(s.owner || '') === o ? nodeHTML(s, ctx, i + 1) : ''}</div>`; }));
  return h + '</div>';
}

/* ---------- module state ---------- */
let hl = null;            /* highlighted data element on the map */
let newOpen = false;      /* /new modal guard (the router re-renders on every store change) */

/* ---------- render ---------- */
export function render(params) {
  if (params.create) return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › New process</div><h1>New process</h1><p>Name it, then design the as-is and to-be maps.</p></div><div class="hdr-side"><button class="btn primary" data-new-open>Start</button></div></section>`;
  const pid = params.pid;
  const p = store.get('process', pid);
  if (!p) return notFound('Process “' + pid + '”');
  const q = params.q || {};
  const mode = ['asis', 'tobe', 'diff', 'lanes', 'edit'].includes(q.mode) ? q.mode : 'tobe';
  const ver = q.v === 'asis' ? 'asis' : 'tobe';
  const tobe = p.tobe || [], asis = p.asis || [];
  const steps = flat(tobe);
  const diff = eng('diffProcess', [p], { nodes: {}, removed: [], changes: {} });
  const dn = diff.nodes || {};
  const nw = steps.filter(s => dn[s.id] === 'new').length, chg = steps.filter(s => dn[s.id] === 'changed').length;
  const dl = [...new Set(steps.flatMap(s => s.data || []))];
  const live = dl.filter(d => availOf(d) === 'live').length;
  const asisById = {}; flat(asis).forEach(a => asisById[a.id] = a);
  const ctx = { pid, mode, diff, asisById, edit: mode === 'edit' ? { ver } : null };

  const modes = [['asis', 'As-is'], ['tobe', 'To-be'], ['diff', 'Diff'], ['lanes', 'Swimlanes'], ['edit', 'Edit']];
  const side = `<div class="seg d-modes" role="tablist" aria-label="View mode">${modes.map(([k, l]) => `<button role="tab" aria-selected="${mode === k}" data-mode="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="kpis"><div class="kpi"><b>${steps.length}</b><span>To-be steps</span></div><div class="kpi"><b>${nw}+${chg}</b><span>New + changed</span></div><div class="kpi"><b>${live}/${dl.length}</b><span>Data live</span></div></div>`;

  const res = p.resources || [];
  const people = store.state.people;
  const headLeft = mode === 'edit'
    ? `<div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › Process › Editing</div>
       <input class="title" data-meta="name" value="${esc(p.name)}" aria-label="Process name" />
       <textarea data-meta="desc" rows="2" aria-label="Process description" placeholder="What this process does and where it ends">${esc(p.desc || '')}</textarea>
       <div class="res"><span class="lbl">Owner</span><select class="d-sel" data-meta="owner" aria-label="Process owner">${people.map(x => `<option value="${esc(x.id)}" ${x.id === p.owner ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
       <div class="res"><span class="lbl">Resources</span>${res.map(r => `<span class="person">${av(r)}${esc(pname(r))}<button class="d-x" data-res-del="${esc(r)}" aria-label="Remove ${esc(pname(r))}">×</button></span>`).join('')}
         <select class="d-sel" data-res-add aria-label="Add resource"><option value="">+ Assign</option>${people.filter(x => !res.includes(x.id)).map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>`
    : `<div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › Process${p.version ? ` · v${esc(p.version)}` : ''}</div><h1>${esc(p.name)}</h1>${p.desc ? `<p>${esc(p.desc)}</p>` : ''}
       <div class="res"><span class="lbl">Resources</span>${res.map(personChip).join('') || '<span class="hint">None assigned</span>'}</div>`;

  /* canvas */
  let canvas;
  const modeNote = { asis: 'How the process runs today. Tap a step to drill in.', tobe: 'The designed process. Tap a step to drill in.', diff: 'To-be compared with as-is: what is new, what changed, and what was removed.', lanes: 'The to-be process grouped by owner.' }[mode];
  if (mode === 'lanes') canvas = lanesHTML(p, ctx);
  else if (mode === 'asis') canvas = asis.length ? `<div class="flow">${flowHTML(asis, ctx, 'root')}</div>` : '<div class="empty">No as-is map yet.</div>';
  else if (mode === 'edit') {
    const nodes = ver === 'asis' ? asis : tobe;
    canvas = `<div class="d-editbar" role="group" aria-label="Editor">
        <span class="lbl">Editing</span><div class="seg">${['asis', 'tobe'].map(v => `<button data-ver="${v}" class="${ver === v ? 'on' : ''}" aria-pressed="${ver === v}">${v === 'asis' ? 'As-is' : 'To-be'}</button>`).join('')}</div>
        <button class="btn sm" data-fork>Fork to-be from as-is</button>
        <span class="hint">Press + to insert a step or decision. Every change is saved and logged.</span></div>
      <div class="flow">${flowHTML(nodes, ctx, 'root')}</div>`;
  } else canvas = `<div class="flow">${flowHTML(tobe, ctx, 'root')}${mode === 'diff' ? removedHTML(diff) : ''}</div>`;

  /* side panel */
  const missingSteps = steps.filter(s => (s.data || []).some(d => availOf(d) === 'missing'));
  const ord = ['missing', 'example', 'live'];
  const dataRows = dl.slice().sort((a, b) => ord.indexOf(availOf(a)) - ord.indexOf(availOf(b))).map(d => {
    const x = dataEl(d) || {}; const used = steps.filter(s => (s.data || []).includes(d)).length;
    return `<div class="row click d-hlrow ${hl === d ? 'hl-on' : ''}" data-hl="${esc(d)}" tabindex="0" role="button" aria-pressed="${hl === d}" aria-label="Highlight steps using ${esc(x.name || d)}"><span style="margin-top:3px">${dataDot(d)}</span>
      <div><div class="t">${esc(x.name || d)}</div><div class="s">${esc(x.source || 'Source not set')} · ${esc(pname(x.owner))}</div></div>
      <div class="r"><a href="${link('/data/' + d)}" data-link style="color:var(--accent)">${esc((AVAIL[x.avail] || AVAIL.missing).short)} ›</a><div class="s">${used} step${used === 1 ? '' : 's'}</div></div></div>`;
  }).join('');
  const touches = {}; steps.forEach(s => (s.touches || []).forEach(t => touches[t] = (touches[t] || 0) + 1));
  const linked = projectsFor(pid);
  const sideHTML = `
    <div class="card"><h3>${LOCK} Steps needing missing data <span class="n">${missingSteps.length}</span></h3>${missingSteps.length ? missingSteps.map(s => `<div class="row click" data-go="/process/${esc(pid)}/step/${esc(s.id)}"><div><div class="t">${esc(s.title)}</div><div class="s">Needs ${s.data.filter(d => availOf(d) === 'missing').map(d => esc(dataName(d))).join(', ')}</div></div><div class="r">${av(s.owner)}</div></div>`).join('') : '<div class="s">Every data element has a source.</div>'}</div>
    <div class="card"><h3>Data requirements <span class="n">${dl.length}</span></h3><div class="hint" style="margin:-4px 0 8px">Tap a row to highlight every step that uses it</div>${dataRows || '<div class="s">Tag data on steps and this list builds itself.</div>'}
      <div style="margin-top:10px"><button class="btn sm" data-newdata>+ New data element</button></div></div>
    <div class="card"><h3>Touches across operations</h3><div class="chips">${Object.entries(touches).sort((a, b) => b[1] - a[1]).map(([t, c]) => `<span class="chip touch"># ${esc(t)} · ${c}</span>`).join('') || '<span class="s">No areas tagged yet.</span>'}</div></div>
    <div class="card"><h3>Used in projects <span class="n">${linked.length}</span></h3>${linked.map(j => `<div class="row click" data-go="/project/${esc(j.id)}"><div><div class="t">${esc(j.name)}</div><div class="s">Target ${esc(fmt(j.target))}${j.status === 'live' ? ' · live' : ''}</div></div><div class="r" style="color:var(--accent)">Open ›</div></div>`).join('') || '<div class="s">Not linked to a project yet.</div>'}</div>
    ${activityCard('process:' + pid)}`;

  return `<section class="hdr d-hdr"><div>${headLeft}</div><div class="hdr-side">${side}</div></section>
    <div class="grid"><section class="canvas ${mode === 'edit' ? 'd-edit' : ''}" id="canvas" aria-label="Process map">${modeNote ? `<div class="hint" style="text-align:center;margin:-8px 0 14px">${modeNote}</div>` : ''}${canvas}</section>
    <aside class="side">${sideHTML}</aside></div>`;
}

/* ---------- persistence ---------- */
async function saveProc(p, summary) {
  try { await store.save('process', p.id, p, summary); toast(summary); }
  catch (e) { toast('Could not save: ' + e.message); }
}

/* ---------- modals ---------- */
const personOpts = sel => store.state.people.map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)} — ${esc(x.role || '')}</option>`).join('');
const availOpts = sel => Object.entries(AVAIL).map(([k, a]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(a.label)}</option>`).join('');
const allData = () => store.list('dataElement').slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
const dataCheck = (name, d, on) => `<label class="d-pick"><input type="checkbox" name="${esc(name)}" value="${esc(d.id)}" ${on ? 'checked' : ''} />${dataDot(d.id)}<span>${esc(d.name)}</span></label>`;
function subRow(s, k) {
  const sel = new Set((s && s.data) || []);
  return `<div class="d-subrow" data-subrow>
    <div class="d-subhead"><input name="sub_title" aria-label="Sub-step ${k + 1} title" placeholder="Sub-step title" value="${esc((s && s.title) || '')}" /><button type="button" class="btn sm danger" data-subdel aria-label="Remove sub-step">Remove</button></div>
    <div class="d-picks d-picks-sm" data-subpicks>${allData().map(d => dataCheck('sub_data', d, sel.has(d.id))).join('')}</div></div>`;
}

export async function newDataModal(defaults) {
  defaults = defaults || {};
  const r = await modal({
    title: 'New data element',
    body: `<div class="field"><label>Name</label><input name="name" value="${esc(defaults.name || '')}" placeholder="e.g. Vendor bank account" /></div>
      <div class="frow"><div class="field"><label>Owner</label><select name="owner">${personOpts(defaults.owner || store.state.me)}</select></div>
      <div class="field"><label>Availability</label><select name="avail">${availOpts(defaults.avail || 'missing')}</select></div></div>
      <div class="field"><label>Source</label><input name="source" placeholder="e.g. ERP vendor API" value="${esc(defaults.source || '')}" /></div>
      <div class="field"><label>Note</label><textarea name="note" placeholder="What exists today, and what is needed"></textarea></div>`,
    actions: [{ id: 'save', label: 'Create', primary: true }],
  });
  if (r.action !== 'save') return null;
  const name = (r.form.name || '').trim(); if (!name) { toast('A data element needs a name'); return null; }
  const id = store.newId('de');
  const data = { id, name, owner: r.form.owner, source: r.form.source.trim(), avail: r.form.avail, note: r.form.note.trim(), fields: [], samples: [], discovered: [] };
  try { await store.save('dataElement', id, data, `Created data element '${name}'`); toast(`Created '${name}'`); return data; }
  catch (e) { toast('Could not save: ' + e.message); return null; }
}

async function stepModal(p, ver, node) {
  const isNew = !node.title;
  const asisSteps = flat(p.asis);
  const sel = new Set(node.data || []);
  const pr = modal({
    title: isNew ? `New step in ${VER[ver]}` : `Edit step in ${VER[ver]}`,
    body: `<div class="field"><label>Title</label><input name="title" value="${esc(node.title || '')}" placeholder="e.g. Verify vendor identity" /></div>
      <div class="frow"><div class="field"><label>Owner</label><select name="owner">${personOpts(node.owner || store.state.me)}</select></div>
      ${ver === 'tobe' ? `<div class="field"><label>Replaces as-is step</label><select name="from"><option value="">None: new in to-be</option>${asisSteps.map(a => `<option value="${esc(a.id)}" ${a.id === node.from ? 'selected' : ''}>${esc(a.title)}</option>`).join('')}</select></div>` : '<div></div>'}</div>
      <div class="field"><label>Data this step needs</label><div class="d-picks" data-picks>${allData().map(d => dataCheck('data', d, sel.has(d.id))).join('') || '<span class="hint">No data elements yet.</span>'}</div>
        <div class="d-inline-new"><input data-nd-name placeholder="New data element name" aria-label="New data element name" /><select data-nd-avail aria-label="Availability">${availOpts('missing')}</select><button type="button" class="btn sm" data-nd-create>Create and tag</button></div></div>
      <div class="field"><label>Touches (comma separated)</label><input name="touches" value="${esc((node.touches || []).join(', '))}" placeholder="e.g. Compliance, ERP" /></div>
      <div class="field"><label>Sub-steps: how this step runs</label><div data-subs>${(node.subs || []).map(subRow).join('')}</div><div><button type="button" class="btn sm" data-subadd>+ Add sub-step</button></div></div>`,
    actions: [{ id: 'save', label: isNew ? 'Add step' : 'Save step', primary: true }],
  });
  const m = [...document.querySelectorAll('.overlay .modal')].pop();
  const subs = m.querySelector('[data-subs]');
  m.querySelector('[data-subadd]').onclick = () => { subs.insertAdjacentHTML('beforeend', subRow(null, subs.children.length)); subs.lastElementChild.querySelector('input').focus(); };
  subs.addEventListener('click', e => { const b = e.target.closest('[data-subdel]'); if (b) b.closest('[data-subrow]').remove(); });
  m.querySelector('[data-nd-create]').onclick = async () => {
    const nameEl = m.querySelector('[data-nd-name]'); const name = nameEl.value.trim(); if (!name) { nameEl.focus(); return; }
    const id = store.newId('de');
    const owner = m.querySelector('[name=owner]').value;
    const d = { id, name, owner, source: '', avail: m.querySelector('[data-nd-avail]').value, note: 'Created from the step editor.', fields: [], samples: [], discovered: [] };
    try { await store.save('dataElement', id, d, `Created data element '${name}'`); } catch (e) { toast('Could not save: ' + e.message); return; }
    m.querySelector('[data-picks]').insertAdjacentHTML('beforeend', dataCheck('data', d, true));
    m.querySelectorAll('[data-subpicks]').forEach(b => b.insertAdjacentHTML('beforeend', dataCheck('sub_data', d, false)));
    nameEl.value = ''; toast(`Created '${name}' and tagged it`);
  };
  const r = await pr;
  if (r.action !== 'save') return null;
  const root = r.root;
  const out = Object.assign({}, node, {
    type: node.type || 'step',
    title: (r.form.title || '').trim() || 'Untitled step',
    owner: r.form.owner,
    data: [...root.querySelectorAll('[data-picks] input:checked')].map(i => i.value),
    touches: (r.form.touches || '').split(',').map(x => x.trim()).filter(Boolean),
    subs: [...root.querySelectorAll('[data-subrow]')].map(row => ({ title: row.querySelector('[name=sub_title]').value.trim(), data: [...row.querySelectorAll('input[name=sub_data]:checked')].map(i => i.value) })).filter(s => s.title),
  });
  if (ver === 'tobe') { if (r.form.from) out.from = r.form.from; else delete out.from; }
  return out;
}

function branchRow(b) { return `<div class="d-brow" data-brow><input name="blabel" value="${esc(b ? b.label : '')}" placeholder="Branch label" aria-label="Branch label" data-keep="${b && b.keep != null ? b.keep : ''}" /><button type="button" class="btn sm danger" data-bdel aria-label="Remove branch">Remove</button></div>`; }
async function decisionModal(node) {
  const isNew = !node.title;
  const bs = (node.branches && node.branches.length) ? node.branches.map((b, i) => ({ label: b.label, keep: i })) : [{ label: 'Yes' }, { label: 'No' }];
  const pr = modal({
    title: isNew ? 'New decision' : 'Edit decision',
    body: `<div class="field"><label>Question</label><input name="title" value="${esc(node.title || '')}" placeholder="e.g. Risk tier?" /></div>
      <div class="field"><label>Branches</label><div data-branches>${bs.map(branchRow).join('')}</div><div><button type="button" class="btn sm" data-badd>+ Add branch</button></div>
      <span class="hint">A decision needs at least 2 branches. Removing a branch removes the steps inside it.</span></div>`,
    actions: [{ id: 'save', label: isNew ? 'Add decision' : 'Save decision', primary: true }],
  });
  const m = [...document.querySelectorAll('.overlay .modal')].pop();
  const box = m.querySelector('[data-branches]');
  m.querySelector('[data-badd]').onclick = () => { box.insertAdjacentHTML('beforeend', branchRow(null)); box.lastElementChild.querySelector('input').focus(); };
  box.addEventListener('click', e => { const b = e.target.closest('[data-bdel]'); if (!b) return; if (box.children.length <= 2) { toast('A decision needs at least 2 branches'); return; } b.closest('[data-brow]').remove(); });
  const r = await pr;
  if (r.action !== 'save') return null;
  const rows = [...r.root.querySelectorAll('[data-brow] input')];
  const old = node.branches || [];
  const branches = rows.map((inp, i) => ({ label: inp.value.trim() || 'Branch ' + (i + 1), nodes: inp.dataset.keep !== '' && old[+inp.dataset.keep] ? old[+inp.dataset.keep].nodes : [] }));
  return Object.assign({}, node, { type: 'decision', title: (r.form.title || '').trim() || 'Decision', branches });
}
async function simpleNodeModal(node) {
  const trig = node.type === 'trigger';
  const r = await modal({
    title: trig ? 'Edit trigger' : 'Edit end point',
    body: `<div class="field"><label>${trig ? 'What starts this process?' : 'Outcome'}</label><input name="title" value="${esc(node.title || '')}" /></div>
      ${trig ? `<div class="field"><label>Owner</label><select name="owner">${personOpts(node.owner || store.state.me)}</select></div><div class="field"><label>Touches (comma separated)</label><input name="touches" value="${esc((node.touches || []).join(', '))}" /></div>` : ''}`,
    actions: [{ id: 'save', label: 'Save', primary: true }],
  });
  if (r.action !== 'save') return null;
  const out = Object.assign({}, node, { title: (r.form.title || '').trim() || node.title });
  if (trig) { out.owner = r.form.owner; out.touches = (r.form.touches || '').split(',').map(x => x.trim()).filter(Boolean); }
  return out;
}
export const confirmBox = async (title, text, label) => (await modal({ title, body: `<p style="margin:0">${esc(text)}</p>`, actions: [{ id: 'yes', label: label || 'Confirm', danger: true }] })).action === 'yes';

/* ---------- /new ---------- */
async function openNew() {
  if (newOpen) return; newOpen = true;
  const r = await modal({
    title: 'New process',
    body: `<div class="field"><label>Name</label><input name="name" placeholder="e.g. Purchase Request Approval" /></div>
      <div class="field"><label>Description</label><textarea name="desc" placeholder="What this process does and where it ends"></textarea></div>
      <div class="field"><label>Owner</label><select name="owner">${personOpts(store.state.me)}</select></div>`,
    actions: [{ id: 'create', label: 'Create process', primary: true }],
  });
  if (r.action !== 'create') { newOpen = false; go('/'); return; }
  const name = (r.form.name || '').trim() || 'Untitled process';
  const id = store.newId('proc');
  const mk = () => { const t = store.newId('n'), e = store.newId('n'); return [{ id: t, type: 'trigger', title: 'What starts this process?', owner: r.form.owner, touches: [], data: [] }, { id: e, type: 'end', title: 'Process complete' }]; };
  const asis = mk(), tobe = mk(); tobe[0].from = asis[0].id;
  const p = { id, name, desc: (r.form.desc || '').trim(), owner: r.form.owner, resources: [r.form.owner], version: 1, asis, tobe, released: [] };
  /* keep the guard up until we have left /new: store.save re-renders this route before go() runs */
  try { await store.save('process', id, p, `Created process '${name}'`); toast(`Created '${name}'`); go(`/process/${id}?mode=edit`); }
  catch (e) { toast('Could not create: ' + e.message); }
  finally { newOpen = false; }
}

/* ---------- bind ---------- */
function applyHl(root) {
  const nodes = root.querySelectorAll('#canvas .node[data-step]');
  nodes.forEach(n => { n.classList.remove('dim', 'hl'); if (hl) n.classList.add((n.dataset.data || '').split(',').includes(hl) ? 'hl' : 'dim'); });
}

export function bind(root, params) {
  if (params.create) { const b = root.querySelector('[data-new-open]'); if (b) b.onclick = openNew; openNew(); return; }
  const pid = params.pid; const cur = () => store.get('process', pid);
  if (!cur()) return;
  bindActivity(root);
  const q = params.q || {};
  const ver = q.v === 'asis' ? 'asis' : 'tobe';
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => go(`/process/${pid}?mode=${b.dataset.mode}${b.dataset.mode === 'edit' && q.v ? '&v=' + q.v : ''}`));
  root.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => go(`/process/${pid}?mode=edit&v=${b.dataset.ver}`));

  /* data highlight */
  if (hl && !root.querySelector(`[data-hl="${CSS.escape(hl)}"]`)) hl = null;
  applyHl(root);
  root.querySelectorAll('[data-hl]').forEach(row => {
    const toggle = () => { hl = hl === row.dataset.hl ? null : row.dataset.hl; root.querySelectorAll('[data-hl]').forEach(r => { r.classList.toggle('hl-on', r.dataset.hl === hl); r.setAttribute('aria-pressed', String(r.dataset.hl === hl)); }); applyHl(root);
      const first = root.querySelector('#canvas .node.hl'); if (first && hl && window.innerWidth < 1060) first.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    row.addEventListener('click', e => { if (e.target.closest('a')) return; toggle(); });
    row.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a')) { e.preventDefault(); toggle(); } });
  });
  /* keyboard open for clickable step cards */
  root.querySelectorAll('#canvas [data-go]').forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) go(el.dataset.go); }));
  const nd = root.querySelector('[data-newdata]'); if (nd) nd.onclick = () => newDataModal();

  if (q.mode !== 'edit') return;
  /* header meta */
  root.querySelectorAll('[data-meta]').forEach(el => el.addEventListener('change', () => {
    const p = clone(cur()); const k = el.dataset.meta; const v = k === 'owner' ? el.value : el.value.trim();
    if (k === 'name' && !v) { el.value = p.name; return; }
    if ((p[k] || '') === v) return; p[k] = v;
    saveProc(p, k === 'name' ? `Renamed process to '${v}'` : k === 'desc' ? 'Updated process description' : `Set process owner to ${pname(v)}`);
  }));
  root.querySelectorAll('[data-res-del]').forEach(b => b.onclick = () => { const p = clone(cur()); const id = b.dataset.resDel; p.resources = (p.resources || []).filter(x => x !== id); saveProc(p, `Removed ${pname(id)} from resources`); });
  const ra = root.querySelector('[data-res-add]'); if (ra) ra.onchange = () => { if (!ra.value) return; const p = clone(cur()); p.resources = [...new Set([...(p.resources || []), ra.value])]; saveProc(p, `Added ${pname(ra.value)} to resources`); };

  const fork = root.querySelector('[data-fork]');
  if (fork) fork.onclick = async () => {
    const p = clone(cur());
    if (!await confirmBox('Fork to-be from as-is?', `This replaces the current to-be map (${flat(p.tobe).length} steps) with a copy of the as-is map. Each copied step links back to the as-is step it came from.`, 'Fork to-be')) return;
    p.tobe = freshIds(p.asis || [], true);
    await saveProc(p, 'Forked to-be from as-is');
    go(`/process/${pid}?mode=edit&v=tobe`);
  };

  root.querySelectorAll('[data-ins]').forEach(b => b.onclick = async () => {
    const key = b.dataset.ins, pos = +b.dataset.pos;
    const pick = await modal({ title: 'Insert here', body: `<p style="margin:0">Add a step, or a decision that splits the flow into labelled branches.</p>`, actions: [{ id: 'decision', label: 'Decision' }, { id: 'step', label: 'Step', primary: true }] });
    if (pick.action !== 'step' && pick.action !== 'decision') return;
    const p0 = cur();
    const node = pick.action === 'step' ? await stepModal(p0, ver, { id: store.newId('n'), type: 'step', data: [], touches: [], subs: [] }) : await decisionModal({ id: store.newId('d'), type: 'decision' });
    if (!node) return;
    const p = clone(cur()); const list = getList(p[ver] || (p[ver] = []), key);
    if (!list) { toast('That spot no longer exists'); return; }
    list.splice(Math.min(pos, list.length), 0, node);
    const where = key === 'root' ? '' : (() => { const [did, bi] = key.split('#'); const d = findLoc(p[ver], did); return d ? ` (branch '${d.node.branches[+bi].label}' of '${d.node.title}')` : ''; })();
    await saveProc(p, `Added ${node.type === 'decision' ? 'decision' : 'step'} '${node.title}' to ${VER[ver]}${where}`);
  });

  root.querySelectorAll('[data-ed]').forEach(b => b.onclick = async () => {
    const act = b.dataset.ed, id = b.dataset.id;
    const p = clone(cur()); const loc = findLoc(p[ver] || [], id); if (!loc) return;
    const n = loc.node; const kind = n.type === 'decision' ? 'decision' : n.type === 'trigger' ? 'trigger' : n.type === 'end' ? 'end point' : 'step';
    if (act === 'edit') {
      const out = n.type === 'decision' ? await decisionModal(n) : (n.type === 'trigger' || n.type === 'end') ? await simpleNodeModal(n) : await stepModal(p, ver, n);
      if (!out) return;
      const p2 = clone(cur()); const l2 = findLoc(p2[ver] || [], id); if (!l2) return;
      l2.list[l2.index] = out;
      await saveProc(p2, `Edited ${kind} '${out.title}' in ${VER[ver]}`);
    } else if (act === 'up' || act === 'down') {
      const j = loc.index + (act === 'up' ? -1 : 1);
      const blocked = j < 0 || j >= loc.list.length || ['trigger', 'end'].includes(loc.list[j].type);
      if (blocked) { toast(`'${n.title}' is already at the ${act === 'up' ? 'top' : 'bottom'} of its list`); return; }
      [loc.list[loc.index], loc.list[j]] = [loc.list[j], loc.list[loc.index]];
      await saveProc(p, `Moved ${kind} '${n.title}' ${act} in ${VER[ver]}`);
      const again = document.querySelector(`[data-ed="${act}"][data-id="${CSS.escape(id)}"]`); if (again) again.focus();
    } else if (act === 'del') {
      const inner = n.type === 'decision' ? flat([n]).length : 0;
      if (!await confirmBox(`Delete ${kind}?`, `Delete '${n.title}' from the ${VER[ver]} map${inner ? ` and the ${inner} step${inner === 1 ? '' : 's'} inside its branches` : ''}?`, 'Delete')) return;
      const p2 = clone(cur()); const l2 = findLoc(p2[ver] || [], id); if (!l2) return;
      l2.list.splice(l2.index, 1);
      await saveProc(p2, `Deleted ${kind} '${n.title}' from ${VER[ver]}`);
    }
  });
}
