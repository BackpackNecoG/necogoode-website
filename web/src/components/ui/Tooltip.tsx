import { ReactNode, useState } from 'react';

/**
 * Lightweight hover-tooltip. CSS-only would clip on overflow:hidden parents
 * and we cannot afford that on /floor — so we use React state and absolute
 * positioning anchored to the wrapping span.
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="absolute z-50 bottom-[calc(100%+0.6rem)] left-1/2 -translate-x-1/2 w-[260px] p-3 text-[0.7rem] leading-snug font-sans normal-case tracking-normal text-[var(--floor-text)] bg-[var(--floor-bg-elev)] border border-[var(--floor-line-bright)] shadow-xl"
        >
          {content}
        </span>
      )}
    </span>
  );
}
