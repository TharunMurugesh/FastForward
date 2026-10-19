export const CHECK_IDS = ['ACK_FAST', 'VERIFIES_SIGNATURES', 'STATE_MATCHES', 'FULFIL_ONCE', 'DISPUTE_ANSWERED', 'NO_LIVE_CALLS'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface Finding {
  at: string;
  summary: string;
  eventIds: string[];
  explanation?: string;
  fix?: string;
}

export interface CheckResult {
  id: CheckId;
  status: 'pass' | 'fail' | 'skipped';
  findings: Finding[];
  note?: string;
}

export interface Report {
  runId: string;
  scenario: string;
  start: string;
  end: string;
  checks: CheckResult[];
  counts: { events: number; deliveries: number; customers: number };
}
