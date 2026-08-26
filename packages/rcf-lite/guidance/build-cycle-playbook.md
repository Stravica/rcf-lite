<!-- Never-skip-RCF invariant is a platform rule; the byte-identical statement lives at §13. Editors: any change to guidance wording is subject to canary release-block. -->

# Build-cycle playbook

## 1. Read this if

You are the agent executing FBS items in an RCF project. Load this once per session - as the `rcf_execute_build_cycle` prompt, or by running `rcf guidance build-cycle-playbook` on the CLI - then loop. Every spec bundle closes with a terse runbook for the item in hand; that runbook is the contract you execute each cycle, and this playbook is the depth behind it. If the two ever disagree, the runbook wins; report the disagreement as a bug rather than resolving it yourself.

Every command output shown below is real, captured against this repository's own RCF tree (or a scratch copy of it, where noted). Outputs illustrate shape, not the tree's current queue state.

## 2. The loop at a glance

```
rcf build bundle --next     -> spec bundle for the next actionable item
                        execute the five stages its runbook prints:
                        Define -> Build -> Review -> Test -> Finalise
rcf build mark <fbs-id> <status>
                     -> record each lifecycle transition, then repeat
```

Queue semantics in four lines. An item is actionable when it is `notStarted` and every dependency is complete or verified. An item with an unsatisfied dependency is blocked; never select a blocked item yourself, `--next` does the selection. `inProgress` marks exactly one thing: an item you have started and not finished. When nothing is actionable, the envelope tells you whether the queue is complete (`queueEmpty`) or stuck, and a stuck queue lists what is blocked and what is in progress; stuck is a report-to-operator condition, not a pick-something-anyway condition.

This section is one item's five stages. A project is a queue of them, and finishing the queue - not finishing one item - is the job. Section 11 is the loop around this loop: how one session drives every FBS to done, and how a session that cannot writes a clean handover instead of stalling. Section 17 sets the register for what the operator reads while you drive it.

## 3. Stage 1 - Define

What good looks like:

- You have read the whole bundle before planning: the work (section 3), every acceptance criterion (section 4), the architectural context (section 5), the existing test surface (section 6).
- Your plan maps every in-scope AC id to intended work. An AC with no planned work, or planned work with no AC, is a plan defect.
- Ambiguity is settled before code. If two readings of an AC survive the read-through, that is an escalation (section 8), not a coin flip.

Referee: the bundle itself is the definition, and `rcf define validate` confirms the tree you are building against is clean before you start.

Failure modes:

- **Skipping the AC read-through.** Symptom: the plan restates the FBS summary instead of the AC set. Correction: plan per AC id, not per title.
- **Gold-plating starts at Define.** Symptom: planned work exceeds the AC set (extra endpoints, extra options, extra refactors). Correction: the bundle is the spec; anything beyond it is escalation, not initiative.

**Third-party service dependencies belong on the FBS at Define.** When the plan touches a service the pre-flight session recorded (`preFlightConfig` - see elicitation playbook §8.5), write the `dependsOnServices` binding on the FBS now, not later:

```
rcf build fbs <fbs-id> depends-on --service <id> --mode <attestationMode> --acs <acIds> [--preflight <pfc-id>]
```

This is not a build-time optimisation; it is the seam the whole verification-integrity surface hangs on. `coverage --strict` at Stage 4 refuses when a TC covers an AC whose FBS was named in a preflight `affectedFbsIds` list but has no matching entry here; verify's deployed-verdict gate reads the same binding to decide whether a live-attested AC needs a live probe or a `MOCK-ONLY-DECLARED` verdict is the honest answer. If the plan touches a service the pre-flight session did NOT record - a runtime dependency discovered mid-Build - `rcf build bundle --next` will warn and point at `rcf discover preflight` for a re-run; add the entry to the preflight record, then to the FBS.

Stage end: mark pickup and commit any plan artefacts the driving workflow requires.

```
$ rcf build mark FBS-012 inProgress
marked FBS-012 notStarted -> inProgress
```

