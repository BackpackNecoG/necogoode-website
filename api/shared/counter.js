/**
 * Shared daily-counter module — used by both alphavantage and alphavantage-status.
 *
 * Design: in-memory cache keyed by UTC date. Resets at midnight UTC.
 *
 * KNOWN LIMITATION (V1):
 *   Azure Functions on Static Web Apps run on short-lived workers and may
 *   serve concurrent requests from different instances. Each instance has its
 *   own in-memory counter, so the displayed count is approximate and can drift
 *   if the function scales out. For a free-tier portfolio this is acceptable;
 *   the upstream Alpha Vantage rate limit is enforced by Alpha Vantage anyway.
 *
 * TODO V2: migrate this to Azure Table Storage (or Cosmos DB) so all instances
 * read/write a single source of truth. The interface below should remain stable
 * — only the implementation of `getRemaining` / `incrementCounter` should change.
 */

const DAILY_LIMIT = 25; // Alpha Vantage free tier as of 2026

let counterCache = { date: null, used: 0 };

function getTodayUtcKey() {
  return new Date().toISOString().substring(0, 10); // YYYY-MM-DD UTC
}

function ensureCurrentDay() {
  const today = getTodayUtcKey();
  if (counterCache.date !== today) {
    counterCache = { date: today, used: 0 };
  }
}

function getRemaining() {
  ensureCurrentDay();
  return Math.max(0, DAILY_LIMIT - counterCache.used);
}

function incrementCounter() {
  ensureCurrentDay();
  counterCache.used += 1;
}

function getDailyLimit() {
  return DAILY_LIMIT;
}

module.exports = {
  getRemaining,
  incrementCounter,
  getDailyLimit,
};
