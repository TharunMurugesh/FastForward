STATUS: taken over 2026-10-19

> For the next Sara: you are the orchestrator (method in ~/.claude/CLAUDE.md). This is the **PayPal AI
> Hackathon** project, product **Fastforward** (working name). Read, in order: the two project memories
> (`project-paypal-time-machine`, `paypal-sandbox-disputes-gotchas`), `docs/hackathon-details.md` (the
> Official Rules digest), the spec and the plan below. Then this note is the current state.

# Handoff: 19 Oct 2026, afternoon (end of wave 2, wave 3 in flight)

## Deadline and dates
- **Submit by 12 Nov 2026 12:00 pm PST = 13 Nov 01:30 IST** (corrected from the rules; aim to submit during
  12 Nov IST). The demo must stay usable until judging ends on **15 Dec**.

## Decisions already made (do not reopen)
- Idea: Fastforward. Stack: TypeScript 7 strict ESM, Node 24, npm workspaces, Fastify, zod, Vitest 5,
  React + Vite.
- AI: `claude-opus-5-5` for all three jobs (effort: writer medium, customers low, narrator medium).
  Server-side refusal `fallbacks: 'default'` is ON (Vinay told 19 Oct). Vinay has $1,500 credits.
  He puts `ANTHROPIC_API_KEY` in `.env` himself (never paste it in chat).
- Hosting: **Railway** (`railway.json` in Task 17). Deploying needs his yes; tell him the cost first.
- Sponsor prize: **AG Grid** (Community, MIT only, never Enterprise). Bryntum dropped.
- PayPal visibility: a fidelity panel ("Checked against the real PayPal sandbox") in the dashboard, a live
  fidelity run in the video, and README/Devpost text spelling out each use of PayPal. Rules' stage one is
  pass/fail on "reasonably applies PayPal APIs".
- Prize rule: one grand prize or honourable mention, plus one sponsor prize. Aim: top 3 / Best Use of
  PayPal + AI / Best Demo Delivery, plus Best Use of AG Grid.

## Built earlier (detail; current state is in "State on main" below)
| Task | What | Notes |
|---|---|---|
| 0 | Redirect spike | `docs/spike-results.md`: SDK and fetch both redirectable |
| 1 | Scaffold + contracts | `packages/contracts` (Sara owns; workers ask for changes) |
| 2–4 | Twin server, virtual clock/scheduler, subscriptions engine + routes, `fidelity.ts`, PayPal OpenAPI specs | Retry rule verified from PayPal docs (5 days, twice per cycle); "suspend at once on reaching threshold" is inferred, marked unverified |
| 5 | Signed webhooks, verify endpoint, delivery with retries | `createSigner` is async (approved). Retry conflict: doubling from 1 min hits the 3-day window at 13 attempts, so `deliveryMaxAttempts` 25 never applies. Open fidelity question |
| 6 | `@fastforward/register` add-on | Blocks live PayPal before any socket opens; undici pinned 8.12.2 |
| 7 | Coffee Club demo app | Official SDK; re-fetches subscription status on every event (fixed); bugs: no-verify, no-dedupe, slow-ack, ignores-suspend, ignores-disputes, **trusts-event-order** |
| 8 | `@fastforward/ai` | Fake AiClient in all tests; only real model decisions are locked |
| — | Contract change 5c815df | Trace kinds `verify_call` and `cert_fetch`; VERIFIES_SIGNATURES judges from these |

