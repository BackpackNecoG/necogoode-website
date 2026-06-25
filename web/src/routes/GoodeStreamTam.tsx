import { useRouteScope } from '../lib/useRouteScope';
import { NavigationWheel } from '../components/domain/NavigationWheel';
import { getDemo } from '../data/goodestream';
import { GoodeStreamPage, Footer, P, DemoBlock, ScopeNote } from '../components/domain/goodestream/Shell';
import { TamDashboard } from '../components/domain/goodestream/tam/TamDashboard';

/**
 * /goodestream/tam — Talent Adoption Matrix.
 *
 * Three-part structure: Problem Statement → How We'd Target It → Working
 * Prototype. The prototype is a fully client-side dashboard (TamDashboard):
 * sample data on load, downloadable template, bring-your-own-data upload.
 */
export default function GoodeStreamTam() {
  useRouteScope('goodestream');
  const demo = getDemo('tam');

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
            The measurement layer that turns <em className="italic text-[var(--splash-tech)]">pilots</em>{' '}
            into durable value.
          </h1>
          <p className="font-serif italic text-[1.2rem] leading-relaxed text-[var(--splash-text-soft)]">
            {demo.tagline}
          </p>
        </header>

        <DemoBlock step="01" kicker="Problem Statement" title="The measurement layer is the missing piece">
          <P>
            Most HR-AI efforts ship a demo and never prove value or monitor what happens next.
            Adoption stalls, fluency is uneven across teams, business outcomes go unmeasured, and
            quality quietly drifts. Without a measurement layer, a pilot is a press release — not a
            program.
          </P>
          <P>
            The Talent organization needs to see, at a glance: who is actually using each AI tool,
            how capable they are with it, and whether it is moving a business metric that matters.
          </P>
        </DemoBlock>

        <DemoBlock step="02" kicker="How We'd Target It" title="Adoption, fluency, and outcomes — plus a responsible-AI view">
          <P>
            A dashboard that tracks <strong className="text-[var(--splash-text)] font-medium">adoption</strong>{' '}
            (active vs. eligible users), <strong className="text-[var(--splash-text)] font-medium">AI fluency</strong>{' '}
            (capability by team), and <strong className="text-[var(--splash-text)] font-medium">business outcomes</strong>{' '}
            across every Talent AI tool — alongside an evaluation/monitoring panel for deploying
            responsibly. This is the governance and observability layer: engagement over time,
            fluency distribution, outcome metrics, and tool-by-tool status in one place.
          </P>
          <P>
            It is data-first. It opens on illustrative sample data so it is immediately explorable,
            then lets you download a template, fill in your own numbers, and re-upload to visualize
            them — with everything parsed in your browser.
          </P>
        </DemoBlock>

        <DemoBlock step="03" kicker="Working Prototype" title="Drive it yourself — then bring your own data">
          <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
            <div className="min-w-0">
              <TamDashboard />
            </div>
            <ScopeNote
              does="Renders adoption, fluency, outcome, and tool-engagement charts with team/tool/time filters, plus a responsible-AI monitoring panel. Defaults to illustrative sample data; download the CSV template, add your numbers, and re-upload to visualize them."
              doesnt="It is not live Netflix data and not a production analytics platform. It models the measurement approach, not a specific company's metrics."
              guardrails="All parsing happens in your browser via a built-in CSV reader — uploaded data is never sent to a server or persisted. Reset to sample data anytime."
            />
          </div>
        </DemoBlock>

        <Footer />
      </GoodeStreamPage>
      <NavigationWheel active="goodestream" />
    </>
  );
}
