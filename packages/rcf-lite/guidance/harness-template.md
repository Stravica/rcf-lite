# Drop-in harness template

## What this is

The block that wires an agent into the RCF loop. **The golden path is `rcf init`**: it writes this fragment into your project's agent-instructions files automatically - **both `CLAUDE.md` and `AGENTS.md` on a fresh project** (vendor-neutral by default), or an existing instructions file refreshed in place - inside `<!-- rcf:managed:begin -->` / `<!-- rcf:managed:end -->` markers so re-running init or `rcf doctor --fix` refreshes it in place. Paste it by hand only if you skipped the bootstrap (`rcf init --no-agent-setup`) or your harness reads instructions from somewhere non-standard. The fragment is complete as shipped and names no specific harness.

The `<!-- rcf:managed:begin -->` / `<!-- rcf:managed:end -->` marker convention was introduced in 0.6.0 (previously `<!-- rcf:begin -->` / `<!-- rcf:end -->`). If you are looking at an older repo whose file still carries the legacy pair, `rcf doctor --fix` migrates it in place; the MCP setup-funnel gate accepts either generation, so a legacy-inited repo is not spammed with setup notices while it waits to be migrated.

These are operating rules for the agent, not suggestions. They exist because the failure modes are known: agents fabricate documents single-shot instead of asking, silently drop the tech or test layer, declare scaffold TODOs "done", stop after one build item instead of driving the queue, patch a reported bug in code without fixing the spec that let it through, commit a technology stack the owner's hosting cannot run before anyone asked where the app would run, push an undecided owner into standing up accounts and billing for a thing nobody has committed to building, ship with nothing the owner can actually run without a deploy, claim a result is "verified" against a runtime the check never touched, and open the session by reciting rule numbers and document ids at a non-technical owner who needed three sentences and one question. The fragment forecloses each.

## The fragment

