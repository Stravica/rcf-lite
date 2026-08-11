# rcf-lite

[![ci](https://github.com/Stravica/rcf-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/Stravica/rcf-lite/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/rcf-lite)](https://www.npmjs.com/package/rcf-lite)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)

Build software with an AI coding agent without losing the plot.

Anyone who has shipped with a coding agent knows the failure mode: the code arrives fast, but what the product is supposed to do lives in prompt history, and prompt history is not a spec. Three weeks later nobody can say what is covered, what is tested, or what breaks when something changes.

RCF Lite keeps those answers machine-checkable. It maintains a live chain from what you asked for, through requirements, user stories, acceptance criteria and tests, into the code itself, as plain JSON files in your own repository. Your agent works the chain instead of improvising; `rcf validate` catches drift the moment it happens; and when your app is deployed, `rcf verify` sends an independent verifier at it before anything gets called done.

It is the tooling for the [Requirements Confidence Framework (RCF)](https://stravica.ai/rcf-methodology): a method for keeping AI-built software honest.

## Start here

Three steps before you start your coding agent, then one prompt inside the session.

1. Install the CLI:

   ```sh
   npm install -g rcf-lite
   ```

   That single install brings both the build-stage CLI (`rcf`) and the ship-gate verifier (`rcf verify`, plus the transition-grace `rcf-verify` alias) in one package.

2. In your project directory, run `rcf init` (or `npx rcf-lite init` without the install). One command sets everything up: the requirements files, the MCP server entry and your agent's instructions.

3. Start your coding agent session in that directory (or restart the one you have open, so it picks up the new configuration).

Then hand your agent this prompt, filled in. The setup you just ran has already taught it how to work; all it needs from you is the idea:

```text
I want to build [describe your product idea in a sentence or two].
Let's get started.
```

If you'd rather drive it by hand, [docs/getting-started.md](docs/getting-started.md) covers the same ground at human pace. Prerequisites, install checks and agent-harness wiring live in [docs/install.md](docs/install.md).

## Migrating from the pre-0.7.1 packages

If your project pinned one of the pre-consolidation packages, replace it with `rcf-lite`:

| Old pin                              | New pin                                |
|--------------------------------------|----------------------------------------|
| `@stravica-ai/rcf-build-lite`        | `rcf-lite`                             |
| `@stravica-ai/rcf-verify-lite`       | `rcf-lite` (verify is a subcommand now) |
| `@stravica-ai/rcf-lite-core`         | `rcf-lite` (core is an internal module) |

Invocation:

- `rcf init` / `rcf validate` / `rcf build` / `rcf finalise` are unchanged.
- Prefer `rcf verify <run|report|provision|cleanup|mcp>` over the legacy `rcf-verify` bin. The alias still works (identical dispatch, one-line stderr deprecation notice on direct invocation; suppress with `RCF_QUIET=1`).

The full migration story, the ratified ruling sheet and the registry runbook live at the repo root under [`docs/`](../../docs/).

## This repo runs on it

The umbrella's own PRD, requirements, user stories, acceptance criteria, architecture and build queue live as JSON under [`rcf/`](./rcf), validated against the open [`@stravica-ai/rcf-schemas`](https://github.com/Stravica/rcf-schemas). The build queue in there is the one that drove the tool's own development. The artefacts are the demo.

See them the way you'd see your own project's:

```sh
git clone https://github.com/Stravica/rcf-lite.git
cd rcf-lite && pnpm install
cd packages/rcf-lite
pnpm rcf view     # the tree this tool was built from, rendered live in your browser
```

Then scaffold your own: [docs/getting-started.md](docs/getting-started.md).

## Docs

| Doc | One line |
|---|---|
| [docs/install.md](docs/install.md) | Prerequisites, install, verify, wire into an agent harness |
| [docs/getting-started.md](docs/getting-started.md) | Empty directory to a validated, queried, building RCF project |
| [docs/how-it-works.md](docs/how-it-works.md) | The document chain, the files, the verbs, the agent contract |
| [docs/why-it-exists.md](docs/why-it-exists.md) | The confidence gap, and why files plus a CLI is the answer |
| [docs/code-nodes.md](docs/code-nodes.md) | The spec-to-code bridge: Code Nodes, staleness detection, the mark-complete gate, honest limits |
| [docs/verify-reference.md](docs/verify-reference.md) | The verify subcommand tree (run, report, provision, cleanup, mcp) in detail |

[docs/README.md](docs/README.md) is the index; `rcf help <verb>` is the flag reference; [guidance/](guidance/README.md) is the agent-facing method pack.

## Under the hood

The chain does not stop at the tests. **Code Nodes** make source files first-class nodes in the same graph, so a dangling spec-to-code link fails `rcf validate` exactly the way a dangling spec-to-spec one does. `rcf trace` walks backward from a source file to the requirements it serves; `rcf impact` extends a change's blast radius into the code that implements it. Spec-only trees work unchanged; the code layer is additive. Full detail, deliberate limits and the roadmap beyond them: [docs/code-nodes.md](docs/code-nodes.md).

## Contributing

Not accepting external code contributions at this stage of the project. Bug reports and feature discussion via [Issues](https://github.com/Stravica/rcf-lite/issues) are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) covers the development setup and house rules that will apply when that changes.

## License

Apache 2.0. See [LICENSE](./LICENSE).
