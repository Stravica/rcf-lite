# probe-pack-delivery-ci-workflows fixture

Fixture-side workflow linter used by the `delivery-ci-workflows`
blueprint's contribution probes. Reads every workflow template under
`blueprints/delivery-ci-workflows/assets/ci-provider-examples/github-
actions/` and provides a naive top-level scan plus an actionlint
invocation branch (when the binary is on PATH).

## Declared env vars

Local branch:

- `RCF_FIXTURE_CIW_ACTIONLINT_PATH` (optional): overrides the
  `actionlint` binary name/path (default: `actionlint` on PATH).

Live branch (GitHub Actions read-only):

- `CI_HAS_GITHUB_ACTIONS` (first-tier gate): when unset the real-
  account probe records `accountBoundSkipped: true` and the aggregate
  flips to pass per spec section 3.5. Uses ambient `gh` auth (checked
  via `gh auth status` as a pre-flight observation, per the master
  brief for criterion e 2026-09-11 delivery-ci-workflows row); the probe
  never triggers workflows.
- `RCF_FIXTURE_CIW_REPO` (optional): overrides the read-only repo
  the real-account probe queries; no default (probe skips honestly when unset).

## Reviewer boot

```
# ensure Node 24 is first on PATH (project-specific incantation; see the repo docs)
node ./blueprints/delivery-ci-workflows/contributions/probes/run-workflow-template-shape.mjs
node ./blueprints/delivery-ci-workflows/contributions/probes/run-node-gate-entrypoint.mjs
node ./blueprints/delivery-ci-workflows/contributions/probes/run-real-account-github-actions-run-record.mjs
```
