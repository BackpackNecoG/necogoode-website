/**
 * Hand-styled "object" visuals for each Workshop creation card.
 * Each visual is intentionally unique — these are not parameterized
 * because the whole point of the workshop layout is that each creation
 * looks like a different object on the bench.
 */

export function GoodeGameVisual() {
  return (
    <div
      className="w-full h-full flex items-center justify-center relative"
      style={{ background: 'radial-gradient(circle at 30% 30%, #1a4d32, #0a1f14 75%)' }}
    >
      <div
        className="relative w-40 h-40 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 25% 25%, rgba(232,201,118,0.3), transparent 60%), repeating-radial-gradient(circle at center, transparent 0, transparent 4px, rgba(232,201,118,0.15) 4px, rgba(232,201,118,0.15) 5px), radial-gradient(circle at center, #1a4d32, #0a1f14)',
          boxShadow: 'inset -10px -10px 30px rgba(0,0,0,0.6), 0 0 30px rgba(232,201,118,0.2)',
        }}
      />
      <span className="absolute bottom-3 left-3 font-hand text-[0.95rem]" style={{ color: 'rgba(232,201,118,0.6)', transform: 'rotate(-3deg)' }}>
        globe.svg
      </span>
    </div>
  );
}

export function SoloLiftVisual() {
  return (
    <div
      className="w-full h-full p-5 flex flex-col gap-2"
      style={{
        background: 'var(--bus-paper-dark)',
        backgroundImage:
          'linear-gradient(to bottom, transparent 22px, rgba(74,58,40,0.15) 23px), repeating-linear-gradient(0deg, transparent 0px, transparent 22px, rgba(74,58,40,0.08) 22px, rgba(74,58,40,0.08) 23px)',
      }}
    >
      <div className="h-7 rounded-sm" style={{ background: 'var(--bus-brass)' }} />
      <div className="h-[18px] rounded-sm opacity-60" style={{ background: 'var(--bus-ink-soft)' }} />
      <div className="h-[18px] w-1/2 rounded-sm" style={{ background: 'var(--bus-rust)' }} />
      <div className="h-[18px] w-3/4 rounded-sm" style={{ background: 'var(--bus-green)' }} />
      <div className="flex gap-2 items-end h-[60px]">
        <Bar pct={40} />
        <Bar pct={70} bg="var(--bus-rust)" />
        <Bar pct={55} />
        <Bar pct={90} bg="var(--bus-green)" />
        <Bar pct={60} />
      </div>
    </div>
  );
}

function Bar({ pct, bg = 'var(--bus-ink-soft)' }: { pct: number; bg?: string }) {
  return <div className="flex-1 rounded-t-sm opacity-70" style={{ height: `${pct}%`, background: bg }} />;
}

export function VibingVisual() {
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1a1a2e, #16213e)' }}>
      <div className="relative w-44 h-44 rounded-full border-2 flex items-center justify-center" style={{ borderColor: 'rgba(232,193,112,0.4)' }}>
        <div className="w-[60%] h-[60%] rounded-full border border-dashed" style={{ borderColor: 'rgba(232,193,112,0.5)' }} />
        {/* spokes */}
        <Spoke x="50%" y="8px" />
        <Spoke x="calc(100% - 8px)" y="50%" />
        <Spoke x="50%" y="calc(100% - 8px)" />
        <Spoke x="8px" y="50%" />
        <Spoke x="78%" y="22%" />
        <Spoke x="22%" y="78%" />
      </div>
    </div>
  );
}

function Spoke({ x, y }: { x: string; y: string }) {
  return (
    <div
      className="absolute w-3 h-3 rounded-full"
      style={{
        top: y,
        left: x,
        transform: 'translate(-50%, -50%)',
        background: 'var(--bus-brass-bright)',
        boxShadow: '0 0 12px var(--bus-brass-bright)',
      }}
    />
  );
}

export function ByteSizedVisual() {
  return (
    <div
      className="w-full h-full flex items-end justify-center gap-2 pb-4 overflow-visible"
      style={{ background: 'linear-gradient(180deg, #FFE5B4 0%, #FFC5A2 60%, #F4A582 100%)' }}
    >
      <Character height={80} width={60} bg="var(--bus-rust)" eyeOffset={14} />
      <Character height={60} width={50} bg="var(--bus-green)" eyeOffset={12} eyeSize={6} />
      <Character height={45} width={40} bg="var(--bus-brass)" eyeOffset={10} eyeSize={5} />
    </div>
  );
}

