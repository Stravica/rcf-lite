# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0, breaking changes are signalled by a minor version bump.

## [0.3.0] - 2026-07-31

Additive minor. Ships the core-side surface of the 0.7.0 release train alongside `@stravica-ai/rcf-schemas@0.4.0`: seed pattern sets, the baseline-AC catalog, and the register-canary fixture pack (all data-only, single sources of truth) consumed by `@stravica-ai/rcf-build-lite@0.6.x -> 0.7.x` and `@stravica-ai/rcf-verify-lite`. Walker unchanged in shape; the new manifest / FBS / REQ / US / TS fields land on `tree.*` verbatim because the whole document is already surfaced. No breaking changes; pure superset of 0.2.0's surface.

### Added

- **`@stravica-ai/rcf-lite-core/patterns/ui-shapes`.** The UI seed pattern set (`UI_SEED_PATTERNS_V1`) plus `UI_EXCLUDED_PHRASES` and a `matchUiSignals(text)` helper that returns matches with per-category provenance in document order. Single source of truth for build's UI-bearing FBS classifier (Track B `ui-design-gate-0.7.0-spec` §4.3) AND, via `req-shapes.js`, the Track C+D REQ-shape classifier's `webUi` shape (`elicitation-and-playbook-hardening-0.7.0-spec` §4.3). Sentences containing an excluded phrase (`API endpoint`, `CLI command`, `shell prompt`, `JSON response`) have their signals suppressed per spec.
- **`@stravica-ai/rcf-lite-core/patterns/req-shapes`.** The five-shape REQ classifier pattern set (`REQ_SHAPE_PATTERNS_V1`: `webUi | httpApi | auth | persistence | notifications`), plus `SHAPE_KEYS` / `SHAPE_KEYS_WITH_NONE` and a `matchReqShapeSignals(text)` helper. The `webUi` shape is composed from `UI_SEED_PATTERNS_V1` so a UI signal is defined once and reused across build's UI-bearing FBS classifier, Track C+D's REQ classifier, and Track B's browser-verification invariants.
- **`@stravica-ai/rcf-lite-core/patterns/register-canary`.** The five graded dimensions (`internalRuleCitation`, `unglossedJargon`, `redundantPermissionAsk`, `bypassOffer`, `wordCountBudget`), each with pattern data and an `evaluate(context)` function; plus `gradeResponse(context)` that aggregates every dimension and collapses to a single verdict. Default word-count budget is 200. Consumed by build's release-time canary runner (Track D `elicitation-and-playbook-hardening-0.7.0-spec` §7.2).
- **`@stravica-ai/rcf-lite-core/fixtures/register-canary/*.json`.** Three v1 fixtures for the release-time canary: `canary-prompt-01` (the 0.5.1 first-response scenario, verbatim from spec §7.3), `canary-prompt-02` (mid-build bug report, exercising the `bypassOffer` grep), `canary-prompt-03` (PRD-supplied `briefStrong` intake scenario). Each fixture ships as JSON with the full contract (`id`, `operatorPrompt`, `supportingArtefacts`, `grantedPermissions`, `wordCountBudget`, `notes`) so build's runner loads them without adapter code.
- **`@stravica-ai/rcf-lite-core/baseline-catalog`.** Five REQ-shape baseline sets (`BASELINE_CATALOG_V1`: `webUi` × 6, `httpApi` × 4, `auth` × 4, `persistence` × 3, `notifications` × 3) transcribed verbatim from `elicitation-and-playbook-hardening-0.7.0-spec` §5.2. Each entry carries `baselineKey` (unique across shapes), `canonicalText` (load-bearing verbatim spec sentence), mechanically-split `given` / `when` / `then`, `notes` (verbatim trailing commentary from spec, when present), `testable: true`. Helpers: `getBaselineSet(shape)`, `getBaselineEntry(baselineKey)`, `iterateBaselineEntries()`. Consumed by build's Track C+D injection mechanism (spec §5.3); every AC written into a US as `provenance.authoredBy: baseline` sources its text from this catalog.
- **Package exports.** New subpaths: `./patterns/ui-shapes`, `./patterns/req-shapes`, `./patterns/register-canary`, `./baseline-catalog`, `./fixtures/register-canary/*` (glob export for the fixture JSON files).

