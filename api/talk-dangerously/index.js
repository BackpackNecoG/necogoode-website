/**
 * POST /api/talk-dangerously  { message: "..." }
 *
 * Proxies a single-shot chat completion against Azure OpenAI gpt-4o-mini,
 * wrapping the visitor's input in Neco Goode's "primitive-decomposition"
 * system prompt. Decrements the shared 50/day talk-dangerously counter.
 *
 * Hosted on Azure OpenAI Service so the page can advertise "full Microsoft stack:
 * SWA + Functions + Azure OpenAI". Identical model (gpt-4o-mini) to OpenAI direct,
 * billed through the existing Azure subscription.
 */

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const counter = require('../shared/counter');
const { SYSTEM_PROMPT } = require('../shared/system-prompt');

const MAX_INPUT_LENGTH = 1000;       // hard input cap to control upstream tokens
const COMPLETION_MAX_TOKENS = 400;   // ~300 words; combined with system prompt ~$0.0005/call
const COUNTER_NAME = 'talk-dangerously';

module.exports = async function (context, req) {
  const messageRaw = (req.body && req.body.message) || '';
  const message = String(messageRaw).trim();

  if (!message) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'message is required' },
    };
    return;
  }
  if (message.length > MAX_INPUT_LENGTH) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { error: `message too long (${message.length} chars; max ${MAX_INPUT_LENGTH})` },
    };
    return;
  }

  if (counter.getRemaining(COUNTER_NAME) <= 0) {
    context.res = {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
      body: {
        error: 'Daily limit reached — resets at midnight UTC',
        callsRemaining: 0,
        dailyLimit: counter.getDailyLimit(COUNTER_NAME),
      },
    };
    return;
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';

  if (!endpoint || !key) {
    context.log.error('Azure OpenAI configuration missing');
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'OpenAI not configured' },
    };
    return;
  }

  try {
    const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': key,
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        temperature: 0.4,
        max_tokens: COMPLETION_MAX_TOKENS,
      }),
    });

    // Increment AFTER the upstream call so a clean 5xx doesn't burn quota.
    counter.incrementCounter(COUNTER_NAME);

    if (!resp.ok) {
      const errBody = await resp.text();
      context.log.error('AOAI returned non-2xx', resp.status, errBody.substring(0, 500));
      context.res = {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: {
          error: 'Upstream model error',
          callsRemaining: counter.getRemaining(COUNTER_NAME),
        },
      };
      return;
    }

    const data = await resp.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

    if (!reply) {
      context.res = {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: {
          error: 'Empty model response',
          callsRemaining: counter.getRemaining(COUNTER_NAME),
        },
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        reply,
        callsRemaining: counter.getRemaining(COUNTER_NAME),
        dailyLimit: counter.getDailyLimit(COUNTER_NAME),
        model: deployment,
        attribution: 'Azure OpenAI Service · gpt-4o-mini',
        usage: data.usage,
      },
    };
  } catch (err) {
    context.log.error('talk-dangerously fetch failed', err && err.message ? err.message : err);
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Upstream API error' },
    };
  }
};
