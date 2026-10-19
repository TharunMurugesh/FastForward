# Fastforward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **This project runs on Vinay's "Sara, the orchestrator" method** (`~/.claude/CLAUDE.md`): Sara assigns tasks to real sessions he opens, one git worktree per worker, Sara reviews and merges. See "Execution waves" at the end.

**Goal:** Build Fastforward, a stand-in PayPal with a virtual clock, AI customers and bad-weather webhook delivery, which runs a scenario against a developer's app and reports billing bugs in plain language.

**Architecture:** A Fastify "twin" implements the PayPal subscription, dispute and webhook endpoints the scenario needs, with state per run and a virtual clock. A Node preload add-on redirects the app's sandbox calls to the twin. Deterministic checks read the run trace; Claude writes scenarios, plays customers and explains failures. CLI, web dashboard and MCP server are thin layers over the twin's control API.

**Tech Stack:** Node 24, TypeScript (strict, ESM), npm workspaces, Fastify, zod, yaml, ajv, selfsigned, undici, Vitest, React + Vite, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `@paypal/paypal-server-sdk` (demo app), Express (demo app).

**Spec:** `docs/superpowers/specs/2026-10-19-fastforward-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- Node 24, TypeScript `strict: true`, ESM only, npm workspaces. Tests: Vitest. `npm test` at the root runs every workspace.
- Secrets only in `.env` (git-ignored): `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANTHROPIC_API_KEY`. Never print them.
- Never call live PayPal (`api-m.paypal.com`, `api.paypal.com`). Passthrough base is exactly `https://api-m.sandbox.paypal.com`.
- Defaults: twin port `4010`, demo app port `3000`, webhook id `WH-FF-LOCAL`, delivery timeout `10000` ms (override `FF_DELIVERY_TIMEOUT_MS`), report dir `.fastforward/runs/<runId>/`.
- All timestamps in contracts are ISO-8601 UTC strings (`2026-11-01T00:00:00.000Z`).
- One active run per twin; a second `POST /_ff/runs` returns 409.
- AI model: `claude-opus-5-5` for all three jobs, tuned by effort: writer `medium`, customer decisions `low`, narrator `medium` (decided 19 Oct; Vinay has $1,500 credits). If decisions prove too slow for the demo, measure `claude-haiku-5-5` before switching. Read the `claude-api` skill before writing `packages/ai`.
- Every run and test must work with `FF_AI=off` and no API key.
- Commits: stage explicit paths only (never `git add -A`), no AI attribution lines of any kind, no push or deploy without Vinay's yes.
- Licence MIT. PayPal spec files are Apache-2.0: credit them in `NOTICE`.

## Review Focus

1. **App not running** at `webhookUrl` → CLI exits 2 within 5 s with `can't reach your app at <url>`, never a report full of failed checks. Test in Task 11.
2. **App not redirected** (started without the add-on) → run aborts with the message from spec §11 instead of producing nonsense checks. Test in Task 9.
3. **Month-end start** (`start: 2026-01-31`, monthly) → payments on 31 Jan, 28 Feb, 31 Mar; no skipped or doubled month. Test in Task 4.
4. **AI down or returning junk** → run completes with scripted decisions and template narration; `fastforward new` prints a clear error. Test in Task 8.
5. **Big scenario** (200 customers × 365 days, instant app) finishes in under 60 s. Test in Task 9.

---

## Phase 0: feasibility gate

### Task 0: Redirect spike (throwaway)

Answers the one question that decides the architecture (spec §14). Code lives in `spike/` and is deleted after the gate.

**Files:**
- Create: `spike/package.json`, `spike/fake-twin.mjs`, `spike/register.mjs`, `spike/app.mjs`, `spike/run.mjs`
- Create: `docs/spike-results.md`

- [ ] **Step 1:** `spike/fake-twin.mjs`: plain `node:http` server on 4010 answering `POST /v1/oauth2/token` (any credentials → `{access_token:"ff",token_type:"Bearer",expires_in:32400}`), `POST /v2/checkout/orders` (→ 201 `{id:"ORDER-FF",status:"CREATED"}`), `POST /v1/billing/subscriptions` (→ 201 `{id:"I-FF",status:"APPROVAL_PENDING"}`), `POST /v1/notifications/verify-webhook-signature` (→ `{verification_status:"SUCCESS"}`), `GET /v1/notifications/certs/CERT-FF` (→ PEM from `selfsigned`). Log every request line.
- [ ] **Step 2:** `spike/register.mjs`: when `FASTFORWARD=1`, patch `https.request`/`https.get` and set an undici global dispatcher so requests to `api-m.sandbox.paypal.com` and `api.sandbox.paypal.com` go to `http://127.0.0.1:4010` with path kept; throw on `api-m.paypal.com`.
- [ ] **Step 3:** `spike/app.mjs`: uses `@paypal/paypal-server-sdk` (`Environment.Sandbox`) to create an order; uses global `fetch` to create a subscription and to call verify-webhook-signature; fetches the cert URL `https://api.sandbox.paypal.com/v1/notifications/certs/CERT-FF`. Prints each result.
- [ ] **Step 4: Run** `node spike/fake-twin.mjs` then `FASTFORWARD=1 node --import ./spike/register.mjs spike/app.mjs`.
  Expected: fake twin logs all four requests; app prints `ORDER-FF`, `I-FF`, `SUCCESS`, and a PEM header. Also run once without `FASTFORWARD=1` and confirm the app reaches the real sandbox (401 or real response), proving the add-on is inert when off.
