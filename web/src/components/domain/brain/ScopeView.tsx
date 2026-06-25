import { useState } from 'react';
import type { ReactNode } from 'react';
import { brainBoard } from '../../../data/brainBoard';
import type { Build, Cap } from '../../../data/brainBoard';
import { BrainImage } from './BrainImage';

/** Cap lookup, derived once from the single source of truth. */
const CAP_BY_ID: Record<string, Cap> = Object.fromEntries(
  brainBoard.caps.map((c) => [c.id, c]),
);

const STATUS_BADGES: Record<
  Build['status'],
  Array<{ label: string; tone: 'live' | 'inv' | 'fab' }>
> = {
  live: [{ label: 'LIVE IN PRODUCTION', tone: 'live' }],
  invite: [
    { label: 'LIVE', tone: 'live' },
    { label: 'INVITE-ONLY', tone: 'inv' },
  ],
  fab: [
    { label: 'IN FABRICATION', tone: 'fab' },
    { label: 'NOT YET PUBLIC', tone: 'fab' },
  ],
};

/**
 * ScopeView — the browser-framed capture panel for a probed build.
 *
 * Left: a fake browser chrome (dots + url bar showing build.url) and a "stage"
 * holding the captured image with numbered annotation pins and region highlight
 * boxes — all DOM overlays positioned from JSON percentage coords (rule 5,
 * never baked into images).
 *
 * Right: a meta column — build head, status badges, VISIT button (disabled /
 * "in fab" when url is null), description, the per-pin row list, and capability
 * chips.
 *
 * Hovering a pin row highlights its region + pin (and vice-versa). Clicking a
 * pin button or a stop row calls onOpenStop(index) so the parent can mount the
 * TourStop. Everything is accented with build.accent.
 */
