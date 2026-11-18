/* PMOFlow R10 stream S5: workspace admin. Route: /admin and /admin/<tab> (people | departments | history | calendar | security).
   R13 K4 #1: Departments tab (create, rename, remove, set approvers, assign people) over K1's POST /ws/:ws/departments and
   E.departments(docs); invites name a department; People shows and (Admin) changes each person's department.
   People and roles, invites, a hash-chained change history with CSV/JSON export, the holiday calendar the engine reads,
   and plain-language security settings. Server side: api/shared/pmoflow-routes-admin.js (/api/pmoflow/workspaces/:ws/admin...).
   Also exports authPrincipal / signInURL / signOutURL so the lead can show "Sign in with Microsoft" in the header menu. */
import { store } from '../store.js';
import { esc, link, av, fmtTime, toast, E, modal, stepUp } from '../ui.js';
import { refPath } from '../main.js';

const TABS = [['people', 'People'], ['departments', 'Departments'], ['history', 'History'], ['calendar', 'Calendar'], ['security', 'Security']];
const ROLE_INFO = {
  admin: { label: 'Admin', paid: true, what: 'Manages people, roles, the holiday calendar and settings. Also edits.' },
  editor: { label: 'Editor', paid: true, what: 'Maps processes, plans projects, records tests and runs launches.' },
  approver: { label: 'Approver', paid: false, what: 'Signs off their department’s part and grants data access. Free.' },
  viewer: { label: 'Viewer', paid: false, what: 'Sees everything and comments. Free.' },
};
const PAGE = 50;
const S = { ws: null, view: null, viewStale: true, audit: null, auditStale: true, busy: false, err: null, shown: PAGE,
  f: { person: '', item: '', from: '', to: '' }, pricing: undefined, auth: undefined, fileCheck: null };
store.subscribe(() => { S.viewStale = true; S.auditStale = true; });
const rerender = () => window.dispatchEvent(new Event('pmo:route'));

/* Load this stream's stylesheet once (the lead adds it to index.html; this keeps the page styled until then). */
(function css() {
  const href = '/concepts/pmoflow/app/css/admin.css';
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
})();

/* ------------------------------------------------------------ sign in with Microsoft (Azure Static Web Apps) */
let authP = null;
/* {name, email, provider} when signed in through /.auth/login/aad, else null. /.auth/me is absent locally (404): treated as signed out. */
export function authPrincipal() {
  if (!authP) authP = fetch('/.auth/me', { headers: { accept: 'application/json' }, credentials: 'same-origin' })
    .then(r => (r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : null))
    .then(j => {
      const p = j && j.clientPrincipal;
      if (!p || !p.userId) return null;
      const claim = t => ((p.claims || []).find(c => c.typ === t) || {}).val;
      return { name: claim('name') || p.userDetails || 'Signed-in user', email: p.userDetails || '', provider: p.identityProvider || 'aad' };
    })
    .catch(() => null);
  return authP;
}
const here = () => location.origin + location.pathname;
export const signInURL = () => '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(here());
export const signOutURL = () => '/.auth/logout?post_logout_redirect_uri=' + encodeURIComponent(here());

