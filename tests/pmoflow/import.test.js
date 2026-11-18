/* R10 S2: the import module (api/shared/pmoflow-import.js), run with node tests/pmoflow/import.test.js
   Fixtures are the reviewers' procedures (market-review karen.md, jordan.md, expert-bpm.md):
   vendor onboarding (9 lines), offboarding with "if not returned within 5 days, notify Legal", a co-approve line. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const I = require('../../api/shared/pmoflow-import.js');
const ai = require('../../api/shared/pmoflow-ai.js');
const { seed } = require('../../api/shared/pmoflow-seed.js');

const walk = (ns, out = []) => { (ns || []).forEach(n => { out.push(n); (n.branches || []).forEach(b => walk(b.nodes, out)); }); return out; };
const steps = r => walk(r.nodes).filter(n => n.type === 'step');
const tops = r => r.nodes.filter(n => n.type !== 'trigger');

const VENDOR = `Vendor Onboarding
1. The requester submits a new vendor request form with the vendor name and contact details.
2. Procurement sends the vendor the onboarding packet, usually by email, sometimes fax.
3. The vendor returns the signed W-9 and the certificate of insurance.
4. Enter the vendor into the ERP and check the tax ID against the W-9.
5. Compliance screens the vendor against the restricted-party list within 2 business days.
6. If the annual spend is over $25,000, the Finance Manager approves the vendor. Otherwise, the Procurement Manager approves.
7. Treasury collects the bank details through the secure supplier form and confirms them with a call-back.
8. Accounts Payable creates the vendor master record and verifies the remittance address.
9. Procurement emails the vendor a welcome letter and closes the request.`;

const OFFBOARD = `Employee Offboarding
Purpose: close out a leaver safely.
1. HR Manager (Maya Chen) enters the termination in the HRIS.
2. IT disables the employee's accounts on the last day.
3. Facilities collects the laptop and badge; if not returned within 5 days, notify Legal.
4. Payroll processes the final paycheck.
5. Wait 2 business days for the benefits provider to confirm.
6. HR sends the exit survey to the employee.`;

const COAPPROVE = `1. The buyer drafts the contract.
2. Finance and Legal co-approve the contract.
3. The buyer sends the signed contract to the supplier. If anything is missing, return to step 1.`;

test('vendor onboarding: one numbered line is one step, clauses stay in the note', () => {
  const r = I.parseSop(VENDOR);
  assert.equal(r.nodes[0].type, 'trigger');
  assert.equal(tops(r).length, 9, 'nine lines, nine top-level items');
  const t = tops(r);
  /* Karen: "Usually by email, sometimes fax" was split into its own step */
  assert.equal(t[1].title, 'Send the vendor the onboarding packet');
  assert.match(t[1].note, /usually by email, sometimes fax/);
  assert.ok(!steps(r).some(s => /^usually|^sometimes/i.test(s.title)), 'no step made of a sub-clause');
  /* Karen: a role called "Enter the vendor" */
  assert.ok(!steps(r).some(s => /^enter\b/i.test(s.ownerRole || '')), 'no role made from a verb phrase');
  assert.equal(t[3].ownerRole, undefined, 'an imperative line has no role');
  /* Jordan: "…and check" was truncated */
  assert.equal(t[3].title, 'Enter the vendor into the ERP and check the tax ID against the W-9', 'no truncation');
  assert.equal(t[3].system, 'ERP');
  assert.deepEqual([t[0].ownerRole, t[1].ownerRole, t[2].ownerRole, t[4].ownerRole], ['Requester', 'Procurement', 'Vendor', 'Compliance']);
  assert.equal(t[4].sla, '2 business days');
  /* line 6 is a choice; each path names its approver */
  assert.equal(t[5].type, 'decision');
  assert.equal(t[5].title, 'Annual spend over $25,000?');
  assert.deepEqual(t[5].branches.map(b => b.nodes.map(n => [n.title, n.ownerRole])), [[['Approve the vendor', 'Finance Manager']], [['Approve the vendor', 'Procurement Manager']]]);
  assert.equal(t[8].title, 'Email the vendor a welcome letter and close the request');
  /* counts are stated once, from the nodes */
  assert.match(r.notes, /^Found 10 steps, 1 choice\./);
  assert.deepEqual(I.countNodes(r.nodes), { steps: 10, waits: 0, messages: 0, subprocesses: 0, decisions: 1, parallels: 0, ends: 0 });
  /* teams parsed from the text fill "Teams involved" */
  for (const team of ['Procurement', 'Compliance', 'Treasury', 'Accounts Payable', 'Finance']) assert.ok(r.teams.includes(team), team);
  assert.ok(t[1].touches.includes('Procurement'));
  assert.equal(r.name, 'Vendor onboarding');
  /* information proposals are document or field phrases, fresh to this process */
  const names = r.newData.map(x => x.name);
  for (const n of ['Vendor request form', 'W-9', 'Certificate of insurance', 'Tax ID', 'Restricted-party list', 'Bank details', 'Vendor master record', 'Welcome letter']) assert.ok(names.includes(n), n + ' in ' + names.join(', '));
  assert.ok(!names.some(n => /^(procurement|requester|treasury)\b/i.test(n)), 'no role proposed as information');
});

test('offboarding: "if not returned within 5 days, notify Legal" stays on step 3; Role (Name) is a role', () => {
  const r = I.parseSop(OFFBOARD);
  const t = tops(r);
  assert.deepEqual(t.map(n => n.type), ['step', 'step', 'step', 'decision', 'step', 'wait', 'step']);
  assert.equal(t[2].title, 'Collect the laptop and badge');
  assert.equal(t[2].ownerRole, 'Facilities');
  const d = t[3];
  assert.equal(d.title, 'Returned within 5 days?');
  assert.deepEqual(d.branches[0].nodes, [], 'returned: carry on');
  assert.deepEqual(d.branches[1].nodes.map(n => [n.title, n.ownerRole]), [['Notify Legal', 'Facilities']]);
  assert.ok(r.teams.includes('Legal') && r.teams.includes('Facilities') && r.teams.includes('IT'));
  /* "HR Manager (Maya Chen)": the role is the owner; the name is kept as written, never linked to a person */
  assert.deepEqual([t[0].ownerRole, t[0].owner, t[0].note], ['HR Manager', undefined, 'Named in the procedure: Maya Chen']);
  assert.equal(t[0].system, 'HRIS');
  assert.deepEqual([t[4].title, t[4].ownerRole], ['Process the final paycheck', 'Payroll']);
  assert.deepEqual([t[5].type, t[5].wait], ['wait', '2 business days for the benefits provider to confirm']);
  assert.ok(!steps(r).some(s => /purpose/i.test(s.title)), 'metadata lines skipped');
  assert.equal(r.name, 'Employee offboarding');
});

