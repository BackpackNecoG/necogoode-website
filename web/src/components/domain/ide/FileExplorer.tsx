import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { creations } from '../../../data/creations';
import { ContactModal } from '../ContactModal';

const STATUS_BADGE: Record<string, { glyph: string; cls: string }> = {
  live: { glyph: '●', cls: 'text-[var(--tech-green)]' },
  'in-production': { glyph: '◆', cls: 'text-[var(--tech-yellow)]' },
  strategic: { glyph: '◇', cls: 'text-[var(--tech-blue)]' },
};

const LINKEDIN_URL = 'https://www.linkedin.com/in/neco-goode';
const GITHUB_URL = 'https://github.com/BackpackNecoG';

/**
 * Left sidebar: file-explorer tree of creations + meta files.
 *
 * - creation rows route to /TechTour/creations/:slug
 * - email.txt opens a contact modal that drafts a mailto: to me@necogoode.com
 * - linkedin.url + github.url open the live profiles in a popup window
 *   (window.open with sized features; fallback to a normal tab if blocked)
 */
export function FileExplorer({ activeFile = 'README.md' }: { activeFile?: string }) {
  const { pathname } = useLocation();
  const activeSlug = pathname.startsWith('/TechTour/creations/')
    ? pathname.split('/').pop()
    : null;

  const [contactOpen, setContactOpen] = useState(false);

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
        </div>

        <div className="mt-2">
          <TreeFolder>contact</TreeFolder>
          <TreeAction indent={1} onClick={() => setContactOpen(true)}>
            <FileIcon /> email.txt
          </TreeAction>
          <TreeAction indent={1} onClick={() => openInPopup(LINKEDIN_URL, 'LinkedIn')}>
            <FileIcon /> linkedin.url
          </TreeAction>
          <TreeAction indent={1} onClick={() => openInPopup(GITHUB_URL, 'GitHub')}>
            <FileIcon /> github.url
          </TreeAction>
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

      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}

/**
 * Open a URL in a popup window. Falls back to a new tab if the browser blocks
 * the popup (most do unless the call is in a direct user gesture, which it is here).
 */
function openInPopup(url: string, name: string): void {
  const features = 'noopener,noreferrer,width=900,height=720,menubar=no,toolbar=no';
  const w = window.open(url, name, features);
  if (!w) {
    // Popup was blocked — fall back to standard new-tab navigation.
    window.open(url, '_blank', 'noopener,noreferrer');
  }
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

/** Same look as TreeLink but invokes a callback (modal open / popup open) instead of routing. */
function TreeAction({
  indent = 0,
  onClick,
  children,
}: {
  indent?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const pad = indent === 0 ? 'pl-3.5' : indent === 1 ? 'pl-7' : 'pl-11';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${pad} pr-3.5 py-0.5 flex items-center gap-1.5 w-full text-left bg-transparent border-l-2 border-transparent text-[var(--tech-text-soft)] hover:bg-[var(--tech-bg-elev)] hover:text-[var(--tech-text)] transition-colors`}
    >
      {children}
    </button>
  );
}
