import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';
import { creations } from '../data/creations';
import { WorkshopCard } from '../components/domain/workshop/WorkshopCard';
import {
  GoodeGameVisual,
  SoloLiftVisual,
  VibingVisual,
  ByteSizedVisual,
  PIPVisual,
} from '../components/domain/workshop/visuals';

/**
 * /BusTour homepage — wood workbench horizontal scroll.
 * Mirrors docs/reference/H-workshop.html.
 *
 * Each creation card looks like a different physical "object" on the bench,
 * with a slight rotation. Vertical wheel events are translated to horizontal scroll.
 */
export default function BusTour() {
  useRouteScope('bus');
  const benchRef = useRef<HTMLDivElement>(null);

  // Convert vertical wheel scroll into horizontal scroll on the bench.
  useEffect(() => {
    const bench = benchRef.current;
    if (!bench) return;

    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        bench.scrollLeft += e.deltaY;
      }
    };
    bench.addEventListener('wheel', handler, { passive: false });
    return () => bench.removeEventListener('wheel', handler);
  }, []);

  // Map ticker → visual, in the order they appear on the bench.
  const visuals: Record<string, JSX.Element> = {
    GDGM: <GoodeGameVisual />,
    SLIFT: <SoloLiftVisual />,
    VWPA: <VibingVisual />,
    BSA: <ByteSizedVisual />,
    PIP: <PIPVisual />,
  };

  // Hand-tuned tilt per card so the bench looks naturally arranged.
  const tilts = [1.5, -2, 0.8, -1.2, 2];

  return (
    <>
      {/* Fixed nav over the wood */}
      <nav className="fixed top-0 inset-x-0 z-50 px-10 py-5 flex justify-between items-center"
           style={{ background: 'linear-gradient(to bottom, rgba(62,42,20,0.95), rgba(62,42,20,0.7))', backdropFilter: 'blur(8px)' }}>
        <Link to="/" className="font-serif text-[var(--bus-paper)] text-[1.15rem] font-semibold tracking-tight no-underline flex items-center gap-2.5">
          <span
            className="w-7 h-7 rounded-sm flex items-center justify-center font-hand text-[1.1rem] shadow-md"
            style={{ background: 'var(--bus-brass-bright)', color: 'var(--bus-wood-deep)', transform: 'rotate(-3deg)' }}
          >
            N
          </span>
          <span>
            Neco<em className="not-italic italic" style={{ color: 'var(--bus-brass-bright)' }}>Goode</em>
          </span>
        </Link>
        <div className="hidden md:flex gap-10 text-[0.85rem] text-[var(--bus-paper-dark)]">
          <Link to="/BusTour" className="hover:text-[var(--bus-brass-bright)] no-underline text-current">Creations</Link>
          <Link to="/" className="hover:text-[var(--bus-brass-bright)] no-underline text-current">Path</Link>
          <a href="mailto:hello@necogoode.com" className="hover:text-[var(--bus-brass-bright)] no-underline text-current">Contact</a>
        </div>
      </nav>

      {/* The workbench — horizontal scroller */}
      <div
        ref={benchRef}
        className="relative h-screen min-h-[700px] overflow-x-auto overflow-y-hidden"
        style={{
          background: 'var(--bus-wood)',
          backgroundImage:
            "repeating-linear-gradient(87deg, transparent 0, transparent 80px, var(--bus-wood-grain) 80px, var(--bus-wood-grain) 81px, transparent 81px, transparent 200px, var(--bus-wood-grain) 200px, var(--bus-wood-grain) 201px, transparent 201px, transparent 350px), radial-gradient(ellipse 200px 80px at 15% 60%, rgba(62,42,20,0.25), transparent 70%), radial-gradient(ellipse 150px 60px at 45% 30%, rgba(62,42,20,0.18), transparent 70%), radial-gradient(ellipse 180px 70px at 75% 70%, rgba(62,42,20,0.22), transparent 70%), radial-gradient(ellipse 120px 50px at 92% 25%, rgba(62,42,20,0.2), transparent 70%), linear-gradient(135deg, var(--bus-wood-light), var(--bus-wood) 50%, var(--bus-wood-dark))",
          scrollBehavior: 'smooth',
        }}
      >
        {/* Inner row that's wider than the viewport */}
        <div className="flex items-center h-full gap-16 px-[6vw] w-max relative z-10">
          {/* Identity card */}
          <IdentityCard />

          {/* Scroll hint */}
          <div className="flex-shrink-0 self-center font-hand text-[1.4rem] px-8 flex items-center gap-3"
               style={{ color: 'var(--bus-paper)', transform: 'rotate(-2deg)', textShadow: '1px 2px 4px rgba(0,0,0,0.4)' }}>
            scroll right
            <span className="text-3xl" style={{ animation: 'nudge 2s ease-in-out infinite' }}>→</span>
          </div>

          {/* Creation cards in canonical order */}
          {creations.map((c, i) => (
            <WorkshopCard
              key={c.slug}
              to={`/BusTour/creations/${c.slug}`}
              tagline={shortTagline(c.ticker)}
              name={c.name}
              description={c.bus.tagline}
              tiltDeg={tilts[i] ?? 0}
              visual={visuals[c.ticker] ?? null}
            />
          ))}

          {/* Contact card */}
          <ContactCard />

          <div className="flex-shrink-0 w-[4vw]" aria-hidden />
        </div>
      </div>

      {/* Inline keyframes for the scroll-hint nudge */}
      <style>{`@keyframes nudge { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(8px); } }`}</style>
    </>
  );
}

