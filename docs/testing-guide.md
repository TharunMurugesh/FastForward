# Fastforward: how to test it end to end

For the person testing it (about 60 to 90 minutes). You do not need to write code. Every step says what to do, what you
should see, and what to send back if you see something else.

## What you are testing, in plain words

Fastforward is a practice PayPal for developers. A developer's app that takes PayPal subscriptions is hard to test,
because PayPal's test area has no clock and no misbehaving customers. Fastforward pretends to be PayPal: it fast-forwards
time, sends the bad events real life has (duplicate messages, late ones, forged ones), has simulated customers pay, fail and
complain, and then tells the developer which mistakes their app made. The customers can be played by an AI (Claude).

The demo app, **Coffee Club**, is a small coffee subscription shop with five bugs put in on purpose. Fastforward should
catch them.

Words you will see:
- **Webhook / notice:** an automatic message PayPal sends to the app, such as "a payment completed".
- **Check:** one of six tests Fastforward runs on the app (for example "does it verify the message really came from PayPal").
- **Twin:** Fastforward's stand-in for PayPal.
- **Simulated / virtual date:** everything is pretend. No real money, no real PayPal.

## Before you start

- A browser (Chrome, Edge or Firefox). Parts B to F also need **Node 24 or newer** and **Git** (check with `node -v`).
- Commands are for **Windows PowerShell**. On Mac or Linux, use `export NAME=value` instead of `$env:NAME="value"`.
- **Do not ask for, or use, Vinay's Anthropic API key.** Using it costs him money. Everything you need is free (the demo
  replays a recording). Only the optional test C3 uses a key, and only Vinay runs that one.
- Part A needs nothing installed. Start there.
- **Windows PowerShell may refuse to run `npm`** with a red message about `npm.ps1` and "running scripts is disabled". This is a
  Windows safety setting, not a Fastforward problem. Type **`npm.cmd`** instead of `npm` (for example `npm.cmd install`,
  `npm.cmd run build`, `npm.cmd test`) and everything works without changing any setting. (Tharun hit this on 24 Oct.)

## Known limits (please do not report these as bugs)

- The live page is a **replay** of one recorded run of Claude. It does not call an AI while you look.
- The live page is a finished run, so the time buttons ("+1 day", "Run to end") are greyed out.
- The real-PayPal comparison covers subscriptions paid with a **card**, not ones approved with a PayPal wallet. One
  difference is recorded and explained on the page (the transactions list just after creation).
- Fastforward is on npm **later**. For now it is installed from the GitHub repository.
- The run id in the page address (`run-xxxxxxxx`) changes each time the site is redeployed. That is normal.
- Node apps only. Only PayPal Subscriptions and Disputes.

---

## Part A: the live site (no install)

Live address: **https://fastforward-production.up.railway.app/**

