# Try Fastforward on your app (about 15 minutes)

Thank you for trying this. Fastforward is a hackathon project: it plays PayPal for your app, skips months of renewals
in seconds, and tells you which billing messages your app mishandled. It never touches real PayPal or real money.

**You need:** Node 24 or newer, and a Node app that uses PayPal Subscriptions on the sandbox. No PayPal login or keys.

## 1. Install the two helpers (development only)

In your app's folder:

```
npm install --save-dev fastforward-register fastforward-cli
```

## 2. Start your app in test mode

No code changes. Use your normal start file.

PowerShell:
```
$env:FASTFORWARD="1"; $env:PAYPAL_WEBHOOK_ID="WH-FF-LOCAL"; node --import fastforward-register your-start-file.js
```
Mac or Linux:
```
FASTFORWARD=1 PAYPAL_WEBHOOK_ID=WH-FF-LOCAL node --import fastforward-register your-start-file.js
```

`PAYPAL_WEBHOOK_ID=WH-FF-LOCAL` is the id Fastforward signs its messages with. If your app reads its webhook id from a
different setting, point that setting at `WH-FF-LOCAL` for the test.

## 3. Tell it where your webhook is

In a second terminal, in the same folder, with your own port and path:

```
npx fastforward-cli init --webhook-url http://127.0.0.1:3000/webhooks/paypal
```

This writes `fastforward.yaml`: a bad month with three customers and messy webhooks.

## 4. Run it

```
npx fastforward-cli run fastforward.yaml
```

It finishes in seconds. Open `report.html` from the folder it prints. Each failed check says what happened and how to fix it.

Two checks show as **skipped** on a first run. That is expected: they need step 5.

## 5. Optional: add the probe, so all six checks run

Add a small test-only route that reports what your app knows about one customer:

```js
if (process.env.FASTFORWARD === '1') { // exists only during a test
  app.get('/__ff/probe', async (req, res) => {
    const c = await findBySubscriptionId(String(req.query.subscription_id)); // your own lookup
    if (!c) return res.status(404).json({ error: 'unknown subscription' });
    res.json({ access: c.hasAccess, fulfilments: c.timesFulfilled }); // your own fields
  });
}
```

In `fastforward.yaml`, remove the `# ` before `probeUrl:` and set it to `http://127.0.0.1:3000/__ff/probe`. Restart your
app as in step 2 and run step 4 again.

## Something went wrong?

- **Every message is rejected as fake:** your signature check is not using `WH-FF-LOCAL` (step 2).
- **"Fastforward blocked a call to live PayPal":** your app points at live PayPal. Point it at `api-m.sandbox.paypal.com`.
- **Your app starts with `tsx`, `ts-node` or `nodemon`:** tell me which, and I will help.
- **Not a Node app:** not supported yet, sorry.

## No PayPal app handy?

Try the small flower shop in the repo instead (two minutes):
[examples/bean-and-bloom/README.md](../examples/bean-and-bloom/README.md).

## What I would love to hear back

Even three lines help:

1. What kind of app you tried it on.
2. What it found, or "nothing", which is useful too.
3. Was any of it a real bug? How long did setup take, and what confused you?

May I quote one line of your answer, with your name, in the hackathon submission? Only if you say yes.