### Changed

- **Bumped `@stravica-ai/rcf-schemas` dependency to `^0.4.0`.** The schemas package's `0.4.0` release adds every additive field the 0.7.0 train needs: manifest gains `preFlightConfig[]`, `reviewAudit[]`, `testCommand`, `uiBaseline`, `browserVerification[]`, `uiBaselineHistory[]`, `baselineAcOptOuts[]`, `intakeClassification`, `registerCanary[]`, `reviewSurface`; FBS gains `dependsOnServices[]`, `uiBearing`, `uiClassification`, `designStage`, `designStageComplete`; REQ gains `shapeClassification`; AC gains `provenance`; TC gains `runtimeProvenance`. Every field is optional at schema level so pre-0.7.0 chains still validate; walker surfaces each field verbatim because it already loads whole documents.
- **Walker surface.** `walkTree` output continues to expose the whole `manifest` document on `tree.manifest`, the whole FBS on `tree.fbsItems[i]`, and so on; no shape change was required to surface the new 0.4.0 fields. A dedicated test suite (`test/store/walker-0-7-0-fields.test.js`) proves every new field appears on tree output after a valid write, including one guard test that asserts NO `fbsUiBearing` or `serviceAttestations` derivation has leaked into core (both belong to verify's chain reader per Track B §11.2 and the twin-wording clarification for Track A).

### Consumers

- Enables `@stravica-ai/rcf-build-lite`'s next minor (Tracks A / B / C+D build-side verbs and playbooks; the 0.7.0 build car composes on the pattern sets, fixture pack, and baseline catalog shipped here) and `@stravica-ai/rcf-verify-lite`'s next minor (the verify car reads the new manifest / FBS / AC / TC fields via `walkTree` and does its own AC flattening plus `fbsUiBearing` / `serviceAttestations` derivation in its chain reader).

## [0.2.0] - 2026-07-29

Additive minor. New store surface for test-pointer resolution and id normalisation (the substrate underneath `rcf-build-lite@0.5.x`'s resolution-gated coverage and `globallyUniqueIds` validate rule), plus id-allocator and case-only filename collision fixes. No breaking changes; pure superset of 0.1.0's surface.

### Added

- **`@stravica-ai/rcf-lite-core/store/tp-resolve`.** Test-pointer working-tree resolution, the test-axis twin of `cn-resolve`: `resolveTestPointers({ projectRoot, tree })` checks every Test Case's `testPointer` (`filePath::testName`) against the checked-out working tree (file exists, plus a declaration-anchor regex finds the named test) and returns a per-TC resolution map for coverage to consume. Deterministic by construction: no test execution, no parsing beyond regex. Anchors are a per-language table (JS/TS ships: `test` / `it` / `describe` with modifier chains, all three quote styles); adding a language is one entry. Also exports `splitTestPointer` and `testCaseKey`. Honest limit, same as the CN check: a renamed test is caught, a gutted-but-same-named test is not.

### Changed

- **`testPointer` required on every Test Case (validator strictness overlay).** The validator registers the published `test-suite.schema.json` with `testPointer` added to the test-case `required` set (`minLength` 1). This is the single documented divergence from the published `@stravica-ai/rcf-schemas` bundle, a pure tightening pending the upstream schema making the field required. `createDocument` for `tc` refuses up front with a usage error when no `testPointer` is supplied.

- **`globallyUniqueIds` walker rule.** Duplicate ids are now a `duplicateId` error, not a silent collapse. Before this, the store had no duplicate detection anywhere: `tree.byId` was last-write-wins, `collectAllAcIds()` folded colliding acceptance criteria into one Set entry, and a tree carrying two documents at one id validated perfectly clean. Ids are unique **globally** across the whole tree (`tree.byId` is one flat map and `pathForId()` resolves any id from its prefix alone, so an id is an address), covering standalone documents, inline acceptance criteria and inline test cases. Each colliding location gets its own error naming the id, every claiming file and the exact field.
- **`@stravica-ai/rcf-lite-core/store/ids`.** `normaliseId` / `sameId` / `idNumber`: the single definition of id identity shared by the walker's uniqueness rule and the writer's allocator. The schema id patterns admit a variable-width numeric run (`^REQ-\d{3,}$`), so `REQ-001` and `REQ-0001` are both legal and both name requirement 1. Normalisation strips leading zeros per all-digit segment; non-numeric segments (test-case slugs such as `step02`) are left alone.
- **`duplicateId` error kind.** Distinct from `validation` (each document is individually schema-clean) and from `brokenReference` (nothing dangles; the graph is over-connected, not under-connected).

### Fixed

- **The id allocator no longer hands out taken ids** ([w-2026-07-28-017]). `nextIdForKind` read only the id each document *declared*, so a file filed as `req-002.json` while declaring `"reqId": "REQ-001"` left `REQ-002` invisible and the allocator re-issued it over the existing file. Occupancy is now the union of declared ids, filed ids and the ids of schema-invalid documents. User-story allocation grouped on an exact `reqId` **string**, so a story under `REQ-0001` was invisible when allocating for `REQ-001` and `US-101` was issued a second time on top of itself; the group is now matched numerically. Acceptance-criterion allocation likewise compares group numbers rather than digit strings.
- **Case-only filename collisions are reported instead of absorbed.** Document ids are derived by upper-casing the filename stem, so on a case-sensitive filesystem `REQ-001.json` and `req-001.json` both resolve to `REQ-001` and the second silently overwrote the first in `byId`. The first file on disk now wins and the collision surfaces as a `duplicateId` error.
- **Uniqueness is part of the post-write gate**, so a write verb refuses to *introduce* a duplicate id while a tree that already carries duplicates stays repairable in-tool (B5 semantics unchanged).

### Consumers

- Enables `@stravica-ai/rcf-build-lite@0.5.x`'s resolution-gated coverage (`resolveTestPointers`, `testCaseKey`) and `rcf validate` `globallyUniqueIds` rule (`normaliseId`, `sameId`, `idNumber`). Build-lite 0.5.0 was published against 0.1.0 and is DOA (fails at ESM link with `does not provide an export named 'testCaseKey'`); 0.5.1 lifts its `@stravica-ai/rcf-lite-core` dep range to `^0.2.0` and is the recommended install.

## [0.1.0] - 2026-07-22

First publish. The shared substrate for the RCF Lite tooling suite, extracted from `@stravica-ai/rcf-build-lite` so that build and verify read and write the same RCF chain and speak the same MCP protocol shell.

### Added

- **`@stravica-ai/rcf-lite-core/store`** — the RCF-chain store (read + write) for the on-disk document chain, extracted from build-lite ([#47](https://github.com/Stravica/rcf-lite/pull/47)).
- **`@stravica-ai/rcf-lite-core/errors`** — the structured `RcfError` type shared across the suite ([#47](https://github.com/Stravica/rcf-lite/pull/47)).
- **`@stravica-ai/rcf-lite-core/mcp-shell`** — the RCF-agnostic MCP protocol shell both tools mount their toolsets on ([#47](https://github.com/Stravica/rcf-lite/pull/47)).
- **`@stravica-ai/rcf-lite-core/isolation`** — the §7.3 verifier isolation-env recipe: the environment a fresh-context `rcf-verify` subprocess is spawned under, so it starts cold with zero build context ([#48](https://github.com/Stravica/rcf-lite/pull/48)).