test('co-approve keeps its hyphen; "return to step 1" loops back', () => {
  const r = I.parseSop(COAPPROVE);
  const t = tops(r);
  assert.equal(t[1].title, 'Co-approve the contract');
  assert.equal(t[1].ownerRole, 'Finance and Legal');
  assert.ok(!JSON.stringify(r).includes('coes'), 'no "coes-approve"');
  const d = t.find(n => n.type === 'decision');
  assert.equal(d.branches[0].goto, t[0].id, 'loops back to step 1');
  assert.equal(I.verbBase('co-approves'), 'co-approve');
  assert.equal(I.verbBase('processes'), 'process');
  assert.equal(I.verbBase('verifies'), 'verify');
});


/* ---------- R11 G2: import fidelity on the R10 reviewers' own procedures ---------- */
/* Karen (R10 karen.md): 9 lines, step 6 numbered "6 - …" was dropped; roles at the start of a sentence; "Known number" */
const KAREN = `Vendor Setup Procedure
Owner: Purchasing
1. Buyer gets the vendor's W-9, certificate of insurance and bank details.
2. Buyer enters the request on the new vendor form.
3. Credit/Finance reviews the vendor's credit application and payment terms.
4. If Credit/Finance rejects the vendor, the Buyer tells the requester.
5) Purchasing manager approves the new vendor in Coupa.
6 - AP enters vendor in the ERP (vendor master)
7. AP calls the vendor's known number to confirm the bank details.
8. Finance releases the vendor for payment.
9. Purchasing emails the vendor a welcome letter.`;
const CREDIT = `Credit Limit Increase SOP
Trigger: A customer asks for a higher credit limit.
1. The Sales Rep submits the credit limit request in Salesforce.
2. The Credit Analyst pulls the Dun & Bradstreet report for the customer.
3. The Credit Analyst reviews the customer's payment history in NetSuite.
4. If the requested limit exceeds $50,000, the Credit Manager reviews the request.
5. Otherwise, the Credit Analyst approves the request.
6. If the Credit Manager does not approve within 2 business days, escalate to the CFO.
7. If the Credit Manager rejects the request, the Sales Rep tells the customer.
8. Limits above $250,000 also need sign-off from the Controller (Sam Wu).
9. The Credit Analyst updates the credit limit in NetSuite.
10. The Credit Analyst records the decision in Workiva.
11. The Sales Rep notifies the customer of the new limit.
12. The Credit Analyst files the approval letter in SharePoint.`;
const JORDAN = `Benefits Enrollment Change
Step 1: The member services rep logs the life-event request in Salesforce.
2) Benefits Analyst checks the member's eligibility and the plan rules.
(3) If the request is complete, the Benefits Analyst updates the election in Workday.
Otherwise, the member services rep asks the member for the missing documents.
4 – Benefits Supervisor (Dana Ortiz) approves changes over $500 a month.
5 - Payroll updates the deduction before the next pay run.
Step 6 The Benefits Analyst sends the member a confirmation letter through DocuSign.
7. Notes: file the confirmation in SharePoint.`;

const everyLineKept = r => { const ids = new Set(walk(r.nodes).map(n => n.id)); return r.lines.every(l => l.nodes.length && l.nodes.every(i => ids.has(i))); };

