import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';
import { TickerTape } from '../components/domain/floor/TickerTape';
import { Watchlist } from '../components/domain/floor/Watchlist';
import { AlphaVantageWidget } from '../components/domain/floor/AlphaVantageWidget';

/**
 * /floor — Trading Terminal. Mirrors docs/reference/L-trading-floor.html.
 * Three-column workspace + ticker tape + top bar + Alpha Vantage widget on the right.
 */
export default function Floor() {
  useRouteScope('floor');

  return (
    <div className="min-h-screen flex flex-col">
      <TickerTape />

      {/* Top bar */}
      <div className="border-b border-[var(--floor-line)] px-6 py-2.5 flex justify-between items-center bg-[var(--floor-bg-soft)]">
        <Link to="/" className="flex items-center gap-3 no-underline text-[var(--floor-text)] text-[0.85rem]">
          <span className="w-6 h-6 bg-[var(--floor-amber)] text-[var(--floor-bg)] flex items-center justify-center font-bold text-[0.75rem] tracking-tight">
            N
          </span>
          <span className="font-medium">
            NECOGOODE<span className="text-[var(--floor-text-faint)]">.COM</span> · TERMINAL
          </span>
        </Link>
        <div className="flex gap-6 text-[0.72rem] text-[var(--floor-text-soft)] tracking-wider">
          <span className="inline-flex items-center gap-1.5 text-[var(--floor-gain)] font-semibold">
            <span className="w-2 h-2 rounded-full bg-[var(--floor-gain)]" style={{ boxShadow: '0 0 8px var(--floor-gain)', animation: 'pulse 1.5s ease-in-out infinite' }} />
            LIVE
          </span>
          <span>SESSION <strong className="text-[var(--floor-text)] ml-1">NG-247</strong></span>
          <span className="hidden md:inline">EXCHANGE <strong className="text-[var(--floor-text)] ml-1">WORK</strong></span>
          <span>TIME <strong className="text-[var(--floor-text)] ml-1"><Clock /></strong></span>
        </div>
      </div>

      {/* 3-col workspace */}
      <div className="grid bg-[var(--floor-line)] gap-px flex-1" style={{ gridTemplateColumns: '280px 1fr 320px', minHeight: 'calc(100vh - 84px)' }}>

        {/* LEFT: identity panel */}
        <aside className="bg-[var(--floor-bg)] p-6">
          <PanelHeader left={<><strong>NG</strong> · Issuer Profile</>} right={<>VERIFIED</>} accent />

          <h1 className="font-sans text-[1.6rem] leading-[1.05] text-[var(--floor-text)] font-semibold tracking-[-0.025em] mb-2">
            Neco Goode
          </h1>
          <p className="text-[0.72rem] text-[var(--floor-text-soft)] tracking-wide mb-5 leading-relaxed">
            Sr. Director of IT &nbsp;<span className="text-[var(--floor-amber)]">·</span>&nbsp;
            Builder &nbsp;<span className="text-[var(--floor-amber)]">·</span>&nbsp; Operator
          </p>

          <div className="mb-5">
            <Kpi label="live creations" value="5" up />
            <Kpi label="years shipping" value="10+" />
            <Kpi label="stack depth" value="full" />
            <Kpi label="rolling status" value="accepting" up />
            <Kpi label="based" value="DFW · TX" />
          </div>

          <div className="font-sans text-[0.85rem] leading-relaxed text-[var(--floor-text-soft)] p-4 bg-[var(--floor-bg-soft)] border-l-2 border-[var(--floor-amber)] mb-4">
            <strong className="text-[var(--floor-text)] font-medium">Most directors don&apos;t ship code. Most engineers don&apos;t run orgs.</strong>
            {' '}I do both, and the watchlist to your right is the proof.{' '}
            <em className="text-[var(--floor-gain)] not-italic">Don&apos;t read it — run it.</em>
          </div>

          <div className="flex flex-col gap-2">
            <ActionButton href="mailto:hello@necogoode.com" label="get in touch" hotkey="⌘ G" />
            <ActionButton href="#resume" label="resume.pdf" hotkey="⌘ R" />
            <ActionButton href="https://www.linkedin.com/in/necogoode" label="linkedin / github" hotkey="⌘ L" external />
          </div>
        </aside>

        {/* CENTER: feed */}
        <main className="bg-[var(--floor-bg)]">
          <div className="px-6 py-4 border-b border-[var(--floor-line)] flex justify-between items-center bg-[var(--floor-bg-soft)] text-[0.72rem] tracking-[0.12em] uppercase text-[var(--floor-text-faint)]">
            <span>WATCHLIST :: NG.WORK</span>
            <span>5 OF 5 ACTIVE</span>
          </div>

          <div className="flex border-b border-[var(--floor-line)]">
            <FeedTab active>Creations</FeedTab>
            <FeedTab>By Stack</FeedTab>
            <FeedTab>By Status</FeedTab>
            <FeedTab>Activity</FeedTab>
          </div>

          <Watchlist />

          <div className="px-6 py-4 border-b border-[var(--floor-line)] bg-[var(--floor-bg-soft)]">
            <div className="text-[0.7rem] tracking-[0.15em] uppercase text-[var(--floor-text-faint)] mb-2.5">▸ Recent Activity</div>
            <NewsItem time="04:12" body={<><strong className="text-[var(--floor-text)]">GDGM</strong> shipped new dossier feature — globe lights now persist across sessions</>} tone="up" />
            <NewsItem time="02:30" body={<><strong className="text-[var(--floor-text)]">SLIFT</strong> processed user feedback batch — 6 patches deployed to production</>} tone="up" />
            <NewsItem time="YDA"   body={<><strong className="text-[var(--floor-text)]">BSA</strong> family character LoRAs entering training run 4</>} tone="fl" />
            <NewsItem time="3d"    body={<><strong className="text-[var(--floor-text)]">PIP</strong> 13 patent concepts written, 5 flagged urgent (5/5 score)</>} tone="fl" />
          </div>

          <footer className="px-6 py-4 text-[0.65rem] text-[var(--floor-text-faint)] tracking-wide leading-relaxed">
            Financial data provided by <a href="https://www.alphavantage.co/" target="_blank" rel="noopener noreferrer" className="text-[var(--floor-text-soft)] underline">Alpha Vantage</a> (free tier).
            Site projects shown above are owned by Renneco Goode.
          </footer>
        </main>

        {/* RIGHT: details + alpha vantage widget */}
        <aside className="bg-[var(--floor-bg)] p-6">
          <PanelHeader left={<>CONTACT · <strong>NG</strong></>} right={<>OPEN</>} />
          <div className="py-4 border-b border-[var(--floor-line)]">
            <ContactItem label="EMAIL" value={<a href="mailto:hello@necogoode.com" className="text-[var(--floor-amber)]">hello@necogoode.com</a>} />
            <ContactItem label="LINKEDIN" value="/in/necogoode" />
            <ContactItem label="GITHUB" value="@BackpackNecoG" />
            <ContactItem label="LOCATION" value="Dallas–Fort Worth, TX" />
            <ContactItem label="TIMEZONE" value="America/Chicago" />
          </div>

          <PanelHeader left={<>STACK · <strong>EXPERTISE</strong></>} right={<>FULL</>} />
          <div className="py-4 border-b border-[var(--floor-line)]">
            <ContactItem label="backend" value=".NET · Node" />
            <ContactItem label="frontend" value="React · TS · Vite" />
            <ContactItem label="data" value="PG · Snowflake · BI" />
            <ContactItem label="cloud" value="Azure · AWS" />
            <ContactItem label="ai" value="Claude · agentic systems" />
          </div>

          <PanelHeader left={<>TICKER · <strong>LIVE</strong></>} right={<>AV</>} />
          <div className="pt-4">
            <AlphaVantageWidget />
          </div>
        </aside>
      </div>

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}

function PanelHeader({ left, right, accent }: { left: React.ReactNode; right: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex justify-between items-center pb-2.5 border-b border-[var(--floor-line)] mb-4 text-[0.7rem] tracking-[0.15em] text-[var(--floor-text-faint)] uppercase">
      <span>{left}</span>
      <span className={accent ? 'text-[var(--floor-amber)]' : ''}>{right}</span>
    </div>
  );
}

function Kpi({ label, value, up = false }: { label: string; value: string; up?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-dashed border-[var(--floor-line)] text-[0.78rem]">
      <span className="text-[var(--floor-text-soft)]">{label}</span>
      <span className={`font-medium ${up ? 'text-[var(--floor-gain)]' : 'text-[var(--floor-text)]'}`}>{value}</span>
    </div>
  );
}

function ActionButton({ href, label, hotkey, external = false }: { href: string; label: string; hotkey: string; external?: boolean }) {
  const props = external
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};
  return (
    <a
      href={href}
      {...props}
      className="flex justify-between items-center px-3.5 py-2.5 bg-[var(--floor-bg-soft)] border border-[var(--floor-line)] text-[var(--floor-text)] no-underline text-[0.78rem] tracking-wide transition-colors hover:bg-[var(--floor-bg-card)] hover:border-[var(--floor-amber)] hover:text-[var(--floor-amber)]"
    >
      <span>{label}</span>
      <span className="bg-[var(--floor-bg-card)] text-[var(--floor-text-faint)] text-[0.65rem] px-1.5 py-0.5 tracking-wider">{hotkey}</span>
    </a>
  );
}

