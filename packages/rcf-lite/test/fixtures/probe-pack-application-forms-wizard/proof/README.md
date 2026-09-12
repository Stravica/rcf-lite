# MCP-route smoke: application-forms-wizard probe pack

Captured on 2026-09-06 against the shipped fixture with the pinned Playwright MCP as the browser driver. Every JSON file here is the raw output of the `rcf verify browser` command that produced the verdict; the top of each file includes any driver stderr lines and the JSON body follows. Filenames follow the convention `pack-mcp-route.<ts>.json` for the baseline and `pack-mcp-route.negative-<switch>.<ts>.json` for the four negative runs; the timestamp is the UTC clock when the file was written (colons replaced with dashes for filesystem safety).

## Files

| File | Command | Aggregate | Purpose |
|---|---|---|---|
| `pack-mcp-route.2026-09-06T19-11-51Z.json` | `rcf verify browser FBS-001 --url http://127.0.0.1:13804 --probe-pack application-forms-wizard --json` on the honest fixture | warn (agent-driver invariant, unrelated to this pack; every pack check passes) | Baseline: every check `pass` against the compliant fixture. |
| `pack-mcp-route.negative-task-list-vocab.2026-09-06T19-11-52Z.json` | Same command with `FORMS_WIZARD_BREAK=task-list-vocab` on the fixture boot | block | `AC-24101-1` fails: task-list row outside the closed GOV.UK vocabulary. |
| `pack-mcp-route.negative-no-summary.2026-09-06T19-11-53Z.json` | Same command with `FORMS_WIZARD_BREAK=no-summary` | block | `AC-24103-1` fails: error-summary region [data-surface="error-summary"] not found. |
| `pack-mcp-route.negative-no-retain.2026-09-06T19-11-54Z.json` | Same command with `FORMS_WIZARD_BREAK=no-retain` | block | `AC-24104-1` fails: an unedited row changed value across the edit-and-save round-trip. |
| `pack-mcp-route.negative-no-draft.2026-09-06T19-11-55Z.json` | Same command with `FORMS_WIZARD_BREAK=no-draft` | block | `AC-24105-1` fails: server-draft body carries no persisted fields. |

## Reproduce

```
# Boot the fixture on a free port (default 3000; refuses 4200).
cd packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard
PORT=13804 node server.js

# In another shell, create a scratch rcf project, apply the blueprint,
# set FBS-001.uiBearing true, FBS-001.contextRequirements.tacIds to
# ['TAC-2501-application-forms-wizard-task-list'] and add a valid
# designStage.navModel (shape shared-persistent; routes with path,
# label, authRequired). Then invoke rcf verify browser with the pinned
# Playwright MCP.
rcf init --project-name t3-scratch --non-interactive --no-agent-setup --no-playwright-mcp
rcf define blueprint add /path/to/blueprints/application-forms-wizard
# Patch FBS-001 (see reproduce steps in the fixture README).
rcf verify browser FBS-001 --url http://127.0.0.1:13804 --probe-pack application-forms-wizard --json
```

For the negative runs, boot the fixture with `FORMS_WIZARD_BREAK=<switch>` and repeat the last command.

## Node engine

Every run above used Node 24.14.0 (`/Users/thefoot/.n/n/versions/node/24.14.0/bin/node`), the engine rcf-lite declares.
