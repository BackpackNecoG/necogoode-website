/* E2E for R10 stream S3 (buyer and trust layer: web/public/pmoflow/** + api/shared/pmoflow-routes-buyer.js).
   Usage:  node tests/pmoflow/e2e-buyer.js [port]           (dev server must be running on that port)
           node tests/pmoflow/e2e-buyer.js [port] --shots   (re-capture the product screenshots from the live demo, then exit)

   The local dev server has no clean-URL mapping, so the browser mirrors the production staticwebapp.config.json
   rewrites with page.route (REWRITES below = exactly what the lead adds), and serves the recommended CSP header,
   so a CSP violation shows up as a console error.
   Writes at most one lead row to real storage, marked test:true with company "Northwind Test".
   Screenshots go to /tmp/pmo-buyer/. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || 8843);
const ORIGIN = `http://localhost:${PORT}`;
const SHOTS = '/tmp/pmo-buyer';
const PUBLIC = path.join(__dirname, '../../web/public');
const IMG = path.join(PUBLIC, 'pmoflow/img');
const TEST_IP = process.env.PMO_TEST_IP || '198.51.100.43';   /* one fixed IP per run: the demo sandbox and the lead rate limit are keyed on it */
fs.mkdirSync(SHOTS, { recursive: true });

/* the production mapping (must match the staticwebapp.config.json routes the lead adds) */
const REWRITES = { '/pmoflow/pricing': '/pmoflow/pricing.html', '/pmoflow/security': '/pmoflow/security.html',
  '/pmoflow/demo': '/pmoflow/demo.html', '/pmoflow/compare': '/pmoflow/compare.html', '/pmoflow/': '/pmoflow/index.html' };
const REDIRECTS = { '/pmoflow': '/pmoflow/' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; " +
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const mapPath = p => REWRITES[p] || p;

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- screenshots of the live demo (--shots) ---------------- */
async function captureShots(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, extraHTTPHeaders: { 'x-forwarded-for': TEST_IP } });
  const page = await ctx.newPage();
  const go = async p => { await page.goto(ORIGIN + '/concepts/pmoflow' + p); await page.waitForLoadState('networkidle').catch(() => {}); await sleep(1500); };
  await go('/process/vendor-onboarding');
  await page.screenshot({ path: path.join(IMG, 'information.png'), clip: { x: 256, y: 280, width: 1014, height: 520 } });
  await page.getByText('What changed', { exact: true }).first().click(); await sleep(1200);
  await page.screenshot({ path: path.join(IMG, 'what-changed.png'), clip: { x: 0, y: 0, width: 1280, height: 800 } });
  await go('/project/vendor-modernization');
  await page.screenshot({ path: path.join(IMG, 'plan.png'), fullPage: true, clip: { x: 0, y: 790, width: 1280, height: 930 } });
  await go('/release/vendor-modernization');
  await page.screenshot({ path: path.join(IMG, 'launch.png'), clip: { x: 200, y: 186, width: 880, height: 614 } });
  await ctx.close();
  console.log('screenshots written to ' + IMG + ' (view each one before publishing)');
}