function FeedTab({ active = false, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <button
      className={
        'px-5 py-2.5 text-[0.72rem] tracking-[0.1em] uppercase border-r border-[var(--floor-line)] transition-colors ' +
        (active
          ? 'text-[var(--floor-amber)] bg-[var(--floor-bg)] shadow-[inset_0_-2px_0_var(--floor-amber)]'
          : 'text-[var(--floor-text-soft)] hover:text-[var(--floor-text)] bg-transparent')
      }
    >
      {children}
    </button>
  );
}

function NewsItem({ time, body, tone }: { time: string; body: React.ReactNode; tone: 'up' | 'fl' | 'dn' }) {
  const toneCls = tone === 'up' ? 'text-[var(--floor-gain)]' : tone === 'fl' ? 'text-[var(--floor-amber)]' : 'text-[var(--floor-loss)]';
  const glyph = tone === 'up' ? '▲' : tone === 'fl' ? '◆' : '▼';
  return (
    <div className="flex gap-3 py-1.5 text-[0.78rem] leading-snug">
      <span className="text-[var(--floor-text-faint)] text-[0.7rem] flex-shrink-0 w-12">{time}</span>
      <span className="text-[var(--floor-text-soft)] font-sans flex-1">
        {body} <span className={toneCls}>{glyph}</span>
      </span>
    </div>
  );
}

function ContactItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 text-[0.78rem]">
      <span className="text-[var(--floor-text-soft)] tracking-wide">{label}</span>
      <span className="text-[var(--floor-text)] font-medium">{value}</span>
    </div>
  );
}

function Clock() {
  const [t, setT] = useState(formatTime);
  useEffect(() => {
    const id = setInterval(() => setT(formatTime()), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{t}</>;
}

function formatTime(): string {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/Chicago' });
  return `${time} CDT`; // (Unverified) — toggles around DST cutover days
}
