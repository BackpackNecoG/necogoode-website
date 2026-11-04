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

/* Audit lines use names, never ids: swap any known doc id in an event summary for its name. */
function idNames() {
  const m = {};
  store.list('dataElement').forEach(d => { m[d.id] = d.name; });
  store.list('workItem').forEach(w => { m[w.id] = w.title; });
  store.list('process').forEach(p => { m[p.id] = p.name; });
  store.list('testRun').forEach(r => { m[r.id] = `${String(r.env).toUpperCase()} run, ${fmt(r.at)}`; });
  store.list('testCase').forEach(c => { const de = store.get('dataElement', c.dataId); m[c.id] = `${de ? de.name + ' · ' : ''}${c.field} test`; });
  store.list('grant').forEach(g => { const de = store.get('dataElement', g.dataId); m[g.id] = `${de ? de.name : 'data'} ${String(g.env).toUpperCase()} access`; });
  store.list('risk').forEach(r => { m[r.id] = r.title; });
  return m;
}
function humanizeSummary(text, names) {
  const m = names || idNames();
  let s = String(text || '');
  s = s.replace(/\s*\(([A-Za-z][\w-]*\d[\w-]*)\)/g, (all, id) => m[id] ? (s.includes(m[id]) ? '' : ` (${m[id]})`) : all);
  return s.replace(/\b([A-Za-z][\w-]*\d[\w-]*)\b/g, (all, id) => m[id] || all);
}

/* Plain-English pattern ("8 digits") with the raw shape kept as a tooltip. */
function human(pattern) {
  const e = E(); let t = '';
  if (e && e.humanPattern) { try { t = e.humanPattern(pattern) || ''; } catch (err) { t = ''; } }
  return t && t !== pattern ? `<span class="ts-hp" title="${esc(pattern)}">${esc(t)}</span>` : `<code>${esc(pattern)}</code>`;
}

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

  const projectCards = `<div class="ts-proj">${coverageCard(prj, des, runs, sc)}${scriptsCard(prj, sc, lastUat)}${runsCard(prj, des, runs, caseIds, sc)}
    <div class="card"><h3>Test history</h3><div data-ts-history><div class="hint">Loading…</div></div></div></div>`;

  if (!des.length) return header + `<div class="card" style="margin-top:16px"><div class="empty">This project's processes use no data elements yet. Add data to the to-be steps to test it.</div></div>` + projectCards;

  const list = `<nav class="ts-list" aria-label="Data elements">${des.map(d => {
    const p = latestProfile(d.id); const n = casesFor(d.id).length; const openReq = (d.discovered || []).filter(x => !x.resolved).length;
    return `<a href="${link('/testing/' + prjId + '?de=' + d.id)}" data-de="${esc(d.id)}" class="${d.id === did ? 'on' : ''}"><span class="ts-dot ${esc(d.avail || 'missing')}"></span><span class="ts-nm">${esc(d.name)}</span><small>${n} case${n === 1 ? '' : 's'}${p ? ' · profiled' : ''}${openReq ? ` · <b class="ts-open">${openReq} open req${openReq === 1 ? '' : 's'}</b>` : ''}</small></a>`;
  }).join('')}</nav>`;

  return header + `<div class="ts-layout">${list}<div class="ts-main">${profileCard(de)}${casesCard(de)}${discoveredCard(de)}
    <div class="two ts-act"><div class="card"><h3>Comments</h3>${commentsPanel('dataElement:' + de.id)}</div><div class="card"><h3>History · ${esc(de.name)}</h3>${historyPanel('dataElement:' + de.id)}</div></div></div></div>` + projectCards;
}

