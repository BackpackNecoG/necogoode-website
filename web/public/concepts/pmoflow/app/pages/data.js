/* Data element detail (stream D): /data/:did — header, spec editor, resolution plan, impact, profile, discovered requirements. */
import { store } from '../store.js';
import { E, esc, fmt, fmtTime, link, av, personChip, pname, LOCK, modal, toast, activityCard, bindActivity } from '../ui.js';
import { eng, docs, today, flat, projectsFor, workBadge, stepBadge, notFound, confirmBox, dupDataName, effAvail, effDot, humanPat, NEEDS_LIVE, avOf, awaitingText, usage, EVID, evidenceTag, blockingDrift, caseLbl, availInfo, isAdv, whoOf } from './process.js';

const clone = o => JSON.parse(JSON.stringify(o));
const personOpts = sel => store.state.people.map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)} — ${esc(x.role || '')}</option>`).join('');
/* R7 plain states. "Connected" here means we have it; the owner's confirmation with proof is recorded separately. */
const AVAIL_OPT = { live: 'Connected (we have this today)', example: 'Sample only', missing: 'Not available yet' };
const availOpts = sel => Object.entries(AVAIL_OPT).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');

export const SENS = { public: { label: 'Public', cls: 'd-s-public' }, internal: { label: 'Internal', cls: 'd-s-internal' }, confidential: { label: 'Confidential', cls: 'd-s-conf' }, pii: { label: 'Personal details', cls: 'd-s-pii', title: 'Personal details (PII)' } };
export const sensBadge = k => { const v = SENS[k]; return v ? `<span class="badge d-sens ${v.cls}" title="How sensitive: ${esc(v.title || v.label)}">${esc(v.label)}</span>` : (isAdv() ? '<span class="badge b-none" title="Sensitivity not set">Sensitivity not set</span>' : ''); };
/* only http(s) links are rendered as links */
const safeUrl = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '#';
const canEdit = x => !!x && store.state.me === x.owner;
const onlyMsg = x => `Only ${pname(x.owner)} (the owner) can change this`;
/* disabled-state attributes for owner-only controls */
const gate = x => canEdit(x) ? '' : `disabled aria-disabled="true" title="${esc(onlyMsg(x))}"`;
function ruleText(f) {
  const r = [];
  if (f.required) r.push('Required');
  if (f.unique) r.push('Unique');
  if ((f.values || []).length) r.push('one of ' + f.values.join(' / '));
  if (f.matches) r.push('Must match ' + f.matches);
  if (f.rule) String(f.rule).split(/\s*[·;]\s*/).forEach(x => x && r.push(x));
  /* de-duplicate case-insensitively: a rule of "Required" plus required:true reads once */
  const seen = new Set();
  return r.filter(x => { const k = String(x).trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).join(' · ') || '—';
}
/* plain-English headline for each spec-drift issue key */
const DRIFT = { duplicate: 'has duplicate values; it must be unique', duplicates: 'has duplicate values; it must be unique', 'duplicate-values': 'has duplicate values; it must be unique', 'not-unique': 'has duplicate values; it must be unique', 'missing-column': 'not found in the extract', 'required-nulls': 'required but sometimes empty', 'length-mismatch': 'length differs from the spec', 'non-digit': 'has characters that are not digits',
  'unexpected-specials': 'has unexpected characters', 'type-mismatch': 'values are not the expected type', 'out-of-range': 'values outside the allowed range', 'pattern-mismatch': 'format differs from the spec' };
const driftTitle = d => DRIFT[d.issue] || String(d.issue || 'differs from the spec').replace(/[-_]+/g, ' ');
/* the engine writes plain English; any raw shape code left in a message (e.g. 9{8}) is humanized here as a safety net */
const plainDetail = t => String(t || '').replace(/\bthe spec(ification)?\b/gi, 'the rules').replace(/\bspec(ification)?\b/gi, 'rules').replace(/\b[9Aax]+(?:\{\d+\})?(?:[ \-./@]?[9Aax]+(?:\{\d+\})?)*/g, m => /\{\d+\}/.test(m) ? humanPat(m) : m);

/* R7: "Use these columns as the rules to test" — the engine turns a sample-data check into rules (min/max become boundaries) */
export function rulesFromProfile(profile) {
  const r = eng('specFromProfile', [profile], null);
  return Array.isArray(r) ? r.filter(f => f && f.name) : [];
}

export function render(params) {
  const did = params.did;
  const x = store.get('dataElement', did);
  if (!x) return notFound('Information “' + did + '”');
  const adv = isAdv();
  const eff = effAvail(did), info = availInfo(did);
  const owner = canEdit(x);
  /* R5: one usage source (engine usageOf) for every count: Future and Today, labelled */
  const use = usage(did);
  const rowsOf = (list, ver) => list.map(u => { const p = store.get('process', u.pid); const s = p && flat(p[ver]).find(y => y.id === u.stepId); return s ? { pid: u.pid, p, s, ver } : null; }).filter(Boolean);
  const users = rowsOf(use.tobe, 'tobe'), asisUsers = rowsOf(use.asis, 'asis');
  const fc = eng('forecastAll', [docs(), today()], {});
  const resolver = store.list('workItem', w => w.resolves === did)[0];
  const downstream = resolver ? eng('dependents', [docs(), resolver.id], []).map(id => store.get('workItem', id)).filter(Boolean) : [];
  const ready = eff === 'live';
  const usingProjects = [...new Set(users.map(u => u.pid))].flatMap(pid => projectsFor(pid));
  const procCount = new Set([...users, ...asisUsers].map(u => u.pid)).size;
  const testPrj = usingProjects[0];
  const profile = store.list('profile', p => p.dataId === did).sort((p, q) => String(q.at).localeCompare(String(p.at)))[0];
  const drift = profile ? eng('specDrift', [x, profile], []) : [];
  const fields = x.fields || [];
  const suggested = profile && !fields.length ? rulesFromProfile(profile) : [];
  const noRule = drift.filter(d => d && d.issue === 'unspecified-column');

  const amber = eff === 'example' || eff === 'pending';
  const resolution = (eff !== 'live' || resolver) ? `<div class="card d-resolve ${ready ? '' : amber ? 'd-resolve-amber' : 'd-resolve-open'}" style="margin-top:16px" data-resolution="${eff}"><h3>${LOCK} Fix ${ready ? '<span class="badge b-done">Done</span>' : eff === 'pending' ? `<span class="badge d-b-amber">${esc(awaitingText(did))}</span>` : eff === 'example' ? `<span class="badge d-b-amber">${NEEDS_LIVE}</span>` : ''}</h3>
    ${resolver ? `<a class="wi" href="${link('/project/' + resolver.projectId + '?mode=work')}" data-link>${av(resolver.owner)}<div style="flex:1;min-width:0"><div class="t" style="font-weight:600">${esc(resolver.title)}</div><div class="dep">${esc(pname(resolver.owner))} · planned ${esc(fmt(resolver.start))} → ${esc(fmt(resolver.due))}${fc[resolver.id] && fc[resolver.id].forecast ? ' · expected ' + esc(fmt(fc[resolver.id].forecast)) : ''}</div></div>${workBadge(resolver, fc[resolver.id])}</a>
      ${downstream.length ? `<div class="hint" style="margin:10px 0 4px">These work items move with it:</div>${downstream.map(w => `<div class="row click" data-go="/process/${esc(w.pid)}/step/${esc(w.step)}"><div><div class="t">${esc(w.title)}</div><div class="s">${esc((store.get('process', w.pid) || {}).name || w.pid)} · ${esc(pname(w.owner))}</div></div><div class="r">${workBadge(w, fc[w.id])}</div></div>`).join('')}` : '<div class="hint" style="margin-top:8px">No other work items wait for it.</div>'}`
      : eff === 'example' ? `<div class="s d-noplan d-noplan-amber" data-noplan>No fix planned. Only a sample exists, so the launch check fails until someone connects it. Add a work item for it on the project page.</div>`
      : '<div class="s d-noplan" data-noplan>No fix planned. Nobody is working on getting this yet, so the steps that need it have no real date. Add a work item for it on the project page.</div>'}</div>` : '';

  /* R4/R5: only the owner's confirmation, with a source and proof, counts as connected for launch */
  const ev = x.liveEvidence || null;
  const evDetail = ev ? (ev.type === 'attested' ? `${ev.ref ? ` · <a href="${esc(safeUrl(ev.ref))}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">proof link</a>` : ''}${ev.note ? ' · “' + esc(ev.note) + '”' : ''}` : ev.type === 'check' ? (x.check && x.check.detail ? ' · ' + esc(x.check.detail) : '') : ev.type === 'profile' ? (() => { const pr = store.get('profile', ev.ref); return pr ? ` · sample data check of ${esc(pr.rows)} rows, ${esc(fmtTime(pr.at))}` : ''; })() : '') : '';
  const confirmedBy = x.liveConfirmedBy ? `Confirmed connected by ${esc(pname(x.liveConfirmedBy))}${x.liveConfirmedAt ? ' · ' + esc(fmtTime(x.liveConfirmedAt)) : ''}${x.liveSource ? ' · from ' + esc(x.liveSource) : ''} ${evidenceTag(x)}${evDetail}` : '';
  const confirm = eff === 'live'
    ? ''
    : `<div class="card d-confirm ${eff === 'pending' ? 'd-confirm-due' : ''}" data-confirm-card style="margin-top:16px"><h3>Confirm it’s connected</h3>
      <p class="s" style="margin:0 0 10px">${eff === 'pending' ? `The fix is done. ${esc(pname(x.owner))}, as the owner, confirms where it now comes from before launch counts it.` : `When it is connected, the owner confirms it here. Until then the launch check fails.`} You need proof: a clean sample data check, a passing connection check, or a link and a note (weaker).</p>
      ${x.check ? `<div class="d-checkres ${x.check.ok ? 'pass' : 'fail'}" data-last-check>Last connection check ${esc(fmtTime(x.check.at))}: ${x.check.ok ? 'passed' : 'failed'}. ${esc(x.check.detail || '')}</div>` : ''}
      <div class="d-ownerrow" style="margin-top:0">${owner ? `<button class="btn ${eff === 'pending' ? 'primary' : ''}" data-confirm-live>Confirm it’s connected…</button>` : `<span class="d-only">${LOCK} Only ${esc(pname(x.owner))} (the owner) can confirm</span>`}</div></div>`;

  const spec = `<div class="card" data-rules><h3>Rules to test <span class="n">${fields.length}</span></h3>
    ${fields.length ? `<div class="tbl-wrap"><table class="d-spec"><tr><th>Name</th><th>Looks like</th><th>Rules</th>${owner ? '<th><span class="d-sr">Actions</span></th>' : ''}</tr>${fields.map((f, i) => `<tr><td><b>${esc(f.name)}</b></td><td data-fsum>${esc(specSummary(f))}</td><td class="d-rule">${esc(ruleText(f))}</td>
      ${owner ? `<td class="d-acts"><button class="btn sm" data-fedit="${i}" aria-label="Edit rule ${esc(f.name)}">Edit</button><button class="btn sm danger" data-fdel="${i}" aria-label="Delete rule ${esc(f.name)}">Delete</button></td>` : ''}</tr>`).join('')}</table></div>`
      : suggested.length ? `<div class="d-suggest" data-suggest-rules="${suggested.length}"><div class="s">The sample data check found <b>${suggested.length} column${suggested.length === 1 ? '' : 's'}</b>: ${esc(suggested.map(f => f.name).join(', '))}.</div>
        ${owner ? `<button class="btn primary" data-use-columns>Use these columns as the rules to test</button><div class="hint">The smallest and largest values seen become tests at the edges. You can change any rule after.</div>` : `<div class="d-only">${LOCK} ${esc(pname(x.owner))} (the owner) can turn them into rules</div>`}</div>`
      : `<div class="s">No rules yet. Describe what each piece should look like so tests can be made${testPrj ? ', or check a sample of the real data first' : ''}.</div>`}
    ${owner ? `<div class="d-ownerrow"><button class="btn sm" data-fadd>+ Add a rule</button></div>` : fields.length ? '' : `<div class="d-only" style="margin-top:8px">${LOCK} ${esc(onlyMsg(x))}</div>`}</div>`;

  const examples = `<div class="card"><h3>Samples on file <span class="n">${(x.samples || []).length}</span></h3>${(x.samples || []).length ? x.samples.map(f => `<div class="row"><span>📄</span><div><div class="t">${esc(f)}</div><div class="s">Sample file (demo, not downloadable)</div></div></div>`).join('') : '<div class="s">None. Nobody has shared a real example yet.</div>'}
    ${x.sampleCsv ? '<div class="hint" style="margin-top:8px">A made-up sample extract is on file for checking.</div>' : ''}</div>`;

  const allUsers = [...users, ...asisUsers];
  const impact = `<div class="card" style="margin-top:16px" data-impact><h3>Steps that use it <span class="n" data-usage-total="${users.length}/${asisUsers.length}">${users.length} Future · ${asisUsers.length} Today</span></h3>${allUsers.length ? `<div class="tbl-wrap"><table><tr><th>Step</th><th>Map</th><th>Process</th><th>Who</th><th>Project</th></tr>
    ${allUsers.map(u => { const prj = u.ver === 'tobe' ? projectsFor(u.pid)[0] : null; const st = prj ? eng('stepState', [docs(), prj.id, u.pid, u.s.id, today()], null) : null; return `<tr class="click" data-go="/process/${esc(u.pid)}/step/${esc(u.s.id)}" data-use="${u.ver}"><td><a href="${link('/process/' + u.pid + '/step/' + u.s.id)}" data-link><b>${esc(u.s.title)}</b></a></td><td><span class="chip ${u.ver === 'asis' ? '' : 'd-chip-tobe'}">${u.ver === 'asis' ? 'Today' : 'Future'}</span></td><td>${esc(u.p.name)}</td><td>${esc(whoOf(u.s))}</td><td class="d-nowrap">${u.ver === 'asis' ? '<span class="hint">How it works today</span>' : prj ? stepBadge(st, u.s) : '<span class="hint">No project</span>'}</td></tr>`; }).join('')}</table></div>` : '<div class="s">No step uses this yet.</div>'}</div>`;
  /* R5: tests, labelled TC<n> */
  const cases = store.list('testCase', c => c.dataId === did);
  const uncovered = fields.filter(f => !cases.some(c => String(c.field || '').toLowerCase() === String(f.name).toLowerCase()));
  const tcards = `<div class="card" data-cases><h3>Tests <span class="n">${cases.length}</span></h3>${cases.length ? `<div class="tbl-wrap"><table class="d-cases"><tr><th>Test</th><th>Rule</th><th>Kind</th><th>Input</th><th>Expect</th></tr>${cases.slice(0, 8).map(c => `<tr data-case="${esc(c.id)}"><td><b class="d-tc">${esc(caseLbl(c))}</b></td><td>${esc(c.field || '—')}</td><td>${esc(c.kind || '')}</td><td><code class="d-code">${esc(c.input === '' ? '(empty)' : c.input)}</code></td><td class="${c.expect === 'reject' ? 'fail' : 'pass'}">${esc(c.expect || '')}</td></tr>`).join('')}</table></div>${cases.length > 8 ? `<div class="hint" style="margin-top:6px">and ${cases.length - 8} more${testPrj ? ` in <a href="${link('/testing/' + testPrj.id)}" data-link style="color:var(--accent)">Testing</a>` : ''}</div>` : ''}` : `<div class="s">No tests yet. ${fields.length ? 'Make them from the rules in Testing.' : 'Add rules first (or use your sample data).'}</div>`}
    ${fields.length ? (uncovered.length ? `<div class="hint fail" style="margin-top:8px" data-uncovered>${uncovered.length} rule${uncovered.length === 1 ? ' has' : 's have'} no test: ${esc(uncovered.map(f => f.name).join(', '))}</div>` : '<div class="hint pass" style="margin-top:8px">Every rule has at least one test.</div>') : ''}</div>`;

  /* sample data check: plain summary in Simple; the full column statistics in Advanced */
  const simpleCols = profile ? (profile.columns || []).map(c => `<div class="row"><div style="min-width:0"><div class="t">${esc(c.name)}</div><div class="s">${(+c.nulls || 0) ? `${esc(c.nulls)} empty · ` : 'never empty · '}${c.min != null ? `from ${esc(c.min)} to ${esc(c.max)}` : `${esc(c.minLen)}–${esc(c.maxLen)} characters`}${(c.patterns || [])[0] ? ` · usually ${esc(humanPat(c.patterns[0].pattern))}` : ''}</div></div></div>`).join('') : '';
  const prof = `<div class="card" style="margin-top:16px" data-profile-card><h3>Check sample data ${profile ? `<span class="n">${esc(profile.rows)} rows · ${esc(fmtTime(profile.at))}</span>` : ''}</h3>
    ${profile ? (adv ? `<div class="hint" style="margin:-4px 0 8px">Statistics only. Examples are masked: digits become 9, letters x/X, first and last character kept.</div>
      <div class="tbl-wrap"><table class="d-prof"><tr><th>Column</th><th>Empty</th><th>Distinct</th><th>Length</th><th>Range</th><th>Top patterns</th><th>Masked examples</th></tr>${(profile.columns || []).map(c => `<tr><td><b>${esc(c.name)}</b>${(c.specials || []).length ? `<div class="hint">special characters ${esc(c.specials.join(' '))}</div>` : ''}</td><td>${esc(c.nulls)}</td><td>${esc(c.distinct)}</td><td>${esc(c.minLen)}–${esc(c.maxLen)}</td><td>${c.min != null ? esc(c.min) + ' – ' + esc(c.max) : '—'}</td>
        <td>${(c.patterns || []).slice(0, 3).map(pt => `<span class="d-pat">${esc(humanPat(pt.pattern))}</span> <span class="hint">×${esc(pt.count)}</span>`).join('<br>') || '—'}</td><td>${(c.examples || []).slice(0, 3).map(e => `<code class="d-code">${esc(e)}</code>`).join(' ') || '—'}</td></tr>`).join('')}</table></div>` : `<div class="hint" style="margin:-4px 0 8px">What a sample of the real data looks like (no real values are stored).</div>${simpleCols}`)
      + `<h3 style="margin-top:14px">Differences from the rules <span class="n">${blockingDrift(drift).length}</span></h3>${noRule.length ? `<div class="s" data-norule="${noRule.length}">${noRule.length} column${noRule.length === 1 ? ' has' : 's have'} no rule yet: ${esc(noRule.map(d => d.field).join(', '))}.</div>` : ''}${blockingDrift(drift).length ? blockingDrift(drift).map(d => `<div class="row"><span class="fail" aria-hidden="true">●</span><div><div class="t">${esc(d.field)}: ${esc(driftTitle(d))}</div><div class="s">${esc(plainDetail(d.detail))}</div></div></div>`).join('') : fields.length ? '<div class="s pass">The sample matches the rules.</div>' : ''}`
    : '<div class="s">Not checked yet. A check reads a sample of the real data and shows what it looks like, so the rules and tests match reality.</div>'}
    ${testPrj ? `<div style="margin-top:10px"><a class="btn sm" href="${link('/testing/' + testPrj.id)}" data-link>Check sample data in ${esc(testPrj.name)} ›</a></div>` : '<div class="hint" style="margin-top:8px">Add a process that uses this to a project to check sample data.</div>'}</div>`;

  const dlist = x.discovered || [], open = dlist.filter(d => !d.resolved).length;
  const disc = `<div class="card"><h3>Found during testing <span class="n">${open} open · ${dlist.length - open} fixed</span></h3>${dlist.length ? dlist.map((d, i) => `<div class="row d-disc ${d.resolved ? 'd-resolved' : ''}"><span aria-hidden="true">${d.resolved ? '✓' : '🔎'}</span><div style="flex:1;min-width:0"><div class="t">${esc(d.text)}</div><div class="s">${d.fromRun ? 'Found in test run ' + esc(d.fromRun) + ' · ' : ''}${esc(fmtTime(d.at))}</div>
      ${d.resolved ? `<div class="d-resnote"><b>Fixed</b> by ${esc(pname(d.resolved.by))} · ${esc(fmtTime(d.resolved.at))}${d.resolved.note ? ': ' + esc(d.resolved.note) : ''}</div>` : ''}</div>
      ${d.resolved || !owner ? '' : `<div class="r"><button class="btn sm" data-resolve="${i}">Mark fixed</button></div>`}</div>`).join('') + (open && !owner ? `<div class="d-only">${LOCK} ${esc(onlyMsg(x))}</div>` : '') : '<div class="s">Nothing yet. Anything testing finds that the rules missed lands here.</div>'}</div>`;

  return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> › Information</div><h1>${esc(x.name)}</h1>${x.note ? `<p>${esc(x.note)}</p>` : ''}
    <div class="res"><span class="lbl">Owner</span>${personChip(x.owner) || '<span class="hint">None</span>'}<span class="chip" title="Where it comes from">${esc(x.source || 'Source not set')}</span><span class="chip" data-eff="${eff}" data-avail="${esc(info.key)}">${effDot(did)}${esc(info.label)}</span>${eff === 'live' && adv ? evidenceTag(x) : ''}${sensBadge(x.sensitivity)}</div>${eff === 'live' && confirmedBy ? `<div class="d-confirmed" data-confirmed>✓ ${confirmedBy}</div>` : ''}</div>
    <div class="hdr-side">${owner ? '<div class="d-ownerrow d-right"><button class="btn" data-dedit>Edit</button></div>' : `<div class="d-ownerrow d-right"><span class="d-only">${LOCK} ${esc(onlyMsg(x))}</span></div>`}<div class="kpis"><div class="kpi" data-kpi-tobe><b>${users.length}</b><span>Future steps</span></div><div class="kpi" data-kpi-asis><b>${asisUsers.length}</b><span>Today steps</span></div>${adv ? `<div class="kpi"><b>${procCount}</b><span>Processes</span></div>` : ''}<div class="kpi"><b style="color:${downstream.length && !ready ? 'var(--late)' : 'inherit'}">${downstream.length}</b><span>Work waiting for it</span></div></div></div></section>
  ${confirm}
  ${resolution}
  <div class="two">${spec}${examples}</div>
  ${impact}
  ${prof}
  <div class="two">${disc}${tcards}</div>
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
  if (b.unique) out.unique = true; /* R6: no two records may share a value; profiling flags duplicates */
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
    required: !!f.required || /(^|·)\s*required\s*($|·)/i.test(String(f.rule || '')), unique: !!f.unique, matches, rule, pattern: f.pattern || '', customPattern: !!f.patternCustom };
  /* a pattern saved before the builder that the choices would not regenerate is kept as a hand-written one */
  if (st.pattern && !st.customPattern && buildField(Object.assign({}, st, { name: st.name || 'x', values: st.values || 'x', customPattern: false })).field.pattern !== st.pattern) st.customPattern = true;
  return st;
}
function readBuilder(root) {
  const v = n => { const el = root.querySelector(`[name="${n}"]`); return el ? el.value : ''; };
  const ck = n => { const el = root.querySelector(`[name="${n}"]:checked`); return el ? el.value : ''; };
  return { name: v('name'), fmt: ck('fmt') || 'text', lenMode: ck('lenMode') || 'any', len: v('len'), lenMin: v('lenMin'), lenMax: v('lenMax'), amtMin: v('amtMin'), amtMax: v('amtMax'),
    values: v('values'), required: !!root.querySelector('[name="required"]:checked'), unique: !!root.querySelector('[name="unique"]:checked'), matches: v('matches'), rule: v('rule'), pattern: v('pattern'), customPattern: root.querySelector('[data-adv]').dataset.custom === '1' };
}
async function fieldModal(f, siblings, st, err) {
  st = st || builderState(f);
  const others = (siblings || []).filter(n => n && n !== (f && f.name));
  const radio = (name, val, label, on, hint) => `<label class="d-fmt ${on ? 'on' : ''}"${hint ? ` title="${esc(hint)}"` : ''}><input type="radio" name="${name}" value="${esc(val)}" ${on ? 'checked' : ''} /><span>${esc(label)}</span></label>`;
  const pr = modal({
    title: f && f.name ? `Edit rule '${f.name}'` : 'Add a rule to test',
    body: `${err ? `<div class="banner d-err" role="alert">${esc(err)}</div>` : ''}
      <div class="field"><label>Name</label><input name="name" value="${esc(st.name)}" placeholder="e.g. Routing number" /></div>
      <div class="field"><label id="d-fmt-l">What does it look like?</label><div class="d-fmts" role="radiogroup" aria-labelledby="d-fmt-l">${FORMATS.map(([k, l, h]) => radio('fmt', k, l, st.fmt === k, h)).join('')}</div></div>
      <div class="field" data-sec="len"><label id="d-len-l">Length</label><div class="d-lenrow" role="radiogroup" aria-labelledby="d-len-l">${radio('lenMode', 'any', 'Any length', st.lenMode === 'any')}${radio('lenMode', 'exact', 'Exactly', st.lenMode === 'exact')}${radio('lenMode', 'range', 'Between', st.lenMode === 'range')}</div>
        <div class="d-lenin" data-sec="len-exact"><input name="len" inputmode="numeric" aria-label="Exact length" value="${esc(st.len)}" placeholder="e.g. 9" /> <span class="hint" data-unit>characters</span></div>
        <div class="d-lenin" data-sec="len-range"><input name="lenMin" inputmode="numeric" aria-label="Minimum length" value="${esc(st.lenMin)}" placeholder="min" /> <span class="hint">to</span> <input name="lenMax" inputmode="numeric" aria-label="Maximum length" value="${esc(st.lenMax)}" placeholder="max" /> <span class="hint" data-unit>characters</span></div></div>
      <div class="frow" data-sec="money"><div class="field"><label>Smallest amount</label><input name="amtMin" inputmode="decimal" value="${esc(st.amtMin)}" placeholder="e.g. 0" /></div><div class="field"><label>Largest amount</label><input name="amtMax" inputmode="decimal" value="${esc(st.amtMax)}" placeholder="e.g. 25000" /></div></div>
      <div class="field" data-sec="list"><label>Allowed values (separate with commas)</label><input name="values" value="${esc(st.values)}" placeholder="e.g. Checking, Savings" /></div>
      <label class="d-check"><input type="checkbox" name="required" value="yes" ${st.required ? 'checked' : ''} /> Required: it can never be left empty</label>
      <label class="d-check"><input type="checkbox" name="unique" value="yes" ${st.unique ? 'checked' : ''} /> Unique: no two records share a value (the sample data check flags duplicates)</label>
      <div class="frow"><div class="field"><label>Must match another rule’s value</label><select name="matches"><option value="">No</option>${[...new Set([...others, ...(st.matches && !others.includes(st.matches) ? [st.matches] : [])])].map(n => `<option value="${esc(n)}" ${n === st.matches ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="field"><label>Other rule (plain words)</label><input name="rule" value="${esc(st.rule)}" placeholder="e.g. Must be before the due date" /></div></div>
      <div class="d-specsum" data-specsum aria-live="polite"></div>
      <details class="d-adv" data-adv data-custom="${st.customPattern ? '1' : ''}"${isAdv() ? '' : ' hidden'}><summary>Advanced</summary>
        <div class="field" style="margin-top:8px"><label>Pattern (regular expression, generated for you)</label><input name="pattern" value="${esc(st.pattern)}" spellcheck="false" autocomplete="off" /></div>
        <div class="hint" data-advnote></div></details>`,
    actions: [{ id: 'save', label: f && f.name ? 'Save rule' : 'Add rule', primary: true }],
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
    m.querySelector('[data-specsum]').innerHTML = `<b>Reads as:</b> ${esc(specSummary(full))}${full.required ? ' · required' : ''}${full.unique ? ' · unique' : ''}${(full.values || []).length ? ' · one of ' + esc(full.values.join(' / ')) : ''}${full.matches ? ' · must match ' + esc(full.matches) : ''}`;
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
  if ((siblings || []).some(n => n && n !== (f && f.name) && n.trim().toLowerCase() === field.name.toLowerCase())) return fieldModal(f, siblings, b, `A rule called '${field.name}' already exists.`);
  return field;
}

/* R5: confirm live with evidence that cannot be faked:
   (a) the latest profile with zero blocking drift, (b) a passing connection check, or (c) a link plus a note ("attested", weaker). */
async function confirmLive(did, cur, save) {
  let err = '', vals = {}, check = null;
  for (;;) {
    const x = cur(); if (!canEdit(x)) { toast(`Only ${pname(x.owner)} (the owner) can confirm`); return; }
    const prof = store.list('profile', p => p.dataId === did).sort((p, q) => String(q.at).localeCompare(String(p.at)))[0];
    const drift = prof ? eng('specDrift', [x, prof], []) : [];
    const blk = blockingDrift(drift);
    const lastCheck = check || x.check || null;
    const sel = vals.ev || (prof && !blk.length ? 'profile' : '');
    const opt = (v, dis, inner) => `<label class="d-evopt ${dis ? 'd-evdis' : ''}" data-evopt="${v}"><input type="radio" name="ev" value="${v}" ${sel === v && !dis ? 'checked' : ''} ${dis ? 'disabled' : ''} /><div>${inner}</div></label>`;
    const pr = modal({
      title: `Confirm '${x.name}' is connected`,
      body: `${err ? `<div class="banner d-err" role="alert">${esc(err)}</div>` : ''}<p style="margin:0">You are confirming, as the owner, that the steps can now get <b>${esc(x.name)}</b> from where it really comes from.</p>
        <div class="field"><label>Where it comes from</label><input name="source" value="${esc(vals.source != null ? vals.source : (x.liveSource || x.source || ''))}" placeholder="e.g. ERP vendor master API (read)" /></div>
        <div class="field"><label id="d-ev-l">Proof</label><div class="d-evs" role="radiogroup" aria-labelledby="d-ev-l">
          ${opt('profile', !prof || blk.length, `<b>Latest sample data check</b> <span class="badge d-ev d-ev-ok">Strong</span><div class="d-confprof" data-confprof>${prof ? `Latest check · ${esc(prof.rows)} rows · ${esc(fmtTime(prof.at))} · ${drift.length ? `${drift.length} difference${drift.length === 1 ? '' : 's'}, <b class="${blk.length ? 'fail' : 'pass'}" data-blocking="${blk.length}">${blk.length} blocking</b>` : '<span class="pass">matches the rules</span>'}
            ${blk.length ? `<ul class="d-blklist">${blk.slice(0, 5).map(d => `<li>${esc(d.field)}: ${esc(plainDetail(d.detail))}</li>`).join('')}</ul><div class="fail">Blocked: fix the differences and check again, or use other proof.</div>` : drift.length ? '<div class="hint">Only columns with no rule differ; they do not block.</div>' : ''}` : '<span class="hint">No sample data check yet. Run one in Testing to use this.</span>'}</div>`)}
          ${opt('check', false, `<b>Connection check</b> <span class="badge d-ev d-ev-ok">Strong</span><div class="hint">A simulated check that we can reach <b data-probe-target>${esc(vals.source != null ? vals.source : (x.liveSource || x.source || '')) || 'the source above'}</b>. It must pass.</div>
            <div class="d-checkrow"><button type="button" class="btn sm" data-run-check>Run connection check</button><span data-check-result aria-live="polite" class="${lastCheck ? (lastCheck.ok ? 'pass' : 'fail') : 'hint'}">${lastCheck ? `${lastCheck.ok ? '✓ Passed' : '✗ Failed'} ${esc(fmtTime(lastCheck.at))}: ${esc(lastCheck.detail || '')}` : 'Not run yet.'}</span></div>`)}
          ${opt('attested', false, `<b>A link and a note</b> <span class="badge d-ev d-ev-weak">Weaker proof</span><div class="hint">The launch check shows this as a warning.</div>
            <div class="frow d-evattest"><div class="field"><label>Proof link</label><input name="evlink" value="${esc(vals.evlink || '')}" placeholder="https://…" inputmode="url" /></div><div class="field"><label>Note</label><input name="evnote" value="${esc(vals.evnote || '')}" placeholder="What the link shows" /></div></div>`)}
        </div></div>`,
      actions: [{ id: 'confirm', label: 'Confirm connected', primary: true }],
    });
    const m = [...document.querySelectorAll('.overlay .modal')].pop();
    const rc = m.querySelector('[data-run-check]'), out = m.querySelector('[data-check-result]');
    /* R6: the probe targets whatever source is typed; a check run against another source no longer counts */
    const srcEl = m.querySelector('[name=source]'), tgt = m.querySelector('[data-probe-target]');
    srcEl.addEventListener('input', () => {
      tgt.textContent = srcEl.value.trim() || 'the source above';
      const ran = check || cur().check;
      if (ran && ran.source && ran.source !== srcEl.value.trim()) { out.className = 'hint'; out.textContent = `The last check probed ${ran.source}. Run it again for this source.`; }
    });
    /* typing into an option's inputs selects that option */
    m.querySelectorAll('[data-evopt] input:not([type=radio])').forEach(i => i.addEventListener('focus', () => { const r = i.closest('[data-evopt]').querySelector('input[type=radio]'); if (r && !r.disabled) r.checked = true; }));
    rc.onclick = async () => {
      const radio = m.querySelector('input[name=ev][value=check]'); radio.checked = true;
      rc.disabled = true; out.className = 'hint'; out.textContent = 'Running…';
      try {
        const typed = (srcEl.value || '').trim();
        if (!typed) { out.className = 'fail'; out.textContent = 'Name the live source first: the check probes it.'; rc.disabled = false; return; }
        const now = cur();
        /* the probe reads the element's recorded source, so a changed source is saved first (and the header follows) */
        if (typed !== (now.source || '')) { await store.save('dataElement', did, Object.assign(clone(now), { source: typed }), `Changed the source of '${now.name}' to ${typed}`); }
        const r = await store.api('/check/' + encodeURIComponent(did));
        check = { ok: !!r.ok, at: r.at || new Date().toISOString(), detail: r.detail || '', by: store.state.me, source: typed };
        /* mirror what the server stored, so a later save keeps it */
        const doc = (store.state.docs.dataElement || []).find(d => d.id === did); if (doc) doc.data.check = check;
        out.className = check.ok ? 'pass' : 'fail';
        out.textContent = `${check.ok ? '✓ Passed' : '✗ Failed'} ${fmtTime(check.at)}: ${check.detail}`;
      } catch (e) { out.className = 'fail'; out.textContent = 'The check could not run: ' + e.message; }
      rc.disabled = false;
    };
    const r = await pr;
    if (r.action !== 'confirm') return;
    vals = { source: (r.form.source || '').trim(), ev: (r.root.querySelector('input[name=ev]:checked') || {}).value || '', /* formValues does not read radio groups */ evlink: (r.form.evlink || '').trim(), evnote: (r.form.evnote || '').trim() };
    if (!vals.source) { err = 'Say where it comes from.'; continue; }
    const by = store.state.me, at = new Date().toISOString();
    let evidence = null;
    if (vals.ev === 'profile') {
      if (!prof) { err = 'There is no sample data check yet. Choose other proof.'; continue; }
      if (blk.length) { err = `The latest sample data check has ${blk.length} blocking difference${blk.length === 1 ? '' : 's'}. Choose other proof.`; continue; }
      evidence = { type: 'profile', ref: prof.id, at, by };
    } else if (vals.ev === 'check') {
      const c = check || cur().check;
      if (!c) { err = 'Run the connection check first.'; continue; }
      if (!c.ok) { err = 'The connection check did not pass, so it cannot be the proof.'; continue; }
      if (c.source && c.source !== vals.source) { err = `The last check probed ${c.source}, not ${vals.source}. Run the check again.`; check = null; continue; }
      evidence = { type: 'check', ref: c.at, at, by };
    } else if (vals.ev === 'attested') {
      if (!/^https?:\/\/\S+\.\S+/i.test(vals.evlink)) { err = 'Add a proof link that starts with https://'; continue; }
      if (!vals.evnote) { err = 'Add a note that says what the link shows.'; continue; }
      evidence = { type: 'attested', ref: vals.evlink, note: vals.evnote, at, by };
    } else { err = 'Choose the proof for this confirmation.'; continue; }
    const d = clone(cur());
    if (check) d.check = check;
    Object.assign(d, { avail: 'live', liveConfirmedBy: by, liveConfirmedAt: at, liveSource: vals.source, liveEvidence: evidence });
    d.source = vals.source; /* the confirmed live source is the element's source: the header shows it */
    await save(d, `Confirmed '${d.name}' is connected (from: ${vals.source}; proof: ${EVID[evidence.type].long.toLowerCase()})`);
    return;
  }
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
      title: 'Edit information',
      body: `${err ? `<div class="banner d-err" role="alert">${esc(err)}</div>` : ''}<div class="field"><label>Name</label><input name="name" value="${esc(vals.name)}" /></div>
        <div class="frow"><div class="field"><label>Owner</label><select name="owner">${personOpts(vals.owner)}</select></div><div class="field"><label>Do we have it?</label><select name="avail">${availOpts(vals.avail)}</select></div></div>
        <div class="frow"><div class="field"><label>How sensitive</label><select name="sensitivity"><option value="">Not set</option>${Object.entries(SENS).map(([k, v]) => `<option value="${k}" ${k === vals.sensitivity ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
        <div class="field"><label>Where it comes from</label><input name="source" value="${esc(vals.source || '')}" /></div></div>
        <div class="field"><label>Note</label><textarea name="note">${esc(vals.note || '')}</textarea></div>
        <span class="hint">To prove it is connected for launch, use “Confirm it’s connected” on this page: it records where it comes from and who confirmed it.</span><span class="hint">If you hand it to another owner, only they can change it afterwards.</span>`,
      actions: [{ id: 'save', label: 'Save', primary: true }],
    });
    if (r.action !== 'save') return;
    const name = (r.form.name || '').trim() || x.name;
    const dup = dupDataName(name, did);
    if (dup) { err = `Information called '${dup.name}' already exists. Choose a different name.`; vals = Object.assign({}, x, r.form); continue; }
    const d = clone(cur()); const before = d.avail, sBefore = d.sensitivity || '';
    Object.assign(d, { name, owner: r.form.owner, avail: r.form.avail, source: r.form.source.trim(), note: r.form.note.trim() });
    if (r.form.sensitivity) d.sensitivity = r.form.sensitivity; else delete d.sensitivity;
    if (d.avail !== 'live') { delete d.liveConfirmedBy; delete d.liveConfirmedAt; delete d.liveSource; delete d.liveEvidence; } /* no longer live: the confirmation no longer stands */
    const parts = [];
    if (before !== d.avail) parts.push(`status ${avOf(before).label} → ${avOf(d.avail).label}`);
    if (sBefore !== (d.sensitivity || '')) parts.push(`sensitivity ${SENS[sBefore] ? SENS[sBefore].label : 'not set'} → ${SENS[d.sensitivity] ? SENS[d.sensitivity].label : 'not set'}`);
    if (x.owner !== d.owner) parts.push(`owner → ${pname(d.owner)}`);
    await save(d, parts.length ? `Edited '${d.name}': ${parts.join(', ')}` : `Edited information '${d.name}'`);
    return;
    }
  };
  /* R7: turn the latest sample data check into rules to test, in one click */
  const uc = root.querySelector('[data-use-columns]');
  if (uc) uc.onclick = async () => {
    if (!owner()) return;
    const prof = store.list('profile', p => p.dataId === did).sort((p, q) => String(q.at).localeCompare(String(p.at)))[0];
    const fields = prof ? rulesFromProfile(prof) : [];
    if (!fields.length) { toast('The sample data check has no columns to use'); return; }
    const d = clone(cur()); if ((d.fields || []).length) { toast('This already has rules'); return; }
    d.fields = fields;
    await save(d, `Used ${fields.length} columns from the sample data check as the rules to test`);
  };
  const cl = root.querySelector('[data-confirm-live]');
  if (cl) cl.onclick = () => confirmLive(did, cur, save);
  root.querySelectorAll('[data-resolve]').forEach(b => b.onclick = async () => {
    const x = cur(); if (!canEdit(x)) { toast(onlyMsg(x)); return; }
    const i = +b.dataset.resolve; const item = (x.discovered || [])[i]; if (!item) return;
    const r = await modal({ title: 'Mark as fixed', body: `<div class="note">${esc(item.text)}</div><div class="field"><label>How it was fixed</label><textarea name="note" placeholder="e.g. Added a maximum length to the rules"></textarea></div>`, actions: [{ id: 'save', label: 'Mark fixed', primary: true }] });
    if (r.action !== 'save') return;
    const note = (r.form.note || '').trim(); if (!note) { toast('Add a note that says how it was fixed'); return; }
    const d = clone(cur()); if (!d.discovered || !d.discovered[i]) return;
    d.discovered[i].resolved = { by: store.state.me, at: new Date().toISOString(), note };
    await save(d, `Fixed something found during testing on '${d.name}': ${note.slice(0, 60)}`);
  });
  const add = root.querySelector('[data-fadd]');
  const owner = () => { const x = cur(); if (canEdit(x)) return true; toast(onlyMsg(x)); return false; };
  if (add) add.onclick = async () => { if (!owner()) return; const f = await fieldModal(null, (cur().fields || []).map(x => x.name)); if (!f) return; const d = clone(cur()); d.fields = [...(d.fields || []), f]; await save(d, `Added rule '${f.name}' to test`); };
  root.querySelectorAll('[data-fedit]').forEach(b => b.onclick = async () => { if (!owner()) return;
    const i = +b.dataset.fedit; const f = await fieldModal((cur().fields || [])[i], (cur().fields || []).map(x => x.name)); if (!f) return;
    const d = clone(cur()); if (!d.fields || !d.fields[i]) return; d.fields[i] = f; await save(d, `Edited rule '${f.name}'`);
  });
  root.querySelectorAll('[data-fdel]').forEach(b => b.onclick = async () => { if (!owner()) return;
    const i = +b.dataset.fdel; const f = (cur().fields || [])[i]; if (!f) return;
    if (!await confirmBox('Delete rule?', `Delete the rule '${f.name}'? Tests for it will no longer be made.`, 'Delete')) return;
    const d = clone(cur()); d.fields.splice(i, 1); await save(d, `Deleted rule '${f.name}'`);
  });
}
