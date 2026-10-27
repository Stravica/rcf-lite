# The RCF 5-stage build cycle

The normative statement of the cycle. Every FBS item is delivered in rounds of five stages, in this order, under these contracts. The spec bundle that `rcf build bundle <fbs-id> --base-suite <file>` emits carries the same cycle as its closing runbook, parameterised for the item in hand; if this page and a bundle ever disagree, the bundle is authoritative.

## The five stages

Each stage is done by its own role and ends in a commit whose subject opens with the stage prefix: `DEFINE:`, `BUILD:`, `REVIEW:`, `TEST:` or `FINALISE:`. The `Hand:` trailer is optional through the 0.37.x transition, and where a commit carries one it agrees with the prefix. No Build starts until the RCF suite is green on the base: every bundle needs `--base-suite <file>`, a record `rcf build base-suite --out <file>` writes at a clean committed base.

### DEFINE (commit prefix DEFINE:, role test-author)

Role: test-author. Entry: you hold the item's spec bundle. Exit: the test-author has written the AC-based and E2E tests and their TS / TC bindings for every in-scope acceptance criterion in the bundle's section 4, each new test is proven red for the right reason, `rcf audit coverage --strict` covers them, and pickup is recorded with `rcf build mark <fbs-id> inProgress`. The test-author never writes production code. Referee: the bundle itself, plus `rcf define validate` and `rcf audit coverage --strict` on a clean tree - the strict gate checks the pointer, not just the row: a test case counts only when its `testPointer` resolves to a real test in the tree, and one that does not is reported as `covered-unresolved`.

### BUILD (BUILD:, builder)

Role: builder. Entry: the red tests from DEFINE. Exit: the red tests pass, the acceptance criteria are implemented using the bundle's architectural context, with nothing beyond them; deviation from the bundle is escalation, not improvisation. The builder writes production code, Code Nodes and code-hygiene unit tests only: never an AC-based or E2E test, a TS / TC record or criterion text. Author or update Code Nodes (`rcf define create cn --path <file>[#symbol] --acs <ac-ids>`) for the source as you write it - comprehension of which symbols serve which ACs is cheapest to capture now, and FINALISE refuses completion without it. Referee: the red tests, with the bundle as the spec.

### REVIEW (REVIEW:, reviewer)

Role: reviewer. Entry: the implementation is complete at a committed head H. Exit: `rcf define validate` comes back clean, `rcf audit separation` passes over the pull request's range (it judges each commit's stage prefix against the paths it touches, and the pull_request CI job runs the same check on a full-depth checkout), `rcf audit test-strength --record` has recorded the structural and mutation proof for the touched criteria, and the reviewer has re-read the diff against every in-scope acceptance criterion and recorded MERGE or FINDINGS for the code and PASS or FINDINGS for test adequacy with `rcf build verdict review --fbs <fbs-id> --acs <AC ids> --code MERGE|FINDINGS --adequacy PASS|FINDINGS`. Referee: `rcf define validate`, `rcf audit separation` and the recorded verdict.

### TEST (TEST:, verifier)

Role: verifier. Entry: a reviewed head H with a REVIEW MERGE. Exit: the verifier has run the full RCF suite against a locally running app serving H, nothing is deployed, and recorded the result from the suite's TAP with `rcf build verdict test --fbs <fbs-id> --result PASS|FAIL --tap <file> --runtime "<text>"`. The pull request merges only on a REVIEW MERGE and a TEST PASS at the same head. Every "tested" claim made in this stage names the runtime it was checked against and never implies a run on a deployed runtime that was not exercised. Referee: the recorded TEST verdict.

### FINALISE (FINALISE:, stage-keeper)

Role: stage-keeper. Entry: a REVIEW MERGE and a TEST PASS at the same head, with CI green on the PR head. Exit: on the PR branch before the merge, `rcf build finalise <fbs-id> --ci-run <ref>` checks the last round's recorded verdicts (the REVIEW MERGE and test-adequacy PASS, the TEST PASS, the test-strength record, Code Nodes for every touched criterion and the separation audit over the range) and writes complete; the write is committed on the branch and the work merges carrying it. Finalise spawns nothing but git and never writes verified. `rcf build mark <fbs-id> complete` is refused (exit 4): complete is written only by `rcf build finalise`. Referee: CI, the finalise checks and their refusals.

## Rounds

A round is one pass of the five stages over the touched criteria. A failed REVIEW (FINDINGS) or a failed TEST closes the round. The next round starts at DEFINE. Stage order is monotonic within a round: no `DEFINE:` commit follows a `BUILD:` commit of the same round, and so on down the five stages. Finalise judges the last round only.

## VERIFY (outside the build cycle)

A release Verify runs outside the build cycle, after the round and before the promote: `rcf verify run --release <label> --since <ref> --record` runs the bound E2E tests of the specs changed since the last release, plus the release smoke suites, against the release candidate, and writes verified on each spec whose live external criteria all passed. The `verified` status is written only by a release Verify, and no Build waits for it.

## Definition of done includes a working local preview

A build is not done until it also leaves a **working, documented local preview** as its default outcome - a dev server, seeded data where the app needs data to be usable, ideally started with one documented command. This is required whether or not the owner stated a hosting target: the local preview is the runtime the owner can always drive, and remote deployment is an addition on top of it, never a replacement for it.

## Every stage commits

Each stage ends in a commit. The commit is the stage boundary: it makes the cycle auditable in history and keeps a failed stage cheap to unwind. A stage without its commit is not finished.

## The lifecycle is forward-only

`notStarted -> inProgress -> complete -> verified`. The `rcf build mark` ladder caps at `inProgress`: `complete` is written only by `rcf build finalise` and `verified` only by a release Verify, so marking either is refused with exit 4. Backward transitions are refused with exit 4; the deliberate-correction / manual-override escape hatch is `rcf define update <fbs-id> --set executionStatus=<status>`, and reaching for it should be rare enough to be remarkable.

## Depth

This page is the contract. For per-stage guidance, failure modes, escalation rules and worked examples, fetch the `rcf_execute_build_cycle` prompt or read `build-cycle-playbook.md` in this directory.

---

Canonical reference: https://stravica.ai/rcf-methodology/build-cycle