test('Karen: 9 lines → 9 steps; "6 - …" and "5)" are steps; roles at the start of a sentence', () => {
  const r = I.parseSop(KAREN);
  assert.equal(r.lines.length, 9, 'nine lines read');
  assert.deepEqual(r.lines.map(l => l.num), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(everyLineKept(r), 'every line maps to a node on the map');
  assert.equal(r.linesText, '9 lines → 9 steps, 1 choice');
  const st = steps(r);
  const six = st.find(s => /^Enter vendor in the ERP/.test(s.title));
  assert.ok(six, 'line 6 ("6 - AP enters vendor in the ERP") is a step');
  assert.deepEqual([six.ownerRole, six.system], ['AP', 'ERP']);
  const t = tops(r);
  assert.deepEqual([t[0].title, t[0].ownerRole], ["Get the vendor's W-9, certificate of insurance and bank details", 'Buyer'], '"Buyer gets…" is Buyer');
  assert.equal(t[2].ownerRole, 'Credit/Finance', '"Credit/Finance reviews…"');
  assert.equal(t[4].ownerRole, 'Purchasing manager');
  assert.equal(t[4].system, 'Coupa');
  /* the reject path ends */
  const d = t[3];
  assert.equal(d.type, 'decision');
  assert.deepEqual(d.branches[0].nodes.map(n => n.type === 'end' ? 'END' : n.title), ['Tell the requester', 'END']);
  assert.equal(d.branches[0].nodes[1].title, 'Stop: request rejected');
  assert.deepEqual(d.branches[1].nodes, []);
  /* information: never "Known number"; bank details found */
  const names = r.newData.map(x => x.name);
  assert.ok(!names.some(n => /known/i.test(n)), 'no "Known number": ' + names.join(', '));
  assert.ok(names.includes('Vendor phone number'), names.join(', '));
  assert.ok(names.includes('Bank details'));
  for (const team of ['Purchasing', 'AP', 'Credit', 'Finance']) assert.ok(r.teams.includes(team), team);
});

test('Credit-limit SOP (BPM expert): else branch, reject ends, SLA is a timer, articles stripped, Role (Name) mid-line, systems', () => {
  const r = I.parseSop(CREDIT);
  assert.equal(r.lines.length, 12);
  assert.ok(everyLineKept(r));
  assert.deepEqual(r.lines.map(l => l.as), ['step', 'step', 'step', 'step', 'else', 'timer', 'step', 'step', 'step', 'step', 'step', 'step']);
  assert.ok(!steps(r).some(s => /^otherwise/i.test(s.title)), 'no step called "Otherwise…"');
  const t = tops(r);
  const d = t[3];
  assert.equal(d.title, 'Requested limit exceeds $50,000?');
  assert.deepEqual(d.branches.map(b => b.nodes.map(n => [n.title, n.ownerRole])), [[['Review the request', 'Credit Manager']], [['Approve the request', 'Credit Analyst']]], 'line 5 is the No path');
  /* the 2-day escalation is a timer on the Credit Manager's step, not a choice */
  assert.deepEqual(d.branches[0].nodes[0].timer, { after: '2 business days', iso: 'P2D', businessDays: 2, action: 'Escalate to the CFO', to: 'CFO' });
  assert.equal(walk(r.nodes).filter(n => n.type === 'decision').length, 2, 'two choices, no escalation choice');
  assert.ok(!walk(r.nodes).some(n => n.type === 'decision' && /within/i.test(n.title)));
  const rej = t[4];
  assert.equal(rej.title, 'Credit Manager rejects the request?');
  assert.equal(rej.branches[0].nodes[rej.branches[0].nodes.length - 1].type, 'end', 'reject path ends');
  /* articles stripped from every role */
  assert.ok(steps(r).every(s => !/^(the|a|an)\s/i.test(s.ownerRole || '')), 'no leading article');
  assert.equal(t[0].ownerRole, 'Sales Rep');
  /* "Controller (Sam Wu)" mid-line */
  const ctl = steps(r).find(s => /sign-off/i.test(s.title));
  assert.deepEqual([ctl.ownerRole, ctl.note], ['Controller', 'Named in the procedure: Sam Wu']);
  assert.ok(!/Sam Wu/.test(ctl.title));
  /* systems, never information names */
  const sys = steps(r).map(s => s.system).filter(Boolean);
  for (const x of ['Salesforce', 'Dun & Bradstreet', 'NetSuite', 'Workiva', 'SharePoint']) assert.ok(sys.includes(x), x);
  const names = r.newData.map(x => x.name);
  assert.ok(!names.some(n => /bradstreet|workiva|netsuite|salesforce|sharepoint/i.test(n)), names.join(', '));
  assert.ok(names.includes('Approval letter'));
});

test('Jordan: "Step 1:", "2)", "(3)", "4 –", "Step 6", an unnumbered "Otherwise" line and a "Notes:" line', () => {
  const r = I.parseSop(JORDAN);
  assert.equal(r.lines.length, 7);
  assert.ok(everyLineKept(r));
  assert.equal(r.linesText, '7 lines → 8 steps, 1 choice');
  const t = tops(r);
  assert.equal(t[0].ownerRole, 'Member services rep');
  assert.equal(t[2].type, 'decision');
  assert.deepEqual(t[2].branches[1].nodes.map(n => [n.title, n.ownerRole]), [['Ask the member for the missing documents', 'Member services rep']], 'the unnumbered Otherwise line is the No path');
  assert.ok(!t[2].branches[1].nodes[0].system, 'a path step does not borrow the other path\'s system');
  assert.deepEqual([t[3].ownerRole, t[3].note], ['Benefits Supervisor', 'Named in the procedure: Dana Ortiz']);
  assert.equal(t[4].ownerRole, 'Payroll');
  assert.equal(t[5].system, 'DocuSign');
  assert.equal(t[6].title, 'File the confirmation in SharePoint');
});

test('systems dictionary: about 60 names; a system is never a role, team or information', () => {
  assert.ok(I.SYSTEMS.length >= 60, String(I.SYSTEMS.length));
  for (const x of ['Workiva', 'Dun & Bradstreet', 'Coupa', 'Ariba', 'Concur', 'Workday', 'NetSuite', 'SAP', 'Oracle', 'Dynamics', 'QuickBooks', 'Salesforce', 'HubSpot', 'ServiceNow', 'Zendesk', 'DocuSign', 'Adobe Sign', 'SharePoint', 'Outlook', 'Excel']) assert.equal(I.systemIn(`The clerk files it in ${x} today.`), x, x);
  assert.equal(I.systemIn('Post the update in Teams'), 'Microsoft Teams');
  assert.equal(I.systemIn('Teams review the request'), '', '"Teams" as a word is not the app');
  assert.equal(I.systemIn('Run it through SAP Ariba'), 'SAP Ariba');
  const r = I.parseSop('1. The analyst exports the Workday report.\n2. The analyst attaches the Concur expense report.');
  assert.ok(!r.newData.some(x => /workday|concur/i.test(x.name)), r.newData.map(x => x.name).join(', '));
});

test('SLA escalation forms; "if not returned … notify Legal" stays a choice', () => {
  assert.equal(I.escalationOf('if not approved within 2 business days, escalate to the CFO').timer.to, 'CFO');
  assert.equal(I.escalationOf('If no response within 3 days, remind the vendor').timer.after, '3 business days');
  assert.equal(I.escalationOf('if not returned within 5 days, notify Legal'), null);
  const r = I.parseSop('1. The Finance Manager approves the invoice; if not approved within 2 business days, escalate to the Controller.\n2. AP pays the invoice.');
  assert.equal(tops(r).length, 2);
  assert.equal(tops(r)[0].timer.to, 'Controller');
  assert.equal(r.linesText, '2 lines → 2 steps');
});

test('never drops a line: metadata words, headings and 200+ numbered lines', () => {
  const r = I.parseSop('1. Process: the clerk logs the claim.\n2. Owner reviews it.\n3) Name: the adjuster checks the policy.');
  assert.equal(r.lines.length, 3);
  assert.ok(everyLineKept(r));
  const many = Array.from({ length: 75 }, (_, i) => `${i + 1}. The clerk checks item ${i + 1}.`).join('\n');
  const m = I.parseSop(many);
  assert.equal(m.lines.length, 75);
  assert.equal(steps(m).length, 75);
});

test('demo-data isolation: "bank details" never attaches Bank remittance details / Leo Park', async () => {
  const docs = seed('2026-11-04').docs;
  const bank = docs.dataElement.map(d => d.data).find(d => d.name === 'Bank remittance details');
  assert.ok(bank, 'the seed has the element this test guards against');
  const sop = '1. Treasury collects the bank details from the new vendor\n2. Leo Park checks the bank details';
  const r = I.sopRules(sop, docs);
  const all = walk(r.nodes);
  assert.ok(all.every(n => n.owner == null), 'no node is owned by a workspace person');
  assert.ok(all.every(n => n.data == null), 'no node links a workspace data element');
  assert.ok(!JSON.stringify(r).includes(bank.id), 'the seed element id never appears');
  assert.ok(r.newData.some(x => x.name === 'Bank details'), 'proposed fresh instead');
  assert.ok(!r.newData.some(x => /remittance/i.test(x.name)));
  assert.equal(all.find(n => n.type === 'step' && /^Check/.test(n.title)).ownerRole, 'Leo Park', 'a name in the text stays text');
  /* the API's rules path uses this module */
  const res = await ai.run('sop-import', { text: sop }, docs, '2026-11-04');
  assert.equal(res.body.source, 'rules');
  assert.ok(!JSON.stringify(res.body).includes(bank.id));
  assert.ok(walk(res.body.nodes).every(n => n.owner == null));
});

test('prose without numbers: one sentence, one step; bullets work too', () => {
  const r = I.parseSop('The clerk logs the request. The manager reviews it within one business day. The clerk closes it.');
  assert.equal(steps(r).length, 3);
  const b = I.parseSop('- Buyer raises the purchase order\n- Supplier confirms the order\n  - include the delivery date');
  assert.equal(tops(b).length, 2);
  assert.deepEqual(tops(b)[1].subs.map(s => s.title), ['Include the delivery date']);
  const p = I.parseSop('1. Vendor signs the contract\n2. At the same time, Accounts Payable creates the vendor master record in the ERP and IT provisions contractor access in Workday.');
  const g = tops(p)[1];
  assert.equal(g.type, 'parallel');
  assert.deepEqual(g.branches.map(x => x.label), ['Accounts Payable', 'IT']);
});

test('durations: business days keep their meaning beside the ISO value', () => {
  assert.deepEqual(I.durationInfo('2 business days'), { text: '2 business days', n: 2, unit: 'day', businessDays: 2, iso: 'P2D' });
  assert.equal(I.durationInfo('4 hours').iso, 'PT4H');
  assert.equal(I.durationInfo('1 week').businessDays, 5);
  assert.equal(I.durationInfo('soon'), null);
});

test('RACI helpers: optional, plain text', () => {
  assert.equal(I.raciEmpty({}), true);
  const n = { raci: { a: 'Finance manager', c: 'Legal, Tax', i: ['Requester'] } };
  assert.deepEqual(I.raciOf(n), { a: 'Finance manager', c: ['Legal', 'Tax'], i: ['Requester'] });
  assert.equal(I.raciText(n), 'Accountable: Finance manager · Consulted: Legal, Tax · Informed: Requester');
  assert.equal(I.raciText({ raci: { a: 'p1' } }, id => id === 'p1' ? 'Pat Lee' : null), 'Accountable: Pat Lee');
});

test('six templates: generic, editable, owners are roles, every one has information', () => {
  const want = ['Vendor onboarding', 'Employee onboarding', 'Employee offboarding', 'Invoice approval', 'Purchase request', 'Customer refund'];
  assert.deepEqual(I.TEMPLATES.map(t => t.name), want);
  for (const t of I.TEMPLATES) {
    const d = I.templateDraft(t.id);
    const st = walk(d.nodes).filter(n => n.type === 'step');
    assert.ok(st.length >= 4, t.name + ' has steps');
    assert.ok(st.every(s => s.ownerRole && !s.owner), t.name + ': owners are roles');
    assert.ok(d.newData.length >= 3, t.name + ' has information');
    assert.ok(d.newData.every(x => x.steps.length), t.name + ': each piece of information sits on a step');
    assert.ok(!/northwind|leo park|maya chen|ana ruiz/i.test(JSON.stringify(d)), t.name + ' carries no demo names');
  }
  assert.equal(I.templateDraft('nope'), null);
});

/* ---------- Visio: a small .vsdx written here with a minimal ZIP writer ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return b => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
function zip(files, deflate) {
  const locals = [], central = []; let off = 0;
  Object.entries(files).forEach(([name, text]) => {
    const raw = Buffer.from(text, 'utf8'), data = deflate ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name, 'utf8'), crc = CRC(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, data); central.push(ch, nm); off += 30 + nm.length + data.length;
  });
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
/* shapes: 2 swimlanes (Requester left, Purchasing right), Start, 3 Process, 1 Decision, End, a Document attached to a step */
function vsdxFixture(deflate, pageName) {
  const sh = (id, master, text, x, y, w, h) => `<Shape ID="${id}" Type="Shape" Master="${master}"><Cell N="PinX" V="${x}"/><Cell N="PinY" V="${y}"/><Cell N="Width" V="${w}"/><Cell N="Height" V="${h}"/><Text>${text}</Text></Shape>`;
  const con = (id, text) => `<Shape ID="${id}" Type="Shape" Master="9">${text ? `<Text>${text}</Text>` : ''}</Shape>`;
  const shapes = [
    sh(1, 5, 'Requester', 2, 5, 3, 10), sh(2, 5, 'Purchasing', 5, 5, 3, 10),
    sh(10, 2, 'Start', 2, 9.5, 1, 0.5),
    sh(11, 1, 'Submit purchase request', 2, 8.5, 1.5, 0.75),
    sh(12, 1, 'Check budget &amp; quotes', 5, 7.5, 1.5, 0.75),
    sh(13, 3, 'Over $5,000?', 5, 6.5, 1, 1),
    sh(14, 1, 'Director approves', 5, 5.5, 1.5, 0.75),
    sh(15, 1, 'Raise purchase order', 5, 4.5, 1.5, 0.75),
    sh(16, 2, 'End', 5, 3.5, 1, 0.5),
    sh(17, 4, 'Purchase request form', 0.6, 8.5, 0.8, 0.6),
    con(20), con(21), con(22), con(23, 'Yes'), con(24, 'No'), con(25), con(26), con(27),
  ].join('');
  const c = (con, from, to) => `<Connect FromSheet="${con}" FromCell="BeginX" ToSheet="${from}"/><Connect FromSheet="${con}" FromCell="EndX" ToSheet="${to}"/>`;
  const connects = [c(20, 10, 11), c(21, 11, 12), c(22, 12, 13), c(23, 13, 14), c(24, 13, 15), c(25, 14, 15), c(26, 15, 16), c(27, 17, 11)].join('');
  const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'docProps/core.xml': '<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:title>Purchasing diagrams v2</dc:title></cp:coreProperties>',
    /* R11 G2 (Jordan): the page name, not the file or document name, names the process */
    'visio/pages/pages.xml': `<?xml version="1.0"?><Pages xmlns="${NS}"><Page ID="0" NameU="${pageName || 'Purchase request'}" Name="${pageName || 'Purchase request'}"/></Pages>`,
    'visio/masters/masters.xml': `<?xml version="1.0"?><Masters xmlns="${NS}"><Master ID="1" NameU="Process"/><Master ID="2" NameU="Start/End"/><Master ID="3" NameU="Decision"/><Master ID="4" NameU="Document"/><Master ID="5" NameU="Swimlane"/><Master ID="9" NameU="Dynamic connector"/></Masters>`,
    'visio/pages/page1.xml': `<?xml version="1.0" encoding="utf-8"?><PageContents xmlns="${NS}"><Shapes>${shapes}</Shapes><Connects>${connects}</Connects></PageContents>`,
  }, deflate);
}

