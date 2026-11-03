import type { Report, TraceEntry } from '@fastforward/contracts';
import type { FidelityFile } from './fidelity.js';
import type { RealRunFile } from './realRun.js';

/** What `GET /_ff/runs/:id` returns (spec section 9). */
export interface RunInfo {
  runId: string;
  now: string;
  end: string;
  subscriptions: { customer: string; subscriptionId: string }[];
}

export type AdvanceBody = { to: string } | { by: string };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.url} answered ${res.status}`);
  return (await res.json()) as T;
}

const run = (id: string) => `/_ff/runs/${encodeURIComponent(id)}`;

/** Thin client for the twin's control API. Paths are relative; the Vite proxy sends `/_ff` to the twin. */
export const api = {
  info: (id: string) => fetch(run(id)).then(json<RunInfo>),
  trace: (id: string) => fetch(`${run(id)}/trace`).then(json<TraceEntry[]>),
  /** The report only exists once checks can run; a 404 means "not yet". */
  async report(id: string): Promise<Report | null> {
    const res = await fetch(`${run(id)}/report`);
    return res.ok ? ((await res.json()) as Report) : null;
  },
  advance: (id: string, body: AdvanceBody) =>
    fetch(`${run(id)}/advance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((res) => {
      if (!res.ok) throw new Error(`advance answered ${res.status}`);
    }),
  /** Server-sent events: one `data:` line per TraceEntry. Returns an unsubscribe function. */
  stream(id: string, onEntry: (entry: TraceEntry) => void, onError: () => void): () => void {
    const source = new EventSource(`${run(id)}/stream`);
    source.onmessage = (e) => onEntry(JSON.parse(e.data as string) as TraceEntry);
    source.onerror = onError;
    return () => source.close();
  },
  /** Only when the demo was started on this machine with `npm run demo`: whether fresh runs can be started. */
  async local(): Promise<{ bugsOn: boolean } | null> {
    try {
      const res = await fetch('/_local');
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      return (await res.json()) as { bugsOn: boolean };
    } catch {
      return null;
    }
  },
  /** Plays a fresh month against the demo shop, with its planted bugs on or off. */
  async localRun(bugsOn: boolean): Promise<string> {
    const res = await fetch('/_local/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bugsOn }) });
    const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
    if (!res.ok || !body.runId) throw new Error(body.error ?? `the run failed (${res.status})`);
    return body.runId;
  },
  /** Committed evidence from `npm run fidelity`; null when the file has not been generated yet. */
  async fidelity(): Promise<FidelityFile | null> {
    try {
      const res = await fetch('/fidelity/latest.json');
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      return (await res.json()) as FidelityFile;
    } catch {
      return null;
    }
  },
  /** Committed recording from `fastforward real --report-dir fidelity`; null until one is recorded. */
  async realRun(): Promise<RealRunFile | null> {
    try {
      const res = await fetch('/fidelity/real-report.json');
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      return (await res.json()) as RealRunFile;
    } catch {
      return null;
    }
  },
};
