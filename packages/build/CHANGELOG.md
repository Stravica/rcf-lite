# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0, breaking changes are signalled by a minor version bump.

## [Unreleased]

### Added

- **`rcf validate` now fails on duplicate ids** (exit 3, `duplicateId`, rule `globallyUniqueIds`). Previously a tree with colliding ids validated clean, however the collision got there. The check covers standalone documents, inline acceptance criteria and inline test cases, and treats leading-zero spellings as one id (`REQ-001` and `REQ-0001` both name requirement 1, which the schema pattern `^REQ-\d{3,}$` legitimately permits). Every colliding location produces its own error naming the id and each claiming file, so a CI log identifies the whole collision rather than half of it:

  ```
  [error] duplicateId US-101: Duplicate id AC-101-1: claimed by 2 locations: AC-101-1 in
    rcf/user-stories/us-101.json (acceptanceCriteria[0].id), AC-101-1 in
    rcf/user-stories/us-101.json (acceptanceCriteria[1].id).
  ```

  Detection lives in the walker, not the schema: the schema is right to permit variable-width numeric runs, and it is uniqueness *after normalisation* that is being violated. `rcf validate --json` carries the same issue under `kind: "duplicateId"`.

## [0.4.0] - 2026-07-22

Hardens the `verified` state so it can only be reached through the independent ship gate. Two changes close bypasses that let a builder write `verified` without a passing, ship-authoritative `rcf-verify` run, plus one documented contract-field rename. No new features; behaviour and one JSON contract key change, so this is a minor bump under the pre-1.0 breaking-is-minor convention.

### Changed

