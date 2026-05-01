/**
 * GET /api/talk-dangerously-status
 *
 * Returns the talk-dangerously daily counter snapshot without spending a call.
 * Frontend calls this on /console mount to populate the counter widget.
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
      callsRemaining: counter.getRemaining('talk-dangerously'),
      dailyLimit: counter.getDailyLimit('talk-dangerously'),
      model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini',
      attribution: 'Azure OpenAI Service · gpt-4o-mini',
      attributionUrl: 'https://azure.microsoft.com/en-us/products/ai-services/openai-service',
    },
  };
};
