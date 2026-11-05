/* E2E for stream D (process / step / data pages), rounds 1 to 9.
   R7: the main flow runs with Advanced on (every power tool stays covered); a Simple section then checks the
   plain-language, low-effort defaults (3-field step dialog, quick-add, automatic Future, no jargon, action budget).
   Usage: node tests/pmoflow/e2e-design.js [port]   (dev server must be running on that port) */
const { chromium } = require('playwright');
const fs = require('fs');
const PORT = process.argv[2] || process.env.PORT || 8792;
const BASE = `http://localhost:${PORT}/concepts/pmoflow`;
const OUT = '/tmp/pmo-design';
const ENG = require('../../api/shared/pmoflow-engine.js');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const failures = [];
function ok(cond, msg) { if (cond) { pass++; console.log('  ok  ' + msg); } else { fail++; failures.push(msg); console.log('  FAIL ' + msg); } }

/* ---- minimal XML sanity check (Node side): well-formed tags, returns element counts by local name ---- */
function checkXml(xml) {
  const counts = {}, ids = new Set(), refs = [], stack = [];
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m, pos = 0, root = null;
  while ((m = re.exec(body))) {
    if (m.index !== pos) throw new Error('unparseable markup at offset ' + pos + ': ' + body.slice(pos, pos + 40));
    pos = re.lastIndex;
    if (m[5] !== undefined) { if (/>/.test(m[5]) || /&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(m[5])) throw new Error('bad text: ' + m[5].slice(0, 40)); if (!stack.length && m[5].trim()) throw new Error('text outside root'); continue; }
    const [, close, name, attrs, selfClose] = m;
    if (close) { const open = stack.pop(); if (open !== name) throw new Error(`mismatched </${name}>, expected </${open}>`); continue; }
    if (!stack.length) { if (root) throw new Error('two root elements'); root = name; }
    const local = name.split(':').pop(); counts[local] = (counts[local] || 0) + 1;
    const a = {}; attrs.replace(/([\w.:-]+)\s*=\s*"([^"]*)"/g, (_, k, v) => { if (k in a) throw new Error('duplicate attribute ' + k); if (/[<]/.test(v)) throw new Error('raw < in attribute'); a[k] = v; });
    if (a.id && !local.startsWith('BPMN')) { if (ids.has(a.id)) throw new Error('duplicate id ' + a.id); ids.add(a.id); }
    if (a.sourceRef) refs.push(a.sourceRef, a.targetRef);
    if (!selfClose) stack.push(name);
  }
  if (pos !== body.length) throw new Error('trailing markup'); if (stack.length) throw new Error('unclosed ' + stack.join(','));
  return { root, counts, danglingRefs: refs.filter(r => !ids.has(r)) };
}
const isGw = n => n && (n.type === 'decision' || n.type === 'parallel');
const flat = ns => (ns || []).flatMap(n => isGw(n) ? (n.branches || []).flatMap(b => flat(b.nodes)) : (n.type === 'trigger' || n.type === 'end') ? [] : [n]);
const allNodes = ns => (ns || []).flatMap(n => [n, ...(isGw(n) ? (n.branches || []).flatMap(b => allNodes(b.nodes)) : [])]);
function expectedBpmn(nodes) {
  const all = allNodes(nodes), st = flat(nodes);
  /* a gateway emits a split plus a join, unless every branch loops back */
  const gws = t => all.filter(n => n.type === t).length + all.filter(n => n.type === t && !(n.branches || []).every(b => b.goto)).length;
  /* R6 node types: subprocess -> callActivity, wait -> timer catch event, message -> throw (send) / catch (receive) event */
  return { userTask: st.filter(n => !['subprocess', 'wait', 'message'].includes(n.type)).length, callActivity: st.filter(n => n.type === 'subprocess').length,
    intermediateCatchEvent: st.filter(n => n.type === 'wait' || (n.type === 'message' && n.direction === 'receive')).length, intermediateThrowEvent: st.filter(n => n.type === 'message' && n.direction !== 'receive').length,
    exclusiveGateway: gws('decision'), parallelGateway: gws('parallel'), startEvent: 1, endEvent: 1, lane: Math.max(1, new Set(st.map(n => n.owner || '')).size) };
}
/* R6: a node-type/field model of a map, ids replaced by positions, for lossless round-trip comparison */
function modelOf(nodes, dataName) {
  const all = allNodes(nodes); const pos = {}; all.forEach((n, i) => pos[n.id] = i);
  const arr = v => (v || []).slice();
  const one = n => {
    const o = { type: n.type || 'step', title: n.title || '' };
    if (n.type === 'end') return o;
    o.owner = n.owner || ''; o.touches = arr(n.touches); o.data = arr(n.data).map(dataName);
    if (isGw(n)) return Object.assign({ type: n.type, title: n.title, branches: (n.branches || []).map(b => ({ label: b.label, goto: b.goto != null ? pos[b.goto] : null, nodes: b.nodes.map(one) })) });
    if (n.type === 'trigger') return o;
    Object.assign(o, { sla: n.sla || '', system: n.system || '', durationHrs: n.durationHrs || 0, subs: (n.subs || []).map(x => ({ title: x.title, data: arr(x.data).map(dataName) })) });
    if (n.type === 'wait') o.wait = n.wait; if (n.type === 'message') { o.direction = n.direction || 'send'; o.party = n.party; } if (n.type === 'subprocess') o.calls = n.calls || n.callsName;
    return o;
  };
  return nodes.map(one);
}
const docsOf = st => st.docs;

