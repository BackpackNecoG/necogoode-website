/* Import SOP (stream R): paste an SOP, draft a process with AI (or the rules fallback), edit the draft, create the process.
   Route: /import */
import { store } from '../store.js';
import { esc, link, go, av, pname, modal, toast } from '../ui.js';

const ui = { text: '', draft: null, source: null, notes: [], busy: false, openData: null };

const SAMPLE = `# Northwind Traders — Contractor Onboarding SOP (v3)
# Purpose — bring a new independent contractor from signed engagement to first approved invoice.

1. The hiring manager submits a contractor request in the procurement portal with scope, start date and rate.
2. The procurement coordinator sends the onboarding packet and collects the signed W-9 with the contractor's tax ID (TIN).
3. Compliance screens the contractor name and tax ID against the restricted-party list and records the result.
4. The contractor uploads a certificate of insurance; compliance checks coverage amounts and the expiry date.
5. Treasury collects bank details (routing number and account number) through the secure supplier form and confirms them with a call-back to a known number.
6. The AP specialist creates the vendor record in the ERP using the tax ID, remit-to address and bank details.
7. IT provisions a contractor account and laptop access for the start date, scoped to the project systems.
8. The hiring manager confirms the statement of work and approves the purchase order.
9. On the first invoice, the AP specialist matches it to the purchase order and the approved timesheet before scheduling payment.
10. The procurement coordinator files the onboarding checklist and sets a reminder 30 days before the insurance certificate expires.`;

const strip = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/* Map AI/rules output (ids, names or roles) to people and data elements in this workspace. */
function matchPerson(v) {
  if (!v) return '';
  const ppl = store.state.people;
  const s = strip(v);
  const hit = ppl.find(p => p.id === v) || ppl.find(p => strip(p.name) === s) || ppl.find(p => strip(p.role) === s)
    || ppl.find(p => s && (strip(p.role).includes(s) || s.includes(strip(p.role)))) || ppl.find(p => s && s.includes(strip(p.bu || '~~')));
  return hit ? hit.id : '';
}
function matchData(v) {
  const des = store.list('dataElement');
  const s = strip(v);
  const hit = des.find(d => d.id === v) || des.find(d => strip(d.name) === s) || des.find(d => s && (strip(d.name).includes(s) || s.includes(strip(d.name))));
  return hit ? hit.id : null;
}
/* Second pass for steps the server left unassigned: business-unit / role words and data-name keywords in the step text. */
const GENERIC = new Set(['vendor', 'details', 'record', 'result', 'name', 'number', 'data', 'and']);
const reEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function suggestOwner(title) {
  for (const p of store.state.people) {
    const keys = [p.bu, p.bu && p.bu.split(' ').map(w => w[0]).join('').length > 1 ? p.bu.split(' ').map(w => w[0]).join('') : null].filter(Boolean);
    for (const k of keys) {
      const short = k.length <= 3;
      if (new RegExp('\\b' + reEsc(k) + '\\b', short ? '' : 'i').test(title)) return p.id;
    }
  }
  return '';
}
function suggestData(title) {
  return store.list('dataElement').filter(d => String(d.name).toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !GENERIC.has(t))
    .some(t => new RegExp('\\b' + reEsc(t.replace(/(ing|s)$/, '')) + '(s|es|ing|ed)?\\b', 'i').test(title))).map(d => d.id);
}
function normalize(res) {
  const raw = (res && (res.steps || res.draft || res.nodes || (res.process && (res.process.steps || res.process.asis)))) || [];
  const steps = raw.filter(n => !n.type || n.type === 'step').map(n => ({
    title: String(n.title || n.text || n.name || '').trim(),
    owner: matchPerson(n.owner || n.ownerId || n.role),
    data: [...new Set((n.data || n.dataElements || []).map(matchData).filter(Boolean))],
    touches: Array.isArray(n.touches) ? n.touches.map(String) : [],
  })).filter(n => n.title);
  let suggested = 0;
  steps.forEach(n => {
    if (!n.owner) { n.owner = suggestOwner(n.title); if (n.owner) suggested++; }
    const extra = suggestData(n.title).filter(d => !n.data.includes(d)); if (extra.length) { n.data.push(...extra); suggested++; }
  });
  let notes = res && (res.notes || res.note || res.warnings);
  notes = Array.isArray(notes) ? notes.map(String) : notes ? [String(notes)] : [];
  if (suggested) notes.push(`${suggested} owner or data suggestion(s) were added from business-unit names and data keywords in the step text. Check them before creating.`);
  const src = res && res.source === 'rules' ? 'Rules' : 'AI';
  return { steps, notes, source: src, name: res && (res.name || (res.process && res.process.name)), trigger: res && (res.trigger || (res.process && res.process.trigger)) };
}

