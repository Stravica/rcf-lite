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
| security-secrets-management | 8101-8899 | 9xx | shipped v1.0.1 | `secretsSource` |
| security-auth-clerk | 9101-9899 | 10xx | shipped v1.0.0 | `authModel` |
| security-auth-oauth2 | 10101-10899 | 11xx | shipped v1.0.0 | `authModel` |
| security-auth-keycloak | 11101-11899 | 12xx | shipped v1.0.0 | `authModel` |
| deploy-cloudflare-workers | 12101-12899 | 13xx | shipped v1.0.0 | `deploymentTarget` |
| persistence-data-d1 | 13101-13899 | 14xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| observability-probe-endpoints | 14101-14899 | 15xx | shipped v1.0.0 | `healthProbes`, `readinessSemantics` |
| observability-logging | 15101-15899 | 16xx | shipped v1.0.0 | `logging` |
| application-error-handling | 16101-16899 | 17xx | shipped v1.0.0 | `errorHandling` |
| application-datatable | 17101-17899 | 18xx | shipped v1.0.0 | none |
| application-charts | 18101-18899 | 19xx | shipped v1.0.0 | none |
| application-dashboard | 19101-19899 | 20xx | shipped v1.0.0 | none |
| application-notifications-in-app | 20101-20899 | 21xx | shipped v1.0.0 | none |
| application-admin-console | 21101-21899 | 22xx | shipped v1.0.0 | none |
| application-empty-error-states | 22101-22899 | 23xx | shipped v1.0.0 | none |
| application-file-upload | 23101-23899 | 24xx | shipped v1.0.0 | none |
| application-forms-wizard | 24101-24899 | 25xx | shipped v1.0.0 | none |
| application-account-settings | 25101-25899 | 26xx | shipped v1.0.0 | none |
| application-onboarding-tour | 26101-26899 | 27xx | shipped v1.0.0 | none |

Project-authored docs live in the 001-999 band, below every blueprint. The next blueprint claims its own non-overlapping block above the current tail (visual round 5 tracks land above the current tail) and appends its row here after ship.

T-4 reserves the `application-notifications-` family prefix as a name-only doc reservation (per spec Q3 default) for the sibling in-app-adjacent channels the shelf will grow into (`-email`, `-push`, `-webhook`): the name space is reserved so a future PR does not propose `application-alerts-email` or `application-messages-push` outside the family. Band allocation for each sibling happens at ship time by claiming the next unclaimed slot above the current tail. Reserved-name rows are documented in `blueprints/application-notifications-in-app/docs/topics.md`.

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

#### Capability declaration extension (visual round T-5)

Identity blueprints declare identity or platform capabilities they provide via a sibling `capabilities[]` field on `blueprint.json`. Consumer blueprints (currently `application-admin-console`) gate their surfaces on the union of applied capabilities. The loader validates the shape (lower camelCase on the same `^[a-z][a-zA-Z0-9]*$` pattern as `providesRoles[]`); the vocabulary is this table extended below, in the same chunk-zero-style edit pattern the roles registry uses. Ratified 2026-09-04, spec section 5.5.2.

