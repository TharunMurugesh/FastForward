import type { FastifyInstance } from 'fastify';
import type { VerifyLedger } from './dispatcher.js';
import { certUrl, signingString, type Signer } from './sign.js';

const REQUIRED = ['auth_algo', 'cert_url', 'transmission_id', 'transmission_sig', 'transmission_time', 'webhook_id', 'webhook_event'] as const;

type VerifyBody = Partial<Record<(typeof REQUIRED)[number], unknown>>;

export function registerWebhookRoutes(app: FastifyInstance, deps: { signer: Signer; ledger: () => VerifyLedger | null }): void {
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
    return { verification_status: ok ? 'SUCCESS' : 'FAILURE' };
  });

  app.get<{ Params: { certId: string } }>('/v1/notifications/certs/:certId', async (req, reply) => {
    if (req.params.certId !== signer.certId) {
      return reply.code(404).send({ name: 'RESOURCE_NOT_FOUND', message: 'The specified resource does not exist.' });
    }
    deps.ledger()?.markCertFetch();
    return reply.type('text/plain').send(signer.certPem);
  });
}
