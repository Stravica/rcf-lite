# Security auth Keycloak blueprint (v1.0.0)

The twelfth content blueprint on the rcf-build-lite blueprint mechanism, category `security`. A Keycloak-committed sibling to `security-auth-magic-link`, `security-auth-clerk`, and `security-auth-oauth2` on the `authModel` global topic. Identity is delegated to a Keycloak realm the operator runs; the project owns the discovery client, the token verifier (JWKS or introspection per realm), the role adapter, the provider-routing seam, and the optional application session on top. Targeted at rcf-lite projects that have committed to a self-hosted Keycloak realm (or are running one already) and want the Keycloak-shaped decisions the vendor-neutral `security-auth-oauth2` sibling deliberately does not fix.

## Apply

```
rcf define blueprint add <path-to>/blueprints/security-auth-keycloak
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf define blueprint list` shows the applied entry grouped under the `security` category; `rcf define blueprint remove security-auth-keycloak` cleanly removes an unreferenced application.

Composing with `security-auth-magic-link`, `security-auth-clerk`, `security-auth-oauth2`, or any other blueprint contributing `scope: global` on `authModel` (which includes `application-spa` and `application-api-rest`) raises a `globalAdrTopic` conflict at add time. The four documented resolutions apply (adopt the incoming, keep the existing, project-level supersede ADR, or `--resolve authModel=project:<ADR-id>` on the add). See `docs/topics.md` for the deliberate-conflict statement.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, category `security`, and the 36 contributions with scope/topic on the one global ADR |
| Doc set | `contributions/` | 12 REQs, 13 USs (34 ACs), 5 TACs, 6 ADRs, all schema-valid and namespaced (`security-auth-keycloak-REQ-001` prefix family; `ADR-1201-security-auth-keycloak-auth-model` suffix family) |
| Local-container bootstrap | `assets/local-container/keycloak-bootstrap.md` | Shape a project harness follows to stand up the vendor's official image; no compose file lifted from any real deployment |
| Realm-config record | `assets/realm-skeleton/realm-config-shape.md` | The plain data-record shape a project maintains per realm; placeholder secrets only |
| Verifier middleware wiring | `assets/middleware/verifier-wiring.md` | HTTP-framework-agnostic Node middleware chain wiring the mechanism's five factories |
| Provider-router seam | `assets/provider-router/router-shape.md` | The pure-function contract a project's routing decision satisfies; generic OAuth2/OIDC vocabulary; no named second issuer |
| Mock introspection responder | `assets/mock-introspection/mock-introspection-shape.md` | RFC 7662 shape the harness stands up for the introspection-mode verify path |
| Guide | `guide/security-auth-keycloak.md` | Operator-facing: when to use it, when not, promotion signals, cost honesty |
| Coordination vocabulary | `docs/topics.md` | The global topic string and the shared id-band registry |

