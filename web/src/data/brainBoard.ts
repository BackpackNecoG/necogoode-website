/**
 * Typed loader for the /brain "NECO-1" circuit-board build.
 *
 * Single source of truth: ./brainBoard.json. Every downstream stream
 * (BrainBoard, ProbeController, DieShot, ScopeView, TourStop) imports the
 * types and helpers from here rather than redeclaring the data shape.
 *
 * Lego-piece rule: no copy or metrics live in code — only in brainBoard.json.
 */
import boardData from './brainBoard.json';

/** Per-build accent palette (COLOR-VARIATION DIRECTIVE). Every visual stream
 *  must consume build.accent — never hardcode a single board color. */
export type Accent = {
  color: string;
  glow: string;
  name: 'azure' | 'violet' | 'green' | 'teal' | 'amber';
};

/** Annotation region box, in percentages (0-100) against image.viewport. */
export type Region = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PinImageType = 'capture' | 'manual' | 'asset';

export type PinImage = {
  type: PinImageType;
  /** Path on the live app to capture; null for asset (PIP) stops. */
  route: string | null;
  authRequired: boolean;
  /** Target filename under public/brain/. */
  file: string;
  /** Locked capture viewport [width, height]; regions are relative to it. */
  viewport: [number, number];
};

/** Tab 1 "THE BUILD" copy — approved baseline from the v5 reference. */
export type TourCopy = {
  what: string;
  how: string;
  why: string;
  stack: string[];
};

/** Tab 2 "THE STORY" copy — first-person DRAFT. Renders "Story coming soon"
 *  unless storyApproved is true. */
export type StoryCopy = {
  built: string;
  who: string;
  unique: string;
  challenges: string;
  storyApproved: boolean;
};

export type Pin = {
  /** 1-based stop number within its build. */
  n: number;
  title: string;
  detail: string;
  image: PinImage;
  /** Empty for tour-only stops. */
  regions: Region[];
  tour: TourCopy;
  story: StoryCopy;
};

export type BuildStatus = 'live' | 'invite' | 'fab';

export type Build = {
  id: string;
  pn: string;
  name: string;
  status: BuildStatus;
  /** null for PIP (in fabrication, no live UI). */
  url: string | null;
  pkg: string;
  desc: string;
  die: string[];
  /** Capability bus ids this build draws from (Cap.id). */
  caps: string[];
  accent: Accent;
  pins: Pin[];
};

/** Capability bus controller (C1-C6) — neutral copper board base. */
export type Cap = {
  id: string;
  pn: string;
  name: string;
  desc: string;
};

/** Edge-connector power input (J1/J2) — IT-leadership employment only. */
export type Role = {
  id: string;
  pn: string;
  name: string;
  tag: string;
  blurb: string;
};

export type BrainMeta = {
  rev: string;
  intro: string;
};

export type BrainBoard = {
  meta: BrainMeta;
  caps: Cap[];
  roles: Role[];
  builds: Build[];
};

export const brainBoard: BrainBoard = boardData as BrainBoard;

export const builds: Build[] = brainBoard.builds;

/** Look up a build by its id (e.g. "sololift"). */
export function buildById(id: string): Build | undefined {
  return brainBoard.builds.find((b) => b.id === id);
}

/** Flatten every build's pins into a single ordered list of stops,
 *  in board order, pairing each pin with its parent build. */
export function allStops(): Array<{ build: Build; pin: Pin }> {
  return brainBoard.builds.flatMap((build) =>
    build.pins.map((pin) => ({ build, pin })),
  );
}
