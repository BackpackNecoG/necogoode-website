/**
 * GET /api/alphavantage-status
 *
 * Returns the current daily-counter state without spending an Alpha Vantage call.
 * Called by the frontend on page load to populate the counter widget.
 */

const counter = require('../shared/counter');

module.exports = async function (context, _req) {
  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: {
      callsRemaining: counter.getRemaining(),
      dailyLimit: counter.getDailyLimit(),
      attribution: 'Alpha Vantage (free tier)',
      attributionUrl: 'https://www.alphavantage.co/',
    },
  };
};
