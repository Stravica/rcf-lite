# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0, breaking changes are signalled by a minor version bump.

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

[0.2.0]: https://github.com/Stravica/rcf-build-lite/releases/tag/v0.2.0
[0.1.0]: https://github.com/Stravica/rcf-build-lite/releases/tag/v0.1.0
