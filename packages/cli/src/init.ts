import { existsSync, writeFileSync } from 'node:fs';
import { ToolError } from './errors.js';

export const DEFAULT_WEBHOOK_URL = 'http://127.0.0.1:3000/webhooks/paypal';

/** A starter scenario with comments, so a new user can read and edit it. Only the webhook address is required. */
export function starterScenario(webhookUrl: string): string {
  return `# A starter Fastforward scenario: three customers over about ten weeks, with misbehaving webhooks.
# Everything here is simulated; no real PayPal call is made. Edit freely, then: fastforward run fastforward.yaml
name: my-first-month
seed: 42                      # same seed, same shape and timing of events on every run
start: 2026-11-01T00:00:00.000Z
duration: P75D                # how much simulated time to play (75 days)

app:
  # Required: where your app receives PayPal webhooks.
  webhookUrl: ${webhookUrl}
  # Optional, but without these two the checks that need them are reported as "skipped":
  #   subscribeUrl: POST {"name","email"} -> 2xx {"subscription_id": "I-..."}; your app creates the subscription.
  #   probeUrl:     GET ?subscription_id=I-... -> {"access": true|false, "fulfilments": 1}; test-only.
  # subscribeUrl: http://127.0.0.1:3000/subscribe
  # probeUrl: http://127.0.0.1:3000/__ff/probe

plan:
  name: My Monthly Plan
  price: "12.00"
  currency: USD
  interval: MONTH

customers:
  - name: Maya
    persona: Pays on time and never complains.
    card: ok
  - name: Leo
    persona: Busy, rarely reads email, card expires in December.
    card: fails_from:2026-12-01   # payments fail from this date
  - name: Ana
    persona: Impatient; says her first order never arrived.
    card: ok
    actions:
      - at: 2026-11-20
        do: dispute
        reason: MERCHANDISE_OR_SERVICE_NOT_RECEIVED
        message: My first order never arrived.

weather:                        # how badly the webhooks misbehave
  duplicates: 0.2               # share of events delivered twice
  reorder: 0.1                  # share delivered out of order
  delayMinutes: [0, 90]         # random delay range
  forged: 1                     # number of forged events (your app must reject them)
  burst: false
`;
}

export interface InitOptions {
  output: string;
  webhookUrl: string;
}

/** Writes the starter file and returns the text to show the user. Never overwrites. */
export function writeStarter({ output, webhookUrl }: InitOptions): string {
  try {
    new URL(webhookUrl);
  } catch {
    throw new ToolError(`--webhook-url must be a full address like ${DEFAULT_WEBHOOK_URL}, got "${webhookUrl}"`);
  }
  if (existsSync(output)) throw new ToolError(`${output} already exists; choose another file with -o`);
  writeFileSync(output, starterScenario(webhookUrl));
  return `Wrote ${output}.

Next:
  1. Start your app with the add-on, so its PayPal calls go to the simulator instead:
       FASTFORWARD=1 node --import fastforward-register your-app.js
  2. Run the scenario in another terminal:
       fastforward run ${output}
  3. Open report.html from the report folder it prints, to see what your app handled and what it missed.

Only the webhook address is set (${webhookUrl}). Open ${output} and follow the comments to add
subscribeUrl and probeUrl: without them the checks that need them are reported as skipped.
`;
}
