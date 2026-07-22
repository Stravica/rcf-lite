# Spec bundle: FBS-001 - Document store core

## 1. Header

- Item: FBS-001 - Document store core
- Queue: order 1, item 1 of 14
- Execution status: complete
- Estimated size: medium
- Estimated hours: 6
- Risk level: low
- Domain: projectStructure
- Parent chain: BS-001 -> PRD-001 (RCF Build Lite)
- Spec last touched: 2026-07-02T10:22:43Z

## 2. Queue and dependency context

- Build sequence: BS-001 - RCF Build Lite initial delivery
- Generation strategy: dependencyFirst
- Build philosophy: Dependency-first. Build the document store, then the read-only view surface, then mutating CRUD, then the query layer, then the build loop, then the MCP surface over everything below. Each layer is usable on its own before the next is added.

Dependencies: none.

Dependents waiting on this item: FBS-002

## 3. The work

Build the document store: id-to-path resolution, JSON parse, schema validation against the registered bundle, persist-after-validate, and a tree walk from the manifest roots.

Approach:

Register the published schema bundle once at start-up. Resolve ids to paths by the recommended layout convention. Make load and save the only filesystem touch points. Return structured errors rather than throwing strings, so every surface can report them consistently.

Deliverables:

- Document store module with load, save and walkTree
- Schema bundle registration at start-up
- Structured error type for validation and reference failures
- Init command that refuses to overwrite an existing project without an explicit force flag

Notes:

Everything else in the build sequence depends on this; keep the public surface small and stable. AC-101-2 (init refuses to overwrite an existing project) is grouped here as init-verb behaviour adjacent to AC-101-1; the spec did not assign it to any FBS in round 1.

## 4. Acceptance criteria

### US-101: Initialise an RCF project on disk (status: draft)

As a project owner starting a new RCF project, I want to run a single initialise command that creates the rcf folder, the manifest and the root document placeholders, so that I have a valid RCF project structure on disk without authoring any layout by hand.

Parent requirement REQ-001: On-disk RCF project structure (functional, priority: must)

> Build Lite initialises and maintains a project's RCF documents on the local filesystem, under a top-level rcf folder, with the project manifest declaring the three root documents (PRD, TAD, Build Sequence) and every other document discovered by walking from the roots. The local files are the single source of truth; no external store mirrors them.
>
> Rationale: The in-repository differentiator depends on RCF documents living beside the code. A predictable on-disk layout is the foundation every other capability reads from and writes to.

#### AC-101-1: Initialise creates the rcf folder and a manifest declaring the three roots

- Given: an empty target directory
- When: the initialise command runs
- Then: an rcf folder exists containing a manifest that declares prd, tad and bs root references and validates against the manifest schema
- Testable: yes

#### AC-101-2: Initialise refuses to overwrite an existing project

- Given: a directory that already contains an rcf manifest
- When: the initialise command runs without an explicit force flag
- Then: the command exits non-zero, makes no changes and reports that a project already exists
- Testable: yes

#### AC-101-3: Every document is discoverable by walking from the roots

- Given: an initialised project with a PRD, a TAD and a Build Sequence
- When: the project is loaded
- Then: all child documents are resolved by reading the parent id lists, with no child enumeration in the manifest
- Testable: yes

## 5. Architectural context

### TAC TAC-001: Document store

Purpose: Own all reads, validation and writes of RCF documents on the local filesystem, and be the only component that touches the rcf tree.

Responsibilities:

- Resolve a document file path from a document id by convention
- Load and parse a document and validate it against its schema
- Walk from the roots to assemble the full in-memory tree
- Persist a document only after it validates
- Surface broken references and schema failures as structured errors

Interfaces:

- loadDocument (function): Resolve an id to a path, parse and validate, return the document or a structured error.
- saveDocument (function): Validate then persist a document; refuse to write if validation fails.
- walkTree (function): From the manifest roots, resolve every child by id and return the full tree.

Dependencies:

- rcf-schemas (external): The published schema package the validator registers at start-up.

Tradeoffs: Centralising all filesystem access in one component costs a small amount of indirection but guarantees that no consumer can write an unvalidated document or bypass the source-of-truth rule.

Notes: The store is intentionally synchronous where possible; a local CLI does not benefit from streaming and synchronous code is easier for contributors to follow.

### ADR ADR-001: Local filesystem is the single source of truth (accepted)

Context: RCF Build Lite must guarantee that a project's RCF documents live in the source repository, beside the code. v1 tooling operated over the GitHub API rather than the local repo, which broke the in-repository differentiator and tied the tool to a network surface.

Decision: Every read and write targets the local rcf tree directly. No external service, cache or database mirrors the documents. The CLI, the MCP server and the build loop all reach the filesystem only through the document store.

Consequences: The tool works offline and stays harness-agnostic. There is no sync problem and no second source to drift. The cost is that any multi-user or hosted scenario is out of scope by construction, which matches the product boundaries.

Alternatives considered:

- GitHub API as source of truth: Read and write documents through the GitHub contents API as v1 did. (not chosen: Breaks the in-repository differentiator, requires network access and hit the API single-file fetch limit on large documents.)
- Local database index: Keep the files but maintain a database index for fast queries. (not chosen: Introduces a second source of truth that can drift; query volumes for a single project do not justify it.)

