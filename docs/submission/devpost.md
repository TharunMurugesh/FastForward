# Fastforward: Devpost submission text

Paste each section below into the matching Devpost field. Items in [square brackets] are filled in by Vinay
before submitting (see the checklist at the bottom).

## Tagline (one line)

A flight simulator for PayPal subscriptions: skip a month ahead, let AI customers misbehave, and find your billing bugs before real money does.

## Who pays, how much, and why now

**The customer.** A developer or small team whose app takes recurring payments through PayPal Subscriptions.

**The pain, in money.** The code that handles a failed payment, a duplicate webhook, a suspended subscription or a dispute is first run with real money, because PayPal's sandbox cannot test it. It has no clock, so you cannot skip to next month's renewal, and it has no misbehaving customers. Get one of these wrong and you either keep serving people who stopped paying, or cut off people who would have paid. Vendors report that failed payments drive a large share of subscription revenue loss (about 9% of monthly recurring revenue is a figure vendors quote; we have not verified it, so treat it as indicative).

**The price (a target, not revenue).** Free for one developer, running locally. A team plan at a target of **$39 per developer per month**. This is a proposed price, in line with similar developer tools: LocalStack (an AWS simulator) charges $39 to $89 per developer per month, and Hookdeck (webhook tooling) is about $39 per month. No one has been asked to pay yet, and Fastforward has no revenue today.

**Why now.** PayPal has no test clock. Stripe has test clocks, but only for Stripe billing and with no AI customers. Chargebee has a "Time Machine" only for its own billing. We found nothing that gives PayPal Subscriptions this.

**First customers.** PayPal developers who try it before the deadline, starting with other hackathon entrants. We will ask them what it caught and whether they would pay.

**What we do not know.** The size of the market is unproven. Nobody publishes how many teams use PayPal Subscriptions directly. The path to scale is PayPal first, then other processors, because the same idea works anywhere.

## What it does

You describe a scenario in plain words, such as "a bad month for a coffee subscription." Then:

1. **A twin of PayPal Subscriptions plays the month.** The twin is our stand-in for PayPal. It runs on a fast-forwarded clock, so a 75-day scenario plays in seconds (about 3 seconds on our machine with the demo bugs).
2. **AI plays the customers.** One pays on time, one's card starts failing, one opens a dispute. At each decision point Claude chooses what that customer does next: update the card, ignore it, cancel, dispute, or reply to the seller.
3. **The twin sends "bad weather."** Webhooks (the automatic messages PayPal sends to your app) arrive twice, late, out of order, or forged. Every message is signed like PayPal's.
4. **Six checks judge your app.** Did it verify signatures? Fulfil an order only once? Answer fast enough? End up in the right subscription state? Answer the dispute? Stay away from the live PayPal API?
5. **You get a report.** Each failure comes with a plain-language explanation of what went wrong and a suggested fix.

Everything is repeatable: the same seed gives the same shape and timing of events, and the AI's decisions are saved to a lock file so reruns match.

## The demo: Coffee Club

To prove it finds real bugs, we built a small coffee-subscription app, Coffee Club, using PayPal's official Node SDK. It has six switchable bugs, such as not verifying signatures, fulfilling twice on duplicates, and ignoring a suspended subscription.

Run the same 75-day month twice, changing nothing but the bugs:

- **Bugs on:** four of the six checks fail (signatures, access state, double fulfilment, unanswered dispute), each with an explanation and a fix. A sixth bug, slow replies, makes a fifth check fail but slows the run a lot, so the demo leaves it off.
- **Bugs off:** all six checks pass.

## How PayPal is used

