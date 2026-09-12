# security-auth-clerk fixture

Shared fixture for the security-auth-clerk blueprint's probe pack
(criterion e hardening, 2026-09-11). The fixture ships small local
adapters that mirror the Clerk Backend API's user/session/hosted-ui
contracts at the adapter boundary so local probes exercise the same
call graph the live probes drive against Clerk itself. The live
probes at `blueprints/security-auth-clerk/contributions/probes/real-account-*`
carry the wire proof; the local adapters carry the shape and refusal
paths without touching the network.

## Layout

- `src/principal-directory.mjs` - in-memory principal directory
  adapter modelled on Clerk Backend API's users resource (create,
  get, list, delete). Not used directly by any probe; kept beside
  the live probe to document the contract the fixture would
  compose against.
- `src/role-adapter.mjs` - the TAC-1002 authorisation adapter shape.
  Maps a Clerk user's `publicMetadata.roles` claim to a known-role
  set (viewer / editor / admin); refuses unknown roles and non-array
  input. Exercised by the local `role-model-adapter` probe.
- `src/hosted-ui-config.mjs` - hosted-identity-UI configuration
  validator. Refuses a config missing `signInUrl`, `signUpUrl` or
  `afterSignInRedirect`, or one carrying a non-https URL. Exercised
  by the local `hosted-identity-ui-config` probe. HTTPS-only rule per
  Clerk hosted-UI docs (https://clerk.com/docs/customization/account-portal,
  verifiedOn 2026-09-11).

## Probes composed against this fixture

- `role-model-adapter` (local, capability `roleModel`).
- `hosted-identity-ui-config` (local, capability `hostedIdentityUi`).
- `real-account-principal-directory-round-trip` (live against
  Clerk Backend API, capability `principalDirectory`).
- `real-account-session-inventory` (live against Clerk Backend
  API, capability `sessionInventory`; TAC-1003 session verifier
  contract).

## Declared env vars

Every environment variable this fixture or any probe it hosts
reads is declared here. First-tier env vars gate entry into the
account-bound branch; second-tier vars, when unset with the
first-tier gate set, still record `accountBoundSkipped: true`
naming the missing variable in `reason` per rule 7d. A probe that
reads any variable not on this table fails the positive-evidence
gate row at review time.

| Env var | Tier | Purpose | Consumed by |
|---|---|---|---|
| `CI_HAS_CLERK_ACCOUNT` | first | Gate for the account-bound branch on every Clerk real-account probe. | `real-account-principal-directory-round-trip.mjs`, `real-account-session-inventory.mjs` |
| `CLERK_SECRET_KEY` | second | Clerk Backend API secret key used as `Authorization: Bearer <key>`. Presented on every call the live probes make. Never logged, never written to a file. | `real-account-principal-directory-round-trip.mjs`, `real-account-session-inventory.mjs` |
| `CLERK_PUBLISHABLE_KEY` | second | Reserved for a future hosted-UI live probe that would render the Clerk-hosted sign-in via the publishable key. Declared here up front to keep the fixture manifest complete. | (declared; no probe reads it yet) |
| `CLERK_API_BASE_URL` | optional | Test-only override pointing the live probes at a local mock Clerk API. Not a skip trigger; declared for completeness. Defaults to `https://api.clerk.com/v1`. | `real-account-principal-directory-round-trip.mjs`, `real-account-session-inventory.mjs` |
| `GITHUB_RUN_ID` | optional | Run tag stamped on the evidence record when set; falls back to `local-<timestamp>`. Not a skip trigger. | `real-account-principal-directory-round-trip.mjs` |

## Live-run notes

The live probes use Clerk's documented test-mode email pattern
`<local-part>+clerk_test@example.com` (Clerk test emails and phone
numbers docs; https://clerk.com/docs/testing/test-emails-and-phones,
verifiedOn 2026-09-11) so the scratch principal never triggers a
real verification email. Each run creates one principal, reads it
back, lists the users page (asserting the id is present), deletes
the principal, and re-lists (asserting the id is absent). A
mid-run crash leaves the teardown in a `finally` block; a teardown
failure flips the verdict to FAIL-WITH-ORPHAN and names the
orphaned `user_...` id on the evidence record.
