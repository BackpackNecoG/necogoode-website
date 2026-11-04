/* PMOFlow AI — Azure OpenAI chat completions over facts only, with a deterministic
   rules-based fallback for every kind. Result always carries source: 'ai' | 'rules'.
   Settings: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_VERSION.
   Profile docs are never sent (they hold statistics only anyway); sampleCsv is never sent. */

const KINDS = ['status-report', 'sop-import', 'suggest-work'];
const TIMEOUT_MS = 20000;
const RULES = 'Use ONLY the facts supplied in the user message. Never invent people, dates, numbers, systems or data elements. ' +
  'If a fact is not supplied, leave it out. Respond with a single JSON object and nothing else.';

function loadEngine() {
  try { return require('./pmoflow-engine.js'); } catch (e) { return null; }
}

function configured() {
  return !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY && process.env.AZURE_OPENAI_DEPLOYMENT);
}

async function chat(system, user, maxTokens) {
  if (!configured()) throw new Error('not-configured');
  let ep = String(process.env.AZURE_OPENAI_ENDPOINT);
  if (!ep.endsWith('/')) ep += '/';
  const ver = process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${ep}openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${ver}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'api-key': process.env.AZURE_OPENAI_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.2, max_tokens: maxTokens || 900, response_format: { type: 'json_object' } }),
    });
    if (!r.ok) throw new Error('upstream-' + r.status);
    const j = await r.json();
    const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return JSON.parse(txt || '{}');
  } finally { clearTimeout(timer); }
}

const list = (docs, type) => ((docs && docs[type]) || []).map(d => d.data);
const strArr = (a, n) => (Array.isArray(a) ? a : []).filter(x => typeof x === 'string').map(s => s.slice(0, 400)).slice(0, n || 8);

/* ---------- status report ---------- */
function statusFacts(docs, projectId, today, engine) {
  const project = list(docs, 'project').find(p => p.id === projectId);
  if (!project) return null;
  const people = Object.fromEntries(list(docs, 'person').map(p => [p.id, p.name]));
  const work = list(docs, 'workItem').filter(w => w.projectId === projectId);
  const dataEls = Object.fromEntries(list(docs, 'dataElement').map(d => [d.id, d]));
  const facts = { project: { name: project.name, target: project.target, status: project.status, owner: people[project.owner] || project.owner }, today };
  if (engine) {
    facts.stats = engine.projectStats(docs, projectId, today);
    const fc = engine.forecastAll(docs, today);
    facts.atRisk = work.filter(w => fc[w.id] && ['late', 'slip'].includes(fc[w.id].sched))
      .map(w => ({ id: w.id, title: w.title, owner: people[w.owner] || w.owner, due: w.due, forecast: fc[w.id].forecast, sched: fc[w.id].sched, slipDays: fc[w.id].slipDays, cause: fc[w.id].cause || null }));
    const r = engine.readiness(docs, projectId, today);
    facts.readiness = { pass: r.pass, failing: r.checks.filter(c => !c.pass).map(c => ({ label: c.label, detail: c.detail })) };
  } else {
    const done = work.filter(w => w.status === 'done').length;
    facts.stats = { total: work.length, done, pct: work.length ? Math.round(100 * done / work.length) : 0, target: project.target,
      late: work.filter(w => w.status !== 'done' && w.due < today).length };
    facts.atRisk = work.filter(w => w.status !== 'done' && w.due < today).map(w => ({ id: w.id, title: w.title, owner: people[w.owner] || w.owner, due: w.due, sched: 'late' }));
  }
  const procIds = new Set(project.processes || []);
  const usedData = new Set();
  list(docs, 'process').filter(p => procIds.has(p.id)).forEach(p => {
    const walk = ns => (ns || []).forEach(n => { (n.data || []).forEach(d => usedData.add(d)); (n.branches || []).forEach(b => walk(b.nodes)); });
    walk(p.tobe);
  });
  facts.blockers = [...usedData].map(id => dataEls[id]).filter(d => d && d.avail === 'missing').map(d => {
    const resolver = work.find(w => w.resolves === d.id);
    const ready = engine ? engine.dataReady(docs, d.id) : !!(resolver && resolver.status === 'done');
    return ready ? null : { data: d.id, name: d.name, owner: people[d.owner] || d.owner, resolver: resolver ? resolver.id + ' ' + resolver.title : null };
  }).filter(Boolean);
  facts.risks = list(docs, 'risk').filter(r => r.projectId === projectId && r.status === 'open')
    .map(r => ({ title: r.title, impact: r.impact, likelihood: r.likelihood, owner: people[r.owner] || r.owner, mitigation: r.mitigation }));
  facts.pendingGrants = list(docs, 'grant').filter(g => g.projectId === projectId && g.status === 'requested')
    .map(g => ({ id: g.id, data: g.dataId, env: g.env, access: g.access, requestedBy: people[g.requestedBy] || g.requestedBy }));
  return facts;
}

