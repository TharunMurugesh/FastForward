STATUS: taken over 2026-10-19

> For the next Sara: you are the orchestrator (method in ~/.claude/CLAUDE.md). This is the **PayPal AI
> Hackathon** project. Read the two project memories for this folder first:
> `project-paypal-time-machine` and `paypal-sandbox-disputes-gotchas`. Then read the spec and plan below.

# Handoff: PayPal AI Hackathon, 19 Oct 2026 (evening)

## Where things stand

- **Hackathon:** PayPal AI Hackathon on Devpost, solo. **Deadline 12 Nov 2026 12:00 pm PST = 13 Nov 01:30 IST (corrected 19 Oct from the Official Rules).**
- **Idea: Fastforward** (working name), a stand-in PayPal with a virtual clock, AI customers and
  bad-weather webhook delivery that finds billing bugs in a developer's app. Vinay said **GO** on 19 Oct
  after the money test (conditional go: sell it as revenue protection; LocalStack is the business model
  comparable; market size is the weak point).
- **Written and committed:**
  - Spec: `docs/superpowers/specs/2026-10-19-fastforward-design.md` (business model first, then design)
  - Plan: `docs/superpowers/plans/2026-10-19-fastforward.md` (Task 0 spike gate, Tasks 1–17, execution
    waves table with dates)
- **Built:** nothing yet. Local git repo created 19 Oct on `main`; no remote, nothing pushed.
- `.env` holds US sandbox keys (app `dispute-defender-us`); git-ignored.

## Next job

1. Vinay reviews the spec and plan. Wait for his yes (or changes) before anything else.
2. Then **Task 0, the redirect spike**: does PayPal's official SDK (which hard-codes its two base URLs)
   get redirected to our stand-in by a Node preload add-on? Its result decides the architecture. Report
   the result to Vinay before Task 1.
3. Then waves per the plan's table: at most three workers, Sara reviews and merges every diff.

## Vinay's open decisions

- Review and approve the spec and plan.
- Final product name ("Time Machine" is taken by Chargebee).
- Sponsor prize: Bryntum (recommended for fit, timeline is the hero view) or AG Studio (bigger purse).
- Releasing early to other hackathon entrants; creating the public GitHub repo and pushing; deploying
  to Render. All outward-facing: ask first.

## Rules to repeat to every worker

No production writes, no push/deploy/messages without Vinay, explicit `git add` paths only, no AI
attribution lines anywhere, secrets only in `.env`, never call live PayPal.
