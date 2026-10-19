import type { FastifyInstance } from 'fastify';
import type { TraceEntry } from '@fastforward/contracts';
import { randomBytes } from 'node:crypto';

/**
 * The part of a run that the control routes need. Task 9 replaces the stub registry with the real
 * `Run` class, which implements this interface.
 */
export interface Run {
  id: string;
  trace: TraceEntry[];
  /** Virtual time. */
  now(): Date;
}

/** One active run per twin. Task 9 supplies the real implementation. */
export interface RunRegistry {
  active(): Run | null;
  /** Starts a run from a scenario body, or throws an Error with a message fit to show the caller. */
  create(scenario: unknown): Promise<Run>;
}

/** Placeholder until Task 9: a run that only holds a trace and a frozen virtual clock at the scenario start. */
export function createStubRegistry(): RunRegistry {
  let current: Run | null = null;
  return {
    active: () => current,
    async create(scenario) {
      const start = (scenario as { start?: unknown } | null)?.start;
      if (typeof start !== 'string' || Number.isNaN(Date.parse(start))) throw new Error('scenario.start must be an ISO-8601 timestamp');
      const at = new Date(start);
      current = { id: `run-${randomBytes(4).toString('hex')}`, trace: [], now: () => at };
      return current;
    },
  };
}

export function registerControlRoutes(app: FastifyInstance, registry: RunRegistry): void {
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

  app.post('/_ff/live-call', async (req, reply) => {
    const run = registry.active();
    if (!run) return reply.code(404).send({ error: 'no active run' });
    const url = (req.body as { url?: unknown } | undefined)?.url;
    if (typeof url !== 'string') return reply.code(400).send({ error: 'body must be {"url": string}' });
    run.trace.push({ at: run.now().toISOString(), kind: 'live_call_blocked', url });
    return reply.code(204).send();
  });
}
