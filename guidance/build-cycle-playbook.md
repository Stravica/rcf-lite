# Build-cycle playbook

## 1. Read this if

You are the agent executing FBS items in an RCF project. Load this once per session, as the `rcf_execute_build_cycle` prompt or by reading this file, then loop. Every spec bundle closes with a terse runbook for the item in hand; that runbook is the contract you execute each cycle, and this playbook is the depth behind it. If the two ever disagree, the runbook wins; report the disagreement as a bug rather than resolving it yourself.

Every command output shown below is real, captured against this repository's own RCF tree (or a scratch copy of it, where noted). Outputs illustrate shape, not the tree's current queue state.

## 2. The loop at a glance

```
rcf build --next     -> spec bundle for the next actionable item
                        execute the five stages its runbook prints:
                        Define -> Build -> Review -> Test -> Finalise
rcf build <fbs-id> --mark <status>
                     -> record each lifecycle transition, then repeat
```

Queue semantics in four lines. An item is actionable when it is `notStarted` and every dependency is complete or verified. An item with an unsatisfied dependency is blocked; never select a blocked item yourself, `--next` does the selection. `inProgress` marks exactly one thing: an item you have started and not finished. When nothing is actionable, the envelope tells you whether the queue is complete (`queueEmpty`) or stuck, and a stuck queue lists what is blocked and what is in progress; stuck is a report-to-operator condition, not a pick-something-anyway condition.

This section is one item's five stages. A project is a queue of them, and finishing the queue - not finishing one item - is the job. Section 11 is the loop around this loop: how one session drives every FBS to done, and how a session that cannot writes a clean handover instead of stalling.

## 3. Stage 1 - Define

What good looks like:

- You have read the whole bundle before planning: the work (section 3), every acceptance criterion (section 4), the architectural context (section 5), the existing test surface (section 6).
- Your plan maps every in-scope AC id to intended work. An AC with no planned work, or planned work with no AC, is a plan defect.
- Ambiguity is settled before code. If two readings of an AC survive the read-through, that is an escalation (section 8), not a coin flip.

Referee: the bundle itself is the definition, and `rcf validate` confirms the tree you are building against is clean before you start.

Failure modes:

- **Skipping the AC read-through.** Symptom: the plan restates the FBS summary instead of the AC set. Correction: plan per AC id, not per title.
- **Gold-plating starts at Define.** Symptom: planned work exceeds the AC set (extra endpoints, extra options, extra refactors). Correction: the bundle is the spec; anything beyond it is escalation, not initiative.

Stage end: mark pickup and commit any plan artefacts the driving workflow requires.

```
$ rcf build FBS-012 --mark inProgress
marked FBS-012 notStarted -> inProgress
```