function fd(d) { return d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : d; }
function statusRules(f) {
  const s = f.stats || {};
  const onTrack = s.onTrack != null ? s.onTrack : !(f.atRisk || []).length;
  const finish = s.finish ? `forecast finish ${fd(s.finish)}` : 'no forecast yet';
  return {
    headline: `${f.project.name}: ${s.pct || 0}% done, ${onTrack ? 'on track' : 'at risk'} for ${fd(f.project.target)}`,
    summary: `${s.done || 0} of ${s.total || 0} work items are done; ${finish} against a target of ${fd(f.project.target)}. ` +
      `${(f.atRisk || []).length} item(s) are late or slipping and ${(f.blockers || []).length} data element(s) are still missing.`,
    highlights: [`${s.done || 0} of ${s.total || 0} work items complete`]
      .concat(f.readiness ? [f.readiness.pass ? 'Go-live gate passes' : `Go-live gate: ${f.readiness.failing.length} check(s) open`] : []),
    risks: (f.atRisk || []).map(w => `${w.id} ${w.title} (${w.owner}) ${w.sched === 'slip' ? 'slipping' : w.sched}${w.slipDays ? ` by ${w.slipDays} day(s)` : ''}${w.cause ? `, caused by ${w.cause}` : ''}`)
      .concat((f.risks || []).filter(r => r.impact === 'high').map(r => `${r.title} (impact ${r.impact}, likelihood ${r.likelihood}, owner ${r.owner})`)),
    asks: (f.blockers || []).map(b => `${b.owner}: make ${b.name} (${b.data}) available${b.resolver ? ` via ${b.resolver}` : ''}`)
      .concat((f.pendingGrants || []).map(g => `Decide on ${g.env.toUpperCase()} ${g.access} access to ${g.data} requested by ${g.requestedBy}`)),
  };
}

/* ---------- SOP import ---------- */
const MAX_SOP = 20000;
function matchPeople(text, people) {
  const t = text.toLowerCase();
  const full = people.find(p => p.name && t.includes(p.name.toLowerCase()));
  if (full) return full.id;
  /* first names match case-sensitively so "dev environment" never maps to "Dev Kumar" */
  /* first names that are also ordinary words ("Dev environment", "May require") never match on their own */
  const COMMON = new Set(['dev', 'may', 'will', 'mark', 'bill', 'grant', 'art', 'rob', 'pat', 'max', 'ray', 'hope', 'joy', 'rose', 'sue', 'chase', 'drew', 'case']);
  const first = people.find(p => {
    const fn = String(p.name || '').split(' ')[0].replace(/[^A-Za-z]/g, '');
    return fn && !COMMON.has(fn.toLowerCase()) && new RegExp('\\b' + fn + '\\b').test(text);
  });
  if (first) return first.id;
  const role = people.find(p => p.role && t.includes(p.role.split('·')[0].trim().toLowerCase()));
  return role ? role.id : undefined;
}
function matchData(text, dataEls) {
  const t = text.toLowerCase();
  return dataEls.filter(d => {
    const name = String(d.name || '').toLowerCase();
    if (name && t.includes(name)) return true;
    return name.split(/\s*&\s*|\s+and\s+/).map(s => s.trim()).filter(s => s.length >= 5).some(part => t.includes(part));
  }).map(d => d.id);
}
function sopRules(text, docs) {
  const people = list(docs, 'person'), dataEls = list(docs, 'dataElement');
  let lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) lines = text.split(/(?<=[.;])\s+/).map(l => l.trim()).filter(Boolean);
  const nodes = [];
  for (let l of lines) {
    if (/^#+\s|:\s*$/.test(l) && !/^\s*(\d+[.)]|[-*•])/.test(l)) continue;          /* headings */
    l = l.replace(/^\s*(step\s*)?(\d+[.)]|[-*•]|[a-z][.)])\s*/i, '').replace(/\s+/g, ' ').trim();
    if (l.length < 4) continue;
    const node = { title: l.length > 90 ? l.slice(0, 87).replace(/\s+\S*$/, '') + '…' : l };
    const owner = matchPeople(l, people); if (owner) node.owner = owner;
    const data = matchData(l, dataEls); if (data.length) node.data = data;
    nodes.push(node);
    if (nodes.length >= 40) break;
  }
  return { nodes, notes: `Split into ${nodes.length} step(s) by line. Owners and data elements were matched by name to existing records only; review and adjust before saving.` };
}
function sanitizeSop(out, docs) {
  const peopleIds = new Set(list(docs, 'person').map(p => p.id));
  const dataIds = new Set(list(docs, 'dataElement').map(d => d.id));
  const nodes = (Array.isArray(out && out.nodes) ? out.nodes : []).slice(0, 40).map(n => {
    if (!n || typeof n.title !== 'string' || !n.title.trim()) return null;
    const node = { title: n.title.trim().slice(0, 120) };
    if (typeof n.owner === 'string' && peopleIds.has(n.owner)) node.owner = n.owner;
    const data = (Array.isArray(n.data) ? n.data : []).filter(d => dataIds.has(d));
    if (data.length) node.data = [...new Set(data)];
    const touches = strArr(n.touches, 4).map(s => s.slice(0, 40));
    if (touches.length) node.touches = touches;
    return node;
  }).filter(Boolean);
  return { nodes, notes: typeof (out && out.notes) === 'string' ? out.notes.slice(0, 600) : '' };
}

