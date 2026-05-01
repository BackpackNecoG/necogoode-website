import { Link, useParams } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';
import { getCreationBySlug } from '../data/creations';
import { Tag } from '../components/ui/Tag';
import { NavigationWheel } from '../components/domain/NavigationWheel';
import NotFound from './NotFound';

/**
 * Real screenshots captured from live URLs by `scripts/screenshots.js`.
 *
 * Each captured page is currently a login wall — that's the public face of
 * the product, since GoodeGame is invitation-only, SoloLift is paid-tier,
 * and VibingWithPrimitiveAI is gated. Rather than show duplicate full-page
 * captures (the page fits in viewport so home == in-use), we render ONE
 * landing screenshot per creation with an honest caption, and let visitors
 * follow the "Visit it live" CTA below to actually try the product.
 *
 * Falls back to the sepia <PhotoSlot /> for BSA + PIP (no live URL yet).
 */
type ScreenshotEntry =
  | { kind: 'image'; src: string; caption: string }
  | { kind: 'pair'; left: { src: string; label: string }; right: { src: string; label: string }; caption: string };

const SCREENSHOTS: Record<string, ScreenshotEntry | undefined> = {
  goodegame: {
    kind: 'image',
    src: '/screenshots/goodegame/home.png',
    caption: 'the clubhouse door · members enter from here',
  },
  sololift: {
    kind: 'image',
    src: '/screenshots/sololift/home.png',
    caption: 'the public landing · sign in to use',
  },
  // VWPA: the signature navigation-wheel screenshot Neco supplied. The branding
  // shows VIBINGAI at the hub, surrounded by labeled primitive spokes — that's
  // the product's distinctive UX, far more on-brand than a sign-in surface.
  'vibing-with-primitive-ai': {
    kind: 'image',
    src: '/screenshots/vibing-with-primitive-ai/wheel.png',
    caption: 'the navigation wheel · primitives instead of chat',
  },
  // BSA: characters modeled on Neco's two kids, Ant and Lena. The character
  // bibles are the authoritative reference sheets — color identity, hair refs,
  // proportions — kept locked so animation stays consistent across episodes.
  'byte-sized-adventures': {
    kind: 'pair',
    left: { src: '/screenshots/byte-sized-adventures/ant.png', label: 'Ant — character bible' },
    right: { src: '/screenshots/byte-sized-adventures/lena.png', label: 'Lena — character bible' },
    caption: 'the family characters · modeled on my own two kids, Ant and Lena',
  },
};

/**
 * /BusTour/creations/:slug
 *
 * Workshop-themed long-form story page. Hero on paper, prose in Fraunces serif,
 * pull-quote drawn from `bus.why`, photo placeholders for post-launch screenshots.
 */
