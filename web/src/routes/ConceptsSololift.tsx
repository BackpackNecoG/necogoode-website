import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';
import { NavigationWheel } from '../components/domain/NavigationWheel';

/**
 * /concepts/sololift.ai — ConceptLabs.
 *
 * A simple, dynamic showcase. Content is fetched at runtime from the public
 * ConceptLab function endpoint and rendered grouped by project, with a filter
 * row to narrow to a single project. Each concept is a plain outbound link.
 */

const PROMOTED_URL = 'https://func-conceptlab.azurewebsites.net/api/promoted';

interface Concept {
  description: string;
  url: string;
}

interface ProjectGroup {
  project: string;
  concepts: Concept[];
}

interface PromotedResponse {
  groups: ProjectGroup[];
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; groups: ProjectGroup[] };

const ALL = '__all__';

export default function ConceptsSololift() {
  useRouteScope('concepts');

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [filter, setFilter] = useState<string>(ALL);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(PROMOTED_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PromotedResponse = await res.json();
        if (cancelled) return;
        const groups = Array.isArray(data?.groups) ? data.groups : [];
        setState({ status: 'ready', groups });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = state.status === 'ready' ? state.groups : [];

  const projects = useMemo(
    () => groups.map((g) => g.project),
    [groups],
  );

  const visibleGroups = useMemo(
    () => (filter === ALL ? groups : groups.filter((g) => g.project === filter)),
    [groups, filter],
  );

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
        {/* Intro */}
        <header className="pt-12 md:pt-16 mb-12 max-w-[760px]">
          <h1
            className="font-serif font-normal leading-[1.05] tracking-[-0.025em] mb-6 text-[var(--splash-text)]"
            style={{ fontSize: 'clamp(2.2rem, 5vw, 3.4rem)' }}
          >
            ConceptLabs
          </h1>
          <p className="font-serif text-[1.15rem] leading-relaxed text-[var(--splash-text-soft)]">
            I&apos;ll be using the section below to showcase concepts I&apos;ve worked on across
            varying projects. Click one of the links and a new tab will open to display.
          </p>
        </header>

        {/* Loading / error states */}
        {state.status === 'loading' && (
          <p className="font-mono text-[0.8rem] text-[var(--splash-text-faint)]">Loading…</p>
        )}

        {state.status === 'error' && (
          <p className="font-mono text-[0.8rem] text-[var(--splash-text-faint)]">
            Couldn&apos;t load concepts right now. Please try again later.
          </p>
        )}

        {state.status === 'ready' && groups.length === 0 && (
          <p className="font-mono text-[0.8rem] text-[var(--splash-text-faint)]">
            Nothing published yet.
          </p>
        )}

        {state.status === 'ready' && groups.length > 0 && (
          <>
            {/* Filter chips */}
            <div className="flex flex-wrap gap-2.5 mb-12">
              {[ALL, ...projects].map((p) => {
                const isActive = filter === p;
                const label = p === ALL ? 'All' : p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setFilter(p)}
                    className={
                      'font-mono text-[0.74rem] tracking-[0.08em] px-3.5 py-1.5 rounded-sm border transition-colors ' +
                      (isActive
                        ? 'border-[var(--splash-tech)] text-[var(--splash-tech)] bg-[var(--splash-bg-soft)]'
                        : 'border-[var(--splash-line)] text-[var(--splash-text-soft)] hover:border-[var(--splash-tech)] hover:text-[var(--splash-tech)]')
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Grouped by project */}
            <div className="flex flex-col gap-16">
              {visibleGroups.map((group) => (
                <section key={group.project}>
                  <h2 className="font-mono text-[0.72rem] tracking-[0.3em] uppercase text-[var(--splash-text-faint)] mb-6">
                    <span className="text-[var(--splash-tech)]">— </span>
                    {group.project}
                  </h2>
                  <ul className="flex flex-col gap-3 list-none p-0 m-0">
                    {group.concepts.map((concept) => (
                      <li key={concept.url}>
                        <a
                          href={concept.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group inline-flex items-baseline gap-2 font-serif text-[1.1rem] leading-snug no-underline text-[var(--splash-text)] transition-colors hover:text-[var(--splash-tech)]"
                        >
                          <span className="underline decoration-[var(--splash-line)] underline-offset-4 group-hover:decoration-[var(--splash-tech)]">
                            {concept.description}
                          </span>
                          <span className="font-mono text-[0.8rem] text-[var(--splash-tech)] opacity-70 group-hover:opacity-100">
                            ↗
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}

        {/* Footer nav */}
        <div className="mt-20 pt-8 border-t border-[var(--splash-line)] flex flex-col sm:flex-row gap-4 justify-between font-mono text-[0.8rem] text-[var(--splash-text-soft)]">
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
