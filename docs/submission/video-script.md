# Fastforward: demo video script

**The video for the Devpost form is now `voiceover.md`.** It replaces the "(cut)" lines below, which are out of date:
ignore them. This file is only the optional full tour (scenes 1 to 15, about 12 to 15 minutes), an extra for YouTube.
Film it only if there is time left after submitting. Each scene has **Show** (what is on screen), **Do** (the exact
clicks or commands) and **Say** (the words).

Numbers to expect (check them on screen; if a take shows something else, say what the screen shows):
**3 of 6 checks fail** with the recorded Claude customers, **6 of 6 pass** with the bugs off, Inkwell passes
**6 of 6** written correctly and fails **1 of 6** with the bug, **17 of 17 steps**
match the real PayPal sandbox, a run of 75 days takes **about 3 seconds**.

---

## Before you press record

1. **Windows open, in this order:**
   - Terminal 1 (PowerShell) in `C:\Users\vinay\Desktop\PayPal-Hackathon`.
   - Terminal 2 (PowerShell), empty, for the safety demo.
   - Browser: the dashboard at <http://localhost:8080> (after step 2), zoom 110 to 125% so text is readable.
   - Terminals A and B (PowerShell) in `C:\Users\vinay\Desktop\inkwell-ff-trial`, for scenes 11 and 14.
   - VS Code with Claude Code on the Inkwell folder, Fastforward connected for scene 14:
     `claude mcp add fastforward -- npx -y fastforward-mcp`.
2. **Start the demo once before filming** so the build is warm: `npm run demo`, wait for
   "Open the dashboard", stop it with Ctrl+C. On camera it then starts in seconds.
3. Turn off notifications (Windows Focus), close other tabs, hide the bookmarks bar.
4. Dark mode is fine; the dashboard follows your system setting.
5. Only scene 13 spends money: it uses your Anthropic key, and one scenario costs a few cents. It is optional.
   Nothing else needs a key (scene 12 blocks the call before any connection opens).
6. No music unless you made it or hold the licence. Show no logo that is not ours.

---

## Scene 1. The money problem **(CUT)** [cut: 0:00 to 0:20]

**Show:** the dashboard's Overview, verdict "3 of 6 checks failed" in red.

**Say (cut):** "If your app sells subscriptions through PayPal, a bug in your billing code costs real money. You
keep shipping coffee to someone whose card stopped working, or you ship one order twice. And you can't test it,
because PayPal's sandbox has no clock: you can't jump to next month, and its customers never misbehave. So your
code meets its first bad month with real money."

**Say (tour, add):** "Every subscription business on PayPal has this code: what to do when a payment fails, when a
message arrives twice, when a customer disputes a charge. It's the code you test least and lose money on most."

## Scene 2. Who pays **(CUT)** [cut: 0:20 to 0:35]

**Show:** a plain slide: "$1 per AI test run. First 3 free. Scripted runs on your machine stay free."

**Say (cut):** "Fastforward is for developers and small teams who take recurring payments through PayPal. They pay
per test: our target is one dollar a test, with the first three free. That's a target: we have no paying customers yet."

**Say (tour, add):** "Why now? PayPal has no test clock at all. Stripe has test clocks, but only for Stripe, and with
no customers who behave like people. We found nothing that does this for PayPal Subscriptions. We start with PayPal,
and the same engine can cover other payment processors later."

## Scene 3. One command **(CUT)** [cut: 0:35 to 0:50]

**Show:** Terminal 1.

**Do:** `npm run demo`. Wait for the summary line and "Open the dashboard". Switch to the browser and refresh.

**Say (cut):** "One command. It starts a stand-in for PayPal, a small coffee subscription shop with bugs I switched
on, and the dashboard, then plays seventy-five days in about three seconds."

**Say (tour, add):** "The shop is called Coffee Club. It's a normal Node app using PayPal's official SDK, unmodified.
The stand-in, which we call the twin, is built from PayPal's official API specifications and answers the shop exactly
where PayPal's sandbox would. The month has three customers, played by Claude: Maya pays on time, Leo's card starts
failing in December, and Ana says her first bag never arrived and opens a dispute. And the webhooks, PayPal's
messages to the shop, come in bad weather: one in five arrives twice, some arrive late or out of order, and one is a
forgery."

## Scene 4. The verdict **(CUT)** [cut: 0:50 to 1:20]

**Show:** Overview. The six check tiles, then the three problem cards.

**Do:** point at the tiles, then at the first card's three pictures, then click **How to fix** on "Each payment is
fulfilled once". Scroll the drawer slowly: The fix, What a correct app does, What happened in this run. Close it.

**Say (cut):** "Three of six checks fail: the shop never checked that messages really came from PayPal, it shipped one
payment twice, and it ignored a dispute. Each card shows what happened in pictures, where in your code to look, and
Claude's fix."

**Say (tour, add):** "The verdict comes from plain checks, not from the AI, so the AI can't talk a bug into passing.
Claude only explains. The drawer shows the fix first, then what a correct app does, then the exact story: which
notice, which customer, which date. Each check has one colour and one icon across the whole dashboard, so you learn
it once."

