# Fastforward: voice-over for the Devpost video

The video on the form. Must stay under 3 minutes. Generate this voice first in Vinay's ElevenLabs voice, then record
the screen to it. Only the **Say** lines are sent to ElevenLabs. Film the Test Clock inside the concept frame
(`npm run demo`, then `npm run concept`, then <http://127.0.0.1:5180/#clock>).

Never say PayPal owns, paid for or endorsed this: it is a proposal.

## 1. What it is [0:00 to 0:15]

**Show:** title card.

**Say:** Test Clock is the testing tool PayPal's sandbox is missing. It lets developers who bill through PayPal
Subscriptions test months of renewals, failed cards and disputes in seconds. We built it as a proposal for PayPal's
developer dashboard.

## 2. Today in PayPal [0:15 to 0:35]

**Show:** the real PayPal webhook simulator page, with its sentence highlighted.

**Say:** Here's what you get today. PayPal's webhook simulator sends one mock event, and its own page says you cannot
verify, resend, or show details for those events. There's no way to reach next month's renewal. So the code that handles
a failed payment first runs with real money.

## 3. Step one: choose [0:35 to 0:50]

**Show:** the concept frame, Test Clock under Testing Tools, on the Choose step. "Concept, not PayPal" stays visible.

**Say:** This is how it could look inside PayPal's dashboard. It's a concept, not a PayPal product. Step one: choose the
app and the test. This is a demo shop with bugs we planted on purpose, facing a bad month. And before anything plays, the
page says what will be real and what will be simulated.

## 4. Step two: real sandbox first [0:50 to 1:20]

**Show:** the Watch step, the real sandbox column filling in.

**Say:** Step two. First, the real sandbox: a real subscription, and real notices with PayPal's own signatures. PayPal
answered success on every signature it received. One notice never arrived, and the screen says so. The sandbox can't fail
a renewal, so the declined card is simulated, but the suspension is real. Then Claude plays the customer. Sam runs a cafe
and needs the delivery, so Claude updates the card, and that reactivates the subscription on real PayPal.

## 5. Step two: the months the sandbox can't reach [1:20 to 1:45]

**Show:** the Watch step, the clock running and the events appearing.

**Say:** PayPal's sandbox can't move time, so our simulator takes over, built from PayPal's official specifications.
Seventy-five days play in seconds. Claude plays the customers: one pays, one's card fails, one disputes. Webhooks arrive
twice, late, out of order, and one is forged.

## 6. Step three: the result [1:45 to 2:10]

**Show:** the Result step: the six check tiles, then one problem card and its fix.

**Say:** Step three. Three of six checks fail. The shop never checked that messages came from PayPal, it shipped one
payment twice, and it ignored a dispute. Each one says where to look and how to fix it. Plain checks decide the result,
not the AI. Switch the planted bugs off, and all six pass.

## 7. Step four: the details, and why you can trust it [2:10 to 2:30]

**Show:** the Details step: the notices table, then PayPal match.

**Say:** Step four is every notice and every attempt. And to prove the simulator behaves like PayPal, we sent the same
seventeen requests to the real sandbox and to our simulator. The first runs found forty-nine differences. We fixed them,
and all seventeen steps now match.

## 8. Your own app [2:30 to 2:48]

**Show:** Inkwell in VS Code, the run failing on one check, then Claude Code fixing it and six of six green.

**Say:** It's not only our demo shop. This writing app uses only our npm packages. One forgotten check, and it finds
exactly that bug. A coding assistant can run the month, read why it failed, fix the code, and run it again.

## 9. Close [2:48 to 2:55]

**Show:** title card with the live demo and GitHub addresses.

**Say:** Test Clock. The testing tool PayPal's sandbox is missing, ready for PayPal to adopt.
