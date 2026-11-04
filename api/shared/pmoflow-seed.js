/* PMOFlow seed generator. seed(createdAtISODate) -> {people, docs, events}.
   Every date is an offset from the seed date, so the demo never goes stale.
   The offsets reproduce the v2 demo relative to its fixed "today" of 2026-11-04
   (W6 due seed-1 and still idle, target seed+41, and so on).
   All names are fictional (Northwind Traders). Never add a real company or client name. */

const DOC_TYPES = ['person', 'dataElement', 'process', 'project', 'workItem', 'grant', 'approval',
  'release', 'profile', 'testCase', 'testRun', 'comment', 'notification', 'risk'];

function dayOf(input) {
  const s = String(input || new Date().toISOString()).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}
function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- people ---------- */
const PEOPLE = [
  { id: 'mc', name: 'Maya Chen', role: 'Process Owner · BA', color: '#7c3aed', bu: 'Procurement' },
  { id: 'ta', name: 'Tom Alvarez', role: 'Project Manager', color: '#0891b2', bu: 'PMO' },
  { id: 'ps', name: 'Priya Shah', role: 'Compliance SME', color: '#db2777', bu: 'Compliance' },
  { id: 'lp', name: 'Leo Park', role: 'Treasury SME', color: '#ea580c', bu: 'Treasury' },
  { id: 'ar', name: 'Ana Ruiz', role: 'AP Lead', color: '#16a34a', bu: 'Accounts Payable' },
  { id: 'dk', name: 'Dev Kumar', role: 'Integration Eng.', color: '#2563eb', bu: 'IT' },
];