- **The twin implements PayPal's real API surface.** It is built from PayPal's official OpenAPI specifications: Subscriptions (products, plans, subscriptions), Disputes, and the webhook verification endpoint. Responses are checked against those specs.
- **The official SDK runs in the demo app.** Coffee Club uses `@paypal/paypal-server-sdk`, unmodified. A small add-on redirects its sandbox calls to the twin and blocks any call to live PayPal before a socket opens.
- **Webhooks are signed and verified the way PayPal does it.** The twin signs events, serves the certificate, and implements the verify-webhook-signature endpoint.
- **Passthrough to the real sandbox.** Calls the twin does not implement can be forwarded to the real PayPal sandbox. Only the sandbox host is allowed; live PayPal is refused.
- **A live fidelity check against the real PayPal sandbox.** We send the same requests to PayPal's sandbox and to the twin, and compare status, response shape and the official spec. The first run found **27 differences**. We fixed them. After three runs the result is **0 differences: 7 of 7 endpoints match.** The results are committed as `fidelity/latest.json` and shown in the dashboard as "Checked against the real PayPal sandbox."

## How AI is used

Claude Opus 5.5 does three jobs:

1. **Writes scenarios.** From a plain description to a scenario file you can edit.
2. **Plays the customers.** At each decision point, a customer with a persona picks an action. Decisions are saved so a rerun is identical.
3. **Explains failures.** For each failed check, it reads the trace and writes what went wrong and how to fix it.

Without an API key, Fastforward still runs: customers follow a scripted default and failures use template explanations. The deterministic checks, not the AI, decide pass or fail, so the AI cannot talk a bug into passing.

A coding-assistant server (MCP) lets an assistant such as Claude Code write a scenario, run it, and read the explanations, then fix the bug in your code and run it again.

## Built with

TypeScript (strict), Node 24, Fastify, zod, React and Vite, **AG Grid Community** (MIT) for the dashboard, Vitest, PayPal's official OpenAPI specs and Node SDK, Claude Opus 5.5 (Anthropic API).

**AG Grid.** The dashboard's deliveries table is an AG Grid: one row per delivery attempt, sortable and filterable, with failing checks highlighted. The fidelity panel (real sandbox against twin) is an AG Grid too. We use Community only.

## Honest known limits

- **The fidelity check covers the pending-approval path.** Subscriptions that are approved and active need a buyer's approval in the sandbox, so we do not compare those. Remaining guesses are marked verified or unverified in `packages/twin/src/fidelity.ts`.
- **One rule is inferred.** PayPal's retry schedule for failed payments (5 days, twice per cycle) is verified from its documentation. Suspending a subscription at once when it reaches the failure threshold is inferred and marked unverified.
- **Bad weather is limited.** Reordering and bursts happen only among events at the same virtual instant, and events delayed past the end of the run are never delivered. Event ids are random, so a rerun has the same shape and timing but not the same ids.
- **Scope is narrow.** Six checks, one example app, subscriptions and disputes only. Other PayPal products are out of scope.
- **Market and price are unproven**, as stated above.

## Try it

Setup and run instructions are in the repository README. Judges can use https://fastforward-production.up.railway.app/ or run it locally in three commands. The demo needs no PayPal login. To run your own AI scenarios, set `ANTHROPIC_API_KEY` in a `.env` file; without it, the scripted fallback runs. The hosted demo stays up until the judging period ends on 15 December 2026.

Repository: https://github.com/VinayG759/FastForward (MIT licence)
Video: [public YouTube URL]

---

## Checklist for Vinay (delete this section before pasting)

- [ ] Fill in the one bracketed link: the YouTube URL (GitHub and the hosted demo are done).
- [ ] Confirm `npm run demo` is merged before submitting; this text says it exists. The MCP server (Task 16) is merged.
- [ ] Confirm "four of six" matches your final run (the demo bug set gave 4 failing checks when Sara ran it live on 20 Oct; adding the slow-reply bug gives 5).
- [ ] Devpost "Tools used" field: Claude Opus 5.5, PayPal Subscriptions and Disputes APIs, PayPal Node SDK, AG Grid Community, Fastify, React, Vite.
- [ ] The $39 price and the 9% figure are labelled as a target and as unverified. Keep it that way if you edit.
- [ ] Rules: no third-party logos or copyrighted music in screenshots or the video. This text uses no logos.