| Capability | Meaning | Shelf provider(s) |
|---|---|---|
| `principalDirectory` | The applied auth blueprint identifies principals a users surface can list. | `security-auth-clerk`, `security-auth-oauth2`, `security-auth-keycloak`, `security-auth-magic-link` (all four; the magic-link case ships principals but no roles). |
| `roleModel` | The applied auth blueprint declares operator-visible role labels a permission matrix can render. | `security-auth-clerk`, `security-auth-oauth2`, `security-auth-keycloak` (magic-link does NOT declare this; a bare-magic-link project gets no roles surface). |
| `tenancy` | The applied auth blueprint (or a paired tenancy blueprint) declares an organisation abstraction the console can switch across. | Reserved for a future `application-tenancy-orgs` blueprint; no shelf provider today. |
| `auditLog` | The applied `logging` companion (or a dedicated audit-log blueprint) emits an event stream the console's audit view can read. | `observability-logging` from 1.1.0 (declares `capabilities: [auditLog]` explicitly; one grammar, no role-to-capability inference); a dedicated audit-log blueprint may claim it in future. |
| `credentialSelfService` | The applied auth blueprint ships a credential self-service surface a project can bring in-place (password change, MFA management, email change). Consumer blueprints render the security surface's self-service branch when this capability is applied. | `security-auth-keycloak` from 1.2.0; `security-auth-oauth2` from 1.2.0 (provider-conditional per README). Not declared by `security-auth-clerk` (Clerk keeps credential management inside its hosted surface, which is `hostedIdentityUi` instead) or `security-auth-magic-link` (magic-link ships no credential surface). Ratified 2026-09-06, spec section 5.4.2. |
| `sessionInventory` | The applied blueprint (an auth blueprint or a logging-as-session-inventory companion) exposes an active-session inventory a consumer surface can list and act on (device label, last-active, terminate). Consumer blueprints render the sessions surface when this capability is applied. | `security-auth-clerk` from 1.3.0; `security-auth-keycloak` and `security-auth-oauth2` from 1.2.0; `observability-logging` from 1.2.0 (as the logging-projection provider). Not declared by `security-auth-magic-link` (click-a-link is the whole surface). Ratified 2026-09-06, spec section 5.4.2. |
| `hostedIdentityUi` | The applied auth blueprint hosts identity screens (sign-in, sign-up, account, security) that a consumer surface can link out to or embed. Consumer blueprints render the security surface's hosted-UI branch when this capability is applied and the operator has elicited the `security-surface-shape` and `hosted-identity-url` answers. | `security-auth-clerk` from 1.3.0; `security-auth-oauth2` from 1.2.0 (provider-conditional per README; a hosted account portal like Auth0 or Cognito supplies it, a bare OIDC provider does not). Not declared by `security-auth-keycloak` (realm-scoped, branded in place) or `security-auth-magic-link`. Ratified 2026-09-06, spec section 5.4.2. |
| `relationalStore` | The applied blueprint provides a Postgres-shape (row-oriented, ACID, SQL) durable relational store; a consumer blueprint that needs relational semantics reads this capability to configure its own surfaces. | `persistence-data-postgres` v1.0.0. Note: sqlite and D1 are also relational stores; they are not tagged here because their shipped composition contract owns `persistenceStore` at the global-topic level and any relational consumer resolves via that topic rather than through this capability. If a future consumer needs a strictly Postgres-shape declaration (no sqlite dialect), it reads `relationalStore` and this row grows. |
| `objectStorage` | The applied blueprint provides an S3-API-shape object store; a consumer blueprint that stores large binary payloads (uploads, attachments, generated reports) reads this capability to obtain a facade or presigned-URL surface. | `object-storage-s3` v1.0.0. Reserved for a future `object-storage-native-gcs` or `object-storage-native-azure` sibling that would conflict on `objectStorageContract` at the global-topic level. |
| `queue` | The applied blueprint provides a producer-to-consumer worklist queue with at-least-once delivery and DLQ semantics; a consumer blueprint that hands off background work (jobs, deferred sends, ingest pipelines) reads this capability to obtain the producer facade. | `messaging-queue-cloudflare` v1.0.0. Reserved slug `messaging-queue-postgres` (operator decision 7, deferred v1.0.0 pending demand); a future WSD-lane eventbus that owns different semantics would not claim `queue` (broadcast vs directed distinction). |
| `backgroundJobs` | The applied blueprint provides a job-definition and scheduler surface over an applied `queue`, with retry and metadata-only observability; a consumer blueprint that surfaces "run this later" or "run this on a schedule" reads this capability. | `jobs-background` v1.0.0. Reserved for a future stateful-workflow sibling (Temporal-shape, Airflow-shape) that conflicts on `backgroundJobModel` at the global-topic level; the round-6 Workflows minor bump inside `jobs-background` itself does NOT mint a sibling (it lives inside the same blueprint as an elicited scheduler mode value at ADR-3102, per section 5.7 of the infra round 5 spec). |
| `keyValueStore` | The applied blueprint provides a Cloudflare Workers KV-shape key-value store (eventually consistent, string values, per-key metadata blob, prefix-scoped list) behind a facade that emits metadata-only lifecycle events; a consumer blueprint that needs a small durable KV surface behind a swappable boundary reads this capability to obtain the facade. | `platform-cloudflare-kv` v1.0.0. A future non-Cloudflare adapter (a Redis-shape store, a strong-consistency Durable Objects cell for a single-owner use case) would conflict on `keyValueStoreContract` at the global-topic level; the round-6 T-3 `platform-cloudflare-durable-objects` sibling is the shipped answer when strong-consistency semantics are required. |
| `scheduledTrigger` | The applied blueprint provides a scheduled() handler over Cloudflare Workers Cron Triggers with an expression-routed dispatcher, skew-tolerance classification and soft-budget observation; a consumer blueprint that needs recurring stateless scheduled work reads this capability to obtain the scheduled handler wiring. Metadata-only lifecycle events (`cronReady`, `cronFired`, `cronSkewed`, `cronStalled`, `cronUnmatched`) render through the applied logging companion without a per-blueprint scrub pass. | `platform-cloudflare-cron-triggers` v1.0.0. A future non-Cron-Triggers scheduler (a cross-region cron on a different platform, a durable-workflow scheduler on the round-6 T-3 Durable Objects sibling, the round-6 Workflows adapter on `jobs-background` v1.1.0 per spec section 5.7) would conflict on `scheduledTriggerContract` at the global-topic level. |
| `strongConsistencyCell` | The applied blueprint provides a Cloudflare Durable Objects single-cell shape (a named DO instance as an authoritative counter, session store or lock) behind a facade that emits metadata-only lifecycle events; a consumer blueprint that needs a strongly consistent authoritative cell reads this capability to obtain the facade and the typed domain verbs. | `platform-cloudflare-durable-objects` v1.0.0. A future non-Cloudflare adapter (a Postgres advisory-lock singleton, a Redis single-master pattern) would conflict on `strongConsistencyCellContract` at the global-topic level; the sibling `platform-cloudflare-kv` is the eventually-consistent slot. |
| `hibernatableWebSocket` | The applied blueprint provides a Cloudflare Durable Objects hibernatable WebSocket hub shape (a named DO instance hosting many websocket clients with per-message routing and hibernate-and-wake support); a consumer blueprint that needs coordinated-multiplayer websocket connections reads this capability to obtain the hub facade. | `platform-cloudflare-durable-objects` v1.0.0. A future non-Cloudflare hub sibling (a Redis pub-sub broker, a bespoke websocket server) would conflict on `websocketHubContract` at the global-topic level. |
| `zeroTrustGate` | The applied blueprint provides an edge-authentication Zero-Trust JWT-assertion gate over Cloudflare Access; the shipped JWT validator (sole reader of the `Cf-Access-Jwt-Assertion` header) verifies against the Access JWKS and reduces the principal onto `request.auth` as `{email, sub, groups}`. A consumer blueprint that needs an authenticated principal on `request.auth` reads this capability to obtain the gate wiring and the audit-event contract. Metadata-only audit events (`validated`, `missing`, `expired`, `invalid`, `bypass`) render through the applied logging companion without a per-blueprint scrub pass. | `edge-cloudflare-access` v1.0.0. A future non-Cloudflare adapter (Google Cloud IAP, AWS Verified Access, Duo Beyond) would conflict on `edgeAuthenticationGate` at the global-topic level; the round-6 T-4 mechanism ships the shared applied-sidecar seam every adapter would reuse. |
| `humanCheck` | The applied blueprint provides a Cloudflare Turnstile-shape human verification gate on public-facing forms; the shipped client widget mount renders the Turnstile widget from the Cloudflare Turnstile host only, the server-side verifier POSTs the response token to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the elicited secret, a refuse-if-token-missing guard rejects every submit without a token before any downstream handler runs, and every event record carries `{sitekeyHash, outcome, timestamp}` keys only. A consumer blueprint that mounts a public-facing form (contact, subscribe, magic-link mint) reads this capability to obtain the guard wiring and the composition hook. | `edge-cloudflare-turnstile` v1.0.0. A future non-Cloudflare sibling (hCaptcha, reCAPTCHA) would conflict on `humanVerificationGate` at the global-topic level; the round-6 T-5 mechanism ships the shared applied-sidecar seam every adapter would reuse. |
| `edgeRateLimit` | The applied blueprint provides a Cloudflare WAF rate-limiting rules zone-level throttle in front of Worker handlers; the rule set lives as a local manifest committed under the elicited manifest directory (one JSON file per rule) with the seven documented fields (id, expression, threshold, period, characteristics, action, duration), an operator-facing management surface documented as either a wrangler command flow or a Cloudflare dashboard flow applies the manifest to the live zone, and a scheduled drift-audit runner reads live rules via the Cloudflare API and diffs against the manifest with metadata-only records (`ruleId`, `clientIpHash`, `outcome`, `timestamp`, `diff`). A consumer blueprint that layers per-application limits over the edge throttle reads this capability and composes accordingly. | `edge-cloudflare-rate-limiting` v1.0.0. A future non-Cloudflare sibling (Fastly rate-limits, Vercel Edge Config throttles) would conflict on `edgeThrottleContract` at the global-topic level; the round-6 T-6 mechanism ships the shared applied-sidecar seam every adapter would reuse. |
| `cloudHost` | The applied blueprint provisions and manages a Linux VM the project runs on (a Hetzner Cloud server in v1.0.0; the manifest at `hetzner/servers/name.json` is the source of truth and the provisioner facade is the sole reader of the Hetzner API token via `security-secrets-management`; every provisioned server carries the six-block hardening baseline via cloud-init: SSH key-only, root disabled, UFW default-deny incoming, DOCKER-USER iptables chain, fail2ban SSH jail, unattended-upgrades). A consumer blueprint that runs on a Linux host (containers, systemd services, tunnel connectors) reads this capability to compose on the host contract; the round-7 T-2 `platform-docker-compose-host` composes on it to mount the compose runtime. | `deploy-hetzner-server` v1.0.0. Reserved for future non-Hetzner siblings (Vultr, DigitalOcean, Fly.io) that would conflict on `linuxCloudHostContract` at the global-topic level; the round-7 T-1 mechanism ships the shared applied-sidecar seam every adapter would reuse. |
| `containerHost` | The applied blueprint runs a container-orchestration surface on a `cloudHost` (docker compose in v1.0.0; the shipped compose.yaml at the applying repo root is the source of truth, healthchecks refuse at docker compose config time on missing, every secret is a compose secrets: file mount at 0o400, restart policies are unless-stopped or on-failure, and the reverse-proxy config is a first-class checked-in artefact bind-mounted into the proxy service with docker compose exec caddy caddy reload as the reload verb). A consumer blueprint that ships as a container reads this capability to compose on the container contract; the round-7 T-3 `edge-cloudflare-tunnel` composes on it to run cloudflared as a compose service. | `platform-docker-compose-host` v1.0.0. Reserved for future non-compose siblings (Docker Swarm, Nomad) that would conflict on `containerHostContract` at the global-topic level; the round-7 T-2 mechanism ships the shared throwaway-server compose stack every future sibling would reuse. |
| `tunnelBridge` | The applied blueprint bridges a service on a `cloudHost` (bare, systemd-unit connector shape) or a `containerHost` (compose-service connector shape) to the Cloudflare edge through a Cloudflare Tunnel without opening origin ports; the shipped tunnel manifest at `cloudflare/tunnels/<name>.yaml` (uuid tunnel id, `credentialsFile.secretRef` reference, ingress rules with a mandatory catch-all `http_status:404`) is the runtime source of truth, the connector runtime is elicited via ADR-4002 (`compose-service` default when `containerHost` applied; `systemd-unit` alternative for bare `cloudHost`), and composition with `zeroTrustGate` (ADR-4003) attaches `originRequest.access.aud` per ingress rule when Access is applied and omits the block (public-hostname mode) when it is not. A consumer blueprint that exposes a service publicly reads this capability to know a bridge is in place. | `edge-cloudflare-tunnel` v1.0.0. Reserved for future non-Cloudflare siblings (Tailscale Funnel, Fly.io proxy) that would conflict on `edgeIngressBridge` at the global-topic level; the round-7 T-3 mechanism ships the shared applied-sidecar seam every adapter would reuse. |

