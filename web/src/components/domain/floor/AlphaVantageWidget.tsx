import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fetchStatus, fetchQuote, isQuote, type AlphaVantageQuote } from '../../../lib/alphavantage';
import { Tooltip } from '../../ui/Tooltip';

/**
 * Alpha Vantage live ticker widget.
 *
 * UX flow per spec:
 *   1. On mount: GET /api/alphavantage-status → populate counter widget
 *   2. User submits a symbol → POST /api/alphavantage → display result, decrement counter
 *   3. When callsRemaining === 0: input is disabled with the "limit reached" placeholder
 *   4. Hover the counter → tooltip with attribution + reset-time copy
 *
 * Errors are surfaced inline below the input so the user understands what happened.
 */
export function AlphaVantageWidget() {
  const [callsRemaining, setCallsRemaining] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState<number>(25);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [symbol, setSymbol] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<AlphaVantageQuote[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Populate the counter on first paint.
  useEffect(() => {
    let cancelled = false;
    fetchStatus()
      .then((s) => {
        if (cancelled) return;
        setCallsRemaining(s.callsRemaining);
        setDailyLimit(s.dailyLimit);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'unable to reach API';
        setStatusError(msg);
        // Default to optimistic full-counter so the UI does not block usage on a transient status failure.
        setCallsRemaining(25);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    if (!sym || busy) return;
    if (!/^[A-Z.]{1,10}$/.test(sym)) {
      setErrorMsg('Invalid symbol format. Use letters or "."');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const r = await fetchQuote(sym);
      if (isQuote(r)) {
        setResults((prev) => [r, ...prev]);
        setCallsRemaining(r.callsRemaining);
        setSymbol('');
      } else {
        setErrorMsg(r.error ?? 'unknown error');
        if (typeof r.callsRemaining === 'number') setCallsRemaining(r.callsRemaining);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'request failed';
      setErrorMsg(msg);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const exhausted = callsRemaining === 0;

  return (
    <div>
      {/* Counter widget with hover tooltip */}
      <div className="mb-3 flex items-center justify-between text-[0.72rem]">
        <Tooltip
          content={
            <>
              Powered by <a href="https://www.alphavantage.co/" target="_blank" rel="noopener noreferrer" className="text-[var(--floor-amber)] underline">Alpha Vantage</a>&apos;s free tier API. Limit resets at midnight UTC. We attribute all financial data to Alpha Vantage.
            </>
          }
        >
          <span className="cursor-help underline-offset-4 underline decoration-dotted decoration-[var(--floor-text-faint)] text-[var(--floor-text-soft)] uppercase tracking-[0.1em]">
            AV Free Tier ·{' '}
            <span className={callsRemaining !== null && callsRemaining <= 5 ? 'text-[var(--floor-loss)]' : 'text-[var(--floor-amber)]'}>
              {callsRemaining ?? '…'} / {dailyLimit}
            </span>
            {' '}calls
          </span>
        </Tooltip>
        {statusError && (
          <span className="text-[var(--floor-loss)] text-[0.65rem] uppercase">offline</span>
        )}
      </div>

      {/* Symbol input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-3.5 py-2.5 bg-[var(--floor-bg-soft)] border border-[var(--floor-line)]"
      >
        <span className="text-[var(--floor-gain)] text-base">▸</span>
        <input
          ref={inputRef}
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          disabled={exhausted || busy}
          placeholder={
            exhausted
              ? 'Daily Alpha Vantage limit reached — resets at midnight UTC'
              : 'enter symbol, eg. AAPL'
          }
          className="flex-1 bg-transparent border-none outline-none text-[var(--floor-text)] placeholder:text-[var(--floor-text-faint)] text-[0.78rem] font-mono uppercase disabled:opacity-50"
          maxLength={10}
        />
        {busy && <span className="text-[var(--floor-text-faint)] text-[0.7rem] uppercase">querying…</span>}
      </form>

      <div className="mt-1.5 text-[0.65rem] text-[var(--floor-text-faint)] tracking-[0.08em]">
        type a real ticker · or click the watchlist
      </div>

      {/* Result rows or error */}
      {errorMsg && (
        <div className="mt-3 text-[0.78rem] text-[var(--floor-loss)] border border-[var(--floor-loss)]/30 bg-[var(--floor-loss-bg)] p-2.5">
          {errorMsg}
        </div>
      )}
      {results.length > 0 && (
        <div className="mt-3 border-t border-[var(--floor-line)]">
          {results.map((r, i) => (
            <QuoteRow key={`${r.symbol}-${i}`} quote={r} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Result row styled like a watchlist entry — same visual language. */
function QuoteRow({ quote }: { quote: AlphaVantageQuote }) {
  const positive = quote.change >= 0;
  return (
    <div className="grid items-center py-2.5 border-b border-[var(--floor-line)] text-[0.78rem]"
         style={{ gridTemplateColumns: '70px 1fr 60px', gap: '0.5rem' }}>
      <div className="font-semibold text-[var(--floor-text)]">{quote.symbol}</div>
      <div className="font-mono tabular-nums text-[var(--floor-text)]">
        ${quote.price.toFixed(2)}{' '}
        <span className={positive ? 'text-[var(--floor-gain)]' : 'text-[var(--floor-loss)]'}>
          {positive ? '▲' : '▼'} {quote.change.toFixed(2)} ({quote.percentChange})
        </span>
      </div>
      <div className="text-right text-[var(--floor-text-faint)] text-[0.65rem]">
        {quote.latestTradingDay}
      </div>
    </div>
  );
}
