# The RCF 5-stage build cycle

The normative statement of the cycle. Every FBS item is delivered by one pass of five stages, in this order, under these contracts. The spec bundle that `rcf build bundle --next` emits carries the same cycle as its closing runbook, parameterised for the item in hand; if this page and a bundle ever disagree, the bundle is authoritative.

## The five stages

**1. Define.**
Hand: test-author. Entry: you hold the item's spec bundle. Exit: the test-author hand has written the AC-based and E2E tests and their TS / TC bindings for every in-scope acceptance criterion in the bundle's section 4, each new test is proven red for the right reason, `rcf audit coverage --strict` covers them, and pickup is recorded with `rcf build mark <fbs-id> inProgress`. The test-author never writes production code. Commits carry the trailer `Hand: test-author`. Referee: the bundle itself, plus `rcf define validate` and `rcf audit coverage --strict` on a clean tree - the strict gate checks the pointer, not just the row: a test case counts only when its `testPointer` resolves to a real test in the tree, and one that does not is reported as `covered-unresolved`.

**2. Build.**
Hand: builder. Entry: the red tests from Define. Exit: the red tests pass, the acceptance criteria are implemented using the bundle's architectural context, with nothing beyond them; deviation from the bundle is escalation, not improvisation. The builder writes production code, Code Nodes and code-hygiene unit tests only: never an AC-based or E2E test, a TS / TC record or criterion text. Author or update Code Nodes (`rcf define create cn --path <file>[#symbol] --acs <ac-ids>`) for the source as you write it - comprehension of which symbols serve which ACs is cheapest to capture now, and Stage 5 refuses completion without it. Commits carry the trailers `Hand: builder` and `Hand-Id: <builder identity>`. Referee: the red tests, with the bundle as the spec.

**3. Review.**
Hand: reviewer. Entry: the implementation is complete. Exit: `rcf define validate` comes back clean, `rcf audit separation` passes over the pull request's range (each commit's `Hand:` trailer judged against the paths it touches; the pull_request CI job runs the same check on a full-depth checkout), and the reviewer has re-read the diff against every in-scope acceptance criterion and returned MERGE or FINDINGS, with deviations documented. Any commit the reviewer makes carries `Hand: reviewer`. Referee: `rcf define validate` and `rcf audit separation`.

**4. Test.**
Hand: verifier. Entry: a reviewed head with a MERGE. Exit: the verifier hand has run `rcf verify run --fbs <fbs-id> --hand verifier` against the preview or version host serving the reviewed head (`--artefact <tgz>` for the packed artefact, `--package <dir>` for a package directory), and committed the report the verb writes to `rcf/verify-reports/<fbs-id>/<head12>.json` with the trailer `Hand: verifier`. The pull request merges only on a Review MERGE and a Test PASS at the same head. Every "verified" or "tested" claim made in this stage names the runtime it was checked against and never implies verification on a deployed runtime that was not exercised. Referee: the verify report's verdict.

**5. Finalise.**
Hand: stage-keeper. Entry: a Review MERGE and a Test PASS at the same head. Exit: CI green and the work merged per the driving workflow's convention, then `rcf build mark <fbs-id> complete` after the merge, and `verified` written by `rcf build finalise <fbs-id> --ci-run <ref>`, which ingests the committed Test-stage report and names the CI run that passed on the merged head; it spawns nothing but git lookups and never runs verify itself. `--mark` caps at `complete` - it cannot write `verified`. `--mark complete` refuses (exit 3, missingCodeNodes) if any in-scope acceptance criterion still carries no Code Node - go back to Stage 2, or declare `--no-code-nodes` for a genuinely no-code spec. The PR body's verification section carries a runtime label on every claim. Commits carry the trailer `Hand: stage-keeper`. Referee: CI, the finalise gate, plus the mark commands' own refusals.

## Definition of done includes a working local preview

A build is not done until it also leaves a **working, documented local preview** as its default outcome - a dev server, seeded data where the app needs data to be usable, ideally started with one documented command. This is required whether or not the owner stated a hosting target: the local preview is the runtime the owner can always drive, and remote deployment is an addition on top of it, never a replacement for it.

## Every stage commits

Each stage ends in a commit. The commit is the stage boundary: it makes the cycle auditable in history and keeps a failed stage cheap to unwind. A stage without its commit is not finished.

## The lifecycle is forward-only

`notStarted -> inProgress -> complete -> verified`. Forward jumps are legal, but the `--mark` ladder caps at `complete`: `--mark verified` is refused with exit 4 and points to `rcf build finalise`, because `verified` is written only by the finalise gate from the Test-stage report. Backward transitions are refused with exit 4; the deliberate-correction / manual-override escape hatch is `rcf define update <fbs-id> --set executionStatus=<status>`, and reaching for it should be rare enough to be remarkable.

## Depth

This page is the contract. For per-stage guidance, failure modes, escalation rules and worked examples, fetch the `rcf_execute_build_cycle` prompt or read `build-cycle-playbook.md` in this directory.

---

Canonical reference: https://stravica.ai/rcf-methodology/build-cycle
