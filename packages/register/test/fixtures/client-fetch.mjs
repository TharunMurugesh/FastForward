// Global fetch to both PayPal sandbox hosts. Prints one JSON line.
const sub = await fetch('https://api-m.sandbox.paypal.com/v1/billing/subscriptions?page=2', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-test': 'kept' },
  body: JSON.stringify({ plan_id: 'P-1' }),
});
const cert = await fetch('https://api.sandbox.paypal.com/v1/notifications/certs/CERT-FF-x');

console.log(JSON.stringify({ sub: sub.status, cert: cert.status }));
