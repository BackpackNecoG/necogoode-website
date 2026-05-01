/**
 * Single source of truth for the five creations.
 * Both TechTour and BusTour pages read from this file.
 *
 * Copy is factually-accurate placeholder per the spec — Neco will refine post-launch.
 */

export type CreationStatus = 'live' | 'in-production' | 'strategic';

export type StackChip = string;

export type ArchitectureDecision = {
  title: string;
  body: string;
};

export type CreationMetric = {
  label: string;
  value: string;
  trend: 'up' | 'flat' | 'down' | 'in-progress';
};

export type Creation = {
  slug: string;
  ticker: string;
  name: string;
  status: CreationStatus;

  /** TechTour content — for engineers */
  tech: {
    tagline: string;
    summary: string;
    stack: StackChip[];
    decisions: ArchitectureDecision[];
    repo?: string;
  };

  /** BusTour content — for non-technical readers */
  bus: {
    tagline: string;
    story: string;
    why: string;
    forWhom: string;
  };

  liveUrl?: string;
  demoUrl?: string;
  metrics?: CreationMetric[];
};

export const creations: Creation[] = [
  {
    slug: 'goodegame',
    ticker: 'GDGM',
    name: 'GoodeGame',
    status: 'live',
    tech: {
      tagline: 'Invitation-only golf community with member dossiers and an interactive globe.',
      summary:
        'GoodeGame is a private community platform for golfers. Members track rounds played at courses worldwide, build dossiers of their playing history, and journal each round with photos. The interactive globe surfaces every course visited as a persistent map of the community\'s shared experience.\n\nThe stack is a .NET 10 API behind a React + TypeScript front end, backed by Postgres on Azure. Auth gates access to the community — every account is invited, never self-signed. The globe is a custom WebGL component layered over course-coordinate data, with optimistic-UI lights that persist across sessions.\n\nBuilt for a small, deeply-engaged user base where social proof matters more than scale. Everything is opinionated: who can join, what gets logged, how the visual identity reads.',
      stack: ['.NET 10', 'React', 'TypeScript', 'Postgres', 'Azure', 'WebGL'],
      decisions: [
        {
          title: 'Invitation-only by default',
          body: 'No public signup. Auth pipeline assumes every user was added by an existing member. This shapes everything from the auth model to moderation tooling — features assume trust, so we do not need heavy spam or abuse-detection scaffolding.',
        },
        {
          title: 'Globe state persists per-session',
          body: 'Round-light state is stored server-side keyed by member, not in client localStorage. A member opening the globe on a new device sees their full history immediately. Tradeoff: every globe load triggers a fetch — mitigated with HTTP caching and a static fallback for cold starts.',
        },
        {
          title: 'Postgres over a NoSQL store',
          body: 'Rounds, members, and courses are all relational with predictable join shapes. Postgres on Azure Database for PostgreSQL Flexible Server gives us ACID, point-in-time restore, and the operational maturity we wanted from day one. JSON columns handle the photo-journal payloads.',
        },
      ],
    },
    bus: {
      tagline: 'A small, private golf community where every round is part of a shared story.',
      story:
        'GoodeGame started with a question: what if a golf community felt less like a leaderboard and more like a yearbook?\n\nIt is invitation-only. You only get in because someone already inside vouched for you. Once you are in, every round you play is something you can write about, photograph, and share with the rest of the community. There is an interactive globe that lights up every course anyone has ever played, growing brighter the more the community plays it.\n\nIt is the kind of place a serious golfer wants to belong to — not because it is exclusive for the sake of being exclusive, but because the whole point is that the people inside actually know each other.',
      why: 'Most online golf communities optimize for scale. GoodeGame optimizes for shared memory. The members are the product — not the data they generate.',
      forWhom: 'Serious golfers who want a digital home for their playing history that is private, social, and beautifully built.',
    },
    liveUrl: 'https://goodegame.com',
    demoUrl: '/demo/goodegame',
    metrics: [
      { label: 'Status', value: 'Live', trend: 'up' },
      { label: 'Activity', value: '18 commits / wk', trend: 'up' },
    ],
  },

  {
    slug: 'sololift',
    ticker: 'SLIFT',
    name: 'SoloLift',
    status: 'live',
    tech: {
      tagline: 'Production multi-tenant SaaS with real users and an active feedback loop.',
      summary:
        'SoloLift is a production SaaS application running on Azure App Service with real, paying users. The architecture is multi-tenant from the ground up — tenants are isolated logically by tenant ID with shared infrastructure for cost efficiency.\n\nThe stack is .NET on the API + portal side (single-origin to keep CORS simple), with Azure OpenAI handling LLM workloads and Postgres holding application state. Operational maturity is the differentiator: idempotent deploy scripts, AOAI key rotation runbooks, sandbox-vs-prod isolation, and a live observability story.\n\nSoloLift is the proof that I can ship and operate, not just build. The product itself targets the "remove technical knowledge from compliance setup" problem — a domain where every shortcut breaks for someone, so the engineering discipline gets exercised constantly.',
      stack: ['.NET', 'React', 'TypeScript', 'Postgres', 'Azure App Service', 'Azure OpenAI', 'Multi-tenant'],
      decisions: [
        {
          title: 'Single-origin API + portal',
          body: 'API and the customer-facing portal ship from the same App Service. No CORS, no preflight churn, simpler auth cookie scoping. Tradeoff: deploys are atomic — we cannot ship API changes without portal also re-deploying — which is fine at our scale and forces backwards-compatibility discipline.',
        },
        {
          title: 'Azure OpenAI in a separate region',
          body: 'AOAI lives in East US 2 (best model availability) while the App Service lives in Central US. Cross-region latency adds ~30-60ms per LLM call. We accept this for model access — production latency is dominated by LLM time-on-token, not network.',
        },
        {
          title: 'Sandbox tear-down via PowerShell',
          body: 'A scripted sandbox-cleanup script (-Execute flag) tears down dev resources idempotently. Run nightly to reset spend. The same script structure deploys prod via -SkipBuild for fast hotfixes.',
        },
      ],
    },
    bus: {
      tagline: 'A real product, with real customers, that solves a real problem.',
      story:
        'SoloLift is the proof that the work ships. Real users. Real feedback. Real operational concerns — spend, latency, reliability, support, billing.\n\nIt is a SaaS that takes a domain where compliance and IT tasks usually require deep technical knowledge, and makes them runnable by the operator who knows the business but not the systems. Every feature gets shaped by what an actual user got stuck on yesterday.\n\nThis is the creation that taught me the hardest lesson: shipping is the easy part. Operating is the work.',
      why: 'I needed proof — for myself and for the people who hire me — that I can take an idea from "wouldn\'t it be cool if" all the way to "the customer just paid for it." Most engineers have not done that. SoloLift is the receipt.',
      forWhom: 'IT operators and small-business owners who need compliance work done correctly without becoming a part-time Azure admin.',
    },
    liveUrl: 'https://sololift.ai',
    demoUrl: '/demo/sololift',
    metrics: [
      { label: 'Status', value: 'Live', trend: 'up' },
      { label: 'Growth', value: '14.2% MoM', trend: 'up' },
    ],
  },

  {
    slug: 'vibing-with-primitive-ai',
    ticker: 'VWPA',
    name: 'VibingWithPrimitiveAI',
    status: 'live',
    tech: {
      tagline: 'Public-facing AI platform with a distinctive primitive-driven UX pattern.',
      summary:
        'VibingWithPrimitiveAI is the public face of the PrimitiveAI brand. It demonstrates an alternative interaction model for AI products: instead of a chat box, the primary UI is a navigation wheel where each spoke is a "primitive" — a focused, single-purpose AI capability the user can dial up.\n\nUnder the hood it is a .NET API + React front end on Azure, with a thin orchestration layer routing requests to the right model and prompt template per primitive. The wheel is a custom React component with keyboard navigation, accessibility annotations, and a backstop chat fallback for tasks that do not fit a primitive.\n\nThe v2 ship is recent. The site demonstrates the brand thesis: AI products should compose primitive operations the same way a developer composes functions — discoverable, focused, named.',
      stack: ['.NET', 'React', 'TypeScript', 'Azure', 'Custom UX components'],
      decisions: [
        {
          title: 'Wheel-first, chat-fallback',
          body: 'The default interface is the navigation wheel; chat is reachable but secondary. This is a deliberate bet that a more structured UI surfaces more of the model capabilities than a freeform prompt box does — even though it is harder to build and onboard.',
        },
        {
          title: 'Primitives as first-class objects',
          body: 'Each primitive has its own prompt template, model selection, output schema, and accessibility metadata. They are versioned independently. The platform-level orchestrator routes by primitive ID, never by free-text intent.',
        },
        {
          title: 'Static first-load, hydrated wheel',
          body: 'The marketing pages are statically pre-rendered for SEO. The wheel itself hydrates client-side and never blocks initial paint. Lighthouse scores stay green even as the wheel grows in complexity.',
        },
      ],
    },
    bus: {
      tagline: 'AI that feels less like a chat window and more like an instrument you play.',
      story:
        'Most AI products give you a blank text box and hope you know what to ask. VibingWithPrimitiveAI does the opposite: it shows you a wheel of capabilities — primitives — that each do one thing very well.\n\nDial up the right primitive for the moment. Compose them like a musician layering loops. The interface is the product philosophy: AI works best when the human and the model both know what game they are playing.\n\nIt is the public-facing site for the PrimitiveAI brand, and it is alive — v2 just shipped.',
      why: 'Chat is a great fallback, but it is a terrible default. I built VWPA to demonstrate that there are entire categories of AI products waiting on better interfaces.',
      forWhom: 'Anyone tired of staring at a blinking cursor wondering what to type, and the partners who agree there is a better way.',
    },
    liveUrl: 'https://vibingwithprimitiveai.com',
    demoUrl: '/demo/vibing-with-primitive-ai',
    metrics: [
      { label: 'Status', value: 'Live · v2', trend: 'up' },
      { label: 'Uptime', value: '99.8%', trend: 'flat' },
    ],
  },

  {
    slug: 'byte-sized-adventures',
    ticker: 'BSA',
    name: 'Byte-Sized Adventures',
    status: 'in-production',
    tech: {
      tagline: 'Animated educational series for children with a custom character pipeline.',
      summary:
        'Byte-Sized Adventures is an animated educational series in production. The technical scope spans LoRA training for character consistency, an animation pipeline that goes from script to rendered scenes, and a delivery story for episodes.\n\nThe characters are modeled on my own family — meaning the LoRA training has to hit a high consistency bar across many scenes, lighting conditions, and emotional registers. Episode 1 is rendering now; the family-character LoRAs are in their fourth training run.\n\nAs a technical project this is the one that pushes the most into ML / generative video territory. The interesting engineering work is on the pipeline side: how do you turn a script into a queue of generation tasks, then assemble the results without a human bottleneck on every frame?',
      stack: ['LoRA training', 'Generative video', 'Custom render pipeline', 'Python', 'ML ops'],
      decisions: [
        {
          title: 'Family characters as the LoRA baseline',
          body: 'Training on my own family pushes the consistency bar much higher than generic characters would, because I (and viewers who know us) will catch any drift instantly. This is intentional — it is a forcing-function for a more rigorous training process.',
        },
        {
          title: 'Pipeline is the product',
          body: 'The competitive moat is not any single episode — it is the pipeline that produces episodes consistently and cheaply. Every component is built so a future episode is faster and cheaper than the last.',
        },
      ],
    },
    bus: {
      tagline: 'An animated educational series, with characters that look like my own family.',
      story:
        'Byte-Sized Adventures is an animated series for kids — short, funny, educational, and built around characters modeled on my own family.\n\nIt is in production right now. Episode 1 is rendering as I write this. The characters are not generic — they look like the people I love most in the world, which means the technology that makes them has to be very, very good. Every shot has to feel like the same person across every scene.\n\nIt is the most personal of the five creations. It is also a bet on what the next decade of generative video can do for storytelling at the family-creator scale.',
      why: 'Because my kids deserve a show that looks like them, and because I want to prove that one person with the right tools can make something that used to take a studio.',
      forWhom: 'Kids who want to see characters that look like the people in their life — and parents who want screen time that teaches.',
    },
    demoUrl: '/demo/byte-sized-adventures',
    metrics: [
      { label: 'Status', value: 'EP1 rendering', trend: 'in-progress' },
      { label: 'LoRA run', value: '#4 training', trend: 'in-progress' },
    ],
  },

  {
    slug: 'pip',
    ticker: 'PIP',
    name: 'Primitive Infrastructure Protocol',
    status: 'strategic',
    tech: {
      tagline: 'A hosted, metered, AI-native service bus for pre-verified primitives.',
      summary:
        'PIP — Primitive Infrastructure Protocol — is the strategic / patent-stage creation. It is a hosted service that delivers pre-verified primitives as live, metered API calls. Think: AWS Lambda for atomic AI-native operations, with provenance and verification baked into every call.\n\nThe long-term thesis is that as AI agents proliferate, they need a trusted layer of pre-verified primitives to compose against — not raw model calls, not hand-rolled tools, but a service bus where each operation has known properties, audit logs, and SLA. PIP is the bet on owning that layer.\n\nCurrent state: 13 patent concepts written, 5 flagged as urgent (top severity score). Active filing pipeline. Not yet shippable as a product — the IP work is the substrate.',
      stack: ['Patent strategy', 'AI-native infrastructure', 'Service-bus architecture', 'Metering + provenance'],
      decisions: [
        {
          title: 'IP first, product second',
          body: 'For a moat-class creation, the patent estate has to land before the product launches publicly. We are deliberately slow on the product side and aggressive on the filing side. Sequence matters here.',
        },
        {
          title: 'Primitives must be pre-verified',
          body: 'The differentiator vs. raw model calls or rolling-your-own tool layer is that every PIP primitive is verified for properties stated in its contract — type, side-effect, idempotency, audit envelope. This is what makes it composable for agents at scale.',
        },
      ],
    },
    bus: {
      tagline: 'The long-term moat. The infrastructure AI agents will compose against.',
      story:
        'PIP is the patient one.\n\nIt is not a website you can visit yet. It is a strategic bet on what the AI ecosystem needs in order for agents to actually run businesses, not just write essays. The bet is that there will be a layer of pre-verified, metered primitives that agents call into — the same way every web app today calls into a payments processor or a database — and that whoever owns that layer wins.\n\nThe work right now is patents and protocol design. Thirteen concepts written. Five urgent. The product comes after the IP lands.',
      why: 'Every other creation in this portfolio is something I ship today. PIP is the one I am building so that the version of me ten years from now still has something to ship.',
      forWhom: 'Investors and partners who care about long-arc moats, not the next quarter.',
    },
    demoUrl: '/demo/pip',
    metrics: [
      { label: 'Patents', value: '13 concepts', trend: 'in-progress' },
      { label: 'Urgent', value: '5 / 5 score', trend: 'in-progress' },
    ],
  },
];

/** Lookup helper — case-insensitive on slug. */
export function getCreationBySlug(slug: string): Creation | undefined {
  const target = slug.toLowerCase();
  return creations.find((c) => c.slug === target);
}

/** Lookup helper — case-insensitive on ticker. */
export function getCreationByTicker(ticker: string): Creation | undefined {
  const target = ticker.toUpperCase();
  return creations.find((c) => c.ticker === target);
}
