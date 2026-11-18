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
  await page.selectOption('[data-role="ps"]', 'approver');
  ok(await toastSays(/Priya Shah is now Approver/), 'role change confirmed');
  await settle(900);
  ok(Number(await page.textContent('[data-seat-free]')) === free0 + 1 && Number(await page.textContent('[data-seat-paid]')) === paid0 - 1, 'approver moves to a free seat');
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
  /* a non-admin sees why they can't change roles */
  await setMe('lp'); await settle(900);
  ok(await page.isVisible('[data-admin-only]') && await page.$eval('[data-role="ar"]', el => el.disabled), 'Editor: role pickers disabled with an explanation');
  ok(/ask (Maya Chen|Tom Alvarez)/.test(await page.textContent('[data-admin-only]')), 'explanation names the Admins');
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
  await open('/admin/history');
  await page.waitForSelector('[data-verify]');
  ok(await page.getAttribute('[data-verify]', 'data-verify') === 'ok', 'chain verified');
  const log = await page.textContent('.adm-log');
  ok(/Changed Priya Shah's role from Editor to Approver/.test(log) && /Added Christmas Eve/.test(log) && /Invited jordan/.test(log), 'history lists the admin changes');
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
