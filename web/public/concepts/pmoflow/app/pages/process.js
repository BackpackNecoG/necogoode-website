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
export const isGw = n => !!n && (n.type === 'decision' || n.type === 'parallel');
export const isStep = n => !!n && n.type !== 'trigger' && n.type !== 'end' && !isGw(n);
export function flat(nodes) {
  const out = [];
  (nodes || []).forEach(n => { if (!n) return; if (isGw(n)) (n.branches || []).forEach(b => out.push(...flat(b.nodes))); else if (isStep(n)) out.push(n); });
  return out;
}
/* every node (steps, gateways, trigger, end) in document order */
export function allNodes(nodes) { const out = []; (nodes || []).forEach(n => { if (!n) return; out.push(n); if (isGw(n)) (n.branches || []).forEach(b => out.push(...allNodes(b.nodes))); }); return out; }
/* compact SLA / system / duration line, e.g. "⏱ 2 business days · ERP · 4h" */
export function opsLine(n) {
  const parts = [n.sla ? '⏱ ' + n.sla : '', n.system || '', n.durationHrs ? n.durationHrs + 'h' : ''].filter(Boolean);
  return parts.length ? `<div class="d-ops">${esc(parts.join(' · '))}</div>` : '';
}
/* case-insensitive duplicate check for data element names; returns the clashing element or null */
export function dupDataName(name, exceptId, extra) {
  const k = String(name || '').trim().toLowerCase(); if (!k) return null;
  return [...store.list('dataElement'), ...(extra || [])].find(d => d.id !== exceptId && String(d.name || '').trim().toLowerCase() === k) || null;
}
export const dataEl = id => store.get('dataElement', id);
export const dataName = id => (dataEl(id) || {}).name || id;
/* Effective availability (R3): the data element is the single source of truth.
   'live' if avail is live or its resolver work item is done; otherwise 'example' or 'missing'. */
export function effAvail(id) {
  const r = eng('effectiveAvail', [docs(), id], null);
  if (r === 'live' || r === 'example' || r === 'missing') return r;
  const d = dataEl(id); if (!d) return 'missing';
  if (d.avail === 'live' || store.list('workItem', w => w.resolves === id && w.status === 'done').length) return 'live';
  return d.avail === 'example' ? 'example' : 'missing';
}
export const availOf = effAvail;
/* dot coloured by effective availability */
export function effDot(id) { const a = AVAIL[effAvail(id)]; return `<span class="dot" style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${a.color}" title="${esc(a.label)}" aria-hidden="true"></span>`; }
export const NEEDS_LIVE = 'Needs a live source before go-live';
export function readyCounts(ids) { ids = ids || []; const st = ids.map(effAvail); return { live: st.filter(a => a === 'live').length, total: ids.length, missing: st.filter(a => a === 'missing').length, example: st.filter(a => a === 'example').length }; }
/* new/changed/removed counts (R3): every count shown comes from the engine's diffSummary */
export function diffCounts(p) {
  const r = eng('diffSummary', [p], null);
  if (r && typeof r.new === 'number') return r;
  const d = eng('diffProcess', [p], { nodes: {}, removed: [] }); const v = Object.values(d.nodes || {});
  return { new: v.filter(x => x === 'new').length, changed: v.filter(x => x === 'changed').length, same: v.filter(x => x === 'same').length, removed: (d.removed || []).length };
}
/* plain-language profile pattern (R3): '9{8}' -> '8 digits' */
export function humanPat(pt) { const r = eng('humanPattern', [pt], null); return typeof r === 'string' && r ? r : String(pt || ''); }
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
    if (isGw(n)) for (const b of n.branches || []) { const r = findLoc(b.nodes, id); if (r) return r; }
  }
  return null;
}
function getList(nodes, key) {
  if (key === 'root') return nodes;
  const [did, bi] = key.split('#'); const loc = findLoc(nodes, did);
  return loc && loc.node.branches && loc.node.branches[+bi] ? loc.node.branches[+bi].nodes : null;
}
function freshIds(nodes, keepFrom, map) {
  map = map || {};
  return (nodes || []).map(n => {
    const c = clone(n); c.id = store.newId(isGw(n) ? 'd' : 'n'); map[n.id] = c.id;
    if (keepFrom) c.from = n.id; else delete c.from;
    if (isGw(c)) c.branches = (n.branches || []).map(b => Object.assign({ label: b.label, nodes: freshIds(b.nodes, keepFrom, map) }, b.goto ? { goto: b.goto } : {}));
    return c;
  });
}
/* fork: copy with fresh ids, then re-point loop-back targets at the copies */
function forkNodes(nodes) {
  const map = {}; const out = freshIds(nodes, true, map);
  allNodes(out).forEach(n => isGw(n) && (n.branches || []).forEach(b => { if (b.goto) { if (map[b.goto]) b.goto = map[b.goto]; else delete b.goto; } }));
  return out;
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
    body = `<div class="stats"><span>Data <b>${rd.live}/${rd.total}</b> live</span>${rd.missing ? `<span class="d-miss" title="Data with no source yet">${LOCK} ${rd.missing} missing</span>` : ''}${rd.example ? `<span class="d-needlive" title="${NEEDS_LIVE}: examples only">${rd.example} need${rd.example === 1 ? 's' : ''} live source</span>` : ''}<span>${(n.touches || []).length} area${(n.touches || []).length === 1 ? '' : 's'}</span>${(n.subs || []).length ? `<span>${n.subs.length} sub-steps</span>` : ''}</div>${opsLine(n)}`;
    if (showDiff && status === 'changed') body += changeNote(n, ctx);
  }
  const goAttr = !ctx.edit && !trig && ctx.pid && !ctx.readonly ? `data-go="/process/${esc(ctx.pid)}/step/${esc(n.id)}" tabindex="0" role="link" aria-label="Open step ${esc(n.title)}"` : '';
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
    if ((a.sla || '') !== (n.sla || '')) lines.push('SLA: ' + (a.sla || 'none') + ' → ' + (n.sla || 'none'));
    if ((a.system || '') !== (n.system || '')) lines.push('system: ' + (a.system || 'none') + ' → ' + (n.system || 'none'));
    const st = x => (x.subs || []).map(y => y.title).join('|');
    if (st(a) !== st(n)) lines.push('sub-steps: ' + (a.subs || []).length + ' → ' + (n.subs || []).length + ((a.subs || []).length === (n.subs || []).length ? ' (reworded)' : ''));
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
const insBtn = (key, pos) => `<div class="conn d-conn"><button class="d-ins" data-ins="${esc(key)}" data-pos="${pos}" aria-label="Insert a step, decision or parallel gateway here" title="Insert a step, decision or parallel gateway here">+</button></div>`;
function canInsert(nodes, k) { if (k === 0 && nodes[0] && nodes[0].type === 'trigger') return false; if (k === nodes.length && nodes.length && nodes[nodes.length - 1].type === 'end') return false; return true; }

