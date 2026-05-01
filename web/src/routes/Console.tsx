import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRouteScope } from '../lib/useRouteScope';
import { fetchTalkStatus, postMessage, isReply } from '../lib/talkDangerously';
import { creations } from '../data/creations';

/**
 * /console — "Let Neco Talk Dangerously" terminal page.
 *
 * Visual: ports docs/reference/F-console.html (CRT amber on dark roast, scanlines, vignette).
 * Behavior:
 *   - Free-form input is wrapped in a primitive-decomposition system prompt and sent to
 *     Azure OpenAI (gpt-4o-mini) via /api/talk-dangerously. Responses feel like Neco typing back.
 *   - A handful of canned commands (creations, whoami, stack, contact, help, clear) bypass the
 *     model so common asks return instantly without spending the 50/day budget.
 *   - Counter widget shows X / 50 calls remaining; tooltip explains the Microsoft stack rationale.
 */

type Line =
  | { kind: 'echo'; text: string }
  | { kind: 'system'; text: string }
  | { kind: 'reply'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'rule' }
  | { kind: 'banner' }
  | { kind: 'creations' };

type ChatMessage = { role: 'user' | 'assistant'; content: string };

/**
 * Cap how much of the running conversation we send back to the model so
 * a long session doesn't run away on tokens. Last 10 turns is plenty
 * for context while keeping each call cheap.
 */
const HISTORY_TURNS_CAP = 10;

const SESSION_KEY = 'ng_console_session';
const HISTORY_KEY = 'ng_console_history';

/** 6-char base32 session id, prefixed for visual recognition. */
function newSessionId(): string {
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `sess-${rand}`;
}

const RULE = '─'.repeat(72);