(async () => {
  const browser = await chromium.launch();
  /* each run gets its own test client IP so the 5-sandboxes-per-IP-per-day limit does not block repeat runs on the dev server */
  const ip = `10.${(Math.random()*250|0)+1}.${(Math.random()*250|0)+1}.${(Math.random()*250|0)+1}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ip }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const shot = async name => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  /* page-level check required by the rules, plus a check scoped to #app (this stream's content) that names any culprit */
  const overflow = async label => {
    const r = await page.evaluate(() => {
      const iw = innerWidth, out = [];
      const scan = root => root.querySelectorAll('*').forEach(e => { const b = e.getBoundingClientRect(); if (b.width && b.right > iw + 1 && !e.closest('.canvas, .tbl-wrap, .tl')) out.push((e.id ? '#' + e.id : e.tagName.toLowerCase()) + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '')); });
      scan(document.getElementById('app')); const app = out.splice(0);
      scan(document.querySelector('header.top') || document.createElement('div'));
      return { sw: document.documentElement.scrollWidth, iw, app: app.slice(0, 4), chrome: out.slice(0, 4) };
    });
    ok(!r.app.length, `${label}: page content fits the viewport${r.app.length ? ' — overflowing: ' + r.app.join(', ') : ''}`);
    ok(r.sw <= r.iw + 1, `${label}: no horizontal page overflow (${r.sw} <= ${r.iw})${r.chrome.length ? ' — caused by header: ' + r.chrome.join(', ') : ''}`);
  };
  /* R9 §10: on a phone the persona picker sits in the ☰ menu */
  const setPersona = async id => { if (!(await page.isVisible('#persona'))) await page.click('#menuBtn'); await page.selectOption('#persona', id); if (await page.isVisible('#menuBtn') && await page.$('header.top.open')) await page.click('#menuBtn'); };
  const settle = () => page.waitForLoadState('networkidle').catch(() => {});
  const nav = async path => { await page.goto(BASE + path); await page.waitForSelector('#app .hdr, #app .card', { timeout: 20000 }); await settle(); };
  /* run an action that triggers a PUT/DELETE, and wait for it to finish */
  const saving = async fn => { const w = page.waitForResponse(r => ['PUT', 'DELETE'].includes(r.request().method()) && r.url().includes('/api/pmoflow/'), { timeout: 15000 }); await fn(); const r = await w; ok(r.ok(), 'save responded ' + r.status()); await settle(); };
  const act = id => page.click(`.overlay [data-act="${id}"]`);
  /* R9 §3: the client's local today is the one every page uses; the engine checks here use the same day */
  const state = () => page.evaluate(async () => { const d = new Date(); const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const r = await (await fetch('/api/pmoflow/ws/' + localStorage.getItem('pmoflow.ws') + '/state?today=' + t)).json(); r.today = t; return r; });
  /* test fixture writer (used only to seed a release and a discovered requirement) */
  const putDoc = (type, id, data, summary) => page.evaluate(async ([type, id, data, summary]) => (await fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/doc/${type}/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, actor: 'mc', summary }) })).status, [type, id, data, summary]);
  const titles = () => page.$$eval('#canvas .node .ttl', els => els.map(e => e.textContent.trim()));
  const getProc = async id => (await state()).docs.process.find(d => d.id === id).data;
  const getData = async id => (await state()).docs.dataElement.find(d => d.id === id).data;
  /* R6: Export opens a dialog (optional External parties pool), then downloads */
  /* R7: version, compare, save version, undo and the diagram file live in the "⋯ More" menu */
  const openMore = async () => { if (await page.$('[data-more]:not([open])')) await page.click('[data-more] > summary'); };
  const tool = async sel => { const el = await page.$(sel); if (!el || !(await el.isVisible())) await openMore(); await page.click(sel); };
  const exportBpmn = async (name, pool) => {
    await tool('[data-bpmn]'); await page.waitForSelector('.overlay [data-act="download"]');
    const cb = await page.$('.overlay input[name=pool]');
    if (cb && !(await cb.isDisabled())) { if (pool === false) await cb.uncheck(); else if (pool) await cb.check(); }
    const [dl] = await Promise.all([page.waitForEvent('download'), act('download')]);
    const file = `${OUT}/${name}.bpmn`; await dl.saveAs(file); return fs.readFileSync(file, 'utf8');
  };
  const bpmnCheck = (xml, nodes, label) => {
    let r; try { r = checkXml(xml); } catch (e) { ok(false, `${label}: BPMN is well-formed (${e.message})`); return; }
    ok(true, `${label}: BPMN is well-formed`);
    ok(r.root === 'bpmn:definitions' && xml.includes('http://www.omg.org/spec/BPMN/20100524/MODEL'), `${label}: root is definitions in the BPMN 2.0 namespace`);
    ok(r.counts.process === 1, `${label}: has one process element`);
    const exp = expectedBpmn(nodes);
    for (const [k, v] of Object.entries(exp)) ok((r.counts[k] || 0) === v, `${label}: ${k} count ${r.counts[k] || 0} === ${v}`);
    ok((r.counts.sequenceFlow || 0) >= exp.userTask + 1, `${label}: sequence flows connect the map (${r.counts.sequenceFlow})`);
    ok(!r.danglingRefs.length, `${label}: every sequenceFlow ref resolves${r.danglingRefs.length ? ' — dangling: ' + r.danglingRefs.join(',') : ''}`);
    const parts = r.counts.participant || 0, mflows = r.counts.messageFlow || 0;
    ok((r.counts.BPMNShape || 0) === Object.values(exp).reduce((a, v) => a + v, 0) + parts && (r.counts.BPMNEdge || 0) === r.counts.sequenceFlow + mflows, `${label}: diagram has a shape per element, lane and pool, and an edge per flow`);
    const flowNodes = Object.entries(exp).filter(([k]) => k !== 'lane').reduce((a, [, v]) => a + v, 0);
    ok((r.counts.flowNodeRef || 0) === flowNodes, `${label}: every flow node sits in exactly one lane (${r.counts.flowNodeRef} === ${flowNodes})`);
  };
  /* every icon-only control (no visible text) carries an aria-label */
  const iconCheck = async label => {
    const bad = await page.evaluate(() => [...document.querySelectorAll('#app button, #app [role=button], #app a.btn, .overlay button')].filter(b => b.offsetParent !== null && !b.textContent.replace(/[\s↑↓×+⊕◆›‹]/g, '').trim() && !b.getAttribute('aria-label')).map(b => b.outerHTML.slice(0, 80)));
    ok(!bad.length, `${label}: icon-only controls have aria-labels${bad.length ? ' — missing: ' + bad.join(' | ') : ''}`);
  };
  const countNodes = nodes => ({ steps: flat(nodes).length, decisions: allNodes(nodes).filter(n => n.type === 'decision').length, parallels: allNodes(nodes).filter(n => n.type === 'parallel').length, ends: allNodes(nodes).filter(n => n.type === 'end').length });
  const importFile = async file => { const w = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/doc/process/'), { timeout: 15000 }); const before = page.url(); await page.setInputFiles('[data-bpmn-file]', file); const r = await w; ok(r.ok(), 'import saved ' + r.status()); await page.waitForURL(u => String(u) !== before && /mode=edit/.test(String(u))); await settle(); return page.url().match(/process\/([\w-]+)/)[1]; };

  try {
    console.log('# boot');
    await nav('/');
    await page.waitForFunction(() => document.querySelectorAll('#persona option').length > 0, null, { timeout: 20000 });
    /* R7: Simple is the default; the main flow turns Advanced on (the Simple section near the end turns it off) */
    ok(!(await page.isChecked('#adv')), 'R7: Simple is the default (Advanced off)');
    await page.evaluate(() => localStorage.setItem('pmoflow.advanced', '1')); await nav('/');
    ok(await page.isChecked('#adv'), 'R7: Advanced turned on for the power-tool coverage');
    let st = await state();
    let futureHelp = '';
    const me = await page.$eval('#persona', s => s.value);
    const meName = st.people.find(p => p.id === me).name;
    const procs = (st.docs.process || []).map(d => d.data);
    ok(procs.length > 0, 'seed has processes');
    const seedP = procs.slice().sort((a, b) => flat(b.tobe).length - flat(a.tobe).length)[0];
    const pid = seedP.id;

    console.log('# R4: process index /processes');
    ok(await page.getAttribute('#nav a:has-text("Processes")', 'href') === '/concepts/pmoflow/processes', 'nav "Processes" opens /processes');
    await page.click('#nav a:has-text("Processes")');
    await page.waitForSelector('.d-prow');
    ok(await page.isVisible('#nav a.on:has-text("Processes")'), 'nav highlights Processes');
    const prow = await page.$$eval('.d-prow', rs => rs.map(r => ({ id: r.dataset.prow, ver: r.querySelector('[data-ver]').textContent.trim(), steps: r.querySelector('[data-col=steps] b').textContent.trim(), diff: r.querySelector('[data-col=diff]').dataset.diffcounts, data: (r.querySelector('[data-datacounts]') || { dataset: {} }).dataset.datacounts || '', owner: r.querySelector('[data-col=owner]').textContent, prj: r.querySelector('[data-col=projects]').textContent })));
    ok(prow.length === procs.length, `index lists every process (${prow.length})`);
    let rowsOk = true;
    for (const r of prow) {
      const p = procs.find(x => x.id === r.id); const ds = ENG.diffSummary(p); const ids = [...new Set(flat(p.tobe).flatMap(s => s.data || []))];
      const c = k => ids.filter(d => ENG.effectiveAvail(st.docs, d) === k).length;
      const projs = (st.docs.project || []).map(d => d.data).filter(j => (j.processes || []).includes(p.id));
      const exp = { ver: 'v' + (p.version || 1), steps: String(flat(p.tobe).length), diff: (() => { const dd = ENG.diffProcess(p); const fs_ = flat(p.tobe); return `${fs_.filter(x => dd.nodes[x.id] === 'new').length}/${fs_.filter(x => dd.nodes[x.id] === 'changed').length}/${(dd.removed || []).filter(g => g && !isGw(g) && g.type !== 'trigger' && g.type !== 'end').length}`; })(), data: ids.length ? `${c('live')}/${c('pending')}/${c('example')}/${c('missing')}` : '' };
      if (r.ver !== exp.ver || r.steps !== exp.steps || r.diff !== exp.diff || r.data !== exp.data || !r.owner.includes(st.people.find(x => x.id === p.owner).name) || !projs.every(j => r.prj.includes(j.name))) { rowsOk = false; console.log('    row mismatch', r, exp); }
    }
    ok(rowsOk, 'each row: version, owner, steps, R9 step-level new/changed/removed (diffProcess), live/pending/examples/missing (effectiveAvail), projects');
    ok(await page.getAttribute('[data-new-workflow]', 'href') === '/concepts/pmoflow/new' && await page.getAttribute('[data-import-sop]', 'href') === '/concepts/pmoflow/import' && !!(await page.$('label.d-import [data-bpmn-file]')), '"+ Map a process", "Import BPMN" (Advanced) and "Paste a procedure" actions');
    await page.fill('[data-psearch]', seedP.name.split(' ')[0].toLowerCase());
    const vis = await page.$$eval('.d-prow', rs => rs.filter(r => !r.hidden).map(r => r.dataset.prow));
    ok(vis.includes(pid) && vis.length < procs.length && /of/.test(await page.textContent('[data-pcount]')), `search filters rows (${vis.length} of ${procs.length})`);
    await page.fill('[data-psearch]', 'zzqx nothing');
    ok(await page.isVisible('[data-pnone]') && !(await page.$$eval('.d-prow', rs => rs.filter(r => !r.hidden).length)), 'search with no match shows an empty state');
    await page.fill('[data-psearch]', ''); await page.dispatchEvent('[data-psearch]', 'input');
    await shot('processes'); await overflow('processes @1440'); await iconCheck('processes');
    await page.click('[data-new-workflow]'); await page.waitForURL(/\/new$/); await page.waitForSelector('.overlay input[name=name]'); await act('cancel'); await page.waitForURL(/pmoflow\/?$/);
    await nav('/processes'); await page.click('[data-import-sop]'); await page.waitForURL(/\/import$/);
    await nav('/processes'); await page.click(`[data-prow="${pid}"] .d-pname a`); await page.waitForURL(new RegExp('/process/' + pid + '$'));

    console.log('# view modes on ' + pid);
    for (const m of ['asis', 'tobe', 'diff', 'lanes']) {
      await nav(`/process/${pid}?mode=${m}`);
      ok(await page.$eval('.d-modes button.on', b => b.dataset.mode) === m, `${m}: tab active`);
      ok((await page.$$('#canvas .node')).length > 0, `${m}: map renders nodes`);
      await shot('process-' + m); await overflow('process ' + m + ' @1440'); await iconCheck('process ' + m);
    }
    const tabOrder = await page.$$eval('.d-modes button', bs => bs.map(b => b.textContent.trim()));
    ok(tabOrder.join(',') === 'Today,Future,What changed,By person,Who’s affected', 'R7 (Advanced) tabs in order: ' + tabOrder.join(','));
    ok(await page.isVisible('.d-editbtn[data-mode="edit"]'), 'R7: Edit is a button next to the tabs (editors only)');

    console.log('# R3: effective data state on map cards, diffSummary counts');
    await nav(`/process/${pid}?mode=tobe`);
    const D = docsOf(st); const D0 = () => D;
    const cards = await page.$$eval('#canvas .node[data-step]', els => els.map(e => ({ id: e.dataset.step, miss: (e.querySelector('.d-miss') || {}).textContent || '', amber: (e.querySelector('.d-needlive') || {}).textContent || '' })));
    let cardOk = cards.length > 0, sawMiss = false, sawAmber = false;
    for (const c of cards) {
      const n = flat(seedP.tobe).find(x => x.id === c.id); const eff = (n.data || []).map(d => ENG.effectiveAvail(D, d));
      const m = eff.filter(a => a === 'missing').length, x = eff.filter(a => a === 'example').length;
      if ((m ? !c.miss.includes(m + ' not available yet') : !!c.miss) || (x ? !c.amber.startsWith(x + ' sample only') : !!c.amber)) { cardOk = false; console.log('    card mismatch', c, m, x); }
      sawMiss = sawMiss || !!m; sawAmber = sawAmber || !!x;
    }
    ok(cardOk, `map cards: red "not available yet" and amber "sample only" match effectiveAvail on ${cards.length} cards`);
    ok(sawMiss || sawAmber, `seed shows at least one data warning (missing ${sawMiss}, examples ${sawAmber})`);
    /* R9 §13: the KPI counts steps only, so "new + changed" never exceeds the step count */
    const dsp = ENG.diffProcess(seedP), sfl = flat(seedP.tobe);
    const sum = { new: sfl.filter(x => dsp.nodes[x.id] === 'new').length, changed: sfl.filter(x => dsp.nodes[x.id] === 'changed').length };
    ok((await page.textContent('[data-kpi-diff] b')).trim() === `${sum.new}+${sum.changed}` && sum.new + sum.changed <= sfl.length, `R9: KPI new+changed steps = diffProcess ${sum.new}+${sum.changed} (of ${sfl.length} steps)`);

    console.log('# swimlanes: gateways in their own row, lanes fit or scroll inside the canvas');
    await nav(`/process/${pid}?mode=lanes`);
    const gwCount = allNodes(seedP.tobe).filter(isGw).length;
    ok((await page.$$('.d-lane-gw')).length === gwCount && gwCount > 0, `swimlanes show ${gwCount} gateway row(s)`);
    /* R5: lanes never clip: each lane is at least 220 px, the lane area stays inside the canvas and scrolls to reach the last lane */
    const laneCheck = async label => {
      const r = await page.evaluate(() => { const w = document.querySelector('.d-lanewrap'), c = document.querySelector('#canvas'); const hs = [...w.querySelectorAll('.lane-h')];
        const minW = Math.min(...hs.map(h => h.getBoundingClientRect().width)); w.scrollLeft = w.scrollWidth; const last = hs[hs.length - 1].getBoundingClientRect(), wr = w.getBoundingClientRect();
        const out = { lanes: hs.length, minW, reach: last.right <= wr.right + 1 && last.left >= wr.left - 1, scrolls: getComputedStyle(w).overflowX === 'auto', inCanvas: wr.right <= c.getBoundingClientRect().right + 1 && c.scrollWidth <= c.clientWidth + 1 }; w.scrollLeft = 0; return out; });
      ok(r.minW >= 219.5, `${label}: every lane at least 220 px (${Math.round(r.minW)})`);
      ok(r.inCanvas && r.scrolls, `${label}: lane area stays inside the canvas and scrolls`);
      ok(r.reach, `${label}: last of ${r.lanes} lanes fully reachable by scrolling`);
    };
    await laneCheck('swimlanes @1440');
    await page.setViewportSize({ width: 1280, height: 900 }); await nav(`/process/${pid}?mode=lanes`);
    await laneCheck('R5 swimlanes @1280'); await shot('process-lanes-1280'); await overflow('lanes @1280');
    await page.setViewportSize({ width: 1440, height: 900 });

    console.log('# as-is side panel lists as-is data');
    await nav(`/process/${pid}?mode=asis`);
    const asisData = [...new Set(flat(seedP.asis).flatMap(s => s.data || []))].sort();
    const shownData = (await page.$$eval('[data-side-data="asis"] [data-hl]', els => els.map(e => e.dataset.hl))).sort();
    ok(JSON.stringify(asisData) === JSON.stringify(shownData), `as-is panel lists as-is data (${shownData.length}) not to-be data`);

    console.log('# diff');
    await nav(`/process/${pid}?mode=diff`);
    const nBadges = (await page.$$('#canvas .chip.diff-new, #canvas .chip.diff-changed')).length;
    ok(nBadges > 0, `diff shows NEW/CHANGED badges (${nBadges})`);
    ok((await page.$$('#canvas .d-was')).length > 0, 'diff shows what-changed notes');
    const expRemoved = ENG.diffSummary(seedP).removed;
    ok((await page.$$('#canvas .ghost')).length === expRemoved, `diff shows ${expRemoved} removed ghost(s)`);
    if (expRemoved) ok((await page.textContent('[data-removed-n]')).trim() === String(expRemoved), 'removed count = diffSummary.removed');

    console.log('# BPMN export of the seed to-be');
    await nav(`/process/${pid}?mode=tobe`);
    bpmnCheck(await exportBpmn('seed-tobe'), seedP.tobe, 'seed to-be');

    console.log('# version history (released v1)');
    const rp = JSON.parse(JSON.stringify(seedP));
    if (!(rp.released || []).length) { rp.released = [{ version: 1, at: new Date(Date.now() - 20 * 86400000).toISOString(), by: 'ta', asis: rp.asis }]; rp.version = Math.max(2, rp.version || 1); ok(await putDoc('process', pid, rp, 'Test fixture: released v1') === 200, 'fixture: release v1 stored'); }
    const rel = rp.released[0];
    await nav(`/process/${pid}?mode=asis`);
    await openMore(); await page.selectOption('[data-version]', String(rel.version));
    await page.waitForSelector('.d-relbanner');
    const banner = await page.textContent('.d-relbanner');
    ok(new RegExp(`Released .+ by ${(st.people.find(p => p.id === rel.by) || {}).name}`).test(banner), 'release banner: ' + banner.trim().slice(0, 60));
    ok((await page.$$('#canvas .node')).length > 0 && (await page.$$('#canvas [data-go]')).length === 0 && (await page.$$('#canvas [data-ins]')).length === 0, 'released map renders read-only');
    ok((await page.$$('[data-side-data="released"]')).length === 1, 'side panel follows the released map');
    const roCtl = await page.$$eval('[data-newdata], [data-mode="edit"], [data-start-project], [data-bpmn-file], [data-ed], [data-ins], [data-fork], [data-meta]', els => els.map(e => e.outerHTML.slice(0, 50)));
    ok(!roCtl.length, 'released view shows no edit controls' + (roCtl.length ? ': ' + roCtl.join(' | ') : ''));
    await iconCheck('released view');
    await shot('process-released');
    await page.click('[data-version-current]'); await page.waitForSelector('.d-modes button.on');
    ok(!(await page.$('.d-relbanner')), 'back to current');

    console.log('# data highlight + step drill-down');
    await nav(`/process/${pid}?mode=tobe`);
    await page.click('[data-hl] .t');
    ok((await page.$$('#canvas .node.hl')).length > 0 && (await page.$$('#canvas .node.dim')).length > 0, 'data row highlights using steps and dims the rest');
    await page.click('#canvas .node[data-go] .ttl');
    await page.waitForURL(/\/step\//);
    await page.waitForSelector('.kgrid');
    ok((await page.$$('.kgrid .kc')).length === 5, 'step page KPIs render');
    ok(await page.isVisible('text=How this step is done') && await page.isVisible('text=Work to deliver it'), 'step page shows sub-steps and work cards');
    ok(await page.isVisible('text=Business tests for this step'), 'step page shows the business tests card');
    const uatN = (await page.$$('.d-uatc')).length;
    ok(uatN > 0, `changed seed step has UAT scripts (${uatN})`);
    await settle(); await shot('step'); await overflow('step @1440');

    console.log('# R4: step page "Why this date?"');
    const stepWithWork = (st.docs.workItem || []).map(d => d.data).find(w => w.status !== 'done' && w.pid === pid && ENG.explainForecast(st.docs, w.id, st.today).length);
    ok(!!stepWithWork, 'seed has an open work item with a forecast explanation');
    if (stepWithWork) {
      await nav(`/process/${pid}/step/${stepWithWork.step}`);
      const openItems = (st.docs.workItem || []).map(d => d.data).filter(w => w.pid === pid && w.step === stepWithWork.step && w.status !== 'done' && ENG.explainForecast(st.docs, w.id, st.today).length);
      ok((await page.$$('.d-why')).length === openItems.length, `one "Why this date?" per open work item (${openItems.length})`);
      const why = `.d-why[data-why="${stepWithWork.id}"]`;
      ok(!(await page.$eval(why, d => d.open)), 'explanation is collapsed until asked');
      await page.click(why + ' summary');
      const lines = await page.$$eval(why + ' li', ls => ls.map(l => l.textContent.trim()));
      const expLines = ENG.explainForecast(st.docs, stepWithWork.id, st.today).map(x => x.text);
      ok(JSON.stringify(lines) === JSON.stringify(expLines), 'explanation = explainForecast: ' + lines.join(' / ').slice(0, 120) + (JSON.stringify(lines) === JSON.stringify(expLines) ? '' : ' — expected: ' + expLines.join(' / ').slice(0, 300) + ' — got: ' + lines.join(' / ').slice(0, 300)));
      ok(!lines.some(l => /\b(wi|de|n)-[a-z0-9]{4,}\b|undefined/.test(l)), 'explanation uses names, not ids');
      await shot('step-why'); await overflow('step why @1440');
    }

    console.log('# /new → edit flows');
    await nav('/new');
    await page.waitForSelector('.overlay input[name=name]');
    await page.fill('.overlay input[name=name]', 'E2E Purchase Request');
    await page.fill('.overlay textarea[name=desc]', 'Created by the design e2e.');
    await saving(() => act('create'));
    await page.waitForURL(/mode=edit/);
    const newPid = page.url().match(/process\/([\w-]+)/)[1];
    ok(!!newPid, 'created process ' + newPid);
    ok(/v=asis/.test(page.url()) && await page.isVisible('.d-modes [data-mode="asis"].on') && await page.isVisible('[data-edit-done]'), 'new process opens editing on Today');
    await page.waitForSelector('.overlay #d-f-title');
    ok(true, 'R7: the first "Add a step" dialog opens by itself on a new process');
    await act('cancel');
    const np0 = await getProc(newPid);
    ok(np0.asis[0].type === 'trigger' && np0.asis[0].title === '' && np0.tobe[0].title === '', 'R5: new trigger title is empty (the prompt is a placeholder, not a value)');
    ok(await page.isVisible('#canvas .node.trigger [data-trigger-empty]:has-text("What starts it?")'), 'R7: empty trigger shows "What starts it?" as placeholder text');
    await page.click('#canvas .node.trigger [data-ed="edit"]'); await page.waitForSelector('.overlay input[name=title]');
    ok(await page.inputValue('.overlay input[name=title]') === '' && /^e\.g\./.test(await page.getAttribute('.overlay input[name=title]', 'placeholder')) && await page.isVisible('.overlay h2:has-text("What starts it?")'), 'R7: "What starts it" dialog: empty value, an example as placeholder');
    await page.fill('.overlay input[name=title]', 'Requester submits a purchase request');
    await page.fill('.overlay input[name=touches]', 'Kickoff Desk');
    await saving(() => act('save'));
    ok((await getProc(newPid)).asis[0].title === 'Requester submits a purchase request', 'R5: trigger title saved');
    ok(await page.isVisible('[data-touches] [data-touch="Kickoff Desk"]:has-text("· 1")'), 'R7: "what starts it" teams count in "Teams involved"');
    ok(await page.isVisible('[data-addstep]:has-text("+ Add a step")'), 'R7: Today editing shows one big "+ Add a step" button');
    await shot('process-new-asis'); await iconCheck('edit Today');
    await page.click('.d-modes [data-mode="tobe"]'); await page.waitForURL(/mode=edit&v=tobe/);
    await page.waitForSelector('[data-addstep]');

    /* keyboard: focus "+ Add a step", press Enter; tag information by typing; fill time limit/system/duration under More options */
    await page.focus('[data-addstep]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.overlay #d-f-title');
    await page.fill('.overlay input[name=title]', 'Verify identity');
    const firstData = st.docs.dataElement[0].data;
    await page.fill('.overlay #d-f-info', firstData.name + ',');
    ok(await page.isVisible(`.overlay [data-ichip="${firstData.id}"]`), 'R7: typing an existing information name and a comma adds it as a chip');
    await page.fill('.overlay input[name=touches]', 'Compliance, Portal');
    await page.fill('.overlay input[name=sla]', '2 business days');
    await page.fill('.overlay input[name=system]', 'ERP');
    await page.fill('.overlay input[name=durationHrs]', '4');
    await page.click('.overlay [data-subadd]');
    await page.fill('.overlay [data-subrow] input[name=sub_title]', 'Check ID document');
    await page.click('.overlay [data-subrow] .d-pick >> nth=0');
    await saving(() => act('save'));
    ok((await titles()).includes('Verify identity') && !(await page.$('.overlay')), 'inserted step via keyboard; "Add step" closes the dialog');
    ok((await page.textContent('.node:has-text("Verify identity") .d-ops')).trim() === '⏱ 2 business days · ERP · 4h', 'card shows SLA · system · duration');

    /* decision with a loop-back branch */
    let insCount = (await page.$$('[data-ins="root"]')).length;
    await page.click(`[data-ins="root"] >> nth=${insCount - 1}`);
    await act('decision');
    await page.fill('.overlay input[name=title]', 'Amount over limit?');
    await page.click('.overlay [data-badd]');
    ok((await page.$$('.overlay [data-brow]')).length === 3, 'decision modal: added a third branch');
    await page.click('.overlay [data-brow] >> nth=2 >> [data-bdel]');
    await page.fill('.overlay [data-brow] >> nth=1 >> input', 'Needs more info');
    await page.selectOption('.overlay [data-brow] >> nth=1 >> select[name=bgoto]', { label: '↩ Go back to Verify identity' });
    await saving(() => act('save'));
    ok(await page.isVisible('.diamond:has-text("Amount over limit?")'), 'decision inserted');
    ok(await page.isVisible('.blabel:has-text("Needs more info")'), 'renamed branch label shown');
    ok((await page.textContent('.d-goto')).includes('Go back to “Verify identity”'), 'loop-back label rendered at branch end');
    const loopCheck = async label => {
      const r = await page.evaluate(() => {
        const lb = document.querySelector('#canvas .d-goto[data-goto]'); const path = document.querySelector(`#canvas svg.d-loops path.d-loop[data-loop="${lb.dataset.goto}"]`);
        if (!path) return null;
        const tg = document.querySelector(`#canvas [data-node="${lb.dataset.goto}"]`).getBoundingClientRect(), l = lb.getBoundingClientRect(), svg = path.ownerSVGElement.getBoundingClientRect();
        const len = path.getTotalLength(), a = path.getPointAtLength(0), z = path.getPointAtLength(len);
        const abs = p => ({ x: p.x + svg.left, y: p.y + svg.top });
        const A = abs(a), Z = abs(z);
        return { hidden: path.ownerSVGElement.getAttribute('aria-hidden'), marker: path.getAttribute('marker-end'), curved: /Q/.test(path.getAttribute('d')),
          startOk: Math.abs(A.y - (l.top + l.bottom) / 2) < 3 && (Math.abs(A.x - l.right) < 4 || Math.abs(A.x - l.left) < 4),
          endOk: Z.y >= tg.top - 1 && Z.y <= tg.bottom + 1 && (Math.abs(Z.x - tg.right) < 8 || Math.abs(Z.x - tg.left) < 8), labelText: lb.textContent };
      });
      ok(!!r && r.curved && r.marker && r.hidden === 'true', `${label}: curved SVG return arrow with an arrowhead, aria-hidden`);
      ok(!!r && r.startOk && r.endOk, `${label}: arrow runs from the end of the branch to the target node`);
      ok(!!r && /Go back to/.test(r.labelText), `${label}: text label kept for accessibility`);
    };
    await loopCheck('edit map @1440');
    await nav(page.url().replace(BASE, '').replace(/mode=edit.*/, 'mode=tobe'));
    await loopCheck('to-be map @1440');
    await page.screenshot({ path: `${OUT}/loop-1440.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await nav(page.url().replace(BASE, ''));
    await loopCheck('to-be map @390'); await overflow('loop map @390');
    await page.screenshot({ path: `${OUT}/loop-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await nav(page.url().replace(BASE, '').replace(/mode=tobe/, 'mode=edit&v=tobe'));
    await page.waitForSelector('[data-ins]');

    /* step inside the first branch */
    await page.click('[data-ins$="#0"] >> nth=0');
    await act('step');
    await page.waitForSelector('.overlay #d-f-title');
    await page.fill('.overlay input[name=title]', 'Manager approval');
    await saving(() => act('save'));
    ok(await page.isVisible('.branch .node:has-text("Manager approval")'), 'step added inside a branch');

    /* parallel gateway after the decision, with a step in one track */
    insCount = (await page.$$('[data-ins="root"]')).length;
    await page.click(`[data-ins="root"] >> nth=${insCount - 1}`);
    await act('parallel');
    await page.fill('.overlay input[name=title]', 'Set up vendor');
    ok((await page.$$('.overlay select[name=bgoto]')).length === 0, 'parallel gateway has no loop-back option');
    await saving(() => act('save'));
    ok(await page.isVisible('[data-gw="parallel"] .d-par:has-text("At the same time")'), 'R7: "at the same time" shows its plain label');
    ok((await page.textContent('[data-gw="parallel"] .d-par')).includes('⊕'), 'parallel gateway uses the ⊕ diamond');
    await page.click('[data-gw="parallel"] [data-ins$="#1"]');
    await act('step');
    await page.waitForSelector('.overlay #d-f-title');
    await page.fill('.overlay input[name=title]', 'Notify treasury');
    await saving(() => act('save'));
    ok(await page.isVisible('[data-gw="parallel"] .node:has-text("Notify treasury")'), 'step added inside a parallel track');

    /* create-and-tag is deferred: cancel discards it; duplicates are blocked */
    await page.click('.node:has-text("Verify identity") [data-ed="edit"]');
    await page.waitForSelector('.overlay [data-nd-name]');
    await page.fill('.overlay [data-nd-name]', 'E2E ghost element');
    await page.click('.overlay [data-nd-create]');
    ok(await page.isVisible('.overlay [data-ichip][data-iname="E2E ghost element"]'), 'inline information added as a chip in the dialog');
    await act('cancel');
    await page.waitForTimeout(400);
    ok(!((await state()).docs.dataElement || []).some(d => d.data.name === 'E2E ghost element'), 'cancelled step modal did not create the data element');
    const existing = st.docs.dataElement[0].data.name;
    await page.click('.node:has-text("Verify identity") [data-ed="edit"]');
    await page.fill('.overlay [data-nd-name]', existing.toUpperCase());
    await page.click('.overlay [data-nd-create]');
    ok(/already exists/.test(await page.textContent('.overlay [data-nd-msg]')), 'duplicate name (different case) blocked inline');
    await page.fill('.overlay [data-nd-name]', 'E2E identity proof');
    await page.click('.overlay [data-nd-create]');
    ok(await page.isVisible('.overlay [data-ichip][data-iname="E2E identity proof"]'), 'inline information added as a chip');
    await saving(() => act('save'));
    await page.waitForTimeout(500);
    st = await state();
    const ndata = (st.docs.dataElement || []).map(d => d.data).find(d => d.name === 'E2E identity proof');
    ok(!!ndata, 'new data element persisted on save');
    let proc = await getProc(newPid);
    const vstep = flat(proc.tobe).find(s => s.title === 'Verify identity');
    ok(vstep && vstep.data.includes(ndata.id) && vstep.data.length === 2, 'step data updated (2 elements)');
    ok(vstep && vstep.subs.length === 1 && vstep.subs[0].title === 'Check ID document', 'sub-step saved');
    ok(vstep && vstep.sla === '2 business days' && vstep.system === 'ERP' && vstep.durationHrs === 4, 'SLA/system/duration saved');
    const dec = proc.tobe.find(n => n.type === 'decision');
    ok(dec && dec.branches[1].goto === vstep.id, 'decision branch goto saved');

    /* BPMN of the authored to-be (decision + loop + parallel) */
    const authoredXml = await exportBpmn('authored-tobe');
    const authoredNodes = JSON.parse(JSON.stringify(proc.tobe));
    bpmnCheck(authoredXml, proc.tobe, 'authored to-be');
    ok(new RegExp(`sourceRef="N_${dec.id}" targetRef="N_${vstep.id}" name="Needs more info"`).test(authoredXml), 'BPMN: loop-back is a named sequence flow back to the step');
    ok(/<bpmn:documentation>Owner: [^<]+Data: [^<]+System: ERP\. SLA: 2 business days/.test(authoredXml), 'BPMN: task documentation carries data and system');

    /* move: step down below the decision */
    await saving(() => page.click('.node:has-text("Verify identity") [data-ed="down"]'));
    proc = await getProc(newPid);
    ok(proc.tobe[1].type === 'decision' && proc.tobe[2].title === 'Verify identity', 'moved step below the decision');

    /* delete asks first: cancel keeps the step, confirm deletes it */
    await page.click('.node:has-text("Manager approval") [data-ed="del"]');
    ok(/Delete 'Manager approval'/.test(await page.textContent('.overlay .mb')), 'delete asks for confirmation');
    await act('cancel'); await page.waitForTimeout(300);
    ok((await titles()).includes('Manager approval'), 'cancelled delete keeps the step');
    await iconCheck('edit to-be');
    await page.click('.node:has-text("Manager approval") [data-ed="del"]');
    await saving(() => act('yes'));
    ok(!(await titles()).includes('Manager approval'), 'deleted step inside branch');
    await shot('process-edit-gateways');
    await nav(`/process/${newPid}?mode=lanes`);
    ok((await page.$$('.d-lane-gw')).length === 2, 'authored swimlanes show decision and parallel rows');
    await shot('process-lanes-authored');
    await nav(`/process/${newPid}?mode=edit`);

    /* header edit */
    await page.fill('input[data-meta=name]', 'E2E Purchase Request v2');
    await saving(() => page.press('input[data-meta=name]', 'Tab'));
    /* removing a resource asks first */
    await page.click('[data-res-del] >> nth=0');
    ok(await page.isVisible('.overlay:has-text("Remove resource?")'), 'removing a resource asks for confirmation');
    await saving(() => act('yes'));
    ok(((await getProc(newPid)).resources || []).length === 0, 'resource removed after confirmation');

    /* Today: add a step, start Future again from Today (Advanced), then remove the copy so What changed shows a ghost */
    await page.click('.d-modes [data-mode="asis"]');
    await page.waitForURL(/v=asis/); await page.waitForSelector('[data-addstep]');
    await page.click('[data-addstep]'); await page.waitForSelector('.overlay #d-f-title');
    await page.fill('.overlay input[name=title]', 'Check ID by hand');
    await saving(() => act('save'));
    await page.click('.d-modes [data-mode="tobe"]'); await page.waitForURL(/v=tobe/);
    await page.click('[data-fork]');
    await saving(() => act('yes'));
    await page.waitForURL(/v=tobe/); await page.waitForSelector('[data-addstep]');
    proc = await getProc(newPid);
    const forked = flat(proc.tobe);
    ok(forked.length === 1 && forked[0].title === 'Check ID by hand' && forked[0].from === flat(proc.asis)[0].id && forked[0].id !== flat(proc.asis)[0].id, 'fork copied as-is with fresh ids and from links');
    await page.click('.node:has-text("Check ID by hand") [data-ed="del"]');
    await saving(() => act('yes'));
    await page.click('[data-addstep]'); await page.waitForSelector('.overlay #d-f-title');
    await page.fill('.overlay input[name=title]', 'Automated ID check');
    await page.fill('.overlay input[name=sla]', '1 business day');
    await page.fill('.overlay input[name=system]', 'Approvals');
    await saving(() => act('save'));

    console.log('# reload persistence + diff ghosts + history');
    await nav(`/process/${newPid}?mode=diff`);
    ok(await page.isVisible('h1:has-text("E2E Purchase Request v2")'), 'renamed process persisted after reload');
    ok(await page.isVisible('#canvas .node:has-text("Automated ID check") .chip.diff-new'), 'diff: new step badged NEW');
    ok(await page.isVisible('#canvas .ghost:has-text("Check ID by hand")'), 'diff: removed as-is step shown as ghost');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    const hist = await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent));
    ok(hist.some(h => /Added step 'Verify identity' to Future/.test(h)), 'history shows "Added step \'Verify identity\' to Future"');
    ok(hist.some(h => /Added “at the same time” 'Set up vendor'/.test(h)), 'history shows "at the same time"');
    ok(hist.some(h => /Started Future again from Today/.test(h)), 'history shows "Started Future again from Today"');

    console.log('# step page shows SLA/system');
    const aid = flat((await getProc(newPid)).tobe).find(s => s.title === 'Automated ID check').id;
    await nav(`/process/${newPid}/step/${aid}`);
    ok(await page.isVisible('.d-opschip:has-text("1 business day")') && await page.isVisible('.d-opschip:has-text("Approvals")'), 'step page shows SLA and system');

    console.log('# comment with @mention');
    await nav(`/process/${newPid}?mode=tobe`);
    const other = st.people.find(p => p.id !== me) || st.people[0];
    const first = other.name.split(' ')[0];
    await page.fill('[data-comments] textarea', `@${first} please review the new ID check`);
    await saving(() => page.click('[data-comments] [data-post]'));
    await page.waitForSelector(`.cmt:has-text("please review the new ID check")`);
    await page.waitForTimeout(800);
    ok(((await state()).docs.notification || []).some(n => n.data.to === other.id && /mentioned you/.test(n.data.text)), `mention notified ${first}`);

    console.log('# data page: spec editor, sensitivity, rules de-dup, discovered resolve, permissions');
    const did = ndata.id;
    ok(ndata.owner === me, 'inline element is owned by the step owner (current persona)');
    ok(await putDoc('dataElement', did, Object.assign({}, ndata, { discovered: [{ text: 'Document numbers can carry a check letter', fromRun: 'TR1', at: new Date().toISOString() }] }), 'Test fixture: discovered requirement') === 200, 'fixture: discovered requirement stored');
    await nav(`/data/${did}`);
    console.log('# R4: plain-language spec builder (no regex needed)');
    await page.click('[data-fadd]');
    await page.waitForSelector('.overlay .d-fmts');
    const fmtNames = (await page.$$eval('.overlay .d-fmts .d-fmt', ls => ls.map(l => l.textContent.trim()))).join(',');
    ok(fmtNames === 'Digits,Letters,Text,Date,Money,Email,Phone,List', 'format choices: digits / letters / text / date / money / email / phone / list (' + fmtNames + ')');
    ok(!(await page.$eval('.overlay details[data-adv]', d => d.open)), 'regex sits under a collapsed "Advanced"');
    ok(!(await page.isVisible('.overlay input[name=pattern]')), 'pattern input hidden until Advanced is opened');
    await page.fill('.overlay input[name=name]', 'Document number');
    await page.check('.overlay input[name=fmt][value=digits]');
    await page.check('.overlay input[name=lenMode][value=exact]');
    /* validation keeps the dialog input: exact length left empty */
    await act('save');
    await page.waitForSelector('.overlay .d-err');
    ok(/whole number/.test(await page.textContent('.overlay .d-err')) && await page.inputValue('.overlay input[name=name]') === 'Document number' && await page.isChecked('.overlay input[name=fmt][value=digits]'), 'validation error keeps the typed name and chosen format');
    await page.fill('.overlay input[name=len]', '9');
    await page.check('.overlay input[name=required]');
    ok(/9 digits · required/.test(await page.textContent('.overlay [data-specsum]')), 'builder reads back in plain words: ' + (await page.textContent('.overlay [data-specsum]')).trim());
    await page.click('.overlay details[data-adv] summary');
    ok(await page.inputValue('.overlay input[name=pattern]') === '^\\d{9}$', 'Advanced shows the generated pattern ^\\d{9}$');
    await page.screenshot({ path: `${OUT}/spec-builder.png` });
    await saving(() => act('save'));
    let sf0 = (await getData(did)).fields[0];
    ok(sf0 && sf0.type === 'digits' && sf0.length === 9 && sf0.pattern === '^\\d{9}$' && sf0.required === true && sf0.format === '9 digits', 'generated type digits, length 9, pattern, required, format "9 digits"');
    /* edit: change to letters between 2 and 3, must match another field (added next) */
    await page.click('[data-fadd]');
    await page.fill('.overlay input[name=name]', 'Issuing country');
    await page.check('.overlay input[name=fmt][value=letters]');
    await page.check('.overlay input[name=lenMode][value=range]');
    await page.fill('.overlay input[name=lenMin]', '2'); await page.fill('.overlay input[name=lenMax]', '3');
    await saving(() => act('save'));
    let sf1 = (await getData(did)).fields[1];
    ok(sf1 && sf1.type === 'text' && sf1.min === 2 && sf1.max === 3 && sf1.pattern === '^[A-Za-z]{2,3}$' && sf1.length == null, 'letters 2–3: type text, min 2, max 3, pattern ^[A-Za-z]{2,3}$');
    await page.click('[data-fadd]');
    await page.fill('.overlay input[name=name]', 'Holder name on ID');
    await page.check('.overlay input[name=fmt][value=text]');
    await page.selectOption('.overlay select[name=matches]', 'Issuing country');
    ok(await page.$$eval('.overlay select[name=matches] option', os => os.map(o => o.value).join('|')) === '|Document number|Issuing country', '"must match another field" lists the other fields');
    await saving(() => act('save'));
    const sf2 = (await getData(did)).fields[2];
    ok(sf2 && sf2.matches === 'Issuing country' && /Must match Issuing country/.test(sf2.rule) && sf2.type === 'text' && !sf2.pattern, 'must-match rule saved as plain words; text needs no pattern');
    await page.click('[data-fadd]');
    await page.fill('.overlay input[name=name]', 'Account type');
    await page.check('.overlay input[name=fmt][value=list]');
    ok(await page.isVisible('.overlay input[name=values]') && !(await page.isVisible('.overlay input[name=len]')), 'list shows allowed values, hides length');
    await page.fill('.overlay input[name=values]', 'Checking, Savings, Checking');
    await saving(() => act('save'));
    const sf3 = (await getData(did)).fields[3];
    ok(sf3 && sf3.type === 'list' && JSON.stringify(sf3.values) === '["Checking","Savings"]', 'list values saved (de-duplicated)');
    await page.click('[data-fadd]');
    await page.fill('.overlay input[name=name]', 'Payment limit');
    await page.check('.overlay input[name=fmt][value=money]');
    await page.fill('.overlay input[name=amtMin]', '0'); await page.fill('.overlay input[name=amtMax]', '25000');
    await saving(() => act('save'));
    const sf4 = (await getData(did)).fields[4];
    ok(sf4 && sf4.type === 'currency' && sf4.min === 0 && sf4.max === 25000 && !!sf4.pattern, 'money: type currency, min 0, max 25000, pattern generated');
    ok(/\$0 – \$25,000/.test(await page.textContent('.d-spec tr:nth-child(6) [data-fsum]')), 'spec table shows "Money amount · $0 – $25,000"');
    /* edit the first field: reopens in the builder with its choices; a hand-written Advanced pattern is kept */
    await page.click('[data-fedit="0"]');
    ok(await page.isChecked('.overlay input[name=fmt][value=digits]') && await page.isChecked('.overlay input[name=lenMode][value=exact]') && await page.inputValue('.overlay input[name=len]') === '9', 'edit reopens with digits, exactly 9');
    await page.click('.overlay details[data-adv] summary');
    await page.fill('.overlay input[name=pattern]', '^\\d{9}[A-Z]?$');
    await page.check('.overlay input[name=lenMode][value=any]');
    ok(await page.inputValue('.overlay input[name=pattern]') === '^\\d{9}[A-Z]?$', 'hand-edited pattern is not overwritten by later choices');
    await saving(() => act('save'));
    sf0 = (await getData(did)).fields[0];
    ok(sf0.pattern === '^\\d{9}[A-Z]?$' && sf0.patternCustom === true && sf0.length == null, 'custom Advanced pattern saved');
    /* engine generates tests from the builder output */
    const gen = ENG.generateTests(await getData(did));
    ok(['Document number', 'Issuing country', 'Holder name on ID', 'Account type', 'Payment limit'].every(n => gen.some(t => t.field === n)), `engine generates tests for every builder field (${gen.length})`);
    /* clean up to one field for the rest of the flow */
    for (let i = 4; i >= 1; i--) { await page.click(`[data-fdel="${i}"]`); await saving(() => act('yes')); }
    await page.click('[data-fedit="0"]');
    await page.click('.overlay details[data-adv] summary');
    await page.click('.overlay [data-advreset]');
    await page.check('.overlay input[name=lenMode][value=exact]');
    await page.fill('.overlay input[name=len]', '9');
    ok(await page.inputValue('.overlay input[name=pattern]') === '^\\d{9}$', '"Use the generated pattern" returns to the builder');
    await saving(() => act('save'));
    await page.click('[data-dedit]');
    await page.selectOption('.overlay select[name=avail]', 'example');
    await page.selectOption('.overlay select[name=sensitivity]', 'pii');
    await page.fill('.overlay input[name=source]', 'Vendor portal upload');
    await saving(() => act('save'));
    /* rename to a duplicate is refused */
    await page.click('[data-dedit]');
    await page.fill('.overlay input[name=name]', existing.toLowerCase());
    await act('save');
    await page.waitForSelector('.overlay .d-err');
    ok(/already exists/.test(await page.textContent('.overlay .d-err')), 'data page blocks duplicate rename');
    await act('cancel');
    await page.click('[data-resolve="0"]');
    await page.fill('.overlay textarea[name=note]', 'Pattern now allows a trailing check letter');
    await saving(() => act('save'));
    await nav(`/data/${did}`);
    const specRows = await page.$$eval('.d-spec tr', rs => rs.slice(1).map(r => r.textContent));
    ok(specRows.length === 1 && /Document number/.test(specRows[0]) && /9 digits/.test(specRows[0]), 'spec field add/edit/delete persisted');
    const rules = await page.textContent('.d-spec .d-rule');
    ok((rules.match(/Required/g) || []).length === 1, 'rules column de-duplicated: ' + rules.trim());
    ok(await page.isVisible('.hdr .chip:has-text("Sample only")'), 'availability edit persisted ("Sample only")');
    ok(await page.isVisible('.hdr .d-sens:has-text("Personal details")'), 'sensitivity badge shows "Personal details" (PII in the tooltip)');
    ok(await page.isVisible('.d-resolved .d-resnote:has-text("Pattern now allows")'), 'discovered requirement resolved with note');
    ok(((await getData(did)).discovered[0].resolved || {}).by === me, 'resolved saved with author');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    ok((await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent))).some(t => /sensitivity not set → Personal details/.test(t)), 'data history shows sensitivity change');
    await shot('data-new'); await overflow('data @1440');
    /* R7 hide, don't grey: another persona does not see the owner-only controls at all */
    await setPersona(other.id);
    await page.waitForSelector('[data-dedit]', { state: 'detached' });
    ok(!(await page.$('[data-fadd]')) && !(await page.$('[data-fedit]')) && !(await page.$('[data-dedit]')) && !(await page.$('[data-resolve]')), 'R7: non-owner: edit, rule and fix controls are hidden, not greyed');
    ok(await page.isVisible(`.d-only:has-text("Only ${meName} (the owner) can change this")`), 'non-owner sees "Only <owner> (the owner) can change this"');
    await shot('data-nonowner');
    await setPersona(me);
    await page.waitForSelector('[data-dedit]');

    const seedData = (st.docs.dataElement || []).map(d => d.data).find(d => d.avail === 'missing') || st.docs.dataElement[0].data;
    await nav(`/data/${seedData.id}`);
    ok(await page.isVisible('text=Steps that use it'), 'seed data page renders "Steps that use it"');
    await shot('data-seed'); await overflow('data seed @1440');

    console.log('# new data element from the process panel (duplicate blocked, then created)');
    await nav(`/process/${pid}?mode=tobe`);
    await page.click('[data-newdata]');
    await page.fill('.overlay input[name=name]', ' ' + existing.toUpperCase() + ' ');
    await act('save');
    await page.waitForSelector('.overlay .d-err');
    ok(/already exists/.test(await page.textContent('.overlay .d-err')), 'panel modal blocks a duplicate name');
    await page.fill('.overlay input[name=name]', 'E2E panel element');
    await page.fill('.overlay input[name=source]', 'Spreadsheet');
    await saving(() => act('save'));
    ok(((await state()).docs.dataElement || []).filter(d => d.data.name === 'E2E panel element').length === 1, 'panel modal created data element once');


    console.log('# R3: BPMN import round trip (seed to-be), from the process index (creates new processes)');
    await nav(`/process/${pid}?mode=tobe`);
    ok(!!(await page.$('[data-more] label.d-import:has-text("Import diagram file") [data-bpmn-file]')), 'R7: "⋯ More" offers "Import diagram file" (a new version)');
    await nav('/processes');
    ok(await page.isVisible('label.d-import:has-text("Import BPMN")'), 'process index offers Import BPMN (new process)');
    const impPid = await importFile(`${OUT}/seed-tobe.bpmn`);
    const imp = await getProc(impPid);
    const cs = countNodes(seedP.tobe), ci = countNodes(imp.asis);
    ok(cs.steps === ci.steps && cs.decisions === ci.decisions && cs.parallels === ci.parallels, `round trip: steps ${ci.steps}/${cs.steps}, decisions ${ci.decisions}/${cs.decisions}, parallel ${ci.parallels}/${cs.parallels}`);
    ok(JSON.stringify(flat(imp.asis).map(n => n.title)) === JSON.stringify(flat(seedP.tobe).map(n => n.title)), 'round trip: step titles in the same order');
    ok(JSON.stringify(flat(imp.asis).map(n => n.owner)) === JSON.stringify(flat(seedP.tobe).map(n => n.owner)), 'round trip: lanes mapped back to the same owners');
    const gotoN = ns => allNodes(ns).filter(isGw).flatMap(g => g.branches).filter(b => b.goto).length;
    ok(gotoN(imp.asis) === gotoN(seedP.tobe), `round trip: loop-backs preserved (${gotoN(imp.asis)})`);
    ok(JSON.stringify(countNodes(imp.tobe)) === JSON.stringify(ci) && flat(imp.tobe).every(n => flat(imp.asis).some(a => a.id === n.from)), 'imported to-be is a forked copy linked to the as-is');
    ok(imp.name === seedP.name && imp.owner === me, `imported process named '${imp.name}', owned by the current persona`);
    ok(/mode=edit/.test(page.url()) && await page.isVisible('.d-editbar'), 'import lands in edit mode');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    ok((await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent))).some(t => /Imported process .+ from BPMN/.test(t)), 'history shows the import');
    await shot('process-imported');

    console.log('# R3: BPMN import round trip (authored: decision + loop-back + parallel)');
    await nav('/processes');
    const impPid2 = await importFile(`${OUT}/authored-tobe.bpmn`);
    const imp2 = await getProc(impPid2);
    const ca = countNodes(authoredNodes), ci2 = countNodes(imp2.asis);
    ok(ca.steps === ci2.steps && ca.decisions === ci2.decisions && ca.parallels === ci2.parallels, `authored round trip: steps ${ci2.steps}/${ca.steps}, decisions ${ci2.decisions}/${ca.decisions}, parallel ${ci2.parallels}/${ca.parallels}`);
    const lp = allNodes(imp2.asis).filter(isGw).flatMap(g => g.branches).find(b => b.goto);
    ok(lp && lp.label === 'Needs more info' && flat(imp2.asis).find(n => n.id === lp.goto).title === 'Verify identity', 'authored round trip: loop-back branch points at "Verify identity"');
    const vi = flat(imp2.asis).find(n => n.title === 'Verify identity');
    ok(vi && vi.system === 'ERP' && vi.sla === '2 business days', 'authored round trip: system and SLA read back from the task documentation');

    console.log('# R3: BPMN import from /new (foreign file, default namespace, unknown lane)');
    const other1 = st.people.find(p => p.id !== me);
    const foreign = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="urn:northwind">
  <process id="P1" name="Northwind returns" isExecutable="false">
    <laneSet id="LS"><lane id="L1" name="Pat Nobody"><flowNodeRef>S</flowNodeRef><flowNodeRef>T1</flowNodeRef><flowNodeRef>G</flowNodeRef><flowNodeRef>T3</flowNodeRef><flowNodeRef>E</flowNodeRef></lane>
      <lane id="L2" name="${other1.name}"><flowNodeRef>T2</flowNodeRef></lane></laneSet>
    <startEvent id="S" name="Return requested" /><task id="T1" name="Log the return" /><exclusiveGateway id="G" name="Item damaged?" />
    <userTask id="T2" name="Inspect item" /><serviceTask id="T3" name="Restock" /><endEvent id="E" name="Return closed" />
    <sequenceFlow id="F1" sourceRef="S" targetRef="T1" /><sequenceFlow id="F2" sourceRef="T1" targetRef="G" />
    <sequenceFlow id="F3" sourceRef="G" targetRef="T2" name="Yes" /><sequenceFlow id="F4" sourceRef="G" targetRef="T3" name="No" />
    <sequenceFlow id="F5" sourceRef="T2" targetRef="E" /><sequenceFlow id="F6" sourceRef="T3" targetRef="E" />
  </process>
