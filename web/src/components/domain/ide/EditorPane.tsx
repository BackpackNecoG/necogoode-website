import { ReactNode } from 'react';

export type EditorTab = {
  icon: string;        // 1-2 character glyph rendered before the tab label
  iconColor?: string;  // CSS color string for the icon
  label: string;
  active: boolean;
  dirty?: boolean;     // shows a small dot before the × indicating unsaved changes
};

/**
 * IDE editor area: tab strip + breadcrumb + editor body with line numbers + minimap.
 * The body content is passed in (so README.md content and the markdown-as-creation
 * content can both render through the same chrome).
 */
export function EditorPane({
  tabs,
  breadcrumb,
  lineCount,
  activeLineNumber,
  children,
}: {
  tabs: EditorTab[];
  breadcrumb: ReactNode;
  lineCount: number;
  activeLineNumber?: number;
  children: ReactNode;
}) {
  return (
    <div className="row-start-1 col-start-2 bg-[var(--tech-bg)] flex flex-col min-w-0 overflow-hidden">
      {/* Tab strip */}
      <div className="flex bg-[var(--tech-bg-soft)] border-b border-[var(--tech-bg-line)] overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.label}
            className={
              `px-4 py-2 font-mono text-[0.78rem] flex items-center gap-2 flex-shrink-0 bg-transparent border-r border-[var(--tech-bg-line)] border-b-2 transition-colors ` +
              (t.active
                ? 'bg-[var(--tech-bg)] text-[var(--tech-text)] border-b-[var(--tech-blue)]'
                : 'text-[var(--tech-text-soft)] border-b-transparent hover:text-[var(--tech-text)]')
            }
          >
            <span className="text-[0.7rem]" style={{ color: t.iconColor ?? 'var(--tech-syn-fn)' }}>{t.icon}</span>
            <span>{t.label}</span>
            {t.dirty && <span className="w-1.5 h-1.5 rounded-full bg-[var(--tech-text-faint)]" />}
            <span className="text-[var(--tech-text-faint)] text-[0.85rem]">×</span>
          </button>
        ))}
      </div>

      {/* Breadcrumb */}
      <div className="px-5 py-1.5 bg-[var(--tech-bg)] font-mono text-[0.7rem] text-[var(--tech-text-faint)] border-b border-[var(--tech-bg-line)] tracking-wide">
        {breadcrumb}
      </div>

      {/* Editor body */}
      <div className="flex-1 overflow-y-auto grid grid-cols-[60px_1fr_14px] bg-[var(--tech-bg)]">
        <LineNumbers count={lineCount} activeLine={activeLineNumber} />
        <pre className="px-5 py-4 font-mono text-[0.82rem] leading-[1.7] whitespace-pre overflow-x-auto text-[var(--tech-text)]">
          {children}
        </pre>
        <div className="bg-[var(--tech-bg-soft)] border-l border-[var(--tech-bg-line)]" aria-hidden />
      </div>
    </div>
  );
}

function LineNumbers({ count, activeLine }: { count: number; activeLine?: number }) {
  return (
    <div className="bg-[var(--tech-bg)] text-[var(--tech-text-faint)] text-right py-4 pr-2.5 font-mono text-[0.78rem] leading-[1.7] select-none border-r border-[var(--tech-bg-line)]">
      {Array.from({ length: count }, (_, i) => {
        const num = i + 1;
        const isActive = num === activeLine;
        return (
          <div key={num} className={isActive ? 'text-[var(--tech-text)]' : ''}>
            {num}
          </div>
        );
      })}
    </div>
  );
}
