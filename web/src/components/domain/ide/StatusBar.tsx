import { useEffect, useState } from 'react';

/** IDE bottom status bar with live Central-time clock. Decorative for V1 except the clock. */
export function StatusBar({
  language = 'Markdown',
  position = 'Ln 9, Col 24',
}: {
  language?: string;
  position?: string;
}) {
  const [clock, setClock] = useState(() => formatCentralTime());

  useEffect(() => {
    const interval = setInterval(() => setClock(formatCentralTime()), 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[var(--tech-blue)] text-[var(--tech-bg-darker)] px-3.5 py-1 flex justify-between font-mono text-[0.7rem] font-medium">
      <div className="flex gap-4 items-center flex-wrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--tech-bg-darker)]" />
          main
        </span>
        <span>↻ 0 ↑ 0</span>
        <span>⊘ 0 errors</span>
        <span>△ 0 warnings</span>
        <span>5 creations live</span>
      </div>
      <div className="flex gap-4 items-center flex-wrap">
        <span>{language}</span>
        <span>UTF-8</span>
        <span>LF</span>
        <span>{position}</span>
        <span>Spaces: 2</span>
        <span>{clock}</span>
      </div>
    </div>
  );
}

/**
 * Central-time clock string (HH:MM CDT/CST).
 * Browser's Intl handles DST shifts automatically; the suffix is hand-rolled.
 */
function formatCentralTime(): string {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', {
    hour12: false,
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
  });
  // Crude DST detection: CDT ≈ Mar–Nov in Texas
  const month = parseInt(now.toLocaleDateString('en-US', { month: 'numeric', timeZone: 'America/Chicago' }), 10);
  const tz = month >= 3 && month <= 10 ? 'CDT' : 'CST'; // (Unverified) edge cases at DST switchover days
  return `${time} ${tz}`;
}
