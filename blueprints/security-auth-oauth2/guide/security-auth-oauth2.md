# security-auth-oauth2 guide

## What it is

A vendor-neutral blueprint for delegated identity through OAuth2 authorisation-code with PKCE. It fixes the flow, the provider-abstraction contract, the CSRF discipline, the id_token verification path (for OIDC-declared providers), the session-bridge shape, the refresh-token posture, the sign-out semantics, and the multi-provider routing. It does not commit the project to one vendor; it commits the project to one flow that every conforming vendor plugs into.

A project applies this blueprint, drops in one or more provider records (Google, GitHub, Microsoft, Okta, Auth0, a corporate ADFS-fronted OIDC, a self-hosted `node-oidc-provider`), and inherits the state machine that gets the sign-in ceremony right against any of them. Adding a second provider is a config-record write. The state machine does not change.

## What it deliberately is not

Not a vendor-committed blueprint. If a project wants a hosted-identity fast lane with the vendor doing most of the work, `security-auth-clerk` is the sibling; if a project wants a self-hosted Keycloak realm, `security-auth-keycloak` (when it ships) is the sibling. The vendor-neutral shape here trades some vendor-specific richness (Google's `hd` claim, Microsoft's tenant scoping, GitHub's per-org enforcement) for one code path across every conforming vendor. Vendor-specific companion blueprints layer on top when demand justifies them.

Not a passwordless-magic-link blueprint. `security-auth-magic-link` is the sibling for projects that want no third-party identity dependency and are willing to own the principal registry, the email adapter, and the anti-enumeration posture.

Not a session-persistence blueprint. The session-bridge (TAC-1103) injects a session-record store; the reference wiring is in-memory. A project that wants durable sessions composes `persistence-data-sqlite` (or `persistence-data-d1` when it ships) and points the store at a table. The blueprint does not commit the storage shape.

Not an MFA blueprint. MFA is the IdP's concern; the blueprint delegates. A provider that requires MFA at the vendor surface is transparent to the flow controller.

Not a provider-selector UX blueprint beyond a reference rendering. TAC-1104 is optional at wire time; a project that wants a rich multi-provider selector substitutes its own surface as long as the query-parameter contract on `/auth/sign-in?provider=<id>` stays intact.

## When to reach for it

- The project wants delegated identity but is not committed to a single hosted vendor.
- The project may or may not add a second provider later; the seam should be ready.
- The project's ops posture prefers the sign-in surface (and the credential storage) to live at an IdP the project does not run.
- The project has, or will register, an application at one or more IdPs and hold the resulting `clientId`/`clientSecret` pair through the secrets-management blueprint.
- The project wants runtime-verify to actually verify the state machine and the identity-lift in CI without paying for a per-CI-run set of live-vendor credentials.

## When it does not fit

- The project has no external IdP and no plan to obtain one. `security-auth-magic-link` is the shape.
- The project is committed to Clerk and wants the vendor to do more of the work than an OAuth2 record allows. `security-auth-clerk` is the shape.
- The project has an existing Keycloak realm and wants a vendor-committed integration. `security-auth-keycloak` (when it ships) is the shape.
- The project's session-verification requirements need statelessness at scale (no server-side session record). This blueprint's session-bridge is opaque-handle by ADR-1104; a JWT-in-cookie posture is a project-level ADR supersede on the session-bridge shape.

## What a good outcome looks like

- One provider record per configured IdP, on the fixed shape, validated at boot.
- One sign-in ceremony code path across every provider; adding a second provider is a config-record write.
- Every callback either issues a project session or terminates with a stable-coded refusal naming the reason class.
- The browser holds an opaque-handle cookie; provider tokens live server-side; nothing on `request.auth` is a provider token.
- Refresh-token rotation is silent when the flow is healthy and revokes the chain when a refresh-token reuse is detected.
- Sign-out clears the project session; the operator-declared `providerLogout` flag is what decides the provider-side redirect.
- `rcf audit coverage --strict` on the project's post-blueprint-apply state reports every blueprint AC as uncovered by TC (the blueprint ships no test files); every AC is a runtime-observable fact the project authors a TC against; the ship gate refuses on any uncovered AC that is not `accountBound`.
- The live-provider smoke AC is `accountBound` and skipped by the runtime-verify runner when credentials are absent; the project-authored TC records the outcome honestly.

## Operator decisions that remain open after apply

- Which IdP(s) to configure. The blueprint lists Google, GitHub, Microsoft, Okta, Auth0, corporate ADFS, and self-hosted `node-oidc-provider` as illustrative examples; the project picks and registers.
- Where the `clientSecret` lives. The recommended pattern is a secret declared in the project's `secrets.yaml` (`security-secrets-management` composed) read at boot; a project that has not composed the secrets blueprint reads from its process environment or an equivalent.
- The session-record store. In-memory is the reference wiring; a project running more than one process points the store at a table.
- The session lifetime (`sessionExpirySeconds`) and the pending-flow TTL (`pendingFlowTtlSeconds`). Defaults in the reference wiring are 8 hours and 10 minutes respectively; the project may tighten or extend per its risk posture.
- The `enrichPrincipal` hook. Empty roles and organisationIds arrays are the default; a project that maps IdP claims to project roles authors the hook and lists the mapping in a project-level ADR.
- The provider selector surface. TAC-1104's reference rendering is deliberately plain; a project that wants a branded selector substitutes its own.
- The live-provider smoke. AC-10110-2 is `accountBound`; a project that has live credentials wires them and the TC lights up, otherwise the skip is honest.

## Cost honesty

Shipping this doc set costs the project 10 REQs, 10 USs (27 ACs), 4 TACs, and 6 ADRs on the tree; the ACs are runtime-observable and the project's build cycle owns writing the TCs. The realisation cost is one flow controller, one provider adapter with per-record boot validation, one session-bridge with an injected store, and (optionally) a selector rendering; the reference wiring runs to a small number of files in one package. The mock OIDC provider is a one-off project-authored fake stood up per `assets/mock-provider/mock-oidc-shape.md` (or an existing library); the shape is what the ACs bind against. The live-provider smoke costs the operator credentials and a redirect URI registration at the provider's console per IdP; that cost is unavoidable and the `accountBound` posture keeps it out of CI.

## Promotion signals to the vendor-committed siblings

- The project wants the vendor to host the sign-in surface, credential storage, MFA, and account recovery; the trade of a vendor commitment is acceptable. Promote to `security-auth-clerk`: supersede ADR-1101 with a project-level ADR pointing at Clerk's authModel; apply `security-auth-clerk`; the flow controller and the session-bridge from this blueprint are retired and Clerk's middleware boundary takes over.
- The project's ops team runs (or wants to run) a Keycloak realm; the project wants a vendor-committed integration. Promote to `security-auth-keycloak` when it ships; the OAuth2-generic path is a valid interim.
- The project's audience needs a passwordless-magic-link posture (regulated environment, no third-party identity dependency); demote to `security-auth-magic-link`.
