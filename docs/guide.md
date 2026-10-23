# Fastforward guide

How to run Fastforward against your own PayPal Subscriptions app. For what it is and why, see the
[README](../README.md).

## What you need

- Node 24 or newer.
- A Node app that receives PayPal webhooks. Any framework works. It can use PayPal's SDK or plain `fetch`.
- Nothing from PayPal: no sandbox keys, no login. Fastforward never calls live PayPal.

Two example apps are included to borrow from:
- `examples/coffee-club`: uses PayPal's official Node SDK (`@paypal/paypal-server-sdk`).
- `examples/plain-fetch-shop`: uses plain global `fetch` with no SDK.

## Install

Fastforward is not on npm yet. Until it is, use a clone:

```
git clone https://github.com/VinayG759/FastForward.git
cd FastForward
npm install && npm run build
```

Once published, the three packages are `fastforward-cli` (the `fastforward` command), `fastforward-register`
(the add-on your app preloads) and `fastforward-mcp` (for coding assistants).

## Five steps on your own app

1. **Write a scenario.** `fastforward init` writes `fastforward.yaml`. Pass `--webhook-url` if your webhook is
   not at `http://127.0.0.1:3000/webhooks/paypal`.
2. **Start your app with the add-on**, so its PayPal calls go to the simulator:
   `FASTFORWARD=1 node --import fastforward-register your-app.js`
   The add-on does nothing unless `FASTFORWARD` is exactly `1`. While it is active, any call to live PayPal
   (`api-m.paypal.com`, `api.paypal.com`) is refused before a connection opens.
3. **Set your webhook id.** In the test environment use `PAYPAL_WEBHOOK_ID=WH-FF-LOCAL`, so your signature check
   uses the same id the simulator signs with.
4. **Run it:** `fastforward run fastforward.yaml`. The simulated months play in seconds.
5. **Read the report.** The command prints each check, and writes `report.html` (open it in a browser) and
   `report.json` into the report folder it names.

Unlock more checks by adding the two optional addresses (see "What your app can offer" below).

## What your app can offer

| Touchpoint | Needed? | What it is |
|---|---|---|
| Webhook URL (`app.webhookUrl`) | yes | Your existing PayPal webhook handler. |
| Subscribe endpoint (`app.subscribeUrl`) | no | `POST` with `{"name": string, "email": string}` returns 2xx `{"subscription_id": "I-..."}`. Your app creates the subscription with PayPal, as in production. Without it, the simulator creates subscriptions itself. |
| Probe (`app.probeUrl`) | no | `GET ?subscription_id=I-...` returns `{"access": boolean, "fulfilments": number}`. A test-only route. Without it, `STATE_MATCHES` and `FULFIL_ONCE` are reported as skipped, not passed. |

## Scenario reference

| Field | Meaning |
|---|---|
| `name` | A label for the run. |
| `seed` | Whole number. The same seed gives the same shape and timing of events. |
| `start` | When the simulated time begins, as an ISO date-time (`2026-11-01T00:00:00.000Z`). |
| `duration` | How long to play, as `P<n>D` (days), for example `P75D`. |
| `app.webhookUrl` | Required. Where webhooks are delivered. |
| `app.webhookId` | Defaults to `WH-FF-LOCAL`. |
| `plan` | `name`, `price` (a string like `"12.00"`), `currency` (3 letters), `interval` (`DAY`, `WEEK`, `MONTH`, `YEAR`), optional `trialDays`, `totalCycles` (0 means no end), `paymentFailureThreshold` (default 2: failed payments before suspension). |
| `customers[]` | `name`, optional `email`, `persona` (used by the AI), `card`, `actions`. |
| `customers[].card` | `ok`, or `fails_from:YYYY-MM-DD` (payments fail from that date). |
| `customers[].actions[]` | `{at, do: cancel}`, `{at, do: update_card}`, or `{at, do: dispute, reason, message?}`. `at` is a date or an ISO date-time. Dispute reasons are PayPal's own (for example `MERCHANDISE_OR_SERVICE_NOT_RECEIVED`). |
| `weather.duplicates` | 0 to 1: share of events delivered twice. |
| `weather.reorder` | 0 to 1: share of events delivered out of order. |
| `weather.delayMinutes` | `[min, max]`: random delivery delay. |
| `weather.forged` | Count of events with an invalid signature. Your app must reject them. |
| `weather.burst` | `true`: every customer renews at the same instant. |
| `expect.accessWhile` | Subscription statuses in which a customer should have access. Default `[ACTIVE]`. |

