import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TraceEntry } from '@fastforward/contracts';
import { buildReport } from './checks/index.js';
import { applyExplanations, parseExplanations } from './explanations.js';
import type { RunRegistry } from './run/registry.js';
import type { Run } from './run/run.js';

const DAY_MS = 86_400_000;

/** The control API (spec §9), under /_ff. */
export function registerControlRoutes(app: FastifyInstance, registry: RunRegistry): void {
  const runOr404 = (id: string, reply: FastifyReply): Run | null => {
    const run = registry.get(id);
    if (!run) void reply.code(404).send({ error: `no run ${id}` });
    return run ?? null;
  };

  app.post('/_ff/runs', async (req, reply) => {
    if (registry.active()) {
      return reply.code(409).send({ error: 'a run is already active; finish it first' });
    }
    const scenario = (req.body as { scenario?: unknown } | undefined)?.scenario;
    if (typeof scenario !== 'object' || scenario === null) {
      return reply.code(400).send({ error: 'body must be {"scenario": {...}}' });
    }
    try {
      const run = await registry.create(scenario);
      return reply.code(201).send({ runId: run.id });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // The run the dashboard should open: the active one, else the latest finished one (still readable).
  app.get('/_ff/runs/current', async (_req, reply) => {
    const run = registry.active() ?? registry.latest();
    if (!run) return reply.code(404).send({ error: 'no run has been started' });
    return { runId: run.id, finished: run.finished };
  });

  app.get<{ Params: { id: string } }>('/_ff/runs/:id', async (req, reply) => {
    const run = runOr404(req.params.id, reply);
    if (!run) return reply;
    return {
      runId: run.id,
      start: run.scenario.start,
      now: run.now().toISOString(),
      end: run.end.toISOString(),
      finished: run.finished,
      subscriptions: run.subscriptions(),
    };
  });

  app.post<{ Params: { id: string } }>('/_ff/runs/:id/advance', async (req, reply) => {
    const run = runOr404(req.params.id, reply);
    if (!run) return reply;
    if (run.finished) return reply.code(409).send({ error: 'the run has finished' });
    const { to, by } = (req.body ?? {}) as { to?: unknown; by?: unknown };
    let target: Date;
    if (typeof to === 'string' && by === undefined && !Number.isNaN(Date.parse(to))) {
      target = new Date(to);
    } else if (typeof by === 'string' && to === undefined && /^P[1-9]\d*D$/.test(by)) {
      target = new Date(run.now().getTime() + Number(by.slice(1, -1)) * DAY_MS);
    } else {
      return reply.code(400).send({ error: 'body must be {"to": "<ISO timestamp>"} or {"by": "P<n>D"}' });
    }
    if (target.getTime() < run.now().getTime()) {
      return reply.code(400).send({ error: `cannot move back in time; the run is at ${run.now().toISOString()}` });
    }
    await run.advance(target);
    return { runId: run.id, now: run.now().toISOString() };
  });

  // The checks judge a whole run (a dispute whose deadline is still ahead is not "unanswered" yet), so
  // there is no report until the run has finished.
  app.get<{ Params: { id: string } }>('/_ff/runs/:id/report', async (req, reply) => {
    const run = runOr404(req.params.id, reply);
    if (!run) return reply;
    if (!run.finished) return reply.code(404).send({ error: 'the run has not finished; the report needs the whole run' });
    const report = buildReport({ runId: run.id, scenario: run.scenario, start: run.scenario.start, end: run.end.toISOString(), trace: run.trace });
    return run.explanations ? applyExplanations(report, run.explanations) : report;
  });

  // The command-line tool explains a run's failures (with the model, a saved recording or templates) and hands the words
  // back, so the dashboard's report shows them too. Replaces any earlier set.
  app.put<{ Params: { id: string } }>('/_ff/runs/:id/explanations', async (req, reply) => {
    const run = runOr404(req.params.id, reply);
    if (!run) return reply;
    const parsed = parseExplanations(req.body);
    if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
    run.explanations = parsed;
    return { stored: parsed.items.length };
  });

  app.get<{ Params: { id: string } }>('/_ff/runs/:id/trace', async (req, reply) => {
    const run = runOr404(req.params.id, reply);
    if (!run) return reply;
    return run.trace;
  });

  // Server-sent events: the trace so far, then each new entry as it happens; ends when the run finishes.
  app.get<{ Params: { id: string } }>('/_ff/runs/:id/stream', (req, reply) => {
    const run = runOr404(req.params.id, reply);
    if (!run) return reply;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = (t: TraceEntry) => res.write(`data: ${JSON.stringify(t)}\n\n`);
    for (const t of run.trace) write(t);
    if (run.finished) {
      res.end();
      return reply;
    }
    const offTrace = run.onTrace(write);
    const offFinish = run.onFinish(() => {
      offTrace();
      res.end();
    });
    req.raw.on('close', () => {
      offTrace();
      offFinish();
    });
    return reply;
  });

  app.post<{ Params: { id: string } }>('/_ff/runs/:id/finish', async (req, reply) => {
    const run = runOr404(req.params.id, reply);
    if (!run) return reply;
    await registry.finish(run);
    return { runId: run.id, now: run.now().toISOString(), end: run.end.toISOString() };
  });

  app.post('/_ff/live-call', async (req, reply) => {
    const run = registry.active();
    if (!run) return reply.code(404).send({ error: 'no active run' });
    const url = (req.body as { url?: unknown } | undefined)?.url;
    if (typeof url !== 'string') return reply.code(400).send({ error: 'body must be {"url": string}' });
    run.record({ at: run.now().toISOString(), kind: 'live_call_blocked', url });
    return reply.code(204).send();
  });
}
