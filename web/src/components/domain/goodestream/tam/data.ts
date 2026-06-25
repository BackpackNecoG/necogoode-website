/**
 * TAM (Talent Adoption Matrix) — data layer.
 *
 * Single source of truth for: the row schema the dashboard consumes, the
 * illustrative sample dataset shown on load, CSV template generation, and a
 * dependency-free CSV parser + validator with friendly error messages.
 *
 * Everything here runs in the browser. Uploaded data is parsed in-memory and
 * never sent anywhere — see TamDashboard for the upload flow.
 */

/** One measurement record: a (team, tool, period) aggregate. */
export type TamRow = {
  team: string;
  tool: string;
  /** Month, YYYY-MM. */
  period: string;
  active_users: number;
  eligible_users: number;
  /** 1 Novice · 2 Capable · 3 Proficient · 4 Expert. */
  fluency_level: number;
  outcome_metric_name: string;
  outcome_value: number;
  /** 0–100 engagement index. */
  engagement_score: number;
};

/** Column order is the contract: template, parser, and validator all use it. */
export const TAM_COLUMNS: Array<keyof TamRow> = [
  'team',
  'tool',
  'period',
  'active_users',
  'eligible_users',
  'fluency_level',
  'outcome_metric_name',
  'outcome_value',
  'engagement_score',
];

/** Human-readable legend embedded in the downloadable template. */
export const TAM_COLUMN_LEGEND: Record<keyof TamRow, string> = {
  team: 'Team or function name (text), e.g. Talent Acquisition',
  tool: 'AI tool name (text), e.g. HR Assist',
  period: 'Month in YYYY-MM format, e.g. 2026-03',
  active_users: 'Whole number of people who used the tool this period',
  eligible_users: 'Whole number of people who could use it (active/eligible = adoption %)',
  fluency_level: 'Integer 1-4: 1 Novice, 2 Capable, 3 Proficient, 4 Expert',
  outcome_metric_name: 'Name of the business outcome being moved, e.g. Time-to-fill (days)',
  outcome_value: 'Numeric value of that outcome this period',
  engagement_score: 'Engagement index 0-100',
};

export const FLUENCY_LABELS: Record<number, string> = {
  1: 'Novice',
  2: 'Capable',
  3: 'Proficient',
  4: 'Expert',
};

const TEAMS = ['Talent Acquisition', 'HRBP', 'L&D', 'People Analytics', 'Total Rewards'];
const TOOLS = ['HR Assist', 'JD Optimizer', 'Sourcing Copilot', 'Interview Notes AI'];
const PERIODS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

// A representative outcome metric per tool, so outcome charts are meaningful.
const TOOL_OUTCOME: Record<string, { name: string; base: number; perMonth: number }> = {
  'HR Assist': { name: 'Tickets auto-resolved (%)', base: 38, perMonth: 4 },
  'JD Optimizer': { name: 'Qualified applicants / req', base: 21, perMonth: 2.5 },
  'Sourcing Copilot': { name: 'Time-to-slate (days)', base: 19, perMonth: -1.4 },
  'Interview Notes AI': { name: 'Scorecard completion (%)', base: 61, perMonth: 5 },
};

const ELIGIBLE_BY_TEAM: Record<string, number> = {
  'Talent Acquisition': 120,
  HRBP: 64,
  'L&D': 38,
  'People Analytics': 22,
  'Total Rewards': 28,
};

/**
 * Deterministic illustrative dataset (no randomness, so it is stable across
 * reloads and reproducible). Numbers ramp month-over-month to look organic.
 */
export function buildSampleData(): TamRow[] {
  const rows: TamRow[] = [];
  TEAMS.forEach((team, ti) => {
    TOOLS.forEach((tool, oi) => {
      const eligible = Math.round(ELIGIBLE_BY_TEAM[team] * (0.5 + 0.18 * ((oi % 3) + 1)));
      PERIODS.forEach((period, pi) => {
        // Adoption climbs over time, varied per team/tool, capped below 100%.
        const ramp = 0.18 + 0.085 * pi + 0.03 * ti - 0.025 * oi;
        const adoption = Math.min(0.94, Math.max(0.08, ramp));
        const active = Math.max(1, Math.round(eligible * adoption));
        // Fluency tier rises slowly with tenure (period) + team affinity.
        const fluencyRaw = 1 + (pi + ti + (oi % 2)) / 3.2;
        const fluency = Math.max(1, Math.min(4, Math.round(fluencyRaw)));
        const outcome = TOOL_OUTCOME[tool];
        const outcomeValue = Math.round((outcome.base + outcome.perMonth * pi) * 10) / 10;
        const engagement = Math.max(
          20,
          Math.min(98, Math.round(46 + 6 * pi + 4 * ti - 5 * oi)),
        );
        rows.push({
          team,
          tool,
          period,
          active_users: active,
          eligible_users: eligible,
          fluency_level: fluency,
          outcome_metric_name: outcome.name,
          outcome_value: outcomeValue,
          engagement_score: engagement,
        });
      });
    });
  });
  return rows;
}