The sibling loader fields are:

- `capabilities[]` (identity blueprint): declares what the blueprint provides. Optional, non-empty when present.
- `requiresAppliedCapabilities` (consumer blueprint): `{capabilities: string[], allowSkipFlag: string, refusalMessageId: string}`. The apply verb refuses when no applied blueprint's capabilities intersect the required set, unless the CLI flag matching `allowSkipFlag` is passed. The `refusalMessageId` maps to a bundled template (`application-admin-console-bare-spa` today; a bespoke message is used verbatim otherwise).
- `elicits[]` (consumer blueprint): apply-time prompts the operator answers via `--answer <id>=<value>` or `--answers <file>`. Each entry declares `{id, prompt, kind (enum|string|boolean), default?, options? (for enum), when? (predicate on applied capabilities)}`; the elicit fires only when its `when.requiresCapability[]` overlaps the discovered applied-capability set.

The apply verb persists the discovered `appliedCapabilities` and the elicit answers into a sidecar file at `rcf/blueprints/${slug}.applied.json` (the applied-blueprint-record schema in rcf-schemas 0.6.0 is closed under `additionalProperties: false`; the sidecar is the applied-side ground truth until a schema minor adopts the fields directly). A future rcf-schemas minor may promote `appliedCapabilities[]` onto the applied record; the sidecar stays supported for backward compatibility.

