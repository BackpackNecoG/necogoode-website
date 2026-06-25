/**
 * POST /api/goodestream-hr
 *   { question: string, passages: [{ id, title, text }] }
 *
 * GoodeStream HR Assist — a retrieval-grounded HR support agent.
 *
 * The frontend does lightweight retrieval over the active corpus (the bundled
 * California HR sample, or the visitor's uploaded text) and sends ONLY the
 * top-scoring passages here. This function asks Azure OpenAI gpt-4o-mini to
 * answer STRICTLY from those passages, cite the passage it used, or escalate
 * to a human when the passages don't contain the answer. It never answers from
 * outside the supplied passages.
 *
 * Privacy: passages are processed in-memory for this single request and never
 * persisted. Reuses the same Azure OpenAI config + daily-counter pattern as
 * talk-dangerously (no key in the client).
 */

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const counter = require('../shared/counter');

const COUNTER_NAME = 'goodestream-hr';
const MAX_QUESTION = 500;
const MAX_PASSAGES = 6;
const MAX_PASSAGE_CHARS = 1600;
const MAX_TOTAL_PASSAGE_CHARS = 7000;
const COMPLETION_MAX_TOKENS = 600;

const SYSTEM_PROMPT = `You are GoodeStream HR Assist, a Tier-1 HR support assistant for a single company.

You answer EXCLUSIVELY from the policy passages provided in the user message. These passages are the only source of truth. You must never use outside knowledge, general HR norms, or assumptions.

Rules:
- If the passages clearly contain the answer, answer concisely and ground every claim in them. Set "grounded": true and "citedPassageId" to the id of the single passage you relied on most.
- If the passages are insufficient, ambiguous, or do not cover the question, DO NOT guess. Set "grounded": false, "escalate": true, and write an "answer" that politely says you can't confirm this from the loaded documents and the employee should check with HR.
- This is HR policy Q&A, not legal advice. Never present it as legal advice.
- Keep the answer under 120 words. Plain, direct, no greeting.

Respond ONLY with a JSON object of this exact shape:
{ "grounded": boolean, "escalate": boolean, "citedPassageId": string|null, "answer": string }`;

function sanitizePassages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  let total = 0;
  for (const p of raw.slice(0, MAX_PASSAGES)) {
    if (!p || typeof p !== 'object') continue;
    const id = typeof p.id === 'string' ? p.id.slice(0, 64) : null;
    const title = typeof p.title === 'string' ? p.title.slice(0, 160) : '';
    let text = typeof p.text === 'string' ? p.text : '';
    if (!id || !text) continue;
    if (text.length > MAX_PASSAGE_CHARS) text = text.slice(0, MAX_PASSAGE_CHARS);
    if (total + text.length > MAX_TOTAL_PASSAGE_CHARS) break;
    total += text.length;
    out.push({ id, title, text });
  }
  return out;
}

module.exports = async function (context, req) {
  const questionRaw = (req.body && req.body.question) || '';
  const question = String(questionRaw).trim();

  if (!question) {
    context.res = json(400, { error: 'question is required' });
    return;
  }
  if (question.length > MAX_QUESTION) {
    context.res = json(400, { error: `question too long (max ${MAX_QUESTION} chars)` });
    return;
  }

  const passages = sanitizePassages(req.body && req.body.passages);
  if (passages.length === 0) {
    context.res = json(400, { error: 'no passages supplied — load a corpus first' });
    return;
  }

  if (counter.getRemaining(COUNTER_NAME) <= 0) {
    context.res = json(429, {
      error: 'Daily limit reached — resets at midnight UTC',
      callsRemaining: 0,
      dailyLimit: counter.getDailyLimit(COUNTER_NAME),
    });
    return;
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';
  if (!endpoint || !key) {
    context.log.error('Azure OpenAI configuration missing');
    context.res = json(500, { error: 'OpenAI not configured' });
    return;
  }

  const corpusBlock = passages
    .map((p) => `[PASSAGE id="${p.id}"${p.title ? ` title="${p.title}"` : ''}]\n${p.text}`)
    .join('\n\n');
  const userContent = `POLICY PASSAGES (the only source you may use):\n\n${corpusBlock}\n\n---\nEMPLOYEE QUESTION: ${question}`;

  try {
    const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': key },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: COMPLETION_MAX_TOKENS,
        response_format: { type: 'json_object' },
      }),
    });

    counter.incrementCounter(COUNTER_NAME);

    if (!resp.ok) {
      const errBody = await resp.text();
      context.log.error('AOAI non-2xx', resp.status, errBody.substring(0, 400));
      context.res = json(502, { error: 'Upstream model error', callsRemaining: counter.getRemaining(COUNTER_NAME) });
      return;
    }

    const data = await resp.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      context.res = json(502, { error: 'Model returned malformed output', callsRemaining: counter.getRemaining(COUNTER_NAME) });
      return;
    }

    // Validate the citation actually points at a supplied passage.
    const validIds = new Set(passages.map((p) => p.id));
    const citedPassageId =
      parsed.citedPassageId && validIds.has(parsed.citedPassageId) ? parsed.citedPassageId : null;

    context.res = json(200, {
      grounded: Boolean(parsed.grounded) && !!citedPassageId,
      escalate: Boolean(parsed.escalate) || !citedPassageId,
      citedPassageId,
      answer: typeof parsed.answer === 'string' ? parsed.answer : '',
      callsRemaining: counter.getRemaining(COUNTER_NAME),
      dailyLimit: counter.getDailyLimit(COUNTER_NAME),
      model: deployment,
      attribution: 'Azure OpenAI Service · gpt-4o-mini',
    });
  } catch (err) {
    context.log.error('goodestream-hr failed', err && err.message ? err.message : err);
    context.res = json(502, { error: 'Upstream API error' });
  }
};

function json(status, body) {
  return { status, headers: { 'Content-Type': 'application/json' }, body };
}
