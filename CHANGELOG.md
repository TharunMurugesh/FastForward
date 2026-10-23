# Changelog

All notable changes to Fastforward. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/). The version number lives in the `VERSION` file.

## [0.1.0] - not released yet

First version. Not published to npm yet; until then it runs from a clone of the repository.

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
- **Dashboard:** a web page with the report, a delivery table (AG Grid Community), a dispute chat and a panel that
  shows the comparison with PayPal's real sandbox.
- **Two example apps:** Coffee Club (PayPal's official SDK) and Plain Fetch Shop (plain `fetch`), each with switchable
  bugs.
- **Hosted demo:** one container runs the twin, an example app and the dashboard, read-only.
- A user guide, a three-command quickstart, and `npm run pack:check`, which installs the packed packages into an
  empty folder and runs the bad month.

### Known limits
- The comparison with PayPal's real sandbox covers the pending-approval path (7 of 7 endpoints match), not
  approved, active subscriptions.
- Suspending a subscription the moment it reaches the failure threshold is inferred, not verified.
- Node apps only. Subscriptions and Disputes only.
