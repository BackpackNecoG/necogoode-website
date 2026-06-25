/**
 * GET /api/goodestream-hr-status
 * Returns the HR Assist daily counter snapshot without spending a call.
 */
const counter = require('../shared/counter');

module.exports = async function (context, _req) {
  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: {
      callsRemaining: counter.getRemaining('goodestream-hr'),
      dailyLimit: counter.getDailyLimit('goodestream-hr'),
      model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini',
      attribution: 'Azure OpenAI Service · gpt-4o-mini',
    },
  };
};
