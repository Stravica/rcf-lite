# security-auth-oauth2 blueprint coordination vocabulary

This file is the security-auth-oauth2 half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | security-auth-oauth2 contribution | Composition intent |
|---|---|---|
| `authModel` | ADR-1101-security-auth-oauth2-auth-model | Deliberate conflict on the same string minted by `security-auth-magic-link` (ADR-501), `security-auth-clerk` (ADR-1001), the client half of `application-spa` (ADR-205), and the server half of `application-api-rest` (ADR-304). This blueprint's shape is delegated identity via OAuth2 authorisation-code + PKCE against a project-configured IdP; a composing blueprint that holds a different opinion on the authentication model contributes its own scope:global ADR on this exact string and lets composition surface the pairing. Expected resolution: one project-level ADR that fixes the project's authentication model for both the client tier and the server tier, with a resolution recorded on `manifest.resolutions[]` or via `--resolve authModel=project:<ADR-id>` on the add |

The security-auth-oauth2 blueprint claims one global topic. Every other contribution is scope-local (ADR-1102 through ADR-1106 name the provider-abstraction contract shape, the PKCE discipline, the session-bridge shape, the refresh-token posture, and the multi-provider routing without contributing global topics; a composing blueprint that holds a different opinion on any of them authors its own project-level ADR if it wants to override).

Rules for new topics (inherited from the application-spa, application-api-rest, security-auth-magic-link, security-auth-clerk, persistence-data-sqlite, delivery-ci-workflows, observability-essentials, and security-secrets-management vocabularies, restated as law): lower camelCase, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`auth`, `authentication`, `identityProvider`, `oauthProvider` are all wrong when `authModel` already exists).

## The deliberate authModel conflict, restated

This blueprint is the vendor-neutral shape of the `authModel` decision. Three other shipped auth-family blueprints hold vendor-specific or model-specific shapes on the same topic:

- `security-auth-magic-link` (ADR-501): passwordless magic-link with server-issued opaque cookie sessions. Local-first, no third-party identity dependency.
- `security-auth-clerk` (ADR-1001): hosted identity via Clerk; the vendor owns the sign-in surface, credential storage, MFA, and account recovery; the project owns a middleware boundary against Clerk's session-verification.
- `security-auth-oauth2` (ADR-1101, this blueprint): delegated identity via OAuth2 authorisation-code + PKCE against any project-configured IdP. Vendor-neutral; the project drops in the provider it wants.
- `security-auth-keycloak` (planned, ADR-12xx suffix block reserved): self-hosted Keycloak realm as the identity source. Vendor-committed; larger ops footprint.

Composing any two of these on one project raises a `globalAdrTopic` conflict on `authModel` at `rcf define blueprint add`. The four documented resolutions apply: adopt the incoming, keep the existing, author a project-level supersede ADR, or `--resolve authModel=project:<ADR-id>` on the add. The composition-precedent (SPA + REST on `errorEnvelope` and `authModel`) is the same pattern the client half and the server half of the wire contract have already established; the auth-family blueprints follow it.

## Id number bands (registry bootstrap)

AC ids (and therefore US numeric ids, which anchor them) are NOT namespaced by the 0.4.4 schema grammar; the band allocation IS the AC-collision enforcement mechanism. Composing blueprints take a fresh band rather than proposing namespaced AC ids. Band allocation is ratified policy (2026-08-19, extended by round-2 outcomes 2026-08-30 for the four-digit ADR/TAC suffix widening); this table is the shared registry-bootstrap replicated across every shipped and forthcoming blueprint's `docs/topics.md` until a mechanism-side central registry lands (v1.1 candidate).

This table is maintained shelf-wide across every blueprint's `docs/topics.md`. Rows are recorded at ship, never predicted.

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
| observability-probe-endpoints | 14101-14899 | 15xx | shipped v1.1.0 | `healthProbes`, `readinessSemantics` |

US 10101-10111 sit at the LOW end of the 10101-10899 band on purpose. A project-side story that mechanically derives from a security-auth-oauth2 REQ id into the number `10111` would collide against security-auth-oauth2-US-10111 in this package; the band leaves headroom at the HIGH end (US 10181-10899) so a project's own stories anchored to security-auth-oauth2 REQs can allocate without conflict. The watchpost run4 lesson applies here too.

The ADR/TAC suffix block 1101-1199 is the second block to cross into the four-digit suffix space; `security-auth-clerk` opened the four-digit door at 1001-1099. Every shipped blueprint continues to load, validate, and audit against this shape without a schema change: rcf-schemas 0.5.0 `adrId` and `tacId` patterns are `^ADR-\d{3,}(-[a-z0-9]+...)?$` (three-digit minimum, unbounded above); four-digit and higher suffixes validate verbatim. The registry table above records the growth for a downstream author reaching for the next block.

## Shared expectations for future composing blueprints

- Reuse `authModel` exactly as spelled here when your blueprint holds an opinion on the project's authentication model; contribute your own scope:global ADR on that string and let composition surface the pairing.
- Provider-abstraction contract (ADR-1102), PKCE discipline (ADR-1103), session-bridge shape (ADR-1104), refresh-token posture (ADR-1105), and multi-provider routing (ADR-1106) are scope-local. A composing blueprint that holds an opinion on any of them authors its own project-level ADR; none of them are minted as globals because the space of legitimate variations is smaller than the space of legitimate authentication-model variations.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by every shipped blueprint), `metricsExport` and `tracingProtocol` (natural globals for a metrics or tracing blueprint), `sessionStore` (unclaimed; a future session-persistence-committed blueprint's natural global, and the shape this blueprint's session-bridge is deliberately open on). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.
