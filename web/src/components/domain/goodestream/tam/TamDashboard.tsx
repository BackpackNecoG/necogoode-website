import { useMemo, useRef, useState } from 'react';
import {
  TamRow,
  buildSampleData,
  buildTemplateCsv,
  parseTamCsv,
  FLUENCY_LABELS,
} from './data';
import { StatTile, LineChart, BarChart, DistributionBars, LinePoint, Bar } from './charts';

/**
 * TamDashboard — the Talent Adoption Matrix prototype (fully client-side).
 *
 * Opens on illustrative sample data, with team / tool / period filters driving
 * adoption, fluency, outcome, and engagement views plus a responsible-AI
 * monitoring panel. Users can download a CSV template, fill it in, and re-upload
 * to visualize their own data — parsed entirely in the browser, never sent
 * anywhere. "Reset to sample data" returns to the default view.
 */

const FLUENCY_COLORS: Record<number, string> = {
  1: 'var(--splash-text-faint)',
  2: 'var(--splash-bus)',
  3: 'var(--splash-tech)',
  4: 'var(--splash-text)',
};
const TOOL_COLORS = ['var(--splash-tech)', 'var(--splash-bus)', 'var(--tech-blue)', 'var(--tech-purple)', 'var(--tech-pink)'];

const ALL = '__all__';

