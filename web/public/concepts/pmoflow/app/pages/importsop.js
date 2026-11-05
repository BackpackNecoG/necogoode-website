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
The process starts when a hiring manager submits a contractor request.

1. The hiring manager submits the contractor request form in the procurement portal with scope, start date and rate.
2. The procurement coordinator sends the onboarding packet and collects the signed W-9 with the vendor legal name & Tax ID.
3. Compliance screens the contractor against the restricted-party list and records the sanctions screening result.
4. Compliance checks the certificate of insurance uploaded by the contractor.
   a. Confirm general liability coverage meets the minimum amount.
   b. Confirm the policy expiry date is after the engagement end date.
5. If the contract value exceeds $50,000, Treasury reviews the engagement first. Otherwise, Procurement approves the engagement directly.
6. Treasury collects bank remittance details through the secure supplier form and confirms them with a call-back.
7. At the same time, Accounts Payable creates the vendor master record in the ERP and IT provisions contractor access in Workday.
8. On the first invoice, Accounts Payable matches it to the approved contractor timesheet record before scheduling payment.`;

/* R7 plain notes: no parser wording in Simple mode. */
/* Simple: drop parser lines about owners; the owner prompt says it in the same words as the boxes. */
const notesShown = () => adv() ? ui.notes : ui.notes.map(n => String(n).split(/(?<=\.)\s+/).filter(x => !/\b(no one assigned|no owner|is a role, not a named person|Check each step before saving|^Found \d+ steps?)/i.test(x)).join(' ')).filter(x => x.trim());
function plainNote(t) {
  if (adv()) return t;
  return String(t).replace(/^Not proposed as data \(they name a person or an action, not a document, record or field\): /, 'Not added as information (they name a person or an action): ')
    .replace(/\bdata elements?\b/gi, m => /s$/i.test(m) ? 'information' : 'information').replace(/no existing information matches/gi, 'not in your workspace yet').replace(/\bparser\b/gi, 'reader').replace(/\bSOP\b/g, 'procedure').replace(/\bgateways?\b/gi, 'choice').replace(/\bto-be\b/gi, 'future').replace(/\bas-is\b/gi, 'today').replace(/\btop-level nodes?\b/gi, 'steps');
}
const strip = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/* R6: never leave "()" (or "( )", "[]") in a title, and tidy the spacing it leaves behind. */
export const cleanTitle = t => String(t || '').replace(/\s*[([]\s*[)\]]/g, '').replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
/* R6 node kinds beyond steps and gateways. The parser may return any of these; each renders and is kept on create. */
const KINDS = { wait: { icon: '⏱', label: 'Wait' }, message: { icon: '✉', label: 'Message' }, subprocess: { icon: '⊞', label: 'Sub-process' } };
const kindOf = t => ({ timer: 'wait', wait: 'wait', message: 'message', send: 'message', receive: 'message', subprocess: 'subprocess', callActivity: 'subprocess' }[t] || null);
const clone = o => JSON.parse(JSON.stringify(o));

/* Map server output to people. R8: only a person's id or full name is a person; a team or role ("Procurement",
   "Compliance analyst") stays as that text (ownerRole). An id is kept only when the procedure itself names that person,
   so the import never assigns a step to someone the text doesn't mention, least of all the current user. */
function namedInText(p) { const t = strip(ui.text); return !!p && !!t && (` ${t} `).includes(` ${strip(p.name)} `); }
function matchPerson(v) {
  if (!v) return '';
  const ppl = store.state.people;
  const byId = ppl.find(p => p.id === v);
  if (byId) return namedInText(byId) ? byId.id : '';
  const hit = ppl.find(p => strip(p.name) === strip(v));
  return hit ? hit.id : '';
}
/* When the server gave a person the text never names, keep what the text does say: the team (their BU) or their role. */
function roleFromId(v) {
  const p = store.state.people.find(x => x.id === v); if (!p || namedInText(p)) return '';
  const t = ` ${strip(ui.text)} `;
  if (p.bu && t.includes(` ${strip(p.bu)} `)) return p.bu;
  if (p.role && t.includes(` ${strip(p.role)} `)) return capRole(p.role);
  return '';
}
function matchData(v) {
  const des = store.list('dataElement');
  const hit = des.find(d => d.id === v) || des.find(d => strip(d.name) === strip(v));
  return hit ? hit.id : null;
}

const isGate = n => n && (n.type === 'decision' || n.type === 'parallel' || (Array.isArray(n.branches) && n.branches.length));
/* Every draft node keeps a stable source id so loop-backs (branch.goto) can point at it. */
let srcSeq = 0;
const srcId = n => (n && typeof n.id === 'string' && n.id) ? n.id : 'x' + (++srcSeq);
/* R7: a role named in free text ("The manager approves…") becomes ownerRole when no person matches: shown as "Who: Manager". */
const ROLE_W = 'manager|employee|clerk|coordinator|courier|officer|analyst|lead|specialist|supervisor|director|controller|buyer|requester|requestor|reviewer|contractor|approver|administrator|admin|accountant|assistant|agent|team|staff|technician|driver|receptionist|nurse|teacher|engineer';
const ROLE_RE = new RegExp('^(?:the|an?)\\s+((?:[a-z-]+\\s){0,2}?(?:' + ROLE_W + ')s?)\\b', 'i');
const capRole = r => { const t = String(r || '').trim().replace(/\s+/g, ' '); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
export function roleOf(n, title) {
  const given = n && (n.ownerRole || (n.role && !matchPerson(n.role) ? n.role : '') || roleFromId(n.owner || n.ownerId));
  if (given) return capRole(given);
  const m = ROLE_RE.exec(String(title || '')); return m ? capRole(m[1]) : '';
}
const adv = () => !!store.advanced;
/* R8: a time limit the procedure states ("within 2 business days"), whatever field the reader put it in. */
const slaOf = n => { const v = n && (n.sla != null ? n.sla : n.timeLimit != null ? n.timeLimit : n.within); return v == null || v === '' ? '' : String(typeof v === 'object' ? (v.text || v.label || '') : v).trim(); };
function normStep(n) {
  const title = cleanTitle(n.title || n.text || n.name || '');
  if (!title) return null;
  const owner = matchPerson(n.owner || n.ownerId || n.role);
  return {
    type: 'step', title, src: srcId(n),
    owner, ownerRole: owner ? '' : roleOf(n, title),
    data: [...new Set((n.data || n.dataElements || []).map(matchData).filter(Boolean))],
    touches: Array.isArray(n.touches) ? n.touches.map(String) : [],
    system: typeof n.system === 'string' ? n.system.trim() : '',
    sla: slaOf(n),
    subs: (Array.isArray(n.subs) ? n.subs : []).map(s => typeof s === 'string' ? { title: cleanTitle(s), data: [] } : { title: cleanTitle(s.title || s.text || ''), data: [...new Set((s.data || []).map(matchData).filter(Boolean))] }).filter(s => s.title),
    newData: Array.isArray(n.newData) ? n.newData.map(x => String(typeof x === 'string' ? x : x.name || '')).filter(Boolean) : [],
  };
}
/* wait / message / sub-process nodes keep their kind and the fields that describe them */
function normKind(n, kind) {
  const title = cleanTitle(n.title || n.text || n.name || '');
  if (!title) return null;
  const x = { type: kind, title, src: srcId(n), owner: matchPerson(n.owner || n.ownerId || n.role), data: [...new Set((n.data || []).map(matchData).filter(Boolean))], touches: Array.isArray(n.touches) ? n.touches.map(String) : [], subs: [], newData: Array.isArray(n.newData) ? n.newData.map(y => String(typeof y === 'string' ? y : y.name || '')).filter(Boolean) : [], system: '' };
  ['wait', 'duration', 'timer', 'direction', 'party', 'calls', 'processId', 'sla'].forEach(k => { if (n[k] != null && n[k] !== '') x[k] = n[k]; });
  if (n.type === 'send' || n.type === 'receive') x.direction = x.direction || n.type;
  return x;
}
function normNode(n) {
  if (!n || n.type === 'trigger' || n.type === 'end') return null;
  const k = kindOf(n.type); if (k) return normKind(n, k);
  if (isGate(n)) {
    const branches = (n.branches || []).map(b => { const br = { label: cleanTitle((b && b.label) || '') || 'Branch', nodes: ((b && b.nodes) || []).map(x => isGate(x) ? null : x && x.type === 'end' ? endNode(x.title) : kindOf(x && x.type) ? normKind(x, kindOf(x.type)) : normStep(x)).filter(Boolean) };
      if (b && b.goto != null && b.goto !== '') br.goto = String(b.goto); return br; });
    while (branches.length < 2) branches.push({ label: branches.length ? 'No' : 'Yes', nodes: [] });
    return { type: n.type === 'parallel' ? 'parallel' : 'decision', title: cleanTitle(n.title || n.text || 'Decision') || 'Decision', src: srcId(n), branches };
  }
  return normStep(n);
}
function normalize(res) {
  const raw = (res && (res.nodes || res.steps || res.draft || (res.process && (res.process.nodes || res.process.steps || res.process.asis)))) || [];
  const nodes = raw.map(normNode).filter(Boolean);
  resolveGotos(nodes);
  repairDraft(nodes, ui.text);
  const existing = new Set(store.list('dataElement').map(d => strip(d.name)));
  const seen = new Set();
  let newData = (Array.isArray(res && res.newData) ? res.newData : []).map(x => typeof x === 'string' ? { name: x } : x)
    .filter(x => x && String(x.name || '').trim())
    .map(x => ({ name: cleanTitle(x.name), reason: String(x.reason || ''), step: x.step != null ? x.step : x.stepTitle, exists: existing.has(strip(x.name)) }))
    .filter(x => { const k = strip(x.name); if (seen.has(k)) return false; seen.add(k); return true; });
  const skipped = newData.filter(x => !isDataNoun(x.name)).map(x => x.name);
  newData = newData.filter(x => isDataNoun(x.name)).map(x => Object.assign(x, { create: !x.exists }));
  let notes = res && (res.notes || res.note || res.warnings);
  notes = Array.isArray(notes) ? notes.map(String) : notes ? [String(notes)] : [];
  /* R9 §9: the step count is stated once, by this page, from the steps actually in the draft (the reader's own
     "Found N steps" sentence counted steps the repair below merges or removes) */
  notes = notes.map(t => t.replace(/^Found \d+ steps?[^.]*\.\s*/i, '').trim()).filter(Boolean);
  if (skipped.length) notes.push(`Not proposed as data (they name a person or an action, not a document, record or field): ${skipped.join(', ')}.`);
  const src = res && res.source === 'rules' ? 'Rules' : 'AI';
  const trigNode = raw.find(n => n && n.type === 'trigger' && n.title);
  const trigger = (res && (res.trigger || (res.process && res.process.trigger))) || (trigNode && trigNode.title) || '';
  newData.forEach(x => { x.target = targetOf(nodes, x); });
  return { nodes, newData, notes, source: src, name: res && (res.name || (res.process && res.process.name)), trigger: cleanTitle(trigger) };
}

/* R6: a data proposal must name a document, record or field, never a person doing something ("Receiving clerk records"). */
const ROLE = /^(clerk|manager|coordinator|officer|analyst|lead|owner|approver|specialist|admin|administrator|team|staff|employee|agent|supervisor|director|controller|buyer|requester|requestor|reviewer|contractor)$/;
function isDataNoun(name) {
  const w = strip(name).split(' ').filter(Boolean);
  if (!w.length) return false;
  if (w.length >= 2 && ROLE.test(w[w.length - 2]) && /[a-z]s$/.test(w[w.length - 1])) return false;   /* role + verb */
  if (ROLE.test(w[w.length - 1])) return false;                                                     /* a person, not data */
  return true;
}
/* The step a proposal links to on create (by source id). Every created element lands in some step's data requirements:
   the step the parser named, the step that lists it, the step quoted in its reason, a step naming it, else the first step. */
function targetOf(nodes, x) {
  const steps = allSteps(nodes, []); if (!steps.length) return null;
  let t = null;
  if (typeof x.step === 'number') t = steps[x.step];
  else if (x.step) t = steps.find(y => strip(y.title) === strip(x.step));
  if (!t) t = steps.find(y => (y.newData || []).some(n => strip(n) === strip(x.name)));
  if (!t) { const m = /Mentioned in "([^"]+?)…?"/.exec(x.reason || ''); const q = m && strip(m[1]); if (q && q.length >= 12) t = steps.find(y => strip(y.title).startsWith(q) || q.startsWith(strip(y.title))); }
  if (!t) t = steps.find(y => strip(y.title).includes(strip(x.name)));
  return (t || steps[0]).src;
}

/* goto may arrive as a node id, a 1-based step number or a step title; keep it only if it resolves to a draft node. */
function targets(nodes) { const out = []; (nodes || []).forEach(n => { out.push(n); (n.branches || []).forEach(b => b.nodes.forEach(x => out.push(x))); }); return out; }
function resolveGotos(nodes) {
  const all = targets(nodes); const tops = nodes.filter(n => n.type === 'step');
  nodes.forEach(g => (g.branches || []).forEach(b => {
    if (b.goto == null) return;
    const v = String(b.goto);
    let t = all.find(n => n.src === v);
    if (!t && /^\d+$/.test(v)) t = nodes[+v - 1] || tops[+v - 1];
    if (!t) t = all.find(n => strip(n.title) === strip(v));
    if (t) b.goto = t.src; else delete b.goto;
  }));
}

/* ---------- R9 §9: repairs applied to whatever the reader returned, using the pasted text ----------
   The reader runs on the server; these keep each clause on the step it is written in, end a rejected "If OK" path,
   read "Role (Name)" owners and move system names to the step's system. Each repair is a no-op when the text has
   nothing of the kind, so a draft that is already right is left alone. */
const endNode = t => ({ type: 'end', title: cleanTitle(t) || 'Stop', src: srcId({}) });
const words = s => strip(s).split(' ').filter(w => w.length > 2 && !/^(the|and|for|with|from|into|then|this|that|its|their)$/.test(w));
const covers = (hay, needle) => { const h = new Set(words(hay)); const n = words(needle); return n.length > 0 && n.every(w => h.has(w) || h.has(w.replace(/s$/, '')) || h.has(w + 's')); };
const overlap = (a, b) => { const h = new Set(words(a)); return words(b).filter(w => h.has(w)).length; };
/* the numbered lines of the pasted text: [{num, body}] */
function numberedLines(text) {
  return String(text || '').split(/\r?\n/).map(l => /^\s*(?:step\s+)?(\d+)[.):]\s+(.+)$/i.exec(l)).filter(m => m && !/^\d+\.\d/.test(m[0].trim())).map(m => ({ num: +m[1], body: m[2].trim() }));
}
/* "updates" -> "update", "verifies" -> "verify", "reaches" -> "reach" */
const verbBase = v => { const w = String(v || ''); if (/ies$/i.test(w)) return w.slice(0, -3) + 'y'; if (/(ch|sh|ss|x|z)es$/i.test(w)) return w.slice(0, -2); if (/[^s]s$/i.test(w)) return w.slice(0, -1); return w; };
const SYSTEM_NOUNS = ['ServiceNow', 'HRIS', 'ERP', 'CRM', 'Workday', 'SAP', 'Oracle', 'NetSuite', 'Concur', 'Salesforce', 'SharePoint', 'DocuSign', 'Jira', 'Coupa', 'Ariba', 'QuickBooks', 'Xero', 'Okta', 'Active Directory', 'Zendesk', 'HubSpot', 'Dynamics'];
const sysRe = new RegExp('\\b(' + SYSTEM_NOUNS.map(x => x.replace(/\s+/g, '\\s+')).join('|') + ')\\b');
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function fixStep(n) {
  if (!n || n.type !== 'step') return;
  /* "HR Manager (Maya Chen) updates the employee record" -> owner Maya Chen (or the role, with the name in the note) */
  const rn = /^(?:the\s+)?([A-Z][\w&/-]*(?:\s+[A-Za-z&/-]+){0,3}?)\s*\(([^)]{2,40})\)\s+([a-z]+)\b\s*(.*)$/.exec(n.title);
  const roleTxt = !rn && /^(.+?)\s*\(([^)]{2,40})\)$/.exec(n.ownerRole || '');
  if (rn || roleTxt) {
    const role = cleanTitle(rn ? rn[1] : roleTxt[1]), name = cleanTitle(rn ? rn[2] : roleTxt[2]);
    if (rn) n.title = capRole(cleanTitle(verbBase(rn[3]) + ' ' + rn[4]).replace(/[.;]$/, ''));
    const hit = store.state.people.find(p => strip(p.name) === strip(name));
    if (hit) { n.owner = hit.id; n.ownerRole = ''; }
    else { n.owner = ''; n.ownerRole = capRole(role); n.note = `Named in the procedure: ${name}`; }
  }
  /* system nouns become the step's system, never information or a team */
  const m = sysRe.exec(n.title);
  if (m) {
    if (!n.system) n.system = m[1].replace(/\s+/g, ' ');
    if (n.system === m[1].replace(/\s+/g, ' ')) n.title = capRole(cleanTitle(n.title.replace(new RegExp('\\s+(?:in|into|on|using|via|through|from|to|with)\\s+(?:the\\s+)?' + reEsc(m[1]) + '(?:\\s+(?:system|app|tool))?\\b', 'i'), ' ')));
  }
}
function repairDraft(nodes, text) {
  if (!Array.isArray(nodes)) return nodes;
  targets(nodes).forEach(fixStep);
  const lines = numberedLines(text);
  const tops = () => nodes.filter(n => n.type === 'step');
  const bestStep = body => { let best = null, sc = 0; tops().forEach(s => { const k = overlap(body, s.title); if (k > sc) { sc = k; best = s; } }); return best; };
  /* B1: "5. Facilities collects laptop; if not returned within 5 days, notify Legal" belongs to step 5. The reader hangs
     "if not …" on the last choice it saw, even one from another line; move it back to its own step. */
  lines.forEach(({ body }) => {
    const m = /^(.*?)[;,.]\s*if not\s+([^,]+?),\s*(?:then\s+)?(.+?)[.;]?$/i.exec(body);
    if (!m || /\b(if|unless|when)\b/i.test(m[1])) return;
    const cond = m[2].trim(), act = m[3].trim();
    let moved = null;
    nodes.forEach(g => (g.branches || []).forEach(b => {
      if (moved) return;
      const k = b.nodes.findIndex(x => x.type === 'step' && covers(m[2] + ' ' + m[3], x.title));
      if (k < 0 || covers(body, g.title.replace(/\?$/, ''))) return;   /* the choice really is on this line: keep it */
      moved = b.nodes.splice(k, 1)[0];
    }));
    const already = nodes.some(g => g.type === 'decision' && covers(cond, g.title.replace(/\?$/, '')));
    if (!moved && already) return;
    const host = bestStep(m[1]); if (!host) return;
    const i = nodes.indexOf(host);
    const doer = host.owner ? { owner: host.owner, ownerRole: '' } : { owner: '', ownerRole: host.ownerRole || '' };
    const step = Object.assign({ type: 'step', title: capRole(cleanTitle(act)), src: srcId({}), data: [], touches: [], system: '', sla: '', subs: [], newData: [] }, doer);
    fixStep(step);
    nodes.splice(i + 1, 0, { type: 'decision', title: capRole(cleanTitle(cond)) + '?', src: srcId({}), branches: [{ label: 'Yes', nodes: [] }, { label: 'No', nodes: [step] }] });
  });
  /* "If OK, forwards to IT": Yes goes on to IT's step; No ends the process unless the text says what happens */
  lines.forEach(({ body }) => {
    const m = /\bif\s+(ok|okay|approved|correct|complete|fine|valid|satisfactory|acceptable|accepted)\b,?\s*(?:then\s+)?(?:(?:he|she|they|it)\s+)?(?:forward|send|pass|route|hand|refer|escalate|submit)\w*\s+(?:it\s+|this\s+|the request\s+)?(?:on\s+)?to\s+(?:the\s+)?([A-Z][\w&-]*(?:\s+[A-Z][\w&-]*)*)/i.exec(body);
    if (!m) return;
    const word = m[1].toLowerCase(), x = m[2];
    const g = nodes.find(n => n.type === 'decision' && (strip(n.title) === strip(word) || (n.branches[0] && n.branches[0].nodes.some(s => /^(forward|send|pass|route|hand|refer|escalate|submit)/i.test(s.title) && strip(s.title).includes(strip(x))))));
    if (!g) return;
    if (/^(ok|okay)\??$/i.test(g.title.trim())) g.title = 'Request OK?';
    const yes = g.branches[0], no = g.branches[1];
    yes.nodes = yes.nodes.filter(s => !(/^(forward|send|pass|route|hand|refer|escalate|submit)/i.test(s.title) && strip(s.title).includes(strip(x))));
    const after = nodes.slice(nodes.indexOf(g) + 1);
    const isX = s => s && s.type === 'step' && (strip(s.ownerRole) === strip(x) || (s.owner && store.state.people.some(p => p.id === s.owner && (strip(p.bu) === strip(x) || strip(p.name) === strip(x)))));
    const tgt = after.find(isX);
    if (!yes.nodes.length && tgt && tgt !== after[0]) yes.goto = tgt.src;
    else if (!yes.nodes.length && !tgt) yes.nodes.push({ type: 'step', title: 'Send to ' + x, src: srcId({}), owner: '', ownerRole: '', data: [], touches: [], system: '', sla: '', subs: [], newData: [] });
    const says = /\b(otherwise|if not|else|rejected|returns?|sends? (it )?back)\b/i.test(body.slice(m.index + m[0].length));
    if (no && !no.nodes.length && !no.goto && !says) no.nodes.push(endNode('Stop: request rejected'));
  });
  return nodes;
}
/* R9 §9 (B2): the process name comes from the title line or "Procedure: X", never from step 1 */
export function deriveName(text) {
  const ls = String(text || '').split(/\r?\n/).map(x => x.replace(/^#+\s*/, '').trim()).filter(Boolean);
  const tidyName = t => {
    let x = String(t).replace(/^Northwind Traders\s*[—–-]\s*/i, '').replace(/\s*\((?:v|rev|version)\s*[\d.]+\)\s*$/i, '')
      .replace(/\s*[—–-]?\s*\b(standard operating procedure|sop|procedure|process|policy|work instruction|checklist)\b\s*$/i, '').replace(/[.:;,\s]+$/, '').trim();
    if (!x || x.split(/\s+/).length > 8) return '';
    /* sentence case, keeping acronyms ("IT access request") */
    return x.split(/\s+/).map((w, i) => /^[A-Z0-9&-]{2,}$/.test(w) ? w : i ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  };
  for (const l of ls) { const m = /^(?:procedure|process|title|sop|name)\s*[:\-–—]\s*(.+)$/i.exec(l); if (m && tidyName(m[1])) return tidyName(m[1]); }
  const first = ls[0] || '';
  if (!first || /^(?:step\s+)?\d+[.):]\s/i.test(first) || /^[-*•]\s/.test(first) || /[.!?]$/.test(first) && first.split(/\s+/).length > 6) return '';
  if (/^(purpose|owner|scope|revision|trigger)\s*:/i.test(first)) return '';
  return tidyName(first);
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

/* R8: one plain line of what the reader pulled out of the text: steps, choices, time limits, waits, systems, who. */
function foundSummary(d) {
  const all = targets(d.nodes);
  const steps = allSteps(d.nodes, []);
  const n = (k, one, many) => k ? `${k} ${k === 1 ? one : many}` : '';
  const slas = all.filter(x => x.sla).length;
  const waits = all.filter(x => x.type === 'wait').length;
  const choices = all.filter(x => x.type === 'decision').length;
  const systems = [...new Set(all.map(x => x.system).filter(Boolean))];
  const roles = [...new Set(steps.filter(x => !x.owner && x.ownerRole).map(x => x.ownerRole))];
  const bits = [n(steps.length, 'step', 'steps'), n(choices, 'choice', 'choices'), n(slas, 'time limit', 'time limits'), n(waits, 'wait', 'waits'),
    systems.length ? `${n(systems.length, 'system', 'systems')} (${systems.join(', ')})` : ''].filter(Boolean);
  const last = bits.length > 1 ? bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1] : bits[0] || 'no steps';
  return `<div class="is-found" data-found><b>We found ${esc(last)}.</b>${roles.length ? ` <span>Who does them: ${roles.map(esc).join(', ')}.</span>` : ''}</div>`;
}

/* ---------- render ---------- */
function dataPicker(s, path) {
  const des = store.list('dataElement');
  const open = ui.openData === path;
  return `<details class="is-data" data-dpath="${esc(path)}" ${open ? 'open' : ''}><summary>Information${s.data.length ? ` (${s.data.length})` : ''}</summary><div class="is-pop">${des.map(x => `<label><input type="checkbox" data-f="data" value="${esc(x.id)}" ${s.data.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('') || '<span class="hint">No information in this workspace yet.</span>'}</div></details>`;
}
function ownerSel(s) {
  return `<select data-f="owner" aria-label="Owner" class="${s.owner ? '' : 'is-noowner'}" ${s.owner ? '' : 'data-noowner'}><option value="">Choose an owner…</option>${store.state.people.map(p => `<option value="${esc(p.id)}" ${p.id === s.owner ? 'selected' : ''}>${esc(p.name)} — ${esc(p.role)}</option>`).join('')}</select>`;
}
function dataChips(s) {
  const linked = s.data.map(id => `<span class="chip">${esc((store.get('dataElement', id) || {}).name || id)}</span>`);
  const proposed = ui.draft.newData.filter(x => x.create && !x.exists && x.target === s.src).map(x => `<span class="chip is-newchip" data-newchip>+ ${esc(x.name)}</span>`);
  return linked.length || proposed.length ? `<div class="chips">${linked.concat(proposed).join('')}</div>` : '';
}
/* Simple: "Who does it" is one box: a person's name or a free-text role ("Manager"). */
function whoInput(s) {
  const v = s.owner ? pname(s.owner) : s.ownerRole || '';
  return `<input class="is-who ${s.owner || s.ownerRole ? '' : 'is-noowner'}" data-f="who" list="is-people" value="${esc(v)}" placeholder="Who does it? e.g. Manager" aria-label="Who does it" ${s.owner || s.ownerRole ? '' : 'data-noowner'}>`;
}
const roleChip = s => !s.owner && s.ownerRole ? `<span class="chip is-role" data-owner-role="${esc(s.ownerRole)}">Who: ${esc(s.ownerRole)}</span>` : '';
/* R8: what the reader found in the text for this step, in plain words: who, time limit, system. */
const factChips = s => {
  const out = [];
  if (!s.owner && s.ownerRole) out.push(roleChip(s));
  else if (s.owner) out.push(`<span class="chip is-role" data-owner-person="${esc(s.owner)}">Who: ${esc(pname(s.owner))}</span>`);
  if (s.sla) out.push(`<span class="chip is-fact" data-sla="${esc(s.sla)}">Time limit: ${esc(s.sla)}</span>`);
  if (s.system && !adv()) out.push(`<span class="chip is-fact" data-system="${esc(s.system)}">System: ${esc(s.system)}</span>`);
  if (s.note) out.push(`<span class="chip is-fact" data-step-note>${esc(s.note)}</span>`);
  return out.length ? `<div class="is-facts">${out.join('')}</div>` : '';
};
function stepBody(s, path, label) {
  return `<div class="is-body" data-path="${esc(path)}"><textarea class="is-title" data-f="title" rows="2" aria-label="${esc(label)} title">${esc(s.title)}</textarea>
    <div class="is-row">${adv() ? ownerSel(s) : whoInput(s)}${dataPicker(s, path)}${adv() ? `<input class="is-sys" data-f="system" value="${esc(s.system || '')}" placeholder="System" aria-label="System">` : ''}</div>${factChips(s)}${dataChips(s)}
    ${(s.subs || []).length ? `<ol class="is-subs">${s.subs.map((sb, k) => `<li class="is-sub" data-path="${esc(path + '.s' + k)}"><textarea data-f="title" rows="${Math.min(4, Math.max(1, Math.ceil(sb.title.length / 60)))}" class="is-subt" aria-label="Detail step ${k + 1}">${esc(sb.title)}</textarea><button class="btn sm is-x" data-rm-path="${esc(path + '.s' + k)}" aria-label="Remove detail step">✕</button></li>`).join('')}</ol>` : ''}
    <div><button class="btn sm is-link" data-add-sub="${esc(path)}">+ Detail step</button></div></div>`;
}
/* R6: wait / message / sub-process nodes */
function kindBody(s, path) {
  const k = KINDS[s.type];
  const procs = store.list('process');
  const extra = s.type === 'wait' ? `<label class="is-waitl">Waits for <input class="is-sys is-wait" data-f="wait" value="${esc(s.wait || s.duration || '')}" placeholder="e.g. 2 business days, or the supplier quotes" aria-label="What it waits for"></label>`
    : s.type === 'message' ? `<select data-f="direction" aria-label="Direction"><option value="send" ${s.direction !== 'receive' ? 'selected' : ''}>Send to</option><option value="receive" ${s.direction === 'receive' ? 'selected' : ''}>Receive from</option></select><input class="is-sys" data-f="party" value="${esc(s.party || '')}" placeholder="External party, e.g. Vendor" aria-label="External party">`
    : `<select data-f="calls" aria-label="Process it calls"><option value="">Choose the process it calls…</option>${procs.map(p => `<option value="${esc(p.id)}" ${p.id === (s.calls || s.processId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
  return `<div class="is-body is-kind" data-path="${esc(path)}" data-kind="${esc(s.type)}"><div class="is-gate-h"><span class="is-kicon" aria-hidden="true">${k.icon}</span><span class="is-kind">${k.label}</span></div>
    <textarea class="is-title" data-f="title" rows="2" aria-label="${k.label} title">${esc(s.title)}</textarea>
    <div class="is-row">${extra}${s.type === 'message' ? ownerSel(s) : ''}</div>${dataChips(s)}</div>`;
}
/* Loop-back (goto): the branch returns to an earlier node. Rendered as a return arrow with a picker. */
/* R9 §9: steps are numbered 1..N in order; choices are not steps and take no number */
const stepNo = n => { const tops = ui.draft.nodes.filter(x => x.type === 'step'); const k = tops.indexOf(n); return k >= 0 ? k + 1 : 0; };
function gotoRow(g, b, bpath) {
  const all = targets(ui.draft.nodes).filter(n => n !== g && n.type !== 'end' && !b.nodes.includes(n));
  const t = b.goto && all.find(n => n.src === b.goto);
  const ends = b.nodes.some(n => n.type === 'end');
  const num = n => stepNo(n) ? `Step ${stepNo(n)}` : ui.draft.nodes.includes(n) ? (KINDS[n.type] ? KINDS[n.type].label : 'Choice') : 'Branch step';
  /* "otherwise skip to step 4" jumps forward; "return to step 1" goes back */
  const fwd = t && ui.draft.nodes.indexOf(t) > ui.draft.nodes.indexOf(g);
  /* R9 §11: plain choices for where the path goes next: carry on, end here, or jump to a step */
  return `<div class="is-goto ${t ? 'on' : ''}" ${t ? `data-loopback="${esc(t.title)}"` : ''}>${t ? `<span class="is-ret" aria-hidden="true">${fwd ? '↷' : '↩'}</span><span>${fwd ? 'Skips to' : 'Goes back to'} <b>${esc(num(t))}: ${esc(t.title.slice(0, 60))}</b></span>` : ''}
    <select data-goto="${esc(bpath)}" aria-label="Then"><option value="" ${!t && !ends ? 'selected' : ''}>Then: carry on to the next step</option><option value="__end" ${ends && !t ? 'selected' : ''}>Then: ends here</option>${all.map(n => `<option value="${esc(n.src)}" ${t === n ? 'selected' : ''}>Then: ${ui.draft.nodes.indexOf(n) > ui.draft.nodes.indexOf(g) ? 'skip to' : 'go back to'} ${esc(num(n))}: ${esc(n.title.slice(0, 50))}</option>`).join('')}</select></div>`;
}
/* a path that stops the process: "Ends here: Stop: request rejected" */
const endBody = (s, path) => `<div class="is-end" data-end-node data-path-end="${esc(path)}"><span class="is-endic" aria-hidden="true">■</span><span><b>Ends here</b>${s.title && !/^stop$/i.test(s.title) ? ` · ${esc(s.title.replace(/^Stop:\s*/i, ''))}` : ''}</span></div>`;
function branchHint(g, b) {
  const n = b.nodes.filter(x => x.type !== 'end').length, ends = b.nodes.some(x => x.type === 'end');
  const bits = [];
  if (n) bits.push(`${n} step${n === 1 ? '' : 's'}`);
  if (ends) bits.push('then ends here');
  else if (b.goto) bits.push(targets(ui.draft.nodes).findIndex(x => x.src === b.goto) > ui.draft.nodes.indexOf(g) ? 'then skips ahead' : 'then goes back');
  else if (!n) bits.push(g.type === 'parallel' ? 'no steps yet' : 'carries on to the next step');
  return esc(bits.join(', '));
}
function gateBody(g, path) {
  return `<div class="is-body is-gate" data-path="${esc(path)}"><div class="is-gate-h"><span class="is-diamond" aria-hidden="true">◆</span><span class="is-kind">${g.type === 'parallel' ? 'At the same time: every path runs' : 'Choice'}</span></div>
    <textarea class="is-title" data-f="title" rows="2" aria-label="${g.type === 'parallel' ? 'Things done at the same time' : 'Choice question'}">${esc(g.title)}</textarea>
    <div class="is-branches">${g.branches.map((b, j) => `<div class="is-branch" data-branch="${esc(path + '.b' + j)}">
      <div class="is-branch-h"><input class="is-blabel" data-blabel="${esc(path + '.b' + j)}" value="${esc(b.label)}" aria-label="Path label"><span class="hint" data-branch-hint>${branchHint(g, b)}</span></div>
      ${b.nodes.map((s, k) => s.type === 'end' ? endBody(s, `${path}.b${j}.${k}`) : `<div class="is-bstep">${KINDS[s.type] ? kindBody(s, `${path}.b${j}.${k}`) : stepBody(s, `${path}.b${j}.${k}`, 'Branch step')}<button class="btn sm danger is-x" data-rm-path="${esc(`${path}.b${j}.${k}`)}" aria-label="Remove branch step">✕</button></div>`).join('')}
      ${g.type === 'decision' ? gotoRow(g, b, path + '.b' + j) : ''}
      <button class="btn sm is-link" data-add-bstep="${esc(path + '.b' + j)}">+ Step in “${esc(b.label)}”</button></div>`).join('')}</div></div>`;
}

export function render() {
  const d = ui.draft;
  const n = d ? countSteps(d.nodes) : 0;
  const gates = d ? d.nodes.filter(x => x.type === 'decision').length : 0;
  const pars = d ? d.nodes.filter(x => x.type === 'parallel').length : 0;
  const newData = d ? d.newData : [];
  if (d) newData.forEach(x => { if (!x.target || !targets(d.nodes).some(n => n.src === x.target)) x.target = targetOf(d.nodes, x); });
  const tgtTxt = src => { if (!d) return ''; const all = targets(d.nodes); const t = all.find(n => n.src === src); if (!t) return ''; return `${stepNo(t) ? 'Step ' + stepNo(t) : 'Branch step'}: ${t.title.slice(0, 60)}`; };
  /* R9 §8: new information is owned by whoever does its step (a person or a role), shown before saving */
  const ownTxt = src => { const t = d && targets(d.nodes).find(n => n.src === src); return t && t.owner ? pname(t.owner) : t && t.ownerRole ? t.ownerRole : 'whoever does the step'; };
  const kinds = d ? targets(d.nodes).filter(x => KINDS[x.type]).length : 0;
  const noOwner = d ? allSteps(d.nodes, []).filter(x => !x.owner && !x.ownerRole).length : 0;
  const loops = d ? d.nodes.reduce((n, g) => n + (g.branches || []).filter(b => b.goto).length, 0) : 0;
  const found = d ? foundSummary(d) : '';
  const nd = newData.length ? `<div class="is-newdata" data-newdata><h4>New information this procedure needs</h4>
      <p class="hint">We found information the procedure needs that isn't in your workspace yet. Each ticked one is added to the step shown, and whoever does that step looks after it.</p>
      ${newData.map((x, i) => `<label class="is-nd ${x.exists ? 'dup' : ''}" data-nd="${i}"><input type="checkbox" data-nd-create="${i}" ${x.create ? 'checked' : ''} ${x.exists ? 'disabled' : ''}>
        <span><input class="is-nd-name" data-nd-name="${i}" value="${esc(x.name)}" aria-label="New information name" ${x.exists ? 'disabled' : ''}>${x.reason ? `<small>${esc(plainNote(x.reason))}</small>` : ''}${x.exists ? '<small class="is-dupmsg">Already exists: not created again.</small>' : x.target ? `<small class="is-ndtgt" data-nd-target>Adds to ${esc(tgtTxt(x.target))}</small><small class="is-ndown" data-nd-owner="${esc(ownTxt(x.target))}">Owner: ${esc(ownTxt(x.target))}</small>` : ''}</span></label>`).join('')}</div>` : '';

  const draftHtml = d ? `<div class="card is-draft"><h3>Your process, ready to check${adv() ? `<span class="is-src ${ui.source === 'AI' ? 'ai' : 'rules'}">${esc(ui.source)}</span>` : ''}<span class="n">${n} steps${gates ? ` · ${gates} choice${gates === 1 ? '' : 's'}` : ''}${pars ? ` · ${pars} at the same time` : ''}${kinds ? ` · ${kinds} wait/message` : ''}</span></h3>
    ${found}
    ${notesShown().length ? `<div class="note is-notes"><b>Things to check</b><ul>${notesShown().map(x => `<li>${esc(plainNote(x))}</li>`).join('')}</ul></div>` : ''}
    ${noOwner ? `<div class="is-ownerprompt" data-owner-prompt><b>${noOwner} step${noOwner === 1 ? '' : 's'} need${noOwner === 1 ? 's' : ''} someone to do ${noOwner === 1 ? 'it' : 'them'}.</b> The procedure didn't say who, so we left it blank rather than guess. Type a name or a role (like “Manager”) in each highlighted box.</div>` : ''}
    ${loops ? `<div class="hint" data-loops>${loops} path${loops === 1 ? '' : 's'} that jump${loops === 1 ? 's' : ''} to another step (“return to step N”, “skip to step N”). They're drawn as arrows on the map.</div>` : ''}
    <div class="is-trig" data-trigger><span class="chip">What starts it</span> ${esc(d.trigger || 'Process starts')}</div>
    <ol class="is-steps">${d.nodes.map((s, i) => `<li class="is-step ${s.type !== 'step' ? 'gate' : ''}" data-i="${i}" data-type="${esc(s.type)}">
      <span class="is-n" ${s.type === 'step' ? '' : 'aria-hidden="true"'}>${s.type === 'step' ? stepNo(s) : KINDS[s.type] ? KINDS[s.type].icon : ''}</span>
      ${s.type === 'step' ? stepBody(s, String(i), 'Step ' + stepNo(s)) : KINDS[s.type] ? kindBody(s, String(i)) : gateBody(s, String(i))}
      <div class="is-ctl"><button class="btn sm" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="btn sm" data-mv="1" ${i === d.nodes.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button><button class="btn sm danger" data-rm aria-label="Remove">✕</button></div></li>`).join('')}</ol>
    ${nd}
    <div class="is-foot"><button class="btn sm" data-add-step>+ Add step</button><button class="btn sm" data-add-gate>+ Add choice</button>${adv() ? '<button class="btn sm" data-add-par>+ Add “at the same time”</button>' : ''}<button class="btn primary" data-create ${d.nodes.length ? '' : 'disabled'}>Save as how it works today</button></div></div>` : '';

  return `<datalist id="is-people">${store.state.people.map(p => `<option value="${esc(p.name)}"></option>`).join('')}</datalist><section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> · Paste a procedure</div>
      <h1>Paste a procedure you already have</h1><p>Paste your written steps. We turn them into a process map: the steps, who does each one, and the information each step needs. You check every step before anything is saved.</p></div>
    <div class="hdr-side"><a class="btn" href="${link('/new')}" data-link>Start from blank</a></div></section>
    <div class="is-grid ${d ? 'has-draft' : ''}">
      <div class="card"><h3>Your procedure</h3>
        <div class="field"><textarea class="is-text" data-sop aria-label="Your procedure" placeholder="Paste your procedure here. Numbered steps work best.">${esc(ui.text)}</textarea></div>
        <div class="is-foot"><button class="btn sm" data-sample>Try a sample</button><span class="hint">${ui.text.length.toLocaleString()} characters</span>
          <button class="btn primary" data-draft ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Reading your steps…' : 'Turn into a process'}</button></div>
        <div class="hint" style="margin-top:8px">${adv() ? 'The text is sent to the in-tenant AI endpoint and is not stored. Without AI, a rules parser drafts the steps. Data is linked only on a strong name match; anything else is proposed as new data.' : 'Your text is read inside your own organisation’s systems and is not kept.'}</div></div>
      ${draftHtml || `<div class="card is-empty"><div class="empty">Your steps appear here, one card per step, ready for you to check.</div></div>`}
    </div>`;
}

/* Copy every edited input back into the draft model. */
function readDraft(root) {
  if (!ui.draft) return;
  root.querySelectorAll('[data-path]').forEach(el => {
    const node = at(el.dataset.path); if (!node) return;
    const own = sel => [...el.querySelectorAll(sel)].filter(x => x.closest('[data-path]') === el);
    const t = own('[data-f=title]')[0]; if (t) node.title = t.value;
    const o = own('[data-f=owner]')[0]; if (o) { node.owner = o.value; if (o.value) node.ownerRole = ''; }
    const w = own('[data-f=who]')[0];
    if (w) { const v = w.value.trim(); const hit = store.state.people.find(p => p.name.toLowerCase() === v.toLowerCase()); node.owner = hit ? hit.id : ''; node.ownerRole = hit ? '' : capRole(v); }
    const sy = own('[data-f=system]')[0]; if (sy) node.system = sy.value.trim();
    ['wait', 'direction', 'party', 'calls'].forEach(k => { const x = own(`[data-f=${k}]`)[0]; if (x) node[k] = x.value.trim(); });
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
    if (!ui.text.trim()) { toast('Paste your procedure or try the sample first.'); return; }
    ui.busy = true; store.emit();
    try {
      const res = await store.api('/ai/sop-import', { text: ui.text });
      const n = normalize(res);
      ui.draft = { nodes: n.nodes, newData: n.newData, name: n.name || '', trigger: n.trigger || '' };
      ui.source = n.source; ui.notes = n.notes;
      toast(`Found ${countSteps(n.nodes)} steps`);
    } catch (e) { toast('Could not draft: ' + e.message); }
    finally { ui.busy = false; store.emit(); }
  };
  if (!ui.draft) return;
  root.querySelectorAll('.is-step').forEach(li => {
    const i = +li.dataset.i;
    li.querySelectorAll(':scope > .is-ctl [data-mv]').forEach(b => b.onclick = () => { readDraft(root); const j = i + +b.dataset.mv; const a = ui.draft.nodes; [a[i], a[j]] = [a[j], a[i]]; store.emit(); });
    li.querySelector(':scope > .is-ctl [data-rm]').onclick = () => { readDraft(root); ui.draft.nodes.splice(i, 1); store.emit(); };
  });
  root.querySelectorAll('[data-goto]').forEach(el => el.onchange = () => { readDraft(root); const [p, j] = el.dataset.goto.split(/\.b(?=\d+$)/); const br = at(p).branches[+j];
    const keepEnd = br.nodes.find(n => n.type === 'end');
    br.nodes = br.nodes.filter(n => n.type !== 'end'); delete br.goto;
    if (el.value === '__end') br.nodes.push(keepEnd || endNode('Stop'));
    else if (el.value) br.goto = el.value;
    store.emit(); });
  root.querySelectorAll('[data-f=owner],[data-f=who],[data-f=data],[data-nd-create]').forEach(el => el.onchange = () => { if (el.dataset.f === 'data') ui.openData = el.closest('[data-dpath]').dataset.dpath; rerender(); });
  root.querySelectorAll('[data-f=title],[data-f=system],[data-f=wait],[data-f=party],[data-blabel],[data-nd-name]').forEach(el => el.oninput = () => readDraft(root));
  root.querySelectorAll('[data-f=direction],[data-f=calls]').forEach(el => el.onchange = () => readDraft(root));
  root.querySelectorAll('[data-dpath]').forEach(det => det.addEventListener('toggle', () => { if (det.open) ui.openData = det.dataset.dpath; else if (ui.openData === det.dataset.dpath) ui.openData = null; }));
  root.querySelectorAll('[data-rm-path]').forEach(b => b.onclick = () => { readDraft(root); removeAt(b.dataset.rmPath); store.emit(); });
  root.querySelectorAll('[data-add-sub]').forEach(b => b.onclick = () => { readDraft(root); const s = at(b.dataset.addSub); (s.subs = s.subs || []).push({ title: 'New detail step', data: [] }); store.emit(); });
  root.querySelectorAll('[data-add-bstep]').forEach(b => b.onclick = () => { readDraft(root); const [p, j] = b.dataset.addBstep.split(/\.b(?=\d+$)/); at(p).branches[+j].nodes.push({ type: 'step', src: srcId({}), title: 'New step', owner: '', data: [], touches: [], subs: [], newData: [] }); store.emit(); });
  const add = root.querySelector('[data-add-step]'); if (add) add.onclick = () => { readDraft(root); ui.draft.nodes.push({ type: 'step', src: srcId({}), title: 'New step', owner: '', data: [], touches: [], subs: [], newData: [] }); store.emit(); };
  const ag = root.querySelector('[data-add-gate]'); if (ag) ag.onclick = () => { readDraft(root); ui.draft.nodes.push({ type: 'decision', src: srcId({}), title: 'Condition met?', branches: [{ label: 'Yes', nodes: [] }, { label: 'No', nodes: [] }] }); store.emit(); };
  const ap = root.querySelector('[data-add-par]'); if (ap) ap.onclick = () => { readDraft(root); ui.draft.nodes.push({ type: 'parallel', src: srcId({}), title: 'Do these at the same time', branches: [{ label: 'Branch A', nodes: [] }, { label: 'Branch B', nodes: [] }] }); store.emit(); };
  const cr = root.querySelector('[data-create]'); if (cr) cr.onclick = () => { readDraft(root); createProcess(); };
}

function allSteps(nodes, out) { (nodes || []).forEach(n => { if (n.type === 'step') out.push(n); else (n.branches || []).forEach(b => allSteps(b.nodes, out)); }); return out; }

async function createProcess() {
  const d = ui.draft; if (!d) return;
  const nodes = d.nodes.filter(n => String(n.title || '').trim());
  if (!countSteps(nodes) && !nodes.length) { toast('There are no steps yet.'); return; }

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

  /* R9 §9 (B2): a name the reader gave is used only if it is not a step; otherwise it is derived from the title line.
     If nothing can be derived the name is left empty, focused, and required. */
  const steps = allSteps(nodes, []);
  const given = cleanTitle(d.name || '');
  const isStepText = t => !t || /^(?:step\s+)?\d+[.):]\s/i.test(t) || steps.some(x => strip(x.title) === strip(t)) || numberedLines(ui.text).some(l => strip(l.body).startsWith(strip(t)));
  let nameVal = !isStepText(given) ? given : deriveName(ui.text), err = '', descVal = 'From a pasted procedure. ' + steps.length + ' step' + (steps.length === 1 ? '' : 's') + '.', trigVal = d.trigger || '';
  let r;
  for (;;) {
    const pr = modal({
      title: 'Save as how it works today',
      body: `${err ? `<div class="banner d-err" role="alert" data-name-err>${esc(err)}</div>` : ''}<div class="field"><label for="is-pname">Name</label><input id="is-pname" name="name" value="${esc(nameVal.slice(0, 80))}" placeholder="Name this process, e.g. Employee offboarding" data-pname></div>
      <div class="field"><label>Description</label><textarea name="desc">${esc(descVal)}</textarea></div>
      <div class="field"><label>What starts it</label><input name="trigger" value="${esc(trigVal)}" placeholder="e.g. An employee submits a claim"></div>
      ${steps.some(x => !x.owner && !x.ownerRole) ? `<div class="is-ownerprompt" data-create-noowner>${steps.filter(x => !x.owner && !x.ownerRole).length} step${steps.filter(x => !x.owner && !x.ownerRole).length === 1 ? ' has' : 's have'} nobody doing it yet. You can save now and add who does it later; before launch every step needs someone.</div>` : ''}
      ${picks.length ? `<div class="hint" data-create-data="${picks.length}">Also creates ${picks.length} piece${picks.length === 1 ? '' : 's'} of information and adds each to its step: ${picks.map(x => esc(x.name.trim())).join(', ')}.</div>` : ''}
      <div class="hint">This opens on <b>Today</b>. When you open <b>Future</b>, it starts as a copy you can change.</div>`,
      actions: [{ id: 'create', label: 'Save as how it works today', primary: true }],
    });
    const mm = [...document.querySelectorAll('.overlay .modal')].pop();
    const ni = mm && mm.querySelector('[data-pname]'); if (ni && !ni.value) setTimeout(() => ni.focus(), 0);
    r = await pr;
    if (r.action !== 'create') return;
    if (cleanTitle(r.form.name)) break;
    nameVal = ''; descVal = r.form.desc || ''; trigVal = r.form.trigger || ''; err = 'Give the process a name.';
  }
  const name = cleanTitle(r.form.name);

  /* 1. create the ticked data elements, remembering name -> id for linking */
  const made = new Map();
  try {
    for (const x of picks) {
      const id = store.newId('D');
      /* R8: the owner is whoever does the step it belongs to (a person, or the role as text), never the importer */
      const st = targets(nodes).find(n => n.src === (x.target || targetOf(nodes, x))) || {};
      const own = st.owner ? { owner: st.owner } : st.ownerRole ? { owner: '', ownerRole: st.ownerRole } : { owner: '' };
      /* information the procedure already uses today: "We have it" (R8 §1), described, not blocked */
      await store.save('dataElement', id, Object.assign({ id, name: cleanTitle(x.name) }, own, { source: 'From a pasted procedure', avail: 'live', note: x.reason ? plainNote(x.reason) : `Used by the “${name}” process.`, fields: [], samples: [], discovered: [] }),
        `Created information “${cleanTitle(x.name)}” from a pasted procedure`);
      made.set(strip(x.name), id);
    }
  } catch (e) { toast('Could not create data: ' + e.message); return; }
  /* every created element is added to the data requirements of the step shown next to it in the draft */
  picks.forEach(x => {
    const id = made.get(strip(x.name)); if (!id) return;
    let t = x.target && targets(nodes).find(n => n.src === x.target && Array.isArray(n.data));
    if (!t) { const src = targetOf(nodes, x); t = targets(nodes).find(n => n.src === src); }
    if (t && !t.data.includes(id)) t.data.push(id);
  });

  /* 2. build the as-is tree with fresh ids, then the to-be copy with `from` links */
  const nid = () => store.newId('n');
  const idOf = new Map();
  const mkStep = s => {
    if (s.type === 'end') return { id: nid(), type: 'end', title: cleanTitle(s.title) || 'Stop' };
    const extra = (s.newData || []).map(n => made.get(strip(n))).filter(Boolean);
    const node = { id: nid(), type: KINDS[s.type] ? s.type : 'step', title: cleanTitle(s.title), data: [...new Set((s.data || []).concat(extra))], touches: (s.touches || []).slice() };
    if (s.type === 'wait' && s.wait) node.wait = s.wait;
    if (s.type === 'message') { node.direction = s.direction === 'receive' ? 'receive' : 'send'; if (s.party) node.party = s.party; }
    if (s.type === 'subprocess' && s.calls) node.calls = s.calls;
    if (s.src) idOf.set(s.src, node.id);
    if (s.owner) node.owner = s.owner;
    else if (s.ownerRole) node.ownerRole = s.ownerRole;
    if (s.system) node.system = s.system;
    if (s.sla) node.sla = s.sla;
    if (s.note) node.note = s.note;
    const subs = (s.subs || []).filter(x => String(x.title || '').trim()).map(x => ({ title: x.title.trim(), data: (x.data || []).slice() }));
    if (subs.length) node.subs = subs;
    return node;
  };
  const mk = n => { if (n.type === 'step' || KINDS[n.type]) return mkStep(n);
    const g = { id: nid(), type: n.type, title: cleanTitle(n.title) || 'Decision', branches: n.branches.map(b => { const br = { label: (b.label || '').trim() || 'Branch', nodes: b.nodes.filter(s => s.type === 'end' || String(s.title || '').trim()).map(mkStep) }; if (b.goto) br._goto = b.goto; return br; }) };
    if (n.src) idOf.set(n.src, g.id); return g; };
  const asis = [{ id: nid(), type: 'trigger', title: ((r.form.trigger || '').trim() || 'Process starts'), touches: [] }].concat(nodes.map(mk)).concat([{ id: nid(), type: 'end', title: 'Done' }]);
  /* loop-backs: point each branch at the new id of its target; drop targets that were removed from the draft */
  asis.forEach(n => (n.branches || []).forEach(b => { if (b._goto) { const t = idOf.get(b._goto); if (t) b.goto = t; delete b._goto; } }));
  /* R8: saved as Today only; the Future version is made from Today the first time someone opens Future */
  const tobe = [];
  const pid = store.newId('proc');
  const resources = [...new Set(steps.map(s => s.owner).filter(Boolean))];
  try {
    await store.save('process', pid, { id: pid, name, desc: (r.form.desc || '').trim(), owner: store.state.me, resources, version: 1, asis, tobe, released: [] },
      `Created process “${name}” from a pasted procedure (${steps.length} steps${made.size ? `, ${made.size} new piece${made.size === 1 ? '' : 's'} of information` : ''})`);
  } catch (e) { toast('Could not create: ' + e.message); return; }
  ui.draft = null; ui.text = ''; ui.notes = []; ui.source = null; ui.openData = null;
  toast('Saved as how it works today');
  go(`/process/${pid}?mode=asis`);
}
