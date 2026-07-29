# RCF Lite

[![ci](https://github.com/Stravica/rcf-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/Stravica/rcf-lite/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)

Tooling for the [Requirements Confidence Framework (RCF)](https://stravica.ai/rcf-methodology): a method for keeping AI-built software honest.

Anyone who has shipped with a coding agent knows the failure mode. The code arrives fast, but what the product is supposed to do lives in prompt history, and prompt history is not a spec. RCF keeps a live, machine-checkable chain from what you asked for, through requirements, user stories, acceptance criteria and tests, into the code itself, as plain JSON files in your own repository. Your agent works the chain instead of improvising, validation catches drift the moment it happens, and an independent verifier judges the deployed app before anything gets called done.

## What ships from this repo

Three npm packages, published from this pnpm workspace:

| Package | What it is |
|---|---|
| [`@stravica-ai/rcf-build-lite`](https://www.npmjs.com/package/@stravica-ai/rcf-build-lite) ([README](packages/build/README.md)) | The build-stage tool: CLI, MCP server, live tree viewer and agent build adapter. `rcf init` scaffolds a project and wires your coding agent; `rcf validate` catches drift; `rcf finalise` gates the finish line. |
| [`@stravica-ai/rcf-verify-lite`](https://www.npmjs.com/package/@stravica-ai/rcf-verify-lite) ([README](packages/verify/README.md)) | The ship gate: launches a fresh, isolated AI agent that walks real user journeys against your running app, adversarially, and emits a structured verdict. Never sees your source or your builder's claims. |
| [`@stravica-ai/rcf-lite-core`](https://www.npmjs.com/package/@stravica-ai/rcf-lite-core) ([README](packages/core/README.md)) | Shared internals (chain store, structured errors, MCP protocol shell). Pulled in transitively; you almost certainly do not install it directly. |

Build and verify are designed to ship together:

```sh
npm install -g @stravica-ai/rcf-build-lite @stravica-ai/rcf-verify-lite
```

## Quickstart

```sh
npm install -g @stravica-ai/rcf-build-lite @stravica-ai/rcf-verify-lite
mkdir my-app && cd my-app
rcf init
```

One command sets everything up: the requirements files under `rcf/`, the MCP server entry and your agent's instructions. Then start your coding agent session in that directory and hand it a prompt shaped like this:

```text
I want to build [describe your product idea in a sentence or two].
Let's get started.
```

The agent elicits the requirements and drives the build from there. To drive it by hand instead, [the getting-started guide](packages/build/docs/getting-started.md) walks the same ground at human pace, and [install.md](packages/build/docs/install.md) covers prerequisites and agent-harness wiring.

## Where these tools sit in the suite

The RCF lite suite follows the method's stage chain: **define → build → verify → release → attest**. This repo ships the tooling for the build and verify stages. `rcf-build-lite` also carries the define stage in practice, since `rcf init` plus your agent session is where the requirements chain gets authored.

Sister repos:

- [`Stravica/rcf-schemas`](https://github.com/Stravica/rcf-schemas): the language-neutral JSON Schema contract for RCF documents. Every tree these tools read or write validates against it.
- [`Stravica/rcf-examples`](https://github.com/Stravica/rcf-examples): complete example RCF trees, from `minimal-product` to `comprehensive-product`.

This repo also runs on its own tooling. Build Lite's PRD, requirements, stories, acceptance criteria and build queue live as JSON under [`packages/build/rcf/`](packages/build/rcf), and the build queue in there is the one that drove the tool's own development.

## Development

Requires Node.js >= 24 and pnpm 9.

```sh
git clone https://github.com/Stravica/rcf-lite.git
cd rcf-lite
pnpm install
pnpm test        # runs the test suites across all workspace packages
```

## Contributing

Not accepting external code contributions at this stage of the project. Bug reports and feature discussion via [Issues](https://github.com/Stravica/rcf-lite/issues) are welcome. [CONTRIBUTING.md](packages/build/CONTRIBUTING.md) covers the development setup and the house rules that will apply when that changes.

## License

Apache 2.0. See [LICENSE](./LICENSE). Each package also ships its own copy.
