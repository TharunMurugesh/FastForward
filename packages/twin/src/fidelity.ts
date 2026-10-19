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
  // - unverified: inferred from the docs example (the March 1 charge fails and "reaches the payment
  //   failure threshold. The subscription is suspended." with no retries mentioned). When a failed
  //   attempt would reach payment_failure_threshold, the twin suspends at once instead of retrying.
  // - unverified: the docs say a failure is "counted" once the second retry fails, but never name
  //   failed_payments_count. The twin raises failed_payments_count and outstanding_balance once per
  //   cycle, when retries are exhausted. Each failed attempt still emits
  //   BILLING.SUBSCRIPTION.PAYMENT.FAILED (the docs are silent on the webhook).
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
