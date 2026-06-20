import { Link } from 'react-router-dom';
import { ReactNode } from 'react';
import { useRouteScope } from '../lib/useRouteScope';
import { NavigationWheel } from '../components/domain/NavigationWheel';

/**
 * /concepts — "Concept Lab" architecture narrative.
 *
 * An executive/architect-facing writeup of a private tool I built on Azure to
 * make visual design iteration fast and shareable. Uses the shared splash
 * palette (clean dark surface) so it reads as a focused, document-style page
 * rather than one of the five themed "tour" rooms.
 *
 * The gallery CTA at the bottom links to /concepts/sololift.ai, which will host
 * a live gallery of rendered concepts (built in a later step).
 */
export default function Concepts() {
  useRouteScope('concepts');

  return (
    <div className="min-h-screen overflow-y-auto">
      {/* Subtle grid backdrop, matches the splash language */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(94,234,212,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(94,234,212,0.04) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at top, black 20%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse at top, black 20%, transparent 80%)',
        }}
      />

      {/* Top nav */}
      <nav className="relative z-10 px-6 md:px-10 py-5 flex justify-between items-center max-w-[1080px] mx-auto">
        <Link
          to="/"
          className="font-serif text-[1.1rem] font-semibold tracking-tight no-underline text-[var(--splash-text)] flex items-center gap-2.5"
        >
          <span
            className="w-7 h-7 rounded-sm flex items-center justify-center font-mono text-[0.9rem] font-bold"
            style={{ background: 'var(--splash-tech)', color: 'var(--splash-bg)' }}
          >
            N
          </span>
          <span>
            Neco<em className="not-italic italic text-[var(--splash-tech)]">Goode</em>
          </span>
        </Link>
        <div className="flex gap-6 text-[0.78rem] font-mono tracking-wide text-[var(--splash-text-soft)]">
          <Link to="/TechTour" className="no-underline text-current hover:text-[var(--splash-tech)]">
            tech tour
          </Link>
          <Link to="/BusTour" className="no-underline text-current hover:text-[var(--splash-bus)]">
            business tour
          </Link>
        </div>
      </nav>

      <main className="relative z-10 max-w-[860px] mx-auto px-6 md:px-10 pb-28">
        {/* Hero */}
        <header className="pt-12 md:pt-16 mb-16">
          <div className="font-mono text-[0.72rem] tracking-[0.3em] text-[var(--splash-text-faint)] uppercase mb-5">
            <span className="text-[var(--splash-tech)]">— </span>
            A private tool · built on Azure
          </div>
          <h1
            className="font-serif font-normal leading-[1.05] tracking-[-0.025em] mb-6 text-[var(--splash-text)]"
            style={{ fontSize: 'clamp(2.4rem, 5.5vw, 3.8rem)' }}
          >
            The <em className="italic text-[var(--splash-tech)]">Concept Lab.</em>
          </h1>
          <p className="font-serif italic text-[1.25rem] leading-relaxed text-[var(--splash-text-soft)] max-w-[620px]">
            Drag an interactive idea in, get a live private URL and a QR code back, and open
            it&mdash;running&mdash;in front of a client thirty seconds later. The plumbing underneath is
            the interesting part.
          </p>
        </header>

        {/* PROBLEM */}
        <Section kicker="01 · The problem" title="Showing a live idea is slower than having it">
          <P>
            Visual design iteration is a round-trip problem. You build an interactive concept,
            export it, attach it to an email or paste it into a deck, wait for feedback, change one
            thing, and do it all again. By the time an idea is &ldquo;ready to show,&rdquo; you&apos;ve spent
            more time packaging it than designing it.
          </P>
          <P>
            The worst moment is the meeting itself. A static screenshot can&apos;t answer the question
            a client actually asks: <em className="italic text-[var(--splash-text)]">&ldquo;what happens when I click that?&rdquo;</em>{' '}
            A real running prototype can&mdash;but only if there&apos;s a frictionless way to put it on a
            screen the client can reach, immediately, without a deploy pipeline or a login.
          </P>
        </Section>

        {/* IDEA */}
        <Section kicker="02 · The idea" title="Drag in a concept, get a live link and a QR back">
          <P>
            One self-contained HTML file is a complete interactive idea&mdash;markup, styles, and
            behavior in a single artifact. So the tool is built around that unit. Drop the file into
            an admin page and it comes back as an instant private URL plus a QR code. Open the URL and
            the concept is <em className="italic text-[var(--splash-text)]">rendered, running, and shareable</em>&mdash;not
            downloaded, not described, live.
          </P>
          <P>
            Multiple concepts group under a single folder link with its own QR, so a whole batch of
            variations becomes one thing you can hand across a table. Everything is ephemeral by
            design: links live for seven days and then expire on their own.
          </P>
        </Section>

        {/* ARCHITECTURE */}
        <Section kicker="03 · The architecture" title="Two origins, one trust boundary">
          <P>
            The design decision that matters most is what is allowed to talk to what. Uploaded
            concepts are arbitrary, untrusted HTML and JavaScript. They get their own origin that
            holds <em className="italic text-[var(--splash-text)]">nothing else</em>. Everything privileged&mdash;the upload API,
            the admin UI, the secrets&mdash;lives on the other side of a hard boundary.
          </P>

          <ArchitectureDiagram />

          <ul className="mt-8 space-y-3 list-none">
            <Bullet label="Isolated render origin">
              An Azure Blob <strong className="text-[var(--splash-text)] font-medium">static website</strong> that
              hosts only the rendered concepts and a set of pinned creative libraries. No API, no
              secrets, no session cookies&mdash;there is nothing on this origin worth attacking.
            </Bullet>
            <Bullet label="Upload API + admin UI">
              A separate, authenticated origin running on{' '}
              <strong className="text-[var(--splash-text)] font-medium">Azure Functions (Flex Consumption, Node)</strong>.
              It accepts uploads, writes to blob storage, mints links and QR codes, and serves the admin UI.
            </Bullet>
            <Bullet label="Managed identity + Key Vault">
              The API authenticates to Azure with a{' '}
              <strong className="text-[var(--splash-text)] font-medium">managed identity</strong> and reads any
              secret it needs from <strong className="text-[var(--splash-text)] font-medium">Azure Key Vault</strong> at
              runtime. No connection strings or keys are committed to code or baked into pages.
            </Bullet>
            <Bullet label="Ephemeral by policy">
              A storage <strong className="text-[var(--splash-text)] font-medium">lifecycle rule</strong> deletes
              concepts after seven days. Expiry is infrastructure, not a cron job I have to remember to run.
            </Bullet>
          </ul>
        </Section>

        {/* RISK */}
        <Section kicker="04 · How risk was reduced" title="The blast radius is a single bucket of HTML">
          <P>
            Because uploaded concepts execute arbitrary JavaScript, the threat model treats every
            upload as hostile. The mitigation is structural rather than defensive: hostile code runs
            somewhere it can do no damage.
          </P>
          <div className="grid sm:grid-cols-2 gap-4 mt-6">
            <RiskCard title="No shared origin">
              Concepts run on a dedicated origin with no other content. They can&apos;t read this site&apos;s
              cookies, can&apos;t reach the upload API, and can&apos;t see Key Vault&mdash;the same-origin policy
              works for me instead of against me.
            </RiskCard>
            <RiskCard title="Privilege stays separate">
              The upload API is its own authenticated origin. The only thing that can write concepts
              is code I control; the render origin is read-only to the world.
            </RiskCard>
            <RiskCard title="No secret sprawl">
              Auth is a managed identity, so there are no long-lived keys to leak, rotate, or
              accidentally check in. Secrets are read from Key Vault, never embedded.
            </RiskCard>
            <RiskCard title="Private &amp; self-expiring">
              Links are private by unguessable URL and auto-expire after seven days, so a stale link
              shared once doesn&apos;t become a permanent exposure.
            </RiskCard>
          </div>
        </Section>

        {/* WORKFLOW */}
        <Section kicker="05 · The workflow" title="Upload, link, render, share">
          <ol className="space-y-4 list-none mt-2">
            <Step n="1" title="Upload">
              Drag a self-contained HTML concept into the admin UI (or push from the CLI).
            </Step>
            <Step n="2" title="Get a link + QR">
              The API returns a unique private URL and a QR code instantly.
            </Step>
            <Step n="3" title="Render in the browser">
              Open the link and the concept renders live&mdash;fully interactive, no install.
            </Step>
            <Step n="4" title="Share in the meeting">
              Hand over the QR or the folder link; the client opens the running concept on their own device.
            </Step>
          </ol>
          <P>
            <span className="font-mono text-[0.85rem] text-[var(--splash-tech)]">$ conceptlab push ./batch/</span>
            <br />
            A small CLI pushes an entire folder of concepts in one command, so a design session&apos;s worth
            of variations is online&mdash;each with its own link, all under one folder QR&mdash;before the meeting starts.
          </P>
        </Section>

        {/* COST */}
        <Section kicker="06 · Cost-consciousness" title="Pennies a month, near-zero when idle">
          <P>
            The whole system is serverless and static. Functions run on{' '}
            <strong className="text-[var(--splash-text)] font-medium">Flex Consumption</strong> and scale to zero when
            no one is uploading; the render origin is plain static blob hosting. There is no VM, no
            always-on container, and no database to keep warm. Idle cost rounds to nothing, and the
            seven-day lifecycle keeps stored bytes&mdash;and the bill&mdash;small by default.
          </P>
        </Section>

        {/* GALLERY CTA / PLACEHOLDER */}
        <section className="mt-20 border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-8 md:p-10">
          <div className="font-mono text-[0.7rem] tracking-[0.25em] uppercase text-[var(--splash-text-faint)] mb-3">
            Live gallery · coming soon
          </div>
          <h2 className="font-serif text-[1.9rem] leading-tight tracking-[-0.02em] text-[var(--splash-text)] mb-3">
            See it running on a <em className="italic text-[var(--splash-tech)]">real project.</em>
          </h2>
          <p className="font-serif text-[1.1rem] leading-relaxed text-[var(--splash-text-soft)] max-w-[560px] mb-6">
            The Concept Lab ran the visual exploration for a full platform reskin. A gallery of those
            live concept links&mdash;each one a running prototype&mdash;will be linked here.
          </p>
          <Link
            to="/concepts/sololift.ai"
            className="inline-flex items-center gap-2 px-6 py-3 font-mono text-[0.78rem] tracking-[0.12em] uppercase no-underline border transition-colors"
            style={{ borderColor: 'var(--splash-tech)', color: 'var(--splash-tech)' }}
          >
            <span>open the sololift.ai gallery</span>
            <span aria-hidden>→</span>
          </Link>
        </section>

        {/* Footer nav back to the tours */}
        <div className="mt-16 pt-8 border-t border-[var(--splash-line)] flex flex-col sm:flex-row gap-4 justify-between font-mono text-[0.8rem] text-[var(--splash-text-soft)]">
          <Link to="/" className="no-underline text-current hover:text-[var(--splash-tech)]">
            ← back to the door
          </Link>
          <div className="flex gap-6">
            <Link to="/TechTour" className="no-underline text-current hover:text-[var(--splash-tech)]">
              technical tour →
            </Link>
            <Link to="/BusTour" className="no-underline text-current hover:text-[var(--splash-bus)]">
              business tour →
            </Link>
          </div>
        </div>
      </main>

      <NavigationWheel active="splash" />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Architecture diagram — inline SVG with a dashed trust boundary.
 * Render origin (untrusted concepts) on one side; the authenticated
 * upload API + admin, managed identity, and Key Vault on the other.
 * ---------------------------------------------------------------- */
function ArchitectureDiagram() {
  return (
    <figure className="my-8">
      <div className="border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-4 md:p-6 overflow-x-auto">
        <svg
          viewBox="0 0 720 380"
          role="img"
          aria-label="Architecture: a client reaches an isolated render origin that hosts only rendered concepts and pinned creative libraries, while a separate authenticated upload API and admin UI holds a managed identity, reads secrets from Key Vault, and writes concepts across a trust boundary into the render origin."
          className="w-full min-w-[560px] h-auto font-mono"
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--splash-text-soft)" />
            </marker>
            <marker id="arrowTech" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--splash-tech)" />
            </marker>
          </defs>

          {/* Client */}
          <DBox x={24} y={150} w={150} h={80} title="Client" sub={['browser · phone', 'opens link / QR']} />

          {/* Trust boundary (dashed) around the privileged side */}
          <rect
            x={384}
            y={24}
            width={312}
            height={332}
            rx={10}
            fill="rgba(94,234,212,0.03)"
            stroke="var(--splash-tech)"
            strokeWidth={1.5}
            strokeDasharray="6 5"
          />
          <text x={400} y={48} fill="var(--splash-tech)" fontSize="11" letterSpacing="2">
            TRUST BOUNDARY · AUTHENTICATED
          </text>

          {/* Render origin (untrusted, public, on the client side of the boundary) */}
          <DBox
            x={210}
            y={64}
            w={150}
            h={96}
            title="Render origin"
            sub={['Blob static site', 'rendered concepts', '+ pinned libraries']}
            accent
          />

          {/* Upload API + admin */}
          <DBox
            x={410}
            y={80}
            w={170}
            h={86}
            title="Upload API + Admin"
            sub={['Functions · Flex', 'managed identity']}
          />

          {/* Key Vault */}
          <DBox x={410} y={224} w={170} h={70} title="Key Vault" sub={['secrets at runtime']} />

          {/* Client → Render origin (read live concept) */}
          <line x1={174} y1={178} x2={210} y2={150} stroke="var(--splash-text-soft)" strokeWidth={1.5} markerEnd="url(#arrow)" />
          <text x={150} y={135} fill="var(--splash-text-faint)" fontSize="10">open link / QR</text>

          {/* Client → Upload API (authenticated admin) */}
          <line x1={174} y1={200} x2={410} y2={120} stroke="var(--splash-text-soft)" strokeWidth={1.5} strokeDasharray="4 4" markerEnd="url(#arrow)" />
          <text x={196} y={250} fill="var(--splash-text-faint)" fontSize="10">authenticated upload</text>

          {/* Upload API → Render origin (writes concepts across boundary) */}
          <line x1={410} y1={130} x2={360} y2={118} stroke="var(--splash-tech)" strokeWidth={1.5} markerEnd="url(#arrowTech)" />
          <text x={330} y={92} fill="var(--splash-tech)" fontSize="10">writes</text>

          {/* Upload API → Key Vault (reads secrets via MI) */}
          <line x1={495} y1={166} x2={495} y2={224} stroke="var(--splash-tech)" strokeWidth={1.5} markerEnd="url(#arrowTech)" />
          <text x={502} y={200} fill="var(--splash-tech)" fontSize="10">reads via MI</text>
        </svg>
      </div>
      <figcaption className="mt-3 font-mono text-[0.72rem] text-[var(--splash-text-faint)] leading-relaxed">
        Untrusted concepts run on the render origin (left); everything privileged sits inside the
        dashed trust boundary (right). The only path across it is the API <em className="italic">writing</em> rendered output.
      </figcaption>
    </figure>
  );
}

