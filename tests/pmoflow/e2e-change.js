/* E2E for stream C (R10.2): traceable plan changes on /project/:prj/changes.
   Covers: propose → impact preview → apply (within tolerance), the log (expand, compare before/after, history, reload),
   over tolerance → approve by a second persona, reject changes nothing, process changed mid-project banner → update
   the plan, CSV export, the per-task "Changed N times" line, 1440/1366/390 layouts, zero console errors.
   Usage: node tests/pmoflow/e2e-change.js [port]   (dev server must be running on that port, with the route wired) */
const { chromium } = require('playwright');
const fs = require('fs');

const PORT = Number(process.argv[2] || 8871);
const ROOT = `http://localhost:${PORT}/concepts/pmoflow`;
const PRJ = 'vendor-modernization';
const SHOTS = '/tmp/pmo-change';
fs.mkdirSync(SHOTS, { recursive: true });
/* one fixed forwarded IP for the whole run (the sandbox and its rate limit are keyed on it) */
const IP = `198.51.100.${(Date.now() % 200) + 30}`;

let passed = 0, failed = 0;
const errors = [];
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ ' + msg); } }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'x-forwarded-for': IP }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text() + ' @ ' + ((m.location() || {}).url || '')); });

  const settle = ms => page.waitForTimeout(ms || 500);
  const open = async q => { await page.goto(`${ROOT}/project/${PRJ}/changes${q || ''}`); await page.waitForSelector('[data-chg-log]', { timeout: 30000 }); await settle(700); };
  const toastSays = async re => { try { await page.waitForFunction(src => [...document.querySelectorAll('.toast')].some(t => new RegExp(src).test(t.textContent)), re.source, { timeout: 15000 }); return true; } catch (e) { return false; } };
  const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const setMe = async id => { await page.evaluate(async v => { const { store } = await import('/concepts/pmoflow/app/store.js'); store.setMe(v); }, id); await settle(500); };
  const docs = () => page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); return store.state.docs; });
  const shotBoth = async (name, sel) => {
    for (const w of [1366, 390]) {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 }); await settle(350);
      ok(await noOverflow(), `${name}: no horizontal overflow at ${w}`);
      if (sel) { const el = await page.$(sel); if (el) await el.screenshot({ path: `${SHOTS}/${name}-${w}.png` }); else await page.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: true }); }
      else await page.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 }); await settle(250);
    ok(await noOverflow(), `${name}: no horizontal overflow at 1440`);
  };
  const wiz = '.chg-wiz';
  const expand = async sel => { await page.$$eval(sel || '[data-chg]', els => els.forEach(d => { if (!d.open) d.open = true; })); await settle(250); };
  const next = async () => { await page.click(`${wiz} [data-w="next"]`); await settle(300); };

  console.log('Empty log');
  await page.goto(ROOT + '/'); await page.waitForSelector('#app .card', { timeout: 30000 });
  await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); await store.reset(); });
  await open();
  ok(await page.isVisible('[data-chg-none]'), 'a new sandbox has no plan changes yet');
  ok(await page.isVisible('nav#nav a.on >> text=Projects'), 'Projects is the active nav item');
  ok(/Vendor Onboarding Modernization/.test(await page.textContent('.crumbs')), 'breadcrumb names the project');
  await shotBoth('empty');

  console.log('Within tolerance: propose → preview → apply (Leo Park)');
  await setMe('lp');
  await page.click('[data-chg-open]');
  await page.waitForSelector(wiz);
  await next();
  ok(/Pick what’s changing/.test(await page.textContent('[data-chg-errors]')) && /Say why/.test(await page.textContent('[data-chg-errors]')), 'what and why are required');
  await page.check(`${wiz} input[name="kind"][value="owner"]`);
  await page.fill('#chg-reason', 'Dev is on the ERP cutover next week');
  await page.selectOption(`${wiz} select[name="category"]`, 'resource');
  await next();
  await page.selectOption(`${wiz} select[name="ow_W11"]`, 'ar');
  await page.setViewportSize({ width: 390, height: 844 }); await settle(300);
  ok(await noOverflow(), 'wizard edits: no horizontal overflow at 390');
  await page.screenshot({ path: `${SHOTS}/wizard-edits-390.png` });
  await page.setViewportSize({ width: 1440, height: 1000 }); await settle(200);
  await next();
  const sentence1 = await page.textContent('[data-chg-preview-sentence]');
  ok(/^The expected finish stays \w{3} \d+ \(\d+ business days before the \w{3} \d+ deadline\); the change lowers the expected cost by \$[\d,]+ \([\d.]+%\)\.$/.test(sentence1), 'preview: one plain sentence: ' + sentence1);
  ok(await page.isVisible('[data-chg-verdict="within"]'), 'preview: within tolerance, applies on confirm');
  ok(/owner Dev Kumar → Ana Ruiz/.test(await page.textContent(`${wiz} [data-chg-edits]`)), 'preview lists the field-level edit');
  const prevCost = (await page.textContent(`${wiz} [data-imp-cost] b`)).replace(/\s+/g, ' ').trim();
  await page.setViewportSize({ width: 390, height: 844 }); await settle(300);
  ok(await noOverflow(), 'wizard preview: no horizontal overflow at 390');
  await page.screenshot({ path: `${SHOTS}/wizard-preview-390.png` });
  await page.setViewportSize({ width: 1366, height: 900 }); await settle(300);
  await page.screenshot({ path: `${SHOTS}/wizard-preview-1366.png` });
  await page.setViewportSize({ width: 1440, height: 1000 }); await settle(200);
  await page.click(`${wiz} [data-w="submit"]`);
  ok(await toastSays(/Plan change applied/), 'applied at once');
  await page.waitForSelector('[data-chg-status="applied"]', { timeout: 15000 }); await settle(500);
  let d = await docs();
  const w11 = d.workItem.find(x => x.id === 'W11').data;
  ok(w11.owner === 'ar', 'the task now belongs to Ana Ruiz');
  const engCost = await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); const t = PMOEngine.projectTruth(store.state.docs, 'vendor-modernization', store.state.today); return [t.cost.forecast]; });
  ok(prevCost.endsWith('$' + Math.round(engCost[0]).toLocaleString('en-US')), `the preview’s expected cost (${prevCost}) is the engine’s after applying ($${Math.round(engCost[0])})`);
  const proj = d.project.find(x => x.id === PRJ).data;
  const auto = (proj.baselines || []).filter(b => b.auto);
  ok(auto.length === 2 && /· before$/.test(auto[0].label) && /· after$/.test(auto[1].label), 'two Saved plans (before / after) labelled with the change title');
  ok(await page.$eval('[data-chg-count]', el => el.textContent) === '1', 'the log has one entry');
  await expand();
  ok(/owner Dev Kumar → Ana Ruiz/.test(await page.textContent('[data-chg] [data-chg-edits]')), 'expanding shows the field-level edits');
  ok(/Leo Park.*proposed it/.test(await page.textContent('[data-chg] [data-chg-trail]')) && /Applied by Leo Park/.test(await page.textContent('[data-chg] [data-chg-trail]')), 'who and when are recorded');
  await page.click('[data-chg-compare]');
  await page.waitForSelector('.drawer [data-chg-cmp]');
  ok(/Ana Ruiz/.test(await page.textContent('.drawer tr.chg-diff')) && /Dev Kumar/.test(await page.textContent('.drawer tr.chg-diff')), 'compare shows before and after for the changed task');
  await page.screenshot({ path: `${SHOTS}/compare-1440.png` });
  await page.click('.drawer [data-close]');
  await page.reload(); await page.waitForSelector('[data-chg-log]'); await settle(900);
  ok(await page.isVisible('[data-chg-status="applied"]'), 'the change persists after reload');
  await page.waitForFunction(() => /plan change/.test((document.querySelector('[data-history]') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  ok(/Saved the plan .*· before/.test(await page.textContent('[data-history]')), 'the project history shows the automatic Saved plans');

  console.log('Over tolerance: Leo proposes, Tom approves');
  await page.click('[data-chg-open]');
  await page.waitForSelector(wiz);
  await page.check(`${wiz} input[name="kind"][value="dates"]`);
  await page.fill('#chg-reason', 'The bank portal vendor needs five more weeks');
  await page.selectOption(`${wiz} select[name="category"]`, 'dependency');
  await next();
  await page.check(`${wiz} input[name="dt_on"][value="W6"]`);
  await page.fill(`${wiz} input[name="shift"]`, '25');
  await page.click(`${wiz} [data-shift]`);
  const newDue = await page.inputValue(`${wiz} input[name="du_W6"]`);
  await next();
  ok(await page.isVisible('[data-chg-verdict="approval"]'), 'preview: needs approval');
  ok(/Tom Alvarez \(project manager\)/.test(await page.textContent('[data-chg-verdict]')) && /past the .* deadline/.test(await page.textContent('[data-chg-verdict]')), 'names the project manager and why');
  ok(/^This moves the expected finish from \w{3} \d+ to \w{3} \d+ \(\d+ business days? after the \w{3} \d+ deadline\)/.test(await page.textContent('[data-chg-preview-sentence]')), 'the sentence says the finish moves past the deadline');
  const knock = Number(await page.textContent(`${wiz} [data-imp-knock] .n`));
  ok(knock >= 3 && /waits on it/.test(await page.textContent(`${wiz} [data-imp-knock]`)), `${knock} tasks move as a knock-on, the dependents flagged`);
  await page.click(`${wiz} [data-w="submit"]`);
  ok(await toastSays(/Sent for approval: Tom Alvarez/), 'sent for approval');
  await page.waitForSelector('[data-chg-status="proposed"]', { timeout: 15000 }); await settle(500);
  d = await docs();
  ok(d.workItem.find(x => x.id === 'W6').data.due !== newDue, 'nothing applied while waiting');
  ok(/Waiting for Tom Alvarez \(project manager\)/.test(await page.textContent('[data-chg-waiting]')), 'the log says who it waits for');
  ok(!(await page.$('[data-chg-approve]')), 'the requester cannot approve');
  await setMe('ta');
  await page.waitForSelector('[data-chg-mine]');
  ok(await page.$eval('[data-chg-mine] .n', el => el.textContent) === '1', 'Tom sees it in “Waiting for your decision”');
  const q = await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); return PMOChange.queueFor(store.state.docs, 'ta', store.state.today); });
  ok(q.length === 1 && q[0].kind === 'planChange', 'queueFor (the personQueue merge) lists it for Tom');
  await shotBoth('approve', null);
  await page.click('[data-chg-goto]');
  await page.waitForSelector('[data-chg-approve]'); await settle(400);
  await page.click('[data-chg-approve]');
  ok(await toastSays(/Approved and applied/), 'Tom approves; it applies');
  await settle(900);
  d = await docs();
  ok(d.workItem.find(x => x.id === 'W6').data.due === newDue, 'the new due date is in the plan');
  ok(await page.$$eval('[data-chg-status="applied"]', els => els.length) === 2, 'both changes read Applied');
  ok(!(await page.$('[data-chg-mine]')), 'nothing waits for Tom any more');
  const notif = d.notification.map(n => n.data).filter(n => n.to === 'lp' && /Plan change on/.test(n.text));
  ok(notif.length >= 1, 'Leo is notified when it applies');

  console.log('Reject changes nothing');
  await setMe('dk');
  await page.click('[data-chg-open]'); await page.waitForSelector(wiz);
  await page.check(`${wiz} input[name="kind"][value="work"]`);
  await page.fill('#chg-reason', 'Skip the test deposit');
  await next();
  await page.check(`${wiz} input[name="rm"][value="W7"]`);
  await next();
  ok(await page.isVisible('[data-chg-verdict="approval"]'), 'removing a task moves the cost by 5% or more: needs approval');
  await page.click(`${wiz} [data-w="submit"]`);
  ok(await toastSays(/Sent for approval/), 'sent');
  await page.waitForSelector('[data-chg-status="proposed"]'); await settle(400);
  await setMe('ta');
  await page.waitForSelector('[data-chg-reject]');
  await page.click('[data-chg-reject]');
  await page.waitForSelector('.overlay .modal input[name="note"]');
  await page.fill('.overlay .modal input[name="note"]', 'Treasury needs the deposit check');
  await page.click('.overlay [data-act="reject"]');
  ok(await toastSays(/Plan change rejected/), 'rejected');
  await page.waitForSelector('[data-chg-status="rejected"]'); await settle(500);
  d = await docs();
  ok(!!d.workItem.find(x => x.id === 'W7'), 'the task is still in the plan');
  ok((d.project.find(x => x.id === PRJ).data.baselines || []).filter(b => b.auto).length === 4, 'no Saved plans added by the rejected change');

  console.log('Process changed mid-project');
  await setMe('mc');
  await page.evaluate(async () => {
    const { store } = await import('/concepts/pmoflow/app/store.js');
    const p = JSON.parse(JSON.stringify(store.get('process', 'vendor-onboarding')));
    const i = p.tobe.findIndex(n => n.id === 's4');
    p.tobe.splice(i + 1, 0, { id: 'snew1', type: 'step', title: 'Call the vendor to confirm bank details', owner: 'lp', data: [], touches: ['Treasury'] });
    await store.save('process', p.id, p, 'Added the step “Call the vendor to confirm bank details”');
  });
  await setMe('ta');
  await open();
  await page.waitForSelector('[data-chg-drift-banner]', { timeout: 15000 });
  ok(/The process changed after this plan was made: 1 new step has no work\./.test(await page.textContent('[data-chg-drift-banner]')), 'banner: the process changed after the plan');
  await shotBoth('drift', null);
  await page.click('[data-chg-update]');
  await page.waitForSelector(wiz);
  ok(await page.isChecked(`${wiz} input[name="kind"][value="scope"]`) && /Call the vendor/.test(await page.inputValue('#chg-reason')), 'the wizard opens pre-filled (scope, reason)');
  await next();
  ok(/Stand up new step: Call the vendor to confirm bank details/.test(await page.textContent(`${wiz} [data-ed="scope"]`)), 'the suggested task is for the new step only');
  ok(await page.$$eval(`${wiz} input[name="sg"]`, els => els.length) === 1, 'one suggestion (none for older gaps)');
  await next();
  await page.click(`${wiz} [data-w="submit"]`);
  ok(await toastSays(/Plan change applied|Sent for approval/), 'plan updated from the process change');
  await settle(1200);
  d = await docs();
  ok(d.workItem.some(x => x.data.step === 'snew1' && x.data.projectId === PRJ), 'a task now delivers the new step');
  const chg = d.planChange.map(x => x.data).find(c => c.source === 'process');
  ok(chg && chg.kinds.includes('scope'), 'logged as a scope change');
  await open();
  await settle(1200);
  ok(!(await page.$('[data-chg-drift-banner]')), 'the banner is gone once the plan is updated');

  console.log('Traceability: per task and CSV');
  const taskLine = await page.evaluate(async () => { const m = await import('/concepts/pmoflow/app/pages/changes.js'); return m.taskChangesHTML('W6'); });
  ok(/Changed 1 time/.test(taskLine) && /changes\?change=/.test(taskLine), 'W6: “Changed 1 time” with a link to the change');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-chg-csv]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const lines = csv.trim().split(/\r\n/);
  ok(lines.length === 1 + d.planChange.length && lines[0].startsWith('Requested,Project,Title,Reason'), `CSV: header + ${lines.length - 1} changes`);
  ok(/Treasury needs the deposit check|Rejected/.test(csv) && /The bank portal vendor needs five more weeks/.test(csv), 'CSV has reasons and statuses');
  await shotBoth('log', null);
  await expand();
  await shotBoth('entry-open', null);

  ok(errors.length === 0, 'zero console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
