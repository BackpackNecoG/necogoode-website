/* Import SOP (stream R): paste an SOP, draft a process with AI (or the rules parser), edit the draft
   (steps, nested sub-steps, decisions with Yes/No branches, proposed new data elements), then create the process.
   Route: /import
   Data links come only from the server parser's strong matches; anything weaker arrives as a newData proposal. */
import { store } from '../store.js';
import { esc, link, go, pname, modal, toast } from '../ui.js';

const ui = { text: '', draft: null, source: null, notes: [], busy: false, openData: null };

const SAMPLE = `# Northwind Traders — Contractor Onboarding SOP (v3)
Purpose: bring a new independent contractor from signed engagement to first approved invoice.
Owner: Procurement
Revision: 3

1. The hiring manager submits the contractor request form in the procurement portal with scope, start date and rate.
2. The procurement coordinator sends the onboarding packet and collects the signed W-9 with the vendor legal name & Tax ID.
3. Compliance screens the contractor against the restricted-party list and records the sanctions screening result.
4. The contractor uploads a certificate of insurance; Compliance checks it.
   a. Confirm general liability coverage meets the minimum amount.
   b. Confirm the policy expiry date is after the engagement end date.
5. If the contract value exceeds $50,000, Treasury reviews the engagement first.
6. Treasury collects bank remittance details through the secure supplier form and confirms them with a call-back.
7. Accounts Payable creates the vendor master record in the ERP.
8. On the first invoice, Accounts Payable matches it to the approved contractor timesheet record before scheduling payment.`;

const strip = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const clone = o => JSON.parse(JSON.stringify(o));

/* Map server output (ids, names or roles) to people and data elements. Exact matches only: no keyword guessing. */
function matchPerson(v) {
  if (!v) return '';
  const ppl = store.state.people;
  const s = strip(v);
  const hit = ppl.find(p => p.id === v) || ppl.find(p => strip(p.name) === s) || ppl.find(p => strip(p.role) === s) || ppl.find(p => p.bu && strip(p.bu) === s);
  return hit ? hit.id : '';
}
function matchData(v) {
  const des = store.list('dataElement');
  const hit = des.find(d => d.id === v) || des.find(d => strip(d.name) === strip(v));
  return hit ? hit.id : null;
}

