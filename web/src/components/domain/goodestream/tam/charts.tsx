/**
 * TAM charts — dependency-free inline-SVG primitives in the splash palette.
 *
 * Hand-rolled (no charting lib) to match the site's existing inline-SVG idiom
 * (see routes/Concepts.tsx, the brain board) and keep the bundle light. Each
 * chart is role="img" with an aria-label summarizing its data for screen
 * readers, and uses theme tokens for all color.
 */

const AXIS = 'var(--splash-text-faint)';
const GRID = 'var(--splash-line)';
const ACCENT = 'var(--splash-tech)';

/** KPI stat tile. */
export function StatTile({
  label,
  value,
  sub,
  tone = 'tech',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'tech' | 'bus' | 'soft';
}) {
  const color = tone === 'tech' ? ACCENT : tone === 'bus' ? 'var(--splash-bus)' : 'var(--splash-text)';
  return (
    <div className="border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-4">
      <div className="font-mono text-[0.62rem] tracking-[0.16em] uppercase text-[var(--splash-text-faint)] mb-1.5">
        {label}
      </div>
      <div className="font-serif text-[1.7rem] leading-none tracking-tight" style={{ color }}>
        {value}
      </div>
      {sub && <div className="mt-1.5 font-mono text-[0.66rem] text-[var(--splash-text-soft)]">{sub}</div>}
    </div>
  );
}

export type LinePoint = { label: string; value: number };

/** Multi-series line chart for trends (adoption %, engagement). */
export function LineChart({
  title,
  series,
  yMax,
  yUnit = '',
  height = 200,
}: {
  title: string;
  series: Array<{ name: string; color: string; points: LinePoint[] }>;
  yMax?: number;
  yUnit?: string;
  height?: number;
}) {
  const W = 560;
  const H = height;
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const max = yMax ?? Math.max(1, ...allValues) * 1.1;
  const n = labels.length;

  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const ariaParts = series.map(
    (s) => `${s.name}: ${s.points.map((p) => `${p.label} ${Math.round(p.value)}${yUnit}`).join(', ')}`,
  );

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));

  return (
    <figure className="m-0">
      <ChartHeader title={title} legend={series.map((s) => ({ name: s.name, color: s.color }))} />
      <div className="border border-[var(--splash-line)] bg-[var(--splash-bg)] rounded-sm p-2 overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title}. ${ariaParts.join('. ')}.`}
          className="w-full min-w-[420px] h-auto font-mono"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill={AXIS}>
                {t}
                {yUnit}
              </text>
            </g>
          ))}
          {labels.map((lab, i) => (
            <text key={lab} x={x(i)} y={H - padB + 16} textAnchor="middle" fontSize="9" fill={AXIS}>
              {lab.replace(/^\d{4}-/, '')}
            </text>
          ))}
          {series.map((s) => {
            const d = s.points
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
              .join(' ');
            return (
              <g key={s.name}>
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                {s.points.map((p, i) => (
                  <circle key={i} cx={x(i)} cy={y(p.value)} r={2.5} fill={s.color} />
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

export type Bar = { label: string; value: number; color?: string };

/** Vertical bar chart for comparisons (engagement by tool, outcomes). */
export function BarChart({
  title,
  bars,
  yUnit = '',
  height = 200,
}: {
  title: string;
  bars: Bar[];
  yUnit?: string;
  height?: number;
}) {
  const W = 560;
  const H = height;
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 44;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(1, ...bars.map((b) => b.value)) * 1.1;
  const n = bars.length;
  const slot = innerW / Math.max(1, n);
  const barW = Math.min(54, slot * 0.6);

  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));

  return (
    <figure className="m-0">
      <ChartHeader title={title} />
      <div className="border border-[var(--splash-line)] bg-[var(--splash-bg)] rounded-sm p-2 overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title}. ${bars.map((b) => `${b.label}: ${Math.round(b.value)}${yUnit}`).join(', ')}.`}
          className="w-full min-w-[420px] h-auto font-mono"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} y1={padT + innerH - (t / max) * innerH} x2={W - padR} y2={padT + innerH - (t / max) * innerH} stroke={GRID} strokeWidth={1} />
              <text x={padL - 6} y={padT + innerH - (t / max) * innerH + 3} textAnchor="end" fontSize="9" fill={AXIS}>
                {t}
                {yUnit}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const h = (b.value / max) * innerH;
            const cx = padL + slot * i + slot / 2;
            return (
              <g key={b.label}>
                <rect x={cx - barW / 2} y={padT + innerH - h} width={barW} height={h} fill={b.color ?? ACCENT} rx={2} />
                <text x={cx} y={padT + innerH - h - 4} textAnchor="middle" fontSize="9" fill="var(--splash-text-soft)">
                  {Math.round(b.value)}
                  {yUnit}
                </text>
                <text x={cx} y={H - padB + 14} textAnchor="middle" fontSize="8.5" fill={AXIS}>
                  {wrapLabel(b.label)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

/** Horizontal distribution bars (fluency distribution). */
export function DistributionBars({
  title,
  items,
  total,
}: {
  title: string;
  items: Array<{ label: string; value: number; color: string }>;
  total: number;
}) {
  return (
    <figure className="m-0">
      <ChartHeader title={title} />
      <div
        className="border border-[var(--splash-line)] bg-[var(--splash-bg)] rounded-sm p-4 space-y-2.5"
        role="img"
        aria-label={`${title}. ${items.map((it) => `${it.label}: ${it.value} users, ${total ? Math.round((it.value / total) * 100) : 0} percent`).join('. ')}.`}
      >
        {items.map((it) => {
          const pct = total ? (it.value / total) * 100 : 0;
          return (
            <div key={it.label}>
              <div className="flex justify-between font-mono text-[0.68rem] mb-1">
                <span className="text-[var(--splash-text-soft)]">{it.label}</span>
                <span className="text-[var(--splash-text-faint)]">
                  {it.value} · {Math.round(pct)}%
                </span>
              </div>
              <div className="h-2.5 rounded-sm bg-[var(--splash-bg-soft)] overflow-hidden">
                <div className="h-full rounded-sm" style={{ width: `${pct}%`, background: it.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

function ChartHeader({ title, legend }: { title: string; legend?: Array<{ name: string; color: string }> }) {
  return (
    <figcaption className="flex items-center justify-between gap-3 mb-2">
      <span className="font-mono text-[0.7rem] tracking-[0.12em] uppercase text-[var(--splash-text-soft)]">{title}</span>
      {legend && (
        <span className="flex gap-3">
          {legend.map((l) => (
            <span key={l.name} className="flex items-center gap-1.5 font-mono text-[0.62rem] text-[var(--splash-text-faint)]">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
        </span>
      )}
    </figcaption>
  );
}

/** Crude two-line wrap for x-axis labels so tool names don't overlap. */
function wrapLabel(label: string): string {
  return label.length > 12 ? label.slice(0, 11) + '…' : label;
}