### ADR ADR-002: Validate against the published schema bundle at boundaries (accepted)

Context: A non-coder cannot catch a malformed RCF document by eye, and an AI agent left unchecked can drift the document shape silently. Validation has to be a property of the tool, not a discipline of the user.

Decision: Register the published @stravica/rcf-schemas bundle once at start-up and validate every document on load and before persist. Refuse to write any document that does not validate.

Consequences: On-disk state is always valid. A small validation cost runs on every operation. The published schema package is the single source of truth for shape; local drift is impossible.

Alternatives considered:

- Local copies of the schemas: Vendor the schemas into the tool repository and validate against the local copy. (not chosen: Allows local copies to drift from the published contract; the whole point of publishing the schemas is that every consumer keys to the same version.)
- Validate only on persist: Skip validation on load to save the cost of validating documents already on disk. (not chosen: Misses drift caused by edits made outside the tool; load validation is what makes broken trees visible to the owner.)

### TAD section: systemOverview

```json
{
  "executiveSummary": "Build Lite is a Node 24 ESM toolset whose core is a set of local filesystem operations over a project's RCF documents. CRUD, query, view, the build loop and the MCP surface are all thin layers over a shared document store that reads and writes the on-disk rcf tree and validates against the published schemas at every boundary.",
  "systemPurpose": "Run the full RCF method over in-repository documents and surface it through deterministic, structured operations for a non-engineering owner and for AI tooling.",
  "architecturalApproach": "Layered. A document-store core owns load, validate and persist. A CLI binary, a view renderer, a query engine, a build adapter and an MCP server are all consumers of that core. No layer reaches the filesystem except through the store.",
  "keyCapabilities": [
    "Filesystem-backed RCF document store with schema validation at boundaries",
    "Deterministic CRUD verbs over every document type",
    "Diagram and HTML rendering of the whole tree",
    "Traceability and query over the chain",
    "Build-specification to implementation-prompt assembly",
    "Local stdio MCP surface over the whole feature set"
  ]
}
```

### TAD section: integrationArchitecture

```json
{
  "apiDesign": "The store exposes a typed-by-convention internal API of document operations. The CLI maps verbs to those operations and renders results for a terminal. The MCP server maps tools to the same operations and returns structured results. No HTTP API is exposed.",
  "eventModel": "None. Operations are synchronous filesystem reads and writes."
}
```

Referenced material (pass-through, verbatim):

- Schemas: manifest.schema.json, prd.schema.json
- External docs: https://ajv.js.org/

## 6. Existing test surface

Presence reporting off the tree, not a coverage verdict (`rcf coverage` is the coverage surface).

- AC-101-1: no existing tests - test suite to be written for this AC
- AC-101-2: no existing tests - test suite to be written for this AC
- AC-101-3: no existing tests - test suite to be written for this AC

## 7. Build-cycle runbook

This bundle is the work order for one pass of the RCF five-stage build
cycle: Define -> Build -> Review -> Test -> Finalise. The tool assembles
and referees; the harness executes. Every stage ends in a commit.

Deep guidance: rcf://docs/build-cycle and the rcf_execute_build_cycle prompt, or guidance/build-cycle-playbook.md in the rcf-build-lite repo.

### Stage 1 - Define

Satisfied by this bundle: the FBS, acceptance criteria, ancestry and
architectural context above ARE the definition. Confirm your plan against
every in-scope acceptance criterion (AC-101-1, AC-101-2, AC-101-3) in section 4 before writing
code, then mark pickup:

    rcf build FBS-001 --mark inProgress

Commit any plan artefacts the driving workflow requires.

### Stage 2 - Build

Implement to the acceptance criteria in section 4 using the architectural
context in section 5. The bundle is the spec: deviation is escalation to
the operator of the loop, not improvisation. As you implement, author or
update Code Nodes for the source you write:

    rcf create cn --path <file>[#symbol] --acs <ac-ids>

Do this now, not as an afterthought: comprehension of which symbols serve
which acceptance criteria is cheapest to capture while you are writing the
code, and Stage 5 refuses completion without it. Commit at stage end.

### Stage 3 - Review

Mechanical referee pass:

    rcf validate

must come back clean; then re-read the diff against every in-scope
acceptance criterion and document any deviations. Commit.

### Stage 4 - Test

Exercise every in-scope acceptance criterion: write or extend the TS / TC
documents (section 6 lists the existing surface and the flagged gaps) and
the tests they point to, until:

    rcf coverage --strict

covers the in-scope acceptance criteria. Commit.

### Stage 5 - Finalise

CI green; PR raised and merged per the driving workflow's convention.
After the merge:

    rcf build FBS-001 --mark complete

This refuses (exit 3, missingCodeNodes) if any in-scope acceptance
criterion still carries no Code Node - go back to Stage 2 and author it,
or, for a genuinely no-code spec (docs-only, config-only), declare:

    rcf build FBS-001 --mark complete --no-code-nodes

Then ship-gate the deployed app - an independent rcf-verify run that
passes with ship authority promotes complete -> verified:

    rcf finalise FBS-001 --url <deploy-url>
