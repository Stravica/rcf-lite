# Bootstrap assets

Templates the operator copies into their project during the bootstrap window
of a fresh delivery-ci-workflows apply. Nothing here is imported automatically
by the blueprint; every file is a starting point the operator adapts and
registers on the project tree.

## `adr-bootstrap-coverage-supersession.template.json`

Project-level ADR template that demotes the mandatory-tier `coverage-strict`
gate to advisory-only during the bootstrap window (see the guide's "Bootstrap
posture" section for the problem statement).

Usage:

1. Copy this file into the project's ADR directory (typically `rcf/adrs/`).
2. Rename the file and its `adrId` from the `ADR-XXX-...` placeholder to the
   next free project-level ADR id.
3. Replace the two `TEMPLATE-*ISO8601` timestamps with the current wall-clock.
4. Register the ADR on the project as `scope: global` on topic
   `strictCoverageGate` so it competes with ADR-702 through the resolutions
   mechanism.
5. Amend the exit criterion in the `decision` section if `N = 5` consecutive
   passes is not the right threshold for the project.
6. When the exit criterion is met, flip `status` to `superseded` and leave
   the file in place for audit trail.
