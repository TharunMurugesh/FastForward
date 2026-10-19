import type { CheckId } from '@fastforward/contracts';

export const SCENARIO_SYSTEM = `You write test scenarios for Fastforward, a tool that simulates PayPal subscriptions against a developer's app.
Turn the user's plain-English description into ONE scenario as YAML. Reply with the YAML only: no prose, no markdown fences.

Fields:
- name (short, kebab-case), seed (integer), start (ISO instant, e.g. 2026-11-01T00:00:00.000Z), duration (P<days>D, e.g. P60D)
- app: webhookUrl (required), subscribeUrl, probeUrl. Unless the description says otherwise use http://127.0.0.1:3000/webhooks/paypal, http://127.0.0.1:3000/subscribe and http://127.0.0.1:3000/__ff/probe.
- plan: name, price (quoted decimal string), currency (3 letters), interval (DAY|WEEK|MONTH|YEAR), optional trialDays, totalCycles (0 = until cancelled), paymentFailureThreshold
- customers: list of {name, persona (one sentence), card, actions}. card is "ok" or "fails_from:YYYY-MM-DD" (the card starts declining on that date). actions are optional: {at: YYYY-MM-DD, do: cancel}, {at, do: update_card} or {at, do: dispute, reason, message}.
  reason is one of MERCHANDISE_OR_SERVICE_NOT_RECEIVED, MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED, UNAUTHORISED, CREDIT_NOT_PROCESSED, DUPLICATE_TRANSACTION, INCORRECT_AMOUNT, PAYMENT_BY_OTHER_MEANS, CANCELED_RECURRING_BILLING, PROBLEM_WITH_REMITTANCE, OTHER.
- weather (how badly PayPal's webhooks misbehave): duplicates and reorder are chances from 0 to 1, delayMinutes is [min, max], forged is a count of fake notices, burst is true or false. Leave weather out for calm conditions.
- expect: accessWhile, the subscription statuses during which customers should have access (default [ACTIVE]).

Use start dates in the near future, keep customer counts small unless asked, and invent nothing the description did not ask for beyond sensible defaults.

Example of a valid scenario:
name: bad-month
seed: 42
start: 2026-11-01T00:00:00.000Z
duration: P60D
app:
  webhookUrl: http://127.0.0.1:3000/webhooks/paypal
  subscribeUrl: http://127.0.0.1:3000/subscribe
  probeUrl: http://127.0.0.1:3000/__ff/probe
plan:
  name: Coffee Club Monthly
  price: "12.00"
  currency: USD
  interval: MONTH
customers:
  - name: Maya
    persona: Pays on time and never complains.
    card: ok
  - name: Leo
    persona: Busy, rarely reads email, card expires in December.
    card: fails_from:2026-12-01
  - name: Ana
    persona: Impatient; says her first bag never arrived.
    card: ok
    actions:
      - at: 2026-11-20
        do: dispute
        reason: MERCHANDISE_OR_SERVICE_NOT_RECEIVED
        message: My first bag of coffee never arrived.
weather:
  duplicates: 0.2
  reorder: 0.1
  delayMinutes: [0, 90]
  forged: 1
  burst: false`;

export const CUSTOMER_SYSTEM = `You play one customer of a subscription business inside a payment simulation. Stay in character as described by the persona.
You are told what just happened and must choose ONE reaction. Reply with a JSON object of exactly one of these shapes:
{"action": "update_card"}   you fix your payment card
{"action": "ignore"}        you do nothing
{"action": "cancel"}        you cancel the subscription
{"action": "dispute", "reason": "<PayPal dispute reason>", "message": "<what you tell PayPal>"}
{"action": "reply", "message": "<your reply to the seller>"}   only when the seller has messaged you in a dispute
Dispute reasons: MERCHANDISE_OR_SERVICE_NOT_RECEIVED, MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED, UNAUTHORISED, CREDIT_NOT_PROCESSED, DUPLICATE_TRANSACTION, INCORRECT_AMOUNT, PAYMENT_BY_OTHER_MEANS, CANCELED_RECURRING_BILLING, PROBLEM_WITH_REMITTANCE, OTHER.
Choose what this person would realistically do, not what is best for the business.`;

export const NARRATOR_SYSTEM = `You explain billing bugs to a developer who is good at code but not an expert in payments.
You are given one failed check, the finding, and an excerpt of the run trace (what PayPal's simulator sent and how the developer's app answered).
Reply with a JSON object {"explanation": "...", "fix": "..."}.
- explanation: 2 or 3 plain sentences saying what happened, in terms of this trace, and why it costs the business money or trust.
- fix: 1 or 2 sentences naming the concrete change to make in the app.
Use only facts from the input. Do not invent event ids, amounts or dates. No jargon without a few words explaining it.`;

export const CHECK_DESCRIPTIONS: Record<CheckId, string> = {
  ACK_FAST: 'The app must answer every webhook delivery with a 2xx status within 10 seconds.',
  VERIFIES_SIGNATURES: 'The app must verify that each webhook really came from PayPal before acting on it.',
  STATE_MATCHES: "The app's idea of whether a customer has access must match the subscription's true status.",
  FULFIL_ONCE: 'The app must fulfil each completed payment exactly once, even if the notice arrives twice.',
  DISPUTE_ANSWERED: 'The app must answer every customer dispute before its due date.',
  NO_LIVE_CALLS: 'The app must never reach live PayPal during a simulated run.',
};

/** Offline narration, used when there is no AI or it fails. */
export const TEMPLATES: Record<CheckId, { explanation: string; fix: string }> = {
  ACK_FAST: {
    explanation:
      'PayPal sent a notice and your app either took too long to answer or answered with an error. PayPal counts that as a failed delivery and sends the notice again later, so one slow answer turns into repeats.',
    fix: 'Answer with a 200 straight away and do the real work after replying, for example from a queue.',
  },
  VERIFIES_SIGNATURES: {
    explanation:
      'Your app acted on a notice without checking that PayPal really sent it. Anyone who finds your webhook address could send a fake "payment completed" or "cancelled" and your app would believe it.',
    fix: "Call PayPal's verify-webhook-signature endpoint before trusting a notice, and reject it unless the answer is SUCCESS.",
  },
  STATE_MATCHES: {
    explanation:
      "Your app's idea of whether this customer has access disagreed with the subscription's real status at PayPal. Usually the app ignored a suspend or cancel notice, or handled notices out of order.",
    fix: 'Set access from the subscription status every time a notice arrives, and handle suspended, cancelled and expired as well as activated.',
  },
  FULFIL_ONCE: {
    explanation:
      'PayPal sent the same notice twice and your app treated it as two payments, so the customer got the product twice for one charge. PayPal may deliver a notice more than once, by design.',
    fix: 'Remember the id of every notice you have handled and ignore any id you have seen before.',
  },
  DISPUTE_ANSWERED: {
    explanation:
      'A customer opened a dispute and your app did not respond before the due date. When the seller stays silent PayPal decides in the buyer\'s favour and you lose the money.',
    fix: 'When a dispute-created notice arrives, send your evidence (for example tracking details) through the disputes API, or alert a person before the due date.',
  },
  NO_LIVE_CALLS: {
    explanation:
      'Your app tried to reach real (live) PayPal during a simulated run. Fastforward blocked the call, but in production it would have touched real money or data.',
    fix: 'Read the PayPal address and credentials from configuration so test runs can only reach the sandbox.',
  },
};
