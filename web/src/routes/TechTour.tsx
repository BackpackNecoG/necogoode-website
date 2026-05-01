import { useRouteScope } from '../lib/useRouteScope';
import { IdeChrome } from '../components/domain/ide/IdeChrome';
import { FileExplorer } from '../components/domain/ide/FileExplorer';
import { EditorPane } from '../components/domain/ide/EditorPane';
import { TerminalPane } from '../components/domain/ide/TerminalPane';
import { StatusBar } from '../components/domain/ide/StatusBar';

/**
 * /TechTour homepage — IDE-themed README of Neco Goode.
 * Mirrors docs/reference/O-ide.html.
 *
 * The README copy is hand-authored (vs. read from creations.ts) because it is
 * an author-voice intro, not derived from per-creation data.
 */
export default function TechTour() {
  useRouteScope('tech');

  return (
    <div className="min-h-screen flex flex-col">
      <IdeChrome titleText="README.md — necogoode/portfolio">
        <div className="grid grid-cols-[240px_1fr] grid-rows-[1fr_200px] flex-1 min-h-[640px]" style={{ height: 'calc(100vh - 64px)' }}>
          <FileExplorer activeFile="README.md" />
          <EditorPane
            tabs={[
              { icon: 'M↓', label: 'README.md', active: true, dirty: true },
              { icon: '{}', label: 'bio.md', active: false },
            ]}
            breadcrumb={
              <>
                necogoode <span className="text-[var(--tech-line)] mx-1.5">›</span>
                portfolio <span className="text-[var(--tech-line)] mx-1.5">›</span>
                <span className="text-[var(--tech-text-soft)]">README.md</span>
              </>
            }
            lineCount={32}
            activeLineNumber={9}
          >
            {/* Syntax-highlighted README — keep <span> classes in sync with theme.css token names */}
            <SC c="comment"># Neco Goode</SC>{'\n'}
            <SC c="comment">&gt; Senior Director of IT · Builder · Operator</SC>{'\n'}
            {'\n'}
            <SC c="dim">---</SC>{'\n'}
            {'\n'}
            <SC c="comment">## tldr</SC>{'\n'}
            {'\n'}
            <SC c="text">Most directors don&apos;t ship code. Most engineers don&apos;t run orgs.</SC>{'\n'}
            <span className="block bg-[rgba(137,180,250,0.06)] -mx-5 px-5">
              <SC c="text">I do </SC>
              <SC c="keyword">both</SC>
              <SC c="text">, and the </SC>
              <SC c="tag">/creations</SC>
              <SC c="text"> directory is the proof.</SC>
            </span>
            {'\n'}
            <SC c="comment">## stack</SC>{'\n'}
            {'\n'}
            <SC c="keyword">const</SC> <SC c="text">stack</SC> <SC c="op">=</SC> {'{'}{'\n'}
            {'  '}<SC c="prop">backend</SC>:  [<SC c="string">&apos;.NET 10&apos;</SC>, <SC c="string">&apos;Node&apos;</SC>, <SC c="string">&apos;Postgres&apos;</SC>],{'\n'}
            {'  '}<SC c="prop">frontend</SC>: [<SC c="string">&apos;React&apos;</SC>, <SC c="string">&apos;TypeScript&apos;</SC>, <SC c="string">&apos;Vite&apos;</SC>],{'\n'}
            {'  '}<SC c="prop">cloud</SC>:    [<SC c="string">&apos;Azure&apos;</SC>, <SC c="string">&apos;AWS&apos;</SC>],{'\n'}
            {'  '}<SC c="prop">ai</SC>:       [<SC c="string">&apos;Claude API&apos;</SC>, <SC c="string">&apos;agentic systems&apos;</SC>],{'\n'}
            {'  '}<SC c="prop">years</SC>:    <SC c="num">10</SC>,{'\n'}
            {'}'};{'\n'}
            {'\n'}
            <SC c="comment">## creations · 5 live</SC>{'\n'}
            {'\n'}
            <SC c="keyword">import</SC> {'{ '}
            <SC c="fn">GoodeGame</SC>, <SC c="fn">SoloLift</SC>, <SC c="fn">VibingWithPrimitiveAI</SC>,{'\n'}
            {'         '}<SC c="fn">ByteSizedAdventures</SC>, <SC c="fn">PIP</SC>{' }'} <SC c="keyword">from</SC> <SC c="string">&apos;./creations&apos;</SC>;{'\n'}
            {'\n'}
            <SC c="keyword">export const</SC> <SC c="text">portfolio</SC> <SC c="op">=</SC> [{'\n'}
            {'  '}<SC c="fn">GoodeGame</SC>,           <SC c="comment">// invitation-only golf community · live</SC>{'\n'}
            {'  '}<SC c="fn">SoloLift</SC>,            <SC c="comment">// production saas, real users · live</SC>{'\n'}
            {'  '}<SC c="fn">VibingWithPrimitiveAI</SC>, <SC c="comment">// ai platform · live</SC>{'\n'}
            {'  '}<SC c="fn">ByteSizedAdventures</SC>, <SC c="comment">// animated series · in production</SC>{'\n'}
            {'  '}<SC c="fn">PIP</SC>,                 <SC c="comment">// the moat · patent-stage</SC>{'\n'}
            ];{'\n'}
            {'\n'}
            <SC c="comment">// → click any creation in the file tree to read its story</SC>
          </EditorPane>
          <TerminalPane />
        </div>
      </IdeChrome>
      <StatusBar />
    </div>
  );
}

/**
 * Syntax-highlighting span. Maps a short class name to a CSS variable color.
 * Kept inline (not extracted to a utility file) because it's only used within
 * IDE-themed pages — a UI primitive would over-generalize this.
 */
function SC({
  c,
  children,
}: {
  c: 'keyword' | 'string' | 'comment' | 'fn' | 'prop' | 'num' | 'tag' | 'attr' | 'dim' | 'text' | 'op';
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    keyword: 'text-[var(--tech-syn-keyword)]',
    string: 'text-[var(--tech-syn-string)]',
    comment: 'text-[var(--tech-syn-comment)] italic',
    fn: 'text-[var(--tech-syn-fn)]',
    prop: 'text-[var(--tech-syn-prop)]',
    num: 'text-[var(--tech-syn-num)]',
    tag: 'text-[var(--tech-syn-tag)]',
    attr: 'text-[var(--tech-syn-attr)]',
    dim: 'text-[var(--tech-text-faint)]',
    text: 'text-[var(--tech-text)]',
    op: 'text-[var(--tech-text-soft)]',
  };
  return <span className={map[c]}>{children}</span>;
}
