import { HTMLAttributes, ReactNode } from 'react';

/** Page-section wrapper with consistent vertical rhythm. Used by long-form pages. */
export function Section({
  children,
  className = '',
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <section className={`max-w-5xl mx-auto px-6 md:px-10 py-10 md:py-16 ${className}`} {...rest}>
      {children}
    </section>
  );
}
