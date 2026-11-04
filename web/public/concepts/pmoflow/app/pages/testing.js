/* Testing page (stream R): data profiling (statistics only), spec drift, generated test cases, test runs,
   discovered requirements. Route: /testing/:prj */
import { store } from '../store.js';
import { E, esc, fmt, fmtTime, link, go, av, pname, badge, modal, toast, commentsPanel, historyPanel, bindActivity } from '../ui.js';

const ui = { sel: {}, paste: '', pasteOpen: false, busy: false, runOpen: new Set() };

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

function testsCheck(prjId) {
  const e = E(); if (!e || !e.readiness) return null;
  try { return (e.readiness(store.state.docs, prjId, store.state.today).checks || []).find(c => c.id === 'tests-passed') || null; } catch (err) { return null; }
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
  const cnt = r => r ? (r.results || []).reduce((a, x) => (a[x.outcome] = (a[x.outcome] || 0) + 1, a), {}) : null;
  const kpi = (label, r) => { const c = cnt(r); return `<div class="kpi"><b class="${c ? (c.fail ? 'fail' : 'pass') : ''}">${c ? `${c.pass || 0}/${(r.results || []).length}` : '—'}</b><span>${label} latest</span></div>`; };
  const allCases = des.reduce((n, d) => n + casesFor(d.id).length, 0);

  const header = `<section class="hdr"><div>
      <div class="crumbs"><a href="${link('/')}" data-link>Workspace</a> · <a href="${link('/project/' + prjId)}" data-link>${esc(prj.name)}</a> · Testing</div>
      <div class="rl-title"><h1>Data testing</h1><select class="rl-switch" data-switch aria-label="Project">${projects.map(p => `<option value="${esc(p.id)}" ${p.id === prjId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <p>Tests come from each data element's spec plus a statistical profile of a real extract. Profiling keeps counts, lengths and patterns only, never the raw values.</p></div>
    <div class="hdr-side"><div class="kpis"><div class="kpi"><b>${allCases}</b><span>Test cases</span></div>${kpi('Dev', lastDev)}${kpi('UAT', lastUat)}</div></div></section>
    ${tc ? `<div class="ts-strip ${tc.pass ? 'pass' : 'fail'}" data-tests-check="${tc.pass ? 'pass' : 'fail'}"><span class="rl-ic ${tc.pass ? 'pass' : 'fail'}">${tc.pass ? '✓' : '✕'}</span>
      <div><b>Go-live check: ${esc(tc.label)}</b> — ${esc(tc.detail || '')}</div><a class="rl-go" href="${link('/release/' + prjId)}" data-link>Readiness gate ›</a></div>` : ''}`;

  if (!des.length) return header + `<div class="card" style="margin-top:16px"><div class="empty">This project's processes use no data elements yet. Add data to the to-be steps to test it.</div></div>`;

  const list = `<nav class="ts-list" aria-label="Data elements">${des.map(d => {
    const p = latestProfile(d.id); const n = casesFor(d.id).length;
    return `<a href="${link('/testing/' + prjId + '?de=' + d.id)}" data-de="${esc(d.id)}" class="${d.id === did ? 'on' : ''}"><span class="ts-dot ${esc(d.avail || 'missing')}"></span><span class="ts-nm">${esc(d.name)}</span><small>${n} case${n === 1 ? '' : 's'}${p ? ' · profiled' : ''}</small></a>`;
  }).join('')}</nav>`;

  return header + `<div class="ts-layout">${list}<div class="ts-main">${profileCard(de)}${casesCard(de)}${runsCard(prj, des, runs)}${discoveredCard(de)}
    <div class="two ts-act"><div class="card"><h3>Comments</h3>${commentsPanel('dataElement:' + de.id)}</div><div class="card"><h3>History · ${esc(de.name)}</h3>${historyPanel('dataElement:' + de.id)}</div></div>
    <div class="card" style="margin-top:16px"><h3>Test history</h3><div data-ts-history><div class="hint">Loading…</div></div></div></div></div>`;
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

function runsCard(prj, des, runs) {
  const caseIdx = {}; des.forEach(d => casesFor(d.id).forEach(c => caseIdx[c.id] = c));
  return `<div class="card"><h3>Test runs<span class="n">${runs.length}</span></h3>
    <div class="ts-prof-tools"><button class="btn sm primary" data-record>Record test run</button><span class="hint">Covers every case for this project's data elements. Go-live needs the latest dev and UAT runs with zero failures.</span></div>
    ${runs.length ? runs.map(r => {
      const c = (r.results || []).reduce((a, x) => (a[x.outcome] = (a[x.outcome] || 0) + 1, a), {});
      const open = ui.runOpen.has(r.id);
      const fails = (r.results || []).filter(x => x.outcome !== 'pass');
      return `<div class="ts-run" data-run="${esc(r.id)}"><div class="ts-run-h" data-run-toggle="${esc(r.id)}"><span class="chip">${esc(String(r.env).toUpperCase())}</span>
        <b>${esc(fmtTime(r.at))}</b><span class="hint">${av(r.by)} ${esc(pname(r.by))}</span>
        <span class="ts-counts">${badge((c.pass || 0) + ' pass', 'b-done')}${c.fail ? badge(c.fail + ' fail', 'b-late') : ''}${c.blocked ? badge(c.blocked + ' blocked', 'b-soon') : ''}</span><span class="rl-chev">${fails.length ? (open ? '▾' : '▸') : ''}</span></div>
        ${open ? `<div class="ts-run-b">${fails.map(x => { const tcse = caseIdx[x.caseId]; const de = tcse && store.get('dataElement', tcse.dataId);
          const logged = de && (de.discovered || []).some(d => d.fromRun === r.id && d.caseId === x.caseId);
          return `<div class="ts-fail">${badge(x.outcome, OUT_CLS[x.outcome])} <span>${tcse ? `<b>${esc(de ? de.name : '')} · ${esc(tcse.field)}</b> <code>${short(tcse.input)}</code> expected ${esc(tcse.expect)}` : esc(x.caseId)}${x.note ? ` — <i>${esc(x.note)}</i>` : ''}</span>
            ${x.outcome === 'fail' && tcse ? (logged ? '<span class="hint">Logged as requirement</span>' : `<button class="btn sm" data-discover="${esc(r.id)}|${esc(x.caseId)}">Log as discovered requirement</button>`) : ''}</div>`; }).join('')}</div>` : ''}</div>`;
    }).join('') : '<div class="empty">No runs recorded yet.</div>'}</div>`;
}

function discoveredCard(de) {
  const list = de.discovered || [];
  return `<div class="card"><h3>Discovered requirements · ${esc(de.name)}<span class="n">${list.length}</span></h3>
    ${list.length ? list.map(d => `<div class="row"><span class="ts-bulb">◆</span><div><div class="t">${esc(d.text)}</div><div class="s">From run ${esc(fmtTime((store.get('testRun', d.fromRun) || {}).at) || d.fromRun)} · ${esc(fmtTime(d.at))}</div></div></div>`).join('')
      : '<div class="hint">Failures that reveal a rule nobody documented get logged here and sent to the data owner.</div>'}</div>`;
}

/* ---------- bind ---------- */
export function bind(root, params) {
  const prjId = params.prj;
  const sw = root.querySelector('[data-switch]'); if (sw) sw.onchange = () => go('/testing/' + sw.value);
  const prj = store.get('project', prjId); if (!prj) return;
  const did = ui.sel[prjId]; const de = did && store.get('dataElement', did);
  root.querySelectorAll('[data-de]').forEach(a => a.onclick = e => { e.preventDefault(); ui.sel[prjId] = a.dataset.de; history.replaceState({}, '', link('/testing/' + prjId)); store.emit(); });
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

  const rec = root.querySelector('[data-record]'); if (rec) rec.onclick = () => recordRun(prj);
  root.querySelectorAll('[data-run-toggle]').forEach(h => h.onclick = () => { const id = h.dataset.runToggle; ui.runOpen.has(id) ? ui.runOpen.delete(id) : ui.runOpen.add(id); store.emit(); });
  root.querySelectorAll('[data-discover]').forEach(b => b.onclick = e => { e.stopPropagation(); const [runId, caseId] = b.dataset.discover.split('|'); logDiscovered(runId, caseId); });

  bindActivity(root);
  const hb = root.querySelector('[data-ts-history]');
  if (hb) (async () => {
    const raw = (await store.events(null, 200)).filter(e => /^(testRun|testCase|profile):/.test(e.ref || '') || /^Profiled /.test(e.summary || ''));
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

async function recordRun(prj) {
  const des = projectData(prj);
  const all = []; des.forEach(d => casesFor(d.id).forEach(c => all.push({ c, d })));
  if (!all.length) { toast('Generate or add test cases first.'); return; }
  const p = modal({
    title: 'Record test run',
    body: `<div class="frow"><div class="field"><label>Environment</label><select name="env"><option value="dev">Dev</option><option value="uat">UAT</option></select></div>
      <div class="field"><label>Set all</label><div class="ts-setall"><button type="button" class="btn sm" data-all="pass">All pass</button><button type="button" class="btn sm" data-all="fail">All fail</button></div></div></div>
      <div class="ts-cases">${all.map(({ c, d }) => `<div class="ts-case"><div class="ts-case-t"><b>${esc(d.name)} · ${esc(c.field)}</b> <code>${c.input === '' ? '(empty)' : short(c.input)}</code> <small>expect ${esc(c.expect)}</small></div>
        <div class="ts-case-i"><select name="o_${esc(c.id)}" aria-label="Outcome"><option value="pass">Pass</option><option value="fail">Fail</option><option value="blocked">Blocked</option></select><input name="n_${esc(c.id)}" placeholder="Note" aria-label="Note"></div></div>`).join('')}</div>`,
    actions: [{ id: 'save', label: 'Save run', primary: true }],
  });
  const ovs = document.querySelectorAll('.overlay'); const ov = ovs[ovs.length - 1];
  if (ov) ov.querySelectorAll('[data-all]').forEach(b => b.onclick = e => { e.stopPropagation(); ov.querySelectorAll('.ts-case select').forEach(s => s.value = b.dataset.all); });
  const r = await p;
  if (r.action !== 'save') return;
  const results = all.map(({ c }) => ({ caseId: c.id, outcome: r.form['o_' + c.id] || 'pass', note: r.form['n_' + c.id] || '' }));
  const id = store.newId('run');
  const fails = results.filter(x => x.outcome === 'fail').length;
  if (fails) ui.runOpen.add(id);
  await store.save('testRun', id, { id, projectId: prj.id, env: r.form.env, at: new Date().toISOString(), by: store.state.me, results },
    `Recorded ${r.form.env.toUpperCase()} test run for ${prj.name}: ${results.length - fails} of ${results.length} not failing`);
  toast(`${r.form.env.toUpperCase()} run saved · ${fails} fail${fails === 1 ? '' : 's'}`);
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