</definitions>`;
    fs.writeFileSync(`${OUT}/foreign.bpmn`, foreign);
    fs.writeFileSync(`${OUT}/broken.bpmn`, '<definitions><process id="x"><task id="a"></definitions>');
    await nav('/new');
    await page.waitForSelector('.overlay [data-act="import"]');
    const [fc0] = await Promise.all([page.waitForEvent('filechooser'), act('import')]);
    await fc0.setFiles(`${OUT}/broken.bpmn`);
    await page.waitForSelector('.overlay:has-text("Could not import BPMN")');
    ok(/not well-formed XML/.test(await page.textContent('.overlay .mb')), 'broken file: clear error, nothing created');
    await act('cancel');
    ok(!(await page.$('.overlay')), 'create modal does not re-open after choosing import');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('label.d-import')]);
    const wf = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/doc/process/'));
    await fc.setFiles(`${OUT}/foreign.bpmn`); await wf; await page.waitForURL(/mode=edit/); await settle();
    const imp3 = await getProc(page.url().match(/process\/([\w-]+)/)[1]);
    const f3 = flat(imp3.asis);
    ok(imp3.name === 'Northwind returns' && f3.map(n => n.title).join('|') === 'Log the return|Inspect item|Restock', 'foreign BPMN: tasks became steps in order');
    ok(imp3.asis[0].type === 'trigger' && imp3.asis[0].title === 'Return requested' && imp3.asis[imp3.asis.length - 1].type === 'end', 'foreign BPMN: start event -> trigger, end event -> end');
    const g3 = imp3.asis.find(isGw);
    ok(g3 && g3.type === 'decision' && g3.branches.map(b => b.label).join('|') === 'Yes|No', 'foreign BPMN: exclusive gateway -> decision with Yes/No branches');
    ok(f3[0].owner === me && f3[1].owner === other1.id, 'foreign BPMN: lane names match people; unknown lane -> current persona');
    await shot('process-imported-foreign'); await overflow('imported process edit @1440');

    console.log('# R3: start a project from this to-be');
    await nav(`/process/${impPid}?mode=tobe`);
    /* R9 §4: no change between Today and Future -> the button is disabled with the hint */
    {
      const ip0 = await getProc(impPid); const d0 = ENG.diffSummary(ip0);
      if (!d0.new && !d0.changed && !d0.removed) {
        ok(await page.isDisabled('[data-start-project]') && (await page.textContent('[data-start-hint]')).trim() === 'Change a Future step first', 'R9 §4: "Start a project from this Future" is disabled with "Change a Future step first" when nothing changed');
        const ip1 = JSON.parse(JSON.stringify(ip0)); flat(ip1.tobe)[0].title += ' (checked twice)';
        ok(await putDoc('process', impPid, ip1, 'E2E: change a Future step') === 200, 'fixture: one Future step changed');
        await nav(`/process/${impPid}?mode=tobe`);
      }
      ok(!(await page.isDisabled('[data-start-project]')) && !/Change a Future step first/.test(await page.textContent('[data-start-hint]')), 'R9 §4: with a Future change, the button is enabled');
    }
    /* R7: the shared "New project" form (name, which process, deadline; roles under More options) */
    await page.click('[data-start-project]');
    await page.waitForSelector('.overlay input[name=target]');
    ok(await page.inputValue('.overlay [name=from]') === impPid && /rollout/.test(await page.inputValue('.overlay input[name=name]')), 'R7: start project prefills the process and a name');
    await page.fill('.overlay input[name=name]', '');
    await act('create');
    await page.waitForSelector('.overlay .banner');
    ok(/name/.test(await page.textContent('.overlay .banner')), 'start project: name required');
    const tgt = new Date(st.today + 'T12:00:00'); tgt.setDate(tgt.getDate() + 45); const target = tgt.toISOString().slice(0, 10);
    await page.fill('.overlay input[name=name]', 'E2E Northwind rollout');
    await page.fill('.overlay input[name=target]', target);
    ok(await page.inputValue('.overlay select[name=owner]') === me, 'R7: project manager defaults to you (More options)');
    await page.selectOption('.overlay select[name=releaseManager]', other1.id);
    await page.screenshot({ path: `${OUT}/start-project-modal.png` });
    await saving(() => act('create'));
    await page.waitForURL(/\/project\/[\w-]+$/);
    const prjId = page.url().match(/project\/([\w-]+)/)[1];
    const prj = ((await state()).docs.project || []).find(d => d.id === prjId);
    ok(!!prj, 'project created and navigated to /project/' + prjId);
    if (prj) {
      const d = prj.data;
      ok(d.name === 'E2E Northwind rollout' && d.owner === me && d.target === target && d.status === 'active' && JSON.stringify(d.processes) === JSON.stringify([impPid]) && Array.isArray(d.baselines) && !d.baselines.length && Array.isArray(d.resources) && 'desc' in d,
        'project doc: name, owner = persona, target, processes = [pid], status active, baselines []');
      ok(d.releaseManager === other1.id, 'R5: project releaseManager saved');
    }
    const pev = await page.evaluate(async id => (await (await fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/events?ref=project:${id}`)).json()).events || [], prjId);
    ok(pev.some(e => /E2E Northwind rollout/.test(e.summary)), 'project creation event is in history');
    await nav(`/process/${impPid}?mode=tobe`);
    ok(await page.isVisible('.side .row:has-text("E2E Northwind rollout")'), 'process side panel lists the new project');

    console.log('# R3: data page — effective state, resolution plan, plain-language profile');
    const mkData = async (name, avail) => { const id = 'de-e2e-' + Math.random().toString(36).slice(2, 8); ok(await putDoc('dataElement', id, { id, name, owner: me, source: '', avail, note: '', fields: [], samples: [], discovered: [] }, 'Test fixture: ' + name) === 200, 'fixture: ' + name); return id; };
    const exId = await mkData('E2E examples-only feed', 'example');
    const msId = await mkData('E2E missing feed', 'missing');
    await nav(`/data/${exId}`);
    ok(await page.isVisible('[data-resolution="example"] .d-b-amber:has-text("Needs to be connected before launch")'), 'sample-only information: amber "Needs to be connected before launch"');
    ok(/No fix planned/.test(await page.textContent('[data-noplan]')), 'sample-only information without a fix: "No fix planned"');
    await shot('data-examples-only');
    await nav(`/data/${msId}`);
    ok(await page.isVisible('[data-resolution="missing"] [data-noplan]') && await page.isVisible('.hdr [data-eff="missing"]'), 'not-available information: red "No fix planned"');
    const wid = 'wi-e2e-' + Math.random().toString(36).slice(2, 8);
    ok(await putDoc('workItem', wid, { id: wid, projectId: prjId, pid: impPid, step: flat(imp.tobe)[0].id, title: 'Connect the E2E feed', owner: other.id /* R8: a fix finished by the owner counts as their confirmation */, status: 'done', start: st.today, due: st.today, doneAt: st.today, deps: [], resolves: msId, kind: 'access' }, 'Test fixture: resolver done') === 200, 'fixture: done resolver');
    await nav(`/data/${msId}`);
    console.log('# R4: pending until the data owner confirms live');
    ok(ENG.effectiveAvail((await state()).docs, msId) === 'pending', 'engine: resolver done -> pending');
    ok(await page.isVisible('.hdr [data-eff="pending"]:has-text("Waiting for confirmation")') && !(await page.$('[data-noplan]')), 'fix done: header shows amber "Waiting for confirmation"');
    ok(await page.isVisible(`[data-resolution="pending"] .d-b-amber:has-text("Waiting for ${meName} to confirm")`), `fix card: "Waiting for ${meName} to confirm"`);
    ok(await page.isVisible('[data-confirm-card] [data-confirm-live]'), 'owner sees "Confirm it’s connected"');
    /* the pending element on a map step: card, step page, side panel, index */
    const ip = await getProc(impPid); const pstep = flat(ip.tobe)[0]; pstep.data = [...new Set([...(pstep.data || []), msId])];
    ok(await putDoc('process', impPid, ip, 'Test fixture: tag pending data') === 200, 'fixture: step uses the pending element');
    await nav(`/process/${impPid}?mode=tobe`);
    ok(/1 waiting for confirmation/.test(await page.textContent(`#canvas .node[data-step="${pstep.id}"] .d-pend`)), 'map card: amber "1 waiting for confirmation"');
    ok(await page.isVisible('[data-pend-steps]:has-text("Waiting for confirmation")'), 'process panel: waiting section');
    ok(await page.isVisible(`[data-hl="${msId}"] .r a:has-text("Waiting for confirmation")`), 'process panel information row: Waiting for confirmation');
    await shot('process-pending');
    await nav(`/process/${impPid}/step/${pstep.id}`);
    ok(await page.isVisible(`.d-pend-s:has-text("Waiting for ${meName} to confirm")`) && await page.isVisible('[data-eff="pending"]:has-text("Waiting for confirmation")'), 'step page: waiting chip and "Waiting for <owner> to confirm"');
    await nav('/processes');
    const pcount = await page.getAttribute(`[data-prow="${impPid}"] [data-datacounts]`, 'data-datacounts');
    ok(pcount.split('/')[1] === '1', 'process index: 1 pending element (' + pcount + ')');
    /* non-owner cannot confirm */
    await nav(`/data/${msId}`);
    await setPersona(other.id);
    await page.waitForSelector(`.d-only:has-text("Only ${meName} (the owner) can confirm")`);
    ok(!(await page.$('[data-confirm-live]')), 'R7: non-owner: no confirm button (hidden, not greyed), the owner is named');
    await setPersona(me);
    await page.waitForSelector('[data-confirm-live]');
    await page.click('[data-confirm-live]');
    await page.waitForSelector('.overlay [data-confprof]');
    ok(/No sample data check yet/.test(await page.textContent('.overlay [data-confprof]')), 'confirm dialog: no sample data check yet');
    console.log('# R5: confirm live needs evidence (profile / connection check / attested link + note)');
    ok(await page.$eval('.overlay input[name=ev][value=profile]', e => e.disabled), 'R5: profile evidence unavailable without a profile');
    ok(await page.isVisible('.overlay [data-evopt="attested"] .d-ev-weak:has-text("Weaker proof")'), 'R7: link-and-note option labelled "Weaker proof"');
    await page.fill('.overlay input[name=source]', '');
    await act('confirm');
    await page.waitForSelector('.overlay .d-err');
    ok(/Say where it comes from/.test(await page.textContent('.overlay .d-err')), 'confirm requires where it comes from');
    await page.fill('.overlay input[name=source]', 'Northwind ERP vendor API (read)');
    ok((await page.textContent('.overlay [data-probe-target]')).trim() === 'Northwind ERP vendor API (read)', 'R6: editing the source updates the connection check’s probe target');
    await act('confirm');
    await page.waitForSelector('.overlay .d-err');
    ok(/Choose the proof/.test(await page.textContent('.overlay .d-err')), 'R5: confirm requires proof: ' + await page.textContent('.overlay .d-err'));
    /* (b) a connection check that fails (the element is still marked missing) cannot be evidence */
    const ck1 = page.waitForResponse(r => r.url().includes('/check/') && r.request().method() === 'POST');
    await page.click('.overlay [data-run-check]'); const ckr = await ck1; ok(ckr.ok(), 'R5: connection check endpoint answered ' + ckr.status());
    /* Lead: the element's fix is done, so the simulated in-tenant probe reaches the built integration and passes. */
    await page.waitForSelector('.overlay [data-check-result].pass');
    ok(/reached/i.test(await page.textContent('.overlay [data-check-result]')), 'R5: passing check shown in the dialog once the fix is done: ' + (await page.textContent('.overlay [data-check-result]')).slice(0, 80));
    /* (c) attested: link and note both required */
    await page.check('.overlay input[name=ev][value=attested]');
    await page.fill('.overlay input[name=evlink]', 'not a link');
    await act('confirm');
    await page.waitForSelector('.overlay .d-err:has-text("https://")');
    ok(true, 'R5: attested evidence needs a real link');
    await page.fill('.overlay input[name=evlink]', 'https://wiki.northwind.example/integrations/erp-vendor-read');
    await act('confirm');
    await page.waitForSelector('.overlay .d-err:has-text("note")');
    ok(true, 'R5: attested evidence needs a note');
    await page.fill('.overlay input[name=evnote]', 'Integration test run signed off by IT');
    await page.screenshot({ path: `${OUT}/confirm-live.png` });
    await saving(() => act('confirm'));
    const conf = await getData(msId);
    ok(conf.avail === 'live' && conf.liveConfirmedBy === me && conf.liveSource === 'Northwind ERP vendor API (read)' && !!conf.liveConfirmedAt, 'confirm sets avail live, liveConfirmedBy, liveConfirmedAt, liveSource');
    ok(conf.liveEvidence && conf.liveEvidence.type === 'attested' && conf.liveEvidence.ref === 'https://wiki.northwind.example/integrations/erp-vendor-read' && conf.liveEvidence.by === me && !!conf.liveEvidence.at, 'R5: liveEvidence {type: attested, ref, at, by} stored');
    ok(ENG.effectiveAvail((await state()).docs, msId) === 'live', 'engine: confirmed element is live');
    await nav(`/data/${msId}`);
    ok(await page.isVisible('.hdr [data-eff="live"]') && await page.isVisible(`[data-confirmed]:has-text("Confirmed connected by ${meName}")`) && !(await page.$('[data-confirm-card]')), 'after reload: connected, "Confirmed connected by <owner>", no confirm card');
    ok(await page.isVisible('.hdr [data-evidence="attested"]:has-text("Link and note (weaker)")'), 'R5: data page shows the proof type (link and note, weaker)');
    ok(conf.source === 'Northwind ERP vendor API (read)' && await page.isVisible('.hdr .res .chip:has-text("Northwind ERP vendor API (read)")'), 'R6: the confirmed source becomes the element source shown in the header');
    await shot('data-attested');
    await nav(`/process/${impPid}?mode=tobe`);
    ok(await page.isVisible(`[data-hl="${msId}"] [data-evidence="attested"]`), 'R5: process panel shows the evidence type');
    /* (b) a passing connection check on an examples-only element */
    const ckId = await mkData('E2E check feed', 'example');
    await nav(`/data/${ckId}`);
    await page.click('[data-confirm-live]'); await page.waitForSelector('.overlay [data-run-check]');
    await page.fill('.overlay input[name=source]', 'Northwind document store (read)');
    const ck2 = page.waitForResponse(r => r.url().includes('/check/'));
    await page.click('.overlay [data-run-check]'); await ck2;
    await page.waitForSelector('.overlay [data-check-result].pass');
    ok(/Passed/.test(await page.textContent('.overlay [data-check-result]')), 'R5: connection check passes once a source is recorded');
    await saving(() => act('confirm'));
    const confC = await getData(ckId);
    ok(confC.liveEvidence && confC.liveEvidence.type === 'check' && confC.check && confC.check.ok, 'R5: liveEvidence type check, with the stored check');
    ok(ENG.effectiveAvail((await state()).docs, ckId) === 'live', 'engine: checked element is live');
    await nav(`/data/${ckId}`);
    ok(await page.isVisible('.hdr [data-evidence="check"]:has-text("Connection check")'), 'R5: data page shows "Connection check" evidence');
    await nav(`/data/${msId}`);
    ok(await page.isVisible('.d-resolve .badge.b-done:has-text("Done")'), 'fix card shows Done');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    ok((await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent))).some(t => /Confirmed 'E2E missing feed' is connected \(from: Northwind ERP vendor API/.test(t)), 'history shows the confirmation');
    await page.click('[data-dedit]');
    ok(await page.$$eval('.overlay select[name=avail] option', os => os.map(o => o.textContent).join('|')) === 'We have it (connected)|Sample only|Not available yet', 'R8: Advanced edit dialog offers the detailed states');
    await act('cancel');
    const prof = (st.docs.dataElement || []).map(d => d.data).find(d => d.sampleCsv && (d.fields || []).length);
    ok(!!prof, 'seed has a data element with a sample extract');
    if (prof) {
      const pr = await page.evaluate(async ([id, csv]) => (await fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/profile/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv, actor: 'x' }) })).status, [prof.id, prof.sampleCsv]);
      ok(pr === 200, 'profiled the seed extract ' + pr);
      await nav(`/data/${prof.id}`);
      const ptxt = await page.textContent('.d-prof');
      ok((await page.$$('.d-pat')).length > 0 && !/\{\d+\}/.test(ptxt), 'profile patterns are plain language (no raw shape codes)');
      const card = await page.$eval('.d-prof', t => t.closest('.card').textContent);
      ok(!/undefined|missing-column|required-nulls|length-mismatch|non-digit|unexpected-specials|type-mismatch|out-of-range|pattern-mismatch|\{\d+\}/.test(card), 'spec drift messages are plain English');
      await shot('data-profile'); await overflow('data profile @1440'); await iconCheck('data page');
      const profD = await getData(prof.id);
      if (ENG.effectiveAvail((await state()).docs, prof.id) !== 'live') {
        await setPersona(profD.owner);
        await page.waitForSelector('[data-confirm-live]');
        await page.click('[data-confirm-live]');
        await page.waitForSelector('.overlay [data-confprof]');
        ok(/Latest check · 40 rows/.test(await page.textContent('.overlay [data-confprof]')), 'confirm dialog shows the latest profile summary: ' + (await page.textContent('.overlay [data-confprof]')).trim().slice(0, 70));
        const blk = ENG.specDrift(profD, (await state()).docs.profile.map(d => d.data).filter(x => x.dataId === prof.id).sort((a, b) => b.at.localeCompare(a.at))[0]).filter(d => d.issue !== 'unspecified-column').length;
        const shownBlk = await page.getAttribute('.overlay [data-blocking]', 'data-blocking').catch(() => null);
        ok(String(blk) === String(shownBlk === null ? 0 : shownBlk), `R5: dialog shows ${blk} blocking drift issue(s)`);
        ok(await page.$eval('.overlay input[name=ev][value=profile]', e => e.disabled) === blk > 0, 'R5: profile evidence blocked exactly when there are blocking issues');
        await page.screenshot({ path: `${OUT}/confirm-live-profile.png` });
        await act('cancel');
        await setPersona(me);
      } else ok(true, 'profiled element is already live (confirm dialog profile check skipped)');
    }
    const exStep = flat(seedP.tobe).find(n => (n.data || []).some(d => ENG.effectiveAvail(D0(), d) === 'example'));
    if (exStep) { await nav(`/process/${pid}/step/${exStep.id}`); ok(await page.isVisible('.d-needlive-s:has-text("Needs to be connected before launch")'), 'step page: sample-only information marked amber'); await iconCheck('step page'); }

    console.log('# R5: data element step counts agree everywhere (to-be and as-is, labelled)');
    let S5 = await state();
    await nav(`/process/${pid}?mode=tobe`);
    const useIds = [...new Set(flat(seedP.tobe).flatMap(s => s.data || []))];
    let useOk = true;
    for (const d of useIds) {
      const u = ENG.usageOf(S5.docs, d);
      const here = `${u.tobeSteps.filter(x => x.pid === pid).length}/${u.asisSteps.filter(x => x.pid === pid).length}`;
      const shownUse = await page.getAttribute(`[data-hl="${d}"] [data-usage]`, 'data-usage');
      if (shownUse !== here) { useOk = false; console.log('    usage mismatch', d, shownUse, here); }
    }
    ok(useOk && useIds.length > 0, `process panel: per-element to-be/as-is counts match usageOf for ${useIds.length} elements`);
    ok(/\d+ Future · \d+ Today/.test(await page.textContent(`[data-hl="${useIds[0]}"] [data-usage]`)), 'process panel counts are labelled "Future · Today"');
    for (const d of useIds.slice(0, 3)) {
      const u = ENG.usageOf(S5.docs, d);
      await nav(`/data/${d}`);
      const k1 = (await page.textContent('[data-kpi-tobe] b')).trim(), k2 = (await page.textContent('[data-kpi-asis] b')).trim();
      const tot = await page.getAttribute('[data-impact] [data-usage-total]', 'data-usage-total');
      const rows = (await page.$$('[data-impact] tr[data-use]')).length;
      ok(k1 === String(u.tobe) && k2 === String(u.asis) && tot === `${u.tobe}/${u.asis}` && rows === u.tobe + u.asis, `data page ${d}: KPIs, impact header and rows agree with usageOf (${u.tobe} to-be, ${u.asis} as-is)`);
    }
    await shot('data-usage');

    console.log('# R5: TC labels on the data page');
    const cased = (S5.docs.testCase || []).map(x => x.data).find(c => c.dataId);
    if (cased) {
      await nav(`/data/${cased.dataId}`);
      const lbls = await page.$$eval('[data-cases] tr[data-case]', trs => trs.map(t => [t.dataset.case, t.querySelector('.d-tc').textContent.trim()]));
      ok(lbls.length > 0 && lbls.every(([id, l]) => l === ENG.caseLabel(S5.docs, id) && /^TC\d+$/.test(l)), `case ids shown as caseLabel TC<n> (${lbls.map(x => x[1]).join(', ')})`);
    } else ok(true, 'no seed test cases (TC label check skipped)');

    console.log('# R5: permissions — owner and resources edit, everyone else is read-only');
    const outsider = st.people.find(x => x.id !== seedP.owner && !(seedP.resources || []).includes(x.id));
    const ownerName = st.people.find(x => x.id === seedP.owner).name;
    ok(!!outsider, 'seed has a person outside ' + seedP.name);
    await setPersona(outsider.id);
    await nav(`/process/${pid}?mode=edit`);
    ok(await page.isVisible('[data-edit-denied]') && !(await page.$('[data-ins]')) && !(await page.$('.d-editbar')), 'non-editor opening Edit gets the read-only map, no editor controls');
    ok(await page.isVisible(`[data-readonly]:has-text("Ask ${ownerName} for edit access")`), `non-editor sees "Ask ${ownerName} for edit access"`);
    ok(!(await page.$('[data-mode="edit"]')), 'R7: no Edit button for non-editors (hidden, not greyed)');
    ok(!(await page.$('[data-save-version]')) && !(await page.$('[data-draft-restore]')) && !(await page.$('[data-bpmn-file]')), 'no Save version / Restore / Import as version for non-editors');
    await shot('process-readonly'); await iconCheck('process read-only');
    await saving(() => page.click('[data-ask-access]'));
    ok((await state()).docs.notification.some(n => n.data.to === seedP.owner && /asked for edit access/.test(n.data.text)), 'Ask for access notifies the owner');
    const nErr = errors.length;
    const put403 = await page.evaluate(async ([id, actor]) => { const st = await (await fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/state`)).json(); const p = st.docs.process.find(d => d.id === id).data;
      return (await fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/doc/process/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: Object.assign({}, p, { name: 'hijack' }), actor, summary: 'x' }) })).status; }, [pid, outsider.id]);
    ok(put403 === 403, 'server rejects a non-editor process PUT with 403');
    await setPersona(me);
    /* a 403 from the server (access removed in another session) is handled gracefully */
    const permId = 'proc-e2e-perm-' + Math.random().toString(36).slice(2, 6);
    const pn = [{ id: 'pt', type: 'trigger', title: 'Request arrives', owner: me, touches: [], data: [] }, { id: 'pa', type: 'step', title: 'First step', owner: me, data: [], touches: [], subs: [] }, { id: 'pb', type: 'step', title: 'Second step', owner: me, data: [], touches: [], subs: [] }, { id: 'pe', type: 'end', title: 'Done' }];
    ok(await putDoc('process', permId, { id: permId, name: 'E2E permission check', desc: '', owner: me, resources: [me], version: 1, asis: pn, tobe: pn.map(n => Object.assign({}, n, { id: n.id + '2', from: n.id })), released: [] }, 'Test fixture: permission process') === 200, 'fixture: permission process');
    await nav(`/process/${permId}?mode=edit`);
    ok(await page.isVisible('[data-ins]'), 'owner can edit');
    ok(await page.evaluate(async ([id, me, o]) => { const st = await (await fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/state`)).json(); const p = st.docs.process.find(d => d.id === id).data;
      return (await fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/doc/process/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: Object.assign({}, p, { owner: o, resources: [o] }), actor: me, summary: 'Handed over (other session)' }) })).status; }, [permId, me, outsider.id]) === 200, 'fixture: ownership handed over in another session');
    const w403 = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/doc/process/' + permId));
    await page.click('[data-ed="down"][data-id="pa2"]');
    ok((await w403).status() === 403, 'stale edit is refused by the server (403)');
    await page.waitForSelector('.toast');
    ok(/Ask .+ for edit access/.test(await page.textContent('.toast')), 'R5: 403 shows a plain "Ask <owner> for edit access" message: ' + (await page.textContent('.toast')));
    await page.waitForSelector('[data-edit-denied]', { timeout: 10000 });
    ok(true, 'after the 403 the page reloads as read-only');
    /* the browser logs the refused request itself as a resource error; that is not an app error */
    const extra = errors.splice(nErr).filter(e => !/status of 403/.test(e)); errors.push(...extra);

    console.log('# R5: versions — save, compare, undo');
    await nav(`/process/${impPid}?mode=tobe`);
    await tool('[data-save-version]'); await page.waitForSelector('.overlay input[name=name]');
    await act('save'); await page.waitForSelector('.overlay .d-err');
    ok(/needs a name|Give the version a name/.test(await page.textContent('.overlay .d-err')), 'Save version needs a name');
    await page.fill('.overlay input[name=name]', 'E2E baseline');
    await saving(() => act('save'));
    let ipv = await getProc(impPid);
    ok((ipv.drafts || []).length === 1 && ipv.drafts[0].name === 'E2E baseline' && ipv.drafts[0].by === me && flat(ipv.drafts[0].tobe).length === flat(ipv.tobe).length && Array.isArray(ipv.drafts[0].asis), 'draft stored {id, name, at, by, asis, tobe}');
    await nav(`/process/${impPid}?mode=tobe`);
    ok(await page.isVisible('[data-versions] [data-draft]:has-text("E2E baseline")') && /1\/10/.test(await page.textContent('[data-versions] h3')), 'Saved versions card lists it (1/10)');
    const s0 = flat(ipv.tobe)[0];
    await nav(`/process/${impPid}?mode=edit&v=tobe`);
    await page.click(`[data-ed="edit"][data-id="${s0.id}"]`); await page.waitForSelector('.overlay input[name=title]');
    await page.fill('.overlay input[name=title]', s0.title + ' (v2)');
    await saving(() => act('save'));
    await tool('[data-compare-open]'); await page.waitForURL(/mode=compare/); await settle();
    ipv = await getProc(impPid);
    const dv = ENG.diffVersions(ipv.drafts[0].tobe, ipv.tobe);
    const dvN = Object.values(dv.nodes), dvR = dv.removed.filter(g => g.type !== 'trigger' && g.type !== 'end').length;
    ok((await page.textContent('[data-cmp-sum]')).trim() === `${dvN.filter(x => x === 'new').length} new · ${dvN.filter(x => x === 'changed').length} changed · ${dvR} removed`, 'compare defaults to the saved draft → current to-be, counts = diffVersions: ' + (await page.textContent('[data-cmp-sum]')).trim());
    ok(await page.isVisible(`#canvas .node[data-node="${s0.id}"] .chip.diff-changed`) && /was|title/i.test(await page.textContent(`#canvas .node[data-node="${s0.id}"] .d-was`)), 'compare marks the edited step CHANGED with what changed');
    await shot('process-compare'); await iconCheck('compare'); await overflow('compare @1440');
    await page.selectOption('[data-cmp="a"]', 'cur-asis'); await page.waitForURL(/a=cur-asis/); await settle();
    const dpS = ENG.diffSummary(ipv);
    ok((await page.textContent('[data-cmp-sum]')).trim() === `${dpS.new} new · ${dpS.changed} changed · ${dpS.removed} removed`, 'compare as-is → to-be agrees with the process diff: ' + (await page.textContent('[data-cmp-sum]')).trim());
    await page.selectOption('[data-cmp="a"]', 'cur-tobe'); await page.waitForURL(/a=cur-tobe/); await settle();
    ok(/Pick two different versions/.test(await page.textContent('[data-cmp-sum]')), 'compare same version: asks for two different versions');
    if ((ipv.released || []).length) { await page.selectOption('[data-cmp="a"]', 'rel:' + ipv.released[0].version); await settle(); ok(await page.isVisible('#canvas .flow'), 'compare against a released version renders'); }
    /* the undo snapshot lives in memory for the session: stay in the app (no reload) */
    await page.click('.d-modes [data-mode="tobe"]'); await page.waitForURL(/mode=tobe/); await settle();
    ok(/Edited step/.test(await page.getAttribute('[data-undo]', 'title')), 'Undo last change offered for the edit: ' + await page.getAttribute('[data-undo]', 'title'));
    await saving(() => tool('[data-undo]'));
    ok(flat((await getProc(impPid)).tobe)[0].title === s0.title, 'Undo restored the previous step title');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    ok((await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent))).some(t => /Undid: Edited step/.test(t)), 'history shows the undo');
    /* max 10 */
    ipv = await getProc(impPid);
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: 'ver-e2e-' + i, name: 'Fixture ' + i, at: new Date().toISOString(), by: me, asis: [], tobe: [] }));
    ok(await putDoc('process', impPid, Object.assign({}, ipv, { drafts: ten }), 'Test fixture: 10 drafts') === 200, 'fixture: 10 saved versions');
    await nav(`/process/${impPid}?mode=tobe`);
    await tool('[data-save-version]'); await page.waitForSelector('.overlay:has-text("Saved versions are full")');
    ok(true, 'an 11th saved version is refused with a clear message'); await act('cancel');
    await page.click('[data-draft-del="ver-e2e-9"]'); await page.waitForSelector('.overlay [data-act="yes"]');
    await saving(() => act('yes'));
    ok((await getProc(impPid)).drafts.length === 9, 'Delete a saved version');
    ok(await putDoc('process', impPid, Object.assign({}, await getProc(impPid), { drafts: ipv.drafts }), 'Test fixture: restore drafts') === 200, 'fixture: drafts back to 1');

    console.log('# R5: BPMN import as a new version of this process');
    ipv = await getProc(impPid);
    await nav(`/process/${impPid}?mode=tobe`);
    const xmlNow = await exportBpmn('imp-tobe');
    const xEsc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const fl = flat(ipv.tobe); const ren = fl[2];
    let xml2 = xmlNow.replace(`name="${xEsc(ren.title)}"`, `name="${xEsc(ren.title)} (revised)"`);
    xml2 = xml2.replace('</bpmn:process>', '    <bpmn:textAnnotation id="TA_1"><bpmn:text>Reviewer note</bpmn:text></bpmn:textAnnotation>\n    <bpmn:task id="Orphan_1" name="Orphan task" />\n    <bpmn:dataObjectReference id="DO_1" name="Invoice PDF" />\n  </bpmn:process>');
    ok(xml2 !== xmlNow && xml2.includes('(revised)'), 'built a revised BPMN file');
    /* R8 §8: the export carries each step's PMOFlow id, so a renamed task keeps its work */
    ok(xmlNow.includes(`pmoflow:node id="${xEsc(ren.id)}"`), 'R8: export carries the PMOFlow id in extensionElements');
    const wiRen = 'wi-e2e-ren' + Math.random().toString(36).slice(2, 6);
    ok(await putDoc('workItem', wiRen, { id: wiRen, projectId: prjId, pid: impPid, step: ren.id, title: 'E2E work on the renamed step', owner: me, status: 'idle', start: st.today, due: st.today, deps: [], kind: 'build' }, 'Test fixture: work on a step to rename') === 200, 'fixture: work on the step that the file renames');
    await nav(`/process/${impPid}?mode=tobe`); /* the page reads the new work item */
    fs.writeFileSync(`${OUT}/imp-revised.bpmn`, xml2);
    await page.setInputFiles('[data-bpmn-file]', `${OUT}/imp-revised.bpmn`);
    await page.waitForSelector('.overlay [data-impsum]');
    const dropTxt = await page.textContent('.overlay [data-dropped]');
    ok(+(await page.getAttribute('.overlay [data-dropped]', 'data-dropped')) === 3 && /Orphan task/.test(dropTxt) && /not connected/.test(dropTxt) && /Invoice PDF/.test(dropTxt) && /Reviewer note|TA_1/.test(dropTxt), 'dropped elements listed before confirming: ' + dropTxt.replace(/\s+/g, ' ').slice(0, 160));
    const impSum = (await page.textContent('.overlay [data-impsum]')).replace(/\s+/g, ' ');
    ok(new RegExp(`${fl.length}\\s*matched`).test(impSum) && /\D1\s*renamed/.test(impSum) && /\D0\s*new/.test(impSum), 'R8: import summary matches by PMOFlow id first: ' + impSum);
    ok(await page.isVisible(`.overlay [data-renamed="${ren.id}"]:has-text("(revised)")`) && /keeps 1 work item/.test(await page.textContent(`.overlay [data-renamed="${ren.id}"]`)), 'R8: the preview says "renamed" and that the step keeps its work');
    await page.screenshot({ path: `${OUT}/import-version-modal.png` });
    await overflow('import version modal @1440');
    await saving(() => act('import'));
    await page.waitForURL(/mode=diff/); await settle();
    const ipi = await getProc(impPid);
    /* R6: the header version label and KPIs follow the import, and the KPIs agree with diffSummary */
    const dsI = ENG.diffSummary(ipi);
    ok(ipi.tobeRev === 2 && (await page.textContent('[data-ver-label]')).trim() === `v${ipi.version || 1} · Future rev 2` && /imp-revised\.bpmn/.test(await page.textContent('[data-ver-from]')), 'R6: header version label updates to "Future rev 2" from the imported file');
    ok(/Future rev 2/.test(await page.textContent('[data-ver-current]')), 'R6: version picker "Current" shows the new revision');
    ok((await page.textContent('[data-kpi-diff] b')).trim() === `${dsI.new}+${dsI.changed}` && (await page.textContent('.d-hdr .kpi >> nth=0')).includes(String(flat(ipi.tobe).length)), `R6: KPIs agree with diffSummary after import (${dsI.new}+${dsI.changed}, ${flat(ipi.tobe).length} steps)`);
    ok(new RegExp(`${flat(ipi.tobe).length} steps · ${dsI.new + dsI.changed} changed`).test(await page.textContent('[data-hdr-toggle]')), 'R6: phone summary row agrees too');
    const fi = flat(ipi.tobe);
    const keptOk = fl.every(o => { const n = fi.find(x => x.id === o.id); return n && n.title === (o.id === ren.id ? o.title + ' (revised)' : o.title) && JSON.stringify(n.data || []) === JSON.stringify(o.data || []) && JSON.stringify(n.subs || []) === JSON.stringify(o.subs || []) && n.owner === o.owner && (n.from || '') === (o.from || ''); });
    ok(keptOk && fi.length === fl.length, 'matched steps keep id, data tags, sub-steps, owners and as-is links');
    ok(fi.some(n => n.title === ren.title + ' (revised)' && n.id === ren.id), 'R8: the renamed step keeps its id (matched by PMOFlow id, not by name)');
    const wr = (await state()).docs.workItem.map(d => d.data).find(w => w.id === wiRen);
    ok(wr && wr.step === ren.id && fi.some(n => n.id === wr.step), 'R8: BPMN rename round-trip keeps the work item attached to the renamed step');
    await page.evaluate(async id => fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/doc/workItem/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'mc', summary: 'Test fixture removed' }) }), wiRen);
    ok(ipi.id === impPid && ipi.drafts.some(d => d.name === 'Before import of imp-revised.bpmn'), 'still the same process; the previous version was saved first');
    ok((await getProc(impPid)).asis.length === ipv.asis.length, 'as-is untouched by a to-be import');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    ok((await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent))).some(t => /Imported 'imp-revised.bpmn' as Future revision 2/.test(t)), 'history shows the version import');
    await shot('process-import-version');

    console.log('# R5: deleting a step that has work');
    const S6 = await state(); const ipd = await getProc(impPid); const fd = flat(ipd.tobe);
    const wsOn = id => S6.docs.workItem.map(d => d.data).filter(w => w.pid === impPid && w.step === id);
    const victim = fd.find(n => wsOn(n.id).length) || fd[0];
    const wiA = 'wi-e2e-a' + Math.random().toString(36).slice(2, 6), wiB = 'wi-e2e-b' + Math.random().toString(36).slice(2, 6), wiC = 'wi-e2e-c' + Math.random().toString(36).slice(2, 6);
    const tgtStep = fd.find(n => n.id !== victim.id), third = fd.find(n => n.id !== victim.id && n.id !== tgtStep.id);
    const mkW = (id, step, title, deps) => putDoc('workItem', id, { id, projectId: prjId, pid: impPid, step, title, owner: me, status: 'idle', start: st.today, due: st.today, deps: deps || [], kind: 'build' }, 'Test fixture: ' + title);
    ok(await mkW(wiA, victim.id, 'E2E build A') === 200 && await mkW(wiC, third.id, 'E2E follow-up C', [wiA]) === 200, 'fixture: work on the step to delete, plus a dependent');
    await nav(`/process/${impPid}?mode=edit&v=tobe`);
    await page.click(`[data-ed="del"][data-id="${victim.id}"]`);
    await page.waitForSelector('.overlay select[name=to]');
    ok(await page.isVisible(`.overlay [data-delwork="${wiA}"]`) && /has \d+ work item/.test(await page.textContent('.overlay .d-err')), 'warns that the step has work, listing it');
    await page.screenshot({ path: `${OUT}/delete-step-work.png` });
    await page.selectOption('.overlay select[name=to]', tgtStep.id);
    const wp = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/doc/process/' + impPid));
    await act('move'); await wp; await settle();
    let S7 = await state();
    const movedA = S7.docs.workItem.find(d => d.id === wiA).data;
    ok(movedA.step === tgtStep.id && !flat((await getProc(impPid)).tobe).some(n => n.id === victim.id), `"Move work to step…": work moved to '${tgtStep.title}', step deleted`);
    ok(S7.docs.workItem.filter(d => d.data.pid === impPid && d.data.step === victim.id).length === 0, 'no work left pointing at the deleted step');
    ok(await mkW(wiB, tgtStep.id, 'E2E build B') === 200, 'fixture: second work item');
    await nav(`/process/${impPid}?mode=edit&v=tobe`);
    await page.click(`[data-ed="del"][data-id="${tgtStep.id}"]`);
    await page.waitForSelector('.overlay [data-act="deletework"]');
    const wp2 = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/doc/process/' + impPid));
    await act('deletework'); await wp2; await settle();
    S7 = await state();
    ok(!S7.docs.workItem.some(d => d.id === wiA || d.id === wiB) && !flat((await getProc(impPid)).tobe).some(n => n.id === tgtStep.id), '"Delete work too": step and its work deleted');
    const cAfter = S7.docs.workItem.find(d => d.id === wiC).data;
    ok(!(cAfter.deps || []).length, 'dependents no longer wait for the deleted work');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    ok((await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent))).some(t => /Deleted step/.test(t)), 'history shows the step deletion');

    console.log('# R5: data element owner defaults to the creator');
    await nav(`/process/${impPid}?mode=edit&v=tobe`);
    const sO = flat((await getProc(impPid)).tobe).find(n => n.owner && n.owner !== me) || flat((await getProc(impPid)).tobe)[0];
    await page.click(`[data-ed="edit"][data-id="${sO.id}"]`); await page.waitForSelector('.overlay [data-nd-name]');
    const ndName = 'E2E creator-owned ' + Math.random().toString(36).slice(2, 6);
    await page.fill('.overlay [data-nd-name]', ndName); await page.click('.overlay [data-nd-create]');
    await saving(() => act('save'));
    const created = (await state()).docs.dataElement.map(d => d.data).find(d => d.name === ndName);
    ok(created && created.owner === sO.owner, `R8: inline-created information is owned by whoever does the step (${created && created.owner}, step owner ${sO.owner})`);
    await nav(`/process/${impPid}?mode=tobe`); await page.click('[data-newdata]'); await page.waitForSelector('.overlay select[name=owner]');
    ok(await page.inputValue('.overlay select[name=owner]') === me, 'New data element dialog: owner defaults to the creator'); await act('cancel');

    console.log('# R6: node types on the seed map — subprocess, wait, message (map, diff, swimlanes, step page)');
    await page.setViewportSize({ width: 1440, height: 900 });
    st = await state();
    const allProcs = (st.docs.process || []).map(d => d.data);
    const vo = allProcs.find(p => ['subprocess', 'wait', 'message'].every(t => flat(p.tobe).some(n => n.type === t)));
    ok(!!vo, 'seed has a process using subprocess, wait and message nodes');
    const spN = flat(vo.tobe).find(n => n.type === 'subprocess'), wN = flat(vo.tobe).find(n => n.type === 'wait'), mN = flat(vo.tobe).find(n => n.type === 'message');
    const called = allProcs.find(p => p.id === spN.calls);
    await nav(`/process/${vo.id}?mode=tobe`);
    const spCard = `#canvas .node[data-ntype="subprocess"][data-node="${spN.id}"]`;
    ok(await page.isVisible(spCard + '.d-nt-sub') && (await page.textContent(spCard + ' [data-sub-steps]')).trim() === `${flat(called.tobe).length} steps` && (await page.textContent(spCard)).includes('Calls ' + called.name), `subprocess card: calls ${called.name}, shows its step count (${flat(called.tobe).length})`);
    ok(await page.isVisible(`#canvas .node.d-nt-wait[data-node="${wN.id}"] [data-wait]:has-text("${wN.wait}")`) && /^Wait (up to|for) /.test((await page.textContent(`#canvas .node[data-node="${wN.id}"] [data-wait]`)).trim()), 'wait card: distinct (pill) and shows the wait ("Wait up to …")');
    ok(!/\bwait\s*·\s*\d/i.test(await page.textContent(`#canvas .node[data-node="${wN.id}"] .num`)), 'R9 §11: the wait card never reads "WAIT · 2"');
    ok(await page.isVisible(`#canvas .node.d-nt-msg[data-node="${mN.id}"] [data-msg="${mN.direction === 'receive' ? 'receive' : 'send'}"] .d-party:has-text("${mN.party}")`), 'message card: distinct, shows direction and party');
    const icons = await page.$$eval('#canvas .node[data-ntype] .ic', els => els.map(e => e.closest('.node').dataset.ntype + ':' + !!e.querySelector('svg')));
    ok(['subprocess:true', 'wait:true', 'message:true'].every(x => icons.includes(x)) && icons.includes('step:false'), 'typed nodes carry their own icon; plain steps keep their number');
    await shot('r6-typed-map');
    await page.click(spCard + ' [data-open-sub]'); await page.waitForURL(new RegExp(`/process/${called.id}$`)); await settle();
    ok((await page.textContent('#app h1')).trim() === called.name, '"Open" on a subprocess drills into the called process');
    await nav(`/process/${vo.id}?mode=diff`);
    ok(await page.isVisible(`#canvas [data-ntype="subprocess"]`) && await page.isVisible('#canvas [data-ntype="wait"]') && await page.isVisible('#canvas [data-ntype="message"]'), 'typed nodes appear in Diff');
    const dvo = ENG.diffProcess(vo);
    ok((await page.$$('#canvas .node[data-ntype="wait"] .chip.diff-new, #canvas .node[data-ntype="wait"] .chip.diff-changed')).length === (dvo.nodes[wN.id] === 'same' ? 0 : 1), 'typed nodes carry their NEW/CHANGED chip in Diff');
    await nav(`/process/${vo.id}?mode=lanes`);
    ok(await page.isVisible('[data-ext-lane]:has-text("External parties")') && !!(await page.$(`[data-ext-msg="${mN.id}"]`)) && !!(await page.$('.d-lanes .node[data-ntype="subprocess"]')) && !!(await page.$('.d-lanes .node[data-ntype="wait"]')), 'Swimlanes: typed nodes in their owners’ lanes; messages reach an "External parties" lane');
    console.log('# R6: swimlanes do not clip at 1280');
    await page.setViewportSize({ width: 1280, height: 900 });
    await nav(`/process/${vo.id}?mode=lanes`);
    const ln = await page.evaluate(() => {
      const w = document.querySelector('.d-lanewrap'), cs = getComputedStyle(w), wr = w.getBoundingClientRect();
      const heads = [...document.querySelectorAll('.d-lanes .lane-h')].map(h => h.getBoundingClientRect().width);
      const clipped = [...document.querySelectorAll('.d-lanes .lane-c .node')].filter(n => { const c = n.closest('.lane-c').getBoundingClientRect(), b = n.getBoundingClientRect(); return b.left < c.left - 1 || b.right > c.right + 1 || n.scrollWidth > n.clientWidth + 1; }).length;
      const canvas = document.querySelector('#canvas').getBoundingClientRect();
      w.scrollLeft = w.scrollWidth; const ext = document.querySelector('[data-ext-lane]'); const er = ext ? ext.getBoundingClientRect() : null;
      return { ox: cs.overflowX, minHead: Math.min(...heads), clipped, inCanvas: wr.right <= canvas.right + 1, extVisible: !!er && er.right <= w.getBoundingClientRect().right + 1 && er.left >= wr.left - 1 };
    });
    ok(ln.ox === 'auto', 'swimlanes container scrolls sideways (overflow-x: auto) @1280');
    ok(ln.minHead >= 219.5, `every lane is at least 220 px wide @1280 (${Math.round(ln.minHead)})`);
    ok(ln.clipped === 0 && ln.inCanvas, 'no card is clipped and the lanes stay inside the canvas @1280');
    ok(ln.extVisible, 'scrolling the lanes reaches the last (External parties) lane @1280');
    await overflow('swimlanes @1280'); await shot('r6-lanes-1280');
    await page.setViewportSize({ width: 1440, height: 900 });
    await nav(`/process/${vo.id}/step/${spN.id}`);
    ok(await page.isVisible('[data-step-type="subprocess"]') && await page.isVisible(`[data-step-type] [data-open-sub]:has-text("Open ${called.name}")`), 'step page of a subprocess: type, called process and "Open"');
    await nav(`/process/${vo.id}/step/${wN.id}`);
    ok(await page.isVisible(`[data-step-type="wait"]:has-text("${wN.wait}")`) && /Wait (up to|for)/.test(await page.textContent('[data-step-type="wait"]')), 'step page of a wait shows the wait');
    console.log('# R6: BPMN export maps the node types and carries PMOFlow data in extensionElements');
    await nav(`/process/${vo.id}?mode=tobe`);
    await tool('[data-bpmn]'); await page.waitForSelector('.overlay input[name=pool]');
    ok(await page.isChecked('.overlay input[name=pool]') && /\d+ message steps?/.test(await page.textContent('.overlay .mb')), 'download dialog offers the outside-parties group (on when there are message steps)');
    await act('cancel');
    const xvo = await exportBpmn('r6-seed-pool', true);
    bpmnCheck(xvo, vo.tobe, 'seed to-be with pool');
    ok(xvo.includes('xmlns:pmoflow="https://necogoode.com/pmoflow"') && /<bpmn:extensionElements>\s*<pmoflow:node id="[^"]+" nodeType="step"/.test(xvo), 'extensionElements in the pmoflow namespace');
    ok(xvo.includes(`<bpmn:callActivity id="N_${spN.id}"`) && xvo.includes(`calledElement="Process_${spN.calls}"`), 'subprocess -> callActivity with calledElement');
    ok(new RegExp(`<bpmn:intermediateCatchEvent id="N_${wN.id}"[^>]*>[\\s\\S]*?<bpmn:timerEventDefinition[^>]*>\\s*<bpmn:timeDuration>P2D</bpmn:timeDuration>`).test(xvo), 'wait -> intermediateCatchEvent with a timerEventDefinition (P2D)');
    ok(new RegExp(`<bpmn:intermediate${mN.direction === 'receive' ? 'Catch' : 'Throw'}Event id="N_${mN.id}"[^>]*>[\\s\\S]*?<bpmn:messageEventDefinition`).test(xvo) && /<bpmn:message id="Message_/.test(xvo), 'message -> intermediate throw/catch event with a messageEventDefinition');
    ok(/<bpmn:collaboration id="Collaboration_1">/.test(xvo) && /<bpmn:participant id="Participant_External" name="External parties" \/>/.test(xvo) && new RegExp(`<bpmn:messageFlow [^>]*sourceRef="N_${mN.id}" targetRef="Participant_External"`).test(xvo) && /bpmnElement="Collaboration_1"/.test(xvo), 'External parties pool with a messageFlow from each message node');
    const s2d = flat(vo.tobe).find(n => (n.data || []).length && n.sla && n.system && (n.subs || []).some(x => (x.data || []).length));
    if (s2d) { const nm = st.docs.dataElement.find(d => d.id === s2d.data[0]).data.name; ok(xvo.includes(`<pmoflow:data ref="${s2d.data[0]}" name="${nm.replace(/&/g, '&amp;')}" />`) && new RegExp(`sla="${s2d.sla}" system="${s2d.system.replace(/&/g, '&amp;')}"`).test(xvo) && /<pmoflow:sub title="[^"]+">\s*<pmoflow:data /.test(xvo) && /<pmoflow:touch name=/.test(xvo), 'data refs by name (and id), sla, system, touches and sub-steps travel in extensionElements'); }
    const xnp = await exportBpmn('r6-seed-nopool', false);
    ok(!/collaboration/.test(xnp) && !/messageFlow/.test(xnp) && /messageEventDefinition/.test(xnp), 'without the pool: no collaboration or message flows, message events kept');

    console.log('# R6: authoring subprocess, wait and message; "Create and tag" with owner and source');
    await nav(`/process/${newPid}?mode=edit&v=tobe`);
    const insAt = async kind => { const n = (await page.$$('[data-ins="root"]')).length; await page.click(`[data-ins="root"] >> nth=${n - 1}`); await page.waitForSelector('.overlay .d-kinds'); await act(kind); await page.waitForSelector('.overlay input[name=title]'); };
    await page.click('[data-ins="root"] >> nth=0'); await page.waitForSelector('.overlay .d-kinds');
    const kinds = await page.$$eval('.overlay .d-kind', bs => bs.map(b => b.dataset.act).join(','));
    ok(kinds === 'step,decision,parallel,wait,message,subprocess', 'insert picker offers a step, a choice, at the same time, then wait, message, another process: ' + kinds);
    await page.screenshot({ path: `${OUT}/r6-insert-picker.png` }); await act('cancel');
    await insAt('subprocess');
    ok(!(await page.isVisible('.overlay [data-subs]')) && await page.isVisible('.overlay select[name=calls]'), 'subprocess dialog: pick the process to call (no sub-steps)');
    await page.selectOption('.overlay select[name=calls]', vo.id);
    await page.fill('.overlay input[name=system]', 'ERP');
    await saving(() => act('save'));
    let np = await getProc(newPid);
    const spAdded = flat(np.tobe).find(n => n.type === 'subprocess');
    ok(spAdded && spAdded.calls === vo.id && spAdded.title === 'Run ' + vo.name && spAdded.system === 'ERP', `subprocess saved: calls ${vo.name}, default title "${spAdded && spAdded.title}"`);
    await insAt('wait');
    ok(!(await page.$('.overlay #d-f-info')) && !(await page.$('.overlay input[name=sla]')), 'wait dialog: no information or time-limit fields');
    await page.fill('.overlay input[name=wait]', '2 business days');
    await page.fill('.overlay input[name=title]', 'Wait 2 business days for vendor response');
    await saving(() => act('save'));
    await insAt('message');
    await page.selectOption('.overlay select[name=direction]', 'receive');
    await page.fill('.overlay input[name=party]', 'Vendor');
    await page.fill('.overlay input[name=title]', 'Receive signed quote');
    const other2 = st.people.find(x => x.id !== me);
    ok(await page.inputValue('.overlay [data-nd-owner]') === '', 'R8: "Create and tag": owner defaults to whoever does the step');
    await page.fill('.overlay [data-nd-name]', 'E2E signed quote');
    await page.selectOption('.overlay [data-nd-owner]', other2.id);
    await page.fill('.overlay [data-nd-source]', 'Vendor portal inbox');
    await page.click('.overlay [data-nd-create]');
    ok(new RegExp(`owned by ${other2.name}, from Vendor portal inbox`).test(await page.textContent('.overlay [data-nd-msg]')), '"Create and add" confirms owner and source inline');
    await page.screenshot({ path: `${OUT}/r6-message-modal.png` });
    /* two writes: the new data element, then the process */
    const wProc = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/doc/process/'), { timeout: 15000 });
    await saving(() => act('save')); ok((await wProc).ok(), 'process saved after the new data element');
    await settle();
    st = await state(); np = await getProc(newPid);
    const msgAdded = flat(np.tobe).find(n => n.type === 'message'), wAdded = flat(np.tobe).find(n => n.type === 'wait');
    const sq = st.docs.dataElement.map(d => d.data).find(d => d.name === 'E2E signed quote');
    ok(wAdded && wAdded.wait === '2 business days' && wAdded.title === 'Wait 2 business days for vendor response', 'wait saved with its duration');
    ok(msgAdded && msgAdded.direction === 'receive' && msgAdded.party === 'Vendor' && (msgAdded.data || []).includes(sq && sq.id), 'message saved: receive from Vendor, tagged with the new data');
    ok(sq && sq.owner === other2.id && sq.source === 'Vendor portal inbox', '"Create and tag" saved the chosen owner and source');
    await nav(`/process/${newPid}?mode=tobe`);
    ok(await page.isVisible('#canvas .node.d-nt-sub') && await page.isVisible('#canvas .node.d-nt-wait') && await page.isVisible('#canvas .node.d-nt-msg [data-msg="receive"]'), 'authored typed nodes render with their own visuals');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    const h6 = await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent).join('\n'));
    ok(/Added another process 'Run /.test(h6) && /Added wait 'Wait 2 business days/.test(h6) && /Added message 'Receive signed quote'/.test(h6), 'history names each typed node');
    await shot('r6-authored-tobe');
    await page.reload(); await page.waitForSelector('#canvas .node.d-nt-msg');
    ok(true, 'typed nodes persist after reload');

    console.log('# R6: lossless BPMN round trip (export -> import -> export)');
    const dn = id => { const d = st.docs.dataElement.find(x => x.id === id); return d ? d.data.name : id; };
    const x1 = await exportBpmn('r6-rt-1', true);
    bpmnCheck(x1, np.tobe, 'authored typed to-be');
    await nav('/processes');
    const rtPid = await importFile(`${OUT}/r6-rt-1.bpmn`);
    st = await state();
    const rt = await getProc(rtPid);
    const mA = modelOf(np.tobe, dn), mB = modelOf(rt.asis, dn);
    const diffAt = (a, b) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); let i = 0; while (i < ja.length && ja[i] === jb[i]) i++; return ja.slice(Math.max(0, i - 60), i + 40) + ' ≠ ' + jb.slice(Math.max(0, i - 60), i + 40); };
    ok(JSON.stringify(mA) === JSON.stringify(mB), 'import reads back every node type, gateway, loop-back, data tag, sla, system, touches, sub-steps and owner' + (JSON.stringify(mA) === JSON.stringify(mB) ? '' : ': ' + diffAt(mA, mB)));
    ok(!st.docs.dataElement.some(d => d.data.note && /BPMN import of r6-rt-1/.test(d.data.note)), 'round trip in the same workspace creates no duplicate data elements');
    await nav(`/process/${rtPid}?mode=tobe`);
    const x2 = await exportBpmn('r6-rt-2', true);
    const norm = (x, nodes, pid0) => { let out = x.replace(/(<bpmn:process [^>]*>\s*<bpmn:documentation>)[^<]*(<\/bpmn:documentation>)/, '$1$2'); const reEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); allNodes(nodes).map((n, i) => [String(n.id).replace(/[^\w.-]/g, '_'), i]).sort((a, b) => b[0].length - a[0].length).forEach(([id, i]) => { out = out.replace(new RegExp(`(N_|Message_|MessageFlow_)${reEsc(id)}(?=_join|_timer|_msg|_di|"|<)`, 'g'), `$1#${i}#`); }); return out.split(pid0).join('#P#'); };
    const noPid = x => x.replace(/(<pmoflow:node) id="[^"]*"/g, '$1'); /* R8: the PMOFlow id travels in the file; ids aside */
    const n1 = norm(noPid(x1), np.tobe, newPid), n2 = norm(noPid(x2), rt.tobe, rtPid);
    ok(n1 === n2, 'export -> import -> export gives the same BPMN (ids aside)' + (n1 === n2 ? '' : ': ' + diffAt(n1, n2)));
    ok(JSON.stringify(modelOf(rt.tobe, dn)) === JSON.stringify(mA), 'the imported to-be fork has the same model');
    /* the seed map adds gateways (decision branches), data tags, sub-steps with data, SLA and system to the round trip */
    await nav(`/process/${vo.id}?mode=tobe`);
    const xv1 = await exportBpmn('r6-rt-seed-1', true);
    await nav('/processes');
    const rvPid = await importFile(`${OUT}/r6-rt-seed-1.bpmn`);
    st = await state();
    const rv = await getProc(rvPid);
    const mV = modelOf(vo.tobe, dn), mR = modelOf(rv.asis, dn);
    ok(allNodes(vo.tobe).some(isGw) && JSON.stringify(mV) === JSON.stringify(mR), 'seed map round trip (gateways, typed nodes, data, sub-steps, sla, system) is lossless' + (JSON.stringify(mV) === JSON.stringify(mR) ? '' : ': ' + diffAt(mV, mR)));
    await nav(`/process/${rvPid}?mode=tobe`);
    const xv2 = await exportBpmn('r6-rt-seed-2', true);
    const v1n = norm(noPid(xv1), vo.tobe, vo.id), v2n = norm(noPid(xv2), rv.tobe, rvPid);
    ok(v1n === v2n, 'seed map: export -> import -> export gives the same BPMN (ids aside)' + (v1n === v2n ? '' : ': ' + diffAt(v1n, v2n)));
    /* a foreign file: callActivity, timer and message events without PMOFlow extension data still map */
    const foreign6 = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D6" targetNamespace="urn:northwind">
  <message id="M1" name="Carrier: pickup booked" />
  <collaboration id="C1"><participant id="PA" name="Returns" processRef="P6" /><participant id="PB" name="Carrier" /><messageFlow id="MF1" sourceRef="PB" targetRef="R1" /></collaboration>
  <process id="P6" name="Northwind returns pickup" isExecutable="false">
    <startEvent id="S" name="Pickup requested" /><callActivity id="CA" name="${vo.name}" calledElement="Process_${vo.id}" />
    <intermediateCatchEvent id="T1" name="Wait for the carrier window"><timerEventDefinition id="TD"><timeDuration>PT4H</timeDuration></timerEventDefinition></intermediateCatchEvent>
    <intermediateCatchEvent id="R1" name="Pickup confirmed"><messageEventDefinition id="MD" messageRef="M1" /></intermediateCatchEvent>
    <endEvent id="E" name="Done" />
    <sequenceFlow id="F1" sourceRef="S" targetRef="CA" /><sequenceFlow id="F2" sourceRef="CA" targetRef="T1" /><sequenceFlow id="F3" sourceRef="T1" targetRef="R1" /><sequenceFlow id="F4" sourceRef="R1" targetRef="E" />
  </process>
