/**
 * POST /api/alphavantage  { symbol: "AAPL" }
 *
 * Proxies to Alpha Vantage GLOBAL_QUOTE, decrements the shared daily counter,
 * returns a normalized quote shape + the new callsRemaining count.
 *
 * The API key is read from process.env.ALPHAVANTAGE_KEY at request time.
 * Frontend never sees the key.
 */

// node-fetch v3 is ESM only — use dynamic import from CJS function code.
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const counter = require('../shared/counter');

module.exports = async function (context, req) {
  const symbolRaw = (req.body && req.body.symbol) || '';
  const symbol = String(symbolRaw).toUpperCase().trim();

  // Validate before consuming a counter slot
  if (!symbol || !/^[A-Z.]{1,10}$/.test(symbol)) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Invalid symbol. Use 1–10 letters (or "."), e.g. AAPL' },
    };
    return;
  }

  // Counter check BEFORE network call so we never get stuck mid-decrement
  if (counter.getRemaining() <= 0) {
    context.res = {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
      body: {
        error: 'Daily Alpha Vantage limit reached — resets at midnight UTC',
        callsRemaining: 0,
        dailyLimit: counter.getDailyLimit(),
      },
    };
    return;
  }

  const key = process.env.ALPHAVANTAGE_KEY;
  if (!key) {
    context.log.error('ALPHAVANTAGE_KEY not set in app settings');
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'API key not configured' },
    };
    return;
  }

  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
    const resp = await fetch(url);
    const data = await resp.json();

    // Always increment after the upstream call, regardless of result —
    // Alpha Vantage counts failed lookups against the quota too.
    counter.incrementCounter();

    const quote = (data && data['Global Quote']) || {};

    // Alpha Vantage returns an empty Global Quote object if the symbol is not found
    if (!quote['01. symbol']) {
      const note = data && (data['Note'] || data['Information']);
      context.res = {
        status: note ? 429 : 404,
        headers: { 'Content-Type': 'application/json' },
        body: {
          error: note
            ? 'Alpha Vantage upstream rate-limited this request — try again in a moment'
            : `No quote found for ${symbol}`,
          callsRemaining: counter.getRemaining(),
          dailyLimit: counter.getDailyLimit(),
        },
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        symbol: quote['01. symbol'],
        price: parseFloat(quote['05. price']),
        change: parseFloat(quote['09. change']),
        percentChange: quote['10. change percent'],
        latestTradingDay: quote['07. latest trading day'],
        callsRemaining: counter.getRemaining(),
        dailyLimit: counter.getDailyLimit(),
        attribution: 'Alpha Vantage (free tier)',
      },
    };
  } catch (err) {
    context.log.error('Alpha Vantage fetch failed', err && err.message ? err.message : err);
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Upstream API error' },
    };
  }
};