| # | Do | You should see |
|---|---|---|
| A1 | Open the address. | The page loads and the address becomes `.../?run=run-` plus 8 letters or digits. The top says "Fastforward", a green chip "Live run run-...", and a grey chip "Simulated". |
| A2 | Look at the line under the red verdict in the **Report** tab (right side). | "**3 of 6 checks failed**", and under it: "claude-opus-5-5 wrote 3 of 3 customer decisions and 7 of 7 explanations (no model calls now, replayed from a recording)". |
| A3 | In the Report tab, read the check list. | Failed: "App verifies each notice is from PayPal", "Each payment is fulfilled once", "Disputes are answered in time". Passed: "App answers PayPal fast", "Access matches the subscription status", "No calls to live PayPal". |
| A4 | Click "What happened and how to fix it" on a failed check. | A plain explanation, a "Fix:" line, and a small label "**Written by Claude**". The text should make sense to a non-expert. |
| A5 | Click the number button next to a failed check (for example "19 notices" next to the signature check). | The table on the left filters to only the evidence for that check, and a line says "Showing evidence for ...". Click "Show all" to undo. |
| A6 | Look at the **Deliveries** table (left). Sort a column by clicking its header. Type `WH` in "Search deliveries". Tick "Failing checks only", then "Show every attempt". | A table of notices. Sorting, search and the two ticks all work, and the numbers on the ticks change. In the "Findings" column one notice has a **forged** tag and some have **duplicate** tags. |
| A7 | Click any row in the table. | The **Event** tab opens with that notice's details (its text, its attempts, what the app answered). |
| A8 | Look at the **timeline** above the table. | Three rows (Maya, Leo, Ana) with markers along the dates 1 Nov 2026 to 15 Jan 2027. |
| A9 | Click the **Dispute** tab. | Ana's dispute: "Dispute opened: merchandise or service not received. Seller must respond by 2026-12-10", then her message about the coffee, then "Resolved in the buyer's favour" (because the app never answered). |
| A10 | Scroll to the bottom: **Checked against the real PayPal sandbox**. | "17 of 17 steps match PayPal's shape (1 known, explained difference)". A table with a **Step** column (create subscription, get active subscription, suspend, activate, cancel, ...). Every row shows "match" in the shape and spec columns. The "list transactions" row has a known difference with a reason. |
| A11 | Try the time controls at the top. | They are greyed out (finished run). The text says "Time only moves forward in a live run". |
| A12 | Make the browser window narrow (or open the address on a phone). | Look for anything cut off, overlapping or unreadable, or the whole page scrolling sideways. Report what you see either way. |
| A13 | Switch your computer between light and dark mode. | Look for text that becomes hard to read in either mode. Report what you see either way. |
| A14 | Press the Tab key repeatedly from the top of the page. | Check that you can reach the tabs and buttons without the mouse, and that you can see where the focus is. Report what you see either way. |

### A15: the site must be read-only (safety)

Nobody on the internet should be able to change the live site. In PowerShell (use `curl.exe`, not `curl`):

```
curl.exe -X POST -s -o NUL -w "%{http_code}`n" https://fastforward-production.up.railway.app/_ff/runs -d "{}"
curl.exe -X PUT  -s -o NUL -w "%{http_code}`n" https://fastforward-production.up.railway.app/_ff/runs/x/explanations -d "{}"
curl.exe -X POST -s -o NUL -w "%{http_code}`n" https://fastforward-production.up.railway.app/demo/subscribe -d "{}"
```

**Expect `405` three times.** Anything else is a **serious** problem: tell Vinay at once.

### A16: a few direct links

| Open | Expect |
|---|---|
| `https://fastforward-production.up.railway.app/fidelity/latest.json` | A JSON text with 17 entries under `checks`. No ids, tokens or email addresses. |
| `https://fastforward-production.up.railway.app/demo/__ff/probe?subscription_id=nope` | `{"error":"unknown subscription"}` |
| `https://fastforward-production.up.railway.app/does-not-exist` | The dashboard page again (not an error page). |

---

## Part B: install it and run it on your own computer

Fastforward is not on npm yet, so it is installed from the repository.

