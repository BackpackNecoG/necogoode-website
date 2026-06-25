import { Link } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';
import { NavigationWheel } from '../components/domain/NavigationWheel';
import { GOODESTREAM_DEMOS } from '../data/goodestream';

/**
 * /goodestream/story — the "Read the story" overview for Goode Talent Concepts.
 *
 * Reached from the workbench card, so it lives in the workshop (paper) language
 * like the other creation stories. It gives the general overview — how I think
 * about working with Talent departments — and then hands off into the live,
 * interactive prototypes at /goodestream. Intentionally role-agnostic.
 */
export default function GoodeTalentStory() {
  useRouteScope('bus');

  return (
    <div className="min-h-screen" style={{ background: 'var(--bus-wood-deep)' }}>
      {/* Top nav */}
      <nav
        className="px-6 md:px-10 py-5 flex justify-between items-center"
        style={{ background: 'linear-gradient(to bottom, rgba(62,42,20,0.95), rgba(62,42,20,0.7))' }}
      >
        <Link
          to="/"
          className="font-serif text-[var(--bus-paper)] text-[1.05rem] font-semibold no-underline flex items-center gap-2.5"
        >
          <span
            className="w-7 h-7 rounded-sm flex items-center justify-center font-hand text-[1.1rem] shadow-md"
            style={{ background: 'var(--bus-brass-bright)', color: 'var(--bus-wood-deep)', transform: 'rotate(-3deg)' }}
          >
            N
          </span>
          <span>← back to the bench</span>
        </Link>
        <Link
          to="/goodestream"
          className="text-[var(--bus-paper-dark)] hover:text-[var(--bus-brass-bright)] no-underline text-[0.85rem]"
        >
          Open the prototypes →
        </Link>
      </nav>

      {/* Paper sheet */}
      <article
        className="max-w-[760px] mx-auto my-12 p-8 md:p-16 rounded-sm relative"
        style={{
          background: 'var(--bus-paper)',
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent 0px, transparent 32px, rgba(74,58,40,0.08) 32px, rgba(74,58,40,0.08) 33px)',
          boxShadow: '0 1px 0 rgba(255,250,230,0.4) inset, 8px 16px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(74,58,40,0.1)',
        }}
      >
        <div aria-hidden className="absolute -top-3 left-1/2 -translate-x-1/2 w-32 h-6 shadow-sm" style={{ background: 'rgba(220,200,150,0.7)', transform: 'translateX(-50%) rotate(2deg)' }} />

        <div className="font-hand text-[1.4rem] mb-2" style={{ color: 'var(--bus-rust)' }}>
          <span style={{ color: 'var(--bus-green)' }}>✦ </span>
          how I&apos;d work with a Talent team — for real
        </div>

        <h1 className="font-serif text-[2.6rem] md:text-[3.5rem] font-semibold leading-[1] tracking-[-0.025em] text-[var(--bus-ink)] mb-3">
          Goode Talent Concepts
        </h1>

        <div className="mb-8">
          <span
            className="inline-block font-mono text-[0.66rem] tracking-[0.18em] uppercase px-2.5 py-1 rounded-sm"
            style={{ background: 'rgba(74,58,40,0.1)', color: 'var(--bus-ink-soft)' }}
          >
            Built, not pitched
          </span>
        </div>

        {/* Story prose — general, role-agnostic */}
        <p className="font-serif text-[1.15rem] leading-[1.65] text-[var(--bus-ink)] mb-6">
          Start with the work, not the AI. Every Talent team has tasks that run on repeat — the
          policy question asked for the hundredth time, the feedback nobody enjoys writing, the tool
          launch nobody&apos;s tracking. Find the ones that are high-volume or quietly burning people
          out. That&apos;s where this pays for itself. Everywhere else, it&apos;s a toy.
        </p>
        <p className="font-serif text-[1.15rem] leading-[1.65] text-[var(--bus-ink)] mb-6">
          The non-negotiables: answers come from your sources, so they&apos;re auditable, not
          invented. A human signs off on anything that counts. Pieces get reused, not rebuilt. And
          it&apos;s measured from the start — adoption, fluency, outcomes — because a tool you
          can&apos;t measure is a tool you can&apos;t trust.
        </p>
        <p className="font-serif text-[1.15rem] leading-[1.65] text-[var(--bus-ink)] mb-6">
          Talk is cheap, so here&apos;s the work. Three prototypes, three problems Talent teams
          actually have. Each is small and guardrailed on purpose — a demonstration, not a finished
          product — and each is yours to poke at right now.
        </p>

        {/* Pull-quote */}
        <blockquote
          className="my-10 px-8 py-6 font-serif italic text-[1.4rem] leading-tight"
          style={{ color: 'var(--bus-rust)', borderLeft: '4px solid var(--bus-rust)', background: 'rgba(176,90,44,0.06)' }}
        >
          “Most HR-AI efforts ship a demo and never prove value. The measurement layer is the missing
          piece — so I build it in first.”
        </blockquote>

        {/* The three concepts */}
        <h2 className="font-serif text-[1.5rem] font-semibold text-[var(--bus-ink)] mt-10 mb-4">The three concepts</h2>
        <ul className="list-none space-y-4 mb-10">
          {GOODESTREAM_DEMOS.map((d) => (
            <li key={d.slug} className="flex gap-3">
              <span aria-hidden className="font-hand text-[1.3rem] leading-none mt-1" style={{ color: 'var(--bus-green)' }}>
                ✦
              </span>
              <div>
                <div className="font-serif text-[1.2rem] font-semibold text-[var(--bus-ink)]">{d.name}</div>
                <p className="font-serif text-[1.05rem] leading-[1.55] text-[var(--bus-ink-soft)] m-0">{d.tagline}</p>
              </div>
            </li>
          ))}
        </ul>

        {/* CTA into the live section */}
        <hr className="my-10" style={{ borderColor: 'rgba(74,58,40,0.3)' }} />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <Link
              to="/goodestream"
              className="inline-block px-7 py-3.5 text-[0.85rem] tracking-[0.15em] uppercase font-medium no-underline transition-colors"
              style={{ background: 'var(--bus-ink)', color: 'var(--bus-paper)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bus-rust)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bus-ink)')}
            >
              Explore the prototypes →
            </Link>
            <p className="mt-2 font-serif italic text-[0.95rem] text-[var(--bus-ink-soft)]">
              Live and interactive — try them with the bundled samples, no sign-in.
            </p>
          </div>
          <Link to="/" className="text-[var(--bus-rust)] no-underline border-b border-[var(--bus-rust)] text-[0.95rem] font-serif italic">
            ← back to the bench
          </Link>
        </div>
      </article>

      <NavigationWheel active="goodestream" />
    </div>
  );
}