The scenario file is checked before anything runs, and every problem is listed with its field path.

## The six checks

Every verdict is a fixed rule applied to the recorded run. The AI explains failures but never decides one.

| Check | Passes when | If it fails |
|---|---|---|
| `ACK_FAST` | Every webhook got a 2xx answer within 10 seconds. | Answer first, work later: acknowledge at once and process in the background. PayPal retries slow webhooks. |
| `VERIFIES_SIGNATURES` | For every delivered event, your app verified the signature (called PayPal's verify endpoint or fetched the certificate). | Verify every notice before acting on it. Forged events in the scenario test this. |
| `STATE_MATCHES` | At each checkpoint, your app's idea of access matches the subscription's real status. Needs the probe. | Set access from the subscription status every time a notice arrives, and handle suspended, cancelled and expired as well as activated. |
| `FULFIL_ONCE` | Each completed payment was fulfilled exactly once. Needs the probe. | Remember the id of every notice you handled and ignore ids you have seen. PayPal may deliver a notice more than once, by design. |
| `DISPUTE_ANSWERED` | Every dispute got a seller response before its due date. | When a dispute-created notice arrives, send evidence through the disputes API, or alert a person. Silence means PayPal decides for the buyer. |
| `NO_LIVE_CALLS` | Nothing tried to reach live PayPal. | Start the app with the add-on. If this fails, a call went to the real PayPal host. |

Exit codes: `0` all checks passed or were skipped, `1` at least one check failed, `2` the tool could not run.

## What the simulator does, and what it does not

- **Verified against PayPal's real sandbox:** statuses, response shapes and the official OpenAPI specs for the
  subscription paths we compare (see `fidelity/latest.json`). Failed-payment retries (5 days, twice per cycle)
  follow PayPal's documentation.
- **One timing is a guess:** whether the failure that reaches the threshold suspends on its first attempt (what
  PayPal's worked example shows) or only after that cycle's retries (up to 10 days later). PayPal does not say and
  the sandbox cannot test it. The counting rule and the threshold itself are verified. Every guess is marked in
  `packages/twin/src/fidelity.ts`.
- **Not covered:** approved, active subscriptions in the real-sandbox comparison; other PayPal products; apps
  that are not Node.
- **Bad weather limits:** reordering and bursts happen among events at the same simulated instant, and events
  delayed past the end of the run are never delivered.

## Troubleshooting

| You see | Why and what to do |
|---|---|
| `can't reach your app at <url>` | Your app is not running, or not on that address. Start it first and check `app.webhookUrl`. |
| `your app isn't redirected` | The app did not call the simulator while subscribing. Start it with `FASTFORWARD=1 node --import fastforward-register your-app.js`. |
| `port 4010 is already in use` | A simulator is already running. Use `--twin-url` to share it, or `--twin-port` for another port. |
| `<file>: <path>: <message>` | The scenario has a mistake. Each problem is listed with its field path. |
| `<file> already exists` | `init` and `new` never overwrite. Pick another name with `-o`. |
| `STATE_MATCHES` and `FULFIL_ONCE` say skipped | Add `app.probeUrl` (see "What your app can offer"). |
| `new` says an Anthropic key is needed | `fastforward new` and AI-played customers need `ANTHROPIC_API_KEY`. Without it, customers follow scripted defaults and everything else still works. |

## From a coding assistant

`fastforward-mcp` is a stdio MCP server with `ff_write_scenario`, `ff_run` and `ff_explain`. In Claude Code:
`claude mcp add fastforward -- node packages/mcp/dist/server.js` (from a clone). The assistant writes a scenario,
runs it against your app, reads why a check failed, fixes your code and runs it again. Only `ff_write_scenario`
needs an Anthropic key. Reports are kept in `.fastforward/runs/` in the folder where the server started.
