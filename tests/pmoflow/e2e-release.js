/* E2E for stream R: release gate, grants, BU sign-off, testing (profile, cases, runs, discovered reqs), go-live, SOP import.
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
  const ip = `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const settle = () => page.waitForTimeout(450);
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
  /* Page content (#app) must never overflow. The document-level check is reported separately: at 390 px the shared
     top bar (lead-owned .who persona select) is wider than the viewport, which no page stream can fix. */
  const overflow = () => page.evaluate(() => document.getElementById('app').scrollWidth <= innerWidth + 1);
  const docOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const chromeWarn = new Set();

  try {
    /* ---------- 1. gate initially blocked ---------- */
    console.log('Gate initially blocked');
    await open('/release/' + PRJ);
    ok(await page.$('[data-gate=blocked]'), 'gate shows blocked');
    const hdrText = await page.textContent('.rl-gate');
    ok(/Blocked — \d+ checks? failing/.test(hdrText), 'header shows blocked with a count: ' + hdrText.trim().split('\n')[0]);
    ok((await page.$$('.rl-check.fail')).length >= 4, 'several checks failing');
    await page.click('details[data-check=bu-signoff] summary');
    ok(/Accounts Payable/.test(await page.textContent('details[data-check=bu-signoff] .rl-items')), 'bu-signoff lists unsigned BUs');
    ok(await page.$eval('[data-golive]', b => b.disabled), 'go-live button disabled while blocked');
    /* 409 checked from Node so the browser does not log the expected failed request as a console error */
    const wsId = await page.evaluate(() => localStorage.getItem('pmoflow.ws'));
    const rr = await fetch(`http://localhost:${PORT}/api/pmoflow/ws/${wsId}/golive/${PRJ}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ actor: 'ta' }) });
    const refused = { status: rr.status, reasons: (await rr.json()).reasons };
    ok(refused && refused.status === 409 && refused.reasons && refused.reasons.length >= 3, 'server refuses go-live with 409 + reasons');
    await shot('01-release-blocked');

    /* ---------- 2. grant request -> owner approves with step-up ---------- */
    console.log('Access grant flow');
    await setMe('mc');
    await page.click('[data-request]');
    await page.waitForSelector('.overlay select[name=dataId]');
    const opts = await page.$$eval('.overlay select[name=dataId] option', os => os.map(o => o.value));
    const used = await st(`const E = window.PMOEngine; const ids = new Set(); store.get('project', a).processes.forEach(p => E.flatSteps(store.get('process', p).tobe).forEach(s => (s.data || []).concat(...(s.subs || []).map(x => x.data || [])).forEach(d => ids.add(d)))); return [...ids];`, PRJ);
    const allDe = await st(`return store.list('dataElement').length;`);
    ok(opts.includes('D3') && opts.length === used.length && opts.every(o => used.includes(o)), `request modal limited to the project's ${used.length} data elements (of ${allDe})`);
    const maxDate = await page.$eval('.overlay input[name=expires]', i => i.max);
    ok(!!maxDate, 'expiry has a 30-day max (' + maxDate + ')');
    await page.selectOption('.overlay select[name=dataId]', 'D3');
    await page.selectOption('.overlay select[name=env]', 'uat');
    await page.fill('.overlay textarea[name=reason]', 'Validate the insurance certificate checks in UAT');
    await page.click('.overlay [data-act=send]');
    await settle();
    const gid = await st(`return store.list('grant', g => g.projectId === a && g.dataId === 'D3').map(g => g.id)[0];`, PRJ);
    ok(!!gid, 'grant saved');
    ok(/requested/.test(await page.textContent(`tr[data-grant="${gid}"]`)), 'grant shows requested');
    ok(!(await page.$(`tr[data-grant="${gid}"] [data-gact=approve]`)), 'requester cannot approve');
    await setMe('ps');
    const notif = await st(`return store.list('notification', n => n.to === 'ps' && n.ref === 'grant:' + a).length;`, gid);
    ok(notif >= 1, 'data owner was notified');
    await page.click(`tr[data-grant="${gid}"] [data-gact=approve]`);
    await stepUpOk();
    ok(/active/.test(await page.textContent(`tr[data-grant="${gid}"]`)), 'grant active after step-up approval');
    const glog = await st(`const g = store.get('grant', a); return g.log.map(l => l.by + ':' + l.action);`, gid);
    ok(glog.length === 2 && /^ps:approved/.test(glog[1]), 'grant log records actor + action: ' + glog.join(' | '));
    await page.click(`[data-glog="${gid}"]`); await settle();
    ok(/Priya Shah/.test(await page.textContent('.rl-logrow')), 'grant log is viewable');
    await shot('02-grant-active');

    /* ---------- 3. BU sign-off ---------- */
    console.log('BU sign-off');
    await setMe('mc');
    const compBtn = await page.$('[data-bu="Compliance"] .rl-bu-act button');
    ok(compBtn && await compBtn.isDisabled(), 'Compliance approve disabled for a Procurement persona');
    ok(/Switch 'Viewing as' to a Compliance person to sign off/.test(await page.textContent('[data-bu="Compliance"]')), 'explains who can sign off');
    await setMe('ps');
    await page.click('[data-bu="Compliance"] [data-signoff=approved]');
    await stepUpOk();
    ok(/Signed off/.test(await page.textContent('[data-bu="Compliance"]')), 'Compliance section signed off');
    const apr = await st(`return store.list('approval', x => x.projectId === a && x.bu === 'Compliance').map(x => ({ s: x.stepUp, d: x.decision, by: x.approver }));`, PRJ);
    ok(apr.length === 1 && apr[0].s === true && apr[0].by === 'ps', 'approval saved with stepUp');
    ok(await st(`return store.list('notification', n => n.to === 'ta' && /Compliance/.test(n.text)).length;`), 'project owner notified');
    ok(/2 distinct approvers/.test(await page.textContent('.rl-two')), 'two-person rule now shows 2 approvers');

    /* ---------- 4. profile sample extract -> drift ---------- */
    console.log('Testing: profile + drift');
    await open(`/testing/${PRJ}?de=D2`);
    ok(await page.$('[data-tests-check=fail]'), 'tests-passed strip shows failing');
    await page.click('[data-prof-sample]');
    await page.waitForSelector('.ts-driftsum', { timeout: 15000 }); await settle();
    const prof = await page.textContent('.ts-main .card');
    ok(/Raw values were not stored/.test(prof), 'raw-values note shown');
    ok(/routing.number/i.test(prof) && /length 8–9|9\{8\}/.test(prof) && /routing_number[\s\S]*length-mismatch/.test(await page.textContent('.ts-tbl')), 'drift flags the 8-digit routing number');
    const raw = await st(`const p = store.list('profile', x => x.dataId === 'D2')[0]; const de = store.get('dataElement', 'D2'); const vals = de.sampleCsv.split('\\n').slice(1, 6).join(',').split(',').filter(v => v.length > 4); return vals.filter(v => JSON.stringify(p).includes(v)).length;`);
    ok(raw === 0, 'stored profile contains no raw sample values');
    await shot('03-testing-profile');

    /* ---------- 5. generate tests, custom case CRUD ---------- */
    console.log('Testing: cases');
    await page.click('[data-gen]'); await page.waitForSelector('.toast >> text=/Generated \\d+ test case/', { timeout: 60000 }); await settle();
    const nCases = await st(`return store.list('testCase', c => c.dataId === 'D2').length;`);
    ok(nCases >= 10, 'generated test cases saved: ' + nCases);
    await page.click('[data-gen]'); await page.waitForTimeout(800);
    ok(await st(`return store.list('testCase', c => c.dataId === 'D2').length;`) === nCases, 'regenerate skips duplicates');
    await page.click('[data-add-case]');
    await page.selectOption('.overlay select[name=field]', 'Account number');
    await page.fill('.overlay input[name=input]', '000123');
    await page.selectOption('.overlay select[name=expect]', 'reject');
    await page.click('.overlay [data-act=save]'); await settle();
    const cid = await st(`return (store.list('testCase', c => c.origin === 'user' && c.input === '000123')[0] || {}).id;`);
    ok(!!cid, 'custom case added');
    await page.click(`[data-edit-case="${cid}"]`);
    await page.fill('.overlay input[name=note]', 'Short accounts are rejected by the bank file');
    await page.click('.overlay [data-act=save]'); await settle();
    ok(/rejected by the bank file/.test(await page.textContent(`tr[data-case="${cid}"]`)), 'custom case edited');
    await page.click(`[data-del-case="${cid}"]`); await page.click('.overlay [data-act=del]'); await settle();
    ok(!(await st(`return !!store.get('testCase', a);`, cid)), 'custom case deleted');

    /* ---------- 6. record dev run with a failure -> discovered requirement ---------- */
    console.log('Testing: runs + discovered requirement');
    const recordRun = async (env, failOne) => {
      await page.click('[data-record]');
      await page.waitForSelector('.overlay .ts-case');
      await page.selectOption('.overlay select[name=env]', env);
      await page.click('.overlay [data-all=pass]');
      if (failOne) { const sel = await page.$('.overlay .ts-case select'); await sel.selectOption('fail'); await page.fill('.overlay .ts-case input', 'Validator returned 500'); }
      await page.click('.overlay [data-act=save]'); await page.waitForTimeout(1500);
    };
    await recordRun('dev', true);
    const runs1 = await st(`return store.list('testRun', r => r.projectId === a).length;`, PRJ);
    ok(runs1 >= 2, 'dev run saved');
    await page.waitForSelector('[data-discover]');
    await page.click('[data-discover]');
    await page.waitForSelector('.overlay textarea[name=text]');
    await page.click('.overlay [data-act=log]'); await page.waitForTimeout(1200);
    const disc = await st(`const tc = store.list('testRun', r => r.projectId === a).sort((x, y) => y.at.localeCompare(x.at))[0].results.find(r => r.outcome === 'fail'); const c = store.get('testCase', tc.caseId); const de = store.get('dataElement', c.dataId); return { n: (de.discovered || []).length, owner: de.owner, de: de.id };`, PRJ);
    ok(disc.n >= 1, 'discovered requirement appended to data element ' + disc.de);
    ok(await st(`return store.list('notification', n => n.to === a.owner && n.ref === 'dataElement:' + a.de).length;`, disc), 'data owner notified of discovered requirement');
    await shot('04-testing-runs');
    await recordRun('uat', false);
    await recordRun('dev', false);
    await settle();
    await page.goto(`${ROOT}/testing/${PRJ}?de=${disc.de}`); await page.waitForSelector('.ts-main'); await page.waitForTimeout(1500);
    ok(/Logged discovered requirement/.test(await page.textContent('.ts-act')), 'history panel shows the discovered-requirement change');

    /* ---------- 7. drive the gate to passing ---------- */
    console.log('Drive gate to pass');
    await st(`
      for (const w of store.list('workItem', w => w.projectId === a && w.status !== 'done')) await store.save('workItem', w.id, Object.assign({}, w, { status: 'done' }), 'Marked ' + w.title + ' done (e2e)');
      const E = window.PMOEngine; const chk = E.readiness(store.state.docs, a, store.state.today).checks.find(c => c.id === 'data-live');
      for (const d of chk.items) { const de = store.get('dataElement', d); await store.save('dataElement', d, Object.assign({}, de, { avail: 'live' }), de.name + ' is live (e2e)'); }
    `, PRJ);
    /* new test cases for any data that now needs them run in UAT/dev: re-record both runs */
    await open('/testing/' + PRJ);
    await recordRun('uat', false); await recordRun('dev', false);
    await open('/release/' + PRJ);
    /* close the pending grant: data owner denies it */
    const pend = await st(`return store.list('grant', g => g.projectId === a && g.status === 'requested').map(g => ({ id: g.id, owner: store.get('dataElement', g.dataId).owner }));`, PRJ);
    for (const g of pend) { await setMe(g.owner); await page.click(`tr[data-grant="${g.id}"] [data-gact=deny]`); await settle(); }
    ok(await st(`return store.list('grant', g => g.projectId === a && g.status === 'requested').length === 0;`, PRJ), 'pending grants denied by owners');
    /* every remaining BU signs off, through the UI, as a person from that BU */
    const bus = await page.$$eval('.rl-bu:not(.approved)', els => els.map(e => e.dataset.bu));
    const people = await st(`return store.state.people;`);
    for (const bu of bus) {
      const p = people.find(x => x.bu === bu); if (!p) continue;
      await setMe(p.id);
      await page.click(`[data-bu="${bu}"] [data-signoff=approved]`);
      await stepUpOk();
    }
    ok((await page.$$('.rl-bu.approved')).length === (await page.$$('.rl-bu')).length, 'all BU sections signed off');
    await setMe('ta');
    ok(await page.$('[data-gate=pass]'), 'gate passes');
    ok(!(await page.$eval('[data-golive]', b => b.disabled)), 'go-live enabled');
    await shot('05-release-pass');

    /* ---------- 8. go-live ---------- */
    console.log('Go-live');
    const vBefore = await st(`return Object.fromEntries(store.get('project', a).processes.map(p => [p, store.get('process', p).version]));`, PRJ);
    await page.click('[data-golive]');
    await page.waitForSelector('.overlay .rl-sum');
    ok(/v\d → v\d/.test(await page.textContent('.overlay .rl-sum')), 'confirm modal summarises version promotion');
    await page.click('.overlay [data-act=go]');
    await stepUpOk();
    await page.waitForSelector('.rl-latest.fresh', { timeout: 20000 }); await settle();
    const rec = await page.textContent('.rl-latest');
    ok(/dispatches/.test(rec) && /workflow|release\.yml/.test(rec), 'release shows the simulated workflow_dispatch request');
    ok(/Simulated/.test(rec), 'release actions labelled Simulated');
    const vAfter = await st(`return Object.fromEntries(store.get('project', a).processes.map(p => [p, store.get('process', p).version]));`, PRJ);
    ok(Object.keys(vBefore).every(k => vAfter[k] === vBefore[k] + 1), 'process versions incremented: ' + JSON.stringify(vAfter));
    ok(Object.keys(vAfter).every(k => rec.includes('v' + vAfter[k])), 'release record lists released versions');
    ok(await page.$('[data-gate=live]'), 'gate shows released');
    await shot('06-released');

    /* ---------- 9. reload persistence + history ---------- */
    console.log('Reload persistence');
    await page.reload(); await page.waitForSelector('.rl-latest', { timeout: 20000 }); await page.waitForTimeout(1500);
    ok(await page.$('[data-gate=live]'), 'project still live after reload');
    ok(/Release history/.test(await page.textContent('#app')), 'release history listed');
    ok(await st(`return store.list('grant', g => g.projectId === a && g.status === 'active').length === 0;`, PRJ), 'grants closed at go-live');
    const audit = await page.textContent('[data-rl-history]');
    ok(/went live/.test(audit) && /section of/.test(audit), 'gate audit log shows approvals and go-live');

    /* ---------- 10. Import SOP ---------- */
    console.log('Import SOP');
    await open('/import');
    await page.click('[data-sample]'); await settle();
    ok((await page.inputValue('[data-sop]')).includes('Contractor Onboarding'), 'sample SOP filled');
    await page.click('[data-draft]');
    await page.waitForSelector('.is-step', { timeout: 30000 }); await settle();
    const nSteps = (await page.$$('.is-step')).length;
    ok(nSteps >= 8, 'draft has ' + nSteps + ' steps');
    ok(/\b(AI|Rules)\b/.test(await page.textContent('.is-src')), 'source label shown: ' + (await page.textContent('.is-src')));
    const t0 = await page.inputValue('.is-step[data-i="0"] .is-title');
    await page.click('.is-step[data-i="0"] [data-mv="1"]'); await settle();
    ok((await page.inputValue('.is-step[data-i="1"] .is-title')) === t0, 'reorder moves the step down');
    await page.click(`.is-step[data-i="${nSteps - 1}"] [data-rm]`); await settle();
    ok((await page.$$('.is-step')).length === nSteps - 1, 'remove drops a step');
    await page.fill('.is-step[data-i="0"] .is-title', 'Collect the signed W-9 and tax ID');
    await page.selectOption('.is-step[data-i="0"] select[data-f=owner]', 'mc');
    await page.click('.is-step[data-i="0"] .is-data summary');
    await page.check('.is-step[data-i="0"] input[data-f=data][value=D1]'); await settle();
    await shot('07-import-draft');
    await page.click('[data-create]');
    await page.waitForSelector('.overlay input[name=name]');
    await page.fill('.overlay input[name=name]', 'Contractor onboarding (imported)');
    await page.click('.overlay [data-act=create]');
    await page.waitForURL(/\/process\/proc-[\w-]+\?mode=edit/, { timeout: 15000 });
    ok(/mode=edit/.test(page.url()), 'lands on the new process in edit mode');
    const newPid = page.url().match(/process\/([\w-]+)/)[1];
    await page.waitForTimeout(1500);
    await page.reload(); await page.waitForSelector('#app .hdr', { timeout: 20000 }); await settle();
    const proc = await st(`const p = store.get('process', a); return p && { v: p.version, n: p.asis.length, t: p.asis[0].type, e: p.asis[p.asis.length - 1].type, from: p.tobe.every((n, i) => n.from === p.asis[i].id && n.id !== p.asis[i].id), s1: p.asis[1] };`, newPid);
    ok(proc && proc.v === 1 && proc.t === 'trigger' && proc.e === 'end' && proc.n === nSteps - 1 + 2, 'process persisted: v1, trigger + steps + end');
    ok(proc && proc.from, 'to-be is a copy with fresh ids and from links');
    ok(proc && proc.s1.title === 'Collect the signed W-9 and tax ID' && proc.s1.owner === 'mc' && proc.s1.data.includes('D1'), 'draft edits carried into the process');
    await shot('08-imported-process');

    /* ---------- 11. widths ---------- */
    console.log('Widths');
    for (const [w, h] of [[1440, 1000], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const p of ['/release/' + PRJ, '/release/access-review-automation', '/testing/' + PRJ, '/import']) {
        await open(p);
        if (p === '/import') { await page.click('[data-sample]'); await settle(); }
        ok(await overflow(), `no horizontal overflow of page content at ${w}: ${p}`);
        if (!(await docOverflow())) chromeWarn.add(`${w}px: document scrollWidth ${await page.evaluate(() => document.documentElement.scrollWidth)} (top bar)`);
        if (w === 390) await shot('m-' + p.replace(/\//g, '_').replace(/^_/, ''));
      }
    }
    if (chromeWarn.size) console.log('  ! WARN (lead-owned chrome): ' + [...chromeWarn].join('; '));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open('/release/access-review-automation');
    await shot('09-release-other');
  } catch (e) {
    failed++; console.log('  ✗ threw: ' + (e && e.stack || e));
    try { await shot('zz-failure'); } catch (x) { /* ignore */ }
  }

  ok(errors.length === 0, 'zero page/console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' || ') : ''));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
