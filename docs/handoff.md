STATUS: waiting for the next Sara

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

## Built and on `main` (all reviewed by Sara; see "In flight" for the latest count, `npm run typecheck` clean)
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

## Workers (real sessions Vinay opened; all run in "prompting" mode, so he clicks Allow)
| His window | Listed as | Model | Worktree / branch |
|---|---|---|---|
| PayPal 3 | `paypal-hackathon-fc` | Sonnet 5.5 | Worker A: `../PayPal-Hackathon-twin`, `ff/twin` |
| PayPal 4 | `paypal-hackathon-fa` | Opus 5.5 | Worker B: `../PayPal-Hackathon-register`, `ff/register` |
| PayPal 5 | `paypal-hackathon-be` | Sonnet 5.5 | Worker C: `../PayPal-Hackathon-coffee`, `ff/coffee` |

Branch names no longer match the work (each worker reuses its worktree); that is fine. Delete the worktrees
and branches once Phase 3 is merged. Workers report to the lead session by name; tell them the new lead's
listed name when you take over (send each a one-line message).

## In flight (19 Oct ~14:40) — PHASE 1 DONE
Main 5eaae53: 296 unit tests + 2 e2e pass (Sara ran both). Tasks 0–13 and 15 done except the full-bad-month e2e.
CLI: `fastforward run <scenario> [--keep-twin]` prints each bug with explanation and fix, plus a dashboard link.
`bad-month.yaml` is now **P75D, threshold 2** (Leo: fails 12-01, retries 12-06/12-11, suspended 2027-01-01).
Phase 1 live run shown to Vinay 19 Oct (scratchpad screenshots web-live-full.png, cli-final.log in worker C's
scratchpad). Worker B released (window PayPal 4 can be closed; worktree and branch deleted).
- DONE (main 929ad1d, 300 unit + 4 e2e pass, Sara ran both; e2e takes ~4.5 min): full bad-month e2e.
  bugs=all fails exactly 5 checks; bugs=none passes all six non-vacuously. ACK_FAST no longer counts a 4xx
  rejection of a FORGED notice. Real dashboard fixture (`npm run fixture -w @fastforward/web`), bundle trimmed.
  Worker A is STANDING BY.
- DONE (main 0bcfa15, 309 tests): dashboard design pass: one row per notice (+ "Show every attempt"), Report tab
  first with clickable per-check counts, plain-word finding chips, sample = real recording with bugs
  no-verify,no-dedupe,ignores-suspend,ignores-disputes,trusts-event-order. NOTE: every retry has its own
  transmission id; duplicate copies' retries interleave (rows.ts follows retry chains).
- DONE (main 0ae095f, 322 tests): Task 14 HTML report (self-contained report.html next to report.json).
  Worker C is STANDING BY (session long: give new jobs to fresh sessions).
- **Worker A**: Task 14 fidelity suite CODE ONLY (`npm run fidelity`, FF_FIDELITY=1 + sandbox keys, writes
  `fidelity/latest.json` in the dashboard's FidelityFile format, values stripped) + STATE_MATCHES findings carry
  event ids. Wording bug FIXED and verified on a real run (main 8a426c2 + re-recorded
  sample 025871f, 330 tests): STATE_MATCHES orders notices by `status_update_time`. **Running it against the real sandbox needs Vinay's yes**; Sara runs it, then commits latest.json.
- Remaining after that: Task 16 MCP (fresh worker session), Task 17 (railway.json, start-hosted, README,
  devpost.md, video script; root `npm run demo`), Vinay's outward items below.
- Dashboard: `npm run dev -w @fastforward/web` → http://localhost:5173; CLI run with `--keep-twin` to view live.

## Next for Sara
1. Review and merge each report (read the diff, check for attribution lines, `npm ci && npm test && npm run
   typecheck` on main yourself). Then reply with a review and the next job.
2. Phase 1 gate passed (live run shown). Collect Vinay's reactions as a user (Design score).
3. Then: restore full `bad-month.yaml` in the e2e (weather + dispute; buggy fails, fixed passes all);
   Task 14 HTML report + fidelity suite + `fidelity/latest.json` (Sara; the real-sandbox run needs .env keys,
   tell Vinay first); Task 16 MCP (fresh worker session); Task 17 hosting/README/submission.
4. When workers go idle with nothing left, tell Vinay which windows to close (shared allowance).

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
