# Try Fastforward on a real app

Two tracks. **Track A** is for an app you are building now. **Track B** is for an app that already exists. Every step here
was run by hand on a brand-new project using only the packages from npm, and each says what you should see.

You need: **Node 24 or newer**, and a Node app that takes PayPal Subscriptions (or that will). You do **not** need a PayPal
login or any PayPal keys: Fastforward plays PayPal for you and never touches the real one.

Commands use **PowerShell**. On Mac or Linux write `FASTFORWARD=1 node ...` instead of `$env:FASTFORWARD="1"; node ...`.
If PowerShell blocks `npm`, type `npm.cmd` and `npx.cmd` instead.

## The idea in one paragraph

Your app gets PayPal's messages ("payment done", "payment failed", "customer opened a complaint") and must react
correctly. Fastforward pretends to be PayPal, skips months of time in seconds, sends those messages (twice, late, forged),
and then tells you which mistakes your app made. To do that it needs three small things from your app:
**(1)** your app must start with the add-on (`fastforward-register`), which redirects its PayPal calls to Fastforward;
**(2)** it must tell Fastforward where its webhook door is; **(3)** optionally a small test-only door, the **probe**, that
answers "does this customer have access, and how many times did we fulfil?" Without the probe, the two most valuable
checks are skipped.

---

## Track A: you are building a new app

About 30 minutes. You will build a small coffee-subscription shop that handles PayPal correctly, watch Fastforward pass it,
then break it on purpose and watch Fastforward catch each mistake.

**A1. A new project.**
```
mkdir priya-shop ; cd priya-shop
npm init -y
npm install express
npm install --save-dev fastforward-register fastforward-cli
```
Expect: two installs with no red errors (about 65 and 85 packages).

**A2. Save this as `server.mjs`.** It is about 100 lines, and every part has a number that matches a job below.

```js
// A small coffee-subscription shop that handles PayPal's messages correctly. About 100 lines.
// Run it normally:        node server.mjs
// Run it under test:      FASTFORWARD=1 node --import fastforward-register server.mjs
import express from 'express';

const BASE = process.env.PAYPAL_API_BASE ?? 'https://api-m.sandbox.paypal.com'; // PayPal's SANDBOX, never the live address
const PLAN_ID = process.env.PAYPAL_PLAN_ID ?? 'P-COFFEE';
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID ?? 'WH-FF-LOCAL'; // under test, Fastforward signs with this id
const CLIENT = `${process.env.PAYPAL_CLIENT_ID ?? 'sandbox-id'}:${process.env.PAYPAL_CLIENT_SECRET ?? 'sandbox-secret'}`;

const customers = new Map(); // subscription id -> { access: boolean, fulfilments: number }. A real shop uses a database.
const handled = new Set(); // ids of webhook messages already dealt with

async function paypal(path, init = {}) {
  const token = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(CLIENT).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  }).then((r) => r.json());
  return fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${token.access_token}`, ...(init.headers ?? {}) } });
}

const app = express();
app.use(express.json());

// A customer signs up.
app.post('/subscribe', async (req, res) => {
  const { name, email } = req.body ?? {};
  const created = await paypal('/v1/billing/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_id: PLAN_ID, custom_id: email, subscriber: { name: { given_name: name }, email_address: email } }),
  }).then((r) => r.json());
  customers.set(created.id, { access: false, fulfilments: 0 });
  res.json({ subscription_id: created.id });
});

// PayPal tells us what happened.
app.post('/webhooks/paypal', async (req, res) => {
  const event = req.body;

  // 1. Is this really from PayPal? (the "seal" check)
  const verdict = await paypal('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: req.headers['paypal-auth-algo'],
      cert_url: req.headers['paypal-cert-url'],
      transmission_id: req.headers['paypal-transmission-id'],
      transmission_sig: req.headers['paypal-transmission-sig'],
      transmission_time: req.headers['paypal-transmission-time'],
      webhook_id: WEBHOOK_ID,
      webhook_event: event,
    }),
  }).then((r) => r.json());
  if (verdict.verification_status !== 'SUCCESS') return res.status(400).end();

  // 2. Have we handled this exact message before? (PayPal can send the same one twice)
  if (handled.has(event.id)) return res.status(200).end();
  handled.add(event.id);

  const r = event.resource;
  const isSale = event.event_type === 'PAYMENT.SALE.COMPLETED';

  // 3. Who has access? Ask PayPal for the subscription's current status instead of trusting the order messages arrive in.
  if (isSale || event.event_type.startsWith('BILLING.SUBSCRIPTION.')) {
    const id = isSale ? r.billing_agreement_id : r.id;
    const customer = customers.get(id) ?? { access: false, fulfilments: 0 };
    customers.set(id, customer);
    const sub = await paypal(`/v1/billing/subscriptions/${encodeURIComponent(id)}`).then((x) => x.json());
    customer.access = sub.status === 'ACTIVE';
    if (isSale) customer.fulfilments += 1; // <- a real shop sends the coffee here
  }

  // 4. A customer opened a complaint: answer it before the deadline (a real shop might alert a person instead).
  if (event.event_type === 'CUSTOMER.DISPUTE.CREATED') {
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify({ evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', tracking_info: [{ carrier_name: 'UPS', tracking_number: '1Z999AA10123456784' }] }] })], { type: 'application/json' }), 'input.json');
    await paypal(`/v1/customer/disputes/${encodeURIComponent(r.dispute_id ?? r.id)}/provide-evidence`, { method: 'POST', body: form });
  }

  res.status(200).end(); // 5. Answer quickly.
});

