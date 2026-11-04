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
  let expect403 = false; /* intentional permission probes: the browser logs the refused request */
  page.on('console', m => { if (m.type() === 'error' && !(expect403 && /403 \(Forbidden\)/.test(m.text()))) errors.push('console: ' + m.text()); });

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
  const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
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
    ok(/Project owners can't approve their own release/.test(await txt('[data-bu="Compliance"] [data-why=owner]')), 'project owner: "Project owners can\'t approve their own release."');
    await shot('01-ar-locked-pending');

    /* ---------- 3. data owner confirms live with attested evidence (gate warns) ---------- */
    console.log('Owner confirmation; attested evidence warns');
    ok(/Tom Alvarez/.test(await txt('[data-rm]')) && await page.$('[data-rm=ta]'), 'release manager shown in the header: Tom Alvarez (defaults to the PM)');
    await page.click('details[data-check=data-live] [data-confirm-link]');
    await page.waitForSelector('[data-confirm-card]'); await settle();
    ok(/\/data\/D7/.test(page.url()) && await page.$('[data-confirm-card]'), 'link opens the data page with its Confirm live card');
    await setMe('dk');
    await page.click('[data-confirm-live]');
    await page.waitForSelector('.overlay input[name=source]');
    await page.fill('.overlay input[name=source]', 'Identity platform approver API (read)');
    await page.check('.overlay input[name=ev][value=attested]');
    await page.fill('.overlay input[name=evlink]', 'https://wiki.northwind.example/identity/approver-feed');
    await page.fill('.overlay input[name=evnote]', 'Screenshot of the approver feed in UAT');
    await page.click('.overlay [data-act=confirm]'); await settle(900);
    ok(await st(`const d = store.get('dataElement', 'D7'); return d.liveConfirmedBy === 'dk' && d.liveEvidence && d.liveEvidence.type === 'attested';`), 'D7 confirmed live by its owner with attested evidence');
    await open('/release/' + AR);
    ok((await check(AR, 'data-live')).pass, 'data-live passes on attested evidence');
    await page.click('details[data-check=data-live] summary');
    ok(await page.$('[data-evidence=D7][data-ev-type=attested].warn') && /weaker/.test(await txt('[data-evidence=D7]')), 'gate evidence list: Approver matrix is attested, shown as a warning');
    /* now prove it with a connection check: strong evidence */
    await st(`const r = await store.api('/check/D7'); const d = store.get('dataElement', 'D7'); await store.save('dataElement', 'D7', Object.assign({}, d, { check: { ok: r.ok, at: r.at, detail: r.detail }, liveEvidence: { type: 'check', ref: r.at, at: r.at, by: 'dk' } }), 'Approver matrix evidence: connection check (e2e)'); await store.load();`);
    await settle(600);
    ok(await page.$('[data-evidence=D7][data-ev-type=check].pass'), 'after a passing connection check the evidence is strong (check)');
    await shot('02a-evidence');

    /* ---------- 4. cutover runbook: go/no-go needs an owner ---------- */
    console.log('Cutover runbook');
    await setMe('ta');
    ok(await page.$('#cutover [data-runbook-empty]'), 'seeded plan has no runbook yet');
    await page.click('[data-cutover-edit]');
    await page.waitForSelector('.overlay [data-trow]');
    const fillTask = async (i, task, owner, when, gng) => {
      const row = `.overlay [data-trow] >> nth=${i}`;
      await page.fill(`${row} >> [data-tt]`, task);
      if (owner) await page.selectOption(`${row} >> [data-to]`, owner);
      await page.fill(`${row} >> [data-tp]`, when);
      if (gng) await page.check(`${row} >> [data-tg]`);
    };
    await fillTask(0, 'Freeze manual access changes', 'dk', '2026-11-14T08:00', false);
    await page.click('.overlay [data-tadd]');
    await fillTask(1, 'Go/no-go call with Compliance', '', '2026-11-14T08:30', true);
    await page.click('.overlay [data-tadd]');
    await fillTask(2, 'Enable the auto-removal job', 'dk', '2026-11-14T09:00', false);
    await page.click('.overlay [data-act=save]'); await settle(300);
    ok(await page.$('.overlay [data-err]:not([hidden])') && /go\/no-go check, so it needs an owner/.test(await txt('.overlay [data-err]')), 'go/no-go task without an owner: dialog stays open with the reason');
    await page.selectOption('.overlay [data-trow] >> nth=1 >> [data-to]', 'ps');
    await page.click('.overlay [data-act=save]'); await settle(1000);
    const tasks = await st(`return store.get('project', a).cutover.tasks;`, AR);
    const gngId = tasks[1].id;
    ok(tasks.length === 3 && tasks[1].gonogo && tasks[1].owner === 'ps' && /^2026-11-14T08:30/.test(tasks[1].planned), 'runbook saved in order; the go/no-go task is owned by Priya Shah');
    ok(!!(await st(`return store.get('project', a).cutoverUpdatedAt;`, AR)), 'cutover edit stamps cutoverUpdatedAt');
    ok((await check(AR, 'cutover-plan')).pass, 'cutover-plan check passes');
    ok(await page.$eval(`[data-rb-done="${gngId}"]`, c => c.disabled) && /Only Priya Shah can confirm/.test(await txt(`[data-rbtask="${gngId}"]`)), "the PM can't tick Priya's go/no-go task; the runbook says only she can");

    /* ---------- 5. finish the work; go/no-go confirmed by its owner; sign-off ---------- */
    console.log('Go/no-go and sign-off');
    await st(`const w = store.get('workItem', 'A4'); await store.save('workItem', 'A4', Object.assign({}, w, { status: 'done', doneAt: store.state.today, updatedAt: new Date().toISOString() }), 'Dry-run certification done (e2e)');`);
    await settle(800);
    await setMe('ps');
    await page.check(`[data-rb-done="${gngId}"]`); await settle(1000);
    ok(await st(`const t = store.get('project', a).cutover.tasks.find(x => x.id === ${JSON.stringify(gngId)}); return t.done && t.doneBy === 'ps';`, AR), 'Priya confirmed her own go/no-go task (server accepted the owner tick)');
    const r1 = await rd(AR);
    ok(r1.signoffOpen === true, 'engine: signoffOpen true once the other checks pass');
    /* the release manager can't sign a BU section */
    await setMe('ta');
    await st(`const p = store.get('project', a); await store.save('project', a, Object.assign({}, p, { releaseManager: 'ps' }), 'Release manager set to Priya Shah (e2e)');`, AR); await settle(700);
    await setMe('ps');
    ok(await page.$('[data-bu="Compliance"] [data-why=rm]') && !(await page.$('[data-bu="Compliance"] [data-signoff=approved]')), "release manager (Priya) can't sign the Compliance section; the card says why");
    await setMe('ta');
    await st(`const p = store.get('project', a); await store.save('project', a, Object.assign({}, p, { releaseManager: 'mc' }), 'Release manager set to Maya Chen (e2e)');`, AR); await settle(700);
    ok(/Maya Chen/.test(await txt('[data-rm]')), 'header shows the new release manager, Maya Chen');
    const signAll = async () => {
      for (let k = 0; k < 3; k++) {
        const need = await page.$$eval('.rl-bu.stale, .rl-bu.pending', els => els.map(e => e.dataset.bu));
        if (!need.length) break;
        for (const bu of need) { await setMe(bu === 'IT' ? 'dk' : 'ps'); await page.click(`[data-bu="${bu}"] [data-signoff=approved]`); await stepUpOk(); }
      }
    };
    await signAll();
    let r2 = await rd(AR);
    ok(r2.pass, 'access-review gate passes: ' + r2.checks.filter(c => c.status === 'fail').map(c => c.id + ': ' + c.detail).join(' | '));
    ok(!(await page.$('[data-bu="IT"] [data-why=bu]')) && !(await page.$('[data-bu="Compliance"] [data-why=bu]')), "no stale “Switch 'Viewing as'” hint on signed sections");
    /* a cutover edit after sign-off makes every approval stale */
    await setMe('ta');
    await page.click('[data-cutover-edit]'); await page.waitForSelector('.overlay input[name=window]');
    await page.fill('.overlay input[name=window]', 'Sat 07:00–10:00 CT (moved an hour earlier)');
    await page.click('.overlay [data-act=save]'); await settle(1200);
    ok(await page.$('[data-bu="IT"] [data-stale-cutover]') && await page.$('[data-bu="Compliance"] [data-stale-cutover]'), 'cutover edit after sign-off: every section shows "Cutover plan edited" and needs re-approval');
    ok(!(await rd(AR)).pass, 'gate blocked until re-approved');
    await shot('02b-stale-cutover');
    await signAll();
    r2 = await rd(AR);
    ok(r2.pass && await page.$('[data-gate=pass]'), 'gate passes again after re-approval');
    ok(/2 distinct approvers/.test(await txt('.rl-two')), 'two-person: Dev Kumar and Priya Shah');
    await shot('02-ar-pass');

    /* ---------- 6. dialogs keep input ---------- */
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
    await page.click('.overlay [data-act=cancel]'); await settle();

    /* ---------- 7. release manager vs non-RM ---------- */
    console.log('Release manager only');
    await setMe('ta');
    ok(await page.$eval('[data-golive]', b => b.disabled) && /Only the release manager \(Maya Chen\) can go live/.test(await txt('.rl-golive [data-why=rm]')), 'non-RM (the PM) sees Go live disabled with who can');
    expect403 = true;
    const forbidden = await st(`try { await store.api('/golive/' + a, {}); return 'allowed'; } catch (e) { return e.status + ' ' + e.message; }`, AR);
    expect403 = false;
    ok(/^403 Only the release manager/.test(forbidden), 'server refuses go-live from a non-RM: ' + forbidden);

    /* ---------- 8. failed pipeline: no side effects, retry succeeds, rollback ---------- */
    console.log('Go-live: failure has no side effects');
    await setMe('mc');
    const v0 = await st(`return store.get('process', 'access-review').version;`);
    const grants0 = await st(`return JSON.stringify(store.list('grant', g => g.projectId === a).map(g => g.status));`, AR);
    await page.click('[data-golive]');
    await page.waitForSelector('.overlay [data-golive-runbook]');
    ok((await page.$$('.overlay [data-gl-task]')).length === 3, 'go-live dialog lists the 3 runbook tasks');
    ok(await page.$('.overlay [data-gl-owner=ps]') && /Priya Shah/.test(await txt(`.overlay [data-gl-task="${gngId}"]`)) && /Confirmed by Priya Shah/.test(await txt(`.overlay [data-gl-task="${gngId}"]`)), 'runbook task owner kept in the go-live dialog (Priya Shah, confirmed)');
    await page.check('.overlay [data-simfail]');
    await page.click('.overlay [data-act=go]');
    await stepUpOk();
    await page.waitForSelector('[data-pipe-phase=queued], [data-pipe-phase=running]', { timeout: 15000 });
    ok(/Simulated pipeline/.test(await txt('[data-pipe-phase]')), 'pipeline labelled as simulated');
    await page.waitForSelector('[data-pipeline-failed]', { timeout: 10000 }); await settle(900);
    ok(/Nothing was promoted or published/.test(await txt('[data-pipeline-failed] [data-no-side-effects]')), 'failure banner: "Nothing was promoted or published"');
    const relF = await st(`return store.list('release', r => r.projectId === a && r.kind !== 'rollback').sort((x, y) => y.at.localeCompare(x.at))[0];`, AR);
    ok(relF.status === 'failed' && relF.pipeline && relF.pipeline.log.map(x => x.phase).join('>') === 'queued>running>failed', 'failed release recorded, phases logged');
    ok(await st(`return store.get('process', 'access-review').version;`) === v0 && await st(`return store.get('project', a).status;`, AR) === 'active', 'no promotion: version unchanged, project still active');
    ok(await st(`return JSON.stringify(store.list('grant', g => g.projectId === a).map(g => g.status));`, AR) === grants0, 'no grant expiry');
    ok(await page.$('.rl-latest [data-failed] [data-no-side-effects]'), 'release record says nothing was promoted or published');
    await shot('05-pipeline-failed');
    console.log('Retry succeeds');
    await page.click('[data-retry]');
    await page.waitForSelector('.overlay [data-simfail]');
    ok(/Retry release/.test(await txt('.overlay h2')), 'Retry opens the release dialog');
    await page.click('.overlay [data-act=go]');
    await stepUpOk();
    await page.waitForSelector('[data-pipe-phase=succeeded]', { timeout: 15000 });
    await page.waitForFunction(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); return store.list('release').some(r => r.projectId === 'access-review-automation' && r.kind === 'golive' && r.status === 'succeeded' && r.pipeline && r.pipeline.log); }, null, { timeout: 10000 }); await settle(800);
    ok(await st(`return store.get('project', a).status;`, AR) === 'live' && await st(`return store.get('process', 'access-review').version;`) === v0 + 1, 'retry: project live, process promoted');
    ok(!(await page.$('[data-pipeline-failed]')), 'no failure banner after success');
    await setMe('ta');
    ok(await page.$('.rl-rb [data-why=rm]') && !(await page.$('[data-rollback]')), 'non-RM cannot roll back; told who can');
    expect403 = true;
    const forbRb = await st(`try { await store.api('/rollback/' + a, {}); return 'allowed'; } catch (e) { return e.status; }`, AR);
    expect403 = false;
    ok(forbRb === 403, 'server refuses rollback from a non-RM (403)');
    await setMe('mc');
    await page.click('[data-rollback]');
    await page.waitForSelector('.overlay textarea[name=reason]');
    await page.fill('.overlay textarea[name=reason]', 'Removal job flagged service accounts');
    await page.click('.overlay [data-act=rollback]');
    await stepUpOk();
    await page.waitForSelector('.rl-latest [data-kind=rollback]', { timeout: 20000 }); await settle(800);
    ok(await st(`return store.get('project', a).status;`, AR) === 'active' && await st(`return store.get('process', 'access-review').version;`) === v0, 'rollback restored the previous version');
    const undone = await page.$$eval('.rl-latest [data-undone] li', els => els.map(e => e.textContent));
    ok(undone.length >= 2 && undone.some(x => /Re-published SOP/.test(x)) && undone.some(x => /Restored/.test(x)), 'rollback shows the side effects it undid: ' + undone.slice(0, 2).join(' | '));
    await shot('06-ar-rolledback');
    await page.reload(); await page.waitForSelector('#cutover'); await settle(1200);
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('[data-rl-history]').textContent), null, { timeout: 10000 });
    const audit = await txt('[data-rl-history]');
    ok(/pipeline failed/i.test(audit) && /rolled back/i.test(audit), 'gate audit log shows the failed pipeline and the rollback');

    /* ---------- 9. BU sections from touches tags, including the trigger; "No approver in HR" ---------- */
    console.log('BU sections from touches and the trigger');
    await open('/release/' + VM);
    ok(await page.$('[data-bu="Compliance"] [data-via-tag]') && /tag: Compliance/.test(await txt('[data-bu="Compliance"]')), 'Compliance section includes a step owned by Procurement via its touches tag');
    const hasHr = await st(`return store.state.people.some(p => p.bu === 'HR');`);
    await setMe('mc');
    await st(`const p = store.get('process', 'vendor-onboarding'); const tobe = p.tobe.map(n => n.type === 'trigger' ? Object.assign({}, n, { touches: (n.touches || []).concat(['HR']) }) : n); await store.save('process', p.id, Object.assign({}, p, { tobe }), 'Trigger now touches HR (e2e)');`);
    await settle(800);
    ok(await page.$('[data-bu="HR"] [data-via-trigger]'), 'HR section comes from the trigger’s touches');
    if (!hasHr) ok(/No approver in HR: assign one/.test(await txt('[data-no-approver="HR"]')) && /No approver in HR/.test((await check(VM, 'bu-signoff')).detail), 'HR has nobody: "No approver in HR: assign one" (UI and engine)');
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
    const labels = await page.$$eval('#cases [data-case-label]', els => els.map(e => e.textContent.trim()));
    ok(labels.length && labels.every(l => /^TC\d+$/.test(l)) && !(await page.$$eval('#cases td', tds => tds.some(td => /\btc-[a-z0-9]/.test(td.textContent)))), `cases show TC<n> labels, never raw ids (${labels.slice(0, 3).join(', ')}…)`);
    ok(await st(`return window.PMOEngine.caseLabel(store.state.docs, a);`, firstCase) === await txt(`#cases tr[data-case="${firstCase}"] [data-case-label]`).then(t => t.trim()), 'label matches E().caseLabel');
    await page.selectOption('select[name=bulkTester]', 'ar');
    await page.click('[data-bulk-assign]'); await page.waitForSelector('.toast >> text=/assigned to Ana Ruiz/', { timeout: 60000 }); await settle(800);
    ok(await st(`return store.list('testCase', c => c.dataId === 'D2').every(c => c.tester === 'ar');`), 'bulk-assigned every D2 case to Ana Ruiz');
    for (const d of await page.$$eval('.ts-list [data-de]', as => as.map(a => a.dataset.de))) {
      if (d === 'D2' || d === 'D8') continue;
      await page.click(`.ts-list [data-de="${d}"]`); await settle(300);
      await page.click('[data-gen]'); await page.waitForSelector('.toast >> text=/Generated \\d+ test case|No new test cases/', { timeout: 60000 }); await settle(500);
    }
    /* profile view: no "?" row counts and no duplicate humanized pattern rows */
    await page.click('.ts-list [data-de="D2"]'); await settle(400);
    const profTxt = await txt('.ts-main .card');
    ok(!/\? rows|of \?|undefined/.test(profTxt), 'profile view has no "? rows" or "undefined"');
    const dupPat = await page.$$eval('[data-patterns]', tds => tds.some(td => { const t = [...td.querySelectorAll('.ts-hp')].map(x => x.textContent); return new Set(t).size !== t.length; }));
    ok(!dupPat, 'no duplicate humanized pattern rows in any column');

    console.log('Custom case; custom-only coverage does not count');
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
    ok(await st(`return store.list('testCase', c => c.dataId === 'D8' && c.field === 'Risk tier' && c.input === 'Tier 4' && c.tester === 'ps' && c.origin === 'user').length === 1;`), 'custom case saved with a free-text field and a tester');
    await st(`const d = store.get('dataElement', 'D8'); await store.save('dataElement', 'D8', Object.assign({}, d, { fields: [{ name: 'Risk tier', format: 'Tier 1-3', type: 'list', values: ['Tier 1', 'Tier 2', 'Tier 3'], required: true }] }), 'Spec: risk tier (e2e)');`);
    await settle(700);
    ok(await page.$('[data-fields-custom-only]') && /doesn't count/.test(await txt('[data-field-gaps]')) && /free-form check/.test(await txt('[data-field-gaps]')), 'custom-only field flagged with the reason it does not count');
    ok((await check(VM, 'tests-passed')).uncoveredFields.some(x => x.dataId === 'D8' && x.field === 'Risk tier'), 'engine agrees: Risk tier is uncovered');
    ok(/custom only/.test(await txt('[data-cov-row="data:D8"]')), 'coverage matrix row explains the custom-only gap');
    await page.click('[data-gen]'); await page.waitForSelector('.toast >> text=/Generated \\d+ test case/', { timeout: 60000 }); await settle(800);
    ok(!(await page.$('[data-field-gaps]')) && await page.$('[data-fields-covered]'), 'generating spec cases closes the gap');

    console.log('Multi-step UAT scripts and scenarios');
    await page.click('[data-adopt]'); await settle(1200);
    const scripts = await st(`return store.get('project', a).uatScripts;`, VM);
    const multi = scripts.find(s => (s.steps || []).length > 1);
    ok(scripts.length && multi, `adopted scripts keep the engine's steps (${multi && multi.steps.length} steps on “${multi && multi.title}”)`);
    ok(/^S1$/.test((await txt(`[data-script="${scripts[0].id}"] .ts-id`)).trim()), 'scripts show S<n>, not raw ids');
    await page.click(`[data-script="${multi.id}"] summary`); await settle();
    await page.selectOption(`[data-script-tester="${multi.id}"]`, 'ps'); await settle(900);
    ok(await st(`return store.get('project', a).uatScripts.find(s => s.id === a2).tester === 'ps';`.replace('a2', JSON.stringify(multi.id)), VM), 'tester assigned on a script');
    const gen = await st(`return window.PMOEngine.generateScenarios(store.state.docs, a).length;`, VM);
    ok(gen > 0 && (await page.$$('[data-scenario]')).length === gen, `generated scenarios previewed (${gen})`);
    await page.click('[data-adopt-scn]'); await settle(1200);
    const scns = await st(`return store.get('project', a).uatScenarios;`, VM);
    ok(scns && scns.length === gen && scns.every(x => x.steps.length && x.steps[0].action), 'scenarios adopted into project.uatScenarios with their steps');
    const sc0 = scns[0];
    await page.click(`[data-scenario="${sc0.id}"] summary`); await settle();
    await page.click(`[data-edit-scn="${sc0.id}"]`); await page.waitForSelector('.overlay [data-srows]');
    await page.fill('.overlay input[name=title]', 'Happy path: vendor approved first time');
    await page.click('.overlay [data-sadd]');
    await page.fill('.overlay [data-srow] >> nth=-1 >> [data-sa]', 'Check the vendor appears in the ERP');
    await page.click('.overlay [data-act=save]'); await settle(300);
    ok(/expected result/.test(await txt('.overlay [data-err]')), 'scenario step without an expected result: inline error, dialog stays');
    await page.fill('.overlay [data-srow] >> nth=-1 >> [data-sx]', 'Vendor master record is active');
    await page.click('.overlay [data-act=save]'); await settle(1000);
    const sc0b = await st(`return store.get('project', a).uatScenarios.find(x => x.id === ${JSON.stringify(sc0.id)});`, VM);
    ok(sc0b.title === 'Happy path: vendor approved first time' && sc0b.steps.length === sc0.steps.length + 1, 'scenario edited: new title and an extra step');
    ok(await page.$(`[data-cov-row="scenario:${sc0.id}"]`), 'scenarios appear in the coverage matrix');
    ok((await check(VM, 'tests-passed')).scripts.includes(sc0.id), 'engine counts the adopted scenario in UAT coverage');

    console.log('Planned test cycle: only its testers record');
    await page.click('[data-add-cycle]');
    await page.waitForSelector('.overlay input[name=name]');
    ok((await page.$$eval('.overlay select[name=env] option', o => o.map(x => x.value))).join() === 'dev,sit,uat,prod-verify', 'cycle environments: dev, sit, uat, prod-verify');
    await page.fill('.overlay input[name=name]', 'UAT cycle 1');
    await page.click('.overlay [data-act=save]'); await settle(300);
    ok(/Name at least one tester/.test(await txt('.overlay [data-err]')) && (await page.inputValue('.overlay input[name=name]')) === 'UAT cycle 1', 'cycle without testers: error inline, name kept');
    await page.check('.overlay input[name=testers][value=ps]');
    await page.check('.overlay input[name=testers][value=ar]');
    await page.click('.overlay [data-act=save]'); await settle(1000);
    const cyc = await st(`return (store.get('project', a).testCycles || [])[0];`, VM);
    ok(cyc && cyc.env === 'uat' && cyc.testers.join() === 'ps,ar', 'cycle planned: UAT, testers Priya and Ana');
    ok(await page.$(`[data-cycle-id="${cyc.id}"] [data-why=tester]`), 'Tom (not a tester) cannot record in the cycle; told who can');
    ok(!(await page.$(`[data-cycle-run="${cyc.id}"]`)), 'no record button for a non-tester');
    await page.click('[data-record]'); await page.waitForSelector('.overlay .ts-case');
    await page.selectOption('.overlay [data-env]', 'uat');
    await page.selectOption('.overlay [data-cycle-sel]', cyc.id);
    await page.evaluate(() => { const s = document.querySelector('.overlay .ts-case select'); s.value = 'pass'; });
    await page.click('.overlay [data-act=save]'); await settle(300);
    ok(/Only the testers in “UAT cycle 1”/.test(await txt('.overlay [data-err]')), 'recording into the cycle as a non-tester is refused in the dialog');
    await page.click('.overlay [data-act=cancel]'); await settle();

    await setMe('ps');
    await page.click(`[data-cycle-run="${cyc.id}"]`);
    await page.waitForSelector('.overlay .ts-case');
    ok(await page.inputValue('.overlay [data-cycle-sel]') === cyc.id && await page.inputValue('.overlay [data-env]') === 'uat', 'record dialog preselects the cycle and its env');
    ok((await page.$$('.overlay [data-scn-row]')).length === scns.length, 'scenarios are in the run, recorded step by step');
    /* a script passed without evidence is refused */
    await page.evaluate(sid => { document.querySelectorAll(`.overlay [data-row="s:${sid}"] select`).forEach(s => { s.value = 'pass'; }); }, multi.id);
    await page.click('.overlay [data-act=save]'); await settle(300);
    ok(/passed: add evidence/.test(await txt('.overlay [data-err]')), 'a UAT script pass without evidence is refused');
    /* bulk: select all, no note -> error; with note -> everything passes with that evidence */
    await page.check('.overlay [data-pick-all]');
    await page.click('.overlay [data-bulk-pass]'); await settle(200);
    ok(/one evidence note/.test(await txt('.overlay [data-err]')), '"Mark selected as passed" needs an evidence note');
    await page.fill('.overlay [data-bulk-ev]', 'UAT evidence pack, folder VO-UAT-1');
    await page.click('.overlay [data-bulk-pass]'); await settle(200);
    const evAll = await page.$$eval('.overlay .ts-case', rows => rows.filter(r => !r.closest('[hidden]')).every(r => { const e = r.querySelector('input[name^="e_"]'); return [...r.querySelectorAll('select')].every(s => s.value === 'pass') && e && e.value === 'UAT evidence pack, folder VO-UAT-1'; }));
    ok(evAll, 'every selected row passed with the one evidence note');
    /* the multi-step script fails on its last step */
    await page.evaluate(sid => {
      const row = document.querySelector(`.overlay [data-row="s:${sid}"]`); const sels = row.querySelectorAll('[data-step-row] select'); sels[sels.length - 1].value = 'fail';
      row.querySelectorAll('[data-step-row] input')[sels.length - 1].value = 'Escalation email not sent';
      document.querySelector('.overlay .ts-cases').dispatchEvent(new Event('change', { bubbles: true }));
    }, multi.id);
    await page.click('.overlay [data-act=save]');
    await page.waitForSelector('.overlay .ts-mk', { timeout: 10000 });
    await page.click('.overlay [data-act=create]'); await settle(1500);
    const run1 = await st(`return store.list('testRun', r => r.projectId === a && r.cycleId === ${JSON.stringify(cyc.id)})[0];`, VM);
    const scnRes = run1.results.find(x => x.scriptId === sc0.id);
    ok(scnRes && scnRes.outcome === 'pass' && scnRes.steps.length === sc0b.steps.length && scnRes.evidence === 'UAT evidence pack, folder VO-UAT-1', 'scenario recorded step by step with evidence');
    ok(run1.results.filter(x => x.caseId).every(x => x.evidence === 'UAT evidence pack, folder VO-UAT-1'), 'the bulk evidence note is on each selected case');
    const def = await st(`return store.list('workItem', w => w.projectId === a && w.kind === 'defect' && w.status !== 'done' && w.testRef && w.testRef.scriptId === a2)[0];`.replace('a2', JSON.stringify(multi.id)), VM);
    ok(!!def, 'defect created for the failing script');
    const psProg = await txt(`[data-cycle-id="${cyc.id}"] [data-tester-progress=ps]`);
    const nRec = run1.results.length;
    ok(new RegExp(`${nRec} recorded`).test(psProg), `Priya's progress counts her recorded results: ${psProg.trim()}`);
    ok(/0 recorded/.test(await txt(`[data-cycle-id="${cyc.id}"] [data-tester-progress=ar]`)), 'Ana recorded nothing yet: 0 recorded');

    console.log('Passing retest closes linked defects');
    await page.click('[data-retest=uat]');
    await page.waitForSelector('.overlay [data-script-row]');
    ok((await page.$$('.overlay [data-script-row]')).length === 1 && await page.inputValue('.overlay [data-cycle-sel]') === cyc.id, 'retest has only the failed script and stays in the cycle');
    await page.check('.overlay [data-pick-all]');
    await page.fill('.overlay [data-bulk-ev]', 'Escalation email received, screenshot VO-42');
    await page.click('.overlay [data-bulk-pass]'); await settle(200);
    await page.click('.overlay [data-act=save]');
    await page.waitForSelector('.overlay [data-close-offer]', { timeout: 10000 });
    const canClose = def.owner === 'ps';
    ok(canClose ? await page.$eval(`.overlay [data-close-offer] input[value="${def.id}"]`, c => !c.disabled) : /only .* or the project owner can close it/.test(await txt('.overlay [data-close-offer]')), 'retest offers the linked defect; closing is limited to its owner or the PM');
    await page.click('.overlay [data-act=close]'); await settle(1500);
    if (!canClose) {
      await setMe('ta');
      await page.click(`[data-close-defect="${def.id}"]`); await page.waitForSelector('.overlay input[name=note]');
      await page.fill('.overlay input[name=note]', 'Retest passed in UAT cycle 1');
      await page.click('.overlay [data-act=close]'); await settle(1200);
    }
    ok(await st(`const w = store.get('workItem', a); return w.status === 'done' && /Retest passed/.test(w.fixNote);`, def.id), 'linked defect closed with the passing retest as proof');

    console.log('JUnit: label or title, environment, skipped');
    await setMe('ta');
    const devCases = await st(`const E = window.PMOEngine; const ids = new Set(); store.get('project', a).processes.forEach(p => E.flatSteps(store.get('process', p).tobe).forEach(s => (s.data || []).forEach(d => ids.add(d)))); return store.list('testCase', c => ids.has(c.dataId)).map(c => ({ id: c.id, field: c.field, kind: c.kind, de: store.get('dataElement', c.dataId).name, lbl: E.caseLabel(store.state.docs, c.id) }));`, VM);
    const xml1 = `<testsuite name="vendor-full">${devCases.map(c => `<testcase classname="northwind.vendor" name="${x(c.de)} ${c.lbl} validates"/>`).join('')}</testsuite>`;
    await page.click('[data-ci]'); await page.waitForSelector('.overlay [data-ci-xml]');
    ok((await page.$$eval('.overlay [data-ci-env] option', o => o.map(x => x.value))).join() === 'dev,sit,uat,prod-verify', 'JUnit import asks for the environment');
    await page.fill('.overlay [data-ci-xml]', xml1); await page.click('.overlay [data-act=import]'); await settle(1500);
    const ci1 = await st(`return store.list('testRun', r => r.projectId === a && r.ciSuite === 'vendor-full')[0];`, VM);
    ok(ci1 && ci1.results.length === devCases.length && ci1.results.every(x => x.matchedBy === 'label') && ci1.env === 'dev', `every case matched by its TC label (${ci1 && ci1.results.length}/${devCases.length})`);
    const devFull = (await txt('[data-cov=dev]')).trim();
    ok(/^(\d+)\/\1/.test(devFull), 'dev coverage complete after the full CI import: ' + devFull);
    const tc = devCases.find(c => c.kind === 'boundary') || devCases[0];
    const sk = devCases.find(c => c.id !== tc.id);
    const titleName = `${tc.field.toUpperCase()} -- ${tc.kind}!`;
    const xml2 = `<testsuite name="vendor-partial"><testcase classname="ci" name="${titleName}"><failure message="Boundary rejected"/></testcase><testcase classname="ci" name="${multi.title.toLowerCase().replace(/ /g, '_')}"/><testcase classname="ci" name="${x(sk.de)} ${sk.lbl}"><skipped message="flaky sandbox"/></testcase><testcase classname="ci" name="unrelated smoke test"/></testsuite>`;
    await page.click('[data-ci]'); await page.waitForSelector('.overlay [data-ci-xml]');
    await page.fill('.overlay [data-ci-xml]', xml2); await page.click('.overlay [data-act=import]');
    await page.waitForSelector('.overlay .ts-mk', { timeout: 10000 }); await page.click('.overlay [data-act=cancel]'); await settle(1500);
    const ci2 = await st(`return store.list('testRun', r => r.projectId === a && r.ciSuite === 'vendor-partial')[0];`, VM);
    const tHit = ci2 && ci2.results.find(x => x.caseId && x.outcome === 'fail');
    ok(tHit && tHit.matchedBy === 'title' && tHit.caseId === tc.id, `JUnit "${titleName}" matched the ${tc.field} ${tc.kind} case by title`);
    const skRes = ci2.results.find(x => x.caseId === sk.id);
    ok(skRes && skRes.outcome === 'not-run' && ci2.ciSkipped === 1 && ci2.ciUnmatched === 1, '<skipped/> recorded as not-run (skipped), counted, not dropped; 1 unmatched');
    ok(await page.$(`[data-run="${ci2.id}"] [data-run-skipped="1"]`), 'run header shows "1 skipped"');
    const devAfter = (await txt('[data-cov=dev]')).trim();
    ok(devAfter.split(' ')[0].split('/')[0] === devFull.split(' ')[0].split('/')[0] && /1 fail/.test(devAfter), 'skipped never replaces an earlier pass; only the new fail changes coverage: ' + devAfter);
    /* a SIT import */
    await page.click('[data-ci]'); await page.waitForSelector('.overlay [data-ci-xml]');
    await page.selectOption('.overlay [data-ci-env]', 'sit');
    await page.fill('.overlay [data-ci-xml]', `<testsuite name="vendor-sit"><testcase classname="ci" name="${x(sk.de)} ${sk.lbl}"/></testsuite>`); await page.click('.overlay [data-act=import]'); await settle(1500);
    ok(await st(`return store.list('testRun', r => r.projectId === a && r.ciSuite === 'vendor-sit')[0].env;`, VM) === 'sit' && /SIT \(latest\)/.test(await txt('#coverage thead')), 'SIT run imported and shown as its own coverage column');
    await shot('08-testing-vm');

    console.log('Test history is per project');
    await open('/testing/' + AR);
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('[data-ts-history]').textContent), null, { timeout: 10000 }); await settle(500);
    ok(!/Vendor|vendor-partial|UAT cycle 1|Bank remittance/.test(await txt('[data-ts-history]')), 'access-review test history has no vendor-modernization activity');
    await open('/testing/' + VM);
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('[data-ts-history]').textContent), null, { timeout: 10000 }); await settle(500);
    ok(/vendor-partial|test cycle|scenario/i.test(await txt('[data-ts-history]')), 'vendor-modernization history shows its own test activity');
    await page.reload(); await page.waitForSelector('#cycles'); await settle(1200);
    ok(await page.$(`[data-cycle-id="${cyc.id}"]`) && await page.$(`[data-run-cycle="${cyc.id}"]`) && await page.$(`[data-scenario="${sc0.id}"]`), 'cycle, its runs and the scenarios persist after reload');

    /* ---------- 11. import: loop-backs and blank owners ---------- */
    console.log('Import SOP: loop-backs and owners');
    await setMe('mc');
    await open('/import');
    const sop = `# Northwind Traders — Expense Claim SOP
Purpose: reimburse approved business expenses.
The process starts when an employee submits an expense claim.

1. Ana Ruiz checks the receipts against the expense policy.
2. If approved, Treasury schedules the payment; otherwise the manager approves the exception.
3. If receipts are missing, go back to step 1.
4. The courier archives the paper receipts offsite.
   a. Scan the receipts into the archive folder with the claim number and the date of submission for audit retention purposes.`;
    await page.fill('[data-sop]', sop);
    await page.click('[data-draft]');
    await page.waitForSelector('.is-step', { timeout: 30000 }); await settle();
    ok(await page.$('[data-loopback]') && /Loops back to/.test(await txt('.is-goto.on')), 'loop-back rendered: ' + (await txt('.is-goto.on')).trim().slice(0, 80));
    const noBr = await page.$$eval('.is-branch', bs => bs.map(b => ({ label: b.querySelector('[data-blabel]').value, steps: [...b.querySelectorAll('.is-bstep [data-f=title]')].map(t => t.value) })));
    ok(noBr.some(b => b.label === 'No' && b.steps.some(t => /manager approves the exception/i.test(t))), '"otherwise …" lands in the No branch: ' + JSON.stringify(noBr.find(b => b.label === 'No' && b.steps.length) || {}));
    ok(/Step 1: Ana Ruiz checks/.test(await txt('.is-goto.on')), '"go back to step 1" loops back to step 1');
    ok(await page.$eval('.is-step[data-i="0"] [data-f=owner]', s => s.value) === 'ar', 'full-name owner "Ana Ruiz" matched to Ana Ruiz');
    ok(await page.$$eval('.is-sub textarea', t => t.some(x => /audit retention purposes$/.test(x.value))), 'long sub-step kept in full');
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