function flowHTML(nodes, ctx, key, counter) {
  counter = counter || { n: 0 };
  const parts = [];
  if (ctx.edit && canInsert(nodes, 0)) parts.push(insBtn(key, 0));
  nodes.forEach((n, i) => {
    if (i > 0) parts.push(ctx.edit && canInsert(nodes, i) ? insBtn(key, i) : '<div class="conn"></div>');
    if (isGw(n)) {
      const bs = n.branches || [], par = n.type === 'parallel';
      const st = ctx.mode === 'diff' && ctx.diff ? (ctx.diff.nodes || {})[n.id] : null;
      const dchip = st === 'new' || st === 'changed' ? ` <span class="chip diff-${st}">${st === 'new' ? 'NEW' : 'CHANGED'}</span>` : '';
      const gotoLbl = b => { if (!b.goto) return ''; const t = ctx.byId[b.goto]; return `<div class="d-goto" data-goto="${esc(b.goto)}">↩ Loop back to ${t ? '“' + esc(t.title || 'start') + '”' : '<i>missing step</i>'}</div>`; };
      parts.push(`<div class="decision ${par ? 'd-parallel' : ''}" data-node="${esc(n.id)}" data-gw="${esc(n.type)}"><div class="diamond ${par ? 'd-par' : ''}"><span aria-hidden="true">${par ? '⊕' : '◆'}</span> <span class="d-gwt">${esc(n.title)}${par ? '<small class="d-parlbl">Runs in parallel</small>' : ''}</span>${dchip}${ctx.edit ? `<span class="d-tools d-inline">${toolbar(n, ctx)}</span>` : ''}</div><div class="conn"></div>
        <div class="branches" style="--bl:${100 / (Math.max(bs.length, 1) * 2)}%;--br:${100 / (Math.max(bs.length, 1) * 2)}%">${bs.map((b, bi) => `<div class="branch"><span class="blabel">${esc(b.label)}</span>
          ${(b.nodes || []).length ? `<div class="flow">${flowHTML(b.nodes, ctx, n.id + '#' + bi, counter)}${gotoLbl(b)}</div>`
            : `<div class="flow">${ctx.edit ? insBtn(n.id + '#' + bi, 0) : ''}${b.goto ? gotoLbl(b) : `<div class="passthru">${par ? 'Nothing extra in this branch' : 'Continue → next step'}</div>`}</div>`}</div>`).join('')}</div></div>`);
    } else {
      const idx = isStep(n) ? ++counter.n : '';
      parts.push(nodeHTML(n, ctx, idx));
    }
  });
  if (ctx.edit && nodes.length && canInsert(nodes, nodes.length)) parts.push(insBtn(key, nodes.length));
  return parts.join('');
}
function removedHTML(diff, n) {
  const gone = ((diff && diff.removed) || []).filter(g => g && g.type !== 'trigger' && g.type !== 'end');
  const count = n != null ? n : gone.length;
  return gone.length || count ? `<div class="conn"></div><div class="hint d-removed-h">Removed from as-is <span class="n" data-removed-n>${count}</span></div>${gone.map(g => `<div class="ghost" data-ghost="${esc(g.id)}">${isGw(g) ? `<span aria-hidden="true">${g.type === 'parallel' ? '⊕' : '◆'}</span> ` : ''}${esc(g.title)}${g.owner ? ` <span class="d-ghost-own">· ${esc(pname(g.owner))}</span>` : ''}</div>`).join('<div style="height:8px"></div>')}` : '';
}
function lanesHTML(nodes, ctx) {
  /* rows in document order: each step sits in its owner's lane; each gateway gets its own full-width row */
  const rows = [];
  const walk = list => (list || []).forEach(n => { if (isGw(n)) { rows.push({ gw: n }); (n.branches || []).forEach(b => walk(b.nodes)); } else if (isStep(n)) rows.push({ s: n }); });
  walk(nodes);
  const steps = rows.filter(r => r.s).map(r => r.s);
  if (!steps.length) return '<div class="empty">No steps yet. Open Edit to design the process.</div>';
  const owners = [...new Set(steps.map(s => s.owner || ''))];
  let h = `<div class="d-lanewrap" tabindex="0" aria-label="Swimlanes, scroll sideways for more lanes"><div class="lanes d-lanes" style="grid-template-columns:repeat(${owners.length},minmax(190px,1fr))">`;
  owners.forEach(o => h += `<div class="lane-h">${o ? av(o) + esc(pname(o)) : 'Unassigned'}</div>`);
  let i = 0;
  rows.forEach(r => {
    if (r.gw) {
      const par = r.gw.type === 'parallel';
      const where = (r.gw.branches || []).map(b => { const first = (b.nodes || [])[0]; const tgt = b.goto && ctx.byId[b.goto]; return `<span class="blabel">${esc(b.label)}</span> ${first ? esc(first.title) : tgt ? '↩ ' + esc(tgt.title) : (par ? 'nothing extra' : 'continue')}`; }).join('<span class="d-sep">·</span>');
      h += `<div class="d-lane-gw" style="grid-column:1/-1" data-node="${esc(r.gw.id)}" data-gw="${esc(r.gw.type)}"><div class="diamond ${par ? 'd-par' : ''}"><span aria-hidden="true">${par ? '⊕' : '◆'}</span> <span class="d-gwt">${esc(r.gw.title)}${par ? '<small class="d-parlbl">Runs in parallel</small>' : ''}</span></div><div class="d-lane-br">${where}</div></div>`;
    } else { i++; owners.forEach(o => { h += `<div class="lane-c">${(r.s.owner || '') === o ? nodeHTML(r.s, ctx, i) : ''}</div>`; }); }
  });
  return h + '</div></div>';
}

/* ---------- BPMN 2.0 export ---------- */
/* Layout: one vertical lane (column) per step owner; every flow node sits on its own row, in its lane.
   Events and gateways sit in the lane of the node before them, so every node belongs to exactly one lane. */