## 7. Adherence ACs and the mechanism-reach principle

Adherence to a blueprint is expressed as ACs; the blueprint ships no test files (design-brief decision 5). This is the mechanism's biggest teaching load: the AC binds a CLASS, but the mechanism does not itself compel a project's runtime surface to satisfy the class. Watchpost run4 caught two flagship classes failing exactly here.

**The cautionary pattern (watchpost run4, categories 5, 6, 11).** The application-spa blueprint's `application-spa-REQ-011` says "one icon set behind semantic aliases" and ships `ADR-206-application-spa-iconography` to record the decision. The blueprint was applied cleanly, the project chain composed against it, the build cycle ran green. The deployed app shipped zero icons across eight surfaces. `rcf audit coverage --strict` had already flagged `application-spa-REQ-*` categories 5, 6, and 11 as uncovered `application-spa-REQ-*` requirements (no test cases bound to those ACs); the build proceeded because the project's own build queue did not include an FBS realising the blueprint's icon and token surfaces. The AC bound the class. The mechanism did not compel the surface.

**The principle.** For any AC that constrains project-source realisation (product surface, wired renderer, injected middleware), pair the AC with a mechanism the host project's build cycle already gates on. Three shapes work today:

- **Anchor the AC to a TAC the project must realise.** A TAC contribution names the responsibilities and dependencies of an architecture component; a TAC that the project does not realise leaves an unresolved `tacIds` reference on the story, and `rcf audit coverage`/`rcf define validate` catch that. Blueprint category surfaces (icons, semantic tokens, forms engine) should ship a TAC, not just a REQ, and the REQ/US should cross-link the TAC.
- **Require the AC be bound to a project-authored TC.** ACs are shipped without test files; the host project's build cycle is where TCs land. If your AC is truly runtime-observable, its rendered failure mode is what makes `rcf audit coverage --strict` refuse to declare the FBS done. Author the AC in a shape that a TC can bind exactly one runtime check to.
- **Bind the AC to the runtime-verify layer.** `rcf verify browser` and the `uiBaseline` pack inspect the deployed surface for smoke-level facts. A blueprint category that maps cleanly onto a browser-verify probe is one the ship gate compels; call it out in the AC so the host project wires the probe.

**What NOT to do.** Do not author an adherence AC as a document-level assertion the project can satisfy by adding a document. "The project declares an iconography ADR" is not the AC you want; "The rendered application surfaces the icon set at named component slots X, Y, Z" is. The first is trivially satisfied by copying a stub file; the second is what mechanism reach means. If you can only phrase the AC as document-level, the blueprint category needs a TAC or a runtime-verify pack alongside it before it ships.

**Author-side check.** Before you ship a blueprint category, walk every AC on it and answer: which project-side gate will refuse the FBS if this AC is not realised at the runtime surface? If your only answer is "the operator reads the AC and does the work", the category has a mechanism-reach gap. Log the gap in the blueprint's README under "Known mechanism-reach gaps" so the operator knows what to watch for; open a v1.1 issue on the rcf-lite repo for the mechanism side.

## 7a. AC-set sufficiency

Section 7 asks whether an AC is runtime-observable, which is coverage of MECHANISM. This section asks whether the AC SET on a story covers the story's runtime, which is coverage of SCENARIO. A story can satisfy the mechanism-reach principle on every AC it carries and still ship with the deployed surface silent on documented failure paths, because the mechanism-reach check bites one AC at a time.

**The rule.** Every failure path, error condition and boundary the blueprint's own implementation guide and TAC records describe must be traceable to at least one acceptance criterion on the story that owns the mechanism. A story whose mechanism has documented failure paths and asserts only the happy path is incomplete.

The rule is checkable against artefacts every blueprint already ships: the guide at `guide/<slug>.md`, the TAC records at `contributions/tacs/*.json`, and any standards-trace text on the ADR contribution entries. If the guide names a way the mechanism can fail and no AC on the owning story binds that way, the AC set is short.

**Scenario-class prompt list.** When authoring or reviewing a story, sweep the mechanism against every class the blueprint's guide or TACs describe. The list is a prompt, not a quota: a class the mechanism genuinely does not touch is skipped without an AC, and a class the guide names as a real path gets one.

- credential missing or invalid
- upstream non-2xx response
- rate limited or throttled
- request or wait timed out
- partial or interrupted write
- permission denied
- malformed input
- resource already exists
- resource gone or not found
- concurrent access on the same resource
- quota exhausted
- dependency not ready
- first run versus repeat run
- idempotency of a retried operation
- empty collection and maximal collection
- boundary values (zero, one, N, N+1)

**Worked example (illustrative).** The `deploy-hetzner-server` blueprint's `US-37101` (the provisioner facade opens on boot as the sole reader of `HETZNER_ACCOUNT_API_KEY` and fires `provisionerReady`) is a story whose guide describes two failure paths for the same mechanism: `HETZNER_ACCOUNT_API_KEY` unset in the applied secrets facade, and the `hcloud` binary absent from `PATH` when the elicited `provisioningTool` is `hcloud` (`blueprints/deploy-hetzner-server/guide/deploy-hetzner-server.md` prerequisites). A story with one happy-path AC leaves both silent. The AC set that closes the coverage looks like this:

