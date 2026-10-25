import type { CheckResult, Report, TraceEntry } from '@fastforward/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type RunInfo } from './api.js';
import type { FidelityFile } from './fidelity.js';
import type { RecordedRun } from './fixtures/bad-month.js';
import { sampleFidelity } from './fixtures/fidelity.js';

export type Mode = 'loading' | 'live' | 'sample';

export interface RunState {
  mode: Mode;
  /** Why the sample run is showing, when it is. */
  note: string | null;
  /** The address named a run the twin no longer has (it restarted since). */
  ended: boolean;
  /** Which recording the sample is, when it is showing. */
  sample: { scenario: string; recordedAt: string; bugs: string[] } | null;
  info: RunInfo;
  start: string;
  trace: TraceEntry[];
  report: Report | null;
  fidelity: FidelityFile;
  fidelityIsSample: boolean;
  busy: boolean;
}

const DAY_MS = 86_400_000;
const EPOCH = '1970-01-01T00:00:00.000Z';
/** How long the first load may take before the page stops waiting and shows the sample instead. */
const LOAD_LIMIT_MS = 10_000;

/** The recorded run, cut at virtual time `now`, so scrubbing it behaves like a live run. */
function sampleAt(run: RecordedRun, now: string): { trace: TraceEntry[]; report: Report } {
  const cut = Date.parse(now);
  const trace = run.trace.filter((t) => Date.parse(t.at) <= cut);
  const checks: CheckResult[] = run.report.checks.map((c) => {
    const findings = c.findings.filter((f) => Date.parse(f.at) <= cut);
    return { ...c, findings, status: findings.length > 0 ? 'fail' : 'pass' };
  });
  return {
    trace,
    report: {
      ...run.report,
      checks,
      counts: {
        events: trace.filter((t) => t.kind === 'event').length,
        deliveries: trace.filter((t) => t.kind === 'delivery').length,
        customers: run.subscriptions.length,
      },
    },
  };
}

const sampleInfo = (run: RecordedRun, now: string): RunInfo => ({ runId: run.runId, now, end: run.end, subscriptions: run.subscriptions });

export function useRun(): RunState & { moveTo: (iso: string) => void; moveBy: (days: number) => void; toEnd: () => void } {
  const runId = new URLSearchParams(window.location.search).get('run');
  const [state, setState] = useState<RunState>(() => ({
    mode: 'loading',
    note: null,
    ended: false,
    sample: null,
    info: { runId: '', now: EPOCH, end: EPOCH, subscriptions: [] },
    start: EPOCH,
    trace: [],
    report: null,
    fidelity: sampleFidelity,
    fidelityIsSample: true,
    busy: false,
  }));
  const live = useRef<{ id: string } | null>(null);
  const recording = useRef<RecordedRun | null>(null);

  // The recording is a separate chunk: it is only downloaded when there is no live run to show.
  const useSample = useCallback(async (note: string, ended = false) => {
    live.current = null;
    const { badMonth } = await import('./fixtures/bad-month.js');
    recording.current = badMonth;
    setState((s) => ({
      ...s,
      mode: 'sample',
      note,
      ended,
      sample: {
        scenario: badMonth.scenario,
        recordedAt: badMonth.recordedAt,
        bugs: badMonth.recipe.coffeeBugs === 'all' ? ['no-verify', 'no-dedupe', 'slow-ack', 'ignores-suspend', 'ignores-disputes', 'trusts-event-order'] : badMonth.recipe.coffeeBugs.split(','),
      },
      info: sampleInfo(badMonth, badMonth.end),
      start: badMonth.start,
      ...sampleAt(badMonth, badMonth.end),
    }));
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
      void useSample('No run id in the address (add ?run=<id>).');
      return () => {
        cancelled = true;
      };
    }
    // A twin that never answers must not leave the page loading forever.
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const tooSlow = new Promise<never>((_, reject) => {
      giveUp = setTimeout(() => reject(new Error('no answer')), LOAD_LIMIT_MS);
    });
    Promise.race([refreshLive(runId), tooSlow])
      .finally(() => clearTimeout(giveUp))
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
      .catch((e: unknown) => {
        if (cancelled) return;
        // The twin keeps runs in memory, so a link to a run from before a restart answers 404: that run has ended.
        const gone = e instanceof Error && / answered 404$/.test(e.message);
        void useSample(gone ? `Run ${runId} has ended: runs are kept until the twin restarts, and the hosted demo restarts after each update.` : `Could not reach the twin for run ${runId}.`, gone);
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [runId, refreshLive, useSample]);

  const moveTo = useCallback(
    (iso: string) => {
      const l = live.current;
      const rec = recording.current;
      if (!l) {
        if (rec) setState((s) => ({ ...s, info: sampleInfo(rec, iso), ...sampleAt(rec, iso) }));
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
