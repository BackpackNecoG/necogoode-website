/**
 * conceptLinks.ts — published Concept Lab links for the SoloLift "Skill Altitude"
 * exploration.
 *
 * Hardcoded from tools/push-concepts.mjs output (CONCEPT_LINKS.md), published under the
 * Concept Lab project "SoloLift" (URLs use /p/sololift/...), generated 2026-06-20T04:32:07.946Z.
 * Bundles at build time — nothing is fetched at runtime.
 *
 * NOTE: these are private-by-unguessable-URL links that EXPIRE 7 days after upload.
 * A 404 on an individual concept later is the TTL, not a bug.
 */

export interface Concept {
  /** Human-readable concept name. */
  title: string;
  /** Unguessable slug id used in the render-origin URL. */
  id: string;
  /** Live, openable URL for the running concept. */
  url: string;
}

/** One shareable link / QR covering all 20 concepts (the SoloLift project index). */
export const folderUrl: string =
  'https://conceptlabrender.z19.web.core.windows.net/p/sololift/';

/** Alias — the project index URL (preferred name). */
export const projectUrl: string = folderUrl;

/** All 20 published "Skill Altitude" concepts, in upload order. */
export const concepts: Concept[] = [
  {
    title: 'Altitude Terrain — A Mountain Range of Mastery',
    id: 'gentle-juniper-55e378',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/gentle-juniper-55e378/',
  },
  {
    title: 'The Climb — Eight Base Camps to the Summit',
    id: 'molten-keel-bd41b5',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/molten-keel-bd41b5/',
  },
  {
    title: 'Living Competency Organism',
    id: 'glossy-echo-6b83fd',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/glossy-echo-6b83fd/',
  },
  {
    title: 'Aurora of Mastery',
    id: 'feral-willow-3898ac',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/feral-willow-3898ac/',
  },
  {
    title: 'Skill Stack — Stack Your Altitude',
    id: 'scarlet-lattice-aef1ce',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/scarlet-lattice-aef1ce/',
  },
  {
    title: 'Skill Galaxy — Orbits of Mastery',
    id: 'gilded-ridge-d648d4',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/gilded-ridge-d648d4/',
  },
  {
    title: 'Skill Constellations',
    id: 'amber-vector-6ce984',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/amber-vector-6ce984/',
  },
  {
    title: 'Sonar of Skill',
    id: 'lunar-thicket-03c72b',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/lunar-thicket-03c72b/',
  },
  {
    title: 'Ascent Rope',
    id: 'jade-fjord-f3d4ab',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/jade-fjord-f3d4ab/',
  },
  {
    title: 'Living Rings',
    id: 'humble-spire-53ca1d',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/humble-spire-53ca1d/',
  },
  {
    title: 'Altitude Massif',
    id: 'quiet-current-e07ebd',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/quiet-current-e07ebd/',
  },
  {
    title: 'Mercury Pools',
    id: 'solar-grove-21bfed',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/solar-grove-21bfed/',
  },
  {
    title: 'Canyon of Mastery',
    id: 'brisk-island-39c5ad',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/brisk-island-39c5ad/',
  },
  {
    title: 'Altitude Instrument Cluster',
    id: 'gentle-falcon-f96ebf',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/gentle-falcon-f96ebf/',
  },
  {
    title: 'Murmuration of Mastery',
    id: 'humble-pylon-3227dc',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/humble-pylon-3227dc/',
  },
  {
    title: 'Altitude Observatory',
    id: 'velvet-lantern-1478f9',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/velvet-lantern-1478f9/',
  },
  {
    title: 'Balance of Mastery',
    id: 'prism-ember-569cd0',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/prism-ember-569cd0/',
  },
  {
    title: 'Growth Rings',
    id: 'prism-quartz-760a05',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/prism-quartz-760a05/',
  },
  {
    title: 'Elevation Hike — A Trail Through Your Mastery',
    id: 'rapid-ember-63de72',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/rapid-ember-63de72/',
  },
  {
    title: 'Skill Nebula — Eight Constellations of Craft',
    id: 'noble-signal-544c03',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/sololift/noble-signal-544c03/',
  },
];
