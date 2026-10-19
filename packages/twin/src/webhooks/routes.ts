import type { FastifyInstance } from 'fastify';
import type { VerifyLedger } from './dispatcher.js';
import { certUrl, signingString, type Signer } from './sign.js';

const REQUIRED = ['auth_algo', 'cert_url', 'transmission_id', 'transmission_sig', 'transmission_time', 'webhook_id', 'webhook_event'] as const;

type VerifyBody = Partial<Record<(typeof REQUIRED)[number], unknown>>;

/** What the routes report to the active run's trace; the run stamps virtual time. */
export type WebhookTraceEntry = { kind: 'verify_call'; transmissionId: string; result: 'SUCCESS' | 'FAILURE' } | { kind: 'cert_fetch' };

export interface WebhookRouteDeps {
  signer: Signer;
  ledger: () => VerifyLedger | null;
  record?: (entry: WebhookTraceEntry) => void;
}

export function registerWebhookRoutes(app: FastifyInstance, deps: WebhookRouteDeps): void {
  const { signer } = deps;

  app.post('/v1/notifications/verify-webhook-signature', async (req, reply) => {
    const body = (req.body ?? {}) as VerifyBody;
    const missing = REQUIRED.filter((k) => body[k] === undefined || body[k] === null);
    if (missing.length > 0) {
      return reply.code(400).send({
        name: 'VALIDATION_ERROR',
        message: 'Invalid request - see details',
        details: missing.map((field) => ({ field, issue: 'MISSING_REQUIRED_PARAMETER' })),
      });
    }
    const transmissionId = String(body.transmission_id);
    deps.ledger()?.mark(transmissionId);

    // The app hands back the parsed event; re-serialising gives the sent bytes because they were JSON.stringify output.
    const signed = signingString(transmissionId, String(body.transmission_time), String(body.webhook_id), JSON.stringify(body.webhook_event));
    const ok =
      body.auth_algo === 'SHA256withRSA' &&
      body.cert_url === certUrl(signer.certId) &&
      signer.verify(signed, String(body.transmission_sig));
    const result = ok ? 'SUCCESS' : 'FAILURE';
    deps.record?.({ kind: 'verify_call', transmissionId, result });
    return { verification_status: result };
  });

  app.get<{ Params: { certId: string } }>('/v1/notifications/certs/:certId', async (req, reply) => {
    if (req.params.certId !== signer.certId) {
      return reply.code(404).send({ name: 'RESOURCE_NOT_FOUND', message: 'The specified resource does not exist.' });
    }
    deps.ledger()?.markCertFetch();
    deps.record?.({ kind: 'cert_fetch' });
    return reply.type('text/plain').send(signer.certPem);
  });
}
