import { HTMLAttributes, ReactNode } from 'react';

type CardVariant = 'tech' | 'bus' | 'floor';

const VARIANT: Record<CardVariant, string> = {
  tech: 'bg-[var(--tech-bg-soft)] border border-[var(--tech-line-soft)] text-[var(--tech-text)]',
  bus: 'bg-[var(--bus-paper)] text-[var(--bus-ink)] shadow-[4px_8px_20px_rgba(0,0,0,0.35)]',
  floor: 'bg-[var(--floor-bg-card)] border border-[var(--floor-line)] text-[var(--floor-text)]',
};

/** Generic content container. Variant maps to active route palette. */
export function Card({
  variant = 'tech',
  children,
  className = '',
  ...rest
}: { variant?: CardVariant; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`${VARIANT[variant]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
