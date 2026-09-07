# cf-platform sample-app fixture

Shared fixture for the round 6 Cloudflare blueprint train. T-0 mints
it; T-1 (KV), T-2 (cron), T-3 (Durable Objects) and T-5's Turnstile
sub-fixture extend it later. The fixture ships a minimal Workers
project that applies the `deploy-cloudflare-workers` v1.2.0 blueprint
in its ratified Workers-with-static-assets shape.

## Layout

- `wrangler.toml` declares the Worker entry, the Cloudflare
  compatibility date, and the `[assets]` block. The elicited
  answers are baked in verbatim:
    - `assets-directory = "./dist"` (Workers-with-static-assets
      shape, per REQ-013)
    - `run_worker_first = true` (SPA fallback discipline, per
      REQ-014)
- `dist/index.html` is the single static asset the Cloudflare
  runtime serves at the edge.
- `src/index.mjs` is the minimal Worker fetch handler; `wrangler
  dev` boots it at whatever port wrangler picks (the fixture does
  NOT bind port 4200).
- `package.json` declares `wrangler` as a devDependency with the
  pinned major version; `pnpm start` runs `wrangler dev`.
- `run-assets-manifest-scan.mjs` is the run-shim for the T-0
  `assets-manifest-scan.mjs` probe module.

## Manual boot line

```
cd packages/rcf-lite/test/fixtures/cf-platform
pnpm install
pnpm start
```

`wrangler dev` picks its own port and prints the local URL; the
fixture never binds 4200 (Dave's workspace server owns that port).

## Two-line gate-reviewer boot for the T-0 probe

```
cd packages/rcf-lite/test/fixtures/cf-platform
node ./run-assets-manifest-scan.mjs
```

Expected: exit 0 with `aggregateVerdict: pass` and a detail record
naming `directory: "./dist"` and `run_worker_first: true`. The
report is written to `.rcf/reports/blueprints/deploy-cloudflare-
workers/assets-manifest-scan.json` under the fixture root.

## Induced-failure switches

- `SIMULATE_MIXED_SHAPE=true node ./run-assets-manifest-scan.mjs`
  copies `wrangler.toml` into a scratch path with a
  `pages_build_output_dir` field appended; the probe returns
  `aggregateVerdict: fail` with a detail naming the offending
  `pages_build_output_dir` line (Cloudflare's static-assets doc:
  the two shapes are mutually exclusive).
- `SIMULATE_EMPTY_ASSETS=true node ./run-assets-manifest-scan.mjs`
  copies `wrangler.toml` into a scratch path with the `[assets]`
  block removed; the probe records the bare-Worker shape (no
  assets table on the parsed manifest, empty-directory elicited
  answer) and returns `aggregateVerdict: pass`.

Both switches leave the base `wrangler.toml` untouched; the scratch
copies are removed on exit.

## Chain-slice pointers

The T-0 anatomy test at `packages/rcf-lite/test/blueprint/deploy-
cloudflare-workers-v-1-2-0-anatomy.test.js` binds each test case in
`TS-073`, `TS-074`, `TS-075` to the fixture files above. Every AC on
`US-2901`, `US-2902`, `US-3001` is covered by a TC whose
`testPointer` names a test in that file.
