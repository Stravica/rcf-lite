# Keycloak local-container bootstrap: shape (not a compose file lift)

Shape a project stands up to satisfy REQ-009's local-first posture. The container is real Keycloak on the wire; the discovery client, the JWT verifier, and the introspection client cannot tell it apart from a cloud-hosted realm for the purpose of the state machine and the verification paths.

The blueprint does NOT ship a `docker-compose.yaml` file, a `Dockerfile`, or a container-orchestration recipe from any real deployment. The notes below name the shape a project's harness follows; the harness itself lives on the project.

## Image

The vendor's official image is `quay.io/keycloak/keycloak`. The operator pins the currently-supported stable tag at the moment they set the harness up (the vendor's release cadence moves; the pin belongs on the project's tooling, not on this blueprint). A harness that reads the pin from a project environment file is the recommended pattern.

## Startup command shape

Development-mode startup is what the harness invokes; the vendor documents it as `kc.sh start-dev`. The harness passes:

- `KC_HOSTNAME=127.0.0.1` (or a hostname the project's test suite reaches over)
- `KC_HTTP_ENABLED=true` (development-mode is fine over plain HTTP; production is the operator's own concern and not this asset's shape)
- `KC_BOOTSTRAP_ADMIN_USERNAME` and `KC_BOOTSTRAP_ADMIN_PASSWORD` read from a project environment file the harness controls (placeholders only; never committed)
- A published port the harness records for the `issuerBaseUrl` on the realm-config record

The container is standalone; no external database is required in development mode (Keycloak's default embedded H2 covers a scratch service).

## Realm seed (placeholder-only)

The harness applies a realm-configuration seed either through the vendor's `kc.sh import` path (mounting a realm-export file) or through the admin REST API after startup. The seed carries:

- Realm name: `example` (a generic placeholder; the operator picks a stable name for their project)
- One client: `example-client`
  - `Access Type: confidential`
  - `Client authentication: on`
  - `Standard flow (authorisation code): on`
  - `Direct access grants: off`
  - `Redirect URIs: <project-callback-url>` (the project's callback route on the test process)
  - `PKCE Code Challenge Method: S256`
  - `Access Token Signature Algorithm: RS256` (JWKS mode) or issued opaque (introspection mode)
- One role assignment shape:
  - Client roles when `roleClaimShape: 'client-roles'` (recommended default)
  - Realm roles when `roleClaimShape: 'realm-roles'`
- One or two test users (placeholder usernames and passwords; never committed)

Nothing in this seed shape names a real deployment; the operator either accepts the `example` names or renames them for their own project.

## Wiring notes for the project

- The harness records `<issuerBaseUrl>` (the container's public URL) and passes it as the `issuerBaseUrl` field on the realm-config record.
- The realm name (`realmName` field on the record) matches the seed's realm name.
- The `clientId` and `clientSecret` on the record match the seeded client's fields; the secret comes from the admin surface after client creation and lives in an operator-controlled environment file, never in a committed record.
- A harness that tears down the container between test suites is fine and preferred; Keycloak's development-mode startup is fast enough to run per-suite when the project's suite structure warrants it.
- A harness that keeps a shared team-level container running is also fine; each project's harness applies its own seed on start.

## Alternate stand-up paths

- A persistent scratch service the operator runs once (a system-installed Keycloak, a team-shared container, a devcontainer) is fine; the harness records the discovered endpoints and the mechanism does not care whether the realm is per-suite or persistent.
- A Kubernetes namespace with Keycloak deployed via the vendor's operator (or via a chart the operator maintains) is fine; the mechanism sees a discovery endpoint and populates the record.
- The blueprint does not commit to any of these paths; the shape above is the contract, not the tooling.
