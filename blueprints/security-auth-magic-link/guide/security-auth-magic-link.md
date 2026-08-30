# Auth blueprint guide

## What it is

A passwordless-sign-in floor for small greenfield rcf-lite projects. The blueprint contributes the WHAT of a magic-link authentication model: how sign-in works on the wire, what shape the session takes in the browser, how tokens live and die, how the sign-in endpoints defend themselves against enumeration and brute force, what the auth event log looks like, and how the project plugs its own email transport and its own principal registry into a fixed contract.

Concretely, the blueprint ships eleven requirements, eleven user stories (thirty-seven acceptance criteria), five architecture components, and five architecture decision records. One ADR is `scope: global` on the `authModel` topic; the other four are scope-local operational ADRs (token secrecy, anti-enumeration budget, session lifecycle, rate limiting) that a composing blueprint does not conflict with by default.

## What it is not

Not authorisation. Roles, permissions, quotas, and tenancy do not live inside this blueprint; they layer above the session record's principal id, in project-authored requirements and TACs.

Not multi-factor authentication. MFA layers on top of a resolved session; a project that needs it wires a step-up flow after session issue.

Not federated identity. OIDC through an external identity provider, SAML integration with corporate directories, and social-login through OAuth providers are all out of scope; a future `auth-oidc` blueprint (see 'when it does not fit') owns that space.

Not an email transport. The blueprint contributes the adapter contract and one stub implementation; the project supplies the real transport (SMTP, Resend, SES, whatever fits).

Not a principal registry. The blueprint contributes the lookup contract and one single-address implementation for solo-operator deployments; the project supplies the registry shape that matches its principal model.

## When to reach for it

Reach for the security-auth-magic-link blueprint when:

- The project is a small greenfield rcf-lite deployment (single deployable, one small team of operators or one solo operator, no external identity provider requirement).
- Sign-in is a rare event compared with authenticated work (an operator signs in once a session and then works; the delay of a magic link is a fine cost for the security posture).
- The project can plug in an email transport with reasonable delivery latency (a magic link that takes minutes to arrive is a bad user experience; check the transport SLA before shipping).
- The project needs a defensible security posture out of the box (opaque handles, HttpOnly cookies, anti-enumeration, rate limits, server-side revocation) without a full identity-provider deployment.

## When it does not fit

Do not reach for the security-auth-magic-link blueprint when:

- Multi-user identity, role management, group memberships, or user provisioning are project requirements. A `auth-oidc` blueprint (unshipped at v1.0.0, promotion signal: the third project asks for it) will own this. Until then, a project with these needs authors its own auth model and does not apply this blueprint.
- The project has a hard requirement for OAuth authorization-code flows against an external provider (Google, GitHub, corporate SSO). Same promotion path; supersede with a project-level ADR and skip this blueprint.
- The project is a service-to-service API with no browser clients and no interactive sign-in. The application-api-rest blueprint's service class (ADR-302 four-classes model) is the right shape; the security-auth-magic-link blueprint's magic-link flow is not.
- The operator population is large enough that magic-link email delivery volume is a first-order operational concern (thousands of sign-ins per hour). At that volume the mint endpoint's rate limits become an operator experience problem, and a session-lived credential (bearer, refresh token) is the more defensible shape.
- Email delivery cannot be trusted (isolated network, no outbound SMTP, delivery SLA in tens of minutes). The magic-link flow's usability floor is 'the operator sees the link within one minute'; below that floor the flow is worse than a password.

The design brief `w-2026-07-28-029` originally scoped a `keycloak-local` blueprint against WESPA's implementation. The security-auth-magic-link blueprint at v1.0.0 does not include keycloak-local because the container-plus-realm cost is disproportionate for the rcf-lite tier this blueprint targets. The keycloak-local pattern is the natural body of a future `auth-oidc` blueprint aimed at bigger projects; the two blueprints are meant to co-reside in the ecosystem, not to compete, and both would deliberately conflict on `authModel` so the operator picks one per project.

## What a good outcome looks like

A project applies the security-auth-magic-link blueprint on a fresh tree, wires the two pluggable interfaces to project-supplied implementations (a real email adapter and a project-shaped principal registry), realises the five TACs in project-authored FBSes, and lands on a deployed application where:

- The operator visits /login, submits their email, and reads 'if this address is registered, a link is on its way' regardless of whether the address is theirs, their colleague's, or a typo.
- One minute later the link arrives; the operator clicks it and lands on the post-sign-in route with a session cookie set. No password ever existed.
- The session survives the operator closing and reopening the browser (up to the fifteen-minute idle window and thirty-day absolute ceiling), survives a deploy of the authenticating service, and ends when the operator clicks sign-out or when an administrator revokes.
- The auth event log tells the operator, without secret leakage, every mint, send, consume, issue, refresh, invalidate, revoke, and rate-limit trip.
- A repeat submission of a stale magic-link URL, an expired URL, or a URL for a different operator's session returns a generic 401 and issues no session.

## Operator decisions that remain open after apply

- Email transport (SMTP, Resend, SES, project-specific). Blueprint owns the adapter contract; project owns the implementation.
- Principal registry shape (single address, allow-list file, database lookup, external directory). Blueprint owns the lookup contract; project owns the implementation.
- Durable store engine (SQLite, Postgres, project-specific). Blueprint owns the store interface on both managers; project owns the engine.
- Post-sign-in landing route. Blueprint's routes redirect to a configured path; project picks the path.
- Idle window and absolute lifetime overrides. Blueprint defaults to fifteen minutes idle and thirty days absolute; a project with tighter needs overrides in a project-level ADR.
- Rate-limit ceilings. Blueprint defaults to five per minute on mint and twenty per minute on consume; a project with heavier legitimate load overrides and states the trade.
- Anti-enumeration budget. Blueprint defaults to 800 ms; a project with a faster adapter narrows the budget, a project with a slower adapter widens it.
- Cookie name. Blueprint uses `auth_session` unless configured otherwise; a project with a name-collision picks a distinct name.

## Cost-honesty paragraph

Shipping this doc set costs the project the following. Every sign-in incurs an email round-trip; operator experience floor depends on the transport SLA. Every authenticated request incurs a session-store lookup; store latency is on the hot path. Every session lives in a durable store and every unconsumed token lives in the same store; storage grows with active operators and expired tokens (a project-level cleanup job is the natural response). The anti-enumeration budget adds a fixed floor to every sign-in submission latency; legitimate operators pay it every time. The rate-limit ceilings are conservative defaults and will trip on unusual retry patterns; a project with a support burden of 'I clicked submit ten times and now I can't sign in for a minute' either raises the ceiling or educates the operator. The blueprint says nothing about authorisation, MFA, or federated identity; a project that needs those spends its own build cycles on them and this blueprint does not save it any work.
