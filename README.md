# rcf-build-lite

RCF Build Lite - CLI, MCP server, live HTML view (`rcf view`) and `rcf build` SDD adapter for the [Requirements Confidence Framework (RCF)](https://stravica.ai/rcf-methodology): an unbroken, machine-checkable chain from product intent to test evidence, kept as JSON files in your own repository. First consumer of [`@stravica-ai/rcf-schemas`](https://github.com/Stravica/rcf-schemas).

## Start here: hand this to your coding agent

You do very little; your agent does the rest. Copy this prompt, fill in the first line, and give it to your coding agent:

```text
I want to build [describe your product idea in a sentence or two].

Before writing any code, set up RCF Build Lite so this project runs
against a real requirements spine:

1. Clone https://github.com/Stravica/rcf-build-lite and follow its
   docs/install.md (install from source; the package is not on npm yet).
2. Read docs/getting-started.md and docs/how-it-works.md from that repo.
3. Initialise an RCF tree in my project with rcf init, and paste the
   fragment from guidance/harness-template.md into this project's
   CLAUDE.md or AGENTS.md.
4. Interview me about what I want to build. Capture it as a PRD,
   requirements, user stories and acceptance criteria, following the
   rcf_elicit_requirements playbook (guidance/elicitation-playbook.md),
   and show me the result with rcf view.
5. When the tree validates clean, start the build loop: rcf build --next,
   then execute the spec bundle it prints, stage by stage.
```

Working by hand instead? [docs/getting-started.md](docs/getting-started.md) is the same journey at human pace.

**Status:** pre-publish. The v0.1 surface has shipped - thirteen working verbs plus `mcp` and `help`, the agent guidance pack, 600-plus tests; not yet published to npm, so installation is from source ([docs/install.md](docs/install.md)).

## This repo runs on it

Build Lite's own PRD, requirements, user stories, acceptance criteria, TAD and build queue live as JSON under [`rcf/`](./rcf), validated against [`@stravica-ai/rcf-schemas`](https://github.com/Stravica/rcf-schemas). The roots are declared in [`rcf/manifest.json`](./rcf/manifest.json); everything else is discovered by walking the tree. The build queue in there is the one that drove the tool's own phases - the artefacts are the demo.

## Quickstart

```sh
git clone https://github.com/Stravica/rcf-build-lite.git
cd rcf-build-lite
pnpm install
pnpm rcf view     # this repo's own RCF tree, rendered live in your browser
```

Then scaffold your own project: [docs/getting-started.md](docs/getting-started.md).

## Docs

| Doc | One line |
|---|---|
| [docs/install.md](docs/install.md) | Prerequisites, source install, verify, wire into an agent harness |
| [docs/getting-started.md](docs/getting-started.md) | Empty directory to a validated, queried, building RCF project |
| [docs/how-it-works.md](docs/how-it-works.md) | The document chain, the files, the fifteen verbs, the agent contract |
| [docs/why-it-exists.md](docs/why-it-exists.md) | The confidence gap, and why files plus a CLI is the answer |

[docs/README.md](docs/README.md) is the index; `rcf help <verb>` is the flag reference; [guidance/](guidance/README.md) is the agent-facing method pack.

## Depends on

[`@stravica-ai/rcf-schemas`](https://github.com/Stravica/rcf-schemas) - the language-neutral JSON Schema contract every RCF tool keys to.

## License

Apache 2.0 - see [LICENSE](./LICENSE).
