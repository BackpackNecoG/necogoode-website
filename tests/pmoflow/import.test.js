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

test('the web copy is byte-identical', () => {
  const a = fs.readFileSync(path.join(__dirname, '../../api/shared/pmoflow-import.js'));
  const b = fs.readFileSync(path.join(__dirname, '../../web/public/concepts/pmoflow/app/import.js'));
  assert.ok(a.equals(b), 'run: cp api/shared/pmoflow-import.js web/public/concepts/pmoflow/app/import.js');
});

module.exports = { vsdxFixture };
