# RCF document model

One page per document type, the reference rule that keeps the tree drift-proof, and where the files live. Field-level detail is in the per-schema reference pages shipped with the `@stravica-ai/rcf-schemas` package (its `docs/` directory).

## The types

**PRD (Product Requirements Document).** The root statement of product intent: the problem, who has it, what the product changes, what is out of scope. One per project. Everything else in the requirements chain descends from it.

**REQ (Requirement).** One testable capability the product must have, with a category, a priority and a rationale. Each REQ references its PRD. A REQ that cannot be verified by tests is a symptom of a REQ that needs splitting or sharpening.

**US (User story).** A story under a requirement: `asA` / `iWant` / `soThat`, plus the acceptance criteria that define done. Each US references its REQ, and may reference the TACs it touches.

**AC (Acceptance criterion).** An observable, testable statement of done, in given / when / then form, carried inline in its user story's `acceptanceCriteria` array. ACs are the currency of the whole framework: work is scoped to ACs, coverage is measured per AC, and tests point at ACs.

**TAC (Technical architecture component).** A lasting component of the system: its purpose, responsibilities, interfaces and dependencies. Each TAC references the TAD.

**ADR (Architecture decision record).** One consequential decision: the context, the decision, the consequences, and the alternatives considered with the reason each was not chosen. Each ADR references the TAD.

**TAD (Technical Architecture Document).** The architecture root: a shell for cross-cutting sections, with TACs and ADRs as its children. One per project.

**BS (Build Sequence).** The planning root: how the work is ordered and under what strategy and philosophy. One per project.

**FBS (Functional Build Specification).** One work item: a coherent slice of delivery scoped to a set of AC ids, with a build order, dependencies on other FBS items, sizing and an execution status. The FBS queue is what `rcf build` drives.

**TS (Test Suite).** The specification of what test cases exist for one or more acceptance criteria on a single user story, at a named test level.

**TC (Test Case).** One test: which AC it verifies, where the executable test lives (its test pointer), and its status.

**CN (Code Node).** The spec-to-code bridge: a working-tree source path, optionally `#symbol`-suffixed, that implements one or more acceptance criteria (`implementsAcIds`, which may be empty - an orphan CN is a legitimate state for utilities and glue code). `rcf validate` checks every CN's path/symbol against the working tree, so a rename or deletion that leaves the pointer dangling is caught the same way a broken spec-side reference is. Author CNs during Stage 2 of the build cycle (see below), not after: `rcf build --mark complete` refuses when an in-scope acceptance criterion has none. Full detail, including the honest limits, is `docs/code-nodes.md` in the rcf-build-lite repo.

## Edges live on the child

Every reference points upward from child to parent: a REQ carries its `prdId`, a US its `reqId`, a TAC its `tadId`, an FBS its `bsId`. Parents never hold lists of their children. The walker computes the downward maps at load time by inverting the child references. This is deliberate drift-proofing: adding, moving or deleting a document touches exactly one file, so parent documents cannot go stale and two files cannot disagree about the same edge.

## Files on disk

The tree lives under `rcf/` in the project root. `rcf/manifest.json` declares the three root documents (PRD, TAD, BS); every other document is discovered by walking from the roots. Roots are single files (`prd.json`, `tad.json`, `build-sequence.json`); collections are directories (`requirements/`, `user-stories/`, `tacs/`, `adrs/`, `fbs/`, `test-suites/`). ACs live inside their US file; TCs live inside their TS file.

## Field-level reference

This page is the shape of the model, not the schema. For required fields, enums, id patterns and the file-layout contract, read the per-schema pages in `@stravica-ai/rcf-schemas`: one page per document type, plus `id-conventions.md` and `file-layout.md` for the cross-cutting rules.

---

Canonical reference: https://stravica.ai/rcf-methodology/document-model
