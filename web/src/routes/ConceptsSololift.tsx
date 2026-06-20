import { Link } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';
import { NavigationWheel } from '../components/domain/NavigationWheel';
import { concepts, projectUrl } from '../data/conceptLinks';
import { altitude3dDirections, altitude3dProjectUrl } from '../data/altitude3d';
import { altitudeScreens, altitudeScreensProjectUrl } from '../data/altitudeScreens';
import { altitudeCinematics, altitudeCinematicsProjectUrl } from '../data/altitudeCinematics';
import { altitudeAwakening, altitudeAwakeningProjectUrl } from '../data/altitudeAwakening';

/**
 * /concepts/sololift.ai — the live gallery the /concepts page links to.
 *
 * A short SoloLift case study (what the Skill Altitude page is, why it can only
 * be judged running) followed by a responsive grid of 20 published cinematic,
 * scroll-driven "Skill Altitude" concepts, each linking out to its live
 * render-origin URL. Reuses the shared splash palette via the 'concepts' scope
 * so it reads as a continuation of the Concept Lab writeup rather than a new
 * themed room.
 */

/** Earlier, first-pass exploration of the same page in a different visual language. */
const EARLIER_EXPLORATIONS_URL =
  'https://conceptlabrender.z19.web.core.windows.net/p/sololift/';
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
        {/* Hero — the chosen direction, in five depictions */}
        <header className="pt-12 md:pt-16 mb-12 max-w-[880px]">
          <div className="font-mono text-[0.72rem] tracking-[0.3em] text-[var(--splash-text-faint)] uppercase mb-5">
            <span className="text-[var(--splash-tech)]">— </span>
            Skill Altitude · the chosen direction · in review
          </div>
          <h1
            className="font-serif font-normal leading-[1.05] tracking-[-0.025em] mb-6 text-[var(--splash-text)]"
            style={{ fontSize: 'clamp(2.4rem, 5.5vw, 3.8rem)' }}
          >
            One ascent,{' '}
            <em className="italic text-[var(--splash-tech)]">in five depictions.</em>
          </h1>
          <p className="font-serif italic text-[1.25rem] leading-relaxed text-[var(--splash-text-soft)] max-w-[680px]">
            Refined from the picked &ldquo;Meditation&rdquo; cinematic, this is the chosen
            direction&mdash;one concept, told five ways. A technician at their computer resolves a
            ticket; a checkmark pops; and at that moment energy rises from the PC up through their
            body and releases into their eight competency domains, resolving into the real, legible
            Skill Altitude stats page. Each runs ~11&ndash;13 seconds and carries a
            &ldquo;Skip intro&rdquo; control.
          </p>
        </header>

        {/* THE FIVE — the headline */}
        <section className="mb-24">
          <ul className="grid gap-6 list-none p-0 m-0 sm:grid-cols-2 lg:grid-cols-3">
            {altitudeAwakening.map((a, i) => (
              <li key={a.url} className="flex">
                <article className="flex flex-col h-full w-full border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-7 md:p-8 transition-colors hover:border-[var(--splash-tech)]">
                  <div className="font-mono text-[0.7rem] tracking-[0.2em] text-[var(--splash-text-faint)] mb-4">
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <h2 className="font-serif font-normal leading-[1.1] tracking-[-0.02em] text-[var(--splash-text)] mb-3 text-[1.7rem] md:text-[1.9rem]">
                    {a.name}
                  </h2>
                  <p className="font-serif text-[1.05rem] leading-[1.6] text-[var(--splash-text-soft)] mb-7">
                    {a.depiction}
                  </p>
                  <div className="mt-auto">
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 font-mono text-[0.82rem] tracking-[0.1em] uppercase no-underline text-[var(--splash-tech)] transition-opacity hover:opacity-80"
                    >
                      <span>Watch it →</span>
                    </a>
                  </div>
                </article>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-col gap-3">
            <a
              href={altitudeAwakeningProjectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[0.78rem] tracking-[0.12em] uppercase no-underline text-[var(--splash-text-soft)] transition-colors hover:text-[var(--splash-tech)]"
            >
              Open all five →
            </a>
            <p className="font-mono text-[0.74rem] leading-relaxed text-[var(--splash-text-faint)] max-w-[680px]">
              <span className="text-[var(--splash-tech)]">tip · </span>
              Each runs ~11&ndash;13 seconds before the stats page lands&mdash;or use Skip intro to
              jump straight to the data.
            </p>
            <p className="font-mono text-[0.74rem] leading-relaxed text-[var(--splash-text-faint)] max-w-[680px]">
              <span className="text-[var(--splash-tech)]">note · </span>
              These are private preview links that expire seven days after upload. A 404 later is the
              TTL doing its job&mdash;not a bug.
            </p>
          </div>
        </section>

        {/* EARLIER — cinematic intros (10), demoted */}
        <section className="mb-20">
          <div className="font-mono text-[0.7rem] tracking-[0.3em] uppercase text-[var(--splash-text-faint)] mb-6">
            <span className="text-[var(--splash-tech)]">— </span>
            Earlier — cinematic intros (10)
          </div>
          <ul className="grid gap-5 list-none p-0 m-0 sm:grid-cols-2 lg:grid-cols-2">
            {altitudeCinematics.map((c, i) => (
              <li key={c.url} className="flex">
                <article className="flex flex-col h-full w-full border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-5 md:p-6 transition-colors hover:border-[var(--splash-tech)]">
                  <div className="font-mono text-[0.68rem] tracking-[0.2em] text-[var(--splash-text-faint)] mb-3">
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <h3 className="font-serif font-normal leading-[1.15] tracking-[-0.02em] text-[var(--splash-text)] mb-2 text-[1.3rem]">
                    {c.name}
                  </h3>
                  <p className="font-serif text-[0.95rem] leading-[1.55] text-[var(--splash-text-soft)] mb-5">
                    {c.story}
                  </p>
                  <div className="mt-auto">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 font-mono text-[0.76rem] tracking-[0.1em] uppercase no-underline text-[var(--splash-tech)] transition-opacity hover:opacity-80"
                    >
                      <span>Watch it →</span>
                    </a>
                  </div>
                </article>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <a
              href={altitudeCinematicsProjectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[0.76rem] tracking-[0.12em] uppercase no-underline text-[var(--splash-text-soft)] transition-colors hover:text-[var(--splash-tech)]"
            >
              Open all ten →
            </a>
          </div>
        </section>

        {/* EARLIER — page-load screens (10), demoted */}
        <section className="mb-20">
          <div className="font-mono text-[0.7rem] tracking-[0.3em] uppercase text-[var(--splash-text-faint)] mb-6">
            <span className="text-[var(--splash-tech)]">— </span>
            Earlier — page-load screens (10)
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

        {/* EARLIER — immersive 3D (3 directions), demoted */}
        <section className="mb-20">
          <div className="font-mono text-[0.7rem] tracking-[0.3em] uppercase text-[var(--splash-text-faint)] mb-6">
            <span className="text-[var(--splash-tech)]">— </span>
            Earlier — immersive 3D (3 directions)
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
                      <span>Open the live experience →</span>
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

        {/* EARLIER EXPLORATIONS — secondary heading */}
        <div className="font-mono text-[0.7rem] tracking-[0.3em] uppercase text-[var(--splash-text-faint)] mb-6">
          <span className="text-[var(--splash-tech)]">— </span>
          Earlier explorations
        </div>

        {/* THE TOOL BEHIND THE GALLERY */}
        <figure className="mt-2 max-w-[860px] m-0">
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
            The cinematic gallery
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5 mb-8">
            <h2 className="font-serif text-[1.9rem] md:text-[2.2rem] leading-tight tracking-[-0.02em] text-[var(--splash-text)]">
              Twenty scroll-driven stories of one ascent,{' '}
              <em className="italic text-[var(--splash-tech)]">live.</em>
            </h2>
            <a
              href={projectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 font-mono text-[0.78rem] tracking-[0.12em] uppercase no-underline transition-colors flex-shrink-0"
              style={{ background: 'var(--splash-tech)', color: 'var(--splash-bg)' }}
            >
              <span>Open the project (all 20)</span>
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

          {/* Earlier exploration set — secondary */}
          <p className="mt-8 font-mono text-[0.74rem] leading-relaxed text-[var(--splash-text-soft)] max-w-[680px]">
            <span className="text-[var(--splash-text-faint)]">earlier · </span>
            Before this set there was a first pass at the same page in a different visual
            language.{' '}
            <a
              href={EARLIER_EXPLORATIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--splash-tech)] no-underline"
            >
              See the earlier explorations →
            </a>
          </p>

          {/* Honest TTL note */}
          <p className="mt-4 font-mono text-[0.74rem] leading-relaxed text-[var(--splash-text-faint)] max-w-[680px]">
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

