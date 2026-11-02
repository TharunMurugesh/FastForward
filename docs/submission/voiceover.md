# Fastforward: voice-over for the Devpost video

The video on the form. Must stay under 3 minutes. Generate this voice first in Vinay's ElevenLabs voice, then record
the screen to it. Only the **Say** lines are sent to ElevenLabs. About 400 words, roughly 2:50 at a calm pace.

**Before generating:** record a real run (`fastforward real <scenario.yaml> --public-url <https://...> --report-dir
fidelity`), then make scene 4 say what the customer actually chose in that run. The choice is saved, so a rerun
repeats it. Sandbox delivery varies, so film the recording on the Real PayPal page, not a run in progress.

## 1. What it is, who pays [0:00 to 0:18]

**Show:** title card, then the price: $1 per test, first 3 free.

**Say:** Fastforward is the test clock PayPal's sandbox is missing. It's for developers who bill through PayPal
Subscriptions, and they pay per test: our target is one dollar per test, with the first three free. We have no paying
customers yet.

## 2. Today in PayPal [0:18 to 0:38]

**Show:** the real PayPal webhook simulator page, with its sentence highlighted.

**Say:** Here's what you get today. PayPal's webhook simulator sends one mock event, and its own page says you cannot
verify, resend, or show details for those events. There's no way to reach next month's renewal. So the code that handles
a failed payment first runs with real money.

## 3. With Fastforward [0:38 to 0:50]

**Show:** the concept screen: Test Clock under Testing Tools, with "Concept, not PayPal" visible.

**Say:** This is how it would work inside PayPal's dashboard, if PayPal gives us permission. It's a concept, not a
PayPal product. We check the app is integrated and has credits. Everything after that is our working app.

## 4. Real PayPal first [0:50 to 1:25]

**Show:** the Real PayPal page: the step cards, then the table of notices.

**Say:** First, the real sandbox. A real subscription, and real notices with PayPal's own signatures passed to the app.
PayPal itself answered success on every signature. Each step says whether it was real PayPal or simulated. The sandbox
can't fail a renewal, so the declined card is simulated, but the suspension is real. Then Claude plays the customer. Here,
Leo, who rarely reads his email, ignored it, so his subscription stayed suspended.

## 5. The months the sandbox can't reach [1:25 to 1:50]

**Show:** the Timeline tab: drag back to 1 November, step forward, stop on Leo's failed payments.

**Say:** PayPal's sandbox can't move time, so our simulator takes over, built from PayPal's official specifications.
Seventy-five days play in about three seconds. Claude plays the customers: one pays, one's card fails, one disputes.
Webhooks arrive twice, late, out of order, and one is forged.

## 6. What it finds [1:50 to 2:15]

**Show:** Overview: the six check tiles, one problem card, then all six green with the bugs off.

**Say:** Three of six checks fail. The shop never checked that messages came from PayPal, it shipped one payment twice,
and it ignored a dispute. Each one says where to look and how to fix it. Plain checks decide the result, not the AI.
Switch the bugs off, and all six pass.

## 7. Why you can trust it [2:15 to 2:30]

**Show:** the PayPal match page.

**Say:** We sent the same seventeen requests to PayPal's real sandbox and to our simulator. The first runs found
forty-nine differences. We fixed them, and all seventeen steps now match.

## 8. Your own app [2:30 to 2:48]

**Show:** Inkwell in VS Code, the run failing on one check, then Claude Code fixing it and six of six green.

**Say:** It's not only our demo shop. This writing app uses only our npm packages. One forgotten check, and Fastforward
finds exactly that bug. A coding assistant can run the month, read why it failed, fix the code, and run it again.

## 9. Close [2:48 to 2:55]

**Show:** title card with the live demo and GitHub addresses.

**Say:** Fastforward. The test clock PayPal's sandbox is missing. Try it on your PayPal app.