/* ---------------- API module checks (in-process, in-memory backend) ---------------- */
async function moduleChecks() {
  console.log('route module (in-memory)');
  const saved = process.env.EMCEE_STORAGE_CONNECTION; delete process.env.EMCEE_STORAGE_CONNECTION;
  const modPath = require.resolve('../../api/shared/pmoflow-routes-buyer.js');
  delete require.cache[modPath];
  const mod = require(modPath);
  let res;
  const ctx = (method, seg, body, extra) => Object.assign({ method, seg, body, req: { headers: {}, query: (extra && extra.query) || {}, url: '' },
    send: (s, b) => { res = { status: s, body: b }; }, fail: (s, e) => { res = { status: s, body: { error: e } }; },
    clientIpHash: () => (extra && extra.ip) || 'iphash-a' });
  const good = { name: 'Ada Test', email: 'ada@northwind.example', company: 'Northwind Test', role: 'PMO lead', teamSize: '51-200',
    tools: ['Jira', 'Visio'], fix: 'Vendor onboarding takes three weeks.', preferredWindow: 'morning', test: true };

  check('module: ignores other routes', (await mod.handle(ctx('GET', ['ws', 'x', 'state']))) === false);
  await mod.handle(ctx('GET', ['buyer', 'demo-request'])); check('module: demo-request GET is 405', res.status === 405);
  await mod.handle(ctx('POST', ['buyer', 'demo-request'], {}));
  check('module: empty body rejected with field errors', res.status === 400 && ['name', 'email', 'company', 'role', 'teamSize', 'fix'].every(k => res.body.fields[k]), res.body);
  await mod.handle(ctx('POST', ['buyer', 'demo-request'], Object.assign({}, good, { email: 'not-an-email' })));
  check('module: bad email rejected', res.status === 400 && !!res.body.fields.email);
  await mod.handle(ctx('POST', ['buyer', 'demo-request'], Object.assign({}, good, { tools: ['Jira', 'Excel<script>'] })));
  check('module: unknown tool rejected', res.status === 400 && !!res.body.fields.tools);
  await mod.handle(ctx('POST', ['buyer', 'demo-request'], Object.assign({}, good, { preferredDate: '2001-01-01' })));
  check('module: past preferred date rejected', res.status === 400 && !!res.body.fields.preferredDate);
  const before = mod._mem.size;
  await mod.handle(ctx('POST', ['buyer', 'demo-request'], Object.assign({}, good, { website: 'http://spam.example' })));
  check('module: honeypot answers 201 and stores nothing', res.status === 201 && mod._mem.size === before);

  for (let i = 0; i < mod.PER_DAY; i++) await mod.handle(ctx('POST', ['buyer', 'demo-request'], good, { ip: 'iphash-rl' }));
  check('module: 10 requests per IP hash per day accepted', res.status === 201 && /^\d{13}-[0-9a-f]{6}$/.test(res.body.id), res);
  await mod.handle(ctx('POST', ['buyer', 'demo-request'], good, { ip: 'iphash-rl' }));
  check('module: 11th request from the same IP hash is 429', res.status === 429);
  await sleep(5); /* leads written in the same millisecond have no defined order */
  await mod.handle(ctx('POST', ['buyer', 'demo-request'], Object.assign({}, good, { test: false, company: 'Northwind Real' }), { ip: 'iphash-b' }));
  check('module: another IP hash is not limited', res.status === 201);
  const entities = [...mod._mem.values()];
  check('module: every stored entity carries app:pmoflow', entities.length > 0 && entities.every(e => e.app === 'pmoflow'));
  check('module: leads stored in pmoflowleads, limits in pmoflowlimits',
    [...mod._mem.keys()].every(k => k.startsWith('pmoflowleads\u0000lead\u0000') || k.startsWith('pmoflowlimits\u0000lead-')));

  delete process.env.PMOFLOW_ADMIN_KEY;
  await mod.handle(ctx('GET', ['buyer', 'leads'], undefined, { query: { key: 'x' } }));
  check('module: leads endpoint is 404 without PMOFLOW_ADMIN_KEY', res.status === 404);
  process.env.PMOFLOW_ADMIN_KEY = 'k-' + Math.random().toString(36).slice(2);
  await mod.handle(ctx('GET', ['buyer', 'leads'], undefined, { query: { key: 'wrong' } }));
  check('module: wrong key is 403', res.status === 403);
  await mod.handle(ctx('GET', ['buyer', 'leads'], undefined, { query: { key: process.env.PMOFLOW_ADMIN_KEY } }));
  check('module: leads list hides test leads by default', res.status === 200 && res.body.count === 1 && res.body.leads[0].company === 'Northwind Real', res.body.count);
  await mod.handle(ctx('GET', ['buyer', 'leads'], undefined, { query: { key: process.env.PMOFLOW_ADMIN_KEY, test: '1' } }));
  check('module: test=1 includes test leads, newest first', res.status === 200 && res.body.count === 11 && res.body.leads[0].company === 'Northwind Real');
  delete process.env.PMOFLOW_ADMIN_KEY;
  if (saved !== undefined) process.env.EMCEE_STORAGE_CONNECTION = saved;
  delete require.cache[modPath];
}

function configChecks() {
  console.log('pricing.json and config');
  const p = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'pmoflow/pricing.json'), 'utf8'));
  const plan = id => p.plans.find(x => x.id === id);
  check('pricing.json: Team $45, up to 25 editors', plan('team').perEditorMonthly === 45 && plan('team').maxEditors === 25);
  check('pricing.json: Business $65', plan('business').perEditorMonthly === 65);
  check('pricing.json: Enterprise custom', plan('enterprise').custom === true);
  check('pricing.json: pilot $2,500 for 90 days on one process, credited', p.pilot.price === 2500 && p.pilot.days === 90 && /credited/.test(p.pilot.note));
  check('pricing.json: approvers free', /free/i.test(p.freeSeats.priceLabel) && /approver/i.test(p.freeSeats.name));
  /* no hard-coded price anywhere in the pages: every number comes from pricing.json at runtime */
  const pages = ['index', 'pricing', 'security', 'demo', 'compare'].map(n => [n, fs.readFileSync(path.join(PUBLIC, 'pmoflow', n + '.html'), 'utf8')]);
  const hard = pages.filter(([, h]) => /\$\s?\d/.test(h)).map(([n]) => n);
  check('pages: no hard-coded dollar amounts', hard.length === 0, hard);
  check('pages: no inline style attributes (strict CSP)', pages.every(([, h]) => !/\sstyle=/.test(h)));
  /* informational: is the lead's staticwebapp.config.json change in yet? (not a failure) */
  const cfg = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'staticwebapp.config.json'), 'utf8'));
  const routes = cfg.routes || [];
  const missing = Object.keys(REWRITES).filter(k => k !== '/pmoflow/' && !routes.some(r => r.route === k && r.rewrite === REWRITES[k]));
  const excl = (cfg.navigationFallback && cfg.navigationFallback.exclude) || [];
  const redirectOk = routes.some(r => r.route === '/pmoflow' && r.redirect === '/pmoflow/');
  if (!redirectOk) missing.push('/pmoflow redirect');
  console.log(missing.length || !excl.includes('/pmoflow/*') ? '  note staticwebapp.config.json: lead changes pending (' + (missing.join(', ') || 'fallback exclude') + ')' : '  note staticwebapp.config.json: lead changes present');
}