## Scene 5. Time travel **(CUT)** [cut: 1:20 to 1:45]

**Show:** the Timeline tab, with the time controls at the top.

**Do:** drag the slider back to **1 Nov**. Click **+1 week** four or five times, slowly, watching markers appear.
Then drag to **mid December** and pause on Leo's row (red failed payments). Click **Run to end**.

**Say (cut):** "This is the part PayPal can't do. I can rewind the month and step through it a week at a time. Here
are Leo's failed payments in December. The checks and the verdict change as I move."

**Say (tour, add):** "Each line is a customer. Green is a payment, red is a failed one, the flag is Ana's dispute,
the shield is the forged message, the copy icon is a message PayPal delivered twice. Watch Leo: Claude's Leo ignored
two failed payments and updated his card on the third, the way a busy person does. A scripted customer would just keep
failing until suspended. A customer who behaves like a person tests your app in ways a script never would. Below the
timeline, a card per customer sums up their month."

## Scene 6. The deliveries [tour only, about 1 minute]

**Show:** the Deliveries tab. Mention AG Grid by name.

**Do:** tick **Show every attempt**, untick it. Go back to Overview, click **See the 9 notices** on the "fulfilled
once" card: the table narrows to those rows. Click a row with a **copy** chip. In the side panel, open the
**Problems**, **Attempts** and **Payload** tabs in turn.

**Say:** "Every message PayPal sent the shop, one row each. This table is AG Grid Community: sorting, filtering and
search come free. From the overview, 'See the 9 notices' narrows it to the paid-twice problem. This row is a copy: the
same payment, delivered a second time, and the shop answered 200 and shipped again. The side panel shows its problems,
every delivery attempt with the answer and how long it took, and the raw message exactly as PayPal would send it."

## Scene 7. The dispute [tour only, about 45 seconds; cut: 5 seconds inside scene 4 is enough]

**Show:** the Disputes tab.

**Say:** "Ana's dispute, as a conversation. PayPal opened it on 20 November and told the shop to reply by 10 December.
Ana's words were written by Claude. The shop said nothing, so PayPal ruled for the buyer: the shop loses the money even
if the coffee was delivered. Beside it, what a correct app does: save the reply-by date, and send evidence through
PayPal's disputes API in time."

## Scene 8. Same month, bugs off **(CUT)** [cut: 1:45 to 2:00]

**Show:** Terminal 1.

**Do:** Ctrl+C, then `$env:COFFEE_BUGS="none"; npm run demo`. Refresh the dashboard: all six tiles green.

**Say (cut):** "Same month, same customers, same bad weather. I only switched the bugs off. All six checks pass. So the
checks aren't noise: they catch real bugs and go quiet when the bugs are gone."

**After the scene:** `Remove-Item Env:COFFEE_BUGS` and restart `npm run demo`, so later scenes show the bugs again.

## Scene 9. Can you trust the simulator? **(CUT)** [cut: 2:00 to 2:20]

**Show:** the PayPal match tab: the blue note, the three score tiles, the table of 17 steps.

**Say (cut):** "A simulator is only worth it if it behaves like the real thing. So we sent the same seventeen requests
to PayPal's real sandbox and to Fastforward. The first runs found forty-nine differences. We fixed them all. Now all
seventeen steps match on status, shape and PayPal's published specification."

**Say (tour, add):** "This page tests Fastforward itself, not your app, which is why the bugs I switched on don't touch
its score. The steps cover creating, reading, suspending, reactivating and cancelling subscriptions, listing
transactions and refused actions. One difference is known and explained here: just after a card subscription is
created, the sandbox lists no payment yet and the twin lists it at once."

## Scene 10. The sample and a lost link [tour only, 20 seconds]

**Do:** open <http://localhost:8080/?run=old-run>.

**Say:** "Runs live in memory. Open an old link after a restart and the dashboard says that run has ended, shows a
recorded sample, and links straight to the current run. Nobody lands on a broken page."

## Scene 11. A brand-new app, straight from npm **(CUT)** [tour: about 2.5 minutes; cut: 2:20 to 2:35]

**The app:** **Inkwell**, in `C:\Users\vinay\Desktop\inkwell-ff-trial`. A writing app with a Pro plan at $8 a month,
billed through PayPal Subscriptions. Built on 28 Oct in its own folder, outside our repo, using only the public npm
packages. About 160 lines: Express, plain `fetch` (no PayPal SDK) and the SQLite database built into Node. It verifies
every notice with PayPal, reads the subscription's real status instead of trusting the order notices arrive in, handles
each notice once inside a database transaction, and answers disputes by refunding through PayPal's disputes API.

**Show:** VS Code open on the Inkwell folder: `package.json` (the two packages under devDependencies), then
`src/server.mjs`, scrolled slowly.

**Do:**
1. Terminal A, in the Inkwell folder: `$env:FASTFORWARD="1"; node --import fastforward-register src/server.mjs`
   (it prints "Inkwell listening on 3000 (Fastforward billing test)").