- `AC-37101-1` (happy path). Given `HETZNER_ACCOUNT_API_KEY` set in the applied secrets facade and `hcloud` on `PATH`, when the provisioner opens on process boot, then only the provisioner module reads `HETZNER_ACCOUNT_API_KEY` (a source-tree scan refuses any other reader) and `provisionerReady` fires on the injected event sink with a payload of exactly `{tool, apiHost}`.
- `AC-37101-2` (credential missing). Given `HETZNER_ACCOUNT_API_KEY` unset in the applied secrets facade, when the provisioner opens, then the facade refuses with a named error kind, no `provisionerReady` fires, and the error record carries no token substring.
- `AC-37101-3` (dependency not ready). Given `provisioningTool: hcloud` and `hcloud` absent from `PATH`, when the provisioner opens, then the facade refuses with a named error kind and no `provisionerReady` fires.
- `AC-37101-4` (repeat boot idempotency). Given a completed first boot, when the process boots a second time against the same token, then the facade opens again and `provisionerReady` fires once per boot with the same payload shape (no accumulator drift across boots).

The count in the example is illustrative, not a floor. The count that lands is whatever the mechanism's documented paths require: two named paths in the guide implies at least two failure-mode ACs alongside the happy path, and edge cases the guide or TAC calls out (idempotency, empty and maximal inputs, boundary values) add one each.

**Single-AC stories are legal only where the mechanism has no documented failure path.** The check is a trace: read the guide entry and the anchored TAC, walk the failure paths named there, and count. If any named path lacks an AC on the owning story, the AC set is short and the story is incomplete. If no path is named and the mechanism is genuinely single-assertion (a manifest that either validates or does not; a metadata event with a fixed shape and no dependency on outside state), one AC is enough and the story carries a one-line note stating that the mechanism has no documented failure path in the guide, so the absence is traceable to a decision rather than an oversight.

**Where the machine-checkable enforcement lands.** The baseline-AC sweep under `packages/rcf-lite/src/req-baseline/` and `src/core/baseline-catalog/` is the mechanism the estate will grow to enforce this rule at gate time, by extending its `reqShapeClassification.shapes` enum to cover every blueprint family and populating `shapeClassification` on shipped REQ contributions. That extension is a separate follow-up and is not a prerequisite for this section taking effect. Until the gate fires, the rule is author-owned and reviewer-checked; the rows in section 6 of the [authoring checklist](blueprint-authoring-checklist.md) are the gate today.

## 7b. Fixed and template acceptance criteria

Section 7 asks whether an AC is runtime-observable; section 7a asks whether the AC SET on a story covers the runtime. This section asks a third question the first two do not: is each AC on the story the BLUEPRINT'S to fix or the APPLYING AGENT'S to set? A blueprint carries two different kinds of content, and treating them the same is how a blueprint drifts into being a project spec dressed in a blueprint's directory shape. A blueprint that decides for a project what works and what does not is a specification, not a blueprint. Acceptance criteria ship with the blueprint, but setting them for the project is the applying agent's work, and the guide's job is to tell that agent how to verify.

**Two categories, marked on every AC.**

- **`fixed` (mechanism-invariant).** True for every project applying this blueprint on this platform, with no per-project value. The Cloudflare Durable Object namespace comes into existence only through a Worker deploy carrying a migration, and the migration keyword on and after 2026-07-09 is `new_sqlite_classes`; the fact does not vary with the project. The blueprint must be RIGHT about these, because every application inherits the assertion and the applying agent cannot reasonably re-derive platform mechanics from scratch. That derivation is the value the blueprint sells. An applying agent may not weaken or drop a `fixed` AC; if one appears wrong for the project, that is a defect against the blueprint, escalated on the blueprint's repo, not edited locally.
- **`template` (project-parameterised).** The shape is given, the values are the project's. Storage limits, retention windows, elicited binding names, injected paths, the choice of storage backend when the blueprint elicits it: these are shape-fixed and value-open. The blueprint offers a starting AC; the applying agent SETS it against the project.

**Active disposition of every `template` AC.** The applying agent MUST actively dispose of every `template` AC on every story: accept as written, adjust with the project's values, or drop with a stated reason recorded against the story. Silent inheritance is a defect. This mirrors the "silent omission is not an option" clause in the define-lite elicitation requirements (`DL-REQ-ELICIT-02`) and it exists because "the agent will set them" degrades into "nobody set them" without a positive disposition step. That degradation is the same failure mode section 7a addresses at authoring time, applied here at application time; it is exactly how round-7 shipped 39 stories with one happy-path AC each and had every application inherit them unchanged.

**Vendor facts carry a URL and a verified-on date.** Any AC or guide statement that rests on a third-party platform fact carries the vendor documentation URL and the ISO-8601 date the fact was verified. Vendor truth rots without anyone touching the repo: `new_classes` was the correct Durable Object migration keyword when the DO blueprint was authored, and it became wrong on 2026-07-09 when Cloudflare closed the key-value backend to new namespaces and only `new_sqlite_classes` continued to mint one. A dated citation lets an applying agent tell a fresh fact from a stale one, and gives a reviewer of the shelf a trigger to re-verify before a re-ship.

**Section 7a binds at application time too.** The AC-set sufficiency rule applies to the AC set the APPLYING AGENT settles on, not only to the set the blueprint author shipped. When the applying agent has accepted, adjusted or dropped every `template` AC, the resulting set is re-swept against the scenario-class prompt list in section 7a; a class the guide names as a real path is still bound to at least one AC on the applied story. Without this edge an agent can satisfy the letter of 7a at authoring time and produce a thin set at application time, because dropping a `template` AC with a stated reason is legal and dropping the coverage of the path that AC bound is not.

**Worked example (illustrative).** The `platform-cloudflare-durable-objects` v1.0.0 blueprint's `US-33108` asserts that the applied project's `wrangler.toml` commits stable DO class names on both binding blocks and a migrations tag records the mint classes. The AC decomposes into a mechanism-invariant part and a project-parameterised part:

- The migration keyword `new_sqlite_classes` is `fixed`. It is a Cloudflare platform fact: on and after 2026-07-09, Durable Object namespaces mint only on the SQLite backend and the migration record must carry that keyword. The blueprint owns the assertion and cites `https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/` verified on 2026-09-08. An applying agent may not weaken it.
- The deploy-only creation path is `fixed`. A namespace exists only after a Worker deploy carrying the migration lands; there is no CLI verb, no dashboard control, no round-trip that mints one otherwise. Cited on the same page. `fixed`.
- The `[[durable_objects.bindings]]` binding names (`CELL`, `HUB` in the fixture) and the `class_name` values (`SingleCellObject`, `HubObject`) are `template`. The shape (two bindings on a `wrangler.toml`, each with a `name` and a `class_name`, each class also appearing in the migration record) is given; the actual names are the project's. The applying agent sets them.
- The storage-backend elicit (`sql` or `kv`) on `US-33103`'s `AC-33103-1` is `template`. That the blueprint supports BOTH backends is `fixed`; which backend the applied project asserts against follows the elicit answer and is `template`.

The disposition marker sits at the AC level, not the sub-clause level. An AC whose mechanism is `fixed` but whose assertion text references an elicited value is `template` overall, because the applying agent must substitute the project's value into the assertion before it binds. A shipped blueprint whose ACs blur the two concerns is not wrong to ship, but its `template` ACs must state which values the applying agent sets, so the disposition step is a fill-in rather than a rewrite. The DO blueprint's current AC prose intermixes fixed and template concerns in one string per AC; the backfill work (separate work item) restates each AC with the disposition marker and the parameter list on the `template` side.

**Where the machine-checkable enforcement lands.** The disposition marker wants to be a first-class field on the AC record: a `disposition: "fixed" | "template"` enum, and for `fixed` ACs whose truth rests on a vendor fact, a `vendorCitation: {url: string, verifiedOn: string}` object with the URL fetched and the ISO-8601 date the fact was verified. That extension lives in `@stravica-ai/rcf-schemas` and is a separate follow-up; it is not a prerequisite for this section taking effect. Until the schema field lands, the disposition and the citation live inline in the AC's `description` and the guide's cross-reference, and the rows in section 6 of the [authoring checklist](blueprint-authoring-checklist.md) are the gate today. The applying-agent side of the rule is carried in the managed agent-instructions block (`RULE 15: On blueprint apply, dispose every AC`), so `rcf init` and `rcf doctor` install and refresh it into every project's `CLAUDE.md` and `AGENTS.md` alongside the other rules of the loop.

## 7c. REQ-layer sufficiency

Section 7 asks whether an AC is runtime-observable; section 7a asks whether
the AC SET on a story covers the mechanism; section 7b asks whether each AC
is the blueprint's to fix or the applying agent's to set. Neither answers a
question a recent review of shipped blueprints surfaced repeatedly: is the
story there at all? A blueprint whose manifest declares a capability token,
or offers an elicit with an option value, is committing to behaviour a
project can rely on. If no requirement on the blueprint carries that
commitment, the token or the option can be selected and quietly ignored,
and no downstream check bites because no chain link asks after it.

**The rule.** Every capability token a blueprint declares on
`blueprint.json:capabilities[]`, and every option value a blueprint offers
on any `blueprint.json:elicits[].options[]` (or the value space named by
its `kind` when `options` is not enumerated), is backed by at least one
`must`-priority requirement on the blueprint before the blueprint ships. A
manifest with no `elicits` key is legal only when no requirement
description, guide passage or TAC responsibility names an apply-time
answer.

**Two defect shapes.** The rule bites on two shapes a recent review of
shipped blueprints found twenty-one instances of between them.

- **Declared capability without a covering requirement.** The manifest
  declares a token on `capabilities[]`. No requirement's description names
  the token or the contract behind it. A consumer blueprint that reads the
  applied capability set will accept the token and configure its surface
  on the assumption of a contract the provider blueprint never wrote down.
- **Elicited option without a covering requirement.** The manifest offers
  an option value on an `elicits[]` entry (an enum option, a bounded
  string value, a boolean branch). No requirement describes what the
  selected value does. The apply verb collects the answer, stores it on
  the sidecar file, and no subsequent gate checks that the applied
  behaviour matches the answer.

**Two supporting clauses.**

- **The `elicits`-key-legality clause.** A manifest that omits `elicits`
  entirely is legal only when no apply-time answer is named anywhere in
  the blueprint's requirements, guide, or TAC records. When a requirement
  description reads "the applied X" or "the elicited Y", or a guide
  section walks the operator through apply-time answers, the `elicits`
  key must exist and each named answer must appear on it. The reverse
  form of the rule catches the six blueprints the recent review found
  that describe apply-time answers in prose but ship no elicit block.
- **Reasoned removal.** A capability or option that appears on the
  manifest with no covering requirement is not fixed by inventing a
  requirement to match. Either the missing behaviour is added, in which
  case the requirement is authored and the AC set on the owning story is
  swept per section 7a; or the token or option is genuinely out of scope
  for the blueprint, in which case it is removed from the manifest and
  the CHANGELOG names the removal.

**Worked example (illustrative).** The `application-onboarding-tour`
blueprint's `blueprint.json` at v1.0.0 offers an elicit
`dismissal-policy` with three option values (`permanent`, `versionMajor`,
`versionMinor`). The blueprint's requirement set at the shipped version
carries no clause describing what each dismissal policy does: none of the
seven requirements binds the `permanent` behaviour (the checklist is
dismissed once and never returns), the `versionMajor` behaviour (a major
version bump re-surfaces the checklist), or the `versionMinor` behaviour
(any version bump re-surfaces it). The TAC that stores completion state
records versions in a shape consistent with all three, but "the shape can
carry the fact" is not the same as "a requirement asks after the fact".
An operator can select `versionMajor` at apply and the applied blueprint
will silently behave as `permanent`, because nothing on the chain says
otherwise.

The fix is to author one `must`-priority requirement whose description
names each of the three option values and gives each a runtime clause
(the `permanent` branch stores a terminal completion record and refuses
re-surfacing regardless of version bump; the `versionMajor` branch
compares stored and current versions on the major segment and re-surfaces
when the majors differ; the `versionMinor` branch re-surfaces when either
segment differs). One story on the same US band binds the three behaviours
as ACs per section 7a. The `dismissal-policy` elicit is now covered; the
apply verb's answer flows through a requirement, a story and an AC set to
a runtime observable a probe pack can bind.

