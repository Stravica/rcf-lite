# rcf-build-lite

[![ci](https://github.com/Stravica/rcf-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/Stravica/rcf-lite/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40stravica-ai%2Frcf-build-lite)](https://www.npmjs.com/package/@stravica-ai/rcf-build-lite)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)

The CLI, MCP server, live HTML view (`rcf view`) and `rcf build` SDD adapter for the [Requirements Confidence Framework (RCF)](https://stravica.ai/rcf-methodology): an unbroken, machine-checkable chain from product intent to test evidence, kept as JSON files in your own repository. First consumer of [`@stravica-ai/rcf-schemas`](https://github.com/Stravica/rcf-schemas).

## Start here

Three steps before you start your coding agent, then one prompt inside the session.

1. Install the CLI: `npm install -g @stravica-ai/rcf-build-lite`.
2. In your project directory, run `rcf init` (or `npx @stravica-ai/rcf-build-lite init` without the install). One command sets everything up: the requirements files, the MCP server entry and your agent's instructions.
3. Start your coding agent session in that directory - or restart the one you have open, so it picks up the new configuration.

Then hand your agent this prompt, filled in. The setup you just ran has already taught it how to work; all it needs from you is the idea:

```text
I want to build [describe your product idea in a sentence or two].
Let's get started.
```

If you'd rather drive it by hand, [docs/getting-started.md](docs/getting-started.md) covers the same ground at human pace.

**Status:** v0.1 is on npm as [`@stravica-ai/rcf-build-lite`](https://www.npmjs.com/package/@stravica-ai/rcf-build-lite). Thirteen working verbs plus `mcp` and `help`, the agent guidance pack, and a 700-plus test suite. Install with `npm install -g @stravica-ai/rcf-build-lite`, or run it directly with `npx @stravica-ai/rcf-build-lite`; [docs/install.md](docs/install.md) covers prerequisites and agent-harness wiring.

## This repo runs on it

Build Lite's own PRD, requirements, user stories, acceptance criteria, TAD and build queue live as JSON under [`rcf/`](./rcf), validated against [`@stravica-ai/rcf-schemas`](https://github.com/Stravica/rcf-schemas). The roots are declared in [`rcf/manifest.json`](./rcf/manifest.json); everything else is discovered by walking the tree. The build queue in there is the one that drove the tool's own development. The artefacts are the demo.

## Quickstart

```sh
git clone https://github.com/Stravica/rcf-lite.git
cd rcf-lite
pnpm install
pnpm rcf view     # this repo's own RCF tree, rendered live in your browser
```

Then scaffold your own project: [docs/getting-started.md](docs/getting-started.md).

## Docs

| Doc | One line |
|---|---|
| [docs/install.md](docs/install.md) | Prerequisites, install, verify, wire into an agent harness |
| [docs/getting-started.md](docs/getting-started.md) | Empty directory to a validated, queried, building RCF project |
| [docs/how-it-works.md](docs/how-it-works.md) | The document chain, the files, the fifteen verbs, the agent contract |
| [docs/why-it-exists.md](docs/why-it-exists.md) | The confidence gap, and why files plus a CLI is the answer |
| [docs/code-nodes.md](docs/code-nodes.md) | The spec-to-code bridge: Code Nodes, staleness detection, the mark-complete gate, honest limits |

[docs/README.md](docs/README.md) is the index; `rcf help <verb>` is the flag reference; [guidance/](guidance/README.md) is the agent-facing method pack.

## Depends on

[`@stravica-ai/rcf-schemas`](https://github.com/Stravica/rcf-schemas) - the language-neutral JSON Schema contract every RCF tool keys to.

## One graph, into code

The traceability chain (PRD → REQ → US → AC → TS → TC) now extends one layer further: **Code Nodes** (`CN-*`) make source code a first-class node in the same graph, so `rcf validate` catches a dangling spec-to-code link exactly the way it already catches a dangling spec-to-spec one - the link is only "unbreakable" if breakage is detectable. `rcf trace <path>` walks backward from a source file (or `path#symbol`) to the requirements it serves; `--to-code` on `trace` / `impact` extends the forward blast radius into the code that implements a change; `rcf build --mark complete` refuses when a build spec's acceptance criteria carry no Code Node. Spec-only trees (no `code-nodes/` directory) behave exactly as before - the code layer is additive, not a rewrite. Full detail, including what this deliberately does not detect: [docs/code-nodes.md](docs/code-nodes.md).

## Roadmap

Symbol-level call-graph auto-derivation, semantic-drift detection, and mechanical CN generators (test-coverage-derived, diff-derived) are deliberately out of scope for now - see [docs/code-nodes.md](docs/code-nodes.md#9-honest-limits) for why, and what a harness layer above `rcf` could add.

## Contributing

Not accepting external code contributions at this stage of the project. Bug reports and feature discussion via [Issues](https://github.com/Stravica/rcf-lite/issues) are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) covers the development setup and house rules that will apply when that changes.

## License

Apache 2.0 - see [LICENSE](./LICENSE).
