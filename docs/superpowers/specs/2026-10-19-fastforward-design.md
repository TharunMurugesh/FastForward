# Fastforward: design spec

**Date:** 2026-10-19 · **Hackathon:** PayPal AI Hackathon (Devpost) · **Deadline:** 12 Nov 2026 PT (13 Nov 03:30 IST)
**Working name:** Fastforward (final name is Vinay's decision; "Time Machine" is taken by Chargebee).

One line: *A month of customers, renewals and disputes plays out against your app in 30 seconds, with AI acting as the customers, and you get a plain-language list of the bugs that would have cost you money.*

---

## 1. Business model (leads the pitch)

- **Who pays:** software teams that charge customers through PayPal's own APIs, subscriptions first; agencies that build PayPal integrations for clients.
- **Why they pay:** billing-handling bugs cost revenue. Vendors report failed payments drive 20–40% of subscription churn and ~9% of MRR (vendor data, treat as indicative). An app that mishandles "payment failed" either serves people who stopped paying or cuts off people who would have paid.
- **Price:** open-source core free. Team plan **$49 per developer per month**: hosted runs, AI customers, CI checks on every release. Comparables: LocalStack $39–89/dev/month (raised ~$25M), Postman $19–49/user/month, Hookdeck $39–499/month.
- **Why now:** AI assistants write payment code nobody fully reads; PayPal is pushing developers (this hackathon); PayPal has no way to move time in testing (Stripe has test clocks, Chargebee has a beta Time Machine for its own billing, Vercel's `emulate` covers 11 services but not PayPal).
- **First users:** the 1,175+ entrants of this hackathon, all building on PayPal (release to them is Vinay's decision).
- **Scale path:** PayPal → Braintree → other processors. End state: the flight simulator for any payment integration.
- **Weak point, stated openly:** no public count of teams that integrate PayPal APIs directly; market size is an assumption.

## 2. Problem

PayPal's sandbox runs in real time, cannot be scripted from the customer side, and delivers notices unreliably:

- No way to trigger a renewal or failed payment, or to move the clock (PayPal's own subscription testing guide). Shortest billing period: one day.
- Disputes cannot be opened from code without PayPal-granted permissions; the seller has 20 days to respond (both verified by hand on 3 Oct 2026).
- Real webhook delivery: duplicates, no ordering guarantee, late or missing events, bursts at renewal time (Hookdeck guide; PayPal Community reports of 12+ hour sandbox delays).

So the code that handles renewals, failures and disputes is first exercised with real money.

## 3. What it does

1. Developer describes a scenario (YAML, or plain English turned into YAML by AI).
2. Fastforward runs a stand-in PayPal (the **twin**) with a **virtual clock**. The developer's app runs normally, with a small add-on (**register**) that sends its PayPal calls to the twin.
3. AI-played customers subscribe, pay, let cards fail, cancel and dispute. Time jumps ahead; the twin sends PayPal-format, signed webhooks to the app, optionally in **bad weather** (duplicates, reordering, delays, forged events, bursts).
4. Deterministic **checks** compare what the app did with what was true. AI explains each failure in plain language with a suggested fix.
5. Results: terminal summary, `report.json`, self-contained `report.html`, a web dashboard with a timeline, and an MCP server so coding assistants can run scenarios themselves.

Scope for the hackathon: **subscriptions and disputes only**. JavaScript/TypeScript (Node 24) apps only.

## 4. Architecture

```
scenario.yaml ──► CLI / dashboard / MCP ──► twin (stand-in PayPal, virtual clock)
                                              │   ▲
                         signed webhooks ─────┘   │ redirected PayPal API calls
                                              ▼   │
                                   developer's app + register add-on
                                              │
                                   probe (test-only endpoint) ◄── checks read app state
```

| Unit | Responsibility |
|---|---|
| `packages/contracts` | Shared zod schemas and types: Scenario, WebhookEvent, TraceEntry, Report, CheckId |
| `packages/twin` | Fastify server: PayPal endpoints (subset), state per run, clock, scheduler, lifecycle rules, webhook dispatcher and signing, control API, passthrough to the real sandbox |
| `packages/register` | Node preload add-on that redirects sandbox hosts to the twin and blocks live PayPal |
| `packages/ai` | Claude calls: scenario writer, customer decisions, failure narration; offline fallback |
| `packages/cli` | `fastforward run`, `fastforward new`, `fastforward twin` |
| `packages/mcp` | MCP server exposing run/write/explain tools |
| `apps/web` | Dashboard: timeline, event inspector, customer chat, report |
| `examples/coffee-club` | Demo subscription app with switchable bugs, built with PayPal's official SDK |

Runs are held in memory and exported as JSON. No database.

## 5. Integration contract for the app under test

The app is started with `FASTFORWARD=1 node --import @fastforward/register app.js`. It exposes:

| Touchpoint | Required | Contract |
|---|---|---|
| Webhook URL | yes | Existing PayPal webhook handler. Test env sets `PAYPAL_WEBHOOK_ID=WH-FF-LOCAL`. |
| Subscribe endpoint | no | `POST {subscribeUrl}` body `{"name": string, "email": string}` → 2xx `{"subscription_id": "I-..."}`. The app creates the subscription with PayPal as in production. Without it, the twin creates subscriptions directly with `custom_id` = customer name. |
| Probe | no | `GET {probeUrl}?subscription_id=I-...` → `{"access": boolean, "fulfilments"?: number}`. Test-only. Checks that need it are reported `skipped` without it. |

## 6. Behaviour rules (twin)

Values marked **verified** were observed in the real sandbox on 3 Oct 2026. **Unverified** values live in one file, `packages/twin/src/fidelity.ts`, each with its source, and are confirmed or corrected during the build.

**Subscriptions**
- Statuses: `APPROVAL_PENDING`, `APPROVED`, `ACTIVE`, `SUSPENDED`, `CANCELLED`, `EXPIRED`.
- Create → `APPROVAL_PENDING` with an `approve` link; webhook `BILLING.SUBSCRIPTION.CREATED`. Customer approval → `ACTIVE`; `BILLING.SUBSCRIPTION.ACTIVATED`; first regular payment immediately unless a trial cycle exists.
- Each successful cycle payment: `PAYMENT.SALE.COMPLETED` (resource `billing_agreement_id` = subscription id), `billing_info.last_payment`, `next_billing_time` and `cycle_executions` updated.
- Failed payment: `BILLING.SUBSCRIPTION.PAYMENT.FAILED`, `failed_payments_count` +1, `outstanding_balance` += amount. Retries: **unverified**, default 2 retries 5 days apart. When `failed_payments_count` reaches `payment_failure_threshold` → `SUSPENDED` + `BILLING.SUBSCRIPTION.SUSPENDED`.
- Last cycle of a finite plan completes → `EXPIRED` + `BILLING.SUBSCRIPTION.EXPIRED`. Cancel → `CANCELLED` + `BILLING.SUBSCRIPTION.CANCELLED`.
- Month-end start dates clamp to the last day of shorter months (**unverified**): 31 Jan → 28 Feb → 31 Mar.

**Disputes**
- Opened by a scenario customer action. `seller_response_due_date` = create time + **20 days (verified)**. Stage `INQUIRY`, status `WAITING_FOR_SELLER_RESPONSE`, webhook `CUSTOMER.DISPUTE.CREATED`.
- Seller actions supported: `provide-evidence`, `accept-claim`, `send-message`, `make-offer`. Each emits `CUSTOMER.DISPUTE.UPDATED`.
- No seller action by the due date → resolved in buyer's favour (**unverified**), `CUSTOMER.DISPUTE.RESOLVED`.

**Webhooks**
- Body: `{id: "WH-…", event_version: "1.0", create_time, resource_type, event_type, summary, resource, links}`.
- Headers: `PAYPAL-AUTH-ALGO: SHA256withRSA`, `PAYPAL-CERT-URL`, `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-TRANSMISSION-TIME`, plus `X-Fastforward-Run: <runId>`.
- Signature: RSA-SHA256 over `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(body)}` (CRC32 as unsigned decimal), base64. Signed with a per-twin key; cert served at `https://api.sandbox.paypal.com/v1/notifications/certs/CERT-FF-<twinId>` (a PayPal host, so domain checks pass; register redirects the fetch to the twin).
- `POST /v1/notifications/verify-webhook-signature` on the twin returns `{"verification_status":"SUCCESS"|"FAILURE"}`.
- Delivery: 2xx within 10,000 ms counts as delivered. Otherwise retried with backoff starting at 1 minute, doubling, at most 25 attempts within 3 days (**unverified**, vendor source).

**Bad weather** (scenario `weather`, seeded so reruns are identical)
- `duplicates` (0–1): chance an event is delivered twice. `reorder` (0–1): chance an event swaps with the next. `delayMinutes` `[min,max]`. `forged` (count): events with an invalid signature that claim a cancellation or failure. `burst` (bool): all customers renew at the same instant.

## 7. Checks

All verdicts are deterministic functions of the run trace. AI only explains.

| Id | Passes when |
|---|---|
| `ACK_FAST` | Every delivery got 2xx within 10,000 ms |
| `VERIFIES_SIGNATURES` | For every delivered event, the app called the verify endpoint or fetched the cert within that delivery |
| `STATE_MATCHES` | At each checkpoint, probe `access` equals expected access (`expect.accessWhile`, default `["ACTIVE"]`) for the twin's true status |
| `FULFIL_ONCE` | Probe `fulfilments` equals completed payments for that subscription |
| `DISPUTE_ANSWERED` | Every dispute got a seller action before its due date |
| `NO_LIVE_CALLS` | No attempt to reach live PayPal during the run |

Checkpoints: after each virtual day in which at least one event was delivered, and at the end. Exit codes: 0 all pass or skipped, 1 any fail, 2 tool error.

## 8. AI

- `writeScenario`: plain English → Scenario (validated; one retry on invalid output).
- `decideCustomerAction`: at decision points (after a failed payment; when the seller messages in a dispute) a persona chooses `update_card | ignore | cancel | dispute | reply`. Decisions are saved to `<scenario>.lock.json` so reruns are identical; `--fresh` regenerates.
- `narrate`: failure + trace excerpt → `{explanation, fix}` in plain language.
- Model: `claude-opus-5-5` for writer, customer decisions and narrator, with effort `medium`, `low`, `medium` respectively (one model, one prompt cache, tuned per job). Key in `.env` as `ANTHROPIC_API_KEY`.
- `FF_AI=off` or no key: personas use scripted defaults, narration uses templates. Runs and tests never require a key.

## 9. Interfaces

- **CLI:** `fastforward run <scenario.yaml> [--report-dir dir] [--fresh]`, `fastforward new "<description>" [-o file]`, `fastforward twin [--port 4010]`.
- **Control API** (twin, prefix `/_ff`): `POST /_ff/runs`, `POST /_ff/runs/:id/advance` `{to|by}`, `GET /_ff/runs/:id`, `GET /_ff/runs/:id/trace`, `GET /_ff/runs/:id/report`, `GET /_ff/runs/:id/stream` (server-sent events).
- **Dashboard:** customers as rows, events along virtual time, a scrubber to advance, event inspector (payload, attempts, app responses), dispute chat, report.
- **MCP tools:** `ff_write_scenario {description}`, `ff_run {scenarioPath}`, `ff_explain {runId, checkId}`.

## 10. Real PayPal usage

- Twin request and response shapes validated against PayPal's official OpenAPI specs (`paypal/paypal-rest-api-specifications`, Apache-2.0).
- Fidelity suite (`npm run fidelity`): same requests to the real sandbox and the twin; response shapes compared. Skips without keys.
- Endpoints the twin does not implement are passed through to the real sandbox with the twin's own sandbox credentials.
- The demo app uses PayPal's official `@paypal/paypal-server-sdk`.

## 11. Safety

- Register is inactive unless `FASTFORWARD=1`. While active, any request to `api-m.paypal.com` or `api.paypal.com` throws `FastforwardLiveCallError`.
- Passthrough only ever targets `https://api-m.sandbox.paypal.com`.
- If the app makes no calls to the twin during the subscribe step, the run aborts: "your app isn't redirected — start it with `FASTFORWARD=1 node --import @fastforward/register`".
- Every simulated webhook carries `X-Fastforward-Run`; the UI and reports label all data as simulated.

## 12. Non-goals

Other PayPal products (orders checkout UI, payouts, invoicing), non-Node languages, browser-side PayPal buttons, live mode, multi-user accounts and billing for the Team plan.

## 13. Decisions that are Vinay's

1. Final product name.
2. Sponsor prize: **Bryntum** (timeline is the hero view; 3 × $1,000; meaningful use is natural) or **AG Studio** (larger purse; used for run-history dashboards). Max one sponsor prize. Recommendation: Bryntum for fit. Both are commercial licences; the hosted demo is the judges' primary path.
3. Releasing early to other entrants (outward-facing).
4. Creating the public GitHub repo and pushing; deploying to Railway (hosting choice made 19 Oct).

## 14. Risks

- **Redirect feasibility** (main risk): the official SDK hard-codes its base URLs. Phase 0 spike decides.
- Fidelity of unverified rules: kept in `fidelity.ts`, checked by the fidelity suite where the sandbox allows.
- Time: ~24 days solo, so the scope is held to subscriptions and disputes.
