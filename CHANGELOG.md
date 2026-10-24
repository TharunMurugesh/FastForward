# Changelog

All notable changes to Fastforward. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/). The version number lives in the `VERSION` file.

## [0.1.1] - 2026-10-24

### Fixed
- `fastforward init` printed next steps that only work when the package is installed globally. It now prints
  copy-paste commands for someone who has only run `npx fastforward-cli init`: add `fastforward-register` to the app, start
  it with the add-on, then `npx fastforward-cli run`.
- The `bin` paths in the published packages no longer carry a `./`, which made npm print a warning when publishing.

## [0.1.0] - 2026-10-24

First version, published to npm as `fastforward-cli` (the `fastforward` command), `fastforward-register` (the add-on an
app preloads) and `fastforward-mcp` (the server for coding assistants).

### Added
- **The twin:** a stand-in for PayPal Subscriptions and Disputes with its own clock, built from PayPal's official
  OpenAPI specifications. It sends signed webhooks, serves the certificate and implements the
  verify-webhook-signature endpoint.
- **Bad weather:** duplicate, late, out-of-order and forged webhooks, from a seeded scenario so reruns match.
- **Six checks:** `ACK_FAST`, `VERIFIES_SIGNATURES`, `STATE_MATCHES`, `FULFIL_ONCE`, `DISPUTE_ANSWERED`,
  `NO_LIVE_CALLS`. Each verdict is a fixed rule over the recorded run; the AI never decides pass or fail.
- **`fastforward` command:** `run`, `new`, `twin` and `init` (writes a starter scenario).
- **`fastforward-register`:** the add-on an app preloads with `node --import`; it sends sandbox calls to the twin and
  blocks any call to live PayPal.
- **`fastforward-mcp`:** a stdio MCP server with `ff_write_scenario`, `ff_run` and `ff_explain`.
- **AI (optional):** Claude plays the customers, writes scenarios and explains failures. Without a key, customers
  follow scripted defaults and everything else works. Decisions are saved to a lock file so reruns match.
- **Seeded ids:** ids follow the scenario seed, so a rerun has the same event, subscription, sale and dispute ids, which is
  what lets a recording of the model's explanations (they quote ids) match its replay.
- **Recording and replay of the model:** the customer decisions and the failure explanations Claude writes are saved next
  to the scenario, so a run with no key (and the hosted demo) replays them. Reports label each explanation "Written by
  Claude" or "Built-in text" and say how many decisions and explanations the model wrote and how many model calls
  and tokens a run used. A spend guard (`FF_AI_MAX_CALLS`, default 100) caps the calls in one run, and
  `npm run record:ai` records the demo run only when passed `--yes`.
- The dashboard now shows the explanations: the twin used to build its report without them, so only the CLI's own
  report file had them.
- **Dashboard:** a web page with the report, a delivery table (AG Grid Community), a dispute chat and a panel that
  shows the comparison with PayPal's real sandbox.
- **Two example apps:** Coffee Club (PayPal's official SDK) and Plain Fetch Shop (plain `fetch`), each with switchable
  bugs.
- **Hosted demo:** one container runs the twin, an example app and the dashboard, read-only.
- A user guide, a three-command quickstart, and `npm run pack:check`, which installs the packed packages into an
  empty folder and runs the bad month.

### Known limits
- The comparison with PayPal's real sandbox (17 steps, all matching) uses card-funded subscriptions, which the
  sandbox activates without a buyer. Subscriptions approved with a PayPal wallet are not compared. One difference is
  recorded: a just-created subscription has no transactions in the sandbox yet; the twin lists the payment at once.
- The retry schedule, failure counting and the suspension threshold are verified against PayPal's documentation
  and API spec. One timing is a guess: whether the final failure suspends on its first attempt (as PayPal's worked
  example reads) or after that cycle's retries.
- Node apps only. Subscriptions and Disputes only.
