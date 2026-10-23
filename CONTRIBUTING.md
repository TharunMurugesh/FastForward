# Contributing to Fastforward

Thanks for helping. This is a small project, so the process is light, but a few rules protect what makes it
trustworthy.

## Set up

You need Node 24 or newer.

```
git clone https://github.com/VinayG759/FastForward.git
cd FastForward
npm install
npm run build
npm test
```

`npm test` runs the unit tests (a few hundred, about 15 seconds). It must pass before you open a pull request.

## The checks GitHub runs on every push

| Command | What it does | Time |
|---|---|---|
| `npm run build` | Compiles everything (also the type check). | seconds |
| `npm test` | Unit tests. | about 15 s |
| `npm run pack:check` | Packs the three publishable packages, installs them into an empty folder and runs the bad month with them. | about 10 s |
| `npm run test:e2e` | Real processes and sockets: the example apps against the twin. | about 1 minute |
| `npm run check:version` | The version in `VERSION`, every `package.json` and the changelog agree. | instant |

`npm run fidelity` compares the simulator with PayPal's **real** sandbox and needs your own sandbox keys in a
`.env` file. It is manual and optional; do not add it to CI.

## Rules

- **Never call live PayPal or the real Anthropic API from a test or a script.** Tests use a fake AI client and the
  add-on blocks live PayPal hosts. A test that needs the network belongs in the fidelity suite.
- **Write the test first.** A bug fix starts with a test that fails; a feature starts with the behaviour it must
  have.
- **Do not weaken a test to make it pass or run faster.** If an assertion is wrong, say why in the pull request. If
  a test is slow, make the same assertions cheaper.
- **Secrets only in `.env`** (it is git-ignored). Never commit a key, and never print one in a log.
- **Keep changes small and on topic.** One pull request, one purpose. Unrelated tidying makes review harder.
- **Say what is verified and what is not.** The simulator's rules are marked verified or unverified in
  `packages/twin/src/fidelity.ts`; if you add a guess, mark it as one.
- **A new package needs the lockfile.** After adding or renaming a workspace, run `npm install` and commit
  `package-lock.json`, or CI (which uses `npm ci`) fails.

## Where things are

- `packages/twin`: the stand-in PayPal. `packages/register`: the add-on an app preloads.
- `packages/cli`, `packages/mcp`, `packages/ai`, `packages/contracts`: the command, the assistant server, the AI
  part and the shared types.
- `apps/web`: the dashboard. `examples/`: two small apps with switchable bugs.
- `docs/guide.md`: how users run it. `docs/production-plan.md`: where the project is heading.

## Reporting a bug or a security problem

Open an issue with the steps to reproduce, what you expected and what happened, and your Node version. For a
security problem, do not open an issue: see [SECURITY.md](SECURITY.md).