/** A labeled box for the SVG diagram. `accent` tints it teal (the untrusted render origin). */
function DBox({
  x,
  y,
  w,
  h,
  title,
  sub,
  accent = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string[];
  accent?: boolean;
}) {
  const stroke = accent ? 'var(--splash-tech)' : 'var(--splash-text-soft)';
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="var(--splash-bg)" stroke={stroke} strokeWidth={1.5} />
      <text x={x + w / 2} y={y + 24} textAnchor="middle" fill="var(--splash-text)" fontSize="13" fontWeight="600">
        {title}
      </text>
      {sub.map((line, i) => (
        <text
          key={line}
          x={x + w / 2}
          y={y + 44 + i * 15}
          textAnchor="middle"
          fill="var(--splash-text-faint)"
          fontSize="10.5"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/* ---------------------------------------------------------------- *
 * Small presentational helpers, in the splash visual language.
 * ---------------------------------------------------------------- */
function Section({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="mt-16">
      <div className="font-mono text-[0.7rem] tracking-[0.25em] uppercase text-[var(--splash-text-faint)] mb-3">
        {kicker}
      </div>
      <h2 className="font-serif text-[1.9rem] md:text-[2.2rem] leading-tight tracking-[-0.02em] text-[var(--splash-text)] mb-5">
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return (
    <p className="font-serif text-[1.12rem] leading-[1.7] text-[var(--splash-text-soft)] mb-5 max-w-[680px]">
      {children}
    </p>
  );
}

function Bullet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="pl-5 relative font-sans text-[1rem] leading-relaxed text-[var(--splash-text-soft)] max-w-[680px]">
      <span aria-hidden className="absolute left-0 top-[0.55em] w-2 h-2 rounded-full bg-[var(--splash-tech)]" />
      <strong className="text-[var(--splash-text)] font-semibold">{label}.</strong> {children}
    </li>
  );
}

function RiskCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-5">
      <div className="font-mono text-[0.78rem] tracking-wide text-[var(--splash-tech)] mb-2">{title}</div>
      <p className="font-sans text-[0.92rem] leading-relaxed text-[var(--splash-text-soft)]">{children}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4 items-start">
      <span
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-mono text-[0.85rem] font-semibold"
        style={{ border: '1px solid var(--splash-tech)', color: 'var(--splash-tech)' }}
      >
        {n}
      </span>
      <div className="font-sans text-[1rem] leading-relaxed text-[var(--splash-text-soft)] pt-1">
        <strong className="text-[var(--splash-text)] font-semibold">{title}.</strong> {children}
      </div>
    </li>
  );
}
