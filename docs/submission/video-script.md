# Fastforward: demo video script (under 3 minutes)

Target length: 2 minutes 40 seconds. Speak slowly. Times in brackets are rough.
No music, or only music you made or have the licence for. Show no logo that is not yours.
The video must be public on YouTube and show the project working on your own machine.

Before filming: run the full demo once (see the README), have Coffee Club ready, the dashboard open and a terminal ready. Do one practice take.

---

## 1. The money problem [0:00 to 0:25]

**On screen:** a plain title card, "Fastforward". Then a terminal.

**Say:**
"If your app takes PayPal subscriptions, one bug in your billing code costs you money. Maybe you keep serving someone whose payment failed. Maybe you cut off someone who would have paid.
The trouble is that you cannot test it. PayPal's sandbox has no clock, so you cannot skip to next month. It has no customers who misbehave.
So your code meets its first bad day with real money. Fastforward fixes that. It is a flight simulator for PayPal subscriptions."

## 2. Who pays [0:25 to 0:45]

**On screen:** a slide with three lines: "Free for one developer." "Target: $39 per developer per month." "Similar tools: LocalStack $39 to $89, Hookdeck about $39."

**Say:**
"Who pays? Developers and small teams who sell subscriptions through PayPal. It is free for one developer on their own machine. Our target for a team is thirty-nine dollars per developer per month, in line with similar tools. To be honest, that is a target. We have no customers yet. The first ones will be PayPal developers who try it before the deadline."

## 3. The live run, bugs on [0:45 to 1:25]

**On screen:** terminal. Start Coffee Club with bugs on, run the bad-month scenario. Show the report.

**Say:**
"Here is a small coffee subscription app. It uses PayPal's official SDK. It has bugs that I put in on purpose.
I run one command, and Fastforward plays seventy-five days in minutes, not months. AI plays three customers. Maya pays on time. Leo's card starts failing. Ana opens a dispute. And the webhooks arrive twice, late, out of order, and one is forged.
Now the report. Four of six checks fail. It did not verify signatures. It fulfilled an order twice. It ended in the wrong state. It ignored the dispute. Each failure has a plain explanation and a fix."

## 4. Same month, bugs off [1:25 to 1:45]

**On screen:** restart Coffee Club with bugs off, rerun the same scenario, show all six checks green.

**Say:**
"Now the same month, the same customers, the same bad weather. I only turned the bugs off. All six checks pass. So the checks are not noise. They find real bugs, and they go quiet when the bugs are gone."

## 5. Is the simulator honest? [1:45 to 2:10]

**On screen:** the dashboard panel "Checked against the real PayPal sandbox", real sandbox and twin side by side. Then the terminal, running the live fidelity check.

**Say:**
"A simulator is only useful if it behaves like the real thing. So we compared it to PayPal's real sandbox. The first run found twenty-seven differences. We fixed them. Now seven of seven endpoints match, on status, shape and PayPal's official specification. This panel shows it side by side. It covers the pending-approval path, and I will say plainly that approved subscriptions are not compared yet."

## 6. Fix it from your coding assistant [2:10 to 2:35]

**On screen:** a coding assistant connected to Fastforward. It writes a scenario, runs it, reads the explanation, fixes one bug in Coffee Club, runs again.

**Say:**
"You do not even have to leave your editor. Here a coding assistant is connected to Fastforward. It writes a scenario, runs it, reads why a check failed, fixes my code, and runs it again. The check goes from red to green."

## 7. The ask [2:35 to 2:50]

**On screen:** the title card with the repository address.

**Say:**
"Fastforward uses PayPal's official specs and SDK, Claude Opus 5.5 for the scenarios, the customers and the explanations, and AG Grid for the dashboard. It runs in three commands. Try it on your own PayPal app, and tell us what it caught. Thank you."

---

## Notes for Vinay (not spoken)

- **Check the number on screen.** The script says "four of six" for the bad-month scenario with the demo bug set (no slow-reply bug); Sara ran it live and got four. If your take shows a different number, say what the screen shows.
- **Section 6:** the MCP server is merged. Rehearse it once before filming.
- **Claim nothing the repo does not show.** No customer numbers, no revenue, no market size. The price is a target.
- The spoken text is roughly 400 words, about 2 minutes 40 seconds at a calm pace. If a take runs over, trim section 2 first.
