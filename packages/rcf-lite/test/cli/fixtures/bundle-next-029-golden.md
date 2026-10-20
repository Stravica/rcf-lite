# Spec bundle: FBS-001 - TODO: name this build session

## 1. Header

- Item: FBS-001 - TODO: name this build session
- Queue: order 1, item 1 of 1
- Execution status: notStarted
- Parent chain: BS-001 -> PRD-001 (PR8BundleTest)
- Spec last touched: 2026-01-01T00:00:00Z

## 2. Queue and dependency context

- Build sequence: BS-001 - Initial build sequence
- Generation strategy: dependencyFirst
- Build philosophy: TODO: describe the build philosophy.

Dependencies: none.

Dependents waiting on this item: none.

## 3. The work

TODO: describe what this build session delivers.

## 4. Acceptance criteria

### US-101: TODO: name this user story (status: draft)

As a TODO: name the user, I want TODO: state the want, so that TODO: state the value.

Parent requirement REQ-001: TODO: name this requirement (functional, priority: must)

> TODO: describe this requirement.

#### AC-101-1: TODO: describe the first acceptance criterion

- Testable: yes

## 6. Existing test surface

Presence reporting off the tree, not a coverage verdict (`rcf audit coverage` is the coverage surface).

- AC-101-1: no existing tests - test suite to be written for this AC

## 7. Build-cycle runbook

This bundle is the work order for one pass of the RCF five-stage build
cycle: Define -> Build -> Review -> Test -> Finalise. The tool assembles
and referees; the harness executes. Every stage ends in a commit.

Deep guidance: rcf://docs/build-cycle and the rcf_execute_build_cycle prompt, or `rcf guidance build-cycle-playbook` on the CLI.

### Stage 1 - Define

Hand: test-author. The FBS, acceptance criteria, ancestry and
architectural context above ARE the definition. The test-author writes
the AC-based and E2E tests and their TS / TC bindings for every in-scope
acceptance criterion (AC-101-1) before any production code, proves each
new test red, and checks that (section 6 lists the existing surface):

    rcf audit coverage --strict

covers them. Then mark pickup:

    rcf build mark FBS-001 inProgress

Commit with the trailer `Hand: test-author`.

### Stage 2 - Build

Hand: builder. The builder makes the red tests green with production code,
Code Nodes and code-hygiene unit tests only; it never edits an AC-based or
E2E test, a TS / TC record or criterion text. Implement to the acceptance
criteria in section 4 using the architectural context in section 5. The
bundle is the spec: deviation is escalation to the operator of the loop,
not improvisation. As you implement, author or update Code Nodes for the
source you write:

    rcf define create cn --path <file>[#symbol] --acs <ac-ids>

Do this now, not as an afterthought: comprehension of which symbols serve
which acceptance criteria is cheapest to capture while you are writing the
code, and Stage 5 refuses completion without it. Commit with the trailers
`Hand: builder` and `Hand-Id: <builder identity>`.

### Stage 3 - Review

Hand: reviewer. Mechanical referee pass:

    rcf define validate

    rcf audit separation

must both come back clean (separation judges each commit's `Hand:` trailer
against the paths it touches, as the pull_request CI job does); then the
reviewer re-reads the diff against every in-scope acceptance criterion
and returns MERGE or FINDINGS. Any commit it makes carries
`Hand: reviewer`.

### Stage 4 - Test

Hand: verifier. On the reviewed head, the verifier runs the bound suites
against the preview or version host (`--artefact <tgz>` or
`--package <dir>`):

    rcf verify run --fbs FBS-001 --hand verifier --artefact <tgz>

The verb writes the report to rcf/verify-reports/FBS-001/<head12>.json;
commit it with the trailer `Hand: verifier`. The PR merges only on a
Review MERGE and a Test PASS at the same head.

### Stage 5 - Finalise

Hand: stage-keeper. CI green; PR merged per the driving workflow's
convention. After the merge:

    rcf build mark FBS-001 complete

This refuses (exit 3, missingCodeNodes) if any in-scope acceptance
criterion still carries no Code Node - go back to Stage 2 and author it,
or, for a genuinely no-code spec (docs-only, config-only), declare:

    rcf build mark FBS-001 complete --no-code-nodes

Then promote complete -> verified by ingesting the committed Test-stage
report, naming the CI run that passed on the merged head:

    rcf build finalise FBS-001 --ci-run <ref>
