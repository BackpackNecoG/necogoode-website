/* E2E for stream S4 (Connections: Jira / Azure DevOps two-way sync, Teams / Outlook notifications).
   Usage: node tests/pmoflow/e2e-connect.js [port]   (dev server must be running on that port; default 8844)
   One fixed x-forwarded-for per run; the sandbox id is kept in /tmp/pmo-connect/ws.txt and reset at the start,
   so repeated runs don't hit the 5-sandboxes-per-day limit. */
const { chromium } = require('playwright');
const fs = require('fs');
const PORT = process.argv[2] || process.env.PORT || 8844;
const ORIGIN = `http://localhost:${PORT}`;
const BASE = `${ORIGIN}/concepts/pmoflow`;
const OUT = '/tmp/pmo-connect';
const IP = '198.51.100.144';
const E = require('../../api/shared/pmoflow-engine.js');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const failures = [];
function ok(cond, msg) { if (cond) { pass++; console.log('  ok  ' + msg); } else { fail++; failures.push(msg); console.log('  FAIL ' + msg); } }
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

async function api(method, path, body) {
  const r = await fetch(`${ORIGIN}/api/pmoflow/${path}${method === 'GET' ? (path.includes('?') ? '&' : '?') + 'today=' + today() : ''}`, { method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': IP }, body: method === 'GET' ? undefined : JSON.stringify(Object.assign({ today: today() }, body || {})) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  /* reuse this run's sandbox if it still exists, reset to the seed */
  let ws = null;
  try { ws = fs.readFileSync(OUT + '/ws.txt', 'utf8').trim(); } catch (e) { ws = null; }
  if (ws) { const r = await api('POST', `ws/${ws}/reset`, {}); if (r.status !== 200) ws = null; }
  if (!ws) { const r = await api('POST', 'workspaces', {}); if (r.status !== 201) { console.log('cannot create a sandbox:', r.status, r.body); process.exit(1); } ws = r.body.id; fs.writeFileSync(OUT + '/ws.txt', ws); }
  console.log('sandbox', ws.slice(0, 6) + '…');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': IP } });
  await ctx.addInitScript(id => { try { if (!sessionStorage.getItem('cx-init')) { localStorage.setItem('pmoflow.ws', id); localStorage.setItem('pmoflow.me', 'mc'); sessionStorage.setItem('cx-init', '1'); } } catch (e) { /* ignore */ } }, ws);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const shot = async name => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const truth = async () => { const s = await api('GET', `ws/${ws}/state`); return { docs: s.body.docs, t: E.projectTruth(s.body.docs, 'vendor-modernization', today()) }; };

  console.log('1. empty state');
  await page.goto(`${BASE}/connections`);
  await page.waitForSelector('[data-cx-empty]', { timeout: 15000 });
  ok(await page.isVisible('[data-cx-empty]'), 'empty state explains what connecting does');
  ok((await page.textContent('[data-cx-standalone]')).includes('You don’t need to connect anything. PMOFlow runs the whole project on its own.'), 'empty state says connecting is optional');
  ok(!/overlay|on top of|requires|replace|add-on/i.test(await page.textContent('.cx')), 'no "overlay / on top of / requires / replace" wording');
  ok(await overflow(), 'no horizontal overflow at 1366 (empty)');
  await shot('01-empty-1366');

  console.log('2. wizard: 3 steps with defaults');
  await page.click('[data-cx-empty] [data-cx-start]');
  await page.waitForSelector('[data-cx-wizard]');
  ok((await page.locator('.cx-steps li').count()) === 3, 'wizard shows 3 steps');
  ok(await page.locator('[data-cx-tool="jira"].on').count() === 1, 'Jira is chosen by default');
  ok((await page.inputValue('[data-cx="projectId"]')) === 'vendor-modernization', 'first project the persona works on is preselected');
  await shot('02-wizard-step1');
  await page.click('[data-cx-next]');
  await page.waitForSelector('#cx-site');
  ok((await page.inputValue('#cx-site')) === 'northwind.atlassian.net' && (await page.inputValue('#cx-key')) === 'VOM', 'site and project key have sensible defaults');
  await page.fill('#cx-site', 'not a site');
  await page.click('[data-cx-next]');
  await page.waitForSelector('[data-cx-err]:not([hidden])');
  ok(/atlassian\.net/.test(await page.textContent('[data-cx-err]')), 'a bad site gets a plain-language error');
  await page.fill('#cx-site', 'northwind.atlassian.net');
  await page.click('[data-cx-next]');
  await page.waitForSelector('[data-cx-map]');
  ok((await page.locator('[data-cx-map] tbody tr').count()) === 6, 'field mapping preview lists 6 fields');
  ok(/PMOFlow decides/.test(await page.textContent('[data-cx-map]')), 'due dates and dependencies are shown as owned by PMOFlow');
  ok(!(await page.getAttribute('[data-cx-adv]', 'open')), 'advanced field mapping starts collapsed');
  await page.click('[data-cx-adv] summary');
  ok(await page.isDisabled('#cx-dir-due'), 'due date direction is locked');
  await page.click('[data-cx-adv] summary');
  await page.check('[data-cx-n="outlook"]');
  await page.fill('[data-cx-to]', 'tom.alvarez@northwind.example');
  await page.fill('[data-cx-ch]', 'Vendor team');
  ok((await page.textContent('[data-cx-secret]')) === 'teams-webhook-vendor-team', 'the Teams address is shown as a Key Vault secret name');
  await shot('03-wizard-step3');
  await page.click('[data-cx-next]');
  await page.waitForSelector('[data-cx-conn] [data-cx-result]', { timeout: 20000 });
  const first = await page.textContent('[data-cx-result]');
  ok(/13 issues created in Jira/.test(first), 'connecting runs the first sync: ' + first.slice(0, 90));
  /* R11 §4: the counts in the sentence equal the rows in the sync log */
  const logRows = await page.$$eval('[data-cx-log] .cx-le', els => els.map(e => e.textContent));
  const nCreated = Number((/(\d+) issues? created/.exec(first) || [])[1] || 0), nLinked = Number((/(\d+) dependency links? set/.exec(first) || [])[1] || 0);
  ok(nCreated === logRows.filter(t => /PMOFlow → Jira/.test(t) && /Create VOM-/.test(t)).length && nLinked === logRows.filter(t => /PMOFlow → Jira/.test(t) && /Link VOM-/.test(t)).length,
    `sentence counts equal the log (${nCreated} created, ${nLinked} links)`);
  ok((await page.locator('[data-cx-sim] [data-cx-item]').count()) === 13, 'all 13 project tasks appear in Simulated Jira');
  ok(/Simulated Jira \(demo\)/.test(await page.textContent('[data-cx-conn]')), 'clearly labelled "Simulated Jira (demo)"');
  const k7 = await page.locator('[data-cx-item]', { hasText: 'Check bank accounts with a small test deposit' }).getAttribute('data-cx-item');
  ok(/after VOM-\d+/.test(await page.locator(`[data-cx-item="${k7}"]`).textContent()), 'dependencies were linked in Jira');
  await shot('04-connected-1366');

  console.log('3. a status change in Jira flows back and the engine recomputes');
  const before = await truth();
  const row = page.locator('[data-cx-item]', { hasText: 'Set up the bank details form' });
  const key = await row.getAttribute('data-cx-item');
  ok(/Not started/.test(await row.textContent()), `${key} starts as Not started in PMOFlow`);
  await page.selectOption(`[data-cx-simstatus="${key}"]`, 'Done');
  await page.waitForFunction(k => /Done/.test((document.querySelector(`[data-cx-item="${k}"] [data-cx-pmo]`) || {}).textContent || ''), key, { timeout: 20000 });
  ok(true, 'PMOFlow shows the task Done after the change in Jira');
  const after = await truth();
  const w6 = after.docs.workItem.find(d => d.id === 'W6').data;
  ok(w6.status === 'done' && w6.doneAt === today(), 'saved through the document store: W6 done, doneAt = today');
  ok(after.t.tasks.done === before.t.tasks.done + 1, `engine recomputes on read: ${before.t.tasks.done} → ${after.t.tasks.done} tasks done`);
  const res = await page.textContent('[data-cx-result]');
  ok(new RegExp(`${before.t.tasks.done} → ${after.t.tasks.done} of`).test(res) && res.includes(after.t.label), 'result shows the project status change from the engine: ' + res.slice(0, 120));
  ok((await page.textContent('[data-cx-truth]')).trim() === after.t.label, 'header badge equals projectTruth label');
  /* R11 §4: exactly one issue changed in Jira, and the log says so */
  ok(/^1 changed issue since the last sync\.$/.test(await page.locator('[data-cx-log] .cx-le', { hasText: 'Read changes' }).first().locator('.cx-lx').textContent()), 'pull reads exactly "1 changed issue since the last sync"');
  /* R11 §9: Done in Jira while the work it depends on is open: accepted, flagged in the log and on the task */
  const w6deps = (w6.deps || []).map(id => after.docs.workItem.find(d => d.id === id)).filter(d => d && d.data.status !== 'done');
  if (w6deps.length) {
    ok(/finished before the work it depends on \(flagged\)/.test(res), 'result sentence reports the flag');
    ok(/Finished before the work it depends on/.test(await page.textContent('[data-cx-log]')), 'sync log row: "Finished before the work it depends on"');
    ok(/Finished before the work it depends on/.test(await page.locator(`[data-cx-early="W6"]`).textContent().catch(() => '')), 'flag shown on the task in the list');
  } else ok(!(await page.$('[data-cx-early="W6"]')), 'no flag when its predecessors are done');
  await shot('05-flowed-back');
  /* R11 §9 (Jordan's VOM-10 case): a task whose predecessors are still open is marked Done in Jira */
  const waiting = after.docs.workItem.find(d => d.data.projectId === 'vendor-modernization' && d.data.status !== 'done' &&
    (d.data.deps || []).some(id => { const p = after.docs.workItem.find(x => x.id === id); return p && p.data.status !== 'done'; }));
  if (!waiting) ok(false, 'the seed has a task waiting on open work');
  else {
    const wkey = await page.locator('[data-cx-item]', { hasText: waiting.data.title }).first().getAttribute('data-cx-item');
    await page.selectOption(`[data-cx-simstatus="${wkey}"]`, 'Done');
    await page.waitForSelector(`[data-cx-early="${waiting.id}"]`, { timeout: 20000 }).catch(() => {});
    ok(/Finished before the work it depends on \(.+ still open\)/.test(await page.textContent(`[data-cx-early="${waiting.id}"]`).catch(() => '')), `${wkey} Done with open predecessors: flagged on the task`);
    ok(/finished before the work it depends on \(flagged\)/.test(await page.textContent('[data-cx-result]')), 'the result sentence reports the flag');
    ok(await page.locator('[data-cx-log] .cx-le', { hasText: 'Check order' }).count() >= 1, 'sync log row "Check order · Finished early"');
    const st2 = await api('GET', `ws/${ws}/state`);
    ok(st2.body.docs.workItem.find(d => d.id === waiting.id).data.status === 'done', 'the Done is accepted, not refused');
    await shot('05b-finished-early');
  }

  console.log('4. sync log, signed intents, replay protection');
  ok((await page.locator('[data-cx-log] .cx-le').count()) >= 10, 'sync log lists intents and results');
  const tech = page.locator('[data-cx-log] details[data-cx-tech]').first();
  await tech.locator('summary').click();
  const techText = await tech.textContent();
  ok(/"sig":\s*"[0-9a-f]{64}"/.test(techText) && /"nonce"/.test(techText) && /"exp"/.test(techText), 'each entry shows the signed intent (sig, nonce, expiry)');
  ok(/https:\/\/northwind\.atlassian\.net\/rest\/api\/3\//.test(await page.textContent('[data-cx-log]')), 'log shows the Jira REST calls the relay makes');
  await page.click('.cx-cols .cx-adv summary');
  await page.click('[data-cx-replay]');
  await page.waitForFunction(() => /replay refused/.test((document.querySelector('[data-cx-result]') || {}).textContent || ''), null, { timeout: 15000 });
  ok(/Signature doesn’t match/.test(await page.textContent('[data-cx-result]')), 'replayed and tampered intents are both refused');

  console.log('5. notifications');
  await page.click('[data-cx-notify="late"]');
  await page.waitForSelector('[data-cx-teams] .cx-card');
  ok(/late/i.test(await page.textContent('[data-cx-teams]')), 'Teams card preview renders');
  ok(/tom\.alvarez@northwind\.example/.test(await page.textContent('[data-cx-mail]')), 'email preview shows the recipient');
  ok(/simulated/i.test(await page.textContent('[data-cx-delivery]')), 'preview says nothing was sent');
  await page.click('[data-cx-notify="approval"]');
  await page.waitForFunction(() => /approval/i.test((document.querySelector('[data-cx-teams]') || {}).textContent || ''));
  ok(true, 'approval-needed preview renders');
  await shot('06-notifications');

  console.log('6. settings edit persists');
  await page.click('[data-cx-edit]');
  await page.waitForSelector('.modal [data-cx-form]');
  await page.click('.modal [data-cx-adv] summary');
  await page.selectOption('.modal #cx-dir-title', 'out');
  await page.click('.modal [data-act="save"]');
  await page.waitForFunction(() => !document.querySelector('.modal'));
  await page.waitForTimeout(500);
  let st = await api('GET', `ws/${ws}/state`);
  const conn = (st.body.docs.connection || [])[0].data;
  ok(conn.fields.title.dir === 'out', 'title direction saved as PMOFlow → Jira only');
  ok(!JSON.stringify(conn).match(/token|password|webhook\.office/i), 'no token, password or webhook address is stored in PMOFlow');

  console.log('7. permissions by persona');
  await page.selectOption('#persona', 'do');
  await page.waitForSelector('[data-cx-perm]');
  ok(await page.isDisabled('[data-cx-sync]'), 'someone outside the project team cannot sync');
  ok(/project team/.test(await page.textContent('[data-cx-perm]')), 'and is told who can');
  await page.selectOption('#persona', 'mc');
  await page.waitForFunction(() => !document.querySelector('[data-cx-sync]').disabled);

  console.log('8. second connection: Azure DevOps (as Dev Kumar, who is on that project team)');
  await page.selectOption('#persona', 'dk');
  await page.waitForTimeout(300);
  await page.click('.hdr [data-cx-start]');
  await page.waitForSelector('[data-cx-wizard]');
  ok((await page.inputValue('[data-cx="projectId"]')) !== 'vendor-modernization', 'wizard preselects a project that is not connected yet');
  await page.selectOption('[data-cx="projectId"]', 'access-review-automation');
  await page.click('[data-cx-tool="ado"]');
  await page.waitForSelector('[data-cx-tool="ado"].on');
  await page.click('[data-cx-next]');
  ok((await page.inputValue('#cx-site')) === 'northwind', 'Azure DevOps organization default');
  await page.click('[data-cx-next]');
  await page.waitForSelector('[data-cx-map]');
  ok(/System\.Title/.test(await page.textContent('[data-cx-map]')), 'ADO field names in the preview');
  await page.click('[data-cx-next]');
  await page.waitForSelector('.cx-pick', { timeout: 20000 });
  ok(/Simulated Azure DevOps \(demo\)/.test(await page.textContent('[data-cx-conn]')), 'connected to Simulated Azure DevOps');
  const adoKeys = await page.locator('[data-cx-item]').evaluateAll(els => els.map(e => e.dataset.cxItem));
  ok(adoKeys.length > 0 && adoKeys.every(k => /^\d+$/.test(k)), 'ADO work item ids are numeric');
  await page.selectOption(`[data-cx-simstatus="${adoKeys[adoKeys.length - 1]}"]`, 'Closed');
  await page.waitForFunction(k => /Done/.test((document.querySelector(`[data-cx-item="${k}"] [data-cx-pmo]`) || {}).textContent || ''), adoKeys[adoKeys.length - 1], { timeout: 20000 });
  ok(true, 'Closed in Azure DevOps → Done in PMOFlow');

  console.log('9. reload persists; history shows the changes');
  await page.reload();
  await page.waitForSelector('[data-cx-conn]');
  ok((await page.locator('.cx-pick button').count()) === 2, 'both connections survive a reload');
  await page.click('.cx-pick button >> nth=0');
  await page.waitForSelector('[data-history] .ev', { timeout: 15000 });
  const hist = await page.textContent('[data-history]');
  ok(/Connected project "Vendor Onboarding Modernization"/.test(hist), 'history: connected');
  ok(/Synced|First sync/.test(hist), 'history: sync');
  ok(/In Simulated Jira \(demo\): VOM-\d+ status To Do → Done/.test(hist), 'history: the change made in Jira');
  const wiEv = await api('GET', `ws/${ws}/events?ref=workItem:W6`);
  ok(wiEv.body.events.some(e => /From Jira VOM-\d+: work item "Set up the bank details form" status Not started → Done/.test(e.summary)), 'work item history records the inbound change');
  ok(await overflow(), 'no horizontal overflow at 1366 (connected)');
  await shot('07-reloaded-1366');

  console.log('10. phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  ok(await overflow(), 'no horizontal overflow at 390 (connected)');
  await shot('08-connected-390');
  await page.click('.hdr [data-cx-start]');
  await page.waitForSelector('[data-cx-wizard]');
  ok(await overflow(), 'no horizontal overflow at 390 (wizard step 1)');
  await shot('09-wizard-390');
  await page.click('[data-cx-cancel]');
  await page.setViewportSize({ width: 1366, height: 900 });

  console.log('11. disconnect (as the project manager)');
  await page.selectOption('#persona', 'ta');
  await page.waitForTimeout(300);
  for (let i = 0; i < 2; i++) {
    await page.click('[data-cx-conn] [data-cx-disconnect]');
    const del = page.waitForResponse(r => r.request().method() === 'DELETE' && /\/connections\//.test(r.url()));
    await page.click('.modal [data-act="go"]');
    ok((await del).status() === 200, `disconnect ${i + 1} accepted for the project manager`);
    await page.waitForTimeout(800);
  }
  await page.waitForSelector('[data-cx-empty]', { timeout: 15000 });
  ok(true, 'both connections disconnected; empty state is back');
  st = await api('GET', `ws/${ws}/state`);
  ok((st.body.docs.connection || []).length === 0, 'disconnect persisted');
  ok(st.body.docs.workItem.find(d => d.id === 'W6').data.status === 'done', 'PMOFlow tasks stay as they are after disconnecting');
  const evs = await api('GET', `ws/${ws}/events?limit=200`);
  ok(evs.body.events.some(e => /Disconnected project "Vendor Onboarding Modernization"/.test(e.summary)), 'history: disconnected');

  ok(errors.length === 0, 'zero console errors / page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('Failures:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
