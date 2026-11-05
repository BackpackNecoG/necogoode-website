/* R9 §12 no-local-counting lint (stream P).
   ONE TRUTH: no page decides for itself what is late or what is blocking. Every late count, late badge and blocker list
   comes from E().projectTruth (late, lateCount, who) or E().personQueue, or from the engine's per-item flags
   (forecastAll(...).late, scheduleBadge(...)). This greps web/public/concepts/pmoflow/app/pages/*.js for local
   late or blocker computations and fails on any hit that isn't in the small allow-list below.
   Usage: node tests/pmoflow/lint-no-local-counting.js   (exit 1 on a violation) */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../web/public/concepts/pmoflow/app/pages');

/* What a local late / blocker computation looks like. */
const RULES = [
  { id: 'due-before-today', re: /\bdue\b\)?\s*<=?\s*(today\b|t\b|td\b|now\b)/, why: 'compares a due date with today (past due decided locally)' },
  { id: 'today-after-due', re: /\b(today\(\)|today|t)\s*>=?\s*(String\()?[\w.]*\.due\b/, why: 'compares today with a due date (past due decided locally)' },
  { id: 'sched-late', re: /\bsched\s*[!=]==?\s*['"](late|slip)['"]/, why: 'reads the raw forecast sched to decide late' },
  { id: 'schedkey-late', re: /schedKey\([^)]*\)\s*[!=]==?\s*['"](late|slip|causing)['"]/, why: 'turns a badge key into a late test' },
  { id: 'includes-schedkey', re: /\[[^\]]*['"](late|slip|causing)['"][^\]]*\]\.includes\(\s*(schedKey|[\w.]*sched)/, why: 'counts late items from badge keys' },
  { id: 'filter-late', re: /\.filter\([^)]*\b(late|isLate|pastDue|runningLate)\b[^)]*\)\.length/, why: 'counts late items locally' },
  { id: 'blockers-local', re: /\.blockers\.(length|map|filter|slice)\b/, why: 'uses the raw blocker list instead of who.filter(why === "blocker")' },
];

/* The allow-list: [file, a substring of the line, why it's fine]. Keep it small. */
const ALLOW = [
  ['step.js', 'truth.blockers.filter(b => stepIds.includes(b.dataId))', "step page: the engine's own blocker list narrowed to this step's information (planned or not), matching the map's 'Waiting on' badges; not a project count"],
  ['project.js', "k = sched === 'late' ? 'late'", 'schedKey: maps an engine forecast field to ONE badge key only when scheduleBadge is unavailable (what-if copies); never a count'],
];

let fail = 0, scanned = 0;
const hits = [];
for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.js')).sort()) {
  const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    scanned++;
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/^\s*\/\/.*$/, '');
    for (const r of RULES) {
      if (!r.re.test(code)) continue;
      const ok = ALLOW.find(([af, snip]) => af === f && line.includes(snip));
      hits.push({ f, n: i + 1, rule: r.id, ok: !!ok, why: ok ? ok[2] : r.why, text: line.trim().slice(0, 160) });
    }
  });
}
for (const h of hits) {
  if (h.ok) console.log(`  allow ${h.f}:${h.n} [${h.rule}] ${h.why}`);
  else { fail++; console.log(`  FAIL  ${h.f}:${h.n} [${h.rule}] ${h.why}\n        ${h.text}`); }
}
/* The allow-list must stay honest: every entry still matches a real line. */
for (const [af, snip] of ALLOW) {
  const src = fs.existsSync(path.join(DIR, af)) ? fs.readFileSync(path.join(DIR, af), 'utf8') : '';
  if (!src.includes(snip)) { fail++; console.log(`  FAIL  stale allow-list entry ${af}: "${snip}"`); }
}
console.log(`\nscanned ${scanned} lines in app/pages/*.js: ${hits.filter(h => !h.ok).length} local late/blocker computations, ${hits.filter(h => h.ok).length} allow-listed`);
process.exit(fail ? 1 : 0);
