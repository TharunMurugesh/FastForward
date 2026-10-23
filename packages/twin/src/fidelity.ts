/**
 * Every PayPal behaviour the twin copies from the real service, in one place. Each value says where
 * it came from: `verified <date>` means observed or read from PayPal's own pages on that date,
 * `unverified: <source>` means a best guess the fidelity suite should confirm.
 */
export const fidelity = {
  // verified 2026-10-19: developer.paypal.com/docs/subscriptions/customize/payment-failure-retry
  // ("PayPal retries the payment every 5 days ... up to twice per billing cycle").
  retryIntervalDays: 5,
  // verified 2026-10-19: same page as retryIntervalDays.
  maxRetries: 2,
  // Rules built on the two values above, implemented in subscriptions/engine.ts (no values to tune):
  // - verified 2026-10-23 (the same docs page, "Last updated: October 14, 2026", plus the official OpenAPI spec in
  //   packages/twin/spec): a failure is "counted" only once the second retry fails; failed_payments_count is "the
  //   number of consecutive payment failures" and "If this reaches the payment_failure_threshold value, the
  //   subscription updates to the SUSPENDED state"; threshold 2 means two consecutive failed payments suspend.
  //   The twin raises failed_payments_count and outstanding_balance once per cycle, when retries are exhausted.
  // - unverified (the one open point): WHEN the final failure suspends. The docs' worked example says the March 1
  //   charge fails, "reaches the payment failure threshold. The subscription is suspended.", and lists no March
  //   retries, so the twin suspends on the first failed attempt of that cycle instead of retrying. Read the other
  //   way (retries on 5 and 10 March, then suspend) it would be March 10. PayPal never says, and the sandbox cannot
  //   settle it (it has no clock). Changing it would move every suspension date in a run by up to 10 days.
  // - unverified: each failed attempt emits BILLING.SUBSCRIPTION.PAYMENT.FAILED (the docs are silent on webhooks).
  // Dispute rules below, implemented in disputes/engine.ts (no values to tune), all unverified:
  // - unverified: after the seller provides evidence the dispute is UNDER_REVIEW (status enum in
  //   customer_disputes_v1.json; PayPal publishes no transition table) and it stays there; the twin never rules
  //   for the seller.
  // - unverified: after the seller sends a message or makes an offer the dispute is WAITING_FOR_BUYER_RESPONSE
  //   (same source), and a buyer reply returns it to WAITING_FOR_SELLER_RESPONSE.
  // - unverified: a dispute the seller never touches is resolved in the buyer's favour at the due date
  //   (design spec section 6: our assumption, not checked against PayPal's docs).
  // Shapes copied from the first live fidelity run (2026-10-19, PayPal sandbox), all in subscriptions/resources.ts:
  // - verified: a subscription waiting for approval has no billing_info, plan, shipping_amount or update_time, and GET
  //   also has no status_update_time; the plan only comes with ?fields=plan (PayPal's documented query).
  // - unverified: the subscription POST response has subscriber {tenant: 'paypal'} when the request has no subscriber
  //   (the run saw a tenant field, not its value); GET while APPROVAL_PENDING leaves subscriber out (verified).
  // - cancelling an APPROVAL_PENDING subscription answers 404 with name RESOURCE_NOT_FOUND (verified by absence: the
  //   second live run showed no mismatch for the name).
  // - verified 2026-10-19 (live fidelity run): the error name for a malformed verify-webhook-signature body is
  //   INVALID_REQUEST, and its details[] have no description. Error links carry a method.
  // - unverified: verify-webhook-signature answers 400 INVALID_REQUEST when transmission_id is not a UUID, the
  //   signature is not base64, the time is not ISO-8601, cert_url is not a URL or a field is missing (the run saw 400
  //   for its invalid body without saying which field). A well-formed wrong signature answers 200 FAILURE.
  // - verified: the disputes list always has `items`, empty when there are none.
  // verified 2026-10-03: sandbox dispute created with seller_response_due_date = create time + 20 days.
  disputeResponseDays: 20,
  // unverified: Hookdeck PayPal webhook guide (10 s acknowledge window); PayPal publishes no number.
  deliveryTimeoutMs: 10000,
  // unverified: Hookdeck PayPal webhook guide (first retry after about a minute).
  deliveryFirstRetryMinutes: 1,
  // unverified: Hookdeck PayPal webhook guide (up to 25 attempts).
  deliveryMaxAttempts: 25,
  // unverified: Hookdeck PayPal webhook guide (retries stop after 3 days).
  deliveryWindowDays: 3,
} as const;
