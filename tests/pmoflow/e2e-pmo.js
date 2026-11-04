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
  check('home no overflow @1440', await noOverflow());
  await shot('01-home-1440');

  /* ---------------- project map ---------------- */
  console.log('project map');
  await page.locator('.home-grid a[href*="/project/"]').first().click();
  await page.waitForSelector('.canvas.pm .node');
  const prjPath = new URL(page.url()).pathname;
  check('map renders step nodes', await page.locator('.canvas.pm .node[data-step]').count() > 3);
  check('map has NEW/CHANGED badges', await page.locator('.canvas.pm .chip.diff-new, .canvas.pm .chip.diff-changed').count() > 0);
  check('map has "Waiting on" blocker chips', await page.locator('.canvas.pm .chip.block', { hasText: 'Waiting on' }).count() > 0);
  check('map has open-design pills', await page.locator('.pgroup-h').count() >= 1);
  check('side panel: biggest blockers', await page.locator('.side .card h3', { hasText: 'Biggest blockers' }).count() === 1);
  check('side panel: up next', await page.locator('.side .card h3', { hasText: 'Up next' }).count() === 1);
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

  /* push an open item's due out by editing it, so baseline variance has something to show (after baseline below) */
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
  const countBeforeSuggest = await page.locator('tr[data-wid]').count();
  await page.click('[data-suggest]'); await modalOpen();
  const src = (await page.locator('.overlay .pmo-src').innerText()).trim();
  check('suggestion source labelled', /AI|Rules/.test(src), src);
  const nSugg = await page.locator('.overlay input[name="pick"]').count();
  check('suggestions offered', nSugg > 0, nSugg);
  await shot('06-suggest-modal-1440', false);
  if (nSugg > 0) {
    for (let i = 1; i < nSugg; i++) await page.locator('.overlay input[name="pick"]').nth(i).uncheck();
    await act('create'); await settle();
    check('one suggested item created', await page.locator('tr[data-wid]').count() === countBeforeSuggest + 1);
  } else await act('cancel');

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
    check('all done -> KPI shows "Finished <date>"', /Finished [A-Z][a-z]{2} \d{1,2}/.test(fin) && fin.includes('Actual finish'), fin);
    await sleep(800); await page.reload(); await page.waitForSelector('[data-kpi-finish]');
    check('reload: Finished persists', (await page.locator('[data-kpi-finish]').innerText()).includes('Finished'));
    await page.click('.pmo-tabs a:has-text("Timeline")'); await page.waitForSelector('.tl .tbar');
    check('timeline shows actual finish markers', await page.locator('.tl .pmo-actual').count() > 0);
    await shot('15-finished-project-1440');
  } else check('second project exists for Finished check', false);

  /* ---------------- phone width ---------------- */
  console.log('phone 390');
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = [['/', '10-home-390', '.pmo-attn'], [prjPath + '?mode=map', '11-project-map-390', '.canvas.pm .node'], [prjPath + '?mode=timeline', '12-project-timeline-390', '.tl .tbar'],
    [prjPath + '?mode=work', '13-project-work-390', 'table.pmo-work'], ['/portfolio', '14-portfolio-390', '.pmo-ptable']];
  for (const [p, name, sel] of phone) {
    await page.goto(ROOT + p.replace(/^\/concepts\/pmoflow/, '')); await page.waitForSelector(sel); await sleep(300);
    const label = p.replace(/^.*\/project\/[^?]+/, '/project');
    /* page content (#app) must never overflow; checked separately from the shared header so a chrome issue doesn't hide ours */
    check(`page content fits @390 ${label}`, await page.evaluate(() => ![...document.querySelectorAll('#app *')].some(e => !e.closest('.tl,.tbl-wrap,.canvas') && e.getBoundingClientRect().right > innerWidth + 1)));
    check(`no overflow @390 ${label}`, await noOverflow(), await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth,
      culprits: [...document.querySelectorAll('body *')].filter(e => !e.closest('.tl,.tbl-wrap,.canvas') && e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map(e => e.tagName + '.' + e.className) })));
    await shot(name);
  }
  /* timeline scrolls inside its own box at 390 */
  await page.goto(ROOT + prjPath.replace(/^\/concepts\/pmoflow/, '') + '?mode=timeline'); await page.waitForSelector('.tl .tbar');
  check('timeline scrolls in its container @390', await page.evaluate(() => { const t = document.querySelector('.tl'); return t.scrollWidth > t.clientWidth; }));

  check('zero page/console errors', errors.length === 0, errors.slice(0, 5));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed${fail ? ': ' + failures.join(' | ') : ''}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