(Captured in a scratch copy of this repo's tree; exit 0.)

Worked micro-example. The FBS-005 bundle ("CLI read verbs") scopes three ACs: AC-301-1 (reading a valid document returns it and reports it as valid), AC-301-2 (reading an id with no file returns a structured not-found error naming the id), AC-301-3 (reading an invalid document returns both the content and the validation errors). Restated as a three-line plan:

1. AC-301-1: wire `rcf define read <id>` to the store load; render content plus a validity line; test the valid path.
2. AC-301-2: return the structured not-found error with the id in it; test against a missing id.
3. AC-301-3: on schema failure, render content and errors together rather than either alone; test with a deliberately broken document.

Three ACs, three lines, nothing extra. That is the whole Define output for a small item.

## 3.5. Stage 1.5 - Design (UI-bearing only)

What good looks like:

- The FBS classifier fired at Define and printed a `[info] build: ui-classifier verdict=ui reason=keyword-scan (N signal(s))` line ahead of the bundle. That is the trigger to think about design, not to skip it: even for a `notUi` verdict, if the FBS visibly renders pixels the operator overrides via `rcf define update <fbs-id> --set uiBearing=true` (spec section 4.4). A false positive costs the operator one override; a false negative ships another dated UI.
- A `uiBaseline` record exists on the manifest. If it does not, run `rcf discover ui-baseline init` before opening any Design substage verb. The interactive session presents every ruled default on one summary screen; press ENTER to accept, type a field name to edit one, type `edit-all` to walk them sequentially, type `cancel` to leave without writing. Every opt-out lands with a plain-text reason of at least twenty characters. Silence is never an opt-out.
- Three artefacts land on the FBS's `designStage` block before the design is called complete: a `journeys[]` list (at least one walk-through of a real actor + goal + two to eight steps), a `navModel` (shape from `shared-persistent` | `shared-per-section` | `none-single-page` | `operator-declared-other`, at least one route with a path + label + authRequired boolean, and a `signedInAsAffordance` boolean), and a `themeAndA11y` block (theme mode from `light-default-with-toggle` | `dark-default-with-toggle` | `single-theme-declared`, the tokens-module path, the contrast-test path, and the `contrastTestAuthoredBeforePalette` boolean attestation).
- Author via the verbs, not by hand-editing: `rcf define design <fbs-id> journeys add --id <slug> --actor "..." --goal "..." --step "..." --step "..."`, `rcf define design <fbs-id> nav set --shape <shape> --route <path=label:authRequired> ...`, `rcf define design <fbs-id> theme-a11y set --mode <mode> --tokens <path> --contrast-test <path> --contrast-before-palette true|false`. When all three are in place, `rcf define design <fbs-id> --mark-complete` sets `designStageComplete: true` on the FBS record. Alternatively, dispatch the Design worker via `rcf define design <fbs-id>` (no sub-verb) and let the subagent author the three artefacts against the baseline plus a sibling-FBS `designStage` context, then mark complete.
- The playbook mandate 5 vocabulary (`Button`, `Input`, `Card`, `Badge`, `Table`, `Notice`, single badge shape) is guidance-only in v1. For string-templated projects (server-rendered HTML by concatenation, no framework) the operator can hand-check the six-component vocabulary with a `grep -oE 'class="[^"]+"'` sweep of view files; the audit does not enforce it mechanically in v1.

Warning at Stage 2 entry (`rcf build mark <fbs-id> inProgress`): if the FBS is uiBearing and no `designStage` has been authored, one `[warn]` line points at `rcf define design <fbs-id>`. Not a refusal - pickup and planning can happen before design when the operator wants to think about the AC scope first. The hard refusal fires at Stage 5.

Refusal at Stage 5 entry (`rcf build mark <fbs-id> complete`) on a uiBearing FBS when any of: `designStageComplete` is not true; `designStage.themeAndA11y.contrastTestAuthoredBeforePalette` is false; the baseline disagrees with a `designStage` paired field and no `operatorOptOuts[]` entry excuses it; the browser-verification verdict is `block` or `warn` without operator ack (see section 7).

Escalation: when the operator disagrees with the classifier, ratify or override via `rcf define update <fbs-id> --set uiBearing=true|false`. The override records `verdict: operatorOverride` on `uiClassification`, keeping the classifier's evidence in `signals[]` for provenance. When the operator disagrees with a baseline default, record it as an explicit opt-out via `rcf discover ui-baseline opt-out --field <path> --reason "..." ` (at least twenty characters).

Stage end: commit. The `designStage` and `designStageComplete` write are the artefacts of this stage.

Worked micro-example. FBS-016 ("Web UI dashboard") classifies as UI-bearing on `dashboard` and `page` signals in the summary. `rcf discover ui-baseline init` runs once for the project, accepting the ruled defaults on ENTER. Three journeys sketched: signed-in-owner checks status; new-monitor add flow; unauthenticated visitor lands on login. `navModel` records the four authenticated routes (dashboard, monitors, monitor-detail, settings) as `shared-persistent` with `signedInAsAffordance: true`. `themeAndA11y` records `light-default-with-toggle`, tokens at `src/ui/tokens.ts`, contrast test at `test/ui-accessibility.test.ts`, `contrastTestAuthoredBeforePalette: true`. `rcf define design FBS-016 --mark-complete` sets the boolean; Stage 2 opens.

## 4. Stage 2 - Build

What good looks like:

- Implement to the section-4 ACs using the section-5 context. The TACs name the components and boundaries you are expected to respect; the ADRs name decisions already taken, which you follow rather than relitigate.
- The bundle is the spec. When the code teaches you the spec is wrong, stop and escalate; do not quietly ship your improved version.
- As each AC lands, author or update its Code Node: `rcf define create cn --path <file>[#symbol] --acs <ac-ids>`. Do this now - the mapping from symbol to AC is exactly what you are holding in your head mid-implementation, and Stage 5 refuses completion without it (section 9).
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
$ rcf define validate
rcf define validate: tree is clean.
```

Exit 0 when clean; exit 3 with issue lines when not (section 9 shows the failure shape).

Failure modes:

- **Rubber-stamp review.** Symptom: review completes in the time it takes to scroll. Correction: the per-AC question above, answered per AC, in writing if the workflow keeps review notes.
- **Reviewing only what changed rather than what was promised.** Symptom: the review walks the diff top to bottom and never opens section 4. Correction: walk the AC list as the outer loop, the diff as the inner one. This is where AC-skipping is cheapest to catch.

**Second gate on Stage 3: `rcf build review <fbs-id>`.** After `rcf define validate` clears the tree, run the test-theatre audit. The audit asks the meta-question the diff review does not: are the tests themselves honest? Five finding categories run deterministically over the FBS's in-scope ACs and their covering TSes:

- `mockOnlyIntegrationClaim` - an integration-level TS whose every TC records `runtimeProvenance.profile` in `{mock, stub, fixture}` while at least one bound AC's aggregated attestation is `live` or `sandboxed`. This is the exact failure the whole 0.7.0 verification-integrity surface exists to catch (d-2026-07-30-142). Severity: block.
- `testPointerBroken` - a TC's `testPointer` fails to resolve to a real test in the working tree. Severity: block.
- `acIdsCoverageDrift` - a TS covers an AC the parent FBS does not claim in `acIds[]`. Severity: warn. (The reverse - an FBS claims an AC no TS covers - is caught by `coverage --strict` which already exits 4 on that.)
- `attestationDrift` (recorded as `otherDeclared` with a `kindDescription`) - `declaredMockOnly × live`. Severity: warn.
- Mutation-sampling survivors - the review agent generates 10 to 30 targeted semantic mutants of the FBS diff and records any the test suite failed to kill. Each surviving mutant traces back to the exact TS/TC that missed it. Severity: any survivor escalates the audit verdict to block.
- `uiBaselineDrift` (Track B, UI-bearing FBS only) - hex literals detected in view files (default glob `src/ui/**` minus the tokens module, configurable via `uiBaseline.defaults.viewFileGlobs`) or route files under the default `src/routes/**` glob that fail to import the baseline's shared layout module. Severity: block by default, demoted to advisory when `uiBaseline.operatorOptOuts[]` names the field. The audit runs alongside the test-theatre categories on the same `reviewAudit` record: one brief, one worker, one record per FBS.

The verb writes a `reviewAudit` record on the manifest and exits 4 on any warn or block, refusing entry to Stage 4 until the operator resolves or acknowledges each finding. `--dry-run` runs the audit without writing. `--skip-mutation` records that mutation-sampling was skipped without invoking a runner; the record still validates. In production, the mutation runner is a subagent dispatch orchestrated by the harness per estate ladder (Opus 4.7).

Stage end: commit.

## 6. Stage 4 - Test

What good looks like:

- Every in-scope AC gets a TS / TC pair on the tree and an executable test behind it, named by the TC's `testPointer` (`filePath::testName`). Section 6 of the bundle lists what already exists and what is flagged as missing.
- The test asserts the AC's observable outcome (its given / when / then), not the implementation's internals.
- A TC's `status` reflects a run that actually happened.

Referee:

```
$ rcf audit coverage --strict
Coverage mode: strict (per-AC)
Requirements: 8  covered: 8  covered-unresolved: 0  uncovered: 0

Requirement  Covered  AC        AC covered  Test cases
-----------  -------  --------  ----------  ------------------------------------------------------------
REQ-001      yes      AC-101-1  yes         TC-001-init-clean-tree-roots
```

(Captured against this repo's tree, first rows shown; exit 0. This tree binds all 76 of its ACs to named existing tests via resolving `testPointer`s. It did not start there: the audit that built this test axis opened with 14 honestly-registered gaps in `rcf/test-suites/PENDING.md`, the referee exited 4 for as long as any row remained, and the register emptied only when every AC got a test that genuinely asserts its outcome - including one whole feature the tree claimed and the code lacked. CI now runs `rcf define validate` and `rcf audit coverage --strict` as required steps, so this exit 0 is locked in: a stub TC or a new uncovered AC fails the build.) Strict mode is per-AC: every AC in scope needs a TC whose pointer resolves, and any gap exits 4. The `covered-unresolved` column is the third state: TC rows exist but at least one pointer does not resolve to a real test - a stub or a stale pointer - and it fails the gate exactly as uncovered does, with the offending pointers listed under the table. Read the table by AC id: this stage ends when your in-scope ACs show `AC covered: yes` with test cases listed. Gaps elsewhere in the tree may legitimately remain and will keep the tree-wide command at exit 4; narrow the verdict with a scope id (`rcf audit coverage <scope-id> --strict`, PRD / REQ / US ids accepted) to read the subtree you are working in.

Failure modes:

- **Marking without verifying.** Symptom: a TC set to `passing` without a run. Correction: referee output is the precondition for every mark; run the suite, then record what it said.
- **Testing the implementation instead of the AC.** Symptom: the test breaks when internals are refactored but would pass if the behaviour were wrong. Correction: write the assertion from the AC's `then` clause, not from the code.

**Runtime provenance is authored, not remembered.** Every TC authored or updated in a build cycle carries `runtimeProvenance` on the same edit as `status`. The pattern:

```
rcf build test-suite <ts-id> provenance --tc <tc-id> --profile <mock|stub|fixture|live|mixed> \
    [--env-var VAR ...] [--host host ...] [--notes "..."]
```

`coverage --strict` refuses (exit 4) when a TC covers an AC that binds a `dependsOnServices` entry and lacks a provenance block, and enforces the section 3.5 attestation × profile matrix on every remaining TC. Belt and braces: the PR body still names the runtime it verified against (section 15), but the chain is now the source of truth and the PR is a rendering.

**TS approval is a Stage 4 outcome, not an authoring guess.** Once `coverage --strict` exits 0 and the underlying test run exits 0, promote each touched TS with `rcf build test-suite <ts-id> approve`. Stage 4 does this automatically at end-of-stage; the operator only needs the verb for manual override (a rare re-approval after `needsRevision` cycles, via `--force`). CI can add the opt-in `rcf audit coverage --strict --require-approved` gate to fail the build on any TS still `draft` after Stage 4.

Stage end: commit.

## 7. Stage 5 - Finalise

What good looks like:

- CI green on the branch; PR raised and merged per the driving workflow's convention. The PR body is written for the reviewer, evidence first - author it per section 12, not as a diff walk.
- `rcf build mark <fbs-id> complete` after the merge, never before it. This refuses (exit 3, `missingCodeNodes`) if any in-scope AC still carries no Code Node - a reliability chain with optional links is not a chain. Author the missing CNs and retry, or, for a genuinely no-code spec (docs-only, config-only), declare `rcf build mark <fbs-id> complete --no-code-nodes` once.
- `rcf build finalise <fbs-id> --url <deploy-url>` writes `verified` after post-merge verification: the merged artefact observed doing the right thing by an independent verify run, not just the pre-merge tests remembered fondly. `--mark` cannot write `verified` - it caps at `complete`; the finalise gate promotes `complete -> verified` only when the verify run passes with ship authority.
- A working, documented local preview is present as the default outcome (section 14), and every verification claim in the PR names the runtime it was checked against (section 15). These are part of done, not extras.

Referee: CI, the finalise gate, plus the mark commands' own refusals (section 9).

Failure modes:

- **AC-skipping at the finish line.** Symptom: a section-4 AC has no corresponding diff or test, discovered at PR time or never. Correction: a per-AC checklist pass before this stage ends; every AC id gets a tick against a diff location and a test.
- **Marking complete pre-merge.** Symptom: `--mark complete` while the PR is still open. Correction: the merge is the event; the mark records it, it does not predict it.
- **Reaching for `--no-code-nodes` out of impatience.** Symptom: the flag on a spec that plainly produced code. Correction: it declares a fact (no traceable code exists), not an escape from the CN-authoring step you skipped in Stage 2 - go back and author the CN instead.

**The finalise gate reads the attestation, not just the exit code.** A passing verify run whose report carries per-AC verdicts in `{MOCK-ONLY-DECLARED, BLOCKED-BY-DECLARATION}` will not promote to `verified`. The gate stays at `complete -> verified` promotion, but a mock-only-declared AC refuses the promotion unless the operator explicitly ships the FBS complete-without-verified via `--ship-without-verified`. The summary always discloses these verdicts (whether the FBS ships or not) so the honest picture reaches the reviewer. Older verify reports without the `perAcVerdicts` field are handled gracefully - verify's train car may land later; older reports flow through with the pre-0.7.0 gate behaviour.

**Browser-verification gate (Track B, UI-bearing FBS only).** Before `--mark complete` on a uiBearing FBS, run `rcf verify browser <fbs-id>` against the local preview or a deployed URL. The verb writes a `browserVerification[]` record on the manifest and aggregates a verdict (pass / warn / block). `--mark complete` refuses when the verdict is `block` (unless the operator uses `--accept-block --reason "..."` per the ship-without-verified escape hatch) or `warn` (unless `operatorAckAt` is populated via `rcf verify browser <fbs-id> --ack`). The `agentScreenshotCritique` mode drives an injectable browser driver over every enumerated route x theme, records the DOM against the versioned `UI_INVARIANTS_V1` set (shared-nav presence, active-nav marker, signed-in-as affordance, theme toggle, default theme, focus rings, structural layout compare), and (when the FBS binds an auth REQ) runs the auth-REQ smoke pack (`GET /login`, `POST /logout`, `GET /login/verify?token=`). The `operatorSession` mode records the operator's ack alone; the ack is the evidence. Screenshots and DOM dumps land under `.rcf/artefacts/<bv-id>/`, gitignored via the 0.6.0 managed block.

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
Stopping on <the item's plain-language title> (<fbs-id>) at <stage>.
Found: <the ambiguity / contradiction / surprise, in one or two sentences>.
Options as I see them: <a> / <b>.
Waiting for direction.
```

Render it in the operator's language (section 17): the item named by its title, the problem in plain words, the options short enough to choose between. The report is a decision put in front of someone, not a log entry.

## 9. Referee reference

The commands and their output, read at a glance. Exit codes: 0 success, 1 unexpected runtime failure, 2 usage error, 3 validation or broken references, 4 refused.

**`rcf define validate`** - exit 0 and `rcf define validate: tree is clean.` when clean. On issues, exit 3 with one line per issue naming the document and the rule, then a summary count. Captured in a scratch copy with a required field removed by hand:

```
[error] validation REQ-001: / must have required property 'title'
[error] brokenReference US-101: US US-101 references unknown REQ REQ-001
[error] brokenReference US-102: US US-102 references unknown REQ REQ-001
[error] 3 errors found; output written with broken-section markers. Pass --strict to refuse the render.
```

Note the fan-out: one broken document produced two broken references. Fix the named document first, then re-validate.

**`rcf audit coverage --strict`** - exit 0 when every AC in scope has a TC whose `testPointer` resolves to a real test; exit 4 on any gap, with the per-AC table shown in section 6 above. A TC whose pointer does not resolve counts as `covered-unresolved` - a gap, not coverage - and is listed under the table with the reason (file missing, test missing). The `Test cases` column is the evidence trail.

**`rcf build bundle <fbs-id> --strict`** - exit 4 instead of a bundle when the item is blocked. Captured in a scratch copy with a dependency reset to `notStarted`:

```
[error] refused build: FBS-012 is blocked by FBS-010 (notStarted)
```

Without `--strict` the bundle renders anyway, flagged as a read-ahead; `--next` never selects blocked items.

**`rcf build mark <fbs-id> <status>`** - exit 0 with a one-line confirmation (`marked FBS-012 notStarted -> inProgress`). The lifecycle is forward-only (`notStarted -> inProgress -> complete -> verified`; forward jumps legal), but `--mark` caps at `complete`: `--mark verified` is refused with exit 4 and points to `rcf build finalise` (only the finalise gate writes `verified`). A backward mark is likewise refused with exit 4 and names the escape hatch:

```
[error] refused build: refusing backward transition complete -> inProgress on FBS-005; for a deliberate correction use: rcf define update FBS-005 --set executionStatus=inProgress
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

| order | tier | id | title | status | state | blocked by |
|---|---|---|---|---|---|---|
| 1 | 0 | FBS-001 | Document store core | complete | complete |  |
| 2 | 1 | FBS-002 | Tree walk and validate command | complete | complete |  |
| 3 | 2 | FBS-003 | Diagram rendering | complete | complete |  |
| 4 | 2 | FBS-004 | HTML page rendering | complete | complete |  |
| 5 | 2 | FBS-005 | CLI read verbs | complete | complete |  |
| 6 | 3 | FBS-006 | CLI create and update verbs | complete | complete |  |
| 7 | 4 | FBS-007 | CLI delete with reference safety | complete | complete |  |
| 8 | 2 | FBS-008 | Coverage and trace queries | complete | complete |  |
| 9 | 3 | FBS-009 | Impact analysis | complete | complete |  |
| 10 | 3 | FBS-010 | Build adapter prompt assembly | complete | complete |  |
| 11 | 4 | FBS-011 | Mark-done on completion | complete | complete |  |
| 12 | 4 | FBS-012 | MCP server over the full surface | complete | complete |  |
| 13 | 0 | FBS-013 | Deploy-aware elicitation and hosting guidance | notStarted | actionable |  |
| 14 | 0 | FBS-014 | Local-preview default, runtime-honest verification, interim self-review | notStarted | actionable |  |

Totals: items 14 | notStarted 2 | inProgress 0 | complete 12 | verified 0 | actionable 2 | blocked 0

Parallel-safe tiers (items in the same tier have no dependency between them and can build in parallel):
- tier 0: FBS-001, FBS-013, FBS-014
- tier 1: FBS-002
- tier 2: FBS-003, FBS-004, FBS-005, FBS-008
- tier 3: FBS-006, FBS-009, FBS-010
- tier 4: FBS-007, FBS-011, FBS-012

Next actionable: FBS-013
```

Two actionable items, and the tier column says how they relate: FBS-013 and FBS-014 share tier 0, meaning no dependency path connects them - they are parallel-safe, so a harness with two write workers on separate clones could take one each. `rcf build bundle --next` picks the lowest buildOrder and emits its bundle. The header orients you in one glance - what, where in the queue, how big, what it hangs off:

```
# Spec bundle: FBS-013 - Deploy-aware elicitation and hosting guidance

## 1. Header

- Item: FBS-013 - Deploy-aware elicitation and hosting guidance
- Queue: order 13, item 13 of 14
- Execution status: notStarted
- Estimated size: medium
- Estimated hours: 7
- Risk level: medium
- Domain: guidance
- Parent chain: BS-001 -> PRD-001 (RCF Build Lite)
```

Mark pickup, and the cycle is running:

```
$ rcf build mark FBS-013 inProgress
marked FBS-013 notStarted -> inProgress
```

From here it is the five stages, a commit per stage, `--mark complete` after the merge, `rcf build finalise` to promote to `verified` after post-merge verification, and back to `rcf build bundle --next`.

## 11. Driving the whole queue

Sections 3 to 7 deliver one item. This section is the loop around them: how a single session takes a project from a full queue to an empty one, and how a session that genuinely cannot writes a clean handover instead of stopping halfway. "The agent could not build all the items in one session" is, almost always, a context-management failure, not a real limit - the runbook below is how you avoid it.

**The gate before the loop.** When you arrive here straight out of elicitation, the tree is fresh and no human has looked at it. Before you build anything, offer the operator a review, in plain words rather than document names: "The plan is drafted and everything checks out. Want to look it over before I start building, or shall I go?" Wait for the answer. Rolling from elicitation into the build without the offer is the failure comment behind this gate - a tree the operator never saw becomes a build they cannot course-correct.

**The loop.**

```
rcf build queue      -> queue state; a "Next actionable" id means there is work
rcf build bundle --next     -> bundle for that item
                        run its five stages (sections 3-7), commit per stage
rcf build mark <fbs-id> complete       (after merge)
rcf build finalise <fbs-id> --url <deploy-url>  (independent verify -> verified)
                        then rcf build bundle --next again
```

You are done when `rcf build bundle --next` stops handing back bundles and prints instead:

```
# Build queue: nothing actionable

Queue complete: every item is complete or verified.
```

That line - not "I built the first one" - is the end of the loop. If it instead reports `Queue not complete but nothing is actionable`, the queue is stuck on a blocker or an in-progress item; that is section 8's territory, report it.

**Keep the driving context thin (why one session is enough).** The reason a sixteen-item queue "won't fit in one session" is that the agent kept every item's bundle, diff and test detail in a single growing thread. It does not have to. If your harness can spawn sub-agents, run each FBS in its own worker:

- The driver (you) holds only the queue, the trace and the running tally of what is done. You call `rcf build bundle --next`, hand the bundle id to a worker, and wait for a short structured result.
- The worker holds one item's full working set - the bundle, the diff, the tests, the referee outputs - runs the five stages, opens its PR, and returns a few lines: item id, ACs satisfied, referee outputs, PR link, and any escalation. Then its context is discarded.
- The driver's context stays flat across all sixteen items because it never holds more than a summary of any one. That is the mechanism that makes a small app's whole queue a single-session job.

Brief each worker with the same four things the bundle names: the item id, the five-stage cycle, the exact mark commands, and the escalation rule. **One write worker at a time** - builds share the working tree, so two workers marking and committing at once collide. Read-only workers (a trace lookup, an impact check) can run in parallel; writers are strictly sequential. `--next` already hands items out in dependency order, so sequential is also correct order.

**When to hand over instead of pushing on.** For a large stack, judge context cleanliness honestly rather than optimistically. The signs it is time to hand over: referee outputs contradict your memory of the tree, you are re-reading a bundle to reload state you should still be holding, or you have lost confidence about which items are truly done. Do not drag a degraded session to the finish - a wrong `--mark complete` costs more than a handover.

**The handover protocol.** A handover is state capture, not a memory dump. A fresh session must be able to resume from it without re-eliciting anything or re-deriving the queue.

1. Run `rcf build` and `rcf define validate` first, so the handover records the tree's true state, not your remembered state.
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
2. **Verification actually performed.** Not "tests pass". State what you ran and what it reported: the test command and its result, `rcf audit coverage --with-code` (or a story-scoped `rcf audit coverage <us-id> --strict`) with the per-AC lines, `rcf define validate` clean. Paste the outputs - they are the evidence, and pasted referee output is not something a reviewer has to take on trust. **Every claim in this section names the runtime it was checked against** (section 15): "verified against the local preview", "e2e against wrangler dev (localhost)", "smoke-tested against the deployed runtime". A verification line with no named runtime is incomplete, and a line that implies the deployed runtime when the check never touched it is a defect, not a wording nicety.
3. **Per-AC evidence trail.** For each in-scope AC: where it is satisfied (file and symbol) and the test that proves it. This is what `rcf audit coverage --with-code` and `rcf audit trace` already give you; lift it in rather than reprose it.
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
- <test command>: <result, e.g. 807 passing> (full suite) - runtime: <e.g. Node 24 on CI (local-dev), NOT the deployed runtime>
- rcf audit coverage --with-code: in-scope ACs covered, per-AC lines below
- rcf define validate: tree is clean
- local preview: <how it was started and what was driven, e.g. `npm run dev`, seeded data, exercised path X>
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

**Never-skip-RCF.** The bug-fix loop uses the same five-stage cycle as the initial build (Define, Build, Review, Test, Finalise); there is no fast-path, and there is no operator ruling that opens one. Do not offer a shortcut. Do not phrase the choice as "would you rather I skip the RCF wrapping" or any wording that presents bypassing the chain as a legitimate option. The offer itself is the defect. The operator's refusal is not a sign the invariant held; it is a sign the invariant was tested and the guidance surface leaked. Fix the guidance surface.

A bug that reached a build is a bug a test did not catch, which is a behaviour an AC did not require. The bug is the symptom; the missing or weak AC is the cause. Fix the cause first - not out of process piety, but because a code-only fix leaves the chain blind to the next instance of the same bug, and the next build can reintroduce it under a clean coverage report.

**The order - do not jump to the code:**

1. **Reproduce, then trace the bug to its governing AC.** Which AC should have made the correct behaviour required? Walk the tree with `rcf audit trace` from the story or the offending source path, and `rcf audit coverage --with-code` to see whether the behaviour was ever covered at all.
2. **Name the gap.** Either no AC covers this scenario - the common case, usually a missing edge or failure path - or an AC covers it but too weakly (a happy-path AC where the bug lives in the failure path). Both are elicitation-depth misses; the standard for an adequate AC set is section 5 of the elicitation playbook.
3. **Fix the spec.** Add or strengthen the AC so the scenario is required (`rcf define create ac` / `rcf define update`), then add its TS/TC so the chain checks it. Now the tree would catch this class of bug on the next run.
4. **Fix the code against the corrected spec,** and prove it with the new test - the one that would have failed before your change and passes after it.

**Escalation:** if strengthening the AC changes agreed behaviour rather than closing an obvious gap, that is a spec decision, not a silent redraw. Surface it (section 8) before you change it. Tightening "returns an empty list on no match" onto an existing search AC is closing a gap; changing what the feature is supposed to do is a decision for the operator.

## 14. Local preview is part of done

The target user is a non-coding owner who cannot self-verify a deployed app. The one runtime such an owner can always drive is the app running locally, so **a working, documented local preview is the default outcome of every build** - not a nicety, and not conditional on a deploy.

- **It is part of the definition of done.** A build is not finished until it leaves a local preview the owner can start and drive: a dev server, and seeded or sample data where the app needs data to be exercisable at all (an empty shell is not a usable preview). Treat "the owner has something they can run and look at" as a completion criterion alongside green CI.
- **One documented command where the stack allows.** Drive the build toward a single documented command to start the preview - `npm run dev`, `make dev`, one `docker compose up`, whatever the stack makes possible - and document it. Where a stack genuinely cannot reduce to one command, document the shortest real sequence; the bar is "documented and startable by a non-expert", and one command is the target.
- **Produced whether or not a host was named.** The local preview is the hosting-independent default. Produce it even when the owner has not stated a deploy target, or asked for a recommendation instead of naming one, or declined to deploy at all. It is never made conditional on a stated host - remote deployment is an addition on top of the local preview, never a replacement for it.
- **Seeded so it can actually be driven.** If the app needs data to be usable, the preview ships with seeded or sample data so the owner can exercise it immediately, not stare at an empty screen and conclude nothing was built.

The local preview is also the honest substrate for runtime-provenance (section 15): a claim verified against the local preview can say exactly that, truthfully, because the owner can re-run it.

## 15. Runtime-provenance: name what you verified against

A green suite plus a confident "verified" claim shipped a production auth 500 while every test passed - because the tests ran on a local emulator that did not enforce a limit the deployed runtime does. The failure was not laziness, it was provenance: a claim implied a runtime it had never touched. A non-coding owner cannot tell "verified against the deployed runtime" from "verified against a local emulator", so **the claim itself carries the distinction.**

- **Every "verified"/"tested" claim names the runtime it was checked against.** In the Test and Finalise stages and in the PR body's verification section, a verification claim without a named runtime is treated as incomplete - the same way an uncovered AC is treated as incomplete.
- **No claim may state or imply deploy-runtime verification that did not happen.** If the check ran on a local or emulated runtime, the claim says so and stops there. "Works" with no runtime, or a phrasing that lets the reader assume the deployed target, is a defect - and a deliberately less-reassuring honest claim is the point: the unlabelled claim was falsely reassuring.
- **Use the runtime-profile vocabulary, do not invent a new one.** Name the runtime with the same profiles the verification model uses: **`deployed`** (the real deployed target), **`ci`** (the CI runner), and **`local-dev`** (a local server or emulator on your machine). A **ship verdict comes only from `deployed`, or from a `local-dev`/`ci` result plus an explicitly declared parity claim** that the lower profile matches the deployed one on the property in question. A bare lower-profile pass is evidence about that profile and nothing more.

Worked examples - the same discipline, two different stacks, so it reads deploy-anywhere and not tool-specific:

```
Cloudflare Worker:
  "e2e passed - verified against wrangler dev (localhost, local-dev profile)
   - NOT the deployed Worker runtime. wrangler dev does not enforce the edge
   PBKDF2 iteration cap, so this is NOT a ship verdict for auth."

Node app on Vercel:
  "signup flow verified against `vite preview` on localhost (local-dev profile)
   - NOT the deployed Vercel Function runtime. Cold-start and env-var behaviour
   on the deployed profile are unverified; ship verdict pending a deployed check
   or a declared parity claim."
```

Both name the runtime, both refuse to imply the deployed profile, and both say plainly what is still unproven.

**The PR is a rendering of what the chain already knows.** Since 0.7.0, every TC on the chain carries `runtimeProvenance` - the profile it ran under, any env vars it needs, any external hosts it reached. The PR body's runtime-provenance sentences continue to name the runtime for the reviewer, but the chain is the source of truth. A reviewer or auditor can walk the tree and see what every test actually verified, per-TC, without opening the diff.

## 16. In-loop fresh-context self-review

Self-verification is only as truthful as the runtime it verifies against, and a green suite plus a confident claim can still ship a user-facing defect. The independent verification gate is the durable answer to that, and it ships: `rcf build finalise` runs the independent verifier against the deployed app and is the only thing that promotes an FBS from `complete` to `verified` (section 7). Nothing in this section changes that.

What this section adds is the cheap check that runs **in the loop, between builds** - long before you reach the gate. Its value is finding the defect at FBS 6 instead of at the ship gate. It is subordinate to the gate, never a substitute for it, and it never writes `verified`.

- **What it is: a fresh-context reviewer dispatch, periodic and at the end.** Run a manual-review subagent in a fresh context **every few FBS builds** and **once more at the end of the build**. Fresh context matters: a reviewer carrying the build's own assumptions re-confirms them; a reviewer starting cold does not.
- **It drives the app, it does not read the code.** The reviewer starts the running application (the local preview is right there) and **drives it against the acceptance criteria** - exercises the real behaviour a user would - rather than reading the diff. Reading code re-checks intent; driving the app checks what was actually built.
- **It targets the defect classes green suites miss.** Name them for the reviewer: **session-class bugs** (state that leaks or resets across requests/sessions), **false-promise UI** (buttons and screens that imply an action the code never performs), **runtime mismatch** (passes on localhost, fails on the deployed runtime), **dead auth paths** (login/signup flows that never actually work end to end), and **dead code** (paths shipped but never reachable). These are exactly the classes a passing unit suite reports nothing about.
- **It is honestly scoped, and it is not the gate.** State plainly, every time: this is **an in-loop check, not the independent verification gate** - the gate is `rcf build finalise` (section 7) - and it is **guidance and prompt-level, not a new subsystem**. A same-agent, same-programme reviewer is better than nothing and weaker than an independent check: worth running before the gate, not worth overclaiming after it. Say both. A self-review pass is never evidence for a `verified` mark; only the finalise gate produces that.
- **For UI-bearing FBSes, cross-reference to `rcf verify browser`.** The in-loop reviewer's "drive the app against ACs" behaviour is a superset of what `rcf verify browser <fbs-id>` does (open every enumerated route on every declared theme, record the DOM, run the versioned invariant set, run the auth smoke pack). Reach for `rcf verify browser` first for uiBearing FBS: it writes a persisted `browserVerification[]` record on the manifest that the Stage 5 gate reads, and it names the exact invariants a passing browser check must satisfy. The self-review pass then adds the qualitative rubric on top (component consistency, typography, interaction affordances, modern-versus-dated feel) - the same rubric the browser-verify agent-mode critique carries on its record's `notes` field.
- **Keep the review surface up across the pass.** `rcf audit view` gains `start | status | stop | logs` verbs and defaults to `--detach` on an interactive session (the pre-0.7.0 foreground default survives non-interactive callers, so CI scripts do not change behaviour). Start it once at the top of the loop; the supervisor persists across session death and the manifest carries `reviewSurface.viewServer` so a subsequent session can pick up where the last one left off. Explicit `rcf audit view stop` when the loop closes.

## 17. Speaking to the operator

The queue, the bundles, the referee outputs and this playbook are your working vocabulary, not the operator's. Chat holds a different register from PR bodies and commit messages, and the operator may be non-technical; what they read should tell them the build is in hand and what, if anything, is needed from them.

- **Status is one to three sentences.** What finished, what is next, anything you need. The evidence-first depth of section 12 belongs in the PR body, where a reviewer wants it; pasting referee output into chat is noise. If the operator wants the detail, the PR is one link away.
- **Plain names, not ids.** "The search feature is built and merged" beats reciting the item's id and lifecycle state. Use the item's title; add the id when the operator needs to find a specific file, or when the operator talks in ids first.
- **Never cite rules or playbook sections.** They shape what you do; the operator sees the behaviour, not the citation.
- **Escalations lead with the decision.** Section 8's report shape is the content; deliver it in plain language, options short enough to choose between, one decision per message.
- **Check before you ask, and remember what you were granted.** Git state, remotes, CI status: run the command rather than asking. Permissions already given (branching, pushing, raising PRs): act on them; re-asking reads as not listening.
- **Confidence, honestly.** The operator steers; you drive the queue. Say what you are doing, not what the method requires of you, and say plainly when something is genuinely blocked - which is exactly when the operator must hear from you.
