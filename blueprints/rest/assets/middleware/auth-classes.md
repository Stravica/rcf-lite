# Auth-class middleware slots: the four contracts

Reference for the working agent implementing TAC-302-rest-auth-middleware. This is a behaviour specification, not code: it enumerates the four slots, what each must and must not do, and the properties the acceptance criteria verify. Every endpoint routes into exactly one slot via its declared `x-auth-class` (rest-REQ-005); the slot list is closed, and a project needing a different shape supersedes ADR-302-rest-auth-model rather than adding a bespoke path.

## Slot summary

| Class | Credential | Identity resolved | Rate-limit key | Audit log | Typical endpoints |
|---|---|---|---|---|---|
| `public` | None processed | None | Client address | No | Landing data, docs, probes-adjacent reads |
| `user` | Session or bearer token | User identity | User identity | No (standard request logging only) | The product surface |
| `admin` | Session or bearer token + admin role | User identity with role | User identity | Yes, every request | Back-office, configuration, user management |
| `service` | mTLS or signed request | Service principal (no user) | Service principal | Yes, every request | Peer services, schedulers, /v1/_meta |

## Contracts per slot

### public

- Processes no auth headers: a request with credentials behaves identically to one without (AC-2107-1). Do not "helpfully" resolve identity when a token happens to be present; that turns cache keys and logs into identity leaks on the class that promised none.
- Rate-limited on the public class budget keyed by client address (AC-2107-2, AC-2113-3).
- Emits `authClass=public` to telemetry; never a user attribute.

### user

- Resolves identity from the project's chosen transport (bearer token or cookie session per the project-level auth reconciliation) and exposes it read-only to the handler (AC-2107-3).
- Missing, expired, or invalid credentials: 401 with the problem-details envelope. Valid credentials are the entry ticket; authorisation beyond class membership stays in the handler.
- Rate-limited per identity on the user budget.

### admin

- Everything `user` does, then requires the admin role; an authenticated non-admin receives 403, not 404-style concealment, unless the project explicitly decides otherwise in its own decision record (AC-2107-4).
- Audit-logs every request, success or rejection: acting identity, endpoint, outcome, request id (AC-2107-5).
- Elevated rate budget per identity.

### service

- Authenticates the calling service by mTLS or request signature; resolves a service principal and never a user identity (AC-2107-6).
- User and admin tokens are rejected here with 403: classes do not substitute for each other (AC-2107-8).
- Audit-logs every request with the service principal; counts against the service budget, independent of user traffic (AC-2107-7).

## Cross-cutting rules

- Enforcement position: the slot runs inside the shared pipeline before any handler code; a request failing its slot never reaches the handler (AC-2106-3).
- Single declaration: the slot is selected by the same metadata that publishes `x-auth-class` in the generated spec; changing the declaration changes enforcement with no second edit site (AC-2106-4).
- Closed set: these four slots are the only auth code paths in the service (AC-2106-6). The probes are declared `public` and additionally exempt from rate limiting per rest-REQ-006.
- Rejection shapes: 401 for unresolvable credentials, 403 for resolved-but-insufficient, always with the problem-details envelope (AC-2106-5).