(Captured in a scratch copy of this repo's tree; exit 0.)

Worked micro-example. The FBS-005 bundle ("CLI read verbs") scopes three ACs: AC-301-1 (reading a valid document returns it and reports it as valid), AC-301-2 (reading an id with no file returns a structured not-found error naming the id), AC-301-3 (reading an invalid document returns both the content and the validation errors). Restated as a three-line plan:

1. AC-301-1: wire `rcf read <id>` to the store load; render content plus a validity line; test the valid path.
2. AC-301-2: return the structured not-found error with the id in it; test against a missing id.
3. AC-301-3: on schema failure, render content and errors together rather than either alone; test with a deliberately broken document.

Three ACs, three lines, nothing extra. That is the whole Define output for a small item.

## 4. Stage 2 - Build

What good looks like:

- Implement to the section-4 ACs using the section-5 context. The TACs name the components and boundaries you are expected to respect; the ADRs name decisions already taken, which you follow rather than relitigate.
- The bundle is the spec. When the code teaches you the spec is wrong, stop and escalate; do not quietly ship your improved version.
- As each AC lands, author or update its Code Node: `rcf create cn --path <file>[#symbol] --acs <ac-ids>`. Do this now - the mapping from symbol to AC is exactly what you are holding in your head mid-implementation, and Stage 5 refuses completion without it (section 9).
- Small commits inside the stage are fine; the stage-end commit is mandatory.

Referee: none new at this stage. The bundle stays open; you check yourself against it.

Failure modes:

- **Context drift.** Symptom: the work in your editor no longer maps to a section-4 AC; you are three files away from anything the bundle names. Correction: re-read the bundle before every substantial edit; if the drift was necessary, that is a dependency surprise (section 8).
- **Gold-plating.** Symptom: the diff contains capability no AC asked for. Correction: delete it or escalate it; both are cheaper than reviewing it.
- **Silent dependency additions.** Symptom: a new package or tool appears in the diff without an ADR or an operator decision behind it. Correction: dependencies are architecture; escalate before adding.

Stage end: commit.

## 5. Stage 3 - Review

What good looks like:

- The tree is structurally clean, and then the diff is re-read against the promise, not against itself. The question per AC is "where in this diff is AC-x satisfied?", answered with a file and a behaviour.
- Deviations are documented, not smoothed over. A deliberate deviation with a reason survives review; an undocumented one is a defect.

Referee:

```
$ rcf validate
rcf validate: tree is clean.
```

Exit 0 when clean; exit 3 with issue lines when not (section 9 shows the failure shape).

Failure modes:

- **Rubber-stamp review.** Symptom: review completes in the time it takes to scroll. Correction: the per-AC question above, answered per AC, in writing if the workflow keeps review notes.
- **Reviewing only what changed rather than what was promised.** Symptom: the review walks the diff top to bottom and never opens section 4. Correction: walk the AC list as the outer loop, the diff as the inner one. This is where AC-skipping is cheapest to catch.

Stage end: commit.

## 6. Stage 4 - Test

What good looks like:

- Every in-scope AC gets a TS / TC pair on the tree and an executable test behind it. Section 6 of the bundle lists what already exists and what is flagged as missing.
- The test asserts the AC's observable outcome (its given / when / then), not the implementation's internals.
- A TC's `status` reflects a run that actually happened.

Referee:

```
$ rcf coverage --strict
Coverage mode: strict (per-AC)
Requirements: 7  covered: 0  uncovered: 7

Requirement  Covered  AC        AC covered  Test cases
-----------  -------  --------  ----------  ----------
REQ-001      no       AC-101-1  no          -
```

(Captured against this repo's tree, first gap rows shown; exit 4.) Strict mode is per-AC: every AC in scope needs TC coverage, and any gap exits 4. Read the table by AC id: this stage ends when your in-scope ACs show `AC covered: yes` with test cases listed. Gaps elsewhere in the tree may legitimately remain and will keep the tree-wide command at exit 4; narrow the verdict with a scope id (`rcf coverage <scope-id> --strict`, PRD / REQ / US ids accepted) to read the subtree you are working in.

Failure modes:

- **Marking without verifying.** Symptom: a TC set to `passing` without a run. Correction: referee output is the precondition for every mark; run the suite, then record what it said.
- **Testing the implementation instead of the AC.** Symptom: the test breaks when internals are refactored but would pass if the behaviour were wrong. Correction: write the assertion from the AC's `then` clause, not from the code.

Stage end: commit.

## 7. Stage 5 - Finalise

What good looks like:

- CI green on the branch; PR raised and merged per the driving workflow's convention. The PR body is written for the reviewer, evidence first - author it per section 12, not as a diff walk.
- `rcf build <fbs-id> --mark complete` after the merge, never before it. This refuses (exit 3, `missingCodeNodes`) if any in-scope AC still carries no Code Node - a reliability chain with optional links is not a chain. Author the missing CNs and retry, or, for a genuinely no-code spec (docs-only, config-only), declare `rcf build <fbs-id> --mark complete --no-code-nodes` once.
- `rcf build <fbs-id> --mark verified` after post-merge verification: the merged artefact observed doing the right thing, not just the pre-merge tests remembered fondly.

Referee: CI, plus the mark commands' own refusals (section 9).

Failure modes:

- **AC-skipping at the finish line.** Symptom: a section-4 AC has no corresponding diff or test, discovered at PR time or never. Correction: a per-AC checklist pass before this stage ends; every AC id gets a tick against a diff location and a test.
- **Marking complete pre-merge.** Symptom: `--mark complete` while the PR is still open. Correction: the merge is the event; the mark records it, it does not predict it.
- **Reaching for `--no-code-nodes` out of impatience.** Symptom: the flag on a spec that plainly produced code. Correction: it declares a fact (no traceable code exists), not an escape from the CN-authoring step you skipped in Stage 2 - go back and author the CN instead.

Stage end: the merge is the commit.

## 8. Escalation rules

All five cases route to the same behaviour: stop, report, wait. Do not improvise a resolution and do not keep building while you wait.

- **Ambiguous or contradictory AC.** Two readings survive the read-through, or two ACs cannot both hold.
- **Bundle contradicts tree state.** The bundle says a dependency is complete and the tree says otherwise, or section 6 lists tests that do not exist.
- **Dependency surprise mid-build.** The work cannot proceed without touching something outside the bundle's scope, or without a new package or tool.
- **The urge to mark backwards.** Work marked complete turns out not to be. The lifecycle refuses the backward mark for a reason: the correction is an operator decision, not a status edit.
- **Blocked-item pressure.** Nothing is actionable and the temptation is to start a blocked item because its dependency is "nearly done". Nearly done is not done.

Report in this form, then wait:

```
Stopping on <fbs-id> at <stage>.
Found: <the ambiguity / contradiction / surprise, in one or two sentences>.
Options as I see them: <a> / <b>.
Waiting for direction.
```

## 9. Referee reference

The commands and their output, read at a glance. Exit codes: 0 success, 1 unexpected runtime failure, 2 usage error, 3 validation or broken references, 4 refused.

**`rcf validate`** - exit 0 and `rcf validate: tree is clean.` when clean. On issues, exit 3 with one line per issue naming the document and the rule, then a summary count. Captured in a scratch copy with a required field removed by hand:

```
[error] validation REQ-001: / must have required property 'title'
[error] brokenReference US-101: US US-101 references unknown REQ REQ-001
[error] brokenReference US-102: US US-102 references unknown REQ REQ-001
[error] 3 errors found; output written with broken-section markers. Pass --strict to refuse the render.
```

Note the fan-out: one broken document produced two broken references. Fix the named document first, then re-validate.

**`rcf coverage --strict`** - exit 0 when every AC in scope has TC coverage; exit 4 on any gap, with the per-AC table shown in section 6 above. The `Test cases` column is the evidence trail.

**`rcf build <fbs-id> --strict`** - exit 4 instead of a bundle when the item is blocked. Captured in a scratch copy with a dependency reset to `notStarted`:

```
[error] refused build: FBS-012 is blocked by FBS-010 (notStarted)
```

Without `--strict` the bundle renders anyway, flagged as a read-ahead; `--next` never selects blocked items.

**`rcf build <fbs-id> --mark <status>`** - exit 0 with a one-line confirmation (`marked FBS-012 notStarted -> inProgress`). The lifecycle is forward-only (`notStarted -> inProgress -> complete -> verified`; forward jumps legal). A backward mark is refused with exit 4 and names the escape hatch:

```
[error] refused build: refusing backward transition complete -> inProgress on FBS-005; for a deliberate correction use: rcf update FBS-005 --set executionStatus=inProgress
```

The escape hatch is for operator-sanctioned corrections. If you are reaching for it, you are in section 8's fourth case.

**Unknown id** - exit 2, structured:

```
[error] usage build: id FBS-999 not found
```

## 10. Worked micro-cycle

One condensed pass against this repository's own tree, captured at build time. Queue first:

```
$ rcf build
# Build queue: BS-001 - RCF Build Lite initial delivery

Generation strategy: dependencyFirst

| order | id | title | status | state | blocked by |
|---|---|---|---|---|---|
| 1 | FBS-001 | Document store core | complete | complete |  |
| 2 | FBS-002 | Tree walk and validate command | complete | complete |  |
| 3 | FBS-003 | Diagram rendering | complete | complete |  |
| 4 | FBS-004 | HTML page rendering | complete | complete |  |
| 5 | FBS-005 | CLI read verbs | complete | complete |  |
| 6 | FBS-006 | CLI create and update verbs | complete | complete |  |
| 7 | FBS-007 | CLI delete with reference safety | complete | complete |  |
| 8 | FBS-008 | Coverage and trace queries | complete | complete |  |
| 9 | FBS-009 | Impact analysis | complete | complete |  |
| 10 | FBS-010 | Build adapter prompt assembly | complete | complete |  |
| 11 | FBS-011 | Mark-done on completion | complete | complete |  |
| 12 | FBS-012 | MCP server over the full surface | notStarted | actionable |  |

Totals: items 12 | notStarted 1 | inProgress 0 | complete 11 | verified 0 | actionable 1 | blocked 0

Next actionable: FBS-012
```

One actionable item, so `rcf build --next` emits its bundle. The header orients you in one glance - what, where in the queue, how big, what it hangs off:

```
# Spec bundle: FBS-012 - MCP server over the full surface

## 1. Header

- Item: FBS-012 - MCP server over the full surface
- Queue: order 12, item 12 of 12
- Execution status: notStarted
- Estimated size: large
- Estimated hours: 10
- Risk level: medium
- Domain: mcp
- Parent chain: BS-001 -> PRD-001 (RCF Build Lite)
```

Mark pickup, and the cycle is running:

```
$ rcf build FBS-012 --mark inProgress
marked FBS-012 notStarted -> inProgress
```

From here it is the five stages, a commit per stage, `--mark complete` after the merge, `--mark verified` after post-merge verification, and back to `rcf build --next`.

## 11. Driving the whole queue

Sections 3 to 7 deliver one item. This section is the loop around them: how a single session takes a project from a full queue to an empty one, and how a session that genuinely cannot writes a clean handover instead of stopping halfway. "The agent could not build all the items in one session" is, almost always, a context-management failure, not a real limit - the runbook below is how you avoid it.

**The gate before the loop.** When you arrive here straight out of elicitation, the tree is fresh and no human has looked at it. Before you build anything, offer the operator a review: "The RCF tree is drafted and validates. Do you want to review it before I start the build, or shall I go?" Wait for the answer. Rolling from elicitation into the build without the offer is the failure comment behind this gate - a tree the operator never saw becomes a build they cannot course-correct.

**The loop.**

```
rcf build            -> queue state; a "Next actionable" id means there is work
rcf build --next     -> bundle for that item
                        run its five stages (sections 3-7), commit per stage
rcf build <fbs-id> --mark complete    (after merge)
rcf build <fbs-id> --mark verified    (after post-merge verification)
                        then rcf build --next again
```

You are done when `rcf build --next` stops handing back bundles and prints instead:

```
# Build queue: nothing actionable

Queue complete: every item is complete or verified.
```

That line - not "I built the first one" - is the end of the loop. If it instead reports `Queue not complete but nothing is actionable`, the queue is stuck on a blocker or an in-progress item; that is section 8's territory, report it.

**Keep the driving context thin (why one session is enough).** The reason a sixteen-item queue "won't fit in one session" is that the agent kept every item's bundle, diff and test detail in a single growing thread. It does not have to. If your harness can spawn sub-agents, run each FBS in its own worker:

- The driver (you) holds only the queue, the trace and the running tally of what is done. You call `rcf build --next`, hand the bundle id to a worker, and wait for a short structured result.
- The worker holds one item's full working set - the bundle, the diff, the tests, the referee outputs - runs the five stages, opens its PR, and returns a few lines: item id, ACs satisfied, referee outputs, PR link, and any escalation. Then its context is discarded.
- The driver's context stays flat across all sixteen items because it never holds more than a summary of any one. That is the mechanism that makes a small app's whole queue a single-session job.

Brief each worker with the same four things the bundle names: the item id, the five-stage cycle, the exact mark commands, and the escalation rule. **One write worker at a time** - builds share the working tree, so two workers marking and committing at once collide. Read-only workers (a trace lookup, an impact check) can run in parallel; writers are strictly sequential. `--next` already hands items out in dependency order, so sequential is also correct order.

**When to hand over instead of pushing on.** For a large stack, judge context cleanliness honestly rather than optimistically. The signs it is time to hand over: referee outputs contradict your memory of the tree, you are re-reading a bundle to reload state you should still be holding, or you have lost confidence about which items are truly done. Do not drag a degraded session to the finish - a wrong `--mark complete` costs more than a handover.

**The handover protocol.** A handover is state capture, not a memory dump. A fresh session must be able to resume from it without re-eliciting anything or re-deriving the queue.

1. Run `rcf build` and `rcf validate` first, so the handover records the tree's true state, not your remembered state.
2. Write a next-session handover doc (e.g. `rcf/handover.md`, or wherever the harness keeps session notes). It captures: what is complete/verified, what is in progress and exactly where it stopped, the next actionable id, any open escalation awaiting a ruling, and any decision taken in conversation that is not yet written into the tree.
3. Point the agent-instructions files at it. Add one line to `CLAUDE.md` and `AGENTS.md` telling the next session to read the handover before anything else. A handover doc nobody is instructed to open is not a handover.

The test of a good handover: the next session reads it, runs `rcf build`, and continues - no questions back to the operator about what was going on. If it has to ask, the handover failed.

**Failure modes:**

- **Stopping after one item.** Symptom: the session ends with a still-actionable queue and no handover. Correction: either loop to `Queue complete` or hand over; "I did the first one" is neither.
- **Inlining everything until the context is full.** Symptom: the thread carries every item's diff and the agent concludes the rest is impossible this session. Correction: dispatch per item; the driver never holds more than one item's working set.
- **Handover as narration.** Symptom: a wall of prose the next session cannot act on. Correction: capture ids, statuses, the next actionable id and the stop point, not the story of how you got there.

## 12. Authoring the PR

When Finalise raises a PR, the body is for the reviewer - human or agent - and its one job is to let them confirm the work is correct without reverse-engineering it from the diff. Lead with evidence and verification, not a changelog. RCF hands you what an ordinary PR lacks: every claim traces to an AC id, and the referee outputs are real, quotable evidence. Use them.

**The body, in this order:**

1. **What and why, traced.** What changed, mapped to the FBS and its in-scope ACs. The AC ids are the "why" - they are the spec this diff exists to satisfy, so a reviewer can check the diff against the promise, not against your description of it.
2. **Verification actually performed.** Not "tests pass". State what you ran and what it reported: the test command and its result, `rcf coverage --with-code` (or a story-scoped `rcf coverage <us-id> --strict`) with the per-AC lines, `rcf validate` clean. Paste the outputs - they are the evidence, and pasted referee output is not something a reviewer has to take on trust.
3. **Per-AC evidence trail.** For each in-scope AC: where it is satisfied (file and symbol) and the test that proves it. This is what `rcf coverage --with-code` and `rcf trace` already give you; lift it in rather than reprose it.
4. **Known limits and deviations, declared.** Anything you escalated and how it was ruled, any deliberate deviation from the bundle and its reason, any gap the operator accepted. A declared limit survives review; the same limit found later by the reviewer is a defect and a trust hit.

**What not to do:** a file-by-file walk of the diff (the reviewer can read the diff), "all tests pass" with no command or output behind it, or any verification claim you did not actually run. Zero unverifiable claims - every line in the body is something the reviewer can independently check.

A shape to fill in:

```
## What & why
FBS-012 - MCP server over the full surface. Satisfies AC-301-1, AC-301-2, AC-301-3.
- AC-301-1: <the behaviour this AC pins, one line>
- AC-301-2: ...
- AC-301-3: ...

## Verification performed
- <test command>: <result, e.g. 807 passing> (full suite)
- rcf coverage --with-code: in-scope ACs covered, per-AC lines below
- rcf validate: tree is clean
<paste the referee outputs here>

## Per-AC evidence
- AC-301-1: <file#symbol> - <test id / name>
- AC-301-2: ...
- AC-301-3: ...

## Known limits / deviations
- <none, or: escalation X ruled Y; deliberate deviation Z, because ...>
```

PR mechanics - the branch, the target, the open command - belong to your driving workflow, not to any `rcf` verb; the harness fragment's PR-convention line is where the target branch is stated. This section is about what goes in the body.

## 13. Triage a bug back to the spec first

A bug that reached a build is a bug a test did not catch, which is a behaviour an AC did not require. The bug is the symptom; the missing or weak AC is the cause. Fix the cause first - not out of process piety, but because a code-only fix leaves the chain blind to the next instance of the same bug, and the next build can reintroduce it under a clean coverage report.

**The order - do not jump to the code:**

1. **Reproduce, then trace the bug to its governing AC.** Which AC should have made the correct behaviour required? Walk the tree with `rcf trace` from the story or the offending source path, and `rcf coverage --with-code` to see whether the behaviour was ever covered at all.
2. **Name the gap.** Either no AC covers this scenario - the common case, usually a missing edge or failure path - or an AC covers it but too weakly (a happy-path AC where the bug lives in the failure path). Both are elicitation-depth misses; the standard for an adequate AC set is section 5 of the elicitation playbook.
3. **Fix the spec.** Add or strengthen the AC so the scenario is required (`rcf create ac` / `rcf update`), then add its TS/TC so the chain checks it. Now the tree would catch this class of bug on the next run.
4. **Fix the code against the corrected spec,** and prove it with the new test - the one that would have failed before your change and passes after it.

**Escalation:** if strengthening the AC changes agreed behaviour rather than closing an obvious gap, that is a spec decision, not a silent redraw. Surface it (section 8) before you change it. Tightening "returns an empty list on no match" onto an existing search AC is closing a gap; changing what the feature is supposed to do is a decision for the operator.
