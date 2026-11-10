# The RCF 5-stage build cycle

The normative statement of the cycle. Every FBS item is delivered in rounds of five stages, in this order, under these contracts. The spec bundle that `rcf build bundle <fbs-id> --base-suite <file>` emits carries the same cycle as its closing runbook, parameterised for the item in hand; if this page and a bundle ever disagree, the bundle is authoritative.

## The twelve rules

The cycle's contract is twelve rules. The stage sections below apply them.

1. **The chain.** Every requirement traces to criteria, every criterion to one bound test, and every test to recorded evidence. The referee is the tool: `rcf define validate` and `rcf audit coverage --strict` both exit 0 at every stage exit, or the stage has not exited.
2. **Criteria only for promises.** A criterion is written only for a promise to a buyer: money, access, privacy, integrity, a product claim or a core journey. Everything else the product needs is the builder's hygiene tests, and a hygiene test is never bound to a criterion.
3. **Proof level.** Each touched criterion's proof level is chosen at DEFINE and recorded with the round: full (its test-strength report is one the reviewer reads), journey (its bound test is one end-to-end test) or external (`verification: external`, proven again by the release Verify). At every level a touched criterion still has a bound test and a Code Node. The tool reports test strength and refuses on none of its results.
4. **Five stages.** DEFINE, BUILD, REVIEW, TEST, FINALISE, in that order, one hand and one commit prefix each. Every job runs all five; there is no shortcut around the stages.
5. **Separation.** The hand that writes production code never writes or edits a criterion-bound test, a binding or criterion text. The audit enforces this by path on every commit, and the merge check runs the audit. This rule is never lightened.
6. **DEFINE exit.** From the named base-suite record, only the newly added or changed test cases fail at the DEFINE head, and each fails at its recorded assertion; an unrecorded baseline failure makes DEFINE BLOCKED. There is no throwaway implementation: the test-author proves red, and green is the builder's to prove.
7. **BUILD exit.** The reds are green and nothing beyond the criteria is built. A test that cannot pass without being changed is a stop for the owner, never an edit.
8. **REVIEW.** One reviewer judges the diff against the criteria the change claims, on three classes only: buyer harm, a vacuous test, and a test or criterion the builder edited. Everything else is a note. One re-gate; a second FINDINGS goes to the owner.
9. **TEST.** The bound suites, less the external-level tests, run against a running instance of the reviewed head. PASS, FAIL or BLOCKED is recorded at that head; BLOCKED changes neither the head nor the round budget and is escalated as a missing prerequisite.
10. **FINALISE.** FINALISE writes complete from the recorded verdicts, before the merge, so the merge carries it. verified is written by the release Verify, outside the round, and no build waits for it. A FINALISE failure is escalated with its exit code and output, never skipped.
11. **Round budget.** A round is two DEFINE passes and a date, both set when it opens. After the first BUILD a note is a candidate for a later round, never a reopening of DEFINE. Only the three classes in rule 8 can prevent a merge, and at TEST only the failure of an in-scope bound criterion blocks. Over budget, the owner gets a plain choice.
12. **Spec readiness.** One cold question count before BUILD and, for a change to what the tool refuses, one whole-plan adversarial pass at DEFINE, each sorted into gaps, preferences and noise. Gaps are fixed in the document once; preferences are recorded as defaults with a reason; noise is dropped.

## The five stages

Each stage is done by its own role and ends in a commit whose subject opens with the stage prefix: `DEFINE:`, `BUILD:`, `REVIEW:`, `TEST:` or `FINALISE:`. No Build starts until the RCF suite is green on the base: every bundle needs `--base-suite <file>`, a record `rcf build base-suite --out <file>` writes at a clean committed base.

### DEFINE (commit prefix DEFINE:, role test-author)

Role: test-author. Entry: you hold the item's spec bundle. Exit: the test-author has written the AC-based and E2E tests and their TS / TC bindings for every in-scope acceptance criterion in the bundle's section 4, `rcf audit coverage --strict` covers them, and pickup is recorded with `rcf build mark <fbs-id> inProgress`. From the named base-suite record, only the newly added or changed test cases fail at the DEFINE head, and each fails at its recorded assertion; an unrecorded baseline failure makes DEFINE BLOCKED. There is no throwaway implementation: the test-author proves red, and green is the builder's to prove. The test-author never writes production code. Referee: the bundle itself, plus `rcf define validate` and `rcf audit coverage --strict` on a clean tree - the strict gate checks the pointer, not just the row: a test case counts only when its `testPointer` resolves to a real test in the tree, and one that does not is reported as `covered-unresolved`.

