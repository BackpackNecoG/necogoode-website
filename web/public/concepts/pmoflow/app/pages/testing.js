/* Testing page (stream R): data profiling (statistics only), spec drift, generated test cases, process UAT scripts,
   step-level test runs with evidence and defects, discovered requirements. Route: /testing/:prj */
import { store } from '../store.js';
import { E, esc, fmt, fmtTime, addDays, link, go, av, pname, badge, modal, toast, commentsPanel, historyPanel, bindActivity } from '../ui.js';

const ui = { sel: {}, paste: '', pasteOpen: false, busy: false, runOpen: new Set(), scriptOpen: new Set() };

function flat(nodes) { const e = E(); return e && e.flatSteps ? e.flatSteps(nodes || []) : (nodes || []).filter(n => n.type === 'step'); }
function projectData(prj) {
  const ids = new Set();
  (prj.processes || []).map(id => store.get('process', id)).filter(Boolean).forEach(p => flat(p.tobe && p.tobe.length ? p.tobe : p.asis).forEach(s => {
    (s.data || []).forEach(d => ids.add(d)); (s.subs || []).forEach(sb => (sb.data || []).forEach(d => ids.add(d)));
  }));
  return [...ids].map(id => store.get('dataElement', id)).filter(Boolean);
}
const latestProfile = did => store.list('profile', p => p.dataId === did).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null;
const casesFor = did => store.list('testCase', c => c.dataId === did);
const runsFor = prjId => store.list('testRun', r => r.projectId === prjId).sort((a, b) => String(b.at).localeCompare(String(a.at)));
const KIND_CLS = { valid: 'b-done', boundary: 'b-soon', invalid: 'b-late', edge: 'b-prog', custom: 'b-idle' };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const short = v => { const t = String(v); return t.length > 44 ? esc(t.slice(0, 40)) + `… <small>(${t.length} chars)</small>` : esc(t); };
const OUT_CLS = { pass: 'b-done', fail: 'b-late', blocked: 'b-soon' };
const rid = x => x.caseId || x.scriptId;
const isUrl = v => /^https?:\/\/\S+$/i.test(String(v || '').trim());

function testsCheck(prjId) {
  const e = E(); if (!e || !e.readiness) return null;
  try { return (e.readiness(store.state.docs, prjId, store.state.today).checks || []).find(c => c.id === 'tests-passed') || null; } catch (err) { return null; }
}

/* UAT scripts: the project's adopted (editable) copy, else the engine's generated set (read-only preview). */
function generated(prjId) { const e = E(); if (!e || !e.generateUatScripts) return []; try { return e.generateUatScripts(store.state.docs, prjId) || []; } catch (err) { return []; } }
function scriptsFor(prj) { return Array.isArray(prj.uatScripts) ? { list: prj.uatScripts, adopted: true } : { list: generated(prj.id), adopted: false }; }

/* Walk the to-be tree (branches included) to find a node by id. */
function findNode(nodes, id) { for (const n of nodes || []) { if (!n) continue; if (n.id === id) return n; for (const b of n.branches || []) { const f = findNode(b && b.nodes, id); if (f) return f; } } return null; }
function stepLabel(pid, stepId) { const p = store.get('process', pid); const n = p && findNode(p.tobe, stepId); return { proc: p ? p.name : pid, step: n ? n.title : stepId, owner: n && n.owner }; }
function firstStepUsing(prj, dataId) {
  for (const pid of prj.processes || []) { const p = store.get('process', pid); if (!p) continue;
    const s = flat(p.tobe && p.tobe.length ? p.tobe : p.asis).find(x => (x.data || []).includes(dataId) || (x.subs || []).some(sb => (sb.data || []).includes(dataId)));
    if (s) return { pid, step: s.id }; }
  return { pid: (prj.processes || [])[0] || '', step: '' };
}

function coverage(run, ids) {
  if (!run) return null;
  const by = {}; (run.results || []).forEach(x => { by[rid(x)] = x.outcome; });
  const covered = ids.filter(id => by[id]).length;
  const fails = ids.filter(id => by[id] === 'fail').length, blocked = ids.filter(id => by[id] === 'blocked').length;
  return { covered, total: ids.length, fails, blocked, pass: ids.filter(id => by[id] === 'pass').length };
}

