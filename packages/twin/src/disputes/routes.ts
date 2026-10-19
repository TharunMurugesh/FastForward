import type { DisputeAction } from '@fastforward/contracts';
import type { FastifyInstance } from 'fastify';
import { guarded } from '../subscriptions/routes.js';
import type { DisputeEngine } from './engine.js';

/**
 * The `input` part of a multipart body (PayPal's dispute actions send JSON as `input` plus optional
 * files). Files are ignored. Returns {} when there is no readable input part.
 */
export function multipartInput(body: Buffer, contentType: string): unknown {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker) return {};
  // latin1 keeps every byte intact while splitting; the JSON part is decoded as UTF-8 afterwards.
  const parts = body.toString('latin1').split(`--${marker}`);
  for (const part of parts) {
    const split = part.indexOf('\r\n\r\n');
    if (split < 0) continue;
    const headers = part.slice(0, split);
    if (!/content-disposition:[^\r\n]*name="input"/i.test(headers)) continue;
    const content = Buffer.from(part.slice(split + 4).replace(/\r\n$/, ''), 'latin1').toString('utf8');
    try {
      return JSON.parse(content);
    } catch {
      return {};
    }
  }
  return {};
}

const ACTIONS: DisputeAction[] = ['provide-evidence', 'accept-claim', 'send-message', 'make-offer'];

/**
 * `GET /v1/customer/disputes[/:id]` and the four seller actions. Actions accept JSON, or multipart with
 * an `input` JSON part like the real API. `engineOf` is called per request.
 */
export function registerDisputeRoutes(app: FastifyInstance, engineOf: () => DisputeEngine): void {
  // Encapsulated, so these parsers never clash with the ones the twin server installs at the root.
  void app.register(async (scope) => {
    for (const type of ['multipart/form-data', 'multipart/related', 'multipart/mixed']) {
      scope.addContentTypeParser(type, { parseAs: 'buffer' }, (req, body, done) => {
        done(null, multipartInput(body as Buffer, String(req.headers['content-type'] ?? '')));
      });
    }

    scope.get('/v1/customer/disputes', (_req, reply) =>
      guarded(reply, () => {
        const disputes = engineOf().list();
        // `items` is always there, empty when there are no disputes (what the real sandbox does, although
        // PayPal's schema says at least one).
        return {
          items: disputes.map(({ dispute_id, create_time, update_time, reason, status, dispute_amount, dispute_life_cycle_stage, dispute_channel, seller_response_due_date, links }) => ({
            dispute_id, create_time, update_time, reason, status, dispute_amount, dispute_life_cycle_stage, dispute_channel, seller_response_due_date, links,
          })),
          links: [{ href: 'https://api.sandbox.paypal.com/v1/customer/disputes', rel: 'self', method: 'GET' }],
        };
      }),
    );

    scope.get<{ Params: { id: string } }>('/v1/customer/disputes/:id', (req, reply) => guarded(reply, () => engineOf().get(req.params.id)));

    for (const action of ACTIONS) {
      scope.post<{ Params: { id: string } }>(`/v1/customer/disputes/:id/${action}`, (req, reply) =>
        guarded(reply, () => {
          const engine = engineOf();
          engine.act(req.params.id, action, req.body);
          return { links: [{ href: `https://api.sandbox.paypal.com/v1/customer/disputes/${req.params.id}`, rel: 'self', method: 'GET' }] };
        }),
      );
    }
  });
}
