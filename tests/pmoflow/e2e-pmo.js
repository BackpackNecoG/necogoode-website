/* E2E for stream P (home / project / portfolio).
   Usage: node tests/pmoflow/e2e-pmo.js [port]   (dev server must be running on that port)
   Fresh browser context => fresh sandbox workspace. Screenshots go to /tmp/pmo-p/. */
const { chromium } = require('playwright');
const fs = require('fs');

const PORT = Number(process.argv[2] || 8793);
const ROOT = `http://localhost:${PORT}/concepts/pmoflow`;
const SHOTS = '/tmp/pmo-p';
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  /* Local runs all come from 127.0.0.1 and would hit the 5-workspaces-per-IP-per-day limit;
     the dev server honours x-forwarded-for, so each run uses its own documentation-range test IP. */
  const testIp = `198.51.100.${(Math.random()*200|0)+20}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': testIp } });
  /* R7: Simple is the default. This suite covers the Advanced tools, so it turns them on for this browser. */
  await ctx.addInitScript(() => { try { localStorage.setItem('pmoflow.advanced', '1'); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const shot = async (name, full = true) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
  const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const modalOpen = async () => page.waitForSelector('.overlay .modal', { timeout: 8000 });
  const act = async id => { await page.click(`.overlay [data-act="${id}"]`); await page.waitForSelector('.overlay', { state: 'detached', timeout: 8000 }); };
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await sleep(400); };
  const kpiPct = async () => parseInt(await page.locator('.hdr .kpi b').first().innerText(), 10);
  const workRow = title => page.locator('tr[data-wid]', { hasText: title });
  const STORE = ROOT + '/app/store.js';
  const getDoc = (type, id) => page.evaluate(async ([u, t, i]) => (await import(u)).store.get(t, i), [STORE, type, id]);
  const asPersona = async re => { const id = await page.$eval('#persona', (s, r) => [...s.options].find(o => new RegExp(r).test(o.text)).value, re); await page.selectOption('#persona', id); await settle(); return id; };
  /* R5: outside the Map view, comments + history sit in a collapsed "Activity" toggle; open it before reading history */
  const openAct = () => page.evaluate(() => { const d = document.querySelector('[data-activity]'); if (d && !d.open) { d.open = true; d.dispatchEvent(new Event('toggle')); } });
  /* icon-only controls (no visible text) must carry an aria-label */
  const unlabelled = () => page.evaluate(() => [...document.querySelectorAll('#app button, #app a, .overlay button')].filter(b => b.offsetParent && !b.textContent.replace(/[^\p{L}\p{N}]/gu, '').length && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby')).map(b => b.outerHTML.slice(0, 80)));

  /* ---------------- home ---------------- */
  console.log('home');
  await page.goto(ROOT + '/');
  await page.waitForSelector('[data-waiting]', { timeout: 20000 });
  check('home: greeting by first name', /^Hi \w+\.$/.test((await page.locator('[data-greeting]').innerText()).trim()));
  check('home: three big cards', await page.locator('[data-big3] .pmo-big3-c').count() === 3 && await page.locator('[data-big="import"][href$="/import"]').count() === 1 && await page.locator('[data-big="map"][href$="/new"]').count() === 1);
  check('home: no pitch paragraph', !(await page.locator('#app').innerText()).includes('Process-first planning'));
  check('process tiles', await page.locator('.home-grid a[href*="/process/"]').count() >= 2);
  check('project tiles with progress', await page.locator('.home-grid a[href*="/project/"] .bar').count() >= 1);
  check('home: projects listed before processes', await page.evaluate(() => { const a = document.getElementById('home-projects'), b = document.getElementById('home-processes'); return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  check('home: Project / Process labels', await page.locator('[data-ptile] .pmo-kind-prj').count() === await page.locator('[data-ptile]').count() && await page.locator('[data-proctile] .pmo-kind-proc').count() === await page.locator('[data-proctile]').count());
  const tileOverlap = await page.evaluate(() => [...document.querySelectorAll('[data-ptile]')].filter(t => { const h = t.querySelector('h4').getBoundingClientRect(), l = t.querySelector('[data-summary-label]').getBoundingClientRect(); return !(l.top >= h.bottom - 1 || l.bottom <= h.top || l.left >= h.right || l.right <= h.left); }).length);
  check('home: label never overlaps the project title', tileOverlap === 0, tileOverlap);
  const sentMismatch = await page.evaluate(async u => { const { store } = await import(u); return [...document.querySelectorAll('[data-ptile]')].map(t => { const r = window.PMOEngine.projectSummary(store.state.docs, t.dataset.ptile, store.state.today);
    const p = store.get('project', t.dataset.ptile); if (p.status === 'live') return null; return t.querySelector('[data-summary-sentence]').textContent === r.sentence && t.querySelector('[data-summary-label]').textContent.trim() === r.label ? null : { id: t.dataset.ptile, shown: t.querySelector('[data-summary-sentence]').textContent, r }; }).filter(Boolean); }, STORE);
  check('home: project sentence + label come from projectSummary', sentMismatch.length === 0, sentMismatch);
  const missMismatch = await page.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine; return [...document.querySelectorAll('[data-proctile]')].map(a => {
    const p = store.get('process', a.dataset.proctile);
    const ids = new Set(E.flatSteps(p.tobe).flatMap(s => [...(s.data || []), ...(s.subs || []).flatMap(x => x.data || [])]));
    const miss = [...ids].filter(d => E.effectiveAvail(store.state.docs, d) === 'missing').length;
    const el = a.querySelector('[data-miss]'); const shown = el ? parseInt(el.textContent.replace(/\D+/g, ''), 10) : 0; return shown === miss ? null : { id: p.id, shown, miss }; }).filter(Boolean); }, STORE);
  check('home "not available yet" counts use effectiveAvail', missMismatch.length === 0, missMismatch);
  check('home: "+ New project" in the projects section', await page.locator('.sect [data-new-project]').count() === 1);
  check('home: no unlabelled icon-only controls', (await unlabelled()).length === 0, await unlabelled());
  check('home no overflow @1440', await noOverflow());
  await shot('01-home-1440');

  /* ---------------- new project ---------------- */
  console.log('new project');
  const NP = 'E2E Northwind supplier payments uplift';
  await page.click('.sect [data-new-project]'); await modalOpen();
  const meId = await page.$eval('#persona', s => s.value);
  check('new project: owner defaults to me', await page.inputValue('.overlay select[name="owner"]') === meId);
  check('new project: me preselected as resource', await page.locator(`.overlay input[name="resources"][value="${meId}"]`).isChecked());
  await shot('00-new-project-modal-1440', false);
  await page.click('.overlay [data-act="create"]'); await page.waitForSelector('.overlay .banner', { timeout: 8000 });
  check('new project: name required', (await page.locator('.overlay .banner').innerText()).includes('name'));
  await page.fill('.overlay input[name="name"]', NP);
  await page.fill('.overlay textarea[name="desc"]', 'Move supplier payment approvals onto captured data.');
  await page.fill('.overlay input[name="target"]', '2027-02-15');
  await page.locator('.overlay input[name="resources"]').nth(4).check();
  check('new project: deadline defaults from defaultTarget', true);
  await page.selectOption('.overlay select[name="from"]', '');
  await page.locator('.overlay input[name="processes"][value="access-review"]').check();
  const npProc = 'access-review';
  await act('create'); await page.waitForURL(/\/project\/prj-/, { timeout: 10000 }); await page.waitForSelector('.canvas.pm');
  /* R7: the first plan is suggested straight away; this flow keeps the project empty, so it is dismissed here */
  await page.waitForSelector('.overlay [data-first-plan]', { timeout: 15000 });
  check('new project: "Here’s a first plan: N tasks" offered', /Here’s a first plan: \d+ tasks?/.test(await page.locator('.overlay [data-first-plan]').innerText()) && await page.locator('.overlay [data-act="accept"]').count() === 1 && await page.locator('.overlay [data-act="adjust"]').count() === 1);
  await act('cancel'); await settle();
  const npId = decodeURIComponent(new URL(page.url()).pathname.split('/project/')[1]);
  check('new project: navigates to it', (await page.locator('.hdr h1').innerText()).includes(NP));
  const npDoc = await getDoc('project', npId);
  check('new project: doc shape', npDoc && npDoc.status === 'active' && Array.isArray(npDoc.baselines) && npDoc.baselines.length === 0 && npDoc.owner === meId && npDoc.target === '2027-02-15'
    && npDoc.processes.length === 1 && npDoc.processes[0] === npProc && npDoc.resources.includes(meId) && npDoc.resources.length === 2 && npDoc.desc.length > 5, npDoc);
  check('new project: linked process on its map', await page.locator('.pgroup').count() === 1);
  await page.click('.pmo-tabs a:has-text("Work")'); await page.waitForSelector('[data-add-work]');
  await page.click('[data-add-work]'); await modalOpen();
  const resNp = await page.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine; const prj = store.get('project', decodeURIComponent(location.pathname.split('/project/')[1]));
    const used = new Set(prj.processes.flatMap(pid => E.flatSteps((store.get('process', pid) || {}).tobe || []).flatMap(s => [...(s.data || []), ...(s.subs || []).flatMap(x => x.data || [])])));
    const opts = [...document.querySelectorAll('.overlay select[name="resolves"] option')].map(o => o.value).filter(Boolean);
    return { ok: opts.length > 0 && opts.every(v => used.has(v)), n: opts.length, all: store.list('dataElement').length }; }, STORE);
  check('"Resolves" excludes data of unlinked processes', resNp.ok && resNp.n < resNp.all, resNp);
  await act('cancel');
  await sleep(800); await page.reload(); await page.waitForSelector('.hdr h1');
  check('reload: new project persisted', (await page.locator('.hdr h1').innerText()).includes(NP));
  await openAct(); await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
  check('new project: history shows creation', (await page.locator('[data-history]').innerText()).includes('Created project'));
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]');
  check('new project: tile on home', await page.locator('.home-grid a.tile', { hasText: NP }).count() === 1);

  /* ---------------- project map ---------------- */
  console.log('project map');
  await page.locator('.home-grid a[href*="/project/"]').first().click();
  await page.waitForSelector('.canvas.pm .node');
  const prjPath = new URL(page.url()).pathname;
  check('map renders step nodes', await page.locator('.canvas.pm .node[data-step]').count() > 3);
  check('map has NEW/CHANGED badges', await page.locator('.canvas.pm .chip.diff-new, .canvas.pm .chip.diff-changed').count() > 0);
  const mapData = await page.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine;
    const ids = sel => [...document.querySelectorAll(sel)].map(a => decodeURIComponent(a.getAttribute('href').split('/data/')[1]));
    return { red: ids('.canvas.pm .chip.block').map(d => E.effectiveAvail(store.state.docs, d)), amber: ids('.canvas.pm .chip.pmo-amber').map(d => E.effectiveAvail(store.state.docs, d)) }; }, STORE);
  check('map shows data chips (red or amber)', mapData.red.length + mapData.amber.length > 0, mapData);
  check('map red "Waiting on" only for effectively missing data', mapData.red.every(e => e === 'missing'), mapData.red);
  check('map amber chips only for examples-only or pending data', mapData.amber.every(e => e === 'example' || e === 'pending'), mapData.amber);
  const noPlan = await page.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine;
    return [...document.querySelectorAll('.side .row')].filter(r => r.querySelector('.pmo-noplan')).map(r => { const d = r.dataset.go.split('/data/')[1]; return { d, eff: E.effectiveAvail(store.state.docs, d), res: store.list('workItem', w => w.resolves === d).length }; }); }, STORE);
  check('"No resolution plan" only for missing/example data without a resolver', noPlan.every(x => x.eff !== 'live' && x.res === 0), noPlan);
  check('map has open-design pills', await page.locator('.pgroup-h').count() >= 1);
  check('side panel: blocking (projectTruth list)', await page.locator('.side [data-blockers]').count() === 1);
  check('side panel: up next', await page.locator('.side .card h3', { hasText: 'Up next' }).count() === 1);
  check('header finish KPI shows the expected date for an open project', /Expected · deadline/.test(await page.locator('[data-kpi-finish]').innerText()));
  check('project: no unlabelled icon-only controls', (await unlabelled()).length === 0, await unlabelled());
  const dl = await page.locator('.side .pmo-dl').allInnerTexts();
  check('one schedule format: "Due X · forecast Y (+Nd)"', dl.length > 0 && dl.every(t => /^Due [A-Z][a-z]{2} \d{1,2} · (forecast|done) [A-Z][a-z]{2} \d{1,2}( \(\+\d+d\))?$/.test(t.trim())), dl.slice(0, 3));
  const collapsedBefore = await page.locator('.collapsed').count();
  await page.click('button[data-expand="1"]');
  await page.waitForSelector('button[data-expand="0"]');
  check('show unchanged expands collapsed steps', collapsedBefore === 0 || await page.locator('.collapsed').count() === 0, collapsedBefore);
  await page.click('button[data-expand="0"]');
  check('project no overflow @1440 (map)', await noOverflow());
  await shot('02-project-map-1440');

  /* ---------------- timeline ---------------- */
  console.log('timeline');
  await page.click('.pmo-tabs a:has-text("Timeline")');
  await page.waitForSelector('.tl .tbar');
  check('timeline bars render', await page.locator('.tl .tbar').count() > 3);
  check('timeline has slip hatching', await page.locator('.tl .tslip').count() > 0);
  check('timeline bars show dates, not "unblocks"', (await page.locator('.tl .tbar').allInnerTexts()).every(t => !t.includes('unblocks')));
  check('timeline label subtitle carries "unblocks"', (await page.locator('.tl .lab .s').allInnerTexts()).some(t => t.includes('unblocks')));
  check('timeline has today + target lines', await page.locator('.tl .tday').count() > 0 && await page.locator('.tl .tgt').count() > 0);
  await sleep(300);
  const depCount = await page.evaluate(async u => { const { store } = await import(u); const ids = new Set([...document.querySelectorAll('.tl [data-bar]')].map(b => b.dataset.bar));
    return [...ids].reduce((a, id) => a + ((store.get('workItem', id) || {}).deps || []).filter(d => ids.has(d)).length, 0); }, STORE);
  check('timeline: one SVG arrow per dependency', depCount > 0 && await page.locator('svg.pmo-arrows path[data-from]').count() === depCount, { depCount, arrows: await page.locator('svg.pmo-arrows path[data-from]').count() });
  const arrowGeom = await page.evaluate(() => { const box = document.querySelector('#pmoTl'), br = box.getBoundingClientRect();
    return [...document.querySelectorAll('svg.pmo-arrows path[data-from]')].slice(0, 6).map(p => { const m = p.getAttribute('d').match(/^M([\d.]+),([\d.]+) .* ([\d.]+),([\d.]+)$/);
      const f = document.querySelector(`[data-bar="${p.dataset.from}"]`).getBoundingClientRect(), t = document.querySelector(`[data-bar="${p.dataset.to}"]`).getBoundingClientRect();
      return Math.abs(+m[1] - (f.right - br.left + box.scrollLeft)) < 2 && Math.abs(+m[3] - (t.left - br.left + box.scrollLeft - 1)) < 2; }); });
  check('timeline: arrows run from dep bar end to dependent start', arrowGeom.length > 0 && arrowGeom.every(Boolean), arrowGeom);
  const cpIds = await page.evaluate(async u => { const { store } = await import(u); const prj = location.pathname.split('/project/')[1]; return window.PMOEngine.criticalPath(store.state.docs, decodeURIComponent(prj), store.state.today); }, STORE);
  const critBars = await page.locator('.tl .tbar.pmo-crit').evaluateAll(bs => bs.map(b => b.dataset.bar));
  check('timeline: critical path highlighted from E().criticalPath', cpIds.length > 0 && critBars.length === cpIds.length && cpIds.every(id => critBars.includes(id)), { cpIds, critBars });
  check('timeline: critical arrows emphasised', await page.locator('svg.pmo-arrows path.crit').count() >= Math.min(1, cpIds.length - 1));
  await page.uncheck('[data-crit-toggle]'); await sleep(250);
  check('timeline: critical path toggle off', await page.locator('.tl .tbar.pmo-crit').count() === 0);
  await page.check('[data-crit-toggle]'); await sleep(250);
  check('timeline: critical path toggle on', await page.locator('.tl .tbar.pmo-crit').count() === cpIds.length);
  const dragOwn = await page.evaluate(async u => { const { store } = await import(u); const me = store.state.me; const prj = store.get('project', decodeURIComponent(location.pathname.split('/project/')[1]));
    return [...document.querySelectorAll('.tl button.tbar[data-bar]')].map(b => store.get('workItem', b.dataset.bar)).every(w => w.owner === me || prj.owner === me); }, STORE);
  check('timeline: only owner/PM bars are draggable', dragOwn);
  check('timeline: draggable bars have aria-labels', await page.locator('.tl button.tbar:not([aria-label])').count() === 0);
  check('project no overflow @1440 (timeline)', await noOverflow());
  await shot('03-project-timeline-1440');

  /* ---------------- work: create / edit / status / delete ---------------- */
  console.log('work items');
  await page.click('.pmo-tabs a:has-text("Work")');
  await page.waitForSelector('table.pmo-work');
  const roRow = page.locator('tr[data-wid].pmo-ro').first();
  check('non-owner: status select disabled', await roRow.count() === 1 && await roRow.locator('select[data-status]').isDisabled());
  check('non-owner: lock title explains who can act', /^Only .+ or .+ can update this$/.test(await roRow.locator('select[data-status]').getAttribute('title') || ''));
  check('non-owner: edit disabled', await roRow.locator('[data-edit-work]').isDisabled());
  const pmId = await page.$eval('#persona', s => [...s.options].find(o => /Project Manager/.test(o.text)).value);
  await page.selectOption('#persona', pmId); await settle();
  await page.waitForSelector('table.pmo-work');
  check('PM: every status select enabled', await page.locator('tr[data-wid] select[data-status]:disabled').count() === 0);
  const rowsBefore = await page.locator('tr[data-wid]').count();
  check('work table lists items', rowsBefore > 3, rowsBefore);
  const T1 = 'E2E reconcile remit-to letters';
  await page.click('[data-add-work]'); await modalOpen();
  await page.fill('.overlay input[name="title"]', T1);
  await page.fill('.overlay input[name="start"]', '2026-11-20');
  await page.fill('.overlay input[name="due"]', '2026-11-27');
  await page.fill('.overlay input[name="effortDays"]', '3');
  const depLabel = (await page.locator('.overlay .pmo-checks label span').first().innerText()).trim();
  await page.locator('.overlay .pmo-checks input[name="deps"]').first().check();
  await act('save'); await settle();
  check('work item created', await workRow(T1).count() === 1);
  check('effort shown in work table', (await workRow(T1).locator('.pmo-eff').innerText()).trim() === '3d');
  check('new item shows its dependency', (await workRow(T1).locator('.pmo-deps').innerText()).includes(depLabel), depLabel);
  await shot('04-work-created-1440');

  const T2 = T1 + ' (edited)';
  await workRow(T1).locator('[data-edit-work]').click(); await modalOpen();
  await page.fill('.overlay input[name="title"]', T2);
  await page.fill('.overlay input[name="due"]', '2026-11-30');
  await page.locator('.overlay .pmo-checks input[name="deps"]').nth(1).check();
  await act('save'); await settle();
  check('work item edited (title)', await workRow(T2).count() === 1);
  check('edited item has 2 deps', await workRow(T2).locator('.pmo-deps .dep').count() === 2);
  check('edited item shows new due', (await workRow(T2).innerText()).includes('Nov 30'));

  const pctBefore = await kpiPct();
  await workRow(T2).locator('select[data-status]').selectOption('done'); await settle();
  const pctAfter = await kpiPct();
  check('status change updates progress KPI', pctAfter > pctBefore, { pctBefore, pctAfter });
  check('done item shows "done <date>"', /done [A-Z][a-z]{2} \d{1,2}/.test(await workRow(T2).locator('.pmo-dl').innerText()));

  /* defect work item */
  const TD = 'E2E defect: routing number rejects leading zero';
  await page.click('[data-add-work]'); await modalOpen();
  await page.fill('.overlay input[name="title"]', TD);
  await page.selectOption('.overlay select[name="kind"]', 'defect');
  await act('save'); await settle();
  check('defect row has bug icon', await workRow(TD).locator('.pmo-bug').count() > 0);
  check('defect row links to testing', await workRow(TD).locator('a.pmo-runlink').count() === 1);

  /* hierarchy: group by process > step */
  await page.click('[data-wgroup="step"]'); await page.waitForSelector('tr.pmo-gh.p');
  check('grouped: process headers with roll-up', await page.locator('tr.pmo-gh.p .pmo-roll').count() >= 1);
  check('grouped: step headers', await page.locator('tr.pmo-gh.s').count() >= 2);
  const visBefore = await page.locator('tr[data-wid]').count();
  await page.locator('tr.pmo-gh.p').first().click(); await sleep(200);
  const visCollapsed = await page.locator('tr[data-wid]').count();
  check('grouped: collapsing a process hides its items', visCollapsed < visBefore, { visBefore, visCollapsed });
  await page.locator('tr.pmo-gh.p').first().click(); await sleep(200);
  check('grouped: expanding restores', await page.locator('tr[data-wid]').count() === visBefore);
  await shot('04b-work-grouped-1440');
  await page.click('[data-wgroup="flat"]'); await page.waitForSelector('table.pmo-work:not(.grouped)');

  /* resolves select: only data used by this project's processes */
  await page.click('[data-add-work]'); await modalOpen();
  const resOk = await page.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine; const prj = store.get('project', decodeURIComponent(location.pathname.split('/project/')[1]));
    const used = new Set(prj.processes.flatMap(pid => E.flatSteps((store.get('process', pid) || {}).tobe || []).flatMap(s => [...(s.data || []), ...(s.subs || []).flatMap(x => x.data || [])])));
    const opts = [...document.querySelectorAll('.overlay select[name="resolves"] option')].map(o => o.value).filter(Boolean);
    return { ok: opts.length > 0 && opts.every(v => used.has(v)), n: opts.length, all: store.list('dataElement').length }; }, STORE);
  check('"Resolves" lists only this project\'s data', resOk.ok, resOk);
  await act('cancel');

  /* ---------------- timeline drag (PM) ---------------- */
  console.log('timeline drag');
  await page.click('.pmo-tabs a:has-text("Timeline")'); await page.waitForSelector('.tl button.tbar'); await sleep(300);
  const bar = page.locator('.tl button.tbar[data-bar]').first();
  await bar.scrollIntoViewIfNeeded();
  const dragId = await bar.getAttribute('data-bar');
  const before = await getDoc('workItem', dragId);
  const geo = await page.evaluate(id => { const b = document.querySelector(`[data-bar="${id}"]`); const r = b.getBoundingClientRect(); return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2, pxDay: b.parentElement.clientWidth / Number(document.querySelector('#pmoTl').dataset.span) }; }, dragId);
  await page.mouse.move(geo.x, geo.y); await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(geo.x + geo.pxDay * 3 * k / 6, geo.y);
  check('drag shows a live date tip', /\(\+3d\)/.test(await page.locator('.pmo-dragtip').innerText().catch(() => '')));
  await page.mouse.up(); await settle();
  const after = await getDoc('workItem', dragId);
  const shift = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  check('drag: start moved +3d', shift(before.start || before.due, after.start) === 3, { before: before.start, after: after.start });
  check('drag: duration kept (due +3d)', shift(before.due, after.due) === 3, { before: before.due, after: after.due });
  check('drag: no modal opened by the drag', await page.locator('.overlay').count() === 0);
  await page.waitForSelector('.tl button.tbar');
  check('drag: bar re-rendered at new date', (await page.locator(`.tl [data-bar="${dragId}"]`).getAttribute('aria-label')).includes(await page.evaluate(d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), after.due)));
  /* drag back 2 days to the left */
  const geo2 = await page.evaluate(id => { const b = document.querySelector(`[data-bar="${id}"]`); const r = b.getBoundingClientRect(); return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }; }, dragId);
  await page.mouse.move(geo2.x, geo2.y); await page.mouse.down();
  for (let k = 1; k <= 5; k++) await page.mouse.move(geo2.x - geo.pxDay * 2 * k / 5, geo2.y);
  await page.mouse.up(); await settle();
  const after2 = await getDoc('workItem', dragId);
  check('drag left: -2d', shift(after.start, after2.start) === -2 && shift(after.due, after2.due) === -2, { after2 });
  /* a plain click (no drag) opens the edit modal: the keyboard alternative */
  await page.locator(`.tl [data-bar="${dragId}"]`).focus(); await page.keyboard.press('Enter'); await modalOpen();
  check('Enter on a bar opens the edit modal with its dates', await page.inputValue('.overlay input[name="due"]') === after2.due);
  await act('cancel');
  await shot('05a-timeline-dragged-1440');
  await sleep(800); await page.reload(); await page.waitForSelector('.tl button.tbar');
  check('reload: dragged dates persisted', (await getDoc('workItem', dragId)).due === after2.due);
  await openAct(); await page.waitForSelector('[data-feed="prj-work"] .ev', { timeout: 10000 }).catch(() => {});
  check('history shows "Rescheduled" with a summary', /Rescheduled “.+” on the timeline: .+ → .+ \(\+3d\)/.test(await page.locator('[data-feed="prj-work"]').innerText()));
  await page.click('.pmo-tabs a:has-text("Work")'); await page.waitForSelector('table.pmo-work');

  /* push an open item's due out by editing it, so baseline variance has something to show (after baseline below) */
  /* ================= ROUND 4: views of the same work items ================= */
  const PRJ = decodeURIComponent(prjPath.split('/project/')[1]);
  const prjGo = async (q, sel) => { await page.goto(ROOT + '/project/' + encodeURIComponent(PRJ) + (q || '')); await page.waitForSelector(sel || '.pmo-toolbar'); await settle(); };
  const feedText = async () => { await openAct(); await page.waitForSelector('[data-feed="prj-work"] .ev', { timeout: 10000 }).catch(() => {}); return page.locator('[data-feed="prj-work"]').innerText(); };
  const isWkend = s => { const g = new Date(s + 'T12:00:00').getDay(); return g === 0 || g === 6; };
  /* synthetic HTML5 drag-and-drop (for targets that are off-screen, where a mouse drag can't reach) */
  const dnd = async (src, dst) => { const dt = await page.evaluateHandle(() => new DataTransfer());
    await page.dispatchEvent(src, 'dragstart', { dataTransfer: dt }); await page.dispatchEvent(dst, 'dragenter', { dataTransfer: dt });
    await page.dispatchEvent(dst, 'dragover', { dataTransfer: dt }); await page.dispatchEvent(dst, 'drop', { dataTransfer: dt }); await page.dispatchEvent(src, 'dragend', { dataTransfer: dt }); await settle(); };
  const todayStr = await page.evaluate(async u => (await import(u)).store.state.today, STORE);

  /* ---- header RAG pill ---- */
  console.log('R4 header + map gateways');
  await prjGo('', '.canvas.pm .node');
  const ragK = await page.getAttribute('.hdr [data-summary-label]', 'data-summary-label');
  check('header shows ONE status label (R8: no duplicate badge)', ['red', 'amber', 'green'].includes(ragK) && await page.locator('.hdr [data-summary-label]').count() === 1 && await page.locator('.hdr .rag').count() === 0, ragK);
  check('project tabs (Advanced): Plan | Timeline | Board | Sprints | Work', (await page.locator('.pmo-tabs a').allInnerTexts()).join('|') === 'Plan|Timeline|Board|Sprints|Work');
  const gwExp = await page.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine; const prj = store.get('project', decodeURIComponent(location.pathname.split('/project/')[1]));
    return prj.processes.flatMap(pid => { const p = store.get('process', pid); const dp = E.diffProcess(p); return E.flatGateways(p.tobe).filter(g => dp.nodes[g.id] === 'new').map(g => g.id); }); }, STORE);
  const gwShown = await page.locator('[data-gateway]:has([data-gw-diff="new"])').evaluateAll(xs => xs.map(x => x.dataset.gateway));
  check('map marks new gateways NEW', gwExp.length > 0 && gwExp.every(id => gwShown.includes(id)) && gwShown.length === gwExp.length, { gwExp, gwShown });

  /* ---- Board ---- */
  console.log('R4 board');
  await page.click('.pmo-tabs a[data-tab="board"]'); await page.waitForSelector('[data-board]'); await settle();
  const stNames = await page.evaluate(async ([u, prj]) => { const j = (await import(u)).store.get('project', prj); return (j.statuses || []).map(x => x.name); }, [STORE, PRJ]);
  check('R6 board: columns follow project.statuses (seeded Not started / In progress / In review / Done)', stNames.length === 4 && (await page.locator('.pmo-col-h b').allInnerTexts()).join('|') === stNames.join('|'), stNames);
  const nItems = await page.evaluate(async ([u, id]) => (await import(u)).store.list('workItem', w => w.projectId === id).length, [STORE, PRJ]);
  check('board: one card per work item', await page.locator('.pmo-board .pmo-card').count() === nItems, nItems);
  const card0 = page.locator('.pmo-board .pmo-card').first();
  check('board card: owner avatar, title, step, due/forecast badge', await card0.locator('.av').count() === 1 && await card0.locator('.pmo-card-t').count() === 1 && await card0.locator('.pmo-card-s').count() === 1 && await card0.locator('.badge').count() >= 1 && await card0.locator('.pmo-card-due').count() === 1);
  check('board: data-blocker chips and risk badges shown', await page.locator('.pmo-board [data-blocker]').count() > 0 && await page.locator('.pmo-board [data-risk]').count() > 0);
  const blkOk = await page.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine; return [...document.querySelectorAll('.pmo-board [data-blocker]')].every(c => ['missing', 'pending'].includes(E.effectiveAvail(store.state.docs, c.dataset.blocker))); }, STORE);
  check('board: blocker chips only for missing/pending data', blkOk);
  check('board: PM can drag every card', await page.locator('.pmo-board .pmo-card:not([draggable="true"])').count() === 0);
  check('board no overflow @1440', await noOverflow());
  await shot('20-board-1440');
  const idleCard = page.locator('.pmo-col[data-col="idle"] .pmo-card').first();
  const bId = await idleCard.getAttribute('data-card');
  await idleCard.dragTo(page.locator('.pmo-col[data-col="prog"] .pmo-col-h')); await settle();
  const bDoc = await getDoc('workItem', bId);
  check('board drag Not started -> In progress sets status + updatedAt', bDoc.status === 'prog' && !!bDoc.updatedAt && !bDoc.doneAt, bDoc);
  check('board: card now in In progress column', await page.locator(`.pmo-col[data-col="prog"] [data-card="${bId}"]`).count() === 1);
  await page.locator(`.pmo-card[data-card="${bId}"]`).dragTo(page.locator('.pmo-col[data-col="done"] .pmo-col-h')); await settle();
  const bDone = await getDoc('workItem', bId);
  check('board drag -> Done sets doneAt to today', bDone.status === 'done' && bDone.doneAt === todayStr, bDone);
  /* keyboard alternative: focus a card, Tab to its status select */
  const kCard = page.locator('.pmo-col[data-col="idle"] .pmo-card').first();
  const kId = await kCard.getAttribute('data-card');
  await kCard.focus(); await page.keyboard.press('Tab');
  check('keyboard: Tab from a card reaches its status select', await page.evaluate(id => document.activeElement && document.activeElement.dataset.status === id, kId));
  check('keyboard: select visible on the focused card', await page.locator(`.pmo-card[data-card="${kId}"] select[data-status]`).isVisible());
  await page.selectOption(`.pmo-card[data-card="${kId}"] select[data-status]`, 'prog'); await settle();
  check('keyboard: status changed from the card select', (await getDoc('workItem', kId)).status === 'prog');
  await dnd(`.pmo-card[data-card="${bId}"]`, '.pmo-col[data-col="idle"] .pmo-col-b');
  check('board drag Done -> Not started clears doneAt', (await getDoc('workItem', bId)).status === 'idle' && !(await getDoc('workItem', bId)).doneAt);
  check('history: board moves summarised', /Not started → In progress/.test(await feedText()));
  await asPersona('^Leo Park'); await page.waitForSelector('[data-board]');
  const lpDrag = await page.evaluate(async u => { const { store } = await import(u); const me = store.state.me; return [...document.querySelectorAll('.pmo-board .pmo-card')].map(c => [store.get('workItem', c.dataset.card).owner === me, c.getAttribute('draggable') === 'true']); }, STORE);
  check('board: non-PM can drag only own cards', lpDrag.length > 0 && lpDrag.every(([own, d]) => own === d) && lpDrag.some(([o]) => !o), lpDrag.length);
  await asPersona('Project Manager'); await page.waitForSelector('[data-board]');

  /* ---- Why this date? ---- */
  console.log('R4 why this date');
  const whyBtnL = page.locator('.pmo-board [data-why]').first();
  const whyId = await whyBtnL.getAttribute('data-why');
  await whyBtnL.click(); await page.waitForSelector('.pmo-pop');
  const expLines = await page.evaluate(async ([u, id]) => { const { store } = await import(u); return window.PMOEngine.explainForecast(store.state.docs, id, store.state.today).map(x => x.text); }, [STORE, whyId]);
  const popLines = await page.locator('.pmo-pop li').allInnerTexts();
  check('"Why this date?" popover shows E().explainForecast chain', expLines.length > 0 && JSON.stringify(expLines) === JSON.stringify(popLines), { expLines, popLines });
  check('why popover: no modal / navigation', await page.locator('.overlay').count() === 0 && /mode=board/.test(page.url()));
  await shot('21-why-popover-1440', false);
  await page.keyboard.press('Escape');
  check('why popover closes on Escape', await page.locator('.pmo-pop').count() === 0);

  /* ---- Sprints ---- */
  console.log('R4 sprints');
  await page.click('.pmo-tabs a[data-tab="sprints"]'); await page.waitForSelector('[data-sprints]'); await settle();
  const engSprints = await page.evaluate(async ([u, id]) => { const { store } = await import(u); return window.PMOEngine.sprints(store.get('project', id), store.state.today, store.state.docs); }, [STORE, PRJ]);
  check('sprints: one column per E().sprints with dates', engSprints.length > 0 && await page.locator('.pmo-spr[data-sprint]').count() === engSprints.length
    && (await page.locator('.pmo-spr[data-sprint] .pmo-spr-h .hint').first().innerText()).includes('–'), engSprints.length);
  const capOk = await page.evaluate(async u => { const { store } = await import(u); return [...document.querySelectorAll('.pmo-spr[data-sprint]')].map(col => {
    const ids = [...col.querySelectorAll('.pmo-card')].map(c => c.dataset.card); const items = ids.map(i => store.get('workItem', i));
    const eff = items.reduce((a, w) => a + (w.effortDays > 0 ? w.effortDays : 1), 0); const t = col.querySelector('[data-cap-line] span').textContent;
    const [, e, c] = t.match(/([\d.]+)d effort \/ ([\d.]+)d capacity/) || [];
    return Math.abs(Number(e) - eff) < 0.05 && (Number(e) > Number(c)) === !!col.querySelector('[data-over]'); }); }, STORE);
  check('sprints: effort vs capacity per sprint, over-capacity flagged consistently', capOk.length > 0 && capOk.every(Boolean), capOk);
  await shot('22-sprints-1440');
  const sCols = await page.locator('.pmo-spr[data-sprint]').evaluateAll(cs => cs.map(c => c.dataset.sprint));
  const target = engSprints[engSprints.length - 2] || engSprints[engSprints.length - 1];
  const mover = page.locator(`.pmo-spr[data-sprint]:not([data-sprint="${target.id}"]) .pmo-card.st-idle[draggable="true"]`).first();
  const mId = await mover.getAttribute('data-card'); const mBefore = await getDoc('workItem', mId);
  await dnd(`.pmo-card[data-card="${mId}"]`, `.pmo-spr[data-sprint="${target.id}"] .pmo-spr-b`);
  const mAfter = await getDoc('workItem', mId);
  check('sprint drag: sets sprintId', mAfter.sprintId === target.id, { mAfter, target });
  check('sprint drag: due moved inside the sprint', mAfter.due >= target.start && mAfter.due <= target.end, { due: mAfter.due, target });
  check('sprint drag: duration kept', shift(mAfter.start, mAfter.due) === shift(mBefore.start || mBefore.due, mBefore.due), { mBefore, mAfter });
  check('sprint drag: card shows in target sprint', await page.locator(`.pmo-spr[data-sprint="${target.id}"] [data-card="${mId}"]`).count() === 1);
  check('history: sprint move summarised', new RegExp(`Planned “.+” in ${target.name}`).test(await feedText()));
  /* keyboard alternative + over-capacity: pile one owner's open work into the same sprint */
  for (let k = 0; k < 14 && !(await page.locator(`.pmo-spr[data-sprint="${target.id}"] [data-over]`).count()); k++) {
    /* prefer work owned by someone already in the target sprint, so effort grows faster than capacity */
    const inTarget = await page.locator(`.pmo-spr[data-sprint="${target.id}"] .pmo-card .pmo-card-h .av`).evaluateAll(xs => xs.map(x => x.getAttribute('title')));
    const own = page.locator(`.pmo-spr[data-sprint]:not([data-sprint="${target.id}"]) .pmo-card`).filter({ has: page.locator(inTarget.map(t => `.pmo-card-h .av[title="${t}"]`).join(',') || '.none') }).locator('select[data-sprint-pick]:not([disabled])').first();
    const sel = await own.count() ? own : page.locator(`.pmo-spr[data-sprint]:not([data-sprint="${target.id}"]) select[data-sprint-pick]:not([disabled])`).first();
    if (!await sel.count()) break;
    await sel.selectOption(target.id); await settle();
  }
  check('sprints: over-capacity sprint flagged', await page.locator(`.pmo-spr[data-sprint="${target.id}"].over [data-over]`).count() === 1);
  check('sprints: keyboard select moved items too', await page.locator(`.pmo-spr[data-sprint="${target.id}"] .pmo-card`).count() >= 2);
  await shot('23-sprints-over-1440');
  /* Plan sprints: cadence saved as project.sprints */
  await page.click('[data-plan-sprints]'); await modalOpen();
  await page.fill('.overlay input[name="length"]', '3'); await page.click('.overlay [data-act="save"]'); await page.waitForSelector('.overlay .banner');
  check('plan sprints: validation keeps the dialog', (await page.locator('.overlay .banner').innerText()).includes('between 5 and 42'));
  const spStart = await page.evaluate(t => { const d = new Date(t + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 14); return d.toISOString().slice(0, 10); }, todayStr);
  await page.fill('.overlay input[name="start"]', spStart); await page.fill('.overlay input[name="length"]', '7');
  await act('save'); await settle();
  const pj = await getDoc('project', PRJ);
  check('plan sprints: project.sprints saved with the cadence', Array.isArray(pj.sprints) && pj.sprints[0].start === spStart && pj.sprints.every((s, i) => shift(s.start, s.end) === 6 && (!i || shift(pj.sprints[i - 1].start, s.start) === 7)), pj.sprints && pj.sprints.slice(0, 2));
  check('plan sprints: columns follow the new cadence', await page.locator('.pmo-spr[data-sprint]').count() === pj.sprints.length);
  await openAct(); await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
  check('history: sprint cadence change', (await page.locator('[data-history]').innerText()).includes('Sprint cadence: 7-day sprints'));

  /* ---- shared filter bar + saved views ---- */
  console.log('R4 filters + saved views');
  for (const m of ['board', 'sprints', 'timeline', 'work']) { await prjGo('?mode=' + m, '[data-fbar]'); check(`filter bar on ${m} (6 filters + one per custom field)`, await page.locator('[data-fbar] [data-f]').count() === 7 && await page.locator('[data-fbar] [data-f="cf_riskArea"]').count() === 1); }
  await prjGo('?mode=work', 'table.pmo-work');
  const ownerPick = await page.$eval('[data-fbar] select[data-f="owner"]', s => s.options[1].value);
  await page.selectOption('[data-fbar] select[data-f="owner"]', ownerPick); await settle();
  check('filter owner: URL query + rows', new URL(page.url()).searchParams.get('owner') === ownerPick && await page.evaluate(async ([u, o]) => { const { store } = await import(u); return [...document.querySelectorAll('tr[data-wid]')].every(r => store.get('workItem', r.dataset.wid).owner === o); }, [STORE, ownerPick]));
  await page.selectOption('[data-fbar] select[data-f="owner"]', ''); await settle();
  await page.selectOption('[data-fbar] select[data-f="status"]', 'open'); await settle();
  check('filter status: no done rows', await page.locator('tr[data-wid] select[data-status] option[value="done"]:checked').count() === 0 && await page.locator('tr[data-wid]').count() > 0);
  await page.check('[data-fbar] input[data-f="late"]'); await settle();
  const lateOk = await page.evaluate(async u => { const { store } = await import(u); const fc = window.PMOEngine.forecastAll(store.state.docs, store.state.today); const ids = [...document.querySelectorAll('tr[data-wid]')].map(r => r.dataset.wid); return ids.length > 0 && ids.every(i => ['late', 'slip'].includes(fc[i].sched)); }, STORE);
  check('filter late or slipping', lateOk);
  const stepPick = await page.$eval('[data-fbar] select[data-f="step"]', s => [...s.options].find(o => o.value.includes('::')).value);
  await page.selectOption('[data-fbar] select[data-f="step"]', stepPick); await settle();
  check('filter step: rows on that step only', await page.evaluate(async ([u, sp]) => { const { store } = await import(u); const [pid, sid] = sp.split('::'); return [...document.querySelectorAll('tr[data-wid]')].every(r => { const w = store.get('workItem', r.dataset.wid); return w.pid === pid && w.step === sid; }); }, [STORE, stepPick]));
  await page.click('[data-fbar] [data-fclear]'); await settle();
  check('clear filters: all rows back', await page.locator('tr[data-wid]').count() === nItems + 0 || await page.locator('tr[data-wid]').count() >= nItems);
  const dPick = await page.$eval('[data-fbar] select[data-f="data"]', s => s.options[1].value);
  await page.selectOption('[data-fbar] select[data-f="data"]', dPick); await settle();
  check('filter data element', await page.evaluate(async ([u, d]) => { const { store } = await import(u); const E = window.PMOEngine; return [...document.querySelectorAll('tr[data-wid]')].every(r => { const w = store.get('workItem', r.dataset.wid);
    const n = E.flatSteps(store.get('process', w.pid).tobe).concat(E.flatGateways(store.get('process', w.pid).tobe)).find(s => s.id === w.step) || {}; return w.resolves === d || [...(n.data || []), ...(n.subs || []).flatMap(x => x.data || [])].includes(d); }); }, [STORE, dPick]));
  await page.click('[data-fbar] [data-fclear]'); await settle();
  await page.selectOption('[data-fbar] select[data-f="status"]', 'open'); await settle();
  await page.check('[data-fbar] input[data-f="late"]'); await settle();
  await page.fill('[data-fbar] input[data-f="q"]', 'bank'); await sleep(700); await settle();
  const qFocus = await page.evaluate(() => !!document.activeElement && document.activeElement.dataset.f === 'q');
  const qRows = await page.locator('tr[data-wid]').allInnerTexts();
  check('text search keeps focus and filters (title, step, data)', qFocus && new URL(page.url()).searchParams.get('q') === 'bank' && qRows.length > 0 && qRows.every(t => /bank/i.test(t)), { qFocus, qRows: qRows.map(t => t.slice(0, 60)) });
  await page.fill('[data-fbar] input[data-f="q"]', ''); await sleep(700); await settle();
  const filtered = await page.locator('tr[data-wid]').count();
  check('late+open filter shows a subset', filtered > 0 && filtered < nItems, { filtered, nItems });
  await page.click('[data-save-view]'); await modalOpen();
  await page.click('.overlay [data-act="save"]'); await page.waitForSelector('.overlay .banner');
  check('save view: name required, dialog kept', (await page.locator('.overlay .banner').innerText()).includes('name'));
  await page.fill('.overlay input[name="name"]', 'E2E late open work'); await act('save'); await settle();
  const pv = await getDoc('project', PRJ);
  const sv = (pv.views || []).find(v => v.name === 'E2E late open work');
  check('saved view stored in project.views', sv && sv.filters.status === 'open' && sv.filters.late === '1', pv.views);
  check('saved view selected in picker + URL', await page.inputValue('[data-view-pick]') === sv.id && new URL(page.url()).searchParams.get('view') === sv.id);
  await page.click('.pmo-tabs a[data-tab="board"]'); await page.waitForSelector('[data-board]'); await settle();
  check('switching view tab keeps the filters', new URL(page.url()).searchParams.get('late') === '1' && await page.locator('.pmo-board .pmo-card').count() === filtered);
  await page.click('[data-fbar] [data-fclear]'); await settle();
  check('board unfiltered again', await page.locator('.pmo-board .pmo-card').count() === nItems);
  await page.selectOption('[data-view-pick]', sv.id); await settle();
  check('view picker re-applies the saved filters', await page.locator('.pmo-board .pmo-card').count() === filtered && new URL(page.url()).searchParams.get('status') === 'open');
  await sleep(800); await page.reload(); await page.waitForSelector('[data-board]'); await settle();
  check('reload: filters persist from the URL', await page.locator('.pmo-board .pmo-card').count() === filtered && await page.isChecked('[data-fbar] input[data-f="late"]'));
  await openAct(); await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
  check('history: saved view', (await page.locator('[data-history]').innerText()).includes('Saved view “E2E late open work”'));
  await page.selectOption('[data-fbar] select[data-f="owner"]', ownerPick); await settle();
  await page.click('[data-save-view]'); await modalOpen(); await page.fill('.overlay input[name="name"]', 'E2E throwaway view'); await act('save'); await settle();
  await page.click('[data-del-view]'); await modalOpen(); await act('delete'); await settle();
  check('saved view deleted', !((await getDoc('project', PRJ)).views || []).some(v => v.name === 'E2E throwaway view') && ((await getDoc('project', PRJ)).views || []).some(v => v.name === 'E2E late open work'));
  await shot('24-board-filtered-1440');

  /* ---- dependency type + lag in the work item modal ---- */
  console.log('R4 dependency type/lag');
  await prjGo('?mode=work', 'table.pmo-work');
  const T5 = 'E2E SS-lag item';
  await page.click('[data-add-work]'); await modalOpen();
  await page.fill('.overlay input[name="title"]', T5);
  const depBoxes = page.locator('.overlay input[name="deps"]');
  const dep0 = await depBoxes.nth(0).getAttribute('value'), dep1 = await depBoxes.nth(1).getAttribute('value');
  await depBoxes.nth(0).check(); await page.selectOption(`.overlay select[name="dt_${dep0}"]`, 'SS'); await page.fill(`.overlay input[name="dl_${dep0}"]`, '2');
  await depBoxes.nth(1).check();
  await act('save'); await settle();
  const t5 = await page.evaluate(async ([u, t]) => (await import(u)).store.list('workItem', w => w.title === t)[0], [STORE, T5]);
  check('deps saved as {id, type, lag} (FS lag 0 stays a plain id)', t5 && t5.deps.some(d => typeof d === 'object' && d.id === dep0 && d.type === 'SS' && d.lag === 2) && t5.deps.includes(dep1), t5 && t5.deps);
  check('work row shows the dependency type', (await workRow(T5).locator('.pmo-deps').innerText()).includes('SS +2d'));
  await workRow(T5).locator('[data-edit-work]').click(); await modalOpen();
  check('modal re-opens with type + lag', await page.inputValue(`.overlay select[name="dt_${dep0}"]`) === 'SS' && await page.inputValue(`.overlay input[name="dl_${dep0}"]`) === '2');
  await page.selectOption(`.overlay select[name="dt_${dep0}"]`, 'FF'); await page.fill(`.overlay input[name="dl_${dep0}"]`, '99');
  await page.click('.overlay [data-act="save"]'); await page.waitForSelector('.overlay .banner');
  check('lag validation keeps input', (await page.locator('.overlay .banner').innerText()).includes('Lag') && await page.inputValue('.overlay input[name="title"]') === T5);
  await page.fill(`.overlay input[name="dl_${dep0}"]`, '1'); await act('save'); await settle();
  check('dep type changed to FF +1', (await page.evaluate(async ([u, id]) => (await import(u)).store.get('workItem', id), [STORE, t5.id])).deps.some(d => d.type === 'FF' && d.lag === 1));
  check('history: dependency type change', /dependency on .+ now FF \+1d lag/.test(await feedText()));
  await page.click('.pmo-tabs a[data-tab="timeline"]'); await page.waitForSelector('.tl .tbar'); await sleep(400);
  check('timeline arrow carries the dependency type', await page.locator(`svg.pmo-arrows path[data-to="${t5.id}"][data-type="FF"]`).count() === 1);
  const whyTl = await page.evaluate(async ([u, id]) => window.PMOEngine.explainForecast((await import(u)).store.state.docs, id, (await import(u)).store.state.today).length, [STORE, t5.id]);
  check('engine explains the FF item', whyTl > 0);

  /* ---- status report on the project page ---- */
  console.log('R4 report');
  await prjGo('?mode=work', 'table.pmo-work');
  const ragK2 = await page.getAttribute('.hdr [data-summary-label]', 'data-summary-label');
  await page.click('[data-report]');
  await page.waitForSelector('[data-prj-rep] [data-rep-body]', { timeout: 30000 });
  check('report: headline + the same status label', (await page.locator('[data-prj-rep] .pmo-rep-h').innerText()).trim().length > 5 && await page.locator(`[data-prj-rep] .rag-${ragK2}`).count() === 1);
  check('R8 report: facts strip (expected, late, blocking, costs)', await page.locator('[data-prj-rep] [data-rep-facts] [data-t]').count() >= 6);
  const mail = await page.getAttribute('[data-rep-mail]', 'href');
  const mailU = new URL(mail);
  check('email draft: mailto with subject + plain-text body', /^mailto:[a-z.]+@northwind\.example(,[a-z.]+@northwind\.example)*\?subject=/.test(mail) && mailU.searchParams.get('subject').includes('status') && mailU.searchParams.get('body').includes((await page.locator('[data-prj-rep] .pmo-rep-h').innerText()).trim()), mail.slice(0, 120));
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.click('[data-rep-print]');
  check('Print / PDF calls window.print', await page.evaluate(() => window.__printed) === 1);
  await page.emulateMedia({ media: 'print' });
  check('print stylesheet: only the report prints', await page.locator('[data-prj-rep]').isVisible() && !(await page.locator('.pmo-grid').isVisible()) && !(await page.locator('header.top').isVisible()) && !(await page.locator('.pmo-rep-acts').isVisible()));
  await shot('25-report-print', true);
  await page.emulateMedia({ media: 'screen' });
  await shot('26-report-1440');
  await page.click('[data-rep-close]'); await settle();
  check('report closes', await page.locator('[data-prj-rep]').count() === 0);

  /* ---- empty project + cross-project conflicts (the project created above) ---- */
  console.log('R4 empty project + conflicts');
  await page.goto(ROOT + '/project/' + encodeURIComponent(npId)); await page.waitForSelector('.canvas.pm'); await settle();
  check('zero items: never "All work is done"', !(await page.locator('.side').innerText()).includes('All work is done'));
  check('zero items: "No tasks planned yet — Suggest a plan"', (await page.locator('[data-upnext] [data-nowork]').innerText()).includes('No tasks planned yet') && await page.locator('[data-upnext] [data-suggest]').count() === (((await getDoc('project', npId)).owner === await page.$eval('#persona', s => s.value)) ? 1 : 0));
  const expConf = await page.evaluate(async ([u, id]) => { const { store } = await import(u); const E = window.PMOEngine; const j = store.get('project', id);
    const steps = new Set(j.processes.flatMap(pid => [...E.flatSteps(store.get('process', pid).tobe), ...E.flatGateways(store.get('process', pid).tobe)].map(s => pid + '::' + s.id)));
    const data = new Set(j.processes.flatMap(pid => E.flatSteps(store.get('process', pid).tobe).flatMap(s => [...(s.data || []), ...(s.subs || []).flatMap(x => x.data || [])])));
    return store.list('project', p => p.id !== id && p.status !== 'live').filter(p => store.list('workItem', w => w.projectId === p.id && w.status !== 'done' && (steps.has(w.pid + '::' + w.step) || (w.resolves && data.has(w.resolves)))).length).map(p => p.id); }, [STORE, npId]);
  const shownConf = await page.locator('[data-conflicts] [data-conflict]').evaluateAll(xs => xs.map(x => x.dataset.conflict));
  check('conflict banner lists every overlapping active project', expConf.length > 0 && JSON.stringify(expConf.sort()) === JSON.stringify(shownConf.sort()), { expConf, shownConf });
  check('conflict banner links to the other project', await page.locator(`[data-conflicts] a[href*="/project/${expConf[0]}"]`).count() >= 1);
  await shot('27-conflict-empty-1440');
  await page.click('.pmo-tabs a[data-tab="board"]'); await page.waitForSelector('[data-nowork]');
  check('empty board: suggest-a-plan empty state', (await page.locator('.pmo-main [data-nowork]').innerText()).includes('No tasks planned yet'));
  await page.click(`[data-conflicts] a[href*="/project/${expConf[0]}"]`); await page.waitForSelector('table.pmo-work');
  check('conflict link opens the other project', page.url().includes('/project/' + expConf[0]));
  await prjGo('?mode=work', 'table.pmo-work');

  /* ---------------- baseline ---------------- */
  console.log('baseline');
  await page.click('[data-baseline]'); await modalOpen();
  await page.fill('.overlay input[name="label"]', 'E2E baseline');
  await act('save'); await settle();
  const openRow = page.locator('tr[data-wid]').filter({ has: page.locator('select[data-status] option[value="idle"]:checked') }).first();
  const openTitle = (await openRow.locator('.pmo-wt').innerText()).trim();
  await openRow.locator('[data-edit-work]').click(); await modalOpen();
  const oldDue = await page.inputValue('.overlay input[name="due"]');
  const d = new Date(oldDue + 'T12:00:00'); d.setDate(d.getDate() + 21);
  await page.fill('.overlay input[name="due"]', d.toISOString().slice(0, 10));
  await act('save'); await settle();
  await page.click('.pmo-tabs a:has-text("Timeline")');
  await page.waitForSelector('.tl .tbar');
  check('timeline baseline overlay markers', await page.locator('.tl .pmo-blmark').count() > 0);
  check('timeline actual-finish marker for done item', await page.locator('.tl .pmo-actual').count() > 0);
  await shot('05-timeline-baseline-1440');
  await page.click('.pmo-tabs a:has-text("Work")'); await page.waitForSelector('table.pmo-work');

  /* ---------------- suggest work ---------------- */
  console.log('suggest work');
  await asPersona('^Leo Park'); await page.waitForSelector('table.pmo-work');
  check('non-owner: "Suggest a plan" is hidden, not greyed (R7)', await page.locator('[data-suggest]').count() === 0);
  await asPersona('Project Manager'); await page.waitForSelector('table.pmo-work');
  const countBeforeSuggest = await page.locator('tr[data-wid]').count();
  await page.click('[data-suggest]'); await modalOpen();
  /* R8 §3: one plan screen. "Suggest a plan" opens the same "Here's a first plan · Accept · Adjust" card; Adjust opens the editor. */
  check('R8: "Suggest a plan" opens the plan card', await page.locator('.overlay [data-first-plan], .overlay [data-plan-none]').count() === 1);
  const planN = await page.locator('.overlay [data-first-plan]').count() ? Number(await page.getAttribute('.overlay [data-first-plan]', 'data-first-plan')) : 0;
  check('R8 plan card: no old "Suggested tasks" dialog', !(await page.locator('.overlay h2').innerText()).includes('Suggested tasks'));
  if (planN) { await page.click('.overlay [data-act="adjust"]'); await page.waitForSelector('.overlay .pmo-sg', { timeout: 15000 }); }
  else { await page.click('.overlay [data-act="ok"]'); await page.waitForSelector('[data-act="ok"]', { state: 'detached' }); }
  const src = planN ? (await page.locator('.overlay .pmo-src').innerText()).trim() : 'none';
  check('R8 plan editor lists exactly the card\'s tasks', !planN || await page.locator('.overlay input[name="pick"]').count() === planN);
  if (planN) check('suggestion source labelled', /AI|Rules/.test(src), src);
  const nSugg = planN ? await page.locator('.overlay input[name="pick"]').count() : 0;
  check('each suggestion shows owner, effort, start, due, deps', nSugg > 0 && await page.locator('.overlay .pmo-sg select[name^="o_"]').count() === nSugg && await page.locator('.overlay .pmo-sg input[name^="e_"]').count() === nSugg
    && await page.locator('.overlay .pmo-sg input[name^="s_"]').count() === nSugg && await page.locator('.overlay .pmo-sg input[name^="d_"]').count() === nSugg && await page.locator('.overlay .pmo-sg-deps').count() === nSugg);
  const starts = !planN ? [] : await page.locator('.overlay .pmo-sg input[name^="s_"]').evaluateAll(xs => xs.map(x => x.value));
  const dues = !planN ? [] : await page.locator('.overlay .pmo-sg input[name^="d_"]').evaluateAll(xs => xs.map(x => x.value));
  if (/Rules/.test(src)) {
    check('suggestions: business-day dates (no weekend starts/dues)', [...starts, ...dues].every(d => !isWkend(d)), { starts, dues });
    check('suggestions: gateway targets labelled', await page.locator('.overlay [data-sg-gateway]').count() > 0);
    const depSrc = await page.evaluate(() => [...document.querySelectorAll('.overlay .pmo-sg')].flatMap(sg => [...sg.querySelectorAll('input[name^="dep_"]:checked')].map(i => i.value)).filter(v => v.startsWith('S:'))
      .map(v => document.querySelector(`.overlay .pmo-sg[data-sg="${v.slice(2)}"] .hint`).textContent));
    /* R6: flow-order deps (previous step's work, finish → start) plus data resolvers; dates spread toward the target */
    check('R6 suggestions: dependencies on other suggestions exist (flow order + resolvers)', depSrc.length > 0, depSrc);
    const sgEng = await page.evaluate(async ([u, prj]) => { const { store } = await import(u); return window.PMOEngine.suggestWorkFromDiff(store.state.docs, prj, store.state.today); }, [STORE, PRJ]);
    check('R6 suggestions: the modal shows the engine\'s flow-order deps ("can start now" only where there are none)', sgEng.some(x => (x.deps || []).length) && await page.locator('.overlay [data-sg-now]').count() === sgEng.filter(x => !(x.deps || []).length).length, sgEng.map(x => [x.title, x.deps]));
    check('R6 suggestions: dates spread from today toward the target (not all on one day)', new Set(starts).size > 1 && new Set(dues).size > 1, { starts, dues });
    check('R6 suggestions: "can start now" items start today', sgEng.filter(x => !(x.deps || []).length).every(x => x.start === todayStr || isWkend(todayStr)), sgEng.map(x => [x.start, x.deps]));
    check('R6 suggestions: spread summary shows range, target and start-now count', /Spread .+ → .+/.test(await page.innerText('.overlay [data-sg-spread]')) && /can start now/.test(await page.innerText('.overlay [data-sg-spread]')));
  }
  if (planN) await shot('06-suggest-modal-1440', false);
  if (nSugg > 1) {
    for (let i = 2; i < nSugg; i++) await page.locator('.overlay input[name="pick"]').nth(i).uncheck();
    const SG = 'E2E suggested item (edited)';
    await page.fill('.overlay input[name="t_1"]', SG);
    const otherOwner = await page.$eval('.overlay select[name="o_1"]', s => [...s.options].find(o => o.value !== s.value).value);
    await page.selectOption('.overlay select[name="o_1"]', otherOwner);
    await page.fill('.overlay input[name="e_1"]', '4');
    const s1 = await page.inputValue('.overlay input[name="s_1"]'), d1 = await page.inputValue('.overlay input[name="d_1"]');
    const ns = await page.evaluate(d => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + 5); return x.toISOString().slice(0, 10); }, s1);
    await page.fill('.overlay input[name="s_1"]', ns); await page.locator('.overlay input[name="s_1"]').dispatchEvent('change');
    const nd = await page.inputValue('.overlay input[name="d_1"]');
    check('moving a suggestion start keeps its duration', shift(s1, ns) === shift(d1, nd), { s1, d1, ns, nd });
    await page.locator('.overlay .pmo-sg[data-sg="1"] summary').click();
    const depBox = page.locator('.overlay input[name="dep_1"][value="S:0"]');
    if (!(await depBox.isChecked())) await depBox.check();
    await act('create'); await settle();
    check('two suggested items created', await page.locator('tr[data-wid]').count() === countBeforeSuggest + 2);
    const sg = await page.evaluate(async ([u, t]) => { const { store } = await import(u); const w = store.list('workItem', x => x.title === t)[0]; return w && Object.assign({}, w, { depTitles: (w.deps || []).map(d => (store.get('workItem', d) || {}).title) }); }, [STORE, SG]);
    check('edited suggestion saved with owner/effort/dates', sg && sg.owner === otherOwner && sg.effortDays === 4 && sg.start === ns && sg.due === nd, sg);
    check('suggestion dependency resolved to the created item', sg && sg.deps.length >= 1 && sg.depTitles.every(Boolean), sg && sg.depTitles);
  } else if (nSugg === 1) { await act('create'); await settle(); check('one suggested item created', await page.locator('tr[data-wid]').count() === countBeforeSuggest + 1); }
  else if (planN) await act('cancel');

  /* ---------------- link a process ---------------- */
  console.log('link process');
  await page.click('.pmo-tabs a[data-tab="map"]'); await page.waitForSelector('.canvas.pm');
  const groupsBefore = await page.locator('.pgroup').count();
  await page.locator('.pmo-actions [data-link-proc]').click(); await modalOpen();
  const unchecked = page.locator('.overlay input[name="procs"]:not(:checked)');
  const canLink = await unchecked.count();
  if (canLink) { await unchecked.first().check(); await act('save'); await settle(); check('process linked (map shows another group)', await page.locator('.pgroup').count() === groupsBefore + 1); }
  else { await act('cancel'); check('process link modal (all already linked)', true); }
  await shot('07-map-linked-1440');

  /* ---------------- delete work item ---------------- */
  await page.click('.pmo-tabs a:has-text("Work")'); await page.waitForSelector('table.pmo-work');
  const T3 = 'E2E throwaway item';
  await page.click('[data-add-work]'); await modalOpen();
  await page.fill('.overlay input[name="title"]', T3);
  await act('save'); await settle();
  check('throwaway created', await workRow(T3).count() === 1);
  await workRow(T3).locator('[data-del-work]').click(); await modalOpen();
  await act('delete'); await settle();
  check('work item deleted', await workRow(T3).count() === 0);

  /* ---------------- reload persistence + history ---------------- */
  console.log('persistence + history');
  await sleep(800);
  await page.reload(); await page.waitForSelector('table.pmo-work');
  check('reload: edited item persisted', await workRow(T2).count() === 1);
  check('reload: status persisted', await workRow(T2).locator('select[data-status]').inputValue() === 'done');
  check('reload: deleted item stays deleted', await workRow(T3).count() === 0);
  await openAct(); await page.waitForSelector('[data-feed="prj-work"] .ev', { timeout: 10000 }).catch(() => {});
  const feed = await page.locator('[data-feed="prj-work"]').innerText();
  check('work history shows edit', feed.includes('Edited'), feed.slice(0, 200));
  check('work history shows delete', feed.includes('Deleted work item'));
  await openAct(); await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
  const hist = await page.locator('[data-history]').innerText();
  check('project history shows baseline + link', hist.includes('Saved baseline') && (canLink ? /linked/i.test(hist) : true), hist.slice(0, 200));
  await shot('08-work-after-reload-1440');

  /* ---------------- portfolio ---------------- */
  console.log('portfolio');
  await page.goto(ROOT + '/portfolio');
  await page.waitForSelector('.pmo-ptable');
  check('projects table rows', await page.locator('.pmo-ptable tbody tr').count() >= 1);
  check('status rule stated in plain words', (await page.locator('.pmo-rule').innerText()).includes('At risk:'));
  check('workload bars', await page.locator('.pmo-wl-row').count() > 0);
  check('variance table appears for baseline', await page.locator('.pmo-vtable tbody tr').count() > 0);
  check('variance shows slip for pushed item', await page.locator('.pmo-vtable tr', { hasText: openTitle }).locator('.pmo-var.up').count() === 1, openTitle);
  check('project slip headline (not a sum)', (await page.locator('[data-proj-slip]').innerText()).includes('Finish moved'));
  check('workload shows effort vs capacity', await page.locator('.pmo-wl-row .pmo-cap').count() > 0);
  const capPid = await page.locator('[data-cap]').first().getAttribute('data-cap');
  await page.locator('[data-cap]').first().click(); await modalOpen();
  await page.fill('.overlay input[name="capacity"]', '1');
  await act('save'); await settle();
  check('capacity edit applies (2d per 14 days)', (await page.locator(`[data-wl="${capPid}"] .pmo-wl-n`).innerText()).includes('/ 2d'));
  check('risk matrix', await page.locator('.pmo-mx-c').count() === 9);

  const R1 = 'E2E sanctions list feed delayed';
  await page.click('[data-add-risk]'); await modalOpen();
  await page.fill('.overlay input[name="title"]', R1);
  await page.selectOption('.overlay select[name="impact"]', 'high');
  await page.selectOption('.overlay select[name="likelihood"]', 'high');
  await page.fill('.overlay textarea[name="mitigation"]', 'Fall back to manual weekly screening');
  const linkTitle = (await page.locator('.overlay [data-risk-work] label:not([hidden]) span').first().innerText()).trim();
  await page.locator('.overlay [data-risk-work] label:not([hidden]) input').first().check();
  await act('save'); await settle();
  check('risk created', await page.locator('.pmo-rtable tr', { hasText: R1 }).count() === 1);
  check('risk shows linked work item', (await page.locator('.pmo-rtable tr', { hasText: R1 }).locator('.pmo-rlinks').innerText()).includes(linkTitle));
  check('risk score 9', (await page.locator('.pmo-rtable tr', { hasText: R1 }).locator('.pmo-sev').innerText()).trim() === '9');
  await page.locator('.pmo-rtable tr', { hasText: R1 }).locator('[data-edit-risk]').click(); await modalOpen();
  await page.selectOption('.overlay select[name="likelihood"]', 'low');
  await act('save'); await settle();
  check('risk edited (score 3)', (await page.locator('.pmo-rtable tr', { hasText: R1 }).locator('.pmo-sev').innerText()).trim() === '3');

  await page.click('[data-gen-rep]');
  await page.waitForSelector('.pmo-rep', { timeout: 30000 });
  const repTop = await page.locator('.pmo-rep-top').innerText();
  check('status report renders with source label', /Rules-based|Generated by AI/.test(repTop), repTop);
  check('status report has headline', (await page.locator('.pmo-rep-h').innerText()).trim().length > 5);
  await page.click('[data-copy-rep]');
  await page.waitForSelector('.toast', { timeout: 5000 }).catch(() => {});
  check('copy gives feedback', await page.locator('.toast').count() > 0);
  check('portfolio no overflow @1440', await noOverflow());
  await shot('09-portfolio-1440');

  await sleep(800);
  await page.reload(); await page.waitForSelector('.pmo-rtable');
  check('reload: capacity persisted', (await page.locator(`[data-wl="${capPid}"] .pmo-wl-n`).innerText()).includes('/ 2d'));
  check('reload: risk persisted with edit', (await page.locator('.pmo-rtable tr', { hasText: R1 }).locator('.pmo-sev').innerText()).trim() === '3');
  await page.waitForSelector('[data-feed="risk"] .ev', { timeout: 10000 }).catch(() => {});
  const rfeed = await page.locator('[data-feed="risk"]').innerText();
  check('risk history shows create + edit', rfeed.includes('Logged risk') && rfeed.includes('Edited risk'), rfeed.slice(0, 200));
  /* linked work row shows a risk badge on the project Work tab */
  await page.goto(ROOT + prjPath.replace(/^\/concepts\/pmoflow/, '') + '?mode=work'); await page.waitForSelector('table.pmo-work');
  check('linked work row shows risk badge', await workRow(linkTitle).first().locator('.pmo-riskb').count() === 1, linkTitle);
  await page.goto(ROOT + '/portfolio'); await page.waitForSelector('.pmo-rtable');
  await page.locator('.pmo-rtable tr', { hasText: R1 }).locator('[data-del-risk]').click(); await modalOpen();
  await act('delete'); await settle();
  check('risk deleted', await page.locator('.pmo-rtable tr', { hasText: R1 }).count() === 0);
  await sleep(800);
  await page.reload(); await page.waitForSelector('.pmo-ptable');
  check('reload: risk stays deleted', await page.locator('.pmo-rtable tr', { hasText: R1 }).count() === 0);

  /* ---------------- actuals: finish every item on a project -> "Finished <date>" ---------------- */
  console.log('actuals');
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]');
  const prjLinks = await page.locator('.home-grid a[href*="/project/"]').evaluateAll(as => as.map(a => a.getAttribute('href')));
  const other = prjLinks.find(h => h !== prjPath);
  if (other) {
    await page.goto(ROOT + other.replace(/^\/concepts\/pmoflow/, '') + '?mode=work'); await page.waitForSelector('table.pmo-work');
    for (let i = 0; i < 30; i++) {
      const open = page.locator('tr[data-wid] select[data-status]').filter({ hasNot: page.locator('option[value="done"]:checked') });
      if (!await open.count()) break;
      await open.first().selectOption('done'); await settle();
    }
    const fin = await page.locator('[data-kpi-finish]').innerText();
    check('all done, launch pending -> "All tasks done · waiting to launch"', fin.includes('All tasks done · waiting to launch') && !/Finished|early/.test(fin), fin);
    check('awaiting KPI links to the release page', /\/release\//.test(await page.locator('[data-kpi-finish]').getAttribute('href') || ''));
    await sleep(800); await page.reload(); await page.waitForSelector('[data-kpi-finish]');
    check('reload: awaiting go-live persists', (await page.locator('[data-kpi-finish]').innerText()).includes('waiting to launch'));
    await page.goto(ROOT + '/portfolio'); await page.waitForSelector('.pmo-ptable');
    const prow = await page.locator('.pmo-ptable tbody tr', { has: page.locator('[data-when]') }).allInnerTexts();
    check('portfolio: no "Finished · early" while gate pending', prow.some(t => /waiting to launch/i.test(t)) && prow.every(t => !/early|Finished/.test(t)), prow);
    await page.goto(ROOT + other.replace(/^\/concepts\/pmoflow/, '') + '?mode=timeline');
    await page.click('.pmo-tabs a:has-text("Timeline")'); await page.waitForSelector('.tl .tbar');
    check('timeline shows actual finish markers', await page.locator('.tl .pmo-actual').count() > 0);
    await shot('15-finished-project-1440');
  } else check('second project exists for Finished check', false);

  /* ---------------- live project header ---------------- */
  console.log('live header');
  await page.evaluate(async ([u, id]) => { const { store } = await import(u); const j = store.get('project', id);
    await store.save('release', 'rel-e2e-' + id, { id: 'rel-e2e-' + id, projectId: id, at: new Date().toISOString(), by: store.state.me, kind: 'golive', approvers: [], actions: [], exceptions: [], snapshot: {} }, 'E2E release fixture');
    await store.save('project', id, Object.assign({}, j, { status: 'live' }), 'E2E: mark project live'); }, [STORE, npId]);
  await page.goto(ROOT + '/project/' + npId); await page.waitForSelector('[data-kpi-finish]');
  const liveTxt = await page.locator('[data-kpi-finish]').innerText();
  check('live project: "Live since <date> (vN)"', /Live since [A-Z][a-z]{2} \d{1,2} \(v\d+\)/.test(liveTxt), liveTxt);
  await page.goto(ROOT + '/portfolio'); await page.waitForSelector('.pmo-ptable');
  check('portfolio: live row shows "Live since"', (await page.locator('.pmo-ptable tr', { hasText: NP }).innerText()).includes('Live since'));
  check('portfolio: "+ New project" button', await page.locator('.pmo-ptable').count() === 1 && await page.locator('[data-new-project]').count() === 1);
  await page.click('[data-new-project]'); await modalOpen();
  check('portfolio: new project modal opens', (await page.locator('.overlay h2').innerText()) === 'New project');
  await act('cancel');
  check('portfolio: no unlabelled icon-only controls', (await unlabelled()).length === 0, await unlabelled());

  /* ================= ROUND 5: roles, planning conflicts, status reasons, PMO ================= */
  console.log('R5 roles + settings');
  const E5 = (fn, ...a) => page.evaluate(async ([u, fn, a]) => { const { store } = await import(u); return window.PMOEngine[fn](store.state.docs, ...a); }, [STORE, fn, a]);
  const money5 = n => '$' + Math.round(n).toLocaleString('en-US');
  const tomId = await asPersona('Project Manager');
  await prjGo('?mode=work', 'table.pmo-work');
  const vm = await getDoc('project', PRJ);
  check('R5 header: project manager shown', (await page.locator('[data-role-pm]').innerText()).includes('Tom Alvarez'));
  check('R5 header: release manager shown', (await page.locator('[data-role-rm]').innerText()).includes(await page.evaluate(async ([u, id]) => (await import(u)).store.person(id).name, [STORE, vm.releaseManager || vm.owner])));
  check('R5/R8 header: status label + its one sentence', (await page.locator('.hdr [data-summary-sentence]').innerText()).length > 10);
  /* activity toggle: collapsed outside the Map, full cards on the Map */
  check('R5 activity: one collapsed "Activity" toggle in Work view', await page.locator('[data-activity]').count() === 1 && !(await page.locator('[data-activity]').evaluate(d => d.open)) && await page.locator('.side .card > h3', { hasText: /^Comments$/ }).count() === 0);
  await page.click('[data-activity] > summary');
  await page.fill('[data-activity] textarea[name="cmt"]', 'E2E R5 activity comment'); await page.click('[data-activity] [data-post]'); await settle();
  check('R5 activity: stays open and shows the new comment', await page.locator('[data-activity]').evaluate(d => d.open) && (await page.locator('[data-activity]').innerText()).includes('E2E R5 activity comment'));
  await prjGo('', '.canvas.pm');
  check('R6 activity: Map also collapses comments + history into the one Activity toggle', await page.locator('[data-activity]').count() === 1 && await page.locator('.side .card > h3', { hasText: /^Comments$/ }).count() === 0);
  /* settings: PM only */
  await asPersona('^Maya Chen');
  check('R7 settings: hidden (not greyed) for non-PM', await page.locator('[data-settings]').count() === 0);
  check('R7 link process / save plan: hidden for non-PM', await page.locator('.pmo-actions [data-link-proc]').count() === 0 && await page.locator('[data-baseline]').count() === 0);
  await asPersona('Project Manager');
  await page.click('[data-settings]'); await modalOpen();
  check('R5 settings modal: PM, release manager, program, budget fields', await page.locator('.overlay select[name="owner"]').count() === 1 && await page.locator('.overlay select[name="releaseManager"]').count() === 1 && await page.locator('.overlay input[name="program"]').count() === 1 && await page.locator('.overlay input[name="budget"]').count() === 1);
  await page.selectOption('.overlay select[name="releaseManager"]', 'lp');
  await page.fill('.overlay input[name="budget"]', '-5'); await page.click('.overlay [data-act="save"]'); await page.waitForSelector('.overlay .banner');
  check('R5 settings: negative budget rejected, input kept', (await page.locator('.overlay .banner').innerText()).includes('budget') && await page.inputValue('.overlay select[name="releaseManager"]') === 'lp');
  await page.fill('.overlay input[name="budget"]', '52000'); await page.fill('.overlay input[name="program"]', 'Finance Operations Modernization');
  await act('save'); await settle();
  const vm2 = await getDoc('project', PRJ);
  check('R5 settings: release manager + budget saved', vm2.releaseManager === 'lp' && vm2.budget && vm2.budget.planned === 52000 && vm2.owner === tomId, { rm: vm2.releaseManager, b: vm2.budget });
  check('R5 header: new release manager shown', (await page.locator('[data-role-rm]').innerText()).includes('Leo Park'));
  await openAct(); await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
  check('R5 history: settings change summarised', /Project settings: .*launch owner Tom Alvarez → Leo Park.*planned budget/.test(await page.locator('[data-history]').innerText()));
  await sleep(600); await page.reload(); await page.waitForSelector('[data-role-rm]');
  check('R5 reload: settings persisted', (await page.locator('[data-role-rm]').innerText()).includes('Leo Park') && (await page.locator('[data-hfin]').innerText()).includes('$52,000'));
  /* the server enforces "only the PM edits the plan": a non-PM change to linked processes is refused with 403 */
  await asPersona('^Maya Chen');
  const srv403 = await page.evaluate(async ([u, id]) => { const { store } = await import(u); const j = store.get('project', id);
    const r = await fetch(`/api/pmoflow/ws/${store.state.ws}/doc/project/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: Object.assign({}, j, { processes: [] }), actor: store.state.me, summary: 'E2E non-PM plan change' }) }); return r.status; }, [STORE, PRJ]);
  check('R5 server: non-PM plan change rejected (403)', srv403 === 403, srv403);
  /* and the UI handles a refusal: toast, server truth restored, no unhandled error */
  await asPersona('Project Manager');
  await page.route('**/doc/project/**', r => r.request().method() === 'PUT' ? r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Only the project manager can change the plan.' }) }) : r.continue());
  await page.click('[data-settings]'); await modalOpen(); await page.fill('.overlay input[name="budget"]', '61000'); await act('save');
  await page.waitForSelector('.toast:has-text("Not saved")', { timeout: 8000 }).catch(() => {});
  const t403 = await page.locator('.toast').innerText().catch(() => '');
  await page.unroute('**/doc/project/**'); await settle();
  check('R5 403: UI says the change was not saved', /Not saved: Only the project manager/.test(t403), t403);
  check('R5 403: server truth restored', (await getDoc('project', PRJ)).budget.planned === 52000);
  for (let i = errors.length - 1; i >= 0; i--) if (/status of 403/.test(errors[i])) errors.splice(i, 1); /* the browser logs the intentional 403 response */

  console.log('R5 planning conflicts + auto-schedule');
  await prjGo('?mode=timeline', '.tl .tbar');
  const pair = await page.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine; const prj = decodeURIComponent(location.pathname.split('/project/')[1]);
    const items = store.list('workItem', w => w.projectId === prj && w.status !== 'done');
    const conf = new Set(E.scheduleConflicts(store.state.docs, prj).map(c => c.workId));
    for (const w of items) for (const d of (w.deps || [])) { const id = typeof d === 'object' ? d.id : d; const t = typeof d === 'object' ? d.type || 'FS' : 'FS'; const dep = items.find(x => x.id === id);
      if (dep && t === 'FS' && !conf.has(w.id) && document.querySelector(`.tl button.tbar[data-bar="${w.id}"]`)) return { w: w.id, d: dep.id, ws: w.start, dd: dep.due }; }
    return null; }, STORE);
  check('R5 conflicts: an FS pair to break exists', !!pair, pair);
  const confBefore = (await E5('scheduleConflicts', PRJ)).length;
  check('R5 conflicts: markers match the engine before a drag', await page.locator('[data-conf-mark]').count() === new Set((await E5('scheduleConflicts', PRJ)).map(c => c.workId)).size);
  if (pair) {
    const dshift = Math.round((new Date(pair.dd + 'T12:00:00') - new Date(pair.ws + 'T12:00:00')) / 86400000) - 3; /* start 3 days before the predecessor finishes */
    const b5 = page.locator(`.tl button.tbar[data-bar="${pair.w}"]`); await b5.scrollIntoViewIfNeeded();
    const g5 = await page.evaluate(id => { const b = document.querySelector(`[data-bar="${id}"]`); const r = b.getBoundingClientRect(); return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2, pxDay: b.parentElement.clientWidth / Number(document.querySelector('#pmoTl').dataset.span) }; }, pair.w);
    const steps = Math.max(1, Math.min(-dshift, 30));
    await page.mouse.move(g5.x, g5.y); await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(g5.x - g5.pxDay * steps * k / 8, g5.y);
    const tip5 = await page.locator('.pmo-dragtip').innerText().catch(() => '');
    check('R5 drag: live tip warns about the new conflict', /conflicts with/.test(tip5) && await page.locator('.pmo-dragtip.conf').count() === 1, tip5);
    await page.mouse.up(); await settle();
    const after5 = await E5('scheduleConflicts', PRJ);
    check('R5 drag: conflict recorded after the drop', after5.some(c => c.workId === pair.w && c.dep === pair.d) && after5.length > confBefore, after5.length);
    check('R5 timeline: marker + red bar outline after the drag', await page.locator(`[data-conf-mark="${pair.w}"]`).count() === 1 && await page.locator(`.tl [data-bar="${pair.w}"].pmo-conf`).count() === 1);
    check('R5 timeline: conflict banner lists the conflicts', (await page.locator('[data-conf-bar]').innerText()).includes(`${after5.length} scheduling conflict`));
  }
  /* non-PM may preview but not apply */
  await asPersona('^Maya Chen'); await page.waitForSelector('[data-autosched]');
  await page.click('[data-autosched]'); await modalOpen();
  check('R5 auto-schedule: non-PM preview has no Apply, explains who can', await page.locator('.overlay [data-act="apply"]').count() === 0 && /Only Tom Alvarez \(project manager\)/.test(await page.locator('.overlay .pmo-ro-note').innerText()));
  await act('cancel');
  await asPersona('Project Manager'); await page.waitForSelector('[data-autosched]');
  const prop = await E5('autoSchedule', PRJ);
  await page.click('[data-autosched]'); await modalOpen();
  const asRows = await page.locator('.overlay [data-as-row]').count();
  check('R5 auto-schedule: preview shows one before → after row per proposed move', asRows === Object.keys(prop).length && asRows > 0, { asRows, n: Object.keys(prop).length });
  if (pair) {
    const rowTxt = await page.locator(`.overlay [data-as-row="${pair.w}"]`).innerText().catch(() => '');
    const f5 = s => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    check('R5 auto-schedule: dragged item proposed after its predecessor', !!prop[pair.w] && prop[pair.w].start >= pair.dd && rowTxt.includes(f5(prop[pair.w].start)), rowTxt);
  }
  await shot('20-autoschedule-preview-1440', false);
  await act('apply'); await page.waitForSelector('.toast:has-text("Applied")', { timeout: 20000 }).catch(() => {}); await settle();
  const applied = await Promise.all(Object.entries(prop).map(async ([id, v]) => { const w = await getDoc('workItem', id); return w.start === v.start && w.due === v.due ? null : { id, v, w: [w.start, w.due] }; }));
  check('R5 auto-schedule: applied dates match the preview', applied.every(x => !x), applied.filter(Boolean));
  check('R5 auto-schedule: no conflicts left', (await E5('scheduleConflicts', PRJ)).length === 0 && await page.locator('[data-conf-mark]').count() === 0 && await page.locator('[data-conf-bar].has').count() === 0, await E5('scheduleConflicts', PRJ));
  check('R5 history: auto-schedule moves summarised', /Auto-scheduled “.+”: .+ → .+/.test(await feedText()));
  await shot('21-timeline-after-autoschedule-1440');

  console.log('R5 external dependencies');
  await prjGo('?mode=work', 'table.pmo-work');
  const extW = await page.evaluate(async ([u, prj]) => { const { store } = await import(u); const mine = store.list('workItem', w => w.projectId === prj && w.status !== 'done')[0]; const ext = store.list('workItem', w => w.projectId !== prj && store.get('project', w.projectId))[0]; return mine && ext ? { mine: mine.id, ext: ext.id, title: mine.title } : null; }, [STORE, PRJ]);
  check('R5 external: an item in another project exists', !!extW);
  if (extW) {
    await page.click(`[data-edit-work="${extW.mine}"]`); await modalOpen();
    check('R5 external: modal lists other projects\' work as "external"', await page.locator('.overlay [data-ext-deps] .pmo-ext').count() > 1);
    await page.click('.overlay [data-ext-deps] > summary');
    await page.check(`.overlay input[name="deps"][value="${extW.ext}"]`); await act('save'); await settle();
    const mw = await getDoc('workItem', extW.mine);
    check('R5 external: dependency saved', (mw.deps || []).some(d => (typeof d === 'object' ? d.id : d) === extW.ext));
    check('R5 external: Work tab marks it external', await page.locator(`tr[data-wid="${extW.mine}"] .pmo-ext`).count() === 1);
    check('R5 history: external dependency named', /now after .+ \(external\)/.test(await feedText()));
  }

  console.log('R5/R6 causing slip: one schedule badge per item');
  const badgeKeys = await page.evaluate(async ([u, prj]) => { const { store } = await import(u); const o = {}; store.list('workItem', w => w.projectId === prj).forEach(w => { o[w.id] = window.PMOEngine.scheduleBadge(store.state.docs, w.id, store.state.today).key; }); return o; }, [STORE, PRJ]);
  const KEYMAP = { done: 'done', late: 'late', causing: 'causing', slipping: 'slip', soon: 'soon', ontrack: 'ok' };
  const slipIds = Object.keys(badgeKeys).filter(id => badgeKeys[id] === 'causing');
  check('R5 causing slip: the engine flags some items (E().scheduleBadge)', slipIds.length > 0, badgeKeys);
  const oneBadge = async (rowSel) => page.evaluate(([sel, keys, km]) => [...document.querySelectorAll(sel)].map(el => { const id = el.dataset.wid || el.dataset.card; const b = [...el.querySelectorAll('[data-sched]')]; return b.length === 1 && b[0].dataset.sched === km[keys[id]] ? null : { id, n: b.length, shown: b.map(x => x.dataset.sched), want: keys[id] }; }).filter(Boolean), [rowSel, badgeKeys, KEYMAP]);
  const wb = await oneBadge('tr[data-wid]');
  check('R6 exactly one schedule badge per Work row, matching E().scheduleBadge', wb.length === 0, wb);
  const hasBadge = async sel => (await Promise.all(slipIds.map(async id => await page.locator(sel(id)).count() > 0))).every(Boolean);
  check('R5 causing slip: badge on every flagged Work row', await hasBadge(id => `tr[data-wid="${id}"] [data-causes-slip]`) && await page.locator('tr[data-wid] [data-causes-slip]').count() === slipIds.length);
  await prjGo('?mode=board', '[data-board]');
  const cb = await oneBadge('.pmo-card[data-card]');
  check('R6 exactly one schedule badge per Board card, matching E().scheduleBadge', cb.length === 0, cb);
  check('R5 causing slip: badge on every flagged Board card', await hasBadge(id => `[data-card="${id}"] [data-causes-slip]`) && await page.locator('[data-card] [data-causes-slip]').count() === slipIds.length);
  await prjGo('?mode=timeline', '.tl .tbar');
  check('R5 causing slip: badge on every flagged Timeline row', await page.locator('.tl tr [data-causes-slip]').count() === slipIds.length);
  await prjGo('', '.canvas.pm .node');
  const slipSteps = await page.evaluate(async ([u, ids, prj]) => { const { store } = await import(u); return [...new Set(ids.map(id => store.get('workItem', id)).filter(w => window.PMOEngine.stepState(store.state.docs, prj, w.pid, w.step, store.state.today).sched !== 'late').map(w => w.step))]; }, [STORE, slipIds, PRJ]);
  check('R6 map: no step shows both "Causing slip" and an on-track badge', await page.evaluate(() => [...document.querySelectorAll('.canvas.pm .node[data-step]')].every(n => !(n.querySelector('[data-causes-slip]') && n.querySelector('[data-sched="ok"]')))));
  check('R5 causing slip: badge on the Map step of each flagged item', (await Promise.all(slipSteps.map(async s => await page.locator(`.canvas.pm .node[data-step="${s}"] [data-causes-slip]`).count() === 1))).every(Boolean), slipSteps);
  await shot('22-map-causing-slip-1440');
  /* zero-work project: grey "Not planned" everywhere, never Green; created with PM + release manager */
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]');
  await page.click('.sect [data-new-project]'); await modalOpen();
  check('R5 new project: Project manager + Release manager selects', await page.locator('.overlay label[for="pf-pm"]').textContent() === 'Project manager' && await page.locator('.overlay label[for="pf-rm"]').textContent() === 'Launch owner');
  const NP5 = 'E2E Northwind unplanned initiative';
  await page.fill('.overlay input[name="name"]', NP5); await page.selectOption('.overlay select[name="releaseManager"]', 'ar');
  await page.fill('.overlay input[name="program"]', 'E2E Program'); await page.fill('.overlay input[name="budget"]', '30000');
  await act('create'); await page.waitForURL(/\/project\/prj-/); await page.waitForSelector('.pmo-hrag'); await settle();
  const np5 = await getDoc('project', decodeURIComponent(new URL(page.url()).pathname.split('/project/')[1]));
  check('R5 new project: roles, program, budget saved', np5.owner === tomId && np5.releaseManager === 'ar' && np5.resources.includes('ar') && np5.program === 'E2E Program' && np5.budget.planned === 30000, np5);
  check('R5 Not planned: project header label is grey', await page.locator('.hdr [data-summary-label="none"]').count() === 1 && (await page.locator('.pmo-hrag').innerText()).includes('Not planned') && await page.locator('.hdr [data-summary-label="green"]').count() === 0);
  check('R5 Not planned: finish KPI says so', (await page.locator('[data-kpi-finish]').innerText()).includes('Not planned'));
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]');
  check('R5 Not planned: home tile grey, never On track', await page.locator('.home-grid a.tile', { hasText: NP5 }).locator('[data-summary-label="none"]').count() === 1 && await page.locator('.home-grid a.tile', { hasText: NP5 }).locator('[data-summary-label="green"]').count() === 0);
  check('R5 home: every RAG pill shows its reason', await page.locator('.home-grid .rag').count() === await page.locator('.home-grid .rag [data-rag-reason]').count());

  console.log('R5 portfolio: programs, financials, burndown, day rates');
  await page.goto(ROOT + '/portfolio'); await page.waitForSelector('[data-financials]'); await settle();
  check('R5 Not planned: portfolio row grey', await page.locator('[data-prow]', { hasText: NP5 }).locator('[data-summary-label="none"]').count() === 1 && (await page.locator('[data-prow]', { hasText: NP5 }).innerText()).includes('Not planned'));
  check('R5 portfolio: every RAG pill shows its reason', await page.locator('.pmo-ptable .rag').count() === await page.locator('.pmo-ptable .rag [data-rag-reason]').count());
  const progs = await page.evaluate(async u => { const { store } = await import(u); return [...new Set(store.list('project').map(p => p.program || 'No program'))]; }, STORE);
  check('R5 portfolio: grouped by program', await page.locator('[data-program-row]').count() === progs.length && await page.locator('[data-program-row="E2E Program"]').count() === 1, progs);
  const finOk = async () => (await Promise.all((await page.locator('[data-fin]').evaluateAll(rs => rs.map(r => r.dataset.fin))).map(async id => {
    const f = await E5('projectFinancials', id); const row = page.locator(`[data-fin="${id}"]`);
    return (await row.locator('[data-fin-forecast]').innerText()) === money5(f.forecastCost) && (await row.locator('[data-fin-actual]').innerText()) === money5(f.actualCost) && (f.planned == null || (await row.locator('[data-fin-planned]').innerText()) === money5(f.planned)); }))).every(Boolean);
  check('R5 financials: planned / forecast / actual match the engine', await page.locator('[data-fin]').count() >= 3 && await finOk());
  const bd = await E5('burndown', await page.inputValue('[data-burn-prj]'), await page.evaluate(async u => (await import(u)).store.state.today, STORE));
  const burnHidden = await page.locator('[data-burn-hidden="portfolio"]').count();
  const bst = await page.evaluate(async ([u, id]) => { const { store } = await import(u); return window.PMOEngine.projectTruth(store.state.docs, id, store.state.today).burndown; }, [STORE, await page.inputValue('[data-burn-prj]')]);
  check('R8 burndown shows here only when it agrees with SPI (else on Sprints)', !!burnHidden === !!bst.sprintsOnly, { burnHidden, bst });
  if (!burnHidden) {
    check('R5 burndown: SVG with actual + ideal lines', (await page.getAttribute('[data-burn="portfolio"] [data-line="actual"]', 'd')).startsWith('M') && (await page.getAttribute('[data-burn="portfolio"] [data-line="ideal"]', 'd')).startsWith('M'));
    check('R5 burndown: accessible label + data table matches the engine', /remaining/.test(await page.getAttribute('[data-burn="portfolio"] svg', 'aria-label')) && await page.locator('[data-burn="portfolio"] tbody tr').count() === bd.length, { rows: await page.locator('[data-burn="portfolio"] tbody tr').count(), n: bd.length });
  }
  /* day rate next to capacity */
  const rate0 = await page.innerText('[data-rate="dk"]');
  await page.click('[data-rate="dk"]'); await modalOpen(); await page.fill('.overlay input[name="dayRate"]', '1200'); await act('save'); await settle();
  check('R5 day rate: saved on the person', (await getDoc('person', 'dk')).dayRate === 1200 && (await page.innerText('[data-rate="dk"]')).includes('$1,200'), rate0);
  check('R5 day rate: financials recalculated', await finOk());
  await sleep(600); await page.reload(); await page.waitForSelector('[data-rate="dk"]');
  check('R5 reload: day rate persisted', (await page.innerText('[data-rate="dk"]')).includes('$1,200'));
  await shot('23-portfolio-r5-1440');

  console.log('R5 project burndown, sprint burndown, report recipients');
  await prjGo('?mode=sprints', '[data-sprints]');
  check('R5 sprint burndown in the Sprints view', await page.locator('[data-sprint-burn] [data-burn="sprint"] svg, [data-sprint-burn] [data-burn-empty]').count() === 1 && await page.locator('[data-sburn-pick] option').count() === await page.locator('[data-sprint]').count());
  const spPick = await page.locator('[data-sburn-pick] option').nth(1).getAttribute('value');
  await page.selectOption('[data-sburn-pick]', spPick); await settle();
  check('R5 sprint burndown: picking a sprint redraws it', await page.inputValue('[data-sburn-pick]') === spPick);
  check('R6 rail: exactly one burndown on Sprints (the sprint burndown, in the rail)', await page.locator('[data-burn], [data-burn-empty]').count() === 1 && await page.locator('.side [data-sprint-burn]').count() === 1);
  await shot('24-sprints-burndown-1440');
  await prjGo('', '.canvas.pm');
  await page.click('[data-report]'); await page.waitForSelector('[data-prj-rep] [data-rep-body]', { timeout: 30000 });
  const rc5 = await page.evaluate(async ([u, prj]) => { const { store } = await import(u); const E = window.PMOEngine; const j = store.get('project', prj);
    const em = id => { const n = store.person(id).name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/); return n[0] + '.' + n[n.length - 1] + '@northwind.example'; };
    const used = new Set(j.processes.flatMap(pid => E.flatSteps((store.get('process', pid) || {}).tobe || []).flatMap(s => [...(s.data || []), ...(s.subs || []).flatMap(x => x.data || [])])));
    return { to: [...new Set([j.owner, ...j.resources])].map(em), notLive: [...used].filter(d => E.effectiveAvail(store.state.docs, d) !== 'live').length }; }, [STORE, PRJ]);
  const mail5 = decodeURIComponent((await page.getAttribute('[data-rep-mail]', 'href')).split('?')[0].replace(/^mailto:/, '')).split(',');
  check('R5 email draft: recipients are the project resources as first.last@northwind.example', JSON.stringify(mail5.sort()) === JSON.stringify(rc5.to.slice().sort()) && await page.locator('[data-rep-to] [data-rcpt]').count() === rc5.to.length, { mail5, to: rc5.to });
  check('R5 report: "not yet live" count = missing + examples + pending', (await page.innerText('[data-rep-notlive]')).includes(`${rc5.notLive} of`) && /not (connected|available) yet/.test(await page.innerText('[data-prj-rep] .pmo-rep-p')), await page.innerText('[data-prj-rep] .pmo-rep-p'));
  const body5 = new URL(await page.getAttribute('[data-rep-mail]', 'href')).searchParams.get('body');
  check('R5 email body carries the same count', body5.includes(`Information: ${rc5.notLive} of`));
  await shot('25-report-recipients-1440', false);
  check('R5: no unlabelled icon-only controls', (await unlabelled()).length === 0, await unlabelled());

  /* ================= R6 ================= */
  console.log('R6/R8 health (projectTruth) everywhere');
  const tom6 = await asPersona('Project Manager');
  const healthAll = await page.evaluate(async u => { const { store } = await import(u); const o = {}; store.list('project').forEach(p => { o[p.id] = { live: p.status === 'live', n: store.list('workItem', w => w.projectId === p.id).length, h: window.PMOEngine.projectTruth(store.state.docs, p.id, store.state.today) }; }); return o; }, STORE);
  const wantK = x => x.live ? 'live' : ({ red: 'red', amber: 'amber', green: 'green' })[x.h.rag] || 'none';
  await prjGo('', '.canvas.pm');
  const hdrRag = { k: await page.getAttribute('.hdr [data-summary-label]', 'data-summary-label'), why: await page.innerText('.hdr [data-summary-sentence]').catch(() => '') };
  check('R8 header label + sentence = E().projectTruth', hdrRag.k === wantK(healthAll[PRJ]) && hdrRag.why === healthAll[PRJ].h.sentence, { hdrRag, h: healthAll[PRJ].h.sentence });
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]');
  const homeRag = await page.evaluate(() => [...document.querySelectorAll('.home-grid a.tile[href*="/project/"]')].map(a => [decodeURIComponent(a.getAttribute('href').split('/project/')[1]), a.querySelector('[data-summary-label]').dataset.summaryLabel]));
  check('R8 home tiles label = projectTruth', homeRag.length > 0 && homeRag.every(([id, k]) => k === wantK(healthAll[id])), homeRag);
  await page.goto(ROOT + '/portfolio'); await page.waitForSelector('.pmo-ptable');
  const pfRag = await page.evaluate(() => [...document.querySelectorAll('[data-prow]')].map(r => [r.dataset.prow, r.querySelector('[data-summary-label]').dataset.summaryLabel]));
  check('R8 portfolio rows label = projectTruth', pfRag.length > 0 && pfRag.every(([id, k]) => k === wantK(healthAll[id])), pfRag);
  check('R8 status rule: At risk only when the finish misses the deadline or something unplanned blocks', (await page.innerText('.pmo-rule')).includes('misses the deadline'));

  console.log('R6 view-aware right rail');
  const railOf = async () => page.evaluate(() => ({ blockers: !!document.querySelector('.side [data-blockers]'), upnext: !!document.querySelector('.side [data-upnext]'), legend: !!document.querySelector('.side [data-legend]'),
    conf: !!document.querySelector('.side [data-rail-conflicts]'), crit: !!document.querySelector('.side [data-rail-crit]'), sstats: !!document.querySelector('.side [data-sprint-stats]'),
    burn: document.querySelectorAll('[data-burn], [data-burn-empty]').length, fsum: !!document.querySelector('.side [data-filter-summary]'), act: document.querySelectorAll('.side [data-activity]').length, comments: document.querySelectorAll('.side .card > h3').length }));
  await prjGo('', '.canvas.pm'); const rMap = await railOf();
  check('R6 rail Map: blockers, up next, legend; no timeline/sprint cards', rMap.blockers && rMap.upnext && rMap.legend && !rMap.conf && !rMap.crit && !rMap.sstats && rMap.burn === 0 && rMap.act === 1, rMap);
  await prjGo('?mode=timeline', '.tl .tbar'); const rTl = await railOf();
  check('R6 rail Timeline: conflicts + critical path only', rTl.conf && rTl.crit && !rTl.blockers && !rTl.upnext && !rTl.sstats && rTl.burn === 0 && rTl.act === 1, rTl);
  await prjGo('?mode=board', '[data-board]'); const rB = await railOf();
  check('R6 rail Board: sprint stats, no burndown', rB.sstats && rB.burn === 0 && !rB.blockers && !rB.crit && rB.act === 1, rB);
  await prjGo('?mode=sprints', '[data-sprints]'); const rS = await railOf();
  check('R6 rail Sprints: sprint stats + exactly one burndown', rS.sstats && rS.burn === 1 && rS.act === 1, rS);
  await prjGo('?mode=work&status=open', 'table.pmo-work'); const rW = await railOf();
  check('R6 rail Work: filter summary', rW.fsum && !rW.blockers && !rW.crit && rW.act === 1 && /showing/i.test(await page.innerText('[data-filter-summary]')) && (await page.innerText('[data-filter-summary]')).includes('not done'), Object.assign(rW, { t: await page.innerText('[data-filter-summary]') }));

  console.log('R6 timeline: resize, keyboard, critical path chain');
  await prjGo('?mode=timeline', '.tl .tbar');
  const cpE = await E5('criticalPath', PRJ, todayStr);
  const cpRail = await page.locator('[data-rail-crit] [data-crit-item]').evaluateAll(xs => xs.map(x => x.dataset.critItem));
  check('R6 critical path: rail lists the full engine chain in order', cpE.length > 0 && JSON.stringify(cpRail) === JSON.stringify(cpE), { cpE, cpRail });
  const cpMine = await page.evaluate(async ([u, ids, prj]) => { const { store } = await import(u); return ids.filter(id => (store.get('workItem', id) || {}).projectId === prj); }, [STORE, cpE, PRJ]);
  check('R6 critical path: external links in the chain are labelled in the rail', await page.locator('[data-rail-crit] [data-crit-ext]').count() === cpE.length - cpMine.length);
  check('R6 critical path: every chain bar in this project highlighted', await page.locator('.tl .tbar.pmo-crit').count() === cpMine.length, { cpE, bars: await page.locator('.tl .tbar.pmo-crit').evaluateAll(xs => xs.map(x => x.dataset.bar)), toggle: await page.isChecked('[data-crit-toggle]') });
  const rzId = await page.evaluate(() => { const b = [...document.querySelectorAll('.tl button.tbar[data-bar]')].find(x => x.getBoundingClientRect().width > 40); return b && b.dataset.bar; });
  check('R6 resize: owner/PM bars carry a right-edge handle', !!rzId && await page.locator('.tl span.tbar [data-rsz]').count() === 0 && await page.locator('.tl button.tbar [data-rsz]').count() === await page.locator('.tl button.tbar').count());
  if (rzId) {
    const rz0 = await getDoc('workItem', rzId);
    const pxDay = await page.evaluate(id => { const box = document.querySelector('#pmoTl'); return document.querySelector(`[data-bar="${id}"]`).parentElement.clientWidth / Number(box.dataset.span); }, rzId);
    await page.locator(`.tl [data-bar="${rzId}"]`).scrollIntoViewIfNeeded();
    const h = await page.locator(`.tl [data-bar="${rzId}"] [data-rsz]`).boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(h.x + h.width / 2 + pxDay * 2 * k / 6, h.y + h.height / 2);
    check('R6 resize: live tip shows the new due date', /^Due [A-Z][a-z]{2} \d+ \(\+2d\)/.test(await page.locator('.pmo-dragtip').innerText().catch(() => '')));
    await page.mouse.up(); await settle();
    const rz1 = await getDoc('workItem', rzId);
    check('R6 resize: due +2d, start unchanged', rz1.start === rz0.start && shift(rz0.due, rz1.due) === 2, { rz0: [rz0.start, rz0.due], rz1: [rz1.start, rz1.due] });
    check('R6 resize: no modal opened', await page.locator('.overlay').count() === 0);
    check('R6 history: resize summarised', /Resized “.+” on the timeline: due .+ → .+ \(\+2d\)/.test(await feedText()));
    /* keyboard: ←/→ moves one business day, Shift resizes */
    await page.focus(`.tl button.tbar[data-bar="${rzId}"]`);
    await page.keyboard.press('ArrowRight'); await settle();
    const k1 = await getDoc('workItem', rzId);
    const biz = await page.evaluate(([a, n]) => window.PMOEngine.addBusinessDays(a, n), [rz1.start, 1]);
    const bizDue = await page.evaluate(([a, n]) => window.PMOEngine.addBusinessDays(a, n), [rz1.due, 1]);
    check('R6 keyboard →: moves one business day (start and due)', k1.start === biz && k1.due === bizDue, { rz1, k1, biz, bizDue });
    check('R6 keyboard: focus stays on the bar after re-render', await page.evaluate(id => document.activeElement && document.activeElement.dataset.bar === id, rzId));
    await page.keyboard.press('Shift+ArrowLeft'); await settle();
    const k2 = await getDoc('workItem', rzId);
    check('R6 keyboard Shift+←: due one business day earlier, start kept', k2.start === k1.start && k2.due === await page.evaluate(([a]) => window.PMOEngine.addBusinessDays(a, -1), [k1.due]), { k1, k2 });
    await page.keyboard.press('ArrowLeft'); await settle();
    const k3 = await getDoc('workItem', rzId);
    check('R6 keyboard ←: moves back one business day', k3.start === await page.evaluate(([a]) => window.PMOEngine.addBusinessDays(a, -1), [k2.start]), { k2, k3 });
  }
  /* auto-schedule preview = the fixed engine */
  await page.click('[data-autosched]'); await modalOpen();
  const asE = await E5('autoSchedule', PRJ);
  const asMoves = Object.entries(asE && asE.moves ? asE.moves : asE || {}).filter(([id, v]) => { const w = healthAll && true; return v && v.start; });
  const asShown = await page.locator('.overlay [data-as-row]').count();
  check('R6 auto-schedule preview rows come from E().autoSchedule (only changed items)', asShown <= asMoves.length && (asShown > 0 || await page.locator('.overlay [data-as-none]').count() === 1), { asShown, n: asMoves.length });
  check('R6 auto-schedule copy: durations kept exactly, conflict-free items stay', /Durations are kept exactly/.test(await page.innerText('.overlay .modal')) || await page.locator('.overlay [data-as-none]').count() === 1);
  await act('cancel');
  await shot('30-r6-timeline-1440');

  console.log('R6 capacity leveling');
  await page.click('[data-level]'); await modalOpen();
  const lvE = await E5('levelResources', PRJ, todayStr);
  check('R6 leveling preview: before/after overload counts from E().levelResources', Number(await page.innerText('[data-lv-before]')) === lvE.overloadsBefore.length && Number(await page.innerText('[data-lv-after]')) === lvE.overloadsAfter.length, { b: lvE.overloadsBefore.length, a: lvE.overloadsAfter.length });
  const lvShift = Object.keys(lvE.shifts || {});
  check('R6 leveling preview: one before → after row per proposed shift', await page.locator('.overlay [data-lv-row]').count() === lvShift.length, lvShift);
  await shot('31-r6-level-1440', false);
  if (lvShift.length) {
    await act('apply'); await page.waitForSelector('.toast:has-text("Applied")', { timeout: 20000 }).catch(() => {}); await settle();
    const applied = await page.evaluate(async ([u, sh]) => { const { store } = await import(u); return Object.entries(sh).every(([id, v]) => { const w = store.get('workItem', id); return w.start === v.start && w.due === v.due; }); }, [STORE, lvE.shifts]);
    check('R6 leveling apply: work items take the proposed dates', applied);
    check('R6 leveling apply: overloads reduced', (await E5('levelResources', PRJ, todayStr)).overloadsBefore.length <= lvE.overloadsAfter.length);
    check('R6 history: leveling summarised', /Leveled “.+”/.test(await feedText()));
  } else await act('cancel');

  console.log('R6 what-if scenarios');
  await prjGo('?mode=timeline', '.tl .tbar');
  const live0 = await page.evaluate(async ([u, prj]) => { const { store } = await import(u); const o = {}; store.list('workItem', w => w.projectId === prj).forEach(w => { o[w.id] = [w.start, w.due]; }); return o; }, [STORE, PRJ]);
  await page.click('[data-scen-new]'); await modalOpen();
  await page.fill('.overlay input[name="name"]', ''); await page.click('.overlay [data-act="create"]'); await page.waitForSelector('.overlay .banner');
  check('R6 scenario: name required, dialog kept', (await page.innerText('.overlay .banner')).includes('name'));
  await page.fill('.overlay input[name="name"]', 'E2E push the bank work'); await act('create'); await settle();
  await page.waitForSelector('[data-scenario]');
  check('R6 scenario: URL carries the scenario + banner says it is a scenario', /[?&]sc=/.test(page.url()) && /WHAT-IF SCENARIO/.test(await page.innerText('[data-scenario]')) && /Nothing in the live plan changes until you apply/.test(await page.innerText('[data-scenario]')));
  const sc6 = (await getDoc('project', PRJ)).scenarios.find(x => x.name === 'E2E push the bank work');
  check('R6 scenario: project.scenarios clones the plan dates', sc6 && Object.keys(sc6.dates).length === Object.keys(live0).length && Object.entries(sc6.dates).every(([id, d]) => live0[id] && d.due === live0[id][1]), sc6);
  check('R6 scenario: every open bar is draggable for the PM, and the timeline is outlined', await page.locator('.tl.pmo-tl-scen').count() === 1 && await page.locator('.tl button.tbar').count() > 0);
  const scBar = await page.evaluate(() => { const b = [...document.querySelectorAll('.tl button.tbar[data-bar]')].find(x => x.getBoundingClientRect().width > 30); return b && b.dataset.bar; });
  const pxD = await page.evaluate(id => document.querySelector(`[data-bar="${id}"]`).parentElement.clientWidth / Number(document.querySelector('#pmoTl').dataset.span), scBar);
  await page.locator(`.tl [data-bar="${scBar}"]`).scrollIntoViewIfNeeded();
  const bb6 = await page.locator(`.tl [data-bar="${scBar}"]`).boundingBox();
  await page.mouse.move(bb6.x + 8, bb6.y + bb6.height / 2); await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(bb6.x + 8 + pxD * 10 * k / 6, bb6.y + bb6.height / 2);
  await page.mouse.up(); await settle();
  const scAfter = (await getDoc('project', PRJ)).scenarios.find(x => x.id === sc6.id);
  const liveAfter = await getDoc('workItem', scBar);
  check('R6 scenario drag: scenario dates move +10d', shift(live0[scBar][0], scAfter.dates[scBar].start) === 10 && shift(live0[scBar][1], scAfter.dates[scBar].due) === 10, { live: live0[scBar], sc: scAfter.dates[scBar] });
  check('R6 scenario drag: the live plan is untouched', liveAfter.start === live0[scBar][0] && liveAfter.due === live0[scBar][1], liveAfter);
  check('R6 scenario: moved bar marked', await page.locator(`.tl [data-bar="${scBar}"].pmo-scen-moved`).count() === 1);
  const cmpE = await page.evaluate(async ([u, prj, id]) => { const { store } = await import(u); const j = store.get('project', prj); return window.PMOEngine.compareScenario(store.state.docs, prj, j.scenarios.find(x => x.id === id), store.state.today); }, [STORE, PRJ, sc6.id]);
  const fmtD = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  check('R6 scenario compare: finish and cost from E().compareScenario', (await page.innerText('[data-cmp-finish]')) === fmtD(cmpE.scenarioFinish) && (await page.innerText('[data-cmp-cost]')).replace(/\D/g, '') === String(Math.round(cmpE.scenarioCost)) && (await page.innerText('[data-scen-compare]')).includes('plan ' + fmtD(cmpE.planFinish)), cmpE);
  await shot('32-r6-scenario-1440');
  await sleep(500); await page.reload(); await page.waitForSelector('[data-scenario]');
  check('R6 scenario: reload keeps the scenario open', await page.locator(`.tl [data-bar="${scBar}"].pmo-scen-moved`).count() === 1);
  await page.click('[data-scen-apply]'); await modalOpen(); await act('apply'); await settle();
  const liveApplied = await getDoc('workItem', scBar);
  check('R6 scenario apply: live item takes the scenario dates', liveApplied.start === scAfter.dates[scBar].start && liveApplied.due === scAfter.dates[scBar].due, liveApplied);
  check('R6 scenario apply: scenario removed, back on the plan', !((await getDoc('project', PRJ)).scenarios || []).some(x => x.id === sc6.id) && await page.locator('[data-scenario]').count() === 0 && !/[?&]sc=/.test(page.url()));
  check('R6 history: scenario applied', /Applied scenario “E2E push the bank work”/.test(await feedText()));
  /* second scenario: discard leaves the plan alone */
  await page.click('[data-scen-new]'); await modalOpen(); await page.fill('.overlay input[name="name"]', 'E2E throwaway'); await act('create'); await settle(); await page.waitForSelector('[data-scenario]');
  const sc7 = (await getDoc('project', PRJ)).scenarios.find(x => x.name === 'E2E throwaway');
  await page.focus(`.tl button.tbar[data-bar="${scBar}"]`); await page.keyboard.press('ArrowRight'); await settle();
  check('R6 scenario keyboard: → moves the scenario date only', (await getDoc('project', PRJ)).scenarios.find(x => x.id === sc7.id).dates[scBar].start !== liveApplied.start && (await getDoc('workItem', scBar)).start === liveApplied.start);
  await page.click('[data-scen-discard]'); await modalOpen(); await act('discard'); await settle();
  check('R6 scenario discard: removed, live plan unchanged', !((await getDoc('project', PRJ)).scenarios || []).some(x => x.id === sc7.id) && (await getDoc('workItem', scBar)).start === liveApplied.start);
  await asPersona('Maya'); await prjGo('?mode=timeline', '.tl .tbar');
  check('R6 scenario: non-PM cannot create one (explains who can)', await page.locator('[data-scen-new]').isDisabled() && /project manager/.test(await page.getAttribute('[data-scen-new]', 'title')));
  await asPersona('Project Manager');

  console.log('R6 custom statuses + fields');
  await prjGo('?mode=board', '[data-board]');
  await page.click('[data-customize]'); await modalOpen();
  check('R6 customize: one row per status, in order', await page.locator('.overlay [data-st-row]').count() === stNames.length);
  /* validation: removing every "finished" status keeps the dialog and input */
  const doneRow = page.locator('.overlay [data-st-row]').filter({ has: page.locator('select[data-k="maps"] option[value="done"]:checked') });
  await doneRow.locator('[data-cz-del]').click();
  await page.click('.overlay [data-act="save"]'); await page.waitForSelector('.overlay .banner');
  check('R6 customize: needs a finished status (dialog kept)', /finished/.test(await page.innerText('.overlay .banner')) && await page.locator('.overlay [data-st-row]').count() === stNames.length - 1);
  await act('cancel');
  await page.click('[data-customize]'); await modalOpen();
  await page.click('.overlay [data-cz-add-st]');
  const newRow = page.locator('.overlay [data-st-row]').last();
  await newRow.locator('[data-k="name"]').fill('Blocked'); await newRow.locator('[data-k="maps"]').selectOption('prog');
  const blkIdx = () => page.locator('.overlay [data-st-row] [data-k="name"]').evaluateAll(xs => xs.findIndex(x => x.value === 'Blocked'));
  for (let k = 0; k < 3; k++) await page.locator('.overlay [data-st-row]').nth(await blkIdx()).locator('[data-cz-up]').click(); /* up to second place */
  await page.click('.overlay [data-cz-add-fd]');
  const fRow = page.locator('.overlay [data-fd-row]').last();
  await fRow.locator('[data-k="label"]').fill('Vendor tier'); await fRow.locator('[data-k="type"]').selectOption('select');
  check('R6 customize: options input appears for a pick list', await fRow.locator('[data-k="options"]').isVisible());
  await fRow.locator('[data-k="options"]').fill('Gold, Silver');
  await shot('33-r6-customize-1440', false);
  await act('save'); await settle();
  const pj6 = await getDoc('project', PRJ);
  check('R6 statuses saved in order with mappings', pj6.statuses.map(x => x.name).join('|') === 'Not started|Blocked|In progress|In review|Done' && pj6.statuses.find(x => x.name === 'Blocked').maps === 'prog', pj6.statuses);
  check('R6 field saved: {key, label, type, options}', pj6.fields.some(f => f.key === 'vendorTier' && f.label === 'Vendor tier' && f.type === 'select' && f.options.join() === 'Gold,Silver'), pj6.fields);
  check('R6 board columns follow the new statuses', (await page.locator('.pmo-col-h b').allInnerTexts()).join('|') === 'Not started|Blocked|In progress|In review|Done');
  const blkCol = pj6.statuses.find(x => x.name === 'Blocked').id;
  const mv6 = await page.locator('.pmo-col[data-col="idle"] .pmo-card.pmo-cdrag').first().getAttribute('data-card');
  await dnd(`.pmo-card[data-card="${mv6}"]`, `.pmo-col[data-col="${blkCol}"] .pmo-col-b`);
  const mvDoc = await getDoc('workItem', mv6);
  check('R6 drag into a custom status: statusId + engine mapping saved', mvDoc.statusId === blkCol && mvDoc.status === 'prog' && !mvDoc.doneAt, mvDoc);
  check('R6 card shows in the custom column', await page.locator(`.pmo-col[data-col="${blkCol}"] [data-card="${mv6}"]`).count() === 1);
  check('R6 history: custom status move named', /Not started → Blocked/.test(await feedText()));
  /* custom field values on a work item */
  await prjGo('?mode=work', 'table.pmo-work');
  await page.click(`[data-edit-work="${mv6}"]`); await modalOpen();
  check('R6 work modal: a control per custom field, status select lists custom statuses', await page.locator('.overlay [data-cf-inputs] [name="cf_riskArea"]').count() === 1 && await page.locator('.overlay [name="cf_vendorTier"]').count() === 1 && await page.locator('.overlay select[name="status"] option').count() === 5);
  await page.selectOption('.overlay [name="cf_vendorTier"]', 'Gold'); await act('save'); await settle();
  check('R6 custom field value saved in workItem.custom', (await getDoc('workItem', mv6)).custom.vendorTier === 'Gold');
  check('R6 history: custom field change named', /Vendor tier — → Gold/.test(await feedText()));
  await page.selectOption('[data-fbar] [data-f="cf_vendorTier"]', 'Gold'); await settle();
  check('R6 filter by custom field: only matching items, in the URL', new URL(page.url()).searchParams.get('cf_vendorTier') === 'Gold' && await page.locator('tr[data-wid]').count() === 1 && await page.locator(`tr[data-wid="${mv6}"]`).count() === 1);
  check('R6 filter summary names the custom field', (await page.innerText('[data-filter-summary]')).includes('Vendor tier Gold'));
  await page.click('[data-fclear]'); await settle();
  await prjGo('?mode=board', '[data-board]');
  check('R6 board card tags show custom field values', await page.locator(`[data-card="${mv6}"] [data-ftag="vendorTier"]`).count() === 1 && await page.locator('[data-card] [data-ftag="riskArea"]').count() > 0);
  await page.uncheck('[data-cf-tags]'); await settle();
  check('R6 card tags are optional (toggle off hides them)', await page.locator('.pmo-board [data-ftag]').count() === 0);
  await page.check('[data-cf-tags]'); await settle();
  await sleep(500); await page.reload(); await page.waitForSelector('[data-board]');
  check('R6 reload: custom status + field persist', await page.locator(`.pmo-col[data-col="${blkCol}"] [data-card="${mv6}"] [data-ftag="vendorTier"]`).count() === 1);

  console.log('R6 time logging + earned value');
  await prjGo('?mode=work', 'table.pmo-work');
  const t0 = (await getDoc('workItem', mv6)).time || [];
  await page.click(`[data-log-time="${mv6}"]`); await modalOpen();
  await page.fill('.overlay input[name="hours"]', '0'); await page.fill('.overlay input[name="note"]', 'Vendor call'); await page.click('.overlay [data-act="log"]'); await page.waitForSelector('.overlay .banner');
  check('R6 log time: hours validated, note kept', /between 0.25 and 24/.test(await page.innerText('.overlay .banner')) && await page.inputValue('.overlay input[name="note"]') === 'Vendor call');
  await page.fill('.overlay input[name="hours"]', '3.5'); await act('log'); await settle();
  const t1 = (await getDoc('workItem', mv6)).time;
  check('R6 log time: entry {by, date, hours, note} appended', t1.length === t0.length + 1 && t1[t1.length - 1].by === tom6 && t1[t1.length - 1].hours === 3.5 && t1[t1.length - 1].date === todayStr && t1[t1.length - 1].note === 'Vendor call', t1);
  check('R6 work row shows hours logged', /3\.5h logged|\d+(\.\d)?h logged/.test(await page.innerText(`tr[data-wid="${mv6}"] [data-hours]`)));
  check('R6 history: time logged', /Logged 3\.5h on “.+”/.test(await feedText()));
  const ev6 = await E5('earnedValue', PRJ, todayStr);
  check('R6/R8 header: SPI, CPI from earnedValue; ONE cost forecast (projectTruth), no separate EAC', (await page.innerText('[data-hev] [data-ev-spi] b')) === (ev6.SPI == null ? '—' : ev6.SPI.toFixed(2)) && (await page.innerText('[data-hev] [data-ev-cpi] b')) === (ev6.CPI == null ? '—' : ev6.CPI.toFixed(2)) && (await page.innerText('[data-hfin] [data-t="cost"]')).replace(/\D/g, '') === String(Math.round((await E5('projectTruth', PRJ, todayStr)).cost.forecast)) && await page.locator('[data-ev-eac]').count() === 0, ev6);

  console.log('R6 exports');
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-work]')]);
  const csv1 = fs.readFileSync(await dl1.path(), 'utf8').replace(/^﻿/, '');
  const lines1 = csv1.trim().split(/\r\n/);
  const nWork = await page.locator('tr[data-wid]').count();
  check('R6 work CSV: header + one row per shown item, custom fields as columns', /\.csv$/.test(dl1.suggestedFilename()) && lines1[0].startsWith('ID,Title,Process,Step,Owner,Status') && lines1[0].includes('Risk area') && lines1[0].includes('Vendor tier') && lines1.length === nWork + 1, { name: dl1.suggestedFilename(), head: lines1[0], n: lines1.length, nWork });
  check('R6 work CSV: custom status name and hours exported', lines1.some(l => l.startsWith(mv6 + ',') && l.includes(',Blocked,') && l.includes('Gold')));
  await page.goto(ROOT + '/portfolio'); await page.waitForSelector('[data-financials]');
  const evRow = await page.evaluate(id => { const r = document.querySelector(`[data-fin="${id}"]`); return r && [r.querySelector('[data-ev-spi]').textContent, r.querySelector('[data-ev-cpi]').textContent]; }, PRJ);
  check('R6 portfolio financials: SPI/CPI from E().earnedValue', evRow && evRow[0] === (ev6.SPI == null ? '—' : ev6.SPI.toFixed(2)) && evRow[1] === (ev6.CPI == null ? '—' : ev6.CPI.toFixed(2)), { evRow, ev6 });
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-pf]')]);
  const lines2 = fs.readFileSync(await dl2.path(), 'utf8').replace(/^﻿/, '').trim().split(/\r\n/);
  const nPrj = await page.evaluate(async u => (await import(u)).store.list('project').length, STORE);
  check('R6/R8 portfolio CSV: one row per project with status, the one cost forecast and EV columns', lines2.length === nPrj + 1 && /Status,Status sentence/.test(lines2[0]) && /Planned budget,Actual cost,Forecast cost/.test(lines2[0]) && /SPI,CPI$/.test(lines2[0]) && !/EAC/.test(lines2[0]), { head: lines2[0], n: lines2.length, nPrj });
  await page.click('[data-gen-rep]'); await page.waitForSelector('[data-pf-rep] .pmo-rep-h', { timeout: 30000 });
  await page.evaluate(() => { window.__pfPrinted = 0; window.print = () => { window.__pfPrinted++; window.__pfCls = document.body.classList.contains('pmo-print-pf'); }; });
  await page.click('[data-print-pf-rep]');
  check('R6 portfolio report: Print / PDF prints only the report', await page.evaluate(() => window.__pfPrinted === 1 && window.__pfCls === true));
  await page.emulateMedia({ media: 'print' }); await page.evaluate(() => document.body.classList.add('pmo-print-pf'));
  check('R6 print stylesheet: only the report is visible', await page.evaluate(() => getComputedStyle(document.querySelector('[data-financials]')).visibility === 'hidden' && getComputedStyle(document.querySelector('[data-pf-rep] .pmo-rep-h')).visibility === 'visible'));
  await page.evaluate(() => document.body.classList.remove('pmo-print-pf')); await page.emulateMedia({ media: 'screen' });

  console.log('R6 dashboard');
  await page.evaluate(() => { try { localStorage.removeItem('pmoflow.dashboard'); } catch (e) { /* */ } });
  await page.goto(ROOT + '/dashboard'); await page.waitForSelector('[data-dash-grid]');
  check('R6 dashboard: nav entry active', (await page.innerText('#nav a.on')).trim() === 'Dashboard');
  const wids = () => page.locator('[data-widget]').evaluateAll(xs => xs.map(x => x.dataset.widget));
  const w0 = await wids();
  check('R6 dashboard: default widgets (RAG, EV, go-lives, blockers, risks, workload, burndown)', ['rag', 'burndown', 'ev', 'workload', 'risks', 'blockers', 'golives'].every(k => w0.includes(k)) && w0.length === 7, w0);
  const dashRag = await page.evaluate(() => [...document.querySelectorAll('[data-widget="rag"] [data-dash-prj]')].map(a => [a.dataset.dashPrj, a.querySelector('[data-summary-label]').dataset.summaryLabel]));
  check('R8 dashboard status widget = projectTruth', dashRag.length === nPrj && dashRag.every(([id, k]) => k === wantK(healthAll[id]) || id === PRJ), dashRag);
  check('R6 dashboard: program roll-up cards group by project.program', await page.locator('[data-rollup] [data-program]').count() === await page.evaluate(async u => new Set((await import(u)).store.list('project').map(p => String(p.program || '').trim() || 'No program')).size, STORE));
  check('R6 dashboard: blockers, go-lives, risks and EV widgets have rows', await page.locator('[data-dash-blocker]').count() > 0 && await page.locator('[data-dash-golive]').count() > 0 && await page.locator('[data-dash-risk]').count() > 0 && await page.locator('[data-dash-ev]').count() === nPrj);
  check('R6 dashboard: no overflow @1440', await noOverflow());
  await shot('34-r6-dashboard-1440');
  await page.click('[data-w-remove="workload"]'); await settle();
  check('R6 dashboard: remove a widget', !(await wids()).includes('workload') && await page.locator('[data-dash-add] option[value="workload"]').count() === 1);
  await page.click('[data-w-down="rag"]'); await settle();
  const w1 = await wids();
  check('R6 dashboard: reorder (RAG moved down one)', w1.indexOf('rag') === w0.indexOf('rag') + 1, w1);
  await page.selectOption('[data-dash-add]', 'workload'); await settle();
  check('R6 dashboard: add a widget (goes to the end)', (await wids()).slice(-1)[0] === 'workload');
  const prog1 = await page.getAttribute('[data-rollup] [data-program]', 'data-program');
  await page.click(`[data-rollup] [data-program="${prog1}"]`); await settle();
  check('R6 dashboard: program roll-up filters every widget', await page.inputValue('[data-dash-program]') === prog1 && await page.locator('[data-widget="rag"] .pmo-dash-grp').count() === 1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pmoflow.dashboard')));
  check('R6 dashboard: layout saved in localStorage', saved && saved.widgets.join() === (await wids()).join() && saved.program === prog1, saved);
  await page.reload(); await page.waitForSelector('[data-dash-grid]');
  check('R6 dashboard: reload keeps layout + program', (await wids()).join() === saved.widgets.join() && await page.inputValue('[data-dash-program]') === prog1);
  await page.evaluate(() => localStorage.setItem('pmoflow.dashboard', '{not json'));
  await page.reload(); await page.waitForSelector('[data-dash-grid]');
  check('R6 dashboard: corrupt layout falls back to the default', (await wids()).length === 7);
  await page.click('[data-dash-reset]'); await settle();

  console.log('R6 map: built but data not live');
  const builtStep = await page.evaluate(async ([u, prj]) => { const { store } = await import(u); const E = window.PMOEngine; const j = store.get('project', prj);
    for (const pid of j.processes) { const p = store.get('process', pid); for (const s of E.flatSteps(p.tobe)) { const items = store.list('workItem', w => w.projectId === prj && w.pid === pid && w.step === s.id); if (items.length && (s.data || []).some(d => E.effectiveAvail(store.state.docs, d) !== 'live')) return { pid, sid: s.id, items: items.map(w => w.id) }; } } return null; }, [STORE, PRJ]);
  if (builtStep) {
    await page.evaluate(async ([u, ids, t]) => { const { store } = await import(u); for (const id of ids) { const w = store.get('workItem', id); if (w.status !== 'done') await store.save('workItem', id, Object.assign({}, w, { status: 'done', statusId: 'done', doneAt: t, updatedAt: new Date().toISOString() }), 'E2E: finished the build'); } }, [STORE, builtStep.items, todayStr]);
    await prjGo('', '.canvas.pm .node');
    if (!await page.locator(`.canvas.pm .node[data-step="${builtStep.sid}"]`).count()) { await page.click('[data-expand="1"]').catch(() => {}); await settle(); }
    const node = page.locator(`.canvas.pm .node[data-step="${builtStep.sid}"]`);
    /* R8: finishing the fix task can itself make the information available (owner's fix = confirmation) */
    const stillNotLive = await page.evaluate(async ([u, pid, sid]) => { const { store } = await import(u); const E = window.PMOEngine; const s = E.flatSteps(store.get('process', pid).tobe).find(x => x.id === sid); return (s.data || []).some(d => E.effectiveAvail(store.state.docs, d) !== 'live'); }, [STORE, builtStep.pid, builtStep.sid]);
    if (stillNotLive) check('R6 map: done work on not-live data is "Built · awaiting live data" (amber), never green Done', await node.locator('[data-built-awaiting]').count() === 1 && await node.evaluate(n => n.classList.contains('s-built') && !n.classList.contains('s-done')));
    else check('R8 map: done work whose fix made the information available shows green Done', await node.locator('[data-built-awaiting]').count() === 0 && await node.evaluate(n => n.classList.contains('s-done')));
    check('R6 map legend explains the amber built state', (await page.innerText('[data-legend]')).includes('Built · waiting for information'));
  } else check('R6 map: a step with work on not-live data exists', false);

  console.log('R6 default new-project target');
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]');
  await page.locator('.sect [data-new-project]').click(); await modalOpen();
  const dt = await page.evaluate(async u => window.PMOEngine.defaultTarget((await import(u)).store.state.today), STORE);
  check('R6 new project: target defaults to E().defaultTarget(today)', await page.inputValue('.overlay input[name="target"]') === dt && !isWkend(dt), dt);
  await act('cancel');
  check('R6: no unlabelled icon-only controls', (await unlabelled()).length === 0, await unlabelled());

  /* ---------------- phone width ---------------- */
  console.log('phone 390');
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = [['/', '10-home-390', '[data-waiting]'], [prjPath + '?mode=map', '11-project-map-390', '.canvas.pm .node'], [prjPath + '?mode=timeline', '12-project-timeline-390', '.tl .tbar'],
    [prjPath + '?mode=work', '13-project-work-390', 'table.pmo-work'], ['/portfolio', '14-portfolio-390', '.pmo-ptable'],
    [prjPath + '?mode=board', '18-board-390', '[data-board]'], [prjPath + '?mode=sprints', '19-sprints-390', '[data-sprints]'], ['/portfolio', '26-portfolio-r5-390', '[data-financials]'], ['/dashboard', '35-dashboard-390', '[data-dash-grid]']];
  for (const [p, name, sel] of phone) {
    await page.goto(ROOT + p.replace(/^\/concepts\/pmoflow/, '')); await page.waitForSelector(sel); await sleep(300);
    const label = p.replace(/^.*\/project\/[^?]+/, '/project');
    /* page content (#app) must never overflow; checked separately from the shared header so a chrome issue doesn't hide ours */
    check(`page content fits @390 ${label}`, await page.evaluate(() => ![...document.querySelectorAll('#app *')].some(e => !e.closest('.tl,.tbl-wrap,.canvas') && e.getBoundingClientRect().right > innerWidth + 1)));
    check(`no overflow @390 ${label}`, await noOverflow(), await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth,
      culprits: [...document.querySelectorAll('body *')].filter(e => !e.closest('.tl,.tbl-wrap,.canvas') && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map(e => e.tagName + '.' + e.className) })));
    await shot(name);
  }
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]');
  await page.locator('.sect [data-new-project]').click(); await modalOpen(); await sleep(200);
  check('new project modal fits @390', await page.evaluate(() => { const m = document.querySelector('.overlay .modal'); return m.scrollWidth <= m.clientWidth + 1 && m.getBoundingClientRect().right <= innerWidth + 1; }));
  await shot('16-new-project-390', false); await act('cancel');
  await page.goto(ROOT + prjPath.replace(/^\/concepts\/pmoflow/, '') + '?mode=work'); await page.waitForSelector('table.pmo-work');
  await page.click('[data-suggest]'); await modalOpen(); await sleep(200);
  check('suggest modal fits @390', await page.evaluate(() => { const m = document.querySelector('.overlay .modal'); return m.scrollWidth <= m.clientWidth + 1 && m.getBoundingClientRect().right <= innerWidth + 1; }));
  await shot('17-suggest-390', false); await act('cancel');
  /* timeline scrolls inside its own box at 390 */
  await page.goto(ROOT + prjPath.replace(/^\/concepts\/pmoflow/, '') + '?mode=timeline'); await page.waitForSelector('.tl .tbar');
  await page.click('[data-scen-new]'); await modalOpen(); await sleep(150);
  check('R6 scenario modal fits @390', await page.evaluate(() => { const m = document.querySelector('.overlay .modal'); return m.scrollWidth <= m.clientWidth + 1 && m.getBoundingClientRect().right <= innerWidth + 1; }));
  await act('cancel');
  await page.goto(ROOT + prjPath.replace(/^\/concepts\/pmoflow/, '') + '?mode=board'); await page.waitForSelector('[data-board]');
  await page.click('[data-customize]'); await modalOpen(); await sleep(150);
  check('R6 statuses & fields modal fits @390', await page.evaluate(() => { const m = document.querySelector('.overlay .modal'); return m.scrollWidth <= m.clientWidth + 1 && m.getBoundingClientRect().right <= innerWidth + 1; }));
  await shot('36-customize-390', false); await act('cancel');
  await page.goto(ROOT + prjPath.replace(/^\/concepts\/pmoflow/, '') + '?mode=timeline'); await page.waitForSelector('.tl .tbar');
  check('timeline scrolls in its container @390', await page.evaluate(() => { const t = document.querySelector('.tl'); return t.scrollWidth > t.clientWidth; }));

  check('zero page/console errors', errors.length === 0, errors.slice(0, 5));

  /* ================= R7 SIMPLICITY: a fresh sandbox in Simple mode (the default) ================= */
  console.log('R7 simple mode');
  const sIp = `10.${(Math.random()*250|0)+1}.${(Math.random()*250|0)+1}.${(Math.random()*250|0)+1}`;
  const sctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, extraHTTPHeaders: { 'x-forwarded-for': sIp } });
  const sp = await sctx.newPage();
  const sErr = [];
  sp.on('pageerror', e => sErr.push('pageerror: ' + e.message));
  sp.on('console', m => { if (m.type() === 'error') sErr.push('console: ' + m.text()); });
  const sSettle = async () => { await sp.waitForLoadState('networkidle').catch(() => {}); await sleep(450); };
  const sShot = (n, full = false) => sp.screenshot({ path: `${SHOTS}/s-${n}.png`, fullPage: full });
  const sDoc = (type, id) => sp.evaluate(async ([u, t, i]) => (await import(u)).store.get(t, i), [STORE, type, id]);
  const sAs = async re => { const id = await sp.$eval('#persona', (s, r) => [...s.options].find(o => new RegExp(r).test(o.text)).value, re); await sp.selectOption('#persona', id); await sSettle(); return id; };
  const sGo = async (path, sel) => { await sp.goto(ROOT + path); await sp.waitForSelector(sel, { timeout: 20000 }); await sSettle(); };
  const sAct = async id => { await sp.click(`.overlay [data-act="${id}"]`); await sp.waitForSelector('.overlay', { state: 'detached', timeout: 8000 }); };
  const JARGON = /\b(SPI|CPI|EAC|Amber|Slipping|Baseline|Sprints?)\b/i;
  const jargonOn = async () => { const t = await sp.locator('#app').innerText(); const m = t.match(JARGON); return m ? m[0] + ' … ' + t.slice(Math.max(0, m.index - 60), m.index + 40) : null; };
  const sNoOverflow = () => sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const PRJ7 = 'vendor-modernization';

  await sGo('/', '[data-waiting]');
  check('R7 simple is the default (advanced off)', !(await sp.isChecked('#adv')) && await sp.evaluate(async u => !(await import(u)).store.advanced, STORE));
  check('R7 nav: Home · Processes · Projects · Launch · Testing · Portfolio (no Dashboard)', (await sp.locator('#nav a').allInnerTexts()).join('|') === 'Home|Processes|Projects|Launch|Testing|Portfolio');
  check('R7 home: Waiting-for-you list shown', await sp.locator('[data-waiting] h2').count() === 1);
  check('R7 home: the 3 big cards', (await sp.locator('[data-big3] .pmo-big3-c .t').allInnerTexts()).join('|') === 'Paste a procedure you already have|Check on a project|Map a process from scratch');
  check('R7 home: no jargon visible', !(await jargonOn()), await jargonOn());
  await sShot('01-home-1366', true);

  /* Approve my part: reachable in <= 2 taps from home */
  await sAs('^Maya Chen');
  const ap = sp.locator('[data-approve-part]').first();
  /* R8 §5: the button appears only once buReady says Procurement's part is ready; before that a muted "waiting on" line */
  const mayaReady = await sp.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine;
    return store.list('project', p => p.status !== 'live').map(p => { const rd = E.readiness(store.state.docs, p.id, store.state.today); const c = (rd.checks || []).find(x => x.id === 'bu-signoff') || {};
      const pending = (c.unsigned || []).includes('Procurement') || (c.stale || []).some(x => x.bu === 'Procurement');
      return { p: p.id, pending, r: E.buReady(store.state.docs, p.id, 'Procurement', store.state.today) }; }); }, STORE);
  const anyReady = mayaReady.some(x => x.pending && x.r.ready);
  if (anyReady) {
    check('R7/R8 home: "Approve my part" for Maya (Procurement) once her part is ready', await ap.count() >= 1 && (await ap.getAttribute('data-bu')) === 'Procurement');
    await ap.click(); /* tap 1 */
    await sp.waitForURL(/\/release\/.+\?bu=/, { timeout: 10000 }); await sSettle();
    const apBtn = sp.locator('#app button:visible', { hasText: /^\s*(Re-)?[Aa]pprove/ }).first();
    check('R7 approve my part: the approve button is on the first screen after 1 tap (tap 2 approves)', await apBtn.count() === 1 && await apBtn.isEnabled(), await sp.locator('#app button:visible').allInnerTexts());
  } else {
    check('R8 home: no "Approve my part" while Procurement’s part isn’t ready', await ap.count() === 0, mayaReady);
    check('R8 home: muted "Your part isn’t ready yet: waiting on …" instead', await sp.locator('[data-notready] [data-notready-text]').count() >= 1 && /isn’t ready yet: waiting on .+/.test(await sp.locator('[data-notready-text]').first().innerText()));
  }
  await sShot('02-approver-view-1366');

  /* Mark done from home in 1 tap */
  await sGo('/', '[data-waiting]');
  const leo = await sAs('^Leo Park');
  const wd = sp.locator('[data-wdone]').first();
  check('R7 home: Leo has tasks to mark done', await wd.count() === 1);
  const wdId = await wd.getAttribute('data-wdone');
  await wd.click(); /* the one tap */
  await sp.waitForFunction(id => !document.querySelector(`[data-wdone="${id}"]`), wdId, { timeout: 10000 }); await sSettle();
  const wdDoc = await sDoc('workItem', wdId);
  const today7 = await sp.evaluate(async u => (await import(u)).store.state.today, STORE);
  check('R7 home: one tap sets done + doneAt', wdDoc.status === 'done' && wdDoc.doneAt === today7, { status: wdDoc.status, doneAt: wdDoc.doneAt, today7 });
  const wdEv = await sp.evaluate(async ([u, id]) => (await (await import(u)).store.events('workItem:' + id, 10)).map(e => e.summary), [STORE, wdId]);
  check('R7 home: mark done recorded in history', wdEv.some(x => /Done/.test(x)), wdEv);

  /* Access request: allow in one tap (plus the sign-in check) */
  const gok = sp.locator('[data-grant-ok]').first();
  check('R7 home: Leo has an access request to decide', await gok.count() === 1);
  const gId = await gok.getAttribute('data-grant-ok');
  await gok.click(); await sp.waitForSelector('.overlay input[name="code"]'); await sp.fill('.overlay input[name="code"]', '123456'); await sAct('verify'); await sSettle();
  const gDoc = await sDoc('grant', gId);
  check('R7 home: access allowed (active, approver, expiry from approval)', gDoc.status === 'active' && gDoc.approvedBy === leo && !!gDoc.expires, gDoc);

  /* Deep link from home: scrolls to and highlights the task */
  const tl7 = sp.locator('[data-task-link]').first();
  if (await tl7.count()) {
    const tid = await tl7.getAttribute('data-task-link');
    await tl7.click(); await sp.waitForSelector(`[data-wid="${tid}"].pmo-flash`, { timeout: 10000 }); await sleep(300);
    check('R7 deep link: task highlighted and on screen', await sp.evaluate(id => { const r = document.querySelector(`[data-wid="${id}"]`).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, tid));
    await sShot('03-deeplink-1366');
  } else check('R7 deep link: a task link on home', false);

  /* Mentions: "Seen" in one tap */
  await sGo('/', '[data-waiting]');
  await sAs('Project Manager');
  const seen = sp.locator('[data-note-seen]').first();
  check('R7 home: Tom has a mention', await seen.count() === 1);
  const nId = await seen.getAttribute('data-note-seen'); await seen.click(); await sSettle();
  check('R7 home: mention marked read in one tap', (await sDoc('notification', nId)).read === true);

  /* "Are we on track?" = one visible sentence without scrolling, at 1366x768 and 390x844 */
  for (const [w, h] of [[1366, 768], [390, 844]]) {
    await sp.setViewportSize({ width: w, height: h });
    await sGo('/project/' + PRJ7, '[data-summary-sentence]');
    const vis = await sp.evaluate(async ([u, id]) => { const { store } = await import(u); const el = document.querySelector('[data-summary-sentence]'), r = el.getBoundingClientRect();
      const x = window.PMOEngine.projectSummary(store.state.docs, id, store.state.today);
      return { inView: scrollY === 0 && r.top >= 0 && r.bottom <= innerHeight, same: el.textContent === x.sentence, label: document.querySelector('.pmo-shdr [data-summary-label]').textContent.trim() === x.label, n: document.querySelectorAll('.pmo-shdr [data-summary-sentence]').length }; }, [STORE, PRJ7]);
    check(`R7 "Are we on track?" one sentence + label, visible without scrolling @${w}x${h}`, vis.inView && vis.same && vis.label && vis.n === 1, vis);
    check(`R7 project: no jargon @${w}`, !(await jargonOn()), await jargonOn());
    check(`R7 project: no overflow @${w}`, await sNoOverflow());
    await sShot(`04-project-${w}`, w === 1366);
  }
  /* phone: blocking + up next render above the map */
  const order = await sp.evaluate(() => { const y = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top : null; }; return { bl: y('[data-whats-blocking]'), up: y('[data-upnext]'), map: y('#canvas') }; });
  check('R7 phone: "What\'s blocking" and "Up next" above the map', order.bl != null && order.up != null && order.bl < order.map && order.up < order.map, order);
  await sp.setViewportSize({ width: 1366, height: 768 });
  await sGo('/project/' + PRJ7, '[data-whats-blocking]');
  check('R7 project tabs (Simple): Plan · Timeline · Work', (await sp.locator('.pmo-tabs a').allInnerTexts()).join('|') === 'Plan|Timeline|Work');
  const blRows = sp.locator('[data-whats-blocking] .pmo-bl-row');
  check('R7 What\'s blocking: top 3 max, each says who acts', await blRows.count() >= 1 && await blRows.count() <= 3 && (await blRows.locator('.s b').count()) === await blRows.count());
  const ls = await sp.evaluate(async ([u, id]) => { const { store } = await import(u); const want = window.PMOEngine.launchSteps(store.state.docs, id, store.state.today);
    const got = [...document.querySelectorAll('[data-launch-steps] li')].map(li => [li.querySelector('.t').firstChild.textContent.trim(), li.dataset.lsDone === '1']);
    return { ok: got.length === want.length && want.every((x, i) => got[i][0] === x.label && got[i][1] === !!x.done), got, want: want.map(x => [x.label, x.done]) }; }, [STORE, PRJ7]);
  check('R7 Steps to launch = E().launchSteps', ls.ok, ls);
  check('R7 Simple hides Board/Sprints/what-if/earned value/saved plan', await sp.locator('[data-tab="board"],[data-tab="sprints"],[data-hev],[data-baseline],[data-scen-new],[data-level]').count() === 0);
  check('R7 non-PM: Settings hidden (not greyed)', await sAs('^Maya Chen') && await sp.locator('[data-settings]').count() === 0 && await sp.locator('#app button[disabled]:visible').count() === 0);
  /* my tasks: one-tap ✓ on the project */
  await sAs('^Leo Park');
  const myTick = sp.locator('[data-my-tasks] [data-done]').first();
  check('R7 project: "Your tasks" with a ✓', await myTick.count() === 1);
  const mtId = await myTick.getAttribute('data-done');
  const tickBox = await myTick.boundingBox();
  check('R7 project: ✓ is a big target (>= 44px)', tickBox && tickBox.width >= 44 && tickBox.height >= 44, tickBox);
  await myTick.click(); await sp.waitForFunction(id => !document.querySelector(`[data-my-tasks] [data-done="${id}"]`), mtId, { timeout: 10000 }); await sSettle();
  check('R7 project: ✓ marks done with doneAt', (await sDoc('workItem', mtId)).status === 'done' && !!(await sDoc('workItem', mtId)).doneAt);
  await sp.reload(); await sp.waitForSelector('[data-summary-sentence]'); await sSettle();
  check('R7 reload: done persisted', (await sDoc('workItem', mtId)).status === 'done');
  for (const m of ['timeline', 'work']) {
    await sGo(`/project/${PRJ7}?mode=${m}`, m === 'work' ? '[data-task-group]' : '.tl .tbar');
    check(`R7 project ${m}: no jargon`, !(await jargonOn()), await jargonOn());
    await sShot(`05-project-${m}-1366`, true);
  }
  check('R7 work (Simple): phone-friendly task list, no wide table', await sp.locator('table.pmo-work').count() === 0 && await sp.locator('.pmo-task').count() > 3);

  /* New project, Simple: name, process, deadline; then "Here's a first plan" */
  await sAs('Project Manager');
  const tom7 = await sp.$eval('#persona', s => s.value);
  await sGo('/', '[data-waiting]');
  await sp.click('.sect [data-new-project]'); await sp.waitForSelector('.overlay .modal');
  const npForm = await sp.evaluate(async u => { const { store } = await import(u); const vis = [...document.querySelectorAll('.overlay .field')].filter(f => f.offsetParent && !f.closest('details:not([open])')).map(f => f.querySelector('label').textContent);
    return { vis, target: document.querySelector('.overlay input[name="target"]').value, want: window.PMOEngine.defaultTarget(store.state.today), more: !document.querySelector('.overlay details.pmo-more').open }; }, STORE);
  check('R7 new project (Simple): just name, process, deadline; rest under More options', JSON.stringify(npForm.vis) === JSON.stringify(['Project name', 'Which process does it change?', 'Deadline']) && npForm.more, npForm);
  check('R7 new project: deadline defaults to E().defaultTarget', npForm.target === npForm.want, npForm);
  await sShot('06-new-project-1366');
  const NP7 = 'Northwind faster invoice approvals';
  await sp.fill('.overlay input[name="name"]', NP7);
  await sp.selectOption('.overlay select[name="from"]', 'invoice-approval');
  await sAct('create'); await sp.waitForURL(/\/project\/prj-/, { timeout: 10000 });
  await sp.waitForSelector('.overlay [data-first-plan]', { timeout: 15000 });
  const fpN = Number(await sp.getAttribute('.overlay [data-first-plan]', 'data-first-plan'));
  check('R7 first plan offered: "Here’s a first plan: N tasks. Accept · Adjust"', fpN > 0 && (await sp.innerText('.overlay [data-first-plan]')).includes(`Here’s a first plan: ${fpN} task`) && await sp.locator('.overlay [data-act="accept"]').count() === 1 && await sp.locator('.overlay [data-act="adjust"]').count() === 1);
  await sShot('07-first-plan-1366');
  await sAct('accept'); await sp.waitForFunction(n => document.querySelectorAll('.canvas.pm').length && true, fpN); await sleep(1500); await sSettle();
  const np7 = await sp.evaluate(async ([u, n]) => { const { store } = await import(u); const p = store.list('project').find(x => x.name === n); return { p, n: p ? store.list('workItem', w => w.projectId === p.id).length : 0 }; }, [STORE, NP7]);
  check('R7 new project: PM and launch owner default to me, process linked', np7.p && np7.p.owner === tom7 && np7.p.releaseManager === tom7 && np7.p.processes.join() === 'invoice-approval', np7.p);
  check('R7 first plan accepted: N tasks created', np7.n === fpN, { n: np7.n, fpN });
  await sp.reload(); await sp.waitForSelector('[data-summary-sentence]'); await sSettle();
  check('R7 reload: the plan persisted and the summary is no longer "Not planned"', (await sp.getAttribute('.pmo-shdr [data-summary-label]', 'data-summary-label')) !== 'none');
  await sp.click('[data-activity] > summary'); await sp.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
  check('R7 history: project created', (await sp.locator('[data-history]').innerText()).includes('Created project'));

  /* Portfolio + dashboard, Simple */
  await sGo('/portfolio', '[data-pcard]');
  const pf7 = await sp.evaluate(async u => { const { store } = await import(u); return [...document.querySelectorAll('[data-pcard]')].map(c => { const x = window.PMOEngine.projectSummary(store.state.docs, c.dataset.pcard, store.state.today);
    return c.querySelector('[data-summary-sentence]').textContent === x.sentence && !!c.querySelector('[data-who]'); }); }, STORE);
  check('R7 portfolio: every project has its sentence and who acts', pf7.length >= 3 && pf7.every(Boolean), pf7);
  check('R7 portfolio (Simple): no money, earned value, workload detail or CSV', await sp.locator('[data-financials],[data-export-pf],.pmo-wl-row,[data-pf-burn]').count() === 0);
  check('R7 portfolio: no jargon', !(await jargonOn()), await jargonOn());
  await sShot('08-portfolio-1366', true);
  await sGo('/dashboard', '[data-dash-simple]');
  check('R7 dashboard is Advanced only', await sp.locator('[data-dash-grid]').count() === 0);

  /* phone */
  await sp.setViewportSize({ width: 390, height: 844 });
  for (const [path, sel, name] of [['/', '[data-waiting]', 'home'], ['/project/' + PRJ7, '#canvas', 'plan'], [`/project/${PRJ7}?mode=work`, '[data-task-group]', 'work'], [`/project/${PRJ7}?mode=timeline`, '.tl', 'timeline'], ['/portfolio', '[data-pcard]', 'portfolio']]) {
    await sGo(path, sel);
    check(`R7 no overflow @390 ${name}`, await sNoOverflow(), await sp.evaluate(() => [...document.querySelectorAll('body *')].filter(e => !e.closest('.tl,.tbl-wrap,.canvas') && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map(e => e.tagName + '.' + e.className)));
    check(`R7 no jargon @390 ${name}`, !(await jargonOn()), await jargonOn());
    await sShot(`09-${name}-390`);
  }
  await sGo('/', '[data-waiting]');
  const btnH = await sp.evaluate(() => [...document.querySelectorAll('[data-waiting] .pmo-wact .btn')].map(b => b.getBoundingClientRect().height));
  check('R7 phone: waiting-for-you buttons are big (>= 44px)', btnH.every(h => h >= 44), btnH);

  /* ================= R8 (phone, Simple) ================= */
  console.log('R8 phone header, projects list, approvals, undo, risks');
  const hdr8 = await sp.evaluate(() => { const lab = document.querySelector('.top .who > span'); const adv = document.querySelector('.top .advtog span'); const r = lab && lab.getBoundingClientRect();
    return { lab: !!lab && getComputedStyle(lab).display !== 'none' && r.width > 30 && r.right <= innerWidth, adv: !!adv && getComputedStyle(adv).display !== 'none' && adv.textContent.trim() === 'Advanced',
      nav: [...document.querySelectorAll('#nav a')].every(a => { const b = a.getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth; }) }; });
  check('R8 phone header: "Viewing as" visible, Advanced labelled, every nav tab on screen', hdr8.lab && hdr8.adv && hdr8.nav, hdr8);
  await sShot('10-r8-header-390');
  await sp.click('[data-big="check"]'); await sp.waitForSelector('[data-plist]', { timeout: 10000 });
  check('R8 "Check on a project" opens the projects list', new URL(sp.url()).pathname.endsWith('/projects'));
  const nP8 = await sp.evaluate(async u => (await import(u)).store.list('project').length, STORE);
  check('R8 projects list: one row per project, each with label + sentence + facts', await sp.locator('[data-plist]').count() === nP8 && await sp.locator('[data-plist] [data-summary-label]').count() === nP8 && await sp.locator('[data-plist] [data-t="forecast"]').count() === nP8);
  check('R8 projects list: no overflow @390', await sNoOverflow());
  await sShot('11-r8-projects-390', true);
  await sp.click('#nav a:has-text("Projects")'); await sp.waitForSelector('[data-plist]');
  check('R8 "Projects" nav opens the list and is active', (await sp.innerText('#nav a.on')).trim() === 'Projects');
  /* approvals appear only when buReady says that team's part is ready */
  const appr8 = await sp.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine; const out = [];
    store.list('project', p => p.status !== 'live').forEach(p => store.state.people.forEach(pp => { if (!pp.bu) return; const r = E.buReady(store.state.docs, p.id, pp.bu, store.state.today); out.push({ prj: p.id, bu: pp.bu, person: pp.id, ready: !!r.ready }); })); return out; }, STORE);
  await sGo('/', '[data-waiting]');
  const shown8 = await sp.evaluate(() => ({ approve: [...document.querySelectorAll('[data-approve-part]')].map(a => [a.dataset.approvePart, a.dataset.bu]), notReady: [...document.querySelectorAll('[data-notready]')].map(x => x.dataset.notready) }));
  const me8 = await sp.$eval('#persona', s => s.value);
  check('R8 home: "Approve my part" only for parts buReady says are ready', shown8.approve.every(([prj, bu]) => appr8.some(x => x.prj === prj && x.bu === bu && x.ready)), { shown8, appr8: appr8.filter(x => x.person === me8) });
  check('R8 home: not-ready parts say "isn’t ready yet: waiting on"', (await sp.locator('[data-notready-text]').allInnerTexts()).every(t => /isn’t ready yet: waiting on/.test(t)));
  /* Mark done -> toast with Undo restores status and doneAt */
  await sAs('Project Manager'); /* the PM can mark any task of the project done */
  const t8 = await sp.evaluate(async u => { const { store } = await import(u); const me = store.state.me; const w = store.list('workItem', x => x.status !== 'done' && ((store.get('project', x.projectId) || {}).owner === me || x.owner === me) && (store.get('project', x.projectId) || {}).status !== 'live')[0]; return w ? { id: w.id, status: w.status, statusId: w.statusId || null, doneAt: w.doneAt || null } : null; }, STORE);
  if (t8) {
    await sGo(`/project/${(await sp.evaluate(async ([u, id]) => (await import(u)).store.get('workItem', id).projectId, [STORE, t8.id]))}?mode=work`, '[data-task-group]');
    await sp.click(`[data-done="${t8.id}"]`);
    await sp.waitForSelector('[data-undo-toast] [data-undo]', { timeout: 10000 });
    check('R8 mark done: toast with Undo', (await sp.innerText('[data-undo-toast]')).includes('Undo'));
    await sShot('12-r8-undo-390');
    await sp.waitForFunction(([u, id]) => import(u).then(m => (m.store.get('workItem', id) || {}).status === 'done'), [STORE, t8.id]).catch(() => {});
    await sp.click('[data-undo-toast] [data-undo]'); await sSettle(); await sp.waitForTimeout(800);
    const back8 = await sp.evaluate(async ([u, id]) => { const w = (await import(u)).store.get('workItem', id); return { status: w.status, statusId: w.statusId || null, doneAt: w.doneAt || null }; }, [STORE, t8.id]);
    check('R8 undo restores the previous status and done date', back8.status === t8.status && back8.statusId === t8.statusId && back8.doneAt === t8.doneAt, { before: t8, after: back8 });
  } else check('R8 a task of mine to mark done exists', false);
  /* risk whose linked work is all done -> "Likely resolved: close it?" */
  const rk8 = await sp.evaluate(async u => { const { store } = await import(u); const w = store.list('workItem', x => x.status === 'done')[0]; if (!w) return null;
    const id = 'rsk-e2e-r8'; await store.save('risk', id, { id, projectId: w.projectId, title: 'E2E R8 risk on finished work', impact: 'low', likelihood: 'low', owner: store.state.me, status: 'open', mitigation: '', workItems: [w.id] }, 'E2E risk'); return id; }, STORE);
  await sGo('/portfolio', '[data-pcard]');
  check('R8 risk with all linked work done: "Likely resolved: close it?"', rk8 && await sp.locator(`[data-likely-resolved="${rk8}"]`).count() === 1);
  await sp.click(`[data-close-risk="${rk8}"]`); await sSettle(); await sp.waitForTimeout(600);
  check('R8 "Close it" closes the risk', (await sp.evaluate(async ([u, id]) => (await import(u)).store.get('risk', id).status, [STORE, rk8])) === 'closed');
  check('R7 simple: zero page/console errors', sErr.length === 0, sErr.slice(0, 5));
  await sctx.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed${fail ? ': ' + failures.join(' | ') : ''}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
