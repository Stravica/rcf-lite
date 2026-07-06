# Drop-in harness template

## What this is

One paste-in block that wires an agent into the RCF loop. Paste it into the agent instructions file at your project root: `CLAUDE.md` for Claude Code, `AGENTS.md` for harnesses that read that convention. Nothing else needs configuring; the fragment is complete as shipped and names no specific harness.

## The fragment

```markdown
## RCF

This project uses RCF. The tree under rcf/ is the requirements spine and
the rcf CLI is the referee. Work is defined by FBS spec bundles, not by
improvised task lists.

Session start:
- Run rcf validate. A broken tree is fixed or reported before anything else.
- Run rcf build for queue state: what is done, in progress, blocked.

Build loop:
- Run rcf build --next to get the spec bundle for the next actionable item.
- Execute the five-stage runbook the bundle prints: Define, Build, Review,
  Test, Finalise. Every stage ends in a commit.
- Record lifecycle transitions with the exact mark commands the bundle
  prints. Never mark backwards.

When to run the referees:
- rcf validate after any tree edit.
- rcf coverage --strict before claiming any acceptance-criterion work done.
- rcf trace <id> or rcf impact <id> before touching anything with dependents.

Write discipline:
- Prefer the rcf verbs (create, update, delete, link) for tree edits.
- After any hand edit to a file under rcf/, run rcf validate before
  proceeding.

Escalation:
- If the bundle is ambiguous or contradicts the tree, stop and ask; do not
  interpret.
- Never mark a stage done without its referee output.

MCP-wired harnesses: the same contract holds over the server's rcf_* tools
and prompts.

Method depth: fetch the rcf_execute_build_cycle prompt (or read
guidance/build-cycle-playbook.md in the rcf-build-lite repo) for the build
loop, and the rcf_elicit_requirements prompt (or
guidance/elicitation-playbook.md) for starting a tree from scratch.

<!-- Optional: state your PR convention here, e.g. "PRs target main". -->
```

## Customisation points

Two, and only two, are intended tuning: the optional PR-convention line at the end of the fragment, and your commit cadence if the driving workflow batches differently. Everything else is the method; editing it means running a different method.

## Check it took

Two checks. Ask the agent to state the loop; the answer should name the five stages and the mark commands. Then watch its first `rcf build --next` cycle: the bundle's runbook should be followed stage by stage, with a commit at each stage end.