test('Visio .vsdx: shapes, connectors and swimlanes become steps, links and roles (stored and deflated)', async () => {
  for (const deflate of [false, true]) {
    const buf = vsdxFixture(deflate);
    const v = await I.parseVsdx(buf);
    assert.equal(v.name, 'Purchase request');
    assert.deepEqual([v.steps, v.decisions, v.parallels], [4, 1, 0]);
    assert.deepEqual(v.lanes.sort(), ['Purchasing', 'Requester']);
    /* the BPMN it hands to the app's BPMN preview */
    const x = I.parseXml(v.bpmn);
    const proc = I._all(x, 'process')[0];
    const by = l => I._all(proc, l);
    assert.equal(by('userTask').length, 4);
    assert.equal(by('exclusiveGateway').length, 1);
    assert.equal(by('startEvent').length, 1);
    assert.equal(by('endEvent').length, 1);
    const lanes = Object.fromEntries(by('lane').map(l => [l.attrs.name, I._all(l, 'flowNodeRef').map(r => I._textOf(r))]));
    const nameOf = idv => by('userTask').concat(by('exclusiveGateway')).find(e => e.attrs.id === idv).attrs.name;
    assert.deepEqual(lanes.Requester.map(nameOf), ['Submit purchase request']);
    assert.deepEqual(lanes.Purchasing.map(nameOf).sort(), ['Check budget & quotes', 'Director approves', 'Over $5,000?', 'Raise purchase order']);
    const flows = by('sequenceFlow');
    assert.equal(flows.length, 7);
    assert.deepEqual(flows.filter(f => f.attrs.name).map(f => f.attrs.name).sort(), ['No', 'Yes']);
    /* a document shape connected to a step is that step's information (BPMN data object + association) */
    assert.equal(by('dataObjectReference')[0].attrs.name, 'Purchase request form');
    const task = by('userTask').find(t => t.attrs.name === 'Submit purchase request');
    assert.equal(I._all(task, 'dataInputAssociation').length, 1);
    assert.deepEqual(v.dropped, []);
  }
  await assert.rejects(() => I.parseVsdx(Buffer.from('not a zip')), /not a Visio/);
  /* a default page name ("Page-1") falls back to the document title */
  const v2 = await I.parseVsdx(vsdxFixture(true, 'Page-1'));
  assert.equal(v2.name, 'Purchasing diagrams v2');
  /* the fixture is also written for the browser test */
  fs.mkdirSync('/tmp/pmo-design', { recursive: true });
  fs.writeFileSync('/tmp/pmo-design/purchase-request.vsdx', vsdxFixture(true));
});

