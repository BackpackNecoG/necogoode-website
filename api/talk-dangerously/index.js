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

const MAX_INPUT_LENGTH = 1000;       // hard input cap per single turn
const MAX_HISTORY_TURNS = 10;        // cap conversation context to keep token cost bounded
const MAX_HISTORY_CHARS = 8000;      // belt-and-suspenders: ~2k tokens of history max
const COMPLETION_MAX_TOKENS = 400;   // ~300 words; combined with system prompt ~$0.0005/call
const COUNTER_NAME = 'talk-dangerously';

/**
 * Validate + sanitize the conversation history sent from the frontend.
 * Returns a safe array of {role, content} turns, capped by both turn count
 * and total characters. Never trusts the frontend's roles or content blindly.
 */
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  let totalChars = 0;
  for (const turn of raw.slice(-MAX_HISTORY_TURNS)) {
    if (!turn || typeof turn !== 'object') continue;
    const role = turn.role === 'user' || turn.role === 'assistant' ? turn.role : null;
    const content = typeof turn.content === 'string' ? turn.content : null;
    if (!role || !content) continue;
    const trimmed = content.length > MAX_INPUT_LENGTH ? content.substring(0, MAX_INPUT_LENGTH) : content;
    if (totalChars + trimmed.length > MAX_HISTORY_CHARS) break;
    totalChars += trimmed.length;
    cleaned.push({ role, content: trimmed });
  }
  return cleaned;
}

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

  // Build the messages array: system prompt → sanitized history → current user turn.
  const history = sanitizeHistory(req.body && req.body.history);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: message },
  ];

  try {
    const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': key,
      },
      body: JSON.stringify({
        messages,
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
