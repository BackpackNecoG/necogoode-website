/* E2E for stream R (round 4): gate evidence independence, cutover runbook, simulated pipeline status, testing depth,
   dialogs that keep input, and SOP import loop-backs / blank owners.
   Main path: access-review-automation passes the gate end to end WITH the data owner's live confirmation, goes live with a
   simulated pipeline failure, rolls back in one click, then goes live again with a succeeding pipeline.
   Usage: node tests/pmoflow/e2e-release.js [port]   (dev server must be running on that port) */
const { chromium } = require('playwright');
const fs = require('fs');

const PORT = Number(process.argv[2] || 8794);
const ROOT = `http://localhost:${PORT}/concepts/pmoflow`;
const SHOTS = '/tmp/pmo-r';
const AR = 'access-review-automation';
const VM = 'vendor-modernization';
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0, failed = 0;
const errors = [];
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ ' + msg); } }

(async () => {
  const browser = await chromium.launch();
  /* fresh context = fresh sandbox; a unique forwarded IP keeps the per-IP daily create limit out of the way */
  const ip = `198.51.100.${1 + ((Math.random() * 250) | 0)}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const settle = (ms) => page.waitForTimeout(ms || 450);
  const shot = name => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const open = async path => { await page.goto(ROOT + path); await page.waitForSelector('#app .hdr', { timeout: 20000 }); await settle(); };
  const setMe = async id => { await page.selectOption('#persona', id); await settle(); };
  const stepUpOk = async () => {
    await page.waitForSelector('.overlay input[name=code]');
    await page.fill('.overlay input[name=code]', '482913');
    await page.click('.overlay [data-act=verify]');
    await page.waitForSelector('.overlay input[name=code]', { state: 'detached' });
    await settle();
  };
  const st = (fn, arg) => page.evaluate(async ([src, a]) => { const { store } = await import('/concepts/pmoflow/app/store.js'); return (new Function('store', 'a', 'return (async () => {' + src + '})()'))(store, a); }, [fn, arg]);
  const rd = p => st(`return window.PMOEngine.readiness(store.state.docs, a, store.state.today);`, p);
  const check = async (p, id) => (await rd(p)).checks.find(c => c.id === id);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const txt = async sel => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ');

  try {
    /* ---------- 1. pending data: fix done, awaiting owner confirmation ---------- */
    console.log('Gate evidence: pending data needs the owner');
    await open('/release/' + AR);
    await st(`
      const de = store.get('dataElement', 'D7'); const d = Object.assign({}, de, { avail: 'example' });
      delete d.liveConfirmedBy; delete d.liveConfirmedAt; delete d.liveSource;
      await store.save('dataElement', 'D7', d, 'Approver matrix moved to the new identity source (e2e)');
      const now = new Date().toISOString();
      await store.save('workItem', 'A9', { id: 'A9', projectId: a, pid: 'access-review', step: 'r2', title: 'Connect approver matrix to the new identity source', owner: 'ps', status: 'done', start: store.state.today, due: store.state.today, doneAt: store.state.today, deps: [], resolves: 'D7', kind: 'build', effortDays: 1, updatedAt: now }, 'Resolver for Approver matrix done (e2e)');
    `, AR);
    await settle(800);
    ok(await st(`return window.PMOEngine.effectiveAvail(store.state.docs, 'D7');`) === 'pending', 'engine: finished resolver alone gives pending');
    await page.click('details[data-check=data-live] summary');
    ok(await page.$('details[data-check=data-live].fail'), 'data-live check fails on pending data');
    const pend = await txt('details[data-check=data-live] .rl-item[data-avail=pending]');
    ok(/Approver matrix/.test(pend) && /Fix done, awaiting Dev Kumar confirmation/.test(pend), 'pending item reads "Fix done, awaiting Dev Kumar confirmation": ' + pend.trim().slice(0, 90));
    ok(/\/data\/D7$/.test(await page.getAttribute('details[data-check=data-live] [data-confirm-link]', 'href')), 'pending item links to the data page');

    /* ---------- 2. sign-off locked until the other checks pass; owner excluded ---------- */
    console.log('Sign-off locked; project owner excluded');
    const r0 = await rd(AR);
    ok(r0.signoffOpen === false, 'engine: signoffOpen is false');
    ok(await page.$('[data-signoff-locked]') && /Sign-off opens when the other checks pass/.test(await txt('[data-signoff-locked]')), 'card says "Sign-off opens when the other checks pass"');
    await setMe('ps');
    ok(await page.$eval('[data-bu="Compliance"] [data-locked]', b => b.disabled) && /Sign-off opens when the other checks pass/.test(await txt('[data-bu="Compliance"] [data-why=locked]')), 'Compliance person sees a locked button with the reason');
    ok(!(await page.$('[data-signoff]')), 'no active sign-off buttons while locked');
    ok(/Dev Kumar approved/.test(await txt('[data-bu="IT"] .rl-signed')), 'existing IT approval still shows');
    await setMe('ta');
    ok(/Project owners can't approve their own release/.test(await txt('[data-bu="IT"] [data-why=owner]')), 'project owner: "Project owners can\'t approve their own release."');
    await shot('01-ar-locked-pending');

    /* ---------- 3. data owner confirms live on the data page ---------- */
    console.log('Owner confirmation');
    await page.click('details[data-check=data-live] [data-confirm-link]');
    await page.waitForSelector('[data-confirm-card]'); await settle();
    ok(/\/data\/D7/.test(page.url()) && await page.$('[data-confirm-card]'), 'link opens the data page with its Confirm live card');
    await setMe('ps');
    ok(await page.$eval('[data-confirm-live]', b => b.disabled), 'a non-owner cannot confirm live');
    await setMe('dk');
    await page.click('[data-confirm-live]');
    await page.waitForSelector('.overlay input[name=source]');
    await page.fill('.overlay input[name=source]', 'Identity platform approver API (read)');
    await page.click('.overlay [data-act=confirm]'); await settle(900);
    ok(await st(`const d = store.get('dataElement', 'D7'); return d.avail === 'live' && d.liveConfirmedBy === 'dk' && !!d.liveSource;`), 'D7 confirmed live by its owner with a source');
    await open('/release/' + AR);
    ok((await check(AR, 'data-live')).pass && await page.$('details[data-check=data-live].pass'), 'data-live passes after the owner confirms');

    /* ---------- 4. cutover runbook ---------- */
    console.log('Cutover runbook');
    await setMe('ta');
    ok(await page.$('#cutover [data-runbook-empty]'), 'seeded plan has no runbook yet');
    ok(/at least one runbook task/.test(await txt('#cutover .rl-co-st')), 'cutover card asks for at least one runbook task');
    await page.click('[data-cutover-edit]');
    await page.waitForSelector('.overlay [data-trow]');
    const fillTask = async (i, task, owner, when, gng) => {
      const row = `.overlay [data-trow] >> nth=${i}`;
      await page.fill(`${row} >> [data-tt]`, task);
      await page.selectOption(`${row} >> [data-to]`, owner);
      await page.fill(`${row} >> [data-tp]`, when);
      if (gng) await page.check(`${row} >> [data-tg]`);
    };
    await fillTask(0, 'Freeze manual access changes', 'dk', '2026-11-14T08:00', false);
    await page.click('.overlay [data-tadd]');
    await fillTask(1, 'Go/no-go call with Compliance', 'ps', '2026-11-14T08:30', true);
    await page.click('.overlay [data-tadd]');
    await fillTask(2, 'Enable the auto-removal job', 'dk', '2026-11-14T09:00', false);
    await page.click('.overlay [data-trow] >> nth=2 >> [data-tup]');
    ok((await page.$$eval('.overlay [data-tt]', els => els.map(e => e.value))).join('|') === 'Freeze manual access changes|Enable the auto-removal job|Go/no-go call with Compliance', 'tasks can be re-sequenced');
    await page.click('.overlay [data-trow] >> nth=1 >> [data-tdn]');
    await page.fill('.overlay input[name=hypercareDays]', '120');
    await page.click('.overlay [data-act=save]'); await settle(300);
    ok(await page.$('.overlay [data-err]:not([hidden])') && /0 to 90/.test(await txt('.overlay [data-err]')), 'invalid hypercare days: dialog stays open with an inline error');
    ok((await page.$$eval('.overlay [data-tt]', els => els.map(e => e.value))).length === 3, 'runbook rows kept after the validation error');
    await page.fill('.overlay input[name=hypercareDays]', '10');
    await page.click('.overlay [data-act=save]'); await settle(1000);
    const tasks = await st(`return store.get('project', a).cutover.tasks;`, AR);
    ok(tasks.length === 3 && tasks.map(t => t.order).join() === '1,2,3' && tasks[1].gonogo && tasks[1].owner === 'ps' && tasks[2].task === 'Enable the auto-removal job' && /^2026-11-14T08:30/.test(tasks[1].planned), 'runbook saved in order with owner, planned time and go/no-go');
    ok((await page.$$('#cutover [data-runbook] li')).length === 3 && await page.$('#cutover [data-runbook] li.gng'), 'runbook rendered with the go/no-go task marked');
    ok(/Gate item satisfied/.test(await txt('#cutover .rl-co-st')), 'cutover card satisfied');
    ok((await check(AR, 'cutover-plan')).pass, 'cutover-plan check passes');

    /* ---------- 5. finish the work: sign-off opens ---------- */
    console.log('Sign-off opens');
    await st(`const w = store.get('workItem', 'A4'); await store.save('workItem', 'A4', Object.assign({}, w, { status: 'done', doneAt: store.state.today, updatedAt: new Date().toISOString() }), 'Dry-run certification done (e2e)');`);
    await settle(800);
    const r1 = await rd(AR);
    ok(r1.signoffOpen === true, 'engine: signoffOpen true once the other checks pass');
    ok(!(await page.$('[data-signoff-locked]')), 'lock banner gone');
    await setMe('ta');
    ok(!(await page.$('[data-bu="Compliance"] [data-signoff]')) && await page.$('[data-bu="Compliance"] [data-why=owner]'), 'project owner still cannot sign off');
    /* IT approval went stale because the resolver work touched... only if engine says so; re-approve any stale section */
    await setMe('ps');
    await page.click('[data-bu="Compliance"] [data-signoff=approved]');
    await stepUpOk();
    const staleBus = await page.$$eval('.rl-bu.stale', els => els.map(e => e.dataset.bu));
    for (const bu of staleBus) { const who = bu === 'IT' ? 'dk' : 'ps'; await setMe(who); await page.click(`[data-bu="${bu}"] [data-signoff=approved]`); await stepUpOk(); }
    const r2 = await rd(AR);
    ok(r2.pass, 'access-review gate passes: ' + r2.checks.filter(c => c.status === 'fail').map(c => c.id).join(','));
    ok(await page.$('[data-gate=pass]'), 'gate shows PASS');
    ok(/2 distinct approvers/.test(await txt('.rl-two')), 'two-person: Dev Kumar and Priya Shah');
    await shot('02-ar-pass');

    /* ---------- 6. dialogs keep input: access request expiry over 30 days ---------- */
    console.log('Dialogs keep input');
    await setMe('ps');
    await page.click('[data-request]');
    await page.waitForSelector('.overlay select[name=dataId]');
    await page.selectOption('.overlay select[name=env]', 'uat');
    await page.selectOption('.overlay select[name=access]', 'write');
    await page.fill('.overlay textarea[name=reason]', 'Load test certifications');
    const far = await st(`const d = new Date(store.state.today + 'T12:00:00'); d.setDate(d.getDate() + 45); return d.toISOString().slice(0, 10);`);
    await page.fill('.overlay input[name=expires]', far);
    await page.click('.overlay [data-act=send]'); await settle(300);
    ok(await page.$('.overlay') && /within the next 30 days/.test(await txt('.overlay [data-err]')), 'expiry over 30 days: dialog stays open with the error inline');
    const kept = await page.evaluate(() => ({ env: document.querySelector('.overlay [name=env]').value, access: document.querySelector('.overlay [name=access]').value, reason: document.querySelector('.overlay [name=reason]').value, inv: document.querySelector('.overlay [name=expires]').getAttribute('aria-invalid') }));
    ok(kept.env === 'uat' && kept.access === 'write' && kept.reason === 'Load test certifications' && kept.inv === 'true', 'every value kept; the expiry field is flagged');
    await shot('03-dialog-error');
    await page.click('.overlay [data-act=cancel]'); await settle();
    ok(!(await st(`return store.list('grant', g => g.projectId === a && g.status === 'requested').length;`, AR)), 'nothing saved on cancel; gate still clean');

    /* ---------- 7. go-live with a simulated pipeline failure, then one-click rollback ---------- */
    console.log('Go-live: simulated failure, rollback');
    await setMe('ta');
    const v0 = await st(`return store.get('process', 'access-review').version;`);
    await page.click('[data-golive]');
    await page.waitForSelector('.overlay [data-golive-runbook]');
    ok((await page.$$('.overlay [data-golive-runbook] [data-runbook] li')).length === 3, 'go-live dialog shows the runbook as a checklist');
    ok(/Simulate failure/.test(await txt('.overlay .rl-simfail')), 'confirm dialog has a "Simulate failure" toggle');
    await page.check('.overlay [data-simfail]');
    await page.click('.overlay [data-act=go]');
    await stepUpOk();
    await page.waitForSelector('[data-pipe-phase=queued]', { timeout: 15000 });
    ok(true, 'pipeline shows queued');
    ok(/Simulated pipeline/.test(await txt('[data-pipe-phase]')), 'pipeline labelled as simulated');
    await page.waitForSelector('[data-pipe-phase=running]', { timeout: 5000 });
    ok(true, 'pipeline animates to running');
    await shot('04-pipeline-running');
    await page.waitForSelector('[data-pipeline-failed]', { timeout: 8000 }); await settle(800);
    ok(await page.$('[data-pipe-phase=failed]') && await page.$('[data-pipe-error]'), 'pipeline ends failed with the failure shown');
    const relF = await st(`return store.list('release', r => r.projectId === a && r.kind !== 'rollback').sort((x, y) => y.at.localeCompare(x.at))[0];`, AR);
    ok(relF.status === 'failed' && relF.pipeline && relF.pipeline.status === 'failed' && relF.pipeline.log.map(x => x.phase).join('>') === 'queued>running>failed', 'release.status = failed, phases logged');
    ok(await st(`return store.get('process', 'access-review').version;`) === v0 + 1, 'go-live promoted the process');
    ok(await page.$('#cutover [data-runbook].check'), 'after go-live the runbook is a checklist');
    await shot('05-pipeline-failed');
    await page.click('[data-rollback-now]');
    await stepUpOk();
    await page.waitForSelector('.rl-latest [data-kind=rollback]', { timeout: 20000 }); await settle(800);
    ok(await st(`return store.get('project', a).status;`, AR) === 'active' && await st(`return store.get('process', 'access-review').version;`) === v0, 'one-click rollback restored the previous version');
    ok(!(await page.$('[data-pipeline-failed]')), 'failure banner cleared after rollback');
    const rbRel = await st(`return store.list('release', r => r.projectId === a && r.kind === 'rollback')[0];`, AR);
    ok(/Deployment pipeline failed/.test(rbRel.reason || ''), 'rollback reason records the pipeline failure');

    /* ---------- 8. go-live again: pipeline succeeds; tick the runbook ---------- */
    console.log('Go-live: succeeded');
    await settle(500);
    let r3 = await rd(AR);
    if (!r3.pass) {
      const stale = await page.$$eval('.rl-bu.stale, .rl-bu.pending', els => els.map(e => e.dataset.bu));
      for (const bu of stale) { await setMe(bu === 'IT' ? 'dk' : 'ps'); await page.click(`[data-bu="${bu}"] [data-signoff=approved]`); await stepUpOk(); }
      r3 = await rd(AR);
    }
    ok(r3.pass, 'gate passes again after rollback');
    await setMe('ta');
    await page.click('[data-golive]');
    await page.waitForSelector('.overlay [data-simfail]');
    await page.click('.overlay [data-act=go]');
    await stepUpOk();
    await page.waitForSelector('[data-pipe-phase=queued]', { timeout: 15000 });
    await page.waitForSelector('[data-pipe-phase=succeeded]', { timeout: 15000 });
    await page.waitForFunction(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); return store.list('release').some(r => r.projectId === 'access-review-automation' && r.status === 'succeeded'); }, null, { timeout: 10000 }); await settle(800);
    const relS = await st(`return store.list('release', r => r.projectId === a && r.kind !== 'rollback').sort((x, y) => y.at.localeCompare(x.at))[0];`, AR);
    ok(relS.status === 'succeeded' && relS.actions.find(x => x.type === 'pipeline').status === 'succeeded', 'pipeline succeeded and saved on the release');
    ok(!(await page.$('[data-pipeline-failed]')), 'no failure banner');
    await setMe('ps');
    const gngId = tasks[1].id;
    ok(await page.$eval(`[data-rb-done="${tasks[0].id}"]`, c => c.disabled), "a task owned by someone else can't be ticked by Priya");
    await page.check(`[data-rb-done="${gngId}"]`); await settle(900);
    ok(await st(`return store.get('project', a).cutover.tasks.find(t => t.id === a2).done;`.replace('a2', JSON.stringify(gngId)), AR), 'task owner ticked her go/no-go task');
    ok(/1\/3 done/.test(await txt('[data-runbook-progress]')), 'runbook progress shows 1/3 done');
    await page.reload(); await page.waitForSelector('#cutover'); await settle(1000);
    ok(await page.$eval(`[data-rb-done="${gngId}"]`, c => c.checked), 'ticked task persists after reload');
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('[data-rl-history]').textContent), null, { timeout: 10000 });
    const audit = await txt('[data-rl-history]');
    ok(/Deployment pipeline failed/.test(audit) && /Deployment pipeline succeeded/.test(audit) && /Completed cutover task/.test(audit), 'gate audit log shows both pipeline outcomes and the runbook tick');
    await shot('06-ar-released');

    /* ---------- 9. BU sections from touches tags (vendor modernization) ---------- */
    console.log('BU sections from touches tags');
    await open('/release/' + VM);
    ok(await page.$('[data-bu="Compliance"] [data-via-tag]') && /tag: Compliance/.test(await txt('[data-bu="Compliance"]')), 'Compliance section includes a step owned by Procurement via its touches tag');
    ok(await page.$('[data-bu="Compliance"] [data-tagnote]'), 'section explains which steps came from tags');
    const engSec = await check(VM, 'bu-signoff');
    ok(engSec && /Compliance/.test(JSON.stringify(engSec)), 'engine bu-signoff includes the Compliance section');
    await shot('07-vm-tags');

    /* ---------- 10. testing depth (vendor modernization) ---------- */
    console.log('Testing: profile cases, ids, testers');
    await setMe('ta');
    await open(`/testing/${VM}?de=D2`);
    await page.click('[data-prof-sample]');
    await page.waitForSelector('.ts-driftsum, .ts-ok', { timeout: 15000 }); await settle();
    await page.click('[data-gen]'); await page.waitForSelector('.toast >> text=/Generated \\d+ test case/', { timeout: 60000 }); await settle(800);
    const nProf = await page.$$eval('#cases tr[data-origin-row=profile]', r => r.length);
    ok(nProf > 0 && await page.$('[data-profile-cases]'), `profile-derived cases shown (${nProf}) with an explanation`);
    await page.click('[data-origin=profile]'); await settle();
    ok((await page.$$('#cases tr[data-origin-row]')).length === nProf && !(await page.$('#cases tr[data-origin-row=spec]')), 'origin filter shows only profile cases');
    await page.click('[data-origin=all]'); await settle();
    const firstCase = await page.$eval('#cases tr[data-case]', r => r.dataset.case);
    ok(/tc-/.test(await txt(`#cases tr[data-case="${firstCase}"] .ts-id`)), 'case ids are visible in the table');
    await page.selectOption('select[name=bulkTester]', 'ar');
    await page.click('[data-bulk-assign]'); await page.waitForSelector('.toast >> text=/assigned to Ana Ruiz/', { timeout: 60000 }); await settle(800);
    ok(await st(`return store.list('testCase', c => c.dataId === 'D2').every(c => c.tester === 'ar');`), 'bulk-assigned every D2 case to Ana Ruiz');
    ok(await page.$(`#cases tr[data-case="${firstCase}"] [data-tester=ar]`), 'tester shown in the table');
    for (const d of await page.$$eval('.ts-list [data-de]', as => as.map(a => a.dataset.de))) {
      if (d === 'D2' || d === 'D8') continue;
      await page.click(`.ts-list [data-de="${d}"]`); await settle(300);
      await page.click('[data-gen]'); await page.waitForSelector('.toast >> text=/Generated \\d+ test case|No new test cases/', { timeout: 60000 }); await settle(500);
    }

    console.log('Custom case on an element without a spec');
    await st(`const d = store.get('dataElement', 'D8'); await store.save('dataElement', 'D8', Object.assign({}, d, { fields: [] }), 'Spec cleared (e2e)');`);
    await page.click('.ts-list [data-de="D8"]'); await settle();
    await page.click('[data-add-case]');
    await page.waitForSelector('.overlay [data-nospec]');
    await page.fill('.overlay input[name=field]', '');
    await page.click('.overlay [data-act=save]'); await settle(300);
    ok(await page.$('.overlay') && /Name the field/.test(await txt('.overlay [data-err]')), 'blank field name: dialog stays open with an inline error');
    await page.fill('.overlay input[name=input]', 'Tier 4');
    await page.fill('.overlay input[name=field]', 'Risk tier');
    await page.selectOption('.overlay select[name=expect]', 'reject');
    await page.selectOption('.overlay select[name=tester]', 'ps');
    await page.click('.overlay [data-act=save]'); await settle(900);
    ok(await st(`return store.list('testCase', c => c.dataId === 'D8' && c.field === 'Risk tier' && c.input === 'Tier 4' && c.tester === 'ps' && c.origin === 'user').length === 1;`), 'custom case saved with a free-text field and a tester (input kept after the error)');

    console.log('Multi-step UAT scripts and testers');
    await page.click('[data-adopt]'); await settle(1200);
    const scripts = await st(`return store.get('project', a).uatScripts;`, VM);
    const multi = scripts.find(s => (s.steps || []).length > 1);
    ok(scripts.length && scripts.every(s => Array.isArray(s.steps) && s.steps.length) && multi, `adopted scripts keep the engine's steps (${multi && multi.steps.length} steps on “${multi && multi.title}”)`);
    ok(/uat-/.test(await txt(`[data-script="${scripts[0].id}"] .ts-id`)), 'script ids are visible');
    await page.click(`[data-script="${multi.id}"] summary`); await settle();
    await page.selectOption(`[data-script-tester="${multi.id}"]`, 'ps'); await settle(900);
    ok(await st(`return store.get('project', a).uatScripts.find(s => s.id === a2).tester === 'ps';`.replace('a2', JSON.stringify(multi.id)), VM), 'tester assigned on a script');

    console.log('Planned test cycle with testers');
    await page.click('[data-add-cycle]');
    await page.waitForSelector('.overlay input[name=name]');
    await page.fill('.overlay input[name=name]', 'UAT cycle 1');
    await page.click('.overlay [data-act=save]'); await settle(300);
    ok(/Name at least one tester/.test(await txt('.overlay [data-err]')) && (await page.inputValue('.overlay input[name=name]')) === 'UAT cycle 1', 'cycle without testers: error inline, name kept');
    await page.check('.overlay input[name=testers][value=ps]');
    await page.check('.overlay input[name=testers][value=ar]');
    await page.click('.overlay [data-act=save]'); await settle(1000);
    const cyc = await st(`return (store.get('project', a).testCycles || [])[0];`, VM);
    ok(cyc && cyc.env === 'uat' && cyc.testers.join() === 'ps,ar' && cyc.start && cyc.end, 'cycle planned: UAT, dates, testers Priya and Ana');
    ok(await page.$(`[data-cycle-id="${cyc.id}"] [data-tester-progress=ps]`) && await page.$(`[data-cycle-id="${cyc.id}"] [data-tester-progress=ar]`), 'per-tester progress shown');

    /* record a UAT run in the cycle: every case passes, the multi-step script fails on its last step, the rest pass */
    await page.click(`[data-cycle-run="${cyc.id}"]`);
    await page.waitForSelector('.overlay .ts-case');
    ok(await page.inputValue('.overlay [data-cycle-sel]') === cyc.id && await page.inputValue('.overlay [data-env]') === 'uat', 'record dialog preselects the cycle and its env');
    await page.evaluate(sid => {
      document.querySelectorAll('.overlay .ts-case').forEach(row => { if (row.closest('[hidden]')) return; row.querySelectorAll('select').forEach(s => { s.value = 'pass'; }); });
      const row = document.querySelector(`.overlay [data-row="s:${sid}"]`); const sels = row.querySelectorAll('[data-step-row] select'); sels[sels.length - 1].value = 'fail';
      row.querySelectorAll('[data-step-row] input')[sels.length - 1].value = 'Escalation email not sent';
      document.querySelector('.overlay .ts-cases').dispatchEvent(new Event('change', { bubbles: true }));
    }, multi.id);
    const stepSelects = await page.$$eval(`.overlay [data-row="s:${multi.id}"] [data-step-row]`, r => r.length);
    ok(stepSelects === multi.steps.length, `script recorded step by step (${stepSelects} step rows)`);
    await page.click('.overlay [data-act=save]');
    await page.waitForSelector('.overlay .ts-mk', { timeout: 10000 });
    await page.click('.overlay [data-act=create]'); await settle(1500);
    const def = await st(`return store.list('workItem', w => w.projectId === a && w.kind === 'defect' && w.status !== 'done' && w.testRef && w.testRef.scriptId === a2)[0];`.replace('a2', JSON.stringify(multi.id)), VM);
    ok(!!def, 'defect created for the failing script');
    const cycTxt = await txt(`[data-cycle-id="${cyc.id}"] [data-cycle-progress]`);
    ok(/fail/.test(cycTxt) && /(\d+)\/\1 run/.test(cycTxt), 'cycle progress shows all items run with a failure: ' + cycTxt.trim());
    const arProg = await txt(`[data-cycle-id="${cyc.id}"] [data-tester-progress=ar]`);
    ok(/(\d+)\/\1/.test(arProg) && !/ 0\/0/.test(arProg), 'Ana Ruiz progress counts her assigned cases: ' + arProg.trim());

    console.log('Passing retest closes linked defects');
    await page.click('[data-retest=uat]');
    await page.waitForSelector('.overlay [data-script-row]');
    ok((await page.$$('.overlay [data-script-row]')).length === 1 && await page.inputValue('.overlay [data-cycle-sel]') === cyc.id, 'retest has only the failed script and stays in the cycle');
    await page.evaluate(() => { document.querySelectorAll('.overlay [data-script-row] select').forEach(s => { s.value = 'pass'; }); });
    await page.click('.overlay [data-act=save]');
    await page.waitForSelector('.overlay [data-close-offer]', { timeout: 10000 });
    ok(/close 1 linked defect/.test(await txt('.overlay h2')), 'passing retest offers to close the linked defect');
    await page.click('.overlay [data-act=close]'); await settle(1500);
    ok(await st(`const w = store.get('workItem', a); return w.status === 'done' && /Retest passed/.test(w.fixNote);`, def.id), 'linked defect closed with the passing run as proof');
    const tp = await check(VM, 'tests-passed');
    ok(!/defect/i.test(tp.detail) || tp.pass || !/open defect/i.test(tp.detail), 'tests-passed no longer cites the open defect: ' + tp.detail);

    console.log('JUnit: id or title; coverage keeps earlier passes');
    const devCases = await st(`const E = window.PMOEngine; const ids = new Set(); store.get('project', a).processes.forEach(p => E.flatSteps(store.get('process', p).tobe).forEach(s => (s.data || []).forEach(d => ids.add(d)))); return store.list('testCase', c => ids.has(c.dataId)).map(c => ({ id: c.id, field: c.field, kind: c.kind }));`, VM);
    /* first CI run: everything by id */
    const xml1 = `<testsuite name="vendor-full">${devCases.map(c => `<testcase classname="northwind.vendor" name="${c.id} validates"/>`).join('')}</testsuite>`;
    await page.click('[data-ci]'); await page.waitForSelector('.overlay [data-ci-xml]');
    await page.fill('.overlay [data-ci-xml]', xml1); await page.click('.overlay [data-act=import]'); await settle(1500);
    const devFull = (await txt('[data-cov=dev]')).trim();
    ok(/^(\d+)\/\1/.test(devFull), 'dev coverage complete after the full CI import: ' + devFull);
    /* second CI run: partial, matched by title (field + kind, case and punctuation varied) and one script by title */
    const tc = devCases.find(c => c.kind === 'boundary') || devCases[0];
    const titleName = `${tc.field.toUpperCase()} -- ${tc.kind}!`;
    const xml2 = `<testsuite name="vendor-partial"><testcase classname="ci" name="${titleName}"><failure message="Boundary rejected"/></testcase><testcase classname="ci" name="${multi.title.toLowerCase().replace(/ /g, '_')}"/><testcase classname="ci" name="unrelated smoke test"/></testsuite>`;
    await page.click('[data-ci]'); await page.waitForSelector('.overlay [data-ci-xml]');
    await page.fill('.overlay [data-ci-xml]', xml2); await page.click('.overlay [data-act=import]');
    await page.waitForSelector('.overlay .ts-mk', { timeout: 10000 }); await page.click('.overlay [data-act=cancel]'); await settle(1500);
    const ci2 = await st(`return store.list('testRun', r => r.projectId === a && r.ciSuite === 'vendor-partial')[0];`, VM);
    const tHit = ci2 && ci2.results.find(x => x.caseId);
    ok(tHit && tHit.matchedBy === 'title' && (await st(`const c = store.get('testCase', a); return c.field + '|' + c.kind;`, tHit.caseId)) === tc.field + '|' + tc.kind, `JUnit "${titleName}" matched a ${tc.field} ${tc.kind} case by title`);
    ok(ci2.results.some(x => x.scriptId === multi.id && x.matchedBy === 'title') && ci2.ciUnmatched === 1, 'script matched by its title (underscores, lower case); 1 unmatched');
    const devAfter = (await txt('[data-cov=dev]')).trim();
    ok(devAfter.split(' ')[0].split('/')[0] === devFull.split(' ')[0].split('/')[0] && /1 fail/.test(devAfter), 'partial CI import keeps earlier passes in coverage (only the new fail changes): ' + devAfter);
    await shot('08-testing-vm');

    console.log('Test history is per project');
    await open('/testing/' + AR);
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('[data-ts-history]').textContent), null, { timeout: 10000 }); await settle(500);
    const hist = await txt('[data-ts-history]');
    ok(!/Vendor|vendor-partial|UAT cycle 1|Bank remittance/.test(hist), 'access-review test history has no vendor-modernization activity');
    await open('/testing/' + VM);
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('[data-ts-history]').textContent), null, { timeout: 10000 }); await settle(500);
    ok(/vendor-partial|test cycle/i.test(await txt('[data-ts-history]')), 'vendor-modernization history shows its own test activity');
    await page.reload(); await page.waitForSelector('#cycles'); await settle(1200);
    ok(await page.$(`[data-cycle-id="${cyc.id}"]`) && await page.$(`[data-run-cycle="${cyc.id}"]`), 'cycle and its runs persist after reload');

    /* ---------- 11. import: loop-backs and blank owners ---------- */
    console.log('Import SOP: loop-backs and owners');
    await setMe('mc');
    await open('/import');
    const sop = `# Northwind Traders — Expense Claim SOP
Purpose: reimburse approved business expenses.
The process starts when an employee submits an expense claim.

1. The employee submits the expense claim with receipts in the expense portal.
2. Accounts Payable checks the receipts against the expense policy.
3. If receipts are missing, the employee must resubmit and return to step 1.
4. The courier archives the paper receipts offsite.
5. Treasury schedules the reimbursement payment.`;
    await page.fill('[data-sop]', sop);
    await page.click('[data-draft]');
    await page.waitForSelector('.is-step', { timeout: 30000 }); await settle();
    ok(await page.$('[data-loopback]') && /Loops back to/.test(await txt('.is-goto.on')), 'loop-back rendered: ' + (await txt('.is-goto.on')).trim().slice(0, 80));
    const noOwn = await page.$$('[data-noowner]');
    ok(noOwn.length >= 1 && await page.$('[data-owner-prompt]'), `unmatched owners left blank and highlighted (${noOwn.length}) with a prompt to choose`);
    ok(!(await page.$$eval('[data-noowner]', els => els.some(e => e.value))), 'blank owners are not guessed');
    await shot('09-import-loop');
    /* choose an owner for the first blank one; the prompt count drops */
    const before = noOwn.length;
    await page.selectOption('[data-noowner] >> nth=0', 'mc'); await settle();
    ok((await page.$$('[data-noowner]')).length === before - 1, 'choosing an owner clears its highlight');
    await page.click('[data-create]');
    await page.waitForSelector('.overlay input[name=name]');
    if (before - 1 > 0) ok(await page.$('.overlay [data-create-noowner]'), 'create dialog reminds about steps without owners');
    await page.fill('.overlay input[name=name]', 'Expense claims (imported)');
    await page.click('.overlay [data-act=create]');
    await page.waitForURL(/\/process\/proc-[\w-]+\?mode=edit/, { timeout: 15000 });
    const newPid = page.url().match(/process\/([\w-]+)/)[1];
    await settle(1000);
    const loop = await st(`const p = store.get('process', a); const all = []; const walk = ns => ns.forEach(n => { all.push(n); (n.branches || []).forEach(b => walk(b.nodes)); }); walk(p.asis);
      const g = p.asis.find(n => (n.branches || []).some(b => b.goto)); const b = g && g.branches.find(x => x.goto);
      const tg = p.tobe.find(n => (n.branches || []).some(x => x.goto)); const tb = tg && tg.branches.find(x => x.goto);
      return { ok: !!b && all.some(n => n.id === b.goto), tobe: !!tb && p.tobe.some(n => n.id === tb.goto) };`, newPid);
    ok(loop.ok && loop.tobe, 'loop-back persisted with goto pointing at real as-is and to-be node ids');

    /* ---------- 12. widths ---------- */
    console.log('Widths');
    for (const [w, h] of [[1440, 1000], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const p of ['/release/' + AR, '/release/' + VM, '/testing/' + VM, '/import']) {
        await open(p);
        if (p === '/import') { await page.click('[data-sample]'); await page.click('[data-draft]'); await page.waitForSelector('.is-step', { timeout: 30000 }); await settle(); }
        ok(await overflow(), `no horizontal overflow at ${w}: ${p}`);
        if (w === 390) await shot('m-' + p.replace(/\//g, '_').replace(/^_/, ''));
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await setMe('ta');
    await open('/release/' + VM);
    await page.click('[data-cutover-edit]'); await page.waitForSelector('.overlay [data-trow]'); await settle(300);
    ok(await overflow(), 'no overflow at 390 with the runbook editor open');
    await page.screenshot({ path: `${SHOTS}/m-runbook-modal.png` });
    await page.click('.overlay [data-act=cancel]');
    await open('/testing/' + VM);
    await page.click('[data-add-cycle]'); await page.waitForSelector('.overlay input[name=name]'); await settle(300);
    ok(await overflow(), 'no overflow at 390 with the cycle dialog open');
    await page.click('.overlay [data-act=cancel]');
    await page.setViewportSize({ width: 1440, height: 1000 });
  } catch (e) {
    failed++; console.log('  ✗ threw: ' + (e && e.stack || e));
    try { await shot('zz-failure'); } catch (x) { /* ignore */ }
  }

  ok(errors.length === 0, 'zero page/console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' || ') : ''));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
