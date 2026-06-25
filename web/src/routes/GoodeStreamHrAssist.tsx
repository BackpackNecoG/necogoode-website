import { useRouteScope } from '../lib/useRouteScope';
import { NavigationWheel } from '../components/domain/NavigationWheel';
import { getDemo } from '../data/goodestream';
import { GoodeStreamPage, Footer, P, DemoBlock, ScopeNote } from '../components/domain/goodestream/Shell';
import { HrAssist } from '../components/domain/goodestream/hrassist/HrAssist';

/**
 * /goodestream/hr-assist — Tier-1 HR Support Agent (retrieval-grounded).
 *
 * Three-part structure: Problem Statement → How We'd Target It → Working
 * Prototype. The prototype answers ONLY from the loaded documents and cites the
 * source passage; the small/fine-tuned-model approach is framed as roadmap.
 */
export default function GoodeStreamHrAssist() {
  useRouteScope('goodestream');
  const demo = getDemo('hr-assist');

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
            Grounded, auditable HR answers — <em className="italic text-[var(--splash-tech)]">not</em>{' '}
            confident guesses.
          </h1>
          <p className="font-serif italic text-[1.2rem] leading-relaxed text-[var(--splash-text-soft)]">
            {demo.tagline}
          </p>
        </header>

        <DemoBlock step="01" kicker="Problem Statement" title="The hard part isn't chat — it's grounding">
          <P>
            HR teams field high volumes of repetitive policy questions: accruals, leave eligibility,
            benefits windows, overtime rules. Answers must be grounded in the actual policy — a wrong
            or invented answer creates real compliance and trust risk. A generic chatbot that sounds
            authoritative but hallucinates is worse than no bot at all.
          </P>
          <P>
            So the problem isn&apos;t building a conversational interface. It&apos;s making every
            answer <em className="italic text-[var(--splash-text)]">traceable to a source passage</em>,
            and routing low-confidence cases to a human instead of bluffing.
          </P>
        </DemoBlock>

        <DemoBlock step="02" kicker="How We'd Target It" title="Retrieval-grounded, with a human escalation path">
          <P>
            A retrieval-grounded assistant that answers <strong className="text-[var(--splash-text)] font-medium">only
            from the loaded documents</strong>, with a citation back to the source passage. The flow:
          </P>
          <ol className="space-y-3 list-none mb-6 max-w-[680px]">
            {[
              ['Intake', 'Capture the employee question.'],
              ['Classify', 'Identify the policy area so retrieval is scoped.'],
              ['Retrieve', 'Pull the most relevant passage(s) from the active corpus.'],
              ['Answer with citation', 'Respond strictly from those passages, quoting the source.'],
              ['Escalate low confidence', 'If no passage clears the bar, flag for a human instead of guessing.'],
              ['Measure', 'Log the outcome to close the loop and improve coverage.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3 items-start">
                <span
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center font-mono text-[0.78rem]"
                  style={{ border: '1px solid var(--splash-tech)', color: 'var(--splash-tech)' }}
                >
                  {i + 1}
                </span>
                <span className="font-sans text-[1rem] leading-relaxed text-[var(--splash-text-soft)] pt-0.5">
                  <strong className="text-[var(--splash-text)] font-semibold">{t}.</strong> {d}
                </span>
              </li>
            ))}
          </ol>
          <P>
            <strong className="text-[var(--splash-text)] font-medium">Production direction (roadmap):</strong>{' '}
            building small / fine-tuned language models off the grounded dataset to further reduce
            hallucination risk and cost. The live prototype below demonstrates the grounded-retrieval
            version — the SLM approach is where this goes in production, stated plainly rather than implied.
          </P>
        </DemoBlock>

        <DemoBlock step="03" kicker="Working Prototype" title="Ask the active corpus — answers cite their source">
          <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
            <div className="min-w-0">
              <HrAssist />
            </div>
            <ScopeNote
              does="Answers HR policy questions strictly from the loaded documents and quotes the passage it used. Ships with a California HR/employment knowledge-base sample as the default corpus; you can upload your own policy text to re-ground it."
              doesnt="It does not answer from outside the loaded documents, and it is not legal advice. Low-confidence questions are flagged for human escalation rather than answered."
              guardrails="Runs server-side through an Azure Function (no API key in the browser); uploaded text is processed in memory and never persisted. Daily rate cap. Do not upload confidential or real personal data — use the provided sample."
            />
          </div>
        </DemoBlock>

        <Footer />
      </GoodeStreamPage>
      <NavigationWheel active="goodestream" />
    </>
  );
}
