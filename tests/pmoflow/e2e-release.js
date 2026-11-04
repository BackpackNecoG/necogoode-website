/* E2E for stream R (round 2): drives vendor-modernization through the full R2 gate.
   Cutover plan, adopted + edited UAT scripts, step-level runs (Not run default, evidence), defect created on a fail and closed,
   discovered requirement resolved by the data owner, stale approval + re-approval with two approvers, grant notification to the
   data owner, go-live with exceptions, rollback with version restore, and SOP import with a decision, sub-steps and newData.
   Usage: node tests/pmoflow/e2e-release.js [port]   (dev server must be running on that port) */
const { chromium } = require('playwright');
const fs = require('fs');

const PORT = Number(process.argv[2] || 8794);
const ROOT = `http://localhost:${PORT}/concepts/pmoflow`;
const SHOTS = '/tmp/pmo-r';
const PRJ = 'vendor-modernization';
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
    await page.waitForSelector('.overlay', { state: 'detached' });
    await settle();
  };
  const st = (fn, arg) => page.evaluate(async ([src, a]) => { const { store } = await import('/concepts/pmoflow/app/store.js'); return (new Function('store', 'a', 'return (async () => {' + src + '})()'))(store, a); }, [fn, arg]);
  const check = id => st(`const E = window.PMOEngine; return E.readiness(store.state.docs, a.p, store.state.today).checks.find(c => c.id === a.id);`, { p: PRJ, id });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const today = async () => st(`return store.state.today;`);

  try {
    /* ---------- 1. gate blocked; R2 checks rendered; seeded stale approval ---------- */
    console.log('Gate initially blocked');
    await open('/release/' + PRJ);
    ok(await page.$('[data-gate=blocked]'), 'gate shows blocked');
    for (const id of ['discovered-resolved', 'process-valid', 'cutover-plan']) ok(await page.$(`details[data-check="${id}"]`), `renders the ${id} check`);
    await page.click('details[data-check=cutover-plan] summary');
    ok(/Rollback owner not set/.test(await page.textContent('details[data-check=cutover-plan] .rl-items')) && await page.$('details[data-check=cutover-plan] [data-anchor=cutover]'), 'cutover-plan items are readable and link to the cutover card');
    await page.click('details[data-check=discovered-resolved] summary');
    const drHref = await page.getAttribute('details[data-check=discovered-resolved] .rl-item a', 'href');
    ok(/\/testing\/vendor-modernization\?de=D2/.test(drHref || ''), 'discovered-resolved item links to the testing page for that data: ' + drHref);
    ok(/Re-approval needed: changed after sign-off/.test(await page.textContent('[data-stale="Procurement"]')), 'stale Procurement approval shows "Re-approval needed: changed after sign-off"');
    ok(/vendor portal/i.test(await page.textContent('[data-stale="Procurement"]')), 'stale card lists the changed work item');
    const wsId = await page.evaluate(() => localStorage.getItem('pmoflow.ws'));
    const rr = await fetch(`http://localhost:${PORT}/api/pmoflow/ws/${wsId}/golive/${PRJ}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ actor: 'ta' }) });
    const refused = { status: rr.status, reasons: (await rr.json()).reasons };
    ok(refused.status === 409 && refused.reasons.some(r => /Cutover/i.test(r)), 'server refuses go-live with 409 incl. the cutover reason');
    await shot('01-release-blocked');

    /* ---------- 2. grant request notifies the data element's owner ---------- */
    console.log('Access grant: notification goes to the data owner');
    await setMe('dk');
    const before = await st(`return store.list('notification').map(n => n.id);`);
    await page.click('[data-request]');
    await page.waitForSelector('.overlay select[name=dataId]');
    await page.selectOption('.overlay select[name=dataId]', 'D2');
    await page.selectOption('.overlay select[name=env]', 'uat');
    await page.fill('.overlay textarea[name=reason]', 'Validate remittance file mapping in UAT');
    await page.click('.overlay [data-act=send]'); await settle(900);
    const gid = await st(`return store.list('grant', g => g.projectId === a && g.dataId === 'D2' && g.requestedBy === 'dk' && g.status === 'requested').map(g => g.id).pop();`, PRJ);
    ok(!!gid, 'grant request saved');
    const newN = await st(`return store.list('notification', n => !a.includes(n.id)).map(n => ({ to: n.to, ref: n.ref }));`, before);
    ok(newN.some(n => n.to === 'lp' && n.ref === 'grant:' + gid), 'Leo Park (owner of Bank remittance details) is notified');
    ok(!newN.some(n => n.to === 'ta'), 'the project manager is not notified instead');
    ok(/Awaiting Leo Park/.test(await page.textContent(`tr[data-grant="${gid}"]`)), 'grant row says it awaits the data owner');
    await setMe('lp');
    await page.click(`tr[data-grant="${gid}"] [data-gact=approve]`);
    await stepUpOk();
    ok(/active/.test(await page.textContent(`tr[data-grant="${gid}"]`)), 'owner approves with step-up; grant active');
    await shot('02-grant-active');

    /* ---------- 3. cutover plan (project owner only) ---------- */
    console.log('Cutover plan');
    await setMe('mc');
    ok(await page.$eval('#cutover .rl-bu-act button', b => b.disabled) && /Only the project owner \(Tom Alvarez\)/.test(await page.textContent('#cutover')), 'non-owner cannot edit cutover; explains who can');
    await setMe('ta');
    await page.click('[data-cutover-edit]');
    await page.waitForSelector('.overlay input[name=window]');
    await page.fill('.overlay input[name=window]', 'Saturday 06:00–10:00 CT, payment run frozen');
    await page.selectOption('.overlay select[name=rollbackOwner]', 'lp');
    await page.fill('.overlay textarea[name=rollbackPlan]', 'Re-enable the legacy vendor form, restore v1 SOP, re-run the vendor sync.');
    await page.fill('.overlay input[name=hypercareDays]', '10');
    await page.selectOption('.overlay select[name=hypercareOwner]', 'ar');
    await page.fill('.overlay textarea[name=comms]', 'T-2 days notice to Procurement and AP; go/no-go call Friday 15:00.');
    await page.click('.overlay [data-act=save]'); await settle(900);
    const co = await st(`return store.get('project', a).cutover;`, PRJ);
    ok(co && co.rollbackOwner === 'lp' && co.hypercareOwner === 'ar' && co.hypercareDays === 10 && /legacy vendor form/.test(co.rollbackPlan), 'cutover saved to project.cutover');
    ok((await check('cutover-plan')).pass && await page.$('details[data-check=cutover-plan].pass'), 'cutover-plan gate item passes');
    await page.reload(); await page.waitForSelector('#cutover'); await settle(1000);
    ok(/Leo Park/.test(await page.textContent('[data-co=rollbackOwner]')) && /10 days/.test(await page.textContent('[data-co=hypercare]')), 'cutover plan persists after reload');

    /* ---------- 4. testing: profile, generate, custom case CRUD ---------- */
    console.log('Testing: profile + cases');
    await open(`/testing/${PRJ}?de=D2`);
    await page.click('[data-prof-sample]');
    await page.waitForSelector('.ts-driftsum', { timeout: 15000 }); await settle();
    ok(/Raw values were not stored/.test(await page.textContent('.ts-main .card')), 'profile stored as statistics only');
    await page.click('[data-gen]'); await page.waitForSelector('.toast >> text=/Generated \\d+ test case/', { timeout: 60000 }); await settle();
    const nCases = await st(`return store.list('testCase', c => c.dataId === 'D2').length;`);
    ok(nCases >= 10, 'generated test cases: ' + nCases);
    await page.click('[data-add-case]');
    await page.selectOption('.overlay select[name=field]', 'Account number');
    await page.fill('.overlay input[name=input]', '000123');
    await page.selectOption('.overlay select[name=expect]', 'reject');
    await page.click('.overlay [data-act=save]'); await settle();
    const cid = await st(`return (store.list('testCase', c => c.origin === 'user' && c.input === '000123')[0] || {}).id;`);
    await page.click(`[data-edit-case="${cid}"]`);
    await page.fill('.overlay input[name=note]', 'Short accounts are rejected by the bank file');
    await page.click('.overlay [data-act=save]'); await settle();
    ok(/rejected by the bank file/.test(await page.textContent(`tr[data-case="${cid}"]`)), 'custom case added and edited');
    await page.click(`[data-del-case="${cid}"]`); await page.click('.overlay [data-act=del]'); await settle();
    ok(!(await st(`return !!store.get('testCase', a);`, cid)), 'custom case deleted');

    /* ---------- 5. UAT scripts: generated preview -> adopt -> edit ---------- */
    console.log('UAT scripts');
    ok(await page.$('[data-adopt]') && /generated/.test(await page.textContent('#uat-scripts h3')), 'generated scripts shown with an Adopt button');
    const genN = (await page.$$('#uat-scripts .ts-script')).length;
    await page.click('[data-adopt]'); await settle(900);
    const adopted = await st(`return (store.get('project', a).uatScripts || []).length;`, PRJ);
    ok(adopted === genN && adopted >= 5, `adopted ${adopted} scripts into project.uatScripts`);
    const sid = await st(`return store.get('project', a).uatScripts[0].id;`, PRJ);
    await page.click(`details[data-script="${sid}"] summary`); await settle(200);
    await page.click(`[data-edit-script="${sid}"]`);
    await page.waitForSelector('.overlay textarea[name=then]');
    await page.fill('.overlay textarea[name=then]', 'The vendor record shows the W-9 and COI as received, with the reviewer named');
    await page.check('.overlay input[name=data][value=D3]');
    await page.click('.overlay [data-act=save]'); await settle(900);
    const sc0 = await st(`return store.get('project', a).uatScripts[0];`, PRJ);
    ok(/reviewer named/.test(sc0.then) && sc0.data.includes('D3'), 'script given/when/then and data are editable');
    await shot('03-uat-scripts');

    /* ---------- 6. dev run: rows start Not run; partial coverage is visible ---------- */
    console.log('Dev run: Not run default + coverage');
    await page.click('[data-record]');
    await page.waitForSelector('.overlay .ts-case');
    const vals = await page.$$eval('.overlay .ts-case select', ss => ss.map(s => s.value));
    ok(vals.length > 0 && vals.every(v => v === ''), `every row starts as Not run (${vals.length} rows)`);
    ok(await page.$eval('.overlay [data-scripts-block]', el => el.hidden), 'scripts are hidden for a dev run');
    const cRows = await page.$$('.overlay .ts-cases > .ts-case');
    for (const r of cRows.slice(0, 3)) await (await r.$('select')).selectOption('pass');
    await (await cRows[3].$('select')).selectOption('fail');
    await (await cRows[3].$('input[name^=n_]')).fill('Validator accepted a 7-digit routing number');
    await (await cRows[3].$('input[name^=e_]')).fill('https://ci.northwind.example/runs/4812');
    await page.click('.overlay [data-act=save]');
    await page.waitForSelector('.overlay .ts-mk', { timeout: 10000 });
    ok(/create defects\?/i.test(await page.textContent('.overlay h2')), 'a fail auto-offers Create defect');
    await page.click('.overlay [data-act=cancel]'); await settle(900);
    const devRun = await st(`return store.list('testRun', r => r.projectId === a && r.env === 'dev').sort((x, y) => y.at.localeCompare(x.at))[0];`, PRJ);
    ok(devRun.results.length === 4 && devRun.results.filter(x => x.outcome === 'fail').length === 1, 'only rows with an outcome are recorded (4)');
    ok(devRun.results.some(x => x.evidence === 'https://ci.northwind.example/runs/4812'), 'evidence saved on the result');
    const devKpi = await page.textContent('[data-cov=dev]');
    ok(/^4\/\d+/.test(devKpi.trim()) && await page.$('[data-cov=dev] b.fail'), 'dev coverage KPI shows partial coverage: ' + devKpi.trim());
    ok(/covers 4\/\d+ cases/.test(await page.textContent(`[data-run="${devRun.id}"] [data-run-cov]`)) && await page.$(`[data-run="${devRun.id}"] .ts-cov.partial`), 'run header flags partial coverage');
    ok(await page.$(`[data-run="${devRun.id}"] .ts-warn`), 'run detail warns how many were not run');
    ok(await page.$(`[data-run="${devRun.id}"] .ts-ev a[href="https://ci.northwind.example/runs/4812"]`), 'evidence link shown in run detail');

    /* fail on a data case -> discovered requirement, sent to the data owner */
    await page.click(`[data-run="${devRun.id}"] [data-discover]`);
    await page.waitForSelector('.overlay textarea[name=text]');
    await page.click('.overlay [data-act=log]'); await settle(1200);
    const failCase = devRun.results.find(x => x.outcome === 'fail').caseId;
    const disc = await st(`const c = store.get('testCase', a); const de = store.get('dataElement', c.dataId); return { de: de.id, owner: de.owner, n: (de.discovered || []).length };`, failCase);
    ok(disc.n >= 1, 'discovered requirement logged on ' + disc.de);
    ok(await st(`return store.list('notification', n => n.to === a.owner && n.ref === 'dataElement:' + a.de).length > 0;`, disc), 'data owner notified');
    await shot('04-dev-run-partial');

    /* ---------- 7. UAT run with a script failure -> defect -> closed ---------- */
    console.log('UAT run: defect on a failing script');
    const recordAll = async (env, failScript) => {
      await page.click('[data-record]');
      await page.waitForSelector('.overlay .ts-case');
      await page.selectOption('.overlay select[name=env]', env); await settle(200);
      await page.click('.overlay [data-all=pass]');
      if (failScript) {
        const row = await page.$(`.overlay [data-row="s:${failScript}"]`);
        await (await row.$('select')).selectOption('fail');
        await (await row.$('input[name^=n_]')).fill('W-9 marked received but COI missing');
        await (await row.$('input[name^=e_]')).fill('Screenshot in UAT ticket NW-UAT-214');
      }
      await page.click('.overlay [data-act=save]'); await settle(1200);
    };
    await setMe('ar');
    await recordAll('uat', sid);
    ok(await page.$('.overlay .ts-mk'), 'UAT fail offers a defect');
    await page.click('.overlay [data-act=create]'); await settle(1500);
    const uatRun = await st(`return store.list('testRun', r => r.projectId === a && r.env === 'uat').sort((x, y) => y.at.localeCompare(x.at))[0];`, PRJ);
    const sres = uatRun.results.find(x => x.scriptId === sid);
    const expectOwner = await st(`const p = store.get('process', a.pid); const walk = ns => { for (const n of ns || []) { if (n.id === a.step) return n; for (const b of n.branches || []) { const f = walk(b.nodes); if (f) return f; } } return null; }; return (walk(p.tobe) || {}).owner;`, { pid: sc0.pid, step: sc0.step });
    const dfx = await st(`return store.get('workItem', a);`, sres.defectId);
    const due3 = await st(`const d = new Date(store.state.today + 'T12:00:00'); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10);`);
    ok(dfx && dfx.kind === 'defect' && dfx.owner === expectOwner && dfx.due === due3 && dfx.testRef && dfx.testRef.scriptId === sid && dfx.testRef.runId === uatRun.id && dfx.step === sc0.step && dfx.pid === sc0.pid,
      `defect: kind defect, owner = step owner (${expectOwner}), due +3 days, testRef and step link`);
    ok(uatRun.results.length > nCases, 'UAT run covers data cases and scripts: ' + uatRun.results.length);
    ok(await page.$(`[data-run="${uatRun.id}"] [data-defect="${dfx.id}"]`), 'defect link shown in the run detail');
    ok(await st(`return store.list('notification', n => n.to === a && /defect/i.test(n.text)).length > 0;`, expectOwner), 'defect owner notified');
    ok(!(await check('tests-passed')).pass, 'tests-passed blocked while the defect is open');
    await shot('05-uat-defect');
    /* close it as the defect owner */
    await setMe(expectOwner);
    await page.click(`[data-close-defect="${dfx.id}"]`);
    await page.fill('.overlay input[name=note]', 'COI status now required before W-9 is marked received');
    await page.click('.overlay [data-act=close]'); await settle(1000);
    const closed = await st(`return store.get('workItem', a);`, dfx.id);
    ok(closed.status === 'done' && !!closed.doneAt, 'defect closed (done, doneAt set)');
    ok(/closed/.test(await page.textContent(`[data-defect="${dfx.id}"]`)), 'run detail shows the defect closed');

    /* ---------- 8. discovered requirements resolved by the data owner only ---------- */
    console.log('Discovered requirements: resolve');
    const openReqs = await st(`const E = window.PMOEngine; return E.readiness(store.state.docs, a, store.state.today).checks.find(c => c.id === 'discovered-resolved').items;`, PRJ);
    for (const it of openReqs) {
      const [deId, idx] = it.split('#');
      const owner = await st(`return store.get('dataElement', a).owner;`, deId);
      await page.goto(`${ROOT}/testing/${PRJ}?de=${deId}`); await page.waitForSelector('#discovered'); await settle();
      await setMe(owner === 'dk' ? 'mc' : 'dk');
      ok(!(await page.$(`#discovered [data-resolve="${idx}"]`)) && /Only the data owner/.test(await page.textContent(`#discovered [data-req="${idx}"]`)), `non-owner cannot resolve ${it}`);
      await setMe(owner);
      await page.click(`#discovered [data-resolve="${idx}"]`);
      await page.fill('.overlay textarea[name=note]', 'Spec updated: routing number must be exactly 9 digits');
      await page.click('.overlay [data-act=resolve]'); await settle(900);
    }
    ok((await check('discovered-resolved')).pass, `discovered-resolved passes after resolving ${openReqs.length}`);
    ok(/Resolved by/.test(await page.textContent('#discovered')), 'resolution shown with who and note');
    await page.reload(); await page.waitForSelector('#discovered'); await settle(1500);
    ok(/Resolved a discovered requirement/.test(await page.textContent('.ts-act')), 'history panel shows the resolution');

    /* ---------- 9. the rest of the gate: work, data, final clean runs ---------- */
    console.log('Drive remaining checks');
    await st(`
      for (const w of store.list('workItem', w => w.projectId === a && w.status !== 'done')) await store.save('workItem', w.id, Object.assign({}, w, { status: 'done', doneAt: store.state.today, updatedAt: new Date().toISOString() }), 'Marked ' + w.title + ' done (e2e)');
      const E = window.PMOEngine; const chk = E.readiness(store.state.docs, a, store.state.today).checks.find(c => c.id === 'data-live');
      for (const d of chk.items) { const de = store.get('dataElement', d); await store.save('dataElement', d, Object.assign({}, de, { avail: 'live' }), de.name + ' is live (e2e)'); }
    `, PRJ);
    await open('/testing/' + PRJ);
    await recordAll('dev', null);
    await recordAll('uat', null);
    const tp = await check('tests-passed');
    ok(tp.pass, 'tests-passed: ' + tp.detail);
    ok(/^(\d+)\/\1/.test((await page.textContent('[data-cov=uat]')).trim()), 'UAT coverage KPI is complete: ' + (await page.textContent('[data-cov=uat]')).trim());
    await shot('06-testing-pass');

    /* ---------- 10. sign-off, change after sign-off, re-approval ---------- */
    console.log('Sign-off, stale, re-approval');
    await open('/release/' + PRJ);
    const pend = await st(`return store.list('grant', g => g.projectId === a && g.status === 'requested').map(g => ({ id: g.id, owner: store.get('dataElement', g.dataId).owner }));`, PRJ);
    for (const g of pend) { await setMe(g.owner); await page.click(`tr[data-grant="${g.id}"] [data-gact=deny]`); await settle(); }
    const people = await st(`return store.state.people;`);
    const signAll = async () => {
      const bus = await page.$$eval('.rl-bu:not(.approved)', els => els.map(e => e.dataset.bu));
      for (const bu of bus) { const p = people.find(x => x.bu === bu); await setMe(p.id); await page.click(`[data-bu="${bu}"] [data-signoff=approved]`); await stepUpOk(); }
      return bus;
    };
    const signed = await signAll();
    ok(signed.includes('Procurement'), 'stale Procurement section re-approved through the UI');
    ok((await page.$$('.rl-bu.approved')).length === (await page.$$('.rl-bu')).length, 'all BU sections signed off');
    ok((await check('bu-signoff')).pass && (await check('two-person')).pass, 'bu-signoff and two-person pass');
    /* a Treasury work item changes after sign-off */
    const tw = await st(`const w = store.list('workItem', w => w.projectId === a && store.person(w.owner) && store.person(w.owner).bu === 'Treasury')[0]; await store.save('workItem', w.id, Object.assign({}, w, { title: w.title + ' (incl. call-back script)', updatedAt: new Date().toISOString() }), 'Changed scope of ' + w.title); return store.get('workItem', w.id);`, PRJ);
    await settle(800);
    ok(await page.$('.rl-bu.stale[data-bu="Treasury"]') && /call-back script/.test(await page.textContent('[data-stale="Treasury"]')), 'Treasury shows Re-approval needed with the changed item');
    ok(!(await check('bu-signoff')).pass && await page.$('[data-gate=blocked]'), 'stale approval blocks the gate');
    await shot('07-stale-approval');
    await setMe('mc');
    ok(await page.$eval('[data-bu="Treasury"] .rl-bu-act button', b => b.disabled), 'non-Treasury persona cannot re-approve Treasury');
    await setMe('lp');
    ok(/Re-approve/.test(await page.textContent('[data-bu="Treasury"] [data-signoff=approved]')), 'Re-approve button offered to Treasury');
    await page.click('[data-bu="Treasury"] [data-signoff=approved]');
    await stepUpOk();
    const apprs = await st(`return [...new Set(store.list('approval', x => x.projectId === a && x.decision === 'approved').map(x => x.approver))];`, PRJ);
    ok(apprs.length >= 2, 'approvals from ' + apprs.length + ' distinct approvers');
    await setMe('ta');
    ok(await page.$('[data-gate=pass]'), 'gate passes after re-approval');
    ok(!(await page.$eval('[data-golive]', b => b.disabled)), 'go-live enabled');
    await shot('08-release-pass');

    /* ---------- 11. go-live with exceptions ---------- */
    console.log('Go-live');
    const vBefore = await st(`return Object.fromEntries(store.get('project', a).processes.map(p => [p, store.get('process', p).version]));`, PRJ);
    await page.click('[data-golive]');
    await page.waitForSelector('.overlay .rl-sum');
    ok(/re-approved/.test(await page.textContent('.overlay .rl-sum')), 'release summary counts the re-approved exceptions');
    await page.click('.overlay [data-act=go]');
    await stepUpOk();
    await page.waitForSelector('.rl-latest.fresh', { timeout: 20000 }); await settle(1500);
    const rel = await st(`return store.list('release', r => r.projectId === a).sort((x, y) => y.at.localeCompare(x.at))[0];`, PRJ);
    ok(rel.kind === 'golive' && rel.exceptions.length >= 1, 'release record has exceptions: ' + rel.exceptions.length);
    ok(rel.exceptions.some(x => x.ref === 'workItem:' + tw.id), 'exceptions include the Treasury change');
    const recTxt = await page.textContent('.rl-latest');
    ok(/call-back script/.test(recTxt) && /Exceptions/.test(recTxt), 'release card shows the exceptions');
    const vAfter = await st(`return Object.fromEntries(store.get('project', a).processes.map(p => [p, store.get('process', p).version]));`, PRJ);
    ok(Object.keys(vBefore).every(k => vAfter[k] === vBefore[k] + 1), 'process versions incremented: ' + JSON.stringify(vAfter));
    ok(await page.$('[data-gate=live]'), 'gate shows released');
    await shot('09-released');

    /* ---------- 12. rollback ---------- */
    console.log('Rollback');
    await setMe('mc');
    ok(await page.$eval('.rl-rb button', b => b.disabled) && /rollback owner \(Leo Park\)/.test(await page.textContent('.rl-rb')), 'rollback disabled for others; names owner + rollback owner');
    await setMe('lp');
    await page.click('[data-rollback]');
    await page.waitForSelector('.overlay textarea[name=reason]');
    ok(/legacy vendor form/.test(await page.textContent('.overlay')), 'confirm shows the rollback plan');
    await page.fill('.overlay textarea[name=reason]', 'Vendor sync rejecting 8-digit routing numbers');
    await page.click('.overlay [data-act=rollback]');
    await stepUpOk();
    await page.waitForSelector('.rl-latest [data-kind=rollback]', { timeout: 20000 }); await settle(1000);
    const vRb = await st(`return Object.fromEntries(store.get('project', a).processes.map(p => [p, store.get('process', p).version]));`, PRJ);
    ok(Object.keys(vBefore).every(k => vRb[k] === vBefore[k]), 'versions restored: ' + JSON.stringify(vRb));
    ok(await st(`return store.get('project', a).status;`, PRJ) === 'active', 'project back to active');
    ok(await st(`return store.get('project', a).processes.every(p => (store.get('process', p).released || []).some(r => r.rolledBack));`, PRJ), 'rolled-back version kept viewable in process history');
    ok(await page.$('[data-relrow][data-kind=rollback]') && await page.$('[data-relrow][data-kind=golive]'), 'release history lists go-live and rollback records');
    await shot('10-rolled-back');

    /* ---------- 13. reload persistence + audit ---------- */
    console.log('Reload persistence');
    await page.reload(); await page.waitForSelector('.rl-latest', { timeout: 20000 }); await settle(1500);
    ok(await page.$('.rl-latest [data-kind=rollback]') && /Leo Park/.test(await page.textContent('#cutover')), 'rollback + cutover persist after reload');
    const audit = await page.textContent('[data-rl-history]');
    ok(/rolled back/.test(audit), 'gate audit log shows the rollback');
    ok((await st(`return (await store.events('project:' + a, 200)).map(e => e.summary).join(' | ');`, PRJ)).includes('Updated the cutover plan'), 'project history records the cutover change');

    /* ---------- 14. Import SOP: decision, sub-steps, newData ---------- */
    console.log('Import SOP');
    await setMe('mc');
    await open('/import');
    await page.click('[data-sample]'); await settle();
    await page.click('[data-draft]');
    await page.waitForSelector('.is-step', { timeout: 30000 }); await settle();
    const gate = await page.$('.is-step[data-type=decision]');
    ok(!!gate, 'decision node rendered');
    const labels = await page.$$eval('.is-step[data-type=decision] .is-blabel', els => els.map(e => e.value));
    ok(labels.join(',') === 'Yes,No', 'Yes/No branches rendered: ' + labels.join(','));
    ok((await page.$$('.is-step[data-type=decision] .is-branch')).length === 2 && (await page.$$('.is-step[data-type=decision] .is-branch >> nth=0 >> .is-bstep')).length >= 1, 'conditional step nested in the Yes branch');
    const subs = await page.$$eval('.is-sub input', els => els.map(e => e.value));
    ok(subs.length >= 2 && subs.some(s => /expiry date/.test(s)), 'sub-steps nested under their step: ' + subs.length);
    ok(!(await page.textContent('.is-draft')).includes('suggestion(s) were added from business-unit names'), 'no client-side keyword guessing note');
    const nd = await page.$$eval('[data-nd-name]', els => els.map(e => e.value));
    ok(nd.includes('Contractor timesheet record'), 'newData proposal shown: ' + nd.join(', '));
    ok(await page.$eval('[data-nd-create="0"]', c => c.checked), '"create" checkbox ticked by default');
    await page.fill('.is-step[data-type=decision] .is-blabel >> nth=0', 'Over $50k');
    await page.fill('.is-step[data-type=decision] .is-blabel >> nth=1', 'Up to $50k');
    await page.fill('[data-nd-name="0"]', 'bank REMITTANCE details');
    await page.click('[data-create]');
    await page.waitForSelector('.toast >> text=/already exists/', { timeout: 5000 });
    ok(true, 'duplicate data element name blocked (case-insensitive)');
    await page.fill('[data-nd-name="0"]', 'Contractor timesheet record');
    /* add a sub-step and remove one */
    const subBefore = (await page.$$('.is-sub')).length;
    await page.click('[data-add-sub] >> nth=0'); await settle();
    ok((await page.$$('.is-sub')).length === subBefore + 1, 'sub-step added');
    await page.click('.is-sub [data-rm-path] >> nth=0'); await settle();
    ok((await page.$$('.is-sub')).length === subBefore, 'sub-step removed');
    await shot('11-import-draft');
    await page.click('[data-create]');
    await page.waitForSelector('.overlay input[name=name]');
    ok(/Also creates 1 data element/.test(await page.textContent('.overlay')), 'create dialog lists the new data element');
    await page.fill('.overlay input[name=name]', 'Contractor onboarding (imported)');
    await page.click('.overlay [data-act=create]');
    await page.waitForURL(/\/process\/proc-[\w-]+\?mode=edit/, { timeout: 15000 });
    const newPid = page.url().match(/process\/([\w-]+)/)[1];
    await settle(1500);
    await page.reload(); await page.waitForSelector('#app .hdr', { timeout: 20000 }); await settle();
    const proc = await st(`const p = store.get('process', a); const de = store.list('dataElement', d => d.name === 'Contractor timesheet record'); const dg = p.asis.find(n => n.type === 'decision'); const withSubs = p.asis.find(n => (n.subs || []).length);
      return { v: p.version, de: de.map(d => d.id), dg: dg && { labels: dg.branches.map(b => b.label), n: dg.branches[0].nodes.length }, subs: withSubs && withSubs.subs.length, linked: de[0] && p.asis.some(n => (n.data || []).includes(de[0].id)), tobeGate: p.tobe.some(n => n.type === 'decision' && n.from === (dg && dg.id) && n.branches[0].nodes[0].from === dg.branches[0].nodes[0].id) };`, newPid);
    ok(proc.v === 1 && proc.dg && proc.dg.labels.join('|') === 'Over $50k|Up to $50k' && proc.dg.n === 1, 'decision persisted with edited branch labels: ' + JSON.stringify(proc.dg));
    ok(proc.subs >= 2, 'sub-steps persisted');
    ok(proc.de.length === 1 && proc.linked, 'new data element created once and linked to its step');
    ok(proc.tobeGate, 'to-be copy keeps the decision with from links');
    await shot('12-imported-process');

    /* ---------- 15. widths ---------- */
    console.log('Widths');
    for (const [w, h] of [[1440, 1000], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const p of ['/release/' + PRJ, '/release/access-review-automation', '/testing/' + PRJ, '/import']) {
        await open(p);
        if (p === '/import') { await page.click('[data-sample]'); await page.click('[data-draft]'); await page.waitForSelector('.is-step', { timeout: 30000 }); await settle(); }
        ok(await overflow(), `no horizontal overflow at ${w}: ${p}`);
        if (w === 390) await shot('m-' + p.replace(/\//g, '_').replace(/^_/, ''));
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await open('/testing/' + PRJ);
    await page.click('[data-record]'); await page.waitForSelector('.overlay .ts-case'); await page.selectOption('.overlay select[name=env]', 'uat'); await settle(300);
    ok(await overflow(), 'no overflow at 390 with the record-run modal open');
    await page.screenshot({ path: `${SHOTS}/m-record-modal.png` });
    await page.click('.overlay [data-act=cancel]');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open('/release/access-review-automation');
    await shot('13-release-other');
    void today;
  } catch (e) {
    failed++; console.log('  ✗ threw: ' + (e && e.stack || e));
    try { await shot('zz-failure'); } catch (x) { /* ignore */ }
  }

  ok(errors.length === 0, 'zero page/console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' || ') : ''));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