The doc set is contributions (copied into the project tree by `rcf define blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSs are the work of the implementing agent, not the blueprint; project constraints have to be applied at the time of creation. The blueprint contributes the WHAT (the Keycloak realm as identity source, the OIDC discovery contract, the JWKS-with-rotation-cache verification path, the RFC 7662 introspection path, the provider-routing seam, the Keycloak client-roles / realm-roles claim shape, the refresh-and-sign-out posture inherited from the realm, the session-vs-token separation, the local-first stand-up shape, the fail-safe boot postures, the runtime-verify posture with accountBound cloud smokes); the implementing agent derives the HOW-tasks (FBS) in the host project.

Deliberately not contributed: the OAuth2 authorisation-code flow controller itself (a project either draws it from the sibling `security-auth-oauth2` blueprint or authors one above this blueprint's five TACs; the Keycloak-committed decisions here bind the flow controller's provider adapter to a Keycloak realm and no more); a specific HTTP framework adapter (the middleware wiring is framework-agnostic; framework adapters are a project responsibility); a specific session-record store (opaque-handle mode injects it; in-memory is the reference default; a persistence-composed project points at a table); MFA specifics (Keycloak owns MFA at the realm surface); real realm data (a placeholder `example` realm name is the shape; no lifted config); any specific second identity provider (the provider-routing seam is generic; the blueprint does not name a second issuer, per the ratified reshape ruling).

## The one global decision

ADR-1201-security-auth-keycloak-auth-model ships `scope: global` on topic `authModel`. This is the project's single decision on how identity is proven, where credentials live, and what the wire credential looks like. Composing with `security-auth-magic-link`, `security-auth-clerk`, `security-auth-oauth2`, `application-spa`, `application-api-rest`, or any future `security-auth-*` blueprint conflicts here by design and expects a project-level ADR resolution. The composition-precedent (SPA + REST on `errorEnvelope` and `authModel`) is the same pattern the auth-family blueprints follow.

See `docs/topics.md` for the exact strings, the expected resolutions, and the AC id band allocation (security-auth-keycloak owns US 11101-11899 with US 11101-11113 in use, ADR/TAC suffix block 1201-1299; the third blueprint to sit in the four-digit ADR/TAC suffix space after security-auth-clerk (1001-1099) and security-auth-oauth2 (1101-1199)).

## Quality bar

Authorisation-code + PKCE (S256) as the sole flow; JWT verification via realm JWKS with a rotation cache defended by TTL and by kid-miss single-refresh; RFC 7662 introspection as the alternate verification mode selected per realm record; provider-routing seam expressed as a project-authored pure function; role extraction from Keycloak's `client-roles` or `realm-roles` claim path per record declaration; refresh rotation honours the realm's declared model (revoke-on-reuse tightened by the realm; soft rotation permitted where the operator has declared it); sign-out invalidates the project session with realm-side end-session opt-in per record; session-vs-token separation with opaque-handle sessions (default) or stateless bearer verification (opt-in) per realm; fail-safe boot posture declared per realm (strict / deferred / standby); runtime-verify against a local Keycloak container with cloud-tenant smokes marked accountBound and skipped with a stable-coded reason when credentials are unavailable. Every bar is carried by ACs in the doc set, not by this README.

## Known mechanism-reach gaps

Three named gaps at v1.0.0. First, AC-11112-2 (the live cloud-realm smoke against a project-owned Keycloak deployment or a managed Keycloak service) is `accountBound` and depends on operator-provided cloud-realm credentials plus a redirect URI registration at the deployment's admin console; those steps sit outside the blueprint's mechanism reach. The project's ship gate reads the honest coverage: the AC is covered by a project-authored TC whose latest outcome is `skipped` with reason `KEYCLOAK_LIVE_REALM_UNREACHABLE` when credentials are absent, and `pass` when the operator has driven the smoke. The `accountBound` skip does not fail CI and does not count as coverage passed for a project auditing its cloud-realm readiness; the ship-gate operator reads the AC and drives the smoke themselves before promoting a build past staging. The local Keycloak container path (REQ-009, US-11101 through US-11104, US-11107, US-11108, US-11110, US-11111) is NOT accountBound: the vendor's official container image runs standalone under a project's harness and the mechanism verifies against it end-to-end at every runtime-verify pass. Second, every AC on every story is bound to at least one TAC that the host project must realise, and every AC's `then` clause is runtime-observable in the deployed application (redirect-inspection for the authorise URL shape, token-exchange-request inspection for the PKCE verifier presentation, response-cookie inspection for the session-cookie contract, `request.auth` shape inspection for the Principal reduction, mock-introspection response substitution for the opaque-token classes, JWKS mutation for the JWT refusal classes, session-record store inspection for refresh-token rotation, cookie-clear inspection for sign-out, `Location`-header inspection for realm-side sign-out redirect). A project that applies this blueprint and does not realise a TAC leaves an unresolved `tacIds` reference on the story that `rcf define validate` and `rcf audit coverage` refuse. Third, the flow controller itself (the state machine that mints the pending-flow record, builds the authorisation redirect, and drives the callback) is NOT contributed by this blueprint at v1.0.0: a project either composes the vendor-neutral sibling `security-auth-oauth2` (which contributes TAC-1101-security-auth-oauth2-flow-controller) and points its provider-adapter at a Keycloak realm through this blueprint's discovery client and verifier, or the project authors a project-side flow controller above this blueprint's five TACs. The two composition paths are equally valid; the blueprint documents both in the guide.

## Composition intent (deliberate)

- Applying this blueprint on top of `security-auth-magic-link`, `security-auth-clerk`, `security-auth-oauth2`, `application-spa`, or `application-api-rest` raises a `globalAdrTopic` conflict on `authModel`. That is intended: one project has one authentication model, and the surfacing is the mechanism's promise. Resolution paths are documented on `docs/topics.md`.
- Sibling PRs open or recently merged at this pass: `blueprint/security-auth-oauth2` (band 10101-10899 US, 1101-1199 ADR/TAC). Zero id-band overlap.
