# Blueprint authoring standard

## 1. Read this if

You are authoring an rcf-lite blueprint, or reviewing one. A blueprint is a shippable package of RCF documents that any project can pull in with `rcf define blueprint add <source>`; this doc is the standard those packages must meet. The [walkthrough](blueprint-authoring-walkthrough.md) builds a minimal blueprint end to end; the [checklist](blueprint-authoring-checklist.md) is the gate a new blueprint must pass before it ships. Reference the application-spa blueprint at [`blueprints/application-spa/`](../../../blueprints/application-spa) and the application-api-rest blueprint at [`blueprints/application-api-rest/`](../../../blueprints/application-api-rest) as the two shipped examples.

Not a schema reference: field-level tables for the underlying document kinds (REQ, US, ADR, TAC) live at [rcf-schemas](https://github.com/Stravica/rcf-schemas/tree/main/docs). Not a mechanism internals doc: the walker, conflict detector and manifest writer live under [`packages/rcf-lite/src/blueprint/`](../src/blueprint) and speak for themselves.

## 2. What a blueprint is

A specification package. It contributes REQs, USs (with inline ACs), TACs and ADRs into a host project's `rcf/` tree so the same build cycle that verifies your product's features also verifies a floor of quality the blueprint's author cares about. No code. No test files. No FBSes. No PRD, TAD, or BS.

Two doctrinal lines that fall out of the mechanism:

- **The blueprint contributes the WHAT; the host project derives the HOW.** REQ/US/AC/TAC/ADR are the contribution set. FBS is excluded by ratified principle: build tasks bind to a `bsId` and a `buildOrder` slot the blueprint cannot know, and project constraints have to be applied at creation time. Adherence is expressed as ACs; the blueprint ships no test files (decision 5 of the design brief).
- **Ownership is a manifest fact, not a string grammar.** Once applied, a blueprint's contributions are listed on `manifest.blueprints[<slug>].contributions[]` and that record is authoritative for who owns which id. `stampId` uses string grammar only to STAMP a bare id at first apply; the overwrite guard, cross-blueprint claim detector and remove-refuse scan all consult the manifest record.

## 3. On-disk anatomy

A blueprint source is a directory. Everything the mechanism needs is under it; nothing the mechanism needs sits outside it.

```
blueprints/<slug>/
  blueprint.json           metadata: slug, version, contributions[]
  contributions/           the doc set the mechanism copies
    requirements/          <slug>-req-NNN.json
    user-stories/          <slug>-us-NNNN.json
    tacs/                  tac-NNN-<slug>[-tail].json
    adrs/                  adr-NNN-<slug>[-tail].json
  README.md                what applying it buys, one screen
  guide/<slug>.md          operator-facing: when to reach, when not
  docs/topics.md           coordination vocabulary (global topics + id bands)
  assets/                  reference assets: tokens, wireframes, samples
```

`blueprint.json` shape:

```json
{
  "slug": "application-spa",
  "version": "1.0.0",
  "category": "application",
  "contributions": [
    { "id": "application-spa-REQ-001", "kind": "req", "path": "requirements/application-spa-req-001.json" },
    { "id": "application-spa-US-1101", "kind": "us",  "path": "user-stories/application-spa-us-1101.json" },
    { "id": "TAC-201-application-spa-app-shell", "kind": "tac", "path": "tacs/tac-201-application-spa-app-shell.json" },
    { "id": "ADR-204-application-spa-error-envelope", "kind": "adr",
      "path": "adrs/adr-204-application-spa-error-envelope.json",
      "scope": "global", "topic": "errorEnvelope" }
  ]
}
```

Rules the loader enforces at load time (`packages/rcf-lite/src/blueprint/loader.js`):

- `slug` is lower-kebab (`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`).
- `version` is semver.
- `category`, when present, is a lower-kebab slug on the same pattern as `slug`. The vocabulary lives in section 3a below.
- Every contribution has `{ id, kind, path }` and `path` is relative to `contributions/`, no absolute path, no `..` segment.
- Contributable kinds: `req`, `us`, `tac`, `adr`, `ts`, `cn`. Excluded: `fbs`. Refused as singletons: `prd`, `tad`, `bs`.
- `scope` is optional and, when set, must be `"global"`. `scope: "global"` is legal only on `adr` kind and REQUIRES a `topic` string.

If any rule fails at load time, `rcf define blueprint add` refuses before touching the tree.

## 3a. Category

`category` is an optional lower-kebab string on `blueprint.json` that names the shelf group the blueprint belongs to. `rcf define blueprint list` and the docs blueprint shelf both group by this field; a blueprint that omits it renders under `uncategorised`.

Starter vocabulary (ratified 2026-08-30 with round-2 chunk zero):

| Category | Covers |
|---|---|
| `application` | Whole-app shapes: the SPA client contract, the REST server contract, and future application-shell blueprints. |
| `security` | Auth and secrets: magic-link auth, hosted identity providers (Clerk), OAuth2/OIDC, IdP-integration blueprints (Keycloak), secrets management. |
| `email` | Transactional-email sending and delivery-webhook contracts. |
| `deploy` | Shipping built bits to a running target: Workers, Kubernetes, Fly, Vercel, VPS. |
| `delivery` | Gating changes on the way in: the CI-gate pipeline, and future CI-adjacent blueprints (release notes, artefact publish). Distinct from `deploy`, which ships bits OUT to a running target after merge. |
| `persistence` | Data stores and migration discipline: SQLite, D1, Postgres, MongoDB. |
| `observability` | Health, readiness, probes, status pages. |

New categories are minted by adding a row to this table in a chunk-zero-style pass, not by patching the loader: the loader validates SHAPE (kebab slug), so a blueprint may ship with a category the table does not yet name, and the shelf will render it verbatim. Prefer consolidation over near-duplicate categories; if two candidates read as the same shelf group to a first-time reader, pick one and note the reasoning here.

Category is also a naming discipline. Every shipped blueprint carries a category-qualified slug: application-spa (category `application`), application-api-rest (category `application`), security-auth-magic-link (category `security`), persistence-data-sqlite (category `persistence`), observability-essentials (category `observability`), delivery-ci-workflows (category `delivery`), security-secrets-management (category `security`). Auth-family blueprints share the `security-` slug prefix; persistence-family blueprints share the `persistence-` prefix; and so on. New blueprints follow the same category-qualified slug convention.

## 4. Namespacing

Contributed doc ids are namespaced by the blueprint's slug. There are two families, per the [rcf-schemas id-conventions](https://github.com/Stravica/rcf-schemas/blob/main/docs/id-conventions.md) 0.4.4 grammar:

- **Prefix families** (REQ, US, PRD, BS, TAD, TS): slug PREFIX joined by `-`. `REQ-001` under slug `application-spa` becomes `application-spa-REQ-001`.
- **Suffix families** (ADR, TAC, FBS, CN): slug SUFFIX joined by `-`. `ADR-005` under slug `application-spa` becomes `ADR-005-application-spa`. A longer semantic tail is fine: `ADR-005-application-spa-theme` is accepted verbatim as an `application-spa`-owned id if the author declared it that way.
- **Unnamespaced**: AC and TC. AC ids are anchored to their parent US (whose id is prefix-namespaced) and TC ids to their parent TS. The band allocation below is the AC-collision enforcement mechanism, because AC ids are not namespaced by grammar.

Two ways to author contribution ids in `blueprint.json`:

- Bare (`REQ-001`, `ADR-005`): the mechanism stamps the slug at first apply.
- Pre-stamped (`application-spa-REQ-001`, `ADR-005-application-spa-theme`): accepted as authoritative. Use pre-stamped ids when the semantic tail is not the bare slug.

## 5. AC id bands

AC ids are not namespaced by the schema grammar; the band allocation IS the collision-enforcement mechanism. Ratified policy (2026-08-19):

The shelf-wide band registry (recorded at ship, never predicted; kept in sync across every blueprint's `docs/topics.md`):

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-spa | 1101-1899 | 2xx | shipped v1.3.0 | `clientRouting`, `theming`, `clientState`, `errorEnvelope`, `authModel` |
| application-api-rest | 2101-2899 | 3xx | shipped v1.0.0 | `errorEnvelope`, `authModel`, `apiVersioning`, `logging` |
| security-auth-magic-link | 3101-3899 | 5xx | shipped v1.0.0 | `authModel` |
| email-smtp-resend | 4101-4899 | 4xx | shipped v1.0.0 | none |
| hello-panel (walkthrough exemplar) | 4101-4899 | 4xx | doc-reserved; teaching exemplar in `packages/rcf-lite/docs/blueprint-authoring-walkthrough.md`, not shipped as a blueprint directory | `operatorPanel` |
| persistence-data-sqlite | 5101-5899 | 6xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| delivery-ci-workflows | 6101-6899 | 7xx | shipped v2.0.0 (renamed from ci-pipeline) | `ciGates`, `strictCoverageGate`, `releaseArtefacts` |
| observability-essentials | 7101-7899 | 8xx | shipped v1.0.0 | `healthProbes`, `readinessSemantics`, `statusPageContract` |
| security-secrets-management | 8101-8899 | 9xx | shipped v1.0.0 | `secretsSource` |
| security-auth-clerk | 9101-9899 | 10xx | shipped v1.0.0 | `authModel` |
| security-auth-oauth2 | 10101-10899 | 11xx | shipped v1.0.0 | `authModel` |
| security-auth-keycloak | 11101-11899 | 12xx | shipped v1.0.0 | `authModel` |
| deploy-cloudflare-workers | 12101-12899 | 13xx | shipped v1.0.0 | `deploymentTarget` |
| persistence-data-d1 | 13101-13899 | 14xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| observability-probe-endpoints | 14101-14899 | 15xx | shipped v1.0.0 | `healthProbes`, `readinessSemantics` |
| observability-logging | 15101-15899 | 16xx | shipped v1.0.0 | `logging` |
| application-error-handling | 16101-16899 | 17xx | shipped v1.0.0 | `errorHandling` |
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |

Project-authored docs live in the 001-999 band, below every blueprint. The next blueprint claims its own non-overlapping block above the current tail (visual round T-2 is up next at 18101-18899 / 19xx for `application-charts`) and appends its row here after ship.

A composing blueprint takes a fresh band rather than proposing namespaced AC ids. A US id numeric like `1101` gets its ACs as `AC-1101-1`, `AC-1101-2`, and so on; the US id anchors the band.

Suffix-family ids (ADR, TAC) are string-distinct once slug-suffixed, but number them in the same block for legibility: application-spa uses 2xx, application-api-rest uses 3xx, and every new blueprint claims its own non-overlapping suffix block (see the shared band-registry table in each blueprint's `docs/topics.md`).

**Collision warning that has actually bitten.** In run4 of the watchpost case study, a project-side `US-1101` derived mechanically from `REQ-011` (leading `11` + sequence `01`) collided with the application-spa blueprint's `application-spa-us-1101` at the AC-id-scoping bucket. The seat allocated the project story as `US-1181` and moved on. Two lessons for authors:

- If your blueprint's US numbering starts at `1101` and you own the band `1101-1899`, keep contributions on the LOW end of the band and leave headroom at the HIGH end for project-side stories that mechanically derive to your numbers.
- Note the collision in your blueprint's `docs/topics.md` so a chain-authoring seat consulting the vocabulary sees the risk before it hits the tree.

## 6. Global ADR scope, topics, and conflict semantics

Only `adr` kind contributions can declare `scope: "global"`. A global ADR carries a `topic` string that names the decision AREA, not the answer. The composition mechanism turns `topic` into a strict-equality conflict key.

**Topic string rules** (inherited from the application-spa vocabulary, restated as law):

- Lower camelCase.
- One concept per topic.
- No version suffixes.
- Do not mint variants of existing strings: `errorShape`, `auth`, `apiVersion`, `logShape` are all wrong when `errorEnvelope`, `authModel`, `apiVersioning`, `logging` already exist.

**What happens on `rcf define blueprint add`** (`packages/rcf-lite/src/blueprint/conflicts.js`):

- Two applied blueprints both contributing a `scope: "global"` ADR on the same topic is a `globalAdrTopic` conflict. The add is refused with exit 3 and a report printing both sides' title + first-sentence decision, plus four resolution paths.
- An incoming id already owned by a DIFFERENT applied blueprint is a `crossBlueprintOwnership` conflict, resolved only by fixing the author-side id.

**The four resolution paths** for a `globalAdrTopic` conflict, exactly as the CLI prints them:

1. Adopt the incoming blueprint: `rcf define blueprint remove <existing>` then re-run the add.
2. Keep the existing blueprint: do not add the incoming one on this project.
3. Author a project-level ADR that supersedes both: `rcf define blueprint supersede <topic> --incoming <source>`, then re-run the add. Both blueprint ADRs co-reside on disk as superseded history alongside the project-level ADR that supersedes them; `manifest.resolutions[]` records the pair.
4. Declare the resolution on the add itself: `rcf define blueprint add <source> --resolve <topic>=project:<ADR-id>`. Requires the project ADR to exist already; the add records the resolution and skips the remove/re-add ceremony.

**Dropping a resolution that has gone redundant.** When a blueprint upgrade drops one side of a previously-resolved `globalAdrTopic` conflict (for example essentials v2.0.0 dropping its `healthProbes` claim after the probe-path alignment), `rcf doctor --check probe-path-owner` names the resolution as redundant historical context and points at `rcf define blueprint remove-resolution <adr-id>`. The verb drops the named `manifest.resolutions[]` entry and nothing else; the project-level ADR at `rcf/adrs/<adr-id>.json` is left in place, so the operator can keep it as history or delete it themselves. Idempotent on re-run when the ruling ADR still exists on the tree; refuses exit 2 when the id is malformed or names no ADR on the project.

**Deliberate conflicts are a feature.** The application-spa and application-api-rest blueprints ship two `scope: "global"` ADRs on the same two topics (`errorEnvelope`, `authModel`) on purpose. Composing them on one project surfaces the pairing for operator resolution: the client half and the server half of the same wire contract need one project-level ruling. Author your blueprint's global topics knowing composing blueprints will collide with yours where the decision area is genuinely shared.

**Coordination vocabulary** (`docs/topics.md` in your blueprint):

- Table your blueprint's `scope: "global"` topic strings with owning ADR id, meaning, and composition note.
- Table your blueprint's id band and any bands your composition is designed to reuse.
- Name topics you deliberately did not claim so a future blueprint can pick them up cleanly. The application-api-rest blueprint's `docs/topics.md` names `messageSerialisation`, `deliverySemantics`, and `caching` as unclaimed for exactly this reason.

### 6a. Companion-suggestion roles registry

Roles named on `providesRoles[]` and `suggestedCompanions[]` (see section 8b) are lower camelCase strings that double as global-topic strings on the paired ADR. New roles land in this table the same way new categories land: a chunk-zero-style edit at ratification time, no loader change (the loader validates SHAPE, not vocabulary). Ratified 2026-09-04.

| Role | Meaning | Shelf provider |
|---|---|---|
| `logging` | Structured log emission, correlation identifier propagation, PII redaction boundary, level filter, environment / service-name / service-version stamping. | `observability-logging` |
| `errorHandling` | Uncaught-exception boundary (process and framework), internal error record shape (code, category, message, correlationId, cause chain, redacted context), classification vocabulary (transient / permanent / unknown). | `application-error-handling` |

Where a library ships a role that this table does not yet name (a library-side role the shelf has not adopted), the resolution rule still works and the review-on-add card names the unknown role for the operator's judgement.

## 7. Adherence ACs and the mechanism-reach principle

Adherence to a blueprint is expressed as ACs; the blueprint ships no test files (design-brief decision 5). This is the mechanism's biggest teaching load: the AC binds a CLASS, but the mechanism does not itself compel a project's runtime surface to satisfy the class. Watchpost run4 caught two flagship classes failing exactly here.

**The cautionary pattern (watchpost run4, categories 5, 6, 11).** The application-spa blueprint's `application-spa-REQ-011` says "one icon set behind semantic aliases" and ships `ADR-206-application-spa-iconography` to record the decision. The blueprint was applied cleanly, the project chain composed against it, the build cycle ran green. The deployed app shipped zero icons across eight surfaces. `rcf audit coverage --strict` had already flagged `application-spa-REQ-*` categories 5, 6, and 11 as uncovered `application-spa-REQ-*` requirements (no test cases bound to those ACs); the build proceeded because the project's own build queue did not include an FBS realising the blueprint's icon and token surfaces. The AC bound the class. The mechanism did not compel the surface.

**The principle.** For any AC that constrains project-source realisation (product surface, wired renderer, injected middleware), pair the AC with a mechanism the host project's build cycle already gates on. Three shapes work today:

- **Anchor the AC to a TAC the project must realise.** A TAC contribution names the responsibilities and dependencies of an architecture component; a TAC that the project does not realise leaves an unresolved `tacIds` reference on the story, and `rcf audit coverage`/`rcf define validate` catch that. Blueprint category surfaces (icons, semantic tokens, forms engine) should ship a TAC, not just a REQ, and the REQ/US should cross-link the TAC.
- **Require the AC be bound to a project-authored TC.** ACs are shipped without test files; the host project's build cycle is where TCs land. If your AC is truly runtime-observable, its rendered failure mode is what makes `rcf audit coverage --strict` refuse to declare the FBS done. Author the AC in a shape that a TC can bind exactly one runtime check to.
- **Bind the AC to the runtime-verify layer.** `rcf verify browser` and the `uiBaseline` pack inspect the deployed surface for smoke-level facts. A blueprint category that maps cleanly onto a browser-verify probe is one the ship gate compels; call it out in the AC so the host project wires the probe.

**What NOT to do.** Do not author an adherence AC as a document-level assertion the project can satisfy by adding a document. "The project declares an iconography ADR" is not the AC you want; "The rendered application surfaces the icon set at named component slots X, Y, Z" is. The first is trivially satisfied by copying a stub file; the second is what mechanism reach means. If you can only phrase the AC as document-level, the blueprint category needs a TAC or a runtime-verify pack alongside it before it ships.

**Author-side check.** Before you ship a blueprint category, walk every AC on it and answer: which project-side gate will refuse the FBS if this AC is not realised at the runtime surface? If your only answer is "the operator reads the AC and does the work", the category has a mechanism-reach gap. Log the gap in the blueprint's README under "Known mechanism-reach gaps" so the operator knows what to watch for; open a v1.1 issue on the rcf-lite repo for the mechanism side.

## 8. Versioning and re-apply

`blueprint.json:version` is semver. What re-apply does (`packages/rcf-lite/src/blueprint/apply.js`):

- **Same slug, same version:** no-op. Returns `{ applied: false, alreadyApplied: true }`.
- **Same slug, higher version:** the new version's contribution list overwrites the previous list. Files whose ids are on the CURRENT manifest record (`ownedIds`) are overwritten in place; new ids that would land on files not owned by this blueprint are refused as `duplicateId` conflicts.
- **Same slug, added `scope: "global"` ADR that conflicts:** the mechanism refuses with the conflict list and the tree is untouched.

Version bumps that add or change contributions:

- **Patch** for prose-only edits inside existing contributions.
- **Minor** for new contributions (new REQs, USs, TACs, ADRs) that do NOT add or change a `scope: "global"` topic.
- **Major** for any change to the `scope: "global"` topic set (adding, renaming, removing a global ADR topic), any AC id band shift, any breaking removal of a contribution.

Do not delete a contribution in a minor bump: a project that references the id in its own docs will break at `rcf define validate` after re-apply. A removal is a major and the blueprint's changelog names the referring-doc migration path.

## 8a. Standards-derived-blueprint discipline

The rule is the shelf standard for any blueprint that composes on an organisational or industry standard (WSD, RFC, ISO, OWASP, PCI DSS, HIPAA, a project's own internal standard). It formalises how the standard's clauses map onto RCF contribution kinds. Ratified 2026-09-04 (spec `projects/rcf-lite-wsd/specs/rcf-lite-core-companions-spec-2026-09-04.md` section 3, amendment A2).

### 8a.1 Clause-to-kind mapping

- **MUST clauses become ACs where the clause binds a testable runtime or artefact behaviour.** The AC binds the runtime observation of the clause, per the mechanism-reach principle in section 7. The AC's `description` references the standard clause identifier verbatim (`WSD-001 clause 3.1`, `RFC 7807 section 3.1`) so the trace is one string search away.
- **MUST clauses may land as `recommendedDefault: true` ADRs when the clause is choice-shaped** (per amendment A2, Baz 2026-09-04T12:20:31Z). A choice-shaped MUST is one where the standard fixes an outcome the operator picks between named alternatives at apply (a MUST from a policy that says "select one of the following identity providers"). The ADR carries `standardsTraceClause` set to the clause identifier; the alternative is documented in the ADR's consequences.
- **SHOULD clauses become recommended ADR defaults.** The ADR contribution carries `recommendedDefault: true` and the `consequences` block names the elicited-parameter alternative (the operator overrides the default at apply). The AC pattern for a SHOULD is "the applied ADR records a value for `<parameter>`" (the value the operator chose or the recommended default the apply stamped), not "the value is `<recommended default>`".
- **MAY clauses become elicited ADR choices.** The ADR contribution carries `elicited: true` and no `recommendedDefault`. The apply prompts the operator; the applied ADR records the chosen value and the operator's rationale line.
- **Not-carried clauses stay allowed with a named reason.** A clause the blueprint intentionally does not carry (out of scope, deferred to a companion blueprint, superseded by a shipped project-level pattern) is named in the blueprint's `standards-trace.md` (or equivalent) with the reason. The discipline is honest about what the blueprint reaches and what it does not.

### 8a.2 Additive `blueprint.json` fields

Three additive ADR-contribution fields land on `blueprint.json`:

```json
{
  "id": "ADR-1602-observability-logging-correlation-id-header",
  "kind": "adr",
  "path": "adrs/adr-1602-observability-logging-correlation-id-header.json",
  "recommendedDefault": true,
  "elicited": true,
  "standardsTraceClause": "generic enterprise practice"
}
```

- `recommendedDefault: true` marks the ADR as a SHOULD (or a choice-shaped MUST).
- `elicited: true` marks the ADR as taking an operator-supplied value at apply.
- `standardsTraceClause` records the standard clause identifier (a free-form string) or the sentinel `"generic enterprise practice"` for the neutral shelf blueprints. Non-null on every ADR contribution in a blueprint that declares `standardsTrace[]`.

One additive blueprint-level field:

```json
{
  "slug": "wsd-logging",
  "standardsTrace": [
    { "id": "WSD-001", "version": "2026-05" },
    { "id": "WSD-004", "version": "2026-05" }
  ]
}
```

`standardsTrace[]` is optional. A blueprint that ships without it is a general-enterprise-practice blueprint by default (the two new core shelf blueprints `observability-logging` and `application-error-handling` at v1.0.0 both fit this shape).

### 8a.3 Load-time validation

`packages/rcf-lite/src/blueprint/loader.js` runs one validation pass after the contribution list validates:

- If `standardsTrace[]` is set, every ADR contribution MUST carry a non-null `standardsTraceClause`. Refusal shape: `blueprint '<slug>' declares standardsTrace but ADR contribution '<id>' has no standardsTraceClause; every ADR must reference a standard clause or the sentinel 'generic enterprise practice'.`.
- `recommendedDefault` and `elicited` are mutually independent (a SHOULD may be elicited, a MAY need not have a recommended default). The loader does NOT cross-check which kind a clause severity landed on (per amendment A2): the discipline in section 8a.1 is prose, not code, so a choice-shaped MUST-to-ADR mapping is not refused.
- The refusal fires at the CLI edge as exit 2 (`validation` kind).

### 8a.4 What this changes on the shelf today

Zero shelf blueprints declare `standardsTrace[]` today. The two new core-companion blueprints (`observability-logging`, `application-error-handling`) do not declare it either (both are general enterprise practice; the recommended-default and elicited fields land on their ADRs with the sentinel `standardsTraceClause`). The discipline lands the moment a blueprint declares `standardsTrace[]`. Dex's WSD library at 0.9.1 ships standards-trace tables that this discipline formalises; adoption is a minor bump on that library.

## 8b. Companion suggestion mechanism

The mechanism lets a service blueprint recommend companion blueprints by role, and lets the applying project resolve those recommendations deterministically. Ratified 2026-09-04 (spec section 2).

### 8b.1 Two additive `blueprint.json` fields

- `providesRoles: [<role>, ...]` (optional): the roles a blueprint provides. Lower camelCase (`^[a-z][a-zA-Z0-9]*$`). A blueprint declaring a role MUST also carry a `scope: "global"` ADR whose `topic` equals the role name (the loader refuses otherwise).
- `suggestedCompanions: [{ role, reason }, ...]` (optional): the roles a service blueprint recommends alongside it. `role` is lower camelCase; `reason` is a one-sentence operator-facing string (no em-dashes, no emojis; the loader refuses).

### 8b.2 Deterministic resolution

For each suggested role the resolver walks a tier ladder (spec 2.3): (1) an applied blueprint whose `providesRoles[]` contains the role wins immediately; (2) otherwise a single registered library blueprint providing the role wins; (3) otherwise the single core-shelf provider wins. A pin in `rcf/companions.json` overrides steps (2) and (3). Two library candidates for one role with no pin refuses at both `rcf define blueprint add` and `rcf define blueprint companions <slug>` with exit 3 and a three-path resolution message.

### 8b.3 Where the suggestion surfaces

Three surfaces, one resolution rule (spec 2.6): the apply-time suggestion block printed after a successful `rcf define blueprint add` (suppressible with `--no-companion-suggestions`); the `rcf define blueprint companions <slug>` verb (`--json` machine envelope); the managed agent-instructions block's `How to talk to your operator` section (regenerated via `scripts/gen-managed-artefacts.mjs`, hash checked at ship).

### 8b.4 Where pins live

`rcf/companions.json` (schemaVersion 1) records role-to-provider pins, current pin only per role, `pinnedAt` ISO-8601. `--companion <role>=<slug>` on `rcf define blueprint add` writes a pin at apply. `rcf define blueprint companions set <role> <slug>` and `rcf define blueprint companions unset <role>` write and remove pins outside the apply flow. `rcf define validate` refuses exit 3 when a pin names no known provider.

## 8c. Visual-surface probe packs

For any AC that constrains a runtime-observable visual surface (row order after sort, live-region announcement text, focus return after dialog close, refetch on a timeframe change), the blueprint SHIPS a browser-verify probe pack that `rcf verify browser` invokes as a required gate. The AC is anchored to a pack check by check id; a pack failure refuses ship through the existing `browserVerification` aggregate verdict. A blueprint MAY ALSO ship a Node build-scan probe for surfaces observable at build time (the TAC-207 / TAC-208 pattern in application-spa v1.1.0); when both exist, the build-scan probe is a fast-fail pre-check inside the same `browserVerification` record, and the browser pack is the ship gate.

Packs live at `blueprints/<slug>/probe-packs/<pack-name>.pack.js` (or `.pack.mjs`; both extensions load the same way). Each pack module exports a default object whose fields the loader enforces at load time (refusal exit 2, one diagnostic per fault):

```js
export default {
  packName: 'application-datatable-grid-shell',
  version: '1.0.0',
  blueprintSlug: 'application-datatable',
  appliesTo: ({ fbs, uiBaseline, manifest }) => Boolean,
  boot: { bootCommand: null, waitForUrl: null, waitForSelector: null },
  preChecks: [
    { id: 'no-inline-style', severity: 'block', description: '...', run: async () => ({ verdict: 'pass' }) },
  ],
  checks: [
    {
      id: 'AC-17101-1',
      severity: 'block',
      description: 'Sort click reorders rows',
      dependsOn: 'no-inline-style',
      run: async ({ browser, fetch, runtimeUrl, route, theme }) => ({ verdict: 'pass' }),
    },
  ],
};
```

Field-level rules the loader enforces:

- `packName` matches `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` and MUST equal the owning blueprint's slug or start with `<slug>-`.
- `version` is semver; `blueprintSlug` matches the enclosing directory.
- `appliesTo` is a required function. Its source (`appliesTo.toString()`) MUST reference at least one of `route` (or `navModel`/`path`), `tacIds`, or the `blueprint:` US-tag prefix. The default `() => true` predicate is refused so a pack cannot fire on an FBS whose surface does not exist (run-4 residual cure).
- Every `checks[].id` MUST match an AC id contributed by the same blueprint through `blueprint.json:contributions[]`. A pack whose check names an AC the blueprint does not contribute is refused with a diagnostic that lists the contributed AC ids.
- `checks[]` is a non-empty array; each check carries id / severity in {block, warn, advisory} / description / async `run`. Duplicate ids on the same pack are refused.
- Optional `preChecks[]` carries Node build-scan fast-fail checks. A failing pre-check skips every browser check that names it under `dependsOn` (verdict `skipped`, detail `skipped-by-pre-check:<preCheckId>`); browser checks with no `dependsOn` on the failed pre-check still run.

The runner runs the pack pass after invariants and after auth-smoke on `agentScreenshotCritique` mode. Each applicable pack contributes one record to `browserVerification.probePacks[]`:

```json
{
  "probePacks": [
    {
      "packName": "application-datatable-grid-shell",
      "packVersion": "1.0.0",
      "blueprintSlug": "application-datatable",
      "applicable": true,
      "checks": [
        { "id": "AC-17101-1", "verdict": "pass", "severity": "block" },
        { "id": "AC-17101-2", "verdict": "fail", "detail": "row order after sort did not match server order", "severity": "block" }
      ]
    }
  ]
}
```

The aggregate verdict extends the existing rule in `manifest-writer.js:aggregateVerdict`: `block` on any invariant / auth-smoke / pack-check / pre-check severity=block fail; `warn` on any warn-severity fail when no block fires; `pass` otherwise. A pack whose `appliesTo` returns false is recorded with `applicable: false`, contributes no checks, and does not affect the verdict.

The `rcf verify browser <fbs-id> --probe-pack <name>` option restricts one run to one pack by packName; an unknown value exits 2 with a diagnostic that names the discovered packs. Omitting `--probe-pack` runs every discovered pack whose `appliesTo` matches this FBS.

Packs receive `browser` and `fetch` through the runner's injected dependencies. The `browser` seam is a real headless Playwright browser provisioned by the runner through the pinned Playwright MCP server (`src/verify/engine/launcher.js`, spawned as `npx -y @playwright/mcp@<pin>`) via a thin in-package JSON-RPC 2.0 stdio client. Zero new npm dependencies land in rcf-lite for this. When the consuming project already resolves `playwright` from its own `node_modules`, the runner takes that cheaper direct route and exposes the same API. See `verify-reference.md` for the full method list; a pack MUST NOT call `close()` (the runner owns lifetime). `run` functions are expected to be pure with respect to the runtime state they leave behind; a check that mutates persistent state on the app under test without a cleanup path is refused at author-side review.

The dev server is expected to be running when packs execute. If `boot: { bootCommand, waitForUrl, waitForSelector }` is declared on the pack AND the runtime URL is unreachable, the CLI spawns `bootCommand` from the project root (cwd = project root, no shell), polls `waitForUrl` (bounded, default 60s) until it responds, and optionally polls the browser snapshot for `waitForSelector` (bounded, default 10s, soft-failure); packs then run and the CLI stops the process it started when the pass completes. When the runtime is already answering, the boot block is skipped and the running server is used unchanged. The boot fallback is intentionally a fallback, never a per-blueprint dev-server harness: a blueprint that ships a boot block designed to run every time the pack runs fails author-side review. `rcf verify browser --no-boot` disables the fallback for one run.

## 9. What blueprints must not contribute

The loader refuses these at load time; do not attempt to author them.

- **FBS.** The blueprint's WHAT never carries the project's HOW. FBSes bind to a project `bsId` and a `buildOrder` slot the blueprint cannot know; project constraints apply at creation time.
- **PRD, TAD, BS.** Project singletons: one PRD, one TAD, one BS per project. A blueprint that overrides them would fight every other blueprint on the project.
- **Test files, source code, framework wiring.** Adherence is expressed as ACs; realisation is the host project's build cycle. Anything the mechanism does not name in `contributions[]` is not a contribution.

## 10. Guide and README voice

Every blueprint ships two operator-facing pieces:

- `README.md` at the blueprint root: one screen, four sections. Apply command; anatomy table (`Piece | Where | What`); what it contributes and what it deliberately does not; quality bar in one paragraph. See [`blueprints/application-spa/README.md`](../../../blueprints/application-spa/README.md) and [`blueprints/application-api-rest/README.md`](../../../blueprints/application-api-rest/README.md).
- `guide/<slug>.md`: the operator's guide, two-to-three screens. What it is; what it deliberately is not; when to reach for it; when it does not fit; what a good outcome looks like; the operator decisions that remain open after apply; a cost-honesty paragraph naming what shipping this doc set costs the project.

Voice discipline for both:

- Direct, machine-first. No hedging, no marketing lift, no filler. See [`docs/how-it-works.md`](how-it-works.md) for the tone the tool docs hold.
- No em-dashes (use hyphens or restructure).
- No emoji.
- ASCII arrows (`->`) not Unicode arrows.
- No first-person plural editorial voice.

## 11. Assets

Assets are package-resident, not contributed to the tree. Ship what the operator or the working agent needs to realise the blueprint's ACs: design tokens, wireframes, component specs, OpenAPI skeletons, sample data. The applied blueprint's on-disk source path is recorded on `manifest.blueprints[<slug>].source`; the working agent reads assets from there until asset ingestion into `rcf/knowledge/docs/blueprint-guides/` ships as a mechanism follow-up.

Keep asset formats stable across a blueprint's major version. A renamed asset file breaks agents that were pointed at the old name.

## 12. Ship checklist

The [authoring checklist](blueprint-authoring-checklist.md) is the quality gate a new blueprint must pass. Every item there is derived from a rule in this standard; if a checklist item fails you have a fix in this doc.
