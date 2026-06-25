import { Link } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';

/** 404 catch-all. Mirrors the splash palette so it doesn't look like a styling failure. */
export default function NotFound() {
  useRouteScope('splash');
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-lg">
        <div className="font-mono text-[0.72rem] tracking-[0.3em] text-[var(--splash-text-faint)] uppercase mb-4">
          404 · path not found
        </div>
        <h1 className="font-serif text-4xl md:text-5xl text-[var(--splash-text)] leading-tight tracking-[-0.025em] mb-4">
          You&apos;re off the <em className="italic text-[var(--splash-tech)]">map</em>.
        </h1>
        <p className="font-serif italic text-[var(--splash-text-soft)] text-lg mb-8">
          That URL does not match any of the rooms in this house.
        </p>
        <div className="flex flex-col md:flex-row gap-3 justify-center">
          <Link
            to="/"
            className="px-5 py-3 border border-[var(--splash-text-soft)] text-[var(--splash-text)] no-underline font-mono text-xs tracking-[0.15em] uppercase hover:border-[var(--splash-tech)] hover:text-[var(--splash-tech)]"
          >
            ← back home
          </Link>
          <Link
            to="/floor"
            className="px-5 py-3 border border-[var(--splash-bus)] text-[var(--splash-bus)] no-underline font-mono text-xs tracking-[0.15em] uppercase"
          >
            visit the trading floor →
          </Link>
        </div>
      </div>
    </div>
  );
}
