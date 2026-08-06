# rcf-lite packaging consolidation proposal

**Status: DRAFT — for Baz review. Ratifies the packaging shape the next release ships under. No code moves land until this is ratified.**

## Purpose

The 2026-08-06 morning ruling reshaped the suite's install story: the next release ships as ONE published npm install, `rcf-lite`, lockstep-versioned, exposing the existing unified `rcf` CLI. Internal workspace packages (`rcf-lite-core` and any that follow) stay unpublished workspace-only where the modularity earns its keep — the Jest / Angular pattern.

The driver is chain integrity. Define, build and verify must share one standards ruleset; independently-versioned packages invite mixed-version chains, which for a confidence product is a fatal class. Secondary drivers: the version-skew support burden, the one-command install UX, and the CLI already being one `rcf` verb space.

This document proposes the concrete shape, flags every consequential trade-off as a named ruling item (or records the ruling if one has already landed), and specifies the migration and the registry runbook. It does not touch bytes beyond a small non-locking prep (schemas dep pinned exact, `rcf-define-lite` workspace-slot comment) — the substantive package.json / directory / bin moves wait on Baz's ruling on the open items.

## Discovered layout (baseline)

Two repos hold the suite today, and — per the 2026-08-06 Baz ruling below — they stay that way.

`Stravica/rcf-lite` (this repo, pnpm monorepo, Node >= 24):

- `packages/build` — `@stravica-ai/rcf-build-lite@0.7.0`. Ships the `rcf` bin (~30 verbs: init, view, validate, create, read, update, delete, link, unlink, coverage, trace, impact, build, finalise, doctor, guidance, mcp, preflight, review, fbs, test-suite, ui-classify, ui-baseline, design, browser-verify, req-classify, req-baseline, intake, help). Depends on `@stravica-ai/rcf-lite-core` via `workspace:*`; devDep `@stravica-ai/rcf-schemas` at `^0.4.2`.
- `packages/verify` — `@stravica-ai/rcf-verify-lite@0.2.0`. Ships the `rcf-verify` bin (5 verbs: run, report, provision, cleanup, mcp). Depends on `@stravica-ai/rcf-lite-core` via `workspace:*`.
- `packages/core` — `@stravica-ai/rcf-lite-core@0.3.0`. No bin. Depends on `@stravica-ai/rcf-schemas` at `^0.4.2`. Consumed by build and verify via `workspace:*`.

`Stravica/rcf-schemas` (sister repo):

- Root package — `@stravica-ai/rcf-schemas@0.4.2`. Schemas-only, no code. Consumed as an external published dep by core (runtime) and build (dev-only). **Stays standalone** — the language-neutral schema contract serves the whole RCF product line (Lite AND full/enterprise); it is not a rcf-lite-internal concern. See "Considered and ruled" below.

`rcf-lite` and `@stravica-ai/rcf-lite` are both AVAILABLE on the npm registry (verified `npm view` 2026-08-06). Ruling item R1 covers the choice.

CI:

- `ci.yml` (main + PRs): pnpm install --frozen-lockfile, `rcf validate`, `rcf coverage --strict`, `pnpm -r test`.
- `publish.yml` (tag-driven, OIDC trusted publisher): `build-v*` / `verify-v*` / `core-v*` prefix routes to the matching package dir; tag-vs-package.json version guard; prerelease dist-tag on hyphenated versions.

## Target shape

Externally: one install.

```sh
npm install -g rcf-lite       # or @stravica-ai/rcf-lite — item R1
rcf init
```

Internally: two (later, three) workspace packages, one public, the rest private.

```
packages/
  rcf-lite/           # PUBLIC. Umbrella. Ships `rcf` bin (adds `rcf verify` subcommand).
                      # Ships `rcf-verify` alias bin (transition grace, deprecated).
                      # Bundles core + verify src into dist/ at build time (see R2 recommendation).
  core/               # private:true. Shared internals (chain store, errors, MCP shell, patterns, baseline catalog).
  # define/           # slot for rcf-define-lite (empty, comment-only).
```

