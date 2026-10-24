# How Fastforward works, in simple words

Written for Vinay, 24 Oct 2026. Read it top to bottom once. Then try the teach-back at the end: explain it back in your
own words and I will correct you. Every number in here was checked against the real project.

## 1. The problem, as a restaurant

Think of a restaurant.

- **PayPal** is the supplier. It delivers ingredients (money, and messages about money) to your restaurant.
- **The developer's app** (for example a coffee subscription shop) is the restaurant. Its kitchen has to handle every
  delivery correctly.
- **A webhook** is a delivery. PayPal knocks on the app's door with a message such as "a payment completed", "a payment
  failed" or "a customer opened a complaint".

Real deliveries are messy. The supplier sometimes knocks twice, comes late, comes in the wrong order, or a stranger
pretends to be the supplier. And money things happen over months: renewals, cards that expire, complaints.

PayPal's **sandbox** (its practice area) cannot practise any of that. It has **no clock**, so you cannot skip to next
month, and no customers who misbehave. So a developer first meets these problems with real money.

**Fastforward is a movie set of the supplier, with a time machine and an inspector.** It pretends to be PayPal, jumps
through months in seconds, sends every kind of messy delivery, and then the inspector reads the whole day's record and
says which mistakes the restaurant made.

**Who pays:** developers and small teams who take PayPal subscriptions. Free for one developer; our target for a team is
$39 per developer per month, in line with similar tools. That is a target, not revenue: nobody has paid yet.

## 2. The pieces (each one is a folder)

| Piece | In restaurant words | What it really is |
|---|---|---|
| `packages/contracts` | The shared dictionary | The exact shape of a scenario file, a webhook event, a log entry (the "trace") and a report. Every other piece reads this one book, so they never misunderstand each other. |
| `packages/twin` | The fake supplier (the biggest piece, about 3,300 lines) | The stand-in PayPal. It keeps subscriptions, charges, failures, disputes, signs and sends webhooks, and has its own clock. |
| `packages/register` | A switch fitted to the restaurant's phone | A tiny add-on the app loads when it starts. It sends the app's PayPal calls to the fake supplier, and slams the door on real PayPal. |
| `packages/ai` | The actors and the writer | Claude plays the customers, and writes the explanations of what went wrong. |
| `packages/cli` | The director | The `fastforward` command. It reads the scenario, runs the day, calls the inspector, writes the report. |
| `packages/mcp` | A walkie-talkie for coding assistants | Lets an assistant like Claude Code write, run and explain scenarios. |
| `apps/web` | The monitor in the control room | The dashboard: a page that replays the day with tables, a timeline and the report. |
| `examples/coffee-club`, `examples/plain-fetch-shop` | Two practice restaurants | Small shop apps with bugs you can switch on. They are what we test against. |
| `scripts/` | The delivery and packing crew | Build the npm packages, check them, start the hosted demo, record an AI run, check versions. |
| `fidelity/latest.json` | The lab report | Proof, from the real PayPal sandbox, that the fake supplier behaves like the real one. |

## 3. One run, step by step

You type: `fastforward run bad-month.yaml`. Here is what happens, in order.

**Step 1: the script (the scenario).** `bad-month.yaml` says: three customers over 75 days starting 1 Nov 2026.
*Maya* pays on time. *Leo's* card starts failing on 1 Dec. *Ana* complains on 20 Nov that her coffee never arrived. The
"weather" is 20% of messages sent twice, 10% out of order, random delays up to 90 minutes, and one forged message.

**Step 2: is the restaurant open?** The command checks the app answers at its webhook address. If not, it stops with a
message saying what to do (start the app with the add-on, check the address).

**Step 3: the fake supplier starts and the clock is set.** The twin makes a **Run**: a fresh pretend world with its own
**virtual clock** starting 1 Nov. All its ids (subscription, payment, dispute) follow the scenario's seed, so the same
scenario always gives the same ids.