// TEST ONLY: lets Fastforward ask what we believe about a customer (its "peephole" into our data).
// It exists only when the app is started for a Fastforward test, so real customers can never reach it.
if (process.env.FASTFORWARD === '1') {
  app.get('/__ff/probe', (req, res) => {
    const c = customers.get(String(req.query.subscription_id));
    if (!c) return res.status(404).json({ error: 'unknown subscription' });
    res.json({ access: c.access, fulfilments: c.fulfilments });
  });
}

app.listen(process.env.PORT ?? 3000, () => console.log(`Priya's shop listening on ${process.env.PORT ?? 3000}`));
```

**A3. The five jobs your app must do** (these are what Fastforward checks; each is a numbered comment above):
1. **Check the seal.** Ask PayPal "is this message really yours?" and **reject** the message if the answer is not SUCCESS.
2. **Ignore repeats.** PayPal can send the same message twice; remember the ids you have handled.
3. **Decide access from the truth.** Ask PayPal for the subscription's current status instead of trusting the order
   messages arrive in. Give coffee only to ACTIVE subscriptions.
4. **Answer complaints.** When a dispute opens, answer before the 20-day deadline (or alert a person).
5. **Answer fast.** Reply to PayPal quickly; do slow work later.

**A4. Make a scenario file.**
```
npx fastforward-cli init
```
Expect "Wrote fastforward.yaml." Open it and delete the `# ` at the start of the two lines `# subscribeUrl:` and `# probeUrl:`
so Fastforward can also sign customers up through your app and ask the probe.

**A5. Run the test.** You need two PowerShell windows in the project folder.

Window 1, start your app **in test mode**:
```
$env:FASTFORWARD="1"; node --import fastforward-register server.mjs
```
Expect: `Priya's shop listening on 3000`.

Window 2:
```
npx fastforward-cli run fastforward.yaml
```
Expect: six checks with a tick each and **"No checks failed."** (about 10 seconds). Open the `report.html` file whose path it
prints, in your browser.

**A6. Break it on purpose, and watch it get caught.** In `server.mjs`, make one change at a time, restart window 1, and rerun
window 2. Put the line back after each.

| Break this | Delete this line | Expect |
|---|---|---|
| Duplicate messages | `  if (handled.has(event.id)) return res.status(200).end();` | **FULFIL_ONCE fails:** a customer was given what they paid for more times than payments completed |
| Ignoring a bad seal | `  if (verdict.verification_status !== 'SUCCESS') return res.status(400).end();` | **VERIFIES_SIGNATURES fails:** a forged notice was answered with 200 (it should be rejected with an error status) |
| Ignoring complaints | The whole block starting `  // 4. A customer opened a complaint` through its closing `}` | **DISPUTE_ANSWERED fails:** a dispute was not answered by its deadline |

Each failure comes with a plain explanation and a fix. If a change gives a different result than the table says, that is
worth telling Vinay.

**A7. Make it a habit.** Add to `package.json` a script `"test:billing": "fastforward-cli run fastforward.yaml"`. Start the
app in test mode, run `npm run test:billing` before you ship a change to your billing code, and fix anything red. Your real
customers never see Fastforward: it is a development tool, so it belongs in `devDependencies` (that is what `--save-dev` did).

---

## Track B: your app already exists

**B1. Is your app ready for it? Answer these five questions.**
1. **Is it a Node app?** The add-on only works with Node. (If it is PHP, Python, Ruby or Java, see "What does not work yet".)
2. **Can you point it at PayPal's sandbox** (practice) instead of live? It must not be hard-wired to live PayPal.
3. **Where is your webhook route?** (The address PayPal posts messages to, for example `http://127.0.0.1:3000/webhooks/paypal`.)
4. **How do you check a message's signature?** If you ask PayPal (`verify-webhook-signature`) or download its certificate, both work.
5. **Where do you keep "this customer has access" and "we fulfilled this payment"?** That is what the probe will report.

