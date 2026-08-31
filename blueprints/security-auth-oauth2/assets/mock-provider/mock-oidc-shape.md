# Mock OIDC provider bootstrap: shape (not a library commitment)

Shape a project stands up to satisfy REQ-010's runtime-verify posture. The mock is real OIDC on the wire; the flow controller cannot tell it apart from a live IdP for the purpose of the state machine, PKCE binding, id_token verification, and session-bridge round-trip.

A project may implement the mock in-process (a small Node HTTP server the test harness starts and tears down), against an existing library (Node has `node-oidc-provider` and equivalents; the blueprint does not commit a version), or as a persistent scratch service. The shape below is what the test harness expects, not what a specific library commits to.

## Discovery document (`GET /.well-known/openid-configuration`)

```
{
  issuer: 'http://127.0.0.1:<port>',
  authorization_endpoint: 'http://127.0.0.1:<port>/authorize',
  token_endpoint: 'http://127.0.0.1:<port>/token',
  userinfo_endpoint: 'http://127.0.0.1:<port>/userinfo',
  jwks_uri: 'http://127.0.0.1:<port>/jwks',
  end_session_endpoint: 'http://127.0.0.1:<port>/end-session',
  response_types_supported: ['code'],
  code_challenge_methods_supported: ['S256'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256']
}
```

## JWKS (`GET /jwks`)

A JSON Web Key Set with one RSA public key. The mock holds the corresponding private key and signs id_tokens with it. The test harness can rotate the JWKS mid-test to exercise AC-10105-2 (signature invalid).

## Authorize (`GET /authorize`)

Accepts `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`, `nonce`, `scope=openid profile email`. Stores a pending record keyed by the code it mints. Redirects to `redirect_uri` with `code=<minted>&state=<passed>`.

## Token (`POST /token`)

Accepts `grant_type=authorization_code` with `code`, `code_verifier`, `client_id`, `redirect_uri`. Verifies the `code_verifier` against the pending record's stored challenge. Mints:

- `access_token`: opaque
- `id_token`: signed JWT with `iss`, `aud=client_id`, `sub`, `nonce=<from-authorize>`, `iat`, `exp`
- `refresh_token`: opaque, rotates on `grant_type=refresh_token`

Also accepts `grant_type=refresh_token` with `refresh_token` and rotates. Test-controllable knobs (per-code): return `invalid_grant` on demand (for AC-10103-2, AC-10104-1), omit `id_token` (for AC-10105-4), mint id_token with wrong `iss` (for AC-10105-3), mint id_token signed by an unpublished key (for AC-10105-2), return the same `refresh_token` twice to simulate reuse (for AC-10107-2).

## Userinfo (`GET /userinfo`)

Accepts `Authorization: Bearer <access_token>`. Returns a fixed claim record `{ sub, email }`. Used by `providerKind: 'oauth2-only'` records; OIDC-declared providers rely on the id_token for identity.

## End session (`GET /end-session`)

Accepts `post_logout_redirect_uri` and `id_token_hint`. Returns 302 to the `post_logout_redirect_uri` after invalidating any local session state the mock holds.

## Wiring notes for the project

- The mock listens on `127.0.0.1:<random-port>` and the harness passes the port to the provider record's endpoints. `redirect_uri` on the record points at the project's callback route.
- The mock's private key stays in the harness process; nothing off-machine holds it. The public JWKS is what the flow-controller's verifier reads.
- The mock does NOT need to persist state; a fresh instance per test suite is fine and preferred.
- The blueprint does NOT commit a specific library. If a project wants a persistent scratch service (a container the CI stands up once), that is also fine; the shape above is the contract.