/* ---------- entry point ---------- */
/* Returns {status, body}. body always includes source on success. */
async function run(kind, body, docs, today) {
  body = body || {};
  if (kind === 'sop-import') {
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) return { status: 400, body: { error: 'text is required' } };
    if (text.length > MAX_SOP) return { status: 413, body: { error: `text exceeds ${MAX_SOP} characters` } };
    const fallback = sopRules(text, docs);
    if (!configured()) return { status: 200, body: Object.assign(fallback, { source: 'rules' }) };
    try {
      const people = list(docs, 'person').map(p => ({ id: p.id, name: p.name, role: p.role }));
      const data = list(docs, 'dataElement').map(d => ({ id: d.id, name: d.name }));
      const out = await chat(RULES + ' Convert the SOP into ordered process steps. Return {"nodes":[{"title","owner"?,"data"?,"touches"?}],"notes"}. ' +
        'owner must be one of the supplied person ids, matched by name or role; data must be supplied data element ids matched by name. ' +
        'Omit owner/data when there is no clear match. touches are short system or team names mentioned in the text. Titles are short imperative phrases.',
        JSON.stringify({ people, dataElements: data, sop: text }), 1500);
      const clean = sanitizeSop(out, docs);
      if (!clean.nodes.length) throw new Error('empty');
      return { status: 200, body: Object.assign(clean, { source: 'ai' }) };
    } catch (e) { return { status: 200, body: Object.assign(fallback, { source: 'rules' }) }; }
  }

  const projectId = body.projectId;
  if (typeof projectId !== 'string' || !/^[\w.-]{1,64}$/.test(projectId)) return { status: 400, body: { error: 'projectId is required' } };
  if (!list(docs, 'project').some(p => p.id === projectId)) return { status: 404, body: { error: 'unknown project' } };
  const engine = loadEngine();

  if (kind === 'status-report') {
    const facts = statusFacts(docs, projectId, today, engine);
    const fallback = statusRules(facts);
    if (!configured()) return { status: 200, body: Object.assign(fallback, { source: 'rules', facts }) };
    try {
      const out = await chat(RULES + ' Write a concise project status report for executives. Return ' +
        '{"headline": string, "summary": string (2-3 sentences), "highlights": [string], "risks": [string], "asks": [string]}.',
        JSON.stringify(facts), 900);
      if (typeof out.headline !== 'string' || typeof out.summary !== 'string') throw new Error('shape');
      return { status: 200, body: { headline: out.headline.slice(0, 200), summary: out.summary.slice(0, 1200),
        highlights: strArr(out.highlights), risks: strArr(out.risks), asks: strArr(out.asks), source: 'ai', facts } };
    } catch (e) { return { status: 200, body: Object.assign(fallback, { source: 'rules', facts }) }; }
  }

  if (kind === 'suggest-work') {
    if (!engine || typeof engine.suggestWorkFromDiff !== 'function') return { status: 503, body: { error: 'engine unavailable' } };
    const items = engine.suggestWorkFromDiff(docs, projectId) || [];
    if (!configured() || !items.length) return { status: 200, body: { items, source: 'rules' } };
    try {
      const out = await chat(RULES + ' Improve only the wording of each work item title: short, specific, imperative, max 70 characters. ' +
        'Do not add or remove items. Return {"titles": [string]} in the same order and the same count.',
        JSON.stringify(items.map(i => ({ title: i.title, kind: i.kind, step: i.step }))), 700);
      const titles = Array.isArray(out.titles) ? out.titles : [];
      if (titles.length !== items.length) throw new Error('count');
      return { status: 200, body: { items: items.map((it, i) => Object.assign({}, it,
        { title: typeof titles[i] === 'string' && titles[i].trim() ? titles[i].trim().slice(0, 90) : it.title })), source: 'ai' } };
    } catch (e) { return { status: 200, body: { items, source: 'rules' } }; }
  }
  return { status: 400, body: { error: 'unknown ai kind' } };
}

module.exports = { run, KINDS, configured, sopRules, statusRules, statusFacts };
