import { Link } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';
import { NavigationWheel } from '../components/domain/NavigationWheel';
import { GOODESTREAM_DEMOS, GoodeStreamDemo } from '../data/goodestream';
import {
  GridBackdrop,
  TopNav,
  SectionTabs,
  Footer,
  Kicker,
  PrototypeBadge,
} from '../components/domain/goodestream/Shell';

/**
 * /goodestream — GoodeStream Talent Dashboard landing page.
 *
 * Frames the section ("working prototypes that prove the capability, not just
 * describe it"), then links to each demo. Makes the prototype framing explicit
 * up front: every demo is scoped, guardrailed, and deliberately not exhaustive.
 */
export default function GoodeStream() {
  useRouteScope('goodestream');

  return (
    <div className="min-h-screen overflow-y-auto">
      <GridBackdrop />
      <TopNav />
      <SectionTabs />

      <main className="relative z-10 max-w-[1080px] mx-auto px-6 md:px-10 pb-24">
        {/* Hero */}
        <header className="pt-12 md:pt-16 mb-14 max-w-[860px]">
          <div className="font-mono text-[0.72rem] tracking-[0.3em] text-[var(--splash-text-faint)] uppercase mb-5">
            <span className="text-[var(--splash-tech)]">— </span>
            GoodeStream · Talent Dashboard
          </div>
          <h1
            className="font-serif font-normal leading-[1.05] tracking-[-0.025em] mb-6 text-[var(--splash-text)]"
            style={{ fontSize: 'clamp(2.4rem, 5.5vw, 3.8rem)' }}
          >
            Working prototypes that <em className="italic text-[var(--splash-tech)]">prove</em> the
            capability — not just describe it.
          </h1>
          <p className="font-serif italic text-[1.25rem] leading-relaxed text-[var(--splash-text-soft)] max-w-[640px]">
            Three interactive prototypes for the kind of work a Senior Applied AI Lead, Talent role
            demands. Each one names the problem, shows how I&apos;d target it, and then hands you
            something you can actually use.
          </p>

          {/* Honest framing banner */}
          <div className="mt-8 flex flex-wrap items-center gap-3 border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm px-4 py-3">
            <PrototypeBadge />
            <p className="font-sans text-[0.9rem] leading-relaxed text-[var(--splash-text-soft)] m-0 max-w-[760px]">
              Every demo here is an intentional prototype — scoped, guardrailed, and deliberately not
              comprehensive. They exist to demonstrate the approach, not to be a finished product.
              Two call a language model through a backend; one runs entirely in your browser.
            </p>
          </div>
        </header>

        {/* The three-part promise */}
        <section aria-label="How each demo is structured" className="mb-16">
          <Kicker>The shape of every demo</Kicker>
          <h2 className="font-serif text-[1.6rem] md:text-[1.9rem] leading-tight tracking-[-0.02em] text-[var(--splash-text)] mb-5">
            Problem → approach → a prototype you can drive.
          </h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { n: '01', t: 'Problem Statement', d: 'The Talent problem it targets, and why it matters.' },
              { n: '02', t: "How We'd Target It", d: 'The approach and architecture, in plain language.' },
              { n: '03', t: 'Working Prototype', d: 'A live, interactive component you can drive yourself.' },
            ].map((s) => (
              <div key={s.n} className="border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-5">
                <div className="font-mono text-[0.78rem] text-[var(--splash-tech)] mb-2">{s.n}</div>
                <div className="font-serif text-[1.15rem] text-[var(--splash-text)] mb-1.5">{s.t}</div>
                <p className="font-sans text-[0.88rem] leading-relaxed text-[var(--splash-text-soft)] m-0">{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Demo cards */}
        <section aria-label="Prototypes">
          <Kicker>The prototypes</Kicker>
          <h2 className="font-serif text-[1.6rem] md:text-[1.9rem] leading-tight tracking-[-0.02em] text-[var(--splash-text)] mb-5">
            Three working prototypes.
          </h2>
          <div className="grid md:grid-cols-3 gap-5">
            {GOODESTREAM_DEMOS.map((demo) => (
              <DemoCard key={demo.slug} demo={demo} />
            ))}
          </div>
        </section>

        <Footer />
      </main>

      <NavigationWheel active="goodestream" />
    </div>
  );
}

function DemoCard({ demo }: { demo: GoodeStreamDemo }) {
  return (
    <Link
      to={`/goodestream/${demo.slug}`}
      className="group flex flex-col border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-6 no-underline transition-colors hover:border-[var(--splash-tech)]"
    >
      <div className="flex items-center justify-between mb-4">
        <span
          className="w-10 h-10 rounded-sm flex items-center justify-center font-mono text-[1.1rem]"
          style={{ border: '1px solid var(--splash-tech)', color: 'var(--splash-tech)' }}
          aria-hidden
        >
          {demo.glyph}
        </span>
        <span className="font-mono text-[0.6rem] tracking-[0.18em] uppercase text-[var(--splash-text-faint)]">
          {demo.usesModel ? 'AI · backend' : 'Client-side'}
        </span>
      </div>
      <h3 className="font-serif text-[1.35rem] leading-snug tracking-[-0.01em] text-[var(--splash-text)] mb-2 group-hover:text-[var(--splash-tech)] transition-colors">
        {demo.name}
      </h3>
      <p className="font-sans text-[0.92rem] leading-relaxed text-[var(--splash-text-soft)] mb-5 flex-1">
        {demo.tagline}
      </p>
      <span className="inline-flex items-center gap-2 font-mono text-[0.72rem] tracking-[0.12em] uppercase text-[var(--splash-tech)]">
        Open prototype <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
      </span>
    </Link>
  );
}
