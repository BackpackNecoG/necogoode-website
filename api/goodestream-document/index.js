/**
 * POST /api/goodestream-document
 *   { text: string, purpose: "performance-feedback" | "job-description" }
 *
 * GoodeStream Document Insight — one analysis engine, a rubric per purpose.
 * The frontend extracts plain text from the uploaded file (txt/md/pdf/docx)
 * IN THE BROWSER and sends only that text here. This function runs the
 * purpose's rubric through Azure OpenAI gpt-4o-mini and returns a structured
 * report (summary + flagged findings + suggested rewrites).
 *
 * Privacy: the text is analyzed in-memory for one request and never persisted.
 * Reuses the Azure OpenAI config + daily-counter pattern from talk-dangerously.
 */

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const counter = require('../shared/counter');

const COUNTER_NAME = 'goodestream-doc';
const MAX_TEXT = 12000; // chars of document text sent to the model
const COMPLETION_MAX_TOKENS = 1100;

// Rubrics keyed by purpose. Adding a purpose = adding a rubric here + an option
// in the frontend dropdown — no engine change. (Extensible by design.)
const RUBRICS = {
  'performance-feedback': {
    label: 'Performance feedback review',
    rubric: `You are reviewing manager-written PERFORMANCE FEEDBACK. Evaluate it on:
- Clarity: is it specific and unambiguous?
- Specificity: are there concrete examples and behaviors, not vague traits?
- Actionability: can the employee actually do something with it?
- Fairness / bias: flag personality-based, gendered, age, or other biased framing; flag judgments of the person vs. the work.
For each issue, quote the offending excerpt, explain the problem, and give a concrete rewritten version.`,
  },
  'job-description': {
    label: 'Job description — bias & quality check',
    rubric: `You are reviewing a JOB DESCRIPTION. Evaluate it on:
- Exclusionary language: gendered terms, ableist phrasing, culture-fit dog whistles, "rockstar/ninja" hype.
- Inflated / unnecessary requirements: arbitrary years of experience, degree requirements that aren't needed, long must-have lists that deter qualified applicants (especially from underrepresented groups).
- Tone & inclusivity: is it welcoming to a broad pool?
For each issue, quote the offending excerpt, explain the problem, and give a concrete rewritten version.`,
  },
};

const SYSTEM_BASE = `You are Document Insight (a Goode Talent Concepts prototype), a Talent document reviewer. You ASSIST a human reviewer — you never make the final decision, and you say so implicitly by phrasing everything as suggestions.

You will be given a rubric and a document. Apply ONLY that rubric. Be concrete and fair. Do not invent issues that aren't supported by the text; if the document is already good, say so and return few or no findings.

Respond ONLY with a JSON object of this exact shape:
{
  "summary": string,                       // 1-2 sentences: overall assessment
  "findings": [
    {
      "severity": "high" | "medium" | "low",
      "label": string,                     // short category, e.g. "Vague / not actionable"
      "excerpt": string,                   // the quoted text from the document (<= 200 chars), or "" if general
      "issue": string,                     // why it's a problem, 1-2 sentences
      "suggestion": string                 // a concrete rewrite or fix
    }
  ]
}
Limit to the 8 most important findings, most severe first.`;

module.exports = async function (context, req) {
  const textRaw = (req.body && req.body.text) || '';
  const text = String(textRaw).trim();
  const purpose = String((req.body && req.body.purpose) || '').trim();

  if (!text) {
    context.res = json(400, { error: 'text is required' });
    return;
  }
  if (!RUBRICS[purpose]) {
    context.res = json(400, { error: `unknown purpose; expected one of: ${Object.keys(RUBRICS).join(', ')}` });
    return;
  }
  if (text.length < 40) {
    context.res = json(400, { error: 'document is too short to analyze (need at least ~40 characters)' });
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

  const clipped = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  const truncated = text.length > MAX_TEXT;
  const { rubric } = RUBRICS[purpose];
  const userContent = `RUBRIC:\n${rubric}\n\n---\nDOCUMENT:\n${clipped}`;

  try {
    const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': key },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_BASE },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
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

    const findings = Array.isArray(parsed.findings)
      ? parsed.findings.slice(0, 8).map((f) => ({
          severity: ['high', 'medium', 'low'].includes(f && f.severity) ? f.severity : 'medium',
          label: typeof (f && f.label) === 'string' ? f.label : 'Finding',
          excerpt: typeof (f && f.excerpt) === 'string' ? f.excerpt.slice(0, 240) : '',
          issue: typeof (f && f.issue) === 'string' ? f.issue : '',
          suggestion: typeof (f && f.suggestion) === 'string' ? f.suggestion : '',
        }))
      : [];

    context.res = json(200, {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      findings,
      truncated,
      purpose,
      purposeLabel: RUBRICS[purpose].label,
      callsRemaining: counter.getRemaining(COUNTER_NAME),
      dailyLimit: counter.getDailyLimit(COUNTER_NAME),
      model: deployment,
      attribution: 'Azure OpenAI Service · gpt-4o-mini',
    });
  } catch (err) {
    context.log.error('goodestream-document failed', err && err.message ? err.message : err);
    context.res = json(502, { error: 'Upstream API error' });
  }
};

function json(status, body) {
  return { status, headers: { 'Content-Type': 'application/json' }, body };
}
