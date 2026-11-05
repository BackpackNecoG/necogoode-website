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
  /* R5: "not yet live" = every used element that is not effectively live (missing + examples + pending) */
  facts.notLive = [...usedData].map(id => dataEls[id]).filter(d => d && eff(d) !== 'live').map(d => {
    const resolver = work.find(w => w.resolves === d.id);
    return { name: d.name, owner: L.person(d.owner), state: eff(d), resolver: resolver ? resolver.title : null };
  });
  facts.blockers = facts.notLive.filter(b => ['missing', 'pending'].includes(b.state));
  facts.openDiscovered = [...usedData].map(id => dataEls[id]).filter(Boolean)
    .flatMap(d => (d.discovered || []).filter(x => !x.resolved).map(x => ({ data: d.name, requirement: L.scrub(x.text) })));
  const wById = Object.fromEntries(list(docs, 'workItem').map(w => [w.id, w]));
  facts.risks = list(docs, 'risk').filter(r => r.projectId === projectId && r.status === 'open')
    .map(r => {
      const linked = (r.workItems || []).map(id => wById[id]).filter(Boolean);
      return { title: r.title, impact: r.impact, likelihood: r.likelihood, owner: L.person(r.owner), mitigation: r.mitigation,
        workItems: linked.map(w => w.title), likelyMitigated: linked.length > 0 && linked.every(w => w.status === 'done') };
    });
  /* R6: one RAG truth — the engine's projectHealth (Red only when the finish date is at risk) */
  facts.rag = healthOf(docs, projectId, today, engine, facts);
  facts.earnedValue = evOf(docs, projectId, today, engine, project);
  facts.hypercare = hypercareOf(project, today, L);
  facts.pendingGrants = list(docs, 'grant').filter(g => g.projectId === projectId && g.status === 'requested')
    .map(g => ({ data: L.label(g.dataId), env: g.env, access: g.access, requestedBy: L.person(g.requestedBy) }));
  return L.scrub(facts);
}

