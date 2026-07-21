# @stravica-ai/rcf-verify-lite

A **fresh-context adversarial verifier** for the RCF Lite suite.

Given an RCF chain (the acceptance contract) and a **running instance** of an
app under a **declared runtime profile**, `rcf-verify` launches an isolated
verifier agent that walks real user journeys adversarially — trying to
*disprove* the app against its acceptance criteria — and emits a **structured
verdict stamped with the runtime it ran against**.

It never reads the source tree, the test suite, or the builder's self-report.
Its only inputs are the chain and the live URL. That information disjointness
is what makes it an *independent* ship-readiness verdict rather than another
self-check.

> **Honest limit.** Verify does not make an app "fully verified" or "safe". It
> **replaces the ship-readiness verdict with an independent one.** An agent
> cannot fully adversarially test its own build; verify mitigates that blind
> spot, it does not eliminate it.

## Install

```
npm i @stravica-ai/rcf-build-lite @stravica-ai/rcf-verify-lite
```

The two are independently installable (verify alone for CI; build alone if
truly wanted), but installing together is the recommended default.

## Usage

```
rcf-verify run \
  --repo <path-to-rcf-chain> \
  --profile <deployed|ci|local-dev> \
  --url <running-app-url> \
  --out report.json \
  [--parity-env] [--provision creds.json] \
  [--severity-gate BROKEN] [--provision-mode run|skip] [--persona name]

rcf-verify report report.json     # re-render a prior report
rcf-verify provision ...          # stand up prerequisites standalone
rcf-verify cleanup ...            # tear down provisioned 'zzverify-' artefacts
rcf-verify mcp                    # serve over MCP (local stdio)
```

### Runtime profiles

| Profile | Verdict authority |
|---|---|
| `deployed` | SHIP-readiness verdict (the ship gate). A local/unreachable URL under `deployed` yields `NOT-DEPLOYED`, never a soft pass. |
| `ci` | Correctness/regression verdict. Ship gate **only** with `--parity-env`. |
| `local-dev` | Correctness/regression verdict. Never a ship gate. |

`localhost` is a first-class target under `ci`/`local-dev`. What is forbidden
is a lower profile claiming the authority of `deployed`.

### Exit codes (`run`)

```
0  report written, verdict below the severity gate
1  IO / unexpected runtime failure (incl. verifier-agent launch failure)
2  usage error
3  chain could not be loaded
5  severity gate tripped, or NOT-DEPLOYED / BLOCKED
```

## Verifier-agent launcher

Verify launches an isolated fresh agent (Claude Code by default) with the
proven isolation env (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` +
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`) and browser tooling; that agent
drives the running app and returns structured findings. The launcher is
injectable via the `RCF_VERIFY_LAUNCHER` env var (a module exporting
`launchAgent`) — the seam used for integration harnesses and the recorded
manual e2e.