const rowsOf = prof => prof ? (prof.rows != null ? prof.rows : prof.rowCount != null ? prof.rowCount : Math.max(0, ...(prof.columns || []).map(c => (c.nulls || 0) + (c.nonNull || 0)))) : 0;
/* Never show "undefined" in a drift message: fall back to the profile's row count. */
const fixU = (t, prof) => String(t == null ? '' : t).replace(/\bundefined\b/g, String(rowsOf(prof)));
function profileCard(de) {
  const prof = latestProfile(de.id);
  const e = E();
  let drift = [];
  if (prof && e && e.specDrift) { try { drift = e.specDrift(de, prof) || []; } catch (err) { drift = []; } }
  const driftBy = {}; drift.forEach(d => (driftBy[norm(d.field)] = driftBy[norm(d.field)] || []).push(d));
  const cols = prof ? (prof.columns || []).map(c => {
    const iss = driftBy[norm(c.name)] || [];
    return `<tr class="${iss.length ? 'ts-drift' : ''}"><td><b>${esc(c.name)}</b>${iss.map(i => `<div class="ts-iss">⚠ ${esc(fixU(i.issue, prof))}${i.detail ? ': ' + esc(fixU(i.detail, prof)) : ''}</div>`).join('')}</td>
      <td>${esc(c.nulls)}</td><td>${esc(c.distinct)}</td><td>${esc(c.minLen)}–${esc(c.maxLen)}</td>
      <td>${(c.patterns || []).slice(0, 3).map(p => `${human(p.pattern)} <small>×${esc(p.count)}</small>`).join('<br>')}</td>
      <td>${(c.examples || []).slice(0, 3).map(x => `<code>${esc(x)}</code>`).join(' ')}</td></tr>`;
  }).join('') : '';
  const unattached = prof ? drift.filter(d => !(prof.columns || []).some(c => norm(c.name) === norm(d.field))) : [];
  return `<div class="card"><h3>Profile data · ${esc(de.name)}${prof ? `<span class="n">${esc(rowsOf(prof))} rows · ${esc(fmtTime(prof.at))}</span>` : ''}</h3>
    <div class="ts-prof-tools">
      ${de.sampleCsv ? `<button class="btn sm primary" data-prof-sample ${ui.busy ? 'disabled' : ''}>Profile sample extract</button>` : ''}
      <label class="btn sm ts-file">Upload CSV<input type="file" accept=".csv,text/csv" data-prof-file hidden></label>
      <button class="btn sm" data-paste-toggle>${ui.pasteOpen ? 'Hide paste box' : 'Paste CSV'}</button>
      <span class="hint">Read in your browser, sent to the in-tenant profiler, reduced to statistics.</span></div>
    ${ui.pasteOpen ? `<div class="field ts-paste"><textarea data-paste placeholder="Paste CSV with a header row">${esc(ui.paste)}</textarea><div><button class="btn sm primary" data-prof-paste>Profile pasted data</button></div></div>` : ''}
    ${prof ? `<div class="ts-raw">🔒 Raw values were not stored. Examples are masked: digits → 9, letters → x/X, first and last character kept.</div>
      ${unattached.length ? `<div class="ts-iss">${unattached.map(i => `⚠ ${esc(i.field)}: ${esc(fixU(i.issue, prof))}${i.detail ? ' — ' + esc(fixU(i.detail, prof)) : ''}`).join('<br>')}</div>` : ''}
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


/* Step-by-step scripts. Legacy scripts (given/when/then only) read as one step: when -> then. */
function scriptSteps(s) {
  if (Array.isArray(s.steps) && s.steps.length) return s.steps.map((x, i) => ({ n: i + 1, action: String(x.action || ''), expected: String(x.expected || '') }));
  return [{ n: 1, action: s.when || 'Perform the step', expected: s.then || 'The step completes' }];
}
/* A script passes only when every step passed. */
function scriptOutcome(stepOutcomes) {
  const v = stepOutcomes.filter(Boolean);
  if (!v.length) return '';
  if (v.length < stepOutcomes.length) return 'incomplete';
  if (v.includes('fail')) return 'fail';
  if (v.includes('blocked')) return 'blocked';
  return 'pass';
}

function scriptsCard(prj, sc, lastUat) {
  const resBy = {}; (lastUat ? lastUat.results || [] : []).forEach(x => { if (x.scriptId) resBy[x.scriptId] = x; });
  const gen = sc.adopted ? generated(prj.id) : [];
  const have = new Set(sc.list.map(x => x.id));
  const fresh = gen.filter(x => !have.has(x.id));
  const rows = sc.list.map(s => {
    const lb = stepLabel(s.pid, s.step); const res = resBy[s.id]; const o = res && res.outcome;
    const so = {}; ((res && res.steps) || []).forEach(x => { so[x.n] = x.outcome; });
    const steps = scriptSteps(s);
    return `<details class="ts-script" data-script="${esc(s.id)}" ${ui.scriptOpen.has(s.id) ? 'open' : ''}>
      <summary><span class="ts-script-h"><b>${esc(s.title)}</b>${o ? badge(o, OUT_CLS[o]) : badge('not run', 'b-idle')}</span>
      <span class="hint">${esc(lb.proc)} · ${esc(lb.step)}${lb.owner ? ' · ' + esc(pname(lb.owner)) : ''} · ${steps.length} step${steps.length === 1 ? '' : 's'}</span></summary>
      <div class="ts-script-b"><div class="ts-given"><span>Given</span> ${esc(s.given)}</div>
        <ol class="ts-ssteps">${steps.map(x => `<li data-sstep="${x.n}"><div><b>${esc(x.action)}</b><div class="ts-exp"><span>Expected</span> ${esc(x.expected)}</div></div>${so[x.n] ? badge(so[x.n], OUT_CLS[so[x.n]]) : ''}</li>`).join('')}</ol>
        ${(s.data || []).length ? `<div class="chips">${(s.data || []).map(d => `<span class="chip">${esc((store.get('dataElement', d) || {}).name || d)}</span>`).join(' ')}</div>` : ''}
        <div class="ts-script-a"><a class="rl-go" href="${link(`/process/${s.pid}?mode=diff`)}" data-link>Open step in the process ›</a>${sc.adopted ? `<button class="btn sm" data-edit-script="${esc(s.id)}">Edit</button><button class="btn sm danger" data-del-script="${esc(s.id)}">Delete</button>` : ''}</div></div></details>`;
  }).join('');
  return `<div class="card" id="uat-scripts"><h3>Process UAT scripts<span class="n">${sc.list.length}${sc.adopted ? ' · adopted' : ' · generated'}</span></h3>
    ${sc.adopted
      ? `<div class="ts-prof-tools"><span class="hint">Each script is a numbered list of actions with an expected result. A script passes only when every step passes in the latest UAT run.</span>${fresh.length ? `<button class="btn sm" data-add-gen>Add ${fresh.length} newly generated</button>` : ''}</div>`
      : `<div class="ts-adopt"><div><b>Generated from the to-be design</b> · one script per new or changed step and one per gateway branch. Adopt them to edit the steps and keep them with the project.</div><button class="btn sm primary" data-adopt ${sc.list.length ? '' : 'disabled'}>Adopt generated scripts</button></div>`}
    <div class="ts-scripts">${rows || '<div class="empty">No new or changed steps in the to-be design, so there is nothing to script yet.</div>'}</div></div>`;
}

/* Aggregate outcome of a set of ids in a run: fail > blocked > partial > pass. */
function aggOutcome(run, ids) {
  if (!ids.length) return { cls: 'none', text: '—' };
  if (!run) return { cls: 'norun', text: 'no run' };
  const by = {}; (run.results || []).forEach(x => { by[rid(x)] = x.outcome; });
  const out = ids.map(id => by[id]);
  const f = out.filter(o => o === 'fail').length, b = out.filter(o => o === 'blocked').length, p = out.filter(o => o === 'pass').length;
  if (f) return { cls: 'fail', text: `${f} fail` };
  if (b) return { cls: 'blocked', text: `${b} blocked` };
  if (p < ids.length) return { cls: 'partial', text: `${p}/${ids.length} run` };
  return { cls: 'pass', text: `${p}/${ids.length} pass` };
}
function coverageCard(prj, des, runs, sc) {
  const lastDev = runs.find(r => r.env === 'dev'), lastUat = runs.find(r => r.env === 'uat');
  const openDef = store.list('workItem', w => w.projectId === prj.id && w.kind === 'defect' && w.status !== 'done');
  const e = E();
  const cell = o => `<td><span class="ts-o ${o.cls}">${esc(o.text)}</span></td>`;
  const rows = [];
  des.forEach(d => {
    const ids = casesFor(d.id).map(c => c.id);
    const defs = openDef.filter(w => w.testRef && w.testRef.caseId && ids.includes(w.testRef.caseId)).length;
    rows.push(`<tr class="${ids.length ? '' : 'ts-zero'}" data-cov-row="data:${esc(d.id)}"><td><span class="chip">Data</span> <a href="${link(`/testing/${prj.id}?de=${d.id}`)}" data-link>${esc(d.name)}</a></td>
      <td>${ids.length ? `${ids.length} case${ids.length === 1 ? '' : 's'}` : '<b>0 cases</b>'}</td>${cell(aggOutcome(lastDev, ids))}${cell(aggOutcome(lastUat, ids))}<td>${defs ? badge(defs + ' open', 'b-late') : '0'}</td></tr>`);
  });
  (prj.processes || []).map(id => store.get('process', id)).filter(Boolean).forEach(p => {
    let diff = { nodes: {} }; try { if (e && e.diffProcess) diff = e.diffProcess(p); } catch (err) { /* ignore */ }
    const gates = []; const walk = ns => (ns || []).forEach(n => { if (!n) return; if ((n.branches || []).length) { gates.push(n); n.branches.forEach(b => walk(b && b.nodes)); } });
    walk(p.tobe);
    flat(p.tobe).concat(gates).forEach(s => {
      const ids = sc.list.filter(x => x.pid === p.id && x.step === s.id).map(x => x.id);
      const st = diff.nodes[s.id] || 'same';
      const needs = st !== 'same';
      const defs = openDef.filter(w => w.pid === p.id && w.step === s.id).length;
      rows.push(`<tr class="${!ids.length && needs ? 'ts-zero' : ''}" data-cov-row="step:${esc(p.id)}:${esc(s.id)}"><td><span class="chip">${(s.branches || []).length ? 'Gateway' : 'Step'}</span> <a href="${link(`/process/${p.id}/step/${s.id}`)}" data-link>${esc(s.title)}</a> <small>${esc(p.name)}${needs ? ` · ${esc(st)}` : ' · unchanged'}</small></td>
        <td>${ids.length ? `${ids.length} script${ids.length === 1 ? '' : 's'}` : needs ? '<b>0 scripts</b>' : '<span class="hint">unchanged: regression optional</span>'}</td><td><span class="ts-o none">—</span></td>${cell(aggOutcome(lastUat, ids))}<td>${defs ? badge(defs + ' open', 'b-late') : '0'}</td></tr>`);
    });
  });
  const zero = rows.filter(r => r.startsWith('<tr class="ts-zero"')).length;
  return `<div class="card" id="coverage"><h3>Coverage matrix<span class="n">${zero ? `${zero} uncovered` : 'all covered'}</span></h3>
    <div class="hint" style="margin-bottom:8px">Rows are the project's data elements and to-be steps. Red rows have no test coverage. Dev runs cover data cases; UAT covers cases and scripts.</div>
    <div class="tbl-wrap"><table class="ts-tbl ts-cov-tbl"><thead><tr><th>Data element / step</th><th>Cases / scripts</th><th>Latest dev</th><th>Latest UAT</th><th>Open defects</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></div>`;
}

/* The items to retest: failed or blocked in the latest run of that env. */
function retestIds(run) { return run ? (run.results || []).filter(x => x.outcome === 'fail' || x.outcome === 'blocked').map(rid) : []; }

function runsCard(prj, des, runs, caseIds, sc) {
  const caseIdx = {}; des.forEach(d => casesFor(d.id).forEach(c => caseIdx[c.id] = c));
  const scIdx = {}; sc.list.forEach(s => scIdx[s.id] = s);
  const me = store.state.me;
  const retest = ['dev', 'uat'].map(env => { const r = runs.find(x => x.env === env); const ids = retestIds(r); return ids.length ? `<button class="btn sm" data-retest="${env}">Retest failures · ${env.toUpperCase()} (${ids.length})</button>` : ''; }).join('');
  return `<div class="card" id="runs"><h3>Test runs<span class="n">${runs.length}</span></h3>
    <div class="ts-prof-tools"><button class="btn sm primary" data-record>Record test run</button>${retest}<button class="btn sm" data-ci>Import CI results (JUnit)</button><span class="hint">Every row starts as not run. A fail needs a note. Retests carry earlier passes forward and record the cycle.</span></div>
    ${runs.length ? runs.map(r => {
      const ids = r.env === 'uat' ? caseIds.concat(sc.list.map(x => x.id)) : caseIds;
      const cov = coverage(r, ids);
      const c = (r.results || []).reduce((a, x) => (a[x.outcome] = (a[x.outcome] || 0) + 1, a), {});
      const open = ui.runOpen.has(r.id);
      const carried = (r.results || []).filter(x => x.carriedFrom).length;
      const rows = (r.results || []).filter(x => !x.carriedFrom && (x.outcome !== 'pass' || x.defectId));
      const passEv = (r.results || []).filter(x => !x.carriedFrom && x.outcome === 'pass' && !x.defectId && (x.evidence || x.note));
      const partial = cov && cov.covered < cov.total;
      return `<div class="ts-run" data-run="${esc(r.id)}"><div class="ts-run-h" data-run-toggle="${esc(r.id)}" role="button" tabindex="0" aria-expanded="${open}" aria-label="${esc(String(r.env).toUpperCase())} run ${esc(fmtTime(r.at))}: show details"><span class="chip">${esc(String(r.env).toUpperCase())}</span>
        ${r.cycle > 1 ? `<span class="chip ts-cycle" data-cycle="${esc(r.cycle)}">Cycle ${esc(r.cycle)} retest</span>` : ''}${r.source === 'ci' ? '<span class="chip ts-ci" data-source="ci">CI import</span>' : ''}
        <b>${esc(fmtTime(r.at))}</b><span class="hint">${av(r.by)} ${esc(pname(r.by))}</span>
        <span class="ts-cov ${partial ? 'partial' : 'full'}" data-run-cov>covers ${cov ? cov.covered : 0}/${cov ? cov.total : 0} ${r.env === 'uat' ? 'cases + scripts' : 'cases'}</span>
        <span class="ts-counts">${badge((c.pass || 0) + ' pass', 'b-done')}${c.fail ? badge(c.fail + ' fail', 'b-late') : ''}${c.blocked ? badge(c.blocked + ' blocked', 'b-soon') : ''}</span><span class="rl-chev" aria-hidden="true">${open ? '▾' : '▸'}</span></div>
        ${open ? `<div class="ts-run-b">${partial ? `<div class="ts-warn">${cov.total - cov.covered} of ${cov.total} not run in this ${esc(String(r.env).toUpperCase())} run.</div>` : ''}
          ${carried ? `<div class="hint" data-carried>${carried} earlier pass${carried === 1 ? '' : 'es'} carried forward from cycle ${esc((r.cycle || 2) - 1)}; ${(r.results || []).length - carried} retested in this cycle.</div>` : ''}
          ${r.source === 'ci' && r.ciSuite ? `<div class="hint">Imported from CI suite “${esc(r.ciSuite)}”${r.ciUnmatched ? ` · ${esc(r.ciUnmatched)} test${r.ciUnmatched === 1 ? '' : 's'} did not match a case or script` : ''}.</div>` : ''}
          ${rows.map(x => resultRow(prj, r, x, caseIdx, scIdx, me)).join('') || '<div class="hint">Every recorded row passed.</div>'}
          ${passEv.length ? `<details class="ts-passev"><summary>${passEv.length} pass${passEv.length === 1 ? '' : 'es'} with evidence or notes</summary>${passEv.map(x => resultRow(prj, r, x, caseIdx, scIdx, me)).join('')}</details>` : ''}</div>` : ''}</div>`;
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
  return `<div class="ts-fail" data-result="${esc(rid(x))}">${badge(x.outcome, OUT_CLS[x.outcome])} <span>${resultLabel(x, caseIdx, scIdx)}${x.note ? ` — <i>${esc(x.note)}</i>` : ''}${(x.steps || []).filter(y => y.outcome && y.outcome !== 'pass').map(y => `<div class="ts-ev" data-step-out="${esc(y.n)}">Step ${esc(y.n)}: ${esc(y.outcome)}${y.note ? ' — ' + esc(y.note) : ''}</div>`).join('')}${ev ? `<div class="ts-ev">Evidence: ${ev}</div>` : ''}</span>
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
  root.querySelectorAll('[data-run-toggle]').forEach(h => { const t = () => { const id = h.dataset.runToggle; ui.runOpen.has(id) ? ui.runOpen.delete(id) : ui.runOpen.add(id); store.emit(); }; h.onclick = t; h.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t(); } }; });
  root.querySelectorAll('[data-retest]').forEach(b => b.onclick = () => { const run = runsFor(prj.id).find(x => x.env === b.dataset.retest); if (run) recordRun(prj, { retestOf: run }); });
  const ci = root.querySelector('[data-ci]'); if (ci) ci.onclick = () => importCi(prj);
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
    const nm = idNames();
    hb.innerHTML = evs.length ? evs.map(e => `<div class="ev"><time>${esc(fmtTime(e.at))}</time><span>${av(e.actor)} <b>${esc(pname(e.actor))}</b> ${esc(humanizeSummary(e.summary || e.action, nm))}</span></div>`).join('') : '<div class="hint">No test activity yet.</div>';
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


