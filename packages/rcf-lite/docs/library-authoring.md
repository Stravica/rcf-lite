# External blueprint library authoring standard

Companion to `blueprint-authoring.md` and `blueprint-authoring-checklist.md`. Those cover authoring an INDIVIDUAL blueprint against the core shelf; this covers packaging one or more blueprints into an external LIBRARY that other projects can register and apply.

If you have never authored a blueprint, read `blueprint-authoring.md` first. A library is a container over blueprints that are individually valid against the phase-1 authoring standard; nothing about the individual blueprint shape changes when you drop it inside a library. The value of the library layer is trust boundary (one review at `library add`, not one per blueprint), namespace hygiene (every id the library contributes carries the library's prefix), and drift protection (annotated tag or sha pin, verified on every refresh).

Spec: `external-blueprint-libraries-spec-2026-08-31.md` (RATIFIED with amendments A1..A3 on 2026-09-03). Section numbers below refer to that spec.

## What a library is

A directory containing:

- `library.json` at the root - the manifest, described below.
- `blueprints/<slug>/` - one directory per blueprint. Each is a valid blueprint per `blueprint-authoring.md`.
- `README.md` at the root - a short human-facing description of the library, its intent, and the topics its blueprints reserve.
- (Optional) `docs/topics.md` - the `scope:global` ADR topics the library's blueprints claim, one section per topic, so a consuming project sees the trust-boundary interactions at a glance.
- (Optional) `docs/band-allocation.md` - the AC band and suffix-family number blocks the library reserves.
- (Optional) `CHANGELOG.md` - one entry per tagged library ref.

Core (the org-neutral shelf shipped with `rcf-lite`) is not a library in this sense. Core blueprints are addressed unqualified (`security-auth-magic-link`). Libraries are strictly additive.

## `library.json` field contract

```json
{
  "libraryVersion": 1,
  "libraryPrefix": "wsd",
  "displayName": "WSD organisational blueprint library",
  "publisher": {
    "id": "wsd",
    "displayName": "West Somerset Data",
    "contact": "engineering@wsd.example"
  },
  "libraryRef": "1.0.0",
  "bands": {
    "ac": { "start": 50000, "end": 59999 },
    "suffixBlocks": [
      { "kind": "adr", "start": 5000, "end": 5099 },
      { "kind": "tac", "start": 5000, "end": 5099 }
    ]
  },
  "blueprints": [
    { "slug": "auth-oauth2", "path": "blueprints/auth-oauth2" },
    { "slug": "std-error-envelope", "path": "blueprints/std-error-envelope" }
  ],
  "notes": "Blueprints that compose the WSD standards' MUST clauses into acceptance criteria."
}
```

| Field | Required | Meaning |
|---|---|---|
| `libraryVersion` | yes | Manifest schema version. `1` for this spec. Consumers refuse anything higher than they know. |
| `libraryPrefix` | yes | The kebab slug the library owns as a namespace root. Every blueprint applied through this library gets `<libraryPrefix>-` prepended to its slug on disk; every id it contributes carries the prefix through the phase-1 stamping rules. Two to five characters is a comfortable envelope. Must not match or boundary-swallow any core-shelf blueprint slug (see spec section 5.1). |
| `displayName` | yes | Human-readable library name for review-on-add and `library list`. |
| `publisher.id` | yes | Short kebab slug identifier for provenance. Stated, not verified. |
| `publisher.displayName` | yes | Rendered in review-on-add. |
| `publisher.contact` | no | Free-form contact line (email, URL). |
| `libraryRef` | yes | Library's own semver-ish self-reported version. Human-friendly; NOT the security-load-bearing pin. The pin is the source ref stored in the consuming project's registry entry (`resolvedSha` for git, `provenance.tarballSha256` for tarball). |
| `bands.ac.start` / `.end` | yes | The contiguous AC id band this library reserves for its REQ / US / TS contributions. Integers in the range 1..99999, `start <= end`. Recommend high bands (for example, `9101..9899` or `50000..59999`) to leave low-numbered ranges for the core shelf's expansion. |
| `bands.suffixBlocks[]` | no | Optional per-family (ADR, TAC) numeric blocks for suffix-family id namespacing. Same range and ordering rules as `bands.ac`. |
| `blueprints[]` | yes | Enumerates every shipping blueprint. Loader validates that each declared `path` exists and contains a valid `blueprint.json` whose `slug` matches the entry's `slug`. |
| `notes` | no | Free-form library-level operator note. |

### Prefix rules (spec section 5.1)

The library prefix is the namespace root for every blueprint the library ships. It cannot:

- Match any core blueprint slug exactly (`security` is legal; `security-auth-magic-link` is not).
- Be a substring-prefix of any core slug when followed by `-` (a prefix `security-auth` would silently swallow the boundary between prefix and blueprint slug, since `security-auth-` is the leading substring of `security-auth-magic-link`).
- Collide with any already-registered library on the consuming project.
- Contain a colon or a slash.

Choose a short prefix that is not a common English word. `wsd`, `acme`, `stripe-int` are good; `common`, `shared`, `security` are not.

### Band allocation (spec sections 5.3, 8.3)

Every blueprint the library ships must produce contribution ids that fall inside the library's declared `bands.ac` (for REQ / US / TS) and inside a matching `suffixBlocks[]` entry (for ADR / TAC). The `library add` gate refuses a library whose declared bands overlap another registered library or a core-shelf reservation; the `blueprint add wsd:<slug>` gate refuses a contribution whose numeric portion falls outside the library's declared band, so a library that grew a blueprint outside its band (that the library author's own CI should have caught but did not) refuses at the consuming project.

A comfortable posture: reserve one AC decade (10,000 ids) per library, one ADR/TAC century (100 ids) per family. Adjust downward if the library is small; adjust upward only after checking that no core-shelf blueprint has grown into the band you want.

## Authoring loop

The library shape is a strict superset of the phase-1 blueprint shape, so you can author the library on disk today and iterate on a real project without shipping the library anywhere.

1. Create `<library-root>/library.json` with the fields above and a `libraryPrefix` you own.
2. Create `<library-root>/blueprints/<slug>/blueprint.json` per the standard in `blueprint-authoring.md`. Author contributions with the effective ids the library will stamp: `wsd-auth-oauth2-REQ-50101`, `ADR-5001-wsd-auth-oauth2`, and so on. The band gate enforces the numeric portion against `bands.ac` / `bands.suffixBlocks[]`, so you get the same refusals authoring as your consumers will.
3. Test the shape locally by pointing `rcf define blueprint add <path>/blueprints/<slug>` at a blueprint inside the library. Amendment A2 (2026-09-03) makes this route stamp exactly the same effective slug and identity a qualified `wsd:<slug>` add would after registration - the resolver walks up from the target for `library.json` and treats the apply as a library-qualified apply, without needing the library to be registered on the throwaway project you are testing in.
4. Iterate on the blueprint against a throwaway project (`rcf init` a scratch directory, apply, run `rcf define validate`, `rcf audit coverage --strict`, then discard). Real projects should not adopt content before the library is packaged and registered.

### Local-path authoring bypasses review-on-add

The A2 route intentionally does NOT require the library to be registered in the project's `rcf/blueprint-libraries.json`. That means an unregistered local library skips the `library add` review-on-add gate. The mitigation is the `local` provenance warning printed on apply. This trade-off exists so the "author now, test now" loop stays fast; forcing registration for the dev loop kills it. For any library you intend a project to adopt for real, register it through `rcf define blueprint library add` so the review-on-add card runs.

## Registering a library on a consuming project

Three source kinds are supported:

- **local**: an absolute or relative path to a library root on the operator's own filesystem. Bypasses network fetch. The registry entry's `cachePath` points at the local library itself; nothing is copied. Suited to dev use and to WSD-style monorepo layouts where the library sits next to the projects that consume it.
- **git**: `git+<url>#<annotated-tag-or-sha>`. Cloned into `rcf/.blueprint-libraries/<prefix>/<libraryRef>/` and checked into the consuming project's git tree so a fresh clone can `rcf define blueprint list` without a re-fetch. Floating branches (`main`, `master`, `HEAD`, `latest`, `develop`, `trunk`) refuse. Lightweight tags refuse; annotate the tag upstream or pin to a sha. Auth is out of scope for v1: the ambient `git` tool is used; if the operator does not have access to the library repository, that is for the operator to resolve.
- **tarball**: a URL to a `.tar` / `.tar.gz` / `.tgz` paired with `--sha256 <hex>`. The SHA-256 of the downloaded bytes is verified on the fly; a mismatch refuses the fetch and writes nothing.

```
$ rcf define blueprint library add ./path/to/wsd-library
$ rcf define blueprint library add git+https://github.com/wsd-team/wsd-blueprint-library.git#v1.2.0
$ rcf define blueprint library add https://example.invalid/wsd-lib-1.2.0.tar.gz --sha256 3a1c9e7b...
```

Every add runs the review-on-add card first: library display name, publisher, source, pinned digest, library ref, AC band, suffix blocks, the blueprint list, the `scope:global` topics each blueprint claims, and the band and prefix collision-gate outcomes. The operator confirms or aborts. Scripted use requires the loud two-flag form `--no-review --i-have-reviewed`.

## Refresh and drift protection

`rcf define blueprint library refresh <prefix>` re-fetches the pinned ref (git or tarball) and verifies it still resolves to the registered `resolvedSha` or `provenance.tarballSha256`. On drift the verb refuses with a diagnostic and leaves the registry entry untouched. The design point is spec section 6.4 / 9.12: an annotated-tag move is a supply-chain event, not an auto-update. To adopt a newer library ref, run `library add <same-url>#<newer-tag>` explicitly; the review-on-add card re-runs against the new metadata.

Local sources re-validate the on-disk `library.json` against the registered snapshot for drift on load-bearing fields (`libraryPrefix`, `libraryRef`, `bands`).

## Interaction with core

- **Slug collisions**: a library ships blueprints under `<libraryPrefix>-<slug>` on disk. Because the prefix is prepended, a library's `auth-oauth2` blueprint applies as `wsd-auth-oauth2` and cannot collide with a core `auth-oauth2`.
- **`scope:global` ADR conflicts**: a library blueprint contributing an opinion on the same topic as a core blueprint is EXPECTED and desirable (that is the point of an opinionated library). Conflict is resolved through the existing phase-1 paths (`--resolve`, `supersede`, keep-existing, adopt-incoming); the renderer annotates each side with its library membership so the trust-boundary interaction is visible.
- **Category taxonomy**: an external library MAY use categories outside the starter vocabulary (`enterprise`, `regulated-industry`). The rendered shelf shows them under their own header.

## Worked example

A minimum-viable library shipping one blueprint sits at `test/fixtures/library-authoring-example/` inside this package:

```
library-authoring-example/
  library.json                     manifest, libraryPrefix "wla",
                                   bands 60000..60999, adr 6000..6099
  README.md
  blueprints/
    example-standard/
      blueprint.json               slug "example-standard"
      contributions/
        req.json                   REQ id wla-example-standard-REQ-60001
        adr.json                   ADR id ADR-6001-wla-example-standard
```

The fixture doubles as the assertion body for `test/blueprint/library-authoring-example.test.js`: the library loads and validates, and applying its blueprint from either a plain path (A2 route) or a qualified `wla:example-standard` (after registration) produces the identical effective slug and stamped ids.

## Publishing checklist

Before you tag and publish a library release:

- [ ] `library.json` is valid: `libraryVersion` correct, `libraryPrefix` chosen and non-colliding, bands non-overlapping with anything you consume, `blueprints[]` enumerates every blueprint dir.
- [ ] Every blueprint under `blueprints/` passes `rcf define validate` when applied into a throwaway project via a plain path (A2 route). Contributions live inside the declared bands.
- [ ] `README.md` at the library root says what the library is for, who publishes it, and which core blueprints it interacts with.
- [ ] `CHANGELOG.md` names what changed between library refs, one entry per tagged ref.
- [ ] The tag is annotated (`git tag -a v1.2.0 -m "..."` not `git tag v1.2.0`) so pin discipline holds.
- [ ] Sample application into a fresh project produces contributions whose stamped ids and effective slugs match your expectations.

## Cross-references

- Spec: `external-blueprint-libraries-spec-2026-08-31.md` (RATIFIED 2026-08-31, amendments 2026-09-03).
- Individual blueprint authoring: `blueprint-authoring.md`, `blueprint-authoring-checklist.md`.
- Registry file shape: spec section 4.2.
- Prefix and band rules: spec sections 5.1, 5.3, 8.3.
- Update semantics: spec section 10 and `update-awareness-spec-2026-08-28.md`.
