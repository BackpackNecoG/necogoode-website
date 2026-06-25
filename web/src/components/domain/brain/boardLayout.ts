import { brainBoard, type Build, type Cap, type Role } from '../../../data/brainBoard';
import type { ViewBox } from '../../../lib/useViewBoxTween';

/**
 * boardLayout — pure geometry for the NECO-1 circuit board.
 *
 * The COPY/METRICS live in brainBoard.json (hard rule #1). What lives here is
 * the spatial arrangement that the v5 reference baked into its inline script:
 * chip/cap x-centers, row Y bands, the trace routing, vias and pulse seeds.
 * None of it is content — it is the board's printed-circuit layout, computed
 * once from the data so BrainBoard, ProbeController, and DieShot share a single
 * source of truth for where everything sits.
 *
 * Coordinate space matches v5: a 1040 x 680 viewBox.
 */

export const BOARD_W = 1040;
export const BOARD_H = 680;
export const BOARD_VIEWBOX: ViewBox = [0, 0, BOARD_W, BOARD_H];

export const CHIP_Y = 90;
export const CHIP_H = 100;
export const CHIP_W = 140;
export const CAP_Y = 505;
export const CAP_H = 58;
export const CAP_W = 104;

/** x-centers for the five build chips (U1-U5), in board order. */
const BUILD_CX: Record<string, number> = {
  sololift: 190,
  vwp: 370,
  goodegame: 550,
  site: 730,
  pip: 910,
};

/** x-centers for the six capability-bus controllers (C1-C6). */
const CAP_CX: Record<string, number> = {
  azure: 160,
  ai: 295,
  agents: 430,
  net: 565,
  react: 700,
  auto: 835,
};

/** Top-edge Y for each edge connector (J1/J2). */
const ROLE_Y: Record<string, number> = {
  witherite: 120,
  mckesson: 300,
};

export type CapLayout = Cap & { cx: number; pinCount: number };
export type BuildLayout = Build & { cx: number; pinCount: number };
export type RoleLayout = Role & { y: number };

/** A routed trace from a build chip down to one capability controller. */
export type TraceLayout = {
  /** Stable key, also used to seed the pulse phase. */
  key: string;
  chipId: string;
  capId: string;
  /** SVG path `d` for the orthogonal trace. */
  d: string;
  /** The two via positions along the trace [x,y]. */
  vias: Array<[number, number]>;
  /** x of the trace where it lands on the cap (for the energize flare). */
  capX: number;
  /** Deterministic 0..1 starting phase for the ambient pulse dot. */
  phase: number;
};

export type BoardLayout = {
  builds: BuildLayout[];
  caps: CapLayout[];
  roles: RoleLayout[];
  traces: TraceLayout[];
  /** Lookups. */
  buildById: Record<string, BuildLayout>;
  capById: Record<string, CapLayout>;
};

/** Deterministic pseudo-random in 0..1 from an integer seed — keeps pulse
 *  phases varied without Math.random (stable across renders / SSR). */
function seededPhase(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Build the full board layout from the typed JSON. Pure + deterministic, so it
 * can be computed once with useMemo and shared by every visual stream.
 */
export function computeBoardLayout(): BoardLayout {
  const capById: Record<string, CapLayout> = {};
  const caps: CapLayout[] = brainBoard.caps.map((c) => {
    const cl: CapLayout = { ...c, cx: CAP_CX[c.id] ?? 0, pinCount: 0 };
    capById[c.id] = cl;
    return cl;
  });

  const buildById: Record<string, BuildLayout> = {};
  const builds: BuildLayout[] = brainBoard.builds.map((b) => {
    const bl: BuildLayout = { ...b, cx: BUILD_CX[b.id] ?? 0, pinCount: b.caps.length };
    buildById[b.id] = bl;
    return bl;
  });

  const roles: RoleLayout[] = brainBoard.roles.map((r) => ({ ...r, y: ROLE_Y[r.id] ?? 0 }));

  // Flatten edges (chip -> cap) in board order, exactly like v5.
  const edges: Array<{ chipId: string; capId: string }> = [];
  builds.forEach((b) => b.caps.forEach((capId) => edges.push({ chipId: b.id, capId })));

  // Per-chip / per-cap fan-out counts so traces spread across the chip pins.
  const chipCount: Record<string, number> = {};
  const capCount: Record<string, number> = {};
  edges.forEach((e) => {
    chipCount[e.chipId] = (chipCount[e.chipId] ?? 0) + 1;
    capCount[e.capId] = (capCount[e.capId] ?? 0) + 1;
  });

  const chipIdx: Record<string, number> = {};
  const capIdx: Record<string, number> = {};
  const traces: TraceLayout[] = edges.map((e, k) => {
    const b = buildById[e.chipId];
    const c = capById[e.capId];
    const a = (chipIdx[e.chipId] = (chipIdx[e.chipId] ?? 0) + 1) - 1;
    const n = chipCount[e.chipId];
    const q = (capIdx[e.capId] = (capIdx[e.capId] ?? 0) + 1) - 1;
    const m = capCount[e.capId];
    const x1 = b.cx + (a - (n - 1) / 2) * 18;
    const x2 = c.cx + (q - (m - 1) / 2) * 16;
    const yCh = 222 + k * 13;
    const d = `M ${x1} ${CHIP_Y + CHIP_H} L ${x1} ${yCh} L ${x2} ${yCh} L ${x2} ${CAP_Y}`;
    return {
      key: `${e.chipId}->${e.capId}`,
      chipId: e.chipId,
      capId: e.capId,
      d,
      vias: [
        [x1, yCh],
        [x2, yCh],
      ],
      capX: x2,
      phase: seededPhase(k + 1),
    };
  });

  return { builds, caps, roles, traces, buildById, capById };
}

/**
 * fitBox — frame a region into the board's aspect ratio with padding, returning
 * a viewBox rect. Ports v5's `fitBox`.
 */
export function fitBox(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  pad: number,
): ViewBox {
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const aspect = BOARD_W / BOARD_H;
  let w = maxX - minX;
  let h = maxY - minY;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return [cx - w / 2, cy - h / 2, w, h];
}

/** The viewBox that frames a probed build chip + its capability columns. */
export function probeViewBox(b: BuildLayout, capById: Record<string, CapLayout>): ViewBox {
  const xs = [
    b.cx - 160,
    b.cx + 160,
    ...b.caps.flatMap((id) => {
      const c = capById[id];
      return c ? [c.cx - 75, c.cx + 75] : [];
    }),
  ];
  return fitBox(Math.min(...xs), 45, Math.max(...xs), 600, 28);
}
