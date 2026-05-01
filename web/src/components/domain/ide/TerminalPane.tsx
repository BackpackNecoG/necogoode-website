import { ReactNode } from 'react';

/**
 * IDE bottom terminal panel — decorative for V1 (per spec).
 * Accepts custom <body> content so the TechCreation page can show
 * a "git log" of architecture decisions instead of the default lines.
 */
export function TerminalPane({ children }: { children?: ReactNode }) {
  return (
    <div className="row-start-2 col-start-2 bg-[var(--tech-bg-darker)] border-t border-[var(--tech-bg-line)] flex flex-col min-h-0">
      <div className="flex items-center px-2 bg-[var(--tech-bg-soft)] border-b border-[var(--tech-bg-line)]">
        <button className="px-4 py-2 font-mono text-[0.72rem] uppercase tracking-[0.08em] text-[var(--tech-text)] border-b-2 border-[var(--tech-blue)] inline-flex items-center gap-1.5 bg-transparent">
          <span>Terminal</span>
          <span className="bg-[var(--tech-blue)] text-[var(--tech-bg-darker)] px-1.5 text-[0.62rem] rounded">1</span>
        </button>
        <button className="px-4 py-2 font-mono text-[0.72rem] uppercase tracking-[0.08em] text-[var(--tech-text-soft)] inline-flex items-center gap-1.5 bg-transparent border-b-2 border-transparent hover:text-[var(--tech-text)]">
          <span>Problems</span>
          <span className="bg-[var(--tech-bg-elev)] text-[var(--tech-text-faint)] px-1.5 text-[0.62rem] rounded">0</span>
        </button>
        <button className="px-4 py-2 font-mono text-[0.72rem] uppercase tracking-[0.08em] text-[var(--tech-text-soft)] bg-transparent border-b-2 border-transparent hover:text-[var(--tech-text)]">
          Output
        </button>
        <button className="px-4 py-2 font-mono text-[0.72rem] uppercase tracking-[0.08em] text-[var(--tech-text-soft)] bg-transparent border-b-2 border-transparent hover:text-[var(--tech-text)]">
          Debug Console
        </button>
        <span className="flex-1" />
        <span className="text-[var(--tech-text-faint)] text-[0.7rem] font-mono pr-2">bash · necogoode &nbsp;▾&nbsp; +&nbsp;×</span>
      </div>

      <div className="flex-1 px-5 py-3 overflow-y-auto font-mono text-[0.78rem] leading-[1.55]">
        {children ?? <DefaultTerminalLines />}
      </div>
    </div>
  );
}

function DefaultTerminalLines() {
  return (
    <>
      <Line>
        <Prompt /> <span className="text-[var(--tech-text)]">git status</span>
      </Line>
      <Line><span className="text-[var(--tech-text-soft)]">On branch <span className="text-[var(--tech-green)]">main</span></span></Line>
      <Line><span className="text-[var(--tech-text-soft)]">Your branch is up to date with <span className="text-[var(--tech-text-faint)]">&apos;origin/main&apos;</span>.</span></Line>
      <Line><span className="text-[var(--tech-text-soft)]">5 creations &middot; <span className="text-[var(--tech-green)]">all green</span> &middot; 0 incidents · 12 deploys this week</span></Line>

      <div className="mt-2">
        <Line>
          <Prompt /> <span className="text-[var(--tech-text)]">npm run hire-me</span>
        </Line>
        <Line><span className="text-[var(--tech-text-faint)]">&gt; portfolio@2.4.1 hire-me</span></Line>
        <Line><span className="text-[var(--tech-text-faint)]">&gt; opening contact details...</span></Line>
        <Line><span className="text-[var(--tech-green)]">✓</span> <span className="text-[var(--tech-text-soft)]">email: <span className="text-[var(--tech-green)]">hello@necogoode.com</span></span></Line>
        <Line><span className="text-[var(--tech-green)]">✓</span> <span className="text-[var(--tech-text-soft)]">linkedin: <span className="text-[var(--tech-green)]">/in/necogoode</span></span></Line>
        <Line><span className="text-[var(--tech-green)]">✓</span> <span className="text-[var(--tech-text-soft)]">github: <span className="text-[var(--tech-green)]">@necogoode</span></span></Line>
        <Line><span className="text-[var(--tech-green)]">✓</span> <span className="text-[var(--tech-text-soft)]">availability: <span className="text-[var(--tech-green)]">accepting new work</span></span></Line>
      </div>

      <div className="flex gap-2 items-center mt-2">
        <Prompt />
        <input
          type="text"
          placeholder="try: cd creations · cat bio.md · npm run hire-me"
          className="flex-1 bg-transparent border-none outline-none text-[var(--tech-text)] font-mono text-[0.78rem]"
        />
        <span className="inline-block w-2 h-3.5 bg-[var(--tech-text)] animate-pulse" />
      </div>
    </>
  );
}

function Line({ children }: { children: ReactNode }) {
  return <div className="flex gap-2">{children}</div>;
}

function Prompt() {
  return (
    <span className="text-[var(--tech-green)] flex-shrink-0">
      ~/portfolio <span className="text-[var(--tech-blue)]">▸</span>
    </span>
  );
}
