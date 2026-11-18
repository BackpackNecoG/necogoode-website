/* R8 + R9 consistency e2e (stream P): ONE TRUTH, ENFORCED.
   Part A (Advanced, every seeded project): the expected finish, late count, blocking count, status label, first person
   in `who`, launch steps left, and planned / actual / expected cost on the project header, the home card, the projects
   list, the portfolio row, the status report and the portfolio CSV all equal E().projectTruth.
   Part B (R9 §12, Simple, every seeded project plus a newly created and accepted project): the late count (header, home
   card, list, Work tab "Late" badges, project map "Late" badges, step pages), the status label (also on step pages),
   the first name in `who`, steps left (project checklist, Launch page), tests total / passed / next and per-team counts
   (Testing page, Launch page, approval cards), forecast and deadline all equal projectTruth; "Waiting for you" equals
   personQueue for every person and its badge equals its length; no weekend date appears in any rendered text; "On track"
   never appears with a late count above 0; a freshly accepted plan has 0 late tasks.
   Part C: the phone header (<= 56px) and its menu open and close.
   Runs at 18:30 local time with the browser in America/Chicago (Playwright timezoneId + page.clock) while the server
   may run in UTC, so a UTC date would already be tomorrow: proves there are no off-by-one dates.
   Usage: dev server on <port>, then node tests/pmoflow/e2e-consistency.js [port] */
const { chromium } = require('playwright');
const fs = require('fs');

const PORT = Number(process.argv[2] || 8793);
const ROOT = `http://localhost:${PORT}/concepts/pmoflow`;
const SHOTS = '/tmp/pmo-consistency';
fs.mkdirSync(SHOTS, { recursive: true });
const TZ = 'America/Chicago';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); }
}

/* Today's date in Chicago, and 18:30 Chicago time on that date as an absolute instant. */
function chicagoNow1830() {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  for (const off of ['-05:00', '-06:00']) {
    const d = new Date(`${ymd}T18:30:00${off}`);
    const hh = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    if (hh === '18:30') return { ymd, at: d };
  }
  return { ymd, at: new Date(`${ymd}T18:30:00-06:00`) };
}

