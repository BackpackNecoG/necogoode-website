import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';

/**
 * NavigationWheel — PrimitiveAI-inspired floating wheel for cross-page navigation.
 *
 * Sits in the bottom-right corner of every non-Splash route. Closed state is a
 * compact "N" pin; clicking opens a circular layout of 7 spokes pointing to the
 * top-level destinations: home (Splash), TechTour, Console, Brain, GoodeStream,
 * Floor, and BusTour (Workshop).
 *
 * The active page's spoke is highlighted; clicking it just closes the wheel.
 *
 * Why a wheel instead of a navbar: it's the brand's signature interaction
 * (VibingWithPrimitiveAI's whole UX is built on this primitive). Putting one
 * on every page reinforces the brand without being a banner ad for it.
 */

export type WheelScope = 'splash' | 'tech' | 'bus' | 'floor' | 'console' | 'brain' | 'goodestream';

type Spoke = {
  scope: WheelScope;
  label: string;
  to: string;
  glyph: string;
  /** Position around the wheel in degrees, 0 = top, clockwise. */
  angleDeg: number;
};

// Seven destinations evenly spaced around the wheel (360 / 7 ≈ 51.43° apart).
const SPOKES: Spoke[] = [
  { scope: 'splash',      label: 'Door',       to: '/',            glyph: '⌂',  angleDeg: 0 },
  { scope: 'tech',        label: 'Tech',       to: '/TechTour',    glyph: '{}', angleDeg: 51.43 },
  { scope: 'console',     label: 'Console',    to: '/console',     glyph: '▸_', angleDeg: 102.86 },
  { scope: 'brain',       label: 'Brain',      to: '/brain',       glyph: '⊡',  angleDeg: 154.29 },
  { scope: 'goodestream', label: 'GoodeStream', to: '/goodestream', glyph: '◆',  angleDeg: 205.71 },
  { scope: 'floor',       label: 'Floor',      to: '/floor',       glyph: '$',  angleDeg: 257.14 },
  { scope: 'bus',         label: 'Workshop',   to: '/BusTour',     glyph: '✎',  angleDeg: 308.57 },
];

const RADIUS_PX = 92;

export function NavigationWheel({ active }: { active: WheelScope }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <div
      className="fixed bottom-6 right-6 z-[60] select-none"
      style={{ width: open ? RADIUS_PX * 2 + 56 : 56, height: open ? RADIUS_PX * 2 + 56 : 56 }}
    >
      {open && (
        <div
          aria-hidden
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at center, rgba(232,160,74,0.18), rgba(0,0,0,0.0) 70%)',
          }}
        />
      )}

      {/* Spokes — only rendered when open, positioned absolutely around the hub. */}
      {open &&
        SPOKES.map((s) => {
          const rad = (s.angleDeg - 90) * (Math.PI / 180); // -90 because 0deg should be 12 o'clock
          const x = RADIUS_PX + Math.cos(rad) * RADIUS_PX;
          const y = RADIUS_PX + Math.sin(rad) * RADIUS_PX;
          const isActive = s.scope === active || pathname === s.to;
          return (
            <Spoke key={s.scope} spoke={s} x={x} y={y} active={isActive} onSelect={() => setOpen(false)} />
          );
        })}

      {/* Hub — always visible, toggles open/closed */}
      <button
        type="button"
        aria-label={open ? 'Close navigation wheel' : 'Open navigation wheel'}
        onClick={() => setOpen((o) => !o)}
        className="absolute rounded-full flex items-center justify-center font-mono font-semibold text-base transition-all"
        style={{
          right: open ? RADIUS_PX - 28 + 28 : 0,
          bottom: open ? RADIUS_PX - 28 + 28 : 0,
          width: 56,
          height: 56,
          background: open ? 'rgba(20, 18, 28, 0.92)' : 'rgba(20, 18, 28, 0.85)',
          border: '1px solid rgba(232, 160, 74, 0.45)',
          color: '#FFC577',
          boxShadow:
            open
              ? '0 0 0 4px rgba(232,160,74,0.10), 0 8px 24px rgba(0,0,0,0.5), 0 0 24px rgba(232,160,74,0.25)'
              : '0 6px 18px rgba(0,0,0,0.5), 0 0 12px rgba(232,160,74,0.15)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <span className="leading-none">{open ? '×' : 'N'}</span>
      </button>

      {/* Subtle active-page label under hub when collapsed */}
      {!open && (
        <span
          className="absolute font-mono uppercase tracking-[0.2em] text-[0.55rem] whitespace-nowrap"
          style={{
            right: 0,
            bottom: -16,
            color: 'rgba(255, 197, 119, 0.75)',
            textShadow: '0 1px 2px rgba(0,0,0,0.6)',
            width: 56,
            textAlign: 'center',
          }}
        >
          {active}
        </span>
      )}
    </div>
  );
}

function Spoke({
  spoke,
  x,
  y,
  active,
  onSelect,
}: {
  spoke: Spoke;
  x: number;
  y: number;
  active: boolean;
  onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <Link
      to={spoke.to}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className="absolute rounded-full flex items-center justify-center font-mono text-[0.78rem] transition-transform"
      style={{
        left: x - 22,
        top: y - 22,
        width: 44,
        height: 44,
        background: active ? '#FFC577' : 'rgba(20, 18, 28, 0.92)',
        color: active ? '#14121C' : '#E8DEC8',
        border: active ? '1px solid #FFC577' : '1px solid rgba(232, 160, 74, 0.35)',
        boxShadow: hover || active
          ? '0 0 0 3px rgba(232,160,74,0.18), 0 4px 12px rgba(0,0,0,0.4)'
          : '0 4px 12px rgba(0,0,0,0.35)',
        transform: hover ? 'scale(1.12)' : 'scale(1)',
        textDecoration: 'none',
      }}
      aria-label={spoke.label}
      aria-current={active ? 'page' : undefined}
    >
      <span className="leading-none">{spoke.glyph}</span>

      {/* Hover label, positioned outward from the wheel */}
      {hover && (
        <span
          className="absolute font-mono uppercase tracking-[0.2em] text-[0.6rem] whitespace-nowrap pointer-events-none"
          style={{
            // Place the label on the OUTSIDE of the wheel relative to the spoke's angle
            top: y > RADIUS_PX ? '100%' : 'auto',
            bottom: y > RADIUS_PX ? 'auto' : '100%',
            left: '50%',
            transform: 'translate(-50%, ' + (y > RADIUS_PX ? '8px' : '-8px') + ')',
            color: '#FFC577',
            background: 'rgba(20, 18, 28, 0.92)',
            padding: '2px 8px',
            border: '1px solid rgba(232,160,74,0.35)',
            borderRadius: 3,
          }}
        >
          {spoke.label}
        </span>
      )}
    </Link>
  );
}
