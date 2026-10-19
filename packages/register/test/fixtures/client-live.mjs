// Tries to reach live PayPal three ways. A guard refuses every TCP connection that is not to this
// machine and records it, so the test proves the add-on blocks before any packet leaves.
import net from 'node:net';
import https from 'node:https';

const leaks = [];
const loopback = new Set(['127.0.0.1', '::1', 'localhost']);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const [first, second] = normalized;
  const host = typeof first === 'object' && first !== null ? (first.path ? 'localhost' : first.host) : second;
  if (!loopback.has(host ?? 'localhost')) {
    leaks.push(String(host));
    throw new Error(`test guard: refused connection to ${host}`);
  }
  return connect.apply(this, args);
};

const result = { leaks };

try {
  await fetch('https://api-m.paypal.com/v1/oauth2/token?secret=1', { method: 'POST' });
  result.fetch = 'not blocked';
} catch (err) {
  result.fetch = err.cause?.name ?? err.name;
}

try {
  https.request('https://api.paypal.com/v1/billing/subscriptions').end();
  result.https = 'not blocked';
} catch (err) {
  result.https = err.name;
}

try {
  https.get({ hostname: 'API-M.PAYPAL.COM.', path: '/v2/checkout/orders' });
  result.httpsOddCase = 'not blocked';
} catch (err) {
  result.httpsOddCase = err.name;
}

console.log(JSON.stringify(result));
