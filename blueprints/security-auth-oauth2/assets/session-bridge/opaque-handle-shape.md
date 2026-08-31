# Session-bridge: opaque-handle session-record shape

Record-only reference for the shape TAC-1103's session-bridge issues and reads. Not production code; a project authors its own persistence-backed implementation against this shape (or points at an in-memory store for the reference wiring).

## Session record

```
{
  handle: '<random-192-bit-opaque-string>',
  principal: {
    principalId: '<provider.id>:<sub-or-userinfo-id>',
    provider: '<provider.id>',
    email: '<optional-email>',
    roles: [],
    organisationIds: []
  },
  providerId: '<provider.id>',
  accessToken: '<opaque-provider-access-token>',
  idToken: '<optional-signed-jwt-oidc-only>',
  refreshToken: '<optional-opaque-provider-refresh-token>',
  chainRoot: '<initial-handle-of-the-refresh-chain>',
  issuedAt: 1700000000,
  expiresAt: 1700028800
}
```

## Reduced Principal (attached to `request.auth`)

```
{
  principalId: 'google:117340098374012345678',
  provider: 'google',
  email: 'operator@example.invalid',
  roles: [],
  organisationIds: []
}
```

Notes:
- The reduced Principal is the ONLY object downstream code reads from `request.auth`. Access tokens, id tokens, and refresh tokens live on the session record and never appear on `request.auth`.
- `principalId` includes the provider slug on purpose: a user signed in through two providers is two principals unless the project's `enrichPrincipal` hook says otherwise (identity merging is a project-level policy decision, not a mechanism decision).
- `chainRoot` is the initial session handle for a refresh chain; refresh-token rotation preserves the same chainRoot so reuse detection can revoke every session that shares the chain in one call.
- `roles` and `organisationIds` are empty arrays by default; a project's `enrichPrincipal` hook populates them from project-side sources.

## Cookie header shape (issued on callback)

```
Set-Cookie: <sessionCookieName>=<handle>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<sessionExpirySeconds>
```

The `<sessionCookieName>` is a project config value (default `app_session`); the `<handle>` is the session record's `handle` field; `<sessionExpirySeconds>` is the project config value (default 28800, 8 hours). The cookie value is neither the access token, the id_token, nor a refresh token.

## Cookie header shape (issued on sign-out)

```
Set-Cookie: <sessionCookieName>=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0
```

Setting `Max-Age=0` on the same-named cookie with the same `Path` clears it in the browser; the session-record store deletes the record in the same request; a subsequent replay of the pre-signout cookie is unauthenticated.
