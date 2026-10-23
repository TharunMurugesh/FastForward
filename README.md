# Fastforward

**A flight simulator for PayPal subscriptions.** Skip a month ahead, let AI customers misbehave, and find
your billing bugs before real money does.

**Live demo:** https://fastforward-production.up.railway.app/ (a recorded bad month, no login needed)

## Who pays, how much, why now

- **Customer:** a developer or small team whose app takes recurring payments through PayPal Subscriptions.
- **The pain, in money:** the code that handles a failed payment, a duplicate webhook, a suspended
  subscription or a dispute meets its first test with real money, because PayPal's sandbox has no clock and no
  misbehaving customers. Get one wrong and you keep serving people who stopped paying, or cut off people who
  would have paid.
- **Price (a target, not revenue):** free for one developer running it locally. Team plan target:
  **$39 per developer per month**, in line with similar tools (LocalStack $39 to $89, Hookdeck about $39).
  No one has paid yet, and Fastforward has no revenue today.
- **Why now:** PayPal has no test clock. Stripe's test clocks cover Stripe billing only and have no AI
  customers. We found nothing that gives PayPal Subscriptions this.
- **What we do not know:** the market size. Nobody publishes how many teams use PayPal Subscriptions directly.
  Path to scale: PayPal first, then other processors.

## Quickstart (three commands, no `.env`, no PayPal login)

```
git clone https://github.com/VinayG759/FastForward.git
cd FastForward
npm install
npm run demo
```

Then open <http://localhost:8080>. `npm run demo` builds the project, starts the stand-in PayPal (the twin),
the demo shop app (Coffee Club, with deliberate bugs) and the dashboard, plays a 75-day "bad month" once in a
few seconds, and opens the dashboard on the result: 4 of 6 checks fail, each with an explanation and a fix.
Needs Node 24. The AI is off in the demo; customers follow scripted defaults.

Change one thing to see the checks go quiet: `COFFEE_BUGS=none npm run demo` plays the same month with the
bugs off, and all 6 checks pass.

## What it does

1. **A twin of PayPal Subscriptions plays the month** on a fast-forwarded clock.
2. **AI plays the customers** (one pays, one's card fails, one opens a dispute), when an Anthropic key is set.
3. **The twin sends "bad weather":** webhooks arrive twice, late, out of order, or forged, signed like PayPal's.
4. **Six checks judge your app:** it verifies signatures, fulfils once per payment, answers fast, ends in the
   right subscription state, answers disputes in time, and never calls live PayPal.
5. **You get a report** (`report.html` and `report.json`), plus a dashboard with an AG Grid table of every
   delivery attempt.

Plain checks, not the AI, decide pass or fail, so the AI cannot talk a bug into passing.

## How PayPal is used

- The twin is built from PayPal's **official OpenAPI specifications** (Subscriptions, Disputes, webhooks) and
  its responses are validated against them.
- Two example apps are included: **Coffee Club** (`examples/coffee-club`), which uses PayPal's official Node SDK
  (`@paypal/paypal-server-sdk`), unmodified, and **Plain Fetch Shop** (`examples/plain-fetch-shop`), which uses Node's
  global `fetch` with no SDK. A small add-on (`fastforward-register`) redirects their sandbox calls to the twin and
  blocks any call to live PayPal before a socket opens.
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

Start your app with the add-on, then run a scenario:

```
FASTFORWARD=1 node --import fastforward-register app.js
npx fastforward init
npx fastforward run fastforward.yaml
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

`packages/mcp` is a stdio MCP server with three tools: `ff_write_scenario`, `ff_run` and `ff_explain`. Add it to
Claude Code with:

```
claude mcp add fastforward -- node packages/mcp/dist/server.js
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
  events delayed past the end of the run are never delivered. Event ids are random, so a rerun has the same
  shape and timing but not the same ids.
- **Scope is narrow:** six checks, two example apps, Subscriptions and Disputes only.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) to set up and run the tests, and [SECURITY.md](SECURITY.md) to report a
vulnerability privately. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Licence

MIT. See [LICENSE](LICENSE). PayPal's OpenAPI specifications are Apache-2.0; see [NOTICE](NOTICE).
