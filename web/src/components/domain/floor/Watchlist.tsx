import { Link } from 'react-router-dom';
import { creations, type Creation } from '../../../data/creations';

/**
 * Watchlist table — five creations as rows, clickable to TechCreation pages.
 * Sparkline is a per-row decorative SVG; hand-tuned points per ticker.
 */
export function Watchlist() {
  return (
    <>
      <div className="grid items-center px-6 py-2.5 border-b border-[var(--floor-line)] bg-[var(--floor-bg-soft)] text-[0.7rem] tracking-[0.12em] uppercase text-[var(--floor-text-faint)]"
           style={{ gridTemplateColumns: '60px 1fr 110px 130px 110px 90px', gap: '1rem' }}>
        <div>Sym</div>
        <div>Name / Desc</div>
        <div className="text-right">Metric</div>
        <div className="text-right">Activity</div>
        <div>Trend</div>
        <div className="text-right">Status</div>
      </div>
      {creations.map((c) => (
        <WatchlistRow key={c.slug} creation={c} />
      ))}
    </>
  );
}

const SPARK_BY_TICKER: Record<string, { points: string; color: string }> = {
  GDGM:  { points: '0,22 10,20 20,17 30,18 40,12 50,14 60,8 70,10 80,5 90,6 100,3', color: 'var(--floor-gain)' },
  SLIFT: { points: '0,25 10,23 20,24 30,18 40,17 50,14 60,11 70,12 80,8 90,5 100,4', color: 'var(--floor-gain)' },
  VWPA:  { points: '0,18 10,20 20,15 30,17 40,10 50,12 60,7 70,9 80,5 90,7 100,3',   color: 'var(--floor-gain)' },
  BSA:   { points: '0,28 10,28 20,26 30,25 40,22 50,20 60,18 70,15 80,12 90,10 100,8', color: 'var(--floor-amber)' },
  PIP:   { points: '0,28 10,27 20,27 30,24 40,23 50,20 60,16 70,12 80,7 90,4 100,2', color: 'var(--floor-amber)' },
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  live: { text: 'LIVE', cls: 'text-[var(--floor-gain)]' },
  'in-production': { text: 'IN-PROD', cls: 'text-[var(--floor-amber)]' },
  strategic: { text: 'STRATEGIC', cls: 'text-[var(--floor-text-soft)]' },
};

function WatchlistRow({ creation: c }: { creation: Creation }) {
  const spark = SPARK_BY_TICKER[c.ticker];
  const status = STATUS_LABEL[c.status];
  const metric = c.metrics?.[0]?.value ?? c.tech.stack.slice(0, 1).join('');
  const activity = c.metrics?.[1]?.value ?? '';
  const isUp = c.status === 'live';

  return (
    <Link
      to={`/TechTour/creations/${c.slug}`}
      className="group grid items-center px-6 py-3.5 border-b border-[var(--floor-line)] no-underline text-[var(--floor-text)] hover:bg-[var(--floor-bg-soft)] transition-colors"
      style={{ gridTemplateColumns: '60px 1fr 110px 130px 110px 90px', gap: '1rem' }}
    >
      <div className="font-semibold text-[0.85rem] group-hover:text-[var(--floor-amber)] transition-colors">
        {c.ticker}
      </div>
      <div>
        <div className="font-medium text-[0.85rem]">{c.name}</div>
        <div className="text-[var(--floor-text-soft)] text-[0.72rem] font-sans mt-0.5 truncate">
          {c.tech.tagline.toLowerCase()}
        </div>
      </div>
      <div className="text-right text-[0.85rem] font-mono tabular-nums">{metric}</div>
      <div className={`text-right text-[0.78rem] font-medium ${isUp ? 'text-[var(--floor-gain)]' : 'text-[var(--floor-amber)]'}`}>
        {isUp ? '▲' : '◆'} {activity}
      </div>
      <div className="h-7 flex items-center">
        {spark && (
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-full">
            <polyline points={spark.points} fill="none" stroke={spark.color} strokeWidth={1.5} />
          </svg>
        )}
      </div>
      <div className={`flex items-center gap-1.5 text-[0.7rem] tracking-[0.1em] uppercase justify-end ${status.cls}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" style={{ boxShadow: '0 0 6px currentColor' }} />
        {status.text}
      </div>
    </Link>
  );
}