| # | Do | You should see |
|---|---|---|
| B1 | `node -v` | `v24.` or higher. If lower, install Node 24 first. |
| B2 | `git clone https://github.com/VinayG759/FastForward.git` then `cd FastForward` | A folder with `README.md`, `package.json`, `docs`, `packages`. |
| B3 | `npm install` (1 to 2 minutes) | Ends with "added ... packages". Warnings are fine; red errors are not. |
| B4 | `npm run build` | Ends quietly (no red text). |
| B5 | `npm test` | "Test Files ... passed", "Tests ... passed" (about 470 tests, **0 failed**), about 15 to 30 seconds. |
| B6 | `npm run demo` (builds, then starts everything; wait about 20 seconds) | Lines like "Fastforward is up: dashboard http://localhost:8080", then "AI: claude-opus-5-5 wrote 3 of 3 customer decisions and 7 of 7 explanations (no model calls now, replayed from a recording)", "3 of 6 checks failed.", and "Open the dashboard: http://localhost:8080/?run=run-...". |
| B7 | Open that address in your browser. | The same dashboard as the live site (A1 to A14 should all hold, except A15, which is for the live site). |
| B8 | Stop it: press **Ctrl+C** in the PowerShell window. | The window returns to a prompt. |
| B9 | Same demo with the bugs switched **off**: `$env:COFFEE_BUGS="none"; npm run demo` | "Coffee Club bugs: none" and "**No checks failed.**" Open the dashboard: the Report tab says "All checks passed". Press Ctrl+C, then `Remove-Item Env:COFFEE_BUGS`. |
| B10 | `npm run test:e2e` (about 1 minute) | "Test Files 2 passed", "Tests 6 passed". These run the real shop apps against Fastforward. |
| B11 | `npm run pack:check` (about 30 seconds) | Ends with "**pack-check: OK**", after "packed CLI + packed add-on: 4 of 6 checks failed" and "packed MCP server tools: ff_explain, ff_run, ff_write_scenario". This is the test of **installing the three packages the way a stranger would**: it packs them, installs them into an empty folder, and runs them. |

If B6 says a port (3000, 4010 or 8080) is already in use, close the other program or restart the computer, then retry.

---

## Part C: AI customers, end to end

### C1: the replay (free; this is what Parts A and B showed)

The customers' choices (Leo ignored two failed payments and updated his card on the third) and the explanations come from a
recording of Claude, saved in two files: `examples/coffee-club/scenarios/bad-month.lock.json` and
`bad-month.narration.lock.json`. Open the first file: you should see three short entries for "Leo". **Check:** the numbers
in A2 match this (3 customer decisions). In the Report tab, every explanation says "Written by Claude".

### C2: the same run with **no AI and no recording** (free)

This shows what a user sees without an API key. It uses a copy of the scenario, so the recording is not touched.

Open two PowerShell windows in the `FastForward` folder.

Window 1 (the shop app):
```
$env:FASTFORWARD="1"; $env:PORT="3000"; $env:COFFEE_BUGS="no-verify,no-dedupe,ignores-suspend,ignores-disputes,trusts-event-order"; $env:PAYPAL_CLIENT_ID="x"; $env:PAYPAL_CLIENT_SECRET="x"
node --import fastforward-register examples/coffee-club/dist/server.js
```
Expect: `Coffee Club listening on 3000`.

Window 2:
```
mkdir $env:TEMP\ff-test -Force | Out-Null
copy examples\coffee-club\scenarios\bad-month.yaml $env:TEMP\ff-test\
$env:FF_AI="off"
node packages\cli\dist\bin.js run $env:TEMP\ff-test\bad-month.yaml --report-dir $env:TEMP\ff-test\out
```
Expect: **"4 of 6 checks failed"** (one more than the recording, because the scripted Leo never updates his card and gets
suspended while the app keeps serving him), **no "AI:" line**, and an explanation under each failure. Open
`%TEMP%\ff-test\out\report.html` in your browser: it opens, shows the verdict, and each explanation is labelled
"**Built-in text**" (not "Written by Claude").
Stop window 1 with Ctrl+C when done. Then `Remove-Item Env:FF_AI`.

### C3: a **live** AI run (costs money; Vinay only)

Skip this one unless you are Vinay. It calls the real model with the key in `.env`.
1. `npm run record:ai` (free): shows the plan and "Nothing was run and nothing was spent."
2. `npm run record:ai -- --yes`: records a fresh run. Expect an "AI:" line ending like "(10 model calls, about 16,000 tokens)",
   "3 of 6 checks failed" (or 4: a real AI customer may choose differently), and "Saved: bad-month.lock.json, bad-month.narration.lock.json".
