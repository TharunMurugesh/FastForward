// node:https in the three call shapes apps use: URL + options, options only (named `get`), and a string.
import https, { get } from 'node:https';

function send(req, body) {
  return new Promise((resolve, reject) => {
    req.on('response', (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function settle(req) {
  return new Promise((resolve, reject) => {
    req.on('response', (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
}

const post = await send(
  https.request(new URL('https://api-m.sandbox.paypal.com/v1/billing/subscriptions?page=2'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test': 'kept' },
  }),
  JSON.stringify({ plan_id: 'P-1' }),
);
const cert = await settle(get({ hostname: 'api.sandbox.paypal.com', path: '/v1/notifications/certs/CERT-FF-x' }));
const plain = await settle(https.get('https://api-m.sandbox.paypal.com/v1/billing/plans'));

console.log(JSON.stringify({ post, cert, plain }));