### BUILD (BUILD:, builder)

Role: builder. Entry: the red tests from DEFINE. Exit: the red tests pass, the acceptance criteria are implemented using the bundle's architectural context, with nothing beyond them; deviation from the bundle is escalation, not improvisation. The builder writes production code, Code Nodes and code-hygiene unit tests only: never an AC-based or E2E test, a TS / TC record or criterion text. Author or update Code Nodes (`rcf define create cn --path <file>[#symbol] --acs <ac-ids>`) for the source as you write it - comprehension of which symbols serve which ACs is cheapest to capture now, and FINALISE refuses completion without it. Referee: the red tests, with the bundle as the spec.

### REVIEW (REVIEW:, reviewer)

Role: reviewer. Entry: the implementation is complete at a committed head H. Exit: `rcf define validate` comes back clean, `rcf audit separation` passes over the pull request's range (it judges each commit's stage prefix against the paths it touches, and the pull_request CI job runs the same check on a full-depth checkout), the reviewer has run `rcf audit test-strength` read-only over the touched criteria (unrecorded: the recorded report is TEST's) to read the structural and mutation report, and the reviewer has re-read the diff against every in-scope acceptance criterion and recorded MERGE or FINDINGS for the code and PASS or FINDINGS for test adequacy with `rcf build verdict review --fbs <fbs-id> --acs <AC ids> --code <MERGE|FINDINGS> --adequacy <PASS|FINDINGS>`. The reviewer judges on three classes only (buyer harm, a vacuous test, a test or criterion the builder edited); everything else is a note. The read-only test-strength report shows a gutted test whose mutants survive, and the reviewer judges it. Referee: `rcf define validate`, `rcf audit separation` and the recorded verdict.

### TEST (TEST:, verifier)

Role: verifier. Entry: a reviewed head H with a REVIEW MERGE. Exit: the verifier has run the full RCF suite against a locally running app serving H, nothing is deployed, has recorded the test-strength report for the touched criteria at H with `rcf audit test-strength --record --acs <AC ids>` (the report refuses nothing), and has recorded the result from the suite's TAP with `rcf build verdict test --fbs <fbs-id> --result <PASS|FAIL> --tap <file> --runtime "<text>"`. The pull request merges only on a REVIEW MERGE and a TEST PASS at the same head. Every "tested" claim made in this stage names the runtime it was checked against and never implies a run on a deployed runtime that was not exercised. Referee: the recorded TEST verdict.

### FINALISE (FINALISE:, stage-keeper)

Role: stage-keeper. Entry: a REVIEW MERGE and a TEST PASS at the same head, with CI green on the PR head. Exit: on the PR branch before the merge, `rcf build finalise <fbs-id> --ci-run <ref>` checks the last round's recorded verdicts (the REVIEW MERGE and test-adequacy PASS, the TEST PASS, Code Nodes for every touched criterion and the separation audit over the range) and writes complete; the write is committed on the branch and the work merges carrying it. Finalise requires the test-strength record at the reviewed head: a valid TestStrengthReport v1 for that head covering every touched criterion. Finalise never refuses on its result; it prints one line for each touched criterion that is fail or blocked. Finalise spawns nothing but git and never writes verified. `rcf build mark <fbs-id> complete` is refused (exit 4): complete is written only by `rcf build finalise`. Referee: CI, the finalise checks and their refusals.

## Rounds

A round is one pass of the five stages over the touched criteria. A failed REVIEW (FINDINGS) or a failed TEST closes the round. The next round starts at DEFINE. Stage order is monotonic within a round: no `DEFINE:` commit follows a `BUILD:` commit of the same round, and so on down the five stages. Finalise judges the last round only. A round's budget is two DEFINE passes and a date, both set when it opens; after the first BUILD a note is a candidate for a later round, never a reopening of DEFINE, and over budget the owner gets a plain choice.

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
