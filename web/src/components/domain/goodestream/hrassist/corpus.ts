/**
 * HR Assist — corpus + client-side retrieval.
 *
 * Ships a SAMPLE California HR/employment knowledge base as the default corpus
 * so the demo works out of the box. The visitor can also paste their own policy
 * text to re-ground it. Retrieval runs entirely in the browser (lightweight
 * term-overlap scoring); only the top passages + the question are sent to the
 * backend, which answers strictly from them.
 *
 * NOTE: This sample content is illustrative and simplified for a demo. It is
 * not legal advice and not a substitute for current statutes or counsel.
 */

export type Passage = { id: string; title: string; text: string };

export const SAMPLE_CORPUS_NAME = 'California HR Knowledge Base (sample)';

export const SAMPLE_CORPUS: Passage[] = [
  {
    id: 'meal-breaks',
    title: 'Meal periods',
    text: 'Non-exempt employees who work more than 5 hours in a day are entitled to an unpaid, off-duty 30-minute meal period, which must begin before the end of the fifth hour of work. A second 30-minute meal period is provided when a shift exceeds 10 hours. If a meal period is missed, interrupted, or late, the employee is owed one additional hour of pay at their regular rate as a meal-period premium.',
  },
  {
    id: 'rest-breaks',
    title: 'Rest breaks',
    text: 'Non-exempt employees are authorized a paid 10-minute rest break for every 4 hours worked, or major fraction thereof. Rest breaks should be taken near the middle of each work period where practicable. A missed rest break entitles the employee to one additional hour of pay at the regular rate.',
  },
  {
    id: 'overtime',
    title: 'Overtime pay',
    text: 'Non-exempt employees earn overtime at 1.5x their regular rate for hours worked over 8 in a workday and over 40 in a workweek, and for the first 8 hours on the seventh consecutive workday. Double time (2x) applies to hours over 12 in a workday and over 8 on the seventh consecutive workday. Overtime is based on hours actually worked; paid leave does not count toward overtime thresholds.',
  },
  {
    id: 'paid-sick-leave',
    title: 'Paid sick leave',
    text: 'Employees accrue paid sick leave at no less than 1 hour for every 30 hours worked, beginning on the first day of employment, and may begin using it on the 90th day. The company provides a minimum of 40 hours (5 days) of paid sick leave per year. Unused sick leave carries over, though usage may be capped at 40 hours per year. Sick leave may be used for the employee or a family member.',
  },
  {
    id: 'vacation-pto',
    title: 'Vacation / PTO',
    text: 'Vacation accrues per pay period based on tenure. Because earned vacation is treated as wages in California, it does not expire and any accrued, unused vacation is paid out on separation. A reasonable accrual cap may apply: once an employee reaches the cap, further accrual pauses until vacation is used. There is no "use it or lose it" forfeiture.',
  },
  {
    id: 'final-paycheck',
    title: 'Final paycheck',
    text: 'An employee who is terminated must be paid all final wages, including accrued unused vacation, immediately at the time of termination. An employee who resigns with at least 72 hours notice is paid on their last day; an employee who resigns without notice must be paid within 72 hours. Late final wages can trigger waiting-time penalties of up to 30 days of pay.',
  },
  {
    id: 'cfra-leave',
    title: 'Family and medical leave (CFRA)',
    text: 'Eligible employees (those employed for at least 12 months and who worked at least 1,250 hours in the prior 12 months, at a covered employer) may take up to 12 weeks of job-protected leave in a 12-month period for the birth or placement of a child, to bond with a new child, or for the serious health condition of the employee or a family member. Group health coverage continues during leave on the same terms.',
  },
  {
    id: 'pregnancy-leave',
    title: 'Pregnancy disability leave',
    text: 'An employee disabled by pregnancy, childbirth, or a related condition may take up to 4 months (per pregnancy) of job-protected pregnancy disability leave. This is separate from and in addition to bonding leave under CFRA. Reasonable accommodations and transfers are available where supported by the employee’s health care provider.',
  },
  {
    id: 'expense-reimbursement',
    title: 'Business expense reimbursement',
    text: 'Employees are reimbursed for all necessary expenditures incurred in direct consequence of performing their job, including reasonable home-internet and cell-phone costs for remote work, mileage at the standard rate, and required tools or supplies. Submit expenses with receipts within 30 days; reimbursement is issued in the next regular pay cycle.',
  },
  {
    id: 'remote-work',
    title: 'Remote and hybrid work',
    text: 'Remote and hybrid arrangements are available for eligible roles with manager approval. Remote employees must maintain a safe workspace, remain reachable during core hours (10am–3pm local), and follow the same security and data-handling policies as on-site staff. The company reimburses necessary remote-work expenses (see business expense reimbursement).',
  },
  {
    id: 'harassment-policy',
    title: 'Anti-harassment and reporting',
    text: 'The company prohibits harassment, discrimination, and retaliation based on any protected characteristic. Concerns can be reported to a manager, to HR, or through the anonymous ethics line. All reports are investigated promptly and confidentially to the extent possible. Retaliation against anyone who reports in good faith or participates in an investigation is strictly prohibited.',
  },
  {
    id: 'bereavement-leave',
    title: 'Bereavement leave',
    text: 'Employees may take up to 5 days of bereavement leave following the death of a family member (spouse, domestic partner, child, parent, sibling, grandparent, grandchild, or parent-in-law). Leave should be completed within 3 months of the date of death. The company provides this leave as paid for the first 3 days; remaining days may use available PTO.',
  },
];

const STOPWORDS = new Set(
  'a an and are as at be by can do does for from has have how i if in is it me my of on or our that the their they to was we what when where which who why will with you your do how much many long'.split(
    ' ',
  ),
);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export type ScoredPassage = Passage & { score: number };

/**
 * Lightweight term-overlap retrieval: score each passage by how many distinct
 * query terms it contains (title matches weighted higher), return the top K
 * passages with a non-zero score. Deliberately simple and transparent — the
 * point of the demo is grounding, and this keeps retrieval explainable.
 */
export function retrieve(query: string, corpus: Passage[], k = 3): ScoredPassage[] {
  const terms = Array.from(new Set(tokenize(query)));
  if (terms.length === 0) return [];
  const scored = corpus.map((p) => {
    const hay = tokenize(p.text);
    const haySet = new Set(hay);
    const titleSet = new Set(tokenize(p.title));
    let score = 0;
    for (const t of terms) {
      if (titleSet.has(t)) score += 3;
      if (haySet.has(t)) score += 1;
    }
    return { ...p, score };
  });
  return scored
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Parse pasted free text into passages by blank-line / heading separation. */
export function corpusFromText(raw: string, k = 24): Passage[] {
  const blocks = raw
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 20);
  return blocks.slice(0, k).map((text, i) => {
    const firstLine = text.split('\n')[0].trim();
    const title = firstLine.length <= 80 ? firstLine : `Section ${i + 1}`;
    return { id: `upload-${i + 1}`, title, text };
  });
}
