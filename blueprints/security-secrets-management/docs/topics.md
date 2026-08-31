# security-secrets-management blueprint coordination vocabulary

This file is the security-secrets-management half of the cross-blueprint contract. The Phase 1 conflict detector matches scope:global ADR topics by EXACT string equality, and AC ids are unnamespaced by the 0.4.4 grammar. Any blueprint intended to compose with this one must reuse these exact strings and respect these bands.

## Global ADR topics this blueprint contributes (exact strings)

| Topic string | security-secrets-management contribution | Origin | Composition note |
|---|---|---|---|
| `secretsSource` | ADR-901-security-secrets-management-secrets-source | Minted here; pre-cleared as unclaimed against application-spa (`clientRouting`, `theming`, `clientState`, `errorEnvelope`, `authModel`), application-api-rest (`errorEnvelope`, `authModel`, `apiVersioning`, `logging`), security-auth-magic-link (`authModel`), persistence-data-sqlite (`persistenceStore`, `migrationDiscipline`), ci-pipeline (`ciGates`, `strictCoverageGate`), observability-essentials (`healthProbes`, `readinessSemantics`, `statusPageContract`), and the hello-panel walkthrough exemplar (`operatorPanel`) | The one project-wide source of truth for secret material: a repo-root `secrets.yaml` manifest plus a vendor-agnostic Secrets Manager client. A composing blueprint that holds a different opinion on the secrets source (a vendor-committed opinionated blueprint, a config-server pattern, a plaintext-committed pattern for a public reference project) contributes its own scope:global ADR on this exact string and lets composition surface the pairing. Expected resolution: one project-level ADR that fixes the source shape and the vendor selection |

The security-secrets-management blueprint claims one global topic. Every other contribution is scope-local (ADR-902 through ADR-905 name the default vendor, the agent access discipline, the `.env` reflection posture, and the rotation-and-audit posture without contributing global topics; a composing blueprint that holds a different opinion on any of them authors its own project-level ADR if it wants to override).

Rules for new topics (inherited from the application-spa, application-api-rest, security-auth-magic-link, persistence-data-sqlite, ci-pipeline, and observability vocabularies, restated as law): lower camel case, one concept per topic, no version suffixes. A topic names the decision area, not the chosen answer. Do not mint variants of existing strings (`secrets`, `secretsStore`, `vault`, `secretsVendor`, `credentialsSource` are all wrong when `secretsSource` already exists).

## Id number bands (registry bootstrap)

AC ids (and therefore US numeric ids, which anchor them) are NOT namespaced by the 0.4.4 schema grammar; the band allocation IS the AC-collision enforcement mechanism. Composing blueprints take a fresh band rather than proposing namespaced AC ids. Band allocation is ratified policy (2026-08-19); this table is the shared registry-bootstrap replicated across every shipped and forthcoming blueprint's `docs/topics.md` until a mechanism-side central registry lands (v1.1 candidate).

This table is maintained shelf-wide across every blueprint's `docs/topics.md`. Rows are recorded at ship, never predicted.

| Blueprint | US band | ADR/TAC suffix block | Status | Global topics |
|---|---|---|---|---|
| application-spa | 1101-1899 | 2xx | shipped v1.3.0 | `clientRouting`, `theming`, `clientState`, `errorEnvelope`, `authModel` |
| application-api-rest | 2101-2899 | 3xx | shipped v1.0.0 | `errorEnvelope`, `authModel`, `apiVersioning`, `logging` |
| security-auth-magic-link | 3101-3899 | 5xx | shipped v1.0.0 | `authModel` |
| email-smtp-resend | 4101-4899 | 4xx | shipped v1.0.0 | none |
| hello-panel (walkthrough exemplar) | 4101-4899 | 4xx | doc-reserved; teaching exemplar in `packages/rcf-lite/docs/blueprint-authoring-walkthrough.md`, not shipped as a blueprint directory | `operatorPanel` |
| persistence-data-sqlite | 5101-5899 | 6xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| ci-pipeline | 6101-6899 | 7xx | shipped v1.0.0 | `ciGates`, `strictCoverageGate` |
| observability-essentials | 7101-7899 | 8xx | shipped v1.0.0 | `healthProbes`, `readinessSemantics`, `statusPageContract` |
| security-secrets-management | 8101-8899 | 9xx | shipped v1.0.0 | `secretsSource` |
| security-auth-clerk | 9101-9899 | 10xx | shipped v1.0.0 | `authModel` |
| security-auth-oauth2 | 10101-10899 | 11xx | shipped v1.0.0 | `authModel` |
| security-auth-keycloak | 11101-11899 | 12xx | shipped v1.0.0 | `authModel` |
| deploy-cloudflare-workers | 12101-12899 | 13xx | shipped v1.0.0 | `deploymentTarget` |
| persistence-data-d1 | 13101-13899 | 14xx | shipped v1.0.0 | `persistenceStore`, `migrationDiscipline` |
| observability-probe-endpoints | 14101-14899 | 15xx | shipped v1.0.0 | `healthProbes`, `readinessSemantics` |

US 8101-8110 sit at the LOW end of the 8101-8899 band on purpose. A project-side story that mechanically derives from a security-secrets-management REQ id into the number `8110` would collide against security-secrets-management-US-8110 in this package; the band leaves headroom at the HIGH end (US 8181-8899) so a project's own stories anchored to security-secrets-management REQs can allocate without conflict. The watchpost run4 lesson applies here too.

## Shared expectations for future composing blueprints

- Reuse `secretsSource` exactly as spelled here when your blueprint holds an opinion on the project's secrets source-of-truth model; contribute your own scope:global ADR on that string and let composition surface the pairing. A vendor-committed opinionated blueprint (a Vault-specific blueprint, an AWS Secrets Manager blueprint, a Doppler blueprint) will conflict here by design and expect a project-level ADR resolution.
- Vendor choice sits at ADR-902 (scope-local) by design: the contract is at ADR-901, the default is at ADR-902. A composing blueprint that wants a different DEFAULT vendor without changing the contract does not conflict on `secretsSource`; the operator supersedes ADR-902 with a project-level ADR and swaps the vendor adapter.
- Agent access discipline (ADR-903), `.env` reflection posture (ADR-904), and rotation-and-audit posture (ADR-905) are scope-local. A composing blueprint that holds an opinion on any of them authors its own project-level ADR; none of them are minted as globals because the space of legitimate variations is smaller than the space of legitimate `secretsSource` variations.
- Global topics that plausibly belong to a future blueprint and are NOT claimed by any shipped blueprint: `messageSerialisation` and `deliverySemantics` (a message-consumer blueprint's natural globals), `caching` (unclaimed by every shipped blueprint), `metricsExport` and `tracingProtocol` (natural globals for a metrics or tracing blueprint). Define any of these in your own package's topics doc, in this file's format, and consider whether the band-registry table above needs your slug added.
