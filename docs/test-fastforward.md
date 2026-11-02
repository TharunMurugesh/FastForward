# Test Fastforward: a guide for outside developers

Thank you for giving this your time. Pick **one** level. Each one ends with what you should see, so you know whether it
worked. Then answer the three questions at the bottom: that is the part that helps most.

**Fastforward in one line:** it plays PayPal for your app, skips a month of billing in seconds (failed cards, duplicate
webhooks, forged webhooks, a dispute) and tells you which of those your code handles wrong. It never touches real PayPal
and needs no PayPal keys.

| Level | Time | You need |
|---|---|---|
| 1. Look at the live demo | 5 min | A browser |
| 2. Run it on your machine and turn the bugs off | 10 min | Node 24 or newer, git |
| 3. Run it on your own app | 30 to 45 min | A Node app that uses PayPal Subscriptions |

---

## Level 1: the live demo (5 minutes)

Open <https://fastforward-production.up.railway.app/>. It shows a finished test of **Coffee Club**, a small demo shop
with three bugs left in on purpose. Three customers lived through 75 days: Maya paid every month, Leo's card failed,
and Ana opened a dispute.

Do these five things, in order:

1. **Overview.** Six tiles, one per check. **Expect: 3 of 6 fail.** Read one red card from top to bottom: what happened,
   who it hit, and the fix.
2. On a failed card, click **How to fix**. Ask yourself: would you know what to change in your own code from this?
3. On the same card, click **See the N notices**. You land on **Deliveries**, filtered to the webhooks behind that failure.
   Click a row, then open the **Attempts** and **Payload** tabs in the side panel.
4. **Timeline.** Drag the slider back to the start, then press **Run to end** and watch the month replay.
5. **Disputes.** Read Ana's complaint and what the shop did (nothing, before the deadline).

**Look out for:** anything you did not understand within a few seconds, anything that looked wrong, and anything you
looked for and could not find.

---

## Level 2: on your machine, bugs on and off (10 minutes)

```
git clone https://github.com/VinayG759/FastForward.git
cd FastForward
npm install
npm run demo
```

Open <http://localhost:8080>. **Expect: the same result as the live demo, 3 of 6 checks fail.** Stop it with Ctrl+C.

Now turn the demo shop's bugs off and play the same month again:

```
# PowerShell
$env:COFFEE_BUGS="none"; npm run demo
# Mac / Linux
COFFEE_BUGS=none npm run demo
```

**Expect: 6 of 6 pass.** That is the point: the same month, played against correct code, raises nothing. (On Windows,
if PowerShell blocks `npm`, type `npm.cmd`.)

**Optional, if you have 5 more minutes:** switch on one bug at a time and see whether Fastforward names the right
mistake. For example `$env:COFFEE_BUGS="no-dedupe"; npm run demo` (the shop no longer ignores a duplicate webhook)
should fail only the "fulfil once" check. The bug names are `no-verify`, `no-dedupe`, `slow-ack`, `ignores-suspend`,
`ignores-disputes` and `trusts-event-order`; their code is in `examples/coffee-club/src`.

---

## Level 3: your own app (30 to 45 minutes)

This is the real test. Your app must be **Node**, take **PayPal Subscriptions** from the server side, and be able to point
at PayPal's **sandbox**. No change to your code is needed for the first run.

Follow **Track B** step by step: [try-it-on-your-app.md](try-it-on-your-app.md#track-b-your-app-already-exists).
The short version:

1. `npm install --save-dev fastforward-register fastforward-cli`
2. Start your app with the add-on: `FASTFORWARD=1 PAYPAL_WEBHOOK_ID=WH-FF-LOCAL node --import fastforward-register your-start-file.js`
3. `npx fastforward-cli init --webhook-url http://127.0.0.1:YOUR_PORT/YOUR_WEBHOOK_PATH`
4. `npx fastforward-cli run fastforward.yaml` and read the report.

**Expect:** a result with two checks **skipped** until you add the small test-only "probe" (step B6). That is normal.

**Please do not** run it against a live PayPal setup: Fastforward blocks live calls on purpose, and you will see a message
saying so.

**Most useful to report from this level:** did it find something real in your code? Was any failure wrong (a false alarm)?
Where did setup get stuck, and what exact message did you see?

---

## Three questions (a line each is plenty)

1. **What was confusing,** or what did you expect that was not there?
2. **Has a payment bug like these ever hit you** or a team you know (fulfilling twice, missing a failed payment, an
   unanswered dispute)? Roughly what did it cost?
3. **Would you pay $1 per test run for this?** If not, what would make it worth it, or what price
   would?

Send your answers to Vinay G on LinkedIn, or open an issue at <https://github.com/VinayG759/FastForward/issues>.
Tell us whether we may quote you by name; we will not quote anyone without asking.