/** Map ticker → "kind of object" tagline used above the creation name. */
function shortTagline(ticker: string): string {
  switch (ticker) {
    case 'GDGM': return 'community platform';
    case 'SLIFT': return 'production saas';
    case 'VWPA': return 'ai platform';
    case 'BSA': return 'animated series · personal';
    case 'PIP': return 'protocol · the moat';
    default: return '';
  }
}

function IdentityCard() {
  return (
    <div
      className="relative flex-shrink-0 w-[540px] p-12 px-10 rounded-sm"
      style={{
        background: 'var(--bus-paper)',
        backgroundImage: 'repeating-linear-gradient(0deg, transparent 0px, transparent 28px, rgba(74,58,40,0.12) 28px, rgba(74,58,40,0.12) 29px)',
        boxShadow: '0 1px 0 rgba(255,250,230,0.4) inset, 4px 8px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(74,58,40,0.1)',
        transform: 'rotate(-1.2deg)',
      }}
    >
      {/* Punch holes (left margin) */}
      <div
        aria-hidden
        className="absolute"
        style={{
          left: '16px',
          top: '60px',
          width: '12px',
          height: '12px',
          background: 'var(--bus-wood)',
          borderRadius: '50%',
          boxShadow: '0 100px 0 var(--bus-wood), 0 200px 0 var(--bus-wood), inset 1px 1px 2px rgba(0,0,0,0.4)',
        }}
      />

      {/* Margin doodle */}
      <div
        className="absolute font-hand text-[1.1rem] w-[130px] leading-tight"
        style={{ right: '-100px', top: '30px', color: 'var(--bus-rust)', transform: 'rotate(8deg)' }}
      >
        <div
          aria-hidden
          className="absolute"
          style={{ left: '-30px', top: '50%', width: '30px', height: '1.5px', background: 'var(--bus-rust)', transformOrigin: 'left', transform: 'rotate(-15deg)' }}
        />
        everything here is real, live & shipped ↙
      </div>

      <div className="font-hand text-[1.4rem] mb-2" style={{ color: 'var(--bus-rust)', transform: 'rotate(-0.5deg)' }}>
        <span style={{ color: 'var(--bus-green)' }}>✦  </span>
        Welcome to my workshop.
      </div>

      <h1 className="font-serif text-[3.5rem] font-semibold leading-none tracking-[-0.025em] text-[var(--bus-ink)] mb-4">
        Neco Goode
        <em className="block italic font-normal mt-1 text-[2.6rem]" style={{ color: 'var(--bus-rust)' }}>
          builds across.
        </em>
      </h1>

      <p className="font-serif text-[1.2rem] leading-relaxed text-[var(--bus-ink-soft)] italic mb-6">
        Cloud, AI, data, product. Every claim on the resume has a working URL.
      </p>

      <ul className="text-[0.95rem] leading-loose text-[var(--bus-ink)] list-none">
        {['A curious and ambitious mind', 'Architect, operator & leader of people and process', '5 live creations on the bench →'].map((b) => (
          <li key={b}>
            <span className="font-bold" style={{ color: 'var(--bus-green)' }}>✓ </span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContactCard() {
  return (
    <div
      className="flex-shrink-0 w-[380px] p-10 rounded-sm"
      style={{ background: 'var(--bus-paper)', transform: 'rotate(0.8deg)', boxShadow: '4px 8px 20px rgba(0,0,0,0.35)' }}
    >
      <h3 className="font-serif text-[2rem] font-semibold tracking-[-0.015em] mb-3 text-[var(--bus-ink)]">
        End of the <em className="italic" style={{ color: 'var(--bus-rust)' }}>bench.</em>
      </h3>
      <p className="font-serif text-[1.1rem] leading-relaxed italic mb-6 text-[var(--bus-ink-soft)]">
        If any of this is interesting — for hiring, partnership, or just to talk shop — let&apos;s talk.
      </p>
      <a
        href="mailto:hello@necogoode.com"
        className="inline-block px-7 py-3.5 text-[0.85rem] tracking-[0.15em] uppercase font-medium no-underline transition-colors"
        style={{ background: 'var(--bus-ink)', color: 'var(--bus-paper)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bus-rust)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bus-ink)')}
      >
        Get in touch →
      </a>
    </div>
  );
}
