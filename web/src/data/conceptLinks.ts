/**
 * conceptLinks.ts — published Concept Lab links for the SoloLift "Skill Altitude"
 * exploration.
 *
 * Hardcoded from tools/push-concepts.mjs output, published under the Concept Lab project
 * "Skill Altitude" (URLs use https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/), generated 2026-06-20T05:45:56.994Z.
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
  'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/';

/** Alias — the project index URL (preferred name). */
export const projectUrl: string = folderUrl;

/** All 20 published "Skill Altitude" concepts, in upload order. */
export const concepts: Concept[] = [
  {
    title: 'Summit Ascent — Your Skill Altitude',
    id: 'electric-jetty-ef5803',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/electric-jetty-ef5803/',
  },
  {
    title: 'Orbit of Mastery — Your Skill Altitude',
    id: 'midnight-falcon-8dc0a9',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/midnight-falcon-8dc0a9/',
  },
  {
    title: 'Aurora Atlas — Your Skill Altitude',
    id: 'midnight-island-e61f6f',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/midnight-island-e61f6f/',
  },
  {
    title: 'Self-Portrait in Light — Your Skill Altitude',
    id: 'glossy-island-0f8c14',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/glossy-island-0f8c14/',
  },
  {
    title: 'Fluid Field — The Currents of Your Craft',
    id: 'zephyr-juniper-dd1a4d',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/zephyr-juniper-dd1a4d/',
  },
  {
    title: 'Constellation Voyage — One More Star to Reach',
    id: 'fluid-ember-10931e',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/fluid-ember-10931e/',
  },
  {
    title: 'The Land You\'ve Made — Skill Altitude',
    id: 'humble-pylon-5aa4a1',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/humble-pylon-5aa4a1/',
  },
  {
    title: 'Molten Reserves — Skill Altitude',
    id: 'dusty-current-2e39e6',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/dusty-current-2e39e6/',
  },
  {
    title: 'Skill Altitude — The Weight of What You Know',
    id: 'zephyr-meadow-b06a41',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/zephyr-meadow-b06a41/',
  },
  {
    title: 'Skill Altitude — What You\'ve Crystallized',
    id: 'crimson-tundra-237382',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/crimson-tundra-237382/',
  },
  {
    title: 'Resonance Field — Where You Stand',
    id: 'dusty-lattice-9608d0',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/dusty-lattice-9608d0/',
  },
  {
    title: 'The Living Thing — Your Skill, Breathing',
    id: 'rapid-marble-03d91d',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/rapid-marble-03d91d/',
  },
  {
    title: 'Cathedral of Skill',
    id: 'gentle-harbor-f43c3b',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/gentle-harbor-f43c3b/',
  },
  {
    title: 'Your Aegis',
    id: 'candid-juniper-e0efef',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/candid-juniper-e0efef/',
  },
  {
    title: 'The River of Your Work — Skill Altitude',
    id: 'ivory-keel-31130f',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/ivory-keel-31130f/',
  },
  {
    title: 'Down to the Core — Skill Altitude',
    id: 'opal-willow-cd7bc5',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/opal-willow-cd7bc5/',
  },
  {
    title: 'Through the Prism — Your Skill Altitude',
    id: 'opal-pylon-6daa3b',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/opal-pylon-6daa3b/',
  },
  {
    title: 'What You\'re Becoming — A Living Core',
    id: 'twilight-keel-8c0b2f',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/twilight-keel-8c0b2f/',
  },
  {
    title: 'Reading the Land — Your Skill Altitude',
    id: 'brisk-pylon-477e1c',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/brisk-pylon-477e1c/',
  },
  {
    title: 'Ignition — The Skill Nebula',
    id: 'zephyr-jetty-4f6f2e',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude/zephyr-jetty-4f6f2e/',
  },
];
