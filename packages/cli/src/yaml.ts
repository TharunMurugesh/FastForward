import type { Scenario } from '@fastforward/contracts';
import { stringify } from 'yaml';

/** The inverse of `parseScenario`: a Scenario back to the YAML form people write. */
export function scenarioToYaml(s: Scenario): string {
  const doc = {
    name: s.name,
    seed: s.seed,
    start: s.start,
    duration: `P${s.durationDays}D`,
    app: s.app,
    plan: s.plan,
    customers: s.customers.map((c) => ({
      name: c.name,
      email: c.email,
      persona: c.persona,
      card: c.card.kind === 'ok' ? 'ok' : `fails_from:${c.card.date}`,
      ...(c.actions.length > 0 ? { actions: c.actions } : {}),
    })),
    weather: s.weather,
    expect: s.expect,
  };
  return stringify(doc, { lineWidth: 0 });
}
