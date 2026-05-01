import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useRouteScope } from '../lib/useRouteScope';
import { getCreationBySlug } from '../data/creations';
import { IdeChrome } from '../components/domain/ide/IdeChrome';
import { FileExplorer } from '../components/domain/ide/FileExplorer';
import { StatusBar } from '../components/domain/ide/StatusBar';
import { Chip } from '../components/ui/Chip';
import { Tag } from '../components/ui/Tag';
import NotFound from './NotFound';

/**
 * /TechTour/creations/:slug
 *
 * IDE-themed deep dive on one creation. Layout:
 *   ┌─────────────┬──────────────────────────────┬────────────────┐
 *   │ FileExplorer│ Markdown writeup (editor)    │ Side panel:    │
 *   │             │                              │  - status      │
 *   │             │                              │  - stack chips │
 *   │             │                              │  - decisions   │
 *   │             │                              │  - live URL    │
 *   └─────────────┴──────────────────────────────┴────────────────┘
 *   │ TerminalPane (cross-tour + back-to-floor)                   │
 *   └─────────────────────────────────────────────────────────────┘
 *   StatusBar
 */
export default function TechCreation() {
  useRouteScope('tech');
  const { slug } = useParams<{ slug: string }>();
  const c = slug ? getCreationBySlug(slug) : undefined;

  if (!c) return <NotFound />;

  return (
    <div className="min-h-screen flex flex-col">
      <IdeChrome titleText={`${c.slug}.md — necogoode/portfolio`}>
        <div className="grid grid-cols-[240px_1fr_320px] grid-rows-[1fr_220px] flex-1 min-h-[640px]" style={{ height: 'calc(100vh - 64px)' }}>
          <FileExplorer activeFile={`${c.slug}.md`} />

          {/* Center: markdown editor — keeps tab/breadcrumb/lineNumber chrome from IDE */}
          <div className="row-start-1 col-start-2 bg-[var(--tech-bg)] flex flex-col min-w-0 overflow-hidden">
            <div className="flex bg-[var(--tech-bg-soft)] border-b border-[var(--tech-bg-line)] overflow-x-auto">
              <button className="px-4 py-2 font-mono text-[0.78rem] flex items-center gap-2 flex-shrink-0 bg-[var(--tech-bg)] text-[var(--tech-text)] border-r border-[var(--tech-bg-line)] border-b-2 border-b-[var(--tech-blue)]">
                <span className="text-[0.7rem]" style={{ color: 'var(--tech-syn-fn)' }}>M↓</span>
                <span>{c.slug}.md</span>
                <span className="text-[var(--tech-text-faint)] text-[0.85rem]">×</span>
              </button>
            </div>

            <div className="px-5 py-1.5 bg-[var(--tech-bg)] font-mono text-[0.7rem] text-[var(--tech-text-faint)] border-b border-[var(--tech-bg-line)] tracking-wide">
              necogoode <span className="text-[var(--tech-line)] mx-1.5">›</span>
              portfolio <span className="text-[var(--tech-line)] mx-1.5">›</span>
              creations <span className="text-[var(--tech-line)] mx-1.5">›</span>
              <span className="text-[var(--tech-text-soft)]">{c.slug}.md</span>
            </div>

            <div className="flex-1 overflow-y-auto px-10 py-8 font-mono text-[0.88rem] leading-[1.7] text-[var(--tech-text)]">
              {/* Title */}
              <h1 className="font-mono text-[1.5rem] text-[var(--tech-text)] mb-1">
                <span className="text-[var(--tech-syn-comment)]"># </span>
                {c.name}
              </h1>
              <div className="text-[var(--tech-syn-comment)] italic mb-6">
                &gt; <span className="text-[var(--tech-syn-string)]">{c.ticker}</span> · {c.tech.tagline}
              </div>

              <hr className="border-[var(--tech-bg-line)] my-6" />

              <h2 className="text-[var(--tech-syn-comment)] mb-3">## summary</h2>
              {c.tech.summary.split('\n\n').map((para, i) => (
                <p key={i} className="font-sans text-[0.95rem] text-[var(--tech-text-soft)] leading-relaxed mb-4">
                  {para}
                </p>
              ))}

              <h2 className="text-[var(--tech-syn-comment)] mt-8 mb-3">## stack</h2>
              <div className="flex flex-wrap gap-2 mb-6">
                {c.tech.stack.map((s) => (
                  <Chip key={s} variant="tech">{s}</Chip>
                ))}
              </div>

              <h2 className="text-[var(--tech-syn-comment)] mt-8 mb-3">## architecture decisions</h2>
              <div className="space-y-3 mb-8">
                {c.tech.decisions.map((d, i) => (
                  <DecisionCard key={d.title} index={i + 1} title={d.title} body={d.body} />
                ))}
              </div>

              {(c.liveUrl || c.tech.repo) && (
                <>
                  <h2 className="text-[var(--tech-syn-comment)] mt-8 mb-3">## links</h2>
                  <ul className="font-sans text-[0.95rem] text-[var(--tech-text-soft)] mb-6 list-none">
                    {c.liveUrl && (
                      <li className="mb-1">
                        <span className="text-[var(--tech-syn-keyword)]">live</span>{' '}
                        <a href={c.liveUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--tech-syn-fn)] underline underline-offset-2">
                          {c.liveUrl}
                        </a>
                      </li>
                    )}
                    {c.tech.repo && (
                      <li>
                        <span className="text-[var(--tech-syn-keyword)]">repo</span>{' '}
                        <a href={c.tech.repo} target="_blank" rel="noopener noreferrer" className="text-[var(--tech-syn-fn)] underline underline-offset-2">
                          {c.tech.repo}
                        </a>
                      </li>
                    )}
                  </ul>
                </>
              )}

              <hr className="border-[var(--tech-bg-line)] my-6" />

              <div className="font-sans text-[0.85rem] text-[var(--tech-text-soft)]">
                <Link to={`/BusTour/creations/${c.slug}`} className="text-[var(--tech-syn-fn)] underline underline-offset-2">
                  → View this creation in Business Tour
                </Link>
                {' · '}
                <Link to={c.demoUrl ?? `/demo/${c.slug}`} className="text-[var(--tech-syn-fn)] underline underline-offset-2">
                  → Open the demo
                </Link>
                {' · '}
                <Link to="/floor" className="text-[var(--tech-syn-fn)] underline underline-offset-2">
                  → Open this creation&apos;s pipeline ({c.ticker})
                </Link>
              </div>
            </div>
          </div>

          {/* Right side panel — replaces the minimap */}
          <aside className="row-start-1 col-start-3 bg-[var(--tech-bg-soft)] border-l border-[var(--tech-bg-line)] overflow-y-auto p-5 font-mono text-[0.78rem]">
            <div className="text-[var(--tech-text-faint)] uppercase text-[0.62rem] tracking-[0.15em] mb-2">Status</div>
            <Tag tone={c.status === 'live' ? 'live' : c.status === 'in-production' ? 'in-progress' : 'strategic'}>
              {c.status}
            </Tag>

            <div className="text-[var(--tech-text-faint)] uppercase text-[0.62rem] tracking-[0.15em] mt-6 mb-2">Stack</div>
            <div className="flex flex-wrap gap-1.5">
              {c.tech.stack.map((s) => (
                <Chip key={s} variant="tech">{s}</Chip>
              ))}
            </div>

            <div className="text-[var(--tech-text-faint)] uppercase text-[0.62rem] tracking-[0.15em] mt-6 mb-2">Decisions</div>
            <ul className="list-none space-y-1.5">
              {c.tech.decisions.map((d, i) => (
                <li key={d.title} className="text-[var(--tech-text-soft)] leading-tight">
                  <span className="text-[var(--tech-syn-num)]">{String(i + 1).padStart(2, '0')}</span>{' '}
                  {d.title}
                </li>
              ))}
            </ul>

            {c.liveUrl && (
              <>
                <div className="text-[var(--tech-text-faint)] uppercase text-[0.62rem] tracking-[0.15em] mt-6 mb-2">Live</div>
                <a
                  href={c.liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[var(--tech-syn-fn)] underline underline-offset-2 break-all"
                >
                  {c.liveUrl}
                </a>
              </>
            )}

            {c.metrics && (
              <>
                <div className="text-[var(--tech-text-faint)] uppercase text-[0.62rem] tracking-[0.15em] mt-6 mb-2">Metrics</div>
                <ul className="list-none space-y-1">
                  {c.metrics.map((m) => (
                    <li key={m.label} className="flex justify-between text-[var(--tech-text-soft)]">
                      <span>{m.label}</span>
                      <span className="text-[var(--tech-text)]">{m.value}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>

          {/* Terminal at the bottom — cross-tour link as a "git log" entry */}
          <div className="row-start-2 col-start-2 col-span-2 bg-[var(--tech-bg-darker)] border-t border-[var(--tech-bg-line)] flex flex-col min-h-0">
            <div className="flex items-center px-2 bg-[var(--tech-bg-soft)] border-b border-[var(--tech-bg-line)]">
              <span className="px-4 py-2 font-mono text-[0.72rem] uppercase tracking-[0.08em] text-[var(--tech-text)] border-b-2 border-[var(--tech-blue)] inline-flex items-center gap-1.5">
                <span>Terminal</span>
                <span className="bg-[var(--tech-blue)] text-[var(--tech-bg-darker)] px-1.5 text-[0.62rem] rounded">1</span>
              </span>
            </div>
            <div className="flex-1 px-5 py-3 overflow-y-auto font-mono text-[0.78rem] leading-[1.55]">
              <div className="text-[var(--tech-text-soft)]">
                <span className="text-[var(--tech-green)]">~/portfolio/creations/{c.slug} <span className="text-[var(--tech-blue)]">▸</span></span>{' '}
                <span className="text-[var(--tech-text)]">git log --oneline</span>
              </div>
              {c.tech.decisions.map((d, i) => (
                <div key={d.title} className="text-[var(--tech-text-soft)]">
                  <span className="text-[var(--tech-syn-num)]">{shortHash(c.slug, i)}</span>{' '}
                  <span className="text-[var(--tech-text)]">{d.title}</span>
                </div>
              ))}
              <div className="text-[var(--tech-text-soft)] mt-2">
                <span className="text-[var(--tech-green)]">~/portfolio/creations/{c.slug} <span className="text-[var(--tech-blue)]">▸</span></span>{' '}
                <span className="text-[var(--tech-text)]">npm run open --tour=business</span>
              </div>
              <div>
                <Link to={`/BusTour/creations/${c.slug}`} className="text-[var(--tech-syn-fn)] underline underline-offset-2">
                  &gt; switching to /BusTour/creations/{c.slug}…
                </Link>
              </div>
            </div>
          </div>
        </div>
      </IdeChrome>
      <StatusBar language="Markdown" position={`Ln 1, Col 1 · ${c.ticker}`} />
    </div>
  );
}

/**
 * Collapsible architecture decision card — closed by default.
 * Shown in the markdown body for full reading; the right sidebar shows a brief list.
 */
function DecisionCard({ index, title, body }: { index: number; title: string; body: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-[var(--tech-bg-line)] bg-[var(--tech-bg-soft)] rounded-sm">
      <button
        className="w-full text-left px-4 py-3 flex justify-between items-center text-[var(--tech-text)] hover:bg-[var(--tech-bg-elev)] font-mono text-[0.85rem]"
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          <span className="text-[var(--tech-syn-num)]">{String(index).padStart(2, '0')}.</span> {title}
        </span>
        <span className="text-[var(--tech-text-faint)]">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <p className="px-4 pb-4 font-sans text-[0.9rem] leading-relaxed text-[var(--tech-text-soft)] border-t border-[var(--tech-bg-line)] pt-3">
          {body}
        </p>
      )}
    </div>
  );
}

/** Generate a deterministic 7-char "commit hash" so the git-log feels real. */
function shortHash(slug: string, index: number): string {
  let h = 0;
  for (const ch of slug + index) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(16).padStart(7, '0').slice(0, 7);
}
