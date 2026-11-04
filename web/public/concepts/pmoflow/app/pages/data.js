/* Data element detail (stream D): /data/:did — header, spec editor, resolution plan, impact, profile, discovered requirements. */
import { store } from '../store.js';
import { esc, fmt, fmtTime, link, av, personChip, pname, AVAIL, LOCK, modal, toast, activityCard, bindActivity } from '../ui.js';
import { eng, docs, today, flat, projectsFor, workBadge, stepBadge, notFound, confirmBox, dupDataName, effAvail, effDot, humanPat, NEEDS_LIVE, avOf, awaitingText } from './process.js';

const clone = o => JSON.parse(JSON.stringify(o));
const personOpts = sel => store.state.people.map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)} — ${esc(x.role || '')}</option>`).join('');
/* "Live" is set only through Confirm live (data owner, with a source); the edit dialog offers it only when already live */
const availOpts = sel => Object.entries(AVAIL).filter(([k]) => k !== 'pending' && (k !== 'live' || sel === 'live')).map(([k, a]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(a.label)}</option>`).join('');

export const SENS = { public: { label: 'Public', cls: 'd-s-public' }, internal: { label: 'Internal', cls: 'd-s-internal' }, confidential: { label: 'Confidential', cls: 'd-s-conf' }, pii: { label: 'PII', cls: 'd-s-pii' } };
export const sensBadge = k => { const v = SENS[k]; return v ? `<span class="badge d-sens ${v.cls}" title="Sensitivity: ${esc(v.label)}">${esc(v.label)}</span>` : '<span class="badge b-none" title="Sensitivity not classified">Unclassified</span>'; };
const canEdit = x => !!x && store.state.me === x.owner;
const onlyMsg = x => `Only ${pname(x.owner)} can change this`;
/* disabled-state attributes for owner-only controls */
const gate = x => canEdit(x) ? '' : `disabled aria-disabled="true" title="${esc(onlyMsg(x))}"`;
function ruleText(f) {
  const r = [];
  if (f.required) r.push('Required');
  if ((f.values || []).length) r.push('one of ' + f.values.join(' / '));
  if (f.matches) r.push('Must match ' + f.matches);
  if (f.rule) String(f.rule).split(/\s*[·;]\s*/).forEach(x => x && r.push(x));
  /* de-duplicate case-insensitively: a rule of "Required" plus required:true reads once */
  const seen = new Set();
  return r.filter(x => { const k = String(x).trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).join(' · ') || '—';
}
/* plain-English headline for each spec-drift issue key */
const DRIFT = { 'missing-column': 'not found in the extract', 'required-nulls': 'required but sometimes empty', 'length-mismatch': 'length differs from the spec', 'non-digit': 'has characters that are not digits',
  'unexpected-specials': 'has unexpected characters', 'type-mismatch': 'values are not the expected type', 'out-of-range': 'values outside the allowed range', 'pattern-mismatch': 'format differs from the spec' };
const driftTitle = d => DRIFT[d.issue] || String(d.issue || 'differs from the spec').replace(/[-_]+/g, ' ');
/* the engine writes plain English; any raw shape code left in a message (e.g. 9{8}) is humanized here as a safety net */
const plainDetail = t => String(t || '').replace(/\b[9Aax]+(?:\{\d+\})?(?:[ \-./@]?[9Aax]+(?:\{\d+\})?)*/g, m => /\{\d+\}/.test(m) ? humanPat(m) : m);

export function render(params) {
  const did = params.did;
  const x = store.get('dataElement', did);
  if (!x) return notFound('Data element “' + did + '”');
  const eff = effAvail(did), a = avOf(eff);
  const users = eng('impactOfData', [docs(), did], []).map(u => { const p = store.get('process', u.pid); const s = p && flat(p.tobe).find(y => y.id === u.stepId); return s ? { pid: u.pid, p, s } : null; }).filter(Boolean);
  const fc = eng('forecastAll', [docs(), today()], {});
  const resolver = store.list('workItem', w => w.resolves === did)[0];
  const downstream = resolver ? eng('dependents', [docs(), resolver.id], []).map(id => store.get('workItem', id)).filter(Boolean) : [];
  const ready = eff === 'live';
  const usingProjects = [...new Set(users.map(u => u.pid))].flatMap(pid => projectsFor(pid));
  const testPrj = usingProjects[0];
  const profile = store.list('profile', p => p.dataId === did).sort((p, q) => String(q.at).localeCompare(String(p.at)))[0];
  const drift = profile ? eng('specDrift', [x, profile], []) : [];
  const fields = x.fields || [];

  const amber = eff === 'example' || eff === 'pending';
  const resolution = (eff !== 'live' || resolver) ? `<div class="card d-resolve ${ready ? '' : amber ? 'd-resolve-amber' : 'd-resolve-open'}" style="margin-top:16px" data-resolution="${eff}"><h3>${LOCK} Resolution plan ${ready ? '<span class="badge b-done">Ready</span>' : eff === 'pending' ? `<span class="badge d-b-amber">${esc(awaitingText(did))}</span>` : eff === 'example' ? `<span class="badge d-b-amber">${NEEDS_LIVE}</span>` : ''}</h3>
    ${resolver ? `<a class="wi" href="${link('/project/' + resolver.projectId + '?mode=work')}" data-link>${av(resolver.owner)}<div style="flex:1;min-width:0"><div class="t" style="font-weight:600">${esc(resolver.title)}</div><div class="dep">${esc(pname(resolver.owner))} · planned ${esc(fmt(resolver.start))} → ${esc(fmt(resolver.due))}${fc[resolver.id] && fc[resolver.id].forecast ? ' · forecast ' + esc(fmt(fc[resolver.id].forecast)) : ''}</div></div>${workBadge(resolver, fc[resolver.id])}</a>
      ${downstream.length ? `<div class="hint" style="margin:10px 0 4px">These work items move with it:</div>${downstream.map(w => `<div class="row click" data-go="/process/${esc(w.pid)}/step/${esc(w.step)}"><div><div class="t">${esc(w.title)}</div><div class="s">${esc((store.get('process', w.pid) || {}).name || w.pid)} · ${esc(pname(w.owner))}</div></div><div class="r">${workBadge(w, fc[w.id])}</div></div>`).join('')}` : '<div class="hint" style="margin-top:8px">No other work items depend on it.</div>'}`
      : eff === 'example' ? `<div class="s d-noplan d-noplan-amber" data-noplan>No resolution plan. Only examples exist, so the go-live gate's live-data check fails until a work item connects a live source. Add a resolver work item on the project page.</div>`
      : '<div class="s d-noplan" data-noplan>No resolution plan. No work item resolves this yet, so every step that needs it has no real date. Add a resolver work item on the project page.</div>'}</div>` : '';

  /* R4: only the data owner's confirmation (with a source) makes a fixed element live */
  const confirmedBy = x.liveConfirmedBy ? `Confirmed live by ${esc(pname(x.liveConfirmedBy))}${x.liveConfirmedAt ? ' · ' + esc(fmtTime(x.liveConfirmedAt)) : ''}${x.liveSource ? ' · source: ' + esc(x.liveSource) : ''}` : '';
  const confirm = eff === 'live'
    ? (confirmedBy ? `<div class="d-confirmed" data-confirmed>✓ ${confirmedBy}</div>` : '')
    : `<div class="card d-confirm ${eff === 'pending' ? 'd-confirm-due' : ''}" data-confirm-card style="margin-top:16px"><h3>Confirm live</h3>
      <p class="s" style="margin:0 0 10px">${eff === 'pending' ? `The resolver work is done. ${esc(pname(x.owner))}, as the data owner, confirms the live source before the go-live gate counts it.` : `When a live source is connected, the data owner confirms it here. Until then the go-live gate's live-data check fails.`}</p>
      <div class="d-ownerrow" style="margin-top:0"><button class="btn ${eff === 'pending' ? 'primary' : ''}" data-confirm-live ${gate(x)}>Confirm live…</button>${canEdit(x) ? '' : `<span class="d-only">${LOCK} Only ${esc(pname(x.owner))} (data owner) can confirm</span>`}</div></div>`;

  const spec = `<div class="card"><h3>Specification <span class="n">${fields.length} field${fields.length === 1 ? '' : 's'}</span></h3>
    ${fields.length ? `<div class="tbl-wrap"><table class="d-spec"><tr><th>Field</th><th>Format</th><th>Rules</th><th><span class="d-sr">Actions</span></th></tr>${fields.map((f, i) => `<tr><td><b>${esc(f.name)}</b></td><td data-fsum>${esc(specSummary(f))}</td><td class="d-rule">${esc(ruleText(f))}</td>
      <td class="d-acts"><button class="btn sm" data-fedit="${i}" aria-label="Edit field ${esc(f.name)}" ${gate(x)}>Edit</button><button class="btn sm danger" data-fdel="${i}" aria-label="Delete field ${esc(f.name)}" ${gate(x)}>Delete</button></td></tr>`).join('')}</table></div>` : '<div class="s">No fields specified yet. Describe each field so test cases can be generated.</div>'}
    <div class="d-ownerrow"><button class="btn sm" data-fadd ${gate(x)}>+ Add field</button>${canEdit(x) ? '' : `<span class="d-only">${LOCK} ${esc(onlyMsg(x))}</span>`}</div></div>`;

  const examples = `<div class="card"><h3>Examples on file <span class="n">${(x.samples || []).length}</span></h3>${(x.samples || []).length ? x.samples.map(f => `<div class="row"><span>📄</span><div><div class="t">${esc(f)}</div><div class="s">Sample artifact (concept, not downloadable)</div></div></div>`).join('') : '<div class="s">None. Nobody has produced a real example of this data yet.</div>'}
    ${x.sampleCsv ? '<div class="hint" style="margin-top:8px">A synthetic sample extract is on file for profiling.</div>' : ''}</div>`;

  const impact = `<div class="card" style="margin-top:16px"><h3>Impact: every step that depends on this <span class="n">${users.length}</span></h3>${users.length ? `<div class="tbl-wrap"><table><tr><th>Step</th><th>Process</th><th>Owner</th><th>Project</th></tr>
    ${users.map(u => { const prj = projectsFor(u.pid)[0]; const st = prj ? eng('stepState', [docs(), prj.id, u.pid, u.s.id, today()], null) : null; return `<tr class="click" data-go="/process/${esc(u.pid)}/step/${esc(u.s.id)}"><td><a href="${link('/process/' + u.pid + '/step/' + u.s.id)}" data-link><b>${esc(u.s.title)}</b></a></td><td>${esc(u.p.name)}</td><td>${esc(pname(u.s.owner))}</td><td class="d-nowrap">${prj ? stepBadge(st) : '<span class="hint">No project</span>'}</td></tr>`; }).join('')}</table></div>` : '<div class="s">No to-be step uses this data element yet.</div>'}</div>`;

  const prof = `<div class="card" style="margin-top:16px"><h3>Latest profile ${profile ? `<span class="n">${esc(profile.rows)} rows · ${esc(fmtTime(profile.at))}</span>` : ''}</h3>
    ${profile ? `<div class="hint" style="margin:-4px 0 8px">Statistics only. Examples are masked: digits become 9, letters x/X, first and last character kept.</div>
      <div class="tbl-wrap"><table class="d-prof"><tr><th>Column</th><th>Nulls</th><th>Distinct</th><th>Length</th><th>Range</th><th>Top patterns</th><th>Masked examples</th></tr>${(profile.columns || []).map(c => `<tr><td><b>${esc(c.name)}</b>${(c.specials || []).length ? `<div class="hint">specials ${esc(c.specials.join(' '))}</div>` : ''}</td><td>${esc(c.nulls)}</td><td>${esc(c.distinct)}</td><td>${esc(c.minLen)}–${esc(c.maxLen)}</td><td>${c.min != null ? esc(c.min) + ' – ' + esc(c.max) : '—'}</td>
        <td>${(c.patterns || []).slice(0, 3).map(pt => `<span class="d-pat">${esc(humanPat(pt.pattern))}</span> <span class="hint">×${esc(pt.count)}</span>`).join('<br>') || '—'}</td><td>${(c.examples || []).slice(0, 3).map(e => `<code class="d-code">${esc(e)}</code>`).join(' ') || '—'}</td></tr>`).join('')}</table></div>
      <h3 style="margin-top:14px">Spec drift <span class="n">${drift.length}</span></h3>${drift.length ? drift.map(d => `<div class="row"><span class="fail" aria-hidden="true">●</span><div><div class="t">${esc(d.field)}: ${esc(driftTitle(d))}</div><div class="s">${esc(plainDetail(d.detail))}</div></div></div>`).join('') : '<div class="s pass">The profile matches the specification.</div>'}`
    : '<div class="s">No profile yet. Profiling computes column statistics from a sample extract and compares them with the specification.</div>'}
    ${testPrj ? `<div style="margin-top:10px"><a class="btn sm" href="${link('/testing/' + testPrj.id)}" data-link>Run profiling in ${esc(testPrj.name)} ›</a></div>` : '<div class="hint" style="margin-top:8px">Link a process that uses this data to a project to run profiling.</div>'}</div>`;

  const dlist = x.discovered || [], open = dlist.filter(d => !d.resolved).length;
  const disc = `<div class="card"><h3>Discovered requirements <span class="n">${open} open · ${dlist.length - open} resolved</span></h3>${dlist.length ? dlist.map((d, i) => `<div class="row d-disc ${d.resolved ? 'd-resolved' : ''}"><span aria-hidden="true">${d.resolved ? '✓' : '🔎'}</span><div style="flex:1;min-width:0"><div class="t">${esc(d.text)}</div><div class="s">${d.fromRun ? 'Found in test run ' + esc(d.fromRun) + ' · ' : ''}${esc(fmtTime(d.at))}</div>
      ${d.resolved ? `<div class="d-resnote"><b>Resolved</b> by ${esc(pname(d.resolved.by))} · ${esc(fmtTime(d.resolved.at))}${d.resolved.note ? ': ' + esc(d.resolved.note) : ''}</div>` : ''}</div>
      ${d.resolved ? '' : `<div class="r"><button class="btn sm" data-resolve="${i}" ${gate(x)}>Resolve</button></div>`}</div>`).join('') + (open && !canEdit(x) ? `<div class="d-only">${LOCK} ${esc(onlyMsg(x))}</div>` : '') : '<div class="s">Nothing discovered yet. Requirements found during testing land here.</div>'}</div>`;

  return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › Data element</div><h1>${esc(x.name)}</h1>${x.note ? `<p>${esc(x.note)}</p>` : ''}
    <div class="res"><span class="lbl">Owner</span>${personChip(x.owner) || '<span class="hint">None</span>'}<span class="chip">${esc(x.source || 'Source not set')}</span><span class="chip" data-eff="${eff}">${effDot(did)}${esc(a.label)}</span>${sensBadge(x.sensitivity)}</div>${eff === 'live' && confirmedBy ? `<div class="d-confirmed" data-confirmed>✓ ${confirmedBy}</div>` : ''}</div>
    <div class="hdr-side"><div class="d-ownerrow d-right">${canEdit(x) ? '' : `<span class="d-only">${LOCK} ${esc(onlyMsg(x))}</span>`}<button class="btn" data-dedit ${gate(x)}>Edit</button></div><div class="kpis"><div class="kpi"><b>${users.length}</b><span>Steps use it</span></div><div class="kpi"><b>${new Set(users.map(u => u.pid)).size}</b><span>Processes</span></div><div class="kpi"><b style="color:${downstream.length && !ready ? 'var(--late)' : 'inherit'}">${downstream.length}</b><span>Work items waiting</span></div></div></div></section>
  ${eff === 'live' ? '' : confirm}
  ${resolution}
  <div class="two">${spec}${examples}</div>
  ${impact}
  ${prof}
  <div class="two">${disc}<div></div></div>
  <div class="two">${activityCard('dataElement:' + did)}</div>`;
}

