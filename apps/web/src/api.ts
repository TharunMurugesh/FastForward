import type { Report, TraceEntry } from '@fastforward/contracts';
import type { FidelityFile } from './fidelity.js';

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
};