**Step 4: customers sign up.** For each customer, the twin asks the app to subscribe them. The app does exactly what it
does in real life: it asks PayPal to create a subscription, using PayPal's official software kit. But the app was started
with the **register add-on**, so that request goes to the twin instead. The twin creates the subscription, the pretend
customer approves it, it becomes ACTIVE, and the first payment is taken. Each of these makes a **webhook event**.

**Step 5: the time machine.** The twin never waits for real time. It keeps a list of "things that happen at date X"
(renew Maya on 1 Dec, retry Leo's card on 6 Dec...) and jumps the clock to the next one, runs it, jumps again. 75 days
take a few seconds. Real PayPal's rules are copied in: a failed payment is retried every 5 days, twice; a failure counts
once the second retry fails; two failures in a row suspend the subscription.

**Step 6: deliveries, with weather.** Every event becomes a webhook delivery. The twin **signs** it the way PayPal does
(a secret-key stamp the app can verify), then the weather decides: send twice? late? out of order? or swap in a forged
one with a bad stamp? It posts the message to the app's door and records what the app answered and how fast. If the app
does not answer in time, the twin retries later, like PayPal.

**Step 7: the customers decide.** When Leo's payment fails, or the seller messages Ana, a pretend customer must choose
what to do: ignore it, update the card, cancel, dispute, reply. That choice comes from the AI, a saved recording, or a
scripted default (section 5).

**Step 8: the flight recorder.** Everything is written to the **trace**: every event, every delivery and how the app
answered, every question to the app about who currently has access (a "probe"), every call the app made back to the
twin, every customer decision, every attempt to reach real PayPal.

**Step 9: the inspector (six checks).** After the last day, six plain rules read the trace (section 4). They produce
pass or fail, with the exact messages as evidence. **No AI is involved in pass or fail.**

**Step 10: explanations.** For the first three findings of each failed check, the tool writes "what happened and how to
fix it": from a saved Claude recording if one exists, else Claude live, else a built-in template. Each is labelled.

**Step 11: the report.** The command writes `report.json` and a single-file `report.html`, hands the explanations to the
twin so the dashboard has them too, prints a summary, and exits with 0 (all passed), 1 (a check failed) or 2 (it could
not run).

## 4. The six checks, in one line each

1. **ACK_FAST:** did the app answer every delivery quickly (within 10 seconds)?
2. **VERIFIES_SIGNATURES:** before acting on a delivery, did the app check the stamp really came from PayPal? (The forged
   message is the trap.)
3. **STATE_MATCHES:** at each checkpoint, does the app's idea of "this customer has access" match the subscription's
   true status? (Catches serving someone who was suspended.)
4. **FULFIL_ONCE:** was each payment fulfilled exactly once? (Catches duplicates handled twice.)
5. **DISPUTE_ANSWERED:** did the app answer every complaint before the 20-day deadline? (If not, PayPal rules for the
   buyer.)
6. **NO_LIVE_CALLS:** did anything try to reach the real PayPal? (Must never.)

## 5. The AI, exactly

Model: `claude-opus-5-5`. Three jobs: write a scenario from plain words, play customers (at low effort), explain
failures (at medium effort).

- **Recording and replay.** The first time Claude plays a scenario, what it decided is saved next to the scenario
  (`bad-month.lock.json`) and what it wrote is saved too (`bad-month.narration.lock.json`). Later runs read those files
  and need **no key and no money**. This is how the live demo shows real Claude output without calling Claude.
- **Labels.** Every explanation says "Written by Claude" or "Built-in text". The report says how many decisions and
  explanations the model wrote and whether it ran live or was replayed.
- **Spend guard.** A run stops after 100 model calls (setting `FF_AI_MAX_CALLS`), and the recording script does nothing
  without `--yes`. Our one real recording used 10 calls and about 16,000 tokens.
- **Only real model output is ever saved**, never a template. Without a key, everything still works with scripted
  customers and built-in text.

## 6. The dashboard

A web page that reads the twin's control API (a set of addresses starting `/_ff/`). It shows: the **Report** tab (the
verdict, each failed check with its explanation and a label), the **Deliveries** table (one row per message, sortable and
filterable, with tags for duplicate and forged), the **timeline** (a row per customer along the dates), the **Event** tab
(one message in detail), the **Dispute** tab (the complaint as a conversation), and at the bottom the **real-PayPal
comparison**. Time controls work on a live run; on the finished demo they are greyed out.

