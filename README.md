# Fastforward

**The testing tool PayPal's sandbox is missing.** Test months of renewals, failed cards and disputes in seconds,
with AI customers, and find your billing bugs before real money does. Built as a proposal for a time-skipping test tool in PayPal's
developer dashboard. It is not a PayPal product, and PayPal has not reviewed or endorsed it.

**Live demo:** https://fastforward-production.up.railway.app/ (a recorded bad month, no login needed)

**Try it on your own app in 15 minutes:** [docs/quick-test.md](docs/quick-test.md)

## The problem, and who it is for

- **Who it is for:** a developer whose app takes recurring payments through PayPal Subscriptions.
- **The problem:** the code that handles a failed payment, a duplicate webhook, a suspended subscription or a dispute
  meets its first test with real money, because PayPal's sandbox has no clock and no misbehaving customers. Get one
  wrong and you keep serving people who stopped paying, or cut off people who would have paid.
- **Why it does not exist yet:** PayPal's sandbox has no way to skip time. Stripe can skip time, but only for Stripe billing, and has no AI
  customers. We found nothing that gives PayPal Subscriptions this.

- **Who pays:** PayPal, as a feature in its developer dashboard. PayPal earns a fee on every renewal that goes
  through, so every billing bug is a lost fee plus a support ticket. Developers can start today without waiting
  for PayPal: Fastforward ships on npm and as an MCP server for coding assistants.