/* ---------- R12 H2: the R11 reviewers' procedures (market-review/r11 karen.md, expert-bpm.md) ---------- */
/* Karen (R11): 9 lines; inline roles "Purchasing mgr" / "Credit dept"; "if spend over $25k Karen approves too" (no comma);
   documents COI, vendor master, bank details; teams Purchasing / Credit / AP / Treasury (never "Procurement") */
const KAREN12 = `Vendor Onboarding
1. Requester emails Purchasing the vendor name and what we are buying.
2. Purchasing mgr sends the vendor our packet and collects the W-9, COI and bank details.
3. Credit dept runs a D&B check on the vendor.
4. If spend over $25k Karen approves too.
5. AP sets up the vendor master in the ERP.
6. Treasury verifies the bank details with a call-back to the vendor.
7. AP saves the W-9 and COI in SharePoint.
8. AP emails the vendor a welcome letter.
9. Purchasing mgr tells the requester the vendor is live.`;
/* BPM expert (R11): the "under $50k" Yes path approves and must skip the Credit Manager's review; the 2-day escalation
   belongs on the Credit Manager's "Approve or reject" step, not on the reject path's "Notify the Sales Rep";
   "Sam Wu signs off" is the Accountable person; "copies the Account Manager" is Informed */
const CREDIT12 = `Credit Limit Request
Trigger: A customer asks for a higher credit limit.
1. The Sales Rep submits the credit limit request in Salesforce.
2. The Credit Analyst pulls the D&B report and reviews the customer's payment history.
3. If the requested limit is under $50k, approve it.
4. The Credit Manager approves or rejects the request.
5. If rejected, the Credit Manager notifies the Sales Rep.
6. If the Credit Manager does not respond within 2 business days, escalate to the CFO.
7. AR updates the credit limit in NetSuite. Sam Wu signs off.
8. The Sales Rep tells the customer, and copies the Account Manager.`;

test('R12 Karen: inline roles, "if spend over $25k Karen approves too" is an approval choice, documents found', () => {
  const r = I.parseSop(KAREN12);
  assert.equal(r.lines.length, 9);
  assert.ok(everyLineKept(r));
  assert.equal(r.linesText, '9 lines → 9 steps, 1 choice');
  const t = tops(r);
  /* inline roles: "Purchasing mgr", "Credit dept" */
  assert.deepEqual([t[1].ownerRole, t[1].title], ['Purchasing manager', 'Send the vendor our packet and collect the W-9, COI and bank details']);
  assert.deepEqual([t[2].ownerRole, t[2].title], ['Credit department', 'Run a D&B check on the vendor']);
  assert.deepEqual(t[1].touches, ['Purchasing']);
  assert.deepEqual(t[2].touches, ['Credit']);
  assert.deepEqual([t[8].ownerRole, t[8].touches], ['Purchasing manager', ['Purchasing']], 'step 9 has its team');
  /* line 4: a choice whose Yes path is Karen's extra approval; No carries on */
  const d = t[3];
  assert.equal(d.type, 'decision');
  assert.equal(d.title, 'Spend over $25k?');
  const ap = d.branches[0].nodes[0];
  assert.deepEqual([ap.title, ap.ownerRole, ap.approval], ['Also approve', 'Karen', true]);
  assert.deepEqual(d.branches[1].nodes, []);
  assert.ok(!steps(r).some(s => /^if\b/i.test(s.title)), 'no step called "If spend…"');
  /* every step a team does carries that team: AP does 3 steps */
  assert.equal(steps(r).filter(s => (s.touches || []).includes('AP')).length, 3);
  assert.ok(steps(r).filter(s => s.ownerRole && s.ownerRole !== 'Karen' && s.ownerRole !== 'Requester').every(s => s.touches.length), 'every team step has its team');
  assert.deepEqual(r.teams.slice().sort(), ['AP', 'Credit', 'Purchasing', 'Treasury']);
  assert.ok(!JSON.stringify(r).includes('Procurement'), 'never a default team');
  /* documents named in the text become information */
  const names = r.newData.map(x => x.name);
  for (const n of ['W-9', 'Certificate of insurance', 'Bank details', 'Vendor master', 'Welcome letter']) assert.ok(names.includes(n), n + ' in ' + names.join(', '));
  assert.ok(t[6].newData.some(x => x.name === 'Certificate of insurance'), 'COI on the step that saves it');
});

test('R12 approving departments: the teams the reader finds seed the engine\'s mapping; never a default (H1 API)', () => {
  const E = require('../../api/shared/pmoflow-engine.js');
  const docs = seed('2026-11-17').docs;
  const m = E.seedTeamDepartments(docs, I.parseSop(KAREN12).nodes);
  for (const t of ['Purchasing', 'Credit', 'AP', 'Treasury']) assert.ok(t in m, t + ' is a team: ' + JSON.stringify(m));
  assert.deepEqual([m.Purchasing, m.Credit, m.AP, m.Treasury], [null, null, 'Accounts Payable', 'Treasury']);
  assert.ok(!Object.values(m).includes('Procurement'), 'nothing defaults to Procurement');
  /* the BPM expert's Credit / AR / Sales process: no department named Credit, AR or Sales, so all three are chosen by hand */
  const c = E.seedTeamDepartments(docs, I.parseSop(CREDIT12).nodes);
  assert.deepEqual(Object.keys(c).sort(), ['AR', 'Credit', 'Sales']);
  assert.ok(Object.values(c).every(v => v === null));
  const p = { id: 'x', name: 'Credit limit', tobe: I.parseSop(CREDIT12).nodes, teamDepartments: c };
  assert.deepEqual(E.teamRouting(docs, p).teams.map(x => x.text), ['Choose who approves for Sales', 'Choose who approves for Credit', 'Choose who approves for AR']);
});