## 7. How we know the fake supplier is faithful (fidelity)

A test sends the **same 17 requests** to the real PayPal sandbox and to the twin and compares three things: the status
code, the shape of the answer (which fields, what types, never the values), and PayPal's own published specification.
- First run on the "waiting for approval" path: 27 differences. First run on the active path: 22. We fixed every one;
  now **17 of 17 steps match**.
- One difference is understood and recorded: right after creating a subscription, the real sandbox lists no
  transactions yet, while the twin lists the payment at once.
- Honest limits: it uses **card-funded** subscriptions (the only way to get an active one without a person clicking in a
  browser), not ones approved with a PayPal wallet; and one timing is a guess (does the failure that reaches the limit
  suspend at once or after its retries?). PayPal does not say, and the sandbox has no clock to test it.
- The result is saved in `fidelity/latest.json` (shapes only, no ids, tokens or emails) and shown on the dashboard.

## 8. How it gets to other people

- **npm:** three packages: `fastforward-cli` (the command), `fastforward-register` (the add-on), `fastforward-mcp` (for
  assistants). A script bundles the twin, AI and contracts inside the CLI so it installs alone. A test installs the packed
  files into an empty folder and runs the bad month, the way a stranger would.
- **The live demo:** a Docker image runs three programs in one container: the twin (port 4010), Coffee Club (3000) and
  the dashboard server. It plays the bad month once at start (about 3 seconds, replaying the Claude recording), then
  serves the result. It is **read-only**: anything that tries to change it gets "405". It runs on Tharun's Railway
  account, built from his copy of the repository.
- **GitHub checks (CI):** on every push: build, 468 unit tests, the package install test, 6 end-to-end tests (about a
  minute), a version-consistency check and a security audit of dependencies.

## 9. What keeps it safe

Real PayPal is blocked by the add-on before a connection opens. The twin keeps only the safe parts of a card (never the
number or security code). No keys are in the packages or the repository. The public demo cannot be changed. Model spend
is capped. The evidence file is scanned for ids, tokens and emails before it is written.

## 10. What is real and what is pretend

Real: the code, the checks, the comparison against PayPal's real sandbox, the Claude output (recorded). Pretend: all
money, all customers, all time, and PayPal itself. Not covered: wallet-approved subscriptions, other PayPal products,
non-Node apps.

## 11. Where things live

`packages/twin/src/`: `time/` (clock and scheduler), `subscriptions/` (billing rules), `disputes/`, `webhooks/` (signing,
sending, weather), `checks/` (the six), `run/` (one pretend world), `control.ts` (the `/_ff` addresses). `packages/cli/src/`:
`runner.ts` (the eleven steps), `init.ts`, `html-report.ts`. `packages/ai/src/`: `customers.ts`, `narrator.ts`, the two lock
files' code, the spend guard in `client.ts`. `apps/web/src/`: `App.tsx` and `panels/`, `grids/`, `timeline/`. `scripts/`:
`start-hosted.mjs`, `bundle.mjs`, `pack-check.mjs`, `record-ai-run.mjs`.

## Teach-back (try it in your own words)

1. What problem does Fastforward solve, for a stranger, in one sentence?
2. What is a webhook, and what are four ways real ones misbehave?
3. What does the register add-on do, and why is it needed?
4. What is the twin, and how does it make 75 days take 3 seconds?
5. Who decides pass or fail, and why is that not the AI?
6. What does Claude do, and how can the demo show Claude without calling it?
7. How do we know the twin behaves like real PayPal, and what are the two honest limits?
8. Who pays, how much, and what is the weakest part of that answer?
