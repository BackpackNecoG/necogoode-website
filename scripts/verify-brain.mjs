// scripts/verify-brain.mjs
//
// Verifier for the /brain circuit-board portfolio (Stream D).
//
// Reads web/src/data/brainBoard.json and asserts two things:
//   1. Every pin resolves to an existing image file, using the build-time
//      precedence  manual/ > captures/ > assets/  (manual hand-captures win
//      over auto-captures, which win over committed assets). The pin's
//      image.type is the expected primary location, but a higher-precedence
//      file is always allowed to satisfy it.
//   2. Every non-null build.url returns HTTP 200.
//
// Prints a pass/fail report and exits nonzero on any failure. Network checks
// use the global fetch (Node 18+); no extra dependencies.
//
// Usage (from repo root):
//   node scripts/verify-brain.mjs

import { readFile, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'web', 'src', 'data', 'brainBoard.json');
const BRAIN = join(ROOT, 'web', 'public', 'brain');

// Build-time precedence: highest first.
const PRECEDENCE = ['manual', 'captures', 'assets'];

async function fileExists(p) {
  try {
    await access(p, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Resolve a pin's image filename against the precedence chain.
// Returns { found: boolean, dir: string|null }.
async function resolveImage(file) {
  for (const dir of PRECEDENCE) {
    if (await fileExists(join(BRAIN, dir, file))) {
      return { found: true, dir };
    }
  }
  return { found: false, dir: null };
}

async function checkUrl(url) {
  // Try HEAD first; some hosts reject HEAD, so fall back to GET.
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', redirect: 'follow' });
    }
    return { ok: res.status === 200, status: res.status };
  } catch (err) {
    return { ok: false, status: null, error: err && err.message ? err.message : String(err) };
  }
}

async function main() {
  const board = JSON.parse(await readFile(DATA, 'utf8'));

  const imageFailures = [];
  const imagePasses = [];
  const urlFailures = [];
  const urlPasses = [];

  // --- Image resolution ---
  for (const build of board.builds) {
    for (const pin of build.pins || []) {
      const file = pin.image && pin.image.file;
      const label = `${build.pn} ${build.name} pin#${pin.n}`;
      if (!file) {
        imageFailures.push(`${label}: pin has no image.file`);
        continue;
      }
      const { found, dir } = await resolveImage(file);
      if (found) {
        const expected = pin.image.type === 'manual' ? 'manual' : pin.image.type === 'asset' ? 'assets' : 'captures';
        const note = dir === expected ? '' : `  (resolved via ${dir}/, expected ${expected}/)`;
        imagePasses.push(`${label}: ${file} -> ${dir}/${note}`);
      } else {
        imageFailures.push(
          `${label}: ${file} not found in manual/, captures/, or assets/ (type="${pin.image.type}")`,
        );
      }
    }
  }

  // --- URL liveness (non-null only) ---
  const urlBuilds = board.builds.filter((b) => b.url);
  const results = await Promise.all(
    urlBuilds.map(async (b) => ({ build: b, res: await checkUrl(b.url) })),
  );
  for (const { build, res } of results) {
    const label = `${build.pn} ${build.name} ${build.url}`;
    if (res.ok) {
      urlPasses.push(`${label} -> 200`);
    } else {
      urlFailures.push(`${label} -> ${res.status ?? 'NO RESPONSE'}${res.error ? ' (' + res.error + ')' : ''}`);
    }
  }
  const nullUrlBuilds = board.builds.filter((b) => !b.url).map((b) => `${b.pn} ${b.name}`);

  // --- Report ---
  console.log('=== verify-brain.mjs ===\n');

  console.log(`IMAGES (${imagePasses.length} ok / ${imageFailures.length} failed):`);
  for (const p of imagePasses) console.log(`  PASS  ${p}`);
  for (const f of imageFailures) console.log(`  FAIL  ${f}`);

  console.log(`\nURLS (${urlPasses.length} ok / ${urlFailures.length} failed):`);
  for (const p of urlPasses) console.log(`  PASS  ${p}`);
  for (const f of urlFailures) console.log(`  FAIL  ${f}`);
  if (nullUrlBuilds.length) {
    console.log(`  SKIP  null url (not yet public): ${nullUrlBuilds.join(', ')}`);
  }

  const totalFailures = imageFailures.length + urlFailures.length;
  console.log(`\n=== ${totalFailures === 0 ? 'PASS' : 'FAIL'} — ${totalFailures} failure(s) ===`);
  process.exit(totalFailures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
