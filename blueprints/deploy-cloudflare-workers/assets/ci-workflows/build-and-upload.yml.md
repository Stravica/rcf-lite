# build-and-upload workflow (GitHub Actions form)

Reference shape for the `build-and-upload` workflow. Every value with `<...>` is a placeholder the project fills. The workflow triggers on `push` to `main`, injects build provenance, invokes the Deploy Adapter's `uploadVersion` verb, and writes the uploaded version id plus the two preview URLs to the run summary and to a structured output the `promote` workflow reads.

```yaml
# .github/workflows/build-and-upload.yml
name: build-and-upload

on:
  push:
    branches: [main]

concurrency:
  group: build-and-upload
  cancel-in-progress: false

jobs:
  build-and-upload:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      versionId: ${{ steps.upload.outputs.versionId }}
      versionIdUrl: ${{ steps.upload.outputs.versionIdUrl }}
      previewAliasUrl: ${{ steps.upload.outputs.previewAliasUrl }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - uses: pnpm/action-setup@v4

      - name: Install pinned dependencies
        run: pnpm install --frozen-lockfile

      - name: Build with provenance
        env:
          BUILD_VERSION_SHA: ${{ github.sha }}
          BUILD_BUILT_AT: ${{ github.event.head_commit.timestamp }}
          BUILD_CI_RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: pnpm build

      - name: Upload version
        id: upload
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: node scripts/deploy/upload-version.mjs --preview-alias main

      - name: Write run summary
        run: |
          {
            echo "## Uploaded version"
            echo ""
            echo "- versionId: \`${{ steps.upload.outputs.versionId }}\`"
            echo "- versionIdUrl: ${{ steps.upload.outputs.versionIdUrl }}"
            echo "- previewAliasUrl: ${{ steps.upload.outputs.previewAliasUrl }}"
          } >> "$GITHUB_STEP_SUMMARY"
```

## The Node.js orchestration script

`scripts/deploy/upload-version.mjs` is the project-authored script the workflow invokes. Its body:

```javascript
#!/usr/bin/env node
// Invoked by the build-and-upload workflow. Wraps the Deploy Adapter's
// uploadVersion verb, parses --preview-alias, and writes structured outputs
// the workflow references via ${{ steps.upload.outputs.<name> }}.

import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createDeployAdapter } from '../../src/deploy/adapter.mjs';

const { values } = parseArgs({
  options: { 'preview-alias': { type: 'string' } }
});
if (!values['preview-alias']) {
  console.error('DEPLOY_PREVIEW_ALIAS_REQUIRED: --preview-alias is required');
  process.exit(2);
}

const adapter = createDeployAdapter();
const { versionId, versionIdUrl, previewAliasUrl } =
  await adapter.uploadVersion({ previewAlias: values['preview-alias'] });

const out = process.env.GITHUB_OUTPUT;
if (!out) {
  console.error('GITHUB_OUTPUT unset; running outside GitHub Actions?');
  process.exit(2);
}
appendFileSync(out, `versionId=${versionId}\n`);
appendFileSync(out, `versionIdUrl=${versionIdUrl}\n`);
appendFileSync(out, `previewAliasUrl=${previewAliasUrl}\n`);
```

## Reader notes

- Triggers ONLY on `push` to `main`. No `pull_request`, no `schedule`. AC-12107-1 refuses any other trigger; AC-12104-1 refuses any workflow that both pushes-to-main AND promotes.
- The Worker being uploaded must exist on the vendor before `wrangler versions upload` succeeds. The first-time-per-Worker bootstrap is a one-time operator act, not part of this workflow; see `assets/wrangler-samples/bootstrap-vs-steady-state.md`. This workflow assumes bootstrap has already run.
- The three provenance env vars (`BUILD_VERSION_SHA`, `BUILD_BUILT_AT`, `BUILD_CI_RUN_URL`) are baked into the built bundle by the project's build step. AC-12112-1 requires them readable from within the Worker at request time; the health probe exposes them. `BUILD_VERSION_SHA` is the git commit sha (`github.sha`); it is NOT the vendor-assigned version UUID that `wrangler versions upload` returns. The two identifiers name two different things (see `assets/verification/served-surface-probes.md` for the boundary the verifier reconciles).
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are GHA repository secrets. The token is scoped to the Worker's account with the minimum verbs the adapter uses. AC-12107-3 requires neither byte-sequence appear in any log line; wrangler and the redactor in the Deploy Adapter both mask them by default.
- `concurrency` on the workflow name prevents overlapping uploads racing the preview alias. `cancel-in-progress: false` because cancelling an upload mid-flight leaves the alias in an ambiguous state on some vendors.
- The workflow's `outputs` block surfaces `versionId`, `versionIdUrl`, and `previewAliasUrl` for the `promote` workflow's `resolveNewestOfMain` path. AC-12107-2 requires this structured output.
