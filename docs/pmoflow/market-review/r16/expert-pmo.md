# R16 re-review: Enterprise PMO director (port 8997)

He built his OWN pilot ("Contractor laptop provisioning": map, project, plan, baseline, hours, slip approval, hand-overs, cross-project dependency, holiday, report), then attacked the API separately.

## Verdict
- **Demo:** yes.
- **Paid pilot:** yes, $2,500.
- **Contract:** not yet. It would be $23,400/yr (30 editors). For comparison: Jira Premium about $7,056 or Planner Plan 3 about $10,800 at the same headcount.
- **Blockers:**
  - An owner can delete a task and its hours.
  - Anonymous and forged API writes.
  - An inconsistent cost forecast.
  - No SCIM, SOC 2 or ServiceNow.
- **What would tip it:** a hosted Entra tenant that refuses forged and anonymous calls; tasks with hours archive-only; one cost method; a pen-test letter.

## Scorecard (PMOFlow)
C1 B/A ONLY · C2 A/A · C3 A/B · C4 A/A · C5 B/A PARITY · C6 B/A · C7 C/B GAP · C8 B+/A · C9 B/A · C10 A-/A · C11 A/B · C12 B+/A · C13 A/A · C14 A/A · C15 C/B GAP · **C16 C-/B** GAP · C17 not tested · C18 D+/C GAP · C19 A/A · C20 B-/B GAP · C21 timesheets D/B (deliberate) · C22 integrations D+/B

## Re-tests
- FIXED:
  - rebaseline [own];
  - test counts [own];
  - PM self-approval [attack];
  - Home duplicates [sample];
  - since last report [own];
  - knock-on [own];
  - launch window [attack];
  - holiday start [own].
- PARTIAL:
  - unconfirmed Done [own];
  - scope cost: "+ Add work item" adds cost with no plan change [own];
  - past range concerns wording [sample];
  - added dependency moves the start but doesn't knock on its dependent [own];
  - deleting hours: editing is refused, but deleting the whole task erases them [own];
  - actor/step-up: stale stamps refused, forged actor accepted [attack].

## Defects (own data; the pilot verdict rests on these)
1. A non-PM owner can delete their task, hours included, from the normal screen. Spent went $500→$0; the confirm doesn't mention the hours.
2. The suggested plan was accepted at $15,750 against a $12,000 budget, with Dev at 20.6 days against 8 days of capacity, and no warning.
3. A slip in another project pushed his past its deadline, but only his PM approved, not his sponsor.
4. Adjust shows "Maya Chen" in the owner box of an unowned task; History says "for Maya Chen".
5. Import:
   - Step 4's "Help Desk" owner left blank.
   - "(Sam Keller)" kept in the title.
   - Sam mapped to IT, not Security.
   - "Asset tag" not picked up.
6. 14 hours on a Saturday is flagged only as backdated, not as a weekend or over a day.

## Disagreements
1. Expected cost: Settings "unknown" vs Portfolio $15,750; then $13,250 after logging hours (the formula switched); the effort guard quoted $15,750–16,750. [own]
2. "Will miss the deadline" next to "Expected Jan 4, 4 business days before the Jan 8 deadline". [own]
3. Portfolio "Behind at the end 0" vs the card's "3 tasks late or held up"; the "0 late · 2 blocking · 3 late or held up" wording. [own]
4. "SPENT $-500 this week": a correction dated in this period. [own]
5. History shows the UTC date. [own]
6. Launch needs two different approvers while only one department (one approver) is involved, with no guidance. [own]
7. Raw ids or fields in History: "after wi-mwn10t3ulgw1", "tobe forked none → true". [own]
8. Finish moved Dec 7→Dec 10 vs the forecast log's Dec 8. [sample]

## Contract / security review (deliberate attacks)
- The PM POSTed the sponsor's approval as Nina with a self-made step-up (method "none"); the deadline moved.
- A DELETE with no actor deleted sample task W8 (28 hours) and a risk ("anonymous").
- An owner added hours in someone else's name.
- A false `today` allowed future-dated hours.
- Done was backdated before the start.
- Another sandbox's state is readable with only its ID (different IP, no cookie).
- Held: time-entry edits, log fields, baselines, deadline/budget/PM, plan-change records, History writes. The chain stays intact and shows the anonymous delete.

## Top 5
1. Refuse anonymous and forged writes; the actor comes from the session; the server issues step-ups.
2. Tasks with hours can't be deleted, only cancelled; adding or removing work goes through Change the plan.
3. One expected-cost method; warn on plan or knock-on over budget or capacity.
4. The other project's sponsor approves when a knock-on pushes it past its deadline.
5. Disagreements 1–8 and the unowned-task owner box.
