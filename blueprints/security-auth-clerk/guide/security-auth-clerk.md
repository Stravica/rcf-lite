# Security auth Clerk blueprint guide

## What it is

A Clerk-committed authentication floor for small greenfield rcf-lite projects. The blueprint contributes the WHAT of a hosted-identity pattern: how the project delegates identity to Clerk, how it verifies the resulting session cookie on the server, how it reduces the verified claims into a stable Principal shape, how the authorisation adapter maps Clerk roles and organisation memberships onto project-defined verbs, how sign-in strategy sits as a config surface rather than a hard-coded choice, how sign-out honours Clerk-side revocation within a bounded window, how rate-limiting and anti-enumeration are delegated to Clerk, how user and organisation provisioning stays read-only from the runtime's perspective, and how runtime-verify acceptance criteria acknowledge that Clerk-reachable behaviour cannot be faked.

Concretely, the blueprint ships nine requirements, eleven user stories (twenty-five acceptance criteria), four architecture components, and five architecture decision records. One ADR is `scope: global` on the `authModel` topic; the other four are scope-local operational ADRs (middleware-boundary shape, authorisation-adapter contract, claims-mapping discipline, session-lifecycle posture) that a composing blueprint does not conflict with by default.

## What it is not

Not a Clerk SDK version pin. The SDK's package version is a project-package-manifest concern; the blueprint fixes the shape of the boundary (the `verify(request)` contract, the `__session` cookie name, the reduced Principal shape) and lets the project pick which Clerk SDK major it builds against.

Not an MFA policy. Clerk owns MFA at the hosted identity surface; the blueprint delegates MFA to Clerk's configuration and does not encode an MFA strategy or enforcement rule at the project's runtime. A project with a hard MFA-for-all-admins requirement configures that on the Clerk dashboard.

Not a user or organisation mirror. Clerk is authoritative for identity state. A project that needs to mirror Clerk state into a local table for query purposes (a per-user preferences row, a per-organisation audit log) does so through a project-authored Clerk-webhook consumer; that consumer is out of scope for the blueprint's default. A project that includes one adds one project-authored TAC and one scope-local ADR alongside this blueprint's contributions.

Not a project-side rate limiter or anti-enumeration defence. Clerk applies its own throttling and enumeration defences at the identity surface; the blueprint requires that the project does not layer a second, competing rate limiter on top of the sign-in flow.

Not an OAuth2-provider-list blueprint. A project that wants direct OAuth2 against a specific set of social providers, without a hosted identity vendor, reaches for the future `security-auth-oauth2` sibling blueprint when it ships. A project that wants a self-hosted OIDC surface reaches for the future `security-auth-keycloak` sibling. Both conflict with this blueprint on `authModel` by design.

Not the sign-in UI. Clerk hosts the sign-in surface (either fully hosted at Clerk's domain or embedded through Clerk's components). The blueprint's job is to wire the surface into a project route and to verify the resulting session on the server; the pixels of the sign-in form are Clerk's.

## When to reach for it

Reach for the security-auth-clerk blueprint when:

- The project needs user accounts, sessions, sign-in UX, and account recovery, and the operator's preference is to buy that surface from a hosted vendor rather than build it.
- The project's operator wants a straightforward path to enterprise-shaped features (SAML, SCIM, organisation memberships, roles) without owning the identity infrastructure that supports them.
- The team is small enough that owning the identity surface (email deliverability, MFA rollout, breach-check integration, session persistence) is a distraction from the product.
- The project's compliance posture accepts a hosted identity vendor; a project subject to data-residency constraints that Clerk's regions do not satisfy is on the wrong blueprint.
- The project already uses (or plans to use) Clerk's dashboard for user administration and does not want a second admin surface.

## When it does not fit

Do not reach for the security-auth-clerk blueprint when:

- The project cannot depend on a hosted third-party identity surface (data-residency constraints, an air-gapped deployment, a compliance regime that requires self-hosted identity). Reach for `security-auth-keycloak` when it ships, or supersede ADR-1001 with a project-level ADR and pick a self-hosted vendor whose adapter the project authors.
- The project's identity surface is genuinely trivial (one operator, no organisations, no roles). A passwordless magic-link floor (`security-auth-magic-link`) is honestly a smaller machine at that scale; this blueprint's provider dependency and pricing tier are overkill.
- The project wants direct OAuth2 against a specific set of social providers and nothing else, with no hosted identity vendor. `security-auth-oauth2` will cover that shape when it ships; picking this blueprint plus Clerk's OAuth strategies is valid but is a bigger machine than a project that only wants "sign in with GitHub" needs.
- The project cannot accept the `accountBound` runtime-verify posture (runtime tests that skip when Clerk is unreachable, rather than pass on a fake). Every hosted-identity blueprint carries this posture; a project that needs offline test independence is on the wrong blueprint family.

An earlier round-1 pass shipped `security-auth-magic-link` as the generic-auth blueprint; the round-2 pass introduces the vendor-committed siblings (this blueprint for Clerk, plus the reserved `security-auth-oauth2` and `security-auth-keycloak`). The composition-precedent is `application-spa` + `application-api-rest` on the `errorEnvelope` and `authModel` topics: siblings on the same topic conflict on purpose and expect a project-level ADR resolution.

## What a good outcome looks like

