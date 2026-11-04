/* E2E for stream D (process / step / data pages).
   Usage: node tests/pmoflow/e2e-design.js [port]   (dev server must be running on that port) */
const { chromium } = require('playwright');
const fs = require('fs');
const PORT = process.argv[2] || process.env.PORT || 8792;
const BASE = `http://localhost:${PORT}/concepts/pmoflow`;
const OUT = '/tmp/pmo-design';
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const failures = [];
function ok(cond, msg) { if (cond) { pass++; console.log('  ok  ' + msg); } else { fail++; failures.push(msg); console.log('  FAIL ' + msg); } }

(async () => {
  const browser = await chromium.launch();
  /* each run gets its own test client IP so the 5-sandboxes-per-IP-per-day limit does not block repeat runs on the dev server */
  const ip = `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${1 + ((Math.random() * 250) | 0)}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ip } });
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
  /* run an action that triggers a PUT, and wait for it to finish */
  const saving = async fn => { const w = page.waitForResponse(r => ['PUT', 'DELETE'].includes(r.request().method()) && r.url().includes('/api/pmoflow/'), { timeout: 15000 }); await fn(); const r = await w; ok(r.ok(), 'save responded ' + r.status()); await settle(); };
  const act = id => page.click(`.overlay [data-act="${id}"]`);
  const state = () => page.evaluate(async () => (await fetch('/api/pmoflow/ws/' + localStorage.getItem('pmoflow.ws') + '/state')).json());
  const titles = () => page.$$eval('#canvas .node .ttl', els => els.map(e => e.textContent.trim()));

  try {
    console.log('# boot');
    await nav('/');
    await page.waitForFunction(() => document.querySelectorAll('#persona option').length > 0, null, { timeout: 20000 });
    let st = await state();
    const procs = (st.docs.process || []).map(d => d.data);
    ok(procs.length > 0, 'seed has processes');
    const flat = ns => (ns || []).flatMap(n => n.type === 'decision' ? (n.branches || []).flatMap(b => flat(b.nodes)) : (n.type === 'trigger' || n.type === 'end') ? [] : [n]);
    const seedP = procs.slice().sort((a, b) => flat(b.tobe).length - flat(a.tobe).length)[0];
    const pid = seedP.id;

    console.log('# view modes on ' + pid);
    for (const m of ['asis', 'tobe', 'diff', 'lanes']) {
      await nav(`/process/${pid}?mode=${m}`);
      ok(await page.$eval('.d-modes button.on', b => b.dataset.mode) === m, `${m}: tab active`);
      ok((await page.$$('#canvas .node')).length > 0, `${m}: map renders nodes`);
      await shot('process-' + m); await overflow('process ' + m + ' @1440');
    }
    const tabOrder = await page.$$eval('.d-modes button', bs => bs.map(b => b.textContent.trim()));
    ok(tabOrder.join(',') === 'As-is,To-be,Diff,Swimlanes,Edit', 'mode tabs in order: ' + tabOrder.join(','));
    ok((await page.$$('.lanes .lane-h')).length > 0, 'swimlanes have owner headers');

    await nav(`/process/${pid}?mode=diff`);
    const nBadges = (await page.$$('#canvas .chip.diff-new, #canvas .chip.diff-changed')).length;
    ok(nBadges > 0, `diff shows NEW/CHANGED badges (${nBadges})`);
    ok((await page.$$('#canvas .d-was')).length > 0, 'diff shows what-changed notes');
    const expRemoved = await page.evaluate(p => (window.PMOEngine.diffProcess(p).removed || []).filter(n => !n.type || n.type === 'step').length, seedP);
    ok((await page.$$('#canvas .ghost')).length === expRemoved, `diff shows ${expRemoved} removed ghost(s)`);

    console.log('# data highlight + step drill-down');
    await nav(`/process/${pid}?mode=tobe`);
    await page.click('[data-hl] .t');
    ok((await page.$$('#canvas .node.hl')).length > 0 && (await page.$$('#canvas .node.dim')).length > 0, 'data row highlights using steps and dims the rest');
    await shot('process-highlight');
    await page.click('#canvas .node[data-go] .ttl');
    await page.waitForURL(/\/step\//);
    await page.waitForSelector('.kgrid');
    ok((await page.$$('.kgrid .kc')).length === 5, 'step page KPIs render');
    ok(await page.isVisible('text=How this step runs'), 'step page shows sub-steps card');
    ok(await page.isVisible('text=Work to deliver it'), 'step page shows work card');
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
    await page.waitForSelector('[data-ins]');

    /* keyboard: focus the insert point, press Enter, choose Step */
    await page.focus('[data-ins="root"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.overlay [data-act="step"]');
    await act('step');
    await page.waitForSelector('.overlay input[name=title]');
    await page.fill('.overlay input[name=title]', 'Verify identity');
    await page.click('.overlay [data-picks] .d-pick >> nth=0');
    await page.fill('.overlay input[name=touches]', 'Compliance, Portal');
    await page.click('.overlay [data-subadd]');
    await page.fill('.overlay [data-subrow] input[name=sub_title]', 'Check ID document');
    await page.click('.overlay [data-subrow] .d-pick >> nth=0');
    await saving(() => act('save'));
    ok((await titles()).includes('Verify identity'), 'inserted step via keyboard');

    /* insert decision after the step */
    const insCount = (await page.$$('[data-ins="root"]')).length;
    await page.click(`[data-ins="root"] >> nth=${insCount - 1}`);
    await act('decision');
    await page.fill('.overlay input[name=title]', 'Amount over limit?');
    await page.click('.overlay [data-badd]');
    ok((await page.$$('.overlay [data-brow]')).length === 3, 'decision modal: added a third branch');
    await page.click('.overlay [data-brow] >> nth=2 >> [data-bdel]');
    await page.fill('.overlay [data-brow] >> nth=1 >> input', 'Within limit');
    await saving(() => act('save'));
    ok(await page.isVisible('.diamond:has-text("Amount over limit?")'), 'decision inserted');
    ok(await page.isVisible('.blabel:has-text("Within limit")'), 'renamed branch label shown');

    /* step inside the first branch */
    await page.click('[data-ins$="#0"]');
    await act('step');
    await page.fill('.overlay input[name=title]', 'Manager approval');
    await saving(() => act('save'));
    ok(await page.isVisible('.branch .node:has-text("Manager approval")'), 'step added inside a branch');

    /* edit step data + create a data element inline */
    await page.click('.node:has-text("Verify identity") [data-ed="edit"]');
    await page.waitForSelector('.overlay [data-nd-name]');
    await page.fill('.overlay [data-nd-name]', 'E2E identity proof');
    await saving(() => page.click('.overlay [data-nd-create]'));
    ok(await page.isChecked('.overlay .d-pick:has-text("E2E identity proof") input'), 'inline data element created and tagged');
    await saving(() => act('save'));
    st = await state();
    const ndata = (st.docs.dataElement || []).map(d => d.data).find(d => d.name === 'E2E identity proof');
    ok(!!ndata, 'new data element persisted');
    let proc = (st.docs.process || []).find(d => d.id === newPid).data;
    const vstep = flat(proc.tobe).find(s => s.title === 'Verify identity');
    ok(vstep && vstep.data.includes(ndata.id) && vstep.data.length === 2, 'step data updated (2 elements)');
    ok(vstep && vstep.subs.length === 1 && vstep.subs[0].title === 'Check ID document', 'sub-step saved');

    /* move: step down below decision */
    await saving(() => page.click('.node:has-text("Verify identity") [data-ed="down"]'));
    proc = (await state()).docs.process.find(d => d.id === newPid).data;
    ok(proc.tobe[1].type === 'decision' && proc.tobe[2].title === 'Verify identity', 'moved step below the decision');

    /* delete with confirm */
    await page.click('.node:has-text("Manager approval") [data-ed="del"]');
    await saving(() => act('yes'));
    ok(!(await titles()).includes('Manager approval'), 'deleted step inside branch');

    /* header edit */
    await page.fill('input[data-meta=name]', 'E2E Purchase Request v2');
    await saving(() => page.press('input[data-meta=name]', 'Tab'));

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
    proc = (await state()).docs.process.find(d => d.id === newPid).data;
    const forked = flat(proc.tobe);
    ok(forked.length === 1 && forked[0].title === 'Check ID by hand' && forked[0].from === flat(proc.asis)[0].id && forked[0].id !== flat(proc.asis)[0].id, 'fork copied as-is with fresh ids and from links');
    await shot('process-edit');
    await page.click('.node:has-text("Check ID by hand") [data-ed="del"]');
    await saving(() => act('yes'));
    await page.click('[data-ins="root"] >> nth=0');
    await act('step');
    await page.fill('.overlay input[name=title]', 'Automated ID check');
    await saving(() => act('save'));

    console.log('# reload persistence + diff ghosts + history');
    await nav(`/process/${newPid}?mode=diff`);
    ok(await page.isVisible('h1:has-text("E2E Purchase Request v2")'), 'renamed process persisted after reload');
    ok(await page.isVisible('#canvas .node:has-text("Automated ID check") .chip.diff-new'), 'diff: new step badged NEW');
    ok(await page.isVisible('#canvas .ghost:has-text("Check ID by hand")'), 'diff: removed as-is step shown as ghost');
    await shot('process-diff-new');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    const hist = await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent));
    ok(hist.some(h => /Added step 'Verify identity' to to-be/.test(h)), 'history shows "Added step \'Verify identity\' to to-be"');
    ok(hist.some(h => /Forked to-be from as-is/.test(h)), 'history shows fork');

    console.log('# comment with @mention');
    const other = st.people.find(p => p.id !== st.people[0].id) || st.people[0];
    const first = other.name.split(' ')[0];
    await page.fill('[data-comments] textarea', `@${first} please review the new ID check`);
    await saving(() => page.click('[data-comments] [data-post]'));
    await page.waitForSelector(`.cmt:has-text("please review the new ID check")`);
    await page.waitForTimeout(800);
    const st2 = await state();
    ok((st2.docs.notification || []).some(n => n.data.to === other.id && /mentioned you/.test(n.data.text)), `mention notified ${first}`);

    console.log('# data page: spec editor');
    const did = ndata.id;
    await nav(`/data/${did}`);
    await page.click('[data-fadd]');
    await page.fill('.overlay input[name=name]', 'Document number');
    await page.selectOption('.overlay select[name=type]', 'digits');
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
    await page.fill('.overlay input[name=source]', 'Vendor portal upload');
    await saving(() => act('save'));
    await nav(`/data/${did}`);
    const specRows = await page.$$eval('.d-spec tr', rs => rs.slice(1).map(r => r.textContent));
    ok(specRows.length === 1 && /Document number/.test(specRows[0]) && /9 digits/.test(specRows[0]) && /Required/.test(specRows[0]), 'spec field add/edit/delete persisted');
    ok(await page.isVisible('.hdr .chip:has-text("Examples only")'), 'availability edit persisted');
    await page.waitForSelector('[data-history] .ev', { timeout: 10000 }).catch(() => {});
    ok((await page.$$eval('[data-history] .ev', els => els.map(e => e.textContent))).some(t => /Edited field 'Document number'/.test(t)), 'data history shows field edit');
    await shot('data-new'); await overflow('data @1440');
    /* seed data element with the richest page */
    const seedData = (st.docs.dataElement || []).map(d => d.data).find(d => d.avail === 'missing') || st.docs.dataElement[0].data;
    await nav(`/data/${seedData.id}`);
    ok(await page.isVisible('text=Impact: every step that depends on this'), 'seed data page renders impact');
    await shot('data-seed'); await overflow('data seed @1440');

    console.log('# new data element from the process panel');
    await nav(`/process/${pid}?mode=tobe`);
    await page.click('[data-newdata]');
    await page.fill('.overlay input[name=name]', 'E2E panel element');
    await page.fill('.overlay input[name=source]', 'Spreadsheet');
    await saving(() => act('save'));
    ok(((await state()).docs.dataElement || []).some(d => d.data.name === 'E2E panel element'), 'panel modal created data element');

    console.log('# phone 390');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const m of ['asis', 'tobe', 'diff', 'lanes', 'edit']) { await nav(`/process/${pid}?mode=${m}`); await overflow(`process ${m} @390`); await shot('phone-process-' + m); }
    await nav(`/process/${newPid}?mode=edit`);
    await overflow('new process edit @390'); await shot('phone-edit');
    await nav(`/process/${pid}?mode=edit`);
    const bb = await page.$eval('.branches', el => getComputedStyle(el).flexDirection);
    ok(bb === 'column', 'branches stack at 390');
    await page.click('[data-ins="root"] >> nth=0');
    ok(await page.isVisible('.overlay [data-act="step"]'), 'insert point usable at 390');
    await act('step');
    await page.waitForSelector('.overlay input[name=title]');
    await page.screenshot({ path: `${OUT}/phone-step-modal.png` });
    await act('cancel');
    const firstStep = flat(seedP.tobe)[0];
    await nav(`/process/${pid}/step/${firstStep.id}`); await overflow('step @390'); await shot('phone-step');
    await nav(`/data/${did}`); await overflow('data @390'); await shot('phone-data');
    await nav(`/data/${seedData.id}`); await overflow('data seed @390');
  } catch (e) {
    fail++; failures.push('exception: ' + e.message); console.log('  FAIL exception: ' + e.stack);
    await page.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => {});
  }
  ok(errors.length === 0, 'zero page/console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('Failures:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