2. Terminal B, same folder: `npx fastforward-cli run fastforward.yaml`. **6 of 6 pass**, none skipped.
3. Put in a common bug: in `src/db.mjs`, line 41, change `if (fresh) work();` to `work();`. The app still writes down
   every notice id; it just forgets to check it.
4. Terminal A: Ctrl+C, Up arrow, Enter (restart). Terminal B: Up arrow, Enter.
   **Only "Each payment is fulfilled once" fails**: Maya was given Pro four times for three payments.
5. Open the report: `start .fastforward\runs\<run id>\report.html` (the run id is in the output).
6. Undo the bug (Ctrl+Z in `src/db.mjs`, save) before scene 14 or the next take.

**Do not click the "Dashboard: http://localhost:5173/..." line** the run prints. The npm package does not include
the dashboard, so that link opens nothing (a known issue the trial found). The report file works.

**Say (cut):** "This isn't our demo shop. It's a writing app built yesterday from our npm packages alone, with its own
database. Written correctly, six of six pass. One forgotten check, and Fastforward finds exactly that bug and nothing
else."

**Say (tour, add):** "Two packages from npm, and the app's code doesn't change: the add-on loads before the app and
quietly sends its PayPal sandbox calls to the twin, whether you use PayPal's SDK or plain fetch, as Inkwell does.
`fastforward init` writes a starter scenario; this one is three customers over ten weeks in bad weather. Watch the bug:
the app writes every notice id into its database but forgets to look it up, so a repeated notice gives Maya another
month of Pro. Real developers make this mistake, and it would only show up weeks later in production. Fastforward names
it in seconds and leaves a report you can share or attach to a pull request. Exit code one means a check failed, so it
drops straight into CI. Today it works with Node apps."

## Scene 12. It can't touch real money [tour only, 30 seconds]

**Show:** Terminal 2.

**Do:**

```
$env:FASTFORWARD="1"; node --import fastforward-register -e "fetch('https://api-m.paypal.com/v1/oauth2/token', { method: 'POST' }).catch(e => console.log((e.cause ?? e).message))"
```

**Say:** "While testing, anything aimed at live PayPal is stopped before a connection even opens. That's also the sixth
check: no calls to live PayPal. You can't charge a real card by accident."

## Scene 13. Claude writes the scenario [tour only, optional, needs your Anthropic key, a few cents]

**Do:** `npx fastforward-cli new "two customers over sixty days; one card fails twice in the second month, one disputes a late order" -o my-month.yaml`, then open `my-month.yaml`.

**Say:** "You can describe the month you're worried about in plain English, and Claude writes the scenario. It's an
ordinary file: you can read it, edit it and commit it. Claude plays the customers and explains failures; it never
decides pass or fail. Everything Claude decided is saved next to the scenario, so the same run replays exactly, with no
key, and the report labels which words are Claude's."

## Scene 14. Fix it from your coding assistant **(CUT)** [tour: about 2 minutes; cut: 2:35 to 2:52]

**Show:** VS Code with Claude Code, open on the **Inkwell** folder, connected to Fastforward
(`claude mcp add fastforward -- npx -y fastforward-mcp`, run once in that folder).

**Do:**
1. Make sure nothing else is on port 3000 (stop `npm run demo`). Put the scene 11 bug back in `src/db.mjs`
   (`work();` instead of `if (fresh) work();`) and start Terminal A again: `ff_run` needs the app already running.
2. Ask Claude Code: "Run fastforward.yaml with Fastforward and explain what failed." It calls `ff_run`, then
   `ff_explain`: "Each payment is fulfilled once" fails.
3. Ask: "Fix it." It should put the check back in `src/db.mjs`.
4. Restart Terminal A (Ctrl+C, Up arrow, Enter) so the fixed code is what runs. Plain JavaScript: no build step.
5. Ask: "Run it again." Six of six, green.

**Say (cut):** "You don't even have to leave your editor. Connected to Fastforward, a coding assistant runs the month,
reads why a check failed, fixes the code and runs it again. Red to green."

**Say (tour, add):** "Fastforward ships an MCP server with three tools: write a scenario, run it, explain a failure. Any
assistant that speaks MCP can use it."

**Rehearse this scene at least once.** If the assistant wanders, ask it step by step.

## Scene 15. The close **(CUT)** [cut: 2:52 to 3:00]

**Show:** a title card: "Fastforward", the live demo address and the GitHub address.

**Say (cut):** "Fastforward: PayPal's official specs and SDK, Claude for the customers and the explanations, AG Grid for
the dashboard. Try it on your PayPal app and tell us what it caught. Thank you."

---

## Notes (not spoken)

- **The cut runs about 2:58.** If a take runs over, shorten scene 4's spoken line first, then scene 9's. Never cut
  scene 2 (who pays): the judges' first question is whether it makes money.
- **Claim nothing the screen does not show.** No customers, no revenue, no market size. The price is a target.
- **"Forty-nine differences"** is the 27 found on the pending path plus the 22 on the active path (README, "How PayPal
  is used").
- **If a number differs on screen** (for example the scripted customers give 4 of 6), say what the screen shows.
- Live demo for judges: <https://fastforward-production.up.railway.app/> (a finished run; the Timeline tab replays it).
