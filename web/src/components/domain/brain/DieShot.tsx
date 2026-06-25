import { useEffect, useState } from 'react';
import type { BuildLayout } from './boardLayout';
import { BOARD_W, CHIP_Y } from './boardLayout';

/**
 * DieShot — the die-shot callout drawn beside a probed build chip.
 *
 * Renders inside the board <svg> (SVG-native), as an <g>. Title reads
 * "DIE SHOT — <pn> <name>"; the build's `die` labels lay out in a 2-column
 * grid of blocks that reveal with a staggered opacity ramp (or instantly under
 * reduced motion). A dashed leader line connects the chip to the callout.
 *
 * Everything is tinted with build.accent — never a hardcoded board color — per
 * the color-variation directive.
 */

const DIE_W = 252;
const DIE_H = 158;
const DIE_Y = 56;
const BLOCK_W = 108;
const BLOCK_H = 44;

type DieShotProps = {
  build: BuildLayout;
  reduced: boolean;
};

export default function DieShot({ build, reduced }: DieShotProps) {
  const accent = build.accent.color;
  const glow = build.accent.glow;

  // Place the callout to the right of left-half chips, left of right-half ones,
  // clamped inside the board — ported from v5 buildDie().
  const toRight = build.cx < BOARD_W / 2;
  const rawDx = toRight ? build.cx + 90 : build.cx - 90 - DIE_W;
  const dx = Math.max(110, Math.min(BOARD_W - DIE_W - 24, rawDx));

  const leaderX1 = build.cx + (toRight ? 70 : -70);
  const leaderX2 = toRight ? dx : dx + DIE_W;

  // Staggered reveal — frame visible, then each block fades in.
  const [frameOn, setFrameOn] = useState(reduced);
  const [shownBlocks, setShownBlocks] = useState<number>(reduced ? build.die.length : 0);

  useEffect(() => {
    if (reduced) {
      setFrameOn(true);
      setShownBlocks(build.die.length);
      return;
    }
    setFrameOn(false);
    setShownBlocks(0);
    const timers: number[] = [];
    timers.push(window.setTimeout(() => setFrameOn(true), 350));
    build.die.forEach((_, i) => {
      timers.push(window.setTimeout(() => setShownBlocks((n) => Math.max(n, i + 1)), 500 + i * 130));
    });
    return () => timers.forEach((t) => clearTimeout(t));
    // Re-run when the probed build changes (new die set + cx).
  }, [build.id, build.die, reduced]);

  return (
    <g
      className="pointer-events-none"
      style={{
        opacity: frameOn ? 1 : 0,
        transition: reduced ? undefined : 'opacity .4s',
      }}
      aria-hidden
    >
      <line
        x1={leaderX1}
        y1={CHIP_Y + 30}
        x2={leaderX2}
        y2={DIE_Y + 30}
        stroke={accent}
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <rect
        x={dx}
        y={DIE_Y}
        width={DIE_W}
        height={DIE_H}
        rx={7}
        fill="#10131A"
        stroke={accent}
        strokeWidth={1.2}
        style={{ filter: `drop-shadow(0 0 10px ${glow})` }}
      />
      <text
        x={dx + 14}
        y={DIE_Y + 24}
        fill={accent}
        fontSize={10}
        letterSpacing="0.14em"
        style={{ fontFamily: 'var(--brain-mono, monospace)' }}
      >
        {`DIE SHOT — ${build.pn} ${build.name}`}
      </text>
      {build.die.map((label, i) => {
        const bx = dx + 14 + (i % 2) * 116;
        const by = DIE_Y + 40 + Math.floor(i / 2) * 54;
        const visible = i < shownBlocks;
        return (
          <g
            key={label}
            style={{
              opacity: visible ? 1 : 0,
              transition: reduced ? undefined : 'opacity .35s',
            }}
          >
            <rect
              x={bx}
              y={by}
              width={BLOCK_W}
              height={BLOCK_H}
              rx={4}
              fill="#1C212B"
              stroke={accent}
              strokeOpacity={0.55}
              strokeWidth={1}
            />
            <text
              x={bx + BLOCK_W / 2}
              y={by + 26}
              fill="var(--brain-silk, #D7D3CA)"
              fontSize={8.5}
              letterSpacing="0.06em"
              textAnchor="middle"
              style={{ fontFamily: 'var(--brain-mono, monospace)' }}
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}
