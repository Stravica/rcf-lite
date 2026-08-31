# Provider router: seam shape

Generic-vocabulary shape a project's own middleware invokes to answer one question: for THIS request, which realm record is authoritative (or does the routing hand off entirely)?

The blueprint stays Keycloak-committed. This asset describes the SHAPE of the routing function; it does NOT name any specific second issuer, any specific request feature, or any specific deployment topology.

## The pure function

```
type RouteDecision =
  | { realmSlug: string, verificationMode: 'jwks' | 'introspection' }
  | 'notThisIssuer';

type RouteFn = (request: RequestLike) => RouteDecision;
```

`RequestLike` is what the project's HTTP framework exposes at the middleware boundary. The blueprint does not commit to a specific shape (Express's `req`, Fastify's `request`, Hono's `c.req`, Workers' `Request`); the routeFn adapts to whatever the project's framework provides.

## Single-realm deployment

```
const routeFn = () => ({ realmSlug: 'r1', verificationMode: 'jwks' });
```

The reference wiring includes this constant-realmSlug default for the common single-realm case. The overhead is one function call per request and one config-record lookup; the payoff is that the same seam exists in every deployment shape, so upgrading from single-realm to multi-realm is a routeFn swap, not a code rewrite.

## Multi-realm deployment (two Keycloak realms)

```
const routeFn = (request) => {
  const marker = readMarker(request); // project-specific: header, path prefix, claim, or other
  if (marker === undefined) {
    return { realmSlug: 'r1', verificationMode: 'jwks' }; // project's declared default
  }
  return { realmSlug: marker, verificationMode: 'jwks' };
};
```

The MARKER is the project's own concern. The blueprint refuses to name it: a project might use a header, a request-path prefix, a preflight claim, a tenant slug from a subdomain, or something else entirely. The routeFn inspects the request and picks; the mechanism honours the pick.

## Deployment where routing hands off

```
const routeFn = (request) => {
  if (isThisMechanismsResponsibility(request)) {
    return { realmSlug: 'r1', verificationMode: 'jwks' };
  }
  return 'notThisIssuer';
};
```

A project whose middleware chain also verifies tokens from another OAuth2/OIDC issuer above this blueprint's mechanism reach returns the sentinel `notThisIssuer` when the request is not for this mechanism to verify. The caller (the project's own middleware) is responsible for what happens next; the mechanism does not know and does not care.

The blueprint does NOT contribute an ADR that fixes what a project puts in `isThisMechanismsResponsibility`. That is the project-level decision the ratified reshape ruling reserves for the project. The seam is the mechanism's contribution; the routing policy is the project's.

## Why the sentinel exists

Without it, the mechanism would have to guess: either refuse the request (which would break a deployment where a token from another issuer is expected on that path) or trust it (which would break the security posture). The sentinel makes the hand-off explicit and paper-trailed; the routeFn is where a reviewer looks to see which requests this mechanism owns.

## What the routeFn must NOT do

- Perform any HTTP request. The routeFn is pure; network I/O belongs on the verifiers, not the router.
- Read or mutate the session-record store. That is the session-bridge's territory.
- Name a specific second issuer inside the shipped mechanism. A project that has one names it on a project-level ADR whose scope is the project, not the blueprint.

## What the routeFn MAY do

- Read request fields (headers, path, method, cookies, query parameters).
- Consult a project-authored in-process lookup (a tenant registry the project maintains, a rules table the operator loaded at boot).
- Return a stable realmSlug per request feature that maps to a realm record.
- Return the sentinel when the project's middleware chain owns the decision above this mechanism.
