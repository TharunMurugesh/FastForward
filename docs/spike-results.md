# Task 0: redirect spike results (19 Oct 2026)

**Gate: PASSED. Proceed to Phase 1 with the architecture as specified.**

Setup: Node 24.17.0, `@paypal/paypal-server-sdk` 2.5.0, `undici` 8.12.2, a plain `node:http` fake twin on
port 4010, and a preload add-on started with `FASTFORWARD=1 node --import ./register.mjs app.mjs`.

| Question | Result | Evidence |
|---|---|---|
| Official SDK redirected? | **Yes** | SDK `createOrder` returned `ORDER-FF`; twin logged its OAuth token and order calls |
| `fetch` redirected? | **Yes** | Subscription `201 I-FF`, verify `200 SUCCESS` |
| Cert fetch (`api.sandbox.paypal.com`) redirected? | **Yes** | `200 -----BEGIN CERTIFICATE-----` |
| Live PayPal blocked? | **Yes** | `fetch` to `api-m.paypal.com` failed with cause `FastforwardLiveCallError` |
| Add-on inert when `FASTFORWARD` unset? | **Yes** | Real sandbox answered: real order id `1TM51977CE482622A`, real 400 errors for the dummy bodies |
| SDK has a subscriptions controller? | **Yes** | `SubscriptionsController` exported in 2.5.0 (decides Task 7: use the official SDK) |

## How the redirect works (for Task 2, `packages/register`)

- The SDK sends requests through axios, which uses `node:https`. Wrapping `https.request` / `https.get` and
  re-issuing matching requests with `http.request` to the twin catches it. The original `Host` header is
  kept, so the twin can see which PayPal host was meant.
- `fetch` is caught by `setGlobalDispatcher` with an `undici` `Agent` subclass that rewrites `opts.origin`.
  This worked with npm `undici` 8 alongside Node 24's bundled one. Pin the version and keep a test for it,
  because the shared global-dispatcher slot is an internal contract between the two copies.
- Fetch requests arrive at the twin with `Host: 127.0.0.1:4010` (the original host is lost). If the twin
  ever needs it, forward it in a custom header from the dispatcher.

## Not covered by the spike

- Raw `http2` or third-party clients that bypass both `node:https` and the global dispatcher (rare for PayPal
  integrations; the "app not redirected" abort in spec §11 catches it).
- Apps that run in a non-Node runtime (out of scope per spec §12).
