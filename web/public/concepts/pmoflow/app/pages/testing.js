/* Testing page (stream R): data profiling (statistics only), spec drift, generated test cases, process UAT scripts,
   step-level test runs with evidence and defects, discovered requirements. Route: /testing/:prj */
import { store } from '../store.js';
import { E, esc, fmt as fmtDay, fmtTime, addDays, link, go, av, pname, badge, modal, toast, commentsPanel, historyPanel, bindActivity, formValues } from '../ui.js';

/* R8: timestamps render as the browser's LOCAL calendar date; plain YYYY-MM-DD dates stay as they are. */
const fmt = s => s && /T\d/.test(String(s)) && !isNaN(new Date(s)) ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : fmtDay(s);
const ui = { sel: {}, paste: '', pasteOpen: false, busy: false, runOpen: new Set(), scriptOpen: new Set(), origin: 'all' };

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
const OUT_CLS = { pass: 'b-done', fail: 'b-late', blocked: 'b-soon', 'not-run': 'b-idle' };
const OUT_TXT = o => o === 'not-run' ? 'skipped' : o;
const rid = x => x.caseId || x.scriptId;
/* R5 environments, everywhere */
const ENVS = ['dev', 'sit', 'uat', 'prod-verify'];
const ENV_TXT = { dev: 'Build testing', sit: 'System testing', uat: 'Business testing', 'prod-verify': 'Check after launch' };
/* engine-written script text names environments by their professional terms; Simple mode shows the plain ones */
const plainEnv = t => String(t || '').replace(/\bUAT\b/g, 'business testing').replace(/\bSIT\b/g, 'system testing');
const envTxt = e => ENV_TXT[e] || String(e || '').toUpperCase();
/* R8 Simple: two stages */
const STAGE_TXT = { sit: 'Try it out (system test)', uat: 'Business sign-off test' };
const ENV_TIP = { dev: 'Development: where the build is made', sit: 'SIT (system integration testing): the systems tested together', uat: 'UAT (user acceptance testing): the people who run the process confirm it works', 'prod-verify': 'A check in production right after go-live' };
const envOpts = v => ENVS.map(e => `<option value="${e}" ${e === v ? 'selected' : ''}>${ENV_TXT[e]}</option>`).join('');
const scriptEnv = e => e !== 'dev'; /* scripts and scenarios run in SIT, UAT and prod verify */
/* R5: case labels TC<n> (per element, stable by creation) everywhere; raw ids never shown */
function caseLbl(id) { const e = E(); if (e && e.caseLabel) { try { const l = e.caseLabel(store.state.docs, id); if (l) return l; } catch (err) { /* fall through */ } } return 'TC'; }
/* R5: a UAT script or scenario pass needs evidence unless it came from CI */
const needsEvidence = (x, run) => !!x.scriptId && x.outcome === 'pass' && !(run && run.source === 'ci') && !String(x.evidence || '').trim();
const isUrl = v => /^https?:\/\/\S+$/i.test(String(v || '').trim());

