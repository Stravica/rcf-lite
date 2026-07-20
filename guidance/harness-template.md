# Drop-in harness template

## What this is

The block that wires an agent into the RCF loop. **The golden path is `rcf init`**: it writes this fragment into your project's agent-instructions files automatically - **both `CLAUDE.md` and `AGENTS.md` on a fresh project** (vendor-neutral by default), or an existing instructions file refreshed in place - inside `<!-- rcf:begin -->` / `<!-- rcf:end -->` markers so re-running init refreshes it. Paste it by hand only if you skipped the bootstrap (`rcf init --no-agent-setup`) or your harness reads instructions from somewhere non-standard. The fragment is complete as shipped and names no specific harness.

These are operating rules for the agent, not suggestions. They exist because the failure modes are known: agents fabricate documents single-shot instead of asking, silently drop the tech or test layer, declare scaffold TODOs "done", stop after one build item instead of driving the queue, patch a reported bug in code without fixing the spec that let it through, commit a technology stack the owner's hosting cannot run before anyone asked where the app would run, ship with nothing the owner can actually run without a deploy, and claim a result is "verified" against a runtime the check never touched. The fragment forecloses each.

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

RULE 5 - Deploy target before stack; never commit a stack blind.
- A technology stack must NOT be committed before the deploy target is
  established. Where the app will run is elicited early, and the stack is
  constrained to what that target can host. Choosing a stack the owner's
  hosting cannot run is a method violation, not a technical preference.
- If the owner does not know where it will run, run the hosting-choice
  walkthrough in the elicitation playbook - plain language, no silent
  pick - and isolate the sign-up / billing / token / CLI-auth steps as
  the human account-holder's to do. Do not perform or pretend them.
- Capture the deploy target and the stack constraint it implies as an ADR
  on the project's own tree.

RULE 6 - Every build lands a local preview.
- A build is not done until it leaves a working, documented local preview
  as its default outcome - a dev server, seeded data where the app needs
  it, ideally started with one documented command. This holds whether or
  not a host was named and whether or not a deploy happened; remote
  deployment is an addition on top of local preview, never a replacement
  for it.

RULE 7 - Verification claims name their runtime.
- Every "verified" or "tested" claim - in the Test and Finalise stages
  and in the PR body's verification section - names the runtime it was
  checked against (for example "verified against wrangler dev (localhost)
  - NOT the deployed Worker runtime"). A claim with no named runtime is
  incomplete.
- Never state or imply verification on a deployed runtime that was not
  exercised. A green test suite is evidence about the runtime it ran on
  and nothing more; a ship verdict comes only from the deployed runtime
  or a declared runtime-parity claim.

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
- Run the interim fresh-context self-review (build-cycle playbook) every
  few FBS builds and once at the end: a reviewer that drives the running
  app against its ACs, not one that reads the code. It is an interim
  stopgap until rcf-verify-lite, not the independent verification gate.
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

## Known limitation - the fragment has to be present

These rules only govern a session that loads this fragment. A project that was never initialised with `rcf init`, or whose fragment was stripped from `CLAUDE.md` / `AGENTS.md`, gets neither the deploy-target elicitation surface nor the runtime-provenance rules, and nothing here will flag its absence. Re-running `rcf init` restores the fragment; a session that cannot find it under the `<!-- rcf:begin -->` / `<!-- rcf:end -->` markers should say so rather than proceed as if the method were in force.

## Check it took

Three checks. Ask the agent to state the loop; the answer should name the five stages and the mark commands. Ask what it does before authoring documents; the answer should name the elicitation playbook and stakeholder questions, not drafting. Then watch its first `rcf build --next` cycle: the bundle's runbook should be followed stage by stage, with a commit at each stage end.
