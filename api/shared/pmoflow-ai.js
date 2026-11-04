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
        daysPastDue: w.status !== 'done' && w.due < today ? dayDiff(w.due, today) : 0, cause: fc[w.id].cause ? L.label(fc[w.id].cause) : null }));
    const r = engine.readiness(docs, projectId, today);
    facts.readiness = { pass: r.pass, failing: r.checks.filter(c => !c.pass && !c.warning).map(c => ({ label: c.label, detail: L.scrub(c.detail) })) };
  } else {
    const done = work.filter(w => w.status === 'done').length;
    facts.stats = { total: work.length, done, pct: work.length ? Math.round(100 * done / work.length) : 0, target: project.target,
      late: work.filter(w => w.status !== 'done' && w.due < today).length };
    facts.atRisk = work.filter(w => w.status !== 'done' && w.due < today).map(w => ({ title: w.title, owner: L.person(w.owner), due: w.due, sched: 'late', daysPastDue: dayDiff(w.due, today) }));
  }
  const procIds = new Set(project.processes || []);
  const usedData = new Set();
  list(docs, 'process').filter(p => procIds.has(p.id)).forEach(p => {
    const walk = ns => (ns || []).forEach(n => { (n.data || []).forEach(d => usedData.add(d)); (n.subs || []).forEach(x => (x.data || []).forEach(d => usedData.add(d))); (n.branches || []).forEach(b => walk(b.nodes)); });
    walk(p.tobe);
  });
  /* R4: effective state; a finished fix still awaits the data owner's confirmation ('pending') */
  const eff = d => (engine && typeof engine.effectiveAvail === 'function') ? engine.effectiveAvail(docs, d.id)
    : (d.avail === 'live' ? 'live' : d.avail);
  facts.blockers = [...usedData].map(id => dataEls[id]).filter(d => d && ['missing', 'pending'].includes(eff(d))).map(d => {
    const resolver = work.find(w => w.resolves === d.id);
    return { name: d.name, owner: L.person(d.owner), state: eff(d), resolver: resolver ? resolver.title : null };
  });
  facts.openDiscovered = [...usedData].map(id => dataEls[id]).filter(Boolean)
    .flatMap(d => (d.discovered || []).filter(x => !x.resolved).map(x => ({ data: d.name, requirement: L.scrub(x.text) })));
  const wById = Object.fromEntries(list(docs, 'workItem').map(w => [w.id, w]));
  facts.risks = list(docs, 'risk').filter(r => r.projectId === projectId && r.status === 'open')
    .map(r => {
      const linked = (r.workItems || []).map(id => wById[id]).filter(Boolean);
      return { title: r.title, impact: r.impact, likelihood: r.likelihood, owner: L.person(r.owner), mitigation: r.mitigation,
        workItems: linked.map(w => w.title), likelyMitigated: linked.length > 0 && linked.every(w => w.status === 'done') };
    });
  facts.rag = ragOf(facts);
  facts.pendingGrants = list(docs, 'grant').filter(g => g.projectId === projectId && g.status === 'requested')
    .map(g => ({ data: L.label(g.dataId), env: g.env, access: g.access, requestedBy: L.person(g.requestedBy) }));
  return L.scrub(facts);
}

const plural = (n, word, pl) => `${n} ${n === 1 ? word : (pl || word + 's')}`;
const dayDiff = (a, b) => Math.round((Date.parse(String(b).slice(0, 10) + 'T12:00:00Z') - Date.parse(String(a).slice(0, 10) + 'T12:00:00Z')) / 86400000);

