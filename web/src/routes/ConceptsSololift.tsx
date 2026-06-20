import { Link } from 'react-router-dom';
import { ReactNode } from 'react';
import { useRouteScope } from '../lib/useRouteScope';
import { NavigationWheel } from '../components/domain/NavigationWheel';
import { concepts, folderUrl } from '../data/conceptLinks';

/**
 * /concepts/sololift.ai — the live gallery the /concepts page links to.
 *
 * A short SoloLift case study (what it is, why it needed a real render stage)
 * followed by a responsive grid of all 20 published "Skill Altitude" concepts,
 * each linking out to its live render-origin URL. Reuses the shared splash
 * palette via the 'concepts' scope so it reads as a continuation of the
 * Concept Lab writeup rather than a new themed room.
 */
export default function ConceptsSololift() {
  useRouteScope('concepts');

  return (
    <div className="min-h-screen overflow-y-auto">
      {/* Subtle grid backdrop, matches the splash + /concepts language */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(94,234,212,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(94,234,212,0.04) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at top, black 20%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse at top, black 20%, transparent 80%)',
        }}
      />

      {/* Top nav */}
      <nav className="relative z-10 px-6 md:px-10 py-5 flex justify-between items-center max-w-[1080px] mx-auto">
        <Link
          to="/"
          className="font-serif text-[1.1rem] font-semibold tracking-tight no-underline text-[var(--splash-text)] flex items-center gap-2.5"
        >
          <span
            className="w-7 h-7 rounded-sm flex items-center justify-center font-mono text-[0.9rem] font-bold"
            style={{ background: 'var(--splash-tech)', color: 'var(--splash-bg)' }}
          >
            N
          </span>
          <span>
            Neco<em className="not-italic italic text-[var(--splash-tech)]">Goode</em>
          </span>
        </Link>
        <div className="flex gap-6 text-[0.78rem] font-mono tracking-wide text-[var(--splash-text-soft)]">
          <Link to="/concepts" className="no-underline text-current hover:text-[var(--splash-tech)]">
            concept lab
          </Link>
          <Link to="/TechTour" className="no-underline text-current hover:text-[var(--splash-tech)]">
            tech tour
          </Link>
        </div>
      </nav>

      <main className="relative z-10 max-w-[1080px] mx-auto px-6 md:px-10 pb-28">
        {/* Hero */}
        <header className="pt-12 md:pt-16 mb-14 max-w-[860px]">
          <div className="font-mono text-[0.72rem] tracking-[0.3em] text-[var(--splash-text-faint)] uppercase mb-5">
            <span className="text-[var(--splash-tech)]">— </span>
            Concept Lab · live gallery · sololift.ai
          </div>
          <h1
            className="font-serif font-normal leading-[1.05] tracking-[-0.025em] mb-6 text-[var(--splash-text)]"
            style={{ fontSize: 'clamp(2.4rem, 5.5vw, 3.8rem)' }}
          >
            Skill Altitude, <em className="italic text-[var(--splash-tech)]">running.</em>
          </h1>
          <p className="font-serif italic text-[1.25rem] leading-relaxed text-[var(--splash-text-soft)] max-w-[640px]">
            Twenty interactive concepts for one SoloLift page&mdash;3D, particles, physics, shaders.
            Not screenshots. Open any of them and it runs in your browser, right now.
          </p>
        </header>

        {/* WHAT SOLOLIFT IS */}
        <Section kicker="01 · The project" title="SoloLift, the worked example">
          <P>
            <strong className="text-[var(--splash-text)] font-medium">SoloLift</strong> is an AI
            help-desk and operations platform for IT teams&mdash;it triages tickets, drafts and
            executes fixes, and turns day-to-day support work into structured, reviewable actions. It
            is the real product the Concept Lab was built to serve: a place where a design idea has to
            survive contact with an actual platform, not just look good in a deck.
          </P>
        </Section>

        {/* WHY IT NEEDED A REAL RENDER STAGE */}
        <Section kicker="02 · Why a live stage" title="Some ideas can only be judged running">
          <P>
            One SoloLift page raised the bar: the per-person{' '}
            <em className="italic text-[var(--splash-text)]">Skill Altitude</em> view. It visualizes a
            single technician&apos;s strengths and weaknesses across the eight Microsoft-aligned IT
            domains, pairs each gap with a Microsoft Learn recommendation, and shows competency growth
            over time.
          </P>
          <P>
            A page like that wants to feel alive&mdash;terrain that rises with mastery, particles that
            swarm into shape, physics you can nudge, shaders that breathe. You cannot evaluate any of
            that as a static mockup, because the whole point is the motion and the interaction. The
            concepts <em className="italic text-[var(--splash-text)]">have to run</em> to be judged.
          </P>
          <P>
            So each concept gets a private URL on an isolated render origin&mdash;a real, live page you
            open, poke at, and share with a client mid-meeting. The twenty below are that exploration:
            twenty genuinely different answers to &ldquo;what should Skill Altitude feel like?&rdquo;
          </P>
        </Section>

        {/* THE TOOL BEHIND THE GALLERY */}
        <figure className="mt-14 max-w-[860px] m-0">
          <img
            src="/concepts/studio-04-upload-result.png"
            alt="The Concept Lab studio after a concept upload: a one-click Copy link button and an auto-generated QR code."
            loading="lazy"
            className="w-full max-w-[760px] h-auto rounded-sm border border-[var(--splash-line)]"
          />
          <figcaption className="mt-3 font-mono text-[0.72rem] leading-relaxed text-[var(--splash-text-faint)] max-w-[760px]">
            This is the tool behind the gallery&mdash;each link below was minted by dropping an HTML
            concept into the studio.{' '}
            <Link to="/concepts" className="text-[var(--splash-tech)] no-underline">
              See how it&apos;s built →
            </Link>
          </figcaption>
        </figure>

        {/* GALLERY */}
        <section className="mt-16">
          <div className="font-mono text-[0.7rem] tracking-[0.25em] uppercase text-[var(--splash-text-faint)] mb-3">
            03 · The gallery
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5 mb-8">
            <h2 className="font-serif text-[1.9rem] md:text-[2.2rem] leading-tight tracking-[-0.02em] text-[var(--splash-text)]">
              All twenty, <em className="italic text-[var(--splash-tech)]">live.</em>
            </h2>
            <a
              href={folderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 font-mono text-[0.78rem] tracking-[0.12em] uppercase no-underline transition-colors flex-shrink-0"
              style={{ background: 'var(--splash-tech)', color: 'var(--splash-bg)' }}
            >
              <span>Open all 20 (folder)</span>
              <span aria-hidden>↗</span>
            </a>
          </div>

          <ul className="grid gap-4 list-none p-0 m-0 sm:grid-cols-2 lg:grid-cols-3">
            {concepts.map((c, i) => (
              <li key={c.id}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col h-full no-underline border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-5 transition-colors hover:border-[var(--splash-tech)]"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-[0.72rem] tracking-[0.2em] text-[var(--splash-text-faint)]">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span
                      aria-hidden
                      className="font-mono text-[0.85rem] text-[var(--splash-text-faint)] transition-colors group-hover:text-[var(--splash-tech)]"
                    >
                      ↗
                    </span>
                  </div>
                  <h3 className="font-serif text-[1.18rem] leading-snug tracking-[-0.01em] text-[var(--splash-text)] mb-3">
                    {c.title}
                  </h3>
                  <span className="mt-auto font-mono text-[0.7rem] tracking-[0.12em] uppercase text-[var(--splash-text-soft)] transition-colors group-hover:text-[var(--splash-tech)]">
                    open live →
                  </span>
                </a>
              </li>
            ))}
          </ul>

          {/* Honest TTL note */}
          <p className="mt-8 font-mono text-[0.74rem] leading-relaxed text-[var(--splash-text-faint)] max-w-[680px]">
            <span className="text-[var(--splash-tech)]">note · </span>
            These are private preview links that expire seven days after upload. If a card 404s later,
            that&apos;s the TTL doing its job&mdash;not a bug. Ask and I&apos;ll re-publish a fresh batch.
          </p>
        </section>

        {/* Footer nav */}
        <div className="mt-16 pt-8 border-t border-[var(--splash-line)] flex flex-col sm:flex-row gap-4 justify-between font-mono text-[0.8rem] text-[var(--splash-text-soft)]">
          <Link to="/concepts" className="no-underline text-current hover:text-[var(--splash-tech)]">
            ← back to the concept lab
          </Link>
          <div className="flex gap-6">
            <Link to="/" className="no-underline text-current hover:text-[var(--splash-tech)]">
              the door →
            </Link>
            <Link to="/TechTour" className="no-underline text-current hover:text-[var(--splash-tech)]">
              technical tour →
            </Link>
          </div>
        </div>
      </main>

      <NavigationWheel active="splash" />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Small presentational helpers, in the splash visual language
 * (mirrors the ones in Concepts.tsx).
 * ---------------------------------------------------------------- */
function Section({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="mt-16 max-w-[860px]">
      <div className="font-mono text-[0.7rem] tracking-[0.25em] uppercase text-[var(--splash-text-faint)] mb-3">
        {kicker}
      </div>
      <h2 className="font-serif text-[1.9rem] md:text-[2.2rem] leading-tight tracking-[-0.02em] text-[var(--splash-text)] mb-5">
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return (
    <p className="font-serif text-[1.12rem] leading-[1.7] text-[var(--splash-text-soft)] mb-5 max-w-[680px]">
      {children}
    </p>
  );
}