export default function BusCreation() {
  useRouteScope('bus');
  const { slug } = useParams<{ slug: string }>();
  const c = slug ? getCreationBySlug(slug) : undefined;

  if (!c) return <NotFound />;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bus-wood-deep)' }}>
      {/* Top nav */}
      <nav className="px-10 py-5 flex justify-between items-center"
           style={{ background: 'linear-gradient(to bottom, rgba(62,42,20,0.95), rgba(62,42,20,0.7))' }}>
        <Link to="/BusTour" className="font-serif text-[var(--bus-paper)] text-[1.05rem] font-semibold no-underline flex items-center gap-2.5">
          <span
            className="w-7 h-7 rounded-sm flex items-center justify-center font-hand text-[1.1rem] shadow-md"
            style={{ background: 'var(--bus-brass-bright)', color: 'var(--bus-wood-deep)', transform: 'rotate(-3deg)' }}
          >
            N
          </span>
          <span>← back to the bench</span>
        </Link>
        <Link to={`/TechTour/creations/${c.slug}`} className="text-[var(--bus-paper-dark)] hover:text-[var(--bus-brass-bright)] no-underline text-[0.85rem]">
          Technical tour of this creation →
        </Link>
      </nav>

      {/* Paper sheet */}
      <article
        className="max-w-[760px] mx-auto my-12 p-12 md:p-16 rounded-sm relative"
        style={{
          background: 'var(--bus-paper)',
          backgroundImage: 'repeating-linear-gradient(0deg, transparent 0px, transparent 32px, rgba(74,58,40,0.08) 32px, rgba(74,58,40,0.08) 33px)',
          boxShadow: '0 1px 0 rgba(255,250,230,0.4) inset, 8px 16px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(74,58,40,0.1)',
        }}
      >
        {/* Tape at top */}
        <div
          aria-hidden
          className="absolute -top-3 left-1/2 -translate-x-1/2 w-32 h-6 shadow-sm"
          style={{ background: 'rgba(220,200,150,0.7)', transform: 'translateX(-50%) rotate(2deg)' }}
        />

        <div className="font-hand text-[1.4rem] mb-2" style={{ color: 'var(--bus-rust)' }}>
          <span style={{ color: 'var(--bus-green)' }}>✦  </span>
          {c.bus.tagline}
        </div>

        <h1 className="font-serif text-[3rem] md:text-[3.75rem] font-semibold leading-[1] tracking-[-0.025em] text-[var(--bus-ink)] mb-2">
          {c.name}
        </h1>

        <div className="mb-8">
          <Tag tone={c.status === 'live' ? 'live' : c.status === 'in-production' ? 'in-progress' : 'strategic'}>
            {c.status}
          </Tag>
        </div>

        {/* Story prose */}
        {c.bus.story.split('\n\n').map((para, i) => (
          <p key={i} className="font-serif text-[1.15rem] leading-[1.65] text-[var(--bus-ink)] mb-6">
            {para}
          </p>
        ))}

        {/* Pull-quote drawn from bus.why */}
        <blockquote
          className="my-12 px-8 py-6 font-serif italic text-[1.5rem] leading-tight"
          style={{
            color: 'var(--bus-rust)',
            borderLeft: '4px solid var(--bus-rust)',
            background: 'rgba(176,90,44,0.06)',
          }}
        >
          “{c.bus.why}”
        </blockquote>

        {/* Who it's for */}
        <h2 className="font-serif text-[1.5rem] font-semibold text-[var(--bus-ink)] mt-10 mb-3">
          Who it&apos;s for
        </h2>
        <p className="font-serif text-[1.1rem] leading-[1.6] text-[var(--bus-ink-soft)] mb-10">
          {c.bus.forWhom}
        </p>

        {/* Real screenshot if captured; sepia placeholder for BSA + PIP */}
        <h2 className="font-serif text-[1.5rem] font-semibold text-[var(--bus-ink)] mb-4">
          From the workshop
        </h2>
        {(() => {
          const entry = SCREENSHOTS[c.slug];
          if (!entry) {
            return (
              <div className="grid grid-cols-2 gap-4 mb-10">
                <PhotoSlot caption="screenshot · home" />
                <PhotoSlot caption="screenshot · in use" />
              </div>
            );
          }
          if (entry.kind === 'image') {
            return <PhotoImage src={entry.src} alt={`${c.name} — landing`} caption={entry.caption} />;
          }
          // pair — two stacked tiles with their own labels (BSA: Ant + Lena)
          return <PhotoPair {...entry} />;
        })()}

        {/* Call-to-action footer */}
        <hr className="my-10" style={{ borderColor: 'rgba(74,58,40,0.3)' }} />
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-2">
            {c.liveUrl && (
              <a
                href={c.liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-6 py-3 text-[0.85rem] tracking-[0.15em] uppercase font-medium no-underline transition-colors"
                style={{ background: 'var(--bus-ink)', color: 'var(--bus-paper)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bus-rust)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bus-ink)')}
              >
                Visit it live →
              </a>
            )}
            <Link
              to={c.demoUrl ?? `/demo/${c.slug}`}
              className="ml-2 inline-block px-6 py-3 text-[0.85rem] tracking-[0.15em] uppercase font-medium no-underline border-2"
              style={{ borderColor: 'var(--bus-ink)', color: 'var(--bus-ink)' }}
            >
              Open the demo →
            </Link>
          </div>

          <Link to={`/TechTour/creations/${c.slug}`} className="text-[var(--bus-rust)] no-underline border-b border-[var(--bus-rust)] text-[0.95rem] font-serif italic">
            Take the technical tour of this creation →
          </Link>
        </div>
      </article>

      <div className="text-center pb-12 text-[var(--bus-paper-dark)] font-serif italic text-[0.95rem]">
        <Link to="/BusTour" className="text-[var(--bus-paper-dark)] no-underline border-b border-dotted border-[var(--bus-paper-dark)]">
          ← back to the bench
        </Link>
      </div>

      <NavigationWheel active="bus" />
    </div>
  );
}

