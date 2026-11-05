/* E2E for stream R (round 7: Simple mode first: one-sentence launch status, approve-my-part from home in 3 actions while
   other checks fail, "Choose who approves" deadlock fix, one-sentence testing answer, plain words; then the full Advanced flow.
   Round 6: approver view, attestation, chronological audit, rollback pipeline, hypercare, grant box from approval,
   one-shot tests, traceability, JUnit mapping, defect lifecycle, import data/kinds; round 4/5 coverage kept): gate evidence independence, cutover runbook, simulated pipeline status, testing depth,
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
  const ip = `10.${(Math.random()*250|0)+1}.${(Math.random()*250|0)+1}.${(Math.random()*250|0)+1}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  let expect403 = false; /* intentional permission probes: the browser logs the refused request */
  page.on('console', m => { if (m.type() === 'error' && !(expect403 && /403 \(Forbidden\)/.test(m.text()))) errors.push('console: ' + m.text()); });

  const settle = (ms) => page.waitForTimeout(ms || 450);
  const shot = name => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const open = async path => { await page.goto(ROOT + path); await page.waitForSelector('#app .hdr, #app h1', { timeout: 20000 }); await settle(); };
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
  const dismiss = async () => { for (let i = 0; i < 4 && await page.$('.overlay'); i++) { await page.click('.overlay [data-act=cancel]'); await settle(400); } };
  const txt = async sel => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ');
  const setAdv = async v => { await page.evaluate(async on => { const { store } = await import('/concepts/pmoflow/app/store.js'); store.setAdvanced(on); }, v); await settle(500); };
  const JARGON = /\b(UAT|SIT|JUnit|Go\/no-go|Hypercare|Runbook|Cutover|Attestation|Step-up)\b/i;
  /* user-entered text (step titles, cycle names, notes) is data, not UI: it is set aside before reading the page */
  const jargonFree = async label => { const t = await page.evaluate(() => { const els = [...document.querySelectorAll('[data-user-text]')]; els.forEach(e => { e.dataset.d = e.style.display; e.style.display = 'none'; }); const v = document.body.innerText; els.forEach(e => { e.style.display = e.dataset.d; }); return v; }); const m = t.match(JARGON); ok(!m, `no jargon visible in Simple mode: ${label}${m ? ' (found “' + m[0] + '” near “' + t.slice(Math.max(0, m.index - 40), m.index + 30).replace(/\s+/g, ' ') + '”)' : ''}`); };
  /* R8: complete one team's own evidence (its work, its information, its tests) so its approval is ready */
  const makeReady = (p, bu) => st(`const E = window.PMOEngine; const r = E.buReady(store.state.docs, a.p, a.bu); const now = new Date().toISOString();
    for (const w of r.waiting) {
      if (w.kind === 'work') for (const id of w.items) { const x = store.get('workItem', id); await store.save('workItem', id, Object.assign({}, x, { status: 'done', doneAt: store.state.today, updatedAt: now }), 'Done (e2e)'); }
      if (w.kind === 'information') for (const id of w.items) { const d = store.get('dataElement', id); await store.save('dataElement', id, Object.assign({}, d, { avail: 'live', liveEvidence: { type: 'attested', ref: 'https://northwind.example/evidence/' + id } }), 'Available (e2e)'); }
      if (w.kind === 'tests') { const id = 'run-ready-' + a.bu.replace(/\W/g, ''); await store.save('testRun', id, { id, projectId: a.p, env: 'uat', at: now, by: 'ps', cycle: 1, results: w.items.map(k => (store.get('testCase', k) ? { caseId: k } : { scriptId: k, steps: [] })).map(x => Object.assign(x, { outcome: 'pass', note: '', evidence: 'Walked through with the ' + a.bu + ' team' })) }, 'Recorded business sign-off test (e2e)'); }
    }
    return E.buReady(store.state.docs, a.p, a.bu);`, { p, bu });
  const actions = { n: 0 }; const act = async fn => { actions.n++; await fn(); };

  async function simpleTesting() {
    await setAdv(false);
    console.log('Testing: two stages, one number, one "Create the tests"');
    await setMe('ta');
    const truth = () => st(`return window.PMOEngine.projectTruth(store.state.docs, a, store.state.today).testing;`, VM);
    for (const [w, h] of [[1366, 768], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await open('/testing/' + VM);
      const box = await page.$eval('[data-testing-sentence]', e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; });
      const sen = (await txt('[data-testing-sentence]')).trim();
      const tt = await truth();
      ok(box.top >= 0 && box.bottom <= box.h && sen === tt.sentence, `${w}×${h}: the answer is one sentence from projectTruth, visible without scrolling: ${sen.slice(0, 70)}…`);
      ok(await page.getAttribute('[data-tests-number]', 'data-tests-number') === `${tt.passed}/${tt.total}` && new RegExp(`^${tt.passed} of ${tt.total}`).test((await txt('[data-tests-number]')).trim()), `one number from projectTruth: ${tt.count}`);
      ok(await overflow(), `no horizontal overflow at ${w}: testing`);
      await shot(`s03-testing-${w}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const lbl = async n => (await txt(`[data-guide-step="${n}"] .ts-step-h b`)).trim();
    ok((await page.$$('[data-guide-step]')).length === 4 && /Check sample data/.test(await lbl(1)) && /^Create the tests$/.test(await lbl(2)) && /Try it out/.test(await lbl(3)) && /^Business sign-off test$/.test(await lbl(4)), 'guide: Check sample data → Create the tests → Try it out → Business sign-off test');
    const createBtns = await page.$$eval('button', bs => bs.filter(b => /create (all |the )?tests|generate/i.test(b.textContent)).map(b => b.textContent.trim()));
    ok(createBtns.length === 1 && createBtns[0] === 'Create the tests' && !(await page.$('[data-next-action], [data-s-genall], [data-s-gen]')), 'exactly one "Create the tests" button (no "Generate the missing tests" / "Create all tests")');
    ok(!(await page.$('#coverage, #cycles, [data-ci], #scenarios, #defects')), 'coverage matrix, cycles, JUnit, end-to-end tests and defect lifecycle are not in Simple mode');
    const body = await page.evaluate(() => document.body.innerText);
    ok(!/\bTC\d+\b|expect (accept|reject)|coverage/i.test(body), 'no test ids, "expect accept/reject" or coverage language in Simple');
    await jargonFree('testing page');
    /* only information the project changes needs tests */
    const tc = await check(VM, 'tests-passed');
    const shown = await page.$$eval('[data-s2]', e => e.map(x => x.dataset.s2));
    ok(shown.length === tc.changedData.length && shown.every(d => tc.changedData.includes(d)), `only information the project changes is listed for tests (${shown.join(', ')})`);
    /* "Check sample data" is Done only after a sample was actually checked */
    const anyProf = await st(`return a.some(d => store.list('profile', p => p.dataId === d).length);`, tc.changedData);
    if (!anyProf) ok(!(await page.$('[data-guide-step="1"].done')), '"Check sample data" is not Done before any sample was checked');
    const sampled = await page.$('[data-s-prof]');
    if (sampled) {
      const did = await sampled.getAttribute('data-s-prof');
      await sampled.click();
      await page.waitForSelector(`[data-s1="${did}"] [data-col-line]`, { timeout: 15000 }); await settle(400);
      const lines = await page.$$eval(`[data-s1="${did}"] [data-col-line]`, e => e.map(x => x.textContent.trim()));
      ok(lines.length > 0 && lines.every(l => /^[^:]+: \d+ values?(, .+)?$/.test(l)), 'sample results: one plain line per column, e.g. "' + lines[0] + '"');
      ok(await page.$('[data-guide-step="1"].done'), '"Check sample data" is Done once a sample was checked');
    }
    /* one press covers ALL information, even information with no rules and no sample */
    const bare = tc.changedData.find(d => true);
    await st(`const d = store.get('dataElement', a); await store.save('dataElement', a, Object.assign({}, d, { fields: [], sampleCsv: '' }), 'Rules cleared (e2e)'); for (const c of store.list('testCase', x => x.dataId === a)) await store.remove('testCase', c.id, 'Test removed (e2e)'); for (const p of store.list('profile', x => x.dataId === a)) await store.remove('profile', p.id, 'Sample removed (e2e)');`, bare);
    await settle(800);
    await page.click('[data-s-create]');
    await page.waitForSelector('.toast >> text=/Created \\d+ tests?\\. All \\d+/', { timeout: 60000 }); await settle(1500);
    const cov = await st(`return a.map(d => store.list('testCase', c => c.dataId === d).length);`, tc.changedData);
    ok(cov.every(n => n > 0), `one press created tests for every piece of changed information, nothing skipped (${cov.join(', ')})`);
    ok((await check(VM, 'tests-passed')).noCases.length === 0, 'engine agrees: no changed information is without tests');
    await page.click('[data-s-create]');
    await page.waitForSelector('.toast >> text=/already have their tests/', { timeout: 30000 });
    ok(true, 'the button is never dead: a second press says every piece already has its tests');
    /* generated business tests are runnable without adopting; a System testing run satisfies "Try it out" */
    ok(!Array.isArray(await st(`return store.get('project', a).uatScripts;`, VM)), 'business tests were not adopted');
    await page.click('[data-s-record="sit"]'); await page.waitForSelector('.overlay .ts-case');
    ok(await page.inputValue('.overlay [data-env]') === 'sit' && (await page.$$eval('.overlay [data-env] option', o => o.map(x => x.textContent))).join('|') === 'Try it out (system test)|Business sign-off test', 'record dialog offers the two stages in plain words');
    ok(!/\bTC\d+\b|expect (accept|reject)/.test(await txt('.overlay')) && /should be (accepted|rejected)/.test(await txt('.overlay')), 'record dialog: no test ids, "should be accepted/rejected" instead');
    await jargonFree('record dialog');
    await page.check('.overlay [data-pick-all]');
    await page.fill('.overlay [data-bulk-ev]', 'Tried in the test system');
    await page.click('.overlay [data-bulk-pass]'); await settle(200);
    await page.click('.overlay [data-act=save]'); await settle(1500); await dismiss();
    const sys = (await truth()).stages.find(x => x.key === 'system');
    ok(sys.run && sys.done && await page.$('[data-guide-step="3"].done') && await page.getAttribute('[data-stage="try"]', 'data-stage-done') === '1', 'a System testing run satisfies "Try it out" (engine and page)');
    await page.click('[data-s-record="uat"]'); await page.waitForSelector('.overlay .ts-case');
    ok(await page.$('.overlay [data-script-row]'), 'generated business tests are in the run without adopting them');
    await page.check('.overlay [data-pick-all]');
    await page.fill('.overlay [data-bulk-ev]', 'Walked through with the vendor team');
    await page.click('.overlay [data-bulk-pass]'); await settle(200);
    await page.click('.overlay [data-act=save]'); await settle(1500); await dismiss();
    const tt2 = await truth();
    ok(tt2.passed > 0 && (await txt('[data-tests-number]')).trim().startsWith(`${tt2.passed} of ${tt2.total}`), 'business sign-off results count: ' + tt2.count);
    await page.reload(); await page.waitForSelector('[data-simple-testing]'); await settle(600);
    ok(/[1-9]\d* of \d+ passed/.test(await txt('[data-s-progress]')), 'progress persists after reload: ' + (await txt('[data-s-progress]')).trim());
    await shot('s04-testing-after');
    await setAdv(true);
  }

  /* ---------- R7 simplicity checks, Simple mode (the default) ---------- */
  async function simpleChecks() {
    console.log('Simple mode is the default');
    await open('/release/' + AR);
    ok(await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); return store.advanced === false; }) && await page.$('[data-simple-launch]'), 'a new visitor gets the Simple launch page');
    const sent = await txt('[data-launch-sentence]');
    const steps = await st(`return window.PMOEngine.launchSteps(store.state.docs, a, store.state.today);`, AR);
    ok(/^Not ready: \d+ things? left$/.test(sent.trim()), 'launch page leads with one sentence: ' + sent.trim());
    ok((await page.$$('[data-launch-step]')).length === steps.length && steps.filter(x => !x.done).every(x => true), `the plain list follows E().launchSteps (${steps.length} steps)`);
    ok(await page.$('[data-launch-step="approvals"][data-done="0"] [data-who]') && await page.$('[data-launch-step="work"] [data-step-act]'), 'open steps say who acts and offer a one-tap action');
    const secOpen = await page.$$eval('details[data-sec]', ds => Object.fromEntries(ds.map(d => [d.dataset.sec, d.open])));
    const coFail = (await check(AR, 'cutover-plan')).status === 'fail' || !(await check(AR, 'cutover-plan')).pass;
    ok(secOpen.audit === false && secOpen.comments === false && secOpen.plan === coFail && secOpen.access === !(await check(AR, 'grants-closed')).pass, 'launch-day plan, temporary data access and audit log are folded; open only when they block launch: ' + JSON.stringify(secOpen));
    await jargonFree('launch page');
    await shot('s01-launch-simple');

    console.log('No section for teams whose part did not change');
    /* the seed changes every team's part, so add an unchanged Treasury step to Today and Future of access review */
    const meWas = await st(`return store.state.me;`);
    await st(`const prj = store.get('project', a); store.setMe(store.get('process', prj.processes[0]).owner);`, AR);
    const unchanged = await st(`const tr = store.state.people.find(x => x.bu === 'Treasury'); const prj = store.get('project', a); const p = store.get('process', prj.processes[0]);
      const asisN = { id: 'e2e-same-a', type: 'step', title: 'File the quarterly review pack', owner: tr.id, data: [] };
      const tobeN = Object.assign({}, asisN, { id: 'e2e-same-t', from: 'e2e-same-a' });
      const ins = (arr, n) => { const i = arr.findIndex(x => x.type === 'end'); const c = arr.slice(); c.splice(i < 0 ? c.length : i, 0, n); return c; };
      await store.save('process', p.id, Object.assign({}, p, { asis: ins(p.asis, asisN), tobe: ins(p.tobe, tobeN) }), 'Unchanged Treasury step added (e2e)');
      return window.PMOEngine.diffProcess(store.get('process', p.id)).nodes['e2e-same-t'] === 'same' ? ['Treasury'] : [];`, AR);
    await st(`store.setMe(a);`, meWas);
    await open('/release/' + AR); await page.click('details[data-sec=approvals] summary').catch(() => {}); await settle(300);
    const partsShown = await page.$$eval('[data-part]', e => e.map(x => x.dataset.part));
    ok(unchanged.length > 0 && unchanged.every(b => !partsShown.includes(b)), `teams with no changed steps get no approval section (${unchanged.join(', ')} not in ${partsShown.join(', ')})`);
    await open('/release/' + AR + '?bu=' + encodeURIComponent(unchanged[0]));
    ok(await page.$('[data-no-section]') && !(await page.$('[data-bu-decide]')), `${unchanged[0]}'s approver view says there is nothing to approve`);

    console.log('Approvals happen once: only when the part is ready');
    await setMe('ps');
    const r0 = await st(`return window.PMOEngine.buReady(store.state.docs, a, 'Compliance');`, AR);
    ok(!r0.ready && r0.waiting.length, 'Compliance is not ready yet: ' + r0.sentence);
    await open('/release/' + AR + '?bu=Compliance');
    ok(/^Not ready for your approval yet: waiting on .+\.$/.test((await txt('[data-bu-notready] b')).trim()) && !(await page.$('[data-bu-decide=approved]')), 'approver view: "' + (await txt('[data-bu-notready] b')).trim() + '" and no Approve button');
    await shot('s02a-approver-notready');
    await open('/release/' + AR);
    ok(await page.$('[data-my-notready="Compliance"]') && !(await page.$('[data-part-approve="Compliance"]')) && !(await page.$('[data-review-mine="Compliance"]')), 'launch page: "isn’t ready for your approval yet", no Approve button');
    await open('/');
    ok(!(await page.$(`[data-approve-part="${AR}"][data-bu="Compliance"]`)), 'home: no "Approve my part" before the part is ready');
    await setAdv(true);
    await open('/release/' + AR + '?bu=Compliance');
    ok(await page.$('[data-early-warning]') && await page.$('[data-bu-decide=approved]'), 'Advanced: approving early is possible, with a warning that it may need redoing');
    await setAdv(false);
    /* a bulk pass with one shared note, for the evidence summary */
    const cIds = await st(`return store.list('testCase', c => c.dataId === 'D7').map(c => c.id);`);
    if (cIds.length) await st(`const id = 'run-e2e-bulk'; await store.save('testRun', id, { id, projectId: a.p, env: 'uat', at: new Date().toISOString(), by: 'ps', cycle: 1, results: a.ids.map(caseId => ({ caseId, outcome: 'pass', note: '', evidence: 'Checked every row with the access team' })) }, 'Recorded business testing run (e2e)');`, { p: AR, ids: cIds });
    const r1 = await makeReady(AR, 'Compliance');
    ok(r1.ready, 'once its work, information and tests are complete, Compliance is ready: ' + r1.sentence);
    console.log('Approve my part from home in 3 actions, while other checks fail');
    await open('/');
    actions.n = 0;
    ok(!(await rd(AR)).pass, 'the gate is still failing (other checks open)');
    await act(() => page.click(`[data-approve-part="${AR}"][data-bu="Compliance"]`));
    await page.waitForSelector('[data-simple-approver]'); await settle(500);
    ok(await page.$('[data-bu-step]') && (!(await page.$('[data-bu-data]')) || /We have it|Not available yet|Connected|Sample only|Waiting/.test(await txt('[data-bu-data]'))), 'approver view: what changed in plain words and information status');
    const evl = await txt('[data-evidence-line]');
    ok(/\d+ business tests? passed by Priya on [A-Z][a-z]{2} \d+: “/.test(evl), 'evidence summary in one line: ' + evl.trim().slice(0, 100));
    ok(await page.$('[data-passed-together]'), 'a bulk pass with one shared note is flagged "passed together"');
    const facts = await st(`return window.PMOEngine.approvalNoteFacts(store.state.docs, a, 'Compliance').text;`, AR);
    ok(facts && await page.inputValue('[data-attest]') === facts && /changed steps? reviewed/.test(facts) && /tests? passed/.test(facts), '"What you checked" is prefilled from facts: ' + facts);
    await jargonFree('approver view');
    await shot('s02-approver-simple');
    await act(() => page.click('[data-bu-decide=approved]'));
    await page.waitForSelector('.overlay input[name=code]');
    ok(/Extra sign-in check/.test(await txt('.overlay h2')), 'the extra sign-in check is called that, in plain words');
    await jargonFree('extra sign-in check dialog');
    await act(() => stepUpOk());
    ok(actions.n <= 3, `approved from home in ${actions.n} actions (open, approve, sign-in check)`);
    await page.waitForSelector('[data-part-approved]', { timeout: 10000 }); await settle(500);
    const apr = await st(`return store.list('approval', x => x.projectId === a && x.bu === 'Compliance').sort((x, y) => y.at.localeCompare(x.at))[0];`, AR);
    ok(apr && apr.approver === 'ps' && apr.decision === 'approved' && apr.stepUp && /changed steps? reviewed/.test(apr.attestation) && apr.fingerprint, 'approval saved with what was checked, the sign-in check and a fingerprint');
    const bu0 = await check(AR, 'bu-signoff');
    ok(!(bu0.unsigned || []).includes('Compliance') && !(await rd(AR)).pass, 'the engine counts it even though the gate still fails');
    ok(/Your part is approved/.test(await txt('[data-part-approved]')) && (await page.$$('[data-still-needs] li')).length >= 1, '"Your part is approved. The launch still needs: ' + (await page.$$eval('[data-still-needs] li', l => l.map(x => x.firstChild.textContent).join(', '))) + '"');
    await page.reload(); await page.waitForSelector('[data-simple-approver]'); await settle(500);
    ok(/Approved by Priya Shah/.test(await txt('.rs-sub')), 'approval persists after reload');
    await open('/release/' + AR);
    ok(await page.$('[data-my-approved]') && await page.$('[data-part="Compliance"][data-state="approved"]'), 'launch page shows your part approved');
    await page.click('details[data-sec=audit] summary');
    await page.waitForFunction(() => { const b = document.querySelector('[data-rl-history]'); return b && !/Loading/.test(b.textContent); }, null, { timeout: 10000 });
    ok(/Approved the Compliance part/.test(await txt('[data-rl-history]')), 'audit log (history) shows the approval');

    console.log('Deadlock: choose who approves');
    await setMe('mc');
    await st(`const p = store.get('process', 'vendor-onboarding'); const tobe = p.tobe.map(n => n.type === 'trigger' ? Object.assign({}, n, { touches: (n.touches || []).concat(['PMO']) }) : n); await store.save('process', p.id, Object.assign({}, p, { tobe }), 'What starts it now involves PMO (e2e)');`);
    await setMe('ta');
    await st(`const p = store.get('project', a); await store.save('project', a, Object.assign({}, p, { approvers: {} }), 'Chosen approvers cleared (e2e)');`, VM);
    await open('/release/' + VM); await settle(400);
    const buV = await check(VM, 'bu-signoff');
    ok((buV.needsApprover || []).includes('PMO') && await page.$('[data-part="PMO"][data-state="nobody"]'), 'PMO part: only the PM belongs to it, so nobody can approve (UI and engine agree)');
    ok(await page.$eval('details[data-sec=approvals]', d => d.open) && await page.$('[data-choose="PMO"]') && /Choose who approves this part/.test(await txt('[data-choose="PMO"]')), '"Choose who approves this part" is shown, opened, to the PM');
    const optsV = await page.$$eval('[data-choose-sel="PMO"] option', o => o.map(x => x.value));
    const vmRm = await st(`const p = store.get('project', a); return p.releaseManager || p.owner;`, VM);
    ok(!optsV.includes('ta') && !optsV.includes(vmRm), 'the picker never offers the PM or the launch owner');
    ok(await page.inputValue('[data-choose-sel="PMO"]') === 'mc', 'default suggestion is the process owner (Maya Chen)');
    await page.click('[data-choose-save="PMO"]'); await settle(900);
    ok(await st(`return store.get('project', a).approvers.PMO;`, VM) === 'mc', 'saved to project.approvers {PMO: mc}');
    await setMe('mc'); await open('/');
    await page.click(`[data-approve-part="${VM}"][data-bu="PMO"]`); await page.waitForSelector('[data-simple-approver]'); await settle(400);
    await page.click('[data-bu-decide=approved]'); await stepUpOk();
    await page.waitForSelector('[data-part-approved]', { timeout: 10000 });
    const buV2 = await check(VM, 'bu-signoff');
    ok(!(buV2.needsApprover || []).includes('PMO') && !(buV2.unsigned || []).includes('PMO'), 'deadlock resolved: the chosen person approved the PMO part and the engine counts it');
    await st(`const p = store.get('process', 'vendor-onboarding'); const tobe = p.tobe.map(n => n.type === 'trigger' ? Object.assign({}, n, { touches: (n.touches || []).filter(t => t !== 'PMO') }) : n); await store.save('process', p.id, Object.assign({}, p, { tobe }), 'PMO tag removed (e2e)');`);


    console.log('Import: plain words and free-text roles');
    await open('/import');
    await page.fill('[data-sop]', 'Leave request\nThe process starts when an employee asks for leave.\n1. The employee fills in the leave form with the dates.\n2. The manager approves the leave request.\n3. Ana Ruiz updates the payroll calendar.');
    await page.click('[data-draft]'); await page.waitForSelector('.is-step', { timeout: 30000 }); await settle();
    const roles = await page.$$eval('[data-owner-role]', e => e.map(x => x.textContent.trim()));
    ok(roles.includes('Who: Manager') && roles.includes('Who: Employee'), 'free-text roles appear as "Who: Manager" / "Who: Employee": ' + roles.join(', '));
    ok(await page.$('.is-who') && !(await page.$('.is-sys')) && !(await page.$('.is-src')), 'Simple step card: one "Who does it" box; system field and parser source hidden');
    await jargonFree('import draft');
    await shot('s05-import-simple');

    console.log('Import: the R8 phrasing set never assigns the current user');
    for (const me of ['ps', 'mc']) {
      await setMe(me);
      await open('/import');
      await page.fill('[data-sop]', `Purchase request
Owner: Procurement
The process starts when an employee asks to buy something.
1. Procurement creates the purchase order in the ERP within 2 business days.
2. If the amount is over $10,000, the Compliance analyst reviews the budget code and the quotes; otherwise skip to step 4.
3. Wait for the supplier quotes.
4. Ana Ruiz approves the cost centre.`);
      await page.click('[data-draft]'); await page.waitForSelector('.is-step', { timeout: 30000 }); await settle();
      const who = await page.$$eval('.is-who', e => e.map(x => x.value));
      const meName = await st(`return store.person(store.state.me).name;`);
      ok(!who.includes(meName) && !(await page.$(`[data-owner-person="${me}"]`)), `viewing as ${meName}: no step is assigned to the current user (${who.filter(Boolean).join(', ')})`);
      const roles = await page.$$eval('[data-owner-role]', e => e.map(x => x.textContent.trim()));
      ok(roles.includes('Who: Procurement'), 'a team is shown as "Who: Procurement": ' + roles.join(', '));
      ok(who.includes('Ana Ruiz'), 'a full person name becomes that person (Ana Ruiz)');
      ok(await page.$('[data-found]') && /^We found \d+ steps?/.test((await txt('[data-found] b')).trim()), 'what was found, in one line: ' + (await txt('[data-found]')).trim());
      ok((await txt('[data-create]')).trim() === 'Save as how it works today', 'the save button reads "Save as how it works today"');
    }
    await shot('s06-import-r8');

    console.log('Simple pages: no overflow at 390');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const pth of ['/release/' + AR, '/release/' + AR + '?bu=Compliance', '/release/' + VM, '/testing/' + AR, '/import']) {
      await open(pth); ok(await overflow(), `Simple, no overflow at 390: ${pth}`);
      if (pth !== '/import') await jargonFree('390 ' + pth);
      await shot('s-m-' + pth.replace(/[\/?=]/g, '_').replace(/^_/, ''));
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }


  try {
    await simpleChecks();
    /* ---------- Advanced mode from here: the full gate and go-live coverage ---------- */
    await setAdv(true);
    /* ---------- 1. pending data: fix done, awaiting owner confirmation ---------- */
    console.log('Gate evidence: pending data needs the owner');
    await open('/release/' + AR);
    await st(`
      const de = store.get('dataElement', 'D7'); const d = Object.assign({}, de, { avail: 'missing' });
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
    ok(/Approver matrix/.test(pend) && /Waiting for Dev Kumar to confirm it's connected/.test(pend), 'pending item reads "Waiting for Dev Kumar to confirm it\'s connected": ' + pend.trim().slice(0, 90));
    ok(/\/data\/D7$/.test(await page.getAttribute('details[data-check=data-live] [data-confirm-link]', 'href')), 'pending item links to the data page');

    /* ---------- 2. R7: no sign-off lock; owner excluded ---------- */
    console.log('No sign-off lock; project manager excluded');
    ok(!(await rd(AR)).pass && !(await page.$('[data-signoff-locked]')), 'gate failing, yet there is no sign-off lock');
    await setMe('ps');
    ok(await page.$('[data-bu="Compliance"] [data-signoff=approved]') && !(await page.$('[data-bu="Compliance"] [data-locked]')), 'Compliance person has an active Approve button while other checks fail (the A9 change made the Simple-mode approval stale)');
    ok(/Dev Kumar approved/.test(await txt('[data-bu="IT"] .rl-signed')), 'existing IT approval still shows');
    await setMe('ta');
    ok(/Project managers can't approve their own project/.test(await txt('[data-bu="Compliance"] [data-why=owner]')), 'project manager: "Project managers can\'t approve their own project."');
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
      await page.fill(`${row} >> [data-td]`, '30');
      if (gng) await page.check(`${row} >> [data-tg]`);
    };
    await fillTask(0, 'Freeze manual access changes', 'dk', '2026-11-14T08:00', false);
    await page.click('.overlay [data-tadd]');
    await fillTask(1, 'Go/no-go call with Compliance', '', '2026-11-14T08:30', true);
    await page.click('.overlay [data-tadd]');
    await fillTask(2, 'Enable the auto-removal job', 'dk', '2026-11-14T09:00', false);
    await page.click('.overlay [data-act=save]'); await settle(300);
    ok(await page.$('.overlay [data-err]:not([hidden])') && /final yes\/no check, so it needs an owner/.test(await txt('.overlay [data-err]')), 'final yes/no step without an owner: dialog stays open with the reason');
    await page.selectOption('.overlay [data-trow] >> nth=1 >> [data-to]', 'ps');
    await page.click('.overlay [data-act=save]'); await settle(1000);
    const tasks = await st(`return store.get('project', a).cutover.tasks;`, AR);
    const gngId = tasks[1].id;
    ok(tasks.length === 3 && tasks[1].gonogo && tasks[1].owner === 'ps' && /^2026-11-14T08:30/.test(tasks[1].plannedStart) && tasks[1].durationMins === 30, 'runbook saved in order with plannedStart and durationMins; the go/no-go task is owned by Priya Shah');
    /* overdue: a task whose planned end has passed shows a warning */
    await st(`const p = store.get('project', a); const c = Object.assign({}, p.cutover, { tasks: p.cutover.tasks.map((t, i) => i === 2 ? Object.assign({}, t, { plannedStart: '2026-01-05T09:00' }) : t) }); await store.save('project', a, Object.assign({}, p, { cutover: c }), 'Task moved into the past (e2e)');`, AR);
    await settle(800);
    ok(await page.$(`[data-rbtask="${tasks[2].id}"][data-overdue]`) && /1 launch-day step is overdue/.test(await txt('[data-runbook-overdue]')), 'overdue runbook task: warning on the runbook and an "Overdue" badge');
    await st(`const p = store.get('project', a); const c = Object.assign({}, p.cutover, { tasks: p.cutover.tasks.map((t, i) => i === 2 ? Object.assign({}, t, { plannedStart: '2026-11-14T09:00' }) : t) }); await store.save('project', a, Object.assign({}, p, { cutover: c }), 'Task moved back (e2e)');`, AR);
    await settle(800);
    ok(!(await page.$('[data-runbook-overdue]')), 'warning clears once the task is back on schedule');
    /* checklist density: one line per check, detail on demand, plain labels */
    const lines = await page.$$eval('details[data-check] summary', ss => ss.map(x => x.getBoundingClientRect().height));
    ok(lines.length >= 8 && lines.every(h => h < 44), `checklist is one line per check (${lines.length} rows, max ${Math.round(Math.max(...lines))}px)`);
    ok(!(await page.$$eval('details[data-check] [data-plain]', els => els.some(e => /\b(SIT|UAT|CP)\b|go\/no-go/i.test(e.textContent)))), 'check labels are plain language (no SIT, UAT, CP or go/no-go jargon)');
    ok(await page.$('details[data-check=cutover-plan] summary[title*="cutover"]'), 'professional term kept in a tooltip (cutover)');
    await page.click('details[data-check=work-done] summary'); await settle(200);
    ok(await page.isVisible('details[data-check=work-done] [data-detail]') && /Hide detail/.test(await txt('details[data-check=work-done] .rl-more')), '"Show detail" expands the check and turns into "Hide detail"');
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
    /* the release manager can't sign a BU section */
    await setMe('ta');
    await st(`const p = store.get('project', a); await store.save('project', a, Object.assign({}, p, { releaseManager: 'ps' }), 'Release manager set to Priya Shah (e2e)');`, AR); await settle(700);
    await setMe('ps');
    ok(await page.$('[data-no-approver="Compliance"] [data-choose="Compliance"]') && !(await page.$('[data-bu="Compliance"] [data-signoff=approved]')), "launch owner (Priya) can't approve Compliance; as its only member that is a deadlock, so the card offers “Choose who approves this part”");
    await setMe('ta');
    await st(`const p = store.get('project', a); await store.save('project', a, Object.assign({}, p, { releaseManager: 'mc' }), 'Release manager set to Maya Chen (e2e)');`, AR); await settle(700);
    ok(/Maya Chen/.test(await txt('[data-rm]')), 'header shows the new release manager, Maya Chen');
    const signAll = async () => {
      for (let k = 0; k < 3; k++) {
        const need = await page.$$eval('.rl-bu.stale, .rl-bu.pending', els => els.map(e => e.dataset.bu));
        if (!need.length) break;
        for (const bu of need) { await setMe(bu === 'IT' ? 'dk' : 'ps'); await page.click(`[data-bu="${bu}"] [data-signoff=approved]`);
          await page.waitForSelector('.overlay [data-attest-modal]'); await page.fill('.overlay [data-attest-modal]', `I reviewed the ${bu} steps, data evidence and UAT results (e2e).`);
          await page.click('.overlay [data-act=go]'); await stepUpOk(); }
      }
    };
    /* R6 approver view: one screen for one BU, attestation required */
    await setMe('ps');
    ok(await page.$('[data-review-mine="Compliance"]'), '"Review my section" shows for the persona\'s BU (Compliance)');
    ok(await page.$('[data-bu="IT"] [data-bu-review="IT"]') && await page.$('[data-bu="Compliance"] [data-bu-review]'), 'each BU card links to its review screen');
    await page.click('[data-review-mine]'); await page.waitForSelector('[data-bu-view="Compliance"]'); await settle(500);
    ok(/[?&]bu=Compliance/.test(page.url()), 'approver view route: /release/:prj?bu=Compliance');
    ok((await page.$$('[data-bu-step]')).length >= 1 && await page.$('[data-bu-data], .rl-bv-data, .empty') && await page.$('[data-bu-test], .rl-bv-tests, .empty') && /Open defects/.test(await txt('.rl-bv')) && /Changes since last approval/.test(await txt('.rl-bv')), 'approver view shows steps, data and evidence, test results, open defects and changes since sign-off');
    ok(!(await page.$('[data-bu-step] a[href*="access-review"]')) || (await page.$$eval('[data-bu-step]', els => els.length)) < 4, 'only this BU\'s steps are listed');
    await page.click('[data-bu-decide=approved]'); await settle(300);
    ok(/what you checked/i.test(await txt('[data-attest-err]')) && !(await page.$('.overlay input[name=code]')), 'Approve with an empty "What you checked" is refused inline, before the extra sign-in check');
    await page.fill('[data-attest]', 'Reviewed the certification step, approver matrix evidence and the UAT pass (e2e).');
    await page.click('[data-bu-decide=approved]'); await stepUpOk(); await settle(600);
    const aprC = await st(`return store.list('approval', x => x.projectId === a && x.bu === 'Compliance').sort((x, y) => y.at.localeCompare(x.at))[0];`, AR);
    ok(aprC && aprC.decision === 'approved' && /certification step/.test(aprC.attestation) && aprC.stepUp && /^s:/.test(aprC.fingerprint || ''), 'approval stores what was checked, the extra sign-in check and the section fingerprint');
    ok(/certification step/.test(await txt('[data-attestation]')), 'attestation shown on the approver view');
    await shot('03-approver-view');
    await page.click('[data-bu-back]'); await page.waitForSelector('#signoff'); await settle(400);
    await signAll();
    let r2 = await rd(AR);
    ok(r2.pass, 'access-review gate passes: ' + r2.checks.filter(c => c.status === 'fail').map(c => c.id + ': ' + c.detail).join(' | '));
    ok(!(await page.$('[data-bu="IT"] [data-why=bu]')) && !(await page.$('[data-bu="Compliance"] [data-why=bu]')), "no stale “Switch 'Viewing as'” hint on signed sections");
    /* R7 re-approval scope: a launch-day plan change makes stale only the parts that own the changed steps */
    await setMe('ta');
    await page.click('[data-cutover-edit]'); await page.waitForSelector('.overlay input[name=window]');
    await page.fill('.overlay input[name=window]', 'Sat 07:00–10:00 CT (moved an hour earlier)');
    await page.fill('.overlay [data-trow] >> nth=0 >> [data-tt]', 'Freeze manual access changes at 07:00');
    await page.click('.overlay [data-act=save]'); await settle(1200);
    ok(await page.$('[data-bu="IT"] [data-stale-cutover]') && !(await page.$('[data-bu="Compliance"] [data-stale]')), 'changing an IT-owned launch-day step stales only the IT part, not Compliance');
    ok(!(await rd(AR)).pass, 'gate blocked until re-approved');
    await shot('02b-stale-cutover');
    await signAll();
    r2 = await rd(AR);
    ok(r2.pass && await page.$('[data-gate=pass]'), 'gate passes again after re-approval');
    ok(/2 different approvers/.test(await txt('.rl-two')), 'two different people: Dev Kumar and Priya Shah');
    await shot('02-ar-pass');

    /* ---------- 6. dialogs keep input ---------- */
    console.log('Dialogs keep input');
    await setMe('ps');
    await page.click('[data-request]');
    await page.waitForSelector('.overlay select[name=dataId]');
    await page.selectOption('.overlay select[name=env]', 'uat');
    await page.selectOption('.overlay select[name=access]', 'write');
    await page.fill('.overlay textarea[name=reason]', 'Load test certifications');
    await page.fill('.overlay input[name=days]', '45');
    await page.click('.overlay [data-act=send]'); await settle(300);
    ok(await page.$('.overlay') && /from 1 to 30/.test(await txt('.overlay [data-err]')) && await page.inputValue('.overlay textarea[name=reason]') === 'Load test certifications', 'duration over 30 days: dialog stays open with the error inline, input kept');
    await page.fill('.overlay input[name=days]', '30');
    await page.selectOption('.overlay select[name=env]', 'dev');
    await page.selectOption('.overlay select[name=access]', 'read');
    await page.click('.overlay [data-act=send]'); await settle(1000);
    const gq = await st(`return store.list('grant', g => g.projectId === a && g.status === 'requested' && g.reason === 'Load test certifications')[0];`, AR);
    ok(gq && !gq.expires && gq.durationDays === 30 && /30 days from approval/.test(await txt(`[data-grant="${gq.id}"] [data-expiry]`)), 'requested grant shows "30 days from approval" (no countdown, no expiry yet)');
    const gOwner = await st(`const g = store.get('grant', a); const de = store.get('dataElement', g.dataId); const p = store.get('project', 'access-review-automation'); return g.requestedBy === de.owner ? p.owner : de.owner;`, gq.id);
    await setMe(gOwner);
    await page.click(`[data-grant="${gq.id}"] [data-gact=approve]`); await stepUpOk(); await settle(800);
    const ga = await st(`return store.get('grant', a);`, gq.id);
    const exp30 = await st(`const d = new Date(store.state.today + 'T12:00:00'); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10);`);
    ok(ga.status === 'active' && ga.expires === exp30 && ga.approvedAt, `expiry set at approval: ${ga.expires} (approval + 30 days)`);

    /* ---------- 7. release manager vs non-RM ---------- */
    console.log('Release manager only');
    await setMe('ta');
    ok(await page.$eval('[data-golive]', b => b.disabled) && /Only the launch owner \(Maya Chen\) can launch/.test(await txt('.rl-golive [data-why=rm]')), 'not the launch owner (the PM): Launch disabled, says who can');
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
    ok(relF.status === 'failed', 'failed release recorded');
    const audF = async () => { await page.waitForFunction(() => { const b = document.querySelector('[data-rl-history]'); return b && !/Loading/.test(b.textContent); }, null, { timeout: 10000 }); return page.$$eval('[data-rl-history] [data-audit]', els => els.map(e => ({ a: e.dataset.audit, t: e.textContent.replace(/\s+/g, ' '), at: e.querySelector('time').getAttribute('datetime') }))); };
    await page.reload(); await page.waitForSelector('#cutover'); await settle(800);
    let au = await audF();
    ok(au.filter(e => /Go-live pipeline failed/i.test(e.t)).length === 1, 'failed go-live: exactly one failure entry in the audit log (' + au.filter(e => /fail/i.test(e.t)).map(e => e.a).join(',') + ')');
    ok(au.every((e, i) => !i || e.at >= au[i - 1].at), 'audit log is in chronological order (oldest first)');
    ok(await st(`return store.get('process', 'access-review').version;`) === v0 && await st(`return store.get('project', a).status;`, AR) === 'active', 'no promotion: version unchanged, project still active');
    ok(await st(`return JSON.stringify(store.list('grant', g => g.projectId === a).map(g => g.status));`, AR) === grants0, 'no grant expiry');
    ok(await page.$('.rl-latest [data-failed] [data-no-side-effects]'), 'release record says nothing was promoted or published');
    await shot('05-pipeline-failed');
    console.log('Retry succeeds');
    await page.click('[data-retry]');
    await page.waitForSelector('.overlay [data-simfail]');
    ok(/Try again: launch/.test(await txt('.overlay h2')), 'Try again opens the launch dialog');
    await page.click('.overlay [data-act=go]');
    await stepUpOk();
    await page.waitForSelector('[data-pipe-phase=succeeded]', { timeout: 15000 });
    await page.waitForFunction(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); return store.list('release').some(r => r.projectId === 'access-review-automation' && r.kind === 'golive' && r.status === 'succeeded'); }, null, { timeout: 10000 }); await settle(800);
    ok(await st(`return store.get('project', a).status;`, AR) === 'live' && await st(`return store.get('process', 'access-review').version;`) === v0 + 1, 'retry: project live, process promoted');
    ok(!(await page.$('[data-pipeline-failed]')), 'no failure banner after success');
    await setAdv(false); await open('/release/' + AR);
    ok(await page.$('[data-launch-status=live]') && /^Launched on /.test((await txt('[data-launch-sentence]')).trim()) && await page.$('details[data-sec=support]'), 'Simple launch page after launch: "Launched on …" and Support after launch');
    await jargonFree('launch page after launch');
    await shot('s06-launched-simple');
    await setAdv(true);
    await page.reload(); await page.waitForSelector('[data-hypercare]'); await settle(800);
    au = await audF();
    const last = re => { let k = -1; au.forEach((e, i) => { if (re.test(e.a + ' ' + e.t)) k = i; }); return k; };
    const order = [last(/^golive-approved/), last(/^pipeline-succeeded .*Deployment/), last(/^release .*Released/), last(/expired at go-live/)];
    ok(order.every(i => i >= 0) && order.every((v, i) => !i || v > order[i - 1]), `audit order after go-live: approval → pipeline → promotion → grants expired (${order.join(' < ')})`);
    ok(au.every((e, i) => !i || e.at >= au[i - 1].at), 'audit timestamps strictly follow the display order');
    /* hypercare */
    console.log('Hypercare');
    ok(/Priya Shah/.test(await txt('[data-hypercare] .rl-hc-h')) && /\d+ of 10 days left/.test(await txt('[data-hypercare] h3')), 'hypercare card: owner and days remaining');
    await page.click('[data-inc-add]'); await settle(200);
    ok(!(await page.$eval('[data-inc-err]', e => e.hidden)), 'incident without a title: inline error');
    await page.fill('[data-inc-title]', 'Auto-removal job revoked a service account');
    await page.selectOption('[data-inc-sev]', '1');
    await page.click('[data-inc-add]'); await settle(1000);
    ok(await st(`return (store.get('project', a).incidents || []).some(i => i.severity === 1 && i.status === 'open' && i.title === 'Auto-removal job revoked a service account');`, AR), 'sev-1 incident stored on project.incidents');
    ok(await page.$('[data-consider-rollback]') && /Consider undoing the launch/.test(await txt('[data-consider-rollback]')), 'open critical problem shows "Consider undoing the launch"');
    await shot('05b-hypercare');
    await setMe('ta');
    ok(await page.$('.rl-rb [data-why=rm]') && !(await page.$('[data-rollback]')), 'non-RM cannot roll back; told who can');
    expect403 = true;
    const forbRb = await st(`try { await store.api('/rollback/' + a, {}); return 'allowed'; } catch (e) { return e.status; }`, AR);
    expect403 = false;
    ok(forbRb === 403, 'server refuses rollback from a non-RM (403)');
    await setMe('mc');
    console.log('Rollback pipeline: failure then success');
    await page.click('.rl-rb [data-rollback]');
    await page.waitForSelector('.overlay textarea[name=reason]');
    await page.fill('.overlay textarea[name=reason]', 'Removal job flagged service accounts');
    await page.check('.overlay [data-simfail]');
    await page.click('.overlay [data-act=rollback]');
    await stepUpOk();
    await page.waitForSelector('[data-pipe-kind=rollback]', { timeout: 15000 });
    ok(await page.$('[data-pipe-kind=rollback]'), 'rollback shows a pipeline status');
    await page.waitForSelector('[data-rollback-failed]', { timeout: 15000 }); await settle(800);
    ok(await st(`return store.get('project', a).status;`, AR) === 'live' && await st(`return store.get('process', 'access-review').version;`) === v0 + 1, 'failed rollback: nothing restored, still live');
    ok(/Nothing was restored/.test(await txt('[data-rollback-failed]')), 'rollback failure banner: "Nothing was restored"');
    await page.reload(); await page.waitForSelector('[data-hypercare]'); await settle(800);
    au = await audF();
    ok(au.filter(e => /Rollback pipeline failed/i.test(e.t)).length === 1, 'failed rollback: exactly one failure entry');
    await shot('05c-rollback-failed');
    await page.click('.rl-rb [data-rollback]');
    await page.waitForSelector('.overlay textarea[name=reason]');
    await page.fill('.overlay textarea[name=reason]', 'Removal job flagged service accounts');
    await page.click('.overlay [data-act=rollback]');
    await stepUpOk();
    await page.waitForFunction(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); return store.get('project', 'access-review-automation').status === 'active'; }, null, { timeout: 15000 });
    await page.waitForSelector('[data-pipe-kind=rollback][data-pipe-phase=succeeded], .rl-latest [data-kind=rollback]:not([data-failed])', { timeout: 20000 }); await settle(3500);
    ok(await st(`return store.get('project', a).status;`, AR) === 'active' && await st(`return store.get('process', 'access-review').version;`) === v0, 'rollback restored the previous version');
    const undone = await page.$$eval('.rl-latest [data-undone] li', els => els.map(e => e.textContent));
    ok(undone.length >= 2 && undone.some(x => /Re-published SOP/.test(x)) && undone.some(x => /Restored/.test(x)), 'rollback shows the side effects it undid: ' + undone.slice(0, 2).join(' | '));
    await shot('06-ar-rolledback');
    await page.reload(); await page.waitForSelector('#cutover'); await settle(1200);
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('[data-rl-history]').textContent), null, { timeout: 10000 });
    const audit = await txt('[data-rl-history]');
    ok(/pipeline failed/i.test(audit) && /rolled back/i.test(audit), 'gate audit log shows the failed pipeline and the rollback');
    au = await audF();
    const rbo = [last(/^rollback-approved/), last(/^pipeline-succeeded .*Rollback/), last(/^rollback .*Restored/)];
    ok(rbo.every(i => i >= 0) && rbo.every((v, i) => !i || v > rbo[i - 1]), `rollback audit order: approved → pipeline → restore (${rbo.join(' < ')})`);

    /* ---------- 9. BU sections from touches tags, including the trigger; "No approver in HR" ---------- */
    console.log('BU sections from touches and the trigger');
    await open('/release/' + VM);
    ok(await page.$('[data-bu="Compliance"] [data-via-tag]') && /teams involved: Compliance/.test(await txt('[data-bu="Compliance"]')), 'Compliance section includes a step owned by Procurement via its touches tag');
    const hasHr = await st(`return store.state.people.some(p => p.bu === 'HR');`);
    await setMe('mc');
    await st(`const p = store.get('process', 'vendor-onboarding'); const tobe = p.tobe.map(n => n.type === 'trigger' ? Object.assign({}, n, { touches: (n.touches || []).concat(['HR']) }) : n); await store.save('process', p.id, Object.assign({}, p, { tobe }), 'Trigger now touches HR (e2e)');`);
    await settle(800);
    ok(await page.$('[data-bu="HR"] [data-via-trigger]'), 'HR section comes from the trigger’s touches');
    if (!hasHr) ok(/Nobody can approve the HR part yet/.test(await txt('[data-no-approver="HR"]')) && await page.$('[data-no-approver="HR"] [data-choose="HR"], [data-no-approver="HR"] [data-choose-who]') && /No approver in HR/.test((await check(VM, 'bu-signoff')).detail), 'HR has nobody: "Nobody can approve the HR part yet" with "Choose who approves this part" (UI and engine)');
    await shot('07-vm-tags');

    /* ---------- 10. testing depth (vendor modernization) ---------- */
    console.log('Testing: profile cases, ids, testers');
    await setMe('ta');
    await open(`/testing/${VM}?de=D2`);
    await page.click('[data-prof-sample]');
    await page.waitForSelector('.ts-driftsum, .ts-ok', { timeout: 15000 }); await settle();
    const genBefore = await st(`return store.list('testCase', c => c.dataId === 'D2').map(c => c.id);`);
    await page.click('[data-gen]'); await page.waitForSelector('.toast >> text=/Generated \\d+ test case/', { timeout: 60000 });
    const shownNow = +(await txt('#cases h3 .n')).trim(); const haveNow = await st(`return store.list('testCase', c => c.dataId === 'D2').length;`);
    ok(shownNow === haveNow && haveNow > genBefore.length, `one press generates everything and the count updates immediately (${genBefore.length} → ${shownNow})`);
    await page.waitForSelector('[data-gen]:not([data-gen-busy])', { timeout: 60000 }); await settle(300);
    ok(+(await txt('#cases h3 .n')).trim() === haveNow, 'count unchanged after the saves land (no stale or double count)');
    await page.click('[data-gen]'); await page.waitForSelector('.toast >> text=/No new test cases/', { timeout: 10000 }); await settle(300);
    ok(+(await txt('#cases h3 .n')).trim() === haveNow, 'a second press adds nothing: generation is one-shot and complete');
    const d2owner = await st(`return store.get('dataElement', 'D2').owner;`);
    ok(await st(`return store.list('testCase', c => c.dataId === 'D2' && !a.before.includes(c.id)).every(c => c.tester === a.owner);`, { before: genBefore, owner: d2owner }), 'generated cases default to the data owner as tester');
    const nProf = await page.$$eval('#cases tr[data-origin-row=profile]', r => r.length);
    ok(nProf > 0 && await page.$('[data-profile-cases]'), `profile-derived cases shown (${nProf}) with an explanation`);
    await page.click('[data-origin=profile]'); await settle();
    ok((await page.$$('#cases tr[data-origin-row]')).length === nProf && !(await page.$('#cases tr[data-origin-row=spec]')), 'origin filter shows only profile cases');
    await page.click('[data-origin=all]'); await settle();
    const firstCase = await page.$eval('#cases tr[data-case]', r => r.dataset.case);
    const labels = await page.$$eval('#cases [data-case-label]', els => els.map(e => e.textContent.trim()));
    ok(labels.length && labels.every(l => /^TC\d+$/.test(l)) && !(await page.$$eval('#cases td', tds => tds.some(td => /\btc-[a-z0-9]/.test(td.textContent)))), `cases show TC<n> labels, never raw ids (${labels.slice(0, 3).join(', ')}…)`);
    ok(await st(`return window.PMOEngine.caseLabel(store.state.docs, a);`, firstCase) === await txt(`#cases tr[data-case="${firstCase}"] [data-case-label]`).then(t => t.trim()), 'label matches E().caseLabel');
    const unassigned = await st(`return store.list('testCase', c => c.dataId === 'D2' && !c.tester).map(c => c.id);`);
    if (unassigned.length) {
      await page.selectOption('select[name=bulkTester]', 'ar');
      await page.click('[data-bulk-assign]'); await page.waitForSelector('.toast >> text=/assigned to Ana Ruiz/', { timeout: 60000 }); await settle(800);
    }
    ok(await st(`return store.list('testCase', c => c.dataId === 'D2').every(c => c.tester) && a.every(id => store.get('testCase', id).tester === 'ar');`, unassigned), `bulk-assigned the ${unassigned.length} unassigned D2 cases to Ana Ruiz; every case has a tester`);
    const unc0 = +(await page.getAttribute('[data-trace-fields]', 'data-trace-fields'));
    const tde = await page.$$eval('[data-gen-de]', bs => bs.map(b => b.dataset.genDe).filter(x => x !== 'D8'));
    if (tde.length) {
      await page.click(`[data-gen-de="${tde[0]}"]`); await page.waitForSelector('.toast >> text=/Generated \\d+ test case/', { timeout: 60000 }); await settle(300);
      ok(!(await page.$(`[data-trace-de="${tde[0]}"]`)) && +(await page.getAttribute('[data-trace-fields]', 'data-trace-fields')) < unc0, `"Generate" in the traceability header covers that element's fields at once (${unc0} → ${await page.getAttribute('[data-trace-fields]', 'data-trace-fields')} uncovered)`);
      await page.waitForFunction(() => !document.querySelector('[data-gen-busy]'), null, { timeout: 60000 }); await settle(4000);
    }
    for (const d of await page.$$eval('.ts-list [data-de]', as => as.map(a => a.dataset.de))) {
      if (d === 'D2' || d === 'D8') continue;
      await page.click(`.ts-list [data-de="${d}"]`); await settle(300);
      await page.click('[data-gen]'); await page.waitForSelector('.toast >> text=/Generated \\d+ test case|No new test cases|Still saving/', { timeout: 60000 });
      await page.waitForSelector('[data-gen]:not([data-gen-busy])', { timeout: 60000 }); await settle(300);
    }
    /* traceability headline: UAT done/total next to spec-field coverage */
    const tcov = await st(`return window.PMOEngine.testCoverage(store.state.docs, a);`, VM);
    ok(await page.getAttribute('[data-trace-uat]', 'data-trace-uat') === `${tcov.uat.done}/${tcov.uat.total}` && +(await page.getAttribute('[data-trace-fields]', 'data-trace-fields')) === tcov.uncoveredFields.length, `traceability header matches E().testCoverage: UAT ${tcov.uat.done}/${tcov.uat.total}, ${tcov.uncoveredFields.length} uncovered`);
    ok(await page.$('[data-trace-uat]') && await page.$('[data-trace-fields]'), 'traceability header: UAT done/total next to spec-field coverage: ' + (await txt('[data-trace]')).slice(0, 90));
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
    await page.click('[data-gen]'); await page.waitForSelector('.toast >> text=/Generated \\d+ test case/', { timeout: 60000 });
    await page.waitForSelector('[data-gen]:not([data-gen-busy])', { timeout: 60000 }); await settle(500);
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
    /* bulk: nothing selected -> inline hint at once; select all, no note -> hint; with note -> everything passes with that evidence */
    await page.click('.overlay [data-bulk-pass]');
    ok(await page.isVisible('.overlay [data-bulk-hint]') && /Nothing selected/.test(await txt('.overlay [data-bulk-hint]')), '"Mark selected as passed" with nothing selected shows an inline hint immediately');
    await page.check('.overlay [data-pick-all]');
    await page.click('.overlay [data-bulk-pass]'); await settle(200);
    ok(/one evidence note/.test(await txt('.overlay [data-bulk-hint]')), '"Mark selected as passed" needs an evidence note');
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
    if (await page.$('.overlay [data-close-offer]')) {   /* the seeded defect's item passed: it is verified and closing is offered first */
      ok(/Verified/.test(await txt('.overlay h2')), 'a passing result verifies the linked seeded defect and offers to close it');
      await page.click('.overlay [data-act=cancel]'); await page.waitForSelector('.overlay [data-def-row]', { timeout: 10000 });
    }
    await page.selectOption('.overlay [data-def-row] select[name^="sev_"]', '1');
    await page.selectOption('.overlay [data-def-row] select[name^="pri_"]', 'High');
    ok(/Step \d+: fail/.test(await page.inputValue('.overlay [data-def-row] textarea[name^="repro_"]')), 'defect dialog prefills steps to reproduce from the failing step');
    await page.click('.overlay [data-act=create]'); await settle(1500);
    const run1 = await st(`return store.list('testRun', r => r.projectId === a && r.cycleId === ${JSON.stringify(cyc.id)})[0];`, VM);
    const scnRes = run1.results.find(x => x.scriptId === sc0.id);
    ok(scnRes && scnRes.outcome === 'pass' && scnRes.steps.length === sc0b.steps.length && scnRes.evidence === 'UAT evidence pack, folder VO-UAT-1', 'scenario recorded step by step with evidence');
    ok(run1.results.filter(x => x.caseId).every(x => x.evidence === 'UAT evidence pack, folder VO-UAT-1'), 'the bulk evidence note is on each selected case');
    const def = await st(`return store.list('workItem', w => w.projectId === a && w.kind === 'defect' && w.status !== 'done' && w.testRef && w.testRef.scriptId === a2)[0];`.replace('a2', JSON.stringify(multi.id)), VM);
    ok(!!def, 'defect created for the failing script');
    ok(def.severity === 1 && def.priority === 'High' && def.env === 'uat' && def.repro && def.defectStatus === 'new' && await st(`return window.PMOEngine.defectState(store.state.docs, a);`, def.id) === 'new', 'defect has severity, priority, env, repro and starts as new');
    const stepOwner = await st(`const s = store.get('project', a.p).uatScripts.find(x => x.id === a.s); const pr = store.get('process', s.pid); const f = n => { for (const x of n || []) { if (x.id === s.step) return x; for (const b of x.branches || []) { const r = f(b.nodes); if (r) return r; } } return null; }; return (f(pr.tobe) || {}).owner;`, { p: VM, s: multi.id });
    ok(def.owner === stepOwner && (await st(`return store.get('project', a).uatScripts.find(x => x.id === ${JSON.stringify(scripts[0].id)}).tester;`, VM)), 'defect owner is the step owner; adopted scripts default their tester');
    console.log('Defect lifecycle');
    await setMe(def.owner);
    ok((await txt(`[data-defect-row="${def.id}"]`)).includes('new'), 'defects card lists it as new');
    for (const [to, label] of [['triaged', 'Triage'], ['in-progress', 'Start fix'], ['fixed', 'Mark fixed']]) {
      await page.click(`[data-defect-row="${def.id}"] [data-dnext]`); await settle(900);
      ok(await page.$(`[data-defect-row="${def.id}"][data-dstate="${to}"]`), `${label} → ${to}`);
    }
    ok(await page.$(`[data-defect-row="${def.id}"] [data-await-retest]`), 'fixed defects wait for a passing retest');
    await setMe('ps');
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
    const log = await st(`return (store.get('workItem', a).stateLog || []).map(x => x.state).join('>');`, def.id);
    ok(/new>triaged>in-progress>fixed>verified>closed/.test(log), 'lifecycle recorded: ' + log + ' (verified automatically by the passing retest)');
    ok(await st(`return window.PMOEngine.defectState(store.state.docs, a);`, def.id) === 'closed', 'E().defectState agrees: closed');

    console.log('JUnit: label or title, environment, skipped');
    await setMe('ta');
    const devCases = await st(`const E = window.PMOEngine; const ids = new Set(); store.get('project', a).processes.forEach(p => E.flatSteps(store.get('process', p).tobe).forEach(s => (s.data || []).forEach(d => ids.add(d)))); return store.list('testCase', c => ids.has(c.dataId)).map(c => ({ id: c.id, field: c.field, kind: c.kind, de: store.get('dataElement', c.dataId).name, lbl: E.caseLabel(store.state.docs, c.id) }));`, VM);
    const xml1 = `<testsuite name="vendor-full">${devCases.map(c => `<testcase classname="northwind.vendor" name="${x(c.de)} ${c.lbl} validates"/>`).join('')}</testsuite>`;
    await page.click('[data-ci]'); await page.waitForSelector('.overlay [data-ci-xml]');
    ok((await page.$$eval('.overlay [data-ci-env] option', o => o.map(x => x.value))).join() === 'dev,sit,uat,prod-verify', 'JUnit import asks for the environment');
    await page.fill('.overlay [data-ci-xml]', xml1); await page.click('.overlay [data-act=preview]'); await page.waitForSelector('.overlay [data-ci-map]');
    ok((await page.$$('.overlay [data-ci-row]')).length === devCases.length && !(await page.$('.overlay [data-ci-row].un')), 'JUnit preview lists every testcase with its matched case before importing');
    await page.click('.overlay [data-act=import]'); await settle(1500); await dismiss();
    const ci1 = await st(`return store.list('testRun', r => r.projectId === a && r.ciSuite === 'vendor-full')[0];`, VM);
    ok(ci1 && ci1.results.length === devCases.length && ci1.results.every(x => x.matchedBy === 'label') && ci1.env === 'dev', `every case matched by its TC label (${ci1 && ci1.results.length}/${devCases.length})`);
    const devFull = (await txt('[data-cov=dev]')).trim();
    ok(/^(\d+)\/\1/.test(devFull), 'dev coverage complete after the full CI import: ' + devFull);
    const tc = devCases.find(c => c.kind === 'boundary') || devCases[0];
    const sk = devCases.find(c => c.id !== tc.id);
    const titleName = `${tc.field.toUpperCase()} -- ${tc.kind}!`;
    const xml2 = `<testsuite name="vendor-partial"><testcase classname="ci" name="${titleName}"><failure message="Boundary rejected"/></testcase><testcase classname="ci" name="${multi.title.toLowerCase().replace(/ /g, '_')}"/><testcase classname="ci" name="${x(sk.de)} ${sk.lbl}"><skipped message="flaky sandbox"/></testcase><testcase classname="ci" name="unrelated smoke test"/></testsuite>`;
    await page.click('[data-ci]'); await page.waitForSelector('.overlay [data-ci-xml]');
    await page.fill('.overlay [data-ci-xml]', xml2); await page.click('.overlay [data-act=preview]'); await page.waitForSelector('.overlay [data-ci-map]');
    ok((await page.$$('.overlay [data-ci-row].un')).length === 1 && /unmatched/.test(await txt('.overlay [data-ci-row].un')), 'preview marks the unrelated test as unmatched');
    await page.click('.overlay [data-act=import]');
    await page.waitForSelector('.overlay .ts-mk', { timeout: 10000 }); await page.click('.overlay [data-act=cancel]'); await settle(1500); await dismiss();
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
    await page.fill('.overlay [data-ci-xml]', `<testsuite name="vendor-sit"><testcase classname="ci" name="sit smoke check 7"/></testsuite>`); await page.click('.overlay [data-act=preview]'); await page.waitForSelector('.overlay [data-ci-map]');
    ok(await page.$('.overlay [data-ci-row].un'), 'unrecognised test starts unmatched');
    await page.click('.overlay [data-act=import]'); await settle(300);
    ok(/at least one/.test(await txt('.overlay [data-err]')), 'importing with everything unmatched is refused inline');
    await page.selectOption('.overlay [data-ci-pick]', 'c:' + sk.id);
    ok(/mapped by hand/.test(await txt('.overlay [data-ci-row]')), 'dropdown maps it by hand');
    await page.click('.overlay [data-act=import]'); await settle(1500);
    ok(await st(`return store.list('testRun', r => r.projectId === a && r.ciSuite === 'vendor-sit')[0].results[0];`, VM).then(r => r.caseId === sk.id && r.matchedBy === 'manual'), 'manual mapping imported (matchedBy manual)');
    ok(await st(`return store.list('testRun', r => r.projectId === a && r.ciSuite === 'vendor-sit')[0].env;`, VM) === 'sit' && /System testing \(latest\)/.test(await txt('#coverage thead')), 'SIT run imported and shown as its own coverage column');
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
   a. Scan the receipts into the archive folder with the claim number and the date of submission for audit retention purposes.
5. Close the claim in the finance folder.`;
    await page.fill('[data-sop]', sop);
    await page.click('[data-draft]');
    await page.waitForSelector('.is-step', { timeout: 30000 }); await settle();
    ok(await page.$('[data-loopback]') && /Goes back to/.test(await txt('.is-goto.on')), 'loop-back rendered: ' + (await txt('.is-goto.on')).trim().slice(0, 80));
    const noBr = await page.$$eval('.is-branch', bs => bs.map(b => ({ label: b.querySelector('[data-blabel]').value, steps: [...b.querySelectorAll('.is-bstep [data-f=title]')].map(t => t.value) })));
    ok(noBr.some(b => b.label === 'No' && b.steps.some(t => /manager approves the exception/i.test(t))), '"otherwise …" lands in the No branch: ' + JSON.stringify(noBr.find(b => b.label === 'No' && b.steps.length) || {}));
    ok(/Step 1: Ana Ruiz checks/.test(await txt('.is-goto.on')), '"go back to step 1" loops back to step 1');
    ok(await page.$eval('.is-step[data-i="0"] [data-f=owner]', s => s.value) === 'ar', 'full-name owner "Ana Ruiz" matched to Ana Ruiz');
    ok(await page.$$eval('.is-sub textarea', t => t.some(x => /audit retention purposes$/.test(x.value))), 'long sub-step kept in full');
    const noOwn = await page.$$('[data-noowner]');
    ok(noOwn.length >= 1 && await page.$('[data-owner-prompt]'), `unmatched owners left blank and highlighted (${noOwn.length}) with a prompt to choose`);
    ok(!(await page.$$eval('[data-noowner]', els => els.some(e => e.value))), 'blank owners are not guessed');
    ok((await page.$$eval('[data-owner-role]', els => els.map(e => e.textContent))).join('|') === 'Who: Manager|Who: Courier', 'free-text roles shown as "Who: Manager" and "Who: Courier"');
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
    await page.waitForURL(/\/process\/proc-[\w-]+\?mode=asis/, { timeout: 15000 });
    const newPid = page.url().match(/process\/([\w-]+)/)[1];
    await settle(1000);
    const loop = await st(`const p = store.get('process', a); const all = []; const walk = ns => ns.forEach(n => { all.push(n); (n.branches || []).forEach(b => walk(b.nodes)); }); walk(p.asis);
      const g = p.asis.find(n => (n.branches || []).some(b => b.goto)); const b = g && g.branches.find(x => x.goto);
      return { ok: !!b && all.some(n => n.id === b.goto), tobe: (p.tobe || []).length };`, newPid);
    ok(loop.ok && loop.tobe === 0, 'loop-back persisted with goto pointing at a real Today node id; saved as Today only (Future made on first open)');
    ok(/Today/.test(await txt('[role=tab][aria-selected=true]').catch(() => '')) || /mode=asis/.test(page.url()), '"Save as how it works today" opens Today');
    ok(await st(`const p = store.get('process', a); return p.asis.some(n => n.ownerRole === 'Courier' && !n.owner);`, newPid), 'the role is saved as ownerRole on the step');

    console.log('Import SOP: titles, proposed data, wait/message nodes');
    await open('/import');
    /* the parser's output is injected so the e2e controls exactly what it returns (including the new node kinds) */
    await st(`window.__api = store.api; store.api = async (path, body) => path === '/ai/sop-import' ? ({ source: 'rules', name: 'Vendor dispute handling ()', nodes: [
      { id: 'k', type: 'trigger', title: 'A vendor disputes an invoice ()' },
      { id: 'a', type: 'step', title: 'Accounts Payable logs the dispute () in the dispute register', owner: 'mc', subs: ['Attach the vendor dispute letter ( )'] },
      { id: 'b', type: 'wait', title: 'Wait 2 business days for vendor response ()', wait: '2 business days' },
      { id: 'c', type: 'message', title: 'Notify vendor of the outcome', direction: 'send', party: 'Vendor' },
      { id: 'd', type: 'step', title: 'Treasury files the dispute resolution memo' }],
      newData: [{ name: 'Dispute register entry', reason: 'Mentioned in "Accounts Payable logs the dispute in the dispute register"' }, { name: 'Dispute resolution memo ()' }, { name: 'Receiving clerk records' }], notes: 'Injected by the e2e.' }) : window.__api(path, body);`);
    await page.fill('[data-sop]', 'Vendor dispute SOP (injected parser output)');
    await page.click('[data-draft]'); await page.waitForSelector('.is-step', { timeout: 15000 }); await settle();
    const titles = await page.$$eval('.is-draft textarea, .is-trig, .is-nd-name', els => els.map(e => e.value || e.textContent));
    ok(titles.length && !titles.some(t => /\(\s*\)/.test(t)), 'no "()" in any draft title, sub-step, trigger or proposal');
    ok(await page.$('.is-step[data-type=wait] [data-kind=wait]') && await page.$('.is-step[data-type=message] [data-kind=message]') && await page.inputValue('.is-step[data-type=message] [data-f=party]') === 'Vendor', 'wait and message nodes render with their details');
    const props = await page.$$eval('[data-nd-name]', els => els.map(e => e.value));
    ok(props.join('|') === 'Dispute register entry|Dispute resolution memo' && /Receiving clerk records/.test(await txt('.is-notes')), 'only document/record/field noun phrases proposed ("Receiving clerk records" is not): ' + props.join(', '));
    ok((await page.$$('[data-nd-target]')).length === 2 && (await page.$$('[data-newchip]')).length === 2, 'each proposal shows the step it will be added to, and the step shows it');
    await page.click('[data-create]'); await page.waitForSelector('.overlay input[name=name]');
    ok(/creates 2 pieces of information/.test(await txt('.overlay [data-create-data]')) && !/\(\s*\)/.test(await page.inputValue('.overlay input[name=name]')), 'create dialog says it creates exactly 2 data elements; name has no "()"');
    await page.click('.overlay [data-act=create]');
    await page.waitForURL(/\/process\/proc-[\w-]+\?mode=asis/, { timeout: 15000 });
    const pid2 = page.url().match(/process\/([\w-]+)/)[1]; await settle(800);
    await st(`store.api = window.__api;`);
    const made = await st(`const p = store.get('process', a); const ids = new Set(); const walk = ns => (ns || []).forEach(n => { (n.data || []).forEach(d => ids.add(d)); (n.branches || []).forEach(b => walk(b.nodes)); }); walk(p.asis);
      const des = store.list('dataElement', d => d.source === 'From a pasted procedure' && /Dispute/.test(d.name));
      return { n: des.length, linked: des.every(d => ids.has(d.id)), owners: des.map(d => d.owner || d.ownerRole || ''), names: des.map(d => d.name), kinds: p.asis.map(n => n.type), titles: p.asis.map(n => n.title), wait: (p.asis.find(n => n.type === 'wait') || {}).wait, msg: p.asis.find(n => n.type === 'message') };`, pid2);
    ok(!made.owners.includes(await st(`return store.state.me;`)), 'new information is owned by whoever does its step, never the importer: ' + made.owners.join(', '));
    ok(made.n === 2 && made.linked && !made.names.some(n => /\(/.test(n)), 'the 2 proposed elements were created and both are in the new process\'s data requirements: ' + made.names.join(', '));
    ok(made.kinds.includes('wait') && made.kinds.includes('message') && made.wait === '2 business days' && made.msg.party === 'Vendor' && made.msg.direction === 'send', 'wait and message nodes kept on create: ' + made.kinds.join(','));
    ok(!made.titles.some(t => /\(\s*\)/.test(t)), 'created process titles have no "()"');

    await simpleTesting();
    /* ---------- 12. widths ---------- */
    console.log('Widths');
    for (const [w, h] of [[1440, 1000], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const p of ['/release/' + AR, '/release/' + AR + '?bu=IT', '/release/' + VM, '/release/' + VM + '?bu=Compliance', '/testing/' + VM, '/import']) {
        await open(p);
        if (p === '/import') { await page.click('[data-sample]'); await page.click('[data-draft]'); await page.waitForSelector('.is-step', { timeout: 30000 }); await settle(); }
        ok(await overflow(), `no horizontal overflow at ${w}: ${p}`);
        if (w === 390) await shot('m-' + p.replace(/[\/?=]/g, '_').replace(/^_/, ''));
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