/* ---------- runs: every row starts as Not run; a fail needs a note; scripts are recorded step by step ---------- */
async function recordRun(prj, opts) {
  opts = opts || {};
  const des = projectData(prj);
  const prev = opts.retestOf || null;
  const only = prev ? new Set(retestIds(prev)) : null;
  const cases = []; des.forEach(d => casesFor(d.id).forEach(c => { if (!only || only.has(c.id)) cases.push({ c, d }); }));
  const scripts = scriptsFor(prj).list.filter(s => !only || only.has(s.id));
  if (!cases.length && !scripts.length) { toast(only ? 'Nothing to retest.' : 'Generate test cases or UAT scripts first.'); return; }
  const env0 = prev ? prev.env : (opts.env || 'dev');
  const sel = (name, label) => `<select name="${name}" aria-label="${esc(label)}"><option value="">Not run</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="blocked">Blocked</option></select>`;
  const caseRow = ({ c, d }) => { const k = 'c:' + c.id; return `<div class="ts-case" data-row="${esc(k)}"><div class="ts-case-t"><b>${esc(d.name)} · ${esc(c.field)}</b> <code>${c.input === '' ? '(empty)' : short(c.input)}</code> <small>expect ${esc(c.expect)}</small></div>
    <div class="ts-case-i">${sel('o_' + esc(k), 'Outcome')}<input name="n_${esc(k)}" placeholder="Note (required on fail)" aria-label="Note"><input name="e_${esc(k)}" placeholder="Evidence: link or text" aria-label="Evidence"></div></div>`; };
  const scriptRow = s => { const k = 's:' + s.id; return `<div class="ts-case ts-srun" data-row="${esc(k)}" data-script-row><div class="ts-case-t"><b>${esc(s.title)}</b><div class="ts-gwt-i"><span>Given</span> ${esc(s.given)}</div></div>
    <ol class="ts-sst">${scriptSteps(s).map(x => `<li data-step-row="${x.n}"><div class="ts-sst-t">${esc(x.action)}<small>Expected: ${esc(x.expected)}</small></div><div class="ts-sst-i">${sel(`so_${esc(k)}_${x.n}`, 'Step ' + x.n + ' outcome')}<input name="sn_${esc(k)}_${x.n}" placeholder="Step note" aria-label="Step ${x.n} note"></div></li>`).join('')}</ol>
    <div class="ts-case-i ts-case-i2"><input name="n_${esc(k)}" placeholder="Script note (required on fail if no step note)" aria-label="Script note"><input name="e_${esc(k)}" placeholder="Evidence: link or text" aria-label="Evidence"></div></div>`; };
  const p = modal({
    title: prev ? `Retest failures · ${String(prev.env).toUpperCase()} cycle ${(prev.cycle || 1) + 1}` : 'Record test run',
    body: `<div class="frow"><div class="field"><label>Environment</label><select name="env" data-env ${prev ? 'disabled' : ''}><option value="dev" ${env0 === 'dev' ? 'selected' : ''}>Dev</option><option value="uat" ${env0 === 'uat' ? 'selected' : ''}>UAT</option></select></div>
      <div class="field"><label>Rows</label><div class="ts-setall"><button type="button" class="btn sm" data-reset>Reset to not run</button></div></div></div>
      ${prev ? `<div class="hint">Only the ${only.size} item${only.size === 1 ? '' : 's'} that failed or were blocked in the ${esc(fmtTime(prev.at))} run. Earlier passes are carried forward.</div>` : ''}
      <div class="ts-cov-live hint" data-cov-live></div><div class="ts-err" data-err hidden></div>
      <div class="ts-cases">
        ${cases.length ? `<div class="ts-grp">Data cases · ${cases.length}</div>${cases.map(caseRow).join('')}` : ''}
        <div data-scripts-block ${env0 === 'uat' ? '' : 'hidden'}>${scripts.length ? `<div class="ts-grp">UAT scripts · ${scripts.length} · every step must pass</div>${scripts.map(scriptRow).join('')}` : ''}</div>
      </div>`,
    actions: [{ id: 'save', label: 'Save run', primary: true }],
  });
  const ovs = document.querySelectorAll('.overlay'); const ov = ovs[ovs.length - 1];
  const val = (root, n) => { const el = root.querySelector(`[name="${CSS.escape(n)}"]`); return el ? el.value.trim() : ''; };
  const envOf = () => prev ? prev.env : ov.querySelector('[data-env]').value;
  /* validation: a fail needs a note; a script is recorded step by step, all or none */
  const problems = () => {
    const out = [];
    ov.querySelectorAll('.ts-case').forEach(row => {
      if (row.closest('[hidden]')) return;
      const k = row.dataset.row;
      row.classList.remove('ts-bad');
      if (row.hasAttribute('data-script-row')) {
        const so = [...row.querySelectorAll('[data-step-row]')].map(li => ({ n: li.dataset.stepRow, o: li.querySelector('select').value, note: li.querySelector('input').value.trim() }));
        const oc = scriptOutcome(so.map(x => x.o));
        if (oc === 'incomplete') { out.push(`Record every step of “${row.querySelector('b').textContent}”, or leave all as not run.`); row.classList.add('ts-bad'); }
        if (oc === 'fail' && !val(row, 'n_' + k) && !so.some(x => x.o === 'fail' && x.note)) { out.push(`Add a note for the failing step in “${row.querySelector('b').textContent}”.`); row.classList.add('ts-bad'); }
      } else if (row.querySelector('select').value === 'fail' && !val(row, 'n_' + k)) { out.push(`Add a note for the failing case “${row.querySelector('b').textContent}”.`); row.classList.add('ts-bad'); }
    });
    return out;
  };
  if (ov) {
    const envSel = ov.querySelector('[data-env]'); const blk = ov.querySelector('[data-scripts-block]'); const live = ov.querySelector('[data-cov-live]'); const err = ov.querySelector('[data-err]');
    const rows = () => [...ov.querySelectorAll('.ts-case')].filter(x => !x.closest('[hidden]'));
    const upd = () => { const v = rows(); const done = v.filter(x => [...x.querySelectorAll('select')].some(s => s.value)).length; live.textContent = `${done} of ${v.length} rows have an outcome. Rows left as Not run count against coverage.`; };
    envSel.onchange = () => { blk.hidden = envSel.value !== 'uat'; upd(); };
    ov.querySelector('[data-reset]').onclick = e => { e.stopPropagation(); rows().forEach(x => x.querySelectorAll('select').forEach(s => { s.value = ''; })); upd(); };
    ov.querySelector('.ts-cases').addEventListener('change', upd);
    /* capture phase: runs before the modal's own click handler, so an invalid run never closes the dialog */
    ov.addEventListener('click', e => {
      const b = e.target.closest('[data-act=save]'); if (!b) return;
      const pr = problems(); if (!pr.length) return;
      e.stopPropagation(); err.hidden = false; err.innerHTML = `<b>Can't save yet</b><ul>${pr.slice(0, 5).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`; err.scrollIntoView({ block: 'nearest' });
    }, true);
    upd();
  }
  const r = await p;
  if (r.action !== 'save') return;
  const env = (prev ? prev.env : r.form.env) === 'uat' ? 'uat' : 'dev';
  const results = [];
  const addCommon = (x, k) => { const note = (r.form['n_' + k] || '').trim(); const ev = (r.form['e_' + k] || '').trim(); x.note = note; if (ev) x.evidence = ev; return x; };
  cases.forEach(({ c }) => { const k = 'c:' + c.id; const o = r.form['o_' + k]; if (o) results.push(addCommon({ caseId: c.id, outcome: o }, k)); });
  if (env === 'uat') scripts.forEach(s => {
    const k = 's:' + s.id;
    const steps = scriptSteps(s).map(x => ({ n: x.n, outcome: r.form[`so_${k}_${x.n}`] || '', note: (r.form[`sn_${k}_${x.n}`] || '').trim() }));
    const oc = scriptOutcome(steps.map(x => x.outcome));
    if (!oc || oc === 'incomplete') return;
    const x = addCommon({ scriptId: s.id, outcome: oc, steps }, k);
    if (!x.note && oc !== 'pass') { const f = steps.find(y => y.outcome === oc && y.note); if (f) x.note = `Step ${f.n}: ${f.note}`; }
    results.push(x);
  });
  if (!results.length) { toast('Nothing recorded: every row was left as Not run.'); return; }
  const fresh = new Set(results.map(rid));
  if (prev) (prev.results || []).forEach(x => { if (!fresh.has(rid(x))) results.push(Object.assign({}, x, { carriedFrom: x.carriedFrom || prev.id, defectId: x.defectId })); });
  const scriptN = env === 'uat' ? scriptsFor(prj).list.length : 0;
  const total = des.reduce((n, d) => n + casesFor(d.id).length, 0) + scriptN;
  const id = store.newId('run');
  const cycle = prev ? (prev.cycle || 1) + 1 : 1;
  const fails = results.filter(x => x.outcome === 'fail' && !x.carriedFrom);
  ui.runOpen.add(id);
  const doc = { id, projectId: prj.id, env, at: new Date().toISOString(), by: store.state.me, cycle, results };
  if (prev) doc.retestOf = prev.id;
  await store.save('testRun', id, doc,
    prev ? `Recorded ${env.toUpperCase()} retest (cycle ${cycle}) for ${prj.name}: ${fresh.size} retested, ${fails.length} still failing`
      : `Recorded ${env.toUpperCase()} test run for ${prj.name}: ${results.length} of ${total} run, ${fails.length} failed`);
  toast(prev ? `Retest cycle ${cycle} saved · ${fails.length} still failing` : `${env.toUpperCase()} run saved · ${results.length}/${total} run · ${fails.length} fail${fails.length === 1 ? '' : 's'}`);
  if (fails.length) await createDefects(prj, id, fails.map(rid), true);
}