test('R12 credit limit: the "under $50k" path skips the review; the timer is on the Credit Manager\'s step; RACI pre-filled', () => {
  const r = I.parseSop(CREDIT12);
  assert.equal(r.lines.length, 8);
  assert.ok(everyLineKept(r));
  const t = tops(r);
  const th = t[2];
  assert.equal(th.type, 'decision');
  assert.equal(th.title, 'Requested limit under $50k?');
  const review = t[3], rej = t[4], upd = t[5];
  assert.deepEqual([review.title, review.ownerRole], ['Approve or reject the request', 'Credit Manager']);
  assert.equal(th.branches[0].nodes[0].title, 'Approve it');
  assert.equal(th.branches[0].goto, upd.id, 'the Yes path skips the Credit Manager\'s review (and its reject path) to step 7');
  assert.deepEqual(th.branches[1].nodes, [], 'No carries on to the review');
  /* the escalation watches the Credit Manager's approval, never the reject path */
  assert.deepEqual(review.timer, { after: '2 business days', iso: 'P2D', businessDays: 2, action: 'Escalate to the CFO', to: 'CFO' });
  assert.equal(rej.type, 'decision');
  assert.ok(!walk(rej.branches[0].nodes).some(n => n.timer), 'no timer on "Notify the Sales Rep"');
  /* RACI from the text */
  assert.deepEqual([upd.title, upd.raci], ['Update the credit limit in NetSuite', { a: 'Sam Wu' }]);
  const tell = t[6];
  assert.deepEqual([tell.title, tell.raci], ['Tell the customer', { i: ['Account Manager'] }]);
  /* the timer line is a time limit, not a step */
  assert.deepEqual(r.lines.map(l => l.as), ['step', 'step', 'step', 'step', 'step', 'timer', 'step', 'step']);
});

test('R12 RACI phrases: sign-off, consulted and informed', () => {
  const r = I.parseSop(`1. The buyer drafts the contract after consulting Legal.
2. Finance approves the contract; the Controller (Sam Wu) signs off.
3. The buyer sends the contract to the supplier and keeps the requester informed.
4. Limits above $250,000 also need sign-off from the Controller (Sam Wu).`);
  const t = tops(r);
  assert.deepEqual([t[0].title, t[0].raci], ['Draft the contract', { c: ['Legal'] }]);
  assert.deepEqual([t[1].title, t[1].ownerRole, t[1].raci], ['Approve the contract', 'Finance', { a: 'Controller (Sam Wu)' }]);
  assert.deepEqual([t[2].title, t[2].raci], ['Send the contract to the supplier', { i: ['Requester'] }]);
  const ctl = steps(r).find(s => /sign-off/i.test(s.title));
  assert.deepEqual([ctl.ownerRole, ctl.raci], ['Controller', { a: 'Controller (Sam Wu)' }]);
  /* the R11 credit-limit fixture keeps its sign-off as Accountable too */
  const c = steps(I.parseSop(CREDIT)).find(s => /sign-off/i.test(s.title));
  assert.deepEqual(c.raci, { a: 'Controller (Sam Wu)' });
});

/* Visio as the BPM expert drew it: Start/End shapes named for events, connectors without a "Dynamic connector" master,
   a decision shape without a Decision master */
function vsdxR12() {
  const sh = (id, master, text, x, y) => `<Shape ID="${id}" Type="Shape"${master ? ` Master="${master}"` : ''}><Cell N="PinX" V="${x}"/><Cell N="PinY" V="${y}"/><Cell N="Width" V="1.5"/><Cell N="Height" V="0.75"/><Text>${text}</Text></Shape>`;
  const con = (id, master, text) => `<Shape ID="${id}" Type="Shape"${master ? ` Master="${master}"` : ''}><Cell N="BeginX" V="0"/><Cell N="EndX" V="1"/>${text ? `<Text>${text}</Text>` : ''}</Shape>`;
  const shapes = [
    sh(10, 2, 'Start', 2, 9), sh(11, 1, 'Receive application', 2, 8), sh(12, null, 'Eligible?', 2, 7),
    sh(13, 1, 'Enroll member', 2, 6), sh(14, 1, 'Send refusal letter', 4, 6), sh(15, 6, 'End', 2, 5),
    con(20, 7), con(21, null), con(22, 7, 'Yes'), con(23, null, 'No'), con(24, 7), con(25, null), con(26, null),
  ].join('');
  const c = (con, from, to) => `<Connect FromSheet="${con}" FromCell="BeginX" ToSheet="${from}"/><Connect FromSheet="${con}" FromCell="EndX" ToSheet="${to}"/>`;
  const connects = [c(20, 10, 11), c(21, 11, 12), c(22, 12, 13), c(23, 12, 14), c(24, 13, 15), c(25, 14, 15)].join('') + '<Connect FromSheet="26" FromCell="BeginX" ToSheet="14"/>';
  const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
  return zip({
    'visio/pages/pages.xml': `<?xml version="1.0"?><Pages xmlns="${NS}"><Page ID="0" NameU="Benefits enrollment"/></Pages>`,
    'visio/masters/masters.xml': `<?xml version="1.0"?><Masters xmlns="${NS}"><Master ID="1" NameU="Process"/><Master ID="2" NameU="Ellipse"/><Master ID="6" NameU="Circle"/><Master ID="7" NameU="Line-curve connector"/></Masters>`,
    'visio/pages/page1.xml': `<?xml version="1.0" encoding="utf-8"?><PageContents xmlns="${NS}"><Shapes>${shapes}</Shapes><Connects>${connects}</Connects></PageContents>`,
  }, true);
}
test('R12 Visio: Start/End are not steps, connectors listed once, a "?" shape is a choice', async () => {
  const v = await I.parseVsdx(vsdxR12());
  assert.deepEqual([v.steps, v.decisions, v.parallels], [3, 1, 0]);
  const x = I.parseXml(v.bpmn); const proc = I._all(x, 'process')[0]; const by = l => I._all(proc, l);
  assert.deepEqual(by('userTask').map(e => e.attrs.name).sort(), ['Enroll member', 'Receive application', 'Send refusal letter']);
  assert.equal(by('startEvent').length, 1);
  assert.equal(by('endEvent').length, 1);
  assert.deepEqual(by('exclusiveGateway').map(e => e.attrs.name), ['Eligible?']);
  assert.equal(by('parallelGateway').length, 0);
  assert.equal(by('sequenceFlow').length, 6);
  assert.deepEqual(by('sequenceFlow').filter(f => f.attrs.name).map(f => f.attrs.name).sort(), ['No', 'Yes']);
  /* the one loose connector is listed once */
  assert.deepEqual(v.dropped.map(d => [d.type, d.reason]), [['connector', 'not attached at both ends']]);
  fs.mkdirSync('/tmp/pmo-design', { recursive: true });
  fs.writeFileSync('/tmp/pmo-design/r12-eligibility.vsdx', vsdxR12());
});

/* ---------- R13 K2: the R12 reviewers' procedures (market-review/r12 karen.md, expert-bpm.md) ---------- */
/* Karen (R12): 9 lines, one of them unnumbered ("if spend over $25k Karen approves too" was a note on step 7); a compound
   line ("Vendor sends…; Treasury calls…" lost Treasury); "Check OFAC/sanctions list" became information */
const KAREN13 = `Vendor Setup
1. Buyer gets the vendor request from the requester.
2. Purchasing mgr sends the vendor our packet.
3. Vendor sends W-9; Treasury calls to verify bank letter.
4. Check OFAC/sanctions list.
5. Credit dept runs a D&B check on the vendor.
6. Operations confirms the ship-to address.
7. Purchasing mgr approves the vendor.
if spend over $25k Karen approves too
8. AP double-checks the bank letter and sets up the vendor master in the ERP.`;
/* BPM expert (R12): "Controller (Sam Wu)" and "Sam Wu signs off" are one actor; "signs off"/"approves" are A; consulted
   and informed phrases are C and I; requested limit, payment history and risk score are information; a Wait step */
