# security-auth-keycloak fixture

Shared fixture for the security-auth-keycloak blueprint's probe
pack (criterion e hardening, 2026-09-11). Local adapters mirror
the TAC-1201..1205 contracts (discovery, JWT verify, RFC 7662
introspection, role adapter) so shape and refusal paths are
proven without a live Keycloak realm dependency; the real-realm
branch honest-skips per rule 7d until a client is exposed to CI.

## Layout

- `src/discovery-client.mjs` - TAC-1201 discovery-URL builder
  (`buildDiscoveryUrl`) and OIDC document validator
  (`validateDiscoveryDocument`).
- `src/jwt-verifier.mjs` - TAC-1202 RS256 sign/verify primitive
  using node:crypto on an in-process throwaway keypair. Refuses
  alg mismatch, expiry, iss mismatch and signature tamper.
- `src/introspection-client.mjs` - TAC-1203 RFC 7662 introspection
  request builder and response parser.
- `src/role-adapter.mjs` - TAC-1205 realm+resource-access role
  mapper. Refuses unknown role tokens.

## Probes composed against this fixture

- `discovery-shape` (local, capability `principalDirectory`).
- `jwt-verifier-shape` (local, capability `credentialSelfService`).
- `introspection-shape` (local, capability `sessionInventory`).
- `role-adapter-shape` (local, capability `roleModel`).
- `real-account-realm-round-trip` (live against an estate-owned
  Keycloak realm; honest-skips when `CI_HAS_KEYCLOAK_ACCOUNT` is
  unset - AMBER on the shelf is the expected honest outcome in
  this estate).

## Declared env vars

| Env var | Tier | Purpose | Consumed by |
|---|---|---|---|
| `CI_HAS_KEYCLOAK_ACCOUNT` | first | Gate for the account-bound branch on the real-realm probe. | `real-account-realm-round-trip.mjs` |
| `KEYCLOAK_BASE_URL` | second | Keycloak base URL (https). | `real-account-realm-round-trip.mjs` |
| `KEYCLOAK_REALM` | second | Realm name against which the round-trip runs. | `real-account-realm-round-trip.mjs` |
| `KEYCLOAK_ADMIN_CLIENT_ID` | second | Admin client id used for client-credentials against the realm's token endpoint. | `real-account-realm-round-trip.mjs` |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | second | Admin client secret; never logged, never written to a file. | `real-account-realm-round-trip.mjs` |
| `KEYCLOAK_INTROSPECTION_TOKEN` | optional | Pre-obtained bearer token forwarded to the introspection endpoint for a live introspection round-trip when the admin client cannot mint tokens for the user under test. | `real-account-realm-round-trip.mjs` (future extension) |

## Vendor citations

- OpenID Connect Discovery 1.0 sec 3:
  https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig, verifiedOn 2026-09-11.
- RFC 7662 sec 2.1 (introspection request):
  https://datatracker.ietf.org/doc/html/rfc7662#section-2.1, verifiedOn 2026-09-11.
- RFC 7662 sec 2.2 (introspection response):
  https://datatracker.ietf.org/doc/html/rfc7662#section-2.2, verifiedOn 2026-09-11.
- Keycloak token introspection endpoint:
  https://www.keycloak.org/securing-apps/token-introspection-endpoint, verifiedOn 2026-09-11.
