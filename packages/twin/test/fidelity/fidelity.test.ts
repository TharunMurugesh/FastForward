import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Twin } from '../../src/index.js';
import { ALLOWED_DIFFS, evaluate, runFidelitySuite, startTwinWithRun, toFidelityFile, writeFidelityFile, type StepOutcome } from './suite.js';

/**
 * Sends identical requests to PayPal's REAL SANDBOX and to an in-process twin, then compares status codes,
 * body shapes and the OpenAPI schema (plan Task 14, step 2). Run it with `npm run fidelity`.
 *
 * It touches the PayPal account behind the keys: it creates a product, a plan and a subscription in the
 * sandbox (and cancels the subscription). Products and plans cannot be deleted. So it only runs when asked:
 *   FF_FIDELITY=1 PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npm run fidelity
 * (the keys may come from .env). It never targets live PayPal and never prints the keys.
 *
 * Result: fidelity/latest.json at the repo root: statuses, shapes and reasons only, never values.
 */

const root = fileURLToPath(new URL('../../../../', import.meta.url));
try {
  process.loadEnvFile(`${root}.env`); // PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET, if the file exists
} catch {
  // no .env: the keys must already be in the environment
}

const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
const enabled = process.env.FF_FIDELITY === '1' && Boolean(clientId) && Boolean(clientSecret);
const reason = process.env.FF_FIDELITY !== '1'
  ? 'FF_FIDELITY=1 is not set (the live comparison touches the PayPal sandbox account, so it runs only when asked)'
  : 'PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not both set';

describe.skipIf(!enabled)(`sandbox fidelity${enabled ? '' : ` (skipped: ${reason})`}`, () => {
  let twin: Twin;
  let outcomes: StepOutcome[] = [];

  beforeAll(async () => {
    twin = await startTwinWithRun();
    outcomes = await runFidelitySuite({
      sandboxBase: 'https://api-m.sandbox.paypal.com',
      sandboxCreds: { clientId: clientId!, clientSecret: clientSecret! },
      twinUrl: twin.url,
    });
    // Written before any assertion, so the file always shows what really happened.
    writeFidelityFile(`${root}fidelity/latest.json`, toFidelityFile(outcomes, { sandboxBase: 'https://api-m.sandbox.paypal.com', allowed: ALLOWED_DIFFS }));
  });

  afterAll(async () => {
    await twin?.close();
  });

  it('the sandbox and the twin agree on status and shape, except for differences listed in ALLOWED_DIFFS', () => {
    const evaluations = outcomes.map((o) => ({ o, e: evaluate(o, ALLOWED_DIFFS) }));
    // Error names are printed here (and only here), so a wrong guess in the twin can be corrected.
    const notes = evaluations.flatMap(({ o, e }) => e.notes.map((n) => `${o.method} ${o.template}: ${n}`));
    for (const line of notes) console.log(line);
    const unexpected = evaluations.flatMap(({ o, e }) => e.unexpected.map((u) => `${o.method} ${o.template}: ${u}`));
    expect(unexpected, notes.join('\n')).toEqual([]);
  });

  it('both sides satisfy the OpenAPI schema', () => {
    const errors = outcomes.flatMap((o) => o.specErrors.map((e) => `${o.method} ${o.template}: ${e}`));
    expect(errors).toEqual([]);
  });
});
