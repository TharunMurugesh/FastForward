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
| 6 | `fastforward-register` add-on | Blocks live PayPal before any socket opens; undici pinned 8.12.2 |
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
  UPDATE 23 Oct: the suite now has 17 steps and all match, including the ACTIVE path (card-funded subscriptions are
  ACTIVE with no buyer approval; see docs/approved-subscriptions-findings.md). Honest limit: wallet-approved
  subscriptions are not compared. Remaining guesses are in `packages/twin/src/fidelity.ts`,
  each marked verified/unverified. Each live run leaves 1 product + 1 plan + 1 pending subscription in his sandbox.
- `bad-month.yaml`: P75D, threshold 2; bugs=all (incl. slow-ack) → 5 checks fail; the demo set (no slow-ack) → **4 fail** (verified live 20 Oct); bugs=none → all 6 pass. A live run of the demo set takes about 3 s (measured 20 Oct); slow-ack makes it much slower.
- Demo bug set: no-verify,no-dedupe,ignores-suspend,ignores-disputes,trusts-event-order.
- Notes: every retry has its own transmission id; STATE_MATCHES orders notices by `status_update_time`.

## State on 23 Oct (Sara): READ THIS FIRST
Everything below the "Update 20 Oct" heading is older; this section is current.
- **Built and pushed (main, CI green):** twin, checks, CLI (`run`, `new`, `twin`, `init`), MCP server, dashboard, two example apps
  (Coffee Club, Plain Fetch Shop), hosted demo (Docker, read-only), three publishable packages (`npm run pack:check`),
  user guide, CHANGELOG, SECURITY, CONTRIBUTING, CI (build, unit, pack check, e2e in about 1 minute, version check).
- **Real-sandbox comparison: 17 of 17 steps match** (pending path and the active path via card-funded subscriptions;
  docs/approved-subscriptions-findings.md). Known honest limits: wallet-approved subscriptions not compared; one
  understood difference (transactions just after creation); one unverified timing (suspension on the first failed
  attempt of the final cycle vs after its retries).
- **AI recording and replay: built and tested with a fake model.** Decisions and explanations are saved next to the
  scenario and replayed with no key; reports label what is Claude's; `FF_AI_MAX_CALLS` caps spend; the twin now
  hands explanations to the dashboard's report (before, the live dashboard had none). The REAL recording is not done.
- **Vinay's items (nothing here is blocked on code):**
  1. Put `ANTHROPIC_API_KEY` in `.env` (there is none now), then `npm run build && npm run record:ai -- --yes`
     (capped at 60 calls, a few dollars at most), review the two new files in `examples/coffee-club/scenarios/`
     (`bad-month.lock.json`, `bad-month.narration.lock.json`) and commit them. Then push to Tharun's fork so the live demo
     replays Claude's run.
  2. DONE 23 Oct: main pushed to Tharun's fork; the live site is on the new build (17 steps, read-only, explanations shown).
  3. DONE 23 Oct: Private vulnerability reporting enabled (SECURITY.md points at it).
  4. npm: publish `fastforward-register`, `fastforward-cli`, `fastforward-mcp` (see production-implementation-plan.md
     section E), then switch the install lines (plan item D6). 2FA must be on. The org `fastforward-mcp` is reserved.
  5. Film the video from about 5 Nov (docs/submission/video-script.md; numbers there: 4 of 6 checks, 17 of 17 steps),
     fill the one YouTube link in devpost.md, submit by 12 Nov (13 Nov 01:30 IST).
  6. Recruit a few real PayPal developers to try it (message drafts available from Sara; no idea revealed to entrants).
- **Standing rules from Vinay (23 Oct):** only Vinay and Sara write code (Tharun does non-coding jobs); come to Vinay only
  for major decisions; pushing tested work to origin main is pre-approved; spending money, publishing, deploying and
  legal text are his.

## Update 20 Oct (Sara)
- Task 16 MCP merged (376 tests pass). Worker C's `docs/submission/{devpost,video-script}.md` merged and corrected (4 of 6, minutes).
- Price decided by Vinay: target $39 per developer per month, free for one developer; framed as a target, no revenue claimed.
- Discord question to PayPal CANCELLED by Vinay (will not reveal the idea). Do not raise it again.
- Worker B's session ended with partial work; Sara finished it: `railway.json`, `scripts/start-hosted.mjs`, `npm run demo`, `README.md` merged (59df8e8). Verified: fresh clone, no `.env`, `npm install` then `npm run demo` brings up twin, Coffee Club and dashboard on 8080; demo run = 4 of 6 failing, about 3 s.
- MCP verified over real stdio (tools list, ff_run 4 of 6, ff_explain, unknown run gives an error result). Not yet tried inside a real assistant.
- All workers released; worktrees removed. Phase 3 code is DONE. What is left is outward (Vinay's yes): public GitHub repo + push, Railway deploy (tell him the cost; stays up until 15 Dec; Anthropic spend cap), recruit 3-5 PayPal developers, film the video (from ~5 Nov), fill the 3 links in devpost.md, Devpost submission by 12 Nov. Optional: e2e speed, print check of report.html.
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
