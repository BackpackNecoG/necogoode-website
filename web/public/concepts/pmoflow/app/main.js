/* Boot + router. Pages export render(params) -> html and optional bind(root, params). */
import { store } from './store.js';
import { BASE, link, go, esc, fmtTime, drawer, toast, modal } from './ui.js';

const ROUTES = [
  [/^\/$/, 'home', () => ({})],
  [/^\/processes$/, 'processes', () => ({})],
  [/^\/process\/([\w-]+)\/step\/([\w-]+)$/, 'step', m => ({ pid: m[1], sid: m[2] })],
  [/^\/process\/([\w-]+)$/, 'process', m => ({ pid: m[1] })],
  [/^\/new$/, 'process', () => ({ pid: null, create: true })],
  [/^\/data\/([\w-]+)$/, 'data', m => ({ did: m[1] })],
  [/^\/project\/([\w-]+)$/, 'project', m => ({ prj: m[1] })],
  [/^\/portfolio$/, 'portfolio', () => ({})],
  [/^\/dashboard$/, 'dashboard', () => ({})],
  [/^\/release\/([\w-]+)$/, 'release', m => ({ prj: m[1] })],
  [/^\/testing\/([\w-]+)$/, 'testing', m => ({ prj: m[1] })],
  [/^\/import$/, 'importsop', () => ({})],
];
const NAV = { home: 'home', processes: 'process', process: 'process', step: 'process', data: 'process', new: 'process', project: 'project', portfolio: 'portfolio', dashboard: 'dashboard', release: 'release', testing: 'testing', importsop: 'process' };

const pageCache = {};
async function loadPage(name) {
  if (!pageCache[name]) pageCache[name] = import(`./pages/${name}.js`).catch(e => ({ render: () => `<div class="card"><h3>Not available</h3><div class="hint">${esc(e.message)}</div></div>` }));
  return pageCache[name];
}

function resolve() {
  const path = location.pathname.slice(BASE.length).replace(/\/+$/, '') || '/';
  const q = Object.fromEntries(new URLSearchParams(location.search));
  for (const [re, name, fn] of ROUTES) { const m = path.match(re); if (m) return { name, params: Object.assign(fn(m), { q }) }; }
  return { name: null, params: { q } };
}

function firstProject() { const p = store.list('project')[0]; return p ? p.id : ''; }
function firstProcess() { const p = store.list('process')[0]; return p ? p.id : ''; }

function renderChrome(active) {
  const prj = firstProject(), proc = firstProcess();
  const items = [['home', '/', 'Workspace'], ['process', '/processes', 'Processes'], ['project', '/project/' + prj, 'Project'],
    ['release', '/release/' + prj, 'Release'], ['testing', '/testing/' + prj, 'Testing'], ['portfolio', '/portfolio', 'Portfolio'], ['dashboard', '/dashboard', 'Dashboard']];
  document.getElementById('nav').innerHTML = items.map(([k, p, l]) => `<a href="${link(p)}" data-link class="${active === k ? 'on' : ''}">${l}</a>`).join('');
  document.getElementById('brand').setAttribute('href', link('/'));
  const sel = document.getElementById('persona');
  sel.innerHTML = store.state.people.map(p => `<option value="${esc(p.id)}" ${p.id === store.state.me ? 'selected' : ''}>${esc(p.name)} — ${esc(p.role)}</option>`).join('');
  const unread = store.list('notification', n => n.to === store.state.me && !n.read).length;
  const bn = document.getElementById('bellN'); bn.hidden = !unread; bn.textContent = unread;
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const { name, params } = resolve();
  renderChrome(NAV[name] || '');
  const app = document.getElementById('app');
  if (store.state.offline) {
    app.innerHTML = `<div class="banner">The demo workspace service is unavailable right now (${esc(store.state.error || 'offline')}). Try again in a minute.</div>`;
    return;
  }
  if (!name) { app.innerHTML = `<div class="card"><h3>Not found</h3><a href="${link('/')}" data-link style="color:var(--accent)">Back to workspace</a></div>`; return; }
  const mod = await loadPage(name);
  if (seq !== renderSeq) return; /* a newer render started */
  let html;
  try { html = mod.render(params); } catch (e) { console.error(e); html = `<div class="card"><h3>Something went wrong</h3><div class="hint">${esc(e.message)}</div></div>`; }
  const footer = `<div class="hint" style="text-align:center;margin:28px 0 8px">Concept demo · fictional Northwind data · your changes live in a private sandbox for 30 days · <a href="#" data-reset style="color:var(--accent)">Reset demo data</a></div>`;
  app.innerHTML = (store.state.error ? `<div class="banner">${esc(store.state.error)}</div>` : '') + html + footer;
  store.state.error = null;
  try { if (mod.bind) mod.bind(app, params); } catch (e) { console.error(e); }
}

function openNotifications() {
  const mine = store.list('notification', n => n.to === store.state.me).sort((a, b) => b.at.localeCompare(a.at));
  drawer('Notifications', mine.map(n => `<div class="row click" data-goref="${esc(n.ref || '')}" data-nid="${esc(n.id)}"><div><div class="t" style="font-weight:${n.read ? 400 : 650}">${esc(n.text)}</div><div class="s">${esc(fmtTime(n.at))}</div></div></div>`).join('') || '<div class="empty">Nothing yet. Mentions, approvals and access requests show up here.</div>', root => {
    root.querySelectorAll('[data-nid]').forEach(el => el.onclick = async () => {
      const n = store.get('notification', el.dataset.nid); if (n && !n.read) await store.save('notification', n.id, Object.assign({}, n, { read: true }), 'Read notification');
      const ref = el.dataset.goref; const [type, id] = ref.split(':');
      const target = refPath(type, id); if (target) { document.querySelector('.drawer')?.remove(); go(target); }
    });
  });
}
/* Map a doc ref to a page path. */
export function refPath(type, id) {
  if (type === 'process') return '/process/' + id;
  if (type === 'dataElement') return '/data/' + id;
  if (type === 'project') return '/project/' + id;
  if (type === 'grant' || type === 'approval' || type === 'release') { const d = store.get(type, id); return d ? '/release/' + d.projectId : null; }
  if (type === 'workItem') { const w = store.get('workItem', id); return w ? `/process/${w.pid}/step/${w.step}` : null; }
  if (type === 'step') { const [pid, sid] = id.split('/'); return `/process/${pid}/step/${sid}`; }
  if (type === 'testCase' || type === 'testRun' || type === 'profile') return '/testing/' + firstProject();
  return null;
}

document.addEventListener('click', async e => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); history.pushState({}, '', a.getAttribute('href')); render(); window.scrollTo(0, 0); return; }
  const g = e.target.closest('[data-go]');
  if (g && !e.target.closest('button,a,input,select,textarea')) { go(g.dataset.go); return; }
  if (e.target.closest('#bell')) { openNotifications(); return; }
  if (e.target.closest('[data-reset]')) {
    e.preventDefault();
    const r = await modal({ title: 'Reset demo data?', body: '<p style="margin:0">Your sandbox goes back to the original Northwind sample. Your edits will be lost.</p>', actions: [{ id: 'reset', label: 'Reset', danger: true }] });
    if (r.action === 'reset') { await store.reset(); toast('Demo data reset'); }
  }
});
document.getElementById('persona').addEventListener('change', e => { store.setMe(e.target.value); toast('Now viewing as ' + e.target.selectedOptions[0].text.split(' — ')[0]); });
window.addEventListener('popstate', render);
window.addEventListener('pmo:route', render);
store.subscribe(() => render());
store.load();
