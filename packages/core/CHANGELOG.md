# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0, breaking changes are signalled by a minor version bump.

## [Unreleased]

### Added

- **`globallyUniqueIds` walker rule.** Duplicate ids are now a `duplicateId` error, not a silent collapse. Before this, the store had no duplicate detection anywhere: `tree.byId` was last-write-wins, `collectAllAcIds()` folded colliding acceptance criteria into one Set entry, and a tree carrying two documents at one id validated perfectly clean. Ids are unique **globally** across the whole tree (`tree.byId` is one flat map and `pathForId()` resolves any id from its prefix alone, so an id is an address), covering standalone documents, inline acceptance criteria and inline test cases. Each colliding location gets its own error naming the id, every claiming file and the exact field.
- **`@stravica-ai/rcf-lite-core/store/ids`.** `normaliseId` / `sameId` / `idNumber`: the single definition of id identity shared by the walker's uniqueness rule and the writer's allocator. The schema id patterns admit a variable-width numeric run (`^REQ-\d{3,}$`), so `REQ-001` and `REQ-0001` are both legal and both name requirement 1. Normalisation strips leading zeros per all-digit segment; non-numeric segments (test-case slugs such as `step02`) are left alone.
- **`duplicateId` error kind.** Distinct from `validation` (each document is individually schema-clean) and from `brokenReference` (nothing dangles; the graph is over-connected, not under-connected).

### Fixed

- **The id allocator no longer hands out taken ids** ([w-2026-07-28-017]). `nextIdForKind` read only the id each document *declared*, so a file filed as `req-002.json` while declaring `"reqId": "REQ-001"` left `REQ-002` invisible and the allocator re-issued it over the existing file. Occupancy is now the union of declared ids, filed ids and the ids of schema-invalid documents. User-story allocation grouped on an exact `reqId` **string**, so a story under `REQ-0001` was invisible when allocating for `REQ-001` and `US-101` was issued a second time on top of itself; the group is now matched numerically. Acceptance-criterion allocation likewise compares group numbers rather than digit strings.
- **Case-only filename collisions are reported instead of absorbed.** Document ids are derived by upper-casing the filename stem, so on a case-sensitive filesystem `REQ-001.json` and `req-001.json` both resolve to `REQ-001` and the second silently overwrote the first in `byId`. The first file on disk now wins and the collision surfaces as a `duplicateId` error.
- **Uniqueness is part of the post-write gate**, so a write verb refuses to *introduce* a duplicate id while a tree that already carries duplicates stays repairable in-tool (B5 semantics unchanged).

## [0.1.0] - 2026-07-22

First publish. The shared substrate for the RCF Lite tooling suite, extracted from `@stravica-ai/rcf-build-lite` so that build and verify read and write the same RCF chain and speak the same MCP protocol shell.

### Added

- **`@stravica-ai/rcf-lite-core/store`** — the RCF-chain store (read + write) for the on-disk document chain, extracted from build-lite ([#47](https://github.com/Stravica/rcf-lite/pull/47)).
- **`@stravica-ai/rcf-lite-core/errors`** — the structured `RcfError` type shared across the suite ([#47](https://github.com/Stravica/rcf-lite/pull/47)).
- **`@stravica-ai/rcf-lite-core/mcp-shell`** — the RCF-agnostic MCP protocol shell both tools mount their toolsets on ([#47](https://github.com/Stravica/rcf-lite/pull/47)).
- **`@stravica-ai/rcf-lite-core/isolation`** — the §7.3 verifier isolation-env recipe: the environment a fresh-context `rcf-verify` subprocess is spawned under, so it starts cold with zero build context ([#48](https://github.com/Stravica/rcf-lite/pull/48)).
