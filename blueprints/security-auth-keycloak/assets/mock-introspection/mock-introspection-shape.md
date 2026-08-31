# Mock introspection responder: shape

A local stub responder a project stands up to satisfy US-11105's runtime-verify posture for `verificationMode: 'introspection'` without running a second Keycloak realm configured for opaque tokens.

The mock is real RFC 7662 on the wire: same request shape, same response shape, same content-type. The introspection client cannot tell it apart from a real Keycloak introspection endpoint for the purpose of the state machine and the response handling.

A project may implement the mock in-process (a small Node HTTP server the test harness starts and tears down), against an existing library, or as a persistent scratch service. The shape below is what the harness expects, not what a specific library commits to.

## Introspection endpoint (`POST /introspect`)

Accepts:

```
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(clientId:clientSecret)>

token=<opaque-token>
```

Returns (per RFC 7662):

```
Content-Type: application/json

{
  "active": true,
  "sub": "<opaque-subject-id>",
  "aud": "<clientId>",
  "iss": "<issuer>",
  "exp": <epoch-seconds>,
  "scope": "openid profile email",
  "resource_access": {
    "<clientId>": {
      "roles": ["admin", "editor"]
    }
  },
  "realm_access": {
    "roles": []
  }
}
```

## Test-controllable knobs (per-token)

- Return `active: false` on demand (for AC-11105-2)
- Return HTTP 503 on demand (for AC-11105-3)
- Return HTTP 400 on demand (for endpoint-error edge cases)
- Return an `active: true` response with a claim record shaped for either `client-roles` or `realm-roles` (for US-11107)
- Return an `active: true` response with a malformed `roles` field (for AC-11107-3)

## Wiring notes

- The mock listens on `127.0.0.1:<random-port>` and the harness passes the port to the realm-config record's `introspection_endpoint` (either directly or through a discovery-response substitution).
- The mock's `clientSecret` is a placeholder the harness controls; the real realm's secret never appears here.
- A per-test-suite instance is fine and preferred; state does not have to persist.
- A project may substitute a second local Keycloak realm configured for opaque tokens if it prefers a real Keycloak surface; the mechanism cannot tell the difference and does not care.

## What this asset does NOT commit

- No library or package version. The shape is the contract; the implementation is a project responsibility.
- No specific `sub` value, no specific role vocabulary, no specific issuer string. The examples above are placeholders.
- No real `clientId` or `clientSecret`. The mock trusts whatever basic-auth pair the harness gives it, or refuses per the harness's test-driven behaviour.