Root `typecheck` is `tsc -b` (noEmit is refused with project references). Root `tsconfig.json` lists every
package; on merges keep all references and regenerate `package-lock.json` (take main's, then `npm install`).

## Workers
All wave workers are RELEASED (19 Oct ~15:45): Worker A `paypal-hackathon-fc` (PayPal 3), Worker B
`paypal-hackathon-fa` (PayPal 4), Worker C `paypal-hackathon-be` (PayPal 5). Branches merged; worktrees removed
once each confirmed a clean tree. Next jobs go to FRESH worker sessions with self-contained briefs (one worktree
each, per the method).

## State on main (19 Oct ~15:45): PHASES 1 AND 2 DONE
- 369 unit tests + 4 e2e pass (Sara ran both; e2e ~4.5 min, `npm run test:e2e`).
- Built: twin (subscriptions, disputes, signed webhooks, retries, weather, control API incl. /runs/current and
  /report), register add-on, Coffee Club (6 switchable bugs, official SDK, re-fetches status), AI package, checks
  (6), CLI (`fastforward run|new|twin`, report.json + self-contained report.html, dashboard link), dashboard
  (AG Grid Community: one row per notice, Report tab first, timeline, dispute chat, fidelity panel).
- **Live fidelity (Vinay said yes; reruns covered):** three runs against his sandbox: 27 → 4 → **0
  differences, 7 of 7 endpoints match** (status, shape, spec). `fidelity/latest.json` committed (e238caf).
  Pitch line: "we compared our simulator against PayPal's real sandbox, found 27 differences, fixed them all."
  Honest limit: the suite covers the APPROVAL_PENDING path (cancel → 404); approved/active subscriptions need a
  buyer approval in the sandbox and are not compared. Remaining guesses are in `packages/twin/src/fidelity.ts`,
  each marked verified/unverified. Each live run leaves 1 product + 1 plan + 1 pending subscription in his sandbox.
- `bad-month.yaml`: P75D, threshold 2; bugs=all (incl. slow-ack) → 5 checks fail; the demo set (no slow-ack) → **4 fail** (verified live 20 Oct); bugs=none → all 6 pass. A live run takes a few minutes, not 30 s.
- Demo bug set: no-verify,no-dedupe,ignores-suspend,ignores-disputes,trusts-event-order.
- Notes: every retry has its own transmission id; STATE_MATCHES orders notices by `status_update_time`.

## Update 20 Oct (Sara)
- Task 16 MCP merged (376 tests pass). Worker C's `docs/submission/{devpost,video-script}.md` merged and corrected (4 of 6, minutes).
- Price decided by Vinay: target $39 per developer per month, free for one developer; framed as a target, no revenue claimed.
- Discord question to PayPal CANCELLED by Vinay (will not reveal the idea). Do not raise it again.
- Worker B (`paypal-hackathon-be`, folder ../PayPal-Hackathon-host, branch ff/host) is on railway.json, start-hosted, `npm run demo`, README.
- Still open: manual MCP check with a real assistant (plan Task 16 step 4), Vinay's teach-back of docs/fastforward-explained.md.

## Next for Sara (Phase 3)
1. **Task 16 MCP server** (packages/mcp: ff_write_scenario, ff_run, ff_explain): fresh worker.
2. **Task 17**: `railway.json`, `scripts/start-hosted.mjs` (twin + Coffee Club + dashboard on $PORT, serving
   `/fidelity/latest.json`), root `npm run demo`, README (revenue-first pitch, 3-command quickstart, how PayPal is
   used, known limits from `webhooks/weather.ts`), `docs/submission/{devpost.md,video-script.md}`: fresh worker(s).
3. Optional polish: e2e speed (4.5 min), print check of report.html.
4. Outward steps, each needing Vinay's explicit yes: public GitHub repo + push, Railway deploy (tell him the
   cost; the demo must stay up until 15 Dec; set an Anthropic spend cap), Devpost submission.

## Vinay's open items
- **Discord question to PayPal** (outward, his to send; offer to draft): does a sandbox emulator built from
  PayPal's specs and checked against the real sandbox count as meaningful PayPal use?
- **Recruit 3–5 real PayPal developers** (other entrants) to try it by ~1 Nov (outward; draft for him).
- **Video**: he owns it from ~5 Nov; Sara co-writes the script.
- Final product name. Railway cost confirmation before deploy. Public GitHub repo + push (his yes).
- `docs/details.txt` (his raw paste) is untracked; everything in it is in `docs/hackathon-details.md`.

## Rules to repeat to every worker
No production writes; never call live PayPal or the real Anthropic API from tests; no push, deploy or
outside messages without Vinay; explicit `git add` paths only; no AI attribution lines anywhere; secrets only
in `.env`; workers never merge to main.
