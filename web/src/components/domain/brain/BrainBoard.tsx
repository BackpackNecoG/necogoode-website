import { useCallback, useEffect, useMemo, useRef } from 'react';
import { brainBoard } from '../../../data/brainBoard';
import { useReducedMotion } from '../../../lib/useReducedMotion';
import { useViewBoxTween, viewBoxString } from '../../../lib/useViewBoxTween';
import {
  BOARD_VIEWBOX,
  BOARD_W,
  BOARD_H,
  CHIP_Y,
  CHIP_H,
  CHIP_W,
  CAP_Y,
  CAP_H,
  CAP_W,
  computeBoardLayout,
  probeViewBox,
  type BuildLayout,
  type CapLayout,
  type RoleLayout,
} from './boardLayout';
import { energizeDelay, ENERGIZE_DURATION, useProbe } from './ProbeController';
import DieShot from './DieShot';

/**
 * BrainBoard — the NECO-1 circuit board, rendered as a single responsive SVG.
 *
 * Clicking a build chip (U1-U5) probes it: the viewBox tweens to frame the chip,
 * non-selected chips/decorations fade, the chip's traces energize IN ITS ACCENT
 * COLOR, their cap LEDs light, and the DieShot callout mounts. Clicking empty
 * board (or pressing ESC) releases. The neutral capability bus (C1-C6) and edge
 * connectors (J1/J2) stay copper/silk so each build's accent pops.
 *
 * The parent route owns the ScopeView/TourStop UI (Stream B) — BrainBoard just
 * fires onProbe(buildId) / onRelease so the parent can mount it.
 *
 * All copy/metrics come from brainBoard.json via the typed loader. No content
 * is invented here; only geometry (boardLayout) and accent colors are applied.
 */

const NEUTRAL_COPPER = '#A8642F';
const NEUTRAL_COPPER_LIT = '#F2B23E';
const SILK = '#D7D3CA';
const MUTE = '#5C6470';

export type BrainBoardProps = {
  /** Fired when a build chip is probed. Parent mounts the ScopeView for it. */
  onProbe?: (buildId: string) => void;
  /** Fired when the probe is released back to the idle board. */
  onRelease?: () => void;
  /**
   * Optional controlled probe target. When provided, the board probes/releases
   * to match it (e.g. so a parent pin list can drive the board). Uncontrolled
   * if omitted — the board manages its own probe state from clicks/ESC.
   */
  activeBuildId?: string | null;
  /** Accessible label for the board <svg>. */
  ariaLabel?: string;
};

