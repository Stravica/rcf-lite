# rcf-build-lite

[![ci](https://github.com/Stravica/rcf-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/Stravica/rcf-lite/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40stravica-ai%2Frcf-build-lite)](https://www.npmjs.com/package/@stravica-ai/rcf-build-lite)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)

Build software with an AI coding agent without losing the plot.

RCF Build Lite keeps a live, machine-checked chain from what you asked for — through requirements, user stories, acceptance criteria and tests, all the way into the code — as plain JSON files in your own repository. Your agent works the chain instead of improvising, `rcf validate` catches drift the moment it happens, and when your app is deployed, `rcf finalise` sends an independent verifier at it before anything gets called done.

It is the tooling for the [Requirements Confidence Framework (RCF)](https://stravica.ai/rcf-methodology): a method for keeping AI-built software honest.

## Start here

Three steps before you start your coding agent, then one prompt inside the session.

1. Install the CLI and its ship gate:

   ```sh
   npm install -g @stravica-ai/rcf-build-lite @stravica-ai/rcf-verify-lite
   ```

   The second package, [`@stravica-ai/rcf-verify-lite`](https://github.com/Stravica/rcf-lite/tree/main/packages/verify), is the independent verifier that `rcf finalise` runs against your deployed app; the two are recommended together. Installing build-lite alone still works — `rcf finalise` prompts to install the verifier rather than silently skipping the gate.

2. In your project directory, run `rcf init` (or `npx @stravica-ai/rcf-build-lite init` without the install). One command sets everything up: the requirements files, the MCP server entry and your agent's instructions.

3. Start your coding agent session in that directory — or restart the one you have open, so it picks up the new configuration.

Then hand your agent this prompt, filled in. The setup you just ran has already taught it how to work; all it needs from you is the idea:

```text
I want to build [describe your product idea in a sentence or two].
Let's get started.
```

If you'd rather drive it by hand, [docs/getting-started.md](docs/getting-started.md) covers the same ground at human pace. Prerequisites, install checks and agent-harness wiring live in [docs/install.md](docs/install.md).

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
| [docs/how-it-works.md](docs/how-it-works.md) | The document chain, the files, the verbs, the agent contract |
| [docs/why-it-exists.md](docs/why-it-exists.md) | The confidence gap, and why files plus a CLI is the answer |
| [docs/code-nodes.md](docs/code-nodes.md) | The spec-to-code bridge: Code Nodes, staleness detection, the mark-complete gate, honest limits |

[docs/README.md](docs/README.md) is the index; `rcf help <verb>` is the flag reference; [guidance/](guidance/README.md) is the agent-facing method pack.

## Under the hood

The traceability chain (PRD → REQ → US → AC → TS → TC) extends one layer further: **Code Nodes** make source code a first-class node in the same graph, so a dangling spec-to-code link fails `rcf validate` exactly the way a dangling spec-to-spec one does. `rcf trace` walks backward from a source file to the requirements it serves; `rcf impact` extends a change's blast radius into the code that implements it. Spec-only trees work unchanged — the code layer is additive. Full detail, deliberate limits and the roadmap beyond them: [docs/code-nodes.md](docs/code-nodes.md).

## Contributing

Not accepting external code contributions at this stage of the project. Bug reports and feature discussion via [Issues](https://github.com/Stravica/rcf-lite/issues) are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) covers the development setup and house rules that will apply when that changes.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
