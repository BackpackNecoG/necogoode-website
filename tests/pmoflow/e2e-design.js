/* E2E for stream D (process / step / data pages), rounds 1 to 3.
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
    const lanesFit = await page.evaluate(() => { const w = document.querySelector('.d-lanewrap'), c = document.querySelector('#canvas'); const hs = [...w.querySelectorAll('.lane-h')]; const last = hs[hs.length - 1].getBoundingClientRect(); return { lanes: hs.length, fits: last.right <= w.getBoundingClientRect().right + 1, scrolls: getComputedStyle(w).overflowX === 'auto', inCanvas: w.getBoundingClientRect().right <= c.getBoundingClientRect().right + 1 }; });
    ok(lanesFit.fits && lanesFit.inCanvas, `all ${lanesFit.lanes} lanes visible inside the canvas at 1440`);
    ok(lanesFit.scrolls, 'lane area scrolls horizontally when it does not fit');

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
    await page.click('[data-fadd]');
    await page.fill('.overlay input[name=name]', 'Document number');
    await page.selectOption('.overlay select[name=type]', 'digits');
    await page.fill('.overlay input[name=rule]', 'Required');
    await page.fill('.overlay input[name=length]', '9');
    await page.fill('.overlay input[name=pattern]', '^\\d{9}$');
    await page.check('.overlay input[name=required]');
    await saving(() => act('save'));
    await page.click('[data-fedit="0"]');
    await page.fill('.overlay input[name=format]', '9 digits');
    await saving(() => act('save'));
    await page.click('[data-fadd]');
    await page.fill('.overlay input[name=name]', 'Temp field');
    await saving(() => act('save'));
    await page.click('[data-fdel="1"]');
    await saving(() => act('yes'));
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
    ok(await page.isVisible('text=Impact: every step that depends on this'), 'seed data page renders impact');
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


    console.log('# R3: BPMN import round trip (seed to-be)');
    await nav(`/process/${pid}?mode=tobe`);
    ok(await page.isVisible('label.d-import:has-text("Import BPMN")'), 'Import BPMN button on the process page');
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
    ok(await page.isVisible('.hdr [data-eff="live"]') && !(await page.$('[data-noplan]')), 'resolver done: effectively live, no "No resolution plan"');
    ok(await page.isVisible('.d-resolve .badge.b-done:has-text("Ready")'), 'resolution plan shows Ready');
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
    }
    const exStep = flat(seedP.tobe).find(n => (n.data || []).some(d => ENG.effectiveAvail(D0(), d) === 'example'));
    if (exStep) { await nav(`/process/${pid}/step/${exStep.id}`); ok(await page.isVisible('.d-needlive-s:has-text("Needs a live source before go-live")'), 'step page: examples-only data marked amber'); await iconCheck('step page'); }

    console.log('# phone 390');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const m of ['asis', 'tobe', 'diff', 'lanes', 'edit']) { await nav(`/process/${pid}?mode=${m}`); await overflow(`process ${m} @390`); await shot('phone-process-' + m); }
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