/* ---------- plain-language spec builder (R4) ----------
   SMEs pick a format, a length, required, allowed values and a "must match another field" rule.
   type / length / min / max / pattern are generated; the regular expression sits under a collapsed "Advanced". */
export const FORMATS = [
  ['digits', 'Digits', 'Numbers only, e.g. an account number'], ['letters', 'Letters', 'A to Z only, e.g. a country code'],
  ['text', 'Text', 'Any characters, e.g. a name'], ['date', 'Date', 'A calendar date'], ['money', 'Money', 'An amount, e.g. $1,250.00'],
  ['email', 'Email', 'An email address'], ['phone', 'Phone', 'A phone number'], ['list', 'List', 'One of a fixed set of values'],
];
const FMT_LABEL = Object.fromEntries(FORMATS.map(([k, l]) => [k, l]));
const HAS_LEN = { digits: 1, letters: 1, text: 1 };
const RE_EMAIL = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';
const RE_PHONE = '^\\+?[0-9][0-9 ().-]{6,18}[0-9]$';
const RE_MONEY = '^\\$?\\d{1,3}(,?\\d{3})*(\\.\\d{1,2})?$';
const RE_DATE = '^\\d{4}-\\d{2}-\\d{2}$';
/* best guess of the plain format for a field saved before the builder existed */
export function inferFormat(f) {
  if (!f) return 'text';
  if (f.formatKind && FMT_LABEL[f.formatKind]) return f.formatKind;
  const pat = String(f.pattern || ''), fm = String(f.format || '').toLowerCase();
  if (f.type === 'currency' || f.type === 'number' || /currency|money|amount/.test(fm)) return 'money';
  if (f.type === 'date' || /date/.test(fm)) return 'date';
  if (f.type === 'list' || (f.values || []).length) return 'list';
  if (f.type === 'digits' || /digit/.test(fm)) return 'digits';
  if (pat.includes('@') || /e-?mail/.test(fm) || /e-?mail/i.test(f.name || '')) return 'email';
  if (/phone/.test(fm) || /phone/i.test(f.name || '')) return 'phone';
  if (/^\^?\[A-Za-z\]/.test(pat) || /letter/.test(fm)) return 'letters';
  return 'text';
}
const numOr = v => { const s = String(v == null ? '' : v).trim(); if (s === '') return null; const n = Number(s); return isFinite(n) ? n : NaN; };
/* builder state -> stored field (type, length, min, max, pattern generated) plus a list of problems */
export function buildField(b) {
  const errs = [];
  const name = String(b.name || '').trim(); if (!name) errs.push('Give the field a name.');
  const k = FMT_LABEL[b.fmt] ? b.fmt : 'text';
  const out = { name, formatKind: k, required: !!b.required };
  const lenMode = HAS_LEN[k] ? (b.lenMode || 'any') : 'any';
  let len = null, lo = null, hi = null;
  if (lenMode === 'exact') { len = numOr(b.len); if (len == null || isNaN(len) || len < 1 || !Number.isInteger(len)) { errs.push('Exact length must be a whole number of 1 or more.'); len = null; } }
  if (lenMode === 'range') {
    lo = numOr(b.lenMin); hi = numOr(b.lenMax);
    if ((lo == null && hi == null) || (lo != null && (isNaN(lo) || lo < 0 || !Number.isInteger(lo))) || (hi != null && (isNaN(hi) || hi < 1 || !Number.isInteger(hi)))) { errs.push('Enter a whole-number minimum and/or maximum length.'); lo = hi = null; }
    else if (lo != null && hi != null && lo > hi) { errs.push('The minimum length is larger than the maximum.'); lo = hi = null; }
  }
  const q = len != null ? `{${len}}` : lo != null || hi != null ? `{${lo || 0},${hi != null ? hi : ''}}` : '+';
  const lenWords = len != null ? `${len} ` : lo != null && hi != null ? `${lo}–${hi} ` : lo != null ? `at least ${lo} ` : hi != null ? `up to ${hi} ` : '';
  if (k === 'digits') { out.type = 'digits'; out.pattern = '^\\d' + q + '$'; out.format = lenWords ? lenWords + 'digits' : 'digits only'; }
  else if (k === 'letters') { out.type = 'text'; out.pattern = '^[A-Za-z]' + q + '$'; out.format = lenWords ? lenWords + 'letters' : 'letters only'; }
  else if (k === 'text') { out.type = 'text'; out.format = lenWords ? lenWords + 'characters' : 'free text'; /* length lives in length/min/max; no pattern, so special-character tests still run */ }
  else if (k === 'date') { out.type = 'date'; out.pattern = RE_DATE; out.format = 'date (YYYY-MM-DD)'; }
  else if (k === 'money') {
    out.type = 'currency'; out.pattern = RE_MONEY; out.format = 'money amount';
    const a = numOr(b.amtMin), z = numOr(b.amtMax);
    if ((a != null && isNaN(a)) || (z != null && isNaN(z))) errs.push('Amounts must be numbers, e.g. 0 or 25000.');
    else if (a != null && z != null && a > z) errs.push('The smallest amount is larger than the largest.');
    else { if (a != null) out.min = a; if (z != null) out.max = z; }
  }
  else if (k === 'email') { out.type = 'text'; out.pattern = RE_EMAIL; out.format = 'email address'; }
  else if (k === 'phone') { out.type = 'text'; out.pattern = RE_PHONE; out.format = 'phone number'; }
  else if (k === 'list') {
    out.type = 'list'; const vals = String(b.values || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!vals.length) errs.push('List the allowed values, separated by commas.');
    out.values = [...new Set(vals)]; out.format = 'one of a list'; /* the allowed values are the rule; no pattern needed */
  }
  if (len != null) out.length = len;
  if (lo != null) out.min = lo;
  if (hi != null) out.max = hi;
  if (b.customPattern) {
    const cp = String(b.pattern || '').trim();
    if (cp) { try { new RegExp(cp, 'u'); out.pattern = cp; out.patternCustom = true; } catch (e) { errs.push('The Advanced pattern is not a valid regular expression.'); } }
    else delete out.pattern;
  }
  if (!out.pattern) delete out.pattern;
  const match = String(b.matches || '').trim();
  const extra = String(b.rule || '').trim();
  if (match) out.matches = match;
  out.rule = [match ? 'Must match ' + match : '', extra].filter(Boolean).join(' · ');
  return { field: out, errs };
}
/* plain summary for the spec table, e.g. "9 digits", "Money · $0 – $25,000" */
export function specSummary(f) {
  const k = inferFormat(f);
  const money = n => '$' + Number(n).toLocaleString('en-US');
  let s = f.format || FMT_LABEL[k];
  if (k === 'money' && (f.min != null || f.max != null)) s += ` · ${f.min != null ? money(f.min) : 'any'} – ${f.max != null ? money(f.max) : 'any'}`;
  return s;
}
/* builder state from a stored field */
function builderState(f) {
  f = f || {};
  const k = inferFormat(f), ruleParts = String(f.rule || '').split(/\s*·\s*/).filter(Boolean);
  const matchRule = f.matches ? null : ruleParts.find(x => /^must match\s+/i.test(x));
  const matches = f.matches || (matchRule ? matchRule.replace(/^must match\s+/i, '') : '');
  const rule = ruleParts.filter(x => !/^must match\s+/i.test(x) && !/^required$/i.test(x)).join(' · ');
  const lenMode = f.length != null && f.length !== '' ? 'exact' : HAS_LEN[k] && (f.min != null || f.max != null) ? 'range' : 'any';
  const st = { name: f.name || '', fmt: k, lenMode, len: f.length != null ? f.length : '', lenMin: HAS_LEN[k] && f.min != null ? f.min : '', lenMax: HAS_LEN[k] && f.max != null ? f.max : '',
    amtMin: k === 'money' && f.min != null ? f.min : '', amtMax: k === 'money' && f.max != null ? f.max : '', values: (f.values || []).join(', '),
    required: !!f.required || /(^|·)\s*required\s*($|·)/i.test(String(f.rule || '')), matches, rule, pattern: f.pattern || '', customPattern: !!f.patternCustom };
  /* a pattern saved before the builder that the choices would not regenerate is kept as a hand-written one */
  if (st.pattern && !st.customPattern && buildField(Object.assign({}, st, { name: st.name || 'x', values: st.values || 'x', customPattern: false })).field.pattern !== st.pattern) st.customPattern = true;
  return st;
}
function readBuilder(root) {
  const v = n => { const el = root.querySelector(`[name="${n}"]`); return el ? el.value : ''; };
  const ck = n => { const el = root.querySelector(`[name="${n}"]:checked`); return el ? el.value : ''; };
  return { name: v('name'), fmt: ck('fmt') || 'text', lenMode: ck('lenMode') || 'any', len: v('len'), lenMin: v('lenMin'), lenMax: v('lenMax'), amtMin: v('amtMin'), amtMax: v('amtMax'),
    values: v('values'), required: !!root.querySelector('[name="required"]:checked'), matches: v('matches'), rule: v('rule'), pattern: v('pattern'), customPattern: root.querySelector('[data-adv]').dataset.custom === '1' };
}
async function fieldModal(f, siblings, st, err) {
  st = st || builderState(f);
  const others = (siblings || []).filter(n => n && n !== (f && f.name));
  const radio = (name, val, label, on, hint) => `<label class="d-fmt ${on ? 'on' : ''}"${hint ? ` title="${esc(hint)}"` : ''}><input type="radio" name="${name}" value="${esc(val)}" ${on ? 'checked' : ''} /><span>${esc(label)}</span></label>`;
  const pr = modal({
    title: f && f.name ? `Edit field '${f.name}'` : 'Add field',
    body: `${err ? `<div class="banner d-err" role="alert">${esc(err)}</div>` : ''}
      <div class="field"><label>Field name</label><input name="name" value="${esc(st.name)}" placeholder="e.g. Routing number" /></div>
      <div class="field"><label id="d-fmt-l">What does it look like?</label><div class="d-fmts" role="radiogroup" aria-labelledby="d-fmt-l">${FORMATS.map(([k, l, h]) => radio('fmt', k, l, st.fmt === k, h)).join('')}</div></div>
      <div class="field" data-sec="len"><label id="d-len-l">Length</label><div class="d-lenrow" role="radiogroup" aria-labelledby="d-len-l">${radio('lenMode', 'any', 'Any length', st.lenMode === 'any')}${radio('lenMode', 'exact', 'Exactly', st.lenMode === 'exact')}${radio('lenMode', 'range', 'Between', st.lenMode === 'range')}</div>
        <div class="d-lenin" data-sec="len-exact"><input name="len" inputmode="numeric" aria-label="Exact length" value="${esc(st.len)}" placeholder="e.g. 9" /> <span class="hint" data-unit>characters</span></div>
        <div class="d-lenin" data-sec="len-range"><input name="lenMin" inputmode="numeric" aria-label="Minimum length" value="${esc(st.lenMin)}" placeholder="min" /> <span class="hint">to</span> <input name="lenMax" inputmode="numeric" aria-label="Maximum length" value="${esc(st.lenMax)}" placeholder="max" /> <span class="hint" data-unit>characters</span></div></div>
      <div class="frow" data-sec="money"><div class="field"><label>Smallest amount</label><input name="amtMin" inputmode="decimal" value="${esc(st.amtMin)}" placeholder="e.g. 0" /></div><div class="field"><label>Largest amount</label><input name="amtMax" inputmode="decimal" value="${esc(st.amtMax)}" placeholder="e.g. 25000" /></div></div>
      <div class="field" data-sec="list"><label>Allowed values (separate with commas)</label><input name="values" value="${esc(st.values)}" placeholder="e.g. Checking, Savings" /></div>
      <label class="d-check"><input type="checkbox" name="required" value="yes" ${st.required ? 'checked' : ''} /> Required: it can never be left empty</label>
      <div class="frow"><div class="field"><label>Must match another field</label><select name="matches"><option value="">No</option>${[...new Set([...others, ...(st.matches && !others.includes(st.matches) ? [st.matches] : [])])].map(n => `<option value="${esc(n)}" ${n === st.matches ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="field"><label>Other rule (plain words)</label><input name="rule" value="${esc(st.rule)}" placeholder="e.g. Must be before the due date" /></div></div>
      <div class="d-specsum" data-specsum aria-live="polite"></div>
      <details class="d-adv" data-adv data-custom="${st.customPattern ? '1' : ''}"><summary>Advanced</summary>
        <div class="field" style="margin-top:8px"><label>Pattern (regular expression, generated for you)</label><input name="pattern" value="${esc(st.pattern)}" spellcheck="false" autocomplete="off" /></div>
        <div class="hint" data-advnote></div></details>`,
    actions: [{ id: 'save', label: f && f.name ? 'Save field' : 'Add field', primary: true }],
  });
  const m = [...document.querySelectorAll('.overlay .modal')].pop();
  const adv = m.querySelector('[data-adv]'), patEl = m.querySelector('[name=pattern]');
  const sync = () => {
    const b = readBuilder(m);
    m.querySelectorAll('.d-fmt').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
    const show = (sec, on) => m.querySelectorAll(`[data-sec="${sec}"]`).forEach(x => { x.hidden = !on; });
    show('len', !!HAS_LEN[b.fmt]); show('len-exact', HAS_LEN[b.fmt] && b.lenMode === 'exact'); show('len-range', HAS_LEN[b.fmt] && b.lenMode === 'range');
    show('money', b.fmt === 'money'); show('list', b.fmt === 'list');
    m.querySelectorAll('[data-unit]').forEach(u => u.textContent = b.fmt === 'digits' ? 'digits' : b.fmt === 'letters' ? 'letters' : 'characters');
    const g = buildField(Object.assign({}, b, { customPattern: false })).field;
    if (adv.dataset.custom !== '1') patEl.value = g.pattern || '';
    m.querySelector('[data-advnote]').innerHTML = adv.dataset.custom === '1' ? 'You edited this pattern by hand, so it no longer follows the choices above. <button type="button" class="btn sm" data-advreset>Use the generated pattern</button>' : 'Updates as you change the choices above. Edit it only if you need something the choices cannot say.';
    const rb = m.querySelector('[data-advreset]'); if (rb) rb.onclick = () => { adv.dataset.custom = ''; sync(); };
    const full = buildField(b).field;
    m.querySelector('[data-specsum]').innerHTML = `<b>Reads as:</b> ${esc(specSummary(full))}${full.required ? ' · required' : ''}${(full.values || []).length ? ' · one of ' + esc(full.values.join(' / ')) : ''}${full.matches ? ' · must match ' + esc(full.matches) : ''}`;
  };
  m.addEventListener('change', e => { if (e.target !== patEl) sync(); });
  m.addEventListener('input', e => {
    if (e.target !== patEl) { sync(); return; }
    if (adv.dataset.custom !== '1') { adv.dataset.custom = '1'; sync(); } /* hand edit: stop regenerating */
  });
  sync();
  const r = await pr;
  if (r.action !== 'save') return null;
  const b = readBuilder(r.root);
  const { field, errs } = buildField(b);
  if (errs.length) return fieldModal(f, siblings, b, errs.join(' '));
  if ((siblings || []).some(n => n && n !== (f && f.name) && n.trim().toLowerCase() === field.name.toLowerCase())) return fieldModal(f, siblings, b, `A field called '${field.name}' already exists.`);
  return field;
}

export function bind(root, params) {
  const did = params.did; const cur = () => store.get('dataElement', did);
  if (!cur()) return;
  bindActivity(root);
  const save = async (d, summary) => { try { await store.save('dataElement', did, d, summary); toast(summary); } catch (e) { toast('Could not save: ' + e.message); } };
  const de = root.querySelector('[data-dedit]');
  if (de) de.onclick = async () => {
    const x = cur(); if (!canEdit(x)) { toast(onlyMsg(x)); return; }
    let err = '', vals = x;
    for (;;) {
    const r = await modal({
      title: 'Edit data element',
      body: `${err ? `<div class="banner d-err" role="alert">${esc(err)}</div>` : ''}<div class="field"><label>Name</label><input name="name" value="${esc(vals.name)}" /></div>
        <div class="frow"><div class="field"><label>Owner</label><select name="owner">${personOpts(vals.owner)}</select></div><div class="field"><label>Availability</label><select name="avail">${availOpts(vals.avail)}</select></div></div>
        <div class="frow"><div class="field"><label>Sensitivity</label><select name="sensitivity"><option value="">Not classified</option>${Object.entries(SENS).map(([k, v]) => `<option value="${k}" ${k === vals.sensitivity ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
        <div class="field"><label>Source</label><input name="source" value="${esc(vals.source || '')}" /></div></div>
        <div class="field"><label>Note</label><textarea name="note">${esc(vals.note || '')}</textarea></div>
        <span class="hint">To mark it live, use “Confirm live” on this page: it records the live source and who confirmed it.</span><span class="hint">Handing ownership to someone else means only they can edit this element afterwards.</span>`,
      actions: [{ id: 'save', label: 'Save', primary: true }],
    });
    if (r.action !== 'save') return;
    const name = (r.form.name || '').trim() || x.name;
    const dup = dupDataName(name, did);
    if (dup) { err = `A data element called '${dup.name}' already exists. Choose a different name.`; vals = Object.assign({}, x, r.form); continue; }
    const d = clone(cur()); const before = d.avail, sBefore = d.sensitivity || '';
    Object.assign(d, { name, owner: r.form.owner, avail: r.form.avail, source: r.form.source.trim(), note: r.form.note.trim() });
    if (r.form.sensitivity) d.sensitivity = r.form.sensitivity; else delete d.sensitivity;
    if (d.avail !== 'live') { delete d.liveConfirmedBy; delete d.liveConfirmedAt; delete d.liveSource; } /* no longer live: the confirmation no longer stands */
    const parts = [];
    if (before !== d.avail) parts.push(`availability ${avOf(before).short} → ${avOf(d.avail).short}`);
    if (sBefore !== (d.sensitivity || '')) parts.push(`sensitivity ${SENS[sBefore] ? SENS[sBefore].label : 'unclassified'} → ${SENS[d.sensitivity] ? SENS[d.sensitivity].label : 'unclassified'}`);
    if (x.owner !== d.owner) parts.push(`owner → ${pname(d.owner)}`);
    await save(d, parts.length ? `Edited '${d.name}': ${parts.join(', ')}` : `Edited data element '${d.name}'`);
    return;
    }
  };
  const cl = root.querySelector('[data-confirm-live]');
  if (cl) cl.onclick = async () => {
    let err = '', src = null;
    for (;;) {
      const x = cur(); if (!canEdit(x)) { toast(`Only ${pname(x.owner)} (data owner) can confirm`); return; }
      const prof = store.list('profile', p => p.dataId === did).sort((p, q) => String(q.at).localeCompare(String(p.at)))[0];
      const drift = prof ? eng('specDrift', [x, prof], []) : [];
      const r = await modal({
        title: `Confirm '${x.name}' is live`,
        body: `${err ? `<div class="banner d-err" role="alert">${esc(err)}</div>` : ''}<p style="margin:0">You are confirming, as the data owner, that steps can now read <b>${esc(x.name)}</b> from a live source.</p>
          <div class="field"><label>Live source</label><input name="source" value="${esc(src != null ? src : (x.liveSource || x.source || ''))}" placeholder="e.g. ERP vendor master API (read)" /></div>
          <div class="d-confprof" data-confprof>${prof ? `<b>Latest profile</b> · ${esc(prof.rows)} rows · ${esc(fmtTime(prof.at))} · ${(prof.columns || []).length} columns · ${drift.length ? `<span class="fail">${drift.length} spec drift issue${drift.length === 1 ? '' : 's'}</span>` : '<span class="pass">matches the specification</span>'}` : '<span class="hint">No profile yet. You can still confirm; profiling a real extract first is recommended.</span>'}</div>`,
        actions: [{ id: 'confirm', label: 'Confirm live', primary: true }],
      });
      if (r.action !== 'confirm') return;
      src = (r.form.source || '').trim();
      if (!src) { err = 'Name the live source you are confirming.'; continue; }
      const d = clone(cur());
      Object.assign(d, { avail: 'live', liveConfirmedBy: store.state.me, liveConfirmedAt: new Date().toISOString(), liveSource: src });
      if (!d.source) d.source = src;
      await save(d, `Confirmed '${d.name}' live (source: ${src})`);
      return;
    }
  };
  root.querySelectorAll('[data-resolve]').forEach(b => b.onclick = async () => {
    const x = cur(); if (!canEdit(x)) { toast(onlyMsg(x)); return; }
    const i = +b.dataset.resolve; const item = (x.discovered || [])[i]; if (!item) return;
    const r = await modal({ title: 'Resolve discovered requirement', body: `<div class="note">${esc(item.text)}</div><div class="field"><label>Resolution note</label><textarea name="note" placeholder="e.g. Added a max-length rule to the specification"></textarea></div>`, actions: [{ id: 'save', label: 'Resolve', primary: true }] });
    if (r.action !== 'save') return;
    const note = (r.form.note || '').trim(); if (!note) { toast('Add a note that says how it was resolved'); return; }
    const d = clone(cur()); if (!d.discovered || !d.discovered[i]) return;
    d.discovered[i].resolved = { by: store.state.me, at: new Date().toISOString(), note };
    await save(d, `Resolved discovered requirement on '${d.name}': ${note.slice(0, 60)}`);
  });
  const add = root.querySelector('[data-fadd]');
  const owner = () => { const x = cur(); if (canEdit(x)) return true; toast(onlyMsg(x)); return false; };
  if (add) add.onclick = async () => { if (!owner()) return; const f = await fieldModal(null, (cur().fields || []).map(x => x.name)); if (!f) return; const d = clone(cur()); d.fields = [...(d.fields || []), f]; await save(d, `Added field '${f.name}' to the specification`); };
  root.querySelectorAll('[data-fedit]').forEach(b => b.onclick = async () => { if (!owner()) return;
    const i = +b.dataset.fedit; const f = await fieldModal((cur().fields || [])[i], (cur().fields || []).map(x => x.name)); if (!f) return;
    const d = clone(cur()); if (!d.fields || !d.fields[i]) return; d.fields[i] = f; await save(d, `Edited field '${f.name}' in the specification`);
  });
  root.querySelectorAll('[data-fdel]').forEach(b => b.onclick = async () => { if (!owner()) return;
    const i = +b.dataset.fdel; const f = (cur().fields || [])[i]; if (!f) return;
    if (!await confirmBox('Delete field?', `Delete '${f.name}' from the specification? Generated test cases for it will no longer be produced.`, 'Delete')) return;
    const d = clone(cur()); d.fields.splice(i, 1); await save(d, `Deleted field '${f.name}' from the specification`);
  });
}
