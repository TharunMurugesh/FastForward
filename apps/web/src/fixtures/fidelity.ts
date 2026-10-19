import type { FidelityFile } from '../fidelity.js';

/** SAMPLE data in the Task 14 format, used until a real fidelity/latest.json exists. Not a real run. */
export const sampleFidelity: FidelityFile = {
  ranAt: '2026-11-02T09:30:00.000Z',
  sandboxBase: 'https://api-m.sandbox.paypal.com',
  checks: [
    { endpoint: '/v1/catalogs/products', method: 'POST', sandboxStatus: 201, twinStatus: 201, shapeMatch: true, specMatch: true, allowedDiffs: [] },
    { endpoint: '/v1/billing/plans', method: 'POST', sandboxStatus: 201, twinStatus: 201, shapeMatch: true, specMatch: true, allowedDiffs: [] },
    {
      endpoint: '/v1/billing/subscriptions',
      method: 'POST',
      sandboxStatus: 201,
      twinStatus: 201,
      shapeMatch: true,
      specMatch: true,
      allowedDiffs: [{ field: 'links[].href', reason: 'Approve and self links point at the twin, not paypal.com' }],
    },
    {
      endpoint: '/v1/billing/subscriptions/{id}',
      method: 'GET',
      sandboxStatus: 200,
      twinStatus: 200,
      shapeMatch: true,
      specMatch: true,
      allowedDiffs: [{ field: 'subscriber.shipping_address', reason: 'Sandbox fills a default address; the twin omits it' }],
    },
    { endpoint: '/v1/billing/subscriptions/{id}/cancel', method: 'POST', sandboxStatus: 204, twinStatus: 204, shapeMatch: true, specMatch: true, allowedDiffs: [] },
    { endpoint: '/v1/notifications/verify-webhook-signature', method: 'POST', sandboxStatus: 200, twinStatus: 200, shapeMatch: true, specMatch: true, allowedDiffs: [] },
    { endpoint: '/v1/customer/disputes', method: 'GET', sandboxStatus: 200, twinStatus: 200, shapeMatch: true, specMatch: true, allowedDiffs: [] },
  ],
};
