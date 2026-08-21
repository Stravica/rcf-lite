# Auth blueprint (v1.0.0)

The third content blueprint on the rcf-build-lite blueprint mechanism (design brief v2, ratified; Phase 4 of the blueprint programme). Scope: passwordless magic-link sign-in with server-issued opaque cookie sessions, single deployable, pluggable email delivery and pluggable principal registry, targeted at small greenfield rcf-lite projects. Composes with the SPA blueprint (client half) and the REST blueprint (server half) by design, contributing one deliberate scope:global conflict on `authModel`.

## Apply

```
rcf blueprint add <path-to>/blueprints/auth
```

Phase 1 resolves local path sources only; registry and git-ref resolution is a mechanism follow-up. Apply is idempotent; `rcf blueprint list` shows the applied entry; `rcf blueprint remove auth` cleanly removes an unreferenced application.

## Anatomy

| Piece | Where | What |
|---|---|---|
| Metadata | `blueprint.json` | Slug, version, and the 32 contributions with scope/topic on the one global ADR |
| Doc set | `contributions/` | 11 REQs, 11 USs (37 ACs), 5 TACs, 5 ADRs, all schema-valid against rcf-schemas 0.4.5 and namespaced (`auth-REQ-001` prefix family; `ADR-501-auth-magic-link-model` suffix family) |
| Email templates | `assets/email-templates/magic-link-email.md` | The text and HTML bodies the routes hand to the adapter for magic-link delivery, with placeholders for base URL, token URL, and expiry window |
| Stub adapter reference | `assets/email-templates/stub-adapter.md` | The record-only stub the blueprint ships for tests, with the exact call log shape and outcome shape |
| Principal registry samples | `assets/principal-registry-samples/single-address.md` | The single-address registry implementation for solo-operator deployments |
| Principal registry samples | `assets/principal-registry-samples/allow-list-file.md` | An allow-list file registry pattern for small teams |
| Guide | `guide/auth.md` | Operator-facing: when to use it, when not, what stays your call, and the promotion signal for the future auth-oidc blueprint |
| Coordination vocabulary | `docs/topics.md` | The one global-topic string this blueprint contributes, the shared id band registry (spa, rest, auth, hello-panel, persistence, ci-pipeline, observability) |

The doc set is contributions (copied into the project tree by `rcf blueprint add`); the guide, assets, and docs are package-resident references. Guide rendering into `rcf/knowledge/docs/blueprint-guides/` and asset ingestion are mechanism follow-ups; until they land, the working agent reads them from the applied blueprint's source path recorded in `manifest.blueprints[].source`.

## What it contributes, and what it deliberately does not

Contributed kinds: REQ, US (with inline ACs), TAC, ADR. Adherence is expressed as ACs; the blueprint ships no test files (ratified decision 5) and no code.

No FBS contributions, as a matter of principle (ratified policy 2026-08-19): FBSs are the work of the implementing agent, not the blueprint; project constraints have to be applied at the time of creation. The blueprint contributes the WHAT (the sign-in flow, the token lifecycle, the session lifecycle, the two pluggable interfaces); the implementing agent derives the HOW-tasks (FBS) in the host project, where the ACs contributed here get picked up by the project's own build sequencing.

Deliberately not contributed: authorisation (roles, permissions, tenancy) is a project concern that layers above the session record's principal id, not inside this blueprint; multi-factor authentication is a project concern that layers on top of a resolved session; federated identity (OIDC, SAML) is a future auth-oidc blueprint (see guide 'when it does not fit'); email transport is a project concern behind the pluggable adapter contract; principal registry shape is a project concern behind the pluggable lookup contract.

## The one global decision

ADR-501-auth-magic-link-model ships `scope: global` on topic `authModel`. This is the third half of the project-level authentication model; SPA contributes ADR-205-spa-auth-model on the same topic (the client half: cookie-based sessions, 401-redirect posture), REST contributes ADR-302-rest-auth-model on the same topic (the server half: four declared auth classes enforced in middleware). Applying any two of the three on one project surfaces the pairing for operator resolution, which is the composition mechanism doing its job. See `docs/topics.md` for the exact strings, the expected resolutions, and the AC id band allocation (auth owns 3101-3899).

## Quality bar

Passwordless sign-in via emailed one-shot URL; single-use time-limited tokens with a fifteen-minute default expiry and remint-invalidates-predecessors; server-issued opaque handles of at least 24 bytes of entropy with no JWT-shaped payload; Secure HttpOnly SameSite=Lax cookie transport; server-side revocation on sign-out and administrative revoke-all-for-principal; anti-enumeration on the sign-in submission (byte-identical body, identical status, wall-clock timing floor); rate-limited mint and consume endpoints with honest Retry-After; session and token persistence across process restart; structured auth event log with zero secret leakage; pluggable email delivery adapter behind a narrow contract; pluggable principal registry behind a narrow contract. Every bar is carried by ACs in the doc set, not by this README.

## Known mechanism-reach gaps

None at v1.0.0. Every AC on every story is bound to at least one TAC that the host project must realise, and every AC's `then` clause is runtime-observable in the deployed application (Set-Cookie inspection, response body byte-comparison, adapter-call enumeration, event-log field scanning). The mechanism-reach principle from the authoring standard section 7 is satisfied at ship: a project that applies this blueprint and does not realise a TAC leaves an unresolved `tacIds` reference on the story that `rcf validate` and `rcf coverage` refuse. The one operational surface a project must own on its own is the durable store implementation the two managers depend on (auth-REQ-008); that responsibility is stated as a TAC dependency, not as a smuggled runtime probe.
