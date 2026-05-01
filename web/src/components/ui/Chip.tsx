import { ReactNode } from 'react';

type ChipVariant = 'tech' | 'bus' | 'floor';

const VARIANT_CLASS: Record<ChipVariant, string> = {
  tech: 'bg-[var(--tech-bg-elev)] text-[var(--tech-text)] border-[var(--tech-line)] font-mono',
  bus: 'bg-[var(--bus-paper-warm)] text-[var(--bus-ink)] border-[var(--bus-pencil)] font-sans',
  floor: 'bg-[var(--floor-bg-card)] text-[var(--floor-text)] border-[var(--floor-line)] font-mono',
};

/** Stack/tag chip — used wherever we list a stack item or short label. */
export function Chip({ variant = 'tech', children }: { variant?: ChipVariant; children: ReactNode }) {
  return (
    <span
      className={
        'inline-flex items-center px-2.5 py-1 text-[0.7rem] tracking-wide border rounded-sm whitespace-nowrap ' +
        VARIANT_CLASS[variant]
      }
    >
      {children}
    </span>
  );
}
