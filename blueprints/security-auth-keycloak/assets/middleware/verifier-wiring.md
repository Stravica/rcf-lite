# Verifier middleware wiring: HTTP-framework-agnostic shape

A record-only shape for the middleware chain a project wires above the mechanism. Not production code; a project's own HTTP framework is what turns this into concrete request handlers.

The mechanism's public surface is three factory functions and one router:

```
const discoveryClient = createDiscoveryClient({
  realmConfig,
  httpFetch,
  clock,
  auditSink,
  retryScheduler
});

const jwtVerifier = createJwtVerifier({
  discoveryClient,
  httpFetch,
  clock,
  auditSink
});

const introspectionClient = createIntrospectionClient({
  discoveryClient,
  httpFetch,
  clock,
  auditSink
});

const providerRouter = createProviderRouter({
  routeFn,
  realmConfig,
  auditSink
});

const roleAdapter = createRoleAdapter({
  realmConfig,
  auditSink
});
```

## Request-time chain

```
async function verifyRequest(request) {
  const decision = providerRouter.route(request);
  if (decision === 'notThisIssuer') {
    return { status: 'notThisIssuer' };
  }
  const record = realmConfig.get(decision.realmSlug);
  if (record === undefined) {
    return { status: 'refused', code: 'KEYCLOAK_REALM_UNKNOWN' };
  }
  const health = discoveryClient.health(decision.realmSlug);
  if (health !== 'healthy') {
    return { status: 'refused', code: 'KEYCLOAK_REALM_UNAVAILABLE' };
  }
  const token = extractToken(request, record);
  if (token === null) {
    return { status: 'refused', code: 'KEYCLOAK_TOKEN_MISSING' };
  }
  const verified =
    decision.verificationMode === 'jwks'
      ? await jwtVerifier.verify(decision.realmSlug, token)
      : await introspectionClient.verify(decision.realmSlug, token);
  if (verified.ok === false) {
    return { status: 'refused', code: verified.code };
  }
  const principal = roleAdapter.principalFrom(decision.realmSlug, verified.claims);
  if (principal.ok === false) {
    return { status: 'refused', code: principal.code };
  }
  request.auth = principal.reduced;
  return { status: 'verified' };
}
```

`extractToken(request, record)` reads the bearer source per `sessionMode`: opaque-handle mode reads the session cookie and swaps it for the stored access token from the session record; stateless mode reads directly from the `bearerSource` field.

## Wiring a specific framework

The mechanism does not ship framework adapters at v1; a project on Express, Fastify, Hono, or the vendor's Workers runtime writes a one-file adapter that calls `verifyRequest` and produces the framework's response shape for the refusal classes above. Every framework adapter is a thin wrapper; the state machine is what this file names.

## Sign-in and sign-out routes

The sign-in initiation and callback routes are the flow controller's territory (a project either authors them above this blueprint's five TACs, or draws them from the sibling `security-auth-oauth2` blueprint's flow controller and adapts the state machine to the Keycloak record). The sign-out route is one line: invalidate the session handle if opaque-handle mode; clear the cookie; consult the realm record's `providerLogout` field to decide whether to return a 302 to `end_session_endpoint`.

## What this file does NOT commit

- No specific HTTP framework
- No specific session-record store implementation
- No specific httpFetch (the platform's `fetch` is the reference default; a project's harness substitutes in tests)
- No specific audit sink; a project points at its own event pipeline
