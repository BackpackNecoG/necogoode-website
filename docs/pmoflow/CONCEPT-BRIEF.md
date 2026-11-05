# PMOFlow — Concept brief (the founder's intent)

## The problem
Business/process analysts and SMEs map processes: the steps, the data each step needs, who owns what. They then hand the result to a PMO, which re-plans it all as tasks in Kanban-style tools like Jira, Planner or Smartsheet. The handoff loses context. Data requirements and blockers get rediscovered late, so nobody can easily see what a change touches across operations. Learning both worlds is a burden.

## The idea
**The process map is the hero for both audiences.**
- **Create a workflow:** a header with name, description and assigned resources. A central vertical process map (Power Automate-style) is built from a kickoff step. Simple tagging records each step's data requirements: what exists as examples or live integrations, and who owns each element. The tags show what each step touches across operations.
- **The map drives the plan.** A project is the gap between the as-is process and the designed to-be process. Linked data requirements and blockers are clear on the map itself. A side panel shows what's due next, blockers and upcoming dates.
- **Two views of one model.** The process view is for designing. The project view links one or more processes and shows the steps required and what needs to be considered.
- **Drill-down:** click a step to see what it needs and what's pending, Power BI style.
- **Visual status:** done is clearly green, at-risk/late is yellow/red, and in-progress has its own hint.
- **Rollout:**
  - **A readiness gate.** Approvers, each business unit for its own section, see one clean risk view: everything validated, exceptions documented. The release can trigger CI/CD through a customer-owned pipeline; this showroom simulates it.
  - **Integration access is project-scoped and time-boxed.** It's opened for the project and closed at rollout.
- **Data-driven testing:** profile the real data (min/max, special characters, formats) to generate test cases automatically, capture dev/UAT results, and surface unknowns, instead of relying on a basic plan.
- **AI assists, grounded only in facts:** turning an SOP into steps, the diff into work, and a project into a status report.

## Business model and positioning
- **A hosted visual display layer** over the customer's own environment. Their data, plumbing and keys stay in their tenant. If they leave, they keep everything but lose the layer.
- **Must stand on its own** as a PMO surface, without requiring a Jira integration. It shouldn't try to out-Jira Jira on sprints or boards.
- **Goals:** low learning curve, excellent customer experience, minimal customer involvement.


## Rule #1 (founder, overrides everything): ease of use for non-technical people
- **Every capability is planned as "a non-technical user can easily achieve X".** Users are SMEs, managers and approvers of varying ages, tech comfort, reading levels and devices (including phones).
- **If the job gets done but the system is difficult or overly complex, the solution is not correct.**
- **Rapid market adoption** depends on someone being productive in minutes, with no training.
- **Implications:**
  - Simple by default; advanced power behind progressive disclosure ("More options").
  - Plain words (no jargon such as SIT, go/no-go, CPI, BPMN or regex unless asked for).
  - Guided next steps on every screen.
  - Few choices per screen, large targets, and readable on a phone.
  - Defaults that are right without configuration.

## The showroom
`/concepts/pmoflow/` is a no-login demo with fictional Northwind data. Each visitor gets a private sandbox. The "Viewing as" switcher stands in for real sign-in.
