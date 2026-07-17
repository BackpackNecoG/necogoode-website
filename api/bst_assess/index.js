/* /api/bst/assess — the AI CONTROL ROOM. A missed answer (or any fix-this
   submission) arrives with its question, the provided context, the lesson
   concept, the expected answer, and what the trainee wrote. The model —
   through the site's existing provider-pluggable ../shared/ai (Azure OpenAI /
   OpenAI / Anthropic, whichever the owner configured) — writes a short review:
   what the trainee got RIGHT first (confidence), then the one mental-model
   shift that fixes the miss. Grounded in the provided material only.
   Not configured → {text:null} and the studio silently skips AI reviews. */
const ai = require('../shared/ai');
const bst = require('../shared/bst');

module.exports = async function (context, req) {
  const res = (status, body) => { context.res = { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body }; };
  const email = bst.sessionEmail(req.headers.cookie);
  if (!email) return res(401, {});
  try {
    if (!ai.provider()) return res(200, { text: null, reason: 'not-configured' });
    const b = req.body || {};
    const clip = (v, n) => String(v || '').slice(0, n);
    const payload = {
      lesson: clip(b.lesson, 120), concept: clip(b.concept, 120), type: clip(b.type, 12),
      question: clip(b.question, 700), provided: clip(b.provided, 1200),
      expected: clip(b.expected, 700), answer: clip(b.answer, 1500)
    };
    if (!payload.question || !payload.answer) return res(200, { text: null, reason: 'bad-request' });

    const system =
      'You are the control room reviewer on "Byte Sized Training," a Python training broadcast anchored by Mr. Bryte. ' +
      'A trainee answered a question. Write a 2-4 sentence review for their report card. ' +
      'RULES: (1) Start with something they genuinely got RIGHT or a correct instinct visible in their answer — be specific, not generic praise. ' +
      '(2) Then give the ONE mental-model shift that fixes the miss, grounded ONLY in the provided material — no new topics, no invented facts. ' +
      '(3) Plain language a teenager follows; warm, honest, never condescending. ' +
      '(4) If their answer is fully correct, say what makes it solid and add one sharpening detail from the material. ' +
      'Output plain text only, no markdown headers.';

    const user =
      'Lesson: ' + payload.lesson + '\nConcept: ' + payload.concept + '\nQuestion type: ' + payload.type +
      '\n\nQuestion:\n' + payload.question +
      (payload.provided ? '\n\nMaterial shown with the question:\n' + payload.provided : '') +
      '\n\nExpected answer / model fix:\n' + payload.expected +
      '\n\nTrainee\'s answer:\n' + payload.answer;

    let text;
    try { text = await ai.complete({ system, user, maxTokens: 280, tier: 'fast' }); }
    catch (e) { return res(200, { text: null, reason: e.reason || 'error' }); }
    text = String(text || '').trim();
    if (!text || text === 'DEFER') return res(200, { text: null, reason: 'defer' });
    return res(200, { text });
  } catch (e) {
    context.log('[bst/assess] ' + (e && e.message));
    return res(500, { error: 'server' });
  }
};