**Where the machine-checkable enforcement lands.** The loader today
validates the shape of `capabilities[]` and `elicits[]` (kebab or camel
string, non-empty when present) and enforces the roles-registry cross
check. A future minor may extend the loader with two mechanical scans:
one that fails a manifest whose `capabilities[]` token is not named in
any contributed REQ's `description`, and one that fails a manifest whose
`elicits[]` option value is not named similarly. Both are string scans;
neither requires vocabulary knowledge. That extension is a separate
follow-up and is not a prerequisite for this section taking effect. Until
the loader fires, the rule is author-owned and reviewer-checked; the rows
in section 6 of the [authoring checklist](blueprint-authoring-checklist.md)
are the gate today.

## 7d. Positive-evidence verification

A verification artefact exists to prove that a property held. The property
is what the reader cares about, and the artefact is only as useful as its
statement of the property's observation. A gate row that greps for the
string "not wired" proves the string was absent from a run; a probe that
returns `verdict: pass` on the strength of a credential-readiness check
proves the credentials were readable; a seam test that asserts a literal
deprecated migration keyword proves the deprecated keyword was still in
the file. None of the three prove the property the artefact exists to
protect.

**The rule.** Every verification artefact in the RCF authoring, gate
and apply process asserts positive evidence of the property it exists to
protect, never the absence of a previously seen bad signature.

**Four positive-evidence shapes.** A verification artefact meets the rule
by carrying at least one of the four shapes below.

- **A real request identifier.** The artefact records a request id
  returned by the real engine under test (a vendor request id echoed on a
  response header, a transaction id from an idempotent verb, a subject id
  on an audit event). The presence of the id proves the request was
  issued and the engine answered; the id lets a later reader reopen the
  interaction against the same engine.
- **A response body excerpt.** The artefact records a distinctive
  excerpt of the response body the engine returned (a header value, a
  numeric field, a status code paired with a resource id). The excerpt
  proves the engine returned data of the expected shape, not that a
  local mock returned data of the expected shape.
- **A created-then-deleted resource id in an inventory diff.** The
  artefact records a resource id the probe created against the engine,
  and the same id absent from the post-run inventory. The pair proves
  the probe wrote and then cleaned up, and that the engine's inventory
  reflects the write.
- **A real deploy record.** The artefact records the runtime the deploy
  produced (a deployed URL that answers, a bytes-hash of the produced
  artefact, a container image digest). The record proves the shipped
  artefact reached the runtime, not that a local build succeeded.

**Env var declaration.** Every environment variable a probe or a fixture
reads is declared on the fixture's own manifest. The first-tier `CI_HAS_*`
env var that gates the account-bound branch is declared, and every
second-tier variable the branch reads once past the gate is declared too
(a per-resource id, a per-endpoint URL, a per-namespace binding). A probe
that short-circuits on an undeclared env var and returns `verdict: pass`
is a probe that proved nothing; the declaration and the checklist row
together refuse the return before it is committed.

**Account-bound skip.** A real-engine probe run without the account
credentials skips honestly. The probe records `accountBoundSkipped: true`
and a `reason` field naming the env var that was unset; the aggregate
verdict flips to `pass` at the delivery-ci-workflows layer per the
round-5 shape. A probe that returns without either positive evidence or
`accountBoundSkipped: true` is FAIL, whatever its verdict field says.

**Vendor citation on vendor facts.** Any assertion inside a probe or a
gate row that rests on a third-party platform fact carries the vendor
URL and the ISO-8601 date the fact was verified, per section 7b's vendor
citation clause. A gate row that greps for a literal engine-specific
string (a migration keyword, a header name, a config-file key) has as
much shelf-life as the vendor fact it embeds, and no more.

**Worked example (illustrative).** A recent shelf review of a Cloudflare
Queues concurrency probe found the probe's account-bound branch returned
`verdict: pass` with `accountBoundSkipped: true` whenever a second-tier
variable (a per-queue consumer worker URL) was unset, without the
fixture declaring the variable and without the probe naming the unset
in `reason`. The gate row that greped for `verdict: 'warn'` and the
string "not wired" passed because neither appeared, and the run
produced no evidence of the property the probe existed to protect
(concurrent delivery through the live binding). The rule-compliant
shape ships the fixture's env-var table naming the URL, refuses `pass`
unless the probe records a request id from a real `POST
/accounts/<id>/queues/<id>/messages` round trip or records
`accountBoundSkipped: true` with the exact reason
(`CI_HAS_CLOUDFLARE_ACCOUNT` unset, or the second-tier URL unset), and
carries the vendor URL and an ISO-8601 `verifiedOn` date on the Queues
API citation inside the probe.

