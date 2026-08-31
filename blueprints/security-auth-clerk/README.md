# Security auth Clerk blueprint (v1.0.0)

The tenth content blueprint on the rcf-build-lite blueprint mechanism, category `security`. A Clerk-committed sibling to `security-auth-magic-link` on the `authModel` global topic: Clerk hosts the identity surface (users, sessions, sign-in UX, credential storage, MFA, account recovery); the project owns a framework-agnostic middleware boundary, a session verifier confined to one module, a Clerk-claim-to-project-verb authorisation adapter, and a reduced principal shape the rest of the codebase reasons against. Targeted at small greenfield rcf-lite projects that want hosted identity without building the user-and-session surface themselves; larger deployments supersede the vendor by superseding ADR-1001 with a project-level ADR and swapping the middleware and verifier adapters.

## Apply

```
rcf define blueprint add <path-to>/blueprints/security-auth-clerk
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf define blueprint list` shows the applied entry grouped under the `security` category; `rcf define blueprint remove security-auth-clerk` cleanly removes an unreferenced application.

Composing with `security-auth-magic-link` (or any other blueprint contributing `scope: global` on `authModel`, which includes `application-spa` and `application-api-rest`) raises a `globalAdrTopic` conflict at add time. The four documented resolutions apply (adopt the incoming, keep the existing, project-level supersede ADR, or `--resolve authModel=project:<ADR-id>` on the add). See `docs/topics.md` for the deliberate-conflict statement.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, category `security`, and the 29 contributions with scope/topic on the one global ADR |
| Doc set | `contributions/` | 9 REQs, 11 USs (25 ACs), 4 TACs, 5 ADRs, all schema-valid and namespaced (`security-auth-clerk-REQ-001` prefix family; `ADR-1001-security-auth-clerk-auth-model` suffix family) |
| React-family sample | `assets/wiring/clerk-provider-react.md` | The shape of a `ClerkProvider` wiring in a React-family client tier: where the provider mounts, what the SPA blueprint's session-and-redirect posture composes with |
| Vue-family sample | `assets/wiring/clerk-provider-vue.md` | The same shape rendered for a Vue-family client tier so the operator can pattern-match without a framework translation step |
| Middleware sample | `assets/middleware/node-middleware-shape.md` | The framework-agnostic middleware boundary contract (`verify(request)`), with adapter samples for Express and Fastify |
| Role-claim mapping | `assets/authorisation/role-claim-mapping-sample.md` | A worked verb-to-role mapping-table example, with the reduction from Clerk's `org:role` claim shape into the project's `roles` array |
| Guide | `guide/security-auth-clerk.md` | Operator-facing: when to use it, when not, the promotion signals for the OAuth2 and Keycloak siblings, the operator decisions that remain open, the cost-honesty paragraph |
| Coordination vocabulary | `docs/topics.md` | The one global-topic string this blueprint contributes and the shared id band registry (application-spa, application-api-rest, security-auth-magic-link, email-smtp-resend, persistence-data-sqlite, delivery-ci-workflows, observability-essentials, security-secrets-management, security-auth-clerk) |

