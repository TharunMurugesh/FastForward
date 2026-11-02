# Fastforward: Devpost submission text

Paste each section below into the matching Devpost field. Items in [square brackets] are filled in by Vinay
before submitting (see the checklist at the bottom).

## Tagline (one line)

The test clock PayPal's sandbox is missing: run a real sandbox subscription, skip months ahead, let AI customers misbehave, and find your billing bugs before real money does.

## Who pays, how much, and why now

**The customer.** A developer or small team whose app takes recurring payments through PayPal Subscriptions.

**The pain, in money.** The code that handles a failed payment, a duplicate webhook, a suspended subscription or a dispute is first run with real money, because PayPal's sandbox cannot test it. It has no clock, so you cannot skip to next month's renewal, and it has no misbehaving customers. Get one of these wrong and you either keep serving people who stopped paying, or cut off people who would have paid. Vendors report that failed payments drive a large share of subscription revenue loss (about 9% of monthly recurring revenue is a figure vendors quote; we have not verified it, so treat it as indicative).

**The price (a target, not revenue).** Pay per test, like API credits: **$1 per AI test run**, sold as a $10 pack of 10, with the first 3 free. A credit buys Claude playing the customers and explaining the failures. Running on your own machine with scripted customers stays free, so nobody is ever stuck. Paying for credits is planned, not built. No one has been asked to pay yet, and Fastforward has no revenue today.

**Why now.** PayPal has no test clock. Stripe has test clocks, but only for Stripe billing and with no AI customers. Chargebee has a "Time Machine" only for its own billing. We found nothing that gives PayPal Subscriptions this. Developers paying per test is the business. With PayPal's permission we would integrate it into PayPal's developer dashboard, which the video shows as a concept; that is upside, not the plan.

**First customers.** PayPal developers who try it before the deadline. We will ask them what it caught and whether they would pay.

**What we do not know.** The size of the market is unproven. Nobody publishes how many teams use PayPal Subscriptions directly. The path to scale is PayPal first, then other processors, because the same idea works anywhere.

## What it does

You describe a scenario in plain words, such as "a bad month for a coffee subscription." Fastforward starts on the real PayPal sandbox with a real subscription, then uses a twin for the months the sandbox cannot reach. Every step is labelled Real PayPal or Simulated.

1. **The real sandbox goes first.** Real notices with PayPal's own signatures reach your app unchanged, and real PayPal checks each signature your app asks about. Claude plays a customer whose subscription is suspended and chooses what they do; updating the card or cancelling becomes a real sandbox call.
2. **A twin of PayPal Subscriptions plays the month.** The twin is our stand-in for PayPal. It runs on a fast-forwarded clock, so a 75-day scenario plays in seconds (about 3 seconds on our machine with the demo bugs).
3. **AI plays the customers.** One pays on time, one's card starts failing, one opens a dispute. At each decision point Claude chooses what that customer does next: update the card, ignore it, cancel, dispute, or reply to the seller.
4. **The twin sends "bad weather."** Webhooks (the automatic messages PayPal sends to your app) arrive twice, late, out of order, or forged. Every message is signed like PayPal's.
5. **Six checks judge your app.** Did it verify signatures? Fulfil an order only once? Answer fast enough? End up in the right subscription state? Answer the dispute? Stay away from the live PayPal API?
6. **You get a report.** Each failure comes with a plain-language explanation of what went wrong and a suggested fix.

Everything is repeatable: the same seed gives the same shape and timing of events, and the AI's decisions are saved to a lock file so reruns match.

## The demo: Coffee Club

To prove it finds real bugs, we built a small coffee-subscription app, Coffee Club, using PayPal's official Node SDK. It has six switchable bugs, such as not verifying signatures, fulfilling twice on duplicates, and ignoring a suspended subscription.

Run the same 75-day month twice, changing nothing but the bugs:

- **Bugs on:** three of the six checks fail with the recorded Claude customers (signatures, double fulfilment, unanswered dispute), each with an explanation and a fix. With scripted customers a fourth fails (access state): the scripted customer keeps a failing card until he is suspended, and the app ignores the suspension. Claude's customer updated his card in time, so that bug was never triggered, which is a real difference an AI customer makes. A sixth bug, slow replies, would make another check fail but slows the run a lot, so the demo leaves it off.
- **Bugs off:** all six checks pass.

## How PayPal is used

- **A real run on the real PayPal sandbox.** `fastforward real` registers a real webhook and creates a real product, plan and card-funded subscription, then suspends it and carries out the customer's choice. PayPal's notices go to the app byte for byte, and when the app asks, real PayPal's verify-webhook-signature answers. In the recorded run, shown on the dashboard's Real PayPal page, 5 of 5 notices reached the app and PayPal answered SUCCESS on 5 of 5 signatures, including a genuine duplicate from PayPal's own resend. Sandbox delivery varies (10 to 54 seconds usually, once over 2 minutes), so the page and the video show a recording.
- **The twin implements PayPal's real API surface.** It is built from PayPal's official OpenAPI specifications: Subscriptions (products, plans, subscriptions), Disputes, and the webhook verification endpoint. Responses are checked against those specs.
- **The official SDK runs in the demo app.** Coffee Club uses `@paypal/paypal-server-sdk`, unmodified. A small add-on redirects its sandbox calls to the twin and blocks any call to live PayPal before a socket opens.
- **Webhooks are signed and verified the way PayPal does it.** The twin signs events, serves the certificate, and implements the verify-webhook-signature endpoint.
- **Passthrough to the real sandbox.** Calls the twin does not implement can be forwarded to the real PayPal sandbox. Only the sandbox host is allowed; live PayPal is refused.
- **A live fidelity check against the real PayPal sandbox.** We send the same requests to PayPal's sandbox and to the twin, and compare status, response shape and the official spec. The first run on the pending path found **27 differences** and the first run on the active path found **22**. We fixed them all: **all 17 steps now match** on status, shape and the official spec, including creating a subscription with a card (the sandbox activates it with no buyer), reading it, suspending, reactivating and cancelling it, and two refused actions. One difference is understood and recorded. The results are committed as `fidelity/latest.json` and shown on the dashboard's PayPal match page.