const xid = id => 'N_' + String(id).replace(/[^\w.-]/g, '_');
const xe = s => esc(s);
const LANE_W = 260, LANE_X0 = 40, ROW_GAP = 46, TOP = 60;
export function bpmnXml(p, nodes, label) {
  const els = [], flows = [], pos = {}; let y = TOP, fi = 0;
  const SZ = { startEvent: [36, 36], endEvent: [36, 36], userTask: [170, 70], exclusiveGateway: [50, 50], parallelGateway: [50, 50] };
  /* lanes: one per step owner, in order of first appearance */
  const laneKeys = []; flat(nodes).forEach(n => { const k = n.owner || ''; if (!laneKeys.includes(k)) laneKeys.push(k); });
  if (!laneKeys.length) laneKeys.push((nodes || []).find(n => n.type === 'trigger' && n.owner) ? nodes.find(n => n.type === 'trigger').owner : '');
  const laneOf = k => Math.max(0, laneKeys.indexOf(k));
  const laneRefs = laneKeys.map(() => []);
  const trig = (nodes || []).find(n => n.type === 'trigger');
  let curLane = trig && trig.owner && laneKeys.includes(trig.owner) ? laneOf(trig.owner) : 0;
  const add = (tag, id, inner, name, lane) => {
    if (lane != null) curLane = lane;
    const [w, h] = SZ[tag]; const cx = LANE_X0 + curLane * LANE_W + LANE_W / 2;
    els.push(`    <bpmn:${tag} id="${id}"${name != null ? ` name="${xe(name)}"` : ''}${inner ? `>\n${inner}\n    </bpmn:${tag}>` : ' />'}`);
    pos[id] = { x: Math.round(cx - w / 2), y, w, h, tag }; laneRefs[curLane].push(id); y += h + ROW_GAP;
  };
  const flow = (from, to, name) => flows.push({ id: 'Flow_' + (++fi), from, to, name });
  const connect = (tails, id) => tails.forEach(t => flow(t.id, id, t.name));
  const doc = n => { const bits = [];
    if (n.owner) bits.push('Owner: ' + pname(n.owner));
    if ((n.data || []).length) bits.push('Data: ' + n.data.map(d => dataName(d) + ' (' + AVAIL[availOf(d)].short + ')').join(', '));
    if (n.system) bits.push('System: ' + n.system); if (n.sla) bits.push('SLA: ' + n.sla); if (n.durationHrs) bits.push('Duration: ' + n.durationHrs + 'h');
    if ((n.subs || []).length) bits.push('Sub-steps: ' + n.subs.map(x => x.title).join('; '));
    return bits.length ? `      <bpmn:documentation>${xe(bits.join('. '))}</bpmn:documentation>` : ''; };
  const ids = new Set(allNodes(nodes).map(n => n.id));
  let ended = false;
  function emit(list, tails) {
    for (const n of list || []) {
      const id = xid(n.id);
      if (n.type === 'trigger') { add('startEvent', id, '', n.title); connect(tails, id); tails = [{ id }]; }
      else if (n.type === 'end') { add('endEvent', id, '', n.title); ended = true; connect(tails, id); tails = []; }
      else if (isGw(n)) {
        const tag = n.type === 'parallel' ? 'parallelGateway' : 'exclusiveGateway';
        add(tag, id, '', n.title); connect(tails, id);
        const gwLane = curLane, out = [];
        (n.branches || []).forEach(b => {
          curLane = gwLane;
          const loop = b.goto && ids.has(b.goto) ? xid(b.goto) : null;
          if (!(b.nodes || []).length) { if (loop) flow(id, loop, b.label); else out.push({ id, name: b.label }); }
          else { const t = emit(b.nodes, [{ id, name: b.label }]); if (loop) t.forEach(tt => flow(tt.id, loop, tt.name)); else out.push(...t); }
        });
        if (out.length) { const jid = id + '_join'; add(tag, jid, '', null, gwLane); connect(out, jid); tails = [{ id: jid }]; } else tails = [];
      } else { add('userTask', id, doc(n), n.title, laneOf(n.owner || '')); connect(tails, id); tails = [{ id }]; }
    }
    return tails;
  }
  let tails = [];
  if (!(nodes || []).length || nodes[0].type !== 'trigger') { add('startEvent', 'StartEvent_1', '', 'Start'); tails = [{ id: 'StartEvent_1' }]; }
  tails = emit(nodes, tails);
  if (tails.length || !ended) { add('endEvent', 'EndEvent_1', '', 'End'); connect(tails, 'EndEvent_1'); }
  const pidX = 'Process_' + String(p.id).replace(/[^\w.-]/g, '_');
  const height = y - ROW_GAP + 40;
  const lanes = laneKeys.map((k, i) => ({ id: 'Lane_' + (i + 1), name: k ? pname(k) : 'Unassigned', refs: laneRefs[i] }));
  const c = b => ({ x: b.x + b.w / 2, top: b.y, bot: b.y + b.h, mid: b.y + b.h / 2, right: b.x + b.w });
  const edges = flows.map(f => { const s = c(pos[f.from]), t = c(pos[f.to]); let pts;
    if (t.top > s.bot) pts = s.x === t.x ? [[s.x, s.bot], [t.x, t.top]] : [[s.x, s.bot], [s.x, (s.bot + t.top) / 2], [t.x, (s.bot + t.top) / 2], [t.x, t.top]];
    else { const rx = Math.max(s.right, t.right) + 30; pts = [[s.right, s.mid], [rx, s.mid], [rx, t.mid], [t.right, t.mid]]; } /* loop back */
    return `      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">\n${pts.map(([px, py]) => `        <di:waypoint x="${Math.round(px)}" y="${Math.round(py)}" />`).join('\n')}\n      </bpmndi:BPMNEdge>`; });
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="https://www.necogoode.com/concepts/pmoflow" exporter="PMOFlow" exporterVersion="3">
  <bpmn:process id="${pidX}" name="${xe(p.name + ' (' + label + ')')}" isExecutable="false">
    <bpmn:documentation>${xe((p.desc || '') + ' Exported from PMOFlow, ' + label + '.')}</bpmn:documentation>
    <bpmn:laneSet id="LaneSet_1">
${lanes.map(l => `      <bpmn:lane id="${l.id}" name="${xe(l.name)}">\n${l.refs.map(r => `        <bpmn:flowNodeRef>${r}</bpmn:flowNodeRef>`).join('\n')}\n      </bpmn:lane>`).join('\n')}
    </bpmn:laneSet>
${els.join('\n')}
${flows.map(f => `    <bpmn:sequenceFlow id="${f.id}" sourceRef="${f.from}" targetRef="${f.to}"${f.name ? ` name="${xe(f.name)}"` : ''} />`).join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="${pidX}">
${lanes.map((l, i) => `      <bpmndi:BPMNShape id="${l.id}_di" bpmnElement="${l.id}" isHorizontal="false">\n        <dc:Bounds x="${LANE_X0 + i * LANE_W}" y="20" width="${LANE_W}" height="${height}" />\n      </bpmndi:BPMNShape>`).join('\n')}
${Object.entries(pos).map(([id, b]) => `      <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${b.tag === 'exclusiveGateway' ? ' isMarkerVisible="true"' : ''}>\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />\n      </bpmndi:BPMNShape>`).join('\n')}
${edges.join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

/* ---------- BPMN 2.0 import (parsed in the browser with DOMParser) ----------
   startEvent -> trigger, tasks -> steps, exclusive/inclusive/event-based gateway -> decision, parallelGateway -> parallel,
   branches from outgoing sequence flows (a flow back to an earlier node becomes a loop-back), endEvent -> end,
   lanes -> owners by name (unknown names -> the current persona). Pass-through merge gateways and intermediate events are skipped. */
const TASKS = new Set(['task', 'userTask', 'manualTask', 'serviceTask', 'scriptTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'callActivity', 'subProcess']);
const GWS = { exclusiveGateway: 'decision', inclusiveGateway: 'decision', eventBasedGateway: 'decision', complexGateway: 'decision', parallelGateway: 'parallel' };
export function parseBpmn(text, people, me) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This file is not well-formed XML.');
  const proc = doc.getElementsByTagNameNS('*', 'process')[0];
  if (!proc) throw new Error('No BPMN process was found in this file.');
  const kids = [...proc.children];
  const nodes = {}, outs = {}, ins = {};
  kids.forEach(el => { const t = el.localName; if (TASKS.has(t) || GWS[t] || /Event$/.test(t)) nodes[el.getAttribute('id')] = { el, tag: t, name: (el.getAttribute('name') || '').trim() }; });
  kids.filter(el => el.localName === 'sequenceFlow').forEach(el => {
    const f = { from: el.getAttribute('sourceRef'), to: el.getAttribute('targetRef'), name: (el.getAttribute('name') || '').trim() };
    if (!nodes[f.from] || !nodes[f.to]) return;
    (outs[f.from] = outs[f.from] || []).push(f); (ins[f.to] = ins[f.to] || []).push(f);
  });
  /* lanes -> owner ids by person name (exact, then first name), else the current persona */
  const laneOwner = {}; const unknownLanes = new Set();
  const byName = nm => { const k = nm.toLowerCase(); return people.find(x => x.name.toLowerCase() === k) || people.find(x => x.name.split(' ')[0].toLowerCase() === k) || null; };
  [...proc.getElementsByTagNameNS('*', 'lane')].forEach(l => {
    const nm = (l.getAttribute('name') || '').trim(); const person = nm ? byName(nm) : null;
    if (!person && nm && nm !== 'Unassigned') unknownLanes.add(nm);
    [...l.getElementsByTagNameNS('*', 'flowNodeRef')].forEach(r => { laneOwner[r.textContent.trim()] = person ? person.id : me; });
  });
  const ownerOf = id => laneOwner[id] || me;
  const docText = el => { const d = [...el.children].find(c => c.localName === 'documentation'); return d ? d.textContent : ''; };
  const emitted = {}; let pendingAlias = [];
  const mark = (bid, nid) => { emitted[bid] = nid; pendingAlias.forEach(a => emitted[a] = nid); pendingAlias = []; };
  const passThrough = id => { const n = nodes[id]; return n && ((GWS[n.tag] && (outs[id] || []).length <= 1) || (/Event$/.test(n.tag) && n.tag !== 'startEvent' && n.tag !== 'endEvent')); };
  let stepN = 0, gwN = 0, trigger = null, hasEnd = false;
  const mkStep = (id) => { const n = nodes[id]; const d = docText(n.el); const out = { id: store.newId('n'), type: 'step', title: n.name || 'Untitled step', owner: ownerOf(id), data: [], touches: [], subs: [] };
    const sys = d.match(/System: ([^.]+)/), sla = d.match(/SLA: ([^.]+)/); if (sys) out.system = sys[1].trim(); if (sla) out.sla = sla[1].trim(); stepN++; return out; };
  /* nodes reachable from start without passing through already-emitted nodes, with BFS distance */
  function reach(start) {
    const dist = new Map(); if (emitted[start] !== undefined) return dist;
    const q = [[start, 0]]; dist.set(start, 0);
    while (q.length) { const [c, d] = q.shift(); (outs[c] || []).forEach(f => { if (emitted[f.to] === undefined && !dist.has(f.to)) { dist.set(f.to, d + 1); q.push([f.to, d + 1]); } }); }
    return dist;
  }
  function findJoin(flowsOut) {
    const sets = flowsOut.map(f => reach(f.to));
    const score = new Map();
    sets.forEach(s => s.forEach((d, id) => { const v = score.get(id) || { n: 0, d: 0 }; v.n++; v.d += d; score.set(id, v); }));
    let best = null;
    score.forEach((v, id) => { if (v.n >= 2 && (!best || v.n > best.v.n || (v.n === best.v.n && v.d < best.v.d))) best = { id, v }; });
    if (best) return best.id;
    /* only one branch continues (the others loop back or end): its nearest pass-through merge gateway closes the split */
    let mg = null; sets.forEach(s => s.forEach((d, id) => { if (nodes[id] && GWS[nodes[id].tag] && (ins[id] || []).length >= 1 && (outs[id] || []).length === 1 && (!mg || d < mg.d)) mg = { id, d }; }));
    return mg ? mg.id : null;
  }
  function seq(start, stop) {
    const list = []; let cur = start, guard = 0;
    while (cur && cur !== stop && guard++ < 5000) {
      if (emitted[cur] !== undefined) return { list, goto: emitted[cur] };
      const n = nodes[cur]; const o = outs[cur] || [];
      if (n.tag === 'startEvent') { const t = { id: store.newId('n'), type: 'trigger', title: n.name || 'Process starts', owner: ownerOf(cur), touches: [], data: [] }; mark(cur, t.id); list.push(t); trigger = t; cur = o[0] && o[0].to; continue; }
      if (n.tag === 'endEvent') { const e = { id: store.newId('n'), type: 'end', title: n.name || 'Process complete' }; mark(cur, e.id); list.push(e); hasEnd = true; return { list }; }
      if (passThrough(cur)) { pendingAlias.push(cur); emitted[cur] = null; cur = o[0] && o[0].to; continue; }
      let kind = GWS[n.tag];
      if (TASKS.has(n.tag)) { const st = mkStep(cur); mark(cur, st.id); list.push(st); if (o.length <= 1) { cur = o[0] && o[0].to; continue; } kind = o.every(f => f.name) ? 'decision' : 'parallel'; }
      /* split: a gateway (or a task with several outgoing flows) */
      const gw = { id: store.newId('d'), type: kind, title: TASKS.has(n.tag) ? (kind === 'parallel' ? 'In parallel' : 'Decision') : (n.name || (kind === 'parallel' ? 'In parallel' : 'Decision')), branches: [] };
      if (!TASKS.has(n.tag)) mark(cur, gw.id);
      gwN++;
      const join = findJoin(o);
      o.forEach((f, i) => {
        const b = { label: f.name || (kind === 'parallel' ? 'Track ' + String.fromCharCode(65 + i) : 'Option ' + (i + 1)), nodes: [] };
        if (f.to !== join) { const r = seq(f.to, join); b.nodes = r.list; if (r.goto) b.goto = r.goto; }
        gw.branches.push(b);
      });
      list.push(gw);
      if (!join) return { list };
      cur = join;
    }
    return { list };
  }
  const starts = Object.keys(nodes).filter(id => nodes[id].tag === 'startEvent');
  const first = starts[0] || Object.keys(nodes).find(id => !(ins[id] || []).length);
  if (!first) throw new Error('The process has no start event.');
  let list = seq(first, null).list;
  /* loop-back targets that resolved to null (a skipped merge gateway with nothing after it) are dropped */
  allNodes(list).forEach(n => isGw(n) && n.branches.forEach(b => { if (b.goto == null) delete b.goto; }));
  if (!trigger) list.unshift({ id: store.newId('n'), type: 'trigger', title: 'Process starts', owner: me, touches: [], data: [] });
  if (!list.length || list[list.length - 1].type !== 'end') list.push({ id: store.newId('n'), type: 'end', title: 'Process complete' });
  const rawName = (proc.getAttribute('name') || doc.documentElement.getAttribute('name') || '').trim();
  return { name: rawName.replace(/\s*\((to-be|as-is[^)]*|released[^)]*)\)\s*$/i, ''), desc: (docText(proc) || '').replace(/\s*Exported from PMOFlow,[^.]*\.\s*$/, '').trim(), nodes: list, steps: stepN, gateways: gwN, unknownLanes: [...unknownLanes] };
}

/* ---------- module state ---------- */
let hl = null;            /* highlighted data element on the map */
let newOpen = false;      /* /new modal guard (the router re-renders on every store change) */
let newImport = false;    /* the visitor chose "Import BPMN" on /new: do not re-open the create modal on re-render */

/* which node list the page is showing, and its label */
function shown(p, q) {
  const mode = ['asis', 'tobe', 'diff', 'lanes', 'edit'].includes(q.mode) ? q.mode : 'tobe';
  const rel = q.rel ? (p.released || []).find(r => String(r.version) === String(q.rel)) : null;
  if (rel) return { mode: 'asis', rel, nodes: rel.asis || [], key: 'released', label: 'released v' + rel.version + ' as-is' };
  const ver = q.v === 'asis' ? 'asis' : 'tobe';
  if (mode === 'asis' || (mode === 'edit' && ver === 'asis')) return { mode, ver, nodes: p.asis || [], key: 'asis', label: 'as-is v' + (p.version || 1) };
  return { mode, ver, nodes: p.tobe || [], key: 'tobe', label: 'to-be' };
}

/* ---------- render ---------- */
export function render(params) {
  if (params.create) return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › New process</div><h1>New process</h1><p>Name it, then design the as-is and to-be maps.</p></div><div class="hdr-side"><div class="d-hdrtools"><button class="btn primary" data-new-open>Start</button>${importBtn()}</div></div></section>`;
  const pid = params.pid;
  const p = store.get('process', pid);
  if (!p) return notFound('Process “' + pid + '”');
  const q = params.q || {};
  const view = shown(p, q);
  const mode = view.mode, ver = view.ver || 'tobe', rel = view.rel;
  const tobe = p.tobe || [], asis = p.asis || [];
  const steps = flat(tobe);
  const diff = eng('diffProcess', [p], { nodes: {}, removed: [], changes: {} });
  const dn = diff.nodes || {};
  const sum = diffCounts(p);
  const tdl = [...new Set(steps.flatMap(s => s.data || []))];
  const live = tdl.filter(d => availOf(d) === 'live').length;
  const asisById = {}; flat(asis).forEach(a => asisById[a.id] = a);
  const byId = {}; allNodes(view.nodes).forEach(n => byId[n.id] = n);
  const ctx = { pid, mode, diff, asisById, byId, readonly: !!rel, edit: mode === 'edit' && !rel ? { ver } : null };

  /* a released version is read-only: no Edit tab, no authoring buttons */
  const modes = [['asis', 'As-is'], ['tobe', 'To-be'], ['diff', 'Diff'], ['lanes', 'Swimlanes'], ['edit', 'Edit']].filter(([k]) => !(rel && k === 'edit'));
  const rels = (p.released || []).slice().sort((a, b) => b.version - a.version);
  const side = `<div class="seg d-modes" role="tablist" aria-label="View mode">${modes.map(([k, l]) => `<button role="tab" aria-selected="${!rel && mode === k}" data-mode="${k}" class="${!rel && mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="d-hdrtools"><label class="d-verlbl">Version <select class="d-sel" data-version aria-label="Version"><option value="">Current${p.version ? ' (v' + esc(p.version) + ')' : ''}</option>${rels.map(r => `<option value="${esc(r.version)}" ${rel && rel.version === r.version ? 'selected' : ''}>Released v${esc(r.version)} · ${esc(fmt(String(r.at || '').slice(0, 10)))}</option>`).join('')}</select></label>
      <button class="btn sm" data-bpmn title="Download BPMN 2.0 XML for the ${esc(view.label)} map">Export BPMN</button>${rel ? '' : importBtn()}</div>
    <div class="kpis"><div class="kpi"><b>${steps.length}</b><span>To-be steps</span></div><div class="kpi" data-kpi-diff><b>${sum.new}+${sum.changed}</b><span>New + changed</span></div><div class="kpi"><b>${live}/${tdl.length}</b><span>Data live</span></div></div>`;

  const res = p.resources || [];
  const people = store.state.people;
  const headLeft = mode === 'edit' && !rel
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
  const modeNote = rel ? '' : { asis: 'How the process runs today. Tap a step to drill in.', tobe: 'The designed process. Tap a step to drill in.', diff: 'To-be compared with as-is: what is new, what changed, and what was removed.', lanes: 'The to-be process grouped by owner. Decisions and parallel gateways get their own row.' }[mode];
  if (rel) canvas = `<div class="d-relbanner" role="status"><b>Released ${esc(fmt(String(rel.at || '').slice(0, 10)))} by ${esc(pname(rel.by))}</b><span>Version ${esc(rel.version)} as-is map, read-only. This is how the process ran before the next release.</span><button class="btn sm" data-version-current>Back to current</button></div>
      ${(rel.asis || []).length ? `<div class="flow">${flowHTML(rel.asis, ctx, 'root')}</div>` : '<div class="empty">This release has no as-is map stored.</div>'}`;
  else if (mode === 'lanes') canvas = lanesHTML(tobe, ctx);
  else if (mode === 'asis') canvas = asis.length ? `<div class="flow">${flowHTML(asis, ctx, 'root')}</div>` : '<div class="empty">No as-is map yet.</div>';
  else if (mode === 'edit') {
    canvas = `<div class="d-editbar" role="group" aria-label="Editor">
        <span class="lbl">Editing</span><div class="seg">${['asis', 'tobe'].map(v => `<button data-ver="${v}" class="${ver === v ? 'on' : ''}" aria-pressed="${ver === v}">${v === 'asis' ? 'As-is' : 'To-be'}</button>`).join('')}</div>
        <button class="btn sm" data-fork>Fork to-be from as-is</button>
        <span class="hint">Press + to insert a step, decision or parallel gateway. Every change is saved and logged.</span></div>
      ${ver === 'asis' && !steps.length ? '<div class="d-firsthint" role="note" data-asis-hint><b>Map how it runs today, then fork to-be.</b> Add the as-is steps first. When they are in, press “Fork to-be from as-is” and redesign the copy.</div>' : ''}
      <div class="flow">${flowHTML(view.nodes, ctx, 'root')}</div>`;
  } else canvas = `<div class="flow">${flowHTML(tobe, ctx, 'root')}${mode === 'diff' ? removedHTML(diff, sum.removed) : ''}</div>`;

  /* side panel: describes the map being shown (as-is, released or to-be) */
  const vsteps = flat(view.nodes);
  const vname = view.key === 'tobe' ? 'to-be' : view.key === 'asis' ? 'as-is' : 'released as-is';
  const dl = [...new Set(vsteps.flatMap(s => s.data || []))];
  const stepGo = s => rel ? '' : `data-go="/process/${esc(pid)}/step/${esc(s.id)}"`;
  const missingSteps = vsteps.filter(s => (s.data || []).some(d => availOf(d) === 'missing'));
  const liveSteps = vsteps.filter(s => !missingSteps.includes(s) && (s.data || []).some(d => availOf(d) === 'example'));
  const ord = ['missing', 'example', 'live'];
  const dataRows = dl.slice().sort((a, b) => ord.indexOf(availOf(a)) - ord.indexOf(availOf(b))).map(d => {
    const x = dataEl(d) || {}; const used = vsteps.filter(s => (s.data || []).includes(d)).length;
    return `<div class="row click d-hlrow ${hl === d ? 'hl-on' : ''}" data-hl="${esc(d)}" tabindex="0" role="button" aria-pressed="${hl === d}" aria-label="Highlight steps using ${esc(x.name || d)}"><span style="margin-top:3px">${effDot(d)}</span>
      <div><div class="t">${esc(x.name || d)}</div><div class="s">${esc(x.source || 'Source not set')} · ${esc(pname(x.owner))}</div></div>
      <div class="r"><a href="${link('/data/' + d)}" data-link style="color:var(--accent)">${esc(AVAIL[effAvail(d)].short)} ›</a><div class="s">${used} step${used === 1 ? '' : 's'}</div></div></div>`;
  }).join('');
  const touches = {}; vsteps.forEach(s => (s.touches || []).forEach(t => touches[t] = (touches[t] || 0) + 1));
  const linked = projectsFor(pid);
  const sideHTML = `
    <div class="card"><h3>${LOCK} Steps needing missing data <span class="n">${missingSteps.length}</span></h3><div class="hint" style="margin:-4px 0 8px">In the ${vname} map</div>${missingSteps.length ? missingSteps.map(s => `<div class="row ${rel ? '' : 'click'}" ${stepGo(s)}><div><div class="t">${esc(s.title)}</div><div class="s">Needs ${s.data.filter(d => availOf(d) === 'missing').map(d => esc(dataName(d))).join(', ')}</div></div><div class="r">${av(s.owner)}</div></div>`).join('') : '<div class="s">Every data element has a source.</div>'}
      ${liveSteps.length ? `<div class="d-needlive-h">${NEEDS_LIVE} <span class="n">${liveSteps.length}</span></div>${liveSteps.map(s => `<div class="row ${rel ? '' : 'click'}" ${stepGo(s)}><div><div class="t">${esc(s.title)}</div><div class="s">Examples only: ${s.data.filter(d => availOf(d) === 'example').map(d => esc(dataName(d))).join(', ')}</div></div><div class="r">${av(s.owner)}</div></div>`).join('')}` : ''}</div>
    <div class="card" data-side-data="${view.key}"><h3>Data requirements <span class="n">${dl.length}</span></h3><div class="hint" style="margin:-4px 0 8px">Data the ${vname} map uses. Tap a row to highlight every step that uses it</div>${dataRows || '<div class="s">Tag data on steps and this list builds itself.</div>'}
      ${rel ? '' : '<div style="margin-top:10px"><button class="btn sm" data-newdata>+ New data element</button></div>'}</div>
    <div class="card"><h3>Touches across operations</h3><div class="chips">${Object.entries(touches).sort((a, b) => b[1] - a[1]).map(([t, c]) => `<span class="chip touch"># ${esc(t)} · ${c}</span>`).join('') || '<span class="s">No areas tagged yet.</span>'}</div></div>
    <div class="card"><h3>Used in projects <span class="n">${linked.length}</span></h3>${linked.map(j => `<div class="row click" data-go="/project/${esc(j.id)}"><div><div class="t">${esc(j.name)}</div><div class="s">Target ${esc(fmt(j.target))}${j.status === 'live' ? ' · live' : ''}</div></div><div class="r" style="color:var(--accent)">Open ›</div></div>`).join('') || '<div class="s">Not linked to a project yet.</div>'}
      ${rel ? '' : `<div class="d-startprj">${steps.length ? `<button class="btn sm primary" data-start-project>Start a project from this to-be</button><span class="hint">Plans the work to close the gap between as-is and to-be.</span>` : '<span class="hint">Design the to-be in Edit, then start a project from it.</span>'}</div>`}</div>
    ${activityCard('process:' + pid)}`;

  return `<section class="hdr d-hdr"><div>${headLeft}</div><div class="hdr-side">${side}</div></section>
    <div class="grid"><section class="canvas ${mode === 'edit' && !rel ? 'd-edit' : ''}" id="canvas" aria-label="Process map">${modeNote ? `<div class="hint" style="text-align:center;margin:-8px 0 14px">${modeNote}</div>` : ''}${canvas}</section>
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
const availDot = a => `<span class="dot" style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${(AVAIL[a] || AVAIL.missing).color}" title="${esc((AVAIL[a] || AVAIL.missing).label)}"></span>`;
const dataCheck = (name, d, on, pending) => `<label class="d-pick ${pending ? 'd-pending' : ''}"><input type="checkbox" name="${esc(name)}" value="${esc(d.id)}" ${on ? 'checked' : ''} />${pending ? availDot(d.avail) : effDot(d.id)}<span>${esc(d.name)}${pending ? ' <small>(new)</small>' : ''}</span></label>`;
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
    body: `${defaults.error ? `<div class="banner d-err" role="alert">${esc(defaults.error)}</div>` : ''}<div class="field"><label>Name</label><input name="name" value="${esc(defaults.name || '')}" placeholder="e.g. Vendor bank account" /></div>
      <div class="frow"><div class="field"><label>Owner</label><select name="owner">${personOpts(defaults.owner || store.state.me)}</select></div>
      <div class="field"><label>Availability</label><select name="avail">${availOpts(defaults.avail || 'missing')}</select></div></div>
      <div class="field"><label>Source</label><input name="source" placeholder="e.g. ERP vendor API" value="${esc(defaults.source || '')}" /></div>
      <div class="field"><label>Note</label><textarea name="note" placeholder="What exists today, and what is needed">${esc(defaults.note || '')}</textarea></div>`,
    actions: [{ id: 'save', label: 'Create', primary: true }],
  });
  if (r.action !== 'save') return null;
  const name = (r.form.name || '').trim();
  if (!name) return newDataModal(Object.assign({}, r.form, { error: 'A data element needs a name.' }));
  const dup = dupDataName(name);
  if (dup) return newDataModal(Object.assign({}, r.form, { error: `A data element called '${dup.name}' already exists. Use it, or choose a different name.` }));
  const id = store.newId('de');
  const data = { id, name, owner: r.form.owner, source: r.form.source.trim(), avail: r.form.avail, note: r.form.note.trim(), fields: [], samples: [], discovered: [] };
  try { await store.save('dataElement', id, data, `Created data element '${name}'`); toast(`Created '${name}'`); return data; }
  catch (e) { toast('Could not save: ' + e.message); return null; }
}

async function stepModal(p, ver, node) {
  const isNew = !node.title;
  const asisSteps = flat(p.asis);
  const sel = new Set(node.data || []);
  const pending = []; /* data elements created inline: saved only when the step is saved */
  const pr = modal({
    title: isNew ? `New step in ${VER[ver]}` : `Edit step in ${VER[ver]}`,
    body: `<div class="field"><label>Title</label><input name="title" value="${esc(node.title || '')}" placeholder="e.g. Verify vendor identity" /></div>
      <div class="frow"><div class="field"><label>Owner</label><select name="owner">${personOpts(node.owner || store.state.me)}</select></div>
      ${ver === 'tobe' ? `<div class="field"><label>Replaces as-is step</label><select name="from"><option value="">None: new in to-be</option>${asisSteps.map(a => `<option value="${esc(a.id)}" ${a.id === node.from ? 'selected' : ''}>${esc(a.title)}</option>`).join('')}</select></div>` : '<div></div>'}</div>
      <div class="frow d-frow3"><div class="field"><label>SLA</label><input name="sla" value="${esc(node.sla || '')}" placeholder="e.g. 2 business days" /></div>
        <div class="field"><label>System</label><input name="system" value="${esc(node.system || '')}" placeholder="e.g. ERP" /></div>
        <div class="field"><label>Duration (hours)</label><input name="durationHrs" type="number" min="0" step="0.25" inputmode="decimal" value="${esc(node.durationHrs != null ? node.durationHrs : '')}" /></div></div>
      <div class="field"><label>Data this step needs</label><div class="d-picks" data-picks>${allData().map(d => dataCheck('data', d, sel.has(d.id))).join('') || '<span class="hint">No data elements yet.</span>'}</div>
        <div class="d-inline-new"><input data-nd-name placeholder="New data element name" aria-label="New data element name" /><select data-nd-avail aria-label="Availability">${availOpts('missing')}</select><button type="button" class="btn sm" data-nd-create>Create and tag</button></div>
        <div class="hint" data-nd-msg aria-live="polite"></div></div>
      <div class="field"><label>Touches (comma separated)</label><input name="touches" value="${esc((node.touches || []).join(', '))}" placeholder="e.g. Compliance, ERP" /></div>
      <div class="field"><label>Sub-steps: how this step runs</label><div data-subs>${(node.subs || []).map(subRow).join('')}</div><div><button type="button" class="btn sm" data-subadd>+ Add sub-step</button></div></div>`,
    actions: [{ id: 'save', label: isNew ? 'Add step' : 'Save step', primary: true }],
  });
  const m = [...document.querySelectorAll('.overlay .modal')].pop();
  const subs = m.querySelector('[data-subs]');
  m.querySelector('[data-subadd]').onclick = () => {
    subs.insertAdjacentHTML('beforeend', subRow(null, subs.children.length));
    const box = subs.lastElementChild.querySelector('[data-subpicks]'); pending.forEach(d => box.insertAdjacentHTML('beforeend', dataCheck('sub_data', d, false, true)));
    subs.lastElementChild.querySelector('input').focus();
  };
  subs.addEventListener('click', e => { const b = e.target.closest('[data-subdel]'); if (b) b.closest('[data-subrow]').remove(); });
  const msg = m.querySelector('[data-nd-msg]');
  const nameEl = m.querySelector('[data-nd-name]');
  const create = () => {
    const name = nameEl.value.trim(); if (!name) { nameEl.focus(); return; }
    const dup = dupDataName(name, null, pending);
    if (dup) { msg.textContent = `'${dup.name}' already exists${pending.includes(dup) ? ' in this step' : ''}. Tick it in the list instead.`; msg.className = 'hint fail'; nameEl.focus(); return; }
    const d = { id: store.newId('de'), name, avail: m.querySelector('[data-nd-avail]').value };
    pending.push(d);
    m.querySelector('[data-picks]').insertAdjacentHTML('beforeend', dataCheck('data', d, true, true));
    m.querySelectorAll('[data-subpicks]').forEach(b => b.insertAdjacentHTML('beforeend', dataCheck('sub_data', d, false, true)));
    nameEl.value = ''; msg.className = 'hint'; msg.textContent = `'${name}' will be created when you save the step.`;
  };
  m.querySelector('[data-nd-create]').onclick = create;
  nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
  const r = await pr;
  if (r.action !== 'save') return null; /* cancelled: pending data elements are discarded */
  const root = r.root;
  const hrs = parseFloat(r.form.durationHrs);
  const out = Object.assign({}, node, {
    type: node.type || 'step',
    title: (r.form.title || '').trim() || 'Untitled step',
    owner: r.form.owner,
    data: [...root.querySelectorAll('[data-picks] input:checked')].map(i => i.value),
    touches: (r.form.touches || '').split(',').map(x => x.trim()).filter(Boolean),
    subs: [...root.querySelectorAll('[data-subrow]')].map(row => ({ title: row.querySelector('[name=sub_title]').value.trim(), data: [...row.querySelectorAll('input[name=sub_data]:checked')].map(i => i.value) })).filter(s => s.title),
  });
  ['sla', 'system'].forEach(k => { const v = (r.form[k] || '').trim(); if (v) out[k] = v; else delete out[k]; });
  if (isFinite(hrs) && hrs > 0) out.durationHrs = hrs; else delete out.durationHrs;
  if (ver === 'tobe') { if (r.form.from) out.from = r.form.from; else delete out.from; }
  /* create the inline data elements this step (or its sub-steps) actually uses */
  const used = new Set([...out.data, ...out.subs.flatMap(x => x.data)]);
  for (const d of pending.filter(x => used.has(x.id))) {
    if (dupDataName(d.name)) { toast(`'${d.name}' already exists; not created`); out.data = out.data.filter(x => x !== d.id); out.subs.forEach(x => x.data = x.data.filter(y => y !== d.id)); continue; }
    const doc = { id: d.id, name: d.name, owner: out.owner, source: '', avail: d.avail, note: `Created from the step '${out.title}'.`, fields: [], samples: [], discovered: [] };
    try { await store.save('dataElement', d.id, doc, `Created data element '${d.name}'`); }
    catch (e) { toast('Could not save: ' + e.message); out.data = out.data.filter(x => x !== d.id); }
  }
  return out;
}

function branchRow(b, targets) {
  return `<div class="d-brow" data-brow><input name="blabel" value="${esc(b ? b.label : '')}" placeholder="Branch label" aria-label="Branch label" data-keep="${b && b.keep != null ? b.keep : ''}" />
    ${targets ? `<select name="bgoto" aria-label="Loop back to" class="d-goto-sel"><option value="">Continue (no loop)</option>${targets.map(t => `<option value="${esc(t.id)}" ${b && b.goto === t.id ? 'selected' : ''}>↩ Loop back to ${esc(t.title)}</option>`).join('')}</select>` : ''}
    <button type="button" class="btn sm danger" data-bdel aria-label="Remove branch">Remove</button></div>`;
}
/* decision (exclusive, optional loop-backs) or parallel gateway (all branches run) */
async function decisionModal(node, kind, versionNodes) {
  const isNew = !node.title, par = kind === 'parallel';
  const targets = par ? null : allNodes(versionNodes || []).filter(n => isStep(n) || n.type === 'trigger').filter(n => !flat([node]).some(x => x.id === n.id));
  const bs = (node.branches && node.branches.length) ? node.branches.map((b, i) => ({ label: b.label, keep: i, goto: b.goto })) : (par ? [{ label: 'Track A' }, { label: 'Track B' }] : [{ label: 'Yes' }, { label: 'No' }]);
  const what = par ? 'parallel gateway' : 'decision';
  const pr = modal({
    title: (isNew ? 'New ' : 'Edit ') + what,
    body: `<div class="field"><label>${par ? 'Name (what runs at the same time)' : 'Question'}</label><input name="title" value="${esc(node.title || '')}" placeholder="${par ? 'e.g. Set up vendor in parallel' : 'e.g. Risk tier?'}" /></div>
      <div class="field"><label>Branches</label><div data-branches>${bs.map(b => branchRow(b, targets)).join('')}</div><div><button type="button" class="btn sm" data-badd>+ Add branch</button></div>
      <span class="hint">${par ? 'All branches run; the flow continues when every branch is done.' : 'Only one branch runs. A branch can loop back to an earlier step, e.g. “Incomplete → back to Collect information”.'} At least 2 branches. Removing a branch removes the steps inside it.</span></div>`,
    actions: [{ id: 'save', label: isNew ? 'Add ' + what : 'Save ' + what, primary: true }],
  });
  const m = [...document.querySelectorAll('.overlay .modal')].pop();
  const box = m.querySelector('[data-branches]');
  m.querySelector('[data-badd]').onclick = () => { box.insertAdjacentHTML('beforeend', branchRow(null, targets)); box.lastElementChild.querySelector('input').focus(); };
  box.addEventListener('click', e => { const b = e.target.closest('[data-bdel]'); if (!b) return; if (box.children.length <= 2) { toast('A gateway needs at least 2 branches'); return; } b.closest('[data-brow]').remove(); });
  const r = await pr;
  if (r.action !== 'save') return null;
  const old = node.branches || [];
  const branches = [...r.root.querySelectorAll('[data-brow]')].map((row, i) => {
    const inp = row.querySelector('input[name=blabel]'), g = row.querySelector('select[name=bgoto]');
    const b = { label: inp.value.trim() || 'Branch ' + (i + 1), nodes: inp.dataset.keep !== '' && old[+inp.dataset.keep] ? old[+inp.dataset.keep].nodes : [] };
    if (g && g.value) b.goto = g.value;
    return b;
  });
  return Object.assign({}, node, { type: par ? 'parallel' : 'decision', title: (r.form.title || '').trim() || (par ? 'In parallel' : 'Decision'), branches });
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

/* ---------- BPMN import + start project ---------- */
function importBtn() { return `<label class="btn sm d-import">Import BPMN<input type="file" accept=".bpmn,.xml,application/xml,text/xml" data-bpmn-file class="d-sr" aria-label="Import a BPMN 2.0 file (.bpmn or .xml)" /></label>`; }
function bindImport(root) {
  root.querySelectorAll('[data-bpmn-file]').forEach(inp => inp.onchange = async () => {
    const file = inp.files && inp.files[0]; inp.value = ''; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('That file is over 2 MB. Export a single process.'); return; }
    let r;
    try { r = parseBpmn(await file.text(), store.state.people, store.state.me); }
    catch (e) { await modal({ title: 'Could not import BPMN', body: `<p style="margin:0">${esc(e.message)}</p><p class="hint">PMOFlow reads BPMN 2.0 XML: start and end events, tasks, exclusive and parallel gateways, sequence flows and lanes.</p>`, actions: [] }); return; }
    if (!r.steps) { toast('No tasks found in that BPMN file'); return; }
    const name = r.name || file.name.replace(/\.(bpmn|xml)$/i, '') || 'Imported process';
    const id = store.newId('proc');
    const asis = r.nodes, tobe = forkNodes(asis);
    const owners = [...new Set(flat(asis).map(n => n.owner).filter(Boolean))];
    const p = { id, name, desc: r.desc || `Imported from ${file.name}.`, owner: store.state.me, resources: [...new Set([store.state.me, ...owners])], version: 1, asis, tobe, released: [] };
    try {
      await store.save('process', id, p, `Imported process '${name}' from BPMN (${r.steps} step${r.steps === 1 ? '' : 's'}, ${r.gateways} gateway${r.gateways === 1 ? '' : 's'})`);
      toast(`Imported '${name}': ${r.steps} step${r.steps === 1 ? '' : 's'}, ${r.gateways} gateway${r.gateways === 1 ? '' : 's'}${r.unknownLanes.length ? `. Lanes not matched to a person were assigned to you: ${r.unknownLanes.join(', ')}` : ''}`);
      go(`/process/${id}?mode=edit`);
    } catch (e) { toast('Could not import: ' + e.message); }
  });
}
async function startProject(p, err, vals) {
  vals = vals || {};
  const def = new Date(store.state.today + 'T12:00:00'); def.setDate(def.getDate() + 60);
  const r = await modal({
    title: 'Start a project from this to-be',
    body: `${err ? `<div class="banner d-err" role="alert">${esc(err)}</div>` : ''}<p class="hint" style="margin:0">The project links <b>${esc(p.name)}</b>. Its work is the gap between the as-is and the to-be. You (${esc(pname(store.state.me))}) will own it.</p>
      <div class="field"><label>Project name</label><input name="name" value="${esc(vals.name != null ? vals.name : p.name + ' rollout')}" /></div>
      <div class="field"><label>Target go-live date</label><input name="target" type="date" min="${esc(store.state.today)}" value="${esc(vals.target || def.toISOString().slice(0, 10))}" /></div>
      <div class="field"><label>Description</label><textarea name="desc" placeholder="Why this change, and what done looks like">${esc(vals.desc || '')}</textarea></div>`,
    actions: [{ id: 'create', label: 'Start project', primary: true }],
  });
  if (r.action !== 'create') return;
  const name = (r.form.name || '').trim(), target = r.form.target || '';
  if (!name) return startProject(p, 'A project needs a name.', r.form);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) return startProject(p, 'Choose a target date.', r.form);
  if (target < store.state.today) return startProject(p, 'The target date is in the past.', r.form);
  const me = store.state.me, id = store.newId('prj');
  const prj = { id, name, desc: (r.form.desc || '').trim(), owner: me, resources: [...new Set([me, ...(p.resources || [])])], target, processes: [p.id], status: 'active', baselines: [] };
  try { await store.save('project', id, prj, `Started project '${name}' from the to-be of '${p.name}'`); toast(`Started '${name}'`); go(`/project/${id}`); }
  catch (e) { toast('Could not create the project: ' + e.message); }
}

/* ---------- /new ---------- */
async function openNew() {
  if (newOpen) return; newOpen = true;
  const r = await modal({
    title: 'New process',
    body: `<div class="field"><label>Name</label><input name="name" placeholder="e.g. Purchase Request Approval" /></div>
      <div class="field"><label>Description</label><textarea name="desc" placeholder="What this process does and where it ends"></textarea></div>
      <div class="field"><label>Owner</label><select name="owner">${personOpts(store.state.me)}</select></div>`,
    actions: [{ id: 'import', label: 'Import BPMN…' }, { id: 'create', label: 'Create process', primary: true }],
  });
  if (r.action === 'import') { newOpen = false; newImport = true; const f = document.querySelector('[data-bpmn-file]'); if (f) f.click(); return; }
  if (r.action !== 'create') { newOpen = false; go('/'); return; }
  const name = (r.form.name || '').trim() || 'Untitled process';
  const id = store.newId('proc');
  const mk = () => { const t = store.newId('n'), e = store.newId('n'); return [{ id: t, type: 'trigger', title: 'What starts this process?', owner: r.form.owner, touches: [], data: [] }, { id: e, type: 'end', title: 'Process complete' }]; };
  const asis = mk(), tobe = mk(); tobe[0].from = asis[0].id;
  const p = { id, name, desc: (r.form.desc || '').trim(), owner: r.form.owner, resources: [r.form.owner], version: 1, asis, tobe, released: [] };
  /* keep the guard up until we have left /new: store.save re-renders this route before go() runs */
  try { await store.save('process', id, p, `Created process '${name}'`); toast(`Created '${name}'`); go(`/process/${id}?mode=edit&v=asis`); }
  catch (e) { toast('Could not create: ' + e.message); }
  finally { newOpen = false; }
}

/* ---------- bind ---------- */
function applyHl(root) {
  const nodes = root.querySelectorAll('#canvas .node[data-step]');
  nodes.forEach(n => { n.classList.remove('dim', 'hl'); if (hl) n.classList.add((n.dataset.data || '').split(',').includes(hl) ? 'hl' : 'dim'); });
}

export function bind(root, params) {
  bindImport(root);
  if (params.create) { const b = root.querySelector('[data-new-open]'); if (b) b.onclick = () => { newImport = false; openNew(); }; if (!newImport) openNew(); return; }
  newImport = false;
  const pid = params.pid; const cur = () => store.get('process', pid);
  if (!cur()) return;
  bindActivity(root);
  const q = params.q || {};
  const ver = q.v === 'asis' ? 'asis' : 'tobe';
  const vs = root.querySelector('[data-version]');
  if (vs) vs.onchange = () => go(vs.value ? `/process/${pid}?mode=asis&rel=${encodeURIComponent(vs.value)}` : `/process/${pid}?mode=asis`);
  const vc = root.querySelector('[data-version-current]'); if (vc) vc.onclick = () => go(`/process/${pid}?mode=asis`);
  const bx = root.querySelector('[data-bpmn]');
  if (bx) bx.onclick = () => {
    const p = cur(); const view = shown(p, q);
    const xml = bpmnXml(p, view.nodes, view.label);
    const slug = String(p.name || 'process').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    a.download = `${slug}-${view.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.bpmn`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Exported BPMN 2.0 for the ' + view.label + ' map');
  };
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
  const sp = root.querySelector('[data-start-project]'); if (sp) sp.onclick = () => startProject(cur());

  if (q.mode !== 'edit' || q.rel) return;
  /* header meta */
  root.querySelectorAll('[data-meta]').forEach(el => el.addEventListener('change', () => {
    const p = clone(cur()); const k = el.dataset.meta; const v = k === 'owner' ? el.value : el.value.trim();
    if (k === 'name' && !v) { el.value = p.name; return; }
    if ((p[k] || '') === v) return; p[k] = v;
    saveProc(p, k === 'name' ? `Renamed process to '${v}'` : k === 'desc' ? 'Updated process description' : `Set process owner to ${pname(v)}`);
  }));
  root.querySelectorAll('[data-res-del]').forEach(b => b.onclick = async () => { const id = b.dataset.resDel; if (!await confirmBox('Remove resource?', `Remove ${pname(id)} from this process's resources?`, 'Remove')) return; const p = clone(cur()); p.resources = (p.resources || []).filter(x => x !== id); saveProc(p, `Removed ${pname(id)} from resources`); });
  const ra = root.querySelector('[data-res-add]'); if (ra) ra.onchange = () => { if (!ra.value) return; const p = clone(cur()); p.resources = [...new Set([...(p.resources || []), ra.value])]; saveProc(p, `Added ${pname(ra.value)} to resources`); };

  const fork = root.querySelector('[data-fork]');
  if (fork) fork.onclick = async () => {
    const p = clone(cur());
    if (!await confirmBox('Fork to-be from as-is?', `This replaces the current to-be map (${flat(p.tobe).length} steps) with a copy of the as-is map. Each copied step links back to the as-is step it came from.`, 'Fork to-be')) return;
    p.tobe = forkNodes(p.asis || []);
    await saveProc(p, 'Forked to-be from as-is');
    go(`/process/${pid}?mode=edit&v=tobe`);
  };

  root.querySelectorAll('[data-ins]').forEach(b => b.onclick = async () => {
    const key = b.dataset.ins, pos = +b.dataset.pos;
    const pick = await modal({ title: 'Insert here', body: `<div class="d-pickkind"><p style="margin:0"><b>Step</b>: one piece of work with an owner and data.</p><p style="margin:0"><b>Decision</b> ◆: only one branch runs; a branch can loop back.</p><p style="margin:0"><b>Parallel</b> ⊕: every branch runs at the same time.</p></div>`, actions: [{ id: 'parallel', label: 'Parallel' }, { id: 'decision', label: 'Decision' }, { id: 'step', label: 'Step', primary: true }] });
    if (!['step', 'decision', 'parallel'].includes(pick.action)) return;
    const p0 = cur();
    const node = pick.action === 'step' ? await stepModal(p0, ver, { id: store.newId('n'), type: 'step', data: [], touches: [], subs: [] }) : await decisionModal({ id: store.newId('d'), type: pick.action }, pick.action, p0[ver]);
    if (!node) return;
    const p = clone(cur()); const list = getList(p[ver] || (p[ver] = []), key);
    if (!list) { toast('That spot no longer exists'); return; }
    list.splice(Math.min(pos, list.length), 0, node);
    const where = key === 'root' ? '' : (() => { const [did, bi] = key.split('#'); const d = findLoc(p[ver], did); return d ? ` (branch '${d.node.branches[+bi].label}' of '${d.node.title}')` : ''; })();
    await saveProc(p, `Added ${node.type === 'decision' ? 'decision' : node.type === 'parallel' ? 'parallel gateway' : 'step'} '${node.title}' to ${VER[ver]}${where}`);
  });

  root.querySelectorAll('[data-ed]').forEach(b => b.onclick = async () => {
    const act = b.dataset.ed, id = b.dataset.id;
    const p = clone(cur()); const loc = findLoc(p[ver] || [], id); if (!loc) return;
    const n = loc.node; const kind = n.type === 'decision' ? 'decision' : n.type === 'parallel' ? 'parallel gateway' : n.type === 'trigger' ? 'trigger' : n.type === 'end' ? 'end point' : 'step';
    if (act === 'edit') {
      const out = isGw(n) ? await decisionModal(n, n.type, p[ver]) : (n.type === 'trigger' || n.type === 'end') ? await simpleNodeModal(n) : await stepModal(p, ver, n);
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
      const inner = isGw(n) ? flat([n]).length : 0;
      if (!await confirmBox(`Delete ${kind}?`, `Delete '${n.title}' from the ${VER[ver]} map${inner ? ` and the ${inner} step${inner === 1 ? '' : 's'} inside its branches` : ''}?`, 'Delete')) return;
      const p2 = clone(cur()); const l2 = findLoc(p2[ver] || [], id); if (!l2) return;
      const gone = new Set(allNodes([l2.node]).map(x => x.id));
      l2.list.splice(l2.index, 1);
      /* loop-backs that pointed at the deleted node(s) now continue instead */
      allNodes(p2[ver]).forEach(x => isGw(x) && (x.branches || []).forEach(br => { if (br.goto && gone.has(br.goto)) delete br.goto; }));
      await saveProc(p2, `Deleted ${kind} '${n.title}' from ${VER[ver]}`);
    }
  });
}
