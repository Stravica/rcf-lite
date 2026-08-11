# RCF Lite

[![ci](https://github.com/Stravica/rcf-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/Stravica/rcf-lite/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)

Tooling for the [Requirements Confidence Framework (RCF)](https://stravica.ai/rcf-methodology): a method for keeping AI-built software honest.

Anyone who has shipped with a coding agent knows the failure mode. The code arrives fast, but what the product is supposed to do lives in prompt history, and prompt history is not a spec. RCF keeps a live, machine-checkable chain from what you asked for, through requirements, user stories, acceptance criteria and tests, into the code itself, as plain JSON files in your own repository. Your agent works the chain instead of improvising, validation catches drift the moment it happens, and an independent verifier judges the deployed app before anything gets called done.

## What ships from this repo

One published package, `rcf-lite`, which covers the build stage, the verify stage and the shared internals:

```sh
npm install -g rcf-lite
```

The install exposes two bins, both dispatched from the same source tree:

- `rcf` — the unified CLI (30+ verbs including `init`, `view`, `validate`, `build`, `verify`, `finalise`).
- `rcf-verify` — a transition-grace alias for the adversarial ship-gate verifier. Prefer `rcf verify <run|report|provision|cleanup|mcp>`; the alias prints a one-line deprecation notice on stderr and will be removed in a future major (silence it in scripts with `RCF_QUIET=1`).

See the package README at [packages/rcf-lite/README.md](packages/rcf-lite/README.md) for the full CLI tour.

### Where this came from

Before 0.7.1 the suite shipped as three separately published packages (`@stravica-ai/rcf-build-lite`, `@stravica-ai/rcf-verify-lite`, `@stravica-ai/rcf-lite-core`). Those names are now deprecated on npm and point at `rcf-lite`. If your lockfile still pins one of them, update to `rcf-lite` on next release. The rationale, the migration and the registry runbook live in [docs/2026-08-06_packaging-consolidation-proposal.md](docs/2026-08-06_packaging-consolidation-proposal.md) and [docs/2026-08-06_packaging-registry-runbook.md](docs/2026-08-06_packaging-registry-runbook.md).

## Quickstart

```sh
npm install -g rcf-lite
mkdir my-app && cd my-app
rcf init
```

One command sets everything up: the requirements files under `rcf/`, the MCP server entry and your agent's instructions. Then start your coding agent session in that directory and hand it a prompt shaped like this:

```text
I want to build [describe your product idea in a sentence or two].
Let's get started.
```

The agent elicits the requirements and drives the build from there. To drive it by hand instead, [the getting-started guide](packages/rcf-lite/docs/getting-started.md) walks the same ground at human pace, and [install.md](packages/rcf-lite/docs/install.md) covers prerequisites and agent-harness wiring.

## Where these tools sit in the suite

The RCF lite suite follows the method's stage chain: **define, build, verify, release, attest**. This repo ships the tooling for the build and verify stages. The unified `rcf` bin also carries the define stage in practice, since `rcf init` plus your agent session is where the requirements chain gets authored.

Sister repo (kept standalone as a language-neutral contract, per the 2026-08-06 Baz ruling on schemas):

- [`Stravica/rcf-schemas`](https://github.com/Stravica/rcf-schemas): the JSON Schema contract for RCF documents. Every tree these tools read or write validates against it. Consumed as an exact-pinned dependency by `rcf-lite`.
- [`Stravica/rcf-examples`](https://github.com/Stravica/rcf-examples): complete example RCF trees, from `minimal-product` to `comprehensive-product`.

This repo also runs on its own tooling. The umbrella's PRD, requirements, stories, acceptance criteria and build queue live as JSON under [`packages/rcf-lite/rcf/`](packages/rcf-lite/rcf), and the build queue in there is the one that drove the tool's own development.

## Development

Requires Node.js >= 24 and pnpm 9.

```sh
git clone https://github.com/Stravica/rcf-lite.git
cd rcf-lite
pnpm install
pnpm test        # runs the test suite for the umbrella package
```

## Contributing

Not accepting external code contributions at this stage of the project. Bug reports and feature discussion via [Issues](https://github.com/Stravica/rcf-lite/issues) are welcome. [CONTRIBUTING.md](packages/rcf-lite/CONTRIBUTING.md) covers the development setup and the house rules that will apply when that changes.

## License

Apache 2.0. See [LICENSE](./LICENSE). The umbrella package ships its own copy.