- **Why it matters:** PayPal says merchants using it for recurring billing see an average payment success rate of
  94.5% ([PayPal](https://www.paypal.com/us/webapps/mpp/subscription-payments)), so about 1 renewal in 18 fails and
  that code runs all the time. Recurly estimates failed payments could cost subscription businesses more than
  $129 billion in 2025 ([Recurly](https://recurly.com/press/failed-payments-could-cost-subscription-companies-more-than-129-billion-in-2025-us)).
  Both are vendor figures. Most of those failures are declined cards, and Fastforward does not stop a card from
  declining. It tests the code that has to handle each decline (and each repeated, late or forged notice), because
  that code decides whether a lapsed subscriber keeps getting served or a paying one gets cut off.
- **A worked example (illustrative, using PayPal's own figure):** a shop with 1,000 monthly subscribers sees about
  56 renewals fail every month (1 in 18). Each one runs the failed-payment code: does the customer keep access,
  get a retry, get suspended? If that code is wrong, it is wrong 56 times a month, from the first month.

## How we found the idea

While testing an earlier idea on PayPal's sandbox on 3 Oct 2026, we tried to play out a dispute from start to
finish. Opening the dispute through PayPal's API was refused ("No permissions to set target_client_id"), so the buyer
had to file it by hand on the sandbox site. After we escalated it, the option to rule on it did not appear until
more than 20 minutes later (we found it within about 3 hours). Its status also changed on its own while we waited.
There was no way to skip ahead to see what happens next month. Every test meant waiting in real time, and that is the
gap Fastforward fills.

## Quickstart (three commands, no `.env`, no PayPal login)

**Needs Node 24 or newer** (`node --version`). The first `npm run demo` builds everything, which takes about 2 to 3
minutes; later starts take seconds.

```
git clone https://github.com/VinayG759/FastForward.git
cd FastForward
npm install
npm run demo
```

Then open <http://localhost:8080>. `npm run demo` builds the project, starts the stand-in PayPal (the twin),
the demo shop app (Coffee Club, with deliberate bugs) and the dashboard, plays a 75-day "bad month" once in a
few seconds, and opens the dashboard on the result: 3 of 6 checks fail, each with an explanation and a fix. Needs
Node 24 and no API key: the customers' decisions and the explanations replay a recorded run of Claude, and the report
labels them "Written by Claude". (With scripted customers a fourth check fails: the scripted customer lets his card keep
failing until he is suspended, while Claude's customer updated his card in time.)

Then see the checks go quiet: on the Choose step, switch **Planted bugs** to Off and press Start test. The page plays
the same month afresh on your machine, and all 6 checks pass. (The public demo only replays a finished run, so it has
no switch.)

To test **your own app** instead, start it with `FASTFORWARD=1 node --import fastforward-register your-server.js`, pick
"Your own app" on the Choose step and give its webhook, subscribe and probe addresses. With `ANTHROPIC_API_KEY` in
`.env`, the **Live** switch lets Claude decide the customers and write the explanations during the run (a few cents
per run); otherwise the recorded decisions replay.

**Reproduce the demo video's flower shop.** Bean & Bloom (`examples/bean-and-bloom`) is the outside app from the
video: one ordinary file with no bug switch, written with one check left out (repeated notices). Its
[README](examples/bean-and-bloom/README.md) walks through failing it, adding the fix and passing it, in about two
minutes.

## What it does

1. **A twin of PayPal Subscriptions plays the month** on a fast-forwarded clock.
2. **AI plays the customers** (one pays, one's card fails, one opens a dispute), when an Anthropic key is set. What
   Claude decided and wrote is saved, so a run with no key can replay the same words, and the report labels which
   words are Claude's and which are built-in text.
3. **The twin sends "bad weather":** webhooks arrive twice, late, out of order, or forged, signed like PayPal's.
4. **Six checks judge your app:** it verifies signatures, fulfils once per payment, answers fast, ends in the
   right subscription state, answers disputes in time, and never calls live PayPal.
5. **You get a report** (`report.html` and `report.json`), plus a dashboard with an AG Grid table of every
   delivery attempt.

Plain checks, not the AI, decide pass or fail, so the AI cannot talk a bug into passing.

## How PayPal is used

- The twin is built from PayPal's **official OpenAPI specifications** (Subscriptions, Disputes, webhooks) and
  its responses are validated against them.
- Three example apps are included: **Coffee Club** (`examples/coffee-club`), which uses PayPal's official Node SDK
  (`@paypal/paypal-server-sdk`), unmodified; **Plain Fetch Shop** (`examples/plain-fetch-shop`), which uses Node's
  global `fetch` with no SDK; and **Bean & Bloom** (`examples/bean-and-bloom`), the shop from the demo video, an
  ordinary file with one check left out. A small add-on (`fastforward-register`) redirects their sandbox calls to the
  twin and blocks any call to live PayPal before a socket opens.
- Webhooks are **signed and verified the way PayPal does it**: the twin signs events, serves the certificate and
  implements the verify-webhook-signature endpoint.
- Calls the twin does not implement can pass through to the **real PayPal sandbox** (sandbox host only).
- **Live fidelity check:** the same requests go to PayPal's real sandbox and to the twin, and we compare status,
  response shape and the official spec, in 17 steps: creating, reading, suspending, reactivating and cancelling a
  subscription (including one created with a card, which the sandbox activates at once, so no person has to approve
  it in a browser), listing transactions, and two refused actions. The first run on the pending path found 27
  differences and the first run on the active path found 22; after fixing them all 17 steps match, with one
  understood difference (see known limits). Evidence: `fidelity/latest.json`, shown in the dashboard as "Checked
  against the real PayPal sandbox". Re-run with `npm run fidelity` (needs your own sandbox keys in `.env`).

## Use it on your own app

Full guide, with the scenario reference, the six checks and troubleshooting: [docs/guide.md](docs/guide.md). Short version:

Fastforward is on npm (nothing to clone): `fastforward-cli` (the `fastforward` command), `fastforward-register` (the add-on
your app preloads) and `fastforward-mcp` (for coding assistants). Add the add-on to your app, start your app with it, then
write and run a scenario:

```
npm install --save-dev fastforward-register
FASTFORWARD=1 node --import fastforward-register app.js
npx fastforward-cli init
npx fastforward-cli run fastforward.yaml
```

Your app needs only a webhook handler. Two optional touchpoints unlock more checks:

| Touchpoint | Required | Contract |
|---|---|---|
| Webhook URL | yes | Your existing PayPal webhook handler. The test environment sets `PAYPAL_WEBHOOK_ID=WH-FF-LOCAL`. |
| Subscribe endpoint | no | `POST {subscribeUrl}` with `{"name": string, "email": string}` returns 2xx `{"subscription_id": "I-..."}`. Without it, the twin creates subscriptions directly. |
| Probe | no | `GET {probeUrl}?subscription_id=I-...` returns `{"access": boolean, "fulfilments"?: number}`. Test-only. Checks that need it are reported `skipped` without it. |

Other commands: `fastforward new "<description>"` writes a scenario from plain words (needs
`ANTHROPIC_API_KEY`), and `fastforward twin` starts the stand-in PayPal on its own (default port 4010).

## From a coding assistant (MCP)

`fastforward-mcp` is a stdio MCP server with three tools: `ff_write_scenario`, `ff_run` and `ff_explain`. Add it to
Claude Code with one line (nothing to install first):

```
claude mcp add fastforward -- npx -y fastforward-mcp
```

The assistant can then write a scenario, run it against your app, read why a check failed, fix the bug, and run
it again. `ff_write_scenario` needs an Anthropic key; the other two do not.

## Known limits

- **The real-sandbox comparison uses card-funded subscriptions** (a US merchant and a non-3DS test card), because
  that is the only way to reach an active subscription without a person approving it in a browser. A subscription
  approved with a PayPal wallet follows the same states but is not what we compared. One difference is understood
  and recorded: just after creation the sandbox lists no transactions yet, while the twin lists the payment at
  once. Remaining guesses are marked verified or unverified in `packages/twin/src/fidelity.ts`.
- **One timing is a guess.** From PayPal's documentation and API spec we verified: failed payments are retried
  every 5 days, twice per cycle; a failure counts once the second retry fails; and reaching the failure threshold
  suspends the subscription. PayPal does not say whether the final failure suspends on its first attempt or only
  after that cycle's retries. We follow PayPal's worked example (suspend on the first attempt), and the sandbox has
  no clock to test it.
- **Bad weather is limited.** Reordering and bursts happen only among events at the same virtual instant, and
  events delayed past the end of the run are never delivered. Ids follow the scenario seed, so a rerun has the same
  shape, timing and ids (run ids and signature transmission ids are still random).
- **Scope is narrow:** six checks, two example apps, Subscriptions and Disputes only.

## Contributing and security

To try the live demo and a local install step by step, see [docs/testing-guide.md](docs/testing-guide.md); to try Fastforward on your own app (new or already built), see [docs/try-it-on-your-app.md](docs/try-it-on-your-app.md). See [CONTRIBUTING.md](CONTRIBUTING.md) to set up and run the tests, and [SECURITY.md](SECURITY.md) to report a
vulnerability privately. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Licence

MIT. See [LICENSE](LICENSE). PayPal's OpenAPI specifications are Apache-2.0; see [NOTICE](NOTICE).