export function render(params) {
  const prjId = params.prj;
  const prj = store.get('project', prjId);
  const projects = store.list('project');
  if (!prj) return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> · Testing</div><h1>Testing</h1><p>Project not found.</p></div></section>
    <div class="home-grid">${projects.map(p => `<a class="tile" href="${link('/testing/' + p.id)}" data-link><h4>${esc(p.name)}</h4><p>${esc(p.desc || '')}</p></a>`).join('') || '<div class="empty">No projects yet.</div>'}</div>`;
  const des = projectData(prj);
  let did = params.q && params.q.de && des.some(d => d.id === params.q.de) ? params.q.de : ui.sel[prjId];
  if (!des.some(d => d.id === did)) did = des[0] && des[0].id;
  ui.sel[prjId] = did;
  const de = did ? store.get('dataElement', did) : null;
  const tc = testsCheck(prjId);
  const runs = runsFor(prjId);
  const lastDev = runs.find(r => r.env === 'dev'), lastUat = runs.find(r => r.env === 'uat');
  const caseIds = []; des.forEach(d => casesFor(d.id).forEach(c => caseIds.push(c.id)));
  const sc = scriptsFor(prj);
  const devCov = coverage(lastDev, caseIds), uatCov = coverage(lastUat, caseIds.concat(sc.list.map(x => x.id)));
  const covKpi = (label, cov, attr) => { const full = cov && cov.covered === cov.total && !cov.fails && !cov.blocked;
    return `<div class="kpi" data-cov="${attr}"><b class="${cov ? (full ? 'pass' : 'fail') : ''}">${cov ? `${cov.covered}/${cov.total}` : '—'}</b><span>${label}${cov && cov.fails ? ` · ${cov.fails} fail` : ''}</span></div>`; };
  const openDefects = store.list('workItem', w => w.projectId === prjId && w.kind === 'defect' && w.status !== 'done').length;

  const header = `<section class="hdr"><div>
      <div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> · <a href="${link('/project/' + prjId)}" data-link>${esc(prj.name)}</a> · Testing</div>
      <div class="rl-title"><h1>Testing</h1><select class="rl-switch" data-switch aria-label="Project">${projects.map(p => `<option value="${esc(p.id)}" ${p.id === prjId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <p>Data tests come from each data element's spec plus a statistical profile of a real extract (counts, lengths and patterns only, never raw values). Process UAT scripts walk every new or changed step and every branch.</p></div>
    <div class="hdr-side"><div class="kpis"><div class="kpi"><b>${caseIds.length}</b><span>Data cases</span></div><div class="kpi"><b>${sc.list.length}</b><span>UAT scripts</span></div>${covKpi('Dev coverage · cases', devCov, 'dev')}${covKpi('UAT coverage · cases + scripts', uatCov, 'uat')}<div class="kpi"><b class="${openDefects ? 'fail' : ''}">${openDefects}</b><span>Open defects</span></div></div></div></section>
    ${tc ? `<div class="ts-strip ${tc.pass ? 'pass' : 'fail'}" data-tests-check="${tc.pass ? 'pass' : 'fail'}"><span class="rl-ic ${tc.pass ? 'pass' : 'fail'}">${tc.pass ? '✓' : '✕'}</span>
      <div><b>Go-live check: ${esc(tc.label)}</b> — ${esc(tc.detail || '')}</div><a class="rl-go" href="${link('/release/' + prjId)}" data-link>Readiness gate ›</a></div>` : ''}`;

  const projectCards = `<div class="ts-proj">${scriptsCard(prj, sc, lastUat)}${runsCard(prj, des, runs, caseIds, sc)}
    <div class="card"><h3>Test history</h3><div data-ts-history><div class="hint">Loading…</div></div></div></div>`;

  if (!des.length) return header + `<div class="card" style="margin-top:16px"><div class="empty">This project's processes use no data elements yet. Add data to the to-be steps to test it.</div></div>` + projectCards;

  const list = `<nav class="ts-list" aria-label="Data elements">${des.map(d => {
    const p = latestProfile(d.id); const n = casesFor(d.id).length; const openReq = (d.discovered || []).filter(x => !x.resolved).length;
    return `<a href="${link('/testing/' + prjId + '?de=' + d.id)}" data-de="${esc(d.id)}" class="${d.id === did ? 'on' : ''}"><span class="ts-dot ${esc(d.avail || 'missing')}"></span><span class="ts-nm">${esc(d.name)}</span><small>${n} case${n === 1 ? '' : 's'}${p ? ' · profiled' : ''}${openReq ? ` · <b class="ts-open">${openReq} open req${openReq === 1 ? '' : 's'}</b>` : ''}</small></a>`;
  }).join('')}</nav>`;

  return header + `<div class="ts-layout">${list}<div class="ts-main">${profileCard(de)}${casesCard(de)}${discoveredCard(de)}
    <div class="two ts-act"><div class="card"><h3>Comments</h3>${commentsPanel('dataElement:' + de.id)}</div><div class="card"><h3>History · ${esc(de.name)}</h3>${historyPanel('dataElement:' + de.id)}</div></div></div></div>` + projectCards;
}

function profileCard(de) {
  const prof = latestProfile(de.id);
  const e = E();
  let drift = [];
  if (prof && e && e.specDrift) { try { drift = e.specDrift(de, prof) || []; } catch (err) { drift = []; } }
  const driftBy = {}; drift.forEach(d => (driftBy[norm(d.field)] = driftBy[norm(d.field)] || []).push(d));
  const cols = prof ? (prof.columns || []).map(c => {
    const iss = driftBy[norm(c.name)] || [];
    return `<tr class="${iss.length ? 'ts-drift' : ''}"><td><b>${esc(c.name)}</b>${iss.map(i => `<div class="ts-iss">⚠ ${esc(i.issue)}${i.detail ? ': ' + esc(i.detail) : ''}</div>`).join('')}</td>
      <td>${esc(c.nulls)}</td><td>${esc(c.distinct)}</td><td>${esc(c.minLen)}–${esc(c.maxLen)}</td>
      <td>${(c.patterns || []).slice(0, 3).map(p => `<code>${esc(p.pattern)}</code> <small>×${esc(p.count)}</small>`).join('<br>')}</td>
      <td>${(c.examples || []).slice(0, 3).map(x => `<code>${esc(x)}</code>`).join(' ')}</td></tr>`;
  }).join('') : '';
  const unattached = prof ? drift.filter(d => !(prof.columns || []).some(c => norm(c.name) === norm(d.field))) : [];
  return `<div class="card"><h3>Profile data · ${esc(de.name)}${prof ? `<span class="n">${esc(prof.rows)} rows · ${esc(fmtTime(prof.at))}</span>` : ''}</h3>
    <div class="ts-prof-tools">
      ${de.sampleCsv ? `<button class="btn sm primary" data-prof-sample ${ui.busy ? 'disabled' : ''}>Profile sample extract</button>` : ''}
      <label class="btn sm ts-file">Upload CSV<input type="file" accept=".csv,text/csv" data-prof-file hidden></label>
      <button class="btn sm" data-paste-toggle>${ui.pasteOpen ? 'Hide paste box' : 'Paste CSV'}</button>
      <span class="hint">Read in your browser, sent to the in-tenant profiler, reduced to statistics.</span></div>
    ${ui.pasteOpen ? `<div class="field ts-paste"><textarea data-paste placeholder="Paste CSV with a header row">${esc(ui.paste)}</textarea><div><button class="btn sm primary" data-prof-paste>Profile pasted data</button></div></div>` : ''}
    ${prof ? `<div class="ts-raw">🔒 Raw values were not stored. Examples are masked: digits → 9, letters → x/X, first and last character kept.</div>
      ${unattached.length ? `<div class="ts-iss">${unattached.map(i => `⚠ ${esc(i.field)}: ${esc(i.issue)}${i.detail ? ' — ' + esc(i.detail) : ''}`).join('<br>')}</div>` : ''}
      ${drift.length ? `<div class="ts-driftsum" data-drift-count="${drift.length}"><b>${drift.length} spec drift issue${drift.length === 1 ? '' : 's'}</b> — the real data does not match the documented spec. Generate tests to cover it, or update the spec on the <a href="${link('/data/' + de.id)}" data-link>data page</a>.</div>` : `<div class="ts-ok">Profile matches the documented spec.</div>`}
      <div class="tbl-wrap"><table class="ts-tbl"><thead><tr><th>Column</th><th>Nulls</th><th>Distinct</th><th>Length</th><th>Patterns</th><th>Masked examples</th></tr></thead><tbody>${cols}</tbody></table></div>`
      : `<div class="empty">No profile yet. ${de.sampleCsv ? 'Profile the sample extract to compare real data with the spec.' : 'Upload or paste a CSV extract to profile it.'}</div>`}</div>`;
}

function casesCard(de) {
  const cases = casesFor(de.id).sort((a, b) => (a.field + a.kind).localeCompare(b.field + b.kind));
  return `<div class="card"><h3>Test cases<span class="n">${cases.length}</span></h3>
    <div class="ts-prof-tools"><button class="btn sm primary" data-gen>Generate test cases</button><button class="btn sm" data-add-case>Add custom case</button>
      <span class="hint">Generated from the spec${latestProfile(de.id) ? ' and the latest profile' : ''}. Duplicates are skipped.</span></div>
    ${cases.length ? `<div class="tbl-wrap ts-scroll"><table class="ts-tbl"><thead><tr><th>Field</th><th>Kind</th><th>Input</th><th>Expect</th><th>Origin</th><th></th></tr></thead><tbody>
      ${cases.map(c => `<tr data-case="${esc(c.id)}"><td>${esc(c.field)}</td><td>${badge(c.kind, KIND_CLS[c.kind])}</td><td><code class="ts-in" title="${esc(c.input)}">${c.input === '' ? '<i>(empty)</i>' : short(c.input)}</code>${c.note ? `<div class="hint">${esc(c.note)}</div>` : ''}</td>
        <td>${badge(c.expect, c.expect === 'accept' ? 'b-done' : 'b-late')}</td><td><span class="chip">${esc(c.origin)}</span></td>
        <td class="rl-acts"><button class="btn sm" data-edit-case="${esc(c.id)}">Edit</button><button class="btn sm danger" data-del-case="${esc(c.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No test cases yet. Generate them from the spec and profile.</div>'}</div>`;
}


function scriptsCard(prj, sc, lastUat) {
  const outBy = {}; (lastUat ? lastUat.results || [] : []).forEach(x => { if (x.scriptId) outBy[x.scriptId] = x.outcome; });
  const gen = sc.adopted ? generated(prj.id) : [];
  const have = new Set(sc.list.map(x => x.id));
  const fresh = gen.filter(x => !have.has(x.id));
  const rows = sc.list.map(s => {
    const lb = stepLabel(s.pid, s.step); const o = outBy[s.id];
    return `<details class="ts-script" data-script="${esc(s.id)}" ${ui.scriptOpen && ui.scriptOpen.has(s.id) ? 'open' : ''}>
      <summary><span class="ts-script-h"><b>${esc(s.title)}</b>${o ? badge(o, OUT_CLS[o]) : badge('not run', 'b-idle')}</span>
      <span class="hint">${esc(lb.proc)} · ${esc(lb.step)}${lb.owner ? ' · ' + esc(pname(lb.owner)) : ''}</span></summary>
      <div class="ts-script-b"><dl class="ts-gwt"><dt>Given</dt><dd>${esc(s.given)}</dd><dt>When</dt><dd>${esc(s.when)}</dd><dt>Then</dt><dd>${esc(s.then)}</dd>
        ${(s.data || []).length ? `<dt>Data</dt><dd>${(s.data || []).map(d => `<span class="chip">${esc((store.get('dataElement', d) || {}).name || d)}</span>`).join(' ')}</dd>` : ''}</dl>
      <div class="ts-script-a"><a class="rl-go" href="${link(`/process/${s.pid}?mode=diff`)}" data-link>Open step in the process ›</a>${sc.adopted ? `<button class="btn sm" data-edit-script="${esc(s.id)}">Edit</button><button class="btn sm danger" data-del-script="${esc(s.id)}">Delete</button>` : ''}</div></div></details>`;
  }).join('');
  return `<div class="card" id="uat-scripts"><h3>Process UAT scripts<span class="n">${sc.list.length}${sc.adopted ? ' · adopted' : ' · generated'}</span></h3>
    ${sc.adopted
      ? `<div class="ts-prof-tools"><span class="hint">Adopted into this project: edit the given/when/then and data. The latest UAT run must cover every script with zero fails or blocks.</span>${fresh.length ? `<button class="btn sm" data-add-gen>Add ${fresh.length} newly generated</button>` : ''}</div>`
      : `<div class="ts-adopt"><div><b>Generated from the to-be design</b> · one script per new or changed step and one per gateway branch. Adopt them to edit and keep them with the project.</div><button class="btn sm primary" data-adopt ${sc.list.length ? '' : 'disabled'}>Adopt generated scripts</button></div>`}
    <div class="ts-scripts">${rows || '<div class="empty">No new or changed steps in the to-be design, so there is nothing to script yet.</div>'}</div></div>`;
}

function runsCard(prj, des, runs, caseIds, sc) {
  const caseIdx = {}; des.forEach(d => casesFor(d.id).forEach(c => caseIdx[c.id] = c));
  const scIdx = {}; sc.list.forEach(s => scIdx[s.id] = s);
  const me = store.state.me;
  return `<div class="card" id="runs"><h3>Test runs<span class="n">${runs.length}</span></h3>
    <div class="ts-prof-tools"><button class="btn sm primary" data-record>Record test run</button><span class="hint">Dev runs cover data cases; UAT runs cover data cases and UAT scripts. Every row starts as not run.</span></div>
    ${runs.length ? runs.map(r => {
      const ids = r.env === 'uat' ? caseIds.concat(sc.list.map(x => x.id)) : caseIds;
      const cov = coverage(r, ids);
      const c = (r.results || []).reduce((a, x) => (a[x.outcome] = (a[x.outcome] || 0) + 1, a), {});
      const open = ui.runOpen.has(r.id);
      const rows = (r.results || []).filter(x => x.outcome !== 'pass' || x.evidence || x.defectId);
      const partial = cov && cov.covered < cov.total;
      return `<div class="ts-run" data-run="${esc(r.id)}"><div class="ts-run-h" data-run-toggle="${esc(r.id)}"><span class="chip">${esc(String(r.env).toUpperCase())}</span>
        <b>${esc(fmtTime(r.at))}</b><span class="hint">${av(r.by)} ${esc(pname(r.by))}</span>
        <span class="ts-cov ${partial ? 'partial' : 'full'}" data-run-cov>covers ${cov ? cov.covered : 0}/${cov ? cov.total : 0} ${r.env === 'uat' ? 'cases + scripts' : 'cases'}</span>
        <span class="ts-counts">${badge((c.pass || 0) + ' pass', 'b-done')}${c.fail ? badge(c.fail + ' fail', 'b-late') : ''}${c.blocked ? badge(c.blocked + ' blocked', 'b-soon') : ''}</span><span class="rl-chev">${open ? '▾' : '▸'}</span></div>
        ${open ? `<div class="ts-run-b">${partial ? `<div class="ts-warn">${cov.total - cov.covered} of ${cov.total} not run in this ${esc(String(r.env).toUpperCase())} run.</div>` : ''}
          ${rows.map(x => resultRow(prj, r, x, caseIdx, scIdx, me)).join('') || '<div class="hint">Every recorded row passed.</div>'}</div>` : ''}</div>`;
    }).join('') : '<div class="empty">No runs recorded yet.</div>'}</div>`;
}

function resultLabel(x, caseIdx, scIdx) {
  if (x.scriptId) { const s = scIdx[x.scriptId]; return s ? `<b>UAT · ${esc(s.title)}</b>` : `<b>UAT script</b> ${esc(x.scriptId)}`; }
  const tcse = caseIdx[x.caseId]; const de = tcse && store.get('dataElement', tcse.dataId);
  return tcse ? `<b>${esc(de ? de.name : '')} · ${esc(tcse.field)}</b> <code>${short(tcse.input)}</code> expected ${esc(tcse.expect)}` : esc(x.caseId);
}
function resultRow(prj, r, x, caseIdx, scIdx, me) {
  const tcse = x.caseId && caseIdx[x.caseId]; const de = tcse && store.get('dataElement', tcse.dataId);
  const logged = de && (de.discovered || []).some(d => d.fromRun === r.id && d.caseId === x.caseId);
  const key = `${esc(r.id)}|${esc(rid(x))}`;
  const dfx = x.defectId ? store.get('workItem', x.defectId) : null;
  const canClose = dfx && dfx.status !== 'done' && (me === dfx.owner || me === prj.owner);
  const ev = x.evidence ? (isUrl(x.evidence) ? `<a href="${esc(x.evidence.trim())}" target="_blank" rel="noopener noreferrer">${esc(x.evidence.trim())}</a>` : esc(x.evidence)) : '';
  return `<div class="ts-fail" data-result="${esc(rid(x))}">${badge(x.outcome, OUT_CLS[x.outcome])} <span>${resultLabel(x, caseIdx, scIdx)}${x.note ? ` — <i>${esc(x.note)}</i>` : ''}${ev ? `<div class="ts-ev">Evidence: ${ev}</div>` : ''}</span>
    <span class="ts-fail-a">${dfx ? `<a class="chip ts-defect ${dfx.status === 'done' ? 'closed' : ''}" href="${link('/project/' + prj.id + '?mode=work')}" data-link data-defect="${esc(dfx.id)}">Defect · ${esc(pname(dfx.owner))} · ${dfx.status === 'done' ? 'closed' : 'due ' + esc(fmt(dfx.due))}</a>${canClose ? `<button class="btn sm" data-close-defect="${esc(dfx.id)}">Close defect</button>` : ''}`
      : x.outcome === 'fail' ? `<button class="btn sm" data-mk-defect="${key}">Create defect</button>` : ''}
    ${x.outcome === 'fail' && tcse ? (logged ? '<span class="hint">Logged as requirement</span>' : `<button class="btn sm" data-discover="${key}">Log as discovered requirement</button>`) : ''}</span></div>`;
}

function discoveredCard(de) {
  const list = de.discovered || [];
  const me = store.state.me; const owner = de.owner === me;
  const open = list.filter(d => !d.resolved).length;
  return `<div class="card" id="discovered"><h3>Discovered requirements · ${esc(de.name)}<span class="n">${open} open · ${list.length}</span></h3>
    ${list.length ? list.map((d, i) => `<div class="row ts-req ${d.resolved ? 'done' : ''}" data-req="${i}"><span class="ts-bulb">${d.resolved ? '✓' : '◆'}</span><div style="flex:1;min-width:0"><div class="t">${esc(d.text)}</div>
      <div class="s">From run ${esc(fmtTime((store.get('testRun', d.fromRun) || {}).at) || d.fromRun)} · ${esc(fmtTime(d.at))}</div>
      ${d.resolved ? `<div class="ts-resolved">Resolved by ${esc(pname(d.resolved.by))} · ${esc(fmtTime(d.resolved.at))}${d.resolved.note ? ` — “${esc(d.resolved.note)}”` : ''}</div>` : ''}</div>
      ${d.resolved ? '' : owner ? `<button class="btn sm primary" data-resolve="${i}">Resolve</button>` : `<span class="hint ts-why" data-why>Only the data owner (${esc(pname(de.owner))}) can resolve.</span>`}</div>`).join('')
      : '<div class="hint">Failures that reveal a rule nobody documented get logged here and sent to the data owner. Go-live needs every one resolved.</div>'}</div>`;
}

/* ---------- bind ---------- */
export function bind(root, params) {
  const prjId = params.prj;
  const sw = root.querySelector('[data-switch]'); if (sw) sw.onchange = () => go('/testing/' + sw.value);
  const prj = store.get('project', prjId); if (!prj) return;
  const did = ui.sel[prjId]; const de = did && store.get('dataElement', did);
  root.querySelectorAll('[data-de]').forEach(a => a.onclick = e => { e.preventDefault(); ui.sel[prjId] = a.dataset.de; history.replaceState({}, '', link('/testing/' + prjId)); store.emit(); });
  bindProject(root, prj);
  if (!de) return;

  const runProfile = async (csv, label) => {
    if (!csv || !csv.trim()) { toast('No CSV data to profile.'); return; }
    ui.busy = true;
    try {
      const prof = await store.api('/profile/' + de.id, { csv });
      if (prof && prof.id && !store.get('profile', prof.id)) { (store.state.docs.profile = store.state.docs.profile || []).push({ id: prof.id, data: prof }); }
      await store.load();
      toast(`Profiled ${label}: ${prof && prof.rows != null ? prof.rows + ' rows' : 'done'}. Raw values were not stored.`);
    } catch (e) { toast('Profiling failed: ' + e.message); }
    finally { ui.busy = false; store.emit(); }
  };
  const s = root.querySelector('[data-prof-sample]'); if (s) s.onclick = () => runProfile(de.sampleCsv, 'sample extract');
  const f = root.querySelector('[data-prof-file]');
  if (f) f.onchange = () => { const file = f.files[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { toast('File is over 2 MB.'); return; } const rd = new FileReader(); rd.onload = () => runProfile(String(rd.result), file.name); rd.readAsText(file); };
  const pt = root.querySelector('[data-paste-toggle]'); if (pt) pt.onclick = () => { ui.pasteOpen = !ui.pasteOpen; store.emit(); };
  const ta = root.querySelector('[data-paste]'); if (ta) ta.oninput = () => { ui.paste = ta.value; };
  const pp = root.querySelector('[data-prof-paste]'); if (pp) pp.onclick = () => { const v = ui.paste; ui.paste = ''; runProfile(v, 'pasted data'); };

  const gen = root.querySelector('[data-gen]');
  if (gen) gen.onclick = async () => {
    const e = E(); if (!e || !e.generateTests) { toast('Test generator unavailable.'); return; }
    if (ui.genBusy) return; ui.genBusy = true;
    try {
    const made = e.generateTests(de, latestProfile(de.id) || undefined) || [];
    const key = c => [c.field, String(c.input), c.kind].join('\u0001');
    const have = new Set(casesFor(de.id).map(key));
    let n = 0;
    for (const c of made) {
      if (have.has(key(c))) continue; have.add(key(c));
      const id = store.newId('tc');
      await store.save('testCase', id, Object.assign({ note: '' }, c, { id, dataId: de.id }), `Generated ${c.kind} test for ${de.name}.${c.field}`);
      n++;
    }
    toast(n ? `Generated ${n} test case${n === 1 ? '' : 's'}` : 'No new test cases — all already exist');
    } finally { ui.genBusy = false; }
  };
  const add = root.querySelector('[data-add-case]'); if (add) add.onclick = () => editCase(de, null);
  root.querySelectorAll('[data-edit-case]').forEach(b => b.onclick = () => editCase(de, store.get('testCase', b.dataset.editCase)));
  root.querySelectorAll('[data-del-case]').forEach(b => b.onclick = async () => {
    const c = store.get('testCase', b.dataset.delCase); if (!c) return;
    const r = await modal({ title: 'Delete test case?', body: `<p style="margin:0">${esc(c.field)} · ${esc(c.kind)} · <code>${esc(c.input)}</code></p>`, actions: [{ id: 'del', label: 'Delete', danger: true }] });
    if (r.action !== 'del') return;
    await store.remove('testCase', c.id, `Deleted ${c.kind} test for ${de.name}.${c.field}`); toast('Test case deleted');
  });

  root.querySelectorAll('[data-resolve]').forEach(b => b.onclick = () => resolveReq(de.id, +b.dataset.resolve));

  bindActivity(root);
}

function bindProject(root, prj) {
  const rec = root.querySelector('[data-record]'); if (rec) rec.onclick = () => recordRun(prj);
  root.querySelectorAll('[data-run-toggle]').forEach(h => h.onclick = () => { const id = h.dataset.runToggle; ui.runOpen.has(id) ? ui.runOpen.delete(id) : ui.runOpen.add(id); store.emit(); });
  root.querySelectorAll('[data-discover]').forEach(b => b.onclick = e => { e.stopPropagation(); const [runId, caseId] = b.dataset.discover.split('|'); logDiscovered(runId, caseId); });
  root.querySelectorAll('[data-mk-defect]').forEach(b => b.onclick = async e => { e.stopPropagation(); const [runId, id] = b.dataset.mkDefect.split('|'); await createDefects(prj, runId, [id]); });
  root.querySelectorAll('[data-close-defect]').forEach(b => b.onclick = e => { e.stopPropagation(); closeDefect(prj, b.dataset.closeDefect); });
  const ad = root.querySelector('[data-adopt]'); if (ad) ad.onclick = () => adoptScripts(prj, false);
  const ag = root.querySelector('[data-add-gen]'); if (ag) ag.onclick = () => adoptScripts(prj, true);
  root.querySelectorAll('details[data-script]').forEach(d => d.addEventListener('toggle', () => { d.open ? ui.scriptOpen.add(d.dataset.script) : ui.scriptOpen.delete(d.dataset.script); }));
  root.querySelectorAll('[data-edit-script]').forEach(b => b.onclick = () => editScript(prj, b.dataset.editScript));
  root.querySelectorAll('[data-del-script]').forEach(b => b.onclick = () => deleteScript(prj, b.dataset.delScript));
  const hb = root.querySelector('[data-ts-history]');
  if (hb) (async () => {
    const raw = (await store.events(null, 200)).filter(e => /^(testRun|testCase|profile):/.test(e.ref || '') || /^Profiled |UAT script|defect/i.test(e.summary || ''));
    /* collapse bursts of generated cases into one line */
    const evs = [];
    raw.forEach(e => { const g = /^Generated \w+ test for (.+)\.[^.]+$/.exec(e.summary || ''); const last = evs[evs.length - 1];
      if (g && last && last._g === g[1] && last.actor === e.actor) { last._n++; last.summary = `Generated ${last._n} test cases for ${g[1]}`; }
      else evs.push(Object.assign({}, e, g ? { _g: g[1], _n: 1 } : {})); });
    evs.splice(15);
    hb.innerHTML = evs.length ? evs.map(e => `<div class="ev"><time>${esc(fmtTime(e.at))}</time><span>${av(e.actor)} <b>${esc(pname(e.actor))}</b> ${esc(e.summary || e.action)}</span></div>`).join('') : '<div class="hint">No test activity yet.</div>';
  })();
}

async function editCase(de, c) {
  const fields = (de.fields || []).map(x => x.name);
  const r = await modal({
    title: c ? 'Edit test case' : 'Add custom test case',
    body: `<div class="frow"><div class="field"><label>Field</label><select name="field">${fields.map(n => `<option ${c && c.field === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      <div class="field"><label>Kind</label><select name="kind">${['custom', 'valid', 'boundary', 'invalid', 'edge'].map(k => `<option ${(c ? c.kind : 'custom') === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div></div>
      <div class="field"><label>Input</label><input name="input" value="${esc(c ? c.input : '')}" placeholder="Value to test (fictional)"></div>
      <div class="field"><label>Expect</label><select name="expect"><option value="accept" ${c && c.expect === 'accept' ? 'selected' : ''}>Accept</option><option value="reject" ${c && c.expect === 'reject' ? 'selected' : ''}>Reject</option></select></div>
      <div class="field"><label>Note</label><input name="note" value="${esc(c ? c.note || '' : '')}"></div>
      <div class="hint">Use made-up values only. Never paste real customer data into a test case.</div>`,
    actions: [{ id: 'save', label: c ? 'Save' : 'Add case', primary: true }],
  });
  if (r.action !== 'save') return;
  if (!fields.length) { toast('This data element has no fields in its spec yet.'); return; }
  const id = c ? c.id : store.newId('tc');
  const data = Object.assign({}, c || { origin: 'user' }, { id, dataId: de.id, field: r.form.field, kind: r.form.kind, input: r.form.input, expect: r.form.expect, note: r.form.note });
  await store.save('testCase', id, data, `${c ? 'Edited' : 'Added custom'} test for ${de.name}.${data.field}`);
  toast(c ? 'Test case saved' : 'Custom case added');
}


/* ---------- runs: every row starts as Not run; outcome, note and evidence per row ---------- */
async function recordRun(prj) {
  const des = projectData(prj);
  const cases = []; des.forEach(d => casesFor(d.id).forEach(c => cases.push({ c, d })));
  const scripts = scriptsFor(prj).list;
  if (!cases.length && !scripts.length) { toast('Generate test cases or UAT scripts first.'); return; }
  const sel = name => `<select name="${name}" aria-label="Outcome"><option value="">Not run</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="blocked">Blocked</option></select>`;
  const row = (key, title) => `<div class="ts-case" data-row="${esc(key)}"><div class="ts-case-t">${title}</div>
    <div class="ts-case-i">${sel('o_' + esc(key))}<input name="n_${esc(key)}" placeholder="Note" aria-label="Note"><input name="e_${esc(key)}" placeholder="Evidence: link or text" aria-label="Evidence"></div></div>`;
  const p = modal({
    title: 'Record test run',
    body: `<div class="frow"><div class="field"><label>Environment</label><select name="env" data-env><option value="dev">Dev</option><option value="uat">UAT</option></select></div>
      <div class="field"><label>Set all visible rows</label><div class="ts-setall"><button type="button" class="btn sm" data-all="pass">All pass</button><button type="button" class="btn sm" data-all="">Reset to not run</button></div></div></div>
      <div class="ts-cov-live hint" data-cov-live></div>
      <div class="ts-cases">
        ${cases.length ? `<div class="ts-grp">Data cases · ${cases.length}</div>${cases.map(({ c, d }) => row('c:' + c.id, `<b>${esc(d.name)} · ${esc(c.field)}</b> <code>${c.input === '' ? '(empty)' : short(c.input)}</code> <small>expect ${esc(c.expect)}</small>`)).join('')}` : ''}
        <div data-scripts-block hidden>${scripts.length ? `<div class="ts-grp">UAT scripts · ${scripts.length}</div>${scripts.map(s => row('s:' + s.id, `<b>${esc(s.title)}</b><div class="ts-gwt-i"><span>Given</span> ${esc(s.given)} <span>When</span> ${esc(s.when)} <span>Then</span> ${esc(s.then)}</div>`)).join('')}` : ''}</div>
      </div>`,
    actions: [{ id: 'save', label: 'Save run', primary: true }],
  });
  const ovs = document.querySelectorAll('.overlay'); const ov = ovs[ovs.length - 1];
  if (ov) {
    const envSel = ov.querySelector('[data-env]'); const blk = ov.querySelector('[data-scripts-block]'); const live = ov.querySelector('[data-cov-live]');
    const visible = () => [...ov.querySelectorAll('.ts-case')].filter(x => !x.closest('[hidden]'));
    const upd = () => { const v = visible(); const run = v.filter(x => x.querySelector('select').value).length; live.textContent = `${run} of ${v.length} rows have an outcome. Rows left as Not run count against coverage.`; };
    envSel.onchange = () => { blk.hidden = envSel.value !== 'uat'; upd(); };
    ov.querySelectorAll('[data-all]').forEach(b => b.onclick = e => { e.stopPropagation(); visible().forEach(x => { x.querySelector('select').value = b.dataset.all; }); upd(); });
    ov.querySelector('.ts-cases').addEventListener('change', upd);
    upd();
  }
  const r = await p;
  if (r.action !== 'save') return;
  const env = r.form.env === 'uat' ? 'uat' : 'dev';
  const results = [];
  const take = (key, base) => { const o = r.form['o_' + key]; if (!o) return; const x = Object.assign(base, { outcome: o, note: (r.form['n_' + key] || '').trim() }); const ev = (r.form['e_' + key] || '').trim(); if (ev) x.evidence = ev; results.push(x); };
  cases.forEach(({ c }) => take('c:' + c.id, { caseId: c.id }));
  if (env === 'uat') scripts.forEach(s => take('s:' + s.id, { scriptId: s.id }));
  if (!results.length) { toast('Nothing recorded: every row was left as Not run.'); return; }
  const total = cases.length + (env === 'uat' ? scripts.length : 0);
  const id = store.newId('run');
  const fails = results.filter(x => x.outcome === 'fail');
  ui.runOpen.add(id);
  await store.save('testRun', id, { id, projectId: prj.id, env, at: new Date().toISOString(), by: store.state.me, results },
    `Recorded ${env.toUpperCase()} test run for ${prj.name}: ${results.length} of ${total} run, ${fails.length} failed`);
  toast(`${env.toUpperCase()} run saved · ${results.length}/${total} run · ${fails.length} fail${fails.length === 1 ? '' : 's'}`);
  if (fails.length) await createDefects(prj, id, fails.map(rid), true);
}

/* Who owns a defect and where it lands: the script's step owner, or the data owner for a data case. */
function defectTarget(prj, x) {
  if (x.scriptId) {
    const s = scriptsFor(prj).list.find(y => y.id === x.scriptId); if (!s) return null;
    const lb = stepLabel(s.pid, s.step);
    return { pid: s.pid, step: s.step, owner: lb.owner || prj.owner, title: `Defect: ${s.title}`, ref: { scriptId: s.id }, where: `${lb.proc} · ${lb.step}` };
  }
  const c = store.get('testCase', x.caseId); if (!c) return null;
  const de = store.get('dataElement', c.dataId) || {};
  const at = firstStepUsing(prj, c.dataId); const lb = stepLabel(at.pid, at.step);
  return { pid: at.pid, step: at.step, owner: de.owner || prj.owner, title: `Defect: ${de.name || c.dataId} · ${c.field} ${c.input === '' ? '(empty)' : '“' + String(c.input).slice(0, 24) + '”'} should ${c.expect}`, ref: { caseId: c.id }, where: `${lb.proc} · ${lb.step}` };
}

async function createDefects(prj, runId, ids, offered) {
  const run = store.get('testRun', runId); if (!run) return;
  const rows = (run.results || []).filter(x => ids.includes(rid(x)) && x.outcome === 'fail' && !x.defectId).map(x => ({ x, t: defectTarget(prj, x) })).filter(y => y.t);
  if (!rows.length) return;
  const due = addDays(store.state.today, 3);
  const r = await modal({
    title: offered ? `${rows.length} failure${rows.length === 1 ? '' : 's'}: create defects?` : 'Create defect',
    body: `<p style="margin:0 0 8px">Each defect becomes a work item on the failing step, owned by the step owner (scripts) or the data owner (data cases), due ${esc(fmt(due))}. Go-live is blocked while any defect is open.</p>
      <div class="ts-mk">${rows.map(({ x, t }) => `<label class="ts-mk-r"><input type="checkbox" name="mk" value="${esc(rid(x))}" checked><span><b>${esc(t.title)}</b><small>${esc(t.where)} · owner ${esc(pname(t.owner))}${x.note ? ' · ' + esc(x.note) : ''}</small></span></label>`).join('')}</div>`,
    actions: [{ id: 'create', label: rows.length === 1 ? 'Create defect' : 'Create defects', primary: true }],
  });
  if (r.action !== 'create') return;
  const pick = new Set(r.form.mk || []);
  const results = (run.results || []).map(x => Object.assign({}, x));
  let n = 0;
  for (const { x, t } of rows) {
    if (!pick.has(rid(x))) continue;
    const wid = store.newId('def');
    await store.save('workItem', wid, { id: wid, projectId: prj.id, pid: t.pid, step: t.step, title: t.title, owner: t.owner, status: 'idle', start: store.state.today, due, deps: [], kind: 'defect', effortDays: 1,
      testRef: Object.assign({ runId }, t.ref), updatedAt: new Date().toISOString() }, `Created ${t.title} from the ${String(run.env).toUpperCase()} run`);
    await store.notify([t.owner], `${pname(store.state.me)} assigned you a defect: ${t.title} (due ${fmt(due)})`, 'workItem:' + wid);
    const res = results.find(y => rid(y) === rid(x)); if (res) res.defectId = wid;
    n++;
  }
  if (n) {
    await store.save('testRun', runId, Object.assign({}, run, { results }), `Linked ${n} defect${n === 1 ? '' : 's'} to the ${String(run.env).toUpperCase()} run`);
    ui.runOpen.add(runId);
    toast(`${n} defect${n === 1 ? '' : 's'} created`);
  }
}

async function closeDefect(prj, wid) {
  const w = store.get('workItem', wid); if (!w) return;
  const me = store.state.me;
  if (me !== w.owner && me !== prj.owner) { toast(`Only ${pname(w.owner)} or the project owner can close this defect.`); return; }
  const r = await modal({ title: 'Close defect', body: `<p style="margin:0 0 8px"><b>${esc(w.title)}</b></p><div class="field"><label>Fix note</label><input name="note" placeholder="What was fixed"></div><div class="hint">Re-run the failing row in the next run to prove the fix.</div>`, actions: [{ id: 'close', label: 'Close defect', primary: true }] });
  if (r.action !== 'close') return;
  const note = (r.form.note || '').trim();
  await store.save('workItem', wid, Object.assign({}, w, { status: 'done', doneAt: store.state.today, updatedAt: new Date().toISOString(), fixNote: note || undefined }), `Closed ${w.title}${note ? ': ' + note : ''}`);
  toast('Defect closed');
}

/* ---------- UAT scripts ---------- */
async function adoptScripts(prj, onlyNew) {
  const cur = store.get('project', prj.id) || prj;
  const gen = generated(prj.id);
  const have = Array.isArray(cur.uatScripts) ? cur.uatScripts : [];
  const add = onlyNew ? gen.filter(g => !have.some(h => h.id === g.id)) : gen;
  if (!add.length) { toast('No generated scripts to add.'); return; }
  const next = (onlyNew ? have : []).concat(add.map(s => ({ id: s.id, pid: s.pid, step: s.step, title: s.title, given: s.given, when: s.when, then: s.then, data: (s.data || []).slice() })));
  await store.save('project', prj.id, Object.assign({}, cur, { uatScripts: next }), onlyNew ? `Added ${add.length} generated UAT script${add.length === 1 ? '' : 's'} to ${prj.name}` : `Adopted ${add.length} generated UAT scripts for ${prj.name}`);
  toast(onlyNew ? `${add.length} script${add.length === 1 ? '' : 's'} added` : `${add.length} UAT scripts adopted. You can edit them now.`);
}

async function editScript(prj, sid) {
  const cur = store.get('project', prj.id) || prj;
  const s = (cur.uatScripts || []).find(x => x.id === sid); if (!s) return;
  const des = projectData(cur);
  const r = await modal({
    title: 'Edit UAT script',
    body: `<div class="field"><label>Title</label><input name="title" value="${esc(s.title)}"></div>
      <div class="field"><label>Given</label><textarea name="given">${esc(s.given)}</textarea></div>
      <div class="field"><label>When</label><textarea name="when">${esc(s.when)}</textarea></div>
      <div class="field"><label>Then</label><textarea name="then">${esc(s.then)}</textarea></div>
      <div class="field"><label>Test data</label><div class="ts-dpick">${des.map(d => `<label><input type="checkbox" name="data" value="${esc(d.id)}" ${(s.data || []).includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('') || '<span class="hint">No project data elements.</span>'}</div></div>`,
    actions: [{ id: 'save', label: 'Save script', primary: true }],
  });
  if (r.action !== 'save') return;
  const f = r.form;
  if (!(f.title || '').trim()) { toast('A script needs a title.'); return; }
  const next = cur.uatScripts.map(x => x.id === sid ? Object.assign({}, x, { title: f.title.trim(), given: (f.given || '').trim(), when: (f.when || '').trim(), then: (f.then || '').trim(), data: f.data || [] }) : x);
  await store.save('project', prj.id, Object.assign({}, cur, { uatScripts: next }), `Edited UAT script “${f.title.trim()}”`);
  toast('Script saved');
}

async function deleteScript(prj, sid) {
  const cur = store.get('project', prj.id) || prj;
  const s = (cur.uatScripts || []).find(x => x.id === sid); if (!s) return;
  const r = await modal({ title: 'Delete UAT script?', body: `<p style="margin:0">${esc(s.title)}</p>`, actions: [{ id: 'del', label: 'Delete', danger: true }] });
  if (r.action !== 'del') return;
  await store.save('project', prj.id, Object.assign({}, cur, { uatScripts: cur.uatScripts.filter(x => x.id !== sid) }), `Deleted UAT script “${s.title}”`);
  toast('Script deleted');
}

/* ---------- discovered requirements ---------- */
async function resolveReq(dataId, i) {
  const de = store.get('dataElement', dataId); if (!de) return;
  if (de.owner !== store.state.me) { toast(`Only the data owner (${pname(de.owner)}) can resolve this.`); return; }
  const d = (de.discovered || [])[i]; if (!d || d.resolved) return;
  const r = await modal({ title: 'Resolve discovered requirement', body: `<p style="margin:0 0 8px">${esc(d.text)}</p><div class="field"><label>Resolution note</label><textarea name="note" placeholder="Spec updated, rule added, or why no change is needed"></textarea></div>`, actions: [{ id: 'resolve', label: 'Resolve', primary: true }] });
  if (r.action !== 'resolve') return;
  const note = (r.form.note || '').trim();
  if (!note) { toast('Add a note so testers know what changed.'); return; }
  const discovered = (de.discovered || []).map((x, j) => j === i ? Object.assign({}, x, { resolved: { by: store.state.me, at: new Date().toISOString(), note } }) : x);
  await store.save('dataElement', de.id, Object.assign({}, de, { discovered }), `Resolved a discovered requirement on ${de.name}: ${note.slice(0, 80)}`);
  toast('Requirement resolved');
}

async function logDiscovered(runId, caseId) {
  const tcse = store.get('testCase', caseId); if (!tcse) return;
  const de = store.get('dataElement', tcse.dataId); if (!de) return;
  const run = store.get('testRun', runId) || {};
  const res = (run.results || []).find(x => x.caseId === caseId) || {};
  const r = await modal({
    title: 'Log discovered requirement',
    body: `<div class="field"><label>Requirement</label><textarea name="text">${esc(`${tcse.field}: input "${tcse.input}" should ${tcse.expect === 'accept' ? 'be accepted' : 'be rejected'} but the ${String(run.env || '').toUpperCase()} build ${tcse.expect === 'accept' ? 'rejected' : 'accepted'} it.${res.note ? ' ' + res.note : ''}`)}</textarea></div>
      <div class="hint">Added to ${esc(de.name)} and sent to its owner, ${esc(pname(de.owner))}.</div>`,
    actions: [{ id: 'log', label: 'Log requirement', primary: true }],
  });
  if (r.action !== 'log' || !(r.form.text || '').trim()) return;
  const text = r.form.text.trim();
  await store.save('dataElement', de.id, Object.assign({}, de, { discovered: [...(de.discovered || []), { text, fromRun: runId, caseId, at: new Date().toISOString() }] }), `Logged discovered requirement on ${de.name}`);
  await store.notify([de.owner], `New discovered requirement on ${de.name}: “${text.slice(0, 80)}”`, 'dataElement:' + de.id);
  toast('Requirement logged and owner notified');
}
