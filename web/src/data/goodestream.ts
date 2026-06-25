/**
 * Goode Talent Concepts — shared section metadata.
 *
 * Single source of truth for the demo list so the landing page, the section
 * tab-nav, and the sub-page headers all stay in sync (lego-piece rule: one
 * array, many consumers). Each entry frames the demo as
 * problem → approach → working prototype, matching the page structure.
 */

export type GoodeStreamDemo = {
  /** URL slug under /goodestream/<slug>. */
  slug: 'hr-assist' | 'document-insight' | 'tam';
  /** Short tab label. */
  tab: string;
  /** Full product name. */
  name: string;
  /** One-line capability framing for the landing cards. */
  tagline: string;
  /** The Talent problem this targets, one sentence. */
  problem: string;
  /** Whether the live prototype calls a language model (drives the badge copy). */
  usesModel: boolean;
  /** Mono glyph used on cards + tabs, consistent with the site's glyph language. */
  glyph: string;
};

export const GOODESTREAM_DEMOS: GoodeStreamDemo[] = [
  {
    slug: 'hr-assist',
    tab: 'HR Assist',
    name: 'HR Assist',
    tagline: 'A retrieval-grounded HR support agent that answers only from your policy documents — with citations.',
    problem:
      'HR teams field high volumes of repetitive policy questions where a wrong or invented answer is a compliance and trust risk.',
    usesModel: true,
    glyph: '⌘',
  },
  {
    slug: 'document-insight',
    tab: 'Document Insight',
    name: 'Document Insight',
    tagline:
      'One engine that reviews performance feedback and job descriptions against a rubric and returns concrete, fair rewrites.',
    problem:
      'Managers write inconsistent, sometimes biased feedback, and job descriptions carry exclusionary language and inflated requirements.',
    usesModel: true,
    glyph: '❏',
  },
  {
    slug: 'tam',
    tab: 'Talent Adoption Matrix',
    name: 'Talent Adoption Matrix (TAM)',
    tagline:
      'The measurement layer: adoption, AI fluency, and business outcomes across Talent AI tools — bring your own data.',
    problem:
      'Most HR-AI efforts ship demos and never prove value — adoption stalls, fluency is uneven, and quality drifts unmeasured.',
    usesModel: false,
    glyph: '▦',
  },
];

export function getDemo(slug: GoodeStreamDemo['slug']): GoodeStreamDemo {
  const demo = GOODESTREAM_DEMOS.find((d) => d.slug === slug);
  if (!demo) throw new Error(`Unknown GoodeStream demo: ${slug}`);
  return demo;
}
