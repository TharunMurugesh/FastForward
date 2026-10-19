import { DISPUTE_REASONS, SUBSCRIPTION_STATUSES, type Scenario } from '@fastforward/contracts';
import type { Run } from './run.js';

/** One active run per twin; finished runs stay readable (trace, report) until the twin closes. */
export interface RunRegistry {
  active(): Run | null;
  get(id: string): Run | undefined;
  /** The most recently started run, active or finished. */
  latest(): Run | undefined;
  /** Validates, starts and activates a run, or throws an Error with a message fit to show the caller. */
  create(scenario: unknown): Promise<Run>;
  /** Plays the run to its end and releases the twin for the next run. */
  finish(run: Run): Promise<void>;
}

export function createRunRegistry(makeRun: (scenario: Scenario) => Run): RunRegistry {
  const runs = new Map<string, Run>();
  let current: Run | null = null;
  return {
    active: () => current,
    get: (id) => runs.get(id),
    latest: () => [...runs.values()].at(-1),
    async create(body) {
      if (current) throw new Error('a run is already active; finish it first');
      const run = makeRun(checkScenario(body));
      // Active before start(): the app's subscribe calls during start() must reach this run's engine.
      current = run;
      try {
        await run.start();
      } catch (err) {
        current = null;
        throw err;
      }
      runs.set(run.id, run);
      return run;
    },
    async finish(run) {
      await run.runToEnd();
      if (current === run) current = null;
    },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number) => Number.isInteger(v) && (v as number) >= min;
const isInstant = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isHttpUrl = (v: unknown) => {
  if (typeof v !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

/**
 * Checks a posted Scenario (the parsed form from `parseScenario`, not YAML) for everything a run relies
 * on, and lists every problem as `path: message`, like `parseScenario` does.
 */
export function checkScenario(body: unknown): Scenario {
  const problems: string[] = [];
  const need = (ok: boolean, path: string, message: string) => {
    if (!ok) problems.push(`${path}: ${message}`);
  };
  const s = isObject(body) ? body : {};
  need(typeof s.name === 'string' && s.name !== '', 'name', 'required');
  need(Number.isInteger(s.seed), 'seed', 'must be an integer');
  need(isInstant(s.start), 'start', 'must be an ISO-8601 timestamp');
  need(isInt(s.durationDays, 1), 'durationDays', 'must be a whole number of days, at least 1');

  const app = isObject(s.app) ? s.app : {};
  need(isHttpUrl(app.webhookUrl), 'app.webhookUrl', 'must be an http(s) URL');
  need(typeof app.webhookId === 'string', 'app.webhookId', 'required');
  for (const key of ['subscribeUrl', 'probeUrl'] as const) {
    need(app[key] === undefined || isHttpUrl(app[key]), `app.${key}`, 'must be an http(s) URL');
  }

  const plan = isObject(s.plan) ? s.plan : {};
  need(typeof plan.name === 'string', 'plan.name', 'required');
  need(typeof plan.price === 'string' && /^\d+(\.\d{1,2})?$/.test(plan.price), 'plan.price', 'expected a decimal string, e.g. "12.00"');
  need(typeof plan.currency === 'string' && /^[A-Z]{3}$/.test(plan.currency), 'plan.currency', 'expected a 3-letter currency code');
  need(['DAY', 'WEEK', 'MONTH', 'YEAR'].includes(plan.interval as string), 'plan.interval', 'must be DAY, WEEK, MONTH or YEAR');
  need(isInt(plan.trialDays, 0), 'plan.trialDays', 'must be a whole number, at least 0');
  need(isInt(plan.totalCycles, 0), 'plan.totalCycles', 'must be a whole number, at least 0');
  need(isInt(plan.paymentFailureThreshold, 1), 'plan.paymentFailureThreshold', 'must be a whole number, at least 1');

  const customers = Array.isArray(s.customers) ? s.customers : [];
  need(customers.length > 0, 'customers', 'at least one customer is required');
  const names = new Set<string>();
  customers.forEach((raw, i) => {
    const c = isObject(raw) ? raw : {};
    const at = `customers.${i}`;
    need(typeof c.name === 'string' && c.name !== '', `${at}.name`, 'required');
    need(!names.has(c.name as string), `${at}.name`, 'must be unique (decisions are keyed by name)');
    names.add(c.name as string);
    need(typeof c.email === 'string', `${at}.email`, 'required');
    need(typeof c.persona === 'string', `${at}.persona`, 'required');
    const card = isObject(c.card) ? c.card : {};
    need(card.kind === 'ok' || (card.kind === 'fails_from' && typeof card.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(card.date)), `${at}.card`, 'expected {kind:"ok"} or {kind:"fails_from", date:"YYYY-MM-DD"}');
    const actions = Array.isArray(c.actions) ? c.actions : null;
    need(actions !== null, `${at}.actions`, 'must be a list');
    (actions ?? []).forEach((rawAction, j) => {
      const a = isObject(rawAction) ? rawAction : {};
      need(isInstant(a.at), `${at}.actions.${j}.at`, 'must be a date or timestamp');
      need(['cancel', 'update_card', 'dispute'].includes(a.do as string), `${at}.actions.${j}.do`, 'must be cancel, update_card or dispute');
      if (a.do === 'dispute') need((DISPUTE_REASONS as readonly unknown[]).includes(a.reason), `${at}.actions.${j}.reason`, 'must be a PayPal dispute reason');
    });
  });

  need(isObject(s.weather), 'weather', 'required');
  const expect = isObject(s.expect) ? s.expect : {};
  need(
    Array.isArray(expect.accessWhile) && expect.accessWhile.every((x) => (SUBSCRIPTION_STATUSES as readonly unknown[]).includes(x)),
    'expect.accessWhile',
    'must be a list of subscription statuses',
  );

  if (problems.length > 0) throw new Error(`invalid scenario:\n  ${problems.join('\n  ')}`);
  return body as Scenario;
}