**B2. Install it in your project (development only).**
```
npm install --save-dev fastforward-register fastforward-cli
```

**B3. Start your app in test mode, with no change to your code.** Use your normal start file:
```
$env:FASTFORWARD="1"; $env:PAYPAL_WEBHOOK_ID="WH-FF-LOCAL"; node --import fastforward-register your-start-file.js
```
- `FASTFORWARD=1` switches the add-on on. Without it the add-on does nothing at all.
- `PAYPAL_WEBHOOK_ID=WH-FF-LOCAL` is the webhook id Fastforward signs with. Your signature check must use it in the test
  (read it from this setting, as the starter does), or every notice will look fake to you.
- If you start your app through a tool such as `tsx`, `ts-node` or `nodemon`, the add-on must load **before** your code.
  Tell Vinay which tool you use and he will check it.

**B4. Make a scenario that points at your webhook.** In another window:
```
npx fastforward-cli init --webhook-url http://127.0.0.1:YOUR_PORT/YOUR_WEBHOOK_PATH
```

**B5. Run it.**
```
npx fastforward-cli run fastforward.yaml
```
Expect a result, with **two checks reported as skipped** (state and fulfilment need the probe from B6). Read what failed. If
it says something went wrong with the setup instead, use the table at the end.

**B6. Add the probe (a small test-only door in your app).** It answers two questions for a customer. Adapt the two lines that read
your own data:
```js
if (process.env.FASTFORWARD === '1') { // exists only in a Fastforward test, never for real customers
  app.get('/__ff/probe', async (req, res) => {
    const customer = await findCustomerBySubscriptionId(String(req.query.subscription_id)); // your own lookup
    if (!customer) return res.status(404).json({ error: 'unknown subscription' });
    res.json({ access: customer.hasAccess, fulfilments: customer.timesFulfilled }); // your own fields
  });
}
```
Then in `fastforward.yaml` delete the `# ` before `probeUrl:` and set it to `http://127.0.0.1:YOUR_PORT/__ff/probe`. Restart the app
in test mode and run again. Expect **no skipped checks** this time.

**B7. Optional: let Fastforward sign customers up through your app.** Add a route that creates a PayPal subscription the way your
real sign-up does and answers `{"subscription_id": "I-..."}`, then uncomment `subscribeUrl:`. Without it Fastforward creates the
subscriptions itself, which is fine for a first try.

**B8. Read each failure** (the report says it in plain words; this is the short version):

| Check | If it fails, fix this |
|---|---|
| VERIFIES_SIGNATURES | Check every message's seal before acting, and **reject** (answer 400) any that fail |
| FULFIL_ONCE | Remember message ids you have handled; do not fulfil twice for one payment |
| STATE_MATCHES | Decide access from the subscription's current status, and handle suspended, cancelled and expired |
| DISPUTE_ANSWERED | When a dispute opens, answer it before the deadline or alert someone |
| ACK_FAST | Answer PayPal quickly; do slow work after replying |
| NO_LIVE_CALLS | Your app reached the real PayPal: point it at the sandbox |

**B9. Do not ship the probe unguarded.** The `if (process.env.FASTFORWARD === '1')` around it keeps it out of real use. Keep it.

---

## What does not work yet (honest limits)

- **Only Node apps.** The add-on works by hooking into Node. Other languages may be reachable by pointing the app's PayPal
  address at Fastforward's twin (`npx fastforward-cli twin`), but that is untested.
- **Only PayPal Subscriptions and Disputes**, and only calls from your **server** (PayPal buttons in the browser are not covered).
- **Sandbox only.** If your app is aimed at live PayPal, Fastforward blocks it on purpose.
- The comparison with real PayPal used card-funded subscriptions; see the README for the full list of known limits.

## If something goes wrong (the exact messages)

| You see | What it means and what to do |
|---|---|
| `can't reach your app at ...` | Your app is not running, or not at that address and port. Start it first and check `app.webhookUrl`. |
| `your app isn't redirected` | The app was not started with the add-on, or does not call PayPal while subscribing. Start it with `FASTFORWARD=1 node --import fastforward-register ...`. |
| `your app tried to call LIVE PayPal (...)` | Your app is aimed at live PayPal. Point it at the sandbox (`api-m.sandbox.paypal.com`) and use sandbox credentials while testing. |
| `port 4010 is already in use` | A Fastforward run is still open. Close it, or use `--twin-port`. |
| Every notice looks fake to your app | Your signature check is using a different webhook id. Use `PAYPAL_WEBHOOK_ID=WH-FF-LOCAL` in the test. |
| `STATE_MATCHES` and `FULFIL_ONCE` skipped | You have no probe yet (see B6). |

## Send feedback

If anything was unclear, slow, or did not match this page, tell Vinay: which step, what you expected, what happened.
