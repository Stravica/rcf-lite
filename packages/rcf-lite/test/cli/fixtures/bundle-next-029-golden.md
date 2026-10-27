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

**DEFINE FBS-001: TODO: name this build session** - commit prefix `DEFINE:`, role test-author.

The test-author writes the AC-based and E2E tests and their TS / TC bindings for every in-scope criterion, proves each new test red and marks pickup; it never writes production code.

    rcf audit coverage --strict

    rcf build mark FBS-001 inProgress

**BUILD FBS-001: TODO: name this build session** - commit prefix `BUILD:`, role builder.

The builder makes the red tests green with production code, Code Nodes and code-hygiene unit tests only, on a base whose RCF suite is recorded green; deviation from the bundle is escalation, not improvisation.

    rcf build base-suite --out <file>

    rcf define create cn --path <file>[#symbol] --acs <ac-ids>

**REVIEW FBS-001: TODO: name this build session** - commit prefix `REVIEW:`, role reviewer.

The reviewer validates the tree, runs the separation audit (each commit's stage prefix against the paths it touches) and the test-strength proof, re-reads the diff against every in-scope criterion and records the verdict at the reviewed head H.

    rcf define validate

    rcf audit separation --base <trunk>

    rcf audit test-strength --record

    rcf build verdict review --fbs FBS-001 --acs <AC ids> --code MERGE|FINDINGS --adequacy PASS|FINDINGS

**TEST FBS-001: TODO: name this build session** - commit prefix `TEST:`, role verifier.

The verifier runs the full RCF suite against a locally running app serving H, nothing deployed, and records its TAP; a failed REVIEW or TEST closes the round and the next round starts at DEFINE.

    rcf build verdict test --fbs FBS-001 --result PASS|FAIL --tap <file> --runtime "<text>"

**FINALISE FBS-001: TODO: name this build session** - commit prefix `FINALISE:`, role stage-keeper.

On the PR branch before the merge, with CI green, the stage-keeper runs the light Finalise: it checks the recorded verdicts and writes complete, and the merge carries it.

    rcf build finalise FBS-001 --ci-run <ref>

Every commit carries its stage prefix; the `Hand:` trailer is optional through 0.37.x.

Verify is outside the round: rcf verify run --release <label> --since <ref> --record before the promote
