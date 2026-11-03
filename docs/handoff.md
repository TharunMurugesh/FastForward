STATUS: waiting for the next Sara

# Handoff: 3 Nov 2026 (read this section first; it overrides older ones where they differ)

**Video made, needs Vinay's watch.** `C:\Users\vinay\Desktop\my discussions\test-clock-demo.mp4`, 2:31, in his
ElevenLabs voice (Turbo, his pick). Captions: `test-clock-demo.srt` beside it. Narration: `test-clock-narration.md`.
Recorded from the concept frame (`npm run demo`, then `npx vite concept --port 5180`) driving the recorded real run.
Scenes: hook, PayPal's own simulator note, Choose, real sandbox (5/5 signatures, Claude as Sam reactivates on real
PayPal), 75 simulated days, Result (3 of 6 fail, Claude's fix), Details + PayPal match 17/17, close card (repo, live
demo, `npm i fastforward-register`, MCP). Every number was checked on screen first.

**Update 3 Nov evening: v2 video replaces the first cut.** `my discussions	est-clock-v2.mp4` (2:12) with `test-clock-v2.srt` and `test-clock-v2-narration.md`. Voice C: ElevenLabs `eleven_v3`, stability 0.5, similarity 0.9 (his pick by ear). Follows the judge report: product on screen from 0:00 under a 3 s title, simulator page about 8 s, zooms on narrated cards, live bugs-on (3 of 6) then bugs-off (all 6) runs played on the laptop via `npm run demo` local mode, who-pays line, ends on the card. Real-sandbox part said as recorded; months said as played just now. Plain Fetch Shop scene not added. Scripts: `record2.js`, `voice2.js`, `scenes2.json` in the same scratchpad.

**For the next cut (Vinay, 3 Nov):** open with his own short intro, in his voice, e.g. "Hi, I'm Vinay" plus one line on who he is, before the hook. Keep the whole video under 3 minutes. v2 is going to judging now.

**Pitch evidence used:** five equal criteria (judges may score from video alone, maybe with AI analysis), stage one is
pass/fail on PayPal use, so real PayPal is shown in the first minute. Separate prizes for Best Use of PayPal + AI and
Best Demo Delivery. PayPal's last hackathon winner was an AI agent on PayPal APIs.

**Not in the video:** the "your own app in VS Code / Claude Code fixes it" scene from the old voice-over (needs his
screen); it is only on the close card. `docs/submission/voiceover.md` and `video-script.md` still describe the older
cut: update them to match `test-clock-narration.md`.

**Next, in order:** 1) Vinay watches and lists changes; the recorder and voice files are in this session's scratchpad
(`...\ad65acaef56bda0b\...\scratchpad`, `record.js`, `voice.js`, `scenes.json`); changing one line means regenerating
only that line. 2) Upload to YouTube (public), add the .srt as captions. 3) Bring `docs/submission/devpost.md` in line
with the video. 4) Submit by 13 Nov 01:30 IST.

**Keys:** his ElevenLabs key is in that scratchpad `.env`. Do not delete or blank any key without asking him (his rule).

**Product changes, 3 Nov (the product session; all committed, 47692b7..fc09092, not yet live until pushed):**
- Judge round 2 (35.5/50) answered outside the video. The judge's main objection: "you planted the bugs, so of
  course you found them".
- **Your own app:** on the Choose step (local mode only, `npm run demo`) you can point Test Clock at any app on this
  machine (webhook, subscribe and probe addresses; anything not on localhost is refused). Tested against Plain Fetch
  Shop with one bug: it caught "Paid twice" and said "found in your app". Inkwell no longer exists on this machine, so
  the video needs a new outside app for this moment: one forgotten line, fail, fix, pass.
- **Claude live:** a Live switch (only with `ANTHROPIC_API_KEY` in `.env`) lets Claude decide customers and write
  explanations during the run, about 8 s and a few cents. Recorded locks are never touched (runs use copies in
  `.fastforward/local/`).
- **Fresh ids per run** unless a scenario says `ids: repeat` (both bad-month scenarios do, so recordings match).
  Fixes false "paid twice" for apps that keep data between runs. The demo shop is also reset before each local run.
- **Watch:** one icon per event type, problems as coloured check tags, bigger and shorter text, the missing notice
  explains itself. **Concept:** neutral "Developer Dashboard" title, no PayPal product names or brand colours.
- **Text:** who pays line plus two sourced numbers (PayPal's 94.5% recurring success rate; Recurly's $129B
  estimate), answers to "why not unit tests" and "won't it drift", Node 24 and build time in the README.
- **The v2 video predates these.** It still shows the PayPal-style logo and no own-app or live-Claude scene. A v3
  should: restart `npm run demo`, show the own-app fail-fix-pass and one Live run, use a plain quote instead of the
  PayPal page screenshot, check the voice says "Claude" not "Cloud", and trim the black ending.
- **Still open:** GitHub About section (Vinay sets it on the website, or later via `gh` once logged in; the GitHub CLI
  is installed at `C:\Program Files\GitHub CLI\gh.exe` but its login failed once). `docs/testing-guide.md`,
  section 6 of `docs/how-it-works.md` and `voiceover.md` still describe older screens. npm packages are still 0.1.2.

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
- **Pitch:** "the test clock PayPal's sandbox is missing." **Changed 2 Nov: not a product any more.** Built as if PayPal commissioned it, to win a prize; PayPal decides any charging, so no prices anywhere. Never say PayPal paid for, owns or endorsed it. No
  story opening.
- **Exact clone of the PayPal developer dashboard for the video, with the logo.** Vinay's decision, risk accepted, do
  not re-argue. Conditions: video only, no public URL, no sign-in or payment screens, "Concept, not PayPal" always
  visible (use the purple sandbox strip). "Test Clock" sits under Testing Tools beside Webhook Simulator, and holds our
  whole app with every section. Decided 2 Nov: it goes in the public repo, in `concept/`, kept out of the Railway build. The public site uses the same Test Clock in a plain frame (`/?embed=1` is the frameless version the clone embeds). The old dashboard's screens are replaced by four steps: Choose, Watch, Result, Details.
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

**Vinay's open item:** approve Higgsfield credits for voice samples (not yet answered). This session is PayPal only: he
said not to raise BidReady.

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
   says who it is for and why it matters, with no prices and no claim that PayPal owns or endorsed it.
5. Good to have: try Fastforward on a real open-source Node shop with PayPal; 2 or 3 outside developers (not entrants;
   Vinay will not reveal the idea on Discord, do not raise Discord again) trying it for quotes.
6. Good to have: finish Vinay's teach-back. Stopped at: "why does Fastforward need the register add-on, and what would
   happen without it?" Next topics: how the twin jumps time, how the checks read the trace.

## Decisions waiting on Vinay
- None.

## Settled (do not reopen)
- No pricing: PayPal would decide. AI model `claude-opus-5-5`. AG Grid Community only (never Enterprise).
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
