# Install

## 1. Read this if

You want this machine to run `rcf`. The steps are agent-executable; a human following along by hand needs nothing extra. No RCF concepts here - for those, start with [how it works](how-it-works.md).

## 2. Prerequisites

| Requirement | Check | Notes |
|---|---|---|
| Node.js >= 24 | `node --version` | Hard engines pin; older majors refuse to install. |
| pnpm | `pnpm --version` | The repo is pnpm-managed (`pnpm-lock.yaml`). |
| git | `git --version` | Needed for the source install below. |
| A browser | - | Only if you will use `rcf view`. Everything else is terminal-only. |

## 3. Install from source

This is the primary path while the package is unpublished.

```sh
git clone https://github.com/Stravica/rcf-build-lite.git
cd rcf-build-lite
pnpm install
```

The only runtime dependency, `@stravica-ai/rcf-schemas`, installs from the public npm registry; no registry auth is needed.

You do not need a build step. The CLI runs straight from the clone via `bin/rcf.js`.

One maintenance script to know about: `pnpm run vendor` copies the Mermaid bundle from `node_modules` into `src/view/vendored/` so the `rcf view` page renders diagrams with no network dependency. The vendored bundle is checked into the repo, so a fresh clone already has it; run the script only after bumping the `mermaid` devDependency.

## 4. Install from npm

Not yet published; use the source install above. This section activates when the package ships to npm.

## 5. Registry access

Nothing to configure: the schemas dependency installs from the public npm registry with no auth. If your machine routes npm through a corporate proxy or a custom registry mirror, see [troubleshooting](#8-troubleshooting).

## 6. Verify the install

From the clone root:

```sh
pnpm --silent rcf --version
```

```
rcf 0.0.0
```

`pnpm rcf <verb>` works from anywhere inside the clone (`--silent` drops pnpm's script banner). To run `rcf` against other directories - which you will want the moment you start [getting started](getting-started.md) - give the current shell a helper that points at the clone. From the clone root:

```sh
RCF_BIN="$PWD/bin/rcf.js"
rcf() { node "$RCF_BIN" "$@"; }
```

Then, from any directory:

```sh
rcf --version
```

```
rcf 0.0.0
```

The helper lasts for the shell session; add it to your shell profile (with the absolute path baked in) if you want it permanently. It assumes a POSIX shell. The zero-setup equivalent from any directory is `node <path-to-clone>/bin/rcf.js <verb>`.

`rcf help` prints the verb surface; `rcf help <verb>` is the canonical flag reference for every subcommand. These docs deliberately do not duplicate flag tables.

## 7. Wire into an agent harness

`rcf mcp` serves the project over the Model Context Protocol - local stdio, no HTTP. An MCP-capable harness launches it as a subprocess in your project directory. Register it with the absolute path to your clone (pre-publish there is no `rcf` binary on your `PATH`, so the entry invokes `node` directly). For Claude Code, in your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "rcf": {
      "command": "node",
      "args": ["/absolute/path/to/rcf-build-lite/bin/rcf.js", "mcp"]
    }
  }
}
```

The server resolves the project root from its working directory at startup - run it from the project whose `rcf/` tree it should serve, or pass `--project-root <path>`. Run `rcf init` in the project first; the server needs an existing tree. `rcf help mcp` covers the flags.

A registered server exposes eleven `rcf_*` tools, the tree as resources, and two agent playbook prompts; [how it works, section 6](how-it-works.md#6-the-agent-contract) has the inventory.

To wire the method (not just the tools) into your agent, paste the fragment from [`guidance/harness-template.md`](../guidance/harness-template.md) into your project's `CLAUDE.md` or `AGENTS.md`.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm install` fails on `engines` / `EBADENGINE` | Node older than 24 | Install Node 24+ (`node --version` to confirm), then reinstall. |
| `pnpm install` cannot resolve `@stravica-ai/rcf-schemas` | Corporate proxy or a custom registry mirror that does not mirror the public npm registry | Point npm at the public registry for this scope: `pnpm config set @stravica-ai:registry https://registry.npmjs.org`. No auth token is needed. |
| `rcf view` page shows no diagrams | Vendored Mermaid bundle missing (`src/view/vendored/mermaid.min.js`) | Run `pnpm run vendor` from the clone root. |
| `rcf view` exits 2 with `EADDRINUSE` | Port 4373 already bound | Pass `--port <n>` or stop the other process. `rcf help view` lists the precedence rules. |
| `command not found: rcf` | Pre-publish there is no global binary | Use `pnpm rcf <verb>` inside the clone, the shell helper from [section 6](#6-verify-the-install), or `node <path-to-clone>/bin/rcf.js <verb>`. |