- [ ] **Step 5:** Record in `docs/spike-results.md`: SDK redirected yes/no; fetch redirected yes/no; cert fetch redirected yes/no; whether the SDK exposes a subscriptions controller (decides Task 7's client choice).
- [ ] **Step 6: Gate.** Both SDK and fetch redirected → proceed. Only fetch → proceed, drop the "official SDK" claim from spec §10, tell Vinay. Neither → stop, report to Vinay. `spike/` is never committed; delete it after the gate. Commit only `docs/spike-results.md`.

---

## Phase 1: core loop

### Task 1: Repo scaffold and contracts

**Files:**
- Create: `package.json` (workspaces `packages/*`, `apps/*`, `examples/*`; scripts `build` (`tsc -b`), `test`, `test:e2e`, `typecheck`, `fidelity`, `demo`), `tsconfig.base.json`, `vitest.workspace.ts`, `LICENSE` (MIT, "Vinay G"), `NOTICE`
- Modify: `.gitignore` (add `node_modules/`, `dist/`, `.fastforward/`, `*.lock.json` is NOT ignored: lock files are committed so reruns match)
- Create: `packages/contracts/{package.json,tsconfig.json}`, `packages/contracts/src/{index.ts,scenario.ts,events.ts,trace.ts,report.ts}`
- Test: `packages/contracts/test/scenario.test.ts`
- Create: `examples/coffee-club/scenarios/bad-month.yaml` (the spec §5 example plus weather `{duplicates: 0.2, reorder: 0.1, delayMinutes: [0, 90], forged: 1, burst: false}`, customers Maya `ok`, Leo `fails_from:2026-12-01`, Ana with action `{at: "2026-11-20", do: dispute, reason: MERCHANDISE_OR_SERVICE_NOT_RECEIVED}`, `start: 2026-11-01T00:00:00.000Z`, `duration: P60D`, `seed: 42`)

**Interfaces — Produces** (all exported from `@fastforward/contracts`):
- `type SubscriptionStatus = 'APPROVAL_PENDING'|'APPROVED'|'ACTIVE'|'SUSPENDED'|'CANCELLED'|'EXPIRED'`
- `type CardBehaviour = {kind:'ok'} | {kind:'fails_from'; date: string}` (YAML string `ok` or `fails_from:YYYY-MM-DD`)
- `const DISPUTE_REASONS` (copied from the `reason` enum in `customer_disputes_v1.json`), `type DisputeReason`
- `type CustomerAction = {at: string; do: 'cancel'} | {at: string; do: 'update_card'} | {at: string; do: 'dispute'; reason: DisputeReason; message?: string}`
- `interface Customer {name; email; persona; card: CardBehaviour; actions: CustomerAction[]}` (email defaults to `<lowercase name>@example.test`)
- `interface Weather {duplicates: number; reorder: number; delayMinutes: [number, number]; forged: number; burst: boolean}` (defaults `0, 0, [0,0], 0, false`)
- `interface Scenario {name; seed: number; start: string; durationDays: number; app: {webhookUrl; webhookId; subscribeUrl?; probeUrl?}; plan: {name; price: string; currency: string; interval: 'DAY'|'WEEK'|'MONTH'|'YEAR'; trialDays: number; totalCycles: number; paymentFailureThreshold: number}; customers: Customer[]; weather: Weather; expect: {accessWhile: SubscriptionStatus[]}}` (`duration: P<n>D` → `durationDays`; `webhookId` default `WH-FF-LOCAL`; `expect.accessWhile` default `['ACTIVE']`; `trialDays` 0; `totalCycles` 0 = infinite; `paymentFailureThreshold` default 2)
- `ScenarioSchema` (zod) and `parseScenario(yamlText: string): Scenario`
- `type EventType` = the 12 event names in spec §6 (`BILLING.SUBSCRIPTION.CREATED|ACTIVATED|PAYMENT.FAILED|SUSPENDED|CANCELLED|EXPIRED`, `PAYMENT.SALE.COMPLETED`, `CUSTOMER.DISPUTE.CREATED|UPDATED|RESOLVED`)
- `interface WebhookEvent {id; event_version: '1.0'; create_time; resource_type; event_type: EventType; summary; resource: Record<string, unknown>; links: {href; rel; method}[]}`
- `type CustomerDecision = {action: 'update_card'|'ignore'|'cancel'} | {action: 'dispute'; reason: DisputeReason; message: string} | {action: 'reply'; message: string}`
- `type TraceEntry` union, each with `at: string`:
  `{kind:'event'; event: WebhookEvent; forged: boolean}` · `{kind:'delivery'; eventId; attempt: number; status: number|null; ms: number; verifyCalled: boolean; transmissionId: string}` · `{kind:'app_call'; method; path; status: number}` · `{kind:'probe'; subscriptionId; access: boolean|null; fulfilments: number|null; expectedAccess: boolean; completedPayments: number}` · `{kind:'dispute_action'; disputeId; action: 'provide-evidence'|'accept-claim'|'send-message'|'make-offer'}` · `{kind:'live_call_blocked'; url}` · `{kind:'customer_decision'; customer; decision: CustomerDecision}`
- `type CheckId = 'ACK_FAST'|'VERIFIES_SIGNATURES'|'STATE_MATCHES'|'FULFIL_ONCE'|'DISPUTE_ANSWERED'|'NO_LIVE_CALLS'`
- `interface Finding {at; summary; eventIds: string[]; explanation?; fix?}`, `interface CheckResult {id: CheckId; status: 'pass'|'fail'|'skipped'; findings: Finding[]; note?}`, `interface Report {runId; scenario: string; start; end; checks: CheckResult[]; counts: {events; deliveries; customers}}`

- [ ] **Step 1: Write failing tests** in `scenario.test.ts`: `parses bad-month.yaml` (durationDays 60, Leo card `{kind:'fails_from', date:'2026-12-01'}`, Ana action reason as given, Maya email `maya@example.test`); `applies defaults` (minimal YAML → weather all zero, accessWhile `['ACTIVE']`, webhookId `WH-FF-LOCAL`); `rejects missing app.webhookUrl` (throws, message contains `app.webhookUrl`); `rejects duration not in P<n>D form`.
- [ ] **Step 2: Run** `npm test -w @fastforward/contracts` → FAIL (module missing).
- [ ] **Step 3: Implement** the types and `parseScenario` with zod + `yaml`.
- [ ] **Step 4: Run** `npm test -w @fastforward/contracts && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git add package.json package-lock.json .gitignore tsconfig.base.json vitest.workspace.ts LICENSE NOTICE packages/contracts examples/coffee-club/scenarios/bad-month.yaml && git commit -m "feat: repo scaffold and shared contracts"`

### Task 2: Twin server skeleton

**Files:**
- Create: `packages/twin/{package.json,tsconfig.json}`, `packages/twin/src/{index.ts,server.ts,ids.ts,passthrough.ts,control.ts}`
- Test: `packages/twin/test/server.test.ts`

**Interfaces — Produces:**
- `createTwin(opts: TwinOptions): Promise<Twin>`; `TwinOptions {port?: number /*4010; 0 = random*/; upstreamBase?: string /*https://api-m.sandbox.paypal.com*/; sandboxCreds?: {clientId; clientSecret}}` (Task 9 adds `deps?: RunDeps`); `Twin {url: string; app: FastifyInstance; close(): Promise<void>; activeRun(): Run | null}`
- `newId(prefix: 'I'|'P'|'PROD'|'WH'|'PP-D'|'SALE'): string` (uppercase alphanumerics, PayPal-like lengths)
- Control routes registered by `registerControlRoutes(app, registry)` with handlers that Task 9 fills in; this task implements `POST /_ff/runs` returning 409 when a run is active, and `POST /_ff/live-call` appending `{kind:'live_call_blocked'}` to the active run's trace.

- [ ] **Step 1: Failing tests:** `issues a token for any credentials` (`POST /v1/oauth2/token` basic auth `x:y` → 200, `token_type` `Bearer`, `expires_in` 32400); `passes unknown /v1 and /v2 routes to upstream` (start a local fake upstream on a random port as `upstreamBase`, `GET /v1/reporting/transactions` on the twin returns the upstream body, and the upstream saw an `Authorization: Bearer` header from the twin's own token request); `never targets live PayPal` (`createTwin({upstreamBase:'https://api-m.paypal.com'})` rejects); `second run returns 409`.
- [ ] **Step 2: Run** `npm test -w @fastforward/twin` → FAIL.
- [ ] **Step 3: Implement.** Passthrough fetches its own sandbox token with `sandboxCreds` (cache until expiry) and swaps the `Authorization` header; refuse any `upstreamBase` whose host is not `api-m.sandbox.paypal.com` unless it is `127.0.0.1`/`localhost` (tests).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add packages/twin && git commit -m "feat(twin): server skeleton, token, passthrough"`

### Task 3: Virtual clock and scheduler

**Files:**
- Create: `packages/twin/src/time/{clock.ts,scheduler.ts,calendar.ts}`
- Test: `packages/twin/test/time.test.ts`

**Interfaces — Produces:**
- `class VirtualClock {constructor(startIso: string); now(): Date; set(d: Date): void}` (`set` to an earlier time throws)
- `class Scheduler {constructor(clock: VirtualClock); schedule(at: Date, label: string, job: () => Promise<void>): void; advanceTo(target: Date): Promise<number>; pending(): number}`: runs jobs in time order, ties in insertion order, sets the clock to each job's time before running it, jobs may schedule further jobs (picked up in the same advance if due), returns the count run, ends with clock = target.
- `addInterval(from: Date, unit: 'DAY'|'WEEK'|'MONTH'|'YEAR', count: number, anchorDay: number): Date`: month/year steps clamp to the month's last day and return to `anchorDay` when possible.

- [ ] **Step 1: Failing tests:** `runs jobs in time order`; `ties run in insertion order`; `job scheduled during advance runs if due`; `advanceTo leaves clock at target`; `month-end anchor 31 Jan → 28 Feb → 31 Mar` (via `addInterval` with anchorDay 31, year 2026); `setting clock backwards throws`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (a sorted array is enough; no heap needed below 100k jobs). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add packages/twin/src/time packages/twin/test/time.test.ts && git commit -m "feat(twin): virtual clock and scheduler"`

### Task 4: Subscriptions engine and endpoints

**Files:**
- Create: `packages/twin/src/fidelity.ts`, `packages/twin/src/subscriptions/{engine.ts,routes.ts,resources.ts}`
- Create: `packages/twin/spec/` (copy `billing_subscriptions_v1.json`, `catalogs_products_v1.json`, `customer_disputes_v1.json`, `notifications_webhooks_v1.json` from `github.com/paypal/paypal-rest-api-specifications/openapi`)
- Create: `packages/twin/test/support/openapi.ts`
- Test: `packages/twin/test/subscriptions.test.ts`

**Interfaces:**
- Consumes: `VirtualClock`, `Scheduler`, `addInterval` (Task 3); contracts types.
- Produces:
  - `fidelity` const: `{retryIntervalDays: 5, maxRetries: 2, disputeResponseDays: 20, deliveryTimeoutMs: 10000, deliveryFirstRetryMinutes: 1, deliveryMaxAttempts: 25, deliveryWindowDays: 3}`, each with a comment `// verified 2026-10-03` or `// unverified: <source>`. **Step 3a** below checks PayPal's docs for the two retry values and updates the comment.
  - `type DomainEvent = {type: EventType; resourceType: 'subscription'|'sale'|'dispute'; resource: Record<string, unknown>}`
  - `class SubscriptionEngine {constructor(deps: {clock: VirtualClock; scheduler: Scheduler; emit: (e: DomainEvent) => void; cardOutcome: (subscriptionId: string, at: Date) => 'ok'|'fail'}); createProduct(body); createPlan(body); createSubscription(body: {plan_id: string; custom_id?: string; subscriber?: {email_address: string}}): SubscriptionResource; approve(id: string): void; cancel(id: string, reason: string): void; suspend(id: string): void; activate(id: string): void; get(id: string): SubscriptionResource; completedPayments(id: string): number; latestSaleId(id: string): string | null; usePlan(plan: Scenario['plan']): void}`
  - `usePlan` makes every `createSubscription` in this run use the scenario plan whatever `plan_id` the app sends, echoing the app's `plan_id` string back (spec §5: the app's real sandbox plan id is unknown to the twin).
  - `registerSubscriptionRoutes(app, engineOf: () => SubscriptionEngine)` for the 10 routes: `POST/GET /v1/catalogs/products[/:id]`, `POST/GET /v1/billing/plans[/:id]`, `POST /v1/billing/subscriptions`, `GET /v1/billing/subscriptions/:id`, `POST .../:id/activate|suspend|cancel` (204), `GET .../:id/transactions`.
  - `assertMatchesSpec(specFile: string, path: string, method: string, status: number, body: unknown): void` (ajv over the spec's response schema).

- [ ] **Step 1: Failing tests:** `create returns APPROVAL_PENDING with approve link` (and matches spec); `approve activates, emits CREATED then ACTIVATED then SALE.COMPLETED`; `monthly plan bills 3 times in 61 days from 2026-11-01` (sales on 11-01, 12-01, 2027-01-01); `failed card emits PAYMENT.FAILED, retries after 5 days, suspends at threshold 2` (exact event order and dates); `successful retry clears outstanding_balance and resets failed_payments_count`; `totalCycles 2 expires after second payment`; `trialDays 7 delays the first sale to start + 7 days`; `cancel emits CANCELLED and stops billing`; `month-end start 2026-01-31 bills 01-31, 02-28, 03-31` (Review Focus 3); `GET subscription matches spec schema`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3a:** Look up PayPal's documented retry behaviour for failed subscription payments (`developer.paypal.com` subscriptions docs, `payment_failure_threshold`); set `retryIntervalDays`/`maxRetries` and their comments accordingly. If undocumented, keep 5/2 and mark `unverified`.
- [ ] **Step 3b: Implement.** Resource shapes follow `billing_subscriptions_v1.json`. Sale resource for `PAYMENT.SALE.COMPLETED`: `{id, state: 'completed', amount: {total, currency, details: {subtotal}}, billing_agreement_id, create_time}`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add packages/twin/src/fidelity.ts packages/twin/src/subscriptions packages/twin/spec packages/twin/test && git commit -m "feat(twin): subscription lifecycle and endpoints"`

### Task 5: Webhook signing, verification and delivery

**Files:**
- Create: `packages/twin/src/webhooks/{sign.ts,dispatcher.ts,routes.ts,envelope.ts}`
- Test: `packages/twin/test/webhooks.test.ts`

**Interfaces:**
- Consumes: `fidelity` (Task 4), `Scheduler` (Task 3), `DomainEvent` (Task 4), contracts.
- Produces:
  - `crc32(data: string): number` (unsigned), `signingString(transmissionId: string, transmissionTime: string, webhookId: string, body: string): string` → `` `${id}|${time}|${webhookId}|${crc32(body)}` ``
  - `createSigner(twinId: string): Signer`; `Signer {certId: string /* CERT-FF-<twinId> */; certPem: string; sign(input: string): string /* base64 RSA-SHA256 */; verify(input: string, sig: string): boolean}` (key + self-signed cert via `selfsigned`)
  - `toWebhookEvent(e: DomainEvent, at: Date): WebhookEvent`
  - `class Dispatcher {constructor(deps: {scheduler: Scheduler; clock: VirtualClock; signer: Signer; webhookUrl: string; webhookId: string; runId: string; record: (t: TraceEntry) => void; verifyCalls: VerifyLedger; timeoutMs?: number}); send(event: WebhookEvent, opts?: {forged?: boolean}): Promise<void>; scheduleSend(event: WebhookEvent, at: Date, opts?: {forged?: boolean}): void}`
  - `class VerifyLedger {mark(transmissionId: string): void; markCertFetch(): void; wasVerified(transmissionId: string, sinceMs: number): boolean}`
  - `registerWebhookRoutes(app, deps: {signer: Signer; ledger: () => VerifyLedger | null})`: `POST /v1/notifications/verify-webhook-signature` (reads `transmission_id, transmission_time, cert_url, auth_algo, transmission_sig, webhook_id, webhook_event`, recomputes with `JSON.stringify(webhook_event)`, returns `SUCCESS`/`FAILURE`, marks the ledger), `GET /v1/notifications/certs/:certId` (PEM, marks cert fetch).

- [ ] **Step 1: Failing tests:** `crc32 of "hello" is 907060870`; `signature verifies with node:crypto against served cert`; `verify endpoint returns SUCCESS for a twin-signed event and FAILURE when one byte of the body changes`; `delivery sends the 6 headers with exact names` (spec §6); `non-2xx schedules retry at +1 minute, then +2, +4` (virtual time); `stops after 25 attempts or 3 days`; `slow app past timeoutMs counts as failed delivery with status null`; `forged event carries a signature that FAILS verification`; `delivery entry records verifyCalled=true when app called verify during the delivery`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Deliver with `fetch` and `AbortSignal.timeout(timeoutMs ?? Number(process.env.FF_DELIVERY_TIMEOUT_MS ?? fidelity.deliveryTimeoutMs))`; body is `JSON.stringify(event)` sent byte-exact. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add packages/twin/src/webhooks packages/twin/test/webhooks.test.ts && git commit -m "feat(twin): signed webhook delivery and verification"`

### Task 6: Register add-on

**Files:**
- Create: `packages/register/{package.json,tsconfig.json}`, `packages/register/src/index.ts` (side-effect entry for `node --import @fastforward/register`), `packages/register/src/redirect.ts`
- Test: `packages/register/test/register.test.ts`, `packages/register/test/fixtures/{client-fetch.mjs,client-https.mjs,client-sdk.mjs,client-live.mjs}`

**Interfaces — Produces:**
- Env: active only when `FASTFORWARD=1`; target `FF_TWIN_URL` (default `http://127.0.0.1:4010`).
- Redirects hosts `api-m.sandbox.paypal.com` and `api.sandbox.paypal.com` for global `fetch` (undici dispatcher) and `https.request`/`https.get`, keeping path, query, method, headers, body.
- `class FastforwardLiveCallError extends Error` thrown for `api-m.paypal.com`/`api.paypal.com`; before throwing, fire-and-forget `POST ${FF_TWIN_URL}/_ff/live-call {url}`.
- Uses Task 0's findings for the SDK path.

- [ ] **Step 1: Failing tests** (each spawns `node --import <register> fixture` against a local echo server standing in for the twin): `redirects fetch`; `redirects https.request`; `redirects the official PayPal SDK` (skip with a recorded reason if Task 0 found it impossible); `blocks live PayPal with FastforwardLiveCallError and reports it`; `does nothing when FASTFORWARD is unset` (fixture targets a local https echo with a self-signed cert and must not be redirected).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (port the spike, typed). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add packages/register && git commit -m "feat(register): redirect sandbox calls to the twin, block live"`

### Task 7: Coffee Club demo app

**Files:**
- Create: `examples/coffee-club/{package.json,tsconfig.json}`, `examples/coffee-club/src/{server.ts,paypal.ts,store.ts,bugs.ts}`
- Test: `examples/coffee-club/test/app.test.ts`

**Interfaces — Produces** (spec §5 contract):
- `POST /subscribe {name, email}` → creates a subscription via PayPal (`plan_id` = `PAYPAL_PLAN_ID` env, default `P-COFFEE`, `custom_id` = email) → `200 {subscription_id}`.
- `POST /webhooks/paypal`: verifies via `POST /v1/notifications/verify-webhook-signature` with `webhook_id` = `PAYPAL_WEBHOOK_ID` (default `WH-FF-LOCAL`); dedupes by event `id`; ACTIVATED → access on; SALE.COMPLETED → `fulfilments += 1`, access on; SUSPENDED/CANCELLED/EXPIRED → access off; DISPUTE.CREATED → `provide-evidence` with tracking `UPS 1Z999AA10123456784`; replies 200.
- `GET /__ff/probe?subscription_id=` → `{access, fulfilments}`; 404 for unknown ids.
- `COFFEE_BUGS` = `none` (default) | `all` | comma list of `no-verify, no-dedupe, slow-ack, ignores-suspend, ignores-disputes`; `COFFEE_SLOW_MS` default 12000.
- PayPal client: official SDK if Task 0 found a subscriptions controller, otherwise `fetch` to `https://api-m.sandbox.paypal.com` (redirected by the add-on in runs). Token via `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`.

- [ ] **Step 1: Failing tests** against an in-test fake PayPal (local server + add-on not needed; inject base URL in `paypal.ts` via `PAYPAL_API_BASE` for unit tests only): `subscribe returns subscription id`; `sale completed twice with same event id fulfils once`; `with no-dedupe fulfils twice`; `suspended turns access off`; `with ignores-suspend access stays on`; `rejects event when verify returns FAILURE (no state change)`; `with no-verify accepts it`; `dispute created calls provide-evidence`; `with slow-ack replies after COFFEE_SLOW_MS`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add examples/coffee-club/package.json examples/coffee-club/tsconfig.json examples/coffee-club/src examples/coffee-club/test && git commit -m "feat(demo): Coffee Club app with switchable billing bugs"`

### Task 8: AI package

Read the `claude-api` skill first.

**Files:**
- Create: `packages/ai/{package.json,tsconfig.json}`, `packages/ai/src/{index.ts,client.ts,scenario-writer.ts,customers.ts,narrator.ts,lock.ts,prompts.ts}`
- Test: `packages/ai/test/ai.test.ts`

**Interfaces — Produces:**
- `interface AiClient {complete(opts: {model: string; system: string; prompt: string; json?: boolean}): Promise<string>}`; `anthropicClient(apiKey: string): AiClient`; `aiFromEnv(): AiClient | null` (null when `FF_AI=off` or no key)
- `class AiUnavailableError extends Error`
- `writeScenario(description: string, ai: AiClient | null): Promise<Scenario>` (null → throws `AiUnavailableError` with "set ANTHROPIC_API_KEY or write the YAML by hand"; invalid output → one retry including the zod error, then throws)
- `interface DecisionContext {key: string; customer: Customer; point: 'payment_failed'|'seller_message'; at: string; details: string}`
- `class DecisionLock {static load(path: string): DecisionLock; get(key: string): CustomerDecision | undefined; set(key: string, d: CustomerDecision): void; save(): void}`
- `decideCustomerAction(ctx: DecisionContext, ai: AiClient | null, lock: DecisionLock): Promise<CustomerDecision>`: lock hit → return it; AI null or failure → scripted default (`payment_failed` → `ignore`; `seller_message` → `{action:'reply', message:'I still have not received anything.'}`); result stored in lock.
- `narrate(check: CheckId, finding: Finding, trace: TraceEntry[], ai: AiClient | null): Promise<{explanation: string; fix: string}>` (null/failure → template text per `CheckId` from `prompts.ts`)

- [ ] **Step 1: Failing tests** with a fake `AiClient`: `writeScenario parses model YAML into a Scenario`; `writeScenario retries once on invalid YAML then throws`; `writeScenario without AI throws AiUnavailableError` (Review Focus 4); `decision comes from lock without calling AI`; `AI failure falls back to scripted decision` (Review Focus 4); `narrate falls back to template when AI throws` (template for `FULFIL_ONCE` mentions "same notice twice"); `aiFromEnv returns null when FF_AI=off`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add packages/ai && git commit -m "feat(ai): scenario writer, AI customers, narrator with offline fallback"`

### Task 9: Run orchestration

**Files:**
- Create: `packages/twin/src/run/{run.ts,registry.ts,customers.ts,probe.ts}`
- Modify: `packages/twin/src/server.ts` (wire engines, webhook routes, run registry; add `deps?: RunDeps` to `TwinOptions`), `packages/twin/src/control.ts` (fill `/_ff` handlers)
- Test: `packages/twin/test/run.test.ts`, `packages/twin/test/support/fake-app.ts`

**Interfaces:**
- Consumes: Tasks 2–5; `CustomerDecision`, `DecisionContext` shapes from Task 8 (the twin does not import `@fastforward/ai`; it receives a function).
- Produces:
  - `interface RunDeps {decide?: (ctx: DecisionContext) => Promise<CustomerDecision>}`
  - `class Run {id: string; scenario: Scenario; trace: TraceEntry[]; start(): Promise<void>; advance(to: Date): Promise<void>; runToEnd(): Promise<void>; subscriptions(): {customer: string; subscriptionId: string}[]; onTrace(listener: (t: TraceEntry) => void): () => void}`
  - Control API (spec §9): `POST /_ff/runs` body `{scenario: Scenario}` → `201 {runId}` after `start()`; `POST /_ff/runs/:id/advance {to?: string; by?: 'P<n>D'}`; `GET /_ff/runs/:id` → `{runId, now, end, subscriptions}`; `GET /_ff/runs/:id/trace`; `GET /_ff/runs/:id/stream` (SSE, one `data:` line per TraceEntry); `POST /_ff/runs/:id/finish` → runs to end and releases the twin.
  - `start()`: `usePlan`; for each customer, `subscribeUrl` → POST and expect a twin-observed `POST /v1/billing/subscriptions` within that call, otherwise abort with the spec §11 message; no `subscribeUrl` → `createSubscription` directly with `custom_id` = name; then `approve` at `scenario.start`. Schedules explicit actions; card outcomes from `CardBehaviour` plus `update_card` decisions; on each `PAYMENT.FAILED`, calls `decide` with key `<customer>:payment_failed:<n>` and applies the result.
  - Checkpoints: after each virtual day with ≥1 delivery, and at the end, probe every subscription (if `probeUrl`) and record `{kind:'probe'}` with `expectedAccess = scenario.expect.accessWhile.includes(status)` and `completedPayments`.
  - Every request the app makes to twin PayPal routes is recorded as `{kind:'app_call'}`.

- [ ] **Step 1: Failing tests** using `fake-app.ts` (minimal webhook + probe + subscribe server): `start subscribes all customers through subscribeUrl`; `aborts with redirect message when app never calls the twin` (Review Focus 2); `runToEnd delivers 3 sales for Maya over 61 days`; `probe entries recorded at checkpoints with expectedAccess`; `payment_failed decision update_card makes next retry succeed`; `stream emits trace entries`; `200 customers × 365 days completes under 60 s` (Review Focus 5; fake app answers instantly, `FF_DELIVERY_TIMEOUT_MS=500`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add packages/twin/src/run packages/twin/src/server.ts packages/twin/src/control.ts packages/twin/test/run.test.ts packages/twin/test/support/fake-app.ts && git commit -m "feat(twin): run orchestration, customers, probes, control API"`

### Task 10: Checks

**Files:**
- Create: `packages/twin/src/checks/{index.ts,ack-fast.ts,verifies-signatures.ts,state-matches.ts,fulfil-once.ts,dispute-answered.ts,no-live-calls.ts}`
- Test: `packages/twin/test/checks.test.ts` (synthetic traces only)

**Interfaces — Produces:** `runChecks(trace: TraceEntry[], scenario: Scenario): CheckResult[]` in the order of `CheckId`; `buildReport(run: Run): Report`; `GET /_ff/runs/:id/report` returns it.

Rules (spec §7): `ACK_FAST` fails per delivery with `status === null || status >= 300 || ms > 10000`. `VERIFIES_SIGNATURES` fails per non-forged event whose deliveries all have `verifyCalled === false`; skipped when there were no deliveries. `STATE_MATCHES` fails per probe with `access !== expectedAccess`; skipped without `probeUrl`; `access === null` is a failure "probe did not answer". `FULFIL_ONCE` fails per probe with `fulfilments !== null && fulfilments !== completedPayments`; skipped when every probe had `fulfilments === null`. `DISPUTE_ANSWERED` fails per non-forged `CUSTOMER.DISPUTE.CREATED` with no `dispute_action` for that id at or before `resource.seller_response_due_date`; skipped with no disputes. `NO_LIVE_CALLS` fails per `live_call_blocked`.

- [ ] **Step 1: Failing tests:** one passing and one failing trace per check, plus `skipped` cases above; `report counts events, deliveries, customers`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add packages/twin/src/checks packages/twin/test/checks.test.ts && git commit -m "feat(twin): deterministic billing checks"`

### Task 11: CLI and the Phase 1 acceptance test

**Files:**
- Create: `packages/cli/{package.json,tsconfig.json}` (bin `fastforward`), `packages/cli/src/{index.ts,runner.ts,print.ts,reachability.ts}`
- Test: `packages/cli/test/cli.test.ts`, `test/e2e/coffee-club.e2e.test.ts` (root)

**Interfaces:**
- Consumes: `createTwin` (2), `runChecks`/report (10), `aiFromEnv`, `narrate`, `decideCustomerAction`, `DecisionLock`, `writeScenario` (8).
- Produces:
  - `runScenarioFile(path: string, opts?: RunOptions): Promise<RunResult>`; `RunOptions {reportDir?: string; fresh?: boolean; twinUrl?: string; ai?: AiClient | null}`; `RunResult {report: Report; reportDir: string; exitCode: 0|1|2}`
  - Commands: `fastforward run <file> [--report-dir] [--fresh]`, `fastforward new "<description>" [-o file]`, `fastforward twin [--port]`.
  - Writes `report.json` to `.fastforward/runs/<runId>/`; lock file `<scenario>.lock.json` next to the scenario (`--fresh` deletes it first).
  - Before starting: `checkReachable(url, 5000)` (any HTTP response counts; connection error → exit 2 `can't reach your app at <url>`).

- [ ] **Step 1: Failing tests:** `exits 2 with can't reach your app when nothing listens` (Review Focus 1, < 5 s); `exit code 1 when a check fails, 0 when all pass/skip` (fake app); `new writes YAML from description` (fake AI); `--fresh removes the lock file`.
- [ ] **Step 2: Failing e2e:** start Coffee Club with `FASTFORWARD=1 node --import @fastforward/register`, `COFFEE_SLOW_MS=1000`, `FF_DELIVERY_TIMEOUT_MS=500`, `FF_AI=off`; run `bad-month.yaml` (weather off for this step via a copy with `weather` removed and Ana's dispute removed, since disputes and weather land in Tasks 12–13): `COFFEE_BUGS=none` → all checks pass or skip; `COFFEE_BUGS=no-verify,no-dedupe,slow-ack,ignores-suspend` → `VERIFIES_SIGNATURES`, `FULFIL_ONCE`, `ACK_FAST`, `STATE_MATCHES` fail.
- [ ] **Step 3: Run** both → FAIL. **Step 4: Implement.** **Step 5: Run** `npm test && npm run test:e2e` → PASS.
- [ ] **Step 6: Commit** `git add packages/cli test/e2e package.json && git commit -m "feat(cli): run scenarios end to end; Phase 1 acceptance"`

**Phase 1 is done when** the e2e passes. Sara shows Vinay a live run before Phase 2.

---

## Phase 2: disputes, weather, AI reports, fidelity

### Task 12: Disputes

**Files:**
- Create: `packages/twin/src/disputes/{engine.ts,routes.ts}`
- Modify: `packages/twin/src/run/run.ts` (dispute actions and `seller_message` decisions), `packages/twin/src/server.ts` (routes)
- Test: `packages/twin/test/disputes.test.ts`

**Interfaces — Produces:** `class DisputeEngine {constructor(deps: {clock; scheduler; emit; record: (t: TraceEntry) => void}); open(subscriptionId: string, saleId: string, amount: {currency_code: string; value: string}, reason: DisputeReason, message: string): string; act(id: string, action: 'provide-evidence'|'accept-claim'|'send-message'|'make-offer', body: unknown): void; get(id: string): DisputeResource; list(): DisputeResource[]}`; routes `GET /v1/customer/disputes[/:id]`, `POST /v1/customer/disputes/:id/{provide-evidence|accept-claim|send-message|make-offer}` (provide-evidence accepts multipart with an `input` JSON part, like the real API).

- [ ] **Step 1: Failing tests:** `open sets WAITING_FOR_SELLER_RESPONSE, INQUIRY, due date +20 days, emits CREATED` (matches `customer_disputes_v1.json`); `seller action emits UPDATED and records dispute_action`; `no action by due date resolves in buyer favour with RESOLVED`; `send-message triggers the customer's seller_message decision and a reply message on the dispute`; `scenario action dispute opens against the latest sale`.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS. Extend the e2e: `ignores-disputes` makes `DISPUTE_ANSWERED` fail, `none` passes.
- [ ] **Step 5: Commit** `git add packages/twin/src/disputes packages/twin/src/run/run.ts packages/twin/src/server.ts packages/twin/test/disputes.test.ts test/e2e && git commit -m "feat(twin): disputes"`

### Task 13: Bad weather

**Files:**
- Create: `packages/twin/src/webhooks/weather.ts`
- Modify: `packages/twin/src/run/run.ts` (route sends through the weather plan)
- Test: `packages/twin/test/weather.test.ts`

**Interfaces — Produces:** `mulberry32(seed: number): () => number`; `planDeliveries(events: {event: WebhookEvent; at: Date}[], weather: Weather, rng: () => number): {event: WebhookEvent; at: Date; forged: boolean}[]` (duplicates add a second copy with the same `id`; reorder swaps adjacent send times; delay adds `rng`-chosen minutes in range; burst sets all same-day renewals to the earliest time); `forgedEvents(subscriptions: string[], count: number, rng, at: (i: number) => Date): WebhookEvent[]` (claims `BILLING.SUBSCRIPTION.CANCELLED` or `PAYMENT.FAILED` for an active subscription, signed so verification fails).

- [ ] **Step 1: Failing tests:** `same seed gives identical plan`; `duplicates 1.0 doubles every event with identical ids`; `reorder 1.0 swaps neighbours`; `delays stay inside [min,max]`; `forged events fail verification and do not change twin state`.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS. Restore the full `bad-month.yaml` in the e2e: buggy Coffee Club fails 5 checks, fixed passes all.
- [ ] **Step 5: Commit** `git add packages/twin/src/webhooks/weather.ts packages/twin/src/run/run.ts packages/twin/test/weather.test.ts test/e2e && git commit -m "feat(twin): bad-weather delivery"`

### Task 14: HTML report and fidelity suite

**Files:**
- Create: `packages/cli/src/html-report.ts`; Modify: `packages/cli/src/runner.ts` (narrate failures, write `report.html`)
- Create: `packages/twin/test/fidelity/fidelity.test.ts`, `packages/twin/test/fidelity/shape.ts`
- Test: `packages/cli/test/html-report.test.ts`

**Interfaces — Produces:** `renderHtmlReport(report: Report): string` (one self-contained file, no external requests, every page labelled "Simulated run"); `shapeOf(json: unknown): Shape` (keys and value types, arrays by first element, ignoring values).

- [ ] **Step 1: Failing tests:** `html contains each check id and status`; `html escapes payload text` (a summary containing `<script>` renders inert); `html has no http(s) URLs except in user data`.
- [ ] **Step 2: Fidelity test** (runs only with `FF_FIDELITY=1` and sandbox keys; `npm run fidelity`): create product, plan and subscription in the real sandbox and in the twin with identical bodies; `shapeOf` of each response equal, except fields listed in `ALLOWED_DIFFS` with a reason each; both pass `assertMatchesSpec`.
- [ ] **Step 3–4:** Implement; `npm test` → PASS; `npm run fidelity` → PASS (record any real differences found and fix the twin or `fidelity.ts`).
- [ ] **Step 5: Commit** `git add packages/cli/src/html-report.ts packages/cli/src/runner.ts packages/cli/test/html-report.test.ts packages/twin/test/fidelity && git commit -m "feat: HTML report and sandbox fidelity suite"`

---

## Phase 3: dashboard, coding assistants, hosting

### Task 15: Web dashboard

Sponsor decision (spec §13.2) decides the timeline renderer. Build the plain SVG renderer first behind the `Timeline` props; a Bryntum or AG Studio version replaces it in its own commit if Vinay chooses.

**Files:**
- Create: `apps/web/{package.json,vite.config.ts,index.html}`, `apps/web/src/{main.tsx,App.tsx,api.ts}`, `apps/web/src/timeline/{model.ts,Timeline.tsx}`, `apps/web/src/panels/{EventInspector.tsx,DisputeChat.tsx,ReportPanel.tsx}`
- Test: `apps/web/test/model.test.ts`

**Interfaces — Produces:** `toTimeline(trace: TraceEntry[], subscriptions: {customer: string; subscriptionId: string}[]): TimelineModel`; `TimelineModel {rows: {customer: string; subscriptionId: string}[]; markers: {row: number; at: string; kind: 'payment_ok'|'payment_failed'|'suspended'|'cancelled'|'expired'|'dispute'|'forged'|'duplicate'|'delivery_failed'; eventId: string}[]}`; `<Timeline model now onSelect(eventId) />`. Scrubber calls `POST /_ff/runs/:id/advance`; live updates from `/_ff/runs/:id/stream`. Every screen shows a "Simulated" badge.

- [ ] **Step 1: Failing tests:** `maps SALE.COMPLETED to payment_ok on the right row`; `marks a second delivery of the same id as duplicate`; `forged events get kind forged`; `failed delivery (status null) adds delivery_failed`.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS; manual check in the browser against a Coffee Club run (Sara records a screenshot for Vinay).
- [ ] **Step 5: Commit** `git add apps/web && git commit -m "feat(web): dashboard with timeline, inspector, dispute chat, report"`

### Task 16: MCP server

**Files:**
- Create: `packages/mcp/{package.json,tsconfig.json}`, `packages/mcp/src/server.ts`
- Test: `packages/mcp/test/mcp.test.ts`

**Interfaces — Produces:** stdio MCP server `fastforward-mcp` with tools `ff_write_scenario {description: string, outputPath?: string}` → YAML path; `ff_run {scenarioPath: string}` → summary text (per check: id, status, first finding with explanation and fix) plus `runId`; `ff_explain {runId: string, checkId: CheckId}` → all findings of that check from `.fastforward/runs/<runId>/report.json`.

- [ ] **Step 1: Failing tests** with the SDK's in-memory client: `lists three tools`; `ff_run returns a summary naming failed checks` (fake app); `ff_explain returns findings for a known run`; `ff_explain on unknown runId returns an error result, not a crash`.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS. Manual: add to Claude Code with `claude mcp add fastforward -- node packages/mcp/dist/server.js`, ask it to run `bad-month.yaml` against buggy Coffee Club and fix one bug.
- [ ] **Step 5: Commit** `git add packages/mcp && git commit -m "feat(mcp): run and explain scenarios from coding assistants"`

### Task 17: Hosting, docs and submission material

Deploying and pushing need Vinay's yes (spec §13.4).

**Files:**
- Create: `railway.json`, `scripts/start-hosted.mjs`, `README.md`, `docs/submission/{devpost.md,video-script.md}`

**Interfaces — Produces:** `start-hosted.mjs` starts the twin on 4010, Coffee Club on 3000 (add-on preloaded, `FASTFORWARD=1`, bugs from `COFFEE_BUGS`), and the web app on `$PORT` serving the built dashboard, proxying `/_ff/*` to the twin and `/demo/*` to Coffee Club. README opens with the revenue-first pitch (spec §1), then a 3-command quickstart (`npm install`, `npm run demo`, open the dashboard), the integration contract (spec §5), and the licence. `devpost.md` follows the hackathon's required sections (description, tools used and how). `video-script.md`: under 3 minutes, opening with the money problem, then the live bug-finding run, the coding-assistant fix, and the ask.

- [ ] **Step 1:** `node scripts/start-hosted.mjs` locally with `PORT=8080` → dashboard loads, a demo run completes, `/demo/__ff/probe?subscription_id=...` answers. Expected: all three processes up within 10 s.
- [ ] **Step 2:** Fresh-clone check: in a temporary folder, `git clone` the local repo, `npm install`, `npm run demo` works without `.env` (AI off, no sandbox keys).
- [ ] **Step 3: Commit** `git add railway.json scripts/start-hosted.mjs README.md docs/submission && git commit -m "docs: hosting, README, submission material"`
- [ ] **Step 4 (Vinay's yes required):** create public GitHub repo with MIT licence visible, push, deploy on Railway, add the URL to README and Devpost.

---

## Execution waves (Sara method)

| Wave | Session | Tasks | Owns |
|---|---|---|---|
| 0 | Sara | 0 (gate, then Vinay decides) | `spike/`, `docs/spike-results.md` |
| 1 | Sara | 1 | root config, `packages/contracts` |
| 2 | Worker A | 2 → 3 → 4 | `packages/twin/src/{server,control,ids,passthrough}.ts`, `time/`, `subscriptions/`, `fidelity.ts`, `spec/` |
| 2 | Worker B | 5 → 6 | `packages/twin/src/webhooks/`, `packages/register/` |
| 2 | Worker C | 7 → 8 | `examples/coffee-club/`, `packages/ai/` |
| 3 | Sara + Worker A | 9 → 10 → 11 | `packages/twin/src/run/`, `checks/`, `packages/cli/`, `test/e2e/` |
| 3 | Worker C | 15 (against recorded traces) | `apps/web/` |
| 4 | Worker A | 12 → 13 | `packages/twin/src/disputes/`, `webhooks/weather.ts` |
| 4 | Worker B | 16 | `packages/mcp/` |
| 4 | Sara | 14 | `html-report.ts`, `test/fidelity/` |
| 5 | Sara | 17 | `railway.json`, `scripts/`, `README.md`, `docs/submission/` |

At most three workers at once (shared allowance). Workers run on Sonnet; Task 5 (signing) and Task 9 (orchestration) stay on the bigger model.

**Target dates:** wave 0 by 21 Oct · wave 2 by 25 Oct · wave 3 (Phase 1 acceptance) by 29 Oct · wave 4 by 4 Nov · wave 5 by 9 Nov · video and submission 10–12 Nov.