Verify collapses INTO the umbrella package (see R3 below — this is ratified, not open). Its source lives at `packages/rcf-lite/src/verify/`; its verb handlers wire under `rcf verify <run|report|provision|cleanup|mcp>`; the umbrella retains a `rcf-verify` alias bin that dispatches to the same handlers, for a transition-grace period.

Lockstep versioning: all remaining packages carry the same version. Umbrella version tracks the release train (next: 0.7.1 packaging release, then 0.8.0 features — see R5). Internal packages bump in lockstep even when their own source is untouched — the version is a release-train stamp, not a change record.

Schemas: **external, permanent**. `@stravica-ai/rcf-schemas` stays a separately-versioned published package. Umbrella exact-pins it (not `^`) — the version-skew mitigation, treated as doctrine not hygiene. Every umbrella release deliberately reviews the schemas pin.

Product behaviour (except the new `rcf verify` subcommand — ratified), gate logic, chain semantics: untouched. Packaging shape only.

## Considered and ruled

### Schemas repo consolidation — RULED 2026-08-06: schemas remain standalone

Considered: folding `@stravica-ai/rcf-schemas` into this monorepo as a workspace-only package, to close the last cross-repo version-skew surface.

Ruled 2026-08-06 (Baz): `rcf-schemas` REMAINS STANDALONE. Rationale: schemas serve the WHOLE RCF product line, not just Lite. Full/enterprise RCF products consume the same schema contract; folding schemas into `rcf-lite` would prejudice the schemas repo's role as the language-neutral standard.

Consequence and mitigation (load-bearing): an external schemas package re-introduces the version-skew surface the rest of this consolidation kills. The mitigation is doctrine, not hygiene:

- Umbrella exact-pins `@stravica-ai/rcf-schemas` (`"0.4.2"`, never `"^0.4.2"`). Preserved as the one tested combination for each umbrella release.
- Every rcf-lite release DELIBERATELY reviews the schemas pin and either bumps or holds.
- The registry runbook's release checklist includes "schemas pin reviewed" as a mandatory item.

This preserves the one-tested-combination property with schemas outside the wall. Not re-litigated inside this proposal; recorded here so the ruling is not re-derived from first principles later. Interacts with 0.8.0 amendment ruling item 11 (scope-tag schemas bump) — that will be an ordinary schemas bump + rcf-lite pin bump under this pattern.

## Ruling items — need Baz's call

Three items open; two engineering-detail items decided by Dave at PR review (recorded here with reasoning); one already ratified (recorded here as decided).

### R1. Registry name: `rcf-lite` unscoped or `@stravica-ai/rcf-lite` scoped — BAZ ITEM (ruling sheet #17)

Both names available on npm.

- Unscoped `rcf-lite`: cleaner install command and product feel.
- Scoped `@stravica-ai/rcf-lite`: matches existing `@stravica-ai/*` convention across the suite and gives scope-level squat protection.

Dave has no pick — presenting trade-offs only. Whichever loses gets a placeholder squat-block package pointing at the winner.

### R2. How the umbrella bundles its unpublished workspace deps — ENGINEERING (Dave decides at PR review)

Not a Baz item. Recorded here with recommendation and reasoning.

