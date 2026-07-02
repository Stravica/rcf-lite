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

## Depends on

This repo consumes [`@stravica-ai/rcf-schemas`](https://github.com/Stravica/rcf-schemas) - the language-neutral JSON Schema contract every RCF tool keys to. See `test/schemas-smoke.test.js` for the import + validation path.

## License

Apache 2.0 - see [LICENSE](./LICENSE).
