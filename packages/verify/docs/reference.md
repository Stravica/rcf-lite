# rcf-verify reference

The full technical surface of `@stravica-ai/rcf-verify-lite`. If you're new here, start with the [README](../README.md) — this page is the detail behind it.

## Commands

```
rcf-verify run            Run adversarial verification and emit a report artifact
rcf-verify report <path>  Re-render a prior report artifact
rcf-verify provision      Stand up prerequisite accounts/sandboxes/data standalone
rcf-verify cleanup        Tear down provisioned artefacts (all prefixed 'zzverify-')
rcf-verify mcp            Serve verify over MCP (local stdio)
rcf-verify help [command] Print help for a command
```

`rcf-verify help <command>` is the authoritative flag reference for each.

## `run` — the verification pass

```sh
rcf-verify run \
  --repo <path-to-rcf-chain> \
  --profile <deployed|ci|local-dev> \
  --url <running-app-url> \
  --out report.json \
  [--parity-env] [--provision creds.json] \
  [--severity-gate BROKEN] [--provision-mode run|skip] [--persona name]
```

The verifier agent receives only the RCF chain (the acceptance contract) and the URL. It never reads the source tree, the test suite, or the builder's self-report — that information disjointness is what makes the verdict independent.

## Runtime profiles and verdict authority

Every verdict is stamped with the runtime profile it ran against. Authority is capped by profile — a lower profile can never claim the authority of `deployed`.

| Profile | Verdict authority |
|---|---|
| `deployed` | SHIP-readiness verdict (the ship gate). A local/unreachable URL under `deployed` yields `NOT-DEPLOYED`, never a soft pass. |
| `ci` | Correctness/regression verdict. Ship gate **only** with `--parity-env` (a declared production-parity environment). |
| `local-dev` | Correctness/regression verdict. Never a ship gate. |

`localhost` is a first-class target under `ci`/`local-dev`. What is forbidden is a lower profile masquerading as `deployed`.

## Exit codes (`run`)

```
0  report written, verdict below the severity gate
1  IO / unexpected runtime failure (incl. verifier-agent launch failure)
2  usage error
3  chain could not be loaded
5  severity gate tripped, or NOT-DEPLOYED / BLOCKED
```

The exit code is the machine-readable gate: `rcf finalise` in [rcf-build-lite](https://www.npmjs.com/package/@stravica-ai/rcf-build-lite) promotes a build spec to `verified` only on exit 0.

## Prerequisite provisioning

Adversarial testing often needs state: auth accounts, third-party service sandboxes, seed data. `run` provisions declared prerequisites before the pass and tears them down after; `provision` / `cleanup` expose the same machinery standalone. Everything provisioned is prefixed `zzverify-` so cleanup is unambiguous. A prerequisite that cannot be provisioned yields `BLOCKED` — never a silent skip of the journeys that needed it.

## Verifier-agent launcher

Verify launches an isolated fresh agent (Claude Code by default) with the isolation environment (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` + `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`) and browser tooling; that agent drives the running app and returns structured findings.

The launcher is injectable via the `RCF_VERIFY_LAUNCHER` env var — a module exporting `launchAgent` — which is the seam used for integration harnesses and recorded end-to-end runs.

## MCP mode

`rcf-verify mcp` serves the verify surface over MCP (local stdio) for agent harnesses that speak it.
