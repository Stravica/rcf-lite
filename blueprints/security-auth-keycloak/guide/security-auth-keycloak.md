# security-auth-keycloak guide

## What it is

A Keycloak-committed blueprint for delegated identity through OAuth2 authorisation-code with PKCE against a Keycloak realm the operator runs. It fixes the Keycloak-shaped decisions the vendor-neutral OAuth2 sibling deliberately leaves open: a Keycloak realm as the concrete issuer, JWKS-with-rotation-cache OR RFC 7662 introspection as the per-realm verification mode, the client-roles / realm-roles claim shape for role extraction, the local-first stand-up shape through the vendor's official container image, the fail-safe boot posture per realm, and the runtime-verify posture that binds against a real local Keycloak container without demanding a cloud tenant.

A project applies this blueprint, declares one or more realm-config records (each pointing at a Keycloak realm the operator runs), and inherits the discovery-driven endpoint record, the JWT verifier (or the introspection client), the role adapter, and the provider-routing seam. Adding a second realm is a config-record write plus a routeFn edit. The mechanism does not change.

## What it deliberately is not

Not a vendor-neutral blueprint. `security-auth-oauth2` is the sibling for projects that are not committed to a single vendor. This blueprint occupies the vendor-committed lane: the concrete Keycloak-shaped decisions (JWKS vs introspection, client-roles vs realm-roles, local container, RP-initiated logout through the realm's end_session_endpoint) are fixed here so the project code path names a Keycloak realm rather than an abstract provider record.

Not a hosted-identity blueprint. `security-auth-clerk` is the sibling for projects that want the vendor to host the sign-in surface, credential storage, MFA, and account recovery. This blueprint targets the operator who wants self-hosted control over the realm and the admin surface.

Not a passwordless-magic-link blueprint. `security-auth-magic-link` is the sibling for projects with no third-party identity dependency and the willingness to own the whole authentication surface in-house.

Not a flow-controller-contributing blueprint. The state machine that mints the pending-flow record, builds the authorisation redirect, and drives the callback is either the sibling `security-auth-oauth2` blueprint's TAC-1101 (compose the two blueprints, resolve the `authModel` global conflict to Keycloak, and point the oauth2 provider adapter at a Keycloak realm through this blueprint's discovery client and verifier) or a project-authored controller above this blueprint's five TACs. Either path is valid; the blueprint is honest that it contributes the Keycloak-shaped pieces, not the state machine.

Not a session-persistence blueprint. The session-bridge (in opaque-handle mode) injects the session-record store; the reference wiring is in-memory. A project that wants durable sessions composes `persistence-data-sqlite` (or `persistence-data-d1`) and points the store at a table. The blueprint does not commit the storage shape.

Not an MFA blueprint. MFA is the realm's concern; the blueprint delegates. A realm that requires MFA at the sign-in surface is transparent to the mechanism.

## When to reach for it

- The project has, or will run, a Keycloak realm; the ops posture prefers self-hosted identity over hosted-vendor identity.
- The project needs the Keycloak-specific decisions (JWKS-vs-introspection, client-roles-vs-realm-roles, RP-initiated logout) fixed at the mechanism layer so the project code path is Keycloak-shaped rather than provider-abstract.
- The project may have another OAuth2 or OIDC issuer alongside Keycloak (a second realm, a corporate issuer the middleware layer above this blueprint routes to) and wants the routing seam visible at one named point.
- The project wants runtime-verify to actually verify against a real Keycloak container in CI without demanding a cloud tenant.
- The project's ops team accepts running the Keycloak container as part of the deployment (either as a per-suite container in CI, a shared team-level container, or a production Kubernetes deployment).

## When it does not fit

- The project wants delegated identity but is not committed to one vendor. `security-auth-oauth2` is the shape.
- The project is committed to Clerk and wants the vendor to do more of the work than an OAuth2 record allows. `security-auth-clerk` is the shape.
- The project has no external IdP and no plan to obtain one, or the ops posture cannot run a Keycloak container. `security-auth-magic-link` is the shape.
- The project's session-verification requirements need statelessness at scale (no server-side session record). This blueprint supports that (ADR-1204's stateless mode) but the operator has to accept the per-request verification cost on every request; a project that prefers opaque-handle everywhere and can afford the store is on a smoother default.

## What a good outcome looks like

- One realm-config record per configured realm, on the fixed shape, validated at boot.
- The sign-in ceremony is the same code path across every configured realm; adding a realm is a record write plus a routeFn edit.
- Every access token either verifies (JWKS mode against a cached JWKS with kid-miss refresh; introspection mode against the RFC 7662 endpoint with optional short-lived cache) or refuses with a stable-coded reason.
- The browser holds an opaque-handle cookie (opaque-handle mode) or no session cookie at all (stateless mode); provider tokens live server-side (opaque-handle) or are re-verified per request (stateless); nothing on `request.auth` is a Keycloak-minted token.
- The provider-router seam is one named function; a reviewer inspecting the deployment can see the routing decision in one place.
- Refresh honours the realm's rotation model; a realm-signalled invalidation revokes the session cleanly.
- Sign-out clears the project session; the realm record's `providerLogout` flag decides realm-side redirect.
- `rcf audit coverage --strict` on the project's post-blueprint-apply state reports every blueprint AC as uncovered by TC (the blueprint ships no test files); every AC is a runtime-observable fact the project authors a TC against; the ship gate refuses on any uncovered AC that is not `accountBound`.
- The live cloud-realm smoke AC is `accountBound` and skipped by the runtime-verify runner when credentials are absent; the project-authored TC records the outcome honestly. The local-container smokes run every CI pass without any cloud dependency.

