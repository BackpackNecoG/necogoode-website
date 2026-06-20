/**
 * altitudeScreens.ts — ten directions for the SoloLift "Skill Altitude" in-app screen,
 * each a grounded (non-space) theme with a signature PAGE-LOAD animation and clear,
 * legible data. The technician's real competency page (status across the 8 Microsoft-
 * aligned IT domains + a recommendation to improve), reimagined ten ways.
 *
 * Published through the Concept Lab under project /p/skill-altitude-v6/.
 * Private-by-unguessable-URL; links EXPIRE 7 days after upload (a 404 later is the TTL).
 */

export interface AltitudeScreen {
  name: string;
  /** the entrance the page performs on load */
  load: string;
  blurb: string;
  url: string;
}

export const altitudeScreensGenerated = '2026-06-20';
export const altitudeScreensProjectUrl =
  'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v6/';

export const altitudeScreens: AltitudeScreen[] = [
  {
    name: 'Blueprint City',
    load: 'the grid draws, then buildings construct upward floor-by-floor',
    blurb: 'Your 8 domains are buildings in a navy/gold skyline — height is your exact altitude, a baseline line runs across the city, the weakest tower flagged.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v6/crimson-marble-36ef4f/',
  },
  {
    name: 'Living Terrain',
    load: 'gold contour lines ink across a flat map, then the land rises into 3D relief',
    blurb: 'A topographic relief map where ground elevation is your altitude; a sea-level plane marks the team baseline, Security sits as the low basin.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v6/quiet-delta-969076/',
  },
  {
    name: 'Liquid Vials',
    load: 'gold liquid pours into each glass vial and settles with a ripple',
    blurb: 'A lab rack of 8 glass vials; the liquid level is your altitude, an etched line marks the baseline. Tactile, material, exact.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v6/velvet-loft-56d8ae/',
  },
  {
    name: 'Greenhouse',
    load: 'seeds drop, stalks spring up, leaves unfurl',
    blurb: 'Eight plants in a planter grow to your altitude against a trellis baseline — Security wilts below it as the one to nurture next.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v6/amber-cipher-17952d/',
  },
  {
    name: 'Instrument Panel',
    load: 'a power-on self-test: every needle sweeps up and settles',
    blurb: 'A tactile analog panel — a master altimeter and 8 gauges, needle angle = altitude, Security red-lined. Crisp and immediately readable.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v6/vivid-inlet-ed7311/',
  },
  {
    name: 'Split-Flap Board',
    load: 'the departures-board cascade flips every cell into place',
    blurb: 'A train-station split-flap board — names, bars and big flap digits clack into place row by row. As legible as data gets, with a great entrance.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v6/prism-nebula-9be784/',
  },
  {
    name: 'Physics Stack',
    load: 'blocks rain down and stack with real physics',
    blurb: 'Eight columns of blocks settle to your altitude against a baseline shelf; drag to topple and they rebuild. Weighty and tactile.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v6/solar-pylon-df195a/',
  },
  {
    name: 'Woven Loom',
    load: 'the loom weaves itself, ribbon by ribbon',
    blurb: 'Eight gold-and-cream ribbons woven on a navy loom; ribbon length is your altitude, a weft thread marks the baseline. Textile, elegant.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v6/lunar-koi-778fcb/',
  },
  {
    name: 'Light Meter',
    load: 'a calibration surge — bars overshoot, then settle',
    blurb: 'A studio VU/equalizer of 8 glowing channels; segment height is your altitude, baseline tick bright, Security glowing warm-red. Modern, punchy.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v6/electric-keel-385f5d/',
  },
  {
    name: 'Origami Fold',
    load: 'a flat printed sheet creases and folds itself up into standing forms',
    blurb: 'The data prints on a navy sheet that folds into 8 standing paper forms; fold height = altitude, a crease marks the baseline. Crafty, surprising.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v6/lunar-lattice-3b4520/',
  },
];
