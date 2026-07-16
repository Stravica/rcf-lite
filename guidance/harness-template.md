# Drop-in harness template

## What this is

The block that wires an agent into the RCF loop. **The golden path is `rcf init`**: it writes this fragment into your project's agent-instructions files automatically - **both `CLAUDE.md` and `AGENTS.md` on a fresh project** (vendor-neutral by default), or an existing instructions file refreshed in place - inside `<!-- rcf:begin -->` / `<!-- rcf:end -->` markers so re-running init refreshes it. Paste it by hand only if you skipped the bootstrap (`rcf init --no-agent-setup`) or your harness reads instructions from somewhere non-standard. The fragment is complete as shipped and names no specific harness.

These are operating rules for the agent, not suggestions. They exist because the failure modes are known: agents fabricate documents single-shot instead of asking, silently drop the tech or test layer, declare scaffold TODOs "done", stop after one build item instead of driving the queue, and patch a reported bug in code without fixing the spec that let it through. The fragment forecloses each.

## The fragment

```markdown
## RCF

This project uses RCF. The tree under rcf/ is the requirements spine and
the rcf CLI / rcf_* MCP tools are the referee. The rules below are hard
rules, not suggestions. Work is defined by FBS spec bundles, not by
improvised task lists.

RULE 1 - Elicit first; never fabricate.
- Before authoring or rewriting any RCF document, run the elicitation
  playbook: the rcf_elicit_requirements MCP prompt (or
  guidance/elicitation-playbook.md). Ask the stakeholder its questions
  and WAIT for answers.
- Document content comes from stakeholder answers. If a fact was not
  given to you, do not invent it - ask. A chain written in one shot
  without stakeholder input is a method violation, not a deliverable.

RULE 2 - The full chain is the deliverable.
- All layers: PRD -> REQ -> US -> AC -> TS -> TC, plus the tech side
  (TAD, TAC, ADR). Do not drop a layer silently.
- Init-scaffold TODO placeholders are NOT a finished state. Every
  scaffolded doc is either authored with the stakeholder or its removal
  is explicitly agreed with them.
- If a layer seems inapplicable, say so and get the stakeholder's
  agreement before leaving it out.

RULE 3 - The test layer is mandatory.
- Author TS and TC documents and run rcf coverage --strict. Do not
  declare the work done while coverage fails, unless the stakeholder has
  explicitly accepted the gap.

RULE 4 - A reported bug is a spec gap first.
- When a bug is reported, do not jump to the code. First find the AC that
  should have required the correct behaviour and the test that should
  have caught it; add or strengthen that AC (and its TS / TC) so the
  chain catches this class of bug, THEN fix the code against the
  corrected spec.

Session start:
- Run rcf validate. A broken tree is fixed or reported before anything
  else.
- Run rcf build for queue state: what is done, in progress, blocked.

Build loop:
- Docs-review gate: when the tree has just been elicited, offer the
  stakeholder a review of it before the first build. Do not roll from
  elicitation straight into building without the offer.
- Run rcf build --next to get the spec bundle for the next actionable
  item, then execute the five-stage runbook it prints: Define, Build,
  Review, Test, Finalise. Every stage ends in a commit.
- Drive the whole queue, not one item. After each item's Finalise, loop
  rcf build --next until it reports the queue complete. If your harness
  can spawn sub-agents, run each FBS in its own worker so the driving
  context stays clean across the queue - one write worker at a time.
- Record lifecycle transitions with the exact mark commands the bundle
  prints. Never mark backwards.
- Run rcf validate after any tree edit, and rcf trace <id> or
  rcf impact <id> before touching anything with dependents.
- PR bodies are evidence-first: lead with what was verified and how,
  traced to AC / FBS ids, not a diff walk.
- If context gets unreliable on a large build, do not stall. Write a
  next-session handover doc (queue state, the in-progress item, the next
  actionable id), add a line to this file pointing the next session at
  it, then stop. A fresh session must resume without re-elicitation.

Write discipline:
- Prefer the rcf verbs (create, update, delete, link) for tree edits.
- After any hand edit to a file under rcf/, run rcf validate before
  proceeding.

Escalation:
- If the bundle is ambiguous or contradicts the tree, stop and ask; do
  not interpret.
- Never mark a stage done without its referee output.

MCP-wired harnesses: the same contract holds over the server's rcf_*
tools and prompts. Method depth: the rcf_execute_build_cycle prompt (or
guidance/build-cycle-playbook.md) for the build loop, queue
orchestration, PR authoring and bug triage; the rcf_elicit_requirements
prompt for elicitation, AC coverage depth and conversation integrity.

<!-- Optional: state your PR convention here, e.g. "PRs target main". -->
```

## Customisation points

Two, and only two, are intended tuning: the optional PR-convention line at the end of the fragment, and your commit cadence if the driving workflow batches differently. Everything else is the method; editing it means running a different method. The RULE blocks in particular are load-bearing - they exist to stop observed failure modes.

## Check it took

Three checks. Ask the agent to state the loop; the answer should name the five stages and the mark commands. Ask what it does before authoring documents; the answer should name the elicitation playbook and stakeholder questions, not drafting. Then watch its first `rcf build --next` cycle: the bundle's runbook should be followed stage by stage, with a commit at each stage end.
