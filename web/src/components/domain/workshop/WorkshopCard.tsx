import { Link } from 'react-router-dom';
import { ReactNode } from 'react';

/**
 * Reusable workshop "object on the bench" card.
 * Each creation passes in its own custom .cr-visual content; the body / tilt /
 * pin / hover behavior is shared.
 *
 * Tilt is applied via inline style (--tilt) so the parent can stagger angles.
 */
export function WorkshopCard({
  to,
  tagline,
  name,
  description,
  tiltDeg,
  visual,
}: {
  to: string;
  tagline: string;
  name: string;
  description: string;
  tiltDeg: number;
  visual: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group relative flex-shrink-0 w-[360px] bg-[var(--bus-paper)] text-[var(--bus-ink)] no-underline shadow-[4px_8px_20px_rgba(0,0,0,0.35)] hover:shadow-[6px_14px_30px_rgba(0,0,0,0.5)] transition-all duration-[400ms] hover:-translate-y-3 hover:!rotate-0"
      style={{ transform: `rotate(${tiltDeg}deg)` }}
    >
      <div className="absolute -top-2.5 right-5 w-6 h-6 rounded-full z-10 shadow-[0_4px_8px_rgba(0,0,0,0.4),inset_-2px_-2px_4px_rgba(0,0,0,0.4)]"
           style={{ background: 'radial-gradient(circle at 30% 30%, var(--bus-rust), #6B2C12)' }}>
        <span className="absolute top-[7px] left-[7px] w-1.5 h-1.5 rounded-full bg-white/50 blur-[1px]" />
      </div>

      <div className="h-60 flex items-center justify-center relative overflow-hidden">
        {visual}
      </div>

      <div className="p-6 pt-6 pb-7 border-t border-dashed border-[rgba(74,58,40,0.3)]">
        <div className="font-hand text-[1.05rem] text-[var(--bus-rust)] mb-1.5">— {tagline}</div>
        <h3 className="font-serif text-[1.7rem] font-semibold leading-[1.05] tracking-[-0.015em] mb-2.5 text-[var(--bus-ink)]">
          {name}
        </h3>
        <p className="text-[0.92rem] leading-relaxed text-[var(--bus-ink-soft)] mb-4">
          {description}
        </p>
        <span className="text-[0.78rem] tracking-[0.15em] uppercase text-[var(--bus-ink)] font-semibold border-b-[1.5px] border-[var(--bus-rust)] pb-px transition-colors group-hover:text-[var(--bus-rust)]">
          Read the story →
        </span>
      </div>
    </Link>
  );
}
