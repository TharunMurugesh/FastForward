# Fastforward: production implementation plan

For whoever implements this (Vinay's friend, or any worker). Self-contained: you should not need to ask
anything to start. Written 21 Oct 2026 by Sara. The why behind each item is in `docs/production-plan.md`.

## 0. Read this first

**What Fastforward is.** A flight simulator for PayPal subscriptions. A stand-in PayPal (the "twin") plays months
of renewals, failed payments, disputes and misbehaving webhooks against a developer's app, six deterministic
checks judge the app, and a report says what it missed. Packages: `packages/{contracts,twin,register,ai,cli,mcp}`,
`apps/web` (dashboard), `examples/coffee-club` (demo app with 6 switchable bugs). Read, in order: `README.md`,
`docs/guide.md`, `docs/handoff.md`, `docs/production-plan.md`.

**Set up.** Node 24. `npm install && npm run build && npm test` must pass (382 unit tests). Slow suites run on
demand: `npm run test:e2e` (about 4.5 min), `npm run pack:check`, `npm run fidelity` (live PayPal sandbox, needs
the owner's keys; never run it unless Vinay says so).

**State on 21 Oct.** Phase 1 (safety, CI, container) and most of Phase 2 are done. Five commits exist only on
Vinay's machine until he pushes (`177bbf8`, `1635585`, `a07fefb`, `18facff`, `f6e51ca`). **Pull from him or wait
for his push before starting.**

## 1. Rules (non-negotiable, Vinay's)

- No live PayPal calls and no real Anthropic API calls from tests, scripts or runs. Tests use a fake `AiClient`.
- No `git push`, no deploy, no `npm publish`, no messages or posts to anyone: those are Vinay's, each needs his
  explicit yes. Prepare the change and the exact command; he runs it.
- Stage explicit paths only (never `git add -A`). Work on `main` or a short-lived branch he names.
- No `Co-Authored-By` trailer and no AI or tool attribution anywhere: commits, PRs, README, docs.
- Secrets only in `.env` (git-ignored). Never print or commit a key. Never put `ANTHROPIC_API_KEY` on Railway.
- No database exists; do not add one. No migrations.
- Do not refactor working, tested code just to look tidy. Every change must give a user something.
- Test first (red, then green). Say "done, needs review", not "fixed". Report what you verified and what you did not.

## 2. How the work is ordered

```
A  Repo hygiene (small, unblocks the rest)
B  Second example app (plain fetch)          <- biggest Phase 2 piece
C  Faster end-to-end test
D  Release prep (changelog, community files, README install lines)
E  Publish to npm                            <- VINAY ONLY
F  Honest coverage (Phase 3)
G  Business pages (Phase 4)                  <- only after real users
```
A, B and C are independent; run them in any order or in parallel (they touch different files). D needs B. E needs
D. F and G come after E.

## 3. Tasks

### A. Repo hygiene (about 1 hour)

**A1. Line endings.** Every commit prints "LF will be replaced by CRLF". Add `.gitattributes` with
`* text=auto eol=lf` and renormalise (`git add --renormalize .` is allowed here because it touches only tracked
files; inspect `git status` first). Done when: a fresh Windows checkout produces no such warnings and `npm test`
passes.

**A2. `pack-check` warning.** `scripts/pack-check.mjs` prints a Node deprecation warning on Windows (`shell: true`
with arguments). Run npm through `process.execPath` and `process.env.npm_execpath` when set, fall back to `npm`.
Done when: `npm run pack:check` prints no `DEP0190` line and still ends `pack-check: OK`.

**A3. CI runs the package check.** In `.github/workflows/ci.yml` add a step after `npm test`:
`npm run pack:check` (ports 3000 and 4010 are free on the runner). Done when: the workflow is green on GitHub
(Vinay pushes; check `https://api.github.com/repos/VinayG759/FastForward/actions/runs`).

### B. Second example app: plain `fetch` (about 1 day)

**Why.** Coffee Club uses PayPal's official SDK. A user whose app calls PayPal with plain `fetch` must also be
redirected. The Task 0 spike says both work; this makes it a tested fact and a second example for the docs.

**Files to create:** `examples/plain-fetch-shop/{package.json,tsconfig.json,src/server.ts,test/app.test.ts}`,
`examples/plain-fetch-shop/scenarios/bad-month.yaml`. Register the project in the root `tsconfig.json`
references (after `examples/coffee-club`). Copy conventions from `examples/coffee-club` (read `src/server.ts`,
`src/paypal.ts`, `src/bugs.ts`, `src/store.ts` first).

**Behaviour.** Same contract as Coffee Club (`POST /subscribe`, `POST /webhooks/paypal`,
`GET /__ff/probe?subscription_id=`), but PayPal is called only with global `fetch`:
`POST https://api-m.sandbox.paypal.com/v1/oauth2/token` (client credentials), then
`POST /v1/billing/subscriptions`, `GET /v1/billing/subscriptions/{id}`, and
`POST /v1/notifications/verify-webhook-signature`. No `@paypal/*` imports. Support a `SHOP_BUGS` env var with at
least `no-verify`, `no-dedupe`, `ignores-suspend`, `ignores-disputes` (reuse the names and semantics of
`examples/coffee-club/src/bugs.ts`; do not import from it, examples stay independent).

**Tests first.**
1. `examples/plain-fetch-shop/test/app.test.ts`: unit tests for each bug switch, in the style of
   `examples/coffee-club/test/app.test.ts`.
2. A new case in `test/e2e/`: start the app with `FASTFORWARD=1 node --import fastforward-register`, run
   `bad-month.yaml` with the real CLI runner and AI off, and assert the checks that must fail with all four bugs
   on, and that all pass with `SHOP_BUGS=none`. Model it on `test/e2e/coffee-club.e2e.test.ts`. Extend
   `test/e2e/global-setup.ts` to build the new example.

**Done when:** `npm test` and `npm run test:e2e` pass; with the four bugs on at least four checks fail, with none
all six pass; `docs/guide.md` gets a short "plain fetch example" pointer; the README names both examples.

**Watch out for.** The add-on pins `undici` 8.12.2; do not add a second HTTP library to the example. Never let the
example read real PayPal credentials: use placeholders (`ff`), the twin accepts any.

### C. Faster end-to-end test (about half a day)

**Why.** `npm run test:e2e` takes about 4.5 minutes, which is too slow to run before every merge.
**Do:** profile first (`vitest run --project=e2e --reporter=verbose`), report where the time goes, then fix the
biggest cause. Likely suspects: the slow-ack bug (`COFFEE_SLOW_MS`, retries over a long window; see
`FF_DELIVERY_TIMEOUT_MS` in `packages/twin/src/webhooks/dispatcher.ts`), builds in `global-setup.ts`, and
sequential cases that could share one process. Keep every assertion; only make the same checks run faster. Do not
reduce what the test proves.
**Done when:** the e2e suite takes under 90 seconds on a normal laptop with unchanged assertions (if it cannot,
say what the floor is and why), and `npm test` still passes.

### D. Release prep (about half a day, after B)

D1. `CHANGELOG.md` (Keep a Changelog format), first entry `0.1.0`.
D2. `SECURITY.md` (how to report a vulnerability privately; use Vinay's GitHub security advisories, not an email),
`CONTRIBUTING.md` (set up, the test commands from section 0, the rules from section 1), and issue and pull
request templates in `.github/`.
D3. Switch every user-facing install line from the clone form to the published form, **but only in a branch
Vinay merges after E**: `npx fastforward-cli init`, `npx fastforward-cli run fastforward.yaml`,
`claude mcp add fastforward -- npx -y fastforward-mcp`. Files: `README.md`, `docs/guide.md`,
`docs/submission/*.md`, `packages/cli/src/init.ts` (the printed next steps already use `fastforward-register`).
D4. Make `scripts/bundle.mjs` take the version from one place (a root `VERSION` file or the `FF_VERSION` env var,
already supported) and fail if the three manifests disagree.
**Done when:** `npm run pack:check` passes and nothing in the repo tells a stranger to run a command that does not
exist.

### E. Publish to npm (VINAY ONLY, after D)

Everything here is outward and irreversible (a published version number cannot be reused). Prepare, do not run.
1. Vinay owns the npm org `fastforward-mcp` and must have two-factor login on (npm settings, security).
2. `npm run build && npm run pack:check` must print `pack-check: OK`.
3. Vinay logs in: `npm login`. Then, for each of `publish/fastforward-register`, `publish/fastforward-cli`,
   `publish/fastforward-mcp` (register first, it is the smallest): `cd publish/<name> && npm publish --access public`.
   He enters the one-time code each time.
4. Verify as a stranger: in an empty folder `npx fastforward-cli init` and `npx fastforward-cli run fastforward.yaml`
   against Coffee Club started with `node --import fastforward-register`.
5. Then merge the install-line branch from D3. Tag `v0.1.0`.
If a package name is taken by then, stop and tell Vinay; do not improvise a name.

### F. Honest coverage (Phase 3, after E)

**F1. [DONE 23 Oct, see docs/approved-subscriptions-findings.md] Approved subscriptions in the real-sandbox comparison.** Today `fidelity/latest.json` covers the
`APPROVAL_PENDING` path. Investigate how far it can be automated (a buyer approval in the sandbox is a browser
step). Output: a written finding in `docs/` first, with options and cost; implement only the option Vinay picks.
Needs his sandbox keys; he runs the live suite.
**F2. Verify the inferred rule** (suspend at once when the failure threshold is reached) against PayPal's docs or
the sandbox. Update the rule and its marker in `packages/twin/src/fidelity.ts` and the "inferred" lines in
`README.md` and `docs/guide.md`. Never claim verified without a source or a sandbox observation.
**F3. [BUILT 23 Oct, only the real recording is left: `npm run record:ai -- --yes` with a key in `.env`] A recorded real AI run.** Run the bad month once with real Claude (Vinay supplies the key in `.env`, tells
you the budget first; expect a few dollars at most), save the decisions with the existing lock file mechanism
(`packages/ai/src/lock.ts`), and add a replay mode so the hosted demo can show real model decisions and
explanations with no key. Show it in the dashboard. Done when the demo page clearly marks which text was written
by the model.

### G. Business pages (Phase 4, only after real users exist)

G1. One static page (what it is, the $39 per developer per month target, the install command, a waitlist form).
G2. An opt-in usage log: which checks fail how often, no personal data, off by default. Write the privacy text
before the code. Both are Vinay's call on wording and where the waitlist data is stored.

## 4. What is deliberately not in scope

User accounts, team billing, a hosted multi-user service, other payment processors, more PayPal products, non-Node
apps, a database. Each would sit unused until the free tool has users. Do not start them.

## 5. Decisions that are only Vinay's

- Anything in section E, and any announcement or post.
- Who pays for hosting after 15 Dec and whether the demo stays up (it runs on Tharun's Railway; deploy is a push to
  Tharun's fork, see `docs/handoff.md`).
- The F3 spend, and anything that touches his sandbox account.
- Legal or compliance wording (privacy text, licence notices).

## 6. When you finish a task

Report: commit hash, files changed, tests run with their output, what you did not verify, and what Vinay must do.
Update the status line of the item in `docs/production-plan.md`.