/* ---------------- browser checks ---------------- */
async function browserChecks(browser) {
  const pricing = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'pmoflow/pricing.json'), 'utf8'));
  const money = n => '$' + n.toLocaleString('en-US');
  const ctxOpts = (w, h) => ({ viewport: { width: w, height: h }, extraHTTPHeaders: { 'x-forwarded-for': TEST_IP }, acceptDownloads: true });
  const errors = [];
  async function newPage(ctx) {
    await ctx.route(/\/pmoflow(\/.*)?$/, async route => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/concepts/')) return route.continue();
      if (REDIRECTS[u.pathname]) return route.fulfill({ status: 301, headers: { location: REDIRECTS[u.pathname] + u.search } });
      const resp = await route.fetch({ url: ORIGIN + mapPath(u.pathname) + u.search });
      const headers = Object.assign({}, resp.headers(), { 'content-security-policy': CSP });
      return route.fulfill({ response: resp, headers });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(page.url() + ' pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(page.url() + ' console: ' + m.text()); });
    return page;
  }
  const scrollAll = async page => { await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } scrollTo(0, 0); }); await sleep(300); };
  const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const brokenImages = page => page.evaluate(async () => {
    const imgs = [...document.images];
    for (const i of imgs) { i.loading = 'eager'; if (!i.complete) await new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 5000); }); }
    return imgs.filter(i => !i.naturalWidth).map(i => i.src);
  });
  const meta = page => page.evaluate(() => {
    const m = n => (document.querySelector(`meta[name="${n}"], meta[property="${n}"]`) || {}).content || '';
    return { title: document.title, desc: m('description'), robots: m('robots'), ogTitle: m('og:title'), ogImage: m('og:image'), ogUrl: m('og:url'),
      canonical: (document.querySelector('link[rel=canonical]') || {}).href || '', h1: document.querySelectorAll('h1').length,
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent) };
  });
  const unlabelled = page => page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
    .filter(el => !el.closest('.hp') && !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.getAttribute('aria-label') && !el.closest('label')).map(el => el.name || el.id));

  const PAGES = [['index', '/pmoflow/'], ['pricing', '/pmoflow/pricing'], ['security', '/pmoflow/security'], ['compare', '/pmoflow/compare'], ['demo', '/pmoflow/demo']];
  const desk = await browser.newContext(ctxOpts(1280, 900));
  const page = await newPage(desk);
  const internalLinks = new Set();

  for (const [name, url] of PAGES) {
    console.log(name + ' (1280)');
    const r = await page.goto(ORIGIN + url);
    await page.waitForLoadState('networkidle').catch(() => {});
    check(`${name}: 200 at clean URL ${url}`, r && r.status() === 200, r && r.status());
    const m = await meta(page);
    check(`${name}: title, description, one h1`, m.title.length > 10 && m.desc.length > 50 && m.h1 === 1, m);
    check(`${name}: indexable with canonical + OpenGraph`, /index/.test(m.robots) && !/noindex/.test(m.robots) && m.canonical === 'https://www.necogoode.com' + url && m.ogTitle && m.ogUrl === m.canonical && /^https:\/\/www\.necogoode\.com\/pmoflow\/img\/.+\.png$/.test(m.ogImage), m);
    check(`${name}: images load`, (await brokenImages(page)).length === 0);
    check(`${name}: Book a demo reachable`, await page.locator('a[href="/pmoflow/demo"]').count() >= 1);
    check(`${name}: no "draft" or "concept" wording`, !/\bdraft\b|\bconcept\b/i.test(await page.innerText('body')));
    /* founder positioning ruling (Nov 17): complete platform, integrations optional; never these words */
    const all = (await page.content()).replace(/<script[\s\S]*?<\/script>/g, '') + ' ' + (await page.textContent('body'));
    const banned = all.match(/overlay|on top of|add-on|\brequires?\b(?![^<]*>)|\breplac\w*|rip(ping)? out/gi);
    check(`${name}: no banned positioning words`, !banned, banned);
    /* R14: nothing on any page may read as an obtained certification or a completed test; the only dates are targets */
    const txt = (await page.textContent('body')).replace(/\s+/g, ' ');
    const claimed = txt.match(/\b(SOC ?2|ISO ?27001|penetration test|pen test|Microsoft 365 Certification)\b[^.]{0,60}\b(obtained|achieved|completed|passed|certified|attested|audited)\b/gi);
    check(`${name}: no certification or test claimed as obtained`, !(claimed || []).some(c => !/not (yet )?obtained|not obtained yet|yet to be/i.test(c)), claimed);
    const dates = txt.match(/\b(Q[1-4] 20\d\d)\b/g) || [];
    check(`${name}: certification dates appear only as founder-set targets`, dates.every(d => new RegExp('(Target ' + d + '|targeted for ' + d + '|for ' + d + ')').test(txt)), dates);
    check(`${name}: form fields labelled`, (await unlabelled(page)).length === 0, await unlabelled(page));
    (await page.$$eval('a[href^="/"]', as => as.map(a => a.getAttribute('href')))).forEach(h => internalLinks.add(h.split('#')[0]));
    await scrollAll(page);
    await page.screenshot({ path: `${SHOTS}/${name}-1280.png`, fullPage: true });
  }

  console.log('index content');
  await page.goto(ORIGIN + '/pmoflow/'); await page.waitForLoadState('networkidle').catch(() => {});
  const body = await page.textContent('main');   /* textContent: FAQ answers sit in closed <details> */
  check('index: hero is the core line', (await page.innerText('h1')).replace(/\s+/g, ' ').trim() === 'Whether you bring your existing tools or start fresh with us, PMOFlow does the heavy lifting for your operations.');
  check('index: subhead keeps the value line', (await page.innerText('.hero .lede')).startsWith('Your process map is the project plan.'));
  check('index: no-migration line', (await page.innerText('[data-oneliner]')).trim() === 'No migration project. Connect what you have, or don’t.');
  check('index: two paths (starting fresh / already using)', /Starting fresh/.test(await page.innerText('[data-path="fresh"]')) &&
    (await page.innerText('[data-flow]')).trim() === 'map → plan → track → test → approve → launch' &&
    /Already using Jira or Azure DevOps\?/.test(await page.innerText('[data-path="existing"]')) && /syncs both ways/.test(await page.innerText('[data-path="existing"]')));
  /* R14 L4 #3: the PMO buyer's path leads with keeping Jira / Azure DevOps (within the founder positioning) */
  const LEAD = 'Already using Jira or Azure DevOps? Keep your workflow.';
  check('index: hero leads the PMO buyer with "Keep your workflow"', (await page.innerText('[data-pmo-lead]')).replace(/\s+/g, ' ').trim().startsWith(LEAD) &&
    await page.locator('[data-pmo-lead] a[href="#paths"]').count() === 1);
  check('index: the existing-tools path comes first and is headed with the lead line',
    (await page.getAttribute('[data-paths] > .card:first-child', 'data-path')) === 'existing' &&
    (await page.innerText('[data-path="existing"] h3')).replace(/\s+/g, ' ').trim() === LEAD);
  check('index: the hero keeps the founder line above the lead line', await page.evaluate(() => {
    const h = document.querySelector('.hero h1'), l = document.querySelector('[data-pmo-lead]');
    return !!(h && l && (h.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING));
  }));
  check('index: a Jira date past the deadline becomes a plan change, never a silent move', /past (the|its) (project )?deadline/i.test(body) && /plan change/i.test(body) && /sponsor/i.test(body));
  check('index: six differentiators', await page.locator('.diff-list > li.diff').count() === 6);
  const diffTitles = await page.$$eval('.diff h3', hs => hs.map(h => h.textContent.toLowerCase()));
  check('index: differentiators in contract order', ['what changed', 'information', 'plan', 'sign-off', 'test', 'undo'].every((w, i) => diffTitles[i].includes(w)), diffTitles);
  check('index: Try the live demo -> /concepts/pmoflow/', await page.locator('a[href="/concepts/pmoflow/"]', { hasText: 'Try the live demo' }).count() >= 1);
  check('index: Book a demo CTAs', await page.locator('a[data-cta="book"]').count() >= 3);
  check("index: who's behind it names Neco Goode and links necogoode.com", /Neco Goode/.test(await page.innerText('#who')) && await page.locator('#who a[href="https://www.necogoode.com/"]').count() === 1);
  check('index: FAQ has at least 6 questions', await page.locator('.faq details').count() >= 6);
  check('index: prices filled from pricing.json', body.includes(money(Math.min(...pricing.plans.filter(p => p.perEditorMonthly).map(p => p.perEditorMonthly)))) && body.includes(money(pricing.pilot.price)));
  const ld = JSON.parse((await meta(page)).ld[0]);
  check('index: JSON-LD SoftwareApplication with offers from pricing.json', ld['@type'] === 'SoftwareApplication' && ld.name === 'PMOFlow' &&
    Array.isArray(ld.offers) && ld.offers.map(o => +o.price).join() === pricing.plans.filter(p => p.perEditorMonthly).map(p => p.perEditorMonthly).join(), ld.offers);
  await page.locator('.faq details summary').first().click();
  check('index: FAQ opens', await page.locator('.faq details[open]').count() === 1);

  console.log('pricing content');
  await page.goto(ORIGIN + '/pmoflow/pricing'); await page.waitForSelector('#plans [data-plan]');
  check('pricing: free + 3 plans rendered', await page.locator('#plans [data-plan]').count() === 1 + pricing.plans.length);
  for (const pl of pricing.plans.filter(x => x.perEditorMonthly))
    check(`pricing: ${pl.name} shows ${money(pl.perEditorMonthly)} from pricing.json`, (await page.innerText(`[data-plan="${pl.id}"] .price`)).trim() === money(pl.perEditorMonthly));
  check('pricing: approvers free card', /free/i.test(await page.innerText('[data-plan="free"]')));
  check('pricing: Enterprise is custom, SCIM marked planned', /custom/i.test(await page.innerText('[data-plan="enterprise"] .price')) && /SCIM user provisioning\s*Planned/i.test(await page.innerText('[data-plan="enterprise"]')));
  check('pricing: pilot price and days from pricing.json', (await page.innerText('[data-pilot-price]')).trim() === money(pricing.pilot.price) && (await page.innerText('#pilot-h')).includes(String(pricing.pilot.days)));
  check('pricing: Start a pilot + Book a demo CTAs', await page.locator('a[href="/pmoflow/demo?plan=pilot"]', { hasText: 'Start a pilot' }).count() === 1 && await page.locator('a[data-cta="book"]').count() >= 1);
  const biz = pricing.plans.find(p => p.id === 'business'), team = pricing.plans.find(p => p.id === 'team');
  await page.selectOption('#est-plan', 'business'); await page.fill('#est-editors', '10');
  check('estimator: 10 Business editors = annual total', (await page.innerText('#est-total')).trim() === money(10 * biz.perEditorMonthly * 12) + ' a year', await page.innerText('#est-total'));
  check('estimator: says approvers are free', /Approvers are free/.test(await page.innerText('.est-out')));
  await page.selectOption('#est-plan', 'team'); await page.fill('#est-editors', String(team.maxEditors + 5));
  check('estimator: Team over its editor cap suggests Business', (await page.innerText('#est-note')).includes(String(team.maxEditors)) && (await page.innerText('#est-note')).includes('Business'));
  /* R12 #12: Team never prices more than 25 editors; the nudge prices Business for the number asked, and switches in one click */
  check('estimator: Team is capped at its limit in the box and the estimate', (await page.inputValue('#est-editors')) === String(team.maxEditors) &&
    (await page.innerText('#est-total')).trim() === money(team.maxEditors * team.perEditorMonthly * 12) + ' a year', await page.inputValue('#est-editors') + ' / ' + await page.innerText('#est-total'));
  check('estimator: the nudge prices Business for the editors asked for', (await page.innerText('#est-note')).includes(money((team.maxEditors + 5) * biz.perEditorMonthly * 12) + ' a year'), await page.innerText('#est-note'));
  await page.click('[data-est-switch="business"]');
  check('estimator: "Switch to Business" keeps the number asked for', (await page.inputValue('#est-plan')) === 'business' && (await page.inputValue('#est-editors')) === String(team.maxEditors + 5) &&
    (await page.innerText('#est-total')).trim() === money((team.maxEditors + 5) * biz.perEditorMonthly * 12) + ' a year' && !(await page.innerText('#est-note')).trim());
  await page.selectOption('#est-plan', 'team');
  check('estimator: switching back to Team caps again', (await page.inputValue('#est-editors')) === String(team.maxEditors) && /covers up to/.test(await page.innerText('#est-note')));
  await page.fill('#est-editors', '-3'); await page.dispatchEvent('#est-editors', 'change');
  check('estimator: a negative number becomes 1', (await page.inputValue('#est-editors')) === '1' && /^1 editor ×/.test((await page.innerText('#est-detail')).trim()));
  /* R11: 0 editors → the box and the estimate both say 1 */
  await page.fill('#est-editors', '0');
  check('estimator: 0 becomes 1 in the input and the estimate', (await page.inputValue('#est-editors')) === '1' && /^1 editor ×/.test((await page.innerText('#est-detail')).trim()), await page.inputValue('#est-editors'));
  await page.fill('#est-editors', ''); await page.dispatchEvent('#est-editors', 'change');
  check('estimator: an emptied box is filled with 1 on leaving it', (await page.inputValue('#est-editors')) === '1');
  await page.fill('#est-editors', '1');
  check('estimator: singular editor', /^1 editor ×/.test((await page.innerText('#est-detail')).trim()));

  console.log('security content');
  await page.goto(ORIGIN + '/pmoflow/security');
  const sec = (await page.textContent('main')).replace(/\s+/g, ' ');
  for (const id of ['model', 'access', 'signin', 'roles', 'audit', 'encryption', 'hosting', 'it', 'continuity', 'ai', 'roadmap', 'risks'])
    check(`security: section #${id}`, await page.locator('#' + id + ' h2').count() === 1);
  check('security: tenant messaging', /never leave your tenant/i.test(sec) && !/no code on our side/i.test(sec));
  check('security: SOC 2 labelled planned, never claimed', /Target Q3 2027\s*SOC 2 Type I/.test(sec) && /does not hold any security certification/i.test(sec) &&
    !/(SOC 2|ISO 27001)[^.]{0,40}(certified|compliant|attested)/i.test(sec.replace(/does not hold any security certification today/i, '')));
  /* R11 §5 */
  const it = (await page.textContent('#it')).replace(/\s+/g, ' ');
  check('security: what Team needs from IT (template setup, no relay, browser only)', /runs our template/.test(it) && /only needed when you connect Jira or Azure DevOps/.test(it) && /runs in the browser/.test(it) && !/no Azure install/i.test(it));
  const cont = (await page.textContent('#continuity')).replace(/\s+/g, ' ');
  check('security: vendor continuity states the facts (tenant, export formats)', /stay in your tenant/.test(cont) && /BPMN 2\.0/.test(cont) && /CSV/.test(cont) && /JSON/.test(cont));
  const raw = fs.readFileSync(path.join(PUBLIC, 'pmoflow', 'security.html'), 'utf8') + fs.readFileSync(path.join(PUBLIC, 'pmoflow', 'pricing.html'), 'utf8');
  /* Founder decisions, Nov 17 2026: escrow is offered on request for Enterprise (customer pays the agent);
     pen test and SOC 2 carry founder-set TARGET dates. Guards kept: no pending markers, nothing claimed as obtained. */
  check('security: no founder-pending markers in the published HTML', !/FOUNDER-CONFIRM/i.test(raw));
  check('security: escrow offered on request for Enterprise, customer pays the agent', /Source code escrow for Enterprise/.test(sec) && /paid by the customer/i.test(sec));
  check('security: SOC 2 / pen-test dates appear only as founder-set targets, never as achieved', /Target Q1 2027\s*Third-party penetration test/.test(sec) && /Target Q3 2027\s*SOC 2 Type I/.test(sec) && /Not yet obtained/.test(sec));
  check('security: audit claim is exact (signed head, and what it does not prove)', /signed head/.test(sec) && /not as each change is saved/.test(sec) && !/verified as complete/i.test(sec));
  /* R14 L4 #3: the history sentence is written by the server from the actual change */
  const audit = (await page.textContent('#audit')).replace(/\s+/g, ' ');
  check('security: history text is written by the server from the actual change', /written by the server from the actual change/i.test(audit) && /note/i.test(audit), audit.slice(0, 300));
  check('security: department rules state exactly the three cases and the recent-move rule', /Naming the first approver of a department that has none takes one Admin/.test(sec) &&
    /With two or more Admins, moving someone between departments or changing a department’s existing approvers is proposed by one Admin and confirmed by another with the extra sign-in check/.test(sec) &&
    /In a workspace with one Admin, those changes apply at once and History says so/.test(sec) &&
    sec.includes('Someone moved into a department, or made an approver, after its testing or approval started can’t pass its tests or approve it.'));
  check('security: pilot and escrow terms are not invented', !/escrow[^.]{0,80}\b(free|included|at no cost)\b/i.test(sec) && !/\bSLA\b[^.]{0,40}\b99\.\d+%/.test(sec));
  check('security: "Request our security packet" goes to the demo form with topic=security', await page.locator('a[href="/pmoflow/demo?topic=security"]').count() >= 1);
  await page.goto(ORIGIN + '/pmoflow/demo?topic=security');
  check('demo form: topic=security pre-fills the ask', (await page.textContent('#demo-title')) === 'Request our security packet' && /security packet/.test(await page.inputValue('#f-fix')));
  await page.goto(ORIGIN + '/pmoflow/security');
  check('security: every Planned item is in roadmap, signin or model', await page.$$eval('.tag.planned', ts => ts.every(t => t.closest('#roadmap, #signin, #model, #status-key'))));

  console.log('compare content');
  await page.goto(ORIGIN + '/pmoflow/compare');
  const heads = await page.$$eval('thead th', ths => ths.map(t => t.textContent.trim()));
  check('compare: Jira, Planner, Smartsheet, Signavio and PMOFlow columns', ['Jira', 'Planner', 'Smartsheet', 'Signavio', 'PMOFlow'].every(w => heads.some(h => h.includes(w))), heads);
  check("compare: says what PMOFlow deliberately doesn't do", /deliberately/i.test(await page.innerText('main')) && await page.locator('td', { hasText: 'No, deliberately' }).count() >= 2);
  /* R13 (CONSOLIDATED-R12 §4, Karen): say plainly that PMOFlow is not a recurring-checklist or case tool */
  const cmpMain = (await page.innerText('main')).replace(/\s+/g, ' ');
  check('compare: "manages the change to a process, not each run of it"', cmpMain.includes('PMOFlow manages the change to a process, not each run of it'), cmpMain.slice(0, 200));
  check('compare: recurring runs are listed under what PMOFlow deliberately doesn’t do', /each time it happens/i.test(await page.innerText('#not-h + ul')) &&
    await page.locator('tbody tr', { hasText: /each time|every time|each week/i }).locator('td[data-col="PMOFlow"]', { hasText: 'No, deliberately' }).count() === 1);

  /* R15 M4 #4a (PMO R14 blocker): the demo form lists ServiceNow, so the compare page says plainly there is no ServiceNow
     integration yet, names the tools PMOFlow does sync with, and promises no date for it */
  const sn = (await page.innerText('[data-no-servicenow]').catch(() => '')).replace(/\s+/g, ' ');
  check('compare: says plainly there is no ServiceNow integration yet', /no ServiceNow integration yet/.test(sn) && /Jira and Azure DevOps/.test(sn), sn);
  check('compare: the ServiceNow note promises no date, plan or term', !/\b(Q[1-4]|20\d\d|planned|roadmap|coming soon|soon|later this year|next release)\b/i.test(sn), sn);
  check('compare: ServiceNow is never shown as a supported integration anywhere on the site', await (async () => {
    for (const n of ['index', 'pricing', 'security', 'compare', 'demo']) {
      const t = fs.readFileSync(path.join(PUBLIC, 'pmoflow', n + '.html'), 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      if (/(sync|syncs|integrat\w*|connect\w*) (both ways )?with[^.]{0,40}ServiceNow/i.test(t) && !/no ServiceNow integration yet/.test(t)) return false;
    }
    return true;
  })());
  check('demo: the ServiceNow choice says it is not integrated yet', /no integration yet/i.test(await page.evaluate(async () => {
    const r = await fetch('/pmoflow/demo.html'); const d = new DOMParser().parseFromString(await r.text(), 'text/html');
    const i = d.querySelector('input[name="tools"][value="ServiceNow"]'); return i ? i.closest('label').textContent : ''; })));

  /* R15 M4 #4b: the pilot copy restates only what the pilot offer already says (we set up PMOFlow for your team, connected
     to your tools if you want; one process; 90 days; credited to year one). No page promises a single setup call, an SLA
     or a guarantee the offer doesn't make. */
  await page.goto(ORIGIN + '/pmoflow/pricing');
  const pilotTxt = (await page.innerText('.card.pilot')).replace(/\s+/g, ' ');
  check('pricing: the pilot says who does the setup, as the offer states it', /We set up PMOFlow for your team, connected to your tools if you want/.test(pilotTxt) && /credited to your first year/.test(pilotTxt), pilotTxt);
  check('pricing: the pilot names one process and 90 days', /one process/.test(pilotTxt) && /90 days/.test(pilotTxt), pilotTxt);
  const site = ['index', 'pricing', 'security', 'compare', 'demo'].map(n => fs.readFileSync(path.join(PUBLIC, 'pmoflow', n + '.html'), 'utf8').replace(/<[^>]+>/g, ' ')).join(' ').replace(/\s+/g, ' ');
  const invented = site.match(/\b(one|a single|single) (setup |onboarding )?call\b|money[- ]back|guarantee\w*|\bfree pilot\b|pilot[^.]{0,40}\bfree\b|\brefund\w*/gi);
  check('site: no invented pilot terms (single setup call, guarantee, refund, free pilot)', !invented, invented);

  console.log('internal links');
  for (const href of internalLinks) {
    const u = new URL(href, ORIGIN);
    const r = await page.request.get(ORIGIN + mapPath(u.pathname) + u.search, { headers: { 'x-forwarded-for': TEST_IP } });
    check(`link ${href} resolves`, r.status() === 200, r.status());
  }

  console.log('demo form');
  await page.goto(ORIGIN + '/pmoflow/demo');
  const posts = [];
  page.on('request', rq => { if (rq.url().includes('/api/pmoflow/buyer/demo-request')) posts.push(rq); });
  await page.click('#demo-form button[type=submit]');
  check('demo: empty submit shows field errors, sends nothing', (await page.locator('#demo-form .err:not(:empty)').count()) >= 5 && posts.length === 0);
  check('demo: invalid fields marked aria-invalid', await page.locator('#f-name[aria-invalid="true"]').count() === 1);
  check('demo: focus moves to first invalid field', await page.evaluate(() => document.activeElement && document.activeElement.id) === 'f-name');
  /* the test lead is marked test:true on the wire (the form itself never sends it) */
  await page.route('**/api/pmoflow/buyer/demo-request', route => {
    const b = JSON.parse(route.request().postData() || '{}');
    return route.continue({ postData: JSON.stringify(Object.assign(b, { test: true })) });
  });
  const day = new Date(Date.now() + 7 * 86400000); const ymd = day.toISOString().slice(0, 10);
  await page.fill('#f-name', 'Ada Northwind');
  await page.fill('#f-email', 'ada.test@northwind.example');
  await page.fill('#f-company', 'Northwind Test');
  await page.fill('#f-role', 'PMO lead');
  await page.selectOption('#f-team', '51-200');
  await page.check('input[name=tools][value="Jira"]'); await page.check('input[name=tools][value="Visio"]');
  await page.fill('#f-fix', 'Automated e2e test lead. Vendor onboarding takes three weeks.');
  await page.fill('#f-date', ymd);
  await page.selectOption('#f-window', 'afternoon');
  const respP = page.waitForResponse(r => r.url().includes('/api/pmoflow/buyer/demo-request'));
  await page.click('#demo-form button[type=submit]');
  const resp = await respP;
  const rb = await resp.json().catch(() => ({}));
  check('demo: POST /api/pmoflow/buyer/demo-request is 201', resp.status() === 201 && !!rb.id, { status: resp.status(), rb });
  await page.waitForSelector('#thanks:not([hidden])', { timeout: 8000 }).catch(() => {});
  check('demo: confirmation with what happens next', await page.locator('#thanks').isVisible() && /What happens next/.test(await page.innerText('#thanks')) && !(await page.locator('#demo-form').isVisible()));
  check('demo: focus on confirmation heading', await page.evaluate(() => document.activeElement && document.activeElement.id) === 'thanks-title');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ics-link')]);
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  check('demo: .ics hold downloads', dl.suggestedFilename() === 'pmoflow-demo-hold.ics');
  check('demo: .ics is a tentative 30-minute hold on the chosen day', /^BEGIN:VCALENDAR\r\n/.test(ics) && ics.includes('DTSTART:' + ymd.replace(/-/g, '') + 'T140000') &&
    ics.includes('DTEND:' + ymd.replace(/-/g, '') + 'T143000') && ics.includes('STATUS:TENTATIVE') && /END:VCALENDAR\r\n$/.test(ics), ics);
  await page.screenshot({ path: `${SHOTS}/demo-thanks-1280.png`, fullPage: true });

  /* the row really landed in storage, tagged */
  if (rb.id && process.env.PMOFLOW_STORAGE_FILE !== '') {
    const connFile = process.env.PMOFLOW_STORAGE_FILE || '/home/claude/.pmoflow-storage.conn';
    if (fs.existsSync(connFile)) {
      process.env.EMCEE_STORAGE_CONNECTION = fs.readFileSync(connFile, 'utf8').trim();
      const tables = require('../../api/shared/tables');
      const rows = await tables.query('pmoflowleads', `PartitionKey eq 'lead' and RowKey eq '${rb.id}'`);
      const row = rows && rows[0];
      check('storage: lead row in pmoflowleads with app:pmoflow, test:true, Northwind Test',
        !!row && row.app === 'pmoflow' && row.test === true && row.company === 'Northwind Test' && row.tools === 'Jira, Visio' && row.preferredWindow === 'afternoon',
        row ? { app: row.app, test: row.test, company: row.company } : 'no row');
      delete process.env.EMCEE_STORAGE_CONNECTION;
    } else console.log('  note no storage connection file; storage row not checked');
  }

  console.log('api via dev server');
  const api = (method, p, data) => page.request.fetch(ORIGIN + '/api/pmoflow/' + p, { method, data, headers: { 'x-forwarded-for': TEST_IP, 'content-type': 'application/json' } });
  let r2 = await api('POST', 'buyer/demo-request', { name: 'x' });
  check('api: invalid request is 400 with field errors', r2.status() === 400 && !!(await r2.json()).fields.email);
  r2 = await api('POST', 'buyer/demo-request', { website: 'http://spam.example', name: 'Bot', company: 'Northwind Test', test: true });
  check('api: honeypot is a silent 201 with no id', r2.status() === 201 && !(await r2.json()).id);
  if (!process.env.PMOFLOW_ADMIN_KEY) { r2 = await api('GET', 'buyer/leads?key=anything'); check('api: leads is 404 while PMOFLOW_ADMIN_KEY is unset', r2.status() === 404); }
  r2 = await api('GET', 'buyer/nope'); check('api: unknown buyer route is 404', r2.status() === 404);
  r2 = await api('GET', 'ws/aaaaaaaaaaaa/state'); check('api: other routes still reach index.js', r2.status() !== 500);

  await desk.close();

  console.log('mobile 390');
  const mob = await browser.newContext(Object.assign(ctxOpts(390, 844), { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }));
  const mp = await newPage(mob);
  for (const [name, url] of PAGES) {
    await mp.goto(ORIGIN + url); await mp.waitForLoadState('networkidle').catch(() => {});
    if (name === 'pricing') await mp.waitForSelector('#plans [data-plan]');
    check(`${name} @390: no horizontal overflow`, await noOverflow(mp), await mp.evaluate(() => document.documentElement.scrollWidth));
    const small = await mp.evaluate(() => [...document.querySelectorAll('main a.btn, main button, .site-nav a, .checks label')].filter(e => e.offsetParent)
      .filter(e => { const b = e.getBoundingClientRect(); return b.height < 32; }).map(e => e.textContent.trim().slice(0, 30)));
    check(`${name} @390: tap targets at least 32px tall`, small.length === 0, small);
    await scrollAll(mp);
    await mp.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
  }
  await mob.close();

  check('zero console errors (with production CSP)', errors.length === 0, errors.slice(0, 5));
}

(async () => {
  const browser = await chromium.launch();
  try {
    if (process.argv.includes('--shots')) { await captureShots(browser); return; }
    await moduleChecks();
    configChecks();
    await browserChecks(browser);
  } catch (e) { fail++; failures.push('crash: ' + e.message); console.error(e); }
  finally {
    await browser.close();
    if (!process.argv.includes('--shots')) {
      console.log(`\n${pass} passed, ${fail} failed`);
      if (fail) { console.log('failures:\n  ' + failures.join('\n  ')); process.exitCode = 1; }
    }
  }
})();
