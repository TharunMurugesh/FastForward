import type { FastifyInstance } from 'fastify';
import { PayPalError } from '../subscriptions/resources.js';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * The checks that make a request malformed rather than merely wrongly signed: a required field is missing, or a
 * field is not in the form PayPal sends (transmission id a UUID, signature base64, time ISO-8601, cert url a URL).
 * Which of these the real sandbox enforces is unverified; the first live fidelity run showed it answers 400 to
 * the suite's deliberately invalid body.
 */
function validate(body: VerifyBody): { field: string; value?: string; location: string; issue: string; description: string }[] {
  const problems: { field: string; value?: string; location: string; issue: string; description: string }[] = [];
  const bad = (key: string, issue: string, description: string) =>
    problems.push({ field: `/${key}`, value: typeof body[key as keyof VerifyBody] === 'string' ? (body[key as keyof VerifyBody] as string) : '', location: 'body', issue, description });
  for (const key of REQUIRED) {
    if (body[key] === undefined || body[key] === null) bad(key, 'MISSING_REQUIRED_PARAMETER', `A required field is missing: ${key}.`);
  }
  const text = (key: keyof VerifyBody) => (typeof body[key] === 'string' ? (body[key] as string) : null);
  const check = (key: keyof VerifyBody, ok: (v: string) => boolean, description: string) => {
    const v = text(key);
    if (body[key] !== undefined && body[key] !== null && (v === null || !ok(v))) bad(key, 'INVALID_PARAMETER_VALUE', description);
  };
  check('transmission_id', (v) => UUID.test(v), 'transmission_id must be a UUID.');
  check('transmission_sig', (v) => BASE64.test(v), 'transmission_sig must be base64.');
  check('transmission_time', (v) => ISO_TIME.test(v) && !Number.isNaN(Date.parse(v)), 'transmission_time must be an ISO 8601 date-time.');
  check('cert_url', (v) => URL.canParse(v), 'cert_url must be a URL.');
  if (body.webhook_event !== undefined && body.webhook_event !== null && (typeof body.webhook_event !== 'object' || Array.isArray(body.webhook_event))) {
    bad('webhook_event', 'INVALID_PARAMETER_VALUE', 'webhook_event must be the notice as a JSON object.');
  }
  return problems;
}

export function registerWebhookRoutes(app: FastifyInstance, deps: WebhookRouteDeps): void {
  const { signer } = deps;

  app.post('/v1/notifications/verify-webhook-signature', async (req, reply) => {
    const body = (req.body ?? {}) as VerifyBody;
    const problems = validate(body);
    if (problems.length > 0) {
      return reply.code(400).send(new PayPalError(400, 'VALIDATION_ERROR', 'Request is not well formed, syntactically incorrect, or violates schema.', problems).body());
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
