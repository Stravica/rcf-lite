# promote workflow (GitHub Actions form)

Reference shape for the `promote` workflow. Every value with `<...>` is a placeholder the project fills. The workflow triggers only on `workflow_dispatch`, accepts an optional `versionId` input, invokes the Promote Gate, and honours the Served-surface Verifier's pass or fail.

```yaml
# .github/workflows/promote.yml
name: promote

on:
  workflow_dispatch:
    inputs:
      versionId:
        description: "Version id to promote. Leave blank for newest-of-main."
        required: false
        type: string

concurrency:
  group: promote
  cancel-in-progress: false

jobs:
  promote:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - uses: pnpm/action-setup@v4

      - name: Install pinned dependencies
        run: pnpm install --frozen-lockfile

      - name: Promote and verify
        id: promote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          PROMOTED_BY: ${{ github.actor }}
        run: node scripts/deploy/promote.mjs --version-id "${{ inputs.versionId }}"

      - name: Write run summary
        if: always()
        run: |
          {
            echo "## Promote outcome"
            echo ""
            echo "- promotedVersionId: \`${{ steps.promote.outputs.promotedVersionId }}\`"
            echo "- versionSha:        \`${{ steps.promote.outputs.versionSha }}\`"
            echo "- previousVersionId: \`${{ steps.promote.outputs.previousVersionId }}\`"
            echo "- promotedBy:        \`${{ github.actor }}\`"
            echo "- outcome:           \`${{ steps.promote.outcome }}\`"
          } >> "$GITHUB_STEP_SUMMARY"
```

## The Node.js orchestration script

`scripts/deploy/promote.mjs` is the project-authored script the workflow invokes. Its body:

```javascript
#!/usr/bin/env node
// Invoked by the promote workflow. Wraps the Promote Gate (TAC-1304).
// Resolves the newest-of-main when --version-id is blank; refuses an unknown
// version id before any vendor call; invokes the Served-surface Verifier
// after promoteVersion returns success; writes structured outputs.

import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createDeployAdapter } from '../../src/deploy/adapter.mjs';
import { createServedSurfaceVerifier } from '../../src/deploy/verifier.mjs';
import { createPromoteGate } from '../../src/deploy/promote-gate.mjs';

const { values } = parseArgs({
  options: { 'version-id': { type: 'string', default: '' } }
});

const adapter = createDeployAdapter();
const verifier = createServedSurfaceVerifier({ adapter });
const gate = createPromoteGate({ adapter, verifier });

try {
  const record = await gate.promote({
    versionId: values['version-id'] || null,
    promotedBy: process.env.PROMOTED_BY || 'unknown'
  });
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    // promotedVersionId is the vendor-assigned version UUID (the string
    // `wrangler versions deploy` takes). versionSha is the git commit sha
    // of the source tree the promoted version was built from; the verifier
    // substitutes this into the health probe's `expectShape.versionSha`
    // slot to reconcile served against promoted. Both identifiers are
    // required on the promote record; they are never equal.
    appendFileSync(out, `promotedVersionId=${record.promotedVersionId}\n`);
    appendFileSync(out, `versionSha=${record.versionSha}\n`);
    appendFileSync(out, `previousVersionId=${record.previousVersionId}\n`);
  }
  process.exit(0);
} catch (err) {
  console.error(`${err.code || 'PROMOTE_FAILED'}: ${err.message}`);
  process.exit(1);
}
```

## Reader notes

- The Worker being promoted must have been bootstrapped once with `wrangler deploy --secrets-file <path>` before the first `wrangler versions upload` from `build-and-upload` can succeed; see `assets/wrangler-samples/bootstrap-vs-steady-state.md`. Steady-state ship (this workflow's world) assumes bootstrap has already run.
- The promote record carries two identifiers: `promotedVersionId` (vendor-assigned UUID, the value `wrangler versions deploy` took) and `versionSha` (git commit sha the promoted version was built from). The verifier reconciles the served health-probe body's `versionSha` against the promote record's `versionSha`, NOT against `promotedVersionId`; see `assets/verification/served-surface-probes.md` for the boundary.
- Triggers ONLY on `workflow_dispatch`. No `push`, no `pull_request`, no `schedule`. AC-12104-2 refuses any other trigger; AC-12104-1 refuses any workflow that pushes-to-main AND promotes.
- The `versionId` input is optional (`required: false`). Blank defaults to newest-of-main, resolved by the Promote Gate through the Deploy Adapter. AC-12108-1 requires exactly one optional input; AC-12108-2 requires the blank case to resolve through `resolveNewestOfMain`.
- The Promote Gate refuses a `versionId` absent from `listVersions()` BEFORE any vendor promote call. AC-12108-3 requires the refusal to exit non-zero with `DEPLOY_VERSION_NOT_FOUND` and to leave no promote record.
- The Served-surface Verifier runs after `promoteVersion` returns success. A verifier failure exits non-zero with `PROMOTE_VERIFY_FAILED` and refuses to mark the release successful. AC-12110-3 requires this.
- `PROMOTED_BY: ${{ github.actor }}` binds the operator principal from the trigger context into the deploy-log record. AC-12104-3 requires the record.
- To rollback: invoke this workflow with the prior version id supplied as the `versionId` input. AC-12109-1 requires no separate rollback path. AC-12109-3 requires rollback promotes to run the same verifier.
- Additional approver-gating (a two-person integrity policy on every promote) layers above `workflow_dispatch` through the platform's manual-approval primitive; the blueprint's ADR set does not fix that policy.
