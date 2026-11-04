/* Data element detail (stream D): /data/:did — header, spec editor, resolution plan, impact, profile, discovered requirements. */
import { store } from '../store.js';
import { esc, fmt, fmtTime, link, av, personChip, pname, dataDot, AVAIL, LOCK, modal, toast, activityCard, bindActivity } from '../ui.js';
import { eng, docs, today, flat, projectsFor, workBadge, stepBadge, notFound, confirmBox, dupDataName, opsLine } from './process.js';

const TYPES = ['text', 'digits', 'number', 'date', 'currency', 'list'];
const clone = o => JSON.parse(JSON.stringify(o));
const personOpts = sel => store.state.people.map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)} — ${esc(x.role || '')}</option>`).join('');
const availOpts = sel => Object.entries(AVAIL).map(([k, a]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(a.label)}</option>`).join('');

export const SENS = { public: { label: 'Public', cls: 'd-s-public' }, internal: { label: 'Internal', cls: 'd-s-internal' }, confidential: { label: 'Confidential', cls: 'd-s-conf' }, pii: { label: 'PII', cls: 'd-s-pii' } };
export const sensBadge = k => { const v = SENS[k]; return v ? `<span class="badge d-sens ${v.cls}" title="Sensitivity: ${esc(v.label)}">${esc(v.label)}</span>` : '<span class="badge b-none" title="Sensitivity not classified">Unclassified</span>'; };
const canEdit = x => !!x && store.state.me === x.owner;
const onlyMsg = x => `Only ${pname(x.owner)} can change this`;
/* disabled-state attributes for owner-only controls */
const gate = x => canEdit(x) ? '' : `disabled aria-disabled="true" title="${esc(onlyMsg(x))}"`;
function ruleText(f) {
  const r = [];
  if (f.required) r.push('Required');
  if (f.length != null && f.length !== '') r.push('length ' + f.length);
  if (f.min != null && f.min !== '') r.push('min ' + f.min);
  if (f.max != null && f.max !== '') r.push('max ' + f.max);
  if (f.pattern) r.push('pattern ' + f.pattern);
  if ((f.values || []).length) r.push('one of ' + f.values.join(' / '));
  if (f.rule) String(f.rule).split(/\s*[·;]\s*/).forEach(x => x && r.push(x));
  /* de-duplicate case-insensitively: a rule of "Required" plus required:true reads once */
  const seen = new Set();
  return r.filter(x => { const k = String(x).trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).join(' · ') || '—';
}

export function render(params) {
  const did = params.did;
  const x = store.get('dataElement', did);
  if (!x) return notFound('Data element “' + did + '”');
  const a = AVAIL[x.avail] || AVAIL.missing;
  const users = eng('impactOfData', [docs(), did], []).map(u => { const p = store.get('process', u.pid); const s = p && flat(p.tobe).find(y => y.id === u.stepId); return s ? { pid: u.pid, p, s } : null; }).filter(Boolean);
  const fc = eng('forecastAll', [docs(), today()], {});
  const resolver = store.list('workItem', w => w.resolves === did)[0];
  const downstream = resolver ? eng('dependents', [docs(), resolver.id], []).map(id => store.get('workItem', id)).filter(Boolean) : [];
  const ready = eng('dataReady', [docs(), did], x.avail !== 'missing');
  const usingProjects = [...new Set(users.map(u => u.pid))].flatMap(pid => projectsFor(pid));
  const testPrj = usingProjects[0];
  const profile = store.list('profile', p => p.dataId === did).sort((p, q) => String(q.at).localeCompare(String(p.at)))[0];
  const drift = profile ? eng('specDrift', [x, profile], []) : [];
  const fields = x.fields || [];

  const resolution = (x.avail === 'missing' || resolver) ? `<div class="card d-resolve ${ready ? '' : 'd-resolve-open'}" style="margin-top:16px"><h3>${LOCK} Resolution plan ${ready ? '<span class="badge b-done">Ready</span>' : ''}</h3>
    ${resolver ? `<a class="wi" href="${link('/project/' + resolver.projectId + '?mode=work')}" data-link>${av(resolver.owner)}<div style="flex:1;min-width:0"><div class="t" style="font-weight:600">${esc(resolver.title)}</div><div class="dep">${esc(pname(resolver.owner))} · planned ${esc(fmt(resolver.start))} → ${esc(fmt(resolver.due))}${fc[resolver.id] && fc[resolver.id].forecast ? ' · forecast ' + esc(fmt(fc[resolver.id].forecast)) : ''}</div></div>${workBadge(resolver, fc[resolver.id])}</a>
      ${downstream.length ? `<div class="hint" style="margin:10px 0 4px">These work items move with it:</div>${downstream.map(w => `<div class="row click" data-go="/process/${esc(w.pid)}/step/${esc(w.step)}"><div><div class="t">${esc(w.title)}</div><div class="s">${esc((store.get('process', w.pid) || {}).name || w.pid)} · ${esc(pname(w.owner))}</div></div><div class="r">${workBadge(w, fc[w.id])}</div></div>`).join('')}` : '<div class="hint" style="margin-top:8px">No other work items depend on it.</div>'}`
      : '<div class="s" style="color:var(--late);font-weight:600">No work item resolves this yet, so every step that needs it has no real date. Add a resolver work item on the project page.</div>'}</div>` : '';

  const spec = `<div class="card"><h3>Specification <span class="n">${fields.length} field${fields.length === 1 ? '' : 's'}</span></h3>
    ${fields.length ? `<div class="tbl-wrap"><table class="d-spec"><tr><th>Field</th><th>Type</th><th>Format</th><th>Rules</th><th><span class="d-sr">Actions</span></th></tr>${fields.map((f, i) => `<tr><td><b>${esc(f.name)}</b></td><td>${esc(f.type || 'text')}</td><td>${esc(f.format || '—')}</td><td class="d-rule">${esc(ruleText(f))}</td>
      <td class="d-acts"><button class="btn sm" data-fedit="${i}" aria-label="Edit field ${esc(f.name)}" ${gate(x)}>Edit</button><button class="btn sm danger" data-fdel="${i}" aria-label="Delete field ${esc(f.name)}" ${gate(x)}>Delete</button></td></tr>`).join('')}</table></div>` : '<div class="s">No fields specified yet. Describe each field so test cases can be generated.</div>'}
    <div class="d-ownerrow"><button class="btn sm" data-fadd ${gate(x)}>+ Add field</button>${canEdit(x) ? '' : `<span class="d-only">${LOCK} ${esc(onlyMsg(x))}</span>`}</div></div>`;

  const examples = `<div class="card"><h3>Examples on file <span class="n">${(x.samples || []).length}</span></h3>${(x.samples || []).length ? x.samples.map(f => `<div class="row"><span>📄</span><div><div class="t">${esc(f)}</div><div class="s">Sample artifact (concept, not downloadable)</div></div></div>`).join('') : '<div class="s">None. Nobody has produced a real example of this data yet.</div>'}
    ${x.sampleCsv ? '<div class="hint" style="margin-top:8px">A synthetic sample extract is on file for profiling.</div>' : ''}</div>`;

  const impact = `<div class="card" style="margin-top:16px"><h3>Impact: every step that depends on this <span class="n">${users.length}</span></h3>${users.length ? `<div class="tbl-wrap"><table><tr><th>Step</th><th>Process</th><th>Owner</th><th>Project</th></tr>
    ${users.map(u => { const prj = projectsFor(u.pid)[0]; const st = prj ? eng('stepState', [docs(), prj.id, u.pid, u.s.id, today()], null) : null; return `<tr class="click" data-go="/process/${esc(u.pid)}/step/${esc(u.s.id)}"><td><a href="${link('/process/' + u.pid + '/step/' + u.s.id)}" data-link><b>${esc(u.s.title)}</b></a></td><td>${esc(u.p.name)}</td><td>${esc(pname(u.s.owner))}</td><td class="d-nowrap">${prj ? stepBadge(st) : '<span class="hint">No project</span>'}</td></tr>`; }).join('')}</table></div>` : '<div class="s">No to-be step uses this data element yet.</div>'}</div>`;

  const prof = `<div class="card" style="margin-top:16px"><h3>Latest profile ${profile ? `<span class="n">${esc(profile.rows)} rows · ${esc(fmtTime(profile.at))}</span>` : ''}</h3>
    ${profile ? `<div class="hint" style="margin:-4px 0 8px">Statistics only. Examples are masked: digits become 9, letters x/X, first and last character kept.</div>
      <div class="tbl-wrap"><table class="d-prof"><tr><th>Column</th><th>Nulls</th><th>Distinct</th><th>Length</th><th>Range</th><th>Top patterns</th><th>Masked examples</th></tr>${(profile.columns || []).map(c => `<tr><td><b>${esc(c.name)}</b>${(c.specials || []).length ? `<div class="hint">specials ${esc(c.specials.join(' '))}</div>` : ''}</td><td>${esc(c.nulls)}</td><td>${esc(c.distinct)}</td><td>${esc(c.minLen)}–${esc(c.maxLen)}</td><td>${c.min != null ? esc(c.min) + ' – ' + esc(c.max) : '—'}</td>
        <td>${(c.patterns || []).slice(0, 3).map(pt => `<code class="d-code">${esc(pt.pattern)}</code> <span class="hint">×${esc(pt.count)}</span>`).join('<br>') || '—'}</td><td>${(c.examples || []).slice(0, 3).map(e => `<code class="d-code">${esc(e)}</code>`).join(' ') || '—'}</td></tr>`).join('')}</table></div>
      <h3 style="margin-top:14px">Spec drift <span class="n">${drift.length}</span></h3>${drift.length ? drift.map(d => `<div class="row"><span class="fail" aria-hidden="true">●</span><div><div class="t">${esc(d.field)}: ${esc(d.issue)}</div><div class="s">${esc(d.detail)}</div></div></div>`).join('') : '<div class="s pass">The profile matches the specification.</div>'}`
    : '<div class="s">No profile yet. Profiling computes column statistics from a sample extract and compares them with the specification.</div>'}
    ${testPrj ? `<div style="margin-top:10px"><a class="btn sm" href="${link('/testing/' + testPrj.id)}" data-link>Run profiling in ${esc(testPrj.name)} ›</a></div>` : '<div class="hint" style="margin-top:8px">Link a process that uses this data to a project to run profiling.</div>'}</div>`;

  const dlist = x.discovered || [], open = dlist.filter(d => !d.resolved).length;
  const disc = `<div class="card"><h3>Discovered requirements <span class="n">${open} open · ${dlist.length - open} resolved</span></h3>${dlist.length ? dlist.map((d, i) => `<div class="row d-disc ${d.resolved ? 'd-resolved' : ''}"><span aria-hidden="true">${d.resolved ? '✓' : '🔎'}</span><div style="flex:1;min-width:0"><div class="t">${esc(d.text)}</div><div class="s">${d.fromRun ? 'Found in test run ' + esc(d.fromRun) + ' · ' : ''}${esc(fmtTime(d.at))}</div>
      ${d.resolved ? `<div class="d-resnote"><b>Resolved</b> by ${esc(pname(d.resolved.by))} · ${esc(fmtTime(d.resolved.at))}${d.resolved.note ? ': ' + esc(d.resolved.note) : ''}</div>` : ''}</div>
      ${d.resolved ? '' : `<div class="r"><button class="btn sm" data-resolve="${i}" ${gate(x)}>Resolve</button></div>`}</div>`).join('') + (open && !canEdit(x) ? `<div class="d-only">${LOCK} ${esc(onlyMsg(x))}</div>` : '') : '<div class="s">Nothing discovered yet. Requirements found during testing land here.</div>'}</div>`;

  return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> › Data element</div><h1>${esc(x.name)}</h1>${x.note ? `<p>${esc(x.note)}</p>` : ''}
    <div class="res"><span class="lbl">Owner</span>${personChip(x.owner) || '<span class="hint">None</span>'}<span class="chip">${esc(x.source || 'Source not set')}</span><span class="chip">${dataDot(did)}${esc(a.label)}</span>${sensBadge(x.sensitivity)}</div></div>
    <div class="hdr-side"><div class="d-ownerrow d-right">${canEdit(x) ? '' : `<span class="d-only">${LOCK} ${esc(onlyMsg(x))}</span>`}<button class="btn" data-dedit ${gate(x)}>Edit</button></div><div class="kpis"><div class="kpi"><b>${users.length}</b><span>Steps use it</span></div><div class="kpi"><b>${new Set(users.map(u => u.pid)).size}</b><span>Processes</span></div><div class="kpi"><b style="color:${downstream.length && !ready ? 'var(--late)' : 'inherit'}">${downstream.length}</b><span>Work items waiting</span></div></div></div></section>
  ${resolution}
  <div class="two">${spec}${examples}</div>
  ${impact}
  ${prof}
  <div class="two">${disc}<div></div></div>
  <div class="two">${activityCard('dataElement:' + did)}</div>`;
}

async function fieldModal(f) {
  f = f || {};
  const r = await modal({
    title: f.name ? `Edit field '${f.name}'` : 'Add field',
    body: `<div class="frow"><div class="field"><label>Name</label><input name="name" value="${esc(f.name || '')}" placeholder="e.g. Routing number" /></div>
      <div class="field"><label>Type</label><select name="type">${TYPES.map(t => `<option ${t === (f.type || 'text') ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
      <div class="frow"><div class="field"><label>Format</label><input name="format" value="${esc(f.format || '')}" placeholder="e.g. 9 digits" /></div>
      <div class="field"><label>Rule (plain words)</label><input name="rule" value="${esc(f.rule || '')}" placeholder="e.g. Must match legal name" /></div></div>
      <div class="frow d-frow3"><div class="field"><label>Min</label><input name="min" value="${esc(f.min != null ? f.min : '')}" /></div>
      <div class="field"><label>Max</label><input name="max" value="${esc(f.max != null ? f.max : '')}" /></div>
      <div class="field"><label>Length</label><input name="length" inputmode="numeric" value="${esc(f.length != null ? f.length : '')}" /></div></div>
      <div class="field"><label>Pattern (regular expression)</label><input name="pattern" value="${esc(f.pattern || '')}" placeholder="e.g. ^\\d{9}$" /></div>
      <div class="field"><label>Allowed values (comma separated, for lists)</label><input name="values" value="${esc((f.values || []).join(', '))}" /></div>
      <label class="d-check"><input type="checkbox" name="required" value="yes" ${f.required ? 'checked' : ''} /> Required</label>`,
    actions: [{ id: 'save', label: f.name ? 'Save field' : 'Add field', primary: true }],
  });
  if (r.action !== 'save') return null;
  const v = r.form; const name = (v.name || '').trim(); if (!name) { toast('A field needs a name'); return null; }
  if (v.pattern) { try { new RegExp(v.pattern); } catch (e) { toast('Pattern is not a valid regular expression'); return null; } }
  const num = s => { s = String(s || '').trim(); if (s === '') return undefined; const n = Number(s); return isNaN(n) ? s : n; };
  const out = { name, type: v.type, format: v.format.trim(), rule: v.rule.trim(), required: (v.required || []).includes('yes') };
  ['min', 'max', 'length'].forEach(k => { const n = num(v[k]); if (n !== undefined) out[k] = n; });
  if (v.pattern.trim()) out.pattern = v.pattern.trim();
  const vals = v.values.split(',').map(s => s.trim()).filter(Boolean); if (vals.length) out.values = vals;
  return out;
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
        ${''}<span class="hint">Handing ownership to someone else means only they can edit this element afterwards.</span>`,
      actions: [{ id: 'save', label: 'Save', primary: true }],
    });
    if (r.action !== 'save') return;
    const name = (r.form.name || '').trim() || x.name;
    const dup = dupDataName(name, did);
    if (dup) { err = `A data element called '${dup.name}' already exists. Choose a different name.`; vals = Object.assign({}, x, r.form); continue; }
    const d = clone(cur()); const before = d.avail, sBefore = d.sensitivity || '';
    Object.assign(d, { name, owner: r.form.owner, avail: r.form.avail, source: r.form.source.trim(), note: r.form.note.trim() });
    if (r.form.sensitivity) d.sensitivity = r.form.sensitivity; else delete d.sensitivity;
    const parts = [];
    if (before !== d.avail) parts.push(`availability ${AVAIL[before] ? AVAIL[before].short : before} → ${AVAIL[d.avail].short}`);
    if (sBefore !== (d.sensitivity || '')) parts.push(`sensitivity ${SENS[sBefore] ? SENS[sBefore].label : 'unclassified'} → ${SENS[d.sensitivity] ? SENS[d.sensitivity].label : 'unclassified'}`);
    if (x.owner !== d.owner) parts.push(`owner → ${pname(d.owner)}`);
    await save(d, parts.length ? `Edited '${d.name}': ${parts.join(', ')}` : `Edited data element '${d.name}'`);
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
  if (add) add.onclick = async () => { if (!owner()) return; const f = await fieldModal(); if (!f) return; const d = clone(cur()); d.fields = [...(d.fields || []), f]; await save(d, `Added field '${f.name}' to the specification`); };
  root.querySelectorAll('[data-fedit]').forEach(b => b.onclick = async () => { if (!owner()) return;
    const i = +b.dataset.fedit; const f = await fieldModal((cur().fields || [])[i]); if (!f) return;
    const d = clone(cur()); if (!d.fields || !d.fields[i]) return; d.fields[i] = f; await save(d, `Edited field '${f.name}' in the specification`);
  });
  root.querySelectorAll('[data-fdel]').forEach(b => b.onclick = async () => { if (!owner()) return;
    const i = +b.dataset.fdel; const f = (cur().fields || [])[i]; if (!f) return;
    if (!await confirmBox('Delete field?', `Delete '${f.name}' from the specification? Generated test cases for it will no longer be produced.`, 'Delete')) return;
    const d = clone(cur()); d.fields.splice(i, 1); await save(d, `Deleted field '${f.name}' from the specification`);
  });
}