/* Portfolio rule (R3): red if any late item or forecast after target; amber if slipping or under 7 days of buffer; else green. */
function ragOf(f) {
  const s = f.stats || {}, reasons = [];
  const late = (f.atRisk || []).filter(w => w.sched === 'late').length || s.late || 0;
  const slipping = (f.atRisk || []).filter(w => w.sched === 'slip').length || s.slip || 0;
  const finish = s.actualFinish || s.finish, target = f.project.target;
  const buffer = finish && target ? Math.round((Date.parse(target + 'T12:00:00Z') - Date.parse(String(finish).slice(0, 10) + 'T12:00:00Z')) / 86400000) : null;
  if (late) reasons.push(`${plural(late, 'work item')} ${late === 1 ? 'is' : 'are'} late`);
  if (buffer != null && buffer < 0) reasons.push(`the forecast finish is ${plural(-buffer, 'day')} after target`);
  if (reasons.length) return { status: 'red', reasons, bufferDays: buffer };
  if (slipping) reasons.push(`${plural(slipping, 'work item')} ${slipping === 1 ? 'is' : 'are'} slipping`);
  if (buffer != null && buffer < 7) reasons.push(`there ${buffer === 1 ? 'is' : 'are'} only ${plural(buffer, 'day')} of buffer before target`);
  if (reasons.length) return { status: 'amber', reasons, bufferDays: buffer };
  return { status: 'green', reasons: [buffer != null ? `there ${buffer === 1 ? 'is' : 'are'} ${plural(buffer, 'day')} of buffer and nothing is late or slipping` : 'nothing is late or slipping'], bufferDays: buffer };
}
const RAG_WORD = { red: 'Red', amber: 'Amber', green: 'Green' };
const RAG_PHRASE = { red: 'off track', amber: 'at risk', green: 'on track' };

function fd(d) { return d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : d; }
/* R4: "late by N days" = days past due; slip against plan is reported separately */
function atRiskLine(w) {
  const fc = w.forecast ? `forecast ${fd(w.forecast)}` : '';
  const slip = w.slipDays ? `${plural(w.slipDays, 'day')} behind plan` : '';
  const why = w.cause ? `waiting on ${w.cause}` : '';
  if (w.daysPastDue > 0) {
    return `"${w.title}" (${w.owner}) is late by ${plural(w.daysPastDue, 'day')} (was due ${fd(w.due)})` + [fc && slip ? `${fc}, ${slip}` : fc || slip, why].filter(Boolean).map(x => `; ${x}`).join('');
  }
  return `"${w.title}" (${w.owner}) is slipping${slip ? ` ${slip}` : ''}` + [fc, why].filter(Boolean).map(x => `; ${x}`).join('');
}
function lateSlip(f) {
  const late = (f.atRisk || []).filter(w => w.daysPastDue > 0).length, slip = (f.atRisk || []).length - late;
  const verb = n => (n === 1 ? 'is' : 'are');
  return `${plural(late, 'item')} ${verb(late)} past due and ${plural(slip, 'more item', 'more items')} ${verb(slip)} slipping;`;
}
function statusRules(f) {
  const s = f.stats || {};
  const rag = f.rag || ragOf(f);
  const finish = s.finish ? `forecast finish ${fd(s.finish)}` : 'no forecast yet';
  return {
    rag: rag.status,
    headline: `${RAG_WORD[rag.status]}: ${f.project.name} is ${RAG_PHRASE[rag.status]}, ${s.pct || 0}% done, ${finish} vs target ${fd(f.project.target)}`,
    summary: `Status is ${RAG_WORD[rag.status]} because ${rag.reasons.join(' and ')}. ${s.done || 0} of ${s.total || 0} work items are done; ${finish} against a target of ${fd(f.project.target)}. ` +
      `${lateSlip(f)} ${plural((f.blockers || []).length, 'data element')} ${(f.blockers || []).length === 1 ? 'is' : 'are'} not yet live.`,
    highlights: [`${s.done || 0} of ${plural(s.total || 0, 'work item')} complete`]
      .concat(f.readiness ? [f.readiness.pass ? 'Go-live gate passes' : `Go-live gate: ${plural(f.readiness.failing.length, 'check')} open`] : []),
    risks: (f.atRisk || []).map(atRiskLine)
      .concat((f.risks || []).filter(r => r.impact === 'high' && !r.likelyMitigated).map(r => `${r.title} (impact ${r.impact}, likelihood ${r.likelihood}, owner ${r.owner})`))
      .concat((f.risks || []).filter(r => r.likelyMitigated).map(r => `${r.title}: all linked work is done, so it is likely mitigated. ${r.owner}: confirm and close.`)),
    asks: (f.blockers || []).map(b => b.state === 'pending'
        ? `${b.owner}: confirm ${b.name} is live (the fix is done and awaits your confirmation)`
        : `${b.owner}: make ${b.name} available${b.resolver ? ` by finishing "${b.resolver}"` : ''}`)
      .concat((f.openDiscovered || []).map(x => `Resolve the discovered requirement on ${x.data}: ${x.requirement}`))
      .concat((f.pendingGrants || []).map(g => `Decide on ${String(g.env).toUpperCase()} ${g.access} access to ${g.data} requested by ${g.requestedBy}`)),
  };
}

