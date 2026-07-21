# Code Nodes: the spec-to-code bridge

## 1. Read this if

You want to know what a Code Node is, how it keeps the spec-to-code link honest, and - just as importantly - what it deliberately cannot detect. Written for the same two audiences as [how-it-works.md](how-it-works.md): the human deciding whether to trust the method, and the agent authoring or maintaining Code Nodes as part of a build cycle.

## 2. The problem this solves

RCF's spec-side chain (PRD -> REQ -> US -> AC -> TS -> TC) is a closed graph: every id resolves to a document `rcf validate` has loaded, so a broken link is mechanically detectable. Source code sat outside that graph. A test case's `testPointer` was a free-text string the walker could not follow; nothing connected an acceptance criterion to the file that actually implements it. A path recorded as a plain string - the sidecar approach - gives you a pointer with no graph node behind it, so a rename or a deletion leaves a dangling reference that nothing checks until something downstream fails.

**Code Nodes make source code a first-class node in the same graph.** The same `rcf validate` that guards the spec graph now also guarantees every code link resolves against the working tree. One graph, one walker, one query surface - extended, not duplicated.

## 3. What a Code Node is

A `CN-*` document is the 11th RCF document kind, alongside PRD/REQ/US/TAD/TAC/ADR/BS/FBS/TS (schema in [`@stravica-ai/rcf-schemas`](https://github.com/Stravica/rcf-schemas)). It lives at `rcf/code-nodes/cn-NNN.json`, same envelope shape (`version`, `status`, `createdAt`, `updatedAt`) as every other kind.

| Field | Meaning |
|---|---|
| `cnId` | `CN-NNN`, flat namespace (no parent - see below) |
| `path` | Repo-relative source path, optionally `#symbol`-suffixed |
| `implementsAcIds` | Acceptance criteria this node satisfies. May be empty. |
| `dependencies` | Other Code Nodes this one depends on (`CN` -> `CN` edges) |

**Identity is the path, not a parent-child slot.** Every other RCF kind sits somewhere in the PRD/REQ/US tree or the BS/FBS queue; a Code Node does not - it is anchored into the spec graph purely through `implementsAcIds`, exactly the way an FBS anchors through `acIds`. `implementsAcIds` MAY be empty: a utility, a piece of glue code, or wiring with no direct spec anchor is a legitimate, common state (reported informationally by `rcf coverage --with-code` as `CN-orphaned`, never an error).

### Granularity: file or symbol

`path` supports two forms:

- **File-level:** `src/store/validator.js` - coarse, but survives an intra-file rename of the function it points at.
- **Symbol-level:** `src/store/validator.js#getAjv` - precise, but trips if that symbol is renamed or moved.

There is no separate `granularity` field: it is derived from the presence of `#`, never stored, so there is no cross-field consistency to police. Authoring guidance: **default to symbol-level for load-bearing nodes** (the precision is worth the rot risk - detection plus a one-field repair makes that risk affordable, see below) and use file-level for coarse "this module serves these ACs" mappings where you don't need per-symbol precision.

## 4. Staleness: the floor

`rcf validate` checks every Code Node's `path` against the working tree:

1. The file must exist (`fileResolves`).
2. If the path carries `#symbol`, a declaration matching that name must be found in the file (`symbolResolves`) - a deterministic scan for `function` / `class` / `const|let|var` / method-at-line-start / object-field declarations. No AST, no execution, no semantic judgement (the same no-LLM boundary the rest of `rcf` holds to).

Either failure is a structured `staleCode` error, **exit 3**, naming the CN and the unresolved path or symbol. The fix is a one-field edit:

```sh
rcf validate --json
# {"kind":"staleCode","rule":"fileResolves","id":"CN-010", ...}
rcf update CN-010 --set path=src/new-location.js#renamedFn
rcf validate
# rcf validate: tree is clean.
```

Large trees, or CI stages that want the split, can skip the staleness pass with `rcf validate --no-code` (spec-graph checks only). The default remains full validation - a floor is only a floor if it runs by default.

## 5. Queries: trace, impact, and CN as a pivot

- **`rcf trace <path>`** and **`rcf trace <path>#symbol`** resolve a source path to its Code Node(s) and trace backward: path -> CN -> AC -> US -> REQ -> PRD. Multiple matches (a file-level CN and a symbol-level CN over the same file) print as separate blocks.
- **`--to-code`** on `trace` and `impact` extends the existing forward fan-out into the code layer (AC -> implementing CN -> transitively dependent CNs). It is opt-in: without the flag, spec-only forward traces are byte-identical to a tree with no Code Nodes at all.
- **A Code Node id is a uniform pivot**, like any other: `rcf trace CN-006 --forward --to-code` walks the dependency blast radius; `rcf impact CN-006` works the same way any other id does.
- **`rcf view`** renders Code Nodes as a distinct cosmetic class in the per-requirement mermaid diagrams, hanging off the ACs they implement.

## 6. Authoring: CRUD verbs

Code Nodes use the same `create` / `update` / `delete` verbs as every other kind:

```sh
rcf create cn --path src/store/validator.js#getAjv --acs AC-701-3
rcf update CN-001 --set path=src/store/validator.js#getAjvBuilt   # repair path, same as any other kind
rcf delete CN-001            # refused while another CN depends on it
rcf delete CN-001 --cascade  # drops the dependency edge from dependents first
```

`create cn` validates `--acs` against known ACs and `--deps` against known Code Nodes before writing (post-write validation gate, same as every other kind).

### `--derive-deps`: an optional dev-time assist

Hand-declaring `dependencies[]` is accurate at symbol level but under-recalls at file level - hand-declared edges routinely miss real ones that static analysis catches. `rcf create cn` / `rcf update cn --derive-deps` shells out to [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser) - **when it is resolvable** (a local install, or `npx --no-install`) - to auto-derive file-level edges and merge them into `dependencies[]` against existing Code Nodes over those files.

`dependency-cruiser` is **never a runtime dependency of `rcf`**: the flag is purely a dev-time convenience. When the tool cannot be resolved, `--derive-deps` fails with a helpful message rather than silently degrading or reaching for the network to install anything:

```sh
rcf create cn --path src/a.js --derive-deps
# [error] usage create cn: --derive-deps: dependency-cruiser is not resolvable
# (no local install, and npx --no-install will not fetch it). Install it as a
# dev dependency in this project to use --derive-deps, or declare --deps by hand.
```

Symbol-level dependency auto-derivation is out of reach for `dependency-cruiser` (it is file-granular only) and stays out of scope for `rcf` - a call-graph tool is a separate, larger investment.

## 7. The mark-complete gate

`rcf build --mark complete` refuses (**exit 3**, structured `missingCodeNodes` error) when any acceptance criterion delivered by the build spec carries no Code Node:

```sh
rcf build FBS-004 --mark complete
# [error] missingCodeNodes build --mark complete: refused - FBS-004 has AC(s)
# with no Code Node: AC-401-2, AC-401-3. Author CN coverage for these ACs, or
# pass --no-code-nodes for a genuinely no-code (docs-only, config-only) spec.
```

This is deliberate, not an oversight: a reliability chain with optional links is not a chain. CN authoring happens at exactly the moment comprehension of the change is already paid for - during the build cycle, not as an afterthought - so the gate asks for work the agent has already done the thinking for.

A build spec that genuinely produces no traceable code (documentation, configuration, a housekeeping PR) declares the exemption once:

```sh
rcf build FBS-009 --mark complete --no-code-nodes
```

This records `noCodeNodes: true` on the FBS document itself (a dedicated schema field - not a free-form convention string, because an unvalidated magic value fails silently on a typo, which is exactly the failure mode this feature exists to make visible). The declaration is sticky: once set, later re-marks of that FBS do not re-trigger the gate.

The gate is deterministic edge counting against the working tree (`tree.cnByAcId`) - no semantic judgement, same no-LLM boundary as everywhere else in `rcf`.

## 8. Coverage: the informational code axis

`rcf coverage --with-code` classifies every acceptance criterion:

| Class | Condition | Meaning |
|---|---|---|
| `implemented-and-covered` | >=1 CN and >=1 TC | healthy |
| `implemented-uncovered` | >=1 CN, 0 TC | code exists, no test yet |
| `unimplemented` | 0 CN | no code claims this AC yet |
| `CN-orphaned` | a CN with empty `implementsAcIds` | reported per CN, not per AC |

**None of these block.** `implemented-uncovered` is a legitimate accepted state; `unimplemented` is normal for an AC nobody has built yet; orphaned Code Nodes (utilities, glue, wiring) are common and fine. `staleCode` is the floor because a dangling pointer is unambiguously wrong and cheap to fix; completeness is not the same kind of thing, and forcing it as a blocking gate here would impose the full authoring burden before it has earned its place. (The mark-complete gate, not coverage, is where CN completeness for a specific build spec is enforced - see above.) These classes are the harness's worklist as much as the operator's: an agent maintaining an RCF tree should treat a growing `unimplemented` backlog, `CN-orphaned` nodes and any `staleCode` failure as work to schedule and repair.

## 9. Honest limits

Every claim below is demonstrated against this repository's own Code Node tree, not asserted:

- **Semantic drift is invisible.** A symbol's declaration surviving intact proves the *name* still exists - not that the code still does what the acceptance criterion says. Gut a function's caching guard while keeping its name and `rcf validate` reports the tree clean. Closing this would mean executing or semantically analysing the body: an LLM or harness layer sitting above `rcf`, deliberately out of scope for a tool that promises zero semantic judgement.
- **Symbol-level Code Nodes rot on rename or move.** This is a real, ongoing maintenance surface - bought off by cheap detection and a one-field repair, not eliminated. If repair friction becomes annoying in practice, the guidance is to drop to file-level for that node and keep symbol-level only for the genuinely load-bearing ones.
- **The anchor scan can false-clean on a name collision.** If a symbol moves to another file while a same-file namesake declaration (same name, unrelated purpose) survives in the original location, the deterministic regex scan reports the symbol present. It has no lexical scope awareness. Rare in practice, but real.
- **File-level Code Nodes are blind to intra-file change.** A symbol renamed, moved, or deleted inside a file that still exists goes undetected by a file-level CN pointed at that file. The precision/rot trade is a per-node authoring choice, not a free lunch.
- **Dependency edges are only as good as their source.** Hand-declared symbol-level edges are error-prone; `--derive-deps` is file-granular only.
- **No symbol-level dependency auto-derivation, no mechanical CN generators (test-coverage-derived, diff-derived), no rename-tracking assist** ship yet. All are real, understood extensions - deliberately deferred, not forgotten.

None of these limits break the core claim: a *competent* refactor - one that renames or moves code and fixes every caller so the code loads and the test suite passes - is precisely the case where a Code Node's dangling pointer is the last remaining evidence of drift, and that case `rcf validate` catches every time.
