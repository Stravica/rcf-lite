# Install

## 1. Read this if

You want this machine to run `rcf`. The steps are agent-executable; a human following along by hand needs nothing extra. No RCF concepts here; for those, start with [how it works](how-it-works.md).

## 2. Prerequisites

| Requirement | Check | Notes |
|---|---|---|
| Node.js >= 24 | `node --version` | Hard engines pin; older majors refuse to install. npm ships with it. |
| A browser | - | Only if you will use `rcf audit view`. Everything else is terminal-only. |
| git | `git --version` | Only for the source install ([section 4](#4-install-from-source)). |
| pnpm | `pnpm --version` | Only for the source install; the repo is pnpm-managed (`pnpm-lock.yaml`). |

## 3. Install from npm

```sh
npm install -g rcf-lite
```

That puts both binaries on your PATH:

- `rcf` - the unified CLI. 30+ verbs covering define, build, verify and finalise (`init`, `view`, `validate`, `build`, `verify`, `finalise`, ...).
- `rcf verify` - a transition-grace alias for the adversarial ship-gate verifier. Prefer `rcf verify <run|report|provision|cleanup|mcp>` in new work; the alias prints a one-line deprecation notice on stderr and will be removed in a future major (silence in scripts with `RCF_QUIET=1`).

To try the CLI without installing anything, `npx rcf-lite <verb>` runs the same thing.

**One package, one install.** Before 0.7.1 the suite shipped as three separately published packages (`@stravica-ai/rcf-build-lite`, `@stravica-ai/rcf verify-lite`, `@stravica-ai/rcf-lite-core`). Those names are now deprecated on npm and resolve to `rcf-lite`. If your lockfile still pins one of them, migrate to `rcf-lite` on your next release; the runbook and the reasoning are linked from the [README](../../../README.md#where-this-came-from).

The only runtime dependency, `@stravica-ai/rcf-schemas` (the JSON Schema contract, deliberately kept as a separate public package), installs from the public npm registry; no registry auth is needed.

## 4. Install from source

The contributor and development path: use it to work on the tool itself or to run an unreleased head. [CONTRIBUTING.md](../CONTRIBUTING.md) covers the house rules if you plan to send changes.

```sh
git clone https://github.com/Stravica/rcf-lite.git
cd rcf-lite
pnpm install
```

You do not need a build step. The CLI runs straight from the clone via `bin/rcf.js` (`pnpm rcf <verb>`).

One maintenance script to know about: `pnpm run vendor` copies the Mermaid bundle from `node_modules` into `src/view/vendored/` so the `rcf audit view` page renders diagrams with no network dependency. The vendored bundle is checked into the repo, so a fresh clone already has it; run the script only after bumping the `mermaid` devDependency.

## 5. Registry access

Nothing to configure: the schemas dependency installs from the public npm registry with no auth. If your machine routes npm through a corporate proxy or a custom registry mirror, see [troubleshooting](#9-troubleshooting).

## 6. Verify the install

From any directory:

```sh
rcf --version
```

```
rcf 0.7.1
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

(With a global install, `rcf` is already on your PATH. Without one, `npx rcf-lite init` is the same thing; from a source clone, use the shell helper from [section 6](#6-verify-the-install).)

`rcf init` is the full pre-session bootstrap. It:

1. Scaffolds the `rcf/` tree (skipped, untouched, if one already exists).
2. Writes or merges the project-root `.mcp.json` with the `rcf` server entry. The merge preserves other servers and unknown keys; an existing `rcf` entry is left alone.
3. Writes the method fragment from [`guidance/harness-template.md`](../guidance/harness-template.md) into your project's agent-instructions file(s), inside `<!-- rcf:managed:begin -->` / `<!-- rcf:managed:end -->` markers. On a fresh project it writes **both** `CLAUDE.md` and `AGENTS.md`, so the wiring is vendor-neutral by default; if you already have one of them, it refreshes that file in place and does not invent the other. Re-running init refreshes the marked block; it never duplicates. Between upgrades, `rcf doctor --fix` is the maintenance seat for the same block: it re-renders the current fragment inside the managed markers (and migrates the legacy pre-0.6.0 `<!-- rcf:begin -->` / `<!-- rcf:end -->` pair in place if you are upgrading from that generation).

Then start your agent session. That order matters: harnesses read `.mcp.json` and the instructions file at session start, so a project wired mid-session needs a session restart to take effect.

Running this in a repo that already has code, history and its own `CLAUDE.md` or `.mcp.json`? That is supported, and [section 8](#8-run-it-against-an-existing-repo) is the per-file account of what init will and will not touch.

`rcf mcp` is the server the `.mcp.json` entry launches: it serves the project over the Model Context Protocol (local stdio, no HTTP), resolving the project root from its working directory at startup (or `--project-root <path>`; `rcf help mcp` covers the flags). A registered server exposes eleven `rcf_*` tools, the tree as resources, and two agent playbook prompts; [how it works, section 6](how-it-works.md#6-the-agent-contract) has the inventory.

**Manual fallback.** If you cannot run the bootstrap (pre-existing session, non-standard harness), `rcf init --no-agent-setup` scaffolds the tree only and prints the manual steps. Register the server in `.mcp.json` yourself:

```json
{
  "mcpServers": {
    "rcf": {
      "command": "node",
      "args": ["/absolute/path/to/rcf-lite/bin/rcf.js", "mcp"]
    }
  }
}
```

For a global npm install, the path is `$(npm root -g)/rcf-lite/bin/rcf.js`; for a source install, it is the clone's `bin/rcf.js`.

Then run `rcf guidance harness-template`, paste its first ```` ```markdown ```` fence into your project's `CLAUDE.md` or `AGENTS.md`, and restart the agent session. (`rcf guidance` prints the method documents out of the installed package, so you do not need a clone of this repo to reach them; run it with no arguments to list the topics.) The server nudges any session it detects as unwired (no rcf marker block in the instructions file) back to `rcf init` + restart.

## 8. Run it against an existing repo

Everything above assumes a project you are happy to have `rcf init` write into. Most real projects are not empty directories: they have history, code, an instructions file someone already tuned, and a `.mcp.json` with servers in it. `rcf init` is built to be safe in exactly that situation. This section is the concrete contract, so you can decide before you run it rather than after.

### 8.1 What it touches

Init reads and writes four paths in your project root, and nothing else on disk.

| Path | If it is absent | If it is already there |
|---|---|---|
| `rcf/` | Scaffolded: a manifest plus placeholder PRD, REQ, US, AC, TAD, TAC, ADR, BS and FBS documents. | Left alone entirely, as long as `rcf/manifest.json` is present. Not read, not merged, not migrated, not renumbered. |
| `.mcp.json` | Created carrying the `rcf` server entry and, when no Playwright entry exists at any scope init can see, a distinctly-named `playwright-rcf` fallback (see 8.5). | Merged. Your other servers, and any top-level keys init does not recognise, are carried through unchanged. An existing `rcf` entry is kept exactly as it is, even if it points somewhere unusual. An existing entry whose command tail names `@playwright/mcp` (at any key) is treated as your Playwright wiring and left alone. |
| `CLAUDE.md` | Created only if you have no `AGENTS.md` either. | The `<!-- rcf:managed:begin -->` / `<!-- rcf:managed:end -->` block is refreshed in place. Anything outside those markers is never touched. A file with no marker block yet gets one appended at the end. |
| `AGENTS.md` | Created only in a project that has neither instructions file. | Same marker rules as `CLAUDE.md`. |

Two consequences worth stating outright:

- **Your source code is never read or written.** Init does not scan, index or rewrite anything under your source directories, and it adds no dependency, build step or CI job.
- **It never invents the other convention's instructions file.** A repo with only `CLAUDE.md` stays a `CLAUDE.md` repo; a repo with only `AGENTS.md` stays an `AGENTS.md` repo. Only a project with neither gets both, so the default wiring is vendor-neutral without overriding a choice you have already made.

One caveat, stated precisely because the rest of this section depends on it: the "leave the tree alone" guard keys on **`rcf/manifest.json`**, not on the `rcf/` directory. A directory named `rcf/` with no manifest inside it is treated as a fresh scaffold target, and a file sitting on one of the nine scaffold paths (`rcf/prd.json`, `rcf/requirements/req-001.json` and so on) is overwritten. That matters only if you already use `rcf/` for something unrelated, or you have a partial tree whose manifest went missing. Every complete RCF project has a manifest, so the guard holds for any real tree.

### 8.2 Re-running it

Re-running init is the supported way to pick up a newer method fragment after upgrading the CLI. It is idempotent: run it twice with no upgrade in between and every file is byte-identical afterwards.

```
RCF project already set up here - document chain left untouched, agent wiring refreshed.
  MCP server         already registered in .mcp.json (kept).
  Agent instructions refreshed in CLAUDE.md.
```

The marked block is replaced in place and never duplicated, however many times you run it. A project name passed on a re-run is ignored, because the tree is not rewritten.

### 8.3 Previewing and undoing

**There is no `--dry-run` and no preview flag.** The honest procedure is git:

```sh
git status              # start from a clean tree
rcf init
git diff                # read exactly what changed
```

Everything init writes is an ordinary working-tree change. Nothing is staged, nothing is committed, and nothing is written outside the project root, so reverting is whatever your normal undo is: restore `.mcp.json` and your instructions file from git, and delete an `rcf/` scaffold you decided you did not want.

One formatting note so the diff does not surprise you: init rewrites `.mcp.json` through a JSON formatter, so the whole file comes back at two-space indentation. If yours used a different layout, the diff shows that reformatting alongside the single real addition. The content is preserved; only whitespace moves.

If `.mcp.json` exists but does not parse, init refuses to modify it and exits 2, telling you to fix it or add the entry by hand. It never attempts a repair. The tree scaffold happens before that check, so a refused run can leave you with a scaffolded `rcf/` and no wiring: fix the JSON and run init again.

To take the tree and skip the wiring entirely, `rcf init --no-agent-setup` scaffolds only `rcf/` and prints the manual steps ([section 7](#7-wire-into-an-agent-harness)).

### 8.4 The Playwright MCP entry

`rcf verify` drives the deployed app through a Playwright MCP server (see [verify-reference](verify-reference.md) for the pinned version). Init wires that server, conditionally, so the operator's choice at any scope always wins:

- **Existing project-scope entry.** If your `.mcp.json` already carries a Playwright entry (detected by any `mcpServers[<name>].args` string whose command tail matches `@playwright/mcp` — the key name does not matter), init leaves it alone and prints one line naming the key.
- **User-scope entry in Claude Code.** When init cannot find a project-scope entry, it shells out to `claude mcp list` (5-second timeout) and parses its text output. If it sees a Playwright entry at `user` or `project` scope in the harness, it prints one line naming the scope and writes nothing.
- **Nothing anywhere init can prove.** Init writes a distinctly-named `playwright-rcf` entry at project scope carrying `npx -y @playwright/mcp@<pinned-version>`. The name is deliberately different from `playwright` (the common user-scope key) so a user-scope entry init cannot see never gets shadowed. The verify pass provisions its own MCP config anyway, so a coexisting duplicate is not a problem.
- **`--no-playwright-mcp`.** Suppresses the write step entirely. The probe still runs so the print-out remains honest, but no Playwright entry is created or touched. Use this when a user-scope entry is declared in a harness init cannot probe (a non-Claude-Code harness with no non-interactive list command).

The `rcf doctor` `playwright-mcp-redundant` check surfaces a project + user shadow when both scopes carry a Playwright entry on a browser-facing project. `--fix` does not repair it: the remedy is a deliberate operator choice (keep the project entry to ship portable, or drop it so the user entry wins).

### 8.5 What this is not

Safe to run is not the same as a migration. Three boundaries, so nobody arrives expecting the wrong thing:

- **It does not migrate an existing RCF tree.** When `rcf/manifest.json` is present, init steps around the tree and changes nothing inside it. Bringing an older tree up to the current schema is a separate exercise that this command does not attempt and will not warn you about.
- **It does not retrofit traceability onto code you have already written.** You get placeholder documents, not a chain derived from your codebase. Nothing reads your source to infer requirements, and no Code Nodes are created against existing files.
- **It does not make an existing repo compliant.** After init you have the wiring plus an empty spine. Requirements still have to be elicited, and shipped behaviour stays uncovered until someone writes the acceptance criteria and tests that cover it.

What init gives a brownfield repo is an entry point, not a finished state: the method present in the repo, wired for the agent session, with your existing work untouched. The tree gets filled in from there, normally starting with the next piece of work rather than by back-filling everything already shipped.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm install -g` or `pnpm install` fails on `engines` / `EBADENGINE` | Node older than 24 | Install Node 24+ (`node --version` to confirm), then reinstall. |
| Install cannot resolve `rcf-lite` or `@stravica-ai/rcf-schemas` | Corporate proxy or a custom registry mirror that does not mirror the public npm registry | Point your package manager at the public registry: `npm config set registry https://registry.npmjs.org` for the unscoped umbrella, and `npm config set @stravica-ai:registry https://registry.npmjs.org` for the schemas dependency (or the `pnpm config` equivalents). No auth token is needed. |
| `rcf audit view` page shows no diagrams | Vendored Mermaid bundle missing (`src/view/vendored/mermaid.min.js`) | Run `pnpm run vendor` from the clone root. |
| `rcf audit view` exits 2 with `EADDRINUSE` | Port 4373 already bound | Pass `--port <n>` or stop the other process. `rcf help view` lists the precedence rules. |
| `command not found: rcf` | No global install on this machine | `npm install -g rcf-lite`, or run without installing via `npx rcf-lite <verb>`. Inside a source clone, use `pnpm rcf <verb>` or the shell helper from [section 6](#6-verify-the-install). |
| MCP client shows zero `rcf_*` tools; the server subprocess is dead | `rcf mcp` found no `rcf/manifest.json` in its working directory or any ancestor. It exits 2 with a `no project root found` line on stderr before any protocol traffic; most MCP clients hide that stderr, so the only visible symptom is an empty tool list. | Run `rcf init` in the project the server should serve (it wires the tree, `.mcp.json` and the agent instructions), then restart the agent session; or point the server at an initialised project with `--project-root <path>`. See [section 7](#7-wire-into-an-agent-harness). |
| Every tool response ends with a "Setup incomplete" instruction | The server found a tree but no `<!-- rcf:managed:begin -->` block in the project-root `CLAUDE.md` / `AGENTS.md`; the session started without the init bootstrap. Legacy `<!-- rcf:begin -->` / `<!-- rcf:end -->` markers (pre-0.6.0) still count during the transition grace and do not trigger this notice; run `rcf doctor --fix` to migrate them. | Run `rcf init` in the project, then exit and restart the agent session. The notice disappears once the marker block exists. |