/* ------------------------------------------------------------ data */
const API = () => `/api/pmoflow/workspaces/${encodeURIComponent(store.state.ws)}/admin`;
async function api(method, path, body) {
  const r = await fetch(API() + path, { method, headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(Object.assign({ actor: store.state.me }, body)) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  return j;
}
const auditQS = (fmt, withFilters) => {
  const q = new URLSearchParams({ format: fmt });
  if (withFilters) Object.entries(S.f).forEach(([k, v]) => { if (v) q.set(k, v); });
  return '/audit?' + q;
};
async function refresh(tab) {
  if (!store.state.ws || store.state.offline) return;
  if (S.ws !== store.state.ws) { Object.assign(S, { ws: store.state.ws, view: null, audit: null, viewStale: true, auditStale: true }); }
  const jobs = [];
  if (S.viewStale) { S.viewStale = false; jobs.push(api('GET', '').then(v => { S.view = v; })); }
  if (tab === 'history' && S.auditStale) { S.auditStale = false; jobs.push(api('GET', auditQS('json', false)).then(a => { S.audit = a; })); }
  if (S.pricing === undefined) { S.pricing = null; jobs.push(fetch('/pmoflow/pricing.json').then(r => (r.ok ? r.json() : null)).then(p => { S.pricing = p; }).catch(() => { S.pricing = null; })); }
  if (S.auth === undefined) { S.auth = null; jobs.push(authPrincipal().then(a => { S.auth = a; })); }
  if (!jobs.length) return;
  try { await Promise.all(jobs); S.err = null; } catch (e) { S.err = e.message; }
  rerender();
}
const people = () => (S.view && S.view.people) || [];
const roleOf = id => (people().find(p => p.id === id) || {}).role || null;
const isAdmin = () => roleOf(store.state.me) === 'admin';
/* R13 #1: the one department list (E.departments via GET admin); Editors may add one, everything else is Admin only */
const depts = () => (S.view && S.view.departments) || [];
const canAddDept = () => ['admin', 'editor'].includes(roleOf(store.state.me));
async function deptOp(op) {
  /* the engine's pure editor decides first, so a refused change shows its sentence without a failed request */
  const eng = E();
  if (eng && typeof eng.departmentEdit === 'function') { const pre = eng.departmentEdit(store.state.docs, op); if (pre && !pre.ok) throw new Error(pre.error); }
  const r = await fetch(`/api/pmoflow/ws/${encodeURIComponent(store.state.ws)}/departments`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, actor: store.state.me }) });
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  S.viewStale = true;
  return j;
}
const adminNames = () => people().filter(p => p.role === 'admin').map(p => p.name);
const pname = id => (store.person(id) || {}).name || id || 'Someone';
const D = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
const longDay = s => D(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function adminOnlyNote(what) {
  if (!S.view || isAdmin()) return '';
  const a = adminNames();
  return `<div class="note adm-note" data-admin-only>You’re viewing as ${esc(pname(store.state.me))} (${esc((ROLE_INFO[roleOf(store.state.me)] || {}).label || 'no role')}). Only an Admin can ${esc(what)}${a.length ? `: ask ${esc(a.join(' or '))}` : ''}.</div>`;
}

/* ------------------------------------------------------------ header */
function signInHTML() {
  if (S.auth) return `<div class="adm-auth" data-auth="in"><span class="adm-ms" aria-hidden="true"></span><div><b data-auth-name>${esc(S.auth.name)}</b><div class="hint">Signed in with Microsoft</div></div><a class="btn sm" href="${esc(signOutURL())}">Sign out</a></div>`;
  return `<div class="adm-auth" data-auth="out"><a class="btn adm-msbtn" href="${esc(signInURL())}" data-signin><span class="adm-ms" aria-hidden="true"></span>Sign in with Microsoft</a><div class="hint">Optional. In the demo it only labels your session.</div></div>`;
}

/* ------------------------------------------------------------ people */
/* R11 §3: the demo workspace runs on the Business plan; its name, price and any editor limit come from pricing.json */
const DEMO_PLAN = 'business';
function seatsHTML() {
  const s = S.view.seats;
  const plans = (S.pricing && Array.isArray(S.pricing.plans)) ? S.pricing.plans : [];
  const plan = plans.find(p => p.id === DEMO_PLAN) || null;
  const cost = plan && plan.perEditorMonthly ? s.paid * plan.perEditorMonthly * 12 : null;
  const limit = plan && plan.maxEditors ? ` · ${esc(plan.name)} allows up to ${plan.maxEditors}` : '';
  return `<div class="card adm-seats" data-seats data-plan="${esc(plan ? plan.id : DEMO_PLAN)}"><h3>Seats</h3>
    <div class="adm-kpis">
      <div class="kc"><span>Paid seats</span><b data-seat-paid>${s.paid}</b><small>${plural(s.admin, 'admin')} · ${plural(s.editor, 'editor')}${limit}</small></div>
      <div class="kc"><span>Free seats</span><b data-seat-free>${s.free}</b><small>${plural(s.approver, 'approver')} · ${plural(s.viewer, 'viewer')}</small></div>
      <div class="kc"><span>Plan</span><b data-plan-name>${plan ? esc(plan.name) : 'Business'}</b><small>${cost != null ? `${money(cost)} a year (${s.paid} × $${plan.perEditorMonthly} per paid seat a month, ${esc(S.pricing.billing || 'billed annually')})` : 'Approvers and viewers are free'}</small></div>
    </div>
    <div class="hint">Admins and editors are paid seats. Approvers and viewers are always free. Invited people count once they have a role. <a href="/pmoflow/pricing" style="color:var(--accent)">See pricing</a></div></div>`;
}
function peopleHTML() {
  const admin = isAdmin();
  const rows = people().map(p => {
    const sel = `<select data-role="${esc(p.id)}" aria-label="Role for ${esc(p.name)}" ${admin ? '' : 'disabled'}>${Object.entries(ROLE_INFO).map(([k, r]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${r.label}</option>`).join('')}</select>`;
    const dsel = `<select data-assign="${esc(p.id)}" aria-label="Department for ${esc(p.name)}" ${admin ? '' : 'disabled'}><option value="">No department</option>${depts().map(d => `<option value="${esc(d.id)}" ${d.name === p.department ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`;
    return `<tr data-person-row="${esc(p.id)}"><td><span class="adm-pp">${av(p.id)}<span><b>${esc(p.name)}</b><span class="hint adm-title">${esc(p.title || '')}</span></span></span></td>
      <td>${sel}${(() => { const pr = rolePendings().find(x => x.personId === p.id); return pr ? `<div class="hint" data-role-pending-hint="${esc(p.id)}">Waiting: ${esc(pr.text)}</div>` : ''; })()}</td><td>${dsel}${(() => { const pp = pendings().find(x => x.kind === 'assign' && x.op && x.op.personId === p.id); return pp ? `<div class="hint" data-person-pending="${esc(p.id)}">Waiting: ${esc(pp.text)}</div>` : ''; })()}</td><td>${ROLE_INFO[p.role] && ROLE_INFO[p.role].paid ? '<span class="badge b-prog adm-nw">Paid seat</span>' : '<span class="badge b-done adm-nw">Free</span>'}</td></tr>`;
  }).join('');
  const inv = (S.view.settings.invites || []);
  return `${seatsHTML()}
    <div class="card"><h3>People and roles <span class="n">${people().length}</span></h3>
      ${adminOnlyNote('change roles or invite people')}
      <div class="tbl-wrap"><table class="adm-table"><thead><tr><th>Person</th><th>Role</th><th>Department</th><th>Seat</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="adm-legend">${Object.values(ROLE_INFO).map(r => `<div><b>${r.label}</b> <span class="hint">${esc(r.what)}</span></div>`).join('')}</div>
    </div>
    ${rolePendingHTML()}
    ${sponsorsHTML()}
    <div class="card" data-invites><h3>Invite someone <span class="n">${inv.length} pending</span></h3>
      <form class="adm-invite" data-invite-form>
        <div class="field"><label for="adm-email">Work email</label><input id="adm-email" name="email" type="email" autocomplete="off" placeholder="name@northwind.example" required ${admin ? '' : 'disabled'} /></div>
        <div class="field"><label for="adm-irole">Role</label><select id="adm-irole" name="role" ${admin ? '' : 'disabled'}>${Object.entries(ROLE_INFO).map(([k, r]) => `<option value="${k}" ${k === 'editor' ? 'selected' : ''}>${r.label}${r.paid ? '' : ' (free)'}</option>`).join('')}</select></div>
        <div class="field"><label for="adm-idept">Department</label><select id="adm-idept" name="departmentId" ${admin ? '' : 'disabled'}><option value="">None yet</option>${depts().map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></div>
        <button class="btn primary" type="submit" ${admin ? '' : 'disabled'}>Invite</button>
      </form>
      <div class="hint">The invite is saved here. No email is sent from the demo.</div>
      ${inv.length ? `<div class="adm-list">${inv.map(i => `<div class="row" data-invite="${esc(i.id)}"><div><div class="t">${esc(i.email)}</div><div class="s">${esc((ROLE_INFO[i.role] || {}).label || i.role)}${i.department ? ` · <span data-invite-dept>${esc(i.department)}</span>` : ''} · invited by ${esc(pname(i.by))} · ${esc(fmtTime(i.at))}</div></div><div class="r"><button class="btn sm danger" data-uninvite="${esc(i.id)}" ${admin ? '' : 'disabled'}>Remove</button></div></div>`).join('')}</div>` : ''}
    </div>`;
}

/* R14: the server writes each sentence from the actual change; a person's own text is shown apart, as their note.
   Entries from before R14 kept the person's own text as the sentence: they say so. */
function summaryCell(e) {
  const sm = String(e.summary || e.action || '');
  const note = e.note != null ? String(e.note) : null;
  const text = note != null ? sm.slice(0, Math.max(0, sm.length - note.length - 11)) : sm;
  if (e.refused) return `<span class="adm-refused" data-entry-refused>${esc(text)}</span><div class="hint">The server refused this, so nothing changed.</div>`;
  return `${esc(text)}${note != null ? `<div class="hint" data-entry-note>Their note: “${esc(note)}”</div>` : ''}${e.written === 'client' ? '<div class="hint" data-entry-client>Older entry: worded by the person, not written from the change.</div>' : ''}`;
}

/* ------------------------------------------------------------ project sponsors (R14 L4 #2) */
/* An Admin who is not the project's manager sets its sponsor. The project manager is never the sponsor and never picks
   one; nobody appoints themselves. Without a named sponsor, the default approver stands in (shown as "default"). */
function sponsorsHTML() {
  const rows = (S.view.projects || []).filter(p => p.status !== 'archived');
  if (!rows.length) return '';
  const me = store.state.me, admin = isAdmin();
  const body = rows.map(p => {
    const mineAsPm = me === p.owner;
    const can = (admin || (p.sponsor && p.sponsor === me)) && !mineAsPm;
    const opts = people().filter(x => x.id !== p.owner && (x.id !== me || x.id === p.sponsor));
    const why = mineAsPm ? 'You manage this project, so another Admin sets its sponsor.' : !can ? `Only an Admin${adminNames().length ? ` (${adminNames().filter(n => n !== p.ownerName).join(', ')})` : ''} can change it.` : '';
    const sel = `<select data-sponsor="${esc(p.id)}" aria-label="Sponsor of ${esc(p.name)}" ${can ? '' : 'disabled'}>
      <option value="">${p.sponsor ? 'No named sponsor (use the default)' : `Default: ${esc(p.effectiveName || 'nobody yet')}`}</option>
      ${opts.map(x => `<option value="${esc(x.id)}" ${x.id === p.sponsor ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
    return `<div class="adm-spon" data-sponsor-row="${esc(p.id)}"><div><b>${esc(p.name)}</b><div class="hint">Project manager: ${esc(p.ownerName || 'nobody')}</div></div>
      <div><label class="adm-spl" for="adm-sp-${esc(p.id)}">Sponsor</label>${sel.replace('<select ', `<select id="adm-sp-${esc(p.id)}" `)}${why ? `<div class="hint" data-sponsor-why>${esc(why)}</div>` : ''}</div>
      <div><span class="adm-spl">Approves now</span><div data-sponsor-now>${p.sponsor ? esc(p.sponsorName) : p.effectiveName ? `${esc(p.effectiveName)} <span class="hint">(default)</span>` : '<span class="hint">Nobody yet</span>'}</div></div></div>`;
  }).join('');
  return `<div class="card" data-sponsors><h3>Project sponsors</h3>
    <div class="hint adm-sphint">The sponsor approves plan changes that move the deadline or the budget. An Admin sets them; a project’s manager can’t be its sponsor or choose one.</div>
    <div class="adm-spons">${body}</div></div>`;
}

/* ------------------------------------------------------------ departments (R13 #1) */
function deptCard(d) {
  const admin = isAdmin();
  const n = d.people.length;
  const names = d.approverNames || [];
  const who = names.length ? `Approves: <b data-dept-approvers-list>${esc(names.join(', '))}</b>`
    : `<span data-dept-approvers-list>No named approver: anyone in ${esc(d.name)} can approve its part.</span>`;
  const removeWhy = n ? `Move the ${plural(n, 'person').replace(/persons$/, 'people')} in ${d.name} to another department first.` : '';
  const ppl = people().slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="card adm-dept" data-dept="${esc(d.id)}" data-dept-name="${esc(d.name)}">
      <div class="adm-dhead"><h3>${esc(d.name)} <span class="n">${plural(n, 'person').replace(/persons$/, 'people')}</span></h3>
        <div class="adm-dacts"><button class="btn sm" data-dept-rename="${esc(d.id)}" ${admin ? '' : 'disabled'}>Rename</button>
        <button class="btn sm danger" data-dept-remove="${esc(d.id)}" ${admin && !n ? '' : 'disabled'} ${removeWhy ? `title="${esc(removeWhy)}"` : ''}>Remove</button></div></div>
      <div class="adm-dwho">${who}</div>
      ${pendings().filter(p => p.departmentId === d.id || (p.kind === 'assign' && d.people.some(x => x.id === p.op.personId))).map(p => `<div class="hint adm-dpend" data-dept-pending="${esc(p.id)}">Waiting for a second Admin: ${esc(p.text)}</div>`).join('')}
      ${n ? `<div class="adm-dppl">${d.people.map(p => `<span class="adm-chip">${av(p.id)}${esc(p.name)}</span>`).join('')}</div>` : `<div class="hint">Nobody is in ${esc(d.name)} yet. Assign people on the People tab or below.</div>`}
      ${n && admin ? `<div class="hint adm-dwhy">${esc(removeWhy)}</div>` : ''}
      <details class="adm-dedit" data-dept-approvers="${esc(d.id)}"><summary>Choose who approves for ${esc(d.name)}</summary>
        <div class="hint">Leave everyone unticked to let anyone in the department approve. The project manager and anyone who works on or tests a part never approve it.</div>
        <div class="adm-dpick">${ppl.map(p => `<label class="adm-pick"><input type="checkbox" value="${esc(p.id)}" ${d.approvers.includes(p.id) ? 'checked' : ''} ${admin ? '' : 'disabled'} /><span>${esc(p.name)}${p.department && p.department !== d.name ? ` <small class="hint">${esc(p.department)}</small>` : ''}</span></label>`).join('')}</div>
        <button class="btn sm primary" data-dept-approvers-save="${esc(d.id)}" ${admin ? '' : 'disabled'}>Save approvers</button></details>
      <form class="adm-dassign" data-dept-assign-form="${esc(d.id)}">
        <select name="personId" aria-label="Add a person to ${esc(d.name)}" ${admin ? '' : 'disabled'}><option value="">Add a person to ${esc(d.name)}…</option>${ppl.filter(p => p.department !== d.name).map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.department ? ` (now ${esc(p.department)})` : ''}</option>`).join('')}</select>
        <button class="btn sm" type="submit" ${admin ? '' : 'disabled'}>Add</button></form>
    </div>`;
}
/* R15 (Jordan): a role change waits for a second Admin, who confirms it with the extra sign-in check; nothing changes until
   then. The person demoted from Admin may agree to it themselves; nobody confirms their own promotion. */
const rolePendings = () => (S.view && S.view.pendingRoles) || [];
function rolePendingHTML() {
  const list = rolePendings();
  if (!list.length) return '';
  const me = store.state.me, admin = isAdmin();
  return `<div class="card adm-pend" data-pending-roles><h3>Role changes waiting for a second Admin <span class="n">${list.length}</span></h3>
    <p class="hint">A role decides what someone can change, approve or set up, so one Admin proposes it and another confirms it with the extra sign-in check. Until then nothing changes.</p>
    ${list.map(p => {
      const mine = p.by === me, can = (p.canConfirm || []).includes(me);
      const why = !admin ? 'Only an Admin can confirm.' : mine ? 'You proposed it, so another Admin confirms it.' : !can ? 'It changes your own role, so another Admin confirms it.' : '';
      const names = (p.canConfirm || []).filter(id => id !== me).map(pname);
      return `<div class="adm-pitem" data-role-pending="${esc(p.id)}"><div><b>${esc(p.text)}</b><div class="hint">Proposed by ${esc(p.byName || pname(p.by))} · ${esc(fmtTime(p.at))}${mine && names.length ? ` · ${esc(names.join(' or '))} can confirm` : ''}</div>${why ? `<div class="hint" data-role-pending-why>${esc(why)}</div>` : ''}</div>
        <div class="adm-pacts"><button class="btn sm primary" data-role-confirm="${esc(p.id)}" ${admin && can ? '' : 'disabled'}>Confirm</button>
        <button class="btn sm" data-role-cancel="${esc(p.id)}" ${admin ? '' : 'disabled'}>${mine ? 'Withdraw' : 'Turn down'}</button></div></div>`;
    }).join('')}</div>`;
}
/* R14 (Jordan): department moves and approver changes wait for a second Admin (step-up); nothing changes until then */
const pendings = () => (S.view && S.view.pendingDepartments) || [];
function pendingHTML() {
  const list = pendings();
  if (!list.length) return '';
  const me = store.state.me, admin = isAdmin();
  return `<div class="card adm-pend" data-pending-depts><h3>Waiting for a second Admin <span class="n">${list.length}</span></h3>
    <p class="hint">Moving people between departments and changing a department’s existing approvers changes who can sign off, so one Admin proposes it and another confirms it with the extra sign-in check. Until then nothing changes.</p>
    ${list.map(p => {
      const mine = p.by === me, affected = (p.affected || []).includes(me);
      const why = !admin ? 'Only an Admin can confirm.' : mine ? 'You proposed it, so another Admin confirms it.' : affected ? 'It moves you or changes your approval rights, so another Admin confirms it.' : '';
      return `<div class="adm-pitem" data-pending="${esc(p.id)}"><div><b>${esc(p.text)}</b><div class="hint">Proposed by ${esc(p.byName || pname(p.by))} · ${esc(fmtTime(p.at))}${p.note ? ` · <span data-pending-note>${esc(p.note)}</span>` : ''}</div>${why ? `<div class="hint" data-pending-why>${esc(why)}</div>` : ''}</div>
        <div class="adm-pacts"><button class="btn sm primary" data-pend-confirm="${esc(p.id)}" ${admin && !mine && !affected ? '' : 'disabled'}>Confirm</button>
        <button class="btn sm" data-pend-cancel="${esc(p.id)}" ${admin ? '' : 'disabled'}>${mine ? 'Withdraw' : 'Turn down'}</button></div></div>`;
    }).join('')}</div>`;
}
function departmentsHTML() {
  const list = depts();
  const note = isAdmin() ? '' : canAddDept()
    ? `<div class="note adm-note" data-admin-only>You’re viewing as ${esc(pname(store.state.me))} (Editor). You can add a department; only an Admin can rename, remove, choose approvers or move people${adminNames().length ? `: ask ${esc(adminNames().join(' or '))}` : ''}.</div>`
    : adminOnlyNote('change departments');
  return `<div class="card" data-dept-add-card><h3>Departments <span class="n" data-dept-count>${list.length}</span></h3>
      <p class="hint adm-dintro">Your own list of departments, for example Purchasing, Credit, Sales or Operations. Each one approves its part of a process change. The approver panel and invites use this list.</p>
      ${note}
      <form class="adm-dform" data-dept-add-form>
        <div class="field"><label for="adm-dn">New department</label><input id="adm-dn" name="name" maxlength="60" placeholder="e.g. Credit" autocomplete="off" ${canAddDept() ? '' : 'disabled'} /></div>
        <button class="btn primary" type="submit" ${canAddDept() ? '' : 'disabled'}>Add department</button>
      </form></div>
    ${pendingHTML()}
    ${list.length ? list.map(deptCard).join('') : '<div class="card"><div class="empty">No departments yet. Add your first one above.</div></div>'}`;
}

/* ------------------------------------------------------------ history (audit log) */
function filtered() {
  const a = (S.audit && S.audit.entries) || [];
  const it = S.f.item.toLowerCase();
  return a.filter(e => (!S.f.person || e.actor === S.f.person) &&
    (!it || String(e.ref || '').toLowerCase().includes(it) || String(e.summary || '').toLowerCase().includes(it)) &&
    (!S.f.from || String(e.at).slice(0, 10) >= S.f.from) && (!S.f.to || String(e.at).slice(0, 10) <= S.f.to)).slice().reverse();
}
const ITEM_LBL = { process: 'Process', project: 'Project', workItem: 'Task', dataElement: 'Information', grant: 'Data access', approval: 'Sign-off', release: 'Launch',
  testCase: 'Test', testRun: 'Test run', comment: 'Comment', notification: 'Notification', risk: 'Risk', profile: 'Data check', person: 'Person', calendar: 'Calendar', workspace: 'Workspace', step: 'Step' };
function itemCell(ref) {
  const [type, id] = String(ref || '').split(':');
  const lbl = ITEM_LBL[type] || type || '—';
  let path = null; try { path = type && id ? refPath(type, id) : null; } catch (e) { path = null; }
  return path ? `<a href="${esc(link(path))}" data-link class="adm-item">${esc(lbl)} ›</a>` : `<span class="hint">${esc(lbl)}</span>`;
}
function historyHTML() {
  if (!S.audit) return '<div class="card"><div class="empty">Loading the change history…</div></div>';
  const v = S.audit.verify;
  const list = filtered();
  const actors = [...new Set((S.audit.entries || []).map(e => e.actor))].map(id => ({ id, name: pname(id) })).sort((a, b) => a.name.localeCompare(b.name));
  const anyF = Object.values(S.f).some(Boolean);
  const fc = S.fileCheck;
  return `<div class="card adm-verify ${v.ok ? 'ok' : 'bad'}" data-verify="${v.ok ? 'ok' : 'broken'}">
      <div class="adm-vicon" aria-hidden="true">${v.ok ? '✓' : '✕'}</div>
      <div><b>${v.ok ? 'History is intact' : 'History has been changed'}</b>
        <div class="s">${esc(v.summary)} Each change gets a SHA-256 fingerprint of itself and the change before it. Every export also records a checkpoint, so a later edit to history up to that point shows up here.</div></div>
    </div>
    <div class="card"><h3>Every change <span class="n" data-count>${list.length}${anyF ? ` of ${S.audit.total}` : ''}</span></h3>
      <div class="adm-filters" data-filters>
        <div class="field"><label for="adm-fp">Person</label><select id="adm-fp" data-f="person"><option value="">Everyone</option>${actors.map(a => `<option value="${esc(a.id)}" ${S.f.person === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="adm-fi">Item</label><input id="adm-fi" data-f="item" type="search" placeholder="e.g. Vendor onboarding" value="${esc(S.f.item)}" /></div>
        <div class="field"><label for="adm-ff">From</label><input id="adm-ff" data-f="from" type="date" value="${esc(S.f.from)}" /></div>
        <div class="field"><label for="adm-ft">To</label><input id="adm-ft" data-f="to" type="date" value="${esc(S.f.to)}" /></div>
        <div class="adm-factions">${anyF ? '<button class="btn sm adm-quiet" data-fclear>Clear</button>' : ''}<button class="btn sm" data-export="csv">Export CSV</button><button class="btn sm" data-export="json">Export JSON</button></div>
      </div>
      ${list.length ? `<div class="tbl-wrap"><table class="adm-table adm-log"><thead><tr><th>When</th><th>Who</th><th>What changed</th><th>Item</th></tr></thead><tbody>
        ${list.slice(0, S.shown).map(e => `<tr data-entry="${e.seq}"><td class="adm-when">${esc(fmtTime(e.at))}</td><td class="adm-who">${av(e.actor)} ${esc(e.actorName || pname(e.actor))}</td><td>${summaryCell(e)}</td><td>${itemCell(e.ref)}</td></tr>`).join('')}
      </tbody></table></div>${list.length > S.shown ? `<div style="text-align:center;margin-top:8px"><button class="btn sm" data-more>Show ${Math.min(PAGE, list.length - S.shown)} more</button></div>` : ''}`
      : `<div class="empty">${anyF ? 'No changes match these filters.' : 'No changes recorded yet.'}</div>`}
      <div class="hint" style="margin-top:8px" data-audit-claim>Exports use the filters above and carry each entry’s fingerprints. Each fingerprint covers who made the change (their name too), when, and what. An unfiltered export also carries a signed head (the entry count and last fingerprint, signed by the PMOFlow service; in a CSV it is the last row), so checking it catches an edited entry or name, entries removed from the end, and fingerprints recomputed after export. Fingerprints are worked out from the stored history when you view or export it, not as each change is saved. The demo keeps the latest ${S.audit.limit || 500} changes.</div>
      <div class="hint" data-keysource="${esc(S.audit.keySource || '')}">Signed with the ${esc(S.audit.keySource || 'development key')}${S.audit.keySource === 'production key' ? '.' : ' (this copy runs without the production key; the live service signs with its production key).'}</div>
      <details class="adm-check" ${fc ? 'open' : ''}><summary>Check a saved export (CSV or JSON)</summary>
        <div class="adm-checkrow"><input type="file" accept="text/csv,.csv,application/json,.json" data-checkfile aria-label="Saved CSV or JSON export" />
        ${fc ? `<span class="${fc.ok ? 'pass' : 'fail'}" data-filecheck="${fc.ok ? 'ok' : 'broken'}">${fc.ok ? '✓ ' : '✕ '}${esc(fc.summary)}${fc.ok && fc.keyNote ? ` <span data-filecheck-key>${esc(fc.keyNote)}</span>` : ''}</span>` : ''}</div>
        <div class="hint">Only an unfiltered export can be checked on its own: a filtered one leaves gaps in the chain.</div></details>
    </div>`;
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------ calendar */
function calendarHTML() {
  const eng = E();
  const admin = isAdmin();
  if (!eng || typeof eng.holidays !== 'function') return '<div class="card"><div class="empty">The holiday calendar isn’t available right now.</div></div>';
  const list = eng.holidays(store.state.docs, { today: store.state.today });
  const years = [...new Set(list.map(h => h.date.slice(0, 4)))];
  const today = store.state.today;
  const row = h => {
    const kind = h.worked ? 'worked' : h.source === 'custom' ? 'custom' : 'federal';
    const chip = kind === 'custom' ? '<span class="badge b-prog">Your company</span>' : kind === 'worked' ? '<span class="badge b-soon">Working day</span>' : '<span class="badge b-idle">US federal</span>';
    const act = kind === 'custom' ? `<button class="btn sm danger" data-hremove="${esc(h.date)}" ${admin ? '' : 'disabled'}>Remove</button>`
      : kind === 'worked' ? `<button class="btn sm" data-hrestore="${esc(h.date)}" ${admin ? '' : 'disabled'}>Make it a day off</button>`
      : `<button class="btn sm adm-quiet" data-hwork="${esc(h.date)}" ${admin ? '' : 'disabled'} title="Your company works this day">We work this day</button>`;
    return `<div class="row adm-hrow ${h.date < today ? 'past' : ''} ${kind}" data-holiday="${esc(h.date)}" data-kind="${kind}"><div><div class="t">${esc(h.name)}</div><div class="s">${esc(longDay(h.date))}</div></div><div class="r">${chip} ${act}</div></div>`;
  };
  return `<div class="card"><h3>Add a company holiday</h3>
      ${adminOnlyNote('change the holiday calendar')}
      <form class="adm-hform" data-holiday-form>
        <div class="field"><label for="adm-hd">Date</label><input id="adm-hd" name="date" type="date" required ${admin ? '' : 'disabled'} /></div>
        <div class="field"><label for="adm-hn">Name</label><input id="adm-hn" name="name" maxlength="60" placeholder="e.g. Year-end shutdown" ${admin ? '' : 'disabled'} /></div>
        <button class="btn primary" type="submit" ${admin ? '' : 'disabled'}>Add day off</button>
      </form>
      <div class="hint">Due dates, plans and launch windows skip weekends and every day off below. Launches can’t be set on a day off.</div></div>
    ${years.map(y => `<div class="card" data-year="${y}"><h3>${y} <span class="n">${list.filter(h => h.date.startsWith(y) && !h.worked).length} days off</span></h3>${list.filter(h => h.date.startsWith(y)).map(row).join('')}</div>`).join('')}`;
}

/* ------------------------------------------------------------ security */
function securityHTML() {
  const li = a => a.map(([t, d]) => `<li><b>${esc(t)}.</b> ${esc(d)}</li>`).join('');
  return `<div class="adm-sec">
    <div class="card" data-sec="now"><h3><span class="adm-dot now"></span>On now, in this workspace</h3><ul class="adm-ul">${li([
      ['Roles', 'Admins manage people, the calendar and settings. Editors make changes. Approvers and viewers are free.'],
      ['Role changes', 'With two or more Admins, changing anyone’s role is proposed by one Admin and confirmed by another with the extra sign-in check. Nobody confirms their own promotion; an Admin being demoted may agree to it. In a workspace with one Admin, a role change applies at once and History says so. The workspace always keeps at least one Admin.'],
      ['Process and project owners', 'Only a process’s owner and its resources edit it. Only the project manager changes the launch plan.'],
      ['Passing tests', 'You can pass only tests assigned to you or to no one. A test linked to an open problem can’t pass until the problem is fixed.'],
      ['Separate approvers', 'Nobody approves a team’s part if they recorded any test result for it or own steps in it. The project manager and the launch owner don’t approve teams’ parts.'],
      ['Two people for launch overrides', 'Launching outside the launch window, or with launch-day tasks still open, needs the project manager and a sponsor or approver, each with the extra sign-in check.'],
      ['Department changes', 'Naming the first approver of a department that has none takes one Admin. With two or more Admins, moving someone between departments or changing a department’s existing approvers is proposed by one Admin and confirmed by another with the extra sign-in check; the person it moves can’t confirm it. In a workspace with one Admin, those changes apply at once and History says so. Each membership and approver keeps the date it started.'],
      ['Recent moves', 'Someone moved into a department, or made an approver, after its testing or approval started can’t pass its tests or approve it.'],
      ['No Admin exemption', 'Admins follow every rule above. The server checks each one, not just the screen.'],
      ['Extra sign-in check', 'Approvals, going live and data-access grants ask for a second check. In the demo any 6 digits work.'],
      ['Time-boxed data access', 'Access to real data is approved by its owner, expires, and closes automatically at launch.'],
      ['Statistics only', 'Data checks keep counts and patterns, never the values themselves.'],
      ['Every change recorded', 'History lists every change and who made it, including changes that came from Jira or Azure DevOps under that person’s identity there. It exports as CSV or JSON; both are signed and can be checked here, so an edited entry or name, entries cut from the end, or recomputed fingerprints fail the check.'],
      ['No third-party scripts', 'No analytics or tag managers run in the app.'],
    ])}</ul></div>
    <div class="card" data-sec="business"><h3><span class="adm-dot biz"></span>With the Business plan, in your own Microsoft tenant</h3><ul class="adm-ul">${li([
      ['Sign in with Microsoft for everyone', 'Your people use their Entra ID accounts. Your Conditional Access and session rules apply.'],
      ['Your data and keys stay in your tenant', 'Process and project records live in your Azure subscription. Jira, Azure DevOps and GitHub keys sit in your Key Vault; PMOFlow never stores them.'],
      ['Real extra sign-in checks', 'The extra check becomes your Entra Conditional Access authentication context.'],
      ['Logs in your own Sentinel', 'Activity goes to your Log Analytics, with detection rules included.'],
      ['Kill switch', 'Turning off the PMOFlow app in Entra stops everything.'],
    ])}</ul></div>
    <div class="card" data-sec="planned"><h3><span class="adm-dot plan"></span>Planned, not done yet</h3><ul class="adm-ul">${li([
      ['Independent attestation', 'SOC 2 Type II or Microsoft 365 Certification. Not obtained yet.'],
      ['Penetration test', 'Annual, by a third party.'],
      ['SCIM user provisioning', 'Enterprise plan.'],
      ['Signed releases', 'Customer-approved releases with a public transparency log, for regulated buyers.'],
    ])}</ul></div>
    <div class="card"><div class="adm-seclink"><div><b>Security and data handling</b><div class="hint">How it works in your tenant, what exists today, and what is on the roadmap.</div></div><a class="btn primary" href="/pmoflow/security">Read the security page ›</a></div></div>
  </div>`;
}

/* ------------------------------------------------------------ page */
export function render(params) {
  const tab = TABS.some(t => t[0] === params.tab) ? params.tab : 'people';
  let body;
  if (S.err && !S.view) body = `<div class="card"><div class="empty">Couldn’t load admin settings (${esc(S.err)}). <button class="btn sm" data-retry>Try again</button></div></div>`;
  else if (!S.view || S.ws !== store.state.ws) body = '<div class="card"><div class="empty">Loading…</div></div>';
  else body = tab === 'people' ? peopleHTML() : tab === 'departments' ? departmentsHTML() : tab === 'history' ? historyHTML() : tab === 'calendar' ? calendarHTML() : securityHTML();
  return `<div class="hdr adm-hdr"><div><div class="crumbs">Workspace</div><h1>Admin</h1>
      <p>People and roles, departments, the record of every change, the holiday calendar, and security settings.</p></div>
      <div class="hdr-side">${S.auth === undefined ? '' : signInHTML()}</div></div>
    <nav class="tabs adm-tabs" aria-label="Admin sections">${TABS.map(([k, l]) => `<a href="${link('/admin/' + k)}" data-link class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <div class="adm-body" data-tab="${tab}">${body}</div>`;
}

export function bind(root, params) {
  const tab = TABS.some(t => t[0] === params.tab) ? params.tab : 'people';
  if (S.lastTab !== tab) { S.lastTab = tab; if (tab === 'history') S.auditStale = true; }
  refresh(tab);
  const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener(ev, e => fn(el, e)));
  const act = async (fn, ok) => {
    if (S.busy) return; S.busy = true;
    try { await fn(); if (ok) toast(typeof ok === 'function' ? ok() : ok); await store.load(); }     /* store.load refreshes docs (calendar, settings) and re-renders */
    catch (e) { toast(e.message); S.viewStale = true; rerender(); }
    finally { S.busy = false; }
  };
  on('[data-retry]', 'click', () => { S.err = null; S.viewStale = true; refresh(tab); });

  /* people */
  /* R15 (Jordan): with a second Admin, a role change is sent to them to confirm; in a one-Admin workspace it applies at once */
  on('[data-role]', 'change', el => {
    let res = null;
    const who = pname(el.dataset.role), label = (ROLE_INFO[el.value] || {}).label || el.value;
    act(async () => { res = await api('PUT', '/roles/' + encodeURIComponent(el.dataset.role), { role: el.value }); S.view = res; S.auditStale = true; },
      () => (res && res.pendingRole ? `Sent to a second Admin to confirm: ${res.pendingRole.text}` : `${who} is now ${label}`));
  });
  on('[data-role-confirm]', 'click', async el => {
    const id = el.dataset.roleConfirm, p = rolePendings().find(x => x.id === id);
    if (!(await stepUp('confirm this role change'))) { toast('Not confirmed: the extra sign-in check was not completed.'); return; }
    act(async () => { S.view = await api('POST', '/roles/pending/' + encodeURIComponent(id) + '/confirm', { stepUp: { method: 'simulated-mfa', at: new Date().toISOString() } }); S.auditStale = true; },
      `Confirmed: ${p ? p.text : 'the role change'}`);
  });
  on('[data-role-cancel]', 'click', el => {
    const id = el.dataset.roleCancel, p = rolePendings().find(x => x.id === id);
    act(async () => { S.view = await api('POST', '/roles/pending/' + encodeURIComponent(id) + '/cancel', {}); S.auditStale = true; },
      p && p.by === store.state.me ? 'Proposal withdrawn' : 'Proposal turned down');
  });
  on('[data-invite-form]', 'submit', (el, e) => {
    e.preventDefault();
    const email = el.querySelector('[name=email]').value.trim(), role = el.querySelector('[name=role]').value;
    const departmentId = (el.querySelector('[name=departmentId]') || {}).value || null;
    act(async () => { S.view = await api('POST', '/invites', { email, role, departmentId }); }, `Invited ${email}`);
  });
  on('[data-sponsor]', 'change', el => {
    const pid = el.dataset.sponsor, nm = ((S.view.projects || []).find(p => p.id === pid) || {}).name || 'the project';
    act(async () => { await api('PUT', '/sponsor/' + encodeURIComponent(pid), { sponsor: el.value || null }); S.viewStale = true; S.auditStale = true; },
      el.value ? `${pname(el.value)} is now the sponsor of ${nm}` : `${nm} uses its default sponsor`);
  });
  on('[data-uninvite]', 'click', el => act(async () => { S.view = await api('DELETE', '/invites/' + encodeURIComponent(el.dataset.uninvite), {}); }, 'Invite removed'));

  /* departments (R13 #1) */
  const dname = id => (depts().find(d => d.id === id) || {}).name || 'the department';
  /* R14: a change either waits for a second Admin, or (first approver / one-Admin workspace) applies at once for new work */
  let lastDept = null;
  const dop = op => async () => { lastDept = await deptOp(op); };
  const said = (wait, now) => () => (lastDept && lastDept.pending ? `Sent to a second Admin to confirm: ${wait}` : `${now} (applies to new work only)`);
  on('[data-assign]', 'change', el => act(dop({ kind: 'assign', personId: el.dataset.assign, id: el.value || null }),
    el.value ? said(`${pname(el.dataset.assign)} to ${dname(el.value)}`, `${pname(el.dataset.assign)} is now in ${dname(el.value)}`)
      : said(`${pname(el.dataset.assign)} out of their department`, `${pname(el.dataset.assign)} has no department`)));
  on('[data-dept-add-form]', 'submit', (el, e) => {
    e.preventDefault();
    const name = el.querySelector('[name=name]').value.trim();
    if (!name) { toast('Name a department.'); return; }
    act(() => deptOp({ kind: 'add', name }), `Added ${name}`);
  });
  on('[data-dept-rename]', 'click', async el => {
    const id = el.dataset.deptRename, cur = dname(id);
    const r = await modal({ title: `Rename ${cur}`, body: `<div class="field"><label for="adm-rn">Department name</label><input id="adm-rn" name="name" maxlength="60" value="${esc(cur)}" /></div>
      <div class="hint">People, approvers and process routing move with it.</div>`, actions: [{ id: 'save', label: 'Rename', primary: true }] });
    if (r.action !== 'save') return;
    const name = String((r.form && r.form.name) || '').trim();
    if (!name) { toast('Name a department.'); return; }
    act(() => deptOp({ kind: 'rename', id, name }), `Renamed ${cur} to ${name}`);
  });
  on('[data-dept-remove]', 'click', async el => {
    const id = el.dataset.deptRemove, cur = dname(id);
    const r = await modal({ title: `Remove ${cur}?`, body: `<p>Processes that route a team to ${esc(cur)} will ask you to choose who approves for that team instead.</p>`, actions: [{ id: 'rm', label: 'Remove', danger: true }] });
    if (r.action !== 'rm') return;
    act(() => deptOp({ kind: 'remove', id }), `Removed ${cur}`);
  });
  on('[data-dept-approvers-save]', 'click', el => {
    const id = el.dataset.deptApproversSave;
    const ids = [...root.querySelectorAll(`[data-dept-approvers="${CSS.escape(id)}"] input[type=checkbox]:checked`)].map(x => x.value);
    act(dop({ kind: 'approvers', id, approvers: ids }), said(`${dname(id)} approvers`, ids.length ? `${ids.map(pname).join(', ')} now approve${ids.length === 1 ? 's' : ''} for ${dname(id)}` : `Anyone in ${dname(id)} can approve`));
  });
  on('[data-dept-assign-form]', 'submit', (el, e) => {
    e.preventDefault();
    const id = el.dataset.deptAssignForm, personId = el.querySelector('[name=personId]').value;
    if (!personId) { toast('Choose a person.'); return; }
    act(dop({ kind: 'assign', personId, id }), said(`${pname(personId)} to ${dname(id)}`, `${pname(personId)} is now in ${dname(id)}`));
  });
  /* R14 (Jordan): a second Admin confirms a pending move with the extra sign-in check, or anyone Admin cancels it */
  on('[data-pend-confirm]', 'click', async el => {
    const id = el.dataset.pendConfirm, p = pendings().find(x => x.id === id);
    if (!(await stepUp('confirm this department change'))) { toast('Not confirmed: the extra sign-in check was not completed.'); return; }
    act(async () => { await api('POST', '/departments/pending/' + encodeURIComponent(id) + '/confirm', { stepUp: { method: 'simulated-mfa', at: new Date().toISOString() } }); S.viewStale = true; },
      `Confirmed: ${p ? p.text : 'the department change'}`);
  });
  on('[data-pend-cancel]', 'click', el => {
    const id = el.dataset.pendCancel, p = pendings().find(x => x.id === id);
    act(async () => { await api('POST', '/departments/pending/' + encodeURIComponent(id) + '/cancel', {}); S.viewStale = true; },
      p && p.by === store.state.me ? 'Proposal withdrawn' : 'Proposal turned down');
  });

  /* calendar */
  on('[data-holiday-form]', 'submit', (el, e) => {
    e.preventDefault();
    const date = el.querySelector('[name=date]').value, name = el.querySelector('[name=name]').value.trim();
    if (!date) { toast('Pick a date'); return; }
    act(async () => { S.view = await api('POST', '/holidays', { date, name }); }, `Added ${name || 'Company holiday'}`);
  });
  on('[data-hremove]', 'click', el => act(async () => { S.view = await api('DELETE', '/holidays/' + el.dataset.hremove, {}); }, 'Day removed'));
  on('[data-hwork]', 'click', el => act(async () => { S.view = await api('DELETE', '/holidays/' + el.dataset.hwork, {}); }, 'Now a working day'));
  on('[data-hrestore]', 'click', el => act(async () => { S.view = await api('POST', '/holidays', { date: el.dataset.hrestore }); }, 'Back to a day off'));

  /* history */
  on('[data-f]', 'change', el => { S.f[el.dataset.f] = el.value; S.shown = PAGE; rerender(); });
  on('[data-fclear]', 'click', () => { S.f = { person: '', item: '', from: '', to: '' }; S.shown = PAGE; rerender(); });
  on('[data-more]', 'click', () => { S.shown += PAGE; rerender(); });
  on('[data-export]', 'click', async el => {
    const fmt = el.dataset.export;
    try {
      await api('POST', '/audit/anchor', {});          /* records today's chain head so later edits to it are detectable */
      const r = await fetch(API() + auditQS(fmt, true));
      if (!r.ok) throw new Error('Export failed (HTTP ' + r.status + ')');
      const text = fmt === 'csv' ? await r.text() : JSON.stringify(await r.json(), null, 2);
      const day = store.state.today;
      download(`pmoflow-history-${day}.${fmt}`, fmt === 'csv' ? '﻿' + (text || '') : text, fmt === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
      toast(`Exported ${fmt.toUpperCase()}`);
      S.auditStale = true; refresh('history');
    } catch (e) { toast(e.message); }
  });
  on('[data-checkfile]', 'change', async el => {
    const f = el.files && el.files[0]; if (!f) return;
    try {
      const text = await f.text();
      /* R12: a CSV export is checked on the server from its footer row (signed head and count) */
      if (/\.csv$/i.test(f.name || '') || /^\uFEFF?seq,at,actor/.test(text)) { S.fileCheck = (await api('POST', '/audit/verify', { csv: text })).verify; rerender(); return; }
      let j; try { j = JSON.parse(text); } catch (e) { throw new Error('That file isn’t a PMOFlow history export.'); }
      const entries = Array.isArray(j) ? j : j.entries;
      if (!Array.isArray(entries)) throw new Error('That file isn’t a PMOFlow history export.');
      if (j.filtered) { S.fileCheck = { ok: false, summary: 'This export was filtered, so its chain has gaps. Export without filters to check it.' }; rerender(); return; }
      S.fileCheck = (await api('POST', '/audit/verify', { entries, head: Array.isArray(j) ? null : (j.head || null) })).verify;
    } catch (e) { S.fileCheck = { ok: false, summary: e.message }; }
    rerender();
  });
}