export default function BrainBoard({
  onProbe,
  onRelease,
  activeBuildId,
  ariaLabel = "Circuit board of Neco Goode's personal builds. Click a chip to probe it and preview its environment.",
}: BrainBoardProps) {
  const reduced = useReducedMotion();
  const layout = useMemo(() => computeBoardLayout(), []);
  const { viewBox, animateTo } = useViewBoxTween(BOARD_VIEWBOX, reduced);

  const { probedId, focusedKeys, energizedKeys, litCapIds, probe, release } = useProbe({
    layout,
    reduced,
    onProbe,
    onRelease,
  });

  // Drive the viewBox tween off probe state.
  useEffect(() => {
    if (probedId) {
      const b = layout.buildById[probedId];
      if (b) animateTo(probeViewBox(b, layout.capById), reduced ? 0 : 750);
    } else {
      animateTo(BOARD_VIEWBOX, reduced ? 0 : 650);
    }
  }, [probedId, layout, animateTo, reduced]);

  // Controlled mode: sync internal probe to the activeBuildId prop.
  useEffect(() => {
    if (activeBuildId === undefined) return; // uncontrolled
    if (activeBuildId && activeBuildId !== probedId) probe(activeBuildId);
    else if (!activeBuildId && probedId) release();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBuildId]);

  // ESC releases.
  useEffect(() => {
    if (!probedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') release();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [probedId, release]);

  const probedBuild: BuildLayout | null = probedId ? layout.buildById[probedId] ?? null : null;
  const focusedSet = useMemo(() => new Set(focusedKeys), [focusedKeys]);
  const energizedSet = useMemo(() => new Set(energizedKeys), [energizedKeys]);
  const litCapSet = useMemo(() => new Set(litCapIds), [litCapIds]);

  // Index of each focused trace, for the energize transition-delay cascade.
  const focusedIndex = useMemo(() => {
    const m = new Map<string, number>();
    focusedKeys.forEach((k, i) => m.set(k, i));
    return m;
  }, [focusedKeys]);

  // ---- Ambient pulse dots (rAF) ----------------------------------------
  const pulseRefs = useRef<Record<string, SVGCircleElement | null>>({});
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});
  const phases = useRef<Record<string, number>>({});
  useEffect(() => {
    layout.traces.forEach((t) => {
      if (phases.current[t.key] === undefined) phases.current[t.key] = t.phase;
    });
  }, [layout]);

  useEffect(() => {
    if (reduced) {
      // Park dots at their seed position, no animation.
      layout.traces.forEach((t) => {
        const path = pathRefs.current[t.key];
        const dot = pulseRefs.current[t.key];
        if (!path || !dot) return;
        const len = path.getTotalLength();
        const pt = path.getPointAtLength((phases.current[t.key] ?? 0) * len);
        dot.setAttribute('cx', String(pt.x));
        dot.setAttribute('cy', String(pt.y));
        const active = !probedId || focusedSet.has(t.key);
        dot.setAttribute('opacity', active ? '0.9' : '0');
      });
      return;
    }
    let raf = 0;
    const tick = () => {
      layout.traces.forEach((t) => {
        const path = pathRefs.current[t.key];
        const dot = pulseRefs.current[t.key];
        if (!path || !dot) return;
        const active = !probedId || focusedSet.has(t.key);
        const speed = probedId && active ? 0.005 : 0.0028;
        const next = ((phases.current[t.key] ?? 0) + speed) % 1;
        phases.current[t.key] = next;
        const len = path.getTotalLength();
        const pt = path.getPointAtLength(next * len);
        dot.setAttribute('cx', String(pt.x));
        dot.setAttribute('cy', String(pt.y));
        dot.setAttribute('opacity', active ? '0.9' : '0');
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout, reduced, probedId, focusedSet]);

  const handleBoardClick = useCallback(() => {
    if (probedId) release();
  }, [probedId, release]);

  // Static dot grid — computed once.
  const gridDots = useMemo(() => {
    const dots: JSX.Element[] = [];
    for (let x = 120; x <= 1000; x += 40)
      for (let y = 40; y <= 640; y += 40)
        dots.push(<circle key={`g${x}-${y}`} cx={x} cy={y} r={1} fill="#1C2129" />);
    return dots;
  }, []);

  return (
    <div className="relative w-full" style={{ ['--brain-silk' as string]: SILK }}>
      <svg
        viewBox={viewBoxString(viewBox)}
        role="img"
        aria-label={ariaLabel}
        onClick={handleBoardClick}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        {/* Board substrate */}
        <rect x={14} y={14} width={BOARD_W - 28} height={BOARD_H - 28} rx={14} fill="var(--brain-board, #13161B)" />
        <rect
          x={14}
          y={14}
          width={BOARD_W - 28}
          height={BOARD_H - 28}
          rx={14}
          fill="none"
          stroke="#232A33"
          strokeWidth={1.5}
        />

        {/* Dot grid (deco, fades on probe) */}
        <g opacity={probedId ? 0.15 : 1} style={{ transition: reduced ? undefined : 'opacity .4s' }}>
          {gridDots}
        </g>

        {/* Corner vias + silkscreen (deco) */}
        <g opacity={probedId ? 0.15 : 1} style={{ transition: reduced ? undefined : 'opacity .4s' }}>
          {[
            [1000, 40],
            [1000, 640],
            [40, 640],
          ].map(([cx, cy]) => (
            <circle key={`cv${cx}-${cy}`} cx={cx} cy={cy} r={9} fill="#0C0E11" stroke={NEUTRAL_COPPER} strokeWidth={2} />
          ))}
          <Silk x={120} y={656}>
            PRIMITIVEAI LABS · NECO-1 · ASSEMBLED IN DFW, TX · ALL PARTS DESIGNED + SHIPPED BY ONE ENGINEER
          </Silk>
          <Silk x={120} y={46}>
            U1–U5: PERSONAL BUILDS
          </Silk>
          <Silk x={120} y={492}>
            C1–C6: CAPABILITY BUS
          </Silk>
          <Silk x={30} y={100}>
            PWR IN
          </Silk>
        </g>

        {/* Power rail feeding the bus (deco) */}
        <g opacity={probedId ? 0.15 : 1} style={{ transition: reduced ? undefined : 'opacity .4s' }}>
          <path
            d={
              'M 62 185 H 96 V 624 H 880 M 62 365 H 96 ' +
              layout.caps.map((c) => `M ${c.cx} 624 V ${CAP_Y + CAP_H}`).join(' ')
            }
            fill="none"
            stroke="#5C4528"
            strokeWidth={4}
            opacity={0.9}
          />
          <Silk x={110} y={618}>
            PWR RAIL — EXPERIENCE FEEDS THE BUS
          </Silk>
        </g>

        {/* Edge connectors J1/J2 (neutral; fade on probe) */}
        <g>
          {layout.roles.map((role) => (
            <Connector key={role.id} role={role} faded={!!probedId} reduced={reduced} />
          ))}
        </g>

        {/* Traces */}
        <g>
          {layout.traces.map((t) => {
            const focused = focusedSet.has(t.key);
            const energized = energizedSet.has(t.key);
            const dim = !!probedId && !focused;
            const accent = layout.buildById[t.chipId]?.accent.color ?? NEUTRAL_COPPER;
            const i = focusedIndex.get(t.key) ?? 0;
            // Energizing traces draw in accent via dashoffset fill.
            const dashStyle =
              focused && !reduced
                ? {
                    strokeDasharray: 1200,
                    strokeDashoffset: energized ? 0 : 1200,
                    transition: `stroke-dashoffset ${ENERGIZE_DURATION}ms ease-in-out ${energizeDelay(i)}ms`,
                  }
                : {};
            return (
              <path
                key={t.key}
                ref={(el) => (pathRefs.current[t.key] = el)}
                d={t.d}
                fill="none"
                stroke={focused ? accent : NEUTRAL_COPPER}
                strokeWidth={focused && energized ? 2.5 : 2}
                opacity={dim ? 0.05 : focused ? 1 : 0.75}
                style={{ transition: reduced ? undefined : 'opacity .4s, stroke .3s', ...dashStyle }}
              />
            );
          })}
        </g>

        {/* Vias */}
        <g>
          {layout.traces.flatMap((t) =>
            t.vias.map(([vx, vy], j) => {
              const dim = !!probedId && !focusedSet.has(t.key);
              return (
                <circle
                  key={`${t.key}-via${j}`}
                  cx={vx}
                  cy={vy}
                  r={3}
                  fill="#0C0E11"
                  stroke={NEUTRAL_COPPER}
                  strokeWidth={1.4}
                  opacity={dim ? 0.08 : 1}
                  style={{ transition: reduced ? undefined : 'opacity .4s' }}
                />
              );
            }),
          )}
        </g>

        {/* Ambient pulse dots (positions set imperatively via rAF) */}
        <g>
          {layout.traces.map((t) => {
            const accent = layout.buildById[t.chipId]?.accent.color ?? NEUTRAL_COPPER_LIT;
            const focused = focusedSet.has(t.key);
            return (
              <circle
                key={`${t.key}-pulse`}
                ref={(el) => (pulseRefs.current[t.key] = el)}
                r={2.6}
                fill={focused ? accent : NEUTRAL_COPPER_LIT}
                opacity={0}
              />
            );
          })}
        </g>

        {/* Capability controllers C1-C6 (neutral copper base) */}
        <g>
          {layout.caps.map((c) => (
            <CapNode key={c.id} cap={c} faded={!!probedId && !litCapSet.has(c.id)} lit={litCapSet.has(c.id)} reduced={reduced} />
          ))}
        </g>

        {/* Build chips U1-U5 (each carries its own accent) */}
        <g>
          {layout.builds.map((b) => (
            <BuildChip
              key={b.id}
              build={b}
              selected={probedId === b.id}
              faded={!!probedId && probedId !== b.id}
              reduced={reduced}
              onProbe={(id) => probe(id)}
            />
          ))}
        </g>

        {/* Die-shot callout for the probed build */}
        {probedBuild && <DieShot build={probedBuild} reduced={reduced} />}
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function Silk({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <text x={x} y={y} fill={MUTE} fontSize={9.5} letterSpacing="0.14em" style={{ fontFamily: 'var(--brain-mono, monospace)' }}>
      {children}
    </text>
  );
}

function BuildChip({
  build,
  selected,
  faded,
  reduced,
  onProbe,
}: {
  build: BuildLayout;
  selected: boolean;
  faded: boolean;
  reduced: boolean;
  onProbe: (id: string) => void;
}) {
  const accent = build.accent.color;
  const statusText =
    build.status === 'fab' ? '◌ IN FAB' : build.status === 'invite' ? '● LIVE · INVITE-ONLY' : '● LIVE';
  const statusColor = build.status === 'fab' ? build.accent.color : '#56D364';

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Probe ${build.pn} ${build.name}`}
      aria-pressed={selected}
      style={{ cursor: 'pointer', opacity: faded ? 0.12 : 1, transition: reduced ? undefined : 'opacity .4s', pointerEvents: faded ? 'none' : 'auto' }}
      onClick={(e) => {
        e.stopPropagation();
        onProbe(build.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onProbe(build.id);
        }
      }}
    >
      <rect
        x={build.cx - CHIP_W / 2}
        y={CHIP_Y}
        width={CHIP_W}
        height={CHIP_H}
        rx={6}
        fill="#1A1E25"
        stroke={selected ? accent : '#2A3038'}
        strokeWidth={selected ? 1.5 : 1}
        style={{
          transition: reduced ? undefined : 'stroke .3s',
          filter: selected ? `drop-shadow(0 0 8px ${build.accent.glow})` : undefined,
        }}
      />
      {/* Bottom pins */}
      {Array.from({ length: build.pinCount }).map((_, i) => {
        const px = build.cx + (i - (build.pinCount - 1) / 2) * 18;
        return <rect key={i} x={px - 3} y={CHIP_Y + CHIP_H} width={6} height={8} fill="#3A4250" />;
      })}
      {/* Status LED in accent */}
      <circle cx={build.cx - CHIP_W / 2 + 14} cy={CHIP_Y + 14} r={4} fill={accent} />
      <text x={build.cx} y={CHIP_Y + 46} fill={SILK} fontSize={12} letterSpacing="0.08em" textAnchor="middle" style={{ fontFamily: 'var(--brain-mono, monospace)', pointerEvents: 'none' }}>
        {build.name}
      </text>
      <text x={build.cx} y={CHIP_Y + 64} fill={MUTE} fontSize={9.5} textAnchor="middle" style={{ fontFamily: 'var(--brain-mono, monospace)', pointerEvents: 'none' }}>
        {`${build.pn} · PERSONAL BUILD`}
      </text>
      <text x={build.cx} y={CHIP_Y + 84} fill={statusColor} fontSize={8.5} letterSpacing="0.12em" textAnchor="middle" style={{ fontFamily: 'var(--brain-mono, monospace)', pointerEvents: 'none' }}>
        {statusText}
      </text>
    </g>
  );
}

function CapNode({ cap, faded, lit, reduced }: { cap: CapLayout; faded: boolean; lit: boolean; reduced: boolean }) {
  return (
    <g style={{ opacity: faded ? 0.12 : 1, transition: reduced ? undefined : 'opacity .4s', pointerEvents: 'none' }}>
      <rect x={cap.cx - CAP_W / 2} y={CAP_Y} width={CAP_W} height={CAP_H} rx={5} fill="#1A1E25" stroke="#2A3038" strokeWidth={1} />
      {Array.from({ length: cap.pinCount }).map((_, i) => {
        const px = cap.cx + (i - (cap.pinCount - 1) / 2) * 16;
        return <rect key={i} x={px - 3} y={CAP_Y - 8} width={6} height={8} fill="#3A4250" />;
      })}
      <circle
        cx={cap.cx - CAP_W / 2 + 12}
        cy={CAP_Y + 12}
        r={3.5}
        fill={lit ? NEUTRAL_COPPER_LIT : '#3A4250'}
        style={{ transition: reduced ? undefined : 'fill .25s' }}
      />
      <text x={cap.cx} y={CAP_Y + 30} fill={SILK} fontSize={12} letterSpacing="0.08em" textAnchor="middle" style={{ fontFamily: 'var(--brain-mono, monospace)' }}>
        {cap.name}
      </text>
      <text x={cap.cx} y={CAP_Y + 47} fill={MUTE} fontSize={9.5} textAnchor="middle" style={{ fontFamily: 'var(--brain-mono, monospace)' }}>
        {`${cap.pn} · CTRL`}
      </text>
    </g>
  );
}

function Connector({ role, faded, reduced }: { role: RoleLayout; faded: boolean; reduced: boolean }) {
  return (
    <g style={{ opacity: faded ? 0.12 : 1, transition: reduced ? undefined : 'opacity .4s', pointerEvents: 'none' }}>
      <rect x={26} y={role.y} width={36} height={130} rx={4} fill="#161A20" stroke="#2A3038" strokeWidth={1} />
      {Array.from({ length: 6 }).map((_, i) => (
        <rect key={i} x={56} y={role.y + 12 + i * 19} width={7} height={10} fill="#C8A24A" />
      ))}
      <circle cx={44} cy={role.y + 14} r={3.5} fill="#35C9B0" />
      <text x={70} y={role.y + 60} fill={MUTE} fontSize={9.5} letterSpacing="0.12em" style={{ fontFamily: 'var(--brain-mono, monospace)' }}>
        {role.pn}
      </text>
      <text x={26} y={role.y - 8} fill={MUTE} fontSize={9.5} letterSpacing="0.12em" style={{ fontFamily: 'var(--brain-mono, monospace)' }}>
        {`${role.name} · ${role.tag}`}
      </text>
    </g>
  );
}

/** Re-export the board rev/intro for any parent that wants the header copy. */
export const brainMeta = brainBoard.meta;
