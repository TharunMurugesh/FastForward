import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerControlRoutes } from './control.js';
import { checkUpstreamBase, registerPassthrough, SANDBOX_BASE, type SandboxCreds } from './passthrough.js';
import { createRunRegistry } from './run/registry.js';
import { Run, type RunDeps } from './run/run.js';
import { PayPalError } from './subscriptions/resources.js';
import { registerSubscriptionRoutes } from './subscriptions/routes.js';
import { registerWebhookRoutes } from './webhooks/routes.js';
import { certUrl, createSigner } from './webhooks/sign.js';

export interface TwinOptions {
  /** Default 4010; 0 picks a free port. */
  port?: number;
  /** Where unknown /v1 and /v2 routes go. Default the real sandbox; only that host or localhost is accepted. */
  upstreamBase?: string;
  /** The twin's own sandbox credentials for passthrough. Without them, unknown routes answer 501. */
  sandboxCreds?: SandboxCreds;
  /** Hooks a run calls out to, such as the AI customers' decisions. */
  deps?: RunDeps;
}

export interface Twin {
  url: string;
  app: FastifyInstance;
  /** Where deliveries say the signing cert lives (a PayPal host; the register add-on redirects it here). */
  certUrl: string;
  close(): Promise<void>;
  activeRun(): Run | null;
}

const pathOf = (url: string) => url.split('?')[0] ?? url;

export async function createTwin(opts: TwinOptions = {}): Promise<Twin> {
  // Validate before opening a port, so a bad upstream can never be reached even briefly.
  const upstreamBase = checkUpstreamBase(opts.upstreamBase ?? SANDBOX_BASE);
  const signer = await createSigner(randomBytes(4).toString('hex').toUpperCase());

  // Open event streams must not keep close() waiting.
  const app = Fastify({ logger: false, forceCloseConnections: true });

  // Keep the exact request bytes so passthrough can forward them untouched.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body as Buffer;
    if ((body as Buffer).length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      const err = new Error('request body is not valid JSON') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body as Buffer;
    done(null, body);
  });

  const registry = createRunRegistry((scenario) => new Run(scenario, signer, opts.deps));

  // Counted on arrival, so a run's subscribe step knows the app reached the twin (spec §11).
  app.addHook('onRequest', async (req) => {
    if (req.method === 'POST' && pathOf(req.url) === '/v1/billing/subscriptions') registry.active()?.noteSubscriptionCreate();
  });
  // Every request the app makes to twin PayPal routes goes into the trace.
  app.addHook('onResponse', async (req, reply) => {
    const path = pathOf(req.url);
    const run = registry.active();
    if (!run || path.startsWith('/_ff')) return;
    run.record({ at: run.now().toISOString(), kind: 'app_call', method: req.method, path, status: reply.statusCode });
  });

  app.post('/v1/oauth2/token', async () => ({
    scope: 'https://uri.paypal.com/services/subscriptions https://api-m.paypal.com/v1/payments/.*',
    access_token: `FF-${randomBytes(24).toString('base64url')}`,
    token_type: 'Bearer',
    app_id: 'APP-FASTFORWARD',
    expires_in: 32400,
    nonce: new Date().toISOString(),
  }));

  registerWebhookRoutes(app, {
    signer,
    ledger: () => registry.active()?.ledger ?? null,
    record: (entry) => {
      const run = registry.active();
      run?.record({ at: run.now().toISOString(), ...entry });
    },
  });
  registerSubscriptionRoutes(app, () => {
    const run = registry.active();
    if (!run) throw new PayPalError(409, 'NO_ACTIVE_RUN', 'No Fastforward run is active. Start one with POST /_ff/runs.');
    return run.engine;
  });
  registerControlRoutes(app, registry);
  registerPassthrough(app, { upstreamBase, ...(opts.sandboxCreds ? { sandboxCreds: opts.sandboxCreds } : {}) });

  await app.listen({ port: opts.port ?? 4010, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    app,
    certUrl: certUrl(signer.certId),
    close: () => app.close(),
    activeRun: () => registry.active(),
  };
}