export default function Console() {
  useRouteScope('console');
  const navigate = useNavigate();

  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [callsRemaining, setCallsRemaining] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState(50);

  // Conversation memory — sent to the model with each call so it can follow
  // a thread, not just respond to the latest line in isolation.
  // Persisted in sessionStorage so a refresh within the same tab keeps context;
  // closing the tab or running `clear` starts fresh.
  const [history, setHistory] = useState<ChatMessage[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = sessionStorage.getItem(HISTORY_KEY);
      return stored ? (JSON.parse(stored) as ChatMessage[]) : [];
    } catch {
      return [];
    }
  });

  const [sessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return newSessionId();
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = newSessionId();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Persist history on every change so a same-tab refresh resumes the thread.
  useEffect(() => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      /* storage full or disabled — proceed without persistence */
    }
  }, [history]);

  // Initial boot sequence + status fetch
  useEffect(() => {
    let cancelled = false;
    fetchTalkStatus()
      .then((s) => {
        if (cancelled) return;
        setCallsRemaining(s.callsRemaining);
        setDailyLimit(s.dailyLimit);
      })
      .catch(() => {
        if (!cancelled) setCallsRemaining(50);
      });

    const hadHistory = history.length > 0;
    const seq: Array<[Line, number]> = hadHistory
      ? [
          [{ kind: 'system', text: '[ok]   resuming session ' + sessionId + ' · ' + (history.length / 2) + ' previous exchange(s)' }, 80],
          [{ kind: 'rule' }, 100],
        ]
      : [
          [{ kind: 'system', text: '[boot] initializing portfolio.exe ...' }, 80],
          [{ kind: 'system', text: '[ok]   loaded 5 creations from /var/work' }, 200],
          [{ kind: 'system', text: '[ok]   azure openai connection: established' }, 200],
          [{ kind: 'system', text: '[ok]   session ' + sessionId + ' · ready' }, 200],
          [{ kind: 'banner' }, 400],
          [{ kind: 'reply', text: 'Let Neco talk dangerously.' }, 200],
          [{ kind: 'system', text: 'Type anything. I parse it down to its primitive components, challenge each one, and pick a concrete path. Follow-up questions thread through the same conversation — last ' + HISTORY_TURNS_CAP + ' turns kept as context.' }, 100],
          [{ kind: 'rule' }, 100],
        ];

    let acc = 0;
    const timers: number[] = [];
    seq.forEach(([line, delay]) => {
      acc += delay;
      timers.push(window.setTimeout(() => {
        if (!cancelled) setLines((prev) => [...prev, line]);
      }, acc));
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  // Auto-scroll on every new line
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [lines]);

  const append = (line: Line) => setLines((prev) => [...prev, line]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const raw = input.trim();
    if (!raw || busy) return;

    append({ kind: 'echo', text: raw });
    setInput('');

    const lower = raw.toLowerCase();

    // Canned commands — instant, free
    if (lower === 'clear' || lower === 'reset') {
      setLines([]);
      setHistory([]);
      try { sessionStorage.removeItem(HISTORY_KEY); } catch { /* noop */ }
      append({ kind: 'system', text: '[ok] conversation cleared. fresh session.' });
      return;
    }
    if (lower === 'help') {
      append({ kind: 'rule' });
      append({ kind: 'system', text: 'commands         (canned, no AI call)' });
      append({ kind: 'system', text: '  creations       list the five live creations' });
      append({ kind: 'system', text: '  whoami          short bio' });
      append({ kind: 'system', text: '  stack           technical depth' });
      append({ kind: 'system', text: '  contact         how to reach me' });
      append({ kind: 'system', text: '  clear / reset   clear the screen + start a new conversation' });
      append({ kind: 'system', text: '' });
      append({ kind: 'system', text: 'anything else    threaded conversation via Azure OpenAI (gpt-4o-mini)' });
      append({ kind: 'system', text: `                 last ${HISTORY_TURNS_CAP} turns kept as context for follow-ups` });
      append({ kind: 'rule' });
      return;
    }
    if (lower === 'creations') {
      append({ kind: 'rule' });
      append({ kind: 'creations' });
      append({ kind: 'rule' });
      return;
    }
    if (lower === 'whoami') {
      append({ kind: 'rule' });
      append({ kind: 'reply', text: 'Neco Goode. Architect, operator, leader of people and process by day; builder of production software by every other waking hour. A curious and ambitious mind based in Dallas–Fort Worth. Five live creations behind every claim on my resume — they\'re the proof.' });
      append({ kind: 'rule' });
      return;
    }
    if (lower === 'stack') {
      append({ kind: 'rule' });
      append({ kind: 'system', text: 'backend   .NET 10, ASP.NET Core, Entity Framework, Node' });
      append({ kind: 'system', text: 'frontend  React, Vite, TypeScript, Tailwind' });
      append({ kind: 'system', text: 'data      PostgreSQL, Snowflake, Power BI' });
      append({ kind: 'system', text: 'cloud     Azure (primary), AWS, Bicep, CDK' });
      append({ kind: 'system', text: 'ai        Azure OpenAI, Claude API, agentic systems' });
      append({ kind: 'rule' });
      return;
    }
    if (lower === 'contact') {
      append({ kind: 'rule' });
      append({ kind: 'system', text: 'email      hello@necogoode.com' });
      append({ kind: 'system', text: 'linkedin   /in/necogoode' });
      append({ kind: 'system', text: 'github     @BackpackNecoG' });
      append({ kind: 'rule' });
      return;
    }

    // Anything else → AI
    if (callsRemaining !== null && callsRemaining <= 0) {
      append({ kind: 'error', text: 'Daily limit reached. Resets at midnight UTC.' });
      return;
    }

    // Cap what we ship back to the model — keep the most recent N turns.
    const trimmedHistory = history.slice(-HISTORY_TURNS_CAP);

    setBusy(true);
    try {
      const r = await postMessage(raw, trimmedHistory);
      if (isReply(r)) {
        append({ kind: 'reply', text: r.reply });
        setCallsRemaining(r.callsRemaining);
        // Append both the user turn and the assistant turn so the next call
        // has the full thread.
        setHistory((prev) => [
          ...prev,
          { role: 'user', content: raw },
          { role: 'assistant', content: r.reply },
        ]);
      } else {
        append({ kind: 'error', text: r.error });
        if (typeof r.callsRemaining === 'number') setCallsRemaining(r.callsRemaining);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'request failed';
      append({ kind: 'error', text: msg });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  // Keyboard shortcuts: 1=creations, 2=whoami, 3=contact, ?=help — only when input not focused
  useEffect(() => {
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      const target = (e.target as HTMLElement | null);
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const map: Record<string, string> = { '1': 'creations', '2': 'whoami', '3': 'contact', '?': 'help' };
      const cmd = map[(e as KeyboardEvent).key];
      if (cmd) {
        setInput(cmd);
        setTimeout(() => {
          const f = document.querySelector<HTMLFormElement>('form#console-form');
          f?.requestSubmit();
        }, 0);
      }
    };
    document.addEventListener('keydown', onKey as EventListener);
    return () => document.removeEventListener('keydown', onKey as EventListener);
  }, []);

  const exhausted = callsRemaining !== null && callsRemaining <= 0;

  return (
    <div className="min-h-screen relative">
      {/* Scanlines overlay */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none z-50"
        style={{
          background:
            'repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 3px)',
        }}
      />
      {/* Vignette overlay */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none z-40"
        style={{ background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.3) 100%)' }}
      />

      <div className="max-w-[1080px] mx-auto py-12 px-4 relative z-10">
        {/* Window chrome */}
        <div className="bg-[var(--console-bg-soft)] border border-[var(--console-bg-line)] rounded-md overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
          <div className="bg-[var(--console-bg-line)] px-4 py-2.5 flex items-center gap-2.5 border-b border-black/30">
            <span className="w-3 h-3 rounded-full bg-[#E06C5A]" />
            <span className="w-3 h-3 rounded-full bg-[#E8A04A]" />
            <span className="w-3 h-3 rounded-full bg-[#8FA055]" />
            <span className="flex-1 text-center text-[0.78rem] text-[var(--console-paper-faint)] tracking-wider">
              necogoode.com — bash — 80×24 — gpt-4o-mini —{' '}
              <span className="text-[var(--console-amber)]">{sessionId}</span>
            </span>
            <Link to="/" className="text-[0.72rem] text-[var(--console-paper-faint)] tracking-wider no-underline hover:text-[var(--console-amber-bright)]">
              ⌘ home
            </Link>
          </div>

          {/* Console body */}
          <div ref={scrollerRef} className="px-10 py-8 min-h-[600px] max-h-[78vh] overflow-y-auto text-[14px] leading-[1.6]">
            {lines.map((line, i) => (
              <ConsoleLine key={i} line={line} onCreationClick={(slug) => navigate(`/TechTour/creations/${slug}`)} />
            ))}

            {busy && (
              <div className="text-[var(--console-paper-faint)] italic mt-2">▸ thinking…</div>
            )}

            {/* Prompt */}
            <form id="console-form" onSubmit={handleSubmit} className="flex gap-2 items-center mt-4">
              <span className="text-[var(--console-olive)] flex-shrink-0 font-medium">
                neco@home <span className="text-[var(--console-amber-bright)]">▸</span>
              </span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={busy || exhausted}
                placeholder={
                  exhausted
                    ? 'Daily limit reached — resets at midnight UTC'
                    : 'type anything · or one of: creations, whoami, stack, contact, help, clear'
                }
                className="flex-1 bg-transparent border-none outline-none text-[var(--console-paper)] placeholder:text-[var(--console-paper-faint)] text-[14px] disabled:opacity-50"
                style={{ caretColor: 'var(--console-amber-bright)', fontFamily: 'inherit' }}
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
            </form>

            {/* Quick chips */}
            <div className="flex flex-wrap gap-2 mt-5">
              {[
                { cmd: 'creations', kbd: '1' },
                { cmd: 'whoami', kbd: '2' },
                { cmd: 'contact', kbd: '3' },
                { cmd: 'help', kbd: '?' },
              ].map(({ cmd, kbd }) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => {
                    setInput(cmd);
                    setTimeout(() => {
                      const f = document.getElementById('console-form') as HTMLFormElement | null;
                      f?.requestSubmit();
                    }, 0);
                  }}
                  className="bg-transparent border border-[var(--console-bg-line)] text-[var(--console-paper-soft)] px-3.5 py-1.5 text-[0.75rem] tracking-wide rounded-sm hover:border-[var(--console-amber)] hover:text-[var(--console-amber-bright)] hover:bg-[var(--console-amber)]/[0.06] transition-colors"
                >
                  {cmd} <kbd className="text-[var(--console-paper-faint)] text-[0.65rem] ml-2">{kbd}</kbd>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Below-the-fold attribution */}
        <div className="text-center mt-6 text-[var(--console-paper-faint)] text-[0.78rem] tracking-wider">
          {callsRemaining !== null && (
            <span className="mr-3">
              <span className={callsRemaining <= 5 ? 'text-[var(--console-rust)]' : 'text-[var(--console-amber)]'}>
                {callsRemaining} / {dailyLimit}
              </span> calls today
            </span>
          )}
          <span className="opacity-60">·</span>
          <span className="ml-3" title="Microsoft is OpenAI's largest investor + Azure hosts the inference. This page runs the full Microsoft stack: Azure Static Web Apps + Azure Functions + Azure OpenAI Service.">
            Powered by{' '}
            <a
              href="https://azure.microsoft.com/en-us/products/ai-services/openai-service"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--console-paper-soft)] underline decoration-dotted underline-offset-4 hover:text-[var(--console-amber-bright)]"
            >
              Azure OpenAI Service
            </a>{' '}
            · gpt-4o-mini
          </span>
          <span className="opacity-60 ml-3">·</span>
          <span className="ml-3 italic">
            Why Microsoft stack: I picked it. Azure SWA + Functions + Azure OpenAI = one bill, one auth surface, one resource group.
          </span>
        </div>
      </div>
    </div>
  );
}

function ConsoleLine({
  line,
  onCreationClick,
}: {
  line: Line;
  onCreationClick: (slug: string) => void;
}) {
  if (line.kind === 'banner') {
    return (
      <div className="my-3 mb-6 select-none">
        <div
          className="font-bold leading-none tracking-[0.18em] uppercase"
          style={{
            color: 'var(--console-amber)',
            fontSize: 'clamp(2.4rem, 8vw, 4.2rem)',
            // CRT-glow: warm amber halo around each glyph
            textShadow: '0 0 12px rgba(232,160,74,0.45), 0 0 28px rgba(232,160,74,0.18)',
            fontFamily: '"IBM Plex Mono", "Berkeley Mono", monospace',
          }}
        >
          NERDY{' '}
          <span style={{ color: 'var(--console-amber-bright)' }}>NECO</span>
        </div>
        <div
          className="text-[0.7rem] tracking-[0.3em] uppercase mt-1.5"
          style={{ color: 'var(--console-paper-faint)' }}
        >
          ── primitive-decomposition console ──
        </div>
      </div>
    );
  }
  if (line.kind === 'rule') {
    return <div className="text-[var(--console-bg-line)] my-2 select-none">{RULE}</div>;
  }
  if (line.kind === 'creations') {
    return (
      <div>
        {creations.map((c, i) => {
          const status =
            c.status === 'live'
              ? { glyph: '●', cls: 'text-[var(--console-olive)]', label: 'LIVE' }
              : c.status === 'in-production'
              ? { glyph: '◐', cls: 'text-[var(--console-amber)]', label: 'in production' }
              : { glyph: '◯', cls: 'text-[var(--console-paper-faint)]', label: 'patent stage' };
          return (
            <div
              key={c.slug}
              onClick={() => onCreationClick(c.slug)}
              className="grid gap-4 py-1.5 px-2 -mx-2 border-b border-dashed border-[var(--console-bg-line)] cursor-pointer rounded-sm hover:bg-[var(--console-amber)]/[0.07] hover:border-[var(--console-amber)] group"
              style={{ gridTemplateColumns: '24px 200px 1fr 100px' }}
            >
              <div className="text-[var(--console-amber)]">{String(i + 1).padStart(2, '0')}</div>
              <div className="text-[var(--console-paper)] font-medium group-hover:text-[var(--console-amber-bright)]">{c.name}</div>
              <div className="text-[var(--console-paper-soft)] text-[0.85rem]">{c.tech.tagline}</div>
              <div className={`${status.cls} text-[0.75rem] text-right tracking-wider`}>
                {status.glyph} {status.label}
              </div>
            </div>
          );
        })}
        <div className="text-[var(--console-paper-faint)] opacity-60 mt-3 text-[0.85rem]">
          → click any row for the full story
        </div>
      </div>
    );
  }
  if (line.kind === 'echo') {
    return (
      <div>
        <span className="text-[var(--console-olive)]">neco@home</span>{' '}
        <span className="text-[var(--console-amber-bright)]">▸</span>{' '}
        <span className="text-[var(--console-paper)]">{line.text}</span>
      </div>
    );
  }
  if (line.kind === 'system') {
    return <div className="text-[var(--console-paper-faint)]">{line.text}</div>;
  }
  if (line.kind === 'reply') {
    return (
      <div className="text-[var(--console-paper)] whitespace-pre-wrap font-serif italic text-[1.05rem] leading-[1.5] my-1.5" style={{ fontFamily: '"Fraunces", serif' }}>
        {line.text}
      </div>
    );
  }
  if (line.kind === 'error') {
    return (
      <div className="text-[var(--console-rust)]">
        <span className="opacity-70">⚠ </span>
        {line.text}
      </div>
    );
  }
  return null;
}
