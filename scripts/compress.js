// scripts/compress.js
//
// Re-encodes screenshot PNGs through sharp's palette+adaptive-filter pipeline
// to drop them under ~800KB each without losing the Retina pixel grid. Only
// touches files that are already over the threshold, so it's idempotent and
// can be re-run after screenshots.js whenever a new capture is taken.

import sharp from 'sharp';
import { readdir, stat, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_BASE = join(ROOT, 'web', 'public', 'screenshots');
const THRESHOLD = 800 * 1024; // 800KB

async function compressOne(filePath) {
  const before = (await stat(filePath)).size;
  if (before <= THRESHOLD) return { filePath, before, after: before, skipped: true };

  const tmp = filePath + '.tmp';
  await sharp(filePath)
    .png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 })
    .toFile(tmp);

  const after = (await stat(tmp)).size;
  if (after < before) {
    await unlink(filePath);
    await rename(tmp, filePath);
  } else {
    await unlink(tmp);
  }
  return { filePath, before, after, skipped: false };
}

async function main() {
  const slugs = await readdir(OUT_BASE, { withFileTypes: true });
  for (const d of slugs) {
    if (!d.isDirectory()) continue;
    const dir = join(OUT_BASE, d.name);
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith('.png')) continue;
      const r = await compressOne(join(dir, f));
      const tag = r.skipped ? 'OK   ' : 'CRUSH';
      console.log(
        `${tag} ${d.name}/${f}: ${(r.before / 1024).toFixed(1)} KB -> ${(r.after / 1024).toFixed(1)} KB`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