/* ---------- SOP import (R2 rules parser) ---------- */
const MAX_SOP = 20000;
const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'into', 'onto', 'that', 'this', 'are', 'was', 'per', 'via', 'each', 'all', 'any', 'new', 'its', 'their', 'then', 'when', 'than', 'over']);
const VERBS = /^(collect|enter|send|receive|verify|check|review|email|upload|capture|update|create|key|record|pull|get|request|confirm|validate|approve|read|match|store|attach|notify|submit|file|scan|sign|route|export|import|look|obtain|gather|process|prepare|schedule|issue|post|log|add|set|open|close)(s|es|ed)?$/i;
const DOMAINS = { vendor: /\b(vendors?|suppliers?)\b/i, employee: /\b(employees?|staff|payroll|personnel|new hires?|workers?)\b/i, customer: /\b(customers?|clients?)\b/i };
const SKIP_LINE = /^(title|purpose|scope|objective|owner|process owner|document owner|revision|rev\.?|version|effective(\s+date)?|approved by|author|department|document(\s+(id|no\.?|number))?|sop(\s+(id|no\.?|number))?|last\s+(updated|reviewed)|applies to|audience|references?|trigger|start(?:ing)? event)\b\s*[:\-–—]/i;
const GOTO_RE = /\b(?:return(?:s|ed)?|go(?:es)? back|loop(?:s)? back|send(?:s)? (?:it )?back|back)\s+to\s+step\s+(\d+)\b/i;
const GOTO_STRIP = /,?\s*(?:and\s+|then\s+)?(?:return(?:s|ed)?|go(?:es)? back|loop(?:s)? back|send(?:s)? (?:it )?back|back)\s+to\s+step\s+\d+\.?/i;
const RESUBMIT_RE = /\bre-?submit(s|ted|ting)?\b/i;
const ELSE_RE = /^(otherwise|else|if not)\b[,:]?\s*(.*)$/i;
const PAR_RE = /\b(at the same time|in parallel|simultaneously|concurrently)\b/i;
const TRIGGER_LINE = /^(trigger|start(?:ing)? event|starts? when|begins? when)\s*[:\-–—]\s*(.+)$/i;
const TRIGGER_PROSE = /\b(?:process|procedure|sop|workflow)\s+(?:starts|begins|is triggered|is initiated|kicks off)\s+(?:when|once|after|by)\s+(.+?)\.?$/i;
const SYSTEMS = ['ERP', 'Concur', 'NetSuite', 'Workday', 'SharePoint', 'Teams', 'Outlook', 'DocuSign', 'Salesforce'];
const ROLE_ALIASES = [
  { bu: 'Accounts Payable', re: /\bAP\b|\b(ap|payables?)\s+(clerk|specialist|analyst|team|lead)\b/i },
  { bu: 'Treasury', re: /\btreasury\s+(analyst|team|manager|ops|specialist)\b|\btreasurer\b|\bcash manager\b/i },
  { bu: 'Compliance', re: /\bcompliance\s+(officer|analyst|team|manager)\b|\bsanctions analyst\b/i },
  { bu: 'Procurement', re: /\bbuyer\b|\bpurchasing\s+(agent|team|manager)\b|\bprocurement\s+(specialist|officer|analyst|team)\b/i },
  { bu: 'IT', re: /\bIT\s+(admin|team|support)\b|\bintegration engineer\b|\bsysadmin\b|\bhelp ?desk\b/i },
  { bu: 'PMO', re: /\bproject manager\b/i },
];
/* "Finance Director must also approve" -> "Finance Director approves" */
function modal(t) {
  return String(t).replace(/\b(?:must|should|will|shall|needs to|has to)\s+(?:also\s+)?([a-z]+)/i, (m, v) =>
    /(s|sh|ch|x|z|o)$/.test(v) ? v + 'es' : /[^aeiou]y$/.test(v) ? v.slice(0, -1) + 'ies' : v + 's').replace(/\s+also\s+/i, ' ').trim();
}
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
    if (bu) return bu.id;
    const alias = ROLE_ALIASES.find(a => a.re.test(line));
    const viaAlias = alias && people.find(p => p.bu === alias.bu);
    return viaAlias ? viaAlias.id : undefined;
  };
  const systemOf = (line) => { const m = SYSTEMS.find(x => new RegExp('\\b' + x + '\\b').test(line)); return m || undefined; };
  let seq = 0;
  const makeStep = (title, line) => {
    /* R4: titles are never truncated */
    const n = { id: 's' + (++seq), type: 'step', title: cap(title.replace(/\s+/g, ' ').trim().replace(/[.;:,]$/, '')) };
    const o = ownerOf(line); if (o) n.owner = o;
    const d = linkData(line); if (d.length) n.data = d;
    const sys = systemOf(line); if (sys) n.system = sys;
    return n;
  };
  const splitCond = (t) => {
    t = t.replace(/[.;]\s*$/, '');
    let m = /^(?:if|when|unless)\s+(.+?),(?!\d)\s*(?:then\s+)?(.+)$/i.exec(t);
    if (m) return { cond: m[1], action: m[2] };
    m = /^(.+?),?\s+(?:only\s+)?(?:if|when|unless)\s+(.+?)$/i.exec(t);
    if (m) return { cond: m[2], action: m[1] };
    m = /^(.+?)\s*[,(]\s*((?:for|on|where)?\s*[^,()]*?(?:over|above|exceed\w*|greater than|more than)\s+\$?[\d,.]+[^,()]*)\)?\s*(.*)$/i.exec(t);
    if (m) return { cond: m[2], action: (m[1] + ' ' + m[3]).trim() };
    return { cond: t, action: t };
  };
  const decisionTitle = (cond) => {
    let c = cond.replace(/[.;?]$/, '').trim();
    if (/^(over|above|under|below|more than|greater than|less than|exceeds?)\b/i.test(c)) c = 'amount ' + c;
    return cap(c) + '?';
  };

  /* state shared across lines */
  const nodes = [];
  let last = null, lastDecision = null, curLine = null;
  const lineFirst = {};              /* step number -> id of the first node that line produced */
  const pendingGoto = [];            /* [{branch, num}] resolved after parsing (forward references) */
  const pushTop = n => {
    if (nodes.length >= 40) return;
    nodes.push(n);
    if (curLine != null && !lineFirst[curLine]) lineFirst[curLine] = n.id;
  };
  const newDecision = (title, yes) => ({ id: 'd' + (++seq), type: 'decision', title, branches: [{ label: 'Yes', nodes: yes }, { label: 'No', nodes: [] }] });
  const newParallel = branches => ({ id: 'p' + (++seq), type: 'parallel', title: 'In parallel', branches });
  const branchLabel = (step, i) => { const p = people.find(x => x.id === step.owner); return (p && p.bu) || 'Branch ' + (i + 1); };
  /* R4: "return to step N" / "resubmit" -> goto on the branch */
  const gotoOf = (sen) => {
    const m = GOTO_RE.exec(sen);
    if (m) return { num: Number(m[1]) };
    if (RESUBMIT_RE.test(sen)) {
      const prior = nodes.filter(n => n.type === 'step' && /\bsubmit/i.test(n.title));
      const first = nodes.find(n => n.type === 'step');
      const tgt = prior[0] || first;
      return tgt ? { id: tgt.id } : null;
    }
    return null;
  };
  const stripGoto = t => t.replace(GOTO_STRIP, '').replace(/^\s*(then|and)\s+/i, '').replace(/[,;\s]+$/, '').trim();
  const setGoto = (branch, g) => { if (!g) return; if (g.id) branch.goto = g.id; else pendingGoto.push({ branch, num: g.num }); };
  const branchWith = (branch, text, g) => {
    const rest = stripGoto(text);
    if (rest.length >= 3 && !/^(return|go back|loop back|send back)\b/i.test(rest)) { const st = makeStep(modal(rest), rest); branch.nodes.push(st); last = st; }
    setGoto(branch, g);
  };
  /* One numbered line can hold several sentences: main step, inline condition, otherwise-clause, parallel work. */
  const processSentences = (body) => {
    const sentences = body.split(/(?<=[.;!])\s+(?=[A-Z(])/).map(x => x.trim()).filter(x => x.length >= 3);
    for (const sen of sentences) {
      const g = gotoOf(sen);
      const els = ELSE_RE.exec(sen);
      if (els && lastDecision) { branchWith(lastDecision.branches[1], els[2].trim(), g); continue; }
      if (PAR_RE.test(sen)) {
        const rest = sen.replace(PAR_RE, ' ').replace(/^\s*[,:;-]\s*|\s*[,]\s*$/g, '').replace(/\s+/g, ' ').trim();
        const parts = rest.replace(/:$/, '').split(/\s*;\s*|,?\s+and\s+(?=(?:the\s+)?[A-Z])|,\s*while\s+/).map(x => x.trim()).filter(x => x.length >= 3);
        if (parts.length >= 2) {
          const steps = parts.map(x => makeStep(modal(x), x));
          pushTop(newParallel(steps.map((st, i) => ({ label: branchLabel(st, i), nodes: [st] }))));
          last = steps[steps.length - 1]; continue;
        }
        if (!parts.length || /:$/.test(rest)) { const gw = newParallel([]); pushTop(gw); last = gw; continue; }
        const st = makeStep(modal(parts[0]), parts[0]);
        const prev = nodes[nodes.length - 1];
        if (prev && prev.type === 'parallel') prev.branches.push({ label: branchLabel(st, prev.branches.length), nodes: [st] });
        else if (prev && prev.type === 'step') nodes[nodes.length - 1] = Object.assign(newParallel([prev, st].map((x, i) => ({ label: branchLabel(x, i), nodes: [x] }))), {});
        else pushTop(st);
        last = st; continue;
      }
      if (COND.test(sen)) {
        const { cond, action } = splitCond(sen);
        const dec = newDecision(decisionTitle(cond), []);
        branchWith(dec.branches[0], action, g);
        pushTop(dec); lastDecision = dec; continue;
      }
      if (g) {
        /* a loop-back with no condition of its own: the No path of the decision just made, or a rework decision */
        const prev = nodes[nodes.length - 1];
        if (prev && prev === lastDecision && !prev.branches[1].goto && !prev.branches[1].nodes.length) { branchWith(prev.branches[1], sen, g); continue; }
        const dec = newDecision('Rework needed?', []);
        branchWith(dec.branches[0], sen, g);
        pushTop(dec); lastDecision = dec; continue;
      }
      const st = makeStep(sen, sen); pushTop(st); last = st;
    }
  };

  let raw = text.replace(/\t/g, '    ').split(/\r?\n/);
  if (raw.filter(l => l.trim()).length < 2) raw = text.split(/(?<=[.;])\s+/);
  /* trigger: the stated start event, else "Process starts" (never a copy of step 1) */
  let trigger = 'Process starts';
  for (const rl of raw) {
    const t = rl.trim();
    const m = TRIGGER_LINE.exec(t) || TRIGGER_PROSE.exec(t);
    if (m) { trigger = cap(m[m.length - 1].replace(/[.;]$/, '').trim()); break; }
  }
  const NUM = /^(?:step\s+)?(\d+)[.):]\s+|^step\s+\d+\s*[-–:]\s*/i;
  const SUBNUM = /^\d+\.\d+[.)]?\s+/;
  const LETTER = /^(?:[a-z]|[ivx]{1,4})[.)]\s+/i;
  const BULLET = /^[-*•–]\s+/;
  const anyMarker = raw.some(l => NUM.test(l.trim()) || BULLET.test(l.trim()));
  let sawNumbered = false, firstContent = true;
  for (const rl of raw) {
    if (!rl.trim()) continue;
    const indent = rl.match(/^\s*/)[0].length;
    const t = rl.trim();
    const wasFirst = firstContent; firstContent = false;
    if (SKIP_LINE.test(t) || /^#+\s/.test(t) || TRIGGER_LINE.test(t)) continue;
    const isNum = NUM.test(t) && !SUBNUM.test(t), isSubNum = SUBNUM.test(t), isLetter = !isNum && LETTER.test(t), isBullet = BULLET.test(t);
    const body = t.replace(NUM, '').replace(SUBNUM, '').replace(LETTER, '').replace(BULLET, '').trim();
    if (body.length < 3) continue;
    const asSub = last && (isSubNum || (isLetter && sawNumbered) || (isBullet && (indent > 0 || sawNumbered)) || (!isNum && !isBullet && !isLetter && indent >= 2));
    if (asSub) {
      const els = ELSE_RE.exec(body);
      if (els && lastDecision) { branchWith(lastDecision.branches[1], els[2].trim(), gotoOf(body)); continue; }
      if (last.type === 'parallel') { const st = makeStep(modal(body), body); last.branches.push({ label: branchLabel(st, last.branches.length), nodes: [st] }); continue; }
      const sub = { title: cap(body.replace(/[.;]$/, '')), data: linkData(body) };
      (last.subs || (last.subs = [])).push(sub);
      continue;
    }
    if (!isNum && !isBullet && !isLetter) {
      if (anyMarker) continue;                                   /* prose around a numbered list: title, intro, notes */
      if (wasFirst && !/[.!?]$/.test(t) && t.split(/\s+/).length <= 8) continue;   /* bare title line */
      if (/:\s*$/.test(t) || TRIGGER_PROSE.test(t)) continue;    /* heading or start-event sentence */
    }
    if (isNum) { sawNumbered = true; const m = /(\d+)/.exec(t); curLine = m ? Number(m[1]) : null; } else curLine = null;
    processSentences(body);
    if (nodes.length >= 40) break;
  }
  for (const pg of pendingGoto) { if (lineFirst[pg.num]) pg.branch.goto = lineFirst[pg.num]; }
  nodes.unshift({ id: 'k', type: 'trigger', title: trigger });
  const decisions = nodes.filter(n => n.type === 'decision').length, parallels = nodes.filter(n => n.type === 'parallel').length;
  return { nodes, newData,
    notes: `Parsed ${plural(nodes.length - 1, 'top-level node')} after the trigger "${trigger}"${decisions ? `, ${plural(decisions, 'decision')}` : ''}${parallels ? `, ${plural(parallels, 'parallel gateway')}` : ''}. ` +
      'Title, purpose and scope lines were skipped; sub-items were nested. Owners link only on a full name, business unit or role alias; data links only on a strong match. ' +
      'Unmatched data is listed as proposals. Review before saving.' };
}

