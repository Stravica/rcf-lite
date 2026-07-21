# Install

## 1. Read this if

You want this machine to run `rcf`. The steps are agent-executable; a human following along by hand needs nothing extra. No RCF concepts here; for those, start with [how it works](how-it-works.md).

## 2. Prerequisites

| Requirement | Check | Notes |
|---|---|---|
| Node.js >= 24 | `node --version` | Hard engines pin; older majors refuse to install. npm ships with it. |
| A browser | - | Only if you will use `rcf view`. Everything else is terminal-only. |
| git | `git --version` | Only for the source install ([section 4](#4-install-from-source)). |
| pnpm | `pnpm --version` | Only for the source install; the repo is pnpm-managed (`pnpm-lock.yaml`). |

## 3. Install from npm

```sh
npm install -g @stravica-ai/rcf-build-lite
```

That puts the `rcf` binary on your PATH. To try the CLI without installing anything, `npx @stravica-ai/rcf-build-lite <verb>` runs the same thing.

The only runtime dependency, `@stravica-ai/rcf-schemas`, installs from the public npm registry; no registry auth is needed.

## 4. Install from source

The contributor and development path: use it to work on the tool itself or to run an unreleased head. [CONTRIBUTING.md](../CONTRIBUTING.md) covers the house rules if you plan to send changes.

```sh
git clone https://github.com/Stravica/rcf-lite.git
cd rcf-lite
pnpm install
```

You do not need a build step. The CLI runs straight from the clone via `bin/rcf.js` (`pnpm rcf <verb>`).

One maintenance script to know about: `pnpm run vendor` copies the Mermaid bundle from `node_modules` into `src/view/vendored/` so the `rcf view` page renders diagrams with no network dependency. The vendored bundle is checked into the repo, so a fresh clone already has it; run the script only after bumping the `mermaid` devDependency.

## 5. Registry access

Nothing to configure: the schemas dependency installs from the public npm registry with no auth. If your machine routes npm through a corporate proxy or a custom registry mirror, see [troubleshooting](#8-troubleshooting).

## 6. Verify the install

From any directory:

```sh
rcf --version
```

```
rcf 0.1.0
```

`rcf help` prints the verb surface; `rcf help <verb>` is the canonical flag reference for every subcommand. These docs deliberately do not duplicate flag tables.

**Source installs.** `pnpm rcf <verb>` works from anywhere inside the clone (`pnpm --silent rcf --version` drops pnpm's script banner). To run a clone against other directories, which you will want the moment you start [getting started](getting-started.md), give the current shell a helper that points at it. From the clone root:

```sh
RCF_BIN="$PWD/bin/rcf.js"
rcf() { node "$RCF_BIN" "$@"; }
```

The helper lasts for the shell session; add it to your shell profile (with the absolute path baked in) if you want it permanently. It assumes a POSIX shell. The zero-setup equivalent from any directory is `node <path-to-clone>/bin/rcf.js <verb>`.

## 7. Wire into an agent harness

The golden path is one command, run in your project directory BEFORE you start the agent session:

```sh
rcf init
```

(With a global install, `rcf` is already on your PATH. Without one, `npx @stravica-ai/rcf-build-lite init` is the same thing; from a source clone, use the shell helper from [section 6](#6-verify-the-install).)

`rcf init` is the full pre-session bootstrap. It:

1. Scaffolds the `rcf/` tree (skipped, untouched, if one already exists).
2. Writes or merges the project-root `.mcp.json` with the `rcf` server entry. The merge preserves other servers and unknown keys; an existing `rcf` entry is left alone.
3. Writes the method fragment from [`guidance/harness-template.md`](../guidance/harness-template.md) into your project's agent-instructions file(s), inside `<!-- rcf:begin -->` / `<!-- rcf:end -->` markers. On a fresh project it writes **both** `CLAUDE.md` and `AGENTS.md`, so the wiring is vendor-neutral by default; if you already have one of them, it refreshes that file in place and does not invent the other. Re-running init refreshes the marked block; it never duplicates.

Then start your agent session. That order matters: harnesses read `.mcp.json` and the instructions file at session start, so a project wired mid-session needs a session restart to take effect.

`rcf mcp` is the server the `.mcp.json` entry launches: it serves the project over the Model Context Protocol (local stdio, no HTTP), resolving the project root from its working directory at startup (or `--project-root <path>`; `rcf help mcp` covers the flags). A registered server exposes eleven `rcf_*` tools, the tree as resources, and two agent playbook prompts; [how it works, section 6](how-it-works.md#6-the-agent-contract) has the inventory.

**Manual fallback.** If you cannot run the bootstrap (pre-existing session, non-standard harness), `rcf init --no-agent-setup` scaffolds the tree only and prints the manual steps. Register the server in `.mcp.json` yourself:

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

For a global npm install, the path is `$(npm root -g)/@stravica-ai/rcf-build-lite/bin/rcf.js`; for a source install, it is the clone's `bin/rcf.js`.

Then paste the fragment from [`guidance/harness-template.md`](../guidance/harness-template.md) into your project's `CLAUDE.md` or `AGENTS.md`, and restart the agent session. The server nudges any session it detects as unwired (no rcf marker block in the instructions file) back to `rcf init` + restart.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm install -g` or `pnpm install` fails on `engines` / `EBADENGINE` | Node older than 24 | Install Node 24+ (`node --version` to confirm), then reinstall. |
| Install cannot resolve `@stravica-ai/rcf-build-lite` or `@stravica-ai/rcf-schemas` | Corporate proxy or a custom registry mirror that does not mirror the public npm registry | Point your package manager at the public registry for the scope: `npm config set @stravica-ai:registry https://registry.npmjs.org` (or the `pnpm config` equivalent). No auth token is needed. |
| `rcf view` page shows no diagrams | Vendored Mermaid bundle missing (`src/view/vendored/mermaid.min.js`) | Run `pnpm run vendor` from the clone root. |
| `rcf view` exits 2 with `EADDRINUSE` | Port 4373 already bound | Pass `--port <n>` or stop the other process. `rcf help view` lists the precedence rules. |
| `command not found: rcf` | No global install on this machine | `npm install -g @stravica-ai/rcf-build-lite`, or run without installing via `npx @stravica-ai/rcf-build-lite <verb>`. Inside a source clone, use `pnpm rcf <verb>` or the shell helper from [section 6](#6-verify-the-install). |
| MCP client shows zero `rcf_*` tools; the server subprocess is dead | `rcf mcp` found no `rcf/manifest.json` in its working directory or any ancestor. It exits 2 with a `no project root found` line on stderr before any protocol traffic; most MCP clients hide that stderr, so the only visible symptom is an empty tool list. | Run `rcf init` in the project the server should serve (it wires the tree, `.mcp.json` and the agent instructions), then restart the agent session; or point the server at an initialised project with `--project-root <path>`. See [section 7](#7-wire-into-an-agent-harness). |
| Every tool response ends with a "Setup incomplete" instruction | The server found a tree but no `<!-- rcf:begin -->` block in the project-root `CLAUDE.md` / `AGENTS.md`; the session started without the init bootstrap. | Run `rcf init` in the project, then exit and restart the agent session. The notice disappears once the marker block exists. |
