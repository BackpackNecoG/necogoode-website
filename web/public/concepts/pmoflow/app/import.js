/* PMOFlow import module (R10 stream S2): the one place that turns outside material into a process map.
   UMD: require('./pmoflow-import') in Node, window.PMOImport in the browser. The web copy at
   web/public/concepts/pmoflow/app/import.js is byte-identical.

   - parseSop(text)         pasted procedure -> draft {nodes, newData, notes, trigger, teams, name}
                            one numbered or bulleted line is one step; sub-clauses stay in that step's note;
                            roles only from a known role noun or a "Role (Name)" pattern; nothing is linked to
                            workspace people or data (demo-data isolation: the parser is never given them).
   - sopRules(text, docs)   the API's rules fallback (pmoflow-ai.js run()); docs are ignored on purpose.
   - unzip(bytes)           minimal ZIP reader (stored + deflate) -> Promise<{name: Uint8Array}>
   - parseXml(text)         small XML tree parser (no DTD), enough for Visio and BPMN
   - parseVsdx(bytes)       Visio .vsdx -> Promise<{name, nodes, lanes, links, steps, decisions, parallels, dropped, bpmn}>
                            bpmn is BPMN 2.0 XML, so the app shows the same preview it shows for a BPMN file
   - TEMPLATES, templateDraft(id)  six generic, editable starter maps (fictional, no workspace links)
   - RACI_ROLES, raciOf(node), raciText(node, nameOf)  optional Accountable / Consulted / Informed per step
   - durationInfo(text)     "2 business days" -> {text, n, unit, businessDays, iso}
   - wordsCount(nodes)      {steps, waits, messages, decisions, parallels} counted the same way everywhere */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (typeof window !== 'undefined' ? window : root).PMOImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- text helpers */
  const cap = t => { const s = String(t || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
  const squash = t => String(t || '').replace(/\s+/g, ' ').trim();
  const stripEnd = t => squash(t).replace(/[\s.;:,]+$/, '');
  /* drop an empty "()" and unbalanced brackets left after a clause moved out */
  function tidy(t) {
    let x = String(t || '');
    for (let i = 0; i < 3; i++) x = x.replace(/\(\s*[^()\w$%]*\s*\)/g, ' ');
    const chars = Array.from(x), open = [], drop = new Set();
    chars.forEach((c, i) => { if (c === '(') open.push(i); else if (c === ')') { if (open.length) open.pop(); else drop.add(i); } });
    open.forEach(i => drop.add(i));
    x = chars.filter((c, i) => !drop.has(i)).join('');
    return x.replace(/\s+([,.;:?!])/g, '$1').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s{2,}/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').trim();
  }
  const plural = (n, w, pl) => `${n} ${n === 1 ? w : (pl || w + 's')}`;
  const singularKey = k => String(k).replace(/([a-z]{3}[^s\W])s$/, '$1');
  const ndKey = name => 'nd-' + String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  /* ---------------------------------------------------------------- vocabulary */
  /* role nouns: the last word of an actor phrase must be one of these (or the phrase is a team name) */
  const ROLE_NOUNS = new Set(('clerk manager coordinator officer analyst lead specialist supervisor director controller buyer requester requestor ' +
    'reviewer approver administrator admin accountant assistant agent team staff technician engineer employee contractor vendor supplier ' +
    'customer client owner partner representative rep head sme associate executive president vp cfo ceo cio cto coo hire newhire recruiter ' +
    'planner scheduler dispatcher driver courier receptionist nurse teacher auditor counsel attorney paralegal treasurer cashier steward ' +
    'desk department committee board panel group unit office function sponsor champion user member worker personnel ' +
    /* R12: inline abbreviations ("Purchasing mgr", "Credit dept"); canonRole spells them out */
    'mgr dept dir coord asst supv supvr spec').split(' '));
  const ROLE_ABBR = { mgr: 'manager', dept: 'department', dir: 'director', coord: 'coordinator', asst: 'assistant', supv: 'supervisor', supvr: 'supervisor', spec: 'specialist' };
  /* team / department names: an actor on its own ("Procurement creates") and what fills "Teams involved" */
  const TEAMS = ['Accounts Payable', 'Accounts Receivable', 'Customer Service', 'Human Resources', 'Information Technology', 'Supply Chain', 'Service Desk', 'Help Desk',
    'Procurement', 'Purchasing', 'Compliance', 'Treasury', 'Finance', 'Legal', 'Facilities', 'Payroll', 'Security', 'Operations', 'Sales', 'Marketing',
    'Support', 'Tax', 'Audit', 'Risk', 'Receiving', 'Shipping', 'Warehouse', 'Logistics', 'Quality', 'Engineering', 'Benefits', 'Training', 'Accounting',
    'Billing', 'Credit', 'Collections', 'Reception', 'Admissions', 'Records', 'HR', 'IT', 'AP', 'AR', 'QA', 'PMO'];
  const TEAM_RE = new RegExp('\\b(' + TEAMS.map(t => t.replace(/\s+/g, '\\s+')).join('|') + ')\\b', 'g');
  const TEAM_SET = new Set(TEAMS.map(t => t.toLowerCase()));
  const TEAM_CANON = Object.fromEntries(TEAMS.map(t => [t.toLowerCase(), t]));
  const isTeam = w => TEAM_SET.has(String(w || '').toLowerCase().replace(/\s+/g, ' '));
  /* "Credit/Finance", "AP/AR": every part of a slashed actor is a role noun or a team */
  const roleNoun = w => { if (/\w\/\w/.test(String(w || ''))) return String(w).split('/').every(x => x && roleNoun(x)); const x = String(w || '').toLowerCase().replace(/[^a-z-]/g, ''); return ROLE_NOUNS.has(x) || ROLE_NOUNS.has(x.replace(/s$/, '')) || ROLE_NOUNS.has(x.replace(/ies$/, 'y')) || isTeam(x); };
  const DET = /^(the|a|an|our|your|their|its|this|that|these|those|each|every|any|all|both)$/i;
  const PREP = /^(to|in|into|on|onto|at|by|for|from|with|via|of|about|against|through|under|over|after|before|within|without|per|as|than)$/i;
  /* base verbs a step can start with (imperative) or that an actor's third-person verb reduces to */
  const VERBS = new Set(('accept acknowledge add activate allocate amend announce answer approve archive arrange ask assess assign attach audit authorise authorize ' +
    'back bill book brief build calculate call cancel capture certify chase check choose clear close code collect communicate compare complete compute configure confirm contact ' +
    'convert copy correct countersign count create credit deactivate decide decline define delete deliver deny deploy deprovision destroy determine disable dispatch distribute ' +
    'do download draft edit email enable enroll enrol enter equip escalate estimate evaluate export extend fax file fill finalise finalize finish fix follow forward ' +
    'gather generate get give grant hand handle hire hold import inform initiate inspect install interview investigate invite invoice issue keep key label launch load lock log lodge look ' +
    'mail maintain make map match migrate monitor move negotiate notify obtain offboard onboard open order pack pass pay perform pick place post prepare print process ' +
    'provision publish pull purchase push quote raise read receive recommend reconcile record recover refund register reject release remind remove renew reopen repair reply report request ' +
    'reserve reset resolve respond resubmit retain retrieve return revoke review route run save scan schedule screen select send set settle share ship sign sort source ' +
    'start stamp store submit sync take tell terminate test track train transfer triage unlock update upload validate verify welcome witness write').split(' '));
  /* "approves" -> "approve", "applies" -> "apply", "co-approves" -> "co-approve"; null when not a known verb's 3rd-person form */
  function verbBase(w) {
    const raw = String(w || '');
    const h = /^([a-z]+-)(.+)$/i.exec(raw);
    if (h) { const b = verbBase(h[2]) || (VERBS.has(h[2].toLowerCase()) ? h[2].toLowerCase() : null); return b ? h[1].toLowerCase() + b : null; }
    const x = raw.toLowerCase();
    if (!/^[a-z]+s$/.test(x) || /(ss|us|is)$/.test(x)) return null;
    const cands = [x.replace(/ies$/, 'y'), x.replace(/(ch|sh|x|zz|o|ss)es$/, '$1'), x.slice(0, -1)];
    return cands.find(c => c !== x && VERBS.has(c)) || null;
  }
  const isBase = w => { const x = String(w || '').toLowerCase(); const h = /^[a-z]+-(.+)$/.exec(x); return VERBS.has(x) || !!(h && VERBS.has(h[1])); };
  const MODAL = /^(must|should|will|shall|can|may|might|needs?|has|have|also|then|now|first|always|usually|promptly|immediately)$/i;
  /* R11 G2: about 60 common business systems (ERP, CRM, HR, finance, ITSM, documents, messaging). A system is the step's
     system, never a role, a team or a piece of information. Longest names first so "SAP Ariba" wins over "SAP". */
  const SYSTEMS = ['ServiceNow', 'HRIS', 'ERP', 'CRM', 'Workday', 'SAP', 'SAP Ariba', 'SuccessFactors', 'Oracle', 'Oracle Fusion', 'NetSuite', 'PeopleSoft',
    'JD Edwards', 'Epicor', 'Infor', 'Sage Intacct', 'Sage', 'QuickBooks', 'Xero', 'Dynamics 365', 'Dynamics', 'Business Central', 'Concur', 'Coupa', 'Ariba',
    'Jaggaer', 'Tipalti', 'AvidXchange', 'Bill.com', 'Expensify', 'Navan', 'BlackLine', 'Kyriba', 'Workiva', 'Avalara', 'Vertex', 'Dun & Bradstreet', 'D&B',
    'Salesforce', 'HubSpot', 'Zoho', 'Pipedrive', 'Marketo', 'Zendesk', 'Freshdesk', 'Freshservice', 'Jira Service Management', 'Jira', 'Confluence',
    'ADP', 'Paychex', 'Gusto', 'UKG', 'BambooHR', 'Greenhouse', 'iCIMS', 'Taleo', 'DocuSign', 'Adobe Sign', 'Ironclad', 'Icertis', 'SharePoint', 'OneDrive',
    'Google Drive', 'Smartsheet', 'Microsoft Teams', 'Slack', 'Outlook', 'Gmail', 'Excel', 'Power BI', 'Tableau', 'Okta', 'Active Directory', 'Entra ID', 'Azure AD',
    'Stripe', 'Shopify'];
  const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s*&\s*/g, '\\s*&\\s*').replace(/\s+/g, '\\s+');
  const SYS_SRC = '(?<![\\w&])(' + SYSTEMS.slice().sort((a, b) => b.length - a.length).map(reEsc).join('|') + '|(?<=\\b(?:in|on|via|over|through|using)\\s+)Teams)(?![\\w&])';
  const SYS_RE = new RegExp(SYS_SRC);
  const SYS_RE_G = new RegExp(SYS_SRC, 'g');
  /* the canonical spelling of the first system a line names ("dun & bradstreet" is never matched: names are case-sensitive) */
  function systemIn(t) {
    const m = SYS_RE.exec(String(t || '')); if (!m) return '';
    const x = m[1].replace(/\s+/g, ' ').replace(/\s*&\s*/g, ' & ').replace(/^D & B$/, 'D&B');
    return x === 'Teams' ? 'Microsoft Teams' : x;
  }
  /* text with every system name replaced by a comma, so a system never becomes (part of) an information name */
  const withoutSystems = t => String(t || '').replace(SYS_RE_G, ' , ');

  /* ---------------------------------------------------------------- actor */
  /* {actor, action, name?} from one clause. An actor is a role phrase that ends in a role noun, a team name, a list of
     those joined by "and", or a "Role (Name)" pattern. Anything else (an imperative, a passive) has no actor. */
  function splitActor(text) {
    const t = squash(text);
    /* "HR Manager (Pat Lee) updates the record" */
    const rn = /^(?:the\s+)?((?:[A-Za-z][\w&/-]*\s+){0,3}[A-Za-z][\w&/-]*)\s*\(([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,2})\)\s+(\S+)\s*(.*)$/.exec(t);
    /* R16 (Karen): "Karen (Operations Director) approves too": the name first, the role in brackets */
    const nr = /^([A-Z][a-z'’-]+(?:\s+[A-Z][\w'’-]+){0,2})\s*\(([^()]{2,40})\)\s+(\S+)\s*(.*)$/.exec(t);
    if (nr && looksName(nr[1]) && looksRole(nr[2])) {
      const v = verbBase(nr[3]) || (isBase(nr[3]) ? nr[3].toLowerCase() : null);
      if (v) return { actor: canonRole(nr[2]), name: nr[1], action: imperative(v, nr[4]) };
    }
    if (rn && roleWords(rn[1].split(/\s+/)) && !(looksName(rn[1]) && looksRole(rn[2]))) {
      let v = verbBase(rn[3]) || (isBase(rn[3]) ? rn[3].toLowerCase() : null), rest = rn[4];
      /* R15: "Controller (Sam Wu) must sign off …" */
      if (!v && MODAL.test(rn[3])) {
        const ws = String(rn[4] || '').split(' ');
        let j = 0; while (j < ws.length && (MODAL.test(ws[j]) || /^to$/i.test(ws[j]))) j++;
        if (ws[j] && isBase(ws[j])) { v = ws[j].toLowerCase(); rest = ws.slice(j + 1).join(' '); }
      }
      if (v) return { actor: canonRole(rn[1]), name: rn[2], action: imperative(v, rest) };
    }
    /* "Pat Lee approves the request": a person's name as written (kept as text, never matched to workspace people) */
    const pn = /^([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){1,2})\s+(\S+)\s*(.*)$/.exec(t);
    if (pn && !pn[1].split(' ').some(w => roleNoun(w) || isTeam(w))) {
      const v = verbBase(pn[2].replace(/[,;:]$/, ''));
      if (v) return { actor: pn[1], action: imperative(v, pn[3]) };
    }
    /* R12: "Karen approves too": one capitalised first name and a known verb (never a team, role, system or sentence word) */
    const p1 = /^([A-Z][a-z]{2,})\s+(\S+)\s*(.*)$/.exec(t);
    if (p1 && !roleNoun(p1[1]) && !isTeam(p1[1]) && !SYS_RE.test(p1[1]) && !isBase(p1[1]) && !verbBase(p1[1]) && !DET.test(p1[1]) && !MODAL.test(p1[1]) && !PREP.test(p1[1])
      && !/^(then|next|finally|first|please|someone|everyone|nobody|each|he|she|they|it|we|you|once|when|if|unless|where|after|before|while|otherwise|limits?|requests?|spend)$/i.test(p1[1])) {
      const v = verbBase(p1[2].replace(/[,;:]$/, ''));
      if (v) return { actor: p1[1], action: imperative(v, p1[3]) };
    }
    const words = t.split(' ');
    let i = 0;
    while (i < words.length && DET.test(words[i])) i++;
    /* R12: "Credit dept runs…" / "Credit reviews…" is the Credit team, not the verb "credit" */
    const teamLead = isTeam(words[0]) && words[1] && (roleNoun(words[1].replace(/[,;:]$/, '')) || verbBase(words[1].replace(/[,;:]$/, '')));
    if (i === 0 && words.length && !teamLead && (isBase(words[0]) || /^(please|then|next|finally|first)$/i.test(words[0]))) return { actor: null, action: t };
    for (let k = i + 1; k <= Math.min(words.length - 1, i + 5); k++) {
      const actorWords = words.slice(i, k).map(w => w.replace(/[,;:]$/, ''));
      if (actorWords.some(w => /[,;:]$/.test(w))) break;
      if (!roleWords(actorWords)) continue;
      const w = words[k].replace(/[,;:]$/, '');
      /* "Buyer gets the W-9" is an actor and a verb; "the request gets approved" is a passive */
      if (/^gets?$/i.test(w) && words[k + 1] && !/(ed|en)$/i.test(words[k + 1].replace(/[,;:.]$/, ''))) return { actor: canonRole(actorWords.join(' ')), action: imperative('get', words.slice(k + 1).join(' ')) };
      if (/^(is|are|was|were|be|been|gets?)$/i.test(w)) return { actor: null, action: t };
      let v = verbBase(w), restAt = k + 1;
      const plural = actorWords.some(a => /^(and|&)$/i.test(a)) || /s$/i.test(actorWords[actorWords.length - 1]) && !isTeam(actorWords[actorWords.length - 1]);
      if (!v && plural && isBase(w)) v = w.toLowerCase();
      if (!v && MODAL.test(w)) {
        let j = k + 1;
        while (j < words.length && MODAL.test(words[j]) || (j < words.length && /^to$/i.test(words[j]))) j++;
        if (j < words.length && isBase(words[j])) { v = words[j].toLowerCase(); restAt = j + 1; }
      }
      if (v) return { actor: canonRole(actorWords.join(' ')), action: imperative(v, words.slice(restAt).join(' ')) };
    }
    return { actor: null, action: t };
  }
  /* every actor word is a capitalised word, a role noun, a team, "and"/"&", or a lowercase modifier that is not a verb;
     the phrase ends in a role noun or a team */
  function roleWords(ws) {
    if (!ws.length || ws.length > 5) return false;
    const last = ws[ws.length - 1];
    if (!(roleNoun(last) || isTeam(ws.join(' ')) || isTeam(ws.slice(-2).join(' ')))) return false;
    if (/^(and|&)$/i.test(ws[0]) || /^(and|&)$/i.test(last)) return false;
    return ws.every(w => /^(and|&|of)$/i.test(w) || /^[A-Z]/.test(w) || roleNoun(w) || (/^[a-z][a-z-]*$/.test(w) && !isBase(w) && !verbBase(w) && !PREP.test(w) && !DET.test(w)));
  }
  /* "the procurement coordinator" -> "Procurement coordinator"; "accounts payable" -> "Accounts Payable" */
  function canonRole(r) {
    const x = squash(String(r).replace(/^(the|a|an|our|your|their)\s+/i, '')).split(' ').map(w => ROLE_ABBR[w.toLowerCase().replace(/\.$/, '')] || w).join(' ');
    if (isTeam(x)) return TEAM_CANON[x.toLowerCase().replace(/\s+/g, ' ')];
    return cap(x.split(' ').map((w, i) => /^[A-Z]{2,}$/.test(w) || (i > 0 && /^[A-Z]/.test(w)) || isTeam(w) ? (isTeam(w) ? TEAM_CANON[w.toLowerCase()] : w) : i ? w.toLowerCase() : w).join(' '));
  }
  /* "approve" + "the request and checks the date" -> "Approve the request and check the date" */
  function imperative(v, rest) {
    const r = String(rest || '').replace(/\b(and|or|then)\s+(?:also\s+)?([a-z][a-z-]*)\b/g, (m, c, w) => { const b = verbBase(w); return b ? `${c} ${b}` : m; });
    return cap(squash(v + (r ? ' ' + r : '')));
  }
  /* team names a line mentions (canonical spelling) */
  function teamsIn(t) {
    const out = []; let m; TEAM_RE.lastIndex = 0;
    while ((m = TEAM_RE.exec(String(t || '')))) { const c = TEAM_CANON[m[1].toLowerCase().replace(/\s+/g, ' ')]; if (c && !out.includes(c)) out.push(c); }
    /* "Accounts Payable" also matches "AP"-free text only; drop a short team inside a longer one already listed */
    return out.filter(x => !out.some(y => y !== x && y.toLowerCase().includes(x.toLowerCase()) && y.split(' ').length > 1 && x.split(' ').length === 1 && !/^(IT|HR|AP|AR)$/.test(x)));
  }
  /* the team a role belongs to: "Procurement coordinator" -> "Procurement"; a team role is itself */
  function teamOfRole(role) {
    if (!role) return [];
    if (isTeam(role)) return [TEAM_CANON[role.toLowerCase()]];
    return teamsIn(role);
  }

  /* ---------------------------------------------------------------- time limits and durations */
  const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14, thirty: 30 };
  const SLA_RE = /,?\s*\b(?:within|in no more than|no later than|in under|inside)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|thirty)\s+(business|working|calendar)?\s*(hours?|days?|weeks?)\b(?:\s+of\s+[a-z ]+?(?=[,.;]|$))?/i;
  function slaOf(t) {
    const m = SLA_RE.exec(t); if (!m) return null;
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMW[m[1].toLowerCase()];
    const kind = m[2] ? (m[2].toLowerCase() === 'calendar' ? '' : 'business ') : (/^day/i.test(m[3]) ? 'business ' : '');
    const unit = m[3].toLowerCase().replace(/s$/, '');
    return { sla: `${n} ${kind}${unit}${n === 1 ? '' : 's'}`, strip: m[0] };
  }
  /* "2 business days" -> {text, n: 2, unit: 'day', businessDays: 2, iso: 'P2D'}; "4 hours" -> PT4H; null when unreadable.
     Business days have no ISO 8601 unit: iso is the calendar-length fallback and businessDays carries the real meaning. */
  function durationInfo(text) {
    const t = String(text || '');
    const m = t.match(/(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|thirty)\s*(business\s+|working\s+|calendar\s+)?(minute|min|hour|hr|day|week|month)s?\b/i);
    if (!m) return null;
    const n = /^\d/.test(m[1]) ? Number(m[1]) : NUMW[m[1].toLowerCase()];
    const kind = (m[2] || '').trim().toLowerCase(), u = m[3].toLowerCase();
    const unit = u.startsWith('min') ? 'minute' : u.startsWith('h') ? 'hour' : u;
    const biz = unit === 'day' ? (kind === 'calendar' ? null : n) : unit === 'week' && kind !== 'calendar' ? n * 5 : null;
    const iso = unit === 'minute' ? `PT${n}M` : unit === 'hour' ? `PT${n}H` : unit === 'day' ? `P${n}D` : unit === 'week' ? `P${n}W` : `P${n}M`;
    return { text: `${n} ${kind && kind !== 'calendar' ? 'business ' : kind === 'calendar' ? 'calendar ' : unit === 'day' ? 'business ' : ''}${unit}${n === 1 ? '' : 's'}`, n, unit, businessDays: biz, iso };
  }

  /* ---------------------------------------------------------------- information (data elements) */
  const DOC_HEADS = /^(forms?|invoices?|receipts?|reports?|statements?|certificates?|ids?|numbers?|details|records?|documents?|letters?|contracts?|agreements?|applications?|timesheets?|packets?|lists?|results?|files?|addresses|address|names?|dates?|codes?|orders?|accounts?|policy|policies|badges?|checklists?|requests?|surveys?|quotes?|quotations?|summary|summaries|logs?|registers?|licen[cs]es?|permits?|paychecks?|payslips?|cards?|plans?|schedules?|masters?|limits?|history|histories|scores?|ratings?)$/i;
  /* R12 (Karen): document abbreviations a procedure uses as names */
  const DOC_ABBR = { COI: 'Certificate of insurance', NDA: 'NDA', MSA: 'MSA', SOW: 'Statement of work', BAA: 'BAA', 'W9': 'W-9' };
  const NOUNISH = /^(request|review|purchase|change|check|schedule|order|payment|expense|update|access|record|screening|approval|contact|delivery|return|transfer|release|exit|welcome|termination|refund|offer|onboarding|tax|credit|time|start|end|due|ship|bill)$/i;
  const OF_HEADS = /^(certificate|record|proof|copy|statement|letter|bill|notice|evidence|confirmation)s?$/i;
  const ADJ_STOP = /^(first|next|last|new|approved|signed|secure|completed|original|initial|updated|current|same|relevant|required|itemized|scanned|monthly|weekly|quarterly|annual|correct|valid|full|complete|missing|received|submitted|attached|uploaded|their|its|his|her|our|your|returned|known|listed|usual|main|registered|existing|official|verified|primary|preferred|same|other)$/i;
  const GENERIC_ALONE = /^(forms?|lists?|results?|files?|names?|dates?|codes?|orders?|accounts?|requests?|emails?|cards?|plans?|logs?|details|records?|documents?|numbers?|reports?|letters?|ids?|packets?|summary|schedules?|address|addresses|statements?|policy|surveys?|checklists?|badges?|registers?|masters?|limits?|history|histories|scores?|ratings?)$/i;
  const INFO_NOUNS = [
    { re: /\bamounts?\b/i, name: 'Amount' },
    { re: /\bcost cent(re|er)s?\b/i, name: m => 'Cost cent' + m[1].toLowerCase() },
    { re: /\bbudget codes?\b/i, name: 'Budget code' },
    { re: /\bquotes?\b|\bquotations?\b/i, name: 'Quotes' },
    { re: /\binvoices?\b/i, name: 'Invoice' },
    { re: /\breceipts?\b/i, name: 'Receipts' },
    { re: /\bpurchase orders?\b|\bPOs?\b(?!\s+(?:number|no\.?|#))/, name: 'Purchase order' },
  ];
  /* "COI" and "certificate of insurance", "SOW" and "statement of work": the abbreviation is the words' initials */
  function isAcronymOf(abbr, words) {
    const a = String(abbr || ''); if (!/^[A-Z]{2,6}s?$/.test(a)) return false;
    const x = a.replace(/s$/, '').toLowerCase(), ini = ws => ws.map(w => String(w).charAt(0).toLowerCase()).join('');
    return words.length >= 2 && (ini(words) === x || ini(words.filter(w => !/^(of|and|&|the|for)$/i.test(w))) === x);
  }
  /* every information noun phrase in a line, e.g. "Contractor request form", "W-9", "Certificate of insurance" */
  function infoPhrases(line) {
    const words = String(line).replace(/[“”"()]/g, ' ').replace(/[,;:.!?](?=\s|$)/g, ' , ').split(/\s+/).filter(Boolean);
    const bare = w => w.replace(/'s$/i, '').replace(/'$/, '');
    const out = [];
    words.forEach((w0, k) => {
      const w = bare(w0);
      if (/^[A-Z]{1,3}-\d{1,4}[A-Z]?$/.test(w)) { out.push(w); return; }                           /* W-9, I-9, DS-11 */
      if (DOC_ABBR[w.replace(/s$/, '')]) { out.push(DOC_ABBR[w.replace(/s$/, '')]); return; }          /* COI, NDA, SOW */
      if (!DOC_HEADS.test(w)) return;
      const next = words[k + 1] ? bare(words[k + 1]) : '';
      if (DOC_HEADS.test(next) && !/^(of|,)$/.test(next) && /^[a-z]/.test(next)) return;              /* "timesheet record": the last noun is the head */
      const mods = [];
      for (let i = k - 1; i >= 0 && mods.length < 3; i--) {
        const x = bare(words[i]); const xl = x.toLowerCase();
        if (x === ',' || x === '&' || DET.test(xl) || PREP.test(xl) || ADJ_STOP.test(xl) || /^(and|or|is|are|be|was|not|no)$/i.test(xl)) break;
        if ((isBase(xl) || verbBase(xl)) && !NOUNISH.test(xl)) break;
        if ((ROLE_NOUNS.has(xl) || ROLE_NOUNS.has(xl.replace(/s$/, ''))) && !/^(vendor|vendors|supplier|suppliers|employee|employees|contractor|contractors|customer|customers|client|clients|tax|bank|benefits|payroll|exit)$/i.test(xl) && !/^[A-Z]{2,}$/.test(x)) break;
        if (/^\d/.test(x) || /[^A-Za-z0-9&/'-]/.test(x)) break;
        mods.unshift(x.split('/').map(p => /^[A-Z]{2,5}s?$/.test(p) ? p : p.toLowerCase()).join('/'));
      }
      const head = /^ids?$/i.test(w) ? 'ID' : w.toLowerCase();
      if (OF_HEADS.test(w) && next && /^of$/i.test(next)) {
        const tail = [];
        for (let i = k + 2; i < words.length && tail.length < 2; i++) {
          const raw = bare(words[i]), x = raw.toLowerCase();
          if (x === ',' || DET.test(x) || PREP.test(x) || /^(and|or)$/.test(x) || isBase(x) || verbBase(x)) break;
          /* R15 (Karen): "certificate of insurance (COI)": the abbreviation after the words is the same item */
          if (tail.length && isAcronymOf(raw, mods.concat([head, 'of'], tail))) break;
          tail.push(x);
        }
        /* R14 (Karen 9): "COI certificate of insurance" is the certificate of insurance, written once */
        const ws = mods.concat([head, 'of'], tail);
        if (mods.length && isAcronymOf(mods[0], ws.slice(1))) ws.shift();
        if (tail.length) { out.push(cap(ws.join(' '))); return; }
      }
      /* "calls the vendor's known number" -> "Vendor phone number" (never "Known number") */
      if (/^numbers?$/i.test(w) && !mods.length && /\b(call|calls|called|phone|phones|ring|rings|dial|dials|text|texts)\b/i.test(line)) {
        let own = '';
        for (let i = k - 1; i >= Math.max(0, k - 3); i--) if (/['’]s$|s['’]$/i.test(words[i])) { own = bare(words[i].replace(/’/g, "'")).toLowerCase(); break; }
        out.push(cap((own ? own + ' ' : '') + 'phone number')); return;
      }
      if (!mods.length && GENERIC_ALONE.test(w)) return;
      out.push(cap(mods.concat([head]).join(' ')));
    });
    INFO_NOUNS.forEach(x => { const m = x.re.exec(line); if (!m) return; const nm = typeof x.name === 'function' ? x.name(m) : x.name; const w = nm.toLowerCase().replace(/s$/, ''); if (!out.some(p => p.toLowerCase().includes(w))) out.push(nm); });
    return [...new Set(out.map(tidy).filter(Boolean))];
  }

  /* ---------------------------------------------------------------- conditions */
  const COMPARE = /\b(exceed\w*|over|above|greater than|more than|less than|below|under|at least|at most)\b/i;
  const ELSE_RE = /^(otherwise|else|if not)\b[,:]?\s*(.*)$/i;
  const PAR_RE = /\b(at the same time|in parallel|simultaneously|concurrently)\b/i;
  const GOTO_WORDS = '(?:return(?:s|ed)?|go(?:es)? back|loop(?:s)? back|send(?:s)? (?:it )?back|back|skip(?:s|ped)?|go(?:es)?|jump(?:s|ed)?|continue(?:s|d)?(?: at| with)?|proceed(?:s|ed)?|move(?:s|d)? on)';
  const GOTO_RE = new RegExp('\\b' + GOTO_WORDS + '\\s+(?:to\\s+)?step\\s+(\\d+)\\b', 'i');
  const GOTO_STRIP = new RegExp(',?\\s*(?:and\\s+|then\\s+)?' + GOTO_WORDS + '\\s+(?:to\\s+)?step\\s+\\d+\\.?', 'i');
  /* "the contract value exceeds $50,000" -> "Contract value exceeds $50,000?"; "not returned within 5 days" -> "Returned within 5 days?" */
  function decisionTitle(cond, negated) {
    let c = tidy(cond).replace(/[.;?]$/, '').replace(/^(?:if|when|unless|where)\s+/i, '').trim();
    if (negated) c = c.replace(/^(?:it\s+|they\s+|the\s+\w+\s+)?(?:is|are)\s+not\s+/i, '').replace(/^not\s+/i, '');
    c = c.replace(/^(the|a|an)\s+/i, '');
    if (/^(over|above|under|below|more than|greater than|less than|exceeds?)\b/i.test(c)) c = 'amount ' + c;
    c = c.replace(/\s+(?:is|are)\s+(?=(?:over|above|under|below|more than|greater than|less than|at least)\b)/i, ' ');
    return cap(tidy(c)) + '?';
  }

  /* ---------------------------------------------------------------- R11 G2: time-limit escalations and reject paths */
  /* "If the Credit Manager does not approve within 2 business days, escalate to the CFO" / "if not approved within 2 days,
     escalate to the CFO" / "If no response in 3 days, remind the vendor": a timer on the step it watches (a BPMN boundary
     timer), not a choice. Returns {who, timer:{after, iso, businessDays, action, to}} or null. "If not returned within 5
     days, notify Legal" waits on something outside the step (a returned laptop), so it stays a choice. */
  const DONE_VERBS = /^(approve|approved|approves|review|reviewed|reviews|sign|signed|signs|complete|completed|completes|done|finish|finished|action|actioned|resolve|resolved|resolves|respond|responded|responds|response|reply|replied|replies|decide|decided|decides|answer|answered|answers|process|processed|act|acted|confirm|confirmed|confirms)$/i;
  const ESC_RE = /^(?:if|when)\s+(?:(.+?)\s+)?(?:(?:is|are|has|have|was|were)\s+)?(?:not|no|does\s+not|do\s+not|did\s+not|doesn['’]t|don['’]t|didn['’]t|has\s+not|have\s+not|hasn['’]t|haven['’]t|is\s+not|are\s+not|isn['’]t|aren['’]t)\s+(?:yet\s+)?([a-z]+)\b(.*?)\b(?:within|in|after)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|thirty)\s+((?:business|working|calendar)\s+)?(hours?|days?|weeks?)\s*(?:of\s+[a-z ]+?)?\s*[,:]\s*(?:then\s+)?(.+?)[.;]?$/i;
  function escalationOf(sen) {
    const m = ESC_RE.exec(squash(sen)); if (!m) return null;
    const act = stripEnd(m[7]);
    if (!(DONE_VERBS.test(m[2]) || /^(escalate|remind|chase|follow up|nudge|alert|page)\b/i.test(act))) return null;
    const d = durationInfo(`${m[4]} ${m[5] || ''}${m[6]}`);
    const sp = splitActor(act);
    const to = /\bto\s+(?:the\s+)?((?:[A-Z][\w&/-]*\s+){0,3}[A-Z][\w&/-]*)/.exec(sp.action);
    const who = m[1] && !/^(it|they|this|that|the request|request)$/i.test(m[1]) && roleWords(m[1].replace(/^(the|a|an)\s+/i, '').split(/\s+/)) ? canonRole(m[1]) : '';
    return { who, timer: { after: d ? d.text : `${m[4]} ${m[6]}`, iso: d ? d.iso : '', businessDays: d ? d.businessDays : null, action: cap(tidy(sp.action)), to: to && roleWords(to[1].split(/\s+/)) ? canonRole(to[1]) : (sp.actor || '') } };
  }
  /* the step a timer watches: the latest step of the named role, else the latest approval-like step, else the latest step */
  /* R12 (BPM expert): the timer goes on the step that is waited on (the actor's own approval), never on a step of the path
     taken after a rejection ("If rejected, notify the Sales Rep"). Order: the named role's approval-like step, the named
     role's step, any approval-like step, the latest step. */
  const APPROVAL_LIKE = /^(approve|review|sign|authori[sz]e|decide|check|verify|countersign|co-approve|accept|respond|reply)\b/i;
  function rejectBranch(d) {
    if (!d || d.type !== 'decision' || !Array.isArray(d.branches)) return null;
    const t = String(d.title || '');
    const lbl = REJECT_COND.test(t) ? 'yes' : APPROVE_COND.test(t) && !/\bnot\b/i.test(t) ? 'no' : null;
    return lbl ? d.branches.find(x => String(x.label).toLowerCase() === lbl) || null : null;
  }
  function escalationHost(nodes, es) {
    const order = [], onReject = new Set();
    const walk = (ns, rej) => (ns || []).forEach(n => { if (n.type === 'step') { order.push(n); if (rej) onReject.add(n); } const rb = rejectBranch(n); (n.branches || []).forEach(b => walk(b.nodes, rej || b === rb)); });
    walk(nodes, false);
    const rev = order.slice().reverse(), ok = rev.filter(n => !onReject.has(n));
    const pool = ok.length ? ok : rev;
    const mine = n => es.who && String(n.ownerRole || '').toLowerCase() === es.who.toLowerCase();
    return pool.find(n => mine(n) && APPROVAL_LIKE.test(n.title)) || pool.find(mine) || pool.find(n => APPROVAL_LIKE.test(n.title)) || pool[0] || null;
  }
  const REJECT_COND = /\b(reject\w*|declin\w*|den(?:y|ies|ied)|refus\w*|not\s+approv\w*|fail\w*|not\s+accept\w*)\b/i;
  const APPROVE_COND = /\b(approv\w*|accept\w*|ok|okay|pass(?:es|ed)?)\??$/i;
  /* the path a choice takes when the request is turned down: it ends ("Stop: request rejected") unless the text says where
     it goes. "Rejects the request?" -> its Yes path; "Approved?" -> its No path. */
  function endRejectPath(d) {
    if (!d || d.type !== 'decision' || !Array.isArray(d.branches)) return;
    const t = String(d.title || '');
    const lbl = REJECT_COND.test(t) ? 'yes' : APPROVE_COND.test(t) && !/\bnot\b/i.test(t) ? 'no' : null;
    if (!lbl) return;
    const b = d.branches.find(x => String(x.label).toLowerCase() === lbl); if (!b) return;
    if (b.goto != null || b.gotoNum != null || (b.nodes || []).some(n => n.type === 'end')) return;
    b.nodes.push({ id: 'e' + d.id, type: 'end', title: 'Stop: request rejected' });
    d.rejectEnds = true;
  }

  /* ---------------------------------------------------------------- R12: RACI from the text */
  /* "Sam Wu signs off" / "sign-off from the Controller (Sam Wu)" -> Accountable; "after consulting Legal" -> Consulted;
     ", and copies the Account Manager" / "keeps the requester informed" -> Informed. Only a role, a team or a person's
     name counts. A clause that is not the step's own action is taken out of the title (it lives in the RACI). */
  const RX_WHO = "((?:[A-Z][\\w&/'-]*|[a-z][\\w&/-]*)(?:\\s+[A-Za-z][\\w&/'-]*){0,3}?(?:\\s*\\([A-Z][^)]{1,40}\\))?)";
  const RX_END = "(?=\\s*(?:[.;,!]|$)|\\s+(?:and|before|after|when|once|that|about|of|on)\\b)";
  const RACI_RX = [
    { k: 'a', strip: true, re: new RegExp("(?:^|[;,]\\s*(?:and\\s+)?|\\s+and\\s+)(?:the\\s+)?" + RX_WHO + "\\s+(?:then\\s+)?(?:signs?\\s+off|gives?\\s+(?:the\\s+)?(?:final\\s+)?(?:sign-?off|approval))(?:\\s+on\\s+[^.;,]+)?", 'i') },
    { k: 'a', strip: false, re: new RegExp("\\bsign-?off\\s+(?:from|by)\\s+(?:the\\s+)?" + RX_WHO + RX_END, 'i') },
    { k: 'a', strip: true, re: new RegExp("(?:^|[;,]\\s*|\\s+and\\s+)(?:the\\s+)?" + RX_WHO + "\\s+is\\s+accountable\\b(?:\\s+for\\s+[^.;,]+)?", 'i') },
    { k: 'c', strip: true, re: new RegExp(",?\\s+(?:after|before)\\s+(?:consulting(?:\\s+with)?|checking\\s+with|speaking\\s+(?:to|with)|talking\\s+to)\\s+(?:the\\s+)?" + RX_WHO + RX_END, 'i') },
    { k: 'c', strip: true, re: new RegExp(",?\\s+(?:in\\s+consultation\\s+with|with\\s+input\\s+from)\\s+(?:the\\s+)?" + RX_WHO + RX_END, 'i') },
    { k: 'c', strip: true, re: new RegExp("(?:,\\s*and\\s+|,\\s+|\\s+and\\s+)consults?\\s+(?:with\\s+)?(?:the\\s+)?" + RX_WHO + RX_END, 'i') },
    { k: 'i', strip: true, re: new RegExp("(?:,\\s*and\\s+|,\\s+|\\s+and\\s+)(?:also\\s+)?(?:copies|copy|cc(?:'?s)?)\\s+(?:in\\s+)?(?:the\\s+)?" + RX_WHO + RX_END, 'i') },
    { k: 'i', strip: true, re: new RegExp("(?:,\\s*and\\s+|,\\s+|\\s+and\\s+)(?:also\\s+)?keeps?\\s+(?:the\\s+)?" + RX_WHO + "\\s+(?:informed|updated|in\\s+the\\s+loop)\\b", 'i') },
    { k: 'i', strip: true, re: new RegExp("(?:,\\s*and\\s+|,\\s+|\\s+and\\s+)(?:also\\s+)?(?:informs?|notifies|tells?)\\s+(?:the\\s+)?" + RX_WHO + RX_END, 'i') },
  ];
  function raciWho(x) {
    const m = /^(.*?)\s*\(([A-Z][^)]{1,40})\)$/.exec(squash(x));
    const base = squash((m ? m[1] : x).replace(/^(the|a|an|our|your|their)\s+/i, ''));
    if (!base) return '';
    const ws = base.split(' ');
    if (/^[A-Z][a-z]+(?:\s+[A-Z][\w'-]+){1,2}$/.test(base) && !ws.some(w => roleNoun(w) || isTeam(w))) return m ? '' : base;
    if (!(roleWords(ws) || isTeam(base))) return '';
    const r = canonRole(base);
    return m ? `${r} (${squash(m[2])})` : r;
  }
  /* raciIn(text) -> {raci: {a?, c?, i?} | null, text: text without the RACI clauses that are not the step's action} */
  function raciIn(text) {
    let t = String(text || '');
    const out = {};
    RACI_RX.forEach(x => {
      for (let guard = 0; guard < 4; guard++) {
        const m = x.re.exec(t); if (!m) break;
        const who = raciWho(m[1]);
        if (!who) break;
        if (x.k === 'a') { if (!out.a) out.a = who; }
        else { const l = out[x.k] || (out[x.k] = []); if (!l.includes(who)) l.push(who); }
        /* R15 (BPM): "… and notifies the sales rep and the customer": every one told is Informed, and the clause stays in
           the title (stripping the first name only left "… and the customer") */
        const more = x.k === 'i' && /^\s+and\s+/i.test(t.slice(m.index + m[0].length));
        if (more) {
          let rest = t.slice(m.index + m[0].length), mm;
          while ((mm = /^\s*(?:,|and)\s+(?:the\s+)?([A-Za-z][\w&/'-]*(?:\s+[A-Za-z][\w&/'-]*){0,3}?)(?=\s*(?:[.;,!]|$)|\s+and\b)/i.exec(rest))) {
            const w2 = raciWho(mm[1]); if (!w2) break;
            if (!out.i.includes(w2)) out.i.push(w2);
            rest = rest.slice(mm[0].length);
          }
          break;
        }
        /* the whole clause is the step's own action ("Sam Wu signs off."): kept as written */
        if (!x.strip || m.index === 0 && !/^[;,\s]/.test(m[0])) break;
        t = (t.slice(0, m.index) + t.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ');
      }
    });
    return { raci: Object.keys(out).length ? out : null, text: t.trim() };
  }
  const mergeRaci = (n, r) => {
    if (!n || !r) return;
    const x = n.raci || (n.raci = {});
    if (r.a && !x.a) x.a = r.a;
    ['c', 'i'].forEach(k => (r[k] || []).forEach(w => { const l = x[k] || (x[k] = []); if (!l.includes(w)) l.push(w); }));
  };

  /* ---------------------------------------------------------------- R14: one reading of "Role (Name)" */
  /* the same rule for pasted text, Visio shape text, Visio and BPMN lane names: "Controller (Sam Wu)" -> {role:
     'Controller', name: 'Sam Wu'}; "Sam Wu (Controller)" the same; "the credit manager" -> {role: 'Credit manager'};
     "Sam Wu" -> {name: 'Sam Wu'}; anything else is a role as written. */
  const looksName = x => /^[A-Z][a-z'’-]+(?:\s+[A-Z][\w'’-]+){0,2}$/.test(x) && !x.split(/\s+/).some(w => roleNoun(w) || isTeam(w)) && !SYS_RE.test(x);
  const looksRole = x => { const ws = squash(x).replace(/^(the|a|an|our|your|their)\s+/i, '').split(' '); return !!ws[0] && (roleWords(ws) || isTeam(ws.join(' '))); };
  function roleAndName(text) {
    const t = squash(text).replace(/^(the|a|an|our|your|their)\s+/i, '');
    if (!t) return { role: '', name: '' };
    const m = /^(.*?)\s*\(([^()]{1,40})\)$/.exec(t);
    if (m) {
      const a = squash(m[1]), b = squash(m[2]);
      if (a && looksRole(a) && looksName(b)) return { role: canonRole(a), name: b };
      if (a && looksName(a) && looksRole(b)) return { role: canonRole(b), name: a };
      if (a && looksRole(a) && looksRole(b)) return { role: canonRole(a), name: '' };
    }
    if (looksRole(t)) return { role: canonRole(t), name: '' };
    if (looksName(t) && t.split(' ').length >= 2) return { role: '', name: t };
    return { role: cap(t), name: '' };
  }
  /* R14 (BPM-5): an amount threshold a choice tests: "Requested limit under $50k?" -> {subject, op: '<', amount: 50000} */
  const THRESH_RE = /^(.*?)\s*\b(?:is\s+|are\s+)?(above|over|exceeds?|exceeding|greater than|more than|at least|under|below|less than|at most|up to|no more than)\s+\$\s?([\d,]+(?:\.\d+)?)\s*([kKmM])?\b/i;
  /* R15: "$50,000 or less" / "$1M or more" */
  const THRESH_OR_RE = /^(.*?)\s*(?:\b(?:is|are)\s+)?\$\s?([\d,]+(?:\.\d+)?)\s*([kKmM])?\s+or\s+(less|below|under|lower|fewer|more|above|over|greater|higher)\b/i;
  function thresholdOf(title) {
    const o = !THRESH_RE.exec(String(title || '')) && THRESH_OR_RE.exec(String(title || ''));
    if (o) {
      const amount = Number(o[2].replace(/,/g, '')) * (/k/i.test(o[3] || '') ? 1000 : /m/i.test(o[3] || '') ? 1e6 : 1);
      if (!isFinite(amount)) return null;
      const subject = squash(o[1]).toLowerCase().replace(/^(?:if|when|the|a|an)\s+/g, '').replace(/\s+(?:is|are)$/, '') || 'amount';
      /* R16 (N1 ask): "X or less" includes X */
      return { subject, op: /^(less|below|under|lower|fewer)$/i.test(o[4]) ? '<=' : '>=', amount };
    }
    const m = THRESH_RE.exec(String(title || '')); if (!m) return null;
    const amount = Number(m[3].replace(/,/g, '')) * (/k/i.test(m[4] || '') ? 1000 : /m/i.test(m[4] || '') ? 1e6 : 1);
    if (!isFinite(amount)) return null;
    const subject = squash(m[1]).toLowerCase().replace(/^(?:if|when|the|a|an)\s+/g, '').replace(/\s+(?:is|are)$/, '') || 'amount';
    return { subject, op: /^(under|below|less than|at most|up to|no more than)$/i.test(m[2]) ? '<' : '>', amount };
  }
  /* R16 (BPM): every number a choice tests, money or not: "Requested limit $50,000 or less and risk score 60 or below?" ->
     [{subject:'requested limit', op:'<', amount:50000, money:true}, {subject:'risk score', op:'<', amount:60, money:false}],
     so a change of the risk score alone (60 -> 65) is a threshold change too */
  function thresholdsOf(title) {
    const t = String(title || '').replace(/\?\s*$/, '');
    const parts = t.split(/\s*(?:,\s*)?\b(?:and|or)\b\s+(?!(?:less|below|under|lower|fewer|more|above|over|greater|higher)\b)/i);
    const out = [];
    const num = (v, k) => Number(String(v).replace(/,/g, '')) * (/k/i.test(k || '') ? 1000 : /m/i.test(k || '') ? 1e6 : 1);
    const subj = x => squash(x).toLowerCase().replace(/^(?:if|when|the|a|an)\s+/g, '').replace(/^(?:the|a|an)\s+/, '').replace(/\s+(?:is|are)$/, '');
    parts.forEach(pt => {
      const a = /^(.*?)\s*(?:\b(?:is|are)\s+)?(\$)?\s?([\d,]+(?:\.\d+)?)\s*([kKmM])?\s*(?:points?\s+)?or\s+(less|below|under|lower|fewer|more|above|over|greater|higher)\b/i.exec(pt);
      const b = !a && /^(.*?)\s*\b(?:is\s+|are\s+)?(above|over|exceeds?|exceeding|greater than|more than|at least|under|below|less than|at most|up to|no more than)\s+(\$)?\s?([\d,]+(?:\.\d+)?)\s*([kKmM])?\b/i.exec(pt);
      if (a && isFinite(num(a[3], a[4]))) out.push({ subject: subj(a[1]) || 'amount', op: /^(less|below|under|lower|fewer)$/i.test(a[5]) ? '<' : '>', amount: num(a[3], a[4]), money: !!a[2] });
      else if (b && isFinite(num(b[4], b[5]))) out.push({ subject: subj(b[1]) || 'amount', op: /^(under|below|less than|at most|up to|no more than)$/i.test(b[2]) ? '<' : '>', amount: num(b[4], b[5]), money: !!b[3] });
    });
    return out;
  }
  /* R15: "limit $50,000 or less and risk score 60 or below": a second condition, so the No path is NOT "over $50,000" */
  function compoundCond(title) {
    const rest = String(title || '').replace(/\bor\s+(less|below|under|lower|fewer|more|above|over|greater|higher)\b/gi, ' ');
    return /\b(and|or)\b/i.test(rest) && (rest.match(/\d[\d,.]*/g) || []).length >= 2;
  }
  /* two thresholds on the same thing that no value can meet together ("under $50k" and "above $250,000") */
  function thresholdsDisjoint(a, b) {
    const dir = op => String(op || '').charAt(0);
    if (!a || !b || dir(a.op) === dir(b.op)) return false;
    const stem = s => String(s || '').split(/\s+/).filter(w => w.length >= 4).map(w => w.replace(/(ies)$/, 'y').replace(/s$/, ''));
    const sa = stem(a.subject), sb = stem(b.subject);
    if (!(a.subject === b.subject || sa.some(w => sb.includes(w)) || a.subject === 'amount' || b.subject === 'amount')) return false;
    const lo = dir(a.op) === '<' ? a : b, hi = dir(a.op) === '<' ? b : a;
    /* "<= X" and ">= X" can both hold at exactly X */
    return lo.op === '<=' && hi.op === '>=' ? hi.amount > lo.amount : hi.amount >= lo.amount;
  }
  /* R14 (Karen 9): documents a counterparty sends on every run (a W-9, a certificate of insurance) are collected each
     time the process runs; they are never a one-off "make it available" setup task */
  const EXTERNAL = /^(vendors?|suppliers?|customers?|clients?|contractors?|applicants?|candidates?|new hires?|members?|patients?|students?|carriers?|tenants?|brokers?)$/i;
  const EXTERNAL_IN = /\b(?:from|by)\s+(?:the\s+|each\s+|every\s+)?(vendor|supplier|customer|client|contractor|applicant|candidate|new hire|member|patient|student|carrier|tenant|broker)s?\b/i;
  const PER_RUN_NAME = /^(W-\d+\w*|W-8\w*|I-9|1099(?:-\w+)?|Certificate of insurance|Proof of insurance|Signed W-9)$/i;
  const DOCLIKE = /(^[A-Z]{1,3}-\d|\b(forms?|certificates?|letters?|invoices?|receipts?|statements?|licen[cs]es?|permits?|ids?|passports?|contracts?|agreements?|applications?|quotes?|quotations?|proofs?|copy|copies|documents?|packets?)\b)/i;
  /* R15 (Karen): details of the vendor (customer, …) the run is about: its routing numbers, tax ID, bank account and credit
     limit are written down for each vendor, never made available once */
  /* R16 (Karen): legal names and the party's own name are per-vendor fields too ("Vendor legal name", "Customer name") */
  const PER_RUN_FIELD = /\b(routing(?:\s+and\s+account)?\s+numbers?|account\s+numbers?|bank\s+accounts?(?:\s+(?:numbers?|details))?|bank\s+details|tax\s+ids?|tins?|eins?|credit\s+limits?|remittance\s+address(?:es)?|ibans?|swift(?:\s+codes?)?|sort\s+codes?|legal\s+names?|(?:vendor|supplier|customer|client|contractor|applicant|candidate|member|patient|student|carrier|tenant|broker)\s+names?)$/i;
  /* R16 (BPM): an identity field of the party is never "produced" by a step, even when a step "sets up" or "records" it */
  const IDENTITY_FIELD = /\b(routing|account\s+numbers?|bank|tax\s+ids?|tins?|eins?|legal\s+names?|ibans?|swift|sort\s+codes?|remittance)\b/i;
  const CONTAINER = /\b(forms?|records?|logs?|lists?|registers?|files?|folders?|databases?|sheets?|spreadsheets?|reports?|systems?|masters?|portals?|letters?|packets?|documents?|certificates?)$/i;
  const OUTPUT_VERB = '(?:sets?|records?|updates?|calculates?|computes?|assigns?|generates?|issues?|creates?|determines?|produces?|decides?|approves?)';
  /* R16 (BPM): information a step makes ("Credit runs a credit check and sets a credit limit", "AR updates the credit limit
     in the ERP") is produced by that step: nobody collects it or has it beforehand */
  function outputOf(name, line) {
    const nm = squash(name); if (!nm || IDENTITY_FIELD.test(nm)) return false;
    const esc = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    /* a form, log, list or record a step updates already exists ("updates the employee exit form"): only a step that
       creates, generates or issues one makes it */
    const verbs = CONTAINER.test(nm) ? '(?:creates?|generates?|issues?|produces?)' : OUTPUT_VERB;
    return new RegExp('\\b' + verbs + '\\s+(?:(?:a|an|the|its|their|his|her|our|new|final|approved|revised)\\s+)*' + esc + '\\b(?!\\s+(?:request|form|application)s?\\b)', 'i').test(String(line || ''));
  }
  /* R16 (Karen): the default answer to "Do you already have these?": 'made' (a step produces it), 'run' (collected each
     time the process runs), else 'have' (the procedure runs today, so the information is already there). 'notyet' is
     only ever the visitor's own answer. */
  /* R16 (BPM): the information a diagram's task names ("Pull risk score from credit bureau", "Update credit limit in ERP")
     when the file has no data objects: [{name, produced}] (produced: the task makes it) */
  function taskInfo(title) {
    const t = squash(title); if (!t) return [];
    const w = t.split(' '); const v = w[0].toLowerCase();
    const third = /(s|sh|ch|x|z)$/.test(v) ? v + 'es' : /[^aeiou]y$/.test(v) ? v.slice(0, -1) + 'ies' : v + 's';
    const line = 'Someone ' + [third].concat(w.slice(1)).join(' ');
    const out = [];
    infoPhrases(line).forEach(nm => {
      let ws = squash(nm).split(' ');
      while (ws.length > 1 && /^(updates?|enters?|records?|sets?|creates?|reviews?|approves?|checks?|sends?|pulls?|submits?|files?|auto-approves?)$/i.test(ws[0])) ws = ws.slice(1);
      if (ws.length < 2 && !/^[A-Z]{1,3}-\d/.test(ws[0] || '')) return;
      const name = ws.join(' '); const nice = name.charAt(0).toUpperCase() + name.slice(1);
      if (!out.some(x => x.name.toLowerCase() === nice.toLowerCase())) out.push({ name: nice, produced: outputOf(nice, line) });
    });
    return out;
  }
  function haveChoice(p) { return !p ? 'have' : p.producedBy ? 'made' : p.perRun ? 'run' : 'have'; }
  const PARTY_WORD = /\b(vendor|supplier|customer|client|contractor|applicant|candidate|new hire|member|patient|student|carrier|tenant|broker)s?\b/i;
  function perRunOf(name, actor, line, ctxText) {
    const a = squash(actor).toLowerCase();
    const ext = EXTERNAL.test(a) ? a : '';
    const from = EXTERNAL_IN.exec(String(line || ''));
    let party = ext || (from ? from[1].toLowerCase() : '');
    /* R16 (Karen): a per-vendor field is per run in any procedure about a vendor (customer, …), whichever line names it, so
       "Routing number" and "Routing numbers" are classified the same way */
    const field = PER_RUN_FIELD.test(String(name || '')) && (() => { const pw = PARTY_WORD.exec(String(name)) || PARTY_WORD.exec(String(line || '')) || PARTY_WORD.exec(String(ctxText || '')); if (pw && !party) party = pw[1].toLowerCase(); return !!(party || /^W-\d/i.test(name)); })();
    /* R16: everything a step takes in "from the customer" (or that the vendor sends) arrives with each run */
    if (!(PER_RUN_NAME.test(name) || (party && DOCLIKE.test(name)) || field || party)) return null;
    const p = party || ((EXTERNAL_IN.exec(ctxText || '') || /\b(vendor|supplier|customer|client|contractor|applicant|candidate|new hire)s?\b/i.exec(ctxText || '') || [])[1] || '').toLowerCase();
    return { perRun: true, perRunText: `Collected ${p ? `from the ${p.replace(/s$/, '')} ` : ''}each time the process runs, so it is not a one-off setup task.` };
  }

  /* ---------------------------------------------------------------- the SOP parser */
  const SKIP_LINE = /^(title|purpose|scope|objective|owner|process owner|document owner|revision|rev\.?|version|effective(\s+date)?|approved by|author|department|document(\s+(id|no\.?|number))?|sop(\s+(id|no\.?|number))?|last\s+(updated|reviewed)|applies to|audience|references?|trigger|start(?:ing)? event|procedure|process|name|notes?)\b\s*[:\-–—]/i;
  const TRIGGER_LINE = /^(trigger|start(?:ing)? event|starts? when|begins? when)\s*[:\-–—]\s*(.+)$/i;
  const TRIGGER_PROSE = /\b(?:process|procedure|sop|workflow)\s+(?:starts|begins|is triggered|is initiated|kicks off)\s+(?:when|once|after|by)\s+(.+?)\.?$/i;
  /* R11 G2: "6.", "6)", "(6)", "6:", "6 - …", "6 – …", "Step 6:", "Step 6 -", "Step 6 …" are all numbered lines */
  const NUM = /^\(?(?:step\s+)?(\d{1,3})(?:\s*[.):]|\s*[-–—]\s+)\s*(?=\S)|^step\s+(\d{1,3})\s+(?=[A-Za-z])/i;
  const SUBNUM = /^\d+\.\d+[.):]?\s+/;
  const LETTER = /^(?:[a-h]|[ivx]{1,4})[.)]\s+/i;
  const BULLET = /^[-*•–]\s+/;
  /* R14: "<things> above $N (also) need(s) sign-off / approval / a review from <role>" */
  const NEED_RE = /^(?:(?:the|all|any)\s+)?([A-Za-z][\w -]{1,40}?)\s+(above|over|exceeding|greater than|more than|under|below|less than)\s+(\$\s?[\d,]+(?:\.\d+)?\s*[kKmM]?)\s+(also\s+)?(?:need|needs|require|requires|must\s+(?:have|get)|get|gets)\s+(?:an?\s+|the\s+)?(?:extra\s+|additional\s+|second\s+)?(sign-?off|approval|review|signature)\s+(?:from|by)\s+(?:the\s+)?(.+)$/i;
  /* qualifier clauses that stay in the note ("…, usually by email, sometimes fax") */
  const QUALIFIER = /^(usually|sometimes|often|typically|normally|generally|mostly|occasionally|e\.g\.|for example|such as|including|which|who|where|so that|because|as needed|if needed|when needed|as required|either|via|by (?:email|e-mail|phone|fax|post|mail|courier|hand)|or by|and usually|but)\b/i;

  /* R13 #9: an imperative check or approval ("Check OFAC/sanctions list", "Screen the vendor…") is a step wherever it is
     written: a sentence after the line's step, or an unnumbered line between numbered steps */
  const CONTROL_LINE = /^(?:then\s+)?(?:check|screen|verify|validate|confirm|review|approve|reconcile|inspect|audit|double-check|cross-check)\s+\S/i;
  /* an unnumbered line between numbered steps that is a step: a check, or a condition with its own action
     ("if spend over $25k Karen approves too") */
  const actionLine = b => CONTROL_LINE.test(b) || /^(?:if|unless|should)\s+\S/i.test(b) && /[a-z]/i.test(b.replace(/^\S+\s+/, ''));

  /* Names of the processes the parser recognises as a title, e.g. "Northwind Traders — Vendor Onboarding SOP (v3)" -> "Vendor onboarding" */
  function deriveName(text) {
    const ls = String(text || '').split(/\r?\n/).map(x => x.replace(/^#+\s*/, '').trim()).filter(Boolean);
    const tidyName = t => {
      let x = String(t).replace(/^[A-Z][\w&.' ]{1,40}\s+[—–-]\s+/, m => (/\b(sop|procedure|process)\b/i.test(t.slice(m.length)) ? '' : m))
        .replace(/\s*\((?:v|rev|version)\s*[\d.]+\)\s*$/i, '')
        .replace(/\s*[—–-]?\s*\b(standard operating procedure|sop|procedure|process|policy|work instruction|checklist)\b\s*$/i, '').replace(/[.:;,\s]+$/, '').trim();
      if (!x || x.split(/\s+/).length > 8) return '';
      return x.split(/\s+/).map((w, i) => /^[A-Z0-9&-]{2,}$/.test(w) ? w : i ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    };
    for (const l of ls) { const m = /^(?:procedure|process|title|sop|name)\s*[:\-–—]\s*(.+)$/i.exec(l); if (m && tidyName(m[1])) return tidyName(m[1]); }
    const first = ls[0] || '';
    if (!first || NUM.test(first) || BULLET.test(first) || (/[.!?]$/.test(first) && first.split(/\s+/).length > 6)) return '';
    if (/^(purpose|owner|scope|revision|trigger)\s*:/i.test(first)) return '';
    return tidyName(first);
  }

  /* parseSop(text) -> {nodes:[trigger, …], newData, notes, trigger, teams, name}
     Node shapes match what the import page and the API already exchange:
       step     {id, type:'step', title, ownerRole?, sla?, system?, note?, touches[], subs[], newData[{key,name}]}
       wait     {id, type:'wait', title, wait}
       decision {id, type:'decision', title, branches:[{label:'Yes', nodes, goto?}, {label:'No', nodes, goto?}]}
       parallel {id, type:'parallel', title, branches:[{label, nodes}]}
     Never sets owner (a person id) and never sets data (element ids): the visitor's text cannot reach workspace data. */
  function parseSop(text) {
    text = String(text || '');
    let seq = 0;
    const id = p => p + (++seq);
    const newData = [];
    const teamsAll = [];
    const addTeams = ts => ts.forEach(t => { if (!teamsAll.includes(t)) teamsAll.push(t); });
    const propose = (name, line, node) => {
      name = tidy(name); if (!name || name.length > 60 || SYS_RE.test(name)) return;
      const key = ndKey(name);
      /* R16 (Karen): "Routing number" and "Routing numbers" are one piece of information */
      const one = singularKey(key);
      let p = newData.find(x => x.key === key || singularKey(x.key) === one);
      if (!p) { if (newData.length >= 25) return; p = { key, name, reason: `Mentioned in "${clip(line, 80)}".`, steps: [] }; newData.push(p);
        /* R16 (BPM): first named as something this step makes: produced by the step, not collected */
        if (node && node.id && node.type === 'step' && outputOf(name, line)) p.producedBy = node.id; }
      if (node && node.id && !p.steps.includes(node.id)) p.steps.push(node.id);
      if (node) { const nd = node.newData || (node.newData = []); if (!nd.some(x => x.key === key)) nd.push({ key, name: p.name }); }
      if (!p.perRun && !p.producedBy) { const pr = perRunOf(p.name, node && node.ownerRole, line, text); if (pr) Object.assign(p, pr); }
    };

    /* one clause -> a step (or a wait) */
    const makeStep = (clause, line, opts) => {
      opts = opts || {};
      let t = stripEnd(clause);
      const wm = /^(?:then\s+)?wait\s+(.+)$/i.exec(t);
      if (wm && !opts.noWait) {
        const what = wm[1].replace(/^(?:up\s+to\s+)?/, '').replace(/^for\s+/i, '');
        return { id: id('w'), type: 'wait', title: cap(tidy(t.replace(/^then\s+/i, ''))), wait: tidy(what) };
      }
      const n = { id: id('s'), type: 'step', touches: [], subs: [], newData: [] };
      /* R12: RACI clauses ("; the Controller (Sam Wu) signs off", ", and copies the Account Manager") */
      const rc = raciIn(t);
      if (rc.raci) { n.raci = rc.raci; t = stripEnd(rc.text) || t; }
      /* "… Owner: Records Clerk" */
      let ownerTxt = null;
      const ol = /[.;,]?\s*\bowner\s*[:\-–—]\s*(.+)$/i.exec(t);
      if (ol) { ownerTxt = ol[1].replace(/[.;]$/, ''); t = t.slice(0, ol.index).trim(); }
      const sla = slaOf(t);
      if (sla) { n.sla = sla.sla; t = squash(t.replace(sla.strip, ' ')); }
      const sys = systemIn(clause); if (sys) n.system = sys;
      const sp = splitActor(t);
      let action = sp.action;
      if (sp.actor) { n.ownerRole = sp.actor.slice(0, 60); if (sp.name) n.named = sp.name; }
      else {
        /* passive: "… is checked by the Compliance analyst" */
        const pb = /\b(?:is|are|gets?|will be)\s+\w+(?:ed|en)\b.*?\bby\s+(?:the\s+)?([A-Za-z][\w&-]*(?:\s+[A-Za-z][\w&-]*){0,2})\s*$/i.exec(t);
        if (pb && roleWords(pb[1].split(' '))) n.ownerRole = canonRole(pb[1]);
      }
      /* R16 (Karen): "Karen (Operations Director) approves too" is the Operations director, with Karen named, the same
         reading as "Controller (Sam Wu)" (roleAndName) */
      const rnOwn = ownerTxt && /\(/.test(ownerTxt) ? roleAndName(ownerTxt) : null;
      if (rnOwn && rnOwn.role && rnOwn.name) { n.ownerRole = rnOwn.role; n.named = rnOwn.name; }
      else if (ownerTxt) {
        const o = canonRole(ownerTxt);
        if (o && roleWords(o.split(' ')) || /^[A-Z][a-z]+(\s+[A-Z][\w'-]+){1,2}$/.test(ownerTxt.trim())) n.ownerRole = o;
      }
      /* "… sign-off from the Controller (Sam Wu)": a "Role (Name)" anywhere in the line names who does it */
      if (!n.ownerRole) {
        const rx = /((?:[A-Za-z][\w&/-]*\s+){0,3}[A-Z][\w&/-]*)\s*\(([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){1,2})\)/g;
        let m;
        while (!n.ownerRole && (m = rx.exec(t))) {
          const ws = m[1].split(/\s+/);
          for (let j = 0; j < ws.length; j++) { const cand = ws.slice(j); if (cand.length && !DET.test(cand[0]) && roleWords(cand)) { n.ownerRole = canonRole(cand.join(' ')); n.named = m[2]; break; } }
          if (n.ownerRole) action = action.replace(m[0], m[0].replace(/\s*\([^)]*\)/, ''));
        }
      }
      if (n.ownerRole) n.ownerRole = cap(squash(n.ownerRole.replace(/^(?:the|a|an|our|your|their)\s+/i, '')));
      n.title = cap(tidy(stripEnd(action))) || cap(tidy(stripEnd(clause)));
      /* R12 (Karen): "Karen approves too" / "the CFO also approves": an extra approval, not a plain step */
      if (/^(approve|co-approve|sign off|authori[sz]e)\b/i.test(n.title) && (/\s+(?:too|as well)$/i.test(n.title) || /\b(?:also|additionally)\s+(?:approves?|co-approves?|signs?\s+off|authori[sz]es?)\b/i.test(clause))) {
        n.title = 'Also ' + n.title.replace(/\s+(?:too|as well)$/i, '').replace(/^./, c => c.toLowerCase());
        n.approval = true;
      }
      if (n.named) n.note = `Named in the procedure: ${n.named}`;
      delete n.named;
      const tm = teamsIn(rc.raci ? raciIn(line).text : line);
      n.touches = [...new Set(teamOfRole(n.ownerRole).concat(tm))];
      addTeams(n.touches);
      /* information named by the action (never by the actor), plus any the line's condition reads ("the amount") */
      const extra = opts.dataText ? String(opts.dataText).replace(clause, ' ') : '';
      /* R13 #9: the step's own verb is never part of an information name ("Check OFAC/sanctions list") */
      const objText = action.replace(/^(\S+)\s+/, (m, w) => (isBase(w) && NOUNISH.test(w) ? '' : m));
      [...new Set(infoPhrases(withoutSystems(objText)).concat(extra ? infoPhrases(withoutSystems(extra)) : []))].forEach(nm => propose(nm, line, n));
      return n;
    };
    /* R15 (BPM top 1): what a choice's path does. "the request is auto-approved and AR updates the limit" ends there
       ("Done: approved automatically"), "stop" ends there, and a path that rejects the request stops; anything else is a
       step and the path carries on */
    const AUTO_END = /^(?:(?:the|this|that|it)\s+(?:[a-z]+\s+){0,2})?(?:is|are|gets?|will\s+be)\s+(?:auto-?approved|approved\s+automatically|automatically\s+approved)\b\s*(?:(?:,\s*)?(?:and\s+)?(?:then\s+)?(.*))?$/i;
    const AUTO_IMP = /^(?:then\s+)?(?:auto-?approve|approve\s+(?:it\s+|the\s+\w+\s+)?automatically)\b(?:\s+(?:it|the\s+\w+))?\s*(?:(?:,\s*)?(?:and\s+)?(?:then\s+)?(.*))?$/i;
    const STOP_RE = /^(?:then\s+)?(?:stop|end\s+(?:here|the\s+process)|stop\s+(?:here|the\s+process)|the\s+(?:process|request)\s+(?:ends|stops)(?:\s+here)?)$/i;
    const branchNodes = (act, line, opts) => {
      const a = stripEnd(act);
      if (STOP_RE.test(a)) return [{ id: id('e'), type: 'end', title: 'Stop' }];
      const au = AUTO_END.exec(a) || AUTO_IMP.exec(a);
      if (au) {
        const out = [];
        const rest = stripEnd(au[1] || '');
        if (rest) out.push(makeStep(rest, line, opts));
        out.push({ id: id('e'), type: 'end', title: 'Done: approved automatically' });
        return out;
      }
      /* "Otherwise Purchasing manager approval is enough": the Purchasing manager approves */
      const en = /^(?:the\s+)?(.+?)(?:['’]s)?\s+(approval|sign-?off|review)\s+is\s+(?:enough|sufficient|required|needed)$/i.exec(a);
      const st = makeStep(en && roleWords(en[1].split(/\s+/)) ? `${en[1]} ${/^sign/i.test(en[2]) ? 'signs off' : /^review/i.test(en[2]) ? 'reviews' : 'approves'}` : a, line, opts);
      const out = [st];
      if (st.type === 'step' && /^reject\b/i.test(st.title)) out.push({ id: id('e'), type: 'end', title: 'Stop: request rejected' });
      return out;
    };
    const addNote = (n, extra) => {
      if (!n || !extra) return;
      const x = tidy(extra); if (!x) return;
      n.note = n.note ? `${n.note} · ${x}` : x;
    };

    /* one numbered or bulleted line -> 1 node (a step or wait), or a step plus a decision, or a decision, or a parallel */
    const lineNodes = (body, num, prior) => {
      const out = [];
      prior = prior || [];
      const full = squash(body);
      /* split into sentences; "; otherwise", "; if not" and ", otherwise" start a clause too */
      const sentences = full.split(/(?<=[.!?])\s+(?=[A-Z("“])|;\s*(?=(?:otherwise|else|if|unless)\b)|,\s*(?=(?:otherwise|if not)\b)/i).map(s => s.trim()).filter(s => s.length >= 2);
      /* R13 #9: "Vendor sends W-9; Treasury calls to verify bank letter": a sentence whose semicolon-separated parts each
         name who acts is that many steps (a sign-off after the semicolon is the Accountable person, not a step) */
      const compound = new Set(), splitAt = [];
      sentences.forEach(sen => {
        const parts = sen.split(/;\s+/).map(x => x.trim()).filter(x => x.length >= 2);
        const acts = parts.length >= 2 && parts.every(x => splitActor(x).actor && !/^(?:if|unless|when|otherwise|else)\b/i.test(x)) && !parts.slice(1).some(x => /\b(?:signs?\s+off|gives?\s+(?:the\s+)?(?:final\s+)?(?:sign-?off|approval)|is\s+accountable)\b/i.test(x));
        if (acts) parts.forEach(x => { compound.add(x); splitAt.push(x); }); else splitAt.push(sen);
      });
      sentences.splice(0, sentences.length, ...splitAt);
      let main = null, dec = null, lastDec = null;
      const notes = [];
      timerHosts = [];
      sentences.forEach((sen, si) => {
        const g = GOTO_RE.exec(sen);
        const own = /^owner\s*[:\-–—]\s*(.+?)\.?$/i.exec(sen);
        if (own) { if (main && main.type === 'step') { const o = canonRole(own[1]); main.ownerRole = o; main.touches = [...new Set(main.touches.concat(teamOfRole(o)))]; addTeams(main.touches); } return; }
        /* R11: "…; if not approved within 2 business days, escalate to the CFO": a timer on the step, not a choice */
        const es = escalationOf(sen);
        if (es) {
          const host = main && main.type === 'step' ? main : escalationHost(out.length ? out : prior, es);
          if (host) { host.timer = es.timer; timerHosts.push(host.id); return; }
        }
        const els = ELSE_RE.exec(sen);
        /* "if not returned within 5 days, notify Legal" (after the line's main step): a choice whose No path holds the action */
        const ifNot = /^if\s+not\s+(.+?),(?!\d)\s*(?:then\s+)?(.+)$/i.exec(sen);
        if (ifNot && main) {
          const st = makeStep(ifNot[2], full);
          /* "…; if not returned within 5 days, notify Legal": whoever does the line's step does the follow-up */
          if (st.type === 'step' && !st.ownerRole && main.ownerRole) st.ownerRole = main.ownerRole;
          dec = { id: id('d'), type: 'decision', title: decisionTitle(ifNot[1], true), branches: [{ label: 'Yes', nodes: [] }, { label: 'No', nodes: [st] }] };
          out.push(dec); lastDec = dec; return;
        }
        if (els && lastDec) {
          const rest = stripEnd(els[2].replace(GOTO_STRIP, ''));
          const br = lastDec.branches[1];
          if (rest && !/^(return|go back|loop back|send back|skip|go|jump|continue|proceed)\b/i.test(rest)) {
            const made = branchNodes(rest, full), st = made[0];
            /* "Otherwise, the Procurement Manager approves." reads "Approve the vendor" when the other path says what */
            const other = lastDec.branches[0].nodes[0];
            if (st.type === 'step' && other && other.type === 'step' && st.title.split(' ').length === 1 && other.title.toLowerCase().startsWith(st.title.toLowerCase() + ' ')) st.title = other.title;
            br.nodes.push(...made);
          }
          if (g) br.gotoNum = +g[1];
          return;
        }
        const lead = /^(if|unless|when|where|for|should)\s+(.+?),(?!\d)\s*(?:then\s+)?(.+)$/i.exec(sen);
        const isCond = lead && (/^(if|unless|should)$/i.test(lead[1]) || COMPARE.test(lead[2]) || /\$\s?\d/.test(lead[2]));
        if (isCond) {
          const act = stripEnd(lead[3].replace(GOTO_STRIP, ''));
          const yes = [];
          if (act && !/^(return|go back|loop back|send back|skip|go|jump|continue|proceed)\b/i.test(act)) yes.push(...branchNodes(act, full, { dataText: sen }));
          const negated = /^unless$/i.test(lead[1]);
          dec = { id: id('d'), type: 'decision', title: decisionTitle(lead[2]), branches: [{ label: negated ? 'No' : 'Yes', nodes: negated ? [] : yes }, { label: negated ? 'Yes' : 'No', nodes: negated ? yes : [] }] };
          if (g) dec.branches[negated ? 1 : 0].gotoNum = +g[1];
          out.push(dec); lastDec = dec; return;
        }
        /* R12 (Karen): "If spend over $25k Karen approves too": a leading condition with no comma before the action */
        const bare = !lead && /^(if|when|where|should)\s+(.+)$/i.exec(stripEnd(sen));
        if (bare && (COMPARE.test(bare[2]) || /\$\s?\d/.test(bare[2]))) {
          const ws = bare[2].split(/\s+/);
          const amt = ws.findIndex(w => /^\$?\d/.test(w));
          let made = null;
          for (let j = Math.max(1, amt + 1); j < ws.length && !made; j++) {
            const rest = ws.slice(j).join(' ');
            if (!(splitActor(rest).actor || (isBase(ws[j]) && !/^(per|a|an)$/i.test(ws[j])))) continue;
            const st = makeStep(rest, full, { dataText: sen });
            made = { id: id('d'), type: 'decision', title: decisionTitle(ws.slice(0, j).join(' ')), branches: [{ label: 'Yes', nodes: [st] }, { label: 'No', nodes: [] }] };
          }
          if (made) { dec = made; out.push(dec); lastDec = dec; return; }
        }
        /* R14 (BPM-5): "Limits above $250,000 also need sign-off from the Controller (Sam Wu)": a choice whose Yes path is
           the extra sign-off, never a step every request goes through */
        const need = !main && si === 0 && NEED_RE.exec(stripEnd(sen));
        if (need && (roleWords(squash(need[6]).replace(/\s*\([^)]*\)\s*$/, '').replace(/^(the|a|an)\s+/i, '').split(' ')) || isTeam(squash(need[6])))) {
          const verb = /^sign/i.test(need[5]) ? (/off/i.test(need[5]) ? 'signs off' : 'signs') : /^approv/i.test(need[5]) ? 'approves' : 'reviews';
          const st = makeStep(`${squash(need[6])} ${verb}`, full, { dataText: sen });
          if (st.type === 'step' && need[4]) { st.title = 'Also ' + st.title.replace(/^./, c => c.toLowerCase()); st.approval = true; }
          else if (st.type === 'step' && verb !== 'reviews') st.approval = true;
          dec = { id: id('d'), type: 'decision', title: decisionTitle(`${need[1]} ${need[2]} ${need[3]}`), branches: [{ label: 'Yes', nodes: [st] }, { label: 'No', nodes: [] }] };
          out.push(dec); lastDec = dec; return;
        }
        /* "…, if it is over $5,000" / "… only if …" with no comma before the action */
        const trail = /^(.+?)\s+(?:only\s+)?(if|unless)\s+(.+)$/i.exec(sen);
        if (trail && !main && si === 0 && (COMPARE.test(trail[3]) || /\$\s?\d/.test(trail[3]))) {
          const st = makeStep(trail[1], full, { dataText: sen });
          dec = { id: id('d'), type: 'decision', title: decisionTitle(trail[3]), branches: [{ label: 'Yes', nodes: [st] }, { label: 'No', nodes: [] }] };
          out.push(dec); lastDec = dec; main = st; return;
        }
        if (g && !main) {
          /* "Return to step 2" as a line of its own: a rework choice */
          dec = { id: id('d'), type: 'decision', title: 'Rework needed?', branches: [{ label: 'Yes', nodes: [], gotoNum: +g[1] }, { label: 'No', nodes: [] }] };
          const rest = stripEnd(sen.replace(GOTO_STRIP, ''));
          if (rest.length > 3) dec.branches[0].nodes.push(makeStep(rest, full));
          out.push(dec); lastDec = dec; return;
        }
        if (g && lastDec) { const br = lastDec.branches[1]; if (!br.nodes.length && !br.gotoNum) { br.gotoNum = +g[1]; return; } }
        if (!main) {
          /* the line's main clause: qualifier clauses ("usually by email, sometimes fax") stay in the note */
          const parts = sen.split(/,\s+|\s+[—–]\s+|\s+\(|\)/);
          let keep = [parts[0]], k = 1;
          for (; k < parts.length; k++) { if (QUALIFIER.test(parts[k].trim())) break; keep.push(parts[k]); }
          const titleText = k < parts.length ? keep.join(', ') : sen;
          if (k < parts.length) notes.push(stripEnd(parts.slice(k).join(', ').replace(/^[\s,(]+|[\s,)]+$/g, '')));
          main = makeStep(titleText.replace(GOTO_STRIP, ''), compound.has(sen) ? sen : full, { dataText: sen });
          out.push(main);
          return;
        }
        /* R13 #9: a part of a compound sentence, or a check of its own ("Check OFAC/sanctions list."), is a step */
        if (compound.has(sen) || CONTROL_LINE.test(sen)) {
          const st = makeStep(sen, sen, { dataText: sen });
          out.push(st);
          return;
        }
        /* R15 (Karen): "AP verifies the bank letter by calling the bank" after the vendor's step is AP's own step */
        const sa = main.type === 'step' && splitActor(stripEnd(sen));
        if (sa && sa.actor && canonRole(sa.actor).toLowerCase() !== String(main.ownerRole || '').toLowerCase() && /^(verify|check|validate|confirm|inspect|reconcile|audit|double-check|cross-check|review)\b/i.test(sa.action)) {
          out.push(makeStep(sen, sen, { dataText: sen }));
          return;
        }
        /* any other sentence on the line is part of the same step: kept in its note, its information on the step */
        notes.push(stripEnd(sen));
        /* R12: "Sam Wu signs off." after the step: its Accountable */
        if (main.type === 'step') { const rc = raciIn(stripEnd(sen)); if (rc.raci) mergeRaci(main, rc.raci); }
        if (main.type === 'step') infoPhrases(withoutSystems(sen)).forEach(nm => propose(nm, full, main));
      });
      if (main && main.type === 'step') notes.forEach(x => addNote(main, x));
      else if (!main && out.length && notes.length) notes.forEach(x => addNote(out[0].branches && out[0].branches[0].nodes[0], x));
      /* a decision that came from the line's leading condition sits first; a trailing one after the main step */
      return out;
    };

    let timerHosts = [];
    const lines = text.replace(/\t/g, '    ').split(/\r?\n/);
    let trigger = 'Process starts';
    for (const rl of lines) { const t = rl.trim(); const m = TRIGGER_LINE.exec(t) || TRIGGER_PROSE.exec(t); if (m) { trigger = cap(tidy(m[m.length - 1].replace(/[.;]$/, ''))) || trigger; break; } }
    const marked = lines.filter(l => NUM.test(l.trim()) || BULLET.test(l.trim()));
    const hasNum = lines.some(l => NUM.test(l.trim()) && !SUBNUM.test(l.trim()));
    /* items: [{num, body, subs:[text], indent}] */
    const items = [];
    let firstContent = true;
    if (marked.length) {
      let prevBlank = false;
      for (const rl of lines) {
        if (!rl.trim()) { prevBlank = true; continue; }
        const indent = rl.match(/^\s*/)[0].length;
        const t = rl.trim();
        const wasFirst = firstContent; firstContent = false;
        const last = items[items.length - 1];
        const ownLine = /^(?:[-*•–]\s+|[a-z][.)]\s+)?(?:step\s+)?owner\s*[:\-–—]\s*(.+?)\.?$/i.exec(t);
        if (ownLine && last) { last.owner = ownLine[1]; prevBlank = false; continue; }
        const isNum = NUM.test(t) && !SUBNUM.test(t), isSub = SUBNUM.test(t), isLetter = !isNum && LETTER.test(t), isBullet = BULLET.test(t);
        /* R11: metadata lines ("Purpose: …") are skipped only when they are not numbered: a numbered line is always a step */
        if (!isNum && (SKIP_LINE.test(t.replace(BULLET, '')) || /^#+\s/.test(t) || TRIGGER_LINE.test(t))) { prevBlank = false; continue; }
        const body = t.replace(SUBNUM, '').replace(NUM, '').replace(LETTER, '').replace(BULLET, '').trim();
        if (!body) { prevBlank = false; continue; }
        if (isNum || (isBullet && ((!hasNum && indent === 0) || !last))) {
          const m = /(\d+)/.exec(t); items.push({ num: isNum && m ? +m[1] : null, body, subs: [], indent, text: t }); prevBlank = false; continue;
        }
        if (last && (isSub || isLetter || isBullet)) { last.subs.push(body); prevBlank = false; continue; }
        /* a wrapped line straight after a step (indented, no blank line between) continues it */
        if (last && !prevBlank && indent > 0 && !last.subs.length) { last.body += ' ' + body; continue; }
        /* R11: an unnumbered "Otherwise, …" / "If not, …" line belongs to the step above it (its choice's other path) */
        if (last && /^(?:otherwise|else|if\s+not)\b/i.test(body)) { last.body += ' ' + body; prevBlank = false; continue; }
        if (wasFirst) { prevBlank = false; continue; }
        /* R13 #9: an unnumbered check or condition between numbered steps is a line of its own (and is counted) */
        if (last && hasNum && actionLine(body)) { items.push({ num: null, body, subs: [], indent, text: t }); prevBlank = false; continue; }
        /* prose between steps is kept as a note on the step above (nothing is dropped); prose before the list is intro */
        if (last && !/^(?:[A-Z][\w ]{0,30}):\s*$/.test(t)) (last.extra = last.extra || []).push(body);
        prevBlank = false;
      }
    } else {
      /* no list markers: every sentence of the prose is a step (title and metadata lines skipped) */
      const prose = [];
      lines.forEach((rl, i) => {
        const t = rl.trim(); if (!t) return;
        if (SKIP_LINE.test(t) || /^#+\s/.test(t) || TRIGGER_LINE.test(t) || TRIGGER_PROSE.test(t)) return;
        if (i === lines.findIndex(x => x.trim()) && !/[.!?]$/.test(t) && t.split(/\s+/).length <= 8) return;
        prose.push(t);
      });
      prose.join(' ').split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(s => s.length >= 3).forEach(s => {
        if (ELSE_RE.test(s) && items.length) items[items.length - 1].body += ' ' + s;
        else items.push({ num: null, body: s, subs: [], text: s });
      });
    }

    const nodes = [];
    const lineFirst = {};
    /* R11 G2: every numbered or bulleted line is accounted for: lineMap[i] = {line, num, text, as, nodes:[ids]}.
       as: 'step' (one or more steps or choices), 'else' (the other path of the choice above), 'timer' (a time limit on an
       earlier step), 'parallel'. Nothing is dropped: a line the reader cannot place becomes a plain step. */
    const lineMap = [];
    const record = (it, idx, as, ids) => lineMap.push({ line: idx + 1, num: it.num, text: clip(squash(it.text || it.body), 120), as, nodes: ids.filter(Boolean) });
    const lastTop = () => nodes[nodes.length - 1];
    items.forEach((it, idx) => {
      if (nodes.length >= 200) { const st = makeStep(it.body, it.body); nodes.push(st); record(it, idx, 'step', [st.id]); return; }
      /* R11: "Otherwise, the Credit Analyst approves." on a line of its own is the other path of the choice just above it */
      const el = /^(?:otherwise|else)\b[,:]?\s*(.*)$|^if\s+not\s*[,:]\s*(.*)$/i.exec(squash(it.body));
      const prevDec = lastTop() && lastTop().type === 'decision' ? lastTop() : null;
      if (el && prevDec && !escalationOf(it.body)) {
        const restRaw = stripEnd(el[1] != null ? el[1] : el[2] || '');
        const g = GOTO_RE.exec(restRaw);
        const rest = stripEnd(restRaw.replace(GOTO_STRIP, ''));
        const br = prevDec.branches.slice().reverse().find(b => !b.nodes.length && b.gotoNum == null) || prevDec.branches[1];
        const made = [];
        if (rest && !/^(return|go back|loop back|send back|skip|go|jump|continue|proceed|carry on)\b/i.test(rest)) {
          const bn = branchNodes(rest, it.body), st = bn[0];
          const other = (prevDec.branches.find(b => b !== br) || { nodes: [] }).nodes[0];
          if (st.type === 'step' && other && other.type === 'step' && st.title.split(' ').length === 1 && other.title.toLowerCase().startsWith(st.title.toLowerCase() + ' ')) st.title = other.title;
          it.subs.forEach(sb => st.subs && st.subs.push({ title: cap(tidy(stripEnd(sb))), data: [] }));
          br.nodes.push(...bn); made.push(st.id);
        }
        if (g) br.gotoNum = +g[1];
        if (it.num != null) lineFirst[it.num] = made[0] || prevDec.id;
        record(it, idx, 'else', made.length ? made : [prevDec.id]);
        return;
      }
      /* "At the same time, A and B": a parallel set */
      if (PAR_RE.test(it.body)) {
        const rest = squash(it.body.replace(PAR_RE, ' ')).replace(/^[\s,:;-]+|[\s,]+$/g, '');
        const parts = rest.replace(/[.:]$/, '').split(/\s*;\s*|,?\s+and\s+(?=(?:the\s+)?[A-Z])|,\s*while\s+/).map(x => x.trim()).filter(x => x.length >= 3);
        const acting = parts.filter(x => splitActor(x).actor || isBase(x.split(' ')[0]));
        if (parts.length >= 2 && acting.length === parts.length) {
          const steps = parts.map(x => makeStep(x, it.body));
          const gw = { id: id('p'), type: 'parallel', title: 'At the same time', branches: steps.map((s, i) => ({ label: s.ownerRole || 'Path ' + String.fromCharCode(65 + i), nodes: [s] })) };
          it.subs.forEach(sb => steps[steps.length - 1].subs.push({ title: cap(tidy(stripEnd(sb))), data: [] }));
          if (it.num != null) lineFirst[it.num] = gw.id;
          nodes.push(gw); record(it, idx, 'parallel', [gw.id]); return;
        }
        if (/:$/.test(it.body.trim()) || !parts.length) {
          /* "In parallel:" followed by sub-items: each sub-item is a path */
          const steps = it.subs.map(sb => makeStep(sb, sb));
          if (steps.length >= 2) {
            const gw = { id: id('p'), type: 'parallel', title: 'At the same time', branches: steps.map((s, i) => ({ label: s.ownerRole || 'Path ' + String.fromCharCode(65 + i), nodes: [s] })) };
            if (it.num != null) lineFirst[it.num] = gw.id;
            nodes.push(gw); record(it, idx, 'parallel', [gw.id]); return;
          }
        }
      }
      let out = lineNodes(it.body.replace(/^(?:notes?|nb|tip)\s*[:\-–—]\s*/i, ''), it.num, nodes);
      /* a line that is only a time limit on an earlier step ("If the Credit Manager does not approve within 2 days, …") */
      if (!out.length && timerHosts.length) { record(it, idx, 'timer', timerHosts.slice()); return; }
      /* never drop a line: whatever the reader could not place is kept as a plain step with the line's own words */
      if (!out.length) { const st = makeStep(it.body.replace(/^(?:otherwise|else)\b[,:]?\s*/i, ''), it.body, { noWait: true }); out = [st]; }
      const main = out.find(n => n.type === 'step' || n.type === 'wait') || null;
      if (main && main.type === 'step') {
        (it.extra || []).forEach(x => addNote(main, stripEnd(x)));
        if (it.owner) { main.ownerRole = canonRole(it.owner); main.touches = [...new Set(main.touches.concat(teamOfRole(main.ownerRole)))]; addTeams(main.touches); }
        it.subs.forEach(sb => {
          const sub = { title: cap(tidy(stripEnd(sb))), data: [] };
          main.subs.push(sub);
          infoPhrases(withoutSystems(sb)).forEach(nm => propose(nm, sb, main));
        });
      } else if (it.subs.length && out[0] && out[0].branches) {
        const host = out[0].branches[0].nodes[0];
        if (host) it.subs.forEach(sb => host.subs.push({ title: cap(tidy(stripEnd(sb))), data: [] }));
      }
      if (it.num != null && out[0]) lineFirst[it.num] = out[0].id;
      out.forEach(n => nodes.push(n));
      record(it, idx, 'step', out.map(n => n.id).concat(timerHosts));
    });
    /* R12 (BPM expert): "If the requested limit is under $50k, approve it." followed by the Credit Manager's review: the
       Yes path is already approved, so it skips the review (and the review's reject choice) to the next step. Only when
       the No path is empty and the text gives the Yes path no destination of its own. */
    const LOW = /\b(under|below|less than|at most|up to|no more than|not over|not more than)\b/i;
    const isReview = n => n && n.type === 'step' && /^(approve|review|authori[sz]e|sign|decide|countersign|co-approve|check and approve)\b/i.test(n.title);
    nodes.forEach((d, i) => {
      if (!d || d.type !== 'decision' || !LOW.test(d.title)) return;
      const yes = d.branches[0], no = d.branches[1];
      if (!yes || !no || String(yes.label).toLowerCase() !== 'yes' || yes.goto != null || yes.gotoNum != null || no.nodes.length || no.gotoNum != null) return;
      if (yes.nodes.some(n => n.type === 'end')) return;
      if (!yes.nodes.some(n => n.type === 'step' && /^(also\s+)?(approve|authori[sz]e|accept|sign off)\b/i.test(n.title))) return;
      let j = i + 1;
      if (!isReview(nodes[j])) return;
      j++;
      while (nodes[j] && nodes[j].type === 'decision' && rejectBranch(nodes[j]) && rejectBranch(nodes[j]) === nodes[j].branches[0]) j++;
      if (nodes[j]) yes.goto = nodes[j].id;
      else yes.nodes.push({ id: 'e' + d.id, type: 'end', title: 'Done: approved' });
      d.skips = true;
    });
    /* "return to step N": the branch loops back to the first node that line N produced */
    const walk = (ns, f) => (ns || []).forEach(n => { f(n); (n.branches || []).forEach(b => walk(b.nodes, f)); });
    walk(nodes, n => (n.branches || []).forEach(b => { if (b.gotoNum != null) { if (lineFirst[b.gotoNum]) b.goto = lineFirst[b.gotoNum]; delete b.gotoNum; } }));
    /* R15 (BPM): "Otherwise, go to step 5" when step 5 comes next is just carrying on, never a jump ("Skips to"/"Loop back") */
    const dropNext = ns => (ns || []).forEach((n, i) => (n.branches || []).forEach(b => { if (b.goto && ns[i + 1] && b.goto === ns[i + 1].id) delete b.goto; dropNext(b.nodes); }));
    dropNext(nodes);
    /* R11: a rejected request stops unless the procedure says where it goes */
    walk(nodes, endRejectPath);
    /* R14 (BPM-5): the amount threshold each choice tests, so a path that took "under $50k" is never tested through
       "above $250,000" (business tests read decision.threshold with thresholdsDisjoint) */
    walk(nodes, n => { if (n.type === 'decision') { const th = thresholdOf(n.title); if (th) { if (compoundCond(n.title)) th.compound = true; n.threshold = th; } } });
    /* R13 #8: one actor however it is written. "Controller (Sam Wu)", "the Controller" and "Sam Wu" are the same person
       when the procedure ties the name to the role once; their steps share the role and their RACI the "Role (Name)" */
    const al = actorAliases(nodes);
    const full = v => { const k = al.get(squash(v).toLowerCase()); return k || v; };
    walk(nodes, n => {
      if (n.type !== 'step') return;
      const pr = n.ownerRole && /^(.+) \((.+)\)$/.exec(full(n.ownerRole));
      if (pr && n.ownerRole.toLowerCase() === pr[2].toLowerCase()) {
        n.ownerRole = pr[1];
        if (!/Named in the procedure/.test(n.note || '')) n.note = n.note ? `Named in the procedure: ${pr[2]} · ${n.note}` : `Named in the procedure: ${pr[2]}`;
        n.touches = [...new Set((n.touches || []).concat(teamOfRole(n.ownerRole)))]; addTeams(n.touches);
      }
      if (n.raci) {
        if (n.raci.a) n.raci.a = full(n.raci.a);
        ['c', 'i'].forEach(k => { if (n.raci[k]) n.raci[k] = [...new Set(n.raci[k].map(full))]; });
      }
      /* "X approves" / "X signs off": the approver is Accountable for the step (A), as well as doing it (R) */
      if (n.ownerRole && !(n.raci && n.raci.a) && /^(?:also\s+)?(?:approve|co-approve|sign\s+off|sign-off|authori[sz]e|countersign)\b/i.test(n.title || '')) {
        const nm = /Named in the procedure: ([^·]+?)(?:\s*·|$)/.exec(n.note || '');
        (n.raci || (n.raci = {})).a = full(nm ? `${n.ownerRole} (${nm[1].trim()})` : n.ownerRole);
      }
    });
    /* the notes after a sign-off sentence ("Sam Wu signs off") stay; the Accountable is the merged name */
    nodes.unshift({ id: 'k', type: 'trigger', title: trigger, touches: [] });
    const c = countNodes(nodes);
    const roles = []; walk(nodes, n => { if (n.type === 'step' && n.ownerRole && !roles.includes(n.ownerRole)) roles.push(n.ownerRole); });
    const nobody = []; walk(nodes, n => { if (n.type === 'step' && !n.ownerRole) nobody.push(n); });
    const notes = [`Found ${plural(c.steps, 'step')}${c.decisions ? `, ${plural(c.decisions, 'choice')}` : ''}${c.parallels ? ` and ${plural(c.parallels, 'set')} of steps done at the same time` : ''}${c.waits ? `, ${plural(c.waits, 'wait')}` : ''}.`,
      roles.length ? `Who does them, as written: ${roles.join(', ')}.` : '',
      nobody.length ? `${plural(nobody.length, 'step')} ${nobody.length === 1 ? 'does' : 'do'} not say who does ${nobody.length === 1 ? 'it' : 'them'}.` : '',
      'Check each step before saving.'].filter(Boolean).join(' ');
    return { nodes, newData, notes, trigger, teams: teamsAll, name: deriveName(text), lines: lineMap, linesText: linesText(lineMap.length, c) };
  }
  /* R13 #8: who is who. Every "Role (Name)" the map writes (a step's role with its named person, or a RACI entry) makes the
     role, the name and the pair one actor. actorAliases(nodes) -> Map(lower-case spelling -> "Role (Name)"); a role
     written with two different names is left alone (it is two people). actorKey(v, aliases) -> the one spelling. */
  function actorAliases(nodes) {
    const pairs = [];
    const add = (role, name) => { role = squash(role); name = squash(name); if (role && name && role.toLowerCase() !== name.toLowerCase()) pairs.push([role, name]); };
    const walkA = ns => (ns || []).forEach(n => {
      if (!n) return;
      const nm = /Named in the procedure: ([^·]+?)(?:\s*·|$)/.exec(n.note || '');
      if (n.ownerRole && nm) add(n.ownerRole, nm[1]);
      const r = n.raci || {};
      [].concat(r.a || [], r.c || [], r.i || []).forEach(v => { const m = /^(.*?)\s*\(([A-Z][^)]{1,40})\)$/.exec(squash(v)); if (m) add(m[1], m[2]); });
      (n.branches || []).forEach(b => walkA(b.nodes));
    });
    walkA(nodes);
    const out = new Map(), byRole = {}, byName = {};
    pairs.forEach(([r, n]) => { (byRole[r.toLowerCase()] = byRole[r.toLowerCase()] || new Set()).add(n.toLowerCase()); (byName[n.toLowerCase()] = byName[n.toLowerCase()] || new Set()).add(r.toLowerCase()); });
    pairs.forEach(([r, n]) => {
      const fullName = `${r} (${n})`;
      out.set(fullName.toLowerCase(), fullName);
      if (byName[n.toLowerCase()].size === 1) out.set(n.toLowerCase(), fullName);
      if (byRole[r.toLowerCase()].size === 1) out.set(r.toLowerCase(), fullName);
    });
    return out;
  }
  function actorKey(v, aliases) { const x = squash(v); return (aliases && aliases.get(x.toLowerCase())) || x; }
  /* the rows a RACI matrix lists: every numbered step, waits, messages and sub-processes included, in map order */
  function raciRowsOf(nodes) {
    const out = [];
    const w = ns => (ns || []).forEach(n => { if (!n) return; if (n.type === 'step' || n.type === 'wait' || n.type === 'message' || n.type === 'subprocess') out.push(n); (n.branches || []).forEach(b => w(b.nodes)); });
    w(nodes);
    return out;
  }
  /* "9 lines → 9 steps", "12 lines → 11 steps, 2 choices": the one sentence every screen shows for what the reader made */
  function linesText(lines, c) {
    const bits = [plural(c.steps + (c.waits || 0) + (c.messages || 0) + (c.subprocesses || 0), 'step')];
    if (c.decisions) bits.push(plural(c.decisions, 'choice'));
    if (c.parallels) bits.push(plural(c.parallels, 'set') + ' at the same time');
    return `${plural(lines, 'line')} → ${bits.join(', ')}`;
  }
  /* lines of a pasted procedure the reader treats as steps (numbered or bulleted; prose sentences when there are none) */
  function sopLines(text) { return parseSop(text).lines; }
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 3).replace(/\s+\S*$/, '') + '…' : t);
  /* the API's rules fallback: same output as parseSop. Workspace docs are ignored on purpose (demo-data isolation). */
  function sopRules(text /* , docs */) { const r = parseSop(text); return { nodes: r.nodes, newData: r.newData, notes: r.notes, trigger: r.trigger, teams: r.teams, name: r.name, lines: r.lines, linesText: r.linesText }; }

  /* counts by kind, the same way on every screen: wait and message nodes are numbered steps of their own kind */
  function countNodes(nodes) {
    const c = { steps: 0, waits: 0, messages: 0, subprocesses: 0, decisions: 0, parallels: 0, ends: 0 };
    const walk = ns => (ns || []).forEach(n => {
      if (!n) return;
      if (n.type === 'decision') c.decisions++; else if (n.type === 'parallel') c.parallels++;
      else if (n.type === 'wait') c.waits++; else if (n.type === 'message') c.messages++; else if (n.type === 'subprocess') c.subprocesses++;
      else if (n.type === 'end') c.ends++; else if (n.type !== 'trigger') c.steps++;
      (n.branches || []).forEach(b => walk(b.nodes));
    });
    walk(nodes);
    return c;
  }

  /* ---------------------------------------------------------------- ZIP (stored + deflate) */
  function u8(b) { return b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset || 0, b.byteLength); }
  async function inflateRaw(data) {
    if (typeof process !== 'undefined' && process.versions && process.versions.node && typeof require === 'function') {
      return new Uint8Array(require('zlib').inflateRawSync(Buffer.from(data)));
    }
    if (typeof DecompressionStream === 'function') {
      const ds = new DecompressionStream('deflate-raw');
      const out = new Response(new Blob([data]).stream().pipeThrough(ds));
      return new Uint8Array(await out.arrayBuffer());
    }
    throw new Error('This browser cannot open compressed files.');
  }
  const utf8 = b => (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8').decode(b) : Buffer.from(b).toString('utf8'));
  async function unzip(bytes) {
    const b = u8(bytes);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    /* end of central directory: scan back for its signature */
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This file is not a Visio (.vsdx) file: no ZIP directory found.');
    const count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
    const files = {};
    let p = cdOff;
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The file is damaged (bad ZIP directory).');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
      const name = utf8(b.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (/\/$/.test(name)) continue;
      const lnlen = dv.getUint16(loc + 26, true), lxlen = dv.getUint16(loc + 28, true);
      const start = loc + 30 + lnlen + lxlen, raw = b.subarray(start, start + csize);
      if (method === 0) files[name] = raw;
      else if (method === 8) files[name] = await inflateRaw(raw);
      else throw new Error(`The file uses a ZIP compression PMOFlow cannot read (method ${method}).`);
    }
    return files;
  }

  /* ---------------------------------------------------------------- XML */
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unent = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] != null ? ENT[e] : m);
  /* parseXml(text) -> {name, local, attrs, children, text}; throws on unbalanced tags */
  function parseXml(text) {
    const src = String(text).replace(/^﻿/, '');
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    const rootEl = { name: '#doc', local: '#doc', attrs: {}, children: [], text: '' };
    const stack = [rootEl];
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) { top.text += m[1]; continue; }
      if (m[6] !== undefined) { top.text += unent(m[6]); continue; }
      if (!m[3]) continue;
      if (m[2]) { const open = stack.pop(); if (!open || open.name !== m[3]) throw new Error(`The file is not well-formed XML (unexpected </${m[3]}>).`); continue; }
      const attrs = {};
      m[4].replace(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (x, k, v1, v2) => { attrs[k] = unent(v1 != null ? v1 : v2); return ''; });
      const el = { name: m[3], local: m[3].split(':').pop(), attrs, children: [], text: '' };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    }
    if (stack.length !== 1) throw new Error('The file is not well-formed XML (unclosed elements).');
    const r = rootEl.children[0];
    if (!r) throw new Error('The file has no XML content.');
    return r;
  }
  const kids = (el, local) => (el && el.children || []).filter(c => !local || c.local === local);
  const kid = (el, local) => kids(el, local)[0] || null;
  function all(el, local, out) { out = out || []; (el && el.children || []).forEach(c => { if (c.local === local) out.push(c); all(c, local, out); }); return out; }
  const textOf = el => !el ? '' : el.text + (el.children || []).map(textOf).join('');

  /* ---------------------------------------------------------------- Visio (.vsdx) */
  /* master name -> kind */
  function shapeKind(master, text) {
    const m = String(master || '').toLowerCase();
    if (/connector|line|arrow/.test(m)) return 'connector';
    if (/swimlane|swim lane|^lane|cff container|functional band|separator/.test(m)) return 'lane';
    if (/decision|diamond/.test(m)) return 'decision';
    /* R12: a Start/End drawn as an ellipse or circle is the start or the end, never a step */
    if (/start|end|terminator|terminal|ellipse|circle|oval/.test(m)) return /^\s*(end|stop|finish|done|complete)/i.test(text || '') ? 'end' : /^\s*(start|begin)/i.test(text || '') ? 'start' : 'terminator';
    if (/parallel|fork|join/.test(m)) return 'parallel';
    if (/delay|timer|wait/.test(m)) return 'wait';
    if (/data|document|database|stored data|internal storage/.test(m)) return 'data';
    if (/process|subprocess|sub-process|predefined|action|task|step|rectangle|box|manual|preparation/.test(m)) return 'process';
    if (/title|page|legend|annotation|text|callout|container|pool/.test(m)) return 'ignore';
    return text ? 'process' : 'ignore';
  }
  /* R12 (BPM expert): what a shape is from its words when its master does not say: "Start"/"End" are the start and the
     end, a question ("Eligible?") is a choice */
  function refineKind(kind, text) {
    if (kind !== 'process') return kind;
    if (/^\s*(start|begin|process starts)\s*$/i.test(text || '')) return 'start';
    if (/^\s*(end|stop|finish|done|complete|completed|process ends)\s*$/i.test(text || '')) return 'end';
    if (/\?\s*$/.test(text || '')) return 'decision';
    return kind;
  }
  const cell = (sh, n) => { const c = kids(sh, 'Cell').find(x => x.attrs.N === n); return c ? Number(c.attrs.V) : NaN; };
  /* parseVsdx(bytes) -> {name, nodes, lanes, links, steps, decisions, parallels, dropped, bpmn}
     Shapes become steps (Process), choices (Decision), start/end (Start/End); Dynamic connectors become links (their
     text becomes the path label); swimlanes become roles (a step belongs to the lane whose box holds its centre).
     Data / Document shapes connected to a step become that step's information. */
  async function parseVsdx(bytes, opts) {
    opts = opts || {};
    const files = await unzip(bytes);
    /* R13 #14 (Jordan): the page to read is the first foreground page pages.xml lists, found through its relationship
       (pages/_rels/pages.xml.rels); a background page (title block, border) is never the process. Without the index,
       the lowest-numbered page file. */
    const pageFiles = Object.keys(files).filter(n => /^visio\/pages\/page\d*\.xml$/i.test(n)).sort((a, b) => (parseInt(a.replace(/\D+/g, ''), 10) || 0) - (parseInt(b.replace(/\D+/g, ''), 10) || 0));
    let pageName = '', pageTitle = '';
    const px = files['visio/pages/pages.xml'], prx = files['visio/pages/_rels/pages.xml.rels'];
    if (px) {
      const rels = {};
      if (prx) all(parseXml(utf8(prx)), 'Relationship').forEach(r => { rels[r.attrs.Id] = 'visio/pages/' + String(r.attrs.Target || '').replace(/^\.?\//, '').replace(/^.*\/pages\//, ''); });
      const pages = all(parseXml(utf8(px)), 'Page');
      const fg = pages.filter(pg => !/^(1|true)$/i.test(pg.attrs.Background || ''));
      for (const pg of (fg.length ? fg : pages)) {
        const rel = kid(pg, 'Rel'), rid = rel && (rel.attrs['r:id'] || Object.keys(rel.attrs).filter(k => /(^|:)id$/i.test(k)).map(k => rel.attrs[k])[0]);
        const f = rid && rels[rid] && files[rels[rid]] ? rels[rid] : (!prx ? pageFiles[pages.indexOf(pg)] : '');
        if (!f || !files[f]) continue;
        pageName = f;
        /* R11 G2 §9: the process takes the diagram PAGE's name ("Vendor onboarding"), not the file's; a default page name
           ("Page-1") falls back to the document title */
        const nm = squash(pg.attrs.Name || pg.attrs.NameU || '');
        if (nm && !/^(page|seite|página|pagina)[-\s]?\d*$/i.test(nm)) pageTitle = nm;
        break;
      }
    }
    if (!pageName) pageName = pageFiles[0];
    if (!pageName) throw new Error('No diagram page was found in this Visio file.');
    const masters = {};
    const mx = files['visio/masters/masters.xml'];
    if (mx) kids(parseXml(utf8(mx)), 'Master').forEach(m => { masters[m.attrs.ID] = m.attrs.NameU || m.attrs.Name || ''; });
    let docTitle = '';
    const core = files['docProps/core.xml']; if (core) { const t = all(parseXml(utf8(core)), 'title')[0]; docTitle = t ? squash(textOf(t)) : ''; }
    const page = parseXml(utf8(files[pageName]));
    const shapes = {}, dropped = [];
    const shapesEl = kid(page, 'Shapes');
    /* R14 (Jordan 7): a connector glued to a sub-shape of a step or a choice is glued to that step or choice */
    const alias = {};
    const aliasIn = (c, top) => { alias[c.attrs.ID] = top; kids(kid(c, 'Shapes'), 'Shape').forEach(x => aliasIn(x, top)); };
    const visit = (sh, parent) => {
      const idv = sh.attrs.ID; const master = masters[sh.attrs.Master] || (parent && parent.master) || sh.attrs.NameU || sh.attrs.Name || '';
      let text = squash(textOf(kid(sh, 'Text'))), role = '';
      /* R14 (Jordan 7): a grouped shape (a decision drawn as a group) keeps its words in a sub-shape */
      const subs = kids(kid(sh, 'Shapes'), 'Shape');
      if (!text && subs.length) text = squash(subs.map(c => textOf(kid(c, 'Text'))).filter(Boolean)[0] || '');
      /* R13 #14 (Jordan): "Benefits Analyst: Check eligibility" names who does the step */
      /* R14 (BPM-5): "Controller (Sam Wu): Sign off" and "Submit the request (Sales rep)" name who does it too; the lane
         keeps "Role (Name)" so the BPMN reader reads it the one way (roleAndName) */
      const roleText = x => { const rn = roleAndName(x); return rn.role ? (rn.name ? `${rn.role} (${rn.name})` : rn.role) : ''; };
      const rt = /^([A-Za-z][\w&/' -]{1,40}?(?:\s*\([^()]{1,40}\))?):\s+(\S.*)$/.exec(text);
      if (rt && (looksRole(rt[1].replace(/\s*\([^()]*\)$/, '')) || looksRole(rt[1]))) { role = roleText(rt[1].trim()); text = rt[2]; }
      /* R16 (BPM): "Controller sign-off (Controller (Sam Wu))": the brackets hold "Role (Name)" */
      const tn = !role && /^(\S.*?\S)\s*\(([^()]{2,40}\s*\([^()]{1,40}\))\)$/.exec(text);
      if (tn && roleAndName(tn[2]).role) { role = roleText(tn[2]); text = tn[1]; }
      const tr = !role && /^(\S.*?\S)\s*\(([^()]{2,40})\)$/.exec(text);
      if (tr && looksRole(tr[2])) { role = roleText(tr[2]); text = tr[1]; }
      /* R12: a 1-D shape (it has a begin and an end point) is a connector whatever its master is called */
      const oneD = kids(sh, 'Cell').some(c => c.attrs.N === 'BeginX') && kids(sh, 'Cell').some(c => c.attrs.N === 'EndX');
      const kind = oneD ? 'connector' : refineKind(shapeKind(master, text), text);
      const s = { id: idv, master, text, role, kind, x: cell(sh, 'PinX'), y: cell(sh, 'PinY'), w: cell(sh, 'Width'), h: cell(sh, 'Height') };
      shapes[idv] = s;
      kids(kid(sh, 'Shapes'), 'Shape').forEach(c => { if (kind === 'lane' || kind === 'ignore') visit(c, null); else aliasIn(c, idv); });
    };
    kids(shapesEl, 'Shape').forEach(sh => visit(sh, null));
    /* connectors: BeginX -> from shape, EndX -> to shape */
    const ends = {};
    const connEls = kids(kid(page, 'Connects'), 'Connect');
    /* R12: the sheet a Connect starts from at its BeginX / EndX is a connector, whatever its master is called */
    connEls.forEach(c => { const s = shapes[c.attrs.FromSheet]; if (s && /^(Begin|End)/i.test(c.attrs.FromCell || '')) s.kind = 'connector'; });
    connEls.forEach(c => {
      const con = c.attrs.FromSheet, to = alias[c.attrs.ToSheet] || c.attrs.ToSheet, which = c.attrs.FromCell;
      if (!shapes[con] || !shapes[to]) return;
      const e = ends[con] || (ends[con] = {});
      if (/^Begin/i.test(which)) e.from = to; else if (/^End/i.test(which)) e.to = to;
    });
    const links = [];
    Object.keys(ends).forEach(cid => { const e = ends[cid]; if (e.from && e.to && shapes[cid].kind === 'connector') links.push({ from: e.from, to: e.to, label: shapes[cid].text || '' }); });
    Object.values(shapes).filter(s => s.kind === 'connector' && !(ends[s.id] && ends[s.id].from && ends[s.id].to)).forEach(s => dropped.push({ name: s.text || 'Connector ' + s.id, type: 'connector', reason: 'not attached at both ends' }));
    /* lanes: a box; the lane's title is its text */
    const lanes = Object.values(shapes).filter(s => s.kind === 'lane' && s.text && isFinite(s.x) && isFinite(s.w))
      .map(s => ({ id: s.id, name: s.text, x0: s.x - s.w / 2, x1: s.x + s.w / 2, y0: s.y - s.h / 2, y1: s.y + s.h / 2 }));
    const laneOf = s => { const hit = lanes.filter(l => s.x >= l.x0 && s.x <= l.x1 && s.y >= l.y0 && s.y <= l.y1).sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0]; return hit ? hit.name : ''; };
    /* data shapes attached to a step by a connector become that step's information */
    const dataOf = {};
    links.slice().forEach(l => {
      const a = shapes[l.from], b = shapes[l.to];
      const d = a.kind === 'data' ? a : b.kind === 'data' ? b : null, s = d === a ? b : a;
      if (!d || !s || s.kind === 'data') return;
      (dataOf[s.id] = dataOf[s.id] || []).push(d.text);
      links.splice(links.indexOf(l), 1);
    });
    Object.values(shapes).filter(s => s.kind === 'data' && !Object.values(dataOf).some(x => x.includes(s.text))).forEach(s => dropped.push({ name: s.text || 'Data ' + s.id, type: 'data shape', reason: 'not connected to a step' }));
    const flowKinds = new Set(['process', 'decision', 'start', 'end', 'terminator', 'parallel', 'wait']);
    const flowShapes = Object.values(shapes).filter(s => flowKinds.has(s.kind));
    Object.values(shapes).filter(s => s.kind === 'ignore' && s.text).forEach(s => dropped.push({ name: s.text, type: (s.master || 'shape').toLowerCase(), reason: 'not a flowchart shape' }));
    if (!flowShapes.length) throw new Error('No flowchart shapes (process, decision, start/end) were found in this Visio file.');
    const ins = {}, outs = {};
    links.forEach(l => { if (!flowKinds.has(shapes[l.from].kind) || !flowKinds.has(shapes[l.to].kind)) return; (outs[l.from] = outs[l.from] || []).push(l); (ins[l.to] = ins[l.to] || []).push(l); });
    /* a terminator with no way in is the start; with no way out the end */
    flowShapes.forEach(s => { if (s.kind === 'terminator') s.kind = !(ins[s.id] || []).length ? 'start' : !(outs[s.id] || []).length ? 'end' : 'process'; });
    flowShapes.filter(s => s.kind !== 'start' && s.kind !== 'end' && !(ins[s.id] || []).length && !(outs[s.id] || []).length).forEach(s => dropped.push({ name: s.text || 'Shape ' + s.id, type: s.kind, reason: 'not connected to the flow' }));
    /* R12: a shape left out is listed once */
    const seenDrop = new Set();
    for (let i = 0; i < dropped.length; i++) { const k = dropped[i].type + '|' + dropped[i].name + '|' + dropped[i].reason; if (seenDrop.has(k)) dropped.splice(i--, 1); else seenDrop.add(k); }
    const name = opts.name || pageTitle || docTitle || '';
    const bpmn = vsdxBpmn({ name: name || 'Imported Visio process', shapes, flowShapes, links: links.filter(l => flowKinds.has(shapes[l.from].kind) && flowKinds.has(shapes[l.to].kind)), laneOf, dataOf, ins, outs });
    const c = { steps: flowShapes.filter(s => s.kind === 'process' || s.kind === 'wait').length, decisions: flowShapes.filter(s => s.kind === 'decision').length, parallels: flowShapes.filter(s => s.kind === 'parallel').length };
    /* R14 (Jordan 7): every flow shape, by the id it has in the BPMN, so the app can list any it could not place */
    const flowIds = flowShapes.filter(s => s.kind !== 'start' && s.kind !== 'end').map(s => ({ id: 'V_' + String(s.id).replace(/[^\w.-]/g, '_'), name: s.text || (s.kind + ' ' + s.id), type: s.kind === 'decision' ? 'choice' : s.kind === 'parallel' ? 'at the same time' : s.kind === 'wait' ? 'wait' : 'step' }));
    return Object.assign({ name, lanes: lanes.map(l => l.name), links, dropped, bpmn, flowIds }, c);
  }
  const xa = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /* Visio shapes -> BPMN 2.0 (role lanes, data objects with data input associations) */
  function vsdxBpmn(v) {
    const id = s => 'V_' + String(s.id).replace(/[^\w.-]/g, '_');
    const tag = s => s.kind === 'start' ? 'startEvent' : s.kind === 'end' ? 'endEvent' : s.kind === 'decision' ? 'exclusiveGateway' : s.kind === 'parallel' ? 'parallelGateway' : s.kind === 'wait' ? 'intermediateCatchEvent' : 'userTask';
    const els = [], laneRefs = {}, dataObjs = [];
    let hasStart = false;
    /* order: from the start, breadth first, then anything left (top to bottom) */
    const order = [], seen = new Set();
    const starts = v.flowShapes.filter(s => s.kind === 'start');
    const q = (starts.length ? starts : v.flowShapes.filter(s => !(v.ins[s.id] || []).length).slice(0, 1)).slice();
    while (q.length) { const s = q.shift(); if (seen.has(s.id)) continue; seen.add(s.id); order.push(s); (v.outs[s.id] || []).forEach(l => q.push(v.shapes[l.to])); }
    v.flowShapes.filter(s => !seen.has(s.id)).sort((a, b) => b.y - a.y || a.x - b.x).forEach(s => order.push(s));
    order.forEach(s => {
      const t = tag(s); if (t === 'startEvent') hasStart = true;
      const lane = s.kind === 'start' || s.kind === 'end' ? '' : (s.role || v.laneOf(s));
      if (lane) (laneRefs[lane] = laneRefs[lane] || []).push(id(s));
      let inner = '';
      if (t === 'intermediateCatchEvent') { const d = durationInfo(s.text); inner = `\n      <bpmn:timerEventDefinition id="${id(s)}_timer">${d ? `<bpmn:timeDuration>${d.iso}</bpmn:timeDuration>` : ''}</bpmn:timerEventDefinition>\n    `; }
      if (t === 'userTask' && (v.dataOf[s.id] || []).length) {
        const assoc = v.dataOf[s.id].map((nm, k) => { const did = `DO_${id(s)}_${k}`; dataObjs.push({ id: did, name: nm }); return `      <bpmn:property id="${id(s)}_p${k}" name="__targetRef_placeholder" />\n      <bpmn:dataInputAssociation id="${id(s)}_in${k}"><bpmn:sourceRef>${did}_ref</bpmn:sourceRef><bpmn:targetRef>${id(s)}_p${k}</bpmn:targetRef></bpmn:dataInputAssociation>`; });
        inner = '\n' + assoc.join('\n') + '\n    ';
      }
      els.push(`    <bpmn:${t} id="${id(s)}" name="${xa(s.text)}"${inner ? `>${inner}</bpmn:${t}>` : ' />'}`);
    });
    if (!hasStart) {
      const first = order.find(s => !(v.ins[s.id] || []).length) || order[0];
      els.unshift('    <bpmn:startEvent id="V_start" name="Process starts" />');
      v.links.push({ from: '__start', to: first.id, label: '' });
    }
    const flows = v.links.map((l, i) => `    <bpmn:sequenceFlow id="VF_${i + 1}" sourceRef="${l.from === '__start' ? 'V_start' : id(v.shapes[l.from])}" targetRef="${id(v.shapes[l.to])}"${l.label ? ` name="${xa(l.label)}"` : ''} />`);
    const lanes = Object.keys(laneRefs).map((nm, i) => `      <bpmn:lane id="VL_${i + 1}" name="${xa(nm)}">\n${laneRefs[nm].map(r => `        <bpmn:flowNodeRef>${r}</bpmn:flowNodeRef>`).join('\n')}\n      </bpmn:lane>`);
    const dos = dataObjs.map(d => `    <bpmn:dataObject id="${d.id}" name="${xa(d.name)}" />\n    <bpmn:dataObjectReference id="${d.id}_ref" name="${xa(d.name)}" dataObjectRef="${d.id}" />`);
    return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_Visio" targetNamespace="https://www.necogoode.com/concepts/pmoflow" exporter="PMOFlow Visio reader" exporterVersion="1">
  <bpmn:process id="Process_Visio" name="${xa(v.name)}" isExecutable="false">
${lanes.length ? `    <bpmn:laneSet id="LaneSet_Visio">\n${lanes.join('\n')}\n    </bpmn:laneSet>\n` : ''}${els.join('\n')}
${dos.join('\n')}${dos.length ? '\n' : ''}${flows.join('\n')}
  </bpmn:process>
</bpmn:definitions>
`;
  }

  /* ---------------------------------------------------------------- RACI */
  /* Responsible is the step's owner (person or role). Accountable is one person or role; Consulted and Informed are lists.
     Stored on the step as raci: {a: 'text or person id', c: [...], i: [...]}; every field optional. */
  const RACI_ROLES = [{ key: 'a', label: 'Accountable', hint: 'Signs off on the result' }, { key: 'c', label: 'Consulted', hint: 'Asked before it is done' }, { key: 'i', label: 'Informed', hint: 'Told when it is done' }];
  function raciOf(n) {
    const r = (n && n.raci) || {};
    const listOf = v => (Array.isArray(v) ? v : String(v || '').split(/\s*[,;]\s*/)).map(x => squash(x)).filter(Boolean);
    return { a: squash(Array.isArray(r.a) ? r.a[0] : r.a || ''), c: listOf(r.c), i: listOf(r.i) };
  }
  const raciEmpty = n => { const r = raciOf(n); return !r.a && !r.c.length && !r.i.length; };
  /* "Accountable: Finance Manager · Consulted: Legal, Tax · Informed: Requester"; nameOf maps a person id to a name */
  function raciText(n, nameOf) {
    const r = raciOf(n), nm = x => (nameOf && nameOf(x)) || x;
    return [r.a ? `Accountable: ${nm(r.a)}` : '', r.c.length ? `Consulted: ${r.c.map(nm).join(', ')}` : '', r.i.length ? `Informed: ${r.i.map(nm).join(', ')}` : ''].filter(Boolean).join(' · ');
  }

  /* ---------------------------------------------------------------- templates */
  /* Six generic, editable starter maps. Owners are roles (never workspace people); information is new to the visitor's
     process. Each step: [title, role, [information], options]. options: {sla, system, wait, decision:{title, yes:[steps], no:[steps]}} */
  const TEMPLATES = [
    { id: 'vendor-onboarding', name: 'Vendor onboarding', desc: 'Add a new supplier: request, tax and insurance checks, bank details, set up in the finance system.',
      trigger: 'A team asks to buy from a new vendor', steps: [
        ['Submit a new vendor request', 'Requester', ['Vendor request form']],
        ['Collect the W-9 and certificate of insurance', 'Procurement coordinator', ['W-9', 'Certificate of insurance'], { sla: '5 business days' }],
        ['Screen the vendor against the restricted-party list', 'Compliance analyst', ['Restricted-party screening result']],
        { decision: 'Annual spend over $25,000?', yes: [['Approve the vendor', 'Finance manager', []]], no: [['Approve the vendor', 'Procurement manager', []]] },
        ['Collect and verify bank details with a call-back', 'Treasury analyst', ['Vendor bank details']],
        ['Create the vendor record in the finance system', 'Accounts Payable clerk', ['Vendor master record'], { system: 'ERP' }],
        ['Send the vendor a welcome letter', 'Procurement coordinator', []],
      ] },
    { id: 'employee-onboarding', name: 'Employee onboarding', desc: 'Get a new hire from signed offer to productive first week.',
      trigger: 'A candidate signs the offer letter', steps: [
        ['Enter the new hire in the HR system', 'HR coordinator', ['Signed offer letter', 'New hire record'], { system: 'HRIS' }],
        ['Collect the I-9 and tax forms', 'HR coordinator', ['I-9', 'W-4'], { sla: '3 business days' }],
        { parallel: true, paths: [['Set up accounts and a laptop', 'IT technician', ['Equipment request']], ['Prepare the desk and badge', 'Facilities coordinator', ['Badge request']], ['Enroll the new hire in payroll and benefits', 'Payroll specialist', ['Bank details for direct deposit', 'Benefits election']]] },
        ['Run first-day orientation', 'HR coordinator', ['Orientation checklist']],
        ['Agree first-month goals', 'Hiring manager', ['30-day plan']],
      ] },
    { id: 'employee-offboarding', name: 'Employee offboarding', desc: 'Close out a leaver safely: access, equipment, final pay.',
      trigger: 'An employee gives notice or is terminated', steps: [
        ['Record the termination and last day', 'HR manager', ['Termination record'], { system: 'HRIS' }],
        ['Disable the employee’s accounts on the last day', 'IT technician', ['Access list']],
        ['Collect the laptop and badge', 'Facilities coordinator', ['Equipment return checklist']],
        { decision: 'Equipment returned within 5 days?', yes: [], no: [['Notify Legal', 'Legal counsel', []]] },
        ['Process the final paycheck', 'Payroll specialist', ['Final pay calculation'], { sla: '2 business days' }],
        ['Send the exit survey', 'HR coordinator', ['Exit survey']],
      ] },
    { id: 'invoice-approval', name: 'Invoice approval', desc: 'Check, approve and pay a supplier invoice.',
      trigger: 'A supplier invoice arrives', steps: [
        ['Log the invoice', 'Accounts Payable clerk', ['Supplier invoice'], { system: 'ERP' }],
        ['Match the invoice to the purchase order and receipt', 'Accounts Payable clerk', ['Purchase order', 'Goods receipt']],
        { decision: 'Invoice over $10,000?', yes: [['Approve the invoice', 'Finance manager', []]], no: [['Approve the invoice', 'Budget owner', []]] },
        { wait: 'Wait for the weekly payment run', what: 'the weekly payment run', role: 'Accounts Payable clerk' },
        ['Pay the invoice', 'Treasury analyst', ['Payment file']],
      ] },
    { id: 'purchase-request', name: 'Purchase request', desc: 'Ask for, approve and order something the team needs.',
      trigger: 'An employee needs to buy something', steps: [
        ['Submit a purchase request', 'Requester', ['Purchase request form', 'Budget code']],
        ['Get three quotes', 'Buyer', ['Quotes'], { sla: '5 business days' }],
        ['Approve the request', 'Budget owner', ['Amount']],
        ['Raise the purchase order', 'Buyer', ['Purchase order'], { system: 'ERP' }],
        ['Receive the goods and confirm delivery', 'Requester', ['Goods receipt']],
      ] },
    { id: 'customer-refund', name: 'Customer refund', desc: 'Check a refund request and pay it back the right way.',
      trigger: 'A customer asks for a refund', steps: [
        ['Log the refund request', 'Customer service agent', ['Refund request', 'Order number']],
        ['Check the order and the refund policy', 'Customer service agent', ['Refund policy']],
        { decision: 'Refund over $500?', yes: [['Approve the refund', 'Customer service manager', []]], no: [] },
        ['Issue the refund to the original payment method', 'Billing specialist', ['Refund amount'], { system: 'ERP' }],
        ['Tell the customer the refund is on its way', 'Customer service agent', ['Customer email']],
      ] },
  ];
  /* a template as an import draft (same node shapes parseSop returns), so the visitor checks and edits it before saving */
  function templateDraft(tid) {
    const t = TEMPLATES.find(x => x.id === tid); if (!t) return null;
    let seq = 0;
    const newData = [];
    const mkStep = s => {
      const [title, role, data, o] = s; const opt = o || {};
      const n = { id: 't' + (++seq), type: 'step', title, ownerRole: role, touches: teamOfRole(role), subs: [], newData: [] };
      if (opt.sla) n.sla = opt.sla; if (opt.system) n.system = opt.system;
      (data || []).forEach(nm => { const key = ndKey(nm); let p = newData.find(x => x.key === key); if (!p) { p = Object.assign({ key, name: nm, reason: `Used in the ${t.name.toLowerCase()} template.`, steps: [] }, perRunOf(nm, role, title, t.name + ' ' + t.desc) || {}); newData.push(p); } p.steps.push(n.id); n.newData.push({ key, name: nm }); });
      return n;
    };
    const mk = s => {
      if (Array.isArray(s)) return mkStep(s);
      if (s.decision) return { id: 't' + (++seq), type: 'decision', title: s.decision, branches: [{ label: 'Yes', nodes: (s.yes || []).map(mkStep) }, { label: 'No', nodes: (s.no || []).map(mkStep) }] };
      if (s.parallel) return { id: 't' + (++seq), type: 'parallel', title: 'At the same time', branches: s.paths.map(p => { const st = mkStep(p); return { label: st.ownerRole, nodes: [st] }; }) };
      if (s.wait) return { id: 't' + (++seq), type: 'wait', title: s.wait, wait: s.what };
      return null;
    };
    const nodes = [{ id: 'k', type: 'trigger', title: t.trigger, touches: [] }].concat(t.steps.map(mk).filter(Boolean));
    const teams = []; const walk = ns => ns.forEach(n => { (n.touches || []).forEach(x => { if (!teams.includes(x)) teams.push(x); }); (n.branches || []).forEach(b => walk(b.nodes)); }); walk(nodes);
    return { id: t.id, name: t.name, desc: t.desc, trigger: t.trigger, nodes, newData, teams, notes: '', source: 'template' };
  }

  return { parseSop, sopRules, sopLines, linesText, escalationOf, endRejectPath, systemIn, SYSTEMS, NUM_RE: NUM, deriveName, splitActor, infoPhrases, teamsIn, durationInfo, countNodes, unzip, parseXml, parseVsdx, vsdxBpmn, roleAndName, thresholdOf, thresholdsOf, thresholdsDisjoint, perRunOf, outputOf, haveChoice, taskInfo,
    RACI_ROLES, raciOf, raciEmpty, raciText, raciIn, actorAliases, actorKey, raciRowsOf, TEMPLATES, templateDraft, isTeam, verbBase, _all: all, _textOf: textOf };
});