## How AI is used

Claude Opus 5.5 does three jobs:

1. **Writes scenarios.** From a plain description to a scenario file you can edit.
2. **Plays the customers.** At each decision point, a customer with a persona picks an action, in the twin and on the real sandbox. Decisions are saved so a rerun is identical.
3. **Explains failures.** For each failed check, it reads the trace and writes what went wrong and how to fix it.

Without an API key, Fastforward still runs: customers follow a scripted default and failures use template explanations. The deterministic checks, not the AI, decide pass or fail, so the AI cannot talk a bug into passing.

**The hosted demo replays one real recorded run.** The customer decisions and the failure explanations on the page were written once by Claude Opus 5.5 (a recording of 10 model calls, about 16 thousand tokens) and saved; the report labels them "Written by Claude" and says it is a replay. The page does not call a model while you look at it, so it costs nothing and cannot fail because of an API outage.

A coding-assistant server (MCP) lets an assistant such as Claude Code write a scenario, run it, and read the explanations, then fix the bug in your code and run it again.

## Built with

TypeScript (strict), Node 24, Fastify, zod, React and Vite, **AG Grid Community** (MIT) for the dashboard, Vitest, PayPal's official OpenAPI specs and Node SDK, Claude Opus 5.5 (Anthropic API).

**AG Grid.** The dashboard's deliveries table is an AG Grid: one row per notice, or per delivery attempt if you choose, sortable and filterable, with a colour and icon for each failed check. The fidelity panel (real sandbox against twin) is an AG Grid too. We use Community only.

## Honest known limits

- **The real run cannot do everything.** The sandbox cannot fail a renewal, so the declined card is simulated and labelled so; the suspension that follows is real. The sandbox API cannot open a dispute, so a customer who chooses one is reported, not played, and disputes run on the twin. Our real run covers one customer.
- **The real-sandbox comparison uses card-funded subscriptions** (US merchant, non-3DS test card), the only way to get an active subscription without a person approving it in a browser. Subscriptions approved with a PayPal wallet follow the same states but were not compared. Just after creation the sandbox lists no transactions yet, while the twin lists the payment at once; that difference is recorded. Remaining guesses are marked verified or unverified in `packages/twin/src/fidelity.ts`.
- **One timing is a guess.** PayPal's retry schedule (5 days, twice per cycle), how failures are counted and the suspension threshold are verified from its documentation and API spec. PayPal does not say whether the final failure suspends on its first attempt or only after that cycle's retries; we follow its worked example, and the sandbox has no clock to test it.
- **Bad weather is limited.** Reordering and bursts happen only among events at the same virtual instant, and events delayed past the end of the run are never delivered. Ids follow the scenario seed, so a rerun has the same shape, timing and ids (run ids and signature transmission ids are still random).
- **Scope is narrow.** Six checks, two example apps, subscriptions and disputes only. Other PayPal products are out of scope.
- **Market and price are unproven**, as stated above.

## Try it

Setup and run instructions are in the repository README. It is on npm (`npx fastforward-cli init`; `fastforward-register` and `fastforward-mcp` are the other two packages). Judges can use https://fastforward-production.up.railway.app/ or run it locally in three commands. The demo needs no PayPal login. To run your own AI scenarios, set `ANTHROPIC_API_KEY` in a `.env` file; without it, the scripted fallback runs. The hosted demo stays up until the judging period ends on 15 December 2026.

Repository: https://github.com/VinayG759/FastForward (MIT licence)
Video: [public YouTube URL]

---

## Checklist for Vinay (delete this section before pasting)

- [ ] Fill in the YouTube URL (GitHub and the hosted demo are done).
- [ ] Confirm `npm run demo` is merged before submitting; this text says it exists. The MCP server (Task 16) is merged.
- [ ] Confirm "three of six" matches the live page when you film (the recorded Claude customers give 3; scripted customers give 4; adding the slow-reply bug adds one more).
- [ ] Devpost "Tools used" field: Claude Opus 5.5, PayPal Subscriptions and Disputes APIs, PayPal Node SDK, AG Grid Community, Fastify, React, Vite.
- [ ] The $1 price and the 9% figure are labelled as a target and as unverified. Keep it that way if you edit.
- [ ] Rules: no third-party logos or copyrighted music in screenshots or the video. This text uses no logos. The concept screen in the video is labelled "Concept, not PayPal" and its source is in `concept/`.
