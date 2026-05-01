import { InputHTMLAttributes, forwardRef } from 'react';

type Variant = 'tech' | 'floor';

const VARIANT: Record<Variant, string> = {
  tech: 'bg-transparent text-[var(--tech-text)] placeholder:text-[var(--tech-text-faint)] font-mono',
  floor: 'bg-transparent text-[var(--floor-text)] placeholder:text-[var(--floor-text-faint)] font-mono',
};

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { variant?: Variant }>(
  function Input({ variant = 'floor', className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`flex-1 outline-none border-none text-sm ${VARIANT[variant]} ${className}`}
        {...rest}
      />
    );
  },
);
