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
  const testIp = `198.51.100.${1 + Math.floor(Math.random() * 254)}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': testIp } });
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
  /* icon-only controls (no visible text) must carry an aria-label */
  const unlabelled = () => page.evaluate(() => [...document.querySelectorAll('#app button, #app a, .overlay button')].filter(b => b.offsetParent && !b.textContent.replace(/[^\p{L}\p{N}]/gu, '').length && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby')).map(b => b.outerHTML.slice(0, 80)));

  /* ---------------- home ---------------- */
  console.log('home');
  await page.goto(ROOT + '/');
  await page.waitForSelector('.pmo-attn', { timeout: 20000 });
  check('hero title', (await page.locator('.pmo-hero h1').innerText()).includes('Process-first planning'));
  check('primary actions', await page.locator('.pmo-hero a[href$="/new"]').count() === 1 && await page.locator('.pmo-hero a[href$="/import"]').count() === 1 && await page.locator('.pmo-hero a[href$="/portfolio"]').count() === 1);
  check('needs-attention has 4 categories', await page.locator('.pmo-attn-col').count() === 4);
  await page.click('[data-scope="all"]');
  await page.waitForSelector('[data-scope="all"].on');
  const allCount = parseInt(await page.locator('.pmo-attn h3 .n').innerText(), 10);
  check('needs-attention (everyone) shows items', allCount > 0, allCount);
  check('late/slipping work listed', await page.locator('[data-attn="work"] .pmo-attn-row').count() > 0);
  check('pending access request listed', await page.locator('[data-attn="grants"] .pmo-attn-row').count() > 0);
  await page.click('[data-scope="mine"]');
  check('process tiles', await page.locator('.home-grid a[href*="/process/"]').count() >= 2);
  check('project tiles with progress', await page.locator('.home-grid a[href*="/project/"] .bar').count() >= 1);
  const dcMismatch = await page.evaluate(async u => { const { store } = await import(u); return [...document.querySelectorAll('.home-grid a[href*="/process/"]')].map(a => {
    const pid = decodeURIComponent(a.getAttribute('href').split('/process/')[1]); const ds = window.PMOEngine.diffSummary(store.get('process', pid));
    const t = a.querySelector('[data-diffcount]').textContent; return t.startsWith(`${ds.new} new + ${ds.changed} changed`) ? null : { pid, t, ds }; }).filter(Boolean); }, STORE);
  check('home diff counts come from diffSummary', dcMismatch.length === 0, dcMismatch);
  const missMismatch = await page.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine; return [...document.querySelectorAll('.home-grid a[href*="/process/"]')].map(a => {
    const p = store.get('process', decodeURIComponent(a.getAttribute('href').split('/process/')[1]));
    const ids = new Set(E.flatSteps(p.tobe).flatMap(s => [...(s.data || []), ...(s.subs || []).flatMap(x => x.data || [])]));
    const miss = [...ids].filter(d => E.effectiveAvail(store.state.docs, d) === 'missing').length;
    const el = a.querySelector('[data-miss]'); const shown = el ? parseInt(el.textContent.replace(/\D+/g, ''), 10) : 0; return shown === miss ? null : { id: p.id, shown, miss }; }).filter(Boolean); }, STORE);
  check('home missing counts use effectiveAvail', missMismatch.length === 0, missMismatch);
  check('home: "+ New project" in hero and projects section', await page.locator('.pmo-hero [data-new-project]').count() === 1 && await page.locator('.sect [data-new-project]').count() === 1);
  check('home: no unlabelled icon-only controls', (await unlabelled()).length === 0, await unlabelled());
  check('home no overflow @1440', await noOverflow());
  await shot('01-home-1440');

  /* ---------------- new project ---------------- */
  console.log('new project');
  const NP = 'E2E Northwind supplier payments uplift';
  await page.click('.pmo-hero [data-new-project]'); await modalOpen();
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
  await page.locator('.overlay input[name="processes"]').last().check();
  const npProc = await page.locator('.overlay input[name="processes"]').last().getAttribute('value');
  await act('create'); await page.waitForURL(/\/project\/prj-/, { timeout: 10000 }); await page.waitForSelector('.canvas.pm'); await settle();
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
  await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
  check('new project: history shows creation', (await page.locator('[data-history]').innerText()).includes('Created project'));
  await page.goto(ROOT + '/'); await page.waitForSelector('.pmo-attn');
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
  check('side panel: biggest blockers', await page.locator('.side .card h3', { hasText: 'Biggest blockers' }).count() === 1);
  check('side panel: up next', await page.locator('.side .card h3', { hasText: 'Up next' }).count() === 1);
  check('header finish KPI shows forecast for open project', /Forecast · target/.test(await page.locator('[data-kpi-finish]').innerText()));
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
  await page.waitForSelector('[data-feed="prj-work"] .ev', { timeout: 10000 }).catch(() => {});
  check('history shows "Rescheduled" with a summary', /Rescheduled “.+” on the timeline: .+ → .+ \(\+3d\)/.test(await page.locator('[data-feed="prj-work"]').innerText()));
  await page.click('.pmo-tabs a:has-text("Work")'); await page.waitForSelector('table.pmo-work');

  /* push an open item's due out by editing it, so baseline variance has something to show (after baseline below) */
  /* ================= ROUND 4: views of the same work items ================= */
  const PRJ = decodeURIComponent(prjPath.split('/project/')[1]);
  const prjGo = async (q, sel) => { await page.goto(ROOT + '/project/' + encodeURIComponent(PRJ) + (q || '')); await page.waitForSelector(sel || '.pmo-toolbar'); await settle(); };
  const feedText = async () => { await page.waitForSelector('[data-feed="prj-work"] .ev', { timeout: 10000 }).catch(() => {}); return page.locator('[data-feed="prj-work"]').innerText(); };
  const isWkend = s => { const g = new Date(s + 'T12:00:00').getDay(); return g === 0 || g === 6; };
  /* synthetic HTML5 drag-and-drop (for targets that are off-screen, where a mouse drag can't reach) */
  const dnd = async (src, dst) => { const dt = await page.evaluateHandle(() => new DataTransfer());
    await page.dispatchEvent(src, 'dragstart', { dataTransfer: dt }); await page.dispatchEvent(dst, 'dragenter', { dataTransfer: dt });
    await page.dispatchEvent(dst, 'dragover', { dataTransfer: dt }); await page.dispatchEvent(dst, 'drop', { dataTransfer: dt }); await page.dispatchEvent(src, 'dragend', { dataTransfer: dt }); await settle(); };
  const todayStr = await page.evaluate(async u => (await import(u)).store.state.today, STORE);

  /* ---- header RAG pill ---- */
  console.log('R4 header + map gateways');
  await prjGo('', '.canvas.pm .node');
  const ragK = await page.getAttribute('.pmo-hrag', 'data-rag');
  check('header shows a red/amber/green pill', ['red', 'amber', 'green'].includes(ragK) && await page.locator('.hdr h1 .rag').count() === 1, ragK);
  check('project tabs: Map | Timeline | Board | Sprints | Work', (await page.locator('.pmo-tabs a').allInnerTexts()).join('|') === 'Map|Timeline|Board|Sprints|Work');
  const gwExp = await page.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine; const prj = store.get('project', decodeURIComponent(location.pathname.split('/project/')[1]));
    return prj.processes.flatMap(pid => { const p = store.get('process', pid); const dp = E.diffProcess(p); return E.flatGateways(p.tobe).filter(g => dp.nodes[g.id] === 'new').map(g => g.id); }); }, STORE);
  const gwShown = await page.locator('[data-gateway]:has([data-gw-diff="new"])').evaluateAll(xs => xs.map(x => x.dataset.gateway));
  check('map marks new gateways NEW', gwExp.length > 0 && gwExp.every(id => gwShown.includes(id)) && gwShown.length === gwExp.length, { gwExp, gwShown });

  /* ---- Board ---- */
  console.log('R4 board');
  await page.click('.pmo-tabs a[data-tab="board"]'); await page.waitForSelector('[data-board]'); await settle();
  check('board: three columns', (await page.locator('.pmo-col-h b').allInnerTexts()).join('|') === 'Not started|In progress|Done');
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
  await idleCard.dragTo(page.locator('.pmo-col[data-col="prog"] .pmo-col-b')); await settle();
  const bDoc = await getDoc('workItem', bId);
  check('board drag Not started -> In progress sets status + updatedAt', bDoc.status === 'prog' && !!bDoc.updatedAt && !bDoc.doneAt, bDoc);
  check('board: card now in In progress column', await page.locator(`.pmo-col[data-col="prog"] [data-card="${bId}"]`).count() === 1);
  await page.locator(`.pmo-card[data-card="${bId}"]`).dragTo(page.locator('.pmo-col[data-col="done"] .pmo-col-b')); await settle();
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
  for (let k = 0; k < 6 && !(await page.locator(`.pmo-spr[data-sprint="${target.id}"] [data-over]`).count()); k++) {
    const sel = page.locator(`.pmo-spr[data-sprint]:not([data-sprint="${target.id}"]) select[data-sprint-pick]:not([disabled])`).first();
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
  await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
  check('history: sprint cadence change', (await page.locator('[data-history]').innerText()).includes('Sprint cadence: 7-day sprints'));

  /* ---- shared filter bar + saved views ---- */
  console.log('R4 filters + saved views');
  for (const m of ['board', 'sprints', 'timeline', 'work']) { await prjGo('?mode=' + m, '[data-fbar]'); check(`filter bar on ${m}`, await page.locator('[data-fbar] [data-f]').count() === 6); }
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
  await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
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
  const ragK2 = await page.getAttribute('.pmo-hrag', 'data-rag');
  await page.click('[data-report]');
  await page.waitForSelector('[data-prj-rep] [data-rep-body]', { timeout: 30000 });
  check('report: headline + RAG pill', (await page.locator('[data-prj-rep] .pmo-rep-h').innerText()).trim().length > 5 && await page.locator(`[data-prj-rep] .rag-${ragK2}`).count() === 1);
  const mail = await page.getAttribute('[data-rep-mail]', 'href');
  const mailU = new URL(mail);
  check('email draft: mailto with subject + plain-text body', mail.startsWith('mailto:?subject=') && mailU.searchParams.get('subject').includes('status') && mailU.searchParams.get('body').includes((await page.locator('[data-prj-rep] .pmo-rep-h').innerText()).trim()), mail.slice(0, 120));
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
  check('zero items: "No work planned yet — Suggest work from diff"', (await page.locator('[data-upnext] [data-nowork]').innerText()).includes('No work planned yet') && await page.locator('[data-upnext] [data-suggest]').count() === 1);
  const expConf = await page.evaluate(async ([u, id]) => { const { store } = await import(u); const E = window.PMOEngine; const j = store.get('project', id);
    const steps = new Set(j.processes.flatMap(pid => [...E.flatSteps(store.get('process', pid).tobe), ...E.flatGateways(store.get('process', pid).tobe)].map(s => pid + '::' + s.id)));
    const data = new Set(j.processes.flatMap(pid => E.flatSteps(store.get('process', pid).tobe).flatMap(s => [...(s.data || []), ...(s.subs || []).flatMap(x => x.data || [])])));
    return store.list('project', p => p.id !== id && p.status !== 'live').filter(p => store.list('workItem', w => w.projectId === p.id && w.status !== 'done' && (steps.has(w.pid + '::' + w.step) || (w.resolves && data.has(w.resolves)))).length).map(p => p.id); }, [STORE, npId]);
  const shownConf = await page.locator('[data-conflicts] [data-conflict]').evaluateAll(xs => xs.map(x => x.dataset.conflict));
  check('conflict banner lists every overlapping active project', expConf.length > 0 && JSON.stringify(expConf.sort()) === JSON.stringify(shownConf.sort()), { expConf, shownConf });
  check('conflict banner links to the other project', await page.locator(`[data-conflicts] a[href*="/project/${expConf[0]}"]`).count() >= 1);
  await shot('27-conflict-empty-1440');
  await page.click('.pmo-tabs a[data-tab="board"]'); await page.waitForSelector('[data-nowork]');
  check('empty board: suggest-work empty state', (await page.locator('.pmo-main [data-nowork]').innerText()).includes('No work planned yet'));
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
  await page.click('[data-suggest]'); await modalOpen();
  check('non-owner: suggestions preview explains who can create', (await page.locator('.overlay .pmo-ro-note').innerText()).includes('project owner'));
  check('non-owner: no "Create selected" action', await page.locator('.overlay [data-act="create"]').count() === 0);
  check('non-owner: suggestion fields read-only', await page.locator('.overlay .pmo-sg-f select:not([disabled])').count() === 0);
  await act('cancel');
  await asPersona('Project Manager'); await page.waitForSelector('table.pmo-work');
  const countBeforeSuggest = await page.locator('tr[data-wid]').count();
  await page.click('[data-suggest]'); await modalOpen();
  const src = (await page.locator('.overlay .pmo-src').innerText()).trim();
  check('suggestion source labelled', /AI|Rules/.test(src), src);
  const nSugg = await page.locator('.overlay input[name="pick"]').count();
  check('suggestions offered', nSugg > 0, nSugg);
  check('each suggestion shows owner, effort, start, due, deps', nSugg > 0 && await page.locator('.overlay .pmo-sg select[name^="o_"]').count() === nSugg && await page.locator('.overlay .pmo-sg input[name^="e_"]').count() === nSugg
    && await page.locator('.overlay .pmo-sg input[name^="s_"]').count() === nSugg && await page.locator('.overlay .pmo-sg input[name^="d_"]').count() === nSugg && await page.locator('.overlay .pmo-sg-deps').count() === nSugg);
  const starts = await page.locator('.overlay .pmo-sg input[name^="s_"]').evaluateAll(xs => xs.map(x => x.value));
  const dues = await page.locator('.overlay .pmo-sg input[name^="d_"]').evaluateAll(xs => xs.map(x => x.value));
  if (/Rules/.test(src)) {
    check('suggestions: business-day dates (no weekend starts/dues)', [...starts, ...dues].every(d => !isWkend(d)), { starts, dues });
    check('suggestions: gateway targets labelled', await page.locator('.overlay [data-sg-gateway]').count() > 0);
    const depSrc = await page.evaluate(() => [...document.querySelectorAll('.overlay .pmo-sg')].flatMap(sg => [...sg.querySelectorAll('input[name^="dep_"]:checked')].map(i => i.value)).filter(v => v.startsWith('S:'))
      .map(v => document.querySelector(`.overlay .pmo-sg[data-sg="${v.slice(2)}"] .hint`).textContent));
    check('suggestions: dependencies come from data resolvers', depSrc.every(t => t.includes('resolves')), depSrc);
  }
  await shot('06-suggest-modal-1440', false);
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
  else await act('cancel');

  /* ---------------- link a process ---------------- */
  console.log('link process');
  await page.click('.pmo-tabs a:has-text("Map")'); await page.waitForSelector('.canvas.pm');
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
  await page.waitForSelector('[data-feed="prj-work"] .ev', { timeout: 10000 }).catch(() => {});
  const feed = await page.locator('[data-feed="prj-work"]').innerText();
  check('work history shows edit', feed.includes('Edited'), feed.slice(0, 200));
  check('work history shows delete', feed.includes('Deleted work item'));
  await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
  const hist = await page.locator('[data-history]').innerText();
  check('project history shows baseline + link', hist.includes('Saved baseline') && (canLink ? /linked/i.test(hist) : true), hist.slice(0, 200));
  await shot('08-work-after-reload-1440');

  /* ---------------- portfolio ---------------- */
  console.log('portfolio');
  await page.goto(ROOT + '/portfolio');
  await page.waitForSelector('.pmo-ptable');
  check('projects table rows', await page.locator('.pmo-ptable tbody tr').count() >= 1);
  check('RAG rule stated', (await page.locator('.pmo-rule').innerText()).includes('Red:'));
  check('workload bars', await page.locator('.pmo-wl-row').count() > 0);
  check('variance table appears for baseline', await page.locator('.pmo-vtable tbody tr').count() > 0);
  check('variance shows slip for pushed item', await page.locator('.pmo-vtable tr', { hasText: openTitle }).locator('.pmo-var.up').count() === 1, openTitle);
  check('project slip headline (not a sum)', (await page.locator('[data-proj-slip]').innerText()).includes('Project slip'));
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
  await page.goto(ROOT + '/'); await page.waitForSelector('.pmo-attn');
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
    check('all done, gate pending -> "Work done · awaiting go-live"', fin.includes('Work done · awaiting go-live') && !/Finished|early/.test(fin), fin);
    check('awaiting KPI links to the release page', /\/release\//.test(await page.locator('[data-kpi-finish]').getAttribute('href') || ''));
    await sleep(800); await page.reload(); await page.waitForSelector('[data-kpi-finish]');
    check('reload: awaiting go-live persists', (await page.locator('[data-kpi-finish]').innerText()).includes('awaiting go-live'));
    await page.goto(ROOT + '/portfolio'); await page.waitForSelector('.pmo-ptable');
    const prow = await page.locator('.pmo-ptable tbody tr', { has: page.locator('[data-when]') }).allInnerTexts();
    check('portfolio: no "Finished · early" while gate pending', prow.some(t => /Awaiting go-live/.test(t)) && prow.every(t => !/early|Finished/.test(t)), prow);
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

  /* ---------------- phone width ---------------- */
  console.log('phone 390');
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = [['/', '10-home-390', '.pmo-attn'], [prjPath + '?mode=map', '11-project-map-390', '.canvas.pm .node'], [prjPath + '?mode=timeline', '12-project-timeline-390', '.tl .tbar'],
    [prjPath + '?mode=work', '13-project-work-390', 'table.pmo-work'], ['/portfolio', '14-portfolio-390', '.pmo-ptable'],
    [prjPath + '?mode=board', '18-board-390', '[data-board]'], [prjPath + '?mode=sprints', '19-sprints-390', '[data-sprints]']];
  for (const [p, name, sel] of phone) {
    await page.goto(ROOT + p.replace(/^\/concepts\/pmoflow/, '')); await page.waitForSelector(sel); await sleep(300);
    const label = p.replace(/^.*\/project\/[^?]+/, '/project');
    /* page content (#app) must never overflow; checked separately from the shared header so a chrome issue doesn't hide ours */
    check(`page content fits @390 ${label}`, await page.evaluate(() => ![...document.querySelectorAll('#app *')].some(e => !e.closest('.tl,.tbl-wrap,.canvas') && e.getBoundingClientRect().right > innerWidth + 1)));
    check(`no overflow @390 ${label}`, await noOverflow(), await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth,
      culprits: [...document.querySelectorAll('body *')].filter(e => !e.closest('.tl,.tbl-wrap,.canvas') && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map(e => e.tagName + '.' + e.className) })));
    await shot(name);
  }
  await page.goto(ROOT + '/'); await page.waitForSelector('.pmo-attn');
  await page.locator('.pmo-hero [data-new-project]').click(); await modalOpen(); await sleep(200);
  check('new project modal fits @390', await page.evaluate(() => { const m = document.querySelector('.overlay .modal'); return m.scrollWidth <= m.clientWidth + 1 && m.getBoundingClientRect().right <= innerWidth + 1; }));
  await shot('16-new-project-390', false); await act('cancel');
  await page.goto(ROOT + prjPath.replace(/^\/concepts\/pmoflow/, '') + '?mode=work'); await page.waitForSelector('table.pmo-work');
  await page.click('[data-suggest]'); await modalOpen(); await sleep(200);
  check('suggest modal fits @390', await page.evaluate(() => { const m = document.querySelector('.overlay .modal'); return m.scrollWidth <= m.clientWidth + 1 && m.getBoundingClientRect().right <= innerWidth + 1; }));
  await shot('17-suggest-390', false); await act('cancel');
  /* timeline scrolls inside its own box at 390 */
  await page.goto(ROOT + prjPath.replace(/^\/concepts\/pmoflow/, '') + '?mode=timeline'); await page.waitForSelector('.tl .tbar');
  check('timeline scrolls in its container @390', await page.evaluate(() => { const t = document.querySelector('.tl'); return t.scrollWidth > t.clientWidth; }));

  check('zero page/console errors', errors.length === 0, errors.slice(0, 5));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed${fail ? ': ' + failures.join(' | ') : ''}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