const CREDIT13 = `Credit Limit Request
Trigger: A customer asks for a higher credit limit.
1. The Sales Rep submits the credit request with the requested limit in Salesforce.
2. The Credit Analyst reviews the customer's payment history and risk score.
3. The Credit Analyst writes a recommendation with input from the Sales Manager, and notifies the Account Manager.
4. If the requested limit is under $50k, approve it.
5. The Credit Manager approves or rejects the request.
6. Wait 1 business day for the customer to accept the new terms.
7. Limits above $250,000 also need sign-off from the Controller (Sam Wu).
8. AR updates the credit limit in NetSuite. Sam Wu signs off.
9. Sam Wu files the approval letter in SharePoint.`;

test('R13 #9 Karen: the unnumbered "if … approves too" line is a choice and an approval, and is counted', () => {
  const r = I.parseSop(KAREN13);
  assert.equal(r.lines.length, 9, 'all 9 lines are accounted for: ' + r.lines.map(l => l.text).join(' | '));
  assert.ok(everyLineKept(r));
  assert.equal(r.linesText, '9 lines → 10 steps, 1 choice');
  const d = tops(r).find(n => n.type === 'decision');
  assert.equal(d.title, 'Spend over $25k?');
  const ap = d.branches[0].nodes[0];
  assert.deepEqual([ap.title, ap.ownerRole, ap.approval], ['Also approve', 'Karen', true]);
  const seven = tops(r).find(n => n.title === 'Approve the vendor');
  assert.ok(!/karen|25k/i.test(seven.note || ''), 'never a note on step 7: ' + seven.note);
  /* it sits after step 7 and before step 8 */
  const t = tops(r); assert.equal(t[t.indexOf(seven) + 1], d);
  const ln = r.lines.find(l => /karen approves too/i.test(l.text));
  assert.deepEqual([ln.num, ln.as, ln.nodes[0]], [null, 'step', d.id]);
});

test('R13 #9 Karen: a compound line is split into owned steps; Treasury is kept', () => {
  const r = I.parseSop(KAREN13);
  const ln = r.lines.find(l => l.num === 3);
  assert.equal(ln.nodes.length, 2);
  const [a, b] = ln.nodes.map(id => walk(r.nodes).find(n => n.id === id));
  assert.deepEqual([a.title, a.ownerRole], ['Send W-9', 'Vendor']);
  assert.deepEqual([b.title, b.ownerRole], ['Call to verify bank letter', 'Treasury']);
  assert.deepEqual(b.touches, ['Treasury']);
  assert.ok(!a.touches.includes('Treasury'), 'the vendor\'s step does not carry Treasury');
  assert.ok(b.newData.some(x => x.name === 'Bank letter'));
  assert.ok(r.teams.includes('Treasury'));
  /* a sign-off after a semicolon is not a second step (it is the Accountable person) */
  const s = I.parseSop('1. Finance approves the contract; the Controller (Sam Wu) signs off.');
  assert.equal(steps(s).length, 1);
});

test('R13 #9 Karen: "Check OFAC/sanctions list" is a step, never information', () => {
  const r = I.parseSop(KAREN13);
  const c = steps(r).find(s => /ofac/i.test(s.title));
  assert.equal(c.title, 'Check OFAC/sanctions list');
  assert.ok(!r.newData.some(x => /^check\b/i.test(x.name)), 'no information named "Check…": ' + r.newData.map(x => x.name).join(', '));
  assert.ok(r.newData.some(x => x.name === 'OFAC/sanctions list'), r.newData.map(x => x.name).join(', '));
  /* as a second sentence on a line, or an unnumbered line between steps, it is a step too */
  const r2 = I.parseSop(`1. Compliance reviews the vendor file. Check OFAC/sanctions list.
2. AP sets up the vendor.`);
  assert.deepEqual(steps(r2).map(s => s.title), ['Review the vendor file', 'Check OFAC/sanctions list', 'Set up the vendor']);
  assert.equal(r2.linesText, '2 lines → 3 steps');
  const r3 = I.parseSop(`1. Compliance reviews the vendor file.
Screen the vendor against the sanctions list.
2. AP sets up the vendor.`);
  assert.deepEqual(steps(r3).map(s => s.title), ['Review the vendor file', 'Screen the vendor against the sanctions list', 'Set up the vendor']);
  assert.equal(r3.lines.length, 3);
  /* plain prose between steps is still a note */
  const r4 = I.parseSop(`1. Compliance reviews the vendor file.
This usually takes a day.
2. AP sets up the vendor.`);
  assert.equal(steps(r4).length, 2);
  assert.match(steps(r4)[0].note, /usually takes a day/);
});

test('R13 #9 data: requested limit, payment history and risk score are information', () => {
  const names = I.parseSop(CREDIT13).newData.map(x => x.name);
  for (const n of ['Requested limit', 'Payment history', 'Risk score']) assert.ok(names.some(x => x.toLowerCase().endsWith(n.toLowerCase())), n + ' in ' + names.join(', '));
  assert.ok(!names.some(x => /^limits?$/i.test(x)), 'never a bare "Limits"');
});

test('R13 #8 identity: "Controller (Sam Wu)" and "Sam Wu" are one actor; signs off / approves are A; C and I from phrases', () => {
  const r = I.parseSop(CREDIT13);
  const t = tops(r);
  const by = re => steps(r).find(s => re.test(s.title));
  /* line 9: Sam Wu's own step is the Controller's */
  const files = by(/^File the approval letter/);
  assert.deepEqual([files.ownerRole, files.note], ['Controller', 'Named in the procedure: Sam Wu']);
  /* line 8: "Sam Wu signs off" is the Controller (Sam Wu) */
  const upd = by(/^Update the credit limit/);
  assert.deepEqual(upd.raci, { a: 'Controller (Sam Wu)' });
  const ctl = by(/sign-off/i);
  assert.deepEqual([ctl.ownerRole, ctl.raci], ['Controller', { a: 'Controller (Sam Wu)' }]);
  /* one actor key for all three ways of writing it */
  const al = I.actorAliases(r.nodes);
  assert.equal(I.actorKey('Sam Wu', al), I.actorKey('Controller (Sam Wu)', al));
  assert.equal(I.actorKey('Controller', al), I.actorKey('Controller (Sam Wu)', al));
  assert.notEqual(I.actorKey('Credit Manager', al), I.actorKey('Controller', al));
  /* "approves" is Accountable for the approver */
  const apr = by(/^Approve or reject the request/);
  assert.deepEqual([apr.ownerRole, apr.raci], ['Credit Manager', { a: 'Credit Manager' }]);
  /* consulted and informed */
  const rec = by(/^Write a recommendation/);
  assert.deepEqual(rec.raci, { c: ['Sales Manager'], i: ['Account Manager'] });
  assert.equal(rec.title, 'Write a recommendation');
  /* a wait is a numbered step of its own kind (the matrix lists it) */
  assert.ok(t.some(n => n.type === 'wait'));
  assert.ok(I.raciRowsOf(r.nodes).some(n => n.type === 'wait'), 'the RACI rows include the Wait step');
  assert.equal(I.raciRowsOf(r.nodes).length, I.countNodes(r.nodes).steps + I.countNodes(r.nodes).waits);
});