/**
 * Real captured screenshot — single full-width tile with handwritten caption
 * underneath. Rendered when we have a real PNG for the creation.
 */
function PhotoImage({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="mb-10">
      <div
        className="aspect-[16/10] overflow-hidden relative"
        style={{
          boxShadow: 'inset 0 0 0 1px rgba(74,58,40,0.15), 4px 8px 20px rgba(0,0,0,0.25)',
          background: 'var(--bus-paper-dark)',
        }}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="w-full h-full object-cover object-top"
        />
      </div>
      <figcaption
        className="font-hand text-[1.05rem] mt-2 text-center"
        style={{ color: 'var(--bus-rust)' }}
      >
        — {caption}
      </figcaption>
    </figure>
  );
}

/**
 * Two side-by-side images with individual labels and one shared caption.
 * Used for BSA where the visual story is "two characters, one family".
 */
function PhotoPair({
  left,
  right,
  caption,
}: {
  left: { src: string; label: string };
  right: { src: string; label: string };
  caption: string;
}) {
  return (
    <figure className="mb-10">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <PhotoTile src={left.src} alt={left.label} label={left.label} />
        <PhotoTile src={right.src} alt={right.label} label={right.label} />
      </div>
      <figcaption
        className="font-hand text-[1.05rem] mt-3 text-center"
        style={{ color: 'var(--bus-rust)' }}
      >
        — {caption}
      </figcaption>
    </figure>
  );
}

function PhotoTile({ src, alt, label }: { src: string; alt: string; label: string }) {
  return (
    <div>
      <div
        className="aspect-[16/10] overflow-hidden relative"
        style={{
          boxShadow: 'inset 0 0 0 1px rgba(74,58,40,0.15), 4px 8px 20px rgba(0,0,0,0.25)',
          background: 'var(--bus-paper-dark)',
        }}
      >
        <img src={src} alt={alt} loading="lazy" className="w-full h-full object-cover object-top" />
      </div>
      <div
        className="font-hand text-[0.95rem] mt-1.5 text-center"
        style={{ color: 'var(--bus-ink-soft)' }}
      >
        {label}
      </div>
    </div>
  );
}

/** Sepia photo placeholder — Neco adds real screenshots post-launch. */
function PhotoSlot({ caption }: { caption: string }) {
  return (
    <div
      className="aspect-[4/3] flex items-end p-4 font-hand text-[1rem] relative"
      style={{
        background:
          'linear-gradient(135deg, rgba(74,58,40,0.18), rgba(74,58,40,0.05) 50%, rgba(74,58,40,0.12)), var(--bus-paper-dark)',
        color: 'var(--bus-ink-soft)',
        boxShadow: 'inset 0 0 0 1px rgba(74,58,40,0.15), 2px 4px 8px rgba(0,0,0,0.15)',
      }}
    >
      <span aria-hidden className="absolute top-3 right-3 text-[0.75rem] tracking-[0.2em] uppercase font-sans" style={{ color: 'var(--bus-ink-soft)', opacity: 0.5 }}>
        photo · soon
      </span>
      {caption}
    </div>
  );
}
