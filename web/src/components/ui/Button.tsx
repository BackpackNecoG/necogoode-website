import { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Variant = 'tech' | 'bus' | 'floor' | 'ghost';

const VARIANT: Record<Variant, string> = {
  tech: 'bg-[var(--tech-blue)] text-[var(--tech-bg-darker)] hover:bg-[var(--tech-syn-prop)] border-transparent',
  bus: 'bg-[var(--bus-ink)] text-[var(--bus-paper)] hover:bg-[var(--bus-rust)] border-transparent',
  floor: 'bg-[var(--floor-amber)] text-[var(--floor-bg)] hover:bg-[var(--floor-amber)]/80 border-transparent',
  ghost: 'bg-transparent text-current border-current/40 hover:border-current',
};

type CommonProps = {
  variant?: Variant;
  size?: 'sm' | 'md';
  children: ReactNode;
};

const SIZE = {
  sm: 'px-3 py-1.5 text-xs tracking-[0.12em]',
  md: 'px-5 py-2.5 text-sm tracking-[0.15em]',
};

const BASE = 'inline-flex items-center gap-2 uppercase font-medium border rounded-sm transition-colors no-underline';

/** Plain <button>. Use the Link variant for navigation. */
export function Button({
  variant = 'ghost',
  size = 'md',
  children,
  className = '',
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** React Router <Link> styled as a button. Use for in-app navigation. */
export function LinkButton({
  to,
  variant = 'ghost',
  size = 'md',
  children,
  className = '',
}: CommonProps & { to: string; className?: string }) {
  return (
    <Link to={to} className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`}>
      {children}
    </Link>
  );
}

/** Plain anchor styled as a button. Use for external links (live URLs, GitHub). */
export function AnchorButton({
  href,
  variant = 'ghost',
  size = 'md',
  children,
  className = '',
}: CommonProps & { href: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {children}
    </a>
  );
}