/* Normalisers: every surface shows the same value in its own format. */
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function normDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || /not planned/i.test(s)) return 'none';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${+m[2]}-${+m[3]}`;
  m = s.match(/([A-Z][a-z]{2}) (\d{1,2})/); if (m && MON[m[1]]) return `${MON[m[1]]}-${+m[2]}`;
  return s;
}
const normMoney = v => { const s = String(v == null ? '' : v).trim(); if (!s || /not set/i.test(s)) return 0; const n = Number(s.replace(/[^0-9.-]/g, '')); return isFinite(n) ? Math.round(n) : s; };
const normInt = v => { const n = parseInt(String(v).replace(/[^0-9-]/g, ''), 10); return isFinite(n) ? n : String(v); };
const normLabel = v => String(v || '').trim().replace(/\s+/g, ' ');
const normName = v => v == null || v === '' ? 'none' : String(v).trim();
const norm = x => x && ({ label: normLabel(x.label), forecast: normDate(x.forecast), late: normInt(x.late), blockers: normInt(x.blockers), planned: normMoney(x.planned), actual: normMoney(x.actual), cost: normMoney(x.cost),
  who: x.who === undefined ? undefined : normName(x.who), steps: x.steps === undefined || x.steps === null ? undefined : normInt(x.steps),
    checks: x.checks === undefined || x.checks === null ? undefined : normInt(x.checks) });
/* Weekend check for rendered text: every "Mon D" date (no year) is read in the year closest to today. */
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function weekendDates(text, todayYmd) {
  const [y, m] = todayYmd.split('-').map(Number), out = [];
  const re = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})\b(?!,? \d{4})(?!:)/g;
  let r;
  while ((r = re.exec(text))) {
    const mo = MON[r[1]], d = +r[2];
    const yr = mo - m > 6 ? y - 1 : m - mo > 6 ? y + 1 : y;
    const dt = new Date(Date.UTC(yr, mo - 1, d));
    if (dt.getUTCDate() !== d) continue;
    const g = dt.getUTCDay();
    if (g === 0 || g === 6) out.push(`${WD[g]} ${r[0]} … ${text.slice(Math.max(0, r.index - 50), r.index + 20).replace(/\s+/g, ' ')}`);
  }
  return out;
}

function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* R10 Part D. Literal values from GOLDEN-NUMBERS.md. Dates are business-day offsets from the seed day (the sandbox's
   today), computed with the engine's calendar. On a seed day that is a weekend or holiday, SPI and the buffer are read
   from the engine instead (planned value shifts by a day there; see the doc). */
const G = {
  vm: { id: 'vendor-modernization', label: 'Some tasks late', done: 7, total: 13, pct: 48, late: 5, lateSplit: '1 past due, 4 will finish after their due date', blocking: 1,
    who: 7, whoShown: 5, spi: '0.80', cpi: '0.98', cost: '$48,847', planned: '$48,000', spent: '$23,669', stepsLeft: 6, stepsDone: '1 of 7 done',
    tests: '9/26', haveTests: '1/2', next: 'Add tests for 1 new piece of information', dev: '7/8', uat: '9/26',
    change: '5 new · 9 changed · 1 removed', deadlineBd: 29, launchBd: 28, forecastBd: 15, buffer: 14 },
  erp: { id: 'erp-upgrade-readiness', label: 'Behind on effort', done: 0, total: 2, pct: 0, late: 0, blocking: 1, who: 2, spi: '0.00', cpi: '0.00', cost: '$10,406', planned: '$9,000', spent: '$1,406', stepsLeft: 6,
    tests: '0/20', haveTests: '1/2', next: 'Add tests for 1 new piece of information', dev: '0/8', uat: '0/20',
    change: '4 new · 6 changed · 1 removed', deadlineBd: 41, forecastBd: 16, buffer: 25 },
  procs: { 'vendor-onboarding': '4 new · 6 changed · 1 removed', 'invoice-approval': '1 new · 3 changed', 'access-review': '3 changed', 'expense-reimbursement': '1 changed' },
};
async function goldenNumbers(browser, ymd, at, errors) {
  const E = require('../../api/shared/pmoflow-engine.js');
  const ip = `198.51.100.${(Math.random() * 200 | 0) + 20}`;
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: TZ, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await ctx.newPage();
  if (page.clock && page.clock.setFixedTime) await page.clock.setFixedTime(at);
  page.on('pageerror', e => errors.push('D pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('D console: ' + m.text()); });
  const STORE = ROOT + '/app/store.js';
  const txt = async sel => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  const attr = async (sel, a) => page.locator(sel).first().getAttribute(a).catch(() => null);
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]', { timeout: 20000 });
  const day = await page.evaluate(async u => (await import(u)).store.state.today, STORE);
  const bizSeed = E.isBusinessDay(day);
  const D = n => E.addBusinessDays(day, n);
  const eng = await page.evaluate(async u => { const { store } = await import(u); const t = id => window.PMOEngine.projectTruth(store.state.docs, id, store.state.today);
    return { vm: t('vendor-modernization'), erp: t('erp-upgrade-readiness') }; }, STORE);
  const fmtD = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  /* engine = the doc (dates and the two seed-day-sensitive values) */
  for (const k of ['vm', 'erp']) {
    const g = G[k], t = eng[k];
    check(`D ${k}: deadline = seed + ${g.deadlineBd} bd`, t.target === D(g.deadlineBd), [t.target, D(g.deadlineBd)]);
    check(`D ${k}: expected finish = seed + ${g.forecastBd} bd`, t.forecastFinish === D(g.forecastBd), [t.forecastFinish, D(g.forecastBd)]);
    check(`D ${k}: buffer ${g.buffer} business days`, !bizSeed || t.bufferDays === g.buffer, t.bufferDays);
    check(`D ${k}: no date on a weekend or holiday`, [t.target, t.forecastFinish, t.launch.date].every(x => E.isBusinessDay(x)), [t.target, t.forecastFinish, t.launch.date]);
  }
  check('D vm: launch window = seed + 28 bd (the business day before the deadline)', eng.vm.launch.date === D(G.vm.launchBd) && eng.vm.launch.source === 'window', eng.vm.launch);
  check('D erp: launch date = the deadline (no window yet)', eng.erp.launch.date === eng.erp.target && eng.erp.launch.source === 'deadline', eng.erp.launch);
  const spiVm = bizSeed ? G.vm.spi : eng.vm.ev.SPI.toFixed(2);

  /* Home: project cards and process cards (Simple) */
  for (const k of ['vm', 'erp']) {
    const g = G[k], c = `[data-ptile="${g.id}"]`;
    check(`D home ${k}: label "${g.label}"`, (await txt(c + ' [data-summary-label]')) === g.label, await txt(c + ' [data-summary-label]'));
    check(`D home ${k}: late ${g.late}${g.lateSplit ? ' (' + g.lateSplit + ')' : ''}`, (await txt(c + ' [data-t="late"]')) === String(g.late) && (!g.lateSplit || (await txt(c + ' [data-late-breakdown]')) === `(${g.lateSplit})`), await txt(c + ' [data-tile-facts]'));
    check(`D home ${k}: blocking ${g.blocking}`, (await txt(c + ' [data-t="blockers"]')) === String(g.blocking));
    if (g.total) check(`D home ${k}: ${g.done} of ${g.total} tasks, bar = ${g.pct}%`, (await txt(c + ' .pmo-prog b')) === `${g.done} of ${g.total}` && (await attr(c + ' [data-tile-pct]', 'data-tile-pct')) === String(g.pct));
  }
  for (const [pid, ph] of Object.entries(G.procs)) check(`D home process ${pid}: "${ph}"`, (await txt(`[data-proctile="${pid}"] [data-diffcount]`)) === ph, await txt(`[data-proctile="${pid}"] [data-diffcount]`));

  /* Project header, Simple */
  await page.goto(ROOT + '/project/' + G.vm.id); await page.waitForSelector('[data-who-acts]');
  check('D vm header: label', (await txt('.pmo-shdr [data-summary-label]')) === G.vm.label);
  check('D vm header: 7 of 13 tasks done', (await txt('.pmo-shdr .pmo-sline')).includes('7 of 13 tasks done'), await txt('.pmo-shdr .pmo-sline'));
  check('D vm header: "5 late (1 past due, 4 will finish after their due date)" in Simple', /\b5 late \(1 past due, 4 will finish after their due date\)/.test(await txt('.pmo-shdr .pmo-sline')), await txt('.pmo-shdr .pmo-sline'));
  check('D vm header: expected finish and deadline', (await txt('.pmo-shdr .pmo-sline')).includes('Expected ' + fmtD(eng.vm.forecastFinish)) && (await txt('.pmo-shdr .pmo-sline')).includes('Deadline ' + fmtD(eng.vm.target)));
  check('D vm: who needs to act = 7, 5 shown, "+2 more" opens the rest in place with their own links', (await txt('[data-who-count]')) === '7' && await page.locator('[data-who-acts] > .pmo-who-list [data-who-row], [data-who-acts] > .pmo-bl-box [data-who-row]').count() === 5
    && /^\+2 more$/.test(await txt('[data-who-more] summary')));
  await page.click('[data-who-more] summary');
  const moreHrefs = await page.$$eval('[data-who-more] [data-who-row]', as => as.map(a => a.getAttribute('href')));
  check('D vm: the 2 extra rows link to the approval (Launch) and to Testing, not the Work tab', moreHrefs.length === 2 && moreHrefs.some(h => /\/release\/vendor-modernization\?bu=Compliance/.test(h)) && moreHrefs.some(h => /\/testing\/vendor-modernization/.test(h)), moreHrefs);
  check('D vm: steps to launch "1 of 7 done", 6 left', (await txt('[data-launch-steps] h3 .n')).toLowerCase() === G.vm.stepsDone && (await attr('[data-launch-steps]', 'data-steps-left')) === '6', [await txt('[data-launch-steps] h3 .n'), await attr('[data-launch-steps]', 'data-steps-left')]);
  check('D vm: approvals step waits for parts whose work is not done', /Waiting for Compliance to approve its part\. Accounts Payable, IT and Treasury approve their parts once the work on them is done\. Procurement must approve again after changes\./.test(await txt('[data-ls="approvals"]')), await txt('[data-ls="approvals"]'));
  /* Project header, Advanced: % done, EV, money */
  await page.evaluate(async u => (await import(u)).store.setAdvanced(true), STORE); await page.waitForTimeout(300);
  for (const k of ['vm', 'erp']) {
    const g = G[k];
    await page.goto(ROOT + '/project/' + g.id); await page.waitForSelector('[data-hfin]');
    const spi = k === 'vm' ? spiVm : g.spi;
    check(`D ${k} advanced: % done tile ${g.pct}% (= EV ÷ budget)`, (await txt('[data-t="pct"]')) === g.pct + '%' && Math.round(eng[k].ev.EV / eng[k].ev.BAC * 100) === g.pct, await txt('[data-t="pct"]'));
    check(`D ${k} advanced: SPI ${spi}, CPI ${g.cpi}`, (await txt('[data-ev-spi] b')) === spi && (await txt('[data-ev-cpi] b')) === g.cpi, [await txt('[data-ev-spi] b'), await txt('[data-ev-cpi] b')]);
    check(`D ${k} advanced: budget ${g.planned}, spent ${g.spent}, expected cost ${g.cost}`, (await txt('[data-hfin] [data-t="planned"]')) === g.planned && (await txt('[data-hfin] [data-t="actual"]')) === g.spent && (await txt('[data-hfin] [data-t="cost"]')) === g.cost,
      [await txt('[data-hfin] [data-t="planned"]'), await txt('[data-hfin] [data-t="actual"]'), await txt('[data-hfin] [data-t="cost"]')]);
    check(`D ${k} advanced: late tile ${g.late}${g.late ? '' : ', no "0 past due" text'}`, (await txt('.kpis [data-t="late"]')) === String(g.late) && (g.late ? (await txt('.kpis [data-late-breakdown]')) === G.vm.lateSplit : !(await page.locator('.kpis [data-late-breakdown]').count())));
    check(`D ${k} advanced: label "${g.label}" (never "On track" with SPI < 0.9)`, (await txt('.hdr [data-summary-label]')) === g.label && !(g.label === 'On track' && eng[k].ev.SPI != null && eng[k].ev.SPI < 0.9));
  }
  /* Testing (Advanced tiles, then Simple) */
  for (const k of ['vm', 'erp']) {
    const g = G[k];
    await page.goto(ROOT + '/testing/' + g.id); await page.waitForSelector('[data-cov="dev"]');
    check(`D ${k} testing advanced: Try it out ${g.dev}, Business sign-off ${g.uat} (one denominator)`, (await attr('[data-cov="dev"]', 'data-cov-n')) === g.dev && (await attr('[data-cov="uat"]', 'data-cov-n')) === g.uat && (await attr('[data-trace-uat]', 'data-trace-uat')) === g.uat.replace(/^\d+/, String(eng[k].testing.stages[1].passed)));
    check(`D ${k} testing advanced: the go-live check never says "Tests passed" beside ✕`, !/Go-live check: Tests passed/.test(await txt('[data-tests-check]')) && /tests not passed yet/.test(await txt('[data-tests-check]')), await txt('[data-tests-check]'));
  }
  await page.evaluate(async u => (await import(u)).store.setAdvanced(false), STORE); await page.waitForTimeout(300);
  for (const k of ['vm', 'erp']) {
    const g = G[k];
    await page.goto(ROOT + '/testing/' + g.id); await page.waitForSelector('[data-tests-number]');
    check(`D ${k} testing: ${g.tests} passed, ${g.haveTests} have tests, next "${g.next}"`, (await attr('[data-tests-number]', 'data-tests-number')) === g.tests && (await attr('[data-s2-count]', 'data-s2-count')) === g.haveTests && (await txt('[data-testing-next]')) === g.next);
    check(`D ${k} testing: "Add tests" is not Done while a piece of information lacks tests`, (await attr('[data-guide-step="2"]', 'data-step-done')) === '0');
  }
  await page.goto(ROOT + '/testing/' + G.vm.id + '?de=D2'); await page.waitForSelector('[data-tests-number]'); await page.waitForTimeout(400);
  check('D testing ?de=D2 focuses Bank remittance details', (await attr('[data-focus]', 'data-s1')) === 'D2');
  /* Launch page and dashboard: one launch date (Advanced shows the window line and the dashboard to everyone) */
  await page.evaluate(async u => (await import(u)).store.setAdvanced(true), STORE); await page.waitForTimeout(300);
  await page.goto(ROOT + '/release/' + G.vm.id); await page.waitForTimeout(1200);
  check('D vm launch page: window on the golden launch day', (await attr('[data-launch-window]', 'data-launch-date')) === D(G.vm.launchBd), await attr('[data-launch-window]', 'data-launch-date'));
  await page.goto(ROOT + '/dashboard'); await page.waitForSelector('[data-dash-golive]');
  check('D dashboard: Upcoming launches uses the same launch date as the Launch page', (await attr(`[data-dash-golive="${G.vm.id}"]`, 'data-launch-date')) === D(G.vm.launchBd) && (await attr(`[data-dash-golive="${G.erp.id}"]`, 'data-launch-date')) === eng.erp.target);
  await page.evaluate(async u => (await import(u)).store.setAdvanced(false), STORE); await page.waitForTimeout(300);
  /* New project dialog: the same change phrase */
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-new-project]');
  await page.click('[data-new-project]'); await page.waitForSelector('.overlay #np-from');
  check('D new-project dialog: Vendor Onboarding "4 new · 6 changed · 1 removed"', (await attr('.overlay #np-from option[value="vendor-onboarding"]', 'data-np-from-change')) === G.procs['vendor-onboarding']);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  /* a project before a plan exists: "No plan yet" */
  await page.evaluate(async u => { const { store } = await import(u); await store.save('project', 'prj-golden-noplan', { id: 'prj-golden-noplan', name: 'Expense Golden Check', owner: 'mc', releaseManager: 'mc', resources: ['mc'], processes: ['expense-reimbursement'], status: 'active', target: window.PMOEngine.addBusinessDays(store.state.today, 40), baselines: [] }, 'Created project (e2e golden)'); }, STORE);
  await page.goto(ROOT + '/project/prj-golden-noplan'); await page.waitForSelector('[data-launch-steps]');
  check('D new project: "No plan yet", never "1 of 7 done" or "Information available ✓"', await page.locator('[data-launch-steps][data-no-plan]').count() === 1 && !/of 7 done/.test(await txt('[data-launch-steps]')) && !/Information available/.test(await txt('[data-launch-steps] .done')));
  const plan = await page.evaluate(async u => { const { store } = await import(u); return window.PMOEngine.suggestWorkFromDiff(store.state.docs, 'prj-golden-noplan', store.state.today); }, STORE);
  /* R11 §4: a role-only step goes to the one person with that title, else it is unassigned with the role shown (never the PM) */
  check('D new project plan: a task per changed step, tell + train; the role-only step "Needs an owner: Employee", never the PM', plan.map(x => x.tag || x.step).join(',') === 'x1,tell,train' && plan[0].owner === null && plan[0].ownerRole === 'Employee' && /^Needs an owner: Employee\./.test(plan[0].note) && plan.slice(1).every(x => x.owner === 'mc') && (plan.find(x => x.tag === 'tell') || {}).teams && plan.find(x => x.tag === 'tell').teams.length > 0, plan.map(x => [x.title, x.owner, x.ownerRole, x.note, x.teams]));
  /* R12 (H1) the counts the R11 reviewers flagged, on every screen where they appear */
  await page.goto(ROOT + '/testing/' + G.vm.id); await page.waitForSelector('[data-tests-number]');
  check(`D R12 #5 Simple "Try it out" shows its own stage (${G.vm.dev}), never the Business check line (${G.vm.uat})`,
    (await attr('[data-stage="try"]', 'data-try-count')) === G.vm.dev && (await txt('[data-stage="try"]')).startsWith(G.vm.dev.replace('/', ' of ') + ' tests passed') && (await txt('[data-s-progress]')).startsWith(G.vm.uat.replace('/', ' of ') + ' tests passed'),
    [await txt('[data-stage="try"]'), await txt('[data-s-progress]')]);
  await page.goto(ROOT + '/release/' + G.vm.id); await page.waitForTimeout(1200);
  await page.evaluate(() => { const d = document.querySelector('details[data-sec=access]'); if (d) d.open = true; }); await page.waitForTimeout(200);
  const rows = await page.$$eval('#grants tr[data-grant]', trs => trs.map(tr => ({ id: tr.dataset.grant, st: (tr.querySelector('[data-grant-state]') || {}).dataset ? tr.querySelector('[data-grant-state]').dataset.grantState : null,
    days: (tr.querySelector('[data-grant-days]') || { dataset: {} }).dataset.grantDays || '', wait: (tr.querySelector('[data-awaiting]') || {}).textContent || '' })));
  const byG = Object.fromEntries(rows.map(r => [r.id, r]));
  check('D R12 #7 access rows: G1 open, G2 waiting, G3 closed (never "Closed" on every row); header "1 open · 1 waiting"',
    byG.G1 && byG.G1.st === 'open' && byG.G2 && byG.G2.st === 'waiting' && byG.G3 && byG.G3.st === 'closed' && (await attr('[data-grant-counts]', 'data-grant-counts')) === '1/1', rows);
  check('D R12 #7 access approver: the row says "Waiting for Leo Park" (the information owner), and the launch step names Leo too',
    /Waiting for Leo Park/.test(byG.G2 ? byG.G2.wait : '') && JSON.stringify(eng.vm.launchSteps.find(x => x.key === 'launch').who) === '["lp"]', [byG.G2, eng.vm.launchSteps.find(x => x.key === 'launch').who]);
  check('D R12 #7 access: no grant runs past 30 days', rows.every(r => r.days === '' || +r.days <= 30), rows.map(r => r.days));
  check('D R12 #10 launch-day plan: every step inside the window on a business day', eng.vm.launchPlan && eng.vm.launchPlan.ok === true, eng.vm.launchPlan);
  check('D R12 #1 routing: no unmapped team in the seeded projects', eng.vm.routing && eng.vm.routing.unmapped.length === 0 && eng.erp.routing.unmapped.length === 0);
  const hist = await page.evaluate(async u => { const { store } = await import(u); return (await store.events(null, 300)).filter(e => e.action === 'approve' && /^approval:/.test(e.ref)).map(e => [e.ref, e.actor]); }, STORE);
  const cards = await page.evaluate(async u => { const { store } = await import(u); return store.list('approval', a => a.bu && !a.kind).map(a => ['approval:' + a.id, a.approver]); }, STORE);
  check('D R12 #2 History names the approver on the card (Rosa Vega, Sam Keller), never a step owner', hist.length >= 2 && hist.every(([r, a]) => (cards.find(c => c[0] === r) || [])[1] === a) && hist.some(h => h[1] === 'rv') && hist.some(h => h[1] === 'sk'), [hist, cards]);
  check('D R12 #9 ERP: CPI 0 and expected cost over budget (never under budget with CPI 0)', eng.erp.ev.CPI === 0 && eng.erp.cost.forecast > eng.erp.cost.planned && eng.erp.ev.bacSource === 'baseline', [eng.erp.ev.CPI, eng.erp.cost]);
  for (const w of [1366, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const u of ['/', '/project/' + G.vm.id, '/testing/' + G.vm.id, '/dashboard']) {
      await page.goto(ROOT + u); await page.waitForTimeout(900);
      check(`D ${w}: no horizontal overflow on ${u}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: `${SHOTS}/golden-${w}${u.replace(/\W+/g, '-')}.png`, fullPage: true });
    }
  }
  await ctx.close();
}

(async () => {
  const { ymd, at } = chicagoNow1830();
  const utcYmd = at.toISOString().slice(0, 10);
  console.log(`browser clock: ${at.toISOString()} (= 18:30 ${TZ} on ${ymd}; UTC date ${utcYmd})`);
  const browser = await chromium.launch();
  const ip = `198.51.100.${(Math.random() * 200 | 0) + 20}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: TZ, acceptDownloads: true, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await ctx.newPage();
  if (page.clock && page.clock.setFixedTime) await page.clock.setFixedTime(at);
  else console.log('  (page.clock unavailable: timezoneId only)');
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const STORE = ROOT + '/app/store.js';

  await page.goto(ROOT + '/');
  await page.waitForSelector('[data-waiting]', { timeout: 20000 });
  const clientToday = await page.evaluate(async u => (await import(u)).store.state.today, STORE);
  check('client "today" is the Chicago date, not the UTC date', clientToday === ymd, { clientToday, ymd, utcYmd });
  check('the test really straddles midnight UTC', utcYmd !== ymd, { utcYmd, ymd });
  /* Part A runs in Advanced (every cost is shown); Part B switches to Simple */
  await page.evaluate(async u => (await import(u)).store.setAdvanced(true), STORE); await page.waitForTimeout(300);

  /* engine truth, read once */
  const truth = await page.evaluate(async u => {
    const { store } = await import(u);
    return store.list('project').map(p => { const t = window.PMOEngine.projectTruth(store.state.docs, p.id, store.state.today);
      const live = p.status === 'live';
      return { id: p.id, name: p.name, live, show: t.cost.show !== false, t: { label: t.label, forecast: t.forecastFinish, late: t.lateCount, blockers: t.blocking.count, planned: t.cost.planned, actual: t.cost.actual, cost: t.cost.forecast, total: t.tasks.total,
        who: live || !t.who[0] ? null : t.who[0].name, steps: live ? 0 : t.stepsLeft, checks: live ? 0 : t.launchChecks.notPassed } }; });
  }, STORE);
  check('seed has projects', truth.length >= 3, truth.length);

  /* read one surface: the label element plus the data-t facts inside a container */
  const readIn = (sel, labelSel) => page.evaluate(([s, ls]) => {
    const box = document.querySelector(s); if (!box) return null;
    const g = k => { const el = box.querySelector(`[data-t="${k}"]`); return el ? el.textContent : null; };
    const lab = box.querySelector(ls || '[data-summary-label]');
    const w0 = box.querySelector('[data-who-i="0"] [data-who-name], [data-who-row="0"] [data-who-name], [data-t="who"]');
    return { label: lab ? lab.textContent : null, forecast: g('forecast'), late: g('late'), blockers: g('blockers'), planned: g('planned'), actual: g('actual'), cost: g('cost'), who: w0 ? w0.textContent : undefined, steps: g('steps') == null ? undefined : g('steps') };
  }, [sel, labelSel]);

  const seen = {};
  truth.forEach(x => { seen[x.id] = { engine: norm(x.t) }; });
  /* the engine's own label for an empty forecast */
  truth.forEach(x => { if (!x.t.total && !x.live) seen[x.id].engine.forecast = 'none'; });

  /* home cards */
  for (const x of truth) seen[x.id].home = norm(await readIn(`[data-ptile="${x.id}"]`));
  await page.screenshot({ path: `${SHOTS}/01-home.png`, fullPage: true });

  /* projects list */
  await page.goto(ROOT + '/projects'); await page.waitForSelector('[data-plist]');
  for (const x of truth) seen[x.id].list = norm(await readIn(`[data-plist="${x.id}"]`));
  await page.screenshot({ path: `${SHOTS}/02-projects.png`, fullPage: true });

  /* portfolio rows + CSV */
  await page.goto(ROOT + '/portfolio'); await page.waitForSelector('[data-prow]');
  for (const x of truth) seen[x.id].portfolio = norm(await readIn(`tr[data-prow="${x.id}"]`));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export-pf]')]);
  check('CSV file name uses the local date', dl.suggestedFilename() === `portfolio-${ymd}.csv`, dl.suggestedFilename());
  const csv = parseCSV(fs.readFileSync(await dl.path(), 'utf8'));
  const H = csv[0], col = n => H.indexOf(n);
  for (const n of ['Project', 'Status', 'Expected finish', 'Late', 'Past due', 'Will finish after due date', 'Blocking', 'First to act', 'Launch checks not passed', 'Planned budget', 'Actual cost', 'Expected cost']) check(`CSV has column "${n}"`, col(n) >= 0, H);
  check('CSV has no "Running late" or "Forecast cost" column', !H.includes('Running late') && !H.includes('Forecast cost'), H);
  for (const x of truth) {
    const r = csv.find(row => row[col('Project')] === x.name);
    seen[x.id].csv = r ? norm({ label: r[col('Status')], forecast: r[col('Expected finish')], late: r[col('Late')], blockers: r[col('Blocking')], planned: r[col('Planned budget')], actual: r[col('Actual cost')], cost: r[col('Expected cost')], who: r[col('First to act')], checks: r[col('Launch checks not passed')] }) : null;
  }
  await page.screenshot({ path: `${SHOTS}/03-portfolio.png`, fullPage: false });

  /* project header + status report view */
  for (const x of truth) {
    await page.goto(ROOT + '/project/' + x.id); await page.waitForSelector('.hdr h1');
    seen[x.id].header = norm(await readIn('.hdr'));
    await page.click('[data-report]');
    await page.waitForSelector('[data-rep-facts]', { timeout: 20000 });
    seen[x.id].report = norm(await readIn('[data-prj-rep]', '.rag'));
    /* R10.1: the window ends today, so the period's "behind" list is the project screen's late list */
    {
      const late = await page.evaluate(async ([u, prj]) => { const { store } = await import(u); const t = window.PMOEngine.projectTruth(store.state.docs, prj, store.state.today);
        const by = Object.fromEntries(store.list('workItem').map(w => [w.id, w.title])); return { text: t.lateText, titles: t.late.map(id => by[id]) }; }, [STORE, x.id]);
      const shownB = await page.$$eval('[data-prj-rep] [data-psec="behind"] li', ls => ls.map(l => l.textContent));
      const emptyB = await page.locator('[data-prj-rep] [data-psec="behind"][data-psec-empty]').count();
      check(`${x.name}: period "behind" (window ends today) = the screen's late list`, late.titles.length
        ? shownB[0] === late.text && shownB.length === late.titles.length + 1 && late.titles.every(tl => shownB.some(l => l.includes('“' + tl + '”')))
        : emptyB === 1, { late, shownB });
      check(`${x.name}: report header shows this week's window`, /^Week of [A-Z][a-z]{2} [A-Z][a-z]{2} \d+ – /.test(await page.innerText('[data-prj-rep] [data-rep-window]')));
    }
    /* the written report (server) is dated with the visitor's today, so its words agree with the facts strip */
    const words = await page.innerText('[data-prj-rep] .pmo-rep-p').catch(() => '');
    const shownF = await page.innerText('[data-prj-rep] [data-t="forecast"]').catch(() => '');
    if (/^[A-Z][a-z]{2} \d/.test(shownF) && /Expected [A-Z][a-z]{2} \d/.test(words)) check(`${x.name}: written report says the same expected date`, words.includes('Expected ' + shownF.trim()), { words: words.slice(0, 120), shownF });
    await page.screenshot({ path: `${SHOTS}/04-project-${x.id}.png`, fullPage: false });
  }

  /* compare */
  const FIELDS = ['label', 'forecast', 'late', 'blockers', 'planned', 'actual', 'cost', 'who', 'steps', 'checks'];
  for (const x of truth) {
    const s = seen[x.id];
    for (const surf of ['home', 'list', 'portfolio', 'header', 'report', 'csv']) {
      check(`${x.name}: ${surf} was read`, !!s[surf], s[surf]);
      if (!s[surf]) continue;
      for (const f of FIELDS) {
        if (x.live && f === 'forecast' && surf === 'csv' && s.csv.forecast === 'none') continue;
        if (!x.show && ['planned', 'actual', 'cost'].includes(f)) continue; /* no budget or rates: cost is omitted */
        if ((f === 'who' || f === 'steps' || f === 'checks') && s[surf][f] === undefined) continue; /* surface doesn't show it (checked in Part B) */
        if (f === 'who' && surf !== 'csv' && s[surf][f] === 'none' && s.engine[f] !== 'none') { check(`${x.name}: ${surf} shows who acts first`, false, { engine: s.engine[f] }); continue; }
        check(`${x.name}: ${surf} ${f} = projectTruth`, s[surf][f] === s.engine[f], { [surf]: s[surf][f], engine: s.engine[f] });
      }
    }
  }


  /* ======================= Part B (R9 §12): Simple, every screen, plus a new accepted project ======================= */
  console.log('\nPart B: R9 one truth, enforced (Simple)');
  await page.evaluate(async u => (await import(u)).store.setAdvanced(false), STORE); await page.waitForTimeout(300);
  const textOf = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) return '';
    const c = el.cloneNode(true); c.querySelectorAll('[data-feed],[data-history],[data-activity],.ev,.cmt,details:not([open]) > :not(summary)').forEach(x => x.remove()); return c.innerText; }, sel);
  const weekendAt = async label => { const w = weekendDates(await textOf('#app'), ymd); check(`no weekend dates: ${label}`, w.length === 0, w.slice(0, 3)); };
  /* "On track" never shown with a late count above 0, anywhere on the page: every element showing a label is checked
     against the late count shown in the same card / row */
  const onTrackAt = async label => { const bad = await page.evaluate(() => [...document.querySelectorAll('[data-summary-label], .rag, [data-project-label]')].filter(l => /On track/.test(l.textContent || l.dataset.projectLabel || '')).map(l => {
      const box = l.closest('[data-ptile],[data-plist],[data-pcard],[data-prow],.hdr,[data-prj-rep],[data-dash-prj]') || document.body;
      const n = box.querySelector('[data-t="late"]'); return n && Number(n.textContent) > 0 ? box.textContent.slice(0, 120) : null; }).filter(Boolean));
    check(`"On track" never next to a late count: ${label}`, bad.length === 0, bad); };

  /* a new project, accepted plan: 0 late tasks on day 0, and "done by about X" = projectTruth.forecastFinish */
  const pmId = await page.evaluate(async u => { const { store } = await import(u); return store.list('project').filter(p => p.status !== 'live')[0].owner; }, STORE);
  await page.selectOption('#persona', pmId); await page.waitForTimeout(400);
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]');
  await page.click('.sect [data-new-project]'); await page.waitForSelector('.overlay .modal');
  const NPN = 'Northwind consistency check ' + (Math.random() * 1e4 | 0);
  await page.fill('.overlay input[name="name"]', NPN);
  const procOpt = await page.evaluate(() => { const s = document.querySelector('.overlay select[name="from"]'); const o = s && [...s.options].find(x => x.value === 'invoice-approval') || (s && [...s.options].find(x => x.value)); return o ? o.value : null; });
  if (procOpt) await page.selectOption('.overlay select[name="from"]', procOpt);
  await page.click('.overlay [data-act="create"]');
  await page.waitForURL(/\/project\/prj-/, { timeout: 15000 });
  const fp = await page.waitForSelector('.overlay [data-first-plan]', { timeout: 20000 }).then(() => true).catch(() => false);
  check('new project: a first plan is offered', fp);
  let planFinish = null, planMsg = '';
  if (fp) {
    planFinish = await page.getAttribute('.overlay [data-plan-fit]', 'data-plan-finish').catch(() => null);
    planMsg = await page.innerText('.overlay [data-plan-fit]').catch(() => '');
    await page.click('.overlay [data-act="accept"]');
    await page.waitForSelector('.overlay', { state: 'detached', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  const np = await page.evaluate(async ([u, n]) => { const { store } = await import(u); const p = store.list('project').find(x => x.name === n); if (!p) return null;
    const t = window.PMOEngine.projectTruth(store.state.docs, p.id, store.state.today);
    return { id: p.id, n: store.list('workItem', w => w.projectId === p.id).length, late: t.lateCount, finish: t.forecastFinish, owners: store.list('workItem', w => w.projectId === p.id).map(w => w.owner || ('role:' + (w.ownerRole || ''))) }; }, [STORE, NPN]);
  check('new project: the plan was accepted', !!np && np.n > 0, np);
  if (np) {
    check('new project: a freshly accepted plan has 0 late tasks', np.late === 0, np);
    check('new project: "done by about X" in the dialog = projectTruth.forecastFinish after Accept', planFinish === np.finish, { planFinish, finish: np.finish, planMsg });
    check('new project: the dialog says whether the plan fits the deadline', /Done by about|needs until/.test(planMsg), planMsg);
  }

  /* everything the engine says, read once (after the new project exists) */
  const T = await page.evaluate(async u => { const { store } = await import(u); const E = window.PMOEngine;
    return store.list('project').map(p => { const t = E.projectTruth(store.state.docs, p.id, store.state.today);
      return { id: p.id, name: p.name, live: p.status === 'live', label: t.label, late: t.lateCount, lateIds: t.late, forecast: t.forecastFinish, deadline: t.deadline, total: t.tasks.total,
        who0: t.who[0] ? t.who[0].name : null, who: t.who.map(x => x.name + ': ' + x.what), blockers: t.blocking.count, blockerRows: t.who.filter(x => x.why === 'blocker').length,
        /* R11 §5: a "What's blocking" row is its who row plus the blocking item's own words */
        whoBox: t.who.filter(x => x.why === 'blocker').map(x => { const b = t.blocking.items.find(i => 'data:' + i.dataId === x.ref); return x.name + ': ' + x.what + (b ? ' · ' + b.text : ''); }), steps: t.stepsLeft, testing: t.testing,
        approvals: (t.approvals || []).map(a => ({ bu: a.bu, needed: a.needed, waitingOn: a.waitingOn })),
        lateSteps: t.late.map(id => { const w = store.get('workItem', id); return w ? w.pid + '/' + w.step : null; }).filter(Boolean),
        steps2: [...new Set(store.list('workItem', w => w.projectId === p.id).map(w => w.pid + '/' + w.step))] }; }); }, STORE);
  const active = T.filter(x => !x.live);

  /* home: cards, and "Waiting for you" = personQueue for every person (badge = list length) */
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]'); await page.waitForTimeout(300);
  const homeB = await page.evaluate(() => [...document.querySelectorAll('[data-ptile]')].map(a => { const w = a.querySelector('[data-who-i="0"] [data-who-name]');
    return { id: a.dataset.ptile, label: a.querySelector('[data-summary-label]').textContent.trim(), late: Number((a.querySelector('[data-t="late"]') || {}).textContent), forecast: (a.querySelector('[data-t="forecast"]') || {}).textContent, who: w ? w.textContent : null }; }));
  for (const x of T) {
    const h = homeB.find(r => r.id === x.id);
    check(`B ${x.name}: home card label = truth`, h && h.label === (x.live ? 'Launched' : x.label), { h, label: x.label });
    check(`B ${x.name}: home card late = lateCount`, h && h.late === x.late, { h, late: x.late });
    if (!x.live) check(`B ${x.name}: home card first who = who[0]`, h && h.who === x.who0, { h, who0: x.who0 });
    if (x.total && !x.live) check(`B ${x.name}: home card forecast = truth`, h && normDate(h.forecast) === normDate(x.forecast), { h, forecast: x.forecast });
  }
  await weekendAt('home'); await onTrackAt('home');
  const people = await page.evaluate(async u => (await import(u)).store.state.people.map(p => ({ id: p.id, name: p.name })), STORE);
  for (const pp of people) {
    await page.selectOption('#persona', pp.id); await page.waitForTimeout(500);
    const q = await page.evaluate(async u => { const { store } = await import(u);
      const want = window.PMOEngine.personQueue(store.state.docs, store.state.me, store.state.today).map(x => x.title);
      const got = [...document.querySelectorAll('[data-waiting] [data-wq] .pmo-wtxt .t')].map(e => e.textContent.trim());
      const badge = document.querySelector('[data-wait-count]'); return { want, got, badge: badge ? Number(badge.textContent) : 0 }; }, STORE);
    check(`B Waiting for you (${pp.name}) = personQueue`, JSON.stringify(q.want) === JSON.stringify(q.got), q);
    check(`B Waiting for you (${pp.name}): badge = list length`, q.badge === q.got.length, q);
  }
  await page.selectOption('#persona', pmId); await page.waitForTimeout(400);

  /* projects list */
  await page.goto(ROOT + '/projects'); await page.waitForSelector('[data-plist]');
  for (const x of T) {
    const r = await readIn(`[data-plist="${x.id}"]`);
    check(`B ${x.name}: projects list label/late/who = truth`, r && normLabel(r.label) === (x.live ? 'Launched' : x.label) && normInt(r.late) === x.late && (x.live || (r.who ?? null) === x.who0), { r, x: { label: x.label, late: x.late, who0: x.who0 } });
  }
  await weekendAt('projects list'); await onTrackAt('projects list');

  /* portfolio (Simple cards) */
  await page.goto(ROOT + '/portfolio'); await page.waitForSelector('[data-pcard]');
  for (const x of T) {
    const r = await readIn(`[data-pcard="${x.id}"]`);
    check(`B ${x.name}: portfolio card label/late/who = truth`, r && normLabel(r.label) === (x.live ? 'Launched' : x.label) && normInt(r.late) === x.late && (x.live || (r.who ?? null) === x.who0), { r, x: { label: x.label, late: x.late, who0: x.who0 } });
  }
  await weekendAt('portfolio'); await onTrackAt('portfolio');

  for (const x of active) {
    /* project header (Simple): label, sentence, late, forecast, who, What's blocking, steps left */
    await page.goto(ROOT + '/project/' + x.id); await page.waitForSelector('.pmo-shdr'); await page.waitForTimeout(300);
    const hd = await page.evaluate(() => { const q = s => document.querySelector(s); const w = q('[data-who-acts] [data-who-row="0"] [data-who-name]');
      return { label: (q('.pmo-shdr [data-summary-label]') || {}).textContent, late: Number((q('.pmo-shdr [data-t="late"]') || {}).textContent), forecast: (q('.pmo-shdr [data-t="forecast"]') || {}).textContent,
        who: w ? w.textContent : null, rows: [...document.querySelectorAll('[data-who-acts] [data-who-row]')].map(r => r.querySelector('[data-who-name]').textContent + ': ' + r.querySelector('.s').textContent),
        blocking: document.querySelectorAll('[data-whats-blocking] [data-who-row]').length, blockingN: Number((q('[data-blocking-count]') || { textContent: 0 }).textContent),
        stepsLeft: q('[data-launch-steps]') ? Number(q('[data-launch-steps]').dataset.stepsLeft) : null, unticked: document.querySelectorAll('[data-launch-steps] li[data-ls-done="0"]').length,
        mapLate: [...document.querySelectorAll('#canvas [data-late-n]')].reduce((a, b) => a + Number(b.dataset.lateN), 0) }; });
    check(`B ${x.name}: header label = truth`, normLabel(hd.label) === x.label, { hd: hd.label, label: x.label });
    check(`B ${x.name}: header late = lateCount`, hd.late === x.late, { hd: hd.late, late: x.late });
    if (x.total) check(`B ${x.name}: header forecast = truth`, normDate(hd.forecast) === normDate(x.forecast), { hd: hd.forecast, f: x.forecast });
    check(`B ${x.name}: "Who needs to act" = projectTruth.who (in order)`, hd.rows.every(r => x.who.includes(r) || x.whoBox.includes(r)) && hd.rows.length === x.who.length && (hd.who || null) === (x.who0 || null), { rows: hd.rows, who: x.who, box: x.whoBox });
    check(`B ${x.name}: "What's blocking" = projectTruth.blocking (and its who rows)`, hd.blocking === Math.min(3, x.blockers) && (hd.blockingN || 0) === x.blockers && x.blockerRows === x.blockers, { hd: [hd.blocking, hd.blockingN], blockers: x.blockers, blockerRows: x.blockerRows });
    if (hd.stepsLeft != null) check(`B ${x.name}: checklist steps left = stepsLeft = its unticked rows`, hd.stepsLeft === x.steps && hd.unticked === x.steps, { hd: [hd.stepsLeft, hd.unticked], steps: x.steps });
    check(`B ${x.name}: map "Late" badges add up to lateCount`, hd.mapLate === x.late, { mapLate: hd.mapLate, late: x.late });
    await weekendAt(`project ${x.name}`); await onTrackAt(`project ${x.name}`);
    await page.screenshot({ path: `${SHOTS}/10-simple-project-${x.id}.png`, fullPage: false });

    /* Work tab: one "Late" badge per late task */
    await page.goto(ROOT + '/project/' + x.id + '?mode=work'); await page.waitForTimeout(500);
    const wl = await page.evaluate(() => [...document.querySelectorAll('.pmo-task:not(.is-done)')].filter(t => [...t.querySelectorAll('[data-sched]')].some(b => b.textContent.trim() === 'Late')).map(t => t.dataset.wid));
    check(`B ${x.name}: Work tab "Late" badges = projectTruth.late`, wl.length === x.late && wl.every(id => x.lateIds.includes(id)), { wl, late: x.lateIds });
    await weekendAt(`work ${x.name}`);

    /* step pages: the project label, and the project's "Late" task badges add up to lateCount */
    let stepLate = 0; const labels = [];
    for (const k of x.steps2) {
      const [pid, sid] = k.split('/');
      await page.goto(ROOT + `/process/${pid}/step/${sid}`); await page.waitForTimeout(350);
      const r = await page.evaluate(id => ({ label: (document.querySelector('[data-project-label]') || { dataset: {} }).dataset.projectLabel,
        late: [...document.querySelectorAll(`a.wi[href*="/project/${id}?"] [data-sched="late"], a.wi[href*="/project/${id}"] [data-sched="late"]`)].length }), x.id);
      stepLate += r.late; if (r.label) labels.push(r.label);
    }
    check(`B ${x.name}: step pages "Late" badges add up to lateCount`, stepLate === x.late, { stepLate, late: x.late });
    check(`B ${x.name}: step pages show a projectTruth label`, labels.every(l => T.some(t => t.label === l)), labels);

    /* Launch page: steps left, tests next, per-team test counts, waiting counts */
    await page.goto(ROOT + '/release/' + x.id); await page.waitForSelector('[data-simple-launch]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(400);
    const lp = await page.evaluate(() => ({ undone: document.querySelectorAll('[data-launch-steps] [data-launch-step][data-done="0"]').length, sentence: (document.querySelector('[data-launch-sentence]') || {}).textContent || '',
      next: (document.querySelector('[data-tests-next]') || {}).textContent || null,
      parts: [...document.querySelectorAll('[data-part]')].map(p => ({ bu: p.dataset.part, tests: (p.querySelector('[data-part-tests]') || { dataset: {} }).dataset.partTests || null, waiting: (p.querySelector('[data-part-waiting]') || { dataset: {} }).dataset.partWaiting })) }));
    check(`B ${x.name}: Launch checklist undone = stepsLeft`, lp.undone === x.steps, { undone: lp.undone, steps: x.steps });
    const m = lp.sentence.match(/(\d+) steps? left/);
    if (m) check(`B ${x.name}: Launch "N steps left" = stepsLeft`, Number(m[1]) === x.steps, { sentence: lp.sentence, steps: x.steps });
    if (lp.next != null) check(`B ${x.name}: Launch "Tests passed" action = testing.next`, lp.next.trim() === x.testing.next, { shown: lp.next, next: x.testing.next });
    for (const pt of lp.parts) {
      const pb = (x.testing.perBU || {})[pt.bu];
      if (pt.tests) check(`B ${x.name}: approval card ${pt.bu} tests = perBU (checks, coverage gaps included)`, !!pb && pt.tests === `${pb.passed}/${pb.checks}` && pb.checks === pb.total + pb.gapCount, { shown: pt.tests, pb });
      const ap = x.approvals.find(a => a.bu === pt.bu);
      if (pt.waiting && ap && typeof ap.waitingOn === 'number') check(`B ${x.name}: approval card ${pt.bu} "Waiting on N" = approvals.waitingOn`, Number(pt.waiting) === ap.waitingOn, { shown: pt.waiting, ap });
    }
    await weekendAt(`launch ${x.name}`);

    /* Testing page: total, passed, next */
    await page.goto(ROOT + '/testing/' + x.id); await page.waitForTimeout(900);
    const tp = await page.evaluate(() => ({ num: (document.querySelector('[data-tests-number]') || { dataset: {} }).dataset.testsNumber || null, next: (document.querySelector('[data-testing-next]') || {}).textContent || null }));
    if (tp.num) check(`B ${x.name}: Testing "passed of total" = testing`, tp.num === `${x.testing.passed}/${x.testing.total}`, { shown: tp.num, t: [x.testing.passed, x.testing.total] });
    else check(`B ${x.name}: Testing page shows the tests number`, false, tp);
    if (tp.next != null) check(`B ${x.name}: Testing "next" = testing.next`, tp.next.trim() === x.testing.next, { shown: tp.next, next: x.testing.next });
    await weekendAt(`testing ${x.name}`);
  }

  /* status report (Simple): label, late, forecast, steps left */
  for (const x of active.slice(0, 2)) {
    await page.goto(ROOT + '/project/' + x.id); await page.waitForSelector('[data-report]');
    await page.click('[data-report]'); await page.waitForSelector('[data-rep-facts]', { timeout: 20000 });
    const r = await readIn('[data-prj-rep]', '.rag');
    check(`B ${x.name}: status report label/late = truth`, normLabel(r.label) === x.label && normInt(r.late) === x.late, { r, x: [x.label, x.late] });
    const src = await page.innerText('[data-prj-rep] [data-rep-src]').catch(() => '');
    check(`B ${x.name}: status report source label in plain words`, !/Rules-based|deterministic/i.test(src) && src.length > 0, src);
    check(`B ${x.name}: status report has no "Regenerate"/"Forecast cost"`, !/Regenerate|Forecast cost/.test(await page.innerText('[data-prj-rep]')));
    await weekendAt(`report ${x.name}`);
  }

  /* ======================= Part C (R9 §10): phone header ======================= */
  console.log('\nPart C: phone header');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ROOT + '/'); await page.waitForSelector('[data-waiting]'); await page.waitForTimeout(300);
  const hH = await page.evaluate(() => document.querySelector('header.top').getBoundingClientRect().height);
  check('phone header <= 56px', hH <= 56, hH);
  check('phone: nav hidden until the menu opens', !(await page.locator('#nav').isVisible()));
  await page.click('#menuBtn'); await page.waitForTimeout(200);
  check('phone menu opens: nav and "Viewing as" visible', await page.locator('#nav').isVisible() && await page.locator('#persona').isVisible());
  await page.screenshot({ path: `${SHOTS}/20-phone-menu.png` });
  await page.click('#menuBtn'); await page.waitForTimeout(200);
  check('phone menu closes from the same button', !(await page.locator('#nav').isVisible()));
  await page.click('#menuBtn'); await page.waitForTimeout(150); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('phone menu closes with Escape', !(await page.locator('#nav').isVisible()));
  check('phone: no horizontal overflow on home', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async u => (await import(u)).store.setAdvanced(true), STORE); await page.waitForTimeout(300);

  /* done dates: mark a task done at 18:30 Chicago, its done date is today's Chicago date on board and timeline */
  const pick = await page.evaluate(async u => { const { store } = await import(u);
    const p = store.list('project', x => x.status !== 'live')[0];
    const w = store.list('workItem', w => w.projectId === p.id && w.status !== 'done')[0];
    return { prj: p.id, owner: p.owner, wid: w && w.id }; }, STORE);
  if (pick.wid) {
    await page.selectOption('#persona', pick.owner); await page.waitForTimeout(400);
    await page.goto(ROOT + `/project/${pick.prj}?mode=work`); await page.waitForSelector('tr[data-wid]');
    await page.selectOption(`[data-status="${pick.wid}"]`, 'done').catch(async () => {
      await page.evaluate(id => { const s = document.querySelector(`[data-status="${id}"]`); if (s) { s.value = [...s.options].find(o => /done/i.test(o.text)).value; s.dispatchEvent(new Event('change')); } }, pick.wid);
    });
    await page.waitForSelector('[data-undo-toast]', { timeout: 8000 });
    await page.waitForTimeout(800);
    const doneAt = await page.evaluate(async ([u, id]) => (await import(u)).store.get('workItem', id).doneAt, [STORE, pick.wid]);
    check('done date is the Chicago date (no UTC off-by-one)', doneAt === ymd, { doneAt, ymd });
    const want = await page.evaluate(d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), ymd);
    await page.goto(ROOT + `/project/${pick.prj}?mode=board`); await page.waitForSelector(`[data-card="${pick.wid}"]`);
    const boardTxt = await page.innerText(`[data-card="${pick.wid}"]`);
    check('board shows the same done date', boardTxt.includes('Done ' + want), boardTxt);
    await page.goto(ROOT + `/project/${pick.prj}?mode=timeline`); await page.waitForTimeout(800);
    const tl = await page.evaluate(id => { const r = [...document.querySelectorAll('.pmo-actual')].map(x => x.getAttribute('title')); return r; }, pick.wid);
    check('timeline shows the same done date', tl.some(t => t && t.startsWith('Done ' + want)), tl);
  } else check('a task to mark done exists', false);

  /* ======================= Part D (R10): the golden numbers (docs/pmoflow/GOLDEN-NUMBERS.md), on the screens ======================= */
  console.log('\nPart D: R10 golden numbers (fresh sandbox, seed day 0)');
  await goldenNumbers(browser, ymd, at, errors);

  check('no console errors', errors.length === 0, errors);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