/* R6: RAG from engine.projectHealth(docs, prj, today) -> {rag, reasons[]}; rules fallback applies the same R6 rule. */
function healthOf(docs, projectId, today, engine, facts) {
  const fin = (facts.stats || {}).actualFinish || (facts.stats || {}).finish, target = facts.project.target;
  const bufferDays = fin && target ? dayDiff(String(fin).slice(0, 10), target) : null;
  if (engine && typeof engine.projectHealth === 'function') {
    const h = engine.projectHealth(docs, projectId, today) || {};
    const status = ({ red: 'red', amber: 'amber', green: 'green', r: 'red', a: 'amber', g: 'green' })[String(h.rag || h.status || '').toLowerCase()] || 'grey';
    const reasons = (Array.isArray(h.reasons) ? h.reasons : []).map(x => (typeof x === 'string' ? x : (x && (x.text || x.label)) || '')).filter(Boolean);
    return { status, reasons: reasons.length ? reasons : [status === 'grey' ? 'no work is planned yet' : 'nothing threatens the target date'], bufferDays, source: 'projectHealth' };
  }
  return ragOf(facts);
}
/* R6: earned value from engine.earnedValue(docs, prj, today); keys normalised to lower case. */
function evOf(docs, projectId, today, engine, project) {
  let raw = null;
  if (engine && typeof engine.earnedValue === 'function') { try { raw = engine.earnedValue(docs, projectId, today); } catch (e) { raw = null; } }
  if (!raw || typeof raw !== 'object') raw = localEarnedValue(docs, projectId, today, project);
  if (!raw) return null;
  const pick = k => { const hit = Object.keys(raw).find(x => x.toLowerCase() === k); const v = hit != null ? Number(raw[hit]) : NaN; return isFinite(v) ? v : null; };
  const r2 = v => (v == null ? null : Math.round(v * 100) / 100), r0 = v => (v == null ? null : Math.round(v));
  const out = { pv: r0(pick('pv')), ev: r0(pick('ev')), ac: r0(pick('ac')), spi: r2(pick('spi')), cpi: r2(pick('cpi')), eac: r0(pick('eac')), bac: r0(pick('bac')) };
  if (out.bac == null && project.budget && Number(project.budget.planned) > 0) out.bac = Math.round(Number(project.budget.planned));
  return out;
}
/* Used only when the engine has no earnedValue: BAC = planned budget (else planned cost); PV/EV by effort; AC = logged hours x dayRate / 8. */
function localEarnedValue(docs, projectId, today, project) {
  const work = list(docs, 'workItem').filter(w => w.projectId === projectId);
  if (!work.length) return null;
  const rate = Object.fromEntries(list(docs, 'person').map(p => [p.id, Number(p.dayRate) > 0 ? Number(p.dayRate) : 800]));
  const eff = w => (Number(w.effortDays) > 0 ? Number(w.effortDays) : 1);
  const cost = w => eff(w) * (rate[w.owner] || 800);
  const total = work.reduce((a, w) => a + cost(w), 0);
  const bac = project.budget && Number(project.budget.planned) > 0 ? Number(project.budget.planned) : total;
  const share = w => (total ? cost(w) / total : 0);
  const pv = bac * work.filter(w => w.due && w.due <= today).reduce((a, w) => a + share(w), 0);
  const ev = bac * work.filter(w => w.status === 'done').reduce((a, w) => a + share(w), 0);
  const ac = work.reduce((a, w) => a + (Array.isArray(w.time) ? w.time : []).reduce((b, t) => b + (Number(t.hours) || 0) * (rate[t.by || w.owner] || 800) / 8, 0), 0);
  const cpi = ac ? ev / ac : null;
  return { pv, ev, ac, spi: pv ? ev / pv : null, cpi, eac: cpi ? bac / cpi : null, bac };
}
/* R6: hypercare (live projects only): days remaining, owner, open incidents; an open sev-1 suggests rollback. */
function hypercareOf(project, today, L) {
  if (project.status !== 'live') return null;
  const c = project.cutover || {};
  const days = Number(c.hypercareDays) > 0 ? Number(c.hypercareDays) : null;
  const start = String(project.liveAt || today).slice(0, 10);
  const remaining = days != null ? Math.max(0, days - dayDiff(start, today)) : null;
  const open = (Array.isArray(project.incidents) ? project.incidents : []).filter(i => i && !['closed', 'resolved'].includes(String(i.status || 'open').toLowerCase()))
    .map(i => ({ title: String(i.title || 'Untitled incident'), severity: Number(i.severity) || 3, at: i.at || null, by: i.by ? L.person(i.by) : null }))
    .sort((a, b) => a.severity - b.severity);
  return { owner: c.hypercareOwner ? L.person(c.hypercareOwner) : null, days, daysRemaining: remaining, liveSince: start, open, considerRollback: open.some(i => i.severity === 1) };
}

const plural = (n, word, pl) => `${n} ${n === 1 ? word : (pl || word + 's')}`;
const dayDiff = (a, b) => Math.round((Date.parse(String(b).slice(0, 10) + 'T12:00:00Z') - Date.parse(String(a).slice(0, 10) + 'T12:00:00Z')) / 86400000);

/* R6 rule (used only when the engine has no projectHealth): Red only if the forecast finish is after the target or missing data
   has no plan; Amber if any item is late (finish still meets target) or buffer is under 5 business days; Green otherwise. */
