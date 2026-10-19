import type { CustomerDecision, WebhookEvent } from './events.js';

export type DisputeAction = 'provide-evidence' | 'accept-claim' | 'send-message' | 'make-offer';

/** One line of a run's history. Checks are pure functions of these. `at` is virtual time. */
export type TraceEntry =
  | { at: string; kind: 'event'; event: WebhookEvent; forged: boolean }
  | { at: string; kind: 'delivery'; eventId: string; attempt: number; status: number | null; ms: number; verifyCalled: boolean; transmissionId: string }
  | { at: string; kind: 'app_call'; method: string; path: string; status: number }
  | { at: string; kind: 'probe'; subscriptionId: string; access: boolean | null; fulfilments: number | null; expectedAccess: boolean; completedPayments: number }
  | { at: string; kind: 'dispute_action'; disputeId: string; action: DisputeAction }
  | { at: string; kind: 'live_call_blocked'; url: string }
  /** The app asked the twin to verify a delivery's signature (POST /v1/notifications/verify-webhook-signature). */
  | { at: string; kind: 'verify_call'; transmissionId: string; result: 'SUCCESS' | 'FAILURE' }
  /** The app downloaded the signing certificate, so it can verify offline (and may cache it). */
  | { at: string; kind: 'cert_fetch' }
  | { at: string; kind: 'customer_decision'; customer: string; decision: CustomerDecision };
