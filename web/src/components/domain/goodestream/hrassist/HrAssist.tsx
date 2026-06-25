import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SAMPLE_CORPUS,
  SAMPLE_CORPUS_NAME,
  Passage,
  retrieve,
  corpusFromText,
} from './corpus';
import { askHr, fetchHrStatus, isHrReply } from '../../../../lib/goodestreamHr';

/**
 * HrAssist — retrieval-grounded HR chat.
 *
 * Retrieval runs in the browser over the active corpus (sample CA KB or the
 * visitor's pasted text); only the top passages + question go to the backend,
 * which answers strictly from them and cites the passage used, or escalates.
 * The corpus panel shows exactly what the assistant is grounded on, and the
 * cited passage is highlighted after each answer.
 */

type Turn = {
  role: 'user' | 'assistant';
  content: string;
  citedTitle?: string;
  citedId?: string;
  escalate?: boolean;
  searched?: string[];
  weakMatch?: boolean;
};

const SUGGESTED = [
  'How long is the meal break and what if I miss it?',
  'Does my unused vacation get paid out when I leave?',
  'How much paid sick leave do I get?',
];

export function HrAssist() {
  const [corpus, setCorpus] = useState<Passage[]>(SAMPLE_CORPUS);
  const [corpusName, setCorpusName] = useState(SAMPLE_CORPUS_NAME);
  const [showOwn, setShowOwn] = useState(false);
  const [ownText, setOwnText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [calls, setCalls] = useState<{ remaining: number; limit: number } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchHrStatus()
      .then((s) => !cancelled && setCalls({ remaining: s.callsRemaining, limit: s.dailyLimit }))
      .catch(() => !cancelled && setCalls(null));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [turns, busy]);

  const exhausted = calls?.remaining === 0;
  const citedSet = useMemo(() => new Set(turns.map((t) => t.citedId).filter(Boolean)), [turns]);

  function useSample() {
    setCorpus(SAMPLE_CORPUS);
    setCorpusName(SAMPLE_CORPUS_NAME);
    setShowOwn(false);
    setTurns([]);
    setError(null);
  }

  function loadOwn() {
    const parsed = corpusFromText(ownText);
    if (parsed.length === 0) {
      setError('Couldn’t find any usable passages — separate sections with a blank line.');
      return;
    }
    setCorpus(parsed);
    setCorpusName(`Your documents (${parsed.length} passages)`);
    setTurns([]);
    setError(null);
    setShowOwn(false);
  }

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy || exhausted) return;
    const retrieved = retrieve(question, corpus, 3);
    const weakMatch = retrieved.length === 0;
    const toSend = retrieved.length ? retrieved : corpus.slice(0, 3);
    const searched = toSend.map((p) => p.title);

    setTurns((t) => [...t, { role: 'user', content: question }]);
    setInput('');
    setBusy(true);
    setError(null);
    setHighlightId(null);

    try {
      const r = await askHr(question, toSend.map((p) => ({ id: p.id, title: p.title, text: p.text })));
      if (isHrReply(r)) {
        const citedTitle = r.citedPassageId ? corpus.find((p) => p.id === r.citedPassageId)?.title : undefined;
        setTurns((t) => [
          ...t,
          {
            role: 'assistant',
            content: r.answer,
            citedTitle,
            citedId: r.citedPassageId ?? undefined,
            escalate: r.escalate,
            searched,
            weakMatch,
          },
        ]);
        setHighlightId(r.citedPassageId);
        setCalls({ remaining: r.callsRemaining, limit: r.dailyLimit });
      } else {
        setError(r.error);
        if (typeof r.callsRemaining === 'number') setCalls((c) => (c ? { ...c, remaining: r.callsRemaining! } : c));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] rounded-sm p-4 md:p-5">
      {/* Corpus controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[0.6rem] tracking-[0.12em] uppercase text-[var(--splash-text-faint)]">Corpus</span>
          <span className="font-mono text-[0.7rem] text-[var(--splash-tech)] truncate">{corpusName}</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={useSample}
            className="font-mono text-[0.64rem] tracking-[0.1em] uppercase px-2.5 py-1.5 rounded-sm border transition-colors hover:bg-[var(--splash-bg)]"
            style={{ borderColor: 'var(--splash-line)', color: 'var(--splash-text-soft)' }}
          >
            Sample CA KB
          </button>
          <button
            type="button"
            onClick={() => setShowOwn((v) => !v)}
            className="font-mono text-[0.64rem] tracking-[0.1em] uppercase px-2.5 py-1.5 rounded-sm border transition-colors hover:bg-[var(--splash-bg)]"
            style={{ borderColor: 'var(--splash-line)', color: 'var(--splash-text-soft)' }}
            aria-expanded={showOwn}
          >
            Use my own text
          </button>
        </div>
      </div>

      {showOwn && (
        <div className="mb-3">
          <textarea
            value={ownText}
            onChange={(e) => setOwnText(e.target.value)}
            rows={5}
            placeholder="Paste your policy text. Separate each policy/section with a blank line — the first line of each becomes its title. Don’t paste confidential data."
            className="w-full bg-[var(--splash-bg)] border border-[var(--splash-line)] rounded-sm px-3 py-2.5 font-sans text-[0.82rem] leading-relaxed text-[var(--splash-text)] placeholder:text-[var(--splash-text-faint)] outline-none focus:border-[var(--splash-tech)] resize-y"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={loadOwn}
              className="font-mono text-[0.66rem] tracking-[0.1em] uppercase px-3 py-1.5 rounded-sm border"
              style={{ borderColor: 'var(--splash-tech)', color: 'var(--splash-tech)' }}
            >
              Re-ground on this text
            </button>
          </div>
        </div>
      )}

      {/* Privacy note */}
      <p className="font-mono text-[0.62rem] leading-relaxed text-[var(--splash-text-faint)] mb-3">
        Answers come only from the corpus below. Retrieval runs in your browser; only the matched
        passages are sent to the model. Prototype — not legal advice. Don’t paste confidential data.
      </p>

      <div className="grid md:grid-cols-[1fr_220px] gap-3">
        {/* Chat */}
        <div className="min-w-0 order-2 md:order-1">
          <div
            ref={threadRef}
            className="h-[320px] overflow-y-auto border border-[var(--splash-line)] bg-[var(--splash-bg)] rounded-sm p-3 space-y-3"
            aria-live="polite"
          >
            {turns.length === 0 && (
              <div className="text-[var(--splash-text-faint)] font-sans text-[0.85rem]">
                Ask an HR policy question. Try one:
                <div className="mt-2 flex flex-col gap-1.5 items-start">
                  {SUGGESTED.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      disabled={busy || exhausted}
                      className="text-left font-sans text-[0.82rem] text-[var(--splash-tech)] hover:underline disabled:opacity-50"
                    >
                      “{s}”
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <Bubble key={i} turn={t} />
            ))}
            {busy && <div className="font-mono text-[0.72rem] text-[var(--splash-text-faint)]">retrieving + grounding…</div>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="mt-2 flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy || exhausted}
              maxLength={500}
              placeholder={exhausted ? 'Daily limit reached — resets midnight UTC' : 'Ask an HR policy question…'}
              className="flex-1 bg-[var(--splash-bg)] border border-[var(--splash-line)] rounded-sm px-3 py-2 font-sans text-[0.85rem] text-[var(--splash-text)] placeholder:text-[var(--splash-text-faint)] outline-none focus:border-[var(--splash-tech)] disabled:opacity-50"
              aria-label="HR policy question"
            />
            <button
              type="submit"
              disabled={busy || exhausted || !input.trim()}
              className="font-mono text-[0.7rem] tracking-[0.1em] uppercase px-3.5 py-2 rounded-sm border transition-colors disabled:opacity-50"
              style={{ borderColor: 'var(--splash-tech)', color: 'var(--splash-tech)' }}
            >
              Ask
            </button>
          </form>
          <div className="mt-1.5 font-mono text-[0.62rem] text-[var(--splash-text-faint)]">
            {calls ? `${calls.remaining}/${calls.limit} questions left today` : ''}
          </div>
          {error && (
            <div role="alert" className="mt-2 font-sans text-[0.82rem] text-[var(--splash-bus)]">
              {error}
            </div>
          )}
        </div>

        {/* Corpus passage list */}
        <aside className="order-1 md:order-2" aria-label="Active corpus passages">
          <div className="border border-[var(--splash-line)] bg-[var(--splash-bg)] rounded-sm p-2.5 max-h-[360px] overflow-y-auto">
            <div className="font-mono text-[0.58rem] tracking-[0.14em] uppercase text-[var(--splash-text-faint)] mb-1.5">
              {corpus.length} passages
            </div>
            <ul className="space-y-1 list-none">
              {corpus.map((p) => {
                const isCited = citedSet.has(p.id);
                const isHot = highlightId === p.id;
                return (
                  <li
                    key={p.id}
                    className="font-mono text-[0.66rem] px-2 py-1 rounded-sm truncate"
                    style={{
                      color: isHot ? 'var(--splash-bg)' : isCited ? 'var(--splash-tech)' : 'var(--splash-text-soft)',
                      background: isHot ? 'var(--splash-tech)' : 'transparent',
                    }}
                    title={p.title}
                  >
                    {isCited && !isHot ? '◆ ' : ''}
                    {p.title}
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-sm px-3 py-2 font-sans text-[0.85rem] text-[var(--splash-bg)]" style={{ background: 'var(--splash-tech)' }}>
          {turn.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="max-w-[92%] rounded-sm px-3 py-2 border border-[var(--splash-line)] bg-[var(--splash-bg-soft)] font-sans text-[0.85rem] leading-relaxed text-[var(--splash-text)]">
        {turn.content}
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-1">
        {turn.escalate || !turn.citedTitle ? (
          <span className="font-mono text-[0.6rem] tracking-[0.1em] uppercase px-2 py-0.5 rounded-full" style={{ border: '1px solid var(--splash-bus)', color: 'var(--splash-bus)' }}>
            ⚠ Escalate to human
          </span>
        ) : (
          <span className="font-mono text-[0.6rem] tracking-[0.1em] uppercase px-2 py-0.5 rounded-full" style={{ border: '1px solid var(--splash-tech)', color: 'var(--splash-tech)' }}>
            ◆ Cites: {turn.citedTitle}
          </span>
        )}
        {turn.searched && turn.searched.length > 0 && (
          <span className="font-mono text-[0.58rem] text-[var(--splash-text-faint)]">
            {turn.weakMatch ? 'no strong match — grounded on defaults: ' : 'searched: '}
            {turn.searched.join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}