function ragOf(f) {
  const s = f.stats || {}, reasons = [];
  if (!s.total) return { status: 'grey', reasons: ['no work is planned yet'], bufferDays: null };
  const late = (f.atRisk || []).filter(w => w.sched === 'late').length || s.late || 0;
  const finish = s.actualFinish || s.finish, target = f.project.target;
  const buffer = finish && target ? dayDiff(String(finish).slice(0, 10), target) : null;
  const bizBuffer = finish && target ? businessDaysBetween(String(finish).slice(0, 10), target) : null;
  const unplanned = (f.notLive || []).filter(b => b.state === 'missing' && !b.resolver);
  if (buffer != null && buffer < 0) reasons.push(`the forecast finish is ${plural(-buffer, 'day')} after target`);
  if (unplanned.length) reasons.push(`${plural(unplanned.length, 'missing data element')} ${unplanned.length === 1 ? 'has' : 'have'} no plan`);
  if (reasons.length) return { status: 'red', reasons, bufferDays: buffer };
  if (late) reasons.push(`${plural(late, 'work item')} ${late === 1 ? 'is' : 'are'} late, but the finish still meets the target`);
  if (bizBuffer != null && bizBuffer < 5) reasons.push(`there ${bizBuffer === 1 ? 'is' : 'are'} only ${plural(bizBuffer, 'business day')} of buffer before target`);
  if (reasons.length) return { status: 'amber', reasons, bufferDays: buffer };
  return { status: 'green', reasons: [buffer != null ? `there ${buffer === 1 ? 'is' : 'are'} ${plural(buffer, 'day')} of buffer and nothing is late` : 'nothing is late'], bufferDays: buffer };
}
function businessDaysBetween(a, b) {
  let n = 0, d = Date.parse(a + 'T12:00:00Z'); const end = Date.parse(b + 'T12:00:00Z');
  if (!isFinite(d) || !isFinite(end)) return null;
  const sign = end >= d ? 1 : -1;
  while (sign > 0 ? d < end : d > end) { d += sign * 86400000; const w = new Date(d).getUTCDay(); if (w !== 0 && w !== 6) n += sign; }
  return n;
}
const RAG_WORD = { red: 'Red', amber: 'Amber', green: 'Green', grey: 'Not planned' };
const RAG_PHRASE = { red: 'off track', amber: 'at risk', green: 'on track', grey: 'not planned yet' };