const isGate = n => n && (n.type === 'decision' || n.type === 'parallel' || (Array.isArray(n.branches) && n.branches.length));
function normStep(n) {
  const title = String(n.title || n.text || n.name || '').trim();
  if (!title) return null;
  return {
    type: 'step', title,
    owner: matchPerson(n.owner || n.ownerId || n.role),
    data: [...new Set((n.data || n.dataElements || []).map(matchData).filter(Boolean))],
    touches: Array.isArray(n.touches) ? n.touches.map(String) : [],
    subs: (Array.isArray(n.subs) ? n.subs : []).map(s => typeof s === 'string' ? { title: s, data: [] } : { title: String(s.title || s.text || '').trim(), data: [...new Set((s.data || []).map(matchData).filter(Boolean))] }).filter(s => s.title),
    newData: Array.isArray(n.newData) ? n.newData.map(x => String(typeof x === 'string' ? x : x.name || '')).filter(Boolean) : [],
  };
}
function normNode(n) {
  if (!n || n.type === 'trigger' || n.type === 'end') return null;
  if (isGate(n)) {
    const branches = (n.branches || []).map(b => ({ label: String((b && b.label) || '').trim() || 'Branch', nodes: ((b && b.nodes) || []).map(x => isGate(x) ? null : normStep(x)).filter(Boolean) }));
    while (branches.length < 2) branches.push({ label: branches.length ? 'No' : 'Yes', nodes: [] });
    return { type: n.type === 'parallel' ? 'parallel' : 'decision', title: String(n.title || n.text || 'Decision').trim(), branches };
  }
  return normStep(n);
}
function normalize(res) {
  const raw = (res && (res.nodes || res.steps || res.draft || (res.process && (res.process.nodes || res.process.steps || res.process.asis)))) || [];
  const nodes = raw.map(normNode).filter(Boolean);
  const existing = new Set(store.list('dataElement').map(d => strip(d.name)));
  const seen = new Set();
  const newData = (Array.isArray(res && res.newData) ? res.newData : []).map(x => typeof x === 'string' ? { name: x } : x)
    .filter(x => x && String(x.name || '').trim())
    .map(x => ({ name: String(x.name).trim(), reason: String(x.reason || ''), step: x.step != null ? x.step : x.stepTitle, exists: existing.has(strip(x.name)) }))
    .filter(x => { const k = strip(x.name); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(x => Object.assign(x, { create: !x.exists }));
  let notes = res && (res.notes || res.note || res.warnings);
  notes = Array.isArray(notes) ? notes.map(String) : notes ? [String(notes)] : [];
  const src = res && res.source === 'rules' ? 'Rules' : 'AI';
  return { nodes, newData, notes, source: src, name: res && (res.name || (res.process && res.process.name)), trigger: res && (res.trigger || (res.process && res.process.trigger)) };
}

/* Path helpers. Paths: "3" top-level node, "3.b1.0" step 0 of branch 1, "3.s2" sub-step 2 of top-level step 3. */
function at(path) {
  const parts = String(path).split('.');
  let node = ui.draft.nodes[+parts[0]];
  for (let i = 1; i < parts.length && node; i++) {
    const p = parts[i];
    if (p[0] === 'b') { const br = node.branches[+p.slice(1)]; node = br && br.nodes[+parts[++i]]; }
    else if (p[0] === 's') node = node.subs[+p.slice(1)];
  }
  return node;
}
function countSteps(nodes) { return (nodes || []).reduce((n, x) => n + (x.type === 'step' ? 1 : (x.branches || []).reduce((m, b) => m + countSteps(b.nodes), 0)), 0); }

/* ---------- render ---------- */
function dataPicker(s, path) {
  const des = store.list('dataElement');
  const open = ui.openData === path;
  return `<details class="is-data" data-dpath="${esc(path)}" ${open ? 'open' : ''}><summary>Data${s.data.length ? ` (${s.data.length})` : ''}</summary><div class="is-pop">${des.map(x => `<label><input type="checkbox" data-f="data" value="${esc(x.id)}" ${s.data.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('') || '<span class="hint">No data elements in this workspace.</span>'}</div></details>`;
}
function ownerSel(s) {
  return `<select data-f="owner" aria-label="Owner"><option value="">No owner</option>${store.state.people.map(p => `<option value="${esc(p.id)}" ${p.id === s.owner ? 'selected' : ''}>${esc(p.name)} — ${esc(p.role)}</option>`).join('')}</select>`;
}
function dataChips(s) {
  const linked = s.data.map(id => `<span class="chip">${esc((store.get('dataElement', id) || {}).name || id)}</span>`);
  const proposed = (s.newData || []).filter(n => { const p = ui.draft.newData.find(x => strip(x.name) === strip(n)); return p && p.create; }).map(n => `<span class="chip is-newchip">+ ${esc(n)}</span>`);
  return linked.length || proposed.length ? `<div class="chips">${linked.concat(proposed).join('')}</div>` : '';
}
function stepBody(s, path, label) {
  return `<div class="is-body" data-path="${esc(path)}"><textarea class="is-title" data-f="title" rows="2" aria-label="${esc(label)} title">${esc(s.title)}</textarea>
    <div class="is-row">${ownerSel(s)}${dataPicker(s, path)}</div>${dataChips(s)}
    ${(s.subs || []).length ? `<ol class="is-subs">${s.subs.map((sb, k) => `<li class="is-sub" data-path="${esc(path + '.s' + k)}"><input data-f="title" value="${esc(sb.title)}" aria-label="Sub-step ${k + 1}"><button class="btn sm is-x" data-rm-path="${esc(path + '.s' + k)}" aria-label="Remove sub-step">✕</button></li>`).join('')}</ol>` : ''}
    <div><button class="btn sm is-link" data-add-sub="${esc(path)}">+ Sub-step</button></div></div>`;
}
function gateBody(g, path) {
  return `<div class="is-body is-gate" data-path="${esc(path)}"><div class="is-gate-h"><span class="is-diamond" aria-hidden="true">◆</span><span class="is-kind">${g.type === 'parallel' ? 'Parallel' : 'Decision'}</span></div>
    <textarea class="is-title" data-f="title" rows="2" aria-label="Decision question">${esc(g.title)}</textarea>
    <div class="is-branches">${g.branches.map((b, j) => `<div class="is-branch" data-branch="${esc(path + '.b' + j)}">
      <div class="is-branch-h"><input class="is-blabel" data-blabel="${esc(path + '.b' + j)}" value="${esc(b.label)}" aria-label="Branch label"><span class="hint">${b.nodes.length ? b.nodes.length + ' step' + (b.nodes.length === 1 ? '' : 's') : 'continues to the next step'}</span></div>
      ${b.nodes.map((s, k) => `<div class="is-bstep">${stepBody(s, `${path}.b${j}.${k}`, 'Branch step')}<button class="btn sm danger is-x" data-rm-path="${esc(`${path}.b${j}.${k}`)}" aria-label="Remove branch step">✕</button></div>`).join('')}
      <button class="btn sm is-link" data-add-bstep="${esc(path + '.b' + j)}">+ Step in “${esc(b.label)}”</button></div>`).join('')}</div></div>`;
}

export function render() {
  const d = ui.draft;
  const n = d ? countSteps(d.nodes) : 0;
  const gates = d ? d.nodes.filter(x => x.type !== 'step').length : 0;
  const newData = d ? d.newData : [];
  const nd = newData.length ? `<div class="is-newdata" data-newdata><h4>Proposed new data elements</h4>
      <p class="hint">The parser found data the SOP needs that matches no existing element closely enough to link. Tick the ones to create on import; they start as Missing and owned by you.</p>
      ${newData.map((x, i) => `<label class="is-nd ${x.exists ? 'dup' : ''}" data-nd="${i}"><input type="checkbox" data-nd-create="${i}" ${x.create ? 'checked' : ''} ${x.exists ? 'disabled' : ''}>
        <span><input class="is-nd-name" data-nd-name="${i}" value="${esc(x.name)}" aria-label="New data element name" ${x.exists ? 'disabled' : ''}>${x.reason ? `<small>${esc(x.reason)}</small>` : ''}${x.exists ? '<small class="is-dupmsg">Already exists: not created again.</small>' : ''}</span></label>`).join('')}</div>` : '';

  const draftHtml = d ? `<div class="card is-draft"><h3>Draft process<span class="is-src ${ui.source === 'AI' ? 'ai' : 'rules'}">${esc(ui.source)}</span><span class="n">${n} steps${gates ? ` · ${gates} decision${gates === 1 ? '' : 's'}` : ''}</span></h3>
    ${ui.notes.length ? `<div class="note is-notes"><b>${ui.source === 'AI' ? 'AI notes' : 'Parser notes'}</b><ul>${ui.notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <ol class="is-steps">${d.nodes.map((s, i) => `<li class="is-step ${s.type !== 'step' ? 'gate' : ''}" data-i="${i}" data-type="${esc(s.type)}">
      <span class="is-n">${s.type === 'step' ? i + 1 : '◆'}</span>
      ${s.type === 'step' ? stepBody(s, String(i), 'Step ' + (i + 1)) : gateBody(s, String(i))}
      <div class="is-ctl"><button class="btn sm" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="btn sm" data-mv="1" ${i === d.nodes.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button><button class="btn sm danger" data-rm aria-label="Remove">✕</button></div></li>`).join('')}</ol>
    ${nd}
    <div class="is-foot"><button class="btn sm" data-add-step>+ Add step</button><button class="btn sm" data-add-gate>+ Add decision</button><button class="btn primary" data-create ${d.nodes.length ? '' : 'disabled'}>Create process</button></div></div>` : '';

  return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> · Import SOP</div>
      <h1>Import an SOP</h1><p>Paste a written procedure. PMOFlow drafts the as-is process: steps, sub-steps, decisions, owners and the data each step needs. You review every step before anything is saved.</p></div>
    <div class="hdr-side"><a class="btn" href="${link('/new')}" data-link>Start from blank</a></div></section>
    <div class="is-grid ${d ? 'has-draft' : ''}">
      <div class="card"><h3>SOP text</h3>
        <div class="field"><textarea class="is-text" data-sop placeholder="Paste the SOP here: numbered steps work best.">${esc(ui.text)}</textarea></div>
        <div class="is-foot"><button class="btn sm" data-sample>Use sample SOP</button><span class="hint">${ui.text.length.toLocaleString()} chars</span>
          <button class="btn primary" data-draft ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Drafting…' : 'Draft process'}</button></div>
        <div class="hint" style="margin-top:8px">The text is sent to the in-tenant AI endpoint and is not stored. Without AI, a rules parser drafts the steps. Data is linked only on a strong name match; anything else is proposed as new data.</div></div>
      ${draftHtml || `<div class="card is-empty"><div class="empty">Your draft appears here: one editable card per step, with sub-steps, decisions and owner and data suggestions.</div></div>`}
    </div>`;
}

/* Copy every edited input back into the draft model. */
function readDraft(root) {
  if (!ui.draft) return;
  root.querySelectorAll('[data-path]').forEach(el => {
    const node = at(el.dataset.path); if (!node) return;
    const own = sel => [...el.querySelectorAll(sel)].filter(x => x.closest('[data-path]') === el);
    const t = own('[data-f=title]')[0]; if (t) node.title = t.value;
    const o = own('[data-f=owner]')[0]; if (o) node.owner = o.value;
    if (node.type === 'step' && own('[data-f=data]').length) node.data = own('[data-f=data]').filter(x => x.checked).map(x => x.value);
  });
  root.querySelectorAll('[data-blabel]').forEach(el => { const [p, b] = el.dataset.blabel.split(/\.b(?=\d+$)/); const g = at(p); if (g && g.branches[+b]) g.branches[+b].label = el.value; });
  root.querySelectorAll('[data-nd-create]').forEach(el => { const x = ui.draft.newData[+el.dataset.ndCreate]; if (x && !x.exists) x.create = el.checked; });
  root.querySelectorAll('[data-nd-name]').forEach(el => { const x = ui.draft.newData[+el.dataset.ndName]; if (x && !x.exists) x.name = el.value; });
}

function removeAt(path) {
  const m = /^(.*)\.(s|b\d+\.)(\d+)$/.exec(path);
  if (!m) { ui.draft.nodes.splice(+path, 1); return; }
  const parent = at(m[1]);
  if (m[2] === 's') parent.subs.splice(+m[3], 1);
  else parent.branches[+m[2].slice(1, -1)].nodes.splice(+m[3], 1);
}

export function bind(root) {
  const ta = root.querySelector('[data-sop]');
  if (ta) ta.oninput = () => { ui.text = ta.value; const h = ta.closest('.card').querySelector('.is-foot .hint'); if (h) h.textContent = ui.text.length.toLocaleString() + ' chars'; };
  const rerender = () => { readDraft(root); store.emit(); };
  const sm = root.querySelector('[data-sample]'); if (sm) sm.onclick = () => { readDraft(root); ui.text = SAMPLE; store.emit(); };
  const dr = root.querySelector('[data-draft]');
  if (dr) dr.onclick = async () => {
    if (!ui.text.trim()) { toast('Paste an SOP or use the sample first.'); return; }
    ui.busy = true; store.emit();
    try {
      const res = await store.api('/ai/sop-import', { text: ui.text });
      const n = normalize(res);
      ui.draft = { nodes: n.nodes, newData: n.newData, name: n.name || '', trigger: n.trigger || '' };
      ui.source = n.source; ui.notes = n.notes;
      toast(`Drafted ${countSteps(n.nodes)} steps (${n.source})`);
    } catch (e) { toast('Could not draft: ' + e.message); }
    finally { ui.busy = false; store.emit(); }
  };
  if (!ui.draft) return;
  root.querySelectorAll('.is-step').forEach(li => {
    const i = +li.dataset.i;
    li.querySelectorAll(':scope > .is-ctl [data-mv]').forEach(b => b.onclick = () => { readDraft(root); const j = i + +b.dataset.mv; const a = ui.draft.nodes; [a[i], a[j]] = [a[j], a[i]]; store.emit(); });
    li.querySelector(':scope > .is-ctl [data-rm]').onclick = () => { readDraft(root); ui.draft.nodes.splice(i, 1); store.emit(); };
  });
  root.querySelectorAll('[data-f=owner],[data-f=data],[data-nd-create]').forEach(el => el.onchange = () => { if (el.dataset.f === 'data') ui.openData = el.closest('[data-dpath]').dataset.dpath; rerender(); });
  root.querySelectorAll('[data-f=title],[data-blabel],[data-nd-name]').forEach(el => el.oninput = () => readDraft(root));
  root.querySelectorAll('[data-dpath]').forEach(det => det.addEventListener('toggle', () => { if (det.open) ui.openData = det.dataset.dpath; else if (ui.openData === det.dataset.dpath) ui.openData = null; }));
  root.querySelectorAll('[data-rm-path]').forEach(b => b.onclick = () => { readDraft(root); removeAt(b.dataset.rmPath); store.emit(); });
  root.querySelectorAll('[data-add-sub]').forEach(b => b.onclick = () => { readDraft(root); const s = at(b.dataset.addSub); (s.subs = s.subs || []).push({ title: 'New sub-step', data: [] }); store.emit(); });
  root.querySelectorAll('[data-add-bstep]').forEach(b => b.onclick = () => { readDraft(root); const [p, j] = b.dataset.addBstep.split(/\.b(?=\d+$)/); at(p).branches[+j].nodes.push({ type: 'step', title: 'New step', owner: '', data: [], touches: [], subs: [], newData: [] }); store.emit(); });
  const add = root.querySelector('[data-add-step]'); if (add) add.onclick = () => { readDraft(root); ui.draft.nodes.push({ type: 'step', title: 'New step', owner: '', data: [], touches: [], subs: [], newData: [] }); store.emit(); };
  const ag = root.querySelector('[data-add-gate]'); if (ag) ag.onclick = () => { readDraft(root); ui.draft.nodes.push({ type: 'decision', title: 'Condition met?', branches: [{ label: 'Yes', nodes: [] }, { label: 'No', nodes: [] }] }); store.emit(); };
  const cr = root.querySelector('[data-create]'); if (cr) cr.onclick = () => { readDraft(root); createProcess(); };
}

const firstLine = t => (String(t).split('\n').map(x => x.replace(/^#+\s*/, '').trim()).find(Boolean) || '').replace(/\s*[—-]\s*SOP.*$/i, '').replace(/\bSOP\b.*$/i, '').trim();

function allSteps(nodes, out) { (nodes || []).forEach(n => { if (n.type === 'step') out.push(n); else (n.branches || []).forEach(b => allSteps(b.nodes, out)); }); return out; }

async function createProcess() {
  const d = ui.draft; if (!d) return;
  const nodes = d.nodes.filter(n => String(n.title || '').trim());
  if (!countSteps(nodes) && !nodes.length) { toast('The draft has no steps.'); return; }

  /* New data: block blank and duplicate names (case-insensitive) against the workspace and each other. */
  const picks = d.newData.filter(x => x.create && !x.exists);
  const existing = new Map(store.list('dataElement').map(x => [strip(x.name), x.name]));
  const seen = new Set();
  for (const x of picks) {
    const k = strip(x.name);
    if (!k) { toast('A proposed data element has no name.'); return; }
    if (existing.has(k)) { toast(`“${x.name.trim()}” already exists as “${existing.get(k)}”. Untick it or rename it.`); return; }
    if (seen.has(k)) { toast(`“${x.name.trim()}” is listed twice. Untick one.`); return; }
    seen.add(k);
  }

  const guess = d.name || firstLine(ui.text).replace(/^Northwind Traders\s*[—-]\s*/i, '') || 'Imported process';
  const steps = allSteps(nodes, []);
  const r = await modal({
    title: 'Create process',
    body: `<div class="field"><label>Name</label><input name="name" value="${esc(guess.slice(0, 80))}"></div>
      <div class="field"><label>Description</label><textarea name="desc">${esc('Imported from SOP. ' + steps.length + ' steps.')}</textarea></div>
      <div class="field"><label>Trigger</label><input name="trigger" value="${esc(d.trigger || (steps[0] ? steps[0].title.split(/[,.]/)[0].slice(0, 60) : '') || 'Request received')}"></div>
      ${picks.length ? `<div class="hint">Also creates ${picks.length} data element${picks.length === 1 ? '' : 's'}: ${picks.map(x => esc(x.name.trim())).join(', ')}.</div>` : ''}
      <div class="hint">Creates version 1 of the as-is process and a to-be copy you can redesign. Opens in the editor.</div>`,
    actions: [{ id: 'create', label: 'Create', primary: true }],
  });
  if (r.action !== 'create') return;
  const name = (r.form.name || '').trim() || 'Imported process';

  /* 1. create the ticked data elements, remembering name -> id for linking */
  const made = new Map();
  try {
    for (const x of picks) {
      const id = store.newId('D');
      await store.save('dataElement', id, { id, name: x.name.trim(), owner: store.state.me, source: 'Proposed by SOP import', avail: 'missing', note: x.reason || `Needed by the “${name}” process.`, fields: [], samples: [], discovered: [] },
        `Created data element “${x.name.trim()}” from an imported SOP`);
      made.set(strip(x.name), id);
    }
  } catch (e) { toast('Could not create data: ' + e.message); return; }
  /* proposals that name a step (index or title) also link to it */
  /* proposals link to the step they came from: an explicit step (index or title), or the line the parser quoted */
  picks.forEach(x => {
    const id = made.get(strip(x.name)); if (!id) return;
    let s = null;
    if (typeof x.step === 'number') s = steps[x.step];
    else if (x.step) s = steps.find(y => strip(y.title) === strip(x.step));
    else { const m = /Mentioned in "([^"]+?)…?"/.exec(x.reason || ''); const q = m && strip(m[1]); if (q && q.length >= 12) s = steps.find(y => strip(y.title).startsWith(q) || q.startsWith(strip(y.title))); }
    if (s && !s.data.includes(id)) s.data.push(id);
  });

  /* 2. build the as-is tree with fresh ids, then the to-be copy with `from` links */
  const nid = () => store.newId('n');
  const mkStep = s => {
    const extra = (s.newData || []).map(n => made.get(strip(n))).filter(Boolean);
    const node = { id: nid(), type: 'step', title: s.title.trim(), data: [...new Set(s.data.concat(extra))], touches: (s.touches || []).slice() };
    if (s.owner) node.owner = s.owner;
    const subs = (s.subs || []).filter(x => String(x.title || '').trim()).map(x => ({ title: x.title.trim(), data: (x.data || []).slice() }));
    if (subs.length) node.subs = subs;
    return node;
  };
  const mk = n => n.type === 'step' ? mkStep(n)
    : { id: nid(), type: n.type, title: n.title.trim(), branches: n.branches.map(b => ({ label: (b.label || '').trim() || 'Branch', nodes: b.nodes.filter(s => String(s.title || '').trim()).map(mkStep) })) };
  const asis = [{ id: nid(), type: 'trigger', title: (r.form.trigger || 'Request received').trim(), touches: [] }].concat(nodes.map(mk)).concat([{ id: nid(), type: 'end', title: 'Done' }]);
  const copy = n => { const c = Object.assign(clone(n), { id: nid(), from: n.id }); if (n.branches) c.branches = n.branches.map(b => ({ label: b.label, nodes: b.nodes.map(copy) })); return c; };
  const tobe = asis.map(copy);
  const pid = store.newId('proc');
  const resources = [...new Set(steps.map(s => s.owner).filter(Boolean).concat(store.state.me ? [store.state.me] : []))];
  try {
    await store.save('process', pid, { id: pid, name, desc: (r.form.desc || '').trim(), owner: store.state.me, resources, version: 1, asis, tobe, released: [] },
      `Created process “${name}” from an imported SOP (${steps.length} steps${made.size ? `, ${made.size} new data element${made.size === 1 ? '' : 's'}` : ''})`);
  } catch (e) { toast('Could not create: ' + e.message); return; }
  ui.draft = null; ui.text = ''; ui.notes = []; ui.source = null; ui.openData = null;
  toast('Process created');
  go(`/process/${pid}?mode=edit`);
}
