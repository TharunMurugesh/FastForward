# Approved subscriptions: how far can we compare with the real sandbox?

Findings for plan item F1, 23 Oct 2026. Research only: nothing here was built or run against PayPal.

## The gap

The live comparison (`fidelity/latest.json`, 7 of 7 endpoints match) only ever sees a subscription in
`APPROVAL_PENDING`, because a subscription becomes `ACTIVE` only after a buyer logs in to PayPal and approves it.
So these parts of the twin are **never compared with the real sandbox**: the `GET` shape of an active subscription
(`billing_info`, `last_payment`, `next_billing_time`, `cycle_executions`), `suspend`, `activate`, `cancel` on an
active subscription, `capture`, and `GET .../transactions`. They are built from PayPal's OpenAPI spec and docs, which
is why they are validated against the spec but not against real behaviour.

## What the research found

- **No documented API way to approve a subscription.** PayPal's guides all send the buyer to the `approve` link and a
  sandbox buyer logs in. Nothing says a server can do it.
- **Card route, possible but narrow.** The official spec says a subscription can be created from a card only for
  "non-3DS cards and for merchants in US and AU regions", and only after signing up for PayPal's card product. Our
  own earlier test found the default US business sandbox account cannot take direct card payments
  (`PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING`), so this probably fails. Unconfirmed: nobody documents the resulting
  status in the sandbox.
- **Browser automation is the usual workaround,** and is described as flaky: slower sandbox pages, rate limits and
  login problems with sandbox buyer accounts.

## Options

| | What it is | Gets us | Cost and risk |
|---|---|---|---|
| **A. Card probe** | One scripted request: create a subscription with a test card as the payment source and see which status comes back. | If it returns an active status, a fully automatic comparison with no browser. | About 30 minutes. Likely to fail (see above); we learn that in one run. Needs your sandbox keys. |
| **B. One recorded real subscription (recommended)** | A script creates a plan and subscription, prints the approve link, **you approve it once** in an incognito window with your sandbox buyer, then the script records the real responses for the active steps (`GET`, `transactions`, `suspend`, `activate`, `cancel`) as shapes and statuses only. A new offline test compares the twin with that recording. | Real evidence for every endpoint in the gap, repeatable in CI without keys, same format and privacy rules as `latest.json` (no values, no tokens). | About half a day of work, plus 5 minutes of yours. The recording is a snapshot: it goes stale if PayPal changes, so it needs a manual re-record now and then. Sandbox only. |
| **C. Browser automation** | A headless browser logs in to the sandbox buyer account and approves by itself. | A fully automatic comparison. | Heavy (a browser dependency), flaky, can trip rate limits or lock the sandbox account, needs the buyer password stored in `.env`. Adds little over B. Not recommended. |

## Recommendation

Do **B**, and run **A first** as a 30-minute probe, because if A works B becomes unnecessary. If A fails, we have
lost 30 minutes and gained a documented reason. Skip C.

Whatever we choose, the README keeps saying plainly which paths are compared with the real sandbox and which are
only checked against the spec. After B, that sentence shrinks to "recorded once, on 2026-MM-DD".

## What I need from Vinay

- A yes on A, B, both or neither.
- For A and B: a live run against his sandbox (his keys in `.env`; one product, one plan, one or two subscriptions are
  created and left there, as in the earlier runs). For B: 5 minutes to approve one subscription as the sandbox buyer.
- Nothing is run until he says so.