</definitions>`;
    fs.writeFileSync(`${OUT}/r6-foreign.bpmn`, foreign6);
    await nav('/processes');
    const f6 = flat((await getProc(await importFile(`${OUT}/r6-foreign.bpmn`))).asis);
    ok(f6.map(n => n.type).join(',') === 'subprocess,wait,message', 'foreign BPMN: callActivity -> subprocess, timer -> wait, message catch -> message');
    ok(f6[0].calls === vo.id && f6[1].wait === '4 hours' && f6[2].direction === 'receive' && f6[2].party === 'Carrier', `foreign BPMN: calledElement resolved, PT4H -> "4 hours", party from the message flow (${f6[1].wait}, ${f6[2].party})`);

    console.log('# R6: step status combines work and data; late is red');
    st = await state();
    const prjOf = pid0 => (st.docs.project || []).map(d => d.data).find(j => (j.processes || []).includes(pid0) && j.status !== 'live');
    const vp = prjOf(vo.id);
    let builtStep = flat(vo.tobe).find(n => { const s0 = ENG.stepState(st.docs, vp.id, vo.id, n.id, st.today); return s0.status === 'done' && [...(n.data || []), ...(n.subs || []).flatMap(x => x.data || [])].some(d => ENG.effectiveAvail(st.docs, d) !== 'live'); });
    let builtRestore = null;
    if (!builtStep) { /* R8: Today information is available, so the seed may have none: a done step gains information that is not available yet */
      const ds = flat(vo.tobe).find(n => n.type === 'step' && ENG.stepState(st.docs, vp.id, vo.id, n.id, st.today).status === 'done');
      if (ds) {
        const bid = 'de-e2e-built' + Math.random().toString(36).slice(2, 6); const vo0 = await getProc(vo.id); builtRestore = vo0;
        const vo1 = JSON.parse(JSON.stringify(vo0)); const tgt = allNodes(vo1.tobe).find(n => n.id === ds.id); tgt.data = [bid, ...(tgt.data || [])];
        ok(await putDoc('dataElement', bid, { id: bid, name: 'E2E built feed', owner: other.id, source: '', avail: 'missing', note: '', fields: [], samples: [], discovered: [] }, 'Test fixture: information not available yet') === 200
          && await putDoc('process', vo.id, vo1, 'Test fixture: a done step needs it') === 200, 'fixture: a done step whose information is not available yet');
        st = await state(); builtStep = tgt;
      }
    }
    await nav(`/process/${vo.id}/step/${builtStep.id}`);
    const bs = await page.evaluate(() => { const k = document.querySelector('[data-step-status]'); const b = k.querySelector('[data-step-label]'); return { st: k.dataset.stepStatus, txt: b.textContent.trim(), color: getComputedStyle(b).color }; });
    ok(bs.st === 'built' && bs.txt === 'Built · information not connected yet' && bs.color === 'rgb(180, 83, 9)', `done work + information not connected = amber "Built · information not connected yet", never green Done (${bs.txt}, ${bs.color})`);
    await nav(`/data/${builtStep.data[0]}`);
    ok(await page.isVisible(`[data-impact] tr[data-use="tobe"]:has-text("${builtStep.title}") [data-built]`), 'data page impact table shows the same combined status');
    if (builtRestore) { await putDoc('process', vo.id, builtRestore, 'Test fixture restored'); st = await state(); }
    const lateStep = flat(vo.tobe).find(n => n.type === 'step' && ENG.stepState(st.docs, vp.id, vo.id, n.id, st.today).status === 'prog');
    const ago = n => { const d = new Date(st.today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
    ok(await putDoc('workItem', 'wi-e2e-late', { id: 'wi-e2e-late', projectId: vp.id, pid: vo.id, step: lateStep.id, title: 'E2E overdue check', owner: me, status: 'prog', start: ago(10), due: ago(3), deps: [], effortDays: 1 }, 'Test fixture: overdue item') === 200, 'fixture: an overdue item');
    await nav(`/process/${vo.id}/step/${lateStep.id}`);
    const ls = await page.evaluate(() => { const k = document.querySelector('[data-step-status]'); const b = k.querySelector('[data-step-label]'); return { st: k.dataset.stepStatus, txt: b.textContent.trim(), color: getComputedStyle(b).color }; });
    ok(/-late$/.test(ls.st) && /Late/.test(ls.txt) && ls.color === 'rgb(220, 38, 38)', `late shows red in the drill-down (${ls.txt}, ${ls.color})`);
    ok(await page.isVisible('.d-wi:has-text("E2E overdue check") .b-late'), 'the overdue item carries one red schedule badge');
    const badgeTexts = await page.$$eval('.d-wiwrap', ws => ws.map(w => w.querySelectorAll('.wi .badge').length));
    ok(badgeTexts.every(n => n === 1), 'one schedule badge per work item');
    await shot('r6-step-late');
    await page.evaluate(async () => fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/doc/workItem/wi-e2e-late`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'mc', summary: 'Test fixture removed' }) }));

    console.log('# R6: step-level Impact and the process Impact tab');
    st = await state();
    const sA = flat(vo.tobe).find(n => (n.data || []).length && (st.docs.workItem || []).some(d => d.data.step === n.id && d.data.pid === vo.id && d.data.status !== 'done'));
    await nav(`/process/${vo.id}/step/${sA.id}`);
    const expShared = new Set(); (sA.data || []).concat((sA.subs || []).flatMap(x => x.data || [])).forEach(d => (st.docs.process || []).map(x => x.data).forEach(p => flat(p.tobe).forEach(t => { if (!(p.id === vo.id && t.id === sA.id) && [...(t.data || []), ...(t.subs || []).flatMap(x => x.data || [])].includes(d)) expShared.add(p.id + '/' + t.id); })));
    ok(+(await page.getAttribute('[data-imp-shared]', 'data-imp-shared')) === expShared.size, `step Impact lists every other step sharing data (${expShared.size})`);
    ok(+(await page.getAttribute('[data-imp-projects]', 'data-imp-projects')) === 1 && await page.isVisible(`[data-imp-prj="${vp.id}"]`), 'step Impact lists the project with open work on it');
    const st0 = await page.getAttribute('[data-step-impact]', 'data-step-impact');
    /* expected: no same-step conflict; an overlap only if another active project changes a step that shares this step's data */
    st = await state();
    const actPrj = new Set((st.docs.project || []).map(d => d.data).filter(j => j.status !== 'live' && j.id !== vp.id).map(j => j.id));
    const otherOnShared = (st.docs.workItem || []).map(d => d.data).some(w => w.status !== 'done' && actPrj.has(w.projectId) && (expShared.has(w.pid + '/' + w.step) || (w.resolves && (sA.data || []).includes(w.resolves))));
    ok(st0 === (otherOnShared ? 'overlap' : 'clear'), `one project on the step: ${otherOnShared ? 'Overlap (another project changes a step sharing its data)' : 'no conflicts'} (${st0})`);
    /* a second active project with open work on the same step */
    const due5 = (() => { const d = new Date(st.today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
    ok(await putDoc('project', 'prj-e2e-x', { id: 'prj-e2e-x', name: 'E2E Parallel Change', desc: '', owner: me, releaseManager: me, resources: [me], target: due5, processes: [vo.id], status: 'active', baselines: [] }, 'Test fixture: second project') === 200
      && await putDoc('workItem', 'wi-e2e-x', { id: 'wi-e2e-x', projectId: 'prj-e2e-x', pid: vo.id, step: sA.id, title: 'E2E parallel tweak', owner: me, status: 'idle', start: st.today, due: due5, deps: [] }, 'Test fixture: overlapping work') === 200, 'fixture: a second project changing the same step');
    await nav(`/process/${vo.id}/step/${sA.id}`);
    ok(await page.getAttribute('[data-step-impact]', 'data-step-impact') === 'conflict' && await page.isVisible('[data-conflict="same-step"]:has-text("E2E Parallel Change")') && +(await page.getAttribute('[data-imp-projects]', 'data-imp-projects')) === 2, 'two active projects on one step: Conflict, naming both');
    ok(await page.getAttribute('[data-impact-kpi]', 'data-impact-kpi') === 'conflict', 'step KPI shows the conflict');
    ok(await page.isVisible('[data-conflict-line]:has-text("Another project is also changing this step")') && /E2E Parallel Change/.test(await page.textContent('[data-conflict-line]')), 'R8: one plain line "Another project is also changing this step", naming it');
    await shot('r6-step-impact');
    st = await state();
    const sB = flat(vo.tobe).find(n => n.id !== sA.id && (n.data || []).some(d => (sA.data || []).includes(d)) && (st.docs.workItem || []).some(d => d.data.step === n.id && d.data.pid === vo.id && d.data.status !== 'done' && d.data.projectId === vp.id));
    if (sB) {
      await nav(`/process/${vo.id}/step/${sB.id}`);
      const sbSt = await page.getAttribute('[data-step-impact]', 'data-step-impact');
      ok(['overlap', 'conflict'].includes(sbSt) && await page.isVisible('[data-conflict="shared-data"]:has-text("E2E Parallel Change")'), `another project changing a step that shares data: Overlap on “${sB.title}” (${sbSt}; conflict when the seed also has a same-step conflict there)`);
    } else ok(false, 'seed has a second step sharing data with open work');
    await nav(`/process/${vo.id}?mode=impact`);
    ok(await page.isVisible('[data-mode="impact"].on') && await page.isVisible('[data-impact-tab]'), 'process page has an Impact tab');
    const rowsN = (await page.$$('[data-impact-row]')).length;
    ok(rowsN === flat(vo.tobe).length, `Impact tab rolls up every to-be step (${rowsN})`);
    ok(await page.getAttribute(`[data-impact-row="${sA.id}"]`, 'data-impact-status') === 'conflict' && (!sB || ['overlap', 'conflict'].includes(await page.getAttribute(`[data-impact-row="${sB.id}"]`, 'data-impact-status'))), 'Impact tab statuses agree with the step pages');
    ok(+(await page.getAttribute(`[data-impact-row="${sA.id}"] [data-shared-n]`, 'data-shared-n')) === expShared.size && +(await page.getAttribute(`[data-impact-row="${sA.id}"] [data-prj-n]`, 'data-prj-n')) === 2, 'Impact tab row: shared steps and projects match the step page');
    ok(/^[1-9]\d*\//.test(await page.getAttribute('[data-impact-sum]', 'data-impact-sum')), 'Impact tab summary counts the conflict');
    await shot('r6-impact-tab'); await overflow('impact tab @1440');
    await page.click(`[data-impact-row="${sA.id}"] a`); await page.waitForURL(new RegExp(`/step/${sA.id}$`));
    ok(true, 'Impact tab row drills into the step');
    for (const [t, i] of [['workItem', 'wi-e2e-x'], ['project', 'prj-e2e-x']]) await page.evaluate(async ([t, i]) => fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/doc/${t}/${i}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'mc', summary: 'Test fixture removed' }) }), [t, i]);

    console.log('# R6: unique fields (duplicates are flagged by profiling)');
    await nav(`/data/${did}`);
    await page.click('[data-fedit="0"]'); await page.waitForSelector('.overlay input[name=unique]');
    await page.check('.overlay input[name=unique]');
    ok(/unique/.test(await page.textContent('.overlay [data-specsum]')), 'spec builder: "Unique" reads back in the summary');
    await saving(() => act('save'));
    ok((await getData(did)).fields[0].unique === true && /Unique/.test(await page.textContent('.d-spec tr >> nth=1')), 'field.unique saved and shown as a rule');

    console.log('# R7 SIMPLE: plain words, mapping in minutes, automatic Future, hide-don’t-grey');
    await page.evaluate(() => localStorage.setItem('pmoflow.advanced', '0'));
    await nav('/processes');
    ok(!(await page.isChecked('#adv')), 'R7: back to Simple');
    /* no jargon on the stream-D pages in Simple mode (process descriptions are user text and are skipped) */
    const JARGON = /\b(As-is|To-be|Diff|BPMN|SLA|Touches|gateway|Fork)\b/i;
    /* R8 §1: Simple never shows the detailed availability words */
    const PLAIN = /\bconnected\b|waiting for confirmation|sample only/i;
    const plainCheck = async label => {
      const hit = await page.evaluate(src => {
        const re = new RegExp(src, 'i'); const out = [];
        const walk = el => { if (el.closest('.d-desc, [data-comments] .cmt, [data-history], [data-dropped]') || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return; for (const n of el.childNodes) { if (n.nodeType === 3 && re.test(n.textContent)) out.push(n.textContent.trim().slice(0, 60)); else if (n.nodeType === 1) { if (n.title && re.test(n.title)) out.push('title: ' + n.title.slice(0, 50)); walk(n); } } };
        walk(document.getElementById('app')); return out;
      }, PLAIN.source);
      ok(!hit.length, `${label}: no "connected / waiting for confirmation / sample only" in Simple${hit.length ? ' — found: ' + hit.slice(0, 4).join(' | ') : ''}`);
    };
    const jargonCheck = async label => {
      const hit = await page.evaluate(src => {
        const re = new RegExp(src, 'i'); const out = [];
        const walk = el => { if (el.closest('.d-desc, [data-comments] .cmt, [data-history]') || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return; for (const n of el.childNodes) { if (n.nodeType === 3 && re.test(n.textContent)) out.push(n.textContent.trim().slice(0, 60)); else if (n.nodeType === 1) walk(n); } };
        walk(document.getElementById('app')); return out;
      }, JARGON.source);
      ok(!hit.length, `${label}: no jargon visible in Simple${hit.length ? ' — found: ' + hit.slice(0, 4).join(' | ') : ''}`);
    };
    await jargonCheck('processes'); await plainCheck('processes');
    for (const m of ['asis', 'tobe', 'diff', 'lanes', 'impact']) { await nav(`/process/${pid}?mode=${m}`); await jargonCheck('process ' + m); await plainCheck('process ' + m); }
    for (const sx of flat(seedP.tobe).slice(0, 4)) { await nav(`/process/${pid}/step/${sx.id}`); await jargonCheck('step ' + sx.title); await plainCheck('step ' + sx.title); }
    await nav(`/data/${seedData.id}`); await jargonCheck('data'); await plainCheck('data');
    ok((await page.textContent('.crumbs')).replace(/\s+/g, ' ').trim() === 'Home › Processes › Information', 'R8: data breadcrumbs use the nav words (Home › Processes)');
    await nav(`/process/${pid}/step/${flat(seedP.tobe)[0].id}`);
    ok(/^Home › Processes › /.test((await page.textContent('.crumbs')).replace(/\s+/g, ' ').trim()), 'R8: step breadcrumbs start Home › Processes, like the nav');
    await nav(`/process/${pid}`);
    ok(/^Home › Processes/.test((await page.textContent('.crumbs')).replace(/\s+/g, ' ').trim()) && (await page.textContent('#nav a.on')).trim() === 'Processes', 'R8: process breadcrumbs and the highlighted nav tab say Processes');
    if (prof) { await nav(`/data/${prof.id}`); await jargonCheck('data with a sample check'); await plainCheck('data with a sample check');
      /* R8 §4: one plain line per profiled column */
      const S7 = await state(); const pd = S7.docs.profile.map(d => d.data).filter(x => x.dataId === prof.id).sort((a, b) => b.at.localeCompare(a.at))[0];
      const lines = await page.$$eval('[data-profline]', els => els.map(e => e.textContent.replace(/\s+/g, ' ').replace(/^●\s*/, '').trim()));
      ok(pd && lines.length >= (pd.columns || []).length && (pd.columns || []).every(c => lines.some(l => l.startsWith(c.name + ': ') && /\d+ values?/.test(l))), 'R8: Simple profile shows one plain line per column: ' + lines.slice(0, 3).join(' / '));
      ok(!(await page.$('.d-tc')) && !/\bexpect\b/i.test(await page.textContent('[data-cases]')), 'R8: Simple tests list has no TC labels or "expect"');
    }

    /* Simple header: name, description, Today · Future · What changed, "⋯ More"; KPIs hidden */
    await nav(`/process/${pid}?mode=tobe`);
    ok((await page.$$eval('.d-modes button', bs => bs.map(b => b.textContent.trim()).join(','))) === 'Today,Future,What changed', 'R7 Simple tabs: Today · Future · What changed');
    ok(!(await page.isVisible('.d-hdr .kpis')) && await page.isVisible('[data-more] > summary'), 'Simple header: no KPI tiles; a "⋯ More" menu');
    await openMore();
    const menu = await page.$$eval('[data-more] .d-menu > *', els => els.map(e => e.textContent.trim().split('\n')[0].trim()));
    ok(['Version', 'Compare versions', 'Save version', 'By person', 'Who’s affected'].every(x => menu.some(m => m.startsWith(x))) && !menu.some(m => /diagram|BPMN/i.test(m)), 'R9 §11: Simple "⋯ More" holds Version, Compare, Save version, By person, Who’s affected, and no diagram file (BPMN is Advanced only): ' + menu.join(' / '));
    await shot('simple-more-menu');
    await page.click('[data-more] [data-mode="lanes"]'); await page.waitForURL(/mode=lanes/);
    ok(await page.isVisible('.d-lanes'), '"By person" opens from the menu');
    await nav(`/process/${pid}?mode=tobe`);
    ok(await page.isVisible('[data-modenote]:has-text("Change steps to show how it should work")'), 'Future shows the one-line hint');
    ok(await page.isVisible('#canvas .node.trigger .num:has-text("What starts it")'), '"What starts it" label on the first card');
    await shot('simple-process'); await overflow('simple process @1440');

    /* timed simplicity check: map a 5-step process with owners and information in ≤ 15 actions.
       An action is one click, or one typed entry into a field (ending with Enter or a comma counts as part of it). */
    let actions = 0; const A = async fn => { actions++; await fn(); };
    const t0 = Date.now();
    await nav('/processes');
    await A(() => page.click('[data-new-workflow]'));
    await page.waitForSelector('.overlay #d-np-name');
    const sp = 'E2E Simple expense claim';
    await A(() => page.fill('.overlay #d-np-name', sp).then(() => page.press('.overlay #d-np-name', 'Enter')));
    await page.waitForURL(/mode=edit&v=asis/);
    await page.waitForSelector('.overlay #d-f-title');
    const STEPS = [['Submit the claim', 'Employee', 'Receipt, Amount'], ['Attach the receipt photo', null, 'Receipt'], ['Approve the claim', 'Manager', 'Amount, Cost centre'], ['Check the budget', null, 'Cost centre'], ['Pay the employee', null, 'Bank details']];
    for (let i = 0; i < STEPS.length; i++) {
      const [title, who, info] = STEPS[i]; const last = i === STEPS.length - 1;
      await page.waitForSelector('.overlay #d-f-title');
      await A(() => page.fill('.overlay #d-f-title', title));
      if (who) await A(() => page.fill('.overlay #d-f-who', who));
      if (last) { await A(() => page.fill('.overlay #d-f-info', info)); const w = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/doc/process/')); await A(() => page.click('.overlay [data-act="save"]')); await w; }
      else { const w = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/doc/process/')); await A(() => page.fill('.overlay #d-f-info', info).then(() => page.press('.overlay #d-f-info', 'Enter'))); await w; }
    }
    await settle();
    const secs = (Date.now() - t0) / 1000;
    ok(actions <= 15, `R7: a 5-step process with owners and information took ${actions} actions (≤ 15)`);
    ok(secs < 60, `R7: … in ${secs.toFixed(1)} s of automation (< 60 s)`);
    ok(!(await page.$('.overlay')), 'the last "Add step" closes the dialog');
    const spId = page.url().match(/process\/([\w-]+)/)[1];
    let spP = await getProc(spId); st = await state();
    const sSteps = flat(spP.asis);
    ok(sSteps.map(x => x.title).join('|') === STEPS.map(x => x[0]).join('|'), 'all 5 steps saved in order on Today');
    ok(sSteps.map(x => x.ownerRole || '').join('|') === 'Employee|Employee|Manager|Manager|Manager', 'who does it: free-text roles stored as ownerRole, carried to the next step: ' + sSteps.map(x => x.ownerRole).join(','));
    const dnm = id => (st.docs.dataElement.find(d => d.id === id) || { data: {} }).data.name;
    ok(sSteps.every((x, i) => (x.data || []).map(dnm).join(', ') === STEPS[i][2]), 'information chips saved per step (existing names reused, no duplicates)');
    const newInfo = ['Receipt', 'Amount', 'Cost centre', 'Bank details'].map(n => st.docs.dataElement.map(d => d.data).filter(d => d.name === n));
    ok(newInfo.every(l => l.length === 1 && l[0].avail === 'live' && l[0].owner === me && l[0].ownerRole === (['Bank details', 'Cost centre'].includes(l[0].name) ? 'Manager' : 'Employee')), 'R8: new information on Today defaults to "We have it", owned by the step’s role (accountable: the process owner), created once');
    ok(await page.isVisible('#canvas .node [data-who][data-role]:has-text("Employee")'), 'the role shows on the card');
    await shot('simple-mapped-today');
    /* R8 §1: information typed on a new Today map is information we have: no red or amber warnings anywhere */
    const todayWarn = await page.evaluate(() => ({ miss: document.querySelectorAll('#canvas .d-miss, #canvas .d-pend, #canvas .d-needlive').length, blocked: !!document.querySelector('[data-side-blocked]'), notyet: [...document.querySelectorAll('[data-side-data] [data-avail]')].filter(a => !/We have it/.test(a.textContent)).length, rows: document.querySelectorAll('[data-side-data] [data-hl]').length }));
    ok(todayWarn.miss === 0 && !todayWarn.blocked && todayWarn.notyet === 0 && todayWarn.rows === 4, `R8: a newly mapped Today process shows no red/missing warnings for typed information (${JSON.stringify(todayWarn)})`);
    await plainCheck('new Today map');
    /* a step needs a name: the dialog stays open with an inline message */
    await page.click('[data-addstep]'); await page.waitForSelector('.overlay #d-f-title');
    await act('save');
    ok(await page.isVisible('.overlay [data-title-err]') && await page.isVisible('.overlay #d-f-title'), 'R8: an empty step name is refused inline; the dialog stays open');
    await act('cancel');

    /* the step dialog: exactly 3 inputs before "More options" */
    await page.click('[data-addstep]'); await page.waitForSelector('.overlay #d-f-title');
    const vis3 = await page.$$eval('.overlay .mb input, .overlay .mb select, .overlay .mb textarea', els => els.filter(e => !e.closest('details') && e.type !== 'hidden' && e.offsetParent !== null).map(e => e.id || e.name));
    ok(vis3.length === 3 && vis3.join(',') === 'd-f-title,d-f-who,d-f-info', 'R7: the step dialog shows exactly 3 inputs before More options: ' + vis3.join(','));
    ok(await page.isVisible('.overlay label[for="d-f-title"]:has-text("Step name")') && await page.isVisible('.overlay label[for="d-f-who"]:has-text("Who does it")') && await page.isVisible('.overlay label[for="d-f-info"]:has-text("What information it needs")'), 'the 3 fields: Step name · Who does it · What information it needs');
    ok(!(await page.$eval('.overlay [data-more-options]', d => d.open)) && !(await page.isVisible('.overlay input[name=sla]')) && !(await page.isVisible('.overlay input[name=touches]')), 'time limit, system, duration, teams and sub-steps sit under a closed "More options"');
    ok(await page.inputValue('.overlay #d-f-who') === 'Manager', '"Who does it" starts from the previous step');
    await page.screenshot({ path: `${OUT}/simple-step-dialog.png` }); await iconCheck('simple step dialog');
    await act('cancel');

    /* Future is created automatically the first time it is opened: no fork button, no confirm */
    ok(!(await page.$('[data-fork]')), 'no fork button in Simple');
    const wF = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/doc/process/' + spId));
    await page.click('.d-modes [data-mode="tobe"]'); await wF; await settle();
    spP = await getProc(spId);
    ok(flat(spP.tobe).length === 5 && flat(spP.tobe).every((x, i) => x.from === sSteps[i].id && x.id !== sSteps[i].id) && spP.tobeForked === true, 'R7: opening Future creates it from Today (linked copies, no confirm)');
    ok(!(await page.$('.overlay')) && await page.isVisible('[data-modenote]:has-text("We’ll highlight what changed")'), 'Future: no dialog, one-line hint');
    await page.click('[data-addstep]'); await page.waitForSelector('.overlay #d-f-title');
    await page.fill('.overlay #d-f-title', 'Pay by bank transfer automatically');
    await page.fill('.overlay #d-f-info', 'Payment batch file');
    await saving(() => act('save'));
    await settle(); st = await state();
    ok((st.docs.dataElement.map(d => d.data).find(d => d.name === 'Payment batch file') || {}).avail === 'missing', 'new information added on Future defaults to "Not available yet"');
    /* R9 §13: a positive "We have it" switch. It starts off on Future; switching it on says we already have it */
    await page.click('[data-addstep]'); await page.waitForSelector('.overlay #d-f-title');
    await page.fill('.overlay #d-f-title', 'Email the remittance advice');
    await page.fill('.overlay #d-f-info', 'Remittance advice,'); await page.waitForSelector('.overlay [data-ichip] [data-have]');
    ok(!(await page.isChecked('.overlay [data-ichip] [data-have]')) && /we have it/i.test(await page.textContent('.overlay [data-ichip] .d-have')), 'R9: new information on Future starts with "We have it" off');
    futureHelp = (await page.textContent('.overlay [data-avail-help]')).trim();
    await page.check('.overlay [data-ichip] [data-have]');
    await saving(() => act('save')); await settle(); st = await state();
    const ra = st.docs.dataElement.map(d => d.data).find(d => d.name === 'Remittance advice') || {};
    ok(ra.avail === 'live' && ra.owner === me, 'R9: switched on = "We have it"; owner defaults to whoever does the step');
    await page.click('.d-modes [data-mode="diff"]'); await page.waitForURL(/mode=diff/);
    ok(await page.isVisible('#canvas .node:has-text("Pay by bank transfer automatically") .chip.diff-new'), 'What changed: the new Future step is marked NEW');
    await jargonCheck('new process, What changed');
    await shot('simple-what-changed');
    ok(!!(await page.waitForSelector('[data-history] .ev:has-text("Created the Future version from Today")', { timeout: 10000 }).catch(() => null)), 'history shows the automatic Future');

    /* data page: "Use these columns as the rules to test" after a sample data check */
    if (prof) {
      const ucId = 'de-e2e-uc' + Math.random().toString(36).slice(2, 6);
      ok(await putDoc('dataElement', ucId, { id: ucId, name: 'E2E sampled feed', owner: me, source: 'Northwind ERP', avail: 'example', note: '', fields: [], samples: [], discovered: [] }, 'Test fixture: sampled feed') === 200, 'fixture: information with no rules');
      const pr2 = await page.evaluate(async ([id, csv]) => (await fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/profile/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv, actor: 'x' }) })).status, [ucId, prof.sampleCsv]);
      ok(pr2 === 200, 'checked sample data for it');
      await nav(`/data/${ucId}`);
      ok(!(await page.$('.d-prof')) && await page.isVisible('[data-profile-card] .row'), 'Simple: the sample check reads as plain lines; the statistics table is Advanced only');
      ok(await page.isVisible('[data-use-columns]:has-text("Use these columns as the rules to test")'), 'R7: "Use these columns as the rules to test" offered after a sample data check');
      const S8 = await state(); const profDoc = S8.docs.profile.map(d => d.data).filter(x => x.dataId === ucId).sort((a, b) => b.at.localeCompare(a.at))[0];
      const expF = ENG.specFromProfile(profDoc);
      await shot('simple-data-use-columns');
      await saving(() => page.click('[data-use-columns]'));
      const ucD = await getData(ucId);
      ok(ucD.fields.length === expF.length && expF.length > 0 && ucD.fields.every((f, i) => f.name === expF[i].name && f.type === expF[i].type), `one click: ${ucD.fields.length} rules from the columns (engine specFromProfile)`);
      ok((await page.$$('.d-spec tr')).length === expF.length + 1 && !(await page.$('[data-use-columns]')), 'the rules table shows them; the offer is gone');
      await page.click('[data-fadd]'); await page.waitForSelector('.overlay .d-fmts');
      ok(!(await page.isVisible('.overlay details[data-adv]')), 'Simple: the rule dialog has no regular-expression section');
      await act('cancel');
      await jargonCheck('data after using the columns');
      await setPersona(other.id); await page.waitForSelector('[data-fadd]', { state: 'detached' });
      ok(!(await page.$('[data-fedit]')) && !(await page.$('[data-dedit]')), 'hide, don’t grey: a non-owner sees no rule or edit buttons');
      await setPersona(me); await page.waitForSelector('[data-fadd]');
    }
    /* R8 §1: ?confirm=1 opens the confirm flow; "Confirm all" with one note for everything waiting for this owner */
    {
      const ids = ['a', 'b'].map(k => 'de-e2e-ca' + k + Math.random().toString(36).slice(2, 6));
      for (const [i, id] of ids.entries()) {
        ok(await putDoc('dataElement', id, { id, name: 'E2E fixed feed ' + (i + 1), owner: me, source: 'Northwind ERP', avail: 'missing', note: '', fields: [], samples: [], discovered: [] }, 'Test fixture: fixed feed') === 200
          && await putDoc('workItem', 'wi-' + id, { id: 'wi-' + id, projectId: prjId, pid, step: flat(seedP.tobe)[0].id, title: 'Fix feed ' + (i + 1), owner: other.id, status: 'done', start: st.today, due: st.today, doneAt: st.today, deps: [], resolves: id, kind: 'build' }, 'Test fixture: finished fix') === 200, 'fixture: information fixed by someone else, waiting for its owner');
      }
      const S9 = await state();
      ok(ids.every(id => ENG.effectiveAvail(S9.docs, id) === 'pending'), 'engine: both wait for the owner');
      await nav(`/data/${ids[0]}?confirm=1`);
      await page.waitForSelector('.overlay [data-act="confirm"]', { timeout: 5000 }).catch(() => {});
      ok(await page.isVisible('.overlay [data-act="confirm"]:has-text("Confirm we have it")') && !/confirm=1/.test(page.url()), 'R8: /data/<id>?confirm=1 opens the confirm flow (once)');
      await page.screenshot({ path: `${OUT}/r8-confirm-deeplink.png` }); await act('cancel');
      ok(+(await page.getAttribute('[data-confirm-all]', 'data-confirm-all')) >= 2 && await page.isVisible('[data-confirm-all] [data-confirm-all-go]'), 'R8: the data page offers "Confirm all" when several items wait for this owner');
      await plainCheck('data waiting for its owner'); await shot('r8-confirm-all');
      await page.fill('[data-confirm-all] [name=canote]', 'Checked both in the ERP');
      const nAll = +(await page.getAttribute('[data-confirm-all]', 'data-confirm-all'));
      const wA = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes(ids[1]));
      await page.click('[data-confirm-all-go]'); await wA; await settle();
      const S10 = await state();
      ok(ids.every(id => ENG.effectiveAvail(S10.docs, id) === 'live') && ids.every(id => (S10.docs.dataElement.find(d => d.id === id).data.liveEvidence || {}).note === 'Checked both in the ERP'), 'R8: "Confirm all" confirms every ticked item with the one note');
      await nav(`/data/${ids[0]}`);
      ok(await page.isVisible('.hdr [data-avail]:has-text("We have it")') && !(await page.$('[data-confirm-card]')), 'R8: after confirming, the header says "We have it"');
      await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
      ok((await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent))).some(t => /Confirmed we have 'E2E fixed feed 1'/.test(t)), 'history shows the confirmation');
    }
    /* hide, don't grey on the process page */
    await setPersona(outsider.id); await nav(`/process/${pid}?mode=tobe`);
    ok(!(await page.$('[data-mode="edit"]')) && !(await page.$('[data-save-version]')) && !(await page.$('[data-bpmn-file]')) && !(await page.$('.d-locked')), 'hide, don’t grey: a non-editor sees no Edit, Save version or Import');
    await setPersona(me);

    /* phone, Simple: the map starts near the top; the step dialog fits */
    await page.setViewportSize({ width: 390, height: 844 });
    await nav(`/process/${spId}?mode=tobe`);
    /* measured from the top of the page content (the app header above it is shared chrome) */
    const phS = await page.evaluate(() => document.querySelector('#canvas').getBoundingClientRect().top - document.querySelector('#app').getBoundingClientRect().top);
    ok(phS < 160, `Simple phone: map starts near the top of the page content (${Math.round(phS)} px)`);
    await overflow('simple process @390'); await shot('simple-phone-process');
    /* R8 §7: map first, side panels folded below it; the first step is on screen without scrolling */
    const ph8 = await page.evaluate(() => { const c = document.querySelector('#canvas').getBoundingClientRect(), s = document.querySelector('aside.side').getBoundingClientRect(), f = document.querySelector('#canvas .node[data-step]').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.d-sidefold > .card')]; return { first: f.top + scrollY, firstBottom: f.bottom, vh: innerHeight, sideBelow: s.top >= c.bottom - 1, folded: cards.every(k => [...k.children].filter(x => x.tagName !== 'H3').every(x => x.offsetParent === null)), n: cards.length }; });
    ok(ph8.firstBottom <= ph8.vh && ph8.sideBelow, `R8 phone: the map comes first and its first step is visible without scrolling (${Math.round(ph8.first)} px), side panels below`);
    ok(ph8.folded && ph8.n >= 3, `R8 phone: the ${ph8.n} side panels are folded to their headings`);
    await page.click('[data-side-data] > h3');
    ok(await page.isVisible('[data-side-data] [data-hl]'), 'R8 phone: tapping a panel heading opens it');
    await shot('r8-phone-map-first');
    await page.click('[data-mode="edit"]'); await page.waitForURL(/mode=edit/); await page.click('[data-addstep]'); await page.waitForSelector('.overlay #d-f-title');
    await overflow('simple step dialog @390'); await page.screenshot({ path: `${OUT}/simple-phone-step-dialog.png` });
    /* R8 §7: on a phone "Add step" works like Enter (the dialog stays for the next one); "Done adding" ends */
    ok(await page.isVisible('.overlay [data-act="done"]:has-text("Done adding")'), 'R8 phone: a separate "Done adding" button');
    const n0 = flat((await getProc(spId)).tobe).length;
    await page.fill('.overlay #d-f-title', 'Phone step one');
    let wP = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/doc/process/')); await act('save'); await wP;
    await page.waitForSelector('.overlay #d-f-title'); 
    ok(await page.inputValue('.overlay #d-f-title') === '', 'R8 phone: "Add step" saves and opens the next empty step');
    await page.fill('.overlay #d-f-title', 'Phone step two');
    wP = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/doc/process/')); await act('done'); await wP; await settle();
    ok(!(await page.$('.overlay')), 'R8 phone: "Done adding" saves the last one and closes');
    const tl = flat((await getProc(spId)).tobe).map(x => x.title);
    ok(tl.length === n0 + 2 && tl.indexOf('Phone step one') + 1 === tl.indexOf('Phone step two'), 'R8 phone: both steps saved, in order');
    /* R8 §7: branch cards fit inside the map at 390 (no clipping) */
    await nav(`/process/${pid}?mode=tobe`);
    const clip = await page.evaluate(() => { const c = document.querySelector('#canvas').getBoundingClientRect(); return [...document.querySelectorAll('#canvas .branches .node, #canvas .branches .passthru, #canvas .branches .d-goto, #canvas .diamond')].filter(e => { const r = e.getBoundingClientRect(); return r.left < c.left - 0.5 || r.right > c.right + 0.5; }).map(e => e.textContent.trim().slice(0, 30)); });
    const nBr = await page.$$eval('#canvas .branches .node, #canvas .branches .passthru', e => e.length);
    ok(nBr > 0 && !clip.length, `R8 phone: ${nBr} branch cards fit inside the map at 390${clip.length ? ' — clipped: ' + clip.join(' | ') : ''}`);
    ok(await page.$eval('#canvas', c => c.scrollWidth <= c.clientWidth + 1), 'R8 phone: the map does not scroll sideways');
    await shot('r8-phone-branches');
    /* the next-step button text wraps instead of being cut off */
    await nav(`/process/${pid}/step/${flat(seedP.tobe)[0].id}`);
    const pnB = await page.$$eval('.d-prevnext .btn', bs => bs.map(b => ({ cut: b.scrollWidth > b.clientWidth + 1, ws: getComputedStyle(b).whiteSpace })));
    ok(pnB.length && pnB.every(x => !x.cut && x.ws !== 'nowrap'), 'R8: next/previous step buttons wrap their text (no truncation)');
    await nav('/processes'); await overflow('simple processes @390'); await shot('simple-phone-processes');
    if (prof) { await nav(`/data/${prof.id}`); await overflow('simple data @390'); await shot('simple-phone-data'); }
    /* ===================== R9: one truth, enforced (stream D) ===================== */
    await page.setViewportSize({ width: 1440, height: 900 });
    console.log('# R9 §9: SOP import — own-line conditions, "If OK" ends, Role (Name), systems, step count, name');
    {
      const SOP = ['Employee Offboarding Procedure',
        '1. Clerk receives the access request form.',
        '2. HR Manager (Maya Chen) updates the employee exit form in HRIS.',
        '3. If finance access, Controller reviews the access list. If OK, forwards to IT.',
        '4. IT disables accounts in ServiceNow within 1 business day.',
        '5. Facilities collects laptop; if not returned within 5 days, notify Legal.'].join('\n');
      await nav('/import');
      await page.fill('[data-sop]', SOP); await page.dispatchEvent('[data-sop]', 'input');
      await page.click('[data-draft]'); await page.waitForSelector('.is-draft', { timeout: 20000 });
      const D = await page.evaluate(() => {
        const tops = [...document.querySelectorAll('.is-steps > .is-step')];
        const T = el => (el.querySelector(':scope > .is-body > [data-f=title], :scope > [data-f=title]') || el.querySelector('[data-f=title]') || {}).value || '';
        const nodes = tops.map(li => ({ type: li.dataset.type, title: (li.querySelector('.is-title') || {}).value || '',
          branches: [...li.querySelectorAll('.is-branch')].map(b => ({ label: (b.querySelector('.is-blabel') || {}).value, steps: [...b.querySelectorAll('.is-bstep .is-title')].map(t => t.value), end: !!b.querySelector('[data-end-node]'), hint: (b.querySelector('[data-branch-hint]') || {}).textContent })) }));
        const stepCount = document.querySelectorAll('.is-steps .is-body:not(.is-gate):not(.is-kind)').length;
        const head = (document.querySelector('.is-draft h3 .n') || {}).textContent || '';
        return { nodes, stepCount, head, found: (document.querySelector('[data-found]') || {}).textContent || '', notes: (document.querySelector('.is-notes') || {}).textContent || '',
          systems: [...document.querySelectorAll('[data-system]')].map(e => e.dataset.system), persons: [...document.querySelectorAll('[data-owner-person]')].map(e => e.dataset.ownerPerson),
          ndOwners: [...document.querySelectorAll('[data-nd-owner]')].map(e => e.dataset.ndOwner), page: document.getElementById('app').innerText };
      });
      await shot('r9-import-draft');
      const hN = +(/(\d+) steps?/.exec(D.head) || [])[1];
      ok(hN === D.stepCount && D.found.includes(`${D.stepCount} step`) && !/Found \d+ steps/.test(D.notes), `R9 §9: the step count shown (${hN}) equals the steps in the draft (${D.stepCount}) everywhere`);
      const iCollect = D.nodes.findIndex(n => /collect laptop/i.test(n.title));
      const retDec = D.nodes.findIndex(n => n.type === 'decision' && /returned within 5 days\?/i.test(n.title));
      ok(iCollect >= 0 && retDec === iCollect + 1 && D.nodes[retDec].branches.some(b => b.steps.some(t => /notify legal/i.test(t))), 'R9 §9 (B1): "if not returned within 5 days, notify Legal" stays on step 5 (a choice right after “Collect laptop”)');
      const okDec = D.nodes.find(n => n.type === 'decision' && /^request ok\?$/i.test(n.title));
      ok(!!okDec && !okDec.branches.some(b => b.steps.some(t => /legal|returned/i.test(t))), 'R9 §9 (B1): step 3’s choice no longer carries step 5’s clause');
      ok(!!okDec && okDec.branches[1].end && !okDec.branches[0].steps.some(t => /^forward/i.test(t)) && /ends here/i.test(okDec.branches[1].hint), 'R9 §9: "If OK, forwards to IT": Yes carries on to IT, No ends the process ("Ends here")');
      ok(D.persons.includes('mc') && D.nodes.some(n => /^update the employee exit form$/i.test(n.title)), 'R9 §9: "HR Manager (Maya Chen) updates…" -> owner Maya Chen, title "Update the employee exit form"');
      ok(D.systems.includes('ServiceNow') && D.systems.includes('HRIS') && D.nodes.some(n => /^disable accounts$/i.test(n.title)), 'R9 §9: ServiceNow and HRIS become the step system (and leave the title)');
      ok(!/Doesn.t go back|Sub-step/i.test(D.page) && /Detail step/.test(D.page), 'R9 §11: import uses "Detail step" and never "Doesn’t go back"');
      const ndExit = D.ndOwners; ok(ndExit.includes('Maya Chen') && ndExit.includes('Clerk') && !ndExit.includes('—'), 'R9 §8: proposed information shows the step owner (Maya Chen, Clerk), never "—": ' + ndExit.join(', '));
      await page.click('[data-create]'); await page.waitForSelector('.overlay [data-pname]');
      ok(await page.inputValue('.overlay [data-pname]') === 'Employee offboarding', 'R9 §9 (B2): the name comes from the title line: ' + await page.inputValue('.overlay [data-pname]'));
      const wS = page.waitForURL(/\/process\/[\w-]+\?mode=asis/, { timeout: 20000 }); await act('create'); await wS; await settle();
      const offPid = page.url().match(/process\/([\w-]+)/)[1];
      const off = await getProc(offPid); const S9 = await state(); const des = S9.docs.dataElement.map(d => d.data);
      const offAll = allNodes(off.asis);
      ok(offAll.some(n => n.type === 'end' && /request rejected/i.test(n.title)) && offAll.filter(n => n.type === 'step').some(n => n.system === 'ServiceNow') && offAll.some(n => n.owner === 'mc' && /exit form/i.test(n.title)), 'R9 §9: the saved map keeps the "Stop: request rejected" end, the system and the named owner');
      const exitDe = des.find(d => /employee exit form/i.test(d.name)), reqDe = des.find(d => /access request form/i.test(d.name));
      ok(exitDe && exitDe.owner === 'mc' && reqDe && reqDe.ownerRole === 'Clerk', 'R9 §8: pasted information is owned by its step’s owner (Maya Chen) or role (Clerk)');
      if (reqDe) { await nav(`/data/${reqDe.id}`); const ow = (await page.textContent('.hdr .res')).replace(/\s+/g, ' '); ok(/Clerk/.test(ow) && !/—|None\b/.test(ow), 'R9 §8: the data page shows the role as owner, never "—": ' + ow.slice(0, 80)); }
      await nav(`/process/${offPid}?mode=asis`); await shot('r9-import-saved-map');
      ok(await page.isVisible('#canvas .node.end:has-text("Stop: request rejected")'), 'R9 §9: the map draws the rejected path ending');
      /* B2: a procedure without a title line: the name is empty, focused and required */
      await nav('/import');
      await page.fill('[data-sop]', '1. Clerk receives request.\n2. Manager approves the request.\n3. Clerk files the request.'); await page.dispatchEvent('[data-sop]', 'input');
      await page.click('[data-draft]'); await page.waitForSelector('.is-draft');
      await page.click('[data-create]'); await page.waitForSelector('.overlay [data-pname]');
      ok(await page.inputValue('.overlay [data-pname]') === '' && await page.evaluate(() => document.activeElement && document.activeElement.matches('[data-pname]')), 'R9 §9 (B2): no title line -> the name is left empty and focused (never step 1)');
      await act('create'); await page.waitForSelector('.overlay [data-name-err]');
      ok(/name/i.test(await page.textContent('.overlay [data-name-err]')), 'R9 §9: saving without a name asks for one');
      await act('cancel');
    }

    console.log('# R9 §8: the data page is consistent (samples, rules)');
    {
      const S = await state(); const withCsv = S.docs.dataElement.map(d => d.data).find(d => d.sampleCsv);
      if (withCsv) {
        await nav(`/data/${withCsv.id}`);
        const n = +(await page.getAttribute('[data-samples]', 'data-samples')), rows = (await page.$$('[data-sample-row]')).length;
        ok(n === rows && n === (withCsv.samples || []).length + 1 && await page.isVisible('[data-sample-row="practice"]:has-text("Practice sample")') && !/A made-up sample extract/.test(await page.textContent('#app')), `R9 §8 (B12): "Samples on file ${n}" equals the samples shown, the made-up one labelled "Practice sample"`);
        await shot('r9-data-samples');
      } else ok(false, 'seed has information with a practice sample');
      ok(await putDoc('dataElement', 'de-e2e-rules', { id: 'de-e2e-rules', name: 'E2E vendor code', owner: me, source: '', avail: 'live', note: '', fields: [{ name: 'Vendor code', type: 'text', required: true, unique: true, rule: 'Required, unique per vendor' }], samples: [], discovered: [] }, 'Test fixture: duplicated rules') === 200, 'fixture: a rule written twice');
      await nav('/data/de-e2e-rules');
      const rt = (await page.textContent('.d-spec .d-rule')).trim();
      ok(rt === 'Required · Unique per vendor', 'R9 §8 (B12): rules are deduplicated: ' + rt);
    }

    console.log('# R9 §13/§11: process page — headline, systems, labels, placeholders, positive switch');
    {
      await nav(`/process/${pid}?mode=tobe`);
      const S = await state(); const P = S.docs.process.find(d => d.id === pid).data; const dd = ENG.diffProcess(P); const fs_ = flat(P.tobe);
      const hl = (await page.textContent('[data-hdr-toggle]')).replace(/\s+/g, ' ');
      const expN = fs_.filter(x => dd.nodes[x.id] === 'new').length, expC = fs_.filter(x => dd.nodes[x.id] === 'changed').length;
      ok(hl.includes(`${fs_.length} steps`) && (!expN || hl.includes(`${expN} new`)) && (!expC || hl.includes(`${expC} changed`)) && expN + expC <= fs_.length, `R9 §13: headline counts make sense: "${hl.trim()}"`);
      const sysTxt = await page.textContent('[data-systems]').catch(() => ''); const teamTxt = await page.textContent('[data-touches]').catch(() => '');
      ok(/ERP/.test(sysTxt) && !/\bERP\b/.test(teamTxt), 'R9 §13: "Teams involved" lists teams only; ERP sits under "Systems touched"');
      const dia = await page.$$eval('#canvas .diamond', ds => ds.map(d => !!d.querySelector('[data-gw-label]')));
      ok(dia.length > 0 && dia.every(Boolean), `R9 §11: every ◆ / ⊕ carries a text label (${dia.length})`);
      ok(!/\bWAIT\s*·\s*\d|Sub-step|Doesn.t go back|BPMN/i.test(await page.evaluate(() => document.getElementById('app').innerText)), 'R9 §11: no "WAIT · 2", "Sub-step", "Doesn’t go back" or BPMN on the Simple map');
      ok(!(await page.evaluate(() => [...document.querySelectorAll('#canvas [data-who]')].some(e => /^(—|[a-z]{2})$/.test(e.textContent.trim())))), 'R9 §13: no raw person id or "—" as who does a step');
      /* "or a choice…" and the empty "What starts it?" card, on a fresh map */
      await nav(`/process/${spId}?mode=edit&v=asis`);
      const deco = await page.$eval('.d-addother', b => getComputedStyle(b).textDecorationLine);
      ok(deco === 'none', 'R9 §11: the "or a choice…" link is not struck through (' + deco + ')');
      const Pn = await getProc(spId); const trig = (Pn.asis || []).find(n => n.type === 'trigger');
      if (trig && !trig.title) ok(/e\.g\. A vendor sends a request/.test(await page.textContent('[data-trigger-empty]')), 'R9 §11: the empty "What starts it?" card shows an example');
      else { const t1 = JSON.parse(JSON.stringify(Pn)); t1.asis.find(n => n.type === 'trigger').title = ''; await putDoc('process', spId, t1, 'Test fixture: empty start'); await nav(`/process/${spId}?mode=asis`);
        ok(/e\.g\. A vendor sends a request/.test(await page.textContent('[data-trigger-empty]')), 'R9 §11: the empty "What starts it?" card shows an example'); await putDoc('process', spId, Pn, 'Test fixture restored'); await nav(`/process/${spId}?mode=edit&v=asis`); }
      await page.click('[data-addstep]'); await page.waitForSelector('.overlay #d-f-title');
      await page.fill('.overlay #d-f-info', 'E2E petty cash slip,'); await page.waitForSelector('.overlay [data-ichip] [data-have]');
      ok(await page.isChecked('.overlay [data-ichip] [data-have]') && (await page.getAttribute('.overlay [data-ichip] [data-have]', 'role')) === 'switch', 'R9 §13: on Today the positive "We have it" switch starts on');
      const todayHelp = (await page.textContent('.overlay [data-avail-help]')).trim();
      ok(!!futureHelp && todayHelp.replace(/\bstarts (on|off)\b/, '') === futureHelp.replace(/\bstarts (on|off)\b/, '') && /starts on/.test(todayHelp) && /starts off/.test(futureHelp), 'R9 §11: the availability help text is identical in Today and Future, apart from the default');
      await page.screenshot({ path: `${OUT}/r9-step-dialog-switch.png` });
      await act('cancel');
    }

    console.log('# R9 §1: step page status and blockers from projectTruth; one "Late"');
    {
      const S = await state(); const P = S.docs.process.find(d => d.id === pid).data;
      const prj = (S.docs.project || []).map(d => d.data).find(j => (j.processes || []).includes(pid));
      if (prj) {
        const T = ENG.projectTruth(S.docs, prj.id, S.today);
        let checked = 0, good = true;
        for (const sx of flat(P.tobe).slice(0, 6)) {
          await nav(`/process/${pid}/step/${sx.id}`);
          const lbl = await page.getAttribute('[data-project-label]', 'data-project-label');
          const ids = [...new Set([...(sx.data || []), ...(sx.subs || []).flatMap(x => x.data || [])])];
          const expB = T.blockers.filter(b => ids.includes(b.dataId)).length;
          const gotB = +(await page.getAttribute('[data-step-blockers]', 'data-step-blockers'));
          const ss = ENG.stepState(S.docs, prj.id, pid, sx.id, S.today); const fc = ENG.forecastAll(S.docs, S.today);
          const late = ss.status !== 'done' && ss.items.some(w => w.status !== 'done' && fc[w.id] && fc[w.id].late);
          const stxt = await page.textContent('[data-step-label]').catch(() => '');
          if (lbl !== T.label || gotB !== expB || (late !== /Late/.test(stxt) && ss.status !== 'done')) { good = false; console.log('    step mismatch', sx.title, lbl, T.label, gotB, expB, late, stxt); }
          checked++;
        }
        ok(good && checked > 0, `R9 §1: on ${checked} step pages "Project status" = projectTruth.label (${T.label}), blockers = truth.blockers on the step, "Late" = the engine's late flag`);
        const txt = await page.evaluate(() => document.getElementById('app').innerText);
        ok(!/Running late|\bslipping\b/i.test(txt), 'R9 §1: Simple never says "Running late"; everything late says "Late"');
      } else ok(false, 'seed process has a project');
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => localStorage.setItem('pmoflow.advanced', '1'));

    console.log('# phone 390');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const m of ['asis', 'tobe', 'diff', 'lanes', 'impact', 'edit', 'compare']) { await nav(`/process/${pid}?mode=${m}`); await overflow(`process ${m} @390`); await shot('phone-process-' + m); }
    await nav(`/process/${vo.id}/step/${sA.id}`); await overflow('step impact @390'); await shot('phone-step-impact');
    await nav(`/process/${newPid}?mode=tobe`); await overflow('typed nodes @390'); await shot('phone-typed');
    await openMore(); await overflow('More menu @390'); await page.screenshot({ path: `${OUT}/phone-more-menu.png` }); await page.click('[data-bpmn]'); await page.waitForSelector('.overlay [data-act="download"]'); await overflow('export dialog @390'); await page.screenshot({ path: `${OUT}/phone-export.png` }); await act('cancel');
    await nav(`/process/${newPid}?mode=edit&v=tobe`); await page.click('[data-ins="root"] >> nth=0'); await page.waitForSelector('.overlay .d-kinds'); await overflow('insert picker @390'); await page.screenshot({ path: `${OUT}/phone-insert-picker.png` }); await act('cancel');
    console.log('# R5: phone — the map starts near the top; KPIs and controls collapse into a summary row');
    await nav(`/process/${pid}?mode=tobe`);
    const ph = await page.evaluate(() => ({ top: document.querySelector('#canvas').getBoundingClientRect().top - document.querySelector('#app').getBoundingClientRect().top, tabs: !!document.querySelector('.d-hdr .d-modes').offsetParent, kpis: !!document.querySelector('.d-hdr .kpis').offsetParent, desc: !!(document.querySelector('.d-hdr .d-desc') || {}).offsetParent, sum: !!document.querySelector('[data-hdr-toggle]').offsetParent }));
    ok(ph.sum && ph.tabs && !ph.kpis && !ph.desc, 'phone: tabs plus one summary row; description and KPIs collapsed');
    ok(ph.top < 220, `phone (Advanced, five tabs): process map starts near the top of the page content (${Math.round(ph.top)} px)`);
    { const hl = await page.textContent('[data-hdr-toggle]'); const [vs, nn, cc] = (await page.getAttribute('[data-headline]', 'data-headline')).split('/').map(Number);
      ok(/Future · \d+ steps · (\d+ new|\d+ changed)/.test(hl) && nn + cc <= vs, 'R9 §13 phone summary row: which map, steps, then new/changed steps that add up: ' + hl.replace(/\s+/g, ' ').trim()); }
    await page.click('[data-hdr-toggle]');
    ok(await page.isVisible('.d-hdr .d-desc') && await page.isVisible('.d-hdr .kpis') && await page.getAttribute('[data-hdr-toggle]', 'aria-expanded') === 'true', 'phone: expand shows the description and KPIs');
    await overflow('phone header expanded @390'); await shot('phone-process-expanded');
    await page.click('[data-hdr-toggle]');
    ok(!(await page.isVisible('.d-hdr .kpis')), 'phone: collapse again');
    await setPersona(outsider.id); await nav(`/process/${pid}?mode=edit`); await overflow('read-only @390'); await shot('phone-readonly'); await setPersona(me);
    await nav(`/process/${impPid}?mode=compare`); await overflow('compare @390'); await shot('phone-compare');
    await nav(`/data/${ckId}`); await overflow('data checked @390'); await shot('phone-data-evidence');
    await nav(`/process/${pid}?mode=edit`);
    ok(await page.$eval('.branches', el => getComputedStyle(el).flexDirection) === 'column', 'branches stack at 390');
    await page.click('[data-ins="root"] >> nth=0');
    ok(await page.isVisible('.overlay [data-act="step"]'), 'insert point usable at 390');
    await act('step');
    await page.waitForSelector('.overlay #d-f-title');
    await page.screenshot({ path: `${OUT}/phone-step-modal.png` });
    await act('cancel');
    await nav(`/process/${pid}?mode=asis&rel=${rel.version}`); await overflow('released @390');
    const firstStep = flat(seedP.tobe)[0];
    await nav(`/process/${pid}/step/${firstStep.id}`); await overflow('step @390'); await shot('phone-step');
    await nav(`/data/${did}`); await overflow('data @390'); await shot('phone-data');
    await nav(`/data/${seedData.id}`); await overflow('data seed @390');
    await nav(`/process/${impPid}?mode=edit`); await overflow('imported edit @390'); await shot('phone-imported-edit');
    await nav('/processes'); await overflow('processes @390'); await shot('phone-processes');
    /* R9: the import draft (choices, an ending path) and the data page samples fit at 390 */
    await nav('/import'); await page.fill('[data-sop]', 'Employee Offboarding Procedure\n1. Clerk receives request.\n2. HR Manager (Maya Chen) updates the employee record in HRIS.\n3. If finance access, Controller reviews the access list. If OK, forwards to IT.\n4. IT disables accounts in ServiceNow.\n5. Facilities collects laptop; if not returned within 5 days, notify Legal.'); await page.dispatchEvent('[data-sop]', 'input');
    await page.click('[data-draft]'); await page.waitForSelector('.is-draft'); await overflow('R9 import draft @390'); await shot('r9-phone-import');
    await nav('/data/de-e2e-rules'); await overflow('R9 data rules @390'); await shot('r9-phone-data');
    await nav(`/data/${did}`); await page.click('[data-fedit="0"]'); await page.waitForSelector('.overlay .d-fmts'); await overflow('spec builder @390'); await page.screenshot({ path: `${OUT}/phone-spec-builder.png` }); await act('cancel');
    if (stepWithWork) { await nav(`/process/${pid}/step/${stepWithWork.step}`); await page.click('.d-why summary'); await overflow('step why @390'); await shot('phone-step-why'); }
    await nav(`/process/${impPid}?mode=tobe`); await page.click('.d-sidefold > .card:has([data-start-project]) > h3'); await page.click('[data-start-project]'); await page.waitForSelector('.overlay input[name=target]');
    await overflow('start project modal @390'); await page.screenshot({ path: `${OUT}/phone-start-project.png` }); await act('cancel');
    if (prof) { await nav(`/data/${prof.id}`); await overflow('data profile @390'); await shot('phone-data-profile'); }
  } catch (e) {
    fail++; failures.push('exception: ' + e.message.split('\n')[0]); console.log('  FAIL exception: ' + e.stack.split('\n').slice(0, 4).join('\n'));
    await page.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => {});
  }
  ok(errors.length === 0, 'zero page/console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('Failures:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
