import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SubscriptionEngine } from './engine.js';
import { PayPalError } from './resources.js';

/** Runs a handler, turning a PayPalError into PayPal's error body and status. */
export async function guarded(reply: FastifyReply, fn: () => unknown | Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PayPalError) return reply.code(err.status).send(err.body());
    throw err;
  }
}

/**
 * The 10 subscription-side routes (plus the two list endpoints). `engineOf` is called per request so
 * each run can have its own engine; if it throws a PayPalError the caller gets that error back.
 */
export function registerSubscriptionRoutes(app: FastifyInstance, engineOf: () => SubscriptionEngine): void {
  const bodyOf = (b: unknown): Record<string, any> => (typeof b === 'object' && b !== null ? (b as Record<string, any>) : {});

  app.post('/v1/catalogs/products', (req, reply) => guarded(reply, () => reply.code(201).send(engineOf().createProduct(req.body))));
  app.get('/v1/catalogs/products', (_req, reply) => guarded(reply, () => engineOf().listProducts()));
  app.get<{ Params: { id: string } }>('/v1/catalogs/products/:id', (req, reply) => guarded(reply, () => engineOf().getProduct(req.params.id)));

  app.post('/v1/billing/plans', (req, reply) => guarded(reply, () => reply.code(201).send(engineOf().createPlan(req.body))));
  app.get('/v1/billing/plans', (_req, reply) => guarded(reply, () => engineOf().listPlans()));
  app.get<{ Params: { id: string } }>('/v1/billing/plans/:id', (req, reply) => guarded(reply, () => engineOf().getPlan(req.params.id)));

  app.post('/v1/billing/subscriptions', (req, reply) =>
    guarded(reply, () =>
      reply.code(201).send(
        engineOf().createSubscription(bodyOf(req.body) as Parameters<SubscriptionEngine['createSubscription']>[0], {
          representation: String(req.headers.prefer ?? '').toLowerCase().includes('return=representation'),
        }),
      ),
    ),
  );
  app.get<{ Params: { id: string }; Querystring: { fields?: string } }>('/v1/billing/subscriptions/:id', (req, reply) =>
    guarded(reply, () => engineOf().get(req.params.id, { includePlan: (req.query.fields ?? '').split(',').includes('plan') })),
  );

  app.post<{ Params: { id: string } }>('/v1/billing/subscriptions/:id/activate', (req, reply) =>
    guarded(reply, () => {
      const reason = bodyOf(req.body).reason;
      engineOf().activate(req.params.id, typeof reason === 'string' ? reason : undefined);
      return reply.code(204).send();
    }),
  );
  app.post<{ Params: { id: string } }>('/v1/billing/subscriptions/:id/suspend', (req, reply) =>
    guarded(reply, () => {
      const reason = bodyOf(req.body).reason;
      engineOf().suspend(req.params.id, typeof reason === 'string' ? reason : undefined);
      return reply.code(204).send();
    }),
  );
  app.post<{ Params: { id: string } }>('/v1/billing/subscriptions/:id/cancel', (req, reply) =>
    guarded(reply, () => {
      const reason = bodyOf(req.body).reason;
      engineOf().cancel(req.params.id, typeof reason === 'string' ? reason : 'Cancelled by the merchant');
      return reply.code(204).send();
    }),
  );
  app.get<{ Params: { id: string } }>('/v1/billing/subscriptions/:id/transactions', (req, reply) =>
    guarded(reply, () => engineOf().transactions(req.params.id)),
  );
}