The doc set is contributions (copied into the project tree by `rcf define blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSs are the work of the implementing agent, not the blueprint; project constraints have to be applied at the time of creation. The blueprint contributes the WHAT (Clerk-hosted identity, the `__session` cookie transport, the middleware boundary shape, the authorisation-adapter contract, the claims-mapping discipline, the session-lifecycle posture, the `signInStrategy` config surface, the read-only provisioning posture, the delegated rate-limit posture, the accountBound runtime-verify posture); the implementing agent derives the HOW-tasks (FBS) in the host project, where the ACs contributed here get picked up by the project's own build sequencing.

Deliberately not contributed: a Clerk SDK version pin (the blueprint fixes the shape, not the version; the project's package manifest pins the SDK); MFA configuration (Clerk owns MFA at the hosted surface; the blueprint delegates); a Clerk-webhook consumer contract (out of scope for the default; a project that needs one adds one project-authored TAC and one scope-local ADR); a project-side user table or organisation table (Clerk is authoritative; a project that mirrors state into a local table does so through a project-authored consumer, not through this blueprint); a project-side rate limiter or anti-enumeration defence on the sign-in flow (Clerk-delegated per REQ-007); a fixed sign-in strategy choice (fixed shape per REQ-005, choice is project-owned); an OAuth2 provider list (that is the sibling `security-auth-oauth2` blueprint's territory when it ships); a Keycloak realm configuration (that is `security-auth-keycloak`'s territory when it ships).

## The one global decision

ADR-1001-security-auth-clerk-auth-model ships `scope: global` on topic `authModel`. This is the project's single decision on how identity is proven, where credentials live, and what the wire credential looks like. Composing with `security-auth-magic-link`, `application-spa`, `application-api-rest`, or any future `security-auth-*` blueprint conflicts here by design and expects a project-level ADR resolution. The composition-precedent (SPA + REST on `errorEnvelope` and `authModel`) is the same pattern.

See `docs/topics.md` for the exact strings, the expected resolutions, and the AC id band allocation (security-auth-clerk owns 9101-9899, ADR/TAC suffix block 10xx / 1001-1099; this is the first blueprint whose ADR/TAC suffix crosses into four digits).

## Quality bar

A framework-agnostic middleware boundary as the single point of authentication decision on the server; every runtime path that needs the caller's identity reads the reduced Principal shape attached at `request.auth`; the Clerk SDK is imported by exactly two modules (middleware wiring and session verifier); the wire credential is Clerk's `__session` cookie with Secure, HttpOnly, and SameSite=Lax; a tampered cookie is rejected with an audit event carrying no cookie value; every authorisation check goes through the adapter's `can` or `assert` and speaks in project verbs, never in Clerk role or claim vocabulary; role-based UI slots render only when the adapter grants the verb and the corresponding server-side handler enforces the same verb through `assert`; a Clerk-initiated sign-out invalidates subsequent requests within the documented `revocationCheckIntervalMs`; the sign-in surface applies no project-authored rate limiter (Clerk-delegated); user and organisation mutations against Clerk are confined to a provisioning script directory (not a request handler); the `signInStrategy` config surface fixes the shape not the choice; runtime-verify ACs are `accountBound` and skip with a stable-coded reason when Clerk is unreachable rather than passing on a fake. Every bar is carried by ACs in the doc set, not by this README.

## Known mechanism-reach gaps

None at v1.0.0, given the same posture the security-secrets-management blueprint takes: every AC on every story is bound to at least one TAC that the host project must realise, and every AC's `then` clause is runtime-observable (cookie-jar inspection for the transport contract, `request.auth` shape inspection for the principal reduction, source-tree import scans for the Clerk-SDK boundary, `can` and `assert` return values for the authorisation adapter, page-render inspection for the UI-slot gating, live sign-out plus replay for the revocation behaviour, live rate-limit burst against Clerk for the delegation posture, and source-tree call-site scans for the read-only provisioning posture). The mechanism-reach principle from the authoring standard section 7 is satisfied at ship: a project that applies this blueprint and does not realise a TAC leaves an unresolved `tacIds` reference on the story that `rcf define validate` and `rcf audit coverage` refuse. The one operational surface a project must own is the middleware boundary implementation for its specific HTTP framework (an Express shim, a Fastify plugin, a Workers fetch wrapper) plus the vendor adapter inside the session verifier; those responsibilities are stated as TAC interfaces, not as smuggled runtime probes. Two ACs whose runtime observability depends on the operator's Clerk deployment reachability are AC-9107-2 (revocation propagation window) and AC-9109-2 (Clerk-documented rate-limit response shape): both are accountBound and the runtime-verify skip mechanism named on AC-9110-2 covers them when Clerk is unreachable.
