# Fastforward: flight simulator for PayPal subscriptions

Play months of renewals, failed payments, disputes and misbehaving webhooks against your app in seconds. Six
deterministic checks tell you whether you handle subscriptions safely; AI explains the failures and proposes
the fixes.

- **What Fastforward is:** a developer tool you run against your own Node app. It stands in for PayPal's sandbox,
  advances time, injects realistic payment failures and messy webhook deliveries, and reports what your app got wrong.
- **What it is not:** a billing engine, a database, or a hosted service. No accounts, no credentials stored.
- **The honest target:** single-developer to small-team SaaS ($39/mo or $299/yr, per seat). Not enterprise billing.
- **What works today:** the stand-in twin (subscriptions, disputes, webhooks, OpenAPI-verified), six deterministic
  checks, bad-weather webhook injection (duplicates, delay, reordering, forged signatures), an AI narrator (lock-file
  cached for zero cost on replay), a CLI, a web dashboard with an AG Grid delivery trace, and a stdio MCP server for
  Claude.
- **The known gap:** the comparison with PayPal's real sandbox covers the `APPROVAL_PENDING` path (7 of 7 endpoints
  match). Active subscriptions need a buyer approval in the sandbox, which requires a browser step we have not yet
  automated.
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
  (`@paypal/paypal-server-sdk`), and **Plain Fetch Shop** (`examples/plain-fetch-shop`), which uses Node's global `fetch`
  with no SDK. A small add-on (`fastforward-register`) redirects their sandbox calls to the twin and blocks any call to
  live PayPal before a socket opens.
- Webhooks are **signed and verified the way PayPal does it**: the twin signs events, serves the certificate and
  implements the verify-webhook-signature endpoint.
- Calls the twin does not implement can pass through to the **real PayPal sandbox** (sandbox host only).
- **Live fidelity check:** the same requests go to PayPal's real sandbox and to the twin, and we compare status,
  response shape and the official spec. The first run found 27 differences; after fixing them, 7 of 7 endpoints
  match. Evidence: `fidelity/latest.json`, shown in the dashboard as "Checked against the real PayPal sandbox".
  Re-run with `npm run fidelity` (needs your own sandbox keys in `.env`).

## Use it on your own app

Full guide, with the scenario reference, the six checks and troubleshooting: [docs/guide.md](docs/guide.md). Short version:

Start your app with the add-on, then run a scenario:

```
FASTFORWARD=1 node --import fastforward-register app.js
npx fastforward init
npx fastforward run fastforward.yaml
```

## Architecture

```
fastforward run
  ├── twin: stand-in PayPal (time travel, webhook signer, bad weather)
  ├── register: node --import add-on, redirects sandbox calls to twin
  ├── checks: 6 deterministic rules (signatures, dedupe, speed, state, disputes, safety)
  └── ai: customer personas and explanation generation (lock file cache)
```

No database exists or is planned. Scenarios, runs and reports are plain YAML and JSON.

## Documentation

- [User guide](docs/guide.md): five steps on your own app, scenario reference, six checks, troubleshooting.
- [Production plan](docs/production-plan.md): the post-hackathon roadmap and the shippable bar.
- [Handoff](docs/handoff.md): where everything is and how to run it.