## Operator decisions that remain open after apply

- Which Keycloak realm(s) to configure. The blueprint runs against one realm, two realms, or N realms; the operator picks and declares each on a realm-config record.
- Where the `clientSecret` per record lives. The recommended pattern is a secret declared in the project's `secrets.yaml` (`security-secrets-management` composed) read at boot; a project that has not composed the secrets blueprint reads from its process environment or an equivalent.
- The verification mode per realm (`jwks` or `introspection`). Match the mode to the Keycloak client's configuration; a realm with a mix of client kinds gets one record per kind.
- The role claim shape per realm (`client-roles` or `realm-roles`). Match to the realm's client configuration; the choice is legible on the record.
- The session mode per realm (`opaque-handle` or `stateless`). Default is opaque-handle; stateless is opt-in for deployments where a session store is undesirable.
- The boot posture per realm (`strict`, `deferred`, or `standby`). Default is strict; the operator picks based on deployment shape.
- The JWKS cache TTL per realm. Default 900 seconds; the operator raises or lowers per the realm's rotation cadence and the project's staleness tolerance.
- The provider-router routeFn. A single-realm deployment uses the reference constant; a multi-realm or issuer-hand-off deployment writes its own.
- The Keycloak container tag. The operator pins the currently-supported stable at harness-setup time and upgrades on the vendor's cadence.
- The `enrichPrincipal` hook. Empty roles and organisationIds arrays are the default (with the raw Keycloak role strings on `roles[]`); a project that maps Keycloak roles onto project-role vocabulary authors the hook and lists the mapping in a project-level ADR.
- The live cloud-realm smoke. AC-11112-2 is `accountBound`; a project that has live credentials wires them and the TC lights up, otherwise the skip is honest.

## Cost honesty

Shipping this doc set costs the project 12 REQs, 13 USs (34 ACs), 5 TACs, and 6 ADRs on the tree; the ACs are runtime-observable and the project's build cycle owns writing the TCs. The realisation cost is one discovery client, one JWT verifier (JWKS mode), one introspection client (opaque mode), one provider router, one role adapter, and (per the composition choice) either the sibling `security-auth-oauth2` blueprint's flow controller wired to a Keycloak realm or a project-authored flow controller above the five TACs. The reference wiring runs to a small number of files in one package. The Keycloak container is a one-off harness dependency the operator stands up per the local-container asset; runtime-verify against it is free of cloud cost. The live cloud-realm smoke costs the operator credentials on a project-owned Keycloak deployment; that cost is unavoidable and the `accountBound` posture keeps it out of CI.

## Promotion signals to the other siblings

- The project outgrows self-hosting and wants a hosted vendor to run the sign-in surface, credential storage, MFA, and account recovery. Promote to `security-auth-clerk`: supersede ADR-1201 with a project-level ADR pointing at Clerk's authModel; apply `security-auth-clerk`; retire the Keycloak container.
- The project needs delegated identity that is not vendor-committed (a small project that wants to plug in Google or GitHub without running a realm). Demote to `security-auth-oauth2`: supersede ADR-1201 with a project-level ADR pointing at oauth2's authModel; apply `security-auth-oauth2`.
- The project's audience needs a passwordless-magic-link posture (regulated environment, no third-party identity dependency). Demote to `security-auth-magic-link`.

## Provider-aware install-design shape (Baz-reshape, restated)

The blueprint stays Keycloak-committed. What the blueprint does NOT do is assume Keycloak is the only issuer the receiving system will ever consult. Two shapes make this explicit:

- The provider-router seam (TAC-1204, ADR-1203) exposes one named point in the request-processing chain where a project's own middleware makes the routing decision. A project with only Keycloak wires the seam to a constant; a project with two Keycloak realms wires the seam to pick between them per request marker; a project with Keycloak alongside another OAuth2 or OIDC issuer above this blueprint's mechanism reach returns the sentinel `notThisIssuer` and the middleware layer above owns the request.
- The introspection path (REQ-004, TAC-1203) speaks the RFC 7662 shape whether the issuer is Keycloak or another conforming server; a project that has chosen to consult a non-Keycloak issuer at the introspection seam does not need a new vocabulary.

The blueprint refuses to name any specific second issuer, any specific request marker, or any specific dual-provider deployment shape. Those are project-level decisions the operator authors on a project-side ADR whose `related-reqs` cites REQ-005 and ADR-1203.
