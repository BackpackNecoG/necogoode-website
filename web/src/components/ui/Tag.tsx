import { ReactNode } from 'react';

type TagTone = 'live' | 'in-progress' | 'strategic' | 'neutral';

const TONE_CLASS: Record<TagTone, string> = {
  live: 'bg-[var(--floor-gain-bg)] text-[var(--floor-gain)] border-[var(--floor-gain)]',
  'in-progress': 'bg-[var(--floor-amber-bg)] text-[var(--floor-amber)] border-[var(--floor-amber)]',
  strategic: 'bg-[var(--floor-bg-elev)] text-[var(--floor-text-soft)] border-[var(--floor-text-soft)]',
  neutral: 'bg-transparent text-[var(--floor-text-soft)] border-[var(--floor-line)]',
};

/** Status pill — used for creation statuses across all routes. */
export function Tag({ tone = 'neutral', children }: { tone?: TagTone; children: ReactNode }) {
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 px-2.5 py-1 text-[0.65rem] font-mono uppercase tracking-[0.15em] border rounded-sm ' +
        TONE_CLASS[tone]
      }
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
