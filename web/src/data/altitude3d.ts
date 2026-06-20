/**
 * altitude3d.ts — the three immersive, real-time 3D directions for the SoloLift
 * "Skill Altitude" in-app screen (the technician's competency page rendered as a
 * live WebGL experience). These are in-review directions; pick one to take forward.
 *
 * Published through the Concept Lab under project /p/skill-altitude-v5/.
 * Private-by-unguessable-URL; links EXPIRE 7 days after upload (a 404 later is the TTL).
 */

export interface Direction3D {
  /** Short name of the direction. */
  name: string;
  /** One-line description of the idea. */
  blurb: string;
  /** Live, openable URL for the running experience. */
  url: string;
  /** Optional note (e.g. GPU caveat). */
  note?: string;
}

export const altitude3dGenerated = '2026-06-20';
export const altitude3dProjectUrl =
  'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v5/';

export const altitude3dDirections: Direction3D[] = [
  {
    name: 'Altitude Observatory',
    blurb:
      'Orbit a navy space where your 8 domains rise as luminous data-towers — height is your exact altitude, a gold baseline ring marks the team average, particle updrafts stream off the strong ones. Click a tower to fly in; scrub the timeline to watch them grow.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v5/noble-grove-a802d9/',
  },
  {
    name: 'Holographic Command Deck',
    blurb:
      "You're at the center of a command bridge; a curved arc of 8 holographic domain panels wraps around you — scanline, chromatic and fresnel shaders, projector beams, drifting data motes. Turn to face a panel to focus it, click to expand. Security flickers red as your focus.",
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v5/arctic-signal-44ec53/',
  },
  {
    name: 'Living Skill Field',
    blurb:
      'A real-time GPU simulation of 100k+ particles that flow and settle into the exact 8-domain altitude structure. Drag to perturb the field and watch it re-form; the time scrubber re-targets the simulation so you watch your growth happen.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v5/lucid-orbit-c3869d/',
    note: 'GPU-compute; needs a real GPU. Falls back to a static readout if your device can’t run it.',
  },
];
