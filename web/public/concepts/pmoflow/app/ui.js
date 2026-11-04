/* Shared UI helpers. Every page renders user text through esc(). */
import { store } from './store.js';

export const BASE = (() => { const i = location.pathname.indexOf('/concepts/pmoflow'); return i >= 0 ? location.pathname.slice(0, i) + '/concepts/pmoflow' : ''; })();
export const E = () => window.PMOEngine;

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
export const fmt = s => s ? D(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
export const fmtTime = s => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
export const days = s => Math.round((D(s) - D(store.state.today)) / 86400000);
export const addDays = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export const link = p => BASE + p;
export function go(p) { history.pushState({}, '', link(p)); window.dispatchEvent(new Event('pmo:route')); window.scrollTo(0, 0); }

export function av(id) {
  const p = store.person(id); if (!p) return '';
  const ini = p.name.split(' ').map(x => x[0]).join('');
  return `<span class="av" style="background:${esc(p.color)}" title="${esc(p.name)}">${esc(ini)}</span>`;
}
export function personChip(id) { const p = store.person(id); return p ? `<span class="person">${av(id)}${esc(p.name)} <small>${esc(p.role)}</small></span>` : ''; }
export const pname = id => (store.person(id) || {}).name || '—';
export const badge = (text, cls) => `<span class="badge ${cls || 'b-idle'}">${esc(text)}</span>`;
export const chip = (html, cls) => `<span class="chip ${cls || ''}">${html}</span>`;
export const AVAIL = { live: { label: 'Live integration', short: 'Live', color: 'var(--live)' }, example: { label: 'Examples only', short: 'Examples', color: 'var(--example)' }, missing: { label: 'Missing', short: 'Missing', color: 'var(--missing)' }, pending: { label: 'Fix done, awaiting owner confirmation', short: 'Pending', color: 'var(--soon)' } };
export function dataDot(dataId) { const d = store.get('dataElement', dataId); const st = (window.PMOEngine && window.PMOEngine.effectiveAvail) ? window.PMOEngine.effectiveAvail(store.state.docs, dataId) : (d && d.avail); const a = AVAIL[st || 'missing'] || AVAIL.missing; return `<span class="dot" style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${a.color}" title="${esc(a.label)}"></span>`; }
export const LOCK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

export function toast(text) {
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}

export function formValues(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach(el => {
    if (el.type === 'checkbox') { (out[el.name] = out[el.name] || []); if (el.checked) out[el.name].push(el.value); }
    else if (el.multiple) out[el.name] = [...el.selectedOptions].map(o => o.value);
    else out[el.name] = el.value;
  });
  return out;
}

/* modal({title, body, actions:[{id,label,primary,danger}]}) -> Promise<{action, form, root}> ; 'cancel' on dismiss */
export function modal({ title, body, actions }) {
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'overlay';
    const acts = actions || [{ id: 'ok', label: 'OK', primary: true }];
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2><div class="mb">${body || ''}</div>
      <div class="mf"><button class="btn" data-act="cancel">Cancel</button>${acts.map(a => `<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-act="${esc(a.id)}">${esc(a.label)}</button>`).join('')}</div></div>`;
    const close = (action) => { const root = ov.querySelector('.mb'); const form = formValues(root); ov.remove(); resolve({ action, form, root }); };
    ov.addEventListener('click', e => { if (e.target === ov) close('cancel'); const b = e.target.closest('[data-act]'); if (b) close(b.dataset.act); });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') close('cancel'); });
    document.body.appendChild(ov);
    const first = ov.querySelector('input,select,textarea'); if (first) first.focus();
  });
}

/* Simulated step-up. In production this is a Microsoft Entra Conditional Access authentication-context challenge. */
export async function stepUp(actionLabel, attempt) {
  attempt = attempt || 1;
  const r = await modal({
    title: 'Verify it’s you',
    body: `${attempt > 1 ? '<div class="banner" style="margin:0">That code wasn’t 6 digits. Try again.</div>' : ''}<p style="margin:0">To <b>${esc(actionLabel)}</b>, confirm with multi-factor authentication.</p>
      <div class="field"><label>Authenticator code</label><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="Any 6 digits" maxlength="6" /></div>
      <span class="sim">Simulated step-up: in production this is Microsoft Entra MFA on a compliant device, checked by the in-tenant API.</span>`,
    actions: [{ id: 'verify', label: 'Verify', primary: true }],
  });
  if (r.action !== 'verify') return false;
  if (/^\d{6}$/.test(r.form.code || '')) return true;
  return attempt < 3 ? stepUp(actionLabel, attempt + 1) : false; /* re-prompt inline, max 3 tries */
}

export function drawer(title, html, bind) {
  document.querySelectorAll('.drawer').forEach(d => d.remove());
  const d = document.createElement('aside'); d.className = 'drawer';
  d.innerHTML = `<div class="dh"><b>${esc(title)}</b><button class="btn sm" data-close>Close</button></div><div class="db">${html}</div>`;
  d.querySelector('[data-close]').onclick = () => d.remove();
  document.body.appendChild(d);
  if (bind) bind(d.querySelector('.db'));
  return d;
}

/* Comments: render + bind. @First Last or @first mentions notify that person. */
export function commentsPanel(ref) {
  const list = store.list('comment', c => c.ref === ref).sort((a, b) => a.at.localeCompare(b.at));
  return `<div class="comments" data-comments="${esc(ref)}">
    ${list.map(c => `<div class="cmt"><div class="h">${av(c.author)} <b>${esc(pname(c.author))}</b> · ${esc(fmtTime(c.at))}</div>${esc(c.text).replace(/@([A-Za-z]+(?: [A-Za-z]+)?)/g, '<b style="color:var(--accent)">@$1</b>')}</div>`).join('') || '<div class="hint">No comments yet.</div>'}
    <div class="field" style="margin-top:8px"><textarea name="cmt" placeholder="Add a comment. Use @Name to notify someone." aria-label="Comment"></textarea></div>
    <div style="text-align:right;margin-top:6px"><button class="btn sm primary" data-post>Comment</button></div></div>`;
}
export function bindComments(root) {
  root.querySelectorAll('[data-comments]').forEach(box => {
    const btn = box.querySelector('[data-post]'); if (!btn) return;
    btn.onclick = async () => {
      const ta = box.querySelector('textarea'); const text = ta.value.trim(); if (!text) return;
      const ref = box.dataset.comments;
      const mentions = store.state.people.filter(p => text.toLowerCase().includes('@' + p.name.toLowerCase()) || text.toLowerCase().includes('@' + p.name.split(' ')[0].toLowerCase())).map(p => p.id);
      const id = store.newId('cmt');
      await store.save('comment', id, { id, ref, author: store.state.me, text, at: new Date().toISOString(), mentions }, 'Commented');
      await store.notify(mentions, `${pname(store.state.me)} mentioned you: “${text.slice(0, 80)}”`, ref);
      toast('Comment added');
    };
  });
}

/* History: placeholder rendered sync, filled async by bindHistory. */
export function historyPanel(ref) { return `<div data-history="${esc(ref || '')}"><div class="hint">Loading history…</div></div>`; }
export function bindHistory(root) {
  root.querySelectorAll('[data-history]').forEach(async box => {
    const evs = await store.events(box.dataset.history || null, 50);
    box.innerHTML = evs.length ? evs.map(e => `<div class="ev"><time>${esc(fmtTime(e.at))}</time><span>${av(e.actor)} <b>${esc(pname(e.actor))}</b> ${esc(e.summary || e.action)}</span></div>`).join('') : '<div class="hint">No changes recorded yet.</div>';
  });
}

/* Standard "Comments | History" card used on detail pages. */
export function activityCard(ref) {
  return `<div class="card"><h3>Comments</h3>${commentsPanel(ref)}</div><div class="card"><h3>History</h3>${historyPanel(ref)}</div>`;
}
export function bindActivity(root) { bindComments(root); bindHistory(root); }