function Character({
  height,
  width,
  bg,
  eyeOffset,
  eyeSize = 8,
}: {
  height: number;
  width: number;
  bg: string;
  eyeOffset: number;
  eyeSize?: number;
}) {
  return (
    <div
      className="relative shadow-[0_4px_8px_rgba(0,0,0,0.2)]"
      style={{
        height: `${height}px`,
        width: `${width}px`,
        background: bg,
        borderRadius: `${width / 2}px ${width / 2}px 8px 8px`,
      }}
    >
      <div
        className="absolute left-1/2 -translate-x-1/2 bg-white rounded-full"
        style={{
          top: `${height * 0.15}px`,
          width: `${eyeSize}px`,
          height: `${eyeSize}px`,
          boxShadow: `${eyeOffset}px 0 0 white`,
        }}
      />
    </div>
  );
}

export function GoodeTalentVisual() {
  // An org/talent network: people nodes connected to a brass "AI-assisted" hub.
  const people: Array<[number, number]> = [
    [70, 70],
    [120, 150],
    [180, 185],
    [250, 150],
    [295, 78],
    [185, 60],
  ];
  const hub: [number, number] = [185, 120];
  return (
    <div
      className="w-full h-full relative"
      style={{ background: 'linear-gradient(135deg, #21343C, #15232B 70%)' }}
    >
      <svg viewBox="0 0 360 240" className="w-full h-full" aria-hidden preserveAspectRatio="xMidYMid slice">
        {/* connections from hub to each person */}
        {people.map(([x, y], i) => (
          <line
            key={i}
            x1={hub[0]}
            y1={hub[1]}
            x2={x}
            y2={y}
            stroke="var(--bus-brass)"
            strokeOpacity={0.45}
            strokeWidth={1.25}
          />
        ))}
        {/* people nodes */}
        {people.map(([x, y], i) => (
          <g key={`p${i}`}>
            <circle cx={x} cy={y} r={12} fill="var(--bus-paper)" stroke="var(--bus-wood-dark)" strokeWidth={1} />
            <circle cx={x} cy={y - 3} r={3.4} fill="var(--bus-wood-dark)" />
            <path d={`M ${x - 6} ${y + 7} q 6 -7 12 0`} fill="var(--bus-wood-dark)" />
          </g>
        ))}
        {/* AI-assisted hub */}
        <circle cx={hub[0]} cy={hub[1]} r={22} fill="var(--bus-brass-bright)" />
        <circle cx={hub[0]} cy={hub[1]} r={22} fill="none" stroke="var(--bus-brass)" strokeWidth={2} />
        <text x={hub[0]} y={hub[1] + 4} textAnchor="middle" fontSize="11" fontFamily="monospace" fill="var(--bus-wood-deep)">
          AI
        </text>
        {/* spark */}
        <text x={hub[0] + 20} y={hub[1] - 16} fontSize="16" fill="var(--bus-brass-bright)">
          ✦
        </text>
      </svg>
      <span
        className="absolute bottom-3 left-3 font-hand text-[0.95rem]"
        style={{ color: 'rgba(232,193,112,0.85)', transform: 'rotate(-3deg)' }}
      >
        talent + ai
      </span>
    </div>
  );
}

export function PIPVisual() {
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{
        background: '#1A3858',
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="text-center font-hand">
        <div className="relative w-24 h-24 rounded-full border-2 mx-auto mb-3" style={{ borderColor: 'rgba(255,255,255,0.85)' }}>
          <div
            className="absolute top-1/2 left-1/2 h-[1.5px] origin-left"
            style={{
              width: '140px',
              background: 'rgba(255,255,255,0.85)',
              transform: 'translate(0, -50%) rotate(35deg)',
            }}
          />
          <div
            className="absolute top-1/2 left-1/2 h-[1.5px] origin-left"
            style={{
              width: '140px',
              background: 'rgba(255,255,255,0.85)',
              transform: 'translate(0, -50%) rotate(-35deg)',
            }}
          />
        </div>
        <div className="text-[1.1rem] tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.85)' }}>
          PIP
        </div>
      </div>
    </div>
  );
}
