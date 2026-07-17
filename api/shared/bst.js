/* Byte Sized Training — trainee sessions (multi-user, unlike the owner-only
   emcee_boss cookie). HttpOnly cookie `bst_session` = bst.<email-b64url>.<exp>.<sig>,
   HMAC-signed with BST_SESSION_SECRET (falls back to EMCEE_SESSION_SECRET so the
   existing SWA app settings work day one). Uses the same zero-dep Table Storage
   helpers as the rest of the api (../shared/tables). */
const crypto = require('crypto');

function secret() { return process.env.BST_SESSION_SECRET || process.env.EMCEE_SESSION_SECRET || ''; }
function sign(payload) { return crypto.createHmac('sha256', secret()).update(payload).digest('base64url'); }

function makeSession(email, days) {
  const exp = Date.now() + (days || 30) * 86400000;
  const payload = 'bst.' + Buffer.from(String(email).toLowerCase()).toString('base64url') + '.' + exp;
  return payload + '.' + sign(payload);
}

function sessionEmail(cookieHeader) {
  if (!secret()) return null;
  const m = /(?:^|;\s*)bst_session=([^;]+)/.exec(cookieHeader || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 4 || parts[0] !== 'bst') return null;
  const exp = Number(parts[2]);
  if (!exp || exp < Date.now()) return null;
  const expect = sign(parts[0] + '.' + parts[1] + '.' + parts[2]);
  try { if (!crypto.timingSafeEqual(Buffer.from(parts[3]), Buffer.from(expect))) return null; }
  catch (e) { return null; }
  try { return Buffer.from(parts[1], 'base64url').toString('utf8'); } catch (e) { return null; }
}

function cookieHeaderFor(session) {
  return 'bst_session=' + session + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (30 * 86400);
}
function clearCookieHeader() {
  return 'bst_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

/* Seeded / allowed trainees. rennecog@gmail.com ships enabled so the producer
   can test end-to-end the moment this deploys. Add more via the
   BST_ALLOWED_EMAILS app setting (comma-separated) or BST_OPEN_SIGNUP=1. */
function allowedByEnv(email) {
  const seeded = (process.env.BST_ALLOWED_EMAILS || 'rennecog@gmail.com')
    .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (seeded.includes(String(email).toLowerCase())) return true;
  return process.env.BST_OPEN_SIGNUP === '1';
}

const APP_PATH = '/ByteSizedTraining/';

module.exports = { makeSession, sessionEmail, cookieHeaderFor, clearCookieHeader, allowedByEnv, APP_PATH };
