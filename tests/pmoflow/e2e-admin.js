/* E2E for stream S5 (R10): /admin People (roles, seats, invites), History (hash-chained audit, filters, CSV/JSON export,
   check a saved file), Calendar (custom day off, work/restore a federal holiday; the engine reads it), Security, and
   Sign in with Microsoft (mocked /.auth/me, plus the real local 404 which must leave the demo working).
   Usage: node tests/pmoflow/e2e-admin.js [port]   (dev server must be running on that port) */
const { chromium } = require('playwright');
const fs = require('fs');

const PORT = Number(process.argv[2] || 8845);
const ROOT = `http://localhost:${PORT}/concepts/pmoflow`;
const SHOTS = '/tmp/pmo-admin';
fs.mkdirSync(SHOTS, { recursive: true });
/* one fixed forwarded IP for the whole run (the sandbox and its rate limit are keyed on it) */
const IP = `198.51.100.${(Date.now() % 200) + 20}`;

let passed = 0, failed = 0;
const errors = [];
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ ' + msg); } }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'x-forwarded-for': IP }, acceptDownloads: true });
  let principal = null;   /* what the mocked SWA /.auth/me returns */
  await ctx.route('**/.auth/me', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ clientPrincipal: principal }) }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text() + ' @ ' + ((m.location() || {}).url || '')); });

  const settle = ms => page.waitForTimeout(ms || 500);
  const open = async path => { await page.goto(ROOT + path); await page.waitForSelector('.adm-body .card', { timeout: 20000 }); await page.waitForFunction(() => !/Loading/.test(document.querySelector('.adm-body').textContent.slice(0, 40)), null, { timeout: 20000 }); await settle(); };
  /* the toast whose text matches re (an earlier toast may still be on screen) */
  const toastSays = async re => { try { await page.waitForFunction(src => [...document.querySelectorAll('.toast')].some(t => new RegExp(src).test(t.textContent)), re.source, { timeout: 6000 }); return true; } catch (e) { return false; } };
  const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const setMe = id => page.evaluate(async v => { const { store } = await import('/concepts/pmoflow/app/store.js'); store.setMe(v); }, id);
  const shotBoth = async name => {
    for (const w of [1366, 390]) {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 }); await settle(350);
      ok(await noOverflow(), `${name}: no horizontal overflow at ${w}`);
      await page.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 }); await settle(250);
    ok(await noOverflow(), `${name}: no horizontal overflow at 1440`);
  };

  console.log('People');
  await open('/admin');
  ok(await page.isVisible('nav.adm-tabs a.on >> text=People'), '/admin opens on People');
  const href = await page.getAttribute('[data-signin]', 'href');
  ok(/^\/\.auth\/login\/aad\?post_login_redirect_uri=http%3A%2F%2Flocalhost/.test(href || ''), 'Sign in with Microsoft links to /.auth/login/aad and returns here');
  ok(await page.isVisible('nav#nav a.on >> text=Admin'), 'Admin is the active nav item');
  const paid0 = Number(await page.textContent('[data-seat-paid]')), free0 = Number(await page.textContent('[data-seat-free]'));
  ok(paid0 >= 5 && free0 >= 0, `seats: ${paid0} paid seats, ${free0} free`);
  ok(/a year/.test(await page.textContent('[data-seats]')), 'seat card shows the annual cost from pricing.json');
  /* R11 §3: one plan, named correctly, with no other plan's limit beside it */
  ok(await page.textContent('[data-plan-name]') === 'Business' && !/Team plan/.test(await page.textContent('[data-seats]')), 'seats: plan reads Business, no "Team plan allows" next to it');
  const daveSeat = await page.$eval('[data-person-row="do"]', el => el.textContent).catch(() => '');
  const daveRole = await page.$eval('[data-role="do"]', el => el.value).catch(() => '');
  ok(daveRole === 'approver' && /Free/.test(daveSeat), `Dave Ortiz (${daveRole || 'not seeded'}): an approver has a free seat`);
  ok(await page.$eval('[data-role="mc"]', el => el.value) === 'admin' && await page.$eval('[data-role="ps"]', el => el.value) === 'editor', 'default roles: process owner Admin, SME Editor');
  /* R15 (Jordan): a role change is proposed by one Admin and confirmed by another with the extra sign-in check */
  await page.selectOption('[data-role="ps"]', 'approver');
  ok(await toastSays(/Sent to a second Admin to confirm: Make Priya Shah an Approver \(now Editor\)/), 'a role change is sent to a second Admin (two Admins here)');
  await page.waitForSelector('[data-pending-roles] [data-role-pending]', { timeout: 8000 }).catch(() => {});
  ok(await page.$eval('[data-role="ps"]', el => el.value) === 'editor' && /Waiting: Make Priya Shah an Approver/.test(await page.textContent('[data-person-row="ps"]')), 'nothing changes until it is confirmed; the row says it is waiting');
  ok(await page.$eval('[data-pending-roles] [data-role-confirm]', b => b.disabled) && /You proposed it/.test(await page.textContent('[data-pending-roles]')), 'the proposer cannot confirm it, and is told why');
  ok(Number(await page.textContent('[data-seat-free]')) === free0, 'seats are unchanged while it waits');
  await shotBoth('roles-pending');
  /* promoting to Admin waits too (Jordan's one-click promotion) */
  await page.selectOption('[data-role="ar"]', 'admin');
  ok(await toastSays(/Sent to a second Admin to confirm: Make Ana Ruiz an Admin \(now Editor\)/), 'promoting to Admin is never one click');
  await settle(700);
  ok(await page.$eval('[data-role="ar"]', el => el.value) === 'editor', 'Ana is still an Editor');
  await setMe('ta'); await settle(900);
  const roleBtn = re => `[data-pending-roles] [data-role-pending]:has-text("${re}")`;
  await page.click(`${roleBtn('Make Priya Shah')} [data-role-confirm]`);
  await page.waitForSelector('.modal [name=code]');
  await page.fill('.modal [name=code]', '135790'); await page.click('.modal [data-act="verify"]');
  ok(await toastSays(/Confirmed: Make Priya Shah an Approver \(now Editor\)/), 'a second Admin confirms with the extra sign-in check');
  await settle(900);
  ok(Number(await page.textContent('[data-seat-free]')) === free0 + 1 && Number(await page.textContent('[data-seat-paid]')) === paid0 - 1, 'approver moves to a free seat once confirmed');
  await page.click(`${roleBtn('Make Ana Ruiz')} [data-role-cancel]`);
  ok(await toastSays(/Proposal turned down/), 'the second Admin can turn a promotion down');
  await settle(900);
  ok(!(await page.$('[data-pending-roles]')) && await page.$eval('[data-role="ar"]', el => el.value) === 'editor', 'nothing waits; Ana stays an Editor');
  await setMe('mc'); await settle(900);
  await page.fill('#adm-email', 'jordan.lee@northwind.example');
  await page.selectOption('#adm-irole', 'viewer');
  await page.click('[data-invite-form] button[type=submit]');
  ok(await toastSays(/Invited jordan.lee@northwind.example/), 'invite saved');
  await settle(900);
  await page.reload(); await page.waitForSelector('[data-person-row]'); await settle(800);
  ok(await page.$eval('[data-role="ps"]', el => el.value) === 'approver', 'role persists after reload');
  ok(/jordan\.lee@northwind\.example/.test(await page.textContent('[data-invites]')) && Number(await page.textContent('[data-seat-free]')) === free0 + 2, 'invite persists and counts as a free viewer seat');
  await shotBoth('people');
  await page.click('[data-uninvite]');
  ok(await toastSays(/Invite removed/), 'invite removed');
  await settle(900);
  ok(!(await page.$('[data-invite]')), 'no pending invites left');
  /* R14 L4 #2: project sponsors are set by an Admin who is not the project manager */
  ok(await page.isVisible('[data-sponsors]'), 'People shows the project sponsors');
  const spOpts = await page.$$eval('[data-sponsor="vendor-modernization"] option', os => os.map(o => o.value));
  ok(!spOpts.includes('ta') && !spOpts.includes('mc'), 'the project manager and the Admin themself are not offered as sponsor');
  ok(!(await page.$eval('[data-sponsor="vendor-modernization"]', el => el.disabled)), 'Maya (Admin, not the PM) can set the sponsor');
  await page.selectOption('[data-sponsor="vendor-modernization"]', 'do');
  ok(await toastSays(/Dave Ortiz is now the sponsor of Vendor Onboarding Modernization/), 'sponsor change confirmed');
  await settle(900);
  ok(/Dave Ortiz/.test(await page.textContent('[data-sponsor-row="vendor-modernization"] [data-sponsor-now]')), 'the sponsor shows as Dave Ortiz');
  await setMe('ta'); await settle(900);
  ok(await page.$eval('[data-sponsor="vendor-modernization"]', el => el.disabled) && /You manage this project/.test(await page.textContent('[data-sponsor-row="vendor-modernization"]')), 'the project manager (an Admin) cannot pick the sponsor, and is told why');
  /* from outside the browser, so the expected 403 is not a console error */
  const wsId = await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); return store.state.ws; });
  const spDeny = (await fetch(`http://localhost:${PORT}/api/pmoflow/workspaces/${wsId}/admin/sponsor/vendor-modernization`, { method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': IP }, body: JSON.stringify({ actor: 'ta', sponsor: 'ta' }) })).status;
  ok(spDeny === 403, 'the server refuses the project manager making himself sponsor');
  await shotBoth('sponsors');
  /* a non-admin sees why they can't change roles */
  await setMe('lp'); await settle(900);
  ok(await page.$eval('[data-sponsor="vendor-modernization"]', el => el.disabled), 'Editor: sponsor picker disabled');
  ok(await page.isVisible('[data-admin-only]') && await page.$eval('[data-role="ar"]', el => el.disabled), 'Editor: role pickers disabled with an explanation');
  ok(/ask (Maya Chen|Tom Alvarez)/.test(await page.textContent('[data-admin-only]')), 'explanation names the Admins');
  await setMe('mc'); await settle(900);

  console.log('Departments (R13 #1)');
  await open('/admin/departments');
  const deptNames = async () => page.$$eval('[data-dept]', els => els.map(e => e.dataset.deptName));
  const seeded = await deptNames();
  ok(['Accounts Payable', 'Compliance', 'IT', 'PMO', 'Procurement', 'Treasury'].every(n => seeded.includes(n)), 'the six seeded departments are listed: ' + seeded.join(', '));
  ok(/Rosa/.test(await page.textContent('[data-dept-name="Procurement"] [data-dept-approvers-list]')), 'a seeded department shows its named approver');
  await page.fill('#adm-dn', 'Credit'); await page.click('[data-dept-add-form] button[type=submit]');
  ok(await toastSays(/Added Credit/), 'department added');
  await page.waitForSelector('[data-dept-name="Credit"]', { timeout: 8000 }).catch(() => {});
  await page.reload(); await page.waitForSelector('[data-dept]'); await settle(800);
  ok((await deptNames()).includes('Credit'), 'Credit persists after reload');
  const engDepts = () => page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); return window.PMOEngine.departments(store.state.docs).map(d => ({ name: d.name, approvers: d.approvers, people: d.people.map(p => p.id) })); });
  ok((await engDepts()).some(d => d.name === 'Credit'), 'the engine reads the new department (one list for routing)');
  /* duplicate name is refused with the engine's sentence */
  await page.fill('#adm-dn', 'credit'); await page.click('[data-dept-add-form] button[type=submit]');
  ok(await toastSays(/already exists/), 'a duplicate name is refused');
  /* rename */
  await page.click('[data-dept-name="Credit"] [data-dept-rename]');
  await page.fill('.modal #adm-rn', 'Credit and Collections'); await page.click('.modal [data-act="save"]');
  ok(await toastSays(/Renamed Credit to Credit and Collections/), 'department renamed');
  await page.waitForSelector('[data-dept-name="Credit and Collections"]', { timeout: 8000 }).catch(() => {});
  const cc = '[data-dept-name="Credit and Collections"]';
  /* R14 (Jordan): moving a person and choosing approvers are proposed by one Admin and confirmed by another (step-up) */
  const confirmAs = async (who, re) => {
    await setMe(who); await settle(900);
    const btn = `[data-pending-depts] [data-pending]:has-text("${re}") [data-pend-confirm]`;
    await page.waitForSelector(btn, { timeout: 8000 });
    await page.click(btn);
    await page.waitForSelector('.modal [name=code]');
    await page.fill('.modal [name=code]', '246810'); await page.click('.modal [data-act="verify"]');
  };
  await page.selectOption(`${cc} [data-dept-assign-form] select`, 'ar');
  await page.click(`${cc} [data-dept-assign-form] button[type=submit]`);
  ok(await toastSays(/Sent to a second Admin to confirm: Ana Ruiz to Credit and Collections/), 'moving a person is sent to a second Admin (two Admins here)');
  await page.waitForSelector('[data-pending-depts] [data-pending]', { timeout: 8000 });
  ok(/Move Ana Ruiz from Accounts Payable to Credit and Collections/.test(await page.textContent('[data-pending-depts]')), 'the pending move is listed on the Departments tab');
  ok(await page.$eval('[data-pending-depts] [data-pend-confirm]', b => b.disabled) && /You proposed it/.test(await page.textContent('[data-pending-depts]')), 'the proposer cannot confirm it, and is told why');
  ok(!/Ana Ruiz/.test(await page.textContent(`${cc} .adm-dppl`).catch(() => '')), 'nothing changes until it is confirmed');
  ok((await engDepts()).find(d => d.name === 'Accounts Payable').people.includes('ar'), 'engine: Ana is still in Accounts Payable');
  await shotBoth('departments-pending');
  await confirmAs('ta', 'Move Ana Ruiz');
  ok(await toastSays(/Confirmed: Move Ana Ruiz from Accounts Payable to Credit and Collections/), 'a second Admin confirms with the extra sign-in check');
  await page.waitForFunction(sel => /Ana Ruiz/.test((document.querySelector(sel + ' .adm-dppl') || {}).textContent || ''), cc, { timeout: 8000 }).catch(() => {});
  ok(/Ana Ruiz/.test(await page.textContent(`${cc} .adm-dppl`).catch(() => '')), 'the department lists its person once confirmed');
  const since = await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js'); return store.get('person', 'ar').buSince; });
  ok(!!since && Math.abs(Date.parse(since) - Date.now()) < 5 * 60000, 'the membership carries the server time it started');
  await setMe('mc'); await settle(900);
  /* set approvers: Credit and Collections has none yet, so its FIRST approver is one Admin and immediate (R14 rule 1) */
  await page.click(`${cc} [data-dept-approvers] summary`);
  await page.check(`${cc} [data-dept-approvers] input[value="ar"]`);
  await page.click(`${cc} [data-dept-approvers-save]`);
  ok(await toastSays(/Ana Ruiz now approves for Credit and Collections \(applies to new work only\)/), 'the first approver is named at once, for new work only');
  await page.waitForFunction(sel => /Ana Ruiz/.test((document.querySelector(sel + ' [data-dept-approvers-list]') || {}).textContent || ''), cc, { timeout: 8000 }).catch(() => {});
  ok(/Approves: Ana Ruiz/.test(await page.textContent(`${cc} .adm-dwho`)), 'the card names the approver');
  /* changing an existing department's approvers waits for a second Admin */
  await page.click(`${cc} [data-dept-approvers] summary`).catch(() => {});
  if (!(await page.isVisible(`${cc} [data-dept-approvers] input[value="lp"]`))) await page.click(`${cc} [data-dept-approvers] summary`);
  await page.check(`${cc} [data-dept-approvers] input[value="lp"]`);
  await page.click(`${cc} [data-dept-approvers-save]`);
  ok(await toastSays(/Sent to a second Admin to confirm: Credit and Collections approvers/), 'changing existing approvers is sent to a second Admin');
  await settle(600);
  ok(!/Leo Park/.test(await page.textContent(`${cc} [data-dept-approvers-list]`)), 'no change until confirmed');
  await page.click('[data-pending-depts] [data-pending]:has-text("Credit and Collections approvers") [data-pend-cancel]');
  ok(await toastSays(/Proposal withdrawn/), 'withdrawn');
  await settle(700);
  const ccEng = (await engDepts()).find(d => d.name === 'Credit and Collections');
  ok(ccEng && ccEng.approvers.join() === 'ar' && ccEng.people.includes('ar'), 'engine: approvers and members match the screen');
  await setMe('mc'); await settle(900);
  /* withdraw: nothing changes */
  await page.selectOption(`${cc} [data-dept-assign-form] select`, 'lp');
  await page.click(`${cc} [data-dept-assign-form] button[type=submit]`);
  await toastSays(/Sent to a second Admin/); await settle(700);
  await page.click('[data-pending-depts] [data-pending]:has-text("Leo Park") [data-pend-cancel]');
  ok(await toastSays(/Proposal withdrawn/), 'the proposer can withdraw it');
  await settle(700);
  ok(!(await page.$('[data-pending-depts]')) && (await engDepts()).find(d => d.name === 'Treasury').people.includes('lp'), 'withdrawn: Leo stays in Treasury');
  /* remove is blocked while people are in it, and says why */
  ok(await page.$eval(`${cc} [data-dept-remove]`, b => b.disabled) && /Move the 1 person in Credit and Collections/.test(await page.textContent(`${cc} .adm-dwhy`)), 'remove is blocked while people are in it, with the reason');
  await shotBoth('departments');
  /* People tab: the department column shows and moves a person */
  await open('/admin/people');
  ok(await page.$eval('[data-assign="ar"] option:checked', o => o.textContent) === 'Credit and Collections', 'People shows the department');
  await page.selectOption('[data-assign="ar"]', { label: 'Accounts Payable' });
  ok(await toastSays(/Sent to a second Admin to confirm: Ana Ruiz to Accounts Payable/), 'a move from the People tab is proposed too');
  await settle(900);
  ok(/Waiting: Move Ana Ruiz from Credit and Collections to Accounts Payable/.test(await page.textContent('[data-person-row="ar"]')), 'People shows the waiting move');
  await open('/admin/departments');
  await confirmAs('ta', 'Move Ana Ruiz from Credit');
  ok(await toastSays(/Confirmed: Move Ana Ruiz from Credit and Collections to Accounts Payable/), 'moved back once a second Admin confirms');
  await settle(900);
  await setMe('mc'); await settle(900);
  await open('/admin/people');
  /* invite with a department */
  await page.fill('#adm-email', 'sam.wu@northwind.example');
  await page.selectOption('#adm-irole', 'approver');
  await page.selectOption('#adm-idept', { label: 'Credit and Collections' });
  await page.click('[data-invite-form] button[type=submit]');
  ok(await toastSays(/Invited sam\.wu@northwind\.example/), 'invite with a department saved');
  await settle(900);
  ok(/Credit and Collections/.test(await page.textContent('[data-invite-dept]').catch(() => '')), 'the invite shows its department');
  await page.click('[data-uninvite]'); await toastSays(/Invite removed/); await settle(800);
  /* now empty: remove it */
  await open('/admin/departments');
  await page.click(`${cc} [data-dept-remove]`);
  await page.click('.modal [data-act="rm"]');
  ok(await toastSays(/Removed Credit and Collections/), 'empty department removed');
  await page.waitForFunction(() => !document.querySelector('[data-dept-name="Credit and Collections"]'), null, { timeout: 8000 }).catch(() => {});
  ok(!(await deptNames()).includes('Credit and Collections'), 'it is gone from the list');
  /* an Editor can add, not rename */
  await setMe('lp'); await settle(900);
  ok(!(await page.$eval('#adm-dn', el => el.disabled)) && await page.$eval('[data-dept-rename]', b => b.disabled) && await page.isVisible('[data-admin-only]'), 'Editor: may add a department; rename is Admin only, explained');
  await setMe('mc'); await settle(900);

  console.log('Calendar');
  await open('/admin/calendar');
  const year = Number((await page.evaluate(async () => (await import('/concepts/pmoflow/app/store.js')).store.state.today)).slice(0, 4));
  const day = `${year}-12-24`;
  ok(await page.$$eval('[data-kind="federal"]', els => els.length) >= 30, 'three years of computed US federal holidays listed');
  await page.fill('#adm-hd', day); await page.fill('#adm-hn', 'Christmas Eve');
  await page.click('[data-holiday-form] button[type=submit]');
  ok(await toastSays(/Added Christmas Eve/), 'custom day off added');
  await settle(1000);
  await page.reload(); await page.waitForSelector('[data-holiday]'); await settle(800);
  ok(await page.$(`[data-holiday="${day}"][data-kind="custom"]`) != null, 'custom day persists after reload');
  ok(await page.evaluate(async d => { const { store } = await import('/concepts/pmoflow/app/store.js'); return window.PMOEngine.isHoliday(d, store.state.docs); }, day), 'engine treats the custom day as a holiday');
  const fed = await page.$eval(`[data-kind="federal"]:not(.past)`, el => el.dataset.holiday);
  await page.click(`[data-hwork="${fed}"]`);
  ok(await toastSays(/working day/), 'federal holiday switched to a working day');
  await settle(1000);
  ok(await page.$(`[data-holiday="${fed}"][data-kind="worked"]`) != null, 'it shows as "Working day"');
  ok(!(await page.evaluate(async d => { const { store } = await import('/concepts/pmoflow/app/store.js'); return window.PMOEngine.isHoliday(d, store.state.docs); }, fed)), 'engine no longer skips it');
  await shotBoth('calendar');
  await page.click(`[data-hrestore="${fed}"]`);
  ok(await toastSays(/day off/), 'federal holiday restored');
  await settle(1000);
  ok(await page.$(`[data-holiday="${fed}"][data-kind="federal"]`) != null, 'restored to US federal');

  console.log('History');
  /* R14: a save with the person's own text: the server writes the sentence, the text is shown apart as their note */
  await page.evaluate(async () => { const { store } = await import('/concepts/pmoflow/app/store.js');
    const w = store.state.docs.workItem.find(d => d.id === 'W12').data;
    await fetch(`/api/pmoflow/ws/${store.state.ws}/doc/workItem/W12`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actor: w.owner, summary: 'Comment added', data: Object.assign({}, w, { title: w.title + ' (checked)' }) }) }); });
  /* R14 (Jordan B): a refused write (Dave, an Approver, edits a task) is in History, labelled; sent from outside the browser */
  {
    const wsH = await page.evaluate(async () => (await import('/concepts/pmoflow/app/store.js')).store.state.ws);
    const sth = await (await fetch(`http://localhost:${PORT}/api/pmoflow/ws/${wsH}/state`, { headers: { 'x-forwarded-for': IP } })).json();
    const w7 = sth.docs.workItem.find(d => d.id === 'W7').data;
    const rr = await fetch(`http://localhost:${PORT}/api/pmoflow/ws/${wsH}/doc/workItem/W7`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-forwarded-for': IP },
      body: JSON.stringify({ actor: 'do', summary: 'Viewed', data: Object.assign({}, w7, { title: 'Changed by an approver' }) }) });
    ok(rr.status >= 400, `the server refuses the write (${rr.status})`);
  }
  await open('/admin/history');
  await page.waitForSelector('[data-verify]');
  ok(await page.getAttribute('[data-verify]', 'data-verify') === 'ok', 'chain verifies with a refused entry in it');
  const refusedTxt = await page.$$eval('[data-entry-refused]', els => els.map(e => e.textContent));
  ok(refusedTxt.length >= 1 && refusedTxt.every(t => /^Refused: /.test(t)) && !refusedTxt.some(t => /Viewed/.test(t)), 'History labels the refused write "Refused: …" (server-written)');
  ok(await page.getAttribute('[data-verify]', 'data-verify') === 'ok', 'chain verified');
  const log = await page.textContent('.adm-log');
  ok(/Changed Priya Shah's role from Editor to Approver/.test(log) && /Added Christmas Eve/.test(log) && /Invited jordan/.test(log), 'history lists the admin changes');
  ok(/Set the sponsor of “Vendor Onboarding Modernization”: .* → Dave Ortiz/.test(log), 'history lists the sponsor change (server-written)');
  ok(/Changed Priya Shah's role from Editor to Approver \(proposed by Maya Chen, confirmed by Tom Alvarez with the extra sign-in check\)/.test(log) && /Turned down Maya Chen’s proposal to change Ana Ruiz's role from Editor to Admin/.test(log), 'history lists who proposed and who confirmed a role change (server-written)');
  /* R15 (PMO R14 disagreement 1): nothing the system wrote in this sandbox (seeded history included) is "Older entry" */
  ok((await page.$$('[data-entry-client]')).length === 0, 'no entry in this sandbox is labelled "Older entry: worded by the person"');
  ok(await page.locator('[data-entry-note]', { hasText: 'Their note: “Comment added”' }).count() >= 1, 'a person’s own text shows apart, as their note');
  ok(!(await page.$$eval('.adm-log tbody tr', els => els.map(e => e.textContent))).some(t => /^\S.*Comment added/.test(t) && !/Their note/.test(t)), 'their text is never the sentence');
  ok(/Added the Credit department/.test(log) && /Renamed the Credit department to Credit and Collections/.test(log) && /Removed the Credit and Collections department/.test(log), 'history lists the department changes');
  await page.fill('[data-f="item"]', 'Christmas'); await page.press('[data-f="item"]', 'Enter'); await settle(500);
  const rows = await page.$$eval('.adm-log tbody tr', els => els.map(e => e.textContent));
  ok(rows.length >= 1 && rows.every(t => /Christmas/.test(t)), `item filter narrows to ${rows.length} entr(y/ies)`);
  await page.selectOption('[data-f="person"]', 'mc'); await settle(400);
  ok((await page.$$eval('.adm-log tbody tr .adm-who', els => els.map(e => e.textContent))).every(t => /Maya Chen/.test(t)), 'person filter');
  await page.fill('[data-f="from"]', '2001-01-01'); await page.fill('[data-f="to"]', '2001-01-02'); await page.dispatchEvent('[data-f="to"]', 'change'); await settle(400);
  ok(/No changes match/.test(await page.textContent('.adm-body')), 'date filter excludes everything outside the range');
  await page.click('[data-fclear]'); await settle(400);
  await shotBoth('history');
  /* CSV export (unfiltered) */
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="csv"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(/^﻿?seq,at,actor,actorName,action,ref,summary,prevHash,hash\r\n/.test(csv) && /# Verify: Chain intact/.test(csv), 'CSV export has the chain columns and the Verify line');
  /* JSON export */
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="json"]')]);
  const jsonPath = await dl.path();
  const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  ok(j.verify && j.verify.ok === true && j.entries.length === j.total && j.entries.every((e, i) => i === 0 || e.prevHash === j.entries[i - 1].hash), 'JSON export: verified, every entry links to the one before');
  ok(j.head && j.head.count === j.total && j.head.hash === j.entries[j.entries.length - 1].hash && /^[a-f0-9]{64}$/.test(j.head.signature), 'JSON export carries the signed head (count, last fingerprint, signature)');
  ok(!/PMOFLOW_AUDIT_KEY|AccountKey/i.test(JSON.stringify(j)), 'no key material in the export');
  ok(/\r\n# Signed head,\d+,[a-f0-9]{64},[a-f0-9]{64},(production|development) key\r\n$/.test(csv), 'CSV export ends with the signed head row (count, head, signature, key source)');
  ok(/,(production|development) key\r\n$/.test(csv) && csv.trimEnd().endsWith(j.keySource), 'CSV and JSON name the same key source: ' + j.keySource);
  ok((await page.getAttribute('[data-keysource]', 'data-keysource')) === j.keySource && (await page.textContent('[data-keysource]')).includes(j.keySource), 'History shows the key source');
  await settle(800);
  /* check the saved file, then a tampered copy */
  await page.click('.adm-check summary');
  await page.setInputFiles('[data-checkfile]', jsonPath);
  await page.waitForSelector('[data-filecheck]');
  ok(await page.getAttribute('[data-filecheck]', 'data-filecheck') === 'ok', 'saved export checks out');
  /* R13 (Jordan): the JSON check names the key source, worded exactly as the CSV check below */
  const jsonKeyNote = await page.textContent('[data-filecheck-key]').catch(() => '');
  ok(jsonKeyNote === `Signed with the ${j.keySource}.`, 'JSON check states the key source: ' + jsonKeyNote);
  const bad = JSON.parse(JSON.stringify(j)); bad.entries[Math.floor(bad.entries.length / 2)].summary += ' (edited)';
  const badPath = `${SHOTS}/tampered.json`; fs.writeFileSync(badPath, JSON.stringify(bad));
  if (!(await page.isVisible('[data-checkfile]'))) await page.click('.adm-check summary');
  await page.setInputFiles('[data-checkfile]', badPath);
  await page.waitForSelector('[data-filecheck="broken"]', { timeout: 8000 }).catch(() => {});
  ok(await page.getAttribute('[data-filecheck]', 'data-filecheck') === 'broken' && /Chain broken at entry/.test(await page.textContent('[data-filecheck]')), 'a tampered export is caught');
  /* R11 break tests (expert-pmo.md): a deleted last entry, and a fully re-hashed forgery */
  const checkFile = async (obj, name) => {
    const fp = `${SHOTS}/${name}.json`; fs.writeFileSync(fp, JSON.stringify(obj));
    if (!(await page.isVisible('[data-checkfile]'))) await page.click('.adm-check summary');
    await page.evaluate(() => { const el = document.querySelector('[data-filecheck]'); if (el) el.remove(); });
    await page.setInputFiles('[data-checkfile]', fp);
    await page.waitForSelector('[data-filecheck]', { timeout: 8000 }).catch(() => {});
    return { state: await page.getAttribute('[data-filecheck]', 'data-filecheck').catch(() => null), text: await page.textContent('[data-filecheck]').catch(() => '') };
  };
  const tail = JSON.parse(JSON.stringify(j)); tail.entries.pop(); tail.total -= 1;
  let res = await checkFile(tail, 'deleted-tail');
  ok(res.state === 'broken' && /removed from the end/.test(res.text), 'a deleted last entry is caught: ' + res.text.slice(0, 90));
  const crypto = require('crypto');
  const forged = JSON.parse(JSON.stringify(j));
  forged.entries[1].summary = 'Nothing to see here';
  let prev = forged.genesis;
  forged.entries.forEach((e, i) => { e.prevHash = prev; e.hash = crypto.createHash('sha256').update(prev + '\n' + JSON.stringify([i + 1, String(e.at || ''), String(e.actor || ''), String(e.actorName || ''), String(e.action || ''), String(e.ref || ''), String(e.summary || '')])).digest('hex'); prev = e.hash; });
  forged.head.hash = prev;
  res = await checkFile(forged, 'rehashed-forgery');
  ok(res.state === 'broken' && /signature does not match/.test(res.text), 'a fully re-hashed forgery is caught: ' + res.text.slice(0, 90));
  /* R12: an edit to who an entry names (actorName only) is caught */
  const renamed = JSON.parse(JSON.stringify(j)); renamed.entries[0].actorName = 'Rosa Diaz';
  res = await checkFile(renamed, 'actorname-edit');
  ok(res.state === 'broken' && /Chain broken at entry 1/.test(res.text), 'an edited actorName is caught: ' + res.text.slice(0, 90));
  /* R12: a CSV export checks out in the app, and a tampered CSV does not */
  const checkCsv = async (text, name) => {
    const fp = `${SHOTS}/${name}.csv`; fs.writeFileSync(fp, text);
    if (!(await page.isVisible('[data-checkfile]'))) await page.click('.adm-check summary');
    await page.evaluate(() => { const el = document.querySelector('[data-filecheck]'); if (el) el.remove(); });
    await page.setInputFiles('[data-checkfile]', fp);
    await page.waitForSelector('[data-filecheck]', { timeout: 8000 }).catch(() => {});
    return { state: await page.getAttribute('[data-filecheck]', 'data-filecheck').catch(() => null), text: await page.textContent('[data-filecheck]').catch(() => '') };
  };
  res = await checkCsv(csv, 'export');
  ok(res.state === 'ok' && /signed head matches/.test(res.text) && new RegExp(j.keySource).test(res.text), 'the saved CSV checks out in the app: ' + res.text.slice(0, 120));
  ok((await page.textContent('[data-filecheck-key]').catch(() => '')) === jsonKeyNote, 'CSV and JSON checks word the key source the same way');
  await page.screenshot({ path: `${SHOTS}/history-csvcheck-1366.png` });
  res = await checkCsv(csv.replace(/Christmas Eve/, 'Christmas Day'), 'csv-edited');
  ok(res.state === 'broken' && /Chain broken at entry/.test(res.text), 'an edited CSV is caught: ' + res.text.slice(0, 90));
  res = await checkCsv(csv.replace(/# Signed head,[^\r\n]*\r\n$/, ''), 'csv-nohead');
  ok(res.state === 'broken' && /no signed head/.test(res.text), 'a CSV without its head row is caught');
  ok(/signed head/.test(await page.textContent('[data-audit-claim]')) && /not as each change is saved/.test(await page.textContent('[data-audit-claim]')), 'History states what the seal does and does not cover');

  console.log('Security');
  await open('/admin/security');
  ok(await page.$('[data-sec="now"]') && await page.$('[data-sec="business"]') && await page.$('[data-sec="planned"]'), 'on now / Business plan / planned sections');
  ok(await page.$('a[href="/pmoflow/security"]') != null, 'links to /pmoflow/security');
  ok(/not obtained yet/i.test(await page.textContent('[data-sec="planned"]')), 'no certification claimed');
  const now = await page.textContent('[data-sec="now"]');
  ok(now.includes('Someone moved into a department, or made an approver, after its testing or approval started can’t pass its tests or approve it.') &&
    /Naming the first approver of a department that has none takes one Admin/.test(now) && /In a workspace with one Admin, those changes apply at once and History says so/.test(now), 'Security tab states the department rules exactly as scoped');
  ok(/pass only tests assigned to you or to no one/.test(now) && /recorded any test result for it or own steps in it/.test(now) &&
    /launch owner don’t approve/.test(now) && /project manager and a sponsor or approver/.test(now) && /Admins follow every rule/.test(now), 'Security tab states each enforced separation-of-duties rule');
  ok(!/ON NOW/.test(now), 'no blanket "ON NOW" claim');
  await shotBoth('security');

  console.log('Sign in with Microsoft');
  principal = { identityProvider: 'aad', userId: 'u-123', userDetails: 'jordan.lee@northwind.example', userRoles: ['anonymous', 'authenticated'], claims: [{ typ: 'name', val: 'Jordan Lee' }] };
  await page.reload(); await page.waitForSelector('[data-auth="in"]', { timeout: 10000 }).catch(() => {});
  ok(await page.textContent('[data-auth-name]').catch(() => '') === 'Jordan Lee', 'signed in: shows the real name');
  ok(/^\/\.auth\/logout\?post_logout_redirect_uri=/.test(await page.getAttribute('[data-auth="in"] a', 'href') || ''), 'sign out link');
  ok(await page.evaluate(async () => (await import('/concepts/pmoflow/app/store.js')).store.state.ws != null), 'workspace stays the sandbox');
  await page.screenshot({ path: `${SHOTS}/signed-in-1366.png` });
  /* reload: persistence of everything we changed */
  await open('/admin/people');
  ok(await page.$eval('[data-role="ps"]', el => el.value) === 'approver', 'role still persisted');
  await ctx.close();

  console.log('Returning visitor (pmoflow_ws cookie)');
  const ctx3 = await browser.newContext({ viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': IP } });
  const p3 = await ctx3.newPage();
  await p3.goto(ROOT + '/'); await p3.waitForSelector('#app h1', { timeout: 20000 });
  const ws1 = await p3.evaluate(async () => (await import('/concepts/pmoflow/app/store.js')).store.state.ws);
  const ck = (await ctx3.cookies(`http://localhost:${PORT}/api/pmoflow/`)).find(c => c.name === 'pmoflow_ws');
  if (!ck) console.log('  - SKIP cookie checks: the server sent no Set-Cookie (lead: index.js send() must pass route-module headers)');
  else {
    ok(ck.value === ws1 && ck.httpOnly && ck.sameSite === 'Lax' && ck.path === '/api/pmoflow' && ck.expires * 1000 - Date.now() > 29 * 86400000, 'cookie: HttpOnly, SameSite=Lax, /api/pmoflow, 30 days');
    ok(!(await p3.evaluate(() => document.cookie.includes('pmoflow_ws'))), 'cookie is not readable from page scripts');
    await p3.evaluate(() => localStorage.clear());
    await p3.reload(); await p3.waitForSelector('#app h1', { timeout: 20000 });
    ok(await p3.evaluate(async () => (await import('/concepts/pmoflow/app/store.js')).store.state.ws) === ws1, 'localStorage cleared: the cookie brings back the same sandbox');
  }
  await ctx3.close();

  console.log('Local /.auth/me 404');
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-forwarded-for': IP } });
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on('pageerror', e => errs2.push('pageerror: ' + e.message));
  p2.on('console', m => { if (m.type() === 'error' && !/\/\.auth\/me/.test((m.location() || {}).url || '')) errs2.push('console: ' + m.text()); });
  await p2.goto(ROOT + '/admin'); await p2.waitForSelector('[data-auth="out"]', { timeout: 20000 });
  ok(await p2.isVisible('[data-signin]'), '404 from /.auth/me: signed out, button shown, page works');
  await p2.goto(ROOT + '/'); await p2.waitForSelector('#app h1', { timeout: 20000 });
  ok(await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'home still works anonymously at 390');
  ok(!errs2.length, 'no other errors in the anonymous context' + (errs2.length ? ': ' + errs2.join(' | ') : ''));
  await ctx2.close();

  ok(!errors.length, 'zero page/console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
