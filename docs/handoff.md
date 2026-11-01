STATUS: waiting for the next Sara

> For the next Sara: you are lead engineer and orchestrator (method in ~/.claude/CLAUDE.md). Project: the
> **PayPal AI Hackathon**, product **Fastforward**. Read the project memories first (they load with MEMORY.md),
> then this note. It is the current state; git history has the detail. Older notes are in git
> (`git log -- docs/handoff.md`), do not dig through them unless something here is unclear.

# Handoff: 1 Nov 2026

## Read this first: what changed on 1 Nov
Vinay caught the biggest risk himself: Fastforward imitated PayPal instead of integrating it, and the brief says
"integrates the PayPal developer platform". **This section overrides the older parts of this note where they differ.**
Decisions and evidence are in the project memory `project-paypal-time-machine`.

**Decided:**
- **Real PayPal run:** real sandbox first, the twin only for the months the sandbox can't reach. Every step labelled
  Real PayPal or Simulated.
- **Pitch:** "the test clock PayPal's sandbox is missing." Teams still pay $39; PayPal adopting it is upside only. No
  story opening.
- **Exact clone of the PayPal developer dashboard for the video, with the logo.** Vinay's decision, risk accepted, do
  not re-argue. Conditions: video only, no public URL, no sign-in or payment screens, "Concept, not PayPal" always
  visible (use the purple sandbox strip). "Test Clock" sits under Testing Tools beside Webhook Simulator, and holds our
  whole app with every section. Whether this goes in the public repo is still open: the rules want all source there.
  Screenshots: `screenshots/` (excluded through `.git/info/exclude`; they show sandbox emails and partial client ids).
- **Video:** AI voice-over, generated first, then record the screen to it. Add a "today in PayPal versus with us"
  comparison on real pages. PayPal's simulator page says it itself: "you cannot verify, resend an event notification
  for, or show webhook details for simulator-generated events."
- **Commits:** short, human, one change, like `fix duplicate bid watches on vercel`.

**Built and live-tested (commits from 68eb941):** `fastforward real <scenario.yaml> --public-url <https://...>`, code in
`packages/twin/src/real/session.ts`. On the third live run all 5 notices reached Coffee Club, it answered 200, and real
PayPal said SUCCESS on every signature. The resend retry (404 once, cause unknown) passes unit tests but has not run
live yet. Delivery varies, so the video uses a recorded take.

**How to run it live.** Sara's shell may not open tunnels, so Vinay runs these in three PowerShell windows:
1. Coffee Club: `$env:FASTFORWARD="1"; $env:PORT="3000"; $env:PAYPAL_CLIENT_ID="x"; $env:PAYPAL_CLIENT_SECRET="x"` then
   `node --import fastforward-register examples/coffee-club/dist/server.js`
2. `cloudflared tunnel --url http://localhost:4011`, then wait about a minute.
3. `node packages/cli/dist/bin.js real examples/coffee-club/scenarios/bad-month.yaml --public-url https://NAME.trycloudflare.com`

**Next, in order:**
1. **Claude decides the real actions.** The steps are scripted now, and the pitch needs AI acting on real PayPal. Reuse
   `decideWithSource` from `@fastforward/ai`. Check the Devpost wording stays true until this ships.
2. **Show the real run in the report and dashboard** with Real PayPal and Simulated labels. Today it only prints and
   writes `real-report.json`. Include a recording for the hosted demo, which holds no keys.
3. **The clone**, under the conditions above.
4. **Rewrite the video script and Devpost text:** new pitch, PayPal proof moved up, 10 to 15 seconds for the AI
   customers, and replace "starting with other hackathon entrants" (Vinay won't reveal the idea to them). "Never
   touches real PayPal" becomes "never touches *live* PayPal".
5. **Vinay:** three real developers tried it by 7 Nov (`docs/outreach/linkedin.md`, table still empty). Short teach-back
   so the video and text are in his words. No live pitch in the rules, so the 20-question drill is dropped.
6. **Film by 8 Nov, submit by 11 Nov.**

**Vinay's open items:** approve Higgsfield credits for voice samples (not yet answered). BidReady: a TinyFish monitor may
still bill daily, and its no-login site can spend his credits (flagged, not yet answered).

**Hackathon rules he set from his BidReady retro** are in `~/.claude/CLAUDE.md`.

# Handoff: 27 Oct 2026

## Deadline
**Submit by 12 Nov 2026, 12:00 pm PST = 13 Nov 01:30 IST.** The live demo must stay up until judging ends on
**15 Dec**.

## What exists (all on `origin/main`, CI green)
- **Fastforward:** a simulator of PayPal Subscriptions and Disputes (the "twin") with a virtual clock, bad-weather
  webhooks, six checks, Claude-written customers and explanations, a CLI, an MCP server and a dashboard.
- **npm:** `fastforward-cli`, `fastforward-register`, `fastforward-mcp`, all **0.1.2** (verified on the registry).
  Publishing happens only in Vinay's own PowerShell (npm needs his security key).
- **Live demo:** https://fastforward-production.up.railway.app/ (Tharun's Railway, built from Tharun's fork; deploy =
  Vinay runs `git push tharun main`). It replays the recorded Claude run (no API key on Railway, ever), and the public
  site is read-only (non-GET on `/_ff` and `/demo` answers 405). On each start it plays bad-month once: **3 of 6 checks
  fail** (VERIFIES_SIGNATURES, FULFIL_ONCE, DISPUTE_ANSWERED). The built-in sample recording shows 4 of 6.
