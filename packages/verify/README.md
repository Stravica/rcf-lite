# rcf-verify-lite

[![ci](https://github.com/Stravica/rcf-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/Stravica/rcf-lite/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40stravica-ai%2Frcf-verify-lite)](https://www.npmjs.com/package/@stravica-ai/rcf-verify-lite)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)

The ship gate for AI-built software.

Point `rcf-verify` at your running app and the acceptance criteria in your repo's [RCF chain](https://stravica.ai/rcf-methodology), and it launches a fresh, isolated AI agent that behaves like a hostile user: walking real journeys against the live app, trying to prove it *doesn't* meet its contract. You get a structured report and a verdict you can gate a release on.

The verifier never sees your source code, your tests, or your builder's claims about what works. It gets the acceptance contract and a URL, nothing else. That blindness is deliberate: an agent cannot mark its own homework, so the agent that judges the app is never the agent that built it.

> **Honest limit.** Verify does not make an app "fully verified" or "safe". It replaces a self-reported ship-readiness verdict with an independent one — it mitigates the builder's blind spot, it does not eliminate it.

## Install

```sh
npm install -g @stravica-ai/rcf-build-lite @stravica-ai/rcf-verify-lite
```

Installing alongside [`@stravica-ai/rcf-build-lite`](https://www.npmjs.com/package/@stravica-ai/rcf-build-lite) is the recommended default. Verify also installs standalone (`npm install -g @stravica-ai/rcf-verify-lite`) — for example as a verification-only step in CI.

## Use it

```sh
rcf-verify run --repo . --profile deployed --url https://your-app.example.com --out report.json
```

That runs the adversarial pass and writes `report.json`: findings with severities, and a verdict stamped with the runtime it was earned against. Re-render any saved report with `rcf-verify report report.json`.

A `deployed` run is the ship verdict. You can also point it at CI or local builds (`--profile ci` / `--profile local-dev`) for correctness passes — same engine, honestly labelled with lower authority, so a localhost pass can never masquerade as ship-ready.

If your app needs accounts, sandboxes or test data to be exercised properly, verify provisions them first and tears them down after — see the reference for `provision` and `cleanup`.

**Using rcf-build-lite?** You rarely run this by hand: `rcf finalise` invokes verify automatically as the gate between "built" and "verified".

## Going deeper

[docs/reference.md](docs/reference.md) has the full surface: runtime profiles and verdict authority, exit codes, prerequisite provisioning, MCP mode, and the launcher seam for custom agent harnesses.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
