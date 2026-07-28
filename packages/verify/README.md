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

## Requirements

Verify does not drive your app itself. It launches a *separate* AI agent, hands it a browser, and lets that agent walk your running app. So the machine running `rcf-verify` needs that agent, that browser, and the network to reach both.

Check this list before your first run. Installing verify does not install any of it, and a missing piece surfaces as an agent launch failure at run time rather than an obvious "you forgot X".

**1. Node.js 24 or newer.** Verify is an ES-module CLI declaring `"engines": { "node": ">=24.0.0" }`; older runtimes fail at install or on first import. Check with `node --version`, install from [nodejs.org](https://nodejs.org).

**2. The Claude Code CLI, resolvable on your `PATH` as `claude`.** The verifier agent *is* Claude Code, run headless. Verify spawns it by bare name, so it has to be on the `PATH` of the process running verify. Check with `claude --version`, install per the [Claude Code docs](https://docs.claude.com/en/docs/claude-code/setup). To drive a different agent harness instead, point `RCF_VERIFY_LAUNCHER` at a module exporting `launchAgent` (see [the launcher seam](docs/reference.md#verifier-agent-launcher)).

**3. A working Claude Code login on that same machine.** Verify passes its own environment through to the agent it spawns, so the agent authenticates as whoever is logged in locally. Verify has no credential and no API-key setting of its own. Satisfy it by running `claude` once interactively and completing login; in CI, authenticate the runner exactly as you would for any other Claude Code job. Note that every verify run spends tokens against that account.

**4. `npx`, also on your `PATH`.** Verify gives the agent browser tooling by provisioning the [`@playwright/mcp`](https://www.npmjs.com/package/@playwright/mcp) server explicitly, as `npx -y @playwright/mcp@latest`. Provisioning it by value rather than reading your ambient MCP config is deliberate, so verify works on a machine with no MCP setup at all, but it does mean `npx` must be there. It ships with Node, so requirement 1 normally covers this; confirm with `npx --version`.

**5. Network egress while the pass runs**, to three destinations:

- the **npm registry**, because `@playwright/mcp@latest` is re-resolved on every run unless it is already in the npx cache;
- **Anthropic's API**, because the verifier agent is a live model call;
- **your app's URL**, reachable from the machine running verify, not merely from your laptop.

Egress-restricted CI needs all three allowed. If the registry is genuinely unreachable, warm the npx cache ahead of time as the same user on the same machine.

**6. A browser for the agent to drive.** `@playwright/mcp` needs a real browser binary, and nothing in this install chain fetches one: installing verify, or `@playwright/mcp`, downloads no browsers at all. By default the MCP server drives your **system Google Chrome** installation, so on a default run, having Chrome installed is the whole requirement.

If Chrome is absent, or you configure a different browser, the MCP server names the fix in its own error: `npx @playwright/mcp install-browser <name>` for a Playwright-managed build such as `firefox` or `webkit`, or `npx playwright install <channel>` for another Chromium channel such as `msedge`.

## Use it

```sh
rcf-verify run --repo . --profile deployed --url https://your-app.example.com --out report.json
```

That runs the adversarial pass and writes `report.json`: findings with severities, and a verdict stamped with the runtime it was earned against. Re-render any saved report with `rcf-verify report report.json`.

A `deployed` run is the ship verdict. You can also point it at CI or local builds (`--profile ci` / `--profile local-dev`) for correctness passes — same engine, honestly labelled with lower authority, so a localhost pass can never masquerade as ship-ready.

If your app needs accounts, sandboxes or test data to be exercised properly, verify provisions them first and tears them down after — see the reference for `provision` and `cleanup`.

**Using rcf-build-lite?** You rarely run this by hand: `rcf finalise` invokes verify automatically as the gate between "built" and "verified".

## Going deeper

[docs/reference.md](docs/reference.md) has the full surface: runtime requirements, runtime profiles and verdict authority, exit codes, prerequisite provisioning, MCP mode, and the launcher seam for custom agent harnesses.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