export function TamDashboard() {
  const sample = useMemo(() => buildSampleData(), []);
  const [rows, setRows] = useState<TamRow[]>(sample);
  const [source, setSource] = useState<'sample' | 'uploaded'>('sample');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Filter options derive from the active dataset (so uploads drive them too).
  const teams = useMemo(() => uniq(rows.map((r) => r.team)), [rows]);
  const tools = useMemo(() => uniq(rows.map((r) => r.tool)), [rows]);
  const periods = useMemo(() => uniq(rows.map((r) => r.period)).sort(), [rows]);

  const [team, setTeam] = useState<string>(ALL);
  const [tool, setTool] = useState<string>(ALL);
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(Math.max(0, periods.length - 1));

  const from = periods[Math.min(fromIdx, periods.length - 1)] ?? periods[0];
  const to = periods[Math.min(Math.max(toIdx, fromIdx), periods.length - 1)] ?? periods[periods.length - 1];

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (team === ALL || r.team === team) &&
          (tool === ALL || r.tool === tool) &&
          r.period >= from &&
          r.period <= to,
      ),
    [rows, team, tool, from, to],
  );

  const periodsInRange = useMemo(() => uniq(filtered.map((r) => r.period)).sort(), [filtered]);
  const latest = periodsInRange[periodsInRange.length - 1];
  const prev = periodsInRange[periodsInRange.length - 2];
  const latestRows = useMemo(() => filtered.filter((r) => r.period === latest), [filtered, latest]);

  // KPIs (latest period in range).
  const adoptionLatest = pct(sum(latestRows, 'active_users'), sum(latestRows, 'eligible_users'));
  const activeLatest = sum(latestRows, 'active_users');
  const avgFluency = weightedFluency(latestRows);
  const avgEngagement = mean(latestRows.map((r) => r.engagement_score));

  // Adoption + engagement trends across the selected range.
  const adoptionTrend: LinePoint[] = periodsInRange.map((p) => {
    const pr = filtered.filter((r) => r.period === p);
    return { label: p, value: pct(sum(pr, 'active_users'), sum(pr, 'eligible_users')) };
  });
  const engagementTrend: LinePoint[] = periodsInRange.map((p) => {
    const pr = filtered.filter((r) => r.period === p);
    return { label: p, value: mean(pr.map((r) => r.engagement_score)) };
  });

  // Fluency distribution (active users by tier, latest period).
  const fluencyDist = [1, 2, 3, 4].map((lvl) => ({
    label: `${lvl} · ${FLUENCY_LABELS[lvl]}`,
    value: sum(latestRows.filter((r) => r.fluency_level === lvl), 'active_users'),
    color: FLUENCY_COLORS[lvl],
  }));
  const fluencyTotal = fluencyDist.reduce((a, b) => a + b.value, 0);

  // Engagement by tool (latest period, respects team filter).
  const engagementByTool: Bar[] = uniq(latestRows.map((r) => r.tool)).map((t, i) => ({
    label: t,
    value: mean(latestRows.filter((r) => r.tool === t).map((r) => r.engagement_score)),
    color: TOOL_COLORS[i % TOOL_COLORS.length],
  }));

  // Outcome metrics (averaged by metric name, latest period).
  const outcomeBars: Bar[] = uniq(latestRows.map((r) => r.outcome_metric_name)).map((name, i) => ({
    label: name,
    value: mean(latestRows.filter((r) => r.outcome_metric_name === name).map((r) => r.outcome_value)),
    color: TOOL_COLORS[i % TOOL_COLORS.length],
  }));

  // Responsible-AI / monitoring rows: one per tool, with a drift signal.
  const monitorRows = uniq(filtered.map((r) => r.tool)).map((t) => {
    const lr = latestRows.filter((r) => r.tool === t);
    const pr = filtered.filter((r) => r.period === prev && r.tool === t);
    const engNow = mean(lr.map((r) => r.engagement_score));
    const engPrev = pr.length ? mean(pr.map((r) => r.engagement_score)) : engNow;
    const drift = engNow - engPrev;
    return {
      tool: t,
      adoption: pct(sum(lr, 'active_users'), sum(lr, 'eligible_users')),
      fluency: weightedFluency(lr),
      engagement: engNow,
      drift,
    };
  });

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrors([]);
    setWarnings([]);
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseTamCsv(String(reader.result ?? ''));
      if (result.ok) {
        setRows(result.rows);
        setSource('uploaded');
        setWarnings(result.warnings);
        setTeam(ALL);
        setTool(ALL);
        setFromIdx(0);
        const ps = uniq(result.rows.map((r) => r.period)).sort();
        setToIdx(Math.max(0, ps.length - 1));
      } else {
        setErrors(result.errors);
      }
    };
    reader.onerror = () => setErrors(['Could not read that file. Try a plain .csv exported from the template.']);
    reader.readAsText(file);
    e.target.value = ''; // allow re-uploading the same file
  }

  function downloadTemplate() {
    const blob = new Blob([buildTemplateCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tam-data-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function resetToSample() {
    setRows(sample);
    setSource('sample');
    setErrors([]);
    setWarnings([]);
    setTeam(ALL);
    setTool(ALL);
    setFromIdx(0);
    setToIdx(Math.max(0, periods.length - 1));
  }

  return (
    <div className="border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-4 md:p-5">
      {/* Data source + controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[0.62rem] tracking-[0.14em] uppercase px-2 py-1 rounded-full"
            style={{
              border: '1px solid var(--splash-tech)',
              color: source === 'sample' ? 'var(--splash-tech)' : 'var(--splash-bus)',
            }}
          >
            {source === 'sample' ? 'Sample data' : 'Your data'}
          </span>
          <span className="font-mono text-[0.62rem] text-[var(--splash-text-faint)]">
            {rows.length} rows · {teams.length} teams · {tools.length} tools
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadTemplate}
            className="font-mono text-[0.68rem] tracking-[0.1em] uppercase px-3 py-1.5 rounded-sm border transition-colors hover:bg-[var(--splash-bg)]"
            style={{ borderColor: 'var(--splash-line)', color: 'var(--splash-text-soft)' }}
          >
            ↓ Download template
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="font-mono text-[0.68rem] tracking-[0.1em] uppercase px-3 py-1.5 rounded-sm border transition-colors"
            style={{ borderColor: 'var(--splash-tech)', color: 'var(--splash-tech)' }}
          >
            ↑ Upload your data
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleUpload} className="sr-only" aria-label="Upload TAM CSV data" />
          {source === 'uploaded' && (
            <button
              type="button"
              onClick={resetToSample}
              className="font-mono text-[0.68rem] tracking-[0.1em] uppercase px-3 py-1.5 rounded-sm border transition-colors hover:bg-[var(--splash-bg)]"
              style={{ borderColor: 'var(--splash-line)', color: 'var(--splash-text-soft)' }}
            >
              ↺ Reset to sample
            </button>
          )}
        </div>
      </div>

      {/* Privacy note near the upload control */}
      <p className="font-mono text-[0.64rem] leading-relaxed text-[var(--splash-text-faint)] mb-4">
        Your data stays in your browser — uploads are parsed locally and never sent to a server or
        stored. Don&apos;t upload confidential data; the template + sample exist so you can try it safely.
      </p>

      {/* Errors / warnings */}
      {errors.length > 0 && (
        <div role="alert" className="mb-4 border rounded-sm p-3" style={{ borderColor: 'var(--splash-bus)', background: 'rgba(251,191,119,0.06)' }}>
          <div className="font-mono text-[0.66rem] tracking-[0.12em] uppercase text-[var(--splash-bus)] mb-1.5">
            Couldn&apos;t load that file
          </div>
          <ul className="list-disc pl-5 space-y-1 font-sans text-[0.82rem] text-[var(--splash-text-soft)]">
            {errors.slice(0, 8).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {errors.length > 8 && <li>…and {errors.length - 8} more.</li>}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div role="status" className="mb-4 font-mono text-[0.68rem] text-[var(--splash-text-faint)]">
          {warnings.length} warning{warnings.length > 1 ? 's' : ''}: {warnings[0]}
          {warnings.length > 1 && ` (+${warnings.length - 1} more)`}
        </div>
      )}

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
        <Field label="Team">
          <Select value={team} onChange={setTeam} options={[{ v: ALL, l: 'All teams' }, ...teams.map((t) => ({ v: t, l: t }))]} />
        </Field>
        <Field label="Tool">
          <Select value={tool} onChange={setTool} options={[{ v: ALL, l: 'All tools' }, ...tools.map((t) => ({ v: t, l: t }))]} />
        </Field>
        <Field label="From">
          <Select value={String(fromIdx)} onChange={(v) => setFromIdx(Number(v))} options={periods.map((p, i) => ({ v: String(i), l: p }))} />
        </Field>
        <Field label="To">
          <Select value={String(toIdx)} onChange={(v) => setToIdx(Number(v))} options={periods.map((p, i) => ({ v: String(i), l: p }))} />
        </Field>
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-[var(--splash-line)] rounded-sm p-8 text-center font-mono text-[0.72rem] text-[var(--splash-text-faint)]">
          No rows match these filters. Widen the team, tool, or time range.
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-5">
            <StatTile label={`Adoption · ${latest}`} value={`${Math.round(adoptionLatest)}%`} sub={`${activeLatest} active users`} />
            <StatTile label="Avg AI fluency" value={`${avgFluency.toFixed(1)} / 4`} sub={FLUENCY_LABELS[Math.round(avgFluency)] ?? ''} tone="bus" />
            <StatTile label="Avg engagement" value={`${Math.round(avgEngagement)}`} sub="index 0–100" tone="soft" />
            <StatTile label="Tools tracked" value={String(uniq(latestRows.map((r) => r.tool)).length)} sub={`${periodsInRange.length} periods`} tone="soft" />
          </div>

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-4 mb-5">
            <LineChart
              title="Adoption trend (%)"
              yMax={100}
              yUnit="%"
              series={[{ name: 'Adoption', color: 'var(--splash-tech)', points: adoptionTrend }]}
            />
            <LineChart
              title="Engagement trend"
              yMax={100}
              series={[{ name: 'Engagement', color: 'var(--splash-bus)', points: engagementTrend }]}
            />
            <DistributionBars title={`AI fluency distribution · ${latest}`} items={fluencyDist} total={fluencyTotal} />
            <BarChart title={`Engagement by tool · ${latest}`} bars={engagementByTool} />
          </div>

          <div className="mb-5">
            <BarChart title={`Business outcomes · ${latest}`} bars={outcomeBars} />
          </div>

          {/* Responsible-AI / monitoring panel */}
          <section aria-label="Responsible-AI monitoring" className="border border-[var(--splash-line)] bg-[var(--splash-bg)] rounded-sm p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="font-mono text-[0.7rem] tracking-[0.12em] uppercase text-[var(--splash-text-soft)]">
                Responsible-AI monitoring · by tool
              </span>
              <span className="font-mono text-[0.6rem] text-[var(--splash-text-faint)]">drift = Δ engagement vs prior period</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] border-collapse font-mono text-[0.72rem]">
                <thead>
                  <tr className="text-[var(--splash-text-faint)] text-left">
                    <Th>Tool</Th>
                    <Th>Adoption</Th>
                    <Th>Fluency</Th>
                    <Th>Engagement</Th>
                    <Th>Drift</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {monitorRows.map((m) => {
                    const healthy = m.drift >= -2 && m.adoption >= 25;
                    return (
                      <tr key={m.tool} className="border-t border-[var(--splash-line)] text-[var(--splash-text-soft)]">
                        <Td className="text-[var(--splash-text)]">{m.tool}</Td>
                        <Td>{Math.round(m.adoption)}%</Td>
                        <Td>{m.fluency.toFixed(1)}</Td>
                        <Td>{Math.round(m.engagement)}</Td>
                        <Td>
                          <span style={{ color: m.drift >= 0 ? 'var(--splash-tech)' : 'var(--splash-bus)' }}>
                            {m.drift >= 0 ? '▲' : '▼'} {Math.abs(m.drift).toFixed(1)}
                          </span>
                        </Td>
                        <Td>
                          <span style={{ color: healthy ? 'var(--splash-tech)' : 'var(--splash-bus)' }}>
                            {healthy ? 'Healthy' : 'Watch'}
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 font-mono text-[0.62rem] leading-relaxed text-[var(--splash-text-faint)]">
              Illustrative monitoring view — signals are derived from the loaded data (adoption,
              fluency, engagement, period-over-period drift), the same shape a production observability
              layer would surface alongside formal eval coverage.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/* ------------------------------- helpers -------------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-mono text-[0.6rem] tracking-[0.14em] uppercase text-[var(--splash-text-faint)] mb-1">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ v: string; l: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[var(--splash-bg)] border border-[var(--splash-line)] rounded-sm px-2.5 py-2 font-mono text-[0.74rem] text-[var(--splash-text)] outline-none focus:border-[var(--splash-tech)]"
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="py-1.5 pr-3 font-normal tracking-[0.08em] uppercase text-[0.62rem]">{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-1.5 pr-3 tabular-nums ${className}`}>{children}</td>;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
function sum(rows: TamRow[], key: 'active_users' | 'eligible_users'): number {
  return rows.reduce((a, r) => a + r[key], 0);
}
function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
function pct(num: number, den: number): number {
  return den ? (num / den) * 100 : 0;
}
function weightedFluency(rows: TamRow[]): number {
  const totalUsers = sum(rows, 'active_users');
  if (!totalUsers) return mean(rows.map((r) => r.fluency_level));
  return rows.reduce((a, r) => a + r.fluency_level * r.active_users, 0) / totalUsers;
}
