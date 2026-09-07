# Changelog

All notable changes to the `deploy-cloudflare-workers` blueprint are recorded here.
The format follows Keep a Changelog. Versions are semver, per
`packages/rcf-lite/docs/blueprint-authoring.md` section 6.

## 1.2.0 - 2026-09-07

Additive minor bump. Blesses the Workers-with-static-assets shape as the
ratified SPA-on-Workers deploy shape, per the Cloudflare Pages
landing-page recommendation (2026-09-06). Seven new contributions in the
existing 12xx US band and 13xx suffix block; every shipped v1.1.0
contribution carries through unchanged.

Added

- REQ `deploy-cloudflare-workers-REQ-013`: Workers-with-static-assets
  shape. An elicited `[assets] directory` value is emitted on
  `wrangler.toml`; the manifest never carries `pages_build_output_dir`
  alongside `[assets]`.
- REQ `deploy-cloudflare-workers-REQ-014`: SPA fallback discipline via
  elicited `run_worker_first`. A truthy answer emits
  `run_worker_first = true` under `[assets]`; a falsy or unanswered
  answer omits the field and lets Cloudflare's runtime serve assets
  before the Worker fetch handler runs.
- US `-US-12113`: SPA-on-Workers deploy. Runtime-observable ACs on the
  emitted `[assets]` block shape.
- US `-US-12114`: assets-directory elicitation. Recorded on the applied
  sidecar as `appliedElicitations.assets-directory`.
- US `-US-12115`: migrate-from-Pages guidance. Guide section links
  Cloudflare's own migrate-from-Pages walkthrough.
- ADR `ADR-1306-deploy-cloudflare-workers-spa-shape`: Workers-with-
  static-assets as the ratified SPA-on-Workers deploy shape.
  Contribution entry carries `recommendedDefault: true` and
  `standardsTraceClause: Cloudflare Pages landing-page recommendation
  (2026-09-06)`. Body quotes the landing-page recommendation verbatim
  (fetched 2026-09-06 in the round-6 proposal and re-verified at
  ratification).
- Elicits (top-level `elicits[]`): `assets-directory` (string, default
  empty) and `run-worker-first` (boolean, default false). The spec's
  intended `when: {elicitedNonEmpty: [assets-directory]}` predicate on
  `run-worker-first` is not shipped this round because the loader's
  supported `when` block only accepts `requiresCapability` arrays; the
  guide teaches that `run-worker-first` is only meaningful when
  `assets-directory` is non-empty.
- Probe module `contributions/probes/assets-manifest-scan.mjs`
  (`anchorAcId: AC-12113-1`, `accountBound: false`): parses the applied
  fixture `wrangler.toml`, asserts `[assets] directory` matches the
  elicited answer, asserts `run_worker_first` matches the elicited
  answer, and refuses on any `pages_build_output_dir` presence.

Changed

- Existing ADR contribution entries (`ADR-1301` through `ADR-1305`)
  gain the `generic enterprise practice` sentinel on
  `standardsTraceClause` at the contribution entry, per
  `blueprint-authoring.md` section 8a.4. The ADR bodies are not touched.

Notes

- No new capability minted; `capabilities` remains absent.
- No new global topic minted; the existing `deploymentTarget` topic on
  ADR-1301 covers the deploy shape unchanged.
- No runtime dependency added to applying projects.
- `suggestedCompanions` unchanged (`logging`, `errorHandling`).
- The shared `cf-platform` sample-app fixture at
  `packages/rcf-lite/test/fixtures/cf-platform/` ships alongside this
  bump as the probe target. T-1 (KV), T-2 (cron), T-3 (Durable Objects)
  and T-5's Turnstile sub-fixture extend the same fixture later.
