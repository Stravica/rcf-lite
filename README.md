# rcf-build-lite

RCF Build Lite - CLI, MCP server, `rcf view`, and `rcf build` SDD adapter for the [Requirements Confidence Framework (RCF)](https://stravica.ai/rcf). First consumer of `@stravica/rcf-schemas`.

> **Status:** Phase 3.8. Document store foundations (FBS-001 + FBS-002), visual review surface (FBS-003 + FBS-004), and the live-view server (Phase 3.8) shipped. CRUD verbs land in Phase 4.

## RCF tree

This repo dogfoods RCF: Build Lite's own PRD, requirements, user stories, acceptance criteria, TAD slice and Build Sequence live as JSON under [`rcf/`](./rcf), validated against [`@stravica/rcf-schemas`](https://github.com/Stravica/rcf-schemas). The roots are declared in [`rcf/manifest.json`](./rcf/manifest.json); every other document is discovered by walking the parent id lists from those roots. The tree doubles as the canonical RCF example consumers can read.

## rcf view

Serve the on-disk RCF tree as a live HTML review surface so a non-coding owner can see what is specified and watch hand-edits, migration scripts and (post-Phase 4) CRUD verbs land in real time. Read-only; runs a long-running HTTP + SSE server on localhost that watches `rcf/` and pushes tree updates to the connected browser tab.

### Install

After cloning the repo:

```sh
pnpm install
pnpm run vendor   # copies node_modules/mermaid/dist/mermaid.min.js into src/view/vendored/
```

The vendored Mermaid bundle (version `11.6.0`, see `scripts/vendor-mermaid.mjs`) is checked into source so the rendered page has no external network dependency at view time.

### Usage

From the repo root or any subdirectory:

```sh
pnpm run rcf-view                       # start the server on 127.0.0.1:4373
pnpm exec rcf-view --port 5000          # custom port
pnpm exec rcf-view --strict             # CI mode: fail on a broken tree, exit 3
pnpm exec rcf-view --help               # full flag and exit-code reference
```

The server binds `127.0.0.1` only and prints the URL on stdout. When stdout is a TTY and `CI` is unset, the platform default browser is auto-launched at the URL; pass `--no-open` to suppress. Any `*.json` change under `rcf/` triggers a debounced re-walk and pushes the fresh tree to the browser without a manual refresh. `<details>` open state and scroll position are persisted to `localStorage` and restored on every update and every reload.

Ctrl-C (SIGINT) or SIGTERM triggers a clean shutdown: the watcher closes, all SSE connections receive a `shutdown` event, the port releases, and the process exits within a 2 second budget.

### Flags

| Flag | Default | Effect |
|---|---|---|
| `--port <n>` | `4373` | Bind the HTTP server on the given port. Precedence: `--port` beats `RCF_VIEW_PORT` env beats the default. `EADDRINUSE` is a hard failure. |
| `--strict` | off | Startup gate. Walk the tree once on boot; if it has structural errors, print them and exit `3` without opening the HTTP listener. Without `--strict`, the server starts regardless and streams walker errors to the client via `walker-error` SSE events. |
| `--no-open` | off | Do not open the rendered page in a browser. Auto-open runs by default when stdout is a TTY and `CI` is unset. |
| `--verbose` | off | Log each watch event and each SSE broadcast to stderr. |
| `--help` | off | Print the help and exit `0`. |

### Security posture

The view server binds `127.0.0.1` only - localhost trust. No CORS, no authentication, no rate limiting. **Do not expose it via SSH tunnel or reverse proxy without adding an auth layer first.** LAN or remote review is a future phase decision that must land auth alongside the address change.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Normal shutdown. |
| `1` | Render or runtime failure. |
| `2` | Usage error (unknown flag, `EADDRINUSE`, no project root found). |
| `3` | Validation failure or broken references (`--strict` mode, on the initial walk). |
| `130` | SIGINT. |

## Traceability + query (Phase 5)

Three read-only verbs answer the deterministic traceability questions over the RCF tree. All three support `--format table|json|mermaid` (table default) and share the exit-code convention (`0`/`1`/`2`/`3`/`4`).

### `rcf coverage [scope-id] [--strict]`

Structural coverage over the REQ chain `PRD -> REQ -> US -> AC -> TS -> TC`. Default is shallow-any (any AC covered by any TC = REQ covered); `--strict` flips to per-AC-strict and exits `4` on any gap (CI-gate friendly). Optional positional scopes to a PRD / REQ / US subtree; below-AC ids (AC / TS / TC / FBS / TAC / ADR / BS / TAD) are refused with exit `2`.

This verb is a mechanical / deterministic structural check. It does NOT answer "does the AC set adequately capture the REQ's intent?" - that non-deterministic question belongs to a later prompting + MCP resources phase (Phase 7+).

```sh
pnpm exec rcf coverage
pnpm exec rcf coverage --strict --format json
pnpm exec rcf coverage REQ-002
```

### `rcf trace <id> [--forward|--back|--both]`

Walk the graph from `<id>` forward (descendants; parent-child + cross-links), backward (ancestors up to the root; parent-child only per §D8), or both. Default is `--forward`. `--both` emits `{pivot, ancestors, descendants}` around the pivot.

```sh
pnpm exec rcf trace REQ-002 --forward
pnpm exec rcf trace AC-201-1 --back
pnpm exec rcf trace US-201 --both --format mermaid
```

### `rcf impact <id>`

`trace-forward` + `trace-back` + a labelled `actionNeeded` column per node. Answers "if `<id>` changes, what should we re-verify / re-approve" with static rules:

| Kind | Label |
|---|---|
| PRD | re-approve |
| TAD | review-arch |
| BS | review-plan |
| REQ / US | review-scope |
| AC | re-approve |
| TS | re-verify |
| TC | re-run |
| FBS | re-execute |
| TAC / ADR | review-context |

```sh
pnpm exec rcf impact TAC-005
pnpm exec rcf impact AC-201-1 --format json
```

## Build loop (SDD adapter, Phase 6)

The FBS documents are the build queue: each Feature Build Spec carries a
`buildOrder`, an `executionStatus` lifecycle and a `dependsOnFbsIds[]`
dependency edge. `rcf build` is the thin in-tree SDD adapter over that
queue - it assembles each FBS item into an implementable spec bundle,
selects the next actionable item, and records lifecycle transitions.
One verb, four modes:

```sh
pnpm exec rcf build                            # queue overview (the FBS queue as a table)
pnpm exec rcf build FBS-005                    # spec bundle for one FBS item
pnpm exec rcf build --next                     # bundle for the next actionable item
pnpm exec rcf build FBS-005 --mark complete    # record a lifecycle transition
```

A bundle is a seven-section markdown document (json via `--format json`;
file sink via `--out <path>`): header, queue and dependency context, the
work, acceptance criteria with full US/REQ ancestry, architectural
context (TAC / ADR / TAD / PRD sections), the existing test surface per
AC, and the five-stage build-cycle runbook (Define -> Build -> Review ->
Test -> Finalise, each stage commits) as the implementing harness's work
order.

An item is *actionable* when it is `notStarted` and every dependency is
`complete` or `verified`; `--next` picks the lowest `buildOrder`
actionable item. A bundle for a blocked item renders with a BLOCKED
warning (read-ahead is legitimate); `--strict` refuses it with exit 4.

The lifecycle is forward-only:

```
notStarted -> inProgress -> complete -> verified
```

`--mark` validates the transition (forward jumps allowed, backward
refused with exit 4; same-status is an idempotent no-op) and writes
through the standard update path - schema-validated, `updatedAt`
bumped. Deliberate corrections go through the escape hatch:
`rcf update <fbs-id> --set executionStatus=<status>`. The standing
discipline: whoever drives the loop marks `complete` on PR merge and
`verified` after post-merge verification, every phase - the tool ships
the marking primitive, not a VCS trigger.

Bundle assembly is mechanical and deterministic: byte-identical output
for the same tree state, no wall-clock, no network, no model calls. It
projects what the tree says; whether an FBS is well-specified or a
bundle sufficient for a harness to succeed is semantic judgement and
belongs to the Phase 7+ prompting + MCP surface.

## MCP server (Phase 7)

`rcf mcp` serves the project over the Model Context Protocol - local
stdio only, no HTTP, no docker, no sessions. An MCP-capable harness
launches it as a subprocess in the project directory; one client config
line:

```json
{
  "mcpServers": {
    "rcf": { "command": "rcf", "args": ["mcp"] }
  }
}
```

Run `rcf init` once first - the server needs an existing `rcf/` tree
and resolves the project root at startup (`--project-root <path>` to
point elsewhere). Multi-project setups run one server entry per
project.

Eleven tools, each a thin in-process wrapper over the same pure
modules the CLI uses (identical JSON envelopes, no reshaping):
`rcf_validate`, `rcf_coverage`, `rcf_trace`, `rcf_impact`, `rcf_read`,
`rcf_create`, `rcf_update`, `rcf_delete`, `rcf_link`, `rcf_unlink`,
and `rcf_build` (FBS ids only - the FBS is the queue unit). Strict
coverage gaps and blocked bundles come back as data in the envelope,
not tool errors.

Resources: `rcf://tree` (document index), `rcf://doc/<id>` (every
document, inline ACs / TCs included) and `rcf://docs/<slug>` (the
methodology docs from `guidance/`). Prompts: the two agent playbooks
(`rcf_execute_build_cycle`, `rcf_elicit_requirements`).

stdout carries protocol messages only; logging goes to stderr
(`--verbose` for per-request lines). The server exits when the client
closes stdin.

## Depends on

This repo consumes [`@stravica-ai/rcf-schemas`](https://github.com/Stravica/rcf-schemas) - the language-neutral JSON Schema contract every RCF tool keys to. See `test/schemas-smoke.test.js` for the import + validation path.

## License

Apache 2.0 - see [LICENSE](./LICENSE).
