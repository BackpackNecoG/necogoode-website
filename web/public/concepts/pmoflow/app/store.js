/* PMOFlow client store — the adapter boundary for the browser.
   Showroom adapter: HTTP to /api/pmoflow with a per-visitor sandbox workspace.
   A tenant build swaps this adapter for one that calls the customer's in-tenant API. */

const API = '/api/pmoflow';
/* "Today" is the user's LOCAL calendar date (UTC dates roll over in the evening in the Americas). */
function localToday() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
const WS_KEY = 'pmoflow.ws';
const ME_KEY = 'pmoflow.me';
const ADV_KEY = 'pmoflow.advanced';

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

async function http(method, path, body) {
  /* Every call carries the user's local date so server-stamped dates match what the user sees. */
  const t = localToday();
  if (method === 'GET') path += (path.includes('?') ? '&' : '?') + 'today=' + t;
  else body = Object.assign({ today: t }, body || {});
  const r = await fetch(API + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok) { const err = new Error((j && j.error) || ('HTTP ' + r.status)); err.status = r.status; err.body = j; throw err; }
  return j;
}


const listeners = new Set();

export const store = {
  state: { ws: null, docs: {}, people: [], today: localToday(), me: null, offline: false, error: null },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit() { listeners.forEach(fn => { try { fn(store.state); } catch (e) { console.error(e); } }); },

  async load() {
    let ws = lsGet(WS_KEY);
    try {
      if (!ws) { ws = (await http('POST', '/workspaces', {})).id; lsSet(WS_KEY, ws); }
      let st;
      try { st = await http('GET', `/ws/${ws}/state`); }
      catch (e) {
        if (e.status === 404) { /* expired or unknown sandbox: start a fresh one */
          lsDel(WS_KEY); ws = (await http('POST', '/workspaces', {})).id; lsSet(WS_KEY, ws);
          st = await http('GET', `/ws/${ws}/state`);
        } else throw e;
      }
      Object.assign(store.state, { ws, docs: st.docs || {}, people: st.people || [], today: localToday(), offline: false, error: null });
    } catch (e) {
      Object.assign(store.state, { offline: true, error: e.message });
    }
    const me = lsGet(ME_KEY);
    store.state.me = (me && store.state.people.some(p => p.id === me)) ? me : (store.state.people[0] && store.state.people[0].id) || null;
    store.emit();
    return store.state;
  },

  setMe(id) { store.state.me = id; lsSet(ME_KEY, id); store.emit(); },

  /* Simple by default; advanced tools (EV, sprints, BPMN, versions, coverage matrix...) only when the user opts in. */
  advanced: lsGet(ADV_KEY) === '1',
  setAdvanced(v) { store.advanced = !!v; lsSet(ADV_KEY, v ? '1' : '0'); store.emit(); },

  list(type, fn) { const arr = (store.state.docs[type] || []).map(d => d.data); return fn ? arr.filter(fn) : arr; },
  get(type, id) { const d = (store.state.docs[type] || []).find(x => x.id === id); return d ? d.data : null; },
  person(id) { return store.state.people.find(p => p.id === id) || null; },

  newId(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },

  /* Optimistic local update, then persist. On failure, reload server truth. */
  async save(type, id, data, summary) {
    data = Object.assign({}, data, { id });
    const arr = store.state.docs[type] || (store.state.docs[type] = []);
    const i = arr.findIndex(x => x.id === id);
    if (i >= 0) arr[i] = { id, data }; else arr.push({ id, data });
    store.emit();
    if (store.state.offline) return data;
    try { await http('PUT', `/ws/${store.state.ws}/doc/${type}/${encodeURIComponent(id)}`, { data, actor: store.state.me, summary: summary || `Updated ${type}` }); }
    catch (e) { store.state.error = e.message; await store.load(); throw e; }
    store.emit(); /* re-render after the server has the event, so history panels refresh immediately */
    return data;
  },

  async remove(type, id, summary) {
    store.state.docs[type] = (store.state.docs[type] || []).filter(x => x.id !== id);
    store.emit();
    if (store.state.offline) return;
    try { await http('DELETE', `/ws/${store.state.ws}/doc/${type}/${encodeURIComponent(id)}`, { actor: store.state.me, summary: summary || `Deleted ${type}` }); }
    catch (e) { store.state.error = e.message; await store.load(); throw e; }
    store.emit();
  },

  async events(ref, limit) {
    if (store.state.offline) return [];
    const q = new URLSearchParams(); if (ref) q.set('ref', ref); q.set('limit', String(limit || 100));
    try { return (await http('GET', `/ws/${store.state.ws}/events?${q}`)).events || []; } catch (e) { return []; }
  },

  /* POST helper for action endpoints (profile, ai, golive, reset). Path is relative to the workspace. */
  async api(path, body) { return http('POST', `/ws/${store.state.ws}${path}`, Object.assign({ actor: store.state.me }, body || {})); },

  async notify(toIds, text, ref) {
    for (const to of [...new Set(toIds)].filter(t => t && t !== store.state.me)) {
      const id = store.newId('ntf');
      await store.save('notification', id, { id, to, text, ref, at: new Date().toISOString(), read: false }, 'Notification');
    }
  },

  async reset() { await http('POST', `/ws/${store.state.ws}/reset`, {}); await store.load(); },
};