const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
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
const notLiveN = f => (f.notLive || f.blockers || []).length;
/* R5: email-draft recipients = project resources as first.last@northwind.example (fictional domain) */
function recipientsOf(docs, project) {
  const people = Object.fromEntries(list(docs, 'person').map(p => [p.id, p]));
  return [...new Set(project.resources || [])].map(id => people[id]).filter(Boolean).map(p => ({ name: p.name,
    email: p.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s-]/g, '').trim().split(/\s+/).join('.') + '@northwind.example' }));
}
function statusRules(f) {
  const s = f.stats || {};
  const rag = f.rag || ragOf(f);
  const finish = s.finish ? `forecast finish ${fd(s.finish)}` : 'no forecast yet';
  const ev = f.earnedValue, hc = f.hypercare;
  const lc = t => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
  const evLine = ev && (ev.spi != null || ev.cpi != null)
    ? `Earned value: schedule performance (SPI) ${ev.spi != null ? ev.spi.toFixed(2) : 'n/a'}, cost performance (CPI) ${ev.cpi != null ? ev.cpi.toFixed(2) : 'n/a'}` +
      (ev.ac != null && ev.ev != null ? `; ${money(ev.ev)} of work earned for ${money(ev.ac)} spent` : '') + (ev.eac != null ? `; estimate at completion ${money(ev.eac)}` : '') +
      (ev.bac != null ? ` against a ${money(ev.bac)} budget` : '') : null;
  const hcLine = hc ? `Hypercare: ${hc.daysRemaining != null ? `${plural(hc.daysRemaining, 'day')} left` : 'in progress'}${hc.owner ? `, owner ${hc.owner}` : ''}; ${plural(hc.open.length, 'open incident')}` : null;
  return {
    rag: rag.status,
    headline: `${RAG_WORD[rag.status]}: ${f.project.name} is ${RAG_PHRASE[rag.status]}, ${s.pct || 0}% done, ${finish} vs target ${fd(f.project.target)}`,
    summary: `Status is ${RAG_WORD[rag.status]} because ${rag.reasons.map(lc).join('; ')}. ${s.done || 0} of ${s.total || 0} work items are done; ${finish} against a target of ${fd(f.project.target)}. ` +
      `${lateSlip(f)} ${plural(notLiveN(f), 'data element')} ${notLiveN(f) === 1 ? 'is' : 'are'} not yet live.` + (evLine ? ` ${evLine}.` : '') + (hcLine ? ` ${hcLine}.` : ''),
    highlights: [`${s.done || 0} of ${plural(s.total || 0, 'work item')} complete`]
      .concat(f.readiness ? [f.readiness.pass ? 'Go-live gate passes' : `Go-live gate: ${plural(f.readiness.failing.length, 'check')} open`] : [])
      .concat(evLine ? [evLine] : []).concat(hcLine ? [hcLine] : []),
    risks: (hc ? hc.open.map(i => `Severity ${i.severity} incident "${i.title}" is open${i.severity === 1 ? ': consider rollback' : ''}`) : [])
      .concat((f.atRisk || []).map(atRiskLine))
      .concat((f.risks || []).filter(r => r.impact === 'high' && !r.likelyMitigated).map(r => `${r.title} (impact ${r.impact}, likelihood ${r.likelihood}, owner ${r.owner})`))
      .concat((f.risks || []).filter(r => r.likelyMitigated).map(r => `${r.title}: all linked work is done, so it is likely mitigated. ${r.owner}: confirm and close.`)),
    asks: (f.blockers || []).map(b => b.state === 'pending'
        ? `${b.owner}: confirm ${b.name} is live (the fix is done and awaits your confirmation)`
        : `${b.owner}: make ${b.name} available${b.resolver ? ` by finishing "${b.resolver}"` : ''}`)
      .concat((f.notLive || []).filter(b => b.state === 'example').map(b => `${b.owner}: provide a live source for ${b.name} (examples only today)`))
      .concat((f.openDiscovered || []).map(x => `Resolve the discovered requirement on ${x.data}: ${x.requirement}`))
      .concat((f.pendingGrants || []).map(g => `Decide on ${String(g.env).toUpperCase()} ${g.access} access to ${g.data} requested by ${g.requestedBy}`))
      .concat(hc && hc.considerRollback ? [`${hc.owner || 'Hypercare owner'}: a severity 1 incident is open; decide whether to roll back`] : []),
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
/* R6: a title never keeps "()" or a lone parenthesis (left over when a condition is split out of "(if over $5,000)") */
function tidy(t) {
  let x = String(t || '');
  for (let i = 0; i < 3; i++) x = x.replace(/\(\s*[^()\w$%]*\s*\)/g, ' ');
  const chars = Array.from(x), open = [], drop = new Set();
  chars.forEach((c, i) => { if (c === '(') open.push(i); else if (c === ')') { if (open.length) open.pop(); else drop.add(i); } });
  open.forEach(i => drop.add(i));
  x = chars.filter((c, i) => !drop.has(i)).join('');
  return x.replace(/\s+([,.;:?!])/g, '$1').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s{2,}/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').trim();
}
/* R6: data is proposed only for a document, record or field noun phrase ("expense report", "employee bank details",
   "record of deliveries"), never for a role doing something ("Receiving clerk records the delivery"). */
const DOC_HEAD = /^(forms?|invoices?|receipts?|reports?|statements?|certificates?|ids?|numbers?|details|records?|documents?|letters?|contracts?|agreements?|applications?|timesheets?)$/;
const ROLE_WORD = /^(clerks?|managers?|analysts?|officers?|teams?|leads?|specialists?|supervisors?|approvers?|owners?|staff|directors?|buyers?|agents?|administrators?|admins?|coordinators?|accountants?|controllers?|requesters?|requestors?|reviewers?|treasurers?|engineers?|partners?|assistants?|associates?|representatives?|reps?|heads?|employees?|contractors?|vendors?|suppliers?|customers?|users?|hr|it|ap|ar|finance|procurement|treasury|compliance|payable|receivable|department|desk)$/i;
const VERBISH_HEAD = /^(forms?|reports?|records?|documents?|contracts?|numbers?|letters?|files?|statements?|applications?)$/;
const NOUNISH = /^(request|review|purchase|change|check|schedule|export|import|issue|post|order|payment|expense|update)$/;
const DET = /^(the|a|an|this|that|these|those|each|every|all|its|their|his|her|our|your|it|them|any|some|one|both)$/i;
const ADJ_STOP = /^(first|next|last|new|approved|signed|secure|completed|final|original|initial|updated|current|same|relevant|required|itemized|scanned|monthly|weekly|quarterly|annual|correct|valid|full|complete|missing|received|submitted|attached|uploaded)$/i;
/* a proposal name is acceptable only if it is a document/record/field noun phrase */
function isDocName(name) {
  const w = String(name).toLowerCase().replace(/[^a-z0-9&/' -]+/g, ' ').trim().split(/\s+/);
  if (w[0] === 'record' && w[1] === 'of' && w.length > 2) return true;
  if (w.length < 2 || !DOC_HEAD.test(w[w.length - 1])) return false;
  return docPhrases(name).length > 0 || !w.slice(0, -1).some(x => ROLE_WORD.test(x) && !/^(employees?|contractors?|vendors?|suppliers?|customers?)$/.test(x));
}
const ndKey = name => 'nd-' + String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
/* every document noun phrase in a line, e.g. "Contractor request form" (modifier + head, or "Record of X") */
function docPhrases(line, headRe) {
  const words = String(line).replace(/[^\w'&/-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const bare = w => w.toLowerCase().replace(/'s$/, '').replace(/'$/, '');
  const out = [];
  words.forEach((w, k) => {
    const head = bare(w);
    if (!DOC_HEAD.test(head) || (headRe && !headRe.test(head))) return;
    const next = words[k + 1] ? bare(words[k + 1]) : '';
    const prev = k > 0 ? bare(words[k - 1]) : '';
    if (/^records?$/.test(head) && next === 'of') {
      /* "record of deliveries" */
      const tail = [];
      for (let i = k + 2; i < words.length && tail.length < 3; i++) { const x = bare(words[i]); if (STOP.has(x) || DET.test(x) || VERBS.test(x) || /^(to|in|on|by|or|for|and|with)$/.test(x)) { if (tail.length) break; continue; } tail.push(x); }
      if (tail.length) out.push(cap('record of ' + tail.join(' ')));
      return;
    }
    /* a verb, not a noun: "clerk records the delivery", "manager reports it", "vendor forms a partnership" */
    if (!prev || DOC_HEAD.test(next)) return;            /* "timesheet record": the last noun is the head */
    if (VERBISH_HEAD.test(head) && (DET.test(next) || ROLE_WORD.test(prev))) return;
    const mods = [];
    for (let i = k - 1; i >= 0 && mods.length < 2; i--) {
      const x = bare(words[i]);
      if (STOP.has(x) || DET.test(x) || (VERBS.test(x) && !(NOUNISH.test(x) && i > 0)) || ADJ_STOP.test(x) || /^(a|an|of|to|in|on|by|or|is|be|at|as|with|before|after|against|through|via|using)$/.test(x)) break;
      if (ROLE_WORD.test(x) && !/^(employees?|contractors?|vendors?|suppliers?|customers?)$/.test(x)) break;
      if (/^\d/.test(x) || /[^a-z0-9&/-]/i.test(x)) break;
      mods.unshift(/^[A-Z]{2,4}s?$/.test(words[i]) ? words[i] : x);   /* keep acronyms: PO, W-9, ERP */
    }
    if (!mods.length) return;
    out.push(cap(mods.concat([head === 'id' || head === 'ids' ? 'ID' : head]).join(' ')));
  });
  return [...new Set(out)];
}
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
  const newData = [], existing = new Set(dataEls.map(d => String(d.name).toLowerCase()));
  /* R6: every proposal has a stable key and lists the steps that need it; the step carries {key, name} in newData */
  const propose = (name, reason, node) => {
    name = tidy(name);
    if (!name || existing.has(name.toLowerCase())) return;
    const key = ndKey(name);
    let p = newData.find(x => x.key === key);
    if (!p) { if (newData.length >= 15) return; p = { key, name, reason, steps: [] }; newData.push(p); }
    if (node && node.id) {
      if (!p.steps.includes(node.id)) p.steps.push(node.id);
      const nd = node.newData || (node.newData = []);
      if (!nd.some(x => x.key === key)) nd.push({ key, name: p.name });
    }
  };
  const linkData = (line, node) => {
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
          /* only a document/record/field phrase is proposed; a shared word in a role phrase is not data */
          const nm = docPhrases(line).find(ph => shared.some(t => tokens(ph).includes(t)));
          const src = /\bfrom\s+(?:the\s+)?([A-Z][\w-]+)/.exec(line);
          if (nm) propose(nm, `Mentioned in "${clip(line, 80)}"${src ? ` (source: ${src[1]})` : ''}. "${d.name}" shares words but is ${elDomain[d.id] || 'other'} data, not ${lineDomain || 'the same domain'}, so it was not linked.`, node);
        }
      }
    }
    if (!hits.length) {
      const src = /\bfrom\s+(?:the\s+)?([A-Z][\w-]+)/.exec(line);
      docPhrases(line).forEach(nm => propose(nm, `Mentioned in "${clip(line, 80)}"${src ? ` (source: ${src[1]})` : ''}; no existing data element matches.`, node));
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
    const n = { id: 's' + (++seq), type: 'step', title: cap(tidy(title.replace(/\s+/g, ' ').trim().replace(/[.;:,]$/, ''))) };
    const o = ownerOf(line); if (o) n.owner = o;
    const d = linkData(line, n); if (d.length) n.data = d;
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
    let c = tidy(cond).replace(/[.;?]$/, '').replace(/^(?:if|when|unless)\s+/i, '').trim();
    if (/^(over|above|under|below|more than|greater than|less than|exceeds?)\b/i.test(c)) c = 'amount ' + c;
    return cap(tidy(c)).replace(/[.;?]$/, '') + '?';
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
    /* R5: "…; otherwise …" and "…, otherwise …" start their own clause so they reach the No branch */
    const sentences = body.split(/(?<=[.;!])\s+(?=[A-Z(])|;\s*(?=(?:otherwise|else|if not)\b)|,\s*(?=otherwise\b)/i).map(x => x.trim()).filter(x => x.length >= 3);
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
    if (m) { trigger = cap(tidy(m[m.length - 1].replace(/[.;]$/, '').trim())) || 'Process starts'; break; }
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
      const sub = { title: cap(tidy(body.replace(/[.;]$/, ''))), data: linkData(body, last) };
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
  /* R6: proposals are document/record/field noun phrases only, each with a stable key */
  const existing = new Set(list(docs, 'dataElement').map(d => String(d.name).toLowerCase()));
  const props = [];
  (Array.isArray(out && out.newData) ? out.newData : []).forEach(x => {
    const name = x && typeof x.name === 'string' ? tidy(x.name).slice(0, 80) : '';
    if (!name || !isDocName(name) || existing.has(name.toLowerCase()) || props.length >= 15) return;
    const key = ndKey(name);
    if (props.some(p => p.key === key)) return;
    props.push({ key, name, reason: typeof x.reason === 'string' ? x.reason.slice(0, 300) : '', steps: [] });
  });
  const tagNew = (node, raw) => {
    const names = (Array.isArray(raw && raw.newData) ? raw.newData : []).map(v => (typeof v === 'string' ? v : v && v.name) || '').filter(Boolean);
    const hits = props.filter(p => names.some(nm => ndKey(nm) === p.key));
    if (!hits.length) return;
    node.newData = hits.map(p => ({ key: p.key, name: p.name }));
    hits.forEach(p => { if (!p.steps.includes(node.id)) p.steps.push(node.id); });
  };
  const cleanNode = (n, depth) => {
    if (!n || typeof n.title !== 'string' || !n.title.trim()) return null;
    if (n.type === 'trigger' && depth === 0) return { id: idFor(n, 'k'), type: 'trigger', title: (tidy(n.title) || 'Process starts').slice(0, 300) };
    if ((n.type === 'decision' || n.type === 'parallel') && depth === 0 && Array.isArray(n.branches)) {
      const g = { id: idFor(n, n.type === 'parallel' ? 'p' : 'd'), type: n.type, title: (tidy(n.title) || (n.type === 'parallel' ? 'In parallel' : 'Decision?')).slice(0, 300) };
      g.branches = n.branches.slice(0, 4).map(b => {
        const br = { label: String((b && b.label) || '').slice(0, 30) || 'Branch',
          nodes: (Array.isArray(b && b.nodes) ? b.nodes : []).slice(0, 10).map(x => cleanNode(x, 1)).filter(Boolean) };
        if (b && typeof b.goto === 'string') { br.goto = b.goto; gotos.push(br); }
        return br;
      });
      return g;
    }
    const title = tidy(n.title);
    if (!title) return null;
    const node = { id: idFor(n, 's'), type: 'step', title: title.slice(0, 300) };
    if (typeof n.owner === 'string' && peopleIds.has(n.owner)) node.owner = n.owner;
    const data = cleanData(n.data); if (data.length) node.data = data;
    const touches = strArr(n.touches, 4).map(x => x.slice(0, 40)); if (touches.length) node.touches = touches;
    if (typeof n.system === 'string' && n.system.trim()) node.system = n.system.trim().slice(0, 40);
    const subs = (Array.isArray(n.subs) ? n.subs : []).filter(x => x && typeof x.title === 'string' && x.title.trim()).slice(0, 12)
      .map(x => ({ title: (tidy(x.title) || x.title.trim()).slice(0, 300), data: cleanData(x.data) }));
    if (subs.length) node.subs = subs;
    tagNew(node, n);
    return node;
  };
  const nodes = (Array.isArray(out && out.nodes) ? out.nodes : []).slice(0, 40).map(n => cleanNode(n, 0)).filter(Boolean);
  gotos.forEach(b => { if (!used.has(b.goto)) delete b.goto; });   /* drop loop-backs to unknown steps */
  return { nodes, newData: props, notes: typeof (out && out.notes) === 'string' ? out.notes.slice(0, 600) : '' };
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
    const recipients = recipientsOf(docs, list(docs, 'project').find(p => p.id === projectId));
    const fallback = Object.assign(L.scrub(statusRules(facts)), { recipients });
    if (!configured()) return { status: 200, body: Object.assign(fallback, { source: 'rules', facts }) };
    try {
      const out = await chat(RULES + ' Write a concise project status report for executives. Return ' +
        '{"headline": string, "summary": string (2-3 sentences), "highlights": [string], "risks": [string], "asks": [string]}. ' +
        'Refer to work, data and people only by the names and titles given; never output identifiers. ' +
        'The headline MUST start with the supplied rag status word (Red, Amber or Green) and must not contradict it. ' +
        'Risks marked likelyMitigated go in risks as "likely mitigated, confirm and close". The rag reasons are the only reasons for the status: do not call the project off track or red for any other reason. ' +
        'Mention earnedValue (SPI and CPI) when supplied, and when hypercare is supplied report days remaining and open incidents; an open severity 1 incident means "consider rollback".',
        JSON.stringify(facts), 900);
      if (typeof out.headline !== 'string' || typeof out.summary !== 'string') throw new Error('shape');
      /* the headline must agree with the computed RAG (R3) */
      const want = facts.rag.status, other = Object.keys(RAG_WORD).filter(k => k !== want);
      const conflicts = other.some(k => new RegExp('\\b(' + RAG_WORD[k] + '|' + RAG_PHRASE[k] + ')\\b', 'i').test(out.headline));
      out.headline = conflicts ? fallback.headline : (new RegExp('^' + RAG_WORD[want] + '\\b').test(out.headline) ? out.headline : `${RAG_WORD[want]}: ${out.headline}`);
      return { status: 200, body: Object.assign(L.scrub({ headline: out.headline.slice(0, 200), summary: out.summary.slice(0, 1200),
        highlights: strArr(out.highlights), risks: strArr(out.risks), asks: strArr(out.asks) }), { rag: facts.rag.status, recipients, source: 'ai', facts }) };
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