- **`rcf build <fbs-id> --mark verified` is now refused** ([#53](https://github.com/Stravica/rcf-lite/pull/53)): the `--mark` ladder caps at `complete`. Previously any forward lifecycle jump was legal, so `--mark verified` promoted `complete → verified` with no verify run at all — a one-flag bypass of the finalise gate's independence guarantee (spec §9). `--mark verified` now exits 4 (the mark-refusal family), writes nothing, and points to `rcf finalise`. `verified` is written only by the finalise gate, or by the sanctioned explicit override `rcf update <fbs-id> --set executionStatus=verified` (unchanged). **Migration:** anywhere you scripted `rcf build <id> --mark verified`, switch to `rcf finalise <id> --url <deploy-url>` (the ship gate) or, for a deliberate manual override with no verify run, `rcf update <id> --set executionStatus=verified`.
- **`rcf finalise` now gates on ship authority, not just exit code** ([#53](https://github.com/Stravica/rcf-lite/pull/53)): promotion to `verified` previously required only that the spawned `rcf-verify` subprocess exit 0, so a correctness-only pass (e.g. a bare `--profile ci` run) could write `verified`. Promotion now additionally requires the ingested report's `verdictAuthority === 'ship'` (spec §4) — a `deployed`-profile run, or a `ci`/`local-dev` run with `--parity-env`. A passing non-ship run, or an unreadable report on a pass, produces a clean explicit **HOLD** (state unchanged, exit 4), never a silent promotion and never an error. Re-verify of an already-verified item is unchanged.
- **`completionContract.markVerified` renamed to `completionContract.finalise`** ([#53](https://github.com/Stravica/rcf-lite/pull/53)): the JSON build bundle (`rcf build --format json`) and the MCP `rcf_build` result emit a `completionContract` object. Its `markVerified` key — which carried a `rcf build … --mark verified` command that is now refused — is renamed to `finalise` and carries `rcf finalise <id> --url <deploy-url>`. **This is a breaking change for any consumer that reads `completionContract.markVerified` from the JSON/MCP output** (the MCP `BUILD_OUTPUT_SCHEMA` `required` list changed to match). Read `completionContract.finalise` instead. The Stage-5 markdown runbook and the guidance pack (`build-cycle.md`, `build-cycle-playbook.md`, `getting-started.md`) are reworded to route ship through `rcf finalise`.

### Documentation

- **README consumability pass** ([#52](https://github.com/Stravica/rcf-lite/pull/52)): the build README was rewritten for a consumer landing on the npm package page cold — what the package is, install, first commands, and where the docs live.

## [0.3.0] - 2026-07-22

Deploy-aware, runtime-honest build guidance (Tier-1 hardening, REQ-008) plus the `rcf finalise` ship gate that hands the final verdict to an independent `rcf-verify` run. First release published from the `Stravica/rcf-lite` monorepo, and the first release to depend on the extracted `@stravica-ai/rcf-lite-core` package.

### Added

- **`rcf finalise <fbs-id> --url <deploy-url>` — the finalise gate** ([#50](https://github.com/Stravica/rcf-lite/pull/50)): promotes an FBS from `complete` to `verified` only when an independent `rcf-verify` run against the deployed app passes. `rcf-verify` is spawned as a **fresh OS subprocess** (never imported in-process) under `@stravica-ai/rcf-lite-core`'s isolation env (§7.3), so the verifier agent starts cold with zero build context. Exit code is the gate (0 → promote, non-zero → FBS left unchanged and findings surfaced); findings flow via a chain-node-addressed `--out` report file, not stdout scraping. Install-together posture (§8.3): if `rcf-verify` is absent, `finalise` prompts to install it on an interactive TTY or accepts an explicit `--install-verify` flag off a TTY — it never silently skips the gate and never silently auto-installs.

### Changed

- **Tier-1 hardening — deploy-aware, runtime-honest build guidance** ([#42](https://github.com/Stravica/rcf-lite/pull/42), REQ-008): closes the persona-programme root cause where the deploy runtime was absent from the tool's elicitation and verification loop. Elicitation now establishes the deploy target early (before any stack is committed), constrains the stack to what the target can host, captures the choice as an ADR, and includes a jargon-free hosting-choice walkthrough with honest account-holder-step isolation. The build cycle makes a working **local preview** the hosting-independent definition-of-done, requires **runtime-provenance labels** on every verified/tested claim (Cloudflare and non-Cloudflare worked examples, aligned with the deployed/ci/local-dev profile model), and adds an interim fresh-context self-review scoped honestly away from the independent gate. `harness-template.md` gains hard fragment RULE 5 (no stack before deploy target), RULE 6 (every build lands a local preview) and RULE 7 (verification claims name their runtime). Guidance, spec (US-801..805, 20 ACs, ADR-006..009, FBS-013/014) and drift-test changes only — no runtime CLI behaviour change.

### Repository

- **Repo renamed `rcf-build-lite` → `rcf-lite` (2026-07-21).** The GitHub repository was renamed and restructured into a pnpm-workspace monorepo, with this package relocated to `packages/build/`. The **published package name is unchanged** — it remains `@stravica-ai/rcf-build-lite` — and its npm provenance / trusted-publisher binding are preserved. Old `Stravica/rcf-build-lite` URLs redirect to `Stravica/rcf-lite` indefinitely; do not re-create a repo at the old name.

### Dependencies

- Now depends on **`@stravica-ai/rcf-lite-core`** (first published at `0.1.0` alongside this release) for the shared RCF-chain store, `RcfError` type, MCP protocol shell, and verifier isolation env. Previously-bundled internals were extracted into that package; consumers install it transitively.

## [0.2.1] - 2026-07-18

`rcf init` UX pass and agent-guidance hardening from the v0.2.0 manual-test review. No schema, runtime-API or dependency changes.

### Changed

- **`rcf init` is a bootstrap, not an elicitation session** ([#38](https://github.com/Stravica/rcf-build-lite/pull/38)): interactive init now prompts only for the project name and seeds a fully-placeholder tree identical to the non-interactive path (the early requirement-title, story-title and problem-statement prompts are dropped; the agent elicits them once the session starts). Completion output is a high-level summary — document chain / MCP server / agent instructions — with a `Next: start your agent session` step, replacing the per-file manifest.
- **Fresh-repo agent setup writes both `CLAUDE.md` and `AGENTS.md`** ([#38](https://github.com/Stravica/rcf-build-lite/pull/38)): vendor-neutral by default. Existing-file routing is unchanged (an existing `CLAUDE.md`, or an existing `AGENTS.md` when no `CLAUDE.md`, is refreshed in place; the other convention's file is not invented), and the marked-block idempotency / init-re-run-exits-0 contract is preserved.
- **Agent guidance pack hardened** ([#39](https://github.com/Stravica/rcf-build-lite/pull/39)): the build-cycle playbook gains whole-queue orchestration (drive `rcf build --next` to `Queue complete`, one write worker at a time, a docs-review gate and a handover protocol), evidence-first PR authoring, and bug-triage-via-acceptance-criterion-first; the elicitation playbook gains scenario-coverage criteria, a thin-vs-adequate AC example, and an elicitation-integrity section. Guidance and docs prose only — no `src/` behaviour change.

## [0.2.0] - 2026-07-10

The spec-to-code bridge (X2): `CN-*` Code Nodes make source code a first-class node in the same graph the spec chain already lives in, so `rcf validate` catches a dangling spec-to-code link the same way it catches a dangling spec-to-spec one.

### Added

- **Code Node document kind** (`CN-*`, `rcf/code-nodes/`), the 11th RCF document type, delivered via [`@stravica-ai/rcf-schemas@0.3.1`](https://github.com/Stravica/rcf-schemas). Identity is a working-tree path, optionally `#symbol`-suffixed; granularity (file vs symbol) is derived, never stored.
- **Staleness detection**: `rcf validate` fails (exit 3, `staleCode`) when a Code Node's path or symbol no longer resolves against the working tree; `--no-code` skips the pass.
- **Queries**: `rcf trace <path>` and `rcf trace <path>#symbol` walk backward from source to the requirements it serves; `--to-code` on `trace` / `impact` extends the forward fan-out into implementing and dependent Code Nodes; a Code Node id is a uniform pivot like any other. `rcf view` renders Code Nodes as a distinct cosmetic class.
- **CRUD**: `rcf create/update/delete cn`, mirroring the existing writer patterns; delete refused while another Code Node depends on it; post-write validation as with every other kind. `--derive-deps` optionally shells out to `dependency-cruiser` for file-level dependency auto-derivation - a dev-time-only assist, never a runtime dependency.
- **The mark-complete gate**: `rcf build --mark complete` refuses (exit 3, `missingCodeNodes`) when any acceptance criterion of the completed build spec carries no Code Node; `--no-code-nodes` declares a genuinely no-code (docs-only, config-only) spec, recorded on the FBS.
- **`rcf coverage --with-code`**: informational four-class code axis per acceptance criterion (`implemented-and-covered` / `implemented-uncovered` / `unimplemented` / `CN-orphaned`), never blocking.
- **MCP adapter**: `rcf_create` accepts kind `cn`; `rcf_trace` / `rcf_impact` gain `toCode` and path-mode; `rcf_coverage` gains `withCode`; `rcf_validate` gains `noCode`.
- **Guidance pack + build bundle**: the five-stage runbook and the build-cycle guidance now direct CN authoring during Stage 2 (Build) and name the Stage 5 gate.
- **Docs**: `docs/code-nodes.md` - the concept, authoring guidance, and an explicit honest-limits section (semantic drift, symbol rot, namesake false-cleans).
- **Full-tree dogfood**: every acceptance criterion in this repository's own tree carries a Code Node (29 nodes; the REQ-007 validation chain re-authored through the real CRUD verbs first, then extended tree-wide).

### Changed

- `@stravica-ai/rcf-schemas` dependency bumped `^0.2.1` -> `^0.3.1`.

## [0.1.0] - 2026-07-08

First public release.

### Added

- Schema-validated document chain: every RCF document type (PRD, requirements, user stories, acceptance criteria, TAD, build sequence) lives as JSON in your repository, validated against the [`@stravica-ai/rcf-schemas`](https://github.com/Stravica/rcf-schemas) contract.
- Dogfooded `rcf/` tree: this repository's own PRD, requirements, stories, acceptance criteria, TAD and build queue, built and maintained with the tool itself.
- `rcf view`: live HTML rendering of the full document graph in the browser.
- Unified `rcf` CLI with full create, read, update and delete coverage across the document chain.
- Traceability queries: coverage, trace forward and back through the chain, and impact analysis from any node.
- `rcf build`: SDD adapter that turns the build queue into staged, executable spec bundles.
- `rcf mcp`: MCP server exposing the toolset to coding agents, backed by the agent guidance pack in `guidance/`.
- Documentation set: install, getting started, how it works, and why it exists, under `docs/`.

[0.4.0]: https://github.com/Stravica/rcf-lite/releases/tag/build-v0.4.0
[0.3.0]: https://github.com/Stravica/rcf-lite/releases/tag/v0.3.0
[0.2.1]: https://github.com/Stravica/rcf-build-lite/releases/tag/v0.2.1
[0.2.0]: https://github.com/Stravica/rcf-build-lite/releases/tag/v0.2.0
[0.1.0]: https://github.com/Stravica/rcf-build-lite/releases/tag/v0.1.0
