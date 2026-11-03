// Bean & Bloom: a small flower-subscription shop, written the way a busy developer would.
// It is not part of Test Clock: it talks to PayPal's sandbox with plain fetch and knows nothing about the twin.
// This is the shop from the demo video, with the one thing its developer forgot (see the handler below).
const express = require('express');
const app = express();
app.use(express.json());

const PAYPAL = 'https://api-m.sandbox.paypal.com';
const members = {};
const seen = new Set();

async function token() {
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${PAYPAL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  return (await r.json()).access_token;
}

app.post('/subscribe', async (req, res) => {
  const { name, email } = req.body;
  const r = await fetch(`${PAYPAL}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_id: 'P-BLOOM', subscriber: { name: { given_name: name }, email_address: email } }),
  });
  const { id } = await r.json();
  members[id] = { email, access: false, boxes: 0 };
  res.json({ subscription_id: id });
});

app.post('/webhooks/paypal', async (req, res) => {
  const event = req.body;
  const h = req.headers;

  const check = await fetch(`${PAYPAL}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: h['paypal-auth-algo'], cert_url: h['paypal-cert-url'],
      transmission_id: h['paypal-transmission-id'], transmission_sig: h['paypal-transmission-sig'],
      transmission_time: h['paypal-transmission-time'], webhook_id: 'WH-FF-LOCAL', webhook_event: event,
    }),
  });
  if ((await check.json()).verification_status !== 'SUCCESS') return res.sendStatus(400);

  // The forgotten check: PayPal can send the same notice more than once. To fix, uncomment the two lines below.
  // if (seen.has(event.id)) return res.sendStatus(200);
  // seen.add(event.id);

  const sale = event.event_type === 'PAYMENT.SALE.COMPLETED';
  const id = sale ? event.resource.billing_agreement_id : event.resource.id;
  if (id && (sale || event.event_type.startsWith('BILLING.SUBSCRIPTION.'))) {
    const m = (members[id] ||= { email: '', access: false, boxes: 0 });
    const s = await fetch(`${PAYPAL}/v1/billing/subscriptions/${id}`, { headers: { Authorization: `Bearer ${await token()}` } });
    m.access = (await s.json()).status === 'ACTIVE';
    if (sale) m.boxes += 1;
  }

  if (event.event_type === 'CUSTOMER.DISPUTE.CREATED') {
    const form = new FormData();
    const proof = { evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', tracking_info: [{ carrier_name: 'UPS', tracking_number: '1Z999AA10123456784' }] }] };
    form.append('input', new Blob([JSON.stringify(proof)], { type: 'application/json' }), 'input.json');
    await fetch(`${PAYPAL}/v1/customer/disputes/${event.resource.dispute_id || event.resource.id}/provide-evidence`, {
      method: 'POST', headers: { Authorization: `Bearer ${await token()}` }, body: form,
    }).catch(() => {});
  }
  res.sendStatus(200);
});

// What Test Clock's checks read: does this subscriber have access, and how many boxes were sent.
app.get('/__ff/probe', (req, res) => {
  const m = members[req.query.subscription_id];
  if (!m) return res.status(404).json({ error: 'unknown subscription' });
  res.json({ access: m.access, fulfilments: m.boxes });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`Bean & Bloom listening on ${port}`));
