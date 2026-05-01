/**
 * Shared daily-counter module — used by alphavantage, alphavantage-status,
 * talk-dangerously, and talk-dangerously-status.
 *
 * Each NAMED counter has its own independent daily quota.
 * Counters reset at midnight UTC.
 *
 * KNOWN LIMITATION (V1):
 *   Azure Functions on Static Web Apps run on short-lived workers and may
 *   serve concurrent requests from different instances. Each instance has its
 *   own in-memory counter, so the displayed count is approximate and can drift
 *   if the function scales out. For a free-tier portfolio this is acceptable;
 *   the upstream rate limits (Alpha Vantage hard cap, AOAI quota) enforce
 *   the actual ceiling regardless.
 *
 * TODO V2: migrate this to Azure Table Storage so all instances read/write a
 * single source of truth. The interface below is stable — only the
 * implementation changes.
 */

// Independent daily caps per counter name.
const LIMITS = {
  alphavantage: 25,         // matches Alpha Vantage free tier
  'talk-dangerously': 50,   // gpt-4o-mini cost-controlled cap
};

const caches = {}; // { [name]: { date, used } }

function getTodayUtcKey() {
  return new Date().toISOString().substring(0, 10); // YYYY-MM-DD UTC
}

function ensureCurrentDay(name) {
  const today = getTodayUtcKey();
  if (!caches[name] || caches[name].date !== today) {
    caches[name] = { date: today, used: 0 };
  }
}

function getRemaining(name) {
  ensureCurrentDay(name);
  const limit = LIMITS[name];
  if (limit === undefined) throw new Error(`Unknown counter: ${name}`);
  return Math.max(0, limit - caches[name].used);
}

function incrementCounter(name) {
  ensureCurrentDay(name);
  if (LIMITS[name] === undefined) throw new Error(`Unknown counter: ${name}`);
  caches[name].used += 1;
}

function getDailyLimit(name) {
  const limit = LIMITS[name];
  if (limit === undefined) throw new Error(`Unknown counter: ${name}`);
  return limit;
}

module.exports = {
  getRemaining,
  incrementCounter,
  getDailyLimit,
};
