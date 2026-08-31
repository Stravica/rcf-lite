# Realm-config record: shape

The plain data record a project maintains per configured realm. TAC-1201 validates the shape at boot; TAC-1202, TAC-1203, and TAC-1205 read from it on the hot path.

All fields below are declared with placeholder or example values; a project populates them from a realm the operator runs. The `clientSecret` is server-only and NEVER committed - the record reads it from `security-secrets-management` (when composed) or from the process environment at boot.

```
{
  realmSlug: 'r1',
  issuerBaseUrl: 'http://127.0.0.1:8080',
  realmName: 'example',
  clientId: 'example-client',
  clientSecret: '<PLACEHOLDER_CLIENT_SECRET>',
  verificationMode: 'jwks',
  roleClaimShape: 'client-roles',
  scopes: ['openid', 'profile', 'email'],
  redirectUri: '<PLACEHOLDER_PROJECT_CALLBACK_URL>',
  providerLogout: 'none',
  sessionMode: 'opaque-handle',
  bearerSource: null,
  jwksCacheTtlSeconds: 900,
  introspectionCacheTtlSeconds: 0,
  bootPosture: 'strict',
  deferredRetryCapSeconds: 300,
  discoveryRefreshSeconds: 3600,
  enabled: true
}
```

## Field notes

- `realmSlug` is a project-local stable slug; it appears in `principalId` derivations and in every audit event. Short and lowercase; do not use the operator's realm name here (that is `realmName`).
- `issuerBaseUrl` is the URL prefix Keycloak reports as the realm's issuer, up to but not including `/realms/<realm>`. The discovery client appends `/realms/<realmName>/.well-known/openid-configuration`.
- `verificationMode` is `'jwks'` (default) or `'introspection'`. See ADR-1202.
- `roleClaimShape` is `'client-roles'` (reads `resource_access.<clientId>.roles`) or `'realm-roles'` (reads `realm_access.roles`). See REQ-006 and TAC-1205.
- `providerLogout` is `'none'` (default; sign-out clears the project session only) or `'redirect'` (sign-out returns a 302 to the realm's `end_session_endpoint`). A record with `'redirect'` on a realm whose discovery lacks `end_session_endpoint` refuses boot. See REQ-010 and ADR-1206.
- `sessionMode` is `'opaque-handle'` (the default; server-side session record + opaque cookie) or `'stateless'` (per-request bearer verification, no session record). See ADR-1204.
- `bearerSource` is required when `sessionMode='stateless'`: `'authorization-header'` or `'cookie:<name>'`.
- `jwksCacheTtlSeconds` is 900 by default; the record may raise (up to 86400) or lower (down to 60). See ADR-1205.
- `introspectionCacheTtlSeconds` is 0 by default (no cache); the record may raise for high-issuance realms. See TAC-1203.
- `bootPosture` is `'strict'` (default), `'deferred'`, or `'standby'`. See REQ-011 and TAC-1201.
- `discoveryRefreshSeconds` is the background refresh cadence (default 3600); a failure at refresh logs a warning and does not flip a healthy realm to unhealthy.
- `enabled: false` marks the record as configured but not routed to; the provider-router skips disabled records.

## Multiple realms

A project may declare N realm records. Each carries its own `realmSlug` and its own set of the fields above. The provider-router (TAC-1204) uses a project-authored `routeFn` to decide which realmSlug a request routes to. A project with only one realm passes a constant `routeFn`; the reference wiring ships that constant.

## Rejection classes at boot

- Missing required field: `KEYCLOAK_RECORD_INCOMPLETE` naming the field.
- `verificationMode='introspection'` on a discovery without `introspection_endpoint`: `KEYCLOAK_DISCOVERY_MISSING_ENDPOINT`.
- `providerLogout='redirect'` on a discovery without `end_session_endpoint`: `KEYCLOAK_LOGOUT_NOT_DECLARED`.
- `sessionMode='stateless'` without `bearerSource`: `KEYCLOAK_BEARER_SOURCE_MISSING`.
- `jwksCacheTtlSeconds` outside `[60, 86400]`: `KEYCLOAK_JWKS_TTL_OUT_OF_RANGE`.
