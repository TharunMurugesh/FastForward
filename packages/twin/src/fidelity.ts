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
