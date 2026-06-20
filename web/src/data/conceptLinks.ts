/**
 * conceptLinks.ts — published Concept Lab links for the SoloLift "Skill Altitude"
 * exploration.
 *
 * Hardcoded from tools/push-concepts.mjs output (CONCEPT_LINKS.md, folder
 * `cobalt-juniper-995e69`, generated 2026-06-20) so the gallery bundles at build
 * time — nothing is fetched at runtime.
 *
 * NOTE: these are private-by-unguessable-URL links that EXPIRE 7 days after
 * upload. A 404 on an individual concept later is the TTL, not a bug.
 */

export interface Concept {
  /** Human-readable concept name. */
  title: string;
  /** Unguessable slug id used in the render-origin URL. */
  id: string;
  /** Live, openable URL for the running concept. */
  url: string;
}

/** One shareable link / QR covering all 20 concepts. */
export const folderUrl: string =
  'https://conceptlabrender.z19.web.core.windows.net/f/cobalt-juniper-995e69/';

/** All 20 published "Skill Altitude" concepts, in upload order. */
export const concepts: Concept[] = [
  {
    title: 'Altitude Terrain — A Mountain Range of Mastery',
    id: 'hollow-tundra-fd7f5e',
    url: 'https://conceptlabrender.z19.web.core.windows.net/hollow-tundra-fd7f5e/',
  },
  {
    title: 'The Climb — Eight Base Camps to the Summit',
    id: 'frosted-fjord-53ffa4',
    url: 'https://conceptlabrender.z19.web.core.windows.net/frosted-fjord-53ffa4/',
  },
  {
    title: 'Living Competency Organism',
    id: 'midnight-juniper-cd5eb4',
    url: 'https://conceptlabrender.z19.web.core.windows.net/midnight-juniper-cd5eb4/',
  },
  {
    title: 'Aurora of Mastery',
    id: 'silent-orbit-dd59e3',
    url: 'https://conceptlabrender.z19.web.core.windows.net/silent-orbit-dd59e3/',
  },
  {
    title: 'Skill Stack — Stack Your Altitude',
    id: 'amber-echo-019c33',
    url: 'https://conceptlabrender.z19.web.core.windows.net/amber-echo-019c33/',
  },
  {
    title: 'Skill Galaxy — Orbits of Mastery',
    id: 'quiet-pylon-71abf3',
    url: 'https://conceptlabrender.z19.web.core.windows.net/quiet-pylon-71abf3/',
  },
  {
    title: 'Skill Constellations',
    id: 'dusty-lattice-500fca',
    url: 'https://conceptlabrender.z19.web.core.windows.net/dusty-lattice-500fca/',
  },
  {
    title: 'Sonar of Skill',
    id: 'solar-quartz-1f32d5',
    url: 'https://conceptlabrender.z19.web.core.windows.net/solar-quartz-1f32d5/',
  },
  {
    title: 'Ascent Rope',
    id: 'hidden-cipher-d56bb3',
    url: 'https://conceptlabrender.z19.web.core.windows.net/hidden-cipher-d56bb3/',
  },
  {
    title: 'Living Rings',
    id: 'electric-island-a0cc50',
    url: 'https://conceptlabrender.z19.web.core.windows.net/electric-island-a0cc50/',
  },
  {
    title: 'Altitude Massif',
    id: 'umber-cipher-f8cf3a',
    url: 'https://conceptlabrender.z19.web.core.windows.net/umber-cipher-f8cf3a/',
  },
  {
    title: 'Mercury Pools',
    id: 'zephyr-helix-4573c7',
    url: 'https://conceptlabrender.z19.web.core.windows.net/zephyr-helix-4573c7/',
  },
  {
    title: 'Canyon of Mastery',
    id: 'umber-fjord-4e568e',
    url: 'https://conceptlabrender.z19.web.core.windows.net/umber-fjord-4e568e/',
  },
  {
    title: 'Altitude Instrument Cluster',
    id: 'dusty-island-49033a',
    url: 'https://conceptlabrender.z19.web.core.windows.net/dusty-island-49033a/',
  },
  {
    title: 'Murmuration of Mastery',
    id: 'jade-tundra-1b711d',
    url: 'https://conceptlabrender.z19.web.core.windows.net/jade-tundra-1b711d/',
  },
  {
    title: 'Altitude Observatory',
    id: 'twilight-ridge-afdbba',
    url: 'https://conceptlabrender.z19.web.core.windows.net/twilight-ridge-afdbba/',
  },
  {
    title: 'Balance of Mastery',
    id: 'azure-pylon-0d3180',
    url: 'https://conceptlabrender.z19.web.core.windows.net/azure-pylon-0d3180/',
  },
  {
    title: 'Growth Rings',
    id: 'silent-current-c2b7a5',
    url: 'https://conceptlabrender.z19.web.core.windows.net/silent-current-c2b7a5/',
  },
  {
    title: 'Elevation Hike — A Trail Through Your Mastery',
    id: 'azure-ridge-67db4f',
    url: 'https://conceptlabrender.z19.web.core.windows.net/azure-ridge-67db4f/',
  },
  {
    title: 'Skill Nebula — Eight Constellations of Craft',
    id: 'crimson-quartz-cd1270',
    url: 'https://conceptlabrender.z19.web.core.windows.net/crimson-quartz-cd1270/',
  },
];
