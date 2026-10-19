import type { CheckResult, Report, TraceEntry } from '@fastforward/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type RunInfo } from './api.js';
import type { FidelityFile } from './fidelity.js';
import { badMonth } from './fixtures/bad-month.js';
import { sampleFidelity } from './fixtures/fidelity.js';

export type Mode = 'loading' | 'live' | 'sample';

export interface RunState {
  mode: Mode;
  /** Why the sample run is showing, when it is. */
  note: string | null;
  info: RunInfo;
  start: string;
  trace: TraceEntry[];
  report: Report | null;
  fidelity: FidelityFile;
  fidelityIsSample: boolean;
  busy: boolean;
}

const DAY_MS = 86_400_000;

/** The sample run, cut at virtual time `now`, so scrubbing it behaves like a live run. */
function sampleAt(now: string): { trace: TraceEntry[]; report: Report } {
  const cut = Date.parse(now);
  const trace = badMonth.trace.filter((t) => Date.parse(t.at) <= cut);
  const checks: CheckResult[] = badMonth.report.checks.map((c) => {
    const findings = c.findings.filter((f) => Date.parse(f.at) <= cut);
    return { ...c, findings, status: findings.length > 0 ? 'fail' : 'pass' };
  });
  return {
    trace,
    report: {
      ...badMonth.report,
      checks,
      counts: {
        events: trace.filter((t) => t.kind === 'event').length,
        deliveries: trace.filter((t) => t.kind === 'delivery').length,
        customers: badMonth.subscriptions.length,
      },
    },
  };
}

const sampleInfo = (now: string): RunInfo => ({ runId: badMonth.runId, now, end: badMonth.end, subscriptions: badMonth.subscriptions });

export function useRun(): RunState & { moveTo: (iso: string) => void; moveBy: (days: number) => void; toEnd: () => void } {
  const runId = new URLSearchParams(window.location.search).get('run');
  const [state, setState] = useState<RunState>(() => ({
    mode: 'loading',
    note: null,
    info: sampleInfo(badMonth.end),
    start: badMonth.start,
    ...sampleAt(badMonth.end),
    fidelity: sampleFidelity,
    fidelityIsSample: true,
    busy: false,
  }));
  const live = useRef<{ id: string } | null>(null);

  const useSample = useCallback((note: string) => {
    live.current = null;
    setState((s) => ({ ...s, mode: 'sample', note, info: sampleInfo(badMonth.end), start: badMonth.start, ...sampleAt(badMonth.end) }));
  }, []);

  const refreshLive = useCallback(async (id: string) => {
    const [info, trace, report] = await Promise.all([api.info(id), api.trace(id), api.report(id)]);
    setState((s) => ({ ...s, mode: 'live', note: null, info, trace, report, start: trace[0]?.at ?? info.now }));
  }, []);

  // Pick live or sample once, on load.
  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    void api.fidelity().then((f) => {
      if (f && !cancelled) setState((s) => ({ ...s, fidelity: f, fidelityIsSample: false }));
    });
    if (!runId) {
      useSample('No run id in the address (add ?run=<id>), so this is a recorded sample run.');
      return () => {
        cancelled = true;
      };
    }
    refreshLive(runId)
      .then(() => {
        if (cancelled) return;
        live.current = { id: runId };
        let timer: ReturnType<typeof setTimeout> | undefined;
        // The twin replays the whole trace on connect and then sends each new entry. Appending would
        // double the history, so a stream message only says "something changed": refetch, debounced.
        const unsubscribe = api.stream(
          runId,
          () => {
            clearTimeout(timer);
            timer = setTimeout(() => void refreshLive(runId).catch(() => {}), 300);
          },
          () => {},
        );
        stop = () => {
          clearTimeout(timer);
          unsubscribe();
        };
      })
      .catch(() => {
        if (!cancelled) useSample(`Could not reach the twin for run ${runId}, so this is a recorded sample run.`);
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [runId, refreshLive, useSample]);

  const moveTo = useCallback(
    (iso: string) => {
      const l = live.current;
      if (!l) {
        setState((s) => ({ ...s, info: sampleInfo(iso), ...sampleAt(iso) }));
        return;
      }
      setState((s) => ({ ...s, busy: true }));
      api
        .advance(l.id, { to: iso })
        .then(() => refreshLive(l.id))
        .catch(() => {})
        .finally(() => setState((s) => ({ ...s, busy: false })));
    },
    [refreshLive],
  );

  const latest = useRef(state.info);
  latest.current = state.info;

  const moveBy = useCallback(
    (days: number) => {
      const { now, end } = latest.current;
      moveTo(new Date(Math.min(Date.parse(now) + days * DAY_MS, Date.parse(end))).toISOString());
    },
    [moveTo],
  );

  const toEnd = useCallback(() => moveTo(state.info.end), [moveTo, state.info.end]);

  return { ...state, moveTo, moveBy, toEnd };
}