- **Real-sandbox comparison:** 17 of 17 steps match, 1 known, explained difference (`fidelity/latest.json`).
- **Tests:** 492 unit, 6 e2e. Run e2e from **PowerShell**: from Git Bash it fails with "Vitest failed to find the
  runner" before any test starts (a shell path problem, not the code).

## The dashboard (rebuilt 25 to 27 Oct, commits 9c440e3..48bf6df)
- **Left sidebar:** sections (Overview, Timeline, Deliveries, Disputes, PayPal match; the tab lives in the address,
  e.g. `#deliveries`), a run-status box (Simulated, run id, Finished/In progress/Sample, "Showing 25 Nov" while
  replaying), and the run's numbers. On screens under 900px it becomes a strip across the top.
- **Overview:** six check tiles; one card per failed check with a three-picture story, which webhook handler to look
  at, who it hit, a two-line fix preview, "How to fix" (drawer with the full fix, a "what a correct app does" strip and
  the findings) and "See the N notices" (filters Deliveries). The month's timeline sits underneath.
- **Timeline tab:** the time controls live here (date, slider, +1 day, +1 week, Run to end). A live run in progress
  moves the twin forward only; a **finished** run (the hosted demo always is) is replayed in the page with `cutAt`
  in `apps/web/src/useRun.ts`, the same logic the sample uses. Customer cards underneath.
- **Deliveries:** calm table (no red rows; one colour and icon per check). The side panel opens on the first problem
  notice and has Problems / Attempts / Payload tabs.
- **Disputes:** the conversation, the check's card, a "what a correct app does" strip and the full fix.
- **PayPal match:** says plainly it tests Fastforward against real PayPal, not the app (injected app bugs must not
  change its 17/17; Vinay asked about this).
- **Where things are:** each check's icon, colour, short name, story and remedy: `apps/web/src/checkLook.tsx`; card facts:
  `apps/web/src/problems.ts`; icons are **Lucide** (`lucide-react` pinned exactly at 1.55.0, ISC). Vinay's rules for the
  UI: proper icons only (no emoji, no hand-drawn shapes), pictures before text, no empty space, responsive at every
  width, and calm colours.
- **Checking the UI:** nothing in the repo does screenshots. Last session drove headless Edge over the DevTools
  protocol (`--remote-debugging-port`, `Emulation.setDeviceMetricsOverride`, `Page.captureScreenshot`) against
  `node scripts/start-hosted.mjs --run` with `PORT=8099`; rebuild the script in the new session's scratchpad if needed.
  Check widths 1600x850 (Vinay's screen), 1440, 1024, 820 and 390 (mobile), dark and light.

## Pending, in order
1. **Vinay: deploy and look.** `git push tharun main` if not done since 48bf6df, then open the live URL fresh (no old
   `?run=`: runs live in memory, so an old link ends after a restart; the banner then links to the current run).
2. **Sara: bring the docs up to date with the new dashboard** (checked 27 Oct which ones describe the old layout):
   - `docs/testing-guide.md` (Parts A to G, which Tharun follows): Report tab, side panel, Run to end at the top.
   - `docs/how-it-works.md` around lines 39 and 121: lists the Report / Event / Dispute tabs.
   - `docs/submission/video-script.md`: the on-screen directions (e.g. line 45, "the dashboard panel"; the sandbox
     comparison is now the PayPal match page). Walk every scene against the real dashboard.
   - `docs/submission/devpost.md` line 71: "one row per delivery attempt ... failing checks highlighted" (the table now
     shows one row per notice by default, with a colour and icon per check).
   `docs/guide.md` and the README do not describe the layout; the README has no screenshots. Keep the numbers:
   3 of 6 live, 17 of 17 steps.
3. **Vinay: film the video** from the updated script (Sara rehearses it with him), upload to YouTube.
4. **Vinay: put the one YouTube link in `docs/submission/devpost.md` and submit.** Before he submits, Sara checks the text
   leads with the money: who pays, $39 per developer per month (free for one developer, a target, not revenue
   claimed), why they would pay now. Lesson from Citizen's Voice (see ~/.claude/CLAUDE.md).
5. Good to have: try Fastforward on a real open-source Node shop with PayPal; 2 or 3 outside developers (not entrants;
   Vinay will not reveal the idea on Discord, do not raise Discord again) trying it for quotes.
6. Good to have: finish Vinay's teach-back. Stopped at: "why does Fastforward need the register add-on, and what would
   happen without it?" Next topics: how the twin jumps time, how the checks read the trace.

## Decisions waiting on Vinay
- None.

## Settled (do not reopen)
- Price $39 per developer per month, free for one. AI model `claude-opus-5-5`. AG Grid Community only (never Enterprise).
- The scenario has exactly one dispute on purpose (Maya healthy, Leo's card fails, Ana disputes). Vinay confirmed on
  27 Oct: no second dispute in bad-month.
- `docs/details.txt` is Vinay's raw paste of the rules, already digested into `docs/hackathon-details.md`. Leave it
  untracked; never stage it.

## How work flows
- Only Vinay and Sara write code (Tharun gets non-coding jobs such as following the testing guide).
- Come to Vinay only for major decisions: money, npm publish, deploys (pushing to Tharun's fork), legal or price,
  outward messages, deleting things on GitHub. Pushing tested work to `origin main` is pre-approved, **but Sara's shell
  cannot log in to GitHub** (no credentials in PowerShell or Git Bash here): commit, then ask Vinay to run
  `git push origin main` and `git push tharun main`.
- Explicit `git add` paths only (never `-A`); no Co-Authored-By or any AI attribution in commits, PRs or docs; secrets
  only in `.env`; never call live PayPal or the real Anthropic API from tests.
- Say "deployed, needs your test", never "fixed", until it is verified.
