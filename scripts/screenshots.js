// scripts/screenshots.js
//
// Captures hero + full-page screenshots of three live creations and saves them
// into web/public/screenshots/{slug}/. Designed to be re-run later when login
// walls expire or sites ship a new version.
//
// Usage:
//   npx --yes playwright install chromium
//   node scripts/screenshots.js
//
// Settings: 1600x1200 viewport, deviceScaleFactor 2 (Retina). Waits for
// networkidle (30s) with domcontentloaded fallback, then 1500ms settle.
//
// If a target redirects to a /login, /signin or other auth gate, we still
// capture what we see and drop a `_LOGIN_WALL.txt` next to the images so
// Neco knows that screenshot needs a manual replacement post-launch.

import { chromium } from 'playwright';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_BASE = join(ROOT, 'web', 'public', 'screenshots');

const TARGETS = [
  { url: 'https://goodegame.com', slug: 'goodegame', name: 'GoodeGame' },
  { url: 'https://sololift.ai', slug: 'sololift', name: 'SoloLift' },
  { url: 'https://vibewithprimitiveai.com', slug: 'vibing-with-primitive-ai', name: 'VibingWithPrimitiveAI' },
];

// Heuristics for detecting an auth/login gate after navigation settles.
const LOGIN_PATH_RE = /\/(login|signin|sign-in|auth|account\/login)(\/|$|\?)/i;
const LOGIN_TEXT_RE = /(sign\s*in|log\s*in|password|email\s*address)/i;

async function safeGoto(page, url) {
  // Try networkidle first (30s), fall back to domcontentloaded.
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    return 'networkidle';
  } catch {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return 'domcontentloaded';
  }
}

async function detectLoginWall(page, originalUrl) {
  const finalUrl = page.url();

  // Path-based redirect detection.
  if (LOGIN_PATH_RE.test(finalUrl)) {
    return `Final URL ${finalUrl} matches login path pattern (started at ${originalUrl}).`;
  }

  // Look for password inputs.
  const passwordCount = await page.locator('input[type="password"]').count().catch(() => 0);
  if (passwordCount > 0) {
    return `Page has ${passwordCount} password input(s) — likely an auth wall.`;
  }

  // Look at visible body text in the upper portion of the page.
  const headlineText = await page.evaluate(() => {
    const t = (document.body && document.body.innerText) || '';
    return t.slice(0, 600);
  }).catch(() => '');
  if (LOGIN_TEXT_RE.test(headlineText) && headlineText.length < 400) {
    return `Page text appears to be a sign-in surface: "${headlineText.replace(/\s+/g, ' ').slice(0, 200)}"`;
  }

  return null;
}

async function captureOne(browser, target) {
  const outDir = join(OUT_BASE, target.slug);
  await mkdir(outDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  const result = { slug: target.slug, files: [], loginWall: null, mode: null };

  try {
    result.mode = await safeGoto(page, target.url);
    // Settle: fonts, animations, lazy images.
    await page.waitForTimeout(1500);

    // Hero / above-the-fold.
    const homePath = join(outDir, 'home.png');
    await page.screenshot({ path: homePath, fullPage: false, type: 'png' });
    result.files.push(homePath);

    // Full page (everything below the fold too).
    const inUsePath = join(outDir, 'in-use.png');
    await page.screenshot({ path: inUsePath, fullPage: true, type: 'png' });
    result.files.push(inUsePath);

    // Login-wall heuristic.
    const wallReason = await detectLoginWall(page, target.url);
    if (wallReason) {
      const note =
        `URL gated by login — captured screenshot is the login/landing page; ` +
        `user should provide a real product screenshot post-launch.\n\n` +
        `Detected: ${wallReason}\n` +
        `Original URL: ${target.url}\n` +
        `Final URL:    ${page.url()}\n` +
        `Captured at:  ${new Date().toISOString()}\n`;
      const notePath = join(outDir, '_LOGIN_WALL.txt');
      await writeFile(notePath, note, 'utf8');
      result.loginWall = notePath;
    }
  } finally {
    await context.close();
  }

  return result;
}

async function main() {
  await mkdir(OUT_BASE, { recursive: true });

  const browser = await chromium.launch();
  const results = [];

  try {
    for (const target of TARGETS) {
      process.stdout.write(`Capturing ${target.name} (${target.url})... `);
      try {
        const r = await captureOne(browser, target);
        results.push(r);
        console.log(`done [${r.mode}]${r.loginWall ? ' [LOGIN WALL]' : ''}`);
      } catch (err) {
        console.log(`FAILED: ${err && err.message ? err.message : err}`);
        results.push({ slug: target.slug, error: String(err) });
      }
    }
  } finally {
    await browser.close();
  }

  // Print file sizes for easy reporting.
  console.log('\n--- Sizes ---');
  for (const r of results) {
    if (r.error) {
      console.log(`${r.slug}: ERROR — ${r.error}`);
      continue;
    }
    for (const f of r.files) {
      try {
        const s = await stat(f);
        console.log(`${r.slug}: ${f.split(/[\\/]/).pop()} = ${(s.size / 1024).toFixed(1)} KB`);
      } catch {
        console.log(`${r.slug}: ${f} — (stat failed)`);
      }
    }
    if (r.loginWall) console.log(`${r.slug}: login-wall note written -> ${r.loginWall}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
