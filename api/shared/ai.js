/* api/shared/ai.js — BRING YOUR OWN AI.
   One adapter, three providers; the customer plugs in whichever key they
   already pay for. Selection: EMCEE_AI_PROVIDER app setting if set
   ('azure-openai' | 'openai' | 'anthropic'), else inferred from which
   credentials exist (Azure OpenAI first — it's the common "billing already
   goes through Azure" case — then Anthropic, then OpenAI).

   Settings per provider:
     azure-openai  EMCEE_AOAI_ENDPOINT (https://<res>.openai.azure.com)
                   EMCEE_AOAI_KEY
                   EMCEE_AOAI_DEPLOYMENT           (fast tier: /api/ask)
                   EMCEE_AOAI_REVIEW_DEPLOYMENT    (optional; falls back to fast)
     anthropic     ANTHROPIC_API_KEY
                   EMCEE_MODEL / EMCEE_REVIEW_MODEL (optional overrides)
     openai        OPENAI_API_KEY
                   EMCEE_MODEL / EMCEE_REVIEW_MODEL (optional overrides)

   API: provider() -> name or null; complete({system,user,maxTokens,tier})
   -> Promise<string>. Throws Error with .reason on upstream failure. */

const AOAI_API_VERSION = process.env.EMCEE_AOAI_API_VERSION || '2024-06-01';

function provider() {
  const p = (process.env.EMCEE_AI_PROVIDER || '').toLowerCase().trim();
  if (p) return p;
  if (process.env.EMCEE_AOAI_ENDPOINT && process.env.EMCEE_AOAI_KEY) return 'azure-openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function fail(reason, detail) {
  const e = new Error(detail || reason);
  e.reason = reason;
  return e;
}

async function complete(opts) {
  const { system, user, maxTokens = 220, tier = 'fast' } = opts || {};
  const p = provider();
  if (!p) throw fail('not-configured');

  if (p === 'anthropic') {
    const model = tier === 'review'
      ? (process.env.EMCEE_REVIEW_MODEL || 'claude-sonnet-5')
      : (process.env.EMCEE_MODEL || 'claude-haiku-4-5-20251001');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
    });
    if (!r.ok) throw fail('upstream-' + r.status);
    const j = await r.json();
    return ((j.content && j.content[0] && j.content[0].text) || '').trim();
  }

  /* openai + azure-openai share the chat-completions shape */
  let url, headers;
  if (p === 'azure-openai') {
    const ep = String(process.env.EMCEE_AOAI_ENDPOINT || '').replace(/\/+$/, '');
    const dep = (tier === 'review' && process.env.EMCEE_AOAI_REVIEW_DEPLOYMENT)
      ? process.env.EMCEE_AOAI_REVIEW_DEPLOYMENT
      : process.env.EMCEE_AOAI_DEPLOYMENT;
    if (!ep || !dep || !process.env.EMCEE_AOAI_KEY) throw fail('not-configured');
    url = ep + '/openai/deployments/' + encodeURIComponent(dep) + '/chat/completions?api-version=' + AOAI_API_VERSION;
    headers = { 'api-key': process.env.EMCEE_AOAI_KEY, 'content-type': 'application/json' };
  } else if (p === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers = { authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'content-type': 'application/json' };
  } else {
    throw fail('unknown-provider', 'EMCEE_AI_PROVIDER=' + p);
  }

  const body = {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: maxTokens
  };
  if (p === 'openai') {
    body.model = tier === 'review'
      ? (process.env.EMCEE_REVIEW_MODEL || 'gpt-4o')
      : (process.env.EMCEE_MODEL || 'gpt-4o-mini');
  }
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw fail('upstream-' + r.status);
  const j = await r.json();
  return ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
}

module.exports = { provider, complete };
