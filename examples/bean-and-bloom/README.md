# Bean & Bloom: reproduce the demo

Bean & Bloom is the flower-subscription shop from the demo video. It is an ordinary Express app in one file,
[`server.js`](server.js). It calls PayPal's sandbox with plain `fetch`, and it knows nothing about Test Clock.

**Nothing in it is planted, and it has no bug switch.** It verifies PayPal's signatures, reads the subscription's
real state, and answers disputes. Its developer forgot one thing: PayPal can deliver the same notice more than once,
and the shop never checks whether it has already seen one. That check is in the file as two commented-out lines.

## Run it yourself (about two minutes after the first build)

Needs Node 24, from the repository root.

1. **Start Test Clock.** This also opens the dashboard at <http://localhost:8080>.

   ```
   npm install
   npm run demo
   ```

2. **Start Bean & Bloom in a second terminal.** The add-on sends its PayPal calls to Test Clock instead of PayPal,
   so no keys are needed: any client id works.

   PowerShell:
   ```
   $env:FASTFORWARD='1'; $env:PAYPAL_CLIENT_ID='x'; $env:PAYPAL_CLIENT_SECRET='x'
   node --import fastforward-register examples/bean-and-bloom/server.js
   ```
   macOS or Linux:
   ```
   FASTFORWARD=1 PAYPAL_CLIENT_ID=x PAYPAL_CLIENT_SECRET=x node --import fastforward-register examples/bean-and-bloom/server.js
   ```

3. **Test it.** On the Choose step, pick **Your own app** and enter:

   | Field | Address |
   |---|---|
   | Webhook | `http://localhost:3001/webhooks/paypal` |
   | Subscribe | `http://localhost:3001/subscribe` |
   | Probe | `http://localhost:3001/__ff/probe` |

   Press **Start test**. One check fails: **Paid twice**. A repeated payment notice gave a customer a second box.
   The other five pass.

4. **Fix it.** In `server.js`, uncomment the two lines under "The forgotten check". Stop the shop (Ctrl+C), start it
   again as in step 2, and press **Start test**. All six checks pass.

## Or let the test do it

```
npx vitest run --project=e2e test/e2e/bean-and-bloom.e2e.test.ts
```

This runs the shop exactly as committed against the twin. It expects Paid twice to be the only check that fails.
Then it uncomments the two lines in a temporary copy and expects all six checks to pass.
