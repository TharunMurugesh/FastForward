# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of this repository and choose
**Report a vulnerability**. Include what you found, the steps to reproduce it, and which version or commit you used.

This is a small project maintained by one person, so I can promise a best-effort reply, not a fixed deadline. I will
say whether I can reproduce the problem and what I plan to do. Please give me reasonable time to fix it before you
share it publicly.

## What counts

Fastforward is a developer tool that runs on your machine and talks only to a simulated PayPal. Things I care about:

- Anything that could make a Fastforward run call **live PayPal**, or send a real secret anywhere (the
  `fastforward-register` add-on is built to refuse live PayPal hosts).
- A way to read or write files outside the folders Fastforward is meant to use (for example through a crafted run id
  or scenario path in the MCP server).
- A flaw in the hosted demo that lets a visitor change it (it is meant to be read-only).
- A vulnerable dependency that affects the published packages.

## What does not

- The simulator behaving differently from the real PayPal sandbox. That is a normal bug; please open an issue.
- Findings that need you to already control the machine it runs on.

## Supported versions

Only the latest released version gets fixes. See [CHANGELOG.md](CHANGELOG.md).

## Secrets

Never put a real PayPal credential or an Anthropic key in an issue, a scenario file or a pull request. Fastforward
never needs real PayPal credentials to run; the demo and the tests use placeholders.