/* ---------- synthetic CSV extracts (fake values, deterministic) ---------- */
function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
function csvCell(v) { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(header, rows) { return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n'; }

const VENDORS = ['Acme Supply Co', 'Bluefin Logistics', 'Cobalt Parts', 'Driftwood Packaging', 'Elmstead Foods',
  'Fernhill Paper', 'Granite Peak Tools', 'Harbor Light Electric', 'Ironbark Fasteners', 'Juniper Office Goods',
  'Kestrel Freight', 'Lakeshore Textiles', 'Maplegrove Printing', 'Northgate Chemicals', 'Oakridge Plastics',
  'Pinecrest Janitorial', 'Quarry Lane Stone', 'Redwood Courier', 'Silverbrook Labs', 'Tidewater Marine Supply',
  'Upland Seed Co', 'Valley Forge Metals', 'Willowmere Catering', 'Yellowtail Signs', 'Zephyr Air Filters',
  'Brightwater Pumps', 'Copperline Cable', 'Duneside Glass', 'Evergreen Uniforms', 'Foxglove Florals',
  'Glacier Ice Works', 'Hollow Creek Lumber', 'Indigo Ink Supply', 'Jasper Safety Gear'];
const ENTITY = ['LLC', 'Corporation', 'Partnership', 'Sole proprietor'];
const STREETS = ['Market St', 'Harbor Rd', 'Elm Ave', 'Industrial Pkwy', 'Commerce Dr', 'Mill Ln', 'Station Rd'];
const TOWNS = ['Springfield', 'Riverton', 'Fairview', 'Lakeside', 'Brookfield', 'Cedar Falls'];
const BANKS = ['Harborview Savings', 'Northwind Credit Union', 'Prairie State Bank', 'Summit Trust',
  'Riverbend Federal', 'Coastal Mutual Bank'];

function d1Csv() {
  const r = lcg(11);
  const pick = a => a[Math.floor(r() * a.length)];
  const num = n => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');
  const rows = VENDORS.map(v => [v + ' ' + pick(['Inc', 'LLC', 'Ltd', 'Co']).replace(/^Co$/, 'Holdings'),
    num(2) + '-' + num(7), pick(ENTITY), `${100 + Math.floor(r() * 9800)} ${pick(STREETS)}, ${pick(TOWNS)}`]);
  /* deliberate edge cases for the profiler and spec-drift demo */
  rows.push(["O'Brien Hauling LLC", num(2) + '-' + num(7), 'LLC', '42 Quay St, Riverton']);
  rows.push(['Zoë Café Provisions', num(2) + '-' + num(7), 'Sole proprietor', '9 Rue Verte, Fairview']);
  rows.push(['Smith-Jones & Daughters Mechanical', num(2) + '-' + num(7), 'Partnership', '310 Mill Ln, Lakeside']);
  rows.push(['Northwind Regional Industrial Fabrication, Precision Machining and Contract Assembly Holdings Cooperative of the Greater Lakes Area Incorporated',
    num(2) + '-' + num(7), 'Corporation', '1 Commerce Dr, Brookfield']);
  rows.push(['Pemberton Office Supply', '', 'Corporation', '77 Station Rd, Cedar Falls']); /* blank required Tax ID */
  rows.push(['Quillfeather Stationers', num(9), 'LLC', '18 Elm Ave, Springfield']);        /* Tax ID missing its hyphen */
  return toCsv(['legal_name', 'tax_id', 'entity_type', 'address'], rows);
}

function d2Csv() {
  const r = lcg(29);
  const pick = a => a[Math.floor(r() * a.length)];
  const num = n => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');
  const rows = VENDORS.map(v => [pick(BANKS), String(1 + Math.floor(r() * 8)) + num(8), num(8 + Math.floor(r() * 5)), v + ' Inc']);
  rows.push([pick(BANKS), '1' + num(7), num(10), 'Kestrel Freight Inc']);              /* 8 digits: leading zero dropped by a spreadsheet */
  rows.push([pick(BANKS), '0' + num(8), num(11), "O'Brien Hauling LLC"]);
  rows.push([pick(BANKS), String(2 + Math.floor(r() * 7)) + num(8), num(9), 'Zoë Café Provisions']);
  rows.push([pick(BANKS), String(2 + Math.floor(r() * 7)) + num(8), num(12), 'Smith-Jones & Daughters Mechanical']);
  rows.push([pick(BANKS), String(2 + Math.floor(r() * 7)) + num(8), num(10), '']);     /* blank required account holder */
  rows.push(['', String(2 + Math.floor(r() * 7)) + num(8), num(10), 'Pemberton Office Supply Inc']); /* blank bank name */
  return toCsv(['bank_name', 'routing_number', 'account_number', 'account_holder'], rows);
}

/* ---------- data elements ---------- */
const F = (name, format, rule, extra) => Object.assign({ name, format, rule }, extra || {});
function dataElements() {
  return [
    { id: 'D1', name: 'Vendor legal name & Tax ID', owner: 'mc', source: 'W-9 upload (vendor portal)', avail: 'example',
      note: '12 sample W-9s collected; no parser yet.',
      fields: [F('Legal name', 'text', 'Required', { type: 'text', min: 2, max: 120, required: true }),
        F('Tax ID (EIN)', '##-#######', 'Required', { type: 'text', length: 10, pattern: '^\\d{2}-\\d{7}$', required: true }),
        F('Entity type', 'list', 'Required', { type: 'list', values: ['LLC', 'Corporation', 'Partnership', 'Sole proprietor'], required: true }),
        F('Address', 'text', 'Required', { type: 'text', max: 200, required: true })],
      samples: ['w9_acme_supply.pdf', 'w9_bluefin_logistics.pdf', 'w9_cobalt_parts.pdf'], sampleCsv: d1Csv(), discovered: [] },
    { id: 'D2', name: 'Bank remittance details', owner: 'lp', source: 'Treasury portal', avail: 'missing',
      note: 'Arrives today as emailed PDFs. No structured capture or API exists.',
      fields: [F('Bank name', 'text', 'Required', { type: 'text', max: 80, required: true }),
        F('Routing number', '9 digits', 'Required', { type: 'digits', length: 9, pattern: '^\\d{9}$', required: true }),
        F('Account number', 'text, masked', 'Required', { type: 'digits', min: 4, max: 17, pattern: '^\\d{4,17}$', required: true }),
        F('Account holder', 'text', 'Must match legal name', { type: 'text', max: 120, required: true })],
      samples: [], sampleCsv: d2Csv(), discovered: [] },
    { id: 'D3', name: 'Certificate of insurance', owner: 'ps', source: 'Vendor portal upload', avail: 'example',
      note: 'Sample COIs on file; expiry dates captured manually.',
      fields: [F('Carrier', 'text', 'Required', { type: 'text', max: 80, required: true }),
        F('Coverage amount', 'currency', '≥ $1M', { type: 'currency', min: 1000000, required: true }),
        F('Expiry date', 'date', 'Required', { type: 'date', required: true })],
      samples: ['coi_acme_2026.pdf', 'coi_bluefin_2026.pdf'], discovered: [] },
    { id: 'D4', name: 'Vendor master record', owner: 'ar', source: 'ERP vendor API', avail: 'live',
      note: 'Read/write API available in sandbox and production.',
      fields: [F('Vendor ID', 'system', 'Generated', { type: 'text', pattern: '^V\\d{6}$', length: 7, required: true }),
        F('Payment terms', 'list', 'Required', { type: 'list', values: ['Net 15', 'Net 30', 'Net 45', 'Net 60'], required: true }),
        F('Remit-to', 'ref → D2', 'Required', { type: 'text', required: true })],
      samples: ['erp_vendor_schema.json'], discovered: [] },
    { id: 'D5', name: 'Sanctions screening result', owner: 'ps', source: 'Screening service API', avail: 'missing',
      note: 'Screening vendor contract pending signature.',
      fields: [F('Match status', 'clear / review / hit', 'Required', { type: 'list', values: ['clear', 'review', 'hit'], required: true }),
        F('Screened at', 'timestamp', 'Required', { type: 'date', required: true }),
        F('Lists checked', 'list', 'Required', { type: 'list', values: ['US sanctions', 'EU sanctions', 'UN sanctions'], required: true })],
      samples: [], discovered: [] },
    { id: 'D6', name: 'Contract terms', owner: 'mc', source: 'Contract repository', avail: 'live',
      note: 'Metadata API live; terms extracted on upload.',
      fields: [F('Contract ID', 'system', 'Generated', { type: 'text', pattern: '^C-\\d{5}$', length: 7, required: true }),
        F('Renewal date', 'date', 'Required', { type: 'date', required: true })],
      samples: ['contract_meta_sample.json'], discovered: [] },
    { id: 'D7', name: 'Approver matrix', owner: 'dk', source: 'HR directory', avail: 'live',
      note: 'Synced nightly from the directory.',
      fields: [F('Cost center', 'text', 'Required', { type: 'text', pattern: '^CC\\d{4}$', length: 6, required: true }),
        F('Approver', 'person', 'Required', { type: 'text', required: true }),
        F('Limit', 'currency', 'Required', { type: 'currency', min: 0, max: 1000000, required: true })],
      samples: ['approver_matrix.csv'], discovered: [] },
    { id: 'D8', name: 'Vendor risk tier', owner: 'ps', source: 'Derived (screening + spend)', avail: 'example',
      note: 'Scoring rules drafted; sample outputs only.',
      fields: [F('Tier', 'high / standard', 'Required', { type: 'list', values: ['high', 'standard'], required: true }),
        F('Reason codes', 'list', 'Optional', { type: 'list', values: ['sanctions-review', 'high-spend', 'new-country', 'adverse-media'], required: false })],
      samples: ['risk_tier_examples.xlsx'], discovered: [] },
  ];
}

/* ---------- processes ---------- */
const sub = (title, data) => ({ title, data });
function processes() {
  return [
    { id: 'vendor-onboarding', name: 'Vendor Onboarding',
      desc: 'From a vendor request to an active, payable vendor with a signed contract. To-be design: screening and banking move from email to system-captured data.',
      owner: 'mc', resources: ['mc', 'ps', 'lp', 'ar', 'dk'], version: 1, released: [],
      asis: [
        { id: 'k', type: 'trigger', title: 'Vendor request emailed to Procurement', owner: 'mc', data: [], touches: ['Procurement', 'Email'] },
        { id: 'a1', type: 'step', title: 'Email vendor for W-9 and COI', owner: 'mc', data: ['D1', 'D3'], touches: ['Procurement', 'Email'] },
        { id: 'a2', type: 'step', title: 'Manual sanctions lookup', owner: 'ps', data: ['D1'], touches: ['Compliance', 'Public lists'] },
        { id: 'a3', type: 'step', title: 'Receive bank letter by email', owner: 'lp', data: ['D2'], touches: ['Treasury', 'Email'] },
        { id: 'a4', type: 'step', title: 'Key vendor into ERP by hand', owner: 'ar', data: ['D1', 'D2'], touches: ['Accounts Payable', 'ERP'] },
        { id: 'a5', type: 'step', title: 'Activate contract', owner: 'mc', data: ['D6'], touches: ['Procurement', 'Contract repository'] },
        { id: 'a6', type: 'step', title: 'Email requester when done', owner: 'mc', data: [], touches: ['Procurement', 'Email'] },
        { id: 'e', type: 'end', title: 'Vendor active & payable' },
      ],
      tobe: [
        { id: 'k', type: 'trigger', title: 'Vendor request submitted', owner: 'mc', data: [], touches: ['Procurement', 'Request portal'], from: 'k' },
        { id: 's1', type: 'step', title: 'Collect vendor information', owner: 'mc', data: ['D1', 'D3'], touches: ['Procurement', 'Vendor portal'], from: 'a1',
          subs: [sub('Vendor receives portal invite', []), sub('Vendor uploads W-9 and COI', ['D1', 'D3']), sub('Completeness check', ['D1', 'D3'])] },
        { id: 's2', type: 'step', title: 'Sanctions & risk screening', owner: 'ps', data: ['D1', 'D5', 'D8'], touches: ['Compliance', 'Screening service'], from: 'a2',
          subs: [sub('Read vendor identity from W-9', ['D1']), sub('Screen against sanctions lists', ['D5']), sub('Assign risk tier', ['D8']), sub('Record result on vendor file', ['D5'])] },
        { id: 'd1', type: 'decision', title: 'Risk tier?', branches: [
          { label: 'High', nodes: [{ id: 's2a', type: 'step', title: 'Enhanced due diligence', owner: 'ps', data: ['D3', 'D8'], touches: ['Compliance', 'Risk'],
            subs: [sub('Request financial statements', []), sub('Reference checks', []), sub('Compliance sign-off', ['D8'])] }] },
          { label: 'Standard', nodes: [] }] },
        { id: 's3', type: 'step', title: 'Capture banking details', owner: 'lp', data: ['D2'], touches: ['Treasury', 'Treasury portal'], from: 'a3',
          subs: [sub('Vendor enters bank details in portal', ['D2']), sub('Micro-deposit verification', ['D2']), sub('Dual approval', [])] },
        { id: 's4', type: 'step', title: 'Create vendor master record', owner: 'ar', data: ['D1', 'D2', 'D4'], touches: ['Accounts Payable', 'ERP'], from: 'a4',
          subs: [sub('Record written to ERP via API', ['D4']), sub('Remit-to linked to verified bank', ['D2']), sub('W-9 and COI attached', ['D1', 'D3'])] },
        { id: 's5', type: 'step', title: 'Activate contract', owner: 'mc', data: ['D6', 'D4'], touches: ['Procurement', 'Contract repository'], from: 'a5',
          subs: [sub('Link contract to vendor ID', ['D6', 'D4']), sub('Renewal reminder set', ['D6'])] },
        { id: 's6', type: 'step', title: 'Notify requester & approvers', owner: 'dk', data: ['D7'], touches: ['IT', 'Email / Teams'], from: 'a6',
          subs: [sub('Resolve approvers from matrix', ['D7']), sub('Send notification', [])] },
        { id: 'e', type: 'end', title: 'Vendor active & payable', from: 'e' },
      ] },
    { id: 'invoice-approval', name: 'Invoice Approval',
      desc: 'Received invoice to scheduled payment. Linked because it depends on the vendor master and bank details that onboarding produces.',
      owner: 'ar', resources: ['ar', 'lp', 'dk'], version: 1, released: [],
      asis: [
        { id: 'k', type: 'trigger', title: 'Invoice received in AP inbox', owner: 'ar', data: [], touches: ['Accounts Payable', 'Email'] },
        { id: 'b1', type: 'step', title: 'Manual PO match', owner: 'ar', data: ['D4'], touches: ['Accounts Payable', 'ERP'] },
        { id: 'b2', type: 'step', title: 'Email approver', owner: 'ar', data: [], touches: ['Accounts Payable', 'Email'] },
        { id: 'b3', type: 'step', title: 'Schedule payment', owner: 'lp', data: ['D2', 'D4'], touches: ['Treasury', 'Bank'] },
        { id: 'e', type: 'end', title: 'Payment scheduled' },
      ],
      tobe: [
        { id: 'k', type: 'trigger', title: 'Invoice received', owner: 'ar', data: [], touches: ['Accounts Payable', 'AP inbox'], from: 'k' },
        { id: 'i1', type: 'step', title: 'Match to PO & vendor master', owner: 'ar', data: ['D4', 'D2'], touches: ['Accounts Payable', 'ERP'], from: 'b1',
          subs: [sub('Read vendor master', ['D4']), sub('3-way match', ['D4']), sub('Confirm remit-to account', ['D2'])] },
        { id: 'p1', type: 'parallel', title: 'Approve and prepare payment in parallel', branches: [
          { label: 'Approval', nodes: [{ id: 'i2', type: 'step', title: 'Route for approval', owner: 'dk', data: ['D7'], touches: ['IT', 'Approvals'], from: 'b2',
            subs: [sub('Resolve approver by amount', ['D7']), sub('Escalate after 48h', [])] }] },
          { label: 'Payment prep', nodes: [{ id: 'i2p', type: 'step', title: 'Schedule payment prep', owner: 'lp', data: ['D2', 'D4'], touches: ['Treasury', 'Bank'],
            subs: [sub('Validate remit-to against verified bank', ['D2']), sub('Stage payment in next batch', ['D4'])] }] }] },
        { id: 'i3', type: 'step', title: 'Release scheduled payment', owner: 'lp', data: ['D2', 'D4'], touches: ['Treasury', 'Bank'], from: 'b3',
          subs: [sub('Batch by pay date', ['D4']), sub('Release payment file', ['D2'])] },
        { id: 'e', type: 'end', title: 'Payment scheduled', from: 'e' },
      ] },
    { id: 'access-review', name: 'Quarterly Access Review',
      desc: 'Each quarter, managers certify who can reach finance systems, and uncertified access is removed.',
      owner: 'dk', resources: ['dk', 'ps', 'ta'], version: 1, released: [],
      asis: [
        { id: 'k', type: 'trigger', title: 'Quarter end reached', owner: 'dk', data: [], touches: ['IT', 'Calendar'] },
        { id: 'q1', type: 'step', title: 'Export user lists from each app by hand', owner: 'dk', data: [], touches: ['IT', 'Spreadsheets'] },
        { id: 'q2', type: 'step', title: 'Email spreadsheets to managers to certify', owner: 'ps', data: ['D7'], touches: ['Compliance', 'Email'] },
        { id: 'q3', type: 'step', title: 'Raise removal tickets manually', owner: 'dk', data: [], touches: ['IT', 'Service desk'] },
        { id: 'e', type: 'end', title: 'Access certified' },
      ],
      tobe: [
        { id: 'k', type: 'trigger', title: 'Quarter end reached', owner: 'dk', data: [], touches: ['IT', 'Scheduler'], from: 'k' },
        { id: 'r1', type: 'step', title: 'Pull entitlements automatically', owner: 'dk', data: ['D7'], touches: ['IT', 'Identity platform'], from: 'q1',
          subs: [sub('Read entitlements per finance app', []), sub('Join to manager from approver matrix', ['D7'])] },
        { id: 'r2', type: 'step', title: 'Managers certify in review portal', owner: 'ps', data: ['D7'], touches: ['Compliance', 'Review portal'], from: 'q2',
          subs: [sub('Manager reviews direct reports', ['D7']), sub('Reminder after 5 days', [])] },
        { id: 'r3', type: 'step', title: 'Auto-remove uncertified access', owner: 'dk', data: [], touches: ['IT', 'Identity platform'], from: 'q3',
          subs: [sub('Remove access', []), sub('Evidence pack saved for audit', [])] },
        { id: 'e', type: 'end', title: 'Access certified', from: 'e' },
      ] },
  ];
}

/* ---------- work items: [id, project, pid, step, title, owner, status, startOff, dueOff, deps, resolves, kind] ---------- */
const WORK = [
  ['W1', 'vendor-modernization', 'vendor-onboarding', 's1', 'Launch vendor portal W-9/COI upload', 'mc', 'done', -27, -15, [], null, 'build'],
  ['W2', 'vendor-modernization', 'vendor-onboarding', 's2', 'Sign screening vendor contract', 'ps', 'prog', -7, 6, [], 'D5', 'other'],
  ['W3', 'vendor-modernization', 'vendor-onboarding', 's2', 'Integrate screening API', 'dk', 'idle', 7, 13, ['W2'], null, 'build'],
  ['W4', 'vendor-modernization', 'vendor-onboarding', 's2', 'Define risk-tier scoring rules', 'ps', 'prog', -5, 2, [], null, 'other'],
  ['W5', 'vendor-modernization', 'vendor-onboarding', 's2a', 'EDD checklist & sign-off form', 'ps', 'idle', 3, 8, ['W4'], null, 'build'],
  ['W6', 'vendor-modernization', 'vendor-onboarding', 's3', 'Stand up structured bank capture', 'lp', 'idle', -8, -1, [], 'D2', 'build'],
  ['W7', 'vendor-modernization', 'vendor-onboarding', 's3', 'Build micro-deposit verification', 'dk', 'idle', 0, 6, ['W6'], null, 'build'],
  ['W8', 'vendor-modernization', 'vendor-onboarding', 's4', 'ERP vendor write integration', 'dk', 'prog', -2, 10, ['W6'], null, 'build'],
  ['W9', 'vendor-modernization', 'vendor-onboarding', 's6', 'Notification automation', 'dk', 'done', -15, -5, [], null, 'build'],
  ['W10', 'vendor-modernization', 'invoice-approval', 'i1', 'Remit-to check in 3-way match', 'ar', 'idle', 11, 16, ['W6', 'W8'], null, 'build'],
  ['W11', 'vendor-modernization', 'invoice-approval', 'i2', 'Amount-based approval routing', 'dk', 'idle', 6, 16, [], null, 'build'],
  ['A1', 'access-review-automation', 'access-review', 'r1', 'Connect identity platform entitlement export', 'dk', 'done', -24, -14, [], null, 'build'],
  ['A2', 'access-review-automation', 'access-review', 'r2', 'Configure manager review campaigns', 'ps', 'done', -14, -4, ['A1'], null, 'build'],
  ['A3', 'access-review-automation', 'access-review', 'r3', 'Auto-removal runbook and approval', 'dk', 'done', -6, -1, ['A1'], null, 'access'],
  ['A4', 'access-review-automation', 'access-review', 'r2', 'UAT: dry-run certification with Compliance', 'ps', 'idle', 5, 9, ['A2', 'A3'], null, 'test'],
];
/* kickoff-plan dues that differ from today's plan (so baseline variance shows) */
const BASELINE_DUE = { W2: 2, W6: -5, W7: 2, W8: 6, W10: 12, W3: 9, A3: -2, A4: 8 };

function seed(createdAtISODate) {
  const day = dayOf(createdAtISODate);
  const at = (n, hh) => addDays(day, n) + 'T' + String(hh == null ? 15 : hh).padStart(2, '0') + ':00:00.000Z';
  const docs = {}; DOC_TYPES.forEach(t => { docs[t] = []; });
  const add = (type, data) => docs[type].push({ id: data.id, data });

  PEOPLE.forEach(p => add('person', clone(p)));
  dataElements().forEach(d => add('dataElement', d));
  processes().forEach(p => add('process', p));

  const work = WORK.map(([id, projectId, pid, step, title, owner, status, s, d, deps, resolves, kind]) => {
    const w = { id, projectId, pid, step, title, owner, status, start: addDays(day, s), due: addDays(day, d), deps, kind };
    if (resolves) w.resolves = resolves;
    return w;
  });
  const baseline = (projectId, label, off) => ({ id: 'bl-kickoff', at: at(off, 16), label,
    items: Object.fromEntries(WORK.filter(w => w[1] === projectId).map(w => [w[0], {
      start: addDays(day, w[7]), due: addDays(day, BASELINE_DUE[w[0]] != null ? BASELINE_DUE[w[0]] : w[8]) }])) });

  add('project', { id: 'vendor-modernization', name: 'Vendor Onboarding Modernization',
    desc: 'Move vendor onboarding from email and PDFs to captured data, and unblock downstream invoice approval.',
    owner: 'ta', resources: ['ta', 'mc', 'ps', 'lp', 'ar', 'dk'], target: addDays(day, 41),
    processes: ['vendor-onboarding', 'invoice-approval'], status: 'active',
    baselines: [baseline('vendor-modernization', 'Kickoff plan', -30)] });
  add('project', { id: 'access-review-automation', name: 'Quarterly Access Review Automation',
    desc: 'Replace spreadsheet-driven quarterly access certification with an automated campaign and auto-removal.',
    owner: 'ta', resources: ['ta', 'dk', 'ps'], target: addDays(day, 18),
    processes: ['access-review'], status: 'active',
    baselines: [baseline('access-review-automation', 'Kickoff plan', -25)] });
  work.forEach(w => add('workItem', w));

  add('grant', { id: 'G1', projectId: 'vendor-modernization', dataId: 'D4', env: 'dev', access: 'read',
    reason: 'Build and test the ERP vendor write integration', requestedBy: 'dk', status: 'active', approvedBy: 'ar',
    expires: addDays(day, 20), log: [{ at: at(-3, 14), by: 'dk', action: 'requested' }, { at: at(-3, 17), by: 'ar', action: 'approved' }, { at: at(-2, 9), by: 'dk', action: 'activated' }] });
  add('grant', { id: 'G2', projectId: 'vendor-modernization', dataId: 'D2', env: 'uat', access: 'read',
    reason: 'UAT of bank capture and micro-deposit verification', requestedBy: 'dk', status: 'requested',
    expires: addDays(day, 30), log: [{ at: at(-1, 21), by: 'dk', action: 'requested' }] });
  add('grant', { id: 'G3', projectId: 'vendor-modernization', dataId: 'D1', env: 'dev', access: 'read',
    reason: 'Prototype the W-9 upload parser', requestedBy: 'mc', status: 'expired', approvedBy: 'ps',
    expires: addDays(day, -3), log: [{ at: at(-28, 11), by: 'mc', action: 'requested' }, { at: at(-27, 9), by: 'ps', action: 'approved' }, { at: at(-3, 0), by: 'system', action: 'expired' }] });
  add('grant', { id: 'G4', projectId: 'access-review-automation', dataId: 'D7', env: 'dev', access: 'read',
    reason: 'Join entitlements to managers for review campaigns', requestedBy: 'dk', status: 'active', approvedBy: 'ps',
    expires: addDays(day, 14), log: [{ at: at(-15, 10), by: 'dk', action: 'requested' }, { at: at(-15, 13), by: 'ps', action: 'approved' }] });

  add('approval', { id: 'AP1', projectId: 'vendor-modernization', bu: 'Procurement', approver: 'mc', decision: 'approved',
    at: at(-2, 16), stepUp: true, note: 'Procurement steps (intake, contract activation) reviewed and approved.' });
  add('approval', { id: 'AP2', projectId: 'access-review-automation', bu: 'IT', approver: 'dk', decision: 'approved',
    at: at(-1, 14), stepUp: true, note: 'Entitlement pull and auto-removal steps approved.' });

  add('risk', { id: 'R1', projectId: 'vendor-modernization', title: 'Screening vendor contract slips past legal review', impact: 'high', likelihood: 'med', owner: 'ps',
    mitigation: 'Interim manual screening checklist; escalate redlines weekly.', status: 'open' });
  add('risk', { id: 'R2', projectId: 'vendor-modernization', title: 'Bank capture not started; blocks micro-deposits and ERP write', impact: 'high', likelihood: 'high', owner: 'lp',
    mitigation: 'Daily check-in with Treasury; pull Integration Eng. in to pair.', status: 'open' });
  add('risk', { id: 'R3', projectId: 'vendor-modernization', title: 'UAT window overlaps quarter-end close', impact: 'med', likelihood: 'med', owner: 'ta',
    mitigation: 'Book AP testers now; keep a fallback UAT week after close.', status: 'open' });
  add('risk', { id: 'R4', projectId: 'access-review-automation', title: 'Managers miss the first certification deadline', impact: 'low', likelihood: 'med', owner: 'dk',
    mitigation: 'Automated reminders after 5 days; Compliance follows up on stragglers.', status: 'open' });

  const tc = (id, dataId, field, kind, input, expect, note) => add('testCase', { id, dataId, field, kind, input, expect, origin: 'spec', note });
  tc('TC1', 'D2', 'Routing number', 'valid', '123456780', 'accept', '9 digits');
  tc('TC2', 'D2', 'Routing number', 'boundary', '12345678', 'reject', '8 digits (leading zero dropped)');
  tc('TC3', 'D2', 'Routing number', 'invalid', '12AB56789', 'reject', 'Letters not allowed');
  tc('TC4', 'D2', 'Account holder', 'invalid', '', 'reject', 'Required value is blank');
  tc('TC5', 'D1', 'Tax ID (EIN)', 'valid', '12-3456789', 'accept', 'Matches ##-#######');
  tc('TC6', 'D1', 'Tax ID (EIN)', 'invalid', '123456789', 'reject', 'Missing hyphen');
  tc('TC7', 'D7', 'Cost center', 'valid', 'CC1042', 'accept', 'Matches CC####');
  tc('TC8', 'D7', 'Cost center', 'invalid', '1042', 'reject', 'Missing CC prefix');

  add('testRun', { id: 'TR1', projectId: 'vendor-modernization', env: 'dev', at: at(-1, 18), by: 'dk', results: [
    { caseId: 'TC1', outcome: 'pass', note: '' }, { caseId: 'TC2', outcome: 'pass', note: '' },
    { caseId: 'TC3', outcome: 'pass', note: '' }, { caseId: 'TC4', outcome: 'fail', note: 'Capture form accepted a blank account holder.' },
    { caseId: 'TC5', outcome: 'pass', note: '' }, { caseId: 'TC6', outcome: 'pass', note: '' }] });

  add('comment', { id: 'C1', ref: 'workItem:W6', author: 'mc', at: at(-1, 20), mentions: ['ta'],
    text: '@Tom Alvarez Bank capture is due today and has not started; micro-deposit verification, the ERP write and the remit-to check all wait on it. Can we escalate with Treasury?' });
  add('comment', { id: 'C2', ref: 'process:vendor-onboarding', author: 'ps', at: at(-1, 15), mentions: [],
    text: 'Risk-tier thresholds are drafted. I need sign-off on them before the EDD checklist can start.' });

  add('notification', { id: 'N1', to: 'ta', text: 'Maya Chen mentioned you on "Stand up structured bank capture"', ref: 'workItem:W6', at: at(-1, 20), read: false });
  add('notification', { id: 'N2', to: 'lp', text: 'Dev Kumar requested UAT read access to Bank remittance details', ref: 'grant:G2', at: at(-1, 21), read: false });

  const md = n => new Date(addDays(day, n) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const ev = (n, hh, actor, action, ref, summary) => ({ at: at(n, hh), actor, action, ref, summary, seeded: true });
  const events = [
    ev(-30, 15, 'ta', 'create', 'project:vendor-modernization', 'Created project Vendor Onboarding Modernization'),
    ev(-30, 16, 'ta', 'baseline', 'project:vendor-modernization', 'Saved baseline "Kickoff plan"'),
    ev(-28, 11, 'mc', 'request', 'grant:G3', 'Requested Dev read access to Vendor legal name & Tax ID'),
    ev(-15, 17, 'mc', 'update', 'workItem:W1', 'Work item "Launch vendor portal W-9/COI upload" marked done'),
    ev(-7, 10, 'ps', 'update', 'workItem:W2', 'Work item "Sign screening vendor contract" started'),
    ev(-5, 16, 'dk', 'update', 'workItem:W9', 'Work item "Notification automation" marked done'),
    ev(-3, 17, 'ar', 'approve', 'grant:G1', 'Approved Dev read access to Vendor master record'),
    ev(-3, 0, 'system', 'expire', 'grant:G3', 'Dev read access to Vendor legal name & Tax ID expired'),
    ev(-2, 16, 'mc', 'approve', 'approval:AP1', 'Procurement sign-off (step-up verified)'),
    ev(-1, 15, 'ps', 'comment', 'process:vendor-onboarding', 'Commented on Vendor Onboarding'),
    ev(-1, 14, 'dk', 'approve', 'approval:AP2', 'IT sign-off on access review (step-up verified)'),
    ev(-1, 18, 'dk', 'create', 'testRun:TR1', `Dev run, ${md(-1)}: 5 pass, 1 fail`),
    ev(-1, 20, 'mc', 'comment', 'workItem:W6', 'Commented on work item "Stand up structured bank capture" and mentioned Tom Alvarez'),
    ev(-1, 21, 'dk', 'request', 'grant:G2', 'Requested UAT read access to Bank remittance details'),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  enrichR2(docs, day, at);
  return { people: docs.person.map(d => clone(d.data)), docs, events };
}

/* ---------- Round 2 fields (contract R2) ---------- */
const CAPACITY = { mc: 3, ta: 2, ps: 4, lp: 3, ar: 4, dk: 4 };           /* days per week */
const EFFORT = { W1: 6, W2: 3, W3: 4, W4: 3, W5: 3, W6: 5, W7: 4, W8: 7, W9: 4, W10: 3, W11: 5, A1: 5, A2: 6, A3: 3, A4: 2 };
const DONE_AT = { W1: -16, W9: -5, A1: -14, A2: -3, A3: -1 };            /* actual finish offsets */
const SENSITIVITY = { D1: 'confidential', D2: 'pii', D3: 'internal', D4: 'confidential', D5: 'confidential', D6: 'internal', D7: 'internal', D8: 'internal' };
const STEP_META = {                                                       /* pid/step -> {sla, system, durationHrs} */
  'vendor-onboarding/s1': { sla: '5 business days', system: 'Vendor portal', durationHrs: 1 },
  'vendor-onboarding/s2': { sla: '1 business day', system: 'Screening service', durationHrs: 0.5 },
  'vendor-onboarding/s2a': { sla: '5 business days', durationHrs: 6 },
  'vendor-onboarding/s3': { sla: '2 business days', system: 'Treasury portal', durationHrs: 0.5 },
  'vendor-onboarding/s4': { system: 'ERP', durationHrs: 0.25 },
  'invoice-approval/i1': { sla: '1 business day', system: 'ERP' },
  'invoice-approval/i2': { sla: '2 business days', system: 'Approvals' },
  'access-review/r1': { system: 'Identity platform', durationHrs: 0.5 },
  'access-review/r2': { sla: '10 business days', system: 'Review portal' },
  'access-review/r3': { sla: '1 business day', system: 'Identity platform' },
};
const RISK_WORK = { R1: ['W2', 'W3'], R2: ['W6', 'W7', 'W8'], R3: ['W10', 'W11'], R4: ['A4'] };

function enrichR2(docs, day, at) {
  const byId = type => Object.fromEntries(docs[type].map(d => [d.id, d.data]));
  docs.person.forEach(d => { d.data.capacity = CAPACITY[d.id] || 4; });
  docs.workItem.forEach(d => {
    const w = d.data;
    w.effortDays = EFFORT[w.id] || 1;
    if (w.status === 'done' && DONE_AT[w.id] != null) w.doneAt = addDays(day, DONE_AT[w.id]);
  });
  /* W1 was edited after Procurement signed off, so the gate shows a re-approval exception */
  byId('workItem').W1.updatedAt = at(-1, 11);
  docs.dataElement.forEach(d => { d.data.sensitivity = SENSITIVITY[d.id] || 'internal'; });
  byId('dataElement').D2.discovered = [{ text: 'Account holder must be required: the capture form accepted a blank value (dev run, case "Account holder blank").',
    fromRun: 'TR1', at: at(-1, 18) }];
  const walk = (pid, nodes) => (nodes || []).forEach(n => {
    Object.assign(n, STEP_META[pid + '/' + n.id] || {});
    (n.branches || []).forEach(b => walk(pid, b.nodes));
  });
  docs.process.forEach(d => walk(d.id, d.data.tobe));
  docs.risk.forEach(d => { d.data.workItems = RISK_WORK[d.id] || []; });
  docs.approval.forEach(d => { d.data.snapshotAt = d.data.at; });

  const ar = byId('project')['access-review-automation'];
  ar.cutover = { window: addDays(day, 10) + ' 08:00–10:00 (after quarter close)', rollbackOwner: 'dk',
    rollbackPlan: 'Disable the auto-removal job and fall back to the spreadsheet campaign for this quarter.',
    hypercareDays: 10, hypercareOwner: 'ps', comms: 'Manager email and Teams post two days before; reminder on day 5.' };
  ar.uatScripts = [
    { id: 'uat-access-review-r1', pid: 'access-review', step: 'r1', title: 'Pull entitlements automatically',
      given: 'A quarter end with three finance apps connected', when: 'The scheduled pull runs', then: 'Every active account appears with its manager', data: ['D7'] },
    { id: 'uat-access-review-r2', pid: 'access-review', step: 'r2', title: 'Managers certify in review portal',
      given: 'A manager with five direct reports', when: 'They certify four and reject one', then: 'Decisions are recorded with timestamps', data: ['D7'] },
    { id: 'uat-access-review-r3', pid: 'access-review', step: 'r3', title: 'Auto-remove uncertified access',
      given: 'One rejected account', when: 'The removal job runs', then: 'Access is removed and the evidence pack lists it', data: [] },
  ];
  const d7Cases = ['TC7', 'TC8'].map(caseId => ({ caseId, outcome: 'pass', note: '' }));
  /* vendor-modernization intentionally has no cutover plan: it shows as an open gate item */
  docs.testRun.push({ id: 'TR2', data: { id: 'TR2', projectId: 'access-review-automation', env: 'dev', at: at(-4, 15), by: 'dk',
    results: ar.uatScripts.map(x => ({ scriptId: x.id, outcome: 'pass', note: '' })).concat(d7Cases) } });
  docs.testRun.push({ id: 'TR3', data: { id: 'TR3', projectId: 'access-review-automation', env: 'uat', at: at(-2, 15), by: 'ps',
    results: ar.uatScripts.map(x => ({ scriptId: x.id, outcome: 'pass', note: '', evidence: 'Screenshot pack in UAT folder' })).concat(d7Cases) } });
}

module.exports = { seed, DOC_TYPES, addDays, dayOf };
