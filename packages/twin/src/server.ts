import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { createStubRegistry, registerControlRoutes, type Run } from './control.js';
import { checkUpstreamBase, registerPassthrough, SANDBOX_BASE, type SandboxCreds } from './passthrough.js';

export interface TwinOptions {
  /** Default 4010; 0 picks a free port. */
  port?: number;
  /** Where unknown /v1 and /v2 routes go. Default the real sandbox; only that host or localhost is accepted. */
  upstreamBase?: string;
  /** The twin's own sandbox credentials for passthrough. Without them, unknown routes answer 501. */
  sandboxCreds?: SandboxCreds;
}

export interface Twin {
  url: string;
  app: FastifyInstance;
  close(): Promise<void>;
  activeRun(): Run | null;
}

export async function createTwin(opts: TwinOptions = {}): Promise<Twin> {
  // Validate before opening a port, so a bad upstream can never be reached even briefly.
  const upstreamBase = checkUpstreamBase(opts.upstreamBase ?? SANDBOX_BASE);

  const app = Fastify({ logger: false });

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

  const registry = createStubRegistry();

  app.post('/v1/oauth2/token', async () => ({
    scope: 'https://uri.paypal.com/services/subscriptions https://api-m.paypal.com/v1/payments/.*',
    access_token: `FF-${randomBytes(24).toString('base64url')}`,
    token_type: 'Bearer',
    app_id: 'APP-FASTFORWARD',
    expires_in: 32400,
    nonce: new Date().toISOString(),
  }));

  registerControlRoutes(app, registry);
  registerPassthrough(app, { upstreamBase, ...(opts.sandboxCreds ? { sandboxCreds: opts.sandboxCreds } : {}) });

  await app.listen({ port: opts.port ?? 4010, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    app,
    close: () => app.close(),
    activeRun: () => registry.active(),
  };
}