3. To go back to the committed recording: `git checkout -- examples/coffee-club/scenarios`.

The run stops calling the model after 60 calls (setting `FF_AI_MAX_CALLS`), so it cannot run away.

---

## Part D: use it on a second app (plain `fetch`, no PayPal SDK)

Proves Fastforward works for apps not built like Coffee Club. Two PowerShell windows in the `FastForward` folder.

Window 1:
```
$env:FASTFORWARD="1"; $env:PORT="3000"; $env:SHOP_BUGS="no-verify,no-dedupe,ignores-suspend,ignores-disputes"; $env:PAYPAL_CLIENT_ID="x"; $env:PAYPAL_CLIENT_SECRET="x"
node --import fastforward-register examples/plain-fetch-shop/dist/server.js
```
Window 2: `$env:FF_AI="off"; node packages\cli\dist\bin.js run examples\plain-fetch-shop\scenarios\bad-month.yaml`
Expect "**4 of 6 checks failed**".
Repeat with `$env:SHOP_BUGS="none"` in window 1 (stop it, set it, start it again): expect "**No checks failed.**"

---

## Part E: try it as a new user would (the `init` command)

A new user starts with `fastforward init`. Keep Coffee Club running from Part C2 (window 1, with the five bugs).

```
mkdir $env:TEMP\ff-init -Force | Out-Null
cd $env:TEMP\ff-init
node <path-to-FastForward>\packages\cli\dist\bin.js init
```
Expect: "Wrote fastforward.yaml." and three numbered next steps.

Run it: `$env:FF_AI="off"; node <path-to-FastForward>\packages\cli\dist\bin.js run fastforward.yaml`
Expect: "**2 of 6 checks failed**" (signatures and disputes), and two checks are skipped, because the file only knows
the webhook address.

Now open `fastforward.yaml` in Notepad. Find the two lines starting `# subscribeUrl:` and `# probeUrl:`, delete the `# ` at the
start of each, save, and run again. Expect: "**4 of 6 checks failed**" and nothing skipped.

Also try the error messages (each should tell you what to do next, not just what is wrong):
- Stop Coffee Club, run again: `can't reach your app at ... Start your app first (FASTFORWARD=1 node --import fastforward-register your-app.js), and check that app.webhookUrl ...`
- `node <path>\bin.js run nope.yaml`: `... no such file. Check the path, or create a starter with: fastforward init`
- `node <path>\bin.js init` a second time in the same folder: `fastforward.yaml already exists; choose another file with -o`

---

## Part F: the coding-assistant tool (optional, needs Claude Code)

Only if you have Claude Code installed. In the `FastForward` folder, with Coffee Club running as in C2:
`claude mcp add fastforward -- node packages/mcp/dist/server.js`, then in Claude Code ask: "Use fastforward to run
examples/coffee-club/scenarios/bad-month.yaml and explain the failures." Expect a list of the six checks with "fail" or
"pass", and explanations. Do not ask it to write a new scenario (that one needs an API key).

---

## What to send back

Send Vinay a copy of the table below, filled in. For anything that is not **Pass**, add a screenshot and one sentence:
what you did, what you expected, what happened. Include your browser and Windows version.

| Test | Pass / Fail / Skipped | Notes |
|---|---|---|
| A1 to A14 (live dashboard) | | |
| A15 read-only (405 three times) | | |
| A16 direct links | | |
| B1 to B5 (install, build, unit tests) | | |
| B6 to B8 (demo on your computer) | | |
| B9 (bugs off) | | |
| B10 (end-to-end tests) | | |
| B11 (package install test) | | |
| C1 (replay matches the page) | | |
| C2 (no AI, built-in text) | | |
| D (plain fetch app) | | |
| E (init and error messages) | | |
| F (assistant tool, optional) | | |

Things that would be especially useful: anything confusing to read, any wording you did not understand, any page that
looks broken on your screen, and any step in this guide that did not work as written.