/* Jordan (R12): a Visio file saved by Visio itself: a background page listed first, the real page in page2.xml found
   through pages.xml.rels, single-quoted attributes, "Role: task" shape text, Start/End shapes, and ZIP entries written
   with data descriptors. Failed from /import and the Processes button; the name came through blank. */
function zipDD(files) {
  const locals = [], central = []; let off = 0;
  Object.entries(files).forEach(([name, text]) => {
    const raw = Buffer.from(text, 'utf8'), data = zlib.deflateRawSync(raw), nm = Buffer.from(name, 'utf8'), crc = CRC(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(nm.length, 26);
    const dd = Buffer.alloc(16); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(data.length, 8); dd.writeUInt32LE(raw.length, 12);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, data, dd); central.push(ch, nm); off += 30 + nm.length + data.length + 16;
  });
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
function vsdxJordan() {
  const NS = 'http://schemas.microsoft.com/office/visio/2012/main', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const sh = (id, master, text, y) => `<Shape ID='${id}' Type='Shape' Master='${master}'><Cell N='PinX' V='4'/><Cell N='PinY' V='${y}'/><Cell N='Width' V='2'/><Cell N='Height' V='0.75'/><Text><cp IX='0'/>${text}</Text></Shape>`;
  const con = id => `<Shape ID='${id}' Type='Shape' Master='9'><Cell N='BeginX' V='0'/><Cell N='EndX' V='1'/></Shape>`;
  const shapes = [sh(1, 2, 'Start', 10), sh(2, 1, 'Member services rep: Log the life-event request', 9), sh(3, 1, 'Benefits Analyst: Check eligibility', 8),
    sh(4, 3, 'Eligible?', 7), sh(5, 1, 'Benefits Analyst: Update the election', 6), sh(6, 1, 'Member services rep: Ask for missing documents', 6), sh(7, 2, 'End', 5),
    con(20), con(21), con(22), con(23), con(24), con(25), con(26)].join('');
  const c = (con, from, to) => `<Connect FromSheet='${con}' FromCell='BeginX' FromPart='9' ToSheet='${from}' ToCell='PinX' ToPart='3'/><Connect FromSheet='${con}' FromCell='EndX' FromPart='12' ToSheet='${to}' ToCell='PinX' ToPart='3'/>`;
  const connects = [c(20, 1, 2), c(21, 2, 3), c(22, 3, 4), c(23, 4, 5), c(24, 4, 6), c(25, 5, 7), c(26, 6, 3)].join('');
  return zipDD({
    '[Content_Types].xml': `<?xml version='1.0' encoding='utf-8' standalone='yes'?><Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'/>`,
    'visio/document.xml': `<?xml version='1.0' encoding='utf-8' standalone='yes'?><VisioDocument xmlns='${NS}'/>`,
    'visio/masters/masters.xml': `<?xml version='1.0' encoding='utf-8' standalone='yes'?><Masters xmlns='${NS}' xmlns:r='${R}'><Master ID='1' NameU='Process' Name='Process'><Rel r:id='rId1'/></Master><Master ID='2' NameU='Start/End' Name='Start/End'><Rel r:id='rId2'/></Master><Master ID='3' NameU='Decision' Name='Decision'><Rel r:id='rId3'/></Master><Master ID='9' NameU='Dynamic connector' Name='Dynamic connector'><Rel r:id='rId4'/></Master></Masters>`,
    'visio/pages/pages.xml': `<?xml version='1.0' encoding='utf-8' standalone='yes'?><Pages xmlns='${NS}' xmlns:r='${R}' xml:space='preserve'><Page ID='4' NameU='Background-1' Name='Background-1' Background='1'><PageSheet LineStyle='0'><Cell N='PageWidth' V='8.5'/></PageSheet><Rel r:id='rId1'/></Page><Page ID='0' NameU='Benefits enrollment change' IsCustomNameU='1' Name='Benefits enrollment change' IsCustomName='1' BackPage='4'><PageSheet LineStyle='0'><Cell N='PageWidth' V='8.5'/></PageSheet><Rel r:id='rId2'/></Page></Pages>`,
    'visio/pages/_rels/pages.xml.rels': `<?xml version='1.0' encoding='utf-8' standalone='yes'?><Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='rId1' Type='http://schemas.microsoft.com/visio/2010/relationships/page' Target='page1.xml'/><Relationship Id='rId2' Type='http://schemas.microsoft.com/visio/2010/relationships/page' Target='page2.xml'/></Relationships>`,
    'visio/pages/page1.xml': `<?xml version='1.0' encoding='utf-8' standalone='yes'?><PageContents xmlns='${NS}' xml:space='preserve'><Shapes><Shape ID='1' Type='Shape' NameU='Title'><Text>Northwind Benefits</Text></Shape></Shapes></PageContents>`,
    'visio/pages/page2.xml': `<?xml version='1.0' encoding='utf-8' standalone='yes'?><PageContents xmlns='${NS}' xml:space='preserve'><Shapes>${shapes}</Shapes><Connects>${connects}</Connects></PageContents>`,
  });
}
test('R13 #14 Jordan\'s Visio: the real page (not the background), its name, "Role: task" owners, data-descriptor ZIP', async () => {
  const v = await I.parseVsdx(vsdxJordan());
  assert.equal(v.name, 'Benefits enrollment change');
  assert.deepEqual([v.steps, v.decisions], [4, 1]);
  const x = I.parseXml(v.bpmn); const proc = I._all(x, 'process')[0];
  assert.equal(proc.attrs.name, 'Benefits enrollment change');
  assert.deepEqual(I._all(proc, 'userTask').map(e => e.attrs.name).sort(), ['Ask for missing documents', 'Check eligibility', 'Log the life-event request', 'Update the election']);
  assert.deepEqual(I._all(proc, 'lane').map(e => e.attrs.name).sort(), ['Benefits Analyst', 'Member services rep']);
  assert.ok(!v.dropped.some(d => /Northwind Benefits/.test(d.name)), 'the background page is not read');
  fs.mkdirSync('/tmp/pmo-design', { recursive: true });
  fs.writeFileSync('/tmp/pmo-design/r13-jordan-benefits.vsdx', vsdxJordan());
});

test('the web copy is byte-identical', () => {
  const a = fs.readFileSync(path.join(__dirname, '../../api/shared/pmoflow-import.js'));
  const b = fs.readFileSync(path.join(__dirname, '../../web/public/concepts/pmoflow/app/import.js'));
  assert.ok(a.equals(b), 'run: cp api/shared/pmoflow-import.js web/public/concepts/pmoflow/app/import.js');
});

module.exports = { vsdxFixture };
