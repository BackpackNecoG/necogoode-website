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
  /* R12 #4: the extra sign-in check (simulated: any 6 digits) */
  const stepUpOk = async () => { await page.waitForSelector('.overlay .modal input[name="code"]', { timeout: 10000 }); await page.fill('.overlay .modal input[name="code"]', '123456'); await page.click('.overlay [data-act="verify"]'); await settle(300); };
  const ERP = 'erp-upgrade-readiness';

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
  ok(/Tom Alvarez \(project manager and project manager of ERP Upgrade Readiness\) and Maya Chen \((?:sponsor|Admin, as no sponsor is set)\)/.test(await page.textContent('[data-chg-verdict]')) && /past the .* deadline/.test(await page.textContent('[data-chg-verdict]')), 'R13 #3: names the PM once (both roles) and the sponsor for the deadline breach, and why');
  ok(/needs the sponsor’s approval/.test(await page.textContent('[data-chg-verdict]')), 'R13 #3: says a change past the deadline needs the sponsor');
  ok(/^This moves the expected finish from \w{3} \d+ to \w{3} \d+ \(\d+ business days? after the \w{3} \d+ deadline\)/.test(await page.textContent('[data-chg-preview-sentence]')), 'the sentence says the finish moves past the deadline');
  const knock = Number(await page.textContent(`${wiz} [data-imp-knock] .n`));
  ok(knock >= 3 && /waits on it/.test(await page.textContent(`${wiz} [data-imp-knock]`)), `${knock} tasks move as a knock-on, the dependents flagged`);
  /* R12 #13: the knock-on into ERP is named, and ERP's project manager approves too */
  ok(/ERP Upgrade Readiness/.test(await page.textContent(`${wiz} [data-imp-cross]`)) && /approves too/.test(await page.textContent(`${wiz} [data-imp-cross]`)), 'preview: the other project the change moves is listed');
  ok(/project manager of ERP Upgrade Readiness/.test(await page.textContent('[data-chg-verdict]')) && /ERP Upgrade Readiness \(another project\)/.test(await page.textContent('[data-chg-verdict]')), 'verdict: ERP’s project manager approves too, and why');
  /* R14 PMO list 4: the cross-project line names the approver the routing picked (Leo asked: ERP's own PM, Tom) */
  ok(/^Tom Alvarez \(its project manager\) approves too/.test((await page.textContent(`${wiz} [data-imp-cross-who="${ERP}"]`)).trim()), 'R14: the other project’s approver is the routing’s: ' + (await page.textContent(`${wiz} [data-imp-cross-who="${ERP}"]`)).trim());
  /* R14 PMO-9: the tasks that wait on W6 are re-dated with it, and the edits list says so */
  ok(await page.$$eval(`${wiz} [data-imp-knock] [data-imp-redate]`, els => els.length) >= 3 && /Their due dates move with the change/.test(await page.textContent(`${wiz} [data-imp-knock]`)), 'R14 PMO-9: knock-on tasks show their due date moving with the change');
  ok(await page.$$eval(`${wiz} [data-chg-edits] [data-chg-knock]`, els => els.length) >= 3 && /knock-on/.test(await page.textContent(`${wiz} [data-chg-edits] [data-chg-knock]`)), 'R14 PMO-9: the edits list shows the knock-on re-dating');
  ok(!(await page.$(`${wiz} [data-imp-endslate]`)) || !/W7|test deposit/i.test(await page.textContent(`${wiz} [data-imp-endslate]`)), 'R14 PMO-9: no knocked-on task is warned as ending up late (it was re-dated)');
  await page.screenshot({ path: `${SHOTS}/r14-knockon-1440.png` });
  const d14 = await docs();
  await page.click(`${wiz} [data-w="submit"]`);
  ok(await toastSays(/Sent for approval: Tom Alvarez/), 'sent for approval');
  await page.waitForSelector('[data-chg-status="proposed"]', { timeout: 15000 }); await settle(500);
  d = await docs();
  ok(d.workItem.find(x => x.id === 'W6').data.due !== newDue, 'nothing applied while waiting');
  ok(/Waiting for Tom Alvarez \(project manager and project manager of ERP Upgrade Readiness\) and Maya Chen \((?:sponsor|Admin, as no sponsor is set)\)/.test(await page.textContent('[data-chg-waiting]')), 'the log says who it waits for, once per person: ' + await page.textContent('[data-chg-waiting]'));
  /* while it waits, ERP's own log shows it (proposed on another project) */
  await page.goto(`${ROOT}/project/${ERP}/changes`); await page.waitForSelector('[data-chg-log]'); await settle(700);
  ok(await page.isVisible(`[data-chg-from="${PRJ}"]`) && /Proposed on Vendor Onboarding Modernization/.test(await page.textContent('[data-chg-from]')), 'ERP’s log shows the pending change from the vendor project');
  await page.goto(`${ROOT}/project/${PRJ}/changes`); await page.waitForSelector('[data-chg-log]'); await settle(500);
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
  await stepUpOk();
  ok(await toastSays(/Waiting for the next approver/), 'Tom approves with the extra sign-in check; it still waits for the sponsor');
  await setMe('mc');
  await page.waitForSelector('[data-chg-mine]');
  await page.click('[data-chg-goto]');
  await page.waitForSelector('[data-chg-approve]'); await settle(400);
  await page.click('[data-chg-approve]');
  await stepUpOk();
  ok(await toastSays(/Approved and applied/), 'R13 #3: the sponsor (Maya) approves; it applies');
  await setMe('ta');
  await settle(900);
  d = await docs();
  ok(d.workItem.find(x => x.id === 'W6').data.due === newDue, 'the new due date is in the plan');
  /* R14 PMO-9: the tasks that wait on W6 were re-dated; none of them ends up later than it was */
  const late14 = await page.evaluate(([a, b]) => ['W7', 'W8', 'W10'].map(id => { const fa = PMOEngine.forecastAll(a, PMOEngine.addBusinessDays(new Date().toISOString().slice(0, 10), 0)), fb = PMOEngine.forecastAll(b, PMOEngine.addBusinessDays(new Date().toISOString().slice(0, 10), 0));
    const due = x => x.workItem.find(w => w.id === id).data.due; return { id, moved: due(a) > due(b), worse: (fa[id].late ? fa[id].lateDays : 0) > (fb[id].late ? fb[id].lateDays : 0) }; }), [d, d14]);
  ok(late14.every(x => x.moved && !x.worse), 'R14 PMO-9: after the approved re-plan, W7, W8 and W10 were re-dated and are no later than before: ' + JSON.stringify(late14));
  ok(await page.$$eval('[data-chg-status="applied"]', els => els.length) === 2, 'both changes read Applied');
  ok(!(await page.$('[data-chg-mine]')), 'nothing waits for Tom any more');
  const notif = d.notification.map(n => n.data).filter(n => n.to === 'lp' && /Plan change on/.test(n.text));
  ok(notif.length >= 1, 'Leo is notified when it applies');
  const applied = d.planChange.map(x => x.data).find(c => c.status === 'applied' && (c.edits || []).some(e => e.id === 'W6'));
  ok(applied && applied.approvers.every(a => a.stepUp === true), 'the stored approvals carry the sign-in check');
  ok(/extra sign-in check done/.test(await page.textContent(`[data-chg="${applied.id}"] [data-chg-trail]`)), 'the decision trail shows the sign-in check');
  /* R12 #13: ERP's log has the linked entry, pointing back */
  const linkedEntry = d.planChange.map(x => x.data).find(c => c.projectId === ERP && c.linkedFrom);
  ok(linkedEntry && linkedEntry.linkedFrom.changeId === applied.id && (applied.linked || []).some(l => l.changeId === linkedEntry.id), 'a linked entry is recorded in ERP’s plan changes');
  await page.goto(`${ROOT}/project/${ERP}/changes`); await page.waitForSelector('[data-chg-log]'); await settle(700);
  ok(await page.$eval('[data-chg-count]', el => el.textContent) === '1' && await page.isVisible('[data-chg-status="applied"]'), 'ERP’s log: 1 applied entry');
  ok(/Knock-on from Vendor Onboarding Modernization/.test(await page.textContent('[data-chg-from]')), 'ERP’s entry says where it came from');
  await expand();
  ok(/expected finish .* → /.test(await page.textContent('[data-chg-linked-tasks]')), 'ERP’s entry lists its tasks that moved');
  ok(/Tom Alvarez.*project manager of ERP Upgrade Readiness.*approved/.test(await page.textContent('[data-chg-trail]')), 'ERP’s entry shows its PM’s approval');
  await shotBoth('linked', null);
  await page.click('[data-chg-linked] a');
  await page.waitForSelector(`[data-chg="${applied.id}"]`); await settle(500);
  ok(new RegExp(PRJ + '/changes').test(page.url()), 'Open the original change goes back to the vendor project');

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
  /* R15 (M1 #3): the sponsor is stored; the seed sets none, so Maya Chen decides as the Admin who did not ask (the
     assertions accept either wording: the sponsor, or "Admin, as no sponsor is set").
     R13 #3: Tom asked, so if it needs approval the sponsor gives it (Tom never approves his own change) */
  if (await page.$(`[data-chg-status="proposed"]`)) {
    await setMe('mc'); await page.waitForSelector('[data-chg-approve]'); await page.click('[data-chg-approve]'); await stepUpOk();
    ok(await toastSays(/Approved and applied/), 'the sponsor approves the scope change');
    await settle(900); await setMe('ta');
  }
  d = await docs();
  ok(d.workItem.some(x => x.data.step === 'snew1' && x.data.projectId === PRJ), 'a task now delivers the new step');
  const chg = d.planChange.map(x => x.data).find(c => c.source === 'process');
  ok(chg && chg.kinds.includes('scope'), 'logged as a scope change');
  await open();
  await settle(1200);
  ok(!(await page.$('[data-chg-drift-banner]')), 'the banner is gone once the plan is updated');

  console.log('R13: the PM’s own deadline breach goes to the sponsor; holiday due dates are refused');
  await setMe('ta');
  await open();
  await page.click('[data-chg-open]'); await page.waitForSelector(wiz);
  await page.check(`${wiz} input[name="kind"][value="dates"]`);
  await page.fill('#chg-reason', 'Training runs over the holidays');
  await next();
  await page.check(`${wiz} input[name="dt_on"][value="W8"]`);
  await page.fill(`${wiz} input[name="du_W8"]`, '2026-12-25');
  await page.dispatchEvent(`${wiz} input[name="du_W8"]`, 'change'); await settle(200);
  /* R14 PMO-11: the picker says at once that it is a day off and offers a working day */
  ok(/Christmas Day/.test(await page.textContent(`${wiz} input[name="du_W8"] + [data-dayoff-msg]`).catch(() => '')) && !!(await page.$(`${wiz} input[name="du_W8"] + [data-dayoff-msg] [data-dayoff-use]`)), 'R14 PMO-11: the date picker marks Dec 25 as a day off and offers a working day');
  ok(!!(await page.$(`${wiz} [data-days-off-soon]`)), 'R14 PMO-11: the days off coming up are listed');
  await next();
  ok(/Christmas Day/.test(await page.textContent('[data-chg-errors]').catch(() => '')) && /day off/.test(await page.textContent('[data-chg-errors]').catch(() => '')), 'R13 #13: a Dec 25 due date is refused, naming the holiday');
  await page.setViewportSize({ width: 390, height: 844 }); await settle(300);
  ok(await noOverflow(), 'holiday message: no horizontal overflow at 390');
  await page.screenshot({ path: `${SHOTS}/r13-holiday-390.png` });
  await page.setViewportSize({ width: 1440, height: 1000 }); await settle(200);
  const w8 = (await docs()).workItem.find(x => x.id === 'W8').data;
  const far = await page.evaluate(d => PMOEngine.addBusinessDays(d, 40), w8.due);
  await page.fill(`${wiz} input[name="du_W8"]`, far);
  await next();
  ok(await page.isVisible('[data-chg-verdict="approval"]'), 'a business day passes; past the deadline it needs approval');
  const v13 = await page.textContent('[data-chg-verdict]');
  ok(/Maya Chen \((?:sponsor|Admin, as no sponsor is set)/.test(v13) && !/Tom Alvarez \(/.test(v13), 'R13 #3: Tom asked, so only the sponsor approves (never the requester): ' + v13);
  await page.click(`${wiz} [data-w="submit"]`);
  ok(await toastSays(/Sent for approval: Maya Chen/), 'sent to the sponsor');
  await page.waitForSelector('[data-chg-status="proposed"]'); await settle(400);
  ok(!(await page.$('[data-chg-approve]')) && !(await page.$('[data-chg-mine]')), 'the requester (Tom) has nothing to approve');
  /* R14 PMO list 7: a waiting change shows its impact on today's plan (recomputed), not the one stored when it was sent */
  const live14 = await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); const c = store.list('planChange').find(x => x.status === 'proposed');
    const im = PMOChange.liveImpact(store.state.docs, c, store.state.today, { engine: PMOEngine }); const el = document.querySelector(`[data-chg="${c.id}"] [data-chg-sentence]`); return { shown: el && el.textContent, live: im && im.sentence }; });
  ok(live14.shown && live14.shown === live14.live, 'R14 PMO list 7: the waiting change’s sentence is today’s: ' + JSON.stringify(live14));
  const pend13 = (await docs()).planChange.map(x => x.data).find(c => c.status === 'proposed');
  const self13 = await page.evaluate(async id => { const { store } = await import('/concepts/pmoflow/app/store.js');
    const r = await fetch(`/api/pmoflow/workspaces/${store.state.ws}/changes/${id}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'ta', decision: 'approve', stepUp: { method: 'simulated-mfa', at: new Date().toISOString() } }) });
    return { status: r.status, body: await r.json() }; }, pend13.id);
  ok(self13.status === 403, 'the server refuses the requester’s own approval: ' + (self13.body || {}).error);
  await settle(400); /* that refusal was provoked on purpose: drop the browser's resource-error line for it */
  for (let i = errors.length - 1; i >= 0; i--) if (/403/.test(errors[i]) && errors[i].includes(pend13.id + '/decide')) errors.splice(i, 1);
  await setMe('mc');
  await page.waitForSelector('[data-chg-mine]');
  await page.click('[data-chg-goto]');
  await page.waitForSelector('[data-chg-approve]'); await settle(300);
  await page.click('[data-chg-approve]');
  await stepUpOk();
  ok(await toastSays(/Approved and applied/), 'the sponsor approves; it applies');
  await setMe('ta');
  await open();

  console.log('Traceability: per task and CSV');
  const taskLine = await page.evaluate(async () => { const m = await import('/concepts/pmoflow/app/pages/changes.js'); return m.taskChangesHTML('W6'); });
  ok(/Changed 1 time/.test(taskLine) && /changes\?change=/.test(taskLine), 'W6: “Changed 1 time” with a link to the change');
  d = await docs();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-chg-csv]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const lines = csv.trim().split(/\r\n/);
  ok(lines.length === 1 + d.planChange.filter(x => x.data.projectId === PRJ).length && lines[0].startsWith('Requested,Project,Title,Reason'), `CSV: header + ${lines.length - 1} changes`);
  ok(/Treasury needs the deposit check|Rejected/.test(csv) && /The bank portal vendor needs five more weeks/.test(csv), 'CSV has reasons and statuses');
  await shotBoth('log', null);
  await expand();
  await shotBoth('entry-open', null);

  console.log('R15 (M3): re-plan by real scheduling, exact shifts, the project manager hand-over');
  await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); await store.reset(); });
  await setMe('ta');
  await open();
  await page.click('[data-chg-open]'); await page.waitForSelector(wiz);
  await page.check(`${wiz} input[name="kind"][value="dates"]`);
  await page.fill('#chg-reason', 'The bank portal vendor slipped two weeks');
  await next();
  /* Jordan 5: a 10-business-day shift moves start and due by exactly 10 business days (and says which days off it skipped) */
  const w6r = (await docs()).workItem.find(x => x.id === 'W6').data;
  await page.check(`${wiz} input[name="dt_on"][value="W6"]`);
  await page.fill(`${wiz} input[name="shift"]`, '10');
  await page.click(`${wiz} [data-shift]`); await settle(300);
  const sh = await page.evaluate(w => { const st = document.querySelector('.chg-wiz [name="st_W6"]').value, du = document.querySelector('.chg-wiz [name="du_W6"]').value;
    return { st, du, ns: PMOEngine.businessDaysBetween(w.start, st), nd: PMOEngine.businessDaysBetween(w.due, du), note: (document.querySelector('[data-shift-note]') || {}).textContent || '' }; }, w6r);
  ok(sh.ns === 10 && sh.nd === 10, `R15 Jordan 5: start and due both move exactly 10 business days (${w6r.start}→${sh.st}, ${w6r.due}→${sh.du})`);
  ok(/by 10 business days later/.test(sh.note), 'the dialog says what the shift did: ' + sh.note);
  const offIn = await page.evaluate(([a, b]) => (PMOEngine.holidays(null, { fromYear: +a.slice(0, 4), years: 2 }) || []).filter(h => !h.worked && h.date > a && h.date <= b && h.weekday !== 'Sat' && h.weekday !== 'Sun').map(h => h.name), [w6r.start, sh.du]);
  ok(!offIn.length || offIn.every(n => sh.note.includes(n)), 'the days off the shift stepped over are named: ' + JSON.stringify(offIn));
  await next();
  /* PMO re-test 9: the knock-ons keep finish-to-start order, in-progress W8 keeps its start, and none shows late */
  const kn = await page.evaluate(async () => {
    const lines = [...document.querySelectorAll('.chg-wiz [data-chg-knock]')].map(li => li.textContent);
    const late = [...document.querySelectorAll('.chg-wiz [data-imp-knock] li b.fail')].length;
    return { lines, late };
  });
  ok(kn.lines.some(t => /Check bank accounts with a small test deposit/.test(t) && /same length/.test(t)), 'knock-on line reads as a schedule: ' + kn.lines[0]);
  ok(kn.lines.some(t => /Save new vendors in the ERP automatically/.test(t) && /already started, so only the due date moves/.test(t)), 'the in-progress task keeps its start (only its due date moves)');
  ok(kn.late === 0, 'no knock-on task is shown late on the impact screen');
  await page.click(`${wiz} [data-w="submit"]`);
  ok(await toastSays(/Sent for approval|Plan change applied/), 'sent');
  await page.waitForSelector('[data-chg-status]'); await settle(400);
  await setMe('mc');
  await page.waitForSelector('[data-chg-approve]', { timeout: 15000 }).catch(() => {});
  if (await page.$('[data-chg-approve]')) { await page.click('[data-chg-approve]'); await stepUpOk(); ok(await toastSays(/Approved and applied|Waiting for the next approver/), 'approved'); }
  await setMe('ta');
  if (await page.$('[data-chg-approve]')) { await page.click('[data-chg-approve]'); await stepUpOk(); await toastSays(/Approved and applied/); }
  await settle(600);
  const after15 = await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); const d = store.state.docs; const fc = PMOEngine.forecastAll(d, store.state.today);
    const t = id => d.workItem.find(x => x.id === id).data; const c = store.list('planChange').find(x => x.status === 'applied' && /bank portal vendor slipped/.test(x.reason));
    return { applied: !!c, w6: t('W6'), w7: t('W7'), w8: t('W8'), w10: t('W10'), late: ['W7', 'W8', 'W10'].filter(id => fc[id].late), knock: c ? (c.impact.knockOn || []).filter(k => !k.lateAfter).map(k => k.id) : [] }; });
  ok(after15.applied, 'R15: the re-plan is applied');
  ok(after15.w7.start > after15.w6.due && after15.w7.due > after15.w6.due && after15.w10.start > after15.w8.due, `finish-to-start holds: W6 due ${after15.w6.due}, W7 ${after15.w7.start}–${after15.w7.due}, W8 due ${after15.w8.due}, W10 starts ${after15.w10.start}`);
  ok(after15.late.length === 0, 'after approval, nothing the impact screen said would not be late is late: ' + JSON.stringify(after15.late));
  await shotBoth('r15-replan', null);
  /* M1 #3: the project manager role changes hands only through Change the plan */
  await page.goto(`${ROOT}/project/${PRJ}`); await page.waitForSelector('[data-settings]', { timeout: 30000 }); await settle(500);
  await page.click('[data-settings]'); await page.waitForSelector('.overlay [data-set-pm]');
  ok(await page.$eval('.overlay [data-set-pm]', el => el.readOnly), 'R15: settings show the project manager read-only');
  ok(!(await page.$('.overlay select[name="owner"]')), 'no plain project-manager picker in settings');
  ok(/Not set|Maya Chen/.test(await page.$eval('.overlay [data-set-sponsor]', el => el.value)) && !/default approver/.test(await page.$eval('.overlay [data-set-sponsor]', el => el.value)), 'the sponsor is the stored one (never a computed default approver)');
  await page.click('.overlay [data-act="handover"]'); await page.waitForSelector(wiz);
  ok(await page.isChecked(`${wiz} input[name="kind"][value="pm"]`), '“Hand over the role” opens Change the plan on the hand-over');
  await page.fill('#chg-reason', 'Tom moves to the ERP program');
  await next();
  await page.selectOption(`${wiz} select[name="pm"]`, 'lp');
  await next();
  const v15 = await page.textContent('[data-chg-verdict]');
  ok(/Needs approval from Maya Chen/.test(v15) && /project manager changes \(Tom Alvarez → Leo Park\)/.test(v15) && !/Tom Alvarez \(project manager\)/.test(v15), 'the hand-over goes to the sponsor/Admin, never either project manager: ' + v15);
  await page.setViewportSize({ width: 390, height: 844 }); await settle(300);
  ok(await noOverflow(), 'hand-over preview: no horizontal overflow at 390');
  await page.screenshot({ path: `${SHOTS}/r15-handover-390.png` });
  await page.setViewportSize({ width: 1440, height: 1000 }); await settle(200);
  await page.click(`${wiz} [data-w="cancel"]`); await settle(200);

  /* R16 (N1 #6, Jordan 3): the launch owner changes hands only through Change the plan, approved by the sponsor/Admin */
  await page.goto(`${ROOT}/project/${PRJ}`); await page.waitForSelector('[data-settings]', { timeout: 30000 }); await settle(500);
  await page.click('[data-settings]'); await page.waitForSelector('.overlay [data-set-pm]');
  ok(await page.$eval('.overlay [data-set-lo]', el => el.readOnly) && !(await page.$('.overlay select[name="releaseManager"]')), 'R16: settings show the launch owner read-only on a planned project');
  await page.click('.overlay [data-act="handover-lo"]'); await page.waitForSelector(wiz);
  ok(await page.isChecked(`${wiz} input[name="kind"][value="launchOwner"]`), '“Hand over the launch owner” opens Change the plan on that hand-over');
  await page.fill('#chg-reason', 'Leo runs launch day');
  await next();
  await page.selectOption(`${wiz} select[name="lo"]`, 'dk');
  await next();
  const v16 = await page.textContent('[data-chg-verdict]');
  ok(/Needs approval from/.test(v16) && /launch owner changes \(.+ → Dev Kumar\)/.test(v16), 'the launch-owner hand-over needs approval: ' + v16);
  await page.setViewportSize({ width: 390, height: 844 }); await settle(300);
  ok(await noOverflow(), 'launch-owner hand-over preview: no horizontal overflow at 390');
  await page.screenshot({ path: `${SHOTS}/r16-launch-owner-390.png` });
  await page.setViewportSize({ width: 1366, height: 900 }); await settle(300);
  await page.screenshot({ path: `${SHOTS}/r16-launch-owner-1366.png` });
  await page.setViewportSize({ width: 1440, height: 1000 }); await settle(200);
  await page.click(`${wiz} [data-w="cancel"]`); await settle(200);
  /* R16 (N1 #7, PMO re-test 10): the launch window moves here; a day off is refused, after the deadline needs approval */
  await page.click('[data-chg-open]'); await page.waitForSelector(wiz);
  await page.check(`${wiz} input[name="kind"][value="launchWindow"]`);
  await page.fill('#chg-reason', 'Vendor freeze');
  await next();
  const tgt = await page.evaluate(async p => { const { store } = await import('/concepts/pmoflow/app/store.js'); return store.get('project', p).target; }, PRJ);
  const late = await page.evaluate(t => PMOEngine.addBusinessDays(t, 3), tgt);
  await page.fill(`${wiz} input[name="lwday"]`, late);
  await next();
  const v16b = await page.textContent('[data-chg-verdict]');
  ok(/Needs approval/.test(v16b) && /launch window .+ is after the .+ deadline/.test(v16b), 'a launch window after the deadline needs approval: ' + v16b);
  await page.click(`${wiz} [data-w="cancel"]`); await settle(200);

  /* ---------------------------------------------------------------- R17 P3 (R16 [own data] findings) */
  console.log('R17: a task with hours is cancelled, never deleted (PMO defect 1)');
  await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); await store.reset(); });
  await setMe('ta');
  await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); store.setAdvanced(true); });   /* the Work table (Advanced) */
  const openWork = async (prj) => { await page.goto(`${ROOT}/project/${prj || PRJ}?mode=work`); await page.waitForSelector('table.pmo-work', { timeout: 30000 }); await settle(600); };
  await openWork();
  const w8row = page.locator('tr[data-wid="W8"]');
  ok(await w8row.locator('[data-cancel-work]').count() === 1 && await w8row.locator('button:has-text("Delete")').count() === 0, 'a task with hours offers “Cancel task”, never Delete');
  const spent0 = await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); return PMOEngine.projectTruth(store.state.docs, 'vendor-modernization', store.state.today).cost.actual; });
  await w8row.locator('[data-cancel-work]').click();
  await page.waitForSelector('.overlay [data-cancel-dialog]');
  const cdTxt = await page.textContent('.overlay [data-cancel-dialog]');
  ok(/has [\d.]+ hours? logged.*so it can’t be deleted\. It is cancelled instead: the hours stay in Spent/.test(cdTxt.replace(/\s+/g, ' ')), 'the dialog says the hours stay: ' + cdTxt.replace(/\s+/g, ' ').slice(0, 160));
  await page.fill('.overlay input[name="why"]', 'Not needed: the ERP saves vendors itself now');
  for (const w of [1366, 390]) { await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 }); await settle(250); ok(await noOverflow(), `cancel dialog: no horizontal overflow at ${w}`); await page.screenshot({ path: `${SHOTS}/r17-cancel-${w}.png` }); }
  await page.setViewportSize({ width: 1440, height: 1000 }); await settle(200);
  await page.click('.overlay [data-act="cancel-task"]');
  ok(await toastSays(/Cancelled “.+”: its hours stay|Sent for approval/), 'cancelling goes through a plan change');
  await settle(800);
  d = await docs();
  const r17w8 = (d.workItem.find(x => x.id === 'W8') || {}).data;
  const c8 = (d.planChange || []).map(x => x.data).find(c => (c.edits || []).some(e => e.id === 'W8' && e.op === 'cancel'));
  ok(!!r17w8 && (r17w8.time || []).length > 0, 'W8 and its hours are still there');
  ok(!!c8, 'the plan change records a cancel (not a delete): ' + (c8 ? c8.status : 'none'));
  if (c8 && c8.status === 'proposed') {
    for (const a of c8.approvers.filter(x => !x.decision)) {
      await page.evaluate(async ([id, who]) => { const { store } = await import('/concepts/pmoflow/app/store.js');
        await fetch(`/api/pmoflow/workspaces/${store.state.ws}/changes/${id}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: who, decision: 'approve', stepUp: { method: 'simulated-mfa', at: new Date().toISOString() } }) }); await store.load(); }, [c8.id, a.person]);
    }
  }
  await openWork();
  ok(await page.locator('tr[data-wid="W8"] [data-cancelled]').count() === 1, 'the Work tab shows it as Cancelled');
  const spent1 = await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); return PMOEngine.projectTruth(store.state.docs, 'vendor-modernization', store.state.today).cost.actual; });
  ok(spent1 === spent0, `Spent is unchanged ($${Math.round(spent0)} → $${Math.round(spent1)})`);
  /* the server refuses a plain delete of a task with hours, whoever asks */
  /* sent from the test (not the page), so the expected 409 is not a console error */
  const wsNow = await page.evaluate(async () => (await import('/concepts/pmoflow/app/store.js')).store.state.ws);
  const delR = await ctx.request.delete(`http://localhost:${PORT}/api/pmoflow/ws/${wsNow}/doc/workItem/W12`, { data: { actor: 'lp' } });
  const del = [delR.status(), ((await delR.json().catch(() => ({}))) || {}).error];
  ok(del[0] === 409 && /hours logged, so it can’t be deleted/.test(del[1]), 'a plain DELETE of a task with hours is refused: ' + del.join(' '));

  console.log('R17: “+ Add work item” over the cost tolerance goes through Change the plan (PMO partial)');
  await page.click('[data-add-work]'); await page.waitForSelector('.overlay input[name="title"]');
  await page.fill('.overlay input[name="title"]', 'Extra vendor checks');
  await page.fill('.overlay input[name="effortDays"]', '6');
  await page.selectOption('.overlay select[data-wi-owner]', 'dk');
  await page.click('.overlay [data-act="save"]');
  await page.waitForSelector('.overlay [data-add-refusal]', { timeout: 10000 }).catch(() => {});
  const arTxt = (await page.textContent('.overlay [data-add-refusal]').catch(() => '')) || '';
  ok(/Adding “Extra vendor checks”: .*(over the \$[\d,]+ budget|more than 5%|already over the budget)/.test(arTxt.replace(/\s+/g, ' ')) && /Nothing was added/.test(arTxt), 'the new task is refused with the cost reason: ' + arTxt.replace(/\s+/g, ' ').slice(0, 200));
  await page.click('.overlay [data-act="change"]');
  await page.waitForSelector(wiz);
  ok(await page.isChecked(`${wiz} input[name="kind"][value="work"]`), 'Change the plan opens on “Add or remove work”');
  await page.fill('#chg-reason', 'The auditors asked for extra checks');
  await next();
  ok(await page.inputValue(`${wiz} input[name="ad_title_0"]`) === 'Extra vendor checks', 'the new task is filled in');
  await next();
  ok(/Needs approval/.test(await page.textContent('[data-chg-verdict]')), 'it needs the sponsor’s approval');
  /* the budget sentence shows exactly when the expected cost after the change is over the budget (R17: the cancelled task
     no longer counts, so whether this add goes over depends on the engine's numbers) */
  const costAfter = Number(((await page.textContent(`${wiz} [data-imp-cost] b`)).match(/\$([\d,]+)\s*$/) || [])[1].replace(/,/g, ''));
  const budgetNow = await page.evaluate(async p => { const { store } = await import('/concepts/pmoflow/app/store.js'); return (store.get('project', p).budget || {}).planned; }, PRJ);
  const bwN = await page.locator(`${wiz} [data-plan-warning="budget"]`).count();
  ok(costAfter > budgetNow ? bwN === 1 && /^This plan is \$[\d,]+ over the \$[\d,]+ budget\.$/.test((await page.textContent(`${wiz} [data-plan-warning="budget"]`)).trim()) : bwN === 0,
    `the preview's budget sentence matches the numbers ($${costAfter} vs the $${budgetNow} budget: ${bwN ? 'over, said in one sentence' : 'within, nothing said'})`);
  await shotBoth('r17-add-over-budget', `${wiz}`);
  await page.click(`${wiz} [data-w="cancel"]`); await settle(200);
  d = await docs();
  ok(!d.workItem.some(x => x.data.title === 'Extra vendor checks'), 'nothing was added without approval');

  console.log('R17: an added dependency knocks on the tasks that wait for it (PMO partial)');
  await page.click('tr[data-wid="W6"] [data-edit-work]'); await page.waitForSelector('.overlay input[name="title"]');
  await page.check('.overlay input[name="deps"][value="W11"]');
  await page.click('.overlay [data-act="save"]');
  await page.waitForSelector('.overlay [data-dep-knock]', { timeout: 10000 }).catch(() => {});
  const dk = (await page.textContent('.overlay [data-dep-knock]').catch(() => '')) || '';
  ok(/now waits for “.+”, so it moves to/.test(dk) && await page.locator('.overlay [data-dep-ko="W7"]').count() === 1, 'the dialog names the tasks that move with it: ' + dk.replace(/\s+/g, ' ').slice(0, 160));
  for (const w of [1366, 390]) { await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 }); await settle(250); ok(await noOverflow(), `dependency dialog: no horizontal overflow at ${w}`); await page.screenshot({ path: `${SHOTS}/r17-dependency-${w}.png` }); }
  await page.setViewportSize({ width: 1440, height: 1000 }); await settle(200);
  const w7before = (await docs()).workItem.find(x => x.id === 'W7').data;
  await page.click('.overlay [data-act="go"]');
  ok(await toastSays(/Dependency added: \d+ tasks moved|Sent for approval/), 'sent as one plan change');
  await settle(800);
  d = await docs();
  const depCh = (d.planChange || []).map(x => x.data).find(c => c.category === 'dependency' && (c.edits || []).some(e => e.id === 'W6' && e.field === 'deps'));
  ok(depCh && depCh.edits.some(e => e.knock && e.id === 'W7'), 'the change moves W7 too (' + (depCh ? depCh.status : 'none') + ')');
  if (depCh && depCh.status === 'applied') ok(d.workItem.find(x => x.id === 'W7').data.start > w7before.start, 'W7 starts later');

  console.log('R17: Waiting for you lists a pending second-Admin confirmation (Jordan re-test 2)');
  const prop = await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js');
    const r = await fetch(`/api/pmoflow/ws/${store.state.ws}/departments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'ta', op: { kind: 'assign', id: 'dept-treasury', personId: 'sk' } }) });
    await store.load(); return [r.status, ((await r.json()) || {}).applied]; });
  ok(prop[0] === 200 && prop[1] === false, 'Tom proposes moving Sam (it waits for a second Admin)');
  await setMe('mc');
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]'); await settle(500);
  const adm = page.locator('[data-waiting] [data-wkind="adminConfirm"]');
  ok(await adm.count() === 1 && /Confirm: .*Sam Keller/.test(await adm.innerText()), 'Maya (the other Admin) sees it in Waiting for you: ' + (await adm.count() ? (await adm.innerText()).replace(/\s+/g, ' ') : 'none'));
  ok(/\/admin(\/departments)?$/.test(await adm.locator('a.btn').getAttribute('href')), 'it opens Admin');
  await shotBoth('r17-waiting-admin', '[data-waiting]');
  await setMe('ta');
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]'); await settle(400);
  ok(await page.locator('[data-waiting] [data-wkind="adminConfirm"]').count() === 0, 'never for the Admin who proposed it');

  console.log('R17: new project on a process another project changes, and a plan over the budget (Jordan, PMO defect 2/4)');
  /* a step done by a role nobody holds yet (Karen's "AP", the PMO director's "Help Desk"), so the plan has an unowned task */
  await setMe('dk');
  await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); const p = JSON.parse(JSON.stringify(store.get('process', 'access-review')));
    const walk = ns => (ns || []).forEach(n => { if (!n) return; if (n.id === 'r2') { n.owner = null; n.ownerRole = 'Audit Liaison'; } (n.branches || []).forEach(b => walk(b && b.nodes)); });
    walk(p.tobe); await store.save('process', p.id, p, 'Step 2 is done by the Audit Liaison'); });
  await setMe('ta');
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]'); await settle(300);
  await page.click('.sect [data-new-project]'); await page.waitForSelector('.overlay #np-from');
  await page.fill('.overlay input[name="name"]', 'Northwind remit-to clean-up');
  await page.selectOption('.overlay #np-from', 'vendor-onboarding');
  await settle(200);
  const ovl = page.locator('.overlay [data-np-overlap]');
  ok(await ovl.isVisible() && /“Vendor Onboarding Modernization” and “ERP Upgrade Readiness” already change this process\. Two projects changing the same steps can clash/.test(await ovl.innerText()), 'the overlap is flagged before the project is created: ' + (await ovl.innerText()).slice(0, 140));
  await page.selectOption('.overlay #np-from', 'access-review');
  await settle(150);
  ok(/Quarterly Access Review Automation/.test(await ovl.innerText()), 'it follows the process picked');
  await page.selectOption('.overlay #np-from', 'vendor-onboarding');
  await page.$eval('.overlay details.pmo-more', el => { el.open = true; });
  await page.fill('.overlay #pf-budget', '1000');
  await shotBoth('r17-new-project-overlap', '.overlay .modal');
  await page.click('.overlay [data-act="create"]');
  await page.waitForSelector('.overlay [data-first-plan]', { timeout: 20000 });
  const bw = page.locator('.overlay [data-plan-warning="budget"]');
  ok(await bw.count() === 1 && /^This plan is \$[\d,]+ over the \$1,000 budget\.$/.test((await bw.innerText()).trim()), 'the first plan says how far over the budget it is: ' + (await bw.count() ? await bw.innerText() : 'none'));
  ok(/Accept anyway/.test(await page.textContent('.overlay [data-act="accept"]')), 'Accept reads “Accept anyway”');
  const capTxt = await page.$$eval('.overlay [data-plan-warning="capacity"]', els => els.map(e => e.textContent));
  ok(capTxt.every(t => /^.+ has [\d.]+ days? of work in \d+ working days? \(room for about [\d.]+\)\.$/.test(t)), 'capacity warnings are one plain sentence each: ' + (capTxt.join(' | ') || 'none'));
  await shotBoth('r17-plan-warnings', '.overlay .modal');
  await page.click('.overlay [data-act="dismiss"]'); await settle(500);
  /* a second project on the process with the role-only step: its plan has an unowned task */
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]'); await settle(300);
  await page.click('.sect [data-new-project]'); await page.waitForSelector('.overlay #np-from');
  await page.fill('.overlay input[name="name"]', 'Northwind access review, phase 2');
  await page.selectOption('.overlay #np-from', 'access-review');
  await page.click('.overlay [data-act="create"]');
  await page.waitForSelector('.overlay [data-first-plan]', { timeout: 20000 });
  const unownedN = Number(await page.getAttribute('.overlay [data-plan-unowned]', 'data-plan-unowned').catch(() => '0')) || 0;
  await page.click('.overlay [data-act="adjust"]');
  await page.waitForSelector('.overlay [data-sg-owner]');
  const blanks = await page.$$eval('.overlay select[data-sg-owner]', els => els.filter(s => s.value === '').map(s => s.options[s.selectedIndex].textContent));
  ok(unownedN >= 1 && blanks.length === unownedN && blanks.every(t => /^Needs an owner/.test(t)), `Adjust: the ${unownedN} unowned task(s) show “Needs an owner”, never a person (${blanks.join(' | ') || 'none unowned'})`);
  await page.click('.overlay [data-act="cancel"]').catch(() => {}); await settle(300);

  ok(errors.length === 0, 'zero console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
