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
  /** A live run that has reached its end: its clock cannot move, so the controls replay it in the page instead. */
  complete: boolean;
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

/** A whole run held in the page: the recording, or a live run that has already reached its end. */
export interface WholeRun {
  runId: string;
  end: string;
  subscriptions: RunInfo['subscriptions'];
  trace: TraceEntry[];
  report: Report | null;
}

/**
 * The run as it stood at virtual time `now`, so scrubbing a finished run replays it without asking the twin:
 * later entries and findings are dropped, and a check counts as failed once its first finding has happened.
 */
export function cutAt(run: WholeRun, now: string): { info: RunInfo; trace: TraceEntry[]; report: Report | null } {
  const cut = Date.parse(now);
  const trace = run.trace.filter((t) => Date.parse(t.at) <= cut);
  const info = { runId: run.runId, now, end: run.end, subscriptions: run.subscriptions };
  if (!run.report) return { info, trace, report: null };
  const checks: CheckResult[] = run.report.checks.map((c) => {
    const findings = c.findings.filter((f) => Date.parse(f.at) <= cut);
    return { ...c, findings, status: c.status === 'skipped' ? 'skipped' : findings.length > 0 ? 'fail' : 'pass' };
  });
  return {
    info,
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

const wholeOf = (run: RecordedRun): WholeRun => ({ runId: run.runId, end: run.end, subscriptions: run.subscriptions, trace: run.trace, report: run.report });

export function useRun(): RunState & { moveTo: (iso: string) => void; moveBy: (days: number) => void; toEnd: () => void } {
  const runId = new URLSearchParams(window.location.search).get('run');
  const [state, setState] = useState<RunState>(() => ({
    mode: 'loading',
    note: null,
    ended: false,
    complete: false,
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
  // The whole run when it can be replayed in the page (the sample, or a finished live run), and the date shown.
  const whole = useRef<WholeRun | null>(null);
  const viewAt = useRef<string | null>(null);

  // The recording is a separate chunk: it is only downloaded when there is no live run to show.
  const useSample = useCallback(async (note: string, ended = false) => {
    live.current = null;
    const { badMonth } = await import('./fixtures/bad-month.js');
    whole.current = wholeOf(badMonth);
    viewAt.current = badMonth.end;
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
      start: badMonth.start,
      ...cutAt(wholeOf(badMonth), badMonth.end),
    }));
  }, []);

  const refreshLive = useCallback(async (id: string) => {
    const [info, trace, report] = await Promise.all([api.info(id), api.trace(id), api.report(id)]);
    const start = trace[0]?.at ?? info.now;
    const complete = Date.parse(info.now) >= Date.parse(info.end);
    if (!complete) {
      whole.current = null;
      setState((s) => ({ ...s, mode: 'live', note: null, complete, info, trace, report, start }));
      return;
    }
    // Finished: keep the whole run and show it at the date being looked at (the end, until someone scrubs).
    whole.current = { runId: info.runId, end: info.end, subscriptions: info.subscriptions, trace, report };
    const at = viewAt.current ?? info.end;
    setState((s) => ({ ...s, mode: 'live', note: null, complete, start, ...cutAt(whole.current!, at) }));
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
      const run = whole.current;
      // The sample and a finished live run replay in the page; only a live run in progress asks the twin to move.
      if (run) {
        viewAt.current = iso;
        setState((s) => ({ ...s, ...cutAt(run, iso) }));
        return;
      }
      if (!l) return;
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
