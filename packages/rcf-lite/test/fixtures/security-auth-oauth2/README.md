# security-auth-oauth2 fixture

Shared fixture for the security-auth-oauth2 blueprint's probe pack
(criterion e hardening, 2026-09-11). Ships small local adapters
plus a self-contained mock authorisation server so the local probes
prove the RFC 6749 + RFC 7636 wire shape end-to-end without a
commercial IdP dependency, and honest-skip the real-provider
branch when no account is available.

## Layout

- `src/mock-authorization-server.mjs` - an in-process HTTP server
  speaking the RFC 6749 authorisation-code flow with the RFC 7636
  S256 PKCE method. Binds a per-instance `X-Mock-Request-Id` header
  on every response (rule 7d evidence shape 1). Refuses on missing
  challenge, wrong `code_challenge_method`, unknown client_id,
  code replay, and PKCE verifier mismatch.
- `src/provider-adapter.mjs` - TAC-1102 provider-adapter shape
  (`chooseDiscoveryUrl`), TAC-1103 session-bridge (`bridgeSession`),
  and TAC-1104 provider-selector (`selectProvider`, `knownProviders`).

## Probes composed against this fixture

- `pkce-challenge-shape` (local, PKCE derivation and length band).
- `authorisation-code-flow-shape` (local mock server, full code
  flow with single-use replay and PKCE-mismatch refusal paths).
- `provider-adapter-shape` (local, issuer discovery URL derivation
  and provider-selector known-set refusal).
- `session-bridge-shape` (local, session-record shape and refusal
  paths).
- `real-account-authorisation-code-flow` (live against a commercial
  OAuth 2.0 provider; honest-skips when
  `CI_HAS_OAUTH2_PROVIDER` is unset - AMBER on the shelf is the
  expected honest outcome in this estate).

## Declared env vars

Every environment variable this fixture or any probe it hosts
reads is declared here. A probe that reads any variable not on
this table fails the positive-evidence gate row at review time.

| Env var | Tier | Purpose | Consumed by |
|---|---|---|---|
| `CI_HAS_OAUTH2_PROVIDER` | first | Gate for the account-bound branch on the real-account OAuth 2.0 probe. | `real-account-authorisation-code-flow.mjs` |
| `OAUTH2_ISSUER_URL` | second | OpenID Connect issuer URL discovered against for `/.well-known/openid-configuration`. | `real-account-authorisation-code-flow.mjs` |
| `OAUTH2_CLIENT_ID` | second | Client id presented on the authorisation and token calls. | `real-account-authorisation-code-flow.mjs` |
| `OAUTH2_CLIENT_SECRET` | second | Client secret presented on the token call. Never logged, never written to a file. | `real-account-authorisation-code-flow.mjs` |
| `OAUTH2_REDIRECT_URI` | second | Redirect URI the code-flow returns to. | `real-account-authorisation-code-flow.mjs` |
| `OAUTH2_MOCK_PORT` | optional | Test-only override for the mock server's port (must fall inside the security family's declared range 47400-47449). Not a skip trigger. | `authorisation-code-flow-shape.mjs` |

## Vendor citations

- RFC 6749 sec 3.1 (TLS on production token endpoints):
  https://datatracker.ietf.org/doc/html/rfc6749#section-3.1, verifiedOn 2026-09-11.
- RFC 6749 sec 4.1.2 (authorisation code single-use):
  https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.2, verifiedOn 2026-09-11.
- RFC 7636 sec 4.1 (verifier length band):
  https://datatracker.ietf.org/doc/html/rfc7636#section-4.1, verifiedOn 2026-09-11.
- RFC 7636 sec 4.6 (server-side verify):
  https://datatracker.ietf.org/doc/html/rfc7636#section-4.6, verifiedOn 2026-09-11.
- OpenID Connect Discovery 1.0:
  https://openid.net/specs/openid-connect-discovery-1_0.html, verifiedOn 2026-09-11.
