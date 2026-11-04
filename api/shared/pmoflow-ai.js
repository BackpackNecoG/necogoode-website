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
/* Map every internal doc id to its human label (R2: reports never print ids). */
function labeler(docs) {
  const m = {};
  const put = (id, label) => { if (id && String(id).length >= 2 && label) m[id] = label; };
  ['dataElement', 'process', 'project', 'workItem', 'risk'].forEach(t => list(docs, t).forEach(d => put(d.id, d.name || d.title)));
  list(docs, 'grant').forEach(g => put(g.id, 'the access request'));
  list(docs, 'testCase').forEach(c => put(c.id, `the "${c.field}" test case`));
  list(docs, 'testRun').forEach(r => put(r.id, `the ${String(r.env || '').toUpperCase()} test run`));
  const people = Object.fromEntries(list(docs, 'person').map(p => [p.id, p.name]));
  const ids = Object.keys(m).sort((a, b) => b.length - a.length).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = ids.length ? new RegExp('(?<![\\w-])(' + ids.join('|') + ')(?![\\w-])', 'g') : null;
  const label = id => m[id] || people[id] || id;
  const scrub = v => {
    if (typeof v === 'string') return re ? v.replace(re, id => m[id]) : v;
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
    return v;
  };
  return { label, person: id => people[id] || 'unassigned', scrub };
}

function statusFacts(docs, projectId, today, engine) {
  const project = list(docs, 'project').find(p => p.id === projectId);
  if (!project) return null;
  const L = labeler(docs);
  const work = list(docs, 'workItem').filter(w => w.projectId === projectId);
  const dataEls = Object.fromEntries(list(docs, 'dataElement').map(d => [d.id, d]));
  const facts = { project: { name: project.name, target: project.target, status: project.status, owner: L.person(project.owner) }, today };
  if (engine) {
    const st = engine.projectStats(docs, projectId, today);
    facts.stats = { total: st.total, done: st.done, pct: st.pct, late: st.late, slip: st.slip, blocked: st.blocked, finish: st.finish,
      target: st.target, onTrack: st.onTrack, actualFinish: st.actualFinish };
    const fc = engine.forecastAll(docs, today);
    facts.atRisk = work.filter(w => fc[w.id] && ['late', 'slip'].includes(fc[w.id].sched))
      .map(w => ({ title: w.title, owner: L.person(w.owner), due: w.due, forecast: fc[w.id].forecast, sched: fc[w.id].sched, slipDays: fc[w.id].slipDays,
        cause: fc[w.id].cause ? L.label(fc[w.id].cause) : null }));
    const r = engine.readiness(docs, projectId, today);
    facts.readiness = { pass: r.pass, failing: r.checks.filter(c => !c.pass && !c.warning).map(c => ({ label: c.label, detail: L.scrub(c.detail) })) };
  } else {
    const done = work.filter(w => w.status === 'done').length;
    facts.stats = { total: work.length, done, pct: work.length ? Math.round(100 * done / work.length) : 0, target: project.target,
      late: work.filter(w => w.status !== 'done' && w.due < today).length };
    facts.atRisk = work.filter(w => w.status !== 'done' && w.due < today).map(w => ({ title: w.title, owner: L.person(w.owner), due: w.due, sched: 'late' }));
  }
  const procIds = new Set(project.processes || []);
  const usedData = new Set();
  list(docs, 'process').filter(p => procIds.has(p.id)).forEach(p => {
    const walk = ns => (ns || []).forEach(n => { (n.data || []).forEach(d => usedData.add(d)); (n.subs || []).forEach(x => (x.data || []).forEach(d => usedData.add(d))); (n.branches || []).forEach(b => walk(b.nodes)); });
    walk(p.tobe);
  });
  facts.blockers = [...usedData].map(id => dataEls[id]).filter(d => d && d.avail === 'missing').map(d => {
    const resolver = work.find(w => w.resolves === d.id);
    const ready = engine ? engine.dataReady(docs, d.id) : !!(resolver && resolver.status === 'done');
    return ready ? null : { name: d.name, owner: L.person(d.owner), resolver: resolver ? resolver.title : null };
  }).filter(Boolean);
  facts.openDiscovered = [...usedData].map(id => dataEls[id]).filter(Boolean)
    .flatMap(d => (d.discovered || []).filter(x => !x.resolved).map(x => ({ data: d.name, requirement: L.scrub(x.text) })));
  facts.risks = list(docs, 'risk').filter(r => r.projectId === projectId && r.status === 'open')
    .map(r => ({ title: r.title, impact: r.impact, likelihood: r.likelihood, owner: L.person(r.owner), mitigation: r.mitigation,
      workItems: (r.workItems || []).map(L.label) }));
  facts.pendingGrants = list(docs, 'grant').filter(g => g.projectId === projectId && g.status === 'requested')
    .map(g => ({ data: L.label(g.dataId), env: g.env, access: g.access, requestedBy: L.person(g.requestedBy) }));
  return L.scrub(facts);
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
    risks: (f.atRisk || []).map(w => `"${w.title}" (${w.owner}) is ${w.sched === 'slip' ? 'slipping' : w.sched}${w.slipDays ? ` by ${w.slipDays} day(s)` : ''}${w.cause ? `, waiting on ${w.cause}` : ''}`)
      .concat((f.risks || []).filter(r => r.impact === 'high').map(r => `${r.title} (impact ${r.impact}, likelihood ${r.likelihood}, owner ${r.owner})`)),
    asks: (f.blockers || []).map(b => `${b.owner}: make ${b.name} available${b.resolver ? ` by finishing "${b.resolver}"` : ''}`)
      .concat((f.openDiscovered || []).map(x => `Resolve the discovered requirement on ${x.data}: ${x.requirement}`))
      .concat((f.pendingGrants || []).map(g => `Decide on ${String(g.env).toUpperCase()} ${g.access} access to ${g.data} requested by ${g.requestedBy}`)),
  };
}