/* Audit lines use names, never ids: swap any known doc id in an event summary for its name. */
function idNames() {
  const m = {};
  store.list('dataElement').forEach(d => { m[d.id] = d.name; });
  store.list('workItem').forEach(w => { m[w.id] = w.title; });
  store.list('process').forEach(p => { m[p.id] = p.name; });
  store.list('testRun').forEach(r => { m[r.id] = `${envTxt(r.env)} run, ${fmt(r.at)}`; });
  store.list('testCase').forEach(c => { const de = store.get('dataElement', c.dataId); m[c.id] = `${de ? de.name + ' ' : ''}${caseLbl(c.id)} · ${c.field}`; });
  store.list('project').forEach(p => (p.uatScripts || []).concat(p.uatScenarios || []).forEach(x => { m[x.id] = `“${x.title}”`; }));
  store.list('grant').forEach(g => { const de = store.get('dataElement', g.dataId); m[g.id] = `${de ? de.name : 'data'} ${envTxt(g.env)} access`; });
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
/* R5 end-to-end scenarios: one per path through each linked to-be process. Only adopted ones (project.uatScenarios) count. */
function genScenarios(prjId) { const e = E(); if (!e || !e.generateScenarios) return []; try { return e.generateScenarios(store.state.docs, prjId) || []; } catch (err) { return []; } }
function scenariosFor(prj) { return Array.isArray(prj.uatScenarios) ? { list: prj.uatScenarios, adopted: true } : { list: genScenarios(prj.id), adopted: false }; }
const isScn = (prj, id) => (prj.uatScenarios || []).some(x => x.id === id);
/* Everything recorded step by step in SIT/UAT/prod verify: UAT scripts plus adopted scenarios. */
function uatItems(prj) { return scriptsFor(prj).list.concat(Array.isArray(prj.uatScenarios) ? prj.uatScenarios : []); }

/* Walk the to-be tree (branches included) to find a node by id. */
function findNode(nodes, id) { for (const n of nodes || []) { if (!n) continue; if (n.id === id) return n; for (const b of n.branches || []) { const f = findNode(b && b.nodes, id); if (f) return f; } } return null; }
function stepLabel(pid, stepId) { const p = store.get('process', pid); const n = p && findNode(p.tobe, stepId); return { proc: p ? p.name : pid, step: n ? n.title : stepId, owner: n && n.owner }; }
function firstStepUsing(prj, dataId) {
  for (const pid of prj.processes || []) { const p = store.get('process', pid); if (!p) continue;
    const s = flat(p.tobe && p.tobe.length ? p.tobe : p.asis).find(x => (x.data || []).includes(dataId) || (x.subs || []).some(sb => (sb.data || []).includes(dataId)));
    if (s) return { pid, step: s.id }; }
  return { pid: (prj.processes || [])[0] || '', step: '' };
}

/* Coverage (R4): each case or script's outcome in an env is its latest result across ALL of this project's runs in that env,
   so a partial CI import keeps earlier passes. */
/* Skipped results (JUnit <skipped/> = 'not-run') never override an earlier result; a script pass without evidence (non-CI)
   doesn't count. Both are tracked so they're shown, never dropped silently. Same rules as the engine's tests-passed. */
function latestBy(prjId, env, runFilter) {
  const by = {}; const skipped = new Set(), noEv = new Set();
  runsFor(prjId).filter(r => r.env === env && (!runFilter || runFilter(r))).slice().reverse().forEach(r => (r.results || []).forEach(x => {
    const k = rid(x); if (!k) return;
    if (x.outcome === 'not-run' || x.outcome === 'skipped') { if (!by[k]) skipped.add(k); return; }
    if (needsEvidence(x, r)) { noEv.add(k); return; }
    by[k] = Object.assign({ runId: r.id, at: r.at }, x); skipped.delete(k);
  }));
  Object.defineProperty(by, '_skipped', { value: skipped }); Object.defineProperty(by, '_noEv', { value: noEv });
  return by;
}
function coverageOf(by, ids) {
  const covered = ids.filter(id => by[id]).length;
  const o = id => by[id] && by[id].outcome;
  return { covered, total: ids.length, fails: ids.filter(id => o(id) === 'fail').length, blocked: ids.filter(id => o(id) === 'blocked').length, pass: ids.filter(id => o(id) === 'pass').length,
    skipped: ids.filter(id => !by[id] && by._skipped && by._skipped.has(id)).length };
}
/* One run on its own (the run header's "covers x/y"). */
function coverage(run, ids) {
  if (!run) return null;
  const by = {}; (run.results || []).forEach(x => { if (x.outcome !== 'not-run') by[rid(x)] = x; });
  return coverageOf(by, ids);
}
/* Dialogs never lose input on a validation error: block the close and show the error inline (values stay as typed). */
function guard(validate) {
  const ovs = document.querySelectorAll('.overlay'); const ov = ovs[ovs.length - 1]; if (!ov) return;
  const mb = ov.querySelector('.mb');
  const box = document.createElement('div'); box.className = 'rl-err'; box.setAttribute('role', 'alert'); box.dataset.err = ''; box.hidden = true;
  mb.prepend(box);
  ov.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.dataset.act === 'cancel') return;
    mb.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
    const res = validate(formValues(mb), b.dataset.act, mb); if (!res) return;
    e.stopPropagation();
    const r = typeof res === 'string' ? { msg: res } : res;
    box.hidden = false; box.textContent = r.msg;
    const f = r.field && mb.querySelector(`[name="${r.field}"]`);
    if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
  }, true);
}
function effAvail(dataId) {
  const e = E(); const de = store.get('dataElement', dataId);
  if (e && e.effectiveAvail) { try { return e.effectiveAvail(store.state.docs, dataId); } catch (err) { /* fall through */ } }
  return (de && de.avail) || 'missing';
}
const cyclesOf = prj => Array.isArray(prj.testCycles) ? prj.testCycles : [];
const testerSel = (name, v, label) => `<select name="${name}" aria-label="${esc(label || 'Tester')}"><option value="">Unassigned</option>${store.state.people.map(p => `<option value="${esc(p.id)}" ${p.id === v ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
const testerChip = id => id ? `<span class="ts-tester" data-tester="${esc(id)}">${av(id)} ${esc(pname(id))}</span>` : '<span class="hint">Unassigned</span>';

export function render(params) {
  const prjId = params.prj;
  const prj = store.get('project', prjId);
  const projects = store.list('project');
  if (!prj) return `<section class="hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> · Testing</div><h1>Testing</h1><p>Project not found.</p></div></section>
    <div class="home-grid">${projects.map(p => `<a class="tile" href="${link('/testing/' + p.id)}" data-link><h4>${esc(p.name)}</h4><p>${esc(p.desc || '')}</p></a>`).join('') || '<div class="empty">No projects yet.</div>'}</div>`;
  if (!store.advanced) return simpleRender(prj);
  const des = projectData(prj);
  let did = params.q && params.q.de && des.some(d => d.id === params.q.de) ? params.q.de : ui.sel[prjId];
  if (!des.some(d => d.id === did)) did = des[0] && des[0].id;
  ui.sel[prjId] = did;
  const de = did ? store.get('dataElement', did) : null;
  const tc = testsCheck(prjId);
  const runs = runsFor(prjId);
  const caseIds = []; des.forEach(d => casesFor(d.id).forEach(c => caseIds.push(c.id)));
  const sc = scriptsFor(prj);
  const scn = scenariosFor(prj);
  const uatIds = uatItems(prj).map(x => x.id);
  const devCov = runs.some(r => r.env === 'dev') ? coverageOf(latestBy(prjId, 'dev'), caseIds) : null;
  const uatCov = runs.some(r => r.env === 'uat') ? coverageOf(latestBy(prjId, 'uat'), caseIds.concat(uatIds)) : null;
  const covKpi = (label, cov, attr) => { const full = cov && cov.covered === cov.total && !cov.fails && !cov.blocked;
    return `<div class="kpi" data-cov="${attr}"><b class="${cov ? (full ? 'pass' : 'fail') : ''}">${cov ? `${cov.covered}/${cov.total}` : '—'}</b><span>${label}${cov && cov.fails ? ` · ${cov.fails} fail` : ''}${cov && cov.skipped ? ` · ${cov.skipped} skipped` : ''}</span></div>`; };
  const openDefects = store.list('workItem', w => w.projectId === prjId && w.kind === 'defect' && w.status !== 'done').length;

  const header = `<section class="hdr"><div>
      <div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> · <a href="${link('/project/' + prjId)}" data-link>${esc(prj.name)}</a> · Testing</div>
      <div class="rl-title"><h1>Testing</h1><select class="rl-switch" data-switch aria-label="Project">${projects.map(p => `<option value="${esc(p.id)}" ${p.id === prjId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <p>Data tests come from each data element's spec plus a statistical profile of a real extract (counts, lengths and patterns only, never raw values). Process UAT scripts walk every new or changed step and every branch; end-to-end scenarios walk each whole path. Environments: Dev, SIT, UAT and Prod verify. Coverage counts each item's latest result across every run in that environment.</p></div>
    <div class="hdr-side"><div class="kpis"><div class="kpi"><b>${caseIds.length}</b><span>Data cases</span></div><div class="kpi"><b>${sc.list.length}</b><span>UAT scripts</span></div><div class="kpi" data-kpi-scn><b>${scn.adopted ? scn.list.length : 0}</b><span>Scenarios${scn.adopted ? '' : ' · not adopted'}</span></div>${covKpi('Dev coverage · latest per case', devCov, 'dev')}${covKpi('UAT coverage · latest per item', uatCov, 'uat')}<div class="kpi"><b class="${openDefects ? 'fail' : ''}">${openDefects}</b><span>Open defects</span></div></div></div></section>
    ${tc ? `<div class="ts-strip ${tc.pass ? 'pass' : 'fail'}" data-tests-check="${tc.pass ? 'pass' : 'fail'}"><span class="rl-ic ${tc.pass ? 'pass' : 'fail'}">${tc.pass ? '✓' : '✕'}</span>
      <div><b>Go-live check: ${esc(tc.label)}</b> — ${esc(tc.detail || '')}</div><a class="rl-go" href="${link('/release/' + prjId)}" data-link>Readiness gate ›</a></div>` : ''}
    ${traceStrip(prj, des)}`;

  const projectCards = `<div class="ts-proj">${coverageCard(prj, des, runs, sc)}${cyclesCard(prj, des, sc)}${scriptsCard(prj, sc)}${scenariosCard(prj, scn)}${runsCard(prj, des, runs, caseIds, sc)}${defectsCard(prj)}
    <div class="card"><h3>Test history</h3><div data-ts-history><div class="hint">Loading…</div></div></div></div>`;

  if (!des.length) return header + `<div class="card" style="margin-top:16px"><div class="empty">This project's processes use no data elements yet. Add data to the to-be steps to test it.</div></div>` + projectCards;

  const list = `<nav class="ts-list" aria-label="Data elements">${des.map(d => {
    const p = latestProfile(d.id); const n = casesFor(d.id).length; const openReq = (d.discovered || []).filter(x => !x.resolved).length;
    return `<a href="${link('/testing/' + prjId + '?de=' + d.id)}" data-de="${esc(d.id)}" class="${d.id === did ? 'on' : ''}"><span class="ts-dot ${esc(effAvail(d.id))}" title="${esc({ live: 'Live', pending: 'Fix done, awaiting owner confirmation', example: 'Examples only', missing: 'Missing' }[effAvail(d.id)] || '')}"></span><span class="ts-nm">${esc(d.name)}</span><small>${n} case${n === 1 ? '' : 's'}${p ? ' · profiled' : ''}${openReq ? ` · <b class="ts-open">${openReq} open req${openReq === 1 ? '' : 's'}</b>` : ''}</small></a>`;
  }).join('')}</nav>`;

  return header + `<div class="ts-layout">${list}<div class="ts-main">${profileCard(de)}${casesCard(de)}${discoveredCard(de)}
    <div class="two ts-act"><div class="card"><h3>Comments</h3>${commentsPanel('dataElement:' + de.id)}</div><div class="card"><h3>History · ${esc(de.name)}</h3>${historyPanel('dataElement:' + de.id)}</div></div></div></div>` + projectCards;
}

/* R6 traceability headline: UAT done/total next to spec-field coverage, from E().testCoverage (local fallback).
   Uncovered fields are listed per data element with a one-press "Generate". */
function traceOf(prj, des) {
  const e = E(); let tc = null;
  if (e && e.testCoverage) { try { tc = e.testCoverage(store.state.docs, prj.id, store.state.today); } catch (err) { tc = null; } }
  const by = latestBy(prj.id, 'uat'); const items = uatItems(prj);
  const uatL = { done: items.filter(x => by[x.id] && by[x.id].outcome === 'pass').length, total: items.length };
  const unc = []; let fTotal = 0;
  des.forEach(d => { fTotal += (d.fields || []).length; const fc = fieldCoverage(d); fc.missing.concat(fc.customOnly).forEach(f => unc.push({ dataId: d.id, field: f })); });
  const pick = (o, ...ks) => { for (const k of ks) { const v = k.split('.').reduce((a, x) => a == null ? a : a[x], o); if (v != null) return v; } return null; };
  const uat = tc ? { done: pick(tc, 'uat.done', 'uat.passed', 'uatDone', 'uat.pass') ?? uatL.done, total: pick(tc, 'uat.total', 'uatTotal') ?? uatL.total } : uatL;
  const engUnc = tc && pick(tc, 'fields.uncovered', 'uncoveredFields', 'uncovered');
  const uncovered = Array.isArray(engUnc) ? engUnc.map(x => typeof x === 'string' ? { dataId: '', field: x } : { dataId: x.dataId || x.data || '', field: x.field || x.name || '' }) : unc;
  const total = tc ? (pick(tc, 'fields.total', 'fieldsTotal', 'specFields') ?? fTotal) : fTotal;
  return { uat, fields: { total, uncovered, covered: Math.max(0, total - uncovered.length) }, engine: !!tc };
}
function traceStrip(prj, des) {
  const t = traceOf(prj, des);
  const u = t.uat, f = t.fields;
  const byDe = new Map(); f.uncovered.forEach(x => { if (!byDe.has(x.dataId)) byDe.set(x.dataId, []); byDe.get(x.dataId).push(x.field); });
  const full = u.total && u.done === u.total;
  return `<div class="ts-trace" data-trace><div class="ts-trace-k"><span class="ts-trace-n ${full ? 'pass' : 'fail'}" data-trace-uat="${u.done}/${u.total}"><b>UAT ${u.done}/${u.total}</b><small title="User acceptance testing: data cases, UAT scripts and adopted end-to-end scenarios whose latest UAT result passed">cases, scripts and scenarios passed in UAT</small></span>
      <span class="ts-trace-n ${f.uncovered.length ? 'fail' : 'pass'}" data-trace-fields="${f.uncovered.length}"><b>${f.uncovered.length ? `${f.uncovered.length} spec field${f.uncovered.length === 1 ? '' : 's'} without a case` : `All ${f.total} spec fields covered`}</b><small>${f.covered}/${f.total} fields have a spec- or profile-based case</small></span></div>
    ${f.uncovered.length ? `<div class="ts-trace-l">${[...byDe.entries()].map(([did, fs]) => { const d = store.get('dataElement', did); return `<div class="ts-trace-r" data-trace-de="${esc(did)}"><span><b>${esc(d ? d.name : 'Data')}</b> · ${esc(fs.join(', '))}</span>${d ? `<button class="btn sm" data-gen-de="${esc(did)}">Generate</button>` : ''}</div>`; }).join('')}</div>` : ''}</div>`;
}

const rowsOf = prof => prof ? (prof.rows != null ? prof.rows : prof.rowCount != null ? prof.rowCount : Math.max(0, ...(prof.columns || []).map(c => (c.nulls || 0) + (c.nonNull || 0)))) : 0;
/* Never show "undefined" in a drift message: fall back to the profile's row count. */
const fixU = (t, prof) => String(t == null ? '' : t).replace(/\bundefined\b/g, String(rowsOf(prof))).replace(/\bof (\?|NaN|null) (rows?|values?)\b/g, `of ${rowsOf(prof)} $2`);
/* Patterns humanized, then merged so two raw shapes that read the same ("8 digits") show as one row with summed counts. */
function mergedPatterns(pats) {
  const e = E();
  if (e && e.humanPatterns) { try { return e.humanPatterns(pats || []).map(x => ({ html: `<span class="ts-hp">${esc(x.text)}</span>`, count: x.count })); } catch (err) { /* fall through */ } }
  const m = new Map(); (pats || []).forEach(p => { const k = human(p.pattern); m.set(k, (m.get(k) || 0) + (p.count || 0)); });
  return [...m.entries()].map(([html, count]) => ({ html, count })).sort((a, b) => b.count - a.count);
}
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
      <td data-patterns>${mergedPatterns(c.patterns).slice(0, 3).map(p => `${p.html} <small>×${esc(p.count)}</small>`).join('<br>')}</td>
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

/* R5 coverage: every spec field needs at least one case that isn't a custom case. */
const tok = s => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function fieldCoverage(de) {
  const cs = casesFor(de.id);
  const missing = [], customOnly = [];
  (de.fields || []).forEach(f => {
    const mine = cs.filter(c => tok(c.field) === tok(f.name));
    if (!mine.length) missing.push(f.name);
    else if (mine.every(c => c.kind === 'custom')) customOnly.push(f.name);
  });
  return { missing, customOnly };
}
function fieldCoverageNote(fc) {
  return `<div class="ts-fieldcov" data-field-gaps>${fc.missing.length ? `<div data-fields-missing><b>${fc.missing.length} spec field${fc.missing.length === 1 ? ' has' : 's have'} no test case:</b> ${esc(fc.missing.join(', '))}.</div>` : ''}
    ${fc.customOnly.length ? `<div data-fields-custom-only><b>Covered by custom cases only (doesn't count):</b> ${esc(fc.customOnly.join(', '))}.</div>` : ''}
    <div class="hint">Go-live needs every spec field covered by a case generated from the spec or the profile. A custom case is a person's free-form check: it isn't derived from the documented rule, so it can't prove the rule holds. Generate test cases to close the gap.</div></div>`;
}

const ORIGIN_TXT = { spec: 'From the spec', profile: 'From the profile (observed shapes, synthetic values)', user: 'Added by a person' };
function casesCard(de) {
  const all = casesFor(de.id).sort((a, b) => (+caseLbl(a.id).slice(2) || 0) - (+caseLbl(b.id).slice(2) || 0));
  const fc = fieldCoverage(de);
  const n = o => all.filter(c => (c.origin || 'user') === o).length;
  const cases = ui.origin === 'all' ? all : all.filter(c => (c.origin || 'user') === ui.origin);
  const unassigned = all.filter(c => !c.tester).length;
  const noSpec = !(de.fields || []).length;
  return `<div class="card" id="cases"><h3>Test cases<span class="n">${all.length}</span></h3>
    <div class="ts-prof-tools">${ui.genBusy && ui.genBusy[de.id] ? '<button class="btn sm primary" data-gen data-gen-busy disabled>Saving generated cases…</button>' : `<button class="btn sm primary" data-gen ${noSpec && !latestProfile(de.id) ? 'disabled title="Add a spec or a profile first"' : ''}>Generate test cases</button>`}<button class="btn sm" data-add-case>Add custom case</button>
      <span class="hint">${noSpec ? 'No spec yet: add custom cases by field name, or write the spec on the data page.' : `Generated from the spec${latestProfile(de.id) ? ' and the latest profile' : ''}. Duplicates are skipped.`}</span></div>
    ${fc.missing.length || fc.customOnly.length ? fieldCoverageNote(fc) : (de.fields || []).length ? `<div class="ts-ok" data-fields-covered>Every spec field (${(de.fields || []).length}) has at least one spec- or profile-based case.</div>` : ''}
    ${all.length ? `<div class="ts-filters" role="group" aria-label="Filter by origin">${[['all', 'All', all.length], ['spec', 'Spec', n('spec')], ['profile', 'Profile', n('profile')], ['user', 'Custom', n('user')]].map(([k, l, c]) => `<button class="ts-fb ${ui.origin === k ? 'on' : ''}" data-origin="${k}" aria-pressed="${ui.origin === k}">${l} <b>${c}</b></button>`).join('')}
      <span class="ts-assign">${unassigned ? `<label class="hint">${unassigned} unassigned · assign to</label>${testerSel('bulkTester', '', 'Assign unassigned cases to')}<button class="btn sm" data-bulk-assign>Assign</button>` : '<span class="hint">Every case has a tester.</span>'}</span></div>
      ${n('profile') ? `<div class="hint ts-profnote" data-profile-cases="${n('profile')}">${n('profile')} case${n('profile') === 1 ? '' : 's'} reproduce shapes observed in the profiled extract (lengths, characters, blanks). Inputs are synthetic, never raw values.</div>` : ''}
      <div class="tbl-wrap ts-scroll"><table class="ts-tbl"><thead><tr><th>ID</th><th>Field</th><th>Kind</th><th>Input</th><th>Expect</th><th>Origin</th><th>Tester</th><th></th></tr></thead><tbody>
      ${cases.map(c => `<tr data-case="${esc(c.id)}" data-origin-row="${esc(c.origin || 'user')}"><td><code class="ts-id" data-case-label>${esc(caseLbl(c.id))}</code></td><td>${esc(c.field)}</td><td>${badge(c.kind, KIND_CLS[c.kind])}</td><td><code class="ts-in" title="${esc(c.input)}">${c.input === '' ? '<i>(empty)</i>' : short(c.input)}</code>${c.note ? `<div class="hint">${esc(c.note)}</div>` : ''}</td>
        <td>${badge(c.expect, c.expect === 'accept' ? 'b-done' : 'b-late')}</td><td><span class="chip ts-org ${esc(c.origin || 'user')}" title="${esc(ORIGIN_TXT[c.origin || 'user'] || '')}">${esc(c.origin || 'user')}</span></td><td>${testerChip(c.tester)}</td>
        <td class="rl-acts"><button class="btn sm" data-edit-case="${esc(c.id)}">Edit</button><button class="btn sm danger" data-del-case="${esc(c.id)}">Delete</button></td></tr>`).join('') || `<tr><td colspan="8" class="hint">No ${esc(ui.origin)} cases.</td></tr>`}</tbody></table></div>`
      : `<div class="empty">No test cases yet. ${noSpec ? 'Add a custom case by field name.' : 'Generate them from the spec and profile.'}</div>`}</div>`;
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

function scriptsCard(prj, sc) {
  const resBy = latestBy(prj.id, 'uat');
  const gen = sc.adopted ? generated(prj.id) : [];
  const have = new Set(sc.list.map(x => x.id));
  const fresh = gen.filter(x => !have.has(x.id));
  const rows = sc.list.map((s, si) => {
    const lb = stepLabel(s.pid, s.step); const res = resBy[s.id]; const o = res && res.outcome;
    const so = {}; ((res && res.steps) || []).forEach(x => { so[x.n] = x.outcome; });
    const steps = scriptSteps(s);
    return `<details class="ts-script" data-script="${esc(s.id)}" ${ui.scriptOpen.has(s.id) ? 'open' : ''}>
      <summary><span class="ts-script-h"><b>${esc(s.title)}</b>${o ? badge(o, OUT_CLS[o]) : badge('not run', 'b-idle')}</span>
      <span class="hint"><code class="ts-id" data-script-label>S${si + 1}</code> · ${esc(lb.proc)} · ${esc(lb.step)}${lb.owner ? ' · ' + esc(pname(lb.owner)) : ''} · ${steps.length} step${steps.length === 1 ? '' : 's'}</span>
      <span class="ts-script-t">Tester: ${testerChip(s.tester)}</span></summary>
      <div class="ts-script-b"><div class="ts-given"><span>Given</span> ${esc(s.given)}</div>
        <ol class="ts-ssteps">${steps.map(x => `<li data-sstep="${x.n}"><div><b>${esc(x.action)}</b><div class="ts-exp"><span>Expected</span> ${esc(x.expected)}</div></div>${so[x.n] ? badge(so[x.n], OUT_CLS[so[x.n]]) : ''}</li>`).join('')}</ol>
        ${(s.data || []).length ? `<div class="chips">${(s.data || []).map(d => `<span class="chip">${esc((store.get('dataElement', d) || {}).name || d)}</span>`).join(' ')}</div>` : ''}
        <div class="ts-script-a"><a class="rl-go" href="${link(`/process/${s.pid}?mode=diff`)}" data-link>Open step in the process ›</a>${sc.adopted ? `<span class="ts-sassign">${testerSel('st_' + s.id, s.tester, 'Tester for ' + s.title).replace('<select ', `<select data-script-tester="${esc(s.id)}" `)}</span><button class="btn sm" data-edit-script="${esc(s.id)}">Edit</button><button class="btn sm danger" data-del-script="${esc(s.id)}">Delete</button>` : '<span class="hint">Adopt the scripts to assign testers and edit steps.</span>'}</div></div></details>`;
  }).join('');
  return `<div class="card" id="uat-scripts"><h3>Process UAT scripts<span class="n">${sc.list.length}${sc.adopted ? ' · adopted' : ' · generated'}</span></h3>
    ${sc.adopted
      ? `<div class="ts-prof-tools"><span class="hint">Each script is a numbered list of actions with an expected result. A script passes only when every step passes in the latest UAT run.</span>${fresh.length ? `<button class="btn sm" data-add-gen>Add ${fresh.length} newly generated</button>` : ''}</div>`
      : `<div class="ts-adopt"><div><b>Generated from the to-be design</b> · one script per new or changed step and one per gateway branch. Adopt them to edit the steps and keep them with the project.</div><button class="btn sm primary" data-adopt ${sc.list.length ? '' : 'disabled'}>Adopt generated scripts</button></div>`}
    <div class="ts-scripts">${rows || '<div class="empty">No new or changed steps in the to-be design, so there is nothing to script yet.</div>'}</div></div>`;
}

/* R5 end-to-end scenarios (E().generateScenarios): adopt into project.uatScenarios, edit, record step by step in SIT/UAT/prod verify. */
function scenariosCard(prj, scn) {
  const resBy = latestBy(prj.id, 'uat');
  const have = new Set(scn.adopted ? scn.list.map(x => x.id) : []);
  const fresh = scn.adopted ? genScenarios(prj.id).filter(x => !have.has(x.id)) : [];
  const rows = scn.list.map((s, i) => {
    const res = resBy[s.id]; const o = res && res.outcome;
    const so = {}; ((res && res.steps) || []).forEach(x => { so[x.n] = x.outcome; });
    const steps = scriptSteps(s);
    const proc = store.get('process', s.pid);
    return `<details class="ts-script ts-scn" data-scenario="${esc(s.id)}" ${ui.scriptOpen.has(s.id) ? 'open' : ''}>
      <summary><span class="ts-script-h"><b>${esc(s.title)}</b>${o ? badge(o, OUT_CLS[o]) : badge(resBy._noEv && resBy._noEv.has(s.id) ? 'pass without evidence' : 'not run', 'b-idle')}</span>
      <span class="hint"><code class="ts-id">E2E ${i + 1}</code> · ${esc(proc ? proc.name : 'Process')} · ${steps.length} step${steps.length === 1 ? '' : 's'}</span>
      <span class="ts-script-t">Tester: ${testerChip(s.tester)}</span></summary>
      <div class="ts-script-b"><ol class="ts-ssteps">${steps.map(x => `<li data-sstep="${x.n}"><div><b>${esc(x.action)}</b><div class="ts-exp"><span>Expected</span> ${esc(x.expected)}</div></div>${so[x.n] ? badge(so[x.n], OUT_CLS[so[x.n]]) : ''}</li>`).join('')}</ol>
        ${(s.data || []).length ? `<div class="chips">${(s.data || []).map(d => `<span class="chip">${esc((store.get('dataElement', d) || {}).name || 'Data')}</span>`).join(' ')}</div>` : ''}
        <div class="ts-script-a">${scn.adopted ? `<span class="ts-sassign">${testerSel('sn_' + s.id, s.tester, 'Tester for ' + s.title).replace('<select ', `<select data-scn-tester="${esc(s.id)}" `)}</span><button class="btn sm" data-edit-scn="${esc(s.id)}">Edit</button><button class="btn sm danger" data-del-scn="${esc(s.id)}">Delete</button>` : '<span class="hint">Adopt the scenarios to edit, assign and record them.</span>'}</div></div></details>`;
  }).join('');
  return `<div class="card" id="scenarios"><h3>End-to-end scenarios<span class="n">${scn.list.length}${scn.adopted ? ' · adopted' : ' · generated'}</span></h3>
    ${scn.adopted
      ? `<div class="ts-prof-tools"><span class="hint">Each scenario walks one whole path through a to-be process, decision by decision. They count toward UAT coverage, are recorded step by step, and a pass needs evidence.</span>${fresh.length ? `<button class="btn sm" data-add-scn>Add ${fresh.length} newly generated</button>` : ''}</div>`
      : `<div class="ts-adopt"><div><b>Generated from the to-be paths</b> · one scenario per path through each linked process (every decision branch expanded, loop-backs followed once). Adopt them to edit, assign testers and record them; adopted scenarios count toward UAT coverage.</div><button class="btn sm primary" data-adopt-scn ${scn.list.length ? '' : 'disabled'}>Adopt ${scn.list.length} scenario${scn.list.length === 1 ? '' : 's'}</button></div>`}
    <div class="ts-scripts">${rows || '<div class="empty">No linked to-be process has a path to walk yet.</div>'}</div></div>`;
}

/* Aggregate outcome of a set of ids in a run: fail > blocked > partial > pass. */
function aggOutcome(byMap, ids) {
  if (!ids.length) return { cls: 'none', text: '—' };
  if (!byMap) return { cls: 'norun', text: 'no run' };
  const out = ids.map(id => byMap[id] && byMap[id].outcome);
  const f = out.filter(o => o === 'fail').length, b = out.filter(o => o === 'blocked').length, p = out.filter(o => o === 'pass').length;
  const sk = ids.filter(id => !byMap[id] && byMap._skipped && byMap._skipped.has(id)).length;
  if (f) return { cls: 'fail', text: `${f} fail` };
  if (b) return { cls: 'blocked', text: `${b} blocked` };
  if (p < ids.length) return { cls: 'partial', text: `${p}/${ids.length} run${sk ? ` · ${sk} skipped` : ''}` };
  return { cls: 'pass', text: `${p}/${ids.length} pass` };
}
function coverageCard(prj, des, runs, sc) {
  /* Dev and UAT are always shown (the gate reads them); SIT and Prod verify appear once they have runs */
  const envs = ENVS.filter(e => e === 'dev' || e === 'uat' || runs.some(r => r.env === e));
  const last = {}; envs.forEach(e => { last[e] = runs.some(r => r.env === e) ? latestBy(prj.id, e) : null; });
  const openDef = store.list('workItem', w => w.projectId === prj.id && w.kind === 'defect' && w.status !== 'done');
  const e = E();
  const cell = o => `<td><span class="ts-o ${o.cls}">${esc(o.text)}</span></td>`;
  const dash = '<td><span class="ts-o none">—</span></td>';
  const rows = [];
  let gaps = 0;
  des.forEach(d => {
    const ids = casesFor(d.id).map(c => c.id);
    const fc = fieldCoverage(d);
    const gap = !ids.length || fc.missing.length || fc.customOnly.length;
    if (gap) gaps++;
    const defs = openDef.filter(w => w.testRef && w.testRef.caseId && ids.includes(w.testRef.caseId)).length;
    const gapTxt = [fc.missing.length ? `no case: ${fc.missing.join(', ')}` : '', fc.customOnly.length ? `custom only (doesn't count): ${fc.customOnly.join(', ')}` : ''].filter(Boolean).join(' · ');
    rows.push(`<tr class="${gap ? 'ts-zero' : ''}" data-cov-row="data:${esc(d.id)}"><td><span class="chip">Data</span> <a href="${link(`/testing/${prj.id}?de=${d.id}`)}" data-link>${esc(d.name)}</a>${gapTxt ? `<div class="ts-gap" data-cov-gap>${esc(gapTxt)}</div>` : ''}</td>
      <td>${ids.length ? `${ids.length} case${ids.length === 1 ? '' : 's'}` : '<b>0 cases</b>'}${(d.fields || []).length ? `<div class="hint">${(d.fields || []).length - fc.missing.length - fc.customOnly.length}/${(d.fields || []).length} fields</div>` : ''}</td>${envs.map(env => cell(aggOutcome(last[env], ids))).join('')}<td>${defs ? badge(defs + ' open', 'b-late') : '0'}</td></tr>`);
  });
  const items = uatItems(prj);
  (prj.processes || []).map(id => store.get('process', id)).filter(Boolean).forEach(p => {
    let diff = { nodes: {} }; try { if (e && e.diffProcess) diff = e.diffProcess(p); } catch (err) { /* ignore */ }
    const gates = []; const walk = ns => (ns || []).forEach(n => { if (!n) return; if ((n.branches || []).length) { gates.push(n); n.branches.forEach(b => walk(b && b.nodes)); } });
    walk(p.tobe);
    flat(p.tobe).concat(gates).forEach(s => {
      const ids = sc.list.filter(x => x.pid === p.id && x.step === s.id).map(x => x.id);
      const st = diff.nodes[s.id] || 'same';
      const needs = st !== 'same';
      if (!ids.length && needs) gaps++;
      const defs = openDef.filter(w => w.pid === p.id && w.step === s.id).length;
      rows.push(`<tr class="${!ids.length && needs ? 'ts-zero' : ''}" data-cov-row="step:${esc(p.id)}:${esc(s.id)}"><td><span class="chip">${(s.branches || []).length ? 'Gateway' : 'Step'}</span> <a href="${link(`/process/${p.id}/step/${s.id}`)}" data-link>${esc(s.title)}</a> <small>${esc(p.name)}${needs ? ` · ${esc(st)}` : ' · unchanged'}</small></td>
        <td>${ids.length ? `${ids.length} script${ids.length === 1 ? '' : 's'}` : needs ? '<b>0 scripts</b>' : '<span class="hint">unchanged: regression optional</span>'}</td>${envs.map(env => env === 'dev' ? dash : cell(aggOutcome(last[env], ids))).join('')}<td>${defs ? badge(defs + ' open', 'b-late') : '0'}</td></tr>`);
    });
  });
  (prj.uatScenarios || []).forEach((x, i) => {
    rows.push(`<tr data-cov-row="scenario:${esc(x.id)}"><td><span class="chip">Scenario</span> <a href="#scenarios" data-anchor-scn>${esc(x.title)}</a> <small>E2E ${i + 1}</small></td><td>${scriptSteps(x).length} steps</td>${envs.map(env => env === 'dev' ? dash : cell(aggOutcome(last[env], [x.id]))).join('')}<td>0</td></tr>`);
  });
  const skipped = envs.reduce((n, env) => n + (last[env] && last[env]._skipped ? last[env]._skipped.size : 0), 0);
  const noEv = new Set(); envs.forEach(env => { if (last[env] && last[env]._noEv) last[env]._noEv.forEach(k => { if (!last[env][k]) noEv.add(k); }); });
  return `<div class="card" id="coverage"><h3>Coverage matrix<span class="n">${gaps ? `${gaps} uncovered` : 'all covered'}</span></h3>
    <div class="hint" style="margin-bottom:8px">Rows are the project's data elements, to-be steps and adopted end-to-end scenarios. Red rows have a coverage gap: every spec field needs a case generated from the spec or profile (custom-only fields don't count), and every new or changed step needs a script. Each cell is the latest result per item across every run in that environment.</div>
    ${skipped || noEv.size ? `<div class="ts-warn" data-cov-notes>${skipped ? `<span data-skipped-count="${skipped}">${skipped} skipped (JUnit &lt;skipped/&gt;, counted as not run)</span>` : ''}${skipped && noEv.size ? ' · ' : ''}${noEv.size ? `<span data-noev-count="${noEv.size}">${noEv.size} script or scenario pass${noEv.size === 1 ? '' : 'es'} without evidence (don't count)</span>` : ''}</div>` : ''}
    <div class="tbl-wrap"><table class="ts-tbl ts-cov-tbl"><thead><tr><th>Data element / step / scenario</th><th>Cases / scripts</th>${envs.map(env => `<th title="${esc(ENV_TIP[env] || '')}">${esc(envTxt(env))} (latest)</th>`).join('')}<th>Open defects</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></div>`;
}

/* ---------- planned test cycles (R4): project.testCycles = [{id, name, env, start, end, testers:[personId]}]; runs carry cycleId ---------- */
function envItems(prj, des, sc, env) {
  const items = []; des.forEach(d => casesFor(d.id).forEach(c => items.push({ id: c.id, tester: c.tester })));
  if (scriptEnv(env)) uatItems(prj).forEach(x => items.push({ id: x.id, tester: x.tester }));
  return items;
}
function cycleState(c) { const t = store.state.today; return c.start && t < c.start ? 'planned' : c.end && t > c.end ? 'closed' : 'active'; }
function cycleProgress(prj, c, des, sc) {
  const items = envItems(prj, des, sc, c.env);
  const by = latestBy(prj.id, c.env, r => r.cycleId === c.id);
  const cov = coverageOf(by, items.map(x => x.id));
  /* R5: per-tester progress = the results that tester recorded in this cycle (latest per item), against what's assigned to them */
  const cycRuns = runsFor(prj.id).filter(r => r.cycleId === c.id && r.env === c.env);
  const per = (c.testers || []).map(t => {
    const rec = new Set(); cycRuns.filter(r => r.by === t).forEach(r => (r.results || []).forEach(x => { if (rid(x) && x.outcome !== 'not-run') rec.add(rid(x)); }));
    const mine = items.filter(x => x.tester === t);
    return { t, recorded: rec.size, assigned: mine.length, assignedDone: mine.filter(x => rec.has(x.id)).length };
  });
  const runs = cycRuns.length;
  return { cov, per, runs };
}
function cyclesCard(prj, des, sc) {
  const cyc = cyclesOf(prj).slice().sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
  const ST = { planned: ['Planned', 'b-idle'], active: ['In progress', 'b-prog'], closed: ['Window closed', 'b-soon'] };
  return `<div class="card" id="cycles"><h3>Test cycles<span class="n">${cyc.length}</span></h3>
    <div class="ts-prof-tools"><button class="btn sm primary" data-add-cycle>Plan a test cycle</button><span class="hint">A cycle is a planned window in one environment with named testers. Runs recorded in a cycle count toward its progress.</span></div>
    ${cyc.length ? cyc.map(c => {
      const pr = cycleProgress(prj, c, des, sc); const cv = pr.cov; const st = cycleState(c);
      const pct = x => cv.total ? Math.round(100 * x / cv.total) : 0;
      return `<div class="ts-cyc" data-cycle-id="${esc(c.id)}"><div class="ts-cyc-h"><b>${esc(c.name)}</b><span class="chip">${esc(envTxt(c.env))}</span>${badge(ST[st][0], ST[st][1])}
          <span class="hint">${esc(fmt(c.start))} – ${esc(fmt(c.end))} · ${pr.runs} run${pr.runs === 1 ? '' : 's'}</span></div>
        <div class="ts-cbar" aria-label="${cv.covered} of ${cv.total} run"><i class="p" style="width:${pct(cv.pass)}%"></i><i class="f" style="width:${pct(cv.fails)}%"></i><i class="b" style="width:${pct(cv.blocked)}%"></i></div>
        <div class="ts-cyc-s" data-cycle-progress><b>${cv.covered}/${cv.total}</b> run · ${cv.pass} pass${cv.fails ? ` · <b class="ts-open">${cv.fails} fail</b>` : ''}${cv.blocked ? ` · ${cv.blocked} blocked` : ''}</div>
        <div class="ts-cyc-t">${pr.per.map(x => `<span class="ts-tprog" data-tester-progress="${esc(x.t)}" title="Results ${esc(pname(x.t))} recorded in this cycle">${av(x.t)} ${esc(pname(x.t))} <b>${x.recorded} recorded</b>${x.assigned ? ` <small>${x.assignedDone}/${x.assigned} assigned</small>` : ''}</span>`).join('') || '<span class="hint">No testers named.</span>'}</div>
        <div class="ts-script-a">${(c.testers || []).includes(store.state.me) ? `<button class="btn sm primary" data-cycle-run="${esc(c.id)}">Record run in this cycle</button>` : `<button class="btn sm" disabled>Record run in this cycle</button><span class="hint" data-why="tester">Only this cycle's testers (${esc((c.testers || []).map(pname).join(', '))}) can record results in it.</span>`}<button class="btn sm" data-edit-cycle="${esc(c.id)}">Edit</button><button class="btn sm danger" data-del-cycle="${esc(c.id)}">Delete</button></div></div>`;
    }).join('') : '<div class="empty">No test cycles planned. Plan one to give testers a window and track progress per tester.</div>'}</div>`;
}

/* The items to retest: failed or blocked in the latest run of that env. */
function retestIds(prjId, env) { const by = latestBy(prjId, env); return Object.keys(by).filter(k => by[k].outcome === 'fail' || by[k].outcome === 'blocked'); }

function runsCard(prj, des, runs, caseIds, sc) {
  const caseIdx = {}; des.forEach(d => casesFor(d.id).forEach(c => caseIdx[c.id] = c));
  const scIdx = {}; uatItems(prj).forEach(s => scIdx[s.id] = s);
  const me = store.state.me;
  const retest = ENVS.map(env => { const ids = retestIds(prj.id, env); return ids.length ? `<button class="btn sm" data-retest="${env}">Retest failures · ${envTxt(env)} (${ids.length})</button>` : ''; }).join('');
  return `<div class="card" id="runs"><h3>Test runs<span class="n">${runs.length}</span></h3>
    <div class="ts-prof-tools"><button class="btn sm primary" data-record>Record test run</button>${retest}<button class="btn sm" data-ci>Import CI results (JUnit)</button><span class="hint">Every row starts as not run. A fail needs a note. Retests run only what failed; coverage keeps each item's latest result.</span></div>
    ${runs.length ? runs.map(r => {
      const ids = scriptEnv(r.env) ? caseIds.concat(uatItems(prj).map(x => x.id)) : caseIds;
      const cov = coverage(r, ids);
      const c = (r.results || []).reduce((a, x) => (a[x.outcome] = (a[x.outcome] || 0) + 1, a), {});
      const open = ui.runOpen.has(r.id);
      const carried = (r.results || []).filter(x => x.carriedFrom).length;
      const rows = (r.results || []).filter(x => !x.carriedFrom && (x.outcome !== 'pass' || x.defectId));
      const passEv = (r.results || []).filter(x => !x.carriedFrom && x.outcome === 'pass' && !x.defectId && (x.evidence || x.note));
      const partial = cov && cov.covered < cov.total && !r.retestOf;
      return `<div class="ts-run" data-run="${esc(r.id)}"><div class="ts-run-h" data-run-toggle="${esc(r.id)}" role="button" tabindex="0" aria-expanded="${open}" aria-label="${esc(envTxt(r.env))} run ${esc(fmtTime(r.at))}: show details"><span class="chip">${esc(envTxt(r.env))}</span>
        ${r.cycle > 1 ? `<span class="chip ts-cycle" data-cycle="${esc(r.cycle)}">Cycle ${esc(r.cycle)} retest</span>` : ''}${r.cycleId ? `<span class="chip ts-cname" data-run-cycle="${esc(r.cycleId)}">${esc((cyclesOf(prj).find(c => c.id === r.cycleId) || { name: 'Deleted cycle' }).name)}</span>` : ''}${r.source === 'ci' ? '<span class="chip ts-ci" data-source="ci">CI import</span>' : ''}
        <b>${esc(fmtTime(r.at))}</b><span class="hint">${av(r.by)} ${esc(pname(r.by))}</span>
        <span class="ts-cov ${partial ? 'partial' : 'full'}" data-run-cov>covers ${cov ? cov.covered : 0}/${cov ? cov.total : 0} ${scriptEnv(r.env) ? 'cases + scripts' : 'cases'}</span>
        <span class="ts-counts">${badge((c.pass || 0) + ' pass', 'b-done')}${c.fail ? badge(c.fail + ' fail', 'b-late') : ''}${c.blocked ? badge(c.blocked + ' blocked', 'b-soon') : ''}${c['not-run'] ? `<span data-run-skipped="${c['not-run']}">${badge(c['not-run'] + ' skipped', 'b-idle')}</span>` : ''}</span><span class="rl-chev" aria-hidden="true">${open ? '▾' : '▸'}</span></div>
        ${open ? `<div class="ts-run-b">${partial ? `<div class="ts-warn">${cov.total - cov.covered} of ${cov.total} not run in this ${esc(envTxt(r.env))} run.</div>` : ''}
          ${carried ? `<div class="hint" data-carried>${carried} earlier pass${carried === 1 ? '' : 'es'} carried forward from cycle ${esc((r.cycle || 2) - 1)}; ${(r.results || []).length - carried} retested in this cycle.</div>` : ''}
          ${r.source === 'ci' && r.ciSuite ? `<div class="hint">Imported from CI suite “${esc(r.ciSuite)}”${r.ciUnmatched ? ` · ${esc(r.ciUnmatched)} test${r.ciUnmatched === 1 ? '' : 's'} did not match a case or script` : ''}${r.ciSkipped ? ` · ${esc(r.ciSkipped)} skipped (recorded as not run)` : ''}.</div>` : ''}
          ${rows.map(x => resultRow(prj, r, x, caseIdx, scIdx, me)).join('') || '<div class="hint">Every recorded row passed.</div>'}
          ${passEv.length ? `<details class="ts-passev"><summary>${passEv.length} pass${passEv.length === 1 ? '' : 'es'} with evidence or notes</summary>${passEv.map(x => resultRow(prj, r, x, caseIdx, scIdx, me)).join('')}</details>` : ''}</div>` : ''}</div>`;
    }).join('') : '<div class="empty">No runs recorded yet.</div>'}</div>`;
}

function defectsCard(prj) {
  const all = store.list('workItem', w => w.projectId === prj.id && w.kind === 'defect');
  const st = all.map(w => ({ w, s: dState(w) }));
  const order = x => (x.s === 'closed' ? 10 : 0) + (+x.w.severity || 3);
  st.sort((a, b) => order(a) - order(b));
  const open = st.filter(x => x.s !== 'closed').length;
  const counts = DSTATES.map(k => [k, st.filter(x => x.s === k).length]).filter(x => x[1]);
  return `<div class="card" id="defects"><h3>Defects<span class="n">${open} open · ${all.length}</span></h3>
    <div class="hint" style="margin-bottom:6px">Lifecycle: new → triaged → in progress → fixed → <b>verified</b> (automatic when a retest of the failing item passes) → closed. Owner: the step owner, or the data owner for a data case.</div>
    ${counts.length ? `<div class="ts-dsum">${counts.map(([k, n]) => badge(`${n} ${dsTxt(k)}`, DS_CLS[k])).join(' ')}</div>` : ''}
    ${st.map(({ w, s: ds }) => { const nx = NEXT[ds]; const can = canWorkDefect(prj, w);
      return `<div class="ts-def ${ds === 'closed' ? 'closed' : ''}" data-defect-row="${esc(w.id)}" data-dstate="${esc(ds)}">
        <div class="ts-def-h">${badge(dsTxt(ds), DS_CLS[ds])}<b>${esc(w.title)}</b></div>
        <div class="ts-def-m">${w.severity ? `<span class="chip" data-sev="${esc(w.severity)}">Severity ${esc(SEVS[w.severity] || w.severity)}</span>` : ''}${w.priority ? `<span class="chip">Priority ${esc(w.priority)}</span>` : ''}${w.env ? `<span class="chip">${esc(envTxt(w.env))}</span>` : ''}<span class="hint">${av(w.owner)} ${esc(pname(w.owner))} · due ${esc(fmt(w.due))}</span></div>
        ${w.repro ? `<details class="ts-repro"><summary>Steps to reproduce</summary><div class="ts-pre">${esc(w.repro)}</div></details>` : ''}
        <div class="ts-script-a">${ds === 'closed' ? (w.fixNote ? `<span class="hint">${esc(w.fixNote)}</span>` : '') : can
          ? `${nx ? `<button class="btn sm" data-dnext="${esc(w.id)}" data-to="${esc(nx[0])}">${esc(nx[1])}</button>` : ds === 'verified' ? `<span class="hint" data-verified>Verified by a passing retest${w.verifiedByRun ? ` (${esc(fmt((store.get('testRun', w.verifiedByRun) || {}).at))})` : ''}.</span>` : `<span class="hint" data-await-retest>Fixed: awaiting a passing retest to verify.</span>`}<button class="btn sm" data-dedit="${esc(w.id)}">Edit</button><button class="btn sm ${ds === 'verified' ? 'primary' : ''}" data-close-defect="${esc(w.id)}">Close…</button>`
          : `<span class="hint" data-why>Only ${esc(pname(w.owner))} or the project owner can move this defect.</span>`}</div></div>`; }).join('') || '<div class="empty">No defects. A failing result offers to raise one.</div>'}</div>`;
}
async function editDefect(prj, wid) {
  const w = store.get('workItem', wid); if (!w) return;
  const p = modal({ title: 'Edit defect', body: `<div class="field"><label>Title</label><input name="title" value="${esc(w.title)}"></div>
      <div class="frow"><div class="field"><label>Severity</label><select name="severity">${[1, 2, 3, 4].map(n => `<option value="${n}" ${+w.severity === n ? 'selected' : ''}>${SEVS[n]}</option>`).join('')}</select></div>
        <div class="field"><label>Priority</label><select name="priority">${PRIOS.map(pr => `<option ${w.priority === pr ? 'selected' : ''}>${pr}</option>`).join('')}</select></div></div>
      <div class="frow"><div class="field"><label>Environment</label><select name="env">${envOpts(w.env || 'uat')}</select></div><div class="field"><label>Owner</label>${testerSel('owner', w.owner, 'Owner').replace('<option value="">Unassigned</option>', '')}</div></div>
      <div class="field"><label>Steps to reproduce</label><textarea name="repro">${esc(w.repro || '')}</textarea></div>`,
    actions: [{ id: 'save', label: 'Save defect', primary: true }] });
  guard(f => !String(f.title || '').trim() ? { msg: 'A defect needs a title.', field: 'title' } : null);
  const r = await p; if (r.action !== 'save') return;
  const f = r.form; const cur = store.get('workItem', wid) || w;
  await store.save('workItem', wid, Object.assign({}, cur, { title: f.title.trim(), severity: +f.severity, priority: f.priority, env: f.env, repro: (f.repro || '').trim(), owner: f.owner || cur.owner, updatedAt: new Date().toISOString() }), `Edited defect “${f.title.trim()}” (severity ${f.severity}, ${f.priority})`);
  if (f.owner && f.owner !== cur.owner) await store.notify([f.owner], `${pname(store.state.me)} assigned you a defect: ${f.title.trim()}`, 'workItem:' + wid);
  toast('Defect saved');
}

function resultLabel(x, caseIdx, scIdx) {
  if (x.scriptId) { const s = scIdx[x.scriptId]; return s ? `<b>${s.id && String(s.id).startsWith('scn-') || (s.steps || []).some(y => y.step) && !s.given ? 'Scenario' : 'UAT'} · ${esc(s.title)}</b>` : '<b>A deleted UAT script</b>'; }
  const tcse = caseIdx[x.caseId]; const de = tcse && store.get('dataElement', tcse.dataId);
  return tcse ? `<b>${esc(de ? de.name : '')} ${esc(caseLbl(tcse.id))} · ${esc(tcse.field)}</b> <code>${short(tcse.input)}</code> expected ${esc(tcse.expect)}` : 'A deleted test case';
}
function resultRow(prj, r, x, caseIdx, scIdx, me) {
  const tcse = x.caseId && caseIdx[x.caseId]; const de = tcse && store.get('dataElement', tcse.dataId);
  const logged = de && (de.discovered || []).some(d => d.fromRun === r.id && d.caseId === x.caseId);
  const key = `${esc(r.id)}|${esc(rid(x))}`;
  const dfx = x.defectId ? store.get('workItem', x.defectId) : null;
  const canClose = dfx && dfx.status !== 'done' && (me === dfx.owner || me === prj.owner);
  const ev = x.evidence ? (isUrl(x.evidence) ? `<a href="${esc(x.evidence.trim())}" target="_blank" rel="noopener noreferrer">${esc(x.evidence.trim())}</a>` : esc(x.evidence)) : '';
  return `<div class="ts-fail" data-result="${esc(rid(x))}">${badge(OUT_TXT(x.outcome), OUT_CLS[x.outcome])} <span>${resultLabel(x, caseIdx, scIdx)}${x.note ? ` — <i>${esc(x.note)}</i>` : ''}${(x.steps || []).filter(y => y.outcome && y.outcome !== 'pass').map(y => `<div class="ts-ev" data-step-out="${esc(y.n)}">Step ${esc(y.n)}: ${esc(y.outcome)}${y.note ? ' — ' + esc(y.note) : ''}</div>`).join('')}${ev ? `<div class="ts-ev">Evidence: ${ev}</div>` : ''}${needsEvidence(x, r) ? '<div class="ts-ev ts-noev" data-noev>No evidence: this pass does not count toward coverage.</div>' : ''}</span>
    <span class="ts-fail-a">${dfx ? `<a class="chip ts-defect ${dfx.status === 'done' ? 'closed' : ''}" href="${link('/project/' + prj.id + '?mode=work')}" data-link data-defect="${esc(dfx.id)}">Defect · ${esc(dsTxt(dState(dfx)))} · ${esc(pname(dfx.owner))}${dfx.status === 'done' ? '' : ' · due ' + esc(fmt(dfx.due))}</a>${canClose ? `<button class="btn sm" data-close-defect="${esc(dfx.id)}">Close defect</button>` : ''}`
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


/* ======================================================================================================
   R7 SIMPLE MODE (default): "Is testing finished?" in one sentence, one next-action button, and a 3-step guide:
   Check sample data -> Create tests -> Record results. Coverage matrix, cycles, JUnit, end-to-end tests,
   build testing and the defect lifecycle detail live under "Show advanced tools".
   ====================================================================================================== */
function eng(name, ...args) { const e = E(); if (!e || typeof e[name] !== 'function') return undefined; try { return e[name](...args); } catch (err) { return undefined; } }
const TONE = { green: 'ok', amber: 'warn', red: 'bad' };
function availOf(dataId) {
  const l = eng('availLabel', store.state.docs, dataId);
  if (l && l.label) return { label: l.label, tone: TONE[l.tone] || 'warn' };
  return { live: { label: 'Connected', tone: 'ok' }, example: { label: 'Sample only', tone: 'warn' }, pending: { label: 'Waiting for confirmation', tone: 'warn' } }[effAvail(dataId)] || { label: 'Not available yet', tone: 'bad' };
}
/* R8 ONE TRUTH: the testing numbers come from E().projectTruth (the same values the project header, home and the status
   report show). Local fallbacks only keep the page usable while the engine is loading. */
const pickv = (o, ...ks) => { for (const k of ks) { const v = String(k).split('.').reduce((a, x) => a == null ? a : a[x], o); if (v != null) return v; } return null; };
function truthOf(prj) { return eng('projectTruth', store.state.docs, prj.id, store.state.today) || null; }
/* Information this project changes (new in the Future, being fixed, or with changed rules). Only these need tests. */
function changedData(prj, tt) {
  const tc = testsCheck(prj.id);
  const ids = pickv(tt, 'dataIds', 'changedData') || (tc && tc.changedData);
  if (Array.isArray(ids)) return ids.map(x => store.get('dataElement', typeof x === 'string' ? x : (x && (x.id || x.dataId)))).filter(Boolean);
  const asisIds = new Set();
  (prj.processes || []).map(id => store.get('process', id)).filter(Boolean).forEach(p => flat(p.asis).forEach(s => { (s.data || []).forEach(d => asisIds.add(d)); (s.subs || []).forEach(sb => (sb.data || []).forEach(d => asisIds.add(d))); }));
  const fixing = new Set(store.list('workItem', w => w.projectId === prj.id && w.resolves).map(w => w.resolves));
  return projectData(prj).filter(d => !asisIds.has(d.id) || fixing.has(d.id) || d.avail === 'missing');
}
/* projectTruth.testing.stages: [{key: 'system' (Try it out) | 'uat' (Business sign-off), total, passed, failed, run, done}] */
function stageOf(tt, key) {
  const arr = tt && tt.stages; const st = Array.isArray(arr) ? arr.find(x => x && x.key === key) : arr && arr[key];
  return st && typeof st === 'object' ? { passed: +st.passed || 0, total: +st.total || 0, failed: (+st.failed || 0) + (+st.blocked || 0), done: !!st.done, runs: st.run ? 1 : 0 } : null;
}
/* "Try it out": any System testing (or Build testing) run counts; done when there is one and nothing in it failed. */
function localTryOut(prj, ids) {
  const by = {}; let runs = 0;
  runsFor(prj.id).filter(r => r.env === 'sit' || r.env === 'dev').slice().reverse().forEach(r => { runs++; (r.results || []).forEach(x => { const k = rid(x); if (k && x.outcome !== 'not-run' && x.outcome !== 'skipped') by[k] = x.outcome; }); });
  const vals = ids.map(id => by[id]).filter(Boolean);
  const failed = vals.filter(o => o === 'fail' || o === 'blocked').length;
  return { passed: vals.filter(o => o === 'pass').length, total: ids.length, failed, runs, done: runs > 0 && Object.keys(by).length > 0 && !Object.values(by).some(o => o === 'fail' || o === 'blocked') };
}
function localSignOff(prj, ids) {
  const by = latestBy(prj.id, 'uat');
  const passed = ids.filter(id => by[id] && by[id].outcome === 'pass').length;
  const failed = ids.filter(id => by[id] && (by[id].outcome === 'fail' || by[id].outcome === 'blocked')).length;
  return { passed, total: ids.length, failed, runs: runsFor(prj.id).filter(r => r.env === 'uat').length, done: ids.length > 0 && passed === ids.length };
}
function testingFacts(prj) {
  const tt0 = truthOf(prj);
  const tt = tt0 && (tt0.testing || tt0.tests || tt0.testingSummary) || null;
  const des = changedData(prj, tt);
  const caseIds = [].concat(...des.map(d => casesFor(d.id).map(c => c.id)));
  const scripts = scriptsFor(prj).list.concat(Array.isArray(prj.uatScenarios) ? prj.uatScenarios : []);
  const ids = caseIds.concat(scripts.map(x => x.id));
  const sum = summaryOf(prj, tt);
  const try1 = stageOf(tt, 'system') || localTryOut(prj, ids);
  const sign = stageOf(tt, 'uat') || localSignOff(prj, ids);
  const passed = pickv(tt, 'passed', 'pass'), total = pickv(tt, 'total');
  return { tt, des, caseIds, scripts, ids, sum, try1, sign, passed: passed != null ? +passed : sign.passed, total: total != null ? +total : ids.length };
}
function summaryOf(prj, tt) {
  if (tt && (tt.sentence || tt.label)) return { done: !!tt.done, sentence: tt.sentence || tt.label, nextAction: tt.nextAction || null };
  const s = eng('testingSummary', store.state.docs, prj.id);
  if (s && s.sentence) return s;
  const tc = testsCheck(prj.id);
  return { done: !!(tc && tc.pass), sentence: tc ? (tc.pass ? 'Yes: testing is finished.' : 'Not yet: ' + (tc.detail || 'some tests still need attention.')) : 'Not yet: no tests have been set up.', nextAction: null };
}
const TIP = { profile: 'Check sample data (profile): count lengths, blanks and characters in a sample file, never keeping the values.', rules: 'Rules to test (spec fields): what each column of the information must look like.', uat: 'Business sign-off test (UAT): the people who run the process confirm it works.', sit: 'Try it out (system testing, SIT): the systems tested together before the business signs off.' };
const gt = (word, k) => `<span class="ts-g" title="${esc(TIP[k])}">${esc(word)}</span>`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

/* "Check sample data", one plain line per column: "Tax ID: 40 values, 1 is too short". */
const ISSUE_TXT = { 'required-nulls': ['empty', 'empty'], 'length-mismatch': ['is the wrong length', 'are the wrong length'], 'non-digit': ['has letters or symbols', 'have letters or symbols'],
  duplicates: ['repeats another', 'repeat others'], 'pattern-mismatch': ['is in a different format', 'are in a different format'], 'type-mismatch': ['is the wrong kind of value', 'are the wrong kind of value'],
  'out-of-range': ['is outside the allowed range', 'are outside the allowed range'], 'value-not-in-list': ['is not one of the allowed values', 'are not allowed values'],
  'unexpected-specials': ['has unexpected characters', 'have unexpected characters'] };
function columnLines(de, prof) {
  let drift = [];
  try { drift = (E() && E().specDrift && (de.fields || []).length) ? E().specDrift(de, prof) || [] : []; } catch (err) { drift = []; }
  const rows = rowsOf(prof);
  return (prof.columns || []).map(c => {
    const filled = Math.max(0, (c.rows != null ? +c.rows : rows) - (+c.nulls || 0));
    const iss = drift.filter(d => norm(d.field) === norm(c.name) || (d.detail || '').toLowerCase().includes(String(c.name).toLowerCase() + '"'));
    const bits = [];
    iss.forEach(d => {
      const t = ISSUE_TXT[d.issue]; if (!t) return;
      const m = /(\d+) of \d+/.exec(d.detail || '');
      if (d.issue === 'required-nulls') { bits.push(`${m ? m[1] : 'some'} empty`); return; }
      const n = m ? +m[1] : null;
      bits.push(n != null ? `${n} ${n === 1 ? t[0] : t[1]}` : `some ${t[1]}`);
    });
    if (!iss.length && +c.nulls) bits.push(`${c.nulls} empty`);
    const ok = !iss.length && (de.fields || []).length;
    return `<li class="ts-col ${iss.length ? 'bad' : ''}" data-col-line="${esc(c.name)}"><b>${esc(c.name)}:</b> ${plural(filled, 'value')}${bits.length ? ', ' + esc([...new Set(bits)].join(', ')) : ok ? ', all look right' : ''}</li>`;
  }).join('');
}

function simpleRender(prj) {
  const prjId = prj.id;
  const projects = store.list('project');
  const f = testingFacts(prj);
  const des = f.des;
  const sum = f.sum;
  const withSample = des.filter(d => d.sampleCsv || latestProfile(d.id));
  const checked = des.filter(d => latestProfile(d.id));
  /* Done only when a sample was actually checked (and every sample that exists has been) */
  const step1Done = checked.length > 0 && withSample.every(d => latestProfile(d.id));
  const untested = des.filter(d => !casesFor(d.id).length || fieldCoverage(d).missing.length);
  const step2Done = des.length > 0 && !untested.length;
  const cur = des.length && !step2Done ? 2 : !f.try1.done ? 3 : !f.sign.done ? 4 : 0;
  const problems = store.list('workItem', w => w.projectId === prjId && w.kind === 'defect' && w.status !== 'done');
  const fold = (rows, label, key) => rows.length ? `<details class="ts-fold" ${ui.fold && ui.fold[key] ? 'open' : ''} data-fold="${key}"><summary>${label}</summary><ul class="ts-srs">${rows.join('')}</ul></details>` : '';
  const row1 = d => { const p = latestProfile(d.id); const nr = !(d.fields || []).length;
    return `<li class="ts-sr" data-s1="${esc(d.id)}"><div class="ts-sr-t"><b>${esc(d.name)}</b>
        <small>${p ? `Sample checked ${esc(fmt(p.at))}: ${esc(plural(rowsOf(p), 'row'))}. No values were kept.` : d.sampleCsv ? 'A sample file is ready to check.' : 'No sample file yet (optional).'}</small>
        ${p ? `<ul class="ts-cols" data-col-lines>${columnLines(d, p)}</ul>` : ''}</div>
      <div class="ts-sr-a">${p ? (nr ? `<button class="btn" data-use-cols="${esc(d.id)}">Use these columns as the rules to test</button>` : '<span class="ts-okt">✓ Checked</span>')
        : d.sampleCsv ? `<button class="btn" data-s-prof="${esc(d.id)}" ${ui.busy ? 'disabled' : ''}>Check sample data</button>` : `<label class="btn ts-file">Upload a sample file<input type="file" accept=".csv,text/csv" data-s-file="${esc(d.id)}" hidden></label>`}</div></li>`; };
  const row2 = d => { const n = casesFor(d.id).length;
    return `<li class="ts-sr" data-s2="${esc(d.id)}"><div class="ts-sr-t"><b>${esc(d.name)}</b><small>${n ? plural(n, 'test') : 'No tests yet'}</small></div><div class="ts-sr-a">${n && !fieldCoverage(d).missing.length ? '<span class="ts-okt">✓ Ready</span>' : ''}</div></li>`; };
  const stepCard = (n, title, done, body, isCur, extra) => `<li class="ts-step ${done ? 'done' : ''} ${isCur ? 'cur' : ''}" data-guide-step="${n}" ${extra || ''}><div class="ts-step-h"><span class="ts-num">${done ? '✓' : n}</span><b>${title}</b>${done ? '<span class="ts-okt">Done</span>' : ''}</div>${body}</li>`;
  const stageLine = (st, what) => st.runs ? `${st.passed} of ${st.total} passed${st.failed ? ` · ${st.failed} need fixing` : ''}` : `Not tried yet · ${plural(st.total, what)}`;
  const big = `<div class="ts-big" data-tests-number="${f.passed}/${f.total}"><b>${f.passed} of ${f.total}</b><span>tests passed</span></div>`;
  return `<section class="hdr rs-hdr"><div><div class="crumbs"><a href="${link('/')}" data-link>Home</a> · <a href="${link('/project/' + prjId)}" data-link>${esc(prj.name)}</a> · Testing</div>
      <div class="rl-title"><h1>Testing</h1>${projects.length > 1 ? `<select class="rl-switch" data-switch aria-label="Project">${projects.map(p => `<option value="${esc(p.id)}" ${p.id === prjId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}</div></div></section>
    <div class="rs-wrap" data-simple-testing>
      <div class="rs-status ${sum.done ? 'ready' : 'notready'} ts-sum" data-testing-summary="${sum.done ? 'done' : 'open'}" role="status"><span class="rs-status-ic" aria-hidden="true">${sum.done ? '✓' : '!'}</span>
        <div><span class="ts-q">Is testing finished?</span><b data-testing-sentence>${esc(sum.sentence)}</b></div>${big}</div>
      ${!des.length && !f.total ? `<div class="card rs-card" data-no-changes><h3>Nothing here needs testing</h3><p class="rs-p">This project doesn’t change any information, so there is nothing to test yet. Tests are only needed for information that is new, being fixed, or has new rules.</p></div>` : ''}
      ${des.length || f.total ? `<ol class="ts-guide" data-guide>
        ${!des.length ? '' : stepCard(1, `${gt('Check sample data', 'profile')} <small class="ts-opt">optional</small>`, step1Done, `<p class="ts-help">See what real information looks like (lengths, blanks, characters) without keeping any of the values.</p>
          ${withSample.length ? `<ul class="ts-srs">${withSample.map(row1).join('')}</ul>${fold(des.filter(d => !withSample.includes(d)).map(row1), `Information without a sample (${des.length - withSample.length})`, 's1')}` : fold(des.map(row1), `See each piece of information (${des.length})`, 's1')}`, false)}
        ${!des.length ? '' : stepCard(2, 'Create the tests', step2Done, `<p class="ts-help">${plural(des.length, 'piece', 'pieces')} of information ${des.length === 1 ? 'changes' : 'change'} in this project, so ${des.length === 1 ? 'it needs' : 'they need'} tests. One press makes them all from the ${gt('rules to test', 'rules')} and any sample data.</p>
          <div class="ts-step-a"><button class="btn ${cur === 2 ? 'primary' : ''} rs-big" data-s-create ${ui.creating ? 'disabled' : ''}>${ui.creating ? 'Creating the tests…' : 'Create the tests'}</button><span class="hint" data-s2-count>${step2Done ? `${plural(f.caseIds.length, 'test')} ready` : `${plural(des.length - untested.length, 'of ' + des.length + ' has tests', 'of ' + des.length + ' have tests')}`}</span></div>
          ${fold(des.map(row2), `See each piece of information (${des.length})`, 's2')}`, cur === 2)}
        ${stepCard(des.length ? 3 : 1, `${gt('Try it out', 'sit')} <small class="ts-opt">system test</small>`, f.try1.done, `<p class="ts-help">Run the tests in the test system and mark each one passed or failed. Any system test run counts.</p>
          <div class="ts-step-a"><button class="btn ${cur === 3 ? 'primary' : ''}" data-s-record="sit">Record what happened</button><span class="hint" data-stage="try" data-stage-done="${f.try1.done ? 1 : 0}">${stageLine(f.try1, 'test')}</span></div>`, cur === 3)}
        ${stepCard(des.length ? 4 : 2, gt('Business sign-off test', 'uat'), f.sign.done, `<p class="ts-help">The people who run the process try each test and mark it passed or failed. Failed tests become problems for the owner to fix.</p>
          <div class="ts-step-a"><button class="btn ${cur === 4 ? 'primary' : ''}" data-s-record="uat">Record what happened</button><span class="hint" data-stage="signoff" data-stage-done="${f.sign.done ? 1 : 0}" data-s-progress>${stageLine(f.sign, 'test')}</span></div>`, cur === 4)}
      </ol>` : ''}
      <div class="card rs-card" id="problems" data-problems><h3>Problems found<span class="n">${problems.length} open</span></h3>
        ${problems.map(w => `<div class="ts-prob" data-problem="${esc(w.id)}"><b>${esc(w.title)}</b><span class="hint">${av(w.owner)} ${esc(pname(w.owner))} fixes it · due ${esc(fmt(w.due))}</span></div>`).join('') || '<div class="hint">No open problems.</div>'}</div>
      <div class="rs-adv"><button class="btn rs-link" data-show-adv>Show advanced tools</button></div>
    </div>`;
}

/* R8: ONE press creates the tests for EVERY piece of information the project changes. Nothing is skipped:
   information without rules uses its sample (checked first when there is a sample file), and anything with neither
   still gets one plain "typical value" test, so the button never does nothing. */
async function createAllTests(prj) {
  if (ui.creating) return;
  ui.creating = true; store.emit();
  let made = 0, covered = 0, noted = [];
  try {
    const des = testingFacts(prj).des;
    for (const d0 of des) {
      let d = store.get('dataElement', d0.id) || d0;
      if (!(d.fields || []).length && !latestProfile(d.id) && d.sampleCsv) {
        try { await store.api('/profile/' + d.id, { csv: d.sampleCsv }); await store.load(); } catch (e) { /* fall through: generic test below */ }
      }
      d = store.get('dataElement', d.id) || d;
      if (!(d.fields || []).length && latestProfile(d.id)) {
        const fields = eng('specFromProfile', latestProfile(d.id));
        if (Array.isArray(fields) && fields.length) { await store.save('dataElement', d.id, Object.assign({}, d, { fields }), `Used the ${fields.length} sample-data columns of ${d.name} as its rules to test`); d = store.get('dataElement', d.id) || d; }
      }
      let n = 0;
      if ((d.fields || []).length || latestProfile(d.id)) n = await generateFor(d, true);
      if (!casesFor(d.id).length) {
        const id = store.newId('tc');
        await store.save('testCase', id, { id, dataId: d.id, field: d.name, kind: 'valid', input: `A typical ${d.name}`, expect: 'accept', origin: 'user', note: 'Enter a realistic made-up value and check it is saved and shown correctly.', tester: d.owner || undefined, createdAt: new Date().toISOString() }, `Created a basic test for ${d.name}`);
        n++; noted.push(d.name);
      }
      made += n; if (casesFor(d.id).length) covered++;
    }
    toast(made ? `Created ${plural(made, 'test')}. All ${plural(covered, 'piece', 'pieces')} of information now have tests.` : `All ${plural(covered, 'piece', 'pieces')} of information already have their tests.`);
  } finally { ui.creating = false; store.emit(); }
}
async function useColumns(dataId) {
  const de = store.get('dataElement', dataId); const prof = latestProfile(dataId);
  if (!de || !prof) { toast('Check sample data first.'); return; }
  const fields = eng('specFromProfile', prof);
  if (!Array.isArray(fields) || !fields.length) { toast('The sample data has no columns to use.'); return; }
  await store.save('dataElement', dataId, Object.assign({}, de, { fields }), `Used the ${fields.length} sample-data columns of ${de.name} as its rules to test`);
  toast(`${fields.length} rules to test added to ${de.name}. Next: create the tests.`);
}
function bindSimple(root, prj) {
  const adv = root.querySelector('[data-show-adv]'); if (adv) adv.onclick = () => { store.setAdvanced(true); toast('Advanced tools shown'); };
  root.querySelectorAll('details[data-fold]').forEach(d => d.addEventListener('toggle', () => { ui.fold = ui.fold || {}; ui.fold[d.dataset.fold] = d.open; }));
  const prof = async (d, csv, label) => {
    if (!csv || !csv.trim()) { toast('That file is empty.'); return; }
    ui.busy = true; store.emit();
    try { const p = await store.api('/profile/' + d.id, { csv }); await store.load(); toast(`Checked ${label}: ${p && p.rows != null ? p.rows + ' rows' : 'done'}. No values were kept.`); }
    catch (e) { toast('Could not check the sample: ' + e.message); } finally { ui.busy = false; store.emit(); }
  };
  root.querySelectorAll('[data-s-prof]').forEach(b => b.onclick = () => { const d = store.get('dataElement', b.dataset.sProf); if (d) prof(d, d.sampleCsv, 'the sample data of ' + d.name); });
  root.querySelectorAll('[data-s-file]').forEach(f => f.onchange = () => { const d = store.get('dataElement', f.dataset.sFile); const file = f.files[0]; if (!d || !file) return; if (file.size > 2 * 1024 * 1024) { toast('That file is over 2 MB.'); return; } const rd = new FileReader(); rd.onload = () => prof(d, String(rd.result), file.name); rd.readAsText(file); });
  root.querySelectorAll('[data-use-cols]').forEach(b => b.onclick = () => useColumns(b.dataset.useCols));
  const ca = root.querySelector('[data-s-create]'); if (ca) ca.onclick = () => createAllTests(prj);
  root.querySelectorAll('[data-s-record]').forEach(b => b.onclick = () => recordRun(prj, { simple: true, env: b.dataset.sRecord }));
}

/* ---------- bind ---------- */
export function bind(root, params) {
  const prjId = params.prj;
  const sw = root.querySelector('[data-switch]'); if (sw) sw.onchange = () => go('/testing/' + sw.value);
  const prj = store.get('project', prjId); if (!prj) return;
  if (!store.advanced) { bindSimple(root, prj); return; }
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
  if (gen) gen.onclick = () => generateFor(de);
  const add = root.querySelector('[data-add-case]'); if (add) add.onclick = () => editCase(de, null);
  root.querySelectorAll('[data-origin]').forEach(b => b.onclick = () => { ui.origin = b.dataset.origin; store.emit(); });
  const ba = root.querySelector('[data-bulk-assign]'); if (ba) ba.onclick = () => bulkAssign(de, root.querySelector('select[name=bulkTester]').value);
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
  root.querySelectorAll('[data-gen-de]').forEach(b => b.onclick = () => { const d = store.get('dataElement', b.dataset.genDe); if (d) generateFor(d); });
  root.querySelectorAll('[data-run-toggle]').forEach(h => { const t = () => { const id = h.dataset.runToggle; ui.runOpen.has(id) ? ui.runOpen.delete(id) : ui.runOpen.add(id); store.emit(); }; h.onclick = t; h.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t(); } }; });
  root.querySelectorAll('[data-retest]').forEach(b => b.onclick = () => recordRun(prj, { retestEnv: b.dataset.retest }));
  const ac = root.querySelector('[data-add-cycle]'); if (ac) ac.onclick = () => editCycle(prj, null);
  root.querySelectorAll('[data-edit-cycle]').forEach(b => b.onclick = () => editCycle(prj, b.dataset.editCycle));
  root.querySelectorAll('[data-del-cycle]').forEach(b => b.onclick = () => deleteCycle(prj, b.dataset.delCycle));
  root.querySelectorAll('[data-cycle-run]').forEach(b => b.onclick = () => recordRun(prj, { cycleId: b.dataset.cycleRun }));
  root.querySelectorAll('[data-script-tester]').forEach(sel => { sel.onclick = e => e.stopPropagation(); sel.onchange = () => assignScript(prj, sel.dataset.scriptTester, sel.value); });
  const ci = root.querySelector('[data-ci]'); if (ci) ci.onclick = () => importCi(prj);
  root.querySelectorAll('[data-discover]').forEach(b => b.onclick = e => { e.stopPropagation(); const [runId, caseId] = b.dataset.discover.split('|'); logDiscovered(runId, caseId); });
  root.querySelectorAll('[data-mk-defect]').forEach(b => b.onclick = async e => { e.stopPropagation(); const [runId, id] = b.dataset.mkDefect.split('|'); await createDefects(prj, runId, [id]); });
  root.querySelectorAll('[data-close-defect]').forEach(b => b.onclick = e => { e.stopPropagation(); closeDefect(prj, b.dataset.closeDefect); });
  root.querySelectorAll('[data-dnext]').forEach(b => b.onclick = async () => { const w = store.get('workItem', b.dataset.dnext); if (!w) return; if (!canWorkDefect(prj, w)) { toast(`Only ${pname(w.owner)} or the project owner can move this defect.`); return; } await setDefectState(prj, w, b.dataset.to); toast(`Defect ${dsTxt(b.dataset.to)}`); });
  root.querySelectorAll('[data-dedit]').forEach(b => b.onclick = () => editDefect(prj, b.dataset.dedit));
  const ad = root.querySelector('[data-adopt]'); if (ad) ad.onclick = () => adoptScripts(prj, false);
  const ag = root.querySelector('[data-add-gen]'); if (ag) ag.onclick = () => adoptScripts(prj, true);
  root.querySelectorAll('details[data-script]').forEach(d => d.addEventListener('toggle', () => { d.open ? ui.scriptOpen.add(d.dataset.script) : ui.scriptOpen.delete(d.dataset.script); }));
  root.querySelectorAll('[data-edit-script]').forEach(b => b.onclick = () => editScript(prj, b.dataset.editScript));
  root.querySelectorAll('[data-del-script]').forEach(b => b.onclick = () => deleteScript(prj, b.dataset.delScript));
  const as = root.querySelector('[data-adopt-scn]'); if (as) as.onclick = () => adoptScenarios(prj, false);
  const an = root.querySelector('[data-add-scn]'); if (an) an.onclick = () => adoptScenarios(prj, true);
  root.querySelectorAll('details[data-scenario]').forEach(d => d.addEventListener('toggle', () => { d.open ? ui.scriptOpen.add(d.dataset.scenario) : ui.scriptOpen.delete(d.dataset.scenario); }));
  root.querySelectorAll('[data-edit-scn]').forEach(b => b.onclick = () => editScenario(prj, b.dataset.editScn));
  root.querySelectorAll('[data-del-scn]').forEach(b => b.onclick = () => deleteScenario(prj, b.dataset.delScn));
  root.querySelectorAll('[data-scn-tester]').forEach(sel => { sel.onclick = e => e.stopPropagation(); sel.onchange = () => assignScenario(prj, sel.dataset.scnTester, sel.value); });
  root.querySelectorAll('[data-anchor-scn]').forEach(a => a.onclick = e => { e.preventDefault(); const t = root.querySelector('#scenarios'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const hb = root.querySelector('[data-ts-history]');
  if (hb) (async () => {
    /* this project only: its runs, cases and profiles of its data, its defects, and its script/cycle edits */
    const dataIds = new Set(projectData(prj).map(d => d.id));
    const mine = ref => { const m = /^(\w+):(.+)$/.exec(ref || ''); if (!m) return false; const [, t, id] = m;
      if (t === 'testRun') { const r = store.get('testRun', id); return r ? r.projectId === prj.id : false; }
      if (t === 'testCase') { const c = store.get('testCase', id); return c ? dataIds.has(c.dataId) : false; }
      if (t === 'profile') { const pf = store.get('profile', id); return pf ? dataIds.has(pf.dataId) : false; }
      if (t === 'workItem') { const w = store.get('workItem', id); return !!w && w.projectId === prj.id && w.kind === 'defect'; }
      if (t === 'dataElement') return dataIds.has(id);
      if (t === 'project') return id === prj.id;
      return false; };
    const raw = (await store.events(null, 300)).filter(e => mine(e.ref) && (/^(testRun|testCase|profile):/.test(e.ref) || /^Profiled |UAT script|scenario|test cycle|defect|discovered requirement/i.test(e.summary || '')));
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

/* R6: one press generates every case at once. All new cases go into the store together and the page re-renders
   immediately (the count is never stale), then they are persisted and the page re-renders again after the last save.
   Default tester: the data owner. */
async function generateFor(de, quiet) {
  const e = E(); if (!e || !e.generateTests) { toast('Test generator unavailable.'); return 0; }
  const noRules = !(de.fields || []).length;
  if (noRules && !latestProfile(de.id)) { if (!quiet) toast('Add rules first (or use your sample data)'); return 0; }
  ui.genBusy = ui.genBusy || {}; if (ui.genBusy[de.id]) { toast('Still saving the cases just generated.'); return 0; } ui.genBusy[de.id] = true;
  try {
    let made = [];
    try { made = e.generateTests(de, latestProfile(de.id) || undefined) || []; } catch (err) { toast('Could not generate: ' + err.message); return 0; }
    const key = c => [c.field, String(c.input), c.kind].join('\u0001');
    const have = new Set(casesFor(de.id).map(key));
    const t0 = Date.now(); const docs = [];
    made.forEach(c => { if (have.has(key(c))) return; have.add(key(c)); const id = store.newId('tc');
      docs.push(Object.assign({ note: '' }, c, { id, dataId: de.id, tester: c.tester || de.owner || undefined, createdAt: new Date(t0 + docs.length).toISOString() })); });
    if (!docs.length) { if (!quiet) toast(noRules ? 'Add rules first (or use your sample data)' : 'No new test cases — all already exist'); return 0; }
    const arr = store.state.docs.testCase || (store.state.docs.testCase = []);
    docs.forEach(d => arr.push({ id: d.id, data: d }));
    store.emit();
    if (!quiet) toast(`Generated ${docs.length} test case${docs.length === 1 ? '' : 's'} for ${de.name}`);
    for (let i = 0; i < docs.length; i += 6) await Promise.all(docs.slice(i, i + 6).map(d => store.save('testCase', d.id, d, `Generated ${d.kind} test for ${de.name}.${d.field}`)));
    store.emit();
    return docs.length;
  } finally { ui.genBusy[de.id] = false; store.emit(); }
}

async function editCase(de, c) {
  const fields = (de.fields || []).map(x => x.name);
  const p = modal({
    title: c ? 'Edit test case' : 'Add custom test case',
    body: `<div class="frow"><div class="field"><label>Field</label><input name="field" list="ts-fields" value="${esc(c ? c.field : fields[0] || '')}" placeholder="${fields.length ? 'Pick or type a field' : 'Field name, e.g. Vendor email'}" autocomplete="off">
        <datalist id="ts-fields">${fields.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist></div>
      <div class="field"><label>Kind</label><select name="kind">${['custom', 'valid', 'boundary', 'invalid', 'edge'].map(k => `<option ${(c ? c.kind : 'custom') === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div></div>
      ${fields.length ? '' : `<div class="hint" data-nospec>${esc(de.name)} has no spec yet, so type the field name. Write the spec on the data page to generate cases automatically.</div>`}
      <div class="field"><label>Input</label><input name="input" value="${esc(c ? c.input : '')}" placeholder="Value to test (fictional)"></div>
      <div class="frow"><div class="field"><label>Expect</label><select name="expect"><option value="accept" ${c && c.expect === 'accept' ? 'selected' : ''}>Accept</option><option value="reject" ${c && c.expect === 'reject' ? 'selected' : ''}>Reject</option></select></div>
        <div class="field"><label>Tester</label>${testerSel('tester', c ? c.tester : '')}</div></div>
      <div class="field"><label>Note</label><input name="note" value="${esc(c ? c.note || '' : '')}"></div>
      <div class="hint">Use made-up values only. Never paste real customer data into a test case.</div>`,
    actions: [{ id: 'save', label: c ? 'Save' : 'Add case', primary: true }],
  });
  guard(f => !String(f.field || '').trim() ? { msg: 'Name the field this case tests.', field: 'field' } : null);
  const r = await p;
  if (r.action !== 'save') return;
  const id = c ? c.id : store.newId('tc');
  const data = Object.assign({}, c || { origin: 'user', createdAt: new Date().toISOString() }, { id, dataId: de.id, field: r.form.field.trim(), kind: r.form.kind, input: r.form.input, expect: r.form.expect, note: r.form.note, tester: r.form.tester || undefined });
  await store.save('testCase', id, data, `${c ? 'Edited' : 'Added custom'} test for ${de.name}.${data.field}${data.tester && (!c || c.tester !== data.tester) ? `; tester ${pname(data.tester)}` : ''}`);
  toast(c ? 'Test case saved' : 'Custom case added');
}

/* ---------- testers and cycles ---------- */
async function bulkAssign(de, tester) {
  if (!tester) { toast('Pick a tester first.'); return; }
  const list = casesFor(de.id).filter(c => !c.tester);
  for (const c of list) await store.save('testCase', c.id, Object.assign({}, c, { tester }), `Assigned ${de.name}.${c.field} ${c.kind} test to ${pname(tester)}`);
  toast(`${list.length} case${list.length === 1 ? '' : 's'} assigned to ${pname(tester)}`);
}
async function assignScript(prj, sid, tester) {
  const cur = store.get('project', prj.id) || prj;
  const s = (cur.uatScripts || []).find(x => x.id === sid); if (!s) return;
  const next = cur.uatScripts.map(x => x.id === sid ? Object.assign({}, x, { tester: tester || undefined }) : x);
  await store.save('project', prj.id, Object.assign({}, cur, { uatScripts: next }), tester ? `Assigned UAT script “${s.title}” to ${pname(tester)}` : `Unassigned UAT script “${s.title}”`);
  toast(tester ? `Script assigned to ${pname(tester)}` : 'Script unassigned');
}
async function editCycle(prj, cid) {
  const cur = store.get('project', prj.id) || prj;
  const c = cyclesOf(cur).find(x => x.id === cid) || null;
  const today = store.state.today;
  const p = modal({
    title: c ? 'Edit test cycle' : 'Plan a test cycle',
    body: `<div class="field"><label>Name</label><input name="name" value="${esc(c ? c.name : '')}" placeholder="e.g. UAT cycle 1: vendor onboarding"></div>
      <div class="frow"><div class="field"><label>Environment</label><select name="env">${envOpts(c ? c.env : 'uat')}</select></div><div></div></div>
      <div class="frow"><div class="field"><label>Start</label><input type="date" name="start" value="${esc(c ? c.start : today)}"></div><div class="field"><label>End</label><input type="date" name="end" value="${esc(c ? c.end : addDays(today, 7))}"></div></div>
      <div class="field"><label>Testers</label><div class="ts-dpick">${store.state.people.map(p => `<label><input type="checkbox" name="testers" value="${esc(p.id)}" ${c && (c.testers || []).includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div></div>
      <div class="hint">Only the testers named here can record results in this cycle. Each tester's progress counts the results they recorded.</div>`,
    actions: [{ id: 'save', label: c ? 'Save cycle' : 'Plan cycle', primary: true }],
  });
  guard(f => {
    if (!String(f.name || '').trim()) return { msg: 'Name the cycle.', field: 'name' };
    if (!f.start || !f.end) return { msg: 'Set a start and an end date.', field: f.start ? 'end' : 'start' };
    if (f.end < f.start) return { msg: 'The end date is before the start date.', field: 'end' };
    if (!(f.testers || []).length) return 'Name at least one tester.';
    return null;
  });
  const r = await p;
  if (r.action !== 'save') return;
  const f = r.form;
  const next = { id: c ? c.id : store.newId('cyc'), name: f.name.trim(), env: ENVS.includes(f.env) ? f.env : 'uat', start: f.start, end: f.end, testers: f.testers || [] };
  const latest = store.get('project', prj.id) || cur;
  const list = cyclesOf(latest).filter(x => x.id !== next.id).concat([next]);
  await store.save('project', prj.id, Object.assign({}, latest, { testCycles: list }), `${c ? 'Edited' : 'Planned'} test cycle “${next.name}” (${envTxt(next.env)}, ${fmt(next.start)}–${fmt(next.end)}, ${next.testers.map(pname).join(', ')})`);
  await store.notify(next.testers, `${pname(store.state.me)} named you as a tester in “${next.name}” for ${prj.name}`, 'project:' + prj.id);
  toast(c ? 'Cycle saved' : 'Cycle planned');
}
async function deleteCycle(prj, cid) {
  const cur = store.get('project', prj.id) || prj;
  const c = cyclesOf(cur).find(x => x.id === cid); if (!c) return;
  const r = await modal({ title: 'Delete test cycle?', body: `<p style="margin:0">${esc(c.name)}. Runs recorded in it are kept.</p>`, actions: [{ id: 'del', label: 'Delete', danger: true }] });
  if (r.action !== 'del') return;
  await store.save('project', prj.id, Object.assign({}, cur, { testCycles: cyclesOf(cur).filter(x => x.id !== cid) }), `Deleted test cycle “${c.name}”`);
  toast('Cycle deleted');
}


/* ---------- runs: every row starts as Not run; a fail needs a note; scripts are recorded step by step ---------- */
async function recordRun(prj, opts) {
  opts = opts || {};
  const des = projectData(prj);
  const prev = opts.retestEnv ? runsFor(prj.id).find(r => r.env === opts.retestEnv) || null : null;
  const only = prev ? new Set(retestIds(prj.id, prev.env)) : null;
  const cycles = cyclesOf(prj);
  const cyc0 = opts.cycleId || (prev && prev.cycleId) || '';
  const me = store.state.me;
  const c0 = cycles.find(c => c.id === cyc0);
  if (c0 && !(c0.testers || []).includes(me)) { toast(`Only this cycle's testers (${(c0.testers || []).map(pname).join(', ')}) can record results in it.`); return; }
  /* R8 Simple: only information the project changes needs tests, so only those are listed */
  const desRun = opts.simple ? testingFacts(prj).des : des;
  const cases = []; desRun.forEach(d => casesFor(d.id).forEach(c => { if (!only || only.has(c.id)) cases.push({ c, d }); }));
  const scnIds = new Set((prj.uatScenarios || []).map(x => x.id));
  const scripts = uatItems(prj).filter(s => !only || only.has(s.id));
  if (!cases.length && !scripts.length) { toast(only ? 'Nothing to retest.' : opts.simple ? 'Create the tests first.' : 'Generate test cases or UAT scripts first.'); return; }
  const env0 = prev ? prev.env : (opts.env || (c0 || {}).env || 'dev');
  const sel = (name, label) => `<select name="${name}" aria-label="${esc(label)}"><option value="">Not run</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="blocked">Blocked</option></select>`;
  const pick = (k, label) => `<label class="ts-pick"><input type="checkbox" data-pick="${esc(k)}" aria-label="Select ${esc(label)}"></label>`;
  /* Simple: no test ids and no "expect accept/reject": the value to try and what should happen, in words */
  const caseRow = ({ c, d }) => { const k = 'c:' + c.id; const nm = opts.simple ? `${d.name}${tok(c.field) !== tok(d.name) ? ' · ' + c.field : ''}` : `${d.name} ${caseLbl(c.id)} · ${c.field}`;
    const exp = opts.simple ? (c.expect === 'reject' ? 'should be rejected' : 'should be accepted') : 'expect ' + c.expect;
    return `<div class="ts-case" data-row="${esc(k)}"><div class="ts-case-t">${pick(k, nm)}<b>${esc(nm)}</b> <code>${c.input === '' ? '(empty)' : short(c.input)}</code> <small data-should="${esc(c.expect)}">${esc(exp)}${c.tester ? ' · tester ' + esc(pname(c.tester)) : ''}</small></div>
    <div class="ts-case-i">${sel('o_' + esc(k), 'Outcome')}<input name="n_${esc(k)}" placeholder="Note (required on fail)" aria-label="Note"><input name="e_${esc(k)}" placeholder="Evidence: link or text" aria-label="Evidence"></div></div>`; };
  const scriptRow = s => { const k = 's:' + s.id; const scn = scnIds.has(s.id); return `<div class="ts-case ts-srun" data-row="${esc(k)}" data-script-row ${scn ? 'data-scn-row' : ''}><div class="ts-case-t">${pick(k, s.title)}<b>${esc(s.title)}</b> <span class="chip">${scn ? 'End-to-end' : 'Steps'}</span>${s.tester ? ` <small>tester ${esc(pname(s.tester))}</small>` : ''}${s.given ? `<div class="ts-gwt-i"><span>Given</span> ${esc(opts.simple ? plainEnv(s.given) : s.given)}</div>` : ''}</div>
    <ol class="ts-sst">${scriptSteps(s).map(x => `<li data-step-row="${x.n}"><div class="ts-sst-t">${esc(opts.simple ? plainEnv(x.action) : x.action)}<small>Expected: ${esc(opts.simple ? plainEnv(x.expected) : x.expected)}</small></div><div class="ts-sst-i">${sel(`so_${esc(k)}_${x.n}`, 'Step ' + x.n + ' outcome')}<input name="sn_${esc(k)}_${x.n}" placeholder="Step note" aria-label="Step ${x.n} note"></div></li>`).join('')}</ol>
    <div class="ts-case-i ts-case-i2"><input name="n_${esc(k)}" placeholder="Note (required on fail if no step note)" aria-label="Script note"><input name="e_${esc(k)}" placeholder="Evidence (required to pass): link or text" aria-label="Evidence"></div></div>`; };
  const p = modal({
    title: prev ? `Retest failures · ${envTxt(prev.env)} retest ${(prev.cycle || 1) + 1}` : opts.simple ? 'Record what happened' : 'Record test run',
    body: `<div class="frow"><div class="field"><label>${opts.simple ? 'Which test' : 'Environment'}</label><select name="env" data-env ${prev ? 'disabled' : ''}>${opts.simple ? ['sit', 'uat'].map(e => `<option value="${e}" ${e === env0 ? 'selected' : ''}>${STAGE_TXT[e]}</option>`).join('') : envOpts(env0)}</select></div>
      <div class="field" ${opts.simple ? 'hidden style="display:none"' : ''}><label>Test cycle</label><select name="cycleId" data-cycle-sel><option value="">No planned cycle</option>${cycles.map(c => `<option value="${esc(c.id)}" data-cenv="${esc(c.env)}" ${c.id === cyc0 ? 'selected' : ''}>${esc(c.name)} · ${esc(envTxt(c.env))}</option>`).join('')}</select></div></div>
      <div class="ts-bulk" data-bulk><label class="ts-pick"><input type="checkbox" data-pick-all aria-label="Select every row"> All</label>
        <input data-bulk-ev placeholder="Evidence note for the selected rows" aria-label="Evidence note for the selected rows"><button type="button" class="btn sm primary" data-bulk-pass>Mark selected as passed</button><button type="button" class="btn sm" data-reset>Reset to not run</button>
        <span class="ts-bulk-hint" data-bulk-hint role="status" aria-live="polite" hidden></span></div>
      <div class="hint">${opts.simple ? 'Tick the tests that worked, write what you saw, then press “Mark selected as passed”. A business test needs a note on what you saw to count as passed.' : '“Mark selected as passed” sets every step of each selected row to Pass and records the one evidence note on each. Script and scenario passes need evidence.'}</div>
      ${prev ? `<div class="hint">Only the ${only.size} item${only.size === 1 ? '' : 's'} whose latest ${esc(envTxt(prev.env))} result failed or was blocked. Earlier passes still count toward coverage.</div>` : ''}
      <div class="ts-cov-live hint" data-cov-live></div><div class="ts-err" data-err hidden></div>
      <div class="ts-cases">
        ${cases.length ? `<div class="ts-grp">Information tests · ${cases.length}</div>${cases.map(caseRow).join('')}` : ''}
        <div data-scripts-block ${scriptEnv(env0) ? '' : 'hidden'}>${scripts.length ? `<div class="ts-grp">Business tests · ${scripts.length} · every step must pass; a pass needs evidence</div>${scripts.map(scriptRow).join('')}` : ''}</div>
      </div>`,
    actions: [{ id: 'save', label: 'Save run', primary: true }],
  });
  const ovs = document.querySelectorAll('.overlay'); const ov = ovs[ovs.length - 1];
  const val = (root, n) => { const el = root.querySelector(`[name="${CSS.escape(n)}"]`); return el ? el.value.trim() : ''; };
  const envOf = () => prev ? prev.env : ov.querySelector('[data-env]').value;
  const titleOf = row => row.querySelector('.ts-case-t b').textContent;
  /* validation: a fail needs a note; a script/scenario is recorded step by step and its pass needs evidence; cycles are tester-only */
  const problems = () => {
    const out = [];
    const cs = ov.querySelector('[data-cycle-sel]'); const cy = cs && cycles.find(c => c.id === cs.value);
    if (cy && cy.env !== envOf()) out.push(`“${cy.name}” is a ${envTxt(cy.env)} cycle. Pick a ${envTxt(envOf())} cycle or switch the environment.`);
    if (cy && !(cy.testers || []).includes(me)) out.push(`Only the testers in “${cy.name}” (${(cy.testers || []).map(pname).join(', ')}) can record results in it.`);
    ov.querySelectorAll('.ts-case').forEach(row => {
      if (row.closest('[hidden]')) return;
      const k = row.dataset.row;
      row.classList.remove('ts-bad');
      if (row.hasAttribute('data-script-row')) {
        const so = [...row.querySelectorAll('[data-step-row]')].map(li => ({ n: li.dataset.stepRow, o: li.querySelector('select').value, note: li.querySelector('input').value.trim() }));
        const oc = scriptOutcome(so.map(x => x.o));
        if (oc === 'incomplete') { out.push(`Record every step of “${titleOf(row)}”, or leave all as not run.`); row.classList.add('ts-bad'); }
        if (oc === 'fail' && !val(row, 'n_' + k) && !so.some(x => x.o === 'fail' && x.note)) { out.push(`Add a note for the failing step in “${titleOf(row)}”.`); row.classList.add('ts-bad'); }
        if (oc === 'pass' && !val(row, 'e_' + k)) { out.push(`“${titleOf(row)}” passed: add evidence (a link or a note on what you saw).`); row.classList.add('ts-bad'); }
      } else if (row.querySelector('select').value === 'fail' && !val(row, 'n_' + k)) { out.push(`Add a note for the failing case “${titleOf(row)}”.`); row.classList.add('ts-bad'); }
    });
    return out;
  };
  if (ov) {
    const envSel = ov.querySelector('[data-env]'); const blk = ov.querySelector('[data-scripts-block]'); const live = ov.querySelector('[data-cov-live]'); const err = ov.querySelector('[data-err]');
    const rows = () => [...ov.querySelectorAll('.ts-case')].filter(x => !x.closest('[hidden]'));
    const upd = () => { const v = rows(); const done = v.filter(x => [...x.querySelectorAll('select')].some(s => s.value)).length; live.textContent = opts.simple ? `${done} of ${v.length} tests marked.` : `${done} of ${v.length} rows have an outcome. Rows left as Not run count against coverage.`; };
    const showErr = list => { err.hidden = false; err.innerHTML = `<b>Can't save yet</b><ul>${list.slice(0, 5).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`; err.scrollIntoView({ block: 'nearest' }); };
    envSel.onchange = () => { blk.hidden = !scriptEnv(envSel.value); upd(); };
    ov.querySelector('[data-reset]').onclick = e => { e.stopPropagation(); rows().forEach(x => x.querySelectorAll('select').forEach(s => { s.value = ''; })); upd(); };
    ov.querySelector('[data-pick-all]').onchange = e => { rows().forEach(x => { const c = x.querySelector('[data-pick]'); if (c) c.checked = e.target.checked; }); };
    ov.querySelector('[data-bulk-pass]').onclick = e => {
      e.stopPropagation();
      const picked = rows().filter(x => { const c = x.querySelector('[data-pick]'); return c && c.checked; });
      const note = ov.querySelector('[data-bulk-ev]').value.trim();
      const hint = ov.querySelector('[data-bulk-hint]');
      const say = t => { hint.hidden = false; hint.textContent = t; };
      if (!picked.length) { say('Nothing selected: tick the rows to pass (or “All”) first.'); return; }
      if (!note) { say('Add one evidence note: it is recorded on every selected row.'); ov.querySelector('[data-bulk-ev]').setAttribute('aria-invalid', 'true'); ov.querySelector('[data-bulk-ev]').focus(); return; }
      hint.hidden = true;
      ov.querySelector('[data-bulk-ev]').removeAttribute('aria-invalid');
      picked.forEach(x => { x.querySelectorAll('select').forEach(s => { s.value = 'pass'; }); const ev = x.querySelector(`[name="${CSS.escape('e_' + x.dataset.row)}"]`); if (ev) ev.value = note; const c = x.querySelector('[data-pick]'); if (c) c.checked = false; });
      ov.querySelector('[data-pick-all]').checked = false;
      err.hidden = true; upd(); toast(`${picked.length} row${picked.length === 1 ? '' : 's'} marked passed with the evidence note`);
    };
    ov.querySelector('.ts-cases').addEventListener('change', upd);
    /* capture phase: runs before the modal's own click handler, so an invalid run never closes the dialog */
    ov.addEventListener('click', e => {
      const b = e.target.closest('[data-act=save]'); if (!b) return;
      const pr = problems(); if (!pr.length) return;
      e.stopPropagation(); showErr(pr);
    }, true);
    upd();
  }
  const r = await p;
  if (r.action !== 'save') return;
  const env = ENVS.includes(prev ? prev.env : r.form.env) ? (prev ? prev.env : r.form.env) : 'dev';
  const results = [];
  const addCommon = (x, k) => { const note = (r.form['n_' + k] || '').trim(); const ev = (r.form['e_' + k] || '').trim(); x.note = note; if (ev) x.evidence = ev; return x; };
  cases.forEach(({ c }) => { const k = 'c:' + c.id; const o = r.form['o_' + k]; if (o) results.push(addCommon({ caseId: c.id, outcome: o }, k)); });
  if (scriptEnv(env)) scripts.forEach(s => {
    const k = 's:' + s.id;
    const steps = scriptSteps(s).map(x => ({ n: x.n, outcome: r.form[`so_${k}_${x.n}`] || '', note: (r.form[`sn_${k}_${x.n}`] || '').trim() }));
    const oc = scriptOutcome(steps.map(x => x.outcome));
    if (!oc || oc === 'incomplete') return;
    const x = addCommon({ scriptId: s.id, outcome: oc, steps }, k);
    if (scnIds.has(s.id)) x.scenario = true;
    if (!x.note && oc !== 'pass') { const f = steps.find(y => y.outcome === oc && y.note); if (f) x.note = `Step ${f.n}: ${f.note}`; }
    results.push(x);
  });
  if (!results.length) { toast('Nothing recorded: every row was left as Not run.'); return; }
  const fresh = new Set(results.map(rid));
  const scriptN = scriptEnv(env) ? uatItems(prj).length : 0;
  const total = des.reduce((n, d) => n + casesFor(d.id).length, 0) + scriptN;
  const id = store.newId('run');
  const cycle = prev ? (prev.cycle || 1) + 1 : 1;
  const fails = results.filter(x => x.outcome === 'fail' && !x.carriedFrom);
  ui.runOpen.add(id);
  const doc = { id, projectId: prj.id, env, at: new Date().toISOString(), by: me, cycle, results };
  if (prev) doc.retestOf = prev.id;
  const cyc = cycles.find(c => c.id === r.form.cycleId && c.env === env);
  if (cyc) doc.cycleId = cyc.id;
  await store.save('testRun', id, doc,
    prev ? `Recorded ${envTxt(env)} retest (cycle ${cycle}) for ${prj.name}: ${fresh.size} retested, ${fails.length} still failing`
      : `Recorded ${envTxt(env)} test run for ${prj.name}${cyc ? ` in “${cyc.name}”` : ''}: ${results.length} of ${total} run, ${fails.length} failed`);
  toast(prev ? `Retest cycle ${cycle} saved · ${fails.length} still failing` : opts.simple ? `Saved: ${results.filter(x => x.outcome === 'pass').length} passed${fails.length ? `, ${fails.length} failed` : ''}` : `${envTxt(env)} run saved · ${results.length}/${total} run · ${fails.length} fail${fails.length === 1 ? '' : 's'}`);
  await afterRun(prj, id);
  if (fails.length) await createDefects(prj, id, fails.map(rid), true);
}

/* ---------- R6 defect lifecycle: new -> triaged -> in progress -> fixed -> verified (passing retest) -> closed ---------- */
const DSTATES = ['new', 'triaged', 'in-progress', 'fixed', 'verified', 'closed'];
const DS_CLS = { new: 'b-late', triaged: 'b-soon', 'in-progress': 'b-prog', fixed: 'b-prog', verified: 'b-done', closed: 'b-idle' };
const STATUS_OF = { new: 'idle', triaged: 'idle', 'in-progress': 'prog', fixed: 'prog', verified: 'prog', closed: 'done' };
const NEXT = { new: ['triaged', 'Triage'], triaged: ['in-progress', 'Start fix'], 'in-progress': ['fixed', 'Mark fixed'] };
const PRIOS = ['High', 'Medium', 'Low'];
const dsTxt = k => String(k || '').replace(/-/g, ' ');
const SEVS = { 1: '1 · critical', 2: '2 · major', 3: '3 · minor', 4: '4 · cosmetic' };
function dState(w) {
  const e = E();
  if (e && e.defectState) { try { const r = e.defectState(store.state.docs, w); const v = String(typeof r === 'string' ? r : (r && (r.state || r.status)) || '').replace(/\s+/g, '-'); if (DSTATES.includes(v)) return v; } catch (err) { /* fall through */ } }
  if (w.status === 'done') return 'closed';
  const ds = String(w.defectStatus || w.defectState || '').toLowerCase().replace(/[\s_]+/g, '-');
  return DSTATES.includes(ds) && ds !== 'verified' ? ds : w.status === 'prog' ? 'in-progress' : 'new';
}
const canWorkDefect = (prj, w) => store.state.me === w.owner || store.state.me === prj.owner;
async function setDefectState(prj, w, next, extra, why) {
  const cur = store.get('workItem', w.id) || w;
  const patch = Object.assign({ defectStatus: next, status: STATUS_OF[next], updatedAt: new Date().toISOString(), stateLog: (cur.stateLog || []).concat([{ state: next, at: new Date().toISOString(), by: store.state.me }]) }, extra || {});
  if (next === 'closed') patch.doneAt = store.state.today;
  await store.save('workItem', w.id, Object.assign({}, cur, patch), `${cur.title}: ${dsTxt(dState(cur))} → ${dsTxt(next)}${why ? ' (' + why + ')' : ''}`);
}
/* After any run: defects whose linked item now passes become "verified" automatically, then closing is offered. */
async function afterRun(prj, runId) {
  const run = store.get('testRun', runId); if (!run) return;
  const passed = new Set((run.results || []).filter(x => x.outcome === 'pass').map(rid));
  const defs = store.list('workItem', w => w.projectId === prj.id && w.kind === 'defect' && w.status !== 'done' && w.testRef && passed.has(w.testRef.caseId || w.testRef.scriptId));
  for (const w of defs) if (w.defectStatus !== 'verified') await setDefectState(prj, w, 'verified', { verifiedByRun: runId }, `passing ${envTxt(run.env)} retest`);
  if (defs.length) toast(`${defs.length} defect${defs.length === 1 ? '' : 's'} verified by the passing retest`);
  await offerCloseDefects(prj, runId);
}

/* A passing retest offers to close the defects linked to the items that now pass. */
async function offerCloseDefects(prj, runId) {
  const run = store.get('testRun', runId); if (!run) return;
  const passed = new Set((run.results || []).filter(x => x.outcome === 'pass').map(rid));
  const defs = store.list('workItem', w => w.projectId === prj.id && w.kind === 'defect' && w.status !== 'done' && w.testRef && passed.has(w.testRef.caseId || w.testRef.scriptId));
  if (!defs.length) return;
  const me = store.state.me;
  const can = w => me === w.owner || me === prj.owner;
  const r = await modal({
    title: `Verified: close ${defs.length} linked defect${defs.length === 1 ? '' : 's'}?`,
    body: `<p style="margin:0 0 8px">These defects are now <b>verified</b>: they were raised on items that just passed in the ${esc(envTxt(run.env))} run. Closing records the passing run as the proof of the fix.</p>
      <div class="ts-mk" data-close-offer>${defs.map(w => `<label class="ts-mk-r"><input type="checkbox" name="close" value="${esc(w.id)}" ${can(w) ? 'checked' : 'disabled'}><span><b>${esc(w.title)}</b><small>owner ${esc(pname(w.owner))}${can(w) ? '' : ` · only ${esc(pname(w.owner))} or the project owner can close it`}</small></span></label>`).join('')}</div>`,
    actions: [{ id: 'close', label: 'Close selected', primary: true }],
  });
  if (r.action !== 'close') return;
  const pick = new Set(r.form.close || []);
  let n = 0;
  for (const w of defs) {
    if (!pick.has(w.id) || !can(w)) continue;
    const note = `Retest passed in the ${envTxt(run.env)} run, ${fmt(run.at)}`;
    await setDefectState(prj, w, 'closed', { fixNote: note, closedByRun: runId }, note);
    n++;
  }
  if (n) toast(`${n} defect${n === 1 ? '' : 's'} closed`);
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
    return { name: t.getAttribute('name') || '', classname: t.getAttribute('classname') || '', outcome: fl ? 'fail' : sk ? 'skip' : 'pass', message: (msg || (sk ? (sk.getAttribute('message') || sk.textContent || '').trim() : '')).slice(0, 240) };
  }) };
}
/* JUnit match (R4): by id (in name or classname), or by title. Titles are normalized (case and punctuation ignored):
   a case's title is "<field> <kind>" (optionally prefixed by the data element name), a script's title is its title.
   Several cases can share a title, so each matched item is used once, in table order. */
export function matchCiTest(t, cases, scripts, used) {
  used = used || new Set();
  const text = `${t.classname} ${t.name}`;
  const esc_ = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* R5: the visible label, "TC<n>", with the data element's name when several elements have that label */
  const lm = /\bTC(\d+)\b/i.exec(text);
  if (lm) {
    const withLbl = cases.filter(c => !used.has(c.id) && caseLbl(c.id) === 'TC' + lm[1]);
    const named = withLbl.filter(c => { const de = store.get('dataElement', c.dataId); return de && norm(text).includes(norm(de.name)); });
    const hitL = named.length === 1 ? named[0] : withLbl.length === 1 ? withLbl[0] : null;
    if (hitL) return { caseId: hitL.id, how: 'label' };
  }
  const byId = [...cases.map(c => c.id), ...scripts.map(s => s.id)].find(id => !used.has(id) && new RegExp('(^|[^\\w-])' + esc_(id) + '($|[^\\w-])', 'i').test(text));
  if (byId) return cases.some(c => c.id === byId) ? { caseId: byId, how: 'id' } : { scriptId: byId, how: 'id' };

  const names = [norm(t.name), norm(text)];
  const hit = k => names.includes(k);
  const sc = scripts.find(s => !used.has(s.id) && hit(norm(s.title))); if (sc) return { scriptId: sc.id, how: 'title' };
  const cs = cases.find(c => { if (used.has(c.id)) return false; const de = store.get('dataElement', c.dataId) || {};
    return [`${c.field} ${c.kind}`, `${de.name} ${c.field} ${c.kind}`, `${c.field} ${c.input}`, `${de.name} ${c.field} ${c.input}`].some(x => hit(norm(x))); });
  return cs ? { caseId: cs.id, how: 'title' } : null;
}
async function importCi(prj) {
  const des = projectData(prj);
  const cases = []; des.forEach(d => casesFor(d.id).forEach(c => cases.push(c)));
  const scripts = uatItems(prj);
  const p = modal({
    title: 'Import CI results (JUnit XML)',
    body: `<p style="margin:0 0 8px" class="hint">Paste or upload a JUnit XML report. Each <code>testcase</code> is matched to a data case, UAT script or scenario by its label (<i>Bank remittance details TC2</i>) or by title: “field kind” for a case (e.g. <i>Routing number boundary</i>) or the script or scenario title. Case and punctuation are ignored. Labels are shown in the case lists. In the product, results arrive from the customer's pipeline automatically.</p>
      <div class="field"><label>JUnit XML</label><textarea name="xml" data-ci-xml class="ts-xml" placeholder="&lt;testsuite name=&quot;vendor-api&quot;&gt;&lt;testcase name=&quot;Bank remittance details TC1&quot;/&gt;…"></textarea></div>
      <div class="frow"><div class="field"><label>Environment the pipeline ran in</label><select name="env" data-ci-env>${envOpts('dev')}</select></div><div class="field"><label>&nbsp;</label><label class="btn sm ts-file">Upload .xml<input type="file" accept=".xml,text/xml,application/xml" data-ci-file hidden></label></div></div>
      <div class="hint">Tests marked <code>&lt;skipped/&gt;</code> are recorded as not run and shown as skipped. They never replace an earlier result.</div>`,
    actions: [{ id: 'preview', label: 'Preview mapping', primary: true }],
  });
  const ovs = document.querySelectorAll('.overlay'); const ov = ovs[ovs.length - 1];
  const fi = ov && ov.querySelector('[data-ci-file]');
  if (fi) fi.onchange = () => { const f = fi.files[0]; if (!f) return; if (f.size > 2 * 1024 * 1024) { toast('File is over 2 MB.'); return; } const rd = new FileReader(); rd.onload = () => { ov.querySelector('[data-ci-xml]').value = String(rd.result); }; rd.readAsText(f); };
  guard(f => { if (!String(f.xml || '').trim()) return { msg: 'Paste a JUnit XML report or upload a file.', field: 'xml' }; try { const pr = parseJUnit(f.xml); if (!pr.tests.length) return { msg: 'No <testcase> elements found in that report.', field: 'xml' }; } catch (e) { return { msg: 'Could not read the report: ' + e.message, field: 'xml' }; } return null; });
  const r = await p;
  if (r.action !== 'preview') return;
  let parsed;
  try { parsed = parseJUnit(r.form.xml); } catch (e) { toast('Could not read the report: ' + e.message); return; }
  const env = ENVS.includes(r.form.env) ? r.form.env : 'dev';
  /* R6 preview: each testcase -> the matched case/script, or unmatched; a dropdown maps it by hand before anything is saved */
  const seen = new Set();
  const rows = parsed.tests.map((t, i) => { const m = matchCiTest(t, cases, scripts, seen); if (m) seen.add(m.caseId || m.scriptId); return { t, i, m }; });
  const caseOpt = c => { const de = store.get('dataElement', c.dataId); return { v: 'c:' + c.id, l: `${de ? de.name + ' ' : ''}${caseLbl(c.id)} · ${c.field} ${c.kind}` }; };
  const opts = cases.map(caseOpt).concat(scripts.map(x => ({ v: 's:' + x.id, l: `${isScn(prj, x.id) ? 'Scenario' : 'Script'} · ${x.title}` })));
  const val = m => m ? (m.caseId ? 'c:' + m.caseId : 's:' + m.scriptId) : '';
  const OUT = { pass: ['pass', 'b-done'], fail: ['fail', 'b-late'], skip: ['skipped', 'b-idle'] };
  const HOW = { label: 'by label', id: 'by id', title: 'by title' };
  const matchedN = rows.filter(x => x.m).length;
  const p2 = modal({
    title: `Map ${parsed.tests.length} test result${parsed.tests.length === 1 ? '' : 's'} · ${parsed.suite}`,
    body: `<p class="hint" style="margin:0 0 8px">${matchedN} of ${rows.length} matched automatically. Check each row, map unmatched ones by hand or leave them unmatched; nothing is saved until you import. Runs as a <b>${esc(envTxt(env))}</b> run.</p>
      <div class="ts-cimap" data-ci-map>${rows.map(x => `<div class="ts-cimap-r ${x.m ? '' : 'un'}" data-ci-row="${x.i}"><div class="ts-cimap-t">${badge(OUT[x.t.outcome][0], OUT[x.t.outcome][1])} <code title="${esc(x.t.classname)}">${esc(x.t.name || '(unnamed)')}</code>
          <small data-ci-how>${x.m ? 'matched ' + HOW[x.m.how] : 'unmatched'}</small></div>
        <select data-ci-pick="${x.i}" aria-label="Map ${esc(x.t.name)} to"><option value="">Unmatched · don't import</option>${opts.map(o => `<option value="${esc(o.v)}" ${o.v === val(x.m) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></div>`).join('')}</div>`,
    actions: [{ id: 'import', label: 'Import run', primary: true }],
  });
  const ovs2 = document.querySelectorAll('.overlay'); const ov2 = ovs2[ovs2.length - 1];
  if (ov2) ov2.querySelector('[data-ci-map]').addEventListener('change', e => { const sl = e.target.closest('[data-ci-pick]'); if (!sl) return; const row = sl.closest('[data-ci-row]'); row.classList.toggle('un', !sl.value); row.querySelector('[data-ci-how]').textContent = sl.value ? (sl.value === val(rows[+sl.dataset.ciPick].m) ? 'matched ' + HOW[rows[+sl.dataset.ciPick].m.how] : 'mapped by hand') : 'unmatched'; });
  guard((f, act, mb) => {
    const picks = [...mb.querySelectorAll('[data-ci-pick]')].map(x => x.value).filter(Boolean);
    const dup = picks.find((v, i) => picks.indexOf(v) !== i);
    if (dup) { const o = opts.find(x => x.v === dup); return `Two test results are mapped to “${o ? o.l : dup}”. Map each case or script once.`; }
    if (!picks.length) return 'Every row is unmatched: map at least one test result, or cancel.';
    return null;
  });
  const r2 = await p2;
  if (r2.action !== 'import') return;
  const picked = {}; r2.root.querySelectorAll('[data-ci-pick]').forEach(x => { picked[x.dataset.ciPick] = x.value; });
  const results = []; let unmatched = 0; let byTitle = 0; let skipped = 0; let byHand = 0;
  rows.forEach(({ t, i, m }) => {
    const v = picked[i]; if (!v) { unmatched++; return; }
    const auto = v === val(m); const how = auto ? m.how : 'manual';
    if (how === 'title') byTitle++; if (how === 'manual') byHand++;
    if (t.outcome === 'skip') skipped++;
    const x = { outcome: t.outcome === 'skip' ? 'not-run' : t.outcome, note: t.outcome === 'fail' ? (t.message || 'CI reported a failure') : t.outcome === 'skip' ? `Skipped in CI${t.message ? ': ' + t.message : ''}` : '', evidence: `CI ${parsed.suite}: ${t.classname ? t.classname + '.' : ''}${t.name}`, matchedBy: how };
    if (v.startsWith('c:')) x.caseId = v.slice(2); else x.scriptId = v.slice(2);
    results.push(x);
  });
  if (!results.length) { toast('Nothing imported: every row was unmatched.'); return; }
  const id = store.newId('run');
  const fails = results.filter(x => x.outcome === 'fail');
  ui.runOpen.add(id);
  await store.save('testRun', id, { id, projectId: prj.id, env, at: new Date().toISOString(), by: store.state.me, source: 'ci', ciSuite: parsed.suite, ciUnmatched: unmatched, ciSkipped: skipped, ciManual: byHand, cycle: 1, results },
    `Imported CI results (${parsed.suite}) as a ${envTxt(env)} run for ${prj.name}: ${results.length} matched (${byTitle} by title, ${byHand} by hand), ${fails.length} failed, ${skipped} skipped, ${unmatched} unmatched`);
  toast(`CI import (${envTxt(env)}): ${results.length} matched · ${fails.length} fail · ${skipped} skipped · ${unmatched} unmatched`);
  await afterRun(prj, id);
  if (fails.length) await createDefects(prj, id, fails.map(rid), true);
}

/* Who owns a defect and where it lands: the script's step owner, or the data owner for a data case. */
function defectTarget(prj, x) {
  if (x.scriptId) {
    const s = uatItems(prj).find(y => y.id === x.scriptId); if (!s) return null;
    /* scenarios: the defect lands on the process step that failed */
    let stepId = s.step;
    if (!stepId && Array.isArray(s.steps)) { const bad = (x.steps || []).find(y => y.outcome === 'fail' || y.outcome === 'blocked'); const st = s.steps[bad ? bad.n - 1 : 0] || s.steps[0] || {}; stepId = st.step; }
    const lb = stepLabel(s.pid, stepId);
    return { pid: s.pid, step: stepId, owner: lb.owner || prj.owner, title: `Defect: ${s.title}`, ref: { scriptId: s.id }, where: `${lb.proc} · ${lb.step}` };
  }
  const c = store.get('testCase', x.caseId); if (!c) return null;
  const de = store.get('dataElement', c.dataId) || {};
  const at = firstStepUsing(prj, c.dataId); const lb = stepLabel(at.pid, at.step);
  return { pid: at.pid, step: at.step, owner: de.owner || prj.owner, title: `Defect: ${de.name || c.dataId} · ${c.field} ${c.input === '' ? '(empty)' : '“' + String(c.input).slice(0, 24) + '”'} should ${c.expect}`, ref: { caseId: c.id }, where: `${lb.proc} · ${lb.step}` };
}

function reproOf(x, t, run) {
  const steps = (x.steps || []).filter(y => y.outcome && y.outcome !== 'pass').map(y => `Step ${y.n}: ${y.outcome}${y.note ? ' — ' + y.note : ''}`);
  if (x.caseId) { const c = store.get('testCase', x.caseId); if (c) return `In ${envTxt(run.env)}, enter ${c.input === '' ? 'an empty value' : '“' + c.input + '”'} in ${c.field}. Expected: ${c.expect}. ${x.note || ''}`.trim(); }
  return [`Run “${t.title.replace(/^Defect: /, '')}” in ${envTxt(run.env)}.`].concat(steps).concat(x.note && !steps.length ? [x.note] : []).join('\n');
}

async function createDefects(prj, runId, ids, offered) {
  const run = store.get('testRun', runId); if (!run) return;
  const rows = (run.results || []).filter(x => ids.includes(rid(x)) && x.outcome === 'fail' && !x.defectId).map(x => ({ x, t: defectTarget(prj, x) })).filter(y => y.t);
  if (!rows.length) return;
  const due = window.PMOEngine.addBusinessDays(store.state.today, 3); /* never a weekend */
  const r = await modal({
    title: offered ? `${rows.length} failure${rows.length === 1 ? '' : 's'}: create defects?` : 'Create defect',
    body: `<p style="margin:0 0 8px">Each defect becomes a work item on the failing step, owned by the step owner (scripts) or the data owner (data cases), due ${esc(fmt(due))}. It starts as <b>new</b>; a passing retest marks it <b>verified</b>. Go-live is blocked while any defect is open.</p>
      <div class="ts-mk">${rows.map(({ x, t }) => { const k = esc(rid(x)); return `<div class="ts-mk-d" data-def-row="${k}"><label class="ts-mk-r"><input type="checkbox" name="mk" value="${k}" checked><span><b>${esc(t.title)}</b><small>${esc(t.where)} · owner ${esc(pname(t.owner))} · ${esc(envTxt(run.env))}</small></span></label>
        <div class="ts-mk-f"><label>Severity<select name="sev_${k}">${[1, 2, 3, 4].map(n => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${SEVS[n]}</option>`).join('')}</select></label>
          <label>Priority<select name="pri_${k}">${PRIOS.map(pr => `<option ${pr === 'Medium' ? 'selected' : ''}>${pr}</option>`).join('')}</select></label>
          <label class="ts-mk-repro">Steps to reproduce<textarea name="repro_${k}" rows="2">${esc(reproOf(x, t, run))}</textarea></label></div></div>`; }).join('')}</div>`,
    actions: [{ id: 'create', label: rows.length === 1 ? 'Create defect' : 'Create defects', primary: true }],
  });
  if (r.action !== 'create') return;
  const pick = new Set(r.form.mk || []);
  const results = (run.results || []).map(x => Object.assign({}, x));
  let n = 0;
  for (const { x, t } of rows) {
    if (!pick.has(rid(x))) continue;
    const wid = store.newId('def');
    const k = rid(x); const sev = Math.min(4, Math.max(1, +r.form['sev_' + k] || 2));
    await store.save('workItem', wid, { id: wid, projectId: prj.id, pid: t.pid, step: t.step, title: t.title, owner: t.owner, status: 'idle', start: store.state.today, due, deps: [], kind: 'defect', effortDays: 1,
      severity: sev, priority: PRIOS.includes(r.form['pri_' + k]) ? r.form['pri_' + k] : 'Medium', env: run.env, repro: String(r.form['repro_' + k] || '').trim(), defectStatus: 'new',
      stateLog: [{ state: 'new', at: new Date().toISOString(), by: store.state.me }],
      testRef: Object.assign({ runId }, t.ref), updatedAt: new Date().toISOString() }, `Created ${t.title} from the ${envTxt(run.env)} run (severity ${sev})`);
    await store.notify([t.owner], `${pname(store.state.me)} assigned you a defect: ${t.title} (due ${fmt(due)})`, 'workItem:' + wid);
    const res = results.find(y => rid(y) === rid(x)); if (res) res.defectId = wid;
    n++;
  }
  if (n) {
    await store.save('testRun', runId, Object.assign({}, run, { results }), `Linked ${n} defect${n === 1 ? '' : 's'} to the ${envTxt(run.env)} run`);
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
  await setDefectState(prj, w, 'closed', { fixNote: note || undefined }, note || 'closed by hand');
  toast('Defect closed');
}

/* ---------- UAT scripts ---------- */
async function adoptScripts(prj, onlyNew, quiet) {
  const cur = store.get('project', prj.id) || prj;
  const gen = generated(prj.id);
  const have = Array.isArray(cur.uatScripts) ? cur.uatScripts : [];
  const add = onlyNew ? gen.filter(g => !have.some(h => h.id === g.id)) : gen;
  if (!add.length) { if (!quiet) toast('No generated scripts to add.'); return; }
  const next = (onlyNew ? have : []).concat(add.map(s => { const x = { id: s.id, pid: s.pid, step: s.step, title: s.title, given: s.given, when: s.when, then: s.then, data: (s.data || []).slice() };
    if (Array.isArray(s.steps) && s.steps.length) x.steps = s.steps.map((y, i) => ({ n: i + 1, action: String(y.action || ''), expected: String(y.expected || '') }));
    const owner = s.tester || stepLabel(s.pid, s.step).owner || (store.get('dataElement', (s.data || [])[0]) || {}).owner;
    if (owner) x.tester = owner; return x; }));
  await store.save('project', prj.id, Object.assign({}, cur, { uatScripts: next }), onlyNew ? `Added ${add.length} generated UAT script${add.length === 1 ? '' : 's'} to ${prj.name}` : `Adopted ${add.length} generated UAT scripts for ${prj.name}`);
  if (!quiet) toast(onlyNew ? `${add.length} script${add.length === 1 ? '' : 's'} added` : `${add.length} business test scripts adopted. You can edit them now.`);
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
      <div class="field"><label>Tester</label>${testerSel('tester', s.tester)}</div>
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
  const stepsOf = root => [...root.querySelectorAll('[data-srow]')].map(row => ({ action: row.querySelector('[data-sa]').value.trim(), expected: row.querySelector('[data-sx]').value.trim() })).filter(x => x.action);
  guard((f, act, mb) => {
    const st = stepsOf(mb);
    if (!(f.title || '').trim()) return { msg: 'A script needs a title.', field: 'title' };
    if (!st.length) return 'A script needs at least one step with an action.';
    if (st.some(x => !x.expected)) return 'Every step needs an expected result.';
    return null;
  });
  const r = await p;
  if (r.action !== 'save') return;
  const f = r.form;
  const steps = stepsOf(r.root);
  const next = cur.uatScripts.map(x => x.id === sid ? Object.assign({}, x, { title: f.title.trim(), given: (f.given || '').trim(), steps: steps.map((y, i) => ({ n: i + 1, action: y.action, expected: y.expected })), when: steps[0].action, then: steps[steps.length - 1].expected, data: f.data || [], tester: f.tester || undefined }) : x);
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

/* ---------- end-to-end scenarios (R5) ---------- */
async function adoptScenarios(prj, onlyNew) {
  const cur = store.get('project', prj.id) || prj;
  const gen = genScenarios(prj.id);
  const have = Array.isArray(cur.uatScenarios) ? cur.uatScenarios : [];
  const add = onlyNew ? gen.filter(g => !have.some(h => h.id === g.id)) : gen;
  if (!add.length) { toast('No generated scenarios to add.'); return; }
  /* default tester: the owner of the scenario's first owned step, else its first data element's owner */
  const ownerOf = x => { for (const y of x.steps || []) { const o = stepLabel(x.pid, y.step).owner; if (o) return o; } return (store.get('dataElement', (x.data || [])[0]) || {}).owner; };
  const next = (onlyNew ? have : []).concat(add.map(x => Object.assign({ id: x.id, pid: x.pid, title: x.title, data: (x.data || []).slice(),
    steps: (x.steps || []).map((y, i) => ({ n: i + 1, step: y.step, action: String(y.action || ''), expected: String(y.expected || '') })) }, x.tester || ownerOf(x) ? { tester: x.tester || ownerOf(x) } : {})));
  await store.save('project', prj.id, Object.assign({}, cur, { uatScenarios: next }), onlyNew ? `Added ${add.length} end-to-end scenario${add.length === 1 ? '' : 's'} to ${prj.name}` : `Adopted ${add.length} end-to-end scenario${add.length === 1 ? '' : 's'} for ${prj.name}`);
  toast(`${add.length} scenario${add.length === 1 ? '' : 's'} ${onlyNew ? 'added' : 'adopted'}. They now count toward UAT coverage.`);
}
async function assignScenario(prj, sid, tester) {
  const cur = store.get('project', prj.id) || prj;
  const s = (cur.uatScenarios || []).find(x => x.id === sid); if (!s) return;
  await store.save('project', prj.id, Object.assign({}, cur, { uatScenarios: cur.uatScenarios.map(x => x.id === sid ? Object.assign({}, x, { tester: tester || undefined }) : x) }), tester ? `Assigned scenario “${s.title}” to ${pname(tester)}` : `Unassigned scenario “${s.title}”`);
  toast(tester ? `Scenario assigned to ${pname(tester)}` : 'Scenario unassigned');
}
async function editScenario(prj, sid) {
  const cur = store.get('project', prj.id) || prj;
  const s = (cur.uatScenarios || []).find(x => x.id === sid); if (!s) return;
  const srow = (x, i) => `<div class="ts-srow" data-srow data-sstep-id="${esc(x.step || '')}"><span class="ts-srow-n">${i + 1}</span><input data-sa value="${esc(x.action)}" placeholder="Action" aria-label="Step action"><input data-sx value="${esc(x.expected)}" placeholder="Expected result" aria-label="Expected result"><button type="button" class="btn sm danger" data-srm aria-label="Remove step">✕</button></div>`;
  const p = modal({
    title: 'Edit end-to-end scenario',
    body: `<div class="field"><label>Title</label><input name="title" value="${esc(s.title)}"></div>
      <div class="field"><label>Steps · action and expected result</label><div class="ts-srows" data-srows>${scriptSteps(s).map((x, i) => srow(Object.assign({ step: ((s.steps || [])[i] || {}).step }, x), i)).join('')}</div>
        <div><button type="button" class="btn sm" data-sadd>+ Add step</button></div></div>
      <div class="field"><label>Tester</label>${testerSel('tester', s.tester)}</div>`,
    actions: [{ id: 'save', label: 'Save scenario', primary: true }],
  });
  const ovs = document.querySelectorAll('.overlay'); const ov = ovs[ovs.length - 1];
  if (ov) {
    const box = ov.querySelector('[data-srows]');
    const renum = () => box.querySelectorAll('.ts-srow-n').forEach((n, i) => { n.textContent = i + 1; });
    const wire = () => box.querySelectorAll('[data-srm]').forEach(b => b.onclick = e => { e.stopPropagation(); if (box.children.length > 1) { b.closest('[data-srow]').remove(); renum(); } else toast('A scenario needs at least one step.'); });
    ov.querySelector('[data-sadd]').onclick = e => { e.stopPropagation(); box.insertAdjacentHTML('beforeend', srow({ action: '', expected: '' }, box.children.length)); wire(); box.lastElementChild.querySelector('[data-sa]').focus(); };
    wire();
  }
  const stepsOf = root => [...root.querySelectorAll('[data-srow]')].map(row => ({ step: row.dataset.sstepId || undefined, action: row.querySelector('[data-sa]').value.trim(), expected: row.querySelector('[data-sx]').value.trim() })).filter(x => x.action);
  guard((f, act, mb) => {
    const st = stepsOf(mb);
    if (!(f.title || '').trim()) return { msg: 'A scenario needs a title.', field: 'title' };
    if (!st.length) return 'A scenario needs at least one step with an action.';
    if (st.some(x => !x.expected)) return 'Every step needs an expected result.';
    return null;
  });
  const r = await p;
  if (r.action !== 'save') return;
  const steps = stepsOf(r.root).map((y, i) => Object.assign({ n: i + 1 }, y));
  const latest = store.get('project', prj.id) || cur;
  await store.save('project', prj.id, Object.assign({}, latest, { uatScenarios: latest.uatScenarios.map(x => x.id === sid ? Object.assign({}, x, { title: r.form.title.trim(), steps, tester: r.form.tester || undefined }) : x) }), `Edited scenario “${r.form.title.trim()}” (${steps.length} step${steps.length === 1 ? '' : 's'})`);
  toast('Scenario saved');
}
async function deleteScenario(prj, sid) {
  const cur = store.get('project', prj.id) || prj;
  const s = (cur.uatScenarios || []).find(x => x.id === sid); if (!s) return;
  const r = await modal({ title: 'Delete scenario?', body: `<p style="margin:0">${esc(s.title)}</p><div class="hint">It stops counting toward UAT coverage.</div>`, actions: [{ id: 'del', label: 'Delete', danger: true }] });
  if (r.action !== 'del') return;
  await store.save('project', prj.id, Object.assign({}, cur, { uatScenarios: cur.uatScenarios.filter(x => x.id !== sid) }), `Deleted scenario “${s.title}”`);
  toast('Scenario deleted');
}

/* ---------- discovered requirements ---------- */
async function resolveReq(dataId, i) {
  const de = store.get('dataElement', dataId); if (!de) return;
  if (de.owner !== store.state.me) { toast(`Only the data owner (${pname(de.owner)}) can resolve this.`); return; }
  const d = (de.discovered || [])[i]; if (!d || d.resolved) return;
  const p = modal({ title: 'Resolve discovered requirement', body: `<p style="margin:0 0 8px">${esc(d.text)}</p><div class="field"><label>Resolution note</label><textarea name="note" placeholder="Spec updated, rule added, or why no change is needed"></textarea></div>`, actions: [{ id: 'resolve', label: 'Resolve', primary: true }] });
  guard(f => !(f.note || '').trim() ? { msg: 'Add a note so testers know what changed.', field: 'note' } : null);
  const r = await p;
  if (r.action !== 'resolve') return;
  const note = (r.form.note || '').trim();
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
    body: `<div class="field"><label>Requirement</label><textarea name="text">${esc(`${tcse.field}: input "${tcse.input}" should ${tcse.expect === 'accept' ? 'be accepted' : 'be rejected'} but the ${envTxt(run.env)} build ${tcse.expect === 'accept' ? 'rejected' : 'accepted'} it.${res.note ? ' ' + res.note : ''}`)}</textarea></div>
      <div class="hint">Added to ${esc(de.name)} and sent to its owner, ${esc(pname(de.owner))}.</div>`,
    actions: [{ id: 'log', label: 'Log requirement', primary: true }],
  });
  if (r.action !== 'log' || !(r.form.text || '').trim()) return;
  const text = r.form.text.trim();
  await store.save('dataElement', de.id, Object.assign({}, de, { discovered: [...(de.discovered || []), { text, fromRun: runId, caseId, at: new Date().toISOString() }] }), `Logged discovered requirement on ${de.name}`);
  await store.notify([de.owner], `New discovered requirement on ${de.name}: “${text.slice(0, 80)}”`, 'dataElement:' + de.id);
  toast('Requirement logged and owner notified');
}
