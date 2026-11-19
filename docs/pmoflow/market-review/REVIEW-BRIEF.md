SETUP (read carefully):
- The public product site is LIVE. Browse it with Playwright at https://www.necogoode.com/pmoflow/ . Its pages are pricing, security, demo, compare and the home page.
- For the app itself ("Try the live demo"), use a LOCAL copy of the exact deployed build:
  - Start it with `cd /home/claude/pmoflow-r13-review && nohup env PMOFLOW_STORAGE_FILE=/home/claude/.pmoflow-storage.conn node tests/pmoflow/devserver.js PORT > /tmp/devPORT.log 2>&1 &`.
  - Open it at http://localhost:PORT/concepts/pmoflow/ .
  - Treat it as if you had clicked "Try the live demo" on the live site.
  - Use ONE fixed `x-forwarded-for: 198.51.<n>.<m>` for the whole session. Each IP gets its own sandbox, so changing it loses your work.
  - Set `timezoneId: 'America/Chicago'`.
- Playwright: `NODE_PATH=$(npm root -g)`, then `require('playwright')`.
- Never print the .conn file. Finish with `fuser -k PORT/tcp`. Never use `pkill -f`.
- Do not read source code, tests or docs in either repo folder. You know only what you see.
- Do not submit the live demo-request form with fake data. You may fill it in to judge it, but don't press submit. You may submit the LOCAL copy's form at http://localhost:PORT/pmoflow/demo.html with company "Northwind Test".
- Save screenshots to /tmp/REV/ and look at them.

SCORECARD (required, put it first):
- Use EXACTLY these category IDs. For PMOFlow and each competitor you compare, give a Capability grade and an Ease grade (A–F, or N/O for not offered).
- Flag each category GAP, ONLY or PARITY.
- Mark the source of each competitor grade: (seen), (site) or (known).
- Categories:
  - C1 Process authoring
  - C2 As-is→to-be diff
  - C3 Data requirements
  - C4 Process→plan
  - C5 Scheduling/forecast
  - C6 Views
  - C7 Resource/capacity
  - C8 Status/AI summaries
  - C9 Portfolio/dashboards
  - C10 Cross-project impact
  - C11 Testing/UAT
  - C12 Approvals/gates
  - C13 Launch/rollout
  - C14 Time-boxed access
  - C15 Collaboration
  - C16 Financials
  - C17 Mobile
  - C18 Enterprise readiness
  - C19 Time to first value
  - C20 Trust/buying path
  - C21+ for any extra capability a competitor has that PMOFlow lacks
- Also list every number or label that disagrees between two screens, with repro steps. Write "none found" if you find none.

TAG EVERY FINDING (required): end each defect, disagreement and re-test line with exactly one tag:
- [own data]: you hit it with data YOU created in this session (your pasted procedure, your project, your upload, your edits).
- [sample data]: it only shows on the pre-loaded Northwind sample projects, people or history.
- [deliberate attack]: you had to bypass the normal screens on purpose (API calls, forged fields, scripted clicks on disabled controls).
The pilot-readiness verdict must rest on [own data] findings. Report [deliberate attack] findings separately under "Contract / security review".

ANSWER EXPLICITLY:
(a) Would you book a demo? Yes or no, and why.
(b) Would a demo progress to a contract or paid pilot? Give the deal size, pricing, blockers, and what would tip it.
(c) Your top 5 remaining changes, ranked.
Keep it under 1,100 words. Be honest; flattery ruins this exercise. Don't modify files.

SANDBOX TIP: the demo sandbox follows the browser's storage (localStorage + a cookie), not the IP. Create ONE Playwright browser context and reuse it for the whole session; if you need a fresh context, save and reload storageState (e.g. /tmp/REV/state.json). Creating many fresh contexts will hit the per-network burst limit (a real buyer opening the demo once would not).