A project applies the blueprint on a fresh tree, provisions a Clerk development instance, stores the publishable and secret keys in the secrets manifest under placeholder-named entries (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`), chooses its `signInStrategy` primary and alternates, realises the four TACs in project-authored FBSes (one framework-specific middleware shim, one authorisation-adapter with a project verb-to-role mapping, one session verifier over the Clerk SDK, one claims mapper), and lands on a deployed application where:

- The sign-in surface renders Clerk's hosted (or embedded) sign-in UI; the operator signs in and lands on the app with a `__session` cookie in their browser.
- Every request to a protected route arrives at the middleware, which verifies the cookie against Clerk and attaches `request.auth = { principalId, roles, organisationIds, claims }` before the handler runs.
- Every handler that gates on identity calls `can(request.auth, verb, subject?)` or `assert(request.auth, verb, subject?)` on the authorisation adapter; no handler reads `request.auth.roles` or `request.auth.claims` directly.
- Role-based UI slots on rendered pages appear or disappear per the adapter's decision; the corresponding server-side handler enforces the same verb through `assert`.
- The Clerk SDK is imported by two modules in the project (the middleware wiring and the session verifier). A source-tree scan confirms the boundary.
- The operator signs out; a subsequent request replaying the pre-sign-out cookie is refused by the middleware within the `revocationCheckIntervalMs` window declared on ADR-1005.
- The sign-in flow has no project-authored rate limiter; Clerk's own throttling is the observed behaviour under a burst of attempts.
- User and organisation management happens on the Clerk dashboard (or on a project-authored provisioning script directory that runs outside the request lifecycle); the runtime never mutates Clerk identity state.
- The runtime-verify test surface marks Clerk-reachable ACs as `accountBound` and, when the CI runner has Clerk reachable, they pass against the development instance; when the CI runner does not, they skip with `AUTH_CLERK_UNREACHABLE`, not pass silently.

## Operator decisions that remain open after apply

- Vendor choice (Clerk default per ADR-1001, or a superseding project-level ADR selecting Auth0, WorkOS, Cognito, or a project-authored hosted-identity adapter). Blueprint owns the boundary on both sides; project owns the vendor when it supersedes.
- `signInStrategy` primary and alternates (email link, email code, password, phone code, OAuth against named providers, SAML). Blueprint owns the shape; project owns the choice; Clerk dashboard owns the enablement.
- Verb-to-role mapping table (project vocabulary; every downstream `can` and `assert` call speaks in these verbs). Blueprint owns the adapter shape; project owns the mapping.
- Organisation scoping policy (whether to scope every resource by `organisationId` or leave organisation membership as a flat role decoration). Blueprint owns the adapter's optional-subject shape; project owns the choice.
- `revocationCheckIntervalMs` (30 seconds default per ADR-1005, or a shorter window at the cost of a per-request Clerk round trip, or a longer window up to the session's declared expiry). Blueprint owns the shape and the ceiling; project owns the number.
- Clerk plan tier (development, production, per-user pricing). Blueprint owns none of this; the operator picks per project needs.
- Provisioning-script directory location (`scripts/provisioning/` by convention on AC-9110-1, or a project-declared equivalent). Blueprint owns that provisioning is not a request handler; project owns where the scripts live.
- Whether to layer a project-authored Clerk-webhook consumer (for user-created, session-ended, or organisation-membership-changed events). Blueprint's default omits it; a project that adds one authors one TAC and one ADR alongside this blueprint's contributions.

## Runtime coverage

The middleware boundary contract (TAC-1001's `verify(request) -> { authenticated, principal?, reason? }`) is framework-agnostic and runs unchanged on Node HTTP servers (Express, Fastify) and on the Cloudflare Workers fetch handler. Two sample sets ship in `assets/`:

- `assets/middleware/node-middleware-shape.md` for Express and Fastify: adapter wrappers around `verify(request)` that attach the reduced `Principal` to `request.auth`.
- `assets/middleware/workers-fetch-shape.md` and `assets/wiring/workers-wrangler-toml-shape.md` for Cloudflare Workers: a fetch-handler adapter that carries the same `verify(request)` contract onto the Fetch API `Request` shape, plus the wrangler.toml overlay (`nodejs_compat`, the two Clerk secret names, the `CLERK_SIGN_IN_URL` var, and the `run_worker_first` posture on auth-gated routes that the assets binding would otherwise silently bypass).

A project on a single framework picks up one adapter and pays nothing for the others; a project that hosts multiple runtimes (a Node main app plus a Workers edge function against the same Clerk instance) picks up both sample sets and shares one session verifier and one claims mapper across them.

## Cost-honesty paragraph

Shipping this doc set costs the project the following. Clerk is a paid vendor beyond the development tier; the operator budgets for it. The `accountBound` runtime-verify posture means the CI runner needs Clerk reachability to actually verify the runtime-verify ACs; a CI runner without outbound network for that vendor either skips those ACs (which the ship gate flags) or the operator wires a preview Clerk instance for CI to reach. The middleware boundary discipline (`request.auth` and `can`/`assert` everywhere) is a code-review load on every new handler; a project that lets the discipline slip loses the vendor-swap-safety the blueprint is buying. The `revocationCheckIntervalMs` window is a stated trade between per-request cost and sign-out prompt-ness; the operator picks a number that reflects the project's actual policy, not the blueprint's default forever. The read-only provisioning posture forces the operator to run Clerk mutations outside the request lifecycle; a project that wants a per-request user-create call is on a different pattern and should think again. The blueprint says nothing about MFA policy, about pricing, about SLA, or about vendor-lock exit; a project that needs any of those spends its own build cycles on them and this blueprint does not save it any work there.
