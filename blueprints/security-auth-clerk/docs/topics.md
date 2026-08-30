# security-auth-clerk blueprint coordination vocabulary

This file is the security-auth-clerk half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | security-auth-clerk contribution | Origin | Composition note |
|---|---|---|---|
| `authModel` | ADR-1001-security-auth-clerk-auth-model | Reused from the SPA vocabulary (`application-spa` contributes the client half; `application-api-rest` contributes the server half; `security-auth-magic-link` contributes the passwordless magic-link identity model). This blueprint contributes a Clerk-hosted identity model on the same topic string on purpose. | The one project-wide decision on how identity is proven, where credentials live, and what the wire credential looks like. Composing this blueprint with any of `application-spa`, `application-api-rest`, `security-auth-magic-link`, or a future `security-auth-oauth2` / `security-auth-keycloak` conflicts here by design; the expected resolution is one project-level ADR that fixes the identity surface (Clerk-hosted per this blueprint, or magic-link, or another) and maps it onto the client and server halves' cookie shape and 401-redirect posture |

The security-auth-clerk blueprint claims one global topic. Every other contribution is scope-local (ADR-1002 through ADR-1005 name the middleware-boundary shape, the authorisation-adapter contract, the claims-mapping discipline, and the session-lifecycle posture without contributing global topics; a composing blueprint that holds a different opinion on any of them authors its own project-level ADR if it wants to override).

Rules for new topics (inherited from the application-spa, application-api-rest, security-auth-magic-link, persistence-data-sqlite, ci-pipeline, observability-essentials, and security-secrets-management vocabularies, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`identity`, `identityProvider`, `authVendor`, `signIn` are all wrong when `authModel` already exists).

## Id number bands (registry bootstrap)

AC ids (and therefore US numeric ids, which anchor them) are NOT namespaced by the 0.4.4 schema grammar; the band allocation IS the AC-collision enforcement mechanism. Composing blueprints take a fresh band rather than proposing namespaced AC ids. Band allocation is ratified policy (2026-08-19); this table is the shared registry-bootstrap replicated across every shipped and forthcoming blueprint's `docs/topics.md` until a mechanism-side central registry lands (v1.1 candidate).

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-spa (was spa) | 1101-1899 | 2xx | shipped v1.0.0 | `clientRouting`, `theming`, `clientState`, `errorEnvelope`, `authModel` |
| application-api-rest (was rest) | 2101-2899 | 3xx | shipped v1.0.0 | `errorEnvelope`, `authModel`, `apiVersioning`, `logging` |
| security-auth-magic-link (was auth) | 3101-3899 | 5xx | shipped v1.0.0 | `authModel` |
| email-smtp-resend | 4101-4899 | 4xx | round-2 sibling PR | none |
| persistence-data-sqlite (was persistence) | 5101-5899 | 6xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| ci-pipeline (folds into a v2 CI workflow set) | 6101-6899 | 7xx | shipped v1.0.0 | `ciGates`, `strictCoverageGate` |
| observability-essentials (was observability) | 7101-7899 | 8xx | shipped v1.0.0 | `healthProbes`, `readinessSemantics`, `statusPageContract` |
| security-secrets-management | 8101-8899 | 9xx | shipped v1.0.0 | `secretsSource` |
| security-auth-clerk (this package) | 9101-9899 | 10xx (1001-1099) | shipped v1.0.0 (US 9101-9111, ADR-1001 to ADR-1005, TAC-1001 to TAC-1004) | `authModel` |
| security-auth-oauth2 | 10101-10899 | 11xx (1101-1199) | reserved, round-2 sibling | expected `authModel` |
| security-auth-keycloak | 11101-11899 | 12xx (1201-1299) | reserved, round-2 sibling | expected `authModel` |
| deploy-cloudflare-workers | 12101-12899 | 13xx (1301-1399) | reserved, round-2 | tbd |
| persistence-data-d1 | 13101-13899 | 14xx (1401-1499) | reserved, round-2 | tbd |
| observability-probe-endpoints | 14101-14899 | 15xx (1501-1599) | reserved, round-2 | tbd |

US 9101-9110 sit at the LOW end of the 9101-9899 band on purpose. A project-side story that mechanically derives from a security-auth-clerk REQ id into the number `9110` would collide against security-auth-clerk-US-9110 in this package; the band leaves headroom at the HIGH end (US 9181-9899) so a project's own stories anchored to security-auth-clerk REQs can allocate without conflict. The watchpost run4 lesson applies here too.

ADR and TAC suffixes for this blueprint widen to four digits (1001-1099) because the three-digit space fills at 9xx (security-secrets-management). Sibling round-2 auth blueprints (security-auth-oauth2, security-auth-keycloak) will continue the widening at 1101-1199 and 1201-1299 respectively; the shipped shelf has not carried four-digit suffixes before this blueprint, so the fallback rule on this PR's cover note applies if the rcf-schemas grammar refuses that shape.

## Shared expectations for future composing blueprints

- Reuse `authModel` exactly as spelled here (matching the existing SPA, REST, and security-auth-magic-link contributions) when your blueprint holds an opinion on the project's identity surface, credential shape, or sign-in flow; contribute your own scope:global ADR on that string and let composition surface the pairing. A vendor-committed auth blueprint (security-auth-oauth2 against a named provider, security-auth-keycloak against a named IdP shape) conflicts here by design; the operator resolves at apply.
- Middleware boundary shape (ADR-1002), authorisation-adapter contract (ADR-1003), claims-mapping discipline (ADR-1004), and session-lifecycle posture (ADR-1005) are scope-local. A composing blueprint that holds an opinion on any of them authors its own project-level ADR; none of them are minted as globals because the space of legitimate variations is smaller than the space of legitimate `authModel` variations.
- The `signInStrategy` config surface (REQ-005) is not a global topic string. A project composes this blueprint with an OAuth2 or Keycloak sibling and reconciles the enabled strategy set at the project's config module; the mechanism does not enforce a single strategy vocabulary across auth-family blueprints because each vendor names its strategies differently.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by every shipped blueprint), `metricsExport` and `tracingProtocol` (natural globals for a metrics or tracing blueprint), `emailWebhookContract` (a project intending to fan email-delivery events into a shared bus would benefit from a global here; email-smtp-resend explicitly does not mint it). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.

## Deliberate-conflict statement

This blueprint's ADR-1001 on `authModel` is a Clerk-committed sibling to `security-auth-magic-link`'s ADR-501-security-auth-magic-link-model on the same topic string. Applying both on one project raises a `globalAdrTopic` conflict the operator resolves via one of the four documented resolutions (adopt one, keep the existing one, author a project-level supersede ADR, or `--resolve authModel=project:<ADR-id>` on the add). The pairing precedent is `application-spa` + `application-api-rest` on `errorEnvelope` and `authModel`; this blueprint reuses the same composition-precedent pattern rather than minting a new one.

## Rename awareness

Cross-references in this blueprint's prose use the target-state slugs from the ratified renames pass: `security-auth-magic-link` (for the shipped `auth` blueprint), `persistence-data-sqlite`, `observability-essentials`, `application-spa`, `application-api-rest`. If the rename PR has not yet merged when this blueprint ships, a rebase against the rename PR is required before merge; the cross-references above stay valid at the target state.
