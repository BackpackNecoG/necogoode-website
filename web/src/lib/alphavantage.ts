/**
 * Frontend client for the Alpha Vantage proxy backend.
 * Endpoints are relative paths so they work in both local dev (Vite proxy)
 * and prod (Azure Static Web Apps Functions on the same origin).
 */

export type AlphaVantageQuote = {
  symbol: string;
  price: number;
  change: number;
  percentChange: string;
  latestTradingDay: string;
  callsRemaining: number;
  dailyLimit: number;
  attribution: string;
};

export type AlphaVantageStatus = {
  callsRemaining: number;
  dailyLimit: number;
  attribution: string;
  attributionUrl: string;
};

export type AlphaVantageError = {
  error: string;
  callsRemaining?: number;
  dailyLimit?: number;
};

/** GET current free-tier counter without spending a call. */
export async function fetchStatus(): Promise<AlphaVantageStatus> {
  const resp = await fetch('/api/alphavantage-status', { method: 'GET' });
  if (!resp.ok) {
    throw new Error(`Status endpoint returned ${resp.status}`);
  }
  return resp.json();
}

/**
 * POST a symbol → get a real quote and the new counter value.
 * On 429 (rate-limited) or 404 (no quote), the response shape includes
 * `error` plus the current `callsRemaining`. On 5xx, the call rejects.
 */
export async function fetchQuote(symbol: string): Promise<AlphaVantageQuote | AlphaVantageError> {
  const resp = await fetch('/api/alphavantage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol }),
  });
  const body = (await resp.json()) as AlphaVantageQuote | AlphaVantageError;
  if (resp.status >= 500) {
    throw new Error(`Quote endpoint returned ${resp.status}: ${('error' in body && body.error) || 'unknown'}`);
  }
  return body;
}

export function isQuote(r: AlphaVantageQuote | AlphaVantageError): r is AlphaVantageQuote {
  return (r as AlphaVantageQuote).price !== undefined;
}