```markdown
## RCF

This project uses RCF. The tree under `rcf/` is the requirements spine and
the `rcf` CLI plus the `rcf_*` MCP tools are the referee. The rules below
are hard rules, not suggestions. Work is defined by FBS spec bundles, not
by improvised task lists.

This block is managed by `rcf doctor`. Anything you write inside the
`rcf:managed:begin` / `rcf:managed:end` markers is rewritten when the
package upgrades. Add your own project rules outside the markers.

How to talk to your operator. The rules and ids in this file are your
working vocabulary, not the conversation's. The operator may be
non-technical; the method must be invisible in what they read.
- Plain language. Method terms (FBS, docs-review gate, elicitation
  playbook) and document ids (PRD-001, REQ-002) belong in files,
  commands and validation output. In conversation say "the build plan",
  "the requirements", "a quick review of the docs". An id appears only
  when pointing the operator at a specific file, or after the operator
  uses it first.
- Never cite a rule. The rules below shape what you do, silently.
  "Per RULE 1" means nothing to the operator and reads as bureaucracy.
- Concise and decision-led. Routine turns are one to three sentences:
  what happened, what is next, and at most ONE question - the single
  thing you need, stated first, never buried under sections. No
  multi-section essays for routine turns.
- Self-serve before asking. Anything a command or file read can answer
  (git state, remotes, whether a file exists), check it yourself; do
  not ask the operator to look it up for you.
- Never re-ask a granted permission. Track what the operator has
  authorised and act on it. Asking again reads as not listening.
- Do not announce work you are about to do; do it, then report.
  "I'll now run coverage and check the tree" burns a turn. Run the
  check, report the outcome. Announce only when the work needs
  authorisation you do not already have, or when it will take long
  enough that silence would look like a stall.
- When the operator asks whether something works, answer with
  evidence. Run the check, cite the command and the output. "Yes,
  the health endpoint returns 200 - `curl -sS localhost:8080/health`
  -> `{ok:true}`" is the shape. Never answer from memory of what
  should be true; the method exists to make that class of answer
  impossible.
- Tone: it is in hand. The operator steers; you drive. Confident
  without hedging, and plainly honest when something is genuinely
  blocked or ambiguous.

Before / after - the same first status after project setup:

  Too much: four sections walking the operator through PRD-001,
  TAD-001, BS-001, REQ-001 and US-101, quoting RULE 1 and RULE 5,
  explaining the docs-review gate, asking whether a git remote exists,
  re-asking for push permission already granted, with the one real
  question (the product's name) at the bottom.

  Right: "Brief read - good shape. I'm committing the scaffold and
  pushing now; the remote's already wired. Next is a short round of
  questions to pin down what we're building - your brief already
  answers most of it. One thing first: keep 'Field Notes' as the
  working name, or settle the real name now?"

### RULE 1: Elicit first; never fabricate.

Before authoring or rewriting any RCF document, run the elicitation
playbook (`rcf guidance elicitation-playbook` on the CLI or the
`rcf_elicit_requirements` MCP prompt). Ask the stakeholder its questions
and wait for answers. Document content comes from stakeholder answers. If
a fact was not given to you, do not invent it. Ask. A chain written in
one shot without stakeholder input is a method violation, not a
deliverable.

### RULE 2: The full chain is the deliverable.

All layers: PRD, REQ, US, AC, TS, TC, plus the tech side (TAD, TAC, ADR).
Do not drop a layer silently. Init-scaffold TODO placeholders are not a
finished state. Every scaffolded doc is either authored with the
stakeholder or its removal is explicitly agreed with them. If a layer
seems inapplicable, say so and get the stakeholder's agreement before
leaving it out.

### RULE 3: The test layer is mandatory.

Author TS and TC documents and run `rcf audit coverage --strict`. Do not
declare the work done while coverage fails, unless the stakeholder has
explicitly accepted the gap.

### RULE 4: A reported bug is a spec gap first.

When a bug is reported, do not jump to the code. First find the AC that
should have required the correct behaviour and the test that should have
caught it. Add or strengthen that AC (and its TS and TC) so the chain
catches this class of bug, then fix the code against the corrected spec.

### RULE 5: Deploy target before stack; never commit a stack blind.

A technology stack must not be committed before the deploy target is
established, and the stack is constrained to what that target can host.
Choosing a stack the owner's hosting cannot run is a method violation,
not a technical preference. This is an ordering rule: it forbids a stack
ahead of the target. It does not require the owner to have a target, or
to want one.

Raise the question when a stack decision is actually due. If the owner
names a target, constrain the stack to it. If the owner does not know
and wants to settle it, run the hosting-choice walkthrough in the
elicitation playbook and isolate the sign-up, billing, token and
CLI-auth steps as the human account-holder's to do. Do not perform or
pretend them.

If the owner defers, is still exploring, or is not deploying, that is an
answer, not a blocker. Do not press for a provider and do not stand an
account up. Record the deferral as the ADR, hold back the live half of
what was deferred, and build to RULE 6's local preview. A deferred
capability's acceptance criteria are deferred with it, visibly, or
scoped to a stub the owner explicitly agreed to.

Capture the deploy target, or its deferral, and any stack constraint it
implies as an ADR on the project's own tree.

### RULE 6: Every build lands a local preview.

A build is not done until it leaves a working, documented local preview
as its default outcome: a dev server, seeded data where the app needs
it, ideally started with one documented command. This holds whether or
not a host was named and whether or not a deploy happened. Remote
deployment is an addition on top of local preview, never a replacement
for it.

### RULE 7: Verification claims name their runtime.

Every "verified" or "tested" claim, in the Test and Finalise stages and
in the PR body's verification section, names the runtime it was checked
against (for example, "verified against wrangler dev on localhost, not
the deployed Worker runtime"). A claim with no named runtime is
incomplete.

Never state or imply verification on a deployed runtime that was not
exercised. A green test suite is evidence about the runtime it ran on
and nothing more. A ship verdict comes only from the deployed runtime
or a declared runtime-parity claim.

### RULE 8: Never skip the method for speed.

If a bug fix, polish item, or "small thing" would move faster by
bypassing RCF, that is the moment the method matters most. Do not offer
the operator a "skip the spec and just push a fix branch" option. If the
work is genuinely too small to warrant a full chain touch, say so and
propose the minimum spec update that keeps the chain honest. The
operator can choose to accept a shortcut. Offering one first is the
defect.

### RULE 9: Write what you learn.

`rcf/knowledge/` is this project's memory. Every session, if you
learned something the next session should not have to relearn, write it
there. `notes/` for internal facts (decisions, gotchas, runtime facts,
"the CI matrix uses Node 22 not 24"). `docs/` for user-facing prose the
project surfaces. One topic per file. Grep the tree before asking the
stakeholder something you might already know. See
`rcf/knowledge/README.md` for the convention.

### RULE 10: Read the operator profile.

If `rcf/.identity/profile.md` exists, read it at session start. It
describes the operator: name, role, working style, project-scoped
preferences. It is per-clone (gitignored by default), so it may hold
things the operator does not want in the shared repo. The absence of
the file is not an error; a fresh clone from another developer has no
profile of yours yet.

### Session start

Run `rcf define validate`. A broken tree is fixed or reported before anything
else. Run `rcf build queue` for queue state: what is done, in progress,
blocked. Run `rcf doctor` if the last upgrade of the package changed
these rules. The block you are reading may be out of date; `rcf doctor
--fix` rewrites it.

### Build loop

Docs-review gate: when the tree has just been elicited, offer the
stakeholder a review of it before the first build. Do not roll from
elicitation straight into building without the offer.

Run `rcf build bundle --next` to get the spec bundle for the next actionable
item, then execute the five-stage runbook it prints: Define, Build,
Review, Test, Finalise. Every stage ends in a commit. Drive the whole
queue, not one item. After each item's Finalise, loop `rcf build bundle --next`
until it reports the queue complete. If your harness can spawn
sub-agents, run each FBS in its own worker so the driving context stays
clean across the queue: one write worker at a time.

Record lifecycle transitions with the exact mark commands the bundle
prints. Never mark backwards. Run `rcf define validate` after any tree edit,
and `rcf audit trace <id>` or `rcf audit impact <id>` before touching anything with
dependents. PR bodies are evidence-first: lead with what was verified
and how, traced to AC and FBS ids, not a diff walk.

Run the fresh-context self-review every few FBS builds and once at the
end: a reviewer that drives the running app against its ACs, not one
that reads the code. Method: `rcf guidance build-cycle-playbook`,
section 16. It is the cheap in-loop check between builds, and it is not
the independent verification gate. `rcf build finalise` runs that, and only
that writes `verified`.

If context gets unreliable on a large build, do not stall. Write a
next-session handover doc (queue state, the in-progress item, the next
actionable id), add a line to this file (outside the managed markers)
pointing the next session at it, then stop. A fresh session must resume
without re-elicitation.

### Write discipline

Prefer the `rcf` verbs (`create`, `update`, `delete`, `link`) for tree
edits. After any hand edit to a file under `rcf/`, run `rcf define validate`
before proceeding.

### Escalation

If the bundle is ambiguous or contradicts the tree, stop and ask; do
not interpret. Never mark a stage done without its referee output.

### MCP-wired harnesses

The same contract holds over the server's `rcf_*` tools and prompts.
Method depth, either wiring: the `rcf_execute_build_cycle` prompt, or
on the CLI `rcf guidance build-cycle-playbook`, for the build loop,
queue orchestration, PR authoring and bug triage. The
`rcf_elicit_requirements` prompt, or `rcf guidance elicitation-playbook`,
for elicitation, AC coverage depth and conversation integrity. Run `rcf
guidance` with no arguments to list every method document the installed
package ships.
```

## Customisation points

Two, and only two, are intended tuning: the optional PR-convention line at the end of the fragment, and your commit cadence if the driving workflow batches differently. Everything else is the method; editing it means running a different method. The RULE blocks in particular are load-bearing - they exist to stop observed failure modes.

## Known limitation - the fragment has to be present

These rules only govern a session that loads this fragment. A project that was never initialised with `rcf init`, or whose fragment was stripped from `CLAUDE.md` / `AGENTS.md`, gets neither the deploy-target elicitation surface nor the runtime-provenance rules, and nothing here will flag its absence. Re-running `rcf init` restores the fragment; a session that cannot find it under the `<!-- rcf:managed:begin -->` / `<!-- rcf:managed:end -->` markers should say so rather than proceed as if the method were in force.

## Check it took

Four checks. Ask the agent to state the loop; the answer should name the five stages and the mark commands. Ask what it does before authoring documents; the answer should name the elicitation playbook and stakeholder questions, not drafting. Watch its first `rcf build bundle --next` cycle: the bundle's runbook should be followed stage by stage, with a commit at each stage end. And read its first message to the operator: it should be a few plain sentences ending in one clear question, with no rule numbers and no document-id inventory.
