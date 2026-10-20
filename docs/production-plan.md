# Making Fastforward shippable after the hackathon

Written 20 Oct 2026 for Vinay. Principle: fewer things, deeper foundations. Each item says who it helps.
Nothing here is pushed or published without his yes.

## What "shippable" means here
Fastforward is a developer tool (a CLI, an MCP server and a stand-in PayPal), not a website. A stranger must be
able to install it, point their own app at it, trust what it says, and not be harmed by it. A hosted team product
with accounts and billing comes later, after real people use the free tool.

## Phase 1: safe and trustworthy (do now, all local, small)
1. **Lock the public demo to read-only.** Found 20 Oct: anyone on the internet can POST to the live site's
   control API (`/_ff/runs`) and start runs on Tharun's server. Fix: the hosted proxy allows only GET/HEAD.
   Helps: everyone, because strangers cannot run up Tharun's bill or crash the demo before judging.
2. **Automatic checks on every push (GitHub Actions):** build, typecheck and the 376 tests. The repo has none.
   Helps: any contributor or customer, who can see that main always passes.
3. **Dependency and secret audit:** `npm audit`, a secret scan of the history, a pinned Node version in Docker.
4. **Container hardening:** run as a non-root user, add a Docker health check, a small `.dockerignore` review.
5. **Speed up the 4.5 minute e2e test** so the checks in step 2 stay quick.

## Phase 2: a stranger can install and use it (needs your decisions)
6. **Final product name.** "Time Machine" is taken (Chargebee); "Fastforward" is the working name. Check the name
   is free on npm, GitHub and as a domain before anything is published. **Yours to decide.**
7. **Installable packages:** make the CLI, register add-on and MCP server real npm packages (today they are
   private and only work inside this repo). Version numbers, a build that ships compiled files, a changelog.
   Publishing to npm is outward and needs your yes.
8. **`fastforward init`:** one command that writes a starter scenario and shows how to start the user's app with
   the register add-on. Today a user must read the README and write YAML by hand.
9. **A second example app** that uses plain `fetch` instead of PayPal's SDK, to prove it works for apps that are
   not built like Coffee Club (the spike says both are redirectable; this makes it a tested fact).
10. **Real docs:** how to use it on your own app, a reference for every scenario field and every check, and a
    troubleshooting page (port in use, app not redirected, no webhook received).
11. **Clear errors:** every failure says what to do next, in plain words.

## Phase 3: honest coverage (depth, not breadth)
12. **Approved, active subscriptions in the real-sandbox comparison.** Our known gap; needs a buyer approval in
    the sandbox. I will test how far it can be automated, and say so if it cannot.
13. **Verify the inferred rule** (suspend at the failure threshold) against PayPal's docs or the sandbox.
14. **Show the AI in the product:** one recorded real AI run, replayable with no key (see earlier proposal).

## Phase 4: the business, only after real users
15. **A one-page site and waitlist** (who pays, the $39 target, install command) to collect the first customers.
16. **A tiny usage log (opt-in)** to learn which checks catch bugs. No accounts, no billing yet.

## Deliberately NOT doing now
User accounts, team billing, a hosted multi-user service, other payment processors, more PayPal products. Each is
real work that would stay unused until the free tool has users.

## Decisions that are Vinay's
- The final product name (item 6).
- Publishing to npm and any announcement (item 7).
- Who pays for hosting after 15 Dec, and whether the demo stays up.
