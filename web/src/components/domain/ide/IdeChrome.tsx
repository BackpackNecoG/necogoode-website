import { ReactNode } from 'react';

/**
 * Outer window chrome: titlebar + menubar.
 * Reused by TechTour homepage and TechCreation detail pages.
 */
export function IdeChrome({ titleText, children }: { titleText: string; children: ReactNode }) {
  return (
    <>
      {/* Titlebar */}
      <div className="flex items-center gap-3 px-3.5 py-2 bg-[var(--tech-bg-soft)] border-b border-[var(--tech-bg-line)] text-xs">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[var(--tech-pink)]" />
          <div className="w-3 h-3 rounded-full bg-[var(--tech-yellow)]" />
          <div className="w-3 h-3 rounded-full bg-[var(--tech-green)]" />
        </div>
        <div className="flex-1 text-center text-[var(--tech-text-faint)] font-mono text-[0.72rem] tracking-wide">
          {titleText}
        </div>
        <div className="text-[var(--tech-text-faint)] font-mono text-[0.7rem]">⌘ + ⌘ - ⌘ ⏵</div>
      </div>

      {/* Menubar */}
      <div className="flex gap-4 px-3.5 py-1.5 bg-[var(--tech-bg-soft)] border-b border-[var(--tech-bg-line)] text-[0.78rem] text-[var(--tech-text-soft)] font-mono">
        {['File', 'Edit', 'View', 'Selection', 'Go', 'Run', 'Terminal', 'Help'].map((label) => (
          <span key={label} className="hover:text-[var(--tech-text)] cursor-default">
            {label}
          </span>
        ))}
      </div>

      {children}
    </>
  );
}
