/* Notifications. Teams: POST the Adaptive Card message to a Teams Workflows webhook address (read from Key Vault; the
   intent only names the secret). Outlook: Microsoft Graph POST /users/{sender}/sendMail with the relay's managed identity
   (application permission Mail.Send, ideally scoped to the sender mailbox with an Exchange application access policy). */
'use strict';
const { failure } = require('./http');

const TEAMS_SECRET_RE = /^teams-webhook-[a-z0-9-]{1,100}$/;

async function teams({ http, secrets }, payload) {
  if (!TEAMS_SECRET_RE.test(String(payload.secretName || ''))) return { ok: false, detail: 'Teams intents may only name a teams-webhook-* secret.' };
  const url = await secrets.get(payload.secretName);
  if (!url) return { ok: false, detail: `Key Vault has no secret ${payload.secretName}. Add the channel's Workflows webhook address there.` };
  if (!/^https:\/\//.test(url)) return { ok: false, detail: `${payload.secretName} is not an https address.` };
  const b = payload.body;
  if (!b || b.type !== 'message' || !Array.isArray(b.attachments) || !b.attachments.every(a => a.contentType === 'application/vnd.microsoft.card.adaptive')) return { ok: false, detail: 'Only Adaptive Card messages are posted.' };
  const r = await http.request({ method: 'POST', url, body: b });
  if (r.status !== 200 && r.status !== 202) return { ok: false, detail: failure('Teams Workflows', r) };
  return { ok: true, detail: 'Posted to Teams.' };
}

async function outlook({ http, tokens, config }, payload) {
  if (!config.mailSender) return { ok: false, detail: 'MAIL_SENDER is not set on the relay.' };
  const to = (payload.to || []).map(a => String(a).toLowerCase());
  const domains = config.allowedMailDomains || [];
  const bad = to.filter(a => !domains.length || !domains.includes(a.split('@')[1]));
  if (!to.length || bad.length) return { ok: false, detail: domains.length ? `Recipients outside ${domains.join(', ')} are refused: ${bad.join(', ') || 'none given'}.` : 'ALLOWED_MAIL_DOMAINS is not set on the relay.' };
  const m = payload.body && payload.body.message;
  if (!m || typeof m.subject !== 'string' || !m.body) return { ok: false, detail: 'Malformed mail body.' };
  /* recipients are taken from the checked list, never from the body */
  const body = { message: { subject: m.subject.slice(0, 255), body: { contentType: m.body.contentType === 'Text' ? 'Text' : 'HTML', content: String(m.body.content || '').slice(0, 100000) },
    toRecipients: to.map(address => ({ emailAddress: { address } })) }, saveToSentItems: false };
  const token = await tokens.get('https://graph.microsoft.com');
  const r = await http.request({ method: 'POST', url: `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailSender)}/sendMail`, headers: { Authorization: 'Bearer ' + token }, body });
  if (r.status !== 202) return { ok: false, detail: failure('Microsoft Graph sendMail', r) };
  return { ok: true, detail: `Sent to ${to.join(', ')}.` };
}

module.exports = { teams, outlook, TEAMS_SECRET_RE };