function sanitizeSop(out, docs) {
  const peopleIds = new Set(list(docs, 'person').map(p => p.id));
  const dataIds = new Set(list(docs, 'dataElement').map(d => d.id));
  const cleanData = a => [...new Set((Array.isArray(a) ? a : []).filter(d => dataIds.has(d)))];
  const used = new Set();
  let seq = 0;
  /* every node gets a unique id (model ids kept when safe) so goto targets resolve */
  const idFor = (n, prefix) => {
    let id = typeof n.id === 'string' && /^[\w.-]{1,40}$/.test(n.id) && !used.has(n.id) ? n.id : null;
    while (!id || used.has(id)) id = prefix + (++seq);
    used.add(id); return id;
  };
  const gotos = [];
  const cleanNode = (n, depth) => {
    if (!n || typeof n.title !== 'string' || !n.title.trim()) return null;
    if (n.type === 'trigger' && depth === 0) return { id: idFor(n, 'k'), type: 'trigger', title: n.title.trim().slice(0, 300) };
    if ((n.type === 'decision' || n.type === 'parallel') && depth === 0 && Array.isArray(n.branches)) {
      const g = { id: idFor(n, n.type === 'parallel' ? 'p' : 'd'), type: n.type, title: n.title.trim().slice(0, 300) };
      g.branches = n.branches.slice(0, 4).map(b => {
        const br = { label: String((b && b.label) || '').slice(0, 30) || 'Branch',
          nodes: (Array.isArray(b && b.nodes) ? b.nodes : []).slice(0, 10).map(x => cleanNode(x, 1)).filter(Boolean) };
        if (b && typeof b.goto === 'string') { br.goto = b.goto; gotos.push(br); }
        return br;
      });
      return g;
    }
    const node = { id: idFor(n, 's'), type: 'step', title: n.title.trim().slice(0, 300) };
    if (typeof n.owner === 'string' && peopleIds.has(n.owner)) node.owner = n.owner;
    const data = cleanData(n.data); if (data.length) node.data = data;
    const touches = strArr(n.touches, 4).map(x => x.slice(0, 40)); if (touches.length) node.touches = touches;
    if (typeof n.system === 'string' && n.system.trim()) node.system = n.system.trim().slice(0, 40);
    const subs = (Array.isArray(n.subs) ? n.subs : []).filter(x => x && typeof x.title === 'string' && x.title.trim()).slice(0, 12)
      .map(x => ({ title: x.title.trim().slice(0, 300), data: cleanData(x.data) }));
    if (subs.length) node.subs = subs;
    return node;
  };
  const nodes = (Array.isArray(out && out.nodes) ? out.nodes : []).slice(0, 40).map(n => cleanNode(n, 0)).filter(Boolean);
  gotos.forEach(b => { if (!used.has(b.goto)) delete b.goto; });   /* drop loop-backs to unknown steps */
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
        'The first node is {"type":"trigger","title"} naming the SOP\'s stated start event, or "Process starts" if none is stated (never a copy of step 1). ' +
        'Work done "at the same time", "in parallel" or "simultaneously" becomes {"type":"parallel","title","branches":[{"label","nodes":[step]}]}. ' +
        '"Otherwise", "else" or "if not" goes in the No branch of the preceding decision. Every node has a short unique "id". ' +
        '"Resubmit" or "return to step N" sets "goto": <id of that step> on the branch (a loop-back). Never truncate titles. ' +
        'Leave owner out unless a full name, business unit or role alias (e.g. AP clerk = Accounts Payable) matches; never default it. A step with an inline condition ' +
        '("Manager approves. If over $5,000, Finance Director also approves.") becomes the main step followed by a decision whose Yes branch holds the conditional action. ' +
        'Steps may carry "system" when a named system (e.g. ERP, Concur, NetSuite, Workday, SharePoint, Teams, Outlook, DocuSign, Salesforce) is used. ' +
        'Skip title, purpose, scope, owner and revision lines. Lettered or indented sub-items become subs of the step above them. ' +
        'owner must be a supplied person id, only on a full-name match or when the step names that person\'s business unit (bu). ' +
        'data must be a supplied data element id, only when the element is clearly the same information about the same kind of party ' +
        '(for example, employee bank details are NOT vendor bank remittance details). Anything else goes in newData. ' +
        'touches are short system or team names mentioned in the text. Titles are short imperative phrases.',
        JSON.stringify({ people, dataElements: data, sop: text }), 1800);
      const clean = sanitizeSop(out, docs);
      if (!clean.nodes.filter(n => n.type !== 'trigger').length) throw new Error('empty');
      if (!clean.nodes.length || clean.nodes[0].type !== 'trigger') clean.nodes.unshift(fallback.nodes[0]);
      clean.nodes = [clean.nodes[0]].concat(clean.nodes.slice(1).filter(n => n.type !== 'trigger'));
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
        'Refer to work, data and people only by the names and titles given; never output identifiers. ' +
        'The headline MUST start with the supplied rag status word (Red, Amber or Green) and must not contradict it. ' +
        'Risks marked likelyMitigated go in risks as "likely mitigated, confirm and close".',
        JSON.stringify(facts), 900);
      if (typeof out.headline !== 'string' || typeof out.summary !== 'string') throw new Error('shape');
      /* the headline must agree with the computed RAG (R3) */
      const want = facts.rag.status, other = Object.keys(RAG_WORD).filter(k => k !== want);
      const conflicts = other.some(k => new RegExp('\\b(' + RAG_WORD[k] + '|' + RAG_PHRASE[k] + ')\\b', 'i').test(out.headline));
      out.headline = conflicts ? fallback.headline : (new RegExp('^' + RAG_WORD[want] + '\\b').test(out.headline) ? out.headline : `${RAG_WORD[want]}: ${out.headline}`);
      return { status: 200, body: Object.assign(L.scrub({ headline: out.headline.slice(0, 200), summary: out.summary.slice(0, 1200),
        highlights: strArr(out.highlights), risks: strArr(out.risks), asks: strArr(out.asks) }), { rag: facts.rag.status, source: 'ai', facts }) };
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