export function ScopeView({
  build,
  onOpenStop,
}: {
  build: Build;
  /** Open the TourStop for stop `index` (0-based into build.pins). */
  onOpenStop: (index: number) => void;
}) {
  const accent = build.accent;
  const [hot, setHot] = useState<number | null>(null);
  const visitLabel = build.url
    ? `VISIT ${build.url.replace(/^https?:\/\//, '').toUpperCase()} →`
    : 'LINK ARRIVES AT LAUNCH';

  return (
    <div
      className="grid gap-[22px] md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]"
      style={{ ['--accent' as string]: accent.color, ['--accent-glow' as string]: accent.glow }}
    >
      {/* Browser-framed capture */}
      <div
        className="overflow-hidden rounded-[10px] border"
        style={{ background: '#1A1E25', borderColor: '#2A3038' }}
      >
        <div
          className="flex items-center gap-2.5 border-b px-3.5 py-[9px]"
          style={{ background: '#14181E', borderColor: '#232A33' }}
        >
          <div className="flex gap-[5px]">
            <i className="block h-[9px] w-[9px] rounded-full bg-[#39414E]" />
            <i className="block h-[9px] w-[9px] rounded-full bg-[#39414E]" />
            <i className="block h-[9px] w-[9px] rounded-full bg-[#39414E]" />
          </div>
          <div
            className="flex-1 overflow-hidden whitespace-nowrap rounded-[6px] border px-3 py-1 text-[10.5px] tracking-[0.05em] text-[#8FA0B3]"
            style={{ background: '#0E1116', borderColor: '#232A33' }}
          >
            {build.url ?? 'not yet routable — in fabrication'}
          </div>
        </div>

        <div className="relative h-[340px] overflow-hidden">
          <BrainImage image={build.pins[0]?.image} accent={accent} alt={`${build.name} environment`} />

          {/* Region highlight boxes (hot on pin hover) */}
          {build.pins.map((pin, i) =>
            pin.regions.map((r, j) => (
              <div
                key={`reg-${i}-${j}`}
                className="pointer-events-none absolute rounded-[6px] border-[1.5px] border-dashed transition-all duration-200"
                style={{
                  left: `${r.x}%`,
                  top: `${r.y}%`,
                  width: `${r.w}%`,
                  height: `${r.h}%`,
                  borderColor: hot === i ? accent.color : 'transparent',
                  boxShadow: hot === i ? `0 0 0 3px ${accent.glow}` : 'none',
                  background: hot === i ? accent.glow : 'transparent',
                }}
              />
            )),
          )}

          {/* Numbered annotation pins */}
          {build.pins.map((pin, i) => {
            // Pin marker centers on the first region (or center if region-less).
            const r = pin.regions[0];
            const px = r ? r.x + r.w / 2 : 50;
            const py = r ? r.y + r.h / 2 : 50;
            return (
              <button
                key={`pin-${i}`}
                type="button"
                aria-label={`${pin.title} — open tour stop ${i + 1}`}
                onMouseEnter={() => setHot(i)}
                onMouseLeave={() => setHot((h) => (h === i ? null : h))}
                onFocus={() => setHot(i)}
                onBlur={() => setHot((h) => (h === i ? null : h))}
                onClick={() => onOpenStop(i)}
                className="absolute z-[3] flex h-[22px] w-[22px] items-center justify-center rounded-full font-mono text-[11px] font-bold transition-transform"
                style={{
                  left: `calc(${px}% - 11px)`,
                  top: `calc(${py}% - 11px)`,
                  background: accent.color,
                  color: '#10131A',
                  border: '2px solid #10131A',
                  transform: hot === i ? 'scale(1.3)' : 'scale(1)',
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Meta column */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="text-[17px] tracking-[0.06em]" style={{ color: accent.color }}>
          {build.pn} — {build.name}
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_BADGES[build.status].map((b) => (
            <StatusBadge key={b.label} tone={b.tone} accent={accent.color}>
              {b.label}
            </StatusBadge>
          ))}
        </div>

        {build.url ? (
          <a
            href={build.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 self-start rounded-[7px] px-[18px] py-2.5 font-mono text-[12px] font-bold tracking-[0.1em] no-underline transition-transform hover:-translate-y-0.5"
            style={{ background: accent.color, color: '#10131A', boxShadow: `0 6px 18px ${accent.glow}` }}
          >
            {visitLabel}
          </a>
        ) : (
          <span
            className="inline-flex cursor-not-allowed items-center gap-2 self-start rounded-[7px] px-[18px] py-2.5 font-mono text-[12px] font-bold tracking-[0.1em] text-[var(--brain-mute,#5C6470)]"
            style={{ background: '#2A2F38' }}
            aria-disabled="true"
          >
            {visitLabel}
          </span>
        )}

        <p className="text-[12.5px] leading-[1.7] text-[#B9B4AB]">{build.desc}</p>

        {/* Pin rows */}
        <div className="flex flex-col gap-1.5">
          {build.pins.map((pin, i) => {
            const tourOnly = pin.regions.length === 0;
            return (
              <button
                key={`row-${i}`}
                type="button"
                onMouseEnter={() => setHot(i)}
                onMouseLeave={() => setHot((h) => (h === i ? null : h))}
                onFocus={() => setHot(i)}
                onBlur={() => setHot((h) => (h === i ? null : h))}
                onClick={() => onOpenStop(i)}
                className="flex cursor-pointer gap-[11px] rounded-r-[6px] border-l-2 px-2.5 py-2 text-left transition-colors"
                style={{
                  borderLeftColor: hot === i ? accent.color : '#39414E',
                  background: hot === i ? accent.glow : '#12161D',
                }}
              >
                <span
                  className="min-w-[14px] font-mono text-[11px] font-bold"
                  style={{ color: tourOnly ? '#7A8590' : accent.color }}
                >
                  {i + 1}
                </span>
                <span className="font-mono text-[11.5px] leading-[1.55] text-[#9CA4B0]">
                  <b className="mb-0.5 block tracking-[0.06em] text-[var(--brain-silk,#D7D3CA)]">
                    {pin.title}
                  </b>
                  {tourOnly ? 'tour-only stop — no screen, all story. Click to open.' : pin.detail}
                </span>
              </button>
            );
          })}
        </div>

        {/* Capability chips */}
        <div className="flex flex-wrap gap-[7px]">
          {build.caps.map((id) => {
            const cap = CAP_BY_ID[id];
            if (!cap) return null;
            return (
              <span
                key={id}
                className="rounded-[4px] border px-[9px] py-1 font-mono text-[10px] tracking-[0.1em]"
                style={{ borderColor: accent.color, color: accent.color, background: 'rgba(255,255,255,0.03)' }}
              >
                {cap.pn} · {cap.name}
              </span>
            );
          })}
        </div>

        <p className="text-[10px] leading-[1.6] tracking-[0.05em] text-[#4A5160]">
          Environment preview is a real annotated capture of each app; pins and region boxes are
          rendered live from coordinates, not baked into the image.
        </p>
      </div>
    </div>
  );
}

function StatusBadge({
  tone,
  accent,
  children,
}: {
  tone: 'live' | 'inv' | 'fab';
  accent: string;
  children: ReactNode;
}) {
  const tones: Record<string, { bg: string; color: string; border: string }> = {
    live: { bg: '#15301C', color: '#56D364', border: '#2E6B3C' },
    inv: { bg: '#1C2733', color: '#6FB3E0', border: '#2F5A7A' },
    // fab badge picks up the build accent so PIP reads amber/gold.
    fab: { bg: 'rgba(255,255,255,0.04)', color: accent, border: accent },
  };
  const t = tones[tone];
  return (
    <span
      className="inline-block rounded-[4px] px-[9px] py-[3px] text-[9.5px] tracking-[0.14em]"
      style={{ background: t.bg, color: t.color, border: `1px solid ${t.border}` }}
    >
      {children}
    </span>
  );
}

export default ScopeView;