/* ---------- SOP import (R2 rules parser) ---------- */
const MAX_SOP = 20000;
const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'into', 'onto', 'that', 'this', 'are', 'was', 'per', 'via', 'each', 'all', 'any', 'new', 'its', 'their', 'then', 'when', 'than', 'over']);
const VERBS = /^(collect|enter|send|receive|verify|check|review|email|upload|capture|update|create|key|record|pull|get|request|confirm|validate|approve|read|match|store|attach|notify|submit|file|scan|sign|route|export|import|look|obtain|gather|process|prepare|schedule|issue|post|log|add|set|open|close)(s|es|ed)?$/i;
const DOMAINS = { vendor: /\b(vendors?|suppliers?)\b/i, employee: /\b(employees?|staff|payroll|personnel|new hires?|workers?)\b/i, customer: /\b(customers?|clients?)\b/i };
const SKIP_LINE = /^(title|purpose|scope|objective|owner|process owner|document owner|revision|rev\.?|version|effective(\s+date)?|approved by|author|department|document(\s+(id|no\.?|number))?|sop(\s+(id|no\.?|number))?|last\s+(updated|reviewed)|applies to|audience|references?)\b\s*[:\-–—]/i;
const COND = /^(if|unless)\b|\b(if|unless)\b|\bwhen\b.*\b(exceed\w*|over|above|greater|more than|below|under)\b|\bover \$|\babove \$|\bgreater than\b|\bmore than \$|\bexceed(s|ing)?\b|\bapproval (is )?required\b/i;
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const clip = (t, n) => (t.length > n ? t.slice(0, n - 3).replace(/\s+\S*$/, '') + '…' : t);
function tokens(t) {
  return String(t).toLowerCase().replace(/'s\b/g, '').split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !STOP.has(w)).map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}
function domainOf(t) { for (const [k, re] of Object.entries(DOMAINS)) if (re.test(t)) return k; return null; }

function sopRules(text, docs) {
  const people = list(docs, 'person'), dataEls = list(docs, 'dataElement'), procs = list(docs, 'process');
  /* document domain: the most-mentioned domain in the SOP */
  const counts = {}; Object.entries(DOMAINS).forEach(([k, re]) => { counts[k] = (text.match(new RegExp(re.source, 'gi')) || []).length; });
  const docDomain = Object.entries(counts).sort((a, b) => b[1] - a[1]).filter(e => e[1] > 0).map(e => e[0])[0] || null;
  /* element domain: its own words, else the processes that use it */
  const usesData = (nodes, id) => (nodes || []).some(n => (n.data || []).includes(id) || (n.subs || []).some(x => (x.data || []).includes(id)) || (n.branches || []).some(b => usesData(b.nodes, id)));
  const elDomain = Object.fromEntries(dataEls.map(d => [d.id, domainOf([d.name, d.source, d.note].join(' ')) ||
    domainOf(procs.filter(p => usesData(p.tobe, d.id) || usesData(p.asis, d.id)).map(p => p.name + ' ' + p.desc).join(' '))]));
  const newData = [], seenNew = new Set(dataEls.map(d => String(d.name).toLowerCase()));
  const propose = (name, reason) => {
    const key = name.toLowerCase();
    if (!name || seenNew.has(key) || newData.length >= 15) return;
    seenNew.add(key); newData.push({ name, reason });
  };
  const phraseFor = (line, nounRe) => {
    const words = line.replace(/[^\w'$-]+/g, ' ').trim().split(/\s+/);
    let k = -1; words.forEach((w, i) => { if (nounRe.test(w.toLowerCase().replace(/'s$/, ''))) k = i; });
    if (k < 0) return null;
    const out = [words[k]];
    for (let i = k - 1; i >= 0 && out.length < 3; i--) {
      const w = words[i].replace(/'s$/i, '');
      if (STOP.has(w.toLowerCase()) || VERBS.test(w) || /^(a|an|of|to|in|on|by|or|is|be)$/i.test(w)) break;
      out.unshift(w);
    }
    return out.length > 1 ? cap(out.join(' ').toLowerCase()) : null;
  };
  const linkData = (line) => {
    const lower = line.toLowerCase();
    const lineDomain = domainOf(line) || docDomain;
    const lt = new Set(tokens(line));
    const hits = [];
    for (const d of dataEls) {
      const name = String(d.name || '').toLowerCase();
      if (name && new RegExp('(^|[^a-z0-9])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(lower)) { hits.push(d.id); continue; }
      /* domain words (vendor, employee…) are compared by domain, not counted as shared tokens */
      const shared = [...new Set(tokens(name))].filter(t => lt.has(t) && !domainOf(t));
      if (shared.length >= 2) {
        if (lineDomain === elDomain[d.id]) hits.push(d.id);
        else {
          const nm = phraseFor(line, new RegExp('^(' + shared.join('|') + ')s?$')) || cap(shared.join(' '));
          const src = /\bfrom\s+(?:the\s+)?([A-Z][\w-]+)/.exec(line);
          propose(nm, `Mentioned in "${clip(line, 80)}"${src ? ` (source: ${src[1]})` : ''}. "${d.name}" shares words but is ${elDomain[d.id] || 'other'} data, not ${lineDomain || 'the same domain'}, so it was not linked.`);
        }
      }
    }
    if (!hits.length) {
      const nm = phraseFor(line, /^(details|record|records|form|data|number|certificate|statement|matrix|report|file|profile)$/);
      if (nm) { const src = /\bfrom\s+(?:the\s+)?([A-Z][\w-]+)/.exec(line); propose(nm, `Mentioned in "${clip(line, 80)}"${src ? ` (source: ${src[1]})` : ''}; no existing data element matches.`); }
    }
    return [...new Set(hits)];
  };
  const ownerOf = (line) => {
    const lower = line.toLowerCase();
    const full = people.find(p => p.name && lower.includes(p.name.toLowerCase()));
    if (full) return full.id;
    const bu = people.find(p => p.bu && (p.bu.length <= 3 ? new RegExp('\\b' + p.bu + '\\b') : new RegExp('\\b' + p.bu.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')).test(line));
    return bu ? bu.id : undefined;
  };
  const makeStep = (title, line) => {
    const n = { type: 'step', title: clip(cap(title.replace(/\s+/g, ' ').trim().replace(/[.;]$/, '')), 90) };
    const o = ownerOf(line); if (o) n.owner = o;
    const d = linkData(line); if (d.length) n.data = d;
    return n;
  };
  const splitCond = (t) => {
    let m = /^(?:if|when|unless)\s+(.+?),(?!\d)\s*(?:then\s+)?(.+)$/i.exec(t);
    if (m) return { cond: m[1], action: m[2] };
    m = /^(.+?),?\s+(?:only\s+)?(?:if|when|unless)\s+(.+?)\.?$/i.exec(t);
    if (m) return { cond: m[2], action: m[1] };
    m = /^(.+?)\s*[,(]\s*((?:for|on|where)?\s*[^,()]*?(?:over|above|exceed\w*|greater than|more than)\s+\$?[\d,.]+[^,()]*)\)?\s*(.*)$/i.exec(t);
    if (m) return { cond: m[2], action: (m[1] + ' ' + m[3]).trim() };
    return { cond: t.replace(/\.$/, ''), action: t };
  };

  let raw = text.replace(/\t/g, '    ').split(/\r?\n/);
  if (raw.filter(l => l.trim()).length < 2) raw = text.split(/(?<=[.;])\s+/);
  const NUM = /^(?:step\s+)?(\d+)[.):]\s+|^step\s+\d+\s*[-–:]\s*/i;
  const SUBNUM = /^\d+\.\d+[.)]?\s+/;
  const LETTER = /^(?:[a-z]|[ivx]{1,4})[.)]\s+/i;
  const BULLET = /^[-*•–]\s+/;
  const anyMarker = raw.some(l => NUM.test(l.trim()) || BULLET.test(l.trim()));
  const nodes = [];
  let last = null, sawNumbered = false, firstContent = true;
  for (const rl of raw) {
    if (!rl.trim()) continue;
    const indent = rl.match(/^\s*/)[0].length;
    const t = rl.trim();
    const wasFirst = firstContent; firstContent = false;
    if (SKIP_LINE.test(t) || /^#+\s/.test(t)) continue;
    const isNum = NUM.test(t) && !SUBNUM.test(t), isSubNum = SUBNUM.test(t), isLetter = !isNum && LETTER.test(t), isBullet = BULLET.test(t);
    const body = t.replace(NUM, '').replace(SUBNUM, '').replace(LETTER, '').replace(BULLET, '').trim();
    if (body.length < 3) continue;
    const asSub = last && (isSubNum || (isLetter && sawNumbered) || (isBullet && (indent > 0 || sawNumbered)) || (!isNum && !isBullet && !isLetter && indent >= 2));
    if (asSub) {
      const sub = { title: clip(cap(body.replace(/[.;]$/, '')), 90), data: linkData(body) };
      (last.subs || (last.subs = [])).push(sub);
      continue;
    }
    if (!isNum && !isBullet && !isLetter) {
      if (anyMarker) continue;                                   /* prose around a numbered list: title, intro, notes */
      if (wasFirst && !/[.!?]$/.test(t) && t.split(/\s+/).length <= 8) continue;   /* bare title line */
      if (/:\s*$/.test(t)) continue;                             /* heading */
    }
    if (isNum) sawNumbered = true;
    let node;
    if (COND.test(body)) {
      const { cond, action } = splitCond(body);
      const step = makeStep(action, body);
      node = { type: 'decision', title: clip(cap(cond.replace(/[.;?]$/, '')), 80) + '?', branches: [{ label: 'Yes', nodes: [step] }, { label: 'No', nodes: [] }] };
      last = step;
    } else { node = makeStep(body, body); last = node; }
    nodes.push(node);
    if (nodes.length >= 40) break;
  }
  const decisions = nodes.filter(n => n.type === 'decision').length;
  return { nodes, newData,
    notes: `Parsed ${nodes.length} top-level step(s)${decisions ? `, including ${decisions} decision(s)` : ''}. Title, purpose and scope lines were skipped; sub-items were nested. ` +
      'Owners link only on a full name or business unit; data links only on a strong match. Unmatched data is listed as proposals. Review before saving.' };
}

function sanitizeSop(out, docs) {
  const peopleIds = new Set(list(docs, 'person').map(p => p.id));
  const dataIds = new Set(list(docs, 'dataElement').map(d => d.id));
  const cleanData = a => [...new Set((Array.isArray(a) ? a : []).filter(d => dataIds.has(d)))];
  const cleanNode = (n, depth) => {
    if (!n || typeof n.title !== 'string' || !n.title.trim()) return null;
    if (n.type === 'decision' && depth === 0 && Array.isArray(n.branches)) {
      const branches = n.branches.slice(0, 4).map(b => ({ label: String((b && b.label) || '').slice(0, 30) || 'Branch',
        nodes: (Array.isArray(b && b.nodes) ? b.nodes : []).slice(0, 10).map(x => cleanNode(x, 1)).filter(Boolean) }));
      return { type: 'decision', title: n.title.trim().slice(0, 100), branches };
    }
    const node = { type: 'step', title: n.title.trim().slice(0, 120) };
    if (typeof n.owner === 'string' && peopleIds.has(n.owner)) node.owner = n.owner;
    const data = cleanData(n.data); if (data.length) node.data = data;
    const touches = strArr(n.touches, 4).map(x => x.slice(0, 40)); if (touches.length) node.touches = touches;
    const subs = (Array.isArray(n.subs) ? n.subs : []).filter(x => x && typeof x.title === 'string' && x.title.trim()).slice(0, 12)
      .map(x => ({ title: x.title.trim().slice(0, 120), data: cleanData(x.data) }));
    if (subs.length) node.subs = subs;
    return node;
  };
  const nodes = (Array.isArray(out && out.nodes) ? out.nodes : []).slice(0, 40).map(n => cleanNode(n, 0)).filter(Boolean);
  const newData = (Array.isArray(out && out.newData) ? out.newData : []).filter(x => x && typeof x.name === 'string' && x.name.trim()).slice(0, 15)
    .map(x => ({ name: x.name.trim().slice(0, 80), reason: typeof x.reason === 'string' ? x.reason.slice(0, 300) : '' }));
  return { nodes, newData, notes: typeof (out && out.notes) === 'string' ? out.notes.slice(0, 600) : '' };
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
      const people = list(docs, 'person').map(p => ({ id: p.id, name: p.name, role: p.role, bu: p.bu }));
      const data = list(docs, 'dataElement').map(d => ({ id: d.id, name: d.name, source: d.source, note: d.note }));
      const out = await chat(RULES + ' Convert the SOP into ordered process steps. Return {"nodes":[node],"newData":[{"name","reason"}],"notes"}. ' +
        'A node is {"type":"step","title","owner"?,"data"?,"touches"?,"subs"?:[{"title","data"}]} or, for a condition such as an amount threshold or "approval required", ' +
        '{"type":"decision","title":"<condition>?","branches":[{"label":"Yes","nodes":[step]},{"label":"No","nodes":[]}]}. ' +
        'Skip title, purpose, scope, owner and revision lines. Lettered or indented sub-items become subs of the step above them. ' +
        'owner must be a supplied person id, only on a full-name match or when the step names that person\'s business unit (bu). ' +
        'data must be a supplied data element id, only when the element is clearly the same information about the same kind of party ' +
        '(for example, employee bank details are NOT vendor bank remittance details). Anything else goes in newData. ' +
        'touches are short system or team names mentioned in the text. Titles are short imperative phrases.',
        JSON.stringify({ people, dataElements: data, sop: text }), 1800);
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
    const L = labeler(docs);
    const fallback = L.scrub(statusRules(facts));
    if (!configured()) return { status: 200, body: Object.assign(fallback, { source: 'rules', facts }) };
    try {
      const out = await chat(RULES + ' Write a concise project status report for executives. Return ' +
        '{"headline": string, "summary": string (2-3 sentences), "highlights": [string], "risks": [string], "asks": [string]}. ' +
        'Refer to work, data and people only by the names and titles given; never output identifiers.',
        JSON.stringify(facts), 900);
      if (typeof out.headline !== 'string' || typeof out.summary !== 'string') throw new Error('shape');
      return { status: 200, body: Object.assign(L.scrub({ headline: out.headline.slice(0, 200), summary: out.summary.slice(0, 1200),
        highlights: strArr(out.highlights), risks: strArr(out.risks), asks: strArr(out.asks) }), { source: 'ai', facts }) };
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

module.exports = { run, KINDS, configured, sopRules, statusRules, statusFacts, labeler };
