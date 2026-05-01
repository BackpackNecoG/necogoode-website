import { Link } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';
import { setCookie } from '../lib/cookies';

/**
 * Splash door — landing at /. Mirrors docs/reference/00-splash-door.html.
 * Per spec: cookie persists choice but does NOT auto-redirect on return —
 * visitors should still be able to take the other path.
 */
export default function Splash() {
  useRouteScope('splash');

  return (
    <>
      {/* Subtle grid backdrop, fades to transparent at edges */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(94,234,212,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(94,234,212,0.04) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
        }}
      />

      {/* Top brand */}
      <div className="fixed top-8 left-1/2 -translate-x-1/2 text-center z-10">
        <div className="font-serif text-[1.4rem] font-semibold tracking-tight mb-1.5">
          Neco<em className="not-italic italic text-[var(--splash-tech)]">Goode</em>
        </div>
        <div className="font-mono text-[0.7rem] tracking-[0.3em] text-[var(--splash-text-faint)] uppercase">
          Builder · Operator · Sr. Director of IT
        </div>
      </div>

      {/* Center container */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-12 px-8">
        <div className="text-center max-w-[720px]">
          <div className="font-mono text-[0.72rem] tracking-[0.3em] text-[var(--splash-text-soft)] uppercase mb-6">
            <span className="text-[var(--splash-tech)]">— </span>
            Welcome — Choose a Path
            <span className="text-[var(--splash-bus)]"> —</span>
          </div>
          <h1
            className="font-serif font-normal leading-[1.05] tracking-[-0.025em] mb-4"
            style={{ fontSize: 'clamp(2.5rem, 5.5vw, 4rem)' }}
          >
            Take the <em className="italic text-[var(--splash-tech)]">Technical Tour</em>
            <br />
            or the <em className="italic text-[var(--splash-bus)]">Business Tour.</em>
          </h1>
          <p className="font-serif italic text-[1.2rem] text-[var(--splash-text-soft)] leading-relaxed max-w-[540px] mx-auto">
            Same five creations, two different lenses. Don&apos;t read it &mdash; run it.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-[920px]">
          <DoorLink
            to="/TechTour"
            tone="tech"
            num="01 · For the Builders"
            title="Technical"
            titleEm="Tour."
            sub="Stack details, architecture decisions, and the engineering thinking behind every creation."
            features={['IDE-style navigation', 'Stack & dependency depth', 'Architecture & trade-offs', 'Real production receipts']}
            cta="./enter --tech"
          />
          <DoorLink
            to="/BusTour"
            tone="bus"
            num="02 · For Everyone Else"
            title="Business"
            titleEm="Tour."
            sub="The story behind the work — what each creation is, why I built it, and who it's for."
            features={['Workshop-style layout', 'Story-form narratives', 'Visual & human', 'No jargon required']}
            cta="step inside"
          />
        </div>
      </div>

      {/* Bottom hint */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 font-mono text-[0.68rem] tracking-[0.2em] text-[var(--splash-text-faint)] uppercase whitespace-nowrap">
        Stack-curious? Visit{' '}
        <Link
          to="/floor"
          className="text-[var(--splash-text-soft)] no-underline border-b border-dotted border-[var(--splash-text-faint)] hover:text-[var(--splash-tech)] hover:border-[var(--splash-tech)]"
        >
          the trading floor
        </Link>
        {' '}· live ticker on every creation
      </div>
    </>
  );
}

/** Internal door component — the two big choice tiles. */
function DoorLink({
  to,
  tone,
  num,
  title,
  titleEm,
  sub,
  features,
  cta,
}: {
  to: string;
  tone: 'tech' | 'bus';
  num: string;
  title: string;
  titleEm: string;
  sub: string;
  features: string[];
  cta: string;
}) {
  const colorVar = tone === 'tech' ? 'var(--splash-tech)' : 'var(--splash-bus)';
  const glowVar = tone === 'tech' ? 'var(--splash-tech-glow)' : 'var(--splash-bus-glow)';

  return (
    <Link
      to={to}
      onClick={() => setCookie('ng_path', tone)}
      className="group relative block overflow-hidden p-10 px-8 border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] no-underline text-[var(--splash-text)] transition-all duration-[400ms] hover:-translate-y-1"
      style={{ ['--door-color' as string]: colorVar }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = colorVar as string)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--splash-line)')}
    >
      {/* Glow on hover */}
      <span
        aria-hidden
        className="absolute inset-0 opacity-0 group-hover:opacity-[0.08] transition-opacity duration-[400ms] pointer-events-none"
        style={{ background: `radial-gradient(circle at 50% 50%, ${glowVar}, transparent 70%)` }}
      />

      <div className="font-mono text-[0.7rem] tracking-[0.2em] text-[var(--splash-text-faint)] uppercase mb-3">
        {num}
      </div>
      <h2 className="font-serif text-[2rem] font-normal leading-none tracking-[-0.02em] mb-2">
        {title} <em className="italic" style={{ color: colorVar }}>{titleEm}</em>
      </h2>
      <p className="text-[0.9rem] text-[var(--splash-text-soft)] leading-relaxed mb-6 max-w-[280px]">{sub}</p>

      <ul className="font-mono text-[0.72rem] text-[var(--splash-text-soft)] mb-6 leading-loose tracking-wide list-none">
        {features.map((f) => (
          <li key={f}>
            <span style={{ color: colorVar }}>▸ </span>
            {f}
          </li>
        ))}
      </ul>

      <span
        className="inline-flex items-center gap-2 font-mono text-[0.78rem] tracking-[0.1em] uppercase border-t border-[var(--splash-line)] pt-4 transition-colors group-hover:text-[var(--splash-text)]"
        style={{ color: colorVar }}
      >
        <span>{cta}</span>
        <span className="transition-transform duration-300 group-hover:translate-x-1.5">→</span>
      </span>
    </Link>
  );
}