/* ---------- CI import: JUnit XML parsed in the browser. In the product this arrives from the customer's pipeline. ---------- */
export function parseJUnit(xml) {
  const doc = new DOMParser().parseFromString(String(xml || ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('That is not valid XML.');
  const suites = [...doc.getElementsByTagName('testsuite')];
  const suite = (suites[0] && suites[0].getAttribute('name')) || (doc.documentElement && doc.documentElement.getAttribute('name')) || 'CI';
  return { suite, tests: [...doc.getElementsByTagName('testcase')].map(t => {
    const fl = t.getElementsByTagName('failure')[0] || t.getElementsByTagName('error')[0];
    const sk = t.getElementsByTagName('skipped')[0];
    const msg = fl ? (fl.getAttribute('message') || fl.textContent || '').trim() : '';
    return { name: t.getAttribute('name') || '', classname: t.getAttribute('classname') || '', outcome: fl ? 'fail' : sk ? 'skip' : 'pass', message: msg.slice(0, 240) };
  }) };
}
function matchCiTest(t, cases, scripts) {
  const text = `${t.classname} ${t.name}`;
  const byId = [...cases.map(c => c.id), ...scripts.map(s => s.id)].find(id => new RegExp('(^|[^\\w-])' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w-])').test(text));
  if (byId) return cases.some(c => c.id === byId) ? { caseId: byId } : { scriptId: byId };
  const nm = norm(t.name);
  const sc = scripts.find(s => norm(s.title) === nm); if (sc) return { scriptId: sc.id };
  const cs = cases.find(c => { const de = store.get('dataElement', c.dataId) || {}; return norm(`${de.name} ${c.field} ${c.input}`) === nm || norm(`${c.field} ${c.input}`) === nm; });
  return cs ? { caseId: cs.id } : null;
}
async function importCi(prj) {
  const des = projectData(prj);
  const cases = []; des.forEach(d => casesFor(d.id).forEach(c => cases.push(c)));
  const scripts = scriptsFor(prj).list;
  const p = modal({
    title: 'Import CI results (JUnit XML)',
    body: `<p style="margin:0 0 8px" class="hint">Paste or upload a JUnit XML report. Each <code>testcase</code> is matched to a data case or UAT script by id (in its name or classname) or by title. In the product, results arrive from the customer's pipeline automatically.</p>
      <div class="field"><label>JUnit XML</label><textarea name="xml" data-ci-xml class="ts-xml" placeholder="&lt;testsuite name=&quot;vendor-api&quot;&gt;&lt;testcase name=&quot;TC1 routing number&quot;/&gt;…"></textarea></div>
      <label class="btn sm ts-file">Upload .xml<input type="file" accept=".xml,text/xml,application/xml" data-ci-file hidden></label>`,
    actions: [{ id: 'import', label: 'Import as dev run', primary: true }],
  });
  const ovs = document.querySelectorAll('.overlay'); const ov = ovs[ovs.length - 1];
  const fi = ov && ov.querySelector('[data-ci-file]');
  if (fi) fi.onchange = () => { const f = fi.files[0]; if (!f) return; if (f.size > 2 * 1024 * 1024) { toast('File is over 2 MB.'); return; } const rd = new FileReader(); rd.onload = () => { ov.querySelector('[data-ci-xml]').value = String(rd.result); }; rd.readAsText(f); };
  const r = await p;
  if (r.action !== 'import') return;
  let parsed;
  try { parsed = parseJUnit(r.form.xml); } catch (e) { toast('Could not read the report: ' + e.message); return; }
  const results = []; let unmatched = 0; const seen = new Set();
  parsed.tests.forEach(t => {
    if (t.outcome === 'skip') return;
    const m = matchCiTest(t, cases, scripts);
    if (!m) { unmatched++; return; }
    const key = m.caseId || m.scriptId; if (seen.has(key)) return; seen.add(key);
    results.push(Object.assign(m, { outcome: t.outcome, note: t.outcome === 'fail' ? (t.message || 'CI reported a failure') : '', evidence: `CI ${parsed.suite}: ${t.classname ? t.classname + '.' : ''}${t.name}` }));
  });
  if (!results.length) { toast(`No test in the report matched a case or script (${unmatched} unmatched).`); return; }
  const id = store.newId('run');
  const fails = results.filter(x => x.outcome === 'fail');
  ui.runOpen.add(id);
  await store.save('testRun', id, { id, projectId: prj.id, env: 'dev', at: new Date().toISOString(), by: store.state.me, source: 'ci', ciSuite: parsed.suite, ciUnmatched: unmatched, cycle: 1, results },
    `Imported CI results (${parsed.suite}) as a dev run for ${prj.name}: ${results.length} matched, ${fails.length} failed, ${unmatched} unmatched`);
  toast(`CI import: ${results.length} matched · ${fails.length} fail · ${unmatched} unmatched`);
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
  const srow = (x, i) => `<div class="ts-srow" data-srow><span class="ts-srow-n">${i + 1}</span><input data-sa value="${esc(x.action)}" placeholder="Action" aria-label="Step action"><input data-sx value="${esc(x.expected)}" placeholder="Expected result" aria-label="Expected result"><button type="button" class="btn sm danger" data-srm aria-label="Remove step">✕</button></div>`;
  const p = modal({
    title: 'Edit UAT script',
    body: `<div class="field"><label>Title</label><input name="title" value="${esc(s.title)}"></div>
      <div class="field"><label>Given (precondition)</label><textarea name="given">${esc(s.given)}</textarea></div>
      <div class="field"><label>Steps · action and expected result</label><div class="ts-srows" data-srows>${scriptSteps(s).map(srow).join('')}</div>
        <div><button type="button" class="btn sm" data-sadd>+ Add step</button></div></div>
      <div class="field"><label>Test data</label><div class="ts-dpick">${des.map(d => `<label><input type="checkbox" name="data" value="${esc(d.id)}" ${(s.data || []).includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('') || '<span class="hint">No project data elements.</span>'}</div></div>`,
    actions: [{ id: 'save', label: 'Save script', primary: true }],
  });
  const ovs = document.querySelectorAll('.overlay'); const ov = ovs[ovs.length - 1];
  if (ov) {
    const box = ov.querySelector('[data-srows]');
    const renum = () => box.querySelectorAll('.ts-srow-n').forEach((n, i) => { n.textContent = i + 1; });
    const wire = () => box.querySelectorAll('[data-srm]').forEach(b => b.onclick = e => { e.stopPropagation(); if (box.children.length > 1) { b.closest('[data-srow]').remove(); renum(); } else toast('A script needs at least one step.'); });
    ov.querySelector('[data-sadd]').onclick = e => { e.stopPropagation(); box.insertAdjacentHTML('beforeend', srow({ action: '', expected: '' }, box.children.length)); wire(); box.lastElementChild.querySelector('[data-sa]').focus(); };
    wire();
  }
  const r = await p;
  if (r.action !== 'save') return;
  const f = r.form;
  const steps = [...r.root.querySelectorAll('[data-srow]')].map(row => ({ action: row.querySelector('[data-sa]').value.trim(), expected: row.querySelector('[data-sx]').value.trim() })).filter(x => x.action);
  if (!(f.title || '').trim()) { toast('A script needs a title.'); return; }
  if (!steps.length) { toast('A script needs at least one step with an action.'); return; }
  if (steps.some(x => !x.expected)) { toast('Every step needs an expected result.'); return; }
  const next = cur.uatScripts.map(x => x.id === sid ? Object.assign({}, x, { title: f.title.trim(), given: (f.given || '').trim(), steps: steps.map((y, i) => ({ n: i + 1, action: y.action, expected: y.expected })), when: steps[0].action, then: steps[steps.length - 1].expected, data: f.data || [] }) : x);
  await store.save('project', prj.id, Object.assign({}, cur, { uatScripts: next }), `Edited UAT script “${f.title.trim()}” (${steps.length} step${steps.length === 1 ? '' : 's'})`);
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
