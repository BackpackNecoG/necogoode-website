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
  const ndKey = name => 'nd-' + String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  /* ---------------------------------------------------------------- vocabulary */
  /* role nouns: the last word of an actor phrase must be one of these (or the phrase is a team name) */
  const ROLE_NOUNS = new Set(('clerk manager coordinator officer analyst lead specialist supervisor director controller buyer requester requestor ' +
    'reviewer approver administrator admin accountant assistant agent team staff technician engineer employee contractor vendor supplier ' +
    'customer client owner partner representative rep head sme associate executive president vp cfo ceo cio cto coo hire newhire recruiter ' +
    'planner scheduler dispatcher driver courier receptionist nurse teacher auditor counsel attorney paralegal treasurer cashier steward ' +
    'desk department committee board panel group unit office function sponsor champion user member worker personnel').split(' '));
  /* team / department names: an actor on its own ("Procurement creates") and what fills "Teams involved" */
  const TEAMS = ['Accounts Payable', 'Accounts Receivable', 'Customer Service', 'Human Resources', 'Information Technology', 'Supply Chain', 'Service Desk', 'Help Desk',
    'Procurement', 'Purchasing', 'Compliance', 'Treasury', 'Finance', 'Legal', 'Facilities', 'Payroll', 'Security', 'Operations', 'Sales', 'Marketing',
    'Support', 'Tax', 'Audit', 'Risk', 'Receiving', 'Shipping', 'Warehouse', 'Logistics', 'Quality', 'Engineering', 'Benefits', 'Training', 'Accounting',
    'Billing', 'Credit', 'Collections', 'Reception', 'Admissions', 'Records', 'HR', 'IT', 'AP', 'AR', 'QA', 'PMO'];
  const TEAM_RE = new RegExp('\\b(' + TEAMS.map(t => t.replace(/\s+/g, '\\s+')).join('|') + ')\\b', 'g');
  const TEAM_SET = new Set(TEAMS.map(t => t.toLowerCase()));
  const TEAM_CANON = Object.fromEntries(TEAMS.map(t => [t.toLowerCase(), t]));
  const isTeam = w => TEAM_SET.has(String(w || '').toLowerCase().replace(/\s+/g, ' '));
  const roleNoun = w => { const x = String(w || '').toLowerCase().replace(/[^a-z-]/g, ''); return ROLE_NOUNS.has(x) || ROLE_NOUNS.has(x.replace(/s$/, '')) || ROLE_NOUNS.has(x.replace(/ies$/, 'y')) || isTeam(x); };
  const DET = /^(the|a|an|our|your|their|its|this|that|these|those|each|every|any|all|both)$/i;
  const PREP = /^(to|in|into|on|onto|at|by|for|from|with|via|of|about|against|through|under|over|after|before|within|without|per|as|than)$/i;
  /* base verbs a step can start with (imperative) or that an actor's third-person verb reduces to */
  const VERBS = new Set(('accept acknowledge add activate allocate amend announce answer approve archive arrange ask assess assign attach audit authorise authorize ' +
    'back bill book brief build calculate call cancel capture certify chase check choose clear close code collect communicate compare complete compute configure confirm contact ' +
    'convert copy correct countersign count create credit deactivate decide decline define delete deliver deny deploy deprovision destroy determine disable dispatch distribute ' +
    'do download draft edit email enable enroll enrol enter equip escalate estimate evaluate export extend fax file fill finalise finalize finish fix follow forward ' +
    'gather generate get give grant hand handle hire hold import inform initiate inspect install interview investigate invite invoice issue keep key label launch load lock log lodge look ' +
    'mail maintain make map match migrate monitor move negotiate notify obtain offboard onboard open order pack pass pay perform pick place post prepare print process ' +
    'provision publish pull purchase push quote raise read receive reconcile record recover refund register reject release remind remove renew reopen repair reply report request ' +
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
  const SYSTEMS = ['ServiceNow', 'HRIS', 'ERP', 'CRM', 'Workday', 'SAP', 'Oracle', 'NetSuite', 'Concur', 'Salesforce', 'SharePoint', 'DocuSign', 'Jira',
    'Coupa', 'Ariba', 'QuickBooks', 'Xero', 'Okta', 'Active Directory', 'Zendesk', 'HubSpot', 'Dynamics', 'Outlook', 'Excel'];
  const SYS_RE = new RegExp('\\b(' + SYSTEMS.map(s => s.replace(/\s+/g, '\\s+')).join('|') + ')\\b');

  /* ---------------------------------------------------------------- actor */
  /* {actor, action, name?} from one clause. An actor is a role phrase that ends in a role noun, a team name, a list of
     those joined by "and", or a "Role (Name)" pattern. Anything else (an imperative, a passive) has no actor. */
  function splitActor(text) {
    const t = squash(text);
    /* "HR Manager (Pat Lee) updates the record" */
    const rn = /^(?:the\s+)?((?:[A-Za-z][\w&/-]*\s+){0,3}[A-Za-z][\w&/-]*)\s*\(([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,2})\)\s+(\S+)\s*(.*)$/.exec(t);
    if (rn && roleWords(rn[1].split(/\s+/))) {
      const v = verbBase(rn[3]) || (isBase(rn[3]) ? rn[3].toLowerCase() : null);
      if (v) return { actor: canonRole(rn[1]), name: rn[2], action: imperative(v, rn[4]) };
    }
    /* "Pat Lee approves the request": a person's name as written (kept as text, never matched to workspace people) */
    const pn = /^([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){1,2})\s+(\S+)\s*(.*)$/.exec(t);
    if (pn && !pn[1].split(' ').some(w => roleNoun(w) || isTeam(w))) {
      const v = verbBase(pn[2].replace(/[,;:]$/, ''));
      if (v) return { actor: pn[1], action: imperative(v, pn[3]) };
    }
    const words = t.split(' ');
    let i = 0;
    while (i < words.length && DET.test(words[i])) i++;
    if (i === 0 && words.length && (isBase(words[0]) || /^(please|then|next|finally|first)$/i.test(words[0]))) return { actor: null, action: t };
    for (let k = i + 1; k <= Math.min(words.length - 1, i + 5); k++) {
      const actorWords = words.slice(i, k).map(w => w.replace(/[,;:]$/, ''));
      if (actorWords.some(w => /[,;:]$/.test(w))) break;
      if (!roleWords(actorWords)) continue;
      const w = words[k].replace(/[,;:]$/, '');
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
    const x = squash(String(r).replace(/^(the|a|an|our|your|their)\s+/i, ''));
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
  const DOC_HEADS = /^(forms?|invoices?|receipts?|reports?|statements?|certificates?|ids?|numbers?|details|records?|documents?|letters?|contracts?|agreements?|applications?|timesheets?|packets?|lists?|results?|files?|addresses|address|names?|dates?|codes?|orders?|accounts?|policy|policies|badges?|checklists?|requests?|surveys?|quotes?|quotations?|summary|summaries|logs?|registers?|licen[cs]es?|permits?|paychecks?|payslips?|cards?|plans?|schedules?)$/i;
  const NOUNISH = /^(request|review|purchase|change|check|schedule|order|payment|expense|update|access|record|screening|approval|contact|delivery|return|transfer|release|exit|welcome|termination|refund|offer|onboarding|tax|credit|time|start|end|due|ship|bill)$/i;
  const OF_HEADS = /^(certificate|record|proof|copy|statement|letter|bill|notice|evidence|confirmation)s?$/i;
  const ADJ_STOP = /^(first|next|last|new|approved|signed|secure|completed|original|initial|updated|current|same|relevant|required|itemized|scanned|monthly|weekly|quarterly|annual|correct|valid|full|complete|missing|received|submitted|attached|uploaded|their|its|his|her|our|your|returned)$/i;
  const GENERIC_ALONE = /^(forms?|lists?|results?|files?|names?|dates?|codes?|orders?|accounts?|requests?|emails?|cards?|plans?|logs?|details|records?|documents?|numbers?|reports?|letters?|ids?|packets?|summary|schedules?|address|addresses|statements?|policy|surveys?|checklists?|badges?|registers?)$/i;
  const INFO_NOUNS = [
    { re: /\bamounts?\b/i, name: 'Amount' },
    { re: /\bcost cent(re|er)s?\b/i, name: m => 'Cost cent' + m[1].toLowerCase() },
    { re: /\bbudget codes?\b/i, name: 'Budget code' },
    { re: /\bquotes?\b|\bquotations?\b/i, name: 'Quotes' },
    { re: /\binvoices?\b/i, name: 'Invoice' },
    { re: /\breceipts?\b/i, name: 'Receipts' },
    { re: /\bpurchase orders?\b|\bPOs?\b(?!\s+(?:number|no\.?|#))/, name: 'Purchase order' },
  ];
  /* every information noun phrase in a line, e.g. "Contractor request form", "W-9", "Certificate of insurance" */
  function infoPhrases(line) {
    const words = String(line).replace(/[“”"()]/g, ' ').replace(/[,;:.!?](?=\s|$)/g, ' , ').split(/\s+/).filter(Boolean);
    const bare = w => w.replace(/'s$/i, '').replace(/'$/, '');
    const out = [];
    words.forEach((w0, k) => {
      const w = bare(w0);
      if (/^[A-Z]{1,3}-\d{1,4}[A-Z]?$/.test(w)) { out.push(w); return; }                           /* W-9, I-9, DS-11 */
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
        mods.unshift(/^[A-Z]{2,5}s?$/.test(x) ? x : xl);
      }
      const head = /^ids?$/i.test(w) ? 'ID' : w.toLowerCase();
      if (OF_HEADS.test(w) && next && /^of$/i.test(next)) {
        const tail = [];
        for (let i = k + 2; i < words.length && tail.length < 2; i++) { const x = bare(words[i]).toLowerCase(); if (x === ',' || DET.test(x) || PREP.test(x) || /^(and|or)$/.test(x) || isBase(x) || verbBase(x)) break; tail.push(x); }
        if (tail.length) { out.push(cap(mods.concat([head, 'of'], tail).join(' '))); return; }
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

  /* ---------------------------------------------------------------- the SOP parser */
  const SKIP_LINE = /^(title|purpose|scope|objective|owner|process owner|document owner|revision|rev\.?|version|effective(\s+date)?|approved by|author|department|document(\s+(id|no\.?|number))?|sop(\s+(id|no\.?|number))?|last\s+(updated|reviewed)|applies to|audience|references?|trigger|start(?:ing)? event|procedure|process|name|notes?)\b\s*[:\-–—]/i;
  const TRIGGER_LINE = /^(trigger|start(?:ing)? event|starts? when|begins? when)\s*[:\-–—]\s*(.+)$/i;
  const TRIGGER_PROSE = /\b(?:process|procedure|sop|workflow)\s+(?:starts|begins|is triggered|is initiated|kicks off)\s+(?:when|once|after|by)\s+(.+?)\.?$/i;
  const NUM = /^(?:step\s+)?(\d+)[.):]\s+|^step\s+(\d+)\s*[-–:]\s*/i;
  const SUBNUM = /^\d+\.\d+[.):]?\s+/;
  const LETTER = /^(?:[a-h]|[ivx]{1,4})[.)]\s+/i;
  const BULLET = /^[-*•–]\s+/;
  /* qualifier clauses that stay in the note ("…, usually by email, sometimes fax") */
  const QUALIFIER = /^(usually|sometimes|often|typically|normally|generally|mostly|occasionally|e\.g\.|for example|such as|including|which|who|where|so that|because|as needed|if needed|when needed|as required|either|via|by (?:email|e-mail|phone|fax|post|mail|courier|hand)|or by|and usually|but)\b/i;

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
      name = tidy(name); if (!name || name.length > 60) return;
      const key = ndKey(name);
      let p = newData.find(x => x.key === key);
      if (!p) { if (newData.length >= 25) return; p = { key, name, reason: `Mentioned in "${clip(line, 80)}".`, steps: [] }; newData.push(p); }
      if (node && node.id && !p.steps.includes(node.id)) p.steps.push(node.id);
      if (node) { const nd = node.newData || (node.newData = []); if (!nd.some(x => x.key === key)) nd.push({ key, name: p.name }); }
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
      /* "… Owner: Records Clerk" */
      let ownerTxt = null;
      const ol = /[.;,]?\s*\bowner\s*[:\-–—]\s*(.+)$/i.exec(t);
      if (ol) { ownerTxt = ol[1].replace(/[.;]$/, ''); t = t.slice(0, ol.index).trim(); }
      const sla = slaOf(t);
      if (sla) { n.sla = sla.sla; t = squash(t.replace(sla.strip, ' ')); }
      const sys = SYS_RE.exec(line); if (sys) n.system = sys[1].replace(/\s+/g, ' ');
      const sp = splitActor(t);
      let action = sp.action;
      if (sp.actor) { n.ownerRole = sp.actor.slice(0, 60); if (sp.name) n.named = sp.name; }
      else {
        /* passive: "… is checked by the Compliance analyst" */
        const pb = /\b(?:is|are|gets?|will be)\s+\w+(?:ed|en)\b.*?\bby\s+(?:the\s+)?([A-Za-z][\w&-]*(?:\s+[A-Za-z][\w&-]*){0,2})\s*$/i.exec(t);
        if (pb && roleWords(pb[1].split(' '))) n.ownerRole = canonRole(pb[1]);
      }
      if (ownerTxt) {
        const o = canonRole(ownerTxt);
        if (o && roleWords(o.split(' ')) || /^[A-Z][a-z]+(\s+[A-Z][\w'-]+){1,2}$/.test(ownerTxt.trim())) n.ownerRole = o;
      }
      n.title = cap(tidy(stripEnd(action))) || cap(tidy(stripEnd(clause)));
      if (n.named) n.note = `Named in the procedure: ${n.named}`;
      delete n.named;
      const tm = teamsIn(line);
      n.touches = [...new Set(teamOfRole(n.ownerRole).concat(tm))];
      addTeams(n.touches);
      /* information named by the action (never by the actor), plus any the line's condition reads ("the amount") */
      const extra = opts.dataText ? String(opts.dataText).replace(clause, ' ') : '';
      [...new Set(infoPhrases(action).concat(extra ? infoPhrases(extra) : []))].forEach(nm => propose(nm, line, n));
      return n;
    };
    const addNote = (n, extra) => {
      if (!n || !extra) return;
      const x = tidy(extra); if (!x) return;
      n.note = n.note ? `${n.note} · ${x}` : x;
    };

    /* one numbered or bulleted line -> 1 node (a step or wait), or a step plus a decision, or a decision, or a parallel */
    const lineNodes = (body, num) => {
      const out = [];
      const full = squash(body);
      /* split into sentences; "; otherwise", "; if not" and ", otherwise" start a clause too */
      const sentences = full.split(/(?<=[.!?])\s+(?=[A-Z("“])|;\s*(?=(?:otherwise|else|if|unless)\b)|,\s*(?=(?:otherwise|if not)\b)/i).map(s => s.trim()).filter(s => s.length >= 2);
      let main = null, dec = null, lastDec = null;
      const notes = [];
      sentences.forEach((sen, si) => {
        const g = GOTO_RE.exec(sen);
        const own = /^owner\s*[:\-–—]\s*(.+?)\.?$/i.exec(sen);
        if (own) { if (main && main.type === 'step') { const o = canonRole(own[1]); main.ownerRole = o; main.touches = [...new Set(main.touches.concat(teamOfRole(o)))]; addTeams(main.touches); } return; }
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
            const st = makeStep(rest, full);
            /* "Otherwise, the Procurement Manager approves." reads "Approve the vendor" when the other path says what */
            const other = lastDec.branches[0].nodes[0];
            if (st.type === 'step' && other && other.type === 'step' && st.title.split(' ').length === 1 && other.title.toLowerCase().startsWith(st.title.toLowerCase() + ' ')) st.title = other.title;
            br.nodes.push(st);
          }
          if (g) br.gotoNum = +g[1];
          return;
        }
        const lead = /^(if|unless|when|where|for|should)\s+(.+?),(?!\d)\s*(?:then\s+)?(.+)$/i.exec(sen);
        const isCond = lead && (/^(if|unless|should)$/i.test(lead[1]) || COMPARE.test(lead[2]) || /\$\s?\d/.test(lead[2]));
        if (isCond) {
          const act = stripEnd(lead[3].replace(GOTO_STRIP, ''));
          const yes = [];
          if (act && !/^(return|go back|loop back|send back|skip|go|jump|continue|proceed)\b/i.test(act)) yes.push(makeStep(act, full, { dataText: sen }));
          const negated = /^unless$/i.test(lead[1]);
          dec = { id: id('d'), type: 'decision', title: decisionTitle(lead[2]), branches: [{ label: negated ? 'No' : 'Yes', nodes: negated ? [] : yes }, { label: negated ? 'Yes' : 'No', nodes: negated ? yes : [] }] };
          if (g) dec.branches[negated ? 1 : 0].gotoNum = +g[1];
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
          main = makeStep(titleText.replace(GOTO_STRIP, ''), full, { dataText: sen });
          out.push(main);
          return;
        }
        /* any other sentence on the line is part of the same step: kept in its note, its information on the step */
        notes.push(stripEnd(sen));
        if (main.type === 'step') infoPhrases(sen).forEach(nm => propose(nm, full, main));
      });
      if (main && main.type === 'step') notes.forEach(x => addNote(main, x));
      else if (!main && out.length && notes.length) notes.forEach(x => addNote(out[0].branches && out[0].branches[0].nodes[0], x));
      /* a decision that came from the line's leading condition sits first; a trailing one after the main step */
      return out;
    };

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
        if (SKIP_LINE.test(t) || /^#+\s/.test(t) || TRIGGER_LINE.test(t)) { prevBlank = false; continue; }
        const isNum = NUM.test(t) && !SUBNUM.test(t), isSub = SUBNUM.test(t), isLetter = !isNum && LETTER.test(t), isBullet = BULLET.test(t);
        const body = t.replace(SUBNUM, '').replace(NUM, '').replace(LETTER, '').replace(BULLET, '').trim();
        if (!body) { prevBlank = false; continue; }
        if (isNum || (isBullet && (!hasNum && indent === 0))) {
          const m = /(\d+)/.exec(t); items.push({ num: isNum && m ? +m[1] : null, body, subs: [], indent }); prevBlank = false; continue;
        }
        if (last && (isSub || isLetter || isBullet)) { last.subs.push(body); prevBlank = false; continue; }
        /* a wrapped line straight after a step (indented, no blank line between) continues it */
        if (last && !prevBlank && indent > 0 && !last.subs.length) { last.body += ' ' + body; continue; }
        if (wasFirst) { prevBlank = false; continue; }
        prevBlank = false;                                  /* prose around the list: title, intro, notes */
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
        else items.push({ num: null, body: s, subs: [] });
      });
    }

    const nodes = [];
    const lineFirst = {};
    items.forEach((it, idx) => {
      if (nodes.length >= 60) return;
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
          nodes.push(gw); return;
        }
        if (/:$/.test(it.body.trim()) || !parts.length) {
          /* "In parallel:" followed by sub-items: each sub-item is a path */
          const steps = it.subs.map(sb => makeStep(sb, sb));
          if (steps.length >= 2) {
            const gw = { id: id('p'), type: 'parallel', title: 'At the same time', branches: steps.map((s, i) => ({ label: s.ownerRole || 'Path ' + String.fromCharCode(65 + i), nodes: [s] })) };
            if (it.num != null) lineFirst[it.num] = gw.id;
            nodes.push(gw); return;
          }
        }
      }
      const out = lineNodes(it.body, it.num);
      const main = out.find(n => n.type === 'step' || n.type === 'wait') || null;
      if (main && main.type === 'step') {
        if (it.owner) { main.ownerRole = canonRole(it.owner); main.touches = [...new Set(main.touches.concat(teamOfRole(main.ownerRole)))]; addTeams(main.touches); }
        it.subs.forEach(sb => {
          const sub = { title: cap(tidy(stripEnd(sb))), data: [] };
          main.subs.push(sub);
          infoPhrases(sb).forEach(nm => propose(nm, sb, main));
        });
      } else if (it.subs.length && out[0] && out[0].branches) {
        const host = out[0].branches[0].nodes[0];
        if (host) it.subs.forEach(sb => host.subs.push({ title: cap(tidy(stripEnd(sb))), data: [] }));
      }
      if (it.num != null && out[0]) lineFirst[it.num] = out[0].id;
      out.forEach(n => nodes.push(n));
    });
    /* "return to step N": the branch loops back to the first node that line N produced */
    const walk = (ns, f) => (ns || []).forEach(n => { f(n); (n.branches || []).forEach(b => walk(b.nodes, f)); });
    walk(nodes, n => (n.branches || []).forEach(b => { if (b.gotoNum != null) { if (lineFirst[b.gotoNum]) b.goto = lineFirst[b.gotoNum]; delete b.gotoNum; } }));
    nodes.unshift({ id: 'k', type: 'trigger', title: trigger, touches: [] });
    const c = countNodes(nodes);
    const roles = []; walk(nodes, n => { if (n.type === 'step' && n.ownerRole && !roles.includes(n.ownerRole)) roles.push(n.ownerRole); });
    const nobody = []; walk(nodes, n => { if (n.type === 'step' && !n.ownerRole) nobody.push(n); });
    const notes = [`Found ${plural(c.steps, 'step')}${c.decisions ? `, ${plural(c.decisions, 'choice')}` : ''}${c.parallels ? ` and ${plural(c.parallels, 'set')} of steps done at the same time` : ''}${c.waits ? `, ${plural(c.waits, 'wait')}` : ''}.`,
      roles.length ? `Who does them, as written: ${roles.join(', ')}.` : '',
      nobody.length ? `${plural(nobody.length, 'step')} ${nobody.length === 1 ? 'does' : 'do'} not say who does ${nobody.length === 1 ? 'it' : 'them'}.` : '',
      'Check each step before saving.'].filter(Boolean).join(' ');
    return { nodes, newData, notes, trigger, teams: teamsAll, name: deriveName(text) };
  }
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 3).replace(/\s+\S*$/, '') + '…' : t);
  /* the API's rules fallback: same output as parseSop. Workspace docs are ignored on purpose (demo-data isolation). */
  function sopRules(text /* , docs */) { const r = parseSop(text); return { nodes: r.nodes, newData: r.newData, notes: r.notes, trigger: r.trigger, teams: r.teams, name: r.name }; }

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
    if (/start|end|terminator|terminal/.test(m)) return /^\s*(end|stop|finish|done|complete)/i.test(text || '') ? 'end' : /^\s*(start|begin)/i.test(text || '') ? 'start' : 'terminator';
    if (/parallel|fork|join/.test(m)) return 'parallel';
    if (/delay|timer|wait/.test(m)) return 'wait';
    if (/data|document|database|stored data|internal storage/.test(m)) return 'data';
    if (/process|subprocess|sub-process|predefined|action|task|step|rectangle|box|manual|preparation/.test(m)) return 'process';
    if (/title|page|legend|annotation|text|callout|container|pool/.test(m)) return 'ignore';
    return text ? 'process' : 'ignore';
  }
  const cell = (sh, n) => { const c = kids(sh, 'Cell').find(x => x.attrs.N === n); return c ? Number(c.attrs.V) : NaN; };
  /* parseVsdx(bytes) -> {name, nodes, lanes, links, steps, decisions, parallels, dropped, bpmn}
     Shapes become steps (Process), choices (Decision), start/end (Start/End); Dynamic connectors become links (their
     text becomes the path label); swimlanes become roles (a step belongs to the lane whose box holds its centre).
     Data / Document shapes connected to a step become that step's information. */
  async function parseVsdx(bytes, opts) {
    opts = opts || {};
    const files = await unzip(bytes);
    const pageName = Object.keys(files).filter(n => /^visio\/pages\/page\d*\.xml$/i.test(n)).sort((a, b) => (parseInt(a.replace(/\D+/g, ''), 10) || 0) - (parseInt(b.replace(/\D+/g, ''), 10) || 0))[0];
    if (!pageName) throw new Error('No diagram page was found in this Visio file.');
    const masters = {};
    const mx = files['visio/masters/masters.xml'];
    if (mx) kids(parseXml(utf8(mx)), 'Master').forEach(m => { masters[m.attrs.ID] = m.attrs.NameU || m.attrs.Name || ''; });
    let docTitle = '';
    const core = files['docProps/core.xml']; if (core) { const t = all(parseXml(utf8(core)), 'title')[0]; docTitle = t ? squash(textOf(t)) : ''; }
    const page = parseXml(utf8(files[pageName]));
    const shapes = {}, dropped = [];
    const shapesEl = kid(page, 'Shapes');
    const visit = (sh, parent) => {
      const idv = sh.attrs.ID; const master = masters[sh.attrs.Master] || (parent && parent.master) || sh.attrs.NameU || sh.attrs.Name || '';
      const text = squash(textOf(kid(sh, 'Text')));
      const kind = shapeKind(master, text);
      const s = { id: idv, master, text, kind, x: cell(sh, 'PinX'), y: cell(sh, 'PinY'), w: cell(sh, 'Width'), h: cell(sh, 'Height') };
      shapes[idv] = s;
      kids(kid(sh, 'Shapes'), 'Shape').forEach(c => { if (kind === 'lane' || kind === 'ignore') visit(c, null); });
    };
    kids(shapesEl, 'Shape').forEach(sh => visit(sh, null));
    /* connectors: BeginX -> from shape, EndX -> to shape */
    const ends = {};
    kids(kid(page, 'Connects'), 'Connect').forEach(c => {
      const con = c.attrs.FromSheet, to = c.attrs.ToSheet, which = c.attrs.FromCell;
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
    const name = opts.name || docTitle || '';
    const bpmn = vsdxBpmn({ name: name || 'Imported Visio process', shapes, flowShapes, links: links.filter(l => flowKinds.has(shapes[l.from].kind) && flowKinds.has(shapes[l.to].kind)), laneOf, dataOf, ins, outs });
    const c = { steps: flowShapes.filter(s => s.kind === 'process' || s.kind === 'wait').length, decisions: flowShapes.filter(s => s.kind === 'decision').length, parallels: flowShapes.filter(s => s.kind === 'parallel').length };
    return Object.assign({ name, lanes: lanes.map(l => l.name), links, dropped, bpmn }, c);
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
      const lane = s.kind === 'start' || s.kind === 'end' ? '' : v.laneOf(s);
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
      (data || []).forEach(nm => { const key = ndKey(nm); let p = newData.find(x => x.key === key); if (!p) { p = { key, name: nm, reason: `Used in the ${t.name.toLowerCase()} template.`, steps: [] }; newData.push(p); } p.steps.push(n.id); n.newData.push({ key, name: nm }); });
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

  return { parseSop, sopRules, deriveName, splitActor, infoPhrases, teamsIn, durationInfo, countNodes, unzip, parseXml, parseVsdx, vsdxBpmn,
    RACI_ROLES, raciOf, raciEmpty, raciText, TEMPLATES, templateDraft, isTeam, verbBase, _all: all, _textOf: textOf };
});
