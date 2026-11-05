/* R8 consistency e2e (stream P): ONE TRUTH.
   For every seeded project, read the expected finish, late count, blockers count, status label, and planned / actual /
   forecast cost from the project header, the home card, the projects list, the portfolio row, the status report view
   and the portfolio CSV export, and assert they are all equal (and equal to E().projectTruth).
   Runs at 18:30 local time with the browser in America/Chicago (Playwright timezoneId + page.clock) while the server
   runs in UTC (start it with TZ=UTC), so a UTC date would already be tomorrow: proves there are no off-by-one dates.
   Usage: TZ=UTC dev server on <port>, then node tests/pmoflow/e2e-consistency.js [port] */
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
const norm = x => x && ({ label: normLabel(x.label), forecast: normDate(x.forecast), late: normInt(x.late), blockers: normInt(x.blockers), planned: normMoney(x.planned), actual: normMoney(x.actual), cost: normMoney(x.cost) });

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

(async () => {
  const { ymd, at } = chicagoNow1830();
  const utcYmd = at.toISOString().slice(0, 10);
  console.log(`browser clock: ${at.toISOString()} (= 18:30 ${TZ} on ${ymd}; UTC date ${utcYmd})`);
  const browser = await chromium.launch();
  const ip = `198.51.100.${(Math.random() * 200 | 0) + 20}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: TZ, acceptDownloads: true, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  /* Advanced shows every cost on every surface; the values themselves are the same in Simple. */
  await ctx.addInitScript(() => { try { localStorage.setItem('pmoflow.advanced', '1'); } catch (e) { /* ignore */ } });
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

  /* engine truth, read once */
  const truth = await page.evaluate(async u => {
    const { store } = await import(u);
    return store.list('project').map(p => { const t = window.PMOEngine.projectTruth(store.state.docs, p.id, store.state.today);
      return { id: p.id, name: p.name, live: p.status === 'live', t: { label: t.label, forecast: t.forecastFinish, late: t.lateCount, blockers: t.blockers.length, planned: t.cost.planned, actual: t.cost.actual, cost: t.cost.forecast, total: t.tasks.total } }; });
  }, STORE);
  check('seed has projects', truth.length >= 3, truth.length);

  /* read one surface: the label element plus the data-t facts inside a container */
  const readIn = (sel, labelSel) => page.evaluate(([s, ls]) => {
    const box = document.querySelector(s); if (!box) return null;
    const g = k => { const el = box.querySelector(`[data-t="${k}"]`); return el ? el.textContent : null; };
    const lab = box.querySelector(ls || '[data-summary-label]');
    return { label: lab ? lab.textContent : null, forecast: g('forecast'), late: g('late'), blockers: g('blockers'), planned: g('planned'), actual: g('actual'), cost: g('cost') };
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
  for (const n of ['Project', 'Status', 'Expected finish', 'Late', 'Blocking', 'Planned budget', 'Actual cost', 'Forecast cost']) check(`CSV has column "${n}"`, col(n) >= 0, H);
  for (const x of truth) {
    const r = csv.find(row => row[col('Project')] === x.name);
    seen[x.id].csv = r ? norm({ label: r[col('Status')], forecast: r[col('Expected finish')], late: r[col('Late')], blockers: r[col('Blocking')], planned: r[col('Planned budget')], actual: r[col('Actual cost')], cost: r[col('Forecast cost')] }) : null;
  }
  await page.screenshot({ path: `${SHOTS}/03-portfolio.png`, fullPage: false });

  /* project header + status report view */
  for (const x of truth) {
    await page.goto(ROOT + '/project/' + x.id); await page.waitForSelector('.hdr h1');
    seen[x.id].header = norm(await readIn('.hdr'));
    await page.click('[data-report]');
    await page.waitForSelector('[data-rep-facts]', { timeout: 20000 });
    seen[x.id].report = norm(await readIn('[data-prj-rep]', '.rag'));
    /* the written report (server) is dated with the visitor's today, so its words agree with the facts strip */
    const words = await page.innerText('[data-prj-rep] .pmo-rep-p').catch(() => '');
    const shownF = await page.innerText('[data-prj-rep] [data-t="forecast"]').catch(() => '');
    if (/^[A-Z][a-z]{2} \d/.test(shownF) && /Expected [A-Z][a-z]{2} \d/.test(words)) check(`${x.name}: written report says the same expected date`, words.includes('Expected ' + shownF.trim()), { words: words.slice(0, 120), shownF });
    await page.screenshot({ path: `${SHOTS}/04-project-${x.id}.png`, fullPage: false });
  }

  /* compare */
  const FIELDS = ['label', 'forecast', 'late', 'blockers', 'planned', 'actual', 'cost'];
  for (const x of truth) {
    const s = seen[x.id];
    for (const surf of ['home', 'list', 'portfolio', 'header', 'report', 'csv']) {
      check(`${x.name}: ${surf} was read`, !!s[surf], s[surf]);
      if (!s[surf]) continue;
      for (const f of FIELDS) {
        if (x.live && f === 'forecast' && surf === 'csv' && s.csv.forecast === 'none') continue;
        check(`${x.name}: ${surf} ${f} = projectTruth`, s[surf][f] === s.engine[f], { [surf]: s[surf][f], engine: s.engine[f] });
      }
    }
  }

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

  check('no console errors', errors.length === 0, errors);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
