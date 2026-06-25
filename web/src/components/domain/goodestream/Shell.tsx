import { Link, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { GOODESTREAM_DEMOS } from '../../../data/goodestream';

/**
 * GoodeStream shell — shared chrome for the Talent Dashboard section.
 *
 * Built in the splash/concepts visual language (clean dark "document" surface)
 * so the section reads as a native part of necogoode.com. Every primitive here
 * references theme.css tokens (--splash-*) — no hardcoded colors or fonts.
 *
 * Exposes: GridBackdrop, TopNav, SectionTabs, Footer, plus content helpers
 * (Kicker, Prose P, PrototypeBadge, ScopeNote, DemoBlock) reused across the
 * landing page and all three demo sub-pages.
 */

/* ---- Logo lockup, matching routes/Concepts.tsx exactly ------------------ */
export function Logo() {
  return (
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
  );
}

/** Faint teal grid, masked at top — the splash/concepts signature backdrop. */
export function GridBackdrop() {
  return (
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
  );
}

/** Top bar: logo + the section name + a link back to the tours. */
export function TopNav() {
  return (
    <nav className="relative z-10 px-6 md:px-10 py-5 flex justify-between items-center gap-4 max-w-[1080px] mx-auto">
      <Logo />
      <div className="flex items-center gap-5 text-[0.78rem] font-mono tracking-wide text-[var(--splash-text-soft)]">
        <Link to="/concepts" className="no-underline text-current hover:text-[var(--splash-tech)] hidden sm:inline">
          concept lab
        </Link>
        <Link to="/TechTour" className="no-underline text-current hover:text-[var(--splash-tech)]">
          tech tour
        </Link>
      </div>
    </nav>
  );
}

/**
 * Section tab-nav — links to the GoodeStream overview + each demo.
 * Sticky so it stays reachable while scrolling a long demo page.
 */
export function SectionTabs() {
  const { pathname } = useLocation();
  const tabs = [
    { to: '/goodestream', label: 'Overview', glyph: '◆' },
    ...GOODESTREAM_DEMOS.map((d) => ({ to: `/goodestream/${d.slug}`, label: d.tab, glyph: d.glyph })),
  ];

  return (
    <div className="sticky top-0 z-20 -mt-px border-y border-[var(--splash-line)] bg-[var(--splash-bg)]/85 backdrop-blur supports-[backdrop-filter]:bg-[var(--splash-bg)]/70">
      <nav
        aria-label="GoodeStream sections"
        className="max-w-[1080px] mx-auto px-4 md:px-10 flex gap-1 overflow-x-auto no-scrollbar"
      >
        {tabs.map((t) => {
          const active = pathname === t.to;
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={active ? 'page' : undefined}
              className="shrink-0 px-3.5 py-3 font-mono text-[0.72rem] tracking-[0.12em] uppercase no-underline border-b-2 transition-colors whitespace-nowrap flex items-center gap-2"
              style={{
                borderColor: active ? 'var(--splash-tech)' : 'transparent',
                color: active ? 'var(--splash-tech)' : 'var(--splash-text-soft)',
              }}
            >
              <span aria-hidden className="text-[0.85em] opacity-80">
                {t.glyph}
              </span>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-20 pt-8 border-t border-[var(--splash-line)] flex flex-col sm:flex-row gap-4 justify-between font-mono text-[0.8rem] text-[var(--splash-text-soft)]">
      <Link to="/" className="no-underline text-current hover:text-[var(--splash-tech)]">
        ← back to the door
      </Link>
      <div className="flex gap-6">
        <Link to="/goodestream" className="no-underline text-current hover:text-[var(--splash-tech)]">
          GoodeStream overview →
        </Link>
        <Link to="/TechTour" className="no-underline text-current hover:text-[var(--splash-tech)]">
          technical tour →
        </Link>
      </div>
    </footer>
  );
}

/* ---- Content helpers, in the splash visual language --------------------- */

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[0.7rem] tracking-[0.25em] uppercase text-[var(--splash-text-faint)] mb-3">
      {children}
    </div>
  );
}

export function P({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-serif text-[1.12rem] leading-[1.7] text-[var(--splash-text-soft)] mb-5 max-w-[680px] ${className}`}>
      {children}
    </p>
  );
}

/**
 * The always-visible "this is a prototype" badge. Every demo page and card
 * carries one so a hiring manager is never misled about scope.
 */
export function PrototypeBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[0.62rem] tracking-[0.18em] uppercase ${className}`}
      style={{
        border: '1px solid var(--splash-tech)',
        color: 'var(--splash-tech)',
        background: 'rgba(94,234,212,0.06)',
      }}
    >
      <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--splash-tech)' }} />
      Prototype
    </span>
  );
}

/**
 * Scope note shown directly beside/below every prototype: what it does, what it
 * doesn't, and the guardrails. `does`/`doesnt`/`guardrails` are plain strings.
 */
export function ScopeNote({
  does,
  doesnt,
  guardrails,
}: {
  does: string;
  doesnt: string;
  guardrails: string;
}) {
  const rows: Array<{ label: string; tone: string; body: string }> = [
    { label: 'What it does', tone: 'var(--splash-tech)', body: does },
    { label: "What it doesn't", tone: 'var(--splash-text-soft)', body: doesnt },
    { label: 'Guardrails', tone: 'var(--splash-bus)', body: guardrails },
  ];
  return (
    <aside
      aria-label="Prototype scope and guardrails"
      className="border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-5 md:p-6"
    >
      <div className="flex items-center gap-3 mb-4">
        <PrototypeBadge />
        <span className="font-mono text-[0.68rem] tracking-[0.15em] uppercase text-[var(--splash-text-faint)]">
          Scope &amp; guardrails
        </span>
      </div>
      <dl className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-1 sm:gap-4">
            <dt className="font-mono text-[0.7rem] tracking-[0.1em] uppercase pt-0.5" style={{ color: r.tone }}>
              {r.label}
            </dt>
            <dd className="font-sans text-[0.92rem] leading-relaxed text-[var(--splash-text-soft)] m-0">{r.body}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/**
 * A numbered demo block (Problem Statement / How We'd Target It / Working
 * Prototype). Enforces the required three-part order with consistent headings.
 */
export function DemoBlock({
  step,
  kicker,
  title,
  children,
}: {
  step: string;
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-14 scroll-mt-20">
      <Kicker>
        {step} · {kicker}
      </Kicker>
      <h2 className="font-serif text-[1.9rem] md:text-[2.2rem] leading-tight tracking-[-0.02em] text-[var(--splash-text)] mb-5">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Standard page wrapper: scope backdrop + nav + tabs + main + footer + wheel slot. */
export function GoodeStreamPage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-y-auto">
      <GridBackdrop />
      <TopNav />
      <SectionTabs />
      <main className="relative z-10 max-w-[1080px] mx-auto px-6 md:px-10 pb-24 pt-10">{children}</main>
    </div>
  );
}
