/**
 * Document Insight — purposes + bundled sample documents.
 *
 * The dropdown is data-driven from PURPOSES so adding a purpose is adding an
 * entry here (+ a rubric in the api/goodestream-document function). Each purpose
 * ships a deliberately-flawed sample document so a visitor can try the engine
 * with zero upload.
 */

export type Purpose = {
  /** Sent to the backend; must match a rubric key in api/goodestream-document. */
  value: 'performance-feedback' | 'job-description';
  label: string;
  /** A sample document seeded with issues the rubric should catch. */
  sample: string;
  sampleName: string;
};

export const PURPOSES: Purpose[] = [
  {
    value: 'performance-feedback',
    label: 'Performance feedback review',
    sampleName: 'sample-performance-review.txt',
    sample: `Mid-Year Performance Review — Jordan A.

Jordan is a nice guy and generally a good attitude to have around the team. He's young and energetic, which is refreshing. Overall he did fine this period.

Communication: Jordan is sometimes too quiet in meetings. He should speak up more. Not a great culture fit with the louder folks on the team but he tries.

Delivery: He got most of his stuff done. There were a few things that were late but it's hard to say exactly what. He needs to be more proactive and take more ownership going forward.

Areas to improve: Be more of a leader. Show more passion. Be more strategic.

Overall: Meets expectations. Keep it up.`,
  },
  {
    value: 'job-description',
    label: 'Job description — bias & quality check',
    sampleName: 'sample-job-description.txt',
    sample: `Job Title: Rockstar Senior Software Engineer (Ninja)

About the role:
We're looking for a young, energetic coding ninja to join our fast-paced, work-hard-play-hard family. He will own our entire platform and crush ambitious deadlines.

Requirements:
- 10+ years of React experience (React is ~11 years old)
- Bachelor's degree in Computer Science required (Master's strongly preferred)
- Must be a digital native who lives and breathes code
- Available nights and weekends; we move fast and break things
- Native English speaker
- Able to lift 50 lbs and work in a high-energy office environment

Nice to have:
- A strong cultural fit with our bro-friendly team
- No major gaps in employment

We are an equal opportunity employer.`,
  },
];

export function getPurpose(value: string): Purpose | undefined {
  return PURPOSES.find((p) => p.value === value);
}
