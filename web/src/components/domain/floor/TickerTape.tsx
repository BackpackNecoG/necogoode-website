/**
 * Top scrolling ticker tape. Pure CSS animation — content static for V1.
 * Mirrors the tape from L-trading-floor.html.
 */

type Tick = { sym: string; val: string; delta: string; tone: 'up' | 'dn' | 'fl' };

const TICKS: Tick[] = [
  { sym: 'GDGM', val: 'LIVE', delta: '▲ rounds logged', tone: 'up' },
  { sym: 'SLIFT', val: 'USERS:GROWING', delta: '▲ 14.2%', tone: 'up' },
  { sym: 'VWPA', val: 'v2 SHIPPED', delta: '▲ uptime 99.8', tone: 'up' },
  { sym: 'BSA', val: 'EP1:RENDERING', delta: '◆ in production', tone: 'fl' },
  { sym: 'PIP', val: 'PATENT FILED', delta: '◆ moat: deepening', tone: 'fl' },
  { sym: 'NECO', val: 'accepting new work', delta: '▲ 5 live shipped', tone: 'up' },
];

export function TickerTape() {
  // Render twice so the loop is seamless during the animation cycle.
  const doubled = [...TICKS, ...TICKS];

  return (
    <div className="sticky top-0 z-50 overflow-hidden whitespace-nowrap py-2 border-b border-[var(--floor-line)]" style={{ background: '#050608' }}>
      <div className="inline-flex gap-10 pl-[100%]" style={{ animation: 'ticker-scroll 40s linear infinite' }}>
        {doubled.map((t, i) => (
          <span key={`${t.sym}-${i}`} className="text-[0.78rem] text-[var(--floor-text-soft)] tracking-wider">
            <span className="text-[var(--floor-text)] font-semibold mr-2">{t.sym}</span>
            <span className="text-[var(--floor-text)]">{t.val}</span>
            <span
              className={
                'ml-2 font-medium ' +
                (t.tone === 'up'
                  ? 'text-[var(--floor-gain)]'
                  : t.tone === 'dn'
                  ? 'text-[var(--floor-loss)]'
                  : 'text-[var(--floor-amber)]')
              }
            >
              {t.delta}
            </span>
          </span>
        ))}
      </div>
      <style>{`@keyframes ticker-scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }`}</style>
    </div>
  );
}
