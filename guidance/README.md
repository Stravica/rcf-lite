# Agent guidance pack

This directory is the product's agent-facing guidance layer: what an AI agent needs to run the RCF method well. The CLI referees the tree; these files teach the method the referee assumes. Everything here is static markdown, served to agents over MCP and readable in place.

## What each file is

| File | Consumer | Channel |
|---|---|---|
| [overview.md](overview.md) | Any agent or MCP client needing orientation | resource `rcf://docs/overview` |
| [document-model.md](document-model.md) | Agents authoring or editing tree documents | resource `rcf://docs/document-model` |
| [build-cycle.md](build-cycle.md) | Agents in the build loop; the normative cycle statement | resource `rcf://docs/build-cycle` |
| [harness-template.md](harness-template.md) | Adopters wiring an agent harness; agents self-installing | resource `rcf://docs/harness-template` |
| [build-cycle-playbook.md](build-cycle-playbook.md) | The operating agent executing FBS items | prompt `rcf_execute_build_cycle` |
| [elicitation-playbook.md](elicitation-playbook.md) | The eliciting agent starting a project with a human | prompt `rcf_elicit_requirements` |
| [manifest.json](manifest.json) | The MCP server; the drift tests | machine channel map |

The playbooks are prompts (instructions to a model); the reference docs are resources (context a client attaches). Each file has one canonical MCP address. Slugs are the filename minus `.md`, so the mapping is guessable without the manifest.

## Adoption in three steps

1. Install the package so the `rcf` binary and this pack are on hand.
2. Paste the fragment from [harness-template.md](harness-template.md) into your project's CLAUDE.md or AGENTS.md.
3. Have your agent run `rcf build --next` and execute the runbook the bundle prints.

That is the whole loop. The playbooks add depth when the agent needs it; the bundle's built-in runbook is enough to start.
