/* E2E for stream D (process / step / data pages), rounds 1 to 5.
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
  const all = allNodes(nodes);
  /* a gateway emits a split plus a join, unless every branch loops back */
  const gws = t => all.filter(n => n.type === t).length + all.filter(n => n.type === t && !(n.branches || []).every(b => b.goto)).length;
  return { userTask: flat(nodes).length, exclusiveGateway: gws('decision'), parallelGateway: gws('parallel'), startEvent: 1, endEvent: 1, lane: Math.max(1, new Set(flat(nodes).map(n => n.owner || '')).size) };
}
const docsOf = st => st.docs;

(async () => {
  const browser = await chromium.launch();
  /* each run gets its own test client IP so the 5-sandboxes-per-IP-per-day limit does not block repeat runs on the dev server */
  const ip = `198.51.100.${1 + ((Math.random() * 253) | 0)}`;
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
  const settle = () => page.waitForLoadState('networkidle').catch(() => {});
  const nav = async path => { await page.goto(BASE + path); await page.waitForSelector('#app .hdr, #app .card', { timeout: 20000 }); await settle(); };
  /* run an action that triggers a PUT/DELETE, and wait for it to finish */
  const saving = async fn => { const w = page.waitForResponse(r => ['PUT', 'DELETE'].includes(r.request().method()) && r.url().includes('/api/pmoflow/'), { timeout: 15000 }); await fn(); const r = await w; ok(r.ok(), 'save responded ' + r.status()); await settle(); };
  const act = id => page.click(`.overlay [data-act="${id}"]`);
  const state = () => page.evaluate(async () => (await fetch('/api/pmoflow/ws/' + localStorage.getItem('pmoflow.ws') + '/state')).json());
  /* test fixture writer (used only to seed a release and a discovered requirement) */
  const putDoc = (type, id, data, summary) => page.evaluate(async ([type, id, data, summary]) => (await fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/doc/${type}/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, actor: 'mc', summary }) })).status, [type, id, data, summary]);
  const titles = () => page.$$eval('#canvas .node .ttl', els => els.map(e => e.textContent.trim()));
  const getProc = async id => (await state()).docs.process.find(d => d.id === id).data;
  const getData = async id => (await state()).docs.dataElement.find(d => d.id === id).data;
  const exportBpmn = async name => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-bpmn]')]);
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
    ok((r.counts.BPMNShape || 0) === Object.values(exp).reduce((a, v) => a + v, 0) && (r.counts.BPMNEdge || 0) === r.counts.sequenceFlow, `${label}: diagram has a shape per element and lane, and an edge per flow`);
    const flowNodes = exp.userTask + exp.exclusiveGateway + exp.parallelGateway + 2;
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
    let st = await state();
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
    const prow = await page.$$eval('.d-prow', rs => rs.map(r => ({ id: r.dataset.prow, ver: r.querySelector('[data-ver]').textContent.trim(), steps: r.querySelector('[data-col=steps] b').textContent.trim(), diff: r.querySelector('[data-col=diff] b').textContent.trim(), data: (r.querySelector('[data-datacounts]') || { dataset: {} }).dataset.datacounts || '', owner: r.querySelector('[data-col=owner]').textContent, prj: r.querySelector('[data-col=projects]').textContent })));
    ok(prow.length === procs.length, `index lists every process (${prow.length})`);
    let rowsOk = true;
    for (const r of prow) {
      const p = procs.find(x => x.id === r.id); const ds = ENG.diffSummary(p); const ids = [...new Set(flat(p.tobe).flatMap(s => s.data || []))];
      const c = k => ids.filter(d => ENG.effectiveAvail(st.docs, d) === k).length;
      const projs = (st.docs.project || []).map(d => d.data).filter(j => (j.processes || []).includes(p.id));
      const exp = { ver: 'v' + (p.version || 1), steps: String(flat(p.tobe).length), diff: `${ds.new}+${ds.changed}`, data: ids.length ? `${c('live')}/${c('pending')}/${c('example')}/${c('missing')}` : '' };
      if (r.ver !== exp.ver || r.steps !== exp.steps || r.diff !== exp.diff || r.data !== exp.data || !r.owner.includes(st.people.find(x => x.id === p.owner).name) || !projs.every(j => r.prj.includes(j.name))) { rowsOk = false; console.log('    row mismatch', r, exp); }
    }
    ok(rowsOk, 'each row: version, owner, steps, new+changed (diffSummary), live/pending/examples/missing (effectiveAvail), projects');
    ok(await page.getAttribute('[data-new-workflow]', 'href') === '/concepts/pmoflow/new' && await page.getAttribute('[data-import-sop]', 'href') === '/concepts/pmoflow/import' && !!(await page.$('label.d-import [data-bpmn-file]')), '"+ New workflow", "Import BPMN" and "Import SOP" actions');
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
    ok(tabOrder.join(',') === 'As-is,To-be,Diff,Swimlanes,Edit', 'mode tabs in order: ' + tabOrder.join(','));

    console.log('# R3: effective data state on map cards, diffSummary counts');
    await nav(`/process/${pid}?mode=tobe`);
    const D = docsOf(st); const D0 = () => D;
    const cards = await page.$$eval('#canvas .node[data-step]', els => els.map(e => ({ id: e.dataset.step, miss: (e.querySelector('.d-miss') || {}).textContent || '', amber: (e.querySelector('.d-needlive') || {}).textContent || '' })));
    let cardOk = cards.length > 0, sawMiss = false, sawAmber = false;
    for (const c of cards) {
      const n = flat(seedP.tobe).find(x => x.id === c.id); const eff = (n.data || []).map(d => ENG.effectiveAvail(D, d));
      const m = eff.filter(a => a === 'missing').length, x = eff.filter(a => a === 'example').length;
      if ((m ? !c.miss.includes(m + ' missing') : !!c.miss) || (x ? !c.amber.startsWith(x + ' need') : !!c.amber)) { cardOk = false; console.log('    card mismatch', c, m, x); }
      sawMiss = sawMiss || !!m; sawAmber = sawAmber || !!x;
    }
    ok(cardOk, `map cards: red "missing" and amber "needs live source" match effectiveAvail on ${cards.length} cards`);
    ok(sawMiss || sawAmber, `seed shows at least one data warning (missing ${sawMiss}, examples ${sawAmber})`);
    const sum = ENG.diffSummary(seedP);
    ok((await page.textContent('[data-kpi-diff] b')).trim() === `${sum.new}+${sum.changed}`, `KPI new+changed = diffSummary ${sum.new}+${sum.changed}`);

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
    await page.selectOption('[data-version]', String(rel.version));
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
    ok(await page.isVisible('text=How this step runs') && await page.isVisible('text=Work to deliver it'), 'step page shows sub-steps and work cards');
    ok(await page.isVisible('text=UAT scripts for this step'), 'step page shows UAT scripts card');
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
      ok(JSON.stringify(lines) === JSON.stringify(expLines), 'explanation = explainForecast: ' + lines.join(' / ').slice(0, 120));
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
    ok(/v=asis/.test(page.url()) && await page.isVisible('.d-editbar [data-ver="asis"].on'), 'new process opens edit on the as-is version');
    const np0 = await getProc(newPid);
    ok(np0.asis[0].type === 'trigger' && np0.asis[0].title === '' && np0.tobe[0].title === '', 'R5: new trigger title is empty (the prompt is a placeholder, not a value)');
    ok(await page.isVisible('#canvas .node.trigger [data-trigger-empty]:has-text("What starts this process?")'), 'R5: empty trigger shows the prompt as placeholder text');
    await page.click('#canvas .node.trigger [data-ed="edit"]'); await page.waitForSelector('.overlay input[name=title]');
    ok(await page.inputValue('.overlay input[name=title]') === '' && /What starts this process\?/.test(await page.getAttribute('.overlay input[name=title]', 'placeholder')), 'R5: trigger dialog: empty value, prompt as placeholder');
    await page.fill('.overlay input[name=title]', 'Requester submits a purchase request');
    await page.fill('.overlay input[name=touches]', 'Kickoff Desk');
    await saving(() => act('save'));
    ok((await getProc(newPid)).asis[0].title === 'Requester submits a purchase request', 'R5: trigger title saved');
    ok(await page.isVisible('[data-touches] [data-touch="Kickoff Desk"]:has-text("· 1")'), 'R5: kickoff touches count in "Touches across operations"');
    ok(/Map how it runs today, then fork to-be/.test(await page.textContent('[data-asis-hint]')), 'as-is hint: "Map how it runs today, then fork to-be"');
    await shot('process-new-asis'); await iconCheck('edit as-is');
    await page.click('[data-ver="tobe"]'); await page.waitForURL(/v=tobe/);
    await page.waitForSelector('[data-ins]');

    /* keyboard: focus the insert point, press Enter, choose Step; fill SLA/system/duration */
    await page.focus('[data-ins="root"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.overlay [data-act="parallel"]');
    await act('step');
    await page.waitForSelector('.overlay input[name=title]');
    await page.fill('.overlay input[name=title]', 'Verify identity');
    await page.click('.overlay [data-picks] .d-pick >> nth=0');
    await page.fill('.overlay input[name=touches]', 'Compliance, Portal');
    await page.fill('.overlay input[name=sla]', '2 business days');
    await page.fill('.overlay input[name=system]', 'ERP');
    await page.fill('.overlay input[name=durationHrs]', '4');
    await page.click('.overlay [data-subadd]');
    await page.fill('.overlay [data-subrow] input[name=sub_title]', 'Check ID document');
    await page.click('.overlay [data-subrow] .d-pick >> nth=0');
    await saving(() => act('save'));
    ok((await titles()).includes('Verify identity'), 'inserted step via keyboard');
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
    await page.selectOption('.overlay [data-brow] >> nth=1 >> select[name=bgoto]', { label: '↩ Loop back to Verify identity' });
    await saving(() => act('save'));
    ok(await page.isVisible('.diamond:has-text("Amount over limit?")'), 'decision inserted');
    ok(await page.isVisible('.blabel:has-text("Needs more info")'), 'renamed branch label shown');
    ok((await page.textContent('.d-goto')).includes('Loop back to “Verify identity”'), 'loop-back label rendered at branch end');
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
      ok(!!r && /Loop back to/.test(r.labelText), `${label}: text label kept for accessibility`);
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
    ok(await page.isVisible('[data-gw="parallel"] .d-par:has-text("Runs in parallel")'), 'parallel gateway shows "Runs in parallel"');
    ok((await page.textContent('[data-gw="parallel"] .d-par')).includes('⊕'), 'parallel gateway uses the ⊕ diamond');
    await page.click('[data-gw="parallel"] [data-ins$="#1"]');
    await act('step');
    await page.fill('.overlay input[name=title]', 'Notify treasury');
    await saving(() => act('save'));
    ok(await page.isVisible('[data-gw="parallel"] .node:has-text("Notify treasury")'), 'step added inside a parallel track');

    /* create-and-tag is deferred: cancel discards it; duplicates are blocked */
    await page.click('.node:has-text("Verify identity") [data-ed="edit"]');
    await page.waitForSelector('.overlay [data-nd-name]');
    await page.fill('.overlay [data-nd-name]', 'E2E ghost element');
    await page.click('.overlay [data-nd-create]');
    ok(await page.isChecked('.overlay .d-pick:has-text("E2E ghost element") input'), 'inline element tagged in the modal');
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
    ok(await page.isChecked('.overlay .d-pick:has-text("E2E identity proof") input'), 'inline data element tagged');
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

    /* as-is: add a step, fork, then remove the forked copy so diff shows a ghost */
    await page.click('[data-ver="asis"]');
    await page.waitForURL(/v=asis/); await page.waitForSelector('[data-ins]');
    await page.click('[data-ins="root"] >> nth=0');
    await act('step');
    await page.fill('.overlay input[name=title]', 'Check ID by hand');
    await saving(() => act('save'));
    await page.click('[data-fork]');
    await saving(() => act('yes'));
    await page.waitForURL(/v=tobe/); await page.waitForSelector('[data-ins]');
    proc = await getProc(newPid);
    const forked = flat(proc.tobe);
    ok(forked.length === 1 && forked[0].title === 'Check ID by hand' && forked[0].from === flat(proc.asis)[0].id && forked[0].id !== flat(proc.asis)[0].id, 'fork copied as-is with fresh ids and from links');
    await page.click('.node:has-text("Check ID by hand") [data-ed="del"]');
    await saving(() => act('yes'));
    await page.click('[data-ins="root"] >> nth=0');
    await act('step');
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
    ok(hist.some(h => /Added step 'Verify identity' to to-be/.test(h)), 'history shows "Added step \'Verify identity\' to to-be"');
    ok(hist.some(h => /Added parallel gateway 'Set up vendor'/.test(h)), 'history shows parallel gateway');
    ok(hist.some(h => /Forked to-be from as-is/.test(h)), 'history shows fork');

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
    ok(await page.isVisible('.hdr .chip:has-text("Examples only")'), 'availability edit persisted');
    ok(await page.isVisible('.hdr .d-sens:has-text("PII")'), 'sensitivity badge shows PII');
    ok(await page.isVisible('.d-resolved .d-resnote:has-text("Pattern now allows")'), 'discovered requirement resolved with note');
    ok(((await getData(did)).discovered[0].resolved || {}).by === me, 'resolved saved with author');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    ok((await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent))).some(t => /sensitivity unclassified → PII/.test(t)), 'data history shows sensitivity change');
    await shot('data-new'); await overflow('data @1440');
    /* another persona sees owner-only controls disabled */
    await page.selectOption('#persona', other.id);
    await page.waitForSelector('[data-dedit][disabled]');
    ok(await page.isDisabled('[data-fadd]') && await page.isDisabled('[data-fedit="0"]') && await page.isDisabled('[data-dedit]'), 'non-owner: edit, availability, spec and sensitivity controls disabled');
    ok(await page.isVisible(`.d-only:has-text("Only ${meName} can change this")`), 'non-owner sees "Only <owner> can change this"');
    await shot('data-nonowner');
    await page.selectOption('#persona', me);
    await page.waitForSelector('[data-dedit]:not([disabled])');

    const seedData = (st.docs.dataElement || []).map(d => d.data).find(d => d.avail === 'missing') || st.docs.dataElement[0].data;
    await nav(`/data/${seedData.id}`);
    ok(await page.isVisible('text=Impact: every step that uses this'), 'seed data page renders impact');
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
    ok(await page.isVisible('label.d-import:has-text("Import BPMN as new version")'), 'R5: process page offers "Import BPMN as new version"');
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
    await page.click('[data-start-project]');
    await page.waitForSelector('.overlay input[name=target]');
    await page.fill('.overlay input[name=name]', '');
    await act('create');
    await page.waitForSelector('.overlay .d-err');
    ok(/needs a name/.test(await page.textContent('.overlay .d-err')), 'start project: name required');
    const tgt = new Date(st.today + 'T12:00:00'); tgt.setDate(tgt.getDate() + 45); const target = tgt.toISOString().slice(0, 10);
    await page.fill('.overlay input[name=name]', 'E2E Northwind rollout');
    await page.fill('.overlay input[name=target]', target);
    ok(await page.inputValue('.overlay select[name=pm]') === me && await page.inputValue('.overlay select[name=rm]') === me, 'R5: start project asks for project manager and release manager (default: you)');
    await page.selectOption('.overlay select[name=rm]', other1.id);
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
    ok(pev.some(e => /Started project 'E2E Northwind rollout' from the to-be/.test(e.summary)), 'project creation event is in history');
    await nav(`/process/${impPid}?mode=tobe`);
    ok(await page.isVisible('.side .row:has-text("E2E Northwind rollout")'), 'process side panel lists the new project');

    console.log('# R3: data page — effective state, resolution plan, plain-language profile');
    const mkData = async (name, avail) => { const id = 'de-e2e-' + Math.random().toString(36).slice(2, 8); ok(await putDoc('dataElement', id, { id, name, owner: me, source: '', avail, note: '', fields: [], samples: [], discovered: [] }, 'Test fixture: ' + name) === 200, 'fixture: ' + name); return id; };
    const exId = await mkData('E2E examples-only feed', 'example');
    const msId = await mkData('E2E missing feed', 'missing');
    await nav(`/data/${exId}`);
    ok(await page.isVisible('[data-resolution="example"] .d-b-amber:has-text("Needs a live source before go-live")'), 'examples-only element: amber "Needs a live source before go-live"');
    ok(/No resolution plan/.test(await page.textContent('[data-noplan]')), 'examples-only element without resolver: "No resolution plan"');
    await shot('data-examples-only');
    await nav(`/data/${msId}`);
    ok(await page.isVisible('[data-resolution="missing"] [data-noplan]') && await page.isVisible('.hdr [data-eff="missing"]'), 'missing element: red "No resolution plan"');
    const wid = 'wi-e2e-' + Math.random().toString(36).slice(2, 8);
    ok(await putDoc('workItem', wid, { id: wid, projectId: prjId, pid: impPid, step: flat(imp.tobe)[0].id, title: 'Connect the E2E feed', owner: me, status: 'done', start: st.today, due: st.today, doneAt: st.today, deps: [], resolves: msId, kind: 'access' }, 'Test fixture: resolver done') === 200, 'fixture: done resolver');
    await nav(`/data/${msId}`);
    console.log('# R4: pending until the data owner confirms live');
    ok(ENG.effectiveAvail((await state()).docs, msId) === 'pending', 'engine: resolver done -> pending');
    ok(await page.isVisible('.hdr [data-eff="pending"]:has-text("Fix done, awaiting owner confirmation")') && !(await page.$('[data-noplan]')), 'resolver done: header shows amber "Fix done, awaiting owner confirmation"');
    ok(await page.isVisible(`[data-resolution="pending"] .d-b-amber:has-text("awaiting ${meName} to confirm")`), `resolution plan: "awaiting ${meName} to confirm"`);
    ok(await page.isVisible('[data-confirm-card] [data-confirm-live]:not([disabled])'), 'owner sees "Confirm live"');
    /* the pending element on a map step: card, step page, side panel, index */
    const ip = await getProc(impPid); const pstep = flat(ip.tobe)[0]; pstep.data = [...new Set([...(pstep.data || []), msId])];
    ok(await putDoc('process', impPid, ip, 'Test fixture: tag pending data') === 200, 'fixture: step uses the pending element');
    await nav(`/process/${impPid}?mode=tobe`);
    ok(/1 awaiting confirmation/.test(await page.textContent(`#canvas .node[data-step="${pstep.id}"] .d-pend`)), 'map card: amber "1 awaiting confirmation"');
    ok(await page.isVisible('[data-pend-steps]:has-text("Fix done, awaiting owner confirmation")'), 'process panel: pending section');
    ok(await page.isVisible(`[data-hl="${msId}"] .r a:has-text("Pending")`), 'process panel data row: Pending');
    await shot('process-pending');
    await nav(`/process/${impPid}/step/${pstep.id}`);
    ok(await page.isVisible(`.d-pend-s:has-text("Fix done, awaiting ${meName} to confirm")`) && await page.isVisible('[data-eff="pending"]:has-text("Pending")'), 'step page: pending chip and "awaiting <owner> to confirm"');
    await nav('/processes');
    const pcount = await page.getAttribute(`[data-prow="${impPid}"] [data-datacounts]`, 'data-datacounts');
    ok(pcount.split('/')[1] === '1', 'process index: 1 pending element (' + pcount + ')');
    /* non-owner cannot confirm */
    await nav(`/data/${msId}`);
    await page.selectOption('#persona', other.id);
    await page.waitForSelector('[data-confirm-live][disabled]');
    ok(await page.isVisible(`.d-only:has-text("Only ${meName} (data owner) can confirm")`), 'non-owner: Confirm live disabled with the owner named');
    await page.selectOption('#persona', me);
    await page.waitForSelector('[data-confirm-live]:not([disabled])');
    await page.click('[data-confirm-live]');
    await page.waitForSelector('.overlay [data-confprof]');
    ok(/No profile yet/.test(await page.textContent('.overlay [data-confprof]')), 'confirm dialog: no profile yet');
    console.log('# R5: confirm live needs evidence (profile / connection check / attested link + note)');
    ok(await page.$eval('.overlay input[name=ev][value=profile]', e => e.disabled), 'R5: profile evidence unavailable without a profile');
    ok(await page.isVisible('.overlay [data-evopt="attested"] .d-ev-weak:has-text("Attested · weaker")'), 'R5: attested option labelled weaker');
    await page.fill('.overlay input[name=source]', '');
    await act('confirm');
    await page.waitForSelector('.overlay .d-err');
    ok(/Name the live source/.test(await page.textContent('.overlay .d-err')), 'confirm live requires a source');
    await page.fill('.overlay input[name=source]', 'Northwind ERP vendor API (read)');
    await act('confirm');
    await page.waitForSelector('.overlay .d-err');
    ok(/Choose the evidence/.test(await page.textContent('.overlay .d-err')), 'R5: confirm live requires evidence: ' + await page.textContent('.overlay .d-err'));
    /* (b) a connection check that fails (the element is still marked missing) cannot be evidence */
    const ck1 = page.waitForResponse(r => r.url().includes('/check/') && r.request().method() === 'POST');
    await page.click('.overlay [data-run-check]'); const ckr = await ck1; ok(ckr.ok(), 'R5: connection check endpoint answered ' + ckr.status());
    await page.waitForSelector('.overlay [data-check-result].fail');
    ok(/Failed/.test(await page.textContent('.overlay [data-check-result]')), 'R5: failed check shown in the dialog: ' + (await page.textContent('.overlay [data-check-result]')).slice(0, 80));
    await act('confirm');
    await page.waitForSelector('.overlay .d-err:has-text("did not pass")');
    ok(true, 'R5: a failed connection check blocks the confirmation');
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
    ok(await page.isVisible('.hdr [data-eff="live"]') && await page.isVisible(`[data-confirmed]:has-text("Confirmed live by ${meName}")`) && !(await page.$('[data-confirm-card]')), 'after reload: live, "Confirmed live by <owner>", no confirm card');
    ok(await page.isVisible('.hdr [data-evidence="attested"]:has-text("Attested (weaker)")'), 'R5: data page shows the evidence type (attested, weaker)');
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
    ok(await page.isVisible('.d-resolve .badge.b-done:has-text("Ready")'), 'resolution plan shows Ready');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    ok((await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent))).some(t => /Confirmed 'E2E missing feed' live \(source: Northwind ERP vendor API/.test(t)), 'history shows the confirmation');
    await page.click('[data-dedit]');
    ok(await page.$$eval('.overlay select[name=avail] option', os => os.map(o => o.value).join(',')) === 'live,example,missing', 'edit dialog keeps "live" only for a live element');
    await act('cancel');
    await nav(`/data/${exId}`);
    await page.click('[data-dedit]');
    ok(!(await page.$$eval('.overlay select[name=avail] option', os => os.map(o => o.value))).includes('live'), 'edit dialog cannot set live directly (Confirm live only)');
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
        await page.selectOption('#persona', profD.owner);
        await page.waitForSelector('[data-confirm-live]:not([disabled])');
        await page.click('[data-confirm-live]');
        await page.waitForSelector('.overlay [data-confprof]');
        ok(/Latest profile · 40 rows/.test(await page.textContent('.overlay [data-confprof]')), 'confirm dialog shows the latest profile summary: ' + (await page.textContent('.overlay [data-confprof]')).trim().slice(0, 70));
        const blk = ENG.specDrift(profD, (await state()).docs.profile.map(d => d.data).filter(x => x.dataId === prof.id).sort((a, b) => b.at.localeCompare(a.at))[0]).filter(d => d.issue !== 'unspecified-column').length;
        const shownBlk = await page.getAttribute('.overlay [data-blocking]', 'data-blocking').catch(() => null);
        ok(String(blk) === String(shownBlk === null ? 0 : shownBlk), `R5: dialog shows ${blk} blocking drift issue(s)`);
        ok(await page.$eval('.overlay input[name=ev][value=profile]', e => e.disabled) === blk > 0, 'R5: profile evidence blocked exactly when there are blocking issues');
        await page.screenshot({ path: `${OUT}/confirm-live-profile.png` });
        await act('cancel');
        await page.selectOption('#persona', me);
      } else ok(true, 'profiled element is already live (confirm dialog profile check skipped)');
    }
    const exStep = flat(seedP.tobe).find(n => (n.data || []).some(d => ENG.effectiveAvail(D0(), d) === 'example'));
    if (exStep) { await nav(`/process/${pid}/step/${exStep.id}`); ok(await page.isVisible('.d-needlive-s:has-text("Needs a live source before go-live")'), 'step page: examples-only data marked amber'); await iconCheck('step page'); }

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
    ok(/\d+ to-be · \d+ as-is/.test(await page.textContent(`[data-hl="${useIds[0]}"] [data-usage]`)), 'process panel counts are labelled "to-be · as-is"');
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
    await page.selectOption('#persona', outsider.id);
    await nav(`/process/${pid}?mode=edit`);
    ok(await page.isVisible('[data-edit-denied]') && !(await page.$('[data-ins]')) && !(await page.$('.d-editbar')), 'non-editor opening Edit gets the read-only map, no editor controls');
    ok(await page.isVisible(`[data-readonly]:has-text("Ask ${ownerName} for edit access")`), `non-editor sees "Ask ${ownerName} for edit access"`);
    ok(await page.$eval('.d-modes [data-mode="edit"]', b => b.getAttribute('aria-disabled') === 'true'), 'Edit tab is locked for non-editors');
    ok(!(await page.$('[data-save-version]')) && !(await page.$('[data-draft-restore]')) && !(await page.$('[data-bpmn-file]')), 'no Save version / Restore / Import as version for non-editors');
    await shot('process-readonly'); await iconCheck('process read-only');
    await saving(() => page.click('[data-ask-access]'));
    ok((await state()).docs.notification.some(n => n.data.to === seedP.owner && /asked for edit access/.test(n.data.text)), 'Ask for access notifies the owner');
    const nErr = errors.length;
    const put403 = await page.evaluate(async ([id, actor]) => { const st = await (await fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/state`)).json(); const p = st.docs.process.find(d => d.id === id).data;
      return (await fetch(`/api/pmoflow/ws/${localStorage.getItem('pmoflow.ws')}/doc/process/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: Object.assign({}, p, { name: 'hijack' }), actor, summary: 'x' }) })).status; }, [pid, outsider.id]);
    ok(put403 === 403, 'server rejects a non-editor process PUT with 403');
    await page.selectOption('#persona', me);
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
    await page.click('[data-save-version]'); await page.waitForSelector('.overlay input[name=name]');
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
    await page.click('[data-compare-open]'); await page.waitForURL(/mode=compare/); await settle();
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
    await saving(() => page.click('[data-undo]'));
    ok(flat((await getProc(impPid)).tobe)[0].title === s0.title, 'Undo restored the previous step title');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    ok((await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent))).some(t => /Undid: Edited step/.test(t)), 'history shows the undo');
    /* max 10 */
    ipv = await getProc(impPid);
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: 'ver-e2e-' + i, name: 'Fixture ' + i, at: new Date().toISOString(), by: me, asis: [], tobe: [] }));
    ok(await putDoc('process', impPid, Object.assign({}, ipv, { drafts: ten }), 'Test fixture: 10 drafts') === 200, 'fixture: 10 saved versions');
    await nav(`/process/${impPid}?mode=tobe`);
    await page.click('[data-save-version]'); await page.waitForSelector('.overlay:has-text("Saved versions are full")');
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
    fs.writeFileSync(`${OUT}/imp-revised.bpmn`, xml2);
    await page.setInputFiles('[data-bpmn-file]', `${OUT}/imp-revised.bpmn`);
    await page.waitForSelector('.overlay [data-impsum]');
    const dropTxt = await page.textContent('.overlay [data-dropped]');
    ok(+(await page.getAttribute('.overlay [data-dropped]', 'data-dropped')) === 3 && /Orphan task/.test(dropTxt) && /not connected/.test(dropTxt) && /Invoice PDF/.test(dropTxt) && /Reviewer note|TA_1/.test(dropTxt), 'dropped elements listed before confirming: ' + dropTxt.replace(/\s+/g, ' ').slice(0, 160));
    ok(new RegExp(`${fl.length - 1}\\s*matched`).test(await page.textContent('.overlay [data-impsum]')) && /1\s*new/.test(await page.textContent('.overlay [data-impsum]')), 'import summary: matched / new by name: ' + (await page.textContent('.overlay [data-impsum]')).replace(/\s+/g, ' '));
    await page.screenshot({ path: `${OUT}/import-version-modal.png` });
    await overflow('import version modal @1440');
    await saving(() => act('import'));
    await page.waitForURL(/mode=diff/);
    const ipi = await getProc(impPid);
    const fi = flat(ipi.tobe);
    const keptOk = fl.filter(n => n.id !== ren.id).every(o => { const n = fi.find(x => x.id === o.id); return n && n.title === o.title && JSON.stringify(n.data || []) === JSON.stringify(o.data || []) && JSON.stringify(n.subs || []) === JSON.stringify(o.subs || []) && n.owner === o.owner && (n.from || '') === (o.from || ''); });
    ok(keptOk && fi.length === fl.length, 'matched steps keep id, data tags, sub-steps, owners and as-is links');
    ok(fi.some(n => n.title === ren.title + ' (revised)' && n.id !== ren.id) && !fi.some(n => n.id === ren.id), 'renamed step comes in as new; the old one leaves the to-be');
    ok(ipi.id === impPid && ipi.drafts.some(d => d.name === 'Before import of imp-revised.bpmn'), 'still the same process; the previous version was saved first');
    ok((await getProc(impPid)).asis.length === ipv.asis.length, 'as-is untouched by a to-be import');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    ok((await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent))).some(t => /Imported 'imp-revised.bpmn' as a new to-be version/.test(t)), 'history shows the version import');
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
    ok(created && created.owner === me && (sO.owner === me || created.owner !== sO.owner), `inline-created element is owned by the creator (${created && created.owner}), not the step owner (${sO.owner})`);
    await nav(`/process/${impPid}?mode=tobe`); await page.click('[data-newdata]'); await page.waitForSelector('.overlay select[name=owner]');
    ok(await page.inputValue('.overlay select[name=owner]') === me, 'New data element dialog: owner defaults to the creator'); await act('cancel');

    console.log('# phone 390');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const m of ['asis', 'tobe', 'diff', 'lanes', 'edit', 'compare']) { await nav(`/process/${pid}?mode=${m}`); await overflow(`process ${m} @390`); await shot('phone-process-' + m); }
    console.log('# R5: phone — the map starts near the top; KPIs and controls collapse into a summary row');
    await nav(`/process/${pid}?mode=tobe`);
    const ph = await page.evaluate(() => ({ top: document.querySelector('#canvas').getBoundingClientRect().top + scrollY, tools: !!document.querySelector('.d-hdr .d-hdrtools').offsetParent, kpis: !!document.querySelector('.d-hdr .kpis').offsetParent, sum: !!document.querySelector('[data-hdr-toggle]').offsetParent }));
    ok(ph.sum && !ph.tools && !ph.kpis, 'phone: summary row shown, controls and KPIs collapsed');
    ok(ph.top < 340, `phone: process map starts near the top (${Math.round(ph.top)} px)`);
    ok(/\d+ steps · \d+\+\d+ new\/changed · \d+\/\d+ data live/.test(await page.textContent('[data-hdr-toggle]')), 'phone summary row: steps, new/changed, data live');
    await page.click('[data-hdr-toggle]');
    ok(await page.isVisible('.d-hdr .d-hdrtools') && await page.isVisible('.d-hdr .kpis') && await page.getAttribute('[data-hdr-toggle]', 'aria-expanded') === 'true', 'phone: expand shows controls and KPIs');
    await overflow('phone header expanded @390'); await shot('phone-process-expanded');
    await page.click('[data-hdr-toggle]');
    ok(!(await page.isVisible('.d-hdr .kpis')), 'phone: collapse again');
    await page.selectOption('#persona', outsider.id); await nav(`/process/${pid}?mode=edit`); await overflow('read-only @390'); await shot('phone-readonly'); await page.selectOption('#persona', me);
    await nav(`/process/${impPid}?mode=compare`); await overflow('compare @390'); await shot('phone-compare');
    await nav(`/data/${ckId}`); await overflow('data checked @390'); await shot('phone-data-evidence');
    await nav(`/process/${pid}?mode=edit`);
    ok(await page.$eval('.branches', el => getComputedStyle(el).flexDirection) === 'column', 'branches stack at 390');
    await page.click('[data-ins="root"] >> nth=0');
    ok(await page.isVisible('.overlay [data-act="step"]'), 'insert point usable at 390');
    await act('step');
    await page.waitForSelector('.overlay input[name=title]');
    await page.screenshot({ path: `${OUT}/phone-step-modal.png` });
    await act('cancel');
    await nav(`/process/${pid}?mode=asis&rel=${rel.version}`); await overflow('released @390');
    const firstStep = flat(seedP.tobe)[0];
    await nav(`/process/${pid}/step/${firstStep.id}`); await overflow('step @390'); await shot('phone-step');
    await nav(`/data/${did}`); await overflow('data @390'); await shot('phone-data');
    await nav(`/data/${seedData.id}`); await overflow('data seed @390');
    await nav(`/process/${impPid}?mode=edit`); await overflow('imported edit @390'); await shot('phone-imported-edit');
    await nav('/processes'); await overflow('processes @390'); await shot('phone-processes');
    await nav(`/data/${did}`); await page.click('[data-fedit="0"]'); await page.waitForSelector('.overlay .d-fmts'); await overflow('spec builder @390'); await page.screenshot({ path: `${OUT}/phone-spec-builder.png` }); await act('cancel');
    if (stepWithWork) { await nav(`/process/${pid}/step/${stepWithWork.step}`); await page.click('.d-why summary'); await overflow('step why @390'); await shot('phone-step-why'); }
    await nav(`/process/${impPid}?mode=tobe`); await page.click('[data-start-project]'); await page.waitForSelector('.overlay input[name=target]');
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
