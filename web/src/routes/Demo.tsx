import { Link, useParams } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';
import { getCreationBySlug } from '../data/creations';
import { Tag } from '../components/ui/Tag';
import { Chip } from '../components/ui/Chip';
import { NavigationWheel } from '../components/domain/NavigationWheel';
import NotFound from './NotFound';

/**
 * /demo/:slug
 *
 * V1: a "coming soon" page summarizing what an interactive demo will let you do.
 * Shared across both tours — link target from TechCreation and BusCreation pages.
 *
 * TODO V2:
 *   Build the multi-tenant demo flow per creation:
 *     - Seed a demo tenant with realistic but synthetic data
 *     - Provide a "guided tour" hotspot overlay so visitors know what to click
 *     - Auto-tear-down each demo tenant after 24h
 *   This requires multi-tenancy work in each upstream creation that does not have it.
 */
export default function Demo() {
  useRouteScope('floor'); // shared dark theme; demo lives between the two tours

  const { slug } = useParams<{ slug: string }>();
  const c = slug ? getCreationBySlug(slug) : undefined;
  if (!c) return <NotFound />;

  // What a visitor would be able to do here in V2 — hand-curated per creation.
  const previewActions = previewFor(c.ticker);

  return (
    <div className="min-h-screen px-6 py-10 md:py-16">
      <div className="max-w-3xl mx-auto">
        <Link to="/floor" className="inline-block mb-8 text-[var(--floor-text-soft)] no-underline border-b border-dotted border-[var(--floor-line)] hover:text-[var(--floor-amber)]">
          ← back to the floor
        </Link>

        <div className="mb-3">
          <Tag tone={c.status === 'live' ? 'live' : c.status === 'in-production' ? 'in-progress' : 'strategic'}>
            {c.status}
          </Tag>
          <span className="ml-3 font-mono text-[0.78rem] text-[var(--floor-text-faint)] tracking-[0.15em] uppercase">
            {c.ticker} · demo
          </span>
        </div>

        <h1 className="font-sans text-3xl md:text-5xl font-semibold tracking-[-0.02em] text-[var(--floor-text)] mb-3">
          {c.name}
        </h1>
        <p className="text-[var(--floor-text-soft)] text-lg mb-8">{c.bus.tagline}</p>

        {/* Big "demo coming soon" panel */}
        <div className="bg-[var(--floor-bg-card)] border border-[var(--floor-line)] p-8 mb-8">
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-[var(--floor-amber)] mb-3">
            Interactive demo · coming in V2
          </div>
          <p className="text-[var(--floor-text)] mb-5 leading-relaxed">
            A self-contained, sandboxed demo of {c.name} is on the V2 roadmap. For now, here is what
            you would be able to do here when it ships:
          </p>
          <ul className="space-y-2.5 list-none">
            {previewActions.map((a) => (
              <li key={a} className="flex gap-3 items-start text-[var(--floor-text-soft)]">
                <span className="text-[var(--floor-gain)] mt-1">▸</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Live link if we have one — best alternative until the sandbox demo ships */}
        {c.liveUrl && (
          <div className="bg-[var(--floor-bg-soft)] border border-[var(--floor-line)] p-6 mb-8">
            <div className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-[var(--floor-text-faint)] mb-2">
              In the meantime
            </div>
            <p className="text-[var(--floor-text)] mb-3">
              {c.name} is already live — visit the production site directly:
            </p>
            <a
              href={c.liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--floor-amber)] text-[var(--floor-bg)] font-medium uppercase tracking-[0.12em] text-sm no-underline"
            >
              Open {c.liveUrl.replace(/^https?:\/\//, '')} ↗
            </a>
          </div>
        )}

        {/* Stack chips */}
        <div className="mb-8">
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-[var(--floor-text-faint)] mb-3">
            Built with
          </div>
          <div className="flex flex-wrap gap-1.5">
            {c.tech.stack.map((s) => (
              <Chip key={s} variant="floor">{s}</Chip>
            ))}
          </div>
        </div>

        {/* Cross-tour links */}
        <div className="flex flex-col md:flex-row gap-4 pt-6 border-t border-[var(--floor-line)]">
          <Link
            to={`/TechTour/creations/${c.slug}`}
            className="flex-1 px-5 py-4 bg-[var(--floor-bg-card)] border border-[var(--floor-line)] no-underline text-[var(--floor-text)] hover:border-[var(--floor-amber)] hover:text-[var(--floor-amber)] transition-colors"
          >
            <div className="text-[0.7rem] uppercase tracking-[0.15em] text-[var(--floor-text-faint)] mb-1">Technical Tour</div>
            <div>Stack details, architecture decisions →</div>
          </Link>
          <Link
            to={`/BusTour/creations/${c.slug}`}
            className="flex-1 px-5 py-4 bg-[var(--floor-bg-card)] border border-[var(--floor-line)] no-underline text-[var(--floor-text)] hover:border-[var(--floor-amber)] hover:text-[var(--floor-amber)] transition-colors"
          >
            <div className="text-[0.7rem] uppercase tracking-[0.15em] text-[var(--floor-text-faint)] mb-1">Business Tour</div>
            <div>The story and the why →</div>
          </Link>
        </div>
      </div>

      <NavigationWheel active="floor" />
    </div>
  );
}

/** Per-creation preview-action lists. Hand-curated, factually accurate. */
function previewFor(ticker: string): string[] {
  switch (ticker) {
    case 'GDGM':
      return [
        'Browse a sample member dossier with rounds, courses, and journal entries',
        'Spin the interactive globe to see lit course locations from a demo community',
        'Trace an example invitation chain — see how access actually works',
      ];
    case 'SLIFT':
      return [
        'Walk through a multi-tenant onboarding flow as a demo user',
        'Trigger an example compliance task and watch SoloLift run it end-to-end',
        'Inspect the operations dashboard a real customer sees',
      ];
    case 'VWPA':
      return [
        'Use the navigation wheel to dial into pre-loaded primitive operations',
        'Compare the wheel UI to the chat fallback for the same task',
        'Browse the primitive catalog with input/output schemas inline',
      ];
    case 'BSA':
      return [
        'Watch a 30-second sizzle reel from Episode 1 (rendering)',
        'See LoRA training samples for the family characters',
        'Skim the production pipeline diagram from script to final scene',
      ];
    case 'PIP':
      return [
        'Read the protocol whitepaper (post-filing redaction in V2)',
        'Browse the primitive registry with verification properties shown',
        'Try a metered API call against a mocked PIP endpoint',
      ];
    default:
      return ['Sample interactions will appear here.'];
  }
}
