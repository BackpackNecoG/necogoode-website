import { HTMLAttributes, ReactNode } from 'react';

type Level = 1 | 2 | 3;
type Variant = 'tech' | 'bus' | 'floor';

const VARIANT_BY_LEVEL: Record<Variant, Record<Level, string>> = {
  tech: {
    1: 'font-mono text-2xl md:text-3xl text-[var(--tech-text)] tracking-tight',
    2: 'font-mono text-xl text-[var(--tech-text)] tracking-tight',
    3: 'font-mono text-base text-[var(--tech-text-soft)] uppercase tracking-[0.15em]',
  },
  bus: {
    1: 'font-serif text-4xl md:text-5xl text-[var(--bus-ink)] leading-[1.05] tracking-[-0.025em]',
    2: 'font-serif text-2xl md:text-3xl text-[var(--bus-ink)] leading-tight tracking-[-0.015em]',
    3: 'font-hand text-xl text-[var(--bus-rust)]',
  },
  floor: {
    1: 'font-sans text-2xl md:text-3xl text-[var(--floor-text)] tracking-[-0.025em] font-semibold',
    2: 'font-mono text-base text-[var(--floor-text)] uppercase tracking-[0.12em]',
    3: 'font-mono text-xs text-[var(--floor-text-faint)] uppercase tracking-[0.15em]',
  },
};

/** Headings, scoped per palette. Always use this rather than raw <h1>/<h2>/<h3>. */
export function Heading({
  level = 1,
  variant = 'tech',
  children,
  className = '',
  ...rest
}: { level?: Level; variant?: Variant; children: ReactNode } & HTMLAttributes<HTMLHeadingElement>) {
  const cls = `${VARIANT_BY_LEVEL[variant][level]} ${className}`;
  if (level === 1) return <h1 className={cls} {...rest}>{children}</h1>;
  if (level === 2) return <h2 className={cls} {...rest}>{children}</h2>;
  return <h3 className={cls} {...rest}>{children}</h3>;
}
