/**
 * altitudeCinematics.ts — ten cinematic "awakening" intros for the SoloLift "Skill
 * Altitude" screen. Each is a ≥10-second wordless story: a person reaches for / touches
 * something that leads them to self-awareness, then it resolves into the real, legible
 * in-app Skill Altitude stats page (their status across the 8 Microsoft-aligned IT
 * domains + a recommendation to improve). Each has a "Skip intro" control.
 *
 * Published through the Concept Lab under project /p/skill-altitude-v7/.
 * Private-by-unguessable-URL; links EXPIRE 7 days after upload (a 404 later is the TTL).
 */

export interface AltitudeCinematic {
  name: string;
  /** the wordless story that plays before the stats land */
  story: string;
  url: string;
}

export const altitudeCinematicsGenerated = '2026-06-20';
export const altitudeCinematicsProjectUrl =
  'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v7/';

export const altitudeCinematics: AltitudeCinematic[] = [
  {
    name: 'The Console',
    story: 'First-person: your hands rise and press a waking altar; light floods up your arms and crystallizes inward — and settles into your stats.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v7/ivory-cipher-c8d456/',
  },
  {
    name: 'The Threshold',
    story: 'A silhouette walks a long corridor to a door of light, touches it, and steps through into the bloom of their own competencies.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v7/humble-cipher-b0017a/',
  },
  {
    name: 'The Meditation',
    story: 'A figure of light sits; palms meet; energy rises through them point by point and releases into the eight domains.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v7/candid-horizon-d98044/',
  },
  {
    name: 'The Dive',
    story: 'A wireframe figure touches a sea of data and dives in; rewritten by what they know, they surface transformed and glowing.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v7/amber-cipher-aa5c96/',
  },
  {
    name: 'The Ascent',
    story: 'A climber touches a waypoint on each landing of an endless stair to a dawn summit — then sees their whole landscape laid out below.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v7/dusty-pylon-9388a9/',
  },
  {
    name: 'The Palm',
    story: 'First-person: your palm presses a scanner; the scan leaps to a mirrored self and writes your competencies across it.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v7/prism-juniper-e30d3f/',
  },
  {
    name: 'The Shedding',
    story: 'A marble statue cracks with gold; the shell shatters and falls away; the luminous, self-aware figure within steps free.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v7/electric-thicket-966e3a/',
  },
  {
    name: 'The Thread',
    story: 'A figure reaches up, grasps a single thread of light, and pulls — it unravels into a woven tapestry of everything they know.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v7/feral-tundra-42f13e/',
  },
  {
    name: 'The Awakening',
    story: 'First-person: out of darkness your eyes open; a blurred world racks slowly into focus and clarity — that is you.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v7/hollow-mesa-143fe3/',
  },
  {
    name: 'The Reflection',
    story: 'A figure kneels and touches a still pool; the ripples re-form their reflection, revealing the structure within.',
    url: 'https://conceptlabrender.z19.web.core.windows.net/p/skill-altitude-v7/velvet-tundra-916ace/',
  },
];
