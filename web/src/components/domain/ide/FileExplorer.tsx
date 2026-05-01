import { Link, useLocation } from 'react-router-dom';
import { creations } from '../../../data/creations';

const STATUS_BADGE: Record<string, { glyph: string; cls: string }> = {
  live: { glyph: '●', cls: 'text-[var(--tech-green)]' },
  'in-production': { glyph: '◆', cls: 'text-[var(--tech-yellow)]' },
  strategic: { glyph: '◇', cls: 'text-[var(--tech-blue)]' },
};

/**
 * Left sidebar: file-explorer tree of creations + meta files.
 * Active state highlights the current /TechTour/creations/:slug.
 */
export function FileExplorer({ activeFile = 'README.md' }: { activeFile?: string }) {
  const { pathname } = useLocation();
  const activeSlug = pathname.startsWith('/TechTour/creations/')
    ? pathname.split('/').pop()
    : null;

  return (
    <div className="row-span-2 bg-[var(--tech-bg-soft)] border-r border-[var(--tech-bg-line)] overflow-y-auto font-mono text-[0.78rem]">
      <div className="flex justify-between px-3.5 py-2.5 border-b border-[var(--tech-bg-line)] text-[var(--tech-text-faint)] uppercase text-[0.65rem] tracking-[0.15em]">
        <span>Explorer</span>
        <span>…</span>
      </div>

      <div className="px-3.5 pt-3.5 pb-1 text-[var(--tech-text-faint)] uppercase text-[0.62rem] tracking-[0.15em]">
        Open Editors
      </div>
      <div className="py-1.5">
        <TreeRow indent={0} active={!activeSlug && activeFile === 'README.md'}>
          <FileIcon /> {activeFile}
        </TreeRow>
      </div>

      <div className="px-3.5 pt-3.5 pb-1 text-[var(--tech-text-faint)] uppercase text-[0.62rem] tracking-[0.15em]">
        necogoode/portfolio
      </div>
      <div className="py-1.5">
        <TreeFolder>creations</TreeFolder>
        {creations.map((c) => {
          const badge = STATUS_BADGE[c.status];
          const isActive = activeSlug === c.slug;
          return (
            <TreeLink key={c.slug} to={`/TechTour/creations/${c.slug}`} indent={1} active={isActive}>
              <span className="text-[var(--tech-text-faint)] mr-2">📁</span>
              <span className="flex-1 truncate">{c.slug}</span>
              <span className={`ml-auto text-[0.62rem] ${badge.cls}`}>{badge.glyph}</span>
            </TreeLink>
          );
        })}

        <div className="mt-2">
          <TreeFolder>about</TreeFolder>
          <TreeLink to="/TechTour" indent={1}><FileIcon /> bio.md</TreeLink>
          <TreeLink to="/TechTour" indent={1}><FileIcon /> stack.md</TreeLink>
          <TreeLink to="/TechTour" indent={1}><FileIcon /> resume.pdf</TreeLink>
        </div>

        <div className="mt-2">
          <TreeFolder>contact</TreeFolder>
          <TreeLink to="/TechTour" indent={1}><FileIcon /> email.txt</TreeLink>
          <TreeLink to="/TechTour" indent={1}><FileIcon /> linkedin.url</TreeLink>
          <TreeLink to="/TechTour" indent={1}><FileIcon /> github.url</TreeLink>
        </div>

        <div className="mt-2">
          <TreeRow indent={0}>
            <FileIcon /> .env
            <span className="ml-auto text-[0.7rem] text-[var(--tech-text-faint)]">— hidden</span>
          </TreeRow>
          <TreeRow indent={0}><FileIcon /> README.md</TreeRow>
          <TreeRow indent={0}><FileIcon /> package.json</TreeRow>
        </div>
      </div>
    </div>
  );
}

function FileIcon() {
  return <span className="text-[var(--tech-text-faint)] mr-2">📄</span>;
}

function TreeFolder({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3.5 py-1 font-medium text-[var(--tech-text)] flex items-center gap-1.5">
      <span className="text-[var(--tech-syn-attr)]">▾</span>
      {children}
    </div>
  );
}

function TreeRow({ indent = 0, active = false, children }: { indent?: number; active?: boolean; children: React.ReactNode }) {
  const pad = indent === 0 ? 'pl-3.5' : indent === 1 ? 'pl-7' : 'pl-11';
  const activeCls = active
    ? 'bg-[var(--tech-bg-elev)] text-[var(--tech-text)] border-l-2 border-[var(--tech-blue)]'
    : 'text-[var(--tech-text-soft)] border-l-2 border-transparent';
  return (
    <div className={`${pad} pr-3.5 py-0.5 flex items-center gap-1.5 ${activeCls}`}>
      {children}
    </div>
  );
}

function TreeLink({
  to,
  indent = 0,
  active = false,
  children,
}: {
  to: string;
  indent?: number;
  active?: boolean;
  children: React.ReactNode;
}) {
  const pad = indent === 0 ? 'pl-3.5' : indent === 1 ? 'pl-7' : 'pl-11';
  const activeCls = active
    ? 'bg-[var(--tech-bg-elev)] text-[var(--tech-text)] border-l-2 border-[var(--tech-blue)]'
    : 'text-[var(--tech-text-soft)] border-l-2 border-transparent hover:bg-[var(--tech-bg-elev)] hover:text-[var(--tech-text)]';
  return (
    <Link to={to} className={`${pad} pr-3.5 py-0.5 flex items-center gap-1.5 no-underline transition-colors ${activeCls}`}>
      {children}
    </Link>
  );
}
