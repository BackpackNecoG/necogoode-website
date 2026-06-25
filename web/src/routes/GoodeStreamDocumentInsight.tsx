import { useRouteScope } from '../lib/useRouteScope';
import { NavigationWheel } from '../components/domain/NavigationWheel';
import { getDemo } from '../data/goodestream';
import { GoodeStreamPage, Footer, P, DemoBlock, ScopeNote } from '../components/domain/goodestream/Shell';
import { DocumentInsight } from '../components/domain/goodestream/documentinsight/DocumentInsight';

/**
 * /goodestream/document-insight — Manager Enablement + JD Bias/Quality checker.
 *
 * Three-part structure: Problem Statement → How We'd Target It → Working
 * Prototype. One engine: upload a document, pick a purpose, get a structured
 * report with findings + suggested rewrites. Human-in-the-loop, assists never decides.
 */
export default function GoodeStreamDocumentInsight() {
  useRouteScope('goodestream');
  const demo = getDemo('document-insight');

  return (
    <>
      <GoodeStreamPage>
        <header className="pt-6 max-w-[820px]">
          <div className="font-mono text-[0.72rem] tracking-[0.3em] text-[var(--splash-text-faint)] uppercase mb-4">
            <span className="text-[var(--splash-tech)]">— </span>
            {demo.name}
          </div>
          <h1
            className="font-serif font-normal leading-[1.05] tracking-[-0.025em] mb-5 text-[var(--splash-text)]"
            style={{ fontSize: 'clamp(2.1rem, 4.8vw, 3.2rem)' }}
          >
            Evaluate a document against a rubric — get{' '}
            <em className="italic text-[var(--splash-tech)]">fair, concrete</em> rewrites.
          </h1>
          <p className="font-serif italic text-[1.2rem] leading-relaxed text-[var(--splash-text-soft)]">
            {demo.tagline}
          </p>
        </header>

        <DemoBlock step="01" kicker="Problem Statement" title="Two Talent pains, one shape">
          <P>
            Two recurring Talent problems look different but are mechanically identical. Managers
            write <strong className="text-[var(--splash-text)] font-medium">inconsistent, sometimes
            biased performance feedback</strong> — vague, non-actionable, or skewed. And job
            descriptions carry <strong className="text-[var(--splash-text)] font-medium">exclusionary
            language and inflated requirements</strong> that shrink and skew the candidate pool.
          </P>
          <P>
            Both are the same task: evaluate a document against a rubric and return concrete,
            fair improvements. That means one engine can serve both — with the rubric swapped per purpose.
          </P>
        </DemoBlock>

        <DemoBlock step="02" kicker="How We'd Target It" title="One analysis engine, a rubric per purpose">
          <P>
            Upload a document (<strong className="text-[var(--splash-text)] font-medium">.txt, .md, .pdf,
            or .docx</strong>), pick a <strong className="text-[var(--splash-text)] font-medium">purpose</strong>{' '}
            from a dropdown, and get a structured report: a short summary, flagged items with
            explanations, and specific suggested rewrites you can copy. The dropdown is built to extend
            — adding a new purpose is adding a new rubric, not a new engine.
          </P>
          <ul className="space-y-3 list-none mb-2 max-w-[680px]">
            <li className="pl-5 relative font-sans text-[1rem] leading-relaxed text-[var(--splash-text-soft)]">
              <span aria-hidden className="absolute left-0 top-[0.55em] w-2 h-2 rounded-full bg-[var(--splash-tech)]" />
              <strong className="text-[var(--splash-text)] font-semibold">Performance feedback review</strong> —
              clarity, specificity, actionability, and fairness / bias flags.
            </li>
            <li className="pl-5 relative font-sans text-[1rem] leading-relaxed text-[var(--splash-text-soft)]">
              <span aria-hidden className="absolute left-0 top-[0.55em] w-2 h-2 rounded-full bg-[var(--splash-tech)]" />
              <strong className="text-[var(--splash-text)] font-semibold">Job description — bias &amp; quality check</strong> —
              exclusionary language, inflated / unnecessary requirements, tone, and inclusivity.
            </li>
          </ul>
        </DemoBlock>

        <DemoBlock step="03" kicker="Working Prototype" title="Upload, choose a purpose, read the report">
          <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
            <div className="min-w-0">
              <DocumentInsight />
            </div>
            <ScopeNote
              does="Accepts .txt / .md / .pdf / .docx, runs the selected rubric, and returns a summary, flagged items with explanations, and suggested rewrites. Bundled sample documents for each purpose let you try it with zero upload."
              doesnt="It assists, it doesn't decide — every output is a suggestion for a human to weigh. It covers the two purposes above and is intentionally not exhaustive."
              guardrails="Files are parsed in your browser; only extracted text (size-capped) is sent to the Azure Function — documents are never persisted. Daily rate cap. Do not upload confidential data; samples provided."
            />
          </div>
        </DemoBlock>

        <Footer />
      </GoodeStreamPage>
      <NavigationWheel active="goodestream" />
    </>
  );
}
