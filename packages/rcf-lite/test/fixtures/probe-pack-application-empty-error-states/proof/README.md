# MCP-route smoke: application-empty-error-states probe pack

Captured on 2026-09-06 against the shipped fixture with the pinned Playwright MCP as the browser driver, per authoring standard section 8c and the round 3 T-0 shipped runner. Every JSON file here is the raw output of the `rcf verify browser` command that produced the verdict; the top of each file includes any driver stderr lines and the JSON body follows.

## Files

| File | Command | Aggregate | Purpose |
|---|---|---|---|
| `mcp-route-smoke.json` | `rcf verify browser FBS-001 --url http://127.0.0.1:13802 --probe-pack application-empty-error-states --json` on the honest fixture | warn (agent-driver invariant, unrelated to this pack; every pack check passes) | Baseline: every check `pass` against the compliant fixture. |
| `negative-stack-trace.json` | Same command with `EMPTY_ERROR_STATES_BREAK=stack-trace` on the fixture boot | block | `AC-22103-1` fails: server-error surface leaked backtrace-frame. |
| `negative-leak-id.json` | Same command with `EMPTY_ERROR_STATES_BREAK=leak-id` | block | `AC-22102-1` AND `AC-22104-1` fail: forbidden and permission-denied leak the resource id. |
| `negative-no-recovery.json` | Same command with `EMPTY_ERROR_STATES_BREAK=no-recovery` | block | `AC-22106-1` fails: empty-list dropped the `[data-recovery="create"]` control. |
| `negative-no-live-region.json` | Same command with `EMPTY_ERROR_STATES_BREAK=no-live-region` | block | `AC-22105-1` fails: offline reconnect dropped the polite live-region wrapper. |

## Reproduce

```
# Boot the fixture on a free port (default 3000; refuses 4200).
cd packages/rcf-lite/test/fixtures/probe-pack-application-empty-error-states
PORT=13802 node server.js

# In another shell, create a scratch rcf project, apply the blueprint,
# set FBS-001.uiBearing true and FBS-001.contextRequirements.tacIds to
# ['TAC-2301-application-empty-error-states-state-machine'], then
# invoke rcf verify browser with the pinned Playwright MCP.
rcf init --project-name t1-scratch --non-interactive --no-agent-setup --no-playwright-mcp
rcf define blueprint add /path/to/blueprints/application-empty-error-states
# Set uiBearing=true and add TAC-2301 to FBS-001.contextRequirements.tacIds
rcf verify browser FBS-001 --url http://127.0.0.1:13802 --probe-pack application-empty-error-states --json
```

For the negative runs, boot the fixture with `EMPTY_ERROR_STATES_BREAK=<switch>` and repeat the last command.

## Node engine

Every run above used Node 24.14.0 (`/Users/thefoot/.n/n/versions/node/24.14.0/bin/node`), the engine rcf-lite declares.