export function render() {
  const ppl = store.state.people, des = store.list('dataElement');
  const d = ui.draft;
  const draftHtml = d ? `<div class="card is-draft"><h3>Draft process<span class="is-src ${ui.source === 'AI' ? 'ai' : 'rules'}">${esc(ui.source)}</span><span class="n">${d.steps.length} steps</span></h3>
    ${ui.notes.length ? `<div class="note is-notes"><b>${ui.source === 'AI' ? 'AI notes' : 'Notes'}</b><ul>${ui.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    <ol class="is-steps">${d.steps.map((s, i) => `<li class="is-step" data-i="${i}">
      <span class="is-n">${i + 1}</span>
      <div class="is-body"><textarea class="is-title" data-f="title" rows="2" aria-label="Step ${i + 1} title">${esc(s.title)}</textarea>
        <div class="is-row"><select data-f="owner" aria-label="Owner"><option value="">No owner</option>${ppl.map(p => `<option value="${esc(p.id)}" ${p.id === s.owner ? 'selected' : ''}>${esc(p.name)} — ${esc(p.role)}</option>`).join('')}</select>
          <details class="is-data" ${ui.openData === i ? 'open' : ''}><summary>Data${s.data.length ? ` (${s.data.length})` : ''}</summary><div class="is-pop">${des.map(x => `<label><input type="checkbox" data-f="data" value="${esc(x.id)}" ${s.data.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('') || '<span class="hint">No data elements in this workspace.</span>'}</div></details></div>
        ${s.data.length ? `<div class="chips">${s.data.map(id => `<span class="chip">${esc((store.get('dataElement', id) || {}).name || id)}</span>`).join('')}</div>` : ''}</div>
      <div class="is-ctl"><button class="btn sm" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="btn sm" data-mv="1" ${i === d.steps.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button><button class="btn sm danger" data-rm aria-label="Remove">✕</button></div></li>`).join('')}</ol>
    <div class="is-foot"><button class="btn sm" data-add-step>+ Add step</button><button class="btn primary" data-create ${d.steps.length ? '' : 'disabled'}>Create process</button></div></div>` : '';

  return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> · Import SOP</div>
      <h1>Import an SOP</h1><p>Paste a written procedure. PMOFlow drafts the as-is process: steps, owners and the data each step needs. You review every step before anything is saved.</p></div>
    <div class="hdr-side"><a class="btn" href="${link('/new')}" data-link>Start from blank</a></div></section>
    <div class="is-grid ${d ? 'has-draft' : ''}">
      <div class="card"><h3>SOP text</h3>
        <div class="field"><textarea class="is-text" data-sop placeholder="Paste the SOP here: numbered steps work best.">${esc(ui.text)}</textarea></div>
        <div class="is-foot"><button class="btn sm" data-sample>Use sample SOP</button><span class="hint">${ui.text.length.toLocaleString()} chars</span>
          <button class="btn primary" data-draft ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Drafting…' : 'Draft process'}</button></div>
        <div class="hint" style="margin-top:8px">The text is sent to the in-tenant AI endpoint and is not stored. Without AI, a rules parser drafts the steps.</div></div>
      ${draftHtml || `<div class="card is-empty"><div class="empty">Your draft appears here: one editable card per step, with owner and data suggestions.</div></div>`}
    </div>`;
}

function readDraft(root) {
  if (!ui.draft) return;
  root.querySelectorAll('.is-step').forEach(li => {
    const s = ui.draft.steps[+li.dataset.i]; if (!s) return;
    s.title = li.querySelector('[data-f=title]').value;
    s.owner = li.querySelector('[data-f=owner]').value;
    s.data = [...li.querySelectorAll('[data-f=data]:checked')].map(x => x.value);
  });
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
      ui.draft = { steps: n.steps, name: n.name || '', trigger: n.trigger || '' };
      ui.source = n.source; ui.notes = n.notes;
      toast(`Drafted ${n.steps.length} steps (${n.source})`);
    } catch (e) { toast('Could not draft: ' + e.message); }
    finally { ui.busy = false; store.emit(); }
  };
  root.querySelectorAll('.is-step').forEach(li => {
    const i = +li.dataset.i;
    li.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { readDraft(root); const j = i + +b.dataset.mv; const a = ui.draft.steps; [a[i], a[j]] = [a[j], a[i]]; store.emit(); });
    li.querySelector('[data-rm]').onclick = () => { readDraft(root); ui.draft.steps.splice(i, 1); store.emit(); };
    li.querySelectorAll('[data-f=owner],[data-f=data]').forEach(el => el.onchange = () => { ui.openData = el.dataset.f === 'data' ? i : ui.openData; rerender(); });
    li.querySelector('[data-f=title]').oninput = () => readDraft(root);
    const det = li.querySelector('details'); det.addEventListener('toggle', () => { if (det.open) ui.openData = i; else if (ui.openData === i) ui.openData = null; });
  });
  const add = root.querySelector('[data-add-step]'); if (add) add.onclick = () => { readDraft(root); ui.draft.steps.push({ title: 'New step', owner: '', data: [], touches: [] }); store.emit(); };
  const cr = root.querySelector('[data-create]'); if (cr) cr.onclick = () => { readDraft(root); createProcess(); };
}

const firstLine = t => (String(t).split('\n').map(x => x.replace(/^#+\s*/, '').trim()).find(Boolean) || '').replace(/\s*[—-]\s*SOP.*$/i, '').replace(/\bSOP\b.*$/i, '').trim();

async function createProcess() {
  const d = ui.draft; if (!d) return;
  const steps = d.steps.filter(s => s.title.trim());
  if (!steps.length) { toast('The draft has no steps.'); return; }
  const guess = d.name || firstLine(ui.text).replace(/^Northwind Traders\s*[—-]\s*/i, '') || 'Imported process';
  const r = await modal({
    title: 'Create process',
    body: `<div class="field"><label>Name</label><input name="name" value="${esc(guess.slice(0, 80))}"></div>
      <div class="field"><label>Description</label><textarea name="desc">${esc('Imported from SOP. ' + steps.length + ' steps.')}</textarea></div>
      <div class="field"><label>Trigger</label><input name="trigger" value="${esc(d.trigger || steps[0].title.split(/[,.]/)[0].slice(0, 60) || 'Request received')}"></div>
      <div class="hint">Creates version 1 of the as-is process and a to-be copy you can redesign. Opens in the editor.</div>`,
    actions: [{ id: 'create', label: 'Create', primary: true }],
  });
  if (r.action !== 'create') return;
  const name = (r.form.name || '').trim() || 'Imported process';
  const pid = store.newId('proc');
  const nid = () => store.newId('n');
  const asis = [{ id: nid(), type: 'trigger', title: (r.form.trigger || 'Request received').trim(), touches: [] }]
    .concat(steps.map(s => ({ id: nid(), type: 'step', title: s.title.trim(), owner: s.owner || undefined, data: s.data.slice(), touches: (s.touches || []).slice() })))
    .concat([{ id: nid(), type: 'end', title: 'Done' }]);
  const tobe = asis.map(n => Object.assign(JSON.parse(JSON.stringify(n)), { id: nid(), from: n.id }));
  const resources = [...new Set(steps.map(s => s.owner).filter(Boolean).concat(store.state.me ? [store.state.me] : []))];
  try {
    await store.save('process', pid, { id: pid, name, desc: (r.form.desc || '').trim(), owner: store.state.me, resources, version: 1, asis, tobe, released: [] }, `Created process “${name}” from an imported SOP (${steps.length} steps)`);
  } catch (e) { toast('Could not create: ' + e.message); return; }
  ui.draft = null; ui.text = ''; ui.notes = []; ui.source = null;
  toast('Process created');
  go(`/process/${pid}?mode=edit`);
}
