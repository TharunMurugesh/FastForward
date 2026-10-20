# Fastforward, explained from scratch (one page)

20 Oct 2026. Read it once, then retell it in your own words.

## 1. The problem, in a shop

Imagine you run a coffee subscription: customers pay every month. You wrote code
that handles the money side. PayPal tells your code what happened by sending
**webhooks**: small automatic messages like "payment failed" or "customer opened
a dispute". Think of a webhook as a delivery driver knocking on your door.

Real life is messy. The driver sometimes comes twice (a duplicate), comes late
(hours), comes in the wrong order, or never comes. Customers cancel, get
suspended after failed payments, or file disputes.

Here is the trouble. PayPal's test area (the **sandbox**) cannot show you any of
this. It has no clock, so you cannot skip ahead one month. It has no
misbehaving customers. A developer therefore ships code that works on a good day
and meets the bad days for the first time with real money.

## 2. What Fastforward is

A **flight simulator for PayPal payments**. A pilot trains for engine failure in
a simulator, so the first failure never happens with passengers on board.

You describe a scenario in plain words, like "a bad month". Then:
1. A copy of PayPal's subscriptions (the **twin**) plays that month in a few seconds of real time,
   using a fast-forwarded clock.
2. AI plays the customers: one pays, one complains, one disputes.
3. The twin also behaves badly on purpose (the "bad weather"): duplicate
   messages, late ones, out of order.
4. You get a report: what your app handled, and what it missed (6 checks).

Proof it is faithful: we compared the twin against PayPal's real sandbox. It had
27 differences at first. We fixed them all, and now 7 of 7 endpoints match.

## 3. Who pays, how much, why now

- **Who pays:** small teams and developers whose app takes PayPal subscriptions.
  Their cost of a missed failed payment is real money, because failed payments
  are a large part of lost subscription revenue (vendor figures: about 9% of
  monthly recurring revenue; unverified).
- **How much (my proposal, not yet tested with anyone):** free for one developer
  locally; a team plan at about $39 per developer per month. Similar tools
  charge that: LocalStack (an AWS simulator) $39 to $89 per developer per month,
  and it has raised about $25M, which shows simulators can be a business.
  Hookdeck (webhook tooling) is about $39 per month.
- **Why now:** PayPal has no test clock. Stripe has one but only for billing,
  with no AI customers. Chargebee has a "Time Machine" only for its own
  billing. Nobody offers this for PayPal.
- **Path to scale:** PayPal first, then other processors. The same idea works
  everywhere, hence "flight simulator for payments".

## 4. What we do differently from the others

| Existing | What it does | What it lacks |
|---|---|---|
| PayPal webhook simulator | single fake events | no time, not signed properly, no customers |
| brandon-makes/paypal-webhook-simulator | offline fake events | no AI, no time |
| Stripe test clocks | skips time for Stripe billing | not PayPal, no AI customers |
| LocalStack, emulate.dev | simulate other clouds and services | no PayPal, no clock |

## 5. The honest weak points (say them before a judge does)

- **Market size is unproven.** Nobody publishes how many teams use PayPal
  subscriptions directly. Our answer: first paying customer is a small
  subscription business, and we will ask real PayPal developers to try it.
- **Prices are my guess.** No one has been asked to pay yet.
- **Coverage is partial.** The live comparison covers the pending-approval path,
  not fully approved subscriptions. Say so plainly; it builds trust.

## 6. Your teach-back (reply with answers in your own words, short is fine)

1. What problem does Fastforward solve, in one sentence, for a stranger?
2. What is a webhook, using the delivery driver idea or your own?
3. What does the AI do, and what does the twin do? (They are different jobs.)
4. Who pays, how much, and why would they pay now?
5. Why is "we compared it to the real sandbox" our strongest line?