**Recommendation (subject to code disagreement):** keep the pnpm workspace modularity for development, and bundle at BUILD TIME into the published package's `dist/` — esbuild / tsup-style compilation of workspace deps into a self-contained tarball. AVOID `bundleDependencies` (flaky with pnpm's isolated node_modules layout, especially under OIDC-triggered publish workflows). Source-collapse into one package (moving core's src into the umbrella and deleting `packages/core`) is the acceptable fallback if build-time bundling fights the existing zero-build toolchain.

Reasoning:

- Build-time bundling preserves the workspace-package boundary as a discipline aid — core stays a testable, independently-scoped module during development, even though it never ships as its own tarball.
- `bundleDependencies` sounds like the right primitive but is thin ice with pnpm: pack-time resolution of `workspace:*` inside a `bundleDependencies` list has been fragile in the wider ecosystem, and the failure mode is silent (tarball ships with unresolvable dep specs). Not worth the debugging tax on a release pipeline.
- Source-collapse is simplest but loses the "modularity where it earns its keep" argument. Fine as an emergency valve, wrong as first choice.

Regardless of which mechanism lands, the runbook's pack-verify step is mandatory: `pnpm pack` from the umbrella, `npm install ./rcf-lite-<v>.tgz` into a clean temp dir, `rcf --help` + `rcf-verify --help` + `rcf verify --help` smoke, all in that scratch environment. Tarball must be self-contained; the smoke script must fail loudly if any workspace path leaks in.

Note on the zero-build toolchain: the current `rcf` CLI runs directly from source (`pnpm rcf <verb>`; no build step per CONTRIBUTING). Adding a build step JUST for the publish path (not for local dev) is the shape recommended — dev keeps zero-build, publish gains one bundler pass. If that split proves painful, source-collapse (R2 fallback) becomes the right call.

### R3. Verify: `rcf verify` subcommand — RATIFIED 2026-08-06

Ratified 2026-08-06 (Baz, morning "one rcf CLI" ruling): verify folds into `rcf verify` as a first-class subcommand of the unified CLI, with a `rcf-verify` alias bin retained on the umbrella package for transition grace.

Shape:

- `rcf verify run|report|provision|cleanup|mcp` → the current 5 verify verbs, mounted under `rcf verify`.
- `rcf-verify <verb>` → alias bin that dispatches to the same handlers. Announced as deprecated in the release notes; removed in a future major.
- Verify's src moves into the umbrella package (`packages/rcf-lite/src/verify/`); its bin is deleted; its `@stravica-ai/rcf-verify-lite` package.json is removed (packages/verify directory removed altogether).

Chain-update consequence: the new `rcf verify` verb IS a CLI surface change. The migration PR (not this proposal PR) MUST include the matching `rcf/` chain updates: new verb REQ (or updates to existing verify REQ), matching US / AC, TC bindings, and a build-queue entry per the repo's dogfooding discipline. `rcf coverage --strict` must stay green.

### R5. Release-train sequencing: packaging vs 0.8.0 features — BAZ ITEM

Two options:

- **R5a. Fold packaging AND 0.8.0 content into one release.** 0.8.0 = new name + admissibility lint + gating amendments + ruleset v1 + interim generation-side tightening. One release, big surface.
- **R5b. Ship packaging as 0.7.1 (or 0.8.0-alpha), 0.8.0 stays feature-only.** Splits the two concerns; consumers on the old names get one clean migration release with no other change, then the feature release lands on the new name.

Dave's read: **R5b** — packaging under 0.7.1 as its own release under the new name, then 0.8.0 ships features on the new name. Reason: mixing "we renamed the package" with "we added an admissibility lint" makes it harder for consumers to attribute a break. Two smaller releases are cheaper to support.

### R6. Ruling-item-2 slot (shared standards ruleset) — DO NOT PRE-EMPT

Ruling item 2 in the 0.8.0 amendment (whether the shared ruleset ships bundled with build-lite or as a standalone artefact) is UNDECIDED. This proposal must not pre-empt it.

Approach: do not create a `packages/ruleset/` slot; do not add a `ruleset` bin; do not declare a ruleset export path on any package. When Baz rules, that ruling determines whether ruleset becomes a new workspace package, a src subtree inside the umbrella, or a schemas subtree. Any of the three fits the shape below without needing rework.

## Target layout (post-ratification, illustrative)

```
rcf-lite/                              # repo root, unchanged
  package.json                         # root: private, workspace scripts only
  pnpm-workspace.yaml                  # adds `# packages/define/` placeholder slot
  docs/
    2026-08-06_packaging-consolidation-proposal.md   # this doc
    2026-08-06_packaging-registry-runbook.md         # runbook, gated on ratification
  packages/
    rcf-lite/                          # PUBLIC. Umbrella.
      package.json                     # name: @stravica-ai/rcf-lite (or rcf-lite per R1)
                                       # version: lockstep (0.7.1 per R5b, then 0.8.0)
                                       # bin: { rcf, rcf-verify }  # rcf-verify is transition alias
                                       # devDependencies: workspace:* on core
                                       # dependencies: @stravica-ai/rcf-schemas EXACT (doctrine)
                                       # scripts.prepublishOnly: build-time bundle (R2)
                                       # files: [dist, bin, guidance, ...]  # dist populated by bundler
      bin/
        rcf.js                         # unchanged surface + verify subcommand routing
        rcf-verify.js                  # alias bin, dispatches to same verify handlers
      src/
        cli/...                        # existing build src
        verify/...                     # moved from packages/verify/src (R3)
      guidance/                        # unchanged
      rcf/                             # moved from packages/build/rcf; chain lives with umbrella
      README.md                        # rewritten for umbrella install story
    core/                              # private:true (name kept as @stravica-ai/rcf-lite-core for import-path stability)
      package.json                     # + private: true; publishConfig / files removed
    # define/                          # slot for rcf-define-lite (not created)
```

Notes on the layout:

- The `packages/build` directory renames to `packages/rcf-lite`. Path rename is git-mv (uses `git mv` so history follows).
- The `packages/verify` directory is DELETED after its src moves into the umbrella (per R3).
- Umbrella keeps a `bin/rcf-verify.js` alias; NOT a re-export of an external package, a direct dispatch shim into the same verify handlers.
- Core stays as a workspace package (`packages/core`), but marked `private: true`. Import path `@stravica-ai/rcf-lite-core/...` is preserved to keep the umbrella's existing imports unchanged; the workspace resolves it via symlink in dev, the bundler inlines it at publish time.
- Publish workflow (`.github/workflows/publish.yml`) collapses to one route (`v*` or `rcf-lite-v*`), one package dir, one OIDC binding.
- CI workflow (`.github/workflows/ci.yml`) updates `working-directory: packages/build` → `packages/rcf-lite`.

## Migration steps

Sequential in one PR (or two — see R5). Each step MUST leave the workspace green (`pnpm test`, `rcf validate`, `rcf coverage --strict`).

1. `git mv packages/build packages/rcf-lite`. Update pnpm-workspace.yaml (`packages/*` glob covers it; no change needed there). Rename inside package.json: `name` (per R1), `homepage/bugs/repository.directory`. Bump version to lockstep target (R5b: `0.7.1`).
2. Move `packages/verify/src/*` → `packages/rcf-lite/src/verify/`. Move `packages/verify/bin/rcf-verify.js` → `packages/rcf-lite/bin/rcf-verify.js`. Rewire its imports to the new relative paths.
3. Add `rcf verify` subcommand to `packages/rcf-lite/bin/rcf.js`: dispatch on the first arg after `verify` to the same handlers the alias bin uses. Update RCF chain: new REQ (or amended verify REQ), matching US / AC, TC bindings, build-queue entry. `rcf coverage --strict` green.
4. Delete `packages/verify` entirely.
5. Set `"private": true` on `packages/core/package.json`. Remove its `publishConfig`, `files`, `keywords` (schemas-only fields). Keep `name` as `@stravica-ai/rcf-lite-core` so imports remain stable.
6. Set umbrella's `@stravica-ai/rcf-schemas` dependency to exact `"0.4.2"` (already done in this proposal-PR's minimal prep). Add doctrine note in CONTRIBUTING.md: schemas pin is exact, reviewed every release.
7. Wire the R2 bundler. Add `prepublishOnly` script that produces `dist/` with all workspace deps inlined. Update `files` to ship `dist/` (and `bin`, `guidance`, `README`, `LICENSE`, `CHANGELOG`, `rcf/` if the chain ships).
8. Add workspace-slot comment for `rcf-define-lite` in `pnpm-workspace.yaml` (already done in this proposal-PR's minimal prep).
9. Rewrite root README, umbrella README, install docs, CONTRIBUTING for the new install story.
10. Update `.github/workflows/publish.yml`: single tag prefix (`v*` or `rcf-lite-v*`), single package dir, single OIDC binding. Delete `build-v*` / `verify-v*` / `core-v*` routes.
11. Update `.github/workflows/ci.yml`: `working-directory: packages/build` → `packages/rcf-lite`.
12. Local acceptance (mandatory, per R2): `pnpm pack` from `packages/rcf-lite`; `mkdir /tmp/rcf-lite-smoke && cd /tmp/rcf-lite-smoke && npm init -y && npm install /path/to/rcf-lite-0.7.1.tgz`; `npx rcf --help` + `npx rcf verify --help` + `npx rcf-verify --help` + `npx rcf init` in a scratch project. Every command must succeed; every command must resolve exclusively from the installed tarball (no workspace symlinks in the resolved paths).
13. Re-register the trusted-publisher (OIDC) binding under the new package name. Baz-owned action; runbook lists the exact steps.

## What lands in this proposal PR (minimal, non-locking)

Only changes that stand on their own regardless of the ruling outcomes:

- `docs/2026-08-06_packaging-consolidation-proposal.md` (this doc).
- `docs/2026-08-06_packaging-registry-runbook.md` (the runbook — executed at release time only, ZERO npm actions until Baz gives the go and the migration PR has landed).
- `pnpm-workspace.yaml`: add commented placeholder line for a future `packages/define/` slot (`rcf-define-lite`). No package created.
- `packages/build/package.json` and `packages/core/package.json`: pin `@stravica-ai/rcf-schemas` from `^0.4.2` to exact `0.4.2`. This closes the schemas version-skew surface today and matches the doctrine ruled above (schemas standalone → umbrella exact-pins).

Nothing else. No renames, no bin moves, no `private:true` flips, no publish-workflow rewrites, no verify collapse — all of those wait on the R1/R5 ruling and land in the migration PR.

## Registry runbook

See `docs/2026-08-06_packaging-registry-runbook.md` (companion doc in this PR). Runbook is a spec for what happens at release time, not something the PR itself executes. Zero npm registry actions until Baz gives the go.

## Notes on chain compliance

This repo dogfoods RCF; every behaviour change updates the RCF chain in `packages/build/rcf/`. Packaging changes are non-behavioural per CONTRIBUTING.md ("Pure refactors, test-only changes and documentation fixes do not need artefact updates"). The proposal + runbook + minimal prep in THIS PR fall under that clause.

The MIGRATION PR (when it lands) has a mixed shape:

- Rename / bin move / `private:true` flips / bundler wiring / publish-workflow rewrite: non-behavioural refactor. No chain updates.
- New `rcf verify` subcommand (R3): IS a CLI surface change. MUST include matching chain updates in the same PR — new / amended REQ, US, AC, TC, build-queue entry. `rcf coverage --strict` green.

The migration PR body confirms which changes are refactor and which trigger the chain updates.

## Open questions to Baz

Ruling items R1 (registry name) and R5 (release-train sequencing). Everything else is either ruled, ratified, or engineering-detail carried by Dave at PR review.

Timing sub-question inside R5: (a) packaging PR lands before 0.8.0 slug-train work begins so 0.8.0 tracks land on the new name from the start; (b) 0.8.0 ships on the current names, packaging as a 0.9.0 rename. Above assumes (a) under R5b. If (b) reads better, sequence flips and 0.7.x tracks stay under the current names.
