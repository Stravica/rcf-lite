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

Satisfied by this bundle: the FBS, acceptance criteria, ancestry and
architectural context above ARE the definition. Confirm your plan against
every in-scope acceptance criterion (AC-101-1) in section 4 before writing
code, then mark pickup:

    rcf build mark FBS-001 inProgress

Commit any plan artefacts the driving workflow requires.

### Stage 2 - Build

Implement to the acceptance criteria in section 4 using the architectural
context in section 5. The bundle is the spec: deviation is escalation to
the operator of the loop, not improvisation. As you implement, author or
update Code Nodes for the source you write:

    rcf define create cn --path <file>[#symbol] --acs <ac-ids>

Do this now, not as an afterthought: comprehension of which symbols serve
which acceptance criteria is cheapest to capture while you are writing the
code, and Stage 5 refuses completion without it. Commit at stage end.

### Stage 3 - Review

Mechanical referee pass:

    rcf define validate

must come back clean; then re-read the diff against every in-scope
acceptance criterion and document any deviations. Commit.

### Stage 4 - Test

Exercise every in-scope acceptance criterion: write or extend the TS / TC
documents (section 6 lists the existing surface and the flagged gaps) and
the tests they point to, until:

    rcf audit coverage --strict

covers the in-scope acceptance criteria. Commit.

### Stage 5 - Finalise

CI green; PR raised and merged per the driving workflow's convention.
After the merge:

    rcf build mark FBS-001 complete

This refuses (exit 3, missingCodeNodes) if any in-scope acceptance
criterion still carries no Code Node - go back to Stage 2 and author it,
or, for a genuinely no-code spec (docs-only, config-only), declare:

    rcf build mark FBS-001 complete --no-code-nodes

Then ship-gate the deployed app - an independent verify run that
passes with ship authority promotes complete -> verified:

    rcf build finalise FBS-001 --url <deploy-url>
