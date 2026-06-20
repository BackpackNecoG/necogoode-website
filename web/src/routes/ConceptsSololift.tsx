import { Link } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';
import { NavigationWheel } from '../components/domain/NavigationWheel';
import { altitude3dDirections, altitude3dProjectUrl } from '../data/altitude3d';
import { altitudeScreens, altitudeScreensProjectUrl } from '../data/altitudeScreens';

/**
 * /concepts/sololift.ai — a small, focused gallery for SoloLift's "Skill Altitude" page.
 *
 * The technician's real in-app Skill Altitude page — status across the 8 Microsoft-aligned
 * IT domains plus a recommendation to improve — explored two ways: as immersive real-time
 * 3D, and as ten grounded page-load screens. Each card links out to its live render-origin
 * URL. Reuses the shared splash palette via the 'concepts' scope so it reads as a
 * continuation of the Concept Lab writeup.
 */

/** The private management/upload window for the Concept Lab. */
const MANAGE_CONCEPTS_URL = 'https://func-conceptlab.azurewebsites.net/api/manage';

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
        {/* Intro — plain, non-salesy */}
        <header className="pt-12 md:pt-16 mb-16 max-w-[760px]">
          <div className="font-mono text-[0.72rem] tracking-[0.3em] text-[var(--splash-text-faint)] uppercase mb-5">
            <span className="text-[var(--splash-tech)]">— </span>
            SoloLift · Skill Altitude
          </div>
          <h1
            className="font-serif font-normal leading-[1.05] tracking-[-0.025em] mb-6 text-[var(--splash-text)]"
            style={{ fontSize: 'clamp(2.2rem, 5vw, 3.4rem)' }}
          >
            One page, <em className="italic text-[var(--splash-tech)]">explored two ways.</em>
          </h1>
          <p className="font-serif text-[1.15rem] leading-relaxed text-[var(--splash-text-soft)]">
            Skill Altitude is the technician&apos;s real in-app page: their status across the eight
            Microsoft-aligned IT domains, plus a recommendation for what to improve next. Below are
            two explorations of that one page&mdash;an immersive real-time 3D take, and ten grounded
            page-load screens.
          </p>
        </header>

        {/* IMMERSIVE 3D (3 directions) */}
        <section className="mb-20">
          <div className="font-mono text-[0.7rem] tracking-[0.3em] uppercase text-[var(--splash-text-faint)] mb-6">
            <span className="text-[var(--splash-tech)]">— </span>
            Immersive 3D
          </div>
          <ul className="grid gap-5 list-none p-0 m-0 lg:grid-cols-3">
            {altitude3dDirections.map((d, i) => (
              <li key={d.url} className="flex">
                <article className="flex flex-col h-full w-full border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-5 md:p-6 transition-colors hover:border-[var(--splash-tech)]">
                  <div className="font-mono text-[0.68rem] tracking-[0.2em] text-[var(--splash-text-faint)] mb-3">
                    Direction {String(i + 1).padStart(2, '0')}
                  </div>
                  <h3 className="font-serif font-normal leading-[1.15] tracking-[-0.02em] text-[var(--splash-text)] mb-3 text-[1.3rem]">
                    {d.name}
                  </h3>
                  <p className="font-serif text-[0.95rem] leading-[1.55] text-[var(--splash-text-soft)] mb-5">
                    {d.blurb}
                  </p>
                  <div className="mt-auto">
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 font-mono text-[0.76rem] tracking-[0.1em] uppercase no-underline text-[var(--splash-tech)] transition-opacity hover:opacity-80"
                    >
                      <span>View →</span>
                    </a>
                    {d.note && (
                      <p className="mt-3 font-mono text-[0.7rem] leading-relaxed text-[var(--splash-text-faint)]">
                        {d.note}
                      </p>
                    )}
                  </div>
                </article>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <a
              href={altitude3dProjectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[0.76rem] tracking-[0.12em] uppercase no-underline text-[var(--splash-text-soft)] transition-colors hover:text-[var(--splash-tech)]"
            >
              Open all three →
            </a>
          </div>
        </section>

        {/* PAGE-LOAD SCREENS (10) */}
        <section className="mb-20">
          <div className="font-mono text-[0.7rem] tracking-[0.3em] uppercase text-[var(--splash-text-faint)] mb-6">
            <span className="text-[var(--splash-tech)]">— </span>
            Page-load screens
          </div>
          <ul className="grid gap-5 list-none p-0 m-0 sm:grid-cols-2 lg:grid-cols-2">
            {altitudeScreens.map((s, i) => (
              <li key={s.url} className="flex">
                <article className="flex flex-col h-full w-full border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-5 md:p-6 transition-colors hover:border-[var(--splash-tech)]">
                  <div className="font-mono text-[0.68rem] tracking-[0.2em] text-[var(--splash-text-faint)] mb-3">
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <h3 className="font-serif font-normal leading-[1.15] tracking-[-0.02em] text-[var(--splash-text)] mb-2 text-[1.3rem]">
                    {s.name}
                  </h3>
                  <p className="font-mono text-[0.7rem] italic leading-relaxed text-[var(--splash-text-faint)] mb-3">
                    on load · {s.load}
                  </p>
                  <p className="font-serif text-[0.95rem] leading-[1.55] text-[var(--splash-text-soft)] mb-5">
                    {s.blurb}
                  </p>
                  <div className="mt-auto">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 font-mono text-[0.76rem] tracking-[0.1em] uppercase no-underline text-[var(--splash-tech)] transition-opacity hover:opacity-80"
                    >
                      <span>Open the live screen →</span>
                    </a>
                  </div>
                </article>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <a
              href={altitudeScreensProjectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[0.76rem] tracking-[0.12em] uppercase no-underline text-[var(--splash-text-soft)] transition-colors hover:text-[var(--splash-tech)]"
            >
              Open all ten →
            </a>
          </div>
        </section>

        {/* Honest TTL note */}
        <p className="font-mono text-[0.74rem] leading-relaxed text-[var(--splash-text-faint)] max-w-[680px]">
          <span className="text-[var(--splash-tech)]">note · </span>
          These are private preview links that expire seven days after upload. If a link 404s later,
          that&apos;s the TTL doing its job&mdash;not a bug. Ask and I&apos;ll re-publish a fresh batch.
        </p>

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

        {/* Private management/upload window — discreet */}
        <div className="mt-10 flex items-baseline gap-3">
          <a
            href={MANAGE_CONCEPTS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[0.72rem] tracking-[0.12em] uppercase no-underline text-[var(--splash-text-faint)] transition-colors hover:text-[var(--splash-tech)]"
          >
            Manage concepts →
          </a>
          <span className="font-mono text-[0.68rem] text-[var(--splash-text-faint)] opacity-60">
            sign-in required
          </span>
        </div>
      </main>

      <NavigationWheel active="splash" />
    </div>
  );
}