**Where the machine-checkable enforcement lands.** The probe-pack
record-composition function
`composeBrowserVerificationRecord` in
`packages/rcf-lite/src/browser-verify/manifest-writer.js` is the seam.
The rule as amended reads: at record composition time, a per-check
record's `verdict: pass` is remapped to `verdict: fail` with `detail:
'positive-evidence-missing'` when the record carries neither an
`evidence` field of one of the four shapes above nor an
`accountBoundSkipped: true` field with a non-empty `reason`. The remap
happens inside record composition; the aggregate scalar returned by
`aggregateVerdict` in the same file (`'pass' | 'warn' | 'block'`) then
reflects the remapped record naturally. The composed record is what the
manifest carries, so the fail surfaces at the ship gate exactly where
the operator can act on it. Until the amendment lands in a package
minor, the rule is author-owned and reviewer-checked; the checklist
rows and the round-gate template row are the gate today.

## 7e. Single-definition ownership and authoring order

Section 7a asks whether the AC SET on a story covers the mechanism.
Section 7b asks whether each AC is the blueprint's to fix or the
applying agent's to set. Section 7c asks whether a story exists at all
for every declared capability and elicited option. Section 7d asks
whether every verification artefact carries positive evidence. Neither
answers a question a recent review of shipped blueprints kept
surfacing: when the same contract is written down in more than one
place, which one is authoritative and how do the others stay in step?

A blueprint's chain has two roots (PRD to REQ to US and AC; TAD to TAC
and ADR) plus a guide surface with no chain edge at all. The authoring
standard has specified no ORDER between the two roots and the guide, so
contracts (field names, header names, enums, wire shapes, boot events,
behaviour decisions) get restated in several layers and drift silently.
A recent review of shipped blueprints found this shape thirty-two
times across nineteen blueprints.

**The rule.** Every named contract is defined EXACTLY ONCE in one
owning artefact, and every other layer references it (by id and field)
rather than restating it. The owner is determined by the kind of
contract.

- **Wire shapes, schemas, field names, header names, enums, interface
  signatures: the TAC.** The TAC record's `interfaces[]` and
  `internalStructure` are the definitive source. REQs and ACs that need
  to name a field, header, enum member or wire shape do so by pointing
  at the owning TAC's field rather than restating the literal. Guide
  code fences either quote the TAC field literal or are generated from
  it.
- **Behaviour decisions with alternatives (fold vs drop, retry vs
  pause, hosted vs self-hosted, idempotent vs at-least-once): the
  ADR.** The ADR's `decision` block is the definitive source. Every TAC
  and AC that acts on the decision references the ADR by id.
- **Externally promised properties (a global staleness ceiling, an
  anti-enumeration guarantee, a forward-only migration invariant, a
  boot-event contract): the REQ.** The REQ's `description` is the
  definitive source. Every REQ carries a `deliveredBy` field naming the
  TAC or ADR that delivers the property; a REQ with no `deliveredBy`
  (or a `deliveredBy` pointing at a TAC whose responsibilities do not
  carry the delivery) is refused at the ownership lint.
- **The story (US): outcome and scope, not contract.** A US describes
  what a user does and why; the ACs it owns REFERENCE the contract
  owners rather than restating them. An AC's then-clause reads "the
  response matches `TAC-X.request.header`", not "the response carries
  `X-Foo`".
- **The guide: prose that reads humans, quoting the owners.** No new
  contract statements. A guide code fence is either a verbatim quote
  from the TAC (with an id-and-field cross-reference the lint checks)
  or is generated at build time from the TAC's schema. Freeform prose
  about when to reach for the blueprint is fine; a snippet that
  restates a field or a header is not.

Rule of thumb for the author: if a name, a shape or a value appears in
two artefacts and both spell it out, one of them is wrong to be
spelling it out. Move the literal to the owner and turn the other into
a reference.

**Authoring order that follows.** Ownership implies an order. TAC
interfaces and ADR decisions settle FIRST, because REQs need to point
at what delivers them and ACs need to point at what shape they observe.
Guide snippets are checked against (or generated from) the TAC
interface, so they follow the TAC too.

1. TAD and TAC interfaces plus ADR decisions (the contract owners).
2. REQs, each with a `deliveredBy` pointing at a settled TAC or ADR.
3. USs and their ACs, each referencing the owning TAC or ADR by id and
   field.
4. Guide, quoting or generating from the settled TACs and ADRs.

An author who works out of order (writes an AC that names a header
before the TAC owns it) can still finish, but must fold the header into
the TAC before shipping and turn the AC into a reference; the lint
refuses the ship otherwise. This is the same shape as RULE 15's
"actively dispose of every template AC": the discipline is that the
mechanism catches the shortcut, not that the author never takes it.

**Where the machine-checkable enforcement lands.** A new lint verb
lands under the `blueprint` group (`lint-consistency <source>`) and
runs two passes over a blueprint's own JSON and markdown. Pass 1 (single-definition
ownership): walk every TAC's `interfaces[]` and `internalStructure` to
collect the owned literals; walk every REQ, US, AC, ADR and guide
surface for restatements; refuse any literal restated outside its owner
without a back-reference, or any restatement that disagrees with the
owner. Pass 2 (REQ delivery): walk every REQ; for each REQ that
promises an externally observable property, walk its `deliveredBy`
link; refuse the REQ when the linked TAC's `responsibilities[]` and
`interfaces[]` do not carry the property, or when no link is declared.
The checklist rows in section 6 of the [authoring checklist](blueprint-authoring-checklist.md)
name the lint at the author-side gate; the release-train CI runs the
lint at the ship gate. A blueprint may suppress a specific pass-1
finding by naming its id in `README.md` under "Known
chain-consistency-lint suppressions" with a one-sentence reason;
pass-2 findings are not suppressible.

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
- **MUST clauses may land as `recommendedDefault: true` ADRs when the clause is choice-shaped** (per amendment A2, operator ruling 2026-09-04). A choice-shaped MUST is one where the standard fixes an outcome the operator picks between named alternatives at apply (a MUST from a policy that says "select one of the following identity providers"). The ADR carries `standardsTraceClause` set to the clause identifier; the alternative is documented in the ADR's consequences.
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

Section 7d refines the aggregate verdict. `pass` on a `checks[].run`
record is legal only when the record carries either an `evidence` field
(a request id, a response body excerpt, a created-then-deleted resource
id in an inventory diff, or a rendered-bytes hash), or an
`accountBoundSkipped: true` field with a non-empty `reason`. A record
with a `pass` verdict and neither field is remapped to `fail` at
aggregate time with `detail: "positive-evidence-missing"`. The remap
surfaces the defect at the ship gate; the composed record is what the
manifest carries. `preChecks[]` records the same way. A pack whose
author cannot supply either field for a check adjudicates the check as
`accountBoundSkipped: true` with the exact reason, or as a defect
against the check's authoring, never as `pass` on the strength of
absence.

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