/* --------------------------- CSV serialization --------------------------- */

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function rowsToCsv(rows: TamRow[]): string {
  const header = TAM_COLUMNS.join(',');
  const lines = rows.map((r) => TAM_COLUMNS.map((c) => csvEscape(String(r[c]))).join(','));
  return [header, ...lines].join('\n');
}

/**
 * The downloadable template: a commented legend block, the header row, and two
 * pre-filled example rows so the expected shape is unambiguous.
 */
export function buildTemplateCsv(): string {
  const legend = TAM_COLUMNS.map((c) => `# ${c}: ${TAM_COLUMN_LEGEND[c]}`).join('\n');
  const examples: TamRow[] = [
    {
      team: 'Talent Acquisition',
      tool: 'HR Assist',
      period: '2026-01',
      active_users: 42,
      eligible_users: 120,
      fluency_level: 2,
      outcome_metric_name: 'Tickets auto-resolved (%)',
      outcome_value: 38,
      engagement_score: 54,
    },
    {
      team: 'HRBP',
      tool: 'JD Optimizer',
      period: '2026-01',
      active_users: 18,
      eligible_users: 64,
      fluency_level: 3,
      outcome_metric_name: 'Qualified applicants / req',
      outcome_value: 21,
      engagement_score: 60,
    },
  ];
  const header = TAM_COLUMNS.join(',');
  const exampleLines = examples.map((r) => TAM_COLUMNS.map((c) => csvEscape(String(r[c]))).join(','));
  return [
    '# Goode Talent Concepts — Talent Adoption Matrix · data template',
    '# Fill in one row per (team, tool, period). Delete these # comment lines and the example rows before uploading, or leave them — the parser ignores # lines.',
    '# Columns:',
    legend,
    '#',
    header,
    ...exampleLines,
  ].join('\n');
}

/* ------------------------------ CSV parsing ------------------------------ */

export type ParseResult =
  | { ok: true; rows: TamRow[]; warnings: string[] }
  | { ok: false; errors: string[] };

/** Split a single CSV line honoring quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const NUMERIC_COLUMNS: Array<keyof TamRow> = [
  'active_users',
  'eligible_users',
  'fluency_level',
  'outcome_value',
  'engagement_score',
];

/**
 * Parse + validate an uploaded CSV against the schema. Returns either ok rows
 * (with non-fatal warnings) or a list of friendly, row-numbered errors.
 */
export function parseTamCsv(text: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l)
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

  if (rawLines.length === 0) {
    return { ok: false, errors: ['The file looks empty. Expected a header row and at least one data row.'] };
  }

  const header = splitCsvLine(rawLines[0]).map((h) => h.toLowerCase());
  const missing = TAM_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [
        `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
        `Expected header: ${TAM_COLUMNS.join(', ')}. Download the template to get the exact columns.`,
      ],
    };
  }

  const colIndex: Record<string, number> = {};
  TAM_COLUMNS.forEach((c) => (colIndex[c] = header.indexOf(c)));

  const rows: TamRow[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    const cells = splitCsvLine(rawLines[i]);
    const rowNum = i + 1; // 1-based, header is line 1
    const get = (c: keyof TamRow) => (cells[colIndex[c]] ?? '').trim();

    const team = get('team');
    const tool = get('tool');
    const period = get('period');
    if (!team || !tool || !period) {
      errors.push(`Row ${rowNum}: team, tool, and period are all required.`);
      continue;
    }
    if (!/^\d{4}-\d{2}$/.test(period)) {
      errors.push(`Row ${rowNum}: period "${period}" must be in YYYY-MM format (e.g. 2026-03).`);
      continue;
    }

    const nums: Partial<Record<keyof TamRow, number>> = {};
    let rowBad = false;
    for (const c of NUMERIC_COLUMNS) {
      const raw = get(c);
      const n = Number(raw);
      if (raw === '' || Number.isNaN(n)) {
        errors.push(`Row ${rowNum}: ${c} must be a number (got "${raw}").`);
        rowBad = true;
        break;
      }
      nums[c] = n;
    }
    if (rowBad) continue;

    const active = nums.active_users!;
    const eligible = nums.eligible_users!;
    const fluency = nums.fluency_level!;

    if (eligible <= 0) {
      errors.push(`Row ${rowNum}: eligible_users must be greater than 0.`);
      continue;
    }
    if (active > eligible) {
      warnings.push(`Row ${rowNum}: active_users (${active}) exceeds eligible_users (${eligible}) — adoption will read over 100%.`);
    }
    if (fluency < 1 || fluency > 4 || !Number.isInteger(fluency)) {
      errors.push(`Row ${rowNum}: fluency_level must be an integer 1-4 (got "${fluency}").`);
      continue;
    }

    rows.push({
      team,
      tool,
      period,
      active_users: active,
      eligible_users: eligible,
      fluency_level: fluency,
      outcome_metric_name: get('outcome_metric_name') || 'Outcome',
      outcome_value: nums.outcome_value!,
      engagement_score: nums.engagement_score!,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  if (rows.length === 0) return { ok: false, errors: ['No valid data rows found after the header.'] };
  return { ok: true, rows, warnings };
}
